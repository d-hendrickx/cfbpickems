/**
 * CFB Pickems — stats.js (Social Platform v1 Home, DI-361, 2026-09-30)
 * ====================================================================
 * Per-member SEASON stats, computed from data that is already loaded. One pure
 * function (`memberSeasonStats`) plus the small SD-11 helpers the feed's
 * `called.it` card shares with it (`isUpsetCalled`, `underdogTeam`,
 * `upsetLineLabel`). RAW counts only (CONVENTIONS #22); no tiebreaker field
 * anywhere in any return shape (CONVENTIONS #23).
 *
 * ── THE ONE RULE THIS MODULE LIVES BY (S-C2) ─────────────────────────────────
 * Every input is the REVEALED VIEW — weeks restricted to `arePicksPublic(week)
 * && confirmedStatus === 'final'`, assembled ONCE by the caller (js/feed-cards.js
 * `buildRevealedView()`, then js/home.js's `assembleHomeSnapshot()`), and never
 * re-filtered or re-trusted here. The parameter names say so on purpose:
 * `revealedWeeks` / `revealedGames` / `revealedPicks` / `revealedWeeklyResults`.
 * This module performs NO reveal check of its own and it trusts none of its
 * inputs to be the full league data — it computes over exactly what it is handed.
 * Its entire correctness therefore depends on the caller honouring S-C2, which
 * is why statstest.mjs proves the restriction is load-bearing (a week left in
 * that should not be MOVES a streak) rather than coincidental.
 *
 * ── WHAT IT NEVER DOES ───────────────────────────────────────────────────────
 * - Never calls `calculateWeeklyResults()` — the season `record` is summed
 *   DIRECTLY from the stored `correctCount`/`incorrectCount` fields of
 *   `getWeeklyResults()`'s rows (a live recompute over a non-final week would
 *   hand back a partial, unrevealed tally). statstest asserts this module does
 *   not even IMPORT that function.
 * - Never reads storage. Never writes. Never touches `js/scoring.js`'s source:
 *   it only READS the outputs of `calculateSeasonStandings` / `evaluatePick`.
 *
 * ── STREAK DEFINITION (SD-11) ────────────────────────────────────────────────
 * Consecutive correct raw picks in kickoff order; a push is skipped (does not
 * count toward or break the streak); a loss resets the run. `currentStreak` is
 * the trailing run of ONE result (the SCRIBE detector's own semantics — a run of
 * misses is a streak too, kind 'misses'); `longestStreak` is the longest run of
 * COVERS, which is what SD-11 defines "streak" as. Both come from
 * js/stats-core.js — the same `orderedGradedResults`/`runLength` SCRIBE uses.
 */

import { calculateSeasonStandings, evaluatePick } from './scoring.js';
import { getAlmaMaterMatch } from './data-model.js';
import { orderedGradedResults, runLength, STREAK_MIN } from './stats-core.js';

// ── small helpers ────────────────────────────────────────────────────────────

/** Same coercion js/scoring.js's private `finiteOrNull` applies to scores and
 *  spreads, so "who was the underdog" and "who covered" can never disagree
 *  because one side coerced a numeric string and the other did not. */
function finiteOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Weeks in the order every streak and every "through week N" slice uses:
 *  (season, weekNumber) — the SAME comparator `orderedGradedResults` ranks by —
 *  with `weekId` as a final tiebreak so two records sharing a number sort stably. */
export function sortWeeks(weeks) {
  return [...(weeks || [])].filter(Boolean).sort((a, b) =>
    String(a.season || '').localeCompare(String(b.season || '')) ||
    ((Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0)) ||
    String(a.weekId).localeCompare(String(b.weekId))
  );
}

// ── SD-11 "upset called" ─────────────────────────────────────────────────────

/** The spread the week was scored against: the locked line when it is usable,
 *  else the live line — js/scoring.js's `calculateAtsWinner` precedence exactly
 *  (precedence is on USABILITY, not presence: a locked PK of 0 still governs). */
function scoringSpread(game) {
  const locked = finiteOrNull(game?.lockedSpread);
  return locked !== null ? locked : finiteOrNull(game?.spread);
}

/**
 * The underdog's team name, or `null` for a pick'em line (spread 0 — "a PK game
 * can never produce an upset: there is no underdog side to have called") or an
 * ungradable line. HOME-perspective sign: negative = home favored, so the AWAY
 * team is the underdog; positive = away favored, so the HOME team is.
 */
