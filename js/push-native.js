/**
 * js/push-native.js — native (Capacitor/iOS) push, DI-217/DI-239/DI-240/DI-241.
 *
 * LOADED ONLY BY DYNAMIC IMPORT ON NATIVE (app.js gates every `import('./push-
 * native.js')` behind `isNativeShell()`/`isNativeOrigin()`). Never statically
 * imported anywhere — `service-worker.js`'s STATIC_ASSETS is NOT edited in
 * this pass (noted as a follow-up for the next web release so this module
 * precaches; on native it ships bundled inside the app anyway, so there is
 * nothing to precache there).
 *
 * ZERO top-level side effects, same discipline as js/platform.js/js/brand.js.
 * Reaches the plugin ONLY via the Capacitor-injected runtime global
 * `window.Capacitor.Plugins.OneSignalCapacitor` — never `import
 * '@onesignal/...'` (AD-65's boundary; `boundarytest.mjs` greps for it under
 * cfb-pickems/ and must stay 0).
 *
 * ── WHY `OneSignalCapacitor`, NOT `OneSignal` (spike Finding 1) ────────────
 * DI-217 originally assumed the reachable global was `window.Capacitor.
 * Plugins.OneSignal`. `SPIKE_RESULT_PUSH.md` read the shipped Swift plugin
 * (`OneSignalCapacitorPlugin.swift`) and confirmed `jsName = "OneSignalCapacitor"`
 * — `window.Capacitor.Plugins.OneSignal` is `undefined`. The friendly
 * `OneSignal.login()`/`.Notifications.*` surface DI-217 modeled the reach on
 * is the JS WRAPPER class (`dist/index.js`) — never imported here (AD-65) —
 * so every call below uses the FLAT raw plugin methods the wrapper itself
 * calls, confirmed against the plugin's own `dist/index.d.ts` (the
 * `OneSignalCapacitorPlugin` raw interface, not the `OneSignalAPI` wrapper
 * interface) and the shipped Swift source's `pluginMethods`/`notifyListeners`
 * calls:
 *
 *   initialize({ appId })                    -> Promise<void>
 *   login({ externalId })                    -> Promise<void>
 *   logout()                                 -> Promise<void>
 *   permissionNative()                       -> Promise<{ permission: 0|1|2|3|4 }>
 *     (OSNotificationPermission: 0 NotDetermined, 1 Denied, 2 Authorized,
 *      3 Provisional, 4 Ephemeral — read from the plugin's own .d.ts)
 *   requestPermission({ fallbackToSettings }) -> Promise<{ permission: boolean }>
 *   addListener('notificationForegroundWillDisplay', cb) — cb receives the
 *     OSNotification JSON FLAT (additionalData, notificationId, ... at the
 *     top level) — confirmed from `onWillDisplay()`'s
 *     `notifyListeners("notificationForegroundWillDisplay", data: json)`
 *     where `json = event.notification.stringify()`.
 *   proceedWithWillDisplay({ notificationId })
 *   addListener('notificationClick', cb) — cb receives
 *     `{ result: {actionId?, url?}, notification: OSNotification }` — NESTED
 *     under `.notification`, confirmed from `onClick()`'s
 *     `notifyListeners("notificationClick", data: json, retainUntilConsumed: true)`
 *     where `json = event.stringify()` (the whole click event, not just the
 *     notification). `retainUntilConsumed: true` means Capacitor itself
 *     buffers a cold-start tap until this module's `addListener()` call
 *     attaches — the module-level ready-gate below is an extra safety net
 *     for the narrower window between that `addListener()` call resolving
 *     and the app's own boot having painted a tab to navigate onto, not a
 *     substitute for it.
 *
 * ── WHY `initialize()` IS DEFERRED TO THE SESSION CHOKEPOINT, NOT BOOT
 *    (spike Finding 2 — a real amendment to DI-217/DI-240's original wiring) ──
 * `OneSignalCapacitor.initialize({appId})` ALONE — no login, no
 * requestPermission — auto-prompts the OS permission sheet within ~2s, with
 * no exposed switch to stop it (no `setAutoPrompt`/`promptOptions` in this
 * plugin version, unlike the web SDK's `promptOptions:{autoPrompt:false}`
 * that `js/push-onesignal.js` already relies on). So `initNativePush()` is
 * called from `app.js`'s session chokepoint (`resyncPlayerPreferences()`,
 * the SAME place `loginOneSignal()`/`logoutOneSignal()` already run) rather
 * than at boot — a signed-out cold launch never reaches `loginNativePush()`
 * (only `logoutNativePush()`, which never calls `initialize()` — see below),
 * so the OS prompt is deferred until the first successful sign-in, exactly
 * DI-240's ruling. Native's OWN `initialize()` is independently idempotent
 * per the Swift source (`if initialized { call.resolve(); return }`), so a
 * later app-launch, already-decided permission, produces no second prompt —
 * this module ALSO memoizes the promise so re-entrant calls (a rapid
 * league-switch double-firing the chokepoint) do not even reach the bridge
 * twice.
 *
 * ── THE IDENTITY CHOKEPOINT (`_assertNativeIdentity`) — STRUCTURALLY
 *    PARALLEL TO `js/push-onesignal.js`'s `_assertIdentity()`, NOT
 *    COPY-PASTED ─────────────────────────────────────────────────────────
 * Same failure mode, same shape: a slow login landing after a logout must
 * not silently orphan the device on the wrong identity. Bounded retries
 * `[400, 4000]`ms, a generation counter so a stale retry for an identity
 * this device has already left is dropped, and both login and logout go
 * through ONE serialized chain so a handover (switch league A -> B) lands
 * in call order. Deliberately SIMPLER than the web version: there is no
 * shared config-fetch race to guard against (F-2/F-3's whole reason for
 * being) because `_loadAppId()` below is memoized independently per module
 * instance and native has no equivalent "two callers queue into the SDK's
 * own deferred array" hazard — `addListener`/plugin calls are ordinary
 * promises, not a queue a third party drains out of order.
 *
 * ── DI-254's TOKEN MODE — WIRED, CURRENTLY UNUSABLE (spike Finding 3,
 *    documented gap, not a blocker) ─────────────────────────────────────
 * `@onesignal/capacitor-plugin@1.2.0`'s raw `login()` takes ONLY
 * `{ externalId }` — no second parameter for a signed token exists in this
 * plugin version (confirmed from `OneSignalCapacitorPlugin.swift`'s
 * `login(_ call: CAPPluginCall)`, which reads only `"externalId"`). OneSignal
 * Identity Verification is OFF today (per the coordinator's relayed fact),
 * so the no-token call is production-correct now. `fetchIdentityToken()`
 * below IS called, immediately before every login attempt, exactly mirroring
 * DI-254's web design and its own doc comment — its result is deliberately
 * unused past a debug log, and this is the ONE place documented as "when a
 * plugin version with `login(externalId, token)` lands, only one line
 * changes" (the call site inside `_assertNativeIdentity`, marked below).
 * Its FAILURE never blocks login (per DI-222's requirement, since
 * Verification is off) — the mint is fire-and-forget here, unlike web's
 * `_identityTokenFor()` which currently gates the call because Verification
 * is off on web too but this module was written after that fact was
 * reconfirmed for native explicitly in the task brief.
 *
 * ── AD-67 — NATIVE NEVER SENDS ────────────────────────────────────────────
 * `NativePushAdapter.send()` is a documented, intentional no-op. Every push
 * this app delivers is server-side (`notify-fanout`/`reminders` Edge
 * Functions). This adapter exists so `js/notifications.js`'s `PushAdapter`
 * seam is honestly represented on native (an adapter IS registered, because
 * native DOES have a receive/identity path) without pretending a client-side
 * relay exists.
 */

