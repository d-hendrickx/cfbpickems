/**
 * CFB Pickems - js/team-facts-transport.js (D2 lane 4 batch 2; DI-1079; UN/PF-543; 2026-10-21)
 * ===========================================================================================
 * The client's one read of the GLOBAL public team data (migration 0074's team_facts_list): once per sport per day, cached, filtered to the teams a member follows ON THE DEVICE. THE REQUEST NAMES A
 * SPORT AND NOTHING ELSE: never a team, a member or a league (the server never learns who follows what). A discretionary surface never shows an error: a failure returns the last cached copy flagged
 * stale, or nothing; the caller then draws no team card. A response over 250 KB for a sport is refused (a size guard, DI-1079). Like newsTransport, the Supabase client is INJECTED
 * (`installTeamFactsTransport({ getClient })`), so this module imports nothing and is testable with a fake. The cache is keyed by an identity the caller supplies (the signed-in user), because the
 * server's pilot rule answers per user: a different account never reads the previous account's copy.
 */
export const TEAM_FACTS_TTL_MS = 24 * 60 * 60 * 1000;
export const TEAM_FACTS_MAX_BYTES = 250 * 1024;
const SPORTS = ['cfb', 'nfl', 'nhl'];
const _deps = { getClient: null };
const _cache = new Map();          // `${identity}|${sport}` -> { rows, fetchedAt }
const _inFlight = new Map();

export function installTeamFactsTransport({ getClient } = {}) { _deps.getClient = typeof getClient === 'function' ? getClient : null; }
export function clearTeamFactsCache() { _cache.clear(); _inFlight.clear(); }

async function readSport(sport, key) {
  const client = _deps.getClient ? (() => { try { return _deps.getClient(); } catch { return null; } })() : null;
  if (!client || typeof client.rpc !== 'function') return null;
  let res;
  try { res = await client.rpc('team_facts_list', { p_sport: sport }); } catch { return null; }
  if (!res || res.error || !Array.isArray(res.data)) return null;
  let size = 0;
  try { size = JSON.stringify(res.data).length; } catch { return null; }
  if (size > TEAM_FACTS_MAX_BYTES) return null;
  void key;
  return res.data;
}

/**
 * @returns {Promise<{ rows: object[], stale: boolean, failed: string[] }>} rows of the requested sports (the raw team_facts_list rows; the engine's input builder cleans them);
 *   `stale` = at least one sport came from an older cached copy because the read failed; `failed` = sports with neither a fresh nor a cached copy.
 */
export async function fetchTeamFacts({ sports = [], identity = '', force = false, now = Date.now() } = {}) {
  const list = (Array.isArray(sports) ? sports : []).filter((s, i, a) => SPORTS.includes(s) && a.indexOf(s) === i).sort();
  const out = { rows: [], stale: false, failed: [] };
  for (const sport of list) {
    const key = `${identity}|${sport}`;
    const hit = _cache.get(key);
    if (hit && !force && now - hit.fetchedAt < TEAM_FACTS_TTL_MS && now >= hit.fetchedAt) { out.rows.push(...hit.rows); continue; }
    let job = _inFlight.get(key);
    if (!job) { job = readSport(sport, key).finally(() => { if (_inFlight.get(key) === job) _inFlight.delete(key); }); _inFlight.set(key, job); }
    const rows = await job;
    if (rows) { _cache.set(key, { rows, fetchedAt: now }); out.rows.push(...rows); continue; }
    if (hit) { out.rows.push(...hit.rows); out.stale = true; } else out.failed.push(sport);
  }
  return out;
}
