/**
 * js/push-onesignal.js — client-side OneSignal Web SDK wrapper.
 * Groups A/B notification workstream (UN-139…UN-148), DI-A2 / correction #1/#2.
 *
 * WHAT THIS MODULE DOES:
 *   - Loads the OneSignal Web SDK (v16) script, only if a public App ID is
 *     configured (config.json's `oneSignalAppId` — see loadAppId() below).
 *     No-ops cleanly when it's empty, per the task's explicit requirement —
 *     Drew has not supplied the App ID yet, so in production TODAY this
 *     module does nothing observable.
 *   - Associates/disassociates the current app player with the OneSignal
 *     device via `OneSignal.login(playerId)` / `OneSignal.logout()`
 *     (correction #2 — logout on sign-out/player-switch, or a handed-off
 *     phone keeps receiving the PREVIOUS player's pushes).
 *   - Exposes the permission/subscription STATE the Notification Center
 *     (DI-A2/A3) needs to render its four states (never-asked / granted /
 *     denied / unsupported) — read-only, no UI here.
 *   - Does NOT send anything. Sending is server-side only (backend/Code.gs's
 *     `notifyPush` action + the `scanReminders` trigger) — see js/notifications.js
 *     §4/§5. This module's only "send-adjacent" job is registering the
 *     device so the server has somewhere to send TO.
 *
 * WHY A SEPARATE CONFIG READ, NOT js/backend.js's loadDeployedConfig():
 * That function is scoped to the PRIVATE backend url/token pair and its
 * three-state (missing/empty/malformed) contract is written around gating a
 * Sheets connection. The OneSignal App ID is a different, PUBLIC concern (the
 * Appendix in DESIGN_INPUTS_BATCH1_091026.md is explicit: "App ID is public").
 * Reusing that function would either overload its return shape or require
 * widening js/backend.js's job — a small, independent fetch here is cheaper
 * and keeps the two concerns from drifting into each other.
 *
 * SERVICE-WORKER COEXISTENCE (correction #1): the OneSignal SDK is configured
 * to use OUR service-worker.js (merged via importScripts — see that file),
 * not a second root-scope worker. `serviceWorkerParam`/`serviceWorkerPath`
 * below point at it explicitly.
 *
 * VERIFIED 2026-09-10 against the live CDN and OneSignal's docs (the "could
 * not reach the docs" caveat that used to sit here is resolved):
 * ONESIGNAL_SDK_URL returns HTTP 200, the init option names below are read
 * from the shipped SDK bundle itself (quoted at their use sites), and the
 * merged-worker setup matches the documented "combine service workers"
 * procedure. See service-worker.js's header for the other half.
 */

const ONESIGNAL_SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';

/** How long to wait for the SDK to drain OneSignalDeferred before calling it
 *  not-loaded. See loadSdkScript()'s note: OneSignalSDK.page.js is a SHIM that
 *  returns 200 and fires onload even on browsers it refuses to support, so
 *  "script loaded" is NOT "SDK present" and a bare await can hang forever. */
let SDK_READY_TIMEOUT_MS = 12000;
/** The native permission sheet is modal; a person can sit on it. This bound
 *  exists so the Turn On button always produces SOME answer, never a dead tap. */
let PROMPT_TIMEOUT_MS = 120000;
/* Both are `let` ONLY so notifytest.mjs can shrink them via _resetForTest()
 * and prove the no-dead-tap guarantee in milliseconds instead of minutes.
 * Nothing in the app writes them. */

let _appId = null;          // resolved once on SUCCESS only (see loadAppId)
let _initOnce = null;       // the single, at-most-once OneSignal.init() attempt
let _configUnreachable = false;   // last config.json read failed outright (vs. read fine, no App ID)

/** Read config.json's public oneSignalAppId. Independent of js/backend.js —
 *  see module header. Never throws.
 *
 *  RG (2026-09-10): this used to memoize the FAILURE too (`_appId = ''` on a
 *  thrown fetch), so one transient network blip at boot pinned push to
 *  "not configured" for the entire life of the page — the priming card then
 *  renders nothing at all and there is no way back without a reload. Only a
 *  successful read is memoized now; a failed read returns '' and is retried. */
