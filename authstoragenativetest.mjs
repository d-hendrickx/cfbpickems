/**
 * CFB Pickems — authstoragenativetest.mjs
 * ========================================
 * DI-247/DI-249/DI-250/DI-251 (iOS Munera thread, 2026-09-21) — Keychain
 * session storage. Precedent: nativeguardtest.mjs/authnativetest.mjs — a
 * NEW, separate file, spawned from loadtest.mjs the house way, so nothing
 * here ever edits authtest.mjs (the Supabase thread's file, held until
 * their v0.23.3 merges).
 *
 * Run:  node authstoragenativetest.mjs
 *
 * Covers:
 *   [1]  Web inertness — primeNativeAuthStorage() is a true no-op with
 *        isNativeOrigin() false (the real web case); zero window globals set.
 *   [2]  Adapter contract against a stub plugin — set/get/remove round trip,
 *        absence-vs-error distinction (missing key -> null, never a throw).
 *   [3]  Marker shape + freshness — access_token/refresh_token placeholders,
 *        real expires_at, refreshed on SIGNED_IN/TOKEN_REFRESHED/
 *        INITIAL_SESSION via the second onAuthStateChange subscriber, removed
 *        on SIGNED_OUT (+ Keychain item + verifier keys + plugin.clear()).
 *   [4]  Migration — happy path (verified delete), write-not-verified (keeps
 *        both, surfaces error), delete-not-verified (refuses to trust either
 *        copy), idempotent second run (migration flag).
 *   [5]  K3 four outcomes reach getNativeAuthStorageNotice() with the exact
 *        DI-251 §4 copy; notFound reaches neither a throw nor a notice.
 *   [6]  Cache-after-first-read — two nativeGetItem() calls for the same key
 *        hit the stub plugin's get() once, not twice.
 *   [7]  Spoof proofs — window.__cfbpNativeAuthStorage + a stub Capacitor on
 *        an https: origin: primeNativeAuthStorage() is STILL a no-op
 *        (isNativeOrigin() is origin-positive, not shell-alone).
 *   [8]  DI-248's own K1 spoof proof, run here (Supabase thread's request):
 *        a spoofed window.__cfbpNativeAuthStorage AND a stub Capacitor on an
 *        https: origin still yields `storage: undefined` from
 *        ensureClient()'s options — proved indirectly via getSupabaseClient()
 *        not throwing and the marker never getting native-primed.
 *   [9]  Grep guards — no "@capacitor" anywhere in this file's own source;
 *        this file is never statically imported by any file cfb-pickems/
 *        ships (only a dynamic import() string literal in js/app.js); this
 *        file is not in service-worker.js's STATIC_ASSETS.
 *   [10] K2 reader inventory, proved rather than asserted from the module
 *        header alone: grep of AUTH_STORAGE_KEY/cfbp_supabase_session across
 *        cfb-pickems/js finds readers in exactly js/auth.js and this file.
 *   [11] DI-249 boot-hook ordering + no-crash proof, against the real
 *        js/app.js source (grep-level — a live boot() run needs authtest's
 *        DOM stub, out of this file's scope) and a stubbed-throw call.
 *   [12] Mutation proofs (DI-250) — run at the END, against SCRATCH COPIES
 *        only, restored, and the whole suite re-run to prove it goes back to
 *        green. Per CLAUDE.md's rule, no `git checkout`/`restore`/`stash` is
 *        used anywhere in this file.
 */

import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
function assert(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail !== undefined ? `— ${detail}` : ''); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reviewer's latent-trap note (2026-09-23 re-apply): the mutation sections
// below used to write their scratch `__mutation_scratch_*.js` siblings
// directly INTO cfb-pickems/js/ — real, alongside the tracked modules — for
// the few hundred milliseconds between write and the `finally` cleanup. Any
// OTHER process that scans js/ during that window (a concurrently-run
// loadtest.mjs among them — see its own suites that grep the whole js/ tree)
// could see a stray, half-mutated file. Scratch copies now live in an OS
// tmpdir instead, created once per run and removed at the very end. Their
// relative imports (`./platform.js`, `./auth.js`, `./backend.js`, …) are
// rewritten to absolute `file://` URLs pointing at the REAL js/ siblings
// (rewriteRelativeImportsForScratch(), below) so they still resolve against
// the unmutated dependency graph without living inside it.
const scratchDir = await mkdtemp(path.join(tmpdir(), 'cfbp-authstoragenative-'));
function rewriteRelativeImportsForScratch(src) {
  return src.replace(/(from\s+')(\.\/[^']+)(')/g, (whole, pre, rel, post) => {
    return pre + pathToFileURL(path.join(__dirname, 'js', rel)).href + post;
  });
}

// ── Fakes ────────────────────────────────────────────────────────────────────
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: i => [...store.keys()][i] ?? null,
    _store: store,
  };
}

/** Mirrors KeychainAuthStorage.swift's real observable contract: get() never
 *  throws for absence (resolves {value:null}); exists()/get() are counted
 *  separately so [6] can prove the JS-side cache avoids a redundant call;
 *  set() rejects with {code:'passcodeNotSet'} when `noPasscode` is armed. */
function makeFakeKeychainPlugin({ noPasscode = false } = {}) {
  const store = new Map();
  let getCalls = 0, bypassGetCalls = 0, existsCalls = 0, setCalls = 0;
  let forcedError = null;
  // S2 fixture: when set, a NON-bypass get() returns this instead of the
  // real store contents — simulating the Swift-level (or JS-level) cache
  // reporting a value that does NOT match what is actually persisted.
  // bypassCache:true ALWAYS reads the real store, regardless.
  let staleCacheOverride = null;
  return {
    async set({ key, value, protected: isProtected }) {
      setCalls++;
      if (noPasscode && isProtected) {
        const e = new Error('cannot construct access control (no device passcode?)');
        e.code = 'passcodeNotSet';
        throw e;
      }
      store.set(key, { value, protected: !!isProtected });
    },
    async get({ key, bypassCache }) {
      existsCalls++; // the real get() always does an attributes-only exists() first
      if (forcedError) { const e = forcedError; forcedError = null; throw e; }
      if (bypassCache) {
        bypassGetCalls++;
        if (!store.has(key)) return { value: null };
        getCalls++;
        return { value: store.get(key).value };
      }
      if (staleCacheOverride !== null) return { value: staleCacheOverride };
      if (!store.has(key)) return { value: null };
      getCalls++;
      return { value: store.get(key).value };
    },
    async remove({ key }) { store.delete(key); },
    async clear() { store.clear(); },
    async exists({ key }) { existsCalls++; return { exists: store.has(key) }; },
    _store: store,
    _forceNextError(code, message) { forcedError = { code, message: message || code }; },
    _getCalls: () => getCalls,
    _bypassGetCalls: () => bypassGetCalls,
    _existsCalls: () => existsCalls,
    _setCalls: () => setCalls,
    _setStaleCacheOverride(v) { staleCacheOverride = v; },
  };
}
function makeFakePreferences() {
  const store = new Map();
  return {
    async get({ key }) { return { value: store.has(key) ? store.get(key) : null }; },
    async set({ key, value }) { store.set(key, String(value)); },
    async remove({ key }) { store.delete(key); },
    _store: store,
  };
}
/** A minimal fake Supabase SDK client: supports multiple onAuthStateChange
 *  subscribers (the real GoTrueClient's stateChangeEmitters is a Map — this
 *  is what lets auth.js's own internal listener AND this module's second
 *  listener both fire off one event, matching production). */
function makeFakeSupabaseFactory() {
  const listeners = [];
  const client = {
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { return { error: null }; },
    },
  };
  return {
    createClient: () => client,
    fireAll(event, session) { listeners.slice().forEach(fn => fn(event, session)); },
    listenerCount: () => listeners.length,
  };
}

function setNativeGlobals({ plugin, prefs, protocol = 'capacitor:', firstLaunch = false } = {}) {
  globalThis.window = globalThis.window || {};
  globalThis.window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { KeychainAuthStorage: plugin, Preferences: prefs },
  };
  globalThis.location = { protocol };
  // Most fixtures below are testing STEADY-STATE behavior (a session already
  // primed from an earlier launch), not the fresh-install hygiene sweep
  // ([4]'s own dedicated fixture covers that). Default to "not first
  // launch" so a fixture's pre-seeded plugin store survives prime()'s
  // hygiene check unless it deliberately opts into `firstLaunch:true`.
  if (!firstLaunch && prefs && prefs._store) {
    prefs._store.set(authStorageNative._INSTALLED_FLAG_KEY_FOR_TEST, '1');
  }
}
function clearNativeGlobals() {
  delete globalThis.window;
  delete globalThis.location;
}

// ── Module loads (fresh per fixture via dynamic import + reset hooks, same
//    pattern nativeguardtest.mjs/authnativetest.mjs use — these modules have
//    no per-process state that needs re-importing, only re-arming) ─────────
globalThis.localStorage = makeLocalStorage();
const platform = await import('./js/platform.js');
const auth = await import('./js/auth.js');
const authStorageNative = await import('./js/auth-storage-native.js');

