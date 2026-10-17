/**
 * CFB Pickems — live-tiebreak.js (D1 / FB-002 / UN-415, PF-415 / DI-515, DI-516)
 *
 * THE ALMA-MATER TIEBREAKER, COMPUTED FROM THE SCORES ALREADY ON SCREEN. Until now the number that breaks a weekly tie ("the combined points scored by the claimed
 * schools") reached the ranking only when the commissioner pressed Auto-Calc and then Save Tiebreaker, so the weekly order on the Dashboard ignored it all week and
 * every device showed whatever the last button-press had stored. This module computes it on every device from the games the device already holds (the 60-second score
 * poll refreshes them), so the order, the summary and the "so far" line move by themselves as scores arrive.
 *
 * A pure leaf. It imports `getAlmaMaterMatch` and `GAME_STATUS` from data-model.js and nothing else; it reads no storage, no DOM and no clock. `scoring.js` is NOT edited:
 * `calculateAlmaMaterTotal` stays the FINAL-ONLY function the finalize path uses, and `finalValue` below is its twin (livetiebreaktest.mjs proves they return the same
 * number and pick the same schools over the same fixtures). The numeric tiebreaker is NEVER multiplied by a game's multiplier (CONVENTIONS #23).
 *
 * WHAT IT NEVER DOES. A LIVE game's partial score is a PROVISIONAL input to the display only: it is never persisted as an actual, and a missing signal is `null`, never 0
 * ("no alma game has a score yet" is not "the schools scored nothing"). The total is a function of public scores and the public roster, so it reveals nothing about
 * anyone's pick; it is shown only where the ranking itself is shown. The school roster is the one the caller passes (`almaMatersForAutoCalc(week)`, frozen at lock), so a
 * claim edit after lock cannot move it.
 */
import { getAlmaMaterMatch, GAME_STATUS, TIEBREAKER_TYPE } from './data-model.js';

const finiteScore = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const hasScores = (g) => !!g && finiteScore(g.homeScore) && finiteScore(g.awayScore);
const isFinalScored = (g) => !!g && g.status === GAME_STATUS.FINAL && hasScores(g);
const isLiveScored = (g) => !!g && g.status === GAME_STATUS.LIVE && hasScores(g);
const ms = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? t : null; };

const NONE = Object.freeze({ value: null, finalValue: null, basis: 'none', complete: false, counted: 0, final: 0, live: 0, pending: 0, total: 0 });

/**
 * @param {object}   args
 * @param {object[]} args.games             the week's games
 * @param {string[]} [args.almaMaters]      the claimed schools (the lock-frozen roster once the week is past OPEN)
 * @param {string}   [args.calcMode]        week.tiebreakerCalculationMode ('selectedSlateOnly' keeps only games flagged as alma games; any other value sums every alma game)
 * @param {string}   [args.tiebreakerType]  week.tiebreakerType: 'almaMaterTotal' (default when missing), 'custom' (a designated game: the NFL), 'manual' (no auto value)
 * @param {string|null} [args.tiebreakerGameId]  the designated game for 'custom' (default: the slate's last kickoff)
 * @returns {{ value: number|null, finalValue: number|null, basis: string, complete: boolean, counted: number, final: number, live: number, pending: number, total: number }}
 *   value       the provisional total over FINAL and LIVE games with numeric scores; null when no counted game exists
 *   finalValue  the total over FINAL games only (calculateAlmaMaterTotal's number); null when no game is final
 *   complete    every game the total depends on is FINAL (the only state in which `value` may be stored as an actual)
 *   counted/final/live/pending/total   how many of the `total` games feed `value`, are final, are live-and-counted, are not counted yet
 *   game        for a 'custom' (designated game) tiebreaker only: { gameId, awayTeam, homeTeam } of the game the total is read from
 */
