/**
 * CFB Pickems — layouttest.mjs
 * ============================
 * FEAT-8 — customizable layout + Picks page order. ONE file for both halves.
 *
 *   PART B (§1-§9, pass F1)  — UN-177 + UN-178: the Picks page reading order,
 *     via the `#picks-head-slot` mechanism.
 *   PART A (§A1-§A10, pass F2) — UN-179: per-player Dashboard/Standings
 *     section order. Appended to this file, as planned, rather than to a new
 *     one: it is the same feature and the same discipline.
 *
 * Part A's own header, fixtures and section map begin under the PART A banner
 * about two-thirds of the way down.
 *
 * WHAT DREW ASKED FOR, VERBATIM
 * -----------------------------
 *   "the layout for the picks should start with the weekly blurb, then have the
 *    last weeks recap, then any version info and THEN the list of weekly picks."
 *   (correction, 2026-09-12) "the 'whats new' should be at the top of the picks
 *    page under the blurb instead of at the bottom."
 *   (amendment, 2026-09-12 — UN-178) "in addition to the whats new being before
 *    the picks, I also want the previous week recap before the picks and under
 *    the blurb."
 *
 * The approved order, all five branches (D-1: What's New ABOVE the recap; D-3:
 * the lock countdown / picks timing stays ABOVE both; D-2: the recap does NOT
 * collapse):
 *
 *   [week nav] -> blurb -> [countdown / timing] -> What's New -> recap
 *              -> the branch's primary content
 *
 * WHY THESE ASSERTIONS READ THE DOM AND NEVER A SOURCE WINDOW
 * ----------------------------------------------------------
 * UN-124's own ledger row records that one of the builder's placement
 * assertions initially passed against the very regression it existed to catch,
 * because it read too narrow a source window. So every ordering assertion below
 * is driven through `window.navigateTo('picks')` — the same entry point the
 * bottom nav uses — and reads the ORDER OF MARKERS IN THE EMITTED HTML.
 *
 * Run:  node layouttest.mjs
 * Also: TZ=UTC node layouttest.mjs && TZ=America/Los_Angeles node layouttest.mjs
 *
 * SECTIONS (Part B)
 *   1  Fixture integrity — the five branches really are five different renders.
 *   2  The slot exists in all five branches (so the `beforeend` fallback,
 *      which exists only so a future branch degrades to "wrong place" rather
 *      than "missing", never fires in practice).
 *   3  ORDER, per branch: blurb < [timing] < What's New < recap < primary content.
 *   4  UN-124 anti-regression: the What's New card still REACHES every branch,
 *      including a logged-in player's.
 *   5  UN-178: the recap reaches a signed-in NON-admin in branches C, D and E,
 *      the admin, and the signed-out visitor. Branch A is unchanged.
 *   6  No remnant: the emitted HTML never contains an unfilled `picks-head-slot`
 *      and never an empty card shell.
 *   7  Blind rule: branch A on a LOCKED, non-public historical week, viewed
 *      signed out, still emits the 🔒 notice and no .hist-pick badge — with the
 *      head slot filled.
 *   8  The `beforeend` fallback still works for a container with no slot.
 */

import { readFile } from 'node:fs/promises';

// ═════════════════════════════════════════════════════════════════════════════
// DOM stubs. ordertest.mjs's shape, with ONE addition that matters: #page-picks
// supports querySelector('#picks-head-slot') and an outerHTML setter on the
// returned node, because that is the mechanism under test. A stub that returned
// null there would silently exercise the `beforeend` fallback and every order
// assertion below would be testing the OLD behaviour.
// ═════════════════════════════════════════════════════════════════════════════
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const SLOT_MARKUP = '<div id="picks-head-slot"></div>';

/**
 * F2 review note (g), 2026-09-12 — CLICKABLE BUTTONS PARSED OUT OF `_html`.
 *
 * The stub's querySelectorAll() returned [] for everything, so
 * bindLayoutEditHandlers() bound nothing and §A4/§A5 had to call moveSection()
 * and clearSectionOrder() DIRECTLY. That left the handler's own wiring — which
 * `dataset` key it reads, which pageKey it passes to the reset — completely
 * uncovered: renaming `data-move-id` to `data-moveid` in app.js kept the suite
 * at 171/0. The reviewer proved it; this closes it.
 *
 * Scoped deliberately to the three edit-mode button classes. Every other
 * selector still returns [], so nothing else in this suite changes behaviour —
 * a stub that suddenly returned nodes for `.pick-btn` and friends would be a
 * much larger change than the gap it is closing.
 *
 * The parsed objects are CACHED per host until the next write to `_html`, so
 * the object the binder attached a listener to is the same object the test
 * clicks afterwards.
 */
const CLICKABLE = ['.section-move-btn', '.layout-reset-btn', '.layout-edit-btn'];
function parseClickables(html, sel) {
  const cls = sel.slice(1);
  const out = [];
  for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
    const attrs = m[1];
    if (!new RegExp(`class="[^"]*\\b${cls}\\b`).test(attrs)) continue;
    const dataset = {};
    for (const a of attrs.matchAll(/data-([a-zA-Z-]+)="([^"]*)"/g)) {
      dataset[a[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a[2];
    }
    const handlers = [];
    out.push({
      dataset, disabled: /\bdisabled\b/.test(attrs),
      addEventListener(type, fn) { if (type === 'click') handlers.push(fn); },
      removeEventListener() {},
      click() { handlers.forEach(fn => fn()); },
      _bound: () => handlers.length,
    });
  }
  return out;
}

const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {}, _qsa: new Map(),
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this._qsa.clear(); },
    // NB: insertAdjacentHTML deliberately does NOT clear the parsed-button cache.
    // renderDashboard() appends the chat teaser AFTER renderDashboardInner() has
    // already bound the edit-mode handlers, and clearing here would throw away
    // the very objects those listeners are attached to. Nothing in CLICKABLE is
    // ever emitted through an append — the edit strip and move bars are written
    // with the page's innerHTML, which does clear it.
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector(sel) {
      if (sel !== '#picks-head-slot' || !this._html.includes(SLOT_MARKUP)) return null;
      const host = this;
      return {
        get outerHTML() { return SLOT_MARKUP; },
        set outerHTML(h) { host._html = host._html.replace(SLOT_MARKUP, h); host._qsa.clear(); },
      };
    },
    querySelectorAll(sel) {
      if (!CLICKABLE.includes(sel)) return [];
      if (!this._qsa.has(sel)) this._qsa.set(sel, parseClickables(this._html, sel));
      return this._qsa.get(sel);
    },
    closest: () => null,
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
globalThis.fetch = async () => { throw new Error('network disabled in layouttest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] layouttest.mjs — FEAT-8: PART B (UN-177 + UN-178) then PART A (UN-179)\n`);

const storage = await import('./js/storage.js');
const app     = await import('./js/app.js');
const {
  saveWeek, saveGame, saveAllPicks, addPlayer, setSession, setBackendMode,
  setActiveWeekId, getWeeks,
} = storage;

setBackendMode('local');

// ── FIXTURES ────────────────────────────────────────────────────────────────
addPlayer({ playerId: 'p1', displayName: 'Drew',    active: true, pin: '1111', preferences: {} });
addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true, pin: '2222', preferences: {} });

function mkWeek(over) {
  return {
    weekId: 'w', weekNumber: 1, season: 2026, name: 'Week 1',
    status: 'open', dataSourceMode: 'live',
    startDate: '2026-09-05', endDate: '2026-09-06',
    picksOpenAt: null, picksLockAt: null,
    tiebreakerQuestion: 'Total points?', actualTiebreakerValue: null,
    showInHistory: true,
    // The blurb is the anchor the whole ordering is measured against — Drew's
    // "start with the weekly blurb".
    blurb: 'WEEK BLURB MARKER',
    extraPointEnabled: false, extraPointActual: null, extraPointDetect: null,
    ...over,
  };
}
function mkGame(weekId, id, home, away, kickoff) {
  return {
    gameId: `${weekId}_${id}`, weekId, espnEventId: null,
    dataQuality: 'manual', dataSource: 'manual',
    homeTeam: home, awayTeam: away, homeConference: 'SEC', awayConference: 'SEC',
    homeRank: null, awayRank: null,
    kickoff, kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening',
    spread: -3.5, favorite: home, lockedSpread: null,
    homeScore: null, awayScore: null, status: 'scheduled',
    actualWinner: null, atsWinner: null, isAlmaMaterGame: false,
    spreadSource: 'manual', oddsProvider: null, lastUpdated: null,
    venue: null, venueDisplay: null, neutralSite: false, multiplier: 1,
  };
}

// The CURRENT week — open, one game, kickoff far enough out that the countdown
// renders and picks are submittable.
const FUTURE = new Date(Date.now() + 7 * 86400_000).toISOString();
const cur = mkWeek({ weekId: 'w_cur', weekNumber: 2 });
saveWeek(cur);
saveGame(mkGame('w_cur', 'g1', 'PRIMARY HOME', 'PRIMARY AWAY', FUTURE));

// A PAST, finalized week for branch A — with results, so the recap card
// actually builds (buildWeekStorylines returns null without them).
const past = mkWeek({ weekId: 'w_past', weekNumber: 1, status: 'final', blurb: 'PAST BLURB MARKER' });
saveWeek(past);
saveGame({ ...mkGame('w_past', 'g1', 'PAST HOME', 'PAST AWAY', '2026-09-05T23:00:00Z'),
           status: 'final', homeScore: 28, awayScore: 21, actualWinner: 'PAST HOME', atsWinner: 'PAST HOME' });
