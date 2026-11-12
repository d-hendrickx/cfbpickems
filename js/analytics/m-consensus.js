/**
 * CFB Pickems - js/analytics/m-consensus.js (D2 lane 4; DI-955 "Consensus and social"; UN/PF-519, 520; 2026-10-19)
 * ==================================================================================================================
 * For a graded game with `n` ENTRANT picks (non-entrants were dropped by buildInput): the MAJORITY side is the side whose count
 * is STRICTLY greater; equal counts make the game `split`, which sits in no consensus rate (and is reported as a count).
 *
 * Reveal: aggregates (rate, with/against, accuracy, contrarian leader) are final-week. The single-game moments (unanimous,
 * lone-correct, league miss, polarizing) are `public-game`: a game's own facts may appear the minute it is final, but only
 * when its week is public. A final game inside an OPEN week yields nothing (RG-45): buildInput never admits that week.
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL } from './registry.js';
import { viewOf } from './input.js';
import { graded, wins, losses, supportOfPicks, gameFact } from './slice.js';
import { loneWolfWinner } from '../stats-core.js';
import { calculateAtsWinner } from '../scoring.js';

const FW = REVEAL.FINAL_WEEK, PG = REVEAL.PUBLIC_GAME;
const memo = new WeakMap();

/** Per graded game (not a push, ATS result known): the entrant split. */
export function gameSplits(slice) {
  if (memo.has(slice)) return memo.get(slice);
  const out = new Map();
  for (const g of slice.games) {
    if (g.status !== 'final' || (g.atsSide !== 'home' && g.atsSide !== 'away')) continue;
    const ps = slice.picksByGame.get(g.gameId) || [];
    const home = ps.filter((p) => p.side === 'home').length, away = ps.filter((p) => p.side === 'away').length;
    const n = home + away;
    if (n === 0) continue;
    const majority = home > away ? 'home' : away > home ? 'away' : null;
    const minority = Math.min(home, away);
    out.set(g.gameId, { game: g, picks: ps, n, home, away, majority, split: majority === null, minority, minorityShare: minority / n, unanimous: minority === 0, atsSide: g.atsSide });
  }
  memo.set(slice, out);
  return out;
}

export function memberGames(slice, memberId) {
  const gs = gameSplits(slice);
  const rows = [];
  for (const p of slice.picksByMember.get(memberId) || []) {
    const s = gs.get(p.gameId);
    if (!s) continue;
    rows.push({ p, s, with: s.majority === null || p.side === null ? null : s.majority === p.side });
  }
  return rows;
}

