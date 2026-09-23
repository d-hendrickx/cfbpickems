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

import { isNativeShell } from './platform.js';

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
/**
 * ══ SECURITY F-2 (seventh gate, 2026-09-17) — MEMOIZE THE PROMISE, NOT JUST
 *    THE VALUE ═════════════════════════════════════════════════════════════════
 *
 * THE DEFECT, reproduced: `_appId` is only assigned AFTER the fetch resolves, so
 * two callers that arrive before the first read lands both miss the memo and
 * both start their own `config.json` request. loginOneSignal() and
 * logoutOneSignal() each await this before queueing onto OneSignalDeferred — so
 * the ORDER they queue in is the order the two independent network reads happen
 * to come back in, not the order the app called them. With a handover
 * (logout-then-login, which DI-180q deliberately sequences that way) a logout
 * whose read is slower lands SECOND and the sequence becomes
 * `["login:mB", "logout"]`: the incoming player is bound to nobody and silently
 * receives no pushes for the rest of the session. That is the exact failure
 * DI-180q's ordering fix was written to prevent, re-entered one layer down.
 *
 * Memoizing the PROMISE makes the second caller await the FIRST caller's read,
 * so both resume in call order. The existing "a failure is not memoized" rule
 * (the 2026-09-10 regression below) is preserved exactly: the in-flight promise
 * is dropped again on any outcome that is not a definitive App ID, so one
 * transient blip at boot can no longer pin push to "not configured" for the life
 * of the page.
 *
 *  RG (2026-09-10): this used to memoize the FAILURE too (`_appId = ''` on a
 *  thrown fetch), so one transient network blip at boot pinned push to
 *  "not configured" for the entire life of the page — the priming card then
 *  renders nothing at all and there is no way back without a reload. Only a
 *  successful read is memoized now; a failed read returns '' and is retried.
 */
