#!/usr/bin/env node
/**
 * tests/parity.mjs — prove the tiered runner and the legacy harness agree, number for number.
 *
 * Run once, at the switchover, on the FINAL tree (docs/TESTING.md → "Landing it"):
 *
 *   node tests/parity.mjs --legacy <log of the OLD `node loadtest.mjs`, stdout+stderr> --summary <summary.json of `testrun.mjs --full`> [--extra testruntest[,id…]] [--suites <dir>]
 *
 * What "parity" means (every line is checked, exit 1 on the first broken one):
 *   1. both runs are green (the legacy log ends `✅ ALL PASS — N passed, 0 failed`; the summary says tier full, failed 0);
 *   2. per suite, the number of assertions the legacy harness printed about it (the `  ✅ <script> …` lines) equals the number the runner made
 *      (`checks`), and the passed count the suite itself reported (`(got N` in the legacy floor line) equals the one the runner parsed;
 *   3. the core's inline assertions in the runner equal what is left of the legacy total after every spawned suite's lines are taken out;
 *   4. the headline: runner total − the extra suites' own assertions (the runner's self-test) == the legacy total.
 * A suite with no legacy lines that is not named in --extra is an error: either it is new (say so) or its legacy name differs (fix the match).
 */

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The one suite whose legacy lines carry a label, not the bare script name (the same script is spawned twice, with different arguments). */
export const LEGACY_NAME = { contrastscan: 'contrastscan.mjs (live)' };

/** The name a suite's legacy lines start with. A fixed-zone variant (`env.TZ`) was written `<script> (TZ=<zone>) …` by its block. */
export function legacyNameOf(m) {
  return LEGACY_NAME[m.id] || [m.script, ...(m.args || [])].join(' ') + (m.env && m.env.TZ ? ` (TZ=${m.env.TZ})` : '');
}
const startsWithName = (l, name) => l.startsWith(`  ✅ ${name} `) || l.startsWith(`  ✅ ${name}'s `);

