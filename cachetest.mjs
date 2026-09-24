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
// BUG-G F-2 (2026-09-11) — §12 drives the REAL delegated click handler, so the
// stub has to actually keep the listeners it is handed instead of dropping
// them, and has to be able to answer one querySelector (the chat nav item that
// navToChat() clicks). Default behaviour is unchanged for every other section:
// querySelectorHook returns null until a section swaps it and restores it.
const docListeners = new Map();
let querySelectorHook = () => null;
globalThis.document = {
  addEventListener(type, fn) { if (!docListeners.has(type)) docListeners.set(type, []); docListeners.get(type).push(fn); },
  removeEventListener() {},
  getElementById: () => null,          // no #chat-toast ever pre-exists — matches DOC32
  querySelector: sel => querySelectorHook(sel),   // null by default — no #page-chat.active / #page-dashboard.active, toast never suppressed
  querySelectorAll: () => [],
  createElement: () => mkEl(),
  body: { ...mkEl(), appendChild(el) { if (el?.id === 'chat-toast') toastMountCount++; } },
  hidden: false,
};
// initChatUI()'s late phase constructs one; absent here, `new MutationObserver`
// throws OUTSIDE the try/catch that guards .observe().
globalThis.MutationObserver = class { observe() {} disconnect() {} };
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
// SECURITY A-1-R (2026-09-21) — THE TOAST NOW REQUIRES A RESOLVED VIEWER.
// `latestNotifying()` gained the identityKnown() guard the other unread entry
// points already had: with a null selfId its own-post filter (`m.author ===
// selfId`) excluded nobody, so a device that did not yet know who it was got
// the newest message in the room handed to it and toasted a member's name and
// 64 characters of what they wrote. This suite is about the CACHE replay, not
// about identity, so it signs the reader in — as p1, so p2's messages (every
// fixture event above) are still somebody else's and still notify.
storage.setSession('p1', false, true);

const mkEv = (seq, overrides = {}) => ({
  id: `e${seq}`, seq, ts: 1_700_000_000_000 + seq, type: 'message',
  author: 'p2', gameTag: '', body: 'msg ' + seq, replyTo: '', notify: true, meta: null, targetId: '',
  ...overrides,
});

function seedCache({ epoch = 0, head, events }) {
  store.set(K_EVENTS_CACHE, JSON.stringify({ epoch, head, events }));
}

const { installFakeChat } = await import('./testchatfake.mjs');
const projectionMod = await import('./js/supabase-projection.js');
const transportMod = await import('./js/chatTransport.js');

let _fake = null;
function resetAll() {
  // The installed chat context is torn down FIRST: a context left behind would
  // serve the NEXT section's `initChat()` the previous section's room, which is
  // the same class of cross-section bleed `chat._resetForTest()` exists for.
  if (_fake) { _fake.uninstall(); _fake = null; }
  chat._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest?.();
  chatUi._resetToastsForTest();
  resetToastMountCount();
  backend.setDataMode('sheets');
  storage.saveSetting('chatEpochSeq', 0);
  store.delete(K_EVENTS_CACHE);
  resetCacheWriteSpy();
}


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

/**
 * Installs a controllable chat backend. `getHead()` is a live function so a
 * test can move the server's head between calls (simulating "something arrived
 * while the app was closed" or "a genuinely new live message").
 *
 * PORTED 2026-09-23. This was a `globalThis.fetch` stub that parsed an Apps
 * Script URL; `js/chatTransport.js`'s `get()`/`post()` are deleted, so a
 * serveable transport is now an installed Supabase context. `honestSince()`'s
 * page cap is untouched, and the returned `calls` array keeps the identical
 * `{ action, seq, limit }` shape every assertion in this file reads.
 */
function installFetch(getHead, idPrefix = '') {
  _fake = installFakeChat(transportMod, projectionMod, {
    head: () => getHead(),
    since: (seq, limit) => honestSince(getHead, seq, limit, idPrefix),
  });
  return _fake.calls;
}

/** A backend whose every answer NEVER settles — models "a network round trip
 *  is in flight but has not answered yet" without needing any clock control
 *  at all: §1/§2 only need to observe state SYNCHRONOUSLY right after
 *  initChat() returns, before anything has a chance to resolve. */
