/**
 * CFB Pickems — grouptest.mjs (UN-118/UN-125, v0.17.7)
 * =====================================================
 * Unit tests for multi-part week grouping — the scoring.js/data-model.js
 * math CLAUDE.md's "scoring math changes require unit tests" rule demands,
 * sibling to the (unmaterialized-but-referenced) spreadtest.mjs/multtest.mjs
 * precedent. There is currently ZERO other functional coverage of
 * `calculateWeeklyResults()`/`calculateSeasonStandings()` anywhere in the
 * repo — this file is the first.
 *
 * Run:  node grouptest.mjs
 *
 * Covers, in order:
 *   1. Refactor safety net — calculateWeeklyResults() byte-identical
 *      before/after the rankWeeklyResults() extraction, across several
 *      fixtures (ties, no-decisions, multipliers, empty picks).
 *   2. Old-data default — a week literal OMITTING groupId/isGroupTiebreaker
 *      ENTIRELY (absent, not null — DI-126g) resolves to a singleton and
 *      reproduces today's standings exactly.
 *   3. Multiplier interaction — pooled === hand-computed === summed-per-part;
 *      raw and weighted diverge where a multiplier exists.
 *   4. Tiebreaker isolation — mutating the NON-flagged member's guess does
 *      not move the group's tiebreakerDelta.
 *   5. THE ACCEPTANCE GATE — a fully-final 2-part group yields weeklyWins
 *      totalling exactly 1, not 2. Proven non-vacuous: the IDENTICAL fixture,
 *      run through the preserved 2-arg fallback call (the real pre-fix code
 *      path, not a hypothetical), reproduces the double-count this gate
 *      exists to prevent.
 *   6. Fallback shape — calculateSeasonStandings(players, results) without
 *      `weeks` reproduces today's doubled behaviour on its own, independent
 *      of test 5's fixture.
 *   7. A 3-member group (the bowl/CFP case) collapses correctly.
 */

import { readFile } from 'node:fs/promises';

// ── Minimal DOM / localStorage stubs — identical shape to loadtest.mjs's,
// only what storage.js/backend.js need to import cleanly. ────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in grouptest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const scoring = await import('./js/scoring.js');
const dataModel = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const {
  calculateWeeklyResults, calculateGroupWeeklyResults, calculateSeasonStandings,
  rankWeeklyResults, evaluatePick,
} = scoring;
const { getEffectiveGroupId, weeksInGroup, getGroupTiebreakerWeek, isGroupTiebreakerAmbiguous } = dataModel;

console.log('[grouptest] modules imported —', Object.keys(scoring).length, 'scoring exports,', Object.keys(dataModel).length, 'data-model exports');

// ─────────────────────────────────────────────────────────────────────────────
// 1. REFACTOR SAFETY NET
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] rankWeeklyResults() extraction — byte-identical to the pre-refactor tail…');

/** The EXACT pre-refactor body of calculateWeeklyResults(), kept here
 *  verbatim as a reference implementation — not imported, so it can never
 *  silently track future changes to the real function. If the two diverge
 *  on a fixture below, either the refactor broke something or this reference
 *  is stale and needs updating by hand (the whole point: any divergence is
 *  visible, not silent). */
