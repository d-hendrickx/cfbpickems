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
 *   [8] FB-021 (bugfixer, 2026-10-07) — the Home Live Peek: the real Home wiring
 *       on a minidom tree from the real index.html; a loaded `.dc-chip-logo`
 *       is shown, a broken one falls back to the chip's team label, and a
 *       re-created #home-root is still heard.
 *   [9] FB-024 (bugfixer, 2026-10-07) — a repaint shows a logo whose exact file
 *       already loaded on this page at once (no blank, no fade), for all four
 *       logo classes on every bound page; a never-loaded file (a league
 *       switch) is never another game's and still waits for its own load; a
 *       failed file is forgotten. [9b] the dark-surface rule still picks the
 *       file; [9c] the `.logo-instant` CSS.
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
  V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();   // isolate the sections below: each starts with an empty session set
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
V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();
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
  V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();
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
  V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();
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
  V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear(); surface._bg = 'rgb(31, 27, 23)'; made.length = 0;
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

// ── [8] FB-021 — the Home Live Peek's logos (bugfixer, 2026-10-07) ──────────
// Drew, v0.29.0: "logos arent popping up in home live dashboard peak".
// ROOT CAUSE: every team-logo <img> is opacity:0 until bindLogoImageEvents()'s
// capture-phase 'load' listener adds `.is-loaded` ([5]). That listener was
// bound on #page-picks, #page-dashboard and #page-commissioner, never on
// #page-home. The Live Peek is renderDashboardCompact() injected into Home's
// Now card, so its `.dc-chip-logo` loaded and stayed invisible, and a broken
// one never reached the `.logo-broken` text fallback either.
// This drives the REAL Home wiring (ensureHomeRoot -> js/home.js -> the compact
// dashboard) on a minidom tree built from the real index.html. minidom has no
// capture phase: a 'load' dispatched with bubbles:true reaches the ancestors'
// listeners, which is what the browser's capture phase does for this
// non-bubbling event. Whether a real WebKit paints the image is a DEVICE check.
// D1 Lane B (Game Day, 2026-10-08) — THE LIVE PEEK IS RETIRED (DI-582 → DI-603: Home's Now card is the Game Day card, which paints no team logo). What FB-021 and FB-024 protect is the SHARED
// binder — a logo painted from Home must be heard by it (shown on load, its team label on error, still heard after its root is re-created, never blanked by a repaint) — and the one place Home now paints
// team logos is the GAME VIEW (the pushed screen a Game Day row opens: two team lockups, `.matrix-hdr-logo` in `.matrix-hdr-logo-box`, mounted in #pushed-root whose onMount binds the same binder).
// So the fixture below opens the Game view of the seeded live game from Home's own action (`open-game`) instead of reading a chip from the Live Peek; the assertions are the same ones, retargeted
// (two lockups instead of one pick chip; `.matrix-hdr-logo-box.logo-broken` instead of `.dc-chip-pick.logo-broken`; the abbreviation beside the logo is the label it falls back to).
console.log('\n[8] FB-021 — the Game view (Home\'s one team-logo surface): a loaded logo is shown, a broken one falls back to the team label');
const { MiniDocument, MiniElement } = await import('./minidom.mjs');
const ps = await import('./js/pushed-screen.js');
const storage = await import('./js/storage.js');
const INDEX_HTML = await readFile(path.join(root, 'index.html'), 'utf8');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); doc.body.innerHTML = bodyHtmlOf(INDEX_HTML); return doc; };
if (typeof MiniElement.prototype.insertAdjacentHTML !== 'function') {
  // the paused-league banner prepends with it (homenavtest supplies the same one method; minidom.mjs is not edited)
  MiniElement.prototype.insertAdjacentHTML = function (pos, html) {
    const t = this.ownerDocument.createElement('div'); t.innerHTML = html;
    const kids = [...t._children]; t._children = [];
    if (pos === 'afterbegin') { for (const k of kids.reverse()) { k.parentNode = this; this._children.unshift(k); } }
    else { for (const k of kids) { k.parentNode = this; this._children.push(k); } }
  };
}
const STUB_DOC = globalThis.document;
const quietLogs = async (fn) => { const w = console.warn, i = console.info, e = console.error; console.warn = console.info = console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; console.error = e; } };
const KICKED = new Date(Date.now() - 3600e3).toISOString();
const LEAGUES = {
  A: { home: 'Texas A&M', away: 'Texas', homeLogo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/245.png', awayLogo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png' },
  B: { home: 'Oklahoma', away: 'Arkansas', homeLogo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/201.png', awayLogo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/8.png' },
};
/** One live week, one live game, the viewer's own pick on the home side, Team logos ON (they are off by default, storage.js getLogoView()). */
let curLeague = 'A';
const seedPeek = (league = 'A', { homeScore = 14, logoView = true } = {}) => {
  const L = LEAGUES[league];
  curLeague = league;
  store.clear();
  storage.savePlayer({ playerId: 'lp_me', displayName: 'Peek Viewer', active: true, preferences: { logoView } });
  storage.saveWeek({ weekId: `lp_w_${league}`, weekNumber: 1, season: 2026, name: 'Week 1', status: 'live', dataSourceMode: 'live' });
  storage.saveGame({ gameId: `lp_g_${league}`, weekId: `lp_w_${league}`, homeTeam: L.home, awayTeam: L.away, homeLogo: L.homeLogo, awayLogo: L.awayLogo,
    status: 'live', homeScore, awayScore: 7, spread: -3, lockedSpread: -3, favorite: L.home, multiplier: 1, kickoff: KICKED, isManual: false });
  storage.saveAllPicks([{ weekId: `lp_w_${league}`, gameId: `lp_g_${league}`, playerId: 'lp_me', selectedTeam: L.home }]);
  storage.setSession('lp_me', false, true);
};
const settleTicks = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
/** A Home paint, then a settle: the first paint of a fresh page also starts the news slot's fetch (network is off here), whose answer repaints Home once more. */
const openGameView = () => { try { ps.closeAllScreens('test'); } catch { /* none open */ } app.state.currentTab = 'home'; app._renderHomePageForTest(); app._onHomeActionForTest('open-game', { gameId: `lp_g_${curLeague}` }); };
const paintHome = () => quietLogs(async () => { openGameView(); await settleTicks(); });
/** A repaint with NO macrotask after it: only the microtasks a real MutationObserver delivery would get before the next frame. */
const paintHomeNow = () => { const w = console.warn, i = console.info, e = console.error; console.warn = console.info = console.error = () => {}; try { openGameView(); } finally { console.warn = w; console.info = i; console.error = e; } };
const peekLogos = () => [...globalThis.document.querySelectorAll('#pushed-root img.matrix-hdr-logo')];
const fire = (img, type) => img.dispatchEvent({ type, bubbles: true });
const newHomeDoc = () => { try { ps.closeAllScreens('test'); } catch { /* none open */ } globalThis.document = freshDoc(); app._resetHomeWiringForTest(); };
{
  newHomeDoc(); seedPeek('A');
  await paintHome();
  const imgs = peekLogos();
  assert(imgs.length === 2 && imgs.map((i) => i.getAttribute('src')).sort().join() === [LEAGUES.A.homeLogo, LEAGUES.A.awayLogo].sort().join() && imgs.every((i) => !i.classList.contains('is-loaded')),
    `8-0: (fixture) the Game view Home opens paints both teams' lockups with their logos, hidden until they load (got ${imgs.length} logo(s))`);
  imgs.forEach((i) => fire(i, 'load'));
  assert(imgs.length === 2 && imgs.every((i) => i.classList.contains('is-loaded')),
    '8-1: THE BUG — a Game-view logo\'s own load adds .is-loaded, so the logo is SHOWN (before the fix nothing bound on a root Home paints into, and it sat at opacity:0 forever)');

  // a broken logo -> the chip's own team label, the same text the chip shows with Team logos off
  newHomeDoc(); seedPeek('A', { logoView: false }); await paintHome();
  const lockupText = (root) => [...(root ? root.querySelectorAll('.tl-abbr') : [])].map((n) => n.textContent.trim()).join('/');
  const offText = lockupText(globalThis.document.querySelector('#pushed-root'));
  newHomeDoc(); seedPeek('A'); await paintHome();
  const broken = peekLogos()[0];
  if (broken) fire(broken, 'error');
  const chip = broken?.closest('.matrix-hdr-logo-box');
  assert(!!chip && chip.classList.contains('logo-broken') && lockupText(globalThis.document.querySelector('#pushed-root')) === offText && offText.length > 0,
    `8-2: a logo that fails to load turns its box to .logo-broken, and the lockup falls back to exactly the label it shows without logos ("${offText}"), never a broken-image box`);
  const cssNoComments = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(/\.dc-chip-pick\.logo-broken \.dc-chip-logo\{display:none\}/.test(cssNoComments) && /\.dc-chip-pick\.logo-broken \.dc-chip-pick-fallback\{display:inline\}/.test(cssNoComments)
      && /\.dc-chip-logo\{width:14px;height:14px;/.test(cssNoComments),
    '8-3: …and the CSS that makes that swap is in place: the fixed 14px box (no layout shift), the broken image hidden, the label shown');

  // the hold teardown / a league-flow screen re-creates #home-root: the next paint's logos are still heard (the listener is on the SECTION, which survives)
  ps.closeAllScreens('test');
  assert(!globalThis.document.getElementById('pushed-root') || peekLogos().length === 0, '8-4a: (fixture) closing the screen removes the logos with their root');
  await paintHome();
  const again = peekLogos()[0];
  if (again) fire(again, 'load');
  assert(!!again && again.classList.contains('is-loaded'), '8-4: after the screen root is torn down and re-created, the new Game-view logo is still shown on its load (every new root binds the one binder)');
}

// ── [9] FB-024 — a repaint keeps already-loaded logos on screen (bugfixer, 2026-10-07) ──
// Drew, v0.29.0: "When I refresh, the logos all blank out for a fraction of a
// second and it looks glitchy". ROOT CAUSE: every repaint (pull-to-refresh, the
// sync tap, every score tick) rebuilds the markup with innerHTML (js/home.js
// paint(); renderDashboard(); the Picks renders), so every logo is a NEW <img>
// that starts at opacity:0 and waits for its own 'load' before fading back in
// over 150 ms — even when the browser already holds the file. On a dark surface
// it also waits for the 500-dark swap. Nothing remembered that the file had
// already been shown. The fix belongs to the ONE shared binder (all four logo
// classes, every bound page): a logo whose exact file has already loaded on this
// page is shown at once on a repaint, with no fade; any other logo keeps the
// cached -> load -> fade path. A MutationObserver stands in for the browser's here
// (minidom has none): the innerHTML setter queues a childList record in a
// microtask, the delivery timing a real MutationObserver has (before the next frame).
console.log('\n[9] FB-024 — a repaint shows a logo the page has already loaded at once (no blank, no fade); anything else still waits for its own load');
{
  const observers = [];
  const PrevMO = globalThis.MutationObserver;
  globalThis.MutationObserver = class FakeMutationObserver {
    constructor(cb) { this.cb = cb; this.targets = []; }
    observe(target, opts) { this.targets.push({ target, opts: opts || {} }); if (!observers.includes(this)) observers.push(this); }
    disconnect() { this.targets = []; const i = observers.indexOf(this); if (i >= 0) observers.splice(i, 1); }
    takeRecords() { return []; }
  };
  const ihDesc = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'innerHTML');
  Object.defineProperty(MiniElement.prototype, 'innerHTML', {
    configurable: true, get: ihDesc.get,
    set(html) {
      const removedNodes = [...this._children];
      ihDesc.set.call(this, html);
      const addedNodes = [...this._children];
      for (const o of observers) for (const { target, opts } of o.targets) {
        if (opts.childList && (target === this || (opts.subtree && target.contains(this)))) {
          const rec = { type: 'childList', target: this, addedNodes, removedNodes };
          queueMicrotask(() => o.cb([rec], o));
        }
      }
    },
  });
  // D1 Lane B: the Game view's level arrives by appendChild / insertAdjacentHTML (the pushed-screen shell), not by an innerHTML setter; a real MutationObserver sees all three, so the stand-in must too.
  const apDesc = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'appendChild'), iahDesc = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'insertAdjacentHTML');
  const notifyAdded = (target, addedNodes) => { for (const o of observers) for (const { target: t, opts } of o.targets) if (opts.childList && (t === target || (opts.subtree && t.contains(target)))) { const rec = { type: 'childList', target, addedNodes, removedNodes: [] }; queueMicrotask(() => o.cb([rec], o)); } };
  Object.defineProperty(MiniElement.prototype, 'appendChild', { configurable: true, writable: true, value: function appendChild(c) { const r = apDesc.value.call(this, c); notifyAdded(this, [c]); return r; } });
  Object.defineProperty(MiniElement.prototype, 'insertAdjacentHTML', { configurable: true, writable: true, value: function insertAdjacentHTML(pos, html) { const before = new Set(this._children); const r = iahDesc.value.call(this, pos, html); notifyAdded(this, this._children.filter((n) => !before.has(n))); return r; } });
  const microtasks = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const loaded = V.loadedLogoUrls;
  assert(loaded instanceof Set && typeof V.primeLoadedLogo === 'function',
    '9-0: (fixture) js/app.js exposes the loaded-logo set and the primer through the _logoVariantForTest seam');
  loaded?.clear?.(); V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();

  // the first paint: nothing loaded yet -> the normal path (hidden, then its own load shows it)
  newHomeDoc(); seedPeek('A', { homeScore: 14 });
  await paintHome(); await microtasks();
  const first = peekLogos().find((i) => i.getAttribute('src') === LEAGUES.A.homeLogo);
  assert(!!first && !first.classList.contains('is-loaded'), '9-1: (fixture) the FIRST paint of a logo this page has never loaded still waits for its load (cached -> load -> fade)');
  if (first) fire(first, 'load');
  assert(!!loaded && loaded.has(LEAGUES.A.homeLogo), '9-2: …and its successful load is remembered (the URL only; nothing else is kept)');

  // a score tick / pull-to-refresh: the markup changes, Home replaces it, the logo is a NEW <img>
  seedPeek('A', { homeScore: 21 });
  paintHomeNow();
  const second = peekLogos().find((i) => i.getAttribute('src') === LEAGUES.A.homeLogo);
  assert(!!second && second !== first && second.getAttribute('src') === LEAGUES.A.homeLogo,
    '9-3: (fixture) the repaint really rebuilt the chip: a different <img> element, the same file');
  await microtasks();
  assert(!!second && second.classList.contains('is-loaded') && second.classList.contains('logo-instant'),
    '9-4: THE BUG — after the repaint the already-loaded logo is visible at once (.is-loaded + .logo-instant), with NO load event and NO fade: it never blanks');
  if (second) fire(second, 'load');
  assert(!!second && second.classList.contains('is-loaded') && second.getAttribute('src') === LEAGUES.A.homeLogo && second.dataset.logoVariant === 'default',
    '9-5: the browser\'s own later load of that <img> changes nothing (no swap, no second state)');

  // a league switch: league B's game in the same spot. Its logo must never be league A's, and it is not shown before its OWN file loads
  seedPeek('B', { homeScore: 3 });
  await paintHome(); await microtasks();
  const other = peekLogos().find((i) => i.getAttribute('src') === LEAGUES.B.homeLogo) || peekLogos()[0];
  const allSrc = [...globalThis.document.querySelectorAll('#page-home img'), ...globalThis.document.querySelectorAll('#pushed-root img')].map((i) => i.getAttribute('src'));
  assert(!!other && other.getAttribute('src') === LEAGUES.B.homeLogo && !allSrc.includes(LEAGUES.A.homeLogo) && !allSrc.includes(LEAGUES.A.awayLogo) && !other.classList.contains('is-loaded'),
    '9-6: after a league switch the chip carries ITS OWN team\'s file, nothing on Home still shows the previous game\'s logo, and a file this page has not loaded is not shown before it loads');
  if (other) fire(other, 'load');
  assert(!!other && other.classList.contains('is-loaded') && !other.classList.contains('logo-instant'),
    '9-7: …and that new logo then fades in on its own load, the normal progressive path (only already-loaded files skip the fade)');

  // a remembered file that now fails: the text fallback still applies, and the file is forgotten so the next repaint waits for it
  seedPeek('A', { homeScore: 28 });
  paintHomeNow(); await microtasks();
  const flaky = peekLogos().find((i) => i.getAttribute('src') === LEAGUES.A.homeLogo);
  assert(!!flaky && flaky.classList.contains('is-loaded'), '9-8: (fixture) back on league A, the remembered logo is shown at once');
  if (flaky) fire(flaky, 'error');
  assert(!!flaky && flaky.closest('.matrix-hdr-logo-box')?.classList.contains('logo-broken') && !loaded.has(LEAGUES.A.homeLogo),
    '9-9: a remembered logo that errors still falls back to the team label (.logo-broken), and its file is forgotten');
  seedPeek('A', { homeScore: 35 });
  await paintHome(); await microtasks();
  const retry = peekLogos().find((i) => i.getAttribute('src') === LEAGUES.A.homeLogo);
  // D1 Lane B: the Game view's lockups follow the batch-L rule (logofailtest [4]): a file that FAILED is never asked for again this session, so its lockup paints no <img> at all (the abbreviation beside it is the label) —
  // either way the next repaint must not show that file as loaded.
  assert(!retry || !retry.classList.contains('is-loaded'), '9-10: …so the next repaint never shows that file as loaded (the Game view paints no <img> for a file that already failed, instead of an image that may be broken)');

  // every logo class, on a bound page that is not Home: Picks, Dashboard (chip + matrix) and the Commissioner slate share the one binder
  globalThis.document = freshDoc();
  loaded?.clear?.();
  const U = 'https://a.espncdn.com/i/teamlogos/ncaa/500/2633.png';
  const markup = () => `<span class="pick-btn-logo-wrap"><span class="pick-btn-logo-box"><img class="pick-btn-logo" src="${U}" alt=""></span><span class="pick-btn-logo-name">Tennessee</span></span>`
    + `<span class="dc-chip-pick"><img class="dc-chip-logo" src="${U}" alt="Tennessee"><span class="dc-chip-pick-fallback">TENN</span></span>`
    + `<span class="matrix-hdr-logo-box"><img class="matrix-hdr-logo" src="${U}" alt=""></span>`
    + `<img class="slate-row-logo" src="${U}" alt="">`
    + `<img class="player-avatar" src="${U}" alt="">`;
  const dash = globalThis.document.getElementById('page-dashboard');
  bind(dash);
  dash.innerHTML = markup(); await microtasks();
  const firstSet = [...dash.querySelectorAll('img')];
  assert(firstSet.slice(0, 4).every((i) => !i.classList.contains('is-loaded')), '9-11: (fixture) a bound page\'s first paint of never-loaded logos waits for their loads');
  firstSet.slice(0, 4).forEach((i) => fire(i, 'load'));
  dash.innerHTML = markup(); await microtasks();
  const again = [...dash.querySelectorAll('img')];
  for (const [n, cls] of [[0, 'pick-btn-logo'], [1, 'dc-chip-logo'], [2, 'matrix-hdr-logo'], [3, 'slate-row-logo']]) {
    assert(again[n] !== firstSet[n] && again[n].classList.contains(cls) && again[n].classList.contains('is-loaded') && again[n].classList.contains('logo-instant'),
      `9-12 ${cls}: a repaint of that page shows the already-loaded logo at once (one shared mechanism for all four logo classes)`);
  }
  assert(!again[4].classList.contains('is-loaded') && !again[4].classList.contains('logo-instant') && again[4].dataset.logoVariant === undefined,
    '9-13: an <img> that is not a team logo is never touched, even with a remembered URL');

  // a page painted BEFORE its first bind (renderDashboard() binds after it paints): the bind itself shows the remembered logos
  const comm = globalThis.document.getElementById('page-commissioner');
  comm.innerHTML = `<img class="slate-row-logo" src="${U}" alt="">`;
  bind(comm);
  assert(comm.querySelector('img.slate-row-logo')?.classList.contains('is-loaded'), '9-14: a page whose first paint came before its first bind gets the same treatment the moment it is bound');

  globalThis.MutationObserver = PrevMO;
  Object.defineProperty(MiniElement.prototype, 'innerHTML', ihDesc);
  Object.defineProperty(MiniElement.prototype, 'appendChild', apDesc);
  Object.defineProperty(MiniElement.prototype, 'insertAdjacentHTML', iahDesc);
  globalThis.document = STUB_DOC;
}

