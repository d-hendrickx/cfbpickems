/**
 * CFB Pickems — eptest.mjs
 * ========================
 * FEAT-9 / UN-176 — "Add extra point to standings" (Drew, fb_1789182374412_425pm,
 * 2026-09-12), plus his ruling the same day, verbatim:
 *
 *   "correct the extra point never affects the standing rank, but we need to
 *    keep track of the extra points for the end of the season so it's ok to
 *    display and record them."
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `js/extra-point.js` had NO dedicated suite before this: a grep across all
 * .mjs files found only loadtest.mjs, which runs the blackjack-grading
 * assertions inline among the chat-fold ones. This adds a season-scoped
 * aggregation over a BLIND-GATED week filter — exactly the kind of proof that
 * has to read start to finish rather than be buried (CONVENTIONS #28).
 *
 * THE TWO THINGS THAT WOULD MAKE THIS FEATURE A DEFECT
 * ---------------------------------------------------
 *   1. Counting an OPEN week. `week.extraPointActual` can be set while a week
 *      is still open, so a naive tally would tick somebody's `wins` up and tell
 *      the whole league who is winning the blackjack table while every guess is
 *      still editable. That is RG-40's leak through a third door, and knowing
 *      the field is more decisive in blackjack than knowing one ATS pick — you
 *      can sit one yard under whoever is highest and take the table. §4/§5.
 *   2. Extra Point becoming a standings input. AD-33 forbids it as a gate, a
 *      scoring input, or a second-level tiebreaker. §1/§2 — and `ranktest.mjs`
 *      must pass WITHOUT MODIFICATION. If it ever needs editing for this
 *      feature, the change is wrong and should be stopped, not adjusted.
 *
 * Run:  node eptest.mjs
 * Also: TZ=UTC node eptest.mjs && TZ=America/Los_Angeles node eptest.mjs
 *
 * SECTIONS
 *   1  AD-33 tripwire — js/scoring.js contains ZERO Extra-Point references,
 *      with an anchor check that the scan really read the file and canaries
 *      proving it is neither vacuous nor fooled by a rename (the shape
 *      ranktest.mjs §5 was rewritten to carry).
 *   2  Standings rank untouched — a fixture where the EP order and the
 *      standings rank are deliberately INVERTED; the Season Summary tbody
 *      still renders in seasonStandingsRows() order and carries no EP token.
 *   3  Tally math, hand-derived: blackjack, single winner, two-way push-win,
 *      all-bust week, a non-entrant, a player absent from every week.
 *   4  The inclusion predicate, one assertion per clause, each proven by
 *      flipping ONLY that clause and watching the counts move.
 *   5  The blind rule, three viewers, one store: unsubmitted player, submitted
 *      player, and the admin who can still edit. All three exclude the open week.
 *   6  Defensive: a junk / absent extraPointActual is not an all-bust week.
 *   7  Rendered HTML through window.navigateTo('leaderboard') — the card, its
 *      position, the AD-33 sub-line, every empty state, the pluralized footnote.
 *   8  CSV <-> card agreement: the exported rows, aggregated, equal the card's
 *      numbers exactly, and standings_season.csv gains no EP columns.
 *   9  escHtml() — a displayName containing <script> renders escaped in the
 *      card and is quoted, not injected, in the CSV.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / localStorage stubs (ordertest.mjs's shape — it is the suite that
//    already drives navigateTo() and reads emitted markup back) ──────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollTo() {}, focus() {},
  };
  els.set(id, e);
  return e;
}
['page-picks', 'games-list', 'page-dashboard', 'submitted-games',
 'page-leaderboard', 'header-meta-week'].forEach(mkEl);

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => els.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => mkEl('tmp'),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' },
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
globalThis.fetch = async () => { throw new Error('network disabled in eptest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] eptest.mjs — FEAT-9 / UN-176\n`);

const storage = await import('./js/storage.js');
const ep      = await import('./js/extra-point.js');
const app     = await import('./js/app.js');

const { seasonExtraPointTally, isCountedExtraPointWeek, gradeWeekExtraPoint } = ep;
const { canViewOtherPicks, renderExtraPointLedgerHTML, buildExtraPointCsvRows, seasonStandingsRows } = app;
const {
  saveWeek, getWeeks, saveGame, saveAllPicks, addPlayer, getPlayers,
  setSession, setBackendMode, setActiveWeekId, setExtraPointGuess,
} = storage;

// ═════════════════════════════════════════════════════════════════════════════
console.log('[1] AD-33 TRIPWIRE — js/scoring.js contains zero Extra-Point references…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // AD-33: "Season standings are computed from picks performance and the
  // intra-week tiebreaker ONLY. Extra Point is never a gate, never a scoring
  // input, and never a second-level tiebreaker." Ruling R3 (2026-09-12)
  // confirms it stands unamended. This is the whole-file form of the guard:
  // FEAT-9 must leave scoring.js exactly as it found it.
  const EP_TOKENS = [
    'extraPoint', 'ExtraPoint', 'EP_', 'extra-point',
    'gradeExtraPoint', 'EP_GUESSES', 'seasonExtraPointTally', 'isCountedExtraPointWeek',
  ];
  const scoringSrc = await readFile(new URL('./js/scoring.js', import.meta.url), 'utf8');

  // ANCHOR — "not found" and "found and clean" render identically, so prove
  // the scan actually read the real file first (the orienttest [4d] lesson:
  // a negative assertion with no anchor is worth nothing).
  assert(scoringSrc.length > 2000, `anchor: js/scoring.js was actually read (${scoringSrc.length} chars)`);
  assert(/export function calculateSeasonStandings\s*\(/.test(scoringSrc) &&
         /export function calculateWeeklyResults\s*\(/.test(scoringSrc),
    'anchor: the file scanned really is scoring.js — both season and weekly entry points present');

  const scanFor = (src, tokens) => src.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => tokens.some(t => l.includes(t)));

  const hits = scanFor(scoringSrc, EP_TOKENS);
  assert(hits.length === 0,
    `js/scoring.js carries ZERO Extra-Point references after FEAT-9, exactly as before it (found: ${JSON.stringify(hits.map(h => `${h.n}:${h.l.trim()}`))})`);

  // CANARY 1 — the scan is not vacuous: an injected EP read is caught.
  const canary1 = 'export function calculateSeasonStandings(p, r) {\n  const bonus = r.reduce((s, x) => s + (x.extraPointWins || 0), 0);\n  return bonus;\n}';
  assert(scanFor(canary1, EP_TOKENS).length === 1,
    'canary 1: an EP read injected into a scoring function IS caught — the guard is not vacuous');

  // CANARY 2 — a rename does not slip past: the token list covers the
  // module's own exported names, not just the literal string "extraPoint".
  const canary2 = 'import { seasonExtraPointTally } from "./extra-point.js";';
  assert(scanFor(canary2, EP_TOKENS).length === 1,
    'canary 2: importing the new season tally into scoring.js would be caught by name, not only by the generic token');

  // CANARY 3 — an unrelated word containing none of the tokens is NOT flagged,
  // so the guard cannot be "passing" by matching everything.
  assert(scanFor('const extraneous = pointsFor(player);', EP_TOKENS).length === 0,
    'canary 3: an unrelated line mentioning "extra"/"point" separately is not flagged — no fuzzy over-matching');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] AD-33 — the standings rank is untouched, with EP order INVERTED against it…');
// ═════════════════════════════════════════════════════════════════════════════
setBackendMode('local');

// Four players. The fixture is built so the EP order and the standings order
// are deliberately INVERTED: `zeta` wins the Extra Point outright and finishes
// LAST in the standings; `alpha` leads the standings with no EP win at all.
addPlayer({ playerId: 'alpha', displayName: 'Alpha', active: true, preferences: {} });
addPlayer({ playerId: 'bravo', displayName: 'Bravo', active: true, preferences: {} });
addPlayer({ playerId: 'charl', displayName: 'Charlie', active: true, preferences: {} });
addPlayer({ playerId: 'zeta',  displayName: 'Zeta',  active: true, preferences: {} });
const PLAYERS = () => getPlayers().filter(p => p.active);

function mkWeek(over = {}) {
  return {
    weekId: 'w_x', weekNumber: 1, season: 2026, name: 'Week 1',
    status: 'final', dataSourceMode: 'live',
    startDate: '2026-09-05', endDate: '2026-09-06',
    picksOpenAt: null, picksLockAt: null,
    tiebreakerQuestion: null, actualTiebreakerValue: null,
    showInHistory: true, blurb: null,
    extraPointEnabled: true, extraPointActual: null, extraPointDetect: null,
    ...over,
  };
}

/** Seed one EP week: the week record plus each player's guess. */
function seedEpWeek({ weekId, weekNumber, actual, guesses, ...over }) {
  const w = mkWeek({ weekId, weekNumber, extraPointActual: actual, ...over });
  saveWeek(w);
  for (const [pid, g] of Object.entries(guesses)) {
    if (g === null) continue;               // "no entry" — deliberately unset
    setExtraPointGuess(weekId, pid, g);
  }
  return w;
}

