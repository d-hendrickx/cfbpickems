/**
 * CFB Pickems - js/analytics/m-strategies.js (D2 lane 4; DI-978..983 "What-if strategies, retrospective only"; UN/PF-524; 2026-10-19)
 * ======================================================================================================================================
 * THE EIGHT STRATEGIES THAT SHIP WITHOUT MONEY (product-liaison section 7: "feasible now, no dollars (8)"):
 *   cf.always_favorite   cf.always_underdog   cf.follow_consensus   cf.fade_consensus   cf.copy_member(Y)
 *   cf.team_record(T)    cf.cumulative        cf.perfect_card
 * plus `cf.never_changed`, which is DARK until `pick_events` holds data (DI-980; about the viewer only, RPF-D1).
 *
 * SCOPE: one member, one competition (ATS format only), the season to date, final weeks. COUNTS ARE RAW PICKS, not league points
 * (multipliers are not applied; the screen says "pick counts, not league points").
 *
 * THE SAME-GAMES RULE (DI-979): the set S is the member's graded picks (a push stays a push) on games that HAVE a favourite. Every
 * strategy replays the IDENTICAL games; for follow and fade the games where the others split (or fewer than three others picked)
 * are removed from BOTH sides and counted ("on the same 4 games; 1 game left out because the others were split"). A push stays a
 * push in every replay. Fewer than 12 games in the set returns null with the reason `thin`.
 *
 * ---- DOLLAR RESULTS: SPECIFIED, BUILT AND SWITCHED OFF (DI-981; RPF-D2; SD-6; Gate G) -----------------------------------------
 * Two conditions must BOTH hold before any dollar value is computed: `MONEY_OUTPUTS_ENABLED` below is true (changed only in a
 * commit citing Drew's amendment of SD-6/W-27, Q-D2) AND every game counted has a VALID RECORDED price. With the constant false (the
 * D2 ship state) no function in this file returns a dollar value. NO RECORDED PRICE => NO DOLLAR OUTPUT. The engine never infers,
 * defaults or back-fills a price: there is no standard price anywhere in this lane. `priceFor` is lane 2's reader (migration 0064);
 * here it is a typed stub that returns null for everything.
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL, flagOverride } from './registry.js';
import { graded, wins, losses, supportOfPicks } from './slice.js';
import { eventsByGame, firstTeam } from './m-behavior.js';

const FW = REVEAL.FINAL_WEEK;

/** SHIP STATE: false. Flipped only in a commit that cites Drew's amendment of SD-6/W-27 (Q-D2). */
export const MONEY_OUTPUTS_ENABLED = false;
/** The ONE numeric money constant in the lane (DI-981): a hypothetical flat amount, in integer cents. */
export const HYPOTHETICAL_STAKE_CENTS = 1000;
const AMERICAN_BASIS = HYPOTHETICAL_STAKE_CENTS / 10;   // the "per 100" of an American price, derived so no second literal exists
const moneyOn = () => MONEY_OUTPUTS_ENABLED || flagOverride('MONEY_OUTPUTS_ENABLED');

/**
 * Lane 2's price reader (migration 0064): `{ market, home, away, over?, under?, provider, capturedAt } | null`. TYPED STUB: returns null for
 * every game until lane 2 lands its snapshot table; a caller may pass its own `priceFor` to the money function.
 * @param {string} gameId
 * @param {'ats'|'moneyline'|'total'} market
 * @returns {{market:string, home:number, away:number, over?:number, under?:number, provider:string, capturedAt:string}|null}
 */
export function priceFor(gameId, market) { return null; }

const mine = (slice, id) => slice.picksByMember.get(id) || [];
const flipSide = (s) => (s === 'home' ? 'away' : 'home');
const resultOf = (atsSide, side) => (atsSide === 'push' ? 'push' : side === atsSide ? 'win' : 'loss');
const tally = (rs) => ({ w: rs.filter((r) => r === 'win').length, l: rs.filter((r) => r === 'loss').length, p: rs.filter((r) => r === 'push').length });

