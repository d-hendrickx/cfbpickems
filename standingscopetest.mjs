/**
 * CFB Pickems — standingscopetest.mjs
 * ===================================
 * SB-19 (Social Platform thread, bugfixer, 2026-10-01). Found by the SB-04
 * reviewer: two non-SCRIBE standings surfaces counted weeks the Standings page
 * does not.
 *
 * THE RULE (the Standings page, `seasonStandingsRows()` in js/app.js): season
 * standings count the STORED weekly results of weeks that are
 *   - shown in history   (`week.showInHistory !== false`), and
 *   - not demo weeks      (`week.dataSourceMode !== 'demo'`),
 * and a result row whose week no longer exists counts for nothing. The raw,
 * unfiltered week list goes to the scorer, for multi-part grouping.
 *
 * THE DEFECTS
 *   1. `exportStandingsCSV()` — its own comment says the audit export "must
 *      match what Standings shows on screen", but its filter kept only the
 *      `showInHistory` clause. A DEMO week's results were in the commissioner's
 *      standings_season.csv and on no screen.
 *   2. The commissioner email digest (`buildWeeklySummary()`'s "Season
 *      standings" block) passed EVERY weekly-result row to the scorer: demo
 *      weeks, hidden weeks, and rows whose week had been deleted.
 *
 * ROOT CAUSE: the week-scope rule was restated inline at every consumer, and
 * the copies drifted. The fix is one predicate, `isWeekShownInStandings(week)`,
 * that every standings consumer reads.
 *
 * WHAT THIS FILE DID NOT CHANGE AT FIRST: the digest's season block stayed the
 * documented 2-ARG, grouping-unaware call (Drew's UN-118/UN-125 scope ruling,
 * ledger §6) — only its WEEK FILTER changed, and [4b] pinned that.
 *
 * SB-19b (2026-10-01) — RE-DERIVED. Drew, 2026-10-01, on the digest counting a
 * fully final split week (live week w2026_1, Part 1/2) as two weekly W/L where
 * the Standings tab shows one: "agree with weekly email". The digest's season
 * block must match the Standings tab, so it now renders seasonStandingsRows()
 * — the page's own grouping-aware rows. [4b] pins that, and [5] pins that the
 * digest computes no season standings of its own (the CSV's shape).
 *
 * Run:  node standingscopetest.mjs
 * Also: TZ=UTC node standingscopetest.mjs && TZ=America/Los_Angeles node standingscopetest.mjs
 * Spawned by loadtest.mjs as [129], with a floor.
 *
 * SECTIONS
 *   0  Fixture checks — the stubs work, app.js imported, the real commissioner
 *      click path to the standings CSV can be driven.
 *   1  Positive controls — every excluded week (demo, hidden, deleted) WOULD
 *      change the standings if counted, so every later "excluded" is not vacuous.
 *   2  seasonStandingsRows() — BYTE-IDENTICAL to the pre-fix code, pinned two
 *      ways: a hand-derived golden, and a literal copy of the pre-fix filter run
 *      over a 30-shape week matrix.
 *   3  The Season Standings CSV, through the REAL Admin → Data button handler,
 *      agrees with the Standings page (golden + the whole matrix).
 *   4  The email digest's season block agrees with the Standings page (golden +
 *      the whole matrix); [4b] it is grouping-AWARE like the page (SB-19b): a
 *      fully final 2-part week is ONE weekly W/L, an unfinished one none yet;
 *      [4c] on a split week its weekly winner/loser LINES are Weekly History's
 *      (the real renderLeaderboard() row): the pooled pair once every part is
 *      final, "In progress" until then (SB-19b follow-up, same date).
 *   5  One source of truth — the predicate's truth table, and a deny-by-default
 *      tripwire on any other inline `showInHistory !== false` rule in app.js,
 *      with canaries proving the scan can fail.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / localStorage stubs (eptest.mjs's shape) ──────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const els = new Map();
let lastCreated = null;
function mkEl(id) {
  const e = {
    id, _html: '', _listeners: {}, dataset: {}, style: {}, parentNode: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild(c) { if (c && typeof c === 'object') c.parentNode = this; return c; },
    removeChild(c) { if (c && typeof c === 'object') c.parentNode = null; return c; },
    remove() {}, click() {}, setAttribute() {}, removeAttribute() {},
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollTo() {}, focus() {},
  };
  return e;
}
function register(id) { const e = mkEl(id); els.set(id, e); return e; }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => els.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => (lastCreated = mkEl('tmp')),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild(c) { if (c && typeof c === 'object') c.parentNode = this; return c; }, removeChild(c) { if (c) c.parentNode = null; return c; }, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in standingscopetest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] standingscopetest.mjs — SB-19 standings week scope\n`);

const storage = await import('./js/storage.js');
const scoring = await import('./js/scoring.js');
const app     = await import('./js/app.js');

const { setBackendMode } = storage;
const { calculateSeasonStandings } = scoring;
const { seasonStandingsRows, buildWeeklySummary, bindCommEventListeners } = app;

setBackendMode('local');

// ── Fixture ────────────────────────────────────────────────────────────────
const PLAYERS = [
  { playerId: 'p_a', displayName: 'Alpha',   initials: 'AA', active: true,  preferences: {} },
  { playerId: 'p_b', displayName: 'Bravo',   initials: 'BB', active: true,  preferences: {} },
  { playerId: 'p_c', displayName: 'Charlie', initials: 'CC', active: true,  preferences: {} },
  { playerId: 'p_x', displayName: 'Xray',    initials: 'XX', active: false, preferences: {} },
];

function mkWeek(over) {
  return {
    season: 2026, status: 'final', dataSourceMode: 'live', showInHistory: true,
    startDate: '2026-09-05', endDate: '2026-09-06', name: null,
    picksOpenAt: null, picksLockAt: null, tiebreakerQuestion: null,
    actualTiebreakerValue: null, blurb: null,
    ...over,
  };
}
/** One result row. `w`/`l` are weighted; raw counts equal them (no multipliers). */
function R(weekId, playerId, w, l, flag = '') {
  return {
    weekId, playerId, correctPicks: w, incorrectPicks: l, correctCount: w, incorrectCount: l,
    noDecisions: 0, rank: 0, isWinner: flag === 'W', isLoser: flag === 'L',
    tiebreakerGuess: null, tiebreakerDelta: null, wonByTiebreaker: false,
  };
}

// Counted weeks: w1 (live, shown), w2 (manual, showInHistory ABSENT -> shown),
// w_null (showInHistory null, dataSourceMode absent -> shown: the rule is
// `!== false` / `!== 'demo'`, not truthiness).
const w1     = mkWeek({ weekId: 'w1', weekNumber: 1 });
const w2     = (() => { const w = mkWeek({ weekId: 'w2', weekNumber: 2, dataSourceMode: 'manual' }); delete w.showInHistory; return w; })();
const w_null = (() => { const w = mkWeek({ weekId: 'w_null', weekNumber: 5, showInHistory: null }); delete w.dataSourceMode; return w; })();
// Excluded weeks.
const w_demo = mkWeek({ weekId: 'w_demo', weekNumber: 3, dataSourceMode: 'demo' });
const w_hid  = mkWeek({ weekId: 'w_hid',  weekNumber: 4, showInHistory: false });
// 'w_gone' has result rows but no week record (deleted week).

