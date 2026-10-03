/**
 * CFB Pickems — deeplinktest.mjs
 * ==============================
 * B-04 / ledger §6 item 27(c) — "a test-push tap lands on the Picks page
 * instead of Chat", regressed since v0.23.2.
 *
 * Run:  node deeplinktest.mjs
 *
 * A SEPARATE FILE, on the boottest/notifytest precedent: this suite replaces
 * `globalThis.document`, `globalThis.location` and `globalThis.history` for
 * whole sections and drives a REAL `boot()` through the DOMContentLoaded
 * handler js/app.js registers at import time. Doing that inside loadtest.mjs
 * would leave every suite after it running against this file's DOM.
 *
 * ── THE MECHANISM UNDER TEST ────────────────────────────────────────────────
 * On a cold push-tap launch the SDK's service worker opens
 * "?ntab=chat&nparams={...}". boot() awaits ensureSupabaseDataHydrated('boot'),
 * which DEFERS (returns false) whenever `noIdentityEverProven()` — RG-216, the
 * normal state of a home-screen PWA whose access token died overnight. The
 * post-hydrate tail runs anyway, parses `?ntab`, SCRUBS it off the URL with
 * history.replaceState, and hands the destination to deepLinkTo() — which
 * refuses while `isContentWithheld()` is true and returns. The tail is latched
 * page-lifetime, the URL is now clean, and `state.currentTab` is its 'picks'
 * initializer. Nothing ever replays the destination when the identity lands a
 * second later and the withhold lifts.
 *
 * The guard is therefore in two halves, and BOTH have to hold:
 *   (1) a destination that arrives while content is withheld must SURVIVE the
 *       withheld window rather than be dropped, and
 *   (2) it must not be acted on UNTIL the withhold lifts — a withheld page may
 *       not paint chat content (SECURITY S-2, and the blind rule behind it).
 *
 * ── STANDING RULE FOR THIS SUITE ───────────────────────────────────────────
 * **Payload fixtures use the shape `supabase/functions/_shared/onesignal.mjs`
 * emits, never an invented flat one.** `sendOneSignalNotification()` writes
 * `additionalData = { event, route, params:{…} }` (DI-242); `destinationFor()`
 * in js/notifications.js reads a FLAT ctx (`ctx.messageId`, `ctx.playerId`).
 * The first draft of §3 invented `{event, messageId}` and therefore proved that
 * the router worked on a payload nothing sends — it passed over a real defect
 * (`messageId` resolving to `null` on every chat tap, which costs the
 * scroll-and-flash to the actual message). Every fixture below goes through
 * `SENDER_PAYLOAD()`, which is that shape and only that shape. If the server's
 * shape changes, change it THERE and let this suite fail.
 *
 * NOT COVERED HERE — stated so it is never mistaken for covered:
 *   • whether iOS/Android actually opens the payload `url` on a cold tap, and
 *     whether a warm tap re-runs boot. Only a device can say.
 *   • the OneSignal SDK's own click event shape. §3 drives app.js's router with
 *     the payload OneSignal is documented to deliver; the delivery itself is a
 *     device fact.
 */

// ── harness ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const _realLog = console.log.bind(console);
const _realErr = console.error.bind(console);
function assert(cond, label) {
  if (cond) { pass++; _realLog('  ✅', label); }
  else { fail++; _realErr('  ❌', label); }
}
function note(...a) { _realLog('     ·', ...a); }
const settle = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const quiet = async (fn) => {
  const e = console.error, w = console.warn, i = console.info, l = console.log;
  console.error = () => {}; console.warn = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; console.info = i; console.log = l; }
};

// ── the world ────────────────────────────────────────────────────────────────
const LEAGUE = 'L-IRB';
const ME = 'p_drew';
const USER = { id: 'u-drew', email: 'drew@example.com' };

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: i => [...store.keys()][i] ?? null,
};

const reg = new Map();
class El {
  constructor(tag) { this.tagName = tag || 'div'; this.id = ''; this.hidden = false; this.className = ''; this.attrs = {}; this.dataset = {}; this._html = ''; this._listeners = {}; this.style = {}; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  get textContent() { return this._html.replace(/<[^>]*>/g, ''); }
  set textContent(v) { this._html = String(v); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter(f => f !== fn); }
  dispatch(t, e = {}) { (this._listeners[t] || []).forEach(fn => fn(e)); }
  appendChild(c) { if (c?.id) reg.set(c.id, c); return c; }
  insertAdjacentHTML(pos, html) { this._html = pos === 'afterbegin' ? html + this._html : this._html + html; }
  remove() { if (this.id) reg.delete(this.id); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  scrollIntoView() {}
  get classList() {
    this._classes = this._classes || new Set(String(this.className || '').split(/\s+/).filter(Boolean));
    const s = this._classes;
    return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: c => s.has(c), [Symbol.iterator]: () => s[Symbol.iterator]() };
  }
}

// The fake league, as the server holds it.
const MEMBER_ROW = {
  league_id: LEAGUE, id: ME, user_id: USER.id, role: 'commissioner', legacy_player_id: ME,
  display_name: 'Drew', initials: 'DH', alma_mater: 'Iowa State', active: true,
  notify_prefs: {}, preferences: {}, linked_at: null, extra: {}, created_at: null, updated_at: null,
};
const TABLES = ['league_kv', 'league_members', 'weeks', 'games', 'picks', 'results', 'obligations',
  'tiebreaker_guesses', 'extra_point_guesses', 'reactions', 'feedback', 'comments',
  'notifications', 'scribe_learnings', 'scribe_canon', 'scribe_reports', 'game_requests'];
const ST = {};
for (const t of TABLES) ST[t] = [];
ST.league_members = [MEMBER_ROW];
ST.weeks = [{ league_id: LEAGUE, id: 'w1', sport: 'cfb', season: '2026', week_number: 1, label: 'Week 1', status: 'open', extra: {} }];

let SESSION = null;          // what the SDK's getSession() answers, swapped mid-scenario
const CLIENT = {
  auth: {
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: SESSION } }),
    signInWithOAuth: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
    refreshSession: async () => ({ data: { session: SESSION }, error: null }),
  },
  from(table) {
    // SB-01 / RG-265 — the paging surface hydrate() uses: keyset `gt`, `order`, `limit`, and the
    // exact count page one asks for (computed before the limit, as PostgREST does).
    const q = { table, filters: [], gt: [], order: null, limit: Infinity, count: false };
    const api = {
      select(_c, o) { q.count = !!(o && o.count); return api; },
      eq(c, v) { q.filters.push([c, v]); return api; },
      gt(c, v) { q.gt.push([c, v]); return api; },
      order(c) { q.order = c; return api; },
      limit(n) { q.limit = n; return api; },
      then(res, rej) {
        const rows = (ST[q.table] || []).filter(r => q.filters.every(([c, v]) => r[c] === v)
          && q.gt.every(([c, v]) => r[c] > v));
        if (q.order) rows.sort((a, b) => (a[q.order] < b[q.order] ? -1 : a[q.order] > b[q.order] ? 1 : 0));
        return Promise.resolve({ data: rows.slice(0, q.limit), error: null, count: q.count ? rows.length : null }).then(res, rej);
      },
    };
    return api;
  },
  rpc(name, args) {
    if (name === 'get_member_contacts') {
      return Promise.resolve({ data: ST.league_members.filter(m => m.league_id === args?.p_league)
        .map(m => ({ member_id: m.id, email: null, phone: '', phone_verified: false })), error: null });
    }
    if (name === 'week_submission_status') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: { code: 'P0001', message: `no rpc ${name}` } });
  },
  channel() { return { on() { return this; }, subscribe() { return this; }, unsubscribe() {} }; },
  removeChannel() {},
};

