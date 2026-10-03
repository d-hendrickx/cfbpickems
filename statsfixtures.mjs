/**
 * CFB Pickems — statsfixtures.mjs (Social Platform v1 Home, 2026-09-30)
 * ====================================================================
 * Shared FIXTURE BUILDERS for statstest.mjs and feedcardstest.mjs. Plain data in,
 * plain data out: no assertions, no DOM, no storage, no imports — so it is not a
 * suite (loadtest.mjs does not spawn it) and cannot contaminate either test's module
 * graph. Results rows are built by the CALLER's real `calculateWeeklyResults`, passed in,
 * so every fixture's rows are exactly what production would have stored.
 *
 * THE LEAGUE: six players, two weeks. Every outcome below was derived BY HAND, then the
 * tests assert the hand-derived numbers — the tests do not recompute them through the
 * code under test.
 *
 *   Game kinds (spread is HOME-perspective, negative = home favored):
 *     cover  spread -3, home 24 - away 10   -> home covers; away picks lose
 *     upset  spread -7, home 17 - away 20   -> the AWAY underdog covers AND wins outright
 *     push   spread -3, home 24 - away 21   -> adjusted 21 = 21: no decision, every pick is a push
 *   Outcome strings are six characters, players p1..p6 in order: W = a winning pick,
 *   L = a losing pick, P = a push, - = no pick.
 *
 *   WEEK 1 (5 games, always final)            p1  p2  p3  p4  p5  p6
 *     g11 cover   L L L L W L   (p5 stands alone)
 *     g12 cover   W L W L L W
 *     g13 upset   W L L W W L   (p1, p4, p5 called the upset)
 *     g14 cover   W W L W L L
 *     g15 cover   W W W L W L
 *     sequences   LWWWW  LLLWW  LWLLW  LLWWL  WLWLW  LWLLL        -> 4-1  2-3  2-3  2-3  3-2  1-4
 *     winner p1 (4-1), loser p6 (1-4); p1 ends on a 4-cover run, p6 on a 3-miss run.
 *
 *   WEEK 2 (4 games)
 *     g21 upset   L W L W W W   (p2, p4, p5, p6 called it)
 *     g22 cover   L L L L W L   (p5 stands alone)
 *     g23 cover   W W L L W L
 *     g24 cover   L W L W W W
 *     sequences   LLWL   WLWW   LLLL   WLLW   WWWW   WLLW         -> 1-3  3-1  0-4  2-2  4-0  2-2
 *     winner p5 (4-0), loser p3 (0-4).
 *
 *   Season ranks after W1: p1 1, p5 2, p2 3, p3 4, p4 5, p6 6.
 *   Season ranks after W2: p5 1, p1 2, p2 3, p4 4, p6 5, p3 6   (totals 7,5,5,4,3,2).
 *   Streaks THROUGH W2: p1 broken (4 covers), p3 extended (4 misses), p5 extended (5 covers),
 *   p6 broken (3 misses); through W1: p1 extended (4 covers), p6 extended (3 misses).
 */

export const PLAYERS = [
  { playerId: 'p1', displayName: 'Drew',    initials: 'DH', active: true, almaMater: 'Texas A&M' },
  { playerId: 'p2', displayName: 'Brayden', initials: 'BR', active: true, almaMater: 'Oklahoma' },
  { playerId: 'p3', displayName: 'Kevin',   initials: 'KC', active: true, almaMater: 'Notre Dame' },
  { playerId: 'p4', displayName: 'Koby',    initials: 'KR', active: true, almaMater: 'USC' },
  { playerId: 'p5', displayName: 'Jacob',   initials: 'JP', active: true, almaMater: 'Arkansas' },
  { playerId: 'p6', displayName: 'Kihoon',  initials: 'KB', active: true, almaMater: 'Texas A&M' },
];

const KIND = {
  cover: { spread: -3, hs: 24, as: 10 },
  upset: { spread: -7, hs: 17, as: 20 },
  push:  { spread: -3, hs: 24, as: 21 },
};

/** A game record shaped like createGame()'s, with the fields the code under test reads. */
export function mkGame({ id, weekId, kick, home, away, kind = 'cover', state = 'final', extra = {} }) {
  const k = KIND[kind];
  const base = {
    gameId: id, weekId, homeTeam: home, awayTeam: away, kickoff: kick,
    spread: k.spread, lockedSpread: k.spread, favorite: null,
    homeScore: null, awayScore: null, status: 'scheduled',
    atsWinner: null, multiplier: 1, isAlmaMaterGame: false,
    updatedAt: kick, lastUpdated: null,
  };
  if (state === 'final') { base.status = 'final'; base.homeScore = k.hs; base.awayScore = k.as; base.lastUpdated = kick; }
  else if (state === 'live') { base.status = 'live'; base.homeScore = 7; base.awayScore = 3; }
  return { ...base, ...extra };
}