function resetAll() {
  globalThis.localStorage.clear();
  auth._resetAuthForTest();
  authStorageNative._resetAuthStorageNativeForTest();
  clearNativeGlobals();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Web inertness — primeNativeAuthStorage() is a true no-op off native…');
{
  resetAll();
  // The real web case: no window.Capacitor, https: (or nothing) protocol.
  globalThis.location = { protocol: 'https:' };
  assert(platform.isNativeOrigin() === false, '[1a] fixture: isNativeOrigin() is false with no window.Capacitor');
  await authStorageNative.primeNativeAuthStorage();
  assert(authStorageNative.getNativeAuthStorageNotice() === null, '[1b] no notice was set');
  assert(typeof globalThis.window === 'undefined' || !globalThis.window.__cfbpNativeAuthStorage,
    '[1c] window.__cfbpNativeAuthStorage was never set on web');
  clearNativeGlobals();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Adapter contract against a stub plugin — round trip + absence-vs-error…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences() });
  const v = await authStorageNative._nativeGetItemForTest('some-key');
  assert(v === null, '[2a] get() of a missing key resolves null, never throws');
  assert(authStorageNative.getNativeAuthStorageNotice() === null, '[2b] …and sets no notice (absence is not an error)');
  await authStorageNative._nativeSetItemForTest('some-key', 'hello');
  const v2 = await authStorageNative._nativeGetItemForTest('some-key');
  assert(v2 === 'hello', `[2c] set() then get() round-trips the value (got ${JSON.stringify(v2)})`);
  await authStorageNative._nativeRemoveItemForTest('some-key');
  const v3 = await authStorageNative._nativeGetItemForTest('some-key');
  assert(v3 === null, '[2d] remove() then get() resolves null again');
  clearNativeGlobals();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] Marker shape + freshness…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  const prefs = makeFakePreferences();
  setNativeGlobals({ plugin, prefs });
  const realSession = { access_token: 'real.jwt.token', refresh_token: 'real-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  await plugin.set({ key: authStorageNative._MARKER_KEY_FOR_TEST, value: JSON.stringify(realSession), protected: true });

  await authStorageNative.primeNativeAuthStorage();
  const markerRaw = globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST);
  assert(!!markerRaw, '[3a] a marker was written after prime()');
  const marker = JSON.parse(markerRaw);
  assert(marker.access_token === authStorageNative._NATIVE_PLACEHOLDER_FOR_TEST,
    `[3b] marker.access_token is the placeholder (got ${JSON.stringify(marker.access_token)})`);
  assert(marker.refresh_token === authStorageNative._NATIVE_PLACEHOLDER_FOR_TEST,
    `[3c] marker.refresh_token is ALSO the placeholder — parity with the Supabase thread's upcoming hasPersistedSupabaseSession() (got ${JSON.stringify(marker.refresh_token)})`);
  assert(marker.expires_at === realSession.expires_at,
    `[3d] marker.expires_at is copied verbatim from the real session (got ${marker.expires_at})`);
  assert(auth.hasValidSupabaseSession() === true, '[3e] hasValidSupabaseSession() reads true off the marker');
  // v0.23.5 reconciliation (2026-09-23) — hasPersistedSupabaseSession() (RG-194)
  // did not exist when [3c]'s comment above was written; it now does, and
  // requires session.refresh_token to be a non-empty STRING (not merely
  // truthy). The placeholder satisfies that directly: proved against the
  // REAL function rather than just asserted about the marker's shape.
  assert(auth.hasPersistedSupabaseSession() === true,
    '[3f] hasPersistedSupabaseSession() (RG-194) also reads true off the native marker — the placeholder refresh_token is a non-empty string, satisfying its length > 0 check');

  // ── Refresh on TOKEN_REFRESHED (via a SECOND, independent subscriber on
  //    the SAME client — DI-247 §2c part 2) ──────────────────────────────────
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authModeKnown: true });
  const fakeSdk = makeFakeSupabaseFactory();
  globalThis.window.supabase = fakeSdk;
  const client = auth.getSupabaseClient(); // wires auth.js's OWN internal listener
  assert(!!client, '[3f] fixture: a client was created off the fake SDK factory');
  authStorageNative._attachAuthListenerForTest(); // wires THIS module's second listener
  assert(authStorageNative._isAuthListenerAttachedForTest() === true, '[3g] the second listener attached (client was already available)');
  assert(fakeSdk.listenerCount() === 2, `[3h] the fake client now has TWO onAuthStateChange subscribers (got ${fakeSdk.listenerCount()})`);

  const laterExpiry = Math.floor(Date.now() / 1000) + 7200;
  fakeSdk.fireAll('TOKEN_REFRESHED', { user: { id: 'u1', email: 'a@b.com' }, access_token: 'x', expires_at: laterExpiry });
  const marker2 = JSON.parse(globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST));
  assert(marker2.expires_at === laterExpiry, `[3i] TOKEN_REFRESHED refreshed the marker's expires_at (got ${marker2.expires_at})`);

  // ── Clear on SIGNED_OUT — marker, Keychain item, verifier keys, clear() ──
  await plugin.set({ key: 'cfbp_supabase_session-code-verifier', value: 'verifier-value', protected: false });
  await authStorageNative._nativeGetItemForTest('cfbp_supabase_session-code-verifier'); // populate the JS cache so the sweep has something to find
  fakeSdk.fireAll('SIGNED_OUT', null);
  await new Promise(r => setTimeout(r, 10)); // the SIGNED_OUT handler's Keychain calls are fire-and-forget promises
  assert(globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST) === null,
    '[3j] SIGNED_OUT cleared the marker');
  assert(plugin._store.size === 0, `[3k] SIGNED_OUT cleared EVERY Keychain item (session + verifier), via clear() as the belt-and-brace (got ${plugin._store.size} left)`);
  delete globalThis.window.supabase;
  clearNativeGlobals();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Migration — happy path, write-not-verified, delete-not-verified, idempotent…');
{
  // (a) happy path
  resetAll();
  {
    const plugin = makeFakeKeychainPlugin();
    const prefs = makeFakePreferences();
    setNativeGlobals({ plugin, prefs });
    const preKeychainSession = { access_token: 'pre-upgrade.jwt', refresh_token: 'pre-upgrade-refresh', expires_at: Math.floor(Date.now() / 1000) + 1000 };
    globalThis.localStorage.setItem(authStorageNative._MARKER_KEY_FOR_TEST, JSON.stringify(preKeychainSession));
    await authStorageNative.primeNativeAuthStorage();
    assert(plugin._store.has(authStorageNative._MARKER_KEY_FOR_TEST), '[4a] the real pre-Keychain session was written into Keychain');
    assert(prefs._store.get(authStorageNative._MIGRATED_FLAG_KEY_FOR_TEST) === '1', '[4b] the migration flag was set');
    const marker = JSON.parse(globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST));
    assert(marker.expires_at === preKeychainSession.expires_at, '[4c] the marker reflects the migrated session\'s real expires_at');
    clearNativeGlobals();
  }

  // (b) write-not-verified — keep old, surface error, do NOT delete localStorage
  resetAll();
  {
    const plugin = makeFakeKeychainPlugin();
    // sabotage: get() (used for the post-write read-back) always reports a
    // DIFFERENT value than what was just set, simulating a write that did
    // not actually land.
    const realGet = plugin.get.bind(plugin);
    plugin.get = async (args) => {
      const r = await realGet(args);
      if (r && r.value != null) return { value: r.value + '-CORRUPTED' };
      return r;
    };
    const prefs = makeFakePreferences();
    setNativeGlobals({ plugin, prefs });
    const raw = JSON.stringify({ access_token: 'pre-upgrade.jwt', refresh_token: 'r', expires_at: 99999999999 });
    globalThis.localStorage.setItem(authStorageNative._MARKER_KEY_FOR_TEST, raw);
    await authStorageNative.primeNativeAuthStorage();
    assert(globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST) !== null,
      '[4d] localStorage copy was NOT deleted when the write did not verify');
    const notice = authStorageNative.getNativeAuthStorageNotice();
    assert(!!notice && /Couldn.t read your saved sign-in/.test(notice.message),
      `[4e] the read-error notice was surfaced (got ${JSON.stringify(notice)})`);
    clearNativeGlobals();
  }

  // (c) delete-not-verified — refuse to trust EITHER copy
  resetAll();
  {
    const plugin = makeFakeKeychainPlugin();
    const prefs = makeFakePreferences();
    setNativeGlobals({ plugin, prefs });
    const raw = JSON.stringify({ access_token: 'pre-upgrade.jwt', refresh_token: 'r', expires_at: 99999999999 });
    globalThis.localStorage.setItem(authStorageNative._MARKER_KEY_FOR_TEST, raw);
    // sabotage: removeItem() silently fails to remove (simulates a device
    // refusing the delete — DI-247 §2d's exact named failure mode).
    const realRemove = globalThis.localStorage.removeItem.bind(globalThis.localStorage);
    globalThis.localStorage.removeItem = (k) => { if (k !== authStorageNative._MARKER_KEY_FOR_TEST) realRemove(k); };
    await authStorageNative.primeNativeAuthStorage();
    const notice = authStorageNative.getNativeAuthStorageNotice();
    assert(!!notice && notice.tone === 'error', `[4f] delete-not-verified surfaces an error notice (got ${JSON.stringify(notice)})`);
    globalThis.localStorage.removeItem = realRemove;
    clearNativeGlobals();
  }

  // (d) idempotent — a second prime() on an already-migrated device does not re-migrate
  resetAll();
  {
    const plugin = makeFakeKeychainPlugin();
    const prefs = makeFakePreferences();
    setNativeGlobals({ plugin, prefs });
    const raw = JSON.stringify({ access_token: 'pre-upgrade.jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 1000 });
    globalThis.localStorage.setItem(authStorageNative._MARKER_KEY_FOR_TEST, raw);
    await authStorageNative.primeNativeAuthStorage();
    const setCallsAfterFirst = plugin._setCalls();
    authStorageNative._resetAuthStorageNativeForTest(); // simulate a fresh boot's in-memory state, same device storage
    await authStorageNative.primeNativeAuthStorage();
    assert(plugin._setCalls() === setCallsAfterFirst,
      `[4g] a second prime() on an already-migrated device makes NO additional Keychain writes (before=${setCallsAfterFirst}, after=${plugin._setCalls()})`);
    clearNativeGlobals();
  }

  // (e) delete+reinstall hygiene — a FIRST launch (no installed flag) clears
  // stale Keychain items left behind by a previous install of THIS app,
  // BEFORE migration runs.
  resetAll();
  {
    const plugin = makeFakeKeychainPlugin();
    const prefs = makeFakePreferences(); // no installed flag pre-set — a genuine first launch
    setNativeGlobals({ plugin, prefs, firstLaunch: true });
    await plugin.set({ key: 'stale-leftover-item', value: 'from-a-previous-install', protected: true });
    assert(plugin._store.size === 1, '[4h-fixture] a stale item exists before prime() runs');
    await authStorageNative.primeNativeAuthStorage();
    assert(plugin._store.size === 0, `[4h] first-launch hygiene cleared the stale item BEFORE anything else ran (got ${plugin._store.size} left)`);
    assert(prefs._store.get(authStorageNative._INSTALLED_FLAG_KEY_FOR_TEST) === '1',
      '[4i] the installed flag is now set, so a SECOND launch will not re-clear');
    clearNativeGlobals();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] K3 — the four DI-251 §4 outcomes reach getNativeAuthStorageNotice() with the exact copy…');
{
  const cases = [
    { code: 'userCancelled', message: 'Sign-in unlock was cancelled.', tone: 'notice' },
    { code: 'authFailed', message: "Couldn't verify it's you — please sign in again.", tone: 'error' },
    { code: 'passcodeNotSet', message: 'Set a passcode on this iPhone to stay signed in.', tone: 'notice' },
    { code: 'otherError', message: "Couldn't read your saved sign-in. Please sign in again.", tone: 'error' },
  ];
  for (const c of cases) {
    resetAll();
    const plugin = makeFakeKeychainPlugin();
    const prefs = makeFakePreferences();
    setNativeGlobals({ plugin, prefs });
    await plugin.set({ key: authStorageNative._MARKER_KEY_FOR_TEST, value: 'placeholder-to-make-exists-true', protected: true });
    plugin._forceNextError(c.code, c.code);
    const v = await authStorageNative._nativeGetItemForTest(authStorageNative._MARKER_KEY_FOR_TEST);
    assert(v === null, `[5-${c.code}a] get() resolves null (never throws to the caller) for code=${c.code}`);
    const notice = authStorageNative.getNativeAuthStorageNotice();
    assert(!!notice && notice.message === c.message && notice.tone === c.tone,
      `[5-${c.code}b] exact DI-251 §4 copy + tone (got ${JSON.stringify(notice)})`);
    clearNativeGlobals();
  }
  // notFound: no throw, no notice at all — the plugin resolves {value:null}.
  resetAll();
  {
    const plugin = makeFakeKeychainPlugin();
    setNativeGlobals({ plugin, prefs: makeFakePreferences() });
    const v = await authStorageNative._nativeGetItemForTest('missing-key');
    assert(v === null && authStorageNative.getNativeAuthStorageNotice() === null,
      '[5-notFound] absence sets no notice at all — the ordinary signed-out state');
    clearNativeGlobals();
  }
  // passcodeNotSet on WRITE: session works this run (in-memory), never
  // falls back to unprotected storage.
  resetAll();
  {
    const plugin = makeFakeKeychainPlugin({ noPasscode: true });
    setNativeGlobals({ plugin, prefs: makeFakePreferences() });
    await authStorageNative._nativeSetItemForTest(authStorageNative._MARKER_KEY_FOR_TEST, 'session-json');
    assert(!plugin._store.has(authStorageNative._MARKER_KEY_FOR_TEST),
      '[5-passcodeNotSet-write-a] the item was NOT persisted to Keychain (no passcode)');
    const readBack = await authStorageNative._nativeGetItemForTest(authStorageNative._MARKER_KEY_FOR_TEST);
    assert(readBack === 'session-json', '[5-passcodeNotSet-write-b] …but the value is usable THIS run, from the in-memory cache only');
    const notice = authStorageNative.getNativeAuthStorageNotice();
    assert(!!notice && notice.message === 'Set a passcode on this iPhone to stay signed in.',
      `[5-passcodeNotSet-write-c] the visible notice matches DI-251 §1 (got ${JSON.stringify(notice)})`);
    clearNativeGlobals();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] Cache-after-first-read — two reads, one bridge call…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences() });
  await plugin.set({ key: 'cache-key', value: 'v1', protected: true });
  const a = await authStorageNative._nativeGetItemForTest('cache-key');
  const callsAfterFirst = plugin._getCalls();
  const b = await authStorageNative._nativeGetItemForTest('cache-key');
  assert(a === 'v1' && b === 'v1', '[6a] both reads return the correct value');
  assert(plugin._getCalls() === callsAfterFirst,
    `[6b] the SECOND read did not call the plugin's get() again — the JS-side cache answered (before=${callsAfterFirst}, after=${plugin._getCalls()})`);
  clearNativeGlobals();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] Spoof proof — window.__cfbpNativeAuthStorage + a stub Capacitor on an https: origin…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences(), protocol: 'https:' }); // shell-shaped, but the WRONG origin
  globalThis.window.__cfbpNativeAuthStorage = { getItem: async () => 'spoofed', setItem: async () => {}, removeItem: async () => {} };
  assert(platform.isNativeOrigin() === false, '[7a] fixture: isNativeOrigin() is false on a spoofed-but-https origin (isNativeShell() alone is NOT origin-positive)');
  await authStorageNative.primeNativeAuthStorage();
  assert(authStorageNative.getNativeAuthStorageNotice() === null,
    '[7b] primeNativeAuthStorage() is STILL a no-op — a spoofed Capacitor global on https: cannot trigger any native behavior');
  clearNativeGlobals();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] DI-248 K1 — the Supabase thread\'s own requested spoof proof, against the REAL js/auth.js createClient() options…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences(), protocol: 'https:' }); // spoofed-but-https
  globalThis.window.__cfbpNativeAuthStorage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  let capturedOptions = null;
  globalThis.window.supabase = {
    createClient: (_url, _key, options) => {
      capturedOptions = options;
      return { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
    },
  };
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authModeKnown: true });
  const client = auth.getSupabaseClient();
  assert(!!client, '[8a] fixture: a client was created');
  assert(!!capturedOptions, '[8b] fixture: createClient() was called with an options object');
  assert(capturedOptions && capturedOptions.auth && capturedOptions.auth.storage === undefined,
    `[8c] storage:undefined even with window.__cfbpNativeAuthStorage SET and a stub Capacitor present, on an https: origin (got ${JSON.stringify(capturedOptions && capturedOptions.auth && capturedOptions.auth.storage)})`);
  delete globalThis.window.supabase;
  clearNativeGlobals();
}
// A second half of [8]: the POSITIVE case — a genuine capacitor: origin DOES
// install the storage option, so [8c]'s undefined isn't vacuously true for
// every origin.
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences(), protocol: 'capacitor:' });
  globalThis.window.__cfbpNativeAuthStorage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  let capturedOptions = null;
  globalThis.window.supabase = {
    createClient: (_url, _key, options) => {
      capturedOptions = options;
      return { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
    },
  };
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authModeKnown: true });
  auth.getSupabaseClient();
  assert(!!capturedOptions && capturedOptions.auth.storage === globalThis.window.__cfbpNativeAuthStorage,
    `[8d] on a GENUINE capacitor: origin with the global set, storage IS the native adapter (got ${JSON.stringify(!!capturedOptions && !!capturedOptions.auth.storage)})`);
  delete globalThis.window.supabase;
  clearNativeGlobals();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] Grep guards — no @capacitor import; never statically imported; not in STATIC_ASSETS…');
{
  const selfSrc = await readFile(path.join(__dirname, 'js', 'auth-storage-native.js'), 'utf8');
  // A real import/require of the npm package, not a comment mentioning the
  // plugin name (this file's own header prose says "@capacitor/preferences"
  // to explain WHY the native dependency exists — that is not an import).
  assert(!/from\s*['"]@capacitor|require\(\s*['"]@capacitor/.test(selfSrc),
    '[9a] js/auth-storage-native.js never imports @capacitor/* — runtime global only');

  const jsFiles = ['app.js', 'auth.js', 'auth-native.js', 'platform.js', 'storage.js', 'backend.js', 'chatTransport.js', 'chat.js', 'brand.js'];
  let staticImportHits = 0;
  for (const f of jsFiles) {
    let src;
    try { src = await readFile(path.join(__dirname, 'js', f), 'utf8'); } catch { continue; }
    // A STATIC import is a top-level `import ... from './auth-storage-native.js'`.
    // A dynamic `import('./auth-storage-native.js')` string literal is fine —
    // that's exactly js/app.js's DI-249 boot hook — and is checked SEPARATELY,
    // positively, in [11].
    const staticRe = /^\s*import\b[^;]*from\s*['"]\.\/auth-storage-native\.js['"]/m;
    if (staticRe.test(src)) staticImportHits++;
  }
  assert(staticImportHits === 0, `[9b] zero STATIC imports of ./auth-storage-native.js anywhere in cfb-pickems/js (found ${staticImportHits})`);

  let swSrc = '';
  try { swSrc = await readFile(path.join(__dirname, 'service-worker.js'), 'utf8'); } catch { /* fixture-optional */ }
  assert(!/auth-storage-native\.js/.test(swSrc), '[9c] auth-storage-native.js is not named anywhere in service-worker.js (no STATIC_ASSETS entry)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] K2 — the reader set for AUTH_STORAGE_KEY/cfbp_supabase_session is exactly js/auth.js + this file…');
{
  const jsDir = path.join(__dirname, 'js');
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(jsDir);
  const readers = [];
  for (const name of entries) {
    if (!name.endsWith('.js')) continue;
    const src = await readFile(path.join(jsDir, name), 'utf8');
    if (/AUTH_STORAGE_KEY|cfbp_supabase_session/.test(src)) readers.push(name);
  }
  // storage.js's own DEVICE_LOCAL_KEYS comment block DOCUMENTS this key by
  // name (DI-247 §2f: "exempted from the sync seam, not governed by it") —
  // a mention, not a read. app.js's RG-199 comment (2026-09-21, predates and
  // is independent of this reapply) names the literal key in a postmortem
  // note about what a laptop dump showed missing — also a mention, not a
  // read: `localStorage.getItem(AUTH_STORAGE_KEY)` lives in js/auth.js alone.
  // Everything else must be exactly the two real readers.
  const unexpected = readers.filter(n => n !== 'auth.js' && n !== 'auth-storage-native.js' && n !== 'storage.js' && n !== 'app.js');
  assert(unexpected.length === 0,
    `[10a] no reader of the session key outside js/auth.js, js/auth-storage-native.js, and storage.js's/app.js's documented mentions (found extra: ${JSON.stringify(unexpected)})`);
  assert(readers.includes('auth.js') && readers.includes('auth-storage-native.js'),
    `[10b] fixture: both expected readers were actually found (got ${JSON.stringify(readers)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] DI-249 boot-hook ordering + no-crash proof…');
{
  const appSrc = await readFile(path.join(__dirname, 'js', 'app.js'), 'utf8');
  // S3 (round 2) moved this call inside a Promise.race([...]) array, so it
  // is no longer directly preceded by `await` — find the call itself.
  const primeIdx = appSrc.indexOf("nativeAuthStorage.primeNativeAuthStorage()");
  const configureIdx = appSrc.indexOf('configureAuth({ ...deployed, authMode });');
  const sdkLoadIdx = appSrc.indexOf('const sdkReady = await ensureSupabaseSdkLoaded();');
  // The boot GATE's own first real read (not any earlier textual mention of
  // the identifier elsewhere in this 20,000-line file, e.g. in an import
  // list or an unrelated function above applyAuthModeDecision()).
  const firstHasValidCallIdx = appSrc.indexOf('if (!sdkReady && !hasValidSupabaseSession())');
  assert(primeIdx > -1, '[11a] fixture: the boot hook call site exists in js/app.js');
  assert(configureIdx > -1 && configureIdx < primeIdx,
    '[11b] configureAuth() runs BEFORE the prime call (DI-249\'s exact ordering)');
  assert(sdkLoadIdx > -1 && primeIdx < sdkLoadIdx,
    '[11c] the prime call runs BEFORE ensureSupabaseSdkLoaded()');
  assert(firstHasValidCallIdx > -1 && primeIdx < firstHasValidCallIdx,
    `[11d] the prime call runs BEFORE this function's first hasValidSupabaseSession() read (primeIdx=${primeIdx}, firstHasValidCallIdx=${firstHasValidCallIdx})`);
  assert(/if \(isNativeOrigin\(\)\) \{/.test(appSrc.slice(configureIdx, primeIdx + 40)),
    '[11e] the whole block is gated on isNativeOrigin() (origin-positive), not isNativeShell() alone');
  const tryIdx = appSrc.lastIndexOf('try {', primeIdx);
  const catchIdx = appSrc.indexOf('} catch (e) {', primeIdx);
  assert(tryIdx > -1 && tryIdx < primeIdx && catchIdx > primeIdx,
    '[11f] the call is wrapped in try/catch — a stubbed throw cannot crash boot()');

  // A live, stubbed-throw proof against the actual exported function shape
  // (not a re-derivation of app.js's private branch — this drives the SAME
  // primeNativeAuthStorage() export app.js's dynamic import resolves to, and
  // confirms IT never throws even when its own internals are forced to).
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  const prefs = makeFakePreferences();
  setNativeGlobals({ plugin, prefs });
  plugin.exists = async () => { throw new Error('simulated total plugin failure'); };
  plugin.get = async () => { throw new Error('simulated total plugin failure'); };
  let threw = false;
  try { await authStorageNative.primeNativeAuthStorage(); } catch { threw = true; }
  assert(threw === false, '[11g] primeNativeAuthStorage() itself never throws, even when every internal call fails');
  clearNativeGlobals();
}

resetAll();

// ── Result (before mutation section, so a mutation-phase crash still leaves
//    a clean summary for the earlier, real assertions) ─────────────────────
// NOTE: deliberately NOT formatted as "✅ ALL PASS — N passed, M failed" —
// loadtest.mjs's own spawn-and-parse block for this file greps for exactly
// that string with `String.prototype.match()` (first match wins, no /g),
// so an earlier checkpoint line using the identical shape would make it
// read THIS intermediate count as the suite's final one.
const preMutationPass = pass, preMutationFail = fail;
console.log(`\n(pre-mutation checkpoint) passed=${preMutationPass} failed=${preMutationFail}`);

// ═════════════════════════════════════════════════════════════════════════
// [12] MUTATION PROOFS (DI-250) — SCRATCH COPIES ONLY, restored, re-verified.
// Per CLAUDE.md: never git checkout/restore/stash to undo a mutation. This
// section never touches the tracked file — it copies js/auth-storage-native.js
// and js/auth.js into a scratch tmpdir, mutates the COPY, spawns a tiny child
// against the COPY, asserts RED, then deletes the scratch dir. The tracked
// files in the working tree are never written by this section.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[12] Mutation proofs — scratch copies only, never the tracked files…');
{
  // Scratch copies live in `scratchDir` (an OS tmpdir), NOT inside js/ itself
  // — the reviewer's latent-trap note, 2026-09-23: a copy that briefly sat as
  // a real sibling of the tracked modules could be seen mid-write by any
  // OTHER process scanning js/ (a concurrently-run loadtest.mjs among them).
  // bundletest.mjs's own RED-proof precedent (js/__redproof_planted.js) DOES
  // still plant inside js/ — that file has no relative imports of its own to
  // preserve, so it doesn't share this hazard the same way. These copies'
  // relative imports (`./platform.js`, `./auth.js`, `./backend.js`, …) are
  // rewritten to absolute `file://` URLs pointing back at the real js/
  // directory (rewriteRelativeImportsForScratch(), top of file) at write
  // time below, so they resolve against the REAL, unmutated siblings without
  // having to hand-copy the whole dependency graph OR live inside it.
  // Deleted in the `finally` below no matter what happens above.
  const srcNative = path.join(__dirname, 'js', 'auth-storage-native.js');
  const scratchNative = path.join(scratchDir, '__mutation_scratch_auth_storage_native.js');
  const srcAuth = path.join(__dirname, 'js', 'auth.js');
  const scratchAuth = path.join(scratchDir, '__mutation_scratch_auth.js');
  try {
    await writeFile(scratchNative, rewriteRelativeImportsForScratch(await readFile(srcNative, 'utf8')), 'utf8');

    // (a) prime not awaited -> RED. Simulated by calling the exported
    // function and NOT awaiting it, then immediately checking a
    // post-condition that only holds after it resolves — proves the ORDER
    // matters, i.e. that a caller who forgets `await` gets a wrong answer.
    {
      resetAll();
      const plugin = makeFakeKeychainPlugin();
      setNativeGlobals({ plugin, prefs: makeFakePreferences() });
      const realSession = { access_token: 'jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 };
      await plugin.set({ key: authStorageNative._MARKER_KEY_FOR_TEST, value: JSON.stringify(realSession), protected: true });
      authStorageNative.primeNativeAuthStorage(); // DELIBERATELY not awaited
      const markerImmediatelyAfter = globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST);
      assert(markerImmediatelyAfter === null,
        '[12a] RED-proof: calling primeNativeAuthStorage() WITHOUT awaiting it leaves the marker unset synchronously afterward — proving DI-249\'s `await` is load-bearing, not decorative');
      await new Promise(r => setTimeout(r, 20)); // let the un-awaited call actually finish before the next fixture
      clearNativeGlobals();
    }

    // (b) migration deleting before verify -> RED. Mutate the SCRATCH copy to
    // move the localStorage delete to BEFORE the Keychain write (instead of
    // after the write+verify), then make the "Keychain" write hard-fail, and
    // prove the mutated code LOSES the session from BOTH stores — the exact
    // defect the real, unmutated code (delete only AFTER a verified write)
    // refuses to allow.
    {
      let src = await readFile(scratchNative, 'utf8');
      const before = src;
      const deleteLine = "    try { localStorage.removeItem(MARKER_KEY); } catch { /* fall through to verify, which will fail loudly */ }\n";
      assert(src.includes(deleteLine), '[12b-precondition] the exact delete line text was found in the source (a drifted string would make the mutation below silently no-op)');
      // Remove it from its real position (after the write+verify)…
      src = src.replace(deleteLine, '');
      // …and re-insert it BEFORE the write, so the mutated ORDER is
      // delete-then-write instead of write-verify-then-delete.
      src = src.replace('    await nativeSetItem(MARKER_KEY, raw);\n', deleteLine + '    await nativeSetItem(MARKER_KEY, raw);\n');
      assert(src !== before, '[12b-fixture] the mutation actually changed the scratch file (a no-op replace would make this RED-proof vacuous)');
      await writeFile(scratchNative, src, 'utf8');

      const child = [
        "globalThis.localStorage = (() => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size}, key:i=>[...m.keys()][i]??null }; })();",
        "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };",
        "globalThis.location = { protocol: 'capacitor:' };",
        // The "Keychain" write HARD-FAILS every time — simulates a write that
        // never actually lands, the exact case verify-before-delete exists
        // to protect against.
        "globalThis.window.Capacitor.Plugins.KeychainAuthStorage = {",
        "  async set(){ throw Object.assign(new Error('simulated write failure'), { code: 'otherError' }); },",
        "  async get(){ return { value: null }; }, async remove(){}, async clear(){}, async exists(){ return {exists:false}; },",
        "};",
        "globalThis.window.Capacitor.Plugins.Preferences = { async get(){return {value:null};}, async set(){}, async remove(){} };",
        "const mod = await import(process.env.MOD_URL);",
        "const raw = JSON.stringify({ access_token: 'real.jwt', refresh_token: 'r', expires_at: 99999999999 });",
        "globalThis.localStorage.setItem(mod._MARKER_KEY_FOR_TEST, raw);",
        "await mod.primeNativeAuthStorage();",
        "const sessionSurvivedSomewhere = globalThis.localStorage.getItem(mod._MARKER_KEY_FOR_TEST) === raw;",
        "console.log('MUTATION12B sessionSurvivedSomewhere=' + sessionSurvivedSomewhere);",
      ].join('\n');
      const scratchModUrl = new URL(`file://${scratchNative}`).href;
      const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 15000, env: { ...process.env, MOD_URL: scratchModUrl },
      });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      const m = /MUTATION12B sessionSurvivedSomewhere=(\w+)/.exec(out);
      assert(!!m && m[1] === 'false',
        `[12c] RED-proof: with the delete moved BEFORE the write, a hard write failure now LOSES the session from both localStorage and Keychain — the real, unmutated code (delete only after) always keeps the localStorage copy when the write fails (got ${m ? m[1] : 'no output'}${m ? '' : '\n' + out.slice(-500)})`);

      // …and the POSITIVE control, running the IDENTICAL child script
      // against the REAL (unmutated) module: the session survives in
      // localStorage, because the write's own exception is caught before
      // the delete line is ever reached.
      const realModUrl = new URL(`file://${srcNative}`).href;
      const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 15000, env: { ...process.env, MOD_URL: realModUrl },
      });
      const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
      const mReal = /MUTATION12B sessionSurvivedSomewhere=(\w+)/.exec(outReal);
      assert(!!mReal && mReal[1] === 'true',
        `[12c-control] fixture: the REAL, unmutated module keeps the session on the SAME write-failure fixture (got ${mReal ? mReal[1] : 'no output'}${mReal ? '' : '\n' + outReal.slice(-500)})`);
    }

    // (c) fallback-to-localStorage on otherError -> RED. Mutate the scratch
    // copy's nativeGetItem() to return the RAW localStorage value instead of
    // null on a genuine read error, and prove that produces a TRUSTED,
    // non-null session out of a codepath that should have failed closed.
    {
      let src = await readFile(srcNative, 'utf8'); // fresh, unmutated copy of THIS mutation
      const before = src;
      src = src.replace(
        "    else _setNotice(\"Couldn't read your saved sign-in. Please sign in again.\", 'error'); // K3's exact copy\n    console.error('[auth-storage-native] Keychain read failed', code, err);\n    return null; // NEVER falls back to localStorage — absence to the caller.",
        "    else _setNotice(\"Couldn't read your saved sign-in. Please sign in again.\", 'error'); // K3's exact copy\n    console.error('[auth-storage-native] Keychain read failed', code, err);\n    try { return localStorage.getItem(key); } catch { return null; } // MUTATION: the exact fallback CLAUDE.md forbids"
      );
      assert(src !== before, '[12d-fixture] the fallback mutation actually changed the source (a no-op replace would make this RED-proof vacuous)');
      await writeFile(scratchNative, rewriteRelativeImportsForScratch(src), 'utf8');

      const child = [
        "globalThis.localStorage = (() => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size}, key:i=>[...m.keys()][i]??null }; })();",
        "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };",
        "globalThis.location = { protocol: 'capacitor:' };",
        "globalThis.window.Capacitor.Plugins.KeychainAuthStorage = {",
        "  async set(){}, async get(){ const e = new Error('boom'); e.code = 'otherError'; throw e; },",
        "  async remove(){}, async clear(){}, async exists(){ return {exists:true}; },",
        "};",
        "globalThis.window.Capacitor.Plugins.Preferences = { async get(){return {value:null};}, async set(){}, async remove(){} };",
        "const mod = await import(process.env.SCRATCH_MOD_URL);",
        "globalThis.localStorage.setItem('some-key', 'DANGEROUS-STALE-LOCALSTORAGE-VALUE');",
        "const v = await mod._nativeGetItemForTest('some-key');",
        "console.log('MUTATION12D value=' + JSON.stringify(v));",
      ].join('\n');
      const scratchModUrl = new URL(`file://${scratchNative}`).href;
      const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 15000, env: { ...process.env, SCRATCH_MOD_URL: scratchModUrl },
      });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      const m = /MUTATION12D value=(.*)/.exec(out);
      assert(!!m && m[1] === '"DANGEROUS-STALE-LOCALSTORAGE-VALUE"',
        `[12e] RED-proof: with the fallback mutation in place, a Keychain read error now returns the stale localStorage value instead of null — the real code always returns null here (got ${m ? m[1] : 'no output'}${m ? '' : '\n' + out.slice(-500)})`);
    }

    // (d) origin check removed from js/auth.js's DI-248 line -> RED. Mutate
    // a SCRATCH COPY of js/auth.js (never the tracked file) to drop the
    // `isNativeOrigin()` call (AD-68, 2026-09-23: the shared predicate,
    // replacing the old inline `location.protocol === 'capacitor:'` this
    // proof used to target), and prove a spoofed global on an https: origin
    // NOW installs the native storage adapter — exactly what K1 exists to
    // prevent.
    {
      let authSrc = await readFile(srcAuth, 'utf8');
      const before = authSrc;
      // Removes ONLY the origin check, leaving S1's shape checks intact —
      // this proof is specifically about K1 (origin-positive), not S1
      // (shape); [17a]/[17b] below cover the shape check's own removal.
      authSrc = authSrc.replace(
        "storage: (isNativeOrigin() && window.__cfbpNativeAuthStorage",
        "storage: (window.__cfbpNativeAuthStorage /* MUTATION: K1's origin check (isNativeOrigin()) removed */"
      );
      assert(authSrc !== before, '[12f-fixture] the K1 mutation actually changed the scratch auth.js (a no-op replace would make this RED-proof vacuous)');
      await writeFile(scratchAuth, rewriteRelativeImportsForScratch(authSrc), 'utf8');

      const child = [
        "globalThis.localStorage = (() => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size}, key:i=>[...m.keys()][i]??null }; })();",
        "globalThis.document = { addEventListener(){}, removeEventListener(){}, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>({set innerHTML(v){},get innerHTML(){return '';},appendChild(){},remove(){},addEventListener(){},removeEventListener(){},classList:{add(){},remove(){}},style:{},id:'',className:''}), body:{classList:{add(){},remove(){}},appendChild(){},innerHTML:''}, hidden:false };",
        "globalThis.window = globalThis;",
        "globalThis.location = { protocol: 'https:' };", // spoofed-but-https, K1's exact scenario
        "globalThis.window.__cfbpNativeAuthStorage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };",
        "let capturedOptions = null;",
        "globalThis.window.supabase = { createClient: (u,k,options) => { capturedOptions = options; return { auth: { onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) } }; } };",
        "const mod = await import(process.env.SCRATCH_AUTH_URL);",
        "mod.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authModeKnown: true });",
        "mod.getSupabaseClient();",
        "console.log('MUTATION12F storageIsSet=' + (capturedOptions && capturedOptions.auth.storage !== undefined));",
      ].join('\n');
      const scratchAuthUrl = new URL(`file://${scratchAuth}`).href;
      const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 15000, env: { ...process.env, SCRATCH_AUTH_URL: scratchAuthUrl },
      });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      const m = /MUTATION12F storageIsSet=(\w+)/.exec(out);
      assert(!!m && m[1] === 'true',
        `[12g] RED-proof: with K1's origin check removed, a spoofed global on an https: origin NOW installs the native storage adapter — the real, unmutated line never does (got ${m ? m[1] : 'no output'}${m ? '' : '\n' + out.slice(-500)})`);
    }
  } finally {
    // Restore: the TRACKED files (js/auth-storage-native.js, js/auth.js)
    // were never written by this section — only the two throwaway
    // __mutation_scratch_*.js siblings were, and they are deleted here,
    // every time, success or failure. Per CLAUDE.md's protocol, [13] below
    // then re-runs a real fixture against the tracked files to prove the
    // working tree is still green — a failed cleanup would leave a stray
    // file behind, which is exactly what [13]/boundarytest-style hygiene
    // would catch, not a silent pass.
    await rm(scratchNative, { force: true });
    await rm(scratchAuth, { force: true });
  }
}

