/**
 * CFB Pickems — tiebreaktest.mjs (SP-54, DI-465…470, 2026-10-01)
 * ================================================================
 * The math proofs for the weekly tie-break: alma mater against the spread, then the Extra
 * Point, then the week's draw. A SEPARATE file beside loadtest.mjs (CONVENTIONS #28, the
 * grouptest.mjs precedent) so the proof reads start to finish. loadtest.mjs spawns it as [124].
 *
 * Run:  node tiebreaktest.mjs
 *
 * Section map (built up commit by commit; each section names the DI it proves):
 *   [T20]  THE GOLDEN. Today's `rankWeeklyResults` / `calculateWeeklyResults` /
 *          `calculateGroupWeeklyResults` / `calculateSeasonStandings`, called with the
 *          PRE-SP-54 signatures, captured from the tree BEFORE scoring.js was edited
 *          (commit order: this file's first commit precedes every scoring.js change).
 *          Proves "tie === null changes nothing", i.e. a caller that passes no tie context
 *          gets byte-identical output, and that no `tieBreak` key ever appears on it.
 *
 * Capture mode:  TIEBREAK_CAPTURE_GOLDEN=1 node tiebreaktest.mjs   prints the golden table
 * (provenance for the literals below; it asserts nothing).
 */

import { createHash } from 'node:crypto';

// ── Minimal DOM / localStorage stubs — the shape grouptest.mjs / loadtest.mjs use ──────────
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
globalThis.fetch = async () => { throw new Error('network disabled in tiebreaktest'); };
// js/app.js (imported below for the path-agreement, CSV and Rules proofs) needs the same light browser stubs ranktest.mjs / eptest.mjs give it.
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const scoring = await import('./js/scoring.js');
const storage = await import('./js/storage.js');
const {
  calculateWeeklyResults, calculateGroupWeeklyResults, calculateSeasonStandings, rankWeeklyResults,
} = scoring;

const CAPTURE = process.env.TIEBREAK_CAPTURE_GOLDEN === '1';

// ─────────────────────────────────────────────────────────────────────────────────────────
// FIXTURE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────────────────
const NAMES = { p1: 'Drew', p2: 'Brayden', p3: 'Kevin', p4: 'Koby', p5: 'Jacob', p6: 'Kihoon' };
const mkPlayers = (...ids) => ids.map(id => ({ playerId: id, displayName: NAMES[id], active: true }));

/** One game whose ATS outcome is chosen by code: H = home covers, A = away covers, P = push. Spread is -3
 *  (home favoured), so H is 24-10, A is 14-13 (home wins by 1, does not cover), P is 20-17 (lands on the line). */
function mkGame(weekId, i, code, { mult = 1, status = 'final' } = {}) {
  const [hs, as] = code === 'H' ? [24, 10] : code === 'A' ? [14, 13] : [20, 17];
  return {
    gameId: `${weekId}_g${i}`, weekId, status,
    homeTeam: `${weekId}H${i}`, awayTeam: `${weekId}A${i}`,
    homeScore: status === 'final' ? hs : null, awayScore: status === 'final' ? as : null,
    spread: -3, lockedSpread: -3, multiplier: mult,
  };
}
const mkGames = (weekId, codes, opts = {}) => [...codes].map((c, i) => mkGame(weekId, i + 1, c, opts[i] || {}));
/** `spec`: { pid: 'HAHA…' } — one letter per game, H = picks the home team, A = the away team, '-' = no pick. */
function mkPicks(weekId, spec) {
  const out = [];
  for (const [pid, s] of Object.entries(spec)) {
    [...s].forEach((c, i) => {
      if (c === '-') return;
      out.push({ weekId, gameId: `${weekId}_g${i + 1}`, playerId: pid, selectedTeam: c === 'H' ? `${weekId}H${i + 1}` : `${weekId}A${i + 1}` });
    });
  }
  return out;
}
function setGuesses(weekId, guesses) {
  for (const [pid, v] of Object.entries(guesses)) if (v !== null) storage.setTiebreakerGuess(weekId, pid, v);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T20] THE GOLDEN — the PRE-SP-54 two-argument forms
// ─────────────────────────────────────────────────────────────────────────────────────────
// Every fixture below is run through the OLD signatures (no tie context). `row` projects the fields a
// reader can check by eye; `sha` is the digest of the WHOLE serialised output, so a stray `tieBreak` key
// (or any other drift) on a context-free call fails even where the projection still matches.
const row = r => [r.playerId, r.rank, r.correctPicks, r.incorrectPicks, r.correctCount, r.incorrectCount, r.noDecisions, r.pending,
  r.tiebreakerGuess, r.tiebreakerDelta, r.isWinner ? 1 : 0, r.isLoser ? 1 : 0, r.wonByTiebreaker ? 1 : 0];
const sha = o => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

function runGolden() {
  const out = {};
  const six = mkPlayers('p1', 'p2', 'p3', 'p4', 'p5', 'p6');

  // G1 — control: no tie anywhere, every game final.
  {
    const w = 'gA', games = mkGames(w, 'HHHAAH');
    const picks = mkPicks(w, { p1: 'HHHAAH', p2: 'HHHAAA', p3: 'HHHAHA', p4: 'HHAAHA', p5: 'AAHAHA', p6: 'AAAHHA' });
    out.G1 = calculateWeeklyResults(w, six, picks, games, 50);
  }
  // G2 — a three-way tie for FIRST, none of them guessed (all deltas null) — the accidental-order case.
  {
    const w = 'gB', games = mkGames(w, 'HHAAHA');
    const picks = mkPicks(w, { p1: 'HHAAHA', p2: 'HHAAHA', p3: 'HHAAHA', p4: 'AAHHAH', p5: 'AAHHHH', p6: 'AAHAAH' });
    out.G2 = calculateWeeklyResults(w, six, picks, games, null);
  }
  // G3 — a tie for first the tiebreaker DOES break (one guessed, one did not, two equally close).
  {
    const w = 'gC', games = mkGames(w, 'HAHAHA');
    const picks = mkPicks(w, { p1: 'HAHAHA', p2: 'HAHAHA', p3: 'HAHAHA', p4: 'HAHAHA', p5: 'AHAHAH', p6: 'AHAHAH' });
    setGuesses(w, { p1: 45, p2: 55, p3: null, p4: 40 });    // actual 50: p1 5, p2 5 (equal), p3 none, p4 10
    out.G3 = calculateWeeklyResults(w, six, picks, games, 50);
  }
  // G4 — a tie for LAST, with a 2x game, a push and a not-yet-final game in the slate.
  {
    const w = 'gD', games = mkGames(w, 'HHAPHA', { 1: { mult: 2 }, 5: { status: 'scheduled' } });
    const picks = mkPicks(w, { p1: 'HHAAHA', p2: 'HHAHHA', p3: 'AHAAHA', p4: 'AAHAH-', p5: 'AAHHA-', p6: 'AAHHAA' });
    out.G4 = calculateWeeklyResults(w, six, picks, games, 12);
  }
  // G5 — nothing final: no winner, no loser, ties stay in input order.
  {
    const w = 'gE', games = mkGames(w, 'HHAA', { 0: { status: 'live' }, 1: { status: 'scheduled' }, 2: { status: 'scheduled' }, 3: { status: 'scheduled' } });
    const picks = mkPicks(w, { p1: 'HHAA', p2: 'HHAA', p3: 'AAHH' });
    out.G5 = calculateWeeklyResults(w, mkPlayers('p1', 'p2', 'p3'), picks, games, null);
  }
  // G6 — the same tie fixture, players supplied in the OPPOSITE order: today's stable sort follows input order.
  {
    const w = 'gB', games = mkGames(w, 'HHAAHA');
    const picks = mkPicks(w, { p1: 'HHAAHA', p2: 'HHAAHA', p3: 'HHAAHA', p4: 'AAHHAH', p5: 'AAHHHH', p6: 'AAHAAH' });
    out.G6 = calculateWeeklyResults(w, [...six].reverse(), picks, games, null);
  }
  // G7 — rankWeeklyResults directly on hand-built rows (equal deltas, a null, a both-null pair), anyFinal true and false.
  {
    const mk = (pid, cp, td) => ({ resultId: `r_${pid}`, weekId: 'gR', playerId: pid, displayName: NAMES[pid], correctPicks: cp, incorrectPicks: 6 - cp,
      correctCount: cp, incorrectCount: 6 - cp, noDecisions: 0, pending: 0, tiebreakerGuess: td === null ? null : 50 + td, tiebreakerDelta: td,
      rank: 0, isWinner: false, isLoser: false, wonByTiebreaker: false });
    const rows = () => [mk('p1', 4, 3), mk('p2', 4, 3), mk('p3', 4, null), mk('p4', 2, null), mk('p5', 2, null), mk('p6', 5, 1)];
    out.G7a = rankWeeklyResults(rows(), true);
    out.G7b = rankWeeklyResults(rows(), false);
    out.G7c = rankWeeklyResults(rows().slice(0, 1), true);
  }
  // G8 — a two-part group, pooled: a tie on the pooled total broken by the tiebreaker-of-record member's guess.
  {
    const g1 = { weekId: 'grA1', groupId: 'grpA', weekNumber: 1, isGroupTiebreaker: false, status: 'final', actualTiebreakerValue: 10 };
    const g2 = { weekId: 'grA2', groupId: 'grpA', weekNumber: 2, isGroupTiebreaker: true, status: 'final', actualTiebreakerValue: 50 };
    const games = [...mkGames('grA1', 'HHA'), ...mkGames('grA2', 'AHH')];
    const picks = [...mkPicks('grA1', { p1: 'HHA', p2: 'HHH', p3: 'AAH' }), ...mkPicks('grA2', { p1: 'AHA', p2: 'AHH', p3: 'HAA' })];
    setGuesses('grA1', { p1: 99, p2: 1 });                    // NOT the member of record — must be ignored
    setGuesses('grA2', { p1: 48, p2: 60, p3: 50 });           // the member of record: p1 delta 2, p2 delta 10, p3 delta 0
    out.G8 = calculateGroupWeeklyResults([g1, g2], mkPlayers('p1', 'p2', 'p3'), picks, games);
  }
  // G9 — the season table, per-row (2 args) and group-aware (3 args), with one solo week and one pooled group.
  {
    const wk = [
      { weekId: 'gA', weekNumber: 1, status: 'final' },
      { weekId: 'grA1', groupId: 'grpA', weekNumber: 2, status: 'final' },
      { weekId: 'grA2', groupId: 'grpA', weekNumber: 3, status: 'final', isGroupTiebreaker: true },
    ];
    const players = mkPlayers('p1', 'p2', 'p3');
    const solo = calculateWeeklyResults('gA', players, mkPicks('gA', { p1: 'HHHAAH', p2: 'HHHAAA', p3: 'AAHAHA' }), mkGames('gA', 'HHHAAH'), 50);
    const games = [...mkGames('grA1', 'HHA'), ...mkGames('grA2', 'AHH')];
    const picks = [...mkPicks('grA1', { p1: 'HHA', p2: 'HHH', p3: 'AAH' }), ...mkPicks('grA2', { p1: 'AHA', p2: 'AHH', p3: 'HAA' })];
    const part1 = calculateWeeklyResults('grA1', players, picks.filter(p => p.weekId === 'grA1'), games.filter(g => g.weekId === 'grA1'), 10);
    const part2 = calculateWeeklyResults('grA2', players, picks.filter(p => p.weekId === 'grA2'), games.filter(g => g.weekId === 'grA2'), 50);
    const all = [...solo, ...part1, ...part2];
    out.G9a = calculateSeasonStandings(players, all);
    out.G9b = calculateSeasonStandings(players, all, wk);
  }
  return out;
}

// The season rows are shaped differently from the weekly ones; project both.
const seasonRow = s => [s.playerId, s.currentRank, s.totalCorrect, s.totalIncorrect, s.totalCorrectCount, s.totalIncorrectCount, s.totalND,
  s.weeklyWins, s.weeklyLosses, s.winPct, s.isSeasonLeader ? 1 : 0, s.isCurrentLastPlace ? 1 : 0];

const golden = runGolden();
const project = (k, v) => (k.startsWith('G9') ? v.map(seasonRow) : v.map(row));

if (CAPTURE) {
  const table = {};
  for (const [k, v] of Object.entries(golden)) table[k] = { sha: sha(v), rows: project(k, v) };
  console.log(JSON.stringify(table));
  process.exit(0);
}

// ── GOLDEN LITERALS (captured from the tree before scoring.js was edited) ───────────────────
const GOLDEN = {
  G1: { sha: 'b9621fee128264e4', rows: [["p1",1,6,0,6,0,0,0,null,null,1,0,0],["p2",2,5,1,5,1,0,0,null,null,0,0,0],["p3",3,4,2,4,2,0,0,null,null,0,0,0],["p4",4,3,3,3,3,0,0,null,null,0,0,0],["p5",5,2,4,2,4,0,0,null,null,0,0,0],["p6",6,0,6,0,6,0,0,null,null,0,1,0]] },
  G2: { sha: '8f6e91cab1d8d9e5', rows: [["p1",1,6,0,6,0,0,0,null,null,1,0,0],["p2",2,6,0,6,0,0,0,null,null,0,0,0],["p3",3,6,0,6,0,0,0,null,null,0,0,0],["p5",4,1,5,1,5,0,0,null,null,0,0,0],["p6",5,1,5,1,5,0,0,null,null,0,0,0],["p4",6,0,6,0,6,0,0,null,null,0,1,0]] },
  G3: { sha: 'f85e6ac18b60b967', rows: [["p1",1,6,0,6,0,0,0,45,5,1,0,0],["p2",2,6,0,6,0,0,0,55,5,0,0,0],["p4",3,6,0,6,0,0,0,40,10,0,0,0],["p3",4,6,0,6,0,0,0,null,null,0,0,0],["p5",5,0,6,0,6,0,0,null,null,0,0,0],["p6",6,0,6,0,6,0,0,null,null,0,1,0]] },
  G4: { sha: 'fbeab3d4c026b3a6', rows: [["p1",1,5,0,4,0,1,1,null,null,1,0,0],["p2",2,5,0,4,0,1,1,null,null,0,0,0],["p3",3,4,1,3,1,1,1,null,null,0,0,0],["p4",4,1,4,1,3,1,0,null,null,0,0,0],["p5",5,0,5,0,4,1,0,null,null,0,0,0],["p6",6,0,5,0,4,1,1,null,null,0,1,0]] },
  G5: { sha: '1cd428c21fb10a96', rows: [["p1",1,0,0,0,0,0,4,null,null,0,0,0],["p2",2,0,0,0,0,0,4,null,null,0,0,0],["p3",3,0,0,0,0,0,4,null,null,0,0,0]] },
  G6: { sha: 'cf8eedcb380f57c1', rows: [["p3",1,6,0,6,0,0,0,null,null,1,0,0],["p2",2,6,0,6,0,0,0,null,null,0,0,0],["p1",3,6,0,6,0,0,0,null,null,0,0,0],["p6",4,1,5,1,5,0,0,null,null,0,0,0],["p5",5,1,5,1,5,0,0,null,null,0,0,0],["p4",6,0,6,0,6,0,0,null,null,0,1,0]] },
  G7a: { sha: '2df212d756d95453', rows: [["p6",1,5,1,5,1,0,0,51,1,1,0,0],["p1",2,4,2,4,2,0,0,53,3,0,0,0],["p2",3,4,2,4,2,0,0,53,3,0,0,0],["p3",4,4,2,4,2,0,0,null,null,0,0,0],["p4",5,2,4,2,4,0,0,null,null,0,0,0],["p5",6,2,4,2,4,0,0,null,null,0,1,0]] },
  G7b: { sha: 'b85e78317c870add', rows: [["p6",1,5,1,5,1,0,0,51,1,0,0,0],["p1",2,4,2,4,2,0,0,53,3,0,0,0],["p2",3,4,2,4,2,0,0,53,3,0,0,0],["p3",4,4,2,4,2,0,0,null,null,0,0,0],["p4",5,2,4,2,4,0,0,null,null,0,0,0],["p5",6,2,4,2,4,0,0,null,null,0,0,0]] },
  G7c: { sha: '4c5888114da5bf31', rows: [["p1",1,4,2,4,2,0,0,53,3,0,0,0]] },
  G8: { sha: 'ed51c3b6596e5dc2', rows: [["p1",1,5,1,5,1,0,0,48,2,1,0,1],["p2",2,5,1,5,1,0,0,60,10,0,0,0],["p3",3,0,6,0,6,0,0,50,0,0,1,0]] },
  G9a: { sha: 'd302f8dd5fdb89d3', rows: [["p1",1,11,1,11,1,0,2,0,91.7,1,0],["p2",2,10,2,10,2,0,1,0,83.3,0,0],["p3",3,2,10,2,10,0,0,3,16.7,0,1]] },
  G9b: { sha: 'e29a56b0c0851c13', rows: [["p1",1,11,1,11,1,0,2,0,91.7,1,0],["p2",2,10,2,10,2,0,0,0,83.3,0,0],["p3",3,2,10,2,10,0,0,2,16.7,0,1]] },
};

console.log('[T20] the two-argument forms are byte-identical to the pre-SP-54 tree…');
for (const [k, v] of Object.entries(golden)) {
  const g = GOLDEN[k];
  assert(!!g, `${k}: a golden literal exists`);
  if (!g) continue;
  assert(JSON.stringify(project(k, v)) === JSON.stringify(g.rows), `${k}: every projected field matches the golden`);
  assert(sha(v) === g.sha, `${k}: the WHOLE serialised output matches the golden digest (no stray tieBreak key, no drift)`);
  assert(v.every(r => !('tieBreak' in r)), `${k}: no row carries a tieBreak key`);
}


// ─────────────────────────────────────────────────────────────────────────────────────────
// SCENARIO BUILDER for the vectors (needs doc section 7) — everything goes through the REAL key builder
// (js/tie-context.js) and the REAL ranker (js/scoring.js), with the real storage seam holding the guesses.
// ─────────────────────────────────────────────────────────────────────────────────────────
const tieCtx = await import('./js/tie-context.js');
const dataModel = await import('./js/data-model.js');
const { buildWeekTieContext, tieDecidedBy } = tieCtx;

// EVERY FIXTURE DATE IS AN OFFSET FROM THE TWO RELEASE CONSTANTS (reviewer delta BLOCK B2, 2026-10-01). js/tie-context.js ships both PROVISIONAL and the coordinator STAMPS them at
// deploy (TIE_RULE_EFFECTIVE_AT from the pre-deploy read, ALMA_SNAPSHOT_EPOCH_AT from R-4b), possibly days after today. A hard-coded date here would turn this suite red on the
// stamped tree, loadtest [124] with it, and deploy Gate 1 would stop the deploy AFTER 0038 was pasted. So nothing below names a calendar date relative to the constants.
const DAY = 86400e3;
const isoAt = (t) => new Date(t).toISOString();
const TIE_AT = Date.parse(tieCtx.TIE_RULE_EFFECTIVE_AT), ALMA_AT = Date.parse(tieCtx.ALMA_SNAPSHOT_EPOCH_AT), EARLIEST_AT = Math.min(TIE_AT, ALMA_AT);
const LOCKED_AT = isoAt(EARLIEST_AT - 29 * DAY);    // every fixture week locked BEFORE both constants (so the fallback tiers are allowed, T13) and kicks off AFTER its lock (SC-K2 is proven separately, T31)
const KICKOFF = isoAt(EARLIEST_AT - 25 * DAY);
const FINALIZED_AT = isoAt(TIE_AT + 2 * DAY);       // after TIE_RULE_EFFECTIVE_AT: the rule is in force
const PRE_RULE_AT = isoAt(TIE_AT - 10 * DAY);       // finalized BEFORE the rule: today's behaviour
const LONG_BEFORE_AT = isoAt(TIE_AT - 60 * DAY);
const LOCKED_AFTER_EPOCH = isoAt(ALMA_AT + 5 * DAY);
const SCHOOLS = { p1: 'Texas A&M', p2: 'Oklahoma', p3: 'Notre Dame', p4: 'USC', p5: 'Arkansas', p6: 'Texas A&M' };

