/**
 * CFB Pickems - js/analytics/m-gameday.js (D2 lane 4; DI-974..977 "Sparse live Game Day intelligence", DI-999 `peekFacts`; UN/PF-523; 2026-10-19)
 * ======================================================================================================================================================
 * Seven fact kinds exist: gd.consequence (standings if the result holds), gd.swing, gd.only_backer, gd.disagreement, gd.path_to_win, gd.milestone, and (batch 2, DI-1087) gd.followed_team.
 * ALL are `public-game` class: computed from the revealed picks of a PUBLIC week and the live or final scores of that league's own games. Nothing
 * is shown for an open, locked, demo or draft week, for an archived competition, or for a viewer who is not an entrant (their own consequence).
 *
 * THE STANDINGS CONSEQUENCE (DI-975), computed with the SAME standings logic: "hold" means every LIVE game of the week is treated as final at its
 * current score against its locked line; final games are final; scheduled games stay pending and contribute nothing. A live game with no usable line
 * or score is UNPROJECTED and listed as such. The week tally is `tallyWeek` (tally.js: the imported scoring primitives + the parity-guarded loop),
 * the ranks come from the IMPORTED `calculateSeasonStandings`; `calculateWeeklyResults` is never called (it would paint the active league's
 * tiebreaker guesses onto a peeked league). TIES ARE NEVER RESOLVED BY A TIEBREAKER: a member whose projected total equals another's gets
 * `tied: true` and reads "tied for {ordinal}" (the tied group's best position); no order is claimed, no tiebreaker is read, none is multiplied.
 *
 * FRESHNESS (lane B DI-817): a live game whose `lastUpdated` is more than 3 minutes old (or unknown) makes the week's projection UNKNOWN, so no
 * consequence is emitted ("unknown beats wrong"). Live language is tentative (covering / trailing, never "won" / "lost"); settled language only
 * for a final game. No probability, no prediction, no signed number: margins are Favorite-plus-Margin words, a non-negative count.
 */
import { REVEAL } from './registry.js';
import { assertEligible, buildInput } from './input.js';
import { tallyWeek, standingsOf } from './tally.js';
import { projectedResult } from './records.js';
import { MILESTONE_MARKS } from '../stats-core.js';
import { normTeam } from '../team-match.js';
import { teamSummary } from './m-teams.js';

export const STALE_MS = 3 * 60 * 1000;
/** DI-974 ranking points inside a game (integers; ties by kickoff then fact id). */
export const GD_POINTS = Object.freeze({ consequence: 50, path_to_win: 45, only_backer_viewer: 40, only_backer_other: 30, disagreement: 35, milestone: 20, swing: 25, followed_team: 15 });
export const GD_LIMITS = Object.freeze({ summaryFacts: 1, cardClauses: 1, sheetVisible: 2, sheetMax: 6 });

const memo = new WeakMap();

function ctxOf(input) {
  assertEligible(input, { cls: REVEAL.PUBLIC_GAME });
  let c = memo.get(input);
  if (!c) { c = new Map(); memo.set(input, c); }
  return c;
}

/** the public weeks with at least one game that is not final (the live slate), grouped, with their picks and entrants */
function liveWeeks(input) {
  const proj = input.projection;
  const out = [];
  for (const w of proj.weeks) {
    if (w.status !== 'live' || w.archived) continue;
    const games = proj.games.filter((g) => g.weekId === w.weekId);
    if (!games.some((g) => g.status === 'live')) continue;
    out.push({ week: w, games, picks: proj.picks.filter((p) => p.weekId === w.weekId) });
  }
  return out;
}

/** rows for a week: final-only, and with live games projected. Picks of non-final games carry result null; projection fills it. */
function weekTallies(week, games, picks, roster) {
  const live = new Map(games.filter((g) => g.status === 'live').map((g) => [g.gameId, g]));
  const finalOnly = new Map(), held = new Map();
  for (const id of roster) { finalOnly.set(id, []); held.set(id, []); }
  for (const p of picks) {
    if (!finalOnly.has(p.memberId)) continue;
    const lg = live.get(p.gameId);
    finalOnly.get(p.memberId).push(p);                                              // `result` is null for a non-final game: counts as pending
    held.get(p.memberId).push(lg ? { ...p, result: projectedResult(p.team, lg) } : p);
  }
  const rowsOf = (m) => roster.map((id) => ({ resultId: 'wr_' + week.weekId + '_' + id, weekId: week.weekId, playerId: id, displayName: id, ...tallyWeek(m.get(id)), tiebreakerGuess: null, tiebreakerDelta: null, rank: 0, isWinner: false, isLoser: false, wonByTiebreaker: false }));
  return { from: rowsOf(finalOnly), to: rowsOf(held) };
}

