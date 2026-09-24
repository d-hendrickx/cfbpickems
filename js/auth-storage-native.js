/**
 * js/auth-storage-native.js — Keychain-backed Supabase session storage for
 * the Munera iOS shell (DI-247, DI-251). NEW, EXCLUSIVE file — js/auth.js
 * (the Supabase thread's file) is never edited by this module beyond the
 * single, separately-tracked DI-248 injection line; every session write
 * still goes through auth.js's own client and its own onAuthStateChange
 * chain, exactly as the web PKCE flow already does (mirrors js/auth-native.js's
 * own header note).
 *
 * Loaded ONLY on native, via a dynamic `import()` in js/app.js's boot path
 * (DI-249), gated on `isNativeOrigin()` — never a static top-of-file import
 * in any file irbfootball.com serves, so it is never fetched or precached by
 * service-worker.js's STATIC_ASSETS list (off-limits to this pass) and never
 * requested on a plain web boot. Every exported function's first line is a
 * no-op check on native origin, so even a defensive direct call from a test
 * or a future caller is inert on web.
 *
 * ── K2 READER INVENTORY (coordinator, confirmed against js/auth.js on
 *    `main` + the Supabase thread's v0.23.3 additions, not yet merged) ──────
 *
 *  1. hasValidSupabaseSession() (auth.js ~:946) — reads
 *     localStorage[AUTH_STORAGE_KEY], requires access_token truthy AND
 *     expires_at in the future. DISPOSITION: correct, unaffected, AS LONG AS
 *     the marker this module writes carries a real expires_at and is
 *     refreshed on every event that could move it (TOKEN_REFRESHED,
 *     SIGNED_IN, INITIAL_SESSION) — otherwise native reads false ~1h after
 *     the last write. _attachAuthListener() below is exactly that refresh.
 *  2. hasPersistedSupabaseSession() (auth.js ~:984, v0.23.3, NOT YET on
 *     main) — same key, requires refresh_token to be a non-empty string.
 *     DISPOSITION: the marker this module writes is
 *     `{access_token:'<native-keychain>', refresh_token:'<native-keychain>',
 *     expires_at}` — both placeholders present — for parity the day that
 *     function merges.
 *  3. Removal-only call sites: the handover keep-list (auth.js ~:2784,
 *     `keep.add(AUTH_STORAGE_KEY)`), signOut()'s unconditional sweep
 *     (~:3276, ~:3286 — the `<AUTH_STORAGE_KEY>-*` prefix, the PKCE verifier
 *     family), and _clearExpiredSessionFromDevice() (~:3231-3234).
 *     DISPOSITION: all three already remove the (harmless, non-secret)
 *     marker correctly; NONE of them can reach the real Keychain item,
 *     because the real secret was never in localStorage to begin with.
 *     This module's own SIGNED_OUT handler (_attachAuthListener, below) is
 *     what clears the REAL Keychain item and any verifier keys it holds —
 *     auth.js's sweep and this module's sweep are independent, matching
 *     signOut()'s own "belt and brace, unconditional" philosophy (SEC F2/F3)
 *     rather than replacing it.
 *  4. Test hooks (auth.js ~:3395 _setStoredSessionForTest, ~:3427
 *     _AUTH_STORAGE_KEY_FOR_TEST) — production code never calls these;
 *     DISPOSITION: not a real reader, not addressed here.
 *  5. No reader outside js/auth.js reads AUTH_STORAGE_KEY, and nothing
 *     anywhere reads a user id/email/expiry FIELD out of that key — this
 *     module's own test (authstoragenativetest.mjs) greps
 *     `cfb-pickems/js` for `AUTH_STORAGE_KEY|cfbp_supabase_session` and
 *     pins the reader set to exactly js/auth.js. The marker is therefore a
 *     UI HINT ONLY: a forged marker reaches the signed-in shell's chrome,
 *     never real data — every read/write still needs the real access token
 *     under RLS. security-reviewer rules on that tradeoff; not re-litigated
 *     here.
 *
 * MARKER_KEY below is a LITERAL, not an import of auth.js's AUTH_STORAGE_KEY
 * constant — auth.js exports that constant only under a test-only name
 * (`_AUTH_STORAGE_KEY_FOR_TEST`), and this is production code, so importing
 * a "_ForTest" binding here would be the wrong seam. authstoragenativetest.mjs
 * pins that this literal stays byte-equal to auth.js's real constant, so a
 * future rename on either side goes red here instead of silently drifting.
 */
import { isNativeOrigin } from './platform.js';
import { getSupabaseClient } from './auth.js';

const MARKER_KEY = 'cfbp_supabase_session';
const NATIVE_PLACEHOLDER = '<native-keychain>';
const INSTALLED_FLAG_KEY = 'cfbp_native_installed';
const MIGRATED_FLAG_KEY = 'cfbp_native_migrated_to_keychain';
const AUTH_LISTENER_RETRY_MS = 250;
const AUTH_LISTENER_MAX_RETRIES = 20; // ~5s, bounded — never busy-loops (DI-247)

