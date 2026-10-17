/**
 * tests/kits/w57-mutate.mjs — THE MUTATION KIT OF W-57 (the Locker Room's sport pills, the sportTag plumbing, the game-first push audience and the app-wide phone inset)
 * =====================================================================================================================================================================
 * S-3 (Drew, 2026-10-08, D-69): "your mutation kit is the item's kit" — the builder COMMITS the mutants, encoded and re-runnable, with the RED output named; the reviewer runs this kit and adds only gap
 * mutants. `w57-mutants.json` (beside this file) is the list: { id, why, file, old, new, suites, red: { suite, label } }.
 *
 *   node tests/kits/w57-mutate.mjs                    run every mutant (about 40 minutes: it runs the cheapest suite first and stops at the first red)
 *   node tests/kits/w57-mutate.mjs --only P2-inset,R-M1   only the mutants whose id STARTS WITH one of the comma-separated prefixes
 *   node tests/kits/w57-mutate.mjs --list             print the ids, the suites and the RED each one names
 *   node tests/kits/w57-mutate.mjs --record           run, and write each mutant's observed RED (killing suite + its first failing assertion) back into w57-mutants.json
 *
 * HOW IT STAYS SAFE (CLAUDE.md, "never use git checkout / restore / stash to undo a mutation"): it never touches this checkout. It copies cfb-pickems/ (and ../docs, which static.check reads) into a
 * temporary directory TWICE — a pristine copy and a working copy — applies each mutant to the WORKING copy only, and restores that one file from the pristine copy afterwards. A failed restore looks exactly
 * like a passing run, so after every mutant it re-runs the first suite and requires GREEN ("restore:green"). Each distinct suite is also run once on the unmutated copy first: a red baseline aborts the kit.
 *
 * EXIT CODE: 0 only if every mutant was KILLED, every restore came back green, every `old` string matched exactly once, and (outside --record) each kill is red on the assertion the kit names.
 * RETIRED (equivalent) MUTANT: `W1-M17c xss-value` (the pill's data value left unescaped) survived once Part 2 made `sportPillsMarkup` refuse any dbCode outside the closed set — the value can only be one of seven
 * fixed codes (or 'all'), so the mutant changes no output. It is dropped, not hidden; the closed-set refusal itself is mutant `P2-list-2` and chatsporttest [6o2].
 * `chatsportkitapplytest.mjs` (registered with the runner, a second per mutant-set) checks that every `old` string still matches the live tree exactly once, so the kit cannot rot silently.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFB = join(HERE, '..', '..');
const REPO = join(CFB, '..');
const KIT = join(HERE, 'w57-mutants.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : null; })();

const mutants = JSON.parse(readFileSync(KIT, 'utf8'));
const selected = mutants.filter((m) => !only || only.some((p) => m.id.startsWith(p)));

if (flag('--list')) {
  for (const m of mutants) console.log(`${m.id}\n    suites: ${m.suites.join(', ')}\n    RED: ${m.red ? `${m.red.suite}: ${m.red.label}` : '(not recorded yet)'}`);
  console.log(`\n${mutants.length} mutants`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'w57kit-'));
const SKIP = (p) => !/(^|\/)(node_modules|\.git|\.deploy)(\/|$)/.test(p);
const work = join(tmp, 'work'), pristine = join(tmp, 'pristine');
for (const root of [work, pristine]) {
  cpSync(CFB, join(root, 'cfb-pickems'), { recursive: true, filter: SKIP });
  if (existsSync(join(REPO, 'docs'))) cpSync(join(REPO, 'docs'), join(root, 'docs'), { recursive: true, filter: SKIP });
}
const W = join(work, 'cfb-pickems'), P = join(pristine, 'cfb-pickems');
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

/** Run one suite in the working copy. Returns { suite, code, label }: `label` is the FIRST failing assertion's text (never the summary line). */
function run(suite) {
  const r = spawnSync('node', [suite], { cwd: W, env: { ...process.env, CHATSPORT_ROOT: W }, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n');
  const fails = lines.map((l) => l.match(/^\s*(?:❌|✗)\s+(.*\S)\s*$/)).filter(Boolean).map((m) => m[1]).filter((t) => !/^(FAILURES|ALL PASS)\b/.test(t) && !/\d+ passed, \d+ failed/.test(t));
  const crash = r.status !== 0 && !fails.length ? `(the suite exited ${r.status} without a failing assertion: ${((r.stderr || '').split('\n').find((l) => /Error|error/.test(l)) || 'crash').trim().slice(0, 90)})` : '';
  return { suite, code: r.status, label: (fails[0] || crash || '').slice(0, 160) };
}

console.log(`\nW-57 mutation kit — ${selected.length} of ${mutants.length} mutants — scratch ${tmp}\n`);
const baseline = [...new Set(selected.flatMap((m) => m.suites))];
let baselineRed = [];
for (const s of baseline) { const r = run(s); if (r.code !== 0) baselineRed.push(`${s}: ${r.label}`); }
if (baselineRed.length) { console.error(`BASELINE RED — the unmutated copy fails, so no kill would mean anything:\n  ${baselineRed.join('\n  ')}`); process.exit(2); }
console.log(`baseline green: ${baseline.length} suites\n`);

const rows = [];
for (const m of selected) {
  const path = join(W, m.file), orig = readFileSync(join(P, m.file), 'utf8');
  const count = orig.split(m.old).length - 1;
  if (count !== 1) { rows.push({ id: m.id, status: `SETUP ERROR (the old string matches ${count} times)` }); console.log(`SETUP ERROR ${m.id}`); continue; }
  writeFileSync(path, orig.replace(m.old, () => m.new));
  let killer = null;
  for (const s of m.suites) { const r = run(s); if (r.code !== 0) { killer = r; break; } }
  writeFileSync(path, orig);                                        // restore from the pristine copy's text, never from git
  const green = run(m.suites[0]);
  const row = { id: m.id, killed: !!killer, restored: green.code === 0, killer };
  if (killer) {
    const want = m.red && m.red.label;
    row.redMatches = flag('--record') ? true : !want || killer.label.includes(want.slice(0, 60));
    if (flag('--record')) m.red = { suite: killer.suite, label: killer.label };
  }
  rows.push(row);
  console.log(`${killer ? 'KILLED  ' : 'SURVIVED'} ${m.id}  restore:${green.code === 0 ? 'green' : 'STILL RED'}${killer ? `  <- ${killer.suite}: ${killer.label.slice(0, 110)}` : ''}${killer && row.redMatches === false ? '   [RED DIFFERS from the recorded one]' : ''}`);
}

if (flag('--record')) writeFileSync(KIT, JSON.stringify(mutants, null, 1));
const survivors = rows.filter((r) => r.killed === false), setup = rows.filter((r) => r.status), badRestore = rows.filter((r) => r.restored === false), drift = rows.filter((r) => r.redMatches === false);
console.log(`\n${rows.length - survivors.length - setup.length}/${rows.length} killed; survivors: ${survivors.map((r) => r.id).join(', ') || 'none'}; setup errors: ${setup.length}; restores not green: ${badRestore.length}; RED differs from the recorded: ${drift.length}`);
process.exit(survivors.length || setup.length || badRestore.length || drift.length ? 1 : 0);