const bodyClasses = new Set();
const appendAnywhere = el => {
  if (el?.id) reg.set(el.id, el);
  if (String(el?.src || '').includes('supabase')) {
    globalThis.window.supabase = { createClient: () => CLIENT };
    Promise.resolve().then(() => el.dispatch('load', {}));
  }
  return el;
};
let domReadyHandler = null;
globalThis.window = globalThis;
globalThis.document = {
  hidden: false,
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') domReadyHandler = fn; },
  removeEventListener() {},
  getElementById: id => reg.get(id) || null,
  createElement(tag) { return new El(tag); },
  querySelector(sel) {
    const m = /^#([\w-]+)\.([\w-]+)$/.exec(String(sel));
    if (m) { const el = reg.get(m[1]); return el && el.classList?.contains(m[2]) ? el : null; }
    return null;
  },
  querySelectorAll() { return []; },
  body: {
    appendChild: appendAnywhere, dataset: {},
    classList: {
      add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c),
      toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)),
      contains: c => bodyClasses.has(c),
      [Symbol.iterator]: () => bodyClasses[Symbol.iterator](),
    },
  },
  head: { appendChild: appendAnywhere },
  title: '',
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
// THE TAP'S URL. Set before app.js is imported and read by the post-hydrate
// tail; `history.replaceState` is what scrubs it, and the scrub is recorded so
// §1 can prove the parse really happened.
const replaceStateCalls = [];
globalThis.location = { origin: 'http://localhost', pathname: '/', search: '', href: 'http://localhost/' };
globalThis.history = {
  replaceState(_s, _t, url) { replaceStateCalls.push(String(url)); globalThis.location.search = ''; },
};
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} }, userAgent: 'node' }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} }, userAgent: 'node' }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('config.json')) {
    return { ok: true, json: async () => ({
      authMode: 'supabase', dataMode: 'supabase',
      supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon',
    }) };
  }
  throw new Error('network disabled in deeplinktest');
};
if (typeof globalThis.MutationObserver !== 'function') {
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
}
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

// ── the device, as it is the moment the player taps the push ────────────────
// A home-screen PWA opened the next morning: the refresh token is good, the
// ACCESS token expired hours ago, and the league pointer is on the device. This
// is exactly RG-194/RG-216's window — `noIdentityEverProven()` is TRUE, so the
// boot hydrate defers and content stays withheld until the SDK answers.
/** The EXACT `additionalData` supabase/functions/_shared/onesignal.mjs builds:
 *  `{ event }`, plus `{ route, params }` whenever the caller passed a
 *  destination (DI-242). Nested — `params` is an object, not spread flat. One
 *  helper so a shape drift is one edit, not a search. */
const SENDER_PAYLOAD = (event, route, params) => {
  const data = { event: String(event || '') };
  if (route) { data.route = String(route); data.params = params && typeof params === 'object' ? params : {}; }
  return data;
};

const staleSession = () => JSON.stringify({
  access_token: 'tok-stale', refresh_token: 'r-drew',
  expires_at: Math.floor(Date.now() / 1000) - 7200, user: USER,
});
const freshSession = () => ({
  access_token: 'tok-fresh', refresh_token: 'r-drew',
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER,
});
store.set('cfbp_auth_mode_last_known', 'supabase');
store.set('cfbp_supabase_session', staleSession());
store.set('cfbp_supabase_active_league', LEAGUE);

globalThis.location.search = '?ntab=chat&nparams=' + encodeURIComponent('{"messageId":"m1"}');

const appMod = await import('./js/app.js');
const authMod = await import('./js/auth.js');
const sbMod = await import('./js/supabase-backend.js');

console.log('\n[1] B-04 — a cold push tap while the identity is still resolving…');
assert(typeof domReadyHandler === 'function',
  'fixture: app.js registered its DOMContentLoaded boot handler (without it every assertion below is vacuous)');

await quiet(async () => { domReadyHandler(); await settle(80); });

// ── (a) the fixture is the one the bug needs ────────────────────────────────
assert(authMod.hasValidSupabaseSession() === false && !authMod.getAccountUserId(),
  'fixture: no identity has been proven on this page yet — the access token is stale and no auth event has landed (RG-216\'s deferral window)');
assert(appMod.isContentWithheld() === true,
  `fixture: …so content is WITHHELD (got ${appMod.isContentWithheld()}). The deep link arrives into exactly this state`);
assert(replaceStateCalls.length === 1 && globalThis.location.search === '',
  `fixture: the post-hydrate tail really did parse and scrub ?ntab (replaceState calls: ${JSON.stringify(replaceStateCalls)}) — the destination has left the URL and exists nowhere but in memory`);

// ── (b) …and nothing paints chat while the page is withheld ─────────────────
assert(appMod.state.currentTab !== 'chat',
  `the withheld page has NOT navigated to chat (tab ${JSON.stringify(appMod.state.currentTab)}) — a withheld page may not paint chat content (SECURITY S-2)`);

// ── (c) THE BUG: the identity lands, and the destination is gone ────────────
await quiet(async () => {
  SESSION = freshSession();
  store.set('cfbp_supabase_session', JSON.stringify(SESSION));
  authMod._fireAuthEventForTest('INITIAL_SESSION', SESSION);
  await settle(120);
});
note('after the identity landed: withheld =', appMod.isContentWithheld(),
  '| adapter =', sbMod.getState(), '| tab =', JSON.stringify(appMod.state.currentTab));
assert(appMod.isContentWithheld() === false,
  `fixture: the withhold has LIFTED (adapter ${sbMod.getState()}) — without this "it should have navigated by now" is not yet true`);
assert(appMod.state.currentTab === 'chat',
  `B-04 — the tap's destination is honoured once the page is un-withheld (tab ${JSON.stringify(appMod.state.currentTab)}, expected 'chat'). Drew: "a test-push tap lands on the Picks page instead of Chat"`);