// W1: actual 52. zeta 52 -> BLACKJACK. bravo 50 -> alive/loss. alpha 60 -> bust.
//     charl: no entry.
seedEpWeek({ weekId: 'w_ep1', weekNumber: 1, actual: 52,
             guesses: { zeta: 52, bravo: 50, alpha: 60, charl: null } });
// W2: actual 45. zeta 44 and bravo 44 -> two-way PUSH-WIN (shared win, not a
//     draw). alpha 46 -> bust. charl 30 -> alive/loss.
seedEpWeek({ weekId: 'w_ep2', weekNumber: 2, actual: 45,
             guesses: { zeta: 44, bravo: 44, alpha: 46, charl: 30 } });
// W3: actual 40, EVERYONE over -> all busted, no winner.
seedEpWeek({ weekId: 'w_ep3', weekNumber: 3, actual: 40,
             guesses: { zeta: 55, bravo: 60, alpha: 41, charl: 44 } });

setSession('alpha', false, true);

{
  const tally = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
  const epOrder = tally.rows.map(r => r.playerId);
  assert(epOrder[0] === 'zeta',
    `fixture check: Zeta leads the EP ledger (${JSON.stringify(epOrder)})`);

  // The Standings page's own rows must be completely unaffected. Note the
  // standings here are driven by weekly RESULTS, of which there are none, so
  // every player is level — what matters is that the rendered table order is
  // seasonStandingsRows()' order and never the EP order, and that no EP token
  // appears in the table markup at all.
  setActiveWeekId('w_ep3');
  els.get('page-leaderboard')._html = '';
  window.navigateTo('leaderboard');
  const html = els.get('page-leaderboard')._html;

  const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const tableOrder = seasonStandingsRows().map(s => s.displayName);
  const renderedOrder = tableOrder
    .map(n => ({ n, i: tbody.indexOf(`>${n}<`) >= 0 ? tbody.indexOf(`>${n}<`) : tbody.indexOf(n) }))
    .filter(x => x.i >= 0).sort((a, b) => a.i - b.i).map(x => x.n);
  assert(JSON.stringify(renderedOrder) === JSON.stringify(tableOrder),
    `the Season Summary tbody renders in seasonStandingsRows() order, unchanged by FEAT-9 (got ${JSON.stringify(renderedOrder)})`);
  assert(!/Extra Point|extraPoint|🂡/.test(tbody),
    'the Season Summary table body contains no Extra Point column, label or symbol — the separation is structural, not a comment');

  const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  assert(head.includes('✅ Correct') && head.includes('Wk L') && !/Extra|EP\b/.test(head),
    'the Season Summary header row is the same seven columns it was — no EP column added');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] TALLY MATH — hand-derived, every outcome…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const tally = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
  const row = id => tally.rows.find(r => r.playerId === id);

  assert(tally.gradedWeeks === 3, `all three final weeks counted (got ${tally.gradedWeeks})`);

  // Zeta: W1 blackjack (win), W2 push-win (win), W3 bust. 2 wins, 1 blackjack,
  // 1 bust, entered all 3.
  const z = row('zeta');
  assert(z.wins === 2, `Zeta: 2 wins — a push-win is a SHARED WIN, not a draw (got ${z.wins})`);
  assert(z.blackjacks === 1, `Zeta: exactly 1 blackjack (got ${z.blackjacks})`);
  assert(z.busts === 1, `Zeta: 1 bust (got ${z.busts})`);
  assert(z.entries === 3, `Zeta: entered all 3 counted weeks (got ${z.entries})`);

  // Bravo: W1 alive-but-lost, W2 push-win, W3 bust. 1 win, 0 blackjacks.
  const b = row('bravo');
  assert(b.wins === 1 && b.blackjacks === 0 && b.busts === 1 && b.entries === 3,
    `Bravo: 1 win (the shared one), 0 blackjacks, 1 bust, 3 entries (got ${JSON.stringify([b.wins, b.blackjacks, b.busts, b.entries])})`);

  // Alpha: bust, bust, bust. Zero wins. Still a row.
  const a = row('alpha');
  assert(a.wins === 0 && a.busts === 3 && a.entries === 3,
    `Alpha: 0 wins, 3 busts, 3 entries (got ${JSON.stringify([a.wins, a.busts, a.entries])})`);

  // Charlie: NO ENTRY in W1. A no-entry is NOT a bust and NOT a loss — it
  // simply does not count toward `entries`.
  const c = row('charl');
  assert(c.entries === 2, `Charlie entered 2 of 3 — a no-entry week is not counted as an entry (got ${c.entries})`);
  assert(c.busts === 1, `Charlie's no-entry week is NOT recorded as a bust (1 real bust in W3, got ${c.busts})`);

  // All-bust week (W3) gave wins to nobody.
  const w3 = gradeWeekExtraPoint(getWeeks().find(w => w.weekId === 'w_ep3'), PLAYERS());
  assert(w3.allBusted === true && w3.winners.length === 0,
    'W3 is a genuine all-bust week: nobody is credited with a win');
  assert(tally.rows.reduce((s, r) => s + r.wins, 0) === 3,
    'total wins across the season = 1 (blackjack) + 2 (the shared week) + 0 (all-bust) = 3');

  // A player absent from every week still gets a row — an absent row would be
  // read as "this player left the league".
  addPlayer({ playerId: 'ghost', displayName: 'Ghost', active: true, preferences: {} });
  const withGhost = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
  const g = withGhost.rows.find(r => r.playerId === 'ghost');
  assert(!!g && g.wins === 0 && g.entries === 0,
    'a player who never entered still has a row, reading 0 wins / 0 entries — never omitted');
  // DI-176e's comparator, applied literally: wins desc -> blackjacks desc ->
  // busts ASC. A player who never entered (0 busts) therefore sorts ABOVE one
  // who entered and busted three times, and below anyone with a win. That is
  // the approved ordering, asserted here so it is a decision on the record
  // rather than an accident.
  const ghostIdx = withGhost.rows.findIndex(r => r.playerId === 'ghost');
  const alphaIdx = withGhost.rows.findIndex(r => r.playerId === 'alpha');
  const zetaIdx  = withGhost.rows.findIndex(r => r.playerId === 'zeta');
  assert(ghostIdx > zetaIdx && ghostIdx < alphaIdx,
    `a never-entered player sorts below every winner and above a three-time buster — busts ASC, per DI-176e (zeta ${zetaIdx}, ghost ${ghostIdx}, alpha ${alphaIdx})`);

  // The tally NEVER reimplements grading: same function the recap card calls.
  const w1 = gradeWeekExtraPoint(getWeeks().find(w => w.weekId === 'w_ep1'), PLAYERS());
  assert(w1.rows.find(r => r.playerId === 'zeta').outcome === 'blackjack',
    'the week grader and the season tally agree about W1 — one grader, two views (CONVENTIONS #21)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] INCLUSION PREDICATE — one clause at a time, flipped in isolation…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const base = () => seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks }).gradedWeeks;
  const before = base();
  assert(before === 3, `baseline: 3 counted weeks (got ${before})`);

  const flip = (over, label, expected = 2) => {
    const original = getWeeks().find(w => w.weekId === 'w_ep2');
    saveWeek({ ...original, ...over });
    const after = base();
    saveWeek(original);                      // restore, in-memory fixture only
    assert(after === expected, `${label} — counted weeks ${before} -> ${after}`);
    assert(base() === before, `${label}: …and restoring the clause restores the count`);
  };

  flip({ extraPointEnabled: false }, 'extraPointEnabled === false excludes the week entirely (numerator AND denominator)');
  flip({ extraPointActual: null },   'extraPointActual == null excludes the week');
  flip({ dataSourceMode: 'demo' },   'dataSourceMode === "demo" excludes the week (UN-71, matching seasonStandingsRows)');
  flip({ showInHistory: false },     'showInHistory === false excludes the week (same visibility rule as the standings)');
  flip({ status: 'open' },           'status "open" excludes the week — THE BLIND GATE (canViewOtherPicks false while picks are editable)');
  flip({ status: 'draft' },          'a DRAFT week is excluded and is not even reported as waiting on a result');

  // A demo week is invisible in BOTH directions — nobody is shown as having
  // missed it, and it is not in anyone's denominator.
  {
    const original = getWeeks().find(w => w.weekId === 'w_ep2');
    saveWeek({ ...original, dataSourceMode: 'demo' });
    const t = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
    assert(t.rows.find(r => r.playerId === 'zeta').entries === 2,
      'a demo week is absent from the entries DENOMINATOR too, not merely from the wins');
    saveWeek(original);
  }

  // pendingWeeks: eligible-but-not-counted. A LIVE week with a result counts;
  // an OPEN one with the same result does not, and is reported as pending.
  {
    const original = getWeeks().find(w => w.weekId === 'w_ep2');
    saveWeek({ ...original, status: 'open' });
    const t = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
    assert(t.gradedWeeks === 2 && t.pendingWeeks === 1,
      `an OPEN week with a result on file is excluded and reported as pending (graded ${t.gradedWeeks}, pending ${t.pendingWeeks})`);
    saveWeek({ ...original, status: 'live' });
    const live = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
    assert(live.gradedWeeks === 3 && live.pendingWeeks === 0,
      'a LIVE week with a result IS counted — the commissioner decides when the number is final, and the blind gate opens at live');
    saveWeek(original);
  }

  // Grouped / multi-part weeks: each record counts on its own. There is no
  // pooled EP concept anywhere in the codebase and none is invented here.
  {
    const w = getWeeks().find(x => x.weekId === 'w_ep1');
    saveWeek({ ...w, groupId: 'grp_a' });
    const w2 = getWeeks().find(x => x.weekId === 'w_ep2');
    saveWeek({ ...w2, groupId: 'grp_a' });
    const t = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
    assert(t.gradedWeeks === 3,
      'two week records sharing a groupId still count as TWO Extra Point weeks — grouping applies to weekly obligations, not to this');
    saveWeek({ ...w, groupId: undefined });
    saveWeek({ ...w2, groupId: undefined });
  }

  // Fail-closed default: with no predicate injected, nothing counts.
  assert(seasonExtraPointTally(getWeeks(), PLAYERS()).gradedWeeks === 0,
    'with no blind predicate supplied the tally is fail-CLOSED — zero counted weeks, never "assume visible"');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] THE BLIND RULE — three viewers, one store, one open week (RG-40 restated)…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // An OPEN week with a result already entered, exactly the state
  // renderCommExtraPointCardHTML() warns about in its own comment.
  seedEpWeek({ weekId: 'w_open', weekNumber: 4, actual: 48, status: 'open',
               guesses: { zeta: 47, bravo: 30, alpha: 20, charl: 10 } });
  // alpha + bravo have submitted picks on that week; charlie has not.
  saveGame({ gameId: 'w_open_g1', weekId: 'w_open', homeTeam: 'H', awayTeam: 'A',
             kickoff: '2026-10-03T18:00:00Z', status: 'scheduled', spread: -3, favorite: 'H',
             lockedSpread: null, homeScore: null, awayScore: null, actualWinner: null, atsWinner: null });
  saveAllPicks([
    { pickId: 'op_a', weekId: 'w_open', gameId: 'w_open_g1', playerId: 'alpha', selectedTeam: 'H', submittedAt: '2026-10-01T00:00:00Z' },
    { pickId: 'op_b', weekId: 'w_open', gameId: 'w_open_g1', playerId: 'bravo', selectedTeam: 'H', submittedAt: '2026-10-01T00:00:00Z' },
  ]);

  const viewers = [
    ['charl', false, 'a signed-in player who has NOT submitted'],
    ['bravo', false, 'a signed-in player who HAS submitted (submitting does not earn the right to see — UN-116)'],
    ['alpha', true,  'the COMMISSIONER, who entered the number himself and can still edit his own picks (RG-37)'],
  ];
  for (const [pid, isAdmin, label] of viewers) {
    setSession(pid, isAdmin, true);
    const t = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
    const zeta = t.rows.find(r => r.playerId === 'zeta');
    assert(t.gradedWeeks === 3,
      `${label}: the OPEN week contributes nothing — still 3 counted weeks (got ${t.gradedWeeks})`);
    assert(zeta.wins === 2,
      `${label}: nobody's win count moved on the open week (Zeta still ${zeta.wins})`);
    assert(t.pendingWeeks === 1, `${label}: …and it is reported as a week still waiting`);
  }

  // The gate is THE app's definition, injected — not a copy of its logic.
  {
    const openWeek = getWeeks().find(w => w.weekId === 'w_open');
    setSession('charl', false, true);
    assert(canViewOtherPicks(openWeek) === false,
      'canViewOtherPicks() itself says false on this week — the tally is asking the one predicate, not reimplementing it');
    assert(isCountedExtraPointWeek(openWeek, { canViewOtherPicks }) === false,
      'isCountedExtraPointWeek() ends on that same predicate');
    assert(isCountedExtraPointWeek(openWeek, { canViewOtherPicks: () => true }) === true,
      'and it is genuinely THAT clause doing the work: forcing the predicate true admits the same week — proof the exclusion is the blind gate, not some other filter');
  }

  // Once it goes live, the counts move — the promise the empty-state copy makes.
  {
    const openWeek = getWeeks().find(w => w.weekId === 'w_open');
    saveWeek({ ...openWeek, status: 'live' });
    const t = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
    assert(t.gradedWeeks === 4 && t.rows.find(r => r.playerId === 'zeta').wins === 3,
      'once the week goes LIVE the counts move — Zeta picks up the fourth week');
    saveWeek(openWeek);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] DEFENSIVE — junk / absent extraPointActual is not an all-bust week…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const baseline = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
  for (const junk of ['abc', undefined, '', NaN, {}]) {
    const original = getWeeks().find(w => w.weekId === 'w_ep3');
    saveWeek({ ...original, extraPointActual: junk });
    const t = seasonExtraPointTally(getWeeks(), PLAYERS(), { canViewOtherPicks });
    assert(t.gradedWeeks === baseline.gradedWeeks - 1,
      `extraPointActual = ${JSON.stringify(junk)} -> the week is NOT counted`);
    assert(t.rows.every(r => Number.isFinite(r.wins) && Number.isFinite(r.busts)),
      `extraPointActual = ${JSON.stringify(junk)} -> no NaN reaches any row`);
    assert(t.rows.reduce((s, r) => s + r.busts, 0) < baseline.rows.reduce((s, r) => s + r.busts, 0),
      `extraPointActual = ${JSON.stringify(junk)} -> nobody is credited with a phantom bust`);
    saveWeek(original);
  }
  const html = renderExtraPointLedgerHTML();
  assert(!/NaN/.test(html), 'no "NaN" ever reaches the rendered card');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] RENDERED HTML — through window.navigateTo("leaderboard")…');