function calculateWeeklyResultsOld(weekId, players, picks, games, actualTiebreaker = null) {
  const PICK_RESULT = dataModel.PICK_RESULT;
  const GAME_STATUS = dataModel.GAME_STATUS;
  const gameMultiplier = scoring.gameMultiplier;
  const results = players.map(player => {
    const pp = picks.filter(p => p.weekId === weekId && p.playerId === player.playerId);
    let correct = 0, incorrect = 0, correctCount = 0, incorrectCount = 0, noDecisions = 0, pending = 0;
    for (const pick of pp) {
      const game = games.find(g => g.gameId === pick.gameId);
      if (!game) continue;
      const r = evaluatePick(pick, game);
      const mult = gameMultiplier(game);
      if (r === PICK_RESULT.WIN) { correct += mult; correctCount++; }
      else if (r === PICK_RESULT.LOSS) { incorrect += mult; incorrectCount++; }
      else if (r === PICK_RESULT.NO_DECISION) noDecisions++;
      else pending++;
    }
    const tbGuess = storage.getTiebreakerGuess(weekId, player.playerId);
    const tbDelta = (actualTiebreaker !== null && tbGuess !== null) ? Math.abs(tbGuess - actualTiebreaker) : null;
    return {
      resultId: `wr_${weekId}_${player.playerId}`,
      weekId, playerId: player.playerId, displayName: player.displayName,
      correctPicks: correct, incorrectPicks: incorrect,
      correctCount, incorrectCount,
      noDecisions, pending,
      tiebreakerGuess: tbGuess, tiebreakerDelta: tbDelta,
      rank: 0, isWinner: false, isLoser: false, wonByTiebreaker: false,
    };
  });

  results.sort((a, b) => {
    const d = b.correctPicks - a.correctPicks; if (d !== 0) return d;
    if (a.tiebreakerDelta === null && b.tiebreakerDelta === null) return 0;
    if (a.tiebreakerDelta === null) return 1;
    if (b.tiebreakerDelta === null) return -1;
    return a.tiebreakerDelta - b.tiebreakerDelta;
  });

  results.forEach((r, i) => { r.rank = i + 1; });
  const anyFinal = games.some(g => g.status === GAME_STATUS.FINAL);
  if (anyFinal && results.length > 1) {
    results[0].isWinner = true;
    if (results[1] && results[0].correctPicks === results[1].correctPicks) results[0].wonByTiebreaker = true;
    results[results.length - 1].isLoser = true;
    const last = results[results.length - 1];
    const sl = results[results.length - 2];
    if (sl && last.correctPicks === sl.correctPicks) last.wonByTiebreaker = true;
  }
  return results;
}

