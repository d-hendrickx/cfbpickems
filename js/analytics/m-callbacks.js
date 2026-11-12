/**
 * CFB Pickems - js/analytics/m-callbacks.js (D2 lane 4; DI-965..969 "Historical callbacks"; UN/PF-521; 2026-10-19)
 * ===============================================================================================================
 * WEEKLY-LEVEL HISTORICAL MEMORY. What the 2026 record supports now, what waits for Drew's data, and nothing invented.
 *
 * THE APPROVED-MEMORY SOURCE SET IS A CLOSED LIST (DI-965). A callback reads NOTHING else: not chat history, not `scribe_learnings`,
 * not `scribe_canon`, not the SCRIBE profile or memory rows, not the onboarding profile, not news. A memory item is shown VERBATIM
 * with attribution and is never paraphrased into a statement of fact (the quotation rule).
 *
 * EXPLICIT GAPS (built dark): `archive.2025.picks` is REGISTERED and EMPTY (needs Drew's archived Google Forms, M-71, Q-D3); the
 * engine reads no pick-level 2K25 row even if one is supplied. The 2025 weekly archive reaches the engine ONLY through
 * `input.archive`, which the caller injects for the pilot league alone (pilot-only registry); a non-pilot league gets none.
 *
 * Reveal: the weekly-level and 2026-record callbacks are final-week; `cb.changed_behavior` compares a CURRENT game's pick with an
 * earlier one, so it needs the `public-game` class and exists only once the current game's week is public (never before reveal).
 */
import { register, makeMetric, unavailable, minOf, REVEAL } from './registry.js';
import { assertEligible } from './input.js';
import { sliceOf, scopesOf, graded, wins, losses, supportOfPicks } from './slice.js';
import { CF_PERFECT_CARD } from './m-strategies.js';
import { PERF_RISE_FALL } from './m-performance.js';

const FW = REVEAL.FINAL_WEEK, PG = REVEAL.PUBLIC_GAME;

function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }

/** The closed list (DI-965). `status: 'gap'` rows are registered and EMPTY: nothing reads them. */
export const APPROVED_MEMORY_SOURCES = deepFreeze([
  { sourceId: 'record', kind: 'record', who: 'league', status: 'ships' },
  { sourceId: 'archive.2025.weekly', kind: 'archive', who: 'pilot', status: 'ships' },
  { sourceId: 'week.blurb', kind: 'blurb', who: 'league', status: 'ships' },
  { sourceId: 'league_memories', kind: 'memory', who: 'league', status: 'ships' },
  { sourceId: 'archive.2025.picks', kind: 'archive', who: 'league', status: 'gap' },
]);
export const MEMORY_SOURCE_IDS = deepFreeze(APPROVED_MEMORY_SOURCES.map((s) => s.sourceId));
/** Sources a callback may cite: the listed ones that are not gaps. */
const readable = (id) => APPROVED_MEMORY_SOURCES.some((s) => s.sourceId === id && s.status === 'ships');
function assertSource(id) { if (!readable(id)) throw new Error('analytics: ' + String(id) + ' is not an approved memory source'); }
export const CALLBACK_GAP_SENTENCE = "Last season's picks aren't in this league's record yet.";

const REGULAR_WEEKS_2025 = 14;
const NEARBY_WEEKS = 2;

/** the archive's drink and rows for week N (the shipped callbackPacket's facts, over `input.archive`) */
function archiveWeek(arch, N) {
  const rows = [];
  for (const [name, scores] of Object.entries(arch.weeklyScores || {})) { const s = Array.isArray(scores) ? scores[N - 1] : undefined; if (Number.isFinite(s)) rows.push({ name, score: s }); }
  rows.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  const drink = (arch.weeklyDrinks || []).find((d) => d && d.week === N) || null;
  return { rows, drink };
}
const currentWeekOf = (slice, p) => (Number.isInteger(p && p.weekNumber) ? p.weekNumber : (slice.throughWeek || 0) + 1);