// ═════════════════════════════════════════════════════════════════════════════
function standingsHtml() {
  els.get('page-leaderboard')._html = '';
  window.navigateTo('leaderboard');
  return els.get('page-leaderboard')._html;
}
{
  setSession('charl', false, true);
  // §5 left `w_open` OPEN with a result on file, which is permanently pending
  // by design. Finalize it here so the footnote states below start from a
  // known zero rather than inheriting another section's fixture.
  saveWeek({ ...getWeeks().find(w => w.weekId === 'w_open'), status: 'final' });
  const html = standingsHtml();

  assert(html.includes('🎯 Extra Point Ledger'), 'the 🎯 Extra Point Ledger card renders on Standings');
  assert(html.includes('Longest made field goal, blackjack rules. Tracked all season — it never affects the standings.'),
    'the AD-33 sub-line is present, verbatim — the separation is said out loud, not implied by the card boundary');

  const iSummary = html.indexOf('Season Summary');
  const iLedger  = html.indexOf('🎯 Extra Point Ledger');
  const iAlma    = html.indexOf('⭐ Alma Mater Rankings');
  assert(iSummary >= 0 && iLedger > iSummary && iAlma > iLedger,
    `the card sits BETWEEN Season Summary and Alma Mater Rankings (${iSummary} < ${iLedger} < ${iAlma})`);

  assert(/class="ep-row ep-ledger-row"/.test(html), 'rows reuse the existing .ep-row layout players already know from the recap');
  assert(/Weeks won/.test(html), 'the "Weeks won" column heading is in the markup (screen readers always; visible at >=600px)');
  assert(!/title=/.test(html.slice(iLedger, iAlma)), 'no title attribute anywhere in the card — tooltips do not fire on touch');
  assert(!/👑|🤡/.test(html.slice(iLedger, iAlma)), 'no crown and no clown inside the card — those are rank semantics from the table above');
  assert(!/rank-cell/.test(html.slice(iLedger, iAlma)), 'no rank numbers inside the card');

  // The detail line: segments omitted at zero, "entered" always shown.
  assert(/2 🂡|1 🂡/.test(html), 'the blackjack segment renders with the existing 🂡 vocabulary');
  assert(/of \d+ entered/.test(html), 'the "N of M entered" segment always renders');
  const alphaSeg = html.slice(html.indexOf('>Alpha<'), html.indexOf('>Alpha<') + 400);
  assert(!alphaSeg.includes('🂡'), 'a player with zero blackjacks gets NO blackjack segment (omitted at zero, not rendered as "0 🂡")');

  // Pending footnote, both plural forms.
  {
    const original = getWeeks().find(w => w.weekId === 'w_ep2');
    saveWeek({ ...original, extraPointActual: null });
    const one = standingsHtml();
    // F1 review note F4 (2026-09-12) — copy changed from "still waiting on a
    // result" to "isn't counted yet". A week can sit in this count for TWO
    // reasons: no result posted yet, or the blind gate still closed on a week
    // that is fully graded. The old wording asserted the first and was simply
    // false in the second case; the new wording is true under both and reveals
    // which one applies in neither.
    assert(one.includes("1 week isn't counted yet."), 'the pending footnote is singular for one week, verbatim');
    const w3 = getWeeks().find(w => w.weekId === 'w_ep3');
    saveWeek({ ...w3, extraPointActual: null });
    const two = standingsHtml();
    assert(two.includes("2 weeks aren't counted yet."), 'the pending footnote pluralizes correctly');
    assert(!two.includes('waiting on a result'),
      'the retired "waiting on a result" wording is gone from the rendered card — it claimed a cause the count does not know');
    saveWeek(original); saveWeek(w3);
  }
  assert(!standingsHtml().includes("counted yet"),
    'with every week graded the footnote is absent entirely — no zero-state noise');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] CSV <-> CARD agreement, and standings_season.csv unchanged…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const players = PLAYERS();
  const rows = buildExtraPointCsvRows(getWeeks(), players);
  const header = rows[0];
  assert(JSON.stringify(header) === JSON.stringify(['Week', 'Week Id', 'Player', 'Guess (yd)', 'Actual (yd)', 'Outcome', 'Delta', 'Winner']),
    `the export is one row per player per counted week, at audit granularity (header: ${JSON.stringify(header)})`);

  const body = rows.slice(1);
  const tally = seasonExtraPointTally(getWeeks(), players, { canViewOtherPicks });
  const winsFromCsv = {};
  const bustsFromCsv = {};
  for (const r of body) {
    const name = r[2];
    if (r[7] === 'yes') winsFromCsv[name] = (winsFromCsv[name] || 0) + 1;
    if (r[5] === 'bust') bustsFromCsv[name] = (bustsFromCsv[name] || 0) + 1;
  }
  for (const row of tally.rows) {
    assert((winsFromCsv[row.displayName] || 0) === row.wins,
      `${row.displayName}: exported winner rows sum to the card's win count (${winsFromCsv[row.displayName] || 0} vs ${row.wins})`);
    assert((bustsFromCsv[row.displayName] || 0) === row.busts,
      `${row.displayName}: exported bust rows sum to the card's bust count (${bustsFromCsv[row.displayName] || 0} vs ${row.busts})`);
  }
  assert(body.length === tally.gradedWeeks * players.length,
    `the export carries exactly gradedWeeks x players rows (${body.length} = ${tally.gradedWeeks} x ${players.length})`);

  const outcomes = new Set(body.map(r => r[5]));
  assert([...outcomes].every(o => ['blackjack', 'win', 'push-win', 'alive', 'bust', 'no-entry'].includes(o)),
    `Outcome emits the RAW outcome key, never the EP_OUTCOME_LABEL display string — an audit trail has to be greppable (saw ${JSON.stringify([...outcomes])})`);
  assert(![...outcomes].some(o => /🂡|💥|BLACKJACK|BUST/.test(o)), 'no display label leaked into the Outcome column');

  // An OPEN week is absent from the CSV for the same reason it is absent from
  // the card — one predicate, two surfaces.
  {
    const original = getWeeks().find(w => w.weekId === 'w_ep1');
    saveWeek({ ...original, status: 'open' });
    const blinded = buildExtraPointCsvRows(getWeeks(), players).slice(1);
    assert(blinded.every(r => r[1] !== 'w_ep1'),
      'a blinded (OPEN) week exports no rows at all — the CSV cannot be used to read around the blind gate');
    saveWeek(original);
  }

  // Decision 1: standings_season.csv gains nothing.
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const standingsFn = appSrc.slice(appSrc.indexOf('function exportStandingsCSV()'));
  const standingsBody = standingsFn.slice(0, standingsFn.indexOf('\n}\n'));
  assert(standingsBody.includes('standings_season.csv'), 'anchor: exportStandingsCSV() located and really is the standings export');
  assert(!/extraPoint|ExtraPoint|EP_|Extra Point/.test(standingsBody),
    'exportStandingsCSV() gains NO Extra Point columns — the easiest way to make a future reader conclude EP is a standings input (AD-33)');

  // Decision 3: the new export must NOT inherit I-11 (the standings export's
  // missing demo filter). Proven behaviourally, not by reading the source.
  {
    const original = getWeeks().find(w => w.weekId === 'w_ep1');
    saveWeek({ ...original, dataSourceMode: 'demo' });
    const demoRows = buildExtraPointCsvRows(getWeeks(), players).slice(1);
    assert(demoRows.every(r => r[1] !== 'w_ep1'),
      'a DEMO week exports no rows — the new export does not copy exportStandingsCSV()\'s missing demo filter (inherited item I-11, flagged not fixed)');
    saveWeek(original);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] escHtml — a hostile displayName…');
// ═════════════════════════════════════════════════════════════════════════════
{
  addPlayer({ playerId: 'evil', displayName: '<script>alert(1)</script>', active: true, preferences: {} });
  setExtraPointGuess('w_ep1', 'evil', 51);
  const html = renderExtraPointLedgerHTML();
  assert(!html.includes('<script>alert(1)</script>'), 'the hostile displayName is not injected raw into the card');
  assert(html.includes('&lt;script&gt;'), 'it is escaped through escHtml() — every time, no exceptions');

  const rows = buildExtraPointCsvRows(getWeeks(), PLAYERS());
  const evilRow = rows.slice(1).find(r => String(r[2]).includes('script'));
  assert(!!evilRow && String(evilRow[2]) === '<script>alert(1)</script>',
    'the CSV carries the raw value in its own cell (csvCell quotes it on serialize) — escaping is an HTML concern, not a CSV one');
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