// ── K3 loud-fail slot — the sign-in gate's message-slot copy, read by
//    js/app.js's boot hook (DI-249) and never guessed at render time. ───────
let _notice = null; // { message, tone: 'notice'|'error' } | null
export function getNativeAuthStorageNotice() { return _notice; }
function _setNotice(message, tone) { _notice = { message, tone }; }
function _clearNotice() { _notice = null; }

// JS-side cache — cuts bridge round-trips for BOTH protected and unprotected
// keys. The Swift plugin already caches the decrypted PROTECTED value after
// its first auth-requiring read (DI-251 §2); this is a second, independent
// layer at the adapter boundary, primarily useful for the unprotected PKCE
// verifier keys and for proving "no redundant bridge call" in tests without
// a live Face ID prompt to count.
let _cache = new Map();

// RG-234 — true only while _migrateIfNeeded()'s own verify-then-delete sequence
// is writing through nativeSetItem(). It suppresses the synchronous marker write
// that function now does, because during migration localStorage[MARKER_KEY] still
// holds the REAL, un-migrated session and must not be replaced by a placeholder
// until the Keychain copy has been read back and verified (§2d).
let _migrationWriteInProgress = false;

// S1 (security-reviewer condition C-1, round 2) — the exact object identity
// we installed at `window.__cfbpNativeAuthStorage`, so a later check can
// tell "this is ours" from "something else got there first."
let _ourAdapterSingleton = null;

function _plugin() {
  return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins
    && window.Capacitor.Plugins.KeychainAuthStorage) || null;
}
function _preferences() {
  return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins
    && window.Capacitor.Plugins.Preferences) || null;
}

/** supabase-js's own naming convention for PKCE artefacts is
 *  `<storageKey>-code-verifier` / `<storageKey>-flow-<id>-code-verifier`
 *  (verified against the vendored SDK, DI-247 §2b). Only the main session
 *  key is Face-ID-protected — protecting the short-lived verifier would add
 *  an unwanted second prompt mid-sign-in, before there is a session to
 *  protect at all. */
function _isProtectedKey(key) { return !/code-verifier/.test(String(key)); }

// ── RG-234 (2026-09-23, bug B-e part 3) — EVERY plugin call is bounded ──────
// A Capacitor plugin call is a message across the JS↔Swift bridge. It normally
// returns in milliseconds, but it is not guaranteed to return at all: an
// access-controlled SecItemAdd can block inside ACL evaluation, and a wedged
// bridge simply never calls back. supabase-js AWAITS our setItem() (its own
// helper is `async (s,k,v) => { await s.setItem(k, JSON.stringify(v)) }`), so an
// unbounded plugin call here does not fail — it silently becomes a hang inside
// signInWithOAuth(), i.e. a frozen sign-in gate. Ten seconds is far longer than
// any real Keychain round trip that does not involve a Face ID prompt, and the
// protected item's prompt is human-paced but still presented promptly.
const DEFAULT_KEYCHAIN_CALL_TIMEOUT_MS = 10000;
let _keychainCallTimeoutMs = DEFAULT_KEYCHAIN_CALL_TIMEOUT_MS;
/** The DISTINCT code a timed-out bridge call throws, so every caller can tell
 *  "the Keychain said no" from "the Keychain said nothing at all." */
const KEYCHAIN_TIMEOUT_CODE = 'keychain-timeout';

/** RG-234 (d) — stage breadcrumbs. NAMES ONLY: never a key's value, never a
 *  token, never an OSStatus. With Safari's Web Inspector attached to the device,
 *  these turn "the session vanished somewhere at boot" into one line naming the
 *  decision that was taken. console.warn (not log/info) so they survive at the
 *  default filter level a device inspector session opens with. */
function _stage(name) {
  try { console.warn('[auth-storage-native][stage] ' + name); } catch { /* never let logging break a boot */ }
}

/**
 * Runs one plugin call under the bound. Rejects with an Error whose `.code` is
 * KEYCHAIN_TIMEOUT_CODE when the bound wins, so nativeGetItem()/nativeSetItem()
 * classify it exactly like any other plugin failure instead of hanging their
 * caller. A late settle afterward is ignored (`done`), and never reaches the
 * cache — a write we could not confirm must not look confirmed.
 * `op` is a METHOD NAME ONLY ('get'/'set'/'remove') — never a key, never a value.
 */
function _boundedPluginCall(call, op) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.error('[auth-storage-native] Keychain bridge call did not return within the bound', op);
      const e = new Error(KEYCHAIN_TIMEOUT_CODE);
      e.code = KEYCHAIN_TIMEOUT_CODE;
      reject(e);
    }, _keychainCallTimeoutMs);
    let p;
    try { p = Promise.resolve(call()); }
    catch (err) { done = true; clearTimeout(timer); reject(err); return; }
    p.then(
      v => { if (done) return; done = true; clearTimeout(timer); resolve(v); },
      err => { if (done) return; done = true; clearTimeout(timer); reject(err); },
    );
  });
}

// ── The three methods supabase-js's `auth.storage` option calls (DI-247 §2b,
//    verified against vendor/supabase-js-2.116.0.js's H/U/W helpers) ────────

