#!/usr/bin/env node
/**
 * testrun.mjs — the tiered, parallel test runner (Drew, 2026-10-01; docs/TESTING.md).
 *
 *   node testrun.mjs --quick                      the [1] module load + every smoke- and quick-tagged suite   (~1.5 min, boot-bound)
 *   node testrun.mjs --affected [--base <ref>]    the smoke set + every suite the diff can reach          (seconds → minutes)
 *   node testrun.mjs --full                       everything, in parallel (what `node loadtest.mjs` runs)
 *   node testrun.mjs --tz UTC                     the second-zone pass alone: ONLY the tz-tagged suites, under UTC
 *   node testrun.mjs --full --tz UTC              the release gate: everything in the primary zone + the tz-tagged suites under UTC
 *                                                 (an unknown zone, or one with this machine's own offsets, is refused)
 *   node testrun.mjs --only a,b                   exactly those suites (ids from --list)
 *   node testrun.mjs --list                       the plan: every suite, its tags, isolation, expected time
 *   node testrun.mjs --explain <id>               why --affected would pick (or skip) a suite: its dependency set
 *
 * Options: --jobs N (default CPUs-1)  --browser-jobs N (default 2)  --tz <zone>  --log-dir <dir>  --keep-tmp
 *          --changed a,b,c (skip git: treat these repo paths as the diff)   --strict-inert   --strict-quick   --no-slot
 *          --allow-full (M-42, D-75: an --affected run that would fall back to the full run STOPS, exit 2, and prints the reason and the
 *                        faster --changed command; this flag lets it run everything instead. --full and the gates never stop)
 *          --check-deps (full run that TRACES what every suite really reads and fails if the dependency map misses any)
 *          --check-tz (full run that PROBES every suite's zone-dependent Date/Intl calls and fails if one is not tagged tz)
 *          --audit-writes (SERIAL: snapshot the real checkout around each suite and say which ones write into it — how isolate:"tree" is chosen)
 *
 * Same pass/fail semantics as the old loadtest.mjs: every suite's exit code, its own summary line, its
 * ratcheted floor, and the extra checks its old block carried (forbidden text, no skips, no leaked scratch file);
 * a crash, a missing summary line and a below-floor count are each a FAILURE. A suite that hits its deadline in the parallel pass
 * is a TIMEOUT: nothing is counted for that run, and it is re-run ONCE, ALONE, after the pass (same deadline, same checks); it is a
 * FAILURE only if that solo run fails or times out too. One line per suite; detail only for failures. The last line is today's exact
 * format: `✅ ALL PASS — N passed, M failed`.
 *
 * ONE RUN, ONE PROCESS GROUP (W-22, 2026-10-08). The process the caller starts is a thin launcher: it starts the run in a fresh session
 * (its own process group, which holds the runner, every suite and what they start), forwards Ctrl-C / SIGTERM / SIGHUP to that
 * group and passes the run's exit status on. The run prints `stop:  kill -TERM -<pgid>` at the top: that stops this run and nothing else.
 * If the launcher is killed outright, the run notices and stops itself. Never stop a run by name (pkill/killall): a name matches every run.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { cpus, tmpdir, constants as osConstants } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { loadManifests, assertNotDenied, denied, DENYLIST } from './tests/lib/manifest.mjs';
import { evaluateSuite, evaluateCore } from './tests/lib/evaluate.mjs';
import { legacyBlockCount } from './tests/lib/extract.mjs';
import { runChild, runPool, claimRunGroup, groupOf } from './tests/lib/exec.mjs';
import { snapshotTree, diffSnapshots, cloneTree, watchTree, unreadableFiles } from './tests/lib/tree.mjs';
import { buildDepMap, selectAffected, missedByMap, classifyLoadtestEdit, globToRegExp, LOADTEST, CORE_LOAD, RUNNER_PATHS } from './tests/lib/depmap.mjs';
import * as slots from './tests/lib/semaphore.mjs';

const cfbDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(cfbDir, '..');
const suitesDir = path.join(cfbDir, 'tests', 'suites');
const HELP = `usage: node testrun.mjs (--quick | --affected [--base <ref>] | --full | --only <ids> | --list | --explain <id>) [options]\n` +
  `       see the header of testrun.mjs or docs/TESTING.md`;

// ── args ──────────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const o = { tier: null, only: null, base: null, jobs: null, browserJobs: 2, tz: null, logDir: null, keepTmp: false, changed: null, strictInert: false, strictQuick: false, allowFull: false, noSlot: false, list: false, explain: null, checkDeps: false, checkTz: false, auditWrites: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--quick' || a === '--full' || a === '--affected') o.tier = a.slice(2);
    else if (a === '--only') { o.tier = 'only'; o.only = val().split(',').map(s => s.trim()).filter(Boolean); }
    else if (a === '--base') o.base = val();
    else if (a === '--jobs') o.jobs = Number(val());
    else if (a === '--browser-jobs') o.browserJobs = Number(val());
    else if (a === '--tz') o.tz = val();
    else if (a === '--log-dir') o.logDir = val();
    else if (a === '--keep-tmp') o.keepTmp = true;
    else if (a === '--changed') o.changed = val().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--strict-inert') o.strictInert = true;
    else if (a === '--strict-quick') o.strictQuick = true;
    else if (a === '--allow-full') o.allowFull = true;
    else if (a === '--no-slot') o.noSlot = true;
    else if (a === '--list') o.list = true;
    else if (a === '--explain') o.explain = val();
    else if (a === '--check-deps') { o.checkDeps = true; o.tier = o.tier || 'full'; }
    else if (a === '--check-tz') { o.checkTz = true; o.tier = o.tier || 'full'; }
    else if (a === '--audit-writes') { o.auditWrites = true; o.jobs = 1; o.browserJobs = 1; o.tier = o.tier || 'full'; }
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.tier && o.tz && !o.list && !o.explain) o.tier = 'tz';                     // a bare --tz <zone>: the second-zone pass on its own
  if (o.tz) { const problem = checkZone(o.tz); if (problem) throw new Error(problem); }
  return o;
}

/**
 * Reviewer N1 (2026-10-07): a second zone must be a real zone (an unknown name silently runs as UTC) and must differ from the run's own
 * zone (process TZ, else the machine's) in January or July — otherwise the second-zone pass tests nothing new. Returns the problem or null.
 */
