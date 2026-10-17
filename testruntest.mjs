#!/usr/bin/env node
/**
 * testruntest.mjs — the tiered runner's own self-test, with mutation proofs.
 *
 * A test runner that cannot fail is the worst kind of green. Every property the runner is trusted for is proved
 * here against FIXTURE suites (tiny scripts in a throwaway repo laid out like this one), and every one of those
 * proofs is itself mutation-tested: the runner's source is copied to a scratch directory, ONE line of it is broken
 * (the floor comparison, the exit-code check, the timeout, the denylist, the tripwire, …), and the same case is run
 * against the broken copy — it MUST go red, and the unbroken copy must be green. Mutants only ever touch scratch
 * copies; this checkout is never written (CLAUDE.md: never git checkout/restore/stash to undo a mutation).
 *
 * Run:   node testruntest.mjs                  everything (cases, then the mutation battery)
 *        node testruntest.mjs --case <name>    one case (what the mutation battery runs against each mutant)
 *        node testruntest.mjs --root <dir>     test the runner found in <dir> (a cfb-pickems-shaped tree) instead of this one
 *        node testruntest.mjs --no-mutants     cases only
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, cpSync, utimesSync, statSync, chmodSync, symlinkSync, linkSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir, cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const ROOT = path.resolve(argOf('--root') || here);          // the runner under test
const ONLY = argOf('--case');
const NO_MUTANTS = argv.includes('--no-mutants') || !!ONLY;
const REAL = here;                                            // the real repo's cfb-pickems/ (real-manifest checks always use it)

let pass = 0, fail = 0;
function assert(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail !== undefined ? `— ${detail}` : ''); }
}
const lib = n => import(pathToFileURL(path.join(ROOT, 'tests', 'lib', n)).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cases = [];
const testCase = (name, fn) => cases.push({ name, fn });

// ── fixture repo ───────────────────────────────────────────────────────────────────────────────
const SUMMARY_OK = n => `console.log('✅ ALL PASS — ${n} passed, 0 failed');`;
const CORE_STUB = `console.log('✅ ALL PASS — 7 passed, 0 failed');\n`;
const tmpRoots = [];

/**
 * A throwaway repo shaped like this one: <root>/cfb-pickems/{testrun.mjs, tests/lib, tests/suites, loadtest.mjs, …}.
 * `suites`: id → manifest fields (id/script/summary/floor defaulted); `files`: path (relative to cfb-pickems/) → text.
 */