saveAllPicks([
  { pickId: 'pp1', weekId: 'w_past', gameId: 'w_past_g1', playerId: 'p1', selectedTeam: 'PAST HOME', submittedAt: '2026-09-04T00:00:00Z' },
  { pickId: 'pp2', weekId: 'w_past', gameId: 'w_past_g1', playerId: 'p2', selectedTeam: 'PAST AWAY', submittedAt: '2026-09-04T00:00:00Z' },
]);
storage.saveAllWeeklyResults('w_past', [
  { weekId: 'w_past', playerId: 'p1', rank: 1, correctPicks: 1, incorrectPicks: 0, correctCount: 1, incorrectCount: 0, noDecisions: 0, isWinner: true, isLoser: false },
  { weekId: 'w_past', playerId: 'p2', rank: 2, correctPicks: 0, incorrectPicks: 1, correctCount: 0, incorrectCount: 1, noDecisions: 0, isWinner: false, isLoser: true },
]);

setActiveWeekId('w_cur');

// ── Markers. Each is a literal that appears exactly once and only in the thing
//    it names, so first-index position is an unambiguous proxy for order.
const M = {
  blurb:    'WEEK BLURB MARKER',
  pastBlurb:'PAST BLURB MARKER',
  countdown:'lock-countdown',       // renderLockCountdownHTML
  timing:   'picks-timing',         // renderPicksTiming
  whatsNew: "🆕 What's new",
  // COORDINATOR RULING 2 (reviewer F3) — 'recap-card' matched BOTH the weekly
  // recap and the 2K25 Permanent Record, so the suite could not tell which card
  // it had found. That is exactly the confusion the ruling exists to remove: the
  // head slot may hold the week recap and must never hold the season summary.
  // Split into two markers that cannot collide:
  weekRecap:    'Recap</h3>',       // renderWeekRecapCardHTML's own heading
  seasonSummary:'recap-season',     // renderSeasonSummaryHTML's extra class
  slot:     'picks-head-slot',
  login:    '👤 Who Are You?',
  games:    'id="games-list"',
  submitted:'id="submitted-games"',
  locked:   'week-status-card',
  histRows: 'hist-game-row',
};

function renderPicks({ playerId = null, isAdmin = false, verified = false, viewWeekId = null } = {}) {
  setSession(playerId, isAdmin, verified);
  app.state.picksWeekId = viewWeekId;
  els.get('page-picks')._html = '';
  window.navigateTo('picks');
  return els.get('page-picks')._html;
}
const at = (html, marker) => html.indexOf(marker);
const has = (html, marker) => html.indexOf(marker) >= 0;

// Branch renders, taken once and reused by every section below.
const branches = {};
branches.B = renderPicks({});                                                     // signed out
branches.C = renderPicks({ playerId: 'p1', verified: true });                     // picking
saveAllPicks([{ pickId: 'cp1', weekId: 'w_cur', gameId: 'w_cur_g1', playerId: 'p1', selectedTeam: 'PRIMARY HOME', submittedAt: '2026-09-05T00:00:00Z' }]);
branches.D = renderPicks({ playerId: 'p1', verified: true });                     // submitted
saveWeek({ ...cur, status: 'locked' });
// p2 deliberately, NOT p1: p1 has submitted above, and a submitted player on a
// locked week still lands in the submitted view. Branch E is the "signed in and
// cannot submit" render, which needs a player with no picks on file.
branches.E = renderPicks({ playerId: 'p2', verified: true });                     // locked, signed in
saveWeek(cur);                                                                    // back to open
branches.A = renderPicks({ playerId: 'p1', verified: true, viewWeekId: 'w_past' }); // historical

// ═════════════════════════════════════════════════════════════════════════════
console.log('[1] FIXTURE INTEGRITY — five genuinely different branches…');
// ═════════════════════════════════════════════════════════════════════════════
{
  assert(has(branches.B, M.login), '1a: branch B is the signed-out login screen (👤 Who Are You?)');
  assert(has(branches.C, M.games) && !has(branches.C, M.submitted), '1b: branch C is the editable picks list (#games-list)');
  assert(has(branches.D, M.submitted), '1c: branch D is the submitted view (#submitted-games)');
  assert(has(branches.E, M.locked), '1d: branch E is the locked week-status card');
  assert(has(branches.A, M.pastBlurb) && has(branches.A, M.histRows), '1e: branch A is the read-only historical week');
  const uniq = new Set(Object.values(branches));
  assert(uniq.size === 5, `1f: all five renders are distinct markup (got ${uniq.size} unique)`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] THE SLOT — emitted by every branch, so the fallback never fires…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const slotEmits = (appSrc.match(/<div id="picks-head-slot"><\/div>/g) || []).length;
  assert(slotEmits === 5,
    `2a: exactly five branches emit a head slot — A (historical), B (login), C (picking), D (submitted), E (locked) (found ${slotEmits})`);
  assert(/function fillPicksHeadSlot\(c, recapHtml\)[\s\S]{0,400}slot \? slot\.outerHTML = head : c\.insertAdjacentHTML\('beforeend', head\)/.test(
      appSrc.replace(/\s*\n\s*/g, ' ').replace(/if \(slot\) slot\.outerHTML = head; else /, 'slot ? slot.outerHTML = head : ')),
    '2b: fillPicksHeadSlot() falls back to beforeend when no slot exists — a future branch without a slot degrades to "wrong place", never to "missing"');
  for (const [name, html] of Object.entries(branches)) {
    assert(!has(html, M.slot),
      `2c-${name}: branch ${name}'s slot was FILLED and consumed — no unfilled picks-head-slot survives into the emitted HTML`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] ORDER — blurb -> [timing] -> What\'s New -> recap -> content…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Branch B — signed out: nav -> blurb -> countdown -> What's New -> recap -> login card
  const b = branches.B;
  assert(at(b, M.blurb) < at(b, M.countdown), '3B-1: blurb comes before the lock countdown');
  assert(at(b, M.countdown) < at(b, M.whatsNew),
    "3B-2: the lock countdown stays ABOVE What's New (D-3) — v0.17.2's ruling that the deadline is the single best reason to sign in is not reversed by release notes");
  assert(at(b, M.whatsNew) < at(b, M.weekRecap), "3B-3: What's New sits ABOVE the recap (D-1)");
  assert(at(b, M.weekRecap) < at(b, M.login), '3B-4: the recap sits above the 👤 Who Are You? card — both are out of the old footer position');

  // Branch C — picking: nav -> blurb -> timing -> What's New -> recap -> games
  const c = branches.C;
  assert(at(c, M.blurb) < at(c, M.timing), '3C-1: blurb before the picks-timing line');
  assert(at(c, M.timing) < at(c, M.whatsNew), "3C-2: picks timing stays above What's New");
  assert(at(c, M.whatsNew) < at(c, M.weekRecap), "3C-3: What's New above the recap");
  assert(at(c, M.weekRecap) < at(c, M.games), '3C-4: BOTH cards are above #games-list — a player who came to pick no longer has to scroll past the submit bar to find them');

  // Branch D — submitted
  const d = branches.D;
  assert(at(d, M.blurb) < at(d, M.timing) && at(d, M.timing) < at(d, M.whatsNew), '3D-1: blurb -> timing -> What\'s New');
  assert(at(d, M.whatsNew) < at(d, M.weekRecap) && at(d, M.weekRecap) < at(d, M.submitted), "3D-2: What's New -> recap -> #submitted-games");

  // Branch E — locked, signed in. renderPicksTiming is NOT called on this branch.
  const e = branches.E;
  assert(!has(e, M.timing), '3E-0: fixture check — branch E genuinely has no picks-timing line, so the slot sits directly under the blurb');
  assert(at(e, M.blurb) < at(e, M.whatsNew), "3E-1: blurb -> What's New");
  assert(at(e, M.whatsNew) < at(e, M.weekRecap) && at(e, M.weekRecap) < at(e, M.locked), '3E-2: What\'s New -> recap -> the 🔒 week-status card');

  // Branch A — historical: nav -> blurb -> What's New -> recap -> game rows
  const a = branches.A;
  assert(at(a, M.pastBlurb) < at(a, M.whatsNew), "3A-1: the viewed week's blurb comes before What's New");
  assert(at(a, M.whatsNew) < at(a, M.weekRecap), "3A-2: What's New above the recap");
  assert(at(a, M.weekRecap) < at(a, M.histRows),
    "3A-3: the recap moved from BELOW the game rows (its old trailing position) to above them");
  assert(/📋 .*Recap/.test(a), '3A-4: branch A shows THAT week\'s own recap, the week being read');

  // D-2: the recap is NOT collapsed. Drew asked for it under the blurb; a
  // collapsed recap defeats the ask.
  const recapChunk = branches.C.slice(at(branches.C, M.weekRecap), at(branches.C, M.weekRecap) + 600);
  assert(!/<details/.test(recapChunk),
    'D-2: the recap ships EXPANDED — no <details> wrapper was added (the coordinator declined the collapse)');
  assert(!/tap to expand/i.test(branches.C), 'D-2: …and no "tap to expand" summary copy was introduced');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] UN-124 ANTI-REGRESSION — What\'s New still REACHES every branch…');
