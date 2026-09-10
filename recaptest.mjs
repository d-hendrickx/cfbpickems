/**
 * CFB Pickems — recaptest.mjs  (fb_1788306484896_1owwx)
 * =====================================================
 * Regression coverage for `findPreviousFinalizedWeek()` / the picks-page
 * footer in `js/recap.js`.
 *
 * Run:  node recaptest.mjs
 *
 * THE BUG (Drew, 2026-09-01, v0.17.7, week w_1788306292997):
 *   "I've opened a new week, but the recap on the picks page is showing the
 *    results from the previous season, not last week. The results from
 *    previous season on the picks page are only [for] week 1 because it's
 *    supposed to replace the fact that there is no previous week to show
 *    results on."
 *
 * The §[1] fixture below is VERBATIM live data, read read-only out of the
 * production Sheet on 2026-09-02 (`getAll`/`get`, no writes). Both real weeks
 * carry `weekNumber: 1` — deliberately, per Drew's own week blurb: "For
 * whatever reason this is still week 1??? The NCAA has decided that Week 1 of
 * College Football spans two weeks." Neither is grouped (`groupId: null` on
 * both), so this is NOT the DEVELOPMENT_LEDGER §6 grouping deferral; it is an
 * ordering defect. `weekNumber` was being used as a TOTAL order over a season's
 * weeks, and it has never been unique.
 *
 * Sections:
 *   [1] The live fixture — the reported symptom, end to end.
 *   [2] Ordering: same-weekNumber siblings resolve by date, and asymmetrically.
 *   [3] Preserved behaviour — every pre-existing exclusion still excludes.
 *   [4] The genuine Week-1 case — the Permanent Record fallback still fires.
 *   [5] Tie-break precedence: weekNumber > startDate > createdAt.
 */