// ══════════════════════════════════════════════════════════════════════════
// [2] THE QUEUED NATIVE TAP — same withheld window, different doorway
// ══════════════════════════════════════════════════════════════════════════
// js/push-native.js already buffers a tap that lands before the app can
// navigate (`_pendingNavigations`, flushed by markNativeBootReady()). What it
// flushes INTO is app.js's deepLinkTo(), wired at app.js's native boot block —
// so a tap that survives Capacitor's buffer and this module's own buffer can
// still be dropped by the withhold guard one layer further in. The seam both
// push-native.js and js/chat-ui.js reach app.js through is `window.deepLinkTo`,
// which is what this section drives: the REAL function, by the REAL handle.
console.log('\n[2] the queued native tap — a destination handed to deepLinkTo() while content is withheld…');
{
  // Put the page back into the withheld state: the token this device holds is
  // stale again and nothing has been proven. (A session expiring mid-session is
  // the production path that does this — see app.js's sb.withhold() call.)
  await quiet(async () => {
    SESSION = null;
    store.set('cfbp_supabase_session', staleSession());
    authMod._setAccountUserIdForTest('');
    await settle(5);
  });
  assert(appMod.isContentWithheld() === true,
    `fixture: content is withheld again (got ${appMod.isContentWithheld()}) — the state a queued tap can be flushed into`);
  const tabBefore = appMod.state.currentTab;

  assert(typeof globalThis.window.deepLinkTo === 'function',
    'fixture: app.js exposes deepLinkTo on window — the one seam js/push-native.js and js/chat-ui.js both route taps through');
  await quiet(async () => { globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'm2' } }); await settle(20); });
  assert(appMod.state.currentTab === tabBefore,
    `the withheld page does NOT navigate on the flushed tap (tab ${JSON.stringify(appMod.state.currentTab)}) — the withhold guard is intact; the destination must WAIT, not be honoured early`);

  // …and now the identity comes back.
  await quiet(async () => {
    SESSION = freshSession();
    store.set('cfbp_supabase_session', JSON.stringify(SESSION));
    authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    await settle(40);
  });
  assert(appMod.isContentWithheld() === false,
    `fixture: the withhold lifted again (adapter ${sbMod.getState()})`);
  assert(appMod.state.currentTab === 'chat',
    `B-04 — a tap queued through the native buffer is REPLAYED on the un-withhold transition (tab ${JSON.stringify(appMod.state.currentTab)}, expected 'chat')`);
}

// ══════════════════════════════════════════════════════════════════════════
// [3] THE WARM WEB TAP — the app is already open, so there is no ?ntab at all
// ══════════════════════════════════════════════════════════════════════════
// push-onesignal.js's wireNotificationClicks() is the only signal on the warm
// path (the cold path's ?ntab re-parse does not happen — boot does not re-run).
// It was wired as `wireNotificationClicks(() => { wakeChat(); })`: it fetched,
// and it routed NOTHING, so a warm tap on a chat push left the player wherever
// they already were. That is the same report from the other side.
console.log('\n[3] the warm web tap — the payload\'s destination, with no URL to read it from…');
{
  assert(typeof appMod._routeNotificationTapForTest === 'function',
    'fixture: app.js exposes the warm-tap router, so this drives the REAL callback wireNotificationClicks() is handed rather than a lookalike');
  const route = appMod._routeNotificationTapForTest || (() => {});

  // (a) a chat push, in the shape the SERVER actually sends, lands on the
  //     MESSAGE — not merely on the chat tab.
  //
  // THE TAB ALONE IS NOT THE ASSERTION, and that distinction is this section's
  // whole reason for existing after the reviewer's BLOCK. `additionalData` is
  // `{event, route, params:{messageId}}` (_shared/onesignal.mjs's
  // sendOneSignalNotification, DI-242) and `destinationFor()` reads a FLAT ctx
  // (`ctx.messageId`). A router that hands the payload over whole resolves
  // `messageId: null` — the tab is right, the scroll-and-flash to the message
  // never happens, and an assertion that only reads `state.currentTab` passes
  // over it. The RESOLVED DESTINATION is read instead, by banking the tap while
  // the page is withheld and inspecting the slot.
  await quiet(async () => {
    appMod._resetPendingDeepLinkForTest();
    SESSION = null; store.set('cfbp_supabase_session', staleSession()); authMod._setAccountUserIdForTest('');
    appMod.state.currentTab = 'dashboard';
    await settle(5);
    route('CHAT_MESSAGE_CREATED', SENDER_PAYLOAD('CHAT_MESSAGE_CREATED', 'chat', { messageId: 'm3' }));
    await settle(10);
  });
  assert(JSON.stringify(appMod._pendingDeepLinkForTest()) === JSON.stringify({ tab: 'chat', params: { messageId: 'm3' } }),
    `a warm tap resolves the SERVER's nested payload to {tab:'chat', params:{messageId:'m3'}} (got ${JSON.stringify(appMod._pendingDeepLinkForTest())}) — the messageId lives under additionalData.params, and losing it costs the scroll-to-message, not the tab`);
  await quiet(async () => {
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    await settle(40);
  });
  assert(appMod.state.currentTab === 'chat',
    `…and it navigates there (tab ${JSON.stringify(appMod.state.currentTab)}) — DEEP_LINK_TABLE is the resolver, the same one the cold path uses`);

  // (a2) `route` IS PRESENT IN THAT PAYLOAD AND IS NOT WHAT DECIDES. A payload
  //      whose `route` disagrees with its event still resolves from the EVENT:
  //      the tab is never accepted off the wire, only resolved.
  await quiet(async () => {
    appMod._resetPendingDeepLinkForTest();
    SESSION = null; store.set('cfbp_supabase_session', staleSession()); authMod._setAccountUserIdForTest('');
    await settle(5);
    route('PICKS_REMINDER', SENDER_PAYLOAD('PICKS_REMINDER', 'commissioner', {}));
    await settle(10);
  });
  assert(appMod._pendingDeepLinkForTest()?.tab === 'picks',
    `…and a payload whose \`route\` says 'commissioner' still resolves to 'picks' from its EVENT (got ${JSON.stringify(appMod._pendingDeepLinkForTest())}) — the wire never names the tab`);
  await quiet(async () => {
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    await settle(40);
  });

  // (b) …and a lifecycle push routes to ITS tab, not to chat's.
  await quiet(async () => { appMod.state.currentTab = 'chat'; route('PICKS_REMINDER', SENDER_PAYLOAD('PICKS_REMINDER', 'picks', {})); await settle(20); });
  assert(appMod.state.currentTab === 'picks',
    `…and a pick-reminder tap routes to Picks (tab ${JSON.stringify(appMod.state.currentTab)}) — the router reads the table, it does not assume chat`);

  // (c) NON-ROUTING IS PRESERVED for anything the table does not know. This is
  // the regression risk of adding a router at all: destinationFor() answers
  // 'dashboard' for an UNKNOWN event, so a naive wiring would yank a player off
  // whatever page they were on for every payload without a recognised event.
  for (const [ev, label] of [[null, 'no event at all'], ['', 'an empty event'], ['NOT_AN_EVENT', 'an unrecognised event']]) {
    await quiet(async () => { appMod.state.currentTab = 'leaderboard'; route(ev, SENDER_PAYLOAD(ev, 'chat', { messageId: 'x' })); await settle(10); });
    assert(appMod.state.currentTab === 'leaderboard',
      `…and ${label} moves the player NOWHERE (tab ${JSON.stringify(appMod.state.currentTab)}) — an unroutable payload is not a navigation to the default tab`);
  }

  // (d) the warm router obeys the withhold guard too.
  await quiet(async () => {
    appMod.state.currentTab = 'leaderboard';
    SESSION = null; store.set('cfbp_supabase_session', staleSession()); authMod._setAccountUserIdForTest('');
    await settle(5);
    route('CHAT_MESSAGE_CREATED', SENDER_PAYLOAD('CHAT_MESSAGE_CREATED', 'chat', { messageId: 'm4' }));
    await settle(20);
  });
  assert(appMod.isContentWithheld() === true && appMod.state.currentTab === 'leaderboard',
    `a warm tap on a WITHHELD page paints nothing either (withheld ${appMod.isContentWithheld()}, tab ${JSON.stringify(appMod.state.currentTab)}) — one guard, every doorway`);
  await quiet(async () => {
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    await settle(40);
  });
  assert(appMod.state.currentTab === 'chat',
    `…and is replayed when it lifts, like every other doorway (tab ${JSON.stringify(appMod.state.currentTab)})`);
}


