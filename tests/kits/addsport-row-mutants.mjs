#!/usr/bin/env node
/**
 * tests/kits/addsport-row-mutants.mjs - THE MUTATION KIT FOR THE ADD-A-SPORT ROW BUGFIX (platform_kv re-read after the identity chokepoint) (S-3): re-runnable, committed.
 * =========================================================================================================================================================================
 * A copy of tests/kits/d1-scan-mutants.mjs's runner (unchanged), over its own table `tests/kits/addsport-row-mutants.json`. Each mutant is ONE exact-text replacement in ONE
 * shipped file, or one `--mutate=<name>` of a PGlite rehearsal (`pgliteSuite` names which), with the suites that must go RED and the red counts observed when the kit was written.
 *
 *   node tests/kits/addsport-row-mutants.mjs                 run everything (a few minutes)
 *   node tests/kits/addsport-row-mutants.mjs --list          print the table
 *   node tests/kits/addsport-row-mutants.mjs --only S,C      only mutants whose id starts with one of the prefixes
 *   node tests/kits/addsport-row-mutants.mjs --group blind   only one group
 *   PGLITE_DIR=<dir with node_modules/@electric-sql/pglite> ...   also run the PGlite mutants (without it they print SKIP: not failures, and they prove nothing)
 *
 * The PGlite mutants are the `-noproof` variants: the migration's own end-state proof is removed too, so the suite's BEHAVIOUR assertions (written attacker-first, P-1) must catch each alone.
 *
 * THE SAFETY RULES (CLAUDE.md "never git checkout/restore/stash to undo a mutation"): the kit REFUSES TO RUN if any file it would mutate has uncommitted changes (commit first, so a failed
 * restore cannot lose work); it holds the original bytes in memory, restores in a `finally` AND on SIGINT/SIGTERM, and after every mutant asserts the file is byte-identical to the original.
 * It is NOT registered with the test runner on purpose: it writes into the checkout (the runner's TRIPWIRE would fail it) and takes minutes.
 *
 * EXIT CODE: 0 when every killable mutant is RED in at least one of its suites and every mutant marked `equivalent` survived (with its reason printed); 1 otherwise. A drift in the
 * recorded red COUNT is printed as INFO (counts change when assertions are added), never as a failure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');                       // cfb-pickems/
const TABLE = JSON.parse(readFileSync(join(HERE, 'addsport-row-mutants.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = (val('--only') || '').split(',').filter(Boolean);
const group = val('--group');

const selected = TABLE.mutants.filter((m) => (!only.length || only.some((p) => m.id.startsWith(p))) && (!group || m.group === group));
if (flag('--list')) {
  for (const m of selected) console.log(`${m.id.padEnd(5)} ${m.group.padEnd(10)} ${(m.pglite ? 'pglite:' + m.pglite : m.file).padEnd(62)} ${m.equivalent ? '[EQUIVALENT] ' : ''}${m.what}`);
  console.log(`\n${selected.length} mutants`);
  process.exit(0);
}

const gitDirty = (rel) => spawnSync('git', ['diff', '--quiet', '--', rel], { cwd: ROOT }).status !== 0 || spawnSync('git', ['diff', '--cached', '--quiet', '--', rel], { cwd: ROOT }).status !== 0;
const files = [...new Set(selected.filter((m) => m.file).map((m) => m.file))];
const dirty = files.filter(gitDirty);
if (dirty.length) { console.error('REFUSING TO RUN: these files have uncommitted changes (commit first, so a failed restore cannot lose work):\n  ' + dirty.join('\n  ')); process.exit(2); }

const originals = new Map();
const restoreAll = () => { for (const [rel, bytes] of originals) { try { writeFileSync(join(ROOT, rel), bytes); } catch { /* reported by the identity check */ } } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130); });

const countRed = (r) => {
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const reds = out.split('\n').filter((l) => { const t = l.trim(); return (t.startsWith('❌') && !/FAILURES/.test(t)) || /^FAIL\b/.test(t); }).length;
  return reds || (r.status !== 0 ? 1 : 0);                 // a crash or a non-zero exit with no named assertion still counts as red
};
const runSuite = (rel, extra = [], env = {}) => spawnSync('node', [rel, ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 420000, env: { ...process.env, ...env } });

let bad = 0, ran = 0, skipped = 0;
const rows = [];
for (const m of selected) {
  if (m.pglite) {
    if (!process.env.PGLITE_DIR) { skipped++; rows.push([m.id, 'SKIP (no PGLITE_DIR)', m.what]); continue; }
    const r = runSuite(m.pgliteSuite, [`--mutate=${m.pglite}`]);
    const red = countRed(r); ran++;
    rows.push([m.id, `red=${red} (recorded ${m.red})`, m.what]);
    if (red === 0) bad++;
    continue;
  }
  const abs = join(ROOT, m.file);
  const orig = readFileSync(abs, 'utf8');
  originals.set(m.file, orig);
  const hits = orig.split(m.old).length - 1;
  if (hits !== 1) { console.error(`MUTANT ${m.id}: the target text occurs ${hits} times in ${m.file} (must be exactly 1) - the table is stale`); bad++; rows.push([m.id, 'STALE TARGET', m.what]); originals.delete(m.file); continue; }
  const perSuite = {};
  try {
    writeFileSync(abs, orig.replace(m.old, () => m.new));
    for (const s of m.suites) perSuite[s.split('/').pop()] = countRed(runSuite(s));
  } finally {
    writeFileSync(abs, orig);
    if (readFileSync(abs, 'utf8') !== orig) { console.error(`RESTORE FAILED for ${m.file} - the file is NOT byte-identical to its original`); process.exit(3); }
    originals.delete(m.file);
  }
  ran++;
  const total = Object.values(perSuite).reduce((a, b) => a + b, 0);
  const shown = Object.entries(perSuite).map(([k, v]) => `${k}:${v}`).join(' ');
  if (m.equivalent) {
    const ok = total === 0;
    rows.push([m.id, ok ? `SURVIVED as recorded (equivalent: ${m.equivalent})` : `NOW KILLED ${shown} - the "equivalent" note is stale`, m.what]);
    if (!ok) bad++;
  } else {
    rows.push([m.id, `${total === 0 ? 'SURVIVED !!' : 'RED'} ${shown}${m.red ? ` (recorded ${m.red})` : ''}`, m.what]);
    if (total === 0) bad++;
  }
}
console.log(`\n${'id'.padEnd(5)} ${'result'.padEnd(78)} mutant`);
for (const [id, res, what] of rows) console.log(`${id.padEnd(5)} ${res.padEnd(78)} ${what}`);
console.log(`\n${ran} run, ${skipped} skipped, ${bad} problem(s). Tree identical to its committed state: ${spawnSync('git', ['diff', '--quiet'], { cwd: ROOT }).status === 0 ? 'yes' : 'NO (check git status)'}`);
process.exit(bad ? 1 : 0);
