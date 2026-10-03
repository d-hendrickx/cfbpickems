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
// SP-56 (2026-09-30): '.ob-action-btn' joins the list so [SF9] can click the REAL payment buttons through the real renderLeaderboard() handler binder.
// SP-57 (2026-10-01): '.layout-edit-btn' is gone with the button (DI-475); the hidden Move / Reset buttons are still parsed.
const CLICKABLE = ['.section-move-btn', '.layout-reset-btn', '.ob-action-btn'];
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
      // SP-57 (DI-386): focusLayoutTarget() reads attributes and calls focus(); both are recorded so "focus survives the
      // repaint" is observable here (globalThis.__layoutFocused is the last button that took focus).
      getAttribute: (n) => { const m = new RegExp('(?:^|\\s)' + n + '="([^"]*)"').exec(attrs); return m ? m[1] : null; },
      focus() { globalThis.__layoutFocused = this; },
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
    appendChild() {}, remove() {},
    // REVIEWER ROUND 3 (B4 residual, 2026-09-29) — listeners are RECORDED
    // (never fired by anything but an explicit `_fire()`), so A11n below can
    // drive the REAL bindWeekSwipe() binder navigateTo('picks') attaches to
    // #page-picks. Nothing else in this suite fires events, so recording is
    // behaviour-neutral for every other section.
    _listeners: null,
    addEventListener(type, fn) { ((this._listeners ||= {})[type] ||= []).push(fn); },
    removeEventListener(type, fn) { if (this._listeners?.[type]) this._listeners[type] = this._listeners[type].filter(h => h !== fn); },
    _fire(type, ev) { (this._listeners?.[type] || []).slice().forEach(fn => fn(ev)); },
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
  app.state.viewingWeekId = viewWeekId; // DI-426 — shared field (formerly picksWeekId)
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
    _listeners: null, // its OWN listener record — the spread would otherwise share orig's (A11n-fixture2 counts orig's)
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


// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9b] DI-428(a) (2026-09-28, amends DI-331d/f) — submitted card, LOGO mode: same treatment as the pick button, at every status, blind rule unchanged…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Extends §9's own fixture/pattern (BUG-4) rather than inventing a new one —
  // this is the "existing render test for the blind rule in logo mode"
  // DI-428(a)'s build note points at. Snapshotted/restored so nothing below
  // inherits it (same idiom loadtest.mjs [1c] uses for its own real-render
  // blind-rule check).
  const snapshot = new Map(store);
  const AWAY_LOGO = 'https://a.espncdn.com/i/teamlogos/ncaa/500/away-9b.png';
  const HOME_LOGO = 'https://a.espncdn.com/i/teamlogos/ncaa/500/home-9b.png';
  try {
    saveGame({ ...mkGame('w_cur', 'g1', 'PRIMARY HOME', 'PRIMARY AWAY', FUTURE),
               status: 'live', homeScore: 17, awayScore: 10,
               homeLogo: HOME_LOGO, awayLogo: AWAY_LOGO });
    saveWeek({ ...cur, status: 'live' });
    saveAllPicks([
      { pickId: 'cp1', weekId: 'w_cur', gameId: 'w_cur_g1', playerId: 'p1', selectedTeam: 'PRIMARY HOME', submittedAt: '2026-09-05T00:00:00Z' },
      { pickId: 'cp2', weekId: 'w_cur', gameId: 'w_cur_g1', playerId: 'p2', selectedTeam: 'PRIMARY AWAY', submittedAt: '2026-09-05T00:00:00Z' },
    ]);
    const p1rec = storage.getPlayer('p1');
    storage.savePlayer({ ...p1rec, preferences: { ...p1rec.preferences, logoView: true } });

    // ── Toggle ON — the real render, driven through window.navigateTo('picks')
    //    exactly like §9, so this is the page a player actually gets. ──
    const pageOn = renderPicks({ playerId: 'p1', verified: true });
    const cardsOn = els.get('submitted-games')._html;
    assert(has(pageOn, M.submitted), '9b-0: fixture check — branch D (submitted view) is still the branch under test');

    // Non-vacuity — this render genuinely painted both teams' logos (public
    // schedule data, not anybody's pick) via the SAME pick-btn-logo-wrap
    // markup the draft-view pick buttons use — proving DI-428(a) actually
    // fired, not merely that the fixture happens to pass.
    assert(cardsOn.includes(AWAY_LOGO) && cardsOn.includes(HOME_LOGO),
      '9b-1: the submitted card renders BOTH teams\' logos — the same pick-btn-logo-wrap treatment as the pick button, reused verbatim');
    assert((cardsOn.match(/class="pick-btn-logo-wrap"/g) || []).length === 2,
      '9b-2: exactly one logo-wrap per team (away + home), not a stray extra or a missing one');
    assert(cardsOn.includes('team-name-logo'),
      '9b-3: the matchup row uses the new .team-name-logo wrapper, not the plain .team-name div, when the toggle is on');

    // ── The BUG-4 marker survives — DI-428(a) must not regress it. ──
    const homeBlockOn = cardsOn.slice(cardsOn.indexOf('<div class="vs-divider"'), cardsOn.indexOf('<div class="spread-row"'));
    const awayBlockOn = cardsOn.slice(cardsOn.indexOf('<div class="team away'), cardsOn.indexOf('<div class="vs-divider"'));
    assert(homeBlockOn.includes('team-picked') && !awayBlockOn.includes('team-picked'),
      '9b-4: the "Your pick" marker is still on PRIMARY HOME (the team p1 actually picked) — unchanged by the logo treatment');
    assert(cardsOn.includes('Your pick'), '9b-5: …and the marker copy is still readable text, not colour/logo alone');

    // ── Blind rule, in LOGO mode specifically — R2-3's own "a REAL render,
    //    not a source-order scan" standard. p2's pick is the OTHER team on
    //    this same public game; the two logos rendered are the GAME's teams,
    //    not anybody's selection, so both are expected — what must NOT
    //    appear is p2's identity or a marker on p2's side. ──
    assert(!cardsOn.includes('Brayden'),
      "9b-6: blind rule (logo mode) — p2's display name appears nowhere on p1's submitted card");
    assert(!awayBlockOn.includes('team-picked') && !awayBlockOn.includes('Your pick'),
      "9b-7: blind rule (logo mode) — PRIMARY AWAY (p2's pick, not p1's) carries no pick marker of any kind, logo or otherwise");

    // ── Toggle OFF — control. Byte-shape regression check: without this
    //    section, an edit to renderGameCard() that hard-coded the logo
    //    treatment (ignoring the toggle) would still pass 9b-1..7. ──
    storage.savePlayer({ ...p1rec, preferences: { ...p1rec.preferences, logoView: false } });
    const pageOff = renderPicks({ playerId: 'p1', verified: true });
    const cardsOff = els.get('submitted-games')._html;
    assert(!cardsOff.includes(AWAY_LOGO) && !cardsOff.includes(HOME_LOGO) && !cardsOff.includes('pick-btn-logo-wrap'),
      '9b-8: toggle OFF — no logo markup at all, byte-shape unchanged from pre-DI-428(a)');
    assert(cardsOff.includes('class="team-name"') && !cardsOff.includes('team-name-logo'),
      '9b-9: toggle OFF — the plain .team-name div is still what renders (never .team-name-logo)');
    const homeBlockOff = cardsOff.slice(cardsOff.indexOf('<div class="vs-divider"'), cardsOff.indexOf('<div class="spread-row"'));
    assert(homeBlockOff.includes('team-picked'),
      '9b-10: toggle OFF — the "Your pick" marker still works exactly as §9 proved (this section did not regress it)');

    // ── Fallback — a manual game (no logos at all) renders the CLASSIC
    //    .team-name/.team-mascot split, never .team-name-logo (round 2,
    //    reviewer F5: round 1 wrapped pickButtonContentHTML()'s bare-text
    //    fallback in .team-name-logo, which has no mascot styling at all —
    //    "Oklahoma (Sooners)" rendered as one undifferentiated string). Uses
    //    a REAL TEAM_MASCOT_LOOKUP entry (Oklahoma -> Sooners, the reviewer's
    //    own cited example), not a fixture school with no mascot, so this
    //    actually exercises the split. ──
    storage.savePlayer({ ...p1rec, preferences: { ...p1rec.preferences, logoView: true } });
    saveGame({ ...mkGame('w_cur', 'g1', 'Oklahoma', 'PRIMARY AWAY', FUTURE),
               status: 'live', homeScore: 17, awayScore: 10,
               isManual: true, homeLogo: HOME_LOGO, awayLogo: HOME_LOGO });
    const pageManual = renderPicks({ playerId: 'p1', verified: true });
    const cardsManual = els.get('submitted-games')._html;
    assert(!cardsManual.includes('<img') && !cardsManual.includes('team-name-logo'),
      '9b-11a: manual game, toggle ON — no <img> (D-12: manual games never get a logo) and NEVER .team-name-logo (that class only wraps a real logo box now, round 2 F5)');
    assert(cardsManual.includes('class="team-name">Oklahoma') && cardsManual.includes('PRIMARY AWAY'),
      '9b-11b: …the classic .team-name div renders the plain school name');
    assert(/<span class="team-mascot">\(Sooners\)<\/span>/.test(cardsManual),
      '9b-11c: …and the TEAM_MASCOT_LOOKUP mascot renders in its own smaller .team-mascot span (F5) — not merged into one 1.05rem string');
    saveGame({ ...mkGame('w_cur', 'g1', 'PRIMARY HOME', 'PRIMARY AWAY', FUTURE), status: 'live', homeScore: 17, awayScore: 10 }); // restore
  } finally {
    store.clear();
    snapshot.forEach((v, k) => store.set(k, v));
  }
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
// MECHANISM (DI-179a, approved): an explicit edit mode + move buttons. NO DRAG
// — which is also why this half of the suite can exist at all: a move here is
// a click on a <button>, so the real handler is drivable end to end in Node.
// SP-57 (2026-10-01) SUPERSEDED the mechanism: the heading button is gone
// (Drew, "30 no"), the entry is a 500 ms hold on a section's TITLE row
// (js/section-drag.js, proven in sectiondragtest.mjs — the engine headless, then
// the real app in a real browser), and the Move up / Move down buttons became the
// PERMANENT .sr-only assistive path (DI-386): present with edit mode OFF. The
// behavioural half of the drag cannot exist here (a touch drag does not emulate
// in Node), so THIS file keeps owning what Node can prove: the order algorithm,
// the persisted shape, the markup contract and the source/CSS pins that moved.
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
const { DEFAULT_SECTIONS, SECTION_LABELS, effectiveOrder, moveSection, reorderedSections, reorderedSectionsTo } = app;

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
  app.state.viewingWeekId = weekId; // DI-426 — shared field (formerly dashboardWeekId)
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
// UPDATED — DI-330 (Group E, 2026-09-25, UX Revamp wiring pass 1) replaces
// the literal ⭐ with icon('almaMater') at both "Alma Mater Watch" and
// "Alma Mater Rankings" headings (AD-93). Every `at(..., 'Alma Mater …')`
// text-position lookup below is matched on the school-name text alone now,
// not the removed emoji prefix.
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
         at(d, 'data-section-id="dash-alma"') < at(d, 'Alma Mater Watch'),
    'A2b: each wrapper really contains the card it claims — the ids are not decorative');

  const s = renderStand({ playerId: 'p1', verified: true });
  assert(sameArr(sectionIds(s), [...STAND_DEF]),
    `A2c: Standings is in default order, with FEAT-9's ledger at index 2 exactly where pass F1 hard-coded it (got ${sectionIds(s).join(' > ')})`);
  assert(at(s, 'data-section-id="stand-extrapoint"') < at(s, '🎯 Extra Point Ledger') &&
         at(s, '🎯 Extra Point Ledger') < at(s, 'Alma Mater Rankings'),
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

  // A2j REWRITTEN 2026-09-24 (teaser retired, Drew — Option A). It used to
  // assert the chat teaser was PINNED above every reorderable section
  // (DI-179c / DI-179k item 2) — inserted afterbegin by renderDashboard(),
  // outside the inner template, and replaced in place by chat-ui.js on live
  // activity. The card is gone, so the pinning rule has nothing to govern.
  //
  // The assertion is INVERTED rather than deleted because this suite is the
  // one that would notice the card coming back: layout order is exactly where
  // a reintroduced Dashboard card would first show up, and DI-179k item 2's
  // "pinned above the sections" slot is still sitting there in the code
  // (the prelink banner uses it). A2k below proves the fixture can see that
  // slot at all, so this is not vacuous.
  const dTeaser = renderDash({ playerId: 'p1', verified: true });
  assert(!has(dTeaser, 'dash-chat-teaser') && !has(dTeaser, 'dash-chat-preview'),
    'A2j: the Dashboard renders with NO chat teaser and no message preview — the card is retired, and this is where a reintroduction would surface first');
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
  assert(at(d, '📋 All Picks by Game') < at(d, 'Alma Mater Watch') &&
         at(d, 'Alma Mater Watch') < at(d, 'This Week Score Summary'),
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
  app.state.layoutEditing = null;
  const before = renderDash({ playerId: 'p1', verified: true });
  const visible = sectionIds(before);
  assert(has(before, 'section-move-bar') && app.state.layoutEditing === null,
    'A4a-0: fixture check — edit mode is OFF and the hidden move bars rendered anyway (DI-386, Q2: the assistive path is permanent, never gated on a mode)');
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
  app.state.layoutEditing = null;     // SP-57: no mode needed — the buttons are in the page
  const beforeIds = sectionIds(renderDash({ playerId: 'p1', verified: true }));
  const moveBtns  = els.get('page-dashboard').querySelectorAll('.section-move-btn').filter(b => b.dataset.moveDir);
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
  // ── A4k..A4n — DI-386: FOCUS SURVIVES THE REPAINT, through the same real click ──
  // A move repaints the page, which destroys the focused button; without the one-shot `state.layoutFocus` a VoiceOver user
  // lands at the top of the page after every tap. The stub records focus() (see parseClickables).
  assert(app.state.layoutFocus === null, 'A4k-0: fixture — the focus one-shot was CONSUMED by the repaint the click caused (it never lingers into the next paint)');
  const focused1 = globalThis.__layoutFocused;
  assert(!!focused1 && focused1.dataset.moveId === beforeIds[0] && focused1.dataset.moveDir === 'down',
    `A4k: after ▼ on the top section its section-and-direction twin holds focus again (the button that was just activated, found anew in the new markup): got ${focused1 ? focused1.dataset.moveId + '/' + focused1.dataset.moveDir : 'nothing'}`);
  // Move the SECOND-TO-LAST section down: it becomes last, so its Down is now disabled — focus goes to the OTHER button (Up).
  clearSectionOrder('dashboard');
  const ids4 = sectionIds(renderDash({ playerId: 'p1', verified: true }));
  const penult = ids4[ids4.length - 2];
  globalThis.__layoutFocused = null;
  els.get('page-dashboard').querySelectorAll('.section-move-btn').find(b => b.dataset.moveId === penult && b.dataset.moveDir === 'down').click();
  const focused2 = globalThis.__layoutFocused;
  assert(!!focused2 && focused2.dataset.moveId === penult && focused2.dataset.moveDir === 'up',
    `A4l: when the activated direction is now DISABLED (it became the last section) focus falls to the OTHER direction of the same section, never to nothing (got ${focused2 ? focused2.dataset.moveId + '/' + focused2.dataset.moveDir : 'nothing'})`);
  clearSectionOrder('dashboard');
  const ids5 = sectionIds(renderDash({ playerId: 'p1', verified: true }));
  globalThis.__layoutFocused = null;
  els.get('page-dashboard').querySelectorAll('.section-move-btn').find(b => b.dataset.moveId === ids5[1] && b.dataset.moveDir === 'up').click();
  const focused3 = globalThis.__layoutFocused;
  assert(!!focused3 && focused3.dataset.moveId === ids5[1] && focused3.dataset.moveDir === 'down',
    `A4m: …and symmetrically ▲ that lands the section FIRST (its Up is now disabled) focuses its Down (got ${focused3 ? focused3.dataset.moveId + '/' + focused3.dataset.moveDir : 'nothing'})`);
  // The announcement is the one-shot too, and the move is toast-free (four moves would be four toasts; the repaint is the feedback).
  assert(app.state.layoutAnnounce === null, 'A4n: the announcement one-shot is consumed by the same repaint — nothing lingers for the next paint');
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

  // The affordance itself, and the copy, in the rendered markup. SP-57 (DI-386, DI-475): the Reset is a hidden
  // per-page TWIN that exists with edit mode OFF; the visible "Reset to default" / "Done" live in the fixed bar on <body>
  // (js/app.js syncLayoutEditBar()) and are NEVER part of the page markup, in any state.
  app.state.layoutEditing = null;
  const idle = renderStand({ playerId: 'p1', verified: true });
  assert(has(idle, 'Reset Standings layout to default') && (idle.match(/layout-reset-btn/g) || []).length === 1,
    'A5d: the hidden Reset twin renders with edit mode OFF — exactly one per page, named for its page');
  assert(!has(idle, 'Reset to default') && !has(idle, '↺'),
    'A5e: …and the page markup carries no VISIBLE "Reset to default" (that label lives in the body-mounted bar) and no glyph');
  assert(!has(idle, 'Edit layout') && !has(idle, '⇅') && !has(idle, 'layout-edit-btn'),
    'A5f: idle shows NO Edit layout button (Drew, "30 no") — and none of its glyphs or its class');
  app.state.layoutEditing = 'standings';
  const editingHtml = renderStand({ playerId: 'p1', verified: true });
  assert(!/>\s*(✓\s*)?Done\s*</.test(editingHtml) && !has(editingHtml, '✓'),
    'A5g: even while editing the page markup has no Done — it exists only in the fixed bar on <body>');
  assert(has(editingHtml, 'section-move-bar') && has(editingHtml, 'Reset Standings layout to default'),
    'A5g-2: …and the hidden path is identical while editing (it never depended on the mode)');

  // ── A5h — THE RESET HANDLER'S ARGUMENT, driven through a real click ──
  // F2 review note (g). `clearSectionOrder(pageKey)` vs `clearSectionOrder('dashboard')`
  // is a one-word difference that no assertion could see while the reset was
  // only ever called directly: resetting Standings must not touch the Dashboard.
  setSectionOrder('dashboard', ['dash-tiebreaker', 'dash-summary', 'dash-alma', 'dash-picks']);
  setSectionOrder('standings', ['stand-history', 'stand-season', 'stand-extrapoint', 'stand-alma', 'stand-2025-open', 'stand-2025-record']);
  app.state.layoutEditing = null;     // SP-57: the twin works with edit mode OFF
  renderStand({ playerId: 'p1', verified: true });
  const resetBtns = els.get('page-leaderboard').querySelectorAll('.layout-reset-btn');
  assert(resetBtns.length === 1 && resetBtns[0]._bound() > 0,
    `A5h-0: fixture check — exactly one hidden Reset twin rendered on Standings and it has a click listener (found ${resetBtns.length})`);
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
  assert(sectionIds(locked).length === 0 && !has(locked, 'Edit layout') && !has(locked, 'section-move-bar') && !has(locked, 'layout-reset-btn'),
    'A6h: …so there are no sections, no Edit layout button and no hidden Move / Reset buttons on that screen — there is nothing to reorder');
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

  app.state.layoutEditing = null;     // SP-57: idle — the hidden path needs no mode
  const noTBedit = renderDash({ playerId: 'p1', verified: true });
  const barBlocks = [...noTBedit.matchAll(/<div class="section-move-bar sr-only">[\s\S]*?<\/div>/g)].map(m => m[0]);
  assert(barBlocks.length === 4,
    `A7d: the hidden path emits a move bar per VISIBLE section only — three — plus the page's ONE Reset twin, not four sections (got ${barBlocks.length} blocks); an invisible section with Move buttons is a phantom control`);
  // Counted on the BUTTONS, not on a glyph: there is no ▲ / ▼ glyph in the chrome any more — the text IS the accessible name.
  assert((noTBedit.match(/data-move-dir="down"/g) || []).length === 3 &&
         (noTBedit.match(/data-move-dir="up"/g) || []).length === 3 &&
         !/>▲<\/button>|>▼<\/button>/.test(noTBedit),
    'A7e: …three Up buttons and three Down buttons, one pair per visible section, with text and no glyph');
  app.state.layoutEditing = 'dashboard';
  const noTBeditOn = renderDash({ playerId: 'p1', verified: true });
  const barBlocksOn = [...noTBeditOn.matchAll(/<div class="section-move-bar sr-only">[\s\S]*?<\/div>/g)].map(m => m[0]);
  assert(barBlocksOn.length === barBlocks.length && barBlocksOn.every((b, i) => b === barBlocks[i]),
    'A7e-2: …and the hidden path is BYTE-IDENTICAL with edit mode on — the mode neither adds nor removes a button');
  app.state.layoutEditing = null;
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
  assert(!has(d, 'Edit layout') && !has(d, '⇅'), 'A8a: a signed-out viewer gets NO Edit layout button on the Dashboard');
  assert(!has(d, 'section-move-bar') && !has(d, 'layout-reset-btn') && !has(d, 'layout-live') && !has(d, 'data-move-id'),
    'A8b: …and no hidden Move buttons, no Reset twin and no live region, in any state (DI-179g: the one canCustomizeLayout() gate)');
  assert(sameArr(sectionIds(d), [...DASH_DEF]), 'A8c: …and the league default order');

  const s = renderStand({});
  assert(!has(s, 'Edit layout') && !has(s, 'section-move-bar') && !has(s, 'layout-reset-btn'), 'A8d: same on Standings — no button, no hidden path');
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
  assert(has(admin, 'section-move-bar') && has(admin, 'Reset Dashboard layout to default') && !has(admin, 'Edit layout'),
    'A8h: a commissioner gets the identical hidden path — this is a personal preference, not commissioner data');
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
  app.state.viewingWeekId = 'w_layout'; // DI-426 — shared field (formerly dashboardWeekId)
  window.navigateTo('dashboard');
  assert(sameArr(sectionIds(els.get('page-dashboard')._html), dFirst),
    'A9e: the Dashboard order survives its own re-render path too');

  clearSectionOrder('dashboard'); clearSectionOrder('standings');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[A9z] DI-426 (UN-381) — ONE shared viewing week for Picks and Dashboard… (runs between A9 and A10 — see file note)');
// ═════════════════════════════════════════════════════════════════════════════
{
  setSession('p1', false, true);
  // 'w_layout' (weekNumber 9) vs the active week 'w_cur' (weekNumber 2) —
  // two genuinely different, already-on-file weeks (§A fixtures, above).
  app.state.viewingWeekId = null;

  // A11a/b — a write on PICKS is visible via the DASHBOARD read path.
  renderPicks({ playerId: 'p1', verified: true, viewWeekId: 'w_layout' });
  assert(app.state.viewingWeekId === 'w_layout',
    'A11a: fixture — viewing "w_layout" on Picks wrote the ONE shared state.viewingWeekId');
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard'); // NOT renderDash() — that helper writes its own weekId; this call must read the field Picks just wrote
  const dashAfterPicks = els.get('page-dashboard')._html;
  assert(dashAfterPicks.includes('Week 9') && !dashAfterPicks.includes('>Week 2<'),
    `A11b: switching to Dashboard WITHOUT touching state.viewingWeekId shows week 9 (the week Picks was just viewing), not the active week 2 (dashboard html snippet: ${dashAfterPicks.slice(dashAfterPicks.indexOf('picks-week-nav-label') - 5, dashAfterPicks.indexOf('picks-week-nav-label') + 80)})`);

  // A11c/d — the REVERSE: a write on DASHBOARD is visible via the PICKS read path.
  app.state.viewingWeekId = null;
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard');
  // Same effect as clicking the [data-dashboard-week="w_layout"] arrow
  // (bindDashboardWeekNav() itself just writes this same shared field).
  app.state.viewingWeekId = 'w_layout';
  assert(app.state.viewingWeekId === 'w_layout', 'A11c: fixture — viewing "w_layout" on Dashboard wrote the shared field');
  els.get('page-picks')._html = '';
  window.navigateTo('picks');
  const picksAfterDash = els.get('page-picks')._html;
  assert(picksAfterDash.includes('week-status-card') === false && /LAYOUT HOME|w_layout_g1|hist-game-row/.test(picksAfterDash),
    'A11d: switching to Picks WITHOUT touching state.viewingWeekId shows the historical read-only view of week 9 (the week Dashboard was just viewing) — the reverse direction');

  // A11e — reload (no persistence): state.viewingWeekId is an in-memory field
  // only, reset to null at every fresh boot — never behind storage.js's
  // load()/save() seam. Structural: the state object literal itself.
  const appSrcA11 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/viewingWeekId:\s*null,/.test(appSrcA11),
    'A11e: state.viewingWeekId is seeded to null in the state object literal — the SAME "not persisted, resets on boot" contract state.picksWeekId/state.dashboardWeekId individually had before this DI');
  const storageSrcA11 = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
  assert(!/viewingWeekId/.test(storageSrcA11),
    'A11f: structural — "viewingWeekId" appears nowhere in storage.js (never a KEYS entry, never routed through load()/save() — an in-memory app.js `state` field only, per DI-426\'s own "recommend NOT persisting" call)');

  // A11g-i — REVIEWER ROUND 2 (B4 BLOCK, 2026-09-28) — REWRITTEN: the old
  // A11g/h only proved Dashboard itself didn't crash on a draft id (the
  // UNREACHABLE direction — Dashboard's own list already includes commissioner
  // drafts, so that path was never actually broken). The REAL bug was the
  // REVERSE: Picks' own list (picksNavWeeks()) excludes EVERY draft
  // unconditionally, so a week the shared field points at that Picks
  // cannot navigate to used to fall through to renderHistoricalPicksView()
  // anyway (a raw getWeek() lookup), landing at nav index -1 — both arrows
  // disabled, the swipe dead, and labeled "past week (read-only)" for what
  // may be a future draft being set up. Commissioner draft round trip:
  const draftWk = mkWeek({ weekId: 'w_di426_draft', weekNumber: 20, status: 'draft' });
  saveWeek(draftWk);
  setSession('p1', true, true); // commissioner — Dashboard's own list includes drafts only for this viewer
  // Same effect as clicking the draft's own arrow/card on Dashboard.
  app.state.viewingWeekId = 'w_di426_draft';
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard');
  assert(els.get('page-dashboard')._html.includes('Week 20'),
    'A11g-fixture: fixture — Dashboard shows the draft (week 20) to the commissioner when state.viewingWeekId points at it (confirms the precondition: Dashboard CAN show a week Picks cannot)');
  els.get('page-picks')._html = '';
  window.navigateTo('picks');
  const picksOnDraft = els.get('page-picks')._html;
  assert(!/past week \(read-only\)/.test(picksOnDraft),
    `A11g: [B4] Picks does NOT render the draft as a broken "past week (read-only)" historical view (it cannot navigate to it at all) (snippet: ${picksOnDraft.slice(0, 200)})`);
  assert(picksOnDraft.includes('Week 2') && !picksOnDraft.includes('Week 20'),
    `A11h: …it falls through to the CURRENT week (Week 2) instead (snippet around the label: ${picksOnDraft.slice(picksOnDraft.indexOf('picks-week-nav-label') - 5, picksOnDraft.indexOf('picks-week-nav-label') + 60)})`);
  assert(app.state.viewingWeekId === 'w_di426_draft',
    'A11i: [B4] …and, critically, state.viewingWeekId is LEFT UNTOUCHED — Picks could not show it, so it never claims/clears the shared field; Dashboard must still find it on return');
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard');
  assert(els.get('page-dashboard')._html.includes('Week 20'),
    `A11j: [B4] …and switching BACK to Dashboard WITHOUT touching state.viewingWeekId again shows the SAME draft (week 20), not silently stranded on the current week (snippet: ${els.get('page-dashboard')._html.slice(0, 200)})`);

  // A11k-m — REVIEWER ROUND 2 (B4 BLOCK) — the SAME class of gap reaches a
  // REGULAR (non-commissioner) PLAYER too: a week with showInHistory:false
  // is excluded from picksNavWeeks() (Picks' own list, unconditionally) but
  // carries NO such exclusion in selectableDashboardWeeks() — so it can
  // legitimately show on Dashboard for ANY viewer, not just a
  // commissioner-only draft.
  const hiddenWk = mkWeek({ weekId: 'w_di426_hidden', weekNumber: 21, status: 'final', showInHistory: false });
  saveWeek(hiddenWk);
  setSession('p1', false, true); // a REGULAR, non-admin player
  app.state.viewingWeekId = null;
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard');
  app.state.viewingWeekId = 'w_di426_hidden';
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard');
  assert(els.get('page-dashboard')._html.includes('Week 21'),
    'A11k-fixture: fixture — Dashboard shows the showInHistory:false week to a REGULAR player too (confirms selectableDashboardWeeks() carries no such exclusion, unlike picksNavWeeks())');
  els.get('page-picks')._html = '';
  window.navigateTo('picks');
  const picksOnHidden = els.get('page-picks')._html;
  assert(!/past week \(read-only\)/.test(picksOnHidden),
    'A11k: [B4] a showInHistory:false week reaching Picks via the shared field also falls through to the current week, not a broken historical view');
  assert(app.state.viewingWeekId === 'w_di426_hidden',
    'A11l: [B4] …and again leaves state.viewingWeekId untouched for Dashboard\'s own sake');
  els.get('page-dashboard')._html = '';
  window.navigateTo('dashboard');
  assert(els.get('page-dashboard')._html.includes('Week 21'),
    'A11m: …and Dashboard still shows the SAME hidden week on return');

  // A11n-r — REVIEWER ROUND 3 (B4 residual, 2026-09-29) — the reviewer's
  // EXACT failing sequence, in real Chrome: after the B4 draft fallback
  // (commissioner, shared field on a draft Picks cannot show, Picks falls
  // through to the current week), a L→R swipe on Picks only rubber-banded
  // and stayed on the current week, because the swipe's getState() still
  // reported the DRAFT's id (not in Picks' list → index -1 → "at bound").
  // Same starting state, same events: the draft id on the shared field,
  // navigateTo('picks') (which renders AND binds the real bindWeekSwipe()
  // on #page-picks), then touchstart + touchmove L→R past SWIPE_COMMIT_PX
  // through that REAL binder's listeners.
  setSession('p1', true, true);
  app.state.viewingWeekId = 'w_di426_draft';
  els.get('page-picks')._html = '';
  window.navigateTo('picks');
  const picksFallback = els.get('page-picks')._html;
  assert(picksFallback.includes('>Week 2<') && app.state.viewingWeekId === 'w_di426_draft',
    `A11n-fixture: fixture — the B4 fallback state: Picks shows the current week (Week 2) while the shared field still names the draft (field: ${app.state.viewingWeekId})`);
  const pp = els.get('page-picks');
  assert((pp._listeners?.touchstart || []).length === 1 && (pp._listeners?.touchmove || []).length === 1,
    `A11n-fixture2: fixture — navigateTo('picks') bound exactly ONE real week-swipe listener set on #page-picks (touchstart ${(pp._listeners?.touchstart || []).length}, touchmove ${(pp._listeners?.touchmove || []).length})`);
  // The resolver the binder's getState() calls at touchstart (A11o proves
  // the getState() really does call it), read through its test hook.
  assert(app._picksShowingWeekForTest().showingWeekId === 'w_cur',
    `A11n: [B4 residual] the week Picks' swipe starts from is the week Picks SHOWS (w_cur), not the draft the shared field names (got ${app._picksShowingWeekForTest().showingWeekId})`);
  const appSrcA11n = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const gsIdx = appSrcA11n.indexOf("bindWeekSwipe(document.getElementById('page-picks')");
  const gsWin = gsIdx === -1 ? '' : appSrcA11n.slice(gsIdx, appSrcA11n.indexOf('}, (targetId)', gsIdx));
  assert(gsIdx !== -1 && /currentWeekId:\s*picksShowingWeek\(\)\.showingWeekId/.test(gsWin) && !/state\.viewingWeekId/.test(gsWin.replace(/\/\/.*$/gm, '')),
    'A11o: structural — the Picks swipe getState() reads picksShowingWeek(), the SAME resolver renderPicksPage() uses, and never the raw shared field (comments stripped)');
  // THE behavioural proof: the real binder, real touch sequence.
  pp._fire('touchstart', { touches: [{ clientX: 150, clientY: 400 }], target: pp });
  pp._fire('touchmove', { touches: [{ clientX: 170, clientY: 401 }], target: pp }); // dx=20 — axis locks to x, below commit
  pp._fire('touchmove', { touches: [{ clientX: 210, clientY: 402 }], target: pp }); // dx=60 — past SWIPE_COMMIT_PX(40)
  pp._fire('touchend', {});
  assert(app.state.viewingWeekId === 'w_past',
    `A11p: [B4 residual] a real L→R bindWeekSwipe drag from the fallback navigates to the PREVIOUS week in Picks' own list (w_past, Week 1) — on the round-2 tree this stayed on the draft id and only rubber-banded (field now: ${app.state.viewingWeekId})`);
  assert(pp._html.includes('PAST BLURB MARKER') && pp._html.includes('>Week 1<'),
    `A11q: …and Picks now actually renders Week 1 (snippet: ${pp._html.slice(pp._html.indexOf('picks-week-nav-label') - 5, pp._html.indexOf('picks-week-nav-label') + 60)})`);
  // The arrows and the swipe agree: the fallback page's own ‹ arrow pointed
  // at the same week the swipe just went to.
  assert(/data-picks-week="w_past"[^>]*aria-label="Previous week"/.test(picksFallback),
    'A11r: …the SAME week the fallback page\'s own ‹ arrow targets — arrows and swipe resolve from one "showing" week');
  pp._fire('transitionend', { target: pp }); // release the binder's busy latch for any later suite section

  app.state.viewingWeekId = null;
  setSession('p1', false, true);
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

  const editRule = ruleOf('.layout-reset-btn');
  const eh = Number((editRule.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
  assert(eh >= 44,
    `A10b: the Reset buttons carry an explicit min-height ≥44px (got ${eh}px) — .btn-sm's base is 34px, under the floor`);
  assert(!/^\.btn-sm\{[^}]*min-height:4[4-9]px/m.test(css),
    'A10c: …achieved by a SCOPED override, not by raising .btn-sm globally, which would reflow every compact row in the app');

  // No tooltips. They do not fire on touch, and this has bitten twice.
  const appSrc10 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const layoutFns = (appSrc10.match(/function (composeSections|bindLayoutEditHandlers|syncLayoutEditBar|resetLayoutPage|layoutSavedToast|unmountLayoutEditBar|endLayoutEditing)\([\s\S]*?\n\}/g) || []).join('\n');
  assert(layoutFns.length > 500, 'A10d-0: fixture check — the surviving layout render/bind functions were located in source (SP-57 retired layoutEditButtonHTML and layoutEditStripHTML)');
  assert(!/title=/.test(layoutFns),
    'A10d: no `title` attribute anywhere in the layout controls — tooltips do not fire on touch; every state is carried by visible text or aria-label');
  assert(/aria-label="Move \$\{escHtml\(label\)\} up"/.test(layoutFns) && /aria-label="Move \$\{escHtml\(label\)\} down"/.test(layoutFns),
    'A10e: …and the ▲/▼ buttons carry named aria-labels instead ("Move Alma Mater Watch up")');
  const sdSrc10 = await readFile(new URL('./js/section-drag.js', import.meta.url), 'utf8');
  assert(/el\.setAttribute\('aria-live', 'polite'\)/.test(sdSrc10) && /el\.id = 'layout-live'/.test(sdSrc10) && !/layout-live-region/.test(appSrc10),
    'A10f: the persistent aria-live="polite" region (#layout-live, on <body>, created once by js/section-drag.js) exists for the after-move announcement, and the retired in-flow #layout-live-region is gone from app.js');
  assert(/moved to position \$\{/.test(sdSrc10) && /movedAnnouncement\(\{ label: SECTION_LABELS\[id\] \|\| id, n: nowVisible\.indexOf\(id\) \+ 1, m: nowVisible\.length \}\)/.test(appSrc10),
    'A10g: …and the announcement names the new position over the VISIBLE list ("Alma Mater Watch moved to position 2 of 4.") — one string, built by movedAnnouncement()');

  // No individual-move toast (four moves would be four toasts); a toast on
  // Reset, because it is destructive and its result may be off-screen.
  const bindSrcRaw = (appSrc10.match(/function bindLayoutEditHandlers\([\s\S]*?\n\}\n/) || [''])[0];
  // Comment lines stripped — this file explains in prose WHY there is no
  // confirm() on Reset, and a naive grep would match the explanation.
  const bindSrc = bindSrcRaw.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  assert((bindSrc.match(/showToast\(/g) || []).length === 0,
    'A10h: NO toast is raised in the bind pass — and in particular none by a hidden Move click (four moves would be four toasts; the re-render IS the feedback for a move)');
  const resetSrc10 = (appSrc10.match(/function resetLayoutPage\([\s\S]*?\n\}\n/) || [''])[0].split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  assert((resetSrc10.match(/showToast\(/g) || []).length === 1 && /const LAYOUT_RESET_TOAST = '↺ Layout reset to the default';/.test(appSrc10) && /showToast\(LAYOUT_RESET_TOAST, 'success'\)/.test(resetSrc10),
    'A10i: …Reset raises exactly ONE toast, the existing string (no "order" word, UN-77 / loadtest [8d]); Done raises the save toast in layoutSavedToast()');
  assert(!/confirm\(/.test(bindSrc),
    'A10j: no confirm() on Reset — this app reserves confirm() for money-affecting commissioner actions, and Reset is one tap to undo by hand');

  // CSS house rules.
  //
  // iOS Munera thread, PASS 1b (2026-09-20) — BOUNDED, not sliced to EOF.
  // The unbounded slice(start) below used to reach the literal end of
  // styles.css, which was harmless only because nothing had been appended
  // after UN-179's own CSS yet. The instant any later thread appends new
  // CSS at the bottom of the file (exactly what this pass's one native-
  // scoped rule block does), this test's scope silently widens to include
  // code that was never UN-179's to answer for, and a hardcoded color in
  // THAT later block fails A10k as if UN-179 itself regressed. Bounded at
  // the next dated section's own header comment instead, restoring the
  // test's actual intent: scan UN-179's CSS block, not "everything after
  // it, forever."
  const un179Start = css.indexOf('SP-57 (2026-10-01) — long-press section drag');
  const un179End = css.indexOf('FEAT-3 / DI-200f', un179Start);
  const cssBlock = css.slice(un179Start, un179End > un179Start ? un179End : undefined);
  assert(cssBlock.length > 800, 'A10k-0: fixture check — the SP-57 CSS block (the rewritten UN-179 block) was located');
  const codeLines = cssBlock.split('\n').filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l));
  assert(!codeLines.some(l => /#[0-9a-fA-F]{3,8}\b/.test(l)),
    'A10k: no hex colours in the UN-179 CSS — seven themes swap through custom properties (CONVENTIONS #13)');
  assert(!/<svg|\.svg/.test(layoutFns) && !/[⇅▲▼✓]/.test(layoutFns),
    'A10l: no raw <svg> and none of the retired glyphs ⇅ ▲ ▼ ✓ in the layout functions (CONVENTIONS #16 / D-1) — any icon arrives through icon(), and the grip is added by js/section-drag.js from icons.js');
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
  assert(!/touchmove|touchstart|touchend|dragstart|dragover|mousedown|pointerdown/.test(layoutFns),
    'A10q: THE CONSTRAINT, re-pointed (SP-57), not deleted — composeSections and bindLayoutEditHandlers (and every other layout function in app.js) still register NO touch, mouse or drag listener themselves');
  const nonImportSrc10 = appSrc10.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l) && !/^import\b|^\s*attachSectionDrag, detachSectionDrag/.test(l)).join('\n');
  assert((nonImportSrc10.match(/attachSectionDrag\(/g) || []).length === 1 && (nonImportSrc10.match(/detachSectionDrag\(/g) || []).length === 1,
    "A10q-2: …the ONLY thing that hands a page to the touch engine is ONE attachSectionDrag() call (and its signed-out detach twin) in bindLayoutEditHandlers; js/section-drag.js is the only module that registers the listeners, and AT1-AT7 in sectiondragtest.mjs are the behavioural proof");
  // SIXTH GATE (2026-09-17) — matched by the opening PAREN, not `()`.
  // resyncPlayerPreferences() takes an options object now, and a needle pinned
  // to the empty argument list stopped matching the function at all — which
  // turns this rule VACUOUS-then-RED rather than catching anything real.
  const resyncFn10 = (appSrc10.match(/function resyncPlayerPreferences\([\s\S]*?\n\}/) || [''])[0];
  assert(!!resyncFn10, 'A10r fixture: resyncPlayerPreferences() was located (a stale needle would make the rule below meaningless)');
  assert(/state\.layoutEditing = null/.test(resyncFn10),
    'A10r: edit mode is cleared in resyncPlayerPreferences() — the app\'s one chokepoint on login / logout / player switch, so a handed-off phone never arrives still wearing move bars');
  // …and the ONE exemption is named, not implicit. DI-180o(b) suspends layout
  // edit mode alongside the draft ("the bars come off the page now and come back
  // with the slate"), so the single path that has just RESTORED a suspended
  // slate — same account, same league, byte-identical tuple — must not have it
  // nulled again one line later. Every other caller passes nothing and clears.
  assert(/if \(!preserveLayoutEditing\) syncLayoutEditBar\(\);/.test(resyncFn10) && /state\.layoutFocus = null/.test(resyncFn10),
    'A10r(0): SP-57 — resyncPlayerPreferences() also takes the fixed Rearranging bar down with the mode (syncLayoutEditBar()) and drops the focus one-shot, only on the path that cleared the mode');
  assert(/if \(!preserveLayoutEditing\) state\.layoutEditing = null;/.test(resyncFn10),
    'A10r(ii): …and the clear is unconditional EXCEPT for one named parameter — so the exemption is a thing a reader can find, not a silent early return');
  assert(/preserveLayoutEditing: outcome === 'restored'/.test(appSrc10),
    'A10r(iii): …which only the suspended-slate RESTORE path sets. A handover, a sign-out, a league switch and a discard all still clear the bars.');
}

// ── DI-394 (UN-354, 2026-09-27) — the shared viewing-week card ─────────────
// Consolidated onto ONE weekNavCardHTML() (js/app.js), reused by BOTH Picks
// (renderPicksWeekNav()) and Dashboard (renderDashboardWeekNav()) — a change
// reaches both pages by construction. Source-level pins (this file's DOM
// harness is scoped to Picks-page-order fixtures; a full Dashboard fixture
// is out of this pass's scope) — the behavioural half is exercised for real
// by authtest.mjs's tickAutoTransition() fixtures and by hand on-device.
console.log('\n[DI-394] the shared viewing-week card — one function, two pages, no duplicate control…');
{
  const appSrcD394 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/function weekNavCardHTML\(viewWeek, currentWeek, weeksForOrder, \{ dataAttr \}\)/.test(appSrcD394),
    'weekNavCardHTML() exists with the shared (viewWeek, currentWeek, weeksForOrder, {dataAttr}) signature');
  assert(/function renderPicksWeekNav\(viewWeek, currentWeek\) \{\s*return weekNavCardHTML\(viewWeek, currentWeek, picksNavWeeks\(\), \{ dataAttr: 'picks-week' \}\);/.test(appSrcD394),
    "renderPicksWeekNav() is a thin wrapper over weekNavCardHTML() — Picks' own week list (picksNavWeeks()), unchanged filter rules");
  assert(/function renderDashboardWeekNav\(viewWeek, currentWeek\) \{/.test(appSrcD394) && /selectableDashboardWeeks\(getWeeks\(\), isCommissioner\)/.test(appSrcD394.slice(appSrcD394.indexOf('function renderDashboardWeekNav'), appSrcD394.indexOf('function renderDashboardWeekNav') + 400)),
    "renderDashboardWeekNav() is a thin wrapper over the SAME weekNavCardHTML() — Dashboard's own week list (selectableDashboardWeeks()), unchanged filter rules (drafts visible to the commissioner)");
  assert(/chronologicalWeekIds\(weeksForOrder\)/.test(appSrcD394),
    "weekNavCardHTML()'s prev/next math is resolved via chronologicalWeekIds() — the SAME oldest→newest normalization RG-264's dashboard-swipe fix made the one source of truth, never each list's own raw (possibly newest-first) sort order");
  assert(/function bindDashboardWeekNav\(\) \{/.test(appSrcD394) && /data-dashboard-week/.test(appSrcD394),
    'bindDashboardWeekNav() exists and binds [data-dashboard-week] click targets, mirroring bindPicksWeekNav()\'s own [data-picks-week] shape');

  // The redundant `<select id="week-selector">` DI-394's own research
  // flagged (a second control doing the identical job as the shared card) is
  // RETIRED, not merely hidden.
  assert(!/<select class="form-select" id="week-selector">/.test(appSrcD394),
    'the redundant Dashboard `<select id="week-selector">` markup is gone entirely — the shared arrow-nav card is the ONE control that decides which week Dashboard shows (the id still appears in this pass\'s own retirement comments, which is what the narrower markup-only check above rules out matching)');
  const dashInnerSrc = appSrcD394.slice(appSrcD394.indexOf('function renderDashboardInner()'), appSrcD394.indexOf('function renderDashboardInner()') + 12000);
  assert(/renderDashboardWeekNav\(week, currentWeek\)/.test(dashInnerSrc),
    'renderDashboardInner() renders the shared card (renderDashboardWeekNav(week, currentWeek)) in place of the old <select>');
  assert(/bindDashboardWeekNav\(\);/.test(dashInnerSrc),
    'renderDashboardInner() binds the card\'s arrow clicks (bindDashboardWeekNav())');

  // The card always renders SOMETHING once a viewWeek exists — arrows are
  // the only thing gated on multiple weeks, never the whole card — so a
  // single-week league never loses week identification entirely now that
  // the header (DI-393) no longer carries a date as a fallback.
  const cardFnSrc = appSrcD394.slice(appSrcD394.indexOf('function weekNavCardHTML'), appSrcD394.indexOf('function weekNavCardHTML') + 1800);
  assert(/const hasMultiple = orderedIds.length > 1;/.test(cardFnSrc) && !/if \(orderedIds\.length < 2\) return '';/.test(cardFnSrc),
    "weekNavCardHTML() no longer returns '' below two weeks (the pre-DI-394 renderPicksWeekNav() did) — only the ARROWS are gated on hasMultiple, so name/badge/date still render for a single-week league");
}

// ═════════════════════════════════════════════════════════════════════════════
// SP-57 (2026-10-01) — LONG-PRESS SECTION DRAG, the pins Node can hold: the pure drop rule, the markup contract, the retired button, the CSS
// contract (z-index map, the lock, the hidden path's reveal, zero layout shift, tokens, Breathing Room) and the lifecycle's source pins. The
// BEHAVIOUR (the hold, the lift, the drop, the auto-scroll, the claims) is proven in sectiondragtest.mjs, headless then in a real browser.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SP57-a] reorderedSectionsTo() — the drop\'s write: pure, total, and the same hidden-section rule as the ▲/▼ move…');
{
  const { reorderedSectionsTo, reorderedSections } = app;
  const P = (o, v, id, to) => reorderedSectionsTo(o, v, id, to).join('>');
  const o4 = ['a', 'b', 'c', 'd'];
  assert(P(o4, o4, 'a', 2) === 'b>c>a>d' && P(o4, o4, 'd', 0) === 'd>a>b>c' && P(o4, o4, 'b', 3) === 'a>c>d>b', 'SP57-a1: a section dropped in slot n lands in slot n (forward, backward, to the end)');
  assert(P(o4, o4, 'b', 1) === 'a>b>c>d', 'SP57-a2: a drop in the slot it already holds returns the order unchanged (the engine never even calls it: one write per drop, only when something moved)');
  assert(P(o4, o4, 'a', -5) === 'a>b>c>d' && P(o4, o4, 'a', 99) === 'b>c>d>a' && P(o4, o4, 'a', NaN) === 'a>b>c>d' && P(o4, o4, 'zzz', 1) === 'a>b>c>d' && P(o4, o4, 'c', '0') === 'c>a>b>d',
    'SP57-a3: out-of-range targets clamp to the first / last slot; NaN and an unknown id change nothing; a numeric string is read as a number (a finger past the end of the list never throws and never drops a section)');
  // The hidden-section rule: a section with no content this week keeps its OWN slot.
  const oh = ['a', 'b', 'h', 'c', 'd'];
  const vh = ['a', 'b', 'c', 'd'];
  assert(P(oh, vh, 'a', 3) === 'b>c>h>d>a', 'SP57-a4: THE HIDDEN RULE — with a hidden section (h, the empty tiebreaker) between b and c, dragging a to the last visible slot refills the VISIBLE slots in order and h stays at index 2');
  assert(['a', 'b', 'c', 'd'].every((id) => reorderedSectionsTo(oh, vh, id, 2).indexOf('h') === 2), 'SP57-a5: …h keeps index 2 whichever visible section is dropped wherever');
  // Property: always a permutation of the input; hidden ids keep their slots; the dropped id is at the requested visible index.
  let seed = 2026;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  let propOk = true, propWhy = '';
  for (let n = 0; n < 400; n++) {
    const size = 3 + Math.floor(rnd() * 5);
    const ids = Array.from({ length: size }, (_, i) => 'id' + i).sort(() => rnd() - 0.5);
    const hidden = new Set(ids.filter(() => rnd() < 0.3));
    const vis = ids.filter((x) => !hidden.has(x));
    if (vis.length < 2) continue;
    const id = vis[Math.floor(rnd() * vis.length)];
    const to = Math.floor(rnd() * vis.length);
    const out = reorderedSectionsTo(ids, vis, id, to);
    const outVis = out.filter((x) => !hidden.has(x));
    const perm = out.length === ids.length && [...out].sort().join() === [...ids].sort().join();
    const hiddenStay = ids.every((x, i) => !hidden.has(x) || out[i] === x);
    const placed = outVis[to] === id;
    const others = outVis.filter((x) => x !== id).join() === vis.filter((x) => x !== id).join();
    if (!(perm && hiddenStay && placed && others)) { propOk = false; propWhy = JSON.stringify({ ids, hidden: [...hidden], id, to, out }); break; }
  }
  assert(propOk, `SP57-a6: PROPERTY over 400 random layouts with hidden sections: the result is a permutation, hidden sections never move, the dropped section is at the requested visible index and the other visible sections keep their relative order${propWhy ? ' — FAILED ' + propWhy : ''}`);
  // One rule, two doors: dropping one step away equals the ▲/▼ move.
  let agree = true;
  for (const [o, v] of [[o4, o4], [oh, vh], [['a', 'h', 'b', 'c'], ['a', 'b', 'c']]]) {
    v.forEach((id, i) => {
      if (i > 0 && reorderedSectionsTo(o, v, id, i - 1).join() !== reorderedSections(o, v, id, 'up').join()) agree = false;
      if (i < v.length - 1 && reorderedSectionsTo(o, v, id, i + 1).join() !== reorderedSections(o, v, id, 'down').join()) agree = false;
    });
  }
  assert(agree, 'SP57-a7: a drop one slot away produces EXACTLY what the hidden ▲/▼ buttons produce — the drag and the assistive path can never disagree about where a section goes');
  const input = Object.freeze(['a', 'b', 'c']);
  assert((() => { try { reorderedSectionsTo(input, Object.freeze(['a', 'b', 'c']), 'a', 2); return true; } catch { return false; } })(), 'SP57-a8: the inputs are never mutated (frozen arrays do not throw)');
}

console.log('\n[SP57-b] composeSections() — the hidden path obeys canCustomizeLayout() and "two or more visible sections", in every state…');
{
  const { _composeSectionsForTest: compose } = app;
  setSession('p1', false, true);
  const two = compose('dashboard', { 'dash-picks': '<p>x</p>', 'dash-alma': '<p>y</p>', 'dash-summary': '', 'dash-tiebreaker': '  ' });
  assert(two.visible.join() === 'dash-picks,dash-alma' && (two.html.match(/section-move-btn/g) || []).length === 5 && has(two.html, 'Reset Dashboard layout to default'),
    'SP57-b1: two visible sections → both get the pair (4 buttons) and the page gets its one Reset twin; empty parts are not in the DOM (5 .section-move-btn: 4 moves + the twin)');
  assert(has(two.html, 'aria-label="Move All Picks by Game up" disabled') && has(two.html, 'aria-label="Move Alma Mater Watch down" disabled') && !has(two.html, 'aria-label="Move All Picks by Game down" disabled'),
    'SP57-b2: …the first section\'s Up and the last\'s Down are disabled; nothing else is');
  const one = compose('dashboard', { 'dash-picks': '<p>x</p>', 'dash-alma': '', 'dash-summary': '', 'dash-tiebreaker': '' });
  assert(one.visible.join() === 'dash-picks' && !has(one.html, 'section-move-bar') && !has(one.html, 'layout-reset-btn') && has(one.html, 'data-section-id="dash-picks"'),
    'SP57-b3: FEWER THAN TWO visible sections → no Move buttons and no Reset twin (nothing to rearrange); the section itself still renders');
  const none = compose('standings', {});
  assert(none.html === '' && none.visible.length === 0, 'SP57-b4: no sections at all → nothing');
  setSession(null, false, false);
  const anon = compose('dashboard', { 'dash-picks': '<p>x</p>', 'dash-alma': '<p>y</p>' });
  assert(!has(anon.html, 'section-move-bar') && !has(anon.html, 'layout-reset-btn') && has(anon.html, 'data-section-id="dash-alma"'), 'SP57-b5: SIGNED OUT → no hidden path at all (DI-179g), the sections render in default order');
  setSession('p1', false, true);
  const xss = compose('dashboard', { 'dash-picks': '<p>x</p>', 'dash-alma': '<p>y</p>' });
  assert(!/<script/i.test(xss.html) && /aria-label="Move [^"<>]+ (up|down)"/.test(xss.html), 'SP57-b6: every label goes through escHtml (a static label today, the same sink as every other string); no markup in an attribute');
}

console.log('\n[SP57-c] the ten title rows, the plain headings, and the retired button — in the emitted markup and the source…');
{
  setSession('p1', false, true);
  clearSectionOrder('dashboard'); clearSectionOrder('standings');
  for (const [label, html] of [['Dashboard', renderDash({ playerId: 'p1', verified: true })], ['Standings', renderStand({ playerId: 'p1', verified: true })]]) {
    const chunks = html.split('<section class="layout-section"').slice(1).map((c) => c.split('</section>')[0]);
    assert(chunks.length >= 4 && chunks.every((c) => (c.match(/data-section-header/g) || []).length === 1),
      `SP57-c1 (${label}): EVERY .layout-section carries EXACTLY ONE data-section-header (${chunks.length} sections, counts ${chunks.map((c) => (c.match(/data-section-header/g) || []).length).join(',')}) — the engine's one handle`);
  }
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const markers = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && /data-section-header/.test(l));
  assert(markers.length === 10, `SP57-c2: exactly TEN data-section-header attributes are written in app.js — one per registered section (found ${markers.length})`);
  assert(markers.some((l) => /id="obligations-section" data-section-header/.test(l)), 'SP57-c3: the #obligations-section deep-link target still sits on the Weekly History title row (the id travels with the element)');
  const d = renderDash({ playerId: 'p1', verified: true });
  const s = renderStand({ playerId: 'p1', verified: true });
  assert(has(d, '<div class="section-header"><h2>Dashboard</h2></div>') && has(s, '<div class="section-header"><h2>Standings</h2><div class="subtitle">Season ') && !has(d, 'section-header-layout') && !has(s, 'section-header-layout'),
    'SP57-c4: BOTH page headings are the plain .section-header again (the Rules page\'s own) — not the flex row that carried the button');
  // AT16, source: the retired names are gone from every shipped file, with a canary proving the scan can see one.
  const RETIRED = /layoutEditButtonHTML|layoutEditStripHTML|layout-edit-btn|layout-edit-strip|layout-edit-hint|layout-live-region|Edit layout|⇅/;
  assert(RETIRED.test('const x = layoutEditButtonHTML(\'dashboard\');') && RETIRED.test('<button class="layout-edit-btn">⇅ Edit layout</button>'), 'SP57-c6: canary — the retired-name scan finds each of them when one is present (the scan is not vacuous)');
  // v0.29.0 release cut (2026-10-02): the What's New entry tells players "It replaces Edit layout." (SP-57 Q5 copy). The release-notes
  // block (WHATS_NEW_RELEASES plus its doc comment directly above) is history written for players, so it alone is exempt; it must be found
  // and bounded, and every other line of app.js is still scanned.
  const srcLines = src.split('\n');
  const relStart = srcLines.findIndex((l) => /^const WHATS_NEW_RELEASES = \[$/.test(l));
  let relEnd = relStart; while (relEnd >= 0 && relEnd < srcLines.length && !/^\];/.test(srcLines[relEnd])) relEnd++;
  let docStart = relStart; while (docStart > 0 && /^\s*\/\//.test(srcLines[docStart - 1])) docStart--;
  assert(relStart > 0 && relEnd > relStart && relEnd < srcLines.length && relEnd - relStart < 600 && docStart <= relStart,
    `SP57-c7a: fixture — the release-notes block (the one place the retired name may appear, as history) is found and bounded (lines ${docStart + 1}-${relEnd + 1})`);
  const appHits = srcLines.map((l, i) => [i + 1, l]).filter(([n, l]) => !(n - 1 >= docStart && n - 1 <= relEnd) && RETIRED.test(l)).map(([n]) => n);
  assert(appHits.length === 0, `SP57-c7: AT16 — js/app.js contains NONE of layoutEditButtonHTML / layoutEditStripHTML / .layout-edit-btn / .layout-edit-strip / .layout-live-region / "Edit layout" / ⇅, not even in a comment (hit lines: ${appHits.join(',') || 'none'})`);
  const idx = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert(!RETIRED.test(idx), 'SP57-c8: …nor index.html');
  assert(!/[▲▼]/.test((src.match(/function (composeSections|bindLayoutEditHandlers|syncLayoutEditBar)\([\s\S]*?\n\}/g) || []).join('\n')), 'SP57-c9: the ▲ / ▼ glyphs left the layout chrome (the hidden buttons carry text)');
}

console.log('\n[SP57-d] the lifecycle\'s source pins: where the mode is cleared, mounted, guarded and derived…');
{
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const nav = (src.match(/function navigateTo\(tab\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(/if \(tab !== _priorTab && state\.layoutEditing\) \{[\s\S]{0,260}endLayoutEditing\(\);/.test(nav) && /cancelSectionDrag\('tab-change'\)/.test(nav),
    'SP57-d1: navigateTo() ends the mode ONLY on a real tab change (tab !== _priorTab) — a same-tab Realtime repaint must not — and cancels a live lift first');
  assert(/\[tab\]\?\.\(\);\n  \}\n  \/\/ SP-57[\s\S]{0,260}\n  syncLayoutEditBar\(\);/.test(nav), 'SP57-d2: …and syncLayoutEditBar() runs right after the page dispatch, so the bar follows whichever page is showing (and a repaint into an empty state clears the mode)');
  assert(/export function renderLeaderboard\(\) \{\n[\s\S]{0,700}?if \(deferRenderWhileWeekSwiping\('leaderboard', renderLeaderboard\)\) return;\n  const c=document\.getElementById\('page-leaderboard'\)/.test(src),
    'SP57-d3: renderLeaderboard()\'s FIRST statement is the repaint deferral (C11) — the Standings half of "never by accident"');
  assert(/renderMaintenanceBannerIfNeeded\('leaderboard'\);\n  syncLayoutEditBar\(\);/.test(src) && /renderMaintenanceBannerIfNeeded\('dashboard'\);[\s\S]{0,260}syncLayoutEditBar\(\);\n\}\n\nfunction renderDashboardInner/.test(src),
    'SP57-d4: both renderers end with syncLayoutEditBar() (the wrapper\'s tail covers renderDashboardInner()\'s early-return empty states)');
  const sync = (src.match(/function syncLayoutEditBar\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(/function _layoutBarTopCSS\(\) \{\n  return `max\(\$\{_layoutBarTopPx\(\)\}px, env\(safe-area-inset-top, 0px\)\)`;\n\}/.test(src) && /bar\.style\.top = _layoutBarTopCSS\(\);/.test(sync) && /if \(bar\) bar\.style\.top = _layoutBarTopCSS\(\);/.test(src),
    'SP57-d5b: the bar\'s top is max(the measured header bottom, env(safe-area-inset-top)) — at the mount AND on every scroll re-measure — so once the header has scrolled away the bar sits UNDER the status-bar band, not behind it');
  assert(/sections < 2/.test(sync) && /host\.classList\.remove\('layout-editing'\)/.test(sync) && /state\.layoutEditing = null/.test(sync) && /canCustomizeLayout\(\)/.test(sync) && /document\.body\.appendChild\(bar\)/.test(sync),
    'SP57-d5: syncLayoutEditBar() mounts on <body> iff the mode is set, the page is showing, it holds two or more sections and the viewer may customise; fewer than two clears the mode (no ghost mode)');
  assert(/function _layoutBarTopPx\(\)[\s\S]*?Math\.max\(0, Math\.round\(bottom\)\)/.test(src) && /addEventListener\('scroll', _layoutBarTrack, \{ passive: true \}\)/.test(src) && /_trackLayoutBar\(true\);/.test(sync) && /_trackLayoutBar\(false\);/.test(src.match(/function unmountLayoutEditBar\(\) \{[\s\S]*?\n\}\n/)[0]),
    'SP57-d6: the bar\'s top is the MEASURED header bottom clamped at 0 and re-measured on every (passive) scroll — the header is position:relative here, not sticky — and the tracker is switched ON by the mount and OFF by the unmount (mutation M14: a mount that never starts it)');
  const bind = (src.match(/function bindLayoutEditHandlers\([\s\S]*?\n\}\n/) || [''])[0];
  assert(/setEditing: \(pk\) => \{ state\.layoutEditing = pk; syncLayoutEditBar\(\); \}/.test(bind) && !/setEditing:[^\n]*rerender/.test(bind),
    'SP57-d7: the engine\'s setEditing() sets the state and mounts the bar and NEVER repaints (a repaint at the lift would detach the node under the finger)');
  assert(/onDone: \(moved\) => \{\n\s+state\.layoutEditing = null;\n\s+unmountLayoutEditBar\(\);\n\s+rerender\(\);[\s\S]{0,160}if \(moved\) layoutSavedToast\(\);/.test(bind),
    'SP57-d8: Done = clear the state, unmount the bar, ONE repaint, then the save toast only if something moved');
  const toast = (src.match(/function layoutSavedToast\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(/Layout saved to your account\./.test(toast) && /Layout saved on this device only\. Sync is off\./.test(toast) && /isBackendConfigured\(\) && banner && banner\.style\.display !== 'none'/.test(toast),
    'SP57-d9: the save toast is HONEST (C10): "Layout saved to your account." normally, "Layout saved on this device only. Sync is off." under the same predicate submitPicks() uses for the red banner');
  const code = [toast, bind, sync, (src.match(/function composeSections\([\s\S]*?\n\}\n/) || [''])[0], (src.match(/function resetLayoutPage\([\s\S]*?\n\}\n/) || [''])[0]]
    .join('\n').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  const lits = [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]).filter((t) => /\s/.test(t));
  assert(lits.length >= 6 && !lits.some((t) => /\border/i.test(t)), `SP57-d10: no user-facing string literal in the layout functions contains the word "order" (UN-77 / loadtest [8d]) — ${lits.length} literals checked`);
  const lbl = src.match(/^\s*function resyncPlayerPreferences[\s\S]*?\n\}/m);
  assert(!!lbl && /state\.layoutFocus = null/.test(lbl[0]), 'SP57-d11: resyncPlayerPreferences() drops the one-shot focus target with the announcement');
}

console.log('\n[SP57-e] the stylesheet\'s contract: the z-index map, the lock, the reveal, zero layout shift, tokens, motion and Breathing Room…');
{
  const css = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
  const rule = (sel) => { const re = new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'); const m = re.exec(css); return m ? m[2] : null; };
  const num = (body, prop) => { const m = new RegExp('(?:^|[;\\s])' + prop + ':\\s*(-?\\d+)').exec(body || ''); return m ? Number(m[1]) : null; };
  // z-index map
  const zBar = num(rule('#layout-edit-bar'), 'z-index');
  const zHdr = num(rule('.app-header'), 'z-index');
  const zModal = num(rule('.modal-overlay'), 'z-index');
  const zCC = num(rule('#control-center'), 'z-index');
  assert(zBar === 99 && zHdr === 100 && zModal === 200 && zCC === 501 && zBar < zHdr && zHdr < zModal && zModal < zCC,
    `SP57-e1: the z-index map — bar ${zBar} < app header ${zHdr} < modals ${zModal} < control center ${zCC}: under the header and under every overlay, never above one`);
  const bar = rule('#layout-edit-bar') || '';
  assert(/position:fixed/.test(bar) && num(bar, 'height') === 52 && /var\(--bg-card\)/.test(bar) && /var\(--shadow-card\)/.test(bar), 'SP57-e2: #layout-edit-bar is position:fixed, 52 pt tall, on the card surface token with the card shadow token');
  assert(/top:env\(safe-area-inset-top,0px\)/.test(bar), 'SP57-e2b: the bar\'s own `top` is the TOP SAFE-AREA INSET (the fallback before the first measure) — never 0, which on the Munera shell and an installed PWA is behind the clock and the Dynamic Island');
  // the lock, touch only
  const lockBlock = (css.match(/@media \(hover:none\) and \(pointer:coarse\)\{\s*html:has\(\.layout-section\[data-lifted\]\)\{overflow:hidden\}[\s\S]*?\n\}/) || [''])[0];
  assert(lockBlock.length > 0 && /overscroll-behavior:none/.test(lockBlock), 'SP57-e3: the page lock (overflow:hidden + overscroll-behavior:none while a section is lifted) exists ONLY inside @media (hover:none) and (pointer:coarse) — a mouse drag does not need it, and hiding the root scrollbar on desktop shifts the content');
  assert(!/(^|\n)html:has\(\.layout-section\[data-lifted\]\)\s*\{/.test(css.replace(lockBlock, '')), 'SP57-e3b: …and there is no unconditional copy of it anywhere else');
  // the reveal
  const reveal = (css.match(/\.section-move-bar\.sr-only:focus-within\s*\{([^}]*)\}/) || [])[1] || '';
  const props = ['position', 'width', 'height', 'margin', 'overflow', 'clip', 'white-space', 'display'];
  assert(props.every((p) => new RegExp(p + ':[^;]*!important').test(reveal)), `SP57-e4: the focus reveal restates EVERY property .sr-only forces, each with !important (missing: ${props.filter((p) => !new RegExp(p + ':[^;]*!important').test(reveal)).join(',') || 'none'}) — otherwise the utility's !important would win and a keyboard user would tab to an invisible button`);
  const hiddenRules = [...css.matchAll(/(^|\n)([^{}\n]*\.section-move-(?:bar|btn)[^{]*)\{([^}]*)\}/g)].filter(([, , , b]) => /display:\s*none|visibility:\s*hidden/.test(b)).map(([, , sel]) => sel.trim());
  assert(hiddenRules.length === 0, `SP57-e5: NO rule hides the hidden path with display:none or visibility:hidden — it is .sr-only, in the accessibility tree (offenders: ${hiddenRules.join(' | ') || 'none'})`);
  const btn = rule('.section-move-btn') || '';
  assert(num(btn, 'min-width') >= 44 && num(btn, 'min-height') >= 44 && /:disabled\{opacity:\.5/.test(css.replace(/\s+/g, '')) , 'SP57-e6: the revealed buttons keep the 44 pt floor and a clearly reduced disabled state');
  // zero layout shift
  const outline = rule('.layout-editing .layout-section') || '';
  assert(/outline:2px dashed var\(--maroon-light\)/.test(outline) && !/margin|padding|border:|height|display/.test(outline), 'SP57-e7: the edit-mode outline adds NO margin, padding, border or height (the old 12 → 18 px margin bump is gone): entering the mode shifts nothing under the finger');
  assert(/visibility:hidden/.test(rule('.layout-editing .layout-toggle') || '') && !/display:\s*none/.test(rule('.layout-editing .layout-toggle') || ''), 'SP57-e8: the density toggle is hidden with visibility:hidden — it keeps its space, so the title row does not change height when the mode begins');
  // tokens
  // RE-DERIVED by themes DI A1.11 (coordinator, 2026-10-01; v0.29.0 batch-5b integration). OLD: "--shadow-lift is declared in :root and in BOTH dark blocks" —
  // exactly 3 declarations, the one Dark block release had under its two triggers. SP-52 splits Dark into Block A, Paper Dark's page block and Graphite Dark,
  // so NEW: EVERY Dark block that declares --shadow-btn also declares --shadow-lift with SP-57's byte-identical dark value; the light default is unchanged;
  // and Paper's paper-surface scope never declares it (themetest [T10] forbids any shadow there).
  const SP57_LIFT_LIGHT = '0 14px 32px rgba(20,17,14,.28)', SP57_LIFT_DARK = '0 14px 32px rgba(0,0,0,.5)';
  const rootTok = /(^|\n)\s*--shadow-lift:([^;]*);/.exec(css);
  const darkToks = [...css.matchAll(/\n\s*--shadow-lift:([^;]*);/g)].map((m) => m[1].trim());
  const liftBlocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.replace(/\s+/g, ' ').trim(), body }));
  const declOf = (body, tok) => { const m = new RegExp('(?:^|[;{\\s])' + tok + ':([^;]*);').exec(body); return m ? m[1].trim() : null; };
  const isDarkBlock = (sel) => sel.split(',').every((p) => /^body\./.test(p.trim()) && /\[data-color-scheme="dark"\]|:not\(\[data-color-scheme="light"\]\)/.test(p));
  const darkBtn = liftBlocks.filter((b) => isDarkBlock(b.sel) && declOf(b.body, '--shadow-btn') !== null);
  const coversBoth = (re) => ['[data-color-scheme="dark"]', ':not([data-color-scheme="light"])'].every((trig) => darkBtn.some((b) => re.test(b.sel) && b.sel.includes(trig)));
  assert(darkBtn.length >= 6 && coversBoth(/theme-neutral/) && coversBoth(/theme-paper/) && coversBoth(/theme-graphite/),
    `SP57-e9 fixture: the scan finds the Dark blocks that declare --shadow-btn — Block A, Paper Dark's page block and Graphite Dark, under BOTH triggers (${darkBtn.length} found)`);
  const missingLift = darkBtn.filter((b) => declOf(b.body, '--shadow-lift') !== SP57_LIFT_DARK).map((b) => b.sel.slice(0, 70));
  assert(missingLift.length === 0, `SP57-e9: EVERY Dark block that declares --shadow-btn also declares --shadow-lift with SP-57's byte-identical dark value ${SP57_LIFT_DARK} (A1.11)${missingLift.length ? ' — MISSING or DIFFERENT in: ' + missingLift.join(' | ') : ''}`);
  assert(!!rootTok && rootTok[2].trim() === SP57_LIFT_LIGHT && darkToks.slice(1).every((t) => t === SP57_LIFT_DARK) && darkToks.length === 1 + darkBtn.length,
    `SP57-e9: the light default on :root is unchanged (${rootTok ? rootTok[2].trim() : 'missing'}) and every other declaration is the one dark value, each beside a Dark --shadow-btn (${darkToks.length} declarations, ${darkBtn.length} Dark --shadow-btn blocks)`);
  const scopeLift = liftBlocks.filter((b) => /^:where\(body\.theme-paper/.test(b.sel) && declOf(b.body, '--shadow-lift') !== null).map((b) => b.sel.slice(0, 70));
  assert(scopeLift.length === 0, `SP57-e9: Paper's paper-surface scope never declares --shadow-lift (A1.11)${scopeLift.length ? ' — found in: ' + scopeLift.join(' | ') : ''}`);
  assert(!!rootTok && !/var\(/.test(darkToks.join('')) && !/#[0-9a-fA-F]{3,8}\b/.test(darkToks.join('')), 'SP57-e9b: …and it is a LITERAL shadow, no var() and no hex: a :root alias that var()s a token a school theme re-declares on <body> goes stale (DI-448 R1 / RG-273, schoolthemetest [3a])');
  assert(/\.layout-section\[data-lifted\],\.layout-section\[data-settling\]\{[^}]*box-shadow:var\(--shadow-lift\),0 0 0 1px var\(--border-strong\)/.test(css), 'SP57-e9c: the lifted and settling section composes the hairline ring in the theme\'s own --border-strong AT THE USE SITE (where it resolves on the element, per theme), after the token');
  // A1.4: the grip takes NO space, so it can never change a title row's line count at any width (reviewer B1, 2026-10-01).
  const gripRule = rule('.layout-grip') || '';
  assert(/position:absolute/.test(gripRule) && /right:0/.test(gripRule) && /width:44px/.test(gripRule) && !/flex:\s*0 0 44px|margin-left:auto|align-self/.test(gripRule) && /\n\[data-section-header\]\{position:relative;/.test(css),
    'SP57-e10a: the grip is OUT OF FLOW (A1.4) — .layout-grip is position:absolute at the row\'s right end with no flex-item sizing, and [data-section-header] is its positioning context: entering edit mode cannot change a title row\'s line count');
  assert(/\.tiebreaker-label\[data-section-header\]\{[^}]*padding-right:44px/.test(css), 'SP57-e10b: the tiebreaker label (the one title that is the player\'s own words) keeps the grip\'s 44 px slot clear ALWAYS, at rest too, so a long question never runs under the grip and its wrap is identical in both states');
  assert(/\.layout-editing \.layout-toggle-btn\{transition:none\}/.test(css), 'SP57-e10c: the density toggle\'s buttons hide WITH their toggle (transition:none) — their own transition:all otherwise holds an inherited visibility:hidden at visible for 160 ms, under the grip');
  assert(/\.admin-section-title \.layout-grip svg/.test(css) && /(^|\n)\.admin-section-title\[data-section-header\]\{display:flex;align-items:center;gap:6px\}/.test(css), 'SP57-e10: the grip\'s 22 px rule is scoped under .admin-section-title (specificity beats the 14 px icon rule) and the Standings title rows are flex rows with a 6 px icon gap');
  // motion: only the Principles' tokens
  const block = css.slice(css.indexOf('SP-57 (2026-10-01) — long-press section drag'), css.indexOf('FEAT-3 / DI-200f'));
  const literalMs = [...block.matchAll(/transition:[^;}]*?(\d+(?:\.\d+)?m?s)\b/g)].filter(([m]) => !/var\(--motion-/.test(m) && !/none/.test(m)).map(([m]) => m);
  assert(literalMs.length === 0, `SP57-e11: every transition and animation in the SP-57 block names a --motion-* token (150 / 260 ms), never a literal duration (found: ${literalMs.join(' | ') || 'none'})`);
  assert(/@media \(prefers-reduced-motion:reduce\)\{[^}]*#layout-edit-bar\{animation:none\}/.test(block.replace(/\s+/g, ' ').replace(/ \{/g, '{').replace(/\{ /g, '{')) || /prefers-reduced-motion:reduce\)\s*\{\s*#layout-edit-bar\s*\{\s*animation:none/.test(block),
    'SP57-e12: Reduce Motion drops the bar\'s fade and every title-row / lift transition');
  // Breathing Room (Drew, 2026-09-30)
  const inner = rule('.layout-edit-bar-inner') || '';
  const actions = rule('.layout-edit-bar-actions') || '';
  const abtn = rule('.layout-edit-bar-actions .btn') || '';
  assert(/gap:16px/.test(inner) && /gap:8px/.test(actions) && /max\(var\(--page-pad\)/.test(inner), 'SP57-e13: Breathing Room — 16 pt between the text and the buttons, 8 pt between the two buttons, 16 pt from the screen edges (and the safe-area insets): all container padding / gap');
  assert(!/margin/.test(abtn) && !/margin/.test(actions), 'SP57-e14: …space comes from the container gap, never a margin on one button (a hidden button cannot leave the group off-centre)');
  assert(num(abtn, 'min-height') === 36 && /inset:-4px/.test(rule('.layout-edit-bar-actions .btn::after') || '') && (52 - 36) / 2 >= 8,
    'SP57-e15: the bar\'s buttons are 36 pt faces — 8 pt from the bar\'s divider and top edge inside the 52 pt bar — with a 4 pt pseudo-element halo that keeps the TAP target at 44 pt (36 + 4 + 4)');
  assert(/\.card-header\[data-section-header\]\{margin-top:-4px;margin-bottom:8px\}/.test(css) && /\.tiebreaker-label\[data-section-header\]\{margin-top:-8px\}/.test(css),
    'SP57-e16: the height-budget margins (DI-475 Q4): card headers 8 pt below and pulled 4 pt, the tiebreaker label 8 pt, into their cards\' 16 pt padding — in 4 pt steps, never below 8 pt under, the 44 pt row itself untouched');
  // contrastscan's rule: a pale background names its own colour
  const pressing = rule('[data-section-header].section-pressing') || '';
  assert(/background:var\(--maroon-tint\)/.test(pressing) && /(^|;)color:var\(--maroon-text\)/.test(pressing), 'SP57-e17: the pending tint is the brand tint and names its own text colour (contrastscan: any pale background rule must)');
}

// ═════════════════════════════════════════════════════════════════════════════
// SP-56 (2026-09-30) — STANDINGS FIT. Season Summary + Weekly History fit one
// iPhone screen wide. DI-471…DI-474 + Amendment 1 (Drew: "undo com only").
// Every [SFn] block below drives the REAL renderLeaderboard() (or the real
// exported obligation function) and reads the EMITTED HTML — never a source
// window (the UN-124 lesson this file's own header records).
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// SF fixture + shared helpers ([SF1]–[SF7], [SF9]–[SF12]).
// Everything the earlier sections created is RETIRED first (weeks → demo, players
// → inactive) so the rows asserted below are the only ones on Standings.
// ═════════════════════════════════════════════════════════════════════════════
const dm = await import('./js/data-model.js');
const PO = await import('./js/pilot-only.js');
const h2025 = await import('./js/history-2025.js');
const sfAppSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
const sfCssSrc = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');

storage.getWeeks().forEach(w => saveWeek({ ...w, dataSourceMode: 'demo' }));
storage.getPlayers().forEach(p => storage.savePlayer({ ...p, active: false }));

const SF_V = {                       // [playerId, isAdmin, verified]
  admin:     ['sf_e', true,  true],  // the commissioner (isAdmin wins the role)
  payerB:    ['sf_b', false, true],  // pays Week 41 (unpaid); is owed Week 51 (unpaid)
  creditorA: ['sf_a', false, true],  // is owed Week 41 (unpaid) and Week 43 (paid); pays Week 51
  payerD:    ['sf_d', false, true],  // pays Weeks 42 and 52 (pending)
  creditorC: ['sf_c', false, true],  // is owed Weeks 42 and 52 (pending)
  bystander: ['sf_e', false, true],  // involved in nothing
  anon:      [null,    false, false],
};
const sfRender = ([pid, adm, ver]) => {
  setSession(pid, adm, ver);
  els.get('page-leaderboard')._html = '';
  app.renderLeaderboard();
  return els.get('page-leaderboard')._html;
};
const sfSection = (html, id) => (html.split(`data-section-id="${id}"`)[1] || '').split('data-section-id=')[0];
const sfSeason = html => sfSection(html, 'stand-season');
const sfHist = html => sfSection(html, 'stand-history');
const sfTable = (sec, cls) => (new RegExp(`<table class="stand-table ${cls}"[^>]*>([\\s\\S]*?)</table>`).exec(sec) || [, ''])[1];
const sfGroups = html => sfTable(sfHist(html), 'stand-table-history').split('<tbody class="stand-wk-group">').slice(1).map(g => g.split('</tbody>')[0]);
const sfWkName = g => (/class="stand-wk-name" id="stand-wk-\d+">([^<]*)</.exec(g) || [, ''])[1];
const sfGroup = (html, name) => sfGroups(html).find(g => sfWkName(g) === name);
const sfBtns = g => [...(g || '').matchAll(/<button\b[^>]*data-ob-action="(\w+)"/g)].map(m => m[1]);

// The Standings sections as the SIGNED-OUT visitor sees them with NOTHING in the league yet.
const sfEmptyHtml = sfRender(SF_V.anon);

[['sf_a', 'Ann'], ['sf_b', 'Bob'], ['sf_c', 'Cat'], ['sf_d', 'Dan'], ['sf_e', 'Eve']]
  .forEach(([id, n]) => addPlayer({ playerId: id, displayName: n, active: true, preferences: {} }));
const sfWeek = (n, over = {}) => saveWeek(mkWeek({ weekId: 'sfw' + n, weekNumber: n, name: 'Week ' + n, status: 'final', blurb: '',
  startDate: '2026-09-24', endDate: '2026-09-26', ...over }));
const SFR = (weekId, pid, name, cp, ip, cc, ic, flags = {}) => ({ weekId, playerId: pid, displayName: name, rank: 2,
  correctPicks: cp, incorrectPicks: ip, correctCount: cc, incorrectCount: ic, noDecisions: 0, isWinner: false, isLoser: false, wonByTiebreaker: false, ...flags });
const SFO = (id, weekId, payer, recipient, status, extra = {}) => ({ obligationId: id, type: 'weekly', weekId, payerPlayerId: payer,
  recipientPlayerId: recipient, amountOrPrize: 'a drink', status, createdAt: '2026-09-20T00:00:00Z', paidAt: status === 'paid' ? '2026-09-21T00:00:00Z' : null, ...extra });

sfWeek(41);                                                         // unpaid; Ann beat Bob
sfWeek(42, { startDate: '2026-09-30', endDate: '2026-10-02' });     // pending; Cat beat Dan ON THE TIEBREAKER; spans two months
sfWeek(43, { startDate: '2026-10-08', endDate: '2026-10-10' });     // paid; Ann beat Cat
sfWeek(44, { startDate: '2026-10-15', endDate: '2026-10-17' });     // waived; Bob beat Dan
sfWeek(45, { startDate: '2026-10-22', endDate: '2026-10-24' });     // FINAL, no result rows, no obligation (hidden/legacy)
sfWeek(46, { status: 'open',   startDate: '2026-10-29', endDate: '2026-11-01' });
sfWeek(47, { status: 'locked', startDate: '2026-11-05', endDate: '2026-11-07' });
sfWeek(48, { status: 'live',   startDate: '2026-11-12', endDate: '2026-11-14' });
sfWeek(49, { groupId: 'sfw49', startDate: '2026-11-19', endDate: '2026-11-21' });                  // part 1 of a group: FINAL…
sfWeek(50, { groupId: 'sfw49', status: 'locked', startDate: '2026-11-26', endDate: '2026-11-28' }); // …part 2 NOT final → the group is in progress
sfWeek(51, { startDate: '2026-12-03', endDate: '2026-12-05' });     // FINAL, an obligation but NO result rows (UN-126 stale singleton)
sfWeek(52, { status: 'locked', startDate: '2026-12-10', endDate: '2026-12-12' }); // NOT final, yet a money record exists
sfWeek(53, { startDate: '2026-12-17', endDate: '2026-12-19' });     // two ACTIVE obligations → conflicted (UN-126/UN-135)
sfWeek(54, { startDate: '2026-12-24', endDate: '2026-12-26' });     // results, NO obligation

const sfSave = (weekId, rows) => storage.saveAllWeeklyResults(weekId, rows);
sfSave('sfw41', [SFR('sfw41', 'sf_a', 'Ann', 4, 1, 3, 2, { isWinner: true, rank: 1 }), SFR('sfw41', 'sf_b', 'Bob', 1, 4, 1, 4, { isLoser: true, rank: 4 }), SFR('sfw41', 'sf_c', 'Cat', 2, 3, 2, 3), SFR('sfw41', 'sf_d', 'Dan', 2, 3, 2, 3)]);
sfSave('sfw42', [SFR('sfw42', 'sf_b', 'Bob', 3, 2, 3, 2), SFR('sfw42', 'sf_c', 'Cat', 5, 0, 5, 0, { isWinner: true, rank: 1, wonByTiebreaker: true }), SFR('sfw42', 'sf_d', 'Dan', 0, 5, 0, 5, { isLoser: true, rank: 3 })]);
sfSave('sfw43', [SFR('sfw43', 'sf_a', 'Ann', 2, 1, 1, 2, { isWinner: true, rank: 1 }), SFR('sfw43', 'sf_b', 'Bob', 1, 2, 1, 2), SFR('sfw43', 'sf_c', 'Cat', 0, 3, 0, 3, { isLoser: true, rank: 3 })]);
sfSave('sfw44', [SFR('sfw44', 'sf_b', 'Bob', 4, 0, 4, 0, { isWinner: true, rank: 1 }), SFR('sfw44', 'sf_c', 'Cat', 2, 2, 2, 2), SFR('sfw44', 'sf_d', 'Dan', 0, 4, 0, 4, { isLoser: true, rank: 3 })]);
// Part 1 of the group carries PER-PART isWinner/isLoser flags (Bob/Dan) — the group row must never show them while part 2 is not final.
sfSave('sfw49', [SFR('sfw49', 'sf_b', 'Bob', 4, 0, 4, 0, { isWinner: true, rank: 1 }), SFR('sfw49', 'sf_c', 'Cat', 2, 2, 2, 2), SFR('sfw49', 'sf_d', 'Dan', 0, 4, 0, 4, { isLoser: true, rank: 3 })]);
sfSave('sfw53', [SFR('sfw53', 'sf_b', 'Bob', 2, 3, 2, 3), SFR('sfw53', 'sf_c', 'Cat', 4, 1, 4, 1, { isWinner: true, rank: 1 }), SFR('sfw53', 'sf_d', 'Dan', 1, 4, 1, 4, { isLoser: true, rank: 3 })]);
sfSave('sfw54', [SFR('sfw54', 'sf_b', 'Bob', 3, 2, 3, 2, { isWinner: true, rank: 1 }), SFR('sfw54', 'sf_d', 'Dan', 1, 4, 1, 4, { isLoser: true, rank: 3 })]);

const SF_OB = {                      // display name -> the ONE active obligation for that week
  'Week 41': SFO('sfo41', 'sfw41', 'sf_b', 'sf_a', 'unpaid'),
  'Week 42': SFO('sfo42', 'sfw42', 'sf_d', 'sf_c', 'pending'),
  'Week 43': SFO('sfo43', 'sfw43', 'sf_c', 'sf_a', 'paid'),
  'Week 44': SFO('sfo44', 'sfw44', 'sf_d', 'sf_b', 'waived'),
  'Week 51': SFO('sfo51', 'sfw51', 'sf_a', 'sf_b', 'unpaid'),
  'Week 52': SFO('sfo52', 'sfw52', 'sf_d', 'sf_c', 'pending'),
};
Object.values(SF_OB).forEach(o => storage.saveObligation(o));
storage.saveObligation(SFO('sfo53a', 'sfw53', 'sf_d', 'sf_c', 'unpaid'));
storage.saveObligation(SFO('sfo53b', 'sfw53', 'sf_c', 'sf_d', 'unpaid'));

// Picks exist for OTHER players on the in-progress weeks, so the blind rule is a real test and not an empty one.
for (const n of [46, 47, 48]) saveGame(mkGame('sfw' + n, 'g1', `SF${n} HOME`, `SF${n} AWAY`, FUTURE));
storage.saveAllPicks([...storage.getPicks(),
  ...[46, 47, 48].flatMap(n => [
    { pickId: `sfpk${n}a`, weekId: 'sfw' + n, gameId: `sfw${n}_g1`, playerId: 'sf_a', selectedTeam: `SF${n} HOME`, submittedAt: '2026-10-01T00:00:00Z' },
    { pickId: `sfpk${n}b`, weekId: 'sfw' + n, gameId: `sfw${n}_g1`, playerId: 'sf_b', selectedTeam: `SF${n} AWAY`, submittedAt: '2026-10-01T00:00:00Z' },
  ])]);

// ── CSS block, comment-stripped, parsed into rules (base vs the >=600px media block) ─────────────────
// v0.29.0 integration (2026-10-01) — BOUNDED at the next top-level banner, not sliced to EOF (the leaguecreatetest [11] fix eea7eff; accountexittest [12], 1b9a9b6).
// SP-56's block is the last one in styles.css today, so an EOF slice was harmless only until the next thread appends its own block: SF1u ("exactly one hex rule")
// would then answer for that block's colours as if SP-56 had regressed. The block ends where the next banner comment begins, in either house style ('/* ═══' or
// '/* ── '; SP-56 opens with the latter and contains neither internally). While SP-56 is the last block, that is the end of the file. SF1-0b proves the bound
// still reaches SP-56's last rule.
const sfCssFrom = (() => {
  const i = sfCssSrc.indexOf('SP-56 STANDINGS-FIT');
  if (i < 0) return '';
  const ends = ['\n/* ═══', '\n/* ── '].map((b) => sfCssSrc.indexOf(b, i + 1)).filter((k) => k > i);
  return sfCssSrc.slice(sfCssSrc.lastIndexOf('/*', i), ends.length ? Math.min(...ends) : undefined);
})();
const sfCss = sfCssFrom.replace(/\/\*[\s\S]*?\*\//g, '');
const sfWideAt = sfCss.indexOf('@media (min-width:600px)');
const sfRules = [...sfCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2], wide: sfWideAt >= 0 && m.index > sfWideAt }));
const sfDecl = (rule, prop) => { const m = rule && new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(rule.body); return m ? m[1].trim() : null; };
const sfRule = (sel, wide = false) => sfRules.find(r => r.wide === wide && r.sel.split(',').map(s => s.trim()).includes(sel));
const sfNum = v => (v == null ? NaN : parseFloat(v));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF1] DI-474 SF1 — the structural fit proxy (node has no layout engine: CSS + emitted markup)…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const html = sfRender(SF_V.admin);
  const season = sfTable(sfSeason(html), 'stand-table-season');
  const hist = sfTable(sfHist(html), 'stand-table-history');
  assert(season.length > 0 && hist.length > 0 && sfRules.length > 20,
    `SF1-0: fixture check — both tables were extracted from the real render, and the SP-56 CSS block was located (${sfRules.length} rules)`);
  assert(sfRules.length > 30 && !!sfRule('.stand-box') && !!sfRule('.stand-table th') && !!sfRule('.stand-table-history .stand-c-st', true),
    `SF1-0b: fixture check — the bounded SP-56 block is the WHOLE block, from .stand-box through its last rule (the ≥600px Weekly History status width), so a bound cut short could never make SF1d/SF1u vacuous (${sfRules.length} rules)`);

  // Neither section sits in a sideways scroller.
  assert(/Season Summary<\/div>\s*<div class="stand-box/.test(sfSeason(html)) && /Weekly History<\/div>\s*<div class="stand-box mb-md/.test(sfHist(html)),
    'SF1a: each title is followed DIRECTLY by a .stand-box (not a .dashboard-scroll) — the sideways scroller is gone from both sections');
  assert(!/dashboard-scroll|overflow-x|min-width/.test(sfSeason(html) + sfHist(html)),
    'SF1b: neither section\'s emitted markup mentions dashboard-scroll, overflow-x or min-width');

  // The stylesheet: fixed layout, and no .stand-* rule may ever be a scroller or carry a positive min-width.
  const tbl = sfRule('.stand-table');
  assert(sfDecl(tbl, 'table-layout') === 'fixed' && sfDecl(tbl, 'width') === '100%', 'SF1c: .stand-table is table-layout:fixed at width:100% (the <colgroup> widths rule)');
  const standRules = sfRules.filter(r => /\.stand-/.test(r.sel));
  const bad = standRules.filter(r => /(^|;)\s*overflow-x\s*:\s*(auto|scroll)/.test(r.body) || /(^|;)\s*overflow\s*:\s*(auto|scroll)/.test(r.body)
    || /(^|;)\s*min-width\s*:\s*(?!0(px|rem|em)?\s*(;|$))/.test(r.body));
  assert(standRules.length > 20 && bad.length === 0,
    `SF1d: no .stand-* rule declares overflow-x:auto|scroll or a positive min-width — min-width:0 (the flex-ellipsis reset) is the only allowed value (offending: ${bad.map(r => r.sel).join(' | ') || 'none'})`);
  assert(sfDecl(sfRule('.stand-box'), 'overflow') === 'hidden',
    'SF1e: .stand-box clips (overflow:hidden) — which is exactly why the DevTools check reads scrollWidth, never the eye (DI-473 trap 4)');

  // <col> count equals <th> count, and every body row's colspans sum to the column count (the T5 class: colspan="8" on a 7-column table).
  const cols = t => (t.match(/<col\b/g) || []).length;
  const ths = t => (t.match(/<th\b/g) || []).length;
  assert(cols(season) === 5 && ths(season) === 5, `SF1f: Season Summary has 5 <col> and 5 <th> (got ${cols(season)}/${ths(season)})`);
  assert(cols(hist) === 4 && ths(hist) === 4, `SF1g: Weekly History has 4 <col> and 4 <th> (got ${cols(hist)}/${ths(hist)})`);
  const rowSums = t => [...t.slice(Math.max(0, t.indexOf('<tbody'))).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(m => [...m[1].matchAll(/<td\b([^>]*)>/g)].reduce((s, c) => s + Number((/colspan="(\d+)"/.exec(c[1]) || [, 1])[1]), 0));
  const sSums = rowSums(season), hSums = rowSums(hist);
  assert(sSums.length >= 5 && sSums.every(n => n === 5), `SF1h: EVERY Season Summary body row sums to 5 columns (rows ${sSums.length}: ${[...new Set(sSums)].join(',')})`);
  assert(hSums.length >= 15 && hSums.every(n => n === 4), `SF1i: EVERY Weekly History body row — week rows, merged in-progress rows, action rows — sums to 4 columns (rows ${hSums.length}: ${[...new Set(hSums)].join(',')})`);
  assert(/<td colspan="5" class="stand-empty">No finalized weeks yet\.<\/td>/.test(sfEmptyHtml),
    'SF1j: the empty Season row spans colspan="5" — the 5-column table (it was colspan="8" on a 7-column table, T5)');

  // The width budget, derived from the CSS itself (so the next edit to a column cannot silently starve the name).
  const W = (sel) => sfNum(sfDecl(sfRule(sel), 'width'));
  const seasonFixed = ['.stand-table-season .stand-c-rank', '.stand-table-season .stand-c-picks', '.stand-table-season .stand-c-pct', '.stand-table-season .stand-c-weeks'].map(W);
  const histFixed = ['.stand-table-history .stand-c-wk', '.stand-table-history .stand-c-st'].map(W);
  assert([...seasonFixed, ...histFixed].every(Number.isFinite), `SF1k: every fixed column width was parsed (${seasonFixed.concat(histFixed).join(', ')})`);
  const sF = seasonFixed.reduce((a, b) => a + b, 0), hF = histFixed.reduce((a, b) => a + b, 0);
  const AVAIL375 = 375 - 2 * 14 - 2, AVAIL320 = 320 - 2 * 14 - 2;   // page padding 14 each side + the box's 1px borders (DI-471)
  assert(AVAIL375 - sF >= 96, `SF1l: at 375pt the Season name column keeps >= 96px (${AVAIL375} - ${sF} fixed = ${AVAIL375 - sF})`);
  assert((AVAIL375 - hF) / 2 >= 80, `SF1m: at 375pt each Weekly History Winner/Loser column keeps >= 80px ((${AVAIL375} - ${hF}) / 2 = ${(AVAIL375 - hF) / 2})`);
  assert(AVAIL320 - sF >= 0 && AVAIL320 - hF >= 0, `SF1n: at 320pt both budgets stay non-negative (truncation by ellipsis only, never overflow): ${AVAIL320 - sF} / ${AVAIL320 - hF}`);

  // Type, tap-target and row-height floors, parsed from the CSS.
  assert(sfNum(sfDecl(sfRule('.stand-table td'), 'font-size')) >= 0.875, 'SF1o: data cells are >= .875rem (14px; today 13.6)');
  assert(sfNum(sfDecl(sfRule('.stand-table th'), 'font-size')) >= 0.72, 'SF1p: column headers are >= .72rem — today\'s size, never smaller (UN-S3)');
  assert(sfNum(sfDecl(sfRule('.stand-sub'), 'font-size')) >= 0.6875, 'SF1q: the smallest type (date caption, "by tiebreaker") is >= .6875rem (11px, Apple\'s caption-2 floor)');
  assert(sfNum(sfDecl(sfRule('.stand-act-row .btn'), 'min-height')) >= 44, 'SF1r: payment buttons carry a scoped min-height >= 44px (a global .btn-sm change would reflow every compact row in the app)');
  assert(sfNum(sfDecl(sfRule('.stand-table td'), 'height')) >= 48, 'SF1s: rows are >= 48px tall');
  assert(!/^\.btn-sm\{[^}]*min-height:4[4-9]px/m.test(sfCssSrc), 'SF1t: …and .btn-sm itself was NOT raised globally');
  // Tokens only. RE-DERIVED (SP-52 DI-448 C2, 2026-10-01): the ONE literal colour this block used to carry — the #fff on the maroon header, "the SAME
  // declaration .dashboard-table th already makes" — is a token now, because that very declaration is what the on-accent sweep retargets (white on every
  // look except Graphite Dark, whose accent is near-white). So the block holds NO hex at all, and the header label reads var(--on-accent) exactly as
  // .dashboard-table th does (the pairing is still "the same declaration", the declaration just changed value for both).
  const hexRules = sfRules.filter(r => /#[0-9a-fA-F]{3,8}\b/.test(r.body));
  const stTh = sfRule('.stand-table th');
  assert(hexRules.length === 0 && /color\s*:\s*var\(--on-accent\)/.test(stTh.body || '') && /background\s*:\s*var\(--maroon\)/.test(stTh.body || ''),
    `SF1u: no hex in the SP-56 block at all (rules with a hex: ${hexRules.map(r => r.sel).join(' | ') || 'none'}); the maroon header's label reads var(--on-accent) — every colour is a token`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF2] DI-474 SF2 — payment actions live ONLY in .stand-act-row, only for the viewer who has one, and never beyond what the state machine allows…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const mismatches = [], statusButtons = [], strays = [], rowMism = [];
  let checked = 0;
  for (const [vname, v] of Object.entries(SF_V)) {
    const html = sfRender(v);
    const sess = { isAdmin: v[1], playerId: v[0], playerVerified: v[2] };
    const tableHtml = sfTable(sfHist(html), 'stand-table-history');
    // every <button> must sit inside a .stand-act-row (strip those out, nothing may remain) and none inside a Status cell
    const withoutActRows = tableHtml.replace(/<div class="btn-row stand-act-row"[\s\S]*?<\/div>/g, '');
    if (/<button/.test(withoutActRows)) strays.push(vname);
    for (const m of tableHtml.matchAll(/<td class="stand-st">([\s\S]*?)<\/td>/g)) if (/<button/.test(m[1])) statusButtons.push(vname);
    for (const [name, ob] of Object.entries(SF_OB)) {
      const g = sfGroup(html, name);
      const role = dm.obligationRole(sess, ob);
      const allowed = ['mark', 'confirm', 'deny'].filter(a => dm.obligationNextStatus(ob.status, role, a)).sort();
      const rendered = sfBtns(g).sort();
      const waitText = ob.status === 'pending' && role === 'payer';
      const wantsRow = allowed.length > 0 || waitText;
      checked++;
      if (JSON.stringify(rendered) !== JSON.stringify(allowed)) mismatches.push(`${vname}/${name}: rendered [${rendered}] vs machine [${allowed}]`);
      const hasRow = /<tr class="stand-act">/.test(g || '');
      const firstRowHasAct = /<tr class="stand-row has-act">/.test(g || '');
      if (hasRow !== wantsRow || firstRowHasAct !== wantsRow) rowMism.push(`${vname}/${name}: actRow=${hasRow} has-act=${firstRowHasAct} wanted=${wantsRow}`);
    }
  }
  assert(checked === Object.keys(SF_V).length * Object.keys(SF_OB).length && checked >= 40, `SF2-0: fixture check — ${checked} viewer x week cells examined`);
  assert(strays.length === 0, `SF2a: every <button> in Weekly History sits inside a .stand-act-row (strays for: ${strays.join(', ') || 'none'})`);
  assert(statusButtons.length === 0, `SF2b: NO <button> in any Status cell for any viewer — today's wrapped 54px buttons are gone (found for: ${statusButtons.join(', ') || 'none'})`);
  assert(mismatches.length === 0, `SF2c: the buttons rendered are EXACTLY the actions obligationNextStatus() allows that viewer — the UI never shows a button the machine refuses, and never hides one it grants (Undo is excluded on Standings: Amendment 1) (${mismatches.join(' ; ') || 'none'})`);
  assert(rowMism.length === 0, `SF2d: an action row (and the has-act join on the week row) exists ONLY where the viewer has an action or the payer's wait text (${rowMism.join(' ; ') || 'none'})`);
  const bystander = sfRender(SF_V.bystander), anon = sfRender(SF_V.anon);
  assert(!/<button|stand-act/.test(sfTable(sfHist(bystander), 'stand-table-history')) && !/<button|stand-act/.test(sfTable(sfHist(anon), 'stand-table-history')),
    'SF2e: a bystander and a signed-out visitor get no <button> and no action row anywhere in Weekly History');
  // Amendment 1: the commissioner's PAID week is byte-identical to a bystander's.
  const adminPaid = sfGroup(sfRender(SF_V.admin), 'Week 43'), byPaid = sfGroup(bystander, 'Week 43');
  assert(!!adminPaid && adminPaid === byPaid && !/<button|stand-act/.test(adminPaid),
    'SF2f: Amendment 1 — the commissioner\'s PAID week renders byte-identically to a bystander\'s: "Paid ✓", no Undo, no action row');
  const payerWait = sfGroup(sfRender(SF_V.payerD), 'Week 42');
  assert(/<div class="btn-row stand-act-row" role="group" aria-labelledby="stand-wk-\d+"><span class="text-muted text-xs">Waiting on Cat to confirm\.<\/span><\/div>/.test(payerWait),
    'SF2g: the payer of a pending debt sees "Waiting on Cat to confirm." as text in the action group (no button), labelled by the visible week name');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF3] DI-474 SF3 — BOTH tallies survive: Picks is the WEIGHTED pair, Win % the RAW ratio, and a zero prints as 0…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const html = sfRender(SF_V.bystander);
  const seasonHtml = sfTable(sfSeason(html), 'stand-table-season');
  const rows = [...seasonHtml.slice(seasonHtml.indexOf('<tbody')).matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)].map(m => {
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, '').trim());
    return { cls: m[1], rank: cells[0], name: cells[1].replace(/[\u{1F451}\u{1F921}]/gu, '').trim(), picks: cells[2], pct: cells[3], weeks: cells[4] };
  });
  const truth = app.seasonStandingsRows();
  assert(rows.length === 5 && truth.length === 5, `SF3-0: five players, five rows (got ${rows.length} / ${truth.length})`);
  const wrong = [];
  truth.forEach((s, i) => {
    const r = rows[i];
    if (!r || r.name !== s.displayName || r.rank !== String(s.currentRank) || r.picks !== `${s.totalCorrect}–${s.totalIncorrect}` || r.pct !== `${s.winPct}%` || r.weeks !== `${s.weeklyWins}–${s.weeklyLosses}`)
      wrong.push(`${s.displayName}: rendered ${JSON.stringify(r)} vs ${s.totalCorrect}–${s.totalIncorrect} / ${s.winPct}% / ${s.weeklyWins}–${s.weeklyLosses}`);
  });
  assert(wrong.length === 0, `SF3a: every row is rank / name / totalCorrect–totalIncorrect / winPct% / weeklyWins–weeklyLosses straight from seasonStandingsRows(), in ITS order (${wrong.join(' ; ') || 'none'})`);
  const ann = rows.find(r => r.name === 'Ann');
  const annTruth = truth.find(s => s.displayName === 'Ann');
  assert(annTruth.totalCorrect === 6 && annTruth.totalIncorrect === 2 && annTruth.totalCorrectCount === 4 && annTruth.totalIncorrectCount === 4,
    `SF3b: fixture check — Ann's WEIGHTED tally (6 right / 2 wrong) deliberately differs from her RAW tally (4 / 4) — a 2x game (got ${annTruth.totalCorrect}/${annTruth.totalIncorrect} weighted, ${annTruth.totalCorrectCount}/${annTruth.totalIncorrectCount} raw)`);
  assert(ann.picks === '6–2' && ann.pct === '50%',
    `SF3c: Ann's Picks cell reads the WEIGHTED 6–2 and her Win % reads the RAW 4/(4+4) = 50% — never 6/8 = 75% (got ${ann.picks} / ${ann.pct})`);
  assert(ann.weeks === '2–0', `SF3d: Weeks reads her weekly wins–losses, 2–0 (got ${ann.weeks})`);
  const eve = rows.find(r => r.name === 'Eve');
  assert(eve.picks === '0–0' && eve.pct === '0%' && eve.weeks === '0–0',
    `SF3e: a player with NO results prints 0–0, 0%, 0–0 — a zero must never go blank (the escHtml(0) trap; got ${eve.picks} / ${eve.pct} / ${eve.weeks})`);
  assert(/<th scope="col" aria-label="Picks won and lost, weighted by game multiplier">Picks<\/th>/.test(seasonHtml)
      && /<th scope="col" aria-label="Win percentage, every pick counted once">Win %<\/th>/.test(seasonHtml)
      && /<th scope="col" aria-label="Weeks won and lost">Weeks<\/th>/.test(seasonHtml),
    'SF3f: the three stat headers carry the accessible names that stop a screen reader fusing "37–16" next to "68%" into one ratio');
  assert(/<p class="stand-foot">Picks count each game’s multiplier\. Win % counts every pick once\.<\/p>/.test(sfSeason(html)),
    'SF3g: the one-line footnote is present (typographic apostrophe) — weighted vs raw, said once');
  assert(rows[0].cls === 'winner-row' && rows[rows.length - 1].cls === 'loser-row' && rows.slice(1, -1).every(r => r.cls === ''),
    'SF3h: the leader row keeps .winner-row and the last-place row .loser-row (the tints are unchanged); crown/clown markers: ' + (/stand-mark">\u{1F451}/u.test(seasonHtml) && /stand-mark">\u{1F921}/u.test(seasonHtml) ? 'both present' : 'MISSING'));
  assert(!/Extra Point|extraPoint|\bEP\b|tiebreak/i.test(seasonHtml), 'SF3i: no Extra Point column and no tiebreaker value anywhere in Season Summary (AD-33; tiebreakers are never multiplied or shown here)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF4] DI-474 SF4 — BLIND RULE: an unfinished week or group renders ONLY "In progress", identically for everyone…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const names = ['Week 46', 'Week 47', 'Week 48', 'Week 49 + Week 50'];
  const views = { bystander: sfRender(SF_V.bystander), payerB: sfRender(SF_V.payerB), admin: sfRender(SF_V.admin) };
  for (const name of names) {
    const per = Object.fromEntries(Object.entries(views).map(([k, h]) => [k, sfGroup(h, name)]));
    assert(Object.values(per).every(Boolean), `SF4-0 (${name}): the row exists for a bystander, a player and the commissioner`);
    const g = per.bystander;
    assert(/>In progress<\/td>/.test(g) && /colspan="3"/.test(g),
      `SF4a (${name}): it reads one merged "In progress" cell (colspan 3)`);
    assert(!/Ann|Bob|Cat|Dan|Eve/.test(g.replace(/Week \d+/g, '')) && !/by tiebreaker|class="badge|<button|stand-act|player-name-cell/.test(g),
      `SF4b (${name}): no player name, no "by tiebreaker", no badge, no button, no action row — nothing a player could not learn from the week record itself`);
    assert(per.bystander === per.payerB && per.payerB === per.admin,
      `SF4c (${name}): the <tbody> is BYTE-IDENTICAL for a bystander, a player and the commissioner`);
  }
  // …including the case the per-part flags make dangerous: part 1 is final and flags Bob the winner, part 2 is not final.
  const grp = sfGroup(views.bystander, 'Week 49 + Week 50');
  assert(storage.getWeeklyResults('sfw49').some(r => r.isWinner && r.displayName === 'Bob') && !/Bob/.test(grp),
    'SF4d: the group\'s final part really DOES carry a per-part winner (Bob) — and the group row still never names him (extends loadtest [53b])');
  assert((grp.match(/Week 49 \+ Week 50/g) || []).length === 1 && !/stand-sub/.test(grp.split('<td class="stand-inprog"')[0]),
    'SF4e: the group label appears ONCE and carries no date line (a group label never had dates)');
  // A finalized week shows its names (so the assertions above are not passing on an empty table).
  assert(/player-name-cell">Ann<\/span>/.test(sfGroup(views.bystander, 'Week 41')) && /player-name-cell">Bob<\/span>/.test(sfGroup(views.bystander, 'Week 41')),
    'SF4f: control — the FINAL Week 41 does name its winner and loser');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF5] DI-474 SF5 — every row of the state tables…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // empty states (captured BEFORE the fixture was seeded)
  assert(/<td colspan="5" class="stand-empty">No finalized weeks yet\.<\/td>/.test(sfEmptyHtml) && !/stand-foot/.test(sfEmptyHtml),
    'SF5a: no active players → one empty Season row, colspan 5, "No finalized weeks yet.", and NO footnote');
  assert(/<div class="stand-box mb-md">/.test(sfSeason(sfEmptyHtml)) && !/class="stand-box"/.test(sfSeason(sfEmptyHtml)),
    'SF5b: …and the box carries its own bottom margin (the footnote that normally supplies it is absent)');
  assert(/<p class="text-muted text-sm mb-md">Weekly history appears after weeks are finalized\.<\/p>/.test(sfHist(sfEmptyHtml)) && !/stand-table-history/.test(sfHist(sfEmptyHtml)),
    'SF5c: no weeks at all → the existing "Weekly history appears after weeks are finalized." paragraph (and no empty table)');

  const html = sfRender(SF_V.admin);
  const g45 = sfGroup(html, 'Week 45'), g51 = sfGroup(html, 'Week 51'), g52 = sfGroup(html, 'Week 52'), g53 = sfGroup(html, 'Week 53'), g54 = sfGroup(html, 'Week 54'), g44 = sfGroup(html, 'Week 44'), g41 = sfGroup(html, 'Week 41');
  assert(/colspan="3"><span class="text-muted">—<\/span><\/td>/.test(g45) && !/In progress/.test(g45),
    'SF5d: a FINAL week with no result rows (hidden/legacy) is one merged cell with the muted dash — it does NOT claim "In progress" because it is not');
  assert(/colspan="2"><span class="text-muted">—<\/span><\/td><td class="stand-st"><span class="badge badge-locked">Unpaid<\/span><\/td>/.test(g51),
    'SF5e: a FINAL week with a money record but no results: a merged colspan="2" cell (muted dash) THEN the record\'s badge — a debt never disappears from the screen');
  assert(/colspan="2">In progress<\/td><td class="stand-st"><span class="badge badge-nd"[^>]*>Pending<\/span><\/td>/.test(g52) && sfBtns(g52).sort().join() === 'confirm,deny',
    'SF5f: an UNFINISHED week with a money record: "In progress" in a colspan="2" cell, the Pending badge, and the commissioner\'s Confirm + Deny still offered');
  assert(/<td class="stand-st"><span class="badge badge-locked">Unpaid<\/span><\/td>/.test(g53) && !/Needs review|<button|stand-act|title=/.test(g53),
    'SF5g: a CONFLICTED group (two active obligations) renders the plain Unpaid badge — no diagnostic text, no title, no action, even for the commissioner (UN-126/UN-135)');
  assert(/<td class="stand-st"><span class="text-muted text-xs">—<\/span><\/td>/.test(g54) && !/<button|stand-act/.test(g54),
    'SF5h: a FINAL week with results but NO obligation: both names, and a muted dash in the Status cell');
  assert(/<td class="stand-st"><span class="badge badge-final">Waived<\/span><\/td>/.test(g44) && !/<button|stand-act/.test(g44),
    'SF5i: a WAIVED week is the Waived badge and nothing else, for the commissioner too');
  assert(sfBtns(g41).join() === 'mark' && /Mark Paid<\/button>/.test(g41),
    'SF5j: an UNPAID week shows the commissioner "Mark Paid" in its own action row');
  assert(/<span class="stand-sub">by tiebreaker<\/span>/.test(sfGroup(html, 'Week 42')) && !/by tiebreaker/.test(g41) && !/\(TB\)/.test(html),
    'SF5k: "by tiebreaker" sits under the winner of a week won on the tiebreaker (wonByTiebreaker) and nowhere else; "(TB)" is gone');
  const noMoney = sfRender(SF_V.anon);
  assert(/Week 53/.test(noMoney) && !/<button/.test(noMoney), 'SF5l: signed out — every row still renders and not one <button> exists');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF6] DI-474 SF6 — the two-line week cell, one label per row, and the SP-54 seam…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const html = sfRender(SF_V.bystander);
  const g41 = sfGroup(html, 'Week 41'), g42 = sfGroup(html, 'Week 42'), grp = sfGroup(html, 'Week 49 + Week 50');
  assert(/<td class="stand-wk"><span class="stand-wk-name" id="stand-wk-\d+">Week 41<\/span><span class="stand-sub">Sep 24–26<\/span><\/td>/.test(g41),
    'SF6a: a singleton week is the name over the compact date: <span class="stand-wk-name">Week 41</span><span class="stand-sub">Sep 24–26</span>');
  assert(/<span class="stand-sub">Sep 30–Oct 2<\/span>/.test(g42), 'SF6b: a week spanning two months reads "Sep 30–Oct 2"');
  assert(/<td class="stand-wk"><span class="stand-wk-name" id="stand-wk-\d+">Week 49 \+ Week 50<\/span><\/td>/.test(grp),
    'SF6c: a multi-part group is its group name with NO date span (no empty element claiming height)');
  const singles = ['Week 41', 'Week 42', 'Week 43', 'Week 44', 'Week 45', 'Week 46', 'Week 47', 'Week 48', 'Week 51', 'Week 52', 'Week 53', 'Week 54'];
  const drift = singles.filter(n => !dm.formatWeekLabel(storage.getWeek('sfw' + n.slice(5))).startsWith(sfWkName(sfGroup(html, n))));
  assert(drift.length === 0, `SF6d: the rendered name is always the START of formatWeekLabel() for every singleton — the two can never drift apart (drifted: ${drift.join(', ') || 'none'})`);
  const onceMore = sfGroups(html).filter(g => (g.match(/Week 4[1-9]|Week 5\d/g) || []).length > 1 && !/Week 49 \+ Week 50/.test(g));
  assert(onceMore.length === 0, 'SF6e: the week label is written ONCE per row — never repeated in a title or aria-label (the group uses aria-labelledby the visible name)');
  assert(sfGroups(sfRender(SF_V.admin)).every(g => !/aria-label="[^"]*Week/.test(g) && !/title="[^"]*Week/.test(g)) && /role="group" aria-labelledby="stand-wk-\d+"/.test(sfRender(SF_V.admin)),
    'SF6f: …and the action group names itself with aria-labelledby, not a second copy of the label');
  assert(/\$\{weekCell\}\$\{cells\}<\/tr>\$\{noteRow\}\$\{hasAct/.test(sfAppSrc) && /const noteRow = noteLines\.length/.test(sfAppSrc) && /<tr class="stand-note\$\{hasAct\?' has-act':''\}"><td colspan="4">/.test(sfAppSrc),
    'SF6g: the SP-54 note row (DI-468) is emitted AFTER the week row and BEFORE the action row, inside the same <tbody>, as a full-width tr.stand-note (colspan 4) — the seam SP-56 left is now filled (re-derived 2026-10-01; behaviour proven by [SP54-L] below)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF10] DI-474 SF10 — no comment in renderLeaderboard still says the two sections are a sideways scroller…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const start = sfAppSrc.indexOf('export function renderLeaderboard()');
  const end = sfAppSrc.indexOf('export function renderAlmaMaterRankings()');
  const body = sfAppSrc.slice(start, end);
  assert(start > 0 && end > start && body.length > 3000, 'SF10-0: fixture check — renderLeaderboard()\'s source was located');
  // comment paragraphs: consecutive // lines, and /* … */ blocks
  const paras = [];
  let cur = [];
  for (const line of body.split('\n')) {
    if (/^\s*\/\//.test(line)) cur.push(line.replace(/^\s*\/\/\s?/, ''));
    else { if (cur.length) paras.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) paras.push(cur.join(' '));
  for (const m of body.matchAll(/\/\*[\s\S]*?\*\//g)) paras.push(m[0]);
  const stale = paras.filter(p => /dashboard-scroll/.test(p) && !/2K25|2025|SP-56/.test(p));
  assert(stale.length === 0, `SF10a: every comment in renderLeaderboard that mentions .dashboard-scroll either names the embedded 2K25 tables or carries the dated SP-56 note — a comment that lies about a sideways scroller is a defect (stale: ${stale.map(s => s.slice(0, 60)).join(' | ') || 'none'})`);
  assert(!paras.some(p => /SIBLING \.dashboard-scroll/.test(p)) && paras.some(p => /SP-56/.test(p) && /\.stand-box/.test(p)),
    'SF10b: the "sibling .dashboard-scroll wrapper" wording is gone and a dated SP-56 note names the .stand-box that replaced it');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF7] DI-474 SF7 — XSS: names and labels are escaped in BOTH sections, figures go through numHtml…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const evil = '<img src=x onerror=1>';
  addPlayer({ playerId: 'sf_x', displayName: evil, active: true, preferences: {} });
  sfWeek(55, { roundLabel: '<b>boom</b>', startDate: '2026-12-31', endDate: '2027-01-02' });
  sfSave('sfw55', [SFR('sfw55', 'sf_x', evil, 9, 0, 9, 0, { isWinner: true, rank: 1 }), SFR('sfw55', 'sf_d', 'Dan', 0, 9, 0, 9, { isLoser: true, rank: 2 })]);
  const html = sfRender(SF_V.bystander);
  assert(!/<img src=x/.test(html) && !/<b>boom<\/b>/.test(html), 'SF7a: neither the player name nor the week label reaches the page as live markup');
  assert(/stand-name-text player-name-cell">&lt;img src=x onerror=1&gt;<\/span>/.test(sfSeason(html)), 'SF7b: Season Summary escapes the player name');
  assert(/player-name-cell">&lt;img src=x onerror=1&gt;<\/span>/.test(sfHist(html)) && /Week 55, &lt;b&gt;boom&lt;\/b&gt;/.test(sfHist(html)), 'SF7c: Weekly History escapes the winner name AND the week label');
  assert(/<span class="stand-sub">Dec 31–Jan 2<\/span>/.test(sfGroup(html, 'Week 55, &lt;b&gt;boom&lt;/b&gt;') || ''), 'SF7d: …and a cross-YEAR range prints "Dec 31–Jan 2" with no year');
  const nums = [...sfTable(sfSeason(html), 'stand-table-season').matchAll(/<td class="stand-num">([\s\S]*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  assert(nums.length >= 6 && nums.every(t => /^[\d.]+(–[\d.]+|%)?$/.test(t)), `SF7e: every stat cell holds only digits, the en dash, a point or % — numHtml() coerced them (${nums.length} cells)`);
  // retire the evil player/week so nothing after this section sees them
  storage.savePlayer({ ...storage.getPlayers().find(p => p.playerId === 'sf_x'), active: false });
  saveWeek({ ...storage.getWeek('sfw55'), dataSourceMode: 'demo' });
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF8] DI-472/DI-474 SF8 — obligationActionsHTML() is BYTE-IDENTICAL: golden literals captured from main BEFORE the badge/actions split…');
// ═════════════════════════════════════════════════════════════════════════════
const SF8_GOLDEN = {
    "ob-action|unpaid|payer|plain": "<span class=\"badge badge-locked\">Unpaid</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob-action|unpaid|payer|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob-action|unpaid|creditor|plain": "<span class=\"badge badge-locked\">Unpaid</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Confirm Paid</button>",
    "ob-action|unpaid|creditor|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Confirm Paid</button>",
    "ob-action|unpaid|admin|plain": "<span class=\"badge badge-locked\">Unpaid</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob-action|unpaid|admin|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob-action|unpaid|bystander|plain": "<span class=\"badge badge-locked\">Unpaid</span>",
    "ob-action|unpaid|bystander|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span>",
    "ob-action|unpaid|nosession|plain": "<span class=\"badge badge-locked\">Unpaid</span>",
    "ob-action|unpaid|nosession|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span>",
    "ob-action|pending|payer|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span><span class=\"text-muted text-xs\">Waiting on Rae &amp; Co to confirm.</span>",
    "ob-action|pending|creditor|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"confirm\">Confirm</button><button class=\"btn btn-danger btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"deny\">Deny</button>",
    "ob-action|pending|admin|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span><button class=\"btn btn-win btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"confirm\">Confirm</button><button class=\"btn btn-danger btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"deny\">Deny</button>",
    "ob-action|pending|bystander|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span>",
    "ob-action|pending|nosession|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span>",
    "ob-action|paid|payer|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob-action|paid|creditor|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob-action|paid|admin|plain": "<span class=\"badge badge-open\">Paid ✓</span><button class=\"btn btn-ghost btn-sm ob-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"undo\">Undo</button>",
    "ob-action|paid|bystander|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob-action|paid|nosession|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob-action|waived|payer|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob-action|waived|creditor|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob-action|waived|admin|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob-action|waived|bystander|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob-action|waived|nosession|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob2025-action|unpaid|payer|plain": "<span class=\"badge badge-locked\">Unpaid</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob2025-action|unpaid|payer|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob2025-action|unpaid|creditor|plain": "<span class=\"badge badge-locked\">Unpaid</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Confirm Paid</button>",
    "ob2025-action|unpaid|creditor|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Confirm Paid</button>",
    "ob2025-action|unpaid|admin|plain": "<span class=\"badge badge-locked\">Unpaid</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob2025-action|unpaid|admin|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"mark\">Mark Paid</button>",
    "ob2025-action|unpaid|bystander|plain": "<span class=\"badge badge-locked\">Unpaid</span>",
    "ob2025-action|unpaid|bystander|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span>",
    "ob2025-action|unpaid|nosession|plain": "<span class=\"badge badge-locked\">Unpaid</span>",
    "ob2025-action|unpaid|nosession|denied": "<span class=\"badge badge-locked\" title=\"Denied: No funds &amp; &quot;late&quot;\">Unpaid</span>",
    "ob2025-action|pending|payer|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span><span class=\"text-muted text-xs\">Waiting on Rae &amp; Co to confirm.</span>",
    "ob2025-action|pending|creditor|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"confirm\">Confirm</button><button class=\"btn btn-danger btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"deny\">Deny</button>",
    "ob2025-action|pending|admin|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span><button class=\"btn btn-win btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"confirm\">Confirm</button><button class=\"btn btn-danger btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"deny\">Deny</button>",
    "ob2025-action|pending|bystander|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span>",
    "ob2025-action|pending|nosession|plain": "<span class=\"badge badge-nd\" title=\"Pending confirmation from Rae &amp; Co or the commissioner\">Pending</span>",
    "ob2025-action|paid|payer|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob2025-action|paid|creditor|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob2025-action|paid|admin|plain": "<span class=\"badge badge-open\">Paid ✓</span><button class=\"btn btn-ghost btn-sm ob2025-action-btn\" data-ob-id=\"ob_golden_1\" data-ob-action=\"undo\">Undo</button>",
    "ob2025-action|paid|bystander|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob2025-action|paid|nosession|plain": "<span class=\"badge badge-open\">Paid ✓</span>",
    "ob2025-action|waived|payer|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob2025-action|waived|creditor|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob2025-action|waived|admin|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob2025-action|waived|bystander|plain": "<span class=\"badge badge-final\">Waived</span>",
    "ob2025-action|waived|nosession|plain": "<span class=\"badge badge-final\">Waived</span>",
};
const SF8_SESS = {
  payer:     { isAdmin: false, playerId: 'pay', playerVerified: true },
  creditor:  { isAdmin: false, playerId: 'rec', playerVerified: true },
  admin:     { isAdmin: true,  playerId: 'adm', playerVerified: true },
  bystander: { isAdmin: false, playerId: 'zzz', playerVerified: true },
  nosession: { isAdmin: false, playerId: null,  playerVerified: false },
};
const sf8Parse = key => {
  const [obClass, status, role, denied] = key.split('|');
  return {
    obClass, status, role,
    ob: { obligationId: 'ob_golden_1', payerPlayerId: 'pay', recipientPlayerId: 'rec', status,
          ...(denied === 'denied' ? { deniedReason: 'No funds & "late"' } : {}) },
    sess: SF8_SESS[role],
    opts: { payerName: 'Pat <P>', recipientName: 'Rae & Co', obClass },
  };
};
{
  const keys = Object.keys(SF8_GOLDEN);
  assert(keys.length === 50,
    `SF8-0: the golden matrix is complete — 2 obClass x (unpaid 2 + pending/paid/waived 1 each = 5) x 5 viewers (payer, creditor, admin, bystander, no session) = 50 (got ${keys.length})`);
  assert(typeof app.obligationActionsHTML === 'function',
    'SF8-1: obligationActionsHTML is EXPORTED (DI-472 commit 1) — the golden has to call the real function, not a copy');
  const bad = [];
  for (const key of keys) {
    const { status, ob, sess, opts } = sf8Parse(key);
    if (app.obligationActionsHTML(status, ob, sess, opts) !== SF8_GOLDEN[key]) bad.push(key);
  }
  assert(bad.length === 0,
    `SF8a: obligationActionsHTML() returns, for every status x role x denied x obClass cell, the EXACT string main returned before the split — Comm's lists and the 2K25 card depend on it (differing cells: ${bad.join(', ') || 'none'})`);

  // ── commit 2: the sibling split. { badge, actions } must recombine to the SAME golden string.
  assert(typeof app.obligationBadgeAndActions === 'function',
    'SF8-2: obligationBadgeAndActions() is exported — the Standings row seats the badge and the buttons separately');
  const badSplit = [], badBadge = [];
  for (const key of keys) {
    const { status, ob, sess, opts } = sf8Parse(key);
    const { badge, actions } = app.obligationBadgeAndActions(status, ob, sess, opts);
    if (badge + actions !== SF8_GOLDEN[key]) badSplit.push(key);
    if (!/^<span class="badge [^"]*"[^>]*>[^<]*<\/span>$/.test(badge) || /<button/.test(badge)) badBadge.push(key);
  }
  assert(badSplit.length === 0,
    `SF8b: badge + actions from obligationBadgeAndActions() equals the golden for every cell, both obClass values (differing: ${badSplit.join(', ') || 'none'}) — one function decides which button each viewer sees; the sibling never forks it`);
  assert(badBadge.length === 0,
    `SF8c: the badge half is exactly one <span class="badge …"> and never carries a button, in every cell (differing: ${badBadge.join(', ') || 'none'}) — the Status cell can never hold a <button> because the badge cannot`);

  // ── Amendment 1 ("undo com only"): withUndo.
  const undoCells = keys.filter(k => /data-ob-action="undo"/.test(SF8_GOLDEN[k]));
  assert(undoCells.length === 2 && undoCells.every(k => k.split('|')[1] === 'paid' && k.split('|')[2] === 'admin'),
    `SF8d: in the golden, Undo exists ONLY for paid x admin (one per obClass) — got ${undoCells.join(', ') || 'none'}`);
  const badUndo = [], badDefault = [];
  for (const key of keys) {
    const { status, ob, sess, opts } = sf8Parse(key);
    const def = app.obligationBadgeAndActions(status, ob, sess, opts);
    const explicitTrue = app.obligationBadgeAndActions(status, ob, sess, { ...opts, withUndo: true });
    const noUndo = app.obligationBadgeAndActions(status, ob, sess, { ...opts, withUndo: false });
    if (def.badge !== explicitTrue.badge || def.actions !== explicitTrue.actions) badDefault.push(key);
    const isPaidAdmin = status === 'paid' && sf8Parse(key).role === 'admin';
    // withUndo:false: the badge never changes, and the actions change ONLY for paid x admin (where they become '').
    const expectedActions = isPaidAdmin ? '' : def.actions;
    if (noUndo.badge !== def.badge || noUndo.actions !== expectedActions) badUndo.push(key);
  }
  assert(badDefault.length === 0,
    `SF8e: withUndo defaults to TRUE — omitting it equals withUndo:true in every cell, so Comm's two lists (which never name it) keep Undo (differing: ${badDefault.join(', ') || 'none'})`);
  assert(badUndo.length === 0,
    `SF8f: withUndo:false changes EXACTLY one cell per obClass — paid x admin becomes badge-only ("Paid ✓", no action) — and every other cell is byte-identical to its default (differing: ${badUndo.join(', ') || 'none'})`);
  const paidAdminNoUndo = app.obligationBadgeAndActions('paid', sf8Parse('ob-action|paid|admin|plain').ob, SF8_SESS.admin, { ...sf8Parse('ob-action|paid|admin|plain').opts, withUndo: false });
  assert(paidAdminNoUndo.actions === '' && /Paid ✓/.test(paidAdminNoUndo.badge),
    'SF8g: the concrete case — a commissioner on a paid week with withUndo:false gets the "Paid ✓" badge and an EMPTY actions string (so the Standings row has no second row at all)');
  // The wrapper forwards the option too (the 2K25 Outstanding card calls the wrapper with withUndo:false).
  const wrapNoUndo = app.obligationActionsHTML('paid', sf8Parse('ob-action|paid|admin|plain').ob, SF8_SESS.admin, { ...sf8Parse('ob-action|paid|admin|plain').opts, withUndo: false });
  assert(!/<button/.test(wrapNoUndo) && /Paid ✓/.test(wrapNoUndo),
    'SF8h: obligationActionsHTML() forwards withUndo:false (the 2K25 Outstanding card on Standings uses the wrapper) — no <button> for a commissioner on a paid row');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF9] DI-474 SF9 — the payment tap: re-render, keep the scroll position INSTANTLY, one medium haptic only on a SUCCESSFUL mark/confirm, native only…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const lbStart = sfAppSrc.indexOf('export function renderLeaderboard()');
  const lbBody = sfAppSrc.slice(lbStart, sfAppSrc.indexOf('export function renderAlmaMaterRankings()'))
    .split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  assert(/handleObligationAction\(id, act\);\s*renderLeaderboard\(\);\s*if \(typeof window\.scrollTo==='function'\) window\.scrollTo\(\{ top:y, left:0, behavior:'instant' \}\);/.test(lbBody),
    'SF9a: structural — the handler re-renders, THEN restores window.scrollY with behavior:\'instant\' (html{scroll-behavior:smooth} would otherwise turn it into a visible slide)');
  assert((lbBody.match(/haptic\(/g) || []).length === 1 && /if \(\(act==='mark'\|\|act==='confirm'\) && obStatus\(id\)!==before\) haptic\('medium'\);/.test(lbBody),
    'SF9b: structural — haptic() is called exactly ONCE in renderLeaderboard, only for mark/confirm, and only when the status actually changed (never deny, never undo, never a refused action)');

  // Behavioural: fresh money-only weeks (final, no result rows), each with its own obligation.
  for (const [n, payer, rec, st] of [[60, 'sf_b', 'sf_a', 'unpaid'], [61, 'sf_d', 'sf_c', 'pending'], [62, 'sf_d', 'sf_c', 'pending'], [63, 'sf_d', 'sf_c', 'pending'], [64, 'sf_b', 'sf_a', 'unpaid'], [66, 'sf_b', 'sf_a', 'unpaid']]) {
    sfWeek(n, { startDate: '2027-01-0' + (n - 59), endDate: '2027-01-0' + (n - 59) });
    storage.saveObligation(SFO('sfo' + n, 'sfw' + n, payer, rec, st));
  }
  const realScrollTo = globalThis.scrollTo, realPrompt = globalThis.prompt;
  const scrolls = [], buzz = [];
  globalThis.scrollTo = o => scrolls.push(o);
  globalThis.scrollY = 321;
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { impact: o => buzz.push(o) } } };
  const status = id => storage.getObligations().find(o => o.obligationId === id)?.status;
  const button = (viewer, id, act) => {
    sfRender(viewer);
    return els.get('page-leaderboard').querySelectorAll('.ob-action-btn').find(x => x.dataset.obId === id && x.dataset.obAction === act);
  };
  try {
    // 1) NATIVE: the payer marks paid -> pending. One MEDIUM impact; the scroll position survives, instantly.
    let b = button(SF_V.payerB, 'sfo60', 'mark');
    assert(!!b && b._bound() === 1, 'SF9c: fixture — the payer sees a real "Mark Paid" button with exactly one click handler bound by renderLeaderboard()');
    b.click();
    assert(status('sfo60') === 'pending', 'SF9d: the tap went through the real handler (unpaid → pending)');
    assert(scrolls.length === 1 && scrolls[0].top === 321 && scrolls[0].left === 0 && scrolls[0].behavior === 'instant',
      `SF9e: scrollTo({ top:321, left:0, behavior:'instant' }) ran exactly once after the re-render (got ${JSON.stringify(scrolls)})`);
    assert(/Pending/.test(sfGroup(els.get('page-leaderboard')._html, 'Week 60') || '') && !/Mark Paid/.test(sfGroup(els.get('page-leaderboard')._html, 'Week 60') || ''),
      'SF9f: …and the page was genuinely re-rendered — the row now reads Pending and the button is gone');
    assert(buzz.length === 1 && buzz[0].style === 'MEDIUM', `SF9g: native — ONE medium impact for the successful Mark Paid (got ${JSON.stringify(buzz)})`);

    // 2) NATIVE: the creditor confirms a pending debt -> paid. A second medium impact.
    button(SF_V.creditorC, 'sfo61', 'confirm').click();
    assert(status('sfo61') === 'paid' && buzz.length === 2, `SF9h: native — Confirm on a pending debt is the second medium impact (status ${status('sfo61')}, ${buzz.length} impacts)`);

    // 3) NATIVE: Deny — no haptic, whether the prompt is cancelled or answered.
    globalThis.prompt = () => null;
    button(SF_V.creditorC, 'sfo62', 'deny').click();
    assert(status('sfo62') === 'pending' && buzz.length === 2, 'SF9i: Deny with the prompt CANCELLED changes nothing and buzzes nothing');
    globalThis.prompt = () => 'not this week';
    button(SF_V.creditorC, 'sfo63', 'deny').click();
    assert(status('sfo63') === 'unpaid' && buzz.length === 2, 'SF9j: Deny that SUCCEEDS (pending → unpaid) still buzzes nothing — haptics are for the primary action only');

    // 4) NATIVE: a REFUSED action. The button was rendered for the payer; the session changes before the tap (a DOM-injected / stale button).
    const stale = button(SF_V.payerB, 'sfo64', 'mark');
    setSession('sf_e', false, true);                      // a bystander now
    stale.click();
    assert(status('sfo64') === 'unpaid' && buzz.length === 2, 'SF9k: a REFUSED action ("You don\'t have permission") changes nothing and buzzes nothing — the haptic follows the status change, not the tap');

    // 5) WEB: no Capacitor bridge at all — the same successful tap restores scroll and re-renders, with ZERO haptics.
    delete globalThis.Capacitor;
    const before = buzz.length, scrollsBefore = scrolls.length;
    button(SF_V.payerB, 'sfo66', 'mark').click();
    assert(status('sfo66') === 'pending' && buzz.length === before, `SF9l: web — the identical tap works and fires NO haptic (PARITY-BY-DESIGN: the toast is the web feedback; ${buzz.length - before} impacts)`);
    assert(scrolls.length > scrollsBefore && scrolls.at(-1).behavior === 'instant', 'SF9m: …and still restores the scroll position instantly');
  } finally {
    globalThis.scrollTo = realScrollTo; globalThis.prompt = realPrompt;
    delete globalThis.scrollY; delete globalThis.Capacitor;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF11] Amendment 1 ("undo com only") — Undo is offered in Comm and NEVER on Standings…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // The 2K25 sections belong to the pilot league; let them render so the Standings 2K25 card is covered too.
  PO.setPilotOnlyLeagueResolver(() => ({ pilot: true }));
  const rows2025 = h2025.season2025Obligations();
  assert(rows2025.length >= 3, `SF11-0: fixture check — the baked 2K25 ledger has rows to mark paid (${rows2025.length})`);
  storage.saveSetting('ob2025', { [rows2025[0].obligationId]: 'paid' });
  // a PAID current-season obligation exists (Week 43) and so does a paid 2K25 one.
  assert(storage.getObligations().some(o => o.status === 'paid'), 'SF11-1: fixture check — a paid current-season obligation exists (Week 43)');
  const undoAnywhere = [];
  for (const [vname, v] of Object.entries(SF_V)) {
    const html = sfRender(v);
    if (/data-ob-action="undo"/.test(html)) undoAnywhere.push(vname);
  }
  assert(/2K25 Outstanding Balances/.test(sfRender(SF_V.admin)), 'SF11a-0: fixture check — the Standings 2K25 Outstanding card renders (so "no Undo" covers it, not just Weekly History)');
  assert(undoAnywhere.length === 0,
    `SF11a: renderLeaderboard() contains ZERO data-ob-action="undo" for every viewer — commissioner included — across Weekly History and the 2K25 Outstanding card (found for: ${undoAnywhere.join(', ') || 'none'})`);
  assert(/obClass: 'ob-action',\s*withUndo: false,/.test(sfAppSrc) && /obClass: 'ob2025-action', withUndo: false \}\)/.test(sfAppSrc),
    'SF11a2: structural — both Standings call sites pass withUndo:false (Weekly History via historyGroupHTML, and the 2K25 Outstanding card), so "no Undo on Standings" is true by construction, not by what data happens to be listed');

  // The twin controls: the capability MOVED, it was not deleted.
  setSession('sf_e', true, true);
  const comm = app.renderObligationsAdmin();
  assert(/data-ob-action="undo"/.test(comm) && /ob-action-btn/.test(comm.match(/<button[^>]*data-ob-action="undo"[^>]*>/)?.[0] || ''),
    'SF11b: Comm → Players → Obligations (renderObligationsAdmin) STILL offers Undo on a paid obligation to the commissioner');
  const comm2025 = app.renderSeason2025ObligationsAdmin();
  assert(/data-ob-action="undo"/.test(comm2025) && /ob2025-action-btn/.test(comm2025.match(/<button[^>]*data-ob-action="undo"[^>]*>/)?.[0] || ''),
    'SF11c: …and so does Comm\'s 2K25 carryover list, for a paid 2K25 row');
  setSession('sf_a', false, true);
  assert(!/data-ob-action="undo"/.test(app.renderObligationsAdmin()), 'SF11c2: …and only to the commissioner — a payer/creditor never sees Undo in that list either');
  assert(dm.obligationNextStatus('paid', 'admin', 'undo') === 'unpaid' && dm.obligationNextStatus('paid', 'creditor', 'undo') === null && dm.obligationNextStatus('paid', 'payer', 'undo') === null && dm.obligationNextStatus('paid', 'bystander', 'undo') === null,
    'SF11d: the permission boundary is untouched — the state machine still returns a paid obligation to unpaid for the commissioner and for nobody else');
  PO.setPilotOnlyLeagueResolver(null);
  storage.saveSetting('ob2025', {});
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SF12] Breathing Room (Drew, 2026-09-30; consolidated into .btn-row 2026-10-01) — the payment-action row is a centred group with a container gap, never a margin on one button…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // 2026-10-01 sweep: the row IS the shared `.btn-row` primitive (SB-14). The flex/wrap/centre/gap contract is read from `.btn-row`; `.stand-act-row` keeps only the 44pt line + the scoped child rules.
  // sfRules is the SP-56 slice of the sheet; `.btn-row` lives in the shared-components section, so read it from the whole sheet (comments stripped).
  const row = [...sfCssSrc.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }))
    .find(r => r.sel.split(',').map(s => s.trim()).includes('.btn-row'));
  assert(sfDecl(row, 'display') === 'flex' && sfDecl(row, 'flex-wrap') === 'wrap',
    'SF12a: the group is a wrapping flex row (.btn-row) — a row that does not fit WRAPS into a stack instead of overflowing');
  assert(sfNum(sfDecl(row, 'gap')) >= 8, `SF12b: the space between buttons is the container's gap, >= 8px (got ${sfDecl(row, 'gap')}) — and it is kept when the row wraps`);
  assert(sfDecl(row, 'justify-content') === 'center' && sfDecl(row, 'align-items') === 'center',
    'SF12c: the group is centred horizontally AND vertically in its row (equal space above and below; a missing button never leaves it off-centre)');
  assert(sfNum(sfDecl(sfRule('.stand-act-row'), 'min-height')) >= 44, 'SF12d: every action row is at least 44px tall, so the payer\'s wait text is centred in the same line height as a button row');
  const pad = (sfDecl(sfRule('.stand-table .stand-act td'), 'padding') || '').split(/\s+/).map(sfNum);
  assert(pad[0] >= 8 && pad[1] >= 16, `SF12e: the row keeps >= 8px between a button and a divider and >= 16px between a button and the card edge (padding ${pad.join('/')}px)`);
  // The sweep removed `.ml-sm` from the SHARED markup (not just from this row), so no surface's buttons depend on a margin any more.
  // Read the LIVE output of the real function for every cell (not just the golden literals), so a regression in the markup is caught even if the golden were edited to match.
  const withMargin = Object.keys(SF8_GOLDEN).filter(k => { const { status, ob, sess, opts } = sf8Parse(k); return /\bml-sm\b/.test(app.obligationActionsHTML(status, ob, sess, opts)); });
  assert(withMargin.length === 0 && !Object.values(SF8_GOLDEN).some(h => /\bml-sm\b/.test(h)),
    `SF12f: no obligation button or wait line in any of the ${Object.keys(SF8_GOLDEN).length} cells (live output AND golden) carries .ml-sm — the container's gap spaces every surface (live cells still carrying it: ${withMargin.join(', ') || 'none'})`);
  assert(!sfRules.some(r => /\.stand-act-row\s+\.ml-sm/.test(r.sel)),
    'SF12f2: …so the old `.stand-act-row .ml-sm{margin-left:0}` zeroing rule is deleted, not left behind as dead CSS');
  assert(!sfRules.some(r => /\.stand-act-row/.test(r.sel) && /(^|;)\s*margin/.test(r.body)),
    'SF12g: no rule puts a margin on anything inside the action group');
  const sar = sfRule('.stand-act-row');
  assert(!!sar && !/(^|;)\s*(display|flex-wrap|gap|justify-content|align-items)\s*:/.test(sar.body),
    `SF12g2: consolidation — .stand-act-row declares NO flex/wrap/gap/centring of its own (it all comes from .btn-row; body: "${sar && sar.body}")`);
  const g = sfGroup(sfRender(SF_V.admin), 'Week 52') || '';
  assert(/<div class="btn-row stand-act-row" role="group" aria-labelledby="stand-wk-\d+"><button[^>]*>Confirm<\/button><button[^>]*>Deny<\/button><\/div>/.test(g),
    'SF12h: markup — Confirm and Deny are adjacent siblings directly inside the .btn-row group: no spacer element, no wrapper margin');
}

// ── Result ───────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
// [SP54-L] DI-468 — the tie-reason note under a week in Weekly History, through the REAL renderLeaderboard() (SP-54, 2026-10-01).
// The note is a full-width `tr.stand-note` (colspan 4) INSIDE the week's own <tbody>, between the week row and the payment-action row, so a full sentence never
// has to fit the 90 px winner/loser cell and the 44 pt payment button keeps its own row directly under the week. Fixture: a clean slate (the SF weeks are retired
// to demo first), five final weeks with STORED descriptors (the singleton path reads stored rows), one in-progress week, one conflicted week.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SP54-L] DI-468 — the Weekly History note row: placement, columns, states, escaping…');
{
  storage.getWeeks().forEach(w => saveWeek({ ...w, dataSourceMode: 'demo' }));
  storage.getPlayers().forEach(p => storage.savePlayer({ ...p, active: false }));
  const HOST = '<img src=x onerror=1>';
  [['tn_a', 'Kevin'], ['tn_b', 'Koby'], ['tn_c', HOST], ['tn_d', 'Jacob']].forEach(([id, n]) => addPlayer({ playerId: id, displayName: n, active: true, preferences: {} }));
  const wk = (n, over = {}) => saveWeek(mkWeek({ weekId: 'tnw' + n, weekNumber: 70 + n, name: 'Week ' + (70 + n), status: 'final', blurb: '', startDate: '2026-09-24', endDate: '2026-09-26', ...over }));
  const R = (weekId, pid, name, cp, flags = {}) => ({ weekId, playerId: pid, displayName: name, rank: 2, correctPicks: cp, incorrectPicks: 6 - cp, correctCount: cp, incorrectCount: 6 - cp,
    noDecisions: 0, isWinner: false, isLoser: false, wonByTiebreaker: false, ...flags });
  const O = (id, weekId, payer, recipient, status) => ({ obligationId: id, type: 'weekly', weekId, payerPlayerId: payer, recipientPlayerId: recipient, amountOrPrize: 'a drink', status,
    createdAt: '2026-09-20T00:00:00Z', paidAt: null });
  const A = (team, cov, mis, psh = 0) => ({ team, cov, mis, psh, src: 'snapshot' });
  const alma = (end, vs, me, other, src = 'snapshot') => ({ v: 1, end, stage: 'alma', vs, me, other, src });
  // 71: Kevin won on his alma mater, Koby is last on the Extra Point; Koby owes Kevin (a payer sees an action row)
  wk(1); storage.saveAllWeeklyResults('tnw1', [
    R('tnw1', 'tn_a', 'Kevin', 5, { isWinner: true, rank: 1, tieBreak: alma('winner', 'tn_d', A('Notre Dame', 1, 0), A('USC', 0, 1)) }),
    R('tnw1', 'tn_d', 'Jacob', 5), R('tnw1', 'tn_c', HOST, 3),
    R('tnw1', 'tn_b', 'Koby', 1, { isLoser: true, rank: 4, tieBreak: { v: 1, end: 'loser', stage: 'ep', vs: 'tn_c', me: { cls: 1, guess: 57, delta: 5 }, other: { cls: 0, guess: 50, delta: 2 } } })]);
  storage.saveObligation(O('tno1', 'tnw1', 'tn_b', 'tn_a', 'unpaid'));
  // 72: a two-player-style draw: both ends name the same two players -> ONE line
  wk(2); storage.saveAllWeeklyResults('tnw2', [
    R('tnw2', 'tn_a', 'Kevin', 3, { isWinner: true, rank: 1, tieBreak: { v: 1, end: 'winner', stage: 'draw', vs: 'tn_b', me: null, other: null } }),
    R('tnw2', 'tn_b', 'Koby', 3, { isLoser: true, rank: 2, tieBreak: { v: 1, end: 'loser', stage: 'draw', vs: 'tn_a', me: null, other: null } })]);
  // 73: hostile display name on the winner, hostile school in the descriptor
  wk(3); storage.saveAllWeeklyResults('tnw3', [
    R('tnw3', 'tn_c', HOST, 5, { isWinner: true, rank: 1, tieBreak: alma('winner', 'tn_a', A(HOST, 1, 0), A(`=HYPERLINK("x")`, 0, 1)) }),
    R('tnw3', 'tn_a', 'Kevin', 5), R('tnw3', 'tn_d', 'Jacob', 1, { isLoser: true, rank: 3 })]);
  // 74: no descriptor at all (a week settled before the rule) — wonByTiebreaker keeps today's `by tiebreaker` sub-caption and NO note row
  wk(4); storage.saveAllWeeklyResults('tnw4', [
    R('tnw4', 'tn_a', 'Kevin', 5, { isWinner: true, rank: 1, wonByTiebreaker: true }), R('tnw4', 'tn_b', 'Koby', 5), R('tnw4', 'tn_d', 'Jacob', 1, { isLoser: true, rank: 3 })]);
  // 75: an INVALID descriptor (wrong version) — treated as absent
  wk(5); storage.saveAllWeeklyResults('tnw5', [
    R('tnw5', 'tn_a', 'Kevin', 5, { isWinner: true, rank: 1, tieBreak: { v: 9, end: 'winner', stage: 'alma', vs: 'tn_b', me: A('X', 1, 0), other: A('Y', 0, 1) } }), R('tnw5', 'tn_b', 'Koby', 1, { isLoser: true, rank: 2 })]);
  // 76: CONFLICTED (two active obligations) — a note could contradict the money, so none
  wk(6); storage.saveAllWeeklyResults('tnw6', [
    R('tnw6', 'tn_a', 'Kevin', 5, { isWinner: true, rank: 1, tieBreak: alma('winner', 'tn_b', A('Notre Dame', 1, 0), A('USC', 0, 1)) }), R('tnw6', 'tn_b', 'Koby', 1, { isLoser: true, rank: 2 })]);
  storage.saveObligation(O('tno6a', 'tnw6', 'tn_b', 'tn_a', 'unpaid')); storage.saveObligation(O('tno6b', 'tnw6', 'tn_d', 'tn_a', 'unpaid'));
  // 77: IN PROGRESS (live) with rows that carry a descriptor — the blind rule: no note, no names
  wk(7, { status: 'live' }); storage.saveAllWeeklyResults('tnw7', [
    R('tnw7', 'tn_a', 'Kevin', 5, { isWinner: true, rank: 1, tieBreak: alma('winner', 'tn_b', A('Notre Dame', 1, 0), A('USC', 0, 1)) }), R('tnw7', 'tn_b', 'Koby', 1, { isLoser: true, rank: 2 })]);

  const payer = ['tn_b', false, true], bystander = ['tn_d', false, true], anon = [null, false, false];
  const html = sfRender(payer);
  const g = (name, h = html) => sfGroup(h, name);
  const g1 = g('Week 71'), g2 = g('Week 72'), g3 = g('Week 73'), g4 = g('Week 74'), g5 = g('Week 75'), g6 = g('Week 76'), g7 = g('Week 77');
  assert([g1, g2, g3, g4, g5, g6, g7].every(Boolean), 'SP54-L0: fixture check — all seven weeks rendered as groups');

  // placement: main row, then the note row, then the action row, inside ONE tbody
  const order = (grp) => [...grp.matchAll(/<tr class="([^"]*)"/g)].map(m => m[1].split(' ')[0]);
  assert(order(g1).join() === 'stand-row,stand-note,stand-act', `SP54-L1: a week with a note AND a payment action reads week row, note row, action row, in that order (got ${order(g1).join()})`);
  assert(order(g2).join() === 'stand-row,stand-note', 'SP54-L1b: a week with a note and NO action is week row then note row');
  assert(order(g4).join() === 'stand-row' && order(g5).join() === 'stand-row', 'SP54-L1c: no descriptor / an invalid descriptor: no note row at all');
  // columns: every row of every group sums to 4, the note row is colspan 4
  const sums = [g1, g2, g3, g4, g5, g6, g7].flatMap(grp => [...grp.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td\b([^>]*)>/g)].reduce((s, c) => s + Number((/colspan="(\d+)"/.exec(c[1]) || [, 1])[1]), 0)));
  assert(sums.length >= 9 && sums.every(n => n === 4), `SP54-L2: EVERY row, the note rows included, sums to 4 columns (rows ${sums.length}: ${[...new Set(sums)].join(',')})`);
  assert(/<tr class="stand-note has-act"><td colspan="4">/.test(g1) && /<tr class="stand-note"><td colspan="4">/.test(g2), 'SP54-L2b: the note row is a full-width colspan="4" cell; it carries has-act only when an action row follows (the join)');
  // has-note only when a note exists; has-act stays SP-56's
  assert(/<tr class="stand-row has-note">/.test(g1) && /<tr class="stand-row has-note">/.test(g2) && !/has-note/.test(g4) && !/has-note/.test(g5), 'SP54-L3: the main row carries has-note ONLY when a note row follows it');
  // the words
  assert(/<p class="tie-note">Tie: Kevin won\. Notre Dame covered, USC did not cover<\/p>/.test(g1) && /<p class="tie-note">Tie: Koby is last on the Extra Point\. Busted at 57 yd<\/p>/.test(g1),
    'SP54-L4: week 71 reads "Tie: Kevin won. Notre Dame covered, USC did not cover" and "Tie: Koby is last on the Extra Point. Busted at 57 yd" (the named form)');
  assert((g2.match(/class="tie-note"/g) || []).length === 1 && /Tie: Dead heat between Kevin and Koby on every tiebreaker\. Settled by the week's draw\./.test(g2), 'SP54-L4b: a draw whose two ends name the same two players is printed ONCE');
  assert(/by tiebreaker/.test(g4) && !/tie-note/.test(g4), 'SP54-L4c: a week with no descriptor keeps today\'s `by tiebreaker` sub-caption and gets no note');
  assert(!/by tiebreaker/.test(g1), 'SP54-L4d: where the note explains the tie, the winner cell keeps no `by tiebreaker` of its own');
  // the blind rule and the money record
  assert(!/tie-note/.test(g6), 'SP54-L5: a CONFLICTED row (two active obligations) gets no note');
  assert(!/tie-note|stand-note/.test(g7) && !/has-note/.test(g7), 'SP54-L5b: an IN-PROGRESS (live) week carries NO note row and no has-note, whatever descriptor its stored rows hold (the note rides "not in progress")');
  // escaping and constant-led text
  assert(!/<img/i.test(g3) && /&lt;img/.test(g3) && /<p class="tie-note">Tie: /.test(g3), 'SP54-L6: a hostile display name and a hostile school come out ESCAPED in the note, and the line begins with a fixed constant');
  assert(!/(title|aria-label|data-[a-z-]+)="[^"]*(Tie:|onerror|HYPERLINK)/i.test(html), 'SP54-L6b: no descriptor field reaches an attribute');
  // viewers: a bystander sees the same notes; a signed-out visitor too (the reason is public once the week is final); only the payer has an action row
  const by = sfRender(bystander), out = sfRender(anon);
  assert(/Tie: Kevin won\./.test(sfGroup(by, 'Week 71')) && /Tie: Kevin won\./.test(sfGroup(out, 'Week 71')), 'SP54-L7: a bystander and a signed-out visitor see the note (a settled week\'s reason is public)');
  assert(sfBtns(g1).length >= 1 && sfBtns(sfGroup(by, 'Week 71')).length === 0, 'SP54-L7b: the payment action row is still the payer\'s alone, and it is still LAST in the group');
  // the 44pt payment row is untouched by the note
  assert(/\.stand-act-row \.btn\{min-height:44px/.test(sfCssSrc) && /\.stand-table \.stand-note td\{height:auto;padding:0 8px 8px;text-align:left\}/.test(sfCssSrc), 'SP54-L8: the 44 pt payment button rule is untouched and the note cell rule is in the stylesheet');
}

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