/** An alma mater game on the slate. `side` is where the alma team plays; `result` is its ATS result. Nobody picks it. */
function almaGame(weekId, i, school, side, result, over = {}) {
  const opp = `Opp ${weekId} ${i}`;
  let g;
  if (side === 'home') {                              // home favoured by 7 (signed spread -7)
    const [hs, as] = result === 'covered' ? [38, 17] : result === 'push' ? [28, 21] : [31, 27];
    g = { homeTeam: school, awayTeam: opp, homeScore: hs, awayScore: as, spread: -7, lockedSpread: -7 };
  } else {                                            // the alma team is the AWAY side, favoured by 7 (signed spread +7)
    const [hs, as] = result === 'covered' ? [17, 38] : result === 'push' ? [21, 28] : [27, 31];
    g = { homeTeam: opp, awayTeam: school, homeScore: hs, awayScore: as, spread: 7, lockedSpread: 7 };
  }
  return { gameId: `${weekId}_a${i}`, weekId, status: 'final', kickoff: KICKOFF, multiplier: 1, ...g, ...over };
}

/**
 * One week: `cps` = { playerId: weighted correct picks }. Filler games (outcome "home covers") are picked so each player lands
 * on exactly his cp; `alma` games are NOT picked, so they never move a pick tally. Guesses are written through the storage seam.
 */
function mkFixture({
  weekId, cps, picksSpec = null, fillMult = {}, alma = [], tb = {}, tbActual = null, ep = {}, epActual = null, epEnabled = true,
  schools = {}, snapshot = undefined, lockedAlmaMaters = undefined, weekOver = {}, nonSchoolPlayers = {},
}) {
  const pids = Object.keys(cps);
  const n = picksSpec ? Math.max(...Object.values(picksSpec).map(s => s.length)) : Math.max(...Object.values(cps));
  const games = [...Array(n)].map((_, i) => mkGame(weekId, i + 1, 'H', { mult: fillMult[i] || 1 })).map(g => ({ ...g, kickoff: KICKOFF }));
  const spec = picksSpec || Object.fromEntries(pids.map(pid => [pid, 'H'.repeat(cps[pid]) + 'A'.repeat(n - cps[pid])]));
  const picks = mkPicks(weekId, spec);
  alma.forEach((a, i) => games.push(almaGame(weekId, i + 1, a.school, a.side || 'home', a.result, a.over || {})));
  const schoolOf = { ...SCHOOLS, ...schools };
  const players = pids.map(pid => ({ playerId: pid, displayName: NAMES[pid], active: true, almaMater: schoolOf[pid] || '' }));
  const snap = snapshot !== undefined ? snapshot : Object.fromEntries(pids.filter(pid => (schoolOf[pid] || '').trim()).map(pid => [pid, schoolOf[pid].trim()]));
  const week = {
    weekId, weekNumber: 1, status: 'final', dataSourceMode: 'live', lockedAt: LOCKED_AT, finalizedAt: FINALIZED_AT,
    actualTiebreakerValue: tbActual, extraPointEnabled: epEnabled, extraPointActual: epActual,
    ...(snap === null ? {} : { lockedAlmaByPlayer: snap }),
    ...(lockedAlmaMaters === undefined ? {} : { lockedAlmaMaters }),
    ...weekOver,
  };
  setGuesses(weekId, tb);
  for (const [pid, v] of Object.entries(ep)) if (v !== null) storage.setExtraPointGuess(weekId, pid, v);
  return { week, players, games, picks };
}

/** Ten deterministic input orders: identity, reverse, and eight seeded shuffles (UN-132's lesson: a fixture that inserts in the order it asserts proves nothing). */
function permutations(arr) {
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [[...arr], [...arr].reverse()];
  for (let seed = 1; seed <= 8; seed++) {
    const a = [...arr], r = mulberry(seed * 7919);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    out.push(a);
  }
  return out;
}

const ctxFor = (fx, players, over = {}) => buildWeekTieContext({
  weeks: [fx.week], players, getGames: () => fx.games, liveRoster: over.liveRoster || [], almaApplicable: over.almaApplicable !== false, ...over.args,
});
function runWeek(fx, players = fx.players, over = {}) {
  const tie = ctxFor(fx, players, over);
  const rows = calculateWeeklyResults(fx.week.weekId, players, fx.picks, over.games || fx.games, fx.week.actualTiebreakerValue ?? null, over.tie === undefined ? tie : over.tie);
  return { rows, tie };
}
const summary = (rows) => ({
  order: rows.map(r => r.playerId),
  winner: rows.find(r => r.isWinner)?.playerId ?? null, winnerStage: tieDecidedBy(rows.find(r => r.isWinner) || null),
  loser: rows.find(r => r.isLoser)?.playerId ?? null, loserStage: tieDecidedBy(rows.find(r => r.isLoser) || null),
  wonByTiebreaker: !!rows.find(r => r.isWinner)?.wonByTiebreaker,
});
/** Run `fx` under all ten input orders; every one must produce the SAME summary. Returns { same, first, results }. */
function runAllOrders(fx, over = {}) {
  const results = permutations(fx.players).map(pl => summary(runWeek(fx, pl, over).rows));
  const first = JSON.stringify(results[0]);
  return { same: results.every(r => JSON.stringify(r) === first), first: results[0], results };
}
/** One vector: expected order, winner, loser, stages and wonByTiebreaker, under ten input orders. */
function vector(id, fx, exp, over = {}) {
  const r = runAllOrders(fx, over);
  const detail = JSON.stringify(r.results.filter(x => JSON.stringify(x) !== JSON.stringify(exp)).slice(0, 1));
  assert(r.same, `${id}: the answer is IDENTICAL under ten input orders (identity, reverse, eight seeded shuffles)`);
  assert(JSON.stringify(r.first.order) === JSON.stringify(exp.order), `${id}: order ${exp.order.join(',')} (got ${r.first.order.join(',')})`);
  assert(r.first.winner === exp.winner && r.first.winnerStage === exp.winnerStage, `${id}: winner ${exp.winner}, decided by ${exp.winnerStage} (got ${r.first.winner}/${r.first.winnerStage})`);
  assert(r.first.loser === exp.loser && r.first.loserStage === exp.loserStage, `${id}: loser ${exp.loser}, decided by ${exp.loserStage} (got ${r.first.loser}/${r.first.loserStage})`);
  assert(r.first.wonByTiebreaker === exp.wonByTiebreaker, `${id}: wonByTiebreaker ${exp.wonByTiebreaker}${detail === '[]' ? '' : ' — first mismatch ' + detail}`);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T1-T19] THE NEEDS DOC'S VECTORS (DESIGN_NEEDS_TIEBREAK_093026.md section 7), through the real builder and ranker
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T1] control: no tie — the same answer as today, and no reason emitted…');
{
  const fx = mkFixture({ weekId: 'w_t1', cps: { p1: 7, p2: 6, p3: 5, p4: 4 } });
  const r = vector('T1', fx, { order: ['p1', 'p2', 'p3', 'p4'], winner: 'p1', winnerStage: null, loser: 'p4', loserStage: null, wonByTiebreaker: false });
  assert(runWeek(fx).rows.every(x => !('tieBreak' in x)), 'T1: no row carries a tieBreak descriptor (nothing was tied)');
}

console.log('\n[T2] the existing tiebreaker decides; alma mater and Extra Point are NOT consulted (poisoned fixture)…');
{
  // S3 and S4 would INVERT the answer: p3's Notre Dame did not cover and he is 2 under; p4's USC covered and he is exact.
  const fx = mkFixture({ weekId: 'w_t2', cps: { p3: 6, p4: 6, p1: 4 }, tbActual: 60, tb: { p3: 63, p4: 67 }, epActual: 52, ep: { p3: 50, p4: 52 },
    alma: [{ school: 'Notre Dame', result: 'notcov' }, { school: 'USC', result: 'covered' }] });
  vector('T2', fx, { order: ['p3', 'p4', 'p1'], winner: 'p3', winnerStage: 'tiebreaker', loser: 'p1', loserStage: null, wonByTiebreaker: true });
  const w = runWeek(fx).rows.find(x => x.isWinner);
  assert(w.tieBreak.me.delta === 3 && w.tieBreak.other.delta === 7 && w.tieBreak.vs === 'p4', 'T2: the descriptor carries both deltas and the neighbour (3 and 7, vs p4)');
}

