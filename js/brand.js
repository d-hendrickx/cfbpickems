/**
 * js/brand.js — shell-brand resolution (DI-213a, AD-70).
 *
 * Brand identity is TWO INDEPENDENT FACTS, never one flag (AD-70):
 *   1. Which SHELL is rendering — platform-scoped, resolved from
 *      isNativeShell() (js/platform.js). Web says "CFB Pickems"; the native
 *      iOS wrapper says "Munera."
 *   2. Which LEAGUE this is — today a literal "IRB Pick 'Ems" on BOTH
 *      platforms, later `leagues.name` once Phase III supports more than
 *      one league. A signed-out visitor on the native shell still sees
 *      "Munera" chrome around "IRB Pick 'Ems" — shell identity is not an
 *      auth-scoped or league-scoped property.
 *
 * Collapsing these into one boolean is exactly the mistake AD-70 exists to
 * avoid — the moment a second league or a Munera-branded web surface ever
 * exists, a single flag would need un-collapsing. Writing it as two
 * functions costs nothing today.
 *
 * ZERO DOM access, ZERO storage access, ZERO top-level side effects — this
 * module only reads isNativeShell() (itself deferred until called) and
 * returns literals.
 *
 * The string "SCRIBE" and "MunerAI" must never appear as a key or value in
 * this module's lookup tables (Drew's ruling, AD-70/AD-72: SCRIBE keeps its
 * name; "MunerAI" never becomes an in-app persona). Enforced structurally
 * by brandtest.mjs's source scan, not by convention alone.
 */
import { isNativeShell } from './platform.js';

/** 'web' | 'native' — thin wrapper over the one platform-detection seam. */
export function getPlatform() {
  return isNativeShell() ? 'native' : 'web';
}

/** The shell's own brand name. Web stays "CFB Pickems" — byte-identical to
 *  today, always, per the hard requirement (DI-213h, DI-213i's mutation-proof).
 *  Native reads "Munera." */
export function getShellBrandName() {
  return getPlatform() === 'native' ? 'Munera' : 'CFB Pickems';
}

/** The league's display name — independent of platform (AD-70's second fact).
 *  Today a literal; written so a real league name (Phase III `leagues.name`)
 *  can be threaded in later without touching this function's callers. */
export function getLeagueDisplayName() {
  return "IRB Pick 'Ems";
}

/** Native-only header wordmark text (DI-213k). Web renders no wordmark at
 *  all — null, not an empty string, so a call site can tell "nothing to
 *  render" apart from "render an empty label." */
export function getShellWordmark() {
  return getPlatform() === 'native' ? 'MUNERA' : null;
}

/** Native-only sign-in-gate tagline (DI-216, coordinator amendment A1/A4):
 *  "Enter the arena." — the one flavor surface DI-215b already approved,
 *  reused verbatim rather than a new hard-coded literal in app.js. Web
 *  renders no tagline at all — null, not an empty string, mirroring
 *  getShellWordmark()'s "nothing to render" vs "render an empty label"
 *  distinction above. */
export function getShellTagline() {
  return getPlatform() === 'native' ? 'Enter the arena.' : null;
}