async function nativeGetItem(key) {
  if (_cache.has(key)) return _cache.get(key);
  const plugin = _plugin();
  if (!plugin) {
    _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
    console.error('[auth-storage-native] KeychainAuthStorage plugin unreachable (getItem)');
    return null; // loud-fail: absence to the caller, never a localStorage fallback
  }
  try {
    const res = await _boundedPluginCall(() => plugin.get({ key }), 'get'); // RG-234
    const value = (res && typeof res.value === 'string') ? res.value : null;
    if (value !== null) _cache.set(key, value);
    return value;
  } catch (err) {
    const code = (err && err.code) || '';
    // DI-251 §4 — the four distinguishable outcomes, each with its own
    // visible result. "notFound" never reaches here (the plugin resolves
    // {value:null}, never throws, for absence — KeychainAuthStorage.swift's
    // get()); everything below is a genuine throw.
    if (code === 'userCancelled') _setNotice('Sign-in unlock was cancelled.', 'notice');
    else if (code === 'authFailed') _setNotice("Couldn't verify it's you — please sign in again.", 'error');
    else if (code === 'passcodeNotSet') _setNotice('Set a passcode on this iPhone to stay signed in.', 'notice');
    // RG-234 — a bridge call that never came back. Same player-facing outcome as
    // any other read failure (K3's otherError copy), spelled out as its own
    // branch so the distinction is visible in the log and pinned by a test.
    else if (code === KEYCHAIN_TIMEOUT_CODE) _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
    else _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error'); // K3's exact copy
    console.error('[auth-storage-native] Keychain read failed', code, err);
    return null; // NEVER falls back to localStorage — absence to the caller.
  }
}

async function nativeSetItem(key, value) {
  // ══ RG-234 (2026-09-23, Drew's iPhone, bug B-e part 3) — THE MARKER IS
  //    WRITTEN HERE, SYNCHRONOUSLY, BEFORE THE FIRST AWAIT ═══════════════════
  //
  // Drew's device console showed a sign-in that COMPLETED — deep link, exchange,
  // Keychain write, SIGNED_IN, memberships, hydrate — while the screen still had
  // the gate on it saying "Connecting to Google…". The reason: app.js's
  // session-event handler decides `signedIn` from hasValidSupabaseSession()
  // (js/auth.js), which reads localStorage[MARKER_KEY] synchronously, and on
  // native that marker was written by this module's OWN onAuthStateChange
  // subscriber — a SECOND subscriber, added AFTER js/auth.js's internal one, so
  // the SDK notified auth.js (and through it app.js) FIRST, while the marker was
  // still absent or stale. The gate's own re-show guard then kept the stale
  // overlay in place, and no later event retried (MEMBERSHIPS_REFRESHED is not in
  // app.js's AUTH_SESSION_EVENTS).
  //
  // A listener-order bug cannot be fixed by reordering listeners; it is fixed by
  // removing the ordering dependency. The vendored SDK persists the session
  // through THIS function and AWAITS it before it notifies anyone:
  //   `_saveSession()`: `await H(this.storage, this.storageKey, r)`   (:190402)
  //   `H = async (e,t,n) => { await e.setItem(t, JSON.stringify(n)) }` (:115443)
  //   `_exchangeCodeForSession()`: `await this._saveSession(t.session),
  //                                 await this._notifyAllSubscribers('SIGNED_IN'…)`
  //                                                                   (:166083)
  // So a marker written synchronously at the TOP of this function is already in
  // localStorage before any subscriber — in any order — can run. The event
  // subscriber below stays as belt-and-braces (it is what keeps expires_at fresh
  // on a TOKEN_REFRESHED the SDK serves from memory).
  //
  // What is written is still ONLY the non-secret placeholder marker — never the
  // real access/refresh token (DI-247 §2c). The migration path is excluded: it
  // calls this function with a REAL, un-migrated session still sitting in
  // localStorage[MARKER_KEY], and overwriting that with a placeholder before the
  // read-back has verified the Keychain copy would destroy the only surviving
  // copy of the session (§2d).
  let markerWrittenByThisCall = false;
  if (key === MARKER_KEY && !_migrationWriteInProgress && _isRealSessionValue(value)) {
    let expiresAt = 0;
    try { expiresAt = Number(JSON.parse(value)?.expires_at) || 0; } catch { /* _isRealSessionValue already parsed it; belt */ }
    _writeMarker(expiresAt);
    markerWrittenByThisCall = true;
  }
  const plugin = _plugin();
  if (!plugin) {
    console.error('[auth-storage-native] KeychainAuthStorage plugin unreachable (setItem)');
    throw new Error('KeychainAuthStorage plugin unreachable');
  }
  try {
    await _boundedPluginCall(() => plugin.set({ key, value, protected: _isProtectedKey(key) }), 'set'); // RG-234
    _cache.set(key, value);
    // RG-234 (d) — stage breadcrumb, NAME ONLY (never the key's value, never the
    // verifier itself). This is the one observable "the PKCE verifier reached
    // storage" point from the app's side of the vendored SDK.
    _stage(_isProtectedKey(key) ? 'session-stored' : 'verifier-stored');
  } catch (err) {
    const code = (err && err.code) || '';
    // RG-234 — THE MARKER MUST NOT OUTLIVE A FAILED WRITE. The synchronous write
    // above happens BEFORE the plugin call, which is what makes it visible to the
    // SDK's subscribers; the cost is that a write that then FAILS would leave a
    // marker claiming a session this device never persisted — a phantom session,
    // the exact class of thing CLAUDE.md's loud-fail rule exists to prevent. Rolled
    // back here, for every failure EXCEPT passcodeNotSet (below), where the session
    // genuinely does work for the rest of this run and the marker is honest.
    if (markerWrittenByThisCall && code !== 'passcodeNotSet') _clearMarker();
    if (code === 'passcodeNotSet') {
      // DI-251 §1 — the item is NOT persisted; the session still works for
      // THIS run (JS memory + this in-process cache hold it), but never
      // falls back to storing it unprotected (plain Keychain or
      // localStorage) — that would be the exact silent downgrade condition
      // 9 exists to prevent.
      _setNotice('Set a passcode on this iPhone to stay signed in.', 'notice');
      _cache.set(key, value);
      console.warn('[auth-storage-native] no device passcode — session not persisted to Keychain this run', err);
      return;
    }
    console.error('[auth-storage-native] Keychain write failed', code, err);
    // RG-234 — a timed-out write lands here too, and deliberately does NOT
    // populate `_cache`: supabase-js awaits this call, so the throw surfaces as
    // signInWithOAuth() rejecting, and nothing anywhere believes the PKCE
    // verifier was stored when it may not have been.
    throw err; // a write failure is not "absence" — let the SDK see it.
  }
}

