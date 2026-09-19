/**
 * CFB Pickems — ranktest.mjs
 * ==========================
 * Design Inputs — Set 1: Tiebreaker → Standings (Drew, approved 2026-09-02).
 *
 * Drew's report: "The rankings in the standings should be based off of the
 * delta tie breaker in the instance of a tie. Right now Kihoon is listed as
 * last, but Kevin has the L."
 *
 * Two rulings this whole file is built around:
 *   1. Extra Point is NOT a standings input, in any form.
 *   2. The tiebreaker has NO season aggregate — it is ONLY for intra-week
 *      tie breaking. calculateSeasonStandings() must never read
 *      tiebreakerDelta / tiebreakerGuess / actualTiebreakerValue.
 *
 * DI-A works precisely because it reads each player's WEEKLY win/loss
 * OUTCOMES (weeklyWins/weeklyLosses) — already computed by rankWeeklyResults()
 * from that week's own tiebreaker, which never leaves the week — never the
 * raw delta itself.
 *
 * Run:  node ranktest.mjs
 * Also: TZ=UTC node ranktest.mjs && TZ=America/Los_Angeles node ranktest.mjs
 *
 * SECTIONS
 *   1  DI-A — the reported Kihoon/Kevin case: a 2-way tie broken by the net
 *      weekly win/loss differential, not left arbitrary.
 *   2  DI-A — a three-or-more-way tie resolves via the SAME full-array
 *      comparator, not a pairwise reduction.
 *   3  DI-A — a fully exhausted tie (all three criteria equal) is an
 *      ACCEPTED residual: deterministic, never throws, never "fixed" further.
 *   4  DI-A + UN-118 — a grouped (multi-part) week's pooled win/loss
 *      contributes correctly to the tie-break, built on grouptest.mjs's own
 *      2-part-group fixture shape rather than a new one.
 *   5  [structural] TRIPWIRE — calculateSeasonStandings() never reads
 *      tiebreakerDelta/tiebreakerGuess/actualTiebreakerValue, with an anchor
 *      check that the scan actually found the function, and canaries proving
 *      the scan is neither vacuous nor fooled by an unrelated rename.
 *   6  winPct is still computed from RAW counts, unchanged by DI-A.
 *   7  DI-D end to end, driven through the REAL save-tb-btn click handler
 *      (not a direct second finalizeWeek() call) — a week finalized with no
 *      tiebreaker, tied, arbitrarily decided; a tiebreaker is then saved
 *      through the actual commissioner-panel button; the recorded outcome
 *      flips, is re-persisted, and the stale obligation is FLAGGED, never
 *      silently rewritten. Reuses the UN-126 collision shape (loadtest.mjs
 *      [54]) but triggers it via the NEW entry point.
 *   8  [additional, beyond the required 7] DI-E — the manual Finalize
 *      button's confirm() gate, mutation-tested against weekHasUnresolvedTie().
 *   9  [additional, beyond the required 7] DI-H end to end — the Data-tab
 *      "Recalculate All Finalized Weeks" button.
 */

import { readFile } from 'node:fs/promises';

// ═════════════════════════════════════════════════════════════════════════════
// DOM / localStorage stubs — same shape as gradetest.mjs's, with a
// toast-capturing addition on #toast-container so DI-D/DI-H's exact COPY
// branches can be asserted, not just their side effects.
// ═════════════════════════════════════════════════════════════════════════════
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
const selectorSets = new Map();