export function underdogTeam(game) {
  if (!game) return null;
  const sv = scoringSpread(game);
  if (sv === null || sv === 0) return null;
  const dog = sv < 0 ? game.awayTeam : game.homeTeam;
  return dog || null;
}

/** The team that won the game straight up, or `null` for a tie / missing score. */
function outrightWinner(game) {
  const hs = finiteOrNull(game?.homeScore);
  const as = finiteOrNull(game?.awayScore);
  if (hs === null || as === null || hs === as) return null;
  return hs > as ? game.homeTeam : game.awayTeam;
}

/**
 * SD-11 "upset called": a CORRECT against-the-spread pick on the underdog that
 * ALSO won the game outright. Both conditions are required — a backdoor cover
 * (the underdog lost by less than the spread) is a correct pick, nothing more.
 * Graded by the SAME `evaluatePick` the standings use (CONVENTIONS #21).
 */
export function isUpsetCalled(pick, game) {
  if (!pick || !game || game.status !== 'final') return false;
  const dog = underdogTeam(game);
  if (!dog || pick.selectedTeam !== dog) return false;
  if (evaluatePick(pick, game) !== 'win') return false;
  return outrightWinner(game) === dog;
}

/**
 * How far the ATS winner covered by: `abs(homeScore + spread - awayScore)`, over
 * the SAME spread precedence `calculateAtsWinner` grades with. `null` when the
 * game has no usable spread or score, or the line pushed (nothing "covered").
 */
export function atsMarginOf(game) {
  const sv = scoringSpread(game);
  const hs = finiteOrNull(game?.homeScore), as = finiteOrNull(game?.awayScore);
  if (sv === null || hs === null || as === null) return null;
  const diff = Math.abs(hs + sv - as);
  return diff < 0.01 ? null : diff;
}

/** "+9.5" — the underdog's line as it is DISPLAYED (Favorite + Margin world:
 *  the number is `abs(spread)`, the sign is the underdog's own side), never a
 *  raw signed input (AD-03). Same absolute value `formatSpread()` shows. */
export function upsetLineLabel(game) {
  const sv = scoringSpread(game);
  if (sv === null || sv === 0) return '';
  const abs = Math.abs(sv);
  return `+${abs}`;
}

/** "31–28" — winner first, the way a score is said aloud. */
export function outrightScoreLine(game) {
  const hs = finiteOrNull(game?.homeScore);
  const as = finiteOrNull(game?.awayScore);
  if (hs === null || as === null) return '';
  return hs >= as ? `${hs}–${as}` : `${as}–${hs}`;
}

// ── alma mater (STRAIGHT-UP, never ATS — locked decision) ────────────────────

/**
 * The shared precise matcher, made SAFE for a free-text school: `getAlmaMaterMatch` indexes
 * plain-object tables with the school string, so a member whose `almaMater` is
 * "constructor" / "__proto__" / "toString" reaches an inherited FUNCTION and throws a
 * TypeError (reviewer probe, 2026-10-01). A throwing matcher would take the whole feed
 * down for one profile field, so an unreadable match is simply "not this school".
 */
function schoolIsTeam(teamName, alma) {
  try { return !!getAlmaMaterMatch(teamName, [alma]); } catch { return false; }
}

/**
 * Every DECISIVE alma-mater game this school played in `games`: the slate's own flag
 * (`isAlmaMaterGame`, calcMode 'selectedSlateOnly'), a FINAL game with two usable scores, the
 * school on exactly one side, and no tie. `team` is the school's name as the GAME ROW spells it
 * (never the player's free-text value — DI-439's rule: what is named comes from the game).
 * `games` is whatever the caller hands in — the revealed view, never storage.
 *
 * @returns {Array<{gameId:string, weekId:string, team:string, result:'win'|'loss'}>}
 */