async function nativeRemoveItem(key) {
  // RG-234 — the mirror image of nativeSetItem()'s synchronous marker write, and
  // for the same reason: the SDK's `_removeSession()` awaits `removeItem` BEFORE
  // it notifies SIGNED_OUT, so clearing the marker here makes "is there a session
  // on this device?" answer correctly to every listener regardless of order. The
  // event subscriber below still clears it too (belt-and-braces, matching
  // signOut()'s own philosophy).
  if (key === MARKER_KEY) _clearMarker();
  _cache.delete(key);
  const plugin = _plugin();
  if (!plugin) return;
  try { await _boundedPluginCall(() => plugin.remove({ key }), 'remove'); } catch (err) { // RG-234
    console.warn('[auth-storage-native] Keychain remove failed', err);
  }
}

// ── The synchronous, non-secret marker (DI-247 §2c) ─────────────────────────

function _writeMarker(expiresAt) {
  try {
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      access_token: NATIVE_PLACEHOLDER,
      refresh_token: NATIVE_PLACEHOLDER,
      expires_at: expiresAt,
    }));
  } catch (e) { console.warn('[auth-storage-native] could not write the marker', e); }
}
function _clearMarker() {
  try { localStorage.removeItem(MARKER_KEY); } catch {}
}
/** True when `raw` (a localStorage[MARKER_KEY] value) is a REAL,
 *  un-migrated session — not our own placeholder marker, not garbage, not
 *  empty. Shared by _migrateIfNeeded() (decides whether there is anything to
 *  migrate) and _clearMarker-adjacent call sites below (decides whether it
 *  is SAFE to clear this slot). */
function _isRealSessionValue(raw) {
  if (!raw) return false;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return false; }
  return !!parsed && typeof parsed.access_token === 'string'
    && parsed.access_token !== NATIVE_PLACEHOLDER && parsed.access_token.length > 0;
}
/**
 * A guarded _clearMarker(): if a migration write earlier in THIS SAME
 * primeNativeAuthStorage() call failed and deliberately left the REAL,
 * un-migrated session sitting in localStorage[MARKER_KEY] (§2d — refusing to
 * delete an unverified write), a later step finding "nothing in Keychain"
 * must NOT wipe that slot — that would destroy the only surviving copy of
 * the session over a transient Keychain failure. Leaving it in place also
 * costs nothing extra: it is the exact pre-Keychain shape
 * hasValidSupabaseSession() already reads correctly, so the device simply
 * behaves as it did before this migration existed until a later boot's
 * migration attempt can succeed.
 */
function _clearMarkerUnlessRealSession() {
  let current = null;
  try { current = localStorage.getItem(MARKER_KEY); } catch { /* nothing to protect */ }
  if (_isRealSessionValue(current)) {
    console.warn('[auth-storage-native] Keychain has no session but localStorage still holds an un-migrated real session (a prior migration write likely failed) — leaving it in place rather than destroying the only surviving copy');
    return;
  }
  _clearMarker();
}

