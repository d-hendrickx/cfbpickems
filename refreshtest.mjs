/**
 * refreshtest.mjs — the auto-refresh interval actually takes effect.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * fb_1788025448083_fuvk2 (v0.17.7): "The scores don't seem to be refreshing at
 * the time interval that is selected. I have to manually hit refresh scores for
 * it to update."
 *
 * The setting existed (Off / 30s / 60s / 5min) and setupAutoRefresh() armed a
 * setInterval from it — so at first glance nothing was wrong. The defect was in
 * the tick body: it returned early on ANY tab except 'dashboard'
 * (`if (state.currentTab !== 'dashboard') return;`) BEFORE ever calling
 * doRefreshScores(). A player or the commissioner sitting on the Picks tab
 * during a live window therefore got ZERO auto-fetches and had to hit the
 * dashboard's "Refresh Scores" button by hand — exactly the report.
 *
 * That gate also contradicts the live-polling contract in CLAUDE.md:
 * "Live scoring: 60-second polling loop … only runs on non-demo weeks" — NOT
 * "only on the dashboard tab."
 *
 * ROOT CAUSE (single, not two): the tab gate sat in front of the DATA fetch
 * instead of in front of the RE-RENDER. Fix: the interval callback is extracted
 * to the exported runAutoRefreshTick(); the demo/manual guards stay, but the
 * fetch now runs on every non-demo/non-manual week regardless of active tab.
 * Only the wholesale dashboard re-render stays tab-scoped. (The Picks-tab live
 * render is DI-2, feature-builder's — deliberately NOT done here, since a full
 * renderPicksPage() every interval would wipe a player's in-progress edits.)
 *
 * WHAT THIS FILE ASSERTS
 *   [1] runAutoRefreshTick() fetches on Picks / dashboard / any tab — the bug.
 *   [2] demo and fully-manual weeks still never fetch — the guard is intact.
 *   [3] setupAutoRefresh() arms exactly one timer, re-arms without stacking a
 *       duplicate, and honors "Off" (interval 0) by arming none.
 *
 * NOT covered here (browser-only): that a live ESPN response actually paints
 * new scores on screen, and DI-2's Picks-tab quarter/clock render. This file
 * proves the TIMER and DATA-FETCH plumbing; rendering pixels needs a browser.
 *
 * DOM / localStorage stubs mirror the almatest.mjs / slatetest.mjs shape.
 */

// ── DOM / localStorage stubs ────────────────────────────────────────────────
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
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
  };
  return e;
}
function bySelector(sel) {
  if (typeof sel === 'string' && sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const set = selectorSets.get(sel);
  return set && set.length ? set[0] : null;
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__el__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
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
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// ── fetch spy: any call means the auto-refresh actually reached ESPN ─────────
let fetchCalls = [];
function installFetchSpy() {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ events: [] }) };
  };
}

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const dm = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');

const { WEEK_STATUS, GAME_STATUS } = dm;
const { runAutoRefreshTick, setupAutoRefresh, state } = app;

console.log('[refreshtest] app.js exports —', Object.keys(app).length);
assert(typeof runAutoRefreshTick === 'function', 'fixture check: runAutoRefreshTick() is exported (extracted for direct testability)');
assert(typeof setupAutoRefresh === 'function', 'fixture check: setupAutoRefresh() is exported');

// ── Fixtures ────────────────────────────────────────────────────────────────
function liveWeek(o = {}) {
  return {
    weekId: 'rw1', weekNumber: 1, label: 'Week 1', season: 2026,
    status: WEEK_STATUS.LIVE, dataSourceMode: 'espn_live',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    ...o,
  };
}
function refreshableGame(o = {}) {
  return {
    gameId: 'rg1', weekId: 'rw1',
    homeTeam: 'Home', awayTeam: 'Away', homeMascot: '', awayMascot: '',
    kickoff: '2026-09-08T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread: -3, favorite: 'Home', lockedSpread: -3,
    homeScore: 7, awayScore: 3,
    status: GAME_STATUS.IN_PROGRESS ?? 'in_progress', actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_live', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: '401520100', espnSport: 'college-football',
    ...o,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The reported bug: the interval fetches regardless of active tab…');
{
  // ── Picks tab — this is where the reporter sat during the live window ──
  localStorage.clear();
  storage.saveWeek(liveWeek());
  storage.saveGame(refreshableGame());
  installFetchSpy();
  state.currentTab = 'picks';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0,
    'ON THE PICKS TAB, a live-week tick reaches ESPN — the exact fb_1788025448083 scenario. Before the fix the tab gate returned early here and fetchCalls stayed empty.');

  // ── Dashboard — the one tab that always worked (control) ──
  installFetchSpy();
  state.currentTab = 'dashboard';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0, 'on the dashboard the tick still fetches (control — this never regressed)');

  // ── Any other tab (rules) — data freshness is not tab-specific ──
  installFetchSpy();
  state.currentTab = 'rules';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0, 'on an unrelated tab (rules) the DATA still refreshes — the live poll runs per the "non-demo weeks" contract, not per tab');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Guards preserved: simulated/commissioner-entered weeks never fetch…');
{
  // Demo week — must not be walked over by live ESPN.
  localStorage.clear();
  storage.saveWeek(liveWeek({ dataSourceMode: 'demo' }));
  storage.saveGame(refreshableGame());
  installFetchSpy();
  state.currentTab = 'picks';
  await runAutoRefreshTick();
  assert(fetchCalls.length === 0, 'a DEMO week never auto-fetches, on any tab (would clobber the simulation — "demo resets after a few seconds")');

  // Fully-manual week — commissioner enters scores by hand.
  localStorage.clear();
  storage.saveWeek(liveWeek({ dataSourceMode: 'manual' }));
  storage.saveGame(refreshableGame());
  installFetchSpy();
  state.currentTab = 'dashboard';
  await runAutoRefreshTick();
  assert(fetchCalls.length === 0, 'a fully-MANUAL week never auto-fetches (would overwrite hand-entered scores)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Timer lifecycle: one timer, re-armed cleanly, "Off" honored…');
{
  // Fake timer registry so we can count LIVE (armed-and-not-cleared) intervals.
  const live = new Map();     // handle -> period(ms)
  let nextHandle = 1;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => { const h = nextHandle++; live.set(h, ms); return h; };
  globalThis.clearInterval = (h) => { live.delete(h); };

  try {
    localStorage.clear();
    // A live week so the immediate tickAutoTransition() inside setupAutoRefresh
    // has something to read without throwing.
    storage.saveWeek(liveWeek());
    storage.saveGame(refreshableGame());

    storage.saveSetting('autoRefreshInterval', 30);
    setupAutoRefresh();
    assert(live.size === 1, 'interval 30s → exactly ONE timer armed');
    assert([...live.values()][0] === 30000, 'the armed timer fires every 30s (30 × 1000ms) — the SELECTED interval, not a hardcoded default');

    // Re-arm (what a second interval-setting save, or a re-boot, does).
    storage.saveSetting('autoRefreshInterval', 60);
    setupAutoRefresh();
    assert(live.size === 1, 're-arming clears the old timer first — no stacked/duplicate intervals (the leak guard)');
    assert([...live.values()][0] === 60000, 'the surviving timer now uses the NEW 60s interval');

    // "Off".
    storage.saveSetting('autoRefreshInterval', 0);
    setupAutoRefresh();
    assert(live.size === 0, '"Off" (interval 0) arms NO timer and clears any prior one');
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n[refreshtest] ${pass} passed, ${fail} failed`);
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
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));

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
