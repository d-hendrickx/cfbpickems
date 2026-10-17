/**
 * tests/kits/w66-mutate.mjs — THE MUTATION KIT OF W-66 (Request a game: Find games, Request and Withdraw did nothing in the drawer)
 * =================================================================================================================================
 * S-3 (Drew, 2026-10-08, D-69): the bugfixer COMMITS the mutants, encoded and re-runnable, with the RED output named; the reviewer runs this kit and adds only gap mutants.
 * `w66-mutants.json` (beside this file) is the list: { id, why, file, old, new, suites, red: { suite, label } }. The killing suite is ccscrolltest.mjs section [G], which
 * drives the REAL app in headless Chromium (CCSCROLL_ROOT points it at the mutated copy).
 *
 *   node tests/kits/w66-mutate.mjs                 run every mutant (each one is a full ccscrolltest run, about a minute; longer on a loaded machine)
 *   node tests/kits/w66-mutate.mjs --only M1,M6    only the mutants whose id STARTS WITH one of the comma-separated prefixes
 *   node tests/kits/w66-mutate.mjs --list          print the ids and the RED each one names
 *   node tests/kits/w66-mutate.mjs --record        run, and write each mutant's observed RED (its first failing assertion) back into w66-mutants.json
 *
 * HOW IT STAYS SAFE (CLAUDE.md, "never use git checkout / restore / stash to undo a mutation"): it never touches this checkout. It copies cfb-pickems/ into a temporary
 * directory twice (pristine and working), applies each mutant to the WORKING copy only, and restores that one file from the pristine copy's text. After every mutant the
 * restored file is compared byte for byte with the pristine one, and once all mutants have run the suite is run again on the working copy and must be GREEN. The suite is
 * also run once on the unmutated copy first: a red baseline aborts the kit (a kill on a red baseline means nothing).
 *
 * EXIT CODE: 0 only if the baseline was green, every mutant was KILLED, every `old` text matched exactly once, every restore was byte-identical, the closing run was green,
 * and (outside --record) each kill is red on the assertion the kit names.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFB = join(HERE, '..', '..');
const KIT = join(HERE, 'w66-mutants.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : null; })();

const mutants = JSON.parse(readFileSync(KIT, 'utf8'));
const selected = mutants.filter((m) => !only || only.some((p) => m.id.startsWith(p)));

if (flag('--list')) {
  for (const m of mutants) console.log(`${m.id}\n    why: ${m.why}\n    suites: ${m.suites.join(', ')}\n    RED: ${m.red ? `${m.red.suite}: ${m.red.label}` : '(not recorded yet)'}`);
  console.log(`\n${mutants.length} mutants`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'w66kit-'));
const SKIP = (p) => !/(^|\/)(node_modules|\.git|\.deploy)(\/|$)/.test(p);
const W = join(tmp, 'work', 'cfb-pickems'), P = join(tmp, 'pristine', 'cfb-pickems');
cpSync(CFB, W, { recursive: true, filter: SKIP });
cpSync(CFB, P, { recursive: true, filter: SKIP });
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

/** Run one suite in the working copy. Returns { suite, code, label }: `label` is the FIRST failing assertion's text (never the summary line). */
function run(suite) {
  const r = spawnSync('node', [suite], { cwd: W, env: { ...process.env, CCSCROLL_ROOT: W }, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n');
  const fails = lines.map((l) => l.match(/^\s*❌\s+(.*\S)\s*$/)).filter(Boolean).map((m) => m[1]).filter((t) => !/^(FAILURES|ALL PASS)\b/.test(t) && !/\d+ passed, \d+ failed/.test(t));
  const crash = r.status !== 0 && !fails.length ? `(the suite exited ${r.status} without a failing assertion)` : '';
  return { suite, code: r.status, label: (fails[0] || crash || '').slice(0, 160) };
}

console.log(`\nW-66 mutation kit — ${selected.length} of ${mutants.length} mutants — scratch ${tmp}\n`);
const suites = [...new Set(selected.flatMap((m) => m.suites))];
const baselineRed = suites.map(run).filter((r) => r.code !== 0);
if (baselineRed.length) { console.error(`BASELINE RED — the unmutated copy fails, so no kill would mean anything:\n  ${baselineRed.map((r) => `${r.suite}: ${r.label}`).join('\n  ')}`); process.exit(2); }
console.log(`baseline green: ${suites.join(', ')}\n`);

const rows = [];
for (const m of selected) {
  const path = join(W, m.file), orig = readFileSync(join(P, m.file), 'utf8');
  const count = orig.split(m.old).length - 1;
  if (count !== 1) { rows.push({ id: m.id, status: `SETUP ERROR (the old text matches ${count} times)` }); console.log(`SETUP ERROR ${m.id} (old text matches ${count} times)`); continue; }
  writeFileSync(path, orig.replace(m.old, () => m.new));
  let killer = null;
  for (const s of m.suites) { const r = run(s); if (r.code !== 0) { killer = r; break; } }
  writeFileSync(path, orig);                                        // restore from the pristine copy's text, never from git
  const restored = readFileSync(path, 'utf8') === orig;
  const row = { id: m.id, killed: !!killer, restored, killer };
  if (killer) {
    const want = m.red && m.red.label;
    row.redMatches = flag('--record') ? true : !want || killer.label.includes(want.slice(0, 60));
    if (flag('--record')) m.red = { suite: killer.suite, label: killer.label };
  }
  rows.push(row);
  console.log(`${killer ? 'KILLED  ' : 'SURVIVED'} ${m.id}  restore:${restored ? 'byte-identical' : 'DIFFERS'}${killer ? `  <- ${killer.suite}: ${killer.label.slice(0, 120)}` : ''}${killer && row.redMatches === false ? '   [RED DIFFERS from the recorded one]' : ''}`);
}

const closing = suites.map(run).filter((r) => r.code !== 0);
console.log(closing.length ? `\nCLOSING RUN RED after every restore: ${closing.map((r) => `${r.suite}: ${r.label}`).join(' | ')}` : `\nclosing run green after every restore: ${suites.join(', ')}`);
if (flag('--record')) writeFileSync(KIT, JSON.stringify(mutants, null, 1) + '\n');
const survivors = rows.filter((r) => r.killed === false), setup = rows.filter((r) => r.status), badRestore = rows.filter((r) => r.restored === false), drift = rows.filter((r) => r.redMatches === false);
console.log(`\n${rows.length - survivors.length - setup.length}/${rows.length} killed; survivors: ${survivors.map((r) => r.id).join(', ') || 'none'}; setup errors: ${setup.length}; restores not byte-identical: ${badRestore.length}; RED differs from the recorded: ${drift.length}`);
process.exit(survivors.length || setup.length || badRestore.length || drift.length || closing.length ? 1 : 0);