// ── Delete+reinstall hygiene (DI-247 §2d, "App delete/reinstall") ──────────
// Keychain items can outlive app deletion. A UserDefaults-backed
// (the Preferences plugin) "installed" flag survives ONLY as long as the app
// data does — a delete+reinstall resets it — so an unset flag on this launch
// means "the Keychain items on this device may belong to a previous install
// of THIS app" and every one of them is cleared before anything else runs.
//
// ══ RG-234 (2026-09-23, Drew's iPhone, bug B-e part 3) — THIS FUNCTION COULD
//    DELETE DREW'S SESSION ON EVERY COLD LAUNCH ══════════════════════════════
//
// Drew's third device fact: after a relaunch, `exists({key:'cfbp_supabase_session'})`
// answered `{"exists":false}` and `get()` returned no value — the protected item
// that had been written successfully at sign-in was GONE — while the localStorage
// marker was still there. `plugin.clear()` is the only call in this codebase that
// deletes the whole Keychain service (KeychainAuthStorage.swift's clear() is a
// SecItemDelete by kSecAttrService alone), and outside signOut() this is its only
// caller. So this is the suspect, and the pre-fix control flow makes it a live one:
//
//   let installed = (r && typeof r.value === 'string') ? r.value : null;
//   …
//   if (installed === '1') return;
//   try { await plugin.clear(); } …
//
// EVERY answer that is not literally the string '1' fell through to clear(): a
// plugin returning `{}`, `undefined`, a non-string, or a `prefs.set` that silently
// failed to persist. In all of those the flag never becomes '1', so the sweep does
// not run once — it runs on EVERY launch, wiping the session each time, and the
// localStorage marker survives because clear() only touches the Keychain. That is
// exactly the three symptoms Drew reported, from one mechanism.
//
// The fix is to make the destructive branch the hardest one to reach, not the
// easiest (RG-12's rule: a sweep must refuse when it is not certain):
//   (A) the flag read is TRI-STATE. Only a definite, well-formed "absent" is
//       allowed to proceed; an unreadable/odd-shaped answer means UNKNOWN, and
//       unknown never deletes.
//   (B) localStorage is an INDEPENDENT witness, and a better one than the flag: a
//       genuine delete+reinstall takes the WKWebView data store with it, so
//       anything sitting in the marker slot is proof this is not a fresh install.
//       (Checked as "the slot is non-empty", not "the marker parses" — a corrupt
//       marker is still evidence the web store survived.)
//   (C) the flag is persisted AND READ BACK BEFORE anything is deleted. The sweep
//       may only run once it has proved it will not run again. On a device where
//       Preferences cannot persist — the wipe-every-launch case — that proof fails
//       and nothing is ever deleted.
// The sweep's original purpose is intact: an orphan Keychain item from a previous
// install arrives with an EMPTY web store and no flag, which is still (A)+(B)+(C)
// clean and still sweeps once. Deliberately NOT guarded on `exists()` of the
// session key: after a true delete+reinstall the orphan item IS present, so that
// check would only cancel the sweep in precisely the case it exists for.
async function _hygieneCheckOnFirstLaunch() {
  const prefs = _preferences();
  const plugin = _plugin();
  if (!prefs || !plugin) {
    _stage('hygiene:skip-no-plugin');
    console.warn('[auth-storage-native] Preferences or Keychain plugin unreachable — skipping delete/reinstall hygiene check this run');
    return;
  }
  // (A) TRI-STATE: 'present' | 'absent' | 'unknown'. Anything we cannot read as a
  // definite answer is 'unknown', and 'unknown' never sweeps.
  let flag = 'unknown';
  try {
    const r = await _boundedPluginCall(() => prefs.get({ key: INSTALLED_FLAG_KEY }), 'prefs-get');
    if (r && typeof r.value === 'string' && r.value.length > 0) flag = 'present';
    else if (r && typeof r === 'object' && 'value' in r) flag = 'absent'; // the Preferences contract for "no such key" is {value:null}
  } catch (e) {
    console.warn('[auth-storage-native] Preferences read failed (installed flag)', e);
  }
  if (flag === 'present') { _stage('hygiene:skip-already-installed'); return; }
  if (flag === 'unknown') {
    _stage('hygiene:skip-flag-unreadable');
    console.error('[auth-storage-native] could not read the installed flag as a definite answer — refusing to sweep the Keychain (an unknown answer must never delete a session)');
    return;
  }
  // (B) The independent witness.
  let markerSlot = null;
  try { markerSlot = localStorage.getItem(MARKER_KEY); } catch { markerSlot = null; }
  if (markerSlot !== null) {
    _stage('hygiene:skip-web-store-survived');
    console.warn('[auth-storage-native] the installed flag is absent but the web store still holds a session slot — this is not a fresh install, so the Keychain is NOT swept; recording the flag instead');
    try { await _boundedPluginCall(() => prefs.set({ key: INSTALLED_FLAG_KEY, value: '1' }), 'prefs-set'); }
    catch (e) { console.warn('[auth-storage-native] could not persist the installed flag', e); }
    return;
  }
  // (C) Prove the flag sticks BEFORE deleting anything.
  let persisted = false;
  try {
    await _boundedPluginCall(() => prefs.set({ key: INSTALLED_FLAG_KEY, value: '1' }), 'prefs-set');
    const back = await _boundedPluginCall(() => prefs.get({ key: INSTALLED_FLAG_KEY }), 'prefs-get');
    persisted = !!(back && back.value === '1');
  } catch (e) {
    console.warn('[auth-storage-native] could not persist/verify the installed flag', e);
  }
  if (!persisted) {
    _stage('hygiene:skip-flag-not-verified');
    console.error('[auth-storage-native] the installed flag did not read back as persisted — refusing to sweep the Keychain, because a sweep we cannot record is a sweep that repeats on every launch');
    return;
  }
  _stage('hygiene:clear-fresh-install');
  try { await _boundedPluginCall(() => plugin.clear(), 'clear'); } catch (e) {
    console.warn('[auth-storage-native] hygiene clear() failed', e);
  }
}