async function loadAppId() {
  if (_appId !== null) return _appId;
  try {
    const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) { _configUnreachable = true; return ''; }   // transient — not memoized
    const data = await res.json();
    _configUnreachable = false;
    _appId = (data?.oneSignalAppId || '').trim(); // definitive — memoized
  } catch {
    _configUnreachable = true;
    return '';                                    // transient — not memoized
  }
  return _appId;
}

/** True once we know push COULD be configured (non-empty App ID). Does not
 *  imply the SDK has loaded or permission was granted — see subscriptionState(). */
export async function isPushConfigured() {
  return !!(await loadAppId());
}

/** Is this page running as an installed app (home-screen / standalone window)? */
function isStandaloneDisplay() {
  try {
    if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return !!window.matchMedia('(display-mode: standalone)').matches;
    }
  } catch { /* matchMedia can throw in exotic embedded webviews */ }
  return false;
}

/**
 * Can this browser run OneSignal's Web SDK at all? Returns one of:
 *   'no-browser'   — not a DOM environment (node/loadtest)
 *   'supported'    — the SDK will load and can subscribe
 *   'needs-install'— Apple device, push only available once added to Home Screen
 *   'unsupported'  — no web push here, period
 *
 * WHY THIS EXACT PREDICATE (root cause, 2026-09-10). `ONESIGNAL_SDK_URL` does
 * NOT serve the SDK — it serves a 590-byte COMPATIBILITY SHIM whose whole body
 * is one ternary (read from the live CDN file):
 *
 *   "undefined"!=typeof PushSubscriptionOptions
 *      && PushSubscriptionOptions.prototype.hasOwnProperty("applicationServerKey")
 *   || void 0!==window.safari && void 0!==window.safari.pushNotification
 *     ? <append OneSignalSDK.page.es6.js>
 *     : console.info("Incompatible browser." + <iOS: " Try these steps: …">)
 *
 * On the false branch the shim STILL returns 200 and STILL fires onload — it
 * just never appends the real SDK, so `OneSignalDeferred` is never drained and
 * every callback pushed onto it is dropped on the floor, silently, forever.
 * Our previous support test (`/iP(hone|ad|od)/` on the UA + Notification
 * presence) was a DIFFERENT predicate from the SDK's, and any divergence
 * between the two produces exactly the reported bug: a "Turn On" button on a
 * device where the SDK has already decided not to exist. Mirroring the shim's
 * own test removes the divergence by construction.
 *
 * Note the UA regex could not have covered iPadOS anyway: since iPadOS 13,
 * Safari reports "Macintosh; Intel Mac OS X" by default, so an iPad never
 * matched /iP(hone|ad|od)/. `navigator.vendor` + `maxTouchPoints` is the test
 * the shim itself uses for its Apple hint, so we use it too.
 *
 * ORDER MATTERS (2026-09-10): the Apple-handheld-not-installed test runs
 * BEFORE the shim predicate, not after. Apple ships web push only to
 * home-screen apps, so an iPhone/iPad in a Safari TAB must read
 * 'needs-install' whether or not the push API happens to be visible there —
 * otherwise the day iOS exposes PushSubscriptionOptions in a tab, the card
 * silently grows a Turn On button that cannot succeed. Guarded by notifytest
 * [24d], which asserts 'needs-install' even with sdkCompatible forced true.
 */
export function pushSupportLevel() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'no-browser';

  // APPLE HANDHELD, NOT INSTALLED — decided FIRST, ahead of the SDK's own test.
  // Apple delivers web push only to home-screen apps; in a Safari TAB there is
  // nothing to grant, so a Turn On button there can only fail. Ordering this
  // before the compatibility check means that stays true even if a future iOS
  // exposes the push API in tabs (it would flip sdkCompatible to true and put
  // a dead button back on the card). `vendor` + `maxTouchPoints` rather than a
  // UA regex: since iPadOS 13 Safari reports "Macintosh; Intel Mac OS X", so
  // /iP(hone|ad|od)/ can never match an iPad. Desktop Safari on macOS has
  // maxTouchPoints 0 and is unaffected — it gets push in a plain tab.
  const appleTouchDevice = navigator.vendor === 'Apple Computer, Inc.' && (navigator.maxTouchPoints || 0) > 0;
  const iosUA = /iP(hone|ad|od)/.test(navigator.userAgent || '');
  if ((appleTouchDevice || iosUA) && !isStandaloneDisplay()) return 'needs-install';

  let sdkCompatible = false;
  try {
    sdkCompatible =
      (typeof PushSubscriptionOptions !== 'undefined'
        && Object.prototype.hasOwnProperty.call(PushSubscriptionOptions.prototype, 'applicationServerKey'))
      || (typeof window.safari !== 'undefined' && window.safari != null
        && typeof window.safari.pushNotification !== 'undefined');
  } catch { sdkCompatible = false; }
  return sdkCompatible ? 'supported' : 'unsupported';
}