export function liveTiebreakerTotal({ games, almaMaters, calcMode = 'selectedSlateOnly', tiebreakerType, tiebreakerGameId = null } = {}) {
  const list = Array.isArray(games) ? games.filter(Boolean) : [];
  const type = tiebreakerType === undefined || tiebreakerType === null || tiebreakerType === '' ? TIEBREAKER_TYPE.ALMA_MATER_TOTAL : tiebreakerType;

  if (type === TIEBREAKER_TYPE.CUSTOM) {
    // A designated game (D-31: the NFL's Monday-night game): the sum of both teams' points. Default: the slate's last kickoff.
    let g = tiebreakerGameId ? list.find((x) => x.gameId === tiebreakerGameId) : null;
    if (!g) {
      const dated = list.filter((x) => ms(x.kickoff) !== null);
      g = dated.length ? dated.reduce((best, x) => (ms(x.kickoff) >= ms(best.kickoff) ? x : best)) : null;
    }
    if (!g) return { ...NONE, basis: 'game' };
    const finalNow = isFinalScored(g), liveNow = isLiveScored(g);
    const value = finalNow || liveNow ? Number(g.homeScore) + Number(g.awayScore) : null;
    return { value, finalValue: finalNow ? value : null, basis: 'game', complete: finalNow, counted: value === null ? 0 : 1, final: finalNow ? 1 : 0, live: liveNow ? 1 : 0, pending: value === null ? 1 : 0, total: 1,
      game: { gameId: g.gameId, awayTeam: String(g.awayTeam ?? ''), homeTeam: String(g.homeTeam ?? '') } };
  }
  if (type !== TIEBREAKER_TYPE.ALMA_MATER_TOTAL) return { ...NONE, basis: 'manual' };   // 'manual' (or anything else): the commissioner enters it

  // The alma-mater total. The filter is calculateAlmaMaterTotal's, character for character: a game counts when either side matches the roster (getAlmaMaterMatch, so a
  // claimed "Miami" never sums "Miami (OH)"), and in 'selectedSlateOnly' mode only when the game is also flagged as an alma game.
  const roster = Array.isArray(almaMaters) ? almaMaters : [];
  const almaGames = list.filter((g) => {
    const isAlma = !!(getAlmaMaterMatch(g.homeTeam, roster) || getAlmaMaterMatch(g.awayTeam, roster));
    return calcMode === 'selectedSlateOnly' ? g.isAlmaMaterGame && isAlma : isAlma;
  });
  if (!almaGames.length) return { ...NONE, basis: 'alma' };
  const sumOf = (subset) => {
    let total = 0;
    for (const g of subset) {
      if (getAlmaMaterMatch(g.homeTeam, roster)) total += Number(g.homeScore) || 0;
      if (getAlmaMaterMatch(g.awayTeam, roster)) total += Number(g.awayScore) || 0;
    }
    return total;
  };
  const finals = almaGames.filter(isFinalScored);
  const lives = almaGames.filter(isLiveScored);
  const counted = [...finals, ...lives];
  return {
    value: counted.length ? sumOf(counted) : null,
    finalValue: finals.length ? sumOf(finals) : null,
    basis: 'alma',
    complete: finals.length === almaGames.length,
    counted: counted.length, final: finals.length, live: lives.length, pending: almaGames.length - counted.length, total: almaGames.length,
  };
}

/**
 * The value every surface ranks with (DI-516). ONE answer per week:
 *   1. a STORED actual (`week.actualTiebreakerValue` set: a commissioner's override, or the value written at finalize) always wins -> source 'manual', provisional false;
 *   2. else, on a week that is NOT final, the live total -> source 'calculated', provisional = !complete;
 *   3. else nothing -> source 'none'.
 * A FINAL week never falls back to the live total: its persisted results were decided with the stored value (or none), and re-ranking it on a recomputed number would invent a
 * final value the results never used. Corrections to a settled week stay with Admin -> Data's Recalculate (forward-only, SP-54).
 *
 * `matchesCalculated` is true when the stored value equals a COMPLETE calculated total: the value finalize wrote from the auto-calc, which the Comm card then labels
 * "Calculated" rather than "Commissioner-set". `calculated` carries the live total itself so Step 2 of the guided flow can suggest it even when an override is stored.
 */
export function effectiveTiebreakerActual({ week, games, almaMaters } = {}) {
  const live = liveTiebreakerTotal({
    games, almaMaters,
    calcMode: week?.tiebreakerCalculationMode || 'selectedSlateOnly',
    tiebreakerType: week?.tiebreakerType,
    tiebreakerGameId: week?.tiebreakerGameId || null,
  });
  const stored = week ? week.actualTiebreakerValue : null;
  if (stored !== null && stored !== undefined && stored !== '' && Number.isFinite(Number(stored))) {
    const value = Number(stored);
    return { value, source: 'manual', provisional: false, matchesCalculated: live.complete && live.value === value, calculated: live };
  }
  if (week && week.status !== 'final' && live.value !== null) {
    return { value: live.value, source: 'calculated', provisional: !live.complete, matchesCalculated: false, calculated: live };
  }
  return { value: null, source: 'none', provisional: false, matchesCalculated: false, calculated: live };
}
