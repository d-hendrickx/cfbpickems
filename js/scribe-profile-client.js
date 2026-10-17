/**
 * scribe-profile-client.js — the browser's one call into the `scribe-profile` Edge Function (D1 Lane C, DI-643).
 * ================================================================================================================
 * Thin on purpose. The function decides who may do what (the caller's own JWT, asked of Postgres as the caller); this only sends the request and turns every way it can
 * fail into ONE small result the pane can word: `{ ok: true, data }` or `{ ok: false, error: <code>, status }`.
 *
 * THE LEAGUE ID IS A CLAIM, NOT AN IDENTITY: the active league rides in the body, and the function verifies it against the caller's JWT. Nothing here sends a member id, a role or
 * a permission, and nothing here could be made to — the function reads none of them off the body (functions.check pins that).
 *
 * `supabase-js`'s `functions.invoke()` attaches the signed-in session's access token itself; this module never touches a token. A non-2xx arrives as a `FunctionsHttpError` whose
 * `.context` is the raw Response — the function's own named refusal (`not_commissioner`, `held_for_review`, …) is read off its JSON body the way `scribeAgent.js`'s
 * `extractFunctionErrorMessage` reads the Trainer's, and anything else is `network`.
 */

import { getSupabaseClient, getActiveLeagueId } from './auth.js';
import { SP_COPY } from './scribe-profile-view.js';

/** Every request id is minted ONCE per sheet and reused for a retry, so a double tap or a retry cannot duplicate (the function and `scribe_learning_add_human` key the row by it). */
export function newRequestId() {
  let raw = '';
  try { raw = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') ? globalThis.crypto.randomUUID() : ''; } catch { raw = ''; }
  if (!raw) raw = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `r${String(raw).replace(/[^A-Za-z0-9]/g, '').slice(0, 30)}`.padEnd(8, '0');
}

async function errorCodeOf(error) {
  try {
    if (error && error.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body && typeof body.error === 'string' && body.error) return { code: body.error, status: Number(error.context.status) || 0 };
    }
  } catch { /* an unreadable body is a network-shaped failure */ }
  return { code: 'network', status: 0 };
}

/**
 * @param {string} action one of the function's closed set
 * @param {object} [params] the action's own fields (never an identity)
 * @returns {Promise<{ok:true, data:object} | {ok:false, error:string, status:number, skipped?:string}>}
 */
export async function callScribeProfile(action, params = {}) {
  const client = getSupabaseClient();
  const leagueId = getActiveLeagueId();
  if (!client || !leagueId) return { ok: false, error: 'network', status: 0 };
  let res;
  try {
    res = await client.functions.invoke('scribe-profile', { body: { ...params, action, league_id: leagueId } });
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
  if (res && res.error) {
    const { code, status } = await errorCodeOf(res.error);
    return { ok: false, error: code, status };
  }
  const data = res && res.data;
  if (!data || typeof data !== 'object') return { ok: false, error: 'network', status: 0 };
  if (data.ok === false) return { ok: false, error: String(data.error || 'network'), status: 0 };
  if (data.skipped) return { ok: false, error: `skipped:${data.skipped}`, status: 200, skipped: String(data.skipped) };
  return { ok: true, data };
}

/** The sentence for a failure code, for an inline error in a sheet or a row. `fallback` is the surface's own "Couldn't save …" line. */
export function describeProfileError(code, fallback) {
  const c = String(code || '');
  if (Object.prototype.hasOwnProperty.call(SP_COPY.errors, c)) return SP_COPY.errors[c];
  return fallback;
}