// ── Re-verify the tracked files are untouched and still green ─────────────
console.log('\n[13] Post-mutation re-verification — the TRACKED files are unmodified and green…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences() });
  const realSession = { access_token: 'real.jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  await plugin.set({ key: authStorageNative._MARKER_KEY_FOR_TEST, value: JSON.stringify(realSession), protected: true });
  await authStorageNative.primeNativeAuthStorage();
  assert(auth.hasValidSupabaseSession() === true, '[13a] the tracked, unmutated module still primes correctly after the mutation section');
  clearNativeGlobals();
  resetAll();
}

// ═════════════════════════════════════════════════════════════════════════
// ROUND 2 — reviewer APPROVE WITH NOTES / security-reviewer PASS WITH
// CONDITIONS. S1 (adapter hardening), S2 (bypassCache proves a REAL read),
// S3 (bounded prime). See js/auth-storage-native.js, js/auth.js, js/app.js
// follow-up commits.
// ═════════════════════════════════════════════════════════════════════════

console.log('\n[14] S1 — adapter hardening: frozen, non-writable/non-configurable, fail-closed on a pre-planted value…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences() });
  await authStorageNative.primeNativeAuthStorage();
  const adapter = globalThis.window.__cfbpNativeAuthStorage;
  assert(!!adapter, '[14a] fixture: the adapter was installed on a clean native origin');
  assert(Object.isFrozen(adapter), '[14b] the installed adapter object is frozen');
  const desc = Object.getOwnPropertyDescriptor(globalThis.window, '__cfbpNativeAuthStorage');
  assert(!!desc && desc.writable === false && desc.configurable === false && desc.enumerable === false,
    `[14c] the property is non-writable, non-configurable, non-enumerable (got ${JSON.stringify(desc && { writable: desc.writable, configurable: desc.configurable, enumerable: desc.enumerable })})`);

  // Fail-closed: something else already occupies the property name.
  resetAll();
  const plugin2 = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin: plugin2, prefs: makeFakePreferences() });
  const plantedFakeAdapter = { getItem: async () => 'not-really-ours', setItem: async () => {}, removeItem: async () => {} };
  authStorageNative._plantAdapterPropertyForTest(plantedFakeAdapter);
  await authStorageNative.primeNativeAuthStorage();
  assert(globalThis.window.__cfbpNativeAuthStorage === plantedFakeAdapter,
    '[14d] a pre-planted value is NEVER overwritten by our own install');
  const notice14 = authStorageNative.getNativeAuthStorageNotice();
  assert(!!notice14 && notice14.message === "Couldn't read your saved sign-in. Please sign in again." && notice14.tone === 'error',
    `[14e] fails closed with K3's otherError copy when the property is already occupied by something not ours (got ${JSON.stringify(notice14)})`);
  clearNativeGlobals();
}

console.log('\n[14] S1 (continued) — the auth.js line requires a REAL shape, not mere truthiness…');
{
  resetAll();
  // wrong-shape: missing removeItem.
  setNativeGlobals({ plugin: makeFakeKeychainPlugin(), prefs: makeFakePreferences() });
  globalThis.window.__cfbpNativeAuthStorage = { getItem: async () => null, setItem: async () => {} }; // no removeItem
  let capturedOptions = null;
  globalThis.window.supabase = { createClient: (u, k, options) => { capturedOptions = options; return { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }; } };
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authModeKnown: true });
  auth.getSupabaseClient();
  assert(!!capturedOptions && capturedOptions.auth.storage === undefined,
    `[14f] a wrong-shape object (missing removeItem) on a genuine capacitor: origin still yields storage:undefined (got ${JSON.stringify(!!capturedOptions && capturedOptions.auth.storage)})`);
  delete globalThis.window.supabase;
  clearNativeGlobals();

  // correct shape, genuine origin -> DOES install (still true after the shape check was added).
  resetAll();
  setNativeGlobals({ plugin: makeFakeKeychainPlugin(), prefs: makeFakePreferences() });
  const shapeOkAdapter = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  globalThis.window.__cfbpNativeAuthStorage = shapeOkAdapter;
  let capturedOptions2 = null;
  globalThis.window.supabase = { createClient: (u, k, options) => { capturedOptions2 = options; return { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }; } };
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authModeKnown: true });
  auth.getSupabaseClient();
  assert(!!capturedOptions2 && capturedOptions2.auth.storage === shapeOkAdapter,
    '[14g] a correctly-shaped object on a genuine capacitor: origin IS used (the shape check does not over-reject)');
  delete globalThis.window.supabase;
  clearNativeGlobals();
}