function installHangingFetch() {
  _fake = installFakeChat(transportMod, projectionMod, {
    head: () => new Promise(() => {}),
    since: () => new Promise(() => {}),
  });
  return _fake.calls;
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
  backend.setDataMode('supabase');
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
  backend.setDataMode('supabase');
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
  backend.setDataMode('supabase');
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
  backend.setDataMode('supabase');
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
  // NOTE 2026-09-24: this now holds TRIVIALLY rather than conditionally — with
  // the preview surface retired (Option A), chat-ui.js mounts no toast for any
  // delivery, cache replay or otherwise. Kept because "the cache replay is
  // silent" is still a true and load-bearing property of a cache-primed boot,
  // and the relay assertion above it is the one that remains conditional.
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
  backend.setDataMode('supabase');
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
  // ── HISTORICAL, 2026-09-24. Everything in this paragraph and the next
  // describes the in-app toast, which no longer exists on any delivery path
  // (Option A, Drew — chat-ui.js raises no toast at all now). The reset calls
  // below are harmless and are kept so the mount counter still starts this
  // block at a known zero, which is what the inverted assertion reads. Left
  // in full rather than trimmed because it records WHY DI-169d's guard was
  // shaped the way it was, and that reasoning is the thing a future reader
  // needs if a preview surface is ever reintroduced.
  //
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
  // INVERTED 2026-09-24 (teaser/toast retired, Drew — Option A). This used to
  // read `toastMountCount > 0`: "and DOES mount a toast for it — proving the
  // fromCache guard is scoped to the cache replay only, not a permanent
  // suppression." That proof is no longer available to state, because there is
  // no longer any delivery that mounts a toast: chat-ui.js's handleChatEvent()
  // has no toast/blip raise at all, and with it went the `!detail?.fromCache`
  // guard this section was built around. The DI-169d mechanism was retired
  // along with the surface it protected, not broken.
  //
  // The relay assertion immediately above is what keeps this section
  // non-vacuous — it proves the live delivery genuinely happened and was
  // classified as new. This line now pins the replacement behaviour: the
  // player is told by push and by the chat pill's unread badge, never by an
  // in-app preview.
  assert(toastMountCount === 0,
    `no in-app toast is mounted for a live message any more — the preview surface is retired and push is the channel (got ${toastMountCount})`);
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
  backend.setDataMode('supabase');
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
  backend.setDataMode('supabase');
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
    backend.setDataMode('supabase');
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
  backend.setDataMode('supabase');
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
  backend.setDataMode('supabase');
  installHangingFetch();
  chat.initChat('p1');
  assert(chat.getMessages({ tag: 'all' }).length === 12, 'fixture check: with chat ON the same cache replays all 12 messages');

  // ── B. EVENTS_CACHE_MAX_BYTES is enforced, oldest-first, and costs O(n)
  //    rather than re-stringifying the whole buffer once per dropped event. ──
  resetAll();
  const BIG = 200;                       // 200 × ~3KB bodies ≈ 600KB, double the 300KB budget
  let serverHeadB = 0;
  backend.setDataMode('supabase');
  _fake = installFakeChat(transportMod, projectionMod, {
    head: () => serverHeadB,
    since: (after) => {
      const evs = [];
      for (let s = after + 1; s <= serverHeadB; s++) evs.push(mkEv(s, { id: 'h9b_' + s, body: 'x'.repeat(3000) }));
      return { events: evs };
    },
  });
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

// ═══════════════════════════════════════════════════════════════════════════
// [10] BUG-G — startChatTransport(): the PRE-HYDRATE half of boot.
// ═══════════════════════════════════════════════════════════════════════════
// js/app.js used to gate initChatUI() -> initChat() behind
// `await hydrateBackend()`, so neither the first chatSince nor DI-169's cache
// replay could happen until a ~100KB getAll had paid the Apps Script cold
// start. boottest.mjs §10 owns the TIMELINE half of this fix; this section
// owns the four correctness questions the review raised about starting
// before the hydrated snapshot exists:
//
//   A. the epoch the cache is checked against is the STALE one;
//   B. the chatEnabled the subscription is gated on is the STALE one;
//   C. two entry points must not produce two subscriptions — or worse, tear
//      down an in-flight cold-boot read and start it again;
//   D. starting earlier makes a cold-start head:0 answer MORE likely, which
//      is RG-100's exact input — it must still relay zero pushes.
//
// A/B model "the hydrate landed" by changing the value the seam returns
// (saveSetting) between the two calls, which is precisely what a hydrate does
// to these two reads. Nothing here needs the mirror itself.
console.log('\n[10] BUG-G — the transport starts before hydrate: stale epoch, stale chatEnabled, one subscription, no push storm…');
{
  // ── A. The hydrated epoch is NEWER than the cached one. ──
  // Decision under test (stated in chat.js's readAndPrimeEventsCache() note):
  // replaying against the stale epoch is SAFE, because isHiddenByEpoch() is a
  // RENDER-time filter applied unconditionally inside getMessages(),
  // isUnreadFor() and latestNotifying() — so events folded under the old
  // watermark disappear the instant the real one lands, with no un-folding.
  // What is NOT safe, and is what _applyEpochLocally() now handles, is
  // letting those events ride in _eventsCacheBuf into the next cache write.
  resetAll();
  const preEpoch = Array.from({ length: 20 }, (_, i) => mkEv(i + 1, { id: 'g10a_' + (i + 1), author: 'p2', notify: true }));
  seedCache({ epoch: 0, head: 20, events: preEpoch });
  storage.saveSetting('chatEpochSeq', 0);          // stale/local value, as read BEFORE hydrate
  backend.setDataMode('supabase');
  let headA = 20;
  const callsA = installFetch(() => headA, 'g10a_');

  chat.startChatTransport('p1');                   // ← pre-hydrate: subscription + cache replay only
  assert(chat.getMessages({ tag: 'all' }).length === 20,
    `fixture: the pre-hydrate replay renders all 20 cached messages at once, with no hydrated snapshot in existence — got ${chat.getMessages({ tag: 'all' }).length}`);
  assert(chat.chatStatus().head === 20, `fixture: and adopts the cached head as the poll cursor — got ${chat.chatStatus().head}`);

  // …the hydrate lands, and the commissioner had cleared the room at seq 20
  // while this device was closed.
  storage.saveSetting('chatEpochSeq', 20);
  chat.initChat('p1');                             // ← post-hydrate: epoch heal + outbox + flush
  await settle();

  assert(chat.getMessages({ tag: 'all' }).length === 0,
    `every pre-epoch event the early replay folded is hidden the moment the real epoch arrives — getMessages() returns ${chat.getMessages({ tag: 'all' }).length}, expected 0 (isHiddenByEpoch is a RENDER-time filter, which is the whole reason replaying before hydrate is safe)`);
  assert(chat.unreadCount('p1', 'all') === 0,
    `and they badge nothing — unread ${chat.unreadCount('p1', 'all')}, expected 0 (isUnreadFor() applies the same filter)`);
  assert(chat.chatStatus().head === 20,
    `while the poll cursor is NOT rewound — still ${chat.chatStatus().head} — so the heal never re-downloads the 20 events it just hid`);
  assert(store.get(K_EVENTS_CACHE) === undefined,
    'and the superseded cache entry is removed from localStorage by the epoch heal itself');

  // The part that only a WRITE can prove: the in-memory buffer was dropped
  // too, so the next caught-up delivery cannot re-persist pre-epoch chatter
  // under the NEW epoch (where it would pass DI-169e's check forever after,
  // invisible but occupying the 500-event/300KB budget the real room needs).
  headA = 25;
  await chat.forceRefresh();
  await settle();
  const writtenA = JSON.parse(store.get(K_EVENTS_CACHE) || 'null');
  assert(writtenA && writtenA.epoch === 20,
    `fixture: a live delivery after the heal does write a fresh cache, stamped with the NEW epoch — got ${writtenA ? writtenA.epoch : 'nothing written'}`);
  assert(writtenA && writtenA.events.every(e => e.seq > 20),
    `and it contains ONLY post-epoch events — seqs [${writtenA ? writtenA.events.map(e => e.seq).join(', ') : ''}] (pre-fix: all 20 pre-epoch events ride along, hidden forever but never evictable)`);
  note(`  requests: [${callsA.map(c => c.action + (c.action === 'chatSince' ? ':' + c.seq : '')).join(', ')}]`);

  // ── B. The hydrated chatEnabled disagrees with the stale one. ──
  // Both directions. app.js calls refreshChatEnabled() immediately after
  // hydrate for exactly this window (boottest §10E pins that it is there).
  resetAll();
  storage.saveSetting('chatEnabled', true);        // stale local value says ON
  seedCache({ epoch: 0, head: 6, events: Array.from({ length: 6 }, (_, i) => mkEv(i + 1, { id: 'g10b_' + (i + 1) })) });
  backend.setDataMode('supabase');
  const callsB = installFetch(() => 6, 'g10b_');
  chat.startChatTransport('p1');
  assert(chat._isPollingActiveForTest() === true, 'a device whose last-known setting says chat is ON starts polling immediately, before hydrate');
  await settle();

  storage.saveSetting('chatEnabled', false);       // the hydrate says the commissioner turned it OFF
  chat.refreshChatEnabled();
  const callsAtOff = callsB.length;
  assert(chat._isPollingActiveForTest() === false,
    'refreshChatEnabled() after hydrate stops the early subscription — a remote chat-off cannot outlive the hydrate window');
  await settle();
  await settle();
  assert(callsB.length === callsAtOff,
    `and zero further network activity follows it — ${callsB.length - callsAtOff} extra requests after the toggle, expected 0`);

  // …and the opposite skew: stale OFF, hydrate says ON.
  resetAll();
  storage.saveSetting('chatEnabled', false);
  seedCache({ epoch: 0, head: 6, events: Array.from({ length: 6 }, (_, i) => mkEv(i + 1, { id: 'g10b2_' + (i + 1) })) });
  backend.setDataMode('supabase');
  const callsB2 = installFetch(() => 6, 'g10b2_');
  const startedB2 = chat.startChatTransport('p1');
  assert(startedB2 === false && chat._isPollingActiveForTest() === false && chat.getMessages({ tag: 'all' }).length === 0,
    'a stale OFF starts nothing and replays nothing — chat OFF still means no chat, not merely no polling');
  assert(callsB2.length === 0, `fixture: and issues no requests — got [${callsB2.map(c => c.action).join(', ')}]`);
  storage.saveSetting('chatEnabled', true);
  chat.refreshChatEnabled();
  assert(chat._isPollingActiveForTest() === true,
    'and the OFF->ON direction still recovers through the same post-hydrate call — the early start is never a latch');
  await waitFor(() => chat.getMessages({ tag: 'all' }).length === 6);
  assert(chat.getMessages({ tag: 'all' }).length === 6, `and the room arrives normally afterwards — got ${chat.getMessages({ tag: 'all' }).length} of 6`);
  storage.saveSetting('chatEnabled', true);

  // ── C. Two entry points, ONE subscription — and the in-flight cold-boot
  //    read survives the second one. ──
  // This is the assertion that pins the SHAPE of the fix, not just its
  // effect. initChat()'s _subscribeNow() is unconditional by design (it
  // unsubscribes first), so calling it over a live early subscription would
  // abandon the cold boot's in-flight first read — 8-26s of Apps Script cold
  // start, thrown away and started again, which is the exact delay this whole
  // fix removes. The hanging-fetch deferral below makes that observable: the
  // first read is STILL IN FLIGHT when initChat() runs.
  resetAll();
  backend.setDataMode('supabase');
  let releaseFirst = null;
  let heldOnce = false;
  const holdFirst = async () => {
    if (heldOnce) return;
    heldOnce = true;
    await new Promise((r) => { releaseFirst = r; });      // the cold start: answers only when we say so
  };
  const fakeC = installFakeChat(transportMod, projectionMod, {
    head: async () => { await holdFirst(); return 4; },
    since: async (seq, limit) => { await holdFirst(); return honestSince(() => 4, seq, limit, 'g10c_'); },
  });
  _fake = fakeC;
  const callsC = fakeC.calls;

  chat.startChatTransport('p1');                    // tick #1 leaves, and hangs
  await settle();
  const callsBeforeInit = callsC.length;
  assert(callsBeforeInit === 1, `fixture: exactly one request is in flight when hydrate finishes — got ${callsBeforeInit}`);

  chat.initChat('p1');                              // ← the post-hydrate call, over a live subscription
  await settle();
  assert(callsC.length === 1,
    `initChat() does NOT re-subscribe over the early subscription — still ${callsC.length} request in flight, not a second one (pre-fix: _subscribeNow() ran unconditionally, tearing down the in-flight cold read and paying the cold start twice)`);
  assert(chat._isPollingActiveForTest() === true, 'and exactly one subscription is live afterwards');

  releaseFirst && releaseFirst();                   // the cold instance finally answers the ORIGINAL request
  await waitFor(() => chat.getMessages({ tag: 'all' }).length === 4);
  assert(chat.getMessages({ tag: 'all' }).length === 4,
    `and the answer to that original, in-flight request still lands in the fold — ${chat.getMessages({ tag: 'all' }).length} of 4 messages (proof the subscription that issued it was never torn down)`);

  // ── D. RG-100's input, made more likely by starting earlier. ──
  // The c3c2 shape from notifytest.mjs §12b, driven through the EARLY entry
  // point instead of initChat(): a cold-start `{events:[], head:0}` artifact
  // ahead of a real, already-populated room. Asserted HERE rather than in
  // notifytest.mjs only because notifytest.mjs is outside the files this fix
  // was scoped to edit — the path exercised is the same real one
  // (notifications.js's wireChatNotifications() + a registered push adapter).
  resetAll();
  const capturedD = [];
  notif.registerPushAdapter({ isConfigured: () => true, send: async r => { capturedD.push(r); return { ok: true }; } });
  notif.wireChatNotifications();
  backend.setDataMode('supabase');
  let headD = 0;                                    // the server's head has not warmed up
  const fakeD = installFakeChat(transportMod, projectionMod, {
    head: () => headD,
    since: (seq, limit) => (headD === 0 ? { events: [] } : honestSince(() => headD, seq, limit, 'g10d_')),
  });
  _fake = fakeD;
  const callsD = fakeD.calls;

  chat.startChatTransport('p1');                    // no device cache here — the first read IS the head:0 artifact
  await settle();
  assert(chat.chatStatus().head === 0 && chat.chatStatus().caughtUp === false,
    `fixture: the early read got the head:0 artifact and did NOT latch caughtUp (RG-100 F2) — head ${chat.chatStatus().head}, caughtUp ${chat.chatStatus().caughtUp}`);
  assert(store.get(K_EVENTS_CACHE) === undefined,
    'and it wrote no device-local cache entry for a head:0 answer (RG-100 × DI-169, §7 above — still true from the early entry point)');

  headD = 18;                                       // the sheet warms up: 18 real messages were there all along
  chat.initChat('p1');                              // hydrate lands mid-way, as it would on a real boot
  await chat.forceRefresh();
  await waitFor(() => chat.chatStatus().head === 18);
  await settle();

  const dHistory = capturedD.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
  assert(chat.getMessages({ tag: 'all' }).length === 18,
    `fixture: the real 18-message room folded completely after the artifact — got ${chat.getMessages({ tag: 'all' }).length}`);
  assert(dHistory === 0,
    `an early head:0 read followed by the real backfill relays ZERO pushes — got ${dHistory} (the unguarded shape is 90 = 18 × 5, and starting before hydrate makes this read MORE likely, not less)`);
  const dTrips = notif._chatRelayBurstTripsForTest?.() || [];
  assert(dTrips.length === 0, `and that zero is CLASSIFICATION, not the burst cap swallowing it — trips ${dTrips.length}`);
  assert(notif._chatWatermarkForTest?.() === 18,
    `the watermark ends at the true head 18, not stuck at the artifact's 0 — got ${notif._chatWatermarkForTest?.()}`);

  headD = 19;                                       // a genuinely new message, after reconciliation
  await chat.forceRefresh();
  await settle();
  const dLive = capturedD.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - dHistory;
  assert(dLive === players.length - 1,
    `and a genuinely new message after reconciliation DOES relay, to every other active player — got ${dLive}, expected ${players.length - 1}`);
  notif._clearPushAdapterForTest();
  resetAll();
}

// ═══════════════════════════════════════════════════════════════════════════
// [11] BUG-G F1 (reviewer BLOCK, 2026-09-11) — startChatTransport() is NOT
//      guaranteed to be the first thing that subscribes.
// ═══════════════════════════════════════════════════════════════════════════
// §10 above drives startChatTransport() as the first subscriber after a bare
// reset. That is the FIRST-EVER-DEVICE shape (primedKeys === 0). The shape
// every returning player actually boots is different: app.js calls
// navigateTo('dashboard') when the mirror is primed, and navigateTo() ends
// with refreshChatEnabled(), which SUBSCRIBES. Against the first version of
// this fix that meant startChatTransport() hit `if (S.unsub) return true`
// before priming anything and did nothing at all — the cached room still
// waited for hydrate, in the majority case, while §10 stayed green.
//
// Two independent fixes, asserted separately below because either one alone
// leaves a hole:
//   F1a (chat.js) — primeEventsCacheOnce() moved ABOVE that early return, so
//        the replay happens whatever subscribed first.
//   F1b (app.js)  — the early phase moved ABOVE the navigateTo() call, so
//        nothing else subscribes first in the first place, and the very first
//        tick therefore has a cursor and takes the incremental branch.
console.log('\n[11] BUG-G F1 — a subscription that already exists (navigateTo → refreshChatEnabled) must not skip the cache…');
{
  // ── A. THE WRONG ORDER (what F1a defends): something subscribed first. ──
  resetAll();
  const cachedA = Array.from({ length: 12 }, (_, i) => mkEv(i + 1, { id: 'g11a_' + (i + 1) }));
  seedCache({ epoch: 0, head: 12, events: cachedA });
  storage.saveSetting('chatEpochSeq', 0);
  backend.setDataMode('supabase');
  // A RECORDING hanging stub, not installFetch(): §11A asserts only synchronous
  // state, and a request that actually resolves here would deliver §11A's
  // events into §11B's fold (an unsubscribed in-flight tick still settles its
  // own promise chain) — which is precisely how this section first went red.
  const callsA = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    callsA.push({ action: u.searchParams.get('action') });
    return new Promise(() => {});
  };

  chat.refreshChatEnabled();                       // navigateTo('dashboard')'s tail — subscribes with S.head 0
  assert(chat._isPollingActiveForTest() === true,
    'fixture: refreshChatEnabled() has already subscribed before the early phase runs (S.head 0, no cache, no subscriber)');
  const callsBefore = callsA.length;

  chat.startChatTransport('p1');                   // the early phase, arriving second
  assert(chat.getMessages({ tag: 'all' }).length === 12,
    `the cached room STILL renders synchronously — got ${chat.getMessages({ tag: 'all' }).length} of 12 (pre-F1a: 0, because the already-subscribed early return ran before the prime)`);
  assert(chat.chatStatus().head === 12,
    `and the cursor is still primed from the cache — got ${chat.chatStatus().head} (pre-F1a: 0, so the next tick re-read the whole room)`);
  // N5 (reviewer) — `if (S.unsub) return true` survived deletion green before
  // this. One subscription means one poll loop: a second would issue its own
  // tick immediately, so the request COUNT is the honest discriminator.
  assert(callsA.length === callsBefore,
    `and arriving second issues NO second tick — ${callsA.length - callsBefore} extra requests, expected 0 (delete the S.unsub early return and this goes to 1: two poll loops on one device, double quota forever)`);
  assert(chat._isPollingActiveForTest() === true, 'and exactly one subscription is still live');

  // ── B. THE REAL app.js ORDER (what F1b buys on top): early phase first. ──
  // This is the order boottest §10F measures end to end; here it is isolated
  // to the one property that only the ORDER can give — the first tick sees a
  // non-zero cursor, so it takes the cheap chatHead probe + incremental
  // chatSince(cachedHead) branch instead of RG-91's full chatSince(0, 500).
  resetAll();
  const cachedB = Array.from({ length: 12 }, (_, i) => mkEv(i + 1, { id: 'g11b_' + (i + 1) }));
  seedCache({ epoch: 0, head: 12, events: cachedB });
  storage.saveSetting('chatEpochSeq', 0);
  backend.setDataMode('supabase');
  let headB = 15;                                  // 3 arrived while the app was closed
  const callsB = installFetch(() => headB, 'g11b_');

  chat.startChatTransport('p1');                   // app.js: early phase FIRST
  assert(chat.getMessages({ tag: 'all' }).length === 12, 'fixture: cached room rendered at t=0');
  chat.refreshChatEnabled();                       // then navigateTo('dashboard') — must be a no-op
  assert(chat._isPollingActiveForTest() === true, 'the later refreshChatEnabled() leaves the single live subscription alone');

  await waitFor(() => chat.chatStatus().head === headB);
  const sinceB = callsB.filter(c => c.action === 'chatSince');
  assert(sinceB.length > 0 && sinceB[0].seq === 12,
    `the FIRST chatSince asks for the cached head (12) — an incremental read — got seq ${sinceB.length ? sinceB[0].seq : 'none'} (wrong order: seq 0, a full 500-row cold read)`);
  assert(!sinceB.some(c => c.seq === 0),
    `and no chatSince(0) ever happens on this boot — seqs [${sinceB.map(c => c.seq).join(', ')}]`);
  assert(chat.getMessages({ tag: 'all' }).length === 15,
    `and the 3 messages that arrived while closed land on top of the cached 12 — got ${chat.getMessages({ tag: 'all' }).length}`);

  // ── C. The OTHER thing refreshChatEnabled() does pre-hydrate: flushOutbox().
  // The binding constraint says the outbox must not be flushed before hydrate
  // (RG-49: stale chatter re-sent into a freshly-cleared room). navigateTo()
  // reaches flushOutbox() through refreshChatEnabled() at app.js's primed-
  // mirror boot, BEFORE hydrate — and that predates BUG-G. It is safe, but by
  // an invariant that is invisible unless stated: S.outbox is only ever
  // POPULATED from localStorage by loadOutbox(), which runs in initChat() —
  // the LATE phase. Until then the queue is empty and flushOutbox() returns at
  // its first line. Asserted rather than argued, because "the early half must
  // not flush" is one refactor away from being false.
  resetAll();
  const staleEv = { id: 'g11c_stale', seq: null, ts: 1, type: 'message', author: 'p1', body: 'stale test chatter', notify: true };
  store.set('cfbp_chat_outbox2', JSON.stringify([staleEv]));   // a queued send persisted by a PREVIOUS session
  storage.saveSetting('chatEpochSeq', 0);
  backend.setDataMode('supabase');                   // device-local key — already true at boot on a returning device
  const appends = [];
  _fake = installFakeChat(transportMod, projectionMod, {
    head: () => 0,
    since: () => ({ events: [] }),
    append: (events) => {
      appends.push({ events });
      // Assign a seq so chat.js reconciles and does not re-queue the event —
      // `{ assigned: [] }` (what the old Apps Script stub answered) would leave
      // it pending and the second flush would send it a second time.
      return { assigned: (events || []).map((e, i) => ({ id: e.id, seq: 1000 + i, ts: Date.now() })) };
    },
  });

  chat.refreshChatEnabled();          // navigateTo('dashboard'), pre-hydrate — reaches flushOutbox()
  chat.startChatTransport('p1');      // the early phase, pre-hydrate
  await settle();
  assert(appends.length === 0,
    `NOTHING is appended before hydrate — ${appends.length} chatAppend requests, expected 0 (the persisted outbox has not been deserialized yet; loadOutbox() is in the late phase, and that is the whole reason the early half is seam-safe)`);
  assert(store.get('cfbp_chat_outbox2') === JSON.stringify([staleEv]),
    'and the persisted queue is untouched — nothing lost, nothing sent');

  chat.initChat('p1');                // the LATE phase: loadOutbox() + flushOutbox()
  await settle();
  assert(appends.length === 1,
    `and the SAME queued send does flush once hydrate has happened — ${appends.length} chatAppend, expected 1 (proving §11C's zero is ordering, not a broken fixture)`);
  resetAll();
}