console.log("\n[T3] Drew's core case: a tie for FIRST, both schools played (S3)…");
{
  const fx = mkFixture({ weekId: 'w_t3', cps: { p3: 6, p4: 6, p1: 4 }, epEnabled: false,
    alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  vector('T3', fx, { order: ['p3', 'p4', 'p1'], winner: 'p3', winnerStage: 'alma', loser: 'p1', loserStage: null, wonByTiebreaker: false });
  const w = runWeek(fx).rows.find(x => x.isWinner);
  assert(w.tieBreak.stage === 'alma' && w.tieBreak.src === 'snapshot' && w.tieBreak.me.team === 'Notre Dame' && w.tieBreak.other.team === 'USC',
    'T3: the descriptor names the GAME ROWS\' teams (Notre Dame, USC) and the source tier (snapshot)');
}

console.log('\n[T4] a tie for LAST ("worse"), both schools played…');
{
  const fx = mkFixture({ weekId: 'w_t4', cps: { p1: 7, p4: 6, p6: 5, p3: 4, p2: 3, p5: 3 }, epEnabled: false,
    alma: [{ school: 'Oklahoma', result: 'notcov' }, { school: 'Arkansas', result: 'covered' }] });
  vector('T4', fx, { order: ['p1', 'p4', 'p6', 'p3', 'p5', 'p2'], winner: 'p1', winnerStage: null, loser: 'p2', loserStage: 'alma', wonByTiebreaker: false });
}

console.log('\n[T5] same school, both covered (S3 equal, S4 decides)…');
{
  const fx = mkFixture({ weekId: 'w_t5', cps: { p1: 6, p6: 6, p2: 3 }, tbActual: 50, tb: { p1: 54, p6: 46 }, epActual: 52, ep: { p1: 48, p6: 50 },
    alma: [{ school: 'Texas A&M', result: 'covered' }] });
  vector('T5', fx, { order: ['p6', 'p1', 'p2'], winner: 'p6', winnerStage: 'ep', loser: 'p2', loserStage: null, wonByTiebreaker: false });
}

console.log('\n[T6] mixed pair: one school played, one had no game (the literal reading: S3 is skipped for the pair)…');
{
  const fx = mkFixture({ weekId: 'w_t6', cps: { p3: 6, p4: 6 }, epActual: 52, ep: { p3: 57, p4: 49 }, alma: [{ school: 'Notre Dame', result: 'covered' }] });
  vector('T6', fx, { order: ['p4', 'p3'], winner: 'p4', winnerStage: 'ep', loser: 'p3', loserStage: 'ep', wonByTiebreaker: false });
}

console.log('\n[T7] a three-way tie for first, all schools played (covered > push > did not cover)…');
{
  // p5's exact Extra Point (52/52) is the poison: it must not be consulted.
  const fx = mkFixture({ weekId: 'w_t7', cps: { p2: 5, p3: 5, p5: 5, p1: 2 }, epActual: 52, ep: { p2: 50, p3: 50, p5: 52 },
    alma: [{ school: 'Oklahoma', result: 'push' }, { school: 'Notre Dame', result: 'covered' }, { school: 'Arkansas', result: 'notcov' }] });
  vector('T7', fx, { order: ['p3', 'p2', 'p5', 'p1'], winner: 'p3', winnerStage: 'alma', loser: 'p1', loserStage: null, wonByTiebreaker: false });
}

console.log('\n[T8] a three-way tie with one bye (S3 skipped for all three) — the honest cost of the literal reading…');
{
  const fx = mkFixture({ weekId: 'w_t8', cps: { p1: 5, p3: 5, p4: 5, p2: 2 }, epActual: 52, ep: { p1: 55, p3: 50, p4: 47 },
    alma: [{ school: 'Texas A&M', result: 'covered' }, { school: 'Notre Dame', result: 'notcov' }] });          // USC: no game
  vector('T8', fx, { order: ['p3', 'p4', 'p1', 'p2'], winner: 'p3', winnerStage: 'ep', loser: 'p2', loserStage: null, wonByTiebreaker: false });
}

console.log('\n[T9] the Extra Point ladder, a five-way tie for LAST (nobody\'s school played), seed w_t9…');
{
  const fx = mkFixture({ weekId: 'w_t9', cps: { p6: 8, p1: 4, p2: 4, p3: 4, p4: 4, p5: 4 }, epActual: 52, ep: { p1: 52, p2: 51, p3: 55, p4: 60, p5: null } });
  vector('T9', fx, { order: ['p6', 'p1', 'p2', 'p3', 'p4', 'p5'], winner: 'p6', winnerStage: null, loser: 'p5', loserStage: 'ep', wonByTiebreaker: false });
  // p3 and p4 are EQUAL on S4 (both busted): the draw (drawKey 760867406 < 2922202284) puts p3 first.
  const rows = runWeek(fx).rows;
  assert(rows.map(r => r.playerId).indexOf('p3') < rows.map(r => r.playerId).indexOf('p4'), 'T9: the two busts (p3, p4) are level on S4 and the draw settles them, p3 first');
}

console.log('\n[T10] no Extra Point contest: a dead heat reaches the draw, seed w_t10…');
{
  const fx = mkFixture({ weekId: 'w_t10', cps: { p2: 6, p5: 6, p1: 3 }, epEnabled: false });
  vector('T10', fx, { order: ['p5', 'p2', 'p1'], winner: 'p5', winnerStage: 'draw', loser: 'p1', loserStage: null, wonByTiebreaker: false });
  // "same expectation if enabled with no actual on file"
  const fx2 = mkFixture({ weekId: 'w_t10', cps: { p2: 6, p5: 6, p1: 3 }, epEnabled: true, epActual: null });
  const r2 = runAllOrders(fx2);
  assert(r2.same && r2.first.order.join() === 'p5,p2,p1' && r2.first.winnerStage === 'draw', 'T10: enabled with NO actual on file gives the same answer (the Extra Point is not gradable)');
  const fx3 = mkFixture({ weekId: 'w_t10', cps: { p2: 6, p5: 6, p1: 3 }, epEnabled: true, epActual: '' });
  assert(runAllOrders(fx3).first.order.join() === 'p5,p2,p1', 'T10: a BLANK actual ("") is no result at all, never a real 0-yard result that busts the league');
}

console.log('\n[T11] the tiebreaker tied from opposite sides (5 over = 5 under) — S3 decides, wonByTiebreaker stays false…');
{
  const fx = mkFixture({ weekId: 'w_t11', cps: { p3: 6, p4: 6 }, tbActual: 60, tb: { p3: 55, p4: 65 }, epEnabled: false,
    alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  vector('T11', fx, { order: ['p3', 'p4'], winner: 'p3', winnerStage: 'alma', loser: 'p4', loserStage: 'alma', wonByTiebreaker: false });
}

console.log('\n[T12] the weighted tally defines "tie" (raw counts ignored); a 2x alma game counts ONCE…');
{
  // p1: right on the 2x game + three 1x games = 5 weighted (4 raw); p2: five 1x games = 5 weighted (5 raw). Texas A&M's own game is also 2x.
  const fx = mkFixture({ weekId: 'w_t12', cps: { p1: 5, p2: 5 }, picksSpec: { p1: 'HHHHAA', p2: 'AHHHHH' }, fillMult: { 0: 2 }, epEnabled: false,
    alma: [{ school: 'Texas A&M', result: 'covered', over: { multiplier: 2 } }, { school: 'Oklahoma', result: 'notcov' }] });
  const rows = runWeek(fx).rows;
  assert(rows.find(r => r.playerId === 'p1').correctPicks === 5 && rows.find(r => r.playerId === 'p2').correctPicks === 5
    && rows.find(r => r.playerId === 'p1').correctCount === 4 && rows.find(r => r.playerId === 'p2').correctCount === 5,
    'T12: fixture check — tied at 5 on the WEIGHTED tally while the RAW counts differ (4 vs 5)');
  vector('T12', fx, { order: ['p1', 'p2'], winner: 'p1', winnerStage: 'alma', loser: 'p2', loserStage: 'alma', wonByTiebreaker: false });
  assert(rows.find(r => r.isWinner).tieBreak.me.cov === 1, 'T12: the 2x alma game counts ONCE (cov 1, not 2)');
}

console.log('\n[T13a] the full fix: Kevin changes school to Clemson AFTER the lock — the snapshot still says Notre Dame…');
{
  const fx = mkFixture({ weekId: 'w_t13a', cps: { p3: 5, p4: 5 }, schools: { p3: 'Clemson' }, snapshot: { p3: 'Notre Dame', p4: 'USC' },
    epActual: 52, ep: { p3: 50, p4: 52 },
    alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }, { school: 'Clemson', result: 'covered' }] });
  vector('T13a', fx, { order: ['p3', 'p4'], winner: 'p3', winnerStage: 'alma', loser: 'p4', loserStage: 'alma', wonByTiebreaker: false });
  const w = runWeek(fx).rows.find(x => x.isWinner);
  assert(w.tieBreak.src === 'snapshot' && w.tieBreak.me.team === 'Notre Dame', 'T13a: src is snapshot and the school counted is Notre Dame — Clemson is irrelevant');
  assert(tieCtx.tieCaption(w.tieBreak, { otherName: 'Koby' }) === 'Won the tie: Notre Dame covered, USC did not cover', 'T13a: the caption has NO source note');
}
console.log('\n[T13b] tier 2 (no map; the locked roster is the interim guard): a school not on the list counts as no school…');
{
  const fx = mkFixture({ weekId: 'w_t13b', cps: { p3: 5, p4: 5 }, schools: { p3: 'Clemson' }, snapshot: null, lockedAlmaMaters: ['Notre Dame', 'USC'],
    epActual: 52, ep: { p3: 50, p4: 52 },
    alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }, { school: 'Clemson', result: 'covered' }] });
  vector('T13b', fx, { order: ['p4', 'p3'], winner: 'p4', winnerStage: 'ep', loser: 'p3', loserStage: 'ep', wonByTiebreaker: false });
}
console.log('\n[T13c] tier 3 (neither a map nor a list): the live roster and the current school, disclosed in the caption…');
{
  const fx = mkFixture({ weekId: 'w_t13c', cps: { p3: 5, p4: 5 }, schools: { p3: 'Clemson' }, snapshot: null, epActual: 52, ep: { p3: 50, p4: 52 },
    alma: [{ school: 'Clemson', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  vector('T13c', fx, { order: ['p3', 'p4'], winner: 'p3', winnerStage: 'alma', loser: 'p4', loserStage: 'alma', wonByTiebreaker: false }, { liveRoster: ['Clemson', 'USC'] });
  const w = runWeek(fx, fx.players, { liveRoster: ['Clemson', 'USC'] }).rows.find(x => x.isWinner);
  assert(w.tieBreak.src === 'live' && tieCtx.tieCaption(w.tieBreak, { otherName: 'Koby' }) === 'Won the tie: Clemson covered, USC did not cover (schools as listed now)',
    'T13c: src is live and the caption ENDS "(schools as listed now)"');
}

console.log('\n[T14] an alma mater game that is not final / has no usable spread / a blank school: S3 is skipped, the Extra Point decides…');
{
  const base = (over = {}) => mkFixture({ weekId: 'w_t14', cps: { p3: 5, p4: 5 }, epActual: 52, ep: { p3: 52, p4: 50 }, ...over,
    alma: over.alma || [{ school: 'Notre Dame', result: 'covered', over: { status: 'scheduled', homeScore: null, awayScore: null } }, { school: 'USC', result: 'covered' }] });
  const exp = { order: ['p3', 'p4'], winner: 'p3', winnerStage: 'ep', loser: 'p4', loserStage: 'ep', wonByTiebreaker: false };
  vector('T14', base(), exp);
  vector('T14 (variant: final but lockedSpread AND spread null)', base({ alma: [{ school: 'Notre Dame', result: 'covered', over: { lockedSpread: null, spread: null } }, { school: 'USC', result: 'covered' }] }), exp);
  vector('T14 (variant: the player\'s school is blank)', base({ schools: { p3: '' }, snapshot: { p4: 'USC' }, alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'covered' }] }), exp);
}

console.log('\n[T15] a multi-part (group) week: pooled, counts summed across parts, the group id seeds the draw…');
const T15 = (() => {
  const weekIds = ['grp_a1', 'grp_a2'];
  const mk = (weekId, over) => mkFixture({ weekId, cps: over.cps, picksSpec: over.picksSpec, alma: over.alma || [], tb: over.tb || {}, tbActual: over.tbActual ?? null, epEnabled: false,
    snapshot: { p1: 'Texas A&M', p2: 'Oklahoma', p5: 'Arkansas' }, weekOver: { groupId: 'grp_a', isGroupTiebreaker: over.isTb === true, weekNumber: over.weekNumber } });
  // part 1: p2 6, p5 5, p1 3 ; part 2: p2 5, p5 6, p1 3 -> pooled p2 11, p5 11, p1 6. The tiebreaker of record is part 2 (actual 50: p2 52, p5 48 -> both 2).
  const f1 = mk('grp_a1', { cps: { p1: 3, p2: 6, p5: 5 }, picksSpec: { p1: 'HHHAAA', p2: 'HHHHHH', p5: 'HHHHHA' }, weekNumber: 1,
    alma: [{ school: 'Oklahoma', result: 'covered' }, { school: 'Arkansas', result: 'covered' }] });
  const f2 = mk('grp_a2', { cps: { p1: 3, p2: 5, p5: 6 }, picksSpec: { p1: 'HHHAAA', p2: 'HHHHHA', p5: 'HHHHHH' }, weekNumber: 2, isTb: true, tbActual: 50, tb: { p2: 52, p5: 48 },
    alma: [{ school: 'Oklahoma', result: 'notcov' }] });
  return { f1, f2, weeks: [f1.week, f2.week], players: f1.players, games: [...f1.games, ...f2.games], picks: [...f1.picks, ...f2.picks], weekIds };
})();
{
  const groupRows = (players, over = {}) => {
    const tie = buildWeekTieContext({ weeks: T15.weeks, players, getGames: (id) => T15.games.filter(g => g.weekId === id), liveRoster: [], almaApplicable: true, ...(over.args || {}) });
    return { tie, rows: calculateGroupWeeklyResults(T15.weeks, players, T15.picks, over.games || T15.games, over.noTie ? null : tie) };
  };
  const res = permutations(T15.players).map(pl => summary(groupRows(pl).rows));
  const first = JSON.stringify(res[0]);
  assert(res.every(r => JSON.stringify(r) === first), 'T15: the pooled group answer is IDENTICAL under ten input orders');
  assert(res[0].order.join() === 'p5,p2,p1' && res[0].winner === 'p5' && res[0].winnerStage === 'alma' && res[0].loser === 'p1' && res[0].loserStage === null,
    `T15: S3 applies (both schools played), Arkansas +1 beats Oklahoma 0 (covered once, missed once, summed across the parts): order p5,p2,p1, winner p5 by alma (got ${res[0].order.join()}/${res[0].winner}/${res[0].winnerStage})`);
  const w = groupRows(T15.players).rows.find(r => r.isWinner);
  assert(w.tieBreak.other.cov === 1 && w.tieBreak.other.mis === 1 && tieCtx.tieCaption(w.tieBreak, { otherName: 'Brayden' }) === 'Won the tie: Arkansas covered, Oklahoma went 1-1 against the spread',
    'T15: a team that played twice reads "went 1-1 against the spread"');
  // the pooled branch of calculateSeasonStandings must give the SAME winner (the UN-126 class, needs doc F8)
  const tie = buildWeekTieContext({ weeks: T15.weeks, players: T15.players, getGames: (id) => T15.games.filter(g => g.weekId === id), liveRoster: [], almaApplicable: true });
  const partRows = T15.weeks.flatMap(wk => calculateWeeklyResults(wk.weekId, T15.players, T15.picks.filter(p => p.weekId === wk.weekId), T15.games.filter(g => g.weekId === wk.weekId), wk.actualTiebreakerValue ?? null));
  const withCtx = calculateSeasonStandings(T15.players, partRows, T15.weeks, new Map([['grp_a', tie]]));
  assert(withCtx.find(s => s.playerId === 'p5').weeklyWins === 1 && withCtx.find(s => s.playerId === 'p2').weeklyWins === 0 && withCtx.find(s => s.playerId === 'p1').weeklyLosses === 1,
    'T15: the SEASON\'s pooled branch, handed the same context, names the same winner (p5) and loser (p1) — one weekly win and one weekly loss for the group');
  // no alma games, no Extra Point: the draw with the GROUP id as seed orders p2 before p5
  const noAlma = { ...T15, games: T15.games.filter(g => !/_a\d+$/.test(g.gameId)) };
  const tieD = buildWeekTieContext({ weeks: T15.weeks, players: T15.players, getGames: (id) => noAlma.games.filter(g => g.weekId === id), liveRoster: [], almaApplicable: true });
  const rowsD = calculateGroupWeeklyResults(T15.weeks, T15.players, T15.picks, noAlma.games, tieD);
  assert(rowsD.map(r => r.playerId).join() === 'p2,p5,p1' && rowsD[0].tieBreak.stage === 'draw' && tieD.seed === 'grp_a',
    'T15: with neither school on a slate and no Extra Point the draw is seeded by the GROUP id (grp_a) and orders p2 before p5');
}

console.log('\n[T16] a two-player league, everyone tied: winner and loser are complementary…');
{
  const fx = mkFixture({ weekId: 'w_t16', cps: { p3: 5, p4: 5 }, epEnabled: false, alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  vector('T16', fx, { order: ['p3', 'p4'], winner: 'p3', winnerStage: 'alma', loser: 'p4', loserStage: 'alma', wonByTiebreaker: false });
}

console.log('\n[T17] a week that is NOT final: S1 and S2 only, input order stands, no reason (the blind rule)…');
{
  const live = mkFixture({ weekId: 'w_t17', cps: { p3: 6, p4: 6, p1: 4 }, epEnabled: false, weekOver: { status: 'live', finalizedAt: null },
    alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  const byId = Object.fromEntries(live.players.map(p => [p.playerId, p]));
  const a = runWeek(live, [byId.p3, byId.p4, byId.p1]).rows, b = runWeek(live, [byId.p4, byId.p3, byId.p1]).rows;
  assert(a.map(r => r.playerId).join() === 'p3,p4,p1' && b.map(r => r.playerId).join() === 'p4,p3,p1', 'T17: the tied pair FOLLOWS the input order in each run (proves no S3-S5 ran)');
  assert(runWeek(live).tie === null, 'T17: the builder returns NO context for a live week (the first of two independent proofs)');
  assert([...a, ...b].every(r => !('tieBreak' in r)), 'T17: no reason object on any row');
  // the second proof: even a context FORCED onto a not-final slate is ignored by the ranker
  const finalFx = mkFixture({ weekId: 'w_t17', cps: { p3: 6, p4: 6, p1: 4 }, epEnabled: false, alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  const forced = ctxFor(finalFx, finalFx.players);
  const notFinalGames = finalFx.games.map(g => ({ ...g, status: 'live', homeScore: null, awayScore: null }));
  const f1 = calculateWeeklyResults('w_t17', [byId.p4, byId.p3, byId.p1], finalFx.picks, notFinalGames, null, forced).map(r => r.playerId).join();
  const f2 = calculateWeeklyResults('w_t17', [byId.p3, byId.p4, byId.p1], finalFx.picks, notFinalGames, null, forced).map(r => r.playerId).join();
  assert(forced && f1.startsWith('p4,p3') && f2.startsWith('p3,p4'), 'T17: a context supplied with `anyFinal` false is ignored — input order stands (the second, independent proof)');
  const fin = runAllOrders(finalFx);
  assert(fin.same && fin.first.order.join() === 'p3,p4,p1', 'T17: the SAME data with status final gives p3,p4,p1 under every input order');
}

console.log('\n[T18] a demo week: the same answer as T3, rehearsable (even with a pre-date stamp)…');
{
  const fx = mkFixture({ weekId: 'w_t18', cps: { p3: 6, p4: 6, p1: 4 }, epEnabled: false, weekOver: { dataSourceMode: 'demo', finalizedAt: LONG_BEFORE_AT },
    alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  vector('T18', fx, { order: ['p3', 'p4', 'p1'], winner: 'p3', winnerStage: 'alma', loser: 'p1', loserStage: null, wonByTiebreaker: false });
}

console.log('\n[T19] same school, both had no game: S3 skipped, the Extra Point decides…');
{
  const fx = mkFixture({ weekId: 'w_t19', cps: { p1: 6, p6: 6 }, epActual: 52, ep: { p1: 50, p6: 48 } });
  vector('T19', fx, { order: ['p1', 'p6'], winner: 'p1', winnerStage: 'ep', loser: 'p6', loserStage: 'ep', wonByTiebreaker: false });
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T30] THE DRAW — pinned values and the six-player draw orders
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T30] drawKey — pinned values and orders…');
{
  const { drawKey } = scoring;
  const PINS = [['w_t9', 'p3', 760867406], ['w_t9', 'p4', 2922202284], ['w_t10', 'p2', 2029646640], ['w_t10', 'p5', 1775729197], ['w_t19', 'p1', 3938262274], ['w_t19', 'p6', 3420805220],
    ['r7_w1', 'r7_x', 3667571276], ['r7_w1', 'r7_y', 3271450168], ['r9_wa', 'r9_x', 2890385379], ['r9_wa', 'r9_y', 2923253287]];
  for (const [seed, pid, v] of PINS) assert(drawKey(seed, pid) === v, `T30: drawKey('${seed}','${pid}') = ${v}`);
  const orderOf = (seed) => ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].sort((a, b) => drawKey(seed, a) - drawKey(seed, b)).join('<');
  assert(orderOf('w_t9') === 'p2<p3<p1<p5<p4<p6', 'T30: the six-player draw order for seed w_t9');
  assert(orderOf('w_t10') === 'p1<p6<p5<p2<p3<p4', 'T30: …for w_t10');
  assert(orderOf('w_t2') === 'p2<p5<p3<p4<p1<p6', 'T30: …for w_t2');
  assert(orderOf('grp_a') === 'p4<p2<p5<p1<p6<p3', 'T30: …for grp_a');
  assert(drawKey('x', 'y') === drawKey('x', 'y') && drawKey(1, 2) === drawKey('1', '2'), 'T30: pure — the same inputs give the same key, and a number seed/id is its string');
}


// ─────────────────────────────────────────────────────────────────────────────────────────
// [T12b] S3 and S4 ignore game.multiplier (SC-K7 1): "tied" is defined on the weighted tally, and NOTHING scales a tie stage
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T12b] the alma mater step and the Extra Point step never read a game multiplier…');
{
  const MULTS = [1, 2, 3, 0.5, NaN, 'x', -1];
  const seen = [];
  for (const m of MULTS) {
    const fx = mkFixture({ weekId: 'w_t12b', cps: { p2: 5, p3: 5, p5: 5, p1: 2 }, epActual: 52, ep: { p2: 50, p3: 50, p5: 52 },
      alma: [{ school: 'Oklahoma', result: 'push', over: { multiplier: m } }, { school: 'Notre Dame', result: 'covered', over: { multiplier: m } }, { school: 'Arkansas', result: 'notcov', over: { multiplier: m } }] });
    const tie = ctxFor(fx, fx.players);
    seen.push(JSON.stringify({ alma: tie.alma, ep: tie.ep, facts: tie.facts, order: calculateWeeklyResults('w_t12b', fx.players, fx.picks, fx.games, null, tie).map(r => r.playerId) }));
  }
  assert(seen.every(x => x === seen[0]), `T12b: the alma keys, the Extra Point keys, the echo and the order are IDENTICAL for alma-game multipliers ${MULTS.map(String).join(', ')}`);
  assert(JSON.parse(seen[0]).order.join() === 'p3,p2,p5,p1', 'T12b: …and it is the T7 answer (covered > push > did not cover)');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T22] THE FORWARD-ONLY GUARD (DI-467 part 3, N-3)
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T22] tieRuleInForce: before, at and after the effective date, no stamp, demo, groups, preview, settling…');
{
  const { tieRuleInForce, TIE_RULE_EFFECTIVE_AT } = tieCtx;
  const wk = (over = {}) => ({ weekId: 'w22', status: 'final', dataSourceMode: 'live', finalizedAt: FINALIZED_AT, ...over });
  const at = Date.parse(TIE_RULE_EFFECTIVE_AT);
  assert(tieRuleInForce([wk({ finalizedAt: new Date(at - 1).toISOString() })]) === false, 'T22: finalized ONE millisecond before the constant: not in force (today\'s behaviour, every surface)');
  assert(tieRuleInForce([wk({ finalizedAt: TIE_RULE_EFFECTIVE_AT })]) === true, 'T22: finalized exactly AT the constant: in force');
  assert(tieRuleInForce([wk({ finalizedAt: new Date(at + 1).toISOString() })]) === true, 'T22: one millisecond after: in force');
  assert(tieRuleInForce([wk({ finalizedAt: null })]) === false && tieRuleInForce([wk({ finalizedAt: undefined })]) === false && tieRuleInForce([wk({ finalizedAt: '' })]) === false && tieRuleInForce([wk({ finalizedAt: 'not a date' })]) === false,
    'T22: no stamp, an empty stamp, an unparseable stamp: settled before the rule existed — not in force');
  assert(tieRuleInForce([wk({ dataSourceMode: 'demo', finalizedAt: null })]) === true && tieRuleInForce([wk({ dataSourceMode: 'demo', finalizedAt: LONG_BEFORE_AT })]) === true,
    'T22: a demo week rehearses the rule whatever its stamp (commissioner-only, no obligation ever created)');
  for (const status of ['draft', 'open', 'locked', 'live']) assert(tieRuleInForce([wk({ status })]) === false, `T22: a ${status} week: S3-S5 never run`);
  const early = wk({ weekId: 'a', finalizedAt: PRE_RULE_AT }), late = wk({ weekId: 'b', finalizedAt: FINALIZED_AT });
  assert(tieRuleInForce([early, late]) === true && tieRuleInForce([early, { ...early, weekId: 'c' }]) === false, 'T22: a group: the LATEST member\'s stamp decides (one late member puts it in force; two early ones do not)');
  assert(tieRuleInForce([early, { ...late, status: 'live' }]) === false, 'T22: a group with one member not final: not in force (no pooled rank yet)');
  assert(tieRuleInForce([wk({ status: 'live' })], { forPreview: true }) === true && tieRuleInForce([], { forPreview: true }) === false && tieRuleInForce(null) === false && tieRuleInForce([]) === false,
    'T22: forPreview (the commissioner\'s "if I finalize now") is in force on a live week; no week at all is never in force');
  // N-3: the live-to-final transition itself settles under the rule, whatever this device's clock says
  const skewed = wk({ finalizedAt: '2020-01-01T00:00:00.000Z' });
  assert(tieRuleInForce([skewed]) === false && tieRuleInForce([skewed], { settlingNow: true }) === true, 'T22: a stamp before the constant is NOT in force on a read, and IS in force on the transition itself (settlingNow, N-3)');
  assert(tieRuleInForce([{ ...skewed, status: 'live' }], { settlingNow: true }) === false, 'T22: settlingNow never overrides "every week must be final"');
  // a pre-date week keeps today's accidental order: the builder hands scoring.js NOTHING
  const fx = mkFixture({ weekId: 'w_t22', cps: { p3: 6, p4: 6 }, epEnabled: false, weekOver: { finalizedAt: PRE_RULE_AT },
    alma: [{ school: 'Notre Dame', result: 'notcov' }, { school: 'USC', result: 'covered' }] });
  const byId = Object.fromEntries(fx.players.map(p => [p.playerId, p]));
  const a = runWeek(fx, [byId.p3, byId.p4]), b = runWeek(fx, [byId.p4, byId.p3]);
  assert(a.tie === null && a.rows.map(r => r.playerId).join() === 'p3,p4' && b.rows.map(r => r.playerId).join() === 'p4,p3' && [...a.rows, ...b.rows].every(r => !('tieBreak' in r)),
    'T22: a week finalized BEFORE the date gets no context: the tied pair follows the input order exactly as today (even though S3 would have picked p4), and no row carries a descriptor');
  assert(Number.isFinite(at) && Number.isFinite(Date.parse(tieCtx.ALMA_SNAPSHOT_EPOCH_AT)),
    'T22: both release constants parse as instants (whether shipped PROVISIONAL or stamped; [T-G] owns which state the file is in; the two are NOT ordered, because the pre-deploy read can stamp the effective date later than the epoch)');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T23] THE SNAPSHOT READER: tiers, sources, hygiene, hostile strings, the builder that never throws (SC-K1, K3, K5)
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T23] almaSnapshotForWeek: three tiers and none; strings only; own-property; sorted roster; writer-independent keys…');
{
  const { almaSnapshotForWeek, fallbackTiersAllowed, ALMA_SNAPSHOT_EPOCH_AT } = tieCtx;
  const pl = [{ playerId: 'p3', almaMater: ' notre dame ' }, { playerId: 'p4', almaMater: 'USC' }, { playerId: 'p5', almaMater: 'Clemson' }, { playerId: 'p6', almaMater: '' }];
  const early = LOCKED_AT;

  const t1 = almaSnapshotForWeek({ lockedAt: early, lockedAlmaByPlayer: { p3: 'Notre Dame', p4: 'USC' }, lockedAlmaMaters: ['Clemson'] }, { players: pl, liveRoster: ['Clemson'] });
  assert(t1.source === 'snapshot' && t1.roster.join() === 'Notre Dame,USC' && t1.schoolOf('p3') === 'Notre Dame' && t1.schoolOf('p5') === null && t1.schoolOf('p9') === null,
    'T23: tier 1 (snapshot) wins over a list and the live roster; a player absent from the map has NO school (a late joiner); the roster is the map\'s values');
  const t2 = almaSnapshotForWeek({ lockedAt: early, lockedAlmaMaters: ['Notre Dame', 'USC'] }, { players: pl, liveRoster: ['Clemson'] });
  assert(t2.source === 'locked-roster' && t2.schoolOf('p3') === 'Notre Dame' && t2.schoolOf('p5') === null && t2.schoolOf('p4') === 'USC',
    'T23: tier 2 (locked roster): a player\'s CURRENT school counts only if it equals (trim, case-insensitive) an entry of the list, and then it is that ENTRY; Clemson is not on it');
  const t3 = almaSnapshotForWeek({ lockedAt: early }, { players: pl, liveRoster: ['Clemson', 'USC'] });
  assert(t3.source === 'live' && t3.roster.join() === 'Clemson,USC' && t3.schoolOf('p5') === 'Clemson' && t3.schoolOf('p6') === null, 'T23: tier 3 (live): the live roster and the current school; a blank school is none');
  const none1 = almaSnapshotForWeek({ lockedAt: LOCKED_AFTER_EPOCH }, { players: pl, liveRoster: ['Clemson'] });
  assert(none1.source === 'none' && none1.roster.length === 0 && none1.schoolOf('p5') === null, 'T23: AFTER the epoch with no map: tier none — no roster, no school (SC-K5: S3 is skipped, never a current school)');
  assert(almaSnapshotForWeek({}, { players: pl, liveRoster: ['Clemson'] }).source === 'none' && almaSnapshotForWeek(null, {}).source === 'none' && almaSnapshotForWeek({ lockedAt: 'x' }, { players: pl }).source === 'none',
    'T23: no lockedAt (or an unusable one) and no map: tier none');
  const e = Date.parse(ALMA_SNAPSHOT_EPOCH_AT);
  assert(fallbackTiersAllowed({ lockedAt: new Date(e - 1).toISOString() }) === true && fallbackTiersAllowed({ lockedAt: ALMA_SNAPSHOT_EPOCH_AT }) === false && fallbackTiersAllowed({ lockedAt: new Date(e + 1).toISOString() }) === false,
    'T23: the fallback tiers end AT the epoch: one millisecond before is allowed, exactly at it is not');
  // tier 1 is available for ANY week, even one locked after the epoch (that is the point of the snapshot)
  assert(almaSnapshotForWeek({ lockedAt: LOCKED_AFTER_EPOCH, lockedAlmaByPlayer: { p3: 'Notre Dame' } }, { players: pl }).source === 'snapshot', 'T23: a snapshot is used for any week, including one locked after the epoch');
  // unusable maps are NO snapshot (and then the epoch decides what that means)
  for (const [name, bad] of [['an array', ['Notre Dame']], ['a string', 'p3=Notre Dame'], ['a number', 7], ['null', null], ['a map with a non-string value', { p3: 'Notre Dame', p4: 5 }], ['a map with a null value', { p3: null }]]) {
    assert(almaSnapshotForWeek({ lockedAt: early, lockedAlmaByPlayer: bad, lockedAlmaMaters: ['USC'] }, { players: pl }).source === 'locked-roster'
      && almaSnapshotForWeek({ lockedAt: LOCKED_AFTER_EPOCH, lockedAlmaByPlayer: bad }, { players: pl }).source === 'none', `T23: ${name} is treated as NO snapshot (tier 2 before the epoch, tier none after)`);
  }
  // an empty object is a valid "locked, nobody had a school"
  const empty = almaSnapshotForWeek({ lockedAt: early, lockedAlmaByPlayer: {} }, { players: pl, liveRoster: ['Clemson'] });
  assert(empty.source === 'snapshot' && empty.roster.length === 0 && empty.schoolOf('p3') === null, 'T23: `{}` is a snapshot of nobody: an empty roster, no school for anyone (never a fall-through to the live roster)');
  // hygiene (SC-K3)
  const hyg = almaSnapshotForWeek({ lockedAt: early, lockedAlmaByPlayer: { p3: '\tNotre Dame ', p4: '   ', p5: 'notre dame', p6: 'Oklahoma State', p1: 'Oklahoma' } }, { players: pl });
  assert(hyg.roster.join() === 'Oklahoma State,Notre Dame,Oklahoma' && hyg.schoolOf('p3') === 'Notre Dame' && hyg.schoolOf('p4') === null,
    `T23: values are JS-trimmed (a tab and a non-breaking space), a whitespace-only value is no school, the roster is de-duplicated case-insensitively and sorted LONGEST FIRST (got ${hyg.roster.join('|')})`);
  const orderA = almaSnapshotForWeek({ lockedAt: early, lockedAlmaByPlayer: { p1: 'Oklahoma', p6: 'Oklahoma State' } }, { players: pl }).roster.join();
  const orderB = almaSnapshotForWeek({ lockedAt: early, lockedAlmaByPlayer: { p6: 'Oklahoma State', p1: 'Oklahoma' } }, { players: pl }).roster.join();
  assert(orderA === orderB && orderA === 'Oklahoma State,Oklahoma', 'T23: the roster does not depend on the map\'s key order (jsonb order vs insertion order)');
  // the writer-independence proof: a SERVER-shaped map and an almaByPlayerNow()-shaped map for the same league give identical keys and facts
  {
    const mk = (snapshot) => mkFixture({ weekId: 'w_t23w', cps: { p3: 5, p4: 5 }, epEnabled: false, snapshot,
      alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
    const server = mk({ p4: 'USC', p3: '\tNotre Dame\t' }), client = mk({ p3: 'Notre Dame', p4: 'USC' });
    const a = ctxFor(server, server.players), b = ctxFor(client, client.players);
    assert(JSON.stringify({ alma: a.alma, facts: a.facts }) === JSON.stringify({ alma: b.alma, facts: b.facts }) && a.alma.p3.played === true,
      'T23: a SERVER-shaped map (jsonb key order, a tab inside the value) and an almaByPlayerNow()-shaped map (insertion order, JS-trimmed) produce IDENTICAL alma keys and facts');
  }
  // a player who joined AFTER the lock is absent from the map: no school, so S3 is skipped (conservative)
  {
    const fx = mkFixture({ weekId: 'w_t23j', cps: { p3: 5, p4: 5 }, snapshot: { p3: 'Notre Dame' }, epActual: 52, ep: { p3: 50, p4: 52 },
      alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
    const r = runAllOrders(fx);
    assert(r.same && r.first.order.join() === 'p4,p3' && r.first.winnerStage === 'ep', 'T23: a late joiner (absent from the map) has no school: S3 is skipped for the pair and the Extra Point decides');
  }
}

console.log('\n[T23] the five names that are also Object.prototype members, as a frozen snapshot, a frozen list and a player id (SC-K1)…');
{
  const HOSTILE = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  const quiet = (fn) => { const orig = console.error; console.error = () => {}; try { return fn(); } finally { console.error = orig; } };
  for (const name of HOSTILE) {
    let threw = null, viaMap = null, viaList = null;
    try {
      const viaSnap = mkFixture({ weekId: 'w_t23h', cps: { p3: 5, p4: 5 }, epActual: 52, ep: { p3: 50, p4: 52 }, schools: { p3: name }, snapshot: JSON.parse(`{"p3":${JSON.stringify(name)},"p4":"USC"}`),
        alma: [{ school: name, result: 'covered' }, { school: 'USC', result: 'notcov' }] });
      viaMap = runAllOrders(viaSnap);
      const viaRoster = mkFixture({ weekId: 'w_t23h', cps: { p3: 5, p4: 5 }, epActual: 52, ep: { p3: 50, p4: 52 }, schools: { p3: name }, snapshot: null, lockedAlmaMaters: [name, 'USC'],
        alma: [{ school: name, result: 'covered' }, { school: 'USC', result: 'notcov' }] });
      viaList = runAllOrders(viaRoster);
    } catch (e) { threw = e; }
    assert(threw === null, `T23: "${name}" as a frozen snapshot value AND as a frozen roster entry never throws${threw ? ' — ' + threw.message : ''}`);
    assert(viaMap && viaMap.same && viaMap.first.winner !== null && viaMap.first.loser !== null && viaList && viaList.same && viaList.first.winner !== null,
      `T23: "${name}": a winner and a loser are still decided, identically under ten input orders`);
    // matches nothing unless a game's team is literally that string (exact equality), which here it is
    assert(viaMap && viaMap.first.winnerStage === 'alma' && viaMap.first.winner === 'p3', `T23: "${name}": a game whose team IS that string matches by exact equality, like any school`);
  }
  // an INHERITED property is not a snapshot entry (SC-K1: own-property reads, `ownGet`): with Object.prototype.p4 polluted for the duration, a player the snapshot does not list
  // still has no school, so S3 is skipped (not everyone "played") and the Extra Point decides, exactly as without the pollution. A bare `map[pid]` read would hand p4 the school.
  {
    const fx = mkFixture({ weekId: 'w_t23q', cps: { p3: 5, p4: 5 }, epActual: 52, ep: { p3: 50, p4: 52 }, schools: { p4: 'USC' }, snapshot: { p3: 'Notre Dame', p5: 'USC' },
      alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
    const clean = runAllOrders(fx).first;
    let polluted = null;
    Object.prototype.p4 = 'USC';
    try { polluted = runAllOrders(fx).first; } finally { delete Object.prototype.p4; }
    assert(({}).p4 === undefined, 'T23: fixture check: the prototype pollution was cleaned up');
    assert(clean.winner === 'p4' && clean.winnerStage === 'ep' && JSON.stringify(polluted) === JSON.stringify(clean),
      `T23: an inherited property is NOT a snapshot entry: with Object.prototype.p4 = "USC" the result is unchanged (Extra Point decides, p4 wins; polluted ${JSON.stringify(polluted)})`);
  }
  // an alma game whose teams are prototype names and a school that is not: nothing matches, nothing throws
  {
    const fx = mkFixture({ weekId: 'w_t23i', cps: { p3: 5, p4: 5 }, epActual: 52, ep: { p3: 50, p4: 52 }, alma: [{ school: 'toString', result: 'covered' }] });
    assert(runAllOrders(fx).first.winnerStage === 'ep', 'T23: a school that matches no roster entry is simply "not played": the Extra Point decides');
  }
  // hostile PLAYER ids in the ranking, the keys and the draw
  {
    const ids = ['__proto__', 'constructor', 'toString'];
    const weekId = 'w_t23p';
    const players = ids.map(id => ({ playerId: id, displayName: id, active: true, almaMater: 'USC' }));
    const games = [mkGame(weekId, 1, 'H'), almaGame(weekId, 1, 'USC', 'home', 'covered')];
    const picks = ids.map(id => ({ weekId, gameId: `${weekId}_g1`, playerId: id, selectedTeam: `${weekId}H1` }));
    const week = { weekId, status: 'final', finalizedAt: FINALIZED_AT, lockedAt: LOCKED_AT, extraPointEnabled: false, lockedAlmaByPlayer: JSON.parse('{"__proto__":"USC","constructor":"USC","toString":"USC"}') };
    let threw = null, rows = null, tie = null;
    try {
      tie = buildWeekTieContext({ weeks: [week], players, getGames: () => games.map(g => ({ ...g, kickoff: KICKOFF })), liveRoster: [], almaApplicable: true });
      rows = calculateWeeklyResults(weekId, players, picks, games.map(g => ({ ...g, kickoff: KICKOFF })), null, tie);
    } catch (e) { threw = e; }
    assert(threw === null && rows && rows.length === 3 && rows.filter(r => r.isWinner).length === 1 && rows.filter(r => r.isLoser).length === 1, `T23: players whose ids are __proto__ / constructor / toString rank, and a winner and loser are decided${threw ? ' — ' + threw.message : ''}`);
    assert(tie && Object.getPrototypeOf(tie.alma) === null && Object.getPrototypeOf(tie.facts) === null && tie.alma['__proto__'] && tie.alma['__proto__'].played === true,
      'T23: every map the builder returns is NULL-PROTOTYPE, and a "__proto__" player id is an ordinary own key in it');
    const again = calculateWeeklyResults(weekId, [...players].reverse(), picks, games.map(g => ({ ...g, kickoff: KICKOFF })), null, tie);
    assert(JSON.stringify(rows.map(r => r.playerId)) === JSON.stringify(again.map(r => r.playerId)), 'T23: …and the draw among them is the same under reversed input');
  }
  // the builder NEVER throws out of finalize: a forced fault in either half degrades that half and the week is still decided
  {
    const fx = mkFixture({ weekId: 'w_t23d', cps: { p3: 5, p4: 5 }, epActual: 52, ep: { p3: 50, p4: 52 }, alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
    let tie = null, threw = null;
    try { tie = quiet(() => buildWeekTieContext({ weeks: [fx.week], players: fx.players, getGames: () => { throw new Error('boom'); }, liveRoster: [], almaApplicable: true })); } catch (e) { threw = e; }
    assert(threw === null && tie && tie.alma === null && JSON.stringify(tie.degraded) === '["alma"]' && tie.ep && tie.ep.byPlayer,
      'T23: a fault inside the alma half is caught: alma is null, degraded names it, the Extra Point half still stands');
    const rows = calculateWeeklyResults('w_t23d', fx.players, fx.picks, fx.games, null, tie);
    assert(rows[0].playerId === 'p4' && rows[0].tieBreak.stage === 'ep', 'T23: …and the week is still decided (the Extra Point, as the degraded toast says)');
    const trap = new Proxy({ ...fx.week }, { get(t, k) { if (k === 'extraPointActual') throw new Error('trap'); return t[k]; } });
    let tie2 = null, threw2 = null;
    try { tie2 = quiet(() => buildWeekTieContext({ weeks: [trap], players: fx.players, getGames: () => fx.games, liveRoster: [], almaApplicable: true })); } catch (e) { threw2 = e; }
    assert(threw2 === null && tie2 && tie2.ep === null && JSON.stringify(tie2.degraded) === '["ep"]' && tie2.alma, 'T23: a fault inside the Extra Point half degrades only that half');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T31] SC-K2 — games that kicked off before the week locked do not count
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T31] a graded alma game counts only if it kicked off at or after its own part\'s lock (SC-K2)…');
{
  const mk = (over = {}) => mkFixture({ weekId: 'w_t31', cps: { p3: 5, p4: 5 }, epActual: 52, ep: { p3: 50, p4: 52 }, snapshot: { p3: 'Notre Dame', p4: 'USC' },
    alma: [{ school: 'Notre Dame', result: 'covered', over: over.nd || {} }, { school: 'USC', result: 'notcov', over: over.usc || {} }], weekOver: over.week || {} });
  const stageOf = (fx) => runAllOrders(fx).first;
  // (a) THE EXPLOIT: a Thursday game already final before the lock, the school switched to the one that covered, the snapshot froze the new school
  const BEFORE_LOCK = isoAt(Date.parse(LOCKED_AT) - 2 * DAY);
  const a = stageOf(mk({ nd: { kickoff: BEFORE_LOCK } }));
  assert(a.winnerStage === 'ep' && a.order.join() === 'p4,p3', 'T31 (a): the exploit — a result already known before the lock does not count: S3 is skipped and the Extra Point decides');
  // (b) kickoff EQUAL to lockedAt counts
  const b = stageOf(mk({ nd: { kickoff: LOCKED_AT }, usc: { kickoff: LOCKED_AT } }));
  assert(b.winnerStage === 'alma' && b.order.join() === 'p3,p4', 'T31 (b): a kickoff exactly AT the lock counts (the lock closes picks at that instant)');
  // (c) a missing / blank / unparseable kickoff fails closed
  for (const k of [null, undefined, '', 'tomorrow-ish']) assert(stageOf(mk({ nd: { kickoff: k } })).winnerStage === 'ep', `T31 (c): kickoff ${JSON.stringify(k)} does not count (fail closed): the Extra Point decides`);
  // (d) a date-only kickoff does not count
  assert(stageOf(mk({ nd: { kickoffDateOnly: true } })).winnerStage === 'ep', 'T31 (d): kickoffDateOnly (time to be announced) does not count');
  // (e) a part with no lockedAt: no game counts
  assert(stageOf(mk({ week: { lockedAt: null } })).winnerStage === 'ep' && stageOf(mk({ week: { lockedAt: 'garbage' } })).winnerStage === 'ep', 'T31 (e): a week with no usable lockedAt: NO alma game counts');
  // (f) demo weeks are exempt (fixed historical kickoffs; demo weeks are commissioner-only and create no obligation)
  assert(stageOf(mk({ nd: { kickoff: BEFORE_LOCK }, week: { dataSourceMode: 'demo' } })).winnerStage === 'alma', 'T31 (f): a demo week is exempt from the kickoff rule (so S3 is rehearsable)');
  // (g) a two-part group: each part is judged against ITS OWN lock
  {
    const weekOver = (wk, lockedAt, tb) => ({ groupId: 'grp_k2', weekNumber: wk, lockedAt, isGroupTiebreaker: tb === true });
    const p1 = mkFixture({ weekId: 'k2_1', cps: { p3: 3, p4: 3 }, epEnabled: false, snapshot: { p3: 'Notre Dame', p4: 'USC' }, alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }], weekOver: weekOver(1, isoAt(Date.parse(KICKOFF) + 8 * 3600e3)) });   // locked LATE: both its games kicked off BEFORE its lock
    const p2 = mkFixture({ weekId: 'k2_2', cps: { p3: 3, p4: 3 }, epEnabled: false, snapshot: { p3: 'Notre Dame', p4: 'USC' }, alma: [{ school: 'USC', result: 'covered' }, { school: 'Notre Dame', result: 'notcov' }], weekOver: weekOver(2, LOCKED_AT, true) });
    const weeks = [p1.week, p2.week], games = [...p1.games, ...p2.games], picks = [...p1.picks, ...p2.picks];
    const tie = buildWeekTieContext({ weeks, players: p1.players, getGames: (id) => games.filter(g => g.weekId === id), liveRoster: [], almaApplicable: true });
    assert(tie.alma.p4.net === 1 && tie.alma.p3.net === -1 && tie.facts.p4.alma.cov === 1 && tie.facts.p3.alma.mis === 1,
      'T31 (g): Part 1 locked AFTER its games kicked off, Part 2 on time: only Part 2\'s games count (USC +1, Notre Dame -1)');
    const rows = calculateGroupWeeklyResults(weeks, p1.players, picks, games, tie);
    assert(rows[0].playerId === 'p4' && rows[0].tieBreak.stage === 'alma', 'T31 (g): …and the pooled group is decided by it');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T26] THE WORDS — every caption string, named and unnamed, every stage, both ends (DI-468; SC-K6)
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T26] captions: exact strings, constant-led, honest, never "bye" or "arbitrarily"…');
{
  const { tieCaption, tieReason, tieNoteLines, tieRecapPhrase, validTieBreak, TIE_COPY } = tieCtx;
  const A = (w, c, m, p = 0, team = 'X') => ({ team, cov: c, mis: m, psh: p, src: 'snapshot' });
  const alma = (end, me, other, src) => ({ v: 1, end, stage: 'alma', vs: 'p4', me, other, ...(src ? { src } : { src: 'snapshot' }) });
  const eq = (got, want, label) => assert(got === want, `${label}${got === want ? '' : ` — got "${got}"`}`);
  const NM = { otherName: 'Koby' };
  // tiebreaker
  const tbW = { v: 1, end: 'winner', stage: 'tiebreaker', vs: 'p4', me: { delta: 3 }, other: { delta: 7 } };
  const tbL = { v: 1, end: 'loser', stage: 'tiebreaker', vs: 'p3', me: { delta: 7 }, other: { delta: 3 } };
  eq(tieCaption(tbW, NM), 'Won the tie: tiebreaker off by 3, Koby off by 7', 'T26: tiebreaker, winner, unnamed');
  eq(tieCaption(tbL, { otherName: 'Kevin' }), 'Last on the tie: tiebreaker off by 7, Kevin off by 3', 'T26: tiebreaker, loser, unnamed');
  eq(tieCaption(tbW, { named: true, subject: 'Kevin', otherName: 'Koby' }), 'Tie: Kevin won. Tiebreaker off by 3, Koby off by 7', 'T26: tiebreaker, winner, named');
  eq(tieCaption(tbL, { named: true, subject: 'Jacob', otherName: 'Kevin' }), 'Tie: Jacob is last. Tiebreaker off by 7, Kevin off by 3', 'T26: tiebreaker, loser, named');
  eq(tieCaption({ ...tbW, me: { delta: 2.5 }, other: { delta: 0.1 + 0.2 } }, NM), 'Won the tie: tiebreaker off by 2.5, Koby off by 0.3', 'T26: numbers print without float noise (2.5, 0.3 — not 0.30000000000000004)');
  eq(tieCaption({ ...tbW, other: { delta: null } }, NM), 'Won the tie: tiebreaker off by 3, Koby made no guess', 'T26: a missing guess on the other side reads "{Name} made no guess"');
  eq(tieCaption({ ...tbL, me: { delta: null } }, { otherName: 'Kevin' }), 'Last on the tie: no tiebreaker guess, Kevin off by 3', 'T26: a missing guess on his own side reads "no tiebreaker guess"');
  // alma
  eq(tieCaption(alma('winner', A(1, 1, 0, 0, 'Notre Dame'), A(1, 0, 1, 0, 'USC')), NM), 'Won the tie: Notre Dame covered, USC did not cover', 'T26: alma, winner, unnamed');
  eq(tieCaption(alma('loser', A(1, 0, 1, 0, 'Oklahoma'), A(1, 1, 0, 0, 'Arkansas')), { otherName: 'Jacob' }), 'Last on the tie: Oklahoma did not cover, Arkansas covered', 'T26: alma, loser, unnamed');
  eq(tieCaption(alma('winner', A(1, 1, 0, 0, 'Notre Dame'), A(1, 0, 1, 0, 'USC')), { named: true, subject: 'Kevin', otherName: 'Koby' }), 'Tie: Kevin won. Notre Dame covered, USC did not cover', 'T26: alma, winner, named');
  eq(tieCaption(alma('loser', A(1, 0, 1, 0, 'Oklahoma'), A(1, 1, 0, 0, 'Arkansas')), { named: true, subject: 'Jacob', otherName: 'Brayden' }), 'Tie: Jacob is last. Oklahoma did not cover, Arkansas covered', 'T26: alma, loser, named');
  eq(tieCaption(alma('winner', A(1, 0, 0, 1, 'Notre Dame'), A(1, 0, 1, 0, 'USC')), NM), 'Won the tie: Notre Dame pushed, USC did not cover', 'T26: a single push reads "pushed"');
  eq(tieCaption(alma('winner', A(1, 1, 0, 0, 'Arkansas'), A(1, 1, 1, 0, 'Oklahoma')), NM), 'Won the tie: Arkansas covered, Oklahoma went 1-1 against the spread', 'T26: more than one graded game reads "went 1-1 against the spread"');
  eq(tieCaption(alma('winner', A(1, 1, 0, 0, 'Arkansas'), A(1, 1, 1, 1, 'Oklahoma')), NM), 'Won the tie: Arkansas covered, Oklahoma went 1-1-1 against the spread', 'T26: …with a push it reads "went 1-1-1"');
  eq(tieCaption(alma('winner', A(1, 1, 0, 0, 'Clemson'), A(1, 0, 1, 0, 'USC'), 'live'), NM), 'Won the tie: Clemson covered, USC did not cover (schools as listed now)', 'T26: src live adds " (schools as listed now)"');
  eq(tieCaption(alma('winner', A(1, 1, 0, 0, 'Clemson'), A(1, 0, 1, 0, 'USC'), 'locked-roster'), NM), 'Won the tie: Clemson covered, USC did not cover (schools as listed now)', 'T26: src locked-roster adds it too');
  assert(!tieCaption(alma('winner', A(1, 1, 0, 0, 'Clemson'), A(1, 0, 1, 0, 'USC'), 'snapshot'), NM).includes('listed now'), 'T26: src snapshot adds NO note');
  // ep
  const epF = (end, me, other = { cls: 0, guess: 40, delta: 12 }) => ({ v: 1, end, stage: 'ep', vs: 'p4', me, other });
  eq(tieCaption(epF('winner', { cls: 0, guess: 50, delta: 2 }), NM), 'Won the tie on the Extra Point: 50 yd, 2 under', 'T26: Extra Point, winner closer');
  eq(tieCaption(epF('winner', { cls: 0, guess: 52, delta: 0 }), NM), 'Won the tie on the Extra Point: 52 yd, exact', 'T26: Extra Point, winner exact');
  eq(tieCaption(epF('loser', { cls: 0, guess: 47, delta: 5 }), { otherName: 'Kevin' }), 'Last on the tie on the Extra Point: 47 yd, 5 under', 'T26: Extra Point, loser under');
  eq(tieCaption(epF('winner', { cls: 1, guess: 57, delta: 5 }, { cls: 2, guess: null, delta: null }), NM), 'Won the tie on the Extra Point: busted at 57 yd, Koby made no entry', 'T26: Extra Point, winner busted and the other made no entry');
  eq(tieCaption(epF('loser', { cls: 2, guess: null, delta: null }, { cls: 1, guess: 57, delta: 5 }), { otherName: 'Kevin' }), 'Last on the tie on the Extra Point: no Extra Point entry', 'T26: Extra Point, loser made no entry');
  eq(tieCaption(epF('loser', { cls: 1, guess: 57, delta: 5 }, { cls: 0, guess: 50, delta: 2 }), { otherName: 'Kevin' }), 'Last on the tie on the Extra Point: busted at 57 yd', 'T26: Extra Point, loser busted');
  eq(tieCaption(epF('winner', { cls: 0, guess: 50, delta: 2 }), { named: true, subject: 'Kevin', otherName: 'Koby' }), 'Tie: Kevin won on the Extra Point. 50 yd, 2 under', 'T26: Extra Point, winner, named');
  eq(tieCaption(epF('loser', { cls: 1, guess: 57, delta: 5 }, { cls: 0, guess: 50, delta: 2 }), { named: true, subject: 'Jacob', otherName: 'Kevin' }), 'Tie: Jacob is last on the Extra Point. Busted at 57 yd', 'T26: Extra Point, loser, named');
  // draw
  const drawW = { v: 1, end: 'winner', stage: 'draw', vs: 'p4', me: null, other: null }, drawL = { ...drawW, end: 'loser', vs: 'p3' };
  eq(tieCaption(drawW), "Dead heat on every tiebreaker. Settled by the week's draw.", 'T26: draw, winner, unnamed');
  eq(tieCaption(drawL), "Dead heat on every tiebreaker. Settled by the week's draw.", 'T26: draw, loser, unnamed (the same sentence)');
  eq(tieCaption(drawW, { named: true, subject: 'Kevin', otherName: 'Koby' }), "Tie: Dead heat between Kevin and Koby on every tiebreaker. Settled by the week's draw.", 'T26: draw, named');
  // recap phrases
  eq(tieRecapPhrase(alma('winner', A(1, 1, 0, 0, 'Notre Dame'), A(1, 0, 1, 0, 'USC')), NM), 'won the tie: Notre Dame covered, USC did not cover', 'T26: recap phrase, alma winner');
  eq(tieRecapPhrase(epF('winner', { cls: 0, guess: 50, delta: 2 }), NM), 'won the tie on the Extra Point: 50 yd, 2 under', 'T26: recap phrase, Extra Point winner');
  eq(tieRecapPhrase(alma('loser', A(1, 0, 1, 0, 'Arkansas'), A(1, 1, 0, 0, 'Notre Dame')), { otherName: 'Kevin' }), 'last on the tie: Arkansas did not cover, Notre Dame covered', 'T26: recap phrase, alma loser');
  eq(tieRecapPhrase(drawW), "dead heat on every tiebreaker, settled by the week's draw", 'T26: recap phrase, draw');
  // note lines: a draw is printed ONCE when both ends name the same two players
  const nameOf = (id) => ({ p3: 'Kevin', p4: 'Koby', p5: 'Jacob' }[id] || id);
  {
    const winner = { playerId: 'p3', tieBreak: { ...drawW, vs: 'p4' } }, loser = { playerId: 'p4', tieBreak: { ...drawL, vs: 'p3' } };
    const one = tieNoteLines(winner, loser, nameOf);
    assert(one.length === 1 && one[0].end === 'both' && one[0].text === "Tie: Dead heat between Kevin and Koby on every tiebreaker. Settled by the week's draw.", 'T26: a two-player league\'s draw is ONE line (the two ends name the same two players)');
    const winner3 = { playerId: 'p3', tieBreak: { ...drawW, vs: 'p4' } }, loser3 = { playerId: 'p5', tieBreak: { ...drawL, vs: 'p1' } };
    assert(tieNoteLines(winner3, loser3, nameOf).length === 2, 'T26: otherwise each end gets its own line');
    assert(tieNoteLines({ playerId: 'p3', tieBreak: null }, { playerId: 'p4' }, nameOf).length === 0, 'T26: no descriptor, no lines');
  }
  // invalid descriptors are treated as ABSENT (SC-K6)
  const bad = [null, undefined, 'x', 7, [], {}, { ...tbW, v: 2 }, { ...tbW, v: '1' }, { ...tbW, stage: 'picks' }, { ...tbW, stage: 'nope' }, { ...tbW, end: 'middle' }, { ...tbW, end: undefined }];
  assert(bad.every(b => validTieBreak(b) === false && tieCaption(b, NM) === '' && tieRecapPhrase(b, NM) === '' && tieReason(b, NM) === '' && tieCtx.tieDecidedBy({ tieBreak: b }) === null),
    'T26: a descriptor with the wrong version, an unknown or "picks" stage, a bad end, or no object at all: valid false, caption "", recap "", reason "", decidedBy null');
  assert(['tiebreaker', 'alma', 'ep', 'draw'].every(s => validTieBreak({ v: 1, stage: s, end: 'winner' })), 'T26: the four tie stages are the valid ones');
  // facts that do not hold up give NO caption rather than a guessed one
  assert(tieCaption(alma('winner', { team: 'X', cov: 'NaN', mis: 0, psh: 0 }, A(1, 0, 1, 0, 'USC')), NM) === '' && tieCaption(alma('winner', null, A(1, 0, 1, 0, 'USC')), NM) === ''
    && tieCaption(alma('winner', { cov: 1, mis: 0, psh: 0 }, A(1, 0, 1, 0, 'USC')), NM) === '' && tieCaption(epF('winner', { cls: 0, guess: 'abc', delta: 2 }), NM) === '' && tieCaption({ ...tbW, me: { delta: null }, other: { delta: null } }, NM) === '',
    'T26: malformed facts (a non-numeric count, a missing team, a non-numeric guess, nothing to compare) give an EMPTY caption, never a guess');
  // SC-K6: every caption begins with a TIE_COPY constant; hostile names and teams cannot lead a line, a cell or a note
  {
    const hostile = ['=cmd|"/c calc"!A1', '+1+1', '-2+3', '@SUM(A1)', '<img src=x onerror=1>', '"quoted", comma'];
    const lead = (s) => [TIE_COPY.winnerLead, TIE_COPY.loserLead, TIE_COPY.namedPrefix, 'Dead heat'].some(c => s.startsWith(c));
    const outs = [];
    for (const h of hostile) {
      for (const tb of [tbW, tbL, alma('winner', A(1, 1, 0, 0, h), A(1, 0, 1, 0, h)), alma('loser', A(1, 0, 1, 0, h), A(1, 1, 0, 0, h)), epF('winner', { cls: 1, guess: 57, delta: 5 }, { cls: 2 }), drawW, drawL]) {
        outs.push(tieCaption(tb, { otherName: h }), tieCaption(tb, { named: true, subject: h, otherName: h }));
        const recap = tieRecapPhrase(tb, { otherName: h }); if (recap) outs.push(recap.startsWith('won the tie') || recap.startsWith('last on the tie') || recap.startsWith('dead heat') ? 'ok' : `BAD ${recap}`);
      }
    }
    assert(outs.filter(o => o !== 'ok' && o !== '').every(lead) && !outs.some(o => o.startsWith('BAD')), `T26: ${outs.length} captions built from hostile names/teams (= + - @ <img> and a quoted comma) all BEGIN with a constant (a CSV cell never starts with data), and every recap phrase starts with its fixed words`);
    const long = tieCaption(alma('winner', A(1, 1, 0, 0, 'T'.repeat(500)), A(1, 0, 1, 0, 'U'.repeat(500))), { otherName: 'N'.repeat(500) });
    assert(long.length < 220 && !long.includes('T'.repeat(81)), 'T26: team and player names are clipped to 80 characters');
  }
  // the vocabulary: no "bye", no "arbitrarily", no whole word "order(s)" (UN-77) in any string this module can emit
  {
    const everything = [TIE_COPY.draw, TIE_COPY.drawRecap, TIE_COPY.schoolsNow, TIE_COPY.noGuess, TIE_COPY.noEntry, TIE_COPY.degradedAlma, TIE_COPY.degradedEp, TIE_COPY.epSavedRecalculated, TIE_COPY.outcomeChangedTail, TIE_COPY.epSavedSharedFinal,
      ...Object.values(TIE_COPY.finalizeBody), ...Object.values(TIE_COPY.finalizeSuffix).flatMap(o => Object.values(o))];
    const tied = [tbW, tbL, alma('winner', A(1, 1, 0), A(1, 0, 1)), epF('loser', { cls: 2 }), drawW].map(t => tieCaption(t, NM));
    assert([...everything, ...tied].every(s => !/\bbye\b|arbitrar|\border(s)?\b/i.test(s)), 'T26: no string the module emits contains "bye", "arbitrarily" or the retired word for picks (UN-77)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T27] THE FINALIZE NOTICE COMPOSER (DI-469) — pure; the app wrapper and the three sites are proven in ranktest/weekwizardtest
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T27] composeFinalizeTieNotice: every kind, both variants, shared mode, every silent case…');
{
  const { composeFinalizeTieNotice, TIE_COPY } = tieCtx;
  const c = (o) => composeFinalizeTieNotice({ legacyTrigger: false, winnerStage: null, loserStage: null, epEnabled: true, epUsable: true, variant: 'confirm', shared: false, ...o });
  const B = TIE_COPY.finalizeBody, S = TIE_COPY.finalizeSuffix;
  let n = c({ legacyTrigger: true, winnerStage: 'alma' });
  assert(n.show && n.kind === 'tb-missing' && n.text === B['tb-missing'] + S.confirm.tb, 'T27: tb-missing, confirm: the body plus the Cancel/OK suffix, exactly');
  assert(n.text.includes('tie in correct picks') && n.text.includes('Enter the tiebreaker first (Cancel)') && n.text.includes('finalize anyway') && !/arbitrar/i.test(n.text), 'T27: …keeping the substrings ranktest [8a] pins, and never "arbitrarily"');
  assert(n.text === "This week has a tie in correct picks and no tiebreaker value entered. If you finalize now, it is settled by each tied player's alma mater against the spread, then the Extra Point. Enter the tiebreaker first (Cancel), or finalize anyway and fix it later; entering the tiebreaker or the Extra Point afterward recalculates the week (OK).", 'T27: the exact string (DI-469)');
  n = c({ legacyTrigger: true, winnerStage: 'draw' });
  assert(n.kind === 'tb-missing-draw' && n.text.startsWith("This week has a tie in correct picks and no tiebreaker value entered, and as it stands it would end at the week's draw.") && n.text.endsWith(S.confirm.tb), 'T27: tb-missing-draw when EITHER end reaches the draw');
  assert(c({ legacyTrigger: true, loserStage: 'draw' }).kind === 'tb-missing-draw' && c({ legacyTrigger: true, winnerStage: 'ep', loserStage: 'alma' }).kind === 'tb-missing', 'T27: …the loser end counts too; an ep/alma pair does not reach the draw');
  n = c({ winnerStage: 'draw', epEnabled: true, epUsable: false });
  assert(n.show && n.kind === 'ep-missing' && n.text === B['ep-missing'] + S.confirm.ep && n.text === "This tie would be settled by the Extra Point, and no longest field goal is entered yet. Enter it first (Cancel), or finalize anyway and let the week's draw decide; entering it afterward recalculates the week (OK).",
    'T27: ep-missing: a tiebreaker value is on file, the tie reaches the draw, the Extra Point is enabled with no result — the exact string');
  assert(c({ legacyTrigger: true, winnerStage: 'draw', variant: 'wizard' }).text === B['tb-missing-draw'] + ' Enter it in Confirm Tiebreaker, then continue to Finalize.'
    && c({ winnerStage: 'draw', epUsable: false, variant: 'wizard' }).text === B['ep-missing'] + " Enter it in Confirm Extra Point, or the week's draw decides.", 'T27: the guided Step 4 variant carries the wizard suffixes');
  assert(c({ legacyTrigger: true, shared: true }).text === B['tb-missing'] + ' Enter the tiebreaker first (Cancel), or finalize anyway (OK). A value entered later is applied by moving the week back to live and finalizing it again.'
    && c({ winnerStage: 'draw', epUsable: false, shared: true }).text === B['ep-missing'] + " Enter it first (Cancel), or finalize anyway and let the week's draw decide (OK). To apply it later, move the week back to live and finalize it again.", 'T27: in a SHARED league the suffix never says "recalculates" (re-finalizing a final week is refused there, N-1)');
  assert(!c({ legacyTrigger: true, shared: true }).text.includes('recalculates') && c({ legacyTrigger: true, shared: true }).text.includes('Enter the tiebreaker first (Cancel)') && c({ legacyTrigger: true, shared: true }).text.includes('finalize anyway'), 'T27: …and still holds the pinned substrings');
  // SILENT cases
  assert(c({}).show === false && c({}).text === '' && c({}).kind === null, 'T27: no tie at all: silent');
  assert(c({ winnerStage: 'tiebreaker', loserStage: null }).show === false && c({ winnerStage: 'alma' }).show === false && c({ winnerStage: 'ep' }).show === false, 'T27: a tie the tiebreaker, the alma mater step or the Extra Point decides, with a tiebreaker value on file: silent');
  assert(c({ winnerStage: 'draw', epEnabled: true, epUsable: true }).show === false, 'T27: a TRUE dead heat with the Extra Point entered: silent (nothing is actionable)');
  assert(c({ winnerStage: 'draw', epEnabled: false, epUsable: false }).show === false, 'T27: a dead heat with the Extra Point DISABLED: silent');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T28] AD-33, behaviourally: the Extra Point is never a scoring input and never enters the season (DI-466)
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T28] the Extra Point moves no rank and no tally when no true tie reaches it…');
{
  const tally = (rows) => JSON.stringify(rows.map(r => [r.playerId, r.rank, r.correctPicks, r.incorrectPicks, r.correctCount, r.incorrectCount, r.noDecisions, r.isWinner, r.isLoser]));
  const fx = mkFixture({ weekId: 'w_t28', cps: { p1: 7, p2: 6, p3: 5, p4: 4 }, epActual: 52, ep: { p1: 52, p2: 51, p3: 50, p4: 49 } });
  const best = runWeek(fx).rows;
  for (const [pid, g] of [['p1', 99], ['p2', 98], ['p3', 97], ['p4', 96]]) storage.setExtraPointGuess('w_t28', pid, g);    // every guess now a bust: best -> worst
  const worst = runWeek(fx).rows;
  const none = calculateWeeklyResults('w_t28', fx.players, fx.picks, fx.games, null);                                        // the 2-argument form: no context at all
  assert(tally(best) === tally(worst) && tally(best) === tally(none) && [...best, ...worst].every(r => !('tieBreak' in r)),
    'T28: with no true tie, changing EVERY Extra Point key from best to worst (and removing the context) changes no rank, no weighted tally, no raw tally and no flag');
  // the season: identical with the keys present or absent when no weekly true tie reaches S4
  const t15tie = buildWeekTieContext({ weeks: T15.weeks, players: T15.players, getGames: (id) => T15.games.filter(g => g.weekId === id), liveRoster: [], almaApplicable: true });
  const partRows = T15.weeks.flatMap(wk => calculateWeeklyResults(wk.weekId, T15.players, T15.picks.filter(p => p.weekId === wk.weekId), T15.games.filter(g => g.weekId === wk.weekId), wk.actualTiebreakerValue ?? null));
  // make the group decisive on picks alone (p2 wins outright) by giving p5 two wrong picks
  const decisive = partRows.map(r => (r.playerId === 'p5' ? { ...r, correctPicks: r.correctPicks - 1, incorrectPicks: r.incorrectPicks + 1 } : r));
  const withKeys = calculateSeasonStandings(T15.players, decisive, T15.weeks, new Map([['grp_a', t15tie]]));
  const without = calculateSeasonStandings(T15.players, decisive, T15.weeks);
  assert(JSON.stringify(withKeys) === JSON.stringify(without), 'T28: the season standings are IDENTICAL with the group\'s keys present or absent when the group is decided on picks');
  assert(Object.keys(withKeys[0]).sort().join() === ['currentRank', 'displayName', 'isCurrentLastPlace', 'isSeasonLeader', 'playerId', 'totalCorrect', 'totalCorrectCount', 'totalIncorrect', 'totalIncorrectCount', 'totalND', 'weeklyLosses', 'weeklyWins', 'winPct'].sort().join(),
    'T28: a season row carries no Extra Point (and no alma mater) field: nothing is aggregated across weeks');
  // a descriptor holds ONE week's Extra Point values and nothing else
  const tied = mkFixture({ weekId: 'w_t28b', cps: { p1: 6, p2: 6 }, epActual: 52, ep: { p1: 50, p2: 48 }, schools: { p1: '', p2: '' }, snapshot: {} });
  const w = runWeek(tied).rows.find(r => r.isWinner);
  assert(w.tieBreak.stage === 'ep' && JSON.stringify(Object.keys(w.tieBreak.me).sort()) === '["cls","delta","guess"]', 'T28: the Extra Point descriptor carries one week\'s guess, class and delta, nothing aggregated');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T29] THE SEASON SORT gains ONE final key, and only a fully exhausted tie sees it
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T29] the season sort: a final playerId key, nothing else changes…');
{
  const results = (ids) => ids.map(id => ({ weekId: 'w29', playerId: id, correctPicks: 3, incorrectPicks: 2, correctCount: 3, incorrectCount: 2, isWinner: false, isLoser: false }));
  const pl = (ids) => ids.map(id => ({ playerId: id, displayName: id }));
  const ab = calculateSeasonStandings(pl(['b', 'a']), results(['b', 'a'])).map(s => s.playerId).join();
  const ba = calculateSeasonStandings(pl(['a', 'b']), results(['a', 'b'])).map(s => s.playerId).join();
  assert(ab === 'a,b' && ba === 'a,b', 'T29: a fully exhausted season tie is ordered by playerId whatever the input order (it used to follow it)');
  // a non-exhausted fixture is untouched: the golden (T20 G9a/G9b) already pins this; here, the three criteria still rank before the key
  const mixed = calculateSeasonStandings(pl(['a', 'b']), [{ weekId: 'w', playerId: 'a', correctPicks: 1, incorrectPicks: 4, correctCount: 1, incorrectCount: 4 }, { weekId: 'w', playerId: 'b', correctPicks: 4, incorrectPicks: 1, correctCount: 4, incorrectCount: 1 }]);
  assert(mixed[0].playerId === 'b', 'T29: totalCorrect still ranks first — the final key only breaks an exhausted tie');
}


// ─────────────────────────────────────────────────────────────────────────────────────────
// [T-K7] STRUCTURE (SC-K7 3, SC-K1): display-only data never decides an order, and no lookup reaches the prototype chain
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T-K7] `tie.facts` is read only by the descriptor builder; scoring.js\'s imports are untouched; tie-context.js reads user keys by own-property only…');
{
  const { readFile } = await import('node:fs/promises');
  const scoringSrc = await readFile(new URL('./js/scoring.js', import.meta.url), 'utf8');
  const tcSrc = await readFile(new URL('./js/tie-context.js', import.meta.url), 'utf8');
  /** A function's body: declaration line to the next top-level declaration (the ranktest [5] / eptest [1] principle). */
  const bodyOf = (src, name) => {
    const lines = src.split('\n');
    const at = lines.findIndex(l => new RegExp(`^(?:export )?function ${name}\\s*\\(`).test(l));
    if (at === -1) return null;
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) if (/^(?:export function|function|const) /.test(lines[i])) { end = i; break; }
    return lines.slice(at, end).join('\n');
  };
  const NO_FACTS = ['compareS1S2', 'orderTieRuns', 'orderRun', 'splitBy', 'compareEp', 'compareAlma', 'drawOrder', 'almaKeyOf', 'almaNetOf', 'almaApplies', 'epKeyOf', 'tieRunsOf', 'rankWeeklyResults', 'calculateSeasonStandings'];
  const offenders = NO_FACTS.filter(n => { const b = bodyOf(scoringSrc, n); return b === null || /\bfacts\b/.test(b); });
  assert(offenders.length === 0, `T-K7: the identifier \`facts\` appears in NONE of the ordering functions, the ranker or the season (offenders: ${JSON.stringify(offenders)})`);
  assert(/\bfacts\b/.test(bodyOf(scoringSrc, 'attachTieBreak') || ''), 'T-K7: …and it IS read in the descriptor builder, attachTieBreak (the scan is not vacuous)');
  // canary: `tie.facts` injected into a comparator is caught
  const mutated = scoringSrc.replace('function compareEp(tie) {\n  return (a, b) => {', 'function compareEp(tie) {\n  return (a, b) => {\n    const leak = tie.facts;');
  assert(mutated !== scoringSrc && /\bfacts\b/.test(bodyOf(mutated, 'compareEp')) && !/\bfacts\b/.test(bodyOf(scoringSrc, 'compareEp')), 'T-K7 canary: `tie.facts` injected into the S4 comparator IS caught');
  // scoring.js's import statements are exactly the pre-SP-54 two
  const imports = scoringSrc.split('\n').filter(l => /^\s*(?:import\b|\}\s*from\b)/.test(l));
  assert(imports.join('|') === "import {|} from './data-model.js';|import { getTiebreakerGuess } from './storage.js';", `T-K7: scoring.js's import statements are UNTOUCHED (${imports.join(' / ')})`);
  assert(/PICK_RESULT, GAME_STATUS, getAlmaMaterMatch, getAutoLockOffsetMinutes,\n  getEffectiveGroupId, weeksInGroup, getGroupTiebreakerWeek,\n} from '\.\/data-model\.js';/.test(scoringSrc), 'T-K7: …including the data-model specifier list, character for character');

  // SC-K1 in tie-context.js: user-keyed reads go through ownGet / Map / null-prototype objects, never a bare index
  const code = tcSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/lockedAlmaByPlayer\s*\[/.test(code) && !/\bmap\s*\[\s*pid\s*\]/.test(code) && !/ALMA_MATER_(EXACT|EXCLUDE)_PATTERNS/.test(code) && /ownGet\(map, pid\)/.test(code),
    'T-K1: tie-context.js reads the snapshot map with ownGet(map, pid), never `map[pid]` or `lockedAlmaByPlayer[…]`, and never touches the alma pattern tables');
  assert((code.match(/\b(?:keys|facts|byPlayer)\s*=\s*Object\.create\(null\)/g) || []).length >= 3 && (code.match(/Object\.create\(null\)/g) || []).length >= 5 && !/\bkeys\s*=\s*\{\}|\bfacts\s*=\s*\{\}|\bbyPlayer\s*=\s*\{\}/.test(code),
    'T-K1: every map the builders return (keys, facts, byPlayer) is created with Object.create(null)');
  assert(!/\bObject\.hasOwn\b/.test(tcSrc) && !/\bObject\.hasOwn\b/.test(scoringSrc), 'T-K1: no `Object.hasOwn` anywhere in the SP-54 code (the iOS 15.0 target predates Safari 15.4)');
  const nonLit = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
  assert(!/\bmath\.random\b|\bDate\.now\b|\bnew Date\(\)/i.test(nonLit), 'T-K7: the key builder reads no clock and no random source (the draw and every key are pure functions of the data)');
}


// ═════════════════════════════════════════════════════════════════════════════════════════
// APP-LEVEL PROOFS (js/app.js imported with light stubs): path agreement (T24), persistence (T25), the CSV builders and the recap, the forward-only guard end to end
// ═════════════════════════════════════════════════════════════════════════════════════════
const app = await import('./js/app.js');
const proj = await import('./js/supabase-projection.js');
/** Put a fixture's league into the REAL storage seam (players, week, slate, picks with ids: saveAllPicks merges by pickId). */
const onlyActive = (ids) => storage.getPlayers().forEach(p => storage.savePlayer({ ...p, active: ids.includes(p.playerId) }));
const seedFx = (fx) => {
  for (const p of fx.players) if (!storage.getPlayer(p.playerId)) storage.addPlayer({ ...p, preferences: {} });
  storage.saveWeek(fx.week);
  fx.games.forEach(g => storage.saveGame(g));
  storage.saveAllPicks(fx.picks.map(p => ({ ...p, pickId: `${p.weekId}_${p.playerId}_${p.gameId}` })));
};

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T24] ONE ANSWER ON EVERY PATH (DI-467 part 1, the UN-126 class): the same fixture, finalized through the REAL transition, names the same winner,
// loser and stage on finalize's stored rows, the Dashboard compute, the weekly CSV, the all-weeks CSV, the recap and the obligation
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T24] path agreement — a singleton week: finalize, Dashboard, both CSVs, the recap, the obligation…');
{
  const fx = mkFixture({ weekId: 'w_t24', cps: { p3: 6, p4: 6, p1: 4 }, epEnabled: false, weekOver: { status: 'live', finalizedAt: null },
    alma: [{ school: 'Notre Dame', result: 'covered' }, { school: 'USC', result: 'notcov' }] });
  seedFx(fx);                                             // the real storage seam holds the league: players, week, slate, picks
  const done = app.applyWeekStatusChange(storage.getWeek('w_t24'), 'final');
  assert(done && done.status === 'final' && Date.parse(done.finalizedAt) >= Date.parse(tieCtx.TIE_RULE_EFFECTIVE_AT), 'T24: fixture check: the week went live -> final through the real transition (the stamp is the real clock)');
  const week = storage.getWeek('w_t24');
  const players = storage.getPlayers().filter(p => p.active);
  const stored = storage.getWeeklyResults('w_t24');
  const dash = app.weeklyResultsWithTie(week, players, storage.getPicks('w_t24'), storage.getGames('w_t24'), week.actualTiebreakerValue);
  const pick = (rows) => ({ w: rows.find(r => r.isWinner)?.playerId, l: rows.find(r => r.isLoser)?.playerId, ws: tieDecidedBy(rows.find(r => r.isWinner)), ls: tieDecidedBy(rows.find(r => r.isLoser)) });
  assert(JSON.stringify(pick(stored)) === JSON.stringify({ w: 'p3', l: 'p1', ws: 'alma', ls: null }), `T24: finalize's STORED rows: winner p3 by alma, loser p1 (got ${JSON.stringify(pick(stored))})`);
  assert(JSON.stringify(pick(dash)) === JSON.stringify(pick(stored)), 'T24: the Dashboard compute (weeklyResultsWithTie) names the same winner, loser and stages as the stored rows');
  assert(JSON.stringify(stored.find(r => r.isWinner).tieBreak) === JSON.stringify(dash.find(r => r.isWinner).tieBreak), 'T24: …and the SAME descriptor, byte for byte');
  const csv = app.buildWeekResultsCsvRows(dash, week.actualTiebreakerValue);
  const h = csv[0], at = (name) => h.indexOf(name);
  assert(h.length === 15 && h[12] === 'Won by Tiebreaker' && h[13] === 'Tie-break stage' && h[14] === 'Tie-break reason' && h.slice(0, 13).join('|') === ['Rank', 'Player', 'Correct (weighted)', 'Incorrect (weighted)', 'Correct (raw count)', 'Incorrect (raw count)', 'No Decisions', 'Tiebreaker Guess', 'Actual Tiebreaker', 'Delta', 'Winner', 'Loser', 'Won by Tiebreaker'].join('|'),
    'T24: the week-results CSV gains exactly TWO columns at the END and no existing column moved');
  const winnerRow = csv.find(r => r[at('Winner')] === 'yes'), loserRow = csv.find(r => r[at('Loser')] === 'yes');
  assert(winnerRow[1] === 'Kevin' && winnerRow[13] === 'alma' && winnerRow[14] === 'Won the tie: Notre Dame covered, USC did not cover' && loserRow[1] === 'Drew' && loserRow[13] === '' && loserRow[14] === '',
    `T24: the weekly CSV: Kevin won on "alma" with the unnamed reason; the loser (decided on picks) has two EMPTY cells (got ${JSON.stringify([winnerRow[1], winnerRow[13], winnerRow[14], loserRow[1], loserRow[13], loserRow[14]])})`);
  const wk = Object.fromEntries(storage.getWeeks().map(x => [x.weekId, x]));
  const all = app.buildAllWeeklyResultsCsvRows(storage.getWeeklyResults(), wk);
  assert(all[0].length === 17 && all[0][14] === 'Won by Tiebreaker' && all[0][15] === 'Tie-break stage' && all[0][16] === 'Tie-break reason'
    && all.some(r => r[3] === 'Kevin' && r[15] === 'alma' && r[16].startsWith('Won the tie: Notre Dame covered')), 'T24: the all-weeks CSV (STORED rows) appends the same two columns and carries Kevin\'s reason');
  const recap = app.buildWeeklySummary(week);
  assert(recap.includes('🏆 Weekly winner: Kevin (won the tie: Notre Dame covered, USC did not cover)') && recap.includes('💀 Weekly loser: Drew') && !recap.includes('(won by tiebreaker)'),
    'T24: the recap text reads "(won the tie: Notre Dame covered, USC did not cover)" and the loser line is unchanged (decided on picks), keeping each line\'s leading glyph');
  const ob = storage.getActiveObligations('w_t24').filter(o => o.type === 'weekly');
  assert(ob.length === 1 && ob[0].payerPlayerId === 'p1' && ob[0].recipientPlayerId === 'p3', 'T24: the obligation names the loser (p1) owing the winner (p3): money and display agree');
  // the season's win/loss columns read the SAME stored rows (so a reader of stored rows — the page, the standings CSV, and the SCRIBE server once it reads them — agrees)
  const seasonRow = (id) => app.seasonStandingsRows().find(s => s.playerId === id);
  assert(seasonRow('p3').weeklyWins === 1 && seasonRow('p1').weeklyLosses === 1 && seasonRow('p4').weeklyWins === 0 && seasonRow('p4').weeklyLosses === 0,
    'T24: seasonStandingsRows() credits p3 the weekly win and p1 the weekly loss — it reads the stored rows, the same answer as the finalize that paid the obligation');
  // …and the CONTEXT-FREE recompute (what supabase/functions/_shared/scribe-evidence.mjs standingsFor() does today, tie = null) cannot be trusted to equal it in a tie week
  const noCtxWinners = permutations(fx.players).map(pl => calculateWeeklyResults('w_t24', pl, storage.getPicks('w_t24'), storage.getGames('w_t24'), null).find(r => r.isWinner)?.playerId);
  assert(new Set(noCtxWinners).size === 2 && noCtxWinners.every(w => ['p3', 'p4'].includes(w)),
    `T24: the two-argument recompute names p3 OR p4 as the weekly winner depending only on the row order (${JSON.stringify([...new Set(noCtxWinners)])}): a server that recomputes without the context can disagree with the stored winner — it must read the stored rows (handoff, SCRIBE)`);
  // the standings CSV gains NO column (AD-33; eptest [8])
  const seasonHeader = "Rank,Player,Total Correct,Total Incorrect,Total No Decision,Weekly Wins,Weekly Losses,Win %";
  const appSrc = (await (await import('node:fs/promises')).readFile(new URL('./js/app.js', import.meta.url), 'utf8'));
  assert(appSrc.includes("const rows=[['Rank','Player','Total Correct','Total Incorrect','Total No Decision','Weekly Wins','Weekly Losses','Win %']];") && !seasonHeader.includes('Tie'),
    'T24: standings_season.csv\'s header is byte-identical (no Extra Point, no tie column) — the eptest [8] assertion still holds');
}

console.log('\n[T24] path agreement — a multi-part GROUP: the pooled finalize path, the season\'s pooled branch, the obligation…');
{
  const mkPart = (weekId, n, over) => mkFixture({ weekId, cps: over.cps, picksSpec: over.picksSpec, alma: over.alma || [], epEnabled: false, snapshot: { p2: 'Oklahoma', p5: 'Arkansas', p1: 'Texas A&M' },
    tb: over.tb || {}, tbActual: over.tbActual ?? null, weekOver: { status: 'live', finalizedAt: null, groupId: 't24grp', isGroupTiebreaker: over.isTb === true, weekNumber: n } });
  const a = mkPart('t24g1', 11, { cps: { p1: 3, p2: 6, p5: 5 }, picksSpec: { p1: 'HHHAAA', p2: 'HHHHHH', p5: 'HHHHHA' }, alma: [{ school: 'Oklahoma', result: 'covered' }, { school: 'Arkansas', result: 'covered' }] });
  const b = mkPart('t24g2', 12, { cps: { p1: 3, p2: 5, p5: 6 }, picksSpec: { p1: 'HHHAAA', p2: 'HHHHHA', p5: 'HHHHHH' }, alma: [{ school: 'Oklahoma', result: 'notcov' }], isTb: true, tbActual: 50, tb: { p2: 52, p5: 48 } });
  seedFx(a); seedFx(b);
  onlyActive(['p1', 'p2', 'p5']);                         // the singleton above is over: only the group's three play
  app.applyWeekStatusChange(storage.getWeek('t24g1'), 'final');
  assert(storage.getActiveObligations('t24grp').length === 0, 'T24 (group): after Part 1 alone no obligation exists (the group is not final)');
  app.applyWeekStatusChange(storage.getWeek('t24g2'), 'final');
  const ob = storage.getActiveObligations('t24grp').filter(o => o.type === 'weekly');
  assert(ob.length === 1 && ob[0].recipientPlayerId === 'p5' && ob[0].payerPlayerId === 'p1', `T24 (group): once the group completes, the pooled finalize names p5 the winner (Arkansas +1 beats Oklahoma's 1-1) and p1 the loser (got ${JSON.stringify(ob.map(o => [o.payerPlayerId, o.recipientPlayerId]))})`);
  const season = app.seasonStandingsRows();
  const sp = (id) => season.find(s => s.playerId === id);
  assert(sp('p5').weeklyWins >= 1 && sp('p1').weeklyLosses >= 1, 'T24 (group): seasonStandingsRows() — the season\'s pooled branch, handed the SAME contexts — gives p5 the group\'s weekly win and p1 its weekly loss');
  // THE SAME POOLED ANSWER FROM THE REAL WEEKLY HISTORY CODE (SP-54 MC-1, reviewer 2026-10-01). This used to rebuild the call (buildWeekTieContext + calculateGroupWeeklyResults) INSIDE the
  // test, so dropping `groupTie` from js/app.js's own call survived every suite. renderLeaderboard() now decides every row's winner and loser through the exported
  // weeklyHistoryOutcome(), and this drives THAT with the T24 group fixture.
  const pl = storage.getPlayers().filter(p => p.active);
  const part1 = storage.getWeek('t24g1');
  const members = dataModel.weeksInGroup(storage.getWeeks(), part1);
  const hist = app.weeklyHistoryOutcome(part1, members, storage.getWeeklyResults(), pl);
  assert(members.length === 2 && hist.winner?.playerId === 'p5' && hist.loser?.playerId === 'p1' && tieDecidedBy(hist.winner) === 'alma',
    `T24 (group): the REAL Weekly History helper (weeklyHistoryOutcome) agrees with the pooled finalize: p5 wins by alma, p1 last (got ${hist.winner?.playerId}/${hist.loser?.playerId}, stage ${hist.winner ? tieDecidedBy(hist.winner) : 'n/a'})`);
  // N1 (v0.29.0 release review, 2026-10-02) — the EMAIL on a split week gives the tie reason too. Nothing checked it: guarding recapPhrase with `!splitWeek` stayed green.
  // Hand-derived: Jacob (p5) and Brayden (p2) pool 11 each; Jacob's Arkansas covered, Brayden's Oklahoma went 1-1 against the spread, so Jacob wins on the alma stage.
  const groupWinLine = '🏆 Weekly winner — Week 11 + Week 12: Jacob (won the tie: Arkansas covered, Oklahoma went 1-1 against the spread)';
  assert([part1, storage.getWeek('t24g2')].every(w => app.buildWeeklySummary(w).split('\n').includes(groupWinLine)) && !app.buildWeeklySummary(part1).includes('(won by tiebreaker)'),
    `T24 (group): BOTH parts' recap emails read "${groupWinLine}" — the pooled winner's tie reason, under the group label, not the bare fallback`);
  const noCtx = calculateGroupWeeklyResults(members, pl, members.flatMap(w => storage.getPicks(w.weekId)), members.flatMap(w => storage.getGames(w.weekId)), null);
  assert(noCtx.find(r => r.isWinner)?.playerId !== 'p5',
    'T24 (group): NON-VACUITY — the same group scored WITHOUT the tie context names someone else the winner (row order): a History helper that dropped its context would be caught here');
  const partial = members.map(w => (w.weekId === 't24g2' ? { ...w, status: 'live' } : w));
  const inProg = app.weeklyHistoryOutcome(part1, partial, storage.getWeeklyResults(), pl);
  assert(inProg.winner === null && inProg.loser === null, 'T24 (group): a group with a part NOT yet final has no winner and no loser in Weekly History (the row reads "in progress")');
  const single = app.weeklyHistoryOutcome(storage.getWeek('w_t24'), [storage.getWeek('w_t24')], storage.getWeeklyResults(), pl);
  assert(single.winner?.playerId === 'p3' && single.loser?.playerId === 'p1' && tieDecidedBy(single.winner) === 'alma',
    'T24: a SINGLETON week in Weekly History is its STORED winner and loser (the finalize rows, descriptor intact)');
  const appSrcH = await (await import('node:fs/promises')).readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const leaderboard = (appSrcH.match(/export function renderLeaderboard\(\) \{[\s\S]*?\n\}/) || [''])[0];
  // v0.29.0 batch-5b integration (2026-10-01): renderLeaderboard() reads SB-19b's shared weeklyHistoryResult() (also the email digest's reader), which delegates to
  // this seam — so the pin follows the chain, and NEITHER link may hold a second copy of the group compute.
  const historyResultSrc = (appSrcH.match(/export function weeklyHistoryResult\([\s\S]*?\n\}/) || [''])[0];
  assert(/weeklyHistoryResult\(w, historyInputs\)/.test(leaderboard) && /weeklyHistoryOutcome\(w, memberWeeks, allResults, players\)/.test(historyResultSrc)
    && ![leaderboard, historyResultSrc].some(src => /calculateGroupWeeklyResults\(|buildWeekTieContext\(/.test(src)),
    'T24: renderLeaderboard() decides every row\'s winner and loser THROUGH weeklyHistoryResult() -> weeklyHistoryOutcome() and neither holds a second copy of the group compute (so the helper is the real seam)');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T22b] FORWARD-ONLY, END TO END: a week finalized BEFORE the date keeps today's behaviour under the real finalize path ("Recalculate")
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T22b] a week settled before the effective date is NOT re-ranked by finalizeWeek (the Recalculate path)…');
{
  const fx = mkFixture({ weekId: 'w_t22b', cps: { p3: 6, p4: 6 }, epEnabled: false, weekOver: { status: 'final', finalizedAt: PRE_RULE_AT },
    alma: [{ school: 'Notre Dame', result: 'notcov' }, { school: 'USC', result: 'covered' }] });   // S3 would pick p4
  seedFx(fx);
  onlyActive(['p3', 'p4']);
  app.finalizeWeek(storage.getWeek('w_t22b'));            // what "Recalculate All Finalized Weeks" calls for every final week
  const rows = storage.getWeeklyResults('w_t22b');
  const order = storage.getPlayers().filter(p => p.active && ['p3', 'p4'].includes(p.playerId)).map(p => p.playerId);
  assert(rows.every(r => !('tieBreak' in r)) && rows.find(r => r.isWinner)?.playerId === order[0],
    `T22b: Recalculate on a pre-date week applies NO tie rule: no descriptor, and the winner is whoever today's stable order puts first (${order[0]}), not the school-covered p4`);
  const dashPre = app.weeklyResultsWithTie(storage.getWeek('w_t22b'), storage.getPlayers().filter(p => p.active && ['p3', 'p4'].includes(p.playerId)), storage.getPicks('w_t22b'), storage.getGames('w_t22b'), null);
  assert(dashPre.every(r => !('tieBreak' in r)) && !app.buildWeeklySummary(storage.getWeek('w_t22b')).includes('won the tie'), 'T22b: …and the Dashboard compute and the recap of that week are the legacy ones too (no caption, no reason)');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T25] PERSISTENCE (DI-467 part 2): tieBreak rides results.extra and round-trips; lockedAlmaByPlayer is restored and NEVER emitted
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T25] the descriptor round-trips through the projection (results.extra); the snapshot is restored and never emitted…');
{
  const tb = { v: 1, end: 'winner', stage: 'alma', vs: 'p4', src: 'snapshot', me: { team: 'Notre Dame', cov: 1, mis: 0, psh: 0, src: 'snapshot' }, other: { team: 'USC', cov: 0, mis: 1, psh: 0, src: 'snapshot' } };
  const row = { resultId: 'wr_t25_p3', weekId: 't25', playerId: 'p3', displayName: 'Kevin', correctPicks: 6, incorrectPicks: 0, correctCount: 6, incorrectCount: 0, noDecisions: 0, pending: 0,
    tiebreakerGuess: null, tiebreakerDelta: null, rank: 1, isWinner: true, isLoser: false, wonByTiebreaker: false, tieBreak: tb };
  const plain = { ...row, resultId: 'wr_t25_p4', playerId: 'p4', displayName: 'Koby', rank: 2, isWinner: false }; delete plain.tieBreak;
  const ctx = { leagueId: 'L' };
  const out = proj.toRows.cfbp_results([row, plain], ctx).results;
  assert(JSON.stringify(out[0].extra.tieBreak) === JSON.stringify(tb) && out[0].won_by_tiebreaker === false && out[0].is_winner === true && !('tieBreak' in out[0]),
    'T25: toRows puts tieBreak in results.extra (no new column) and leaves the typed columns (is_winner, won_by_tiebreaker) as they were');
  assert(!('tieBreak' in out[1].extra), 'T25: a row WITHOUT a descriptor carries no tieBreak in extra (nothing invented)');
  const back = proj.fromRows.cfbp_results({ results: out }, ctx);
  assert(JSON.stringify(proj.canonicalize(back[0])) === JSON.stringify(proj.canonicalize(row)) && JSON.stringify(proj.canonicalize(back[1])) === JSON.stringify(proj.canonicalize(plain)),
    'T25: fromRows restores BOTH rows deep-equal (the descriptor intact; the plain row has no tieBreak key)');
  // local mode stores the row as is (JSON through the seam)
  storage.saveAllWeeklyResults('t25', [row, plain]);
  assert(JSON.stringify(storage.getWeeklyResults('t25').find(r => r.playerId === 'p3').tieBreak) === JSON.stringify(tb), 'T25: local mode (the storage seam) returns the descriptor untouched');

  // weeks: a locked row's map is restored; NULL restores no key; toRows never emits the column
  const wk = { weekId: 't25w', weekNumber: 25, season: '2026', status: 'locked', lockedAt: LOCKED_AT, lockedAlmaMaters: ['Notre Dame', 'USC'], lockedAlmaByPlayer: { p3: 'Notre Dame', p4: 'USC' }, extraPointEnabled: true, extraPointActual: null };
  const wrows = proj.toRows.cfbp_weeks([wk], ctx).weeks;
  assert(!('locked_alma_by_player' in wrows[0]) && JSON.stringify(wrows[0].locked_alma_maters) === '["Notre Dame","USC"]' && !JSON.stringify(wrows[0]).includes('"p3":"Notre Dame"'),
    'T25: toRows never emits locked_alma_by_player (the key is not on the row at all), and the OLD list column is untouched');
  assert(!('locked_alma_by_player' in wrows[0]) && !Object.keys(wrows[0].extra || {}).includes('lockedAlmaByPlayer') && !(wrows[0].extra.__absent || []).includes('lockedAlmaByPlayer'),
    'T25: the field is not smuggled into `extra` either, and no `__absent` marker is recorded for it (the quiet-absent rule)');
  const restored = proj.fromRows.cfbp_weeks({ weeks: [{ ...wrows[0], locked_alma_by_player: { p3: 'Notre Dame', p4: 'USC' } }] }, ctx)[0];
  assert(JSON.stringify(restored.lockedAlmaByPlayer) === '{"p3":"Notre Dame","p4":"USC"}', 'T25: a row WITH the column restores lockedAlmaByPlayer onto the week object');
  const noKey = proj.fromRows.cfbp_weeks({ weeks: [{ ...wrows[0], locked_alma_by_player: null }] }, ctx)[0];
  const absent = proj.fromRows.cfbp_weeks({ weeks: [wrows[0]] }, ctx)[0];
  assert(!('lockedAlmaByPlayer' in noKey) && !('lockedAlmaByPlayer' in absent), 'T25: a NULL column and an ABSENT column both restore with NO key (never an explicit null)');
  // a pre-migration week object round-trips byte-identical (no field, no marker, no diff)
  const legacy = { ...wk }; delete legacy.lockedAlmaByPlayer;
  const legacyBack = proj.fromRows.cfbp_weeks({ weeks: proj.toRows.cfbp_weeks([legacy], ctx).weeks }, ctx)[0];
  assert(JSON.stringify(proj.canonicalize(legacyBack)) === JSON.stringify(proj.canonicalize(legacy)), 'T25: a week object with NO lockedAlmaByPlayer round-trips byte-identical through the projection');
  // WEEK_COLS carries the entry (without it the field falls into `extra` and the typed column sits NULL forever: the 0028 trap)
  const { readFile } = await import('node:fs/promises');
  const projSrc = await readFile(new URL('./js/supabase-projection.js', import.meta.url), 'utf8');
  assert(/\{ legacy: 'lockedAlmaByPlayer', column: 'locked_alma_by_player' \}/.test(projSrc) && /quietAbsentFields: \['competitionId', 'lockedAlmaByPlayer'\]/.test(projSrc) && /delete row\.locked_alma_by_player;/.test(projSrc),
    'T25: WEEK_COLS names the column, the weeks block quiets its absence and decorateRow DROPS it from every write');
  // no module reads lockedAlmaByPlayer except tie-context.js, the projection and the lock paths that WRITE it (DI-465 render-path rule)
  const readers = [];
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(new URL('./js/', import.meta.url)).filter(x => x.endsWith('.js'))) {
    const src = await readFile(new URL(`./js/${f}`, import.meta.url), 'utf8');
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (/lockedAlmaByPlayer/.test(code)) readers.push(f);
  }
  assert(readers.sort().join() === 'app.js,supabase-projection.js,tie-context.js', `T25: only app.js (the two lock paths and Duplicate Week WRITE it), the projection and tie-context.js mention lockedAlmaByPlayer (found: ${readers.join(', ')})`);
  const appSrc2 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const appUses = appSrc2.split('\n').filter(l => /lockedAlmaByPlayer/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
  assert(appUses.every(l => /(upd|next)\.lockedAlmaByPlayer\s*=|delete newW\.lockedAlmaByPlayer/.test(l)), `T25: inside app.js every non-comment use is a WRITE at a lock path or the Duplicate Week reset — no reader (${appUses.length} lines)`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T27b] the false sentence is gone from every surface; the wrapper is read-only (DI-469)
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T27b] no source string says "arbitrarily"; finalizeTieNotice() is a read-only preview…');
{
  const { readFile } = await import('node:fs/promises');
  const files = ['js/app.js', 'js/week-wizard.js', 'js/tie-context.js'];
  const hits = [];
  for (const f of files) (await readFile(new URL(`./${f}`, import.meta.url), 'utf8')).split('\n').forEach((l, i) => { if (/arbitrarily/i.test(l)) hits.push(`${f}:${i + 1}`); });
  assert(hits.length === 0, `T27b: the word "arbitrarily" appears in none of app.js, week-wizard.js, tie-context.js (strings AND comments; found: ${hits.join(', ') || 'none'})`);
  assert(/arbitrarily/i.test('assigned arbitrarily') && ['x arbitrarily y'].some(l => /arbitrarily/i.test(l)), 'T27b canary: the scan pattern does match the old sentence');
  // the wrapper reads and writes nothing: a storage snapshot before and after is identical, in a tied week with every notice kind
  const fx = mkFixture({ weekId: 'w_t27b', cps: { p3: 6, p4: 6 }, epEnabled: true, epActual: null, weekOver: { status: 'live', finalizedAt: null } });
  seedFx(fx);
  onlyActive(['p3', 'p4']);
  const snap = () => JSON.stringify(Object.keys(globalThis.localStorage.constructor === Object ? {} : {}).concat([...store.entries()].sort()));
  const before = snap();
  const pl = storage.getPlayers().filter(p => p.active && ['p3', 'p4'].includes(p.playerId));
  const n1 = app.finalizeTieNotice(storage.getWeek('w_t27b'), pl, storage.getPicks('w_t27b'), storage.getGames('w_t27b'), 'confirm');
  const n2 = app.finalizeTieNotice(storage.getWeek('w_t27b'), pl, storage.getPicks('w_t27b'), storage.getGames('w_t27b'), 'wizard');
  assert(snap() === before, 'T27b: finalizeTieNotice() is READ-ONLY: the whole storage mirror is byte-identical before and after (no saveGame, saveWeek or saveAllWeeklyResults)');
  assert(n1.show && n1.kind === 'tb-missing-draw' && n2.show && n2.text.endsWith('Enter it in Confirm Tiebreaker, then continue to Finalize.'), `T27b: the preview names the stage it reaches (the draw) and honours the variant (got ${n1.kind})`);
  assert(app.finalizeTieNotice(null, [], [], []).show === false, 'T27b: no week, no notice');
  assert(app.finalizeTieNotice({ ...storage.getWeek('w_t27b'), status: 'open' }, pl, storage.getPicks('w_t27b'), storage.getGames('w_t27b')).show === false,
    'T27b: BLIND RULE — an OPEN week answers with silence (the preview reads other players\' picks and guesses, so it only answers once picks are public)');
}


// ─────────────────────────────────────────────────────────────────────────────────────────
// [T27c] the Recalculate card never promises what a shared league cannot do (coordinator handoff 2026-10-01, Q9; adaptertest [A-RECALC] is the other half)
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T27c] the Comm Data Recalculate card: a local league keeps the caption and the live button; a shared league is told WHY and the button is disabled with that reason…');
{
  const authMod = await import('./js/auth.js');
  const TC = tieCtx.TIE_COPY;
  const localHtml = app.renderRecalculateFinalizedWeeksAdminSectionHTML();
  assert(authMod.isSupabaseDataMode() === false && localHtml.includes('It also applies the Weekly Ties rules to weeks finalized since they took effect; weeks settled before then keep the result they had. A changed winner or loser is flagged for review and never overwritten.'),
    'T27c: in a LOCAL league the caption carries the DI-469 sentence verbatim (the button can apply it)');
  assert(/<button class="btn btn-primary btn-block" id="recalc-all-weeks-btn">/.test(localHtml) && !/disabled|aria-disabled|recalc-all-weeks-why/.test(localHtml),
    'T27c: …and the button is the live, enabled one (no disabled, no aria-disabled, no reason element)');
  authMod.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true });
  let sharedHtml = '';
  try {
    assert(authMod.isSupabaseDataMode() === true, 'T27c: fixture check: the data mode is now SHARED');
    sharedHtml = app.renderRecalculateFinalizedWeeksAdminSectionHTML();
  } finally {
    authMod.configureAuth({ authMode: 'pins', dataMode: 'sheets', authModeKnown: true });
  }
  assert(authMod.isSupabaseDataMode() === false, 'T27c: fixture check: the data mode is back to local');
  assert(sharedHtml === app.renderRecalculateFinalizedWeeksAdminSectionHTML({ shared: true }) && sharedHtml !== localHtml, 'T27c: the default follows the data mode: the option and the real mode render the same shared card');
  assert(sharedHtml.includes(`<p class="text-muted text-xs mb-sm" id="recalc-all-weeks-why">${TC.recalcSharedFacts}</p>`) && TC.recalcSharedFacts.startsWith("A week that's already final can't be recalculated here."),
    'T27c: in a SHARED league the caption is the refusal\'s FACTS: a week that\'s already final can\'t be recalculated here; to apply a correction, move it back to live and finalize it again');
  assert(!sharedHtml.includes('Weekly Ties') && !sharedHtml.includes('Re-runs finalize on every already-final week'), 'T27c: …and neither the pre-SP-54 caption nor the Weekly Ties sentence (both would promise what cannot happen)');
  assert(/<button class="btn btn-primary btn-block" id="recalc-all-weeks-btn" disabled aria-disabled="true" aria-describedby="recalc-all-weeks-why">/.test(sharedHtml) && sharedHtml.includes('🔁 Recalculate All Finalized Weeks'),
    'T27c: the button is still THERE (never hidden), DISABLED, and points at the reason (aria-describedby -> the caption\'s id) so VoiceOver reads it');
  assert(TC.recalcSharedRefused === "Nothing was recalculated. A week that's already final can't be recalculated here. To apply a correction, move that week back to live and finalize it again."
    && TC.recalcSharedRefused === `Nothing was recalculated. ${TC.recalcSharedFacts}` && TC.tbSavedSharedFinal === 'Tiebreaker saved. This week is already final, so its results were not recalculated. Move it back to live and finalize it again to apply it.',
    'T27c: the toast is the coordinator\'s exact wording and is the card\'s facts behind "Nothing was recalculated." (one source of truth), and tbSavedSharedFinal is the approved sentence');
  assert(!/<script|onerror|javascript:/i.test(sharedHtml), 'T27c: the shared card is static text, nothing from data');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T-G] THE RELEASE-GATE PLUMBING (LP-3 / LP-4; reviewer delta BLOCK B1 and B3, 2026-10-01). The gate's fixtures are built from a PROVISIONAL TEMPLATE, never from the shipped file:
