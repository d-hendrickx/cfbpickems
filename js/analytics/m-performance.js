/**
 * CFB Pickems - js/analytics/m-performance.js (D2 lane 4; DI-954 "Performance"; UN/PF-519; 2026-10-19)
 * =====================================================================================================
 * Best and worst week, streaks, weeks won and last, rank path, biggest rise and fall, volatility, and the pilot's comparison
 * with last season. Reveal class: final-week.
 *
 * REUSE IS THE POINT: these WRAP js/stats.js `memberSeasonStats` (best/worst week, streaks, weekly wins and losses, current rank)
 * and js/scoring.js `calculateSeasonStandings` (the rank path), so Home, Standings and SCRIBE cannot disagree about a number.
 * analyticstest asserts every wrapped value equals the wrapped function's own output on the fixtures ([PERF-WRAP]).
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL } from './registry.js';
import { viewOf } from './input.js';
import { graded } from './slice.js';
import { standingsOf } from './tally.js';
import { memberSeasonStats } from '../stats.js';

const FW = REVEAL.FINAL_WEEK;
const memo = new WeakMap();
const memoFor = (slice) => { let m = memo.get(slice); if (!m) { m = new Map(); memo.set(slice, m); } return m; };

/** The REVEALED VIEW (S-C2) memberSeasonStats wants, restricted to this slice's competition and season. */
function statsView(slice) {
  const m = memoFor(slice);
  if (m.has('view')) return m.get('view');
  const view = viewOf(slice.input);
  const ids = new Set(slice.weeks.map((w) => w.weekId));
  const compOf = (w) => (w.competitionId ?? null);
  const v = {
    players: view.players.filter((p) => slice.memberIds.includes(p.playerId)),
    revealedWeeks: view.rawWeeks.filter((w) => ids.has(String(w.weekId))),
    revealedGames: view.rawGames.filter((g) => ids.has(String(g.weekId))),
    revealedPicks: view.rawPicks.filter((p) => ids.has(String(p.weekId))),
    revealedWeeklyResults: slice.input.standingsRows.filter((r) => ids.has(r.weekId)),
    season: slice.season,
    allWeeks: view.allRawWeeks.filter((w) => compOf(w) === slice.competitionId || (compOf(w) === null && slice.competitionId === null) || ids.has(String(w.weekId))),
    tieContexts: null,
  };
  m.set('view', v);
  return v;
}
export function statsFor(slice, memberId) {
  const m = memoFor(slice);
  const k = 's:' + memberId;
  if (!m.has(k)) m.set(k, memberSeasonStats(memberId, statsView(slice)));
  return m.get(k);
}

const weekLine = (x) => (x ? { weekId: x.weekId, weekNumber: x.weekN, wins: x.wins, losses: x.losses } : null);

const gradedCount = (slice, id) => graded(slice.picksByMember.get(id) || []).length;

export const PERF_BEST_WORST = register({
  id: 'perf.best_worst_week', v: 1, family: 'performance', reveal: FW, level: 'member', minKey: 'perfWeeks',
  run(slice, { memberId }) {
    const def = PERF_BEST_WORST;
    const subject = { kind: 'member', id: memberId };
    const st = statsFor(slice, memberId);
    const played = slice.input.standingsRows.filter((r) => r.playerId === memberId && slice.weeks.some((w) => w.weekId === r.weekId) && ((r.correctCount ?? r.correctPicks) + (r.incorrectCount ?? r.incorrectPicks)) > 0).length;
    const min = minOf('perfWeeks');
    if (played < min || !st.bestWeek) return unavailable({ def, slice, subject, reason: 'thin', n: played, min });
    return makeMetric({ def, slice, subject, n: played, value: { best: weekLine(st.bestWeek), worst: weekLine(st.worstWeek) }, supportRows: [] });
  },
});