/** The same-games set S: the member's picks (win, loss or push) on games with a favourite. */
export function strategySet(slice, memberId) {
  return mine(slice, memberId)
    .filter((p) => (p.result === 'win' || p.result === 'loss' || p.result === 'push') && p.favoriteSide !== null)
    .map((p) => ({ p, g: slice.gameById.get(p.gameId) }))
    .filter((r) => r.g && (r.g.atsSide === 'home' || r.g.atsSide === 'away' || r.g.atsSide === 'push'))
    .sort((a, b) => ((a.p.kickoffMs ?? 0) - (b.p.kickoffMs ?? 0)) || (a.p.gameId < b.p.gameId ? -1 : 1));
}

/** The strict majority side among the OTHER entrants who picked this game; null when they split or fewer than three picked. */
function othersMajority(slice, memberId, gameId) {
  const others = (slice.picksByGame.get(gameId) || []).filter((p) => p.memberId !== memberId);
  if (others.length < minOf('followOthers')) return null;
  const h = others.filter((p) => p.side === 'home').length, a = others.filter((p) => p.side === 'away').length;
  return h > a ? 'home' : a > h ? 'away' : null;
}

/** replay a strategy over the rows; `sideOf(row)` returns the side the strategy takes, or null to leave the game out. */
function replay(rows, sideOf) {
  const kept = [], mineR = [], strat = [];
  let leftOut = 0;
  for (const r of rows) {
    const side = sideOf(r);
    if (side === null) { leftOut++; continue; }
    kept.push(r);
    mineR.push(r.p.result);
    strat.push(resultOf(r.g.atsSide, side));
  }
  return { kept, leftOut, actual: tally(mineR), strategy: tally(strat), results: strat };
}

function strategyMetric(id, sideFn, { gamesKey = 'strategyGames' } = {}) {
  const def = register({
    id, v: 1, family: 'strategy', reveal: FW, level: 'member', minKey: gamesKey,
    run(slice, { memberId }) {
      const subject = { kind: 'member', id: memberId };
      const rows = strategySet(slice, memberId);
      const r = replay(rows, (row) => sideFn(slice, memberId, row));
      const min = minOf(gamesKey);
      if (r.kept.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: r.kept.length, min });
      return makeMetric({
        def, slice, subject, n: r.kept.length,
        value: { games: r.kept.length, leftOut: r.leftOut, actual: r.actual, strategy: r.strategy, diffWins: r.strategy.w - r.actual.w },
        supportRows: supportOfPicks(r.kept.map((x) => x.p)),
      });
    },
  });
  return def;
}

export const CF_ALWAYS_FAVORITE = strategyMetric('cf.always_favorite', (s, m, row) => row.p.favoriteSide);
export const CF_ALWAYS_UNDERDOG = strategyMetric('cf.always_underdog', (s, m, row) => flipSide(row.p.favoriteSide));
export const CF_FOLLOW_CONSENSUS = strategyMetric('cf.follow_consensus', (s, m, row) => othersMajority(s, m, row.p.gameId));
export const CF_FADE_CONSENSUS = strategyMetric('cf.fade_consensus', (s, m, row) => { const x = othersMajority(s, m, row.p.gameId); return x === null ? null : flipSide(x); });

