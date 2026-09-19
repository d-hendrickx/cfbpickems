/**
 * CFB Pickems — ordertest.mjs
 * ===========================
 * CHRONOLOGICAL ORDER SUITE — one question, asked of every surface that
 * renders a list of games:
 *
 *   "Do the games appear in absolute kickoff order, across calendar days?"
 *
 * Reported by Drew, commissioner, 2026-09-03, verbatim:
 *
 *   "the dashboard is ordering the games by time regardless of day, so friday
 *    evening games are at the bottom after saturday morning games, this needs
 *    to be truly chronological"
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT ASSERTS ON MARKUP
 * --------------------------------------------------------
 * Every `.sort()` on a game list in this app compares `new Date(kickoff)` —
 * absolute instants — and every one of them is correct in isolation. A suite
 * that exercised those comparators would have gone green while the page stayed
 * wrong, because the defect is not in a comparator: it is a RENDER-LAYER
 * regrouping that happens AFTER the correct sort and throws its result away.
 *
 * So every ordering assertion below reads the ORDER OF TEAM NAMES IN THE
 * EMITTED HTML, driven end-to-end through `window.navigateTo(...)`, which is
 * the same entry point the bottom nav uses. Nothing here trusts a helper.
 *
 * THE FIXTURE
 * -----------
 * A genuine multi-day slate, matching the shape of Drew's live Sep 3–7 week
 * (the slate builder deliberately pulls Thursday/Friday and Sunday games in):
 *
 *     thu    Thu Sep 3, 7:30 PM CT   -> window "evening"
 *     fri    Fri Sep 4, 7:00 PM CT   -> window "evening"
 *     satam  Sat Sep 5, 11:00 AM CT  -> window "morning"
 *     satpm  Sat Sep 5, 7:00 PM CT   -> window "evening"
 *     sun    Sun Sep 6, 12:00 PM CT  -> window "afternoon"
 *
 * True chronological order is thu, fri, satam, satpm, sun. Note that the
 * time-of-day windows and the calendar days DISAGREE about the order — that
 * disagreement is the entire point of the fixture. Games are written to
 * storage in a shuffled order so nothing can pass by accident of insertion.
 *
 * Section [6] adds a SINGLE-DAY slate. On a one-Saturday slate, window order
 * and kickoff order coincide, which is exactly why this defect survived a
 * full season unnoticed — and why the fix must leave that case untouched.
 *
 * Run:  node ordertest.mjs
 * Also: TZ=UTC node ordertest.mjs && TZ=America/Los_Angeles node ordertest.mjs
 *       (RG-38 — an ordering defect keyed on dates is precisely the kind that
 *        reproduces in one zone and not the other. The league convention for
 *        day/window bucketing is America/Chicago, pinned; the rendered order
 *        must be byte-identical under both zones.)
 */