console.log('\n[15] S2 — migration read-back proves a REAL read, not a cache that could be lying…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  const prefs = makeFakePreferences();
  setNativeGlobals({ plugin, prefs });
  const raw = JSON.stringify({ access_token: 'pre-upgrade.jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 1000 });
  globalThis.localStorage.setItem(authStorageNative._MARKER_KEY_FOR_TEST, raw);
  // The non-bypass read would report a STALE value that does NOT match what
  // was written — proving migration's own verification step must be
  // ignoring this and reading for real, or [4a]'s happy-path would break.
  plugin._setStaleCacheOverride('STALE-VALUE-DOES-NOT-MATCH');
  await authStorageNative.primeNativeAuthStorage();
  assert(plugin._bypassGetCalls() >= 1, `[15a] the migration read-back called get() with bypassCache:true at least once (got ${plugin._bypassGetCalls()})`);
  assert(plugin._store.has(authStorageNative._MARKER_KEY_FOR_TEST), '[15b] migration still succeeded (the stale non-bypass value never fooled the real, bypass-read verification)');
  assert(globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST) !== raw, '[15c] the localStorage copy was replaced by the marker (migration completed, not blocked by the irrelevant stale cache)');
  clearNativeGlobals();
}

console.log('\n[16] S3 — bounded prime: source-level pattern check + a live race proof against a REAL hung plugin…');
{
  const appSrc = await readFile(path.join(__dirname, 'js', 'app.js'), 'utf8');
  assert(/Promise\.race\(\[/.test(appSrc), '[16a] js/app.js wraps the prime call in Promise.race([...])');
  assert(/NATIVE_AUTH_STORAGE_PRIME_TIMEOUT_MS/.test(appSrc), '[16b] a named, bounded timeout constant exists');
  assert(/_nativeAuthStoragePrimeTimedOut = true/.test(appSrc), '[16c] a timeout sets a flag rather than silently continuing');
  // Reconciled against RG-194 (2026-09-23 reapply): the flag check and exact
  // copy now live in ONE shared helper (getNativeAuthStorageNoticeForGate())
  // rather than inline at a single call site, because RG-194 gave this
  // decision TWO paint paths (the immediate call and the deadline's own) and
  // duplicating the check at both would be the exact kind of drift a shared
  // chokepoint exists to prevent. Checked in two parts: the helper forces
  // K3's exact copy when the flag is set, AND both paint paths call the
  // helper rather than reimplementing the check themselves.
  assert(/if \(_nativeAuthStoragePrimeTimedOut\) \{\s*\n\s*return \{ message: "Couldn't read your saved sign-in\. Please sign in again\."/.test(appSrc),
    '[16d] the shared notice helper forces K3\'s exact otherError copy when the timeout flag is set');
  const gateCallSites = (appSrc.match(/showGoogleSignInGate\(getNativeAuthStorageNoticeForGate\(\)\)/g) || []).length;
  assert(gateCallSites === 2,
    `[16d-ii] both RG-194 paint paths (the immediate call and fireSignInGateDeadline()) route through that ONE helper (got ${gateCallSites} call sites)`);
  // revealApp()/SplashScreen.hide() ordering is UNCHANGED (Option B — see
  // the commit message for why): confirm boot()'s CALL to revealApp() still
  // runs BEFORE boot()'s CALL to applyAuthModeDecision() (whose BODY is
  // where the prime block lives) — this is a statement about EXECUTION
  // order at the two call sites, not source-text order (the function
  // DEFINITION containing the prime block is textually earlier in the file
  // than boot()'s call sites, which is unrelated to when it actually runs).
  const revealCallIdx = appSrc.indexOf('revealApp();');
  const applyCallIdx = appSrc.indexOf('const decision = await applyAuthModeDecision();');
  assert(revealCallIdx > -1 && applyCallIdx > -1 && revealCallIdx < applyCallIdx,
    `[16e] boot()'s revealApp() call still runs BEFORE its applyAuthModeDecision() call (Option B: paint-first timing is unchanged for every mode) (revealCallIdx=${revealCallIdx}, applyCallIdx=${applyCallIdx})`);

  // Live proof of the MECHANISM app.js's source (above) is built on: race
  // the REAL primeNativeAuthStorage() against a plugin whose get()/exists()
  // never resolve, and confirm the race settles within a short bound
  // instead of hanging forever. (Driving js/app.js's own boot() end-to-end
  // needs authtest.mjs/boottest.mjs's much larger DOM harness — out of this
  // file's scope, stated plainly rather than faked.)
  resetAll();
  const hungPlugin = {
    async set() {}, async get() { return new Promise(() => {}); }, async remove() {}, async clear() {},
    async exists() { return new Promise(() => {}); },
  };
  setNativeGlobals({ plugin: hungPlugin, prefs: makeFakePreferences() });
  const SHORT_BOUND_MS = 80;
  const t0 = Date.now();
  let timedOut16 = false;
  await Promise.race([
    authStorageNative.primeNativeAuthStorage(),
    new Promise(resolve => setTimeout(() => { timedOut16 = true; resolve(); }, SHORT_BOUND_MS)),
  ]);
  const elapsed16 = Date.now() - t0;
  assert(timedOut16 === true, '[16f] the race timed out rather than waiting for the hung plugin forever');
  assert(elapsed16 < SHORT_BOUND_MS + 300, `[16g] the race settled close to its bound, not later (got ${elapsed16}ms, bound ${SHORT_BOUND_MS}ms)`);
  clearNativeGlobals();
}

console.log('\n[17] Round-2 mutation proofs (S1/S2/S3) — scratch copies only, never the tracked files…');
{
  // Scratch copies live in `scratchDir` (an OS tmpdir, not js/ — the
  // reviewer's latent-trap note, 2026-09-23), same reasoning as section [12]
  // above: relative imports are rewritten to absolute file:// URLs at write
  // time via rewriteRelativeImportsForScratch().
  const scratchNative2 = path.join(scratchDir, '__mutation_scratch_auth_storage_native.js');
  const scratchAuth2 = path.join(scratchDir, '__mutation_scratch_auth.js');
  try {
    // (S1) shape check removed from the auth.js line -> RED: a wrong-shape
    // object now activates the storage option.
    {
      const srcAuth2 = path.join(__dirname, 'js', 'auth.js');
      let authSrc2 = await readFile(srcAuth2, 'utf8');
      const before = authSrc2;
      authSrc2 = authSrc2.replace(
        "storage: (isNativeOrigin() && window.__cfbpNativeAuthStorage && typeof window.__cfbpNativeAuthStorage.getItem === 'function' && typeof window.__cfbpNativeAuthStorage.setItem === 'function' && typeof window.__cfbpNativeAuthStorage.removeItem === 'function' && window.__cfbpNativeAuthStorage) || undefined,",
        "storage: (isNativeOrigin() && window.__cfbpNativeAuthStorage) || undefined, // MUTATION: S1 shape check removed"
      );
      assert(authSrc2 !== before, '[17a-fixture] the S1 mutation actually changed the scratch auth.js');
      await writeFile(scratchAuth2, rewriteRelativeImportsForScratch(authSrc2), 'utf8');
      const child = [
        "globalThis.localStorage = (() => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size}, key:i=>[...m.keys()][i]??null }; })();",
        "globalThis.document = { addEventListener(){}, removeEventListener(){}, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>({set innerHTML(v){},get innerHTML(){return '';},appendChild(){},remove(){},addEventListener(){},removeEventListener(){},classList:{add(){},remove(){}},style:{},id:'',className:''}), body:{classList:{add(){},remove(){}},appendChild(){},innerHTML:''}, hidden:false };",
        "globalThis.window = globalThis;",
        "globalThis.location = { protocol: 'capacitor:' };",
        // AD-68 (2026-09-23): the line now calls isNativeOrigin(), which is
        // isNativeShell() && capacitor: — a stub Capacitor is required for
        // this proof to reach the shape check at all (isNativeShell() reads
        // window.Capacitor.isNativePlatform()).
        "globalThis.window.Capacitor = { isNativePlatform: () => true };",
        "globalThis.window.__cfbpNativeAuthStorage = { getItem: async () => null, setItem: async () => {} };", // wrong shape: no removeItem
        "let capturedOptions = null;",
        "globalThis.window.supabase = { createClient: (u,k,options) => { capturedOptions = options; return { auth: { onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) } }; } };",
        "const mod = await import(process.env.MOD_URL);",
        "mod.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key', authModeKnown: true });",
        "mod.getSupabaseClient();",
        "console.log('MUTATION17A storageIsSet=' + (capturedOptions && capturedOptions.auth.storage !== undefined));",
      ].join('\n');
      const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], { encoding: 'utf8', timeout: 15000, env: { ...process.env, MOD_URL: new URL(`file://${scratchAuth2}`).href } });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      const m = /MUTATION17A storageIsSet=(\w+)/.exec(out);
      assert(!!m && m[1] === 'true',
        `[17b] RED-proof: with S1's shape check removed, a wrong-shape (missing removeItem) object now activates the storage option — the real, unmutated line never does (got ${m ? m[1] : 'no output'}${m ? '' : '\n' + out.slice(-500)})`);
    }

    // (S2) bypassCache:true removed from the migration read-back -> RED,
    // combined with a lying non-bypass cache.
    {
      let src = await readFile(path.join(__dirname, 'js', 'auth-storage-native.js'), 'utf8');
      const before = src;
      src = src.replace(
        "const readBack = await plugin.get({ key: MARKER_KEY, bypassCache: true }).catch(() => null);",
        "const readBack = await plugin.get({ key: MARKER_KEY }).catch(() => null); // MUTATION: S2 bypassCache removed"
      );
      assert(src !== before, '[17c-fixture] the S2 mutation actually changed the scratch file');
      await writeFile(scratchNative2, rewriteRelativeImportsForScratch(src), 'utf8');
      const child = [
        "globalThis.localStorage = (() => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size}, key:i=>[...m.keys()][i]??null }; })();",
        "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };",
        "globalThis.location = { protocol: 'capacitor:' };",
        // set() reports success but never actually persists anything (a
        // real-world stand-in: the write silently failed to round-trip) --
        // exists() honestly reflects that nothing is really there, so
        // migration does NOT take the "already have it" shortcut and
        // actually exercises the write+read-back path this test targets.
        "globalThis.window.Capacitor.Plugins.KeychainAuthStorage = {",
        "  async set(){ /* silently does not persist */ },",
        // The non-bypass read LIES (claims the exact expected value); the
        // bypass read honestly reports nothing is there.
        "  async get({bypassCache}) { return { value: bypassCache ? null : globalThis.__LIE_VALUE__ }; },",
        "  async remove(){}, async clear(){}, async exists(){ return {exists:false}; },",
        "};",
        "const prefsStore = new Map();",
        "globalThis.window.Capacitor.Plugins.Preferences = {",
        "  async get({key}){ return { value: prefsStore.has(key) ? prefsStore.get(key) : null }; },",
        "  async set({key,value}){ prefsStore.set(key, String(value)); },",
        "  async remove({key}){ prefsStore.delete(key); },",
        "};",
        "const mod = await import(process.env.MOD_URL);",
        "const raw = JSON.stringify({ access_token: 'real.jwt', refresh_token: 'r', expires_at: 99999999999 });",
        "globalThis.__LIE_VALUE__ = raw;", // the lying cache claims exactly the value that SHOULD be there
        "globalThis.localStorage.setItem(mod._MARKER_KEY_FOR_TEST, raw);",
        "await mod.primeNativeAuthStorage();",
        // The signal this test measures: did MIGRATION ITSELF believe the
        // write verified (it sets its own flag only after a successful
        // verify)? Checked via the migration flag directly, NOT via
        // localStorage's final content -- a LATER, unrelated step
        // (_primeMarkerFromKeychain's own read) also touches that same key
        // and would make a localStorage-based signal ambiguous.
        "console.log('MUTATION17C migratedFlagSet=' + (prefsStore.get(mod._MIGRATED_FLAG_KEY_FOR_TEST) === '1'));",
      ].join('\n');
      const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], { encoding: 'utf8', timeout: 15000, env: { ...process.env, MOD_URL: new URL(`file://${scratchNative2}`).href } });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      const m = /MUTATION17C migratedFlagSet=(\w+)/.exec(out);
      assert(!!m && m[1] === 'true',
        `[17d] RED-proof: with bypassCache removed, a lying non-bypass read fools migration into believing an UNVERIFIED write succeeded (it sets its own "migrated" flag) — the real code (bypassCache:true) reads the real, empty store and correctly refuses (got migratedFlagSet=${m ? m[1] : 'no output'}${m ? '' : '\n' + out.slice(-500)})`);

      // Positive control: the SAME lying fixture against the REAL, unmutated module never sets the flag.
      const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child], { encoding: 'utf8', timeout: 15000, env: { ...process.env, MOD_URL: new URL(`file://${path.join(__dirname, 'js', 'auth-storage-native.js')}`).href } });
      const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
      const mReal = /MUTATION17C migratedFlagSet=(\w+)/.exec(outReal);
      assert(!!mReal && mReal[1] === 'false',
        `[17e-control] fixture: the REAL, unmutated module (bypassCache:true) correctly refuses to mark this unverified write as migrated (got ${mReal ? mReal[1] : 'no output'}${mReal ? '' : '\n' + outReal.slice(-500)})`);
    }

    // (S3) the Promise.race/timeout wrapper removed from js/app.js -> RED:
    // a hung plugin now hangs forever instead of settling within a bound.
    // Proven at the SOURCE level (removing the wrapper reverts to a bare
    // `await`, which this suite's [16f]/[16g] already prove settles ONLY
    // because the wrapper exists) plus a structural absence check, since
    // actually driving a hung `await` to prove it never resolves would mean
    // this test never finishes either.
    {
      const appSrc17 = await readFile(path.join(__dirname, 'js', 'app.js'), 'utf8');
      let mutatedAppSrc = appSrc17.replace(
        /let timedOut = false;\n\s*await Promise\.race\(\[\n\s*nativeAuthStorage\.primeNativeAuthStorage\(\),\n\s*new Promise\(resolve => setTimeout\(\(\) => \{ timedOut = true; resolve\(\); \}, _getNativeAuthStoragePrimeTimeoutMs\(\)\)\),\n\s*\]\);\n\s*if \(timedOut\) \{\n(?:.*\n)*?\s*_nativeAuthStoragePrimeTimedOut = true;\n\s*\}/,
        'await nativeAuthStorage.primeNativeAuthStorage(); // MUTATION: S3 bound removed, bare await restored'
      );
      assert(mutatedAppSrc !== appSrc17, '[17f-fixture] the S3 mutation actually removed the Promise.race wrapper text (a no-op replace would make this RED-proof vacuous)');
      // NOTE: js/app.js has an UNRELATED, pre-existing Promise.race([...])
      // elsewhere in the file (a different feature) — a bare
      // `!/Promise\.race\(\[/.test(...)` check would be vacuous against
      // that. Check instead for the SPECIFIC S3 machinery this mutation
      // removed: the timeout flag being set and the timeout constant being
      // read at the prime call site.
      assert(!/_nativeAuthStoragePrimeTimedOut = true;/.test(mutatedAppSrc),
        '[17g] RED-proof: after the mutation, js/app.js no longer sets the timeout flag anywhere — a hung prime call would now hang the rest of applyAuthModeDecision() forever with no way for the gate call site to know (proven structurally: a bare `await` on a call this suite\'s [16f] already showed can hang indefinitely would hang boot() itself, which cannot be safely exercised as a live timing test without risking a real hang in CI)');
      assert(mutatedAppSrc.includes('await nativeAuthStorage.primeNativeAuthStorage(); // MUTATION: S3 bound removed, bare await restored'),
        '[17h] …and the call site is a bare, unbounded `await` again, confirming the mutation reverted to the exact pre-S3 shape');
    }
  } finally {
    await rm(scratchNative2, { force: true });
    await rm(scratchAuth2, { force: true });
  }
}