// ── One-time localStorage→Keychain migration (DI-247 §2d, "First run after
//    upgrade") ───────────────────────────────────────────────────────────
async function _migrateIfNeeded() {
  const prefs = _preferences();
  if (prefs) {
    try {
      const r = await _boundedPluginCall(() => prefs.get({ key: MIGRATED_FLAG_KEY }), 'prefs-get');
      if (r && r.value === '1') { _stage('migration:skip-already-migrated'); return; } // already migrated, once, ever
    } catch (e) {
      console.warn('[auth-storage-native] Preferences read failed (migration flag)', e);
    }
  }

  let raw = null;
  try { raw = localStorage.getItem(MARKER_KEY); } catch { /* nothing to migrate */ }
  if (!_isRealSessionValue(raw)) { _stage('migration:nothing-to-migrate'); return; } // marker, garbage, or empty

  const plugin = _plugin();
  if (!plugin) { _stage('migration:skip-no-plugin'); return; } // can't migrate without the plugin; leave localStorage alone

  // Don't clobber an item Keychain already has. exists() never prompts.
  //
  // RG-232 (2026-09-23) — this used to `catch { /* treat as absent */ }`. That
  // shared the device bug's own failure direction: a Keychain that answers
  // "I can't tell you" (the plugin now REJECTS on an unexpected OSStatus
  // instead of quietly saying `false`) was read as "there is nothing here",
  // and migration would then overwrite a real, protected Keychain session with
  // whatever stale copy localStorage happened to hold. An unknown answer now
  // ABORTS the migration for this boot, leaving BOTH copies untouched — the
  // same "never destroy the only surviving copy" stance as §2d below.
  let already = false;
  try {
    const r = await plugin.exists({ key: MARKER_KEY });
    already = !!(r && r.exists);
  // NOTE — nothing may be inserted between `} catch (e) {` and the console.warn
  // below, and the RG-234 breadcrumb therefore goes after it:
  // authstoragenativetest.mjs [20d] anchors its RG-232 mutation proof on exactly
  // that adjacency, and an insertion there silently turns that RED-proof vacuous.
  } catch (e) {
    console.warn('[auth-storage-native] could not determine whether Keychain already holds a session — deferring migration rather than risking an overwrite', e);
    _stage('migration:defer-exists-unknown');
    return;
  }
  if (already) {
    _stage('migration:skip-keychain-already-holds-one');
    if (prefs) { try { await prefs.set({ key: MIGRATED_FLAG_KEY, value: '1' }); } catch { /* best-effort */ } }
    return;
  }

  try {
    // RG-234 — see nativeSetItem()'s own note: this ONE write must not trigger
    // the synchronous marker write, because the localStorage slot it would
    // overwrite still holds the only verified copy of the session. Cleared on the
    // very next line, and again in this block's own catch below, so no later call
    // can inherit it. (Deliberately NOT wrapped in an inner try/finally: the
    // nativeSetItem() call below is load-bearing text for an existing mutation
    // proof — authstoragenativetest.mjs [12b] rewrites that exact line — and
    // re-indenting it would silently turn that RED-proof vacuous.)
    _migrationWriteInProgress = true;
    await nativeSetItem(MARKER_KEY, raw);
    _migrationWriteInProgress = false; // RG-234 — the guarded window ends here
    // S2 (security-reviewer condition C-3, round 2) — `bypassCache: true`
    // forces the plugin to re-query SecItemCopyMatching for real, rather
    // than answer from the very in-memory cache nativeSetItem() above just
    // populated optimistically. Without this, a write whose SecItemAdd
    // never actually persisted would still "verify" successfully against
    // the cache, and the localStorage copy below would be deleted over a
    // session that only ever existed in memory. Deliberately calling
    // `plugin.get` directly here, not `nativeGetItem` — the JS-side cache
    // (`_cache`) would defeat this exact proof the same way the Swift
    // cache would (mutation-proved: see authstoragenativetest.mjs).
    const readBack = await plugin.get({ key: MARKER_KEY, bypassCache: true }).catch(() => null);
    if (!readBack || readBack.value !== raw) {
      _stage('migration:write-unverified');
      console.error('[auth-storage-native] migration write did not verify — refusing to delete the localStorage copy');
      _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
      return;
    }
    try { localStorage.removeItem(MARKER_KEY); } catch { /* fall through to verify, which will fail loudly */ }
    let stillThere = null;
    try { stillThere = localStorage.getItem(MARKER_KEY); } catch (e) { stillThere = raw; /* fail closed: assume NOT deleted */ }
    if (stillThere !== null) {
      console.error('[auth-storage-native] localStorage delete after migration did not verify — refusing to trust either copy');
      _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
      _cache.delete(MARKER_KEY); // don't trust our own just-written Keychain copy either
      return;
    }
    if (prefs) { try { await prefs.set({ key: MIGRATED_FLAG_KEY, value: '1' }); } catch { /* best-effort */ } }
    _stage('migration:verified');
    console.info('[auth-storage-native] migrated the pre-Keychain session to Keychain and verified the localStorage delete');
  } catch (e) {
    _migrationWriteInProgress = false; // RG-234 — never leak the guard out of a throw
    console.error('[auth-storage-native] migration failed', e);
    _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
  }
}

