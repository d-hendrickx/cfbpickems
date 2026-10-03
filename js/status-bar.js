/**
 * js/status-bar.js — SB-08 (2026-09-30): the status-bar glyph tracker.
 *
 * THE BUG (Drew, iPhone, TestFlight): "On ios when I scroll up the bottom of
 * the header disappears (intended behavior), but there is still a row of color
 * on my iphone just underneath the floating island and my camera. All color in
 * the header should scroll up and away and you should be able to see the page
 * continue to scroll underneath the camera and time/battery/wifi icon, etc"
 *
 * ROOT CAUSE, two halves that only made sense together:
 *   1. RG-209's `body.native-shell::before` painted the HEADER's colour into
 *      the top safe-area band, fixed, at every scroll offset — the "row of
 *      color" Drew saw.
 *   2. It existed because `syncNativeStatusBar()` (js/app.js) forced
 *      `StatusBar.setStyle({style:'DARK'})` — white glyphs — always. White
 *      glyphs over a light page are invisible, so RG-209 painted a dark
 *      backdrop to keep them legible. Remove the strip without fixing (2)
 *      and the clock disappears instead (option O1, 48 of 126 scroll frames
 *      under 3:1 in the SB-08 option renders).
 *
 * THE FIX (option O2b "soft edge", Drew's pick 2026-09-30): the band carries
 * the PAGE colour, not the header's — a 12px-overhanging gradient of `--bg`
 * (css/styles.css, `body.native-shell::before`) that sits UNDER the header at
 * rest and over content once the header has scrolled away — and the glyph
 * STYLE follows whatever is actually under the glyphs, chosen by luminance.
 * This module is that second half.
 *
 * WHAT IS "UNDER THE GLYPHS" (resolveGlyphSurface):
 *   overlay — the first opaque layer ABOVE the page at the glyph point
 *             (the sign-in gate's Ink, the drawer, a league overlay, the red
 *             sync banner). Translucent layers (a modal scrim) are skipped:
 *             they tint whatever is beneath rather than replace it.
 *   chrome  — the header, while it still covers the glyph line. Read from the
 *             chrome token `--chrome-bg` (SP-52 / DI-454), NEVER `--maroon`.
 *   page    — otherwise: the page under the soft edge, read from `--bg`.
 * The glyph line is the middle of the safe-area inset (where iOS draws the
 * clock), derived from the band's own height so it can never drift from it.
 *
 * STYLE FROM LUMINANCE (statusBarStyleFor): relative luminance >= 0.179 —
 * the white/black contrast crossover, the same constant DI-454 names — means
 * a light surface, so 'LIGHT' (dark glyphs); otherwise 'DARK' (white glyphs).
 * Capacitor's naming is by BACKGROUND: 'DARK' = light content. An unreadable
 * colour answers 'DARK', today's constant, which is right on every header.
 *
 * NATIVE ONLY. Nothing here runs on the web: the tracker is created and
 * installed only from js/app.js behind isNativeShell(), every entry point
 * re-checks `isNative()`, and the plugin is optional-chained end to end.
 * Native status-bar behaviour stays native (Design Philosophy, "Capacitor-
 * Specific Guidance"): the style change itself is the plugin's own 0.2s
 * UIKit cross-fade — nothing in JS animates or paints glyphs.
 *
 * NO IMPORTS on purpose: the module is pure DOM + maths, so statusbartest.mjs
 * drives it in Node with a fake DOM and navtest.mjs [7l] drives the SAME file
 * inside a real layout engine.
 */

/** Relative-luminance crossover: at or above this a surface takes dark glyphs. */
export const GLYPH_LUMINANCE_THRESHOLD = 0.179;
/** How far the soft edge overhangs the safe-area inset (css/styles.css). */
export const SOFT_EDGE_PX = 12;
/** A layer this opaque (background alpha x opacity) replaces what is beneath. */
export const OVERLAY_ALPHA_MIN = 0.5;
/** The chrome token. SP-52 (DI-448/DI-454) owns its values per look. */
export const CHROME_TOKEN = '--chrome-bg';
/** The page token the soft edge is painted from. */
export const PAGE_TOKEN = '--bg';