export const CF_COPY_MEMBER = register({
  id: 'cf.copy_member', v: 1, family: 'strategy', reveal: FW, level: 'pair', minKey: 'copyShared',
  enumerate() { return []; },       // computed on demand for one chosen member, never for all of them (DI-978)
  run(slice, { memberId, copyId }) {
    const def = CF_COPY_MEMBER;
    const subject = { kind: 'pair', id: memberId, id2: copyId };
    if (!copyId || copyId === memberId) return unavailable({ def, slice, subject, reason: 'thin', n: 0, min: minOf('copyShared') });
    const theirs = new Map(mine(slice, copyId).map((p) => [p.gameId, p]));
    const rows = strategySet(slice, memberId);
    const r = replay(rows, (row) => (theirs.has(row.p.gameId) ? theirs.get(row.p.gameId).side : null));
    const min = minOf('copyShared');
    if (r.kept.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: r.kept.length, min });
    return makeMetric({ def, slice, subject, n: r.kept.length, value: { games: r.kept.length, leftOut: r.leftOut, actual: r.actual, strategy: r.strategy, diffWins: r.strategy.w - r.actual.w }, supportRows: supportOfPicks(r.kept.map((x) => x.p)) });
  },
});

/** The team M has the most appearances with in S (ties: the smaller key), or null. */
function mostAppearances(slice, memberId) {
  const c = new Map();
  for (const r of strategySet(slice, memberId)) for (const k of [r.g.homeKey, r.g.awayKey]) c.set(k, (c.get(k) || 0) + 1);
  const rows = Array.from(c.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  return rows.length ? rows[0][0] : null;
}

export const CF_TEAM_RECORD = register({
  id: 'cf.team_record', v: 1, family: 'strategy', reveal: FW, level: 'member', minKey: 'strategyTeam',
  enumerate(slice) { return slice.memberIds.map((memberId) => ({ memberId, teamKey: mostAppearances(slice, memberId) })).filter((x) => x.teamKey); },
  run(slice, { memberId, teamKey }) {
    const def = CF_TEAM_RECORD;
    const subject = { kind: 'member', id: memberId, id2: teamKey };
    const rows = strategySet(slice, memberId).filter((r) => r.g.homeKey === teamKey || r.g.awayKey === teamKey);
    const r = replay(rows, (row) => (row.g.homeKey === teamKey ? 'home' : 'away'));
    const min = minOf('strategyTeam');
    if (r.kept.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: r.kept.length, min });
    const g0 = r.kept[0].g;
    return makeMetric({ def, slice, subject, n: r.kept.length, value: { team: g0.homeKey === teamKey ? g0.home : g0.away, games: r.kept.length, actual: r.actual, strategy: r.strategy, diffWins: r.strategy.w - r.actual.w }, supportRows: supportOfPicks(r.kept.map((x) => x.p)) });
  },
});

const CUMULATIVE = Object.freeze({
  always_favorite: (s, m, row) => row.p.favoriteSide,
  always_underdog: (s, m, row) => flipSide(row.p.favoriteSide),
  follow_consensus: (s, m, row) => othersMajority(s, m, row.p.gameId),
  fade_consensus: (s, m, row) => { const x = othersMajority(s, m, row.p.gameId); return x === null ? null : flipSide(x); },
});

