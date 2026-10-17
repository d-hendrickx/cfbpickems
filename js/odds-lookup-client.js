/**
 * odds-lookup-client.js - the browser's ONE call into the `odds-lookup` Edge Function. W-71 (Deployment 1, batch D), DI-W71.4.
 * ============================================================================================================================
 * Thin on purpose, and the same shape as js/scribe-profile-client.js: the function decides who may ask (the caller's own JWT, asked of Postgres as the caller) and the browser sends IDS
 * ONLY - the league and the week. It never names a team, a URL, a sport or a vendor parameter, and it never sees the vendor or its key; nothing in the shipped tree knows either exists.
 *
 * Every way it can go wrong becomes ONE small result the screen can word: `{ ok:true, results, unmatched }` or `{ ok:false, reason }` with `reason` from a closed set:
 *   not_configured  no key is set on the server (the function is dormant), the league is paused, or this device has no shared backend (local PIN mode)
 *   paused          the server stopped before the month's allowance ran out
 *   unsupported     this week's sport (or state) cannot be looked up
 *   vendor_error    the other source did not answer sensibly (or this call failed in transit, or the function itself returned a failure)
 *   timeout         the other source took too long
 *   daily_limit     this league has used today's lookups (DI-W71.10, Drew D-80: every league has its own daily limit, default 6 vendor calls a UTC day; migration 0060)
 */
import { getSupabaseClient, getActiveLeagueId } from './auth.js';

const REASONS = ['not_configured', 'paused', 'unsupported', 'vendor_error', 'timeout', 'daily_limit'];

// Test seam (the `_xForTest` convention; no production caller): a browser or node suite answers the lookup itself, so the whole screen can be driven through the real dispatcher without a
// Supabase project. Null (the default) means the real call below.
let _override = null;
export function _setOddsLookupForTest(fn) { _override = typeof fn === 'function' ? fn : null; }

export async function callOddsLookup(weekId) {
  if (_override) return _override(weekId);
  let client = null, leagueId = null;
  try { client = getSupabaseClient(); leagueId = getActiveLeagueId(); } catch { client = null; }
  if (!client || !leagueId || typeof weekId !== 'string' || !weekId) return { ok: false, reason: 'not_configured' };
  let res;
  try {
    res = await client.functions.invoke('odds-lookup', { body: { league_id: leagueId, week_id: weekId } });
  } catch {
    return { ok: false, reason: 'vendor_error' };
  }
  return lookupResultFrom(res);
}

/**
 * What `functions.invoke` handed back -> the one small result the screen words. Pure (exported so oddsfallbacktest drives the REAL mapping with each answer the function can give,
 * `daily_limit` among them): a transport error with no envelope, a non-object, or a reason outside the closed set is `vendor_error`; a skipped run is `not_configured`.
 */
export function lookupResultFrom(res) {
  const data = res && res.data;
  if (res && res.error && !(data && typeof data === 'object')) return { ok: false, reason: 'vendor_error' };
  if (!data || typeof data !== 'object') return { ok: false, reason: 'vendor_error' };
  if (data.skipped) return { ok: false, reason: 'not_configured' };      // a paused league, or no server secret set: nothing to check now
  if (data.ok === true) return { ok: true, results: Array.isArray(data.results) ? data.results : [], unmatched: Number(data.unmatched) || 0 };
  return { ok: false, reason: REASONS.includes(data.reason) ? data.reason : 'vendor_error' };
}
