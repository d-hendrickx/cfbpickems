#!/usr/bin/env node
/**
 * tests/kits/w22-loadflake3-mutate.mjs — THE MUTATION KIT OF W-22 ROUND 3 (fix/d1-loadflake-3): wizardsheettest's boot race, wizardfinalizetest 5f-1b's read
 * at the success, pushnativetest [17]'s module isolation.
 * ================================================================================================================================================================
 * S-3 (Drew, 2026-10-08, D-69): the builder commits the mutants, encoded and re-runnable, with the RED output named; the reviewer runs this kit and adds only gap
 * mutants. `w22-loadflake3-mutants.json` (beside this file) is the list: { id, kind, why, file, old, new, suites, red: { suite, label } }.
 *   kind "measurement" — the old measurement put back: the item's guard must go RED (the fix is what holds it green).
 *   kind "behaviour"   — the app (or its stylesheet) broken: the assertion the measurement serves must still go RED (the fix did not weaken it).
 *
 *   node tests/kits/w22-loadflake3-mutate.mjs              run every mutant (about 6 minutes alone: wizardsheettest is a browser suite)
 *   node tests/kits/w22-loadflake3-mutate.mjs --only W2,W3 only the mutants whose id STARTS WITH one of the comma-separated prefixes
 *   node tests/kits/w22-loadflake3-mutate.mjs --list       print the ids, the suites and the RED each one names
 *   node tests/kits/w22-loadflake3-mutate.mjs --check      check only that every `old` string matches the live tree exactly once (seconds; nothing runs)
 *
 * SAFETY (CLAUDE.md, "never use git checkout / restore / stash to undo a mutation"): it never writes this checkout. It copies cfb-pickems/ into a temporary
 * directory, applies each mutant to that COPY, restores the file there from the text it read before mutating, and after every mutant re-runs the first suite
 * on the restored copy and requires GREEN (a failed restore looks exactly like a passing run). Each suite is run once on the unmutated copy first: a red
 * baseline aborts, because no kill would then mean anything. Not registered with the runner (it takes minutes and runs browser suites one after another).
 *
 * EXIT CODE: 0 only if every `old` string matched exactly once, every mutant was KILLED on the assertion it names, and every restore came back green.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFB = join(HERE, '..', '..');
const mutants = JSON.parse(readFileSync(join(HERE, 'w22-loadflake3-mutants.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : null; })();
const selected = mutants.filter((m) => !only || only.some((p) => m.id.startsWith(p)));
const matches = (root, m) => readFileSync(join(root, m.file), 'utf8').split(m.old).length - 1;

if (flag('--list')) {
  for (const m of mutants) console.log(`${m.id}  [${m.kind}]\n    ${m.why}\n    suites: ${m.suites.join(', ')}\n    RED: ${m.red.suite}: ${m.red.label}`);
  console.log(`\n${mutants.length} mutants`);
  process.exit(0);
}
if (flag('--check')) {
  let bad = 0;
  for (const m of selected) { const n = matches(CFB, m); if (n !== 1) { bad++; console.log(`✗ ${m.id}: the old string matches ${n} times in ${m.file}`); } else console.log(`✓ ${m.id}`); }
  console.log(bad ? `\n${bad} mutant(s) no longer apply — the kit has rotted` : `\nall ${selected.length} mutants apply to the live tree exactly once`);
  process.exit(bad ? 1 : 0);
}

const tmp = mkdtempSync(join(tmpdir(), 'w22kit3-'));
const W = join(tmp, 'cfb-pickems');
cpSync(CFB, W, { recursive: true, filter: (p) => !/(^|\/)(node_modules|\.git|\.deploy)(\/|$)/.test(p) });
const cleanup = () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

/** Runs one suite in the copy. `fails` are its failing assertions' texts (never the summary line). */
function run(suite) {
  const r = spawnSync('node', [suite], { cwd: W, env: { ...process.env, WIZTEST_ROOT: W }, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n');
  const fails = lines.map((l) => l.match(/^\s*❌\s+(.*\S)\s*$/)).filter(Boolean).map((x) => x[1]).filter((t) => !/^FAILURES\b/.test(t) && !/\d+ passed, \d+ failed/.test(t));
  return { suite, code: r.status, fails };
}

console.log(`\nW-22 round 3 mutation kit — ${selected.length} of ${mutants.length} mutants — scratch ${tmp}\n`);
const baseline = [...new Set(selected.flatMap((m) => m.suites))];
const baselineRed = baseline.map(run).filter((r) => r.code !== 0);
if (baselineRed.length) { console.error(`BASELINE RED — the unmutated copy fails, so no kill would mean anything:\n  ${baselineRed.map((r) => `${r.suite}: ${r.fails[0] || `exit ${r.code}`}`).join('\n  ')}`); process.exit(2); }
console.log(`baseline green: ${baseline.join(', ')}\n`);

let bad = 0;
for (const m of selected) {
  const path = join(W, m.file), orig = readFileSync(path, 'utf8');
  const n = orig.split(m.old).length - 1;
  if (n !== 1) { bad++; console.log(`✗ ${m.id}: SETUP ERROR (the old string matches ${n} times)`); continue; }
  writeFileSync(path, orig.replace(m.old, () => m.new));
  let killer = null;
  for (const s of m.suites) { const r = run(s); if (r.code !== 0) { killer = r; break; } }
  writeFileSync(path, orig);                                    // restored from the text read above, never from git
  const restored = run(m.suites[0]).code === 0;
  const named = !!killer && killer.suite === m.red.suite && killer.fails.some((f) => f.startsWith(m.red.label));
  const ok = named && restored;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${m.id} [${m.kind}] — ${killer ? `RED in ${killer.suite}` : 'SURVIVED'}${killer ? `: ${(killer.fails.find((f) => f.startsWith(m.red.label)) || killer.fails[0] || `exit ${killer.code}`).slice(0, 170)}` : ''}`
    + `${named ? '' : `  (expected RED on "${m.red.label}" in ${m.red.suite})`}${restored ? '  · restore: green' : '  · RESTORE NOT GREEN'}`);
}
console.log(`\n${bad ? `✗ ${bad} of ${selected.length} mutant(s) not killed as named, or not restored` : `✓ all ${selected.length} mutants killed on the assertion they name; every restore green`}`);
process.exit(bad ? 1 : 0);