// ══════════════════════════════════════════════════════════════════════════
// [4] THE WHOLE NATIVE CHAIN — Capacitor's buffer, push-native's buffer, and
//     the withhold, in that order, on one tap
// ══════════════════════════════════════════════════════════════════════════
// §2 drove app.js's half by the seam. This drives js/push-native.js's REAL
// `notificationClick` listener, through its REAL `_pendingNavigations` buffer,
// into a REAL withheld page — because the three buffers are in series and a tap
// only reaches the player if every one of them hands it on. push-native.js
// itself is unchanged by this fix; that is the claim under test.
console.log('\n[4] the native chain end to end — Capacitor buffer -> push-native buffer -> withhold…');
{
  const native = await import('./js/push-native.js');
  const plugin = { listeners: {}, addListener(name, fn) { this.listeners[name] = fn; return Promise.resolve({ remove() {} }); } };
  globalThis.window.Capacitor = { isNativePlatform: () => true, Plugins: { OneSignalCapacitor: plugin } };
  try {
    native._resetForTest();
    appMod._resetPendingDeepLinkForTest();
    // Withheld, and the app has NOT finished booting — the exact cold push-tap
    // launch: the OS delivers the tap before anything can navigate.
    await quiet(async () => {
      SESSION = null; store.set('cfbp_supabase_session', staleSession()); authMod._setAccountUserIdForTest('');
      appMod.state.currentTab = 'dashboard';
      await settle(5);
    });
    assert(appMod.isContentWithheld() === true, 'fixture: the page is withheld and the app has not reached boot-ready — the cold push-tap launch');

    native.wireNativeNotificationClicks((dest) => globalThis.window.deepLinkTo(dest));
    assert(typeof plugin.listeners.notificationClick === 'function',
      'fixture: push-native.js really registered its notificationClick listener (without it the tap below goes nowhere for the wrong reason)');

    await quiet(async () => {
      plugin.listeners.notificationClick({ notification: { additionalData: { event: 'CHAT_MESSAGE_CREATED', route: 'chat', params: { messageId: 'm5' } } } });
      await settle(10);
    });
    assert(native._isBootReadyForTest() === false && appMod.state.currentTab === 'dashboard',
      `the tap is held by push-native's own buffer before boot-ready, and nothing paints (bootReady ${native._isBootReadyForTest()}, tab ${JSON.stringify(appMod.state.currentTab)})`);
    assert(appMod._pendingDeepLinkForTest() === null,
      'fixture: …and it has not reached app.js yet, so the withheld-tap slot is still empty (the two buffers are genuinely in series)');

    // Boot reaches revealApp() and flushes push-native's buffer — straight into
    // the withhold, which is where every earlier version of this lost it.
    await quiet(async () => { native.markNativeBootReady(); await settle(10); });
    assert(appMod.state.currentTab === 'dashboard',
      `…the flush still paints nothing on a withheld page (tab ${JSON.stringify(appMod.state.currentTab)})`);
    assert(appMod._pendingDeepLinkForTest()?.tab === 'chat',
      `…but the destination is now BANKED rather than dropped (held: ${JSON.stringify(appMod._pendingDeepLinkForTest())})`);

    await quiet(async () => {
      SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
      await appMod._ensureSupabaseDataHydratedForTest('memberships');
      await settle(40);
    });
    assert(appMod.state.currentTab === 'chat' && appMod._pendingDeepLinkForTest() === null,
      `B-04 — the tap survives all three buffers and lands on Chat when the page is released (tab ${JSON.stringify(appMod.state.currentTab)}, slot ${JSON.stringify(appMod._pendingDeepLinkForTest())})`);
  } finally {
    delete globalThis.window.Capacitor;
    (await import('./js/push-native.js'))._resetForTest();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// [5] THE SLOT IS CONSUMED ONCE, AND IS NOT A STALE-NAVIGATION HAZARD
// ══════════════════════════════════════════════════════════════════════════
// A buffer that replays is a buffer that can replay at the wrong moment. Two
// rules keep it honest and both are asserted here rather than argued in a
// comment: it is cleared when it is delivered, and a second tap inside one
// withheld window resolves to the one the player tapped LAST.
console.log('\n[5] the held slot — consumed once, last tap wins…');
{
  appMod._resetPendingDeepLinkForTest();
  await quiet(async () => {
    SESSION = null; store.set('cfbp_supabase_session', staleSession()); authMod._setAccountUserIdForTest('');
    appMod.state.currentTab = 'dashboard';
    await settle(5);
    globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'm6' } });
    globalThis.window.deepLinkTo({ tab: 'leaderboard', params: { section: 'obligations' } });
    await settle(10);
  });
  assert(appMod._pendingDeepLinkForTest()?.tab === 'leaderboard',
    `two taps inside one withheld window resolve to the LAST one (held: ${JSON.stringify(appMod._pendingDeepLinkForTest())}) — a player who taps twice means the second tap`);

  await quiet(async () => {
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    await settle(40);
  });
  assert(appMod.state.currentTab === 'leaderboard' && appMod._pendingDeepLinkForTest() === null,
    `…and the slot is EMPTY once delivered (tab ${JSON.stringify(appMod.state.currentTab)}, slot ${JSON.stringify(appMod._pendingDeepLinkForTest())})`);

  // The proof that it cannot fire again later: navigate away, then drive another
  // un-withhold transition. Nothing is owed, so nothing moves.
  await quiet(async () => {
    appMod.state.currentTab = 'picks';
    await appMod._ensureSupabaseDataHydratedForTest('tick');
    await settle(20);
  });
  assert(appMod.state.currentTab === 'picks',
    `a later repaint does NOT re-deliver a spent tap (tab ${JSON.stringify(appMod.state.currentTab)}) — the player is not yanked back to a notification they already read`);
}


