/**
 * CFB Pickems — spreadlocktest.mjs
 * =================================
 * Item SS — spread-sign RUNTIME lock-site validation. Approved by Drew,
 * 2026-09-10. Companion to `spreadsigntest.mjs` (the structural SOURCE
 * scan, shipped separately) — this file drives the REAL lock-time paths
 * end to end and asserts on the ACTUAL VALUE frozen (or refused) at the
 * moment a week reaches LOCKED, not on the shape of the source that writes
 * it.
 *
 * Run:  node spreadlocktest.mjs
 * Also: TZ=UTC node spreadlocktest.mjs && TZ=America/Los_Angeles node spreadlocktest.mjs
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * `game.spread` / `game.lockedSpread` is a SIGNED number from the HOME
 * team's perspective (AD-03). Both places a week can reach LOCKED —
 * `applyWeekStatusChange()` (manual, the commissioner's Week-tab button) and
 * `tickAutoTransition()` (auto, a background timer, RG-52/53's own
 * two-call-sites-must-agree lesson) — freeze the live `spread` into
 * `lockedSpread` at that instant. RG-54 already proved this codebase CAN
 * ship a spread whose sign disagrees with its own recorded `favorite`
 * (dg8's `spread:-2.5`/`favorite:'Alabama'`, live from authorship until
 * 2026-08-27). If that ever happens again and reaches a LOCK unnoticed, the
 * wrong sign freezes permanently and grades real money wrong
 * (`calculateAtsWinner()` reads `lockedSpread`, never the live `spread`,
 * once a week is past OPEN).
 *
 * This file proves BOTH lock sites now REFUSE to freeze a spread whose sign
 * contradicts its own favorite — loud-fail (AD-06) per-game, not a silent
 * freeze and not an abort of the whole week's lock — via the shared
 * `isSpreadSignConsistentWithFavorite()` helper `app.js` exports so the two
 * sites cannot independently drift on what "consistent" means.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / localStorage stubs (almatest.mjs shape — registered elements that
//    remember listeners, so the REAL `.week-status-btn` click handler can be
//    driven end to end, including its loud-fail toast) ─────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
const selectorSets = new Map();
let lastToasts = [];

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
    appendChild(child) { if (id === 'toast-container') lastToasts.push(child.innerHTML); },
    removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`spreadlocktest: nothing bound to '${type}' on #${id}`);
      for (const fn of fns) fn({ target: e, ...ev });
    },
  };
  return e;
}
function el(id) { if (!registry.has(id)) registry.set(id, makeEl(id)); return registry.get(id); }
function bySelector(sel) {
  if (typeof sel === 'string' && sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const set = selectorSets.get(sel);
  return set && set.length ? set[0] : null;
}
function resetDom() { registry.clear(); selectorSets.clear(); lastToasts = []; }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__toast__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
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
globalThis.fetch = async () => { throw new Error('network disabled in spreadlocktest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const {
  applyWeekStatusChange, tickAutoTransition, isSpreadSignConsistentWithFavorite,
  bindCommEventListeners,
} = app;

console.log('[spreadlocktest] app.js exports —', Object.keys(app).length);
assert(typeof isSpreadSignConsistentWithFavorite === 'function',
  'fixture check: isSpreadSignConsistentWithFavorite() is exported from app.js — the shared helper genuinely exists');

let _wid = 0;
function freshWeek(o = {}) {
  _wid++;
  return {
    weekId: `slw${_wid}`, weekNumber: _wid, label: `Week ${_wid}`, season: 2026,
    status: 'open', dataSourceMode: 'espn_historical',
    startDate: '2026-09-08', endDate: '2026-09-08',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    autoLiveEnabled: false, autoFinalizeEnabled: false,
    ...o,
  };
}
let _gid = 0;
function freshGame(o = {}) {
  _gid++;
  return {
    gameId: `slg${_gid}`, weekId: 'slw1',
    homeTeam: 'Home', awayTeam: 'Away', homeMascot: '', awayMascot: '',
    homeConference: '', awayConference: '', homeRank: null, awayRank: null,
    kickoff: '2026-09-08T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread: null, favorite: null, lockedSpread: null,
    homeScore: null, awayScore: null,
    status: 'scheduled', actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, nationalTV: false, broadcastNetwork: null, marqueeEvent: false,
    multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_historical', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: null,
    ...o,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] isSpreadSignConsistentWithFavorite() — the shared helper, every combination…');
{
  const HOME = 'Home', AWAY = 'Away';
  const g = (spread, favorite) => ({ homeTeam: HOME, awayTeam: AWAY, spread, favorite });

  assert(isSpreadSignConsistentWithFavorite(g(-3, HOME)) === true,
    'home favored + negative spread (correct AD-03 sign) = CONSISTENT');
  assert(isSpreadSignConsistentWithFavorite(g(3, HOME)) === false,
    'home favored + POSITIVE spread (contradicts AD-03 sign) = CONTRADICTION — the exact dg8/RG-54 shape');
  assert(isSpreadSignConsistentWithFavorite(g(3, AWAY)) === true,
    'away favored + positive spread (correct AD-03 sign) = CONSISTENT');
  assert(isSpreadSignConsistentWithFavorite(g(-3, AWAY)) === false,
    'away favored + NEGATIVE spread (contradicts AD-03 sign) = CONTRADICTION');

  assert(isSpreadSignConsistentWithFavorite(g(0, HOME)) === true,
    'PK (spread 0) WITH a favorite recorded is still consistent — 0 asserts no sign either way, per the approved spec');
  assert(isSpreadSignConsistentWithFavorite(g(0, null)) === true,
    'PK (spread 0) with NO favorite is consistent');
  assert(isSpreadSignConsistentWithFavorite(g(-7, null)) === true,
    'no favorite resolved at all: never blocked, regardless of spread sign — absence of a favorite is not a contradiction');
  assert(isSpreadSignConsistentWithFavorite(g(null, HOME)) === true,
    'spread null (nothing to freeze yet): never blocked');
  assert(isSpreadSignConsistentWithFavorite({ ...g(-3, HOME), spread: undefined }) === true,
    'spread undefined: never blocked');
  assert(isSpreadSignConsistentWithFavorite(g(-4, 'Neither Team')) === true,
    "favorite names neither homeTeam nor awayTeam: can't determine an expected sign, so don't block on it");
  assert(isSpreadSignConsistentWithFavorite(null) === true,
    'a null game itself is handled without throwing, and treated as consistent (nothing to check)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] applyWeekStatusChange(week, \'locked\') — CONSISTENT spreads freeze normally (both home- and away-favored)…');
{
  localStorage.clear();
  const week = freshWeek({ weekId: 'sl2', status: 'open' });
  storage.saveWeek(week);
  const gHome = freshGame({ weekId: 'sl2', gameId: 'sl2_home', homeTeam: 'Ohio State', awayTeam: 'Texas', spread: -3, favorite: 'Ohio State' });
  const gAway = freshGame({ weekId: 'sl2', gameId: 'sl2_away', homeTeam: 'Michigan', awayTeam: 'Alabama', spread: 2.5, favorite: 'Alabama' });
  storage.saveGame(gHome);
  storage.saveGame(gAway);

  const upd = applyWeekStatusChange(storage.getWeek('sl2'), 'locked');
  assert(upd.status === 'locked', 'fixture check: the week transitioned to locked');
  assert(Array.isArray(upd.spreadLockRefusals) && upd.spreadLockRefusals.length === 0,
    'no refusals reported for two fully consistent games (one home-favored, one away-favored)');
  assert(storage.getGame('sl2_home').lockedSpread === -3,
    'home-favored consistent game: lockedSpread frozen to the live spread, unchanged');
  assert(storage.getGame('sl2_away').lockedSpread === 2.5,
    'away-favored consistent game: lockedSpread frozen to the live spread, unchanged');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] applyWeekStatusChange(week, \'locked\') — a CONTRADICTORY spread is REFUSED, not frozen as-is; the rest of the slate still locks…');
{
  localStorage.clear();
  const week = freshWeek({ weekId: 'sl3', status: 'open' });
  storage.saveWeek(week);
  const gOk = freshGame({ weekId: 'sl3', gameId: 'sl3_ok', homeTeam: 'Georgia', awayTeam: 'Clemson', spread: -7.5, favorite: 'Georgia' });
  // Reproduces dg8's exact shape: favorite is the HOME team, but spread is
  // POSITIVE — under AD-03 that asserts the AWAY team is favored. Contradiction.
  const gBad = freshGame({ weekId: 'sl3', gameId: 'sl3_bad', homeTeam: 'Michigan', awayTeam: 'Alabama', spread: 2.5, favorite: 'Michigan' });
  storage.saveGame(gOk);
  storage.saveGame(gBad);

  const upd = applyWeekStatusChange(storage.getWeek('sl3'), 'locked');
  assert(upd.status === 'locked',
    'THE CHOSEN DESIGN: the WEEK still locks — one bad game does not hold five good ones hostage');
  assert(upd.spreadLockRefusals?.length === 1 && upd.spreadLockRefusals[0].gameId === 'sl3_bad',
    `the contradictory game is reported back on the returned week object (got ${JSON.stringify(upd.spreadLockRefusals?.map(g => g.gameId))})`);
  assert(storage.getGame('sl3_bad').lockedSpread === null,
    'THE REFUSAL: the contradictory game\'s lockedSpread is NEVER frozen to the wrong-signed value — left null rather than locking in a wrong grade');
  assert(storage.getGame('sl3_bad').spread === 2.5,
    'fixture check: the live spread itself is untouched by the refusal (only the FREEZE into lockedSpread is refused, not the live field)');
  assert(storage.getGame('sl3_ok').lockedSpread === -7.5,
    'the OTHER, consistent game in the same week still froze normally — the refusal is per-game, not per-week');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] THE LOUD-FAIL — the real \'.week-status-btn\' click handler surfaces a visible warning toast for a refused game, and does NOT lose the ordinary success toast…');
{
  localStorage.clear();
  resetDom();
  const week = freshWeek({ weekId: 'sl4', status: 'open' });
  storage.saveWeek(week);
  const gBad = freshGame({ weekId: 'sl4', gameId: 'sl4_bad', homeTeam: 'LSU', awayTeam: 'Florida State', spread: 4.5, favorite: 'LSU' });
  storage.saveGame(gBad);

  el('toast-container');
  const btn = el('week-status-btn-locked');
  btn.dataset.to = 'locked';
  selectorSets.set('.week-status-btn', [btn]);
  bindCommEventListeners(week, storage.getGames('sl4'), [], [], storage.getSettings(), [week], []);
  btn._fire('click');

  assert(storage.getWeek('sl4').status === 'locked', 'fixture check: the real click handler drove the transition through to storage');
  assert(storage.getGame('sl4_bad').lockedSpread === null, 'fixture check: the refusal happened on the real click path too, not just the direct function call');
  assert(lastToasts.some(t => /Week: locked/.test(t)), 'the ORDINARY success toast ("Week: locked") still fires — the warning is additive, not a replacement');
  assert(lastToasts.some(t => /NOT locked/.test(t) && /LSU/.test(t) && /Florida State/.test(t)),
    `a SEPARATE, visible warning toast names the refused game (got toasts: ${JSON.stringify(lastToasts)})`);
  assert(lastToasts.length >= 2, 'both toasts are distinct entries — the warning is not swallowed into or overwritten by the success toast');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] tickAutoTransition() — CONSISTENT spread freezes normally on the AUTO-lock leg…');
{
  localStorage.clear();
  resetDom();
  el('toast-container');
  const week = freshWeek({
    weekId: 'sl5', status: 'open', dataSourceMode: 'espn_historical',
    picksLockAt: new Date(Date.now() - 60 * 1000).toISOString(), // already past — auto-lock condition true
    autoLiveEnabled: false,
  });
  storage.saveWeek(week);
  const g = freshGame({ weekId: 'sl5', gameId: 'sl5_g1', homeTeam: 'Oklahoma', awayTeam: 'Houston', spread: -6, favorite: 'Oklahoma', kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  storage.saveGame(g);
  storage.setActiveWeekId('sl5');

  tickAutoTransition();

  assert(storage.getWeek('sl5').status === 'locked', 'fixture check: the auto-lock condition genuinely fired');
  assert(storage.getGame('sl5_g1').lockedSpread === -6, 'AUTO leg: a consistent spread freezes exactly like the manual leg does');
  assert(!lastToasts.some(t => /NOT frozen/.test(t)), 'no refusal warning fires when nothing was refused');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] tickAutoTransition() — a CONTRADICTORY spread is REFUSED on the AUTO-lock leg too, loudly, without a click handler wrapping it…');
{
  localStorage.clear();
  resetDom();
  el('toast-container');
  const week = freshWeek({
    weekId: 'sl6', status: 'open', dataSourceMode: 'espn_historical',
    picksLockAt: new Date(Date.now() - 60 * 1000).toISOString(),
    autoLiveEnabled: false,
  });
  storage.saveWeek(week);
  const gOk = freshGame({ weekId: 'sl6', gameId: 'sl6_ok', homeTeam: 'Penn State', awayTeam: 'West Virginia', spread: -17.5, favorite: 'Penn State', kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  // Same contradiction shape as [3]: favorite is home, spread is positive.
  const gBad = freshGame({ weekId: 'sl6', gameId: 'sl6_bad', homeTeam: 'Indiana', awayTeam: 'Purdue', spread: 7, favorite: 'Indiana', kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  storage.saveGame(gOk);
  storage.saveGame(gBad);
  storage.setActiveWeekId('sl6');

  tickAutoTransition();

  assert(storage.getWeek('sl6').status === 'locked',
    'THE CHOSEN DESIGN, mirrored on the auto leg: the week still auto-locks — the refusal is scoped to the one bad game');
  assert(storage.getGame('sl6_bad').lockedSpread === null,
    'THE REFUSAL: the contradictory game is NOT frozen on the auto-lock leg either');
  assert(storage.getGame('sl6_ok').lockedSpread === -17.5,
    'the other, consistent game in the same auto-locked week still froze normally');
  assert(lastToasts.some(t => /NOT frozen/.test(t) && /Indiana/.test(t) && /Purdue/.test(t)),
    `THE LOUD-FAIL: since no click handler wraps the auto-lock tick, tickAutoTransition() must surface its own warning toast (got toasts: ${JSON.stringify(lastToasts)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] PK and no-favorite games are NEVER blocked, at either lock site…');
{
  localStorage.clear();
  resetDom();
  el('toast-container');

  // 7a — manual site.
  const week7a = freshWeek({ weekId: 'sl7a', status: 'open' });
  storage.saveWeek(week7a);
  const pk = freshGame({ weekId: 'sl7a', gameId: 'sl7a_pk', spread: 0, favorite: null });
  const noFav = freshGame({ weekId: 'sl7a', gameId: 'sl7a_nofav', spread: -4, favorite: null });
  storage.saveGame(pk);
  storage.saveGame(noFav);
  const upd7a = applyWeekStatusChange(storage.getWeek('sl7a'), 'locked');
  assert(upd7a.spreadLockRefusals.length === 0, 'manual site: PK and no-favorite games produce zero refusals');
  assert(storage.getGame('sl7a_pk').lockedSpread === 0, 'manual site: PK (0) freezes normally');
  assert(storage.getGame('sl7a_nofav').lockedSpread === -4, 'manual site: a spread with no resolved favorite still freezes normally — absence is not a contradiction');

  // 7b — auto site.
  const week7b = freshWeek({
    weekId: 'sl7b', status: 'open', dataSourceMode: 'espn_historical',
    picksLockAt: new Date(Date.now() - 60 * 1000).toISOString(), autoLiveEnabled: false,
  });
  storage.saveWeek(week7b);
  const pk2 = freshGame({ weekId: 'sl7b', gameId: 'sl7b_pk', spread: 0, favorite: null, kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  const noFav2 = freshGame({ weekId: 'sl7b', gameId: 'sl7b_nofav', spread: 9, favorite: null, kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  storage.saveGame(pk2);
  storage.saveGame(noFav2);
  storage.setActiveWeekId('sl7b');
  tickAutoTransition();
  assert(storage.getWeek('sl7b').status === 'locked', 'fixture check: auto-lock fired');
  assert(storage.getGame('sl7b_pk').lockedSpread === 0, 'auto site: PK (0) freezes normally');
  assert(storage.getGame('sl7b_nofav').lockedSpread === 9, 'auto site: a spread with no resolved favorite still freezes normally on the auto leg too');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] THE TWO SITES CANNOT DRIFT — an identical contradictory fixture is refused IDENTICALLY by both, via the one shared helper…');
{
  const shapeOf = (g) => isSpreadSignConsistentWithFavorite(g);
  const contradictory = { homeTeam: 'Home', awayTeam: 'Away', spread: 5, favorite: 'Home' };
  const consistent    = { homeTeam: 'Home', awayTeam: 'Away', spread: -5, favorite: 'Home' };

  // 8a — behavioral: drive the SAME contradictory shape through both real
  // lock sites and confirm both refuse it, both leave lockedSpread null.
  localStorage.clear();
  const weekManual = freshWeek({ weekId: 'sl8m', status: 'open' });
  storage.saveWeek(weekManual);
  storage.saveGame(freshGame({ weekId: 'sl8m', gameId: 'sl8m_g', ...contradictory }));
  const updManual = applyWeekStatusChange(storage.getWeek('sl8m'), 'locked');

  const weekAuto = freshWeek({
    weekId: 'sl8a', status: 'open', dataSourceMode: 'espn_historical',
    picksLockAt: new Date(Date.now() - 60 * 1000).toISOString(), autoLiveEnabled: false,
  });
  storage.saveWeek(weekAuto);
  storage.saveGame(freshGame({ weekId: 'sl8a', gameId: 'sl8a_g', ...contradictory, kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() }));
  storage.setActiveWeekId('sl8a');
  tickAutoTransition();

  assert(updManual.spreadLockRefusals.length === 1 && storage.getGame('sl8m_g').lockedSpread === null,
    'manual site refuses the contradictory fixture');
  assert(storage.getGame('sl8a_g').lockedSpread === null,
    'auto site refuses the BYTE-IDENTICAL contradictory fixture too — same verdict');

  // 8b — structural: both call sites in the real source literally invoke the
  // SAME named helper, so a future edit to one cannot silently redefine
  // "consistent" without touching the other (RG-52/53's own lesson).
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const manualRegion = src.slice(src.indexOf('export function applyWeekStatusChange'), src.indexOf('export function tickAutoTransition'));
  const autoRegionStart = src.indexOf('export function tickAutoTransition');
  const autoRegion = src.slice(autoRegionStart, src.indexOf('\n// Item 2', autoRegionStart) > -1 ? src.indexOf('\n// Item 2', autoRegionStart) : autoRegionStart + 4000);
  // Strip // line comments and /* */ blocks first — a comment MENTIONING the
  // helper must not satisfy the "actually calls it" assertion (reviewer note:
  // the un-stripped regex passed on a comment even with the real call removed).
  const stripComments = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const manualCode = stripComments(manualRegion);
  const autoCode = stripComments(autoRegion);
  assert(/isSpreadSignConsistentWithFavorite\(/.test(manualCode),
    'THE SHARED HELPER: applyWeekStatusChange()\'s region calls isSpreadSignConsistentWithFavorite(...) [in code, not a comment]');
  assert(/isSpreadSignConsistentWithFavorite\(/.test(autoCode),
    'THE SHARED HELPER: tickAutoTransition()\'s region ALSO calls isSpreadSignConsistentWithFavorite(...) in code — the same function, not a re-derived copy');
  assert((manualRegion.match(/function\s+isSpreadSignConsistentWithFavorite/g) || []).length === 0
      && (autoRegion.match(/function\s+isSpreadSignConsistentWithFavorite/g) || []).length === 0,
    'neither lock site DEFINES its own local copy of the check — both call out to the one export');

  // 8c — sanity on the helper itself, so 8a/8b aren't accidentally checking
  // a helper that always agrees with itself for a trivial reason.
  assert(shapeOf(contradictory) === false && shapeOf(consistent) === true,
    'fixture check: the shared helper genuinely distinguishes the two fixtures used above (not vacuous)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ ${fail} FAILED — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