const RESULTS = {
  w1:     [R('w1', 'p_a', 6, 4, 'W'),  R('w1', 'p_b', 5, 5),       R('w1', 'p_c', 3, 7, 'L')],
  w2:     [R('w2', 'p_b', 7, 3, 'W'),  R('w2', 'p_a', 5, 5),       R('w2', 'p_c', 4, 6, 'L')],
  w_null: [R('w_null', 'p_a', 2, 1, 'W'), R('w_null', 'p_b', 1, 2), R('w_null', 'p_c', 1, 2, 'L')],
  w_demo: [R('w_demo', 'p_c', 10, 0, 'W'), R('w_demo', 'p_b', 5, 5), R('w_demo', 'p_a', 0, 10, 'L')],
  w_hid:  [R('w_hid', 'p_c', 9, 1, 'W'), R('w_hid', 'p_a', 5, 5),   R('w_hid', 'p_b', 1, 9, 'L')],
  w_gone: [R('w_gone', 'p_c', 8, 2, 'W'), R('w_gone', 'p_b', 5, 5), R('w_gone', 'p_a', 2, 8, 'L')],
};
const ALL_RESULTS = Object.values(RESULTS).flat();
const BASE_WEEKS = [w1, w2, w_demo, w_hid, w_null];

/** Write the fixture straight into the local store — every surface reads it through load(). */
function seed({ weeks = BASE_WEEKS, results = ALL_RESULTS } = {}) {
  store.set('cfbp_players', JSON.stringify(PLAYERS));
  store.set('cfbp_weeks', JSON.stringify(weeks));
  store.set('cfbp_results', JSON.stringify(results));
  store.set('cfbp_games', JSON.stringify([]));
  store.set('cfbp_picks', JSON.stringify([]));
  store.set('cfbp_obligations', JSON.stringify([]));
}
const ACTIVE = () => PLAYERS.filter(p => p.active);
const COUNTED = ['w1', 'w2', 'w_null'];
const countedResults = (extra = []) => ALL_RESULTS.filter(r => COUNTED.includes(r.weekId) || extra.includes(r.weekId));
const sig = rows => JSON.stringify(rows.map(s => [s.playerId, s.currentRank, s.totalCorrect, s.totalIncorrect, s.weeklyWins, s.weeklyLosses, s.winPct]));

// Hand-derived. Counted = w1 + w2 + w_null:
//   Alpha   6+5+2 = 13 correct, 4+5+1 = 10 incorrect, wins w1+w_null = 2, losses 0
//   Bravo   5+7+1 = 13,         5+3+2 = 10,           wins w2 = 1,       losses 0
//   Charlie 3+4+1 = 8,          7+6+2 = 15,           wins 0,            losses 3
// Alpha and Bravo tie on 13; net weekly W-L (+2 vs +1) puts Alpha first.
// winPct = round(correct / 23 * 1000) / 10: 13/23 -> 56.5, 8/23 -> 34.8.
const GOLDEN = [
  { playerId: 'p_a', displayName: 'Alpha',   currentRank: 1, totalCorrect: 13, totalIncorrect: 10, totalND: 0, weeklyWins: 2, weeklyLosses: 0, winPct: 56.5 },
  { playerId: 'p_b', displayName: 'Bravo',   currentRank: 2, totalCorrect: 13, totalIncorrect: 10, totalND: 0, weeklyWins: 1, weeklyLosses: 0, winPct: 56.5 },
  { playerId: 'p_c', displayName: 'Charlie', currentRank: 3, totalCorrect: 8,  totalIncorrect: 15, totalND: 0, weeklyWins: 0, weeklyLosses: 3, winPct: 34.8 },
];
const goldenSig = sig(GOLDEN);

/** The pre-fix seasonStandingsRows(), copied LITERALLY from fac4f83 js/app.js:7995–8003. */
function preFixSeasonStandingsRows() {
  const players = JSON.parse(store.get('cfbp_players')).filter(p => p.active);
  const allWeeksRaw = JSON.parse(store.get('cfbp_weeks'));
  const visibleWeekIds = new Set(allWeeksRaw.filter(w => w.showInHistory !== false && w.dataSourceMode !== 'demo').map(w => w.weekId));
  const allResults = JSON.parse(store.get('cfbp_results')).filter(r => visibleWeekIds.has(r.weekId));
  return calculateSeasonStandings(players, allResults, allWeeksRaw);
}

/** The 30-shape matrix: one extra week 'w_m' with its own results, in every shape. */
const SHOW_VALUES = [true, false, undefined, null, 0, 'false'];
const MODE_VALUES = ['live', 'manual', 'demo', undefined, 'DEMO'];
const M_RESULTS = [R('w_m', 'p_c', 7, 3, 'W'), R('w_m', 'p_a', 4, 6), R('w_m', 'p_b', 2, 8, 'L')];
function matrixShapes() {
  const out = [];
  for (const show of SHOW_VALUES) for (const mode of MODE_VALUES) {
    const w = mkWeek({ weekId: 'w_m', weekNumber: 6 });
    if (show === undefined) delete w.showInHistory; else w.showInHistory = show;
    if (mode === undefined) delete w.dataSourceMode; else w.dataSourceMode = mode;
    out.push({ label: `showInHistory=${JSON.stringify(show) ?? 'absent'}, dataSourceMode=${JSON.stringify(mode) ?? 'absent'}`, week: w,
      expectShown: show !== false && mode !== 'demo' });
  }
  return out;
}
function seedShape(shape) {
  seed({ weeks: [...BASE_WEEKS, shape.week], results: [...ALL_RESULTS, ...M_RESULTS] });
}

// ── Real-click CSV capture ─────────────────────────────────────────────────
// Drives the ACTUAL Admin → Data "Season Standings CSV" button: the real
// bindCommEventListeners() attaches the real handler to the button element,
// and the click runs the real export through the real downloadFile()/toCsv().
// Only Blob/URL are stubbed, to read the bytes back.
let capturedCsv = null;
globalThis.Blob = class { constructor(parts) { capturedCsv = parts.join(''); } };
if (!globalThis.URL) globalThis.URL = {};
globalThis.URL.createObjectURL = () => 'blob:standingscope';
globalThis.URL.revokeObjectURL = () => {};

