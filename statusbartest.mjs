/**
 * CFB Pickems — statusbartest.mjs (SB-08, 2026-09-30)
 * ===================================================
 * The status-bar glyph tracker, js/status-bar.js, start to finish.
 *
 * Drew's report (iPhone, TestFlight): "On ios when I scroll up the bottom of
 * the header disappears (intended behavior), but there is still a row of
 * color on my iphone just underneath the floating island and my camera. All
 * color in the header should scroll up and away and you should be able to see
 * the page continue to scroll underneath the camera and time/battery/wifi
 * icon, etc"
 *
 * Root cause: RG-209's `body.native-shell::before` painted the header's
 * colour under the Dynamic Island at every scroll offset, because
 * syncNativeStatusBar() forced white glyphs (`setStyle('DARK')`) and white
 * glyphs need a dark backdrop. The fix (option O2b, Drew's pick) paints the
 * PAGE colour as a soft edge instead and makes the glyph STYLE follow the
 * surface under it, by luminance. This file proves the second half in Node
 * with a fake DOM; navtest.mjs §7j/§7k/§7l prove both halves in a real
 * engine, against the real stylesheet.
 *
 * Run:  node statusbartest.mjs
 *       for tz in UTC America/Los_Angeles; do TZ=$tz node statusbartest.mjs; done
 * Spawned by loadtest.mjs as [112c-statusbar] with a ratcheted floor.
 *
 *   [1] colour maths: parsing, luminance, the 0.179 crossover, the style map
 *   [2] DI-454's named cases, plus every look's header and page colour read
 *       out of css/styles.css (light pages → dark glyphs, every header → white)
 *   [3] resolveGlyphSurface: chrome reads --chrome-bg (NEVER --maroon), page
 *       reads --bg, opaque overlays win, translucent ones do not, the walk
 *       stops at the page layer, a hidden header never counts
 *   [4] the tracker: web inert, plugin optional, one call per flip, force,
 *       the Android background from the chrome token, listeners passive
 *   [5] source pins: app.js wiring, the CSS band and alias, the service
 *       worker, the module's own purity
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as SB from './js/status-bar.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const cssSrc = readFileSync(here + 'css/styles.css', 'utf8');
const appSrc = readFileSync(here + 'js/app.js', 'utf8');
const sbSrc = readFileSync(here + 'js/status-bar.js', 'utf8');
const swSrc = readFileSync(here + 'service-worker.js', 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const codeOf = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] colour maths…');
{
  assert(JSON.stringify(SB.parseColor('#fff')) === '[255,255,255,1]' && JSON.stringify(SB.parseColor('#8C1515')) === '[140,21,21,1]',
    '[1a] #rgb and #rrggbb parse to 0..255 channels, opaque');
  assert(SB.parseColor('#00000080')[3] > 0.5 && SB.parseColor('#00000080')[3] < 0.51 && SB.parseColor('#0008')[3] > 0.53 && SB.parseColor('#0008')[3] < 0.54,
    '[1b] #rrggbbaa and #rgba carry their alpha');
  assert(JSON.stringify(SB.parseColor('rgb(140, 21, 21)')) === '[140,21,21,1]' && SB.parseColor('rgba(0, 0, 0, 0.45)')[3] === 0.45
    && SB.parseColor('rgb(20 17 14 / 0.55)')[3] === 0.55,
    '[1c] rgb()/rgba() in comma AND space syntax (what getComputedStyle reports)');
  const srgb = SB.parseColor('color(srgb 0.909804 0.894118 0.862745 / 0.78)');
  assert(!!srgb && Math.round(srgb[0]) === 232 && Math.round(srgb[1]) === 228 && Math.round(srgb[2]) === 220 && srgb[3] === 0.78,
    '[1d] color(srgb r g b / a) — how an engine reports a resolved color-mix() — parses to the same 0..255 channels');
  assert(JSON.stringify(SB.parseColor('transparent')) === '[0,0,0,0]' && SB.parseColor('') === null && SB.parseColor('var(--x)') === null
    && SB.parseColor('linear-gradient(red, blue)') === null && SB.parseColor('#12') === null && SB.parseColor(undefined) === null,
    '[1e] transparent is alpha 0; empty, unresolved, gradient and malformed values are null (unknown), never a guessed colour');
  assert(SB.relativeLuminance('#FFFFFF') === 1 && SB.relativeLuminance('#000000') === 0 && SB.relativeLuminance('nope') === null,
    '[1f] WCAG relative luminance: white 1, black 0, unparseable null');
  // by hand: 0.2126·0.2623 (R 140) + 0.7152·0.0075 (G 21) + 0.0722·0.0075 (B 21) = 0.0617
  assert(Math.abs(SB.relativeLuminance('#8C1515') - 0.0617) < 0.0005,
    `[1g] the Munera crimson header's luminance is ${SB.relativeLuminance('#8C1515').toFixed(4)} (0.0617 by hand)`);
  assert(SB.GLYPH_LUMINANCE_THRESHOLD === 0.179,
    '[1h] the crossover is 0.179 — the luminance where black and white text have equal contrast, the constant DI-454 names');
  // the boundary, from both sides: a grey just under and just over 0.179
  const under = '#737373', over = '#767676';
  assert(SB.relativeLuminance(under) < 0.179 && SB.statusBarStyleFor(under) === 'DARK'
    && SB.relativeLuminance(over) >= 0.179 && SB.statusBarStyleFor(over) === 'LIGHT',
    `[1i] at the boundary: ${under} (L ${SB.relativeLuminance(under).toFixed(3)}) takes white glyphs, ${over} (L ${SB.relativeLuminance(over).toFixed(3)}) takes dark`);
  assert(SB.statusBarStyleFor('') === 'DARK' && SB.statusBarStyleFor(null) === 'DARK' && SB.statusBarStyleFor('garbage') === 'DARK',
    "[1j] an unreadable colour answers 'DARK' — today's constant, right on every header — never a guess toward dark glyphs");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] DI-454\'s named cases, and every look in the stylesheet…');
{
  assert(SB.statusBarStyleFor('#FFFFFF') === 'LIGHT', "[2a] DI-454: #FFFFFF (Graphite Light's white header, SP-52) → 'LIGHT', dark glyphs");
  for (const [c, name] of [['#8C1515', 'Munera crimson'], ['#14110E', 'Ink'], ['#1C1C1E', 'Graphite Dark']]) {
    assert(SB.statusBarStyleFor(c) === 'DARK', `[2b] DI-454: ${name} ${c} → 'DARK', white glyphs`);
  }
  // Every look's header (--maroon in each body.theme-* block) and page (--bg).
  const blocks = [...cssSrc.matchAll(/(body\.theme-[a-z]+)\s*\{([^}]*)\}/g)];
  const maroons = blocks.map(b => [b[1], /--maroon:\s*(#[0-9A-Fa-f]{6})/.exec(b[2])?.[1]]).filter(x => x[1]);
  assert(maroons.length >= 7, `[2c] fixture check: ${maroons.length} theme blocks declare --maroon (every school and Munera)`);
  for (const [sel, hex] of maroons) {
    assert(SB.statusBarStyleFor(hex) === 'DARK', `[2d] ${sel}: header ${hex} → 'DARK' (white glyphs on the header, exactly as today)`);
  }
  const bgs = [...cssSrc.matchAll(/--bg:\s*(#[0-9A-Fa-f]{6})/g)].map(m => m[1]);
  const lightBgs = bgs.filter(h => SB.relativeLuminance(h) >= 0.5), darkBgs = bgs.filter(h => SB.relativeLuminance(h) < 0.05);
  assert(lightBgs.length >= 2 && darkBgs.length >= 1 && lightBgs.length + darkBgs.length === bgs.length,
    `[2e] fixture check: every --bg in the sheet is clearly light or clearly dark (light ${[...new Set(lightBgs)].join(' ')}; dark ${[...new Set(darkBgs)].join(' ')}) — none sits near the crossover`);
  assert(lightBgs.every(h => SB.statusBarStyleFor(h) === 'LIGHT') && darkBgs.every(h => SB.statusBarStyleFor(h) === 'DARK'),
    "[2f] scrolled, every light page takes 'LIGHT' (dark glyphs) and Munera Night's Ink page takes 'DARK' — the glyphs follow the look, no table to keep in sync");
}

// ─────────────────────────────────────────────────────────────────────────────
// A fake DOM just big enough for resolveGlyphSurface: elements with computed
// styles and rects, a body whose custom properties are the tokens, a band
// pseudo-element height, and elementsFromPoint returning a given stack.
function fakeDom({ tokens = {}, bandHeight = '71px', header = { top: 0, bottom: 106, height: 106 }, stack = [], noEFP = false, innerWidth = 393 } = {}) {
  const styles = new Map();
  const mk = (name, style = {}) => { const el = { name, contains: o => o === el || (o && o.parent === el) }; styles.set(el, style); return el; };
  const root = mk('html'), body = mk('body'), page = mk('page-wrapper');
  const hdr = header ? mk('header') : null;
  if (hdr) { hdr.getBoundingClientRect = () => header; hdr.parent = page; }
  const layers = stack.map(s => {
    if (s === 'page') { const e = mk('in-page', { backgroundColor: '#FFFFFF', opacity: '1' }); e.parent = page; return e; }
    if (s === 'header') return hdr;
    if (s === 'body') return body;
    return mk('layer', { backgroundColor: s.bg, opacity: s.opacity ?? '1' });
  });
  const doc = {
    documentElement: root, body,
    querySelector: sel => (sel === '.app-header' ? hdr : sel === '.page-wrapper' ? page : null),
  };
  if (!noEFP) doc.elementsFromPoint = (x, y) => { doc.lastPoint = [x, y]; return [...layers, ...(layers.includes(body) ? [] : [body]), root]; };
  const win = {
    innerWidth,
    getComputedStyle: (el, pseudo) => {
      if (el === body && pseudo === '::before') return { height: bandHeight };
      if (el === body) return { getPropertyValue: n => tokens[n] ?? '' };
      return styles.get(el) || {};
    },
  };
  return { doc, win };
}
const TOK = { '--chrome-bg': '#8C1515', '--maroon': '#8C1515', '--bg': '#E8E4DC' };

console.log('\n[3] resolveGlyphSurface — what is under the glyphs…');
{
  {
    const { doc, win } = fakeDom({ tokens: TOK });
    const p = SB.glyphPoint(doc, win);
    assert(p.inset === 59 && p.y === 29.5 && p.x === 48,
      `[3a] the glyph point is the middle of the inset, derived from the band (71px − the 12px overhang = 59px inset → y ${p.y}), on the clock side (x ${p.x})`);
    const none = fakeDom({ tokens: TOK, bandHeight: 'auto' });
    assert(SB.glyphPoint(none.doc, none.win).inset === 0 && SB.glyphPoint(none.doc, none.win).y === 0.5,
      '[3b] no band (an engine that dropped the rule) → inset 0, a point just inside the top edge, never NaN');
  }
  {
    const { doc, win } = fakeDom({ tokens: TOK, stack: ['header'] });
    const r = SB.resolveGlyphSurface(doc, win);
    assert(r.surface === 'chrome' && r.color === '#8C1515', `[3c] header covering the glyph line → 'chrome', ${r.color}`);
  }
  {
    // THE TOKEN, isolated: a chrome colour that differs from --maroon (SP-52's
    // Graphite Light: a white header on a look whose --maroon is still dark).
    const { doc, win } = fakeDom({ tokens: { '--chrome-bg': '#FFFFFF', '--maroon': '#8C1515', '--bg': '#E8E4DC' }, stack: ['header'] });
    const r = SB.resolveGlyphSurface(doc, win);
    assert(r.color === '#FFFFFF' && SB.statusBarStyleFor(r.color) === 'LIGHT',
      `[3d] the header surface is read from --chrome-bg, NEVER --maroon: with --chrome-bg white and --maroon crimson the answer is ${r.color} → '${SB.statusBarStyleFor(r.color)}' (a --maroon read would answer 'DARK' and lose the glyphs on a white header)`);
  }
  {
    const { doc, win } = fakeDom({ tokens: TOK, header: { top: -60, bottom: 46, height: 106 }, stack: ['header'] });
    assert(SB.resolveGlyphSurface(doc, win).surface === 'chrome', '[3e] header bottom 46 > the 29.5 glyph line → still chrome');
    const b = fakeDom({ tokens: TOK, header: { top: -80, bottom: 26, height: 106 }, stack: ['page'] });
    const r = SB.resolveGlyphSurface(b.doc, b.win);
    assert(r.surface === 'page' && r.color === '#E8E4DC', `[3f] header bottom 26 < 29.5 → 'page', read from --bg (${r.color}), not from the white card under the glyphs`);
    const at = fakeDom({ tokens: TOK, header: { top: -76.5, bottom: 29.5, height: 106 } });
    assert(SB.resolveGlyphSurface(at.doc, at.win).surface === 'page', '[3g] exactly at the midline (bottom 29.5) the header no longer covers the line → page');
  }
  {
    const { doc, win } = fakeDom({ tokens: TOK, header: { top: 0, bottom: 0, height: 0 } });
    assert(SB.resolveGlyphSurface(doc, win).surface === 'page', '[3h] a display:none header (the Chat tab) has no height and never counts as chrome');
    const gone = fakeDom({ tokens: TOK, header: null });
    assert(SB.resolveGlyphSurface(gone.doc, gone.win).surface === 'page', '[3i] no header element at all → page, no throw');
  }
  {
    const { doc, win } = fakeDom({ tokens: TOK, stack: [{ bg: 'rgb(20, 17, 14)' }, 'header'] });
    const r = SB.resolveGlyphSurface(doc, win);
    assert(r.surface === 'overlay' && SB.statusBarStyleFor(r.color) === 'DARK',
      `[3j] an opaque overlay above the page (the Ink sign-in gate) wins over the header beneath it → ${r.surface} ${r.color} → 'DARK'`);
    const lightPanel = fakeDom({ tokens: TOK, stack: [{ bg: 'rgb(232, 228, 220)' }, 'header'] });
    assert(SB.statusBarStyleFor(SB.resolveGlyphSurface(lightPanel.doc, lightPanel.win).color) === 'LIGHT',
      "[3k] an opaque LIGHT panel (the drawer on --bg) over the header at rest → 'LIGHT' — better than today, where it got white glyphs");
  }
  {
    const { doc, win } = fakeDom({ tokens: TOK, stack: [{ bg: 'rgba(0, 0, 0, 0.45)' }, 'header'] });
    assert(SB.resolveGlyphSurface(doc, win).surface === 'chrome', '[3l] a translucent scrim (.modal-overlay, alpha .45) is skipped: it tints the header, it does not replace it');
    const faded = fakeDom({ tokens: TOK, stack: [{ bg: 'rgb(20, 17, 14)', opacity: '0' }, 'header'] });
    assert(SB.resolveGlyphSurface(faded.doc, faded.win).surface === 'chrome', '[3m] an opaque layer at opacity 0 (a backdrop mid-fade-out) counts by background alpha × opacity, and is skipped');
    const half = fakeDom({ tokens: TOK, stack: [{ bg: 'rgba(20, 17, 14, 0.55)' }, 'header'] });
    assert(SB.resolveGlyphSurface(half.doc, half.win).surface === 'overlay', '[3n] the drawer\'s .55 scrim crosses the 0.5 line and counts as the surface');
  }
  {
    // The walk stops at the page layer: an opaque CARD inside .page-wrapper is
    // not an overlay — geometry decides between header and page from there.
    const { doc, win } = fakeDom({ tokens: TOK, header: { top: -200, bottom: -94, height: 106 }, stack: ['page'] });
    const r = SB.resolveGlyphSurface(doc, win);
    assert(r.surface === 'page' && r.color === '#E8E4DC', '[3o] an opaque card inside the page is not an overlay; scrolled, the answer is the page token');
    const inertApp = fakeDom({ tokens: TOK, stack: [{ bg: 'rgba(0, 0, 0, 0.45)' }, 'body'] });
    assert(SB.resolveGlyphSurface(inertApp.doc, inertApp.win).surface === 'chrome',
      '[3p] when the app is inert under a modal (hit-testing skips it) the walk stops at <body> and geometry still finds the header — the body\'s own --bg fill is never mistaken for an overlay');
  }
  {
    const { doc, win } = fakeDom({ tokens: TOK, noEFP: true });
    assert(SB.resolveGlyphSurface(doc, win).surface === 'chrome', '[3q] an engine without elementsFromPoint falls back to geometry alone');
    const empty = fakeDom({ tokens: {}, stack: ['header'] });
    assert(SB.statusBarStyleFor(SB.resolveGlyphSurface(empty.doc, empty.win).color) === 'DARK',
      "[3r] a missing --chrome-bg (stylesheet not loaded) answers 'DARK', today's constant");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] the tracker…');
{
  const mkPlugin = () => { const calls = [], bgs = []; return { calls, bgs, setStyle: o => calls.push(o.style), setBackgroundColor: o => bgs.push(o.color) }; };
  const listeners = [];
  const withEvents = (dom) => {
    dom.doc.addEventListener = (t, f, o) => listeners.push(['doc', t, o]);
    dom.win.addEventListener = (t, f, o) => listeners.push(['win', t, o]);
    dom.win.requestAnimationFrame = f => { dom.raf = (dom.raf || []); dom.raf.push(f); };
    dom.observers = [];
    dom.win.MutationObserver = class { constructor(cb) { this.cb = cb; } observe(t, o) { dom.observers.push(o); } };
    dom.win.matchMedia = () => ({ addEventListener: (t) => listeners.push(['mq', t]) });
    dom.doc.visibilityState = 'visible';
    return dom;
  };
  {
    const plugin = mkPlugin();
    const dom = withEvents(fakeDom({ tokens: TOK, stack: ['header'] }));
    const t = SB.createStatusBarTracker({ doc: dom.doc, win: dom.win, isNative: () => false, getPlugin: () => plugin });
    const n = listeners.length;
    t.install();
    assert(t.sync() === null && t.sync({ force: true }) === null && plugin.calls.length === 0 && plugin.bgs.length === 0 && listeners.length === n,
      '[4a] WEB: sync() and install() are inert — no plugin call, no listener, nothing scheduled');
  }
  {
    const dom = withEvents(fakeDom({ tokens: TOK, stack: ['header'] }));
    const t = SB.createStatusBarTracker({ doc: dom.doc, win: dom.win, isNative: () => true, getPlugin: () => undefined });
    assert(t.sync() === null, '[4b] native with no StatusBar plugin → null, no throw');
    const boom = { setStyle() { throw new Error('bridge'); }, setBackgroundColor() { throw new Error('bridge'); } };
    const t2 = SB.createStatusBarTracker({ doc: dom.doc, win: dom.win, isNative: () => true, getPlugin: () => boom });
    let threw = false; try { t2.sync(); } catch { threw = true; }
    assert(!threw, '[4c] a plugin that throws never throws out of the tracker');
  }
  {
    const plugin = mkPlugin();
    const state = { header: { top: 0, bottom: 106, height: 106 } };
    const dom = fakeDom({ tokens: TOK });
    dom.doc.querySelector = sel => (sel === '.app-header' ? { getBoundingClientRect: () => state.header } : null);
    const t = SB.createStatusBarTracker({ doc: dom.doc, win: dom.win, isNative: () => true, getPlugin: () => plugin });
    t.sync(); t.sync(); t.sync();
    assert(JSON.stringify(plugin.calls) === '["DARK"]', `[4d] three syncs on the same surface → ONE setStyle (${JSON.stringify(plugin.calls)}) — a scroll frame that changes nothing costs no bridge call`);
    state.header = { top: -200, bottom: -94, height: 106 };
    t.sync(); t.sync();
    assert(JSON.stringify(plugin.calls) === '["DARK","LIGHT"]', `[4e] scrolled past the header → one more call, 'LIGHT' (${JSON.stringify(plugin.calls)})`);
    t.sync({ force: true });
    assert(JSON.stringify(plugin.calls) === '["DARK","LIGHT","LIGHT"]', '[4f] force re-sends an unchanged style — the plugin resets it on every native viewDidAppear, so a palette repaint always re-asserts');
    assert(JSON.stringify(plugin.bgs) === '["#8C1515","#8C1515"]',
      `[4g] the Android-only background is sent from --chrome-bg, once, then again only on force (${JSON.stringify(plugin.bgs)})`);
  }
  {
    const plugin = mkPlugin();
    const dom = fakeDom({ tokens: { '--chrome-bg': '#0C2340', '--maroon': '#8C1515', '--bg': '#E8E4DC' }, stack: ['header'] });
    SB.createStatusBarTracker({ doc: dom.doc, win: dom.win, isNative: () => true, getPlugin: () => plugin }).sync();
    assert(plugin.bgs[0] === '#0C2340', `[4h] the background colour is the CHROME token, not --maroon (got ${plugin.bgs[0]} with --chrome-bg #0C2340, --maroon #8C1515)`);
  }
  {
    listeners.length = 0;
    const plugin = mkPlugin();
    const dom = withEvents(fakeDom({ tokens: TOK, stack: ['header'] }));
    const t = SB.createStatusBarTracker({ doc: dom.doc, win: dom.win, isNative: () => true, getPlugin: () => plugin });
    t.install(); t.install();
    const kinds = listeners.map(l => l[0] + ':' + l[1]);
    const scroll = listeners.find(l => l[0] === 'doc' && l[1] === 'scroll');
    assert(!!scroll && scroll[2]?.capture === true && scroll[2]?.passive === true,
      '[4i] scroll is heard in the CAPTURE phase (window AND inner scrollers, e.g. a league overlay) and PASSIVE — it can never block a scroll');
    assert(['doc:transitionend', 'win:resize', 'doc:visibilitychange', 'win:pageshow', 'mq:change'].every(k => kinds.includes(k)),
      `[4j] it also listens for a slide finishing, a resize, returning to the foreground, and the phone's appearance changing (${kinds.join(', ')})`);
    assert(dom.observers.length === 2 && dom.observers.some(o => o.childList && o.attributeFilter.includes('data-tab') && o.attributeFilter.includes('data-color-scheme'))
      && dom.observers.some(o => o.subtree && o.attributeFilter.includes('data-open')),
      '[4k] two MutationObservers: gates/overlays mounting on <body> plus its tab/theme/scheme attributes, and data-open/hidden anywhere below (the drawer)');
    assert(kinds.filter(k => k === 'doc:scroll').length === 1, '[4l] install() is idempotent — a second call adds nothing');
    assert((dom.raf || []).length === 1, '[4m] install schedules exactly one initial evaluation, on the next frame');
    dom.raf[0]();
    t.schedule(); t.schedule(); t.schedule();
    assert(dom.raf.length === 2 && JSON.stringify(plugin.calls) === '["DARK"]', '[4n] a burst of scroll events coalesces into one evaluation per frame');
  }
  {
    assert(SB.syncStatusBar({ force: true }) === null && SB.installStatusBarTracker({ isNative: () => false }) === null,
      '[4o] the app singleton on the web (or in Node): install returns null, sync is a no-op');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] source pins…');
{
  const sbCode = codeOf(sbSrc);
  assert(!/^\s*import\b/m.test(sbSrc) && !/\bexport\s+\*\s+from\b/.test(sbSrc),
    '[5a] js/status-bar.js imports nothing — it loads the same in Node, in the engine (navtest §7l) and in the app');
  assert(!/--maroon/.test(sbCode),
    '[5b] js/status-bar.js never reads --maroon (comments aside) — the header colour comes from the chrome token only');
  assert(/CHROME_TOKEN\s*=\s*'--chrome-bg'/.test(sbSrc) && /PAGE_TOKEN\s*=\s*'--bg'/.test(sbSrc),
    "[5c] the two tokens are named once: CHROME_TOKEN '--chrome-bg', PAGE_TOKEN '--bg'");
  assert(SB.SOFT_EDGE_PX === 12,
    '[5d] SOFT_EDGE_PX is 12 — option O2b as Drew picked it');
  const fn = /function syncNativeStatusBar\(\)\s*\{[\s\S]*?\n\}/.exec(appSrc)?.[0] || '';
  assert(!!fn && !/style:\s*'DARK'/.test(fn) && /installStatusBarTracker\(\{\s*isNative:\s*isNativeShell\s*\}\)/.test(fn) && /syncStatusBar\(\{\s*force:\s*true\s*\}\)/.test(fn)
    && /if \(!isNativeShell\(\)\) return;/.test(fn),
    "[5e] app.js syncNativeStatusBar(): the constant setStyle('DARK') is gone; it is native-gated, installs the tracker and FORCES a sync");
  assert(/import \{ installStatusBarTracker, syncStatusBar \} from '\.\/status-bar\.js';/.test(appSrc),
    '[5f] app.js imports the tracker statically (one import line)');
  assert((codeOf(appSrc).match(/syncNativeStatusBar\(/g) || []).length === 2 && /if \(native\) syncNativeStatusBar\(\);/.test(appSrc),
    '[5g] syncNativeStatusBar() has exactly one caller, syncChromeFromTokens() (SP-52 / DI-454: applyTheme() and every scheme change reach it through that one function — boot, post-hydrate, theme change, scheme flip)');
  const band = /body\.native-shell::before\{([^}]*)\}/.exec(cssSrc)?.[1] || '';
  assert(/height:calc\(env\(safe-area-inset-top,0px\) \+ 12px\)/.test(band),
    '[5h] the CSS band overhangs the inset by the same 12px the tracker subtracts (SOFT_EDGE_PX)');
  assert(/var\(--bg\)/.test(band) && !/--maroon|--chrome-bg/.test(band) && /z-index:90/.test(band),
    '[5i] the band is painted from --bg only (never the header\'s --maroon or --chrome-bg), at z-index 90');
  // [5j]/[5k] RE-DERIVED by SP-52 (2026-10-01, DI-454 / Amendment A1.1) — OLD: "--chrome-bg is declared exactly once, on :where(body) as var(--maroon)" and "no :root
  // declaration of --chrome-bg". SB-08's alias was a stand-in "until SP-52 lands"; DI-448/454 REPLACE that one line with the per-look values, so the old assertions pin a
  // state that is superseded by design. NEW: the alias is GONE, every --chrome-bg declaration is a LITERAL colour (never a var()), and the :root default is a literal (R1) —
  // which keeps the SB-10 guard this pair existed for (a var(--maroon) alias on :root freezes the default crimson) while allowing the per-look token the DI defines.
  const cssNoComments = stripComments(cssSrc);
  const chromeDecls = [...cssNoComments.matchAll(/([^{}]+)\{[^}]*?--chrome-bg\s*:\s*([^;}]+)/g)].map(m => ({ sel: m[1].trim(), val: m[2].trim() }));
  assert(chromeDecls.length >= 10 && !chromeDecls.some((d) => /^:where\(body\)$/.test(d.sel)) && chromeDecls.every((d) => /^#[0-9a-fA-F]{6}$/.test(d.val)),
    `[5j] --chrome-bg is a real per-look token: ${chromeDecls.length} declarations (the :root default, every school's Light block, Ink, Graphite Light/Dark, the Dark twins), EVERY value a literal hex colour and NONE on :where(body) — the SB-08 var(--maroon) alias is gone (A1.1)${chromeDecls.some((d) => !/^#[0-9a-fA-F]{6}$/.test(d.val)) ? ' — NON-LITERAL: ' + chromeDecls.filter((d) => !/^#[0-9a-fA-F]{6}$/.test(d.val)).map((d) => d.sel + ' => ' + d.val).join(' | ') : ''}`);
  const rootBlock = /(?:^|\})\s*:root\s*\{([^}]*)\}/m.exec(cssNoComments.replace(/@import[^;]*;/g, ''))?.[1] || '';
  assert(/--chrome-bg\s*:\s*#8C1515\s*;/.test(rootBlock) && !/--chrome-bg\s*:\s*var\(/.test(cssNoComments),
    '[5k] the :root default of --chrome-bg is the literal #8C1515 (R1) and nothing anywhere aliases it with var() — the SB-10 shape stays out (themetest [T7] pins the same for every overridden token)');
  assert(/'\.\/js\/status-bar\.js'/.test(swSrc), '[5l] service-worker.js precaches js/status-bar.js — a cold PWA boot can resolve app.js\'s import graph (RG-03 through the cache)');
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.exit(fail === 0 ? 0 : 1));
