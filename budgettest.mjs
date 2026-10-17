/**
 * budgettest.mjs — D1 Lane C §3.A, DI-636 (UN-477 / UN-482, Drew D-32): THE $25 IS SPLIT PER JOB CLASS, AND A JOB GOES QUIET AT ITS CAP.
 * ============================================================================================================================================
 * The helpers in `supabase/functions/_shared/scribe-rate.js`, driven against a small fake of the Supabase client (the stub answers exactly the calls these helpers make and records them):
 *   - the class counter's key and the cap pre-check (`classBudgetExceeded`): at the cap, past it, under it, a cap of 0, an unreadable counter FAILS CLOSED, a bad cap input fails closed;
 *   - `meterAnthropicAttempt` with a class draws down TWO counters (the league's monthly meter and the class counter), without a class one, and with an unknown class one; a call with
 *     no usage meters the CONSERVATIVE estimate into both; a failed bump never throws;
 *   - the 80% warning (`classNearCap`);
 *   - the platform ledger for the Home-card class: `reservePlatformSpend` (ok / refused at the cap / FAILS CLOSED on an error or a malformed answer), `settlePlatformSpend`
 *     (the delta is actual minus reserved; a zero delta calls nothing; a failure never throws), the key `feed:<YYYY-MM>`;
 *   - the quiet behaviour in each of the five model-calling handlers is asserted in their twins (scribeAsk, scribeAutonomous, scribeClassify, scribeLearn, trainer: `classCapped`);
 *   - the RETRY LIMITS of DI-636 (`_shared/synthesis-limits.mjs`): the constants, the gate (hash limit, backoff, three failures a day, a success resets, a malformed clock fails closed) and
 *     the run plan (at most 25 subjects, batches of at most 4).
 * Run: node budgettest.mjs
 */
import {
  classRateKey, classBudgetExceeded, classNearCap, meterAnthropicAttempt, reservePlatformSpend, settlePlatformSpend, feedSpendKey, scribeMonthKey,
  scribeWorstCaseUsd, SCRIBE_MIN_RESERVE_USD,
} from './supabase/functions/_shared/scribe-rate.js';
import { SCRIBE_MODEL_CATALOG, SCRIBE_MODEL_CLASSES } from './js/data-model.js';
import {
  SYNTH_MAX_PER_HASH, SYNTH_HASH_WINDOW_MS, SYNTH_BACKOFF_MS, SYNTH_MAX_FAILURES_PER_DAY, SYNTH_MAX_SUBJECTS_PER_RUN, SYNTH_MAX_IN_FLIGHT, SYNTH_GATE_REASONS,
  synthesisGate, planSynthesisRun, utcDayStart,
} from './supabase/functions/_shared/synthesis-limits.mjs';

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, detail); }
}
const js = (x) => JSON.stringify(x);
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);   // 2026-10-08 UTC
const MONTH = '2026-10';

