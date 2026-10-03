/**
 * CFB Pickems — stats-core.js (Social Platform v1 Home, DI-360, 2026-09-30)
 * =========================================================================
 * The streak / milestone / lone-wolf logic, EXTRACTED from js/scribeLines.js
 * so SCRIBE and the Home feed compute the same facts BY CONSTRUCTION — one
 * implementation, two importers — rather than two copies that can drift
 * ("Never reproduce or invent stats", CLAUDE.md).
 *
 * WHAT MOVED, AND HOW: `orderedGradedResults` and `runLength` are MOVED, not
 * rewritten — the function bodies below are byte-identical to what
 * js/scribeLines.js held at `c2da987`. `MILESTONE_MARKS` and `STREAK_MIN` are
 * the same two literals, now exported from here. `loneWolfWinner` is the one
 * NEW function name: it is the inline `loneWolfWin` block of `detectWeekSignals`
 * (same three conditions, same order) lifted into its own function so the
 * Home feed's `stood.alone` card asks the identical question. js/scribeLines.js
 * imports all of these and declares NONE of the constants (S-C9): the server's
 * drift guard (supabase/tests/functions/scribeAutonomous.twin.mjs [B2c]) now
 * reads THIS file's `export const` declarations and asserts exactly one match.
 *
 * WHAT THIS MODULE NEVER DOES: it computes FACTS. It carries no reveal
 * decision, never asks `arePicksPublic()`, never reads storage. Whether a fact
 * computed here may ever reach a screen is js/feed-cards.js's `isRevealed()`
 * (DI-362) — a function in this file cannot make a pick public.
 *
 * IMPORTS: `evaluatePick` from ./scoring.js (the SAME function the standings
 * grade with — CONVENTIONS #21), exactly the import js/scribeLines.js already
 * made for `orderedGradedResults`. `calculateAtsWinner` is NOT imported by
 * `loneWolfWinner`: it is injected, per DI-360, so this module's one
 * game-level helper does not hard-wire the scoring surface.
 */

import { evaluatePick } from './scoring.js';

/** Round-number career/season correct-pick counts worth noticing. RAW
 *  counts, never the weighted tally — a milestone is "you have been right
 *  100 times," which is a count of games, not a score (CONVENTIONS #22). */
export const MILESTONE_MARKS = [25, 50, 100, 150, 200, 250, 300];
export const STREAK_MIN = 3;

/**
 * Every graded pick for one player, in true chronological order.
 *
 * The ordering rule is the same one backend/Code.gs's
 * `scribeOrderedGradedPicks_` uses, for the same reason (F2): a streak is an
 * ordered claim, and an unordered list produces a confidently wrong number.
 * Here the sort key is the game's own `kickoff` (games carry ISO kickoffs, so
 * week order falls out of it) with `gameId` as a stable final tiebreak.
 *
 * `complete:false` means at least one graded pick could not be placed —
 * missing game, missing or unparseable kickoff. The caller must then emit no
 * streak at all: a sequence with a hole is worse than no sequence.
 */
export function orderedGradedResults(playerId, games, picks, weeks = null) {
  const gameById = new Map();
  for (const g of games || []) { if (g && g.gameId) gameById.set(g.gameId, g); }
  // N-5 — the SAME comparator backend/Code.gs's scribeOrderedGradedPicks_
  // uses: (season, weekNumber) first, then kickoff, then gameId. Supplying
  // `weeks` is how the two runtimes agree exactly; with no week list the
  // ordering degrades to kickoff-only, which is identical whenever kickoffs
  // are correct and is why a pick whose week is UNKNOWN to a supplied list
  // marks the sequence incomplete rather than being silently ranked 0.
  const weekRank = new Map();
  if (Array.isArray(weeks)) {
    [...weeks].filter(Boolean).sort((a, b) =>
      String(a.season || '').localeCompare(String(b.season || '')) ||
      ((Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0))
    ).forEach((w, i) => weekRank.set(String(w.weekId), i));
  }
  const out = [];
  let complete = true;
  for (const p of picks || []) {
    if (!p || p.playerId !== playerId) continue;
    const game = gameById.get(p.gameId);
    if (!game) { complete = false; continue; }
    const result = evaluatePick(p, game);
    if (result !== 'win' && result !== 'loss') continue;          // graded only
    const ms = game.kickoff ? Date.parse(game.kickoff) : NaN;
    const rank = weekRank.size ? weekRank.get(String(p.weekId)) : 0;
    if (!Number.isFinite(ms) || rank === undefined) { complete = false; continue; }
    out.push({ weekId: p.weekId, gameId: p.gameId, result, ms, rank });
  }
  out.sort((a, b) => (a.rank - b.rank) || (a.ms - b.ms) || String(a.gameId).localeCompare(String(b.gameId)));
  return { results: out, complete };
}