console.log('\n[18] Final post-round-2-mutation re-verification…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  setNativeGlobals({ plugin, prefs: makeFakePreferences() });
  const realSession = { access_token: 'real.jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  await plugin.set({ key: authStorageNative._MARKER_KEY_FOR_TEST, value: JSON.stringify(realSession), protected: true });
  await authStorageNative.primeNativeAuthStorage();
  assert(auth.hasValidSupabaseSession() === true, '[18a] the tracked, unmutated modules still prime correctly after the round-2 mutation section');
  assert(Object.isFrozen(globalThis.window.__cfbpNativeAuthStorage), '[18b] …and the installed adapter is still frozen');
  clearNativeGlobals();
  resetAll();
}

// ═════════════════════════════════════════════════════════════════════════
// [19] RG-232 — DEVICE-FAITHFUL KEYCHAIN SEMANTICS (bug B-e part 1)
//
// Drew, iPhone 16 Pro, passcode + Face ID, 2026-09-23: Google sign-in worked
// (A1); swipe-away + reopen showed NO Face ID prompt and went straight to the
// sign-in gate (A2). The session was in the Keychain the whole time.
//
// Why no Node test could have caught it before: the Swift file cannot be
// imported here, and the iOS SIMULATOR — the only thing the DI-245 spike ran
// against — DOES NOT ENFORCE Keychain access control, so it answers a
// skip-UI attributes query for a .userPresence item with errSecSuccess. A real
// device answers errSecInteractionNotAllowed (-25308): SecItem.h says
// kSecUseAuthenticationUISkip means "all items which need to authenticate with
// UI will be silently skipped."
//
// So this section does two things that TOGETHER are a real regression test:
//   (1) PARSES the status -> presence mapping out of the real, tracked
//       KeychainAuthStorage.swift source (no hand-transcription — a change to
//       that switch changes what runs here), and
//   (2) runs it against a DEVICE-FAITHFUL Keychain stub that returns -25308
//       for protected items, asserting the session is FOUND and exactly ONE
//       Face ID prompt happens.
// [19k] keeps the pre-fix mapping as a permanent control: the same stub, with
// the old `status == errSecSuccess` rule, reproduces Drew's exact symptom.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[19] RG-232 — device-faithful Keychain semantics (-25308 = PRESENT + PROTECTED)…');

const SWIFT_DIR = path.resolve(__dirname, '..', 'munera-ios', 'plugins', 'keychain-auth-storage',
  'ios', 'Sources', 'KeychainAuthStoragePlugin');
const SWIFT_IMPL = path.join(SWIFT_DIR, 'KeychainAuthStorage.swift');
const SWIFT_PLUGIN = path.join(SWIFT_DIR, 'KeychainAuthStoragePlugin.swift');

/** Brace-matched body of a Swift func, by its declaration prefix. */
function swiftFuncBody(src, declPrefix) {
  const at = src.indexOf(declPrefix);
  if (at === -1) return null;
  const open = src.indexOf('{', at);
  if (open === -1) return null;
  let depth = 1, i = open + 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(open + 1, i - 1);
}

/**
 * Parses itemStatus()'s `switch status { … }` into
 * { <statusName>: {present, protected} | 'throw' }. `protected: 'fromAttrs'`
 * records the Swift that asks the returned attributes for an access-control
 * object rather than hardcoding a boolean.
 */
function parseItemStatusMapping(swiftSrc) {
  const body = swiftFuncBody(swiftSrc, 'private func itemStatus(');
  if (!body) return null;
  const mapping = {};
  // Split on `case <name>:` / `default:` at statement level (this switch has no
  // nested switch, so a flat split is exact).
  const parts = body.split(/\n\s*(?=case\s+errSec\w+:|default:)/);
  for (const part of parts) {
    const head = /^\s*(?:case\s+(errSec\w+)|default)\s*:/.exec(part);
    if (!head) continue;
    const name = head[1] || 'default';
    if (/\bthrow\s+StorageError/.test(part)) { mapping[name] = 'throw'; continue; }
    const ret = /ItemStatus\(present:\s*(true|false),\s*protected:\s*([^)]*?)\)\s*$/m.exec(part.trim());
    if (!ret) continue;
    const protectedExpr = ret[2].trim();
    mapping[name] = {
      present: ret[1] === 'true',
      protected: /^(true|false)$/.test(protectedExpr)
        ? protectedExpr === 'true'
        : (/kSecAttrAccessControl/.test(protectedExpr) ? 'fromAttrs' : 'unknown'),
    };
  }
  return Object.keys(mapping).length ? mapping : null;
}

/**
 * The device, not the simulator — and, since RG-235, MODE-AWARE.
 *
 * Measured on Drew's iPhone 16 Pro by the RG-234 diagnostic matrix
 * (probeVariants(), run on-device 2026-09-23) for an item written with
 * SecAccessControl(.userPresence, WhenPasscodeSetThisDeviceOnly):
 *
 *   attributes query, kSecUseAuthenticationUISkip (DEPRECATED)
 *        -> errSecItemNotFound (-25300), attrs nil          ← the lie
 *   attributes query, kSecUseAuthenticationUIFail
 *        -> errSecInteractionNotAllowed (-25308), attrs nil
 *   attributes query, kSecUseAuthenticationContext + interactionNotAllowed
 *        -> errSecInteractionNotAllowed (-25308), attrs nil
 *   data query (UI allowed)
 *        -> the value, after ONE Face ID prompt
 *
 * An unprotected item answers errSecSuccess with attributes, and never prompts,
 * in every mode. `attrs` is nil whenever interaction is refused, which is why
 * `protected: 'fromAttrs'` can never be satisfied on that path — the -25308 case
 * has to assert protectedness itself.
 */
function makeDeviceKeychain() {
  const items = new Map();
  let promptCount = 0, attrQueries = 0, dataQueries = 0;
  return {
    add(key, value, isProtected) { items.set(key, { value, protected: !!isProtected }); },
    /** `uiMode` is 'skip' | 'fail' | 'context' — whatever the REAL Swift source
     *  asks for, parsed out of it by the caller. That is the whole point: the
     *  model cannot quietly test a flag the shipped code does not use. */
    attrsQuery(key, uiMode) {
      attrQueries++;
      const it = items.get(key);
      if (!it) return { status: 'errSecItemNotFound', attrs: null };
      if (it.protected) {
        return uiMode === 'skip'
          ? { status: 'errSecItemNotFound', attrs: null }        // iOS 26/27: ACL items are HIDDEN from a Skip query
          : { status: 'errSecInteractionNotAllowed', attrs: null };
      }
      return { status: 'errSecSuccess', attrs: {} };
    },
    dataQuery(key, { foregrounded = true, faceId = 'ok' } = {}) {
      dataQueries++;
      const it = items.get(key);
      if (!it) return { status: 'errSecItemNotFound', data: null };
      if (it.protected) {
        if (!foregrounded) return { status: 'errSecInteractionNotAllowed', data: null };
        promptCount++;
        if (faceId === 'cancel') return { status: 'errSecUserCanceled', data: null };
        if (faceId === 'fail') return { status: 'errSecAuthFailed', data: null };
      }
      return { status: 'errSecSuccess', data: it.value };
    },
    promptCount: () => promptCount,
    attrQueries: () => attrQueries,
    dataQueries: () => dataQueries,
  };
}

/**
 * RG-235 — which no-prompt mode does itemStatus() actually ask for? PARSED from
 * the real Swift, never assumed, because that one constant is the entire defect:
 * the mapping and the flag have to be tested together.
 */
function parseItemStatusUiMode(swiftSrc) {
  const body = swiftFuncBody(swiftSrc, 'private func itemStatus(');
  if (!body) return null;
  // The QUERY line only — the doc comments above legitimately name all three
  // constants while explaining the finding.
  const m = /kSecUseAuthenticationUI as String:\s*kSecUseAuthenticationUI(Skip|Fail)/.exec(body);
  if (m) return m[1].toLowerCase();
  if (/kSecUseAuthenticationContext as String\]?\s*[:=]/.test(body)) return 'context';
  return null;
}

/** KeychainAuthStorage.exists()/get()'s control flow, with the status mapping
 *  AND the attributes-query UI mode supplied from OUTSIDE (both parsed from the
 *  real Swift, or the legacy rule/flag for the [19o]/[19x] controls). The
 *  process-lifetime cache is modelled too, so "one prompt per cold process"
 *  stays asserted. */
function makeSwiftModel(kc, mapping, uiMode = 'fail') {
  const cache = new Map();
  function itemStatus(key) {
    const { status, attrs } = kc.attrsQuery(key, uiMode);
    const rule = mapping[status] || mapping.default;
    if (!rule || rule === 'throw') { const e = new Error(`otherError: attributes query (${status})`); e.code = 'otherError'; throw e; }
    const isProtected = rule.protected === 'fromAttrs' ? !!(attrs && attrs.accessControl) : rule.protected === true;
    return { present: rule.present, protected: isProtected };
  }
  return {
    exists(key) { return itemStatus(key).present; },
    get(key, { bypassCache = false, foregrounded = true, faceId = 'ok' } = {}) {
      const st = itemStatus(key);
      if (!st.present) return null;
      if (st.protected && !bypassCache && cache.has(key)) return cache.get(key);
      const { status, data } = kc.dataQuery(key, { foregrounded, faceId });
      if (status === 'errSecSuccess') { if (st.protected) cache.set(key, data); return data; }
      if (status === 'errSecItemNotFound') return null;
      const e = new Error(status);
      e.code = status === 'errSecUserCanceled' ? 'userCancelled'
        : status === 'errSecAuthFailed' ? 'authFailed' : 'otherError';
      throw e;
    },
  };
}

const LEGACY_MAPPING = { // what shipped to Drew: `return status == errSecSuccess`
  errSecSuccess: { present: true, protected: 'fromAttrs' },
  errSecInteractionNotAllowed: { present: false, protected: false },
  errSecItemNotFound: { present: false, protected: false },
  default: { present: false, protected: false },
};

{
  const swiftSrc = await readFile(SWIFT_IMPL, 'utf8');
  const pluginSrc = await readFile(SWIFT_PLUGIN, 'utf8');
  const mapping = parseItemStatusMapping(swiftSrc);
  const uiMode = parseItemStatusUiMode(swiftSrc);

  assert(!!mapping, '[19a-fixture] itemStatus()\'s switch was parsed out of the real KeychainAuthStorage.swift (a miss makes everything below vacuous)');
  if (mapping) {
    assert(mapping.errSecInteractionNotAllowed && mapping.errSecInteractionNotAllowed.present === true,
      `[19b] errSecInteractionNotAllowed (-25308) maps to PRESENT — the status a Face-ID-protected item really answers with (got ${JSON.stringify(mapping.errSecInteractionNotAllowed)})`);
    assert(mapping.errSecInteractionNotAllowed && mapping.errSecInteractionNotAllowed.protected === true,
      '[19c] …and to PROTECTED (an unprotected item never needs UI, so it can never produce that status)');
    assert(mapping.errSecItemNotFound && mapping.errSecItemNotFound.present === false,
      '[19d] errSecItemNotFound still maps to ABSENT');
    assert(mapping.default === 'throw',
      '[19e] any OTHER status THROWS rather than being folded into "absent" — "we could not tell" and "there is no item" stay different facts');
    assert(mapping.errSecSuccess && mapping.errSecSuccess.present === true && mapping.errSecSuccess.protected === 'fromAttrs',
      '[19f] errSecSuccess maps to PRESENT, with protected read from the returned attributes (the simulator\'s answer path)');
  }

  // A2, reproduced at the logic level: a protected session written on a
  // previous launch, a cold process, the device's real -25308 answer.
  if (mapping) {
    const kc = makeDeviceKeychain();
    const session = JSON.stringify({ access_token: 'real.jwt', refresh_token: 'r', expires_at: 9e9 });
    kc.add('cfbp_supabase_session', session, true);
    const model = makeSwiftModel(kc, mapping, uiMode);

    assert(model.exists('cfbp_supabase_session') === true,
      '[19g] A2 FIXED: exists() finds the protected session on a real device (this is the assertion that was RED before the fix — -25308 was read as "no item")');
    assert(model.get('cfbp_supabase_session') === session,
      '[19h] …and get() returns the session rather than nil');
    assert(kc.promptCount() === 1,
      `[19i] …after exactly ONE Face ID prompt (got ${kc.promptCount()})`);
    assert(model.get('cfbp_supabase_session') === session && kc.promptCount() === 1,
      '[19j] a second get() in the same process answers from cache — still ONE prompt for the life of the process (DI-251 §2 preserved)');
    assert(model.get('cfbp_supabase_session', { bypassCache: true }) === session && kc.promptCount() === 2,
      '[19k] bypassCache:true still forces a REAL read (S2/C-3 preserved — the migration read-back proof is unaffected)');

    const kc2 = makeDeviceKeychain();
    const model2 = makeSwiftModel(kc2, mapping, uiMode);
    assert(model2.get('cfbp_supabase_session') === null && kc2.promptCount() === 0,
      '[19l] a genuinely absent item is still nil, with NO prompt (ordinary signed-out state, DI-251 §4a)');

    const kc3 = makeDeviceKeychain();
    kc3.add('cfbp_supabase_session-code-verifier', 'verifier', false);
    const model3 = makeSwiftModel(kc3, mapping, uiMode);
    assert(model3.exists('cfbp_supabase_session-code-verifier') === true
      && model3.get('cfbp_supabase_session-code-verifier') === 'verifier' && kc3.promptCount() === 0,
      '[19m] unprotected keys (the PKCE verifier family) are unchanged and never prompt');

    // A background autoRefreshToken tick: the data query is allowed to prompt,
    // but the OS refuses because the app isn't foregrounded. That -25308 means
    // something different from itemStatus()'s -25308 and must not read as
    // "absent" OR as "the user failed Face ID".
    const kc4 = makeDeviceKeychain();
    kc4.add('cfbp_supabase_session', session, true);
    const model4 = makeSwiftModel(kc4, mapping, uiMode);
    let bgErr = null;
    try { model4.get('cfbp_supabase_session', { foregrounded: false }); } catch (e) { bgErr = e; }
    assert(bgErr && bgErr.code === 'otherError',
      `[19n] a NOT-FOREGROUNDED protected read is an otherError, never "absent" and never "authFailed" (got ${bgErr ? bgErr.code : 'no throw'})`);
  }

  // ── The permanent RED control: the pre-fix mapping, same stub, same device.
  {
    const kc = makeDeviceKeychain();
    const session = JSON.stringify({ access_token: 'real.jwt', refresh_token: 'r', expires_at: 9e9 });
    kc.add('cfbp_supabase_session', session, true);
    const legacy = makeSwiftModel(kc, LEGACY_MAPPING, uiMode);
    assert(legacy.exists('cfbp_supabase_session') === false
      && legacy.get('cfbp_supabase_session') === null
      && kc.promptCount() === 0,
      '[19o] CONTROL (the shipped-to-Drew mapping, `status == errSecSuccess`): the SAME live session reads as absent, with NO prompt — Drew\'s A2 symptom exactly, recorded so this can never be called a theory again');
  }

  // ── RG-235 — THE FLAG. Measured on Drew's device: the DEPRECATED Skip mode
  //    answers -25300 (errSecItemNotFound) for an access-controlled item, so a
  //    correct mapping attached to that flag still reads a live session as absent.
  assert(uiMode === 'fail' || uiMode === 'context',
    `[19p] itemStatus()'s attributes query uses a NON-DEPRECATED no-prompt mode — kSecUseAuthenticationUIFail or kSecUseAuthenticationContext, never kSecUseAuthenticationUISkip, which hides ACL items on iOS 26/27 (got ${JSON.stringify(uiMode)})`);
  // Counts QUERY lines, not prose: the doc comments legitimately name all three
  // constants while explaining the finding.
  const skipUiQueries = (swiftSrc.match(/kSecUseAuthenticationUI as String\]?\s*[:=]\s*kSecUseAuthenticationUISkip/g) || []).length;
  const probeBodyForSkip = swiftFuncBody(swiftSrc, 'func probeVariants() -> [[String: Any]]') || '';
  const skipInProbe = (probeBodyForSkip.match(/kSecUseAuthenticationUI as String\]?\s*[:=]\s*kSecUseAuthenticationUISkip/g) || []).length;
  assert(skipUiQueries === 1 && skipInProbe === 1,
    `[19p2] kSecUseAuthenticationUISkip survives in EXACTLY ONE place — probeVariants()'s measurement column, kept deliberately so a future OS change is detected rather than assumed — and in NO code path that answers a question for the app (total=${skipUiQueries}, inside probeVariants=${skipInProbe})`);
  {
    const existsPathBody = (swiftFuncBody(swiftSrc, 'private func itemStatus(') || '')
      + (swiftFuncBody(swiftSrc, 'func exists(key: String)') || '')
      + (swiftFuncBody(swiftSrc, 'func get(key: String, bypassCache') || '')
      + (swiftFuncBody(swiftSrc, 'func set(key: String, value: String, protected: Bool) throws') || '');
    // Comments stripped first: itemStatus()'s own doc block NAMES the retired
    // constant while explaining why it is retired, and prose is not a query.
    const codeOnly = existsPathBody.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert(!/kSecUseAuthenticationUISkip/.test(codeOnly),
      '[19p3] …so itemStatus(), exists(), get() and set()\'s write-verify contain no Skip-mode query between them (comments excluded — they document the retirement)');
  }
  assert(!/return\s+status\s*==\s*errSecSuccess/.test(swiftSrc),
    '[19q] no `return status == errSecSuccess` presence test survives anywhere in the file');
  {
    const existsBody = swiftFuncBody(swiftSrc, 'func exists(key: String)');
    assert(!!existsBody && /itemStatus\(key:\s*key\)\.present/.test(existsBody),
      '[19r] exists() answers from itemStatus(key:).present — ONE mapping, one place to get it right');
    const getBody = swiftFuncBody(swiftSrc, 'func get(key: String, bypassCache');
    assert(!!getBody && /try\s+itemStatus\(key:\s*key\)/.test(getBody) && !/kSecUseAuthenticationUISkip/.test(getBody),
      '[19s] get() reads presence AND protectedness from that same itemStatus() call, and issues no skip-UI query of its own');
    assert(!!getBody && /case errSecInteractionNotAllowed:[\s\S]*?app not foregrounded/.test(getBody),
      '[19t] get()\'s DATA-query switch maps -25308 to otherError "app not foregrounded" — distinct from itemStatus()\'s reading of the same code');
  }
  {
    const existsWrapper = swiftFuncBody(pluginSrc, '@objc func exists(');
    assert(!!existsWrapper && /try\s+impl\.exists\(key:\s*key\)/.test(existsWrapper) && /call\.reject\(/.test(existsWrapper),
      '[19u] the Capacitor wrapper calls `try impl.exists(...)` and REJECTS on a throw — an unknown Keychain answer reaches JS as an error, not as `exists:false`');
  }

  // ── Mutation proof: delete the -25308 case from a SCRATCH COPY of the Swift
  //    source and prove the parse+model go RED (i.e. reproduce the bug). The
  //    tracked file is never written.
  {
    const scratchSwift = path.join(scratchDir, '__mutation_scratch_KeychainAuthStorage.swift');
    try {
      const mutated = swiftSrc.replace(
        /\n\s*case errSecInteractionNotAllowed:\n(?:[^\n]*\n)*?\s*return ItemStatus\(present: true, protected: true\)\n/,
        '\n'
      );
      assert(mutated !== swiftSrc, '[19v-fixture] the mutation actually removed the errSecInteractionNotAllowed case (a no-op replace would make the proof below vacuous)');
      await writeFile(scratchSwift, mutated, 'utf8');
      const mutatedMapping = parseItemStatusMapping(await readFile(scratchSwift, 'utf8'));
      const kc = makeDeviceKeychain();
      kc.add('cfbp_supabase_session', 'session', true);
      const model = makeSwiftModel(kc, mutatedMapping || {}, uiMode);
      let threwOrLost = null;
      try { threwOrLost = model.exists('cfbp_supabase_session'); } catch (e) { threwOrLost = e.code; }
      assert(threwOrLost !== true,
        `[19v] RED-proof: with that one case removed, the protected session stops being found (got ${JSON.stringify(threwOrLost)}) — the mapping is load-bearing, not decorative`);
    } finally {
      await rm(scratchSwift, { force: true });
    }
    const afterSwift = await readFile(SWIFT_IMPL, 'utf8');
    assert(afterSwift === swiftSrc, '[19w] the TRACKED KeychainAuthStorage.swift is byte-identical after the mutation proof (scratch copy only — no git restore anywhere)');
  }

  // ── RG-235 MUTATION PROOF: put the DEPRECATED Skip flag back on a scratch copy
  //    — mapping untouched, one constant changed — and the live protected session
  //    disappears again. This is the proof that RG-232's mapping was correct all
  //    along and the flag was the defect.
  {
    const scratchSwift2 = path.join(scratchDir, '__mutation_scratch_KeychainAuthStorage_skipflag.swift');
    try {
      const mutated = swiftSrc.replace(
        '            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail\n        ]',
        '            kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip // MUTATION: RG-235 flag reverted\n        ]'
      );
      assert(mutated !== swiftSrc, '[19x-fixture] the flag mutation actually changed itemStatus()\'s query (a no-op replace would make this RED-proof vacuous)');
      await writeFile(scratchSwift2, mutated, 'utf8');
      const mutatedSrc = await readFile(scratchSwift2, 'utf8');
      const mutatedMode = parseItemStatusUiMode(mutatedSrc);
      const mutatedMapping = parseItemStatusMapping(mutatedSrc);
      assert(mutatedMode === 'skip', `[19x-fixture2] the mutated source really asks for the Skip mode (got ${JSON.stringify(mutatedMode)})`);
      const kc = makeDeviceKeychain();
      const session = JSON.stringify({ access_token: 'real.jwt', refresh_token: 'r', expires_at: 9e9 });
      kc.add('cfbp_supabase_session', session, true);
      const model = makeSwiftModel(kc, mutatedMapping || {}, mutatedMode);
      assert(model.exists('cfbp_supabase_session') === false && model.get('cfbp_supabase_session') === null && kc.promptCount() === 0,
        `[19x] RED-proof: with the deprecated Skip flag restored — the -25308 mapping still fully intact — the live protected session reads as ABSENT with no Face ID prompt. That is Drew's symptom, and it is the FLAG that produces it, not the mapping (exists=${model.exists('cfbp_supabase_session')})`);
      // …and the same fixture against the REAL, tracked flag is green.
      const kc2 = makeDeviceKeychain();
      kc2.add('cfbp_supabase_session', session, true);
      const real = makeSwiftModel(kc2, mapping || {}, uiMode);
      assert(real.exists('cfbp_supabase_session') === true && real.get('cfbp_supabase_session') === session && kc2.promptCount() === 1,
        '[19y-control] the REAL flag finds the same session and reads it after exactly one prompt');
    } finally {
      await rm(scratchSwift2, { force: true });
    }
    const afterSwift2 = await readFile(SWIFT_IMPL, 'utf8');
    assert(afterSwift2 === swiftSrc, '[19z] the TRACKED KeychainAuthStorage.swift is still byte-identical after the flag mutation proof');
  }

  // ── The build stamp moved with the finding, so a relayed device probe can never
  //    be attributed to the pre-RG-235 build.
  assert(/static let buildStamp = "RG-235 2026-09-23"/.test(swiftSrc),
    '[19z2] the plugin build stamp is RG-235 — diagnostics() is how a device answers "is the flag fix actually installed?"');
}