export const CB_SAME_WEEK_LAST_YEAR = register({
  id: 'cb.same_week_last_year', v: 1, family: 'callback', reveal: FW, level: 'league', minKey: 'priorWeeksLo', once: true,
  run(slice, p = {}) {
    const def = CB_SAME_WEEK_LAST_YEAR;
    const subject = { kind: 'league', id: slice.leagueId };
    const arch = slice.sport === 'cfb' ? slice.input.archive : null;     // the 2K25 archive is COLLEGE FOOTBALL weekly totals: never set beside another sport (DI-945)
    if (!arch) return unavailable({ def, slice, subject, reason: 'not_pilot', n: 0, min: 1 });
    assertSource('archive.2025.weekly');
    const N = currentWeekOf(slice, p);
    if (!Number.isInteger(N) || N < 1 || N > REGULAR_WEEKS_2025 || String(arch.season) === slice.season) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    const { rows, drink } = archiveWeek(arch, N);
    if (!rows.length) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    let pair = null;
    if (drink) {
      const lo = Math.max(1, N - NEARBY_WEEKS), hi = Math.min(REGULAR_WEEKS_2025, N + NEARBY_WEEKS);
      const same = (arch.weeklyDrinks || []).filter((d) => d && d.week >= lo && d.week <= hi && ((d.from === drink.from && d.to === drink.to) || (d.from === drink.to && d.to === drink.from)));
      pair = { count: same.length, fromWeek: lo, toWeek: hi };
    }
    // what changed since: this season's FINAL weeks against last season at the same point (raw correct picks through the same week number)
    const K = slice.units.length ? Math.max(...slice.units.map((u) => u.weekNumber)) : 0;
    const changed = [];
    if (K >= 1 && K <= REGULAR_WEEKS_2025) {
      const ids = new Set(slice.finals.filter((w) => w.weekNumber <= K).map((w) => w.weekId));
      for (const m of slice.members) {
        const line = arch.weeklyScores[m.name];
        if (!Array.isArray(line)) continue;
        const now = slice.input.standingsRows.filter((r) => r.playerId === m.id && ids.has(r.weekId)).reduce((s, r) => s + (r.correctCount ?? r.correctPicks), 0);
        const then = line.slice(0, K).reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
        changed.push({ name: m.name, now, then, delta: now - then });
      }
      changed.sort((a, b) => b.now - a.now || (a.name < b.name ? -1 : 1));
    }
    return makeMetric({
      def, slice, subject, n: rows.length,
      value: { season: String(arch.season), weekNumber: N, rows, winner: drink ? drink.to : null, loser: drink ? drink.from : null, drink: drink ? { from: drink.from, to: drink.to } : null, pair, throughWeek: K, changed, source: { sourceId: 'archive.2025.weekly', kind: 'archive' } },
      supportRows: [], level: 'weekly', source: 'archive', asOf: slice.asOf,
    });
  },
});

export const CB_PRIOR_STANDING = register({
  id: 'cb.prior_standing', v: 1, family: 'callback', reveal: FW, level: 'member', minKey: 'priorWeeksLo',
  run(slice, { memberId }) {
    const def = CB_PRIOR_STANDING;
    const subject = { kind: 'member', id: memberId };
    const arch = slice.sport === 'cfb' ? slice.input.archive : null;
    if (!arch) return unavailable({ def, slice, subject, reason: 'not_pilot', n: 0, min: minOf('priorWeeksLo') });
    assertSource('archive.2025.weekly');
    const K = slice.units.length;
    const me = slice.input.members.find((m) => m.id === memberId);
    const line = me && arch.weeklyScores[me.name];
    if (!Array.isArray(line) || String(arch.season) === slice.season) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: minOf('priorWeeksLo') });
    const names = Object.keys(arch.weeklyScores).filter((nm) => Array.isArray(arch.weeklyScores[nm]));
    if (K < minOf('priorWeeksLo') || K > REGULAR_WEEKS_2025) return unavailable({ def, slice, subject, reason: 'thin', n: K, min: minOf('priorWeeksLo') });
    if (names.length < minOf('priorEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: names.length, min: minOf('priorEntrants') });
    const tot = (nm) => arch.weeklyScores[nm].slice(0, K).reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
    const mine = tot(me.name);
    const above = names.filter((nm) => tot(nm) > mine).length;
    const equal = names.filter((nm) => tot(nm) === mine).length;
    const fin = (arch.standings || []).find((s) => s && s.name === me.name);
    return makeMetric({
      def, slice, subject, n: K,
      value: { throughWeek: K, rank: above + 1, tied: equal > 1, finalRank: fin ? fin.rank : null, season: String(arch.season), basis: 'weekly_scores', source: { sourceId: 'archive.2025.weekly', kind: 'archive' } },
      supportRows: [], level: 'weekly', source: 'archive',
    });
  },
});