export const CONS_RATE = register({
  id: 'cons.rate', v: 1, family: 'consensus', reveal: FW, level: 'member', minKey: 'consGames',
  run(slice, { memberId }) {
    const def = CONS_RATE;
    const subject = { kind: 'member', id: memberId };
    if (slice.memberIds.length < minOf('consEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: slice.memberIds.length, min: minOf('consEntrants') });
    const rows = memberGames(slice, memberId);
    const decided = rows.filter((r) => r.with !== null);
    const min = minOf('consGames');
    if (decided.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: decided.length, min });
    const w = decided.filter((r) => r.with).length;
    return makeMetric({
      def, slice, subject, n: decided.length, num: w, den: decided.length,
      value: { with: w, against: decided.length - w, rate: ratio(w, decided.length), contrarianRate: ratio(decided.length - w, decided.length), split: rows.length - decided.length },
      supportRows: supportOfPicks(decided.map((r) => r.p)),
    });
  },
});

export const CONS_WITH_AGAINST = register({
  id: 'cons.with_against', v: 1, family: 'consensus', reveal: FW, level: 'member', minKey: 'bucket',
  run(slice, { memberId }) {
    const def = CONS_WITH_AGAINST;
    const subject = { kind: 'member', id: memberId };
    if (slice.memberIds.length < minOf('consEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: slice.memberIds.length, min: minOf('consEntrants') });
    const decided = memberGames(slice, memberId).filter((r) => r.with !== null);
    const withP = decided.filter((r) => r.with).map((r) => r.p), againstP = decided.filter((r) => !r.with).map((r) => r.p);
    const min = minOf('withAgainst');                      // "compare only when each side has at least 5"
    if (withP.length < min || againstP.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: Math.min(withP.length, againstP.length), min });
    return makeMetric({
      def, slice, subject, n: decided.length,
      value: { with: { n: withP.length, w: wins(withP), l: losses(withP) }, against: { n: againstP.length, w: wins(againstP), l: losses(againstP) } },
      supportRows: supportOfPicks(decided.map((r) => r.p)),
    });
  },
});

export const CONS_UNANIMOUS = register({
  id: 'cons.unanimous', v: 1, family: 'consensus', reveal: PG, level: 'league', minKey: 'unanimousEntrants',
  run(slice) {
    const def = CONS_UNANIMOUS;
    const subject = { kind: 'league', id: slice.leagueId };
    const min = minOf('unanimousEntrants');
    const moments = Array.from(gameSplits(slice).values()).filter((s) => s.n >= min && s.unanimous);
    if (!moments.length) return unavailable({ def, slice, subject, reason: 'thin', n: 0, min });
    const covered = moments.filter((s) => (s.home > 0 ? 'home' : 'away') === s.atsSide).length;
    const sorted = [...moments].sort((a, b) => (a.game.kickoffMs ?? 0) - (b.game.kickoffMs ?? 0) || (a.game.gameId < b.game.gameId ? -1 : 1));
    return makeMetric({
      def, slice, subject, n: moments.length, num: covered, den: moments.length,
      value: { count: moments.length, covered, rate: moments.length >= 3 ? ratio(covered, moments.length) : null, games: sorted.map((s) => s.game.gameId).slice(0, 24) },
      supportRows: sorted.map((s) => ({ gameId: s.game.gameId, weekId: s.game.weekId, k: s.game.kickoffMs })),
    });
  },
});

export const CONS_LONE_CORRECT = register({
  id: 'cons.lone_correct', v: 1, family: 'consensus', reveal: PG, level: 'game', minKey: 'consEntrants',
  enumerate(slice) { return Array.from(gameSplits(slice).keys()).map((gameId) => ({ gameId })); },
  run(slice, { gameId }) {
    const def = CONS_LONE_CORRECT;
    const s = gameSplits(slice).get(gameId);
    const subject = { kind: 'game', id: gameId };
    if (!s || s.n < minOf('consEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: s ? s.n : 0, min: minOf('consEntrants') });
    // the SHIPPED function (stats-core), over the revealed raw game and the entrants' raw picks
    const view = viewOf(slice.input);
    const raw = view.rawGameById.get(String(gameId));
    const lone = loneWolfWinner(raw, view.rawPicksByGame.get(String(gameId)) || [], { calculateAtsWinner });
    if (!lone) return unavailable({ def, slice, subject, reason: 'thin', n: s.n, min: minOf('consEntrants') });
    const pick = s.picks.find((p) => p.memberId === String(lone.playerId));
    return makeMetric({
      def, slice, subject, n: s.n, value: { memberId: String(lone.playerId), team: lone.team, against: lone.against, weekId: s.game.weekId },
      supportRows: pick ? supportOfPicks([pick]) : [{ gameId, weekId: s.game.weekId, k: s.game.kickoffMs }], ...gameFact(slice, s.game),
    });
  },
});

export const CONS_LEAGUE_MISS = register({
  id: 'cons.league_miss', v: 1, family: 'consensus', reveal: PG, level: 'game', minKey: 'unanimousEntrants',
  enumerate(slice) { return Array.from(gameSplits(slice).keys()).map((gameId) => ({ gameId })); },
  run(slice, { gameId }) {
    const def = CONS_LEAGUE_MISS;
    const s = gameSplits(slice).get(gameId);
    const subject = { kind: 'game', id: gameId };
    const min = minOf('unanimousEntrants');
    if (!s || s.n < min) return unavailable({ def, slice, subject, reason: 'thin', n: s ? s.n : 0, min });
    // a push never gets here (gameSplits keeps only home/away ATS results); every entrant lost = all on the side that did not cover
    const allLost = s.picks.every((p) => p.result === 'loss');
    if (!allLost) return unavailable({ def, slice, subject, reason: 'thin', n: s.n, min });
    return makeMetric({ def, slice, subject, n: s.n, value: { n: s.n, weekId: s.game.weekId }, supportRows: supportOfPicks(s.picks), ...gameFact(slice, s.game) });
  },
});

/** Games ordered "most polarizing first": minority share desc, then multiplier desc, then kickoff asc, then game id. */
export function polarizingOrder(slice) {
  return Array.from(gameSplits(slice).values())
    .filter((s) => s.n >= minOf('unanimousEntrants') && s.minorityShare >= 0.40)
    .sort((a, b) => (b.minorityShare - a.minorityShare) || (b.game.multiplier - a.game.multiplier) || ((a.game.kickoffMs ?? 0) - (b.game.kickoffMs ?? 0)) || (a.game.gameId < b.game.gameId ? -1 : a.game.gameId > b.game.gameId ? 1 : 0));
}

export const CONS_POLARIZING = register({
  id: 'cons.polarizing', v: 1, family: 'consensus', reveal: PG, level: 'league', minKey: 'unanimousEntrants',
  run(slice) {
    const def = CONS_POLARIZING;
    const subject = { kind: 'league', id: slice.leagueId };
    const order = polarizingOrder(slice);
    if (!order.length) return unavailable({ def, slice, subject, reason: 'thin', n: 0, min: minOf('unanimousEntrants') });
    const top = order[0];
    return makeMetric({
      def, slice, subject: { kind: 'game', id: top.game.gameId }, n: top.n, num: top.minority, den: top.n,
      value: { gameId: top.game.gameId, minorityShare: ratio(top.minority, top.n), split: [Math.max(top.home, top.away), top.minority], multiplier: top.game.multiplier, ranked: order.slice(0, 3).map((s) => s.game.gameId) },
      supportRows: supportOfPicks(top.picks), ...gameFact(slice, top.game),
    });
  },
});

export const CONS_ACCURACY = register({
  id: 'cons.accuracy', v: 1, family: 'consensus', reveal: FW, level: 'league', minKey: 'lgAccuracyGames',
  run(slice) {
    const def = CONS_ACCURACY;
    const subject = { kind: 'league', id: slice.leagueId };
    const withMajority = Array.from(gameSplits(slice).values()).filter((s) => s.majority !== null);
    const min = minOf('lgAccuracyGames');
    if (withMajority.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: withMajority.length, min });
    const hit = withMajority.filter((s) => s.majority === s.atsSide).length;
    return makeMetric({ def, slice, subject, n: withMajority.length, num: hit, den: withMajority.length, value: { accuracy: ratio(hit, withMajority.length) }, supportRows: withMajority.map((s) => ({ gameId: s.game.gameId, weekId: s.game.weekId, k: s.game.kickoffMs })) });
  },
});

export const CONS_CONTRARIAN_LEADER = register({
  id: 'cons.contrarian_leader', v: 1, family: 'consensus', reveal: FW, level: 'league', minKey: 'consGames',
  run(slice) {
    const def = CONS_CONTRARIAN_LEADER;
    const subject = { kind: 'league', id: slice.leagueId };
    const min = minOf('consGames');
    const rates = [];
    for (const id of slice.memberIds) {
      const decided = memberGames(slice, id).filter((r) => r.with !== null);
      if (decided.length >= min) rates.push({ id, against: decided.length - decided.filter((r) => r.with).length, n: decided.length });
    }
    if (rates.length < minOf('consEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: rates.length, min: minOf('consEntrants') });
    rates.sort((a, b) => (b.against * a.n - a.against * b.n) || (a.id < b.id ? -1 : 1));       // compare as fractions, no float
    const top = rates[0], next = rates[1];
    if (top.against * next.n === next.against * top.n) return unavailable({ def, slice, subject, reason: 'tie', n: rates.length, min });
    return makeMetric({ def, slice, subject: { kind: 'member', id: top.id }, n: top.n, num: top.against, den: top.n, value: { memberId: top.id, contrarianRate: ratio(top.against, top.n) }, supportRows: [] });
  },
});