/** Inject the SDK shim. Resolves true if the <script> loaded (which, per
 *  pushSupportLevel()'s note, does NOT prove the SDK itself arrived). */
let _scriptPromise = null;
function loadSdkScript() {
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = ONESIGNAL_SDK_URL;
    s.defer = true;
    s.onload = () => resolve(true);
    s.onerror = () => { console.warn('[push-onesignal] SDK script failed to load', ONESIGNAL_SDK_URL); resolve(false); };
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

/** Human-readable text for anything a promise can reject with. The v16 SDK
 *  rejects with a real Error in most paths, but its remote-config JSONP call
 *  can reject with the RAW response body — a plain object, whose `message` is
 *  undefined, so `String(err?.message || err)` produced the literal string
 *  "[object Object]" in the one place we most needed to read it. */
function describeErr(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.message) return String(err.message);
  const parts = [];
  if (err.description) parts.push(String(err.description));
  if (err.code !== undefined) parts.push(`code ${err.code}`);
  if (parts.length) return parts.join(' — ');
  try { return JSON.stringify(err); } catch { return String(err); }
}

/**
 * Turn an init() throw into a specific reason.
 *
 * These three messages are not guesses — they are the literal strings the
 * shipped v16 SDK throws, read from OneSignalSDK.page.es6.js?v=160610:
 *
 *   catch(i){ if(i instanceof Object && "code" in i){
 *               if(1===i.code) throw et;                                  // et = Error("AppID doesn't match existing apps")
 *               if(2===i.code) throw new Error("App not configured for web push") }
 *             throw i }
 *   ... throw new Error(`Can only be used on: ${new URL(t.origin).origin}`)
 *
 * where code 2 is what onesignal.com/api/v1/sync/<appId>/web returns for an
 * app whose Web Push platform was never set up. That is a COMMISSIONER-side
 * configuration gap, not something a player can retry their way out of, so it
 * must not share a message with the transient failures.
 */
function classifyInitError(err) {
  const msg = describeErr(err);
  if (/not configured for web push/i.test(msg) || (err && err.code === 2)) return { reason: 'web-push-not-enabled', detail: msg };
  if (/appid doesn't match/i.test(msg) || (err && err.code === 1))        return { reason: 'app-id-mismatch', detail: msg };
  if (/can only be used on/i.test(msg))                                   return { reason: 'wrong-site-origin', detail: msg };
  if (/already initialized/i.test(msg))                                   return { reason: 'init-already-spent', detail: msg };
  return { reason: 'init-failed', detail: msg };
}

/**
 * Call OneSignal.init() AT MOST ONCE per page, ever, and memoize the outcome.
 *
 * ROOT CAUSE THIS CLOSES (2026-09-10). The v16 SDK's init is single-shot and
 * fails CLOSED — from the shipped source, the very first thing `init()` does is
 *
 *     function(){ if(OneSignal.Kr) throw new Error("SDK already initialized");
 *                 OneSignal.Kr = !0 }()
 *
 * i.e. it sets the "already initialized" flag BEFORE the work that can fail
 * (remote config fetch, IndexedDB open). So if the first init throws for any
 * transient reason, every later init() throws "SDK already initialized" —
 * permanently. The old code kept only a `_sdkLoadStarted` boolean and re-ran
 * init on every call, which meant one unlucky boot-time init (app.js calls it
 * at startup) poisoned the Turn On button for the rest of the session and
 * reported the misleading downstream error instead of the original one.
 */
function startInitOnce(appId) {
  return (async () => {
    const loaded = await loadSdkScript();
    if (!loaded) return { ok: false, reason: 'sdk-not-loaded' };
    return new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId,
            // ── SERVICE-WORKER CONFIG — see the long note below ──
            path: '/',
            serviceWorkerOverrideForTypical: true,
            serviceWorkerParam: { scope: '/' },
            serviceWorkerPath: 'service-worker.js',
            // DI-A2 / Q7 — we prompt ONLY inside the Notification Center, never
            // OneSignal's own auto slide-down (Drew disables that in the
            // OneSignal dashboard per the Appendix; this is belt-and-suspenders).
            promptOptions: { autoPrompt: false },
          });
          resolve({ ok: true, reason: 'initialized' });
        } catch (err) {
          console.warn('[push-onesignal] init failed', err);
          resolve({ ok: false, ...classifyInitError(err) });
        }
      });
    });
  })();
}