// ── Minimal DOM / localStorage stubs — same shape as loadtest/grouptest. ─────
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
globalThis.fetch = async () => { throw new Error('network disabled in recaptest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const recap = await import('./js/recap.js');
const { findPreviousFinalizedWeek, renderPicksFooterHTML, renderPrevWeekRecapHTML } = recap;

console.log('[recaptest] recap.js imported —', Object.keys(recap).length, 'exports');

// Seed the storage seam directly (local mode is the default; recap.js reads
// through load() in storage.js, so writing the seam keys IS the seam).
function seed({ weeks = [], players = [], results = [], games = [], picks = [], settings = {} }) {
  store.clear();
  localStorage.setItem('cfbp_weeks', JSON.stringify(weeks));
  localStorage.setItem('cfbp_players', JSON.stringify(players));
  localStorage.setItem('cfbp_results', JSON.stringify(results));
  localStorage.setItem('cfbp_games', JSON.stringify(games));
  localStorage.setItem('cfbp_picks', JSON.stringify(picks));
  localStorage.setItem('cfbp_settings', JSON.stringify({ season: '2026', ...settings }));
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] THE LIVE FIXTURE — verbatim from the production Sheet, 2026-09-02
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Drew\'s live data — Week 1 Part 2 must recap Week 1 Part 1…');

const LIVE_PART1 = {
  weekId: 'w2026_1', season: '2026', weekNumber: 1,
  label: 'Week 1', roundLabel: 'Part 1', espnWeekNumber: '1',
  startDate: '2026-08-29', endDate: '2026-08-30',
  status: 'final', dataSourceMode: 'espn_live',
  showInHistory: true,
  actualTiebreakerValue: 42, tiebreakerFinalized: true,
  extraPointEnabled: true, extraPointActual: 48,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-01T23:41:40.559Z',
  lockedAt: '2026-09-01T23:32:14.138Z', finalizedAt: '2026-09-01T23:41:40.559Z',
  groupId: null, isGroupTiebreaker: false,
};
const LIVE_PART2 = {
  weekId: 'w_1788306292997', season: '2026', weekNumber: 1,
  label: 'Week 1', roundLabel: 'Part 2', espnWeekNumber: '1',
  groupId: null, isGroupTiebreaker: false,
  startDate: '2026-09-03', endDate: '2026-09-07',
  status: 'open', dataSourceMode: 'espn_live',
  showInHistory: true,
  actualTiebreakerValue: null, tiebreakerFinalized: false,
  extraPointEnabled: true, extraPointActual: null,
  createdAt: '2026-09-01T23:44:52.997Z', updatedAt: '2026-09-02T02:34:27.173Z',
  lockedAt: null, finalizedAt: null,
};
const LIVE_DEMO = {
  weekId: 'w_demo', season: '2026', weekNumber: 0,
  label: '📋 Demo Week', roundLabel: '', startDate: '2026-08-29', endDate: '2026-08-30',
  status: 'open', dataSourceMode: 'demo', showInHistory: false,
  createdAt: '2026-01-01T00:00:00Z',
};
const LIVE_PLAYERS = [
  { playerId: 'p1', displayName: 'Drew',    active: true },
  { playerId: 'p2', displayName: 'Brayden', active: true },
  { playerId: 'p3', displayName: 'Kevin',   active: true },
  { playerId: 'p4', displayName: 'Koby',    active: true },
  { playerId: 'p5', displayName: 'Jacob',   active: true },
  { playerId: 'p6', displayName: 'Kihoon',  active: true },
];
const LIVE_RESULTS = [
  { resultId: 'wr_w2026_1_p1', weekId: 'w2026_1', playerId: 'p1', displayName: 'Drew',    correctPicks: 5, incorrectPicks: 3, correctCount: 5, incorrectCount: 3, noDecisions: 0, pending: 0, tiebreakerGuess: 45,  tiebreakerDelta: 3,  rank: 1, isWinner: true,  isLoser: false, wonByTiebreaker: false },
  { resultId: 'wr_w2026_1_p5', weekId: 'w2026_1', playerId: 'p5', displayName: 'Jacob',   correctPicks: 4, incorrectPicks: 4, correctCount: 4, incorrectCount: 4, noDecisions: 0, pending: 0, tiebreakerGuess: 45,  tiebreakerDelta: 3,  rank: 2, isWinner: false, isLoser: false, wonByTiebreaker: false },
  { resultId: 'wr_w2026_1_p4', weekId: 'w2026_1', playerId: 'p4', displayName: 'Koby',    correctPicks: 4, incorrectPicks: 4, correctCount: 4, incorrectCount: 4, noDecisions: 0, pending: 0, tiebreakerGuess: 38,  tiebreakerDelta: 4,  rank: 3, isWinner: false, isLoser: false, wonByTiebreaker: false },
  { resultId: 'wr_w2026_1_p6', weekId: 'w2026_1', playerId: 'p6', displayName: 'Kihoon',  correctPicks: 4, incorrectPicks: 4, correctCount: 4, incorrectCount: 4, noDecisions: 0, pending: 0, tiebreakerGuess: 50,  tiebreakerDelta: 8,  rank: 4, isWinner: false, isLoser: false, wonByTiebreaker: false },
  { resultId: 'wr_w2026_1_p2', weekId: 'w2026_1', playerId: 'p2', displayName: 'Brayden', correctPicks: 4, incorrectPicks: 4, correctCount: 4, incorrectCount: 4, noDecisions: 0, pending: 0, tiebreakerGuess: 52,  tiebreakerDelta: 10, rank: 5, isWinner: false, isLoser: false, wonByTiebreaker: false },
  { resultId: 'wr_w2026_1_p3', weekId: 'w2026_1', playerId: 'p3', displayName: 'Kevin',   correctPicks: 4, incorrectPicks: 4, correctCount: 4, incorrectCount: 4, noDecisions: 0, pending: 0, tiebreakerGuess: 112, tiebreakerDelta: 70, rank: 6, isWinner: false, isLoser: true,  wonByTiebreaker: true },
];
const LIVE_GAMES = [
  { gameId: 'g_1785991043548_w4k9f', weekId: 'w2026_1', homeTeam: 'TCU', awayTeam: 'North Carolina', spread: -7, atsWinner: 'North Carolina', status: 'final', multiplier: 1 },
];

seed({ weeks: [LIVE_PART1, LIVE_PART2, LIVE_DEMO], players: LIVE_PLAYERS,
       results: LIVE_RESULTS, games: LIVE_GAMES });

const prevForPart2 = findPreviousFinalizedWeek(LIVE_PART2);
assert(prevForPart2 !== null,
  '[1a] findPreviousFinalizedWeek(Part 2) is not null');
assert(prevForPart2?.weekId === 'w2026_1',
  '[1b] findPreviousFinalizedWeek(Part 2) === w2026_1 (Week 1, Part 1)');

const footer = renderPicksFooterHTML(LIVE_PART2);
assert(footer.includes('Chart Review'),
  '[1c] picks footer renders the Chart Review recap card');
assert(footer.includes('Week 1, Part 1'),
  '[1d] the recap card names Week 1, Part 1');
assert(!footer.includes('The Permanent Record'),
  '[1e] the last-season Permanent Record card does NOT render (the reported symptom)');
assert(!footer.includes('CFP 2K25'),
  '[1f] no 2K25 prior-season content on a week that HAS a previous week');

// ─────────────────────────────────────────────────────────────────────────────
// [2] ORDERING — same-weekNumber siblings, and the asymmetry that matters
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Same-weekNumber siblings order by date, not by accident…');

const PART2_FINAL = { ...LIVE_PART2, status: 'final', finalizedAt: '2026-09-08T00:00:00Z' };

// [2a] must be NON-VACUOUS: with Part 2 still 'open' the status filter alone
// would exclude it, so this seeds BOTH parts final and asserts the EARLIER one
// still sees no predecessor. That is what makes the comparison strict rather
// than merely "not equal" — a comparator that returned a constant on ties
// would make Part 1 recap its own successor.
seed({ weeks: [LIVE_PART1, PART2_FINAL, LIVE_DEMO], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS, ...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_p2', weekId: 'w_1788306292997' }))],
       games: [...LIVE_GAMES, { ...LIVE_GAMES[0], gameId: 'g2', weekId: 'w_1788306292997' }] });
assert(findPreviousFinalizedWeek(LIVE_PART1) === null,
  '[2a] with BOTH parts final, Part 1 does NOT get Part 2 as its "previous" week');
assert(findPreviousFinalizedWeek(PART2_FINAL)?.weekId === 'w2026_1',
  '[2a2] …while Part 2 still sees Part 1 (the order is one-way, not symmetric)');

// Part 2 finalized, Part 3 opened — the most RECENT prior part wins, not the first.
const PART3 = { ...LIVE_PART2, weekId: 'w_part3', roundLabel: 'Part 3',
                startDate: '2026-09-08', endDate: '2026-09-08', status: 'open',
                createdAt: '2026-09-08T00:00:00Z' };
seed({ weeks: [LIVE_PART1, PART2_FINAL, PART3, LIVE_DEMO], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS, ...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_p2', weekId: 'w_1788306292997' }))],
       games: [...LIVE_GAMES, { ...LIVE_GAMES[0], gameId: 'g2', weekId: 'w_1788306292997' }] });
assert(findPreviousFinalizedWeek(PART3)?.weekId === 'w_1788306292997',
  '[2b] with two finalized same-number parts, the LATEST one is chosen');

// A later-numbered week still beats an earlier same-numbered one.
const WEEK2 = { ...LIVE_PART2, weekId: 'w_week2', weekNumber: 2, roundLabel: '',
                startDate: '2026-09-12', endDate: '2026-09-12', status: 'open',
                createdAt: '2026-09-09T00:00:00Z' };
assert(findPreviousFinalizedWeek(WEEK2)?.weekId === 'w_1788306292997',
  '[2c] Week 2 recaps Week 1 Part 2 (highest ordering key below it)');

// ─────────────────────────────────────────────────────────────────────────────
// [3] PRESERVED BEHAVIOUR — every pre-existing exclusion still excludes
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] Pre-existing exclusions all still hold…');

