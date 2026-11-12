/**
 * CFB Pickems - js/analytics/tally.js (D2 lane 4; DI-975, DI-941; Q-D4 fallback; 2026-10-19)
 * ===========================================================================================
 * THE PER-WEEK TALLY AND THE SEASON RANKS, over the engine's pick records.
 *
 * WHAT IS IMPORTED AND WHAT IS NOT. js/scoring.js (read-only, Drew D-114 "Analytics reuses the week tally") exports NO
 * standalone per-week tally: the loop lives inside `calculateWeeklyResults`, which reads tiebreaker guesses through the
 * storage seam (it would paint the ACTIVE league's guesses onto a peeked league, which is why stats.js refuses it too).
 * So this file:
 *   - IMPORTS every piece of scoring that exists as a pure export: `gameMultiplier` (via the record's stored multiplier,
 *     see records.js), `evaluatePick` (the grade, in records.js), `rankWeeklyResults` and `calculateSeasonStandings`
 *     (the ranks, below);
 *   - keeps ONE engine-local loop, `tallyWeek`, the ten lines Q-D4's fallback describes, because the exported tally Q-D4
 *     proposed does not exist and this batch may not edit scoring.js. It is guarded by the parity test in analyticstest
 *     ([PARITY]): its numbers equal `calculateWeeklyResults`'s on every fixture, including a multiplier-2 game, a push
 *     and a pending pick. When Drew approves Q-D4 the loop below is replaced by the extracted export and nothing else
 *     in the engine changes.
 *
 * TWO TALLIES (CLAUDE.md): `correctPicks` / `incorrectPicks` are WEIGHTED by the game's multiplier and drive standings;
 * `correctCount` / `incorrectCount` are RAW. TIEBREAKERS ARE NEVER MULTIPLIED and appear nowhere here: the rows this file
 * produces carry `tiebreakerGuess: null` and `tiebreakerDelta: null`, and no winner or loser flag is set from a guess.
 */
import { calculateSeasonStandings, rankWeeklyResults } from '../scoring.js';

/**
 * The per-week tally of ONE member's pick records (each carries `result` and the game's `multiplier`).
 * Same fields and same arithmetic as calculateWeeklyResults's inner loop.
 */
export function tallyWeek(pickRecords) {
  let correctPicks = 0, incorrectPicks = 0, correctCount = 0, incorrectCount = 0, noDecisions = 0, pending = 0;
  for (const p of pickRecords) {
    if (p.result === 'win') { correctPicks += p.multiplier; correctCount++; }
    else if (p.result === 'loss') { incorrectPicks += p.multiplier; incorrectCount++; }
    else if (p.result === 'push') noDecisions++;
    else pending++;
  }
  return { correctPicks, incorrectPicks, correctCount, incorrectCount, noDecisions, pending };
}

/**
 * The week rows calculateWeeklyResults would return, built from records. `anyFinal` is true when a game of the week is
 * final. Ranked and flagged by the IMPORTED `rankWeeklyResults` with NO tie context: a tie on correctPicks is ordered by
 * the stable sort, never by a tiebreaker (the caller treats a tie as a tie, DI-975).
 */
export function weekRows(weekId, memberIds, picksByMember, { anyFinal = true } = {}) {
  const rows = memberIds.map((id) => ({
    resultId: 'wr_' + weekId + '_' + id,
    weekId, playerId: id, displayName: id,
    ...tallyWeek(picksByMember.get(id) || []),
    tiebreakerGuess: null, tiebreakerDelta: null,
    rank: 0, isWinner: false, isLoser: false, wonByTiebreaker: false,
  }));
  return rankWeeklyResults(rows, anyFinal, null);
}

/** calculateSeasonStandings over rows, passed straight through (the group-aware path when `weeks` is given). */
export function standingsOf(players, rows, weeks = null, tieContexts = null) {
  return calculateSeasonStandings(players, rows, weeks, tieContexts instanceof Map ? tieContexts : null);
}