// ═════════════════════════════════════════════════════════════════════════════
{
  for (const [name, html] of Object.entries(branches)) {
    assert(has(html, M.whatsNew),
      `4-${name}: the What's New card reaches branch ${name} — UN-124's actual need, asserted on the rendered DOM rather than a source window`);
  }
  const adminHtml = renderPicks({ playerId: 'p1', isAdmin: true, verified: true });
  assert(has(adminHtml, M.whatsNew), '4-admin: …and the commissioner sees it too');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] UN-178 — the recap now reaches a signed-in player in every branch…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // THE CHANGE. Before this, `playerActivelyInPicks` suppressed the recap /
  // permanent-record footer for any signed-in NON-admin player, on the reasoning
  // that a player's picks tab should stay focused on the games. Drew's
  // 2026-09-12 amendment reads on the page a signed-in player sees, so the
  // suppression is removed and the supersession is dated.
  for (const name of ['C', 'D', 'E']) {
    assert(has(branches[name], M.weekRecap),
      `5-${name}: a signed-in NON-admin player sees the recap in the head slot in branch ${name} — the suppression is gone`);
  }
  const adminHtml = renderPicks({ playerId: 'p1', isAdmin: true, verified: true });
  assert(has(adminHtml, M.weekRecap) && at(adminHtml, M.whatsNew) < at(adminHtml, M.weekRecap),
    '5-admin: the commissioner still sees it, in the same new position (his view is not a second layout)');
  assert(has(branches.B, M.weekRecap), '5-signedout: a signed-out visitor still sees it');
  assert(has(branches.A, M.weekRecap), '5-historical: branch A is unchanged in WHICH recap it shows — the viewed week\'s own');

  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const codeOnly = appSrc.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
  // COORDINATOR RULING 2 (2026-09-12): the suppression is gone from the RECAP,
  // which is what UN-178 asked for — and deliberately KEPT for the 2K25
  // Permanent Record, which returns to the end of the page under its old
  // audience rule. So "the name is gone entirely" is no longer the property to
  // assert; "it cannot reach the recap" is.
  const picksPageSrc = (codeOnly.match(/function renderPicksPage\(\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(picksPageSrc.length > 0, '5-structural-0: fixture check — renderPicksPage() was located in the stripped source');
  const fillCalls = picksPageSrc.split('\n').filter(l => l.includes('fillPicksHeadSlot(c,'));
  assert(fillCalls.length === 2 && fillCalls.every(l => /^\s*fillPicksHeadSlot\(c,/.test(l)),
    '5-structural: both head-slot fills are bare unconditional statements — no audience test gates the recap in either branch');
  assert(/if \(!recapHtml && !playerActivelyInPicks\) \{\s*\n\s*c\.insertAdjacentHTML\('beforeend', renderSeasonSummaryHTML\(currentWeek\)\);/.test(picksPageSrc),
    '5-structural2: the only surviving use of playerActivelyInPicks gates renderSeasonSummaryHTML at the END of the page (its pre-F1 audience and its pre-F1 fall-through), never the recap');
  assert((picksPageSrc.match(/playerActivelyInPicks/g) || []).length === 2,
    '5-structural3: …and it appears exactly twice — the declaration and that one gate. It cannot have crept back onto anything else.');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] NO REMNANT — no empty shell, no orphaned slot, no double render…');
// ═════════════════════════════════════════════════════════════════════════════
{
  for (const [name, html] of Object.entries(branches)) {
    assert((html.match(/🆕 What's new/g) || []).length === 1,
      `6-${name}: the What's New card renders exactly ONCE in branch ${name} — the old beforeend insert is really gone, not merely joined by a second one`);
    assert(!/<div id="picks-head-slot"><\/div>/.test(html),
      `6-${name}: no empty slot shell survives in branch ${name}`);
  }
  // The empty-head case (both WHATS_NEW lists empty) cannot be driven
  // end-to-end here: WHATS_NEW is a module-level constant with no injection
  // point, and renderWhatsNewCardHTML()'s "-> ''" contract is asserted directly
  // in loadtest [45a]. What IS assertable here is the mechanism that consumes
  // it: fillPicksHeadSlot() assigns slot.outerHTML unconditionally, so an empty
  // head removes the node rather than leaving a zero-height shell.
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const fillSrc = (appSrc.match(/function fillPicksHeadSlot\(c, recapHtml\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(fillSrc.includes('slot.outerHTML = head'),
    "6-empty: fillPicksHeadSlot() assigns the head to slot.outerHTML unconditionally — head === '' therefore REMOVES the slot node (no empty card, no gap)");
  assert(!/if \(head\)/.test(fillSrc),
    '6-empty2: …and there is no `if (head)` guard that would leave the slot in place when there is nothing to show');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] BLIND RULE — branch A on a LOCKED, non-public week, signed out…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const lockedPast = mkWeek({ weekId: 'w_lockedpast', weekNumber: 3, status: 'locked', blurb: 'LOCKED PAST MARKER' });
  saveWeek(lockedPast);
  saveGame(mkGame('w_lockedpast', 'g1', 'LOCKED HOME', 'LOCKED AWAY', '2026-09-19T23:00:00Z'));
  saveAllPicks([
    { pickId: 'lp1', weekId: 'w_lockedpast', gameId: 'w_lockedpast_g1', playerId: 'p2', selectedTeam: 'LOCKED HOME', submittedAt: '2026-09-18T00:00:00Z' },
  ]);
  // A later current week so the locked one is genuinely "past".
  const cur2 = mkWeek({ weekId: 'w_cur2', weekNumber: 4, blurb: 'WEEK BLURB MARKER' });
  saveWeek(cur2);
  saveGame(mkGame('w_cur2', 'g1', 'CUR2 HOME', 'CUR2 AWAY', FUTURE));
  setActiveWeekId('w_cur2');

  const html = renderPicks({ viewWeekId: 'w_lockedpast' });
  assert(has(html, 'LOCKED PAST MARKER'), '7a: fixture check — the locked historical week rendered');
  assert(!/hist-pick/.test(html),
    "7b: no .hist-pick badge is emitted — a signed-out viewer sees nobody's selections on a locked, non-public week");
  assert(/🔒/.test(html), '7c: the 🔒 locked notice still renders');
  assert(has(html, M.whatsNew) && !has(html, M.slot),
    '7d: the head slot is still filled on this branch — the reordering did not cost the blind branch its cards');
  assert(!/LOCKED HOME<\/span>|>LOCKED HOME</.test(html.replace(/hist-matchup[\s\S]*?<\/div>/g, '')),
    '7e: the only place a team name appears is the matchup line itself, never a pick badge');

  setActiveWeekId('w_cur');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] FALLBACK — a container with no slot still gets the cards…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Simulate the "future branch added without a slot" case by rendering into a
  // container whose querySelector can never find one. The cards must still
  // appear — at the bottom, visibly wrong, but NEVER missing.
  const orig = els.get('page-picks');
  const noSlot = {
    ...orig, _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v).replace(SLOT_MARKUP, ''); },   // slot stripped
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  els.set('page-picks', noSlot);
  const html = renderPicks({ playerId: 'p1', verified: true });
  els.set('page-picks', orig);
  assert(has(html, M.whatsNew) && has(html, M.weekRecap),
    '8a: with no slot present the cards still render via the beforeend fallback — degraded placement, never absent');
  assert(at(html, M.games) < at(html, M.whatsNew),
    '8b: …and the fallback really is the OLD bottom placement, which is what makes it visibly wrong rather than silently fine');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] BUG-4 — the submitted view must name the team you picked…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // BUG-4 (fb_1788576195078_ejmps, Drew, 2026-09-05), verbatim: "You can see
  // the live scores in the picks tab and can see if you're covering, but cant
  // aee who you picked". Branch D (submitted) renders its cards into
  // #submitted-games via renderGameCard(..., showResult=true), which omits the
  // .pick-buttons block — the only thing that had ever carried the selected
  // state. Driven here through window.navigateTo('picks'), the same entry
  // point the bottom nav uses, so this asserts the page a player actually
  // gets rather than a hand-called renderer (livestatustest §9 covers the
  // unit level, including the in-place live patch).
  const MARK = 'team-picked';
  const countMark = h => (h.match(/team-picked/g) || []).length;

  // Put the current week LIVE with a live game — Drew's exact situation.
  saveGame({ ...mkGame('w_cur', 'g1', 'PRIMARY HOME', 'PRIMARY AWAY', '2026-09-12T17:00:00Z'),
             status: 'live', homeScore: 17, awayScore: 10 });
  saveWeek({ ...cur, status: 'live' });
  // p2 also has a pick on this game — the OTHER team. Blind rule: p1's page
  // may mark p1's pick and nothing else.
  saveAllPicks([
    { pickId: 'cp1', weekId: 'w_cur', gameId: 'w_cur_g1', playerId: 'p1', selectedTeam: 'PRIMARY HOME', submittedAt: '2026-09-05T00:00:00Z' },
    { pickId: 'cp2', weekId: 'w_cur', gameId: 'w_cur_g1', playerId: 'p2', selectedTeam: 'PRIMARY AWAY', submittedAt: '2026-09-05T00:00:00Z' },
  ]);

  const page = renderPicks({ playerId: 'p1', verified: true });
  const cards = els.get('submitted-games')._html;

  assert(has(page, M.submitted), '9a-0: fixture check — branch D (submitted view) is the branch under test');
  assert(cards.includes('PRIMARY HOME') && cards.includes('PRIMARY AWAY') && cards.includes('🔴 LIVE'),
    '9a-1: fixture check — the submitted card genuinely rendered the LIVE game (not a vacuous pass)');

  // ── THE REPORTED BUG, end to end ──
  assert(countMark(cards) === 1,
    `9a: BUG-4 — the submitted view marks exactly one team per card as the player's pick during a LIVE game (got ${countMark(cards)})`);
  const away = cards.slice(cards.indexOf('<div class="team away'), cards.indexOf('<div class="vs-divider"'));
  const home = cards.slice(cards.indexOf('<div class="vs-divider"'), cards.indexOf('<div class="spread-row"'));
  assert(home.includes(MARK) && !away.includes(MARK),
    '9b: the marker is on PRIMARY HOME — the team p1 actually picked');
  assert(cards.includes('Your pick'),
    '9c: the marker carries readable copy, not colour alone (the ⚡ Covering badge was already there and still did not say who)');

  // ── Blind rule: p1's own card only. p2's pick is on this page's other team
  //    and must not be marked or named. ──
  assert(!away.includes(MARK) && !cards.includes('Brayden'),
    "9d: blind rule — p2's opposing pick on the same game is neither marked nor named on p1's Picks page");

  // ── The other read-only path: the historical week branch already names the
  //    picked team in its .hist-pick badge. Locked here so a future edit to
  //    that branch cannot silently reproduce BUG-4 on past weeks. ──
  const histHtml = renderPicks({ playerId: 'p1', verified: true, viewWeekId: 'w_past' });
  assert(has(histHtml, M.histRows), '9e-0: fixture check — branch A (historical) rendered its game rows');
  assert(/<span class="hist-pick[^"]*">PAST HOME/.test(histHtml),
    '9e: branch A (historical week) names the picked team inside the .hist-pick badge — the read-only path that never had BUG-4 keeps that property');

  // Restore the fixture for anything appended after this section.
  saveWeek(cur);
  saveGame(mkGame('w_cur', 'g1', 'PRIMARY HOME', 'PRIMARY AWAY', FUTURE));
}


// ══════════════════════════════════════════════════════════════════════════════
console.log('\n[10] COORDINATOR RULING 2 — the head slot is the WEEK RECAP only…');
// ══════════════════════════════════════════════════════════════════════════════
//
// reviewer F1 finding 1: the head slot was filled with renderPicksFooterHTML(),
// which falls back to the 2K25 Permanent Record whenever there is no FINALIZED
// previous week — so on any Monday or Tuesday before finalize, an 8-line season
// card sat between the blurb and the games for every player. A planning gap (the
// DI said "the recap" and never specified the no-recap state), not an execution
// defect.
//
// THE RULING: the head slot holds renderPrevWeekRecapHTML(currentWeek) only. The
// Permanent Record keeps its PRE-F1 placement (page end, `beforeend`) and its
// PRE-F1 audience (signed-out visitors and the commissioner, never a signed-in
// non-admin), and its pre-F1 fall-through (it appears only when there is no
// recap — renderPicksFooterHTML never returned both).
{
  // 10a — with a recap available, the season summary is nowhere on the page in
  // ANY of the five branches. The branch renders above already proved the recap
  // IS in the head slot (§3/§5); this is the other half.
  for (const [name, html] of Object.entries(branches)) {
    assert(has(html, M.weekRecap) && !has(html, M.seasonSummary),
      `10a-${name}: branch ${name} shows the WEEK recap and no Permanent Record anywhere — the head slot can never carry the season summary`);
  }

  // 10b — the no-recap state, which is the one the ruling is actually about. A
  // current week in a season with no finalized week of its own: the head slot's
  // recap is '', so the slot holds What's New alone.
  const noFinal = mkWeek({ weekId: 'w_nofinal', weekNumber: 1, season: 2027,
                           blurb: 'NOFINAL BLURB MARKER' });
  saveWeek(noFinal);
  saveGame(mkGame('w_nofinal', 'g1', 'NF HOME', 'NF AWAY', FUTURE));
  setActiveWeekId('w_nofinal');

  const outHtml   = renderPicks({});                                        // signed out
  const playerHtml= renderPicks({ playerId: 'p1', verified: true });        // signed-in non-admin
  const adminHtml = renderPicks({ playerId: 'p1', isAdmin: true, verified: true });

  assert(has(outHtml, 'NOFINAL BLURB MARKER') && !has(outHtml, M.weekRecap),
    '10b-0: fixture check — this week genuinely has NO previous finalized week, so there is no week recap to show');
  assert(has(outHtml, M.seasonSummary),
    '10c: a signed-out visitor still gets the Permanent Record — its pre-F1 audience is unchanged');
  assert(at(outHtml, M.whatsNew) < at(outHtml, M.seasonSummary) &&
         at(outHtml, M.login) < at(outHtml, M.seasonSummary),
    '10d: …at the END of the page, below the login card — NOT promoted into the head slot above the fold');
  assert(has(adminHtml, M.seasonSummary) && at(adminHtml, M.games) < at(adminHtml, M.seasonSummary),
    '10e: the commissioner gets it too, also at the end, below the games');
  assert(!has(playerHtml, M.seasonSummary),
    '10f: a signed-in NON-admin player does NOT get it — that half of the old footer rule is deliberately preserved, and it is the half UN-178 did not overturn');
  assert(has(playerHtml, M.whatsNew) && !has(playerHtml, M.slot),
    "10g: …and his head slot still rendered and was consumed — no empty shell where the recap would have been");

  setActiveWeekId('w_cur');
}


// ═════════════════════════════════════════════════════════════════════════════
// ███  PART A — UN-179: per-player Dashboard + Standings section order  ███████
// ═════════════════════════════════════════════════════════════════════════════
//
// WHAT DREW ASKED FOR, VERBATIM
// -----------------------------
//   "Users should be able to customize the layout of their dashboard and
//    standings tabs. Each box containing things like the actual game dashboard
//    or alma mater watch, should be able to be moved around like iphone apps.
//    It shouldnt move accidentally scrolling, only with intentionality."
//   (ruling, 2026-09-12) "a default order with a per-player override"
//
// MECHANISM (DI-179a, approved): explicit `⇅ Edit layout` mode + ▲/▼ buttons.
// NO DRAG — which is also why this suite can exist at all. A touch drag does
// not emulate in Node or in a desktop browser; a move here is a click on a
// <button>, so the real handler is drivable end to end.
//
// DISCIPLINE, inherited from ordertest.mjs and from Part B above: order is
// asserted on the ORDER OF `data-section-id` IN THE EMITTED HTML, driven
// through `window.navigateTo('dashboard'|'leaderboard')` — the same entry point
// the bottom nav uses — never on a helper's return value alone. The one place
// this suite calls a function directly is `moveSection()`, which is the exact
// function the ▲/▼ click listener calls, with the exact arguments it passes
// (bindLayoutEditHandlers closes over the compose pass's `visible` list); the
// re-render that follows is then re-read from the DOM.
//
// SECTIONS
//   A1  effectiveOrder() — the merge rule, proven as a pure function.
//   A2  Rendered order, both pages, default and customized.
//   A3  VT-22 preservation — an uncustomized player still gets UN-22's order.
//   A4  Persistence round-trip, incl. the SECOND player record proof.
//   A5  Reset — per page, and it does not touch the other page.
//   A6  Blind rule under reorder.
//   A7  Empty-section rule (no tiebreaker question).
//   A8  Anonymous — default order, and no control at all.
//   A9  Re-entrancy — the obligation-action re-render keeps the order.
//   A10 Tap targets — an explicit ≥44px constraint on the move buttons.

const { getSectionOrder, setSectionOrder, clearSectionOrder, getPlayer } = storage;
const { DEFAULT_SECTIONS, SECTION_LABELS, effectiveOrder, moveSection, reorderedSections } = app;

const DASH_DEF  = DEFAULT_SECTIONS.dashboard;
const STAND_DEF = DEFAULT_SECTIONS.standings;

// ── Part A fixtures. Its OWN week, so nothing above can drift into it. ──
// OPEN and non-public on purpose: p1 has submitted (so the dashboard renders
// past the "Submit Your Picks First" gate) while p2's selection must stay
// blinded — which is what makes §A6 a real test rather than a public-week one.
const lay = mkWeek({ weekId: 'w_layout', weekNumber: 9, status: 'open', blurb: 'LAYOUT WEEK MARKER',
                     tiebreakerQuestion: 'Total points in the night game?' });
saveWeek(lay);
saveGame(mkGame('w_layout', 'g1', 'LAYOUT HOME', 'LAYOUT AWAY', FUTURE));
saveAllPicks([
  { pickId: 'lay1', weekId: 'w_layout', gameId: 'w_layout_g1', playerId: 'p1', selectedTeam: 'LAYOUT HOME', submittedAt: '2026-09-11T00:00:00Z' },
  { pickId: 'lay2', weekId: 'w_layout', gameId: 'w_layout_g1', playerId: 'p2', selectedTeam: 'LAYOUT AWAY', submittedAt: '2026-09-11T00:00:00Z' },
]);

/** Render the Dashboard through the nav and hand back the emitted HTML. */
function renderDash({ playerId = null, isAdmin = false, verified = false, weekId = 'w_layout' } = {}) {
  setSession(playerId, isAdmin, verified);
  app.state.dashboardWeekId = weekId;
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard');
  return els.get('page-dashboard')._html;
}
/** Render Standings through the nav. (`leaderboard` is the TAB; `standings` is the pageKey.) */
function renderStand({ playerId = null, isAdmin = false, verified = false } = {}) {
  setSession(playerId, isAdmin, verified);
  els.get('page-leaderboard')._html = '';
  window.navigateTo('leaderboard');
  return els.get('page-leaderboard')._html;
}
/** The ONE order reader: data-section-id in emitted-DOM order. */
const sectionIds = html => [...html.matchAll(/data-section-id="([^"]+)"/g)].map(m => m[1]);
const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A1] effectiveOrder() — the merge rule (DI-179e), as a pure function…');
// ═════════════════════════════════════════════════════════════════════════════
{
  setSession('p1', false, true);
  clearSectionOrder('dashboard'); clearSectionOrder('standings');

  assert(sameArr(effectiveOrder('dashboard'), [...DASH_DEF]),
    'A1a: no saved order -> the shipped default, exactly (CONVENTIONS #10 — every player record in the Sheet today is in this state)');
  assert(sameArr(effectiveOrder('standings'), [...STAND_DEF]),
    'A1b: …and the same on Standings');

  setSectionOrder('dashboard', [...DASH_DEF]);
  assert(sameArr(effectiveOrder('dashboard'), [...DASH_DEF]),
    'A1c: saving the default order is a no-op — it reads back identical');

  const reversed = [...DASH_DEF].reverse();
  setSectionOrder('dashboard', reversed);
  assert(sameArr(effectiveOrder('dashboard'), reversed),
    'A1d: a fully reversed saved order is honoured verbatim');

  // A retired id is dropped silently. It is not the player's problem, and a
  // toast about a section they never knew existed would be noise.
  setSectionOrder('dashboard', ['dash-alma', 'dash-RETIRED-2019', 'dash-picks', 'dash-summary', 'dash-tiebreaker']);
  const dropped = effectiveOrder('dashboard');
  assert(!dropped.includes('dash-RETIRED-2019'), 'A1e: an id no longer in the registry is dropped from a saved order');
  assert(sameArr(dropped, ['dash-alma', 'dash-picks', 'dash-summary', 'dash-tiebreaker']),
    'A1f: …and dropping it does not disturb the ids around it');

  setSectionOrder('dashboard', ['dash-alma', 'dash-alma', 'dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker']);
  assert(sameArr(effectiveOrder('dashboard'), ['dash-alma', 'dash-picks', 'dash-summary', 'dash-tiebreaker']),
    'A1g: duplicates de-duplicate, first occurrence wins');

  // ── THE ONE THAT MATTERS: insert-at-default-NEIGHBOUR, not append. ──
  // DI-179e's worked example, reproduced against the real registry: a saved
  // order that predates a section behaves exactly like a saved order from
  // which that section is missing. `dash-summary` sits at default index 2; its
  // last present default-predecessor is `dash-alma`, which the player moved to
  // the FRONT — so it must land immediately after `dash-alma`, at index 1, NOT
  // appended to the bottom.
  setSectionOrder('dashboard', ['dash-alma', 'dash-picks', 'dash-tiebreaker']);
  const neigh = effectiveOrder('dashboard');
  assert(sameArr(neigh, ['dash-alma', 'dash-summary', 'dash-picks', 'dash-tiebreaker']),
    `A1h: a registry id missing from the saved order lands immediately after its last present default-predecessor, NOT at the bottom (got ${neigh.join(' > ')})`);
  assert(neigh.indexOf('dash-summary') === 1 && neigh.indexOf('dash-summary') < neigh.length - 1,
    'A1i: …and specifically NOT appended — appending would bury a card designed to sit near the top, for every player, silently, on every release');

  // No present predecessor at all -> index 0.
  setSectionOrder('dashboard', ['dash-alma', 'dash-summary', 'dash-tiebreaker']);
  assert(effectiveOrder('dashboard')[0] === 'dash-picks',
    'A1j: an id with NO present default-predecessor (default index 0) goes to the front, not the back');

  // Standings, the live version of the same case: `stand-extrapoint` ships in
  // this very release at default index 2. A saved Standings order written
  // without it must place it right after `stand-season`, wherever that is.
  setSectionOrder('standings', ['stand-alma', 'stand-season', 'stand-history', 'stand-2025-open', 'stand-2025-record']);
  const st = effectiveOrder('standings');
  assert(st.indexOf('stand-extrapoint') === st.indexOf('stand-season') + 1,
    `A1k: FEAT-9's Extra Point Ledger lands immediately after Season Summary in a saved order that never knew about it (got ${st.join(' > ')})`);

  // ── The never-fewer-ids invariant (DI-179e step 6). THE property that makes
  //    "a bad saved order can never hide a section" true. Asserted over a
  //    battery of hostile inputs, not a single happy case. ──
  const hostile = [
    [], ['nonsense'], ['dash-picks'], ['dash-picks', 'dash-picks'],
    ['zzz', 'dash-tiebreaker', 'zzz'], ['dash-summary'],
    ['dash-tiebreaker', 'dash-summary'], ['', 'dash-alma'],
  ];
  let invariantOk = true, worst = null;
  for (const saved of hostile) {
    setSectionOrder('dashboard', saved);
    const got = effectiveOrder('dashboard');
    const covers = DASH_DEF.every(id => got.includes(id)) && got.length === DASH_DEF.length;
    if (!covers) { invariantOk = false; worst = `${JSON.stringify(saved)} -> ${got.join(',')}`; }
  }
  assert(invariantOk,
    `A1l: NEVER-FEWER-IDS — every registry id survives every one of ${hostile.length} hostile saved orders, with no duplicates${worst ? ' — FAILED on ' + worst : ''}`);

  let standInvariant = true;
  for (const saved of [[], ['junk'], ['stand-history'], ['stand-2025-record', 'stand-season']]) {
    setSectionOrder('standings', saved);
    const got = effectiveOrder('standings');
    if (!(STAND_DEF.every(id => got.includes(id)) && got.length === STAND_DEF.length)) standInvariant = false;
  }
  assert(standInvariant, 'A1m: …and the same invariant holds on the six-section Standings registry');

  assert(Object.keys(SECTION_LABELS).length === DASH_DEF.length + STAND_DEF.length &&
         [...DASH_DEF, ...STAND_DEF].every(id => !!SECTION_LABELS[id]),
    'A1n: every registered section has a human label — a move bar reading "stand-2025-open" at a player would be a defect, and an unlabelled aria-label is worse');

  clearSectionOrder('dashboard'); clearSectionOrder('standings');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A2] RENDERED ORDER — both pages, default and customized…');
// ═════════════════════════════════════════════════════════════════════════════
{
  setSession('p1', false, true);
  clearSectionOrder('dashboard'); clearSectionOrder('standings');

  const d = renderDash({ playerId: 'p1', verified: true });
  assert(has(d, '📋 All Picks by Game') && has(d, 'LAYOUT HOME'),
    "A2a-0: fixture check — the Part A week's dashboard really rendered (its slate is on the page)");
  assert(sameArr(sectionIds(d), [...DASH_DEF]),
    `A2a: the Dashboard's emitted DOM is in default order (got ${sectionIds(d).join(' > ')})`);
  assert(at(d, 'data-section-id="dash-picks"') < at(d, '📋 All Picks by Game') &&
         at(d, 'data-section-id="dash-alma"') < at(d, '⭐ Alma Mater Watch'),
    'A2b: each wrapper really contains the card it claims — the ids are not decorative');

  const s = renderStand({ playerId: 'p1', verified: true });
  assert(sameArr(sectionIds(s), [...STAND_DEF]),
    `A2c: Standings is in default order, with FEAT-9's ledger at index 2 exactly where pass F1 hard-coded it (got ${sectionIds(s).join(' > ')})`);
  assert(at(s, 'data-section-id="stand-extrapoint"') < at(s, '🎯 Extra Point Ledger') &&
         at(s, '🎯 Extra Point Ledger') < at(s, '⭐ Alma Mater Rankings'),
    'A2d: …and it still renders BETWEEN Season Summary and Alma Mater Rankings for an uncustomized player — registering it changed its address, not its position');

  // Customized.
  setSectionOrder('dashboard', ['dash-tiebreaker', 'dash-alma', 'dash-picks', 'dash-summary']);
  const d2 = renderDash({ playerId: 'p1', verified: true });
  assert(sameArr(sectionIds(d2), ['dash-tiebreaker', 'dash-alma', 'dash-picks', 'dash-summary']),
    'A2e: a saved Dashboard order is honoured in the rendered DOM, not just in the helper');
  assert(at(d2, '🎯 Tiebreaker') < at(d2, '📋 All Picks by Game'),
    'A2f: …and the CARDS moved with the wrappers — the Tiebreaker card really is above All Picks by Game now');

  setSectionOrder('standings', ['stand-history', 'stand-season', 'stand-extrapoint', 'stand-alma', 'stand-2025-open', 'stand-2025-record']);
  const s2 = renderStand({ playerId: 'p1', verified: true });
  assert(sectionIds(s2)[0] === 'stand-history' && at(s2, 'Weekly History') < at(s2, 'Season Summary'),
    "A2g: Kevin's case from the design input — Weekly History moved to the top of Standings, which is where the drinks he owes are");
  assert(has(s2, 'id="obligations-section"') && at(s2, 'id="obligations-section"') < at(s2, 'Season Summary'),
    'A2h: the #obligations-section deep-link target travelled WITH the section — the notification deep link still lands on it wherever the player put it');

  // Both pages are one registry and one function (DI-179k item 1) — a saved
  // Dashboard order must not leak into Standings or vice versa.
  assert(sectionIds(renderDash({ playerId: 'p1', verified: true }))[0] === 'dash-tiebreaker' &&
         sectionIds(renderStand({ playerId: 'p1', verified: true }))[0] === 'stand-history',
    'A2i: the two pages hold independent orders under one registry — neither page has drifted into a second copy of the mechanism');

  // The chat teaser is PINNED above everything (DI-179c / DI-179k item 2): it
  // is inserted afterbegin by renderDashboard(), OUTSIDE the inner template,
  // and chat-ui.js replaces that node in place on live activity.
  const dTeaser = renderDash({ playerId: 'p1', verified: true });
  if (has(dTeaser, 'dash-chat-teaser')) {
    assert(at(dTeaser, 'dash-chat-teaser') < at(dTeaser, 'data-section-id='),
      'A2j: the chat teaser stays pinned ABOVE every reorderable section, in a non-default order');
  } else {
    assert(true, 'A2j: chat teaser not emitted in this fixture (chat off) — pinning is unobservable here, covered by the browser pass');
  }
  // …as do the week selector and refresh bar, for the same reason: a control
  // that decides WHICH week is below it would be a defect, not a preference.
  assert(at(dTeaser, 'refresh-bar') < at(dTeaser, 'data-section-id='),
    'A2k: the refresh bar stays pinned above the sections — it stamps the freshness of the scores below it');

  clearSectionOrder('dashboard'); clearSectionOrder('standings');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A3] VT-22 PRESERVATION — the default order is still UN-22/RG-01…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // THE guard for ruling R1: "a default order with a per-player override" is
  // only safe if the default is still the locked one. This is VT-22 restated
  // as an executable assertion — it must fail loudly if the default drifts.
  clearSectionOrder('dashboard');
  const d = renderDash({ playerId: 'p1', verified: true });
  const ids = sectionIds(d);
  assert(ids.indexOf('dash-picks') === 0,
    'A3a: VT-22 — All Picks by Game is FIRST on the Dashboard for a player who has never customized (UN-22 / RG-01, unchanged since v0.11)');
  assert(ids.indexOf('dash-picks') < ids.indexOf('dash-alma') && ids.indexOf('dash-alma') < ids.indexOf('dash-summary'),
    'A3b: VT-22 — picks > alma > summary, in that order, for an uncustomized player');
  assert(at(d, '📋 All Picks by Game') < at(d, '⭐ Alma Mater Watch') &&
         at(d, '⭐ Alma Mater Watch') < at(d, 'This Week Score Summary'),
    'A3c: VT-22 read off the CARDS rather than the ids — the wrappers cannot pass this while the content disagrees');
  assert(sameArr([...DASH_DEF], ['dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker']),
    'A3d: the registry itself still literally spells UN-22 — this line is the tripwire if someone "tidies" DEFAULT_SECTIONS');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A4] PERSISTENCE — round-trip, and the SECOND player record proof…');
// ═════════════════════════════════════════════════════════════════════════════
{
  clearSectionOrder('dashboard'); clearSectionOrder('standings');
  setSession('p1', false, true);

  // Drive the real ▲/▼ handler: bindLayoutEditHandlers() calls exactly this,
  // with exactly the `visible` list the compose pass produced.
  app.state.layoutEditing = 'dashboard';
  const before = renderDash({ playerId: 'p1', verified: true });
  const visible = sectionIds(before);
  assert(has(before, 'section-move-bar'), 'A4a-0: fixture check — edit mode is on, so the move bars rendered');
  moveSection('dashboard', 'dash-alma', 'up', visible);

  const saved = getPlayer('p1')?.preferences?.sectionOrder;
  assert(!!saved && Array.isArray(saved.dashboard),
    'A4a: the order is written to player.preferences.sectionOrder.dashboard — the PLAYER RECORD, through _setPlayerPref -> save(KEYS.PLAYERS) -> the seam');
  assert(sameArr(saved.dashboard, ['dash-alma', 'dash-picks', 'dash-summary', 'dash-tiebreaker']),
    `A4b: …and it holds the moved order (got ${(saved.dashboard || []).join(' > ')})`);

  const after = renderDash({ playerId: 'p1', verified: true });
  assert(sameArr(sectionIds(after), ['dash-alma', 'dash-picks', 'dash-summary', 'dash-tiebreaker']),
    'A4c: the re-render reads it back — this is the "survives a hard reload" property, since nothing in the page survives an innerHTML assignment');

  // ── THE PROOF THAT WOULD HAVE CAUGHT dashboardColumnOrder ──
  // `settings.*` is ONE league-shared blob synced to the Sheet: a write there
  // is every player's read. `settings.dashboardColumnOrder` (a different and
  // older feature) is still in it. If UN-179 had copied that pattern, p2's
  // record would have changed here too.
  const p2prefs = getPlayer('p2')?.preferences || {};
  assert(!p2prefs.sectionOrder,
    "A4d: a SECOND player's record is completely untouched by p1's move — the order is per-player, not on the league-shared settings blob");
  const p2Dash = renderDash({ playerId: 'p2', verified: true });
  assert(sameArr(sectionIds(p2Dash), [...DASH_DEF]),
    "A4e: …and p2's Dashboard still renders the DEFAULT order while p1's is customized — the two players genuinely see different pages");

  // Storage-shape check: ONE preference key holding BOTH pages (DI-179d), so a
  // future third page is an entry rather than a new key.
  setSession('p1', false, true);
  setSectionOrder('standings', ['stand-alma', 'stand-season', 'stand-extrapoint', 'stand-history', 'stand-2025-open', 'stand-2025-record']);
  const both = getPlayer('p1')?.preferences?.sectionOrder || {};
  assert(Object.keys(both).sort().join(',') === 'dashboard,standings',
    'A4f: both pages live under ONE `sectionOrder` key, keyed by page — not two preference keys');

  // Malformed data from a hand-edited Sheet cell must not throw or blank a page.
  const p1rec = getPlayer('p1');
  storage.savePlayer({ ...p1rec, preferences: { ...p1rec.preferences, sectionOrder: { dashboard: 'not-an-array' } } });
  const junk = renderDash({ playerId: 'p1', verified: true });
  assert(sameArr(sectionIds(junk), [...DASH_DEF]),
    'A4g: a non-array sectionOrder (hand-edited Sheet cell, bad export) degrades to the DEFAULT order rather than to a blank page — coerced at the storage boundary, CONVENTIONS #7');

  setSession('p1', false, true);
  clearSectionOrder('dashboard'); clearSectionOrder('standings');

  // ── A4h — THE HANDLER'S OWN WIRING, driven through a real click ──
  // F2 review note (g). Everything above calls moveSection() directly, which
  // proves the move ALGORITHM and nothing about the DOM contract between the
  // emitted button and the listener. Renaming `data-move-id` to `data-moveid`
  // in app.js left this suite at 171/0, because the stub's querySelectorAll
  // returned []. It no longer does (see parseClickables above), so the listener
  // is bound to the parsed button and the click below runs the real code path.
  app.state.layoutEditing = 'dashboard';
  const beforeIds = sectionIds(renderDash({ playerId: 'p1', verified: true }));
  const moveBtns  = els.get('page-dashboard').querySelectorAll('.section-move-btn');
  assert(moveBtns.length >= 2 && moveBtns.some(b => b._bound() > 0),
    `A4h-0: fixture check — the move buttons were found AND a click listener is attached to them (found ${moveBtns.length})`);
  const downTop = moveBtns.find(b => b.dataset.moveId === beforeIds[0] && b.dataset.moveDir === 'down');
  assert(!!downTop,
    "A4h: the emitted attributes (data-move-id / data-move-dir) match the `dataset.moveId` / `dataset.moveDir` keys the handler reads — a rename on either side breaks the button silently, which is exactly what happened invisibly before this assertion existed");
  downTop?.click();
  const afterIds = sectionIds(renderDash({ playerId: 'p1', verified: true }));
  assert(afterIds[1] === beforeIds[0] && afterIds[0] === beforeIds[1],
    `A4i: clicking ▼ on the top section actually moved it down one, through the real listener (${beforeIds.slice(0,2).join(' > ')} -> ${afterIds.slice(0,2).join(' > ')})`);
  assert(sameArr(getSectionOrder('dashboard'), afterIds),
    'A4j: …and the click PERSISTED that order to the player record — the handler writes, it does not merely re-render');
  app.state.layoutEditing = null;
  clearSectionOrder('dashboard'); clearSectionOrder('standings');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A5] RESET — per page, and it leaves the other page alone…');
// ═════════════════════════════════════════════════════════════════════════════
{
  setSession('p1', false, true);
  setSectionOrder('dashboard', ['dash-tiebreaker', 'dash-summary', 'dash-alma', 'dash-picks']);
  setSectionOrder('standings', ['stand-history', 'stand-season', 'stand-extrapoint', 'stand-alma', 'stand-2025-open', 'stand-2025-record']);

  clearSectionOrder('dashboard');
  assert(sameArr(sectionIds(renderDash({ playerId: 'p1', verified: true })), [...DASH_DEF]),
    'A5a: Reset puts the Dashboard back to the league default — an override with no exit is a trap');
  assert(sectionIds(renderStand({ playerId: 'p1', verified: true }))[0] === 'stand-history',
    "A5b: …and Standings' own saved order SURVIVES it — Reset is per page, not per player");
  assert(getSectionOrder('dashboard').length === 0 && getSectionOrder('standings').length === 6,
    'A5c: the storage shape agrees — the dashboard entry is removed, the standings entry is intact');

  // The affordance itself, and the copy, in the rendered markup.
  app.state.layoutEditing = 'standings';
  const editing = renderStand({ playerId: 'p1', verified: true });
  assert(has(editing, '↺ Reset to default'), 'A5d: the ↺ Reset to default control renders — in edit mode');
  app.state.layoutEditing = null;
  const idle = renderStand({ playerId: 'p1', verified: true });
  assert(!has(idle, '↺ Reset to default'),
    'A5e: …and ONLY in edit mode — a destructive control has no business on the idle page');
  assert(has(idle, '⇅ Edit layout') && !has(idle, '✓ Done'), 'A5f: idle shows ⇅ Edit layout');
  app.state.layoutEditing = 'standings';
  assert(has(renderStand({ playerId: 'p1', verified: true }), '✓ Done'), 'A5g: editing shows ✓ Done');

  // ── A5h — THE RESET HANDLER'S ARGUMENT, driven through a real click ──
  // F2 review note (g). `clearSectionOrder(pageKey)` vs `clearSectionOrder('dashboard')`
  // is a one-word difference that no assertion could see while the reset was
  // only ever called directly: resetting Standings must not touch the Dashboard.
  setSectionOrder('dashboard', ['dash-tiebreaker', 'dash-summary', 'dash-alma', 'dash-picks']);
  setSectionOrder('standings', ['stand-history', 'stand-season', 'stand-extrapoint', 'stand-alma', 'stand-2025-open', 'stand-2025-record']);
  app.state.layoutEditing = 'standings';
  renderStand({ playerId: 'p1', verified: true });
  const resetBtns = els.get('page-leaderboard').querySelectorAll('.layout-reset-btn');
  assert(resetBtns.length === 1 && resetBtns[0]._bound() > 0,
    `A5h-0: fixture check — exactly one ↺ Reset control rendered on Standings and it has a click listener (found ${resetBtns.length})`);
  assert(resetBtns[0].dataset.layoutPage === 'standings',
    'A5h: the emitted data-layout-page names the page this control belongs to');
  resetBtns[0].click();
  assert(getSectionOrder('standings').length === 0,
    'A5i: the real click cleared THIS page — the handler runs and it runs on the page it was rendered for');
  assert(sameArr(getSectionOrder('dashboard'), ['dash-tiebreaker', 'dash-summary', 'dash-alma', 'dash-picks']),
    "A5j: …and the OTHER page's saved order is untouched — the handler passes `pageKey`, not a hard-coded page name");
  app.state.layoutEditing = null;

  clearSectionOrder('dashboard'); clearSectionOrder('standings');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A6] BLIND RULE UNDER REORDER — proven, not assumed (DI-179l)…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // OPEN week, non-public, p1 signed in and submitted, p2 submitted the OTHER
  // team. Reordering changes the SEQUENCE of blocks that have each already
  // decided, independently, what they may show. This asserts that.
  setSession('p1', false, true);
  clearSectionOrder('dashboard');
  const def = renderDash({ playerId: 'p1', verified: true });
  const blindDefault = (def.match(/pick-cell-blind/g) || []).length;
  assert(blindDefault >= 1,
    `A6a-0: fixture check — the week is genuinely blind for p1 (${blindDefault} ••• cells); a public week would make the rest of this section vacuous`);
  assert(has(def, '•••'), 'A6a-1: fixture check — the ••• glyph is on the page');
  assert(has(def, '🙈'), 'A6a-2: fixture check — the blind-note explanation renders too');

  setSectionOrder('dashboard', ['dash-tiebreaker', 'dash-summary', 'dash-alma', 'dash-picks']);
  const moved = renderDash({ playerId: 'p1', verified: true });
  assert(sectionIds(moved)[0] === 'dash-tiebreaker', 'A6b-0: fixture check — the order really is non-default here');
  assert((moved.match(/pick-cell-blind/g) || []).length === blindDefault,
    'A6b: the same number of ••• cells is emitted under a reordered layout — reordering cannot un-blind a cell');
  assert(has(moved, '🙈'), 'A6c: the blind-note still renders, gated by canViewOtherPicks() exactly as before');

  // Positively: p1 sees its OWN pick and p2's is nowhere in a pick cell.
  const cells = [...moved.matchAll(/<td class="pick-cell[^"]*"[^>]*>(.*?)<\/td>/g)].map(m => m[1]);
  const named = cells.filter(t => /LAYOUT (HOME|AWAY)/.test(t));
  assert(named.length === 1 && /LAYOUT HOME/.test(named[0]),
    `A6d: exactly ONE pick cell names a team, and it is p1's own — p2's opposing selection is not readable at any position (named: ${named.join(' | ')})`);
  assert(!/Brayden[^<]*LAYOUT AWAY/.test(moved),
    "A6e: …and p2's name is never rendered next to a selection");

  // The blind GATE fires before any section is composed — a player who has NOT
  // submitted gets the 🔒 empty state and therefore no sections and no control,
  // with their saved order untouched.
  clearSectionOrder('dashboard');
  storage.addPlayer({ playerId: 'p3', displayName: 'Kihoon', active: true, pin: '3333', preferences: {} });
  setSession('p3', false, true);
  setSectionOrder('dashboard', ['dash-alma', 'dash-picks', 'dash-summary', 'dash-tiebreaker']);
  const locked = renderDash({ playerId: 'p3', verified: true });
  assert(has(locked, 'Submit Your Picks First'),
    'A6g: a signed-in player who has NOT submitted still hits the 🔒 gate — the gate runs BEFORE any section is composed');
  assert(sectionIds(locked).length === 0 && !has(locked, '⇅ Edit layout'),
    'A6h: …so there are no sections and no ⇅ Edit layout button on that screen — there is nothing to reorder');
  assert(sameArr(getSectionOrder('dashboard'), ['dash-alma', 'dash-picks', 'dash-summary', 'dash-tiebreaker']),
    'A6i: …and the saved order is untouched by the gate — it reappears the moment they submit');
  clearSectionOrder('dashboard');
  setSession('p1', false, true);
  clearSectionOrder('dashboard');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A7] EMPTY SECTION — omitted from the DOM, kept in the order…');
// ═════════════════════════════════════════════════════════════════════════════
{
  setSession('p1', false, true);
  clearSectionOrder('dashboard');
  // A week with no tiebreaker question. The block renders '' today; it must
  // keep rendering '' AND must not emit an empty wrapper or a move bar — an
  // empty movable slot is a phantom.
  saveWeek({ ...lay, tiebreakerQuestion: null });
  const noTB = renderDash({ playerId: 'p1', verified: true });
  assert(!has(noTB, 'data-section-id="dash-tiebreaker"'),
    'A7a: no tiebreaker question -> NO dash-tiebreaker wrapper in the DOM at all (not an empty one)');
  assert(sameArr(sectionIds(noTB), ['dash-picks', 'dash-alma', 'dash-summary']),
    'A7b: …and the three that do have content render in order around the gap');
  assert(effectiveOrder('dashboard').includes('dash-tiebreaker'),
    'A7c: …while the id STAYS in effectiveOrder() — so it returns to the position the player chose the week a question exists again');

  app.state.layoutEditing = 'dashboard';
  const noTBedit = renderDash({ playerId: 'p1', verified: true });
  const bars = (noTBedit.match(/section-move-bar/g) || []).length;
  assert(bars === 3,
    `A7d: edit mode emits a move bar per VISIBLE section only — three, not four (got ${bars}); an invisible section with ▲/▼ buttons is a phantom control`);
  // Counted on the BUTTONS, not on the glyph: ▲/▽ are also the matrix's
  // live covering/trailing arrows, so a bare glyph count would be noise.
  assert((noTBedit.match(/>▲<\/button>/g) || []).length === 3 &&
         (noTBedit.match(/>▼<\/button>/g) || []).length === 3 &&
         (noTBedit.match(/data-move-dir="up"/g) || []).length === 3,
    'A7e: …three ▲ buttons and three ▼ buttons, one pair per visible section');
  const upFirst = noTBedit.slice(at(noTBedit, 'data-section-id="dash-picks"'), at(noTBedit, 'data-section-id="dash-alma"'));
  assert(/aria-label="Move All Picks by Game up" disabled/.test(upFirst),
    'A7f: ▲ is DISABLED on the first visible section — disabled, not hidden, because a control that disappears reflows the row under the thumb');
  const lastChunk = noTBedit.slice(at(noTBedit, 'data-section-id="dash-summary"'));
  assert(/aria-label="Move This Week Score Summary down" disabled/.test(lastChunk),
    'A7g: ▼ is DISABLED on the LAST VISIBLE section — the empty tiebreaker does not leave a dead ▼ pointing at nothing');
  app.state.layoutEditing = null;

  // A move must skip the invisible section rather than reading as a no-op.
  const vis = sectionIds(noTB);
  const next = reorderedSections(effectiveOrder('dashboard'), vis, 'dash-summary', 'up');
  assert(next.indexOf('dash-summary') < next.indexOf('dash-alma'),
    'A7h: ▲ on a visible section swaps it with its nearest VISIBLE neighbour — a tap can never appear to do nothing because something invisible was in the way');
  assert(next.includes('dash-tiebreaker'),
    'A7i: …and the invisible section is still in the order after the move');

  saveWeek(lay);   // restore the tiebreaker question
  clearSectionOrder('dashboard');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A8] ANONYMOUS — default order, and no control whatsoever (DI-179g)…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // UN-127 decided this exact question for theme and timezone: a shared phone
  // passed around pregame would otherwise let whoever held it last re-lay-out
  // the app for the next anonymous viewer. No device-level fallback.
  const d = renderDash({});
  assert(!has(d, '⇅ Edit layout'), 'A8a: a signed-out viewer gets NO ⇅ Edit layout button on the Dashboard');
  assert(!has(d, 'section-move-bar') && !has(d, '↺ Reset to default'),
    'A8b: …and no move bars and no reset, in any state');
  assert(sameArr(sectionIds(d), [...DASH_DEF]), 'A8c: …and the league default order');

  const s = renderStand({});
  assert(!has(s, '⇅ Edit layout'), 'A8d: same on Standings — no button');
  assert(sameArr(sectionIds(s), [...STAND_DEF]), 'A8e: …and the league default order');

  // Defense in depth: even if a control were somehow reachable, the storage
  // seam refuses the write while signed out (_setPlayerPref no-ops).
  setSession(null, false, false);
  setSectionOrder('dashboard', ['dash-tiebreaker', 'dash-picks', 'dash-alma', 'dash-summary']);
  assert(getSectionOrder('dashboard').length === 0,
    'A8f: an anonymous write through the accessor is a no-op — there is no device-level fallback to drift into (the UN-127 trap)');
  assert(sameArr(sectionIds(renderDash({})), [...DASH_DEF]),
    'A8g: …so the next anonymous viewer on the same phone still gets the default');

  // A commissioner is a player here — same control, no extra powers.
  const admin = renderDash({ playerId: 'p1', isAdmin: true, verified: true });
  assert(has(admin, '⇅ Edit layout'),
    'A8h: a commissioner gets the identical control — this is a personal preference, not commissioner data');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A9] RE-ENTRANCY — the order survives the obligation re-render…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // DI-179k item 3. renderLeaderboard() is re-entered by the obligation-action
  // handler. An order that applies on first paint but not on re-render is the
  // bug shape RG-01 is named for.
  setSession('p1', false, true);
  setSectionOrder('standings', ['stand-2025-record', 'stand-history', 'stand-season', 'stand-extrapoint', 'stand-alma', 'stand-2025-open']);
  const first = sectionIds(renderStand({ playerId: 'p1', verified: true }));
  assert(first[0] === 'stand-2025-record', 'A9a-0: fixture check — a non-default Standings order is in effect');

  // THE re-render the handler performs, invoked as the handler invokes it.
  app.renderLeaderboard();
  const second = sectionIds(els.get('page-leaderboard')._html);
  assert(sameArr(second, first),
    `A9a: a second renderLeaderboard() — exactly what the Paid/obligation click handler calls — emits the identical order (got ${second.join(' > ')})`);
  app.renderLeaderboard(); app.renderLeaderboard();
  assert(sameArr(sectionIds(els.get('page-leaderboard')._html), first),
    'A9b: …and it is stable across repeated re-renders, not just the second one');

  const appSrc9 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/ob-action-btn[\s\S]{0,300}renderLeaderboard\(\)/.test(appSrc9),
    'A9c: structural — the obligation-action handler really is a full renderLeaderboard() re-entry, which is why A9a is the right proof');
  assert(/bindLayoutEditHandlers\(c, 'standings'/.test(appSrc9) && /bindLayoutEditHandlers\(c, 'dashboard'/.test(appSrc9),
    'A9d: both pages re-bind the layout handlers after every innerHTML assignment — the controls cannot go dead after a re-render');

  // The Dashboard has the same shape: the week selector and the refresh button
  // both re-render the whole page.
  setSectionOrder('dashboard', ['dash-summary', 'dash-picks', 'dash-alma', 'dash-tiebreaker']);
  const dFirst = sectionIds(renderDash({ playerId: 'p1', verified: true }));
  app.state.dashboardWeekId = 'w_layout';
  window.navigateTo('dashboard');
  assert(sameArr(sectionIds(els.get('page-dashboard')._html), dFirst),
    'A9e: the Dashboard order survives its own re-render path too');

  clearSectionOrder('dashboard'); clearSectionOrder('standings');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A10] TAP TARGETS + the no-tooltip / no-hex / emoji-only rules…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const css = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
  const ruleOf = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}')) || [''])[0];

  // RG-34's discipline: assert the COMPUTED CONSTRAINT (a number ≥44), not the
  // mere presence of the word "min-height".
  const moveRule = ruleOf('.section-move-btn');
  const mh = Number((moveRule.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
  const mw = Number((moveRule.match(/min-width:\s*(\d+)px/) || [])[1] || 0);
  assert(mh >= 44 && mw >= 44,
    `A10a: .section-move-btn is at least 44×44 (got ${mh}×${mw}) — CONVENTIONS #17's floor is 40 with 44 the ideal, and these sit directly above body text on a phone, which is exactly where RG-34's undersized targets got missed`);

  const editRule = ruleOf('.layout-edit-btn,.layout-reset-btn');
  const eh = Number((editRule.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
  assert(eh >= 44,
    `A10b: the ⇅ Edit layout / ↺ Reset buttons carry an explicit min-height ≥44px (got ${eh}px) — .btn-sm's base is 34px, under the floor`);
  assert(!/^\.btn-sm\{[^}]*min-height:4[4-9]px/m.test(css),
    'A10c: …achieved by a SCOPED override, not by raising .btn-sm globally, which would reflow every compact row in the app');

  // No tooltips. They do not fire on touch, and this has bitten twice.
  const appSrc10 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const layoutFns = (appSrc10.match(/function (layoutEditButtonHTML|layoutEditStripHTML|composeSections|bindLayoutEditHandlers)\([\s\S]*?\n\}/g) || []).join('\n');
  assert(layoutFns.length > 500, 'A10d-0: fixture check — the four layout render/bind functions were located in source');
  assert(!/title=/.test(layoutFns),
    'A10d: no `title` attribute anywhere in the layout controls — tooltips do not fire on touch; every state is carried by visible text or aria-label');
  assert(/aria-label="Move \$\{escHtml\(label\)\} up"/.test(layoutFns) && /aria-label="Move \$\{escHtml\(label\)\} down"/.test(layoutFns),
    'A10e: …and the ▲/▼ buttons carry named aria-labels instead ("Move Alma Mater Watch up")');
  assert(/aria-live="polite"/.test(layoutFns),
    'A10f: an aria-live="polite" region exists for the after-move announcement');
  assert(/moved to position \$\{/.test(appSrc10),
    'A10g: …and the announcement names the new position ("Alma Mater Watch moved to position 2 of 4.")');

  // No individual-move toast (four moves would be four toasts); a toast on
  // Reset, because it is destructive and its result may be off-screen.
  const bindSrcRaw = (appSrc10.match(/function bindLayoutEditHandlers\([\s\S]*?\n\}\n/) || [''])[0];
  // Comment lines stripped — this file explains in prose WHY there is no
  // confirm() on Reset, and a naive grep would match the explanation.
  const bindSrc = bindSrcRaw.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  const toastCount = (bindSrc.match(/showToast\(/g) || []).length;
  assert(toastCount === 1,
    `A10h: exactly ONE toast in the whole edit flow — Reset only (got ${toastCount}); the re-render IS the feedback for a move`);
  assert(/showToast\('↺ Layout reset/.test(bindSrc), 'A10i: …and it is the Reset toast');
  assert(!/confirm\(/.test(bindSrc),
    'A10j: no confirm() on Reset — this app reserves confirm() for money-affecting commissioner actions, and Reset is one tap to undo by hand');

  // CSS house rules.
  const cssBlock = css.slice(css.indexOf('FEAT-8a / UN-179'));
  assert(cssBlock.length > 800, 'A10k-0: fixture check — the UN-179 CSS block was located');
  const codeLines = cssBlock.split('\n').filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l));
  assert(!codeLines.some(l => /#[0-9a-fA-F]{3,8}\b/.test(l)),
    'A10k: no hex colours in the UN-179 CSS — seven themes swap through custom properties (CONVENTIONS #13)');
  assert(!/<svg|\.svg/.test(layoutFns),
    'A10l: icons are plain unicode ⇅ ▲ ▼ ↺ ✓ — the bottom nav remains the ONE named SVG exception and is not widened (CONVENTIONS #16)');
  assert(/@media \(min-width:600px\)/.test(cssBlock),
    'A10m: a min-width:600px enhancement exists — the base styles are the phone (CONVENTIONS #14)');

  // THE class-name deviation, locked down so it cannot be "fixed" back.
  assert(/\.layout-section\{display:block\}/.test(css),
    'A10n: the wrapper class is .layout-section');
  assert(/\.page-section\{display:none\}/.test(css),
    'A10o: …and .page-section is still the six top-level page containers, display:none until .active — which is exactly why the DI-179c name could not be used for an inner wrapper (a declared deviation; behaviour and the persisted data-section-id values are as specified)');
  assert(!/class="page-section" data-section-id/.test(appSrc10),
    'A10p: …and no section is emitted with the colliding class, which would have hidden every card on both pages');

  // The intentionality gate, structurally: nothing in this feature listens to
  // touch movement at any time. Drew: "It shouldnt move accidentally scrolling."
  assert(!/touchmove|touchstart|dragstart|dragover/.test(layoutFns),
    'A10q: THE CONSTRAINT — no touch or drag listener exists anywhere in the layout controls, so "moves while scrolling" is structurally impossible rather than tuned with a threshold');
  assert(/state\.layoutEditing = null/.test((appSrc10.match(/function resyncPlayerPreferences\(\)[\s\S]*?\n\}/) || [''])[0]),
    'A10r: edit mode is cleared in resyncPlayerPreferences() — the app\'s one chokepoint on login / logout / player switch, so a handed-off phone never arrives still wearing move bars');
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
