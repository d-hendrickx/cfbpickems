/**
 * tests/kits/w68-w69-mutate.mjs — THE MUTATION KIT OF W-68 / W-69 (add-or-swap on a full slate; one games list with Remove in place; the swap picker)
 * =================================================================================================================================================
 * S-3 (Drew, 2026-10-08, D-69): "your mutation kit is the item's kit" — the builder COMMITS the mutants, encoded and re-runnable, with the RED output named; the reviewer runs this kit and adds only
 * gap mutants. `w68-w69-mutants.json` (beside this file) is the list: { id, why, file, old, new, suites, red: { suite, label } }.
 *
 *   node tests/kits/w68-w69-mutate.mjs                       run every mutant (about 20 minutes with 3 workers)
 *   node tests/kits/w68-w69-mutate.mjs --only A1,L,P1        only the mutants whose id STARTS WITH one of the comma-separated prefixes
 *   node tests/kits/w68-w69-mutate.mjs --list                print the ids, the suites and the RED each one names
 *   node tests/kits/w68-w69-mutate.mjs --record              run, and write each mutant's observed RED (killing suite + its first failing assertion) back into w68-w69-mutants.json
 *   node tests/kits/w68-w69-mutate.mjs --jobs 4              workers (each owns a full copy of the tree; default 3)
 *
 * HOW IT STAYS SAFE (CLAUDE.md, "never use git checkout / restore / stash to undo a mutation"): it never touches this checkout. It copies cfb-pickems/ into a temporary directory once per worker plus one
 * PRISTINE copy; applies each mutant to a worker's copy only; and restores that one file from the pristine copy's TEXT afterwards. A failed restore looks exactly like a passing run, so after every mutant it
 * compares the restored file byte for byte with the pristine one ("restore:identical"), and at the end every worker runs both suites once more and requires GREEN. Each suite also runs once on the unmutated
 * copy first: a red baseline aborts the kit. Inside one worker's copy suites run ONE AT A TIME, in the baseline pass, the mutant loop and the final pass alike (D-2: a tree-isolated suite rewrites files in its copy).
 *
 * EXIT CODE: 0 only if every mutant was KILLED, every restore was identical, every `old` string matched exactly once, and (outside --record) each kill is red on the assertion the kit names.
 * The suites check, in their own last section, that every `old` string here still matches the live tree exactly once, so the kit cannot rot silently.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFB = join(HERE, '..', '..');
const KIT = join(HERE, 'w68-w69-mutants.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const only = opt('--only') ? opt('--only').split(',').map((s) => s.trim()).filter(Boolean) : null;
const jobs = Math.max(1, Number(opt('--jobs')) || 3);

const mutants = JSON.parse(readFileSync(KIT, 'utf8'));
const selected = mutants.filter((m) => !only || only.some((p) => m.id.startsWith(p)));

if (flag('--list')) {
  for (const m of mutants) console.log(`${m.id}\n    ${m.why}\n    suites: ${m.suites.join(', ')}\n    RED: ${m.red ? `${m.red.suite}: ${m.red.label}` : '(not recorded yet)'}`);
  console.log(`\n${mutants.length} mutants`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'w6869kit-'));
const SKIP = (p) => !/(^|\/)(node_modules|\.git|\.deploy)(\/|$)/.test(p);
const pristine = join(tmp, 'pristine');
cpSync(CFB, pristine, { recursive: true, filter: SKIP });
const workers = Array.from({ length: jobs }, (_, i) => { const dir = join(tmp, `w${i}`); cpSync(CFB, dir, { recursive: true, filter: SKIP }); return dir; });
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

/** Run one suite in `cwd`. Resolves { suite, code, label }: `label` is the FIRST failing assertion's text (never the summary line). */
function run(cwd, suite) {
  return new Promise((resolve) => {
    const p = spawn('node', [suite], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), 600000);
    p.on('close', (code) => {
      clearTimeout(t);
      const lines = `${err}\n${out}`.split('\n');
      const all = lines.map((l) => l.match(/^\s*(?:❌|✗)\s+(.*\S)\s*$/)).filter(Boolean).map((m) => m[1]).filter((x) => !/^(FAILURES|ALL PASS)\b/.test(x) && !/\d+ passed, \d+ failed/.test(x));
      // The suites' last section checks that every mutant's `old` string still matches the live tree exactly once. On a MUTATED tree that one assertion goes red for the mutant being applied, whatever the
      // tests think, so it is never evidence of a kill: a suite whose ONLY failure is that anchor check counts as GREEN here (found 2026-10-14: seven mutants had been "killed" by it alone).
      const fails = all.filter((x) => !/every kit mutant's `old` string matches/.test(x));
      const anchorOnly = code !== 0 && all.length > 0 && fails.length === 0;
      const crash = code !== 0 && !all.length ? `(the suite exited ${code} without a failing assertion: ${((err || '').split('\n').find((l) => /Error|error/.test(l)) || 'crash').trim().slice(0, 120)})` : '';
      resolve({ suite, code: anchorOnly ? 0 : code, anchorOnly, label: (fails[0] || crash || '').slice(0, 160) });
    });
  });
}