// ── Boot-time marker prime (DI-247 §2c part 1) ──────────────────────────────
async function _primeMarkerFromKeychain() {
  const plugin = _plugin();
  if (!plugin) {
    _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
    _clearMarkerUnlessRealSession(); // a failed earlier migration may have left the real session here
    return;
  }
  const raw = await nativeGetItem(MARKER_KEY); // K3 mapping already applied on throw, inside nativeGetItem
  if (!raw) { _clearMarkerUnlessRealSession(); return; } // (a) no item — ordinary signed-out state, NO message (DI-251 §4a)
  let session = null;
  try { session = JSON.parse(raw); } catch (e) {
    console.error('[auth-storage-native] stored session was not valid JSON', e);
    _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
    _clearMarkerUnlessRealSession();
    return;
  }
  const expiresAt = Number(session && session.expires_at) || 0;
  _writeMarker(expiresAt);
  // Deliberately NOT calling _clearNotice() here. primeNativeAuthStorage()
  // already clears the notice ONCE, at the very top of the whole sequence —
  // a second clear here would silently erase a genuine failure
  // _migrateIfNeeded() set moments earlier in the SAME call (e.g. "migration
  // write did not verify") just because this later step then found a usable
  // cached value. A real problem stays visible for the rest of this boot
  // rather than being papered over by whichever step happens to run last.
}

// ── Ongoing sync (DI-247 §2c part 2) — a SECOND, independent subscriber on
//    the SAME client auth.js already owns (its own doc comment at :822-826
//    permits a second listener; the ban is on a second createClient()). ────
let _listenerAttached = false;
let _retryTimer = null;
function _attachAuthListener() {
  if (_listenerAttached) return;
  const client = getSupabaseClient();
  if (!client) {
    if (_retryTimer) return;
    let attempts = 0;
    _retryTimer = setInterval(() => {
      attempts += 1;
      const c = getSupabaseClient();
      if (c) {
        clearInterval(_retryTimer);
        _retryTimer = null;
        _attachAuthListener();
      } else if (attempts >= AUTH_LISTENER_MAX_RETRIES) {
        clearInterval(_retryTimer);
        _retryTimer = null;
        console.warn('[auth-storage-native] gave up waiting for the Supabase client to attach the marker-sync listener (never busy-looped)');
      }
    }, AUTH_LISTENER_RETRY_MS);
    return;
  }
  _listenerAttached = true;
  try {
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        _clearMarker();
        nativeRemoveItem(MARKER_KEY).catch(() => {});
        for (const key of Array.from(_cache.keys())) {
          if (/code-verifier/.test(key)) nativeRemoveItem(key).catch(() => {});
        }
        const plugin = _plugin();
        if (plugin) plugin.clear().catch(() => {}); // belt-and-brace, matches signOut()'s own philosophy
      } else if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
        _writeMarker(Number(session.expires_at) || 0);
      }
    });
  } catch (e) { console.warn('[auth-storage-native] onAuthStateChange wiring failed', e); }
}

/**
 * S1 (security-reviewer condition C-1, round 2) — installs the adapter as a
 * FROZEN object under a NON-WRITABLE, NON-CONFIGURABLE property, and fails
 * CLOSED rather than silently trusting or overwriting anything already
 * sitting at that name:
 *   - If `window.__cfbpNativeAuthStorage` does not yet exist: freeze a fresh
 *     adapter object (a script that runs later cannot mutate its methods)
 *     and install it via `Object.defineProperty` (a script that runs later
 *     cannot reassign or delete the binding either — the auth.js line reads
 *     the SAME object for the life of the page).
 *   - If it already exists and IS the object we installed earlier in this
 *     same process (re-entrant call): treat as already-installed, proceed.
 *   - If it already exists and is NOT ours (a pre-planted value from
 *     anywhere else — a hypothetical, but this branch is what condition C-1
 *     exists to close): refuse. Do not use it, do not overwrite it, and — the
 *     failure direction that matters — do not let the caller believe a
 *     native adapter is usable.
 * Returns true only when a genuinely-ours, frozen adapter is confirmed
 * installed at that property.
 */