// ══════════════════════════════════════════════════════════════════════════
// [6] THE OTHER UN-WITHHOLD TRANSITION — a hold gate on an ALREADY-BOOTED page
// ══════════════════════════════════════════════════════════════════════════
// releaseWithholdIfResolved() is the second of the two moments the answer can
// flip, and it is the one no other section reaches: `_bootStoppedAtHold` is
// false on a page that booted normally, so section (2) — the hydrate and the
// tail — returns early and _repaintForSupabaseData() never runs. That is the
// real shape of "my session expired at halftime, I signed back in, and the push
// I tapped during the gate went nowhere."
//
// A mutation that removes the flush from this function and leaves the repaint's
// one in place passes every other section in this file. It does not pass here.
console.log('\n[6] a hold gate that goes up and comes down on a booted page…');
{
  appMod._resetPendingDeepLinkForTest();
  await quiet(async () => {
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    appMod.state.currentTab = 'dashboard';
    await settle(20);
  });
  assert(appMod.isContentWithheld() === false,
    'fixture: a normally-booted, serving page — nothing is withheld and no boot stopped at a hold');

  await quiet(async () => { appMod.showAuthHoldGate('data-hold'); await settle(10); });
  assert(appMod.currentAuthHoldReason() === 'data-hold' && appMod.isContentWithheld() === true,
    `fixture: the hold gate is up, so content is withheld again (reason ${JSON.stringify(appMod.currentAuthHoldReason())})`);

  await quiet(async () => { globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'm7' } }); await settle(10); });
  assert(appMod.state.currentTab === 'dashboard' && appMod._pendingDeepLinkForTest()?.tab === 'chat',
    `the tap taken during the gate paints nothing and is banked (tab ${JSON.stringify(appMod.state.currentTab)}, held ${JSON.stringify(appMod._pendingDeepLinkForTest())})`);

  // The gate comes down. NOTHING re-hydrates on this path — that is the point.
  await quiet(async () => { appMod.hideAuthHoldGate(); await settle(20); });
  assert(appMod.isContentWithheld() === false, 'fixture: …and the gate is down again');
  assert(appMod.state.currentTab === 'chat' && appMod._pendingDeepLinkForTest() === null,
    `B-04 — the held tap is replayed by the un-withhold TRANSITION, not only by the adapter repaint (tab ${JSON.stringify(appMod.state.currentTab)})`);
}

