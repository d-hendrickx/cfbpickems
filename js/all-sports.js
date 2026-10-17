/**
 * CFB Pickems — all-sports.js (D1 / v0.30.0, DI-525 rev 3; Drew D-59: "maybe add an option for 'all sports' on the right next to cfb/nfl")
 *
 * The model of the Dashboard's ALL SPORTS view: the combined slate of THIS week across the sports the member plays — one "All Picks by Game" list, each row labelled with its sport,
 * sorted across sports, each sport gated on ITS OWN week. The rendering of a game row is the Dashboard's own (app.js renderCompactGameCard); this module decides WHICH rows, in WHAT
 * ORDER, with WHICH gate — and it is pure, so the cross-sport rules are provable without a DOM.
 *
 *   allSportsModel(sports, { now })        { rows, gates, counts, blindAny }
 *   effectiveSortMode(saved)               Custom is per sport, so it is unavailable here and reads as 'kickoff' (the SAVED mode is never overwritten)
 *   sortAllSportsRows(rows, mode)          'kickoff' (ties: competition order, then game id) | 'live' (live, upcoming, final; then kickoff)
 *   thisWeekHeader(sports, text)           the static "This week" block that replaces the week navigator (no arrows, week swipe is inert)
 *   ALL_SPORTS_NOTE                        the calm line that stands where Alma Mater Watch and the weekly summary would be
 *
 * THE RULES (security C2, C4, C7; the blind rule):
 *   - a row's picks follow ITS OWN week: `sport.canSeeOthers` is computed by the caller per week (arePicksPublic / canViewOtherPicks / picksReadConfirmed), never once for the card;
 *     so a CFB week that is Live next to an NFL week that is Locked shows names on CFB rows and the viewer's own chip + `•••` on NFL rows, in one list. A live or final update in one
 *     sport can neither hide nor reveal another sport's picks, because nothing here carries a flag from one sport to another.
 *   - the "Submit your picks first" gate is PER SPORT: a played sport whose week is not public and which the viewer has not submitted shows one gate in place of its games.
 *   - only sports the viewer PLAYS are in `sports` (the caller passes playedSports()), so an unplayed sport cannot appear (C7).
 *   - counts are of games, never of picks.
 * It imports nothing and receives no pick, no player and no rival.
 */

export const ALL_SPORTS_NOTE = 'Alma Mater Watch and the weekly summary are per sport. Choose CFB or NFL above.';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const kickoffMsOf = (g) => { const t = Date.parse(g && g.kickoff); return Number.isFinite(t) ? t : null; };
// A GAME's phase (live / upcoming / final), never a week's status: the names say so (consumertest's receiver convention), and the week gate on every row is the caller's `canSeeOthers`.
const phaseRank = (gameStatus) => (gameStatus === 'live' ? 0 : gameStatus === 'final' ? 2 : 1);

/** Custom is per sport, so in All sports a saved Custom is shown as Kickoff time. The saved value is NOT changed (the caller keeps it). */
export function effectiveSortMode(saved) {
  return saved === 'live' ? 'live' : 'kickoff';
}

/** Sort rows across sports. 'kickoff': by kickoff instant (a game with no time last), ties by competition order then game id. 'live': live, then upcoming, then final; each by kickoff. */
export function sortAllSportsRows(rows, mode = 'kickoff') {
  const m = effectiveSortMode(mode);
  const key = (r) => (r.kickoffMs === null || r.kickoffMs === undefined ? Number.POSITIVE_INFINITY : r.kickoffMs);
  return rows.slice().sort((a, b) => {
    if (m === 'live') { const d = phaseRank(a.status) - phaseRank(b.status); if (d) return d; }
    const k = key(a) - key(b);
    if (k) return k;       // Infinity - Infinity is NaN, which is falsy: two time-less games fall through to the tie-breaks
    return (a.order - b.order) || String(a.gameId).localeCompare(String(b.gameId));
  });
}

/**
 * @param {Array<{ dbCode, code, order, weekId, weekLabel, hidden?, gate?, canSeeOthers?, startMs?, endMs?, games: Array<{gameId, kickoff, status}> }>} sports
 *   one entry per sport the VIEWER PLAYS, in competition order. `hidden` = the sport's current week must not be shown to this viewer (a draft week for a member, a demo week for anyone but the
 *   commissioner, UN-71) or does not exist. `gate` = the viewer must submit this sport's picks first (its week is not public and they have not submitted).
 * @returns {{ rows: Array, gates: Array, counts: { total: number, live: number }, blindAny: boolean, sports: Array }}
 */
export function allSportsModel(sports, { mode = 'kickoff' } = {}) {
  const rows = [];
  const gates = [];
  const shown = [];
  let blindAny = false;
  for (const s of Array.isArray(sports) ? sports : []) {
    if (!s || !s.dbCode || s.hidden) continue;
    shown.push(s);
    if (s.gate === true) { gates.push({ dbCode: s.dbCode, code: s.code || s.dbCode, order: s.order }); continue; }
    if (s.canSeeOthers !== true) blindAny = true;
    for (const g of Array.isArray(s.games) ? s.games : []) {
      if (!g || !g.gameId) continue;
      rows.push({ gameId: g.gameId, dbCode: s.dbCode, code: s.code || s.dbCode, order: num(s.order) ?? 0, weekId: s.weekId, status: g.status || '', kickoffMs: kickoffMsOf(g), blind: s.canSeeOthers !== true });
    }
  }
  const sorted = sortAllSportsRows(rows, mode);
  return { rows: sorted, gates, counts: { total: sorted.length, live: sorted.filter((g) => g.status === 'live').length }, blindAny, sports: shown };
}

/**
 * The static header that replaces the week navigator (DI-525 rev 3): "This week" and one caption — the date span of the sports' current weeks and each sport's own week label.
 * `text.span` is the already-formatted date span (the caller owns the viewer's zone). No arrows, no previous week: each sport's week has its own number, lock and finalization.
 */
export function thisWeekHeader(sports, text = {}) {
  const labels = (Array.isArray(sports) ? sports : []).filter((s) => s && !s.hidden && s.weekLabel).map((s) => `${s.code || s.dbCode} ${s.weekLabel}`);
  const span = String(text.span || '');
  return { title: 'This week', caption: [span, labels.join(' · ')].filter(Boolean).join(' · ') };
}