let _appIdPromise = null;
async function _readAppId() {
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
function loadAppId() {
  if (_appId !== null) return Promise.resolve(_appId);
  // `??=` so concurrent callers share ONE read and therefore resume in the order
  // they called, which is the whole point (security F-2).
  _appIdPromise ??= _readAppId().finally(() => {
    // Cleared on EVERY outcome. When the read was definitive `_appId` is set and
    // the fast path above never reaches the promise again; when it was transient
    // `_appId` is still null and the next caller starts a fresh read — the
    // failure-is-not-memoized rule, unchanged.
    _appIdPromise = null;
  });
  return _appIdPromise;
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
  // DI-210e — the native iOS shell never loads the OneSignal web SDK; native
  // push (send + device identity) is parked on the Supabase thread's Step 6
  // Phase 2 (AD-67). Same inert shape the module already resolves on a
  // failed <script> load (s.onerror above), so no caller sees a new shape.
  if (isNativeShell()) return Promise.resolve(false);
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
  // DI-210e — suppress, don't remove. The web SDK must not load/init inside
  // the native shell (AD-67: no Apps Script, and native push waits on the
  // Supabase thread's Step 6 Phase 2). Reuses the exact inert shape the
  // module already returns for a browser it refuses outright, so every
  // existing caller (app.js's pushFailureMessage(), the Notification
  // Center) needs zero new branches to stay correct.
  if (isNativeShell()) return { ok: false, reason: 'unsupported-browser' };
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

/**
 * ══ SECURITY F-3 (EIGHTH gate, 2026-09-18) — ORDER IS A CHAIN, NOT A SIDE
 *    EFFECT OF THE MEMO ═════════════════════════════════════════════════════════
 *
 * The seventh gate made loginOneSignal()/logoutOneSignal() resume in call order
 * by memoizing loadAppId()'s PROMISE, so two concurrent callers await the same
 * read. That was correct and it is still here — but it bought ordering as a
 * SIDE EFFECT of a cache, and the cache has a teardown: `loadAppId()`'s
 * `.finally()` sets `_appIdPromise = null` on every outcome (the
 * failure-is-not-memoized rule, which must stay). There is therefore a window,
 * a few microtasks wide, in which the first caller has torn the memo down and
 * the second caller has not yet reached the `_appId !== null` fast path — so the
 * second call starts its OWN read and can resume FIRST.
 *
 * On a handover that is the whole bug back again: DI-180q deliberately sequences
 * logout-then-login, and if those two invert, `OneSignal.login()` is queued
 * before `OneSignal.logout()`, the logout wins, and the INCOMING player is bound
 * to nobody — silently receiving no pushes for the rest of the session, which is
 * indistinguishable from "push isn't working on my phone."
 *
 * So ordering stops depending on the memo at all. Every OneSignal-affecting call
 * goes through ONE chain: link N+1 does not start until link N has settled, so
 * the order OneSignalDeferred is pushed is exactly the order the app called,
 * whatever config.json is doing.
 *
 * `.then(fn, fn)` — the SAME function as both handlers — is what keeps the chain
 * alive across a failure. A rejected link would otherwise poison every later one,
 * which would mean one failed logout permanently disabling push identity for the
 * page. `fn` ignores its argument, so it does not care which slot it was called
 * in.
 */
let _osChain = Promise.resolve();
function _queueOneSignalCall(fn) {
  _osChain = _osChain.then(fn, fn);
  return _osChain;
}

/**
 * ══ RG-192 (2026-09-20) — THE EXTERNAL ID WAS NEVER ATTACHED ════════════════
 *
 * LIVE EVIDENCE. The commissioner's "Check who can receive push" (Edge Function
 * push-reach) answered: p1 — 1 device; p2…p6 — NO device registered. Meanwhile
 * notify-fanout had been recording `recipients:5, pushed:5` for every chat
 * message since the server-push flip, because "pushed" only means OneSignal
 * ACCEPTED an `include_external_user_ids` request. With no subscription behind
 * an external id, nothing is delivered and NOTHING ANYWHERE SAYS SO.
 *
 * THE MECHANISM. Both functions below used to await the App ID and then push a
 * callback straight onto `window.OneSignalDeferred`, on the documented-sounding
 * but wrong assumption that "OneSignal queues calls made via OneSignalDeferred"
 * means the SDK will hold them until init finishes. It does not. The v16 SDK
 * drains that queue by INVOKING each callback — it does not await them in
 * series — so every callback queued before the first drain runs while
 * `OneSignal.init()` is still an unsettled promise, and every public SDK call
 * asserts initialisation first and THROWS. The throw landed in the `catch` here
 * as a console.warn, and nothing ever retried it.
 *
 * WHY IT ONLY STARTED BITING AT THE SUPABASE CUTOVER. In PIN mode
 * `getSession()` was a synchronous localStorage read, so the only caller was
 * app.js's boot tail — INSIDE `ensureOneSignalInit().then(...)`, i.e. after
 * init, which is why this worked for a year. In `authMode:'supabase'` identity
 * arrives on an auth EVENT, and app.js's chokepoint (app.js:3832) fires from
 * `wireAuthUIEvents()` during `applyAuthModeDecision()` — ABOVE the hydrate,
 * while `ensureOneSignalInit()` is only reached afterwards, in
 * `runPostHydrateTail()` (app.js:1906). The hydrate cannot even begin until
 * memberships resolve (it needs the active league), so on a Supabase boot the
 * login is queued FIRST, essentially always. The cutover inverted the order and
 * the failure was silent on both ends.
 *
 * THE FIX IS ONE CHOKEPOINT. `_assertIdentity()` below is the ONLY place in this
 * module that calls `OneSignal.login()`/`OneSignal.logout()`, and it awaits
 * `ensureOneSignalInit()` first — which also means an identity change now LOADS
 * the SDK rather than queueing into a script that was never requested. It never
 * prompts (init only; the permission sheet stays exclusively behind the Turn On
 * button), it never touches storage, and it can never raise the red sync banner.
 *
 * WHAT IS DELIBERATELY UNCHANGED: the serialization chain (security F-3) still
 * decides the ORDER — a handover's logout-then-login still lands in call order,
 * because each first attempt runs as its own chain link, in the order the app
 * called. Only the bounded RETRIES are generation-guarded, so a retry belonging
 * to an identity this device has already left can never overwrite a newer one.
 */

/** Bounded, and bounded on purpose. Three attempts over ~5s covers a slow SDK
 *  (`ensureOneSignalInit()` resolves 'sdk-not-loaded' at its ready timeout
 *  without memoizing that answer, so a later attempt re-awaits the same single
 *  init and gets the real one). A fourth attempt would buy a device that is
 *  never coming back nothing, and an unbounded loop is a background timer on
 *  every phone in the league. */
const IDENTITY_RETRY_DELAYS_MS = [400, 4000];

/**
 * ══ DI-254 (UN-236) — THE IDENTITY TOKEN ════════════════════════════════════
 *
 * WHY. `OneSignal.login('p2')` is a string anybody can type into a console on
 * irbfootball.com, and until OneSignal is told to check, it complies — binding
 * that browser to another player's notifications. The remedy is OneSignal's
 * Identity Verification: a JWT, signed server-side with a secret that never
 * leaves the Edge Function, proving the device is asking for its OWN id.
 *
 * WHAT THIS HALF DOES, and the two rules it must never break:
 *   • it fetches a token from `push-identity-token` and passes it as
 *     `OneSignal.login(id, token)` — at the ONE chokepoint below, which is
 *     already the only place in the app that calls login()/logout() (RG-192);
 *   • IT NEVER PROMPTS. Minting a token is a fetch. It cannot raise the
 *     permission sheet, and nothing on this path calls anything that can.
 *   • IT NEVER TOUCHES STORAGE. The token lives in this module's memory for the
 *     life of the page and nowhere else — not `load()`/`save()`, not
 *     localStorage, not a cookie. A credential that outlives the tab is a
 *     credential somebody can find later, and it is re-mintable in one call.
 *
 * WHEN THE MINT FAILS, THE DEVICE STAYS UNLINKED — on purpose, and this is the
 * part worth reading twice. A `login()` without a token, once enforcement is on,
 * is refused by OneSignal anyway; the difference is only whether the app knows.
 * So a failed mint folds into the EXISTING bounded retry ladder
 * (`_scheduleIdentityRetry`, 400ms then 4000ms then stop), and after that the
 * device reads, through the status line that already exists, "This device is
 * registered for push but isn't linked to your account yet… Tap Reconnect."
 * NO red banner (AD-06 is about sync, and this is not sync), no toast, no
 * prompt, and Reconnect re-runs `loginOneSignal()`, which mints again.
 *
 * ── WHY THE SUPABASE CLIENT ARRIVES BY `await import()` ────────────────────
 * `js/auth.js` imports THIS module (for `logoutOneSignal()` on sign-out), so a
 * static `import … from './auth.js'` here would close a cycle — and the import
 * graph's acyclicity is a claim other modules already reason from in writing
 * (see js/chat.js's header). A dynamic import inside the call creates no module
 * edge at all: by the time this runs, `auth.js` is long since evaluated and the
 * import resolves from cache. The precedent is `js/push-selftest.js:155`, which
 * reaches `getJobRuns` the same way.
 */
/** 24h tokens, re-minted five minutes early: a token that expires mid-call is a
 *  login that fails for a reason nobody can see. */
const IDENTITY_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** `{ subject, token, expiresAtMs }` — MEMORY ONLY. Cleared by _resetForTest(),
 *  and by closing the tab, which is the whole of its lifetime. */
let _identityToken = null;
/** Test seam ONLY. See `_setIdentityMinterForTest()`. */
let _identityMinter = null;

/**
 * Ask the Edge Function for this device's own token. Never throws; every
 * outcome is `{ok}` because every outcome is a state the caller has to handle.
 *
 * THE FUNCTION TAKES NO IDENTITY ARGUMENT, and that is the design: the id it
 * signs comes from the caller's own Supabase JWT, server-side, through
 * `my_member_id` under RLS. There is deliberately nowhere on the wire to ask
 * for somebody else's.
 */
async function _mintIdentityToken() {
  if (typeof _identityMinter === 'function') {
    try { return await _identityMinter(); } catch { return { ok: false, reason: 'mint-threw' }; }
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
    const expiresAtMs = Date.parse((data && data.expiresAt) || '');
    return { ok: true, token, expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : 0 };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * The cached token for `target`, minting one when there is nothing usable.
 *
 * THE CACHE IS KEYED ON THE SUBJECT. A handover (logout, then a different
 * player's login on the same handset) must never reuse the previous occupant's
 * token — that would be the impersonation this feature exists to stop, arriving
 * from our own cache instead of a console.
 *
 * AN UNPARSEABLE `expiresAt` IS NOT CACHED AT ALL. A token whose expiry we
 * cannot read is one we cannot refresh on time, and minting again is one cheap
 * call (CONVENTIONS #10: an absent field is not a value to invent).
 */
async function _identityTokenFor(target) {
  const cached = _identityToken;
  if (cached && cached.subject === target
      && cached.expiresAtMs - Date.now() > IDENTITY_TOKEN_REFRESH_MARGIN_MS) {
    return { ok: true, token: cached.token };
  }
  const minted = await _mintIdentityToken();
  if (!minted.ok) return minted;
  _identityToken = minted.expiresAtMs
    ? { subject: target, token: minted.token, expiresAtMs: minted.expiresAtMs }
    : null;
  return { ok: true, token: minted.token };
}
/** Reasons worth a retry: the SDK/its config might still turn up. Everything
 *  else ('unsupported-browser', 'not-installed-ios', 'not-configured',
 *  'web-push-not-enabled', 'app-id-mismatch', 'wrong-site-origin') is a settled
 *  fact about this device or this league, and retrying it is a lie told to a
 *  timer. */
const RETRYABLE_INIT_REASONS = new Set(['sdk-not-loaded', 'config-unreachable', 'init-failed']);

/**
 * The real timers, captured (and bound) at import.
 *
 * Every timer below is an INTERNAL BOUND — "give up waiting on the SDK", "try
 * the identity again" — not work the app scheduled and not work anything else
 * is entitled to observe. Capturing them here makes those bounds independent of
 * whatever replaces the global later, which matters in both directions: a page
 * that wraps setTimeout cannot delay or swallow a bound, and a harness that
 * replaces setTimeout to capture ITS OWN next tick cannot have that tick
 * overwritten by a background push retry. The second direction is not
 * hypothetical — it cost loadtest.mjs [72] three assertions, and the same shape
 * on a real page (an analytics wrapper, a polyfill) would be invisible.
 *
 * `.bind()` rather than a bare reference: `window.setTimeout` called unbound
 * throws "Illegal invocation" in some browsers.
 */
const _timerHost = (typeof window !== 'undefined' && window && typeof window.setTimeout === 'function') ? window : globalThis;
const _setTimeout = _timerHost.setTimeout.bind(_timerHost);
const _clearTimeout = _timerHost.clearTimeout.bind(_timerHost);

/** The external id this PAGE has actually attached, as proven by a login() that
 *  returned rather than threw. '' means unbound. Read by pushDeviceStatus() as a
 *  FALLBACK only — the SDK's own `User.externalId` outranks it when present — so
 *  the player-facing status line cannot claim a linkage the SDK never made. */
let _boundExternalId = '';
/** Bumped by every login/logout. A retry whose generation is stale is dropped. */
let _identityGen = 0;
/** The identity the app most recently ASKED for ('' = signed out). Security F-2:
 *  a stale SDK call that lands late re-asserts THIS, rather than being allowed to
 *  leave the device on a superseded identity. */
let _desiredTarget = '';
/** Bounded re-assert budget, refilled by every login/logout. Without a bound, two
 *  calls that keep landing out of order could ping-pong forever on a bad link. */
const MAX_STALE_REASSERTS = 3;
let _staleReassertBudget = MAX_STALE_REASSERTS;
/** The highest generation whose SDK call has actually COMPLETED. This is what
 *  separates "superseded, and a later call is still on its way" (harmless — that
 *  later call is the one that wins) from "superseded, and it landed AFTER the
 *  call that superseded it" (the real hazard: the SDK is now on the wrong
 *  identity and nothing else is coming). Only the second re-asserts. */
let _lastCompletedGen = 0;

/**
 * Queue `fn(OneSignal)` and report the outcome to `done(ok)` — LATER, off the
 * chain.
 *
 * IT DOES NOT HOLD THE SERIALIZATION CHAIN, and that is deliberate. Ordering is
 * established by the ORDER THE CALLBACKS ARE PUSHED, which is chain order;
 * waiting here for the SDK to actually invoke one would park every later
 * identity call behind a queue that only the SDK can drain — up to the full
 * ready bound on a device where it never does, which is exactly the class of
 * stall this module has been bitten by before.
 *
 * `done(false)` on a throw OR on the SDK never draining, so the caller's bounded
 * retry is armed in both cases.
 */
function _callSdk(fn, done) {
  let settled = false;
  const finish = (v) => { if (!settled) { settled = true; try { done(v); } catch { /* a reporter must never break the queue */ } } };
  const t = _setTimeout(() => finish(false), SDK_READY_TIMEOUT_MS);
  t?.unref?.();   // node-only; keeps test harnesses from hanging on the timer
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try { await fn(OneSignal); _clearTimeout(t); finish(true); }
    catch (err) { _clearTimeout(t); console.warn('[push-onesignal] identity call failed', err); finish(false); }
  });
}

/**
 * Assert `target` ('' = signed out) on the SDK, once, and arm a bounded retry if
 * it could not be done. THE ONLY caller of OneSignal.login()/logout().
 */
async function _assertIdentity(target, gen, attempt = 0) {
  // A retry for an identity this device has already left is dropped. The FIRST
  // attempt is never dropped — it is the app's own call, in the app's own order.
  if (attempt > 0 && gen !== _identityGen) return;
  const init = await ensureOneSignalInit();
  if (attempt > 0 && gen !== _identityGen) return;
  if (!init.ok) {
    if (RETRYABLE_INIT_REASONS.has(init.reason)) _scheduleIdentityRetry(target, gen, attempt);
    return;
  }
  // ── DI-254 — THE TOKEN, BEFORE THE LOGIN, AND NO LOGIN WITHOUT ONE ────────
  //
  // A login() with no token is refused by OneSignal once enforcement is on, so
  // "try anyway" would not be a degraded success — it would be the same
  // failure, minus any record that we knew. The mint is therefore a precondition
  // of the call, and a failed mint arms the SAME bounded ladder an
  // SDK-not-loaded init already gets (400ms, 4000ms, then the device reads
  // "isn't linked… Reconnect" and waits for a tap).
  //
  // A LOGOUT NEEDS NO TOKEN: it asserts nobody, so there is no identity to
  // prove — and a sign-out that could be blocked by a network failure would
  // leave a handed-off phone on the previous player's id, which is the exact
  // thing correction #2 exists to prevent.
  let identityToken = '';
  if (target) {
    const minted = await _identityTokenFor(String(target));
    // The same staleness re-check the awaits above make: a retry for an identity
    // this device has already left must not resume after its own await.
    if (attempt > 0 && gen !== _identityGen) return;
    if (!minted.ok) {
      _scheduleIdentityRetry(target, gen, attempt);
      return;
    }
    identityToken = minted.token;
  }
  _callSdk(
    target ? (OneSignal => OneSignal.login(String(target), identityToken)) : (OneSignal => OneSignal.logout()),
    (ok) => {
      // ══ SECURITY F-2 (RG-192 gate, 2026-09-20) — A SLOW CALL MUST NOT WIN ══
      //
      // _callSdk deliberately does not hold the chain (see its header), which
      // buys ordering of the PUSHES but not of the COMPLETIONS: a login('A')
      // that the SDK takes seconds to resolve can land after a logout() or a
      // login('B') has already been pushed and run. The old `return` here was
      // right about not recording a stale binding — and wrong about the device,
      // which is now sitting on A with nobody noticing.
      //
      // So a stale completion does not merely decline to record; it RE-ASSERTS
      // whatever the app currently wants. Budgeted rather than unconditional,
      // because two calls that keep landing out of order must converge, not
      // ping-pong.
      // Landed out of order ONLY if something newer has already completed. A
      // completion that is merely superseded by a call still in flight needs no
      // help: that call was pushed after this one and will be invoked after it.
      const landedOutOfOrder = gen < _lastCompletedGen;
      if (gen > _lastCompletedGen) _lastCompletedGen = gen;
      if (gen !== _identityGen) {
        if (!landedOutOfOrder) return;
        if (_staleReassertBudget <= 0) {
          console.warn('[push-onesignal] a superseded identity call landed late and the re-assert budget is spent; this device may be bound to the wrong id until it is reloaded');
          return;
        }
        _staleReassertBudget--;
        const want = _desiredTarget;
        _queueOneSignalCall(() => _assertIdentity(want, _identityGen));
        return;
      }
      if (ok) { _boundExternalId = target ? String(target) : ''; return; }
      _scheduleIdentityRetry(target, gen, attempt);
    },
  );
}

function _scheduleIdentityRetry(target, gen, attempt) {
  const delay = IDENTITY_RETRY_DELAYS_MS[attempt];
  if (delay === undefined) {
    console.warn('[push-onesignal] could not attach the push identity after', IDENTITY_RETRY_DELAYS_MS.length + 1,
      'attempts — this device will not receive push until it is reloaded or Turn On is tapped');
    return;
  }
  const t = _setTimeout(() => {
    if (gen !== _identityGen) return;
    _queueOneSignalCall(() => _assertIdentity(target, gen, attempt + 1));
  }, delay);
  t?.unref?.();   // node-only; never holds a test harness (or Node) open
}

/** Associate the current device with `playerId` (correction #2 pairs this with
 *  logoutOneSignal() below). Idempotent: safe — and expected — to call on every
 *  boot and every identity change. No-ops when not configured.
 *
 *  ORDER AGAINST logoutOneSignal() IS STRUCTURAL, NOT LUCK: both go through
 *  `_queueOneSignalCall()` above, so the app's call order is the queue order
 *  regardless of where loadAppId()'s memo happens to be. Security F-2 (seventh
 *  gate) made them share one config read; security F-3 (eighth) made the sharing
 *  unnecessary for correctness. */
export async function loginOneSignal(playerId) {
  // DI-210e (PASS 1b) — guarded at THIS entry, not at app.js's call site, so
  // the .then() chain after ensureOneSignalInit() in app.js needs no edit:
  // ensureOneSignalInit() already resolves inert on native (DI-210e, pass
  // 1a), and every function its .then() calls next no-ops here too. Same
  // inert shape as the "no App ID" early return below (undefined).
  if (isNativeShell()) return;
  if (!playerId) return;
  const gen = ++_identityGen;
  _desiredTarget = String(playerId);
  _staleReassertBudget = MAX_STALE_REASSERTS;
  return _queueOneSignalCall(() => _assertIdentity(String(playerId), gen));
}

/** correction #2 — MUST be called on sign-out and on player switch, or a
 *  handed-off phone keeps receiving the previous player's pushes. Serialized
 *  against loginOneSignal() through the same chain (security F-3). */
export async function logoutOneSignal() {
  // DI-210e (PASS 1b) — guarded HERE, at the function's own entry, so
  // js/auth.js's `logoutOneSignal()` call site near :51 needs NO edit
  // (auth.js is EXCLUSIVE to the Supabase thread right now). Same inert
  // shape as loginOneSignal()'s native guard, above.
  if (isNativeShell()) return;
  const gen = ++_identityGen;
  _desiredTarget = '';
  _staleReassertBudget = MAX_STALE_REASSERTS;
  // Dropped IMMEDIATELY, not on the SDK's answer: from this instant the app's
  // own idea of "who is this device" is nobody, and the status line must say so
  // even if the SDK call is still in flight or fails.
  _boundExternalId = '';
  return _queueOneSignalCall(() => _assertIdentity('', gen));
}

/** The external id this device is currently bound to, '' when unbound. Proven
 *  by a login() that returned — never by what the app intended. */
export function boundExternalId() { return _boundExternalId; }

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
 *
 * DI-210e item 2 (PASS 1b) — a SIXTH state, 'native-unavailable', checked
 * FIRST and before any async config read: inside the native shell, native
 * push waits on the Supabase thread's Step 6 Phase 2 (AD-67), and the
 * Notification Center's priming card must say so honestly rather than
 * showing web-push copy or the nonsensical "Add to Home Screen" instructions
 * (that install step makes no sense inside an app already installed via
 * TestFlight). Both of app.js's subscriptionState() consumers
 * (refreshPushActiveFlag(), refreshNotifSettingsBody()) get this for free —
 * neither needs its own native branch.
 */
export async function subscriptionState() {
  if (isNativeShell()) return 'native-unavailable';
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
    // DI-210e (PASS 1b) — defense-in-depth. subscriptionState() already
    // resolves 'native-unavailable' on the shell, so refreshPushActiveFlag()
    // (app.js) never reaches this call in production — but a direct caller
    // must not pay OPTED_IN_TIMEOUT_MS's 3s wait on native either.
    if (isNativeShell()) return false;
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

/**
 * ══ RG-192, THE OTHER HALF — "PUSH IS ON" HAS TO BE TRUE ════════════════════
 *
 * Drew's iPhone, live: iOS Settings → Notifications shows Pick 'Ems ALLOWED,
 * the app's 🔔 screen shows no priming card at all and every box ticked — and
 * OneSignal has no subscription for that device. The app said push was on. It
 * was not, and there was no button anywhere that would have fixed it, because
 * app.js's renderPrimingCardHTML() returns '' for 'granted' and the master
 * toggle is a PLAYER preference that knows nothing about this handset.
 *
 * "Push is on for this device" is an AND of THREE facts, and the reason this
 * function exists is that the app had only ever checked the first:
 *
 *   permission === 'granted'   the browser will allow a notification
 *   hasSubscription            OneSignal has a live subscription record here
 *   linked                     …with THIS player's external id attached to it
 *
 * Any of the three false means the server can address the player, OneSignal can
 * accept the request, and the phone can stay silent — which is exactly what the
 * whole league has been living in since the cutover.
 *
 * Never throws, never waits forever, and carries NOTHING sensitive: the league
 * member id the app already renders on every screen, and three booleans. It is
 * meant to be read out loud to the commissioner.
 */
/**
 * ══ RG-193 (2026-09-21) — THE BROWSER'S OWN RECORD, WHICH OUTRANKS THE SDK'S ══
 *
 * Drew's iPhone reported "Push is on for this device" — permission granted, a
 * subscription id present, the external id linked — while OneSignal's dashboard
 * held NO iOS subscription for the whole league (one stale Chrome record, and
 * that one flagged "no longer receiving notifications").
 *
 * `OneSignal.User.PushSubscription.id` is the SDK's own record id, read from
 * its local store. It can survive a subscription that the browser no longer
 * has: a service-worker registration that was replaced, an endpoint the push
 * service expired, a PWA re-installed from the home screen. The thing a push is
 * actually delivered to is the browser's `PushSubscription` — and the browser
 * will tell us, synchronously enough, whether one exists.
 *
 * NEVER READS THE ENDPOINT OR THE KEYS. `getSubscription()` returns an object
 * carrying the full endpoint URL and the auth keys; the only thing taken off it
 * is whether it is null. Nothing else is copied, logged or returned.
 *
 * "COULD NOT ASK" IS NOT "NO". A browser with no `navigator.serviceWorker`, a
 * registration that has not resolved, a `pushManager` that throws — all resolve
 * `{known:false}`, and the caller then falls back to exactly the behaviour it
 * had before this existed. Inventing a negative here would put "this device
 * isn't registered" in front of players whose push works.
 */
const BROWSER_SUB_TIMEOUT_MS = 2500;
export async function readBrowserPushSubscription() {
  const unknown = { known: false, subscribed: false };
  try {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return unknown;
    if (typeof navigator.serviceWorker.getRegistration !== 'function') return unknown;
    const ask = (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.pushManager || typeof reg.pushManager.getSubscription !== 'function') return unknown;
      const sub = await reg.pushManager.getSubscription();
      return { known: true, subscribed: !!sub };
    })();
    const timer = new Promise((resolve) => {
      const t = _setTimeout(() => resolve(unknown), BROWSER_SUB_TIMEOUT_MS);
      t?.unref?.();
    });
    return await Promise.race([ask, timer]);
  } catch {
    return unknown;
  }
}

export async function pushDeviceStatus() {
  const state = await subscriptionState();
  const base = {
    state,
    permission: (typeof Notification !== 'undefined' && Notification.permission) || 'unsupported',
    // REVIEWER (RG-192 gate) — `known` SEPARATES "I ASKED AND THE ANSWER IS NO"
    // FROM "I COULD NOT ASK". A blocked extension, a 404'd CDN, an SDK that
    // never drains its queue: all of those leave us with no answer, and
    // reporting no-answer as "this device isn't registered" puts a Reconnect
    // button on screen that cannot keep its promise. For a state below
    // 'granted' the browser's own synchronous permission IS the answer, so
    // those are known by definition.
    known: true,
    hasSubscription: false,
    optedIn: false,
    linked: false,
    externalId: '',
    ok: false,
  };
  if (state !== 'granted') return base;
  const read = new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push((OneSignal) => {
      try {
        const sub = OneSignal?.User?.PushSubscription;
        // REVIEWER — the SDK's OWN external id outranks this page's memory of
        // what it asked for. `_boundExternalId` is a page-local record of a
        // login() that returned; `User.externalId` is what OneSignal actually
        // holds, and it also survives a reload this page knows nothing about.
        // Fall back only when the SDK does not expose it.
        const sdkExternalId = (typeof OneSignal?.User?.externalId === 'string') ? OneSignal.User.externalId : null;
        // RG-193 — `token` is what a push is DELIVERED to; `id` is only
        // OneSignal's record of this device. A record with an id and no token
        // is not deliverable, and iOS hands the token over only once
        // `pushManager.subscribe()` has genuinely succeeded. Read as a
        // THREE-state (`undefined` = the SDK build does not expose it at all),
        // because an absent field must never read as a negative — that would
        // tell working devices they are broken (CONVENTIONS #10).
        const token = sub && typeof sub.token === 'string' ? sub.token : undefined;
        resolve({ known: true, optedIn: sub?.optedIn === true, hasSubscription: !!sub?.id, token, sdkExternalId });
      } catch { resolve({ known: true, optedIn: false, hasSubscription: false, token: undefined, sdkExternalId: null }); }
    });
  });
  const timer = new Promise((resolve) => {
    // The HARDENED timer (see _setTimeout's header): an internal bound must not
    // be capturable by whatever replaced the global.
    const t = _setTimeout(() => resolve({ known: false, optedIn: false, hasSubscription: false, sdkExternalId: null }), OPTED_IN_TIMEOUT_MS);
    t?.unref?.();   // node-only; keeps test harnesses from hanging on the timer
  });
  const sub = await Promise.race([read, timer]);
  if (!sub.known) return { ...base, known: false };
  const externalId = (sub.sdkExternalId !== null && sub.sdkExternalId !== undefined)
    ? sub.sdkExternalId
    : _boundExternalId;
  const linked = !!externalId;

  // ── RG-193 — "HAS A SUBSCRIPTION" IS NOW EVIDENCED, NOT ASSERTED ──────────
  //
  // Three sources, in order of how much they actually prove:
  //   browser  `pushManager.getSubscription()` — the endpoint a push is sent
  //            to. Decisive when we can ask at all.
  //   token    the SDK's own copy of that endpoint's token. Decisive when the
  //            build exposes it.
  //   id       OneSignal's record id. Proves a record, not a device.
  // Each one only ever NARROWS the answer, and each is skipped when it cannot
  // be obtained — so a device this code cannot interrogate reports exactly what
  // it reported before.
  const browser = await readBrowserPushSubscription();
  const tokenExposed = typeof sub.token === 'string';
  const hasSubscription = !!sub.hasSubscription
    && (!tokenExposed || sub.token !== '')
    && (!browser.known || browser.subscribed);
  return {
    ...base,
    optedIn: sub.optedIn,
    hasSubscription,
    // Never the token VALUE, and never the endpoint — only whether one is
    // there. This object is meant to be read out loud to the commissioner.
    tokenKnown: tokenExposed,
    browserSubscription: browser.known ? browser.subscribed : null,
    linked,
    externalId,
    ok: sub.optedIn && hasSubscription && linked,
  };
}

/**
 * ══ REVIEWER BLOCK (RG-192 gate, 2026-09-20) — THE CALL THAT ACTUALLY CREATES
 *    THE SUBSCRIPTION ════════════════════════════════════════════════════════
 *
 * NOTHING in this app called `OneSignal.User.PushSubscription.optIn()`. The
 * Turn On button called `Notifications.requestPermission()`, which on a device
 * whose permission is ALREADY granted resolves instantly and creates nothing —
 * so the button offered for "permission granted, no subscription" could not fix
 * the state it was offered for, and then said "✅ Push enabled" over it.
 *
 * PRECONDITION, LOAD-BEARING: permission must already be 'granted'. v16's
 * `optIn()` will RAISE THE NATIVE PERMISSION PROMPT when it is not, which is
 * precisely what the boot path must never do. Both callers check first, and the
 * check is repeated here so a third caller cannot get it wrong.
 *
 * Idempotent: a device that already has a live subscription is left alone.
 */
export async function ensurePushSubscription() {
  if (isNativeShell()) return { ok: false, reason: 'native-unavailable' };
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { ok: false, reason: 'not-granted' };
  }
  const init = await ensureOneSignalInit();
  if (!init.ok) return { ok: false, reason: init.reason, detail: init.detail };
  // ══ RG-193 (2026-09-21) — THE SHORTCUT THAT MADE THIS A NO-OP ════════════
  //
  // The early return below used to be `if (sub.optedIn === true && sub.id)
  // return;` and nothing else. Both of those come from the SDK's OWN store, and
  // both survive a subscription the browser no longer has — which is precisely
  // the state this function exists to repair. On Drew's iPhone that shortcut
  // fired, `optIn()` was never called, and the call reported `ok:'opted-in'`
  // over a device OneSignal had no subscription for at all.
  //
  // So the browser is asked FIRST, and its answer outranks the cache. "Could
  // not ask" leaves the old behaviour exactly as it was: a device we cannot
  // interrogate is not re-subscribed on every boot.
  const browser = await readBrowserPushSubscription();
  const ran = await new Promise((resolve) => {
    _callSdk(async (OneSignal) => {
      const sub = OneSignal?.User?.PushSubscription;
      if (!sub || typeof sub.optIn !== 'function') throw new Error('OneSignal.User.PushSubscription.optIn is unavailable');
      const staleRecord = browser.known && !browser.subscribed;
      if (sub.optedIn === true && sub.id && !staleRecord) return;   // genuinely subscribed — nothing to do
      await sub.optIn();
    }, resolve);
  });
  if (!ran) return { ok: false, reason: 'opt-in-failed' };

  // ══ RG-193, REVIEWER #2 — WHEN `optIn()` ITSELF IS THE NO-OP ══════════════
  //
  // Calling optIn() is not the same as having subscribed. v16's optIn()
  // SHORT-CIRCUITS when the SDK's own model already believes this device is
  // opted in — the same belief that produced the wrong status line in the first
  // place — so on exactly the device this function exists to repair, the call
  // returns cleanly and mints nothing.
  //
  // So the BROWSER is asked again, and its answer decides. Still no endpoint ⇒
  // the record is recycled: optOut() then optIn(), which forces the SDK through
  // a real `pushManager.subscribe()`.
  //
  // BOUNDED TO ONE CYCLE PER PAGE LOAD. A device that genuinely cannot
  // subscribe (an iOS build that will not mint a token, a blocked push service)
  // must not tear its own subscription down and rebuild it on every render;
  // one attempt is a repair, a loop is a fault of our own making.
  //
  // IT CANNOT PROMPT. This function refuses outright unless
  // `Notification.permission === 'granted'` (see its top), which is what makes
  // every call below prompt-free by construction rather than by care. And it is
  // never reached unasked: the boot path (`maybeAutoOptInPush()`, js/app.js)
  // gates on the player's own master push preference before it calls here.
  const after = await readBrowserPushSubscription();
  if (!(after.known && !after.subscribed)) return { ok: true, reason: 'opted-in' };
  if (_recycleSpent) return { ok: false, reason: 'no-endpoint' };
  _recycleSpent = true;
  const recycled = await new Promise((resolve) => {
    _callSdk(async (OneSignal) => {
      const sub = OneSignal?.User?.PushSubscription;
      if (!sub || typeof sub.optOut !== 'function' || typeof sub.optIn !== 'function') {
        throw new Error('OneSignal.User.PushSubscription.optOut is unavailable');
      }
      await sub.optOut();
      await sub.optIn();
    }, resolve);
  });
  const final = await readBrowserPushSubscription();
  if (final.known && !final.subscribed) return { ok: false, reason: 'no-endpoint' };
  return recycled ? { ok: true, reason: 're-subscribed' } : { ok: false, reason: 'opt-in-failed' };
}