export function checkZone(zone, host = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch {
    return `--tz "${zone}" is not a time zone (an IANA name such as UTC or America/Los_Angeles) — refused: a typo would otherwise run silently as UTC`;
  }
  let hostOk = true;
  try { new Intl.DateTimeFormat('en-US', { timeZone: host }); } catch { hostOk = false; }
  if (!hostOk) return null;
  const offsetAt = (tz, iso) => (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(iso)).find(p => p.type === 'timeZoneName') || {}).value;
  const y = new Date().getUTCFullYear();
  if ([`${y}-01-15T12:00:00Z`, `${y}-07-15T12:00:00Z`].every(iso => offsetAt(zone, iso) === offsetAt(host, iso))) {
    return `--tz ${zone} has the same UTC offsets as this run's own zone (${host}) in January and July — refused: the second-zone pass would test nothing new (pick one that differs, e.g. --tz UTC on a US machine)`;
  }
  return null;
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────
export function inferTags(cfbDirAbs, m) {
  const tags = new Set(m.tags || []);
  try {
    const text = readFileSync(path.join(cfbDirAbs, m.script), 'utf8');
    // a Chromium suite is capped even if nobody tagged it. The flag must open a STRING (`'--remote-debugging-port=0'`, as every
    // launcher spells it): a comment or a fixture that merely mentions it — testruntest.mjs does — is not a browser (it once
    // squatted a browser slot for 93 s of a full run)
    if (/['"`]--remote-debugging-port/.test(text)) tags.add('browser');
  } catch { /* validated elsewhere */ }
  return tags;
}

function repoHash() { return createHash('sha1').update(root).digest('hex').slice(0, 8); }
function cacheDir() { return path.join(tmpdir(), `cfbp-testrun-${repoHash()}`); }
function readTimings() { try { return JSON.parse(readFileSync(path.join(cacheDir(), 'timings.json'), 'utf8')); } catch { return {}; } }
function writeTimings(t) { try { mkdirSync(cacheDir(), { recursive: true }); writeFileSync(path.join(cacheDir(), 'timings.json'), JSON.stringify(t)); } catch { /* best effort */ } }

function git(args) {
  // the repo AT `root`, never one a parent process (a hook, a wrapper) pointed the environment at
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
}
/**
 * W-22: how loadtest.mjs differs from the base the diff is measured against — the merge-base with `base`, else HEAD (the uncommitted work).
 * With `--changed` and no `--base` there is no base to compare with, so the answer is "not list-only" (⇒ full), never "compare with HEAD".
 */
export function loadtestEditSince(base, { changedGiven = false } = {}) {
  const no = why => ({ listOnly: false, why, added: [], removed: [] });
  if (changedGiven && !base) return no('--changed without --base: there is no base version to compare it with');
  let rev;
  try { rev = base ? git(['merge-base', base, 'HEAD'])[0] : 'HEAD'; } catch (e) { return no(`no merge-base with ${base}: ${e.message}`); }
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync('git', ['show', `${rev}:./${LOADTEST}`], { cwd: root, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return no(`loadtest.mjs has no version at ${base || 'HEAD'} to compare with`);
  let head;
  try { head = readFileSync(path.join(root, LOADTEST), 'utf8'); } catch (e) { return no(`loadtest.mjs cannot be read (${e.code || e.message})`); }
  return classifyLoadtestEdit(r.stdout, head);
}

export function gitChanged(base) {
  const set = new Set();
  const add = l => l.forEach(f => set.add(f));
  add(git(['diff', '--name-only', '--no-renames', 'HEAD']));                  // staged + unstaged
  add(git(['ls-files', '--others', '--exclude-standard']));                     // untracked
  if (base) {
    git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);               // fail loudly on a typo'd ref
    add(git(['diff', '--name-only', '--no-renames', `${base}...HEAD`]));         // committed since the merge-base
  }
  return [...set].sort();
}

const fmtS = ms => `${(ms / 1000).toFixed(1)}s`;
const pad = (s, n) => String(s).length >= n ? String(s) : String(s) + ' '.repeat(n - String(s).length);
const lpad = (s, n) => String(s).length >= n ? String(s) : ' '.repeat(n - String(s).length) + String(s);

// ── plan ──────────────────────────────────────────────────────────────────────────────────────
export function buildPlan(opts, { suites, depMap, changedFiles, loadtestEdit = null }) {
  const all = [...suites.values()];
  const withTags = m => ({ ...m, tags: [...inferTags(cfbDir, m)] });
  const isQuick = m => m.tags.includes('quick') || m.tags.includes('smoke');     // --quick: smoke ∪ quick
  const isSmoke = m => m.tags.includes('smoke');                                  // --affected always adds only this cheap subset
  const isTz = m => m.tags.includes('tz');                                        // date/time-sensitive: what a second zone can change
  const note = [];
  let selected;
  let tier = opts.tier;
  if (tier === 'only') {
    selected = [];
    for (const id of opts.only) {
      if (denied(id) || denied(id + '.mjs')) throw new Error(`REFUSED: "${id}" is on the runner's hard denylist (${DENYLIST.join(', ')})`);
      if (!suites.has(id)) throw new Error(`--only: no suite "${id}" (see --list)`);
      selected.push(withTags(suites.get(id)));
    }
  } else if (tier === 'full') {
    selected = all.filter(m => m.id !== 'core-load').map(withTags);
  } else if (tier === 'tz') {
    selected = [];                                                                // no primary pass: only the second-zone pass below
  } else if (tier === 'quick') {
    selected = all.map(withTags).filter(m => m.id !== 'core' && isQuick(m));
  } else if (tier === 'affected') {
    const sel = selectAffected({ changed: changedFiles, depMap, suites, root, strictInert: opts.strictInert, loadtestEdit });
    note.push(`changed files considered: ${changedFiles.length}${sel.inert.length ? ` (${sel.inert.length} inert: docs/notes no suite reads)` : ''}`);
    if (sel.listOnly.length && loadtestEdit) {
      const mods = [...loadtestEdit.added.map(m => `+${m}`), ...loadtestEdit.removed.map(m => `−${m}`)];
      note.push(`loadtest.mjs: only section [1]'s import list changed${mods.length ? ` (${mods.join(', ')})` : ''} — the [1] module load and the suites that read loadtest.mjs by name, not the full run`);
    }
    if (!sel.full && sel.held && sel.held.length) note.push(`held to their own deps (affectedByDepsOnly, D-76): ${sel.held.join(', ')} — the diff reaches them, but they run here only when their own files change (every --full runs them)`);
    // M-42 (Drew, 2026-10-14, D-75): an --affected run never turns into the full run on its own. It stops; main() prints why and the faster command
    if (sel.full && !opts.allowFull) return { tier: 'affected', selected: [], zoneSelected: [], note, stop: fullFallbackStop({ opts, changedFiles, reasons: sel.reasons, depMap, suites }) };
    if (sel.full) {
      tier = 'full';
      for (const r of sel.reasons) note.push(`FALLBACK TO --full: ${r}`);
      selected = all.filter(m => m.id !== 'core-load').map(withTags);
    } else {
      const ids = new Set(sel.ids);
      for (const m of all) { const t = withTags(m); if (m.id !== 'core' && (opts.strictQuick ? isQuick(t) : isSmoke(t))) ids.add(m.id); }
      if (ids.has('core')) ids.delete('core-load');                              // `core` already includes section [1]
      selected = [...ids].map(id => withTags(suites.get(id)));
      note.push(`affected: ${sel.ids.size} suite(s) reached by the diff + the smoke set${opts.strictQuick ? ' + the whole quick set (--strict-quick)' : ''}`);
    }
  } else throw new Error('no tier chosen');
  // the second-zone pass (--tz <zone>): ONLY the tz-tagged suites — of the whole set for a bare --tz, of this tier's selection otherwise
  // (so `--full --tz X` = the full sweep in the primary zone + the tz suites under X). A fixed-zone manifest (env.TZ) is never tagged tz.
  let zoneSelected = [];
  if (opts.tz) {
    zoneSelected = (tier === 'tz' ? all.map(withTags) : selected).filter(isTz);
    note.push(`second-zone pass: ${zoneSelected.length} tz-tagged suite(s) under TZ=${opts.tz}${tier === 'tz' ? ' (no primary pass)' : `, on top of the ${tier} pass in the primary zone`}`);
  }
  return { tier, selected, zoneSelected, note };
}

/** A shell word: as is when it is plain, else single-quoted (a changed path can hold spaces: `weekly bug fixes and feedback/…`). */
const shq = s => /^[\w./,@:+=-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * M-42 (D-75): what a stopped --affected run offers instead of the full run, keyed to what stopped it (review B2).
 *  - The files that stop a run on their own (loadtest.mjs, the runner's own files: RUNNER_PATHS) are left out of the faster run, which is the
 *    rest of the diff as --changed (the selection options carried over, N3), offered only when that rest no longer falls back.
 *  - What those files are tested by is printed as ONE --only command, minus whatever the rest already reaches: for loadtest.mjs, the core (its
 *    sections, [1] included) and every suite that reads loadtest.mjs by name (W-22's list-only set, N4); for a runner file, the runner's own
 *    tests (RUNNER_SELFTESTS: testruntest, and runnerrepotest, whose real-tree checks import the runner; M-49).
 *  - A file no suite reads has no smaller run that covers it; the stop says so. --allow-full is always named.
 * @returns {{ reasons: string[], left: string[], command: string|null, only: {ids: string[], cmd: string}|null, none: string|null }}
 */
export const RUNNER_SELFTESTS = ['testruntest', 'runnerrepotest'];
export function fullFallbackStop({ opts, changedFiles, reasons, depMap, suites }) {
  const runnerRes = RUNNER_PATHS.map(globToRegExp);
  const isRunner = f => runnerRes.some(r => r.test(f));
  const left = changedFiles.filter(isRunner);
  const rest = changedFiles.filter(f => !isRunner(f));
  const tz = opts.tz ? ` --tz ${shq(opts.tz)}` : '';
  const carried = [opts.strictInert && '--strict-inert', opts.strictQuick && '--strict-quick'].filter(Boolean).map(s => ' ' + s).join('') + tz;
  const restSel = rest.length ? selectAffected({ changed: rest, depMap, suites, root, strictInert: opts.strictInert }) : null;
  const reach = restSel && !restSel.full ? restSel.ids : new Set();
  const want = new Set();
  // loadtest.mjs: every suite that reads it by name, i.e. the core (its own script: its sections, [1] included) and W-22's list-only set (N4)
  if (left.includes(LOADTEST)) for (const [id, dep] of depMap) if (dep.named && dep.named.has(LOADTEST)) want.add(id);
  if (left.some(f => f !== LOADTEST)) for (const id of RUNNER_SELFTESTS) want.add(id);
  want.delete(CORE_LOAD);                                                       // the core runs section [1] too
  const ids = [...want].filter(id => suites.has(id) && !reach.has(id)).sort();
  const only = ids.length ? { ids, cmd: `node testrun.mjs --only ${ids.join(',')}${tz}` } : null;
  const comma = rest.find(f => f.includes(','));
  let command = null, none = null;
  if (!rest.length) none = `nothing but ${leftLabel(left)} changed`;
  else if (comma) none = `${comma} has a comma in its name, which --changed cannot carry`;
  else if (restSel.full) none = `no suite reads ${restSel.unmapped.length === 1 ? restSel.unmapped[0] : `${restSel.unmapped.length} of the changed files (named above)`}, so no smaller run can cover ${restSel.unmapped.length === 1 ? 'it' : 'them'} (the batch's --full will)`;
  else command = `node testrun.mjs --affected --changed ${shq(rest.join(','))}${carried}`;
  return { reasons, left, command, only, none };
}

/** "loadtest.mjs", "the runner's own files (…)", or both. */
function leftLabel(left) {
  const runner = left.filter(f => f !== LOADTEST).map(f => f.replace(/^cfb-pickems\//, ''));
  const parts = [...(left.includes(LOADTEST) ? ['loadtest.mjs'] : []), ...(runner.length ? [`the runner's own files (${runner.join(', ')})`] : [])];
  return parts.join(' and ');
}

function printFallbackStop(stop) {
  const e = (...a) => console.error(...a);
  e('❌ testrun --affected: STOPPED — nothing was run. This diff would fall back to the FULL run (every suite), and an --affected run no longer does that on its own (D-75):');
  for (const r of stop.reasons) e(`   why: ${r}`);
  if (stop.command) { e(`   the faster run, the same diff without ${leftLabel(stop.left)}:`); e(`     ${stop.command}`); }
  else e(`   no faster run${stop.none && /^no suite reads/.test(stop.none) ? ': ' : ' as --changed: '}${stop.none}`);
  if (stop.only) { e(`   ${stop.command ? 'and ' : ''}what tests ${leftLabel(stop.left)}${stop.command ? ', which that diff does not reach' : ''}:`); e(`     ${stop.only.cmd}`); }
  e('   to run everything anyway, add --allow-full (a builder\'s run normally should not: the batch\'s --full covers every suite)');
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────
async function postChecks(m, { cwd, suiteTmp }) {
  const out = [];
  for (const p of m.post || []) {
    if (p.kind === 'noLeaked') {
      const dir = p.dir === '$TMPDIR' ? suiteTmp : path.join(cwd, p.dir);
      let found = [];
      try {
        const names = existsSync(dir) ? readdirSync(dir) : [];
        found = p.names ? names.filter(n => p.names.includes(n)) : names.filter(n => new RegExp(p.pattern).test(n));
      } catch { /* unreadable ⇒ nothing to find */ }
      out.push({ ok: found.length === 0, label: `${p.label} (found leaked: ${JSON.stringify(found)})` });
    }
  }
  return out;
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(`testrun: ${e.message}\n${HELP}`); process.exit(2); }
  if (opts.help || (!opts.tier && !opts.list && !opts.explain)) { console.log(HELP); process.exit(opts.help ? 0 : 2); }

  // W-22: a run is ONE process group of its own. The process the caller started only launches it (and waits); the run below leads the group.
  const runs = !!opts.tier && !opts.list && !opts.explain;
  if (runs && process.env[LAUNCHER_ENV] === undefined) return launch(argv);
  // review note 9: a run whose launcher is already gone when it starts (killed between spawning it and this line), or whose launcher variable
  // names some other process, must stop here. Relaunching would start a new run that nothing supervises and nobody asked for.
  if (runs && process.env[LAUNCHER_ENV] !== String(process.ppid)) {
    console.error(`❌ testrun: ${LAUNCHER_ENV}=${process.env[LAUNCHER_ENV]} but this process's parent is ${process.ppid} — the launcher that started this run is gone (or the variable was set by hand). Nothing was run.`);
    process.exit(2);
  }
  if (runs) {
    let pgid = null;
    try { pgid = groupOf(process.pid); } catch (e) { console.error(`❌ testrun: ${e.message} — nothing was run (a run must know its own process group to be stoppable without touching any other)`); process.exit(2); }
    if (pgid !== process.pid) { console.error(`❌ testrun: this run does not lead a process group of its own (pid ${process.pid}, group ${pgid}) — nothing was run: stopping it could not be confined to this run`); process.exit(2); }
    claimRunGroup(process.pid);
    watchLauncher(Number(process.env[LAUNCHER_ENV]));
  }

  // a checkout whose files read as empty (iCloud-evicted "dataless" files) must stop here, with the cause, not surface as mystery failures
  if (opts.tier || opts.explain) {
    const unreadable = unreadableFiles(root);
    if (unreadable.length) {
      console.error(`❌ ${unreadable.length}${unreadable.length >= 50 ? '+' : ''} file(s) in the checkout cannot be read (a non-empty file that reads as empty — iCloud-evicted "dataless" files do this silently):`);
      for (const f of unreadable.slice(0, 12)) console.error('   ' + f);
      console.error('   Nothing was run. Make them local first (Finder → Download Now, or `brctl download <path>`), then re-run.');
      process.exit(2);
    }
  }

  // manifests + the legacy-block guard
  const { suites, errors } = loadManifests(suitesDir, { cfbDir });
  if (errors.length) { console.error('❌ tests/suites is not valid — nothing was run:'); for (const e of errors) console.error('  ' + e); process.exit(2); }
  const legacy = legacyBlockCount(readFileSync(path.join(cfbDir, 'loadtest.mjs'), 'utf8'));
  if (legacy > 0) {
    console.error(`❌ loadtest.mjs still registers ${legacy} spawned suite(s) the OLD way (a block appended after the switchover?).`);
    console.error('   Those suites are in no manifest, so this run would silently skip them. Convert them:  node tests/extract-suites.mjs --write');
    process.exit(2);
  }
  for (const m of suites.values()) assertNotDenied(m.script, m.args, { cwd: cfbDir });

  const needsMap = opts.tier === 'affected' || opts.explain;
  const depMap = needsMap ? buildDepMap({ root, cfbDir, suites }) : null;

  if (opts.explain) {
    const d = depMap.get(opts.explain);
    if (!d) { console.error(`no suite "${opts.explain}"`); process.exit(2); }
    console.log(`${opts.explain}: ${d.files.size} dependency file(s)`);
    for (const f of [...d.files].sort()) console.log('  ' + f);
    if (d.globs.length) console.log('globs: ' + d.globs.join(', '));
    if (d.gate) console.log(`affectedByDepsOnly (D-76): --affected selects it only when one of these changes: ${d.gate.join(', ')} — every --full runs it`);
    return;
  }
  if (opts.list) {
    const t = readTimings();
    for (const m of [...suites.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const tags = [...inferTags(cfbDir, m)];
      console.log(`${pad(m.id, 40)} floor ${lpad(m.floor, 5)}  ${pad(tags.join(','), 18)} ${m.isolate === 'tree' ? 'isolate:tree ' : ''}${fmtS(t[m.id] ?? m.expectedMs ?? 0)}`);
    }
    console.log(`\n${suites.size} suites`);
    return;
  }

  // what changed (affected tier only)
  let changedFiles = [];
  if (opts.tier === 'affected') {
    try { changedFiles = opts.changed || gitChanged(opts.base); } catch (e) { console.error(`testrun: ${e.message}`); process.exit(2); }
  }
  // W-22: a loadtest.mjs edit confined to section [1]'s import list (a module joining the [1] load) is not a reason for the full run
  const loadtestEdit = opts.tier === 'affected' && changedFiles.includes(LOADTEST) ? loadtestEditSince(opts.base, { changedGiven: !!opts.changed }) : null;

  let plan;
  try { plan = buildPlan(opts, { suites, depMap, changedFiles, loadtestEdit }); } catch (e) { console.error(`testrun: ${e.message}`); process.exit(2); }
  if (plan.stop) { for (const n of plan.note) console.error(`  ${n}`); printFallbackStop(plan.stop); process.exit(2); }   // M-42: before any slot, log or tripwire
  const { selected, zoneSelected, note } = plan;
  let tier = plan.tier;
  if (opts.tier === 'affected' && !changedFiles.length) note.push('no changes detected (working tree == HEAD, no --base): running the smoke set only — pass --base <integration branch> to include committed work');

  // the machine-wide full-run semaphore (a quick/affected run takes no slot)
  let lock = null;
  let otherFull = 0;
  if (tier === 'full' && !opts.noSlot) {
    const slotInfo = { cwd: root, tier };
    const dir = process.env.CFBP_TESTRUN_SLOT_DIR || undefined;
    const n = process.env.CFBP_TESTRUN_SLOTS ? Number(process.env.CFBP_TESTRUN_SLOTS) : undefined;
    lock = await slots.acquire({ dir, slots: n, info: slotInfo, onWait: (hs, ms) => console.log(`  … waiting for a full-run slot (${hs.map(h => `pid ${h.pid} in ${h.cwd}`).join('; ') || 'none visible'}) — ${Math.round(ms / 1000)} s`) });
    otherFull = slots.otherRuns({ dir, slots: n });
  }

  const cores = cpus().length;
  let jobs = opts.jobs || Math.max(1, cores - 1);
  if (!opts.jobs && otherFull > 0) jobs = Math.max(2, Math.ceil(jobs / (otherFull + 1)));   // share the CPUs with the other full run
  const browserJobs = Math.max(1, opts.browserJobs);

  // reviewer N4: which tree this run gates — HEAD and whether the checkout had uncommitted or untracked changes (captured BEFORE the run)
  let head = null, dirty = null;
  try { head = git(['rev-parse', 'HEAD'])[0] || null; dirty = git(['status', '--porcelain', '--untracked-files=normal']).length > 0; } catch { /* not a git checkout */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(opts.logDir || path.join(cacheDir(), `${stamp}-${process.pid}`));
  const logDir = path.join(runDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  mkdirSync(path.join(runDir, 'tmp'), { recursive: true });

  console.log(`testrun --${opts.tier}${tier !== opts.tier ? ` → ${tier}` : ''} · ${selected.length} suite(s)${opts.tz ? ` + ${zoneSelected.length} under TZ=${opts.tz}` : ''} · ${jobs} workers (browser ≤ ${browserJobs})${lock ? ` · slot ${lock.slot}${lock.waitedMs > 1000 ? ` after ${fmtS(lock.waitedMs)}` : ''}` : ''}`);
  for (const n of note) console.log(`  ${n}`);
  console.log(`  tree: ${head ? `HEAD ${head.slice(0, 10)}${dirty ? ' + UNCOMMITTED changes (a merge/deploy gate needs a clean, committed tree)' : ' (clean)'}` : 'not a git checkout'}`);
  console.log(`  logs: ${logDir}`);
  console.log(`  stop:  kill -TERM -${process.pid}   (this run ONLY: its runner, its suites and what they started. Never pkill/killall a name — it matches every agent's run)`);
  if (tier !== 'full') console.log(`  NOTE: this is a ${tier} run, NOT the full harness — nothing here replaces the full run a merge or deploy needs`);
  console.log('');

  // the tripwire: no file in the real checkout may change, and no entry may appear and vanish, while the suites run
  // warm-up / settle are test hooks (testruntest runs ~100 nested runners; the defaults are what real runs use)
  const watcher = watchTree(root, { warmupMs: Number(process.env.CFBP_TRIPWIRE_WARMUP_MS ?? 400), settleMs: Number(process.env.CFBP_TRIPWIRE_SETTLE_MS ?? 700) });
  await watcher.ready;
  const before = snapshotTree(root);
  const timings = readTimings();

  let pass = 0, fail = 0;
  const results = [];
  const timeoutLog = [];   // summary.json `timeouts`: every suite that hit its deadline in the parallel pass, and what its solo re-run did
  const timedOut = [];     // held back from the parallel pass for their solo re-run
  const done = new Set();  // task keys that produced a counted row (B1: after both pools, a planned task missing from here is a FAILURE)
  const crashes = new Map(); // task key → the error its run threw, so the red row can name it
  const wall0 = Date.now();
  const trace = opts.checkDeps ? path.join(runDir, 'reads') : null;
  if (trace) mkdirSync(trace, { recursive: true });
  const tzProbeDir = opts.checkTz ? path.join(runDir, 'tz-calls') : null;
  if (tzProbeDir) mkdirSync(tzProbeDir, { recursive: true });

  // one task per (suite, zone): the primary pass runs in the host's zone; the second-zone pass (--tz) re-runs the tz-tagged suites under opts.tz
  const mkTask = (m, zone) => {
    const key = zone ? `${m.id}@tz` : m.id;
    return { manifest: m, id: m.id, zone, key, label: zone ? `${m.id} @TZ=${zone}` : m.id, browser: m.tags.includes('browser'), expectedMs: timings[key] ?? m.expectedMs ?? (m.tags.includes('slow') ? 30000 : 2000) };
  };
  const primaryTasks = selected.map(m => mkTask(m, null));
  const zoneTasks = zoneSelected.map(m => mkTask(m, opts.tz));
  const tasks = [...primaryTasks, ...zoneTasks];   // every planned task: the completeness check below holds the run to all of them

  /** Run one suite once and evaluate it. Counts nothing: `finish` does, so a TIMEOUT in the parallel pass can be held back for its solo re-run. */
  const execute = async (task, { solo = false } = {}) => {
    const t0 = Date.now();
    const m = task.manifest;
    const tag = `${task.key.replace(/[^A-Za-z0-9_.-]+/g, '_')}${solo ? '.solo' : ''}`;
    const suiteTmp = path.join(runDir, 'tmp', tag);
    mkdirSync(suiteTmp, { recursive: true });
    let cwd = cfbDir;
    let clone = null;
    if (m.isolate === 'tree') {
      clone = path.join(runDir, 'trees', tag);
      cloneTree(root, clone);
      cwd = path.join(clone, path.relative(root, cfbDir));
    }
    assertNotDenied(m.script, m.args, { cwd });                                 // defence in depth: refused at spawn time too, on the REAL file
    // the second zone applies to the second-zone task only; a manifest's own env (a fixed-zone variant) still wins
    const env = { ...process.env, ...(task.zone ? { TZ: task.zone } : {}), ...m.env, TMPDIR: suiteTmp, TMP: suiteTmp, TEMP: suiteTmp, CFBP_TESTRUN: '1' };
    delete env[LAUNCHER_ENV];                                                  // a runner a suite starts (testruntest does) gets a group of its own too
    let nodeArgs = [m.script, ...m.args];
    if (tzProbeDir && !task.zone) { env.CFBP_TZPROBE_FILE = path.join(tzProbeDir, `${m.id}.jsonl`); env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--import=${pathToFileURL(path.join(cfbDir, 'tests', 'lib', 'tz-probe.mjs')).href}`; }
    if (trace) { env.CFBP_TRACE_FILE = path.join(trace, `${m.id}.txt`); env.CFBP_TRACE_ROOT = clone || root; nodeArgs = ['--import', path.join(cfbDir, 'tests', 'lib', 'trace-reads.mjs'), ...nodeArgs]; }
    const auditBefore = opts.auditWrites ? snapshotTree(root) : null;
    const rawPrefix = path.join(runDir, 'raw', tag);
    const res = await runChild({ args: nodeArgs, cwd, env, timeoutMs: m.timeoutMs, rawPrefix });
    if (auditBefore) {
      const wrote = diffSnapshots(auditBefore, snapshotTree(root));
      if (wrote.length) console.log(`   ✎ ${task.label} WROTE into the real tree${m.isolate === 'tree' ? ' (isolated: this should be empty)' : ''}: ${wrote.slice(0, 6).join('; ')}${wrote.length > 6 ? `; … ${wrote.length - 6} more` : ''}`);
    }
    const ev = m.kind === 'core' ? evaluateCore(m, res) : evaluateSuite(m, res);
    const checks = [...ev.checks, ...(await postChecks(m, { cwd, suiteTmp }))];
    const logFile = path.join(logDir, `${tag}.log`);
    writeFileSync(logFile, `# ${m.script} ${m.args.join(' ')}\n# exit ${res.status}${res.signal ? ' signal ' + res.signal : ''}${res.timedOut ? ' TIMED OUT' : ''} · ${fmtS(res.ms)} · cwd ${cwd}${env.TZ && (task.zone || m.env.TZ) ? ' · TZ=' + env.TZ : ''}${solo ? ' · SOLO RE-RUN after a TIMEOUT in the parallel pass' : ''}\n${ev.out}`);
    rmSync(`${rawPrefix}.out`, { force: true }); rmSync(`${rawPrefix}.err`, { force: true });          // their text is in the combined log now
    return { task, res, ev, checks, logFile, t0, suiteTmp, clone };
  };

  /** Count one evaluated run, print its line, keep (red) or clean (green) its scratch. `first` = the parallel-pass run that TIMED OUT. */
  const finish = (x, { first = null } = {}) => {
    const { task, res, ev, checks, logFile, t0, suiteTmp, clone } = x;
    const m = task.manifest;
    const okChecks = checks.filter(c => c.ok).length;
    const badChecks = checks.filter(c => !c.ok);
    if (m.kind === 'core') { pass += ev.counts.passed + okChecks; fail += ev.counts.failed + badChecks.length; }
    else { pass += okChecks; fail += badChecks.length; }
    const ok = badChecks.length === 0 && (m.kind !== 'core' || ev.counts.failed === 0);
    const r = { id: m.id, ...(task.zone ? { zone: task.zone } : {}), ...(m.env && m.env.TZ ? { fixedZone: m.env.TZ } : {}), ok, ms: res.ms, startMs: t0 - wall0, floor: m.floor, child: ev.child, checks: checks.length, failedChecks: badChecks.map(c => c.label), logFile, kind: m.kind, tags: m.tags, counts: ev.counts || null };
    if (first) {
      r.timeout = { deadlineMs: m.timeoutMs, firstMs: first.res.ms, firstLog: first.logFile, rerun: { ms: res.ms, ok, timedOut: !!res.timedOut, log: logFile } };
      timeoutLog.push({ id: m.id, ...(task.zone ? { zone: task.zone } : {}), deadlineMs: m.timeoutMs, firstMs: first.res.ms, rerunMs: res.ms, outcome: ok ? 'pass' : res.timedOut ? 'timeout' : 'fail' });
    }
    results.push(r);
    done.add(task.key);
    timings[task.key] = res.ms;
    const cnt = m.kind === 'core' ? `${lpad(ev.counts.passed, 5)} inline` : `${lpad(ev.child.passed ?? '—', 5)}/${pad(m.floor, 5)}`;
    const why = first ? `   (re-run ALONE after a TIMEOUT at ${fmtS(first.res.ms)} in the parallel pass${ok ? '' : res.timedOut ? ': the solo re-run TIMED OUT too' : ': the solo re-run FAILED'})` : '';
    console.log(` ${ok ? '✅' : '❌'} ${pad(task.label, 40)} ${cnt}  ${lpad(fmtS(res.ms), 7)}${why}${ok ? '' : '   ← FAILED'}`);
    if (!ok) {
      for (const c of badChecks.slice(0, 6)) console.log(`      ✗ ${c.label.replace(/\s+/g, ' ').slice(0, 260)}`);
      if (badChecks.length > 6) console.log(`      … ${badChecks.length - 6} more failed check(s)`);
      const failingLines = ev.out.split('\n').filter(l => /^\s*❌/.test(l)).slice(0, 12);
      for (const l of failingLines) console.log(`      │ ${l.trim().slice(0, 240)}`);
      if (!failingLines.length) for (const l of ev.out.trimEnd().split('\n').slice(-12)) console.log(`      │ ${l.slice(0, 240)}`);
      console.log(`      log: ${logFile}`);
    }
    // cleanup: a green suite leaves nothing behind; a red one keeps its tmp + tree for the post-mortem
    if (ok && !opts.keepTmp) { rmSync(suiteTmp, { recursive: true, force: true }); if (clone) rmSync(clone, { recursive: true, force: true }); }
  };

  // ── the parallel pass. A suite that hits its deadline here is a TIMEOUT, not yet a failure: under a loaded machine a slow suite can
  //    miss a deadline it meets alone. It is held back (nothing counted) and re-run ONCE, ALONE, after the pass; only that run counts.
  // The second-zone pass runs AFTER the primary pass, never inside it (2026-10-07): the primary pass keeps the load profile of a plain
  // --full, under which its Chromium frame-timing suites were proven. weekpagertest C-1 went red twice in the packed gate; no zone task
  // overlapped it (integration review N1). The cause was the measurement, not the packing (W-22, review N2): the incoming week is on screen for
  // ~45 ms of the 150 ms spring, two frames at 60 Hz, so one frame lost to load left one sample. C-1 now samples on the animation's own clock.
  const passes = opts.tz && primaryTasks.length && zoneTasks.length ? [primaryTasks, zoneTasks] : [tasks];
  const parallelRejected = [];
  for (const [i, group] of passes.entries()) {
    if (i > 0) console.log(`\n  second-zone pass (TZ=${opts.tz}): ${group.length} suite(s), after the primary pass…`);
    parallelRejected.push(...await runPool(group, {
    jobs, browserJobs,
    runOne: async task => {
      try {
        const x = await execute(task);
        if (x.res.timedOut) {
          timedOut.push({ ...task, first: x });
          console.log(` ⏱ ${pad(task.label, 40)} TIMEOUT ${lpad(fmtS(x.res.ms), 7)}   (deadline ${fmtS(task.manifest.timeoutMs)} in the parallel pass — re-run ALONE after it; FAIL only if that run fails or times out too)`);
          if (!opts.keepTmp) { rmSync(x.suiteTmp, { recursive: true, force: true }); if (x.clone) rmSync(x.clone, { recursive: true, force: true }); }
          return;
        }
        finish(x);
      } catch (e) { crashes.set(task.key, e); }
    },
    }));
  }
  for (const { item, error } of parallelRejected) if (!crashes.has(item.key)) crashes.set(item.key, error);

  // ── the solo re-runs: one at a time, nothing else running, the same deadline and every check unchanged
  if (timedOut.length) {
    console.log(`\n  ⏱ ${timedOut.length} suite(s) hit their deadline in the parallel pass — re-running each ALONE: ${timedOut.map(t => t.label).join(', ')}`);
    const soloRejected = await runPool(timedOut, { jobs: 1, browserJobs: 1, runOne: async t => {
      try { const x = await execute(t, { solo: true }); finish(x, { first: t.first }); } catch (e) { crashes.set(t.key, e); }
    } });
    for (const { item, error } of soloRejected) if (!crashes.has(item.key)) crashes.set(item.key, error);
  }

  // ── completeness (reviewer B1, 2026-10-07): EVERY planned task must have produced a counted row. A run that threw — a clone that could not
  //    be copied, a refusal at spawn time, a bug in this file — is a FAILURE that names its error, never a suite that silently drops out of a
  //    run that then reads ✅ ALL PASS.
  for (const task of tasks) {
    if (done.has(task.key)) continue;
    const err = crashes.get(task.key);
    const why = err ? `its run THREW: ${String((err && err.message) || err).split('\n')[0].slice(0, 300)}` : 'it produced no result';
    fail += 1;
    results.push({ id: task.id, ...(task.zone ? { zone: task.zone } : {}), ok: false, crashed: why, ms: 0, startMs: null, floor: task.manifest.floor, child: null, checks: 1, failedChecks: [`${task.label} was planned and ${why}`], logFile: null, kind: task.manifest.kind, tags: task.manifest.tags, counts: null });
    console.log(` ❌ ${pad(task.label, 40)} CRASHED            ← FAILED\n      ✗ ${task.label} was planned and ${why}`);
  }

  // tripwire verdict (failure-only: a clean tree adds nothing to the totals, so they stay comparable to the old harness)
  const events = await watcher.stop();
  const after = snapshotTree(root);
  const touched = diffSnapshots(before, after, events);
  if (touched.length) {
    fail += 1;
    console.log(`\n ❌ TRIPWIRE: the real checkout changed during the run (${touched.length} path(s)). A suite wrote into the tree it should only read — give it "isolate": "tree" in its manifest, or fix it.`);
    for (const t of touched.slice(0, 20)) console.log(`      ${t}`);
    if (touched.length > 20) console.log(`      … ${touched.length - 20} more`);
  }

  // orphan report (informational): test files nothing runs
  const orphans = tier === 'full' ? findOrphans(suites) : [];
  if (orphans.length) console.log(`\n  (info) ${orphans.length} test-shaped file(s) have no manifest and were not run: ${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? ', …' : ''}`);

  // (info) floors far below the live count: the ratchet is only as tight as the last person who raised it
  const slack = results.filter(r => r.kind !== 'core' && !r.zone && r.child && r.child.passed !== null && r.child.passed - r.floor > 0).sort((a, b) => (b.child.passed - b.floor) - (a.child.passed - a.floor));
  if (tier === 'full' && slack.length) console.log(`\n  (info) ${slack.length} suite(s) run above their floor — raise the floor to the count when you add assertions: ${slack.slice(0, 5).map(r => `${r.id} ${r.floor}→${r.child.passed}`).join(', ')}${slack.length > 5 ? ', …' : ''}`);

  const wallMs = Date.now() - wall0;
  const sumMs = results.reduce((a, r) => a + r.ms, 0);
  writeTimings(timings);
  const summary = { tier, requested: opts.tier, tz: opts.tz || null, head, dirty, passed: pass, failed: fail, wallMs, sumSuiteMs: sumMs, jobs, suites: results.sort((a, b) => a.id.localeCompare(b.id) || String(a.zone || '').localeCompare(String(b.zone || ''))), timeouts: timeoutLog, tripwire: touched };
  try { writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 1)); } catch { /* best effort */ }
  if (!opts.keepTmp && fail === 0) { try { rmSync(path.join(runDir, 'tmp'), { recursive: true, force: true }); rmSync(path.join(runDir, 'trees'), { recursive: true, force: true }); } catch { /* best effort */ } }

  if (timeoutLog.length) console.log(`\n  ⏱ TIMEOUT in the parallel pass, re-run alone: ${timeoutLog.map(t => `${t.id}${t.zone ? ` @TZ=${t.zone}` : ''} → ${t.outcome === 'pass' ? 'PASS' : t.outcome === 'timeout' ? 'FAIL (timed out again)' : 'FAIL'} (${fmtS(t.firstMs)} → ${fmtS(t.rerunMs)} alone)`).join(', ')}`);
  console.log(`\n  tier ${tier}${opts.tz ? ` + TZ=${opts.tz} pass` : ''} · ${results.length} suite(s) · wall ${fmtS(wallMs)} · sum of suites ${fmtS(sumMs)} (×${(sumMs / Math.max(1, wallMs)).toFixed(1)}) · summary: ${path.join(runDir, 'summary.json')}`);
  if (opts.checkTz) fail += checkTz({ results, dir: tzProbeDir });
  if (opts.checkDeps) {
    const miss = checkDeps({ depMap: buildDepMap({ root, cfbDir, suites }), results, trace });
    if (miss > 0) { fail += miss; }
  }
  // today's exact final line
  console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
  if (lock) slots.release(lock);
  process.exit(fail === 0 ? 0 : 1);
}

function findOrphans(suites) {
  const have = new Set([...suites.values()].map(m => m.script));
  const found = [];
  const scan = (dir, rel) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'tests' && rel === '') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (['supabase', 'supabase/tests', 'supabase/tests/functions'].includes(r) || r === 'supabase') scan(path.join(dir, e.name), r); continue; }
      if (/(test|\.twin|\.check)\.mjs$|^(grouptest|atstest|synctest)\.mjs$/.test(e.name) && !have.has(r) && !denied(r)) found.push(r);
    }
  };
  scan(cfbDir, '');
  return found.sort();
}

/**
 * --check-tz (reviewer N2): compare what every suite's processes really called (tests/lib/tz-probe.mjs) with its `tz` tag. A suite that
 * called a zone-dependent Date/Intl API and is NOT tagged tz is a failure (the second-zone pass would skip it). A tagged suite that made no
 * such call in Node is reported (info): it may render dates in Chromium, which the probe cannot see. A fixed-zone manifest is exempt.
 */
function checkTz({ results, dir }) {
  let untagged = 0;
  const idle = [];
  console.log('\n  time-zone check (zone-dependent Date/Intl calls vs the tz tag):');
  for (const r of results) {
    if (r.zone || r.crashed) continue;
    const f = path.join(dir, `${r.id}.jsonl`);
    const counts = {};
    if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) { try { for (const [k, v] of Object.entries(JSON.parse(l).counts || {})) counts[k] = (counts[k] || 0) + v; } catch { /* a torn line */ } }
    const calls = Object.values(counts).reduce((a, b) => a + b, 0);
    const tagged = (r.tags || []).includes('tz');
    const fixed = r.fixedZone;
    if (calls && !tagged && !fixed) { untagged += 1; console.log(`   ❌ ${r.id} made ${calls} zone-dependent call(s) but is not tagged tz: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ×${v}`).join(', ')}`); }
    else if (!calls && tagged) idle.push(r.id);
  }
  if (idle.length) console.log(`   (info) tagged tz but no zone-dependent call in Node (Chromium is not probed): ${idle.join(', ')}`);
  if (!untagged) console.log('   ✅ every suite that called a zone-dependent API is tagged tz');
  return untagged;
}

/** --check-deps: compare what every suite really read (traced) with what the static map says it depends on. */
function checkDeps({ depMap, results, trace }) {
  let missing = 0;
  console.log('\n  dependency-map check (traced reads vs static map):');
  const exists = rel => existsSync(path.join(root, rel));
  const isDir = rel => { try { return statSync(path.join(root, rel)).isDirectory(); } catch { return false; } };
  for (const r of results) {
    const f = path.join(trace, `${r.id}.txt`);
    if (!existsSync(f)) continue;
    const dep = depMap.get(r.id);
    if (!dep) continue;
    const traced = [...new Set(readFileSync(f, 'utf8').split('\n').filter(Boolean))];
    const missed = missedByMap({ traced, dep, exists, isDir, scope: path.relative(root, cfbDir).split(path.sep).join('/') });
    if (missed.length) { missing += 1; console.log(`   ❌ ${r.id} read ${missed.length} path(s) the map does not list: ${missed.slice(0, 8).join(', ')}${missed.length > 8 ? ', …' : ''}`); }
  }
  if (!missing) console.log('   ✅ every file any suite read is in its static dependency set');
  return missing;
}

/** Set by the launcher on the run it starts: the launcher's pid. A run whose parent is that pid leads its own group (it was started detached). */
const LAUNCHER_ENV = 'CFBP_TESTRUN_LAUNCHER';

/**
 * The launcher (W-22): start this same command as a run in a FRESH SESSION — `detached` is setsid(), so the run leads a process group that
 * holds nothing but itself, its suites and what they launch — then forward Ctrl-C / SIGTERM / SIGHUP to that group, wait, and pass the run's
 * exit status on. If the run itself was killed outright (no handler ran), whatever it left in its group is killed too.
 */
function launch(argv) {
  return new Promise(() => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', detached: true, env: { ...process.env, [LAUNCHER_ENV]: String(process.pid) } });
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { process.kill(-child.pid, sig); } catch { /* the run is already gone */ } });
    child.on('error', e => { console.error(`testrun: could not start the run: ${e.message}`); process.exit(2); });
    child.on('exit', (code, signal) => {
      if (signal) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* nothing was left in its group */ } }
      process.exit(code ?? 128 + (osConstants.signals[signal] || 0));
    });
  });
}

/** The run (W-22): if the launcher that started it is gone (killed outright: its caller was stopped), stop this run — its own group, nothing else. */
function watchLauncher(launcherPid) {
  const t = setInterval(() => {
    if (process.ppid === launcherPid) return;
    try { console.log('\n  ✋ the process that started this run is gone — stopping this run (its own process group, nothing else)'); } catch { /* no reader left */ }
    process.exit(130);                                                            // the exit hook (exec.mjs) sweeps the run's group
  }, 500);
  t.unref();
}

// run only as the entry point (real paths: a tmp dir under /var is a symlink to /private/var, and a plain string compare would never match there)
const isEntry = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isEntry) await main(process.argv.slice(2));