/** A fake client: `rows` is { rate_key: { count, spend_usd } }; every call lands in `log`; errors can be forced per kind. */
function fakeSb({ rows = {}, readError = null, bumpError = false, rpcAnswers = {} } = {}) {
  const log = [];
  const sb = {
    log,
    from(table) {
      const filters = [];
      const b = {
        select() { return b; },
        eq(c, v) { filters.push([c, v]); return b; },
        maybeSingle() {
          log.push({ kind: 'select', table, filters: filters.map((f) => [...f]) });
          if (readError) return Promise.resolve({ data: null, error: readError });
          const key = (filters.find((f) => f[0] === 'rate_key') || [])[1];
          return Promise.resolve({ data: Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null, error: null });
        },
      };
      return b;
    },
    rpc(name, args) {
      log.push({ kind: 'rpc', name, args });
      if (rpcAnswers[name] !== undefined) return Promise.resolve(typeof rpcAnswers[name] === 'function' ? rpcAnswers[name](args) : rpcAnswers[name]);
      if (name === 'scribe_rate_bump') return Promise.resolve(bumpError ? { data: null, error: { code: 'X' } } : { data: [{ count: 0, spend_usd: Number(args.p_spend_delta) }], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return sb;
}
const bumps = (sb) => sb.log.filter((e) => e.kind === 'rpc' && e.name === 'scribe_rate_bump');

console.log('\n[1] the class counter key…');
assert(classRateKey('chat', NOW) === `class:chat:${MONTH}` && classRateKey('feed', NOW) === `class:feed:${MONTH}`, '1-1: class:<class>:<YYYY-MM> in the existing scribe_rate table (no new table)');
assert(scribeMonthKey(NOW) === MONTH && feedSpendKey(NOW) === `feed:${MONTH}`, '1-2: the month is UTC, and the platform ledger key is feed:<YYYY-MM>');
assert(classRateKey('chat', Date.UTC(2026, 11, 31, 23, 59, 59)) === 'class:chat:2026-12' && classRateKey('chat', Date.UTC(2027, 0, 1, 0, 0, 0)) === 'class:chat:2027-01', '1-3: the key rolls at the UTC month boundary');

console.log('\n[2] classBudgetExceeded — quiet at the cap, FAIL CLOSED on a read error…');
{
  const key = classRateKey('chat');
  assert(await classBudgetExceeded(fakeSb({ rows: { [key]: { count: 0, spend_usd: 10.99 } } }), 'L1', 'chat', 11) === false, '2-1: $10.99 of an $11 share is under the cap: not quiet yet');
  assert(await classBudgetExceeded(fakeSb({ rows: { [key]: { count: 0, spend_usd: 11 } } }), 'L1', 'chat', 11) === true, '2-2: exactly at the share is quiet (>=)');
  assert(await classBudgetExceeded(fakeSb({ rows: { [key]: { count: 0, spend_usd: 40 } } }), 'L1', 'chat', 11) === true, '2-3: past the share is quiet');
  assert(await classBudgetExceeded(fakeSb({ rows: {} }), 'L1', 'chat', 11) === false, '2-4: no counter row yet (a fresh month) is $0 spent');
  assert(await classBudgetExceeded(fakeSb({ rows: {} }), 'L1', 'chat', 0) === true, '2-5: a share of 0 turns the class off - quiet at once');
  assert(await classBudgetExceeded(fakeSb({ readError: { code: '42P01' } }), 'L1', 'chat', 11) === true, '2-6: an unreadable counter FAILS CLOSED (a query that errors is not "$0 spent")');
  for (const bad of [NaN, undefined, null, 'x']) {
    assert(await classBudgetExceeded(fakeSb({ rows: {} }), 'L1', 'chat', bad) === true, `2-7 (${String(bad)}): a cap that is not a usable number is QUIET (fails closed)`);
  }
  assert(await classBudgetExceeded(fakeSb({ rows: {} }), 'L1', 'not-a-class', 0) === false, '2-8: an unknown class has no counter and is never "exceeded" here (the closed set is enforced by the caller\'s literal)');
  const sb = fakeSb({ rows: { [key]: { count: 0, spend_usd: 1 } } });
  await classBudgetExceeded(sb, 'LEAGUE-A', 'chat', 11);
  const sel = sb.log.find((e) => e.kind === 'select');
  assert(sel.table === 'scribe_rate' && sel.filters.some((f) => f[0] === 'league_id' && f[1] === 'LEAGUE-A') && sel.filters.some((f) => f[0] === 'rate_key' && f[1] === key),
    `2-9: the read is scoped to THIS league and THIS class counter (got ${js(sel)})`);
  for (const cls of SCRIBE_MODEL_CLASSES) {
    const k = classRateKey(cls);
    assert(await classBudgetExceeded(fakeSb({ rows: { [k]: { count: 0, spend_usd: 99 } } }), 'L1', cls, 5) === true, `2-10 (${cls}): every one of the seven classes has its own counter`);
  }
  assert(await classBudgetExceeded(fakeSb({ rows: { [classRateKey('feed')]: { count: 0, spend_usd: 99 } } }), 'L1', 'chat', 11) === false, '2-11: one class at its cap does not silence another');
}

console.log('\n[3] meterAnthropicAttempt — two counters when the call names its class…');
{
  const usage = { input_tokens: 1000, output_tokens: 500 };
  const model = SCRIBE_MODEL_CATALOG.sonnet.id;
  const expected = (1000 / 1e6) * 2 + (500 / 1e6) * 10;
  const sb = fakeSb();
  const r = await meterAnthropicAttempt(sb, 'L1', { model, usage, cls: 'chat' });
  const b = bumps(sb);
  assert(r.costUsd === Math.round(expected * 1e6) / 1e6 && r.estimated === false, `3-1: the cost is the API's own usage through the catalog's prices (got ${js(r)})`);
  assert(b.length === 2 && b[0].args.p_key === `budget:${scribeMonthKey()}` && b[1].args.p_key === `class:chat:${scribeMonthKey()}` && b[0].args.p_spend_delta === r.costUsd && b[1].args.p_spend_delta === r.costUsd,
    `3-2: it draws down the league's monthly meter AND its class counter by the SAME amount (got ${js(b.map((x) => x.args))})`);
  const none = fakeSb();
  await meterAnthropicAttempt(none, 'L1', { model, usage });
  assert(bumps(none).length === 1 && bumps(none)[0].args.p_key.startsWith('budget:'), '3-3: a call that names no class moves only the monthly meter (every legacy caller is unchanged)');
  const unk = fakeSb();
  await meterAnthropicAttempt(unk, 'L1', { model, usage, cls: 'bogus' });
  assert(bumps(unk).length === 1, '3-4: an unknown class moves only the monthly meter (no counter is invented)');
  const est = fakeSb();
  const e = await meterAnthropicAttempt(est, 'L1', { model, usage: {}, promptChars: 3500, maxTokens: 1000, cls: 'judge' });
  assert(e.estimated === true && e.costUsd > 0 && bumps(est).length === 2 && bumps(est)[1].args.p_key === `class:judge:${scribeMonthKey()}`,
    `3-5: no usage back (a timeout): the CONSERVATIVE estimate is metered into both counters - S-F3, a failure loop is where an unmetered class matters most (got ${js(e)})`);
  const failing = fakeSb({ bumpError: true });
  let threw = false;
  try { await meterAnthropicAttempt(failing, 'L1', { model, usage, cls: 'chat' }); } catch { threw = true; }
  assert(!threw, '3-6: a bump that fails never throws - a metering failure must not turn a completed job into an error');
  const free = fakeSb();
  await meterAnthropicAttempt(free, 'L1', { model, usage: { input_tokens: 0, output_tokens: 0 }, promptChars: 0, maxTokens: 0, cls: 'chat' });
  assert(bumps(free).length === 0, '3-7: a call that cost nothing bumps nothing');
  const retr = fakeSb();
  const rr = await meterAnthropicAttempt(retr, 'L1', { model: SCRIBE_MODEL_CATALOG.haiku.id, usage: { input_tokens: 100, output_tokens: 100 }, searchCount: 2, cls: 'retrieval' });
  assert(Math.abs(rr.costUsd - (100 / 1e6 * SCRIBE_MODEL_CATALOG.haiku.input + 100 / 1e6 * SCRIBE_MODEL_CATALOG.haiku.output + 0.02)) < 1e-9, `3-8: searches are metered at the per-search price (2 x $0.01) on top of the tokens (got ${rr.costUsd})`);
}

console.log('\n[4] the 80% warning…');
{
  assert(classNearCap(8.8, 11) === true && classNearCap(8.79, 11) === false && classNearCap(11, 11) === true && classNearCap(0, 0) === false && classNearCap(1, NaN) === false && classNearCap('x', 5) === false,
    '4-1: warns at 80% of a share (8.80 of 11), not before; a zero or unknown cap never warns');
}

console.log('\n[5] the platform ledger for the Home-card class…');
{
  const ok = fakeSb({ rpcAnswers: { platform_spend_try_reserve: { data: { ok: true, spent: 1.2 }, error: null } } });
  const r = await reservePlatformSpend(ok, { key: feedSpendKey(NOW), amountUsd: 0.2, capUsd: 5 });
  const call = ok.log.find((e) => e.kind === 'rpc');
  assert(r.ok === true && r.errored === false && call.name === 'platform_spend_try_reserve' && js(call.args) === js({ p_key: feedSpendKey(NOW), p_amount: 0.2, p_cap: 5 }),
    `5-1: a reservation is ONE atomic rpc with the key, the amount and the cap (got ${js(call)})`);
  const refused = fakeSb({ rpcAnswers: { platform_spend_try_reserve: { data: { ok: false, reason: 'cap' }, error: null } } });
  const rr = await reservePlatformSpend(refused, { key: feedSpendKey(), amountUsd: 0.2, capUsd: 5 });
  assert(rr.ok === false && rr.errored === false, '5-2: refused at the cap: ok:false, NOT an error (the class goes quiet)');
  const arr = fakeSb({ rpcAnswers: { platform_spend_try_reserve: { data: [{ ok: true }], error: null } } });
  assert((await reservePlatformSpend(arr, { key: feedSpendKey(), amountUsd: 1, capUsd: 5 })).ok === true, '5-3: an array answer (PostgREST scalar-set shape) is read');
  for (const [label, answer] of [['an error', { data: null, error: { code: '42501' } }], ['no answer', { data: null, error: null }], ['a malformed answer', { data: { ok: 'yes' }, error: null }], ['a string', { data: 'ok', error: null }]]) {
    const e = await reservePlatformSpend(fakeSb({ rpcAnswers: { platform_spend_try_reserve: answer } }), { key: feedSpendKey(), amountUsd: 1, capUsd: 5 });
    assert(e.ok === false && e.errored === true, `5-4 (${label}): FAILS CLOSED - the feed class is optional, and a ledger that cannot answer must not read as permission`);
  }
  const thrown = fakeSb({ rpcAnswers: { platform_spend_try_reserve: () => { throw new Error('boom'); } } });
  const tr = await reservePlatformSpend(thrown, { key: feedSpendKey(), amountUsd: 1, capUsd: 5 });
  assert(tr.ok === false && tr.errored === true, '5-5: a thrown rpc is contained and fails closed');
  const s1 = fakeSb();
  await settlePlatformSpend(s1, { key: feedSpendKey(NOW), reservedUsd: 0.5, actualUsd: 0.2 });
  const sc = s1.log.find((e) => e.kind === 'rpc');
  assert(sc && sc.name === 'platform_spend_settle' && sc.args.p_delta === -0.3 && sc.args.p_key === feedSpendKey(NOW), `5-6: settle adds ACTUAL minus RESERVED (-0.30) so the booked amount becomes the real cost (got ${js(sc)})`);
  const s2 = fakeSb();
  await settlePlatformSpend(s2, { key: feedSpendKey(), reservedUsd: 0.25, actualUsd: 0.25 });
  assert(s2.log.length === 0, '5-7: nothing to settle (a zero delta) calls nothing');
  const s3 = fakeSb({ rpcAnswers: { platform_spend_settle: () => { throw new Error('x'); } } });
  let threw = false; let res;
  try { res = await settlePlatformSpend(s3, { key: feedSpendKey(), reservedUsd: 1, actualUsd: 0 }); } catch { threw = true; }
  assert(!threw && res && res.ok === false, '5-8: a settle that fails never throws (the reservation stays booked: it errs toward quiet, never toward unmetered spend)');
  const s4 = fakeSb({ rpcAnswers: { platform_spend_settle: { data: null, error: { code: 'X' } } } });
  assert((await settlePlatformSpend(s4, { key: feedSpendKey(), reservedUsd: 1, actualUsd: 0 })).ok === false, '5-9: an error answer is reported ok:false');
  const s5 = fakeSb();
  await settlePlatformSpend(s5, { key: feedSpendKey(), reservedUsd: NaN, actualUsd: 1 });
  assert(s5.log.length === 0, '5-10: a NaN amount calls nothing');
}

console.log('\n[6] worst-case reservations are never zero and follow the routed model…');
{
  assert(scribeWorstCaseUsd({ model: SCRIBE_MODEL_CATALOG.sonnet.id, maxTokens: 0 }) === SCRIBE_MIN_RESERVE_USD, '6-1: a reservation is never zero (the RPC refuses a free pass)');
  const h = scribeWorstCaseUsd({ model: SCRIBE_MODEL_CATALOG.haiku.id, maxTokens: 1000, promptChars: 7000 });
  const s = scribeWorstCaseUsd({ model: SCRIBE_MODEL_CATALOG.sonnet.id, maxTokens: 1000, promptChars: 7000 });
  const o = scribeWorstCaseUsd({ model: SCRIBE_MODEL_CATALOG.opus.id, maxTokens: 1000, promptChars: 7000 });
  assert(h < s && s < o && Math.abs(o / s - 2) < 0.01 && s / h > 15, `6-2: the reservation follows the ROUTED model's price (haiku ${h} < sonnet ${s} < opus ${o}; opus twice sonnet, and Haiku 5.5 at $0.10 / $0.50 a small fraction of sonnet's $2 / $10)`);
  assert(scribeWorstCaseUsd({ model: 'claude-opus-5', maxTokens: 1000 }) === scribeWorstCaseUsd({ model: SCRIBE_MODEL_CATALOG.opus.id, maxTokens: 1000 }), '6-3: a stored legacy id reserves at the price of the tier that replaced it');
}

console.log('\n[7] THE RETRY LIMITS (DI-636): 2 per hash per 6 h, backoff 15 min / 1 h / 6 h, 3 failures a day, 25 subjects a run, 4 in flight…');
{
  const MIN = 60 * 1000, HR = 60 * MIN;
  const T = Date.UTC(2026, 9, 8, 12, 0, 0);          // noon UTC, so "today" began 12 hours earlier
  const at = (minAgo) => T - minAgo * MIN;
  const att = (minAgo, ok, hash = 'h1') => ({ at: at(minAgo), hash, ok });
  const gate = (attempts, hash = 'h1', now = T) => synthesisGate({ attempts, hash, now });

  assert(SYNTH_MAX_PER_HASH === 2 && SYNTH_HASH_WINDOW_MS === 6 * HR && js(SYNTH_BACKOFF_MS) === js([15 * MIN, HR, 6 * HR]) && SYNTH_MAX_FAILURES_PER_DAY === 3 && SYNTH_MAX_SUBJECTS_PER_RUN === 25 && SYNTH_MAX_IN_FLIGHT === 4
    && Object.isFrozen(SYNTH_BACKOFF_MS) && Object.isFrozen(SYNTH_GATE_REASONS) && js(SYNTH_GATE_REASONS) === js(['ok', 'day_failures', 'backoff', 'hash_limit', 'bad_input']),
    '7-1: the constants are DI-636\'s own numbers (2 per hash per 6 h; 15 min, 1 h, 6 h; 3 failures a day; 25 subjects; 4 in flight), frozen, and the reasons are a closed set');
  assert(js(gate([])) === js({ allowed: true, reason: 'ok', retryAt: null }) && gate(undefined).allowed === true && gate(null).allowed === true, '7-2: a subject never synthesized is allowed (and a missing attempt list reads as none)');

  // the hash limit
  const two = [att(120, true), att(60, true)];
  const hl = gate(two);
  assert(hl.allowed === false && hl.reason === 'hash_limit' && hl.retryAt === at(120) + 6 * HR, `7-3: two attempts on the same hash inside 6 hours block a third; it may retry when the OLDER one ages out (got ${js(hl)})`);
  assert(gate(two, 'h2').allowed === true, '7-4: ...but a CHANGED evidence hash is a new subject state and is allowed');
  assert(gate([att(120, true), att(7 * 60, true)]).allowed === true, '7-5: an attempt older than 6 hours no longer counts (one in the window is under the limit of two)');
  assert(gate([att(361, true), att(362, true)]).allowed === true && gate([att(359, true), att(358, true)]).allowed === false, '7-6: the window edge: 361 minutes ago is out, 359 is in');
  const mixed = gate([att(200, true), att(100, true), att(50, true)]);
  assert(mixed.reason === 'hash_limit' && mixed.retryAt === at(100) + 6 * HR, `7-7: three in the window: the gate opens when the count drops BELOW two, i.e. when the second-newest ages out (got ${js(mixed)})`);

  // backoff
  const b1 = gate([att(10, false, 'hx')], 'h1');
  assert(b1.allowed === false && b1.reason === 'backoff' && b1.retryAt === at(10) + 15 * MIN, `7-8: one failure 10 minutes ago => wait until 15 minutes after it (got ${js(b1)})`);
  assert(gate([att(16, false, 'hx')], 'h1').allowed === true, '7-9: ...and 16 minutes after it the gate is open');
  const b2 = gate([att(200, false, 'a'), att(40, false, 'b')], 'h1');
  assert(b2.reason === 'backoff' && b2.retryAt === at(40) + HR, `7-10: two consecutive failures => 1 hour after the last (got ${js(b2)})`);
  assert(gate([att(200, false, 'a'), att(70, false, 'b')], 'h1').allowed === true, '7-11: ...and 70 minutes after the second failure it is open');
  const b3 = gate([att(840, false, 'a'), att(820, false, 'b'), att(300, false, 'c')], 'h1', T);
  assert(b3.reason === 'backoff' && b3.retryAt === at(300) + 6 * HR, `7-12: three consecutive failures (two of them yesterday, so the day rule is not what fires) => 6 hours after the last (got ${js(b3)})`);
  assert(gate([att(500, false, 'a'), att(400, false, 'b'), att(10, true, 'c')], 'h1').allowed === true, '7-13: a SUCCESS resets the run of failures: fail, fail, succeed => no backoff');
  assert(gate([att(300, true, 'a'), att(10, false, 'b')], 'h1').reason === 'backoff' && gate([att(300, true, 'a'), att(20, false, 'b')], 'h1').allowed === true, '7-14: a failure after a success starts a new run (one failure => the 15 minute wait, and 20 minutes after it the gate is open)');

  // three failures in a UTC day
  const day = gate([att(600, false, 'a'), att(500, false, 'b'), att(400, false, 'c')], 'h1');
  assert(day.allowed === false && day.reason === 'day_failures' && day.retryAt === utcDayStart(T) + 24 * HR, `7-15: three failures since 00:00 UTC => skipped until 00:00 UTC tomorrow (got ${js(day)})`);
  assert(gate([att(600, false, 'a'), att(500, false, 'b'), att(400, true, 'c')], 'h1').reason !== 'day_failures', '7-16: two failures and a success today are not three failures');
  const NEXT = Date.UTC(2026, 9, 9, 0, 10, 0);
  const rolled = synthesisGate({ attempts: [{ at: Date.UTC(2026, 9, 8, 23, 0, 0), hash: 'a', ok: false }, { at: Date.UTC(2026, 9, 8, 23, 20, 0), hash: 'b', ok: false }, { at: Date.UTC(2026, 9, 8, 23, 40, 0), hash: 'c', ok: false }], hash: 'h1', now: NEXT });
  assert(rolled.reason === 'backoff' && rolled.retryAt === Date.UTC(2026, 9, 8, 23, 40, 0) + 6 * HR, `7-17: after midnight the day count restarts, but three consecutive failures still owe their 6 hour backoff (got ${js(rolled)})`);
  assert(utcDayStart(T) === Date.UTC(2026, 9, 8, 0, 0, 0) && utcDayStart(Date.UTC(2026, 9, 8, 23, 59, 59)) === Date.UTC(2026, 9, 8, 0, 0, 0), '7-18: the day is the UTC day');

  // robustness
  assert(gate([att(10, true)], 'h1', NaN).reason === 'bad_input' && synthesisGate({ attempts: [], hash: '', now: T }).reason === 'bad_input' && synthesisGate({ attempts: [], now: T }).reason === 'bad_input' && synthesisGate().reason === 'bad_input' && gate([], 'h1', 'noon').allowed === false,
    '7-19: a malformed clock or hash FAILS CLOSED (bad_input): not knowing the time is not permission to spend');
  assert(gate([null, 7, 'x', {}, { at: 'now', hash: 'h1', ok: true }, { at: T + HR, hash: 'h1', ok: false }, { at: T, hash: 'h1' }, att(120, true)]).allowed === true,
    '7-20: malformed entries and attempts dated in the future are ignored (they cannot be counted, so they cannot block), and the gate never throws');
  assert(gate([att(1, false)]).retryAt !== null && [gate(two), gate([att(10, false)]), day].every((g) => !g.allowed && typeof g.retryAt === 'number' && g.retryAt > T), '7-21: every refusal carries a retryAt in the future');

  // the run plan
  const mk = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, hash: `h${i + 1}`, attempts: [], ...over(i) }));
  const plan = planSynthesisRun({ subjects: mk(30, () => ({})), now: T });
  assert(plan.selected.length === 25 && plan.selected[0] === 's1' && plan.selected[24] === 's25' && plan.skipped.length === 5 && plan.skipped.every((x) => x.reason === 'run_limit') && plan.skipped[0].id === 's26',
    `7-22: 30 allowed subjects => the first 25 in the order given, the other 5 skipped as run_limit (got ${js({ n: plan.selected.length, sk: plan.skipped.length })})`);
  assert(plan.batches.length === 7 && plan.batches.slice(0, 6).every((b) => b.length === 4) && plan.batches[6].length === 1 && plan.batches.flat().join() === plan.selected.join(),
    '7-23: ...in batches of at most 4 in flight (6 x 4 + 1), no subject lost or repeated');
  const mixedPlan = planSynthesisRun({ subjects: [
    { id: 'ok1', hash: 'a', attempts: [] },
    { id: 'wait', hash: 'b', attempts: [att(5, false, 'b')] },
    { id: 'capped', hash: 'c', attempts: [att(100, true, 'c'), att(50, true, 'c')] },
    { id: 'dead', hash: 'd', attempts: [att(600, false, 'x'), att(500, false, 'y'), att(400, false, 'z')] },
    { id: 'ok2', hash: 'e', attempts: [att(500, true, 'old')] },
  ], now: T });
  assert(js(mixedPlan.selected) === js(['ok1', 'ok2']) && js(mixedPlan.skipped.map((x) => [x.id, x.reason])) === js([['wait', 'backoff'], ['capped', 'hash_limit'], ['dead', 'day_failures']]) && js(mixedPlan.batches) === js([['ok1', 'ok2']]),
    `7-24: a plan skips each blocked subject with its own closed reason and keeps the order (got ${js(mixedPlan)})`);
  assert(js(planSynthesisRun({ subjects: [], now: T })) === js({ selected: [], batches: [], skipped: [] }) && planSynthesisRun().selected.length === 0 && planSynthesisRun({ subjects: [null, {}, { id: 5 }], now: T }).selected.length === 0
    && planSynthesisRun({ subjects: [{ id: 's', hash: 'h' }], now: NaN }).skipped[0].reason === 'bad_input',
    '7-25: an empty or malformed subject list plans nothing without throwing, and a malformed clock skips everything as bad_input');
}

console.log(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}`);
process.exit(fail === 0 ? 0 : 1);