// the shipped file is PROVISIONAL today and STAMPED after the coordinator stamps it as deploy.sh instructs, and this suite must be green in both states (stamping used to turn it red,
// which failed loadtest [124] and stopped the deploy AFTER 0038 was pasted). The shipped file is asserted to be in exactly one of the two states.
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T-G] the shipped tie-context.js is PROVISIONAL or STAMPED (never in between); deploy.sh refuses to stage a PROVISIONAL one (the gate block is run on a template, never the deploy)…');
{
  const { readFile, mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const deploy = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
  const tcSrc = await readFile(new URL('./js/tie-context.js', import.meta.url), 'utf8');
  const MARK = '*** PROVISIONAL';
  const PLACEHOLDER = '2026-09-30T00:00:00.000Z';
  const countMarks = (text) => text.split(MARK).length - 1;
  const docOf = (src, name) => { const at = src.indexOf(`export const ${name}`); return src.slice(src.lastIndexOf('/**', at), at); };

  // THE PROVISIONAL TEMPLATE: what js/tie-context.js looks like before it is stamped (two docblocks carrying the marker, two placeholder values).
  const TEMPLATE = [
    '/**', ' * DI-467 (forward-only). THE PRE-DEPLOY READ: select max(finalized_at) from public.weeks where status = \'final\';',
    ` *   ${MARK} — stamp at deploy (LP-3), then delete this marker line: deploy.sh refuses to stage while it is here. ***`, ' */',
    `export const TIE_RULE_EFFECTIVE_AT = '${PLACEHOLDER}';`, '',
    '/**', ' * SC-K5. THE EPOCH THE FALLBACK TIERS END AT.', ` *   ${MARK} — this is NOT the real epoch yet. ***`, ' */',
    `export const ALMA_SNAPSHOT_EPOCH_AT = '${PLACEHOLDER}';`, ''].join('\n');
  const stampOf = (text, tieValue, almaValue) => text.split(MARK).join('STAMPED')
    .replace(`export const TIE_RULE_EFFECTIVE_AT = '${PLACEHOLDER}';`, `export const TIE_RULE_EFFECTIVE_AT = '${tieValue}';`)
    .replace(`export const ALMA_SNAPSHOT_EPOCH_AT = '${PLACEHOLDER}';`, `export const ALMA_SNAPSHOT_EPOCH_AT = '${almaValue}';`);
  assert(countMarks(TEMPLATE) === 2 && TEMPLATE.includes(`TIE_RULE_EFFECTIVE_AT = '${PLACEHOLDER}'`) && TEMPLATE.includes(`ALMA_SNAPSHOT_EPOCH_AT = '${PLACEHOLDER}'`), 'T-G: fixture check: the template is a provisional file (two markers, two placeholder values)');

  // (1) THE STATE CLASSIFIER, and the shipped file in EXACTLY ONE of two states. The classifier takes TEXT (so it is tested on synthetic files, every clause alone) and the shipped file is
  // asserted through it. Each clause below is there on purpose; every clause except PARSE has a synthetic case that fails without it (PARSE is defence in depth: NaN already fails both bounds) (reviewer second review, K8: the ALMA clause was untested because the
  // shipped file is PROVISIONAL, so removing it from the shipped-file check changed nothing).
  const readConst = (text, name) => (text.match(new RegExp(`^export const ${name} = '([^']*)';`, 'm')) || [])[1];
  const stateOf = (text) => {
    const tv = readConst(text, 'TIE_RULE_EFFECTIVE_AT'), av = readConst(text, 'ALMA_SNAPSHOT_EPOCH_AT');
    const provisional = countMarks(text) === 2 && docOf(text, 'TIE_RULE_EFFECTIVE_AT').includes(MARK) && docOf(text, 'ALMA_SNAPSHOT_EPOCH_AT').includes(MARK) && tv === PLACEHOLDER && av === PLACEHOLDER;
    // The two constants are NOT ordered against each other: LP-3 can stamp the effective date LATER than the epoch (a week finalized after the paste), so nothing here says epoch >= effective date.
    // Each constant has its OWN bound: the epoch is a real stamp LATER than the placeholder (clause ALMA); the effective date is NOT EARLIER than it (clause TIE: the placeholder is Drew's approval date,
    // so an earlier stamp is a typo, e.g. 2025-10-03); both must parse (clause PARSE).
    const stamped = countMarks(text) === 0
      && Number.isFinite(Date.parse(tv)) && Number.isFinite(Date.parse(av))                      // PARSE
      && Date.parse(tv) >= Date.parse(PLACEHOLDER)                                               // TIE lower bound
      && av !== PLACEHOLDER && Date.parse(av) > Date.parse(PLACEHOLDER);                         // ALMA
    return provisional ? 'PROVISIONAL' : stamped ? 'STAMPED' : 'NEITHER';
  };
  const STAMP_A = '2026-10-04T15:00:00.000Z';
  assert(stateOf(TEMPLATE) === 'PROVISIONAL' && stateOf(stampOf(TEMPLATE, PLACEHOLDER, STAMP_A)) === 'STAMPED' && stateOf(stampOf(TEMPLATE, '2026-10-06T09:00:00.000Z', STAMP_A)) === 'STAMPED',
    'T-G: the classifier: the template is PROVISIONAL; markers deleted with the epoch stamped is STAMPED (effective date left at the placeholder, or stamped LATER than the epoch)');
  assert(stateOf(stampOf(TEMPLATE, PLACEHOLDER, PLACEHOLDER)) === 'NEITHER' && stateOf(stampOf(TEMPLATE, PLACEHOLDER, '2026-09-29T00:00:00.000Z')) === 'NEITHER',
    'T-G (K8, the ALMA clause alone): markers deleted but the epoch left at the placeholder, or stamped EARLIER than it, is NEITHER — a classifier without the ALMA clause would call these STAMPED');
  assert(stateOf(stampOf(TEMPLATE, '2025-10-03T00:00:00.000Z', STAMP_A)) === 'NEITHER' && stateOf(stampOf(TEMPLATE, '2026-09-29T23:59:59.999Z', STAMP_A)) === 'NEITHER',
    'T-G (the TIE lower bound alone): an effective date earlier than the placeholder (a typo such as 2025-10-03, or one millisecond early) is NEITHER');
  assert(stateOf(stampOf(TEMPLATE, 'TBD', STAMP_A)) === 'NEITHER' && stateOf(stampOf(TEMPLATE, PLACEHOLDER, 'TBD')) === 'NEITHER' && stateOf(stampOf(TEMPLATE, PLACEHOLDER, '2026-13-45T99:99:99.000Z')) === 'NEITHER',
    'T-G (the PARSE clause alone): a value that does not parse (TBD, an impossible date) is NEITHER');
  assert(stateOf(TEMPLATE.replace(`ALMA_SNAPSHOT_EPOCH_AT = '${PLACEHOLDER}'`, `ALMA_SNAPSHOT_EPOCH_AT = '${STAMP_A}'`)) === 'NEITHER' && stateOf(TEMPLATE.replace(MARK, 'STAMPED')) === 'NEITHER',
    'T-G: half-stamped files (the value stamped with its markers left in; one marker deleted) are NEITHER');
  const shippedState = stateOf(tcSrc);
  assert(shippedState !== 'NEITHER' && readConst(tcSrc, 'TIE_RULE_EFFECTIVE_AT') === tieCtx.TIE_RULE_EFFECTIVE_AT && readConst(tcSrc, 'ALMA_SNAPSHOT_EPOCH_AT') === tieCtx.ALMA_SNAPSHOT_EPOCH_AT,
    `T-G: the shipped js/tie-context.js is in EXACTLY ONE of two states — PROVISIONAL (two markers, one in each constant's docblock, both values the placeholder) or STAMPED (no marker, both values parse, the effective date not earlier than the placeholder, the epoch later than it) — now ${shippedState}`);
  const TIE = docOf(tcSrc, 'TIE_RULE_EFFECTIVE_AT');
  assert(/select max\(finalized_at\) from public\.weeks where status = 'final';/.test(TIE) && /ALL leagues/.test(TIE) && /R-4b/.test(TIE) && !/R-2\b/.test(TIE) && /web app only/.test(TIE),
    'T-G (LP-3): TIE_RULE_EFFECTIVE_AT\'s docblock names the REAL pre-deploy read (max(finalized_at) over all leagues), says to stamp later than it (R-4b\'s now() works), says finalize from the web app only until a build carries SP-54, and no longer cites the struck R-2');

  // (2) THE GATE, run on scratch trees
  const startAt = deploy.indexOf("# ── Safety check: the weekly tie-break's two release constants must be stamped");
  const reportAt = deploy.indexOf('# ── Report');
  const block = deploy.slice(startAt, reportAt);
  assert(startAt > deploy.indexOf("echo \"   ✅ no RELEASE-EDIT placeholders in the staged What's New\"") && reportAt > startAt && /grep -qF '\*\*\* PROVISIONAL' "\$TIE_CTX"/.test(block) && block.includes(`GATE_PLACEHOLDER="${PLACEHOLDER}"`)
      && /\[ -z "\$ALMA_MS" \]/.test(block) && /\[ "\$ALMA_MS" -le "\$PH_MS" \]/.test(block) && /\[ -z "\$TIE_MS" \]/.test(block) && /\[ "\$TIE_MS" -lt "\$PH_MS" \]/.test(block) && /Number\.isFinite\(t\)/.test(block) && /\n    exit 1\n  fi\nfi/.test(block),
    'T-G: deploy.sh carries the stop AFTER the RELEASE-EDIT check and BEFORE the report, and it checks the marker, that BOTH values PARSE, the epoch is LATER than the placeholder and the effective date NOT EARLIER than it (the placeholder in the script is the template\'s placeholder), then exit 1');
  const run = async (text) => {
    const dest = await mkdtemp(join(tmpdir(), 'cfbp-gate-'));
    try {
      await mkdir(join(dest, 'js'));
      if (text !== null) await writeFile(join(dest, 'js', 'tie-context.js'), text);
      const r = spawnSync('bash', ['-c', `set -euo pipefail\nDEST="$1"\n${block}`, 'gate', dest], { encoding: 'utf8' });
      return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
    } finally { await rm(dest, { recursive: true, force: true }); }
  };
  const fresh = await run(TEMPLATE);
  assert(fresh.code === 1 && fresh.out.includes('STOP') && fresh.out.includes('PROVISIONAL') && fresh.out.includes('select max(finalized_at)') && fresh.out.includes('select now();') && fresh.out.includes('Why: a PROVISIONAL marker'),
    `T-G: DRY RUN — the provisional template (both markers, both placeholders) is REFUSED: exit ${fresh.code}, the message says why and names both reads`);
  const oneMarker = TEMPLATE.replace(MARK, 'STAMPED'), otherMarker = TEMPLATE.slice(0, TEMPLATE.lastIndexOf(MARK)) + 'STAMPED' + TEMPLATE.slice(TEMPLATE.lastIndexOf(MARK) + MARK.length);
  assert((await run(oneMarker)).code === 1 && (await run(otherMarker)).code === 1, 'T-G: one marker removed, the other still there (either one): still REFUSED');
  // B3: the markers deleted but the PLACEHOLDER VALUE left: the gate used to pass this (it checked the comment, not the value)
  const placeholderLeft = await run(stampOf(TEMPLATE, PLACEHOLDER, PLACEHOLDER));
  assert(placeholderLeft.code === 1 && placeholderLeft.out.includes('Why: ALMA_SNAPSHOT_EPOCH_AT is still the placeholder'), 'T-G (B3): BOTH markers deleted but ALMA_SNAPSHOT_EPOCH_AT left at the placeholder: still REFUSED (the gate checks the value, not only the comment)');
  assert((await run(stampOf(TEMPLATE, PLACEHOLDER, '2026-09-30T00:00:00Z'))).code === 1 && (await run(stampOf(TEMPLATE, PLACEHOLDER, '2026-09-29T12:00:00.000Z'))).code === 1,
    'T-G: an epoch that is the placeholder INSTANT in another spelling (no milliseconds), or earlier than it, is REFUSED (compared as instants, not as strings)');
  assert((await run(TEMPLATE.replace(`ALMA_SNAPSHOT_EPOCH_AT = '${PLACEHOLDER}'`, `ALMA_SNAPSHOT_EPOCH_AT = '${STAMP_A}'`))).code === 1, 'T-G: a stamped VALUE with its marker lines left in is still refused (stamping means deleting the marker too)');
  assert((await run(stampOf(TEMPLATE, PLACEHOLDER, STAMP_A).replace(/export const ALMA_SNAPSHOT_EPOCH_AT[^\n]*\n/, 'export const SOMETHING_ELSE = 1;\n'))).code === 1, 'T-G: a file where the ALMA_SNAPSHOT_EPOCH_AT constant cannot be READ is refused (fail closed), never waved through');
  // reviewer second review: the lower bound and the parse conditions
  const early = await run(stampOf(TEMPLATE, '2025-10-03T00:00:00.000Z', STAMP_A));
  assert(early.code === 1 && early.out.includes('Why: TIE_RULE_EFFECTIVE_AT is earlier than'), 'T-G (lower bound): an effective date earlier than Drew\'s approval date (a typo stamp such as 2025-10-03) is REFUSED, and the message says why');
  assert((await run(stampOf(TEMPLATE, '2026-09-29T23:59:59.999Z', STAMP_A))).code === 1 && (await run(stampOf(TEMPLATE, PLACEHOLDER, STAMP_A))).code === 0, 'T-G (lower bound): one millisecond before the placeholder is refused; EXACTLY the placeholder is allowed (it may stay there if no old week finalized after it)');
  const tbdEpoch = await run(stampOf(TEMPLATE, PLACEHOLDER, 'TBD')), tbdTie = await run(stampOf(TEMPLATE, 'TBD', STAMP_A));
  assert(tbdEpoch.code === 1 && tbdEpoch.out.includes('Why: ALMA_SNAPSHOT_EPOCH_AT is missing or is not an instant that parses') && tbdTie.code === 1 && tbdTie.out.includes('Why: TIE_RULE_EFFECTIVE_AT is missing or is not an instant that parses'),
    'T-G (parse): an epoch or an effective date that does not parse (TBD) is REFUSED, each with its own reason');
  assert((await run(stampOf(TEMPLATE, PLACEHOLDER, '2026-13-45T99:99:99.000Z'))).code === 1, 'T-G (parse): an impossible calendar date that LOOKS like an instant is refused (parsed, not pattern-matched)');
  const ok = await run(stampOf(TEMPLATE, PLACEHOLDER, STAMP_A));
  assert(ok.code === 0 && ok.out.includes('no PROVISIONAL release constants in the staged tie-context.js'), `T-G: markers deleted and ALMA_SNAPSHOT_EPOCH_AT stamped (the effective date left at its value): PASSES and says so (exit ${ok.code})`);
  assert((await run(stampOf(TEMPLATE, '2026-10-06T09:00:00.000Z', STAMP_A))).code === 0, 'T-G: both stamped, the effective date LATER than the epoch (the pre-deploy read found a week finalized after the paste): PASSES — the two are not ordered');
  assert((await run(null)).code === 0, 'T-G: a staged tree with no js/tie-context.js at all still PASSES (it is not this gate\'s business)');
  // mutation canary: a gate block without its `exit 1` would pass the template, and this is how the test would see it
  assert(block.replace(/\n    exit 1\n  fi\nfi/, '\n  fi\nfi') !== block, 'T-G canary: the gate block really contains an `exit 1` to remove');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// [T26b] THE BLIND RULE ON THE DASHBOARD CAPTION (DI-468): the reason rides `hideStanding` — an OPEN week, and a part of a multi-part week that is not yet all final, show NONE
// ─────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[T26b] the Dashboard caption row rides hideStanding: open week and a pending group part show no reason; the settled week does…');
{
  const pl = [{ playerId: 'b_w', displayName: 'Kevin', active: true }, { playerId: 'b_l', displayName: 'Koby', active: true }];
  const mk = (pid, over) => ({ playerId: pid, rank: 1, correctPicks: 5, incorrectPicks: 1, tiebreakerGuess: null, tiebreakerDelta: null, isWinner: false, isLoser: false, wonByTiebreaker: false, ...over });
  const winner = mk('b_w', { isWinner: true, tieBreak: { v: 1, end: 'winner', stage: 'alma', vs: 'b_l', src: 'snapshot', me: { team: 'Notre Dame', cov: 1, mis: 0, psh: 0, src: 'snapshot' }, other: { team: 'USC', cov: 0, mis: 1, psh: 0, src: 'snapshot' } } });
  const loser = mk('b_l', { rank: 2, isLoser: true, tieBreak: { v: 1, end: 'loser', stage: 'draw', vs: 'b_w', me: null, other: null } });
  const base = { weekNumber: 61, season: 2026, dataSourceMode: 'live', lockedAt: LOCKED_AT, finalizedAt: FINALIZED_AT };
  const final = { ...base, weekId: 'w_t26b', status: 'final' };
  storage.saveWeek(final);
  const shown = app.renderScoreSummaryRowsHTML(final, [winner, loser], pl, null);
  assert(/<p class="tie-note">Won the tie: Notre Dame covered, USC did not cover<\/p>/.test(shown) && (shown.match(/tie-note-row/g) || []).length === 2 && /rank-cell rank-1/.test(shown) && /🏆/.test(shown),
    'T26b: control — a settled week shows the winner caption, the loser caption, the rank and the trophy');
  const open = { ...final, weekId: 'w_t26b_open', status: 'open' };
  storage.saveWeek(open);
  const hiddenOpen = app.renderScoreSummaryRowsHTML(open, [winner, loser], pl, null);
  assert(!/tie-note|Won the tie|Last on the tie|Dead heat/.test(hiddenOpen) && !/🏆|💀/.test(hiddenOpen) && (hiddenOpen.match(/rank-cell">—</g) || []).length === 2,
    'T26b: an OPEN week shows NO caption (and no trophy, skull or rank): a stored descriptor never reveals standing');
  // a part of a multi-part week whose other part is still live: this part's own rank is not the competitive rank, so the reason is hidden with it
  const partA = { ...final, weekId: 'w_t26b_g1', groupId: 'g_t26b', status: 'final' };
  const partB = { ...final, weekId: 'w_t26b_g2', groupId: 'g_t26b', status: 'live', finalizedAt: null };
  storage.saveWeek(partA); storage.saveWeek(partB);
  const pending = app.renderScoreSummaryRowsHTML(partA, [winner, loser], pl, null);
  assert(!/tie-note|Won the tie|Last on the tie|Dead heat/.test(pending) && /multi-part week/.test(pending) && (pending.match(/rank-cell">—</g) || []).length === 2,
    'T26b: a group part whose sibling is NOT yet final shows NO caption, no rank and the multi-part note (groupPending rides the same flag)');
  storage.saveWeek({ ...partB, status: 'final', finalizedAt: FINALIZED_AT });
  const done = app.renderScoreSummaryRowsHTML(partA, [winner, loser], pl, null);
  assert(/Won the tie: Notre Dame covered/.test(done) && !/multi-part week/.test(done), 'T26b: …and once every part is final the same part shows the caption (the control for the pending case)');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