import { isNativeShell } from './platform.js';
import { destinationFor } from './notifications.js';

// ─── the plugin handle ──────────────────────────────────────────────────────
function _plugin() {
  try {
    return (typeof window !== 'undefined'
      && window.Capacitor
      && window.Capacitor.Plugins
      && window.Capacitor.Plugins.OneSignalCapacitor) || null;
  } catch { return null; }
}

// ─── the app id — a SEPARATE small read, not importing js/push-onesignal.js's
//    private `loadAppId()` (unexported, and that module's own header gives
//    the same reasoning: a small independent fetch here is cheaper than
//    widening another module's job / reaching into its private state). Same
//    config.json key name (`oneSignalAppId`), same "only a successful read is
//    memoized" rule so one transient network blip does not pin this module to
//    "not configured" for the life of the page. ──────────────────────────────
let _appId = null;
let _appIdPromise = null;
async function _readAppId() {
  try {
    const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    _appId = (data?.oneSignalAppId || '').trim();
  } catch { return ''; }
  return _appId;
}
function _loadAppId() {
  if (_appId !== null) return Promise.resolve(_appId);
  _appIdPromise ??= _readAppId().finally(() => { _appIdPromise = null; });
  return _appIdPromise;
}

// ─── initialize() — deferred, at-most-once, memoized (see header) ─────────
let _initPromise = null;
/** Resolves `{ ok, reason }`. Never throws. Never calls anything that can
 *  prompt beyond `initialize()` itself (Finding 2 — that auto-prompt IS
 *  `initialize()`, which is exactly why this function's CALL SITE, not
 *  anything inside it, is DI-240's actual control point). */