export function runLength(results) {
  if (!results.length) return { run: 0, result: null };
  const last = results[results.length - 1].result;
  let run = 0;
  for (let i = results.length - 1; i >= 0; i--) { if (results[i].result === last) run++; else break; }
  return { run, result: last };
}

/**
 * The streak SIGNAL rule, extracted from `detectWeekSignals`'s inline block so SCRIBE and the
 * Home feed apply ONE rule (reviewer note 4, 2026-10-01 — the feed had re-implemented it):
 * "reached/extended to STREAK_MIN+, or broken at STREAK_MIN+".
 *
 * `ordered` is `orderedGradedResults()`'s return for ONE player, `weekId` the week being
 * finalized. A history with a hole (`complete:false`) or fewer than STREAK_MIN graded picks
 * yields `null` — "a sequence with a hole is worse than no sequence".
 *   - `current` = the trailing run over ALL results handed in; `prior` = the trailing run
 *     once THIS week's results are removed.
 *   - current.run >= STREAK_MIN               -> { state:'active', run, kind }
 *   - else a prior run >= STREAK_MIN that this week's last result ended
 *                                             -> { state:'broken', run: prior.run, kind: the PRIOR kind }
 * `kind` is 'covers' for a run of wins, 'misses' for a run of losses.
 *
 * Callers decide WHO is asked (SCRIBE: every player with a pick this week; the feed: every
 * player with a graded result this week, over results through that week) — the rule itself
 * carries no reveal decision.
 *
 * @returns {{run:number, kind:'covers'|'misses', state:'active'|'broken'}|null}
 */
export function streakChange(ordered, weekId) {
  const { results, complete } = ordered || {};
  if (!complete || !Array.isArray(results) || results.length < STREAK_MIN) return null;
  const current = runLength(results);
  const prior = runLength(results.filter(r => r.weekId !== weekId));
  if (current.run >= STREAK_MIN) {
    return { run: current.run, kind: current.result === 'win' ? 'covers' : 'misses', state: 'active' };
  }
  if (prior.run >= STREAK_MIN && prior.result && current.result !== prior.result) {
    return { run: prior.run, kind: prior.result === 'win' ? 'covers' : 'misses', state: 'broken' };
  }
  return null;
}

/**
 * loneWolfWin — at finalize. Exactly one player on the ATS-winning side,
 * everyone else on the other. Uses the SAME calculateAtsWinner the
 * standings use (CONVENTIONS #21), never a second reading of the spread —
 * INJECTED here (`{ calculateAtsWinner }`) so this module stays free of a
 * direct dependency on the scoring surface for this function.
 *
 * Extracted from `detectWeekSignals`'s inline block (same three conditions,
 * same order): the game must be FINAL; there must be a real ATS winner (a
 * push — `no_decision` — or an ungradable game has none); then
 * `winners = picks on this game with selectedTeam === ats`, `losers = picks on
 * this game with selectedTeam !== ats`, and the result is non-null ONLY when
 * `winners.length === 1 && losers.length >= 2`.
 *
 * `picks` may be a whole week's picks — this function filters to the game.
 * NOTE this computes a FACT only. It carries no reveal decision of its own;
 * the feed's `isRevealed()` (js/feed-cards.js, DI-362) decides whether its
 * output may ever reach a card (S-C1).
 *
 * @returns {{playerId:string, team:string, against:number}|null}
 */
export function loneWolfWinner(game, picks, { calculateAtsWinner } = {}) {
  if (!game || game.status !== 'final') return null;
  const ats = (game.atsWinner !== undefined && game.atsWinner !== null)
    ? game.atsWinner
    : (typeof calculateAtsWinner === 'function' ? calculateAtsWinner(game) : null);
  if (!ats || ats === 'no_decision') return null;
  const gp = (picks || []).filter(p => p && p.gameId === game.gameId);
  const winners = gp.filter(p => p.selectedTeam === ats);
  const losers = gp.filter(p => p.selectedTeam !== ats);
  if (winners.length === 1 && losers.length >= 2) {
    return { playerId: winners[0].playerId, team: ats, against: losers.length };
  }
  return null;
}