/**
 * Load the SDK + run init() exactly once. Resolves a DIAGNOSTIC result
 * `{ ok, reason, detail? }` — never a bare boolean, because a bare boolean is
 * what made this bug unfixable from a bug report (four unrelated causes, one
 * indistinguishable `false`, one generic toast).
 *
 * WHY `path` AND `serviceWorkerOverrideForTypical` ARE BOTH REQUIRED HERE
 * ---------------------------------------------------------------------
 * Read from the shipped v16 SDK (OneSignalSDK.page.es6.js?v=160610), two places:
 *
 * 1. Config merge, for a "typical site" dashboard setup (integration kind not
 *    "custom"/"wordpress"):
 *
 *      const n = t.serviceWorkerOverrideForTypical;
 *      return { path:               n ? t.path ?? i.path : i.path,
 *               serviceWorkerParam: n ? t.serviceWorkerParam ?? {scope:i.registrationScope} : {scope:i.registrationScope},
 *               serviceWorkerPath:  n ? t.serviceWorkerPath ?? i.workerName : i.workerName };
 *
 *    Without `serviceWorkerOverrideForTypical: true`, BOTH of our options are
 *    discarded and the DASHBOARD's values win — default worker name
 *    "OneSignalSDKWorker.js" (the SDK's `It` constant) at scope "/".
 *
 * 2. Worker-path construction:
 *
 *      const i = { workerPath: new zs(It), registrationOptions: Ot };
 *      e.userConfig && ( e.userConfig.path && (i.workerPath =
 *          new zs(`${path.replace(/\/+$/,"")}/${serviceWorkerPath.replace(/^\/+/,"")}`)), … )
 *
 *    `serviceWorkerPath` is only consulted INSIDE `e.userConfig.path && (…)`.
 *    With no `path`, workerPath silently stays "OneSignalSDKWorker.js".
 *
 * Consequence of the old init (serviceWorkerPath + serviceWorkerParam, no
 * `path`, no override): the SDK looked for /OneSignalSDKWorker.js. We do not
 * host that file — we merge OneSignal's worker into service-worker.js via
 * importScripts instead (the documented "combine service workers" pattern), so
 * https://irbfootball.com/OneSignalSDKWorker.js 404s today, verified live on
 * 2026-09-10. With no worker found, the SDK's subscribe path ran
 *
 *      if (!i) throw new Error("OneSignal service worker not found!");
 *
 * which our catch turned into `false` → "Could not enable push". Passing both
 * options makes the SDK resolve /service-worker.js under BOTH dashboard
 * integration kinds, so the outcome no longer depends on an invisible
 * dashboard setting.
 */
export async function ensureOneSignalInit() {
  const appId = await loadAppId();
  // Two very different states that used to share one answer: config.json was
  // read and simply has no App ID (feature not live yet — nothing to retry),
  // versus config.json could not be read at all (transient — retrying helps).
  if (!appId) return { ok: false, reason: _configUnreachable ? 'config-unreachable' : 'not-configured' };
  if (typeof document === 'undefined') return { ok: false, reason: 'no-browser' };

  const support = pushSupportLevel();
  if (support === 'no-browser') return { ok: false, reason: 'no-browser' };
  if (support === 'needs-install') return { ok: false, reason: 'not-installed-ios' };
  if (support === 'unsupported') return { ok: false, reason: 'unsupported-browser' };

  if (!_initOnce) _initOnce = startInitOnce(appId);
  // Race a TIMEOUT, never memoized: if the SDK shows up late, a later call
  // re-awaits the same single init attempt and gets the real answer.
  const timer = new Promise((resolve) => {
    const t = setTimeout(() => {
      console.warn('[push-onesignal] SDK did not run its deferred queue within', SDK_READY_TIMEOUT_MS, 'ms');
      resolve({ ok: false, reason: 'sdk-not-loaded' });
    }, SDK_READY_TIMEOUT_MS);
    t?.unref?.();   // node-only; keeps test harnesses from hanging on the timer
  });
  return Promise.race([_initOnce, timer]);
}

