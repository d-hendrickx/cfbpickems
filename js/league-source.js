/**
 * CFB Pickems — league-source.js (Deployment 2, thread 101826-D2, lane 3 "Personal Home"; DI-802 / DI-803, UN/PF-508)
 * =====================================================================================================================
 * ONE LEAGUE'S ROWS AS A PLAIN OBJECT. Home is assembled per league: the active league from the storage mirror (exactly as before) and every other league the member
 * belongs to from the read-only Peek store (js/peek-store.js). Both reach the SAME pure modules (js/competition.js, js/home.js's assembleHomeSnapshot, feed-cards,
 * gameday) through one shape, the SOURCE:
 *
 *   { leagueId, competitions(), weeks(), games(), picks(), players(), weeklyResults(), settings(), competitionMembers(), activeWeekId(), viewerMemberId() }
 *
 * `leagueId` is a string; every other field is a function returning that league's rows (an array; `settings()` an object; `activeWeekId()` / `viewerMemberId()` a
 * string or null). Nothing in a source is shared with another league's, and nothing in it is a storage getter: a source built from a peek holds detached copies.
 *
 *   isValidSource(src)                 the shape above (a non-empty leagueId and every reader a function); anything else is NOT a source
 *   makeSource(fields)                 a frozen source over plain arrays (copies, so a caller cannot mutate it after the fact); null when the league id is missing
 *   currentWeekOfRows(weeks, activeId) the pure twin of storage.js getCurrentWeek() (byte-identical there, AD-75): pointer -> first open/locked/live -> highest week number
 *   sourceFromPeek(peek)               the source for one Peek result (`{ leagueId, values, viewerMemberId }`): its projected values and nothing else
 *
 * A PURE LEAF: no import, no storage, no DOM, no clock. js/competition.js imports currentWeekOfRows from here; js/home.js builds the mirror's own source (it already
 * owns the storage readers) and the readers assembleHomeSnapshot takes.
 */

export const SOURCE_READERS = Object.freeze(['competitions', 'weeks', 'games', 'picks', 'players', 'weeklyResults', 'settings', 'competitionMembers', 'activeWeekId', 'viewerMemberId']);

const arr = (v) => (Array.isArray(v) ? v : []);

/** True only for the documented shape: a non-empty string `leagueId` and every reader a function. */
export function isValidSource(src) {
  if (!src || typeof src !== 'object') return false;
  if (typeof src.leagueId !== 'string' || src.leagueId === '') return false;
  return SOURCE_READERS.every((k) => typeof src[k] === 'function');
}

/** The pure twin of storage.js getCurrentWeek(): the pointer's week, else the first open / locked / live week, else the highest week number; null with no weeks. */
export function currentWeekOfRows(weeks, activeId) {
  const list = arr(weeks).filter(Boolean);
  if (activeId) { const f = list.find((w) => w.weekId === activeId); if (f) return f; }
  const active = list.find((w) => ['open', 'locked', 'live'].includes(w.status));
  if (active) return active;
  return [...list].sort((a, b) => b.weekNumber - a.weekNumber)[0] || null;
}

/**
 * A frozen source over plain values. Arrays are COPIED once here (the rows inside are the caller's objects: the Peek store's are its own detached projection);
 * a missing field is an empty list (never a seam read). Null when `leagueId` is not a non-empty string: no league, no source.
 */
export function makeSource({ leagueId, competitions, weeks, games, picks, players, weeklyResults, settings, competitionMembers, activeWeekId = null, viewerMemberId = null } = {}) {
  if (typeof leagueId !== 'string' || leagueId === '') return null;
  const c = arr(competitions).slice(), w = arr(weeks).slice(), g = arr(games).slice(), p = arr(picks).slice(), pl = arr(players).slice();
  const r = arr(weeklyResults).slice(), m = arr(competitionMembers).slice();
  const st = settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...settings } : {};
  const aw = typeof activeWeekId === 'string' && activeWeekId ? activeWeekId : null;
  const vm = typeof viewerMemberId === 'string' && viewerMemberId ? viewerMemberId : null;
  return Object.freeze({
    leagueId,
    competitions: () => c, weeks: () => w, games: () => g, picks: () => p, players: () => pl, weeklyResults: () => r,
    settings: () => st, competitionMembers: () => m, activeWeekId: () => aw, viewerMemberId: () => vm,
  });
}

/**
 * The source for one Peek result. `peek.values` is keyed by the storage key names the projection produced (cfbp_weeks, cfbp_games, …) — the SAME projection the
 * hydrate uses (js/supabase-projection.js fromRows), so a peeked league's rows have the active league's shape exactly. Null for anything that is not a result.
 */
export function sourceFromPeek(peek) {
  if (!peek || typeof peek !== 'object' || typeof peek.leagueId !== 'string' || !peek.leagueId) return null;
  const v = peek.values && typeof peek.values === 'object' ? peek.values : {};
  const aw = v.cfbp_active_week;
  return makeSource({
    leagueId: peek.leagueId,
    competitions: v.cfbp_competitions, weeks: v.cfbp_weeks, games: v.cfbp_games, picks: v.cfbp_picks, players: v.cfbp_players,
    weeklyResults: v.cfbp_results, settings: v.cfbp_settings, competitionMembers: v.cfbp_competition_members,
    activeWeekId: typeof aw === 'string' ? aw : null,   // storage.js getActiveWeekId(): the league_kv pointer, a week id string or nothing
    viewerMemberId: peek.viewerMemberId,
  });
}