// ── [9b] FB-024 on a DARK surface: never a flash of the wrong file ──────────
// The 500-dark rule (SB-07, [3]) still decides the file. A repaint may skip the
// fade ONLY with the exact file that belongs on the surface under the logo and
// that has already loaded. A default that loaded on a light card is NOT shown on
// a dark one (it would flash before the swap); that logo takes the normal path.
console.log('\n[9b] FB-024 on a dark surface — the primer only ever shows the file that belongs on that surface');
{
  const loaded = V.loadedLogoUrls;
  const prime = V.primeLoadedLogo;
  if (loaded instanceof Set && typeof prime === 'function') {
    loaded.clear(); V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();
    const DARK = dp.darkLogoUrl(NCAA);
    const mk = (src, parent, cls = 'dc-chip-logo') => {
      const classes = new Set([cls]);
      return { parentElement: parent, dataset: {}, _src: src, writes: 0,
        classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), has: (c) => classes.has(c) },
        getAttribute(n) { return n === 'src' ? this._src : null; }, setAttribute(n, v) { if (n === 'src') { this._src = v; this.writes++; } } };
    };
    loaded.add(NCAA);
    const onDark = mk(NCAA, darkCard());
    assert(prime(onDark) === false && !onDark.classList.has('is-loaded') && onDark._src === NCAA && onDark.dataset.logoVariant === undefined,
      '9b-1: only the DEFAULT file has loaded (on a light card) -> a logo on a DARK surface is NOT shown at once: the default would flash before the 500-dark swap, so it takes the normal path');
    loaded.add(DARK);
    const onDark2 = mk(NCAA, darkCard());
    assert(prime(onDark2) === true && onDark2._src === DARK && onDark2.dataset.logoVariant === 'dark' && onDark2.dataset.logoDefault === NCAA && onDark2.classList.has('is-loaded') && onDark2.classList.has('logo-instant'),
      '9b-2: once the 500-dark file has loaded, a repaint on a dark surface shows THAT file at once (src, variant and stored default all recorded exactly as the load-time swap records them)');
    loaded.clear(); loaded.add(DARK);
    const onLight = mk(NCAA, lightCard());
    assert(prime(onLight) === false && !onLight.classList.has('is-loaded') && onLight._src === NCAA,
      '9b-3: only the dark file has loaded -> a logo on a LIGHT surface is not shown at once (the white mark would vanish there)');
    loaded.add(NCAA); V.failedDarkLogoUrls.add(DARK);
    const knownMissing = mk(NCAA, darkCard());
    assert(prime(knownMissing) === true && knownMissing._src === NCAA && knownMissing.dataset.logoVariant === 'default',
      '9b-4: a dark file known to be missing this session is never asked for: the logo shows the stored default at once, exactly as the load-time path would end up');
    V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();
    const done = mk(NCAA, lightCard()); done.classList.add('is-loaded');
    const evaluated = mk(NCAA, lightCard()); evaluated.dataset.logoVariant = 'default';
    const planted = mk('http://evil.example.com/x.png', lightCard()); loaded.add('http://evil.example.com/x.png');
    assert(prime(done) === false && done.writes === 0 && prime(evaluated) === false && !evaluated.classList.has('is-loaded') && prime(planted) === false && !planted.classList.has('is-loaded'),
      '9b-5: the primer leaves alone a logo that is already shown, one the load path has already evaluated, and a non-https URL (logoOk() gate)');
    // the REAL load/error arms ([3]'s capture listeners): what gets remembered is the file that LOADED, never the one a swap is about to request
    loaded.clear(); V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();
    const swapping = fakeImg('dc-chip-logo', NCAA, darkCard());
    handlers.load.fn({ target: swapping });
    assert(swapping._src === DARK && loaded.has(NCAA) && !loaded.has(DARK),
      '9b-6: the default loads on a dark surface and is swapped: the default is remembered, the 500-dark file is NOT (it has not loaded yet — it might not exist)');
    handlers.load.fn({ target: swapping });
    assert(loaded.has(DARK), '9b-7: …the dark file is remembered only on its OWN load');
    const missing = fakeImg('dc-chip-logo', NCAA, darkCard());
    handlers.load.fn({ target: missing });            // default loads, swap to dark
    loaded.add(DARK);                                 // (as if an earlier page load had it)
    handlers.error.fn({ target: missing });           // the dark file errors
    assert(!loaded.has(DARK) && missing._src === NCAA, '9b-8: a file that errors is forgotten at once (and the dark-file revert still runs)');
    loaded.clear(); V.failedDarkLogoUrls.clear(); V.failedLogoUrls.clear();
  } else {
    assert(false, '9b-0: the primer and the loaded-logo set exist on the _logoVariantForTest seam');
  }
}

// ── [9c] FB-024 — the CSS half: an instant logo has no fade; the fade path is unchanged ──
console.log('\n[9c] FB-024 — the CSS: `.logo-instant` drops the fade for all four logo classes; the hidden-until-loaded rule is unchanged');
{
  const css9 = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const cls of ['pick-btn-logo', 'dc-chip-logo', 'matrix-hdr-logo', 'slate-row-logo']) {
    const hit = [...css9.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((m) => m[1].split(',').some((s) => s.trim() === `.${cls}.logo-instant`) && /(^|;)\s*transition\s*:\s*none\s*(;|$)/.test(m[2]));
    assert(hit, `9c-1 ${cls}: .${cls}.logo-instant{transition:none} — a logo shown at once on a repaint does not fade (and is still opacity:1 via .is-loaded)`);
  }
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 8000).unref();
