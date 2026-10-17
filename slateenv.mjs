/**
 * CFB Pickems — slateenv.mjs (D1 W-68 / W-69, 2026-10-14): the shared test environment of slateaddswaptest.mjs and gameslisttest.mjs.
 * ==================================================================================================================================
 * Not a suite (it prints nothing and is not registered): the browser as far as js/app.js can tell, a REAL element tree built from the real index.html (minidom.mjs), and the seeding helpers both
 * suites use to put a commissioner, a week, a slate, a pool, picks and (for the NFL cases) two competitions on the page - so every tap in those suites goes through the app's own delegated handlers,
 * the real action-sheet layer and the real game form, never a fixture of them.
 *
 * Importing this module installs the globals app.js needs and imports app.js, storage.js and data-model.js ONCE; `reset()` then returns the process to a clean local-mode league.
 */
import { readFileSync } from 'node:fs';
import { MiniDocument, MiniElement } from './minidom.mjs';

// minidom.mjs has no insertAdjacentHTML; supplied here exactly as homenavtest.mjs / wizardfinalizetest.mjs do (the file is not edited).
if (typeof MiniElement.prototype.insertAdjacentHTML !== 'function') {
  MiniElement.prototype.insertAdjacentHTML = function (pos, html) {
    const t = this.ownerDocument.createElement('div'); t.innerHTML = html;
    const kids = [...t._children]; t._children = [];
    if (pos === 'afterbegin') { for (const k of kids.reverse()) { k.parentNode = this; this._children.unshift(k); } }
    else { for (const k of kids) { k.parentNode = this; this._children.push(k); } }
  };
}

export const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in the slate suites'); };
export const confirmCalls = { n: 0 };
globalThis.confirm = () => { confirmCalls.n++; return true; };
globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
export const realWarn = console.warn, realInfo = console.info, realError = console.error;
console.warn = () => {}; console.info = () => {};

const INDEX = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
export const freshDoc = () => { const d = new MiniDocument(); d.body.innerHTML = bodyHtmlOf(INDEX); return d; };
globalThis.document = freshDoc();

export const app = await import('./js/app.js');
export const storage = await import('./js/storage.js');
export const dm = await import('./js/data-model.js');
export const seam = await import('./js/sport-seam.js');
export const { NFL_PROFILE } = await import('./js/sports/nfl.js');
export const { CFB_PROFILE } = await import('./js/sports/cfb.js');

export const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * A VIRTUAL CLOCK for every timer the app arms (the 200 ms collapse hold, the 200 ms search debounce, the picker's slide fallback, toasts). W-22 (TESTING.md "Timing in browser suites"): a suite measures the app on
 * the app's own clock, never the machine's - a loaded machine stretches a synchronous tap sequence past a 200 ms hold and a wall-clock race goes red without the app doing anything wrong. Here a hold is armed by a
 * REAL tap (P-2), `pending()` reads what is armed, and `advance(ms)` runs what is due, in order, deterministically. `sleep(ms)` below is that advance (plus a few microtask turns), so a suite's "wait out the
 * hold" is exact and instant.
 */
export const timers = (() => {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let now = 0, seq = 0, q = [];
  globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = ++seq; q.push({ id, at: now + (Number(ms) || 0), fn: () => fn(...a) }); return id; };
  globalThis.clearTimeout = (id) => { q = q.filter((t) => t.id !== id); };
  return {
    real,
    now: () => now,
    pending: () => q.map((t) => ({ id: t.id, in: t.at - now })).sort((a, b) => a.in - b.in || a.id - b.id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = q.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        q = q.filter((t) => t !== due); now = due.at; due.fn();
      }
      now = end;
    },
    clear() { q = []; },
  };
})();
export const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
export const sleep = async (ms) => { timers.advance(ms); await flush(); };
export const tick = async (n = 6) => { for (let i = 0; i < n; i++) { timers.advance(0); await flush(); } };

/** Native shell on/off, with a Haptics spy (js/haptics.js reads window.Capacitor.Plugins.Haptics). `log` collects every impulse in order. */
export const haptics = [];
export function native(on) {
  haptics.length = 0;
  if (!on) { delete globalThis.Capacitor; return; }
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { Haptics: {
      impact: ({ style }) => haptics.push(`impact:${style}`),
      notification: ({ type }) => haptics.push(`notification:${type}`),
      selectionStart: () => {}, selectionChanged: () => haptics.push('selection'), selectionEnd: () => {},
    } },
  };
}

export const CFB_C = 'aaaaaaaa-0000-0000-0000-000000000001', NFL_C = 'bbbbbbbb-0000-0000-0000-000000000002';

