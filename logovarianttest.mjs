/**
 * CFB Pickems — logovarianttest.mjs (SB-07 dark-surface logo variant,
 * Social Platform thread, bugfixer, 2026-09-30)
 * ============================================================================
 * THE AD-94 EXCEPTION (Drew, 2026-09-30, SP-52 Q5): one render-time URL
 * derivation, darkLogoUrl() in js/data-provider.js, used only for a logo on a
 * surface whose composited luminance is below 0.179, falling back to the
 * stored URL on error, storing nothing. This suite is its guard, with
 * darkLogoUrl() and the SB-07 block at the end of js/app.js.
 *
 * WHAT THIS PROVES
 *   [1] darkLogoUrl() derives ONLY ESPN's own `500` -> `500-dark` path (ncaa
 *       and the NFL `scoreboard/` form) and returns null for everything else.
 *   [2] logoSurfaceLuminance() reads the colour actually painted under the
 *       <img>: it composites translucent ancestors over the first opaque one,
 *       and refuses to guess when it finds none.
 *   [3] Through the REAL bindLogoImageEvents() capture listeners: a dark
 *       surface swaps to the dark file without fading the default in; the
 *       dark file's own load fades it in; a dark-file error falls back to the
 *       default (never to the text fallback, never in a loop); a light surface
 *       or a non-ESPN URL is left alone; the pre-existing minimal fake images
 *       ([1b]'s shape) still behave exactly as before.
 *   [4] SURFACE-BASED, NOT MODE-BASED, on the real CSS: for every logo render
 *       path in every theme map, the surface under the logo (resolved with
 *       dashcontrasttest.mjs's cascade) picks the variant. Every surface in
 *       night mode is dark; every light-theme card/row is light; the solid
 *       win/loss chip fill is dark in every theme.
 *   [4b] The load-time read is stable: no logo surface sits on both sides of
 *       the threshold across an animation's extremes, and the one in-place
 *       class toggle under a logo (a pick button's `.selected`) never crosses
 *       it, in any theme map. Either would make the file depend on timing.
 *   [5] The no-flicker contract holds on the real CSS: every class the binder
 *       swaps is hidden (opacity:0) until `.is-loaded`.
 *   [6] The extension seam DI-455 (SP-52) builds on: the class list matches
 *       the binder, the decision is pure, the stored URL is recorded on every
 *       evaluated logo, setLogoVariant() is the one writer, and a reconcile
 *       written only against the seam flips default <-> dark both ways.
 *   [7] DI-455 (SP-52, 2026-10-01) — the REAL reconcileLogoVariants(): re-pick the
 *       file when the surface changes after load; preload BEFORE swap (a visible
 *       logo's src changes only inside the preload's `load`; an `error` leaves it
 *       untouched and is remembered for the session); inert with zero logos; the
 *       surface parser FAILS SAFE on colour formats it cannot read (oklch(),
 *       color(srgb …)); the stored default is RE-VALIDATED before it is ever
 *       written; a known-missing dark file is never asked for twice; and the
 *       surface -> file map holds on all TWENTY sides (Paper Dark is a LIGHT-surface
 *       look and keeps the stored file on its paper cards).
 *
 * Run: node logovarianttest.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const assert = (cond, label) => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } };

// ── DOM / localStorage stubs (the matrixheadertest.mjs / loadtest.mjs shape) ──
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
const nullEl = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (p === 'style' || p === 'dataset') return {};
    if (['addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'insertAdjacentHTML', 'remove', 'focus', 'scrollTo'].includes(p)) return () => {};
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector' || p === 'closest') return () => null;
    if (p === 'innerHTML' || p === 'textContent' || p === 'value') return '';
    return undefined;
  },
  set: () => true,
});
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => nullEl, querySelector: () => null, querySelectorAll: () => [], createElement: () => nullEl, body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' }, hidden: false };
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.fetch = async () => { throw new Error('network disabled in logovarianttest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

console.log('\n[0] importing js/data-provider.js + js/app.js…');
const dp = await import('./js/data-provider.js');
const app = await import('./js/app.js');
const V = app._logoVariantForTest;
const bind = app._bindLogoImageEventsForTest;
assert(typeof dp.darkLogoUrl === 'function', '0-1: js/data-provider.js exports darkLogoUrl()');
assert(!!V && typeof V.swapLogoForDarkSurface === 'function' && typeof V.revertDarkLogo === 'function' && typeof V.logoSurfaceLuminance === 'function',
  '0-2: js/app.js exports the _logoVariantForTest seam');
assert(!!V && ['storedLogoUrl', 'logoVariantForSurface', 'logoUrlForVariant', 'setLogoVariant'].every((k) => typeof V[k] === 'function') && Array.isArray(V.LOGO_VARIANT_CLASSES) && typeof V.LOGO_VARIANT_SELECTOR === 'string',
  '0-2b: the seam carries the DI-455 extension points (class list, selector, decision, URL-for-variant, the one writer)');
assert(typeof bind === 'function', '0-3: js/app.js exports _bindLogoImageEventsForTest');

// ── [1] darkLogoUrl() ───────────────────────────────────────────────────────
console.log('\n[1] darkLogoUrl() — ESPN\'s own 500 -> 500-dark path, nothing else');
const NCAA = 'https://a.espncdn.com/i/teamlogos/ncaa/500/245.png';
const NFL = 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/kc.png';
assert(dp.darkLogoUrl(NCAA) === 'https://a.espncdn.com/i/teamlogos/ncaa/500-dark/245.png', '1-1: ncaa default -> the 500-dark file (Texas A&M)');
assert(dp.darkLogoUrl(NFL) === 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/scoreboard/kc.png', '1-2: NFL scoreboard default -> 500-dark/scoreboard (the shape the NFL scoreboard stores)');
for (const [label, u] of [
  ['an already-dark URL', 'https://a.espncdn.com/i/teamlogos/ncaa/500-dark/245.png'],
  ['another host with the same path', 'https://evil.example.com/i/teamlogos/ncaa/500/245.png'],
  ['a look-alike host suffix', 'https://a.espncdn.com.evil.example/i/teamlogos/ncaa/500/245.png'],
  ['plain http', 'http://a.espncdn.com/i/teamlogos/ncaa/500/245.png'],
  ['a javascript: URL', 'javascript:alert(1)'],
  ['a query string', 'https://a.espncdn.com/i/teamlogos/ncaa/500/245.png?x=1'],
  ['a quote (attribute breakout shape)', 'https://a.espncdn.com/i/teamlogos/ncaa/500/"><script>.png'],
  ['another size', 'https://a.espncdn.com/i/teamlogos/ncaa/200/245.png'],
  ['null', null], ['undefined', undefined], ['a number', 245],
]) assert(dp.darkLogoUrl(u) === null, `1-x: ${label} -> null (the stored default is kept)`);

// ── A tiny fake DOM chain with a stub getComputedStyle ───────────────────────
function el(bg, parent = null, extra = {}) { return { parentElement: parent, _bg: bg, ...extra }; }
globalThis.getComputedStyle = (e) => ({ backgroundColor: e._bg ?? 'rgba(0, 0, 0, 0)' });
function fakeImg(cls, src, parent, { withDataset = true } = {}) {
  const added = [];
  const img = {
    parentElement: parent,
    classList: { added, contains: (c) => c === cls, add(c) { added.push(c); } },
    _src: src,
    getAttribute(n) { return n === 'src' ? this._src : null; },
    setAttribute(n, v) { if (n === 'src') this._src = v; },
    closest: () => null,
  };
  if (withDataset) img.dataset = {};
  return img;
}

// ── [2] logoSurfaceLuminance() ──────────────────────────────────────────────
console.log('\n[2] logoSurfaceLuminance() — the colour actually painted under the logo');
const T = V.DARK_SURFACE_MAX_LUMINANCE;
assert(Math.abs(T - (Math.sqrt(1.05 * 0.05) - 0.05)) < 1e-3, `2-0: the threshold is the white/black contrast crossover (${T})`);
{
  const body = el('rgb(20, 17, 14)'); const card = el('rgb(31, 27, 23)', body); const box = el('rgba(0, 0, 0, 0)', card);
  const L = V.logoSurfaceLuminance({ parentElement: box });
  assert(L !== null && L < T, `2-1: a transparent box on the dark card (#1F1B17) reads DARK (L=${L?.toFixed(4)})`);
}
{
  const page = el('rgb(232, 228, 220)'); const card = el('rgb(255, 255, 255)', page); const tint = el('rgba(26, 122, 63, 0.18)', card);
  const L = V.logoSurfaceLuminance({ parentElement: tint });
  assert(L !== null && L > T, `2-2: a translucent green tint over a WHITE card composites light (L=${L?.toFixed(3)}) — the tint alone would have read dark`);
}
{
  const card = el('rgb(31, 27, 23)'); const tint = el('rgb(26 122 63 / 10%)', card);
  const L = V.logoSurfaceLuminance({ parentElement: tint });
  assert(L !== null && L < T, `2-3: modern "rgb(r g b / a%)" syntax composites too (dark, L=${L?.toFixed(4)})`);
}
{
  const floating = el('rgba(0, 0, 0, 0)', el('rgba(255, 255, 255, 0.5)'));
  assert(V.logoSurfaceLuminance({ parentElement: floating }) === null, '2-4: no opaque ground anywhere up the chain -> null (never guesses)');
}
{
  const win = el('rgb(26, 122, 63)'); const L = V.logoSurfaceLuminance({ parentElement: el('rgba(0, 0, 0, 0)', win) });
  assert(L !== null && L < T, `2-5: the solid win-chip fill (#1A7A3F) reads dark (L=${L?.toFixed(3)}) — surface-based, in EVERY theme`);
}

// ── [3] The real bindLogoImageEvents() listeners ────────────────────────────
console.log('\n[3] swap / fade / fallback through the real bindLogoImageEvents() listeners');
const handlers = {};
bind({ addEventListener(type, fn, capture) { handlers[type] = { fn, capture }; } });
assert(typeof handlers.load?.fn === 'function' && typeof handlers.error?.fn === 'function', '3-0: fixture — both capture listeners bound');
const darkCard = () => el('rgba(0, 0, 0, 0)', el('rgb(31, 27, 23)'));
const lightCard = () => el('rgba(0, 0, 0, 0)', el('rgb(255, 255, 255)'));
for (const cls of ['dc-chip-logo', 'pick-btn-logo', 'matrix-hdr-logo', 'slate-row-logo']) {
  const img = fakeImg(cls, NCAA, darkCard());
  handlers.load.fn({ target: img });
  assert(img._src === dp.darkLogoUrl(NCAA) && !img.classList.added.includes('is-loaded'),
    `3-1 ${cls}: default loads on a DARK surface -> src becomes the 500-dark file and the default is NOT faded in (no flicker)`);
  handlers.load.fn({ target: img });
  assert(img.classList.added.includes('is-loaded') && img._src === dp.darkLogoUrl(NCAA), `3-2 ${cls}: the dark file's own load fades it in, no second swap`);
}
{
  const wrapAdded = [];
  const img = fakeImg('pick-btn-logo', NCAA, darkCard());
  img.closest = (sel) => (sel === '.pick-btn-logo-wrap' ? { classList: { add: (c) => wrapAdded.push(c) } } : null);
  handlers.load.fn({ target: img });
  handlers.error.fn({ target: img });
  assert(img._src === NCAA && !wrapAdded.includes('logo-broken'), '3-3: the dark file 404s -> the stored default comes back, and the text fallback is NOT triggered');
  handlers.load.fn({ target: img });
  assert(img._src === NCAA && img.classList.added.includes('is-loaded'), '3-4: …the default then loads and fades in, with no re-swap loop');
  handlers.error.fn({ target: img });
  assert(wrapAdded.includes('logo-broken'), '3-5: a later error on the DEFAULT itself still reaches the normal .logo-broken fallback');
}
{
  // 3-9 (SP-52 DI-455, A1.2 / security N2): the dark file that just 404'd (3-3) is REMEMBERED for the session — the next logo on a dark surface keeps the stored file and never
  // asks ESPN for the missing dark file again (a 60-second repaint would otherwise re-request every missing dark file forever).
  assert(V.failedDarkLogoUrls.has(dp.darkLogoUrl(NCAA)), '3-9a: the failed dark URL is in the session set after its 404');
  const again = fakeImg('pick-btn-logo', NCAA, darkCard());
  handlers.load.fn({ target: again });
  assert(again._src === NCAA && again.classList.added.includes('is-loaded') && again.dataset.logoVariant === 'default',
    '3-9b: a later first-load on a DARK surface keeps the stored default (no second request for the known-missing dark file)');
  V.failedDarkLogoUrls.clear();   // isolate the sections below: each starts with an empty session set
}
{
  const img = fakeImg('dc-chip-logo', NCAA, lightCard());
  handlers.load.fn({ target: img });
  assert(img._src === NCAA && img.classList.added.includes('is-loaded'), '3-6: a LIGHT surface keeps the default (the dark file would vanish there) and fades it in');
}
{
  const other = 'https://cdn.example.com/logo.png';
  const img = fakeImg('dc-chip-logo', other, darkCard());
  handlers.load.fn({ target: img });
  assert(img._src === other && img.classList.added.includes('is-loaded'), '3-7: a non-ESPN URL on a dark surface is left alone');
}
{
  const img = fakeImg('pick-btn-logo', NCAA, null, { withDataset: false });
  handlers.load.fn({ target: img });
  assert(img.classList.added.includes('is-loaded') && img._src === NCAA, '3-8: the pre-existing minimal fake image shape ([1b]: no dataset/parent) behaves exactly as before');
}

// ── [4] Surface-based on the REAL CSS, every theme ──────────────────────────
console.log('\n[4] the variant each logo path gets, resolved from css/styles.css in every theme');
const dct = await import('./dashcontrasttest.mjs');
const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
const { themes } = dct.buildThemes(cssSrc);
const lum =(hex) => { const n = parseInt(hex.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const A = dct.analyze(cssSrc, await readFile(path.join(root, 'js', 'app.js'), 'utf8'));
const choice = {};
for (const [themeName, tokens] of Object.entries(themes)) {
  choice[themeName] = {};
  for (const [label, stack] of Object.entries(dct.LOGO_STACKS)) {
    const r = dct.evaluateRole({ chain: stack }, tokens, A.rules, A.kf);
    choice[themeName][label] = r.bg ? (lum(r.bg) < T ? 'dark' : 'default') : 'unresolved';
    choice[themeName][label + ' @bg'] = r.bg;
  }
}
// RE-DERIVED (SP-52 DI-455, 2026-10-01): "every Dark side sits on a dark surface" is true of every look EXCEPT Munera Paper — its Dark side paints LIGHT paper cards on an ink page
// (the paper scope), so its logos sit on LIGHT surfaces and keep the stored file (the AD-94 swap is NOT triggered). The map is per SURFACE, never per mode, which is the whole rule.
const isPaperDark = (t) => /^paper · dark/.test(t);
for (const darkName of Object.keys(themes).filter((t) => /dark/.test(t) && !isPaperDark(t))) {
  const rows = Object.keys(dct.LOGO_STACKS).map((l) => `${l}: ${choice[darkName][l]} (${choice[darkName][l + ' @bg']})`);
  assert(Object.keys(dct.LOGO_STACKS).every((l) => choice[darkName][l] === 'dark'), `4-${darkName}: every logo path sits on a DARK surface -> 500-dark file (${rows.join('; ')})`);
}
for (const lightName of Object.keys(themes).filter((t) => !/dark/.test(t) || isPaperDark(t))) {
  const c = choice[lightName];
  const ok = c['Picks page pick button logo'] === 'default' && c['matrix row-header logo'] === 'default' && c['commissioner slate-row logo'] === 'default' && c['compact dashboard chip logo'] === 'dark';
  assert(ok, `4-${lightName}: light cards/rows keep the DEFAULT file; the compact chip on the solid win fill gets the dark file (pick button ${c['Picks page pick button logo']} on ${c['Picks page pick button logo @bg']}, matrix ${c['matrix row-header logo']}, slate ${c['commissioner slate-row logo']}, win chip ${c['compact dashboard chip logo']} on ${c['compact dashboard chip logo @bg']})`);
}

// ── [4b] The load-time read cannot depend on timing ─────────────────────────
// The file is chosen ONCE, when the default loads. Two things would make that
// choice depend on when the load happened: (a) a surface whose @keyframes
// extremes sit on opposite sides of the threshold (the live chips and live
// pick buttons pulse), and (b) a class toggled IN PLACE under an already-loaded
// logo whose two states sit on opposite sides. The only in-place toggle under
// a logo is the pick button's `.selected` (js/app.js pick handler,
// `classList.toggle('selected', …)`); every other state change re-renders, so
// the new <img> is evaluated fresh. Each state below is derived from
// dct.LOGO_STACKS by swapping the state class, so it stays on the real markup.
console.log('\n[4b] no logo surface straddles the threshold across animation extremes or the in-place .selected toggle');
{
  const withState = (stack, from, to) => stack.map((n) => ((n.cls || []).includes(from) ? { ...n, cls: [...n.cls.filter((c) => c !== from), ...to] } : n));
  const CHIP = dct.LOGO_STACKS['compact dashboard chip logo'];
  const BTN = dct.LOGO_STACKS['Picks page pick button logo'];
  const STATES = {};
  for (const st of ['dc-chip-pending', 'dc-chip-win', 'dc-chip-loss', 'dc-chip-nd', 'dc-chip-live-covering', 'dc-chip-live-trailing', 'dc-chip-live']) STATES[`chip ${st}`] = withState(CHIP, 'dc-chip-win', [st]);
  for (const st of [[], ['selected'], ['locked-win'], ['locked-loss'], ['locked-nd'], ['live-covering'], ['live-trailing']]) STATES[`pick button ${st.join('+') || 'unselected'}`] = withState(BTN, 'selected', st);
  STATES['matrix row-header logo'] = dct.LOGO_STACKS['matrix row-header logo'];
  STATES['commissioner slate-row logo'] = dct.LOGO_STACKS['commissioner slate-row logo'];
  const side = (hex) => (lum(hex) < T ? 'dark' : 'default');
  for (const [themeName, tokens] of Object.entries(themes)) {
    const straddle = [], unresolved = [], picked = {};
    for (const [label, st] of Object.entries(STATES)) {
      const r = dct.surfaceCandidates(st, tokens, A.rules, A.kf);
      if (r.unresolved || !r.surfaces.length) { unresolved.push(`${label}: ${r.unresolved || 'no surface'}`); continue; }
      const sides = new Set(r.surfaces.map(side));
      if (sides.size > 1) straddle.push(`${label} (${r.surfaces.join(' / ')})`);
      picked[label] = [...sides][0];
    }
    assert(unresolved.length === 0 && straddle.length === 0,
      `4b-${themeName}: every logo state's surface stays on one side of ${T} across its animation extremes (${unresolved.length ? 'unresolved: ' + unresolved.join('; ') : straddle.length ? 'STRADDLES: ' + straddle.join('; ') : `${Object.keys(STATES).length} states clean`})`);
    assert(picked['pick button unselected'] && picked['pick button unselected'] === picked['pick button selected'],
      `4b-${themeName}: the in-place .selected toggle keeps the pick-button logo's file (unselected ${picked['pick button unselected']}, selected ${picked['pick button selected']})`);
  }
  // Sensitivity, in memory: the check above must be able to SEE a straddle,
  // or it is empty. Inject a pulse whose extremes are near-black and white on
  // the pending chip, and a dark `.pick-btn.selected`; both must be caught.
  const injected = cssSrc + '\n@keyframes probe-straddle{0%,100%{background:#111111}50%{background:#FFFFFF}}\n.dc-chip-pending{animation:probe-straddle 2s infinite}\n.pick-btn.selected{background:#111111}\n';
  const AI = dct.analyze(injected, await readFile(path.join(root, 'js', 'app.js'), 'utf8'));
  const tok0 = dct.buildThemes(injected).themes[Object.keys(themes)[0]];
  const pend = dct.surfaceCandidates(STATES['chip dc-chip-pending'], tok0, AI.rules, AI.kf);
  assert(!pend.unresolved && new Set(pend.surfaces.map(side)).size === 2, `4b-sensitivity: an injected pulse with near-black and white extremes on the pending chip IS seen as a straddle (${(pend.surfaces || []).join(' / ')})`);
  const un = dct.surfaceCandidates(STATES['pick button unselected'], tok0, AI.rules, AI.kf), se = dct.surfaceCandidates(STATES['pick button selected'], tok0, AI.rules, AI.kf);
  assert(side(un.surfaces[0]) !== side(se.surfaces[0]), `4b-sensitivity: an injected dark .pick-btn.selected IS seen as crossing the threshold on the in-place toggle (${un.surfaces[0]} -> ${se.surfaces[0]})`);
}

// ── [5] "No flicker" holds on the REAL CSS for every path the binder swaps ──
// The swap's no-flicker contract is "on a swap the default is never faded in"
// (no `.is-loaded`). That only means anything if the CSS actually hides the
// image until `.is-loaded`. [3-1] proves the class is withheld; this proves
// the withheld class hides the default. Before the B2 finish, .slate-row-logo
// had no opacity:0, so on a dark Games-tab card the default painted at full
// opacity and then visibly changed file: [3-1] stayed green because it only
// checked the class.
console.log('\n[5] every logo the binder may swap is hidden until .is-loaded, on the real css/styles.css');
{
  const appSrc5 = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  const css5 = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  const bindStart = appSrc5.indexOf('function bindLogoImageEvents(');
  const loadArm = appSrc5.slice(bindStart, appSrc5.indexOf("addEventListener('error'", bindStart));
  const swapped = [...new Set([...loadArm.matchAll(/contains\('([a-z-]+logo)'\)/g)].map((m) => m[1]))];
  assert(swapped.length === 4, `5-0: fixture — the binder's load arm handles four logo classes (${swapped.join(', ')})`);
  const ruleBody = (sel) => {
    const out = [];
    for (const m of css5.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').some((s) => s.trim() === sel)) out.push(m[2]);
    return out.join(';');
  };
  const reduced = [...css5.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)].map((m) => m[1]).join('\n');
  for (const cls of swapped) {
    const base = ruleBody('.' + cls), loaded = ruleBody(`.${cls}.is-loaded`);
    assert(/(^|;)\s*opacity\s*:\s*0\s*(;|$)/.test(base), `5-1 ${cls}: the base rule hides the image (opacity:0) until it is ready — so a swapped default is never seen`);
    assert(/(^|;)\s*opacity\s*:\s*1\s*(;|$)/.test(loaded), `5-2 ${cls}: .${cls}.is-loaded shows it (opacity:1)`);
    assert(/transition\s*:\s*opacity\s+var\(--motion-fast/.test(base), `5-3 ${cls}: it fades in over --motion-fast, the same as the other logo paths`);
    assert(new RegExp(`\\.${cls}\\s*\\{\\s*transition\\s*:\\s*none`).test(reduced), `5-4 ${cls}: Reduce Motion drops the fade (prefers-reduced-motion: transition:none)`);
  }
}

// ── [6] The extension seam DI-455 (SP-52) builds on ─────────────────────────
// DI-455 adds reconcileLogoVariants(root) (re-pick the file when the surface
// changes after load) and preload-before-swap. It must be writable against
// this seam alone, without copying B2's logic: the class list, the selector,
// the pure decision, the URL for a variant, and the one writer.
console.log('\n[6] the DI-455 extension seam: class list, selector, pure decision, URL-for-variant, one writer');
V.failedDarkLogoUrls.clear();
{
  const appSrc6 = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  const b0 = appSrc6.indexOf('function bindLogoImageEvents(');
  const errAt = appSrc6.indexOf("addEventListener('error'", b0);
  const arm = (txt) => [...new Set([...txt.matchAll(/contains\('([a-z-]+logo)'\)/g)].map((m) => m[1]))].sort();
  const loadCls = arm(appSrc6.slice(b0, errAt));
  const errCls = arm(appSrc6.slice(errAt, appSrc6.indexOf('export const _bindLogoImageEventsForTest', errAt)));
  const listed = [...V.LOGO_VARIANT_CLASSES].sort();
  assert(JSON.stringify(listed) === JSON.stringify(loadCls) && JSON.stringify(listed) === JSON.stringify(errCls),
    `6-1: LOGO_VARIANT_CLASSES is exactly the binder's load arm and error arm (${listed.join(', ')}) — a fifth logo path must be added to all three`);
  assert(Object.isFrozen(V.LOGO_VARIANT_CLASSES), '6-1b: LOGO_VARIANT_CLASSES is frozen');
  const sel = V.LOGO_VARIANT_SELECTOR.split(',');
  assert(sel.length === 4 && listed.every((c) => sel.includes(`img.${c}[data-logo-variant]`)),
    `6-2: LOGO_VARIANT_SELECTOR selects only already-evaluated logos of those four classes (${V.LOGO_VARIANT_SELECTOR})`);

  // A minimal <img> whose surface the test can change after load, as the OS
  // flipping light/dark would.
  const surface = { _bg: 'rgb(255, 255, 255)', parentElement: null };
  const mk = (src) => ({ parentElement: { _bg: 'rgba(0, 0, 0, 0)', parentElement: surface }, dataset: {}, _src: src, writes: 0,
    getAttribute(n) { return n === 'src' ? this._src : null; }, setAttribute(n, v) { if (n === 'src') { this._src = v; this.writes++; } } });
  const DARK = dp.darkLogoUrl(NCAA);

  surface._bg = 'rgb(31, 27, 23)';
  const pure = mk(NCAA);
  const before = JSON.stringify({ d: pure.dataset, s: pure._src });
  assert(V.logoVariantForSurface(pure) === 'dark' && JSON.stringify({ d: pure.dataset, s: pure._src }) === before && pure.writes === 0,
    '6-3: logoVariantForSurface() decides (dark surface -> "dark") and writes nothing');
  surface._bg = 'rgb(255, 255, 255)';
  assert(V.logoVariantForSurface(pure) === 'default', '6-4: …and a light surface -> "default"');
  surface._bg = 'rgb(31, 27, 23)';
  assert(V.logoVariantForSurface(mk('https://cdn.example.com/logo.png')) === 'default', '6-5: a non-ESPN URL -> "default" on any surface (nothing to swap to)');
  {
    const floating = { parentElement: { _bg: 'rgba(0, 0, 0, 0)', parentElement: null }, dataset: {}, getAttribute: () => NCAA };
    assert(V.logoVariantForSurface(floating) === 'default', '6-6: no opaque ground -> "default" (never guesses dark)');
  }

  // First load on a LIGHT surface keeps the default AND records the stored URL,
  // so a later reconcile can go default -> dark without re-reading anything.
  surface._bg = 'rgb(255, 255, 255)';
  const img = mk(NCAA);
  assert(V.swapLogoForDarkSurface(img) === false && img.dataset.logoVariant === 'default' && img.dataset.logoDefault === NCAA && img.writes === 0,
    '6-7: a light-surface first load records data-logo-default and data-logo-variant="default", and writes no src');
  assert(V.logoUrlForVariant(img, 'dark') === DARK && V.logoUrlForVariant(img, 'default') === NCAA && V.logoUrlForVariant(img, 'sepia') === null,
    '6-8: logoUrlForVariant() gives the 500-dark file, the stored file, and null for an unknown variant');

  // A reconcile written ONLY against the seam (the shape DI-455 will build,
  // minus its preload): the surface turns dark, then light again.
  const reconcile = (el) => { const want = V.logoVariantForSurface(el); return want !== el.dataset.logoVariant && V.setLogoVariant(el, want); };
  surface._bg = 'rgb(31, 27, 23)';
  assert(reconcile(img) === true && img._src === DARK && img.dataset.logoVariant === 'dark' && img.dataset.logoDefault === NCAA,
    '6-9: surface turns DARK after load -> the seam flips default -> dark (the stored URL is kept)');
  assert(reconcile(img) === false && img.writes === 1, '6-10: …and a second pass with nothing changed writes nothing');
  surface._bg = 'rgb(255, 255, 255)';
  assert(V.storedLogoUrl(img) === NCAA && reconcile(img) === true && img._src === NCAA && img.dataset.logoVariant === 'default',
    '6-11: surface turns LIGHT again -> the seam flips dark -> default, back to the stored URL (never the dark one)');
  {
    const other = mk('https://cdn.example.com/logo.png');
    assert(V.setLogoVariant(other, 'dark') === false && other.writes === 0 && other.dataset.logoVariant === undefined,
      '6-12: setLogoVariant(…, "dark") on a URL with no dark file writes nothing and records nothing');
  }
  {
    // The error path still works after a seam-driven flip to dark.
    surface._bg = 'rgb(31, 27, 23)';
    const e = mk(NCAA); V.swapLogoForDarkSurface(e);
    assert(e._src === DARK && V.revertDarkLogo(e) === true && e._src === NCAA && e.dataset.logoVariant === 'default' && V.revertDarkLogo(e) === false,
      '6-13: a dark-file error goes back to the stored URL once, and a second error is not swallowed (no loop)');
  }
}

// ── [7] DI-455 — the real reconcile ─────────────────────────────────────────
console.log('\n[7] DI-455 — reconcileLogoVariants(): re-pick on a surface change, preload before swap, fail-safe parser, re-validated default, known-missing set');
{
  V.failedDarkLogoUrls.clear();
  const DARK = dp.darkLogoUrl(NCAA);
  // a fake Image: the app assigns onload/onerror, then src; the test fires them
  const made = [];
  const PrevImage = globalThis.Image;
  globalThis.Image = class FakeImage { constructor() { this.onload = null; this.onerror = null; made.push(this); } set src(v) { this._src = v; } get src() { return this._src; } };
  const surface = { _bg: 'rgb(255, 255, 255)', parentElement: null };
  const events = [];
  const mkImg = (src, cls = 'pick-btn-logo') => ({
    parentElement: { _bg: 'rgba(0, 0, 0, 0)', parentElement: surface }, dataset: {}, _src: src, writes: 0, classList: { contains: (c) => c === cls, add() {} },
    getAttribute(n) { return n === 'src' ? this._src : null; }, setAttribute(n, v) { if (n === 'src') { this._src = v; this.writes++; events.push('src=' + v.split('/').slice(-2).join('/')); } },
  });
  const rootOf = (...imgs) => ({ querySelectorAll: (sel) => { events.push('query:' + (sel === V.LOGO_VARIANT_SELECTOR ? 'selector' : sel)); return imgs.filter((i) => i.dataset.logoVariant); } });

  // 7-1  default -> dark when the surface turns dark; the visible src changes ONLY inside the preload's load
  surface._bg = 'rgb(255, 255, 255)';
  const img = mkImg(NCAA);
  V.swapLogoForDarkSurface(img);                    // first load on a light surface: records the variant, writes nothing
  surface._bg = 'rgb(31, 27, 23)';
  made.length = 0; events.length = 0;
  const started = V.reconcileLogoVariants(rootOf(img));
  assert(started === 1 && made.length === 1 && made[0]._src === DARK && img.writes === 0 && img._src === NCAA,
    `7-1a: the surface turned DARK after load -> ONE preload of the dark file starts, and the VISIBLE logo is untouched until it loads (writes ${img.writes}, src ${img._src === NCAA ? 'still the stored file' : img._src})`);
  made[0].onload();
  assert(img._src === DARK && img.dataset.logoVariant === 'dark' && img.dataset.logoDefault === NCAA && events.indexOf('src=500-dark/245.png') > events.indexOf('query:selector'),
    '7-1b: ONLY inside the preload\'s load does the visible src change (to the 500-dark file); the stored URL is kept on the element');
  // 7-2  nothing changed -> nothing started, nothing written
  made.length = 0;
  assert(V.reconcileLogoVariants(rootOf(img)) === 0 && made.length === 0 && img.writes === 1, '7-2: a second pass with nothing changed starts no preload and writes nothing');
  // 7-3  dark -> default when the surface turns light again; again only inside the preload's load, and never the dark file
  surface._bg = 'rgb(255, 255, 255)';
  made.length = 0;
  assert(V.reconcileLogoVariants(rootOf(img)) === 1 && made[0]._src === NCAA && img._src === DARK, '7-3a: surface turns LIGHT again -> the stored file is preloaded, and the visible dark file stays until it is ready');
  made[0].onload();
  assert(img._src === NCAA && img.dataset.logoVariant === 'default', '7-3b: …then the swap back to the stored file happens inside that load (a white 500-dark mark never lingers on a light card)');
  // 7-4  the surface moved AGAIN while the preload was loading: a stale target is not committed
  surface._bg = 'rgb(31, 27, 23)'; made.length = 0;
  V.reconcileLogoVariants(rootOf(img));
  surface._bg = 'rgb(255, 255, 255)';
  made[0].onload();
  assert(img._src === NCAA && img.dataset.logoVariant === 'default', '7-4: if the surface flips back before the preload finishes, the stale target is NOT committed');

  // 7-5  a failed DARK preload: the visible logo stays exactly as it is, the URL is remembered, and there is no retry storm
  V.failedDarkLogoUrls.clear();
  surface._bg = 'rgb(255, 255, 255)';
  const imgE = mkImg(NCAA);
  V.swapLogoForDarkSurface(imgE);
  surface._bg = 'rgb(31, 27, 23)'; made.length = 0; events.length = 0;
  V.reconcileLogoVariants(rootOf(imgE));
  made[0].onerror();
  assert(imgE._src === NCAA && imgE.writes === 0 && imgE.dataset.logoVariant === 'default' && V.failedDarkLogoUrls.has(DARK),
    '7-5a: the dark file errors in the PRELOAD -> the visible src is untouched, the variant stays "default", and the failed URL is remembered');
  made.length = 0;
  assert(V.reconcileLogoVariants(rootOf(imgE)) === 0 && made.length === 0, '7-5b: …and the next reconcile does NOT ask for it again (one 404 per URL per session)');

  // 7-6  inert with zero logos; no Image constructor (a non-browser) is a clean no-op
  assert(V.reconcileLogoVariants({ querySelectorAll: () => [] }) === 0 && V.reconcileLogoVariants({}) === 0 && V.reconcileLogoVariants(null) === 0,
    '7-6: zero logos (the Team-logos switch is off by default) costs one empty query; a root with no querySelectorAll is a clean no-op');
  // 7-7  a non-ESPN URL never reconciles
  V.failedDarkLogoUrls.clear(); surface._bg = 'rgb(31, 27, 23)'; made.length = 0;
  const foreign = mkImg('https://cdn.example.com/logo.png'); foreign.dataset.logoVariant = 'default';
  assert(V.reconcileLogoVariants(rootOf(foreign)) === 0 && made.length === 0, '7-7: a non-ESPN URL on a dark surface starts no preload (there is no dark file for it)');

  // 7-8  A1.2 R3: the parser FAILS SAFE on a colour format it cannot read — it never skips the layer and reads the surface underneath
  {
    const page = el('rgb(20, 17, 14)');                                  // a DARK page...
    for (const fmt of ['oklch(0.97 0.01 80)', 'color(srgb 0.95 0.94 0.91)', 'lab(95% 2 6)', 'color-mix(in srgb, white 80%, black)']) {
      const lightCard = el(fmt, page);                                    // ...under a LIGHT card painted in a format we cannot parse
      const L = V.logoSurfaceLuminance({ parentElement: el('rgba(0, 0, 0, 0)', lightCard) });
      assert(L === null, `7-8 ${fmt.split('(')[0]}(): an opaque background this parser cannot read -> null, NOT the dark page underneath (L=${L})`);
    }
    const lightCardOklch = el('oklch(0.97 0.01 80)', el('rgb(20, 17, 14)'));
    const img8 = fakeImg('pick-btn-logo', NCAA, el('rgba(0, 0, 0, 0)', lightCardOklch));
    handlers.load.fn({ target: img8 });
    assert(img8._src === NCAA && img8.classList.added.includes('is-loaded'), '7-8b: an oklch()/color() light card over a dark page gets the DEFAULT file — never the white 500-dark mark');
    const transparent = el('transparent', el('rgb(31, 27, 23)'));
    assert(V.logoSurfaceLuminance({ parentElement: transparent }) < T, '7-8c: the keyword `transparent` is still skipped (only an UNREADABLE colour fails safe)');
  }
  // 7-9  security N1: the stored default is RE-VALIDATED before it is written as a src
  {
    const planted = mkImg('http://evil.example.com/x.png'); planted.dataset.logoDefault = 'http://evil.example.com/x.png'; planted.dataset.logoVariant = 'dark';
    assert(V.logoUrlForVariant(planted, 'default') === null && V.setLogoVariant(planted, 'default') === false && planted.writes === 0,
      '7-9: a planted non-https data-logo-default writes NOTHING (logoUrlForVariant("default") is logoOk(stored) ? stored : null)');
    const js = mkImg('javascript:alert(1)'); js.dataset.logoDefault = 'javascript:alert(1)';
    assert(V.logoUrlForVariant(js, 'default') === null, '7-9b: …and a javascript: URL likewise');
  }
  // 7-10 the swap is surface-based on all twenty sides: Paper Dark keeps the stored file on its paper cards
  {
    const R = await import('./themeresolve.mjs');
    const sheet = R.parseSheet(cssSrc);
    const lumOf = (hex) => lum(hex);
    const bad = [];
    for (const key of ['neutral', 'paper', 'ink', 'graphite', 'aggie', 'sooner', 'trojan', 'irish', 'boilermaker', 'razorback']) for (const side of ['L', 'D']) {
      const r = R.resolveSide(sheet, key, side, 'system');
      let get = r.get;
      if (key === 'paper' && side === 'D') { const sn = R.makeNode({ tag: 'div', classes: ['card'], parent: r.body }); r.body.children.push(sn); get = (n) => R.computedCustom(sheet, sn, n, r.ctx); }
      const card = get('--bg-card').toUpperCase(), game = get('--bg-game').toUpperCase();
      const wantDark = (side === 'D' && key !== 'paper');
      for (const [label, hex] of [['card', card], ['game card', game]]) {
        if ((lumOf(hex) < T) !== wantDark) bad.push(`${key}:${side} ${label} ${hex} -> ${lumOf(hex) < T ? 'dark' : 'default'} (expected ${wantDark ? 'dark' : 'default'})`);
      }
    }
    assert(bad.length === 0, `7-10: the surface -> file map holds on all 20 sides: dark card/game-card surfaces get the 500-dark file; every Light side AND Paper Dark's paper cards keep the stored file${bad.length ? ' — ' + bad.join('; ') : ''}`);
  }
  globalThis.Image = PrevImage;
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 8000).unref();
