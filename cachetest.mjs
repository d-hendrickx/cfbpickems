/**
 * CFB Pickems — cachetest.mjs
 * ============================
 * DI-169 (2026-09-11) — device-local raw-events cache (instant render on
 * boot). Per CLAUDE.md's math/logic-proof convention, a DEDICATED file beside
 * loadtest.mjs (the precedent is grouptest.mjs, UN-118) rather than another
 * addition to loadtest.mjs's chat-fold section — DI-169's own cost-tier note
 * calls for exactly this: "must be built and tested with the same rigor as
 * BUG-C... expect a dedicated test file."
 *
 * Run:  node cachetest.mjs
 *
 * Covers DI-169g cases 1-6 exactly as named in the approved design input:
 *   1. Boot-from-cache renders N events before any fetch resolves.
 *   2. Epoch mismatch drops the cache; boot renders empty until live data lands.
 *   3. Cached replay relays ZERO pushes and ZERO toasts/blips.
 *   4. The subsequent live drain reconciles normally, and a genuinely NEW
 *      message after that DOES toast/relay.
 *   5. >500 paging still ends at the true head with a cache-primed boot, and
 *      the first chatSince call asks for cachedHead, never 0.
 *   6. Shuffle-fold byte-identical: cache-then-live vs. live-only.
 *
 * Also carries DI-168's forceTick()/forceRefresh() coalescing proof (§0),
 * since forceRefresh() is reused as the controlled "second delivery" driver
 * in §4/§5 below rather than reimplementing a fetch-triggering helper.
 *
 * RECONCILED AGAINST THE POST-BUG-F TRANSPORT (see chatTransport.js's own
 * comment on subscribe()'s return shape): DI-169d's prose says "the first
 * transport call is chatSince(cachedHead)". The real, correct, pre-existing
 * two-phase behaviour for a KNOWN (non-zero) cursor issues a cheap chatHead
 * probe FIRST, then chatSince only if the probe shows something new — that
 * optimization predates this DI and is untouched by it. §5 below asserts the
 * DI's actual INTENT literally: the first chatSince call (whenever it comes)
 * asks for cachedHead, never 0 — never RG-91's full cold read — rather than
 * asserting a call-order fact that was never true of this code.
 */

