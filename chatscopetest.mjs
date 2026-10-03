/**
 * CFB Pickems — chatscopetest.mjs
 * ================================
 * SB-20 — the chat store must belong to ONE (account, league) at a time.
 *
 * Run:  node chatscopetest.mjs            (also spawned by loadtest.mjs §[130])
 *   for tz in UTC America/Los_Angeles; do TZ=$tz node chatscopetest.mjs; done
 *
 * THE SUSPECTED DEFECT (Home-renderer security review, 2026-10-01): js/chat.js
 * keeps the folded room in one page-lifetime Map (`S.items`) that only
 * `_resetForTest()` ever empties. Neither an in-page league switch
 * (js/auth.js switchActiveLeague) nor app.js's identity chokepoint
 * (applyIdentityDeltaIfChanged) touches it, and `newItem()` drops the row's
 * `league_id` (js/supabase-projection.js rowToMessage() never maps it), so
 * nothing downstream could even tell a League A row from a League B one.
 *
 * WHY IT IS WORSE THAN STALE ROWS: `messages.seq` is PER-LEAGUE and contiguous
 * from 1 (migration 0001:341, `unique (league_id, seq)`). The transport's poll
 * cursor is `S.head`, which survives the switch too, so the new league is read
 * from the OLD league's cursor: a smaller room never loads at all, and a bigger
 * one loads only the rows above the old head.
 *
 * Every scenario here goes through the REAL modules: js/chat.js's store,
 * js/chatTransport.js's Supabase path, js/supabase-projection.js's
 * rowToMessage(), js/auth.js's switchActiveLeague()/signOut()/SIGNED_IN
 * handling, and js/app.js's doSwitchActiveLeague() and identity chokepoint.
 * Only the SERVER is fake: a two-league `messages` table with per-league seqs,
 * RLS on `visible_to`, chat_head, and Realtime channels a test can fire.
 *
 * NOT COVERED HERE, and only a browser or the real project can say:
 *   • what the Chat tab actually paints (chat-ui.js reads the store only through
 *     the chat.js accessors asserted below, but pixels are a device check);
 *   • the real Supabase RLS policy and Realtime filter (rls.test.mjs is Drew's);
 *   • a real Google / password sign-in round trip.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── harness ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const _realLog = console.log.bind(console);
const _realErr = console.error.bind(console);
function assert(cond, label) {
  if (cond) { pass++; _realLog('  ✅', label); }
  else { fail++; _realErr('  ❌', label); }
}
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const quiet = async (fn) => {
  const e = console.error, w = console.warn, i = console.info, l = console.log;
  console.error = () => {}; console.warn = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; console.info = i; console.log = l; }
};

// ── browser stubs (the authtest.mjs shape, trimmed to what app.js's chokepoint,
//    doSwitchActiveLeague() and navigateTo() touch) ──────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: i => [...store.keys()][i] ?? null,
};
const registry = new Map();
function fakeClassList() {
  const set = new Set();
  return {
    add: c => set.add(c), remove: c => set.delete(c),
    toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
    contains: c => set.has(c),
    [Symbol.iterator]: () => set[Symbol.iterator](),
  };
}
class FakeEl {
  constructor(tag) {
    this.tagName = tag || 'div'; this.id = ''; this.hidden = false; this.className = '';
    this.attrs = {}; this.dataset = {}; this._html = ''; this._listeners = {}; this.style = {};
    Object.defineProperty(this.style, 'setProperty', { value(k, v) { this[k] = String(v); }, enumerable: false, configurable: true, writable: true });
    Object.defineProperty(this.style, 'removeProperty', { value(k) { delete this[k]; }, enumerable: false, configurable: true, writable: true });
    this._subEls = {};
  }
  set innerHTML(v) {
    this._html = v;
    const re = /\bid="([^"]+)"/g;
    let m;
    while ((m = re.exec(v))) {
      if (!registry.has(m[1])) { const el = new FakeEl(); el.id = m[1]; registry.set(m[1], el); }
    }
  }
  get innerHTML() { return this._html; }
  get textContent() { return this._html.replace(/<[^>]*>/g, ''); }
  set textContent(v) { this._html = v; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') { this.id = v; registry.set(v, this); } }
  getAttribute(k) { return this.attrs[k] || null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter(f => f !== fn); }
  dispatch(t, evt = {}) { (this._listeners[t] || []).forEach(fn => fn(evt)); }
  click() { this.dispatch('click', { target: this }); }
  appendChild(child) { (this.children = this.children || []).push(child); if (child?.id) registry.set(child.id, child); return child; }
  remove() { this._removed = true; if (this.id) registry.delete(this.id); }
  querySelector(sel) {
    if (sel?.startsWith?.('#')) {
      const id = sel.slice(1);
      if (!this._subEls[id]) this._subEls[id] = new FakeEl();
      return this._subEls[id];
    }
    return null;
  }
  getBoundingClientRect() { return { width: 300, height: 500, top: 0, left: 0, right: 300, bottom: 500 }; }
  querySelectorAll() { return []; }
  insertAdjacentHTML(pos, html) { this._html = pos === 'afterbegin' ? html + this._html : this._html + html; }
  focus() {}
  scrollIntoView() {}
  get classList() { return fakeClassList(); }
}
function freshDom() {
  registry.clear();
  globalThis.document = {
    hidden: false,
    _docListeners: {},
    addEventListener(t, fn) { (this._docListeners[t] = this._docListeners[t] || []).push(fn); },
    removeEventListener(t, fn) { if (this._docListeners[t]) this._docListeners[t] = this._docListeners[t].filter(f => f !== fn); },
    getElementById(id) { return registry.get(id) || null; },
    createElement(tag) { return new FakeEl(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild(el) { this.lastChild = el; if (el?.id) registry.set(el.id, el); return el; }, classList: fakeClassList(), dataset: {}, lastChild: null },
    head: { appendChild(el) { if (el?.id) registry.set(el.id, el); return el; } },
    title: '',
  };
}
freshDom();
globalThis.window = globalThis;
globalThis.location = { origin: 'https://irbfootball.test', pathname: '/', search: '', href: 'https://irbfootball.test/' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in chatscopetest'); };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

const auth = await import('./js/auth.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const chat = await import('./js/chat.js');
const transport = await import('./js/chatTransport.js');
const projection = await import('./js/supabase-projection.js');
const chatUi = await import('./js/chat-ui.js');          // already in app.js's graph; §[20]'s mark-read seam
const pushOs = await import('./js/push-onesignal.js');
pushOs._setIdentityMinterForTest(async () => ({ ok: true, token: 'h.c.s', expiresAtMs: Date.now() + 86400000 }));

// ── the people and the leagues ───────────────────────────────────────────────
// account id -> { leagueId: memberId }. The SAME person in two leagues is the
// league-switch case; two different accounts are the handover cases.
const ACCOUNTS = {
  'u-drew': { L1: 'mD1', L2: 'mD2' },
  'u-a': { L1: 'mA' },
  'u-b-same': { L1: 'mB' },
  'u-b-other': { L2: 'mB2' },
};
const LEAGUE_NAMES = { L1: 'League One', L2: 'League Two' };
function membershipsOf(acct) {
  return Object.entries(ACCOUNTS[acct] || {}).map(([leagueId, memberId]) => ({
    leagueId, memberId, role: 'player', displayName: memberId, leagueName: LEAGUE_NAMES[leagueId] || leagueId,
  }));
}

// ── the fake SERVER: a two-league messages table ─────────────────────────────
const BASE_TS = 1_759_300_000_000;
const SRV = {
  rows: new Map(),            // leagueId -> [row]
  holdSince: null,            // (league, afterSeq) => boolean — models a page still in flight
  held: [],                   // [{ league, seq, release }]
  channels: [],               // every channel ever opened, in order
  calls: [],
};
function resetServer() {
  SRV.rows = new Map(); SRV.holdSince = null; SRV.holdBefore = null; SRV.foreignRows = null; SRV.held = []; SRV.channels = []; SRV.calls = [];
  SRV.holdAppend = false; SRV.heldAppends = []; SRV.appendCalls = 0; SRV.appendLog = []; SRV.appendOk = false;
  SRV.invokes = []; SRV.holdInvoke = false; SRV.heldInvokes = []; SRV.invokeAnswer = null;
}
/** Append one row to a league's log, assigning the next PER-LEAGUE seq. */
function serverAdd(leagueId, { id, author = 'mK', body = '', notify = true, meta = null, visibleTo = null, type = 'message' }) {
  const list = SRV.rows.get(leagueId) || [];
  SRV.rows.set(leagueId, list);
  const seq = list.length + 1;
  const row = {
    league_id: leagueId, id, seq, ts: new Date(BASE_TS + list.length * 60000 + (leagueId === 'L2' ? 7 : 0)).toISOString(),
    type, author, game_tag: '', body, target_id: '', reply_to: '', notify, meta,
    _visible_to: visibleTo,   // never selected — not in SB_MESSAGE_COLS, ungranted (0018)
  };
  list.push(row);
  return row;
}
function serverHead(leagueId) { const l = SRV.rows.get(leagueId) || []; return l.length ? l[l.length - 1].seq : 0; }
/** RLS, as messages_select states it: a member of the league, and `visible_to`
 *  null or this member. Nobody signed in reads nothing. */
function viewerMemberIn(leagueId) {
  const acct = auth.getAccountUserId() || '';
  return (ACCOUNTS[acct] || {})[leagueId] || null;
}
function visibleRows(leagueId) {
  const me = viewerMemberIn(leagueId);
  if (!me) return [];
  return (SRV.rows.get(leagueId) || []).filter(r => r._visible_to == null || r._visible_to === me);
}
const strip = (r) => { const { _visible_to, ...wire } = r; return wire; };
const chatClient = {
  from(table) {
    const q = { table, league: null, gt: null, lt: null, limit: 500, asc: true };
    const b = {
      select() { return b; },
      eq(c, v) { if (c === 'league_id') q.league = String(v); return b; },
      gt(_c, v) { q.gt = Number(v); return b; },
      lt(_c, v) { q.lt = Number(v); return b; },
      order(_c, o) { q.asc = !(o && o.ascending === false); return b; },
      limit(n) { q.limit = Number(n); return b; },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      let list = visibleRows(q.league);
      // A MISBEHAVING server (contract test [17]): rows of ANOTHER league in the
      // answer to this league's query — the case a fold that stamped the
      // REQUESTED league, rather than the row's own, could never catch.
      if (SRV.foreignRows && q.lt === null) list = list.concat(SRV.foreignRows(q.league) || []);
      if (q.gt !== null) list = list.filter(r => r.seq > q.gt);
      if (q.lt !== null) list = list.filter(r => r.seq < q.lt);
      list = list.slice().sort((a, b2) => (q.asc ? a.seq - b2.seq : b2.seq - a.seq)).slice(0, q.limit).map(strip);
      SRV.calls.push({ action: q.lt !== null ? 'before' : 'since', league: q.league, seq: q.lt !== null ? q.lt : q.gt });
      if (q.lt === null && SRV.holdSince && SRV.holdSince(q.league, q.gt)) {
        return new Promise(resolve => SRV.held.push({ league: q.league, seq: q.gt, release: () => resolve({ data: list, error: null }) }));
      }
      if (q.lt !== null && SRV.holdBefore && SRV.holdBefore(q.league, q.lt)) {
        return new Promise(resolve => SRV.held.push({ league: q.league, seq: q.lt, before: true, release: () => resolve({ data: list, error: null }) }));
      }
      return { data: list, error: null };
    }
    return b;
  },
  async rpc(fn, args) {
    if (fn === 'chat_head') {
      const l = String(args && args.p_league);
      SRV.calls.push({ action: 'head', league: l });
      // 0003_functions.sql:532 — SECURITY INVOKER: a non-member is refused, and
      // the head is the highest seq the CALLER can see under RLS, never the
      // league-wide one (another member's private row does not move it).
      if (!viewerMemberIn(l)) return { data: null, error: { code: 'P0001', message: 'not_member' } };
      const vis = visibleRows(l);
      return { data: vis.length ? vis[vis.length - 1].seq : 0, error: null };
    }
    // Appends always FAIL here ("network down"), optionally held in flight —
    // §[18] is about what the outbox does with a failure that straddles a
    // handover, so a server that never commits is the fixture it needs.
    if (fn === 'chat_append' || fn === 'chat_append_system') {
      SRV.appendCalls++;
      // Which events each call carried, under whose session and into which
      // league, so a section counts only ITS OWN (reviewer BLOCK on 08b4aa1: an
      // app-originated post in the same flush is a second RPC call a bare
      // counter cannot tell apart) and §[22] can see who posted what where.
      const events = ((args && args.p_events) || []).map(e => ({ id: String(e && e.id || ''), author: e && e.author, body: e && e.body }));
      const ids = events.map(e => e.id);
      SRV.appendLog.push({ fn, league: String(args && args.p_league), acct: auth.getAccountUserId(), ids, events });
      const ok = () => ({ data: events.map((e, i) => ({ id: e.id, seq: 100 + SRV.appendCalls * 10 + i, ts: new Date().toISOString(), deduped: false })), error: null });
      const down = () => ({ data: null, error: { message: 'network down' } });
      if (SRV.holdAppend) {
        return new Promise(resolve => {
          const release = (succeed = false) => resolve(succeed ? ok() : down());
          release.ids = ids;
          SRV.heldAppends.push(release);
        });
      }
      return SRV.appendOk ? ok() : down();
    }
    return { data: null, error: { message: 'no rpc ' + fn } };
  },
  // scribe-ask (askScribe() -> functions.invoke), recorded by session; §[22].
  // `answer` is the response shape; `holdInvoke` keeps the call in flight.
  functions: {
    invoke: async (name, opts) => {
      const call = { name, acct: auth.getAccountUserId(), member: storage.getSession().playerId,
        league: opts && opts.body && opts.body.leagueId, trigger: opts && opts.body && opts.body.triggerMessageId };
      SRV.invokes.push(call);
      const answer = () => ({ data: SRV.invokeAnswer || { ok: true, responseMessageId: 'r_x' }, error: null });
      if (SRV.holdInvoke) return new Promise(resolve => SRV.heldInvokes.push(() => resolve(answer())));
      return answer();
    },
  },
  channel(name) {
    const ch = {
      name, handler: null, statusCb: null, removed: false,
      on(_type, _filter, cb) { ch.handler = cb; ch.filter = _filter; return ch; },
      subscribe(cb) { ch.statusCb = cb; return ch; },
      unsubscribe() { ch.removed = true; },
    };
    SRV.channels.push(ch);
    return ch;
  },
  removeChannel(ch) { if (ch) ch.removed = true; return true; },
};
function channelFor(leagueId, { live = true } = {}) {
  const all = SRV.channels.filter(c => c.name === `chat:${leagueId}` && (!live || !c.removed));
  return all[all.length - 1] || null;
}
function realtimeInsert(ch, row) { ch.handler({ new: strip(row) }); }

// ── the fake AUTH client (window.supabase.createClient) ──────────────────────
let CURRENT_SESSION = null;
const authListeners = [];
const authClient = {
  auth: {
    onAuthStateChange(cb) { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: CURRENT_SESSION } }),
    refreshSession: async () => ({ data: { session: CURRENT_SESSION }, error: null }),
    signInWithOAuth: async () => ({ data: {}, error: null }),
    signOut: async () => { CURRENT_SESSION = null; authListeners.slice().forEach(fn => fn('SIGNED_OUT', null)); return { error: null }; },
  },
  from(table) {
    const eqs = [];
    const b = {
      select() { return b; }, eq(c, v) { eqs.push([c, v]); return b; }, order() { return b; }, limit() { return b; },
      single() { return b; }, update() { return b; }, maybeSingle() { return b; },
      then(res, rej) {
        let data = [];
        if (table === 'league_members') {
          const uid = (eqs.find(([c]) => c === 'user_id') || [])[1];
          data = Object.entries(ACCOUNTS[uid] || {}).map(([leagueId, memberId]) => ({
            league_id: leagueId, id: memberId, role: 'player', display_name: memberId, active: true,
            leagues: { name: LEAGUE_NAMES[leagueId] || leagueId, pilot: false, status: 'active', sport_default: 'cfb' },
          }));
        }
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return b;
  },
  rpc: async () => ({ data: null, error: null }),
  functions: { invoke: async () => ({ data: null, error: null }) },
  channel() { const ch = { on() { return ch; }, subscribe() { return ch; }, unsubscribe() {} }; return ch; },
  removeChannel() {},
};
globalThis.window.supabase = { createClient: () => authClient };

function sessionFor(acct) {
  return { access_token: 't-' + acct, refresh_token: 'r-' + acct, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: acct, email: acct + '@example.test' } };
}

/** A fresh page: auth, app latches, chat store, transport context, server. */
async function freshPage() {
  pushOs._setSdkReadyForTest(false);
  chat._resetForTest();
  transport._resetSupabaseChatForTest();
  transport._resetSupabaseDataModePredicateForTest();
  transport._resetRefusalStateForTest();
  auth._resetAuthForTest();
  app._resetAuthUIWiringForTest();
  app._resetAuthHoldForTest();
  freshDom();
  store.clear();
  resetServer();
  CURRENT_SESSION = null;
  authListeners.length = 0;
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._setHasSupabaseDataBackendForTest(true);
  app._setWarmRelaunchAtBootForTest(true);
  // Reviewer BLOCK on 08b4aa1 — a verified sign-in makes the APP queue its own
  // SCRIBE "What's New" post (checkWhatsNewPostDue(), app.js), which arms the
  // 750ms coalesced flush and adds a chat_append_system the suite never asked
  // for. Marked as already posted for the running build, so no app-originated
  // post enters this page's outbox. Through the storage seam's own accessor.
  storage.setWhatsNewPosted(app.APP_VERSION);
  app.wireAuthUIEvents();
  // The chat context exactly as js/app.js wires it at boot: the league comes
  // from js/auth.js's ONE getActiveLeagueId(), the identity epoch from auth.js.
  transport.installSupabaseChat({
    getClient: () => chatClient,
    getLeagueId: auth.getActiveLeagueId,
    rowToMessage: projection.rowToMessage,
    isReady: () => true,
    getIdentityEpoch: auth.getIdentityEpoch,
  });
  transport.setSupabaseDataModePredicate(() => true);
}

