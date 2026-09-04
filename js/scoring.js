/**
 * CFB Pickems — Scoring Engine v5 (unchanged logic from v4)
 * No-decision scoring, tiebreaker-aware rankings, season stats by correct picks.
 */

import {
  PICK_RESULT, GAME_STATUS, getAlmaMaterMatch, getAutoLockOffsetMinutes,
  getEffectiveGroupId, weeksInGroup, getGroupTiebreakerWeek,
} from './data-model.js';
import { getTiebreakerGuess } from './storage.js';

// ─── AUTO-TRANSITION COMPUTE HELPERS ─────────────────────────────────────────
// These derive the "planned" transition times from the current slate. Read-only
// — the actual transitions happen in app.js via the auto-refresh tick.

/** First kickoff on the slate, or null if none. Ignores manual games without a kickoff time. */
export function computeFirstKickoff(games) {
  const times = (games || [])
    .map(g => g?.kickoff ? new Date(g.kickoff).getTime() : null)
    .filter(t => t && !isNaN(t));
  return times.length ? new Date(Math.min(...times)) : null;
}

/** Last kickoff on the slate — used for auto-final trigger (all games in must be past). */
export function computeLastKickoff(games) {
  const times = (games || [])
    .map(g => g?.kickoff ? new Date(g.kickoff).getTime() : null)
    .filter(t => t && !isNaN(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * The effective lock time for a week. Rule:
 *   1. If commissioner explicitly set `picksLockAt`, honor it.
 *   2. Otherwise, compute: firstKickoff - autoLockOffsetMinutes (default 30).
 *   3. If no games are on the slate yet, return null (nothing to derive from).
 */
export function computeEffectiveLockAt(week, games) {
  if (!week) return null;
  if (week.picksLockAt) return new Date(week.picksLockAt);
  const first = computeFirstKickoff(games);
  if (!first) return null;
  const offset = getAutoLockOffsetMinutes(week);
  return new Date(first.getTime() - offset * 60 * 1000);
}

/** Effective live time = first kickoff. Auto-live can be disabled. */
export function computeEffectiveLiveAt(week, games) {
  return computeFirstKickoff(games);
}

/**
 * Coerce a stored score or spread to a finite number, or null when the value
 * cannot decide anything. Same defensive-coercion pattern as
 * `gameMultiplier()` below (CONVENTIONS #7) — but this one falls back to NULL,
 * not to a safe default, because there is no safe default for "who covered."
 *
 * Why this exists: `calculateAtsWinner()` previously guarded only `=== null`.
 * An ABSENT key, `undefined`, `NaN`, `''` or any non-number reached the
 * arithmetic, made `diff` NaN, and then fell through both `Math.abs(NaN) <
 * 0.01` (false) and `NaN > 0` (false) to the else branch — silently returning
 * `awayTeam`. That is a real, money-deciding cover fabricated out of data that
 * cannot decide anything, always landing on the same side, and app.js persists
 * the result into `game.atsWinner`, after which `evaluatePick()` prefers the
 * stored value forever. Every other reader of these fields in the app uses a
 * loose `!= null` (chat-ui.js:822/1656/1989, app.js:4358); this was the one
 * strict-equality reader, and it is the one that decides who owes whom money.
 * Numeric strings coerce (a value that round-tripped through a text field
 * still describes the same game); everything else is refused.
 */
function finiteOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function calculateAtsWinner(game) {
  const { homeScore, awayScore, lockedSpread, spread, homeTeam, awayTeam, status } = game;
  if (status !== GAME_STATUS.FINAL) return null;
  const hs = finiteOrNull(homeScore);
  const as_ = finiteOrNull(awayScore);
  if (hs === null || as_ === null) return null;
  // Prefer lockedSpread (the spread the week was scored against) but fall back
  // to live spread when nothing was locked — otherwise final games with scores
  // but never-locked weeks show as PENDING forever. The spread convention is
  // HOME perspective: negative = home favored, positive = away favored.
  // NOTE the precedence is on USABILITY, not presence: a locked line of 0 (a
  // locked PK) still governs, while a locked line that is blank or unparseable
  // is not a locked line at all and yields to the same fallback as null.
  const locked = finiteOrNull(lockedSpread);
  const sv = locked !== null ? locked : finiteOrNull(spread);
  if (sv === null) return null;
  const adjusted = hs + sv;
  const diff = adjusted - as_;
  if (Math.abs(diff) < 0.01) return 'no_decision';
  return diff > 0 ? homeTeam : awayTeam;
}

export function evaluatePick(pick, game) {
  if (!game) return PICK_RESULT.PENDING;
  if (game.status===GAME_STATUS.SCHEDULED) return PICK_RESULT.PENDING;
  if (game.status===GAME_STATUS.LIVE)      return PICK_RESULT.LIVE;
  const atsWinner = game.atsWinner ?? calculateAtsWinner(game);
  if (!atsWinner) return PICK_RESULT.PENDING;
  if (atsWinner==='no_decision') return PICK_RESULT.NO_DECISION;
  return atsWinner===pick.selectedTeam ? PICK_RESULT.WIN : PICK_RESULT.LOSS;
}

export function pointsForResult(result) {
  return result===PICK_RESULT.WIN ? 1 : 0;
}

/**
 * Read a game's scoring multiplier. Defaults to 1 (no-op) so pre-multiplier
 * data continues to behave identically. Any non-finite/negative value is
 * defensively coerced to 1 so a bad edit can't poison standings.
 */
export function gameMultiplier(game) {
  const m = Number(game?.multiplier);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return m;
}

/**
 * The ranking tail shared by `calculateWeeklyResults()` and
 * `calculateGroupWeeklyResults()` (UN-118/UN-125). Sorts `rows` by
 * correctPicks desc, tiebreakerDelta asc (nulls last), assigns `rank`, and —
 * only when `anyFinal` is true and there's more than one row — sets
 * isWinner/isLoser/wonByTiebreaker on the first/last row after sorting.
 *
 * Mutates and returns `rows` (same contract `calculateWeeklyResults()` always
 * had: it built `results` via `.map()` then sorted/annotated those SAME
 * objects in place). Extracted verbatim — zero behaviour change — so a
 * single-week caller passing its own `games.some(FINAL)` reproduces today's
 * results exactly, and a pooled-group caller can reuse the identical
 * winner/loser logic on POOLED totals instead of re-deriving it.
 */
export function rankWeeklyResults(rows, anyFinal) {
  rows.sort((a,b)=>{
    const d=b.correctPicks-a.correctPicks; if(d!==0) return d;
    if(a.tiebreakerDelta===null&&b.tiebreakerDelta===null) return 0;
    if(a.tiebreakerDelta===null) return 1;
    if(b.tiebreakerDelta===null) return -1;
    return a.tiebreakerDelta-b.tiebreakerDelta;
  });

  rows.forEach((r,i)=>{ r.rank=i+1; });
  if(anyFinal&&rows.length>1){
    rows[0].isWinner=true;
    if(rows[1]&&rows[0].correctPicks===rows[1].correctPicks) rows[0].wonByTiebreaker=true;
    rows[rows.length-1].isLoser=true;
    const last=rows[rows.length-1];
    const sl=rows[rows.length-2];
    if(sl&&last.correctPicks===sl.correctPicks) last.wonByTiebreaker=true;
  }
  return rows;
}

export function calculateWeeklyResults(weekId, players, picks, games, actualTiebreaker=null) {
  const results = players.map(player => {
    const pp = picks.filter(p=>p.weekId===weekId&&p.playerId===player.playerId);
    // Two parallel tallies:
    //   correctPicks / incorrectPicks  — WEIGHTED (respects game.multiplier)
    //   correctCount / incorrectCount  — RAW (unweighted counts, for math-audit)
    // Weighted values drive rankings and standings so multiplier games actually
    // "matter more". Raw counts stay available for CSV export + the season
    // audit tooling so a 2x game doesn't look like a math error.
    let correct=0, incorrect=0, correctCount=0, incorrectCount=0, noDecisions=0, pending=0;
    for (const pick of pp) {
      const game=games.find(g=>g.gameId===pick.gameId);
      if(!game) continue;
      const r=evaluatePick(pick,game);
      const mult = gameMultiplier(game);
      if(r===PICK_RESULT.WIN)            { correct += mult;   correctCount++; }
      else if(r===PICK_RESULT.LOSS)      { incorrect += mult; incorrectCount++; }
      else if(r===PICK_RESULT.NO_DECISION) noDecisions++;
      else pending++;
    }
    const tbGuess = getTiebreakerGuess(weekId, player.playerId);
    // Tiebreaker is a raw numeric guess and MUST NOT be scaled by any multiplier
    // (it's used only to break ties in the standings, not as a scoring input).
    const tbDelta = (actualTiebreaker!==null&&tbGuess!==null) ? Math.abs(tbGuess-actualTiebreaker) : null;
    return {
      resultId:`wr_${weekId}_${player.playerId}`,
      weekId, playerId:player.playerId, displayName:player.displayName,
      correctPicks:correct, incorrectPicks:incorrect,
      correctCount, incorrectCount,
      noDecisions, pending,
      tiebreakerGuess:tbGuess, tiebreakerDelta:tbDelta,
      rank:0, isWinner:false, isLoser:false, wonByTiebreaker:false,
    };
  });

  const anyFinal=games.some(g=>g.status===GAME_STATUS.FINAL);
  return rankWeeklyResults(results, anyFinal);
}

/**
 * UN-118/UN-125 — the POOLED equivalent of `calculateWeeklyResults()` for a
 * multi-part competitive week (`groupWeeks.length > 1`). Pools raw picks and
 * games across every member week, runs the identical per-game weighted/raw
 * tally loop, then calls `rankWeeklyResults()` ONCE on the pooled totals —
 * so rank/isWinner/isLoser/wonByTiebreaker are computed exactly once at the
 * GROUP level, never derived by combining two independent per-part rankings.
 *
 * correctPicks/incorrectPicks/correctCount/incorrectCount are additive, so
 * pooling raw picks and summing per-part totals are mathematically
 * identical — what is NOT additive is rank/isWinner/isLoser, which is why
 * this function exists rather than a simple sum of two
 * `calculateWeeklyResults()` calls.
 *
 * The tiebreaker resolves through the ONE group member returned by
 * `getGroupTiebreakerWeek()` — every OTHER member's tiebreaker guess for
 * their own week's (different) tiebreaker question is ignored entirely, by
 * construction, since `getTiebreakerGuess()` is only ever called for that one
 * week's id. No storage schema change: this reads the exact same
 * `cfbp_tb_guesses` accessor every singleton week already uses.
 *
 * `weekId` on each returned row is the group's canonical id
 * (`getEffectiveGroupId`) — a real, resolvable weekId, so callers (obligation
 * creation, CSV export, Weekly History) don't need a second concept of "group
 * key" vs "week key."
 */
export function calculateGroupWeeklyResults(groupWeeks, players, allPicks, allGames) {
  const weeks = groupWeeks || [];
  const gid = weeks.length ? getEffectiveGroupId(weeks[0]) : null;
  const memberWeekIds = new Set(weeks.map(w=>w.weekId));
  const tbWeek = getGroupTiebreakerWeek(weeks);
  const actualTiebreaker = tbWeek ? (tbWeek.actualTiebreakerValue ?? null) : null;

  const results = (players||[]).map(player => {
    const pp = (allPicks||[]).filter(p=>memberWeekIds.has(p.weekId)&&p.playerId===player.playerId);
    let correct=0, incorrect=0, correctCount=0, incorrectCount=0, noDecisions=0, pending=0;
    for (const pick of pp) {
      const game=(allGames||[]).find(g=>g.gameId===pick.gameId);
      if(!game) continue;
      const r=evaluatePick(pick,game);
      const mult = gameMultiplier(game);
      if(r===PICK_RESULT.WIN)            { correct += mult;   correctCount++; }
      else if(r===PICK_RESULT.LOSS)      { incorrect += mult; incorrectCount++; }
      else if(r===PICK_RESULT.NO_DECISION) noDecisions++;
      else pending++;
    }
    const tbGuess = tbWeek ? getTiebreakerGuess(tbWeek.weekId, player.playerId) : null;
    const tbDelta = (actualTiebreaker!==null&&tbGuess!==null) ? Math.abs(tbGuess-actualTiebreaker) : null;
    return {
      resultId:`wr_${gid}_${player.playerId}`,
      weekId: gid, playerId:player.playerId, displayName:player.displayName,
      correctPicks:correct, incorrectPicks:incorrect,
      correctCount, incorrectCount,
      noDecisions, pending,
      tiebreakerGuess:tbGuess, tiebreakerDelta:tbDelta,
      rank:0, isWinner:false, isLoser:false, wonByTiebreaker:false,
    };
  });

  const anyFinal=(allGames||[]).some(g=>memberWeekIds.has(g.weekId)&&g.status===GAME_STATUS.FINAL);
  return rankWeeklyResults(results, anyFinal);
}

export function calculateAlmaMaterTotal(games, almaMaters, calcMode='selectedSlateOnly') {
  const ag=games.filter(g=>{
    const isAlma = !!(getAlmaMaterMatch(g.homeTeam) || getAlmaMaterMatch(g.awayTeam));
    return calcMode==='selectedSlateOnly'?g.isAlmaMaterGame&&isAlma:isAlma;
  });
  if(!ag.length) return null;
  const fg=ag.filter(g=>g.status===GAME_STATUS.FINAL&&g.homeScore!==null);
  if(!fg.length) return null;
  let total=0;
  for(const g of fg){
    const hA=almaMaters.some(am=>g.homeTeam.toLowerCase().includes(am.toLowerCase()));
    const aA=almaMaters.some(am=>g.awayTeam.toLowerCase().includes(am.toLowerCase()));
    if(hA) total+=g.homeScore||0;
    if(aA) total+=g.awayScore||0;
  }
  return total;
}

/**
 * UN-118/UN-125 — `weeks` is OPTIONAL and OFF by default. Omitting it
 * reproduces today's behaviour exactly (fails safe): every weekly-result row
 * counts its own isWinner/isLoser toward weeklyWins/weeklyLosses, which is
 * what double-counts a split week into two winners. Callers that have NOT
 * been updated for grouping keep working unmodified.
 *
 * When `weeks` IS supplied, any weekly-result row whose week record belongs
 * to a >1-member group is pulled OUT of the per-row tally and replaced by a
 * single pooled result per group, computed the same way
 * `calculateGroupWeeklyResults()` does — but from the ALREADY-COMPUTED
 * per-part rows in `allWeeklyResults` (this function never sees raw
 * picks/games), which is valid because correctPicks is additive across
 * parts. A group only contributes a win/loss once EVERY member is actually
 * present in `allWeeklyResults` (i.e. finalized) — mirrors finalizeWeek()'s
 * own "not every member final ⇒ no obligation yet" gate (DI-126d), applied
 * here to the win/loss tally instead of the obligation.
 */
export function calculateSeasonStandings(players, allWeeklyResults, weeks=null) {
  const weekById = weeks ? new Map(weeks.map(w=>[w.weekId,w])) : null;

  // Map<playerId, {wins,losses}> — populated once, up front, from every
  // >1-member group whose members are ALL represented in allWeeklyResults.
  let groupWinLoss = null;
  if (weekById) {
    const resultWeekIds = new Set(allWeeklyResults.map(r=>r.weekId));
    const seenGroups = new Set();
    groupWinLoss = new Map(players.map(p=>[p.playerId,{wins:0,losses:0}]));
    for (const weekId of resultWeekIds) {
      const w = weekById.get(weekId);
      if (!w) continue; // result row for a week not in `weeks` — leave it to the per-row path
      const gid = getEffectiveGroupId(w);
      if (seenGroups.has(gid)) continue;
      seenGroups.add(gid);
      const memberWeeks = weeksInGroup(weeks, w);
      if (memberWeeks.length <= 1) continue; // singleton — unaffected, per-row path handles it
      if (!memberWeeks.every(m => resultWeekIds.has(m.weekId))) continue; // not every member final yet
      const tbWeek = getGroupTiebreakerWeek(memberWeeks);
      const pooled = players.map(player => {
        const rows = memberWeeks
          .map(m => allWeeklyResults.find(r=>r.weekId===m.weekId&&r.playerId===player.playerId))
          .filter(Boolean);
        const correctPicks = rows.reduce((s,r)=>s+(r.correctPicks||0),0);
        const tbRow = tbWeek ? rows.find(r=>r.weekId===tbWeek.weekId) : null;
        return {
          playerId: player.playerId, correctPicks,
          tiebreakerDelta: tbRow ? (tbRow.tiebreakerDelta ?? null) : null,
          rank:0, isWinner:false, isLoser:false, wonByTiebreaker:false,
        };
      });
      rankWeeklyResults(pooled, true);
      const gWinner = pooled.find(r=>r.isWinner);
      const gLoser  = pooled.find(r=>r.isLoser);
      if (gWinner) groupWinLoss.get(gWinner.playerId).wins++;
      if (gLoser)  groupWinLoss.get(gLoser.playerId).losses++;
    }
  }

  const standings=players.map(player=>{
    const pr=allWeeklyResults.filter(r=>r.playerId===player.playerId);
    // WEIGHTED totals drive ranking. These are the numbers players compare on.
    // Additive across group members by construction — grouping never changes
    // a season total, only how many DISCRETE weekly wins/losses it produced.
    const totalCorrect=pr.reduce((s,r)=>s+(r.correctPicks||0),0);
    const totalIncorrect=pr.reduce((s,r)=>s+(r.incorrectPicks||0),0);
    // RAW counts preserved for the season audit tooling. They fall back to the
    // weighted values when older weekly results (pre-multiplier) don't carry
    // the count fields — safe default because no multipliers existed then.
    const totalCorrectCount=pr.reduce((s,r)=>s+(r.correctCount ?? r.correctPicks ?? 0),0);
    const totalIncorrectCount=pr.reduce((s,r)=>s+(r.incorrectCount ?? r.incorrectPicks ?? 0),0);
    const totalND=pr.reduce((s,r)=>s+(r.noDecisions||0),0);
    let weeklyWins, weeklyLosses;
    if (weekById) {
      const soloRows = pr.filter(r => {
        const w = weekById.get(r.weekId);
        if (!w) return true; // unknown week record — fall back to the old per-row behaviour for this row
        return weeksInGroup(weeks, w).length <= 1;
      });
      const g = groupWinLoss.get(player.playerId) || {wins:0,losses:0};
      weeklyWins = soloRows.filter(r=>r.isWinner).length + g.wins;
      weeklyLosses = soloRows.filter(r=>r.isLoser).length + g.losses;
    } else {
      weeklyWins=pr.filter(r=>r.isWinner).length;
      weeklyLosses=pr.filter(r=>r.isLoser).length;
    }
    const totalGames=totalCorrectCount+totalIncorrectCount+totalND;
    // Win % uses raw counts — otherwise a 2x game skews the ratio in a
    // misleading way ("83% win rate" when they got 5 of 6 raw games right
    // but the 6th was a 2x loss).
    const winPct=totalGames>0?Math.round((totalCorrectCount/totalGames)*1000)/10:0;
    return{
      playerId:player.playerId, displayName:player.displayName,
      totalCorrect, totalIncorrect,
      totalCorrectCount, totalIncorrectCount,
      totalND, weeklyWins, weeklyLosses, winPct,
      currentRank:0, isSeasonLeader:false, isCurrentLastPlace:false,
    };
  });
  standings.sort((a,b)=>b.totalCorrect-a.totalCorrect||b.winPct-a.winPct);
  standings.forEach((s,i)=>{s.currentRank=i+1;});
  if(standings.length>1){standings[0].isSeasonLeader=true;standings[standings.length-1].isCurrentLastPlace=true;}
  return standings;
}

export function getPickStatusLabel(result) {
  return{win:'✅ Correct',loss:'❌ Wrong',no_decision:'— No Decision',live:'🔴 Live',pending:'⏳ Pending'}[result]||'—';
}
export function getPickStatusClass(result) {
  return{win:'result-win',loss:'result-loss',no_decision:'result-nd',live:'result-live'}[result]||'result-pending';
}
