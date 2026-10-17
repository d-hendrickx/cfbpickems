#!/usr/bin/env node
/**
 * tests/kits/w12-latch-mutate.mjs — THE MUTATION KIT OF W-12 / PM-212 and W-36 (fix/d1-live-script-latch-2): the live latch on the four credential-loading scripts, and the DEV clean-up runbook.
 * ================================================================================================================================================================
 * S-3 (Drew, 2026-10-08, D-69): the builder commits the mutants, encoded and re-runnable, with the RED output named; the reviewer runs this kit and adds only gap
 * mutants. `w12-latch-mutants.json` (beside this file) is the list: { id, kind, why, file (repo-relative), old, new, suites (cfb-pickems-relative), red: { suite, label } }.
 *   kind "wiring" — one of the four scripts, the importer set or a runbook command loses the latch: static.check's LIVE-LATCH section must go RED.
 *   kind "latch"  — _live-latch.mjs itself is weakened: latchtest (runtime) or, where only the shape can see it, static.check must go RED.
 *   kind "runbook" — W-36: docs/runbook/DEV_CLEANUP_W36.md drifts from the reviewed draft (either side), drops a guard or a send-back, or stops
 *                    naming cfbp-test: static.check's W-36 runbook rules must go RED.
 *   kind "followup" — fix/d1-latch-followups (2026-10-14), one per review / security item: N1 (the LATCH REFUSED line), N3 (a printed hint
 *                    unflagged), Q3 (any argv[1] named), F-4 (the overstatements back, latch and runbook), F-2 (a planted key reader), N2
 *                    (GAP-1 continued and GAP-2 space-separated bare commands).
 *   kind "f2gap"   — fix/d1-latch-f2-gaps (2026-10-14), the delta review's four F-2 gaps: (a) a template-literal env-file name, (b) a .js
 *                    key reader, (c) an env-file name after an equals sign (--env-file=.env.local), (d) code that sets the latch flag.
 *   kind "pinned"  — the final round (2026-10-14): both rules became allow-lists of pinned occurrences; H1 an `env` command
 *                    setting the flag, H2 a pinned file gaining an env-file read, H3 a twin aliasing process.env.
 *   kind "comment" — a line opening with a closed block comment is code (review J1, J3), and a .sh line-1 shebang is code (security T2).
 *   kind "tty"     — M-46 (Drew, 2026-10-14): the terminal check removed (K1), and a latched CLI spawned without the terminal (K2).
 *
 *   node tests/kits/w12-latch-mutate.mjs              run every mutant (about a minute: static.check ~2 s and latchtest ~3 s per run)
 *   node tests/kits/w12-latch-mutate.mjs --only L1,L10 only the mutants whose id STARTS WITH one of the comma-separated prefixes
 *   node tests/kits/w12-latch-mutate.mjs --list       print the ids, the suites and the RED each one names
 *   node tests/kits/w12-latch-mutate.mjs --check      check only that every `old` string matches the live tree exactly once (nothing runs)
 *
 * SAFETY, the HARD RULE first: this kit runs ONLY supabase/tests/static.check.mjs (which reads files as text) and latchtest.mjs (which spawns only the latch and
 * scratch copies of it). It never runs, imports or spawns rls.test.mjs, import-backup.mjs, export-sheet.mjs or projectiontest.mjs: a suite on the runner's
 * denylist is refused before anything is copied, and CFBP_LIVE_OK is deleted from every child's environment. Mutating one of the four scripts edits its TEXT
 * in a scratch copy; nothing executes it.
 *
 * And CLAUDE.md's "never use git checkout / restore / stash to undo a mutation": it never writes this checkout. It clones the checkout (the runner's own
 * cloneTree: no .git, no node_modules, no .claude, no .env* — so no credentials are copied) into a temporary directory, applies each mutant to that COPY,
 * restores the file there from the text it read before mutating, and after every mutant re-runs the first suite on the restored copy and requires GREEN (a
 * failed restore looks exactly like a passing run). Each suite is run once on the unmutated copy first: a red baseline aborts.
 * Not registered with the runner (it is the reviewer's tool, like the other kits here).
 *
 * EXIT CODE: 0 only if every `old` string matched exactly once, every mutant was KILLED on the assertion it names, and every restore came back green.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cloneTree } from '../lib/tree.mjs';
import { denied } from '../lib/manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFB = resolve(HERE, '..', '..');
const ROOT = resolve(CFB, '..');
const mutants = JSON.parse(readFileSync(join(HERE, 'w12-latch-mutants.json'), 'utf8'));
const ALLOWED_SUITES = new Set(['supabase/tests/static.check.mjs', 'latchtest.mjs']);
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : null; })();
const selected = mutants.filter((m) => !only || only.some((p) => m.id.startsWith(p)));
const matches = (root, m) => readFileSync(join(root, m.file), 'utf8').split(m.old).length - 1;

// The hard rule, before anything else: only the two suites above, never a denylisted script.
for (const m of mutants) for (const s of [...m.suites, m.red.suite]) {
  if (denied(s) || !ALLOWED_SUITES.has(s)) { console.error(`REFUSED: mutant "${m.id}" names suite "${s}"; this kit runs only ${[...ALLOWED_SUITES].join(' and ')}`); process.exit(2); }
}

if (flag('--list')) {
  for (const m of mutants) console.log(`${m.id}  [${m.kind}]\n    ${m.why}\n    file: ${m.file}\n    suites: ${m.suites.join(', ')}\n    RED: ${m.red.suite}: ${m.red.label}`);
  console.log(`\n${mutants.length} mutants`);
  process.exit(0);
}
if (flag('--check')) {
  let bad = 0;
  for (const m of selected) { const n = matches(ROOT, m); if (n !== 1) { bad++; console.log(`✗ ${m.id}: the old string matches ${n} times in ${m.file}`); } else console.log(`✓ ${m.id}`); }
  console.log(bad ? `\n${bad} mutant(s) no longer apply — the kit has rotted` : `\nall ${selected.length} mutants apply to the live tree exactly once`);
  process.exit(bad ? 1 : 0);
}

const tmp = mkdtempSync(join(tmpdir(), 'w12kit-'));
const W = join(tmp, 'repo');
cloneTree(ROOT, W);
const WC = join(W, 'cfb-pickems');
const cleanup = () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

const childEnv = () => { const e = { ...process.env }; delete e.CFBP_LIVE_OK; return e; };
/** Runs one suite in the copy. `fails` are its failing assertions' texts (never the summary line). */
function run(suite) {
  const r = spawnSync(process.execPath, [suite], { cwd: WC, env: childEnv(), encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n');
  const fails = lines.map((l) => l.match(/^\s*❌\s+(.*\S)\s*$/)).filter(Boolean).map((x) => x[1]).filter((t) => !/^FAILURES\b/.test(t) && !/\d+ passed, \d+ failed/.test(t));
  return { suite, code: r.status, fails };
}

console.log(`\nW-12 live-latch + W-36 runbook mutation kit — ${selected.length} of ${mutants.length} mutants — scratch ${tmp}\n`);
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