console.log(`\nW-68 / W-69 mutation kit — ${selected.length} of ${mutants.length} mutants, ${jobs} workers — scratch ${tmp}\n`);
const suitesAll = [...new Set(selected.flatMap((m) => m.suites))];
/** One worker runs ITS suites one at a time (D-2, delta review 2026-10-14): a worker's tree copy is shared by everything run in it, and a tree-isolated suite (notifytest, `isolate:"tree"`) rewrites files such as
 *  js/notify-copy.js mid-run, which a suite running beside it in the same copy would read half-written. Workers still run in parallel with each other (each has its own copy). */
async function runSerial(dir, suites) { const out = []; for (const s of suites) out.push(await run(dir, s)); return out; }
const baseline = (await Promise.all(workers.map((d, wi) => runSerial(d, suitesAll.filter((_, i) => i % workers.length === wi))))).flat();
const red = baseline.filter((r) => r.code !== 0);
if (red.length) { console.error(`BASELINE RED — the unmutated copy fails, so no kill would mean anything:\n  ${red.map((r) => `${r.suite}: ${r.label}`).join('\n  ')}`); process.exit(2); }
console.log(`baseline green: ${suitesAll.length} suites\n`);

const rows = [];
const queue = [...selected];
async function worker(dir) {
  while (queue.length) {
    const m = queue.shift();
    const path = join(dir, m.file), origPath = join(pristine, m.file);
    const orig = readFileSync(origPath, 'utf8');
    const count = orig.split(m.old).length - 1;
    if (count !== 1) { rows.push({ id: m.id, status: `SETUP ERROR (the old string matches ${count} times)` }); console.log(`SETUP ERROR ${m.id}`); continue; }
    writeFileSync(path, orig.replace(m.old, () => m.new));
    let killer = null;
    for (const s of m.suites) { const r = await run(dir, s); if (r.code !== 0) { killer = r; break; } }
    writeFileSync(path, orig);                                      // restore from the pristine copy's text, never from git
    const identical = readFileSync(path, 'utf8') === orig;
    const row = { id: m.id, killed: !!killer, restored: identical, killer, m };
    if (killer) {
      const want = m.red && m.red.label;
      row.redMatches = flag('--record') ? true : !want || killer.label.includes(want.slice(0, 60));
    }
    rows.push(row);
    console.log(`${killer ? 'KILLED  ' : 'SURVIVED'} ${m.id}  restore:${identical ? 'identical' : 'DIFFERS'}${killer ? `  <- ${killer.suite}: ${killer.label.slice(0, 110)}` : ''}${killer && row.redMatches === false ? '   [RED DIFFERS from the recorded one]' : ''}`);
  }
}
await Promise.all(workers.map((d) => worker(d)));

// every worker's tree must be green again (nothing left mutated)
const after = (await Promise.all(workers.map((d) => runSerial(d, selected.length ? suitesAll : [])))).flat();
const stillRed = after.filter((r) => r.code !== 0);
if (stillRed.length) console.error(`FINAL CHECK RED: ${stillRed.map((r) => `${r.suite}: ${r.label}`).join('; ')}`);

if (flag('--record')) {
  for (const r of rows) if (r.killer && r.m) { const live = mutants.find((x) => x.id === r.id); live.red = { suite: r.killer.suite, label: r.killer.label }; }
  writeFileSync(KIT, JSON.stringify(mutants, null, 1) + '\n');
}
const survivors = rows.filter((r) => r.killed === false), setup = rows.filter((r) => r.status), badRestore = rows.filter((r) => r.restored === false), drift = rows.filter((r) => r.redMatches === false);
console.log(`\n${rows.length - survivors.length - setup.length}/${rows.length} killed; survivors: ${survivors.map((r) => r.id).join(', ') || 'none'}; setup errors: ${setup.length}; restores not identical: ${badRestore.length}; RED differs from the recorded one: ${drift.length}; final check red: ${stillRed.length}`);
process.exit(survivors.length || setup.length || badRestore.length || drift.length || stillRed.length ? 1 : 0);