/** Associate the current device with `playerId` (correction #2 pairs this with
 *  logoutOneSignal() below). Safe to call before init resolves — OneSignal
 *  queues calls made via OneSignalDeferred. No-ops when not configured. */
export async function loginOneSignal(playerId) {
  if (!playerId) return;
  const appId = await loadAppId();
  if (!appId) return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try { await OneSignal.login(String(playerId)); }
    catch (err) { console.warn('[push-onesignal] login failed', err); }
  });
}

/** correction #2 — MUST be called on sign-out and on player switch, or a
 *  handed-off phone keeps receiving the previous player's pushes. */
export async function logoutOneSignal() {
  const appId = await loadAppId();
  if (!appId) return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try { await OneSignal.logout(); }
    catch (err) { console.warn('[push-onesignal] logout failed', err); }
  });
}

/**
 * Best-effort read of the current permission/subscription state for the
 * Notification Center's priming card (DI-A2). Returns one of:
 *   'unconfigured' — no App ID (feature not live yet)
 *   'unsupported'  — Notification API absent / no web push on this browser
 *   'needs-install' — iOS Safari not installed as a PWA (install card, no button)
 *   'never-asked'  — Notification.permission === 'default'
 *   'denied'       — Notification.permission === 'denied'
 *   'granted'      — Notification.permission === 'granted'
 * Deliberately does NOT wait on the OneSignal SDK round-trip for the coarse
 * never-asked/denied/granted split — the browser's own `Notification.permission`
 * is synchronous and authoritative for that. OneSignal is only consulted (by
 * the caller, separately) for finer subscription detail once granted.
 */
export async function subscriptionState() {
  if (!(await isPushConfigured())) return 'unconfigured';
  // Support is decided by the SDK's OWN predicate (pushSupportLevel), so the
  // card we render and the SDK's willingness to load can never disagree —
  // that disagreement was the reported bug.
  const support = pushSupportLevel();
  if (support === 'needs-install') return 'needs-install';
  if (support !== 'supported') return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  const perm = Notification.permission;
  if (perm === 'granted') return 'granted';
  if (perm === 'denied') return 'denied';
  return 'never-asked';
}

/**
 * N1 / DI-N3 (UN-204, Drew's R10, 2026-09-12) — "OneSignal reports opted-in",
 * the second of the three terms in app.js's pushActive predicate.
 *
 * WHY IT IS SEPARATE FROM subscriptionState(). That function deliberately stops
 * at the browser's own synchronous `Notification.permission` and says so in its
 * docstring ("OneSignal is only consulted, by the caller, separately, for finer
 * subscription detail once granted"). This IS that separate consultation, and
 * it answers a genuinely different question: permission granted means the
 * BROWSER will allow a notification; opted-in means THIS DEVICE currently has a
 * live subscription record OneSignal can actually send to. They diverge in
 * exactly the case that matters here — a player who granted permission on a
 * phone whose subscription was later revoked, un-installed or logged out would
 * otherwise be told "push is carrying this device" while nothing arrives, and
 * R10 would then swallow the in-app toast as well. That is UN-N3's failure
 * (not having push must never be the same as going blind), so this fails
 * CLOSED: any SDK absence, throw or timeout resolves FALSE.
 *
 * Never throws. Never waits forever — the deferred queue may never drain on a
 * browser where the SDK 404'd, so the read is raced against a short timeout,
 * the same shape ensureOneSignalInit() already uses.
 */