export const CB_NOTABLE_MOMENT = register({
  id: 'cb.notable_moment', v: 1, family: 'callback', reveal: FW, level: 'member', minKey: 'cumulativeWeeks',
  run(slice, p) {
    const def = CB_NOTABLE_MOMENT;
    const memberId = p.memberId;
    const subject = { kind: 'member', id: memberId };
    const moments = [];
    const pc = CF_PERFECT_CARD.run(slice, { memberId });
    if (pc.value && pc.value.perfectWeeks.length) for (const wk of pc.value.perfectWeeks) moments.push({ kind: 'perfect_card', weekNumber: wk, sourceId: 'record' });
    const rf = PERF_RISE_FALL.run(slice, { memberId });
    if (rf.value && rf.value.rise) moments.push({ kind: 'biggest_rise', weekNumber: rf.value.rise.weekNumber, places: rf.value.rise.places, sourceId: 'record' });
    const N = currentWeekOf(slice, p);
    const arch = slice.sport === 'cfb' ? slice.input.archive : null;
    if (arch && Number.isInteger(N) && String(arch.season) !== slice.season) {
      assertSource('archive.2025.weekly');
      const d = (arch.weeklyDrinks || []).find((x) => x && x.week === N);
      const me = slice.input.members.find((m) => m.id === memberId);
      if (d && me && (d.from === me.name || d.to === me.name)) moments.push({ kind: 'traded_drink', season: String(arch.season), weekNumber: N, role: d.to === me.name ? 'won' : 'lost', sourceId: 'archive.2025.weekly' });
    }
    if (!moments.length) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    return makeMetric({ def, slice, subject, n: moments.length, value: { moments }, supportRows: [] });
  },
});

/** a team T the member has history with, across every season of this competition that is in the input (pick level only) */
export const CB_TEAM_HISTORY = register({
  id: 'cb.team_history', v: 1, family: 'callback', reveal: FW, level: 'member', minKey: 'teamSide', crossScope: 'season',
  run(input, { memberId, teamKey, competitionId }) {
    assertEligible(input);
    const def = CB_TEAM_HISTORY;
    const subject = { kind: 'member', id: memberId, id2: teamKey };
    const seasons = scopesOf(input).filter((s) => s.competitionId === competitionId).map((s) => s.season);
    const backed = [], faded = [];
    let slice0 = null, name = teamKey;
    for (const season of seasons) {
      const s = sliceOf(input, { competitionId, season });
      slice0 = slice0 || s;
      for (const g of s.games) { if (g.homeKey === teamKey) name = g.home; else if (g.awayKey === teamKey) name = g.away; }
      for (const p of graded(s.picksByMember.get(memberId) || [])) { if (p.teamKey === teamKey) backed.push(p); else if (p.opponentKey === teamKey) faded.push(p); }
    }
    const min = minOf('teamSide');
    if (!slice0) return unavailable({ def, slice: null, subject, reason: 'no_data', n: 0, min });
    if (backed.length + faded.length < min) return unavailable({ def, slice: slice0, subject, reason: 'thin', n: backed.length + faded.length, min });
    const cross = { leagueId: input.leagueId, sport: slice0.sport, competitionId, format: slice0.format, season: seasons.join(','), dataKey: input.dataKey, asOf: slice0.asOf, throughWeek: null, excluded: slice0.excluded };
    return makeMetric({ def, slice: cross, subject, n: backed.length + faded.length, value: { team: name, backed: { n: backed.length, w: wins(backed), l: losses(backed) }, faded: { n: faded.length, w: wins(faded), l: losses(faded) }, seasons, source: { sourceId: 'record', kind: 'record' } }, supportRows: supportOfPicks([...backed, ...faded]), window: { kind: 'all-final' } });
  },
});

/** the prior meeting of the same unordered pair, for each game on a SLATE (team names only: no pick, no line crosses in `slate`) */
export const CB_REMATCH = register({
  id: 'cb.rematch', v: 1, family: 'callback', reveal: FW, level: 'game', minKey: 'consEntrants',
  enumerate() { return []; },        // needs a slate; the caller passes it (candidates({ slate }))
  run(slice, { slateGame }) {
    const def = CB_REMATCH;
    const subject = { kind: 'game', id: String(slateGame && slateGame.gameId) };
    if (!slateGame || typeof slateGame.homeKey !== 'string' || typeof slateGame.awayKey !== 'string') return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const want = pairKey(slateGame.homeKey, slateGame.awayKey);
    const prior = slice.games.filter((g) => g.status === 'final' && pairKey(g.homeKey, g.awayKey) === want).sort((a, b) => (b.kickoffMs ?? 0) - (a.kickoffMs ?? 0) || (a.gameId < b.gameId ? 1 : -1))[0];
    if (!prior) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    const picks = slice.picksByGame.get(prior.gameId) || [];
    return makeMetric({
      def, slice, subject, n: picks.length,
      value: { priorGameId: prior.gameId, priorWeekId: prior.weekId, picks: picks.map((p) => ({ memberId: p.memberId, team: p.team, result: p.result })).sort((a, b) => (a.memberId < b.memberId ? -1 : 1)), source: { sourceId: 'record', kind: 'record' } },
      supportRows: supportOfPicks(picks),
    });
  },
});