/**
 * Parse a CSS colour as getComputedStyle/getPropertyValue report it: #rgb,
 * #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax),
 * `color(srgb r g b / a)` (how engines report a resolved color-mix()), and the
 * keyword `transparent`. Anything else (a gradient, an unresolved
 * `color-mix(...)` token, an empty token) answers null — callers treat null
 * as "unknown", never as a colour.
 * @param {string} input
 * @returns {[number, number, number, number] | null} r, g, b in 0..255, a in 0..1
 */
export function parseColor(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map(c => parseInt(c + c, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = parts.slice(0, 3).map(p => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)));
    if (ch.some(n => !Number.isFinite(n))) return null;
    let a = 1;
    if (parts[3] != null) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (!Number.isFinite(a)) return null;
    const clamp = (n, hi) => Math.min(hi, Math.max(0, n));
    return [clamp(ch[0], 255), clamp(ch[1], 255), clamp(ch[2], 255), clamp(a, 1)];
  }
  const srgb = /^color\(\s*srgb\s+([^)]*)\)$/.exec(s);
  if (srgb) {
    const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(p => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)));
    if (parts.length < 3 || parts.some(n => !Number.isFinite(n))) return null;
    const unit = n => Math.min(1, Math.max(0, n));
    return [unit(parts[0]) * 255, unit(parts[1]) * 255, unit(parts[2]) * 255, parts[3] != null ? unit(parts[3]) : 1];
  }
  return null;
}

/**
 * WCAG 2.x relative luminance of a colour string, or null when unparseable.
 * @param {string} color
 * @returns {number | null}
 */