const OPTED_IN_TIMEOUT_MS = 3000;
export async function isPushOptedIn() {
  try {
    if (typeof window === 'undefined') return false;
    if (!(await isPushConfigured())) return false;
    const read = new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push((OneSignal) => {
        try { resolve(OneSignal?.User?.PushSubscription?.optedIn === true); }
        catch { resolve(false); }
      });
    });
    const timer = new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), OPTED_IN_TIMEOUT_MS);
      t?.unref?.();   // node-only; keeps test harnesses from hanging on the timer
    });
    return await Promise.race([read, timer]);
  } catch { return false; }
}

/** Triggers the native permission prompt — must be called from a genuine user
 *  gesture (DI-A2's "Turn On" button handler), never on first paint. */
/** Turn an SDK throw into one of our reasons. Deliberately prefers the LIVE
 *  `Notification.permission` over string-matching a minified error, and only
 *  falls back to the message for the one case the permission state cannot
 *  express (the worker never installed). */
function classifyPermissionError(err) {
  const msg = describeErr(err);
  if (/service worker/i.test(msg)) return { reason: 'sw-not-found', detail: msg };
  const perm = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
  if (perm === 'denied' || /permission blocked/i.test(msg)) return { reason: 'denied', detail: msg };
  // The SDK throws a LITERAL Error("Permission dismissed") for a dismissal.
  // Only that is a dismissal. Treating every permission-still-"default" throw
  // as one told the player "tap Turn On again and choose Allow" for failures
  // that never reached a prompt — advice that cannot work.
  if (/dismiss/i.test(msg)) return { reason: 'dismissed', detail: msg };
  return { reason: 'request-failed', detail: msg };
}

/**
 * Triggers the native permission prompt — must be called from a genuine user
 * gesture (DI-A2's "Turn On" button handler), never on first paint.
 *
 * Resolves `{ ok, reason, detail? }`. `reason` is one of:
 *   'granted'              — the only ok:true value
 *   'not-configured'       — config.json read fine, no oneSignalAppId
 *   'config-unreachable'   — config.json itself could not be read
 *   'no-browser'           — not a DOM environment
 *   'not-installed-ios'    — Apple handheld, not added to the Home Screen yet
 *   'unsupported-browser'  — the SDK refuses this browser outright
 *   'sdk-not-loaded'       — script 404'd, or loaded but never drained its queue
 *   'web-push-not-enabled' — the OneSignal app has no Web Push platform set up
 *   'app-id-mismatch'      — the App ID matches no OneSignal app
 *   'wrong-site-origin'    — the OneSignal app is bound to a different origin
 *   'init-already-spent'   — a second init() after a failed first (should be
 *                            unreachable now that init runs at most once)
 *   'init-failed'          — any other init throw
 *   'denied' | 'dismissed' | 'sw-not-found' | 'prompt-timeout' | 'request-failed'
 *
 * It used to resolve a bare boolean. Four unrelated failures (SDK never loaded,
 * init already spent, worker not found, prompt dismissed) all landed on the
 * same `false`, so app.js could only ever say "Could not enable push" — a
 * message that names no cause and suggests no action. The reason code is the
 * fix; the copy that maps onto it lives in app.js's pushFailureMessage().
 */
export async function requestPushPermission() {
  const init = await ensureOneSignalInit();
  if (!init.ok) return { ok: false, reason: init.reason, detail: init.detail };

  // Already hard-blocked: the browser will not show a prompt, so calling
  // requestPermission() would just throw and read as a mystery failure.
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, reason: 'denied' };
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const t = setTimeout(() => finish({ ok: false, reason: 'prompt-timeout' }), PROMPT_TIMEOUT_MS);
    t?.unref?.();
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.Notifications.requestPermission();
        clearTimeout(t);
        const perm = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
        if (perm === 'granted') finish({ ok: true, reason: 'granted' });
        else if (perm === 'denied') finish({ ok: false, reason: 'denied' });
        else finish({ ok: false, reason: 'dismissed' });
      } catch (err) {
        clearTimeout(t);
        console.warn('[push-onesignal] permission request failed', err);
        finish({ ok: false, ...classifyPermissionError(err) });
      }
    });
  });
}