/** A clean league: a verified commissioner, one player, a new document, nothing stored, no sheet, no picker, college only (or two sports). */
export function reset({ sports = 'cfb' } = {}) {
  store.clear();
  timers.clear();
  globalThis.document = freshDoc();
  native(false);
  confirmCalls.n = 0;
  // the Games tab's in-memory view state belongs to the page, which this reset replaces
  app.state.gamesListSegment = 'all'; app.state.gamesClosedGroups = new Set();
  app.state.availFilter = { groupBy: 'date', conference: '', rank: 'any', almaOnly: false, nationalTV: false, tightOnly: false, search: '' };
  globalThis.matchMedia = () => ({ matches: false });
  seam.resetLensSport();
  app._resetSwapPickerForTest?.();   // (absent on the tree before W-68: the red-first proof runs this suite against it)
  storage.setSession('p1', true, true);
  storage.addPlayer({ playerId: 'p1', displayName: 'Ann', active: true, almaMater: 'Texas A&M' });
  storage.addPlayer({ playerId: 'p2', displayName: 'Ben', active: true, almaMater: 'Oklahoma' });
  if (sports === 'multi') {
    storage.saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
    storage.saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season' });
  }
}

/** What every seeded pick chose. It is NO game's team name, so any appearance of it on screen is a pick leaking (the blind rule): the suites assert it appears nowhere. */
export const PICKED = 'ZZPICKED';
const KICK0 = Date.UTC(2026, 9, 17, 16, 0);   // a Saturday, 16:00Z
/** A pool-shaped game (what ESPN parsing yields): an event id, a line, a kickoff `i` x 45 minutes after the first. */
export function mkGame(weekId, i, o = {}) {
  return dm.createGame(weekId, {
    homeTeam: `Home${i}`, awayTeam: `Away${i}`, kickoff: new Date(KICK0 + i * 45 * 60000).toISOString(), kickoffConfirmed: true,
    spread: -3.5, favorite: `Home${i}`, spreadSource: 'espn', espnEventId: `E${i}`, ...o,
  });
}

/**
 * Seed one week. `games` = how many are on the slate (ids g0..), `pool` = extra event numbers that sit in the pool but NOT on the slate (and, with `poolMirrorsSlate`, the slate games'
 * counterparts too, as a real fetch leaves them). `picks` = { gameIndex: n } submitted picks per slate game. The week becomes the active (and, in a multi-sport league, the lens) week.
 */
export function seedWeek({ weekId = 'w7', status = 'draft', games = 10, pool = [20, 21], poolMirrorsSlate = true, picks = {}, sport = 'cfb', blurb = 'A blurb that is long enough to count for the gate.', extra = {} } = {}) {
  const nfl = sport === 'nfl';
  const w = { ...dm.createWeek('2026', 7, '2026-10-17', '2026-10-18', nfl ? { competitionId: NFL_C, profile: NFL_PROFILE } : {}), weekId, status, blurb, showInHistory: true, ...extra };
  storage.saveWeek(w);
  storage.setActiveWeekId(weekId);
  if (nfl) seam.setLensSport('nfl');
  for (let i = 0; i < games; i++) storage.saveGame({ ...mkGame(weekId, i), gameId: `g${i}` });
  const poolGames = [];
  if (poolMirrorsSlate) for (let i = 0; i < games; i++) poolGames.push(mkGame(weekId, i));
  for (const n of pool) poolGames.push(mkGame(weekId, n));
  if (poolGames.length) storage.saveAvailableGames(weekId, poolGames);
  for (const [gi, n] of Object.entries(picks)) for (let k = 0; k < n; k++) storage.saveAllPicks([...(storage.getPicks(weekId) || []), { ...dm.createPick(weekId, `g${gi}`, `p${k + 1}`, PICKED), pickId: `pk${gi}_${k}` }]);
  return w;
}

export const page = () => document.getElementById('page-commissioner');
export const render = () => { app.renderCommPage(); return page(); };
export const section = () => document.getElementById('games-section');
export const rows = (root = section()) => (root ? [...root.querySelectorAll('.games-row')] : []);
export const rowKeys = (root) => rows(root).map((r) => r.getAttribute('data-key'));
export const rowFor = (eventNo, root) => rows(root).find((r) => r.getAttribute('data-key') === `e:E${eventNo}`) || null;
export const btnIn = (row, action) => (row ? [...row.querySelectorAll('[data-action]')].find((b) => b.getAttribute('data-action') === action) || null : null);
export const layer = () => document.getElementById('ls-action-layer');
export const layerText = () => norm(layer()?.textContent);
export const layerAct = (act) => (layer() ? [...layer().querySelectorAll('[data-ls-action]')].find((b) => b.getAttribute('data-ls-action') === act) || null : null);
export const toasts = () => [...document.querySelectorAll('#toast-container .toast')].map((t) => norm(t.textContent));
export const slateCount = (weekId = 'w7') => storage.getGames(weekId).length;
export const names = (weekId = 'w7') => storage.getGames(weekId).map((g) => `${g.awayTeam} @ ${g.homeTeam}`);
