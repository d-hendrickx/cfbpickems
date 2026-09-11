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
 * VERIFICATION NOTE: the exact CDN URL / init option names below follow
 * OneSignal's documented v16 Web SDK conventions as of this pass. Builder
 * could not reach OneSignal's live docs to confirm the exact current URL —
 * flagged in the handoff report. If OneSignal has moved the v16 URL by the
 * time this ships, update ONESIGNAL_SDK_URL below; nothing else changes.
 */

const ONESIGNAL_SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';

let _appId = null;          // resolved once, memoized (empty string = "checked, not configured")
let _sdkLoadStarted = false;
let _initialized = false;

/** Read config.json's public oneSignalAppId. Independent of js/backend.js —
 *  see module header. Never throws; absence/failure reads as "" (not configured). */
async function loadAppId() {
  if (_appId !== null) return _appId;
  try {
    const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) { _appId = ''; return _appId; }
    const data = await res.json();
    _appId = (data?.oneSignalAppId || '').trim();
  } catch {
    _appId = '';
  }
  return _appId;
}

/** True once we know push COULD be configured (non-empty App ID). Does not
 *  imply the SDK has loaded or permission was granted — see subscriptionState(). */
export async function isPushConfigured() {
  return !!(await loadAppId());
}

/** Load the SDK script + run OneSignal.init(), exactly once. No-ops (resolves
 *  false) when no App ID is configured — the explicit "no-op cleanly" contract. */
export async function ensureOneSignalInit() {
  const appId = await loadAppId();
  if (!appId) return false;                       // not configured — clean no-op
  if (_initialized) return true;
  if (typeof document === 'undefined') return false;   // non-browser (loadtest/node) — no-op, not an error

  if (!_sdkLoadStarted) {
    _sdkLoadStarted = true;
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = ONESIGNAL_SDK_URL;
      s.defer = true;
      s.onload = resolve;
      s.onerror = () => { console.warn('[push-onesignal] SDK failed to load'); resolve(); };
      document.head.appendChild(s);
    });
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  return new Promise((resolve) => {
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId,
          // correction #1 — merge into OUR worker (service-worker.js), never a
          // second root-scope registration. See that file's importScripts line.
          serviceWorkerParam: { scope: '/' },
          serviceWorkerPath: 'service-worker.js',
          // DI-A2 / Q7 — we prompt ONLY inside the Notification Center, never
          // OneSignal's own auto slide-down (Drew disables that in the
          // OneSignal dashboard per the Appendix; this is belt-and-suspenders).
          promptOptions: { autoPrompt: false },
        });
        _initialized = true;
        resolve(true);
      } catch (err) {
        console.warn('[push-onesignal] init failed', err);
        resolve(false);
      }
    });
  });
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
 *   'unsupported'  — Notification API absent, or iOS Safari not installed as a PWA
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
  if (typeof Notification === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  // iOS Safari requires home-screen install before push works at all.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent || '');
  const isStandalone = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || (typeof navigator !== 'undefined' && navigator.standalone === true);
  if (isIOS && !isStandalone) return 'unsupported';
  const perm = Notification.permission;
  if (perm === 'granted') return 'granted';
  if (perm === 'denied') return 'denied';
  return 'never-asked';
}

/** Triggers the native permission prompt — must be called from a genuine user
 *  gesture (DI-A2's "Turn On" button handler), never on first paint. */
export async function requestPushPermission() {
  const ok = await ensureOneSignalInit();
  if (!ok) return false;
  return new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.Notifications.requestPermission();
        resolve(typeof Notification !== 'undefined' && Notification.permission === 'granted');
      } catch (err) {
        console.warn('[push-onesignal] permission request failed', err);
        resolve(false);
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
 */
export function wireForegroundSuppression(destinationForEvent) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', (e) => {
        try {
          const event = e?.notification?.additionalData?.event;
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

/** Test-only reset — mirrors the _resetForTest() convention used elsewhere
 *  (chat.js, backend.js) so notifytest.mjs can exercise loadAppId() fresh. */
export function _resetForTest() {
  _appId = null;
  _sdkLoadStarted = false;
  _initialized = false;
}
