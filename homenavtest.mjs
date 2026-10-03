/**
 * CFB Pickems — homenavtest.mjs (Social Platform, Home wiring window, v0.29.0, 2026-10-01)
 * =======================================================================================
 * The five-tab nav with the centre Home disc, Home as the default landing, and the wiring that hands js/home.js its REAL gates.
 * DESIGN_NEEDS_HOME_092626 Amendment 3 + 3.1 (Drew: raised disc, vertically centred, equal overhang, 56 pt, "I don't want pages to leave more room
 * at the bottom"), DESIGN_INPUTS_HOME_092726 DI-370 / DI-372 (+ inline amendment A1), HOME_WIRING_CHECKLIST_100126 items 1-20, security W1-W9.
 *
 *   [1]  The static markup and the ship-together rule (T3): five tabs in order, Home third and selected, Comm gone from the bar, #page-home the active page, the Home
 *        SVG equal to ICONS.home, the cold-boot skeleton equal to what home.js paints, the menu trigger's ARIA. `state.currentTab` is 'home' IF AND ONLY IF the Home
 *        button exists (a mutant for each half).
 *   [2]  The CSS contract (T1), with a mutant for each clause: the tokens, the floor, both hide distances carrying the disc reach (the sliver bug a third time), the
 *        clearance carrying NO disc term (Drew's ruling), the disc never translated or offset, no overflow:hidden on the pill.
 *        (Real LAYOUT is measured in navtest.mjs [7m]; contrast in themetest.mjs [T4]; the engine proofs are not repeated here.)
 *   [3]  Discipline (T6): the disc rules read only named tokens, no hex.
 *   [4]  The wiring, by SOURCE (W2/W3/W5, checklist 1-18): every gate is handed to createHome BY REFERENCE (a stub or a wrapper for each turns the pin red), the factory
 *        is built lazily (never at module scope), the dispatcher / repaint sites / banner map / teardown list / refresh leg / identity reset are where the checklist says.
 *   [5]  The wiring, RUN: the real app.js against a real element tree built from the real index.html (minidom.mjs): navigateTo('home') paints Home, the nav follows, the
 *        tab-change selection haptic (T4), the container is re-created after a teardown, the paused-league banner survives a Home repaint, go-tab and build-slate
 *        (the role is re-checked at tap time), the refresh leg of pull-to-refresh, the native restore round trip, the menu trigger.
 *
 * NOT COVERED HERE (a device, never a test): the real tab bar's feel at 3x, the roof-fill / inner-ring crossfade, the 97% press on the larger target, the selection
 * haptic on all five tabs, VoiceOver's reading, Face ID landscape, the keyboard-up behaviour on a phone, the cold read ("what do you expect the centre button to do?").
 *
 * Run:  node homenavtest.mjs      Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 */
import { readFileSync } from 'node:fs';
import { MiniDocument, MiniElement } from './minidom.mjs';
// minidom.mjs has no insertAdjacentHTML; the paused-league banner (renderPausedLeagueBannerIfNeeded) prepends with it, so this suite supplies the one method it needs (the file is not edited).
if (typeof MiniElement.prototype.insertAdjacentHTML !== 'function') {
  MiniElement.prototype.insertAdjacentHTML = function (pos, html) {
    const t = this.ownerDocument.createElement('div'); t.innerHTML = html;
    const kids = [...t._children]; t._children = [];
    if (pos === 'afterbegin') { for (const k of kids.reverse()) { k.parentNode = this; this._children.unshift(k); } }
    else { for (const k of kids) { k.parentNode = this; this._children.push(k); } }
  };
}

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); }
};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
_log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);

// ── the browser, as far as the modules under test can tell ───────────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in homenavtest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const INDEX = read('./index.html');
const CSS = read('./css/styles.css');
const APP = read('./js/app.js');
const CHAT = read('./js/chat.js');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = (html = INDEX) => {
  const doc = new MiniDocument();
  const m = html.match(/<body[^>]*data-tab="([^"]*)"/);
  if (m) doc.body.dataset.tab = m[1];
  doc.body.innerHTML = bodyHtmlOf(html);
  return doc;
};
globalThis.document = freshDoc();

