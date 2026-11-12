/**
 * CFB Pickems - js/pick-events-transport.js (D2 lane 4; DI-961, RPF-D1; the pick-history switch moved to a platform setting, 2026-10-21)
 * ======================================================================================================================================
 * The client's read of a member's OWN pick history, behind the platform setting that turns it on. Two reads, both through the injected Supabase client (like team-facts-transport.js):
 *
 *   1. platform_kv `analytics_pick_events_enabled` (every signed-in account may read platform_kv; the value is a boolean, default off). Anything but exactly `true` = OFF, and then
 *      nothing else is read: no pick_events request leaves the device while the setting is off.
 *   2. ON: this league's `pick_events` rows. The table's RLS (0068 pick_events_select_own) returns ONLY the caller's own rows, so the request names the league and nothing else; the
 *      engine (input.js pickEventsFor) keeps only the viewer's rows of REVEALED weeks, and they reach no surface but the viewer's own (RPF-D1).
 *
 * `fetchPickEvents({ leagueId, identity, now, force })` -> Promise<{ on: boolean, rows: object[] }> (rows in the engine's camelCase shape). Cached per identity and league for 5 minutes; a
 * failure reads as { on: false, rows: [] } (a discretionary surface simply stays dark), never an error. Imports nothing.
 */
export const PICK_EVENTS_TTL_MS = 5 * 60 * 1000;
export const PICK_EVENTS_MAX_ROWS = 2000;
const KV_KEY = 'analytics_pick_events_enabled';
const _deps = { getClient: null };
const _cache = new Map();          // `${identity}|${leagueId}` -> { on, rows, fetchedAt }

export function installPickEventsTransport({ getClient } = {}) { _deps.getClient = typeof getClient === 'function' ? getClient : null; }
export function clearPickEventsCache() { _cache.clear(); }

const OFF = Object.freeze({ on: false, rows: Object.freeze([]) });
const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? null : String(v));

export async function fetchPickEvents({ leagueId = '', identity = '', now = Date.now(), force = false } = {}) {
  if (typeof leagueId !== 'string' || !leagueId) return OFF;
  const key = `${identity}|${leagueId}`;
  const hit = _cache.get(key);
  if (hit && !force && now >= hit.fetchedAt && now - hit.fetchedAt < PICK_EVENTS_TTL_MS) return { on: hit.on, rows: hit.rows };
  const client = _deps.getClient ? (() => { try { return _deps.getClient(); } catch { return null; } })() : null;
  if (!client || typeof client.from !== 'function') return OFF;
  let on = false;
  try {
    const r = await client.from('platform_kv').select('key, value').eq('key', KV_KEY);
    on = !r.error && Array.isArray(r.data) && r.data.some((x) => x && x.key === KV_KEY && x.value === true);
  } catch { on = false; }
  if (!on) { _cache.set(key, { on: false, rows: [], fetchedAt: now }); return OFF; }
  let rows = [];
  try {
    const r = await client.from('pick_events').select('week_id, game_id, member_id, from_team, to_team, actor_member_id, source, at').eq('league_id', leagueId).order('id', { ascending: true }).limit(PICK_EVENTS_MAX_ROWS);
    if (r.error || !Array.isArray(r.data)) return OFF;
    rows = r.data.filter((x) => x && typeof x === 'object').map((x) => ({ weekId: str(x.week_id), gameId: str(x.game_id), memberId: str(x.member_id), fromTeam: str(x.from_team), toTeam: str(x.to_team), actorMemberId: str(x.actor_member_id), source: x.source === 'admin' ? 'admin' : 'self', at: str(x.at) }));
  } catch { return OFF; }
  _cache.set(key, { on: true, rows, fetchedAt: now });
  return { on: true, rows };
}