export function almaMaterGameResults(alma, games) {
  const school = String(alma || '').trim();
  if (!school) return [];
  const out = [];
  for (const g of games || []) {
    if (!g || !g.isAlmaMaterGame || g.status !== 'final') continue;
    const hs = finiteOrNull(g.homeScore), as = finiteOrNull(g.awayScore);
    if (hs === null || as === null) continue;
    const homeIsMine = schoolIsTeam(g.homeTeam, school);
    const awayIsMine = schoolIsTeam(g.awayTeam, school);
    if (homeIsMine === awayIsMine) continue;      // neither side, or an ambiguous both-sides match
    if (hs === as) continue;                      // a tie is neither a win nor a loss
    const won = (homeIsMine && hs > as) || (awayIsMine && as > hs);
    out.push({ gameId: g.gameId, weekId: g.weekId, team: String(homeIsMine ? g.homeTeam : g.awayTeam), result: won ? 'win' : 'loss' });
  }
  return out;
}

/**
 * The member's school's straight-up result in ONE week — `{ team, result:'win'|'loss' }` — or
 * `null` when the week has no decisive alma-mater game for it (no game, a tie, not final) or
 * MORE than one (ambiguous: absent beats wrong). This is the `player.week` card's
 * `almaMaterResult` fact (DI-362 amendment, approved inline 2026-10-01): public, straight-up
 * and post-final — `games` must be the REVEALED view's games for that week.
 */
export function almaMaterResultForWeek(alma, weekId, games) {
  const week = almaMaterGameResults(alma, (games || []).filter(g => g && g.weekId === weekId));
  return week.length === 1 ? { team: week[0].team, result: week[0].result } : null;
}

// ── the stats ────────────────────────────────────────────────────────────────

/**
 * @param {string} memberId
 * @param {object} view  the REVEALED VIEW (S-C2) — see the module header.
 * @param {Array}  view.players
 * @param {Array}  view.revealedWeeks
 * @param {Array}  view.revealedGames
 * @param {Array}  view.revealedPicks
 * @param {Array}  view.revealedWeeklyResults
 * @param {string|number|null} [view.season]   only weeks of this season count
 * @param {string|null}        [view.asOfWeekId]   restrict to weeks up to and
 *        including this one (the feed's "as of the end of week N"); an id that
 *        is not in the view yields EMPTY stats, never a wider view (fail closed)
 * @param {Array|null}         [view.allWeeks]   week RECORDS only, for
 *        `calculateSeasonStandings`'s multi-part-group sizing (UN-118): Standings
 *        passes every week so a split week waits for all its parts. Structure
 *        only — it carries no picks and no results, and it is never the source of
 *        any count. Defaults to the restricted weeks.
 * @param {Map<string,object>|null} [view.tieContexts]   SP-54 / DI-467 (wired by the Home wiring window, HOME_WIRING_CHECKLIST item 21): the SAME
 *        groupId -> TieContext map seasonStandingsRows() hands calculateSeasonStandings (js/tie-context.js buildGroupTieContexts), so a pooled multi-part
 *        group's season win / loss — and with it `weeklyWins`, `weeklyLosses` and `currentRank` — agree with the Standings page on a pooled group tie. It is
 *        passed straight through (this module reads no key from it) and `null` is today's exact behaviour. The caller restricts it to groups whose every
 *        member week is in the revealed view (home.js), so nothing built from an unrevealed week rides in.
 */
