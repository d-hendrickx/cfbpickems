/**
 * CFB Pickems — game-order.js (Deployment 1, Lane B, DI-579 / PF-445, 2026-10-07)
 * ===============================================================================
 * The order in which a member sees the GAMES of one week: chronological, live first, or their own arrangement. This is NOT the shipped section
 * drag (js/section-drag.js, `getSectionOrder`), which moves whole Dashboard/Standings SECTIONS; this orders the games inside one section.
 *
 *   kickoff     kickoff ascending; a missing or unparseable kickoff sorts LAST; ties break on gameId ascending. Today's sort
 *               (`new Date(a.kickoff) - new Date(b.kickoff)`) returns NaN for a missing kickoff and ties arbitrarily — this is its stable replacement
 *               and equals it for every distinct valid kickoff (gameordertest pins that).
 *   live-first  rank 0 = live / live-stale · rank 1 = upcoming / awaiting / no-score · rank 2 = final (phases are js/game-state.js's). Within a rank,
 *               kickoff order. A game that goes final moves to the end; a game that goes live moves to the front.
 *   manual      the saved ids first, in saved order; games not in the saved list (new to the slate) follow in kickoff order; saved ids that no longer
 *               exist are ignored. Status is IGNORED: a final game stays where the member put it (PF-445 acceptance 2).
 *
 * WHERE IT APPLIES (so a future surface does not guess): the Dashboard compact rows and standard matrix rows, the GameDay list, the Live Peek's
 * selection (DI-582) and the Home breakdown lines (DI-577). IT DOES NOT APPLY TO: the Picks page (UN-72: it stays focused on picking), the chat game
 * filter pills, the CSV export, notification copy, Alma Mater Watch, or SCRIBE's context.
 *
 * THE PREFERENCE. `player.preferences.gameOrder = { mode, manual: { [weekId]: [gameId, …] }, recent: [weekId, …] }`, on the PLAYER RECORD through
 * js/storage.js's `_playerPref` / `_setPlayerPref` pair (the same pair as sectionOrder, theme and accent — never the league-shared `settings` blob, the
 * UN-124 trap). `recent` is the write order of the weeks (oldest first): the column is jsonb, which does NOT preserve object key order, so "the six
 * most recent weeks" cannot be read off `manual`'s keys. Everything crossing the storage boundary goes through `coerceGameOrder` (CONVENTIONS #7):
 * an unknown mode is `kickoff`, a non-array is `[]`, a non-string id is dropped, duplicates collapse, at most 40 ids per week and 6 weeks are kept.
 * Default when missing: `{ mode: 'kickoff', manual: {}, recent: [] }` — every player record in the database is already in that state.
 *
 * Pure: no DOM, no storage, no clock, no imports.
 */

export const GAME_ORDER_MODES = Object.freeze(['kickoff', 'live-first', 'manual']);
export const MAX_MANUAL_IDS = 40;
export const MAX_MANUAL_WEEKS = 6;
export const DEFAULT_GAME_ORDER = Object.freeze({ mode: 'kickoff', manual: Object.freeze({}), recent: Object.freeze([]) });

const kickoffMs = (g) => { const ms = g && g.kickoff ? Date.parse(g.kickoff) : NaN; return Number.isFinite(ms) ? ms : null; };
const idOf = (g) => String(g && g.gameId !== undefined && g.gameId !== null ? g.gameId : '');

/** Kickoff ascending, missing / unparseable LAST, ties on gameId ascending (code-point order: no locale in a sort that must be deterministic). */
export function kickoffCompare(a, b) {
  const ka = kickoffMs(a), kb = kickoffMs(b);
  if (ka !== kb) {
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka - kb;
  }
  const ia = idOf(a), ib = idOf(b);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

export function coerceMode(m) { return GAME_ORDER_MODES.includes(m) ? m : 'kickoff'; }

/** A list of game ids as it is allowed to be stored: strings only, non-empty, no duplicates, at most MAX_MANUAL_IDS. */
export function coerceIds(v) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(v) ? v : []) {
    if (typeof x !== 'string' || x === '' || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= MAX_MANUAL_IDS) break;
  }
  return out;
}