/**
 * "Brayden backed Texas last time and covered. This time he took Oklahoma." Needs a CURRENT game whose week is PUBLIC (so the public-game
 * class) and a prior meeting of the same pair in the record. States the change and the earlier result, NEVER why.
 */
export const CB_CHANGED_BEHAVIOR = register({
  id: 'cb.changed_behavior', v: 1, family: 'callback', reveal: PG, level: 'member', minKey: 'consEntrants',
  enumerate() { return []; },
  run(slice, { memberId, currentGameId }) {
    const def = CB_CHANGED_BEHAVIOR;
    const subject = { kind: 'member', id: memberId, id2: String(currentGameId) };
    const proj = slice.input.projection;
    const nowGame = proj && proj.games.find((g) => g.gameId === currentGameId);
    if (!nowGame) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    const nowPick = proj.picks.find((x) => x.gameId === currentGameId && x.memberId === memberId);
    if (!nowPick) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const want = pairKey(nowGame.homeKey, nowGame.awayKey);
    const prior = slice.games.filter((g) => g.gameId !== currentGameId && g.status === 'final' && pairKey(g.homeKey, g.awayKey) === want).sort((a, b) => (b.kickoffMs ?? 0) - (a.kickoffMs ?? 0))[0];
    if (!prior) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    const then = (slice.picksByGame.get(prior.gameId) || []).find((x) => x.memberId === memberId);
    if (!then || then.teamKey === nowPick.teamKey) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
    return makeMetric({ def, slice, subject, n: 1, value: { priorTeam: then.team, priorResult: then.result, nowTeam: nowPick.team, priorGameId: prior.gameId, currentGameId, source: { sourceId: 'record', kind: 'record' } }, supportRows: supportOfPicks([then]) });
  },
});

/** approved weekly notes for this week number in a CLOSED season: the commissioner's `week.blurb` of earlier seasons, and approved league memories */
function closedSeasonMemories(input, N, kinds) {
  const latest = input.weeks.map((w) => w.season).sort().pop();
  const out = [];
  if (kinds.includes('blurb')) {
    for (const w of input.weeks) {
      if (w.season < latest && w.weekNumber === N && w.blurb && w.blurb.trim()) { assertSource('week.blurb'); out.push({ sourceId: 'week.blurb', kind: 'blurb', season: w.season, weekNumber: N, authorLabel: 'Commissioner', text: w.blurb.trim(), hash: null }); }
    }
  }
  for (const m of input.memories) {
    if (!kinds.includes(m.kind) || Number(m.weekNumber) !== N || String(m.season) >= latest) continue;      // a CLOSED season only
    assertSource('league_memories');
    out.push({ sourceId: 'league_memories', kind: m.kind, season: String(m.season), weekNumber: N, authorLabel: String(m.authorLabel ?? ''), text: String(m.body ?? ''), hash: m.contentHash ?? null, approvedAt: m.approvedAt ?? null });
  }
  return out.sort((a, b) => (a.season < b.season ? 1 : a.season > b.season ? -1 : (a.sourceId < b.sourceId ? -1 : 1)));
}
function memoryMetric(id, kinds) {
  const def = register({
    id, v: 1, family: 'callback', reveal: FW, level: 'league', minKey: 'priorWeeksLo', once: true,
    run(slice, p = {}) {
      const subject = { kind: 'league', id: slice.leagueId };
      const N = currentWeekOf(slice, p);
      const items = closedSeasonMemories(slice.input, N, kinds);
      if (!items.length) return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: 1 });
      // quoted VERBATIM, with attribution; never paraphrased
      return makeMetric({ def, slice, subject, n: items.length, value: { weekNumber: N, items: items.slice(0, 3) }, supportRows: [], level: 'weekly', source: 'archive' });
    },
  });
  return def;
}
export const CB_BLURB = memoryMetric('cb.blurb', ['blurb']);
export const CB_JOKE = memoryMetric('cb.joke', ['joke', 'moment']);
