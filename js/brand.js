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

// ─────────────────────────────────────────────────────────────────────────────
// UN-312 / DI-437 (2026-09-29) — the Munera SIGN-IN GATE lockup, BOTH platforms.
//
// This is the deliberate, Drew-approved amendment of UN-215 facet 2 for ONE
// screen: the web sign-in gate now says Munera (Q7), where getShellWordmark()/
// getShellTagline() above keep returning null on web so the post-sign-in
// header, and brandtest [1d]/[1e], are exactly as they were. The three
// functions below are therefore PLATFORM-INDEPENDENT on purpose — they do not
// read isNativeShell() — and the getShell* pair is UNCHANGED. Two seams, not
// one flag: the shell name is still a per-platform fact (AD-70); the gate's
// lockup is a single design that both front ends share (UN-312 F1).
//
// Still pure literals: no DOM, no storage, no top-level side effects.
// ─────────────────────────────────────────────────────────────────────────────

/** The filled Munera temple — the mark on the home-screen icon the player just
 *  tapped (the iOS shell's icon-temple.svg asset: same six shapes, same
 *  geometry), cropped to its own bounds (viewBox 205 250 614 495) and drawn in
 *  `currentColor` so CSS decides the colour (Gold on the gate). ONE inline
 *  logo asset, approved by Drew (Q5a) as a logo, not a chrome icon: it lives
 *  here, not in js/icons.js, because icons.js's invariant is a stroked family
 *  (iconstest). Injected raw by the caller exactly like GOOGLE_G_MARK_SVG — it
 *  is a fixed literal with no interpolation. 72x58 here; the compact lockup
 *  resizes it to 40x32 in CSS. Purely decorative: aria-hidden, unfocusable.
 *  css/styles.css carries the same geometry once, as the hold screens'
 *  pseudo-element mask (DI-438); gaterebrandtest compares the two. */
export function getGateMarkSVG() {
  // ONE template literal with no interpolation, deliberately (like
  // GOOGLE_G_MARK_SVG in app.js): xsstest's classifier proves a raw injection
  // safe when every return is a plain literal, and a `'…' + '…'` chain is not.
  return `<svg class="site-gate-mark" viewBox="205 250 614 495" width="72" height="58" fill="currentColor" aria-hidden="true" focusable="false">
  <path d="M 212 393 L 499.25 262.78 Q 512 257 524.75 262.78 L 812 393 L 812 401 Q 812 417 796 417 L 228 417 Q 212 417 212 401 L 212 393 Z"/>
  <rect x="296" y="445.57" width="78" height="154.29"/>
  <rect x="473" y="445.57" width="78" height="154.29"/>
  <rect x="650" y="445.57" width="78" height="154.29"/>
  <rect x="260" y="599.86" width="504" height="51.43" rx="7.71"/>
  <rect x="212" y="679.86" width="600" height="57.14" rx="22.86"/>
</svg>`;
}

/** The gate's wordmark text, both platforms (UN-312 F1). Callers escHtml() it. */
export function getGateWordmark() {
  return 'MUNERA';
}

/** The gate's tagline, both platforms — the same "Enter the arena." the launch
 *  screen and DI-215b already approved, never a second literal. Callers
 *  escHtml() it. */
export function getGateTagline() {
  return 'Enter the arena.';
}