// ── DOM / browser stubs (same shape as loadtest.mjs / orienttest.mjs) ─────────
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
globalThis.fetch = async () => { throw new Error('network disabled in ordertest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const storage  = await import('./js/storage.js');
const provider = await import('./js/data-provider.js');
const app      = await import('./js/app.js');

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

// CT is UTC−5 (CDT) in September 2026.
const MULTI_DAY_SLOTS = [
  ['thu',   'ThuHome',   'ThuAway',   '2026-09-04T00:30:00Z'], // Thu Sep 3,  7:30 PM CT
  ['fri',   'FriHome',   'FriAway',   '2026-09-05T00:00:00Z'], // Fri Sep 4,  7:00 PM CT
  ['satam', 'SatAmHome', 'SatAmAway', '2026-09-05T16:00:00Z'], // Sat Sep 5, 11:00 AM CT
  ['satpm', 'SatPmHome', 'SatPmAway', '2026-09-06T00:00:00Z'], // Sat Sep 5,  7:00 PM CT
  ['sun',   'SunHome',   'SunAway',   '2026-09-06T17:00:00Z'], // Sun Sep 6, 12:00 PM CT
];

// One ordinary Saturday. Window order and kickoff order coincide here.
const SINGLE_DAY_SLOTS = [
  ['s_am',   'SamHome',  'SamAway',  '2026-09-05T16:00:00Z'], // 11:00 AM CT — morning
  ['s_noon', 'SnoonHome','SnoonAway','2026-09-05T20:00:00Z'], //  3:00 PM CT — afternoon
  ['s_eve',  'SeveHome', 'SeveAway', '2026-09-06T00:00:00Z'], //  7:00 PM CT — evening
  ['s_late', 'SlateHome','SlateAway','2026-09-06T02:30:00Z'], //  9:30 PM CT — late
];

const mkGame = (weekId, key, home, away, isoUTC) => ({
  gameId: `${weekId}_${key}`, weekId, espnEventId: null,
  dataQuality: 'manual', dataSource: 'manual',
  homeTeam: home, awayTeam: away, homeConference: 'SEC', awayConference: 'SEC',
  homeRank: null, awayRank: null,
  kickoff: isoUTC, kickoffConfirmed: true, kickoffDateOnly: false,
  // Derived exactly the way data-provider.js derives it when a game is fetched,
  // so the fixture cannot disagree with production about which bucket a game
  // belongs to.
  timeWindow: provider.getTimeWindow(isoUTC),
  spread: -3.5, favorite: home, lockedSpread: null,
  homeScore: null, awayScore: null, status: 'scheduled',
  actualWinner: null, atsWinner: null, isAlmaMaterGame: false,
  spreadSource: 'manual', oddsProvider: null, lastUpdated: null,
  venue: null, venueDisplay: null, neutralSite: false,
});

/**
 * Seed one week. `picksFor` decides which players have submitted, which in
 * turn decides which render path the picks page takes:
 *   - viewer HAS submitted  -> renderSubmittedView (read-only list)
 *   - viewer has NOT         -> renderGamesList    (the editable list)
 * Both are asserted below; they are different code paths over the same data.
 *
 * `shuffle` is the storage write order. It is deliberately NOT chronological.
 */
function seedWeek({ weekId, weekNumber, status, slots, picksFor, shuffle }) {
  storage.saveWeek({
    weekId, weekNumber, seasonYear: 2026, name: `Week ${weekNumber}`, status,
    startDate: '2026-09-03', endDate: '2026-09-07', dataSourceMode: 'live',
    picksOpenAt: null, picksLockAt: null,
    tiebreakerQuestion: 'Total points in the last game?',
    actualTiebreakerValue: null, showInHistory: true, blurb: null,
  });
  const games = slots.map(([k, h, a, t]) => mkGame(weekId, k, h, a, t));
  for (const i of shuffle) storage.saveGame(games[i]);
  if (picksFor.length) {
    storage.saveAllPicks(games.flatMap(g => picksFor.map(pid => ({
      pickId: `pk_${pid}_${g.gameId}`, weekId, gameId: g.gameId, playerId: pid,
      selectedTeam: g.homeTeam, submittedAt: '2026-09-03T00:00:00Z',
    }))));
  }
  return games;
}

storage.setBackendMode('local');
storage.addPlayer({ playerId: 'p1', displayName: 'Drew',    active: true, almaMater: 'Oklahoma',  preferences: {} });
storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true, almaMater: 'Texas A&M', preferences: {} });

// w_dash — LIVE, so picks are public and the full matrix renders for a player.
seedWeek({ weekId: 'w_dash', weekNumber: 1, status: 'live',
           slots: MULTI_DAY_SLOTS, picksFor: ['p1', 'p2'], shuffle: [3, 0, 4, 2, 1] });
// w_pick — OPEN, and p1 has NOT submitted, so the EDITABLE picks list renders.
seedWeek({ weekId: 'w_pick', weekNumber: 2, status: 'open',
           slots: MULTI_DAY_SLOTS, picksFor: ['p2'], shuffle: [4, 1, 3, 0, 2] });