export const CF_CUMULATIVE = register({
  id: 'cf.cumulative', v: 1, family: 'strategy', reveal: FW, level: 'member', minKey: 'cumulativeWeeks',
  run(slice, { memberId }) {
    const def = CF_CUMULATIVE;
    const subject = { kind: 'member', id: memberId };
    const rows = strategySet(slice, memberId);
    const units = slice.units.filter((u) => rows.some((r) => u.weekIds.includes(r.p.weekId)));
    const min = minOf('cumulativeWeeks');
    if (units.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: units.length, min });
    const diff = (rs) => rs.filter((x) => x === 'win').length - rs.filter((x) => x === 'loss').length;
    const weekly = { actual: [], ...Object.fromEntries(Object.keys(CUMULATIVE).map((k) => [k, []])) };
    // each week's own record too (the What-if screen's table twin, DI-982): the SAME replay, counted as wins and losses instead of their difference; for follow / fade the
    // actual beside a strategy is the actual on that strategy's kept games (the same-games rule), so `records.vs[k]` carries it
    const records = { actual: [], ...Object.fromEntries(Object.keys(CUMULATIVE).map((k) => [k, []])), vs: Object.fromEntries(Object.keys(CUMULATIVE).map((k) => [k, []])) };
    for (const u of units) {
      const inU = rows.filter((r) => u.weekIds.includes(r.p.weekId));
      weekly.actual.push(diff(inU.map((r) => r.p.result)));
      records.actual.push(tally(inU.map((r) => r.p.result)));
      for (const [k, fn] of Object.entries(CUMULATIVE)) {
        const rp = replay(inU, (row) => fn(slice, memberId, row));
        weekly[k].push(diff(rp.results));
        records[k].push(rp.strategy);
        records.vs[k].push(rp.actual);
      }
    }
    const run = (a) => { let t = 0; return a.map((x) => (t += x)); };
    return makeMetric({
      def, slice, subject, n: units.length,
      value: { weeks: units.map((u) => u.weekNumber), actual: run(weekly.actual), strategies: Object.fromEntries(Object.keys(CUMULATIVE).map((k) => [k, run(weekly[k])])), weeklyDiffs: { actual: weekly.actual, strategies: Object.fromEntries(Object.keys(CUMULATIVE).map((k) => [k, weekly[k]])) }, weeklyRecords: records },
      supportRows: supportOfPicks(rows.map((r) => r.p)),
    });
  },
});

export const CF_PERFECT_CARD = register({
  id: 'cf.perfect_card', v: 1, family: 'strategy', reveal: FW, level: 'member', minKey: 'cumulativeWeeks',
  run(slice, { memberId }) {
    const def = CF_PERFECT_CARD;
    const subject = { kind: 'member', id: memberId };
    const perfect = [], oneMiss = [];
    let qualifying = 0;
    for (const u of slice.units) {
      const g = graded(mine(slice, memberId).filter((p) => u.weekIds.includes(p.weekId)));
      if (g.length < minOf('perfectCardGraded')) continue;        // fewer than 5 graded picks counts for neither
      qualifying++;
      const l = losses(g);
      if (l === 0) perfect.push(u.weekNumber); else if (l === 1) oneMiss.push(u.weekNumber);
    }
    const min = minOf('cumulativeWeeks');
    if (qualifying < min) return unavailable({ def, slice, subject, reason: 'thin', n: qualifying, min });
    return makeMetric({ def, slice, subject, n: qualifying, value: { perfect: perfect.length, oneMissAway: oneMiss.length, perfectWeeks: perfect, oneMissWeeks: oneMiss }, supportRows: [] });
  },
});

/** "What if I never changed my pick?" DARK until pick_events holds data (DI-980); about the viewer only (RPF-D1). */
export const CF_NEVER_CHANGED = register({
  id: 'cf.never_changed', v: 1, family: 'strategy', reveal: FW, level: 'member', minKey: 'pickEventPicks', private: true,
  run(slice, { memberId }) {
    const def = CF_NEVER_CHANGED;
    const subject = { kind: 'member', id: memberId };
    const min = minOf('pickEventPicks');
    if (!slice.input.viewerMemberId || memberId !== slice.input.viewerMemberId) return unavailable({ def, slice, subject, reason: 'private', n: 0, min });
    const ev = eventsByGame(slice.input);
    if (ev.size === 0) return unavailable({ def, slice, subject, reason: 'no_history', n: 0, min });
    const rows = mine(slice, memberId).filter((p) => ev.has(p.gameId) && p.result !== null).map((p) => ({ p, g: slice.gameById.get(p.gameId), first: firstTeam(ev.get(p.gameId)) })).filter((r) => r.g);
    if (rows.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: rows.length, min });
    const firstRes = rows.map((r) => { const side = r.first === r.g.home ? 'home' : r.first === r.g.away ? 'away' : null; return side === null ? null : resultOf(r.g.atsSide, side); }).filter(Boolean);
    return makeMetric({ def, slice, subject, n: rows.length, value: { games: rows.length, actual: tally(rows.map((r) => r.p.result)), neverChanged: tally(firstRes) }, supportRows: supportOfPicks(rows.map((r) => r.p)) });
  },
});