function fixture({ suites = {}, files = {}, loadtest = CORE_STUB, core = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'testruntest-'));
  tmpRoots.push(root);
  const cfb = path.join(root, 'cfb-pickems');
  mkdirSync(path.join(cfb, 'tests', 'lib'), { recursive: true });
  mkdirSync(path.join(cfb, 'tests', 'suites'), { recursive: true });
  writeFileSync(path.join(cfb, 'testrun.mjs'), readFileSync(path.join(ROOT, 'testrun.mjs')));
  for (const f of readdirSync(path.join(ROOT, 'tests', 'lib'))) writeFileSync(path.join(cfb, 'tests', 'lib', f), readFileSync(path.join(ROOT, 'tests', 'lib', f)));
  writeFileSync(path.join(cfb, 'loadtest.mjs'), loadtest);
  const all = { ...suites };
  if (core) {
    all.core = { kind: 'core', script: 'loadtest.mjs', summary: 'strict', floor: 0, env: { CFBP_CORE: 'full' }, ...(suites.core || {}) };
    all['core-load'] = { kind: 'core', script: 'loadtest.mjs', summary: 'strict', floor: 0, env: { CFBP_CORE: 'load' }, tags: ['quick'], ...(suites['core-load'] || {}) };
  }
  for (const [id, m] of Object.entries(all)) {
    const manifest = { id, script: m.script || `${id}.mjs`, summary: 'strict', floor: 1, ...m };
    writeFileSync(path.join(cfb, 'tests', 'suites', `${id}.json`), JSON.stringify(manifest, null, 1));
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(cfb, rel)), { recursive: true });
    writeFileSync(path.join(cfb, rel), text);
  }
  // everything the runner and the fixture suites write lives OUTSIDE the fixture root, exactly as it does in the real repo
  // (the runner's logs are under os.tmpdir(), never in the checkout) — otherwise the tripwire would fire on the fixture's own bookkeeping
  const aux = mkdtempSync(path.join(tmpdir(), 'testruntest-aux-'));
  tmpRoots.push(aux);
  const slotDir = path.join(aux, 'slots');
  const fxLog = path.join(aux, 'events.log');
  writeFileSync(fxLog, '');
  // the tripwire's watcher warm-up/settle default to 0 in fixtures (≈1.1 s per nested run otherwise); the tripwire cases turn them on
  const env = (extra = {}) => ({ ...process.env, TMPDIR: path.join(aux, 'tmp'), CFBP_TESTRUN_SLOT_DIR: slotDir, FX_LOG: fxLog, CFBP_TRIPWIRE_WARMUP_MS: '0', CFBP_TRIPWIRE_SETTLE_MS: '0', ...extra });
  mkdirSync(path.join(aux, 'tmp'), { recursive: true });
  return {
    root, cfb, aux, slotDir, fxLog, env,
    run(args, extraEnv = {}, timeout = 60000) {
      const r = spawnSync(process.execPath, [path.join(cfb, 'testrun.mjs'), ...args], { cwd: cfb, env: env(extraEnv), encoding: 'utf8', timeout });
      const out = (r.stdout || '') + (r.stderr || '');
      const last = [...out.matchAll(/(✅ ALL PASS|❌ FAILURES) — (\d+) passed, (\d+) failed/g)].pop();
      return { status: r.status, out, verdict: last ? last[1] : null, passed: last ? Number(last[2]) : null, failed: last ? Number(last[3]) : null, signal: r.signal };
    },
    /** Start a run WITHOUT waiting for it (W-22: two runs at once). `proc` is the process the caller started; `done` resolves when it exits. */
    start(args, extraEnv = {}) {
      const c = spawn(process.execPath, [path.join(cfb, 'testrun.mjs'), ...args], { cwd: cfb, env: env(extraEnv), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
      const done = new Promise(resolve => c.on('close', (status, signal) => resolve({ status, signal, out })));
      return { proc: c, out: () => out, done };
    },
    events() { return readFileSync(fxLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); },
    cleanup() { rmSync(root, { recursive: true, force: true }); rmSync(aux, { recursive: true, force: true }); },
  };
}

/** A fixture suite that logs start/end, sleeps, then prints a summary line. */
const evSuite = (id, ms, { n = 5, summary = null, pre = '', post = '' } = {}) => `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FX_LOG, JSON.stringify({ id: '${id}', ev: 'start', t: Date.now(), tmp: process.env.TMPDIR, cwd: process.cwd() }) + '\\n');
${pre}
await new Promise(r => setTimeout(r, ${ms}));
${post}
appendFileSync(process.env.FX_LOG, JSON.stringify({ id: '${id}', ev: 'end', t: Date.now() }) + '\\n');
${summary || SUMMARY_OK(n)}
`;

/**
 * A core stub shaped like the real loadtest.mjs around section [1] (W-22): a header line, the import list (`for (const m of ['a',` …
 * `]) {`), the loop, then the rest of the core. It logs which core ran (`core:full` / `core:load`) to FX_LOG.
 */
const coreWithList = ({ entries = [], before = '', after = '' } = {}) => [
  `import { appendFileSync } from 'node:fs';`,
  `if (process.env.FX_LOG) appendFileSync(process.env.FX_LOG, JSON.stringify({ id: 'core:' + (process.env.CFBP_CORE || 'bare'), ev: 'start', t: Date.now() }) + '\\n');`,
  before,
  `console.log('\\n[1] Importing all modules…');`,
  `const mods = {};`,
  `for (const m of ['a',`,
  ...entries,
  `]) {`,
  '  try { mods[m] = await import(`./js/${m}.js`); } catch { /* fixture stand-ins */ }',
  `}`,
  after,
  `console.log('✅ ALL PASS — 7 passed, 0 failed');`,
  ``,
].join('\n');

function maxConcurrency(events, ids = null) {
  const pts = [];
  for (const e of events) if (!ids || ids.includes(e.id)) pts.push([e.t, e.ev === 'start' ? 1 : -1]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0;
  for (const [, d] of pts) { cur += d; max = Math.max(max, cur); }
  return max;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// A. The evaluator — the legacy per-suite assertions, same arithmetic
// ════════════════════════════════════════════════════════════════════════════════════════════
const OKRESULT = (stdout, over = {}) => ({ status: 0, signal: null, error: null, timedOut: false, stdout, stderr: '', ...over });
const MAN = (over = {}) => ({ id: 'x', script: 'x.mjs', args: [], summary: 'strict', floor: 5, forbid: [], post: [], timeoutMs: 1000, ...over });

testCase('evaluate-arithmetic', async () => {
  const { evaluateSuite } = await lib('evaluate.mjs');
  const n = (summary, out, extra = {}) => evaluateSuite(MAN({ summary, ...extra }), OKRESULT(out)).checks.length;
  assert(n('strict', '✅ ALL PASS — 9 passed, 0 failed') === 5, 'strict = 5 assertions (exit 0, summary printed, ALL PASS, zero failed, floor) — the legacy block\'s own count');
  assert(n('strict-combined', '✅ ALL PASS — 9 passed, 0 failed') === 4, 'strict-combined = 4 (ALL PASS and zero-failed were ONE assertion)');
  assert(n('strict-noverdict', '✅ ALL PASS — 9 passed, 0 failed') === 4, 'strict-noverdict = 4');
  assert(n('loose', '9 passed, 0 failed') === 4, 'loose = 4');
  assert(n('loose-skips', '9 passed, 0 failed, 0 skipped') === 5, 'loose-skips = 5 (+ no skips)');
  assert(n('strict-single', '✅ ALL PASS — 9 passed, 0 failed') === 2, 'strict-single = 2 (exit 0, and ONE assertion for summary + ALL PASS + zero failed + floor — the fixed-zone [125b] block\'s own count)');
  assert(n('loose', '9 passed, 0 failed', { forbid: [{ regex: 'ERR_MODULE_NOT_FOUND', label: 'x' }] }) === 5, 'a forbid entry adds exactly one assertion');
  assert(n('strict', 'no summary here') === 2, 'no summary line: only exit + "summary printed" are asserted (the legacy `if (m)` guard) — and the second fails');
  const green = evaluateSuite(MAN(), OKRESULT('✅ ALL PASS — 9 passed, 0 failed'));
  assert(green.checks.every(c => c.ok) && green.child.passed === 9 && green.child.failed === 0, 'a green suite: every check ok, child counts parsed');
});

testCase('evaluate-single', async () => {
  // The [125b] shape (2026-10-07 landing): a fixed-zone re-run whose block asserted "summary printed AND ALL PASS AND zero failed AND floor" as ONE
  // assertion. The runner makes ONE check for all four conditions (the legacy arithmetic) — and every one of the four can still fail it.
  const { evaluateSuite } = await lib('evaluate.mjs');
  const ev = (out, over = {}) => evaluateSuite(MAN({ summary: 'strict-single', floor: 5, env: { TZ: 'America/Los_Angeles' }, ...over }), OKRESULT(out));
  const g = ev('✅ ALL PASS — 9 passed, 0 failed');
  assert(g.checks.length === 2 && g.checks.every(c => c.ok) && g.child.passed === 9 && g.child.failed === 0, 'strict-single on a green run: exactly two checks (exit 0 + the one combined assertion), both ok, the counts parsed');
  assert(/^x\.mjs \(TZ=America\/Los_Angeles\) exits 0/.test(g.checks[0].label) && /^x\.mjs \(TZ=America\/Los_Angeles\) reports ✅ ALL PASS with zero failed and at least its floor 5/.test(g.checks[1].label),
    'a fixed-zone manifest is named the way its legacy block named it (`x.mjs (TZ=America/Los_Angeles) …`)', g.checks.map(c => c.label).join(' | '));
  const below = ev('✅ ALL PASS — 4 passed, 0 failed');
  assert(below.checks.length === 2 && below.checks[0].ok && !below.checks[1].ok, 'below the floor: the combined check FAILS (the floor is one of its four conditions)');
  const failed = ev('❌ FAILURES — 9 passed, 1 failed');
  assert(failed.checks.length === 2 && !failed.checks[1].ok, 'a failed assertion inside the suite: the combined check FAILS');
  const verdict = ev('❌ FAILURES — 9 passed, 0 failed');
  assert(verdict.checks.length === 2 && !verdict.checks[1].ok, 'a ❌ verdict with zero failed: the combined check FAILS (the verdict is checked, not only the count)');
  const none = ev('no summary here');
  assert(none.checks.length === 2 && !none.checks[1].ok && /no summary line/.test(none.checks[1].label), 'no summary line: still two checks, and the second FAILS (never vacuous)');
  const plain = evaluateSuite(MAN(), OKRESULT('✅ ALL PASS — 9 passed, 0 failed'));
  assert(/^x\.mjs exits 0/.test(plain.checks[0].label), 'a manifest without env.TZ keeps the bare script name');
});

testCase('evaluate-below-floor', async () => {
  const { evaluateSuite } = await lib('evaluate.mjs');
  const r = evaluateSuite(MAN({ floor: 10 }), OKRESULT('✅ ALL PASS — 9 passed, 0 failed'));
  assert(r.checks.filter(c => !c.ok).length === 1 && /full set/.test(r.checks.find(c => !c.ok).label), 'a count below the floor fails exactly the floor assertion');
  const eq = evaluateSuite(MAN({ floor: 9 }), OKRESULT('✅ ALL PASS — 9 passed, 0 failed'));
  assert(eq.checks.every(c => c.ok), 'a count AT the floor passes (>=, the ratchet allows equal)');
});

testCase('evaluate-missing-summary', async () => {
  const { evaluateSuite } = await lib('evaluate.mjs');
  const r = evaluateSuite(MAN(), OKRESULT('lots of output but no summary line'));
  assert(r.checks.some(c => !c.ok && /summary line/.test(c.label)), 'a suite that prints no summary line FAILS (a summary-less run would make every other check vacuous)');
});

testCase('evaluate-crash-and-exit', async () => {
  const { evaluateSuite } = await lib('evaluate.mjs');
  const crash = evaluateSuite(MAN(), { status: 1, signal: null, error: null, timedOut: false, stdout: '', stderr: 'Error: boom\n    at x' });
  assert(crash.checks.some(c => !c.ok && /exits 0/.test(c.label)), 'a non-zero exit fails the exit assertion');
  const sig = evaluateSuite(MAN(), { status: null, signal: 'SIGSEGV', error: null, timedOut: false, stdout: '', stderr: '' });
  assert(sig.checks.some(c => !c.ok && /SIGSEGV/.test(c.label)), 'a signal-killed child fails, naming the signal');
  const flagged = evaluateSuite(MAN(), OKRESULT('✅ ALL PASS — 9 passed, 0 failed', { error: new Error('output exceeded 64 MiB') }));
  assert(flagged.checks.some(c => !c.ok && /exits 0/.test(c.label)), 'a runner-flagged error (a runaway output, a spawn failure) fails the suite even with a clean exit code and a green summary');
  const exitButGreenText = evaluateSuite(MAN(), OKRESULT('✅ ALL PASS — 9 passed, 0 failed', { status: 3 }));
  assert(exitButGreenText.checks.some(c => !c.ok && /exits 0/.test(c.label)), 'a green-looking summary does NOT excuse a non-zero exit');
});

testCase('evaluate-timeout', async () => {
  const { evaluateSuite } = await lib('evaluate.mjs');
  const r = evaluateSuite(MAN({ timeoutMs: 1500 }), { status: null, signal: 'SIGKILL', error: null, timedOut: true, stdout: '✅ ALL PASS — 9 passed, 0 failed', stderr: '' });
  assert(r.checks.some(c => !c.ok && /TIMED OUT after 1500/.test(c.label)), 'a timeout fails, and says so');
});

testCase('evaluate-forbid', async () => {
  const { evaluateSuite } = await lib('evaluate.mjs');
  const m = MAN({ forbid: [{ regex: 'ERR_MODULE_NOT_FOUND', flags: '', label: 'resolves its whole module graph' }] });
  const bad = evaluateSuite(m, OKRESULT('✅ ALL PASS — 9 passed, 0 failed\nError [ERR_MODULE_NOT_FOUND]: x'));
  assert(bad.checks.some(c => !c.ok && /module graph/.test(c.label)), 'forbidden text in the output fails its assertion even when the summary is green');
});

testCase('evaluate-skips-and-failed', async () => {
  const { evaluateSuite } = await lib('evaluate.mjs');
  const sk = evaluateSuite(MAN({ summary: 'loose-skips' }), OKRESULT('9 passed, 0 failed, 2 skipped'));
  assert(sk.checks.some(c => !c.ok && /NO skips/.test(c.label)), 'a skip reappearing fails (adaptertest\'s rule)');
  const f = evaluateSuite(MAN(), OKRESULT('❌ FAILURES — 9 passed, 2 failed'));
  assert(f.checks.filter(c => !c.ok).length === 2, 'a failing suite fails BOTH its verdict and its zero-failed assertion');
  const core = (await lib('evaluate.mjs')).evaluateCore(MAN({ kind: 'core', floor: 0 }), OKRESULT('✅ ALL PASS — 12 passed, 0 failed'));
  assert(core.counts.passed === 12 && core.checks.length === 0, 'the core suite contributes its own counts, with no per-suite meta-assertions');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// B. Manifests and the hard denylist
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('manifest-schema', async () => {
  const { validateManifest } = await lib('manifest.mjs');
  const ok = { id: 'a', script: 'a.mjs', summary: 'strict', floor: 3 };
  assert(validateManifest(ok, 'a.json', { checkExists: false }).length === 0, 'a minimal manifest validates');
  assert(validateManifest({ ...ok, flor: 3 }, 'a.json', { checkExists: false }).some(e => /unknown key "flor"/.test(e)), 'a typo\'d key is an ERROR (it would silently drop the ratchet)');
  assert(validateManifest({ ...ok, id: 'b' }, 'a.json', { checkExists: false }).some(e => /"id" must equal the file name/.test(e)), 'id must equal the file name');
  assert(validateManifest({ ...ok, script: '../x.mjs' }, 'a.json', { checkExists: false }).some(e => /inside cfb-pickems/.test(e)), 'a script path may not escape cfb-pickems/');
  assert(validateManifest({ ...ok, floor: -1 }, 'a.json', { checkExists: false }).some(e => /floor/.test(e)), 'the floor is a non-negative integer');
  assert(validateManifest({ ...ok, tags: ['quik'] }, 'a.json', { checkExists: false }).some(e => /unknown tag/.test(e)), 'an unknown tag is an error');
  assert(validateManifest({ ...ok, summary: 'nope' }, 'a.json', { checkExists: false }).some(e => /summary/.test(e)), 'an unknown summary preset is an error');
  assert(validateManifest(ok, 'a.json', { cfbDir: tmpdir() }).some(e => /does not exist/.test(e)), 'a manifest naming a missing script is an error');
  assert(validateManifest({ ...ok, tags: ['tz', 'quick'] }, 'a.json', { checkExists: false }).length === 0, 'the tz tag is a known tag (date/time-sensitive: the second-zone pass runs these)');
  assert(validateManifest({ ...ok, tags: ['tz'], env: { TZ: 'America/Los_Angeles' } }, 'a.json', { checkExists: false }).some(e => /fixed-zone manifest/.test(e)), 'a fixed-zone manifest (env.TZ) cannot ALSO be tagged tz (the second zone would not reach it)');
  // M-43 (D-76): "affectedByDepsOnly" — its own errors, never the closed schema's "unknown key" (which would pass these vacuously)
  const heldOk = { id: 'testruntest', script: 'testruntest.mjs', summary: 'strict', floor: 3, deps: ['x/**'], affectedByDepsOnly: true };
  const heldErrs = (over, file = 'testruntest.json', o = { checkExists: false }) => validateManifest({ ...heldOk, ...over }, file, o);
  const held = (over, re, file, o) => heldErrs(over, file, o).some(e => re.test(e) && /affectedByDepsOnly/.test(e) && !/unknown key/.test(e));
  assert(heldErrs({ tags: ['slow'] }).length === 0, 'affectedByDepsOnly on testruntest, with non-empty deps, validates (D-76)');
  assert(held({ affectedByDepsOnly: 'yes' }, /true or false/), 'affectedByDepsOnly must be a boolean');
  assert(held({ deps: [] }, /deps/), 'affectedByDepsOnly needs non-empty deps (they are the only files that select it in --affected)');
  for (const t of ['smoke', 'quick']) assert(held({ tags: [t] }, new RegExp(t)), `affectedByDepsOnly cannot be tagged ${t} (the ${t} set runs on every ${t === 'smoke' ? '--affected' : '--quick'} run, whatever changed)`);
  // B1 (review, 2026-10-14): one manifest line must not be able to shrink --affected for an app suite. The reviewer's probe: picksviewtest held
  // to its own script validated, and was then held back for the app diffs it tests
  assert(held({ id: 'picksviewtest', script: 'picksviewtest.mjs', deps: ['picksviewtest.mjs'] }, /only on testruntest/, 'picksviewtest.json'), '(B1) affectedByDepsOnly on any suite but testruntest is refused (D-76 names testruntest alone)');
  // B1: a held dep that matches no file (a typo such as testrun.mj) would hold the suite back from the very file it meant
  const sch = mkdtempSync(path.join(tmpdir(), 'testruntest-schema-'));
  tmpRoots.push(sch);
  mkdirSync(path.join(sch, 'cfb-pickems', 'x'), { recursive: true });
  writeFileSync(path.join(sch, 'cfb-pickems', 'testruntest.mjs'), '');
  writeFileSync(path.join(sch, 'cfb-pickems', 'x', 'y.js'), '');
  const onDisk = { checkExists: true, cfbDir: path.join(sch, 'cfb-pickems') };
  assert(heldErrs({}, 'testruntest.json', onDisk).length === 0, '(B1) control: held deps that match files validate against the checkout', JSON.stringify(heldErrs({}, 'testruntest.json', onDisk)));
  assert(held({ deps: ['x/**', 'testrun.mj'] }, /testrun\.mj\b.*matches no file/, 'testruntest.json', onDisk), '(B1) a held dep that matches no file is refused, naming it', JSON.stringify(heldErrs({ deps: ['x/**', 'testrun.mj'] }, 'testruntest.json', onDisk)));
});

testCase('denylist-unit', async () => {
  const { denied, assertNotDenied, DENYLIST } = await lib('manifest.mjs');
  assert(['rls.test.mjs', 'import-backup.mjs', 'export-sheet.mjs', 'projectiontest.mjs'].every(f => DENYLIST.includes(f)) && DENYLIST.length === 4, 'the denylist is exactly the four credential-loading scripts');
  for (const p of ['rls.test.mjs', 'supabase/tests/rls.test.mjs', './supabase/tests/./rls.test.mjs', 'a/b/../import-backup.mjs', 'x/export-sheet.mjs', 'projectiontest.mjs', 'RLS.TEST.MJS', 'Projectiontest.MJS']) {
    assert(denied(p), `denied(${JSON.stringify(p)}) — normalised, case-insensitive (APFS would run RLS.TEST.MJS as rls.test.mjs)`);
  }
  assert(!denied('rls.test.mjs.bak') && !denied('hometest.mjs') && !denied('supabase/tests/static.check.mjs'), 'ordinary suites are not denied');
  let threw = false; try { assertNotDenied('ok.mjs', ['--file', 'x/projectiontest.mjs']); } catch { threw = true; }
  assert(threw, 'a denied script named in ARGS is refused too');
});

testCase('denylist-cli', async () => {
  for (const [label, manifest, args] of [
    ['script rls.test.mjs', { script: 'supabase/tests/rls.test.mjs' }, ['--full']],
    ['script ./x/../projectiontest.mjs', { script: './x/../projectiontest.mjs' }, ['--full']],
    ['arg import-backup.mjs', { script: 'ok.mjs', args: ['../import-backup.mjs'] }, ['--full']],
  ]) {
    const fx = fixture({ suites: { evil: { ...manifest, floor: 1 } }, files: {
      'supabase/tests/rls.test.mjs': `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.FX_LOG + '.MARKER', 'ran'); ${SUMMARY_OK(5)}`,
      'projectiontest.mjs': `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.FX_LOG + '.MARKER', 'ran'); ${SUMMARY_OK(5)}`,
      'ok.mjs': `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.FX_LOG + '.MARKER', 'ran'); ${SUMMARY_OK(5)}`,
    } });
    const r = fx.run(args);
    assert(r.status === 2 && /denylist|REFUSED/.test(r.out), `a manifest with ${label} is REFUSED at load (exit 2): ${r.status}`, r.out.slice(0, 300));
    assert(!existsSync(fx.fxLog + '.MARKER'), `…and the denied script was never executed (${label})`);
    fx.cleanup();
  }
  const fx = fixture({ suites: { fine: { floor: 1 } }, files: { 'fine.mjs': SUMMARY_OK(5), 'projectiontest.mjs': `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.FX_LOG + '.MARKER', 'ran'); ${SUMMARY_OK(5)}` } });
  for (const id of ['projectiontest', 'rls.test', 'import-backup', 'export-sheet', 'PROJECTIONTEST']) {
    const r = fx.run(['--only', id]);
    assert(r.status === 2 && /denylist|REFUSED/.test(r.out), `--only ${id} is REFUSED (exit 2)`);
  }
  assert(!existsSync(fx.fxLog + '.MARKER'), '…and nothing was executed for any of them');
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// C. The runner, end to end, on fixture suites
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('runner-green', async () => {
  const fx = fixture({
    suites: { s1: { floor: 5 }, s2: { script: 's2.mjs', summary: 'loose', floor: 3 } },
    files: { 's1.mjs': SUMMARY_OK(5), 's2.mjs': `console.log('3 passed, 0 failed');` },
  });
  const r = fx.run(['--full']);
  assert(r.status === 0 && r.verdict === '✅ ALL PASS', 'an all-green sweep exits 0 and ends `✅ ALL PASS`', r.out.slice(-300));
  assert(r.passed === 7 + 5 + 4 && r.failed === 0, `the total is exactly the legacy arithmetic: core 7 + strict suite 5 + loose suite 4 = 16 (got ${r.passed})`);
  assert(/^══════════════════════════════════════════════════\n✅ ALL PASS — 16 passed, 0 failed\n$/m.test(r.out), 'the last lines are today\'s exact format (50-char bar, then `✅ ALL PASS — N passed, M failed`)');
  assert(r.out.trimEnd().split('\n').pop() === '✅ ALL PASS — 16 passed, 0 failed', 'the final line IS the verdict line');
  assert(/ ✅ s1 /.test(r.out) && / ✅ s2 /.test(r.out) && / ✅ core /.test(r.out), 'one line per suite');
  fx.cleanup();
});

testCase('runner-failing-suite', async () => {
  const fx = fixture({ suites: { bad: { floor: 3 }, good: { floor: 3 } }, files: {
    'bad.mjs': `console.log('❌ FAILURES — 4 passed, 1 failed'); console.log('  ❌ the assertion that broke'); process.exit(1);`,
    'good.mjs': SUMMARY_OK(5),
  } });
  const r = fx.run(['--full']);
  assert(r.status === 1 && r.verdict === '❌ FAILURES', 'one failing suite turns the whole run red (exit 1, ❌ FAILURES)', r.out.slice(-200));
  assert(r.failed === 3, `…with the legacy failure count (exit, verdict, zero-failed = 3, got ${r.failed})`);
  assert(/❌ bad /.test(r.out) && /the assertion that broke/.test(r.out) && /log: /.test(r.out), 'a failure prints its detail: the suite\'s own ❌ lines and the log path');
  assert(/ ✅ good /.test(r.out), '…while the passing suite stays one compact line');
  fx.cleanup();
});

testCase('runner-below-floor', async () => {
  const fx = fixture({ suites: { thin: { floor: 10 } }, files: { 'thin.mjs': SUMMARY_OK(9) } });
  const r = fx.run(['--full']);
  assert(r.status === 1 && r.verdict === '❌ FAILURES' && r.failed === 1, 'a suite whose count falls below its floor turns the run red', r.out.slice(-250));
  fx.cleanup();
});

testCase('runner-missing-summary', async () => {
  const fx = fixture({ suites: { mute: { floor: 1 } }, files: { 'mute.mjs': `console.log('I ran fine but printed no summary');` } });
  const r = fx.run(['--full']);
  assert(r.status === 1 && r.verdict === '❌ FAILURES', 'a suite that prints no summary line turns the run red', r.out.slice(-250));
  fx.cleanup();
});

testCase('runner-crash', async () => {
  const fx = fixture({ suites: { boom: { floor: 1 } }, files: { 'boom.mjs': `throw new Error('boom: a suite that crashes');` } });
  const r = fx.run(['--full']);
  assert(r.status === 1 && r.verdict === '❌ FAILURES', 'a crashing suite turns the run red', r.out.slice(-250));
  assert(/boom: a suite that crashes/.test(r.out), '…and the crash text reaches the output');
  fx.cleanup();
  // the exit code must stand on its OWN: a suite that prints a perfect summary and then exits non-zero is still red
  const late = fixture({ suites: { late: { floor: 1 } }, files: { 'late.mjs': `console.log('✅ ALL PASS — 5 passed, 0 failed'); process.exit(3);` } });
  const rl = late.run(['--full']);
  assert(rl.status === 1 && rl.verdict === '❌ FAILURES' && rl.failed === 1, `a green summary does NOT excuse a non-zero exit — exactly the exit assertion fails (failed=${rl.failed})`, rl.out.slice(-250));
  late.cleanup();
});

testCase('runner-timeout', async () => {
  const fx = fixture({ suites: { hang: { floor: 1, timeoutMs: 1500 } }, files: { 'hang.mjs': `
    import { writeFileSync } from 'node:fs';
    import { spawn } from 'node:child_process';
    const gc = spawn('sleep', ['60'], { stdio: 'ignore' });          // a grandchild in the same process group (what a Chromium is)
    writeFileSync(process.env.FX_LOG + '.gc', String(gc.pid));
    console.log('✅ ALL PASS — 5 passed, 0 failed');                   // even a green-looking line must not save a hung suite
    setInterval(() => {}, 1000);                                       // …and it never exits
  ` } });
  const t0 = Date.now();
  const r = fx.run(['--full'], {}, 30000);
  const elapsed = Date.now() - t0;
  assert(r.status === 1 && r.verdict === '❌ FAILURES', 'a hung suite turns the run red', r.out.slice(-250));
  assert(/TIMED OUT after 1500/.test(r.out), '…naming the timeout');
  assert(elapsed < 12000, `…and the runner does not hang with it (returned in ${elapsed} ms, deadline 1500)`);
  const gcPid = Number(readFileSync(fx.fxLog + '.gc', 'utf8'));
  await sleep(300);
  let alive = true; try { process.kill(gcPid, 0); } catch { alive = false; }
  assert(!alive, 'the timeout killed the whole PROCESS GROUP — the grandchild (a stand-in for Chromium) is dead');
  if (alive) try { process.kill(gcPid, 'SIGKILL'); } catch { /* clean up our own mess */ }
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// W-22 (2026-10-08): a builder stopping ITS run killed another agent's run. A run had no process group of its own: the runner sat in its
// caller's group (shared with the caller and any sibling run) and every suite in a group of its own, so no one handle covered exactly one
// run, a runner that could not run its handler (SIGKILL) left its suites running, and the only handle left was a NAME — which matches every
// agent's run on the machine. Now a run is ONE process group (the runner, its suites, their browsers), stopped by the command it prints.
// Every stop below is aimed by PID or by that group, never by a name; cleanup is by PID too.
// ════════════════════════════════════════════════════════════════════════════════════════════
const psTable = () => (spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).stdout || '').split('\n').map(l => l.trim().split(/\s+/).map(Number)).filter(a => a.length === 3 && a.every(Number.isInteger)).map(([pid, ppid, pgid]) => ({ pid, ppid, pgid }));
// alive = it exists AND it is not a zombie (a killed process whose new parent, launchd, has not reaped it yet answers kill(pid, 0) too: on a
// loaded machine that lag would read a correctly killed process as alive)
const isAlive = pid => {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); } catch { return false; }
  const st = (spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim();
  return st !== '' && !st.startsWith('Z');
};
const treeOf = (pid, table = psTable()) => { const out = new Set([pid]); for (let grew = true; grew;) { grew = false; for (const p of table) if (out.has(p.ppid) && !out.has(p.pid)) { out.add(p.pid); grew = true; } } return out; };
/**
 * A suite that launches a grandchild (what a Chromium is), records both pids beside FX_LOG, and HOLDS until the test writes FX_LOG.release,
 * then passes (no timer to outrun on a loaded machine: it ends when the test says so; after 90 s unreleased it fails).
 */
const heldSuite = () => `
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
const gc = spawn('sleep', ['120'], { stdio: 'ignore' });
writeFileSync(process.env.FX_LOG + '.pids', JSON.stringify({ suite: process.pid, gc: gc.pid }));
const t0 = Date.now();
while (!existsSync(process.env.FX_LOG + '.release')) {
  if (Date.now() - t0 > 90000) { gc.kill('SIGKILL'); console.log('❌ FAILURES — 0 passed, 1 failed'); process.exit(1); }
  await new Promise(r => setTimeout(r, 50));
}
gc.kill('SIGKILL');
${SUMMARY_OK(5)}
`;
const release = fx => writeFileSync(fx.fxLog + '.release', '');

testCase('runner-stop-own-run', async () => {
  const NAME = `stopsleeper${process.pid}`;   // the SAME suite name in every run (as weekpagertest is in every worktree), unique to this test
  const mk = () => fixture({ suites: { [NAME]: { floor: 5 } }, files: { [`${NAME}.mjs`]: heldSuite() } });
  const B = mk();                                                        // the OTHER agent's run: held open until every stop is checked, then it must finish green
  const A = { term: mk(), kill: mk(), int: mk(), launcherGone: mk() };
  const fxs = [B, ...Object.values(A)];
  const runs = new Map(fxs.map(fx => [fx, fx.start(['--only', NAME])]));
  const pidsOf = fx => { try { return JSON.parse(readFileSync(fx.fxLog + '.pids', 'utf8')); } catch { return null; } };
  const stopLine = run => /^\s*stop: +kill -TERM -(\d+)\b/m.exec(run.out());
  for (let i = 0; i < 300 && !fxs.every(pidsOf); i++) await sleep(100);
  for (let i = 0; i < 30 && !Object.values(A).every(fx => stopLine(runs.get(fx))); i++) await sleep(100);
  const verified = new Set();                                            // run leaders whose group was checked to be exactly that run
  const finish = async () => {                                           // whatever happened, nothing of ours outlives the case: by PID, only what WE started, never by name
    const table = psTable();
    for (const fx of fxs) {
      const p = pidsOf(fx) || {};
      const run = runs.get(fx);
      for (const pid of new Set([...treeOf(run.proc.pid, table), p.gc, p.suite])) if (pid !== process.pid && isAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
    for (const pid of verified) if (isAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    await Promise.race([Promise.all([...runs.values()].map(r => r.done)), sleep(5000)]);
    for (const fx of fxs) fx.cleanup();
  };
  if (!fxs.every(pidsOf)) { assert(false, 'fixture: five concurrent runs of the same suite name all started their suite'); return finish(); }

  // the printed command must name a group that is EXACTLY this run: checked before anything is sent (a group that holds this test, or anything
  // not started by the run, would be killed too — refuse rather than execute)
  const ownPgid = (psTable().find(p => p.pid === process.pid) || {}).pgid;
  const aim = fx => {
    const run = runs.get(fx);
    const m = stopLine(run);
    if (!m) return { why: 'the run printed no `stop: kill -TERM -<pgid>` line at the top' };
    const pgid = Number(m[1]);
    if (!(pgid > 1) || pgid === ownPgid) return { why: `its group ${pgid} is its CALLER's (this test's own group): the run never got a group of its own` };
    const table = psTable();
    const mine = treeOf(run.proc.pid, table);
    const members = table.filter(p => p.pgid === pgid);
    const stray = members.filter(p => !mine.has(p.pid));
    if (stray.length) return { why: `group ${pgid} also holds ${stray.length} process(es) the run did not start (${stray.map(p => p.pid).join(',')})` };
    const p = pidsOf(fx);
    if (!members.some(x => x.pid === p.suite) || !members.some(x => x.pid === p.gc)) return { why: `its suite and the suite's grandchild are not in group ${pgid} (members: ${members.map(x => x.pid).join(',') || 'none'})` };
    verified.add(pgid);
    return { pgid };
  };
  const term = aim(A.term), kill = aim(A.kill);
  assert(!term.why, 'a run prints its stop command at the top (`stop: kill -TERM -<pgid>`), and that group is the run itself — its runner, its suite and the suite\'s grandchild, nothing it did not start', term.why);
  assert(!kill.why, '…for every run (the second run\'s group is its own as well)', kill.why);
  if (!term.why) process.kill(-term.pgid, 'SIGTERM');                  // 1. the printed command
  if (!kill.why) process.kill(-kill.pgid, 'SIGKILL');                  // 2. the same group with SIGKILL: no handler can run, the GROUP alone must stop it
  process.kill(runs.get(A.int).proc.pid, 'SIGINT');                     // 3. Ctrl-C reaches the process the caller started
  process.kill(runs.get(A.launcherGone).proc.pid, 'SIGKILL');           // 4. the caller is killed hard (a harness stop): the run must notice and stop itself
  const aPids = Object.fromEntries(Object.entries(A).map(([k, fx]) => [k, pidsOf(fx)]));
  for (let i = 0; i < 80 && Object.values(aPids).some(p => isAlive(p.suite) || isAlive(p.gc)); i++) await sleep(100);
  for (const [k, how] of [['term', 'its printed stop command (kill -TERM -<pgid>)'], ['kill', 'kill -KILL -<pgid> (no handler runs)'], ['int', 'SIGINT to the process its caller started (Ctrl-C)'], ['launcherGone', 'SIGKILL to the process its caller started (the run notices its launcher is gone)']]) {
    assert(!isAlive(aPids[k].suite) && !isAlive(aPids[k].gc), `stopping a run with ${how} stops its suite AND the suite's grandchild`, JSON.stringify({ ...aPids[k], suiteAlive: isAlive(aPids[k].suite), gcAlive: isAlive(aPids[k].gc) }));
  }
  const b = pidsOf(B);
  assert(isAlive(b.suite) && isAlive(b.gc), 'the OTHER run — the same suite name, running at the same time — is untouched by all four stops: its suite and its grandchild are alive', JSON.stringify({ ...b, suiteAlive: isAlive(b.suite), gcAlive: isAlive(b.gc) }));
  release(B);
  const rb = await Promise.race([runs.get(B).done, sleep(40000).then(() => null)]);
  assert(!!rb && rb.status === 0 && /✅ ALL PASS — \d+ passed, 0 failed/.test(rb.out), '…and it finishes GREEN', rb ? rb.out.slice(-300) : 'did not finish in 40 s');
  const ra = await Promise.race([Promise.all(Object.values(A).map(fx => runs.get(fx).done)), sleep(8000).then(() => null)]);
  assert(!!ra && ra.every(x => x.status !== 0 && !/✅ ALL PASS/.test(x.out)), 'every stopped run ends promptly and NOT green (a stopped run never reads ✅ ALL PASS)', ra ? JSON.stringify(ra.map(x => [x.status, x.signal])) : 'a stopped run was still going 8 s later');
  await finish();
});

testCase('runner-timeout-kills-tree', async () => {
  // suites share the run's process group, so a deadline kills the suite's process TREE (the suite and its Chromium) — at the deadline,
  // while the run goes on, not only when the run ends and sweeps its group
  const fx = fixture({ suites: { hang: { floor: 1, timeoutMs: 1500 }, slow: { floor: 5 } }, files: {
    'hang.mjs': `
      import { writeFileSync, existsSync } from 'node:fs';
      import { spawn } from 'node:child_process';
      const gc = spawn('sleep', ['120'], { stdio: 'ignore' });
      if (!existsSync(process.env.FX_LOG + '.gc')) writeFileSync(process.env.FX_LOG + '.gc', String(gc.pid));
      setInterval(() => {}, 1000);
    `,
    'slow.mjs': heldSuite(),
  } });
  const run = fx.start(['--only', 'hang,slow']);
  let gcPid = null;
  for (let i = 0; i < 150 && !gcPid; i++) { await sleep(100); try { gcPid = Number(readFileSync(fx.fxLog + '.gc', 'utf8')) || null; } catch { /* not yet */ } }
  for (let i = 0; i < 60 && !/hang\s+TIMEOUT/.test(run.out()); i++) await sleep(100);
  await sleep(300);
  const going = run.proc.exitCode === null && run.proc.signalCode === null;
  assert(going && /hang\s+TIMEOUT/.test(run.out()) && Number.isInteger(gcPid) && !isAlive(gcPid), 'a suite past its deadline is killed WITH the tree below it (the grandchild, a stand-in for Chromium) at once, while the run is still going', JSON.stringify({ going, gcPid, gcAlive: isAlive(gcPid) }) + ' ' + run.out().slice(-300));
  release(fx);
  await Promise.race([run.done, sleep(30000)]);
  if (isAlive(gcPid)) try { process.kill(gcPid, 'SIGKILL'); } catch { /* by PID */ }
  for (const pid of treeOf(run.proc.pid)) if (pid !== process.pid && isAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* by PID */ }
  fx.cleanup();
});

testCase('runner-reaps-leftovers', async () => {
  // a suite that exits leaving a process running (a Chromium whose suite crashed) must not outlive the run
  const fx = fixture({ suites: { leaver: { floor: 5 } }, files: { 'leaver.mjs': `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const gc = spawn('sleep', ['120'], { stdio: 'ignore' });
    gc.unref();
    writeFileSync(process.env.FX_LOG + '.gc', String(gc.pid));
    ${SUMMARY_OK(5)}
  ` } });
  const r = fx.run(['--only', 'leaver']);
  let gcPid = null; try { gcPid = Number(readFileSync(fx.fxLog + '.gc', 'utf8')); } catch { /* the suite never ran */ }
  for (let i = 0; i < 20 && isAlive(gcPid); i++) await sleep(100);
  assert(r.status === 0 && Number.isInteger(gcPid) && !isAlive(gcPid), 'a process a suite left running is dead once the run is over (nothing a run started outlives it)', r.out.slice(-300));
  if (isAlive(gcPid)) try { process.kill(gcPid, 'SIGKILL'); } catch { /* by PID */ }
  fx.cleanup();
});

testCase('runner-reaps-per-suite', async () => {
  // review note 8: what a suite leaves running dies WITH that suite, before the next suite starts — not when the whole run ends
  const fx = fixture({ suites: { leaver: { floor: 5, expectedMs: 9000 }, next: { floor: 5, expectedMs: 1 } }, files: {
    'leaver.mjs': `
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      const gc = spawn('sleep', ['120'], { stdio: 'ignore' });
      gc.unref();
      writeFileSync(process.env.FX_LOG + '.stray', String(gc.pid));
      ${SUMMARY_OK(5)}
    `,
    // runs second (--jobs 1, scheduled longest-expected first): is the stray still there when it starts? (a zombie awaiting its reaper counts as gone)
    'next.mjs': `
      import { readFileSync, appendFileSync } from 'node:fs';
      import { spawnSync } from 'node:child_process';
      const pid = Number(readFileSync(process.env.FX_LOG + '.stray', 'utf8'));
      let alive = false;
      try { process.kill(pid, 0); alive = !/^Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim() || 'Z'); } catch { /* gone */ }
      appendFileSync(process.env.FX_LOG, JSON.stringify({ id: 'next', ev: 'saw', stray: pid, strayAlive: alive }) + '\\n');
      ${SUMMARY_OK(5)}
    `,
  } });
  const r = fx.run(['--only', 'leaver,next', '--jobs', '1']);
  const saw = fx.events().find(e => e.ev === 'saw');
  assert(r.status === 0 && !!saw && Number.isInteger(saw.stray) && saw.strayAlive === false, 'a process a suite left running is already dead when the NEXT suite starts (it died with its suite)', JSON.stringify(saw) + ' ' + r.out.slice(-300));
  if (saw && isAlive(saw.stray)) try { process.kill(saw.stray, 'SIGKILL'); } catch { /* by PID */ }
  fx.cleanup();
  // …and ONLY the strays: a suite still running beside it (with its own child, a stand-in for its Chromium) is untouched when another suite ends
  const two = fixture({ suites: { quick: { floor: 5 }, busy: { floor: 5 } }, files: {
    'quick.mjs': `
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      const gc = spawn('sleep', ['120'], { stdio: 'ignore' });
      gc.unref();
      writeFileSync(process.env.FX_LOG + '.stray', String(gc.pid));
      ${SUMMARY_OK(5)}
    `,
    'busy.mjs': heldSuite(),
  } });
  const run = two.start(['--only', 'quick,busy', '--jobs', '2']);
  for (let i = 0; i < 200 && !/ ✅ quick /.test(run.out()); i++) await sleep(100);
  await sleep(300);
  let busy = null; try { busy = JSON.parse(readFileSync(two.fxLog + '.pids', 'utf8')); } catch { /* not started */ }
  let stray = null; try { stray = Number(readFileSync(two.fxLog + '.stray', 'utf8')); } catch { /* not started */ }
  assert(/ ✅ quick /.test(run.out()) && !!busy && isAlive(busy.suite) && isAlive(busy.gc) && Number.isInteger(stray) && !isAlive(stray), 'when one suite ends, its stray dies and the suite still running beside it (and its child) does not', JSON.stringify({ busy, busyAlive: busy && [isAlive(busy.suite), isAlive(busy.gc)], stray, strayAlive: isAlive(stray) }));
  release(two);
  const rr = await Promise.race([run.done, sleep(30000).then(() => null)]);
  assert(!!rr && rr.status === 0, '…and it finishes green', rr ? rr.out.slice(-300) : 'did not finish');
  for (const pid of [stray, busy && busy.gc, busy && busy.suite]) if (isAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* by PID */ }
  for (const pid of treeOf(run.proc.pid)) if (pid !== process.pid && isAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* by PID */ }
  two.cleanup();
});

testCase('runner-launcher-gone', async () => {
  // review note 9: a run must never relaunch itself as a new, unsupervised run. If the launcher that started it is gone before the run's first
  // check (the race), or the launcher variable names a process that is not its parent, the run stops with exit 2 and runs nothing.
  const fx = fixture({ suites: { s: {} }, files: { 's.mjs': evSuite('s', 10) } });
  const r = fx.run(['--only', 's'], { CFBP_TESTRUN_LAUNCHER: '1' });
  assert(r.status === 2 && fx.events().length === 0 && /launcher/.test(r.out), 'CFBP_TESTRUN_LAUNCHER naming a process that is not the run\'s parent: exit 2, nothing run', `status ${r.status} · ${fx.events().length} event(s) · ${r.out.slice(0, 300)}`);
  // the race itself: a launcher that starts the run and dies, so the run's parent is gone before it checks. A test-only preload HOLDS the run
  // until its parent (the starter) has exited, so the race is decided the same way on any machine, however loaded (the hold applies only to
  // the process whose parent is the starter: a relaunched run's children are not held)
  const out = path.join(fx.aux, 'orphan.out');
  const hold = path.join(fx.aux, 'hold-until-parent-gone.mjs');
  writeFileSync(hold, `const want = process.env.FX_HOLD_UNTIL_PARENT_GONE;
if (want && String(process.ppid) === want) { const t0 = Date.now(); const cell = new Int32Array(new SharedArrayBuffer(4)); while (String(process.ppid) === want && Date.now() - t0 < 15000) Atomics.wait(cell, 0, 0, 20); }
`);
  const starter = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const fd = fs.openSync(${JSON.stringify(out)}, 'w');
    spawn(process.execPath, [${JSON.stringify(path.join(fx.cfb, 'testrun.mjs'))}, '--only', 's'], { cwd: ${JSON.stringify(fx.cfb)}, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, CFBP_TESTRUN_LAUNCHER: String(process.pid), FX_HOLD_UNTIL_PARENT_GONE: String(process.pid), NODE_OPTIONS: ${JSON.stringify('--import=' + pathToFileURL(hold).href)} } }).unref();
    process.exit(0);`;
  spawnSync(process.execPath, ['-e', starter], { env: fx.env(), encoding: 'utf8', timeout: 20000 });
  const said = () => { try { return readFileSync(out, 'utf8'); } catch { return ''; } };
  for (let i = 0; i < 250 && !/Nothing was run|ALL PASS|FAILURES/.test(said()); i++) await sleep(100);
  await sleep(500);                                                       // long enough for a relaunched run to have started its suite
  assert(/Nothing was run/.test(said()) && fx.events().length === 0, 'a run whose launcher died before it checked stops (exit 2) and starts no suite — it does not relaunch itself into a run nothing supervises', `${fx.events().length} event(s) · ${said().slice(0, 300)}`);
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Add-on (a), W-11 / D-30 (2026-10-07): a deadline hit in the PARALLEL pass is a TIMEOUT, not yet a failure. The suite is
// re-run ONCE, ALONE, after the pass, with the same deadline and every check; only that run is counted. FAIL only if it fails
// or times out again. summary.json records the TIMEOUT, the re-run and its outcome.
// ════════════════════════════════════════════════════════════════════════════════════════════
/** A fixture suite that HANGS on its first run (past a 1500 ms deadline) and on its second run does `second`. State lives beside FX_LOG (outside the repo). */
const firstHangs = (id, second) => `
import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
const mark = process.env.FX_LOG + '.${id}.ran';
appendFileSync(process.env.FX_LOG, JSON.stringify({ id: '${id}', ev: 'start', t: Date.now() }) + '\\n');
if (!existsSync(mark)) { writeFileSync(mark, '1'); setInterval(() => {}, 1000); }
else {
  ${second}
  appendFileSync(process.env.FX_LOG, JSON.stringify({ id: '${id}', ev: 'end', t: Date.now() }) + '\\n');
}
`;
const summaryOf = r => { const m = /summary: (\S+summary\.json)/.exec(r.out); try { return m ? JSON.parse(readFileSync(m[1], 'utf8')) : null; } catch { return null; } };

testCase('runner-timeout-solo-rerun', async () => {
  const fx = fixture({
    suites: { flaky: { floor: 5, timeoutMs: 1500 }, steady: { floor: 5 } },
    files: { 'flaky.mjs': firstHangs('flaky', "console.log('✅ ALL PASS — 5 passed, 0 failed');"), 'steady.mjs': evSuite('steady', 400) },
  });
  const r = fx.run(['--full'], {}, 40000);
  assert(r.status === 0 && r.verdict === '✅ ALL PASS', 'a suite that TIMES OUT in the parallel pass but passes ALONE leaves the run GREEN', r.out.slice(-600));
  assert(r.passed === 7 + 5 + 5 && r.failed === 0, `…and is counted ONCE, with every check (core 7 + steady 5 + flaky 5 = 17; got ${r.passed}/${r.failed}) — the timed-out run adds nothing`);
  assert(/⏱ flaky\s+TIMEOUT/.test(r.out) && /✅ flaky .*re-run ALONE after a TIMEOUT/.test(r.out), 'the output says TIMEOUT for the parallel run, then shows the solo re-run and its result', r.out.slice(0, 900));
  const ev = fx.events();
  const flakyStarts = ev.filter(e => e.id === 'flaky' && e.ev === 'start').map(e => e.t);
  const steadyEnd = Math.max(...ev.filter(e => e.id === 'steady' && e.ev === 'end').map(e => e.t));
  assert(flakyStarts.length === 2 && flakyStarts[1] >= steadyEnd, 'the re-run starts only AFTER the parallel pass is over (alone), and it is exactly ONE re-run', JSON.stringify({ flakyStarts, steadyEnd }));
  const s = summaryOf(r);
  const rec = s && s.timeouts && s.timeouts.find(t => t.id === 'flaky');
  const row = s && s.suites.find(x => x.id === 'flaky');
  assert(!!rec && rec.outcome === 'pass' && rec.deadlineMs === 1500 && rec.firstMs >= 1500 && rec.rerunMs > 0, 'summary.json `timeouts` records the TIMEOUT, the re-run and its outcome (pass)', JSON.stringify(s && s.timeouts));
  assert(!!row && row.ok && row.timeout && row.timeout.rerun.ok === true && row.timeout.rerun.timedOut === false && existsSync(row.timeout.firstLog), "the suite's own row carries the timeout record, with the parallel run's log kept", JSON.stringify(row && row.timeout));
  fx.cleanup();
});

testCase('runner-timeout-solo-fail', async () => {
  // the solo re-run decides: it FAILS → FAIL; it times out again → FAIL (the always-hanging suite is runner-timeout's)
  const fx = fixture({
    suites: { flaky: { floor: 5, timeoutMs: 1500 }, hang: { floor: 1, timeoutMs: 1500 } },
    files: { 'flaky.mjs': firstHangs('flaky', "console.log('❌ FAILURES — 4 passed, 1 failed'); process.exitCode = 1;"), 'hang.mjs': 'setInterval(() => {}, 1000);' },
  });
  const r = fx.run(['--full'], {}, 40000);
  assert(r.status === 1 && r.verdict === '❌ FAILURES', 'a solo re-run that fails, or times out again, turns the run RED', r.out.slice(-500));
  assert(/❌ flaky .*the solo re-run FAILED/.test(r.out) && /❌ hang .*the solo re-run TIMED OUT too/.test(r.out), 'each says why: the solo re-run FAILED / TIMED OUT too', r.out.slice(0, 1200));
  const s = summaryOf(r);
  const out = Object.fromEntries(((s && s.timeouts) || []).map(t => [t.id, t.outcome]));
  assert(out.flaky === 'fail' && out.hang === 'timeout', 'summary.json records each outcome (fail / timeout)', JSON.stringify(s && s.timeouts));
  assert(s && s.suites.filter(x => x.id === 'flaky' || x.id === 'hang').every(x => !x.ok && x.failedChecks.length > 0), 'both rows are red with their failed checks (nothing weakened: a timed-out solo run fails its exit check)');
  fx.cleanup();
});

testCase('runner-timeout-solo-alone', async () => {
  // two suites time out together in the parallel pass; their re-runs go ONE AT A TIME
  const fx = fixture({
    suites: { f1: { floor: 5, timeoutMs: 1500 }, f2: { floor: 5, timeoutMs: 1500 } },
    files: {
      'f1.mjs': firstHangs('f1', "await new Promise(r => setTimeout(r, 400)); console.log('✅ ALL PASS — 5 passed, 0 failed');"),
      'f2.mjs': firstHangs('f2', "await new Promise(r => setTimeout(r, 400)); console.log('✅ ALL PASS — 5 passed, 0 failed');"),
    },
  });
  const r = fx.run(['--full', '--jobs', '4'], {}, 40000);
  assert(r.status === 0, 'both pass on their solo re-runs', r.out.slice(-400));
  // the second start of each is its solo re-run; its end is logged before the summary line
  const ev = fx.events();
  const solo = id => { const st = ev.filter(e => e.id === id && e.ev === 'start').map(e => e.t)[1]; const en = ev.filter(e => e.id === id && e.ev === 'end').map(e => e.t)[0]; return [st, en]; };
  const [a0, a1] = solo('f1'), [b0, b1] = solo('f2');
  assert([a0, a1, b0, b1].every(Number.isFinite) && (a1 <= b0 || b1 <= a0), 'the two solo re-runs never overlap (each runs ALONE)', JSON.stringify({ a0, a1, b0, b1 }));
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Add-on (b), W-11 / D-30 (2026-10-07): the `tz` tag. `--tz <zone>` alone runs ONLY the tz-tagged suites, under that zone;
// `--full --tz <zone>` (the release gate) runs everything in the primary zone AND the tz suites again under <zone>.
// ════════════════════════════════════════════════════════════════════════════════════════════
const tzSuite = id => `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FX_LOG, JSON.stringify({ id: '${id}', ev: 'start', tz: process.env.TZ || '', t: Date.now() }) + '\\n');
await new Promise(r => setTimeout(r, 250));
appendFileSync(process.env.FX_LOG, JSON.stringify({ id: '${id}', ev: 'end', tz: process.env.TZ || '', t: Date.now() }) + '\\n');
console.log('✅ ALL PASS — 5 passed, 0 failed');
`;
const starts = fx => fx.events().filter(e => e.ev === 'start');
const tzFixture = () => fixture({
  suites: { a: { floor: 5, tags: ['tz'] }, b: { floor: 5 }, c: { floor: 5, tags: ['quick', 'tz'] }, d: { floor: 5, tags: ['quick'] } },
  files: { 'a.mjs': tzSuite('a'), 'b.mjs': tzSuite('b'), 'c.mjs': tzSuite('c'), 'd.mjs': tzSuite('d') },
});

testCase('tz-pass-only-tz-suites', async () => {
  const fx = tzFixture();
  const r = fx.run(['--tz', 'Pacific/Kiritimati'], { TZ: 'UTC' });
  const ran = starts(fx).map(e => `${e.id}@${e.tz}`).sort();
  assert(r.status === 0 && JSON.stringify(ran) === JSON.stringify(['a@Pacific/Kiritimati', 'c@Pacific/Kiritimati']), 'a bare --tz runs ONLY the tz-tagged suites, each under that zone — no primary pass, no untagged suite', JSON.stringify(ran) + ' ' + r.out.slice(-300));
  assert(r.passed === 10 && /NOT the full harness/.test(r.out), 'its total is those suites alone (2 × 5), and it says it is not the full harness', `${r.passed}`);
  const s = summaryOf(r);
  assert(!!s && s.tz === 'Pacific/Kiritimati' && s.suites.length === 2 && s.suites.every(x => x.zone === 'Pacific/Kiritimati'), 'summary.json names the zone on the run and on every second-zone row', JSON.stringify(s && s.suites.map(x => [x.id, x.zone])));
  fx.cleanup();
});

testCase('tz-full-plus-second-zone', async () => {
  const fx = tzFixture();
  const r = fx.run(['--full', '--tz', 'Pacific/Kiritimati'], { TZ: 'UTC' });
  const ran = starts(fx).map(e => `${e.id}@${e.tz}`).sort();
  assert(r.status === 0 && JSON.stringify(ran) === JSON.stringify(['a@Pacific/Kiritimati', 'a@UTC', 'b@UTC', 'c@Pacific/Kiritimati', 'c@UTC', 'd@UTC']),
    '--full --tz: EVERY suite in the primary zone (here UTC) and the tz-tagged ones AGAIN under the second zone — the primary pass is not moved to the second zone', JSON.stringify(ran));
  const ev = fx.events();
  const primaryEnd = Math.max(...ev.filter(e => e.ev === 'end' && e.tz === 'UTC').map(e => e.t));
  const zoneStart = Math.min(...ev.filter(e => e.ev === 'start' && e.tz === 'Pacific/Kiritimati').map(e => e.t));
  assert(zoneStart >= primaryEnd, 'the second-zone pass starts only after the primary pass has finished (it never adds load to the primary pass)', JSON.stringify({ primaryEnd, zoneStart }));
  assert(r.passed === 7 + 4 * 5 + 2 * 5 && / ✅ a @TZ=Pacific\/Kiritimati /.test(r.out), `the total is the full sweep plus the second-zone runs (7 + 20 + 10 = 37; got ${r.passed}), each second-zone line labelled with its zone`);
  const q = fx.run(['--quick', '--tz', 'Pacific/Kiritimati'], { TZ: 'UTC' });
  assert(q.status === 0 && /\+ 1 under TZ=Pacific\/Kiritimati/.test(q.out), 'with another tier, the second zone re-runs only the tz suites of THAT selection (--quick: c, not a)', q.out.slice(0, 300));
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Reviewer B1 (2026-10-07): a suite whose RUN THROWS (not the suite failing — the runner failing to run it) must be a red row that
// names the error, never a suite that silently vanishes from a run that then reads ✅ ALL PASS.
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('runner-crash-is-red', async () => {
  const fx = fixture({ suites: { fine: { floor: 5 }, boom: { floor: 5 } }, files: { 'fine.mjs': SUMMARY_OK(5), 'boom.mjs': SUMMARY_OK(5) } });
  // force a throw INSIDE the runner for `boom` only: a FILE squats the path where its per-suite TMPDIR must be created (mkdir → EEXIST)
  const logDir = path.join(fx.aux, 'rundir');
  mkdirSync(path.join(logDir, 'tmp'), { recursive: true });
  writeFileSync(path.join(logDir, 'tmp', 'boom'), 'not a directory');
  const r = fx.run(['--full', '--log-dir', logDir]);
  assert(r.status === 1 && r.verdict === '❌ FAILURES', 'a suite whose run THREW turns the run RED (exit 1) — it does not vanish from a green run', r.out.slice(-500));
  assert(/❌ boom\s+CRASHED/.test(r.out) && /boom was planned and its run THREW: .*EEXIST/.test(r.out), 'its row says CRASHED and names the error the runner hit (EEXIST)', r.out.slice(0, 900));
  const s = summaryOf(r);
  const row = s && s.suites.find(x => x.id === 'boom');
  assert(!!row && row.ok === false && /THREW/.test(row.crashed || '') && s.suites.length === 3 && s.failed === 1, 'summary.json has a red `boom` row naming the error, and every planned suite has a row (fine, boom, core)', JSON.stringify(s && s.suites.map(x => [x.id, x.ok])));
  assert(/ ✅ fine /.test(r.out) && /tier full · 3 suite\(s\)/.test(r.out), 'the other suites still run and count; the footer counts all three', r.out.slice(-400));
  fx.cleanup();
});

testCase('pool-reports-rejections', async () => {
  const { runPool } = await lib('exec.mjs');
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ran = [];
  const rej = await runPool(items, { jobs: 2, browserJobs: 1, runOne: async t => { ran.push(t.id); if (t.id === 'b') throw new Error('kaboom'); } });
  assert(ran.length === 3 && Array.isArray(rej) && rej.length === 1 && rej[0].item.id === 'b' && /kaboom/.test(rej[0].error.message), 'runPool RETURNS every rejected item with its error (never swallowed) and still runs the rest', JSON.stringify(rej));
});

testCase('runner-clone-skips-special-files', async () => {
  // the reviewer's reproduction: a named pipe at the tree root made cpSync throw while cloning for an isolate:"tree" suite
  const fx = fixture({ suites: { iso: { floor: 5, isolate: 'tree' } }, files: { 'iso.mjs': SUMMARY_OK(5) } });
  const fifo = path.join(fx.root, 'a-named-pipe');
  const mk = spawnSync('mkfifo', [fifo]);
  if (mk.status !== 0) { assert(true, 'mkfifo unavailable here: skipped (the B1 guard is proved by runner-crash-is-red)'); fx.cleanup(); return; }
  const r = fx.run(['--full']);
  assert(r.status === 0 && / ✅ iso /.test(r.out), 'an isolate:"tree" suite runs green with a FIFO in the checkout: the clone skips what is not a directory, file or symlink', r.out.slice(-500));
  rmSync(fifo, { force: true });
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Reviewer N1: --tz refuses an unknown zone (it would run as UTC) and a zone with this run's own offsets (it would test nothing new)
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('tz-zone-validation', async () => {
  const fx = tzFixture();
  const typo = fx.run(['--tz', 'America/Los_Angelos'], { TZ: 'UTC' });
  assert(typo.status === 2 && /is not a time zone/.test(typo.out) && starts(fx).length === 0, 'an unknown zone name is REFUSED before anything runs (Node would silently use UTC)', typo.out.slice(0, 300));
  const same = fx.run(['--full', '--tz', 'Etc/UTC'], { TZ: 'UTC' });
  assert(same.status === 2 && /same UTC offsets/.test(same.out) && starts(fx).length === 0, 'a second zone with the run\'s own offsets (Etc/UTC under TZ=UTC) is REFUSED: it would test nothing new', same.out.slice(0, 300));
  const la = fx.run(['--tz', 'America/Los_Angeles'], { TZ: 'America/Vancouver' });
  assert(la.status === 2 && /same UTC offsets/.test(la.out), 'a different NAME with the same offsets in January and July is refused too (America/Vancouver vs America/Los_Angeles)', la.out.slice(0, 300));
  const ok = fx.run(['--tz', 'UTC'], { TZ: 'America/Los_Angeles' });
  assert(ok.status === 0 && starts(fx).length === 2 && fx.events().every(e => e.tz === 'UTC'), 'a real, different zone runs (UTC from a Los Angeles machine)', ok.out.slice(-300));
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Reviewer N4: summary.json says which tree it gated — git HEAD and clean / dirty
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('summary-records-head', async () => {
  const fx = fixture({ suites: { s1: { floor: 5 } }, files: { 's1.mjs': SUMMARY_OK(5) } });
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: fx.root, encoding: 'utf8' });
  if (g('init', '-q').status !== 0) { assert(true, 'git unavailable: skipped'); fx.cleanup(); return; }
  g('add', '-A'); g('commit', '-q', '-m', 'fixture');
  const sha = g('rev-parse', 'HEAD').stdout.trim();
  const clean = summaryOf(fx.run(['--full']));
  assert(!!clean && clean.head === sha && clean.dirty === false, 'a committed tree: summary.json records HEAD and dirty:false', JSON.stringify(clean && { head: clean.head, dirty: clean.dirty, sha }));
  writeFileSync(path.join(fx.cfb, 'uncommitted.txt'), 'x');
  const r = fx.run(['--full']);
  const dirty = summaryOf(r);
  assert(!!dirty && dirty.head === sha && dirty.dirty === true && /UNCOMMITTED changes/.test(r.out), 'an uncommitted file: dirty:true, and the header says so (a merge/deploy gate needs a clean tree)', JSON.stringify(dirty && { head: dirty.head, dirty: dirty.dirty }));
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Reviewer N6: the denylist is about the FILE — a symlink alias or a hard link of a credential script is refused
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('denylist-real-file', async () => {
  // a STAND-IN named like a credential script (it never runs: the point is that the runner refuses before spawning anything)
  const stub = "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.FX_LOG, JSON.stringify({ id: 'cred', ev: 'start', t: Date.now() }) + '\\n'); console.log('✅ ALL PASS — 1 passed, 0 failed');";
  // the symlink's target sits OUTSIDE the checkout (only the real-path check can see it); the hard link's target is inside (only the identity check can)
  for (const [kind, make] of [['symlink', fx => { const t = path.join(fx.aux, 'elsewhere', 'rls.test.mjs'); mkdirSync(path.dirname(t), { recursive: true }); writeFileSync(t, stub); symlinkSync(t, path.join(fx.cfb, 'alias.mjs')); }],
    ['hard link', fx => linkSync(path.join(fx.cfb, 'supabase', 'tests', 'rls.test.mjs'), path.join(fx.cfb, 'alias.mjs'))]]) {
    const fx = fixture({ suites: { alias: { floor: 1 } }, files: { 'supabase/tests/rls.test.mjs': stub } });
    make(fx);
    const r = fx.run(['--full']);
    assert(r.status === 2 && /REFUSED/.test(r.out) && /alias\.mjs/.test(r.out) && fx.events().length === 0, `a ${kind} alias of a denylisted script is REFUSED at manifest load and nothing runs`, r.out.slice(0, 400));
    fx.cleanup();
  }
  const { deniedFile } = await lib('manifest.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-deny-'));
  tmpRoots.push(dir);
  writeFileSync(path.join(dir, 'plain.mjs'), '');
  assert(deniedFile(path.join(dir, 'plain.mjs'), dir) === false, 'an ordinary file is not denied (no false positive)');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Reviewer N2: --check-tz probes every suite's zone-dependent Date/Intl calls and fails on one that is not tagged tz
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('check-tz', async () => {
  // the probe is wired through NODE_OPTIONS=--import=<file URL of tests/lib/tz-probe.mjs>, so the fixture needs it under tests/lib (copied by fixture())
  const local = "const d = new Date(0); console.log(d.getHours() >= 0 ? '✅ ALL PASS — 5 passed, 0 failed' : 'x');";
  const utc = "const d = new Date(0); console.log(d.getUTCHours() >= 0 && d.toISOString() ? '✅ ALL PASS — 5 passed, 0 failed' : 'x');";
  const fx = fixture({ suites: { untaggedlocal: { floor: 5 }, taggedlocal: { floor: 5, tags: ['tz'] }, utconly: { floor: 5 } },
    files: { 'untaggedlocal.mjs': local, 'taggedlocal.mjs': local, 'utconly.mjs': utc } });
  const r = fx.run(['--full', '--check-tz'], { TZ: 'UTC' });
  assert(r.status === 1 && /❌ untaggedlocal made \d+ zone-dependent call\(s\) but is not tagged tz: getHours/.test(r.out), 'a suite that calls a zone-dependent API (getHours) without the tz tag FAILS the check, naming the call', r.out.slice(-700));
  assert(!/❌ taggedlocal/.test(r.out) && !/❌ utconly/.test(r.out), 'the tagged suite and the UTC-only suite pass it (getUTCHours / toISOString are not zone-dependent)', r.out.slice(-700));
  fx.cleanup();
});

testCase('exec-output-not-lost', async () => {
  // THE BUG THAT WAS FOUND BY A FLAKY RUN: a suite that prints a lot and ends with a bare process.exit() loses its tail (the summary
  // line!) when its stdout is a PIPE the parent is slow to drain. (Measured while building this: 40 of 40 such children lost it behind a
  // busy parent.) The runner captures to FILES, which a child writes synchronously, so no exit path can drop a line.
  const { runChild } = await lib('exec.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-exec-'));
  tmpRoots.push(dir);
  const body = `for (let i = 0; i < 3000; i++) console.log('line ' + i + ' ' + 'x'.repeat(120)); console.error('to stderr'); console.log('✅ ALL PASS — 5 passed, 0 failed'); process.exit(0);`;
  const busy = async () => { for (let i = 0; i < 12; i++) { const t = Date.now(); while (Date.now() - t < 40) { /* a parent whose event loop is busy */ } await sleep(5); } };
  const runs = await Promise.all([...Array.from({ length: 12 }, (_, i) => runChild({ args: ['-e', body], cwd: dir, env: process.env, timeoutMs: 10000, rawPrefix: path.join(dir, 'raw', `c${i}`) })), busy()]);
  const kids = runs.slice(0, 12);
  assert(kids.every(r => r.status === 0 && /✅ ALL PASS — 5 passed, 0 failed/.test(r.stdout)), 'all 12 children, each printing ~400 KB and then process.exit(0) behind a busy parent, delivered their summary line');
  assert(kids.every(r => /to stderr/.test(r.stderr) && r.stdout.split('\n').length > 3000), '…with the whole output, and stderr kept separately (stdout-then-stderr, as the legacy `out` was)');
  const big = await runChild({ args: ['-e', `console.log('y'.repeat(3 * 1024 * 1024))`], cwd: dir, env: process.env, timeoutMs: 10000, rawPrefix: path.join(dir, 'raw', 'big'), maxBytes: 1024 * 1024 });
  assert(big.error && /exceeded/.test(big.error.message) && big.stdout.length < 3 * 1024 * 1024, 'a runaway output is cut to its head and tail and FLAGGED (an error that fails the suite), never loaded whole');
});

testCase('runner-parallel', async () => {
  const fx = fixture({ suites: { a: {}, b: {}, c: {}, d: {} }, files: Object.fromEntries(['a', 'b', 'c', 'd'].map(i => [`${i}.mjs`, evSuite(i, 1500)])) });
  fx.run(['--full', '--jobs', '4']);
  const par = maxConcurrency(fx.events(), ['a', 'b', 'c', 'd']);
  writeFileSync(fx.fxLog, '');
  fx.run(['--full', '--jobs', '1']);
  const ser = maxConcurrency(fx.events(), ['a', 'b', 'c', 'd']);
  assert(par >= 3, `--jobs 4 really runs suites concurrently (peak concurrency ${par})`);
  assert(ser === 1, `--jobs 1 runs them one at a time (peak ${ser})`);
  fx.cleanup();
});

testCase('runner-browser-cap', async () => {
  const ids = ['b1', 'b2', 'b3', 'b4'];
  const fx = fixture({ suites: Object.fromEntries(ids.map(i => [i, { tags: ['browser'] }])), files: Object.fromEntries(ids.map(i => [`${i}.mjs`, evSuite(i, 1200)])) });
  fx.run(['--full', '--jobs', '8', '--browser-jobs', '2']);
  const peak = maxConcurrency(fx.events(), ids);
  assert(peak === 2, `suites tagged "browser" never exceed the cap even with 8 workers free (peak ${peak}, cap 2)`);
  writeFileSync(fx.fxLog, '');
  fx.run(['--full', '--jobs', '8', '--browser-jobs', '3']);
  assert(maxConcurrency(fx.events(), ids) === 3, '…and --browser-jobs 3 raises it (the cap is a real knob, not a coincidence)');
  fx.cleanup();
  // a Chromium suite nobody tagged is still capped: the tag is inferred from the script
  const sneaky = fixture({ suites: Object.fromEntries(ids.map(i => [i, {}])), files: Object.fromEntries(ids.map(i => [`${i}.mjs`, `const launchArgs = ['--headless=new', '${CHROMIUM_FLAG}'];\n` + evSuite(i, 1200)])) });
  sneaky.run(['--full', '--jobs', '8', '--browser-jobs', '2']);
  assert(maxConcurrency(sneaky.events(), ids) === 2, 'a suite that launches Chromium but carries no tag is capped anyway (inferred from --remote-debugging-port)');
  sneaky.cleanup();
});

testCase('runner-hermetic-tmp', async () => {
  const ids = ['t1', 't2', 't3'];
  const fx = fixture({ suites: Object.fromEntries(ids.map(i => [i, {}])), files: Object.fromEntries(ids.map(i => [`${i}.mjs`, evSuite(i, 100)])) });
  fx.run(['--full', '--jobs', '3', '--keep-tmp']);
  const starts = fx.events().filter(e => e.ev === 'start');
  const tmps = starts.map(e => e.tmp);
  assert(new Set(tmps).size === 3, `each suite gets its OWN TMPDIR (${tmps.length} suites, ${new Set(tmps).size} distinct)`);
  assert(tmps.every(t => /cfbp-testrun-/.test(t) && /\/tmp\/t[123]$/.test(t)), 'every TMPDIR lives under the run directory, named for its suite');
  assert(tmps.every(t => !t.startsWith('/tmp/')), 'none is the shared /tmp');
  fx.cleanup();
});

// spelled at run time so THIS file does not itself look like a Chromium launcher to the runner's tag inference
const CHROMIUM_FLAG = ['--remote', 'debugging', 'port=0'].join('-');
const WATCH = { CFBP_TRIPWIRE_WARMUP_MS: '300', CFBP_TRIPWIRE_SETTLE_MS: '800' };   // the real watcher, with timings short enough for fixtures
testCase('runner-tripwire', async () => {
  const transient = `import { writeFileSync, rmSync } from 'node:fs'; writeFileSync('js-scratch.tmp', 'x'); rmSync('js-scratch.tmp');`;       // came and went
  const restored = `import { readFileSync, writeFileSync } from 'node:fs'; const f = 'js/lib.js'; const o = readFileSync(f, 'utf8'); writeFileSync(f, 'GUTTED'); writeFileSync(f, o);`; // gutted then put back byte-for-byte
  for (const [label, body] of [['a scratch file that came and went', transient], ['a source file gutted and restored byte-for-byte', restored]]) {
    const fx = fixture({ suites: { writer: { floor: 1 } }, files: { 'js/lib.js': 'export const x = 1;\n', 'writer.mjs': body + '\n' + SUMMARY_OK(5) } });
    const r = fx.run(['--full'], WATCH);
    assert(r.status === 1 && /TRIPWIRE/.test(r.out), `the tripwire turns the run red for ${label}`, r.out.slice(-300));
    fx.cleanup();
  }
  const clean = fixture({ suites: { reader: { floor: 1 } }, files: { 'js/lib.js': 'export const x = 1;\n', 'reader.mjs': `import { readFileSync, readdirSync } from 'node:fs'; readFileSync('js/lib.js'); readdirSync('js'); ${SUMMARY_OK(5)}` } });
  const rc = clean.run(['--full'], WATCH);
  assert(rc.status === 0 && !/TRIPWIRE/.test(rc.out), 'a suite that only READS the tree leaves the tripwire silent');
  clean.cleanup();
  // the false-positive class that made the first version cry wolf: DIRECTORY mtimes move for reasons that are not a suite writing
  // (the agent harness bubbles a whole-second mtime up through every ancestor of a file it just edited; Spotlight/iCloud do similar)
  const bump = fixture({ suites: { toucher: { floor: 1 } }, files: { 'js/lib.js': 'export const x = 1;\n', 'toucher.mjs': `import { utimesSync } from 'node:fs'; const t = new Date(); for (const d of ['.', 'js', '..']) utimesSync(d, t, t); ${SUMMARY_OK(5)}` } });
  const rb = bump.run(['--full'], WATCH);
  assert(rb.status === 0 && !/TRIPWIRE/.test(rb.out), 'a DIRECTORY whose mtime is bumped (no file written, no entry created) does NOT trip the wire — directory mtimes are not compared', rb.out.slice(-300));
  bump.cleanup();
  const atomic = fixture({ suites: { atomic: { floor: 1 } }, files: { 'js/lib.js': 'export const x = 1;\n', 'atomic.mjs': `import { writeFileSync, renameSync } from 'node:fs'; writeFileSync('js/lib.js.tmp', 'y'); renameSync('js/lib.js.tmp', 'js/lib.js'); ${SUMMARY_OK(5)}` } });
  const ra = atomic.run(['--full'], WATCH);
  assert(ra.status === 1 && /TRIPWIRE/.test(ra.out) && /lib\.js/.test(ra.out), 'a temp-file-then-rename rewrite of a source file is caught (and names it)', ra.out.slice(-300));
  atomic.cleanup();
});

testCase('runner-isolate-tree', async () => {
  const body = `import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'; copyFileSync('js/lib.js', process.env.TMPDIR + '/lib.bak'); writeFileSync('js/lib.js', 'GUTTED'); const seen = readFileSync('js/lib.js', 'utf8'); copyFileSync(process.env.TMPDIR + '/lib.bak', 'js/lib.js'); console.log(seen === 'GUTTED' ? '✅ ALL PASS — 5 passed, 0 failed' : 'not gutted');`;
  const fx = fixture({ suites: { mutator: { floor: 1, isolate: 'tree' } }, files: { 'js/lib.js': 'export const x = 1;\n', 'mutator.mjs': body } });
  const before = statSync(path.join(fx.cfb, 'js', 'lib.js')).mtimeMs;
  const r = fx.run(['--full'], WATCH);
  assert(r.status === 0 && r.verdict === '✅ ALL PASS' && !/TRIPWIRE/.test(r.out), 'an in-place mutator marked isolate:"tree" runs green and trips nothing', r.out.slice(-300));
  assert(statSync(path.join(fx.cfb, 'js', 'lib.js')).mtimeMs === before && readFileSync(path.join(fx.cfb, 'js', 'lib.js'), 'utf8') === 'export const x = 1;\n', 'the REAL file was never touched (same bytes, same mtime) — the mutation happened in a private clone');
  fx.cleanup();
  const un = fixture({ suites: { mutator: { floor: 1 } }, files: { 'js/lib.js': 'export const x = 1;\n', 'mutator.mjs': body } });
  const ru = un.run(['--full'], WATCH);
  assert(ru.status === 1 && /TRIPWIRE/.test(ru.out), 'the SAME suite without the isolation is caught by the tripwire (an undeclared mutator cannot hide)');
  un.cleanup();
});

testCase('runner-clone-excludes-secrets', async () => {
  const { cloneTree, snapshotTree } = await lib('tree.mjs');
  const fx = fixture({ files: { 'supabase/tests/.env.local': 'SECRET=1', 'supabase/tests/ok.mjs': 'x', 'js/a.js': 'a' } });
  const dest = path.join(fx.aux, 'clone');
  cloneTree(fx.root, dest);
  assert(existsSync(path.join(dest, 'cfb-pickems', 'js', 'a.js')), 'the clone carries the checkout');
  assert(!existsSync(path.join(dest, 'cfb-pickems', 'supabase', 'tests', '.env.local')), 'the clone NEVER carries a .env* file');
  assert(![...snapshotTree(fx.root).keys()].some(k => /\.env/.test(k)), 'the tripwire snapshot never even stats a .env* file');
  fx.cleanup();
});

testCase('runner-legacy-guard', async () => {
  const legacy = `import { readFile } from 'node:fs/promises';\nconsole.log('\\n[9] x.mjs — spawned as a subprocess…');\n{\n  const result = spawnSync(process.execPath, ['x.mjs'], { cwd, encoding: 'utf8', timeout: SPAWNED_SUITE_TIMEOUT_MS });\n}\n`;
  const fx = fixture({ suites: { s: {} }, files: { 's.mjs': evSuite('s', 10) }, loadtest: legacy });
  const r = fx.run(['--full']);
  assert(r.status === 2 && /OLD way/.test(r.out) && /extract-suites/.test(r.out), 'a loadtest.mjs that still spawns suites the old way is REFUSED (a block appended after the switchover would otherwise never run)', r.out.slice(0, 300));
  assert(fx.events().length === 0, '…and nothing ran');
  fx.cleanup();
});

testCase('runner-unreadable-checkout', async () => {
  // iCloud evicted working-tree files on this machine ("dataless"): a sandboxed process reads them as EMPTY, with no error. A chmod 000 file is the
  // portable stand-in for "stat says it has bytes, a read cannot get them". The runner must stop with the cause — not run suites against a hollow tree.
  const { unreadableFiles } = await lib('tree.mjs');
  const fx = fixture({ suites: { s: {} }, files: { 's.mjs': evSuite('s', 10), 'js/ok.js': 'export {};\n', 'js/hollow.js': 'export const x = 1;\n' } });
  const hollow = path.join(fx.cfb, 'js', 'hollow.js');
  assert(JSON.stringify(unreadableFiles(fx.root)) === '[]', 'a healthy checkout reports no unreadable files');
  chmodSync(hollow, 0o000);
  const canRead = (() => { try { readFileSync(hollow); return true; } catch { return false; } })();
  if (!canRead) {
    assert(JSON.stringify(unreadableFiles(fx.root)) === '["cfb-pickems/js/hollow.js"]', 'a non-empty file whose bytes cannot be read is reported by name');
    const r = fx.run(['--quick']);
    assert(r.status === 2 && /cannot be read/.test(r.out) && /hollow\.js/.test(r.out) && /Nothing was run/.test(r.out), 'the runner STOPS (exit 2) with the cause and the path, before running anything', r.out.slice(0, 300));
    assert(fx.events().length === 0, '…and no suite ran');
    const e = fx.run(['--affected', '--changed', 'cfb-pickems/js/ok.js']);
    assert(e.status === 2, 'the same stop applies to --affected, which would otherwise map a hollow tree and select too little');
    const man = path.join(fx.cfb, 'tests', 'suites', 's.json');
    chmodSync(man, 0o000);
    const mr = fx.run(['--quick']);
    assert(mr.status === 2 && /cannot be read/.test(mr.out) && /tests\/suites\/s\.json/.test(mr.out) && !/is not valid/.test(mr.out), 'an unreadable MANIFEST is reported as unreadable, with its path — the preflight runs BEFORE the manifests load, so it is never misread as an invalid tests/suites', mr.out.slice(0, 300));
    chmodSync(man, 0o644);
  } else {
    assert(true, 'running as a user that ignores file modes (root): the unreadable-file proof is skipped, not faked');
  }
  chmodSync(hollow, 0o644);
  const { buildDepMap } = await lib('depmap.mjs');
  writeFileSync(path.join(fx.cfb, 'js', 'hollow.js'), 'export const x = 1;\n');
  chmodSync(hollow, 0o000);
  if (!canRead) {
    let threw = '';
    try { buildDepMap({ root: fx.root, cfbDir: fx.cfb, suites: new Map([['s', { id: 's', script: 's.mjs', args: [], deps: ['js/hollow.js'] }]]), files: ['cfb-pickems/s.mjs', 'cfb-pickems/js/hollow.js'] }); } catch (err) { threw = err.message; }
    assert(/cannot read cfb-pickems\/js\/hollow\.js/.test(threw), 'the dependency scan refuses to treat an unreadable file as "imports nothing" (it throws, naming the file)', threw);
  }
  chmodSync(hollow, 0o644);
  fx.cleanup();
});

testCase('parity-tool', async () => {
  // tests/parity.mjs is the landing proof (legacy harness vs runner, number for number). It must pass when they agree and say WHICH suite or which
  // identity broke when they do not — a parity tool that cannot fail proves nothing.
  const tool = path.join(ROOT, 'tests', 'parity.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-parity-'));
  tmpRoots.push(dir);
  mkdirSync(path.join(dir, 'suites'));
  for (const id of ['a', 'b', 'testruntest']) writeFileSync(path.join(dir, 'suites', `${id}.json`), JSON.stringify({ id, script: `${id}.mjs`, summary: 'strict', floor: 1 }));
  const suiteLines = (name, got, n = 4) => [`[5] ${name} — spawned as a subprocess…`, `  ✅ ${name} exits 0 (got 0)`, `  ✅ ${name} printed its own pass/fail summary line`, `  ✅ ${name} reports ALL PASS (got: ✅ ALL PASS — ${got} passed, 0 failed)`, `  ✅ ${name} actually ran its full set (got ${got}, floor ${got})`, `  ✅ ${name} reports zero failed assertions`].slice(0, n + 1);
  const legacy = ({ aGot = 10, aLines = 4, verdict = '✅ ALL PASS', total = null } = {}) => ['[1] inline', '  ✅ inline one', '  ✅ inline two', ...suiteLines('a.mjs', aGot, aLines), ...suiteLines('b.mjs', 7, 5), `\n══════\n${verdict} — ${total ?? (2 + aLines + 5)} passed, 0 failed`].join('\n');
  const summary = ({ aChecks = 4, aPassed = 10, core = 2, passed = null, requested = 'full', failed = 0, extra = 5 } = {}) => ({ tier: requested, requested, passed: passed ?? (core + aChecks + 5 + extra), failed, tripwire: [], suites: [{ id: 'a', checks: aChecks, child: { passed: aPassed } }, { id: 'b', checks: 5, child: { passed: 7 } }, { id: 'core', checks: 0, counts: { passed: core, failed: 0 } }, { id: 'testruntest', checks: extra, child: { passed: 99 } }] });
  const go = (l, sm, extraArgs = ['--extra', 'testruntest']) => {
    const lf = path.join(dir, 'legacy.log'), sf = path.join(dir, 'summary.json');
    writeFileSync(lf, l); writeFileSync(sf, JSON.stringify(sm));
    const r = spawnSync(process.execPath, [tool, '--legacy', lf, '--summary', sf, '--suites', path.join(dir, 'suites'), ...extraArgs], { encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const ok = go(legacy(), summary());
  assert(ok.status === 0 && /✅ PARITY/.test(ok.out) && /legacy total 11 = core inline 2 \+ spawned suites' assertions 9/.test(ok.out), 'identical numbers: exit 0 and the arithmetic is shown', ok.out.slice(0, 400));
  const k = go(legacy(), summary({ aChecks: 3, passed: 2 + 3 + 5 + 5 }));
  assert(k.status === 1 && /a: the legacy harness made 4 assertions about it, the runner 3/.test(k.out), 'a suite the runner asserts about differently (3 vs 4) fails and names the suite', k.out.slice(0, 500));
  const c = go(legacy(), summary({ aPassed: 11 }));
  assert(c.status === 1 && /a: the suite reported 10 passed to the legacy harness, 11 to the runner/.test(c.out), 'a suite whose own passed count differs fails and names both numbers', c.out.slice(0, 500));
  const core = go(legacy(), summary({ core: 3, passed: 3 + 4 + 5 + 5 }));
  assert(core.status === 1 && /core inline assertions: the runner counted 3, the legacy total minus the spawned suites' lines is 2/.test(core.out), 'a core that counts one more inline assertion than the legacy harness made fails (the inline side is checked, not just the spawned side)', core.out.slice(0, 500));
  const head = go(legacy(), summary({ passed: 99 }));
  assert(head.status === 1 && /headline: runner 99 − extras 5 = 94, legacy 11/.test(head.out), 'a runner total that is not legacy + extras fails the headline check', head.out.slice(0, 500));
  const un = go(legacy(), summary(), ['--extra', '']);
  assert(un.status === 1 && /testruntest: no legacy lines start with "testruntest\.mjs"/.test(un.out), 'a suite with no legacy lines that is not declared --extra is an error, not silently ignored', un.out.slice(0, 500));
  const red = go(legacy({ verdict: '❌ FAILURES' }), summary());
  assert(red.status === 1 && /the legacy run is not green/.test(red.out), 'a red legacy run cannot be proven equal to anything', red.out.slice(0, 400));
  const q = go(legacy(), summary({ requested: 'quick' }));
  assert(q.status === 1 && /needs --full/.test(q.out), 'a --quick / --affected summary is refused: parity is a statement about the full harness', q.out.slice(0, 400));
  // a fixed-zone re-run (the [125b] shape): its legacy lines START WITH the base suite's name. They are counted for the variant only, and its
  // passed count is read from the one combined line `(got: ✅ ALL PASS — N passed …)`.
  const tzDir = path.join(dir, 'tz');
  mkdirSync(path.join(tzDir, 'suites'), { recursive: true });
  for (const m of [{ id: 'a', script: 'a.mjs', summary: 'strict', floor: 1 }, { id: 'a-tz-X-Y', script: 'a.mjs', summary: 'strict-single', floor: 1, env: { TZ: 'X/Y' } }, { id: 'testruntest', script: 'testruntest.mjs', summary: 'strict', floor: 1 }]) {
    writeFileSync(path.join(tzDir, 'suites', `${m.id}.json`), JSON.stringify(m));
  }
  const tzLegacy = ['[1] inline', '  ✅ inline one', ...suiteLines('a.mjs', 10, 4), '[5b] a.mjs under TZ=X/Y…', '  ✅ a.mjs (TZ=X/Y) exits 0 (got 0)', '  ✅ a.mjs (TZ=X/Y) reports ALL PASS with the same floor (got: ✅ ALL PASS — 10 passed, 0 failed)', '\n══════\n✅ ALL PASS — 7 passed, 0 failed'].join('\n');
  const tzSummary = (vPassed = 10) => ({ tier: 'full', requested: 'full', passed: 1 + 4 + 2 + 5, failed: 0, tripwire: [], suites: [{ id: 'a', checks: 4, child: { passed: 10 } }, { id: 'a-tz-X-Y', checks: 2, child: { passed: vPassed } }, { id: 'core', checks: 0, counts: { passed: 1, failed: 0 } }, { id: 'testruntest', checks: 5, child: { passed: 99 } }] });
  const goTz = (sm) => {
    const lf = path.join(tzDir, 'legacy.log'), sf = path.join(tzDir, 'summary.json');
    writeFileSync(lf, tzLegacy); writeFileSync(sf, JSON.stringify(sm));
    const r = spawnSync(process.execPath, [tool, '--legacy', lf, '--summary', sf, '--suites', path.join(tzDir, 'suites'), '--extra', 'testruntest'], { encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const tzOk = goTz(tzSummary());
  assert(tzOk.status === 0 && /per-suite assertion count equal: 2\/2; per-suite passed count equal: 2\/2/.test(tzOk.out) && /legacy total 7 = core inline 1 \+ spawned suites' assertions 6/.test(tzOk.out),
    'a fixed-zone variant: its 2 lines are counted for IT, the base suite keeps its own 4 (no double count), and its count is read from the combined line', tzOk.out.slice(0, 600));
  const tzBad = goTz(tzSummary(11));
  assert(tzBad.status === 1 && /a-tz-X-Y: the suite reported 10 passed to the legacy harness, 11 to the runner/.test(tzBad.out), 'a variant whose count differs is named, with both numbers', tzBad.out.slice(0, 600));
  const zoned = go(legacy(), { ...summary(), tz: 'X/Y' });
  assert(zoned.status === 1 && /second-zone pass/.test(zoned.out), 'a summary that carries a --tz second-zone pass is refused (parity compares a plain --full in one zone)', zoned.out.slice(0, 400));
  // reached through a symlinked directory (a tmp dir under /var is one on macOS): the entry-point check must compare REAL paths, or the tool silently does nothing and "exits 0"
  symlinkSync(path.join(ROOT, 'tests'), path.join(dir, 'tests-link'));
  writeFileSync(path.join(dir, 'legacy.log'), legacy()); writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary()));
  const viaLink = spawnSync(process.execPath, [path.join(dir, 'tests-link', 'parity.mjs'), '--legacy', path.join(dir, 'legacy.log'), '--summary', path.join(dir, 'summary.json'), '--suites', path.join(dir, 'suites')], { encoding: 'utf8' });
  assert(viaLink.status === 0 && /✅ PARITY/.test(viaLink.stdout || ''), 'run through a symlinked path it still runs (the entry-point check compares real paths) — never a silent no-op exit 0', (viaLink.stdout || '').slice(0, 200));
  const bad = spawnSync(process.execPath, [tool], { encoding: 'utf8' });
  assert(bad.status === 2 && /usage/.test((bad.stdout || '') + (bad.stderr || '')), 'no arguments: exit 2 with usage (never a silent pass)');
});

testCase('runner-no-tier', async () => {
  const fx = fixture({ suites: { s: {} }, files: { 's.mjs': SUMMARY_OK(5) } });
  const r = fx.run([]);
  assert(r.status === 2 && /usage/.test(r.out), 'no tier chosen ⇒ usage and exit 2, never a silent default (a quick result must not be mistaken for a full one)');
  const bad = fx.run(['--wat']);
  assert(bad.status === 2, 'an unknown option is exit 2');
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// D. Tiers and --affected
// ════════════════════════════════════════════════════════════════════════════════════════════
function affectedFixture(extra = {}) {
  const files = {
    'js/a.js': `import './a2.js';\nexport const a = 1;\n`,
    'js/a2.js': `export const a2 = 1;\n`,
    'js/b.js': `export const b = 1;\n`,
    'css/c.css': `.x{}\n`,
    'data/d.json': `{}\n`,
    'js/orphan.js': `export const o = 1;\n`,
    'a.mjs': `import './js/a.js';\n${evSuite('a', 10)}`,
    'b.mjs': `import { readFileSync } from 'node:fs';\nreadFileSync(new URL('./js/b.js', import.meta.url));\n${evSuite('b', 10)}`,
    'bcss.mjs': `import path from 'node:path';\nconst p = path.join(process.cwd(), 'css', 'c.css');\n${evSuite('bcss', 10)}`,
    'dgl.mjs': evSuite('dgl', 10),
    'q.mjs': evSuite('q', 10),
    'qq.mjs': evSuite('qq', 10),
    '../docs/x.md': 'doc\n',
    ...extra.files,
  };
  return fixture({ suites: { a: {}, b: {}, bcss: {}, dgl: { deps: ['data/**'] }, q: { tags: ['smoke'] }, qq: { tags: ['quick'] }, ...extra.suites }, files, loadtest: extra.loadtest });
}
const ran = fx => [...new Set(fx.events().filter(e => e.ev === 'start').map(e => e.id))].sort();

testCase('affected-selects-by-deps', async () => {
  const fx = affectedFixture();
  fx.run(['--affected', '--changed', 'cfb-pickems/js/a.js']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['a', 'q']), `a changed js file selects the suite that imports it + the smoke set (and NOT the quick-only suite) (ran ${JSON.stringify(ran(fx))})`);
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--changed', 'cfb-pickems/js/a2.js']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['a', 'q']), 'a TRANSITIVE import (a.js → a2.js) selects the suite too');
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--changed', 'cfb-pickems/js/b.js']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['b', 'q']), 'a file the suite READS by new URL(…) selects it');
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--changed', 'cfb-pickems/css/c.css']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['bcss', 'q']), 'a file named through path.join(…, \'css\', \'c.css\') selects it');
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--changed', 'cfb-pickems/data/d.json']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['dgl', 'q']), 'a manifest `deps` glob selects its suite');
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--changed', 'cfb-pickems/tests/suites/b.json']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['b', 'q']), 'editing ONE manifest selects that suite (a new suite\'s manifest does not force a full run)');
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--strict-quick', '--changed', 'cfb-pickems/js/b.js']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['b', 'q', 'qq']), '--strict-quick adds the WHOLE quick set to an affected run (the literal reading of "always include the quick set")');
  fx.cleanup();
});

testCase('affected-unmapped-falls-back-full', async () => {
  const fx = affectedFixture();
  const r = fx.run(['--affected', '--allow-full', '--changed', 'cfb-pickems/js/orphan.js']);   // M-42 (D-75): without --allow-full it stops (affected-full-fallback-stops)
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['a', 'b', 'bcss', 'dgl', 'q', 'qq']), `a changed file NO suite reads falls back to the FULL run (ran ${JSON.stringify(ran(fx))})`);
  assert(/FALLBACK TO --full/.test(r.out) && /orphan\.js/.test(r.out), '…and says which file and why');
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--allow-full', '--changed', 'cfb-pickems/js/a.js,cfb-pickems/js/orphan.js']);
  assert(ran(fx).length === 6, 'ONE unmapped file among mapped ones is enough to go full');
  fx.cleanup();
});

testCase('affected-runner-change-is-full', async () => {
  for (const f of ['cfb-pickems/testrun.mjs', 'cfb-pickems/tests/lib/evaluate.mjs', 'cfb-pickems/loadtest.mjs', 'cfb-pickems/tests/extract-suites.mjs']) {
    const fx = affectedFixture();
    const r = fx.run(['--affected', '--allow-full', '--changed', f]);
    assert(ran(fx).length === 6 && /FALLBACK TO --full/.test(r.out), `a change to ${f} (the runner / the core harness) runs everything (with --allow-full; without it the run stops, M-42)`);
    fx.cleanup();
  }
});

testCase('affected-inert-docs', async () => {
  const fx = affectedFixture();
  const r = fx.run(['--affected', '--changed', 'docs/x.md']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['q']) && !/FALLBACK/.test(r.out), 'a docs-only change no suite reads runs the quick set only (not a full run)', r.out.slice(0, 300));
  const strict = affectedFixture();
  const rs = strict.run(['--affected', '--changed', 'docs/x.md', '--strict-inert', '--allow-full']);
  assert(ran(strict).length === 6 && /FALLBACK/.test(rs.out), '--strict-inert restores the literal rule: no suite reads it ⇒ full');
  fx.cleanup(); strict.cleanup();
});

testCase('affected-git', async () => {
  const fx = affectedFixture();
  const git = (...a) => spawnSync('git', a, { cwd: fx.root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  writeFileSync(path.join(fx.cfb, 'js', 'b.js'), 'export const b = 2;\n');                 // uncommitted
  fx.run(['--affected']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['b', 'q']), 'with no --base, the UNCOMMITTED change is what gets mapped');
  git('add', '-A'); git('commit', '-q', '-m', 'edit b');
  writeFileSync(fx.fxLog, '');
  const clean = fx.run(['--affected']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['q']) && /no changes detected/.test(clean.out), 'a clean tree with no --base runs the quick set and SAYS nothing was mapped');
  writeFileSync(fx.fxLog, '');
  fx.run(['--affected', '--base', base]);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['b', 'q']), '--base <ref> maps what was COMMITTED since the merge-base (git diff base...HEAD)');
  writeFileSync(path.join(fx.cfb, 'js', 'new.js'), 'export {};\n');                          // untracked
  writeFileSync(fx.fxLog, '');
  const u = fx.run(['--affected', '--base', base, '--allow-full']);
  assert(/FALLBACK/.test(u.out) && /new\.js/.test(u.out), 'an UNTRACKED new file is part of the diff (and, read by nothing, forces the full run)');
  const bad = fx.run(['--affected', '--base', 'no-such-ref']);
  assert(bad.status === 2, 'a typo\'d --base is a loud error, not a silent empty diff');
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// W-22 (2026-10-08): `--affected` fell back to `--full` whenever loadtest.mjs was in the diff — and every branch that adds a module edits
// section [1]'s import list, so four builders ran the whole suite in one day without meaning to. An edit CONFINED to that list (module
// entries and comments, nothing else, nothing outside it) runs the [1] module load and the suites that read loadtest.mjs; any other edit
// to the file still means everything.
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('loadtest-edit-classify', async () => {
  const { classifyLoadtestEdit } = await lib('depmap.mjs');
  const base = coreWithList({ entries: ["  'b',"] });
  const c = head => classifyLoadtestEdit(base, head);
  const add = c(coreWithList({ entries: ["  'b',", "  'c', 'sports/d',"] }));
  assert(add.listOnly === true && JSON.stringify(add.added) === '["c","sports/d"]', 'new module entries inside the list are a list-only edit, and the new modules are named', JSON.stringify(add));
  assert(c(coreWithList({ entries: ["  // D1 (2026-10-08): why this module is here", "  'b',", "  'c', // its comment"] })).listOnly === true, 'a comment line, and an entry with a trailing comment, are list-only too');
  const rm = c(coreWithList({ entries: [] }));
  assert(rm.listOnly === true && JSON.stringify(rm.removed) === '["b"]', 'a removed entry is list-only, and named', JSON.stringify(rm));
  assert(c(base).listOnly === true, 'no change at all inside the file is list-only (vacuously)');
  const out = c(coreWithList({ entries: ["  'b',"], after: 'const extra = 1;' }));
  assert(out.listOnly === false && /below/.test(out.why), 'an edit BELOW the list is not list-only (and says where)', JSON.stringify(out));
  const above = c(coreWithList({ entries: ["  'b',"], before: 'globalThis.x = 1;' }));
  assert(above.listOnly === false && /above/.test(above.why), 'an edit ABOVE the list is not list-only', JSON.stringify(above));
  assert(c(coreWithList({ entries: ["  'b',", "  'c',"], after: 'const extra = 1;' })).listOnly === false, 'a MIXED edit (a list entry plus a line outside the list) is not list-only');
  assert(c(base.replace("for (const m of ['a',", "for (const m of ['a', 'z',")).listOnly === false, 'an edit ON the line that opens the list is not list-only (it is not inside the list)');
  for (const [label, line] of [['a spread of a call', '  ...(await import(\'node:os\')).x || [],'], ['a template literal', '  `${globalThis.x}`,'], ['an expression', "  'x' + globalThis.y,"], ['a block comment', '  /* hidden */ \'x\','], ['a closed list followed by code', ']) {} globalThis.z = 1; for (const m of [']]) {
    assert(c(coreWithList({ entries: ["  'b',", line] })).listOnly === false, `a changed line inside the list that is ${label}, not a module entry or a comment, is not list-only`);
  }
  assert(c(coreWithList({ entries: ["  'b',", ']) {', '  globalThis.z = 1;', '}', "for (const m of ['q',"] })).listOnly === false, 'a list closed early, then code, then a new list (every added line inside the old bounds) is not list-only: the tail below the list no longer matches');
  assert(c(base.replace('[1] Importing all modules', '[1] Loading modules')).listOnly === false && classifyLoadtestEdit(null, base).listOnly === false, 'no list found (or no base to compare with) is never list-only');
  // the REAL loadtest.mjs: the classifier recognises its [1] list (if the file is restructured, this goes red instead of every module edit silently running --full again)
  const real = readFileSync(path.join(REAL, 'loadtest.mjs'), 'utf8');
  const anchor = "  'account-exit',\n]) {";
  assert(real.includes(anchor), 'fixture: the real [1] list ends with the account-exit entry and its closing line');
  const realAdd = classifyLoadtestEdit(real, real.replace(anchor, "  // W-22 probe\n  'zz-probe',\n" + anchor));
  assert(realAdd.listOnly === true && JSON.stringify(realAdd.added) === '["zz-probe"]', 'on the REAL loadtest.mjs, a module added to section [1]\'s list is a list-only edit', JSON.stringify(realAdd));
  const realOut = classifyLoadtestEdit(real, real.replace("console.log('\\n[1b] ", "console.log('\\n[1b]  "));
  assert(realOut.listOnly === false, 'on the REAL loadtest.mjs, an edit to section [1b] is not', JSON.stringify(realOut));
});

testCase('affected-loadtest-list-only', async () => {
  const fx = fixture({
    suites: { a: {}, b: {}, pin: {}, wide: {}, q: { tags: ['smoke'] } },
    loadtest: coreWithList({ entries: [] }),
    files: {
      'js/a.js': 'export const a = 1;\n',
      'js/b.js': 'export const b = 1;\n',
      'a.mjs': `import './js/a.js';\n${evSuite('a', 10)}`,
      'b.mjs': `import { readFileSync } from 'node:fs';\nreadFileSync(new URL('./js/b.js', import.meta.url));\n${evSuite('b', 10)}`,
      // pins section [1]'s list by reading loadtest.mjs by name (accountexittest [11x] and leaguesettingsuitest [6zc] do)
      'pin.mjs': `import { readFileSync } from 'node:fs';\nreadFileSync(new URL('./loadtest.mjs', import.meta.url));\n${evSuite('pin', 10)}`,
      // reaches every top-level file only through a wildcard (most of the real suites reach loadtest.mjs this way)
      'wide.mjs': `import { readdirSync, readFileSync } from 'node:fs';\nfor (const f of readdirSync('.')) if (f.endsWith('.json')) readFileSync(\`./\${f}\`);\n${evSuite('wide', 10)}`,
      'q.mjs': evSuite('q', 10),
    },
  });
  const git = (...a) => spawnSync('git', a, { cwd: fx.root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  const LT = path.join(fx.cfb, 'loadtest.mjs');
  const baseLt = readFileSync(LT, 'utf8');
  const go = (args = ['--affected', '--base', base]) => { writeFileSync(fx.fxLog, ''); const r = fx.run(args); return { r, ran: ran(fx) }; };
  const ALL = ['a', 'b', 'core:full', 'pin', 'q', 'wide'];

  // 1. an EXISTING module joins the list: loadtest.mjs is the only changed file
  writeFileSync(LT, coreWithList({ entries: ["  // the new entry's comment", "  'b',"] }));
  const one = go();
  assert(!/FALLBACK/.test(one.r.out) && one.r.status === 0, 'a list-only edit to loadtest.mjs does NOT fall back to the full run', one.r.out.slice(0, 600));
  assert(one.ran.includes('core:full') || one.ran.includes('core:load'), 'it runs the [1] module load (core-load, or the core that contains it)', JSON.stringify(one.ran));
  assert(one.ran.includes('pin') && one.ran.includes('q'), '…the suites that read loadtest.mjs by name (the list\'s pins) and the smoke set', JSON.stringify(one.ran));
  assert(!one.ran.includes('a') && !one.ran.includes('b') && !one.ran.includes('wide'), '…and nothing the diff does not reach (not a suite that only globs the directory loadtest.mjs sits in)', JSON.stringify(one.ran));
  assert(/section \[1\]'s import list/.test(one.r.out), 'the run says why it did not go full', one.r.out.slice(0, 600));

  // 2. a NEW module: the list entry plus the module, wired into js/a.js — the module's diff maps as it always did
  writeFileSync(LT, coreWithList({ entries: ["  'c',"] }));
  writeFileSync(path.join(fx.cfb, 'js', 'c.js'), 'export const c = 1;\n');
  writeFileSync(path.join(fx.cfb, 'js', 'a.js'), "import './c.js';\nexport const a = 1;\n");
  const two = go();
  assert(!/FALLBACK/.test(two.r.out) && JSON.stringify(two.ran) === JSON.stringify(['a', 'core:full', 'pin', 'q']), 'a new module added to the list: the [1] load + the list\'s pins + the suites the module and its importer map to — no full run', JSON.stringify(two.ran) + ' ' + two.r.out.slice(0, 400));
  rmSync(path.join(fx.cfb, 'js', 'c.js'));
  writeFileSync(path.join(fx.cfb, 'js', 'a.js'), 'export const a = 1;\n');

  // 3. an edit OUTSIDE the list, 4. a MIXED edit, 5. code (not an entry) inside the list: every one still means everything
  for (const [label, text] of [
    ['an edit outside section [1]\'s list', coreWithList({ entries: [], after: 'const extra = 1;' })],
    ['a mixed edit (a list entry AND a line outside the list)', coreWithList({ entries: ["  'b',"], after: 'const extra = 1;' })],
    ['code inside the list (not a module entry)', coreWithList({ entries: ["  ...(globalThis.more || []),"] })],
  ]) {
    writeFileSync(LT, text);
    const x = go(['--affected', '--base', base, '--allow-full']);   // M-42 (D-75): without --allow-full these stop instead
    assert(/FALLBACK TO --full/.test(x.r.out) && /loadtest\.mjs/.test(x.r.out) && JSON.stringify(x.ran) === JSON.stringify(ALL), `${label} still falls back to the FULL run, naming loadtest.mjs`, JSON.stringify(x.ran) + ' ' + x.r.out.slice(0, 500));
  }

  // 6. --changed: with --base the list-only rule applies (the base is known); without one there is nothing to compare with, so it is full
  writeFileSync(LT, coreWithList({ entries: ["  'b',"] }));
  const ch = go(['--affected', '--base', base, '--changed', 'cfb-pickems/loadtest.mjs']);
  assert(!/FALLBACK/.test(ch.r.out) && ch.ran.includes('pin'), '--changed loadtest.mjs with --base: a list-only edit is recognised', JSON.stringify(ch.ran));
  writeFileSync(LT, coreWithList({ entries: [], after: 'const extra = 1;' }));
  git('add', '-A'); git('commit', '-q', '-m', 'an outside edit, committed');
  const nb = go(['--affected', '--allow-full', '--changed', 'cfb-pickems/loadtest.mjs']);
  assert(/FALLBACK TO --full/.test(nb.r.out) && JSON.stringify(nb.ran) === JSON.stringify(ALL), '--changed loadtest.mjs WITHOUT --base: no base to compare with, so the full run (never "HEAD", which already holds the committed edit)', JSON.stringify(nb.ran) + ' ' + nb.r.out.slice(0, 400));
  writeFileSync(LT, baseLt);
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// M-42 (Drew, 2026-10-14, D-75): an --affected run that would fall back to the full run STOPS instead: exit non-zero, nothing run, the
// reason, and the faster run: the same diff without the files that caused the stop (loadtest.mjs, the runner's own files) as --changed, and
// --only the suites that test what that leaves out. --allow-full is the deliberate way to run everything.
// On 2026-10-14 three builders' --affected runs went silently full (a loadtest.mjs edit below section [1]'s list), each about 18 minutes,
// and slowed every other run on the machine. --full and the gates are unchanged.
// ════════════════════════════════════════════════════════════════════════════════════════════
const gitIn = dir => (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const printedChanged = out => (/^\s*(node testrun\.mjs --affected --changed .+)$/m.exec(out) || [])[1] || null;
/** The printed `node testrun.mjs --only a,b,c …` command and its ids, or null. */
const printedOnly = out => { const m = /^\s*(node testrun\.mjs --only (\S+).*)$/m.exec(out); return m ? { cmd: m[1], ids: m[2].split(',') } : null; };
/** Paste a printed command into a shell, as a person would (cwd cfb-pickems/; `node` is this Node). */
const runPrinted = (fx, cmd, extraEnv = {}) => {
  const r = spawnSync('/bin/sh', ['-c', cmd.replace(/^node /, `'${process.execPath}' `)], { cwd: fx.cfb, env: fx.env(extraEnv), encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
/** A held stand-in for the runner's self-test, shaped like the real manifest (D-76): it names loadtest.mjs, like the real one. */
const HELD_SELFTEST = { deps: ['testrun.mjs', 'testruntest.mjs', 'tests/lib/**', 'tests/suites/**', 'loadtest.mjs'], affectedByDepsOnly: true };

testCase('affected-full-fallback-stops', async () => {
  const fx = affectedFixture({
    loadtest: coreWithList({ entries: [] }),
    // pin reads loadtest.mjs by name, as accountexittest, leaguesettingsuitest, newstest, scribeprofiletest and functions.check do
    // runnerrepotest: a stand-in for the runner's real-tree checks (M-49), which import the runner and so are what a runner change can break
    suites: { pin: {}, testruntest: HELD_SELFTEST, runnerrepotest: {} },
    files: { 'pin.mjs': `import { readFileSync } from 'node:fs';\nreadFileSync(new URL('./loadtest.mjs', import.meta.url));\n${evSuite('pin', 10)}`, 'testruntest.mjs': evSuite('testruntest', 10), 'runnerrepotest.mjs': evSuite('runnerrepotest', 10) },
  });
  const git = gitIn(fx.root);
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  const LT = path.join(fx.cfb, 'loadtest.mjs');
  const baseLt = readFileSync(LT, 'utf8');
  const go = (args, extraEnv = {}) => { writeFileSync(fx.fxLog, ''); const r = fx.run(args, extraEnv); return { r, ran: ran(fx) }; };
  const runIt = cmd => { writeFileSync(fx.fxLog, ''); const r = cmd ? runPrinted(fx, cmd) : { status: null, out: '' }; return { ...r, ran: ran(fx) }; };

  // 1. the trigger of 2026-10-14: loadtest.mjs edited BELOW section [1]'s list, plus work the rest of the diff reaches (a css file, and an
  //    untracked note whose path has spaces: the printed command must survive being pasted into a shell)
  writeFileSync(LT, coreWithList({ entries: [], after: 'const extra = 1;' }));
  writeFileSync(path.join(fx.cfb, 'css', 'c.css'), '.y{}\n');
  mkdirSync(path.join(fx.root, 'weekly bug fixes and feedback'), { recursive: true });
  writeFileSync(path.join(fx.root, 'weekly bug fixes and feedback', 'note 1.md'), 'a note\n');
  const one = go(['--affected', '--base', base]);
  assert(one.r.status !== 0 && one.r.status !== null, '(a) an --affected run that would fall back to the full run exits NON-ZERO', `status ${one.r.status}`);
  assert(one.ran.length === 0 && one.r.verdict === null, '(a) …and runs NOTHING: no suite started, and no ALL PASS line that could be read as a result', JSON.stringify(one.ran) + ' ' + one.r.out.slice(0, 300));
  assert(/STOPPED/.test(one.r.out) && /loadtest\.mjs/.test(one.r.out) && /below section \[1\]'s import list/.test(one.r.out), '(a) it prints the reason: loadtest.mjs changed below section [1]\'s import list', one.r.out.slice(0, 700));
  const cmd = printedChanged(one.r.out);
  assert(cmd !== null, '(a) it prints the faster command: node testrun.mjs --affected --changed <the diff without loadtest.mjs>', one.r.out.slice(0, 900));
  assert(!!cmd && !/loadtest\.mjs/.test(cmd) && cmd.includes('cfb-pickems/css/c.css') && cmd.includes('weekly bug fixes and feedback/note 1.md'), '(a) its --changed list is exactly the diff minus loadtest.mjs: every other changed file, tracked or not', String(cmd));
  assert(/--allow-full/.test(one.r.out), '(a) it names --allow-full, the deliberate way to run everything');
  const fast = runIt(cmd);
  assert(fast.status === 0 && JSON.stringify(fast.ran) === JSON.stringify(['bcss', 'q']) && !/FALLBACK|STOPPED/.test(fast.out), '(a) the printed command, pasted into a shell as printed (the spaced path quoted), runs the suites the rest of the diff reaches plus the smoke set: not the full run', `status ${fast.status} ran ${JSON.stringify(fast.ran)} ${fast.out.slice(0, 400)}`);
  const only1 = printedOnly(one.r.out);
  assert(!!only1 && JSON.stringify(only1.ids) === JSON.stringify(['core', 'pin', 'testruntest']), '(a, N4) and --only what tests loadtest.mjs itself, which that diff does not reach: the core (its sections) and every suite that reads loadtest.mjs by name (W-22\'s list-only set: pin here; core-load is inside core)', JSON.stringify(only1) + ' ' + one.r.out.slice(0, 900));
  const onlyRun = runIt(only1 && only1.cmd);
  assert(onlyRun.status === 0 && JSON.stringify(onlyRun.ran) === JSON.stringify(['core:full', 'pin', 'testruntest']), '(a) …which runs exactly those', `status ${onlyRun.status} ran ${JSON.stringify(onlyRun.ran)}`);

  // 2. the rest of the diff already reaches the core (a js/ module it loads): the --only list leaves the core out, keeps the rest (N4)
  writeFileSync(path.join(fx.cfb, 'js', 'b.js'), 'export const b = 2;\n');
  const two = go(['--affected', '--base', base]);
  const cmd2 = printedChanged(two.r.out), only2 = printedOnly(two.r.out);
  assert(two.r.status !== 0 && two.ran.length === 0 && !!cmd2 && cmd2.includes('cfb-pickems/js/b.js') && !!only2 && JSON.stringify(only2.ids) === JSON.stringify(['pin', 'testruntest']), '(a, N4) when the rest of the diff reaches the core already, the --only list drops the core and keeps what that diff does not reach', JSON.stringify(only2) + ' ' + two.r.out.slice(0, 700));

  // 3. loadtest.mjs is the whole diff: nothing to list, so the --only command alone
  writeFileSync(path.join(fx.cfb, 'css', 'c.css'), '.x{}\n');
  writeFileSync(path.join(fx.cfb, 'js', 'b.js'), 'export const b = 1;\n');
  rmSync(path.join(fx.root, 'weekly bug fixes and feedback'), { recursive: true, force: true });
  const three = go(['--affected', '--base', base]);
  const only3 = printedOnly(three.r.out);
  assert(three.r.status !== 0 && three.ran.length === 0 && printedChanged(three.r.out) === null && !!only3 && JSON.stringify(only3.ids) === JSON.stringify(['core', 'pin', 'testruntest']) && /nothing but loadtest\.mjs changed/.test(three.r.out), '(a) loadtest.mjs alone: no --changed command (it says nothing else changed), the --only command only', three.r.out.slice(0, 700));
  writeFileSync(LT, baseLt);

  // 4. every other silent fallback stops too, with wording keyed to its reason (B2)
  //  a file no suite reads: no smaller run can cover it
  const un = go(['--affected', '--changed', 'cfb-pickems/other/z.txt']);
  assert(un.r.status !== 0 && un.ran.length === 0 && /other\/z\.txt/.test(un.r.out) && printedChanged(un.r.out) === null && printedOnly(un.r.out) === null && /no faster run: no suite reads/.test(un.r.out) && /--allow-full/.test(un.r.out), '(a) a file no suite reads stops too: the reason names it, the advice says no suite reads it (so no smaller run covers it), --allow-full is named', un.r.out.slice(0, 700));
  //  a runner file plus app work: the diff without the runner files as --changed, plus --only the runner's own tests (testruntest, and since
  //  M-49 runnerrepotest: the real-tree checks import the runner, so a runner change can break them)
  const rf = go(['--affected', '--changed', 'cfb-pickems/testrun.mjs,cfb-pickems/js/a.js']);
  const rcmd = printedChanged(rf.r.out), ronly = printedOnly(rf.r.out);
  assert(rf.r.status !== 0 && rf.ran.length === 0 && /testrun\.mjs is part of the runner/.test(rf.r.out), '(a) a change to the runner itself stops, naming the file', rf.r.out.slice(0, 700));
  assert(!!rcmd && !/--changed \S*cfb-pickems\/testrun\.mjs/.test(rcmd) && rcmd.includes('cfb-pickems/js/a.js') && /the same diff without the runner's own files \(testrun\.mjs\)/.test(rf.r.out), '(B2) …and offers the same diff without the runner\'s own files as --changed, saying which files it left out', rf.r.out.slice(0, 900));
  assert(!!ronly && JSON.stringify(ronly.ids) === JSON.stringify(['runnerrepotest', 'testruntest']), '(B2, M-49) …plus node testrun.mjs --only runnerrepotest,testruntest, the runner\'s own tests, which that diff does not reach', JSON.stringify(ronly) + ' ' + rf.r.out.slice(0, 900));
  const rfast = runIt(rcmd), rself = runIt(ronly && ronly.cmd);
  assert(rfast.status === 0 && JSON.stringify(rfast.ran) === JSON.stringify(['a', 'core:full', 'q']) && rself.status === 0 && JSON.stringify(rself.ran) === JSON.stringify(['runnerrepotest', 'testruntest']), '(B2) both printed commands run, and together they are the right run for a runner change (no full run)', `${JSON.stringify(rfast.ran)} ${JSON.stringify(rself.ran)} ${rfast.out.slice(0, 200)}`);
  //  a runner file alone: nothing else to list, --only the runner's own tests
  const ra = go(['--affected', '--changed', 'cfb-pickems/tests/lib/evaluate.mjs']);
  const raOnly = printedOnly(ra.r.out);
  assert(ra.r.status !== 0 && printedChanged(ra.r.out) === null && !!raOnly && JSON.stringify(raOnly.ids) === JSON.stringify(['runnerrepotest', 'testruntest']) && /nothing but the runner's own files \(tests\/lib\/evaluate\.mjs\) changed/.test(ra.r.out), '(B2) a runner file alone: no --changed command (it says only the runner\'s own files changed), --only the runner\'s own tests', ra.r.out.slice(0, 700));
  //  the extractor is a stopping file too (review round 2, note 1)
  const ex = go(['--affected', '--changed', 'cfb-pickems/tests/extract-suites.mjs']);
  const exOnly = printedOnly(ex.r.out);
  assert(ex.r.status !== 0 && ex.ran.length === 0 && /tests\/extract-suites\.mjs is part of the runner/.test(ex.r.out) && printedChanged(ex.r.out) === null && !!exOnly && JSON.stringify(exOnly.ids) === JSON.stringify(['runnerrepotest', 'testruntest']), '(note 1) tests/extract-suites.mjs stops --affected too, naming it, and offers --only the runner\'s own tests', ex.r.out.slice(0, 700));
  //  …minus what the rest of the diff already reaches (testruntest's own script changed too: only runnerrepotest is left to offer)
  const rt = go(['--affected', '--changed', 'cfb-pickems/testrun.mjs,cfb-pickems/testruntest.mjs']);
  const rtCmd = printedChanged(rt.r.out), rtOnly = printedOnly(rt.r.out);
  assert(rt.r.status !== 0 && !!rtCmd && rtCmd.includes('cfb-pickems/testruntest.mjs') && !!rtOnly && JSON.stringify(rtOnly.ids) === JSON.stringify(['runnerrepotest']), '(B2) when that diff already reaches testruntest (its own script changed), the --only command leaves it out', rt.r.out.slice(0, 700));
  //  the selection options are carried into every printed command (N3)
  const zone = 'Pacific/Kiritimati';
  const carried = go(['--affected', '--strict-inert', '--strict-quick', '--tz', zone, '--changed', 'cfb-pickems/testrun.mjs,cfb-pickems/js/a.js'], { TZ: 'UTC' });
  const ccmd = printedChanged(carried.r.out) || '', conly = (printedOnly(carried.r.out) || {}).cmd || '';
  assert(/ --strict-inert\b/.test(ccmd), '(N3) --strict-inert is carried into the printed --changed command', ccmd);
  assert(/ --strict-quick\b/.test(ccmd), '(N3) --strict-quick is carried into the printed --changed command', ccmd);
  assert(ccmd.includes(` --tz ${zone}`) && conly.includes(` --tz ${zone}`), '(N3) --tz is carried into the printed --changed command and the --only command', `${ccmd} | ${conly}`);

  // 5. --full is unchanged: it runs everything without asking (the held self-test included)
  const full = go(['--full']);
  assert(full.r.status === 0 && JSON.stringify(full.ran) === JSON.stringify(['a', 'b', 'bcss', 'core:full', 'dgl', 'pin', 'q', 'qq', 'runnerrepotest', 'testruntest']) && !/STOPPED/.test(full.r.out), '--full is unchanged: everything, no stop', JSON.stringify(full.ran));
  fx.cleanup();
});

testCase('affected-allow-full', async () => {
  const fx = affectedFixture({ loadtest: coreWithList({ entries: [] }) });
  const git = gitIn(fx.root);
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  const go = args => { writeFileSync(fx.fxLog, ''); const r = fx.run(args); return { r, ran: ran(fx) }; };
  const ALL = ['a', 'b', 'bcss', 'core:full', 'dgl', 'q', 'qq'];
  writeFileSync(path.join(fx.cfb, 'loadtest.mjs'), coreWithList({ entries: [], after: 'const extra = 1;' }));
  writeFileSync(path.join(fx.cfb, 'css', 'c.css'), '.y{}\n');
  const lt = go(['--affected', '--base', base, '--allow-full']);
  assert(lt.r.status === 0 && JSON.stringify(lt.ran) === JSON.stringify(ALL) && /FALLBACK TO --full/.test(lt.r.out) && !/STOPPED/.test(lt.r.out), '(b) --allow-full lets the fallback proceed: the full run, saying why, as before', JSON.stringify(lt.ran) + ' ' + lt.r.out.slice(0, 500));
  const un = go(['--affected', '--allow-full', '--changed', 'cfb-pickems/other/z.txt']);
  assert(un.r.status === 0 && JSON.stringify(un.ran) === JSON.stringify(ALL), '(b) …for any fallback reason (a file no suite reads)', JSON.stringify(un.ran));
  const mapped = go(['--affected', '--allow-full', '--changed', 'cfb-pickems/js/a.js']);
  assert(mapped.r.status === 0 && JSON.stringify(mapped.ran) === JSON.stringify(['a', 'core:full', 'q']) && !/FALLBACK/.test(mapped.r.out), '(b) …and changes nothing when the diff does not fall back (the affected set only)', JSON.stringify(mapped.ran));
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// M-43 (Drew, 2026-10-14, D-76): a manifest with "affectedByDepsOnly": true is selected by --affected only when a file its own "deps" (or its
// own script) names changes. testruntest, the runner's five-minute self-test, maps to every file in the repo, so it ran in every builder's
// --affected run (three at once on 2026-10-14: load near 350, four false timeouts). The generated map still records everything the suite
// reads (--explain, --check-deps); only the --affected selection is held. Every --full still runs it.
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('affected-deps-gate', async () => {
  const fx = fixture({
    loadtest: coreWithList({ entries: [] }),
    // the held suite must be testruntest: the schema allows the key on no other suite (B1, D-76)
    suites: { a: {}, pin: {}, q: { tags: ['smoke'] }, testruntest: { deps: ['rtlib/**'], affectedByDepsOnly: true } },
    files: {
      'js/a.js': 'export const a = 1;\n',
      'js/deep/onlyrt.txt': 'read only by the held suite\n',
      'rtlib/h.mjs': 'export {};\n',
      'a.mjs': `import './js/a.js';\n${evSuite('a', 10)}`,
      'pin.mjs': `import { readFileSync } from 'node:fs';\nreadFileSync(new URL('./loadtest.mjs', import.meta.url));\n${evSuite('pin', 10)}`,
      // like testruntest: it reads far more than it is held to (every file under js/, and loadtest.mjs by name)
      'testruntest.mjs': `import { readdirSync, readFileSync } from 'node:fs';\nfor (const f of readdirSync(new URL('./js/', import.meta.url))) void f;\nreadFileSync(new URL('./loadtest.mjs', import.meta.url));\n${evSuite('testruntest', 10)}`,
      'q.mjs': evSuite('q', 10),
    },
  });
  const git = gitIn(fx.root);
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  const LT = path.join(fx.cfb, 'loadtest.mjs');
  const baseLt = readFileSync(LT, 'utf8');
  const go = args => { writeFileSync(fx.fxLog, ''); const r = fx.run(args); return { r, ran: ran(fx) }; };

  const ex = fx.run(['--explain', 'testruntest']);
  assert(/cfb-pickems\/js\/a\.js/.test(ex.out) && /affectedByDepsOnly/.test(ex.out) && /cfb-pickems\/rtlib\/\*\*/.test(ex.out), 'control: the map still reaches js/a.js for the held suite (it reads js/), and --explain says what its --affected selection is held to', ex.out.slice(0, 500));
  // (c) app files the held suite reads do not select it
  const c = go(['--affected', '--changed', 'cfb-pickems/js/a.js']);
  assert(c.r.status === 0 && JSON.stringify(c.ran) === JSON.stringify(['a', 'core:full', 'q']), '(c) a diff of app files only (js/a.js, which the held suite reads) does NOT select it', JSON.stringify(c.ran) + ' ' + c.r.out.slice(0, 400));
  assert(/affectedByDepsOnly/.test(c.r.out) && /\btestruntest\b/.test(c.r.out), '(c) …and the run says it held testruntest back', c.r.out.slice(0, 500));
  // (c) a list-only loadtest.mjs edit selects the suites that read loadtest.mjs by name, but not a held suite whose deps do not name it
  writeFileSync(LT, coreWithList({ entries: ["  'b',"] }));
  const l = go(['--affected', '--base', base]);
  assert(l.r.status === 0 && l.ran.includes('pin') && !l.ran.includes('testruntest'), '(c) a list-only loadtest.mjs edit selects pin (it reads loadtest.mjs by name) but not the held suite (it does too, but its deps do not name loadtest.mjs)', JSON.stringify(l.ran) + ' ' + l.r.out.slice(0, 400));
  writeFileSync(LT, baseLt);
  // (d) a file its deps name, its own script, its own manifest: each selects it
  for (const [f, why] of [['cfb-pickems/rtlib/h.mjs', 'a file its deps name'], ['cfb-pickems/testruntest.mjs', 'its own script'], ['cfb-pickems/tests/suites/testruntest.json', 'its own manifest']]) {
    const d = go(['--affected', '--changed', f]);
    assert(d.r.status === 0 && d.ran.includes('testruntest'), `(d) ${why} (${f}) selects it`, JSON.stringify(d.ran) + ' ' + d.r.out.slice(0, 300));
  }
  // (e) the full run, and an --affected run allowed to fall back to it, always run it
  const e = go(['--full']);
  assert(e.r.status === 0 && e.ran.includes('testruntest'), '(e) --full runs it', JSON.stringify(e.ran));
  const ef = go(['--affected', '--allow-full', '--changed', 'cfb-pickems/other/z.txt']);
  assert(ef.r.status === 0 && ef.ran.includes('testruntest'), '(e) …and so does an --affected run allowed to fall back to the full run', JSON.stringify(ef.ran));
  // a file ONLY the held suite reads is read by no suite that will run: the --affected safety net must still catch it (not run the smoke set alone)
  const only = go(['--affected', '--changed', 'cfb-pickems/js/deep/onlyrt.txt']);
  assert(only.r.status !== 0 && only.ran.length === 0 && /onlyrt\.txt/.test(only.r.out), 'a file only the held suite reads counts as read by no suite: the run stops and names it (never a silent smoke-only run)', JSON.stringify(only.ran) + ' ' + only.r.out.slice(0, 400));
  fx.cleanup();
});

testCase('depmap-extractors', async () => {
  // regressions found by --check-deps on the real tree: an import list with a comment holding an apostrophe, and a suite that COPIES a whole directory
  const { buildDepMap, missedByMap } = await lib('depmap.mjs');
  const files = ['cfb-pickems/s.mjs', 'cfb-pickems/cp.mjs', 'cfb-pickems/js/a.js', 'cfb-pickems/js/b.js', 'cfb-pickems/js/c.js', 'cfb-pickems/js/sub/d.js', 'cfb-pickems/other/z.js'];
  const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-depmap-'));
  tmpRoots.push(dir);
  const put = (rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); };
  put('cfb-pickems/s.mjs', "import { a } from './js/a.js';\n");
  put('cfb-pickems/js/a.js', "import {\n  x, // we don't re-export this one; it's internal\n  y,\n} from './b.js';\nimport './c.js';\nexport const a = 1;\n");
  put('cfb-pickems/js/b.js', 'export const x = 1, y = 2;\n');
  put('cfb-pickems/js/c.js', 'export {};\n');
  put('cfb-pickems/js/sub/d.js', 'export {};\n');
  put('cfb-pickems/other/z.js', 'export {};\n');
  put('cfb-pickems/cp.mjs', "import { cp } from 'node:fs/promises';\nawait cp(new URL('./js/', import.meta.url), '/tmp/x', { recursive: true });\n");
  put('cfb-pickems/root.mjs', "console.log('serves the app');\n");
  files.push('cfb-pickems/root.mjs');
  const suites = new Map([['s', { id: 's', script: 's.mjs', args: [], deps: [] }], ['cp', { id: 'cp', script: 'cp.mjs', args: [], deps: [] }], ['root', { id: 'root', script: 'root.mjs', args: [], deps: ['js/a.js'] }]]);
  const map = buildDepMap({ root: dir, cfbDir: path.join(dir, 'cfb-pickems'), suites, files });
  const s1 = map.get('s').files;
  assert(s1.has('cfb-pickems/js/b.js') && s1.has('cfb-pickems/js/c.js'), 'an import list whose comment contains an apostrophe still yields its edge (and a bare side-effect `import \'./c.js\'` too)');
  const r1 = map.get('root').files;
  assert(r1.has('cfb-pickems/js/a.js') && r1.has('cfb-pickems/js/b.js') && r1.has('cfb-pickems/js/c.js') && !r1.has('cfb-pickems/js/sub/d.js'), 'a wildcard-free .js entry in a manifest\'s deps is an IMPORT ROOT: the suite depends on that module and its import closure, not on every file in js/');
  const c1 = map.get('cp').files;
  assert(c1.has('cfb-pickems/js/a.js') && c1.has('cfb-pickems/js/sub/d.js') && !c1.has('cfb-pickems/other/z.js'), 'a suite that cp()s a directory depends on the WHOLE subtree, and only that one');
  const dep = { files: new Set(['cfb-pickems/js/a.js', 'cfb-pickems/css/x.css']), globs: ['cfb-pickems/data/**'] };
  const exists = rel => !/ghost/.test(rel);
  const isDir = rel => !/\.\w+$/.test(rel);
  const miss = traced => missedByMap({ traced, dep, exists, isDir, scope: 'cfb-pickems' });
  assert(JSON.stringify(miss(['cfb-pickems/js/a.js', 'cfb-pickems/data/q/r.json'])) === '[]', 'reads inside the set (a file, a file under a glob) are covered');
  assert(JSON.stringify(miss(['cfb-pickems/js/other.js'])) === '["cfb-pickems/js/other.js"]', 'a read OUTSIDE the set is reported');
  assert(JSON.stringify(miss(['cfb-pickems/ghost.js'])) === '[]', 'a probe for a file that does not exist is not a dependency on its content');
  assert(JSON.stringify(miss(['cfb-pickems/js/'])) === '[]' && JSON.stringify(miss(['cfb-pickems/elsewhere/'])) === '["cfb-pickems/elsewhere/"]', 'a listed directory is covered when a dependency lives under it, reported when none does');
  assert(JSON.stringify(miss(['docs/', 'historical data/'])) === '[]', 'a directory OUTSIDE the app tree walked only for names, with nothing read beneath it, is not a dependency');
  assert(miss(['docs/', 'docs/SCRIBE.md']).includes('docs/SCRIBE.md') && JSON.stringify(miss(['docs/SCRIBE.md'])) === '["docs/SCRIBE.md"]', '…but a file read under it is checked like any other (and the directory is then checked too)');
});

testCase('quick-tier', async () => {
  const fx = affectedFixture({ suites: {}, files: {} });
  const r = fx.run(['--quick']);
  assert(JSON.stringify(ran(fx)) === JSON.stringify(['q', 'qq']), 'the quick tier runs the smoke- and quick-tagged suites and nothing else');
  assert(/ core-load /.test(r.out) && !/ core /.test(r.out.replace(/core-load/g, '')), '…plus the [1] module load (core-load), never the whole core');
  assert(/NOT the full harness/.test(r.out), '…and says out loud that it is not a full run');
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// E. The full-run semaphore
// ════════════════════════════════════════════════════════════════════════════════════════════
testCase('semaphore-limit', async () => {
  const sem = await lib('semaphore.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-slots-'));
  tmpRoots.push(dir);
  const a = sem.tryAcquire({ dir, slots: 2 });
  const b = sem.tryAcquire({ dir, slots: 2 });
  const c = sem.tryAcquire({ dir, slots: 2 });
  assert(a && b && a.slot !== b.slot, 'two full runs get two different slots');
  assert(c === null, 'a THIRD full run does not get one (the cap is 2, machine-wide)');
  sem.release(a);
  const d = sem.tryAcquire({ dir, slots: 2 });
  assert(d && d.slot === a.slot, 'a released slot is immediately reusable');
  sem.release(b); sem.release(d);
});

testCase('semaphore-stale', async () => {
  const sem = await lib('semaphore.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-slots-'));
  tmpRoots.push(dir);
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const deadPid = Number(dead.stdout);
  writeFileSync(path.join(dir, 'slot-0.lock'), JSON.stringify({ pid: deadPid, cwd: 'ghost' }));
  const a = sem.tryAcquire({ dir, slots: 1 });
  assert(a && a.slot === 0, 'a slot whose holder DIED (SIGKILL, closed terminal) is stolen — a crash cannot wedge the machine');
  const live = sem.tryAcquire({ dir, slots: 1 });
  assert(live === null, 'a slot held by a LIVE process (this one) is never stolen');
  sem.release(a);
  writeFileSync(path.join(dir, 'slot-0.lock'), '');
  const past = new Date(Date.now() - 60000); utimesSync(path.join(dir, 'slot-0.lock'), past, past);
  assert(sem.tryAcquire({ dir, slots: 1 }), 'an EMPTY slot file older than a few seconds (holder died between open and write) is stolen');
  const fresh = path.join(dir, 'slot-1.lock'); writeFileSync(fresh, '');
  assert(sem.tryAcquire({ dir, slots: 2 }) === null, 'a freshly created empty file is given a moment before it is judged stale (not stolen)');
});

testCase('semaphore-cli', async () => {
  const fx = fixture({ suites: { one: { floor: 1 } }, files: { 'one.mjs': evSuite('one', 1200) } });
  const spawnRun = tag => new Promise(res => {
    const c = spawn(process.execPath, [path.join(fx.cfb, 'testrun.mjs'), '--full'], { cwd: fx.cfb, env: fx.env({ CFBP_TESTRUN_SLOTS: '1', FX_TAG: tag }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => res({ code, out }));
  });
  const [r1, r2] = await Promise.all([spawnRun('p'), spawnRun('q')]);
  const ev = fx.events().filter(e => e.id === 'one');
  assert(r1.code === 0 && r2.code === 0, 'both full runs complete green');
  assert(maxConcurrency(fx.events(), ['one']) === 1, 'with ONE slot, two simultaneous full runs never overlap (the second WAITED for the first)');
  assert(ev.length === 4, 'both suites ran');
  fx.cleanup();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// F. The extractor
// ════════════════════════════════════════════════════════════════════════════════════════════
const legacyBlock = ({ label = '67', file = 'xtest.mjs', floor = 10, mode = 'strict', re = null, extra = '', note = 'actually ran its full set' } = {}) => {
  const v = `m${label}`;
  const regex = re || (mode === 'strict' ? '(✅ ALL PASS|❌ FAILURES) — (\\d+) passed, (\\d+) failed' : '(\\d+) passed, (\\d+) failed');
  const asserts = mode === 'strict'
    ? `    assert(${v}[1] === '✅ ALL PASS', \`${file} itself reports ALL PASS\`);\n    assert(Number(${v}[3]) === 0, \`${file} reports zero failed assertions\`);\n    assert(Number(${v}[2]) >= ${floor}, \`${file} ${note} (got \${${v}[2]}, floor ${floor} — raised from 5\`);\n`
    : `    assert(Number(${v}[2]) === 0, \`${file} reports zero failed assertions\`);\n    assert(Number(${v}[1]) >= ${floor}, \`${file} ${note} (got \${${v}[1]}, floor ${floor} — raised from 5\`);\n`;
  return `
// ── ${label}. ${file} — banner comment
// second line of the banner
console.log('\\n[${label}] ${file} — spawned as a subprocess, exit code + printed pass/fail line both checked…');
{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const result = spawnSync(process.execPath, ['${file}'], { cwd, encoding: 'utf8', timeout: SPAWNED_SUITE_TIMEOUT_MS });
  const out = (result.stdout || '') + (result.stderr || '');
  assert(result.status === 0, \`${file} exits 0 (got \${result.status})\`);
  const ${v} = out.match(/${regex}/);
  assert(!!${v}, \`${file} printed its own pass/fail summary line\`);
${extra}  if (${v}) {
${asserts}  }
}
`;
};
const LEGACY_FILE = ({ blocks }) => `import { readFile, readdir } from 'node:fs/promises';\n\n/**\n * ══ REVIEWER F8 (sixth gate, 2026-09-17) — A HUNG CHILD MUST FAIL\n */\nconst SPAWNED_SUITE_TIMEOUT_MS = 300000;\n\nlet pass = 0, fail = 0;\nfunction assert(c, l) { if (c) pass++; else fail++; }\n\nconsole.log('\\n[1] Importing all modules…');\nfor (const m of ['a']) {\n  pass++;\n}\n\n// ── 1b. next section\nconsole.log('\\n[1b] later');\n${blocks}\nconsole.log(\`\\n\${'═'.repeat(50)}\\n\${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — \${pass} passed, \${fail} failed\\n\`);\n`;

testCase('extract-blocks', async () => {
  const { extractLegacy, buildCore, legacyBlockCount } = await lib('extract.mjs');
  const src = LEGACY_FILE({ blocks: legacyBlock() + legacyBlock({ label: '68', file: 'ytest.mjs', floor: 20, mode: 'loose' }) });
  const r = extractLegacy(src);
  assert(r.errors.length === 0, 'two real-shaped blocks extract without errors', r.errors.join(' | '));
  assert(r.entries.length === 2 && r.entries[0].script === 'xtest.mjs' && r.entries[0].floor === 10 && r.entries[0].summary === 'strict' && r.entries[0].label === '67', 'script, floor, summary preset and label are recovered');
  assert(r.entries[1].summary === 'loose' && r.entries[1].floor === 20, 'a loose-summary block is recognised as such');
  assert(/banner comment/.test(r.entries[0].comment), 'the comment directly above a block is captured (it goes to the archive)');
  assert(legacyBlockCount(src) === 2, 'legacyBlockCount sees both');
  const core = buildCore(src, r.regions);
  assert(legacyBlockCount(core) === 0 && !/xtest\.mjs/.test(core.replace(/\/\/.*$/gm, '')), 'stripping removes both blocks');
  assert(extractLegacy(core).entries.length === 0, 'RE-RUNNING the extractor on the stripped file finds nothing (idempotent)');
  assert((core.match(/TIERED RUNNER GUARD/g) || []).length === 1 && (core.match(/CFBP_CORE=load \(docs/g) || []).length === 1, 'the delegating guard and the load-stop are inserted exactly once');
  const again = buildCore(core, []);
  assert(again === core, 'running buildCore on an already-converted file changes nothing');
  assert(/\[1b\] later/.test(core) && /\[1\] Importing/.test(core), 'unrelated sections survive');
  assert(!/REVIEWER F8/.test(core) && !/const SPAWNED_SUITE_TIMEOUT_MS/.test(core), 'the dead F8 constant is retired with a pointer to the runner');
});

testCase('extract-refuses-unknown', async () => {
  const { extractLegacy } = await lib('extract.mjs');
  const withExtra = LEGACY_FILE({ blocks: legacyBlock({ extra: "  assert(out.includes('totally-new-requirement'), 'a check the extractor has never seen');\n" }) });
  const r1 = extractLegacy(withExtra);
  assert(r1.errors.length === 1 && /cannot carry across/.test(r1.errors[0]) && r1.entries.length === 0, 'a block with an assertion the extractor does not know is REFUSED, never silently dropped');
  const withEnv = legacyBlock().replace("encoding: 'utf8',", "encoding: 'utf8', env: { TZ: 'UTC' },");
  const r2 = extractLegacy(LEGACY_FILE({ blocks: withEnv }));
  assert(r2.errors.length === 1 && /env/.test(r2.errors[0]), 'a spawn that sets an `env` in any other shape (here a bare `{ TZ }` placed before the deadline) is REFUSED — it would be lost');
  const noFloor = legacyBlock().replace(/\n\s*assert\(Number\(m67\[2\]\) >= 10[^\n]*\n/, '\n');
  assert(extractLegacy(LEGACY_FILE({ blocks: noFloor })).errors.some(e => /floor/.test(e)), 'a block with no floor assertion is REFUSED');
  const weird = legacyBlock({ re: '(?:✅|❌) mysuite: (\\d+) passed, (\\d+) failed', mode: 'loose' });
  const wr = extractLegacy(LEGACY_FILE({ blocks: weird }));
  assert(wr.errors.length === 0 && typeof wr.entries[0].summary === 'object' && wr.entries[0].summary.regex === '(?:✅|❌) mysuite: (\\d+) passed, (\\d+) failed' && wr.entries[0].summary.passed === 1 && wr.entries[0].summary.failed === 2, 'a summary shape that matches no preset is carried EXPLICITLY (regex + capture groups), never guessed or flattened to a preset');
  const hyg = legacyBlock({ file: 'pushnativetest.mjs', extra: "  const leaked96b = ['x'];\n  assert(leaked96b.length === 0, 'cleaned up');\n" });
  assert(extractLegacy(LEGACY_FILE({ blocks: hyg })).errors.some(e => /STALE/.test(e)), 'a hygiene block whose text no longer matches the reviewed fingerprint is refused as STALE');
  const noHyg = legacyBlock({ file: 'pushnativetest.mjs' });
  assert(extractLegacy(LEGACY_FILE({ blocks: noHyg })).errors.some(e => /hygiene check/.test(e)), 'and a suite that SHOULD carry its leaked-file check but lost it is refused too');
});

testCase('extract-tz-and-timeout', async () => {
  // Two block shapes the v0.30.0 landing tree carried that the 95a16c3 tree did not (2026-10-07): [123] sectiondragtest's doubled deadline and
  // [125b] themetest's fixed-zone re-run. Both are CARRIED into the manifest, exactly; anything else in the spawn options is still refused.
  const { extractLegacy, suiteIdFor } = await lib('extract.mjs');
  const long = legacyBlock({ label: '123' }).replace('timeout: SPAWNED_SUITE_TIMEOUT_MS }', 'timeout: SPAWNED_SUITE_TIMEOUT_MS * 2 }');
  const r1 = extractLegacy(LEGACY_FILE({ blocks: long }));
  assert(r1.errors.length === 0 && r1.entries.length === 1 && r1.entries[0].timeoutMs === 600000, 'a `timeout: SPAWNED_SUITE_TIMEOUT_MS * 2` block is CARRIED as "timeoutMs": 600000 (never silently back to the default)', r1.errors.join(' | '));
  const plain = extractLegacy(LEGACY_FILE({ blocks: legacyBlock() })).entries[0];
  assert(plain && plain.timeoutMs === undefined && plain.env === undefined, 'a plain block carries neither (the default deadline, the host zone)');
  const tzBlock = `
console.log('\\n[125b] xtest.mjs under TZ=America/Los_Angeles — nothing may depend on the zone…');
{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const result = spawnSync(process.execPath, ['xtest.mjs'], { cwd, encoding: 'utf8', timeout: SPAWNED_SUITE_TIMEOUT_MS, env: { ...process.env, TZ: 'America/Los_Angeles' } });
  const out = (result.stdout || '') + (result.stderr || '');
  assert(result.status === 0, \`xtest.mjs (TZ=America/Los_Angeles) exits 0 (got \${result.status})\`);
  const m125b = out.match(/(✅ ALL PASS|❌ FAILURES) — (\\d+) passed, (\\d+) failed/);
  assert(!!m125b && m125b[1] === '✅ ALL PASS' && Number(m125b[3]) === 0 && Number(m125b[2]) >= 334, \`xtest.mjs (TZ=America/Los_Angeles) reports ALL PASS with the same floor (got: \${m125b ? m125b[0] : 'no summary line'})\`);
}
`;
  const r2 = extractLegacy(LEGACY_FILE({ blocks: legacyBlock() + tzBlock }));
  const tz = r2.entries[1];
  assert(r2.errors.length === 0 && r2.entries.length === 2, 'the base suite AND its fixed-zone re-run both extract', r2.errors.join(' | '));
  assert(!!tz && !!tz.env && tz.env.TZ === 'America/Los_Angeles' && Object.keys(tz.env).length === 1, 'the zone is CARRIED as "env": {"TZ": "America/Los_Angeles"} — that key and nothing else');
  assert(!!tz && tz.summary === 'strict-single' && tz.floor === 334 && tz.label === '125b' && tz.timeoutMs === undefined, 'the one-assertion summary becomes the strict-single preset, with its floor and label');
  assert(!!tz && suiteIdFor(tz.script, tz.args, tz.env) === 'xtest-tz-America-Los-Angeles' && suiteIdFor('xtest.mjs', [], null) === 'xtest', 'the variant gets its own id (xtest-tz-America-Los-Angeles), distinct from the base suite\'s');
  const otherKey = tzBlock.replace("TZ: 'America/Los_Angeles' } });", "TZ: 'America/Los_Angeles', NODE_OPTIONS: '--x' } });");
  assert(otherKey !== tzBlock && extractLegacy(LEGACY_FILE({ blocks: otherKey })).errors.some(e => /env/.test(e)), 'an env with ANY other key is REFUSED (it would be lost)');
  const noSpread = tzBlock.replace('env: { ...process.env, TZ:', 'env: { TZ:');
  assert(noSpread !== tzBlock && extractLegacy(LEGACY_FILE({ blocks: noSpread })).errors.some(e => /env/.test(e)), 'an env WITHOUT `...process.env` (it replaces PATH and everything else — not what a manifest env means) is REFUSED');
  const mixed = tzBlock.replace('  assert(!!m125b &&', "  assert(Number(m125b[3]) === 0, 'separately');\n  assert(!!m125b &&");
  assert(mixed !== tzBlock && extractLegacy(LEGACY_FILE({ blocks: mixed })).errors.some(e => /unrecognised mix/.test(e)), 'a block that asserts its summary BOTH as one combined assertion and separately is REFUSED (the check count would differ)');
});

testCase('extract-cli-carries-deadline', async () => {
  // extract-suites.mjs on an EXISTING manifest: the human-owned fields win, but a deadline the block says is never dropped because the manifest predates it.
  const cli = path.join(ROOT, 'tests', 'extract-suites.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-xcli-'));
  tmpRoots.push(dir);
  const lt = path.join(dir, 'loadtest.mjs');
  const sd = path.join(dir, 'suites');
  mkdirSync(sd);
  // the CLI validates that a manifest's script exists under ITS cfb-pickems/: testrun.mjs and loadtest.mjs always do in the real tree
  writeFileSync(lt, LEGACY_FILE({ blocks: legacyBlock({ file: 'testrun.mjs' }).replace('timeout: SPAWNED_SUITE_TIMEOUT_MS }', 'timeout: SPAWNED_SUITE_TIMEOUT_MS * 2 }') }));
  const run = () => spawnSync(process.execPath, [cli, '--write', '--no-strip', '--loadtest', lt, '--suites-dir', sd], { encoding: 'utf8' });
  writeFileSync(path.join(sd, 'testrun.json'), JSON.stringify({ id: 'testrun', script: 'testrun.mjs', summary: 'strict', floor: 10, tags: ['quick'] }));
  const r = run();
  const m1 = JSON.parse(readFileSync(path.join(sd, 'testrun.json'), 'utf8'));
  assert(r.status === 0 && m1.timeoutMs === 600000 && JSON.stringify(m1.tags) === '["quick"]', 'an existing manifest with no deadline GAINS the block\'s doubled one on re-extraction, and keeps its human-owned tags', ((r.stdout || '') + (r.stderr || '')).slice(-400));
  writeFileSync(path.join(sd, 'testrun.json'), JSON.stringify({ id: 'testrun', script: 'testrun.mjs', summary: 'strict', floor: 10, timeoutMs: 900000 }));
  const r2 = run();
  const m2 = JSON.parse(readFileSync(path.join(sd, 'testrun.json'), 'utf8'));
  assert(r2.status === 0 && m2.timeoutMs === 900000, 'a deadline a human already set in the manifest wins (timeoutMs is curated)');
  assert(readFileSync(lt, 'utf8').includes('SPAWNED_SUITE_TIMEOUT_MS * 2'), '--no-strip left the legacy file untouched');
});

testCase('extract-table', async () => {
  const { extractLegacy } = await lib('extract.mjs');
  const table = `
// group comment above the table
for (const [label, file, floor, why] of [
  // per-entry comment
  ['81b', 'supabase/tests/functions/a.twin.mjs', 33,
   'what a proves; with an escaped \\' quote'],
  ['81c', 'b.mjs', 5,
   \`template why\`],
]) {
  console.log(\`\\n[\${label}] \${file} — spawned as a subprocess…\`);
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const result = spawnSync(process.execPath, [file], { cwd, encoding: 'utf8', timeout: SPAWNED_SUITE_TIMEOUT_MS });
  const out = (result.stdout || '') + (result.stderr || '');
  assert(result.status === 0, \`\${file} exits 0 (got \${result.status})\`);
  const m = out.match(/(\\d+) passed, (\\d+) failed/);
  assert(!!m, \`\${file} printed its own pass/fail summary line\`);
  if (m) {
    assert(Number(m[2]) === 0, \`\${file} reports zero failed assertions\`);
    assert(Number(m[1]) >= floor, \`\${file} ran its full set (got \${m[1]}, floor \${floor}) — \${why}\`);
  }
}
`;
  const r = extractLegacy(LEGACY_FILE({ blocks: table }));
  assert(r.errors.length === 0, 'a table loop extracts', r.errors.join(' | '));
  assert(r.entries.length === 2 && r.entries[0].script === 'supabase/tests/functions/a.twin.mjs' && r.entries[0].floor === 33 && r.entries[1].floor === 5, 'every table row becomes a suite with its own floor');
  assert(r.entries[0].summary === 'loose' && /escaped ' quote/.test(r.entries[0].note) && r.entries[0].comment === 'per-entry comment', 'why-strings (incl. escaped quotes) and per-entry comments survive');
  assert(Object.values(r.notes).some(t => /group comment/.test(t)), 'the loop-level comment is kept (under the first entry)');
});

testCase('extract-guard-delegates', async () => {
  const { extractLegacy, buildCore } = await lib('extract.mjs');
  const src = LEGACY_FILE({ blocks: legacyBlock() });
  const core = buildCore(src, extractLegacy(src).regions);
  const fx = fixture({ suites: { s: { floor: 1 } }, files: { 's.mjs': SUMMARY_OK(5) }, loadtest: core.replace("console.log('\\n[1b] later');", "console.log('AFTER-LOAD-SECTION');") });
  const bare = spawnSync(process.execPath, [path.join(fx.cfb, 'loadtest.mjs')], { cwd: fx.cfb, env: fx.env(), encoding: 'utf8', timeout: 30000 });
  assert(bare.status === 0 && /testrun --full/.test(bare.stdout), '`node loadtest.mjs` (deploy.sh Gate 1\'s command) DELEGATES to the runner: it still means the full sweep', bare.stdout.slice(0, 200));
  // D-42 (2026-10-07): deploy.sh Gate 1 is `node loadtest.mjs --tz UTC` — the arguments must reach the runner, or the gate silently skips the second zone
  const zoned = spawnSync(process.execPath, [path.join(fx.cfb, 'loadtest.mjs'), '--tz', 'Pacific/Kiritimati'], { cwd: fx.cfb, env: fx.env({ TZ: 'UTC' }), encoding: 'utf8', timeout: 30000 });
  assert(zoned.status === 0 && /testrun --full · \d+ suite\(s\) \+ 0 under TZ=Pacific\/Kiritimati/.test(zoned.stdout), '`node loadtest.mjs --tz <zone>` passes its arguments through: the runner runs --full PLUS the second-zone pass', zoned.stdout.slice(0, 300));
  const load = spawnSync(process.execPath, [path.join(fx.cfb, 'loadtest.mjs')], { cwd: fx.cfb, env: fx.env({ CFBP_CORE: 'load' }), encoding: 'utf8', timeout: 30000 });
  assert(load.status === 0 && /✅ ALL PASS — \d+ passed, 0 failed/.test(load.stdout) && !/AFTER-LOAD-SECTION/.test(load.stdout), 'CFBP_CORE=load stops after section [1] and prints the summary line');
  const full = spawnSync(process.execPath, [path.join(fx.cfb, 'loadtest.mjs')], { cwd: fx.cfb, env: fx.env({ CFBP_CORE: 'full' }), encoding: 'utf8', timeout: 30000 });
  assert(/AFTER-LOAD-SECTION/.test(full.stdout) && !/testrun --full/.test(full.stdout), 'CFBP_CORE=full runs every inline section and does not recurse into the runner');
  fx.cleanup();
});

// G. The real repo — moved to runnerrepotest.mjs (M-49, Drew 2026-10-14: "Yes, approve 47, 48, 49"): denylist-real-manifests,
//    repo-integrity, repo-depmap and repo-selftest-selection read the real manifests, every suite script, loadtest.mjs and deploy.sh,
//    and testruntest is held to the runner's own code, so they run there (seconds, not held) whenever those change.
// ════════════════════════════════════════════════════════════════════════════════════════════
// run the cases
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log(`testruntest.mjs — runner under test: ${ROOT}${ROOT === REAL ? '' : ' (a MUTANT or alternate copy)'}`);
const selected = ONLY ? cases.filter(c => c.name === ONLY) : cases;
if (ONLY && !selected.length) { console.error(`no case "${ONLY}"`); process.exit(2); }
for (const c of selected) {
  console.log(`\n[${c.name}]`);
  try { await c.fn(); } catch (e) { fail++; console.error('  ❌', `case ${c.name} threw:`, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// mutation battery — scratch copies only
// ════════════════════════════════════════════════════════════════════════════════════════════
const MUTANTS = [
  { name: 'floor comparison removed',          file: 'tests/lib/evaluate.mjs', find: 'add(child.passed >= manifest.floor,', replace: 'add(true,', cases: ['runner-below-floor', 'evaluate-below-floor'] },
  { name: 'summary-line check removed',        file: 'tests/lib/evaluate.mjs', find: 'add(!!m, `${name} printed its own', replace: 'add(true, `${name} printed its own', cases: ['runner-missing-summary', 'evaluate-missing-summary'] },
  { name: 'exit-code check removed',           file: 'tests/lib/evaluate.mjs', find: 'add(result.status === 0 && !result.timedOut && !result.error,', replace: 'add(true,', cases: ['runner-crash', 'evaluate-crash-and-exit'] },
  { name: 'timeout never fires',               file: 'tests/lib/exec.mjs',     find: 'const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);', replace: 'const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs * 1000);', cases: ['runner-timeout'] },
  // W-22: suites share the run's group now, so the timeout kills the suite's process TREE (the old per-suite group kill is gone)
  // review note 8 made "the timeout kills only the suite" an EQUIVALENT mutant: the suite then ends at once and the per-suite reap kills its tree in
  // the same instant. The tree outlives the deadline only when BOTH are gone, so this mutant breaks both (`also`: more edits in the same file).
  { name: 'a timed-out suite\'s tree outlives it (the timeout kills only the suite, and nothing reaps what it leaves)', file: 'tests/lib/exec.mjs', find: 'try { pids = [...treeOf(pid)]; } catch { pids = [pid]; }', replace: 'pids = [pid];', also: [{ find: '      if (RUN_GROUP !== null) reapStrays();', replace: '' }], cases: ['runner-timeout-kills-tree'] },
  { name: 'timed-out flag not reported',       file: 'tests/lib/evaluate.mjs', find: "if (result.timedOut) why =", replace: "if (false) why =", cases: ['evaluate-timeout'] },
  { name: 'forbidden-text check removed',      file: 'tests/lib/evaluate.mjs', find: "for (const f of manifest.forbid || []) add(", replace: "for (const f of []) add(", cases: ['evaluate-forbid'] },
  { name: 'verdict ignores failures',          file: 'testrun.mjs',            find: "${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed", replace: "${'✅ ALL PASS'} — ${pass} passed, ${fail} failed", cases: ['runner-failing-suite'] },
  { name: 'exit code ignores failures',        file: 'testrun.mjs',            find: "process.exit(fail === 0 ? 0 : 1);\n}\n\nfunction findOrphans", replace: "process.exit(0);\n}\n\nfunction findOrphans", cases: ['runner-failing-suite'] },
  { name: 'denylist emptied',                  file: 'tests/lib/manifest.mjs', find: "export const DENYLIST = ['rls.test.mjs', 'import-backup.mjs', 'export-sheet.mjs', 'projectiontest.mjs'];", replace: 'export const DENYLIST = [];', cases: ['denylist-unit', 'denylist-cli'] },
  { name: 'denylist case-sensitive',           file: 'tests/lib/manifest.mjs', find: ".toLowerCase();\n  return DENYLIST", replace: ";\n  return DENYLIST", cases: ['denylist-unit'] },
  { name: '--only skips the denylist',         file: 'testrun.mjs',            find: "if (denied(id) || denied(id + '.mjs')) throw", replace: "if (false) throw", cases: ['denylist-cli'] },
  { name: 'tripwire blind',                    file: 'tests/lib/tree.mjs',     find: "  return [...new Set(changed)].sort();", replace: "  return [];", cases: ['runner-tripwire'] },
  { name: 'tripwire ignores the event stream (transient files)', file: 'tests/lib/tree.mjs', find: "if (!present) changed.push(", replace: "if (false) changed.push(", cases: ['runner-tripwire'] },
  { name: 'tripwire ignores file mtimes',      file: 'tests/lib/tree.mjs',     find: "else if (after.get(k) !== v && v !== 'd') changed.push(", replace: "else if (false) changed.push(", cases: ['runner-tripwire'] },
  { name: 'tripwire compares directory mtimes (the cry-wolf version)', file: 'tests/lib/tree.mjs', find: "if (e.isDirectory()) { snap.set(r + '/', 'd'); walk(full, r); }", replace: "if (e.isDirectory()) { snap.set(r + '/', `d:${st.mtimeMs}`); walk(full, r); }", cases: ['runner-tripwire'] },
  { name: 'isolate:tree ignored',              file: 'testrun.mjs',            find: "if (m.isolate === 'tree') {", replace: "if (false) {", cases: ['runner-isolate-tree'] },
  { name: 'clone copies .env files',           file: 'tests/lib/tree.mjs',     find: "const skipName = n => SKIP_NAMES.has(n) || n.startsWith('.env');", replace: "const skipName = n => SKIP_NAMES.has(n);", cases: ['runner-clone-excludes-secrets'] },
  { name: 'browser cap removed',               file: 'tests/lib/exec.mjs',     find: "const i = queue.findIndex(t => !(t.browser && browserRunning >= browserJobs));", replace: "const i = queue.length ? 0 : -1;", cases: ['runner-browser-cap'] },
  { name: 'browser tag not inferred',          file: 'testrun.mjs',            find: "if (/['\"`]--remote-debugging-port/.test(text)) tags.add('browser');", replace: "", cases: ['runner-browser-cap'] },
  { name: 'shared TMPDIR',                     file: 'testrun.mjs',            find: "TMPDIR: suiteTmp, TMP: suiteTmp, TEMP: suiteTmp,", replace: "", cases: ['runner-hermetic-tmp'] },
  { name: 'child output captured through pipes again', file: 'tests/lib/exec.mjs', find: "stdio: ['ignore', outFd, errFd]", replace: "stdio: ['ignore', 'pipe', 'pipe']", cases: ['exec-output-not-lost'] },
  { name: 'dependency scan needs clean import lists', file: 'tests/lib/depmap.mjs', find: "const IMPORT_FROM = /(?:\\bfrom|\\bimport)\\s+(['\"])([^'\"\\n]+)\\1/g;", replace: "const IMPORT_FROM = /\\b(?:import|export)\\s+(?:[^'\"`;]*?\\s+from\\s+)?(['\"])([^'\"\\n]+)\\1/g;", cases: ['depmap-extractors'] },
  { name: 'cp() not treated as a directory read', file: 'tests/lib/depmap.mjs', find: "|\\bcp(?:Sync)?\\(/;", replace: "/;", cases: ['depmap-extractors'] },
  { name: 'check-deps reports nothing',           file: 'tests/lib/depmap.mjs', find: "  return missed;\n}", replace: "  return [];\n}", cases: ['depmap-extractors'] },
  { name: 'affected always adds the whole quick set', file: 'testrun.mjs', find: "(opts.strictQuick ? isQuick(t) : isSmoke(t))", replace: "(isQuick(t))", cases: ['affected-selects-by-deps'] },
  { name: 'manifest .js deps are plain files, not import roots', file: 'tests/lib/depmap.mjs', find: "if (!/[*?]/.test(resolved) && /\\.m?js$/.test(resolved) && allSet.has(resolved) && !seen.has(resolved))", replace: "if (false)", cases: ['depmap-extractors'] },
  { name: 'preflight lets an unreadable checkout through', file: 'testrun.mjs', find: "if (unreadable.length) {", replace: "if (false) {", cases: ['runner-unreadable-checkout'] },
  { name: 'dependency scan treats an unreadable file as empty', file: 'tests/lib/depmap.mjs', find: "else throw new Error(`dependency scan: cannot read ${rel} (${e.code || e.message})`); }", replace: "else text = ''; }", cases: ['runner-unreadable-checkout'] },
  { name: 'parity ignores a per-suite assertion-count difference', file: 'tests/parity.mjs', find: "else if (row.oldChecks !== row.newChecks) problems.push(", replace: "else if (false) problems.push(", cases: ['parity-tool'] },
  { name: 'parity ignores a per-suite passed-count difference', file: 'tests/parity.mjs', find: "else if (row.oldCount !== row.newCount) problems.push(", replace: "else if (false) problems.push(", cases: ['parity-tool'] },
  { name: 'parity skips the core-inline identity', file: 'tests/parity.mjs', find: "if (legacyPassed !== null && coreInline !== null && coreInline !== legacyPassed - spawnedLines) {", replace: "if (false) {", cases: ['parity-tool'] },
  { name: 'parity skips the headline identity', file: 'tests/parity.mjs', find: "if (legacyPassed !== null && summary.passed - extraChecks !== legacyPassed) problems.push(", replace: "if (false) problems.push(", cases: ['parity-tool'] },
  { name: 'parity accepts an undeclared suite with no legacy lines', file: 'tests/parity.mjs', find: "if (!mine.length) problems.push(", replace: "if (false) problems.push(", cases: ['parity-tool'] },
  { name: 'parity entry check compares unresolved paths', file: 'tests/parity.mjs', find: "realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))", replace: "path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)", cases: ['parity-tool'] },
  { name: 'parity accepts a quick summary',        file: 'tests/parity.mjs', find: "if (summary.tier !== 'full' || summary.requested !== 'full') problems.push(", replace: "if (false) problems.push(", cases: ['parity-tool'] },
  { name: 'parity exits 0 on a broken proof',      file: 'tests/parity.mjs', find: "console.log(`\\n❌ PARITY BROKEN — ${problems.length} problem(s):`);\n    for (const p of problems) console.log('  ✗ ' + p);\n    process.exit(1);", replace: "console.log(`\\n❌ PARITY BROKEN — ${problems.length} problem(s):`);\n    for (const p of problems) console.log('  ✗ ' + p);\n    process.exit(0);", cases: ['parity-tool'] },
  { name: 'serial pool',                       file: 'tests/lib/exec.mjs',     find: "while (running < jobs) {", replace: "while (running < 1) {", cases: ['runner-parallel'] },
  { name: 'semaphore unbounded',               file: 'tests/lib/semaphore.mjs', find: "for (let i = 0; i < slots; i++) {\n    const file = path.join(dir, `slot-${i}.lock`);\n    for (let attempt", replace: "for (let i = 0; i < slots + 5; i++) {\n    const file = path.join(dir, `slot-${i}.lock`);\n    for (let attempt", cases: ['semaphore-limit'] },
  { name: 'semaphore never steals a dead holder', file: 'tests/lib/semaphore.mjs', find: "} else if (alive(h.pid)) break;", replace: "} else break;", cases: ['semaphore-stale'] },
  { name: 'affected ignores deps',             file: 'tests/lib/depmap.mjs',   find: "if (dep.files.has(f)) { ids.add(id); mapped = true; continue; }", replace: "", cases: ['affected-selects-by-deps'] },
  { name: 'affected skips transitive imports', file: 'tests/lib/depmap.mjs',   find: "if (r) { out.add(r); if (/\\.m?js$/.test(r) && !seen.has(r)) { seen.add(r); queue.push(r); } }", replace: "if (r) { out.add(r); }", cases: ['affected-selects-by-deps'] },
  { name: 'unmapped file does not force full', file: 'tests/lib/depmap.mjs',   find: "if (unmapped.length) { full = true;", replace: "if (unmapped.length) { full = false;", cases: ['affected-unmapped-falls-back-full'] },
  { name: 'runner change does not force full', file: 'tests/lib/depmap.mjs',   find: "if (runnerRes.some(r => r.test(f))) { full = true;", replace: "if (runnerRes.some(r => r.test(f))) { full = false;", cases: ['affected-runner-change-is-full'] },
  { name: 'manifest edit forces full instead of its suite', file: 'tests/lib/depmap.mjs', find: "if (mm && suites.has(mm[1])) { ids.add(mm[1]); mapped = true; }", replace: "", cases: ['affected-selects-by-deps'] },
  { name: 'legacy-block guard removed',        file: 'testrun.mjs',            find: "if (legacy > 0) {", replace: "if (false) {", cases: ['runner-legacy-guard'] },
  { name: 'extractor drops unknown assertions', file: 'tests/lib/extract.mjs', find: "        residual.push(l);\n      }\n      if (!spawnArgs)", replace: "      }\n      if (!spawnArgs)", cases: ['extract-refuses-unknown'] },
  { name: 'extractor accepts any spawn env',   file: 'tests/lib/extract.mjs',  find: "{ cwd, encoding: 'utf8', timeout: SPAWNED_SUITE_TIMEOUT_MS(?:", replace: "{ cwd, encoding: 'utf8', (?:env: \\{[^}]*\\}, )?timeout: SPAWNED_SUITE_TIMEOUT_MS(?:", cases: ['extract-refuses-unknown'] },
  { name: 'extractor accepts an env without ...process.env', file: 'tests/lib/extract.mjs', find: "(?:, env: \\{ \\.\\.\\.process\\.env, TZ: '", replace: "(?:, env: \\{ (?:\\.\\.\\.process\\.env, )?TZ: '", cases: ['extract-tz-and-timeout'] },
  { name: 'extractor drops the deadline multiplier', file: 'tests/lib/extract.mjs', find: 'if (m[2] !== undefined) timeoutMult = Number(m[2]);', replace: '', cases: ['extract-tz-and-timeout'] },
  { name: 'extractor drops the fixed zone',    file: 'tests/lib/extract.mjs',  find: 'if (m[3] !== undefined) tz = m[3];', replace: '', cases: ['extract-tz-and-timeout'] },
  { name: 'extractor folds a mixed summary block', file: 'tests/lib/extract.mjs', find: 'if (sawPresent || verdict || failedIdx !== null || floorRef !== null) throw new Error(MIXED_SINGLE);', replace: '', cases: ['extract-tz-and-timeout'] },
  { name: 'strict-single check ignores the floor', file: 'tests/lib/evaluate.mjs', find: 'child.failed === 0 && child.passed >= manifest.floor,', replace: 'child.failed === 0,', cases: ['evaluate-single'] },
  { name: 'strict-single check ignores the verdict', file: 'tests/lib/evaluate.mjs', find: '(!v || m[v.group] === v.equals) && child.failed', replace: 'child.failed', cases: ['evaluate-single'] },
  { name: 'parity counts a fixed-zone variant\'s lines under its base suite too', file: 'tests/parity.mjs', find: ' && !longer.some(n => startsWithName(l, n))', replace: '', cases: ['parity-tool'] },
  { name: 'parity cannot read a one-line count', file: 'tests/parity.mjs',   find: 'const singleLine = gotLine ? null : mine.find(', replace: 'const singleLine = null && mine.find(', cases: ['parity-tool'] },
  { name: 'parity names a fixed-zone variant like its base suite', file: 'tests/parity.mjs', find: "+ (m.env && m.env.TZ ? ` (TZ=${m.env.TZ})` : '')", replace: '', cases: ['parity-tool'] },
  { name: 'guard stops delegating',            file: 'tests/lib/extract.mjs',  find: "if (!process.env.CFBP_CORE) {", replace: "if (false) {", cases: ['extract-guard-delegates'] },
  { name: 'a parallel-pass timeout is a plain failure again', file: 'testrun.mjs', find: "        if (x.res.timedOut) {\n          timedOut.push(", replace: "        if (false) {\n          timedOut.push(", cases: ['runner-timeout-solo-rerun'] },
  { name: 'timed-out suites are never re-run (they vanish from the totals)', file: 'testrun.mjs', find: '  if (timedOut.length) {', replace: '  if (false) {', cases: ['runner-timeout-solo-rerun', 'runner-timeout-solo-fail'] },
  { name: 'solo re-runs share a pool', file: 'testrun.mjs', find: 'await runPool(timedOut, { jobs: 1, browserJobs: 1,', replace: 'await runPool(timedOut, { jobs, browserJobs,', cases: ['runner-timeout-solo-alone'] },
  { name: 'summary.json drops the timeout record', file: 'testrun.mjs', find: 'timeouts: timeoutLog,', replace: 'timeouts: [],', cases: ['runner-timeout-solo-rerun'] },
  { name: 'a failed solo re-run is recorded as a pass', file: 'testrun.mjs', find: "outcome: ok ? 'pass' : res.timedOut ? 'timeout' : 'fail'", replace: "outcome: 'pass'", cases: ['runner-timeout-solo-fail'] },
  { name: 'the second-zone pass runs every suite', file: 'testrun.mjs', find: "  const isTz = m => m.tags.includes('tz');", replace: '  const isTz = m => true;', cases: ['tz-pass-only-tz-suites'] },
  { name: 'the second zone is never applied', file: 'testrun.mjs', find: '...(task.zone ? { TZ: task.zone } : {}),', replace: '', cases: ['tz-pass-only-tz-suites'] },
  { name: 'the primary pass runs in the second zone (the old --tz)', file: 'testrun.mjs', find: '...(task.zone ? { TZ: task.zone } : {}),', replace: '...(opts.tz ? { TZ: opts.tz } : {}),', cases: ['tz-full-plus-second-zone'] },
  { name: 'a bare --tz runs nothing', file: 'testrun.mjs', find: "  if (!o.tier && o.tz && !o.list && !o.explain) o.tier = 'tz';", replace: '', cases: ['tz-pass-only-tz-suites'] },
  { name: 'a fixed-zone manifest may be tagged tz', file: 'tests/lib/manifest.mjs', find: "if (Array.isArray(m.tags) && m.tags.includes('tz') && m.env", replace: 'if (false && m.env', cases: ['manifest-schema'] },
  { name: 'parity accepts a second-zone summary', file: 'tests/parity.mjs', find: 'if (summary.tz) problems.push(', replace: 'if (false) problems.push(', cases: ['parity-tool'] },
  { name: 'a crashed suite vanishes from the totals (no completeness check)', file: 'testrun.mjs', find: '    if (done.has(task.key)) continue;', replace: '    continue;', cases: ['runner-crash-is-red'] },
  { name: 'a crash in the parallel pass is swallowed unnamed', file: 'testrun.mjs', find: '} catch (e) { crashes.set(task.key, e); }', replace: '} catch (e) { /* swallowed */ }', cases: ['runner-crash-is-red'] },
  { name: 'runPool swallows a rejection again', file: 'tests/lib/exec.mjs', find: '.catch(error => { rejected.push({ item: t, error }); })', replace: '.catch(() => {})', cases: ['pool-reports-rejections'] },
  { name: 'the clone copies special files (FIFO)', file: 'tests/lib/tree.mjs', find: 'return st.isDirectory() || st.isFile() || st.isSymbolicLink();', replace: 'return true;', cases: ['runner-clone-skips-special-files'] },
  { name: '--tz accepts an unknown zone', file: 'testrun.mjs', find: "  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch {\n    return", replace: "  try { } catch {\n    return", cases: ['tz-zone-validation'] },
  { name: '--tz accepts the run\'s own offsets', file: 'testrun.mjs', find: '.every(iso => offsetAt(zone, iso) === offsetAt(host, iso))', replace: '.every(() => false)', cases: ['tz-zone-validation'] },
  { name: 'summary.json never reports a dirty tree', file: 'testrun.mjs', find: "dirty = git(['status', '--porcelain', '--untracked-files=normal']).length > 0;", replace: 'dirty = false;', cases: ['summary-records-head'] },
  { name: 'the denylist ignores a symlink\'s real path', file: 'tests/lib/manifest.mjs', find: 'try { if (denied(realpathSync(abs))) return true; }', replace: 'try { }', cases: ['denylist-real-file'] },
  { name: 'the denylist ignores file identity (hard link)', file: 'tests/lib/manifest.mjs', find: '  if (root) { try { const st = statSync(abs);', replace: '  if (false) { try { const st = statSync(abs);', cases: ['denylist-real-file'] },
  { name: 'the core guard drops loadtest.mjs\'s arguments (deploy.sh\'s --tz UTC never reaches the runner)', file: 'tests/lib/extract.mjs', find: "'--full', ...process.argv.slice(2)]", replace: "'--full']", cases: ['extract-guard-delegates'] },
  { name: 'the second-zone pass runs inside the primary pass (adds its load)', file: 'testrun.mjs', find: 'const passes = opts.tz && primaryTasks.length && zoneTasks.length ? [primaryTasks, zoneTasks] : [tasks];', replace: 'const passes = [tasks];', cases: ['tz-full-plus-second-zone'] },
  { name: '--check-tz reports nothing', file: 'testrun.mjs', find: '    if (calls && !tagged && !fixed) { untagged += 1;', replace: '    if (false) { untagged += 1;', cases: ['check-tz'] },
  // ── W-22 (2026-10-08), defect 1: --affected and a loadtest.mjs edit confined to section [1]'s import list
  { name: 'every loadtest.mjs edit counts as list-only', file: 'tests/lib/depmap.mjs', find: 'if (f === LOADTEST && loadtestEdit && loadtestEdit.listOnly) {', replace: 'if (f === LOADTEST && loadtestEdit) {', cases: ['affected-loadtest-list-only'] },
  { name: 'the lines above section [1]\'s list are not compared', file: 'tests/lib/depmap.mjs', find: 'if (b[i] !== h[i] || i === Math.max(lb.open, lh.open) && lb.open !== lh.open) return no(', replace: 'if (false) return no(', cases: ['loadtest-edit-classify'] },
  { name: 'the lines below section [1]\'s list are not compared', file: 'tests/lib/depmap.mjs', find: 'if (b[b.length - k] !== h[h.length - k] || k === Math.max(tailB, tailH) && tailB !== tailH) return no(', replace: 'if (false) return no(', cases: ['loadtest-edit-classify', 'affected-loadtest-list-only'] },
  { name: 'a changed line inside the list need not be a module entry', file: 'tests/lib/depmap.mjs', find: 'const bad = [...added, ...removed].find(l => !LIST_LINE.test(l));', replace: 'const bad = undefined;', cases: ['loadtest-edit-classify', 'affected-loadtest-list-only'] },
  { name: 'a list-only edit runs only core-load, not the suites that read loadtest.mjs', file: 'tests/lib/depmap.mjs', find: 'for (const [id, dep] of depMap) if (dep.named && dep.named.has(f)) { if (heldBack(id, f)) held.add(id); else ids.add(id); }', replace: '', cases: ['affected-loadtest-list-only'] },
  { name: 'a list-only edit selects every suite that merely globs loadtest.mjs\'s directory', file: 'tests/lib/depmap.mjs', find: 'for (const f of all) if (re.test(f)) { out.add(f); hit = true; }', replace: 'for (const f of all) if (re.test(f)) { out.add(f); named.add(f); hit = true; }', cases: ['affected-loadtest-list-only'] },
  { name: '--changed without --base compares loadtest.mjs with HEAD', file: 'testrun.mjs', find: 'if (changedGiven && !base) return no(', replace: 'if (false) return no(', cases: ['affected-loadtest-list-only'] },
  // ── W-22 (2026-10-08), defect 2: stopping one run never touches another
  { name: 'the stop handler kills suites by NAME pattern instead of its own group', file: 'tests/lib/exec.mjs', find: '  if (RUN_GROUP !== null) sweepRunGroup();\n  else for (const pid of LIVE.keys()) killTree(pid);', replace: "  for (const a of LIVE.values()) spawnSync('pkill', ['-KILL', '-f', path.basename(a[0])]);", cases: ['runner-stop-own-run'] },
  { name: 'suites leave the run\'s group (each spawned detached again)', file: 'tests/lib/exec.mjs', find: "stdio: ['ignore', outFd, errFd], detached: false });", replace: "stdio: ['ignore', outFd, errFd], detached: true });", cases: ['runner-stop-own-run'] },
  { name: 'the run stays in its caller\'s process group (no launcher, no leadership check)', file: 'testrun.mjs', find: "  if (runs && process.env[LAUNCHER_ENV] === undefined) return launch(argv);\n  // review note 9: a run whose launcher is already gone when it starts (killed between spawning it and this line), or whose launcher variable\n  // names some other process, must stop here. Relaunching would start a new run that nothing supervises and nobody asked for.\n  if (runs && process.env[LAUNCHER_ENV] !== String(process.ppid)) {\n    console.error(`❌ testrun: ${LAUNCHER_ENV}=${process.env[LAUNCHER_ENV]} but this process's parent is ${process.ppid} — the launcher that started this run is gone (or the variable was set by hand). Nothing was run.`);\n    process.exit(2);\n  }\n  if (runs) {\n    let pgid = null;", replace: "  if (runs) claimRunGroup(process.pid);\n  if (false) {\n    let pgid = null;", cases: ['runner-stop-own-run'] },
  { name: 'no stop command printed', file: 'testrun.mjs', find: '  console.log(`  stop:  kill -TERM -${process.pid}', replace: '  void (`  stop:  kill -TERM -${process.pid}', cases: ['runner-stop-own-run'] },
  { name: 'the run ignores the death of its launcher', file: 'testrun.mjs', find: '    if (process.ppid === launcherPid) return;', replace: '    return;', cases: ['runner-stop-own-run'] },
  { name: 'the launcher does not forward Ctrl-C / SIGTERM to the run', file: 'testrun.mjs', find: 'process.on(sig, () => { try { process.kill(-child.pid, sig); } catch { /* the run is already gone */ } });', replace: 'process.on(sig, () => {});', cases: ['runner-stop-own-run'] },
  { name: 'the run\'s exit does not sweep its group (a run stopped by its launcher-death watchdog leaves its suites running)', file: 'tests/lib/exec.mjs', find: "  process.on('exit', stopRun);", replace: '', cases: ['runner-stop-own-run'] },
  // ── W-22 review (2026-10-08): note 8 (a suite's leftovers die with it) and note 9 (a run never relaunches itself)
  { name: 'a suite\'s leftovers survive until the run ends (no per-suite reap)', file: 'tests/lib/exec.mjs', find: '      if (RUN_GROUP !== null) reapStrays();', replace: '', cases: ['runner-reaps-per-suite'] },
  { name: 'the stray rule ignores parents (every member but the runner counts as a stray)', file: 'tests/lib/exec.mjs', find: 'if (p.pgid !== RUN_GROUP || p.pid === process.pid || members.has(p.ppid)) continue;', replace: 'if (p.pgid !== RUN_GROUP || p.pid === process.pid) continue;', cases: ['runner-reaps-per-suite'] },
  { name: 'a run whose launcher is gone relaunches itself', file: 'testrun.mjs', find: "  if (runs && process.env[LAUNCHER_ENV] === undefined) return launch(argv);", replace: "  if (runs && process.env[LAUNCHER_ENV] !== String(process.ppid)) return launch(argv);", cases: ['runner-launcher-gone'] },
  // ── M-42 (Drew, 2026-10-14, D-75): an --affected run that would fall back to the full run stops (exit 2, nothing run) and prints the reason,
  //    the faster --changed command (the diff without loadtest.mjs) and, when it does not reach them, loadtest.mjs's own sections; --allow-full proceeds
  { name: 'M-42 (a): an --affected full fallback runs silently again (no stop)', file: 'testrun.mjs', find: 'if (sel.full && !opts.allowFull) return {', replace: 'if (false) return {', cases: ['affected-full-fallback-stops'] },
  { name: 'M-42 (a): the stop exits 0', file: 'testrun.mjs', find: 'printFallbackStop(plan.stop); process.exit(2); }', replace: 'printFallbackStop(plan.stop); process.exit(0); }', cases: ['affected-full-fallback-stops'] },
  { name: 'M-42 (a): the faster command keeps the files that stopped the run in its --changed list', file: 'testrun.mjs', find: 'const rest = changedFiles.filter(f => !isRunner(f));', replace: 'const rest = changedFiles.slice();', cases: ['affected-full-fallback-stops'] },
  { name: 'M-42 (a): the printed --changed list is not shell-quoted (a spaced path breaks it when pasted)', file: 'testrun.mjs', find: "const shq = s => /^[\\w./,@:+=-]+$/.test(s) ? s :", replace: 'const shq = s => true ? s :', cases: ['affected-full-fallback-stops'] },
  { name: 'M-42 (b): --allow-full is ignored (every fallback stops)', file: 'testrun.mjs', find: 'if (sel.full && !opts.allowFull) return {', replace: 'if (sel.full) return {', cases: ['affected-allow-full', 'affected-deps-gate'] },
  // ── review round 1 (2026-10-14): B2 the stop's advice is keyed to its reasons; N3 the selection options are carried; N4 loadtest.mjs's readers
  { name: 'B2: the faster command removes only loadtest.mjs (a runner-file stop has no command again)', file: 'testrun.mjs', find: 'const isRunner = f => runnerRes.some(r => r.test(f));', replace: 'const isRunner = f => f === LOADTEST;', cases: ['affected-full-fallback-stops'] },
  { name: 'B2: a runner-file stop does not offer --only the runner\'s own tests', file: 'testrun.mjs', find: 'if (left.some(f => f !== LOADTEST)) for (const id of RUNNER_SELFTESTS) want.add(id);', replace: '', cases: ['affected-full-fallback-stops'] },
  { name: 'B2/N4: the --only list ignores what the rest of the diff already reaches', file: 'testrun.mjs', find: 'const ids = [...want].filter(id => suites.has(id) && !reach.has(id)).sort();', replace: 'const ids = [...want].filter(id => suites.has(id)).sort();', cases: ['affected-full-fallback-stops'] },
  { name: 'B2: the advice for a file no suite reads is not keyed to that reason', file: 'testrun.mjs', find: 'else if (restSel.full) none = `no suite reads ', replace: 'else if (restSel.full) none = `the rest still falls back: ', cases: ['affected-full-fallback-stops'] },
  { name: 'N4: a loadtest.mjs stop omits the core and the suites that read loadtest.mjs by name', file: 'testrun.mjs', find: 'if (left.includes(LOADTEST)) for (const [id, dep] of depMap) if (dep.named && dep.named.has(LOADTEST)) want.add(id);', replace: '', cases: ['affected-full-fallback-stops'] },
  { name: 'N4: core-load is listed beside the core that contains it', file: 'testrun.mjs', find: 'want.delete(CORE_LOAD);', replace: '', cases: ['affected-full-fallback-stops'] },
  { name: 'N3: --strict-inert is not carried into the printed command', file: 'testrun.mjs', find: "opts.strictInert && '--strict-inert'", replace: 'false', cases: ['affected-full-fallback-stops'] },
  { name: 'N3: --strict-quick is not carried into the printed command', file: 'testrun.mjs', find: "opts.strictQuick && '--strict-quick'", replace: 'false', cases: ['affected-full-fallback-stops'] },
  { name: 'N3: --tz is not carried into the printed --changed command', file: 'testrun.mjs', find: ".map(s => ' ' + s).join('') + tz;", replace: ".map(s => ' ' + s).join('');", cases: ['affected-full-fallback-stops'] },
  { name: 'N3: --tz is not carried into the printed --only command', file: 'testrun.mjs', find: "cmd: `node testrun.mjs --only ${ids.join(',')}${tz}`", replace: "cmd: `node testrun.mjs --only ${ids.join(',')}`", cases: ['affected-full-fallback-stops'] },
  // ── M-49 (Drew, 2026-10-14): the runner's real-tree checks moved to runnerrepotest, which a runner change can break too
  { name: 'M-49: a runner-file stop offers testruntest alone (runnerrepotest left out)', file: 'testrun.mjs', find: "export const RUNNER_SELFTESTS = ['testruntest', 'runnerrepotest'];", replace: "export const RUNNER_SELFTESTS = ['testruntest'];", cases: ['affected-full-fallback-stops'] },
  // ── review round 1: B1 the schema refuses the misuse that matters
  { name: 'B1: affectedByDepsOnly allowed on any suite (no allow-list)', file: 'tests/lib/manifest.mjs', find: 'if (!HELD_SUITES.includes(m.id)) errs.push(', replace: 'if (false) errs.push(', cases: ['manifest-schema'] },
  { name: 'B1: a held dep that matches no file is accepted', file: 'tests/lib/manifest.mjs', find: 'if (!files.some(f => re.test(f))) errs.push(', replace: 'if (false) errs.push(', cases: ['manifest-schema'] },
  // ── M-43 (Drew, 2026-10-14, D-76): "affectedByDepsOnly" holds a suite's --affected selection to its script and its own deps; --full runs it
  { name: 'M-43 (c): the deps gate is ignored (a held suite is selected by any file its map reaches)', file: 'tests/lib/depmap.mjs', find: 'const heldBack = (id, f) => gates.has(id) && !gates.get(id).some(r => r.test(f));', replace: 'const heldBack = (id, f) => false;', cases: ['affected-deps-gate'] },
  { name: 'M-43 (c): a list-only loadtest.mjs edit ignores the gate', file: 'tests/lib/depmap.mjs', find: 'for (const [id, dep] of depMap) if (dep.named && dep.named.has(f)) { if (heldBack(id, f)) held.add(id); else ids.add(id); }', replace: 'for (const [id, dep] of depMap) if (dep.named && dep.named.has(f)) ids.add(id);', cases: ['affected-deps-gate'] },
  { name: 'M-43: a file only a held suite reads counts as mapped (the smoke set alone would run)', file: 'tests/lib/depmap.mjs', find: 'if (heldBack(id, f)) { if (dep.files.has(f) || dep.globs.some(g => globToRegExp(g).test(f))) held.add(id); continue; }', replace: 'if (heldBack(id, f)) { if (dep.files.has(f) || dep.globs.some(g => globToRegExp(g).test(f))) { held.add(id); mapped = true; } continue; }', cases: ['affected-deps-gate'] },
  { name: 'M-43 (d): the gate matches nothing (a held suite is never selected by --affected)', file: 'tests/lib/depmap.mjs', find: 'const gate = man.affectedByDepsOnly ? [...new Set([scriptRel, ...(man.deps || [])', replace: 'const gate = man.affectedByDepsOnly ? [...new Set([...[]', cases: ['affected-deps-gate'] },
  { name: 'M-43 (d): the gate drops the suite\'s own script', file: 'tests/lib/depmap.mjs', find: 'const gate = man.affectedByDepsOnly ? [...new Set([scriptRel, ...(man.deps || [])', replace: 'const gate = man.affectedByDepsOnly ? [...new Set([...(man.deps || [])', cases: ['affected-deps-gate'] },
  { name: 'M-43 (e): --full skips held suites', file: 'testrun.mjs', find: "selected = all.filter(m => m.id !== 'core-load').map(withTags);\n  } else if (tier === 'tz') {", replace: "selected = all.filter(m => m.id !== 'core-load' && !m.affectedByDepsOnly).map(withTags);\n  } else if (tier === 'tz') {", cases: ['affected-deps-gate'] },
  { name: 'M-43 (e): an allowed fallback to the full run skips held suites', file: 'testrun.mjs', find: "for (const r of sel.reasons) note.push(`FALLBACK TO --full: ${r}`);\n      selected = all.filter(m => m.id !== 'core-load').map(withTags);", replace: "for (const r of sel.reasons) note.push(`FALLBACK TO --full: ${r}`);\n      selected = all.filter(m => m.id !== 'core-load' && !m.affectedByDepsOnly).map(withTags);", cases: ['affected-deps-gate'] },
  { name: 'M-43: a held suite may carry the smoke or quick tag (it would run whatever changed)', file: 'tests/lib/manifest.mjs', find: "for (const t of ['smoke', 'quick']) if (Array.isArray(m.tags) && m.tags.includes(t)) errs.push(", replace: 'for (const t of []) if (Array.isArray(m.tags) && m.tags.includes(t)) errs.push(', cases: ['manifest-schema'] },
  { name: 'M-43: affectedByDepsOnly accepted with no deps', file: 'tests/lib/manifest.mjs', find: "if (!Array.isArray(m.deps) || !m.deps.length) errs.push(`${at}: \"affectedByDepsOnly\" needs", replace: "if (false) errs.push(`${at}: \"affectedByDepsOnly\" needs", cases: ['manifest-schema'] },
  { name: 'M-43: --explain does not say what a held suite is held to', file: 'testrun.mjs', find: 'if (d.gate) console.log(', replace: 'if (false) console.log(', cases: ['affected-deps-gate'] },
];

if (!NO_MUTANTS) {
  console.log('\n[mutation battery] — each mutant is a scratch COPY of the runner with ONE line broken; the named case must go RED on it and GREEN on an unbroken copy');
  const copyRunner = (dest) => {
    mkdirSync(path.join(dest, 'tests'), { recursive: true });
    writeFileSync(path.join(dest, 'testrun.mjs'), readFileSync(path.join(ROOT, 'testrun.mjs')));
    cpSync(path.join(ROOT, 'tests', 'lib'), path.join(dest, 'tests', 'lib'), { recursive: true });
    if (existsSync(path.join(ROOT, 'tests', 'parity.mjs'))) writeFileSync(path.join(dest, 'tests', 'parity.mjs'), readFileSync(path.join(ROOT, 'tests', 'parity.mjs')));
  };
  // one child process per (runner copy, case); a small pool keeps the battery fast without swamping the machine it shares with the sweep
  const runCase = (rootDir, name) => new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(here, 'testruntest.mjs'), '--root', rootDir, '--case', name], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 150000);
    c.on('close', code => { clearTimeout(t); resolve({ status: code, out }); });
  });
  const POOL = Math.max(2, Math.min(4, Math.floor(cpus().length / 2)));
  const runAll = async (jobs) => {
    const results = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: POOL }, async () => { for (;;) { const i = next++; if (i >= jobs.length) return; results[i] = await jobs[i](); } }));
    return results;
  };
  const control = mkdtempSync(path.join(tmpdir(), 'testruntest-control-'));
  tmpRoots.push(control);
  copyRunner(control);
  const controls = [...new Set(MUTANTS.flatMap(m => m.cases))];
  const prepared = MUTANTS.map(mu => {
    const dir = mkdtempSync(path.join(tmpdir(), 'testruntest-mutant-'));
    tmpRoots.push(dir);
    copyRunner(dir);
    const file = path.join(dir, mu.file);
    const original = readFileSync(file, 'utf8');
    let mutated = original.includes(mu.find) ? original.replace(mu.find, mu.replace) : null;
    for (const e of mu.also || []) mutated = mutated !== null && mutated.includes(e.find) ? mutated.replace(e.find, e.replace) : null;   // every extra edit must exist too
    if (mutated !== null && mutated !== original) writeFileSync(file, mutated);
    return { mu, dir, ok: mutated !== null && mutated !== original };
  });
  const controlResults = await runAll(controls.map(c => () => runCase(control, c)));
  const mutantJobs = [];
  for (const p of prepared) if (p.ok) for (const c of p.mu.cases) mutantJobs.push({ p, c, run: () => runCase(p.dir, c) });
  const mutantResults = await runAll(mutantJobs.map(j => j.run));
  controls.forEach((c, i) => assert(controlResults[i].status === 0, `control: case ${c} is GREEN on an unbroken scratch copy`, controlResults[i].out.split('\n').filter(l => /❌/.test(l)).slice(0, 2).join(' | ')));
  for (const p of prepared) {
    assert(p.ok, `mutant "${p.mu.name}": the line to break exists in ${p.mu.file} (a vacuous mutation proves nothing)`);
    if (!p.ok) continue;
    const mine = mutantJobs.map((j, i) => [j, mutantResults[i]]).filter(([j]) => j.p === p);
    const red = mine.filter(([, r]) => r.status !== 0).length;
    assert(red === p.mu.cases.length, `mutant "${p.mu.name}" turns ${p.mu.cases.join(' + ')} RED (${red}/${p.mu.cases.length})`);
  }
}

for (const d of tmpRoots) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