/** best position of a member's tied group by projected total (competition ranking: 1 + the count strictly above), and whether anyone shares the total */
function positionOf(standings, id) {
  const me = standings.find((s) => s.playerId === id);
  if (!me) return null;
  const above = standings.filter((s) => s.totalCorrect > me.totalCorrect).length;
  const equal = standings.filter((s) => s.totalCorrect === me.totalCorrect).length;
  return { rank: above + 1, tied: equal > 1 };
}

const iso = (ms) => new Date(ms).toISOString();

/** the entrants of a public week, as buildInput recorded them (the roster rule of entrants.js) */
function rosterOf(input, weekId) { return (input.projection.rosters && input.projection.rosters[weekId]) || []; }

/**
 * DI-975. One consequence fact for the viewer per live week, or [].
 * @returns {Array<{leagueId, sport, competitionId, weekId, memberId, fromRank, toRank, tied, basis, computedAt, evidence}>}
 */
export function consequenceFacts(input, { viewerMemberId, now }) {
  const c = ctxOf(input);
  const key = 'cons|' + viewerMemberId + '|' + now;
  if (c.has(key)) return c.get(key);
  const out = [];
  for (const { week, games, picks } of liveWeeks(input)) {
    const roster = rosterOf(input, week.weekId);
    if (!viewerMemberId || !roster.includes(viewerMemberId)) continue;            // not an entrant: no consequence of their own
    if (week.groupSize > 1) continue;                                              // a split week group is pooled by the standings only when every part is in: unknown beats wrong
    const live = games.filter((g) => g.status === 'live');
    if (live.some((g) => g.lastUpdatedMs === null || now - g.lastUpdatedMs > STALE_MS)) continue;      // a stale live score makes the projection unknown
    const unprojected = live.filter((g) => !g.projWinner).map((g) => g.gameId);
    if (unprojected.length === live.length) continue;                              // nothing to project
    const { from, to } = weekTallies(week, games, picks, roster);
    const others = input.standingsRows.filter((r) => r.weekId !== week.weekId && input.weeks.some((w) => w.weekId === r.weekId && w.competitionId === week.competitionId && w.season === week.season));
    const players = roster.map((id) => ({ playerId: id, displayName: id }));
    const allWeeks = input.weeks.filter((w) => w.competitionId === week.competitionId);
    const sFrom = standingsOf(players, [...others, ...from], null, null), sTo = standingsOf(players, [...others, ...to], null, null);
    const a = positionOf(sFrom, viewerMemberId), b = positionOf(sTo, viewerMemberId);
    if (!a || !b) continue;
    if (a.rank === b.rank && a.tied === b.tied) continue;                          // emitted only when something moves
    out.push({
      leagueId: input.leagueId, sport: week.sport, competitionId: week.competitionId, weekId: week.weekId, memberId: viewerMemberId,
      fromRank: a.rank, toRank: b.rank, tied: b.tied, basis: 'live-projection', computedAt: iso(now),
      evidence: { liveGameIds: live.map((g) => g.gameId).sort(), unprojectedGameIds: unprojected.sort(), finalGameIds: games.filter((g) => g.status === 'final').map((g) => g.gameId).sort(), pendingCount: games.filter((g) => g.status === 'scheduled').length },
    });
  }
  c.set(key, out);
  return out;
}

/** DI-999 interface 2: `peekFacts(source, { now, viewerMemberId, confirmedStatusFor })`. [] when nothing qualifies; never reads the storage seam; never calls calculateWeeklyResults. */
export function peekFacts(source, { now, viewerMemberId, confirmedStatusFor } = {}) {
  if (!Number.isFinite(now)) return [];
  const input = buildInput(source, { revealClass: REVEAL.PUBLIC_GAME, confirmedStatusFor, now, viewerMemberId });
  return consequenceFacts(input, { viewerMemberId, now });
}

// ---- the other five kinds -----------------------------------------------------------------------------------------

