/**
 * js/platform.js — the ONE platform-detection seam (DI-208c, AD-68).
 *
 * `isNativeShell()` is the single source of truth for "are we running inside
 * the Capacitor iOS wrapper, or in a normal browser tab?" Every native-vs-web
 * branch anywhere in the app (push posture, app-feel hooks, the brand layer
 * in js/brand.js) MUST call this function — no second implementation of the
 * predicate may exist (AD-68).
 *
 * ZERO dependencies, ZERO top-level side effects — same discipline as
 * js/supabase-backend.js's own header rule. This file does nothing on
 * import; it only exposes a function to call later.
 *
 * PROVABLY INERT ON THE WEB: nothing in cfb-pickems/ ever assigns
 * `window.Capacitor` — it is injected by the native runtime itself, a
 * bridge object independent of the npm-published Capacitor core package
 * (never imported anywhere in this tree — DI-208a's spike proved the
 * runtime global alone is enough). On irbfootball.com today
 * `window.Capacitor` is undefined, so this predicate
 * is false BY ABSENCE, not false because of a flag someone could leave on.
 * Verified structurally by platformtest.mjs's grep-proof section, scoped to
 * the shipped source (not test harnesses, which must legitimately stub the
 * global to exercise the true branch).
 */
export function isNativeShell() {
  return typeof window !== 'undefined'
    && !!window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform() === true;
}

/**
 * isNativeOrigin() — the ORIGIN-POSITIVE gate (PASS 1b, security-reviewer
 * conditions S-C1/S-C8/S-C14, 2026-09-19/20).
 *
 * `isNativeShell()` alone answers "does this page see a Capacitor bridge
 * object?" — true on genuine native, but ALSO true on an `https:` page whose
 * script execution has been compromised enough to hand-inject a fake
 * `window.Capacitor` (an attacker who already has that much control gains
 * nothing new from the spoof itself — see PASS 1a's security verdict — but a
 * SECURITY-relevant branch must not take that spoof's word for the origin
 * too). Every cosmetic branch (brand string, wordmark, status bar, haptics,
 * app-feel) may key off `isNativeShell()` alone — getting those wrong costs
 * nothing security-relevant. Every branch that changes WHERE DATA GOES (the
 * backend refusal, the auth path, the service-worker skip) must key off this
 * function instead: true only when the runtime ALSO reports the native
 * scheme (`capacitor:`), which a page served over `https:` can never spoof
 * from inside its own script — the browser sets `location.protocol`, not the
 * page.
 *
 * Zero dependencies beyond isNativeShell() itself; zero top-level side
 * effects, same discipline as the rest of this file.
 */
export function isNativeOrigin() {
  return isNativeShell()
    && typeof location !== 'undefined'
    && location.protocol === 'capacitor:';
}
