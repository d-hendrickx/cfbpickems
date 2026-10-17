/**
 * CFB Pickems — d1homeenv.mjs (Deployment 1, Lane B, 2026-10-07)
 * ===============================================================
 * Shared TEST FIXTURE for the Lane B Home suites (carddetailtest, homefeedtest, viewerlinetest). Not a suite: it asserts nothing, loadtest does not spawn it, and
 * it is registered with no manifest. It gives the suites one way to stand up a REAL createHome() instance over the hand-derived statsfixtures league, with a REAL
 * element tree (minidom.mjs) as Home's container, every injected dependency a fake the test controls, and a counter on every full-markup write.
 *
 * Call `installDom()` BEFORE the first `import('./js/home.js')` (the app modules read `document` / `localStorage` at load).
 */
import { MiniDocument } from './minidom.mjs';

export function installDom() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k), clear: () => store.clear(),
  };
  const doc = new MiniDocument();
  globalThis.document = doc;
  globalThis.window = globalThis;
  try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
  catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
  globalThis.requestAnimationFrame = fn => fn();
  globalThis.fetch = async () => { throw new Error('network disabled'); };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.scrollY = 0;
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
  return doc;
}

export const NOW = Date.parse('2026-09-13T12:00:00.000Z');
export const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;
export const iso = (ms) => new Date(ms).toISOString();
export const esc = (s) => (s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '');

/** A Home container that counts every FULL markup write (`innerHTML =`), so a test can prove a path did not rewrite the feed. */
export function homeContainer(doc) {
  const el = doc.createElement('div');
  el.id = 'home-root';
  doc.body.appendChild(el);
  let writes = 0;
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'innerHTML');
  Object.defineProperty(el, 'innerHTML', { get() { return desc.get.call(this); }, set(v) { writes++; desc.set.call(this, v); }, configurable: true });
  Object.defineProperty(el, 'writes', { get: () => writes });
  return el;
}

/**
 * @param {{home:object, calculateWeeklyResults:Function}} mods  the real modules (home.js and scoring.js's weekly results)
 * @param {object} league   { players, weeks, games, picks, weeklyResults } (statsfixtures.buildLeague)
 * @param {object} o        viewer, admin, state, deps (merged over the defaults), read (reader overrides), chat, picksRead, confirmed, supabase
 */
export function mkHomeEnv(mods, doc, league, o = {}) {
  const state = { withheld: false, identity: 'acct|L1|p1', tab: 'home', now: NOW, ...(o.state || {}) };
  const calls = { actions: [], haptics: [], compact: [], observed: [], fetch: 0 };
  const clock = { now: 0, seq: 0, timers: [] };                                // a fake clock for the pill's announcement debounce: advance(ms) runs what is due
  const container = homeContainer(doc);
  const viewer = o.viewer === undefined ? 'p1' : o.viewer;
  const w = league;
  const readers = {
    weeks: () => w.weeks, games: () => w.games, picks: () => w.picks, players: () => w.players, weeklyResults: () => w.weeklyResults || [],
    weekProgress: () => null, currentWeek: () => w.weeks[w.weeks.length - 1] || null, activeWeekId: () => null,
    viewer: () => ({ playerId: viewer, isAdmin: !!o.admin }), timezone: () => 'PT', leagueId: () => 'L1', isSupabase: () => !!o.supabase,
    ...(o.read || {}),
  };
  const deps = {
    escHtml: esc,
    isContentWithheld: () => state.withheld,
    confirmedStatusFor: (wk) => (o.confirmed ? o.confirmed(wk) : wk.status),
    picksReadConfirmed: (id) => (o.picksRead ? o.picksRead(id) : true),
    renderCompact: (...a) => { calls.compact.push(a); return '<i data-fake-compact="1"></i>'; },
    chatCandidates: () => (typeof o.chat === 'function' ? o.chat() : (o.chat || { scribe: [], lockerRoom: [] })),
    getContainer: () => container,
    currentIdentityKey: () => state.identity,
    getCurrentTab: () => state.tab,
    onAction: (a, p) => calls.actions.push([a, p]),
    haptic: (k) => calls.haptics.push(k),
    now: () => state.now,
    setTimer: (fn, ms) => { const t = { fn, at: clock.now + ms, id: ++clock.seq, live: true }; clock.timers.push(t); return t.id; },
    clearTimer: (id) => { const t = clock.timers.find(x => x.id === id); if (t) t.live = false; },
    pilotHistoryAllowed: () => o.pilotHistory !== false,   // D1 security O1: the default env is the pilot league; pass pilotHistory:false for any other
    observeSentinel: (el, cb) => { const rec = { el, cb, off: false }; calls.observed.push(rec); return () => { rec.off = true; }; },
    ...(o.deps || {}),
    read: readers,
  };
  const home = mods.home.createHome(deps);
  const advance = (ms) => { clock.now += ms; for (const t of clock.timers.filter(x => x.live && x.at <= clock.now).sort((p, q) => p.at - q.at || p.id - q.id)) { t.live = false; t.fn(); } };
  const pendingTimers = () => clock.timers.filter(t => t.live).length;
  return { home, deps, calls, container, state, read: readers, league: w, advance, pendingTimers };
}

/** Click a node (a MiniElement) the way a browser delegates it: the event bubbles from the node to the container's listener. */
export function click(node) { return node.dispatchEvent({ type: 'click' }); }
export function key(node, k) { let prevented = false; node.dispatchEvent({ type: 'keydown', key: k, preventDefault() { prevented = true; } }); return { get defaultPrevented() { return prevented; } }; }
export const keysOf = (container) => container.querySelectorAll('[data-card-key]').map(n => n.getAttribute('data-card-key'));