export function memberSeasonStats(memberId, {
  players = [], revealedWeeks = [], revealedGames = [], revealedPicks = [], revealedWeeklyResults = [],
  season = null, asOfWeekId = null, allWeeks = null, tieContexts = null,
} = {}) {
  // 1. The week slice: season, then "through week N".
  let weeks = sortWeeks(revealedWeeks);
  if (season !== null && season !== undefined) weeks = weeks.filter(w => String(w.season) === String(season));
  if (asOfWeekId !== null && asOfWeekId !== undefined) {
    const at = weeks.findIndex(w => w.weekId === asOfWeekId);
    weeks = at < 0 ? [] : weeks.slice(0, at + 1);
  }
  const ids = new Set(weeks.map(w => w.weekId));
  const games = (revealedGames || []).filter(g => g && ids.has(g.weekId));
  const picks = (revealedPicks || []).filter(p => p && ids.has(p.weekId));
  const rows = (revealedWeeklyResults || []).filter(r => r && ids.has(r.weekId));
  const mine = rows.filter(r => r.playerId === memberId);

  // 2. record — RAW, summed DIRECTLY from the stored rows. The `?? correctPicks`
  //    fallback is calculateSeasonStandings's own (pre-multiplier rows carry no
  //    count fields; no multipliers existed then), so `record.wins` and
  //    `totalCorrectCount` can never disagree.
  const wins = mine.reduce((s, r) => s + num(r.correctCount ?? r.correctPicks ?? 0), 0);
  const losses = mine.reduce((s, r) => s + num(r.incorrectCount ?? r.incorrectPicks ?? 0), 0);

  // 3. standings parity — the SAME function, over the revealed view, never
  //    re-derived. Group sizing may see every week RECORD (structure only).
  const standingsWeeks = Array.isArray(allWeeks) ? allWeeks : weeks;
  const standings = calculateSeasonStandings((players || []).filter(Boolean), rows, standingsWeeks, tieContexts instanceof Map ? tieContexts : null);
  const row = standings.find(s => s.playerId === memberId) || null;

  // 4. streaks — via stats-core, over the revealed view only.
  const { results, complete } = orderedGradedResults(memberId, games, picks, weeks);
  let currentStreak = { run: 0, kind: null, state: 'unknown' };
  let longestStreak = null;
  if (complete) {
    const cur = runLength(results);
    currentStreak = {
      run: cur.run,
      kind: cur.result === 'win' ? 'covers' : (cur.result === 'loss' ? 'misses' : null),
      state: cur.run >= STREAK_MIN ? 'active' : 'none',
    };
    let best = 0, run = 0;
    for (const r of results) {
      if (r.result === 'win') { run++; if (run > best) best = run; } else run = 0;
    }
    longestStreak = { run: best, kind: best > 0 ? 'covers' : null };
  }

  // 5. best / worst week — from the stored rows, by RAW wins, ties to the earliest
  //    weekNumber. A row with nothing graded (0-0) is not a week anyone played.
  const weekById = new Map(weeks.map(w => [w.weekId, w]));
  const played = mine
    .map(r => ({ r, w: weekById.get(r.weekId), wn: num(r.correctCount ?? r.correctPicks ?? 0), ln: num(r.incorrectCount ?? r.incorrectPicks ?? 0) }))
    .filter(x => x.w && (x.wn + x.ln) > 0);
  const pack = (x) => ({ weekId: x.r.weekId, weekN: x.w.weekNumber, wins: x.wn, losses: x.ln });
  const earliest = (a, b) => (num(a.w.weekNumber) - num(b.w.weekNumber)) || String(a.r.weekId).localeCompare(String(b.r.weekId));
  const bestWeek = played.length ? pack([...played].sort((a, b) => (b.wn - a.wn) || earliest(a, b))[0]) : null;
  const worstWeek = played.length ? pack([...played].sort((a, b) => (a.wn - b.wn) || earliest(a, b))[0]) : null;

  // 6. upsets called (SD-11) — both conditions, over the revealed view.
  const gameById = new Map(games.map(g => [g.gameId, g]));
  const upsetsCalled = picks.filter(p => p.playerId === memberId && isUpsetCalled(p, gameById.get(p.gameId))).length;

  // 7. alma mater — STRAIGHT-UP only, never ATS (locked decision). The slate's own
  //    alma-mater flag (`isAlmaMaterGame`, calcMode 'selectedSlateOnly') AND the
  //    shared precise matcher against THIS member's school. `calculateAlmaMaterTotal`
  //    returns a points total, not a W/L, so it cannot be the source of this value;
  //    statstest cross-checks the two select the same games.
  const me = (players || []).find(p => p && p.playerId === memberId) || null;
  const alma = me && String(me.almaMater || '').trim();
  let almaMaterStraightUp = null;
  if (alma) {
    const decided = almaMaterGameResults(alma, games);
    almaMaterStraightUp = decided.length
      ? { wins: decided.filter(d => d.result === 'win').length, losses: decided.filter(d => d.result === 'loss').length }
      : null;
  }

  const lastWeek = weeks.length ? weeks[weeks.length - 1] : null;
  return {
    playerId: memberId,
    season: season ?? (lastWeek ? lastWeek.season ?? null : null),
    sport: lastWeek ? (lastWeek.sport ?? null) : null,
    record: { wins, losses },
    winPct: row ? row.winPct : null,
    weeklyWins: row ? row.weeklyWins : null,
    weeklyLosses: row ? row.weeklyLosses : null,
    currentRank: row ? row.currentRank : null,
    currentStreak,
    longestStreak,
    bestWeek,
    worstWeek,
    upsetsCalled,
    almaMaterStraightUp,
  };
}