/** The one-recycle-per-page-load latch. Page state, like every other latch in
 *  this module, and reset by `_resetForTest()` for the same reason they are. */
let _recycleSpent = false;

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
  // DI-210e (PASS 1b) — guarded at entry so app.js's boot call site needs no
  // edit. Native never loads the SDK (loadSdkScript()'s own guard above), so
  // window.OneSignalDeferred would just queue a callback the SDK never
  // drains — a latent no-op today, but a real timer/leak the day a native
  // OneSignal path exists. Returning here keeps the shell's queue empty.
  if (isNativeShell()) return;
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
  // DI-210e (PASS 1b) — same reasoning as wireForegroundSuppression() above.
  if (isNativeShell()) return;
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

/**
 * DI-254, TEST SEAM ONLY — stand in for the `push-identity-token` call.
 *
 * WHY IT EXISTS: the production path is `await import('./auth.js')` + a live
 * `functions.invoke`, which in a Node harness resolves to "no session" and would
 * turn every existing identity assertion in pushtest/notifytest/authtest into a
 * test of the offline branch. A suite injects its own minter once and drives the
 * real chokepoint.
 *
 * DELIBERATELY NOT CLEARED BY `_resetForTest()`, unlike everything else here.
 * Every other field below is PAGE state and a scenario must not inherit it; this
 * is HARNESS state — the suite's standing answer to "what does the server say" —
 * and the existing suites call `_resetForTest()` between scenarios, which would
 * otherwise silently unplug it mid-file. Pass `null` to restore the real path.
 */
