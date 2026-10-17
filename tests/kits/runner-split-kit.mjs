#!/usr/bin/env node
/**
 * tests/kits/runner-split-kit.mjs — the mutation kit for runnerrepotest.mjs (M-49, Drew 2026-10-14: "Yes, approve 47, 48, 49"; S-3).
 *
 * runnerrepotest checks facts of the REAL repo (manifests, suite scripts, deploy.sh, the runner's selection on the real tree), so its
 * mutants cannot live in testruntest's battery, which copies the runner alone. Each mutant here is a scratch COPY of the whole repo
 * (APFS clones: near-instant, no disk) with ONE real-tree fact broken; the named runnerrepotest case must go RED on it and GREEN on an
 * unbroken copy. This checkout is never written (CLAUDE.md: never git checkout/restore/stash to undo a mutation).
 *
 * Run (from cfb-pickems/):   node tests/kits/runner-split-kit.mjs
 * Prints one line per mutant and `✅ ALL PASS — N passed, M failed`; exit 0 only when every mutant is red and the control is green.
 */

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cfb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repo = path.resolve(cfb, '..');
const SKIP = new Set(['.git', 'node_modules', '.claude', '.deploy']);

/** One edit to one file of the copy: `find` must exist (a vacuous mutant proves nothing). `json` edits a manifest as data. */
const MUTANTS = [
  { name: 'testruntest is gated on the manifests again (tests/suites/** back on its deps)', file: 'cfb-pickems/tests/suites/testruntest.json', json: m => { m.deps.push('tests/suites/**'); }, cases: ['repo-selftest-selection'] },
  { name: 'testruntest is tagged quick (it would run on every --quick)', file: 'cfb-pickems/tests/suites/testruntest.json', json: m => { m.tags.push('quick'); }, cases: ['repo-selftest-selection', 'denylist-real-manifests'] },
  { name: 'runnerrepotest is held to its deps (not on the held-suite allow-list)', file: 'cfb-pickems/tests/suites/runnerrepotest.json', json: m => { m.affectedByDepsOnly = true; }, cases: ['denylist-real-manifests', 'repo-selftest-selection'] },
  { name: 'runnerrepotest is tagged slow (the seconds-cheap suite scheduled as a long pole)', file: 'cfb-pickems/tests/suites/runnerrepotest.json', json: m => { m.tags.push('slow'); }, cases: ['repo-selftest-selection'] },
  { name: 'deploy.sh Gate 1 drops the second zone (--tz UTC)', file: 'deploy.sh', find: '$KEEPAWAKE node loadtest.mjs --tz UTC', replace: '$KEEPAWAKE node loadtest.mjs', cases: ['repo-integrity'] },
  { name: 'deploy.sh Gate 1 stops keeping the Mac awake (caffeinate -is)', file: 'deploy.sh', find: 'KEEPAWAKE="caffeinate -is"', replace: 'KEEPAWAKE=""', cases: ['repo-integrity'] },
  { name: 'a suite script gains a Chromium launch flag (the inferred-browser list changes)', file: 'cfb-pickems/hometest.mjs', append: "\nconst __browserFlag = ['--remote-debugging-port=0'];\n", cases: ['repo-integrity'] },
  { name: 'a date-sensitive suite loses its tz tag (it drops out of the second-zone pass)', file: 'cfb-pickems/tests/suites/hometest.json', json: m => { m.tags = m.tags.filter(t => t !== 'tz'); }, cases: ['repo-integrity'] },
  { name: 'a manifest mentions the iOS shell (the boundary test refuses shipped *.json that do)', file: 'cfb-pickems/tests/suites/hometest.json', json: m => { m.note = `${m.note || ''} see munera-ios`; }, cases: ['repo-integrity'] },
  { name: 'a runner-file stop offers testruntest alone (runnerrepotest left out)', file: 'cfb-pickems/testrun.mjs', find: "export const RUNNER_SELFTESTS = ['testruntest', 'runnerrepotest'];", replace: "export const RUNNER_SELFTESTS = ['testruntest'];", cases: ['repo-selftest-selection'] },
];

function copyRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'runner-split-kit-'));
  cpSync(repo, dir, { recursive: true, mode: constants.COPYFILE_FICLONE, filter: src => !SKIP.has(path.basename(src)) });
  return dir;
}

function mutate(dir, mu) {
  const f = path.join(dir, mu.file);
  const before = readFileSync(f, 'utf8');
  let after;
  if (mu.json) { const m = JSON.parse(before); mu.json(m); after = JSON.stringify(m, null, 2) + '\n'; }
  else if (mu.append) after = before + mu.append;
  else after = before.includes(mu.find) ? before.replace(mu.find, mu.replace) : null;
  if (after === null || after === before) return false;
  writeFileSync(f, after);
  return true;
}

const runCase = (dir, name) => new Promise(resolve => {
  const c = spawn(process.execPath, [path.join(dir, 'cfb-pickems', 'runnerrepotest.mjs'), '--case', name], { cwd: path.join(dir, 'cfb-pickems'), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
  const t = setTimeout(() => c.kill('SIGKILL'), 120000);
  c.on('close', code => { clearTimeout(t); resolve({ status: code, out }); });
});

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { if (ok) { pass++; console.log('  ✅', label); } else { fail++; console.log('  ❌', label, detail ? `— ${detail}` : ''); } };

console.log(`runner-split-kit — runnerrepotest's mutants, each on a scratch copy of ${repo}`);
const control = copyRepo();
for (const name of [...new Set(MUTANTS.flatMap(m => m.cases))]) {
  const r = await runCase(control, name);
  check(r.status === 0, `control: case ${name} is GREEN on an unbroken copy`, r.out.split('\n').filter(l => /❌/.test(l)).slice(0, 2).join(' | '));
}
rmSync(control, { recursive: true, force: true });

const POOL = 3;
let next = 0;
const results = new Array(MUTANTS.length);
await Promise.all(Array.from({ length: POOL }, async () => {
  for (;;) {
    const i = next++;
    if (i >= MUTANTS.length) return;
    const mu = MUTANTS[i];
    const dir = copyRepo();
    const ok = mutate(dir, mu);
    const runs = ok ? await Promise.all(mu.cases.map(c => runCase(dir, c))) : [];
    rmSync(dir, { recursive: true, force: true });
    results[i] = { ok, red: runs.filter(r => r.status !== 0).length, runs };
  }
}));
MUTANTS.forEach((mu, i) => {
  const r = results[i];
  check(r.ok, `mutant "${mu.name}": the edit applies to ${mu.file} (a vacuous mutation proves nothing)`);
  if (r.ok) check(r.red === mu.cases.length, `mutant "${mu.name}" turns ${mu.cases.join(' + ')} RED (${r.red}/${mu.cases.length})`, r.runs.map(x => x.out.split('\n').filter(l => /❌/.test(l))[0] || '').join(' | ').slice(0, 300));
});

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;