export function initNativePush() {
  if (!isNativeShell()) return Promise.resolve({ ok: false, reason: 'not-native' });
  if (_initPromise) return _initPromise;
  const attempt = (async () => {
    const plugin = _plugin();
    if (!plugin) return { ok: false, reason: 'plugin-unavailable' };
    const appId = await _loadAppId();
    if (!appId) return { ok: false, reason: 'not-configured' };
    try {
      await plugin.initialize({ appId });
    } catch (err) {
      console.warn('[push-native] initialize() failed', err);
      return { ok: false, reason: 'init-failed' };
    }
    // N-3 (security gate, 2026-09-23) — defense-in-depth alongside the
    // build-time ONESIGNAL_DISABLE_LOCATION flag (the iOS shell project's own
    // README, "Native push" runbook step): even if OneSignalLocation.framework stayed linked
    // (a build that skipped the env var), this app never asks for location
    // and ships no NSLocation* usage-description key at all — calling any
    // location API on a device without one would crash the process, which
    // setLocationShared(false) here exists to make impossible to reach in
    // the first place. Best-effort: this app has no location feature either
    // way, so a failure here changes nothing observable.
    try { await plugin.setLocationShared?.({ shared: false }); }
    catch (err) { console.warn('[push-native] setLocationShared(false) failed (non-fatal — this app never uses location)', err); }
    // N-7 (optional, offered alongside N-3) — this app has no in-app-message
    // campaigns configured in the OneSignal dashboard; pausing the surface
    // costs nothing and removes a bridge feature this pass never designed
    // for. Best-effort, same reasoning as above.
    try { await plugin.setPaused?.({ pause: true }); }
    catch (err) { console.warn('[push-native] setPaused(true) (InAppMessages) failed (non-fatal — unused this pass)', err); }
    return { ok: true, reason: 'initialized' };
  })();
  // Reviewer Finding 2 (2026-09-23) — ONLY a genuinely successful init stays
  // memoized, matching `_loadAppId()`'s own documented rule two sections up
  // ("only a successful read is memoized"). Before this fix, `_initPromise`
  // was assigned the promise itself BEFORE it settled and never reset on any
  // outcome — so a first-attempt failure (plugin missing, config
  // unreachable, a transient `initialize()` throw) was cached FOREVER: every
  // later call, including every retry `_scheduleRetry()` schedules for
  // exactly the 'init-failed' reason, read back the same stale rejected
  // verdict instead of trying again, making the retry ladder dead code. Any
  // caller still awaiting `_initPromise` before this callback runs already
  // holds a reference to `attempt`'s own settled value regardless of what
  // `_initPromise` is reassigned to afterward — nulling it here only changes
  // what the NEXT call to `initNativePush()` sees.
  _initPromise = attempt.then((res) => {
    if (!res.ok) _initPromise = null;
    return res;
  });
  return _initPromise;
}

/** Test/diagnostic only — was `initialize()` ever attempted this page life?
 *  Used by `logoutNativePush()` to avoid calling the plugin's `logout()`
 *  before the SDK has ever been brought up (unverified native behavior; the
 *  safe default is "nothing to log out of yet"). */