let standingsBtn = null;
let bindError = null;
function bindExportButton() {
  els.clear();
  standingsBtn = register('export-standings-csv-btn');
  bindError = null;
  try {
    const week = JSON.parse(store.get('cfbp_weeks'))[0] || null;
    bindCommEventListeners(week, [], [], [], {}, JSON.parse(store.get('cfbp_weeks')));
  } catch (e) { bindError = e; }
}
function clickStandingsCsv() {
  capturedCsv = null; lastCreated = null;
  for (const fn of (standingsBtn?._listeners.click || [])) fn({ preventDefault() {}, target: standingsBtn });
  return capturedCsv;
}
/** CSV text -> array of rows (cells are plain in this fixture: no commas/quotes). */
const parseCsv = text => text.split('\r\n').map(l => l.split(','));
const CSV_HEADER = ['Rank', 'Player', 'Total Correct', 'Total Incorrect', 'Total No Decision', 'Weekly Wins', 'Weekly Losses', 'Win %'];
const csvRowsFor = standings => standings.map(s => [s.currentRank, s.displayName, s.totalCorrect, s.totalIncorrect, s.totalND, s.weeklyWins, s.weeklyLosses, s.winPct].map(String));

// ── Digest season block ────────────────────────────────────────────────────
function digestSeasonBlock(week) {
  const text = buildWeeklySummary(week);
  const i = text.indexOf('━━━ Season standings ━━━');
  if (i < 0) return null;
  return text.slice(i).split('\n').slice(1).filter(l => /^\s+\d+\.\s/.test(l));
}
/** The digest's own line format (js/app.js buildWeeklySummary), applied to given rows. */
const digestLinesFor = standings => standings.map(s =>
  `  ${String(s.currentRank).padStart(2)}. ${s.displayName.padEnd(18)} ${s.totalCorrect}–${s.totalIncorrect}  (${s.weeklyWins}W / ${s.weeklyLosses}L)`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('[0] Fixture checks…');
// ═════════════════════════════════════════════════════════════════════════════
{
  seed();
  assert(typeof seasonStandingsRows === 'function' && typeof buildWeeklySummary === 'function' && typeof bindCommEventListeners === 'function',
    'app.js exports seasonStandingsRows(), buildWeeklySummary() and bindCommEventListeners()');
  assert(storage.getWeeks().length === 5 && storage.getWeeklyResults().length === 18 && storage.getPlayers().length === 4,
    'the fixture is what every surface reads through load() (5 weeks, 18 result rows, 4 players)');
  bindExportButton();
  assert(bindError === null, `the real bindCommEventListeners() runs against the stub DOM${bindError ? ' — threw: ' + bindError.message : ''}`);
  assert((standingsBtn._listeners.click || []).length === 1, 'it attached exactly one click handler to #export-standings-csv-btn');
  const csv = clickStandingsCsv();
  assert(typeof csv === 'string' && csv.startsWith('Rank,Player,'), 'clicking it produced the standings CSV text through downloadFile()');
  assert(lastCreated?.download === 'standings_season.csv', `…downloaded as standings_season.csv (got ${lastCreated?.download})`);
  const block = digestSeasonBlock(w1);
  assert(Array.isArray(block) && block.length === 3, `buildWeeklySummary() prints a three-line season standings block (got ${JSON.stringify(block)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Positive controls — every excluded week WOULD change the standings…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const counted = sig(calculateSeasonStandings(ACTIVE(), countedResults(), BASE_WEEKS));
  assert(counted === goldenSig, 'the scorer over the counted weeks alone reproduces the hand-derived golden');
  for (const extra of ['w_demo', 'w_hid', 'w_gone']) {
    const withIt = sig(calculateSeasonStandings(ACTIVE(), countedResults([extra]), BASE_WEEKS));
    assert(withIt !== goldenSig, `counting ${extra}'s results WOULD change the standings — its exclusion is observable, not vacuous`);
  }
  // …and each through the Standings page's own function: lift the exclusion
  // on the week record and the page's rows really do move.
  seed({ weeks: BASE_WEEKS.map(w => w.weekId === 'w_demo' ? { ...w, dataSourceMode: 'live' } : w) });
  assert(sig(seasonStandingsRows()) !== goldenSig, 'control: w_demo flipped to live -> seasonStandingsRows() changes (the demo clause is what excludes it)');
  seed({ weeks: BASE_WEEKS.map(w => w.weekId === 'w_hid' ? { ...w, showInHistory: true } : w) });
  assert(sig(seasonStandingsRows()) !== goldenSig, 'control: w_hid flipped to shown -> seasonStandingsRows() changes (the history clause is what excludes it)');
  seed({ weeks: [...BASE_WEEKS, mkWeek({ weekId: 'w_gone', weekNumber: 7 })] });
  assert(sig(seasonStandingsRows()) !== goldenSig, 'control: w_gone given a week record -> seasonStandingsRows() changes (a deleted week is what excludes it)');
  // The digest and the CSV must therefore DIFFER from the golden when fed the excluded weeks.
  seed({ weeks: BASE_WEEKS.map(w => ({ ...w, dataSourceMode: 'live', showInHistory: true })) });
  bindExportButton();
  const allInCsv = parseCsv(clickStandingsCsv() || '').slice(1);
  assert(JSON.stringify(allInCsv) !== JSON.stringify(csvRowsFor(GOLDEN)), 'control: with every week made countable, the CSV is NOT the golden — the CSV comparison in [3] can fail');
  assert(JSON.stringify(digestSeasonBlock(w1)) !== JSON.stringify(digestLinesFor(GOLDEN)), 'control: with every week made countable, the digest is NOT the golden — the digest comparison in [4] can fail');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] seasonStandingsRows() — byte-identical to the pre-fix code…');
// ═════════════════════════════════════════════════════════════════════════════
{
  seed();
  const rows = seasonStandingsRows();
  assert(sig(rows) === goldenSig, `seasonStandingsRows() equals the hand-derived golden (got ${sig(rows)})`);
  assert(rows.every((r, i) => r.displayName === GOLDEN[i].displayName && r.totalND === GOLDEN[i].totalND),
    'display names and no-decision totals match the golden too');
  assert(JSON.stringify(rows) === JSON.stringify(preFixSeasonStandingsRows()),
    'seasonStandingsRows() is byte-identical (JSON) to the literal pre-fix code on the base fixture');
  assert(!rows.some(r => r.playerId === 'p_x'), 'the inactive player is not a row (unchanged)');
  let identical = 0, shapes = 0;
  const diverged = [];
  for (const shape of matrixShapes()) {
    shapes++;
    seedShape(shape);
    if (JSON.stringify(seasonStandingsRows()) === JSON.stringify(preFixSeasonStandingsRows())) identical++;
    else diverged.push(shape.label);
  }
  assert(shapes === 30 && identical === 30,
    `seasonStandingsRows() is byte-identical to the pre-fix code on all ${shapes} week shapes (${identical} identical; diverged: ${diverged.join(' ; ') || 'none'})`);
  // Non-vacuity: the matrix really exercises both outcomes.
  const shownCount = matrixShapes().filter(s => s.expectShown).length;
  assert(shownCount === 20, `the matrix covers both outcomes: 20 counted shapes, 10 excluded (got ${shownCount} counted)`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Season Standings CSV (the real Admin → Data button) agrees with the Standings page…');
// ═════════════════════════════════════════════════════════════════════════════
{
  seed();
  bindExportButton();
  const csv = clickStandingsCsv();
  const table = parseCsv(csv || '');
  assert(JSON.stringify(table[0]) === JSON.stringify(CSV_HEADER), 'the CSV header is unchanged');
  assert(JSON.stringify(table.slice(1)) === JSON.stringify(csvRowsFor(GOLDEN)),
    `the CSV body is exactly the Standings page's golden rows — no demo week, no hidden week, no deleted week (got ${JSON.stringify(table.slice(1))})`);
  assert(!/\b18\b/.test(table.slice(1).map(r => r[2]).join(',')),
    'no player shows w_demo\'s 10-0 haul (Charlie 18 / Bravo 18 is what the demo week produced pre-fix)');

  const disagree = [];
  for (const shape of matrixShapes()) {
    seedShape(shape);
    bindExportButton();
    const body = parseCsv(clickStandingsCsv() || '').slice(1);
    if (JSON.stringify(body) !== JSON.stringify(csvRowsFor(seasonStandingsRows()))) disagree.push(shape.label);
  }
  assert(disagree.length === 0, `the CSV equals seasonStandingsRows() on every one of the 30 week shapes (disagreed on: ${disagree.join(' ; ') || 'none'})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] The email digest\'s season block agrees with the Standings page…');
// ═════════════════════════════════════════════════════════════════════════════
{
  seed();
  assert(JSON.stringify(digestSeasonBlock(w1)) === JSON.stringify(digestLinesFor(GOLDEN)),
    `the digest's season block is exactly the golden — no demo, hidden or deleted week (got ${JSON.stringify(digestSeasonBlock(w1))})`);
  assert(JSON.stringify(digestSeasonBlock(w_demo)) === JSON.stringify(digestLinesFor(GOLDEN)),
    'even the DEMO week\'s own digest leaves the demo week out of the SEASON block');
  assert(JSON.stringify(digestSeasonBlock(w_hid)) === JSON.stringify(digestLinesFor(GOLDEN)),
    'even the HIDDEN week\'s own digest leaves the hidden week out of the SEASON block');

  const disagree = [];
  for (const shape of matrixShapes()) {
    seedShape(shape);
    if (JSON.stringify(digestSeasonBlock(w1)) !== JSON.stringify(digestLinesFor(seasonStandingsRows()))) disagree.push(shape.label);
  }
  assert(disagree.length === 0, `the digest equals seasonStandingsRows() on every one of the 30 week shapes (disagreed on: ${disagree.join(' ; ') || 'none'})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4b] …and its season block is grouping-AWARE, like the Standings page (SB-19b)…');
// ═════════════════════════════════════════════════════════════════════════════
// RE-DERIVED 2026-10-01 (SB-19b). This section used to pin the OPPOSITE: "the
// digest still uses the documented 2-arg, grouping-unaware call" — Drew's
// UN-118/UN-125 scope ruling had held the digest's grouping until real
// split-week data existed. It exists now (live week w2026_1 is Part 1/2), and
// on it the digest showed two weekly W/L where the Standings tab shows one.
// Drew, 2026-10-01: "agree with weekly email" — the digest matches the
// Standings tab. So the digest's season block IS the page's rows.
{
  // A two-part competitive week (one groupId). Part A: Alpha wins. Part B:
  // Bravo wins. Pooled: Bravo 9 vs Alpha 8 -> ONE group win, Bravo's, and ONE
  // group loss, Charlie's (1 vs 8 vs 9).
  const gA = mkWeek({ weekId: 'g_a', weekNumber: 8, groupId: 'grp8' });
  const gB = mkWeek({ weekId: 'g_b', weekNumber: 8, groupId: 'grp8', startDate: '2026-09-07', endDate: '2026-09-07' });
  const gRes = [
    R('g_a', 'p_a', 6, 1, 'W'), R('g_a', 'p_b', 4, 3), R('g_a', 'p_c', 1, 6, 'L'),
    R('g_b', 'p_b', 5, 0, 'W'), R('g_b', 'p_a', 2, 3), R('g_b', 'p_c', 0, 5, 'L'),
  ];
  const weeks = [...BASE_WEEKS, gA, gB];
  const results = [...ALL_RESULTS, ...gRes];

  // (i) FULLY FINAL: both parts have their stored results.
  seed({ weeks, results });
  const filtered = results.filter(r => [...COUNTED, 'g_a', 'g_b'].includes(r.weekId));
  const twoArg = calculateSeasonStandings(ACTIVE(), filtered);
  const threeArg = calculateSeasonStandings(ACTIVE(), filtered, weeks);
  assert(sig(twoArg) !== sig(threeArg), 'control: on this fixture the 2-arg (per-record) and 3-arg (grouped) scorers really disagree');
  assert(sig(seasonStandingsRows()) === sig(threeArg), 'control: the Standings page (seasonStandingsRows()) is the grouped, 3-arg reading of this fixture');
  // Hand-derived, grouped. Counted base golden + the pooled split week:
  //   Bravo   13+4+5 = 22 correct, 10+3+0 = 13 incorrect, wins 1 (w2) + 1 (grp8) = 2, losses 0
  //   Alpha   13+6+2 = 21,         10+1+3 = 14,           wins 2 (w1, w_null) + 0  = 2, losses 0
  //   Charlie  8+1+0 =  9,         15+6+5 = 26,           wins 0,                       losses 3 + 1 (grp8) = 4
  // The grouping-UNAWARE reading gives Alpha 3W (Part A's win counted on its
  // own) and Charlie 5L (both parts' losses) — the double count Drew saw.
  const GROUPED_LINES = [
    `   1. ${'Bravo'.padEnd(18)} 22–13  (2W / 0L)`,
    `   2. ${'Alpha'.padEnd(18)} 21–14  (2W / 0L)`,
    `   3. ${'Charlie'.padEnd(18)} 9–26  (0W / 4L)`,
  ];
  const UNGROUPED_LINES = [
    `   1. ${'Bravo'.padEnd(18)} 22–13  (2W / 0L)`,
    `   2. ${'Alpha'.padEnd(18)} 21–14  (3W / 0L)`,
    `   3. ${'Charlie'.padEnd(18)} 9–26  (0W / 5L)`,
  ];
  assert(JSON.stringify(digestLinesFor(threeArg)) === JSON.stringify(GROUPED_LINES), 'fixture: the grouped reading renders the hand-derived lines (one split week = one W, one L)');
  assert(JSON.stringify(digestLinesFor(twoArg)) === JSON.stringify(UNGROUPED_LINES), 'fixture: the ungrouped reading renders the double-counted lines (Alpha 3W, Charlie 5L)');
  const digestFinal = digestSeasonBlock(gB);
  assert(JSON.stringify(digestFinal) === JSON.stringify(digestLinesFor(seasonStandingsRows())),
    `a fully final 2-part week: the digest's season block EQUALS the Standings page (got ${JSON.stringify(digestFinal)})`);
  assert(JSON.stringify(digestFinal) === JSON.stringify(GROUPED_LINES),
    'a fully final 2-part week: the digest counts it as ONE weekly W/L — Bravo\'s pooled win, Charlie\'s pooled loss (hand-derived)');
  assert(JSON.stringify(digestFinal) !== JSON.stringify(UNGROUPED_LINES),
    'a fully final 2-part week: the digest no longer counts each part as its own weekly W/L (Alpha 3W / Charlie 5L is the defect)');
  assert(JSON.stringify(digestSeasonBlock(w1)) === JSON.stringify(digestFinal),
    'which week\'s digest is built does not change the SEASON block (w1\'s digest shows the same grouped standings)');

  // (ii) NOT YET FULLY FINAL: Part B has no stored results. The page counts
  // Part A's totals but no weekly W/L for the group until every part is final
  // (scoring.js, DI-126d's gate); the digest must say the same.
  const partial = results.filter(r => r.weekId !== 'g_b');
  seed({ weeks, results: partial });
  const partialTwoArg = calculateSeasonStandings(ACTIVE(), partial.filter(r => [...COUNTED, 'g_a'].includes(r.weekId)));
  assert(sig(seasonStandingsRows()) !== sig(partialTwoArg), 'control: with Part B unfinished, the page and the 2-arg reading really disagree (Part A\'s lone W/L)');
  assert(JSON.stringify(digestSeasonBlock(gA)) === JSON.stringify(digestLinesFor(seasonStandingsRows())),
    'a split week with one part still unfinished: the digest\'s season block EQUALS the Standings page (no weekly W/L for the group yet)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4c] …and on a split week its weekly winner/loser lines are Weekly History\'s (SB-19b follow-up)…');
// ═════════════════════════════════════════════════════════════════════════════
// Drew, 2026-10-01: "agree with weekly email" — the email matches the app. On a
// split week the digest used to name THIS PART's own winner and loser (the
// per-part calculateWeeklyResults() it builds the picks table from), while
// Weekly History names the POOLED group's winner and loser once every part is
// final, and "In progress" until then. The digest now reads History's own
// per-group result (weeklyHistoryResult(), js/app.js) — compared here against
// the REAL renderLeaderboard() markup, not a re-derivation.
{
  const dm = await import('./js/data-model.js');
  const hA = mkWeek({ weekId: 'h_a', weekNumber: 9, groupId: 'grp9' });
  const hB = mkWeek({ weekId: 'h_b', weekNumber: 9, groupId: 'grp9', startDate: '2026-09-07', endDate: '2026-09-07' });
  /** Home wins 21–10 against a 1.5 line, so the home side covers. A live game has no result yet. */
  const G = (gameId, weekId, status = 'final') => ({ gameId, weekId, homeTeam: 'H' + gameId, awayTeam: 'A' + gameId, spread: -1.5, lockedSpread: -1.5,
    homeScore: status === 'final' ? 21 : 7, awayScore: status === 'final' ? 10 : 7, status, multiplier: 1 });
  /** One pick per (player, game): 'H' = the covering home side, 'A' = the away side. */
  const P = (weekId, gameId, playerId, side) => ({ pickId: `pk_${gameId}_${playerId}`, weekId, gameId, playerId, selectedTeam: (side === 'H' ? 'H' : 'A') + gameId });
  // Part 1: Alpha 3–0, Bravo 2–1, Charlie 0–3  → this part alone: Alpha wins, Charlie loses.
  // Part 2: Bravo 3–0, Charlie 2–1, Alpha 0–3  → this part alone: Bravo wins, Alpha loses.
  // Pooled: Bravo 5, Alpha 3, Charlie 2        → the WEEK: Bravo wins, Charlie loses (hand-derived).
  const picksFor = (weekId, ids, sides) => Object.entries(sides).flatMap(([pid, s]) => ids.map((g, i) => P(weekId, g, pid, s[i])));
  const PICKS_A = picksFor('h_a', ['ha1', 'ha2', 'ha3'], { p_a: 'HHH', p_b: 'HHA', p_c: 'AAA' });
  const PICKS_B = picksFor('h_b', ['hb1', 'hb2', 'hb3'], { p_b: 'HHH', p_c: 'HHA', p_a: 'AAA' });
  const RES_A = [R('h_a', 'p_a', 3, 0, 'W'), R('h_a', 'p_b', 2, 1), R('h_a', 'p_c', 0, 3, 'L')];
  const RES_B = [R('h_b', 'p_b', 3, 0, 'W'), R('h_b', 'p_c', 2, 1), R('h_b', 'p_a', 0, 3, 'L')];
  const seedSplit = ({ partBFinal }) => {
    const b = partBFinal ? hB : { ...hB, status: 'live' };
    seed({ weeks: [...BASE_WEEKS, hA, b], results: [...ALL_RESULTS, ...RES_A, ...(partBFinal ? RES_B : [])] });
    store.set('cfbp_games', JSON.stringify([G('ha1', 'h_a'), G('ha2', 'h_a'), G('ha3', 'h_a'),
      ...['hb1', 'hb2', 'hb3'].map(g => G(g, 'h_b', partBFinal ? 'final' : 'live'))]));
    store.set('cfbp_picks', JSON.stringify([...PICKS_A, ...PICKS_B]));
    return b;
  };
  const LABEL = dm.formatWeekGroupLabel([hA, hB]);
  /** Weekly History's row for the split week, read from the REAL renderLeaderboard() markup. */
  const historyRow = () => {
    const page = register('page-leaderboard');
    let threw = null;
    try { app.renderLeaderboard(); } catch (e) { threw = e; }
    const g = page._html.split('<tbody class="stand-wk-group">').slice(1).find(t => t.includes(`>${LABEL}</span>`));
    if (!g) return { found: false, threw: threw && threw.message };
    const names = [...g.matchAll(/<td class="stand-who"><span class="stand-name-text player-name-cell">([^<]*)<\/span>/g)].map(m => m[1]);
    const shown = /<span class="stand-wk-name"[^>]*>([^<]*)<\/span>/.exec(g);
    return { found: true, label: shown ? shown[1] : null, winner: names[0] || null, loser: names[1] || null, inProgress: /<td class="stand-inprog"[^>]*>In progress<\/td>/.test(g) };
  };
  /** The digest's weekly winner/loser lines — value and (split week) label — and any 🏆/💀 marker in its picks table. */
  const digestFor = (week) => {
    const text = buildWeeklySummary(week);
    const line = re => { const m = re.exec(text); return m ? { label: m[1] ?? null, value: m[2] } : { label: null, value: null }; };
    const table = text.slice(text.indexOf('━━━ Final picks ━━━'), text.indexOf('\n\n', text.indexOf('━━━ Final picks ━━━')));
    const w = line(/^🏆 Weekly winner(?: — (.+?))?: (.*)$/m), l = line(/^💀 Weekly loser(?: — (.+?))?: (.*)$/m);
    return { winner: w.value, loser: l.value, winnerLabel: w.label, loserLabel: l.label, tableMarkers: /🏆|💀/.test(table), tableRows: table.split('\n').length - 1,
      table, text };
  };

  // (i) EVERY PART FINAL.
  seedSplit({ partBFinal: true });
  assert(LABEL.length > 0 && storage.getGames('h_a').length === 3 && storage.getPicks('h_b').length === 9,
    `fixture: a 2-part group "${LABEL}" with 3 final games and 9 picks per part`);
  const partA = buildWeeklySummary(hA), partB = buildWeeklySummary(hB);
  assert(/^ {2} 1\. Alpha {14}3–0/m.test(partA) && /^ {2} 1\. Bravo {14}3–0/m.test(partB),
    'control: each part\'s own picks table really has a DIFFERENT leader (Part 1 Alpha 3–0, Part 2 Bravo 3–0) — the per-part answer is observable');
  const hFinal = historyRow();
  assert(hFinal.found && hFinal.winner === 'Bravo' && hFinal.loser === 'Charlie' && !hFinal.inProgress,
    `fixture: Weekly History shows the split week ONCE, Bravo over Charlie — the pooled 5 / 3 / 2, hand-derived (got ${JSON.stringify(hFinal)})`);
  for (const [label, wk] of [['Part 1', hA], ['Part 2', hB]]) {
    const d = digestFor(wk);
    assert(d.winner === hFinal.winner && d.loser === hFinal.loser,
      `every part final — ${label}'s digest names Weekly History's winner and loser (${hFinal.winner} / ${hFinal.loser}), not the part's own (got ${d.winner} / ${d.loser})`);
    assert(d.tableRows === 3 && !d.tableMarkers,
      `every part final — ${label}'s per-part picks table marks no 🏆/💀 of its own (History never names a part's winner), its three rows kept`);
  }
  assert(buildWeeklySummary(hA).split('\n').filter(l => /^(🏆|💀) Weekly /.test(l)).length === 2,
    'every part final — the winner and the loser are each named exactly ONCE');
  // N2 (bundle review, coordinator-approved copy, 2026-10-01) — the two lines carry the week label History shows for
  // the group (formatWeekGroupLabel(), the row's own "Week" cell), so a reader of Part 1's email sees the result is the WEEK's.
  {
    const d = digestFor(hA);
    assert(!!hFinal.label && d.winnerLabel === hFinal.label && d.loserLabel === hFinal.label,
      `every part final — both lines carry the label Weekly History shows for the week ("${hFinal.label}"): got "${d.winnerLabel}" / "${d.loserLabel}"`);
    assert(d.text.includes(`🏆 Weekly winner — ${hFinal.label}: Bravo\n`) && d.text.includes(`💀 Weekly loser — ${hFinal.label}: Charlie`),
      `every part final — the exact lines read "🏆 Weekly winner — ${hFinal.label}: Bravo" and "💀 Weekly loser — ${hFinal.label}: Charlie"`);
  }

  // (ii) ONE PART STILL UNFINISHED (Part 2 live, no stored result yet).
  const bLive = seedSplit({ partBFinal: false });
  const hLive = historyRow();
  assert(hLive.found && hLive.inProgress && hLive.winner === null && hLive.loser === null,
    `fixture: with Part 2 still live, Weekly History reads "In progress" for the week and names nobody (got ${JSON.stringify(hLive)})`);
  for (const [label, wk] of [['Part 1 (final)', hA], ['Part 2 (live)', bLive]]) {
    const d = digestFor(wk);
    assert(d.winner === 'In progress' && d.loser === 'In progress',
      `one part unfinished — ${label}'s digest says "In progress" where History does, and names nobody (got ${d.winner} / ${d.loser})`);
    assert(!d.tableMarkers, `one part unfinished — ${label}'s per-part picks table marks no 🏆/💀 of its own`);
    assert(d.winnerLabel === hLive.label && d.loserLabel === hLive.label,
      `one part unfinished — ${label}'s "In progress" lines carry History's week label too ("${hLive.label}"; got "${d.winnerLabel}" / "${d.loserLabel}")`);
  }

  // (iii) N1 (bundle review, 2026-10-01) — a SINGLE-PART week is untouched by all of the above. Without these, flipping
  // the split-week test (`members.length > 1`) to `>= 1` survived every suite: it would strip a normal week's own
  // 🏆/💀 and print "In progress" on every open week's email.
  {
    const s1 = mkWeek({ weekId: 's_1', weekNumber: 10, startDate: '2026-09-12', endDate: '2026-09-12' });
    const s2 = mkWeek({ weekId: 's_2', weekNumber: 11, status: 'open', startDate: '2026-09-19', endDate: '2026-09-19' });
    // s_1 (final): Alpha 3–0, Bravo 1–2, Charlie 0–3 → its OWN winner Alpha, loser Charlie. s_2 (open): nothing graded yet.
    seed({ weeks: [...BASE_WEEKS, s1, s2], results: [...ALL_RESULTS, R('s_1', 'p_a', 3, 0, 'W'), R('s_1', 'p_b', 1, 2), R('s_1', 'p_c', 0, 3, 'L')] });
    store.set('cfbp_games', JSON.stringify([G('s1a', 's_1'), G('s1b', 's_1'), G('s1c', 's_1'), G('s2a', 's_2', 'scheduled'), G('s2b', 's_2', 'scheduled')]));
    store.set('cfbp_picks', JSON.stringify([...picksFor('s_1', ['s1a', 's1b', 's1c'], { p_a: 'HHH', p_b: 'HAA', p_c: 'AAA' }),
      ...picksFor('s_2', ['s2a', 's2b'], { p_a: 'HH', p_b: 'HA', p_c: 'AA' })]));
    const one = digestFor(s1);
    assert(one.winner === 'Alpha' && one.loser === 'Charlie' && one.winnerLabel === null && one.loserLabel === null
        && /^🏆 Weekly winner: Alpha$/m.test(one.text) && /^💀 Weekly loser: Charlie$/m.test(one.text),
      `a FINAL single-part week names its OWN winner and loser, with no group label ("🏆 Weekly winner: Alpha" / "💀 Weekly loser: Charlie"; got ${one.winner}${one.winnerLabel ? ' [' + one.winnerLabel + ']' : ''} / ${one.loser})`);
    assert(/^ {2} 1\. Alpha .* 🏆$/m.test(one.table) && /^ {2} 3\. Charlie .* 💀$/m.test(one.table),
      'a FINAL single-part week\'s picks table still marks its own 🏆 (Alpha) and 💀 (Charlie)');
    const open = digestFor(s2);
    assert(!/In progress/.test(open.text) && open.winner === null && open.loser === null && !open.tableMarkers,
      `an OPEN single-part week's digest prints no "In progress" line and no weekly winner/loser (got ${open.winner} / ${open.loser})`);
  }

  // (iv) N2 (v0.29.0 release review, 2026-10-02) — a FINAL single-part week whose stored winner or loser has since LEFT
  // (self-leave ships in v0.29.0, SP-53). Weekly History reads the week's STORED rows and marks the person "(left)"; the digest
  // used to RECOMPUTE over the active roster only, so it named someone else — while its own obligations block still named the
  // person who left. The digest's weekly lines (and its picks-table marks) now come from History's own result for every week.
  {
    const s3 = mkWeek({ weekId: 's_3', weekNumber: 12, startDate: '2026-09-26', endDate: '2026-09-26' });
    const s4 = mkWeek({ weekId: 's_4', weekNumber: 13, startDate: '2026-10-03', endDate: '2026-10-03' });
    const s5 = mkWeek({ weekId: 's_5', weekNumber: 14, status: 'live', startDate: '2026-10-10', endDate: '2026-10-10' });
    const named = (row, displayName) => ({ ...row, displayName });   // finalize's stored rows carry the name
    // s_3: Xray (since left) won 3–0 and Charlie lost 0–3; over today's ACTIVE roster alone Alpha (2–1) would "win".
    // s_4: Alpha won 3–0 and Xray (since left) lost 0–3; over the active roster alone Charlie (1–2) would "lose".
    // s_5: live, every game final, not finalized yet — no stored rows (results are written only by finalize).
    seed({ weeks: [...BASE_WEEKS, s3, s4, s5], results: [...ALL_RESULTS,
      named(R('s_3', 'p_x', 3, 0, 'W'), 'Xray'), named(R('s_3', 'p_a', 2, 1), 'Alpha'), named(R('s_3', 'p_b', 1, 2), 'Bravo'), named(R('s_3', 'p_c', 0, 3, 'L'), 'Charlie'),
      named(R('s_4', 'p_a', 3, 0, 'W'), 'Alpha'), named(R('s_4', 'p_b', 2, 1), 'Bravo'), named(R('s_4', 'p_c', 1, 2), 'Charlie'), named(R('s_4', 'p_x', 0, 3, 'L'), 'Xray')] });
    store.set('cfbp_games', JSON.stringify(['s3a', 's3b', 's3c'].map(g => G(g, 's_3')).concat(['s4a', 's4b', 's4c'].map(g => G(g, 's_4')), ['s5a', 's5b', 's5c'].map(g => G(g, 's_5')))));
    store.set('cfbp_picks', JSON.stringify([
      ...picksFor('s_3', ['s3a', 's3b', 's3c'], { p_x: 'HHH', p_a: 'HHA', p_b: 'HAA', p_c: 'AAA' }),
      ...picksFor('s_4', ['s4a', 's4b', 's4c'], { p_a: 'HHH', p_b: 'HHA', p_c: 'HAA', p_x: 'AAA' }),
      ...picksFor('s_5', ['s5a', 's5b', 's5c'], { p_a: 'HHH', p_b: 'HHA', p_c: 'AAA' })]));
    store.set('cfbp_obligations', JSON.stringify([{ obligationId: 'ob_s3', weekId: 's_3', type: 'weekly', payerPlayerId: 'p_c', recipientPlayerId: 'p_x',
      amountOrPrize: 'a tall boy', status: 'unpaid', createdAt: '2026-09-27T00:00:00.000Z' }]));
    /** History's row for one week, from the REAL renderLeaderboard() markup: the two names and their captions. */
    const historyFor = (wk) => {
      const page = register('page-leaderboard');
      try { app.renderLeaderboard(); } catch { /* reported by the found check */ }
      const label = dm.formatWeekGroupLabel([wk]).split(' — ')[0];   // History's week cell shows the name; the dates sit in their own sub-span
      const g = page._html.split('<tbody class="stand-wk-group">').slice(1).find(t => t.includes(`>${label}</span>`));
      if (!g) return { found: false, label };
      const who = [...g.matchAll(/<td class="stand-who"><span class="stand-name-text player-name-cell">([^<]*)<\/span>(?:<span class="stand-sub">([^<]*)<\/span>)?/g)];
      return { found: true, label, winner: who[0]?.[1] ?? null, winnerSub: who[0]?.[2] ?? '', loser: who[1]?.[1] ?? null, loserSub: who[1]?.[2] ?? '' };
    };
    const h3 = historyFor(s3), h4 = historyFor(s4);
    assert(h3.found && h3.winner === 'Xray' && h3.winnerSub === '(left)' && h3.loser === 'Charlie' && h3.loserSub === '',
      `fixture: Weekly History names s_3's STORED winner Xray, marked "(left)", and loser Charlie (got ${JSON.stringify(h3)})`);
    assert(h4.found && h4.winner === 'Alpha' && h4.loser === 'Xray' && h4.loserSub === '(left)',
      `fixture: Weekly History names s_4's STORED loser Xray, marked "(left)" (got ${JSON.stringify(h4)})`);
    const d3 = digestFor(s3), d4 = digestFor(s4);
    assert(/^🏆 Weekly winner: Xray \(left\)$/m.test(d3.text) && /^💀 Weekly loser: Charlie$/m.test(d3.text),
      `a final single week whose WINNER has left: the digest names History's winner, "🏆 Weekly winner: Xray (left)", not the active-roster recompute (got ${d3.winner} / ${d3.loser})`);
    assert(/^ {2}Charlie owes Xray: a tall boy \[unpaid\]$/m.test(d3.text),
      '…and its obligations block names the same two people (Charlie owes Xray) — the email no longer contradicts itself');
    assert(!/🏆/.test(d3.table) && /^ {2} 3\. Charlie .* 💀$/m.test(d3.table),
      `…and its picks table (active players) marks no 🏆 on anyone — the winner is not in it — and 💀 on Charlie (table: ${JSON.stringify(d3.table)})`);
    assert(/^🏆 Weekly winner: Alpha$/m.test(d4.text) && /^💀 Weekly loser: Xray \(left\)$/m.test(d4.text) && !/💀/.test(d4.table) && /^ {2} 1\. Alpha .* 🏆$/m.test(d4.table),
      `a final single week whose LOSER has left: "💀 Weekly loser: Xray (left)", and the table marks no 💀 on Charlie (got ${d4.winner} / ${d4.loser})`);
    const d5 = digestFor(s5);
    assert(/^🏆 Weekly winner: Alpha$/m.test(d5.text) && /^💀 Weekly loser: Charlie$/m.test(d5.text) && !/In progress/.test(d5.text),
      `a single week with every game final but NOT yet finalized (no stored rows): the digest keeps today's computed lines (got ${d5.winner} / ${d5.loser})`);
    // s_6: FINAL but hidden from History (showInHistory false): History lists no row for it, so the digest keeps today's computed lines rather than going blank.
    const s6 = mkWeek({ weekId: 's_6', weekNumber: 15, showInHistory: false, startDate: '2026-10-17', endDate: '2026-10-17' });
    seed({ weeks: [...BASE_WEEKS, s6], results: [...ALL_RESULTS, named(R('s_6', 'p_a', 3, 0, 'W'), 'Alpha'), named(R('s_6', 'p_b', 2, 1), 'Bravo'), named(R('s_6', 'p_c', 0, 3, 'L'), 'Charlie')] });
    store.set('cfbp_games', JSON.stringify(['s6a', 's6b', 's6c'].map(g => G(g, 's_6'))));
    store.set('cfbp_picks', JSON.stringify(picksFor('s_6', ['s6a', 's6b', 's6c'], { p_a: 'HHH', p_b: 'HHA', p_c: 'AAA' })));
    const d6 = digestFor(s6);
    assert(/^🏆 Weekly winner: Alpha$/m.test(d6.text) && /^💀 Weekly loser: Charlie$/m.test(d6.text) && /^ {2} 1\. Alpha .* 🏆$/m.test(d6.table),
      `a FINAL week hidden from History still names its winner and loser, and marks them in its table (got ${d6.winner} / ${d6.loser})`);
  }

  // Structural — the digest READS History's helper; it does not re-derive the group result.
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const at = appSrc.search(/export function buildWeeklySummary\s*\(/);
  const dig = at < 0 ? '' : appSrc.slice(at, at + appSrc.slice(at).indexOf('\n}\n'));
  const digCode = dig.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\s\/\/\s.*$/, '')).join('\n');
  assert(typeof app.weeklyHistoryResult === 'function' && /\bweeklyHistoryResult\(/.test(digCode) && !/calculateGroupWeeklyResults\(|weeksInGroup\(/.test(digCode),
    'buildWeeklySummary() calls weeklyHistoryResult() — Weekly History\'s own per-group result — and computes no group result of its own (in code, not a comment)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] One source of truth — isWeekShownInStandings()…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const pred = app.isWeekShownInStandings;
  assert(typeof pred === 'function', 'app.js exports isWeekShownInStandings(week) — the one standings week-scope predicate');
  if (typeof pred === 'function') {
    const wrong = matrixShapes().filter(s => pred(s.week) !== s.expectShown).map(s => s.label);
    assert(wrong.length === 0, `its truth table is exactly \`showInHistory !== false && dataSourceMode !== 'demo'\` on all 30 shapes (wrong: ${wrong.join(' ; ') || 'none'})`);
    assert(pred(w1) === true && pred(w_demo) === false && pred(w_hid) === false, 'spot check: live/shown -> true; demo -> false; hidden -> false');
  }

  // Deny-by-default tripwire: every code (non-comment) occurrence of a
  // `showInHistory !== false` rule in app.js must be one of the KNOWN,
  // NAMED uses below. A new inline standings filter — the shape that drifted
  // three times — is caught here and must use the predicate instead.
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(appSrc.length > 100000 && /export function seasonStandingsRows\s*\(/.test(appSrc),
    `anchor: js/app.js was actually read and is the real file (${appSrc.length} chars)`);
  const ALLOWED = [
    // the predicate itself
    { name: 'isWeekShownInStandings() body', re: /return week\.showInHistory !== false && week\.dataSourceMode !== 'demo';/ },
    // NOT standings: the Picks-tab week browser (drafts out, demo commissioner-only)
    { name: 'picksNavWeeks() week browser', re: /getWeeks\(\)\.filter\(w => w\.showInHistory !== false && w\.status !== WEEK_STATUS\.DRAFT &&/ },
    // NOT a filter: the admin "Show in history" checkbox's checked state
    { name: 'admin show-history checkbox', re: /\$\{week\.showInHistory!==false\?'checked':''\}/ },
    // NOT a filter: the raw All-Weekly-Results audit CSV's yes/no column
    { name: 'all-weekly-results CSV column', re: /w\?\(w\.showInHistory!==false\?'yes':'no'\):''/ },
  ];
  const scan = src => src.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => /showInHistory\s*!==?\s*false/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter(({ l }) => !ALLOWED.some(a => a.re.test(l)));
  const strays = scan(appSrc);
  assert(strays.length === 0,
    `no inline \`showInHistory !== false\` rule in app.js outside the named allow-list — standings consumers read isWeekShownInStandings() (strays: ${JSON.stringify(strays.map(s => `${s.n}: ${s.l.trim()}`))})`);
  for (const a of ALLOWED) {
    assert(a.re.test(appSrc), `allow-list anchor still present (an entry that matches nothing is a dead exemption): ${a.name}`);
  }
  // Canaries — the scan is not vacuous, and comments don't trip it.
  assert(scan("  const visibleWeekIds=new Set(allWeeksRaw.filter(w=>w.showInHistory!==false).map(w=>w.weekId));").length === 1,
    'canary 1: the pre-fix CSV filter shape (history clause only) IS caught');
  assert(scan("  const ids = new Set(weeks.filter(w => w.showInHistory !== false && w.dataSourceMode !== 'demo').map(w => w.weekId));").length === 1,
    'canary 2: a correct-today inline copy of the full rule IS caught too — copies are what drift');
  assert(scan(" * (`showInHistory !== false && dataSourceMode !== 'demo'`)").length === 0,
    'canary 3: a doc-comment line mentioning the rule is NOT flagged');

  // The three named consumers read the predicate (or the page's own rows).
  const fnBody = name => {
    const at = appSrc.search(new RegExp(`(?:export )?function ${name}\\s*\\(`));
    if (at < 0) return '';
    const rest = appSrc.slice(at);
    return rest.slice(0, rest.indexOf('\n}\n'));
  };
  // CODE only — whole-line comments dropped and trailing ` // …` tails cut, so
  // a comment that merely NAMES the predicate cannot satisfy these checks.
  const code = s => s.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map(l => l.replace(/\s\/\/\s.*$/, ''))
    .join('\n');
  const USES_PRED = /\.filter\(isWeekShownInStandings\)/;
  const ssr = fnBody('seasonStandingsRows');
  const csvFn = fnBody('exportStandingsCSV');
  const dig = fnBody('buildWeeklySummary');
  assert(ssr.length > 0 && csvFn.includes('standings_season.csv') && dig.includes('━━━ Season standings ━━━'),
    'anchor: seasonStandingsRows(), exportStandingsCSV() and buildWeeklySummary() located');
  assert(USES_PRED.test(code(ssr)), 'seasonStandingsRows() filters its weeks with isWeekShownInStandings (in code, not a comment)');
  assert(/seasonStandingsRows\(\)/.test(code(csvFn)) && !/calculateSeasonStandings\(|getWeeklyResults\(/.test(code(csvFn)),
    'exportStandingsCSV() renders seasonStandingsRows() — the Standings page\'s own rows — and reads/computes no results of its own');
  // RE-DERIVED 2026-10-01 (SB-19b, Drew: "agree with weekly email"). This used
  // to require the digest to filter its own weeks with the predicate; the
  // digest now renders the Standings page's own rows, so — exactly like the
  // CSV above — it must call seasonStandingsRows() and compute no season
  // standings of its own (a private calculateSeasonStandings() or
  // getWeeklyResults() read is how its scope and its grouping both drifted).
  assert(/seasonStandingsRows\(\)/.test(code(dig)) && !/calculateSeasonStandings\(|getWeeklyResults\(/.test(code(dig)),
    'buildWeeklySummary()\'s season block renders seasonStandingsRows() — the Standings page\'s own rows — and reads/computes no season results of its own');
  // Canary — the comment-stripper really strips: a body that only MENTIONS the
  // predicate in comments does not pass.
  assert(!USES_PRED.test(code("  // weeks go through .filter(isWeekShownInStandings) elsewhere\n  const x = 1; // .filter(isWeekShownInStandings)\n   * .filter(isWeekShownInStandings)")),
    'canary 4: a predicate named only in comments does NOT satisfy the usage check');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