/** The team a given outcome code picks, for a game of this kind. */
export function pickTeam(game, kind, code) {
  if (code === 'P') return game.homeTeam;
  if (kind === 'upset') return code === 'W' ? game.awayTeam : game.homeTeam;
  return code === 'W' ? game.homeTeam : game.awayTeam;
}

/** One pick record per non-'-' character of `out`, for p1..p6. */
export function mkPicks(game, kind, out, players = PLAYERS) {
  const picks = [];
  out.split('').forEach((code, i) => {
    if (code === '-' || !players[i]) return;
    picks.push({ pickId: `pk_${game.gameId}_${players[i].playerId}`, weekId: game.weekId, gameId: game.gameId, playerId: players[i].playerId, selectedTeam: pickTeam(game, kind, code) });
  });
  return picks;
}

export function mkWeek({ id, n, status, extra = {} }) {
  return {
    weekId: id, season: '2026', weekNumber: n, label: `Week ${n}`, status,
    dataSourceMode: 'espn_live', showInHistory: true, groupId: null,
    picksOpenAt: null, picksLockAt: null, createdAt: `2026-09-0${n}T00:00:00.000Z`,
    finalizedAt: status === 'final' ? `2026-09-${{ 1: '07', 2: '14', 3: '21' }[n] || '28'}T06:00:00.000Z` : null,
    ...extra,
  };
}

const W1_SPEC = [
  { id: 'g11', home: 'Clemson',    away: 'Duke',       kind: 'cover', out: 'LLLLWL', kick: '2026-09-05T16:00:00.000Z' },
  { id: 'g12', home: 'Georgia',    away: 'Auburn',     kind: 'cover', out: 'WLWLLW', kick: '2026-09-05T17:00:00.000Z' },
  { id: 'g13', home: 'Texas',      away: 'Oklahoma',   kind: 'upset', out: 'WLLWWL', kick: '2026-09-05T18:00:00.000Z' },
  { id: 'g14', home: 'Ohio State', away: 'Michigan',   kind: 'cover', out: 'WWLWLL', kick: '2026-09-05T19:00:00.000Z' },
  { id: 'g15', home: 'Alabama',    away: 'LSU',        kind: 'cover', out: 'WWWLWL', kick: '2026-09-05T20:00:00.000Z' },
];
const W2_SPEC = [
  { id: 'g21', home: 'Oregon',     away: 'Washington', kind: 'upset', out: 'LWLWWW', kick: '2026-09-12T16:00:00.000Z' },
  { id: 'g22', home: 'Miami',      away: 'Florida State', kind: 'cover', out: 'LLLLWL', kick: '2026-09-12T17:00:00.000Z' },
  { id: 'g23', home: 'Penn State', away: 'Iowa',       kind: 'cover', out: 'WWLLWL', kick: '2026-09-12T18:00:00.000Z' },
  { id: 'g24', home: 'USC',        away: 'UCLA',       kind: 'cover', out: 'LWLWWW', kick: '2026-09-12T19:00:00.000Z' },
];

/**
 * The two-week league. `w2` is the week-2 STATE under test:
 *   'open' | 'locked'  all four games scheduled
 *   'live'             g21 final, g22 live, g23 / g24 scheduled
 *   'final'            all four final, week-2 results rows present
 * Picks for EVERY player are always present (the local-mode-shaped, adversarial store —
 * S-C4 Fixture A: nothing here is narrowed by RLS).
 * `staleW2Rows: true` leaves week-2 results rows in storage even though week 2 is not
 * final (a reopened week keeps its old rows) — the adversarial case for the S-C2 view.
 * `w2Finals: ['g21']` forces those week-2 games FINAL whatever the week's state is (RG-45:
 * a final game can sit inside an OPEN week).
 * `w3: true` adds a FINAL week 3 (weekNumber 3, two games g31 / g32, picks and results) AFTER
 * week 2 — so week 2 can be a non-final week sitting BETWEEN two final ones, the case where
 * only the S-C2 revealed view keeps its stale rows out of week 3's streaks and ranks:
 *     g31 cover   W W L L W L        g32 cover   W W L L W L
 *     p1 WW  p2 WW  p3 LL  p4 LL  p5 WW  p6 LL      -> 2-0, 2-0, 0-2, 0-2, 2-0, 0-2
 *   Through week 3 WITHOUT week 2 (week 2 hidden): p1 6-cover run, p2 4, p5 3, p4 3-miss run, p6 5-miss run, p3 2 misses.
 */