// ══════════════════════════════════════════════════════════════════════════
// [7] THE WARM HOOK IS ACTUALLY WIRED TO THE ROUTER
// ══════════════════════════════════════════════════════════════════════════
// §3 drives routeNotificationTap() directly, which proves the router is right
// and proves nothing about whether anything calls it. The two halves of that
// wiring are pinned here: push-onesignal.js's click hook really hands its
// callback `(event, data)` (BEHAVIORAL, through the real SDK-deferred queue),
// and app.js really passes the router into it (STRUCTURAL — the registration
// lives behind ensureOneSignalInit(), which no Node harness can resolve).
console.log('\n[7] the warm hook -> router wiring…');
{
  const os = await import('./js/push-onesignal.js');
  const seen = [];
  const listeners = {};
  globalThis.window.OneSignalDeferred = [];
  os.wireNotificationClicks((event, data) => seen.push([event, data]));
  const queued = globalThis.window.OneSignalDeferred.splice(0);
  assert(queued.length === 1, `fixture: wireNotificationClicks() queued its registration on OneSignalDeferred (got ${queued.length})`);
  await quiet(async () => {
    await queued[0]({ Notifications: { addEventListener: (t, fn) => { listeners[t] = fn; } } });
    await settle(5);
  });
  assert(typeof listeners.click === 'function', 'fixture: …and registered a real `click` listener on the SDK');
  listeners.click({ notification: { additionalData: SENDER_PAYLOAD('CHAT_MESSAGE_CREATED', 'chat', { messageId: 'm8' }) } });
  assert(seen.length === 1 && seen[0][0] === 'CHAT_MESSAGE_CREATED' && seen[0][1]?.params?.messageId === 'm8',
    `push-onesignal.js hands the click hook (event, additionalData) — the two arguments app.js's router reads (got ${JSON.stringify(seen[0])})`);

  const { readFileSync } = await import('node:fs');
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  // UN-315 / DI-436.3 (2026-09-29) — the hook USED TO be `{ wakeChat(); routeNotificationTap(event, data); }`.
  // The chat fetch (BUG-12) reads the ACTIVE league's room, and a tap can now come from ANOTHER league, so the
  // wake moved INSIDE the router where it is conditional on the tap's league (`if (!foreignLeague) wakeChat();`).
  // The property this line always pinned — the hook goes to routeNotificationTap(), never a bare wakeChat() —
  // is unchanged and is asserted first; the moved wake is asserted second, so it cannot be dropped silently.
  assert(/wireNotificationClicks\(\(event, data\) => routeNotificationTap\(event, data\)\);/.test(appSrc),
    'app.js wires that hook to routeNotificationTap(), not to a bare wakeChat() — the warm tap has no ?ntab to fall back on, so this line IS the warm path [structural]');
  assert(/function routeNotificationTap\(event, data\) \{[\s\S]*?if \(!foreignLeague\) wakeChat\(\);[\s\S]*?hasOwnProperty\.call\(LIFECYCLE_EVENTS, event\)/.test(appSrc),
    '…and the router keeps BUG-12\'s fetch-first wake for a tap from the ACTIVE league (or one that names none) — and skips it for another league\'s, whose room is not the one on screen [structural]');
  assert(/function routeNotificationTap\(event, data\) \{[\s\S]*?hasOwnProperty\.call\(LIFECYCLE_EVENTS, event\)/.test(appSrc),
    '…and the router still resolves the tab from the lifecycle vocabulary rather than accepting one off the payload [structural]');
}


// ══════════════════════════════════════════════════════════════════════════
// [8] THE FLUSH ASKS THE PREDICATE ITSELF
// ══════════════════════════════════════════════════════════════════════════
// STRUCTURAL, and stated as such because it cannot be otherwise: both of
// flushPendingDeepLink()'s call sites are already behind an un-withhold, so no
// input to this suite can reach it in a withheld state, and a mutation that
// deletes its own guard stays green everywhere above. That is exactly the drift
// releaseWithholdIfResolved()'s header warns about — a rule expressed as an
// obligation on a list of call sites is a rule about the paths somebody
// remembered. A third caller added later (a new release site, a resume hook)
// would inherit the guard from the function; delete it and it would not.
console.log('\n[8] the flush owns its own withhold check…');
{
  const { readFileSync } = await import('node:fs');
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const body = appSrc.slice(appSrc.indexOf('function flushPendingDeepLink('), appSrc.indexOf('/** Test seam — the slot is page state'));
  assert(/if \(isContentWithheld\(\)\) return false;/.test(body),
    'flushPendingDeepLink() re-asks isContentWithheld() itself, so a future call site cannot deliver a held tap onto a withheld page [structural]');
  assert(body.indexOf('_pendingDeepLink = null;') < body.indexOf('deepLinkTo(dest)'),
    '…and it clears the slot BEFORE delivering, so a re-entrant repaint cannot deliver the same tap twice [structural]');
}


// ══════════════════════════════════════════════════════════════════════════
// [9] A BANKED TAP NEVER CROSSES AN ACCOUNT BOUNDARY
// ══════════════════════════════════════════════════════════════════════════
// The one window "consumed once" does not close: banked while withheld, then a
// SIGN-OUT or a handover before it is ever delivered. A sign-out withholds the
// page, so without a rule the slot survives it and the NEXT account's first
// un-withhold navigates them to the previous player's notification.
//
// Both directions are asserted, because the safe one is easy to get by being
// uselessly strict: (a) a tap banked under player A is DISCARDED when player B
// holds the page, and (b) a tap banked when NOBODY was proven is still
// delivered to whoever the page resolves to — which is B-04 itself, since the
// RG-216 deferral window is by definition "no identity proven yet". A rule that
// failed (b) would be the bug back.
console.log('\n[9] the account boundary — a held tap belongs to the account that received it…');
{
  // ── (a) BANKED UNDER A, DELIVERED TO NOBODY ───────────────────────────
  appMod._resetPendingDeepLinkForTest();
  await quiet(async () => {
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    appMod.state.currentTab = 'dashboard';
    await settle(20);
    // A is signed in and the page is serving. The gate goes up (a session
    // expiry), and A taps a chat push while it is up.
    appMod.showAuthHoldGate('data-hold');
    globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'mA' } });
    await settle(10);
  });
  assert(appMod._pendingDeepLinkForTest()?.params?.messageId === 'mA',
    `fixture: player A's tap is banked while the gate is up (held ${JSON.stringify(appMod._pendingDeepLinkForTest())})`);

  // …and player B takes the device.
  await quiet(async () => {
    authMod._setAccountUserIdForTest('u-kevin');
    appMod.hideAuthHoldGate();
    await settle(30);
  });
  assert(appMod._pendingDeepLinkForTest() === null,
    `player A's held tap is DISCARDED once another account holds the page (slot ${JSON.stringify(appMod._pendingDeepLinkForTest())}) — dropped, not parked, so it cannot fire later either`);
  assert(appMod.state.currentTab !== 'chat',
    `…and player B is NOT navigated to player A's message (tab ${JSON.stringify(appMod.state.currentTab)}) — the leak DI-180q's sweep exists to stop, one surface over`);

  // ── (b) NON-VACUITY: the SAME account still gets its tap ──────────────
  // Without this the rule above could be satisfied by never delivering
  // anything, which is B-04 with extra steps.
  await quiet(async () => {
    appMod._resetPendingDeepLinkForTest();
    authMod._setAccountUserIdForTest(USER.id);
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION));
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    appMod.state.currentTab = 'dashboard';
    await settle(20);
    appMod.showAuthHoldGate('data-hold');
    globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'mB' } });
    await settle(10);
    appMod.hideAuthHoldGate();
    await settle(30);
  });
  assert(appMod.state.currentTab === 'chat',
    `…while the SAME account's held tap is still delivered (tab ${JSON.stringify(appMod.state.currentTab)}) — the boundary rule is a boundary, not a blanket refusal`);

  // ── (c) BANKED BY A COLD BOOT UNDER NO ACCOUNT — STILL DELIVERED ──────
  // The slot is stamped '' when nobody is proven, and that is not a crossing:
  // the tap came from the URL the OS opened on THIS device before any account
  // existed on the page. This is the exact state §1 boots into, asserted here
  // as a RULE so a future tightening of the boundary cannot quietly undo B-04.
  await quiet(async () => {
    appMod._resetPendingDeepLinkForTest();
    SESSION = null; store.set('cfbp_supabase_session', staleSession()); authMod._setAccountUserIdForTest('');
    appMod.state.currentTab = 'dashboard';
    await settle(5);
    globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'mC' } });
    await settle(10);
  });
  assert(appMod.isContentWithheld() === true && appMod._pendingDeepLinkForTest()?.params?.messageId === 'mC',
    'fixture: a tap banked with NO account proven — the RG-216 deferral window, i.e. B-04\'s own state');
  await quiet(async () => {
    SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
    await appMod._ensureSupabaseDataHydratedForTest('memberships');
    await settle(40);
  });
  assert(appMod.state.currentTab === 'chat',
    `…is delivered to whoever the page resolves to (tab ${JSON.stringify(appMod.state.currentTab)}) — an account ARRIVING is not an account CHANGING, and treating it as one reinstates B-04`);
}