/** Sign an account in on this page and land it on `leagueId`, through
 *  js/auth.js's real SIGNED_IN handling (which reads league_members through
 *  the fake client) and app.js's wired listener. */
async function signInAs(acct, leagueId) {
  CURRENT_SESSION = sessionFor(acct);
  localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, JSON.stringify(CURRENT_SESSION));
  auth._setMembershipsForTest(membershipsOf(acct));
  auth.setActiveLeagueId(leagueId);
  await quiet(async () => {
    auth._fireAuthEventForTest('SIGNED_IN', CURRENT_SESSION);
    await settle(60);
  });
  // The membership read may have re-picked the pointer; pin it where the
  // scenario says the player is.
  if (auth.getActiveLeagueId() !== leagueId) {
    await quiet(async () => { auth.setActiveLeagueId(leagueId); await settle(20); });
  }
}

const ids = (list) => list.map(m => m.id);
const roomIds = () => ids(chat.getMessages({ tag: 'all' }));
const anyIdFrom = (prefix) => roomIds().filter(id => id.startsWith(prefix));
/** Model "the next poll tick" without waiting out the real cadence. */
async function nextPoll() { await quiet(async () => { try { await chat.forceRefresh(); } catch {} await settle(40); }); }
/** Start chat the way boot does (startChatTransport), then take one tick. The
 *  very first tick can land while the sign-in is still settling and is then
 *  rescheduled onto the 1s boot ladder (chatTransport.js BOOT_RETRY_DELAYS) —
 *  nextPoll() is that rung, taken now rather than waited for. */
async function startChat(selfId) {
  await quiet(async () => { chat.startChatTransport(selfId); await settle(60); });
  await nextPoll();
}
/** Outbox determinism for §[18]/§[22]: while on, every timer whose callback
 *  IS or CALLS flushOutbox() (the backoff retry, scheduleFlush()'s 750ms arrow,
 *  the identity-hold re-arm) is not scheduled — every attempt is the test's. */