const ordered = (a, b) => (a.points !== b.points ? b.points - a.points : (a.k ?? 0) - (b.k ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** every fact the engine can make for the viewer this minute, unranked: { id, kind, gameId, weekId, points, k, ...data } */
export function gameFacts(input, { viewerMemberId, now }) {
  const c = ctxOf(input);
  const key = 'facts|' + viewerMemberId + '|' + now;
  if (c.has(key)) return c.get(key);
  const out = [];
  const cons = consequenceFacts(input, { viewerMemberId, now });
  for (const { week, games, picks } of liveWeeks(input)) {
    const roster = rosterOf(input, week.weekId);
    const isEntrant = viewerMemberId && roster.includes(viewerMemberId);
    const fresh = (g) => g.status === 'final' || (g.lastUpdatedMs !== null && now - g.lastUpdatedMs <= STALE_MS);
    const kick = (g) => g.kickoffMs ?? 0;
    const byGame = new Map();
    for (const p of picks) { if (!byGame.has(p.gameId)) byGame.set(p.gameId, []); byGame.get(p.gameId).push(p); }
    const { from, to } = weekTallies(week, games, picks, roster);

    // gd.consequence: attached to each live game where the viewer holds a pick
    for (const f of cons.filter((x) => x.weekId === week.weekId)) {
      for (const g of games.filter((x) => x.status === 'live' && (byGame.get(x.gameId) || []).some((p) => p.memberId === viewerMemberId))) {
        out.push({ id: 'gd.consequence|' + g.gameId, kind: 'gd.consequence', gameId: g.gameId, weekId: week.weekId, points: GD_POINTS.consequence, k: kick(g), fromRank: f.fromRank, toRank: f.toRank, tied: f.tied });
      }
    }
    // gd.only_backer: >= 4 entrants, exactly one on one side and at least two on the other
    for (const g of games.filter((x) => x.status !== 'scheduled' && fresh(x))) {
      const ps = byGame.get(g.gameId) || [];
      if (roster.length < 4) continue;
      const h = ps.filter((p) => p.side === 'home'), a = ps.filter((p) => p.side === 'away');
      const lone = h.length === 1 && a.length >= 2 ? h[0] : a.length === 1 && h.length >= 2 ? a[0] : null;
      if (!lone) continue;
      const state = g.status === 'final' ? (lone.result === 'win' ? 'final_win' : lone.result === 'loss' ? 'final_loss' : 'final_push') : (!g.projWinner ? 'unknown' : g.projWinner === 'no_decision' ? 'push' : g.projWinner === lone.team ? 'covering' : 'trailing');
      out.push({ id: 'gd.only_backer|' + g.gameId, kind: 'gd.only_backer', gameId: g.gameId, weekId: week.weekId, points: lone.memberId === viewerMemberId ? GD_POINTS.only_backer_viewer : GD_POINTS.only_backer_other, k: kick(g), memberId: lone.memberId, team: lone.team, state, by: g.status === 'live' && (state === 'covering' || state === 'trailing') ? g.projMargin : null });
    }
    if (isEntrant) {
      const totalNow = new Map(from.map((r) => [r.playerId, r.correctPicks])), totalHeld = new Map(to.map((r) => [r.playerId, r.correctPicks]));
      // gd.disagreement: opposite sides of g, and g alone changes who is ahead
      for (const g of games.filter((x) => x.status === 'live' && x.projWinner && fresh(x))) {
        const mine = (byGame.get(g.gameId) || []).find((p) => p.memberId === viewerMemberId);
        if (!mine) continue;
        for (const other of (byGame.get(g.gameId) || []).filter((p) => p.memberId !== viewerMemberId && p.side !== null && mine.side !== null && p.side !== mine.side).sort((x, y) => (x.memberId < y.memberId ? -1 : 1))) {
          const gain = (p) => { const r = projectedResult(p.team, g); return r === 'win' ? p.multiplier : 0; };
          const nowDiff = totalNow.get(viewerMemberId) - totalNow.get(other.memberId);
          const withG = (totalNow.get(viewerMemberId) + gain(mine)) - (totalNow.get(other.memberId) + gain(other));
          if (Math.sign(nowDiff) !== Math.sign(withG)) { out.push({ id: 'gd.disagreement|' + g.gameId + '|' + other.memberId, kind: 'gd.disagreement', gameId: g.gameId, weekId: week.weekId, points: GD_POINTS.disagreement, k: kick(g), memberId: other.memberId }); break; }
        }
      }
      // gd.path_to_win: arithmetic only, no probability
      const settled = totalNow;
      const remaining = new Map(roster.map((id) => [id, { n: 0, w: 0 }]));
      for (const p of picks) { const g = games.find((x) => x.gameId === p.gameId); if (g && g.status !== 'final' && remaining.has(p.memberId)) { remaining.get(p.memberId).n++; remaining.get(p.memberId).w += p.multiplier; } }
      if (Array.from(remaining.values()).some((r) => r.n > 0)) {
        const mineNow = settled.get(viewerMemberId), rem = remaining.get(viewerMemberId);
        const rivals = roster.filter((id) => id !== viewerMemberId);
        if (rivals.length) {
          const leaderTotal = Math.max(...roster.map((id) => settled.get(id)));
          const bestRival = Math.max(...rivals.map((id) => settled.get(id) + remaining.get(id).w));
          let state, d;
          if (mineNow > bestRival) { state = 'clinched'; d = 0; }
          else if (mineNow + rem.w < leaderTotal) { state = 'out'; d = leaderTotal - mineNow; }
          else if (mineNow === leaderTotal) { d = Math.max(0, mineNow - Math.max(...rivals.map((id) => settled.get(id)))); state = d > 0 ? 'leading' : 'level'; }
          else { state = 'behind'; d = leaderTotal - mineNow; }
          const leaders = roster.filter((id) => settled.get(id) === leaderTotal);
          const firstLive = games.filter((x) => x.status === 'live' && fresh(x)).sort((x, y) => kick(x) - kick(y) || (x.gameId < y.gameId ? -1 : 1))[0];
          if (firstLive) out.push({ id: 'gd.path_to_win|' + week.weekId, kind: 'gd.path_to_win', gameId: firstLive.gameId, weekId: week.weekId, points: GD_POINTS.path_to_win, k: kick(firstLive), state, d, rem: rem.n, leaderId: leaders.length === 1 ? leaders[0] : null });
        }
      }
      // gd.swing: the live game worth the most places to the viewer (flip vs hold), at least 1
      let bestSwing = null;
      const heldStandings = standingsOf(roster.map((id) => ({ playerId: id, displayName: id })), [...input.standingsRows.filter((r) => r.weekId !== week.weekId && input.weeks.some((w) => w.weekId === r.weekId && w.competitionId === week.competitionId && w.season === week.season)), ...to], null, null);
      const holdPos = positionOf(heldStandings, viewerMemberId);
      for (const g of games.filter((x) => x.status === 'live' && x.projWinner && x.projWinner !== 'no_decision' && fresh(x)).sort((x, y) => kick(x) - kick(y) || (x.gameId < y.gameId ? -1 : 1))) {
        const flipped = { ...g, projWinner: g.projWinner === g.home ? g.away : g.home };
        const toFlip = new Map();
        for (const id of roster) toFlip.set(id, []);
        for (const p of picks) { const lg = p.gameId === g.gameId ? flipped : games.find((x) => x.gameId === p.gameId && x.status === 'live'); toFlip.get(p.memberId)?.push(lg ? { ...p, result: projectedResult(p.team, lg) } : p); }
        const rows = roster.map((id) => ({ resultId: 'x', weekId: week.weekId, playerId: id, displayName: id, ...tallyWeek(toFlip.get(id)), tiebreakerGuess: null, tiebreakerDelta: null, rank: 0, isWinner: false, isLoser: false, wonByTiebreaker: false }));
        const fl = standingsOf(roster.map((id) => ({ playerId: id, displayName: id })), [...input.standingsRows.filter((r) => r.weekId !== week.weekId && input.weeks.some((w) => w.weekId === r.weekId && w.competitionId === week.competitionId && w.season === week.season)), ...rows], null, null);
        const flipPos = positionOf(fl, viewerMemberId);
        const swing = Math.abs(flipPos.rank - holdPos.rank);
        if (swing >= 1 && (!bestSwing || swing > bestSwing.swing)) bestSwing = { g, swing };
      }
      if (bestSwing) out.push({ id: 'gd.swing|' + bestSwing.g.gameId, kind: 'gd.swing', gameId: bestSwing.g.gameId, weekId: week.weekId, points: GD_POINTS.swing, k: kick(bestSwing.g), places: bestSwing.swing });
    }
    // gd.milestone: a member's season correct-pick count crosses a mark as a game becomes final (raw counts, once per member per mark)
    const priorRaw = new Map();
    for (const r of input.standingsRows) {
      if (r.weekId === week.weekId) continue;
      const w = input.weeks.find((x) => x.weekId === r.weekId);
      if (!w || w.competitionId !== week.competitionId || w.season !== week.season) continue;
      priorRaw.set(r.playerId, (priorRaw.get(r.playerId) || 0) + (r.correctCount ?? r.correctPicks));
    }
    const running = new Map(priorRaw);
    for (const g of games.filter((x) => x.status === 'final').sort((x, y) => kick(x) - kick(y) || (x.gameId < y.gameId ? -1 : 1))) {
      for (const p of (byGame.get(g.gameId) || []).filter((x) => x.result === 'win').sort((x, y) => (x.memberId < y.memberId ? -1 : 1))) {
        const after = (running.get(p.memberId) || 0) + 1;
        running.set(p.memberId, after);
        if (MILESTONE_MARKS.includes(after)) out.push({ id: 'gd.milestone|' + p.memberId + '|' + after, kind: 'gd.milestone', gameId: g.gameId, weekId: week.weekId, points: GD_POINTS.milestone, k: kick(g), memberId: p.memberId, mark: after });
      }
    }
  }
  c.set(key, out);
  return out;
}

/**
 * DI-1087. gd.followed_team: a game on one of the member's league slates TODAY (live or scheduled) with a team the member follows in it gets one context row: "{Team} plays today: {w}-{l}, {form}."
 * PUBLIC TEAM DATA ONLY: it carries no pick and implies none, so it is exempt from the "week must be public" rule (the caller passes the slate's game identities, which are schedule facts the Picks
 * page already shows), but it obeys every other limit: 15 points (below the only-backer), inside the 6-per-game cap, never the inline clause unless the game has nothing else, never in the summary
 * line, never shareable. A stale team row (over 2 days), a dark family, an unfollowed team or too few games gives NO row.
 * @param {{ gameId, weekId, sport, home, away, status, kickoffMs }[]} slateGames  the league's games, schedule fields only (the caller is Game Day, which already holds them)
 */
export function followedTeamFacts(input, { now, slateGames = [] }) {
  assertEligible(input, { cls: REVEAL.PUBLIC_GAME });
  const out = [];
  if (!Number.isFinite(now)) return out;
  const day = (ms) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: input.zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); } catch { return new Date(ms).toISOString().slice(0, 10); } };
  const today = day(now);
  for (const g of Array.isArray(slateGames) ? slateGames : []) {
    if (!g || typeof g.gameId !== 'string' || (g.status !== 'live' && g.status !== 'scheduled') || !Number.isFinite(g.kickoffMs) || day(g.kickoffMs) !== today) continue;
    for (const side of ['home', 'away']) {
      const sum = teamSummary(input, g.sport, normTeam(g[side]), now);
      if (!sum) continue;
      out.push({ id: 'gd.followed_team|' + g.gameId + '|' + sum.teamKey, kind: 'gd.followed_team', gameId: g.gameId, weekId: String(g.weekId ?? ''), sport: g.sport, points: GD_POINTS.followed_team, k: g.kickoffMs,
        teamKey: sum.teamKey, team: sum.team, reason: sum.reason, games: sum.games, w: sum.record.w, l: sum.record.l, t: sum.record.t, otl: sum.record.otl, last: sum.last, runKind: sum.run.kind, run: sum.run.n, streak: sum.run.streak });
    }
  }
  return out;
}