// w_sub — OPEN, p1 HAS submitted, so the read-only submitted list renders.
seedWeek({ weekId: 'w_sub', weekNumber: 3, status: 'open',
           slots: MULTI_DAY_SLOTS, picksFor: ['p1', 'p2'], shuffle: [2, 4, 0, 3, 1] });
// w_sat — a single ordinary Saturday, editable. The common case that must not move.
seedWeek({ weekId: 'w_sat', weekNumber: 4, status: 'open',
           slots: SINGLE_DAY_SLOTS, picksFor: ['p2'], shuffle: [2, 0, 3, 1] });

storage.setSession('p1', false, true);

// ── Order extraction ─────────────────────────────────────────────────────────
// Reads the ORDER OF THE RENDERED MARKUP, not a data structure. Home team
// names are unique per slot and appear exactly once per game, so first-index
// position is an unambiguous proxy for render order.
const MULTI_KEYS = MULTI_DAY_SLOTS.map(s => s[0]);
const SINGLE_KEYS = SINGLE_DAY_SLOTS.map(s => s[0]);
const HOME_OF = Object.fromEntries([...MULTI_DAY_SLOTS, ...SINGLE_DAY_SLOTS].map(([k, h]) => [k, h]));

function renderedOrder(html, keys) {
  return keys
    .map(k => ({ k, i: html.indexOf(HOME_OF[k]) }))
    .filter(x => x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map(x => x.k);
}
const seq = a => a.join(' → ');

const TRUE_MULTI  = ['thu', 'fri', 'satam', 'satpm', 'sun'];
const TRUE_SINGLE = ['s_am', 's_noon', 's_eve', 's_late'];

// Drive a page the way the bottom nav does, and hand back what landed in the DOM.
function renderPage(tab, weekId, hostId) {
  storage.setActiveWeekId(weekId);
  els.get(hostId)._html = '';
  window.navigateTo(tab);
  return els.get(hostId)._html;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] FIXTURE INTEGRITY — the fixture must actually contain the conflict…');
// ─────────────────────────────────────────────────────────────────────────────
{
  const win = Object.fromEntries(MULTI_DAY_SLOTS.map(([k, , , t]) => [k, provider.getTimeWindow(t)]));
  assert(win.fri === 'evening' && win.satam === 'morning',
    '1a: the Friday game is in the "evening" window and the Saturday game is in "morning" — the exact pair Drew named');

  const ms = k => new Date(MULTI_DAY_SLOTS.find(s => s[0] === k)[3]).getTime();
  assert(ms('fri') < ms('satam'),
    '1b: Friday evening genuinely PRECEDES Saturday morning as an absolute instant — so any correct render must place it above');

  const days = new Set(MULTI_DAY_SLOTS.map(([, , , t]) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', dateStyle: 'short' }).format(new Date(t))));
  assert(days.size === 4, `1c: fixture spans 4 distinct Central calendar days (Thu/Fri/Sat/Sun), got ${days.size}`);

  const stored = storage.getGames('w_pick').map(g => g.gameId.replace('w_pick_', ''));
  assert(seq(stored) !== seq(TRUE_MULTI),
    `1d: storage order (${seq(stored)}) is NOT chronological — nothing below can pass by accident of insertion order`);

  const singleWin = SINGLE_DAY_SLOTS.map(([, , , t]) => provider.getTimeWindow(t));
  assert(seq(singleWin) === seq(['morning', 'afternoon', 'evening', 'late']),
    '1e: the single-day fixture walks morning→afternoon→evening→late, so window order and kickoff order coincide there');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] DASHBOARD — standard matrix, rendered end-to-end via navigateTo…');
// ─────────────────────────────────────────────────────────────────────────────
{
  storage.saveSetting('dashboardLayout', 'standard');
  const html = renderPage('dashboard', 'w_dash', 'page-dashboard');
  const order = renderedOrder(html, MULTI_KEYS);
  assert(order.length === 5, `2a: all 5 games reached the standard matrix (got ${order.length})`);
  assert(seq(order) === seq(TRUE_MULTI),
    `2b: standard matrix renders in true chronological order — expected ${seq(TRUE_MULTI)}, got ${seq(order)}`);
  assert(order.indexOf('fri') < order.indexOf('satam'),
    '2c: standard matrix — Friday evening renders ABOVE Saturday morning');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] DASHBOARD — compact chips, rendered end-to-end via navigateTo…');
// ─────────────────────────────────────────────────────────────────────────────
{
  storage.saveSetting('dashboardLayout', 'compact');
  const html = renderPage('dashboard', 'w_dash', 'page-dashboard');
  const order = renderedOrder(html, MULTI_KEYS);
  assert(order.length === 5, `3a: all 5 games reached the compact layout (got ${order.length})`);
  assert(seq(order) === seq(TRUE_MULTI),
    `3b: compact layout renders in true chronological order — expected ${seq(TRUE_MULTI)}, got ${seq(order)}`);
  assert(order.indexOf('fri') < order.indexOf('satam'),
    '3c: compact layout — Friday evening renders ABOVE Saturday morning');
  storage.saveSetting('dashboardLayout', 'standard');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] PICKS PAGE — the editable list (renderGamesList). THE REPRODUCTION…');
// ─────────────────────────────────────────────────────────────────────────────
{
  const html = renderPage('picks', 'w_pick', 'games-list');
  const order = renderedOrder(html, MULTI_KEYS);
  assert(order.length === 5, `4a: all 5 games reached the editable picks list (got ${order.length})`);
  assert(order.indexOf('fri') < order.indexOf('satam'),
    '4b: THE REPORTED BUG — a Friday evening game renders ABOVE a Saturday morning game');
  assert(seq(order) === seq(TRUE_MULTI),
    `4c: editable picks list renders in true chronological order — expected ${seq(TRUE_MULTI)}, got ${seq(order)}`);
  assert(order.indexOf('thu') === 0,
    `4d: the Thursday game — the earliest kickoff on the slate — renders FIRST, not buried mid-list (got position ${order.indexOf('thu')})`);
  assert(order.indexOf('sun') === order.length - 1,
    `4e: the Sunday game — the latest kickoff on the slate — renders LAST (got position ${order.indexOf('sun')})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] PICKS PAGE — the submitted (read-only) list, same week shape…');
// ─────────────────────────────────────────────────────────────────────────────
{
  // CONVENTIONS #21 — the picks tab has TWO render paths over the same slate.
  // A fix that corrects one and misses the other is the documented failure
  // shape in this repo, so both are asserted, always.
  const html = renderPage('picks', 'w_sub', 'submitted-games');
  const order = renderedOrder(html, MULTI_KEYS);
  assert(order.length === 5, `5a: all 5 games reached the submitted list (got ${order.length})`);
  assert(seq(order) === seq(TRUE_MULTI),
    `5b: submitted list renders in true chronological order — expected ${seq(TRUE_MULTI)}, got ${seq(order)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] SINGLE-DAY SLATE — the common case must not move…');
// ─────────────────────────────────────────────────────────────────────────────
{
  const html = renderPage('picks', 'w_sat', 'games-list');
  const order = renderedOrder(html, SINGLE_KEYS);
  assert(order.length === 4, `6a: all 4 games reached the list (got ${order.length})`);
  assert(seq(order) === seq(TRUE_SINGLE),
    `6b: an ordinary one-Saturday slate still renders morning→afternoon→evening→late — expected ${seq(TRUE_SINGLE)}, got ${seq(order)}`);
  const labels = (html.match(/time-window-label"[^>]*>([^<]*)/g) || []).map(s => s.split('>').pop().trim());
  assert(seq(labels) === seq(['🌅 Morning', '☀️ Afternoon', '🌆 Evening', '🌙 Late Night']),
    `6c: the four window headers are unchanged and in order on a single-day slate — got ${seq(labels)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] CROSS-SURFACE CONSISTENCY — every surface agrees on one order…');
// ─────────────────────────────────────────────────────────────────────────────
{
  storage.saveSetting('dashboardLayout', 'standard');
  const dashStd = renderedOrder(renderPage('dashboard', 'w_dash', 'page-dashboard'), MULTI_KEYS);
  storage.saveSetting('dashboardLayout', 'compact');
  const dashCmp = renderedOrder(renderPage('dashboard', 'w_dash', 'page-dashboard'), MULTI_KEYS);
  storage.saveSetting('dashboardLayout', 'standard');
  const picksEd = renderedOrder(renderPage('picks', 'w_pick', 'games-list'), MULTI_KEYS);
  const picksRo = renderedOrder(renderPage('picks', 'w_sub', 'submitted-games'), MULTI_KEYS);

  assert(seq(dashStd) === seq(dashCmp),
    `7a: the two dashboard layouts agree — ${seq(dashStd)} vs ${seq(dashCmp)}`);
  assert(seq(dashStd) === seq(picksEd),
    `7b: the dashboard and the editable picks list agree — ${seq(dashStd)} vs ${seq(picksEd)}`);
  assert(seq(picksEd) === seq(picksRo),
    `7c: the editable and submitted picks lists agree — ${seq(picksEd)} vs ${seq(picksRo)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] ORDER IS INDEPENDENT OF STORAGE ORDER — shuffle battery…');
// ─────────────────────────────────────────────────────────────────────────────
{
  // RG-06's shuffle-test discipline: if the rendered order is genuinely derived
  // from kickoff, no write order can perturb it. Ten deterministic permutations.
  const perms = [
    [0,1,2,3,4],[4,3,2,1,0],[2,0,4,1,3],[1,4,0,3,2],[3,2,1,4,0],
    [0,4,1,2,3],[2,3,0,4,1],[4,0,3,1,2],[1,2,4,0,3],[3,1,4,2,0],
  ];
  let allGood = true, firstBad = null;
  perms.forEach((p, n) => {
    const weekId = `w_shuf_${n}`;
    seedWeek({ weekId, weekNumber: 10 + n, status: 'open',
               slots: MULTI_DAY_SLOTS, picksFor: ['p2'], shuffle: p });
    const order = renderedOrder(renderPage('picks', weekId, 'games-list'), MULTI_KEYS);
    if (seq(order) !== seq(TRUE_MULTI)) { allGood = false; firstBad ??= `perm ${n} [${p}] -> ${seq(order)}`; }
  });
  assert(allGood,
    `8a: all 10 storage permutations render the same chronological order${allGood ? '' : ' — first failure: ' + firstBad}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] TIMEZONE PINNING — the rendered order is a property of the data, not the device…');
// ─────────────────────────────────────────────────────────────────────────────
{
  // RG-38. This process can only observe ONE zone, so the assertion is that the
  // order matches the SAME constant regardless of which zone is running. The
  // protocol runs the file under TZ=UTC and TZ=America/Los_Angeles; if the two
  // runs disagree, one of them fails here.
  const order = renderedOrder(renderPage('picks', 'w_pick', 'games-list'), MULTI_KEYS);
  assert(seq(order) === seq(TRUE_MULTI),
    `9a: under TZ=${process.env.TZ || '(system default)'} the picks list is ${seq(TRUE_MULTI)} — got ${seq(order)}`);

  const dashOrder = renderedOrder(renderPage('dashboard', 'w_dash', 'page-dashboard'), MULTI_KEYS);
  assert(seq(dashOrder) === seq(TRUE_MULTI),
    `9b: under TZ=${process.env.TZ || '(system default)'} the dashboard is ${seq(TRUE_MULTI)} — got ${seq(dashOrder)}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
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