function _installAdapterOrFailClosed() {
  const existingDescriptor = Object.getOwnPropertyDescriptor(window, '__cfbpNativeAuthStorage');
  if (existingDescriptor) {
    if (existingDescriptor.value === _ourAdapterSingleton && _ourAdapterSingleton !== null) {
      return true; // already installed by an earlier call in this same process
    }
    console.error('[auth-storage-native] window.__cfbpNativeAuthStorage already exists and is not the adapter this module installed — refusing to use it or overwrite it');
    return false;
  }
  const adapter = Object.freeze({
    getItem: nativeGetItem,
    setItem: nativeSetItem,
    removeItem: nativeRemoveItem,
  });
  try {
    Object.defineProperty(window, '__cfbpNativeAuthStorage', {
      value: adapter,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch (e) {
    console.error('[auth-storage-native] could not install the adapter property', e);
    return false;
  }
  _ourAdapterSingleton = adapter;
  return true;
}

// ── The one exported entry point (DI-249's boot hook calls this) ───────────
export async function primeNativeAuthStorage() {
  if (!isNativeOrigin()) return; // true no-op on web — zero awaits taken above this line
  _clearNotice();
  const plugin = _plugin();
  if (!plugin) {
    console.error('[auth-storage-native] window.Capacitor.Plugins.KeychainAuthStorage is unreachable on a native origin');
    _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
    _clearMarkerUnlessRealSession(); // never destroy a real, un-migrated session sitting in this slot
    return;
  }
  if (!_installAdapterOrFailClosed()) {
    // S1 — fail closed: nothing usable is installed, K3's otherError copy
    // (the same "couldn't read your saved sign-in" gate message — this is
    // functionally a read failure from the caller's point of view).
    _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
    _clearMarkerUnlessRealSession();
    return;
  }
  try {
    await _hygieneCheckOnFirstLaunch(); // MUST run before migration (§2d)
    await _migrateIfNeeded();
    await _primeMarkerFromKeychain();
  } catch (e) {
    // Defensive only — every internal step above already catches its own
    // failures and routes them into _notice rather than throwing. A throw
    // reaching here is unexpected; treat it exactly like a genuine read
    // error rather than let it propagate and crash boot() (DI-249).
    console.error('[auth-storage-native] prime failed', e);
    _setNotice("Couldn't read your saved sign-in. Please sign in again.", 'error');
    _clearMarker();
  }
  _attachAuthListener(); // client is very likely still null here (the SDK
    // hasn't loaded yet at this point in boot) — retries internally, bounded.
}

// ── Test hooks (mirrors js/auth.js's _resetAuthForTest() precedent —
//    production code never calls these) ────────────────────────────────────
export function _resetAuthStorageNativeForTest({
  keychainCallTimeoutMs = DEFAULT_KEYCHAIN_CALL_TIMEOUT_MS, // RG-234 — shrinkable so a RED-proof needn't wait 10s
} = {}) {
  _keychainCallTimeoutMs = keychainCallTimeoutMs;
  _migrationWriteInProgress = false; // RG-234
  _notice = null;
  _cache = new Map();
  _listenerAttached = false;
  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
  _ourAdapterSingleton = null;
  // S1 — once installed, the property is non-configurable by design, so
  // `delete` can throw in strict-mode ES module code. Harmless here: every
  // fixture that needs a truly clean slate discards the whole `window`
  // object afterward (this suite's own clearNativeGlobals()); this is a
  // best-effort courtesy for fixtures that reuse the same window.
  try { delete globalThis.window.__cfbpNativeAuthStorage; } catch { /* non-configurable once installed, or no window at all */ }
}
/** S1 test hook — lets authstoragenativetest.mjs plant a value at the
 *  adapter's property name BEFORE calling primeNativeAuthStorage(), to
 *  prove the fail-closed "not ours" branch without needing a real second
 *  script. Production code never calls this. */
export function _plantAdapterPropertyForTest(value) {
  Object.defineProperty(globalThis.window, '__cfbpNativeAuthStorage', {
    value, writable: true, configurable: true, enumerable: false,
  });
}
export const _KEYCHAIN_TIMEOUT_CODE_FOR_TEST = KEYCHAIN_TIMEOUT_CODE;
export const _DEFAULT_KEYCHAIN_CALL_TIMEOUT_MS_FOR_TEST = DEFAULT_KEYCHAIN_CALL_TIMEOUT_MS;
export const _MARKER_KEY_FOR_TEST = MARKER_KEY;
export const _NATIVE_PLACEHOLDER_FOR_TEST = NATIVE_PLACEHOLDER;
export const _INSTALLED_FLAG_KEY_FOR_TEST = INSTALLED_FLAG_KEY;
export const _MIGRATED_FLAG_KEY_FOR_TEST = MIGRATED_FLAG_KEY;
export { nativeGetItem as _nativeGetItemForTest, nativeSetItem as _nativeSetItemForTest, nativeRemoveItem as _nativeRemoveItemForTest };
export function _attachAuthListenerForTest() { return _attachAuthListener(); }
export function _isAuthListenerAttachedForTest() { return _listenerAttached; }