export function buildLeague({ w2 = 'final', calculateWeeklyResults, staleW2Rows = false, w2Finals = [], w3 = false } = {}) {
  const players = PLAYERS.map(p => ({ ...p }));
  const weeks = [mkWeek({ id: 'w1', n: 1, status: 'final' }), mkWeek({ id: 'w2', n: 2, status: w2 })];
  if (w3) weeks.push(mkWeek({ id: 'w3', n: 3, status: 'final' }));
  const games = [], picks = [];
  for (const g of W1_SPEC) {
    const game = mkGame({ id: g.id, weekId: 'w1', kick: g.kick, home: g.home, away: g.away, kind: g.kind, state: 'final' });
    games.push(game); picks.push(...mkPicks(game, g.kind, g.out));
  }
  W2_SPEC.forEach((g, i) => {
    let state = w2 === 'final' ? 'final' : w2 === 'live' ? (i === 0 ? 'final' : i === 1 ? 'live' : 'scheduled') : 'scheduled';
    if (w2Finals.includes(g.id)) state = 'final';
    const game = mkGame({ id: g.id, weekId: 'w2', kick: g.kick, home: g.home, away: g.away, kind: g.kind, state });
    games.push(game); picks.push(...mkPicks(game, g.kind, g.out));
  });
  if (w3) {
    for (const g of W3_SPEC) {
      const game = mkGame({ id: g.id, weekId: 'w3', kick: g.kick, home: g.home, away: g.away, kind: g.kind, state: 'final' });
      games.push(game); picks.push(...mkPicks(game, g.kind, g.out));
    }
  }
  const weeklyResults = [];
  if (typeof calculateWeeklyResults === 'function') {
    weeklyResults.push(...calculateWeeklyResults('w1', players, picks, games.filter(g => g.weekId === 'w1')));
    if (w2 === 'final' || staleW2Rows) {
      // A stale set must be FINAL-shaped to be adversarial: grade it as though every game had finished.
      const gradedGames = games.filter(g => g.weekId === 'w2').map(g => (g.status === 'final' ? g : { ...g, ...finalScores(g) }));
      weeklyResults.push(...calculateWeeklyResults('w2', players, picks, gradedGames));
    }
    if (w3) weeklyResults.push(...calculateWeeklyResults('w3', players, picks, games.filter(g => g.weekId === 'w3')));
  }
  return { players, weeks, games, picks, weeklyResults };
}

const W3_SPEC = [
  { id: 'g31', home: 'Tennessee', away: 'Kentucky', kind: 'cover', out: 'WWLLWL', kick: '2026-09-19T16:00:00.000Z' },
  { id: 'g32', home: 'Florida',   away: 'Georgia Tech', kind: 'cover', out: 'WWLLWL', kick: '2026-09-19T17:00:00.000Z' },
];

function finalScores(g) {
  const spec = W2_SPEC.find(s => s.id === g.gameId);
  const k = KIND[spec.kind];
  return { status: 'final', homeScore: k.hs, awayScore: k.as };
}

/**
 * ONE player (p1), one graded pick per code of `codes` ('W' | 'L' | 'P'), one game per
 * code in strict kickoff order, split into weeks by `weekSizes` (e.g. [5] or [3, 2]).
 * Returns the full league-shaped bundle plus `kinds`, for the SD-11 streak vectors.
 */
export function buildSequence({ codes, weekSizes, calculateWeeklyResults }) {
  const players = [{ ...PLAYERS[0] }];
  const weeks = [], games = [], picks = [];
  let at = 0;
  weekSizes.forEach((size, wi) => {
    const weekId = `s${wi + 1}`;
    weeks.push(mkWeek({ id: weekId, n: wi + 1, status: 'final' }));
    for (let i = 0; i < size; i++) {
      const code = codes[at];
      const kind = code === 'P' ? 'push' : 'cover';
      const kick = new Date(Date.UTC(2026, 8, 5 + wi * 7, 12 + i)).toISOString();
      const game = mkGame({ id: `q${at + 1}`, weekId, kick, home: `H${at + 1}`, away: `A${at + 1}`, kind, state: 'final' });
      games.push(game); picks.push(...mkPicks(game, kind, code, players));
      at++;
    }
  });
  const weeklyResults = typeof calculateWeeklyResults === 'function'
    ? weeks.flatMap(w => calculateWeeklyResults(w.weekId, players, picks, games.filter(g => g.weekId === w.weekId)))
    : [];
  return { players, weeks, games, picks, weeklyResults };
}

/** A pick's graded result for a sequence code, spelled out. */
export const RESULT_OF = { W: 'win', L: 'loss', P: 'no_decision' };