/**
 * §3 step 3 — ACTIVE-VIEW SUPPRESSION, client-side only. The server always
 * sends; suppressing the OS banner when the player is already looking at the
 * relevant screen is a client rendering choice, never a policy-layer decision
 * (the backend cannot know foreground state without a heartbeat, which is
 * exactly the write-pressure risk this batch's design avoids elsewhere).
 *
 * `destinationForEvent(event)` -> { tab, params } — pass
 * js/notifications.js's `destinationFor` here from app.js at boot. Kept as an
 * injected function rather than an import so this module never depends on
 * notifications.js (one-directional dependency graph: app.js wires both).
 *
 * BUG-12 (2026-09-12) — `onForegroundPush(event)` is the second, optional
 * injected callback: "a push landed while this app is open." app.js passes the
 * chat engine's wakeChat(), which is why this module still depends on nothing
 * (it does not know what a chat fetch is, and AD-16's single chat-backend
 * caller is unchanged). It runs BEFORE and INDEPENDENTLY of the suppression
 * rule below, on purpose:
 *   • a payload with no `event` in additionalData still means a message
 *     exists — the fetch must not be gated on copy metadata;
 *   • the SUPPRESSED case (player already on the destination tab) is exactly
 *     the case where the room is the only surface the notice has, so it is the
 *     one that most needs to be current.
 */
export function wireForegroundSuppression(destinationForEvent, onForegroundPush) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', (e) => {
        try {
          const event = e?.notification?.additionalData?.event;
          // BUG-12 — fetch first, unconditionally. Its own try/catch: a failed
          // wake must never cost the player the banner.
          if (typeof onForegroundPush === 'function') {
            try { onForegroundPush(event || null); } catch (err) { console.warn('[push-onesignal] foreground fetch hook failed', err); }
          }
          if (!event || typeof destinationForEvent !== 'function') return;
          const dest = destinationForEvent(event);
          const activeTab = document.body?.dataset?.tab;
          if (dest?.tab && activeTab && dest.tab === activeTab) {
            e.preventDefault();   // suppress the OS banner — player is already looking at it
          }
        } catch { /* never let a suppression bug block a real notification */ }
      });
    } catch (err) { console.warn('[push-onesignal] foreground hook failed', err); }
  });
}

/**
 * BUG-12 (2026-09-12) — THE TAP, for the case where the app is already running.
 *
 * Drew: "When I click the push, I should be able to see the message in the
 * chat." There are two tap paths and they are not the same path:
 *
 *   COLD / relaunch — the SDK's own merged service worker opens the payload's
 *     `url` (backend/Code.gs buildDestinationUrl -> "?ntab=chat&nparams=…"),
 *     app.js's boot parses it and calls deepLinkTo(), which is where the forced
 *     fetch and the wait for it live. Nothing here is involved.
 *   WARM — the app is already open; the SDK focuses/navigates the existing
 *     page. Whether that re-runs boot (and therefore the ?ntab parse) is not
 *     something this side can know, and on an installed iOS PWA a resume does
 *     not reliably fire visibilitychange either (boottest.mjs §5's stated
 *     unknown). THIS hook is the signal that does not depend on either.
 *
 * Deliberately does NOT route the tap: the SDK's URL open already owns
 * navigation (correction #1 — we never hand-author notificationclick
 * handling), and a second router here would be a second answer to the same
 * question. Its only job is "something arrived; go look now."
 */
export function wireNotificationClicks(onClick) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      OneSignal.Notifications.addEventListener('click', (e) => {
        try {
          const data = e?.notification?.additionalData || null;
          if (typeof onClick === 'function') onClick(data?.event || null, data);
        } catch (err) { console.warn('[push-onesignal] click hook failed', err); }
      });
    } catch (err) { console.warn('[push-onesignal] click wiring failed', err); }
  });
}

/** Test-only reset — mirrors the _resetForTest() convention used elsewhere
 *  (chat.js, backend.js) so notifytest.mjs can exercise loadAppId() fresh. */
export function _resetForTest({ sdkReadyMs, promptMs } = {}) {
  _appId = null;
  _scriptPromise = null;
  _initOnce = null;
  _configUnreachable = false;
  // Optional: shrink the two no-dead-tap bounds so notifytest.mjs can prove
  // "every tap gets an answer" in milliseconds. Omit them and the production
  // values (12s / 120s) are restored.
  SDK_READY_TIMEOUT_MS = sdkReadyMs ?? 12000;
  PROMPT_TIMEOUT_MS = promptMs ?? 120000;
}