// ═══════════════════════════════════════════════════════════════════════════
// [12] BUG-G F-2 — the teaser that now renders at t=0 must be a LIVE tap
//      target, not a dead one.
// ═══════════════════════════════════════════════════════════════════════════
// #page-dashboard is statically `.active` in index.html, so dashboardPageActive()
// is TRUE during the first paint — which means the early phase's cache replay
// inserts the dashboard chat teaser, carrying `data-open-chat`, before hydrate.
// The delegated click listener that gives that attribute meaning used to be
// registered only in the late phase. Visible-but-dead for the whole hydrate
// window is a worse failure than absent: the player taps the preview, nothing
// happens, and concludes chat is broken — the report BUG-G exists to close.
//
// Driven through the REAL handler registered by the REAL initChatUI(), not a
// re-implementation: the handler is an anonymous closure, so the only honest
// way to test it is to capture what it registered on `document` and invoke it.
console.log('\n[12] BUG-G F-2 — after the EARLY phase alone, a tap on the teaser opens chat…');
{
  resetAll();
  docListeners.clear();
  const prevQS = querySelectorHook;
  let navClicks = 0;
  querySelectorHook = sel => (sel === '.nav-item[data-tab="chat"]' ? { click() { navClicks++; } } : null);

  const cached = Array.from({ length: 5 }, (_, i) => mkEv(i + 1, { id: 'g12_' + (i + 1) }));
  seedCache({ epoch: 0, head: 5, events: cached });
  storage.saveSetting('chatEpochSeq', 0);
  storage.saveSetting('chatEnabled', true);
  backend.setDataMode('supabase');
  installHangingFetch();

  // ── EARLY PHASE ONLY — hydrate has not happened and may never happen. ──
  chatUi.initChatUI({ phase: 'early' });
  assert(chat.getMessages({ tag: 'all' }).length === 5,
    `fixture: the early phase replayed the cached room, so the teaser has something to render — got ${chat.getMessages({ tag: 'all' }).length} of 5`);
  assert(chatUi._delegatedChatClicksWiredForTest() === true,
    'the delegated click listener is wired by the EARLY phase (pre-fix: only by the late one, i.e. only after hydrate)');

  // A tap on the teaser's [data-open-chat] region, delivered to EVERY click
  // listener on document — which is what a real click does. Counting raw
  // listeners would measure the wrong thing: the late phase's
  // wireRevealCloser() legitimately registers its own (unrelated) document
  // click handler, with its own latch. What must be exactly one is the number
  // of handlers that RESPOND to this tap.
  const fakeOpenChatEl = { dataset: {} };
  const tap = () => {
    let prevented = 0;
    const before = navClicks;
    (docListeners.get('click') || []).forEach(h => h({
      target: { closest: sel => (sel === '[data-open-chat]' ? fakeOpenChatEl : null) },
      preventDefault() { prevented++; },
    }));
    return { responders: navClicks - before, prevented };
  };

  const early = tap();
  assert(early.responders === 1,
    `and tapping it actually navigates to chat — ${early.responders} handler(s) responded, expected 1 (pre-fix: 0, for the whole 8-26s hydrate window and forever on a failed hydrate)`);
  assert(early.prevented === 1, 'and the tap is consumed (preventDefault), not left to fall through');

  // ── LATE PHASE — must not register a SECOND delegated chat listener. ──
  // Two would mean two navToChat() calls per tap (and two openGameChatSheet()
  // calls per game bubble) — the reason the latch exists.
  chatUi.initChatUI();
  assert(chatUi._delegatedChatClicksWiredForTest() === true, 'the latch is still set after the late phase');
  const both = tap();
  assert(both.responders === 1,
    `one tap after BOTH phases still produces exactly ONE navigation — got ${both.responders} (without the latch: 2, every tap firing twice)`);
  assert(both.prevented === 1,
    `and preventDefault is called once, not once per duplicate registration — got ${both.prevented}`);

  querySelectorHook = prevQS;
  docListeners.clear();
  resetAll();
}