// ══════════════════════════════════════════════════════════════════════════
// [10] UN-315 / DI-436.2 — A TAP NAMES ITS LEAGUE, AND THE ROUTER SWITCHES BEFORE IT NAVIGATES
// ══════════════════════════════════════════════════════════════════════════
// One phone now hears every league its owner belongs to, so a tap can arrive for a league that is NOT on
// screen. The three entries (cold `?nleague=`, warm `data.league_id`, native's validated `leagueId`) all end in
// `routeToLeague()`. The DECISIONS are driven through its `deps` seam (every collaborator is a real module
// function by default; a suite replaces one to drive one branch without booting a second league), and the WIRING
// is driven for real in this file's own withheld-window world — a foreign id is banked WITH its league, replayed
// through the same router, and switches NOTHING.
console.log('\n[10] UN-315 — a tap names its league: switch first, never on a forged id…');
{
  const route = appMod._routeToLeagueForTest;
  assert(typeof route === 'function', 'fixture: app.js exposes routeToLeague through its test seam');
  const L_ACTIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const L_OTHER  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const L_FORGED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const DEST = { tab: 'chat', params: { messageId: 'm10' } };
  const MEMBERS = [{ leagueId: L_ACTIVE, leagueName: 'IRB Football' }, { leagueId: L_OTHER, leagueName: 'Work League' }];

  /** Every collaborator recorded, in order. */
  const harness = (over = {}) => {
    const log = [];
    const deps = {
      getActiveLeagueId: () => L_ACTIVE,
      getMemberships: () => MEMBERS,
      isWithheld: () => false,
      doSwitch: async (id) => { log.push(['switch', id]); return true; },
      deepLink: (d) => { log.push(['deepLink', d]); },
      stash: (d) => { log.push(['stash', d]); },
      toast: (msg, kind) => { log.push(['toast', msg, kind]); },
      isNative: () => false,
      haptic: (k) => { log.push(['haptic', k]); },
      ...over,
    };
    return { log, deps };
  };
  const names = (log) => log.map((e) => e[0]).join(',');
  const run = async (leagueId, over) => { const h = harness(over); const outcome = await quiet(() => route(leagueId, DEST, h.deps)); return { outcome, log: h.log }; };

  // no league named → the EXISTING path, untouched
  for (const none of [undefined, null, '']) {
    const r = await run(none);
    assert(r.outcome === 'no-league' && names(r.log) === 'deepLink' && r.log[0][1] === DEST,
      `a tap that names NO league (${JSON.stringify(none)}) is exactly today's tap: deepLinkTo(destination), no switch, no toast (got ${r.outcome} ${names(r.log)})`);
  }
  // malformed → nothing at all
  for (const bad of ['nope', `${L_OTHER}x`, 42, {}, 'L-IRB', `' or 1=1 --`]) {
    const r = await run(bad);
    assert(r.outcome === 'malformed' && r.log.length === 0,
      `a MALFORMED league id (${JSON.stringify(bad)}) routes NOTHING — no navigation, no switch, no toast, no bank (got ${r.outcome} ${names(r.log)})`);
  }
  // the active league → deepLinkTo
  {
    const r = await run(L_ACTIVE.toUpperCase());
    assert(r.outcome === 'same' && names(r.log) === 'deepLink', `a tap from the league ALREADY ACTIVE just navigates (case-insensitively) (got ${r.outcome} ${names(r.log)})`);
  }
  // a member league → switch FIRST, then navigate; no success toast; no haptic on web
  {
    const r = await run(L_OTHER);
    assert(r.outcome === 'switched' && names(r.log) === 'switch,deepLink' && r.log[0][1] === L_OTHER && r.log[1][1] === DEST,
      `a tap from another league the account is IN switches to it FIRST and only then navigates — the order is the feature (got ${r.outcome} ${names(r.log)})`);
    assert(!r.log.some((e) => e[0] === 'toast') && !r.log.some((e) => e[0] === 'haptic'),
      '…with NO success toast (the destination arriving is the acknowledgement) and NO haptic on web (Interaction Principles)');
  }
  {
    const r = await run(L_OTHER, { isNative: () => true });
    assert(r.outcome === 'switched' && names(r.log) === 'switch,haptic,deepLink' && r.log[1][1] === 'selection',
      `…on NATIVE the same tap adds exactly ONE `+'`selection`'+` haptic, after the switch lands and before the destination paints (got ${names(r.log)} ${JSON.stringify(r.log[1])})`);
    const failed = await run(L_OTHER, { isNative: () => true, doSwitch: async () => false });
    assert(failed.outcome === 'switch-failed' && !failed.log.some((e) => e[0] === 'deepLink' || e[0] === 'haptic'),
      `…and a switch that FAILS navigates nowhere and buzzes nothing (doSwitchActiveLeague already toasted why) (got ${failed.outcome} ${names(failed.log)})`);
  }
  // a league the account is NOT in → refused, and NOTHING is switched (the first of the two locks)
  {
    const r = await run(L_FORGED);
    assert(r.outcome === 'refused' && names(r.log) === 'toast' && r.log[0][1] === "That league isn't on your account." && r.log[0][2] === 'error',
      `a FORGED league id (well-formed, not in the account's memberships) switches NOTHING and says "That league isn't on your account." (got ${r.outcome} ${JSON.stringify(r.log)})`);
  }
  // not yet decidable → banked WITH its league; nothing else
  {
    const withheld = await run(L_OTHER, { isWithheld: () => true });
    assert(withheld.outcome === 'stashed' && names(withheld.log) === 'stash'
      && JSON.stringify(withheld.log[0][1]) === JSON.stringify({ ...DEST, leagueId: L_OTHER }),
      `a tap while content is WITHHELD is banked WITH its league — never acted on (got ${withheld.outcome} ${JSON.stringify(withheld.log)})`);
    const unresolved = await run(L_OTHER, { getMemberships: () => [] });
    assert(unresolved.outcome === 'stashed' && names(unresolved.log) === 'stash',
      `…and so is a tap that arrives before the memberships have resolved (got ${unresolved.outcome})`);
    const noTab = await run(L_OTHER, { isWithheld: () => true });
    const route2 = await quiet(() => route(L_OTHER, { params: {} }, harness({ isWithheld: () => true }).deps));
    assert(route2 === 'stashed', '…(a destination with no tab is not banked — deepLinkTo\'s own rule — but is still not acted on)');
    assert(noTab.log.length === 1, '…and a withheld tap costs exactly one bank write');
  }
  // never throws
  {
    const boom = await run(L_OTHER, { doSwitch: async () => { throw new Error('boom'); } });
    assert(boom.outcome === 'error' && !boom.log.some((e) => e[0] === 'deepLink'), `a throwing collaborator is CAUGHT — routeToLeague never rejects into a tap handler (got ${boom.outcome})`);
  }

  // ── THE REAL WIRING, in this file's withheld-window world ─────────────────
  const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const routeWarm = appMod._routeNotificationTapForTest;
  {
    // A warm tap naming a league the account is NOT in, while the page is withheld: banked WITH the league…
    await quiet(async () => {
      appMod._resetPendingDeepLinkForTest();
      SESSION = null; store.set('cfbp_supabase_session', staleSession()); authMod._setAccountUserIdForTest('');
      appMod.state.currentTab = 'dashboard';
      await settle(5);
      routeWarm('CHAT_MESSAGE_CREATED', { ...SENDER_PAYLOAD('CHAT_MESSAGE_CREATED', 'chat', { messageId: 'm10w' }), league_id: FOREIGN });
      await settle(10);
    });
    assert(appMod.isContentWithheld() === true && JSON.stringify(appMod._pendingDeepLinkForTest()) === JSON.stringify({ tab: 'chat', params: { messageId: 'm10w' }, leagueId: FOREIGN }),
      `WARM: a tap that names a league is banked WITH it while the page is withheld (held ${JSON.stringify(appMod._pendingDeepLinkForTest())})`);
    const activeBefore = authMod.getActiveLeagueId();
    // …and when the withhold lifts it is replayed through the SAME router, which refuses a league the account is not in.
    await quiet(async () => {
      SESSION = freshSession(); store.set('cfbp_supabase_session', JSON.stringify(SESSION)); authMod._setAccountUserIdForTest(USER.id);
      await appMod._ensureSupabaseDataHydratedForTest('memberships');
      await settle(60);
    });
    assert(appMod.isContentWithheld() === false && appMod._pendingDeepLinkForTest() === null,
      'fixture: the withhold lifted and the held tap was CONSUMED (replayed once)');
    assert(authMod.getActiveLeagueId() === activeBefore && appMod.state.currentTab !== 'chat',
      `…and the FORGED league switched NOTHING and navigated nowhere (active league ${JSON.stringify(authMod.getActiveLeagueId())} unchanged, tab ${JSON.stringify(appMod.state.currentTab)}) — the second lock, on the replay path`);
  }
  {
    // A malformed league id in the payload declines the tap entirely (no bank, no navigation).
    await quiet(async () => {
      appMod._resetPendingDeepLinkForTest();
      appMod.state.currentTab = 'dashboard';
      routeWarm('CHAT_MESSAGE_CREATED', { ...SENDER_PAYLOAD('CHAT_MESSAGE_CREATED', 'chat', { messageId: 'm10x' }), league_id: 'not-a-uuid' });
      await settle(20);
    });
    assert(appMod.state.currentTab === 'dashboard' && appMod._pendingDeepLinkForTest() === null,
      `WARM: a PRESENT-but-malformed league_id declines the tap — nothing navigated, nothing banked (tab ${JSON.stringify(appMod.state.currentTab)})`);
    // …while a tap that names NO league is byte-for-byte what it was (the [3] section drives the rest).
    await quiet(async () => {
      appMod.state.currentTab = 'dashboard';
      routeWarm('CHAT_MESSAGE_CREATED', SENDER_PAYLOAD('CHAT_MESSAGE_CREATED', 'chat', { messageId: 'm10y' }));
      await settle(20);
    });
    assert(appMod.state.currentTab === 'chat', 'WARM: a tap with NO league_id still navigates exactly as before (every older push)');
  }

  // ── STRUCTURAL: the three entries and the bank all end in the ONE router.
  {
    const { readFileSync } = await import('node:fs');
    const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const code = stripC(appSrc);
    assert(/const nleague = params\.get\('nleague'\);/.test(code) && /params\.delete\('nleague'\);/.test(code) && /routeToLeague\(nleague, \{ tab: ntab, params: nparams \}\)/.test(code),
      'COLD: the post-hydrate tail reads `nleague`, SCRUBS it off the URL with the other notification params, and hands the destination to routeToLeague() [structural]');
    const coldTail = code.slice(code.indexOf("const ntab = params.get('ntab');"), code.indexOf("routeToLeague(nleague, { tab: ntab, params: nparams })"));
    assert(coldTail.length > 0 && coldTail.indexOf("params.delete('nleague')") > -1
      && coldTail.indexOf("params.delete('nleague')") < coldTail.indexOf('history.replaceState('),
      '…the scrub happens BEFORE the URL is rewritten, so a reload or a bookmark can never re-trigger the switch [structural]');
    assert(/native\.wireNativeNotificationClicks\(\(dest\) => \{[\s\S]*?routeToLeague\(dest\.leagueId, dest\);[\s\S]*?\}\);/.test(code),
      'NATIVE: the click callback passes the resolver\'s validated `leagueId` to routeToLeague() [structural]');
    const flush = code.slice(code.indexOf('function flushPendingDeepLink('), code.indexOf('export function _resetPendingDeepLinkForTest'));
    assert(/if \(dest\.leagueId\) routeToLeague\(dest\.leagueId, dest\); else deepLinkTo\(dest\);/.test(flush),
      'BANK: a held tap that carries a league is replayed through routeToLeague(), not deepLinkTo() — the league is switched to BEFORE the tab opens [structural]');
    const doSwitch = code.slice(code.indexOf('export async function doSwitchActiveLeague'), code.indexOf('// ═══════════════════════════════════════════════════════════════════════════\n// DI-314/DI-315'));
    assert(/Not a member of that league/.test(doSwitch) && /That league isn't on your account\./.test(doSwitch),
      'the SECOND lock: switchActiveLeague() throwing "Not a member of that league" is mapped to the same sentence, not to the connection toast that would send the player to retry a thing that can never work [structural]');
    // ── THE SWITCH COVER'S MOTION (Polish Pass, DI-436.5 touched-screen audit). A tap from another league now
    //    puts the "Switching leagues…" cover up on a warm app, and it used to CUT in and CUT out. Interaction
    //    Principles: motion within its ranges — fade IN 180-250ms, OUT 220-300ms — one animation language.
    const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
    const inRule = /#league-switch-overlay\{[^}]*animation:league-switch-in (\d+)ms var\(--ease-entrance\) both\}/.exec(css);
    assert(!!inRule && Number(inRule[1]) >= 180 && Number(inRule[1]) <= 250,
      `COVER: the cover fades IN over ${inRule ? inRule[1] : '?'}ms — inside the 180-250ms range, on the shared entrance easing [structural]`);
    const outRule = /\.league-switch-leaving\{[^}]*pointer-events:none;[^}]*animation:league-switch-out var\(--motion-nav\) var\(--ease-native\) both\}/.exec(css);
    const nav = /--motion-nav:(\d+)ms/.exec(css);
    assert(!!outRule && !!nav && Number(nav[1]) >= 220 && Number(nav[1]) <= 300,
      `COVER: …and fades OUT over --motion-nav (${nav ? nav[1] : '?'}ms — inside 220-300ms) on the shared --ease-native token (no literal easing keyword), click-through while it does [structural]`);
    assert(/@keyframes league-switch-in\{from\{opacity:0\}to\{opacity:1\}\}/.test(css) && /@keyframes league-switch-out\{from\{opacity:1\}to\{opacity:0\}\}/.test(css)
      && /@media \(prefers-reduced-motion:reduce\)\{\s*#league-switch-overlay,\.league-switch-leaving\{animation-duration:1ms\}/.test(css),
      'COVER: opacity only (no transform, no bounce), and reduced-motion collapses both fades [structural]');
    const hideFn = code.slice(code.indexOf('function hideLeagueSwitchOverlay()'), code.indexOf('export async function doSwitchActiveLeague'));
    assert(/el\.remove\(\);[\s\S]*?ghost\.className = 'league-switch-leaving';/.test(hideFn) && /addEventListener\('animationend', remove, \{ once: true \}\)/.test(hideFn) && /setTimeout\(remove, 400\)/.test(hideFn),
      'COVER: hideLeagueSwitchOverlay() removes the blocking cover IMMEDIATELY (authtest [11]/[79] still read null), then fades a FRESH cover-coloured ghost that is removed on animationend with a timer backstop [structural]');
    assert(/try \{\s*const ghost = document\.createElement/.test(hideFn) && /\}\s*catch \{\s*\}\s*\}\s*$/.test(hideFn.trim()),
      'COVER: …and the ghost is best-effort — it can never throw out of doSwitchActiveLeague()\'s finally [structural]');
    assert(!/leagueId:\s*(?:payload|data|additionalData)\.league_id/.test(code) && (code.match(/\.league_id/g) || []).length <= 6,
      'the payload\'s league_id is read in ONE place (the warm router) and validated by isLeagueUuid before anything uses it [structural]');
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} deeplinktest: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