/** Pure: compare a legacy log's text with a runner summary. Returns { rows, problems, headline }. */
export function compareParity({ legacyText, summary, manifests, extra = [] }) {
  const problems = [];
  const lines = legacyText.split('\n');
  const verdict = [...legacyText.matchAll(/(✅ ALL PASS|❌ FAILURES) — (\d+) passed, (\d+) failed/g)].pop();
  if (!verdict) problems.push('the legacy log has no final "N passed, M failed" line (was it captured with 2>&1, and did the run finish?)');
  const legacyPassed = verdict ? Number(verdict[2]) : null;
  if (verdict && (verdict[1] !== '✅ ALL PASS' || Number(verdict[3]) !== 0)) problems.push(`the legacy run is not green (${verdict[0]}) — parity of a red run proves nothing`);
  if (summary.tier !== 'full' || summary.requested !== 'full') problems.push(`the runner summary is a "${summary.requested}" run (tier ${summary.tier}) — parity needs --full`);
  if (summary.failed !== 0) problems.push(`the runner run is not green (${summary.failed} failed)`);
  if (summary.tz) problems.push(`the runner summary carries a second-zone pass (--tz ${summary.tz}) — parity compares a plain --full in one zone`);
  if (Array.isArray(summary.tripwire) && summary.tripwire.length) problems.push(`the runner's tripwire fired (${summary.tripwire.length} path(s))`);

  const rows = [];
  let spawnedLines = 0;
  // every legacy name, so a line is counted for the LONGEST name it starts with: `themetest.mjs (TZ=…) exits 0` belongs to the
  // fixed-zone variant, never also to `themetest.mjs` (double counting would hide a lost assertion behind an invented one)
  const allNames = [...new Set([...manifests.values()].map(legacyNameOf))];
  let extraChecks = 0;
  let sumChecks = 0;
  for (const r of summary.suites) {
    sumChecks += r.checks || 0;
    if (r.id === 'core' || r.id === 'core-load') continue;
    if (extra.includes(r.id)) { extraChecks += r.checks || 0; continue; }
    const m = manifests.get(r.id);
    if (!m) { problems.push(`${r.id}: in the runner's summary but in no manifest`); continue; }
    const name = legacyNameOf(m);
    const longer = allNames.filter(n => n !== name && n.startsWith(name + ' '));
    const mine = lines.filter(l => startsWithName(l, name) && !longer.some(n => startsWithName(l, n)));
    const gotLine = mine.find(l => /\(got (\d+)/.test(l) && /actually ran|ran its full set|ran a non-trivial/.test(l));
    // the one-assertion ('strict-single') block wrote its count inside the verdict text: `… with the same floor (got: ✅ ALL PASS — 334 passed, 0 failed)`
    const singleLine = gotLine ? null : mine.find(l => /floor/.test(l) && /\(got: (?:✅ ALL PASS|❌ FAILURES) — (\d+) passed/.test(l));
    const oldCount = gotLine ? Number(/\(got (\d+)/.exec(gotLine)[1]) : singleLine ? Number(/\(got: (?:✅ ALL PASS|❌ FAILURES) — (\d+) passed/.exec(singleLine)[1]) : null;
    spawnedLines += mine.length;
    const row = { id: r.id, name, oldChecks: mine.length, newChecks: r.checks, oldCount, newCount: r.child ? r.child.passed : null };
    rows.push(row);
    if (!mine.length) problems.push(`${r.id}: no legacy lines start with "${name}" — a suite registered after the legacy run (pass --extra ${r.id}) or a different legacy name`);
    else if (row.oldChecks !== row.newChecks) problems.push(`${r.id}: the legacy harness made ${row.oldChecks} assertions about it, the runner ${row.newChecks}`);
    else if (row.oldCount !== row.newCount) problems.push(`${r.id}: the suite reported ${row.oldCount} passed to the legacy harness, ${row.newCount} to the runner`);
  }
  for (const id of extra) if (!summary.suites.some(s => s.id === id)) problems.push(`--extra ${id}: no such suite in the runner's summary`);

  const core = summary.suites.find(s => s.id === 'core');
  if (!core || !core.counts) problems.push('the runner summary has no core entry (was it a --full run of the converted harness?)');
  const coreInline = core && core.counts ? core.counts.passed : null;
  if (legacyPassed !== null && coreInline !== null && coreInline !== legacyPassed - spawnedLines) {
    problems.push(`core inline assertions: the runner counted ${coreInline}, the legacy total minus the spawned suites' lines is ${legacyPassed - spawnedLines} (${legacyPassed} − ${spawnedLines})`);
  }
  if (legacyPassed !== null && summary.passed - extraChecks !== legacyPassed) problems.push(`headline: runner ${summary.passed} − extras ${extraChecks} = ${summary.passed - extraChecks}, legacy ${legacyPassed}`);
  return { rows, problems, headline: { legacyPassed, runnerPassed: summary.passed, extraChecks, coreInline, spawnedLines, suites: rows.length, sumChecks } };
}

function main(argv) {
  const argOf = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const legacy = argOf('--legacy');
  const summaryPath = argOf('--summary');
  const suitesDir = path.resolve(argOf('--suites') || path.join(here, 'suites'));
  const extra = (argOf('--extra') ?? 'testruntest').split(',').map(s => s.trim()).filter(Boolean);
  if (!legacy || !summaryPath) { console.error('usage: node tests/parity.mjs --legacy <legacy-full.log> --summary <summary.json> [--extra id,id] [--suites <dir>] [--table]'); process.exit(2); }
  let legacyText, summary;
  const manifests = new Map();
  try {
    legacyText = readFileSync(legacy, 'utf8');
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    for (const f of readdirSync(suitesDir).filter(n => n.endsWith('.json') && !n.startsWith('_'))) { const m = JSON.parse(readFileSync(path.join(suitesDir, f), 'utf8')); manifests.set(m.id, m); }
  } catch (e) { console.error(`parity: ${e.message}`); process.exit(2); }
  const { rows, problems, headline: h } = compareParity({ legacyText, summary, manifests, extra });
  console.log(`suites compared: ${h.suites}   (extras not in the legacy harness: ${extra.join(', ') || 'none'})`);
  console.log(`per-suite assertion count equal: ${rows.filter(r => r.oldChecks === r.newChecks).length}/${rows.length}; per-suite passed count equal: ${rows.filter(r => r.oldCount === r.newCount).length}/${rows.length}`);
  console.log(`legacy total ${h.legacyPassed} = core inline ${h.coreInline} + spawned suites' assertions ${h.spawnedLines}`);
  console.log(`runner total ${h.runnerPassed} = legacy ${h.legacyPassed} + extras ${h.extraChecks}`);
  if (argv.includes('--table') || problems.length) {
    console.log('\nsuite                               old   new  chk chk');
    for (const r of rows) console.log(`${r.id.padEnd(34)} ${String(r.oldCount).padStart(5)} ${String(r.newCount).padStart(5)}  ${String(r.oldChecks).padStart(2)} ${String(r.newChecks).padStart(2)}  ${r.oldCount === r.newCount && r.oldChecks === r.newChecks ? '=' : 'DIFF'}`);
  }
  if (problems.length) {
    console.log(`\n❌ PARITY BROKEN — ${problems.length} problem(s):`);
    for (const p of problems) console.log('  ✗ ' + p);
    process.exit(1);
  }
  console.log(`\n✅ PARITY — the runner's ${h.runnerPassed} equals the legacy harness's ${h.legacyPassed} plus its own ${h.extraChecks}, suite by suite`);
  process.exit(0);
}

// real paths on both sides: a tmp dir under /var is a symlink to /private/var, and a plain string compare would never match there (the tool would silently do nothing)
const isEntry = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isEntry) main(process.argv.slice(2));