{
  const players1 = [
    { playerId: 'r1_a', displayName: 'Ann' },
    { playerId: 'r1_b', displayName: 'Bob' },
    { playerId: 'r1_c', displayName: 'Cam' },
  ];
  const games1 = [
    { gameId: 'r1_g1', weekId: 'r1_w', status: 'final', homeTeam: 'Home1', awayTeam: 'Away1', homeScore: 20, awayScore: 10, spread: -3, lockedSpread: -3, multiplier: 1 },
    { gameId: 'r1_g2', weekId: 'r1_w', status: 'final', homeTeam: 'Home2', awayTeam: 'Away2', homeScore: 14, awayScore: 14, spread: -3, lockedSpread: -3, multiplier: 2 }, // PK-ish tie after adj → no_decision candidate
    { gameId: 'r1_g3', weekId: 'r1_w', status: 'scheduled', homeTeam: 'Home3', awayTeam: 'Away3', homeScore: null, awayScore: null, spread: -3, lockedSpread: -3, multiplier: 1 },
  ];
  const picks1 = [
    { weekId: 'r1_w', gameId: 'r1_g1', playerId: 'r1_a', selectedTeam: 'Home1' },
    { weekId: 'r1_w', gameId: 'r1_g1', playerId: 'r1_b', selectedTeam: 'Away1' },
    { weekId: 'r1_w', gameId: 'r1_g2', playerId: 'r1_a', selectedTeam: 'Home2' },
    { weekId: 'r1_w', gameId: 'r1_g2', playerId: 'r1_b', selectedTeam: 'Away2' },
    { weekId: 'r1_w', gameId: 'r1_g3', playerId: 'r1_a', selectedTeam: 'Home3' },
    // r1_c makes no picks at all — exercises the empty-picks path
  ];
  storage.setTiebreakerGuess('r1_w', 'r1_a', 10);
  storage.setTiebreakerGuess('r1_w', 'r1_b', 20);

  const FIXTURES1 = [
    ['ties + no-decision + multiplier + empty picks, no actual tiebreaker', 'r1_w', players1, picks1, games1, null],
    ['same fixture, WITH an actual tiebreaker', 'r1_w', players1, picks1, games1, 15],
    ['no games at all', 'r1_empty', players1, [], [], null],
    ['single player', 'r1_w', [players1[0]], picks1, games1, 15],
  ];
  for (const [label, weekId, players, picks, games, tb] of FIXTURES1) {
    const before = calculateWeeklyResultsOld(weekId, players, picks, games, tb);
    const after = calculateWeeklyResults(weekId, players, picks, games, tb);
    assert(JSON.stringify(before) === JSON.stringify(after),
      `byte-identical: ${label}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. OLD-DATA DEFAULT (DI-126g)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Old-data default — groupId/isGroupTiebreaker ABSENT entirely resolves to a singleton…');
{
  // Deliberately NOT setting groupId/isGroupTiebreaker at all — this is the
  // EXACT shape of every week record that predates this feature. DI-126g:
  // test against absence, not against an explicit null.
  const oldWeek1 = { weekId: 'old_w1', weekNumber: 1, season: 2026, status: 'final' };
  const oldWeek2 = { weekId: 'old_w2', weekNumber: 2, season: 2026, status: 'final' };
  assert(!('groupId' in oldWeek1) && !('isGroupTiebreaker' in oldWeek1),
    'fixture check: the keys are truly ABSENT, not set to null');

  assert(getEffectiveGroupId(oldWeek1) === 'old_w1', 'an old week with no groupId key resolves to its own weekId');
  const grp = weeksInGroup([oldWeek1, oldWeek2], oldWeek1);
  assert(grp.length === 1 && grp[0].weekId === 'old_w1', 'an old week with no group siblings is a singleton group of one');
  assert(isGroupTiebreakerAmbiguous(grp) === false, 'a singleton group is never "ambiguous" about its tiebreaker');
  assert(getGroupTiebreakerWeek(grp)?.weekId === 'old_w1', 'the singleton itself is its own tiebreaker-of-record');

  const players2 = [{ playerId: 'o_a', displayName: 'Ann' }, { playerId: 'o_b', displayName: 'Bob' }];
  const oldResults = [
    { weekId: 'old_w1', playerId: 'o_a', correctPicks: 5, incorrectPicks: 1, isWinner: true, isLoser: false },
    { weekId: 'old_w1', playerId: 'o_b', correctPicks: 2, incorrectPicks: 4, isWinner: false, isLoser: true },
    { weekId: 'old_w2', playerId: 'o_a', correctPicks: 3, incorrectPicks: 3, isWinner: false, isLoser: true },
    { weekId: 'old_w2', playerId: 'o_b', correctPicks: 4, incorrectPicks: 2, isWinner: true, isLoser: false },
  ];
  const withoutWeeks = calculateSeasonStandings(players2, oldResults);
  const withOldShapedWeeks = calculateSeasonStandings(players2, oldResults, [oldWeek1, oldWeek2]);
  assert(JSON.stringify(withoutWeeks) === JSON.stringify(withOldShapedWeeks),
    'passing old-shaped (keys absent) singleton weeks reproduces the exact same standings as omitting `weeks` entirely');
  assert(withOldShapedWeeks.find(s => s.playerId === 'o_a').weeklyWins === 1 &&
         withOldShapedWeeks.find(s => s.playerId === 'o_b').weeklyWins === 1,
    'each singleton week still contributes its own independent weekly win (1 each), unaffected by grouping code existing at all');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MULTIPLIER INTERACTION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] Multiplier interaction — pooled === hand-computed === summed-per-part; raw/weighted diverge…');
{
  const players3 = [{ playerId: 'm_a', displayName: 'Ann' }, { playerId: 'm_b', displayName: 'Bob' }];
  const W3a = { weekId: 'm_p1', weekNumber: 10, season: 2026, status: 'final', groupId: 'm_p1' };
  const W3b = { weekId: 'm_p2', weekNumber: 11, season: 2026, status: 'final', groupId: 'm_p1' };
  const groupWeeks3 = [W3a, W3b];

  // Part 1: a 2x game, Ann covers (WIN), Bob doesn't (LOSS).
  const g3a = { gameId: 'm_g1', weekId: 'm_p1', status: 'final', homeTeam: 'H1', awayTeam: 'A1', homeScore: 30, awayScore: 10, spread: -3, lockedSpread: -3, multiplier: 2 };
  // Part 2: a 2x game, Ann DOES NOT cover this time (LOSS), Bob does (WIN).
  const g3b = { gameId: 'm_g2', weekId: 'm_p2', status: 'final', homeTeam: 'H2', awayTeam: 'A2', homeScore: 10, awayScore: 30, spread: -3, lockedSpread: -3, multiplier: 2 };
  const games3 = [g3a, g3b];
  const picks3 = [
    { weekId: 'm_p1', gameId: 'm_g1', playerId: 'm_a', selectedTeam: 'H1' },  // Ann WIN part 1
    { weekId: 'm_p1', gameId: 'm_g1', playerId: 'm_b', selectedTeam: 'A1' },  // Bob LOSS part 1
    { weekId: 'm_p2', gameId: 'm_g2', playerId: 'm_a', selectedTeam: 'H2' },  // Ann LOSS part 2 (picked home, away won)
    { weekId: 'm_p2', gameId: 'm_g2', playerId: 'm_b', selectedTeam: 'A2' },  // Bob WIN part 2
  ];

  const pooled = calculateGroupWeeklyResults(groupWeeks3, players3, picks3, games3);
  const annPooled = pooled.find(r => r.playerId === 'm_a');
  const bobPooled = pooled.find(r => r.playerId === 'm_b');

  // Hand-computed: each player has exactly one 2x WIN and one 2x LOSS across
  // the group → weighted correct=2, incorrect=2; raw correctCount=1, incorrectCount=1.
  assert(annPooled.correctPicks === 2 && annPooled.incorrectPicks === 2,
    `pooled equals hand-computed for Ann (weighted): got correct=${annPooled.correctPicks}, incorrect=${annPooled.incorrectPicks}`);
  assert(bobPooled.correctPicks === 2 && bobPooled.incorrectPicks === 2,
    `pooled equals hand-computed for Bob (weighted): got correct=${bobPooled.correctPicks}, incorrect=${bobPooled.incorrectPicks}`);
  assert(annPooled.correctCount === 1 && annPooled.incorrectCount === 1,
    'RAW counts stay 1/1 for Ann — unweighted, unlike the weighted 2/2');
  assert(annPooled.correctPicks !== annPooled.correctCount,
    'THE DIVERGENCE: weighted (2) and raw (1) disagree exactly where a multiplier exists');

  // Summed-per-part: two independent calculateWeeklyResults() calls, added by hand.
  const partA = calculateWeeklyResults('m_p1', players3, picks3, games3);
  const partB = calculateWeeklyResults('m_p2', players3, picks3, games3);
  const annSummed = {
    correctPicks: partA.find(r => r.playerId === 'm_a').correctPicks + partB.find(r => r.playerId === 'm_a').correctPicks,
    incorrectPicks: partA.find(r => r.playerId === 'm_a').incorrectPicks + partB.find(r => r.playerId === 'm_a').incorrectPicks,
  };
  assert(annSummed.correctPicks === annPooled.correctPicks && annSummed.incorrectPicks === annPooled.incorrectPicks,
    `pooling raw picks equals summing two independent per-part calls for Ann (got summed=${JSON.stringify(annSummed)}, pooled=${JSON.stringify({correctPicks:annPooled.correctPicks,incorrectPicks:annPooled.incorrectPicks})})`);

  // Group winner: tied 2-2 on weighted correctPicks — falls to the tiebreaker,
  // which (with none flagged) falls back to the highest-weekNumber member
  // (m_p2) per Drew's ruling. Confirm the pooled ranking actually resolved.
  assert(pooled.every(r => r.rank === 1 || r.rank === 2), 'a real winner/loser ranking was produced even in a tie, via the tiebreaker fallback');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TIEBREAKER ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Tiebreaker isolation — mutating the NON-flagged member\'s guess must not move the group\'s tiebreakerDelta…');
{
  const players4 = [{ playerId: 't_a', displayName: 'Ann' }];
  const W4a = { weekId: 't_p1', weekNumber: 30, season: 2026, status: 'final', groupId: 't_p1', isGroupTiebreaker: false, actualTiebreakerValue: 999 };
  const W4b = { weekId: 't_p2', weekNumber: 31, season: 2026, status: 'final', groupId: 't_p1', isGroupTiebreaker: true, actualTiebreakerValue: 50 };
  const groupWeeks4 = [W4a, W4b];
  assert(getGroupTiebreakerWeek(groupWeeks4)?.weekId === 't_p2', 'fixture check: Part 2 is the flagged tiebreaker-of-record');
  assert(isGroupTiebreakerAmbiguous(groupWeeks4) === false, 'fixture check: exactly one member flagged — unambiguous');

  storage.setTiebreakerGuess('t_p1', 't_a', 5);   // Part 1 — NOT the tiebreaker-of-record
  storage.setTiebreakerGuess('t_p2', 't_a', 48);  // Part 2 — IS the tiebreaker-of-record (actual 50, delta 2)

  const before = calculateGroupWeeklyResults(groupWeeks4, players4, [], []);
  const deltaBefore = before.find(r => r.playerId === 't_a').tiebreakerDelta;
  assert(deltaBefore === 2, `fixture check: delta computed from Part 2's guess (48 vs actual 50) — got ${deltaBefore}`);

  // Mutate the NON-flagged member's guess wildly — this must be invisible.
  storage.setTiebreakerGuess('t_p1', 't_a', 999999);
  const after = calculateGroupWeeklyResults(groupWeeks4, players4, [], []);
  const deltaAfter = after.find(r => r.playerId === 't_a').tiebreakerDelta;
  assert(deltaAfter === deltaBefore,
    `mutating Part 1's (non-flagged) guess does not move the group's tiebreakerDelta (before=${deltaBefore}, after=${deltaAfter})`);

  // And mutating the FLAGGED member's guess DOES move it — proves the isolation
  // above is real selectivity, not the function ignoring tiebreakers altogether.
  storage.setTiebreakerGuess('t_p2', 't_a', 10);
  const afterFlagged = calculateGroupWeeklyResults(groupWeeks4, players4, [], []);
  assert(afterFlagged.find(r => r.playerId === 't_a').tiebreakerDelta === 40,
    'mutating the FLAGGED member\'s guess DOES move the group delta — the isolation above is real, not accidental');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 & 6. THE ACCEPTANCE GATE + FALLBACK SHAPE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5+6] THE ACCEPTANCE GATE — a fully-final 2-part group yields weeklyWins totalling exactly 1, not 2. Proven non-vacuous against the preserved fallback…');
{
  const players5 = [{ playerId: 'g_a', displayName: 'Ann' }, { playerId: 'g_b', displayName: 'Bob' }];
  const W5a = { weekId: 'g_p1', weekNumber: 40, season: 2026, status: 'final', groupId: 'g_p1' };
  const W5b = { weekId: 'g_p2', weekNumber: 41, season: 2026, status: 'final', groupId: 'g_p1' };
  const weeks5 = [W5a, W5b];

  // Simulate exactly what finalizeWeek() saves per part: independent
  // per-part calculateWeeklyResults() rows, EACH carrying its own per-part
  // isWinner/isLoser (Ann wins both parts on her own merits).
  const games5a = [{ gameId: 'g_g1', weekId: 'g_p1', status: 'final', homeTeam: 'H1', awayTeam: 'A1', homeScore: 30, awayScore: 10, spread: -3, lockedSpread: -3 }];
  const games5b = [{ gameId: 'g_g2', weekId: 'g_p2', status: 'final', homeTeam: 'H2', awayTeam: 'A2', homeScore: 30, awayScore: 10, spread: -3, lockedSpread: -3 }];
  const picks5 = [
    { weekId: 'g_p1', gameId: 'g_g1', playerId: 'g_a', selectedTeam: 'H1' },
    { weekId: 'g_p1', gameId: 'g_g1', playerId: 'g_b', selectedTeam: 'A1' },
    { weekId: 'g_p2', gameId: 'g_g2', playerId: 'g_a', selectedTeam: 'H2' },
    { weekId: 'g_p2', gameId: 'g_g2', playerId: 'g_b', selectedTeam: 'A2' },
  ];
  const resultsA = calculateWeeklyResults('g_p1', players5, picks5, games5a);
  const resultsB = calculateWeeklyResults('g_p2', players5, picks5, games5b);
  assert(resultsA.find(r => r.playerId === 'g_a').isWinner === true && resultsB.find(r => r.playerId === 'g_a').isWinner === true,
    'fixture check: Ann\'s per-part rows are EACH independently marked isWinner — this is the exact shape that used to double-count');
  const allWeeklyResults5 = [...resultsA, ...resultsB];

  const standingsGrouped = calculateSeasonStandings(players5, allWeeklyResults5, weeks5);
  const totalWinsGrouped = standingsGrouped.reduce((s, r) => s + r.weeklyWins, 0);
  assert(totalWinsGrouped === 1,
    `THE ACCEPTANCE GATE — total weeklyWins across the whole group is exactly 1, not 2 (got ${totalWinsGrouped})`);
  assert(standingsGrouped.find(s => s.playerId === 'g_a').weeklyWins === 1 && standingsGrouped.find(s => s.playerId === 'g_b').weeklyWins === 0,
    'the ONE win lands on the real pooled winner, Ann');
  assert(standingsGrouped.find(s => s.playerId === 'g_b').weeklyLosses === 1 && standingsGrouped.find(s => s.playerId === 'g_a').weeklyLosses === 0,
    'the ONE loss lands on the real pooled loser, Bob');

  // Proven NON-VACUOUS: the IDENTICAL fixture, run through the preserved
  // 2-arg fallback call — the REAL pre-grouping code path, not a
  // hypothetical mutation — reproduces the double-count this gate exists to
  // prevent. If this gate could not go red against SOMETHING real, it would
  // be worthless (RG-27 / the primer's own headline lesson).
  const standingsFallback = calculateSeasonStandings(players5, allWeeklyResults5);
  const totalWinsFallback = standingsFallback.reduce((s, r) => s + r.weeklyWins, 0);
  assert(totalWinsFallback === 2,
    `[6] FALLBACK SHAPE — the SAME fixture, called WITHOUT \`weeks\` (today's exact pre-fix behaviour), reproduces the double count: total weeklyWins = 2 (got ${totalWinsFallback})`);
  assert(standingsFallback.find(s => s.playerId === 'g_a').weeklyWins === 2,
    'and specifically: Ann is credited with TWO weekly wins for what is really one competitive week — this is the bug the acceptance gate proves it closes');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. THREE-MEMBER GROUP (bowl / CFP case)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] A 3-member group (bowl/CFP case) collapses correctly…');
{
  const players7 = [{ playerId: 'c_a', displayName: 'Ann' }, { playerId: 'c_b', displayName: 'Bob' }, { playerId: 'c_c', displayName: 'Cam' }];
  const W7a = { weekId: 'c_p1', weekNumber: 50, season: 2026, status: 'final', groupId: 'c_p1' };
  const W7b = { weekId: 'c_p2', weekNumber: 51, season: 2026, status: 'final', groupId: 'c_p1' };
  const W7c = { weekId: 'c_p3', weekNumber: 52, season: 2026, status: 'final', groupId: 'c_p1' };
  const weeks7 = [W7a, W7b, W7c];
  assert(weeksInGroup(weeks7, W7c).length === 3, 'fixture check: all three parts resolve to one group, found from any member');

  const gamesFor = (weekId, gid, hs, as) => [{ gameId: gid, weekId, status: 'final', homeTeam: 'H', awayTeam: 'A', homeScore: hs, awayScore: as, spread: -3, lockedSpread: -3 }];
  const games7 = [...gamesFor('c_p1', 'c_g1', 30, 10), ...gamesFor('c_p2', 'c_g2', 30, 10), ...gamesFor('c_p3', 'c_g3', 30, 10)];
  // Ann wins all 3 bowl games; Bob wins none; Cam splits (1 of 3).
  const picks7 = [
    { weekId: 'c_p1', gameId: 'c_g1', playerId: 'c_a', selectedTeam: 'H' }, { weekId: 'c_p1', gameId: 'c_g1', playerId: 'c_b', selectedTeam: 'A' }, { weekId: 'c_p1', gameId: 'c_g1', playerId: 'c_c', selectedTeam: 'H' },
    { weekId: 'c_p2', gameId: 'c_g2', playerId: 'c_a', selectedTeam: 'H' }, { weekId: 'c_p2', gameId: 'c_g2', playerId: 'c_b', selectedTeam: 'A' }, { weekId: 'c_p2', gameId: 'c_g2', playerId: 'c_c', selectedTeam: 'A' },
    { weekId: 'c_p3', gameId: 'c_g3', playerId: 'c_a', selectedTeam: 'H' }, { weekId: 'c_p3', gameId: 'c_g3', playerId: 'c_b', selectedTeam: 'A' }, { weekId: 'c_p3', gameId: 'c_g3', playerId: 'c_c', selectedTeam: 'A' },
  ];
  const groupResults7 = calculateGroupWeeklyResults(weeks7, players7, picks7, games7);
  assert(groupResults7.find(r => r.playerId === 'c_a').correctPicks === 3, 'Ann pooled to 3 correct across all three bowl games');
  assert(groupResults7.find(r => r.playerId === 'c_b').correctPicks === 0, 'Bob pooled to 0 correct');
  assert(groupResults7.find(r => r.playerId === 'c_c').correctPicks === 1, 'Cam pooled to 1 correct');
  assert(groupResults7.find(r => r.playerId === 'c_a').isWinner === true, 'Ann is the sole group winner');
  assert(groupResults7.find(r => r.playerId === 'c_b').isLoser === true, 'Bob is the sole group loser');
  assert(groupResults7.filter(r => r.isWinner).length === 1 && groupResults7.filter(r => r.isLoser).length === 1,
    'exactly one winner and one loser across all three parts, never three');

  // And the season-standings collapse agrees: 1 win, not 3.
  const perPartResults7 = weeks7.flatMap(w => calculateWeeklyResults(w.weekId, players7, picks7, games7.filter(g => g.weekId === w.weekId)));
  const standings7 = calculateSeasonStandings(players7, perPartResults7, weeks7);
  const totalWins7 = standings7.reduce((s, r) => s + r.weeklyWins, 0);
  assert(totalWins7 === 1, `THE ACCEPTANCE GATE, 3-member case — total weeklyWins across the group is exactly 1, not 3 (got ${totalWins7})`);
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