// ---- dollar results: built, switched OFF (DI-981) ----------------------------------------------------------------------

/** round half away from zero of a/b for integers (b > 0), exact integer arithmetic. */
const roundDiv = (a, b) => (a >= 0 ? Math.floor((2 * a + b) / (2 * b)) : -Math.floor((-2 * a + b) / (2 * b)));
/** Return in cents of ONE settled pick at American price `o`: win pays stake x 100 / |o| (negative) or stake x o / 100 (positive); loss costs the stake; push 0. */
export function centsFor(result, o) {
  if (result === 'push') return 0;
  if (result === 'loss') return -HYPOTHETICAL_STAKE_CENTS;
  if (!Number.isInteger(o) || o === 0) throw new Error('analytics: a valid recorded price is an integer American price');
  return o < 0 ? roundDiv(HYPOTHETICAL_STAKE_CENTS * AMERICAN_BASIS, -o) : roundDiv(HYPOTHETICAL_STAKE_CENTS * o, AMERICAN_BASIS);
}

/** A price is valid for a pick only when its market matches, a provider is recorded, and it was captured AT OR BEFORE the week's lock (the price the member could have seen). */
function validPrice(price, market, lockMs) {
  if (!price || price.market !== market || typeof price.provider !== 'string' || !price.provider) return false;
  const t = Date.parse(price.capturedAt);
  return Number.isFinite(t) && lockMs !== null && t <= lockMs;
}

/**
 * Hypothetical dollar results of the member's picks. With the switch off this returns `dark` and computes NOTHING. `priceOf` defaults to the
 * lane-2 stub (null for every game). The market is 'ats' (the ATS side's price) or 'moneyline' (the same teams as outright winners at their
 * moneyline price: a DIFFERENT market, labelled as such and never added to the ATS figure). A game with no valid price is excluded and counted.
 */
export function moneyReturn(slice, { memberId, market = 'ats', priceOf = priceFor }) {
  const def = MONEY_DEF;
  const subject = { kind: 'member', id: memberId };
  if (!moneyOn()) return unavailable({ def, slice, subject, reason: 'dark', n: 0, min: minOf('moneyPrices') });
  const weekLock = new Map(slice.weeks.map((w) => [w.weekId, w.lockMs]));
  const rows = mine(slice, memberId).filter((p) => p.result === 'win' || p.result === 'loss' || p.result === 'push');
  let cents = 0, priced = 0, noPrice = 0;
  const sup = [];
  for (const p of rows) {
    const g = slice.gameById.get(p.gameId);
    const price = g ? priceOf(p.gameId, market) : null;
    if (!g || !validPrice(price, market, weekLock.get(p.weekId) ?? null)) { noPrice++; continue; }
    if (p.side === null) { noPrice++; continue; }                         // a pick on a team that is on neither side of the game has no price
    let result = p.result;
    if (market === 'moneyline') result = g.outrightSide === null ? 'push' : (g.outrightSide === p.side ? 'win' : 'loss');
    const o = p.side === 'home' ? price.home : price.away;
    cents += centsFor(result, o);
    priced++;
    sup.push(p);
  }
  const min = minOf('moneyPrices');
  if (priced < min) return unavailable({ def, slice, subject, reason: 'thin', n: priced, min });
  return makeMetric({ def, slice, subject, n: priced, value: { market, cents, priced, of: rows.length, noPrice }, supportRows: supportOfPicks(sup) });
}
const MONEY_DEF = register({ id: 'cf.money', v: 1, family: 'strategy', reveal: FW, level: 'member', minKey: 'moneyPrices', dark: true, run(slice, p) { return moneyReturn(slice, p); } });