export const PERF_STREAKS = register({
  id: 'perf.streaks', v: 1, family: 'performance', reveal: FW, level: 'member', minKey: 'perfWeeks',
  run(slice, { memberId }) {
    const def = PERF_STREAKS;
    const subject = { kind: 'member', id: memberId };
    const n = gradedCount(slice, memberId);
    const min = minOf('perfWeeks');
    if (n < min) return unavailable({ def, slice, subject, reason: 'thin', n, min });
    const st = statsFor(slice, memberId);
    // a history with a hole yields NO streak (the sequence-with-a-hole rule of stats-core)
    if (st.currentStreak.state === 'unknown' || st.longestStreak === null) return unavailable({ def, slice, subject, reason: 'no_data', n, min });
    return makeMetric({ def, slice, subject, n, value: { current: { kind: st.currentStreak.kind, run: st.currentStreak.run, active: st.currentStreak.state === 'active' }, longestCovers: st.longestStreak.run }, supportRows: [] });
  },
});

export const PERF_WEEKS_WON_LOST = register({
  id: 'perf.weeks_won_lost', v: 1, family: 'performance', reveal: FW, level: 'member', minKey: 'perfWeeks',
  run(slice, { memberId }) {
    const def = PERF_WEEKS_WON_LOST;
    const subject = { kind: 'member', id: memberId };
    const min = minOf('perfWeeks');
    if (slice.units.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: slice.units.length, min });
    const st = statsFor(slice, memberId);
    return makeMetric({ def, slice, subject, n: slice.units.length, value: { won: st.weeklyWins, lost: st.weeklyLosses, rank: st.currentRank }, supportRows: [] });
  },
});

/** rank after each final unit, for every member: Map(unitKey -> Map(memberId -> rank)). Standings logic is the IMPORTED calculateSeasonStandings. */
export function rankSeries(slice) {
  const m = memoFor(slice);
  if (m.has('ranks')) return m.get('ranks');
  const view = statsView(slice);
  const players = view.players;
  const out = [];
  const seen = new Set();
  for (const u of slice.units) {
    for (const id of u.weekIds) seen.add(id);
    const rows = slice.input.standingsRows.filter((r) => seen.has(r.weekId));
    const standings = standingsOf(players, rows, view.allWeeks, null);
    out.push({ unit: u, ranks: new Map(standings.map((s) => [s.playerId, s.currentRank])), totals: new Map(standings.map((s) => [s.playerId, s.totalCorrect])) });
  }
  m.set('ranks', out);
  return out;
}