const { ICONS, icon } = await import('./js/icons.js');
const HomeMod = await import('./js/home.js');
const app = await import('./js/app.js');
const auth = await import('./js/auth.js');
const storage = await import('./js/storage.js');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] The static markup and the ship-together rule (T3)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const doc = freshDoc();
  const items = [...doc.querySelectorAll('.nav-item')];
  assert(JSON.stringify(items.map((e) => e.dataset.tab)) === '["picks","dashboard","home","chat","leaderboard"]',
    `1-1: index.html has exactly FIVE .nav-item in the order Picks, Dashboard, Home, Chat, Standings — Home is the centre slot (got ${JSON.stringify(items.map((e) => e.dataset.tab))})`);
  assert(doc.querySelectorAll('[data-tab="commissioner"]').length === 0 && doc.querySelectorAll('.nav-item[data-tab="admin"]').length === 0,
    '1-2: NO commissioner (or admin) button in the bar: Comm left the bar and lives in the control center (UN-320b)');
  const home = items[2], dash = items[1];
  assert(home.classList.contains('active') && home.getAttribute('aria-current') === 'page' && home.getAttribute('aria-label') === 'Home',
    '1-3: Home is `.active`, `aria-current="page"` and `aria-label="Home"`');
  assert(!dash.classList.contains('active') && dash.getAttribute('aria-current') === null && items.filter((e) => e.classList.contains('active')).length === 1,
    '1-4: Dashboard is NOT active and carries no aria-current; exactly ONE tab is active');
  const pageHome = doc.getElementById('page-home'), pageDash = doc.getElementById('page-dashboard');
  assert(!!pageHome && pageHome.classList.contains('active') && !pageDash.classList.contains('active') && doc.querySelectorAll('.page-section.active').length === 1,
    '1-5: #page-home is the ONE active page section and #page-dashboard is not (the cold-boot page is the one the app lands on)');
  assert(doc.body.dataset.tab === 'home', '1-6: <body data-tab="home"> (the attribute mirrors the active tab before any JS runs)');
  assert(!!doc.querySelector('#page-home > #home-root') && doc.querySelectorAll('#page-home .loading-state').length === 0 && doc.querySelectorAll('#page-home .spinner').length === 0,
    '1-7: #page-home holds an INNER #home-root (home.js rewrites its container; the section also hosts the paused-league banner) and NO .loading-state spinner (checklist 11, 15)');
  // the Home SVG is the literal of ICONS.home
  const homeBtnSrc = INDEX.match(/<button class="nav-item active" data-tab="home"[\s\S]*?<\/button>/)[0];
  const svgInIndex = homeBtnSrc.match(/<svg[\s\S]*?<\/svg>/)[0];
  assert(svgInIndex.replace(' aria-hidden="true" focusable="false"', '') === ICONS.home && icon('home').replace(' aria-hidden="true" focusable="false"', '') === ICONS.home && /<span class="nav-icon nav-home-disc" aria-hidden="true">/.test(homeBtnSrc) && /<span class="sr-only">Home<\/span>/.test(homeBtnSrc),
    '1-8: the Home button\'s SVG is EXACTLY ICONS.home (plus the aria-hidden/focusable attributes icon() adds) (one asset, the roof class on the pediment), inside a .nav-home-disc that is aria-hidden, with an sr-only "Home"');
  assert((svgInIndex.match(/class="home-roof"/g) || []).length === 1 && !/<svg[^>]*class=/.test(svgInIndex.replace(/<path class="home-roof"/, '<path')),
    '1-9: the roof carries class="home-roof" once (CSS fills it when Home is selected) and nothing else is classed');
  assert(INDEX.split('<button class="nav-item').length - 1 === 5 && !/Default tab is DASHBOARD/.test(INDEX) && !/Picks · Dashboard · Chat · Standings · Comm/.test(INDEX) && /Picks · Dashboard · Home · Chat · Standings/.test(INDEX),
    '1-10: the stale comments are fixed ("Default tab is DASHBOARD" and the five-with-Comm list are gone; the new five is written down)');
  // the menu trigger (UN-320c): the drawer is the dialog this button controls
  const trig = doc.getElementById('control-center-trigger');
  assert(trig.getAttribute('aria-label') === 'Menu' && trig.getAttribute('aria-haspopup') === 'dialog' && trig.getAttribute('aria-expanded') === 'false' && trig.getAttribute('aria-controls') === 'control-center',
    '1-11: the header trigger is "Menu", aria-haspopup="dialog", aria-expanded="false" at boot, aria-controls="control-center" (the drawer element\'s own id)');
}
{
  // THE SHIP-TOGETHER RULE: state.currentTab initializes to 'home' if and only if the Home button AND the active #page-home exist (checklist item 1).
  const shipTogether = (indexHtml, appSrc) => {
    const init = (appSrc.match(/export const state = \{[\s\S]*?currentTab:\s*'([a-z]+)'/) || [])[1];
    const hasHomeBtn = /<button class="nav-item[^"]*" data-tab="home"/.test(indexHtml);
    const homePageActive = /<section class="page-section active" id="page-home">/.test(indexHtml);
    const bodyHome = /<body[^>]*data-tab="home"/.test(indexHtml);
    return (init === 'home') === (hasHomeBtn && homePageActive && bodyHome) && (init === 'home') === true;
  };
  assert(shipTogether(INDEX, APP) === true, '1-12: ship-together — the shipped tree lands on Home (initializer "home") AND has the Home button, the active #page-home and body data-tab="home"');
  assert(shipTogether(INDEX, APP.replace("currentTab: 'home',", "currentTab: 'picks',")) === false, '1-13: MUTATION — the initializer alone reverts to "picks" (the Home button still exists): the rule goes RED');
  assert(shipTogether(INDEX.replace(/<button class="nav-item active" data-tab="home"[\s\S]*?<\/button>\n/, ''), APP) === false, '1-14: MUTATION — the Home button alone is removed (the initializer still says "home"): RED — it would land on a tab with no button');
  assert(shipTogether(INDEX.replace('<section class="page-section active" id="page-home">', '<section class="page-section" id="page-home">'), APP) === false, '1-15: MUTATION — #page-home loses `.active` (a flash of nothing before the first navigateTo): RED');
  assert(shipTogether(INDEX.replace('data-tab="home">\n', 'data-tab="dashboard">\n'), APP) === false || !/<body[^>]*data-tab="home"/.test(INDEX.replace('data-tab="home">\n', 'data-tab="dashboard">\n')), '1-16: MUTATION — <body data-tab> goes stale: RED');
}
{
  // THE COLD-BOOT SKELETON equals what home.js paints while its data is not ready, so the first real paint replaces like with like (no shift).
  const mount = (html) => { const d = new MiniDocument(); d.body.innerHTML = `<div id="c">${html}</div>`; return d.getElementById('c'); };
  const staticRoot = freshDoc().getElementById('home-root');
  const painted = new MiniDocument().createElement('div');
  const home = HomeMod.createHome({
    escHtml: (s) => String(s), isContentWithheld: () => false, confirmedStatusFor: (w) => w.status, picksReadConfirmed: () => true, renderCompact: () => '',
    chatCandidates: () => ({ scribe: [], lockerRoom: [] }), getContainer: () => painted, currentIdentityKey: () => 'a|b|c', getCurrentTab: () => 'home', isDataReady: () => false,
  });
  home.renderHome();
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  assert(norm(staticRoot.innerHTML) === norm(painted.innerHTML) && /feed-skel/.test(painted.innerHTML),
    '1-17: the static #home-root content is BYTE-FOR-BYTE the feed skeleton home.js paints while its data is not ready (four .feed-skel cards in .home-feed, aria-busy, an sr-only loading status): never the spinner, nothing shifts on the first paint');
  assert(mount(staticRoot.innerHTML).querySelectorAll('.feed-skel').length === HomeMod.SKELETON_CARD_COUNT && HomeMod.SKELETON_CARD_COUNT === 4, '1-18: …and it is exactly SKELETON_CARD_COUNT (4) cards');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] The CSS contract (T1), each clause with a mutant…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const css = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (c, sel) => { const i = c.indexOf(sel + '{'); if (i < 0) return ''; return c.slice(i + sel.length + 1, c.indexOf('}', i)); };
  const contract = (raw) => {
    const c = css(raw);
    const root = (c.match(/:root\s*\{([^}]*)\}/) || [])[1] || '';
    const hide = rule(c, '.bottom-nav.nav-hidden'), kb = rule(c, 'body[data-keyboard-up] .bottom-nav');
    const disc = rule(c, '.nav-icon.nav-home-disc'), pill = rule(c, '.bottom-nav');
    const full = /translateY\(calc\(100%\s*\+\s*var\(--nav-pill-bottom\)\s*\+\s*var\(--nav-disc-reach\)\)\)/;
    return {
      sizeToken: /--nav-disc-d:\s*56px/.test(root),
      derived: /--nav-disc-overhang:\s*calc\(\(var\(--nav-disc-d\)\s*-\s*var\(--nav-pill-h\)\)\s*\/\s*2\)/.test(root) && /--nav-disc-reach:\s*calc\(var\(--nav-disc-overhang\)\s*\+\s*var\(--nav-disc-ring\)\)/.test(root),
      floor: /--nav-pill-bottom:\s*max\(calc\(var\(--nav-pill-gap\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\),\s*calc\(var\(--nav-disc-reach\)\s*\+\s*8px\)\)/.test(root),
      clearanceNoDisc: /--nav-bar-clearance:\s*calc\(var\(--nav-pill-h\)\s*\+\s*var\(--nav-pill-bottom\)\)/.test(root) && !/--nav-bar-clearance:[^;]*--nav-disc/.test(root),
      pillBottom: /bottom:\s*var\(--nav-pill-bottom\)/.test(pill),
      hide: full.test(hide) && full.test(kb),
      noOverflowHidden: !/overflow\s*:\s*hidden/.test(pill),
      discUntranslated: disc !== '' && !/(^|;)\s*(transform|margin[a-z-]*|top|bottom|inset)\s*:/.test(disc),
      flexCentred: /\.nav-item\{[^}]*display:flex;flex-direction:column;align-items:center;justify-content:center/.test(c) && /flex:none/.test(disc),
      homeButtonVisible: /\.nav-item\[data-tab="home"\]\{overflow:visible\}/.test(c) && /\.nav-item\[data-tab="home"\]\.active::after\{display:none\}/.test(c),
      collar: /box-shadow:0 0 0 var\(--nav-disc-cut\)[\s\S]*?,0 0 0 var\(--nav-disc-ring\)/.test(disc),
      bannerNudge: /#auth-banner-stack\{[^}]*bottom:\s*calc\(var\(--nav-bar-clearance\)\s*\+\s*var\(--nav-disc-reach\)\s*\+\s*8px\)/.test(c) && /\.update-available-banner\{[^}]*bottom:\s*calc\(var\(--nav-bar-clearance\)\s*\+\s*var\(--nav-disc-reach\)\s*\+\s*8px\)/.test(c),
      chatLift: /#page-chat\.active\{--chat-nav-gap:calc\(8px \+ var\(--nav-disc-reach\)\);[^}]*padding-bottom:var\(--chat-nav-gap\)/.test(c),
      chatKeyboardGap: /body\[data-keyboard-up\] #page-chat\.active\{--nav-bar-clearance:0px;--chat-nav-gap:8px\}/.test(c),
      submitNudge: /\.submit-bar\{[^}]*bottom:\s*calc\(var\(--nav-bar-clearance\)\s*\+\s*8px\s*\+\s*var\(--nav-disc-reach\)\)/.test(c),
      reduced: /@media \(prefers-reduced-motion:reduce\)\{\.nav-home-disc \.home-roof,\.nav-home-disc::after\{transition:none\}\}/.test(c),
    };
  };
  const real = contract(CSS);
  assert(Object.values(real).every(Boolean), `2-1: the shipped stylesheet satisfies every clause of the disc contract (${Object.entries(real).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all ' + Object.keys(real).length})`);
  const MUT = [
    ['a hide distance WITHOUT the disc reach (the collar sliver)', 'hide', (s) => s.replace('.bottom-nav.nav-hidden{transform:translateY(calc(100% + var(--nav-pill-bottom) + var(--nav-disc-reach)))', '.bottom-nav.nav-hidden{transform:translateY(calc(100% + var(--nav-pill-bottom))')],
    ['the keyboard-up hide stops at the pill', 'hide', (s) => s.replace('body[data-keyboard-up] .bottom-nav{transform:translateY(calc(100% + var(--nav-pill-bottom) + var(--nav-disc-reach)))}', 'body[data-keyboard-up] .bottom-nav{transform:translateY(calc(100% + var(--nav-pill-bottom)))}')],
    ['the shipped hide distance (gap + safe-area only)', 'hide', (s) => s.replace('translateY(calc(100% + var(--nav-pill-bottom) + var(--nav-disc-reach)));transition:transform 240ms ease-in}', 'translateY(calc(100% + var(--nav-pill-gap) + env(safe-area-inset-bottom,0px)));transition:transform 240ms ease-in}')],
    ['the floor is dropped from --nav-pill-bottom (the collar touches the screen edge with no inset)', 'floor', (s) => s.replace(/--nav-pill-bottom:max\(calc\(var\(--nav-pill-gap\) \+ env\(safe-area-inset-bottom,0px\)\),calc\(var\(--nav-disc-reach\) \+ 8px\)\);/, '--nav-pill-bottom:calc(var(--nav-pill-gap) + env(safe-area-inset-bottom,0px));')],
    ['the clearance grows by the disc reach (pages leave MORE room at the bottom: Drew said no)', 'clearanceNoDisc', (s) => s.replace('--nav-bar-clearance:calc(var(--nav-pill-h) + var(--nav-pill-bottom));', '--nav-bar-clearance:calc(var(--nav-pill-h) + var(--nav-pill-bottom) + var(--nav-disc-reach));')],
    ['the disc is a different size (64 pt, the first recommendation)', 'sizeToken', (s) => s.replace('--nav-disc-d:56px', '--nav-disc-d:64px')],
    ['the disc is offset upward (B\'s translateY: Drew asked for CENTRED, not raised)', 'discUntranslated', (s) => s.replace('.nav-icon.nav-home-disc{position:relative;', '.nav-icon.nav-home-disc{transform:translateY(-9px);position:relative;')],
    ['overflow:hidden on the pill (it would clip the disc)', 'noOverflowHidden', (s) => s.replace('.bottom-nav{position:fixed;', '.bottom-nav{overflow:hidden;position:fixed;')],
    ['the pill reads the shipped offset again', 'pillBottom', (s) => s.replace('  bottom:var(--nav-pill-bottom);\n  height:var(--nav-pill-h)', '  bottom:calc(var(--nav-pill-gap) + env(safe-area-inset-bottom,0px));\n  height:var(--nav-pill-h)')],
    ['the sign-in/auth banner stack sits at the bare clearance again (it would paint over the disc)', 'bannerNudge', (s) => s.replace('bottom:calc(var(--nav-bar-clearance) + var(--nav-disc-reach) + 8px);\n  z-index:10000', 'bottom:var(--nav-bar-clearance);\n  z-index:10000')],
    ['the update banner sits at the bare clearance again', 'bannerNudge', (s) => s.replace('bottom:calc(var(--nav-bar-clearance) + var(--nav-disc-reach) + 8px);   /* review N2', 'bottom:var(--nav-bar-clearance);   /* review N2')],
    ['the chat lift is the bare 8px again (the composer touches the collar: Drew M-11 Q2 "lift")', 'chatLift', (s) => s.replace('#page-chat.active{--chat-nav-gap:calc(8px + var(--nav-disc-reach));', '#page-chat.active{--chat-nav-gap:8px;')],
    ['the keyboard-up override is gone (a 16px gap above the keyboard)', 'chatKeyboardGap', (s) => s.replace('body[data-keyboard-up] #page-chat.active{--nav-bar-clearance:0px;--chat-nav-gap:8px}', 'body[data-keyboard-up] #page-chat.active{--nav-bar-clearance:0px}')],
    ['the Home button clips its own disc', 'homeButtonVisible', (s) => s.replace('.nav-item[data-tab="home"]{overflow:visible}', '.nav-item[data-tab="home"]{overflow:hidden}')],
    ['the submit bar loses the disc nudge', 'submitNudge', (s) => s.replace('bottom:calc(var(--nav-bar-clearance) + 8px + var(--nav-disc-reach));background:var(--bg-card)', 'bottom:calc(var(--nav-bar-clearance) + 8px);background:var(--bg-card)')],
  ];
  for (const [label, key, fn] of MUT) {
    const mutated = fn(CSS);
    const v = contract(mutated);
    assert(mutated !== CSS && v[key] === false, `2-2: MUTATION — ${label}: the "${key}" clause goes RED`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3] Discipline (T6): the disc rules read named tokens only…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const c = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = c.slice(c.indexOf('.nav-item[data-tab="home"]{overflow:visible}'), c.indexOf('.nav-item.active .nav-home-disc::after{opacity:1}') + '.nav-item.active .nav-home-disc::after{opacity:1}'.length)
    + (c.match(/@media \(prefers-reduced-motion:reduce\)\{\.nav-home-disc[^}]*\}\}/) || [''])[0];
  assert(block.length > 400 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(block), '3-1: the Home disc rules carry NO hex, rgb() or hsl() (colours come from custom properties)');
  const vars = [...new Set([...block.matchAll(/var\((--[a-z-]+)/g)].map((m) => m[1]))].sort();
  const ALLOWED = ['--bg-card', '--border', '--chrome-tab-bg', '--chrome-tab-border', '--chrome-tab-icon-selected', '--maroon-text', '--motion-fast', '--nav-disc-cut', '--nav-disc-d', '--nav-disc-ring'];
  assert(vars.every((v) => ALLOWED.includes(v)) && vars.includes('--chrome-tab-icon-selected') && vars.includes('--chrome-tab-bg'), `3-2: they read only ${ALLOWED.length} named tokens, including the chrome-tab pair themetest [T4] holds at 4.5:1 in every look (found ${vars.join(', ')})`);
  assert(/\.nav-icon\.nav-home-disc\{[^}]*background:var\(--chrome-tab-icon-selected,var\(--maroon-text\)\);color:var\(--chrome-tab-bg,var\(--bg-card\)\)/.test(block),
    '3-3: the disc is --chrome-tab-icon-selected with the mark reversed out in --chrome-tab-bg (one opaque pair), each with its shipped fallback');
  const swapped = block.replace('background:var(--chrome-tab-icon-selected,var(--maroon-text));color:var(--chrome-tab-bg,var(--bg-card))', 'background:var(--chrome-tab-bg,var(--bg-card));color:var(--chrome-tab-icon-selected,var(--maroon-text))');
  assert(swapped !== block && !/background:var\(--chrome-tab-icon-selected,var\(--maroon-text\)\);color:var\(--chrome-tab-bg/.test(swapped), '3-4: MUTATION — the two tokens swapped (a light disc with a dark mark: the opposite of the contrast the themes proved) turns 3-3 RED');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[4] The wiring, by source (W2 / W3 / W5, checklist 1-18)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const code = stripComments(APP);
  const fnAt = (name) => { const i = code.indexOf(`function ${name}(`); return i < 0 ? '' : code.slice(i, code.indexOf('\n}\n', i) + 2); };
  const wiring = fnAt('getHomeWiring');
  assert(wiring.length > 500, '4-0: found getHomeWiring()');
  const pins = (w) => ({
    escHtml: /createHome\(\{[\s\S]*?\n\s*escHtml,/.test(w),
    isContentWithheld: /\n\s*isContentWithheld,/.test(w),
    currentIdentityKey: /\n\s*currentIdentityKey,/.test(w),
    renderCompact: /\n\s*renderCompact: renderDashboardCompact,/.test(w),
    chatSource: /makeChatCandidateSource\(\{ getMessages, isPrivateRow, chatBoundToLeague \}\)/.test(w),
    confirmed: /confirmedStatusFor: \(w\) => \{\s*if \(getBackendMode\(\) !== 'supabase'\) return w\.status;\s*try \{ return sb\.getConfirmedWeekStatus\(w\.weekId\) \|\| w\.status; \}\s*catch \{ return w\.status; \}\s*\},/.test(w),
    picksRead: /picksReadConfirmed: \(id\) => sb\.picksReadWhilePublic\(id\) === true,/.test(w),
    container: /getContainer: ensureHomeRoot,/.test(w),
    tab: /getCurrentTab: \(\) => state\.currentTab,/.test(w),
    action: /onAction: onHomeAction,/.test(w),
    news: /fetchNews: homeNews\.fetchNews,/.test(w) && /renderNewsCard: homeNews\.renderNewsCard,/.test(w) && /newsEmptyCopy: homeNews\.emptyCopy,/.test(w),
    noDefaultsOverridden: !/\n\s*(haptic|isDataReady|now)\s*[:,]/.test(w.slice(w.indexOf('createHome({'))),
    noStubChat: !/chatBoundToLeague\s*[:=]\s*\(/.test(w) && !/=>\s*true/.test(w.slice(w.indexOf('createHome({'), w.indexOf('createHome({') + 1200).replace(/=== true,/g, '')),
  });
  const real = pins(wiring);
  assert(Object.values(real).every(Boolean), `4-1: every gate is handed to createHome BY REFERENCE — the app's own escHtml, isContentWithheld, currentIdentityKey, renderDashboardCompact, chat.js's getMessages / isPrivateRow / chatBoundToLeague, the container hook, the tab reader, the news adapter (${Object.entries(real).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all ' + Object.keys(real).length + ' pins'})`);
  const mut = (label, key, from, to) => { const m = wiring.replace(from, to); assert(m !== wiring && pins(m)[key] === false, `4-2: MUTATION — ${label}: pin "${key}" goes RED`); };
  mut('isContentWithheld replaced by a constant (a Home that can never withhold: the S-C7 hole)', 'isContentWithheld', '\n    isContentWithheld,', '\n    isContentWithheld: () => false,');
  mut('currentIdentityKey replaced by a constant (W3)', 'currentIdentityKey', '\n    currentIdentityKey,', '\n    currentIdentityKey: () => \'x\',');
  mut('currentIdentityKey wrapped (W3: never a wrapper)', 'currentIdentityKey', '\n    currentIdentityKey,', '\n    currentIdentityKey: () => currentIdentityKey(),');
  mut('escHtml replaced by String (W5: never String)', 'escHtml', '\n    escHtml,', '\n    escHtml: String,');
  mut('renderCompact replaced by a stub', 'renderCompact', 'renderCompact: renderDashboardCompact,', 'renderCompact: () => \'\',');
  mut('chatBoundToLeague replaced by a stub (W2: never () => true)', 'chatSource', 'makeChatCandidateSource({ getMessages, isPrivateRow, chatBoundToLeague })', 'makeChatCandidateSource({ getMessages, isPrivateRow, chatBoundToLeague: () => true })');
  mut('confirmedStatusFor trusts the client status', 'confirmed', "if (getBackendMode() !== 'supabase') return w.status;", 'return w.status;');
  mut('picksReadConfirmed answers true', 'picksRead', 'picksReadConfirmed: (id) => sb.picksReadWhilePublic(id) === true,', 'picksReadConfirmed: () => true,');
  mut('the news empty copy is left unwired', 'news', 'newsEmptyCopy: homeNews.emptyCopy,', '');
  // built lazily, once, never at module scope; the real chat primitive is the exported store predicate
  assert((code.match(/\bcreateHome\(/g) || []).length === 1 && (code.match(/\bmakeChatCandidateSource\(/g) || []).length === 1 && (code.match(/\bcreateHomeNews\(/g) || []).length === 1,
    '4-3: createHome, makeChatCandidateSource and createHomeNews are each called ONCE, and only inside getHomeWiring() (never at module scope, where a missing primitive would throw at import)');
  assert(/import \{[^}]*\bgetMessages\b[^}]*\bisPrivateRow\b[^}]*\bchatBoundToLeague\b[^}]*\} from '\.\/chat\.js'/.test(APP) && !/chatTransport\.js[^\n]*chatBoundToLeague/.test(APP),
    '4-4: chatBoundToLeague is imported from chat.js (DI-372 amendment A1: store-backed, AD-16\'s chatTransport.js untouched)');
  assert(/export function chatBoundToLeague\(/.test(CHAT) && !/chatBoundToLeague/.test(read('./js/chatTransport.js')), '4-5: chat.js exports chatBoundToLeague; chatTransport.js does not mention it');
  // the first paint after a hydrate is a navigateTo to state.currentTab (review optional pin: the reviewer's mutant M1 — repaint to 'dashboard' — survived homenavtest and boottest)
  {
    const rep = fnAt('_repaintForSupabaseData');
    const pinRep = (b) => /try \{ navigateTo\(state\.currentTab \|\| 'dashboard'\); \}/.test(b);
    assert(rep.length > 200 && pinRep(rep), '4-5b: _repaintForSupabaseData() navigates to state.currentTab (the production default-landing mechanism: Home lands only because the initializer is "home")');
    assert(!pinRep(rep.replace("navigateTo(state.currentTab || 'dashboard')", "navigateTo('dashboard')")), '4-5c: MUTATION — a repaint that navigates to a fixed "dashboard" turns 4-5b RED');
  }
  // checklist items 1-4, 11
  assert(/export const state = \{[\s\S]*?currentTab: 'home',/.test(APP), '4-6: item 1 — state.currentTab initializes to "home"');
  assert(/_nativeShellTabRestored\) \? state\.currentTab : 'home';/.test(APP), '4-7: item 2 — bootDefaultTab() falls back to "home"');
  assert(/NATIVE_SHELL_VALID_TABS = \['home', /.test(APP), '4-8: item 3 — "home" is a valid native-restore tab');
  assert(/\(\{ home: renderHomePage, picks: renderPicksPage,/.test(code) && /function renderHomePage\(\) \{\s*getHomeWiring\(\)\.homeView\.renderHome\(\);\s*renderPausedLeagueBannerIfNeeded\('home'\);\s*\}/.test(code),
    '4-9: item 4 — the dispatcher has home: renderHomePage, which paints Home and then the paused-league banner');
  assert(/PAUSED_BANNER_PAGE_IDS = \{\s*home: 'page-home',/.test(code) && /'page-home', 'page-picks'/.test(code),
    '4-10: item 11 — "home" is in the paused-banner page map (the maintenance map copies it) and page-home is in the A6 teardown list');
  // item 5: NO nav-highlight change; item 17: ONE pull-to-refresh binder
  assert(/const navActiveTab = tab === 'admin' \? 'commissioner' : tab;/.test(code), '4-11: item 5 — the nav highlight pass is unchanged (Amendment 2 voids DI-370 item 5)');
  assert((code.match(/\bbindPullToRefresh\(/g) || []).length === 1, '4-12: item 17 — bindPullToRefresh is called ONCE in app.js (Home does not bind a second one; the window binder runs runManualSync)');
  const sync = fnAt('makeRunManualSync');
  assert(/if \(state\.currentTab === 'dashboard'\) renderDashboard\(\);\s*else if \(state\.currentTab === 'home'\) await getHomeWiring\(\)\.homeView\.refresh\(\);/.test(sync) && sync.indexOf('throw new Error') < sync.indexOf("state.currentTab === 'home'") && sync.indexOf('doRefreshScores') < sync.indexOf("state.currentTab === 'home'"),
    '4-13: item 17 — runManualSync() refreshes Home AFTER the hydrate/ACTIVE check (which throws into the binder\'s onFail -> showSyncFailureBanner) and after the scores refresh');
  // item 18: four repaint sites + the sync leg
  assert((code.match(/state\.currentTab ?=== ?'home'\) renderHomePage\(\)/g) || []).length === 4, '4-14: item 18 — the four repaint sites (live score x2, auto-open, auto-transition) each repaint Home when it is showing');
  // item 6/16: identity chokepoint
  const delta = fnAt('applyIdentityDeltaIfChanged');
  assert(/if \(_homeWiring\) \{ _homeWiring\.homeNews\.reset\(\); _homeWiring\.homeView\.resetNews\(\); \}/.test(delta), '4-15: item 16 — applyIdentityDeltaIfChanged() resets the news adapter AND the Home slot (security C1\'s wiring half), without constructing the wiring');
  assert(/subscribeNewsPrefsChanged\(\(\) => \{\s*homeView\.resetNews\(\);\s*if \(state\.currentTab === 'home'\) homeView\.renderHome\(\);\s*\}\);/.test(wiring), '4-16: item 16 — the prefs-changed subscription resets the slot and repaints only when Home is showing');
  const root = fnAt('ensureHomeRoot');
  assert(/if \(\(getAuthMode\(\) === 'supabase' && needsLeagueFlowScreen\(\)\) \|\| linkFlowScreen\(\)\) return null;/.test(root) && root.indexOf('linkFlowScreen()') < root.indexOf("innerHTML = '<div id=\"home-root\">"),
    '4-16b: a league-flow or link-flow screen OWNS #page-home while it is up: ensureHomeRoot() returns null BEFORE it could re-create the root, so a Home repaint never paints over the link-confirmation card (DI-183h)');
  assert(!/linkFlowScreen\(\)\) return null;/.test(root.replace(/if \(\(getAuthMode[^\n]*\n/, '')), '4-16c: MUTATION — with that guard removed the pin 4-16b goes RED');
  assert(/homeNews\.bindEvents\(root\)/.test(fnAt('ensureHomeRoot')) && !/onOpen/.test(wiring) && !/onOpen/.test(fnAt('ensureHomeRoot')), '4-17: item 16 — the news tap is bound on the Home root ELEMENT (once per element) with the DEFAULT opener: no custom onOpen (security C2)');
  // W6: go-tab only through navigateTo; build-slate re-checks the role
  const act = fnAt('onHomeAction');
  assert(/navigateTo\(tab\);/.test(act) && /if \(getSession\(\)\?\.isAdmin\) openWeekWizardSheet\(\);/.test(act) && !/state\.currentTab\s*=[^=]/.test(act), '4-18: W6 — go-tab goes only through navigateTo (never a direct state write) and build-slate re-checks getSession()?.isAdmin at tap time');
  const act2 = act.replace('if (getSession()?.isAdmin) openWeekWizardSheet();', 'openWeekWizardSheet();');
  assert(!/if \(getSession\(\)\?\.isAdmin\) openWeekWizardSheet\(\);/.test(act2), '4-19: MUTATION — dropping the tap-time role check turns 4-18 RED');
  // the tab-change haptic
  const nav = fnAt('setupNav');
  assert(/if \(tab !== state\.currentTab && !isContentWithheld\(\)\) haptic\('selection'\);\s*navigateTo\(tab\);/.test(nav), '4-20: T4 — setupNav fires haptic("selection") only on a CHANGE of tab and never while content is withheld, BEFORE navigateTo (so the buzz is not delayed by the render)');
  // identity of the menu trigger
  assert(/icon\('menu'\)/.test(fnAt('renderControlCenterTrigger')) && !/icon\('munera'\)/.test(fnAt('renderControlCenterTrigger')), '4-21: T5 — renderControlCenterTrigger writes icon("menu"), not the Munera mark');
  assert(/setAttribute\('aria-expanded', String\(!!open\)\)/.test(APP), '4-22: T5 — onDrawerVisibilityChange sets aria-expanded from `open`');
  // W7: Home's chat read honours types:['message'] and respectRetention (the epoch and retention rules live in chat.js's getMessages)
  {
    const homeCode = stripComments(read('./js/home.js'));
    const pin = /getMessages\(\{ types: \['message'\], respectRetention: true \}\)/;
    assert((homeCode.match(/getMessages\(\{ types: \['message'\], respectRetention: true \}\)/g) || []).length === 1, '4-22b: W7 — home.js reads chat through getMessages({ types: [\'message\'], respectRetention: true }) exactly once');
    const calls = [];
    const src = HomeMod.makeChatCandidateSource({ getMessages: (f) => { calls.push(f); return []; }, isPrivateRow: () => false, chatBoundToLeague: () => true });
    src({ leagueId: 'L1', supabase: true });
    assert(JSON.stringify(calls) === '[{"types":["message"],"respectRetention":true}]', `4-22c: W7 — the injected getMessages is called with exactly { types: ["message"], respectRetention: true } (got ${JSON.stringify(calls)})`);
    assert(!pin.test(homeCode.replace("types: ['message'], ", '')) && !pin.test(homeCode.replace(', respectRetention: true', '')), '4-22d: MUTATION — dropping `types` or `respectRetention` from that read turns 4-22b RED (a read of every event type, or past the retention epoch, would feed Home)');
  }
  // DEEP LINK unchanged (DI-370 test 5)
  const notif = await import('./js/notifications.js');
  const table = notif._deepLinkTableForTest();
  const rf = Object.entries(table).find(([k]) => /RESULTS_FINALIZED/.test(k) && !/YOU_WON/.test(k));
  assert(!!rf && rf[1].tab === 'dashboard', `4-23: DI-370 test 5 — the RESULTS_FINALIZED deep link still resolves to the Dashboard\'s results section (${JSON.stringify(rf && rf[1])})`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5] The wiring, RUN — the real app.js against a real element tree built from the real index.html…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const reset = () => { globalThis.document = freshDoc(); app._resetHomeWiringForTest(); app.state.currentTab = 'home'; delete globalThis.Capacitor; };
  const active = (d) => [...d.querySelectorAll('.page-section')].filter((e) => e.classList.contains('active')).map((e) => e.id);
  const activeNav = (d) => [...d.querySelectorAll('.nav-item')].filter((e) => e.classList.contains('active')).map((e) => e.dataset.tab);

  // DI-370 test 2: navigateTo('home') renders Home and highlights the Home tab; leaving Home lights the destination, and Dashboard lights DASHBOARD (it is a real tab again)
  reset(); quiet();
  window.navigateTo('home');
  let root = document.getElementById('home-root');
  assert(!!root && !!root.querySelector('.home-feed[aria-busy="false"]') && root.querySelectorAll('.feed-item').length >= 1 && !!root.querySelector('.feed-now') && root.querySelectorAll('.feed-skel').length <= HomeMod.NEWS_SKELETON_COUNT,
    '5-1: navigateTo("home") paints the REAL Home into #home-root (a settled .home-feed with its Now card; at most the news slot\'s own skeletons remain while headlines load, never the page-level skeleton)');
  assert(JSON.stringify(active(document)) === '["page-home"]' && JSON.stringify(activeNav(document)) === '["home"]' && document.querySelector('.nav-item[data-tab="home"]').getAttribute('aria-current') === 'page' && document.body.dataset.tab === 'home',
    '5-2: DI-370 test 2 — #page-home is the one active page, the Home nav item is the one active item (aria-current="page") and body data-tab is "home"');
  window.navigateTo('dashboard');
  assert(JSON.stringify(activeNav(document)) === '["dashboard"]' && document.querySelector('.nav-item[data-tab="home"]').getAttribute('aria-current') === null && JSON.stringify(active(document)) === '["page-dashboard"]',
    '5-3: navigateTo("dashboard") lights the DASHBOARD tab (not Home: it is a real tab again) and Home loses aria-current');
  window.navigateTo('commissioner');
  assert(JSON.stringify(activeNav(document)) === '[]', '5-4: the commissioner page lights NO nav item (the bar has no Comm button; like Rules)');
  window.navigateTo('home');
  assert(JSON.stringify(activeNav(document)) === '["home"]', '5-5: …and navigating back to Home lights it again');

  // T4: the tab-change selection haptic, native only, change only, before navigateTo
  const buzz = [];
  const installNative = () => { globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => buzz.push('impact:' + o.style), selectionStart() {}, selectionChanged: () => buzz.push('selection:at=' + app.state.currentTab), selectionEnd() {} } } }; };
  reset(); installNative(); buzz.length = 0;
  window.navigateTo('home'); app._setupNavForTest();
  const tap = (tab) => { const el = document.querySelector(`.nav-item[data-tab="${tab}"]`); el.dispatchEvent({ type: 'click', target: el }); };
  tap('dashboard');
  assert(JSON.stringify(buzz) === '["selection:at=home"]' && app.state.currentTab === 'dashboard', `5-6: T4 — tapping a DIFFERENT tab fires ONE selection haptic, BEFORE navigateTo moved the tab (it fired while the tab was still "home"; got ${JSON.stringify(buzz)})`);
  buzz.length = 0; tap('dashboard');
  assert(buzz.length === 0, '5-7: T4 — re-tapping the CURRENT tab fires no haptic');
  buzz.length = 0; window.navigateTo('dashboard'); window.navigateTo('home');
  assert(buzz.length === 0, '5-8: T4 — a programmatic navigateTo() never buzzes (it is not a touch)');
  buzz.length = 0; window.navigateTo('dashboard'); buzz.length = 0; tap('home');
  assert(JSON.stringify(buzz) === '["selection:at=dashboard"]', '5-9: T4 — Home buzzes exactly like the other four tabs (one selection; a heavier buzz is what makes a control read as "create")');
  delete globalThis.Capacitor; buzz.length = 0; reset(); window.navigateTo('home'); app._setupNavForTest(); tap('dashboard');
  assert(buzz.length === 0 && app.state.currentTab === 'dashboard', '5-10: T4 — on the WEB (no native shell) there is no haptic at all (the parity-by-design pair): the tap still navigates');

  // the container is RE-CREATED after a teardown (A6) or a league-flow screen took #home-root, and Home paints again
  reset(); window.navigateTo('home');
  document.getElementById('page-home').innerHTML = '';               // what tearDownRenderedContentForHold() does
  assert(document.getElementById('home-root') === null, '5-11: (fixture) the hold teardown emptied #page-home, #home-root is gone');
  window.navigateTo('home');
  assert(!!document.querySelector('#page-home > #home-root .home-feed'), '5-12: after the teardown the next navigateTo("home") RE-CREATES the inner #home-root and paints Home into it');
  document.getElementById('page-home').innerHTML = '<div class="card" id="league-flow-landing">Join or create a league</div>';
  window.navigateTo('home');
  assert(!document.getElementById('league-flow-landing') && !!document.querySelector('#page-home > #home-root .home-feed'), '5-13: a league-flow screen left in #page-home is replaced, not painted over (Home owns the section once the flow is gone)');

  // the paused-league banner is a child of the SECTION, outside #home-root: it survives a Home repaint and is not painted twice
  reset();
  auth._setMembershipsForTest([{ leagueId: 'L1', memberId: 'm1', role: 'player', displayName: 'Drew', leagueName: 'Paused Crew', status: 'paused', pilot: false, sportDefault: 'cfb' }]);
  auth.setActiveLeagueId('L1');
  app._renderHomePageForTest();
  const banner = () => document.querySelectorAll('#page-home #paused-league-banner');
  assert(banner().length === 1 && !document.getElementById('home-root').querySelector('#paused-league-banner'), '5-14: a paused league\'s banner sits in #page-home, OUTSIDE #home-root (one banner)');
  app._renderHomePageForTest(); app._renderHomePageForTest();
  assert(banner().length === 1 && !!document.querySelector('#home-root .home-feed'), '5-15: the banner SURVIVES Home repaints (and is never painted twice): the repaint touches only #home-root');
  auth._setMembershipsForTest([]); auth.setActiveLeagueId(null);

  // go-tab / build-slate: the app side of the actions
  reset(); window.navigateTo('home');
  app._onHomeActionForTest('go-tab', { tab: 'dashboard' });
  assert(app.state.currentTab === 'dashboard', '5-16: go-tab navigates through navigateTo');
  app.state.commTab = 'week'; window.navigateTo('home');
  app._onHomeActionForTest('go-tab', { tab: 'commissioner', commTab: 'games' });
  assert(app.state.currentTab === 'commissioner' && app.state.commTab === 'games', '5-17: go-tab to the commissioner panel carries the Games sub-tab (DI-365\'s nudge deep link)');
  app.state.commTab = 'week'; window.navigateTo('home');
  app._onHomeActionForTest('go-tab', { tab: 'commissioner', commTab: 'bogus' });
  assert(app.state.commTab === 'week', '5-18: an unknown commTab is ignored (the renderer allow-lists it too; the app re-checks)');
  storage.clearSession?.();
  app._onHomeActionForTest('build-slate');
  assert(!document.getElementById('week-wizard-sheet-wrap'), '5-19: W6 — build-slate with NO commissioner session opens nothing (the role is re-checked at tap time, not trusted from the markup that rendered the button)');

  // the refresh leg: league failure throws (into the binder's onFail) and Home is NOT refreshed; success refreshes Home once, after the hydrate
  reset(); window.navigateTo('home');
  const wiring = app._getHomeWiringForTest();
  const order = [];
  const realRefresh = wiring.homeView.refresh;
  wiring.homeView.refresh = async () => { order.push('home.refresh'); return true; };
  const okSync = app._makeRunManualSyncForTest(async () => { order.push('hydrate'); }, () => 'ACTIVE', () => true);
  await okSync('pull-to-refresh');
  assert(JSON.stringify(order) === '["hydrate","home.refresh"]', `5-20: pull-to-refresh on Home: the league hydrate FIRST, then Home's refresh (got ${JSON.stringify(order)})`);
  order.length = 0;
  const badSync = app._makeRunManualSyncForTest(async () => { order.push('hydrate'); }, () => 'ACTIVE-STALE', () => true);
  let threw = null; try { await badSync('pull-to-refresh'); } catch (e) { threw = e; }
  assert(!!threw && /not current/.test(String(threw.message)) && order.length === 1, '5-21: a league sync that did not land THROWS (into the binder\'s onFail -> showSyncFailureBanner) and Home\'s refresh never runs: no success over a failed sync');
  order.length = 0; app.state.currentTab = 'dashboard';
  await okSync('pull-to-refresh');
  assert(JSON.stringify(order) === '["hydrate"]', '5-22: on another tab Home\'s refresh is not called');
  wiring.homeView.refresh = realRefresh;

  // native restore round trip
  reset(); installNative();
  storage.setShellUiState('home', 0);
  app._resetNativeShellRestoreForTest(); app.state.currentTab = 'dashboard';
  app._restoreNativeShellUiStateForTest();
  assert(app.state.currentTab === 'home' && app._nativeShellTabRestoredForTest() === true && app._bootDefaultTabForTest() === 'home', '5-23: DI-370 test 4 — a native shell that was last on Home restores to Home (and bootDefaultTab agrees)');
  storage.setShellUiState('commissioner', 0);
  app._resetNativeShellRestoreForTest(); app._restoreNativeShellUiStateForTest();
  assert(app.state.currentTab === 'commissioner', '5-24: …and a saved "commissioner" is still a valid restore (with no tab lit)');
  delete globalThis.Capacitor; app._resetNativeShellRestoreForTest(); app.state.currentTab = 'home';

  // the menu trigger: the glyph and aria-expanded follow the drawer
  reset();
  const trig = document.getElementById('control-center-trigger');
  const ctx = app._buildControlCenterCtxForTest();
  ctx.callbacks.onDrawerVisibilityChange(true);
  assert(trig.getAttribute('aria-expanded') === 'true', '5-25: T5 — opening the drawer sets aria-expanded="true" on the menu button');
  ctx.callbacks.onDrawerVisibilityChange(false);
  assert(trig.getAttribute('aria-expanded') === 'false', '5-26: …and closing it sets "false"');
  loud();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6] SP-54 / checklist item 21 — Home\'s season stats get the SAME group tie contexts as Standings (parity on a tied group fixture)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  // A two-part group (grp_a1 + grp_a2), three players. Pooled across the parts p2 and p5 tie on 11 correct each and on the tiebreaker of record; the weekly tie-break (SP-54) decides it, so
  // Standings' weeklyWins / currentRank DEPEND on the group tie context. Without it the legacy order stands. This is the fixture where Home and Standings could silently disagree.
  const tieCtx = await import('./js/tie-context.js');
  const scoring = await import('./js/scoring.js');
  const stats = await import('./js/stats.js');
  const feed = await import('./js/feed-cards.js');
  const DAY = 86400e3, isoAt = (t) => new Date(t).toISOString();
  const EARLIEST = Math.min(Date.parse(tieCtx.TIE_RULE_EFFECTIVE_AT), Date.parse(tieCtx.ALMA_SNAPSHOT_EPOCH_AT));
  const LOCKED = isoAt(EARLIEST - 29 * DAY), KICK = isoAt(EARLIEST - 25 * DAY), FINAL = isoAt(Date.parse(tieCtx.TIE_RULE_EFFECTIVE_AT) + 2 * DAY);
  const SCHOOLS = { p1: 'Texas A&M', p2: 'Oklahoma', p5: 'Arkansas' };
  const NAMES = { p1: 'Drew', p2: 'Brayden', p5: 'Jacob' };
  const game = (w, i, code) => { const [hs, as] = code === 'H' ? [24, 10] : [14, 13]; return { gameId: `${w}_g${i}`, weekId: w, status: 'final', homeTeam: `${w}H${i}`, awayTeam: `${w}A${i}`, homeScore: hs, awayScore: as, spread: -3, lockedSpread: -3, multiplier: 1, kickoff: KICK }; };
  const almaGame = (w, i, school, covered) => ({ gameId: `${w}_a${i}`, weekId: w, status: 'final', homeTeam: school, awayTeam: `Opp ${w} ${i}`, homeScore: covered ? 38 : 31, awayScore: covered ? 17 : 27, spread: -7, lockedSpread: -7, multiplier: 1, kickoff: KICK });
  const picksFor = (w, spec) => Object.entries(spec).flatMap(([pid, str]) => [...str].map((c, i) => ({ weekId: w, gameId: `${w}_g${i + 1}`, playerId: pid, selectedTeam: c === 'H' ? `${w}H${i + 1}` : `${w}A${i + 1}` })));
  const mkWeek = (w, over) => ({ weekId: w, weekNumber: over.n, season: 2026, name: 'Week ' + over.n, status: 'final', dataSourceMode: 'live', lockedAt: LOCKED, finalizedAt: FINAL, extraPointEnabled: false, groupId: 'grp_a',
    lockedAlmaByPlayer: SCHOOLS, actualTiebreakerValue: over.tb ?? null, isGroupTiebreaker: over.isTb === true });
  // a third, ordinary week: a split week's rank waits for ALL its parts, so the feed's rank.changed card (from the end of one week to the end of the next) can only move across the GROUP once week 3 exists
  const WEEKS = [mkWeek('grp_a1', { n: 1 }), mkWeek('grp_a2', { n: 2, tb: 50, isTb: true }), { ...mkWeek('w_3', { n: 3, tb: 40 }), groupId: undefined }];
  const GAMES = [
    ...[...'HHHHHH'].map((c, i) => game('grp_a1', i + 1, c)), almaGame('grp_a1', 1, 'Oklahoma', true), almaGame('grp_a1', 2, 'Arkansas', true),
    ...[...'HHHHHH'].map((c, i) => game('grp_a2', i + 1, c)), almaGame('grp_a2', 1, 'Oklahoma', false),
    ...[...'HHHHHH'].map((c, i) => game('w_3', i + 1, c)),
  ];
  const PICKS = [...picksFor('grp_a1', { p1: 'HHHAAA', p2: 'HHHHHH', p5: 'HHHHHA' }), ...picksFor('grp_a2', { p1: 'HHHAAA', p2: 'HHHHHA', p5: 'HHHHHH' }), ...picksFor('w_3', { p1: 'HHHHHH', p2: 'HHHAAA', p5: 'HHHHAA' })];
  const seed = () => {
    store.clear(); app._resetHomeWiringForTest();
    for (const pid of Object.keys(SCHOOLS)) storage.savePlayer({ playerId: pid, displayName: NAMES[pid], active: true, almaMater: SCHOOLS[pid] });
    WEEKS.forEach((w) => storage.saveWeek(w));
    GAMES.forEach((g) => storage.saveGame(g));
    storage.saveAllPicks(PICKS);
    storage.setTiebreakerGuess('grp_a2', 'p2', 52); storage.setTiebreakerGuess('grp_a2', 'p5', 48);
    storage.setTiebreakerGuess('w_3', 'p1', 41); storage.setTiebreakerGuess('w_3', 'p2', 40); storage.setTiebreakerGuess('w_3', 'p5', 35);
    const players = storage.getPlayers().filter((p) => p.active);
    for (const w of WEEKS) {
      scoring.calculateWeeklyResults; // (the per-part rows are the plain weekly rows, exactly as finalize stores them)
      storage.saveAllWeeklyResults(w.weekId, scoring.calculateWeeklyResults(w.weekId, players, PICKS.filter((p) => p.weekId === w.weekId), GAMES.filter((g) => g.weekId === w.weekId), w.actualTiebreakerValue ?? null));
    }
  };
  quiet();
  seed();
  const rows = app.seasonStandingsRows();
  const wiring = app._getHomeWiringForTest();
  const snap = wiring.homeView.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: Date.parse(tieCtx.TIE_RULE_EFFECTIVE_AT) + 10 * DAY });
  const active = storage.getPlayers().filter((p) => p.active);
  const view = (tieContexts) => ({ players: active, revealedWeeks: snap.revealedWeeks, revealedGames: snap.revealedGames, revealedPicks: snap.revealedPicks, revealedWeeklyResults: snap.revealedWeeklyResults, allWeeks: snap.weeks, tieContexts });
  const pick = (r) => [r.weeklyWins, r.weeklyLosses, r.currentRank].join('/');
  const std = Object.fromEntries(rows.map((r) => [r.playerId, pick(r)]));
  loud();

  assert(snap.revealedWeeks.length === 3 && snap.tieContexts instanceof Map && snap.tieContexts.has('grp_a') && snap.tieContexts.size === 1,
    '6-1: (fixture) the group\'s two parts and week 3 are in the revealed view and the snapshot carries the group tie context for grp_a (a Map, one group)');
  const withCtx = Object.fromEntries(Object.keys(SCHOOLS).map((pid) => [pid, pick(stats.memberSeasonStats(pid, view(snap.tieContexts)))]));
  assert(Object.keys(SCHOOLS).every((pid) => withCtx[pid] === std[pid]),
    `6-2: PARITY — for every player Home's memberSeasonStats (weeklyWins/weeklyLosses/currentRank) equals seasonStandingsRows() on the tied group (Standings ${JSON.stringify(std)}, Home ${JSON.stringify(withCtx)})`);
  const without = Object.fromEntries(Object.keys(SCHOOLS).map((pid) => [pid, pick(stats.memberSeasonStats(pid, view(null)))]));
  assert(Object.keys(SCHOOLS).some((pid) => without[pid] !== std[pid]) && std.p5.split('/')[0] >= '1',
    `6-3: the fixture is SENSITIVE — handed no context the same call answers differently (${JSON.stringify(without)}), so 6-2 is a measurement: the weekly tie-break (Arkansas +1 over Oklahoma) makes p5 the group's weekly winner in Standings`);
  assert(Object.keys(SCHOOLS).every((pid) => pick(scoring.calculateSeasonStandings(active, snap.revealedWeeklyResults, snap.weeks).find((r) => r.playerId === pid)) === without[pid]),
    '6-4: …and "no context" is exactly today\'s behaviour (the legacy calculateSeasonStandings): null changes nothing');

  // the snapshot only carries groups whose EVERY member week is revealed (S-C2): drop one member from the revealed view and the group's context is not in the snapshot
  const HomeMod2 = HomeMod;
  const restricted = HomeMod2.restrictTieContextsToRevealed(snap.tieContexts, snap.weeks, snap.revealedWeeks.filter((w) => w.weekId === 'grp_a1'));
  assert(restricted instanceof Map && restricted.size === 0 && HomeMod2.restrictTieContextsToRevealed(snap.tieContexts, snap.weeks, snap.revealedWeeks).size === 1 && HomeMod2.restrictTieContextsToRevealed(null, [], []) === null,
    '6-5: a group is in the snapshot only when EVERY member week is in the revealed view (one unrevealed part and its context never rides in; a non-Map is null)');
  const ctxJson = JSON.stringify([...snap.tieContexts.entries()]);
  assert(snap.tieContexts.get('grp_a') && Object.keys(app.seasonGroupTieContexts(snap.weeks, active).get('grp_a')).join() === Object.keys(snap.tieContexts.get('grp_a')).join() && ctxJson.length > 20,
    '6-6: the snapshot\'s context is the ONE builder\'s: seasonGroupTieContexts() (shared with seasonStandingsRows()) returns the same shape');

  // through the FEED: feed-cards.js must hand the context to memberSeasonStats. A Map subclass counts the reads calculateSeasonStandings makes of it (it asks `.get(groupId)` for a pooled
  // group), so the pass-through is observable without depending on whether this fixture happens to move a rank; dropping the pass-through turns it RED.
  class SpyMap extends Map { constructor(m) { super(m); this.reads = 0; } get(k) { this.reads++; return super.get(k); } }
  const opts = { viewerId: 'p1', now: snap.now, viewerIsCommissioner: false, isContentWithheld: () => false };
  const spyReal = new SpyMap(snap.tieContexts); feed.deriveCards({ ...snap, tieContexts: spyReal }, opts);
  assert(spyReal.reads > 0, `6-7: through deriveCards the season stats READ the group tie context (${spyReal.reads} read(s) of .get(groupId)): the feed hands it to memberSeasonStats`);
  const fcSrc = read('./js/feed-cards.js');
  const pass = 'tieContexts: s.tieContexts || null,';
  assert(fcSrc.split(pass).length === 2 && /tieContexts: s\.tieContexts instanceof Map \? s\.tieContexts : null,/.test(fcSrc), '6-8: feed-cards.js carries tieContexts through its snapshot normalization AND hands it to memberSeasonStats exactly once (the mutation anchor; without the normalization line the context would never arrive: a real defect the first run of 6-7 caught)');
  const mutSrc = fcSrc.replace(pass, '').replace(/from\s+(['"])\.\/([\w.-]+)\1/g, (_m, q, f) => `from ${q}${new URL('./js/' + f, import.meta.url).href}${q}`);
  const mutFeed = await import('data:text/javascript;base64,' + Buffer.from(mutSrc).toString('base64'));
  const spyMut = new SpyMap(snap.tieContexts); mutFeed.deriveCards({ ...snap, tieContexts: spyMut }, opts);
  assert(spyMut.reads === 0, '6-9: MUTATION — feed-cards.js without the tieContexts pass-through never reads the context (0 reads): the parity guard has teeth at the feed level');
  const noCtxCards = JSON.stringify(feed.deriveCards({ ...snap, tieContexts: null }, opts).map((c) => c.id));
  {
    // 6-9b (review N1, 2026-10-02: this was `... || true`, an assertion that could never fail). The context DOES change which cards exist: with it the group's completion (p5 over p2, decided by the weekly
    // tie-break) is reported as a rank change AT the group's last week; without it the same two moves surface a week later, at week 3. So the feed itself is observably sensitive, and the mutant is checked on it.
    const idsWith = feed.deriveCards(snap, opts).map((c) => c.id), idsWithout = JSON.parse(noCtxCards);
    const rk = (ids) => ids.filter((x) => x.startsWith('rank.changed')).sort();
    assert(JSON.stringify(rk(idsWith)) === '["rank.changed:-:grp_a2:p2","rank.changed:-:grp_a2:p5"]' && JSON.stringify(rk(idsWithout)) === '["rank.changed:-:w_3:p2","rank.changed:-:w_3:p5"]' && idsWith.length > 5,
      `6-9b: the feed is SENSITIVE to the context — with it the rank change is reported at the group's last week (grp_a2), without it a week later (w_3): ${JSON.stringify(rk(idsWith))} vs ${JSON.stringify(rk(idsWithout))}`);
    const idsMut = mutFeed.deriveCards({ ...snap, tieContexts: new Map(snap.tieContexts) }, opts).map((c) => c.id);
    assert(JSON.stringify(rk(idsMut)) === JSON.stringify(rk(idsWithout)),
      '6-9c: MUTATION — feed-cards.js without the pass-through yields the NO-context rank cards (w_3), not the context\'s (grp_a2): the Home/Standings parity guard has teeth on the cards themselves');
  }
  // and the wiring passes the shared builder, not a stub
  const wcode = stripComments(APP);
  assert(/groupTieContexts: \(\{ allWeeks, players \}\) => seasonGroupTieContexts\(allWeeks, players\),/.test(wcode) && /const tieContexts = seasonGroupTieContexts\(allWeeksRaw, players\);/.test(wcode),
    '6-10: app.js hands Home the SAME builder seasonStandingsRows() calls (one function: seasonGroupTieContexts), never a second inline build');
  store.clear(); app._resetHomeWiringForTest();
}

// ── result ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