// ── Summary ──────────────────────────────────────────────────────────────────
globalThis.fetch = async () => { throw new Error('network disabled after cachetest.mjs'); };
resetAll();
// ═══════════════════════════════════════════════════════════════════════════
// [13] BUG-12 — wakeChat(): the push-driven forced fetch, through the REAL
//      chat engine. boottest.mjs §11 pins the transport's bound and timing on
//      a fake clock; this drives the seam app.js actually calls, on real
//      timers, and asserts the thing the player cares about — that the message
//      the push announced is IN THE ROOM by the time the wake resolves.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[13] BUG-12 — wakeChat() puts the pushed message in the room without waiting for the poll…');
{
  resetAll();
  // ── A. Not subscribed (chat off, or boot has not reached initChat yet).
  //      A tap must be a safe no-op, never a throw and never a stray request. ──
  let strayCalls = 0;
  globalThis.fetch = async () => { strayCalls++; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const idleWake = await chat.wakeChat();
  assert(idleWake === false && strayCalls === 0,
    `13-1: wakeChat() with no live subscription answers false and issues no request (got ${idleWake}, ${strayCalls} request(s)) — a push tap on a device with chat off must not reach the backend`);

  // ── B. THE BUG. A live, caught-up room; a message lands on the server; the
  //      push tap forces the fetch instead of waiting for the next poll. ──
  resetAll();
  let serverHead = 12;
  backend.setDataMode('supabase');
  const calls13 = installFetch(() => serverHead, 'w');
  chat.initChat('p1');
  const settled13 = await waitFor(() => chat.chatStatus().caughtUp === true);
  assert(settled13, `fixture: the room is complete at head ${serverHead} before the push arrives`);

  serverHead += 1;                                  // ← the message the push is about
  const callsBefore = calls13.length;
  const ok13 = await chat.wakeChat();
  await settle();
  assert(ok13 === true && calls13.length > callsBefore,
    `13-2: a push tap forces a round trip immediately (${calls13.length - callsBefore} request(s), resolved ${ok13}) — the room's own cadence here is 45-60s, which is Drew's "at least 30 seconds"`);
  assert(chat.getMessages({ tag: 'all' }).some(m => m.id === 'w13'),
    '13-3: …and the pushed message is IN THE FOLD by the time wakeChat() resolves — this is what app.js\'s deepLinkTo() awaits before it scrolls, so the jump lands on the message instead of no-opping');

  // ── C. Bounded, and still answers. A second tap inside the wake window
  //      must not add a round trip — and must not hang the deep link either. ──
  serverHead += 1;
  const callsBefore2 = calls13.length;
  const t0 = Date.now();
  const second = await Promise.race([
    chat.wakeChat(),
    new Promise(r => setTimeout(() => r('HUNG'), 8000)),
  ]);
  assert(second !== 'HUNG',
    `13-4: a second tap inside the wake window still RESOLVES (in ${Date.now() - t0}ms) — a deep link that awaits a wake which never answers is a dead tap`);
  // BOUND WIDENED 2026-09-23, and the number is the only thing that moved.
  // `sbFetchSince()` makes TWO server calls where Apps Script's `chatSince`
  // made one — the page and then a SEPARATE `chat_head`, because the head must
  // never be max(seq) of the page (BUG-B/RG-94). So one forced round trip is up
  // to three requests (head probe, page, head) rather than up to two. The claim
  // is unchanged: ONE round trip's worth, not one per tap.
  assert(calls13.length - callsBefore2 <= 3,
    `13-5: …on at most one forced round trip's worth of requests, not one per tap (got ${calls13.length - callsBefore2}) — the bound that keeps a flapping tab off the backend`);
  note(`  requests: [${calls13.map(c => c.action + (c.action === 'chatSince' ? ':' + c.seq : '')).join(', ')}]`);

  resetAll();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
}

// REVIEWER F8 (sixth gate) — write-then-exit-in-the-callback: `console.log()`
// followed by `process.exit()` is a race whenever stdout is a pipe (loadtest's
// spawnSync, any `| grep`), and the dropped line is the one the parent parses.
// See authtest.mjs's fuller note at the same place.
process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.exit(fail === 0 ? 0 : 1));

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