/**
 * The inputs `detectWeekSignals` is run over for the BYTE-IDENTICAL SCRIBE proof (DI-360).
 * statstest compares the live detector's JSON output for each label against GOLDEN_SIGNALS,
 * which was captured from the PRE-EXTRACTION js/scribeLines.js (commit c2da987) by running
 * these exact inputs through it. Deterministic by construction: no clocks, no randomness.
 */
export function goldenInputs({ calculateWeeklyResults, calculateSeasonStandings }) {
  const cases = [];
  const rowsOf = (L, weekIds) => L.weeklyResults.filter(r => weekIds.includes(r.weekId));
  const L2 = buildLeague({ w2: 'final', calculateWeeklyResults });
  const after1 = calculateSeasonStandings(L2.players, rowsOf(L2, ['w1']), L2.weeks);
  const after2 = calculateSeasonStandings(L2.players, rowsOf(L2, ['w1', 'w2']), L2.weeks);
  const before1 = calculateSeasonStandings(L2.players, [], L2.weeks);
  const base = { games: L2.games, picks: L2.picks, players: L2.players, weeks: L2.weeks };
  // What the call site really hands the detector at week 1's finalize: week 1's data and nothing later.
  const only1 = { games: L2.games.filter(g => g.weekId === 'w1'), picks: L2.picks.filter(p => p.weekId === 'w1'), players: L2.players, weeks: L2.weeks.filter(w => w.weekId === 'w1') };
  cases.push({ label: 'league w1 finalize, week-1 data only (lone wolf p5, extended streaks p1 covers 4 / p6 misses 3)', input: { ...only1, weekId: 'w1', weekStatus: 'final', standingsBefore: before1, standingsAfter: after1 } });
  cases.push({ label: 'league w2 finalize (lone wolf p5, broken/extended streaks, chart lead change)', input: { ...base, weekId: 'w2', weekStatus: 'final', standingsBefore: after1, standingsAfter: after2 } });
  cases.push({ label: 'league w2 finalize, no standings supplied', input: { ...base, weekId: 'w2', weekStatus: 'final' } });
  cases.push({ label: 'league w1 at lock, week-1 data only (unanimous gate)', input: { ...only1, weekId: 'w1', weekStatus: 'locked' } });
  cases.push({ label: 'league w2 with a later-than-w1 dataset while OPEN (blind rule: unanimous never detected)', input: { ...base, weekId: 'w2', weekStatus: 'open' } });
  // unanimous: every submitter took the same side of one game — detected from LOCKED on, never while OPEN or with no status
  {
    const wk = mkWeek({ id: 'u1', n: 9, status: 'locked' });
    const ug = mkGame({ id: 'ug1', weekId: 'u1', kick: '2026-10-03T16:00:00.000Z', home: 'Utah', away: 'BYU', kind: 'cover', state: 'scheduled' });
    const up = mkPicks(ug, 'cover', 'WWWWWW');
    for (const st of ['open', 'locked', 'live', 'final', null]) {
      cases.push({ label: `unanimous game, week status ${st}`, input: { weekId: 'u1', weekStatus: st, games: [ug], picks: up, players: PLAYERS, weeks: [wk] } });
    }
  }
  // a milestone crossing (24 -> 25) and a non-crossing, on hand-written standings rows
  cases.push({ label: 'milestone 24 -> 25 for p1, 49 -> 50 for p2, 10 -> 12 for p3', input: {
    ...base, weekId: 'w2', weekStatus: 'final',
    standingsBefore: [{ playerId: 'p1', totalCorrectCount: 24 }, { playerId: 'p2', totalCorrectCount: 49 }, { playerId: 'p3', totalCorrectCount: 10 }],
    standingsAfter: [{ playerId: 'p1', totalCorrectCount: 25 }, { playerId: 'p2', totalCorrectCount: 50 }, { playerId: 'p3', totalCorrectCount: 12 }],
  } });
  // SD-11 sequences — each ends in the week named by weekId
  const seqs = [
    ['WWPWL', [4, 1], 's2'], ['WLWWW', [5], 's1'], ['WWPWLWW', [5, 2], 's2'], ['WWWL', [3, 1], 's2'],
    ['WWWWW', [3, 2], 's2'], ['LLLLW', [3, 2], 's2'], ['PPP', [3], 's1'], ['WWP', [3], 's1'],
  ];
  for (const [codes, weekSizes, weekId] of seqs) {
    const S = buildSequence({ codes, weekSizes, calculateWeeklyResults });
    cases.push({ label: `sequence ${codes} split ${weekSizes.join('+')} finalizing ${weekId}`, input: { weekId, weekStatus: 'final', games: S.games, picks: S.picks, players: S.players, weeks: S.weeks } });
  }
  return cases;
}