/** Whatever came out of the player record -> a well-formed `{ mode, manual, recent }`, with the six most recently written weeks kept. Never throws. */
export function coerceGameOrder(raw) {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const manualIn = (r.manual && typeof r.manual === 'object' && !Array.isArray(r.manual)) ? r.manual : {};
  const manual = {};
  for (const k of Object.keys(manualIn)) {
    const ids = coerceIds(manualIn[k]);
    if (ids.length) manual[k] = ids;
  }
  const seen = new Set();
  const recent = [];
  for (const w of Array.isArray(r.recent) ? r.recent : []) {            // the recorded write order first (oldest -> newest)…
    if (typeof w === 'string' && Object.prototype.hasOwnProperty.call(manual, w) && !seen.has(w)) { seen.add(w); recent.push(w); }
  }
  for (const w of Object.keys(manual).sort()) if (!seen.has(w)) { seen.add(w); recent.unshift(w); }   // …a week with no record is treated as the OLDEST (deterministic)
  while (recent.length > MAX_MANUAL_WEEKS) { const drop = recent.shift(); delete manual[drop]; }
  return { mode: coerceMode(r.mode), manual, recent };
}

/** The pure write: a new, coerced value with `ids` saved for `weekId` (an empty list clears the week). The caller stores the result. */
export function withManualOrder(raw, weekId, ids) {
  const cur = coerceGameOrder(raw);
  if (typeof weekId !== 'string' || weekId === '') return cur;
  const clean = coerceIds(ids);
  const manual = { ...cur.manual };
  const recent = cur.recent.filter(w => w !== weekId);
  if (clean.length) { manual[weekId] = clean; recent.push(weekId); } else { delete manual[weekId]; }
  return coerceGameOrder({ mode: cur.mode, manual, recent });
}

export function withMode(raw, mode) {
  const cur = coerceGameOrder(raw);
  return { ...cur, mode: coerceMode(mode) };
}

function statusRank(game, phaseOf) {
  let phase = null;
  if (typeof phaseOf === 'function') { try { phase = phaseOf(game); } catch { phase = null; } }
  if (phase === null) phase = game && game.status === 'live' ? 'live' : game && game.status === 'final' ? 'final' : 'upcoming';
  if (phase === 'live' || phase === 'live-stale') return 0;
  if (phase === 'final') return 2;
  return 1;                                                              // upcoming, awaiting, no-score
}

/**
 * Deterministic and total: the same games give the same order whatever order they arrive in. Returns a NEW array; never mutates `games`.
 * @param {object[]} games
 * @param {{mode?:string, manualIds?:string[], phaseOf?:(game:object)=>string}} opts
 */
export function orderGames(games, { mode = 'kickoff', manualIds = [], phaseOf } = {}) {
  const list = (Array.isArray(games) ? games : []).filter(g => g && typeof g === 'object');
  const byKickoff = list.slice().sort(kickoffCompare);
  const m = coerceMode(mode);
  if (m === 'live-first') {
    const rank = new Map(list.map(g => [g, statusRank(g, phaseOf)]));
    return list.slice().sort((a, b) => (rank.get(a) - rank.get(b)) || kickoffCompare(a, b));
  }
  if (m === 'manual') {
    const saved = coerceIds(manualIds);
    const byId = new Map();
    for (const g of byKickoff) if (!byId.has(idOf(g))) byId.set(idOf(g), g);
    const first = [];
    const placed = new Set();                                            // game OBJECTS, not ids: a (broken) duplicate id can never drop a game from the tail
    for (const id of saved) { const g = byId.get(id); if (g && !placed.has(g)) { first.push(g); placed.add(g); } }
    return first.concat(byKickoff.filter(g => !placed.has(g)));
  }
  return byKickoff;
}