/**
 * The few most useful facts per game (DI-974): the hard limits are summary 1 (consequence only), card clause 1, sheet 2 visible + the rest behind
 * "Show more", 6 at most. Ranked by integer points, ties by kickoff then fact id.
 * @returns {{ summary: object|null, byGame: Map<string, {top: object|null, visible: object[], more: object[], total: number}> }}
 */
export function gameDayInsights(input, { viewerMemberId, now, slateGames = [] }) {
  const facts = [...gameFacts(input, { viewerMemberId, now }), ...followedTeamFacts(input, { now, slateGames })];
  const by = new Map();
  for (const f of facts) { if (!by.has(f.gameId)) by.set(f.gameId, []); by.get(f.gameId).push(f); }
  const byGame = new Map();
  for (const [gameId, list] of by) {
    const ranked = [...list].sort(ordered).slice(0, GD_LIMITS.sheetMax);
    // a followed-team row (15 points) ranks below every other kind (the lowest is 20), so it is the card's inline clause only when the game has nothing else to say
    byGame.set(gameId, { top: ranked[0] || null, visible: ranked.slice(0, GD_LIMITS.sheetVisible), more: ranked.slice(GD_LIMITS.sheetVisible), total: ranked.length });
  }
  const cons = facts.filter((f) => f.kind === 'gd.consequence').sort(ordered)[0] || null;       // the summary line is the consequence only; a followed-team row is never in it
  return { summary: cons, byGame };
}