const realSetTimeout = globalThis.setTimeout;
const callsFlush = (fn) => fn === chat.flushOutbox || (typeof fn === 'function' && /\bflushOutbox\s*\(/.test(String(fn)));
function noFlushTimers() { globalThis.setTimeout = (fn, ms, ...a) => (callsFlush(fn) ? 0 : realSetTimeout(fn, ms, ...a)); }
function restoreTimers() { globalThis.setTimeout = realSetTimeout; }

function seedL1(n = 5) { for (let i = 1; i <= n; i++) serverAdd('L1', { id: `l1_${i}`, author: 'mK', body: `League One message ${i}` }); }
function seedL2(n = 3) { for (let i = 1; i <= n; i++) serverAdd('L2', { id: `l2_${i}`, author: 'mJ', body: `League Two message ${i}` }); }

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[1] fixture — the fake server is per-league and RLS-scoped…');
{
  await freshPage();
  seedL1(5); seedL2(3);
  assert(serverHead('L1') === 5 && serverHead('L2') === 3,
    'fixture: each league has its OWN contiguous seq from 1 (0001_schema.sql:341 `unique (league_id, seq)`), so a League One cursor of 5 means nothing in League Two');
  await signInAs('u-drew', 'L1');
  assert(auth.getAccountUserId() === 'u-drew' && auth.getActiveLeagueId() === 'L1' && storage.getSession().playerId === 'mD1',
    `fixture: Drew is signed in on League One as mD1 (account ${auth.getAccountUserId()}, league ${auth.getActiveLeagueId()}, member ${storage.getSession().playerId})`);
  assert(visibleRows('L1').length === 5 && visibleRows('L2').length === 3, 'fixture: RLS lets a member of both leagues read both');
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[2] SB-20 REPRODUCTION — an in-page league switch (same account) through the real doSwitchActiveLeague()…');
{
  await freshPage();
  seedL1(5); seedL2(3);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  assert(anyIdFrom('l1_').length === 5 && anyIdFrom('l2_').length === 0,
    `fixture: the Chat tab's store holds League One's five rows before the switch (${JSON.stringify(roomIds())})`);

  const deliveries = [];
  const offEvents = chat.onChat((kind, d) => { if (kind === 'events') deliveries.push({ ...(d || {}) }); });
  await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
  assert(auth.getActiveLeagueId() === 'L2' && storage.getSession().playerId === 'mD2',
    `fixture: the switch landed — active league L2, member mD2 (got ${auth.getActiveLeagueId()} / ${storage.getSession().playerId})`);
  await nextPoll();
  offEvents();
  const firstL2 = deliveries.find(d => d.added > 0);
  assert(!!firstL2 && firstL2.wasCaughtUp === false,
    `the new room's first delivery is classified as HISTORY (wasCaughtUp false, got ${JSON.stringify(firstL2 || null)}) — otherwise notifications.js's client relay reads League Two's whole backlog as live and pushes it (BUG-C's rule)`);

  assert(anyIdFrom('l1_').length === 0,
    `SB-20 — after switching to League Two, NO League One row is in what the Chat tab reads (getMessages() still holds ${JSON.stringify(anyIdFrom('l1_'))})`);
  assert(chat.getMessage('l1_1') === null,
    `…and the direct read the reply / pin / edit paths use (getMessage) cannot reach one either (got ${JSON.stringify(chat.getMessage('l1_1')?.id || null)})`);
  assert(anyIdFrom('l2_').length === 3,
    `SB-20 — League Two's own room loads: all three of its rows (got ${JSON.stringify(anyIdFrom('l2_'))}). Before the fix the League One cursor (5) is above League Two's head (3), so the poll answers "nothing new" forever`);
  const latest = chat.latestNotifying('mD2');
  assert(!latest || String(latest.id).startsWith('l2_'),
    `…and the newest-notifying read (the toast/teaser source) is a League Two row or nothing (got ${JSON.stringify(latest?.id || null)})`);
  assert(chat.unreadCount('mD2', 'all') === 3,
    `…and the unread badge counts League Two's three rows, not League One's five (got ${chat.unreadCount('mD2', 'all')})`);
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[3] SB-20 REPRODUCTION — the new league is BIGGER than the old one: no row below the old cursor goes missing…');
{
  await freshPage();
  seedL1(5);
  for (let i = 1; i <= 8; i++) serverAdd('L2', { id: `l2_${i}`, author: 'mJ', body: `League Two message ${i}` });
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  assert(anyIdFrom('l1_').length === 5, 'fixture: League One is loaded');
  await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
  await nextPoll();
  assert(anyIdFrom('l2_').length === 8,
    `SB-20 — all EIGHT League Two rows load (got ${JSON.stringify(anyIdFrom('l2_'))}). Before the fix the walk starts above seq 5, so rows 1-5 are never requested`);
  assert(anyIdFrom('l1_').length === 0, `…and no League One row is left beside them (got ${JSON.stringify(anyIdFrom('l1_'))})`);
  const cache = JSON.parse(localStorage.getItem('cfbp_chat_events_cache') || '{"events":[]}');
  const cachedIds = (cache.events || []).map(e => e.id);
  assert(cachedIds.length > 0 && !cachedIds.some(id => id.startsWith('l1_')),
    `SB-20 — the device-local events cache written under League Two carries no League One event (${JSON.stringify(cachedIds)}). DI-180q's sweep removes the key on the switch; the in-RAM buffer must not write the old room straight back`);
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[4] SB-20 REPRODUCTION — in-page Sign Out, then a DIFFERENT account in a DIFFERENT league…');
{
  await freshPage();
  seedL1(5); seedL2(3);
  await signInAs('u-a', 'L1');
  await startChat('mA');
  assert(anyIdFrom('l1_').length === 5, 'fixture: account A sees League One');
  await quiet(async () => { await auth.signOut(); await settle(60); });
  assert(!auth.getAccountUserId(), `fixture: the in-page Sign Out left nobody signed in (account ${JSON.stringify(auth.getAccountUserId())})`);
  await signInAs('u-b-other', 'L2');
  assert(auth.getAccountUserId() === 'u-b-other' && storage.getSession().playerId === 'mB2',
    `fixture: account B is signed in on League Two as mB2 (got ${auth.getAccountUserId()} / ${storage.getSession().playerId})`);
  await nextPoll();
  assert(anyIdFrom('l1_').length === 0,
    `SB-20 — account B, who is NOT a member of League One, sees none of its rows (store still holds ${JSON.stringify(anyIdFrom('l1_'))}). This is the cross-account privacy leak`);
  assert(anyIdFrom('l2_').length === 3, `…and B's own League Two room loads (got ${JSON.stringify(anyIdFrom('l2_'))})`);
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[5] SB-20 REPRODUCTION — in-page Sign Out, then a different account in the SAME league: A\'s PRIVATE rows…');
{
  await freshPage();
  serverAdd('L1', { id: 'l1_1', author: 'mK', body: 'public one' });
  serverAdd('L1', { id: 'l1_2', author: 'mK', body: 'public two' });
  const selfTestId = 'sys_test_' + 'a'.repeat(32);
  serverAdd('L1', { id: selfTestId, author: 'system', body: 'This is a test push.', meta: { test: true }, visibleTo: 'mA' });
  const changelogId = 'sys_scribe_changelog_lrn42__private';
  serverAdd('L1', { id: changelogId, author: 'system', notify: false, body: 'SCRIBE learned from you.', meta: { kind: 'scribeChangelog', learningId: 'lrn42', playerId: 'mA' }, visibleTo: 'mA' });
  serverAdd('L1', { id: 'l1_5', author: 'mK', body: 'public five' });

  await signInAs('u-a', 'L1');
  await startChat('mA');
  assert(chat.getMessage(selfTestId) && chat.getMessage(changelogId),
    'fixture: account A holds its own two private rows (the push self-test and the private SCRIBE changelog)');
  await quiet(async () => { await auth.signOut(); await settle(60); });
  await signInAs('u-b-same', 'L1');
  assert(storage.getSession().playerId === 'mB', `fixture: account B is signed in on the same League One as mB (got ${storage.getSession().playerId})`);
  await nextPoll();
  assert(chat.getMessage(selfTestId) === null && chat.getMessage(changelogId) === null,
    `SB-20 — account B cannot read account A's private rows out of the store (self-test ${!!chat.getMessage(selfTestId)}, changelog ${!!chat.getMessage(changelogId)}). RLS kept them off B's wire; the store must not hand them over from A's session`);
  assert(!roomIds().includes(selfTestId) && !roomIds().includes(changelogId), '…nor through getMessages()');
  assert(['l1_1', 'l1_2', 'l1_5'].every(id => roomIds().includes(id)),
    `…while B still sees the league's public rows, read under B's own RLS (got ${JSON.stringify(roomIds())})`);
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[6] late frames — a POLL PAGE issued under League One that lands after the switch…');
{
  await freshPage();
  seedL1(5); seedL2(3);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  assert(anyIdFrom('l1_').length === 5, 'fixture: League One is loaded (cursor 5)');
  serverAdd('L1', { id: 'l1_6', author: 'mK', body: 'League One message 6 (in flight)' });
  SRV.holdSince = (league, after) => league === 'L1' && after === 5;
  let inflight = null;
  await quiet(async () => { inflight = chat.forceRefresh().catch(() => {}); await settle(20); });
  assert(SRV.held.length === 1 && SRV.held[0].league === 'L1',
    `fixture: a League One page (since 5) is in flight at the moment of the switch (held ${JSON.stringify(SRV.held.map(h => [h.league, h.seq]))})`);
  SRV.holdSince = null;
  await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
  await quiet(async () => { SRV.held.forEach(h => h.release()); await settle(60); await inflight; });
  assert(!roomIds().includes('l1_6') && anyIdFrom('l1_').length === 0,
    `the late League One page folds NOTHING into the League Two store (got ${JSON.stringify(anyIdFrom('l1_'))})`);
  await nextPoll();
  assert(anyIdFrom('l2_').length === 3, `…League Two's room is intact (got ${JSON.stringify(anyIdFrom('l2_'))})`);
  serverAdd('L2', { id: 'l2_4', author: 'mJ', body: 'League Two message 4 (after the late frame)' });
  await nextPoll();
  assert(roomIds().includes('l2_4'),
    `…and the late page did not drag the poll cursor back up to League One's 5: League Two's NEXT message (seq 4) still arrives (room ${JSON.stringify(anyIdFrom('l2_'))}, head ${chat.chatStatus().head})`);
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[7] late frames — a REALTIME insert on the old channel after the switch…');
{
  await freshPage();
  seedL1(5); seedL2(3);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  const oldCh = channelFor('L1');
  assert(!!oldCh && typeof oldCh.handler === 'function', 'fixture: the League One Realtime channel is open with an INSERT listener');
  assert(String(oldCh?.filter?.filter || '') === 'league_id=eq.L1', `fixture: …filtered to league_id=eq.L1 (got ${JSON.stringify(oldCh?.filter?.filter)})`);
  await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
  await nextPoll();
  const late = serverAdd('L1', { id: 'l1_rt_late', author: 'mK', body: 'arrives on the old channel after the switch' });
  await quiet(async () => { realtimeInsert(oldCh, late); await settle(20); });
  assert(!roomIds().includes('l1_rt_late'),
    'a League One INSERT delivered on the OLD channel after the switch never reaches the League Two store (transport I6 + the torn-down subscription)');
  const newCh = channelFor('L2');
  assert(!!newCh, 'fixture: a League Two channel is open after the switch');
  if (newCh) {
    const forged = { ...late, id: 'l1_rt_forged', seq: chat.chatStatus().head + 1 };
    await quiet(async () => { realtimeInsert(newCh, forged); await settle(20); });
    assert(!roomIds().includes('l1_rt_forged'),
      'a row carrying League One\'s league_id on the NEW channel is discarded too (the transport\'s row.league_id check)');
    const good = serverAdd('L2', { id: 'l2_rt_good', author: 'mJ', body: 'live on League Two' });
    await quiet(async () => { realtimeInsert(newCh, good); await settle(20); });
    assert(roomIds().includes('l2_rt_good'),
      `non-vacuity: a genuine League Two INSERT (seq ${good.seq}, cursor ${chat.chatStatus().head}) IS delivered on the new channel`);
  }
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[8] (a) every folded row carries its league — from the wire, and from a local send…');
{
  await freshPage();
  seedL1(2);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  const mapped = projection.rowToMessage(strip(SRV.rows.get('L1')[0]));
  assert(mapped.leagueId === 'L1', `rowToMessage() carries league_id onto the event as leagueId (got ${JSON.stringify(mapped.leagueId)})`);
  assert(chat.getMessage('l1_1')?.leagueId === 'L1', `newItem() keeps it on the folded row (got ${JSON.stringify(chat.getMessage('l1_1')?.leagueId)})`);
  // The whole server path, stage by stage, in one place: a row's league_id
  // survives rowToMessage() -> the fold -> getMessages() (Home's read).
  const wireRow = strip(serverAdd('L1', { id: 'l1_pipe', body: 'through the pipeline' }));
  const ev = projection.rowToMessage(wireRow);
  chat.ingest([ev], undefined, { caughtUp: true });
  const viaRead = chat.getMessages({ types: ['message'], respectRetention: true }).find(m => m.id === 'l1_pipe');
  assert(wireRow.league_id === 'L1' && ev.leagueId === 'L1' && chat.getMessage('l1_pipe')?.leagueId === 'L1' && viaRead?.leagueId === 'L1',
    `a server row's league_id survives rowToMessage() (${JSON.stringify(ev.leagueId)}) -> the fold (${JSON.stringify(chat.getMessage('l1_pipe')?.leagueId)}) -> getMessages() (${JSON.stringify(viaRead?.leagueId)}), as camelCase leagueId`);
  const sentId = chat.sendMessage({ body: 'hello', author: 'mD1' });
  assert(chat.getMessage(sentId)?.leagueId === 'L1', `an optimistic local send is stamped with the active league at compose time (got ${JSON.stringify(chat.getMessage(sentId)?.leagueId)})`);
  chat.clearOutbox();
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[9] (c) the READ side never hands out another league\'s row, even if one is in the store…');
{
  await freshPage();
  await signInAs('u-drew', 'L1');
  chat._resetForTest();
  // The switch window itself: switchActiveLeague() moves the pointer, then
  // AWAITS the data hydrate, and only then emits SWITCH_END to the chokepoint.
  // For that whole round trip the store still holds the old room. This is that
  // window, made explicit: rows of two leagues in the store, pointer on L2.
  // x1 (the OTHER league's) is the NEWER of the two on purpose: a "latest"
  // read with no league filter would return it, so the latest* assertions
  // below cannot pass by ordering luck.
  chat.ingest([
    { id: 'x1', seq: 1, ts: BASE_TS + 2, type: 'message', author: 'mK', body: 'from L1', notify: true, leagueId: 'L1' },
    { id: 'x2', seq: 1, ts: BASE_TS + 1, type: 'message', author: 'mJ', body: 'from L2', notify: true, leagueId: 'L2' },
  ], 1, { caughtUp: true });
  localStorage.setItem('cfbp_supabase_active_league', 'L2');
  assert(JSON.stringify(roomIds()) === '["x2"]', `getMessages() returns only the active league's row (got ${JSON.stringify(roomIds())})`);
  assert(chat.getMessage('x1') === null && chat.getMessage('x2')?.id === 'x2', 'getMessage() refuses the other league\'s row and returns the active one');
  assert(chat.latestNotifying('mD2')?.id === 'x2', `latestNotifying() is the active league's (got ${JSON.stringify(chat.latestNotifying('mD2')?.id || null)})`);
  assert(chat.unreadCount('mD2', 'all') === 1, `unreadCount() counts the active league only (got ${chat.unreadCount('mD2', 'all')})`);
  assert(chat.latestUnreadNotifying('mD2')?.id === 'x2', 'latestUnreadNotifying() likewise');
  assert(JSON.stringify(chat.unreadAuthors('mD2', 'all')) === '["mJ"]', `unreadAuthors() likewise (got ${JSON.stringify(chat.unreadAuthors('mD2', 'all'))})`);
  localStorage.removeItem('cfbp_supabase_active_league');
  assert(roomIds().length === 0, `with NO active league in supabase mode, a league-stamped row is shown to nobody (got ${JSON.stringify(roomIds())})`);
  // A row with no stamp (a pre-SB-20 cache entry) is not guessed at.
  chat._resetForTest();
  localStorage.setItem('cfbp_supabase_active_league', 'L2');
  chat.ingest([{ id: 'legacy', seq: 1, ts: BASE_TS, type: 'message', author: 'mK', body: 'cached before SB-20', notify: true }], 1, { caughtUp: true });
  assert(JSON.stringify(roomIds()) === '["legacy"]', 'an UNSTAMPED row (a device cache written before this release) still reads — there is no league to compare, and the owner sweep already scopes that cache');
  // PIN mode is untouched.
  chat._resetForTest();
  auth.configureAuth({ authMode: 'pins' });
  chat.ingest([{ id: 'p1', seq: 1, ts: BASE_TS, type: 'message', author: 'mK', body: 'pin mode', notify: true, leagueId: 'L1' }], 1, { caughtUp: true });
  assert(JSON.stringify(roomIds()) === '["p1"]', 'authMode \'pins\' applies no league filter at all — byte-identical to before');
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[10] isPrivateRow(m) — the OR of the two private-row predicates (security W7)…');
{
  const hasFn = typeof chat.isPrivateRow === 'function';
  assert(hasFn, 'js/chat.js exports isPrivateRow()');
  if (hasFn) {
    const selfTest = { id: 'sys_test_' + 'b'.repeat(32), author: 'system', type: 'message', meta: { test: true } };
    const privLog = { id: 'sys_scribe_changelog_x__private', author: 'system', type: 'message', meta: { kind: 'scribeChangelog', playerId: 'mA' } };
    const pubLog = { id: 'sys_scribe_changelog_x', author: 'system', type: 'message', meta: { kind: 'scribeChangelog', playerId: '' } };
    const member = { id: 'm1', author: 'mA', type: 'message', meta: null };
    const forgedId = { id: 'sys_test_short', author: 'system', type: 'message', meta: { test: true } };
    const fixtures = [selfTest, privLog, pubLog, member, forgedId, null, undefined, {}];
    const agree = fixtures.every(m => chat.isPrivateRow(m) === (chat.isPrivateSelfTest(m) || chat.isPrivateScribeChangelog(m)));
    assert(agree, 'isPrivateRow(m) === isPrivateSelfTest(m) || isPrivateScribeChangelog(m) over every fixture, including null/undefined/{}');
    assert(chat.isPrivateRow(selfTest) && chat.isPrivateRow(privLog), '…true for the push self-test row and the private SCRIBE changelog row');
    assert(!chat.isPrivateRow(pubLog) && !chat.isPrivateRow(member) && !chat.isPrivateRow(forgedId), '…false for a public changelog, a member post and an off-shape sys_test_ id');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[11] isPrivateRow — THE WRITER ALLOW-LIST: every code path that writes `visible_to` is known, and its row shape is recognised…');
{
  // A private row is one with `visible_to` set. The client cannot read that
  // column (not in SB_MESSAGE_COLS, ungranted), so isPrivateRow() infers privacy
  // from SHAPE — which is only sound while every writer of `visible_to` produces
  // a shape it recognises. This section enumerates the writers from SOURCE, so a
  // third private-row writer added anywhere fails here until isPrivateRow() (and
  // the Home feed that relies on it) is taught its shape.
  const ROOT = fileURLToPath(new URL('.', import.meta.url));
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'vendor' || name === 'tests' || name.startsWith('.')) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (/\.(js|mjs|sql)$/.test(name)) out.push(p);
    }
    return out;
  };
  const files = [...walk(join(ROOT, 'js')), ...walk(join(ROOT, 'supabase'))];
  const writers = new Set();
  for (const f of files) {
    const rel = f.slice(ROOT.length);
    const src = readFileSync(f, 'utf8');
    const code = /\.sql$/.test(f)
      ? src.replace(/--[^\n]*/g, '')
      : src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    if (/\.sql$/.test(f)) {
      // An INSERT into messages that names visible_to in its column list.
      const re = /insert\s+into\s+public\.messages\s*\(([^)]*)\)/gi;
      let m;
      while ((m = re.exec(code))) {
        if (!/\bvisible_to\b/.test(m[1])) continue;
        const before = code.slice(0, m.index);
        const fn = [...before.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)/gi)].pop();
        writers.add(`${rel}:${fn ? fn[1] : '?'}`);
      }
    } else {
      // An assignment / object-literal key of visible_to (reads like `.is('visible_to', null)` are not writes).
      if (/\bvisible_to\s*=(?!=)|\bvisible_to\s*:/.test(code)) writers.add(rel);
    }
  }
  const ALLOWED = new Set([
    'supabase/migrations/0018_push_selftest.sql:send_test_push',
    'supabase/migrations/0026_b_roles_pilot.sql:send_test_push',
    'js/scribeChangelog.js',
  ]);
  const found = [...writers].sort();
  assert(found.length > 0, `fixture: the scan found the existing writers (${JSON.stringify(found)}) — an empty result would make the allow-list vacuous`);
  assert(found.every(w => ALLOWED.has(w)) && [...ALLOWED].every(w => writers.has(w)),
    `the writers of messages.visible_to are EXACTLY the allow-list: send_test_push (0018, redefined 0026) and js/scribeChangelog.js buildChangelogPost() (got ${JSON.stringify(found)})`);

  // ── SB-20 security F3 — A CENSUS, NOT A PATTERN HUNT ─────────────────────────
  // The write-shape regexes above miss whole families (security's scanprobe:
  // `row['visible_to'] =`, quoted / shorthand keys, Object.assign, an
  // unqualified `insert into messages`, UPDATE … SET, dynamic `execute format`).
  // So every NON-COMMENT occurrence of the token is accounted for instead: it is
  // a known WRITER line, a line matching the short READER allow-list, or one of
  // the NAMED non-writing lines below (DDL, privilege checks, message text, two
  // runtime readers) — exact file + exact line. Anything else fails, by file and
  // line, until somebody decides what it is. Plus one rule the token cannot see:
  // an SQL INSERT into messages must name its columns.
  const stripKeepLines = (src, sql) => (sql
    ? src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, '')
    : src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1'));
  const READER_RES = [
    /\.is\(\s*'visible_to'\s*,\s*null\s*\)/,
    /\bvisible_to is null\b/,
    /\bvisible_to = public\.my_member_id\(/,
  ];
  const WRITER_LINES = new Set([
    'supabase/migrations/0018_push_selftest.sql|emitted_by, visible_to, game_tag, body, target_id, reply_to, notify, meta)',
    'supabase/migrations/0026_b_roles_pilot.sql|emitted_by, visible_to, game_tag, body, target_id, reply_to, notify, meta)',
    'js/scribeChangelog.js|if (recipientId) row.visible_to = recipientId;',
  ]);
  const NAMED_LINES = new Set([
    // runtime READERS (a private row is dropped / targeted, nothing is written)
    'js/feed-cards.js|if (c.private === true || c.visibleTo || c.visible_to) return null;',
    "supabase/functions/_shared/job-rules.mjs|const directTo = record && record.visible_to ? String(record.visible_to) : '';",
    // DDL
    'supabase/migrations/0018_push_selftest.sql|alter table public.messages add column if not exists visible_to text;',
    'supabase/migrations/0018_push_selftest.sql|comment on column public.messages.visible_to is',
    // privilege / catalogue checks (they read grants, they write nothing)
    "supabase/migrations/0018_push_selftest.sql|and c.column_name in ('visible_to', 'emitted_by');",
    "supabase/migrations/0033_multisport_core.sql|if has_column_privilege(r.role_name, 'public.messages', 'visible_to', 'INSERT')",
    "supabase/migrations/0033_multisport_core.sql|if has_column_privilege(r.role_name, 'public.messages', 'visible_to', 'SELECT')",
    "supabase/migrations/0033_multisport_core.sql|where a.attrelid = 'public.messages'::regclass and a.attname in ('visible_to', 'emitted_by')",
    // message TEXT (exception / comment strings)
    "supabase/migrations/0018_push_selftest.sql|raise exception '0018: % is SECURITY DEFINER and therefore bypasses messages_select — it must carry its own visible_to predicate before this migration is applied', v_bad;",
    "supabase/migrations/0019_sys_test_reserved.sql|'client cannot detect the forgery: `visible_to` and `emitted_by` are both ungranted, so no '",
    "supabase/migrations/0025_scribe_changelog_reserved.sql|'`visible_to` and `emitted_by` are both ungranted, so no readable fact distinguishes a forged '",
    "supabase/migrations/0033_multisport_core.sql|raise exception 'cfbp 0033: authenticated INSERT columns on public.messages are %, expected exactly % (visible_to/emitted_by must never appear; sport_tag must)', v_ins, v_want_ins;",
    "supabase/migrations/0033_multisport_core.sql|raise exception 'cfbp 0033: % holds INSERT on messages.visible_to or messages.emitted_by', r.role_name;",
    "supabase/migrations/0033_multisport_core.sql|raise exception 'cfbp 0033: % can read messages.visible_to or messages.emitted_by', r.role_name;",
    "supabase/migrations/0033_multisport_core.sql|raise exception 'cfbp 0033: PUBLIC holds % INSERT/SELECT privilege(s) that reach messages.visible_to or messages.emitted_by', v_n;",
  ]);
  /** Every occurrence in `src` that is not accounted for, as `rel:line: text`. */
  const unaccounted = (rel, src) => {
    const sql = /\.sql$/.test(rel);
    const code = stripKeepLines(src, sql);
    const out = [];
    code.split('\n').forEach((line, i) => {
      if (!/\bvisible_to\b/.test(line)) return;
      const t = line.trim();
      if (READER_RES.some(re => re.test(t))) return;
      if (WRITER_LINES.has(`${rel}|${t}`) || NAMED_LINES.has(`${rel}|${t}`)) return;
      out.push(`${rel}:${i + 1}: ${t.slice(0, 120)}`);
    });
    if (sql) {
      const re = /insert\s+into\s+(?:public\.)?messages\b(?!\s*\()/gi;
      let m;
      while ((m = re.exec(code))) out.push(`${rel}:${code.slice(0, m.index).split('\n').length}: INSERT INTO messages with no column list`);
    }
    return out;
  };
  const strays = [];
  const seenNamed = new Set();
  for (const f of files) {
    const rel = f.slice(ROOT.length);
    const src = readFileSync(f, 'utf8');
    strays.push(...unaccounted(rel, src));
    stripKeepLines(src, /\.sql$/.test(rel)).split('\n').forEach(l => { const k = `${rel}|${l.trim()}`; if (WRITER_LINES.has(k) || NAMED_LINES.has(k)) seenNamed.add(k); });
  }
  assert(strays.length === 0,
    `F3 census — every non-comment \`visible_to\` in js/ and supabase/ is a known writer, a reader on the allow-list, or a named line (unaccounted: ${JSON.stringify(strays)})`);
  const stale = [...WRITER_LINES, ...NAMED_LINES].filter(k => !seenNamed.has(k));
  assert(stale.length === 0, `F3 census — every allow-listed line still exists, so the list cannot rot into blanket permission (stale: ${JSON.stringify(stale)})`);
  // CANARIES — security's scanprobe shapes, each of which the old scan missed.
  const CANARY_JS = {
    "row['visible_to'] = id": "row['visible_to'] = id;",
    "{ 'visible_to': id }": "insert({ 'visible_to': id })",
    '{ "visible_to": id }': 'insert({ "visible_to": id })',
    '{ visible_to } shorthand': 'const visible_to = id; insert({ league_id, visible_to })',
    'Object.assign(row, { visible_to })': 'Object.assign(row, { visible_to })',
    'row.visible_to = id': 'row.visible_to = id;',
  };
  const CANARY_SQL = {
    'insert into messages (…visible_to…) [no schema]': 'insert into messages (league_id, id, visible_to) values (1,2,3);',
    'update public.messages set visible_to': "update public.messages set visible_to = 'm1' where id = x;",
    'insert … select * from staging': 'insert into public.messages select * from staging_messages;',
    'execute format(insert … visible_to)': "execute format('insert into public.messages (league_id, visible_to) values (%L,%L)', a, b);",
  };
  const missedJs = Object.entries(CANARY_JS).filter(([, src]) => unaccounted('js/canary.js', src).length === 0).map(([k]) => k);
  const missedSql = Object.entries(CANARY_SQL).filter(([, src]) => unaccounted('supabase/migrations/9999_canary.sql', src).length === 0).map(([k]) => k);
  assert(missedJs.length === 0 && missedSql.length === 0,
    `F3 canaries — every write shape the old scan missed is now CAUGHT (missed JS: ${JSON.stringify(missedJs)}, missed SQL: ${JSON.stringify(missedSql)})`);
  const READER_OK = [
    ["supabase/functions/x/index.js", ".eq('league_id', l).is('visible_to', null).maybeSingle();"],
    ['supabase/migrations/9999_ok.sql', 'and (visible_to is null or visible_to = public.my_member_id(league_id))'],
    ['js/canary.js', '// a comment that mentions row.visible_to = x is not code'],
  ];
  assert(READER_OK.every(([rel, src]) => unaccounted(rel, src).length === 0),
    'F3 canaries — the three reader shapes, and a comment, are NOT flagged (non-vacuity of the allow-list)');
  if (typeof chat.isPrivateRow === 'function') {
    // Writer 1 — send_test_push's row, exactly as the SQL builds it, read back through the projection.
    const stp = projection.rowToMessage({ league_id: 'L1', id: 'sys_test_' + 'c0ffee'.repeat(5) + 'ab', seq: 9, ts: new Date(BASE_TS).toISOString(),
      type: 'message', author: 'system', game_tag: '', body: 'This is a test push.', target_id: '', reply_to: '', notify: true, meta: { test: true } });
    assert(chat.isPrivateRow(stp), 'send_test_push()\'s row shape (sys_test_<32 hex>, author system, meta.test) is recognised as private');
    // Writer 2 — buildChangelogPost(), the real function both Edge Functions call.
    const { buildChangelogPost } = await import('./js/scribeChangelog.js');
    const priv = buildChangelogPost({ leagueId: 'L1', learningId: 'lrn7', playerDisplayName: 'Kevin', playerId: 'mK', category: 'tone', instruction: 'less', origin: 'feedback' });
    const pub = buildChangelogPost({ leagueId: 'L1', learningId: 'lrn8', playerDisplayName: '', playerId: '', category: 'tone', instruction: 'less', origin: 'trainer' });
    assert(!!priv.visible_to && !pub.visible_to, 'fixture: buildChangelogPost() sets visible_to exactly when a player is credited');
    const asRead = (row) => { const { visible_to, author_kind, ...wire } = row; return projection.rowToMessage({ seq: 1, ts: new Date(BASE_TS).toISOString(), target_id: '', reply_to: '', ...wire }); };
    assert(chat.isPrivateRow(asRead(priv)), 'buildChangelogPost()\'s PRIVATE row, read back as the client sees it, is recognised as private');
    assert(!chat.isPrivateRow(asRead(pub)), '…and its PUBLIC (no credited player) row is not');
  }
}

const SEP = auth.IDENTITY_KEY_SEP;
/** A row that exists ONLY in this page's RAM — never on the server — so if the
 *  store is emptied it cannot be fetched back. No seq: it moves no cursor. */
function plantSentinel(leagueId) {
  chat.ingest([{ id: 'sentinel', ts: BASE_TS, type: 'message', author: 'mK', body: 'only in RAM', notify: true, leagueId }], undefined, { caughtUp: true });
}
function writeEventsCache(events, head) {
  localStorage.setItem('cfbp_chat_events_cache', JSON.stringify({ epoch: chat.getChatEpochSeq(), head, events }));
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[12] NO SPURIOUS RESET — a returning player\'s instant room survives the ordinary identity events…');
{
  // The phone as a returning player's holds it: Drew's League One room in the
  // device events cache (DI-169), DI-180q's marker naming Drew, the league
  // pointer on the device, and NO account resolved yet (the SDK has not
  // answered). The server holds NOTHING for League One here, so the cached rows
  // can only still be in the store later if nothing emptied it.
  await freshPage();
  writeEventsCache([
    { id: 'c1', seq: 1, ts: BASE_TS + 1, type: 'message', author: 'mK', body: 'cached one', notify: true, leagueId: 'L1' },
    { id: 'c2', seq: 2, ts: BASE_TS + 2, type: 'message', author: 'mK', body: 'cached two', notify: true, leagueId: 'L1' },
  ], 2);
  auth._setDeviceDataOwnerForTest(['u-drew', 'L1'].join(SEP));
  localStorage.setItem('cfbp_supabase_active_league', 'L1');
  await quiet(async () => { chat.startChatTransport(''); await settle(20); });
  assert(roomIds().includes('c1') && roomIds().includes('c2'), `fixture: the boot replay painted the cached room before any identity landed (${JSON.stringify(roomIds())})`);
  const sc = typeof chat._chatScopeForTest === 'function' ? chat._chatScopeForTest() : null;
  assert(sc && sc.account === 'u-drew' && sc.league === 'L1',
    `the replay took the store's scope from DI-180q's marker, not from the still-unresolved identity (got ${JSON.stringify(sc)})`);
  await signInAs('u-drew', 'L1');
  assert(roomIds().includes('c1') && roomIds().includes('c2'),
    `the SAME account resolving on the same league keeps the instant room — no reset on an ordinary boot (got ${JSON.stringify(roomIds())}). A reset here would throw away DI-169 on every cold start`);
  await quiet(async () => { auth._fireAuthEventForTest('TOKEN_REFRESHED', CURRENT_SESSION); await settle(40); });
  assert(roomIds().includes('c1'), '…and an hourly TOKEN_REFRESHED keeps it (F-1\'s over-firing case)');
  await quiet(async () => { await app.doSwitchActiveLeague('L1'); await settle(40); });
  assert(roomIds().includes('c1'), '…and re-selecting the league already active keeps it');
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[13] Sign Out vs expiry — a deliberate Sign Out empties the store; an expiry HOLDS it for the same account (A9)…');
{
  await freshPage();
  seedL1(3);
  await signInAs('u-a', 'L1');
  await startChat('mA');
  plantSentinel('L1');
  assert(!!chat.getMessage('sentinel'), 'fixture: a RAM-only row is in the store');
  // The account drops to nobody WITHOUT a deliberate Sign Out — the expiry
  // shape: the chokepoint is reached with discard false.
  await quiet(async () => { auth._setAccountUserIdForTest(''); await settle(20); });
  assert(!!chat.getMessage('sentinel'), 'an account lost WITHOUT a deliberate Sign Out (an expiry) HOLDS the store — the same player signing back in gets their room (A9)');
  await quiet(async () => { auth._setAccountUserIdForTest('u-a'); await settle(20); });
  assert(!!chat.getMessage('sentinel'), '…and the SAME account coming back keeps it');
  await quiet(async () => { auth._setAccountUserIdForTest(''); await settle(20); });
  await signInAs('u-b-same', 'L1');
  assert(!chat.getMessage('sentinel'), 'a DIFFERENT account arriving after that hold empties the store before B reads it');

  await freshPage();
  seedL1(3);
  await signInAs('u-a', 'L1');
  await startChat('mA');
  plantSentinel('L1');
  assert(chat.chatStatus().head === 3, `fixture: A's poll cursor sits at League One's head (got ${chat.chatStatus().head})`);
  await quiet(async () => { await auth.signOut(); await settle(60); });
  assert(!chat.getMessage('sentinel') && roomIds().length === 0,
    `a deliberate in-page Sign Out leaves nothing readable (got ${JSON.stringify(roomIds())})`);
  // The line above is ALSO satisfied by the read filter alone, because signOut()
  // clears the active-league pointer (auth.js _CLEAR_KEEP_KEYS note) and a
  // stamped row with no active league is shown to nobody. Mutation M6 proved
  // it. So the RESET itself is asserted on state the filter cannot mask:
  assert(chat.chatStatus().head === 0,
    `…and the store itself was EMPTIED, not merely hidden: the poll cursor is back to 0 (got ${chat.chatStatus().head})`);
  await signInAs('u-a', 'L1');
  assert(!chat.getMessage('sentinel'),
    '…so even the SAME account signing back in finds nothing left over from before its own deliberate Sign Out — only what the server hands it now');
  chat._resetForTest();

  // SB-20 security [P3] — the expiry case above used a test seam to drop the
  // account. This is the REAL involuntary path: the SDK fires SIGNED_OUT with
  // no deliberate signOut() in progress (auth.js reads it as an expiry), and
  // then an account arrives through each event shape the SDK can deliver.
  const sentinelInStore = () => {
    const ACTIVE = 'cfbp_supabase_active_league';
    const sav = localStorage.getItem(ACTIVE);
    localStorage.setItem(ACTIVE, 'L1');       // read on L1 so the league filter cannot hide what the store holds
    const r = !!chat.getMessage('sentinel');
    if (sav === null) localStorage.removeItem(ACTIVE); else localStorage.setItem(ACTIVE, sav);
    return r;
  };
  for (const [label, ev, acct, expectReset] of [
    ['the SAME account, SIGNED_IN (native resume / re-auth)', 'SIGNED_IN', 'u-a', false],
    ['a different account, SIGNED_IN (Google / password / magic link)', 'SIGNED_IN', 'u-b-same', true],
    ['a different account, PASSWORD_RECOVERY', 'PASSWORD_RECOVERY', 'u-b-same', true],
    ['a different account, TOKEN_REFRESHED', 'TOKEN_REFRESHED', 'u-b-same', true],
    ['a different account, INITIAL_SESSION', 'INITIAL_SESSION', 'u-b-same', true],
  ]) {
    await freshPage();
    seedL1(3);
    await signInAs('u-a', 'L1');
    await startChat('mA');
    plantSentinel('L1');
    CURRENT_SESSION = null;
    await quiet(async () => { auth._fireAuthEventForTest('SIGNED_OUT', null); await settle(40); });
    const heldAfterExpiry = sentinelInStore();
    CURRENT_SESSION = sessionFor(acct);
    localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, JSON.stringify(CURRENT_SESSION));
    auth._setMembershipsForTest(membershipsOf(acct));
    await quiet(async () => { auth._fireAuthEventForTest(ev, CURRENT_SESSION); await settle(60); });
    const kept = sentinelInStore();
    assert(heldAfterExpiry && kept === !expectReset,
      `[P3] involuntary SDK SIGNED_OUT (held: ${heldAfterExpiry}), then ${label}: store ${expectReset ? 'EMPTIED' : 'KEPT'} (account now ${auth.getAccountUserId()}, sentinel ${kept ? 'present' : 'gone'})`);
    chat._resetForTest();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[14] the COLD-BOOT handover — a handset that changed hands between sessions replays the previous player\'s cache…');
{
  await freshPage();
  const selfTestId = 'sys_test_' + 'd'.repeat(32);
  serverAdd('L1', { id: 'l1_1', body: 'public one' });
  serverAdd('L1', { id: 'l1_2', body: 'public two' });
  serverAdd('L1', { id: selfTestId, author: 'system', body: 'This is a test push.', meta: { test: true }, visibleTo: 'mA' });
  serverAdd('L1', { id: 'l1_4', body: 'public four' });
  // A's session expired while the app was closed (A9 keeps the cache for A);
  // the phone cold-boots and replays A's room before anyone is signed in.
  writeEventsCache(SRV.rows.get('L1').map(r => projection.rowToMessage(strip(r))), 4);
  auth._setDeviceDataOwnerForTest(['u-a', 'L1'].join(SEP));
  localStorage.setItem('cfbp_supabase_active_league', 'L1');
  await quiet(async () => { chat.startChatTransport(''); await settle(20); });
  assert(!!chat.getMessage(selfTestId), 'fixture: the replay put account A\'s private self-test row in the store');
  await signInAs('u-b-same', 'L1');
  assert(chat.getMessage(selfTestId) === null,
    'account B signing in on that phone never sees account A\'s private row out of A\'s replayed cache — the marker made A the store\'s owner, so B is a MOVE, not an adoption');
  await nextPoll();
  assert(['l1_1', 'l1_2', 'l1_4'].every(id => roomIds().includes(id)) && !roomIds().includes(selfTestId),
    `…and B's room loads under B's own RLS (got ${JSON.stringify(roomIds())})`);

  // The fail-closed half: a cache whose owner is a DIFFERENT resolved account is
  // not replayed at all (the shape of a DI-180q sweep that could not complete).
  chat._resetForTest();
  writeEventsCache([{ id: 'a_only', seq: 1, ts: BASE_TS, type: 'message', author: 'mA', body: 'A\'s cached words', notify: true, leagueId: 'L1' }], 1);
  auth._setDeviceDataOwnerForTest(['u-a', 'L1'].join(SEP));
  await quiet(async () => { chat.startChatTransport('mB'); await settle(20); });
  assert(chat.getMessage('a_only') === null,
    'with account B already resolved, a cache the marker says is account A\'s is NOT replayed');
  chat._resetForTest();

  // ── SB-20 review N1 — NO MARKER AT ALL, in the REAL early-boot window ──────
  // The reviewer's probe: A's cache on the device, DI-180q's owner marker
  // ABSENT, cold boot, B signs in. The replay runs from initChatUI({phase:
  // 'early'}) BEFORE config.json lands, when getAuthMode() still answers its
  // 'pins' DEFAULT on a Supabase device (auth.js SECURITY A-1-R) — so the guard
  // must read the device's last-known mode, or it never fires where it matters.
  await freshPage();
  const n1Priv = 'sys_test_' + '7'.repeat(32);
  serverAdd('L1', { id: 'l1_1', body: 'public one' });
  serverAdd('L1', { id: n1Priv, author: 'system', body: 'This is a test push.', meta: { test: true }, visibleTo: 'mA' });
  serverAdd('L1', { id: 'l1_3', body: 'public three' });
  writeEventsCache(SRV.rows.get('L1').map(r => projection.rowToMessage(strip(r))), 3);
  localStorage.setItem('cfbp_supabase_active_league', 'L1');
  auth.configureAuth({ authMode: 'pins' });                 // the pre-config DEFAULT, as boot sees it
  auth.setLastKnownAuthMode('supabase');                    // …on a device that has been Supabase before
  assert(auth.getDeviceDataOwner() === '' && auth.hasConfigBeenRead() === false && auth.getAuthMode() === 'pins',
    'fixture: no owner marker, config not read yet, getAuthMode() answering its pins default — the early-boot window');
  await quiet(async () => { chat.startChatTransport(''); await settle(20); });
  assert(chat.getMessage(n1Priv) === null && roomIds().length === 0,
    `N1 — on a Supabase device a cache with NO recorded owner is not replayed (store ${JSON.stringify(roomIds())}): DI-180q reads a missing marker as "not yours"`);
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  await signInAs('u-b-same', 'L1');
  await nextPoll();
  assert(chat.getMessage(n1Priv) === null && ['l1_1', 'l1_3'].every(id => roomIds().includes(id)),
    `N1 — so account B never reads account A's private row, and B's own room loads under B's RLS (got ${JSON.stringify(roomIds())})`);
  chat._resetForTest();

  // …and PIN mode, which has no marker at all, is unchanged.
  await freshPage();
  auth.configureAuth({ authMode: 'pins', authModeKnown: true });
  writeEventsCache([{ id: 'pin_1', seq: 1, ts: BASE_TS, type: 'message', author: 'p1', body: 'pin-era cache', notify: true }], 1);
  await quiet(async () => { chat.startChatTransport(''); await settle(20); });
  assert(!!chat.getMessage('pin_1'), 'N1 control — a PIN-mode device (no marker by design) still replays its cache exactly as before');
  chat._resetForTest();

  // ── SB-20 security [P2] — A's Sign Out could NOT remove the cache ──────────
  // F2's root cause: signOut() removed the owner marker even when the sweep
  // reported incomplete, leaving A's surviving cache with NO recorded owner.
  await freshPage();
  const p2Priv = 'sys_test_' + 'f'.repeat(32);
  const seedP2 = () => {
    serverAdd('L1', { id: 'l1_1', body: 'public one' });
    serverAdd('L1', { id: p2Priv, author: 'system', body: 'This is a test push.', meta: { test: true }, visibleTo: 'mA' });
    serverAdd('L1', { id: 'l1_3', body: 'public three' });
  };
  seedP2();
  await signInAs('u-a', 'L1');
  await startChat('mA');
  assert(!!localStorage.getItem('cfbp_chat_events_cache') && auth.getDeviceDataOwner() === ['u-a', 'L1'].join(SEP),
    'fixture: A\'s session wrote the events cache and the owner marker names A');
  const realRemove = globalThis.localStorage.removeItem;
  globalThis.localStorage.removeItem = (k) => { if (k === 'cfbp_chat_events_cache') return; return realRemove(k); };
  await quiet(async () => { await auth.signOut(); await settle(60); });
  globalThis.localStorage.removeItem = realRemove;
  assert(!!localStorage.getItem('cfbp_chat_events_cache'), 'fixture: the handset refused to remove the cache on A\'s Sign Out');
  assert(auth.getDeviceDataOwner() === ['u-a', 'L1'].join(SEP),
    `F2 — so signOut() LEFT the owner marker naming A (got ${JSON.stringify(auth.getDeviceDataOwner().split(SEP))}): the surviving cache stays attributed, never unowned`);
  const snap = new Map(store);
  await freshPage();                              // a reload: fresh module state…
  for (const [k, v] of snap) store.set(k, v);     // …on the same device storage
  seedP2();
  await quiet(async () => { chat.startChatTransport(''); await settle(20); });
  await signInAs('u-b-same', 'L1');
  await nextPoll();
  assert(chat.getMessage(p2Priv) === null,
    `[P2] account B never reads account A's private row from the cache A's Sign Out could not remove (room ${JSON.stringify(roomIds())})`);
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[15] this device\'s own unsent work across a reset…');
{
  await freshPage();
  seedL1(2); seedL2(2);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  const pendingId = chat.sendMessage({ body: 'typed in League One, not sent yet', author: 'mD1' });
  assert(!!chat.getMessage(pendingId), 'fixture: an optimistic League One send is in the store');
  await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
  assert(chat.getMessage(pendingId) === null,
    'after a switch to League Two, the send still queued for League One is not shown there');
  chat.clearOutbox();

  // A league-only move is the SAME person: their FAILED message is kept and
  // re-folded, invisible in the other league, back with its retry control on
  // return. (FAILED, not queued: a queued entry may be dropped by
  // flushOutbox()'s league term on the way, which is correct and timing-bound.)
  await freshPage();
  seedL1(2); seedL2(2);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  const keptId = chat.sendMessage({ body: 'failed in League One', author: 'mD1' });
  assert(chat._markFailedForTest(keptId), 'fixture: Drew has a FAILED League One message');
  await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
  assert(chat.getMessage(keptId) === null && chat.isFailed(keptId),
    'in League Two it is hidden, but still held as FAILED — the same person, not a handover');
  await quiet(async () => { await app.doSwitchActiveLeague('L1'); await settle(60); });
  assert(!!chat.getMessage(keptId) && chat.isFailed(keptId),
    'back in League One it is in the room again with its retry control — the reset re-folded this device\'s own unsent work');
  chat.clearOutbox();

  await freshPage();
  seedL1(2);
  await signInAs('u-a', 'L1');
  await startChat('mA');
  const failedId = chat.sendMessage({ body: 'A\'s words that failed to send', author: 'mA' });
  assert(chat._markFailedForTest(failedId) && chat.isFailed(failedId), 'fixture: account A has a FAILED message on this page');
  await quiet(async () => { await auth.signOut(); await settle(60); });
  await signInAs('u-b-same', 'L1');
  assert(!chat.isFailed(failedId) && chat.getMessage(failedId) === null,
    'account B inherits neither the sight of A\'s failed message nor the retry control for it');
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[16] late frames — a "Load earlier" page issued under account A lands after a same-league handover to B…');
{
  // The transport's own I6 check discards a late page when the LEAGUE moved or
  // the injected identity EPOCH moved. getIdentityEpoch is OPTIONAL in
  // installSupabaseChat() (it defaults to null), and this handover uses a seam
  // that bumps no epoch — so the only thing standing between A's RLS-scoped
  // page and B's store here is chat.js's own store generation.
  const backend = await import('./js/backend.js');
  await freshPage();
  transport._resetSupabaseChatForTest();
  transport.installSupabaseChat({ getClient: () => chatClient, getLeagueId: auth.getActiveLeagueId, rowToMessage: projection.rowToMessage, isReady: () => true });
  transport.setSupabaseDataModePredicate(() => true);
  const privId = 'sys_test_' + 'e'.repeat(32);
  serverAdd('L1', { id: privId, author: 'system', body: 'This is a test push.', meta: { test: true }, visibleTo: 'mA' });
  for (let i = 2; i <= 5; i++) serverAdd('L1', { id: `l1_${i}`, body: `public ${i}` });
  backend.setDataMode('supabase');            // backfill() runs only with a backend configured
  try {
    await signInAs('u-a', 'L1');
    // The room as A holds it after scrolling: rows 3-5, so "Load earlier" asks for seq < 3.
    chat.ingest(SRV.rows.get('L1').slice(2).map(r => projection.rowToMessage(strip(r))), 5, { caughtUp: true });
    SRV.holdBefore = (league, before) => league === 'L1' && before === 3;
    let pending = null;
    await quiet(async () => { pending = chat.backfill(10); await settle(20); });
    assert(SRV.held.some(h => h.before && h.seq === 3), 'fixture: A\'s "Load earlier" (before seq 3) is in flight — and under A\'s RLS it carries A\'s private self-test row');
    SRV.holdBefore = null;
    await quiet(async () => {
      auth._setMembershipsForTest(membershipsOf('u-b-same'));
      auth._setAccountUserIdForTest('u-b-same');   // no epoch bump: the transport cannot see this move
      await settle(40);
    });
    assert(storage.getSession().playerId === 'mB', `fixture: B is now the member on this page (got ${storage.getSession().playerId})`);
    let folded = -1;
    await quiet(async () => { SRV.held.forEach(h => h.release()); folded = await pending; await settle(20); });
    assert(chat.getMessage(privId) === null && folded === 0,
      `A's late "Load earlier" page folds NOTHING into B's store (folded ${folded}; private row present: ${!!chat.getMessage(privId)}) — refused by the store generation, independent of the transport's epoch`);
  } finally {
    backend.setDataMode('sheets');
    chat._resetForTest();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[17] THE SB-20 CONTRACT (Home security reviewer, 2026-10-01) — points 1 to 3, each pinned on state that tells the alternatives apart…');
{
  const ACTIVE = 'cfbp_supabase_active_league';
  await freshPage();
  seedL1(5); seedL2(2);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');

  // ── (1) the folded item carries the league as `leagueId`, camelCase ───────
  const item = chat.getMessage('l1_1');
  assert(!!item && Object.prototype.hasOwnProperty.call(item, 'leagueId') && item.leagueId === 'L1',
    `(1) a server row's folded item carries \`leagueId\` (camelCase) = 'L1' (got ${JSON.stringify(item && item.leagueId)})`);
  assert(!!item && !Object.prototype.hasOwnProperty.call(item, 'league_id'),
    '(1) …and NOT a snake_case `league_id` — home.js projectCandidate() reads `m.leagueId` and drops a row without it in supabase mode');
  const homeRead = chat.getMessages({ types: ['message'], respectRetention: true });
  assert(homeRead.length === 5 && homeRead.every(m => typeof m.leagueId === 'string' && m.leagueId === 'L1'),
    `(1) every row Home's own read (getMessages({types:['message'], respectRetention:true})) returns carries a non-empty \`leagueId\` matching the league (got ${JSON.stringify(homeRead.map(m => m.leagueId))})`);

  // ── (2a) server rows: the row's OWN league_id, never the requested league ──
  // The server answers League One's query with a row whose own league_id is
  // League Two. A fold that stamped the REQUESTED (or active) league would
  // record it as League One and show it in League One's room.
  SRV.foreignRows = (league) => (league === 'L1' ? [{
    league_id: 'L2', id: 'leak_l2', seq: 6, ts: new Date(BASE_TS + 9e6).toISOString(), type: 'message',
    author: 'mJ', game_tag: '', body: 'a League Two row in League One\'s answer', target_id: '', reply_to: '', notify: true, meta: null,
  }] : []);
  serverAdd('L1', { id: 'l1_6', body: 'League One message 6' });   // something new, so the poll reads a page
  await nextPoll();
  SRV.foreignRows = null;
  assert(SRV.calls.some(c => c.action === 'since' && c.league === 'L1' && c.seq === 5),
    'fixture: the poll asked for League One (since 5) — the foreign row came back in THAT answer');
  assert(chat.getMessage('l1_6')?.leagueId === 'L1', 'fixture: the page landed (League One\'s own new row is folded)');
  assert(chat.getMessage('leak_l2') === null && !roomIds().includes('leak_l2'),
    '(2) a row whose OWN league_id is League Two is not shown in League One even though it arrived in League One\'s answer — it was folded under its own league, not the requested one');
  localStorage.setItem(ACTIVE, 'L2');                 // the pointer only — no chokepoint, so no reset
  assert(chat.getMessage('leak_l2')?.leagueId === 'L2',
    `(2) …and the folded value IS 'L2', the row's own (read with League Two active: ${JSON.stringify(chat.getMessage('leak_l2')?.leagueId)})`);
  assert(chat.getMessage('l1_1') === null,
    '(2) …while League One\'s rows keep THEIR stamp at read time — reading under League Two does not re-record them as League Two');
  localStorage.setItem(ACTIVE, 'L1');

  // ── (2b) optimistic sends: the event's own compose-time stamp ─────────────
  const sentId = chat.sendMessage({ body: 'composed in League One', author: 'mD1' });
  assert(chat.getMessage(sentId)?.leagueId === 'L1', '(2) an optimistic send folds with its compose-time stamp, L1');
  localStorage.setItem(ACTIVE, 'L2');
  assert(chat.getMessage(sentId) === null,
    '(2) …and moving the pointer afterwards does not move it: with League Two active it is not League Two\'s (a read-time stamp would have claimed it)');
  localStorage.setItem(ACTIVE, 'L1');
  assert(chat.getMessage(sentId)?.leagueId === 'L1', '(2) …and back on League One it is still L1');
  chat.clearOutbox();

  // ── (3) the store RESETS on a league change — emptied, not just hidden ────
  await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
  await nextPoll();
  assert(anyIdFrom('l2_').length === 2, `(3) fixture: League Two's room loaded after the real switch (got ${JSON.stringify(anyIdFrom('l2_'))})`);
  localStorage.setItem(ACTIVE, 'L1');                 // pointer back WITHOUT the chokepoint — so nothing resets again
  assert(anyIdFrom('l1_').length === 0 && chat.getMessage('l1_1') === null,
    `(3) League One's rows are GONE from the store, not merely filtered: putting the pointer back on League One without a reset surfaces none of them (got ${JSON.stringify(anyIdFrom('l1_'))})`);
  localStorage.setItem(ACTIVE, 'L2');
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[18] SB-20 security F1 — an append IN FLIGHT across an account handover is never put back…');
{
  // Security's secprobe [P1] / [P1c]. flushOutbox() splices the batch out of
  // S.outbox BEFORE the await, so rescopeChat() cannot see it; on failure the
  // catch used to put it back — into B's FAILED set (attempt 3) or the requeue
  // and the persisted outbox (attempt 1) — after A's Sign Out had swept both.
  const backend = await import('./js/backend.js');
  // DETERMINISM (found by mutation run R8 under load): every attempt here is
  // made by the TEST. sendMessage() would arm the 750ms coalesced flush, and a
  // requeue arms setTimeout(flushOutbox, 2000·n) — on a loaded machine either can
  // fire mid-sequence and add an attempt. So the message is queued the way a
  // boot restores it (loadOutbox(): no timer), and only the outbox's own backoff
  // retry — identified by its callback, flushOutbox itself — is suppressed.
  let _seq = 0;
  const queueOutbox = (author, body, leagueId) => {
    const id = `sb20_out_${++_seq}`;
    localStorage.setItem('cfbp_chat_outbox2', JSON.stringify([{
      id, type: 'message', author, gameTag: '', body, targetId: '', replyTo: '', notify: true, meta: null,
      leagueId, local: true, _localTs: Date.now(),
    }]));
    chat._loadOutboxForTest();
    return id;
  };
  // REVIEWER BLOCK on 08b4aa1 (5/5 red at load ~34): the filter above matched
  // only `fn === flushOutbox`, so scheduleFlush()'s 750ms ARROW (armed by the
  // app's own What's New post) slipped through. freshPage() now keeps that post
  // out, every timer whose callback CALLS flushOutbox() is suppressed too, and
  // the fixtures count only appends that carry THIS section's event ids.
  const noOutboxRetries = noFlushTimers;
  const appendsFor = (id) => SRV.appendLog.filter(c => c.ids.includes(id)).length;
  const heldFor = (id) => SRV.heldAppends.filter(r => (r.ids || []).includes(id)).length;

  // HYGIENE FIRST — the actual root cause of the load-dependent "appends 3":
  // a PREVIOUS section's sendMessage() armed scheduleFlush()'s 750ms timer with
  // the real setTimeout, _resetForTest() did not clear it, and it fired inside
  // this section and spent an attempt. Pinned directly, with real timers.
  await freshPage();
  seedL1(1);
  backend.setDataMode('supabase');
  try {
    await signInAs('u-a', 'L1');
    await startChat('mA');
    storage.setWhatsNewPosted(app.APP_VERSION);
    chat.clearOutbox();
    chat.sendMessage({ body: 'arms the 750ms coalescing flush', author: 'mA' });   // REAL timers here
    chat._resetForTest();                                                          // a section boundary
    const id = queueOutbox('mA', 'queued after the boundary', 'L1');
    SRV.appendLog = [];
    await quiet(async () => { await new Promise(r => realSetTimeout(r, 900)); await settle(20); });
    assert(appendsFor(id) === 0 && SRV.appendLog.length === 0,
      `hygiene — a coalesced flush armed before _resetForTest() never fires after it (appends since the boundary: ${SRV.appendLog.length})`);
  } finally { backend.setDataMode('sheets'); chat.clearOutbox(); chat._resetForTest(); }

  // [P1] attempt 3 in flight -> the FAILED path.
  await freshPage();
  seedL1(2); seedL2(2);
  backend.setDataMode('supabase');
  noOutboxRetries();
  try {
    await signInAs('u-a', 'L1');
    await startChat('mA');
    const id = queueOutbox('mA', 'A typed this and it never sent', 'L1');
    await quiet(async () => { await chat.flushOutbox(); await settle(10); });   // attempt 1 fails, requeued
    await quiet(async () => { await chat.flushOutbox(); await settle(10); });   // attempt 2 fails, requeued
    assert(appendsFor(id) === 2 && chat._outboxForTest().some(e => e.id === id) && !chat.isFailed(id),
      `fixture: two failed attempts carrying this event, still queued (its appends ${appendsFor(id)}; all appends ${SRV.appendCalls})`);
    SRV.holdAppend = true;
    let p;
    await quiet(async () => { p = chat.flushOutbox(); await settle(10); });     // attempt 3 — IN FLIGHT
    assert(heldFor(id) === 1 && appendsFor(id) === 3, `fixture: attempt 3 of this event is in flight (held ${heldFor(id)}, its appends ${appendsFor(id)})`);
    await quiet(async () => { await auth.signOut(); await settle(60); });
    await signInAs('u-drew', 'L1');
    await quiet(async () => { SRV.heldAppends.forEach(r => r()); try { await p; } catch {} await settle(20); });
    assert(!chat.isFailed(id), '[P1a] after the handover, account A\'s in-flight send does NOT land in the FAILED set under account B (no retry control for B)');
    await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
    await quiet(async () => { await app.doSwitchActiveLeague('L1'); await settle(60); });
    assert(chat.getMessage(id) === null, '[P1b] …and account B never reads account A\'s unsent words out of the store, even after resets that re-fold the FAILED set');
  } finally { restoreTimers(); SRV.holdAppend = false; backend.setDataMode('sheets'); chat._resetForTest(); }

  // [P1c] attempt 1 in flight -> the requeue + persisted-outbox path.
  await freshPage();
  seedL1(2);
  backend.setDataMode('supabase');
  noOutboxRetries();
  try {
    await signInAs('u-a', 'L1');
    await startChat('mA');
    const id = queueOutbox('mA', 'A again', 'L1');
    SRV.holdAppend = true;
    let p;
    await quiet(async () => { p = chat.flushOutbox(); await settle(10); });
    assert(heldFor(id) === 1 && appendsFor(id) === 1, `fixture: attempt 1 of this event is in flight (held ${heldFor(id)}, its appends ${appendsFor(id)})`);
    await quiet(async () => { await auth.signOut(); await settle(60); });
    assert(localStorage.getItem('cfbp_chat_outbox2') === null, 'fixture: A\'s Sign Out swept the persisted outbox');
    await quiet(async () => { SRV.heldAppends.forEach(r => r()); try { await p; } catch {} await settle(20); });
    const raw = localStorage.getItem('cfbp_chat_outbox2');
    assert(!raw && !chat._outboxForTest().some(e => e.id === id),
      `[P1c] A's words are not re-queued or re-persisted after A's Sign Out swept them (persisted ${JSON.stringify(raw)})`);
  } finally { restoreTimers(); SRV.holdAppend = false; backend.setDataMode('sheets'); chat._resetForTest(); }

  // CONTROL — a LEAGUE-only move (same person) keeps today's behaviour: requeued.
  await freshPage();
  seedL1(2); seedL2(2);
  backend.setDataMode('supabase');
  noOutboxRetries();
  try {
    await signInAs('u-drew', 'L1');
    await startChat('mD1');
    const id = queueOutbox('mD1', 'Drew in League One', 'L1');
    SRV.holdAppend = true;
    let p;
    await quiet(async () => { p = chat.flushOutbox(); await settle(10); });
    assert(heldFor(id) === 1, `fixture: attempt 1 of this event is in flight (held ${heldFor(id)})`);
    await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
    await quiet(async () => { SRV.heldAppends.forEach(r => r()); try { await p; } catch {} await settle(20); });
    assert(chat._outboxForTest().some(e => e.id === id) || chat.isFailed(id),
      'control — after a LEAGUE-only switch the same person\'s failed attempt is still theirs (requeued); only an ACCOUNT move drops it');
  } finally { restoreTimers(); SRV.holdAppend = false; backend.setDataMode('sheets'); chat.clearOutbox(); chat._resetForTest(); }
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[19] SB-20 review B1 — the importer\'s message verifier hashes the EXPORT shape (rowToMessageEvent), and rowToMessage still carries leagueId…');
{
  // Uses only js/supabase-projection.js's exports. supabase/import/import-backup.mjs
  // is read as TEXT and never imported or executed.
  const exportEvents = [
    { seq: 1, id: 'm1', ts: BASE_TS, type: 'message', author: 'p1', gameTag: '', body: 'hi', targetId: '', replyTo: '', notify: false, meta: null },
    { seq: 2, id: 'm2', ts: BASE_TS + 5, type: 'message', author: 'scribe', gameTag: 'g1', body: 'roast', targetId: '', replyTo: 'm1', notify: true, meta: { x: 1 } },
  ];
  const rows = exportEvents.map(e => projection.messageToRow(e, { leagueId: 'L1', memberIds: new Set(['p1']) }));
  assert(typeof projection.rowToMessageEvent === 'function', 'js/supabase-projection.js exports rowToMessageEvent()');
  if (typeof projection.rowToMessageEvent === 'function') {
    assert(projection.canonicalize(exportEvents) === projection.canonicalize(rows.map(projection.rowToMessageEvent)),
      'B1 — messageToRow() -> rowToMessageEvent() round-trips HASH-EQUAL with export-shaped events (what verifyMessages() compares)');
    assert(rows.map(projection.rowToMessageEvent).every(ev => !Object.prototype.hasOwnProperty.call(ev, 'leagueId')),
      'B1 — the export-shaped event carries no leagueId');
  }
  assert(rows.every(r => projection.rowToMessage(r).leagueId === 'L1'), 'B1 — rowToMessage() still carries leagueId (the chat fold needs it)');
  assert(projection.canonicalize(exportEvents) !== projection.canonicalize(rows.map(projection.rowToMessage)),
    'B1 non-vacuity — through rowToMessage() the hash DIFFERS, which is exactly the false mismatch the helper exists to avoid');
  const ibSrc = readFileSync(new URL('./supabase/import/import-backup.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const vm = (ibSrc.match(/export function verifyMessages\([\s\S]*?\n\}/) || [''])[0];
  assert(!!vm, 'fixture: verifyMessages() was located in import-backup.mjs (read as text)');
  assert(/\.map\(\s*rowToMessageEvent\s*\)/.test(vm) && !/\browToMessage\b(?!Event)/.test(vm),
    'B1 text pin — verifyMessages() maps the database rows through rowToMessageEvent(), never rowToMessage()');
  assert(/import\s*\{[^}]*\browToMessageEvent\b[^}]*\}\s*from\s*'\.\.\/\.\.\/js\/supabase-projection\.js'/.test(ibSrc),
    'B1 text pin — import-backup.mjs imports rowToMessageEvent from js/supabase-projection.js');
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[20] SB-20 sibling — a mark-read that fires in the switch window does not write the old league\'s head as the new league\'s read cursor…');
{
  // Hooks the ONE moment that is the window in a real switchActiveLeague():
  // reconcileDeviceDataOwner() writes the owner marker AFTER the pointer and the
  // synthesized session have moved to League Two and BEFORE SWITCH_END reaches
  // the chokepoint. A 1s mark-read (chat-ui) firing there calls markSeen('all').
  await freshPage();
  seedL1(5); seedL2(3);
  await signInAs('u-drew', 'L1');
  await startChat('mD1');
  assert(chat.chatStatus().head === 5, 'fixture: the store holds League One at head 5');
  const realSet = globalThis.localStorage.setItem;
  let windowSeen = null;
  globalThis.localStorage.setItem = (k, v) => {
    if (k === 'cfbp_device_data_owner' && windowSeen === null) {
      windowSeen = { league: auth.getActiveLeagueId(), member: storage.getSession().playerId, head: chat.chatStatus().head };
      chat.markSeen('all');                        // the pending mark-read firing in the window
    }
    return realSet(k, v);
  };
  try { await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); }); }
  finally { globalThis.localStorage.setItem = realSet; }
  assert(!!windowSeen && windowSeen.league === 'L2' && windowSeen.member === 'mD2' && windowSeen.head === 5,
    `fixture: the mark fired IN the window — pointer and member already League Two's, store still League One's head (${JSON.stringify(windowSeen)})`);
  await nextPoll();
  assert(anyIdFrom('l2_').length === 3, 'fixture: League Two\'s room loaded');
  assert(chat.unreadCount('mD2', 'all') === 3,
    `the new league's three messages still count as UNREAD (got ${chat.unreadCount('mD2', 'all')}) — the window's mark did not write League One's head 5 as League Two's read cursor`);

  // chat-ui's half: a pending mark is CANCELLED by the rescope notification.
  chatUi._scheduleMarkReadForTest();
  assert(chatUi._markReadPendingForTest() === true, 'fixture: a mark-read is pending');
  chatUi._handleChatEventForTest('events', { added: 0, caughtUp: true, wasCaughtUp: true });
  assert(chatUi._markReadPendingForTest() === true, 'control — an ordinary delivery leaves the pending mark alone');
  chatUi._handleChatEventForTest('events', { added: 0, caughtUp: false, wasCaughtUp: false, rescoped: true });
  assert(chatUi._markReadPendingForTest() === false, 'the rescope notification cancels the pending mark — it belonged to the room that was just emptied');
  chat._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[21] SB-20 CLASS RULE (static) — every EFFECT after an await, on the success side AND the catch side, is preceded on THAT path by a store-generation check…');
{
  // WIDENED at security C-A (2026-10-01). The first cut asked only "is there a
  // compare somewhere after the await", which flushOutbox() satisfied with a
  // catch-side compare while its success side wrote unguarded. Now each EFFECT
  // is checked on its own path:
  //   • in a catch block whose try held the await: a compare inside that catch,
  //     before the effect;
  //   • anywhere else: a compare between the most recent await and the effect,
  //     with any catch block in that span EXCLUDED (a compare that only runs on
  //     the failure path does not guard the success path).
  // The generation must also be CAPTURED (`const g = S.scopeGen` /
  // `chatScopeGen()`) before that await. Effects before any await are exempt.
  const GEN = '(?:S\\.scopeGen|chatScopeGen\\(\\))';
  const CHAT_EFFECTS = /S\.items\.(?:set|delete|clear)\(|S\.outbox\s*=(?!=)|S\.outbox\.(?:push|splice|unshift)\(|S\.failed\.(?:set|delete|clear)\(|_eventsCacheBuf\s*=(?!=)|_eventsCacheBuf\.push\(|\bingest\(|_applyEpochLocally\(|\bitem\.(?:seq|ts|local)\s*=(?!=)|\bsettleAppend\(/g;
  const SCRIBE_EFFECTS = /\bscribeMentionDegraded\(|\bscribeAskRemote\(|\bsendEvent\(/g;
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
  /** Top-level functions, found the house way (an opener at column 0, closed by
   *  the next `}` at column 0; a one-line function is its own body). */
  const topFns = (code) => {
    const out = [];
    const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^\n]*$/gm;
    let m;
    while ((m = fnRe.exec(code))) {
      const line = m[0].trimEnd();
      const oneLiner = line.endsWith('}') && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length;
      const end = oneLiner ? m.index + m[0].length : code.indexOf('\n}', m.index) + 2;
      out.push({ fn: m[1], body: code.slice(m.index, end > m.index ? end : code.length) });
    }
    return out;
  };
  const catchRanges = (body) => {
    const out = [];
    const re = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
    let m;
    while ((m = re.exec(body))) {
      let depth = 0, i = m.index + m[0].length - 1;
      for (; i < body.length; i++) { if (body[i] === '{') depth++; else if (body[i] === '}' && --depth === 0) break; }
      out.push([m.index, i]);
    }
    return out;
  };
  /** Every effect after an await, with the path it is on and whether it is guarded. */
  const analyse = (src, EFFECTS) => {
    const found = [];
    for (const { fn, body } of topFns(strip(src))) {
      const awaits = [...body.matchAll(/\bawait\b/g)].map(a => a.index);
      if (!awaits.length) continue;
      const caps = [...body.matchAll(new RegExp(`const\\s+(\\w+)\\s*=\\s*${GEN}`, 'g'))].map(c => ({ name: c[1], at: c.index }));
      const ranges = catchRanges(body);
      for (const e of body.matchAll(new RegExp(EFFECTS.source, 'g'))) {
        const p = e.index;
        const prior = awaits.filter(a => a < p && !/^await\s+$/.test(body.slice(a, p)));   // not the effect's own await
        if (!prior.length) continue;
        const lastA = Math.max(...prior);
        const capNames = caps.filter(c => c.at < lastA).map(c => c.name);
        const cmp = capNames.length
          ? new RegExp(`\\b(?:${capNames.join('|')})\\s*!==\\s*${GEN}|${GEN}\\s*!==\\s*(?:${capNames.join('|')})\\b`)
          : /(?!)/;
        const inCatch = ranges.find(([s, en]) => p > s && p < en);
        let region, side;
        if (inCatch && lastA < inCatch[0]) { region = body.slice(inCatch[0], p); side = 'catch'; }
        else {
          side = 'success';
          let r = body.slice(lastA, p);
          for (const [s, en] of ranges) if (s > lastA && en < p) r = r.slice(0, s - lastA) + ' '.repeat(en - s + 1) + r.slice(en - lastA + 1);
          region = r;
        }
        found.push({ fn, effect: e[0].replace(/\s+/g, ''), side, guarded: cmp.test(region) });
      }
    }
    return found;
  };
  const chatSrc = readFileSync(new URL('./js/chat.js', import.meta.url), 'utf8');
  const scribeSrc = readFileSync(new URL('./js/scribeLines.js', import.meta.url), 'utf8');
  const chatFx = analyse(chatSrc, CHAT_EFFECTS);
  const scribeFx = analyse(scribeSrc, SCRIBE_EFFECTS);
  const fnsWith = (fx) => [...new Set(fx.map(f => f.fn))].sort();
  assert(JSON.stringify(fnsWith(chatFx)) === JSON.stringify(['backfill', 'flushOutbox', 'startFreshChat'])
      && chatFx.some(f => f.fn === 'flushOutbox' && f.side === 'success') && chatFx.some(f => f.fn === 'flushOutbox' && f.side === 'catch'),
    `fixture: chat.js's effect-after-await sites are found on both paths (functions ${JSON.stringify(fnsWith(chatFx))}; ${chatFx.length} effects)`);
  assert(JSON.stringify(fnsWith(scribeFx)) === JSON.stringify(['fireScribeMention']) && scribeFx.length >= 4,
    `fixture: scribeLines.js's effect-after-await sites are fireScribeMention()'s (${JSON.stringify(scribeFx.map(f => `${f.effect}@${f.side}`))})`);
  const badChat = chatFx.filter(f => !f.guarded).map(f => `${f.fn}:${f.effect}@${f.side}`);
  const badScribe = scribeFx.filter(f => !f.guarded).map(f => `${f.fn}:${f.effect}@${f.side}`);
  assert(badChat.length === 0,
    `CLASS RULE (js/chat.js) — every write to S.items / S.outbox / S.failed / _eventsCacheBuf and every settleAppend() after an await is guarded on its own path (unguarded: ${JSON.stringify(badChat)})`);
  assert(badScribe.length === 0,
    `CLASS RULE (js/scribeLines.js) — fireScribeMention() asks or posts nothing after an await without a chatScopeGen() check on that path (unguarded: ${JSON.stringify(badScribe)})`);
  // rescopeChat() settles every pending waiter, as scopeMoved, right after the bump.
  const rescopeBody = (strip(chatSrc).match(/export function rescopeChat\([\s\S]*?\n\}/) || [''])[0];
  const bumpAt = rescopeBody.indexOf('S.scopeGen++');
  const settleLine = (rescopeBody.match(/appendWaiters\.forEach\([^\n]*/) || [''])[0];
  assert(bumpAt > -1 && rescopeBody.indexOf('appendWaiters.forEach(') > bumpAt && /settleAppend\(/.test(settleLine) && /scopeMoved:\s*true/.test(settleLine),
    'C-A static — rescopeChat() settles EVERY pending append waiter (appendWaiters.forEach -> settleAppend, marked scopeMoved) after the generation bump');
  // Canaries — each shape the widened rule exists for.
  const canarySrc = [
    'async function leaky() {\n  const r = await f();\n  S.items.set(r.id, r);\n}',
    'async function catchOnly() {\n  const g = S.scopeGen;\n  try {\n    const r = await f();\n    S.items.set(r.id, r);\n  } catch {\n    if (g !== S.scopeGen) return;\n    S.failed.set(1, 2);\n  }\n}',
    'async function successOnly() {\n  const g = S.scopeGen;\n  try {\n    const r = await f();\n    if (g !== S.scopeGen) return;\n    S.items.set(r.id, r);\n  } catch {\n    settleAppend(1, new Error());\n  }\n}',
    'async function both() {\n  const g = S.scopeGen;\n  try {\n    const r = await f();\n    if (g !== S.scopeGen) return;\n    ingest([r]);\n  } catch {\n    if (g !== S.scopeGen) return;\n    S.outbox.push(1);\n  }\n}',
    'async function readOnly() {\n  const r = await f();\n  return r;\n}',
  ].join('\n');
  const c = analyse(canarySrc, CHAT_EFFECTS).map(f => `${f.fn}@${f.side}:${f.guarded}`);
  assert(JSON.stringify(c) === JSON.stringify(['leaky@success:false', 'catchOnly@success:false', 'catchOnly@catch:true', 'successOnly@success:true', 'successOnly@catch:false', 'both@success:true', 'both@catch:true']),
    `CLASS RULE canaries — unguarded caught; a CATCH-only compare does not guard the success path; a SUCCESS-only compare does not guard the catch; both pass; read-only is exempt (got ${JSON.stringify(c)})`);
  const scribeCanary = 'async function m() {\n  const g = chatScopeGen();\n  try {\n    await w();\n  } catch {\n    if (chatScopeGen() !== g) return false;\n    return scribeMentionDegraded({});\n  }\n  try {\n    const r = await scribeAskRemote({});\n    if (chatScopeGen() !== g) return false;\n    return scribeMentionDegraded({});\n  } catch {\n    if (chatScopeGen() !== g) return false;\n    return scribeMentionDegraded({});\n  }\n}';
  const sc = analyse(scribeCanary, SCRIBE_EFFECTS).map(f => `${f.effect}@${f.side}:${f.guarded}`);
  assert(sc.includes('scribeAskRemote(@success:false'),
    `CLASS RULE canary — with the post-wait check missing, the ASK is unguarded even though the first catch has a compare (got ${JSON.stringify(sc)})`);
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[22] SB-20 security C-A — an @scribe mention never asks or posts for an asker who has left…');
{
  // Security's secprobe3 [P5]. Account A's @scribe question is unacknowledged
  // when A signs out and B signs in. A's wait then rejected or timed out under
  // B and fireScribeMention() degrade-posted a canned SCRIBE line naming A —
  // under B's session, into B's active league, notify:true.
  const backend = await import('./js/backend.js');
  const scribeLines = await import('./js/scribeLines.js');
  const installCtx = (epoch) => {
    transport._resetSupabaseChatForTest();
    transport.installSupabaseChat({
      getClient: () => chatClient, getLeagueId: auth.getActiveLeagueId, rowToMessage: projection.rowToMessage, isReady: () => true,
      getSettings: () => ({ serverJobs: { scribeAsk: true } }),             // the scribe-ask client switch ON
      ...(epoch ? { getIdentityEpoch: auth.getIdentityEpoch } : {}),       // the production wiring, or chat.js alone
    });
    transport.setSupabaseDataModePredicate(() => true);
  };
  const isDegrade = (eid) => /^scribe_llm_/.test(eid);
  const degradeSent = () => SRV.appendLog.filter(c => c.ids.some(isDegrade));
  const degradeQueued = () => chat._outboxForTest().filter(e => isDegrade(e.id));
  const heldFor = (id) => SRV.heldAppends.filter(r => (r.ids || []).includes(id)).length;
  const MENTION = '@scribe who covers this week?';
  const wait = (ms) => new Promise(r => realSetTimeout(r, ms));
  const begin = async ({ epoch = true, acct = 'u-a', league = 'L1', member = 'mA' } = {}) => {
    await freshPage();
    seedL1(2); seedL2(2);
    installCtx(epoch);
    backend.setDataMode('supabase');
    scribeLines._setAppendWaitMsForTest(400);
    noFlushTimers();                                     // every outbox attempt is the test's (see §[18])
    await signInAs(acct, league);
    await startChat(member);
    // The sign-in's DI-180q sweep clears the device-local What's New ledger, so
    // the APP queues its own release post on the next navigation. Re-marked
    // here, AFTER the sign-in, and anything the app queued is dropped: the
    // test's question is the only thing in the outbox, and the only thing a
    // held flush can be holding.
    storage.setWhatsNewPosted(app.APP_VERSION);
    chat.clearOutbox();
    SRV.appendLog = []; SRV.invokes = [];
    const id = chat.sendMessage({ body: MENTION, author: member });
    let fire;
    await quiet(async () => { fire = scribeLines.scribeInspectMessage({ author: member, authorName: 'Alice', body: MENTION, triggerMessageId: id }); await settle(5); });
    return { id, fire };
  };
  const end = () => { restoreTimers(); SRV.holdAppend = false; SRV.holdInvoke = false; SRV.appendOk = false; backend.setDataMode('sheets'); scribeLines._setAppendWaitMsForTest(null); chat.clearOutbox(); chat._resetForTest(); };
  /** After the dust settles, send anything queued, so a post that WOULD have
   *  gone out is seen on the wire rather than only in a queue. */
  const drain = async () => { SRV.appendOk = true; await quiet(async () => { await chat.flushOutbox(); await settle(30); }); SRV.appendOk = false; };

  // ── the direct proof: a reset rejects a pending waiter AT ONCE, as scopeMoved ──
  // A QUEUED question is already answered by the chokepoint's clearOutbox() on
  // an account move ("This device changed hands…"). The reset is what reaches
  // the two waiters clearOutbox() cannot: an append IN FLIGHT (spliced out of
  // the queue) and a same-account LEAGUE move (the outbox is kept).
  const watch = (id) => {
    const w = { outcome: 'pending' };
    chat.whenAppended(id, { timeoutMs: 30000 }).then(() => { w.outcome = 'resolved'; }, (e) => { w.outcome = e && e.scopeMoved === true ? 'scopeMoved' : `rejected:${e && e.message}`; });
    return w;
  };
  try {
    const { id } = await begin();
    const w = watch(id);
    SRV.holdAppend = true;
    await quiet(async () => { chat.flushOutbox(); await settle(10); });
    assert(w.outcome === 'pending' && heldFor(id) === 1, 'fixture: a 30s wait is pending on A\'s @scribe question, whose append is IN FLIGHT');
    await quiet(async () => { await auth.signOut(); await settle(40); });
    assert(w.outcome === 'scopeMoved',
      `C-A — A's Sign Out rejects the in-flight question's wait IMMEDIATELY, marked scopeMoved, instead of leaving it to time out under the next account (got ${w.outcome})`);
  } finally { end(); }
  try {
    const { id } = await begin({ acct: 'u-drew', member: 'mD1' });
    const w = watch(id);
    await settle(5);
    assert(w.outcome === 'pending', 'fixture: a 30s wait is pending on a QUEUED @scribe question (same account, two leagues)');
    await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(40); });
    assert(w.outcome === 'scopeMoved',
      `C-A — a same-account LEAGUE switch (no clearOutbox) rejects it too, marked scopeMoved (got ${w.outcome})`);
  } finally { end(); }

  // ── the P5 matrix ──────────────────────────────────────────────────────────
  for (const outcome of ['fail', 'success']) {
    for (const [bAcct, bLeague, where] of [['u-b-same', 'L1', 'the SAME league'], ['u-b-other', 'L2', 'ANOTHER league']]) {
      for (const epoch of [true, false]) {
        const label = `append ${outcome === 'fail' ? 'FAILS' : 'SUCCEEDS'} after the handover, B in ${where} (${epoch ? 'production epoch wired' : 'NO epoch: chat.js alone'})`;
        try {
          const { id, fire } = await begin({ epoch });
          SRV.holdAppend = true;
          let p;
          await quiet(async () => { p = chat.flushOutbox(); await settle(10); });
          assert(heldFor(id) === 1, `[P5] ${label}: fixture — A's question is in flight at the handover`);
          await quiet(async () => { await auth.signOut(); await settle(60); });
          await signInAs(bAcct, bLeague);
          SRV.holdAppend = false;
          await quiet(async () => { SRV.heldAppends.forEach(r => r(outcome === 'success')); try { await p; } catch {} await settle(30); });
          let result = 'pending';
          await quiet(async () => { await wait(600); await settle(30); try { result = await fire; } catch { result = 'threw'; } });
          await drain();
          assert(SRV.invokes.length === 0 && degradeSent().length === 0 && degradeQueued().length === 0 && result === false,
            `[P5] ${label}: nothing is asked (scribe-ask calls ${SRV.invokes.length}) and nothing is posted (degrade sends ${degradeSent().length}, queued ${degradeQueued().length}) for A under B's session — fireScribeMention answered ${JSON.stringify(result)}`);
        } finally { end(); }
      }
    }
  }

  // ── the same person switches LEAGUE while the question waits ───────────────
  try {
    const { id, fire } = await begin({ acct: 'u-drew', member: 'mD1' });
    SRV.holdAppend = true;
    let p;
    await quiet(async () => { p = chat.flushOutbox(); await settle(10); });
    assert(heldFor(id) === 1, '[P5] league switch: fixture — the question is in flight');
    await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
    SRV.holdAppend = false;
    await quiet(async () => { SRV.heldAppends.forEach(r => r(true)); try { await p; } catch {} await settle(30); });
    let result = 'pending';
    await quiet(async () => { await wait(600); await settle(30); try { result = await fire; } catch { result = 'threw'; } });
    await drain();
    assert(SRV.invokes.length === 0 && degradeSent().length === 0 && degradeQueued().length === 0 && result === false,
      `[P5] a League One @scribe question whose wait straddles a switch to League Two asks nothing and posts nothing into League Two (asks ${SRV.invokes.length}, degrade sends ${degradeSent().length})`);
  } finally { end(); }

  // ── the ASK itself in flight across the handover ───────────────────────────
  try {
    const { id, fire } = await begin();
    SRV.appendOk = true;
    SRV.holdInvoke = true;
    SRV.invokeAnswer = { ok: true, unavailable: true, responseMessageId: null };   // a non-answer -> the degrade branch
    await quiet(async () => { await chat.flushOutbox(); await settle(30); });
    SRV.appendOk = false;
    assert(SRV.invokes.length === 1 && SRV.invokes[0].acct === 'u-a' && SRV.heldInvokes.length === 1,
      `[P5] ask in flight: fixture — A's question landed and scribe-ask was called under A and is still in flight (${JSON.stringify(SRV.invokes.map(i => i.acct))})`);
    await quiet(async () => { await auth.signOut(); await settle(60); });
    await signInAs('u-b-other', 'L2');
    let result = 'pending';
    await quiet(async () => { SRV.heldInvokes.forEach(r => r()); await settle(30); try { result = await fire; } catch { result = 'threw'; } });
    await drain();
    assert(degradeSent().length === 0 && degradeQueued().length === 0 && result === false,
      `[P5] a non-answer that comes back AFTER the handover is not turned into a canned line under B (degrade sends ${degradeSent().length}, queued ${degradeQueued().length}; answered ${JSON.stringify(result)})`);
    void id;
  } finally { end(); }

  // ── POSITIVE CONTROLS — with no handover, nothing about @scribe changed ────
  try {
    const { id, fire } = await begin();
    SRV.appendOk = true;
    await quiet(async () => { await chat.flushOutbox(); await settle(30); });
    SRV.appendOk = false;
    let result = 'pending';
    await quiet(async () => { await settle(30); try { result = await fire; } catch { result = 'threw'; } });
    assert(SRV.invokes.length === 1 && SRV.invokes[0].acct === 'u-a' && SRV.invokes[0].trigger === id && result === true,
      `control — with no handover, scribe-ask IS called, under A, for A's question (${JSON.stringify(SRV.invokes)}; answered ${JSON.stringify(result)})`);
    assert(degradeSent().length === 0 && degradeQueued().length === 0, 'control — …and an answered question posts no canned line');
  } finally { end(); }
  try {
    const { id, fire } = await begin();
    let result = 'pending';
    await quiet(async () => { await wait(600); await settle(30); try { result = await fire; } catch { result = 'threw'; } });
    const deg = chat.getMessage(`scribe_llm_${id}`.replace(/[^a-zA-Z0-9_:-]/g, ''));
    assert(result === true && !!deg && deg.author === 'scribe' && deg.leagueId === 'L1' && SRV.invokes.length === 0,
      `control — with no handover, a question whose send never lands still gets the canned degrade, for A, in League One (answered ${JSON.stringify(result)}; degrade ${deg ? JSON.stringify({ author: deg.author, league: deg.leagueId }) : 'missing'})`);
  } finally { end(); }
}

// ═══════════════════════════════════════════════════════════════════════════
_realLog('\n[23] C-U3 (SP-53 League Settings UI security condition, v0.29.0 batch-5a integration, 2026-10-01) — leaving a league empties the chat store in EVERY landing…');
{
  // The leave goes through the REAL js/auth.js leaveLeague() adapter (leave_league -> dropMirror -> the membership refresh that moves the pointer ->
  // app.js's identity chokepoint -> rescopeChat()), then js/app.js's real post-leave landing (lsLandAfterLeave(), which lsFinishAfterLeave() ends in).
  // The three landings are js/league-settings.js landingAfterLeave()'s: NONE remain (pointer null, the no-league landing), ONE remains (the refresh
  // auto-activates it), TWO OR MORE remain (pointer null, Leagues Home). Only the server is fake: leave_league removes the membership, so the refresh
  // and RLS both stop answering for League One.
  LEAGUE_NAMES.L3 = 'League Three';
  const LSmod = await import('./js/league-settings.js');
  const realRpc = authClient.rpc;
  const ACTIVE = 'cfbp_supabase_active_league';
  /** What the STORE holds of League One — read with the pointer on L1 so the read-side league filter cannot hide it ([P3]'s and [17](3)'s technique). */
  const l1InStore = () => {
    const sav = localStorage.getItem(ACTIVE);
    localStorage.setItem(ACTIVE, 'L1');
    const r = { rows: anyIdFrom('l1_'), direct: !!chat.getMessage('l1_1') };
    if (sav === null) localStorage.removeItem(ACTIVE); else localStorage.setItem(ACTIVE, sav);
    return r;
  };
  const l1OnDisk = () => {
    const cache = JSON.parse(localStorage.getItem('cfbp_chat_events_cache') || '{"events":[]}');
    return (cache.events || []).map(e => String(e && e.id)).filter(id => id.startsWith('l1_'));
  };
  for (const [label, acct, seats, expectLanding, expectPointer] of [
    ['NONE remain (the no-league landing)', 'u-leave0', { L1: 'mX1' }, 'none', null],
    ['ONE remains (auto-activated)', 'u-leave1', { L1: 'mY1', L2: 'mY2' }, 'single', 'L2'],
    ['TWO OR MORE remain (Leagues Home)', 'u-leave2', { L1: 'mZ1', L2: 'mZ2', L3: 'mZ3' }, 'many', null],
  ]) {
    try {
      await freshPage();
      ACCOUNTS[acct] = { ...seats };
      seedL1(5); seedL2(3);
      serverAdd('L3', { id: 'l3_1', author: 'mJ', body: 'League Three message 1' });
      await signInAs(acct, 'L1');
      await startChat(seats.L1);
      const before = l1InStore();
      assert(before.rows.length === 5 && before.direct && l1OnDisk().length === 5,
        `C-U3 ${label}: fixture — the store (read through the same pointer-swap the assertion below uses) and the device cache hold League One's five rows before the leave (store ${before.rows.length}, cache ${l1OnDisk().length})`);
      authClient.rpc = async (fn, args) => {
        if (fn === 'leave_league') { delete ACCOUNTS[acct][String(args && args.p_league)]; return { data: 'left', error: null }; }
        return realRpc(fn, args);
      };
      let outcome = null;
      await quiet(async () => {
        outcome = await auth.leaveLeague('L1', { role: 'player' });
        await settle(60);
        app._lsLandAfterLeaveForTest();
        await settle(60);
      });
      const landing = LSmod.landingAfterLeave(auth.getCachedMemberships());
      assert(!!outcome && outcome.status === 'done' && landing === expectLanding && (auth.getActiveLeagueId() || null) === expectPointer,
        `C-U3 ${label}: fixture — leave_league succeeded through the real adapter and the refresh landed where SP-53 says (outcome ${JSON.stringify(outcome)}, landing ${landing}, pointer ${JSON.stringify(auth.getActiveLeagueId())})`);
      await nextPoll();   // the next delivery is what would write a stale buffer back to the device cache
      const after = l1InStore();
      assert(after.rows.length === 0 && !after.direct,
        `C-U3 ${label}: NO League One row remains in the chat store after leave_league — emptied, not merely hidden by the read filter (store still holds ${JSON.stringify(after.rows)}; chat scope ${JSON.stringify(chat._chatScopeForTest())})`);
      assert(l1OnDisk().length === 0,
        `C-U3 ${label}: …and no League One row is in, or written back to, the device events cache (${JSON.stringify(l1OnDisk())})`);
      if (expectPointer) {
        assert(anyIdFrom('l2_').length === 3,
          `C-U3 ${label}: …while the remaining league's own room loads in full (${JSON.stringify(roomIds())})`);
      }
    } finally {
      authClient.rpc = realRpc;
      delete ACCOUNTS[acct];
      chat._resetForTest();
    }
  }

  // ── C-U3, the rest of the condition (bugfixer, 2026-10-01) ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // The three landings above are the report. What follows is the rest of the class: the same gap reached WITHOUT leave_league (b), what a rejoin may
  // bring back (c), the account term with the pointer already null (d), the boundary the fix must not cross (e: "not resolved yet" never wipes), and the
  // one case where a resolved list ends the store's league while the identity key does NOT move (f). Every store read swaps the pointer onto the league
  // being asked about, so the read-side league filter cannot hide a row the store still holds.
  /** Is `id` in the STORE — read with the pointer on `league` (null = none) for the duration of one getMessage(). */
  const inStoreOn = (league, id) => {
    const sav = localStorage.getItem(ACTIVE);
    if (league) localStorage.setItem(ACTIVE, league); else localStorage.removeItem(ACTIVE);
    const r = !!chat.getMessage(id);
    if (sav === null) localStorage.removeItem(ACTIVE); else localStorage.setItem(ACTIVE, sav);
    return r;
  };
  const onDisk = (id) => {
    const cache = JSON.parse(localStorage.getItem('cfbp_chat_events_cache') || '{"events":[]}');
    return (cache.events || []).some(e => String(e && e.id) === id);
  };
  const scopeLeague = () => { const s = chat._chatScopeForTest(); return s ? s.league : null; };
  /** Real-time wait — the transport's own timers run on real time. True as soon as `pred()` holds; false once `ms` has passed without it. */
  const waitFor = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (pred()) return true; await new Promise(r => setTimeout(r, 25)); }
    return !!pred();
  };
  const seedThree = () => { seedL1(5); seedL2(3); serverAdd('L3', { id: 'l3_1', author: 'mJ', body: 'League Three message 1' }); };
  /** The fake server's leave_league (removes the seat) and, when asked, join_league (gives it back under `rejoinAs`). */
  const leaveRpc = (acct, { rejoinAs = null } = {}) => async (fn, args) => {
    if (fn === 'leave_league') { delete ACCOUNTS[acct][String(args && args.p_league)]; return { data: 'left', error: null }; }
    if (fn === 'join_league' && rejoinAs) { ACCOUNTS[acct].L1 = rejoinAs; return { data: rejoinAs, error: null }; }
    return realRpc(fn, args);
  };
  /** The leave exactly as the landings above drive it: the real adapter, then app.js's real post-leave landing. */
  const leaveL1 = async () => {
    let o = null;
    await quiet(async () => { o = await auth.leaveLeague('L1', { role: 'player' }); await settle(60); app._lsLandAfterLeaveForTest(); await settle(60); });
    return o;
  };

  // (b) COMMISSIONER REMOVAL — no leave_league at all. A commissioner removes the seat server-side while the player is signed in on League One, and the
  // player's membership list is re-read (refreshMembershipsAndSession(), which every membership change ends in). A RAM-only sentinel rides along: it is on
  // no server and in no cache, so it can only still be there if the store was not emptied.
  for (const [label, acct, seats, expectPointer] of [
    ['NONE remain', 'u-rm0', { L1: 'mR1' }, null],
    ['ONE remains', 'u-rm1', { L1: 'mS1', L2: 'mS2' }, 'L2'],
    ['TWO OR MORE remain', 'u-rm2', { L1: 'mT1', L2: 'mT2', L3: 'mT3' }, null],
  ]) {
    try {
      await freshPage();
      ACCOUNTS[acct] = { ...seats };
      seedThree();
      await signInAs(acct, 'L1');
      await startChat(seats.L1);
      plantSentinel('L1');
      const before = l1InStore();
      assert(before.rows.length === 5 && inStoreOn('L1', 'sentinel') && l1OnDisk().length === 5,
        `C-U3 commissioner removal, ${label}: fixture — League One's five rows and a RAM-only sentinel are in the store, the five rows in the device cache (store ${before.rows.length}, cache ${l1OnDisk().length})`);
      delete ACCOUNTS[acct].L1;   // the commissioner's removal: the membership read and RLS both stop answering for League One
      await quiet(async () => { try { await auth.refreshMembershipsAndSession(); } catch {} await settle(60); });
      assert(auth.hasResolvedMemberships() && !auth.getCachedMemberships().some(m => m.leagueId === 'L1') && (auth.getActiveLeagueId() || null) === expectPointer,
        `C-U3 commissioner removal, ${label}: fixture — the re-read list no longer has League One and the pointer is ${JSON.stringify(expectPointer)} (got ${JSON.stringify(auth.getActiveLeagueId())}, leagues ${JSON.stringify(auth.getCachedMemberships().map(m => m.leagueId))})`);
      await nextPoll();
      const after = l1InStore();
      assert(after.rows.length === 0 && !after.direct && !inStoreOn('L1', 'sentinel') && scopeLeague() !== 'L1',
        `C-U3 commissioner removal, ${label}: NO League One row (the RAM-only sentinel included) remains in the chat store, and the store is no longer scoped to League One (store ${JSON.stringify(after.rows)}, sentinel ${inStoreOn('L1', 'sentinel')}, scope ${JSON.stringify(chat._chatScopeForTest())})`);
      assert(l1OnDisk().length === 0,
        `C-U3 commissioner removal, ${label}: …and no League One row is in, or written back to, the device events cache (${JSON.stringify(l1OnDisk())})`);
    } finally {
      delete ACCOUNTS[acct];
      chat._resetForTest();
    }
  }

  // (c) REJOIN — after leaving, the player rejoins League One. Every League One read the server would answer is HELD from the rejoin on, so anything of
  // League One in the store before the release can only have come from memory; only the released, fresh read may bring the room back.
  for (const [label, acct, seats] of [
    ['from the no-league landing', 'u-rj0', { L1: 'mU1' }],
    ['from Leagues Home', 'u-rj2', { L1: 'mV1', L2: 'mV2', L3: 'mV3' }],
  ]) {
    try {
      await freshPage();
      ACCOUNTS[acct] = { ...seats };
      seedThree();
      await signInAs(acct, 'L1');
      await startChat(seats.L1);
      plantSentinel('L1');
      authClient.rpc = leaveRpc(acct, { rejoinAs: seats.L1 });
      const left = await leaveL1();
      await nextPoll();
      SRV.holdSince = (league) => league === 'L1';
      let joined = null;
      await quiet(async () => { joined = await auth.joinLeague('CU3REJOIN'); await settle(60); });
      assert(!!left && left.status === 'done' && !!joined && joined.leagueId === 'L1' && auth.getActiveLeagueId() === 'L1' && storage.getSession().playerId === seats.L1,
        `C-U3 rejoin ${label}: fixture — left League One, then rejoined it through the real adapters; the pointer and the seat are back (left ${JSON.stringify(left)}, joined ${JSON.stringify(joined && joined.leagueId)}, pointer ${JSON.stringify(auth.getActiveLeagueId())}, member ${storage.getSession().playerId})`);
      // REVIEWER C2 — NO forceRefresh() FROM HERE ON. The leave-ended reset restarted the subscription with the cursor at 0. While the pointer was null
      // its ticks could not fetch, so they spent no boot rung (chatTransport.js:1548-1565, RG-98 F1) and kept rescheduling on the first, 1s rung
      // (:1283). The read below is the transport's OWN next tick after the rejoin (known 0 -> drainSince(0), no head probe); nothing in the join path
      // wakes chat, and this test asks for no refresh.
      const t0 = Date.now();
      let issued = false;
      await quiet(async () => { issued = await waitFor(() => SRV.held.some(h => h.league === 'L1' && !h.before && h.seq === 0), 5000); });
      assert(issued,
        `C-U3 rejoin ${label}: with no refresh asked for by this test, the transport's own next tick (the 1s boot rung) issues a fresh League One read from seq 0, and it is the one being held (issued ${issued} ${Date.now() - t0}ms after the rejoin settled; held ${JSON.stringify(SRV.held.map(h => [h.league, h.seq]))})`);
      assert(anyIdFrom('l1_').length === 0 && !chat.getMessage('l1_1') && !chat.getMessage('sentinel'),
        `C-U3 rejoin ${label}: before any fresh League One read lands, NOTHING of the old room is back — no server row and not the RAM-only sentinel (room ${JSON.stringify(roomIds())}; League One reads held ${SRV.held.length})`);
      assert(l1OnDisk().length === 0 && !onDisk('sentinel'),
        `C-U3 rejoin ${label}: …and none of it was written back to the device events cache (${JSON.stringify(l1OnDisk())})`);
      SRV.holdSince = null;
      await quiet(async () => { SRV.held.splice(0).forEach(h => h.release()); await settle(60); await waitFor(() => anyIdFrom('l1_').length === 5, 3000); });
      assert(anyIdFrom('l1_').length === 5 && !chat.getMessage('sentinel') && !onDisk('sentinel'),
        `C-U3 rejoin ${label}: the room comes back ONLY through the fresh server read — League One's five rows, and never the RAM-only sentinel, in the store or on disk (room ${JSON.stringify(roomIds())})`);
    } finally {
      SRV.holdSince = null;
      SRV.held.splice(0).forEach(h => { try { h.release(); } catch {} });
      authClient.rpc = realRpc;
      delete ACCOUNTS[acct];
      chat._resetForTest();
    }
  }

  // (d) AN ACCOUNT CHANGE WHILE THE POINTER IS NULL STILL RESETS — SB-20's account term, asserted rather than assumed. The player has left League One and
  // sits on Leagues Home (pointer null); the second person is in TWO leagues, so their sign-in leaves the pointer null as well.
  ACCOUNTS['u-np-b'] = { L2: 'mW2', L3: 'mW3' };
  for (const [label, how] of [
    ['a deliberate Sign Out', 'signout'],
    ['an expiry, then a DIFFERENT account', 'expiry-then-b'],
    ['a DIFFERENT account signing straight in', 'handover'],
  ]) {
    const acct = 'u-np-a';
    try {
      await freshPage();
      ACCOUNTS[acct] = { L1: 'mN1', L2: 'mN2', L3: 'mN3' };
      seedThree();
      await signInAs(acct, 'L1');
      await startChat('mN1');
      authClient.rpc = leaveRpc(acct);
      await leaveL1();
      authClient.rpc = realRpc;
      plantSentinel('L2');   // RAM-only, stamped with a league this account is still in
      assert(auth.getActiveLeagueId() === null && inStoreOn('L2', 'sentinel'),
        `C-U3 null pointer + ${label}: fixture — the player is on Leagues Home (pointer ${JSON.stringify(auth.getActiveLeagueId())}) with a RAM-only row in the store`);
      let held = null;
      if (how === 'signout') {
        await quiet(async () => { await auth.signOut(); await settle(60); });
      } else {
        if (how === 'expiry-then-b') {
          CURRENT_SESSION = null;
          await quiet(async () => { auth._fireAuthEventForTest('SIGNED_OUT', null); await settle(40); });
          held = inStoreOn('L2', 'sentinel');
        }
        CURRENT_SESSION = sessionFor('u-np-b');
        localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, JSON.stringify(CURRENT_SESSION));
        await quiet(async () => { auth._fireAuthEventForTest('SIGNED_IN', CURRENT_SESSION); await settle(60); });
      }
      assert((how === 'signout' ? !auth.getAccountUserId() : auth.getAccountUserId() === 'u-np-b') && auth.getActiveLeagueId() === null,
        `C-U3 null pointer + ${label}: fixture — the account changed and the pointer is STILL null (account ${JSON.stringify(auth.getAccountUserId())}, pointer ${JSON.stringify(auth.getActiveLeagueId())})`);
      if (how === 'expiry-then-b') {
        assert(held === true, `C-U3 null pointer + ${label}: the expiry itself HOLDS the store for the same account (A9) — the null pointer does not turn an expiry into a wipe`);
      }
      const sc = chat._chatScopeForTest();
      assert(!inStoreOn('L2', 'sentinel') && !(sc && sc.account === acct),
        `C-U3 null pointer + ${label}: the store is EMPTIED — the RAM-only row is gone and the scope no longer names the previous account (sentinel ${inStoreOn('L2', 'sentinel')}, scope ${JSON.stringify(sc)})`);
    } finally {
      authClient.rpc = realRpc;
      delete ACCOUNTS[acct];
      chat._resetForTest();
    }
  }
  delete ACCOUNTS['u-np-b'];

  // (e) "NOT RESOLVED YET" IS NOT "ENDED" — the boundary the fix must not cross. A returning player's cold boot: League One's room in the device cache,
  // DI-180q's marker naming (account, League One), NO pointer and no membership list yet. SB-20's replay claims League One for the store; nothing may
  // empty it on a null pointer alone, on a FAILED membership read, or on a resolved list that still has League One.
  try {
    const acct = 'u-cold';
    await freshPage();
    ACCOUNTS[acct] = { L1: 'mC1', L2: 'mC2' };   // two leagues, so a resolved list leaves the pointer null
    writeEventsCache([
      { id: 'c1', seq: 1, ts: BASE_TS + 1, type: 'message', author: 'mK', body: 'cached one', notify: true, leagueId: 'L1' },
      { id: 'c2', seq: 2, ts: BASE_TS + 2, type: 'message', author: 'mK', body: 'cached two', notify: true, leagueId: 'L1' },
    ], 2);
    auth._setDeviceDataOwnerForTest([acct, 'L1'].join(SEP));
    await quiet(async () => { chat.startChatTransport(''); await settle(20); });
    assert(auth.getActiveLeagueId() === null && inStoreOn('L1', 'c1') && scopeLeague() === 'L1',
      `C-U3 not resolved yet: fixture — a cold boot with the pointer null replayed League One's cached room and scoped the store to it (scope ${JSON.stringify(chat._chatScopeForTest())})`);
    await quiet(async () => { auth._setAccountUserIdForTest(acct); await settle(20); });
    assert(!auth.hasResolvedMemberships() && auth.getActiveLeagueId() === null && inStoreOn('L1', 'c1') && scopeLeague() === 'L1',
      `C-U3 not resolved yet: the account arriving with the pointer null and NO membership list yet KEEPS the instant room (scope ${JSON.stringify(chat._chatScopeForTest())})`);
    CURRENT_SESSION = sessionFor(acct);
    localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, JSON.stringify(CURRENT_SESSION));
    const realFrom = authClient.from;
    authClient.from = (table) => {
      if (table !== 'league_members') return realFrom(table);
      const b = {
        select() { return b; }, eq() { return b; }, order() { return b; }, limit() { return b; }, single() { return b; }, maybeSingle() { return b; },
        then(res, rej) { return Promise.resolve({ data: null, error: { message: 'network down', status: 503 } }).then(res, rej); },
      };
      return b;
    };
    try { await quiet(async () => { try { await auth.refreshMembershipsAndSession(); } catch {} await settle(40); }); }
    finally { authClient.from = realFrom; }
    assert(!auth.hasResolvedMemberships() && !!auth.getMembershipsError() && inStoreOn('L1', 'c1') && scopeLeague() === 'L1',
      `C-U3 not resolved yet: a FAILED membership read is "could not ask", never "League One ended" — the room is KEPT (resolved ${auth.hasResolvedMemberships()}, read error ${!!auth.getMembershipsError()})`);
    await quiet(async () => { try { await auth.refreshMembershipsAndSession(); } catch {} await settle(40); });
    assert(auth.hasResolvedMemberships() && auth.getActiveLeagueId() === null && inStoreOn('L1', 'c1') && scopeLeague() === 'L1',
      `C-U3 not resolved yet: a list that RESOLVES and still has League One (two leagues, pointer still null) keeps it too — the membership did not end (leagues ${JSON.stringify(auth.getCachedMemberships().map(m => m.leagueId))}, pointer ${JSON.stringify(auth.getActiveLeagueId())})`);
  } finally {
    delete ACCOUNTS['u-cold'];
    chat._resetForTest();
  }

  // (f) A RESOLVED LIST ENDS THE STORE'S LEAGUE WHILE THE IDENTITY KEY DOES NOT MOVE. A handset that REFUSED the leave's sweep keeps League One's events
  // cache, and DI-180q leaves the owner marker naming (account, League One) over it (a partial clear never writes the marker). On the next cold boot the
  // pointer is null — two leagues remain — so SB-20's replay claims League One for the store; the sign-in then resolves a list WITHOUT League One and the
  // pointer stays null. The identity key never moves, so the chokepoint alone never asks chat.js again.
  try {
    const acct = 'u-refuse';
    await freshPage();
    ACCOUNTS[acct] = { L1: 'mF1', L2: 'mF2', L3: 'mF3' };
    seedThree();
    await signInAs(acct, 'L1');
    await startChat('mF1');
    authClient.rpc = leaveRpc(acct);
    const realRemove = globalThis.localStorage.removeItem;
    globalThis.localStorage.removeItem = (k) => { if (k === 'cfbp_chat_events_cache') return; return realRemove(k); };
    try { await leaveL1(); } finally { globalThis.localStorage.removeItem = realRemove; authClient.rpc = realRpc; }
    assert(auth.getActiveLeagueId() === null && l1OnDisk().length === 5 && auth.getDeviceDataOwner() === [acct, 'L1'].join(SEP),
      `C-U3 refused sweep: fixture — the handset refused the leave's sweep, so League One's cache (${l1OnDisk().length} rows) and the marker naming it (${JSON.stringify(auth.getDeviceDataOwner().split(SEP))}) survive with the pointer null`);
    const snap = new Map(store);
    await freshPage();                              // a reload: fresh module state…
    for (const [k, v] of snap) store.set(k, v);     // …on the same device storage
    seedThree();
    await quiet(async () => { chat.startChatTransport(''); await settle(20); });
    assert(inStoreOn('L1', 'l1_1') && scopeLeague() === 'L1',
      `C-U3 refused sweep: fixture — the cold-boot replay put the surviving League One cache in the store and claimed League One for it (scope ${JSON.stringify(chat._chatScopeForTest())})`);
    CURRENT_SESSION = sessionFor(acct);
    localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, JSON.stringify(CURRENT_SESSION));
    await quiet(async () => { auth._fireAuthEventForTest('SIGNED_IN', CURRENT_SESSION); await settle(60); });
    assert(auth.hasResolvedMemberships() && !auth.getCachedMemberships().some(m => m.leagueId === 'L1') && auth.getActiveLeagueId() === null,
      `C-U3 refused sweep: fixture — the sign-in resolved a list WITHOUT League One and the pointer stayed null (leagues ${JSON.stringify(auth.getCachedMemberships().map(m => m.leagueId))}, pointer ${JSON.stringify(auth.getActiveLeagueId())})`);
    await nextPoll();
    const after = l1InStore();
    assert(after.rows.length === 0 && !after.direct && scopeLeague() !== 'L1',
      `C-U3 refused sweep: NO League One row remains in the store once a resolved list says the membership ended — though the identity key never moved (store ${JSON.stringify(after.rows)}, scope ${JSON.stringify(chat._chatScopeForTest())})`);
  } finally {
    authClient.rpc = realRpc;
    delete ACCOUNTS['u-refuse'];
    chat._resetForTest();
  }

  // (g) THIS DEVICE'S OWN UNSENT WORK across a leave-ended reset — the same person, so it is handled exactly as SB-20 handles a league-only move ([15]):
  // the FAILED message is kept (hidden while League One is not active) and the queued one stays queued. The reset clears neither, and neither goes anywhere.
  try {
    const acct = 'u-own';
    await freshPage();
    ACCOUNTS[acct] = { L1: 'mO1', L2: 'mO2', L3: 'mO3' };
    seedThree();
    await signInAs(acct, 'L1');
    await startChat('mO1');
    noFlushTimers();
    const failedId = chat.sendMessage({ body: 'failed in League One', author: 'mO1' });
    const marked = chat._markFailedForTest(failedId);
    const queuedId = chat.sendMessage({ body: 'queued in League One', author: 'mO1' });
    assert(marked && chat.isFailed(failedId) && chat._outboxForTest().some(ev => ev.id === queuedId),
      'C-U3 own unsent work: fixture — a FAILED and a QUEUED League One message are on this device before the leave');
    authClient.rpc = leaveRpc(acct);
    await leaveL1();
    assert(auth.getActiveLeagueId() === null && scopeLeague() === '',
      `C-U3 own unsent work: fixture — the leave landed on Leagues Home and the store was reset to no league (scope ${JSON.stringify(chat._chatScopeForTest())})`);
    assert(chat.isFailed(failedId) && chat._outboxForTest().some(ev => ev.id === queuedId),
      `C-U3 own unsent work: the leave-ended reset KEEPS the player's own failed and queued messages, as SB-20's league-only move does (failed ${chat.isFailed(failedId)}, queued ${JSON.stringify(chat._outboxForTest().map(ev => ev.id))})`);
    assert(chat.getMessage(failedId) === null && chat.getMessage(queuedId) === null
      && !SRV.appendLog.some(c => c.ids.includes(failedId) || c.ids.includes(queuedId)),
      `C-U3 own unsent work: …hidden while League One is not active, and sent nowhere (appends ${JSON.stringify(SRV.appendLog.map(c => [c.league, c.ids]))})`);
  } finally {
    restoreTimers();
    authClient.rpc = realRpc;
    chat.clearOutbox();
    delete ACCOUNTS['u-own'];
    chat._resetForTest();
  }

  // (h) REVIEWER C1 — A RESOLVED RE-READ WHILE THE STORE IS ALREADY AT NO LEAGUE CHANGES NOTHING. `!!prev.league` in leagueEnded (js/chat.js) is
  // what stops every resolved refresh on Leagues Home — an hourly TOKEN_REFRESHED re-reads the list — from resetting a store that has no league to
  // end: without it, `!memberLeagues.includes('')` is always true. Pinned on the real path (the generation and a RAM-only row) and on
  // rescopeChat()'s own answer.
  try {
    const acct = 'u-home';
    await freshPage();
    ACCOUNTS[acct] = { L1: 'mH1', L2: 'mH2', L3: 'mH3' };
    seedThree();
    await signInAs(acct, 'L1');
    await startChat('mH1');
    authClient.rpc = leaveRpc(acct);
    await leaveL1();
    authClient.rpc = realRpc;
    plantSentinel('L2');   // RAM-only: a spurious reset would drop it
    const gen0 = chat.chatScopeGen();
    let refreshed = 0;
    const off = auth.onAuthEvent((ev) => { if (ev === 'MEMBERSHIPS_REFRESHED') refreshed++; });
    try { await quiet(async () => { auth._fireAuthEventForTest('TOKEN_REFRESHED', CURRENT_SESSION); await settle(60); }); }
    finally { off(); }
    assert(refreshed >= 1 && auth.hasResolvedMemberships() && auth.getActiveLeagueId() === null && scopeLeague() === '' && inStoreOn('L2', 'sentinel') !== undefined,
      `C-U3 already at no league: fixture — on Leagues Home with the store at no league, a token refresh re-read the membership list (MEMBERSHIPS_REFRESHED x${refreshed}, leagues ${JSON.stringify(auth.getCachedMemberships().map(m => m.leagueId))}, pointer ${JSON.stringify(auth.getActiveLeagueId())}, scope ${JSON.stringify(chat._chatScopeForTest())})`);
    assert(chat.chatScopeGen() === gen0 && inStoreOn('L2', 'sentinel'),
      `C-U3 already at no league: that re-read did NOT reset the store — the generation is unchanged and the RAM-only row is still there (generation ${gen0} -> ${chat.chatScopeGen()}, sentinel ${inStoreOn('L2', 'sentinel')})`);
    const answer = chat.rescopeChat({ memberLeagues: auth.getCachedMemberships().map(m => m.leagueId) });
    assert(answer === 'kept' && chat.chatScopeGen() === gen0,
      `C-U3 already at no league: rescopeChat() itself answers 'kept' for a resolved list while the store has no league (got ${JSON.stringify(answer)}, generation ${gen0} -> ${chat.chatScopeGen()})`);
  } finally {
    authClient.rpc = realRpc;
    delete ACCOUNTS['u-home'];
    chat._resetForTest();
  }
}

// ═══════════════════════════════════════════════════════════════════
_realLog('\n[24] Home wiring (DI-372 amendment A1, security W1/W2, 2026-10-01) — chat.js chatBoundToLeague(leagueId) is a STORE-backed predicate: scope AND pointer AND caught up…');
// ═══════════════════════════════════════════════════════════════════
{
  // The predicate js/home.js's chat-candidate source is handed (DI-366/372): true only when the chat STORE is scoped to `leagueId`, the live active-league pointer still names it, and the room has
  // caught up. It reads the store, never the transport's channel, so it cannot say "bound" for a stale, emptied or never-live room. Every scenario goes through the real modules.
  const bound = chat.chatBoundToLeague;
  const HomeMod = await import('./js/home.js');
  const source = () => HomeMod.makeChatCandidateSource({ getMessages: chat.getMessages, isPrivateRow: chat.isPrivateRow, chatBoundToLeague: chat.chatBoundToLeague });
  const ask = (leagueId) => source()({ leagueId, supabase: true, now: BASE_TS + 3600e3, timezone: 'PT' });
  try {
    await freshPage();
    seedL1(4); seedL2(3);
    serverAdd('L1', { id: 'l1_scribe', author: 'scribe', body: 'SCRIBE says a thing about League One' });
    // A: signed in, chat not started: the store has never caught up
    await signInAs('u-drew', 'L1');
    assert(bound('L1') === false, '24-A: signed in on League One but the room has NOT caught up (chat never started): chatBoundToLeague("L1") is false — fail closed, never "bound" on a cold store');
    // B: started and caught up
    await startChat('mD1');
    assert(bound('L1') === true && bound('L2') === false && chat._chatScopeForTest().league === 'L1',
      '24-B: caught up on League One: true for L1, false for L2 (a different league is never bound), and the scope really is L1');
    assert([undefined, null, '', 0, 1, {}, [], false, true].every((v) => bound(v) === false),
      '24-B2: an empty, missing or non-string league id is NEVER bound (two unresolved "" terms must not compare equal)');
    // the positive control for the candidate source: bound + the right league yields the SCRIBE row; the other league yields NOTHING
    const okL1 = ask('L1');
    assert(okL1.scribe.some((c) => c.id === 'l1_scribe' && c.leagueId === 'L1'),
      `24-B3: positive control — bound to L1, the real candidate source returns League One's SCRIBE post stamped with ITS league (got ${JSON.stringify(okL1.scribe.map((c) => c.id))})`);
    const asL2 = ask('L2');
    assert(asL2.scribe.length === 0 && asL2.lockerRoom.length === 0,
      '24-B4: W1 — the store holds League One\'s rows; asking for League Two yields ZERO candidates (the channel may be live, the STORE is not League Two\'s)');
    // C: the pointer moves, nothing has rescoped yet (the exact gap `_scope` alone cannot see). auth.setActiveLeagueId() would fire the identity chokepoint and rescope at once (that is the
    // production path and is E below), so the raw pointer key is written directly: this is the window BEFORE the chokepoint has run.
    const POINTER = 'cfbp_supabase_active_league';
    localStorage.setItem(POINTER, 'L2');
    assert(bound('L1') === false && bound('L2') === false && chat._chatScopeForTest().league === 'L1',
      '24-C: the pointer moved to L2 while the store is still scoped to L1: NEITHER is bound (L1: the pointer left it; L2: the store is not its room)');
    const midSwitch = ask('L2');
    assert(midSwitch.scribe.length === 0 && midSwitch.lockerRoom.length === 0 && ask('L1').scribe.length === 0,
      '24-C2: …and the candidate source returns nothing for either league in that window (no stale league\'s messages on Home)');
    // D: pointer null — `_scope` keeps the last resolved league, the predicate must not
    localStorage.setItem(POINTER, 'L1');
    assert(bound('L1') === true, '24-D0: (pointer back on L1: bound again)');
    localStorage.removeItem(POINTER);
    assert((auth.getActiveLeagueId() || '') === '' && chat._chatScopeForTest().league === 'L1' && bound('L1') === false,
      '24-D: the pointer is NULL while `_scope.league` still reads L1 ("it keeps the last resolved league when the pointer is null"): chatBoundToLeague("L1") is false');
    localStorage.setItem(POINTER, 'L1');
    // E: a real in-page league switch (same account): the chokepoint rescopes and empties the store; L1 is never bound again, and L2 only once the new room has caught up
    const genE0 = chat.chatScopeGen();
    await quiet(async () => { await app.doSwitchActiveLeague('L2'); await settle(60); });
    assert(bound('L1') === false && chat._chatScopeForTest().league === 'L2' && chat.chatScopeGen() > genE0 && anyIdFrom('l1_').length === 0,
      '24-E1: after the real switch to L2 the store is rescoped to L2 and holds no League One row: L1 is not bound (and L2 is bound only once its room has caught up, below)');
    await startChat('mD2');
    assert(bound('L2') === true && bound('L1') === false && ask('L1').scribe.length === 0,
      '24-E2: caught up on League Two: true for L2 only, and League One\'s candidates are gone');
    // F: an account change resets the store: not bound until the NEW account has caught up
    const genF0 = chat.chatScopeGen();
    await signInAs('u-a', 'L1');
    assert(chat._chatScopeForTest().account === 'u-a' && chat.chatScopeGen() > genF0 && bound('L2') === false,
      '24-F: another account signed in on the same page: the store was reset for THEM (scope.account is theirs, the generation moved) and the previous account\'s league is not bound');
  } finally { chat._resetForTest(); }

  // G: the truth table, run against the REAL function's own source and against mutants of it (a stub or a dropped conjunct must go red)
  {
    const chatSrc = readFileSync(new URL('./js/chat.js', import.meta.url), 'utf8');
    const start = chatSrc.indexOf('export function chatBoundToLeague(leagueId) {');
    const end = chatSrc.indexOf('\n}\n', start) + 2;
    const fnSrc = chatSrc.slice(start, end).replace(/^export /, '');
    assert(start > 0 && end > start && /_scope/.test(fnSrc) && /getActiveLeagueId\(\)/.test(fnSrc) && /S\.caughtUp/.test(fnSrc),
      '24-G0: the predicate\'s source reads the STORE: _scope, the active-league pointer and S.caughtUp (not a transport flag, not a constant)');
    const build = (src) => (scopeLeague, active, caughtUp) => new Function('_scope', 'getActiveLeagueId', 'S', `${src}\nreturn chatBoundToLeague;`)(scopeLeague === null ? null : { league: scopeLeague, account: 'a' }, () => active, { caughtUp });
    const TABLE = [
      ['L1', 'L1', true, 'L1', true], ['L1', 'L1', false, 'L1', false], ['L1', 'L2', true, 'L1', false], ['L1', '', true, 'L1', false],
      ['L2', 'L1', true, 'L1', false], ['', '', true, '', false], [null, 'L1', true, 'L1', false], ['L1', 'L1', true, 'L2', false], ['L1', 'L1', true, null, false],
    ];
    const verdicts = (src) => TABLE.map(([sc, act, cu, ask1, want]) => build(src)(sc, act, cu)(ask1) === want);
    assert(verdicts(fnSrc).every(Boolean), '24-G1: the real predicate answers every row of the nine-row truth table (scope, pointer, caught up, asked league)');
    const mutants = {
      'a stub that always answers true (security W2)': fnSrc.replace(/\{[\s\S]*\}$/, '{ return true; }'),
      'no scope conjunct (the store may belong to another league)': fnSrc.replace('if (!_scope || _scope.league !== leagueId) return false;', 'if (!_scope) return false;'),
      'no pointer conjunct (`_scope` alone)': fnSrc.replace('return active === leagueId && S.caughtUp === true;', 'return S.caughtUp === true;'),
      'no caught-up conjunct (a cold or reset store reads bound)': fnSrc.replace('return active === leagueId && S.caughtUp === true;', 'return active === leagueId;'),
      'no empty-id guard (two unresolved terms compare equal)': fnSrc.replace("if (typeof leagueId !== 'string' || !leagueId) return false;", ''),
    };
    for (const [label, src] of Object.entries(mutants)) {
      let v = null; try { v = verdicts(src); } catch { v = [false]; }
      assert(src !== fnSrc && v.some((x) => x === false), `24-G2: MUTATION — ${label}: the truth table goes RED`);
    }
  }
}

// ── result ───────────────────────────────────────────────────────────────────
chat._resetForTest();
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