function _initAttempted() { return _initPromise !== null; }

// ─── DI-254 — wired, currently unusable (see header). Mirrors
//    js/push-onesignal.js's `_mintIdentityToken()` shape, not its code:
//    reached only via `await import('./auth.js')` so this module creates no
//    static edge into the auth graph. ────────────────────────────────────
let _identityMinter = null;
/** Test seam ONLY — mirrors push-onesignal.js's `_setIdentityMinterForTest`. */
export function _setIdentityMinterForTest(fn) { _identityMinter = typeof fn === 'function' ? fn : null; }
async function fetchIdentityToken(memberId) {
  if (typeof _identityMinter === 'function') {
    try { return await _identityMinter(memberId); } catch { return { ok: false, reason: 'mint-threw' }; }
  }
  try {
    const { getSupabaseClient, getActiveLeagueId } = await import('./auth.js');
    const client = getSupabaseClient();
    const leagueId = getActiveLeagueId();
    if (!client || !leagueId) return { ok: false, reason: 'no-session' };
    const { data, error } = await client.functions.invoke('push-identity-token', { body: { league_id: leagueId } });
    if (error) return { ok: false, reason: 'unreachable' };
    const token = data && typeof data.token === 'string' ? data.token : '';
    if (!token) return { ok: false, reason: String((data && data.skipped) || 'no-token') };
    return { ok: true, token };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

// ══ N-4 (security gate, 2026-09-23) — THE BINDING SURVIVES PROCESS DEATH ═══
//
// OneSignal's native SDK persists the externalId binding itself (its own
// on-device store), independent of this page's lifetime. `_initAttempted()`
// only knows about THIS launch — so a device that logged in as member A,
// was force-quit, and relaunched signed OUT (or signed in as member B, whose
// own login() call correctly REPLACES the binding and needs no help here)
// used to skip `plugin.logout()` outright on the signed-out relaunch, because
// `_initAttempted()` read false. The native SDK's binding to A never got
// touched: the phone kept receiving A's push after being handed back or
// after A signed out, exactly the failure correction #2 (web) and this
// module's own header exist to prevent — just reached from a PROCESS
// boundary the page-lifetime guard could not see across.
//
// THE FIX is a namespaced flag in the Capacitor Preferences store (already a
// dependency; `js/auth-storage-native.js` uses the identical
// `window.Capacitor.Plugins.Preferences` raw-call shape), written on every
// successful login and cleared on every successful logout. It is NOT a
// substitute for `_initAttempted()` — a genuinely fresh device (flag never
// written) still gets the DI-240 guarantee untouched: NO `initialize()` call,
// and therefore no auto-prompt, on an ordinary anonymous cold boot. The flag
// only ever widens the logout path's reach, never the login path's, and only
// for a device that has itself attached an identity before.
const NATIVE_PUSH_IDENTITY_KEY = 'cfbp_native_push_identity';
function _preferences() {
  try {
    return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins
      && window.Capacitor.Plugins.Preferences) || null;
  } catch { return null; }
}
/** Never throws. `false` on any read failure — the SAFE direction for the
 *  ONLY thing this flag widens (the logout path): a device we cannot read
 *  the flag from behaves exactly as before this fix (skips the extra
 *  reconcile), never worse. */
async function _readPersistedIdentityFlag() {
  const prefs = _preferences();
  if (!prefs) return false;
  try {
    const r = await prefs.get({ key: NATIVE_PUSH_IDENTITY_KEY });
    return !!(r && typeof r.value === 'string' && r.value.length > 0);
  } catch (err) { console.warn('[push-native] Preferences read failed (identity flag)', err); return false; }
}
async function _writePersistedIdentityFlag(target) {
  const prefs = _preferences();
  if (!prefs) return;
  try { await prefs.set({ key: NATIVE_PUSH_IDENTITY_KEY, value: String(target) }); }
  catch (err) { console.warn('[push-native] Preferences write failed (identity flag)', err); }
}
async function _clearPersistedIdentityFlag() {
  const prefs = _preferences();
  if (!prefs) return;
  try { await prefs.remove({ key: NATIVE_PUSH_IDENTITY_KEY }); }
  catch (err) { console.warn('[push-native] Preferences remove failed (identity flag)', err); }
}
/** Test seam ONLY. */
export async function _peekPersistedIdentityFlagForTest() { return _readPersistedIdentityFlag(); }

// ─── the identity chokepoint — see header ──────────────────────────────────
const IDENTITY_RETRY_DELAYS_MS = [400, 4000];
let _chain = Promise.resolve();
function _queue(fn) { _chain = _chain.then(fn, fn); return _chain; }
let _gen = 0;
let _desiredTarget = '';

async function _assertNativeIdentity(target, gen, attempt = 0) {
  if (attempt > 0 && gen !== _gen) return;
  if (!target) {
    // Logout. N-4: reconcile against the PERSISTED flag, not just this
    // launch's in-memory init state — see the header above this section.
    const attachedBefore = await _readPersistedIdentityFlag();
    if (attempt > 0 && gen !== _gen) return;
    if (!_initAttempted() && !attachedBefore) return;   // nothing was ever attached; DI-240 untouched
    // initialize() is idempotent (memoized here, AND idempotent natively —
    // see initNativePush()'s own header) — a call that already ran this
    // launch is a no-op; a call reached ONLY because of the persisted flag
    // brings the SDK up so logout() has something to call. Per the
    // coordinator's own framing: no OS prompt occurs on this path in the
    // overwhelmingly common case, because permission was already decided
    // the first time this same device called initialize() (whichever
    // session wrote the flag).
    const init = await initNativePush();
    if (attempt > 0 && gen !== _gen) return;
    if (!init.ok) {
      if (init.reason === 'init-failed') _scheduleRetry(target, gen, attempt);
      return; // 'not-configured' / 'plugin-unavailable' — nothing this device can do
    }
    const plugin = _plugin();
    if (!plugin) { _scheduleRetry(target, gen, attempt); return; }
    try {
      await plugin.logout();
      await _clearPersistedIdentityFlag();
    } catch (err) {
      console.warn('[push-native] logout() failed', err);
      _scheduleRetry(target, gen, attempt);
    }
    return;
  }
  const init = await initNativePush();
  if (attempt > 0 && gen !== _gen) return;
  if (!init.ok) {
    if (init.reason === 'init-failed') _scheduleRetry(target, gen, attempt);
    return; // 'not-configured' / 'plugin-unavailable' are settled facts, not worth retrying
  }
  // DI-254 — fire-and-forget; the mint's result is unused past this log line
  // until a plugin version accepts a second `login()` argument (see header).
  // THE ONE LINE THAT CHANGES WHEN THAT LANDS is the `plugin.login({...})`
  // call below, which would gain a `token:` field here.
  try { const minted = await fetchIdentityToken(target); if (!minted.ok) console.info('[push-native] identity token unavailable (expected while Identity Verification is off):', minted.reason); }
  catch { /* never blocks login — DI-222 */ }
  if (attempt > 0 && gen !== _gen) return;
  const plugin = _plugin();
  if (!plugin) { _scheduleRetry(target, gen, attempt); return; }
  try {
    await plugin.login({ externalId: String(target) });
    // N-4 — record the binding AFTER a successful login(), so the persisted
    // flag can never claim an attachment that did not happen.
    await _writePersistedIdentityFlag(target);
  } catch (err) {
    console.warn('[push-native] login() failed', err);
    _scheduleRetry(target, gen, attempt);
  }
}
function _scheduleRetry(target, gen, attempt) {
  const delay = IDENTITY_RETRY_DELAYS_MS[attempt];
  if (delay === undefined) {
    console.warn('[push-native] could not attach the native push identity after', IDENTITY_RETRY_DELAYS_MS.length + 1, 'attempts');
    return;
  }
  const t = setTimeout(() => {
    if (gen !== _gen) return;
    _queue(() => _assertNativeIdentity(target, gen, attempt + 1));
  }, delay);
  t?.unref?.();
}

/** Called from app.js's session chokepoint (`resyncPlayerPreferences()`),
 *  beside the existing `loginOneSignal()` call, whenever `isNativeOrigin()`.
 *  Idempotent, safe on every login/logout/league-switch. */
export function loginNativePush(memberId) {
  if (!isNativeShell() || !memberId) return Promise.resolve();
  const gen = ++_gen;
  _desiredTarget = String(memberId);
  return _queue(() => _assertNativeIdentity(String(memberId), gen));
}
/** Correction #2's native counterpart — MUST be called on sign-out and on
 *  league switch. */
export function logoutNativePush() {
  if (!isNativeShell()) return Promise.resolve();
  const gen = ++_gen;
  _desiredTarget = '';
  return _queue(() => _assertNativeIdentity('', gen));
}

// ─── AD-67 — the adapter ────────────────────────────────────────────────────
export class NativePushAdapter {
  /** Documented no-op — see header. Returns `ok:false` rather than a false
   *  'sent' so `deliverPush()`'s `record.deliveryState.push` never claims a
   *  send that did not happen; unreachable in production today (every
   *  `deliverPush()` call site returns earlier once `notifyFanout` is on —
   *  see js/notifications.js §4), so this is an honesty guarantee, not a
   *  behavior anything currently observes. */
  async send() {
    return { ok: false, skipped: true, reason: 'native-adapter-never-sends' };
  }
}

// ─── honest status, for the priming card (DI-240) ──────────────────────────
/** `permissionNative()`'s OSNotificationPermission enum, read from the
 *  plugin's own .d.ts (see header) — not guessed. */
const OS_PERMISSION = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };

/** Resolves 'granted' | 'denied' | 'not-asked' | 'unsupported'. Never throws;
 *  an unreachable plugin (a build before the OneSignal binary linked, or this
 *  module evaluated under a bare `window.Capacitor` spoof) reads
 *  'unsupported' rather than inventing a verdict — CONVENTIONS #10. */
export async function nativePushState() {
  if (!isNativeShell()) return 'unsupported';
  const plugin = _plugin();
  if (!plugin || typeof plugin.permissionNative !== 'function') return 'unsupported';
  try {
    const res = await plugin.permissionNative();
    const p = res?.permission;
    if (p === OS_PERMISSION.NOT_DETERMINED) return 'not-asked';
    if (p === OS_PERMISSION.DENIED) return 'denied';
    if (p === OS_PERMISSION.AUTHORIZED || p === OS_PERMISSION.PROVISIONAL || p === OS_PERMISSION.EPHEMERAL) return 'granted';
    return 'unsupported';
  } catch (err) {
    console.warn('[push-native] permissionNative() failed', err);
    return 'unsupported';
  }
}

/** DI-240's "Turn On" button, native branch. Must be called from a genuine
 *  user gesture, same rule as web's `requestPushPermission()`. Also runs
 *  `initNativePush()`/`loginNativePush()` first if they have not happened yet
 *  (a player who dismissed the very-first-sign-in auto-prompt and comes back
 *  later via this button) — `fallbackToSettings:false` because the app's own
 *  denied-state copy owns the "go to Settings" recovery path (see
 *  `openNativeSettings()`), not the plugin's own settings-redirect option. */