// ═════════════════════════════════════════════════════════════════════════
// [20] RG-232, JS side — an UNKNOWN Keychain answer must not be read as
//      "nothing is there". The plugin's exists() can now reject; migration
//      used to `catch { /* treat as absent */ }`, which would overwrite a real
//      protected Keychain session with a stale localStorage copy.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[20] RG-232 — migration defers (never overwrites) when exists() can\'t answer…');
{
  resetAll();
  const plugin = makeFakeKeychainPlugin();
  // The device-faithful failure the fix introduces at the bridge: "I could not
  // determine whether an item is there."
  plugin.exists = async () => { const e = new Error('SecItemCopyMatching (attributes) failed (-25308)'); e.code = 'otherError'; throw e; };
  const prefs = makeFakePreferences();
  setNativeGlobals({ plugin, prefs });
  const realSession = JSON.stringify({ access_token: 'pre.keychain.jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  globalThis.localStorage.setItem(authStorageNative._MARKER_KEY_FOR_TEST, realSession);
  const setCallsBefore = plugin._setCalls();

  await authStorageNative.primeNativeAuthStorage();

  assert(plugin._setCalls() === setCallsBefore,
    `[20a] migration wrote NOTHING to the Keychain when exists() couldn't answer (got ${plugin._setCalls() - setCallsBefore} writes) — it defers instead of clobbering a session that may well be there`);
  assert(globalThis.localStorage.getItem(authStorageNative._MARKER_KEY_FOR_TEST) === realSession,
    '[20b] …and the real, un-migrated localStorage session is still intact, byte for byte (never destroy the only surviving copy)');
  const migratedFlag = prefs._store.get(authStorageNative._MIGRATED_FLAG_KEY_FOR_TEST);
  assert(migratedFlag !== '1',
    `[20c] …and the "migrated" flag was NOT set, so a later boot tries again (got ${migratedFlag})`);
  clearNativeGlobals();
  resetAll();

  // ── Mutation proof: put the PRE-FIX `catch { /* treat as absent */ }` back
  //    on a SCRATCH COPY and show it clobbers. Child process, because the
  //    module is already loaded in this one. Tracked file never written.
  const scratchMig = path.join(scratchDir, '__mutation_scratch_migration_absent.js');
  try {
    const realSrc = await readFile(path.join(__dirname, 'js', 'auth-storage-native.js'), 'utf8');
    const fixedCatch = /\n  } catch \(e\) \{\n    console\.warn\('\[auth-storage-native\] could not determine whether Keychain already holds a session[\s\S]*?\n    return;\n  \}\n/;
    assert(fixedCatch.test(realSrc), '[20d-fixture] the RG-232 exists()-rejection guard was found in js/auth-storage-native.js (a drifted string would make the proof below vacuous)');
    const mutated = realSrc.replace(fixedCatch, '\n  } catch { /* MUTATION: treat as absent, the pre-RG-232 behavior */ }\n');
    assert(mutated !== realSrc, '[20e-fixture] …and the mutation actually changed the source');
    await writeFile(scratchMig, rewriteRelativeImportsForScratch(mutated), 'utf8');
    const child = [
      "const store = new Map();",
      "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
      "let setCalls = 0;",
      "const kc = {",
      "  async set({ key, value }) { setCalls++; return; },",
      "  async get() { return { value: null }; },",
      "  async remove() {}, async clear() {},",
      "  async exists() { const e = new Error('attrs failed (-25308)'); e.code = 'otherError'; throw e; },",
      "};",
      "const prefsStore = new Map([['cfbp_native_installed', '1']]);",
      "const prefs = { async get({ key }) { return { value: prefsStore.has(key) ? prefsStore.get(key) : null }; }, async set({ key, value }) { prefsStore.set(key, String(value)); } };",
      "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { KeychainAuthStorage: kc, Preferences: prefs } } };",
      "globalThis.location = { protocol: 'capacitor:' };",
      "globalThis.localStorage.setItem('cfbp_supabase_session', JSON.stringify({ access_token: 'pre.keychain.jwt', refresh_token: 'r', expires_at: 9e9 }));",
      "const mod = await import(process.env.MOD_URL);",
      "await mod.primeNativeAuthStorage();",
      "console.log('MUTATION20 setCalls=' + setCalls);",
    ].join('\n');
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, MOD_URL: pathToFileURL(scratchMig).href },
    });
    const out = `${run.stdout || ''}${run.stderr || ''}`;
    const m = /MUTATION20 setCalls=(\d+)/.exec(out);
    assert(!!m && Number(m[1]) > 0,
      `[20d] RED-proof: with "treat as absent" restored, migration WRITES over a Keychain it was never able to read — the exact clobber the guard prevents (got setCalls=${m ? m[1] : 'no output'}${m ? '' : '\n' + out.slice(-500)})`);
    const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, MOD_URL: pathToFileURL(path.join(__dirname, 'js', 'auth-storage-native.js')).href },
    });
    const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
    const mReal = /MUTATION20 setCalls=(\d+)/.exec(outReal);
    assert(!!mReal && Number(mReal[1]) === 0,
      `[20e-control] fixture: the REAL, unmutated module writes nothing in that same scenario (got setCalls=${mReal ? mReal[1] : 'no output'})`);
  } finally {
    await rm(scratchMig, { force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// [21] RG-234 — bug B-e part 3: THE GATE THAT NEVER CAME DOWN.
//
// Drew, real iPhone, 2026-09-23, with RG-232 + RG-233 merged. His device console
// showed a sign-in that COMPLETED end to end: Browser.open → appUrlOpen with
// ?code= → Browser.close → KeychainAuthStorage.remove(verifier) →
// KeychainAuthStorage.set(cfbp_supabase_session, protected:true) → "[auth]
// identity changed (event:SIGNED_IN)" → MEMBERSHIPS_REFRESHED → hydrate. And the
// screen still showed the sign-in gate, button disabled, "Connecting to Google…".
//
// ROOT CAUSE: app.js's session-event handler decides `signedIn` from
// hasValidSupabaseSession() (js/auth.js), which reads localStorage[MARKER_KEY]
// SYNCHRONOUSLY. On native that marker used to be written only by THIS module's
// own onAuthStateChange subscriber — a SECOND subscriber on the same client,
// added after js/auth.js's internal one, so the SDK notified auth.js (and through
// it app.js) FIRST, while the marker was still absent (a first sign-in on a fresh
// install) or stale. `signedIn` was false, the else branch found the overlay
// already present and deliberately did not repaint it, and no later event retried
// (MEMBERSHIPS_REFRESHED is not in AUTH_SESSION_EVENTS). The gate stayed forever.
//
// THE FIX is order-independence, not reordering: the vendored SDK persists the
// session THROUGH this adapter and AWAITS it before notifying anyone —
//   vendor/supabase-js-2.116.0.js `_saveSession()`      : `await H(this.storage, this.storageKey, r)`
//   vendor/supabase-js-2.116.0.js `H`                   : `await e.setItem(t, JSON.stringify(n))`
//   vendor/supabase-js-2.116.0.js `_exchangeCodeForSession()`:
//        `await this._saveSession(t.session), await this._notifyAllSubscribers('SIGNED_IN', …)`
// — so writing the marker synchronously at the top of nativeSetItem() puts it in
// localStorage before ANY subscriber, in any order, can look.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[21] RG-234 — the marker lands synchronously inside the setItem the SDK awaits…');
{
  const MARKER = authStorageNative._MARKER_KEY_FOR_TEST;

  // The ordering this section relies on is PARSED out of the vendored SDK, not
  // taken on trust: if a future SDK bump notifies before it persists, this goes
  // red here rather than silently on Drew's phone.
  {
    const sdk = await readFile(path.join(__dirname, 'vendor', 'supabase-js-2.116.0.js'), 'utf8');
    assert(/H=async\(e,t,n\)=>\{await e\.setItem\(t,JSON\.stringify\(n\)\)\}/.test(sdk),
      '[21-sdk1] the vendored SDK persists through storage.setItem() and AWAITS it (its `H` helper)');
    assert(/await this\._saveSession\([^)]*\),await this\._notifyAllSubscribers\(/.test(sdk),
      '[21-sdk2] …and `_exchangeCodeForSession()` awaits _saveSession() BEFORE _notifyAllSubscribers() — which is what makes a synchronous marker write inside setItem() order-independent');
    assert(/async _saveSession\(e\)\{[\s\S]{0,400}?await H\(this\.storage,this\.storageKey,/.test(sdk),
      '[21-sdk3] …and _saveSession() writes the SESSION under `storageKey` through that same helper');
  }

  // ── (1) The defect itself: a subscriber running at notify time sees a marker.
  {
    resetAll();
    const plugin = makeFakeKeychainPlugin();
    setNativeGlobals({ plugin, prefs: makeFakePreferences() });
    await authStorageNative.primeNativeAuthStorage(); // installs the frozen adapter
    const adapter = globalThis.window.__cfbpNativeAuthStorage;
    assert(!!adapter && typeof adapter.setItem === 'function', '[21-pre1] fixture: the frozen adapter is installed');
    // Drew's exact state: a first sign-in on this install, so NOTHING in the
    // marker slot when the SDK is about to notify.
    globalThis.localStorage.removeItem(MARKER);
    assert(auth.hasValidSupabaseSession() === false,
      '[21-pre2] fixture: with no marker, hasValidSupabaseSession() is false — the state that kept Drew\'s gate up');

    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const sessionJson = JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'real-refresh', expires_at: expiresAt });
    // The SDK's sequence, faithfully: call setItem and do NOT await it yet.
    // Everything asserted between here and the `await` is what a subscriber
    // notified by _saveSession()'s caller would see.
    const pending = adapter.setItem(MARKER, sessionJson);
    assert(auth.hasValidSupabaseSession() === true,
      '[21a] the REAL hasValidSupabaseSession() answers TRUE synchronously, before the setItem promise is even awaited — so app.js\'s handler takes the gate down no matter which subscriber runs first');
    const marker = JSON.parse(globalThis.localStorage.getItem(MARKER) || 'null');
    assert(!!marker && marker.access_token === authStorageNative._NATIVE_PLACEHOLDER_FOR_TEST
      && marker.refresh_token === authStorageNative._NATIVE_PLACEHOLDER_FOR_TEST,
      `[21b] …and what landed in localStorage is still ONLY the placeholder marker — the real tokens never leave the Keychain (got ${JSON.stringify(marker && marker.access_token)})`);
    assert(!!marker && marker.expires_at === expiresAt,
      `[21c] …carrying the session's real expires_at, so the freshness test is honest (got ${marker && marker.expires_at})`);
    assert(!globalThis.localStorage.getItem(MARKER).includes('real.jwt.token'),
      '[21d] …and the access token does not appear anywhere in the localStorage value');
    await pending;
    const stored = plugin._store.get(MARKER);
    assert(!!stored && stored.value === sessionJson && stored.protected === true,
      '[21e] …while the real session still went to the Keychain as a PROTECTED item (the adapter\'s job is unchanged)');
    clearNativeGlobals();
  }

  // ── Nothing ELSE writes a marker: verifier keys and garbage are untouched.
  {
    resetAll();
    const plugin = makeFakeKeychainPlugin();
    setNativeGlobals({ plugin, prefs: makeFakePreferences() });
    await authStorageNative.primeNativeAuthStorage();
    const adapter = globalThis.window.__cfbpNativeAuthStorage;
    globalThis.localStorage.removeItem(MARKER);
    await adapter.setItem(`${MARKER}-code-verifier`, 'verifier-abc');
    assert(globalThis.localStorage.getItem(MARKER) === null,
      '[21f] a PKCE code-verifier write never writes a session marker (only the session key does)');
    await adapter.setItem(MARKER, 'not json at all');
    assert(globalThis.localStorage.getItem(MARKER) === null,
      '[21g] a non-session value under the session key writes no marker either — never a marker for something that is not a session');
    clearNativeGlobals();
  }

  // ── The mirror image: removal clears the marker synchronously too, because the
  //    SDK's _removeSession() awaits removeItem() before notifying SIGNED_OUT.
  {
    resetAll();
    const plugin = makeFakeKeychainPlugin();
    setNativeGlobals({ plugin, prefs: makeFakePreferences() });
    await authStorageNative.primeNativeAuthStorage();
    const adapter = globalThis.window.__cfbpNativeAuthStorage;
    const sessionJson = JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    await adapter.setItem(MARKER, sessionJson);
    assert(auth.hasValidSupabaseSession() === true, '[21h-pre] fixture: signed in');
    const pendingRemove = adapter.removeItem(MARKER);
    assert(auth.hasValidSupabaseSession() === false,
      '[21h] removeItem() clears the marker synchronously as well — a SIGNED_OUT subscriber can never read a session that has just been removed');
    await pendingRemove;
    clearNativeGlobals();
  }

  // ── RG-12 CLASS: the synchronous write must NEVER fire on the migration path,
  //    where localStorage[MARKER_KEY] still holds the only verified copy of a
  //    real, un-migrated session. Measured at the exact instant it would matter:
  //    the plugin's own set() records what was in the localStorage slot when it
  //    was called, because the synchronous write happens immediately BEFORE that
  //    call. Whatever a later step does with the slot is a different question
  //    (and a pre-existing one) — this pins the write itself.
  {
    resetAll();
    const seenAtWriteTime = [];
    const recordingPlugin = {
      async set({ key, value }) { seenAtWriteTime.push(globalThis.localStorage.getItem(MARKER)); },
      async get() { return { value: null }; },
      async remove() {}, async clear() {}, async exists() { return { exists: false }; },
    };
    setNativeGlobals({ plugin: recordingPlugin, prefs: makeFakePreferences() });
    const raw = JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'real-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    globalThis.localStorage.setItem(MARKER, raw);
    await authStorageNative.primeNativeAuthStorage();
    assert(seenAtWriteTime.length === 1, `[21i-fixture] the migration performed exactly one Keychain write (got ${seenAtWriteTime.length})`);
    assert(seenAtWriteTime[0] === raw,
      `[21i] during the MIGRATION write, the real un-migrated session was still intact in localStorage — the synchronous marker write is suppressed there, so an unverified migration can never trade the only surviving copy for a placeholder (got ${String(seenAtWriteTime[0]).slice(0, 70)})`);
    clearNativeGlobals();
  }

  // ── …and the guard does not leak: an ordinary session write AFTER a migration
  //    still writes its marker synchronously.
  {
    resetAll();
    const plugin = makeFakeKeychainPlugin();
    setNativeGlobals({ plugin, prefs: makeFakePreferences() });
    const raw = JSON.stringify({ access_token: 'old.jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    globalThis.localStorage.setItem(MARKER, raw);
    await authStorageNative.primeNativeAuthStorage(); // runs a real, verifying migration
    globalThis.localStorage.removeItem(MARKER);
    const adapter = globalThis.window.__cfbpNativeAuthStorage;
    const pending = adapter.setItem(MARKER, JSON.stringify({ access_token: 'new.jwt', refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 7200 }));
    assert(auth.hasValidSupabaseSession() === true,
      '[21j] the migration guard is per-write, not sticky — the next ordinary session write still lands its marker synchronously');
    await pending;
    clearNativeGlobals();
  }

  // ── MUTATION PROOF — scratch copy only, never the tracked file.
  {
    const scratch = path.join(scratchDir, '__mutation_scratch_auth_storage_native_rg234.js');
    const realSrc = await readFile(path.join(__dirname, 'js', 'auth-storage-native.js'), 'utf8');
    const mutated = realSrc.replace(
      'if (key === MARKER_KEY && !_migrationWriteInProgress && _isRealSessionValue(value)) {',
      'if (false) { // MUTATION: RG-234 synchronous marker write disabled'
    );
    assert(mutated !== realSrc, '[21m-fixture] the mutation actually removed the synchronous marker write');
    await writeFile(scratch, rewriteRelativeImportsForScratch(mutated), 'utf8');
    const child = [
      "globalThis.localStorage = (() => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size}, key:i=>[...m.keys()][i]??null }; })();",
      "const store = new Map();",
      "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {",
      "  KeychainAuthStorage: { async set({key,value}){ store.set(key,value); }, async get({key}){ return { value: store.has(key)?store.get(key):null }; }, async remove({key}){ store.delete(key); }, async clear(){ store.clear(); }, async exists({key}){ return { exists: store.has(key) }; } },",
      "  Preferences: (() => { const p = new Map(); return { async get({key}){ return { value: p.has(key)?p.get(key):null }; }, async set({key,value}){ p.set(key,String(value)); }, async remove({key}){ p.delete(key); } }; })(),",
      "} } };",
      "globalThis.location = { protocol: 'capacitor:' };",
      "const mod = await import(process.env.MOD_URL);",
      "const authMod = await import(process.env.AUTH_URL);",
      // Not a first launch: keep the hygiene sweep out of the way.
      "globalThis.window.Capacitor.Plugins.Preferences.set({ key: mod._INSTALLED_FLAG_KEY_FOR_TEST, value: '1' });",
      "await mod.primeNativeAuthStorage();",
      "const adapter = globalThis.window.__cfbpNativeAuthStorage;",
      "globalThis.localStorage.removeItem(mod._MARKER_KEY_FOR_TEST);",
      "const sessionJson = JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'r', expires_at: Math.floor(Date.now()/1000) + 3600 });",
      // The SDK's moment of truth: has the marker landed by the time the promise
      // is still pending (i.e. before _notifyAllSubscribers can run)?
      "const pending = adapter.setItem(mod._MARKER_KEY_FOR_TEST, sessionJson);",
      "console.log('MUTATION20 sessionVisibleAtNotifyTime=' + authMod.hasValidSupabaseSession());",
      "await pending;",
      "process.exit(0);",
    ].join('\n');
    const envBase = { ...process.env, AUTH_URL: pathToFileURL(path.join(__dirname, 'js', 'auth.js')).href };
    const runMut = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 20000, env: { ...envBase, MOD_URL: pathToFileURL(scratch).href },
    });
    const outMut = `${runMut.stdout || ''}${runMut.stderr || ''}`;
    assert(/MUTATION20 sessionVisibleAtNotifyTime=false/.test(outMut),
      `[21m] RED-proof: without the synchronous write, a subscriber notified by the SDK sees NO session on this device — hasValidSupabaseSession() is false, app.js's handler takes the else branch, and the gate Drew was staring at stays up (got ${/MUTATION20 sessionVisibleAtNotifyTime=(\w+)/.exec(outMut)?.[1] || outMut.slice(-500)})`);
    const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 20000, env: { ...envBase, MOD_URL: pathToFileURL(path.join(__dirname, 'js', 'auth-storage-native.js')).href },
    });
    const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
    assert(/MUTATION20 sessionVisibleAtNotifyTime=true/.test(outReal),
      `[21n-control] the REAL, tracked module answers TRUE at that same instant (got ${/MUTATION20 sessionVisibleAtNotifyTime=(\w+)/.exec(outReal)?.[1] || outReal.slice(-500)})`);
    const afterSrc = await readFile(path.join(__dirname, 'js', 'auth-storage-native.js'), 'utf8');
    assert(afterSrc === realSrc, '[21o] the TRACKED js/auth-storage-native.js is byte-identical after the mutation proof');
    await rm(scratch, { force: true });
    resetAll();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// [22] RG-234 — THE SESSION THAT DISAPPEARED BETWEEN LAUNCHES.
//
// Drew's third device fact (Web Inspector, cold relaunch): the localStorage marker
// was present, and DIRECT plugin probes answered
// `exists({key:'cfbp_supabase_session'}) => {"exists":false}` and `get(...) => {}`
// — the protected item that had been written successfully at sign-in was GONE.
//
// `plugin.clear()` is the only call that deletes the whole Keychain service
// (KeychainAuthStorage.swift's clear() is a SecItemDelete by kSecAttrService
// alone), and outside signOut() its only caller is _hygieneCheckOnFirstLaunch().
// Its pre-fix control flow let EVERY answer that was not literally the string '1'
// fall through to clear(): an odd-shaped Preferences reply, a read that threw, or
// a `set` that silently failed to persist. In all of those the flag never becomes
// '1', so the sweep does not run once — it runs on every launch, and the
// localStorage marker survives because clear() never touches the web store. One
// mechanism, all three symptoms.
//
// These are the fixtures that mechanism demands. Every one of them is a Keychain
// that must come out of prime() UNSWEPT.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[22] RG-234 — the delete+reinstall sweep can no longer wipe a live session…');
{
  const MARKER = authStorageNative._MARKER_KEY_FOR_TEST;
  const FLAG = authStorageNative._INSTALLED_FLAG_KEY_FOR_TEST;

  /** A Keychain that already holds Drew's protected session, plus a counter for
   *  the one call that could destroy it. */
  function makeLoadedKeychain() {
    let clearCalls = 0;
    const store = new Map();
    store.set(MARKER, { value: JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 }), protected: true });
    return {
      async set({ key, value, protected: p }) { store.set(key, { value, protected: !!p }); },
      async get({ key }) { return { value: store.has(key) ? store.get(key).value : null }; },
      async remove({ key }) { store.delete(key); },
      async clear() { clearCalls++; store.clear(); },
      async exists({ key }) { return { exists: store.has(key) }; },
      _store: store,
      _clearCalls: () => clearCalls,
    };
  }

  // Each case: [name, prefs stub, whether to seed the localStorage marker, expected clears]
  const cases = [
    ['prefs.get returns {} (no `value` property at all — an unregistered/odd plugin shape)',
      { async get() { return {}; }, async set() {}, async remove() {} }, false, 0],
    ['prefs.get returns undefined',
      { async get() { return undefined; }, async set() {}, async remove() {} }, false, 0],
    ['prefs.get returns a non-string value',
      { async get() { return { value: 1 }; }, async set() {}, async remove() {} }, false, 0],
    ['prefs.get throws',
      { async get() { throw new Error('Preferences unavailable'); }, async set() {}, async remove() {} }, false, 0],
    ['prefs.get never resolves (a wedged bridge)',
      { get() { return new Promise(() => {}); }, async set() {}, async remove() {} }, false, 0],
    ['prefs.set silently fails to persist — THE wipe-every-launch case',
      { async get() { return { value: null }; }, async set() { /* drops it */ }, async remove() {} }, false, 0],
    ['prefs.set throws',
      { async get() { return { value: null }; }, async set() { throw new Error('nope'); }, async remove() {} }, false, 0],
    ['the flag is absent but the web store still holds the marker (not a fresh install)',
      makeFakePreferences(), true, 0],
  ];

  for (const [name, prefs, seedMarker, expectedClears] of cases) {
    resetAll();
    // 100ms bound so the "never resolves" case does not make this suite wait 10s.
    authStorageNative._resetAuthStorageNativeForTest({ keychainCallTimeoutMs: 100 });
    const plugin = makeLoadedKeychain();
    setNativeGlobals({ plugin, prefs, firstLaunch: true }); // no installed flag pre-set
    if (seedMarker) globalThis.localStorage.setItem(MARKER, JSON.stringify({ access_token: authStorageNative._NATIVE_PLACEHOLDER_FOR_TEST, refresh_token: authStorageNative._NATIVE_PLACEHOLDER_FOR_TEST, expires_at: Math.floor(Date.now() / 1000) + 3600 }));
    await authStorageNative.primeNativeAuthStorage();
    assert(plugin._clearCalls() === expectedClears,
      `[22a:${name}] clear() was NOT called (got ${plugin._clearCalls()})`);
    assert(plugin._store.has(MARKER),
      `[22b:${name}] …and the protected session is still in the Keychain afterwards`);
    clearNativeGlobals();
  }
  authStorageNative._resetAuthStorageNativeForTest();

  // ── The sweep's PURPOSE is intact: a genuine fresh install (no flag, and an
  //    empty web store, because a delete+reinstall takes the WKWebView data store
  //    with it) still sweeps exactly once, and records that it did.
  {
    resetAll();
    const plugin = makeLoadedKeychain(); // the "orphan" item from a previous install
    const prefs = makeFakePreferences();
    setNativeGlobals({ plugin, prefs, firstLaunch: true });
    assert(globalThis.localStorage.getItem(MARKER) === null, '[22c-fixture] fixture: the web store is empty, as it is after a real delete+reinstall');
    await authStorageNative.primeNativeAuthStorage();
    assert(plugin._clearCalls() === 1, `[22c] a genuine fresh install DOES still sweep the orphan Keychain items, exactly once (got ${plugin._clearCalls()} clears)`);
    assert(prefs._store.get(FLAG) === '1', '[22d] …and the installed flag is recorded, so the next launch takes the cheap path');

    // And a SECOND prime() on that same device never sweeps again.
    const before = plugin._clearCalls();
    await authStorageNative.primeNativeAuthStorage();
    assert(plugin._clearCalls() === before, `[22e] a second launch does not sweep again (got ${plugin._clearCalls()} total)`);
    clearNativeGlobals();
  }

  // ── The flag is written and READ BACK BEFORE the delete, not after: proved by
  //    a Preferences stub that records the order of operations against clear().
  {
    resetAll();
    const order = [];
    const store = new Map();
    const prefs = {
      async get({ key }) { order.push('prefs-get'); return { value: store.has(key) ? store.get(key) : null }; },
      async set({ key, value }) { order.push('prefs-set'); store.set(key, String(value)); },
      async remove({ key }) { store.delete(key); },
      _store: store,
    };
    const plugin = makeLoadedKeychain();
    const wrapped = { ...plugin, async clear() { order.push('clear'); return plugin.clear(); } };
    setNativeGlobals({ plugin: wrapped, prefs, firstLaunch: true });
    await authStorageNative.primeNativeAuthStorage();
    const setIdx = order.indexOf('prefs-set');
    const clearIdx = order.indexOf('clear');
    assert(setIdx > -1 && clearIdx > -1 && setIdx < clearIdx,
      `[22f] the installed flag is persisted (and re-read) BEFORE clear() runs — a sweep may only happen once it has proved it will not repeat (order: ${order.join(' → ')})`);
    assert(order.filter(o => o === 'prefs-get').length >= 2,
      `[22g] …and that persistence is VERIFIED by a read-back, not assumed (prefs-get calls: ${order.filter(o => o === 'prefs-get').length})`);
    clearNativeGlobals();
  }

  // ── MUTATION PROOF — scratch copy only; the tracked file is never touched.
  {
    const scratch = path.join(scratchDir, '__mutation_scratch_auth_storage_native_hygiene.js');
    const realSrc = await readFile(path.join(__dirname, 'js', 'auth-storage-native.js'), 'utf8');
    // Restore the pre-fix control flow: any answer that is not '1' sweeps.
    const mutated = realSrc.replace(
      "  if (flag === 'present') { _stage('hygiene:skip-already-installed'); return; }",
      "  if (flag === 'present') { _stage('hygiene:skip-already-installed'); return; }\n  flag = 'absent'; // MUTATION: RG-234 fail-safe removed — an unknown answer sweeps again"
    ).replace(
      "  if (markerSlot !== null) {",
      "  if (false) { // MUTATION: RG-234 web-store witness removed"
    ).replace(
      "  if (!persisted) {",
      "  if (false) { // MUTATION: RG-234 flag-verified precondition removed"
    );
    assert(mutated !== realSrc, '[22h-fixture] the mutation actually restored the pre-fix control flow');
    await writeFile(scratch, rewriteRelativeImportsForScratch(mutated), 'utf8');
    const child = [
      "globalThis.localStorage = (() => { const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size}, key:i=>[...m.keys()][i]??null }; })();",
      "let clearCalls = 0;",
      "const store = new Map();",
      "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {",
      "  KeychainAuthStorage: { async set({key,value,protected:p}){ store.set(key,value); }, async get({key}){ return { value: store.has(key)?store.get(key):null }; }, async remove({key}){ store.delete(key); }, async clear(){ clearCalls++; store.clear(); }, async exists({key}){ return { exists: store.has(key) }; } },",
      // THE DEVICE SHAPE: Preferences answers, but nothing it is told ever sticks.
      "  Preferences: { async get(){ return { value: null }; }, async set(){ /* silently drops it */ }, async remove(){} },",
      "} } };",
      "globalThis.location = { protocol: 'capacitor:' };",
      "const mod = await import(process.env.MOD_URL);",
      "const sessionJson = JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'r', expires_at: Math.floor(Date.now()/1000) + 3600 });",
      "store.set(mod._MARKER_KEY_FOR_TEST, sessionJson);",           // signed in on a previous launch
      "globalThis.localStorage.setItem(mod._MARKER_KEY_FOR_TEST, JSON.stringify({ access_token: '<native-keychain>', refresh_token: '<native-keychain>', expires_at: Math.floor(Date.now()/1000) + 3600 }));",
      "await mod.primeNativeAuthStorage();",
      "console.log('MUTATION22 ' + JSON.stringify({ clearCalls, sessionStillThere: store.has(mod._MARKER_KEY_FOR_TEST) }));",
      "process.exit(0);",
    ].join('\n');
    const runMut = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 20000, env: { ...process.env, MOD_URL: pathToFileURL(scratch).href },
    });
    const outMut = `${runMut.stdout || ''}${runMut.stderr || ''}`;
    assert(/MUTATION22 .*"clearCalls":1/.test(outMut) && /"sessionStillThere":false/.test(outMut),
      `[22h] RED-proof: with the fail-safes removed, a device whose Preferences never persist wipes the whole Keychain on this launch — Drew's session gone while the localStorage marker survives, exactly as his probes showed (got ${/MUTATION22 (\{.*\})/.exec(outMut)?.[1] || outMut.slice(-500)})`);

    const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 20000, env: { ...process.env, MOD_URL: pathToFileURL(path.join(__dirname, 'js', 'auth-storage-native.js')).href },
    });
    const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
    assert(/MUTATION22 .*"clearCalls":0/.test(outReal) && /"sessionStillThere":true/.test(outReal),
      `[22i-control] the REAL, tracked module sweeps NOTHING on that same device and the session survives (got ${/MUTATION22 (\{.*\})/.exec(outReal)?.[1] || outReal.slice(-500)})`);

    // Breadcrumbs: the decision and its reason are both named in the log.
    assert(/\[auth-storage-native\]\[stage\] hygiene:/.test(outReal),
      `[22j] …and a hygiene breadcrumb names the decision that was taken, so a device Web Inspector session can read it in one line (got ${(/\[auth-storage-native\]\[stage\] [\w:-]+/g.exec(outReal) || ['none'])[0]})`);
    assert(!/real\.jwt\.token/.test(outReal.replace(/MUTATION22.*/g, '')),
      '[22k] …and no breadcrumb or log line carries the session value');

    const afterSrc = await readFile(path.join(__dirname, 'js', 'auth-storage-native.js'), 'utf8');
    assert(afterSrc === realSrc, '[22l] the TRACKED js/auth-storage-native.js is byte-identical after the mutation proof');
    await rm(scratch, { force: true });
    resetAll();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// [23] RG-234 — A PROTECTED WRITE THAT DOES NOT PERSIST MUST BE LOUD.