export const PERF_RANK_PATH = register({
  id: 'perf.rank_path', v: 1, family: 'performance', reveal: FW, level: 'member', minKey: 'perfWeeks',
  run(slice, { memberId }) {
    const def = PERF_RANK_PATH;
    const subject = { kind: 'member', id: memberId };
    const min = minOf('perfWeeks');
    const n = slice.units.length;
    if (n < min) return unavailable({ def, slice, subject, reason: 'thin', n, min });
    if (slice.memberIds.length < minOf('rankEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: slice.memberIds.length, min: minOf('rankEntrants') });
    const series = rankSeries(slice);
    const path = series.map((s) => ({ weekNumber: s.unit.weekNumber, rank: s.ranks.get(memberId) ?? null }));
    if (path.some((p) => p.rank === null)) return unavailable({ def, slice, subject, reason: 'no_data', n, min });
    const ranks = path.map((p) => p.rank);
    return makeMetric({
      def, slice, subject, n, value: { path, highest: Math.min(...ranks), lowest: Math.max(...ranks), weeksAtFirst: ranks.filter((r) => r === 1).length, current: ranks[ranks.length - 1], entrants: slice.memberIds.length }, supportRows: [],
    });
  },
});

export const PERF_RISE_FALL = register({
  id: 'perf.rise_fall', v: 1, family: 'performance', reveal: FW, level: 'member', minKey: 'riseFallWeeks',
  run(slice, { memberId }) {
    const def = PERF_RISE_FALL;
    const subject = { kind: 'member', id: memberId };
    const min = minOf('riseFallWeeks');
    const n = slice.units.length;
    if (n < min) return unavailable({ def, slice, subject, reason: 'thin', n, min });
    if (slice.memberIds.length < minOf('rankEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: slice.memberIds.length, min: minOf('rankEntrants') });
    const series = rankSeries(slice);
    let rise = null, fall = null;
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1].ranks.get(memberId), b = series[i].ranks.get(memberId);
      if (a === undefined || b === undefined) continue;
      const up = a - b, down = b - a;
      const ref = { weekNumber: series[i].unit.weekNumber, weekId: series[i].unit.weekIds[0], from: a, to: b, places: Math.abs(a - b) };
      if (up > 0 && (!rise || up > rise.places)) rise = ref;        // strictly greater: the earlier week keeps a tie
      if (down > 0 && (!fall || down > fall.places)) fall = ref;
    }
    return makeMetric({ def, slice, subject, n, value: { rise, fall }, supportRows: [] });
  },
});

export const PERF_VOLATILITY = register({
  id: 'perf.volatility', v: 1, family: 'performance', reveal: FW, level: 'member', minKey: 'volatilityWeeks',
  run(slice, { memberId }) {
    const def = PERF_VOLATILITY;
    const subject = { kind: 'member', id: memberId };
    const min = minOf('volatilityWeeks');
    const sdOf = (id) => {
      const xs = slice.units.map((u) => slice.input.standingsRows.filter((r) => r.playerId === id && u.weekIds.includes(r.weekId)).reduce((s, r) => s + (r.correctCount ?? r.correctPicks), 0));
      const n = xs.length;
      if (n < min) return null;
      const S = xs.reduce((a, b) => a + b, 0), Q = xs.reduce((a, b) => a + b * b, 0);
      // population standard deviation: integer sums first, ONE rounding at the end
      return { sd: Math.round((Math.sqrt(n * Q - S * S) / n) * 100) / 100, n };
    };
    const mine = sdOf(memberId);
    if (!mine) return unavailable({ def, slice, subject, reason: 'thin', n: slice.units.length, min });
    const all = slice.memberIds.map(sdOf).filter(Boolean).map((x) => x.sd).sort((a, b) => a - b);
    const mid = all.length >> 1;
    const median = all.length ? (all.length % 2 ? all[mid] : Math.round(((all[mid - 1] + all[mid]) / 2) * 100) / 100) : null;
    return makeMetric({ def, slice, subject, n: mine.n, value: { sd: mine.sd }, comparison: median === null ? null : { value: median, n: all.length, label: 'league_median' }, supportRows: [] });
  },
});

/** The pilot's comparison with CFP 2K25 (DI-954): weekly totals only; the caller injects the archive ONLY for a pilot league (pilot-only registry). */
export const PERF_VS_LAST_SEASON = register({
  id: 'perf.vs_last_season', v: 1, family: 'performance', reveal: FW, level: 'member', minKey: 'priorWeeksLo',
  run(slice, { memberId }) {
    const def = PERF_VS_LAST_SEASON;
    const subject = { kind: 'member', id: memberId };
    const arch = slice.sport === 'cfb' ? slice.input.archive : null;       // college football weekly totals only: never beside another sport
    if (!arch || !arch.weeklyScores || String(arch.season) === slice.season) return unavailable({ def, slice, subject, reason: 'not_pilot', n: 0, min: minOf('priorWeeksLo') });
    const me = slice.input.members.find((m) => m.id === memberId);
    const line = me && arch.weeklyScores[me.name];
    if (!Array.isArray(line)) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: minOf('priorWeeksLo') });
    const K = slice.units.length ? Math.max(...slice.units.map((u) => u.weekNumber)) : 0;
    if (K < minOf('priorWeeksLo') || K > minOf('priorWeeksHi')) return unavailable({ def, slice, subject, reason: 'thin', n: K, min: minOf('priorWeeksLo') });
    const inK = new Set(slice.finals.filter((w) => w.weekNumber <= K).map((w) => w.weekId));
    const now = slice.input.standingsRows.filter((r) => r.playerId === memberId && inK.has(r.weekId)).reduce((s, r) => s + (r.correctCount ?? r.correctPicks), 0);
    const then = line.slice(0, K).reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
    return makeMetric({ def, slice, subject, n: K, value: { throughWeek: K, now, then, delta: now - then }, supportRows: [], level: 'weekly', source: 'archive' });
  },
});