export async function requestNativePushPermission(memberId) {
  if (!isNativeShell()) return { ok: false, reason: 'not-native' };
  await initNativePush();
  const plugin = _plugin();
  if (!plugin || typeof plugin.requestPermission !== 'function') return { ok: false, reason: 'plugin-unavailable' };
  try {
    const res = await plugin.requestPermission({ fallbackToSettings: false });
    if (memberId) { try { await loginNativePush(memberId); } catch { /* best-effort */ } }
    return { ok: !!res?.permission, reason: res?.permission ? 'granted' : 'denied' };
  } catch (err) {
    console.warn('[push-native] requestPermission() failed', err);
    return { ok: false, reason: 'request-failed' };
  }
}

/**
 * Deep-link straight to the OS Settings page for this app, for the 'denied'
 * copy's "Open Settings" link — denial cannot be re-prompted in-app; this is
 * the only recovery path (DI-240).
 *
 * HONEST GAP, named rather than hidden: this build adds NO app-settings-
 * capable native module (the already-installed App plugin's JS surface has
 * no `openUrl`; a dedicated settings-launcher plugin was NOT part of this
 * pass's approved dependency list, which named only the OneSignal push
 * plugin). This relies on WKWebView/the native shell handing an
 * unrecognized, non-http(s) URL scheme (`app-settings:`) off to
 * `UIApplication.open()` by its default scheme-handling behavior, which is a
 * commonly-relied-on but NOT independently verified-on-device-in-this-pass
 * mechanism. If it does not work on Drew's phone, the fix is a one-line,
 * one-plugin addition (a settings-launcher plugin's `openUrl()`) — flagged
 * here rather than silently assumed solved. (Its exact package name is
 * intentionally not written here — the iOS shell project's own README has
 * the full note; this file ships to web too and AD-65's boundary check
 * disallows even a prose mention of the native shell's directory name or
 * the native plugin ecosystem's package-scope name in anything under
 * cfb-pickems/.)
 */