// ── DOM / browser stubs (same minimal shape as loadtest.mjs/notifytest.mjs) ──
const store = new Map();
// BUG-H/RG-101 (2026-09-11) — the stub counts WRITES to the events-cache key,
// not just their end state. §8 asserts that an IDLE poll (a tick that finds
// nothing new) does not re-serialize the whole ~100KB buffer to localStorage
// every interval, and store.get() alone cannot see that: an idle rewrite
// produces byte-identical content, so only the call count distinguishes
// "wrote the same thing again" from "didn't write."
let cacheWrites = 0, cacheWriteBytes = 0;
function resetCacheWriteSpy() { cacheWrites = 0; cacheWriteBytes = 0; }
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (k === 'cfbp_chat_events_cache') { cacheWrites++; cacheWriteBytes += String(v).length; } return store.set(k, String(v)); },
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
// A RICHER element/document stub than loadtest.mjs's own top-level minimal
// one — needed here because §3/§4 must drive chat-ui.js's REAL showToast()/
// drainToast() to completion (not just its trigger) to prove the toast queue
// depth honestly, per CLAUDE.md ledger step 29's "rendered output, not only
// its trigger." Under the minimal stub, drainToast() throws on a missing
// `.dataset` mid-build — AFTER already shift()ing the message off the queue
// — which chat.js's notify()'s own try/catch silently swallows, making a
// "toast queue depth stays 0" assertion pass whether or not the fromCache
// guard actually worked. Modeled on loadtest.mjs's own DOC32/mkEl32 (its
// [32] toast section), which solves the identical problem the identical way.
function mkEl() {
  const listeners = {};
  return {
    id: '', className: '', dataset: {}, style: {},
    _html: '', _removed: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    appendChild() {}, remove() { this._removed = true; },
    setAttribute() {}, removeAttribute() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
// DI-169g §3's "toast queue depth stays 0" is chat-ui.js's OWN test-only
// wording (see _toastQueueDepth()'s doc comment) — but showToast()/
// drainToast() SHIFT a message off U.toastQueue the instant it starts
// SHOWING (not when it finishes), so depth reads 0 both "nothing fired" and
// "one toast fired and is now on screen" — indistinguishable from queue
// depth alone once a session has shown its first toast (a second toast
// arriving while the first is still up DOES stay queued, which is what
// _toastQueueDepth() actually proves). The unambiguous signal for "was
// showToast() EVER invoked" is whether a toast element was ever mounted —
// tracked here the same way loadtest.mjs's own [32] toast section does
// (DOC32/mkEl32), via a real spy on document.body.appendChild.
let toastMountCount = 0;
function resetToastMountCount() { toastMountCount = 0; }
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,          // no #chat-toast ever pre-exists — matches DOC32
  querySelector: () => null,           // no #page-chat.active / #page-dashboard.active — toast never chat/dashboard-suppressed
  querySelectorAll: () => [],
  createElement: () => mkEl(),
  body: { ...mkEl(), appendChild(el) { if (el?.id === 'chat-toast') toastMountCount++; } },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
function note(...a) { console.log('     ·', ...a); }

const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const backend = await import('./js/backend.js');
const notif = await import('./js/notifications.js');
const storage = await import('./js/storage.js');
const dataModel = await import('./js/data-model.js');

const K_EVENTS_CACHE = 'cfbp_chat_events_cache';   // DI-169b's literal key — same precedent as loadtest.mjs poking cfbp_chat_lastseen2/cfbp_chat_outbox2 directly

// ── Fixture players (for the push-relay half of §3/§4) ───────────────────────
const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
const players = NAMES.map((n, i) => ({ ...dataModel.createPlayer(n, '', '0000', '', n[0]), playerId: `p${i + 1}`, active: true }));
storage.getPlayers && storage.savePlayer && players.forEach(p => storage.savePlayer(p));

const mkEv = (seq, overrides = {}) => ({
  id: `e${seq}`, seq, ts: 1_700_000_000_000 + seq, type: 'message',
  author: 'p2', gameTag: '', body: 'msg ' + seq, replyTo: '', notify: true, meta: null, targetId: '',
  ...overrides,
});

function seedCache({ epoch = 0, head, events }) {
  store.set(K_EVENTS_CACHE, JSON.stringify({ epoch, head, events }));
}

function resetAll() {
  chat._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest?.();
  chatUi._resetToastsForTest();
  resetToastMountCount();
  backend.clearBackendConfig();
  storage.saveSetting('chatEpochSeq', 0);
  store.delete(K_EVENTS_CACHE);
  resetCacheWriteSpy();
}

const URL_FAKE = 'https://example.invalid/exec';

/** A generic honest chatSince responder, same shape as boottest.mjs's
 *  honestSince(): server head is `getHead()` (a live function, so a test can
 *  advance it mid-run), pages capped at `limit` (matching PAGE_LIMIT=500). */
function honestSince(getHead, afterSeq, limit, idPrefix = '') {
  const head = getHead();
  const cap = Math.max(1, Math.min(limit || 500, 1000));
  if (head <= afterSeq) return { ok: true, events: [], head };
  const count = Math.min(cap, head - afterSeq);
  const events = [];
  for (let s = afterSeq + 1; s <= afterSeq + count; s++) events.push(mkEv(s, idPrefix ? { id: idPrefix + s } : {}));
  return { ok: true, events, head };
}

/** Installs a controllable fetch stub. `getHead()` is a live function so a
 *  test can move the server's head between calls (simulating "something
 *  arrived while the app was closed" or "a genuinely new live message"). */
function installFetch(getHead, idPrefix = '') {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const action = u.searchParams.get('action');
    const seq = Number(u.searchParams.get('seq') || 0);
    const limit = Number(u.searchParams.get('limit') || 0);
    calls.push({ action, seq, limit });
    if (action === 'chatHead') return { ok: true, status: 200, json: async () => ({ ok: true, head: getHead() }) };
    if (action === 'chatSince') { const r = honestSince(getHead, seq, limit, idPrefix); return { ok: true, status: 200, json: async () => r }; }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return calls;
}

/** A fetch stub whose promise NEVER settles — models "a network round trip
 *  is in flight but has not answered yet" without needing any clock control
 *  at all: §1/§2 only need to observe state SYNCHRONOUSLY right after
 *  initChat() returns, before anything has a chance to resolve. */
function installHangingFetch() {
  globalThis.fetch = async () => new Promise(() => {});
}

/** Real microtask flush using REAL timers (0ms) — enough to let a resolved
 *  fetch's chain of awaits (get() -> requestWithMisrouteGuard -> fetch ->
 *  json() -> drainSince's loop) settle, without a fake clock. Bounded and
 *  polling rather than a fixed count, so it is not flaky under load. */
async function settle(n = 60) {
  for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0));
}
/**
 * Polls `fn()` against REAL wall-clock time, not just microtask flushes — a
 * SUBSEQUENT scheduled tick (as opposed to the very first, which fires
 * immediately when subscribe() is called) can be a genuine ~1s+ out on the
 * boot ladder's first rung (chatTransport.js's BOOT_RETRY_DELAYS), which a
 * 0ms-step poll would never actually wait long enough in real time to cross.
 * No fake clock (boottest.mjs's own reasoning for why IT needs one does not
 * apply here — nothing in this file asserts exact millisecond timings, only
 * "did this eventually happen"), so the step is a real, if short, sleep.
 */