//
// Drew's decisive probe, foregrounded: `set({key:'cfbp_probe_protected',
// value:'hello', protected:true})` RESOLVED, then `exists()` ⇒ {"exists":false},
// `get()` ⇒ {} (no value, no error), and NO Face ID prompt at any point.
//
// A write that reports success and leaves nothing behind is the worst possible
// shape: supabase-js believes it has persisted a session, the marker says a
// session exists, and no later launch can find one. Two guards, one per layer:
//   — Swift: a protected SecItemAdd is READ BACK immediately (attributes-only, no
//     prompt) and set() throws if the item is not there; every add failure now
//     carries its numeric OSStatus and the OS's own message.
//   — JS: a rejected write rolls back the marker this adapter wrote a few
//     microseconds earlier, so a failed write can never leave a phantom session.
//
// NOTE FOR THE RECORD — that probe signature is ALSO exactly what the PRE-RG-232
// Swift produces: the old exists() read errSecInteractionNotAllowed as "absent",
// so get() returned nil at its presence guard BEFORE it could prompt. No prompt +
// exists:false + get {} + set ok is the stale-build signature, not necessarily a
// failed add — which is why the plugin now exposes diagnostics(), below.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[23] RG-234 — a protected write that does not persist fails LOUD, in both layers…');
{
  const MARKER = authStorageNative._MARKER_KEY_FOR_TEST;

  // ── JS layer: a rejected write leaves NO marker behind.
  {
    resetAll();
    const rejectingPlugin = {
      async set() { const e = new Error('SecItemAdd failed (-34018)'); e.code = 'otherError'; throw e; },
      async get() { return { value: null }; },
      async remove() {}, async clear() {}, async exists() { return { exists: false }; },
    };
    setNativeGlobals({ plugin: rejectingPlugin, prefs: makeFakePreferences() });
    await authStorageNative.primeNativeAuthStorage();
    const adapter = globalThis.window.__cfbpNativeAuthStorage;
    globalThis.localStorage.removeItem(MARKER);
    const sessionJson = JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    let threw = null;
    try { await adapter.setItem(MARKER, sessionJson); } catch (e) { threw = e; }
    assert(!!threw, '[23a] a Keychain write failure REJECTS — the SDK is told, never silently told nothing');
    assert(globalThis.localStorage.getItem(MARKER) === null,
      `[23b] …and the marker written synchronously a moment earlier is ROLLED BACK, so a failed write can never leave a phantom session on the device (got ${String(globalThis.localStorage.getItem(MARKER)).slice(0, 60)})`);
    assert(auth.hasValidSupabaseSession() === false, '[23c] …and hasValidSupabaseSession() correctly says nobody is signed in on this device');
    clearNativeGlobals();
  }

  // ── …except passcodeNotSet, where the session honestly works for this run.
  {
    resetAll();
    const plugin = makeFakeKeychainPlugin({ noPasscode: true });
    setNativeGlobals({ plugin, prefs: makeFakePreferences() });
    await authStorageNative.primeNativeAuthStorage();
    const adapter = globalThis.window.__cfbpNativeAuthStorage;
    globalThis.localStorage.removeItem(MARKER);
    await adapter.setItem(MARKER, JSON.stringify({ access_token: 'real.jwt.token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
    assert(auth.hasValidSupabaseSession() === true,
      '[23d] a no-passcode device keeps its marker — the session really does work for the rest of this run (DI-251 §1), so the rollback deliberately does not apply');
    assert(/passcode/i.test(String(authStorageNative.getNativeAuthStorageNotice()?.message || '')),
      '[23e] …and the player is told to set a passcode to stay signed in');
    clearNativeGlobals();
  }

  // ── Swift layer, parsed from the real tracked source (the file cannot be
  //    imported here; [19]'s own precedent is to parse it).
  {
    const swiftSrc = await readFile(SWIFT_IMPL, 'utf8');
    const setBody = swiftFuncBody(swiftSrc, 'func set(key: String, value: String, protected: Bool) throws');
    assert(!!setBody, '[23f-fixture] set()\'s body was parsed out of KeychainAuthStorage.swift');
    // (1) the two mutually-exclusive attributes are never set on the same add.
    const protectedBranch = setBody.slice(setBody.indexOf('if protected {'), setBody.indexOf('let status = SecItemAdd'));
    assert(/kSecAttrAccessControl as String\] = access/.test(protectedBranch)
      && !/addQuery\[kSecAttrAccessible as String\][^\n]*\n(?![\s\S]*?\} else)/.test(protectedBranch.split('} else')[0]),
      '[23f] the PROTECTED add sets kSecAttrAccessControl and the UNPROTECTED add sets kSecAttrAccessible — never both on one item (on a device that is errSecParam -50)');
    // (2) the guard is on SecItemAdd's OWN status — exactly one `let status =` in set().
    assert((setBody.match(/let status = /g) || []).length === 1
      && /let status = SecItemAdd\(addQuery as CFDictionary, nil\)\s*\n\s*guard status == errSecSuccess else \{/.test(setBody),
      '[23g] there is exactly ONE `status` in set() and the errSecSuccess guard tests SecItemAdd\'s own result (never a shadowed earlier status)');
    // (3) the failure carries the number AND the OS's words.
    assert(/SecItemAdd failed \(\\\(status\): \\\(Self\.statusMessage\(status\)\)\)/.test(setBody),
      '[23h] an add failure reports the numeric OSStatus and SecCopyErrorMessageString\'s own text — -50, -34018, -25308 and -25299 are four different problems');
    // (4) the write-verify, via the RG-232-correct mapping, non-prompting.
    assert(/verified = try itemStatus\(key: key\)\.present/.test(setBody)
      && /guard verified else \{/.test(setBody)
      && setBody.indexOf('Self.cacheSet(key, value)') > setBody.indexOf('guard verified else'),
      '[23i] every protected add is READ BACK immediately (attributes-only itemStatus(), which cannot prompt) and throws if the item is absent — and the value is only cached AFTER that verification');
    // (5) no access group anywhere: the app's own default group needs no entitlement.
    assert(!/kSecAttrAccessGroup/.test(swiftSrc),
      '[23j] no kSecAttrAccessGroup is ever set — the app\'s DEFAULT access group requires no keychain-access-groups entitlement, so -34018 cannot come from this code asking to share');
    // (6) the stale-build discriminator is reachable from a device probe.
    const pluginSrc23 = await readFile(SWIFT_PLUGIN, 'utf8');
    assert(/CAPPluginMethod\(name: "diagnostics", returnType: CAPPluginReturnPromise\)/.test(pluginSrc23),
      '[23k] diagnostics() is REGISTERED in pluginMethods (an unregistered @objc method is not callable from JS — a silent no-op probe)');
    assert(/ret\["build"\] = KeychainAuthStorage\.buildStamp/.test(pluginSrc23)
      && /static let buildStamp = "RG-2\d\d /.test(swiftSrc),
      '[23l] …and it echoes a build stamp, so the next device probe distinguishes "this fix is installed" from "the phone is running an older build"');
    assert(/ret\["service"\] = impl\.serviceName/.test(pluginSrc23),
      '[23m] …and the Keychain service name, because an item is only findable under the service it was written with');
    assert(!/ret\["value"\]|kSecValueData/.test(pluginSrc23.slice(pluginSrc23.indexOf('func diagnostics'), pluginSrc23.indexOf('@objc func probeVariants'))),
      '[23n] …and diagnostics() returns no key, no value and touches no Keychain item');
  }

  // ── The RG-234 DEVICE MATRIX. Drew's phone, on this very build, answers
  //    "SecItemAdd reported success but the item could not be found immediately
  //    afterwards" with no Face ID prompt — so the next step is a MEASUREMENT, and
  //    these assertions pin that the measurement is complete, honest and safe.
  {
    const swiftSrc = await readFile(SWIFT_IMPL, 'utf8');
    const pluginSrc = await readFile(SWIFT_PLUGIN, 'utf8');
    const probeBody = swiftFuncBody(swiftSrc, 'func probeVariants() -> [[String: Any]]');
    assert(!!probeBody, '[23o-fixture] probeVariants()\'s body was parsed out of KeychainAuthStorage.swift');

    // FIVE variants, so every hypothesis has its own row.
    const variantNames = (probeBody.match(/ProbeVariant\(name: "(V\d[^"]*)"/g) || []).map(m => m.slice(m.indexOf('"') + 1, -1));
    assert(variantNames.length === 5,
      `[23o] the matrix runs FIVE variants — the shipping flags, the two single-variable changes (protection class, access control), an unprotected control, and the kSecAttrSynchronizable test (got ${variantNames.length}: ${variantNames.join(' | ')})`);
    for (const [label, re] of [
      ['V1 shipping flags', /kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly[\s\S]*?useAccessControl: true/],
      ['V2 AfterFirstUnlockThisDeviceOnly + userPresence', /accessControlProtection: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/],
      ['V3 WhenPasscodeSet, no ACL', /accessible: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,\s*\n?\s*useAccessControl: false/],
      ['V4 unprotected control', /accessible: kSecAttrAccessibleAfterFirstUnlock,/],
      ['V5 no kSecAttrSynchronizable', /includeSynchronizable: false/],
    ]) assert(re.test(probeBody), `[23p:${label}] …that variant is really configured, not just named`);

    // Six measured steps per variant, INCLUDING the modern no-prompt mode — the
    // deprecated skip-UI flag itemStatus() uses today is a prime suspect, so the
    // matrix must measure its replacement alongside it, not instead of it.
    for (const [name, re] of [
      ['pre-delete', /row\["preDelete"\] = Int\(SecItemDelete/],
      ['add', /row\["add"\] = Int\(addStatus\)/],
      ['attributes, UI=Skip (what itemStatus does today)', /attrSkip\[kSecUseAuthenticationUI as String\] = kSecUseAuthenticationUISkip/],
      ['attributes, UI=Fail', /attrFail\[kSecUseAuthenticationUI as String\] = kSecUseAuthenticationUIFail/],
      ['attributes, LAContext.interactionNotAllowed (the NON-deprecated mode)', /laContext\.interactionNotAllowed = true[\s\S]*?kSecUseAuthenticationContext as String\] = laContext/],
      ['data query with UI allowed (may prompt Face ID)', /dataQuery\[kSecReturnData as String\] = true/],
      ['delete', /row\["delete"\] = Int\(SecItemDelete/],
    ]) assert(re.test(probeBody), `[23q:${name}] the matrix measures that step`);
    for (const key of ['add', 'attrSkip', 'attrFail', 'attrCtx', 'data']) {
      assert(new RegExp(`row\\["${key}Text"\\] = Self\\.statusMessage\\(`).test(probeBody),
        `[23r:${key}] …and reports the OS's own words for it alongside the number, so a raw -25300 never has to be looked up`);
    }

    // SAFETY: it can only ever touch its own accounts, and it cleans up.
    assert(/private static let probeAccountPrefix = "cfbp_probe_matrix"/.test(swiftSrc)
      && /let account = "\\\(Self\.probeAccountPrefix\)-v\\\(index \+ 1\)"/.test(probeBody),
      '[23s] every probe account name is built INSIDE the implementation from a private constant — no caller can aim this at the session key');
    assert(!/func probeVariants\([^)]+\)/.test(swiftSrc),
      '[23t] …and probeVariants() takes NO arguments at all, so there is nothing to aim');
    assert(!new RegExp('probeVariants[\\s\\S]*?' + 'cfbp_supabase_session').test(swiftSrc),
      '[23u] …and the session key never appears anywhere inside it');
    assert((probeBody.match(/SecItemDelete/g) || []).length >= 2,
      '[23v] …and each variant deletes its own row on the way out as well as before the add');

    // SECURITY: statuses and booleans only — never a stored value.
    assert(/row\["dataReturnedBytes"\] = \(dataResult as\? Data\) != nil/.test(probeBody)
      && !/String\(data: (dataResult|dataQuery)/.test(probeBody),
      '[23w] the data step reports only WHETHER bytes came back — the bytes are never decoded, returned or logged');
    const bridgeBody = pluginSrc.slice(pluginSrc.indexOf('@objc func probeVariants'), pluginSrc.indexOf('@objc func exists'));
    assert(/DispatchQueue\.global\([^)]*\)\.async/.test(bridgeBody),
      '[23x] the bridge runs it OFF the main thread — its data step can present Face ID, which blocks its caller until answered');
    assert(/CAPPluginMethod\(name: "probeVariants", returnType: CAPPluginReturnPromise\)/.test(pluginSrc),
      '[23y] …and the method is REGISTERED, so the probe is actually callable from a Web Inspector console');
    assert(/ret\["build"\] = KeychainAuthStorage\.buildStamp/.test(bridgeBody) && /ret\["service"\] = impl\.serviceName/.test(bridgeBody),
      '[23z] …and every matrix payload carries the build stamp and service name, so a relayed result can never be attributed to the wrong build');
  }
}

// ── Scratch dir cleanup ──────────────────────────────────────────────────────
// Belt to each section's own individual `rm(..., {force:true})` cleanups
// above: remove the whole tmpdir, not just the two files each section knew
// about, so nothing this file created can ever leak — regardless of which
// section it came from.
try { await rm(scratchDir, { recursive: true, force: true }); } catch { /* best-effort */ }

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
