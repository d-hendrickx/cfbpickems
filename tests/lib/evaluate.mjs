/**
 * tests/lib/evaluate.mjs — turn one finished child process into the same assertions loadtest.mjs made about it.
 *
 * The legacy block asserted, per spawned suite and in this order:
 *   1. the child exited 0 (a crash, a signal or a TIMEOUT all arrive here as a non-zero/null status);
 *   2. the child printed its own summary line (a summary-less run would make everything below vacuous);
 *   3. any forbidden text is absent (ERR_MODULE_NOT_FOUND, …);
 *   then, only if the summary was found:
 *   4. the verdict group says ALL PASS (split or combined with failed==0, per the original block);
 *   5. the failed count is zero;
 *   6. the passed count is at or above the ratcheted FLOOR;
 *   7. (adaptertest) the skipped count is zero.
 *   (A 'strict-single' block — the fixed-zone re-run shape — asserted 2, 4, 5 and 6 as ONE assertion; it gets one check.)
 * Each is ONE assertion that adds one to `passed` or `failed`, so the new runner's total is directly
 * comparable to the old harness's. The wording is the old wording where it matters; the arithmetic is exact.
 */

import { resolveSummary } from './extract.mjs';

/**
 * @param manifest  a normalised manifest
 * @param result    { status, signal, error, timedOut, stdout, stderr }
 * @returns {{ checks: {ok:boolean,label:string}[], child: {passed:number|null, failed:number|null, skipped:number|null, line:string|null}, out:string }}
 */
export function evaluateSuite(manifest, result) {
  // a fixed-zone variant reads as the legacy block wrote it: `themetest.mjs (TZ=America/Los_Angeles) exits 0`
  const name = [manifest.script, ...(manifest.args || [])].join(' ') + (manifest.env && manifest.env.TZ ? ` (TZ=${manifest.env.TZ})` : '');
  const out = (result.stdout || '') + (result.stderr || '');
  const checks = [];
  const add = (ok, label) => checks.push({ ok: !!ok, label });
  const spec = resolveSummary(manifest.summary);

  let why = '';
  if (result.timedOut) why = ` — TIMED OUT after ${manifest.timeoutMs} ms and killed (a hung child must fail, not hang)`;
  else if (result.error) why = ` — ${result.error.message}`;
  else if (result.signal) why = ` — killed by ${result.signal}`;
  add(result.status === 0 && !result.timedOut && !result.error, `${name} exits 0 (got ${result.status}${why})`);

  const re = new RegExp(spec.regex, spec.flags || '');
  const m = out.match(re);
  const child = { passed: null, failed: null, skipped: null, line: null };
  if (m) {
    child.line = m[0];
    child.passed = Number(m[spec.passed]);
    child.failed = Number(m[spec.failed]);
    if (spec.skipped) child.skipped = Number(m[spec.skipped]);
  }
  if (spec.single) {
    // The legacy block asserted ALL FOUR conditions as ONE assertion (summary printed, verdict, zero failed, floor) — one check here too,
    // never fewer conditions: a missing summary, a ❌ verdict, a failure or a count below the floor each make it fail.
    const v = spec.verdict;
    add(!!m && (!v || m[v.group] === v.equals) && child.failed === 0 && child.passed >= manifest.floor,
      `${name} reports ${v ? v.equals : 'its summary'} with zero failed and at least its floor ${manifest.floor} (got: ${m ? m[0] : 'no summary line'})`);
  } else add(!!m, `${name} printed its own pass/fail summary line (fixture check — a summary-less run would make the assertions below vacuous)`);

  for (const f of manifest.forbid || []) add(!new RegExp(f.regex, f.flags || '').test(out), f.label || `${name} output does not match /${f.regex}/`);
  if (spec.single) return { checks, child, out };

  if (m) {
    if (spec.verdict) {
      const v = spec.verdict;
      if (v.combined) add(m[v.group] === v.equals && child.failed === 0, `${name} reports ${v.equals} with zero failed assertions (got: ${m[0]})`);
      else add(m[v.group] === v.equals, `${name} itself reports ${v.equals} (got: ${m[0]})`);
    }
    if (!(spec.verdict && spec.verdict.combined)) add(child.failed === 0, `${name} reports zero failed assertions (got ${child.failed} failed, ${child.passed} passed)`);
    add(child.passed >= manifest.floor, `${name} actually ran its full set (got ${child.passed}, floor ${manifest.floor}) — raise the floor when the suite grows; the ratchet only tightens`);
    if (spec.skipped) add(child.skipped === 0, `${name} has NO skips (got ${child.skipped}) — a skip nobody is tracking is a hole`);
  }
  return { checks, child, out };
}

/**
 * The core suite (loadtest.mjs) is the one suite whose own counts ARE the contribution: its inline assertions
 * were always counted one by one in the old total. Returns the same shape; `checks` is empty and `counts` carries its tally.
 */
export function evaluateCore(manifest, result) {
  const name = manifest.script;
  const out = (result.stdout || '') + (result.stderr || '');
  const spec = resolveSummary(manifest.summary);
  const m = out.match(new RegExp(spec.regex, spec.flags || ''));
  const checks = [];
  let counts = { passed: 0, failed: 0 };
  const exitOk = result.status === 0 && !result.timedOut && !result.error;
  if (m) {
    counts = { passed: Number(m[spec.passed]), failed: Number(m[spec.failed]) };
    if (!exitOk && counts.failed === 0) checks.push({ ok: false, label: `${name} exited non-zero (${result.status}${result.timedOut ? ', TIMED OUT' : ''}) although its summary says zero failed` });
  } else {
    checks.push({ ok: false, label: `${name} printed no summary line (status ${result.status}${result.timedOut ? ', TIMED OUT' : ''}${result.error ? ' — ' + result.error.message : ''})` });
  }
  if (m && manifest.floor > 0 && counts.passed < manifest.floor) checks.push({ ok: false, label: `${name} ran ${counts.passed} assertions, below its floor ${manifest.floor}` });
  return { checks, counts, child: { passed: m ? counts.passed : null, failed: m ? counts.failed : null, skipped: null, line: m ? m[0] : null }, out };
}