const base = w => ({ ...LIVE_PART1, ...w });

// (a) non-final prior week is excluded
seed({ weeks: [base({ status: 'live' }), LIVE_PART2], players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
assert(findPreviousFinalizedWeek(LIVE_PART2) === null,
  '[3a] a LIVE prior week is not a "previous finalized week"');

// (b) showInHistory:false is excluded
seed({ weeks: [base({ showInHistory: false }), LIVE_PART2], players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
assert(findPreviousFinalizedWeek(LIVE_PART2) === null,
  '[3b] showInHistory:false prior week is excluded');

// (c) demo prior week is excluded (v0.17.0)
seed({ weeks: [base({ dataSourceMode: 'demo' }), LIVE_PART2], players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
assert(findPreviousFinalizedWeek(LIVE_PART2) === null,
  '[3c] demo prior week never drives a recap');

// (d) different season is excluded
seed({ weeks: [base({ season: '2025' }), LIVE_PART2], players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
assert(findPreviousFinalizedWeek(LIVE_PART2) === null,
  '[3d] a prior-SEASON week is excluded from the same-season search');

// (e) the week itself is never its own previous week
seed({ weeks: [base({ ...LIVE_PART2, status: 'final' })], players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
assert(findPreviousFinalizedWeek({ ...LIVE_PART2, status: 'final' }) === null,
  '[3e] a week is never its own previous week');

// (f) no argument at all
seed({ weeks: [LIVE_PART1], players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
assert(findPreviousFinalizedWeek(null) === null,
  '[3f] findPreviousFinalizedWeek(null) returns null, does not throw');
assert(findPreviousFinalizedWeek(undefined) === null,
  '[3g] findPreviousFinalizedWeek(undefined) returns null, does not throw');

// ─────────────────────────────────────────────────────────────────────────────
// [4] THE GENUINE WEEK-1 CASE — the fallback Drew described must still fire
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Real Week 1 (no previous week at all) still shows the Permanent Record…');

seed({ weeks: [LIVE_PART1_OPEN(), LIVE_DEMO], players: LIVE_PLAYERS, results: [], games: [] });
function LIVE_PART1_OPEN() { return { ...LIVE_PART1, status: 'open', roundLabel: '' }; }
const wk1Footer = renderPicksFooterHTML(LIVE_PART1_OPEN());
assert(findPreviousFinalizedWeek(LIVE_PART1_OPEN()) === null,
  '[4a] season-opening week has no previous finalized week');
assert(wk1Footer.includes('The Permanent Record'),
  '[4b] Week 1 still renders the last-season Permanent Record stand-in');
assert(wk1Footer.includes('CFP 2K25'),
  '[4c] …with the 2K25 season of record');

// ─────────────────────────────────────────────────────────────────────────────
// [5] TIE-BREAK PRECEDENCE — weekNumber, then startDate, then createdAt
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] Ordering key precedence…');

// Same weekNumber AND same startDate → createdAt decides.
const A = { ...LIVE_PART1, weekId: 'wA', roundLabel: 'A', startDate: '2026-08-29', createdAt: '2026-08-01T00:00:00Z' };
const B = { ...LIVE_PART1, weekId: 'wB', roundLabel: 'B', startDate: '2026-08-29', createdAt: '2026-08-02T00:00:00Z' };
const C = { ...LIVE_PART2, weekId: 'wC', roundLabel: 'C', startDate: '2026-08-29', createdAt: '2026-08-03T00:00:00Z' };
seed({ weeks: [A, B, C], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_A', weekId: 'wA' })),
                 ...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_B', weekId: 'wB' }))],
       games: [{ ...LIVE_GAMES[0], gameId: 'gA', weekId: 'wA' }, { ...LIVE_GAMES[0], gameId: 'gB', weekId: 'wB' }] });
assert(findPreviousFinalizedWeek(C)?.weekId === 'wB',
  '[5a] identical weekNumber + startDate → later createdAt wins');
assert(findPreviousFinalizedWeek(B)?.weekId === 'wA',
  '[5b] …and the earlier-created sibling is still reachable from the later one');

// weekNumber dominates startDate: a week 2 dated BEFORE a week 1 still sorts after.
const OUT_OF_ORDER_W1 = { ...LIVE_PART1, weekId: 'wOo1', weekNumber: 1, startDate: '2026-09-20', createdAt: '2026-08-01T00:00:00Z' };
const OUT_OF_ORDER_W2 = { ...LIVE_PART1, weekId: 'wOo2', weekNumber: 2, startDate: '2026-08-29', createdAt: '2026-08-02T00:00:00Z' };
const OUT_OF_ORDER_W3 = { ...LIVE_PART2, weekId: 'wOo3', weekNumber: 3, startDate: '2026-08-01', createdAt: '2026-08-03T00:00:00Z' };
seed({ weeks: [OUT_OF_ORDER_W1, OUT_OF_ORDER_W2, OUT_OF_ORDER_W3], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_1', weekId: 'wOo1' })),
                 ...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_2', weekId: 'wOo2' }))],
       games: [{ ...LIVE_GAMES[0], gameId: 'go1', weekId: 'wOo1' }, { ...LIVE_GAMES[0], gameId: 'go2', weekId: 'wOo2' }] });
assert(findPreviousFinalizedWeek(OUT_OF_ORDER_W3)?.weekId === 'wOo2',
  '[5c] weekNumber still dominates startDate (week 2 beats week 1 regardless of dates)');

// Missing startDate/createdAt must not throw or reorder same-number peers wrongly.
const NO_DATES_PREV = { ...LIVE_PART1, weekId: 'wNd1', startDate: '', endDate: '', createdAt: undefined };
const NO_DATES_CUR  = { ...LIVE_PART2, weekId: 'wNd2', startDate: '2026-09-03', createdAt: '2026-09-01T00:00:00Z' };
seed({ weeks: [NO_DATES_PREV, NO_DATES_CUR], players: LIVE_PLAYERS,
       results: LIVE_RESULTS.map(r => ({ ...r, weekId: 'wNd1' })),
       games: [{ ...LIVE_GAMES[0], gameId: 'gnd', weekId: 'wNd1' }] });
assert(findPreviousFinalizedWeek(NO_DATES_CUR)?.weekId === 'wNd1',
  '[5d] a dateless prior week sorts before a dated one (no throw, no null)');

// startDate BEATS createdAt. Record-creation order is not slate order — a
// commissioner can create a later part first and back-fill an earlier one, or
// (as in the live data) an app-seeded week can predate every hand-made one.
// These two fixtures order OPPOSITELY under the two keys, so only the correct
// precedence yields wLateSlate.
const EARLY_SLATE = { ...LIVE_PART1, weekId: 'wEarlySlate', roundLabel: 'E',
                      startDate: '2026-09-01', createdAt: '2026-09-20T00:00:00Z' };
const LATE_SLATE  = { ...LIVE_PART1, weekId: 'wLateSlate',  roundLabel: 'L',
                      startDate: '2026-09-10', createdAt: '2026-09-01T00:00:00Z' };
const AFTER_BOTH  = { ...LIVE_PART2, weekId: 'wAfterBoth',  roundLabel: 'X',
                      startDate: '2026-09-15', createdAt: '2026-09-25T00:00:00Z' };
seed({ weeks: [EARLY_SLATE, LATE_SLATE, AFTER_BOTH], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_E', weekId: 'wEarlySlate' })),
                 ...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_L', weekId: 'wLateSlate' }))],
       games: [{ ...LIVE_GAMES[0], gameId: 'gE', weekId: 'wEarlySlate' }, { ...LIVE_GAMES[0], gameId: 'gL', weekId: 'wLateSlate' }] });
assert(findPreviousFinalizedWeek(AFTER_BOTH)?.weekId === 'wLateSlate',
  '[5e] startDate outranks createdAt when the two disagree');


// ─────────────────────────────────────────────────────────────────────────────
// [6] THE SAME DEFECTIVE PRIMITIVE, 90 LINES DOWN (reviewer F1)
//
// `renderWeekRecapCardHTML()`'s standings-context line used the identical bad
// assumption — `w.weekNumber <= prev.weekNumber` — to decide "which results
// existed as of that week". On a same-weekNumber sibling that `<=` is TRUE in
// both directions, so a LATER part's results leak into an EARLIER part's
// "Season chart after …" line. SCRIBE then states, under its own byline, a
// false fact about a named player at a named point in time.
//
// Latent until both parts are final — which is why this could not be seen in
// the field yet, and why it must not be left to be seen in the field.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] Standings context must not read the FUTURE from a sibling part…');

const P1_FINAL = { ...LIVE_PART1 };                       // Drew won it, 5–4
const P2_FINAL = { ...LIVE_PART2, status: 'final', finalizedAt: '2026-09-08T00:00:00Z' };
// Part 2: Kevin runs away with it. Season-to-date he leads; as of PART 1 he did not.
const P2_RESULTS = LIVE_PLAYERS.map((p, i) => ({
  resultId: `wr_p2_${p.playerId}`, weekId: 'w_1788306292997', playerId: p.playerId,
  displayName: p.displayName,
  correctPicks: p.playerId === 'p3' ? 20 : 0, incorrectPicks: p.playerId === 'p3' ? 0 : 20,
  correctCount: p.playerId === 'p3' ? 20 : 0, incorrectCount: p.playerId === 'p3' ? 0 : 20,
  noDecisions: 0, pending: 0, tiebreakerGuess: 40, tiebreakerDelta: 1,
  rank: p.playerId === 'p3' ? 1 : i + 2,
  isWinner: p.playerId === 'p3', isLoser: false, wonByTiebreaker: false,
}));
seed({ weeks: [P1_FINAL, P2_FINAL, LIVE_DEMO], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS, ...P2_RESULTS],
       games: [...LIVE_GAMES, { ...LIVE_GAMES[0], gameId: 'g_p2', weekId: 'w_1788306292997' }] });

const chartLineOf = html => (html.match(/📈 Season chart after[^<]*<strong>[^<]*<\/strong> leads\./) || [''])[0];

const p1Chart = chartLineOf(recap.renderWeekRecapCardHTML(P1_FINAL));
assert(p1Chart !== '',
  '[6a] Part 1\'s Chart Review renders a "Season chart after…" line');
assert(p1Chart.includes('<strong>Drew</strong>'),
  '[6b] "Season chart after Week 1, Part 1" names Drew — who actually led at that point');
assert(!p1Chart.includes('<strong>Kevin</strong>'),
  '[6c] …and NOT Kevin, who only leads because of Part 2 (SCRIBE must not state a false fact)');

// The inclusive half of `<=` must be preserved: a week's own results still
// count toward its own "season chart after" line.
const p2Chart = chartLineOf(recap.renderWeekRecapCardHTML(P2_FINAL));
assert(p2Chart.includes('<strong>Kevin</strong>'),
  '[6d] "Season chart after Week 1, Part 2" DOES include Part 2 — the week itself still counts');

// And the ordinary, differing-weekNumber case is untouched.
const WK2_FINAL = { ...LIVE_PART1, weekId: 'w_wk2', weekNumber: 2, roundLabel: '',
                    startDate: '2026-09-12', endDate: '2026-09-12', createdAt: '2026-09-09T00:00:00Z' };
seed({ weeks: [P1_FINAL, WK2_FINAL], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS, ...P2_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_wk2', weekId: 'w_wk2' }))],
       games: [...LIVE_GAMES, { ...LIVE_GAMES[0], gameId: 'g_wk2', weekId: 'w_wk2' }] });
assert(chartLineOf(recap.renderWeekRecapCardHTML(P1_FINAL)).includes('<strong>Drew</strong>'),
  '[6e] a later-NUMBERED week never leaked into an earlier week\'s chart line (unchanged behaviour)');

// ─────────────────────────────────────────────────────────────────────────────
// [7] TOTAL TIE — strictness in the one case createWeek() cannot produce,
//     but importing or duplicating a SEEDED week can (reviewer F3).
//
// REAL_WEEK_1_2026 and DEMO_WEEK both hardcode createdAt:'2026-01-01T00:00:00Z'
// (data-model.js:322, :354), so two weeks can tie on ALL THREE keys. A
// non-strict comparison there is true in both directions and the two weeks
// would recap EACH OTHER. Without this fixture, relaxing the filter's `< 0`
// to `<= 0` left the whole suite green — a surviving mutant.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] A total tie on all three keys is NOT "strictly before"…');

const TIE_A = { ...LIVE_PART1, weekId: 'wTieA', roundLabel: 'A',
                weekNumber: 1, startDate: '2026-08-29', createdAt: '2026-01-01T00:00:00Z' };
const TIE_B = { ...LIVE_PART1, weekId: 'wTieB', roundLabel: 'B',
                weekNumber: 1, startDate: '2026-08-29', createdAt: '2026-01-01T00:00:00Z' };
seed({ weeks: [TIE_A, TIE_B], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_TA', weekId: 'wTieA' })),
                 ...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_TB', weekId: 'wTieB' }))],
       games: [{ ...LIVE_GAMES[0], gameId: 'gTA', weekId: 'wTieA' },
               { ...LIVE_GAMES[0], gameId: 'gTB', weekId: 'wTieB' }] });
assert(findPreviousFinalizedWeek(TIE_B) === null,
  '[7a] indistinguishable weeks: neither is "before" the other (B sees no predecessor)');
assert(findPreviousFinalizedWeek(TIE_A) === null,
  '[7b] …and symmetrically A sees none either — they cannot recap each other');

// ─────────────────────────────────────────────────────────────────────────────
// [8] THE FALLBACK CONFLATES TWO FAILURES (reviewer F4)
//
// DOCUMENTS CURRENT BEHAVIOUR — it does not endorse it. If the previous week
// is correctly found but its RESULTS rows are missing, buildWeekStorylines()
// returns null, renderPrevWeekRecapHTML() returns '', and the footer falls
// through to the Permanent Record — i.e. Drew's EXACT reported symptom, from a
// completely unrelated cause (results loss, not week ordering).
//
// These assertions exist so a future recurrence is diagnosable in one test
// run: [8a] proves the ORDERING layer is healthy, [8b]/[8c] localise the
// failure to the missing results. Whether the user should SEE a different
// message for "previous week has no results" than for "there is no previous
// week" is a DESIGN question — flagged for user-experience, not decided here.
// If that design lands, [8c] is the assertion to update deliberately.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] Results-loss produces the same visible symptom (documented, not endorsed)…');

seed({ weeks: [LIVE_PART1, LIVE_PART2, LIVE_DEMO], players: LIVE_PLAYERS,
       results: [], games: LIVE_GAMES });
assert(findPreviousFinalizedWeek(LIVE_PART2)?.weekId === 'w2026_1',
  '[8a] ordering layer still correctly identifies Part 1 (this bug is NOT the ordering defect)');
assert(renderPrevWeekRecapHTML(LIVE_PART2) === '',
  '[8b] the recap card cannot be built without results rows');
assert(renderPicksFooterHTML(LIVE_PART2).includes('The Permanent Record'),
  '[8c] CURRENT behaviour: footer shows the last-season card — indistinguishable from the fixed bug');

// ─────────────────────────────────────────────────────────────────────────────
// [9] MUTANT-KILLERS — closing five survivors found by continuing to hunt
//     after the first ten died. Each of these was, until now, code that no
//     assertion could distinguish from a broken version of itself.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] Defensive coercions and the standings filter\'s other predicates…');

// (a) A week record with NO weekNumber at all — legacy/imported data.
//     Without the `?? 0` guard, Number(undefined) is NaN, NaN !== NaN is true,
//     and the comparator returns NaN. A NaN comparator silently yields an
//     undefined sort order and an always-false filter.
const { weekNumber: _wnA, ...NO_NUM_PREV } = { ...LIVE_PART1, weekId: 'wNoNum1', startDate: '2026-08-29' };
const { weekNumber: _wnB, ...NO_NUM_CUR }  = { ...LIVE_PART2, weekId: 'wNoNum2', startDate: '2026-09-03' };
seed({ weeks: [NO_NUM_PREV, NO_NUM_CUR], players: LIVE_PLAYERS,
       results: LIVE_RESULTS.map(r => ({ ...r, weekId: 'wNoNum1' })),
       games: [{ ...LIVE_GAMES[0], gameId: 'gNn', weekId: 'wNoNum1' }] });
assert(findPreviousFinalizedWeek(NO_NUM_CUR)?.weekId === 'wNoNum1',
  '[9a] weeks missing weekNumber entirely still order (no NaN comparator)');

// (b) A week record with startDate ABSENT (not '') — distinct from [5d], which
//     uses an empty string and therefore cannot detect a missing String() coercion.
const { startDate: _sdA, ...NO_SD_PREV } = { ...LIVE_PART1, weekId: 'wNoSd1' };
const NO_SD_CUR = { ...LIVE_PART2, weekId: 'wNoSd2', startDate: '2026-09-03' };
seed({ weeks: [NO_SD_PREV, NO_SD_CUR], players: LIVE_PLAYERS,
       results: LIVE_RESULTS.map(r => ({ ...r, weekId: 'wNoSd1' })),
       games: [{ ...LIVE_GAMES[0], gameId: 'gNs', weekId: 'wNoSd1' }] });
assert(findPreviousFinalizedWeek(NO_SD_CUR)?.weekId === 'wNoSd1',
  '[9b] an ABSENT startDate coerces rather than poisoning the comparison');

// (c)–(e) The standings-context filter's other three predicates. The [6] fix
//     changed that line, so all four of its conjuncts need cover, not just the
//     ordering one. Each ghost week is dated BEFORE Part 1 so the ORDERING
//     term admits it — only the predicate under test can exclude it.
const KEVIN_HEAVY = wid => LIVE_PLAYERS.map((p, i) => ({
  resultId: `gh_${wid}_${p.playerId}`, weekId: wid, playerId: p.playerId, displayName: p.displayName,
  correctPicks: p.playerId === 'p3' ? 99 : 0, incorrectPicks: 0,
  correctCount: p.playerId === 'p3' ? 99 : 0, incorrectCount: 0,
  noDecisions: 0, pending: 0, rank: i + 1, isWinner: p.playerId === 'p3', isLoser: false,
}));
const ghost = over => ({ ...LIVE_PART1, weekId: 'wGhost', roundLabel: 'G',
                         startDate: '2026-08-01', createdAt: '2026-07-01T00:00:00Z', ...over });
const chartOf = html => (html.match(/📈 Season chart after[^<]*<strong>[^<]*<\/strong> leads\./) || [''])[0];

for (const [over, label] of [
  [{ status: 'live' },          '[9c] a NON-final earlier week\'s results never enter the chart line'],
  [{ season: '2025' },          '[9d] a PRIOR-SEASON week\'s results never enter the chart line'],
  [{ showInHistory: false },    '[9e] a hidden (showInHistory:false) week\'s results never enter the chart line'],
]) {
  seed({ weeks: [LIVE_PART1, ghost(over)], players: LIVE_PLAYERS,
         results: [...LIVE_RESULTS, ...KEVIN_HEAVY('wGhost')],
         games: [...LIVE_GAMES, { ...LIVE_GAMES[0], gameId: 'gGh', weekId: 'wGhost' }] });
  assert(chartOf(recap.renderWeekRecapCardHTML(LIVE_PART1)).includes('<strong>Drew</strong>'), label);
}

// (f) Self-exclusion is NOT redundant with the strict comparator. It only
//     looks redundant when the caller's `week` object is field-identical to
//     storage's copy. `renderPicksFooterHTML(currentWeek)` (app.js:829) can be
//     handed a SNAPSHOT taken before a save — app.js already carries a comment
//     about that exact snapshot-vs-persisted trap on the finalize path. If the
//     stored copy's startDate sorts EARLIER than the snapshot's, ordering
//     admits it and the week recaps ITSELF: "Chart Review — Week 1, Part 2"
//     rendered on Week 1 Part 2's own picks page. Only `weekId !==` stops that.
const STORED_SELF = { ...LIVE_PART2, status: 'final', startDate: '2026-08-01' };
const STALE_SNAPSHOT = { ...LIVE_PART2, status: 'final', startDate: '2026-09-03' };
seed({ weeks: [STORED_SELF], players: LIVE_PLAYERS,
       results: LIVE_RESULTS.map(r => ({ ...r, weekId: 'w_1788306292997' })),
       games: [{ ...LIVE_GAMES[0], gameId: 'gSelf', weekId: 'w_1788306292997' }] });
assert(findPreviousFinalizedWeek(STALE_SNAPSHOT) === null,
  '[9f] a week never recaps ITSELF even when storage\'s copy sorts earlier than the caller\'s snapshot');

// (g) A week missing `createdAt` ENTIRELY must sort like a week whose
//     createdAt is '' — i.e. EARLIEST — matching how the startDate tier treats
//     absence. Without the `|| ''` coercion, String(undefined) is the literal
//     "undefined", which sorts AFTER every ISO date ('u' > '2') and silently
//     inverts the tier. [5d] cannot detect this: its fixture differs on
//     startDate, so the createdAt tier never executes.
const { createdAt: _caA, ...NO_CA } = { ...LIVE_PART1, weekId: 'wNoCa', roundLabel: 'NoCa', startDate: '2026-08-29' };
const HAS_CA = { ...LIVE_PART2, weekId: 'wHasCa', roundLabel: 'HasCa', startDate: '2026-08-29', createdAt: '2026-06-01T00:00:00Z' };
seed({ weeks: [NO_CA, HAS_CA], players: LIVE_PLAYERS,
       results: LIVE_RESULTS.map(r => ({ ...r, weekId: 'wNoCa' })),
       games: [{ ...LIVE_GAMES[0], gameId: 'gNoCa', weekId: 'wNoCa' }] });
assert(findPreviousFinalizedWeek(HAS_CA)?.weekId === 'wNoCa',
  '[9g] an ABSENT createdAt sorts earliest, like an absent startDate (not as "undefined")');

// (h) PINS THE CHOSEN SEMANTIC for a week record with no weekNumber: it sorts
//     as 0 — the EARLIEST — not as a large sentinel. Matches
//     getGroupTiebreakerWeek()'s own `?? 0` (data-model.js:533). Neither
//     choice is forced by the domain, so it is pinned here to make any future
//     change deliberate rather than incidental.
const { weekNumber: _wnH, ...NO_NUM_EARLY } = { ...LIVE_PART1, weekId: 'wNoNumEarly', roundLabel: 'NN', startDate: '2026-09-20' };
const NUMBERED_CUR = { ...LIVE_PART2, weekId: 'wNumCur', weekNumber: 1, startDate: '2026-08-29' };
seed({ weeks: [NO_NUM_EARLY, NUMBERED_CUR], players: LIVE_PLAYERS,
       results: LIVE_RESULTS.map(r => ({ ...r, weekId: 'wNoNumEarly' })),
       games: [{ ...LIVE_GAMES[0], gameId: 'gNne', weekId: 'wNoNumEarly' }] });
assert(findPreviousFinalizedWeek(NUMBERED_CUR)?.weekId === 'wNoNumEarly',
  '[9h] a week with NO weekNumber sorts as 0 (earliest), not as a large sentinel');

// ─────────────────────────────────────────────────────────────────────────────
// [10] DREW'S 2026-09-04 RE-REPORT — the SAME defect, seen from the LIVE SITE.
//
//   "on the picks page under week 2 (current) it is showing the results from
//    last season, and under week 1 it is showing the results from that week.
//    This is flipped. Under week 2 (aka where you're making picks) it's
//    supposed to show the results from last week and under week 1 it's
//    supposed to show results from last season."
//
// DIAGNOSIS (bugfixer, 2026-09-04): NOT a new defect. Already fixed at HEAD by
// feb8688; the live site still serves v0.17.8, whose findPreviousFinalizedWeek()
// is still the pre-fix `w.weekNumber < week.weekNumber`. Verified by running
// this section's fixture against BOTH trees side by side — the deploy clone
// (`.deploy`, commit 61aec3b, what irbfootball.com serves) and this one:
//     deployed 61aec3b -> "The Permanent Record"          <- Drew's symptom
//     HEAD             -> "Chart Review — Week 1, Part 1"
// "week 2" is Drew naming the SECOND week record in the picks-page nav, not a
// `weekNumber: 2`: both live records carry `weekNumber: 1` (§[1]), and a
// genuine `weekNumber: 2` reproduces on NEITHER tree — see [10g].
//
// WHAT THIS SECTION PINS THAT §[1] DID NOT:
//  (a) §[1]'s current week is `status:'open'`. Drew's no longer is — the Sep 3
//      slate has kicked off. The CURRENT week's status must not steer its own
//      footer, and nothing asserted that.
//  (b) The report is about a PAIR of pages. No fixture rendered BOTH surfaces,
//      so nothing here could have caught a genuine swap between them.
//  (c) "week 2" has a second reading. §[2c] covers a genuine `weekNumber: 2`
//      through the COMPARATOR only — that assertion would stay green while the
//      page stayed wrong, which is exactly this defect's history. [10g] reads
//      the rendered footer instead.
//  (d) [10h] is the DISCRIMINATOR. The Permanent Record on a non-opening week
//      has two causes that are identical on screen: the ordering defect (fixed)
//      and "the previous week was never finalized" (by design). Asserted at the
//      render layer so the next report of these words is triaged in one run.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] Drew 2026-09-04 — the live configuration, pinned at the render layer…');

const NAMES_PART1 = 'Chart Review — Week 1, Part 1';

// (a) The CURRENT week's own status must not steer its footer. Drew's week is
//     locked/live by now; §[1] only ever exercised 'open'.
for (const st of ['open', 'locked', 'live']) {
  const cur = { ...LIVE_PART2, status: st };
  seed({ weeks: [LIVE_PART1, cur, LIVE_DEMO], players: LIVE_PLAYERS,
         results: LIVE_RESULTS, games: LIVE_GAMES });
  const f = renderPicksFooterHTML(cur);
  assert(f.includes(NAMES_PART1) && !f.includes('The Permanent Record'),
    `[10a:${st}] picks footer on a ${st.toUpperCase()} current week renders "${NAMES_PART1}", not the Permanent Record`);
}

// (b) THE PAIR, from ONE fixture — the two pages Drew compared, side by side.
//     The second is app.js:958's historical read-only view, which renders a
//     finalized week's OWN card. That is the intended historical behaviour and
//     is byte-identical on both trees; it is pinned here so that "this is
//     flipped" can never again be diagnosed without both halves in evidence.
seed({ weeks: [LIVE_PART1, { ...LIVE_PART2, status: 'live' }, LIVE_DEMO],
       players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
const curFooter = renderPicksFooterHTML({ ...LIVE_PART2, status: 'live' });
const histCard  = recap.renderWeekRecapCardHTML(LIVE_PART1);
assert(curFooter.includes(NAMES_PART1),
  '[10d] the page you PICK on (Week 1, Part 2) shows LAST week\'s Chart Review');
assert(histCard.includes(NAMES_PART1) && !histCard.includes('Week Part 2'),
  '[10e] the page you BROWSE BACK to (Week 1, Part 1) shows its OWN Chart Review, not its sibling\'s — historical view, unchanged by the fix');
assert(!curFooter.includes('The Permanent Record') && !histCard.includes('The Permanent Record'),
  '[10f] the Permanent Record appears on NEITHER page once a finalized week exists in the season');

// (c) The OTHER reading of "week 2" — a genuine `weekNumber: 2` current week,
//     asserted through the RENDERED footer rather than §[2c]'s comparator.
const REAL_WEEK2 = { ...LIVE_PART2, weekId: 'w_real2', weekNumber: 2, roundLabel: '',
                     startDate: '2026-09-10', endDate: '2026-09-12',
                     status: 'open', createdAt: '2026-09-08T00:00:00Z' };
const PART2_DONE = { ...LIVE_PART2, status: 'final', finalizedAt: '2026-09-08T00:00:00Z' };
seed({ weeks: [LIVE_PART1, PART2_DONE, REAL_WEEK2, LIVE_DEMO], players: LIVE_PLAYERS,
       results: [...LIVE_RESULTS, ...LIVE_RESULTS.map(r => ({ ...r, resultId: r.resultId + '_p2', weekId: 'w_1788306292997' }))],
       games: [...LIVE_GAMES, { ...LIVE_GAMES[0], gameId: 'g_r2', weekId: 'w_1788306292997' }] });
const w2Footer = renderPicksFooterHTML(REAL_WEEK2);
// DI-135: roundLabel is now a suffix with the display number auto-prepended,
// so this reads "Week 1, Part 2" (not the pre-DI-135 "Week Part 2").
assert(w2Footer.includes('Chart Review — Week 1, Part 2') && !w2Footer.includes('The Permanent Record'),
  '[10g] a genuine weekNumber:2 current week RENDERS the Chart Review for the most recent finalized week (Part 2) — this reading of the report reproduces on neither tree');

// (d) DISCRIMINATOR — identical fixture, previous week never FINALIZED.
seed({ weeks: [{ ...LIVE_PART1, status: 'live', finalizedAt: null }, { ...LIVE_PART2, status: 'live' }, LIVE_DEMO],
       players: LIVE_PLAYERS, results: LIVE_RESULTS, games: LIVE_GAMES });
const unfinalizedFooter = renderPicksFooterHTML({ ...LIVE_PART2, status: 'live' });
assert(unfinalizedFooter.includes('The Permanent Record') && !unfinalizedFooter.includes('Chart Review'),
  '[10h] DOCUMENTED, NOT ENDORSED: a previous week that was never FINALIZED still falls back to the Permanent Record — same pixels as the fixed bug, different cause (design question, see §[8])');

console.log(`\n[recaptest] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