export function openNativeSettings() {
  if (!isNativeShell()) return false;
  try {
    window.location.href = 'app-settings:';
    return true;
  } catch (err) {
    console.warn('[push-native] could not open native settings', err);
    return false;
  }
}

// ─── foreground presentation + click routing (DI-241) ──────────────────────
//
// Both wiring functions are called once from app.js's boot, gated on
// isNativeShell() (the SAME dynamic-import block that registers the
// adapter and calls initNativePush() indirectly via the session chokepoint).
// Neither function itself decides WHAT navigating means — both take an
// injected callback, exactly the shape `js/push-onesignal.js`'s
// `wireForegroundSuppression(destinationForEvent, onForegroundPush)` /
// `wireNotificationClicks(onClick)` already use, because app.js's
// `navigateTo()`/`deepLinkTo()` are module-private and this module must not
// duplicate them (DI-221).

let _foregroundWired = false;
/** `onForegroundPush(event|null)` — pass the SAME hook web uses
 *  (`() => wakeChat()`), BUG-12's fetch-first pattern. The banner itself is
 *  shown by NOT calling `preventDefault` for it — see `proceedWithWillDisplay`
 *  below, which is what re-enables the default-display behavior a listener's
 *  mere presence otherwise suppresses (Finding 4). */
export function wireNativeForeground(onForegroundPush) {
  if (!isNativeShell() || _foregroundWired) return;
  const plugin = _plugin();
  if (!plugin || typeof plugin.addListener !== 'function') return;
  _foregroundWired = true;
  plugin.addListener('notificationForegroundWillDisplay', async (data) => {
    try {
      const event = data?.additionalData?.event || null;
      if (typeof onForegroundPush === 'function') {
        try { onForegroundPush(event); } catch (err) { console.warn('[push-native] foreground hook failed', err); }
      }
    } finally {
      // MUST run even if the hook above throws — Finding 4: once ANY listener
      // is attached, native suppresses the banner unconditionally until this
      // is called. Omitting it is an easy, invisible regression (mutation-
      // proved by pushnativetest.mjs).
      const notificationId = data?.notificationId;
      if (notificationId) {
        try { await plugin.proceedWithWillDisplay({ notificationId }); }
        catch (err) { console.warn('[push-native] proceedWithWillDisplay() failed', err); }
      }
    }
  });
}

// Cold-start ready-gate — see header's note on `retainUntilConsumed`. This is
// an EXTRA safety net for the narrow window between this module's own
// `addListener()` call resolving and app.js's boot having painted a tab to
// navigate onto — not a substitute for Capacitor's own buffering.
let _bootReady = false;
let _pendingNavigations = [];
/** Called once from app.js, right after `revealApp()`. Flushes anything the
 *  click handler queued before the app was ready to navigate. */
export function markNativeBootReady() {
  _bootReady = true;
  const pending = _pendingNavigations;
  _pendingNavigations = [];
  pending.forEach((fn) => { try { fn(); } catch (err) { console.warn('[push-native] queued navigation failed', err); } });
}