export function _setIdentityMinterForTest(fn) { _identityMinter = typeof fn === 'function' ? fn : null; }

/** Test-only reset — mirrors the _resetForTest() convention used elsewhere
 *  (chat.js, backend.js) so notifytest.mjs can exercise loadAppId() fresh. */
export function _resetForTest({ sdkReadyMs, promptMs } = {}) {
  // DI-254 — the minted token is per-PAGE state, and it is a CREDENTIAL. A
  // scenario inheriting the previous one's token would be a handset reusing the
  // previous occupant's proof of identity, which is the very thing UN-236
  // closes; the cache is keyed on the subject so production cannot do it, and
  // this makes the suite unable to either.
  _identityToken = null;
  _appId = null;
  // SECURITY F-2 — the shared in-flight read is per-PAGE state; a suite driving
  // several scenarios in one process is several pages, and one surviving here
  // would hand the next scenario the previous one's config answer.
  _appIdPromise = null;
  // SECURITY F-3 (eighth gate) — the serialization chain is per-PAGE state too.
  // A chain left over from the previous scenario would make the next scenario's
  // first call wait on a settled link (harmless) or, if that link is still in
  // flight because the previous scenario's fetch stub never resolved, wait
  // forever (not harmless). Reset with the rest.
  _osChain = Promise.resolve();
  // RG-192 — the identity binding is per-PAGE state too, and it is the one thing
  // pushDeviceStatus() answers from. A binding left over from the previous
  // scenario would let the next one report a linkage it never made, which is the
  // exact class of false-positive this whole section exists to remove.
  _boundExternalId = '';
  _desiredTarget = '';
  // RG-193 — the one-recycle-per-page budget is per-PAGE state too. A scenario
  // inheriting the previous one's spent latch would silently skip the repair.
  _recycleSpent = false;
  _staleReassertBudget = MAX_STALE_REASSERTS;
  _lastCompletedGen = 0;
  _identityGen++;                 // voids any retry still armed from the last scenario
  _scriptPromise = null;
  _initOnce = null;
  _configUnreachable = false;
  // Optional: shrink the two no-dead-tap bounds so notifytest.mjs can prove
  // "every tap gets an answer" in milliseconds. Omit them and the production
  // values (12s / 120s) are restored.
  SDK_READY_TIMEOUT_MS = sdkReadyMs ?? 12000;
  PROMPT_TIMEOUT_MS = promptMs ?? 120000;
}