async function waitFor(fn, { tries = 300, stepMs = 25 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return fn();
}

// ═══════════════════════════════════════════════════════════════════════════
// [1] Boot-from-cache renders N events before any fetch resolves.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] Boot-from-cache renders N events before any fetch resolves…');
{
  resetAll();
  const N = 40;
  const events = Array.from({ length: N }, (_, i) => mkEv(i + 1));
  seedCache({ epoch: 0, head: N, events });
  backend.setBackendConfig(URL_FAKE, 'tok');
  installHangingFetch();          // the network NEVER answers during this test

  chat.initChat('p1');            // synchronous: cache read + ingest() happen before subscribe()'s first tick can resolve anything

  assert(chat.getMessages({ tag: 'all' }).length === N,
    `all ${N} cached messages are folded and rendered before any fetch could possibly have resolved (got ${chat.getMessages({ tag: 'all' }).length})`);
  assert(chat.chatStatus().head === N,
    `the cached head (${N}) is adopted as S.head immediately — got ${chat.chatStatus().head}`);
  assert(chat.chatStatus().caughtUp === false,
    'S.caughtUp stays FALSE after a cache replay — it is never mistaken for a live delivery reaching the true head');
}

// ═══════════════════════════════════════════════════════════════════════════
// [2] Epoch mismatch drops the cache; boot renders empty until live data lands.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] Epoch mismatch drops the cache — boot renders empty until live data lands…');
{
  resetAll();
  const events = Array.from({ length: 10 }, (_, i) => mkEv(i + 1));
  seedCache({ epoch: 5, head: 10, events });         // cache written under an OLD epoch
  storage.saveSetting('chatEpochSeq', 7);            // room was cleared again since — current epoch is 7
  backend.setBackendConfig(URL_FAKE, 'tok');
  installHangingFetch();

  chat.initChat('p1');

  assert(chat.getMessages({ tag: 'all' }).length === 0,
    `a cache written under a stale epoch (5) is DROPPED, not replayed, once the current epoch is 7 — got ${chat.getMessages({ tag: 'all' }).length} messages`);
  assert(chat.chatStatus().head === 0,
    `and S.head stays 0 (no cursor primed from the dropped cache) — got ${chat.chatStatus().head}`);
  assert(store.get(K_EVENTS_CACHE) === undefined,
    'and the superseded entry is REMOVED from localStorage, not merely ignored (reviewer note, 2026-09-11) — a cache that can never be read again must not go on holding quota the next valid write needs');

  // fixture check: the SAME cache, same epoch, DOES replay — proves the
  // mismatch above was the epoch check firing, not some other reason the
  // cache failed to load. epoch 0 here (not 7, unlike above) so UN-112's OWN
  // epoch-hide-by-seq behavior (isHiddenByEpoch: seq <= epochSeq) can never
  // be confused with DI-169e's cache-drop — at epoch 0 nothing is hidden by
  // watermark, so a non-empty result unambiguously proves the cache replayed.
  resetAll();
  seedCache({ epoch: 0, head: 10, events });
  storage.saveSetting('chatEpochSeq', 0);
  backend.setBackendConfig(URL_FAKE, 'tok');
  installHangingFetch();
  chat.initChat('p1');
  assert(chat.getMessages({ tag: 'all' }).length === 10,
    'fixture check: a matching epoch DOES replay the same cache (isolates §2\'s drop to the epoch check, not a fluke)');
}

// ═══════════════════════════════════════════════════════════════════════════
// [3] Cached replay relays ZERO pushes and ZERO toasts/blips.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] Cached replay relays ZERO pushes (notifications.js) and ZERO toasts/blips (chat-ui.js)…');
{
  resetAll();
  const captured = [];
  notif.registerPushAdapter({ isConfigured: () => true, send: async r => { captured.push(r); return { ok: true }; } });
  notif.wireChatNotifications();                          // real subscriber, real gate
  const off = chat.onChat(chatUi._handleChatEventForTest); // real subscriber, real fromCache guard — NOT a re-implementation
  chatUi._resetToastsForTest();

  const N = 25;
  const events = Array.from({ length: N }, (_, i) => mkEv(i + 1, { author: 'p2', notify: true }));
  seedCache({ epoch: 0, head: N, events });
  backend.setBackendConfig(URL_FAKE, 'tok');
  installHangingFetch();

  chat.initChat('p1');

  assert(chat.getMessages({ tag: 'all' }).length === N, `fixture check: the cache replay actually loaded ${N} messages`);
  const relays = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
  assert(relays === 0, `notifications.js's scan fires ZERO relay calls for a cache replay of ${N} notifying messages — got ${relays}`);
  // toastMountCount, not _toastQueueDepth() — drainToast() SHIFTS a message
  // off the queue the instant it starts showing, so queue depth alone cannot
  // distinguish "zero toasts fired" from "one toast fired and is on screen
  // right now" (see the doc comment on toastMountCount, above). Mount count
  // is the unambiguous "was showToast() ever actually invoked" signal.
  assert(chatUi._toastQueueDepth() === 0 && toastMountCount === 0,
    `chat-ui.js never even MOUNTS a toast for the cache replay — got queue depth ${chatUi._toastQueueDepth()}, mounted ${toastMountCount}`);

  off();
  notif._clearPushAdapterForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
// [4] The subsequent live drain reconciles normally, and a genuinely NEW
//     message after that DOES toast/relay — the guard is scoped to the
//     cache replay only, never a permanent suppression.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] Live reconciliation after a cache-primed boot: S.caughtUp flips true, then a genuinely new message DOES toast/relay…');
{
  resetAll();
  const captured = [];
  notif.registerPushAdapter({ isConfigured: () => true, send: async r => { captured.push(r); return { ok: true }; } });
  notif.wireChatNotifications();
  const off = chat.onChat(chatUi._handleChatEventForTest);
  chatUi._resetToastsForTest();

  const CACHED_HEAD = 30;
  const events = Array.from({ length: CACHED_HEAD }, (_, i) => mkEv(i + 1));
  seedCache({ epoch: 0, head: CACHED_HEAD, events });

  let serverHead = CACHED_HEAD + 3;      // 3 messages arrived while the app was closed
  backend.setBackendConfig(URL_FAKE, 'tok');
  const calls = installFetch(() => serverHead);

  chat.initChat('p1');                   // cache replay: S.head=30, S.caughtUp=false
  assert(chat.chatStatus().caughtUp === false, 'fixture: still not caught up right after the cache replay (before the real network settles)');

  const reconciled = await waitFor(() => chat.chatStatus().caughtUp === true);
  assert(reconciled, `the real transport tick reaches the server's true head (${serverHead}) and S.caughtUp flips true — got head ${chat.chatStatus().head}, caughtUp ${chat.chatStatus().caughtUp}`);
  assert(chat.getMessages({ tag: 'all' }).length === serverHead,
    `all ${serverHead} messages (30 cached + 3 arrived-while-closed) are folded exactly once — got ${chat.getMessages({ tag: 'all' }).length}`);

  const relaysAfterReconcile = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
  assert(relaysAfterReconcile === 0,
    `the delivery that FIRST reaches the head is itself still classified as history by notifications.js's wasCaughtUp gate — zero relays yet, got ${relaysAfterReconcile}`);
  // NOT asserted: "zero toasts for the reconciling delivery." DI-169's
  // fromCache guard covers exactly one thing — the CACHE REPLAY notification
  // (detail.fromCache === true, proven zero in §3, above). The delivery that
  // follows it (this one) is a REAL, non-cache delivery carrying 3 genuinely
  // unread messages (31-33) that arrived while the app was closed — chat-ui's
  // pre-existing, UNRELATED toast gate (latest.seq > getLastSeen().seq, no
  // caughtUp/wasCaughtUp check at all — it never has, before or after this
  // DI) toasting about the newest of those is CORRECT, not a bug DI-169 was
  // ever asked to fix. What DI-169g case 4 actually requires — proven below
  // — is that reconciliation completes and a message AFTER it still toasts,
  // i.e. the guard is scoped to the replay, not a standing suppression.
  // Reset the toast UI's OWN "currently showing" state (not the mount
  // counter) between the two checks below — the reconcile step's toast (msg
  // 33, legitimate, see above) is still "showing" in-process with nothing to
  // ever time it out inside this fast synchronous test, so WITHOUT this a
  // second showToast() call for msg 34 would correctly QUEUE behind it
  // (_toastQueueDepth() would show it) rather than MOUNT — a real, correct
  // product behavior (only one toast on screen at a time) that would
  // otherwise look, to toastMountCount alone, indistinguishable from "never
  // called." This reset only clears chat-ui's OWN toast/showing state, never
  // chat.js's fold or S.caughtUp — the message 34 test below still exercises
  // the real, un-reimplemented showToast()/drainToast() path. Also reset the
  // mount COUNTER itself, so the assertion below reflects ONLY message 34's
  // attempt, not the reconcile step's already-proven-legitimate one.
  chatUi._resetToastsForTest();
  resetToastMountCount();

  // Now a GENUINELY new message arrives (forceRefresh() — DI-168 — drives the
  // controlled second tick directly, exercising forceTick()'s coalescing-free
  // path in the same motion).
  serverHead += 1;
  await chat.forceRefresh();
  await settle();

  const liveRelays = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
  assert(liveRelays === players.length - 1,
    `a genuinely new message AFTER reconciliation DOES relay — to every other active player (${players.length - 1}) — got ${liveRelays}`);
  assert(toastMountCount > 0,
    `and DOES mount a toast for it — proving the fromCache guard is scoped to the cache replay only, not a permanent suppression — got ${toastMountCount}`);
  note(`  requests issued: [${calls.map(c => c.action + (c.action === 'chatSince' ? ':' + c.seq : '')).join(', ')}], toasts mounted: total=${toastMountCount}`);

  off();
  notif._clearPushAdapterForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
// [5] >500 paging still ends at the true head with a cache-primed boot, and
//     the first chatSince call asks for cachedHead — never chatSince(0).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] >500 paging still reaches the true head from a cache-primed boot; first chatSince(seq) is cachedHead, never 0…');
{
  resetAll();
  const CACHED_HEAD = 500;
  const events = Array.from({ length: CACHED_HEAD }, (_, i) => mkEv(i + 1));
  seedCache({ epoch: 0, head: CACHED_HEAD, events });

  const TRUE_HEAD = 1200;                // 700 more events arrived while closed — 2 more pages beyond the cache window
  backend.setBackendConfig(URL_FAKE, 'tok');
  const calls = installFetch(() => TRUE_HEAD);

  chat.initChat('p1');
  assert(chat.getMessages({ tag: 'all' }).length === CACHED_HEAD, 'fixture: cache-primed at 500 messages before any network call resolves');

  const done = await waitFor(() => chat.chatStatus().head === TRUE_HEAD);
  assert(done, `the drain pages all the way to the true head ${TRUE_HEAD} from a cache-primed cursor — got ${chat.chatStatus().head}`);
  assert(chat.getMessages({ tag: 'all' }).length === TRUE_HEAD,
    `all ${TRUE_HEAD} messages are folded exactly once — no double-count from the cache/live overlap (idempotent fold, AD-10) — got ${chat.getMessages({ tag: 'all' }).length}`);

  const sinceCalls = calls.filter(c => c.action === 'chatSince');
  assert(sinceCalls.length > 0, 'fixture: at least one chatSince call actually happened');
  assert(sinceCalls[0].seq === CACHED_HEAD,
    `the FIRST chatSince call asks for cachedHead (${CACHED_HEAD}) — an INCREMENTAL read, never chatSince(0)'s full cold read (RG-91) — got seq ${sinceCalls[0].seq}`);
  assert(!sinceCalls.some(c => c.seq === 0),
    `no chatSince(0) call ever happens on a cache-primed boot — got seqs [${sinceCalls.map(c => c.seq).join(', ')}]`);
  const headCalls = calls.filter(c => c.action === 'chatHead');
  assert(headCalls.length >= 1,
    'the pre-existing two-phase optimization (cheap chatHead probe before a chatSince) is untouched by this DI — the probe still runs first');
  note(`  requests issued: [${calls.map(c => c.action + (c.action === 'chatSince' ? ':' + c.seq : '')).join(', ')}]`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [6] Shuffle-fold byte-identical: cache-then-live vs. live-only.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] Shuffle-fold byte-identical: cache-then-live vs. live-only, any shuffled arrival order…');
{
  // A representative mixed batch: messages, an edit, a react, a pin, a delete
  // — same shape as loadtest.mjs's own chat-fold shuffle suite.
  const all = [
    mkEv(1, { body: 'hello' }),
    mkEv(2, { body: 'world', author: 'p3' }),
    mkEv(3, { type: 'edit', targetId: 'e1', body: 'hello edited', author: 'p2' }),
    mkEv(4, { type: 'react', targetId: 'e2', author: 'p1', meta: { emoji: '🔥' } }),
    mkEv(5, { body: 'third message', author: 'p1' }),
    mkEv(6, { type: 'pin', targetId: 'e5', author: 'p1' }),
    mkEv(7, { body: 'fourth', author: 'p3' }),
    mkEv(8, { type: 'delete', targetId: 'e7', author: 'p3' }),
    mkEv(9, { body: 'fifth', author: 'p2' }),
    mkEv(10, { type: 'unreact', targetId: 'e2', author: 'p1', meta: { emoji: '🔥' } }),
  ];
  const cachePart = all.slice(0, 6);   // first 6 events "already cached" from a prior session
  const livePart = all.slice(6);       // remaining events arrive live after boot

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  let allMatch = true;
  for (let iter = 0; iter < 10; iter++) {
    // Path A — cache-then-live: replay the cache half (fromCache), then feed
    // the live half in a shuffled order via the real transport callback shape.
    resetAll();
    chat.ingest(shuffled(cachePart), 6, { caughtUp: false, fromCache: true });
    chat.ingest(shuffled(livePart), 10, { caughtUp: true });
    const snapA = chat._foldedSnapshot();

    // Path B — live-only: the exact same 10 events, no cache/live split, fed
    // as a single shuffled batch.
    resetAll();
    chat.ingest(shuffled(all), 10, { caughtUp: true });
    const snapB = chat._foldedSnapshot();

    if (snapA !== snapB) allMatch = false;
  }
  assert(allMatch, 'cache-then-live and live-only fold to the byte-identical _foldedSnapshot() output across 10 shuffled iterations');
  resetAll();
}

// ═══════════════════════════════════════════════════════════════════════════
// [7] RG-100 F2 (reviewer finding, 2026-09-11) — a head:0 empty delivery must
//     NEVER produce a DI-169 cache write. chatTransport.js's drainSince() now
//     reports caughtUp:false for any delivery whose head is 0 (it cannot be
//     told apart from a cold-start artifact hiding a real room), and DI-169c's
//     write hook is gated on `delivery.caughtUp === true` — so this should
//     already hold by construction once F2 landed. Asserted directly rather
//     than assumed, per the coordinator's own instruction: "a cache written
//     from an empty room must not exist — you only write on caughtUp:true
//     with head>0 now."
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] RG-100 F2 × DI-169 — a head:0 cold-start artifact never writes a device-local cache entry…');
{
  resetAll();
  let serverHead70 = 0;         // the sheet has not warmed up yet — reports empty
  backend.setBackendConfig(URL_FAKE, 'tok');
  const calls70 = installFetch(() => serverHead70);

  chat.initChat('p1');
  await settle();
  assert(chat.chatStatus().head === 0 && chat.chatStatus().caughtUp === false,
    `fixture: the cold-start artifact landed and did NOT latch caughtUp — head ${chat.chatStatus().head}, caughtUp ${chat.chatStatus().caughtUp}`);
  assert(store.get(K_EVENTS_CACHE) === undefined,
    'RG-100 F2: no K_EVENTS_CACHE entry was written for the head:0 delivery — a cache entry claiming an empty, complete room must not exist to be trusted by a later boot');

  // The sheet warms up: 12 real messages were there all along.
  serverHead70 = 12;
  await waitFor(() => chat.chatStatus().head === 12);
  assert(chat.chatStatus().caughtUp === true && chat.getMessages({ tag: 'all' }).length === 12,
    `fixture: the real backfill landed — head ${chat.chatStatus().head}, ${chat.getMessages({ tag: 'all' }).length} messages, caughtUp ${chat.chatStatus().caughtUp}`);
  const cached70 = JSON.parse(store.get(K_EVENTS_CACHE) || 'null');
  assert(cached70 && cached70.head === 12 && cached70.events.length === 12,
    `and THIS caught-up delivery DOES write the cache, correctly, with the real head and all 12 events — got ${JSON.stringify(cached70 && { head: cached70.head, n: cached70.events.length })}`);
  note(`  requests issued: [${calls70.map(c => c.action).join(', ')}]`);
  resetAll();
}

// ═══════════════════════════════════════════════════════════════════════════
// [8] BUG-H / RG-101 (reviewer BLOCK on the v0.20.3 candidate, 2026-09-11) —
//     THE ORDINARY CASE: a cache-primed boot where NOTHING happened while the
//     app was closed, so the server's head EQUALS the cached head.
//
//     Every case above (§4, §5, §7) moves the server head PAST the cached one,
//     which routes the first tick down `head > known` -> drainSince() -> a
//     delivery -> ingest(). The far more common boot — open the app, nothing
//     new since last time — takes the OTHER branch of the same `if`, which
//     called onEvents() not at all. S.caughtUp (set ONLY by ingest(), chat.js)
//     therefore never latched, so the NEXT genuinely new message arrived with
//     wasCaughtUp === false and notifications.js classified it as HISTORY:
//     ZERO pushes for the first real message of the session, on every device.
//     Measured on this fixture before the fix: after boot head=30
//     caughtUp=false; FIRST new message relays 0; SECOND relays 5. The same
//     stale latch is handed to the SENDER's own optimistic send (sendEvent()
//     passes `{caughtUp: S.caughtUp}`), so a player's first post after a
//     cache-primed boot relayed nothing either.
//
//     DI-169 introduced the exposure (it is what makes getKnownHead() non-zero
//     on tick #1), so this is a defect in THIS build, caught at the gate and
//     never shipped.
//
//     Driven through the REAL production path — chat.initChat() ->
//     _subscribeNow() -> transport.subscribe() -> tick() -> chat.ingest() ->
//     notifications.js's onChat subscriber -> the registered push adapter —
//     in the REAL boot order app.js uses (initChat() at app.js:319, then
//     wireChatNotifications() at :324). The delivery kind is produced by the
//     code under test, never hand-fed (the notifytest [12b] c3c2 precedent).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] BUG-H/RG-101 — a cache-primed boot with NOTHING new still latches caughtUp, relays the next message, and does not rewrite the cache…');
{
  const CACHED_HEAD = 30;

  /** One full boot. `wireFirst` picks which side of initChat() the
   *  notifications wiring lands on — production is false (initChat first),
   *  but BUG-C proved a wire-order-sensitive rule is a hole, so both orders
   *  are asserted against the same expectations. */
  async function idleBoot(wireFirst) {
    resetAll();
    const captured = [];
    notif.registerPushAdapter({ isConfigured: () => true, send: async r => { captured.push(r); return { ok: true }; } });
    // Message ids are namespaced per run: _fireOne()'s SESSION dedup set is
    // module-global and never reset, so re-using ids across runs (or with
    // §4's) would make a later run pass vacuously on 'dedup-session' — the
    // notifytest [12b] idPrefix precedent.
    const prefix = wireFirst ? 'h8b_' : 'h8a_';
    const events = Array.from({ length: CACHED_HEAD }, (_, i) => mkEv(i + 1, { id: prefix + (i + 1), author: 'p2', notify: true }));
    seedCache({ epoch: 0, head: CACHED_HEAD, events });
    let serverHead = CACHED_HEAD;                 // NOTHING arrived while the app was closed
    backend.setBackendConfig(URL_FAKE, 'tok');
    const calls = installFetch(() => serverHead, prefix);
    resetCacheWriteSpy();

    if (wireFirst) notif.wireChatNotifications();
    chat.initChat('p1');
    if (!wireFirst) notif.wireChatNotifications();
    const out = { calls, captured, primed: chat.getMessages({ tag: 'all' }).length, setServerHead: n => { serverHead = n; } };
    out.latched = await waitFor(() => chat.chatStatus().caughtUp === true);
    out.headAfterBoot = chat.chatStatus().head;
    out.historyRelays = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
    out.writesAfterBoot = cacheWrites;
    return out;
  }

  // ── A. Production boot order (initChat, then wireChatNotifications) ──
  const a = await idleBoot(false);
  assert(a.primed === CACHED_HEAD, `fixture: the cache primed ${CACHED_HEAD} messages before any network call resolved — got ${a.primed}`);
  assert(a.headAfterBoot === CACHED_HEAD && a.calls.some(c => c.action === 'chatHead'),
    `fixture: the first tick's cheap chatHead probe ran and agreed with the cached cursor (${CACHED_HEAD}) — got head ${a.headAfterBoot}, calls [${a.calls.map(c => c.action).join(', ')}]`);
  assert(a.calls.every(c => c.action !== 'chatSince'),
    `fixture: and it cost NOTHING else — an idle cache-primed boot issues no chatSince at all — got [${a.calls.map(c => c.action).join(', ')}]`);
  assert(a.latched === true,
    'BUG-H: S.caughtUp latches TRUE on that first idle tick — a probe that agrees with our cursor IS a complete delivery, and it must say so (pre-fix: stayed false forever, because the head===known branch called onEvents() not at all)');
  assert(a.historyRelays === 0,
    `and the 30 already-read cached messages still relay ZERO pushes — an empty caught-up delivery must not seed the watermark wrongly (BUG-C/RG-96) — got ${a.historyRelays}`);
  assert((notif._chatRelayBurstTripsForTest?.() || []).length === 0,
    'and that zero comes from classification, not the burst cap swallowing it');

  // Idle ticks must not re-serialize the whole buffer to localStorage every
  // interval — the empty delivery above reaches DI-169c's write hook, which
  // is gated on caughtUp alone. forceRefresh() drives two more deterministic
  // idle ticks (DI-168's path, the same tick() the interval poll uses).
  const writesBefore = cacheWrites, bytesBefore = cacheWriteBytes;
  await chat.forceRefresh(); await settle();
  await chat.forceRefresh(); await settle();
  assert(cacheWrites === writesBefore,
    `an idle tick with zero new events performs ZERO K_EVENTS_CACHE writes — the whole buffer is not re-stringified and re-written to localStorage every poll interval — got ${cacheWrites - writesBefore} write(s), ${cacheWriteBytes - bytesBefore} bytes`);

  // ── The next genuinely new message must relay to every other player ──
  a.setServerHead(CACHED_HEAD + 1);
  await chat.forceRefresh();
  await waitFor(() => chat.chatStatus().head === CACHED_HEAD + 1);
  await settle();
  const firstLive = a.captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - a.historyRelays;
  assert(firstLive === players.length - 1,
    `the FIRST genuinely new message after a cache-primed idle boot relays to all ${players.length - 1} other players — got ${firstLive} (pre-fix: 0 — it was classified as history, and only the SECOND message ever relayed)`);
  assert(chat.getMessages({ tag: 'all' }).length === CACHED_HEAD + 1,
    `fixture: and it folded exactly once — got ${chat.getMessages({ tag: 'all' }).length}`);
  const writesAfterLive = cacheWrites;
  assert(writesAfterLive === writesBefore + 1,
    `a delivery that DOES carry events still writes the cache exactly once — got ${writesAfterLive - writesBefore}`);
  const cachedNow = JSON.parse(store.get(K_EVENTS_CACHE) || 'null');
  assert(cachedNow && cachedNow.head === CACHED_HEAD + 1 && cachedNow.events.length === CACHED_HEAD + 1,
    `and it persists the merged buffer at the new head — got ${JSON.stringify(cachedNow && { head: cachedNow.head, n: cachedNow.events.length })}`);

  a.setServerHead(CACHED_HEAD + 2);
  await chat.forceRefresh();
  await waitFor(() => chat.chatStatus().head === CACHED_HEAD + 2);
  await settle();
  const secondLive = a.captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - a.historyRelays - firstLive;
  assert(secondLive === players.length - 1,
    `the SECOND new message relays normally too — got ${secondLive} (this one relayed 5 even BEFORE the fix, which is exactly why the defect read as "the first message of a session goes missing")`);
  notif._clearPushAdapterForTest();

  // ── B. Wired BEFORE initChat() — same expectations, no wire-order
  //    sensitivity (BUG-C's lesson). ──
  const b = await idleBoot(true);
  assert(b.latched === true, 'wired-before-boot: S.caughtUp still latches on the first idle tick');
  assert(b.historyRelays === 0, `wired-before-boot: the cached replay still relays zero pushes — got ${b.historyRelays}`);
  b.setServerHead(CACHED_HEAD + 1);
  await chat.forceRefresh();
  await waitFor(() => chat.chatStatus().head === CACHED_HEAD + 1);
  await settle();
  const bLive = b.captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - b.historyRelays;
  assert(bLive === players.length - 1,
    `wired-before-boot: the first genuinely new message still relays to all ${players.length - 1} other players — got ${bLive}`);
  notif._clearPushAdapterForTest();
  resetAll();
}

// ═══════════════════════════════════════════════════════════════════════════
// [9] Two structural corrections that came in with RG-101 (reviewer notes,
//     2026-09-11). Both are in the DI-169 cache path; neither had a guard.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[9] DI-169 structural corrections — chat OFF replays nothing, and the byte budget is honored…');
{
  // ── A. Chat OFF must mean no chat, not just no polling. ──
  resetAll();
  const events = Array.from({ length: 12 }, (_, i) => mkEv(i + 1, { id: 'h9_' + (i + 1) }));
  seedCache({ epoch: 0, head: 12, events });
  storage.saveSetting('chatEnabled', false);
  backend.setBackendConfig(URL_FAKE, 'tok');
  const calls9 = installFetch(() => 12, 'h9_');
  chat.initChat('p1');
  await settle();
  assert(chat.getMessages({ tag: 'all' }).length === 0 && chat.chatStatus().head === 0,
    `with settings.chatEnabled === false the cache is not replayed at all — got ${chat.getMessages({ tag: 'all' }).length} messages, head ${chat.chatStatus().head} (before this, a player who turned chat OFF still had the room rebuilt into the fold, badges and all)`);
  assert(calls9.length === 0, `fixture: and chat OFF still means zero network activity — got [${calls9.map(c => c.action).join(', ')}]`);
  storage.saveSetting('chatEnabled', true);

  // fixture check: the SAME cache DOES replay with chat on — isolates A's
  // zero to the enabled gate, not to something else about the fixture.
  resetAll();
  seedCache({ epoch: 0, head: 12, events });
  backend.setBackendConfig(URL_FAKE, 'tok');
  installHangingFetch();
  chat.initChat('p1');
  assert(chat.getMessages({ tag: 'all' }).length === 12, 'fixture check: with chat ON the same cache replays all 12 messages');

  // ── B. EVENTS_CACHE_MAX_BYTES is enforced, oldest-first, and costs O(n)
  //    rather than re-stringifying the whole buffer once per dropped event. ──
  resetAll();
  const BIG = 200;                       // 200 × ~3KB bodies ≈ 600KB, double the 300KB budget
  let serverHeadB = 0;
  backend.setBackendConfig(URL_FAKE, 'tok');
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const action = u.searchParams.get('action');
    if (action === 'chatHead') return { ok: true, status: 200, json: async () => ({ ok: true, head: serverHeadB }) };
    if (action === 'chatSince') {
      const after = Number(u.searchParams.get('seq') || 0);
      const evs = [];
      for (let s = after + 1; s <= serverHeadB; s++) evs.push(mkEv(s, { id: 'h9b_' + s, body: 'x'.repeat(3000) }));
      return { ok: true, status: 200, json: async () => ({ ok: true, events: evs, head: serverHeadB }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  serverHeadB = BIG;
  const t0 = Date.now();
  chat.initChat('p1');
  await waitFor(() => chat.chatStatus().head === BIG);
  await settle();
  const written = store.get(K_EVENTS_CACHE) || '';
  const parsedB = JSON.parse(written || 'null');
  assert(parsedB && JSON.stringify(parsedB.events).length <= 300 * 1024,
    `a ~600KB session buffer is trimmed to EVENTS_CACHE_MAX_BYTES before it is written — got ${Math.round(JSON.stringify(parsedB ? parsedB.events : []).length / 1024)}KB of events`);
  assert(parsedB && parsedB.events.length > 0 && parsedB.events[parsedB.events.length - 1].seq === BIG,
    `and it trims from the OLDEST end — the newest event (seq ${BIG}) survives — got last seq ${parsedB && parsedB.events.length ? parsedB.events[parsedB.events.length - 1].seq : 'none'}`);
  assert(parsedB && parsedB.events[0].seq > 1,
    `while the oldest ones are the ones dropped — first retained seq ${parsedB && parsedB.events.length ? parsedB.events[0].seq : 'none'}, of ${BIG}`);
  note(`  trimmed ${BIG} → ${parsedB ? parsedB.events.length : 0} events in ${Date.now() - t0}ms of wall clock (the trim itself is O(n): a running byte total, not a full re-stringify per dropped event — reviewer note, 2026-09-11)`);
  resetAll();
}

// ── Summary ──────────────────────────────────────────────────────────────────
globalThis.fetch = async () => { throw new Error('network disabled after cachetest.mjs'); };
resetAll();
console.log('\n' + '─'.repeat(70));
console.log(`${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
console.log('─'.repeat(70));
process.exit(fail === 0 ? 0 : 1);