export function relativeLuminance(color) {
  const c = parseColor(color);
  if (!c) return null;
  const lin = v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** True when the surface is light enough that DARK glyphs read better. */
export function isLightColor(color) {
  const L = relativeLuminance(color);
  return L != null && L >= GLYPH_LUMINANCE_THRESHOLD;
}

/**
 * The Capacitor StatusBar style for glyphs drawn over `color`.
 * 'LIGHT' = dark glyphs (a light surface); 'DARK' = white glyphs (a dark one,
 * and the answer for an unreadable colour — today's constant).
 * @param {string} color
 * @returns {'LIGHT' | 'DARK'}
 */
export function statusBarStyleFor(color) {
  return isLightColor(color) ? 'LIGHT' : 'DARK';
}

function readToken(doc, win, name) {
  try { return String(win.getComputedStyle(doc.body).getPropertyValue(name) || '').trim(); }
  catch { return ''; }
}

/**
 * Where iOS draws the status glyphs, in CSS px: the middle of the safe-area
 * inset, which is the band's own height minus its overhang. The x is the clock
 * side (left of the Dynamic Island), clear of the island itself.
 * @returns {{ x: number, y: number, inset: number }}
 */
export function glyphPoint(doc, win) {
  let inset = 0;
  try {
    const h = parseFloat(win.getComputedStyle(doc.body, '::before').height);
    if (Number.isFinite(h)) inset = Math.max(0, h - SOFT_EDGE_PX);
  } catch { /* no band → inset 0 */ }
  const w = Number(win.innerWidth) || 0;
  return { x: Math.max(1, Math.min(48, w / 4)), y: inset > 0 ? inset / 2 : 0.5, inset };
}

/**
 * What is under the status glyphs right now, and its colour.
 * @returns {{ surface: 'overlay' | 'chrome' | 'page', color: string }}
 */
export function resolveGlyphSurface(doc, win) {
  const { x, y } = glyphPoint(doc, win);
  const root = doc.documentElement;
  const body = doc.body;
  const pageRoot = doc.querySelector('.page-wrapper');
  // 1. An opaque layer above the page (gate, drawer, overlay, banner). The
  //    walk stops at the page layer: from there on, geometry decides.
  const stack = typeof doc.elementsFromPoint === 'function' ? (doc.elementsFromPoint(x, y) || []) : [];
  for (const el of stack) {
    if (el === body || el === root) break;
    if (pageRoot && (el === pageRoot || (typeof pageRoot.contains === 'function' && pageRoot.contains(el)))) break;
    let cs;
    try { cs = win.getComputedStyle(el); } catch { continue; }
    const bg = parseColor(cs.backgroundColor);
    const opacity = parseFloat(cs.opacity);
    const alpha = bg ? bg[3] * (Number.isFinite(opacity) ? opacity : 1) : 0;
    if (alpha >= OVERLAY_ALPHA_MIN) return { surface: 'overlay', color: String(cs.backgroundColor) };
  }
  // 2. The header, while it still covers the glyph line (a display:none
  //    header — the Chat tab — has no height and never does).
  const header = doc.querySelector('.app-header');
  if (header && typeof header.getBoundingClientRect === 'function') {
    const r = header.getBoundingClientRect();
    if (r.height > 0 && r.top <= y && r.bottom > y) return { surface: 'chrome', color: readToken(doc, win, CHROME_TOKEN) };
  }
  // 3. The page, under the soft edge.
  return { surface: 'page', color: readToken(doc, win, PAGE_TOKEN) };
}

/**
 * The tracker: re-resolves the surface whenever something that can change it
 * happens, and tells the plugin only when the answer changes (a setStyle per
 * scroll frame would be a bridge call and a UIKit animation per frame).
 *
 * `force` re-sends even an unchanged style: the plugin resets the style to its
 * config default on every native viewDidAppear (e.g. after the Google sign-in
 * browser closes), so a theme repaint — today's call site — always re-asserts.
 *
 * @param {{ doc: Document, win: Window, getPlugin: () => any, isNative: () => boolean }} deps
 */
export function createStatusBarTracker({ doc, win, getPlugin, isNative }) {
  let lastStyle = null;
  let lastBg = null;
  let pending = false;
  let installed = false;

  function sync({ force = false } = {}) {
    if (!isNative()) return null;
    const plugin = getPlugin();
    if (!plugin) return null;
    let found;
    try { found = resolveGlyphSurface(doc, win); } catch { return null; }
    const style = statusBarStyleFor(found.color);
    if (force || style !== lastStyle) {
      lastStyle = style;
      try { plugin.setStyle?.({ style }); } catch { /* a status bar is never worth a throw */ }
    }
    // Android-only paint (a no-op on iOS, where the web view overlays the bar):
    // the chrome token, never --maroon.
    const chrome = readToken(doc, win, CHROME_TOKEN);
    if (chrome && (force || chrome !== lastBg)) {
      lastBg = chrome;
      try { plugin.setBackgroundColor?.({ color: chrome }); } catch { /* ignore */ }
    }
    return { ...found, style };
  }

  function schedule() {
    if (pending) return;
    pending = true;
    const run = () => { pending = false; sync(); };
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function invalidate() { lastStyle = null; lastBg = null; schedule(); }

  /** Idempotent. Every listener is passive; nothing here can block a scroll. */
  function install() {
    if (installed || !isNative()) return;
    installed = true;
    const passiveCapture = { capture: true, passive: true };
    // Any scroll, window or inner (a league overlay scrolls itself).
    doc.addEventListener('scroll', schedule, passiveCapture);
    // A drawer or overlay finishing its slide.
    doc.addEventListener('transitionend', schedule, passiveCapture);
    win.addEventListener('resize', schedule, { passive: true });
    // Back in the foreground: the native side may have reset the style.
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState !== 'hidden') invalidate(); });
    win.addEventListener('pageshow', invalidate);
    // The phone's appearance changing repaints --bg with no attribute change.
    try { win.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', invalidate); } catch { /* old engine */ }
    if (typeof win.MutationObserver === 'function' && doc.body) {
      // Gates, overlays and banners mount on <body>; the tab, theme and scheme
      // live on its attributes.
      new win.MutationObserver(schedule).observe(doc.body,
        { childList: true, attributes: true, attributeFilter: ['class', 'data-tab', 'data-color-scheme'] });
      // The drawer and sheets open and close by attribute, anywhere below.
      new win.MutationObserver(schedule).observe(doc.body,
        { subtree: true, attributes: true, attributeFilter: ['data-open', 'hidden'] });
    }
    schedule();
  }

  return { sync, schedule, invalidate, install };
}

let _tracker = null;

/**
 * The app's single tracker (js/app.js). Created and installed on first use,
 * native only; a no-op returning null on the web.
 * @param {{ isNative: () => boolean }} opts
 */
export function installStatusBarTracker({ isNative }) {
  if (_tracker) return _tracker;
  if (typeof document === 'undefined' || typeof window === 'undefined' || !isNative()) return null;
  _tracker = createStatusBarTracker({
    doc: document, win: window, isNative,
    getPlugin: () => window.Capacitor?.Plugins?.StatusBar,
  });
  _tracker.install();
  return _tracker;
}

/** Re-resolve now (js/app.js applyTheme(): force, since the palette changed). */
export function syncStatusBar(opts) {
  return _tracker ? _tracker.sync(opts) : null;
}
