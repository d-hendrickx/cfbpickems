#!/usr/bin/env node
/**
 * tests/kits/lane-c-news-kit.mjs — THE MUTATION KIT for D1 Lane C news and content (S-3: the builder's kit is the item's kit; the reviewer runs it and adds only gap
 * mutants). Each mutant is ONE named weakening of the shipped code; the suite that guards it must go RED with it applied. A mutant that leaves its suite green is a
 * SURVIVOR and fails this kit.
 * =================================================================================================================================================
 * Mutants are applied to SCRATCH COPIES or passed as `--mutate=<name>` to a suite that rewrites its own in-memory text (never the files on disk; CLAUDE.md "never use
 * git checkout to undo a mutation" — nothing here needs undoing).
 *
 *   node tests/kits/lane-c-news-kit.mjs                 every group
 *   node tests/kits/lane-c-news-kit.mjs sql             the SQL group only (needs PGlite: PGLITE_DIR=<dir with node_modules/@electric-sql/pglite>)
 *   node tests/kits/lane-c-news-kit.mjs --list          names only
 *   node tests/kits/lane-c-news-kit.mjs spotlighttest.mjs   one suite's mutants only (any argument that ends in .mjs picks suites by file name)
 *
 * GROUPS
 *   sql      supabase/tests/pglite0053.check.mjs --mutate=<name>   (0053 / 0054: RLS, grants, pilot-only, levers, collector RPCs, constraints, the gate, the audit)
 *   content  supabase/tests/pglite0055.check.mjs --mutate=<name>   (0055: feed_items / league_insights RLS, grants, the content RPCs)
 *   client   newsd1test.mjs / contentcardtest.mjs / relevancetest.mjs --mutate=<name>   (newstest.mjs keeps its own in-suite [10] mutation proofs)
 *   server   newsrulestest.mjs / spotlighttest.mjs / supabase/tests/functions/feedBuild.twin.mjs / newsIngest.twin.mjs --mutate=<name>
 *            (feedbuildtest.mjs, once planned in DESIGN_D1_C.md, was never written: feedBuild.twin.mjs is the offline builder test, so its kit entry was removed 2026-10-14)
 *            (spotlighttest.mjs, W-58: the Spotlight standard v2's kicker, returner and punter rules; feedBuild.twin.mjs: the wiring from ESPN's summary to the published card)
 * A group whose suite needs PGlite and cannot find it is reported SKIPPED (never as RED, never as GREEN).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GROUPS = [
  { name: 'sql', suite: 'supabase/tests/pglite0053.check.mjs', pglite: true },
  { name: 'content', suite: 'supabase/tests/pglite0055.check.mjs', pglite: true },
  { name: 'server', suite: 'newsrulestest.mjs', pglite: false },
  { name: 'server', suite: 'spotlighttest.mjs', pglite: false },
  { name: 'server', suite: 'supabase/tests/functions/feedBuild.twin.mjs', pglite: false },
  { name: 'server', suite: 'supabase/tests/functions/newsIngest.twin.mjs', pglite: false },
  { name: 'client', suite: 'newsd1test.mjs', pglite: false },
  { name: 'client', suite: 'contentcardtest.mjs', pglite: false },
  { name: 'client', suite: 'relevancetest.mjs', pglite: false },
];

/** The mutant names a suite declares: the keys of its `export const MUTANTS = {` (or `const KIT_MUTANTS = {`) object, read as TEXT (importing would run the suite). */
function mutantNames(file, prefix = '') {
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const at = src.search(/(export )?const (KIT_)?MUTANTS = \{/);
  if (at < 0) return [];
  const body = src.slice(at, src.indexOf('\n};', at));
  return [...body.matchAll(/^\s{2}'([a-z0-9-]+)':/gm)].map((m) => m[1]).filter((n) => !prefix || n.startsWith(prefix.toLowerCase()) || true);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const wantSuites = args.filter((a) => a.endsWith('.mjs'));                    // a file name picks suites (W-58); any other argument is a group name
const want = args.filter((a) => !a.endsWith('.mjs'));
const listOnly = process.argv.includes('--list');
let red = 0, survivors = [], skipped = 0;
const pgliteFound = (() => {
  for (const dir of [process.env.PGLITE_DIR, join(ROOT, 'supabase', 'tests'), ROOT].filter(Boolean)) {
    if (existsSync(join(dir, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js'))) return true;
  }
  return false;
})();

for (const g of GROUPS) {
  if (want.length && !want.includes(g.name)) continue;
  if (wantSuites.length && !wantSuites.some((w) => g.suite === w || g.suite.endsWith(`/${w}`))) continue;
  const file = join(ROOT, g.suite);
  const names = mutantNames(file, g.prefix);
  if (names === null) { console.log(`- ${g.suite}: not on this tree yet (skipped)`); continue; }
  if (!names.length) { console.log(`- ${g.suite}: declares no mutants`); continue; }
  if (listOnly) { console.log(`${g.suite}: ${names.join(', ')}`); continue; }
  if (g.pglite && !pgliteFound) { console.log(`- ${g.suite}: SKIPPED (${names.length} mutants) — PGlite not installed; set PGLITE_DIR`); skipped += names.length; continue; }
  console.log(`\n${g.suite} (${names.length} mutants)`);
  for (const n of names) {
    const r = spawnSync(process.execPath, [file, `--mutate=${n}`], { cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 600000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const summary = (out.match(/(\d+) passed, (\d+) failed/g) || []).pop() || `exit ${r.status}`;
    const firstFail = (out.split('\n').find((l) => /^\s+(❌|FAIL\b)/.test(l)) || out.split('\n').find((l) => /❌/.test(l)) || '').trim().slice(0, 140);
    // a mutant whose anchor no longer matches the code is BROKEN, not red: the suite threw before it tested anything (a false RED is a survivor in disguise)
    if (/mutation target|mutant anchor|mutant target missing|unknown mutant|unknown mutation|anchor must match/i.test(out)) { survivors.push(`${g.suite}:${n} (BROKEN anchor)`); console.log(`  BROKEN    ${n.padEnd(28)} the anchor does not match the code: fix the kit entry`); continue; }
    // a suite that died before printing its tally did not TEST the mutant (a mutant that does not even run is "stillborn"): a kit defect, never a red
    if (r.status !== 0 && !/(\d+) passed, (\d+) failed/.test(out)) { survivors.push(`${g.suite}:${n} (STILLBORN: the suite crashed)`); console.log(`  STILLBORN ${n.padEnd(28)} the suite crashed before its tally: fix the mutant so it runs`); continue; }
    if (r.status !== 0) { red++; console.log(`  RED       ${n.padEnd(28)} ${summary}  first: ${firstFail}`); }
    else { survivors.push(`${g.suite}:${n}`); console.log(`  SURVIVED  ${n.padEnd(28)} ${summary}`); }
  }
}
if (!listOnly) {
  console.log(`\n${red} red, ${survivors.length} survived, ${skipped} skipped.`);
  if (survivors.length) console.log('Survivors: ' + survivors.join(', '));
  process.exit(survivors.length ? 1 : 0);
}