function makeEl(id) {
  const listeners = new Map();
  const e = {
    id,
    value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`ranktest: nothing bound to '${type}' on #${id}`);
      for (const fn of fns) fn({ target: e, ...ev });
    },
    _bound: type => (listeners.get(type) || []).length > 0,
  };
  return e;
}
function el(id) {
  if (!registry.has(id)) registry.set(id, makeEl(id));
  return registry.get(id);
}
function bySelector(sel) {
  if (typeof sel === 'string' && sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const set = selectorSets.get(sel);
  return set && set.length ? set[0] : null;
}
function resetDom() { registry.clear(); selectorSets.clear(); }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__detached__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in ranktest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// confirm() is a SPY, not a blind stub — records every call and its message,
// and its return value is controllable per-call so both the "Cancel" and
// "OK" branches of DI-E's confirm() are exercised, not just "always OK".
let confirmQueue = [];
let confirmCalls = [];
globalThis.confirm = (msg) => { confirmCalls.push(msg); return confirmQueue.length ? confirmQueue.shift() : true; };
globalThis.prompt = () => null;
globalThis.alert = () => {};

// Toast capture — a real <div> per toast, appended to a registered
// #toast-container whose appendChild records innerHTML instead of no-op'ing,
// so DI-D/DI-H's exact copy branches are assertable.
let capturedToasts = [];
function armToastCapture() {
  const c = el('toast-container');
  capturedToasts = [];
  c.appendChild = (child) => { capturedToasts.push({ text: child.innerHTML, className: child.className }); };
}

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const scoring = await import('./js/scoring.js');
const dataModel = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const {
  calculateWeeklyResults, calculateSeasonStandings, calculateGroupWeeklyResults,
} = scoring;
const { bindCommEventListeners, applyWeekStatusChange, finalizeWeek,
  renderRecalculateFinalizedWeeksAdminSectionHTML } = app;

console.log('[ranktest] modules imported —', Object.keys(scoring).length, 'scoring exports,',
  Object.keys(app).length, 'app exports');

// ─────────────────────────────────────────────────────────────────────────────
// 1. DI-A — THE REPORTED CASE: a 2-way tie on totalCorrect AND winPct, one
//    player holding a weekly L, sorts BELOW the one without it.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] DI-A — the reported Kihoon/Kevin case…');
{
  // Kevin inserted FIRST, Kihoon second — deliberately the OPPOSITE of the
  // expected final order. A stable sort under the OLD (pre-DI-A) comparator
  // that ties them would keep THIS insertion order, i.e. Kevin first — the
  // WRONG answer. If this fixture instead inserted them in the already-
  // correct order, a tie's stable sort would "pass" with DI-A entirely
  // deleted (reviewer's finding) — this ordering is what makes the proof
  // below non-vacuous.
  const players1 = [
    { playerId: 'r1_kevin', displayName: 'Kevin' },
    { playerId: 'r1_kihoon', displayName: 'Kihoon' },
  ];
  // Both finish the season with IDENTICAL totalCorrect/totalIncorrect (so
  // totalCorrect AND winPct tie), but Kevin actually holds a weekly L
  // (isLoser:true in week 1) while Kihoon never finished last in any single
  // week (isLoser never true for him).
  const results1 = [
    { weekId: 'r1_w1', playerId: 'r1_kihoon', correctPicks: 5, incorrectPicks: 1, correctCount: 5, incorrectCount: 1, isWinner: false, isLoser: false },
    { weekId: 'r1_w1', playerId: 'r1_kevin', correctPicks: 3, incorrectPicks: 3, correctCount: 3, incorrectCount: 3, isWinner: false, isLoser: true },
    { weekId: 'r1_w2', playerId: 'r1_kihoon', correctPicks: 2, incorrectPicks: 4, correctCount: 2, incorrectCount: 4, isWinner: false, isLoser: false },
    { weekId: 'r1_w2', playerId: 'r1_kevin', correctPicks: 4, incorrectPicks: 2, correctCount: 4, incorrectCount: 2, isWinner: false, isLoser: false },
  ];
  const kihoonTotal = results1.filter(r => r.playerId === 'r1_kihoon').reduce((s, r) => s + r.correctPicks, 0);
  const kevinTotal = results1.filter(r => r.playerId === 'r1_kevin').reduce((s, r) => s + r.correctPicks, 0);
  assert(kihoonTotal === 7 && kevinTotal === 7, 'fixture check: both finish the season on 7 correct picks — a genuine totalCorrect tie');

  const standings1 = calculateSeasonStandings(players1, results1);
  const kihoon1 = standings1.find(s => s.playerId === 'r1_kihoon');
  const kevin1 = standings1.find(s => s.playerId === 'r1_kevin');
  assert(kihoon1.totalCorrect === kevin1.totalCorrect && kihoon1.winPct === kevin1.winPct,
    `fixture check: totalCorrect AND winPct are genuinely tied (Kihoon ${kihoon1.totalCorrect}/${kihoon1.winPct}%, Kevin ${kevin1.totalCorrect}/${kevin1.winPct}%)`);
  assert(kihoon1.weeklyLosses === 0 && kevin1.weeklyLosses === 1,
    `fixture check: Kihoon never holds a weekly L (${kihoon1.weeklyLosses}), Kevin holds exactly one (${kevin1.weeklyLosses})`);

  // Proven non-vacuous — the PRE-DI-A comparator, applied to this exact
  // fixture, returns a genuine 0 (an unresolved tie), which is precisely how
  // the reported bug put Kihoon last: nothing broke the tie, so stable sort
  // order (array order, not merit) decided it.
  const oldCmp = (a, b) => b.totalCorrect - a.totalCorrect || b.winPct - a.winPct;
  assert(oldCmp(kihoon1, kevin1) === 0,
    'non-vacuous: the OLD (pre-DI-A) comparator genuinely ties Kihoon and Kevin — this fixture really does reproduce the reported ambiguity');

  // CONCRETE non-vacuousness — replay the OLD comparator's stable sort on
  // THIS insertion order (Kevin first, per players1 above) and confirm it
  // produces the WRONG answer. This is the check that actually distinguishes
  // "DI-A fixed it" from "the fixture happened to sort right on its own":
  // reviewer's BLOCK showed all three DI-A proofs passing 79/0 with the fix
  // entirely deleted, because every fixture previously inserted players in
  // the order it then asserted.
  const oldStableSort1 = [kevin1, kihoon1].sort(oldCmp); // mirrors players1's own insertion order
  assert(oldStableSort1[0].playerId === 'r1_kevin',
    'non-vacuous, concretely: replaying the OLD comparator on THIS insertion order keeps Kevin first (the WRONG answer, since Kevin holds the L) — proves this fixture cannot pass by coincidental stable order');

  assert(standings1[0].playerId === 'r1_kihoon' && standings1[1].playerId === 'r1_kevin',
    `THE FIX — with DI-A's comparator, Kihoon (no weekly L) sorts ABOVE Kevin (has the L): got [${standings1.map(s => s.displayName).join(', ')}]`);
  assert(standings1[1].isCurrentLastPlace === true && standings1[0].isCurrentLastPlace === false,
    '🤡 now lands on Kevin, who actually holds the L — not on Kihoon, who does not (the exact defect Drew reported)');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DI-A — a three-or-more-way tie resolves via the SAME full-array
//    comparator (Array.prototype.sort), not a pairwise reduction.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] DI-A — a four-way tie on totalCorrect/winPct resolves by net weekly W-L…');
{
  // Inserted D, C, B, A — the EXACT REVERSE of the expected final order A,
  // B, C, D — so a stable sort under the OLD (pre-DI-A) comparator that ties
  // all four keeps THIS (wrong) order. Reviewer's BLOCK: a fixture inserted
  // in already-correct order passes 79/0 with DI-A entirely deleted.
  const players2 = [
    { playerId: 'r2_d', displayName: 'D' }, { playerId: 'r2_c', displayName: 'C' },
    { playerId: 'r2_b', displayName: 'B' }, { playerId: 'r2_a', displayName: 'A' },
  ];
  // Every player finishes on totalCorrect=10, totalIncorrect=5 — a genuine
  // 4-way tie on both totalCorrect and winPct. Net weekly W-L differs:
  // A +2, B +1, C 0, D -1. Expected order: A, B, C, D.
  const row = (playerId, correct, incorrect, flags = {}) => ({
    weekId: `r2_wk_${playerId}_${correct}_${incorrect}`, playerId,
    correctPicks: correct, incorrectPicks: incorrect, correctCount: correct, incorrectCount: incorrect,
    isWinner: !!flags.isWinner, isLoser: !!flags.isLoser,
  });
  const results2 = [
    row('r2_a', 5, 2, { isWinner: true }), row('r2_a', 5, 3, { isWinner: true }),   // net +2
    row('r2_b', 5, 2, { isWinner: true }), row('r2_b', 5, 3),                        // net +1
    row('r2_c', 5, 2), row('r2_c', 5, 3),                                            // net  0
    row('r2_d', 5, 2, { isLoser: true }), row('r2_d', 5, 3),                         // net -1
  ];
  const standings2 = calculateSeasonStandings(players2, results2);
  const totals2 = standings2.map(s => `${s.displayName}=${s.totalCorrect}/${s.winPct}%`);
  assert(new Set(standings2.map(s => s.totalCorrect)).size === 1 && new Set(standings2.map(s => s.winPct)).size === 1,
    `fixture check: all four are genuinely tied on totalCorrect AND winPct (${totals2.join(', ')})`);

  // CONCRETE non-vacuousness — replay the OLD comparator's stable sort on
  // THIS insertion order (D, C, B, A) and confirm it produces the WRONG
  // (reversed) answer.
  const oldCmp2 = (a, b) => b.totalCorrect - a.totalCorrect || b.winPct - a.winPct;
  const byName2 = Object.fromEntries(standings2.map(s => [s.displayName, s]));
  const oldStableSort2 = [byName2.D, byName2.C, byName2.B, byName2.A].sort(oldCmp2); // mirrors players2's own insertion order
  assert(JSON.stringify(oldStableSort2.map(s => s.displayName)) === JSON.stringify(['D', 'C', 'B', 'A']),
    `non-vacuous, concretely: replaying the OLD comparator on THIS insertion order keeps D,C,B,A (the WRONG, reversed answer) — got [${oldStableSort2.map(s => s.displayName).join(', ')}]`);

  assert(JSON.stringify(standings2.map(s => s.displayName)) === JSON.stringify(['A', 'B', 'C', 'D']),
    `THE FULL-ARRAY SORT — order is A,B,C,D by net weekly W-L, not a pairwise artifact: got [${standings2.map(s => s.displayName).join(', ')}]`);
  assert(JSON.stringify(standings2.map(s => s.currentRank)) === JSON.stringify([1, 2, 3, 4]),
    'ranks 1-4 assigned in that same order, no gaps or duplicates');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DI-A — a FULLY EXHAUSTED tie (all three criteria equal) is an ACCEPTED
//    residual: deterministic, never throws. NOT "fixed" further — under
//    Drew's ruling there is no legitimate signal left to break it with.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] DI-A — a fully exhausted tie is a documented, deterministic residual…');
{
  const playersOf3 = () => [{ playerId: 'r3_a', displayName: 'A' }, { playerId: 'r3_b', displayName: 'B' }];
  // Identical totalCorrect, identical net weekly W-L (both 0 — neither ever
  // isWinner/isLoser), identical winPct. Every criterion DI-A's comparator
  // checks is tied.
  const resultsOf3 = () => [
    { weekId: 'r3_w1', playerId: 'r3_a', correctPicks: 3, incorrectPicks: 2, correctCount: 3, incorrectCount: 2, isWinner: false, isLoser: false },
    { weekId: 'r3_w1', playerId: 'r3_b', correctPicks: 3, incorrectPicks: 2, correctCount: 3, incorrectCount: 2, isWinner: false, isLoser: false },
  ];
  let threw = false, s1 = null, s2 = null;
  try {
    s1 = calculateSeasonStandings(playersOf3(), resultsOf3());
    s2 = calculateSeasonStandings(playersOf3(), resultsOf3()); // freshly-constructed, value-identical, different object instances
  } catch (e) { threw = true; console.error('    threw:', e.message); }
  assert(!threw, 'a fully exhausted tie (totalCorrect, net Wk W-L, AND winPct all equal) does not throw');
  assert(s1 !== null && s1[0].totalCorrect === s1[1].totalCorrect &&
    (s1[0].weeklyWins - s1[0].weeklyLosses) === (s1[1].weeklyWins - s1[1].weeklyLosses) &&
    s1[0].winPct === s1[1].winPct,
    'fixture check: this really is exhausted — all three of DI-A\'s criteria tie, not just totalCorrect');
  assert(s1 !== null && s1.length === 2 && new Set(s1.map(r => r.currentRank)).size === 2,
    'both rows still get distinct, valid ranks even with nothing left to differentiate them');
  assert(s1 !== null && s2 !== null && JSON.stringify(s1) === JSON.stringify(s2),
    'DETERMINISTIC across independent calls on freshly-constructed, value-identical fixtures — the residual is accepted and stable, not hidden and not randomized');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DI-A + UN-118 — a grouped (multi-part) week's pooled win/loss
//    contributes correctly to the tie-break. Built on grouptest.mjs's own
//    2-part-group fixture SHAPE (players/weeks/games/picks literals of the
//    same construction as grouptest.mjs [5+6]) rather than inventing a new
//    grouping mechanism.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] DI-A + UN-118 — a grouped week\'s pooled win/loss breaks a season tie…');
{
  const { getEffectiveGroupId, weeksInGroup } = dataModel;

  // Bob inserted FIRST, Ann second — the opposite of the expected final
  // order, for the same non-vacuousness reason as [1] and [2] above.
  const players4 = [{ playerId: 'r4_b', displayName: 'Bob' }, { playerId: 'r4_a', displayName: 'Ann' }];
  // A 2-part group (grouptest.mjs [5+6] shape) — Ann pooled-wins it clearly.
  const W4a = { weekId: 'r4_p1', weekNumber: 40, season: 2026, status: 'final', groupId: 'r4_p1' };
  const W4b = { weekId: 'r4_p2', weekNumber: 41, season: 2026, status: 'final', groupId: 'r4_p1' };
  // A THIRD, solo week (absent groupId — the DI-126g old-data shape) whose
  // raw picks flip the season TOTAL into a tie, so DI-A's middle criterion —
  // not totalCorrect alone — is what has to decide it.
  const W4c = { weekId: 'r4_solo', weekNumber: 42, season: 2026, status: 'final' };
  const weeks4 = [W4a, W4b, W4c];
  assert(weeksInGroup(weeks4, W4a).length === 2 && getEffectiveGroupId(W4a) === 'r4_p1',
    'fixture check: W4a/W4b really do resolve as one 2-member group');
  assert(weeksInGroup(weeks4, W4c).length === 1,
    'fixture check: the solo week is a singleton, unaffected by the group');

  // Group: Ann pooled correct=6/incorrect=2, Bob pooled correct=2/incorrect=6
  // — Ann is the CLEAR pooled winner, Bob the clear pooled loser (no internal
  // tie inside the group itself, so its own pooled ranking is unambiguous).
  const resultsGroup4 = [
    { weekId: 'r4_p1', playerId: 'r4_a', correctPicks: 5, incorrectPicks: 1, correctCount: 5, incorrectCount: 1 },
    { weekId: 'r4_p1', playerId: 'r4_b', correctPicks: 1, incorrectPicks: 5, correctCount: 1, incorrectCount: 5 },
    { weekId: 'r4_p2', playerId: 'r4_a', correctPicks: 1, incorrectPicks: 1, correctCount: 1, incorrectCount: 1 },
    { weekId: 'r4_p2', playerId: 'r4_b', correctPicks: 1, incorrectPicks: 1, correctCount: 1, incorrectCount: 1 },
  ];
  // Solo week: Ann correct=6, Bob correct=10 — neither flagged winner/loser
  // here (as if a third+ player took those spots that week); only the raw
  // counts matter for the season total.
  const resultsSolo4 = [
    { weekId: 'r4_solo', playerId: 'r4_a', correctPicks: 6, incorrectPicks: 6, correctCount: 6, incorrectCount: 6, isWinner: false, isLoser: false },
    { weekId: 'r4_solo', playerId: 'r4_b', correctPicks: 10, incorrectPicks: 2, correctCount: 10, incorrectCount: 2, isWinner: false, isLoser: false },
  ];
  const allWeeklyResults4 = [...resultsGroup4, ...resultsSolo4];

  const standings4 = calculateSeasonStandings(players4, allWeeklyResults4, weeks4);
  const ann4 = standings4.find(s => s.playerId === 'r4_a');
  const bob4 = standings4.find(s => s.playerId === 'r4_b');
  assert(ann4.totalCorrect === bob4.totalCorrect && ann4.winPct === bob4.winPct,
    `fixture check: the season total is genuinely tied by construction (Ann ${ann4.totalCorrect}/${ann4.winPct}%, Bob ${bob4.totalCorrect}/${bob4.winPct}%)`);
  const oldCmp4 = (a, b) => b.totalCorrect - a.totalCorrect || b.winPct - a.winPct;
  assert(oldCmp4(ann4, bob4) === 0, 'non-vacuous: the OLD comparator genuinely ties Ann and Bob on this fixture too');

  // CONCRETE non-vacuousness — replay the OLD comparator's stable sort on
  // THIS insertion order (Bob first, per players4 above) and confirm it
  // produces the WRONG answer.
  const oldStableSort4 = [bob4, ann4].sort(oldCmp4); // mirrors players4's own insertion order
  assert(oldStableSort4[0].playerId === 'r4_b',
    'non-vacuous, concretely: replaying the OLD comparator on THIS insertion order keeps Bob first (the WRONG answer — Bob is the pooled group LOSER) — proves this fixture cannot pass by coincidental stable order');

  // Acceptance-gate style check (grouptest.mjs [5+6]'s own pattern): the
  // group contributes exactly ONE win and ONE loss total, not two.
  assert(ann4.weeklyWins === 1 && bob4.weeklyLosses === 1,
    `THE ACCEPTANCE GATE, reused — the group contributes exactly one pooled win (Ann) and one pooled loss (Bob), not per-part double-counting (Ann weeklyWins=${ann4.weeklyWins}, Bob weeklyLosses=${bob4.weeklyLosses})`);
  assert(ann4.weeklyLosses === 0 && bob4.weeklyWins === 0,
    'and the solo week contributes NEITHER a win nor a loss to either player, per its own flags — only the tie in totalCorrect/winPct is at stake here');

  assert(standings4[0].playerId === 'r4_a' && standings4[1].playerId === 'r4_b',
    `THE FIX — Ann's pooled group win (net +1) breaks the season-level tie in her favor: got [${standings4.map(s => s.displayName).join(', ')}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. [structural] TRIPWIRE — calculateSeasonStandings() never reads
//    tiebreakerDelta / tiebreakerGuess / actualTiebreakerValue, so a
//    season-level aggregate cannot be silently reintroduced later.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] [structural] calculateSeasonStandings() never reads a tiebreaker field…');
{
  /** Declaration-to-declaration boundary — same principle as loadtest.mjs
   *  [64]'s regionsOf(): every top-level export in scoring.js sits at
   *  column 0, so a function's body runs from its own declaration line to
   *  the next one (or EOF). */
  function extractExportedFunction(text, name) {
    const lines = text.split('\n');
    const startIdx = lines.findIndex(l => new RegExp(`^export function ${name}\\s*\\(`).test(l));
    if (startIdx === -1) return null;
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^export function\s+[A-Za-z_$][\w$]*\s*\(/.test(lines[i])) { endIdx = i; break; }
    }
    return lines.slice(startIdx, endIdx).join('\n');
  }

  const src = await readFile(new URL('./js/scoring.js', import.meta.url), 'utf8');
  const body = extractExportedFunction(src, 'calculateSeasonStandings');

  // ── FIXTURE / ANCHOR CHECK — the scan actually FOUND the function and cut
  //    a real boundary. This is the check orienttest.mjs [4d] skipped: its
  //    regex went vacuously true once the "score-num" anchor text it
  //    depended on was gone, on a change that never touched the property it
  //    claimed to guard. A negative assertion with no anchor is worthless —
  //    "not found" and "found and clean" render identically.
  assert(body !== null, 'fixture check: the scanner located `export function calculateSeasonStandings(` in js/scoring.js');
  assert(body !== null && body.includes('isSeasonLeader') && body.includes('currentRank') && body.includes('weeklyWins'),
    'fixture check: the captured body contains fields ONLY calculateSeasonStandings defines — this is the real function body, not an empty or mismatched slice');
  assert(body !== null && !/function\s+getPickStatusLabel/.test(body),
    'fixture check: the boundary stopped BEFORE the next declared function — the cut is "this function", not "rest of file"');
  assert(body !== null && body.length > 500,
    `fixture check: captured body is a real function, not a one-line stub (got ${body ? body.length : 0} chars)`);

  /**
   * THE ALLOWLIST — reviewer's BLOCK: a scan that cut the function at
   * `const standings=players.map(...)` and only checked what came AFTER
   * missed a forbidden-field read placed ABOVE that line — moving the
   * identical aggregate three lines up (into a variable computed before the
   * cut, then fed into the sort through that variable's name, never the
   * literal field name, past the cut) went 79/0 green. A textual scan can
   * only ever see literal field names, so the fix is to scan the WHOLE
   * function — not "before vs after some cut point" — and allow ONLY the
   * two KNOWN, pre-existing, already-tested (grouptest.mjs [4] TIEBREAKER
   * ISOLATION) group-pooling occurrences, matched by their EXACT line text.
   * Any OTHER line anywhere in the function mentioning a forbidden field —
   * above, below, or beside the season-tally block — is now a violation,
   * regardless of where it sits relative to any particular statement.
   */
  const ALLOWLISTED_LINES = [
    'tiebreakerDelta: tbRow ? (tbRow.tiebreakerDelta ?? null) : null,',
  ];
  const FORBIDDEN = ['tiebreakerDelta', 'tiebreakerGuess', 'actualTiebreakerValue'];

  /** Every line in `functionBody` mentioning a forbidden field, split into
   *  ALLOWED (exact match to an allowlisted line, after trim) and VIOLATION
   *  (everything else). Line-exact on purpose — see canary D below: a
   *  cosmetically reformatted version of the SAME legitimate line is NOT
   *  auto-permitted, so the allowlist cannot quietly widen into a fuzzy
   *  substring permission. */
  function scanWholeFunction(functionBody) {
    const violations = [];
    const matchedAllowlist = new Set();
    if (functionBody === null) return { violations, matchedAllowlist };
    for (const rawLine of functionBody.split('\n')) {
      const line = rawLine.trim();
      if (!FORBIDDEN.some(f => line.includes(f))) continue;
      if (ALLOWLISTED_LINES.includes(line)) { matchedAllowlist.add(line); continue; }
      violations.push(rawLine.trim());
    }
    return { violations, matchedAllowlist };
  }

  const scan = scanWholeFunction(body);

  // ── THE ACTUAL GUARD — whole function, allowlist-exempt.
  assert(body !== null && scan.violations.length === 0,
    `calculateSeasonStandings() reads no forbidden tiebreaker field ANYWHERE in the function except the allowlisted group-pooling line — DI-A's weeklyWins/weeklyLosses comparator is the only tiebreaker-adjacent SEASON input, and it is a WEEKLY OUTCOME, never the raw delta (Drew's ruling: no season aggregate of the tiebreaker) — violations: ${JSON.stringify(scan.violations)}`);

  // ── ALLOWLIST HYGIENE — every entry must correspond to a REAL line
  //    present in the function right now. A stale/unused entry is a standing
  //    permission attached to nothing (RG-27 shape) — if the legitimate
  //    line's exact text ever changes (even a harmless reformat), this must
  //    fail LOUD and force the allowlist to be updated deliberately, the
  //    same direction reviewer endorsed this morning for a comment tripping
  //    a scan in backend.js: failing loud beats a scan that can be talked
  //    out of firing.
  const staleAllowlist = ALLOWLISTED_LINES.filter(l => !scan.matchedAllowlist.has(l));
  assert(staleAllowlist.length === 0,
    `every ALLOWLISTED_LINES entry matches a line actually present in calculateSeasonStandings() right now (stale: ${JSON.stringify(staleAllowlist)})`);

  // ── CANARY A — a REAL injected defect, in the season-tally region (AFTER
  //    where the old, narrower cut used to sit), must be caught.
  const CANARY_DEFECT_BELOW = `
export function calculateSeasonStandings(players, allWeeklyResults, weeks=null) {
  const standings=players.map(player=>{
    const x = allWeeklyResults.reduce((s,r)=>s+(r.tiebreakerDelta||0),0);
    return { totalCorrect: x };
  });
  return standings;
}
export function getPickStatusLabel(result) { return result; }
`;
  const scanBelow = scanWholeFunction(extractExportedFunction(CANARY_DEFECT_BELOW, 'calculateSeasonStandings'));
  assert(scanBelow.violations.length === 1,
    'canary A: an injected season-aggregate read of tiebreakerDelta AFTER the old cut point is caught (the guard is not vacuous)');

  // ── CANARY A2 — REVIEWER'S EXACT REPRODUCTION. The identical aggregate,
  //    moved ABOVE `const standings=players.map(...)`, computed into a
  //    variable, and fed into the sort through that variable's NAME (never
  //    the literal forbidden field again past that point). The narrower,
  //    cut-based scan missed this — 79/0 green. The whole-function scan
  //    must not.
  const CANARY_DEFECT_ABOVE = `
export function calculateSeasonStandings(players, allWeeklyResults, weeks=null) {
  const seasonTiebreakerTotal = new Map(players.map(p => [p.playerId,
    allWeeklyResults.filter(r=>r.playerId===p.playerId).reduce((s,r)=>s+(r.tiebreakerDelta||0),0)]));
  const standings=players.map(player=>{
    return { totalCorrect: 0, tbTotal: seasonTiebreakerTotal.get(player.playerId) };
  });
  return standings.sort((a,b)=>b.tbTotal-a.tbTotal);
}
export function getPickStatusLabel(result) { return result; }
`;
  const scanAbove = scanWholeFunction(extractExportedFunction(CANARY_DEFECT_ABOVE, 'calculateSeasonStandings'));
  assert(scanAbove.violations.length === 1,
    'canary A2 — REVIEWER\'S EXACT REPRODUCTION: the identical aggregate, relocated ABOVE the season-tally block and fed into the sort via an intermediate variable, is caught by the WHOLE-FUNCTION scan (the narrower, cut-based scan this replaces missed exactly this shape)');

  // ── CANARY B — a BARE, UNRELATED forbidden-looking line in a DIFFERENT
  //    function must not leak in — the scan is boundary-anchored to THIS
  //    function, not whole-file.
  const CANARY_RENAME = `
export function calculateWeeklyResults(weekId) {
  const tiebreakerDeltaButRenamedElsewhereInTheFile = 1;
  return tiebreakerDeltaButRenamedElsewhereInTheFile;
}
export function calculateSeasonStandings(players, allWeeklyResults, weeks=null) {
  const standings=players.map(player=>{
    const isSeasonLeader = true; const currentRank = 1; const weeklyWins = 0;
    return { isSeasonLeader, currentRank, weeklyWins };
  });
  return standings.sort((a,b)=>0);
}
export function getPickStatusLabel(result) { return result; }
`;
  const scanRename = scanWholeFunction(extractExportedFunction(CANARY_RENAME, 'calculateSeasonStandings'));
  assert(scanRename.violations.length === 0,
    'canary B: a forbidden-looking substring in an UNRELATED function does not leak into the guarded function — boundary-anchored, not whole-file');

  // ── CANARY C — the ALLOWLISTED line itself, present verbatim in a
  //    synthetic function, must NOT be flagged (or the guard would block
  //    the real, legitimate, currently-shipping code).
  const CANARY_ALLOWED = `
export function calculateSeasonStandings(players, allWeeklyResults, weeks=null) {
  const pooled = players.map(player => {
    const tbRow = null;
    return {
      tiebreakerDelta: tbRow ? (tbRow.tiebreakerDelta ?? null) : null,
    };
  });
  const standings=players.map(player=>({isSeasonLeader:true,currentRank:1,weeklyWins:0}));
  return standings.sort((a,b)=>0);
}
`;
  const scanAllowed = scanWholeFunction(extractExportedFunction(CANARY_ALLOWED, 'calculateSeasonStandings'));
  assert(scanAllowed.violations.length === 0 && scanAllowed.matchedAllowlist.size === 1,
    'canary C: the allowlisted line, present verbatim, is NOT flagged — the guard does not block the real, legitimate, currently-shipping group-pooling code');

  // ── CANARY D — a COSMETICALLY reformatted version of the SAME legitimate
  //    line (parens removed, semantics unchanged) is NOT auto-permitted.
  //    Proves "line-exact" really means exact — the allowlist cannot
  //    quietly widen into a fuzzy substring permission that a future
  //    reformat, or a disguised new read, could hide inside.
  const CANARY_REFORMATTED = `
export function calculateSeasonStandings(players, allWeeklyResults, weeks=null) {
  const pooled = players.map(player => {
    const tbRow = null;
    return {
      tiebreakerDelta: tbRow ? tbRow.tiebreakerDelta ?? null : null,
    };
  });
  const standings=players.map(player=>({isSeasonLeader:true,currentRank:1,weeklyWins:0}));
  return standings.sort((a,b)=>0);
}
`;
  const scanReformatted = scanWholeFunction(extractExportedFunction(CANARY_REFORMATTED, 'calculateSeasonStandings'));
  assert(scanReformatted.violations.length === 1,
    'canary D: a COSMETICALLY reformatted copy of the legitimate line (parens removed) is FLAGGED, not silently allowed — "line-exact" is exact, not fuzzy');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. winPct is still computed from RAW counts — unchanged by DI-A.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] winPct still comes from RAW counts (correctCount/incorrectCount), not weighted…');
{
  const players6 = [{ playerId: 'r6_a', displayName: 'Ann' }];
  // A 2x-multiplier WIN (weighted +2, raw +1) and a 1x LOSS (weighted +1,
  // raw +1). Weighted: correct=2, incorrect=1 → 2/3 = 66.7% if winPct wrongly
  // used weighted counts. Raw: correct=1, incorrect=1 → 1/2 = 50%.
  const results6 = [
    { weekId: 'r6_w', playerId: 'r6_a', correctPicks: 2, incorrectPicks: 1, correctCount: 1, incorrectCount: 1, isWinner: false, isLoser: false },
  ];
  const standings6 = calculateSeasonStandings(players6, results6);
  const ann6 = standings6[0];
  assert(ann6.totalCorrect === 2 && ann6.totalIncorrect === 1, 'fixture check: WEIGHTED totals reflect the multiplier (correct=2, incorrect=1)');
  assert(ann6.totalCorrectCount === 1 && ann6.totalIncorrectCount === 1, 'fixture check: RAW counts do not (correctCount=1, incorrectCount=1)');
  assert(ann6.winPct === 50, `winPct = 50% (RAW 1-of-2), not 66.7% (WEIGHTED 2-of-3) — got ${ann6.winPct}%`);
  assert(ann6.winPct !== Math.round((ann6.totalCorrect / (ann6.totalCorrect + ann6.totalIncorrect)) * 1000) / 10,
    'and specifically NOT what a weighted-count winPct would have produced — the divergence is the whole point of the raw/weighted split');
}

// ═════════════════════════════════════════════════════════════════════════════
// Shared fixture helpers for the app.js-level proofs below (7-9) — same
// pattern as gradetest.mjs's GAME()/seedGames()/bindComm().
// ═════════════════════════════════════════════════════════════════════════════
const mkGame = (weekId, gameId, home, away, homeScore, awayScore, o = {}) => ({
  weekId, gameId, homeTeam: home, awayTeam: away, homeMascot: '', awayMascot: '',
  homeConference: '', awayConference: '', homeRank: null, awayRank: null,
  kickoff: '2026-11-01T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
  spread: -3, favorite: 'HOME', lockedSpread: -3,
  homeScore, awayScore, status: 'final', actualWinner: null, atsWinner: null,
  isAlmaMaterGame: false, multiplier: 1, isManual: false,
  dataSource: 'manual', dataQuality: 'manual', spreadSource: 'manual',
  ...o,
});

function seedWeek(week, games, picks) {
  localStorage.clear();
  storage.saveWeek(week);
  for (const g of games) storage.saveGame(g);
  storage.saveAllPicks(picks);
}

function bindComm(week, games) {
  bindCommEventListeners(week, games, [], [], storage.getSettings(), storage.getWeeks());
}

const activeWeeklyObs = wid => storage.getActiveObligations(wid).filter(o => o.type === 'weekly');

// ─────────────────────────────────────────────────────────────────────────────
// 7. DI-D END TO END, through the REAL save-tb-btn click handler — not a
//    direct second finalizeWeek() call. Reuses the UN-126 collision SHAPE
//    (loadtest.mjs [54]) but triggers it via the NEW entry point, to prove
//    that entry point reaches the same guarantee.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] DI-D — tiebreaker saved AFTER finalization, through the real button, recomputes and flags (never rewrites)…');
{
  // Full isolation — DI-H's [9] loop below scans EVERY final week in
  // storage, so any week left over from an earlier section would silently
  // inflate its count. Clearing at the top of each storage-touching section
  // keeps them order-independent.
  localStorage.clear();
  storage.getPlayers().forEach(p => { if (p.active) storage.savePlayer({ ...p, active: false }); });
  storage.addPlayer({ playerId: 'r7_x', displayName: 'Xena', active: true });
  storage.addPlayer({ playerId: 'r7_y', displayName: 'Yusuf', active: true });

  const W7 = { weekId: 'r7_w1', weekNumber: 1, season: 2026, status: 'live',
    dataSourceMode: 'manual', picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false, tiebreakerQuestion: 'Total points?',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false };
  // Two games, engineered so Xena and Yusuf finish TIED 1-1 with no
  // tiebreaker on file — the pre-DI-D "arbitrary" scenario.
  const g1 = mkGame('r7_w1', 'r7_g1', 'Home1', 'Away1', 24, 20); // home -3 covers: 24-3=21>20 → Home1
  const g2 = mkGame('r7_w1', 'r7_g2', 'Home2', 'Away2', 10, 24); // home -3, away covers: 10-3=7<24 → Away2
  storage.saveWeek(W7);
  storage.saveGame(g1); storage.saveGame(g2);
  storage.saveAllPicks([
    { pickId: 'r7_pk_x1', weekId: 'r7_w1', gameId: 'r7_g1', playerId: 'r7_x', selectedTeam: 'Home1' }, // correct
    { pickId: 'r7_pk_x2', weekId: 'r7_w1', gameId: 'r7_g2', playerId: 'r7_x', selectedTeam: 'Home2' }, // wrong
    { pickId: 'r7_pk_y1', weekId: 'r7_w1', gameId: 'r7_g1', playerId: 'r7_y', selectedTeam: 'Away1' }, // wrong
    { pickId: 'r7_pk_y2', weekId: 'r7_w1', gameId: 'r7_g2', playerId: 'r7_y', selectedTeam: 'Away2' }, // correct
  ]);

  const preview7 = calculateWeeklyResults('r7_w1', storage.getPlayers().filter(p => p.active), storage.getPicks('r7_w1'), storage.getGames('r7_w1'), null);
  assert(preview7[0].correctPicks === preview7[1].correctPicks && preview7[0].correctPicks === 1,
    'fixture check: Xena and Yusuf are genuinely tied 1-1 with no tiebreaker entered');

  // ── FIRST finalize (existing path — applyWeekStatusChange) — with no
  //    actualTiebreakerValue, both deltas are null, the comparator ties, and
  //    stable sort keeps insertion order: Xena (added first) wins arbitrarily.
  applyWeekStatusChange(storage.getWeek('r7_w1'), 'final');
  const before7 = storage.getWeeklyResults('r7_w1');
  const arbWinner = before7.find(r => r.isWinner)?.playerId;
  const arbLoser = before7.find(r => r.isLoser)?.playerId;
  assert(arbWinner === 'r7_x' && arbLoser === 'r7_y',
    `fixture check: the ARBITRARY first finalize (no tiebreaker, tied) picked Xena as winner by stable-sort/insertion order, not merit (got winner=${arbWinner}, loser=${arbLoser})`);
  const obsBefore7 = activeWeeklyObs('r7_w1');
  assert(obsBefore7.length === 1 && obsBefore7[0].payerPlayerId === 'r7_y' && obsBefore7[0].recipientPlayerId === 'r7_x',
    'fixture check: exactly one obligation on record, naming Yusuf (loser) owing Xena (winner) off the arbitrary outcome');
  const staleObligationId = obsBefore7[0].obligationId;
  const staleCreatedAt = obsBefore7[0].createdAt;

  // Guesses submitted earlier (during the OPEN week) — Yusuf's is far closer
  // to the actual value that's about to be entered, so recomputing MUST flip
  // the outcome.
  storage.setTiebreakerGuess('r7_w1', 'r7_x', 50);
  storage.setTiebreakerGuess('r7_w1', 'r7_y', 10);

  // ── THE NEW ENTRY POINT — drive the REAL save-tb-btn click handler.
  resetDom();
  armToastCapture();
  el('tb-question').value = 'Total points?';
  el('tb-actual').value = '12'; // Xena delta=38, Yusuf delta=2 → Yusuf now wins
  el('save-tb-btn');
  bindComm(storage.getWeek('r7_w1'), storage.getGames('r7_w1'));
  el('save-tb-btn')._fire('click');

  const savedWeek7 = storage.getWeek('r7_w1');
  assert(savedWeek7.actualTiebreakerValue === 12 && savedWeek7.tiebreakerFinalized === true,
    'the tiebreaker value itself was persisted by the save-tb-btn handler (unchanged base behaviour)');

  const after7 = storage.getWeeklyResults('r7_w1');
  const newWinner = after7.find(r => r.isWinner)?.playerId;
  const newLoser = after7.find(r => r.isLoser)?.playerId;
  assert(newWinner === 'r7_y' && newLoser === 'r7_x',
    `THE RECOMPUTE FIRED — persisted results now show Yusuf as winner (closer to the actual tiebreaker), Xena as loser: got winner=${newWinner}, loser=${newLoser}`);
  assert(JSON.stringify(before7) !== JSON.stringify(after7),
    'the persisted weekly-result snapshot genuinely changed — Season Summary/Weekly History/CSV all read this same snapshot');

  // ── THE OBLIGATION GUARANTEE — flagged, never rewritten.
  const obsAfter7 = activeWeeklyObs('r7_w1');
  assert(obsAfter7.length === 2,
    `a conflicting recomputed outcome creates a SECOND obligation record rather than silently rewriting the first (got ${obsAfter7.length} active records)`);
  const stale7 = obsAfter7.find(o => o.obligationId === staleObligationId);
  assert(!!stale7 && stale7.createdAt === staleCreatedAt && stale7.payerPlayerId === 'r7_y' && stale7.recipientPlayerId === 'r7_x',
    'the ORIGINAL (now-stale) obligation is UNTOUCHED — same id, same createdAt, same payer/recipient — never rewritten in place');
  const fresh7 = obsAfter7.find(o => o.obligationId !== staleObligationId);
  assert(!!fresh7 && fresh7.payerPlayerId === 'r7_x' && fresh7.recipientPlayerId === 'r7_y',
    'a NEW obligation exists naming the freshly recomputed (correct) payer/recipient — never silently dropped');
  assert(stale7.needsReview === true && fresh7.needsReview === true,
    'BOTH records are flagged needsReview — surfaced for a human to resolve via Data → Obligation Corrections, never auto-resolved either way (DI-F, achieved entirely by DI-D)');

  // ── COPY — the DI-D toast branch that fires when the recorded outcome
  //    actually changed.
  assert(capturedToasts.length === 1, 'fixture check: exactly one toast fired from the save-tb-btn click');
  assert(capturedToasts[0].text.includes('🎯 Tiebreaker saved') && capturedToasts[0].text.includes('recalculated'),
    `the already-final recompute branch's copy fired: "${capturedToasts[0]?.text}"`);
  assert(capturedToasts[0].text.includes('⚠️ Recorded outcome changed') && capturedToasts[0].text.includes('Obligation Corrections'),
    'AND the "recorded outcome changed" warning is appended, because the winner/loser genuinely flipped');

  // ── 7b. CONTRAST — a NOT-YET-FINAL week's tiebreaker save must NOT
  //    recompute anything and must NOT change the base toast copy.
  const W7b = { ...W7, weekId: 'r7_w2', status: 'open', actualTiebreakerValue: null, tiebreakerFinalized: false };
  storage.saveWeek(W7b);
  resetDom(); armToastCapture();
  el('tb-question').value = 'Q'; el('tb-actual').value = '5';
  el('save-tb-btn');
  bindComm(storage.getWeek('r7_w2'), []);
  el('save-tb-btn')._fire('click');
  assert(storage.getWeeklyResults('r7_w2').length === 0,
    'a NOT-YET-FINAL week\'s tiebreaker save creates no weekly-result rows — finalizeWeek() was not called again');
  assert(capturedToasts.length === 1 && capturedToasts[0].text === 'Tiebreaker saved ✅',
    `not-yet-final copy is UNCHANGED from before this input: "${capturedToasts[0]?.text}"`);
}

// NOTE (2026-09-03, per reviewer's BLOCK) — weekOutcomeChanged() was
// previously mutation-tested HERE, in-file, by writing a gutted copy
// directly to js/app.js on disk and restoring it in a `finally` block. That
// is exactly what CLAUDE.md's prohibited-moves section forbids: mutating
// real source as part of a routine, repeatable test run. It also hardcoded
// a session-specific scratchpad path — in any OTHER session that directory
// does not exist, `writeFile` throws, and `[8-mutation]`'s twin had NO
// backup at all — meaning a spend-limit interruption or SIGKILL mid-mutation
// (this batch hit three) could leave `return false; // MUTATED` sitting in
// shipped js/app.js, permanently, for Drew.
//
// The battery is dropped. weekOutcomeChanged() WAS mutation-tested —
// gutted to `return false`, confirmed [7]'s "Recorded outcome changed"
// assertion RED, restored from a scratchpad copy, confirmed GREEN — as a
// ONE-TIME, interactive, developer-time check (the same pattern CLAUDE.md
// prescribes: copy to scratch, mutate, verify, restore from the copy). The
// RED/GREEN evidence is recorded in the handoff report, not baked into a
// file that runs unattended and unattended-writes to real source.

// ─────────────────────────────────────────────────────────────────────────────
// 8. [additional, beyond the required 7] DI-E — the manual Finalize button's
//    confirm() gate, driven through the REAL week-status-btn click handler,
//    mutation-tested against weekHasUnresolvedTie().
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] DI-E — manual Finalize confirm() gate…');
{
  localStorage.clear(); // isolation — see [7]'s comment
  storage.getPlayers().forEach(p => { if (p.active) storage.savePlayer({ ...p, active: false }); });
  storage.addPlayer({ playerId: 'r8_x', displayName: 'Xena', active: true });
  storage.addPlayer({ playerId: 'r8_y', displayName: 'Yusuf', active: true });

  function tiedWeek(weekId) {
    const W = { weekId, weekNumber: 1, season: 2026, status: 'live', dataSourceMode: 'manual',
      actualTiebreakerValue: null, tiebreakerFinalized: false, blurb: '', recap: '', groupId: null, isGroupTiebreaker: false };
    storage.saveWeek(W);
    storage.saveGame(mkGame(weekId, `${weekId}_g1`, 'Home1', 'Away1', 24, 20));
    storage.saveGame(mkGame(weekId, `${weekId}_g2`, 'Home2', 'Away2', 10, 24));
    storage.saveAllPicks([
      { pickId: `${weekId}_pk_x1`, weekId, gameId: `${weekId}_g1`, playerId: 'r8_x', selectedTeam: 'Home1' },
      { pickId: `${weekId}_pk_x2`, weekId, gameId: `${weekId}_g2`, playerId: 'r8_x', selectedTeam: 'Home2' },
      { pickId: `${weekId}_pk_y1`, weekId, gameId: `${weekId}_g1`, playerId: 'r8_y', selectedTeam: 'Away1' },
      { pickId: `${weekId}_pk_y2`, weekId, gameId: `${weekId}_g2`, playerId: 'r8_y', selectedTeam: 'Away2' },
    ]);
    return W;
  }

  function fireFinalize(weekId) {
    resetDom();
    const btn = makeEl('__final_btn__'); btn.dataset.to = 'final';
    selectorSets.set('.week-status-btn', [btn]);
    bindComm(storage.getWeek(weekId), storage.getGames(weekId));
    btn._fire('click');
  }

  // ── 8a. TIED, no tiebreaker, Cancel → confirm() fires with DI-E's exact
  //    copy, and the week must NOT finalize.
  tiedWeek('r8_w1');
  confirmCalls = []; confirmQueue = [false]; // Cancel
  fireFinalize('r8_w1');
  assert(confirmCalls.length === 1, `confirm() was called exactly once for a tied, no-tiebreaker week (got ${confirmCalls.length})`);
  assert(confirmCalls[0].includes('tie in correct picks') && confirmCalls[0].includes('Enter the tiebreaker first (Cancel)') && confirmCalls[0].includes('finalize anyway'),
    `confirm() carried DI-E's exact copy: "${confirmCalls[0]}"`);
  assert(storage.getWeek('r8_w1').status === 'live', 'Cancel on the confirm() → the week did NOT finalize (still live)');

  // ── 8b. TIED, no tiebreaker, OK → week finalizes anyway.
  tiedWeek('r8_w2');
  confirmCalls = []; confirmQueue = [true]; // OK
  fireFinalize('r8_w2');
  assert(confirmCalls.length === 1, 'confirm() fired again for a second tied week');
  assert(storage.getWeek('r8_w2').status === 'final', 'OK on the confirm() → the week DID finalize');

  // ── 8c. A tiebreaker is ALREADY on file (even though the games would
  //    still tie) → confirm() must NOT fire. Trigger is deliberately narrow:
  //    actualTiebreakerValue == null AND a tie.
  const W8c = tiedWeek('r8_w3');
  storage.saveWeek({ ...W8c, actualTiebreakerValue: 12, tiebreakerFinalized: true });
  confirmCalls = []; confirmQueue = [];
  fireFinalize('r8_w3');
  assert(confirmCalls.length === 0, 'a tiebreaker already on file suppresses the confirm() entirely, even though the games themselves still tie');
  assert(storage.getWeek('r8_w3').status === 'final', 'and the week finalizes directly, exactly like today, with no interruption');

  // ── 8d. A CLEAR winner (no tie) → confirm() must NOT fire.
  const weekIdClear = 'r8_w4';
  const Wc = { weekId: weekIdClear, weekNumber: 1, season: 2026, status: 'live', dataSourceMode: 'manual',
    actualTiebreakerValue: null, tiebreakerFinalized: false, blurb: '', recap: '', groupId: null, isGroupTiebreaker: false };
  storage.saveWeek(Wc);
  storage.saveGame(mkGame(weekIdClear, `${weekIdClear}_g1`, 'Home1', 'Away1', 24, 20));
  storage.saveAllPicks([
    { pickId: `${weekIdClear}_pk_x1`, weekId: weekIdClear, gameId: `${weekIdClear}_g1`, playerId: 'r8_x', selectedTeam: 'Home1' },
    { pickId: `${weekIdClear}_pk_y1`, weekId: weekIdClear, gameId: `${weekIdClear}_g1`, playerId: 'r8_y', selectedTeam: 'Away1' },
  ]);
  confirmCalls = []; confirmQueue = [];
  fireFinalize(weekIdClear);
  assert(confirmCalls.length === 0, 'a week with a clear winner (no tie) never triggers the confirm() — unchanged from before this input');
  assert(storage.getWeek(weekIdClear).status === 'final', 'and finalizes directly');
}

// NOTE (2026-09-03, per reviewer's BLOCK) — weekHasUnresolvedTie() was
// previously mutation-tested HERE the same in-file, real-source-mutating way
// as weekOutcomeChanged() above; dropped for the same reason (see the note
// preceding [7]'s mutation section). It WAS mutation-tested — gutted to
// `return false`, confirmed [8]'s tied/no-tiebreaker fixture no longer
// triggers confirm() (RED), restored from a scratchpad copy, confirmed
// GREEN (confirm() fires again) — as a one-time, interactive check. Evidence
// recorded in the handoff report.

// ─────────────────────────────────────────────────────────────────────────────
// 9. [additional, beyond the required 7] DI-H — "Recalculate All Finalized
//    Weeks", driven through the REAL recalc-all-weeks-btn click handler.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] DI-H — the Data-tab bulk recompute button…');
{
  // Isolation is LOAD-BEARING here, not just hygiene — DI-H's loop scans
  // getWeeks().filter(status==='final') GLOBALLY, so a stray final week from
  // an earlier section would silently inflate "N weeks recalculated".
  localStorage.clear();
  storage.getPlayers().forEach(p => { if (p.active) storage.savePlayer({ ...p, active: false }); });
  storage.addPlayer({ playerId: 'r9_x', displayName: 'Xena', active: true });
  storage.addPlayer({ playerId: 'r9_y', displayName: 'Yusuf', active: true });

  // Week A: tied, no tiebreaker, finalized arbitrarily (Xena wins by
  // insertion order) — will FLIP once its tiebreaker guesses are read.
  const WA = { weekId: 'r9_wa', weekNumber: 1, season: 2026, status: 'live', dataSourceMode: 'manual',
    actualTiebreakerValue: 12, tiebreakerFinalized: true, blurb: '', recap: '', groupId: null, isGroupTiebreaker: false };
  // actualTiebreakerValue is ALREADY set here (commissioner entered it before
  // ever finalizing) — DI-H is exercised by finalizing WITHOUT having run a
  // finalize since the guesses were captured, i.e. the FIRST finalize below
  // uses stale results (none), so the recompute is what produces them.
  storage.saveWeek({ ...WA, status: 'live' });
  storage.saveGame(mkGame('r9_wa', 'r9_wa_g1', 'Home1', 'Away1', 24, 20));
  storage.saveGame(mkGame('r9_wa', 'r9_wa_g2', 'Home2', 'Away2', 10, 24));
  storage.saveAllPicks([
    { pickId: 'r9_wa_pk_x1', weekId: 'r9_wa', gameId: 'r9_wa_g1', playerId: 'r9_x', selectedTeam: 'Home1' },
    { pickId: 'r9_wa_pk_x2', weekId: 'r9_wa', gameId: 'r9_wa_g2', playerId: 'r9_x', selectedTeam: 'Home2' },
    { pickId: 'r9_wa_pk_y1', weekId: 'r9_wa', gameId: 'r9_wa_g1', playerId: 'r9_y', selectedTeam: 'Away1' },
    { pickId: 'r9_wa_pk_y2', weekId: 'r9_wa', gameId: 'r9_wa_g2', playerId: 'r9_y', selectedTeam: 'Away2' },
  ]);
  storage.setTiebreakerGuess('r9_wa', 'r9_x', 999); // far away
  storage.setTiebreakerGuess('r9_wa', 'r9_y', 11);  // very close to 12

  // Finalize WITHOUT the tiebreaker having been considered — simulate the
  // exact bug report by finalizing once with actualTiebreakerValue temporarily
  // wiped, mirroring "finalized before its tiebreaker was entered".
  applyWeekStatusChange({ ...storage.getWeek('r9_wa'), actualTiebreakerValue: null }, 'final');
  storage.saveWeek({ ...storage.getWeek('r9_wa'), actualTiebreakerValue: 12, tiebreakerFinalized: true }); // entered AFTER, never recomputed until DI-H runs
  const beforeRecalc9 = storage.getWeeklyResults('r9_wa');
  assert(beforeRecalc9.find(r => r.isWinner)?.playerId === 'r9_x',
    `fixture check: the stale, pre-DI-H result still shows the arbitrary winner (Xena), got ${beforeRecalc9.find(r => r.isWinner)?.playerId}`);

  // Week B: a normal, already-correct, non-tied week — must show NO change.
  const WB = { weekId: 'r9_wb', weekNumber: 2, season: 2026, status: 'live', dataSourceMode: 'manual',
    actualTiebreakerValue: null, tiebreakerFinalized: false, blurb: '', recap: '', groupId: null, isGroupTiebreaker: false };
  storage.saveWeek(WB);
  storage.saveGame(mkGame('r9_wb', 'r9_wb_g1', 'Home1', 'Away1', 24, 20));
  storage.saveAllPicks([
    { pickId: 'r9_wb_pk_x1', weekId: 'r9_wb', gameId: 'r9_wb_g1', playerId: 'r9_x', selectedTeam: 'Home1' },
    { pickId: 'r9_wb_pk_y1', weekId: 'r9_wb', gameId: 'r9_wb_g1', playerId: 'r9_y', selectedTeam: 'Away1' },
  ]);
  applyWeekStatusChange(storage.getWeek('r9_wb'), 'final');

  // Week C: a DEMO week — must be SKIPPED entirely by the loop.
  const WC = { weekId: 'r9_wc', weekNumber: 3, season: 2026, status: 'final', dataSourceMode: 'demo',
    actualTiebreakerValue: null, tiebreakerFinalized: false, blurb: '', recap: '', groupId: null, isGroupTiebreaker: false };
  storage.saveWeek(WC);

  // Week D — reviewer's BLOCK item 4: DI-H's `status==='final'` clause was
  // unproven — removing it left [9] at 79/0, because this section only ever
  // seeded FINAL weeks. An OPEN (not-yet-final) week, with real games/picks
  // that WOULD produce a real winner/loser if finalizeWeek() were wrongly
  // run on it, closes that gap: if the filter regressed, the bulk button
  // would call finalizeWeek() on a week mid-week — creating weekly results,
  // possibly an obligation, and emitting week-final chat events before the
  // week is even locked.
  const WD = { weekId: 'r9_wd', weekNumber: 4, season: 2026, status: 'open', dataSourceMode: 'manual',
    actualTiebreakerValue: null, tiebreakerFinalized: false, blurb: '', recap: '', groupId: null, isGroupTiebreaker: false };
  storage.saveWeek(WD);
  storage.saveGame(mkGame('r9_wd', 'r9_wd_g1', 'Home1', 'Away1', 24, 20));
  storage.saveAllPicks([
    { pickId: 'r9_wd_pk_x1', weekId: 'r9_wd', gameId: 'r9_wd_g1', playerId: 'r9_x', selectedTeam: 'Home1' },
    { pickId: 'r9_wd_pk_y1', weekId: 'r9_wd', gameId: 'r9_wd_g1', playerId: 'r9_y', selectedTeam: 'Away1' },
  ]);
  assert(storage.getWeeklyResults('r9_wd').length === 0,
    'fixture check: week D genuinely has no weekly results yet — a real, unambiguous winner (Xena) is sitting there UNCOMPUTED, exactly what finalizeWeek() would produce if wrongly run on an open week');

  resetDom(); armToastCapture();
  el('recalc-all-weeks-btn');
  bindComm(storage.getWeek('r9_wa'), storage.getGames('r9_wa'));
  confirmCalls = []; confirmQueue = [true];
  el('recalc-all-weeks-btn')._fire('click');

  assert(confirmCalls.length === 1 && confirmCalls[0].includes("Recalculate every finalized week's results") && confirmCalls[0].includes('Nothing is deleted'),
    `confirm() carried DI-H's exact copy: "${confirmCalls[0]}"`);

  const afterRecalc9 = storage.getWeeklyResults('r9_wa');
  assert(afterRecalc9.find(r => r.isWinner)?.playerId === 'r9_y',
    `THE BULK RECOMPUTE FIRED — week A now correctly shows Yusuf as winner, got ${afterRecalc9.find(r => r.isWinner)?.playerId}`);

  assert(capturedToasts.length === 1 && capturedToasts[0].text.includes('Recalculated') && capturedToasts[0].text.includes('1 result changed'),
    `toast reports exactly one changed result: "${capturedToasts[0]?.text}"`);
  assert(capturedToasts[0].className.includes('warning'),
    'the changes-found toast uses the warning styling, not success');
  // Exactly 2 non-demo final weeks (A, B) were recalculated — the demo week
  // (C) and the OPEN week (D) are excluded from the count entirely.
  assert(capturedToasts[0].text.includes('Recalculated 2 weeks'),
    `toast counts only the 2 non-demo FINAL weeks, excluding the demo week AND the open week: "${capturedToasts[0]?.text}"`);

  // THE status==='final' CLAUSE, actually proven — week D (open) was never
  // touched: no weekly results were ever computed for it, no obligation was
  // created, and the week record itself is unchanged.
  assert(storage.getWeeklyResults('r9_wd').length === 0,
    'week D — the status==="final" filter held: an OPEN week produces NO weekly results even after the bulk recompute runs (finalizeWeek() was never called on it)');
  assert(storage.getActiveObligations('r9_wd').length === 0,
    'and no obligation was created for it either — finalizeWeek() genuinely never ran on this week');
  assert(storage.getWeek('r9_wd').status === 'open',
    'and the week record itself is untouched — still open, not silently advanced');

  const html9 = renderRecalculateFinalizedWeeksAdminSectionHTML();
  assert(html9.includes('data-comm-tab="data"') && html9.includes('id="recalc-all-weeks-btn"'),
    'the card markup itself carries the data-comm-tab="data" wrapper (RG-10) and the button id');
  assert(html9.includes('Week 1') && html9.includes('winner changed from Xena to Yusuf'),
    `the results panel now renders the persistent per-week change line: contains expected substrings? ${html9.includes('winner changed from Xena to Yusuf')}`);

  // ── Confirm Cancel aborts the whole operation — nothing recomputed.
  storage.saveWeek({ ...storage.getWeek('r9_wa'), actualTiebreakerValue: null }); // re-break it
  applyWeekStatusChange(storage.getWeek('r9_wa'), 'final'); // arbitrary again (Xena)
  resetDom(); armToastCapture();
  el('recalc-all-weeks-btn');
  bindComm(storage.getWeek('r9_wa'), storage.getGames('r9_wa'));
  confirmCalls = []; confirmQueue = [false];
  el('recalc-all-weeks-btn')._fire('click');
  assert(capturedToasts.length === 0, 'Cancel on the confirm() aborts entirely — no toast, no recompute');
  assert(storage.getWeeklyResults('r9_wa').find(r => r.isWinner)?.playerId === 'r9_x',
    'and the stale arbitrary result is left exactly as it was');
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