// Security condition C2 (server-half gate, DI-241, coordinator relay
// 2026-09-23) — `additionalData.route`/`.url`/`.launchURL` all arrive from a
// push PAYLOAD, which is server-authored today but must be treated as
// untrusted input at the client boundary regardless. `route` is therefore an
// ALLOW-LISTED tab id ONLY — the SAME six tabs `app.js`'s own
// `NATIVE_SHELL_VALID_TABS` (S-C17's precedent) and `notifytest.mjs`'s
// `VALID_TABS` already enumerate. A second, independently-maintained copy
// rather than an import: `NATIVE_SHELL_VALID_TABS` is a module-private const
// in app.js (not exported), and notifytest.mjs already keeps its own copy
// for the identical reason — mirrored, not imported, same precedent.
// `url`/`launchURL` are NEVER READ here, on either the foreground or click
// path — native navigation is driven exclusively by `route`/`params`/`event`.
const NATIVE_ROUTE_ALLOW_LIST = new Set(['picks', 'dashboard', 'leaderboard', 'commissioner', 'rules', 'chat']);

/** Resolves a safe `{tab, params}` from a click event's `additionalData`, or
 *  `null` when there is nothing safe to navigate to. `params` is passed
 *  through as DATA ONLY — an object handed to the app's existing deep-link
 *  entry point, never interpolated into HTML, never eval'd, never opened as
 *  a URL — the caller (app.js's `deepLinkTo()`) is what owns doing that
 *  safely, exactly as it already does for the web push path. */
function _resolveClickDestination(additionalData) {
  const event = (additionalData && typeof additionalData.event === 'string') ? additionalData.event : null;
  const route = additionalData && additionalData.route;
  if (route !== undefined && route !== null) {
    // A route was explicitly sent — it MUST be one of the six real tabs, or
    // this tap resolves to NOTHING (no navigation, no fallback to `event`
    // either: an invalid route is not "missing," it's malformed, and
    // guessing a different destination for it is not safer than declining).
    if (typeof route !== 'string' || !NATIVE_ROUTE_ALLOW_LIST.has(route)) {
      console.warn('[push-native] ignored a notification tap with an unrecognized route:', typeof route === 'string' ? route : typeof route);
      return null;
    }
    const params = (additionalData.params && typeof additionalData.params === 'object' && !Array.isArray(additionalData.params))
      ? additionalData.params : {};
    return { tab: route, params };
  }
  // No route sent — the normal untampered shape for an event-only payload
  // (DI-A5's own contract). destinationFor() is already the app's ONE
  // trusted resolver for event -> {tab, params}, and it only ever returns a
  // tab that is itself a real navigateTo() destination (notifytest.mjs [1]).
  return destinationFor(event, additionalData || {});
}

let _clickWired = false;
/** `onNavigate({tab, params})` — app.js passes its own `deepLinkTo()`. */
export function wireNativeNotificationClicks(onNavigate) {
  if (!isNativeShell() || _clickWired) return;
  const plugin = _plugin();
  if (!plugin || typeof plugin.addListener !== 'function') return;
  _clickWired = true;
  plugin.addListener('notificationClick', (data) => {
    // Finding 6 — NESTED under `.notification`, unlike the foreground event.
    const additionalData = data?.notification?.additionalData || null;
    const dest = _resolveClickDestination(additionalData || {});
    if (!dest) return;   // C2 — an unrecognized route is a no-op, not a guess
    const run = () => { if (typeof onNavigate === 'function') onNavigate(dest); };
    if (_bootReady) run(); else _pendingNavigations.push(run);
  });
}
/** Test seam ONLY — exercises the allow-list/resolution logic directly,
 *  without a fake plugin/addListener round trip. */
export function _resolveClickDestinationForTest(additionalData) { return _resolveClickDestination(additionalData); }

/** Test-only reset — mirrors push-onesignal.js's `_resetForTest()` convention. */
export function _resetForTest() {
  _appId = null;
  _appIdPromise = null;
  _initPromise = null;
  _identityMinter = null;
  _chain = Promise.resolve();
  _gen = 0;
  _desiredTarget = '';
  _foregroundWired = false;
  _clickWired = false;
  _bootReady = false;
  _pendingNavigations = [];
}
/** Test-only accessors. */
export function _desiredTargetForTest() { return _desiredTarget; }
export function _isBootReadyForTest() { return _bootReady; }
