/**
 * CFB Pickems — d1wiringtest.mjs (Deployment 1, Lane B, DI-571 / 575 / 576 / 585 wiring, 2026-10-07)
 * ===================================================================================================
 * The app.js side of the Lane B Home work, RUN against the real app.js over a real element tree built from the real index.html (minidom.mjs), the way homenavtest [5] does:
 *
 *   [1] A card opens its detail as a PUSHED SCREEN over Home — and every way a stale or forged request is refused
 *   [2] The detail's own buttons: re-validated against the CURRENT model, one onward action leaves the stack for its tab
 *   [3] The hold teardown and the identity chokepoint close a screen through its own door
 *   [4] Reading position (DI-585b): the same identity, the same week; never persisted
 *   [5] The blind rule where the league's picks are READ for the week-result table
 *   [6] Source pins on the wiring (order of the calls, the gates handed in, the Home repaint hook)
 *
 * NOT COVERED HERE (a device, never a test): the slide / swipe-back feel, haptic strength, VoiceOver's reading of the pushed screen, the iOS back-swipe-from-the-edge behaviour.
 *
 * Run:  node d1wiringtest.mjs
 */
import { readFileSync } from 'node:fs';
import { MiniDocument } from './minidom.mjs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in d1wiringtest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollY = 0;
const scrolls = [];
globalThis.scrollTo = (o, y) => { const t = (o && typeof o === 'object') ? o.top : y; scrolls.push(Number(t)); globalThis.scrollY = Number(t); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const INDEX = read('./index.html');
const APP = read('./js/app.js');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); const m = INDEX.match(/<body[^>]*data-tab="([^"]*)"/); if (m) doc.body.dataset.tab = m[1]; doc.body.innerHTML = bodyHtmlOf(INDEX); return doc; };
globalThis.document = freshDoc();

quiet();
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const ps = await import('./js/pushed-screen.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');
loud();

function seed() {
  store.clear();
  const L = fx.buildLeague({ w2: 'final', calculateWeeklyResults });
  L.players.forEach((p) => storage.savePlayer({ ...p }));
  L.weeks.forEach((w) => storage.saveWeek(w));
  L.games.forEach((g) => storage.saveGame(g));
  storage.saveAllPicks(L.picks);
  storage.saveAllWeeklyResults('w1', L.weeklyResults.filter((r) => r.weekId === 'w1'));
  storage.saveAllWeeklyResults('w2', L.weeklyResults.filter((r) => r.weekId === 'w2'));
  storage.setSession('p1', false, true);
  return L;
}
const reset = () => { try { ps.closeAllScreens('test'); } catch {} globalThis.document = freshDoc(); app._resetHomeWiringForTest(); app.state.currentTab = 'home'; globalThis.scrollY = 0; scrolls.length = 0; for (const k of Object.keys(app._tabScrollForTest)) delete app._tabScrollForTest[k]; };
const cardIds = () => document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id'));
const root = () => document.getElementById('pushed-root');
const screenEl = () => (root() ? root().querySelector('[data-ps-id]') : null);
const click = (n) => n.dispatchEvent({ type: 'click', target: n });

seed();
quiet();
reset();
window.navigateTo('home');
loud();

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] A card opens its detail as a pushed screen over Home…');
{
  const ids = cardIds();
  assert(ids.length >= 5 && document.querySelectorAll('#home-root .feed-card--tap').length === ids.length, `1a: (fixture) the real Home paints tappable cards (${ids.length}) from the seeded league`);
  assert(!root() || !screenEl(), '1b: nothing is pushed until a card is tapped');
  const wr = ids.find((i) => i.startsWith('week.result:'));
  await wait(40);                                                    // (no IntersectionObserver here: Home pages itself to the end on a microtask — let it finish before the "before" snapshot)
  const before = document.getElementById('home-root').innerHTML;
  quiet();
  app._onHomeActionForTest('open-card', { cardId: wr });
  loud();
  const el = screenEl();
  assert(!!root() && !!el && ps.isScreenOpen() && ps.screenDepth() === 1 && ps.topScreenId() === `card:${wr}`, `1c: tapping "${wr}" pushes ONE screen (id card:{id}) into #pushed-root`);
  assert(!!el.querySelector('.cd[data-cd-type="week.result"]') && /Week 2/.test(el.querySelector('.ps-title').textContent === '' ? el.textContent : el.querySelector('.ps-title').textContent + el.textContent), '1d: the screen carries the card\'s detail (built from live data) under its title');
  assert(!!el.querySelector('[data-ps-back]') && /Back to Home/.test(el.querySelector('[data-ps-back]').getAttribute('aria-label')), '1e: a Back control labelled with where it goes ("Back to Home")');
  assert(document.getElementById('home-root').innerHTML === before, '1f: Home stays mounted UNDER the screen, byte-for-byte untouched (so Back lands on the same card at the same offset)');
  const inert = ['.main-content', '.bottom-nav', '.app-header'].map((s) => document.querySelector(s)).filter(Boolean);
  assert(inert.length >= 2 && inert.every((n) => n.hasAttribute('inert')), '1g: while a screen is up the content, tab bar and header are inert (nothing behind it can be reached)');
  // Back
  click(el.querySelector('[data-ps-back]'));
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(!ps.isScreenOpen() && !screenEl() && inert.every((n) => !n.hasAttribute('inert')), '1h: Back removes the screen and gives the page back (no longer inert)');
  assert(document.getElementById('home-root').innerHTML === before, '1i: …and Home is exactly as it was');
  // forged / unknown id: the detail resolves it AGAIN from live data
  quiet();
  app._onHomeActionForTest('open-card', { cardId: 'game.final:L1:w9:-:forged' });
  loud();
  const bad = screenEl();
  assert(!!bad && /Details for this card aren.t available right now/.test(bad.textContent) && !!bad.querySelector('.cd--unavailable') && !bad.querySelector('[data-cd-type]'), '1j: a card id that names nothing the data shows opens the calm unavailable state — never a detail, never a throw');
  ps.closeAllScreens('test');
  for (const bogus of [undefined, null, 7, '', {}, []]) { quiet(); app._onHomeActionForTest('open-card', { cardId: bogus }); loud(); }
  assert(!ps.isScreenOpen(), '1k: a missing, empty or non-string card id opens nothing');
  quiet(); app._onHomeActionForTest('open-card'); app._onHomeActionForTest('open-card', null); loud();
  assert(!ps.isScreenOpen(), '1l: …and an action with no parameters at all is harmless');
  // opening the same card twice never stacks
  quiet();
  app._onHomeActionForTest('open-card', { cardId: wr });
  app._onHomeActionForTest('open-card', { cardId: wr });
  loud();
  assert(ps.screenDepth() === 1, '1m: opening the same card again does not stack a second copy (it pops back to the first)');
  ps.closeAllScreens('test');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] The detail\'s own buttons…');
{
  const ids = cardIds();
  const wr = ids.find((i) => i.startsWith('week.result:'));
  quiet(); app._onHomeActionForTest('open-card', { cardId: wr }); loud();
  const el = screenEl();
  const actions = el.querySelectorAll('[data-cd-action]');
  const names = actions.map((a) => a.getAttribute('data-cd-action'));
  assert(names.length >= 1 && names.every((n) => ['go-standings', 'go-picks', 'go-dashboard', 'open-thread', 'open-chat', 'see-2025', 'back-home', 'show-all', 'share', 'week-detail', 'compare'].includes(n)), `2a: every button is on the action allow-list (${names.join(', ')})`);
  // DI-597: Share to chat, last in the group, through the real dispatcher: the Share sheet opens above the detail for THIS card (the model's own reference, never the DOM's)
  const shareBtn = actions.find((a) => a.getAttribute('data-cd-action') === 'share');
  if (shareBtn) { quiet(); click(shareBtn); loud(); }
  const sst = app._shareSheetStateForTest();
  assert(!!shareBtn && names[names.length - 1] === 'share' && !!document.getElementById('share-sheet-wrap') && ps.isScreenOpen() && !!sst && sst.ref.type === 'card' && sst.ref.id === wr, `2a-2: "Share to chat" is the group's last button and opens the Share sheet above the detail for this card (${sst ? JSON.stringify(sst.ref) : 'no sheet'})`);
  quiet(); app._closeShareSheetForTest({ immediate: true }); loud();
  // a tampered button: an action this card's model does not offer
  const forged = actions[0];
  const real = forged.getAttribute('data-cd-action');
  forged.setAttribute('data-cd-action', real === 'go-picks' ? 'go-standings' : 'go-picks');
  if (names.includes(forged.getAttribute('data-cd-action'))) forged.setAttribute('data-cd-action', 'open-chat');
  const tabBefore = app.state.currentTab;
  quiet(); click(forged); loud();
  assert(app.state.currentTab === tabBefore && ps.isScreenOpen(), `2b: Std-9 — a button whose action is NOT in the card's current model does nothing: no navigation, the screen stays (tampered ${real} → ${forged.getAttribute('data-cd-action')})`);
  forged.setAttribute('data-cd-action', real);
  forged.setAttribute('data-cd-week', 'w1');
  quiet(); click(forged); loud();
  assert(app.state.currentTab === tabBefore && ps.isScreenOpen(), '2c: …and a real action with a swapped parameter (another week) does nothing either');
  forged.removeAttribute('data-cd-week');
  // the honest tap
  const honest = actions.find((a) => a.getAttribute('data-cd-action') === 'go-standings');
  quiet(); click(honest); loud();
  assert(app.state.currentTab === 'leaderboard' && !ps.isScreenOpen(), '2d: the honest "go-standings" leaves the pushed stack and lands on Standings through navigateTo');
  reset(); quiet(); window.navigateTo('home'); loud();
  // show-all toggles in place
  const listId = cardIds().find((i) => i.startsWith('rank.changed:') || i.startsWith('slate.published:'));
  void listId;
  // a detail with a back-home (unavailable state)
  quiet(); app._onHomeActionForTest('open-card', { cardId: 'nope:L1:-:-' }); loud();
  const bh = screenEl().querySelector('[data-cd-action="back-home"]');
  assert(!!bh, '2e: the unavailable state offers "Back to Home"');
  quiet(); click(bh); loud();
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(!ps.isScreenOpen(), '2f: …and it closes the screen');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3] The hold teardown and the identity chokepoint…');
{
  reset(); quiet(); window.navigateTo('home'); loud();
  const wr = cardIds().find((i) => i.startsWith('week.result:'));
  quiet(); app._onHomeActionForTest('open-card', { cardId: wr }); loud();
  assert(ps.isScreenOpen() && !!screenEl(), '3a: (fixture) a card detail is open');
  quiet(); app._tearDownRenderedContentForHoldForTest(); loud();
  assert(!ps.isScreenOpen() && !screenEl(), '3b: the hold teardown (sign-out, expiry, a league switch, the auth gate) closes the pushed screen — it can never survive under the gate');
  const content = document.querySelector('.main-content');
  assert(!!content && content.hasAttribute('inert') && !ps.isScreenOpen(), '3c: …and the page is inert under the HOLD\'s own lock, not left half-open by the screen\'s teardown');
  const code = stripComments(APP);
  const choke = (code.match(/function applyIdentityDeltaIfChanged\([\s\S]*?\n\}\n/) || [''])[0];
  const iClose = choke.indexOf("closeAllScreens('identity')"), iSweep = choke.indexOf("querySelectorAll('[data-hold-teardown]')");
  assert(iClose > 0 && iSweep > iClose, '3d: the identity chokepoint closes a pushed screen through its own door BEFORE the DOM sweep (the screen was built from the departed identity\'s data)');
  const hold = (code.match(/function tearDownRenderedContentForHold\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  const h1 = hold.indexOf("closeAllScreens('hold')"), h2 = hold.indexOf("querySelectorAll('[data-hold-teardown]')");
  assert(h1 > 0 && h2 > h1, '3e: the hold teardown closes it through its own door BEFORE the generic data-hold-teardown sweep (its stack, its Esc listener and its inert page are module state a DOM sweep would orphan)');
  assert(/function openCardDetail\(cardId, \{[^}]*\} = \{\}\) \{\s*if \(isContentWithheld\(\)/.test(code) && /function openGameView\(gameId, \{[^}]*\} = \{\}\) \{\s*if \(isContentWithheld\(\)/.test(code), '3f: opening a screen (a card detail, a Game view) is refused while content is withheld (Std-12), checked FIRST');
  reset(); quiet(); window.navigateTo('home'); loud();
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[4] Reading position (DI-585b)…');
{
  const mem = app._tabScrollForTest;
  reset(); quiet(); window.navigateTo('home'); loud();
  globalThis.scrollY = 640;
  quiet(); window.navigateTo('dashboard'); loud();
  assert(mem.home && mem.home.y === 640, '4a: leaving Home remembers the window offset (640)');
  globalThis.scrollY = 0; scrolls.length = 0;
  quiet(); window.navigateTo('home'); loud();
  assert(scrolls.length === 1 && scrolls[0] === 640 && globalThis.scrollY === 640, `4b: coming back restores it (instant scrollTo ${scrolls.join(',')})`);
  globalThis.scrollY = 90; scrolls.length = 0;
  quiet(); window.navigateTo('home'); loud();
  assert(scrolls.length === 0 && globalThis.scrollY === 90, '4c: a same-tab repaint (navigateTo to the tab already showing) restores nothing and never moves the reader');
  // identity: another account never inherits the place (the entry is tampered while the reader is on ANOTHER tab, then they navigate straight to it)
  reset(); quiet(); window.navigateTo('home'); loud();
  mem.leaderboard = { y: 300, identity: 'someone|else', week: null };
  globalThis.scrollY = 0; scrolls.length = 0;
  quiet(); window.navigateTo('leaderboard'); loud();
  assert(scrolls.filter((y) => y === 300).length === 0 && !mem.leaderboard, '4d: a place remembered under ANOTHER identity is discarded, never restored');
  // Dashboard: only the same week
  reset(); quiet(); window.navigateTo('dashboard'); loud();
  globalThis.scrollY = 410; app.state.viewingWeekId = 'w1';
  quiet(); window.navigateTo('home'); loud();
  assert(mem.dashboard && mem.dashboard.y === 410 && mem.dashboard.week === 'w1', '4e: the Dashboard remembers the offset AND the week it was showing');
  app.state.viewingWeekId = 'w2'; globalThis.scrollY = 0; scrolls.length = 0;
  quiet(); window.navigateTo('dashboard'); loud();
  assert(scrolls.length === 0, '4f: …and does not restore it onto a different week (its top is the right place)');
  globalThis.scrollY = 333;
  quiet(); window.navigateTo('home'); loud();
  globalThis.scrollY = 0; scrolls.length = 0;
  quiet(); window.navigateTo('dashboard'); loud();
  assert(scrolls.length === 1 && scrolls[0] === 333, `4g: CONTROL — leaving and returning on the SAME week does restore (scrollTo ${scrolls.join(',')})`);
  app.state.viewingWeekId = null;
  // Picks and Chat keep their own logic (minidom cannot paint Picks: its head slot assigns outerHTML), so the list is pinned by source
  assert(/const TAB_SCROLL_MEMORY = \['home', 'dashboard', 'leaderboard'\];/.test(APP), '4h: only Home, Dashboard and Standings are remembered here — Picks and Chat keep their own logic');
  const code = stripComments(APP);
  assert(!/_tabScroll\b[^;\n]*(localStorage|sessionStorage|save\()/.test(code) && !/(localStorage|sessionStorage|save\()[^;\n]*_tabScroll\b/.test(code), '4i: the reading positions are held in memory only — nothing writes them anywhere');
  assert(/pauseNavHide\(\);\s*scrollWindow\(window, \{ top: m\.y, left: 0, behavior: 'instant' \}, 'scrollTo'\);/.test(code), '4j: the restore pauses the tab bar\'s hide-on-scroll and scrolls INSTANTLY through the house helper (the app\'s own scroll is not the reader\'s)');
  assert(/rememberTabScroll\(_priorTab\);[\s\S]{0,1200}state\.currentTab = tab;/.test(code), '4k: the offset is read BEFORE state.currentTab moves and the page changes');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5] The blind rule where the picks are read…');
{
  const code = stripComments(APP);
  const ctx = (code.match(/detailContext: \(\) => \(\{[\s\S]*?\n    \}\),/) || [''])[0];
  assert(ctx.length > 100, '5a: (fixture) the detailContext wiring was found');
  const rows = ctx.slice(ctx.indexOf('scoreSummaryRowsHTML'));
  const gateAt = rows.search(/arePicksPublic\(week\)/), readAt = rows.search(/getPicks\(week\.weekId\)/);
  assert(gateAt > 0 && readAt > gateAt && /getBackendMode\(\) === 'supabase' && sb\.picksReadWhilePublic\(week\.weekId\) !== true\)\) return ''/.test(rows), '5b: the week-result table asks arePicksPublic(week) — and, on Supabase, the server read for that week — BEFORE it reads the league\'s picks; otherwise it yields nothing');
  assert(!/canViewOtherPicks/.test(ctx), '5c: it never uses the older canViewOtherPicks');
  assert(/onRender: \(\) => \{ if \(isScreenOpen\(\)\) invalidateScreens\(\); \}/.test(code) && /function renderHomePage\(\) \{\s*getHomeWiring\(\)\.homeView\.renderHome\(\);\s*renderPausedLeagueBannerIfNeeded\('home'\);\s*renderSportStallBannerIfNeeded\('home'\);[^\n]*\s*armLockFlipForPage\(\);\s*\}/.test(code), '6a: every Home repaint reaches an open screen through the injected onRender hook (renderHomePage keeps the exact shape homenavtest pins: paint, banner, the stall banner (D1 / DI-557), then the lock-flip arming int added)');
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[7] MUTATION PROOFS — scratch copies of app.js loaded as data: URLs (never the file)…');
{
  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace(/(from\s+|import\s*\(\s*)'\.\/([\w./-]+)'/g, (_m, pre, f) => `${pre}'${base}${f}'`);
  const probe = async (m) => {
    const o = {};
    const resetM = () => { try { ps.closeAllScreens('test'); } catch {} globalThis.document = freshDoc(); m._resetHomeWiringForTest(); m.state.currentTab = 'home'; globalThis.scrollY = 0; scrolls.length = 0; for (const k of Object.keys(m._tabScrollForTest)) delete m._tabScrollForTest[k]; };
    seed(); resetM(); quiet(); m._navigateToForTest('home'); loud();
    await wait(40);
    const wr = document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id')).find((i) => i.startsWith('week.result:'));
    quiet(); m._onHomeActionForTest('open-card', { cardId: wr }); loud();
    const el = screenEl();
    const btn = el && el.querySelectorAll('[data-cd-action]')[0];
    const real = btn && btn.getAttribute('data-cd-action');
    if (btn) { btn.setAttribute('data-cd-action', real === 'go-picks' ? 'go-standings' : 'go-picks'); if (m.state.currentTab !== 'home') m.state.currentTab = 'home'; }
    quiet(); if (btn) click(btn); loud();
    o.forgedAction = m.state.currentTab === 'home' && ps.isScreenOpen();
    if (btn) { btn.setAttribute('data-cd-action', real); btn.setAttribute('data-cd-week', 'w1'); }
    quiet(); if (btn) click(btn); loud();
    o.forgedParam = m.state.currentTab === 'home' && ps.isScreenOpen();
    quiet(); m._tearDownRenderedContentForHoldForTest(); loud();
    o.holdCloses = !ps.isScreenOpen();
    resetM(); quiet(); m._navigateToForTest('home'); loud();
    m._tabScrollForTest.leaderboard = { y: 300, identity: 'someone|else', week: null };
    globalThis.scrollY = 0; scrolls.length = 0;
    quiet(); m._navigateToForTest('leaderboard'); loud();
    o.identityMemory = scrolls.filter((y) => y === 300).length === 0;
    resetM(); quiet(); m._navigateToForTest('home'); loud();
    globalThis.scrollY = 640;
    quiet(); m._navigateToForTest('dashboard'); loud();
    globalThis.scrollY = 0; scrolls.length = 0;
    quiet(); m._navigateToForTest('home'); loud();
    o.restores = scrolls.length === 1 && scrolls[0] === 640;
    resetM(); quiet(); m._navigateToForTest('home'); loud();
    quiet(); m._onHomeActionForTest('open-card', { cardId: wr }); m._onHomeActionForTest('open-card', { cardId: wr }); loud();
    o.noStack = ps.screenDepth() === 1;
    ps.closeAllScreens('test');
    return o;
  };
  const R = (a, b) => { if (APP.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return APP.replace(a, b); };
  const mutants = [
    ['a button whose action is not in the current model is obeyed', R("if (!hit) return;                                        // not in the current model with these exact parameters: nothing happens", ''), 'forgedAction'],
    ['a real action with a swapped parameter is obeyed', R("(a.params.gameId || '') === game && (a.params.weekId || '') === weekId && (a.params.messageId || '') === messageId", "(a.params.gameId || '') === game"), 'forgedParam'],
    ['the hold teardown forgets the pushed screen', R("  try { closeAllScreens('hold'); } catch {}\n", ''), 'holdCloses'],
    ['a place remembered under another identity is restored', R("if (m.identity !== currentIdentityKey()) { delete _tabScroll[tab]; return; }", ''), 'identityMemory'],
    ['the reading position is never restored', R("  pauseNavHide();\n  scrollWindow(window, { top: m.y, left: 0, behavior: 'instant' }, 'scrollTo');", ''), 'restores'],
  ];
  const baseRes = await probe(app);
  assert(Object.values(baseRes).every(Boolean), `7-0: the probe is GREEN on the real app.js (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  for (const [name, src, check] of mutants) {
    let res;
    try {
      quiet();
      const mod = await import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random());
      loud();
      res = await probe(mod);
    } catch (err) { loud(); res = { [check]: 'ERR ' + String(err.message).slice(0, 90) }; }
    assert(src !== APP && res[check] === false, `7: mutant "${name}" turns ${check} RED${typeof res[check] === 'string' ? ' (' + res[check] + ')' : ''}`);
  }
  {
    const gateless = APP.replace("if (!week || !arePicksPublic(week) || (getBackendMode() === 'supabase' && sb.picksReadWhilePublic(week.weekId) !== true)) return '';", '');
    const ctx2 = (stripComments(gateless).match(/detailContext: \(\) => \(\{[\s\S]*?\n    \}\),/) || [''])[0];
    const rows2 = ctx2.slice(ctx2.indexOf('scoreSummaryRowsHTML'));
    assert(gateless !== APP && !(rows2.search(/arePicksPublic\(week\)/) > 0), '7: mutant "the week-result table reads the league\'s picks with no public check" turns 5b RED (the pin looks for the gate before the read)');
  }
}

// ═══ [8] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[8] Every Game view button is tapped through the real dispatcher (reviewer B2, fix round 1)…');
{
  // B2's lesson: a test that asserts a button is PRESENT proves nothing about what it does (Game Day's "Results" was drawn, asserted, and dead). The Game view is a pushed screen whose delegated click handler is
  // app.js's onGameViewClick(); this sweep builds every state the screen draws a button in, finds every [data-gv-action] / Related card the markup holds, taps each one for real, and checks the effect. An action
  // with no expectation fails the sweep, so a new button must say what it does here.
  const settle = () => wait(ps.EXIT_FALLBACK_MS + 150);
  const tap = (n) => { quiet(); try { n.dispatchEvent({ type: 'click', target: n }); } finally { loud(); } };
  const boot = (gid) => { reset(); quiet(); app._navigateToForTest('home'); app._openGameViewForTest(gid); loud(); };   // (THIS module's navigateTo: [7] loaded mutant copies, and window.navigateTo is the last one's)
  const holders = () => (root() ? root().querySelectorAll('[data-gv-action], [data-home-action="open-card"]') : []);
  const nameOf = (n) => n.getAttribute('data-gv-action') || 'open-card';
  const title = () => { const t = root() ? root().querySelectorAll('.ps-title') : []; return t.length ? t[t.length - 1].textContent : ''; };
  const STATES = {
    final:       { gid: 'g24', setup: () => seed(), expect: ['open-thread', 'locker-room', 'open-card', 'week-results', 'share'] },
    // fix round 2 (DI-599): What's next — picks due in a published Week 3, and the rest of a week still under way
    finalNextDue: {
      gid: 'g24', expect: ['next-picks', 'week-results'],
      setup: () => { seed(); storage.saveWeek({ weekId: 'w3', weekNumber: 3, season: '2026', status: 'open', picksLockAt: new Date(Date.now() + 86400e3).toISOString(), createdAt: new Date(Date.now() - 86400e3).toISOString() }); storage.saveGame({ ...storage.getGames('w2')[0], gameId: 'g31x', weekId: 'w3', status: 'scheduled', homeScore: null, awayScore: null, kickoff: new Date(Date.now() + 2 * 86400e3).toISOString() }); },
    },
    midWeek: {
      gid: 'g24', expect: ['open-gameday'],
      setup: () => { seed(); const w = storage.getWeeks().find((x) => x.weekId === 'w2'); storage.saveWeek({ ...w, status: 'live' }); const g = storage.getGames('w2').find((x) => x.gameId === 'g22'); storage.saveGame({ ...g, status: 'live', homeScore: 10, awayScore: 7 }); },
    },
    manyRelated: { gid: 'g21', setup: () => seed(), expect: ['open-thread', 'locker-room', 'open-card', 'see-all-home'] },
    notSubmittedOpen: {
      gid: 'g24', expect: ['make-picks'],
      setup: () => { seed(); const w = storage.getWeeks().find((x) => x.weekId === 'w2'); storage.saveWeek({ ...w, status: 'open', picksLockAt: new Date(Date.now() + 86400e3).toISOString() }); storage.saveGame({ ...storage.getGames('w2')[0], gameId: 'g_extra', status: 'scheduled', homeScore: null, awayScore: null, kickoff: new Date(Date.now() + 2 * 86400e3).toISOString() }); },
    },
    twoLive: {
      gid: 'g22', expect: ['prev', 'next'],
      setup: () => { seed(); for (const gid of ['g22', 'g23']) { const g = storage.getGames('w2').find((x) => x.gameId === gid); storage.saveGame({ ...g, status: 'live', homeScore: 10, awayScore: 7 }); } const w = storage.getWeeks().find((x) => x.weekId === 'w2'); storage.saveWeek({ ...w, status: 'live' }); },
    },
    gone: { gid: 'zz_no_such_game', setup: () => seed(), expect: ['back-home'] },
  };
  const EFFECT = {
    'open-thread': async () => !!document.getElementById('chat-sheet-wrap') && ps.isScreenOpen(),                                  // the existing bottom sheet opens; the Game view stays beneath it
    // DI-597: Share to chat opens the Share sheet ABOVE the Game view, for THIS game (the share resolveGameView just derived: a game reference, the game's own thread as its place)
    share: async () => { const st2 = app._shareSheetStateForTest(); const ok = !!document.getElementById('share-sheet-wrap') && ps.isScreenOpen() && !!st2 && st2.ref.type === 'game' && st2.ref.id === ps.topScreenId().replace(/^game:/, ''); quiet(); app._closeShareSheetForTest({ immediate: true }); loud(); return ok; },
    'locker-room': async () => { await settle(); return app.state.currentTab === 'chat' && !ps.isScreenOpen(); },
    'see-all-home': async () => { await settle(); return app.state.currentTab === 'home' && !ps.isScreenOpen(); },
    'make-picks': async () => { await settle(); return app.state.currentTab === 'picks' && !ps.isScreenOpen(); },
    'back-home': async () => { await settle(); return !ps.isScreenOpen(); },
    'open-card': async () => ps.screenDepth() === 2 && /^card:/.test(ps.topScreenId() || ''),                                       // a Related card's detail pushes ABOVE this screen
    // DI-593 / DI-596: the week's DETAIL screen (History lane) pushes ABOVE this game (Back returns to it); where the detail cannot open, the week's result card, else the week's standings
    'week-results': async () => { if (ps.screenDepth() === 2 && /^(week:|card:week\.result:)/.test(ps.topScreenId() || '')) return true; await settle(); return app.state.currentTab === 'leaderboard' && !ps.isScreenOpen(); },
    'next-picks': async () => { await settle(); return app.state.currentTab === 'picks' && !ps.isScreenOpen() && (app.state.viewingWeekId === 'w3' || app.state.viewingWeekId === null); },   // DI-599: Picks, on THAT week
    'open-gameday': async () => { await settle(); return app.state.currentTab === 'home' && !ps.isScreenOpen() && app._getHomeWiringForTest().homeView.gameDayState().expanded === true; },   // DI-606 entry (5): Home, the card open in place
    next: async () => title() !== STEP.before && ps.screenDepth() === 1,
    prev: async () => title() !== STEP.before && ps.screenDepth() === 1,
  };
  const STEP = { before: '' };
  let present = 0, tappedOk = 0;
  const failures = [], unknown = [], missingFromState = [];
  for (const [name, st] of Object.entries(STATES)) {
    st.setup(); boot(st.gid);
    const seen = [...new Set(holders().map(nameOf))];
    const want = st.expect.filter((a) => !seen.includes(a));
    if (want.length) missingFromState.push(`${name}: expected ${want.join(',')} (saw ${seen.join(',') || 'nothing'})`);
    present += seen.length;
    for (const action of seen) {
      if (!EFFECT[action]) { unknown.push(`${name}: ${action}`); continue; }
      // a fresh screen for every tap (a tap may leave the stack); for the stepper open on the game where the button is ENABLED
      st.setup(); boot(action === 'prev' ? 'g23' : st.gid);
      const node = holders().find((n) => nameOf(n) === action && !n.hasAttribute('disabled'));
      if (!node) { failures.push(`${name}: ${action} has no enabled button`); continue; }
      STEP.before = title();
      tap(node);
      let ok = false;
      try { ok = await EFFECT[action](); } catch { ok = false; }
      if (ok) tappedOk++; else failures.push(`${name}: ${action}`);
    }
  }
  assert(missingFromState.length === 0, `8a: (fixture) each state draws the buttons it exists to test${missingFromState.length ? ' — ' + missingFromState.join(' | ') : ` (${Object.keys(STATES).join(', ')})`}`);
  assert(unknown.length === 0 && present >= 12, `8b: the sweep found ${present} buttons in ${Object.keys(STATES).length} states and every action has an expectation${unknown.length ? ' (UNKNOWN: ' + unknown.join(' | ') + ')' : ''}`);
  assert(failures.length === 0 && tappedOk === present - unknown.length, `8c: B2 — every Game view button was TAPPED through onGameViewClick and did what it says (${tappedOk}/${present} ok)${failures.length ? ' — DEAD: ' + failures.join(' | ') : ''}`);
  const all = ['open-thread', 'locker-room', 'see-all-home', 'make-picks', 'back-home', 'open-card', 'prev', 'next', 'week-results', 'next-picks', 'open-gameday', 'share'];
  const reached = new Set();
  for (const st of Object.values(STATES)) st.expect.forEach((a) => reached.add(a));
  assert(all.every((a) => reached.has(a)), '8d: …and all twelve kinds (Share to chat joined with DI-597) the Game view can draw (Open thread, Locker Room, See all on Home, Make your picks, Back to Home, a Related card, Previous, Next, and What\'s next\'s See week results, Make your picks / Edit My Picks, Open Game Day) are in the sweep');
  // the Home side of the same coverage: the Final card's Results button reaches the app and lands on Standings through navigateTo (B2: the dispatcher's allow-list dropped it)
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard' }); loud();
  assert(app.state.currentTab === 'leaderboard', '8e: go-tab {tab: "leaderboard"} (the Final card\'s Results) lands on Standings through the real navigateTo');
  reset(); quiet(); window.navigateTo('home'); loud();

  // N1 (review round 3 note, the 2b model): a TAMPERED What's next button — an action the CURRENT model does not offer in this state — does nothing: no navigation, the screen stays, the viewed
  // week is untouched (Std-9: the DOM is only a request). midWeek offers only Open Game Day and no results (the week is not final); finalNextDue offers Make your picks and See week results.
  const forgedTap = async (m, setup, gid, fromAction, toAction) => {
    setup();
    try { ps.closeAllScreens('test'); } catch {}
    globalThis.document = freshDoc(); m._resetHomeWiringForTest(); m.state.currentTab = 'home'; m.state.viewingWeekId = null; globalThis.scrollY = 0;
    quiet(); m._navigateToForTest('home'); m._openGameViewForTest(gid); loud();
    const b = root() ? root().querySelector(`.ps-level:last-child [data-gv-action="${fromAction}"]`) : null;
    if (!b) return 'no ' + fromAction + ' button';
    b.setAttribute('data-gv-action', toAction);
    const before = m.state.currentTab, vw = m.state.viewingWeekId;
    quiet(); try { b.dispatchEvent({ type: 'click', target: b }); } finally { loud(); }
    await settle();
    const ok = m.state.currentTab === before && ps.isScreenOpen() && ps.screenDepth() === 1 && ps.topScreenId() === `game:${gid}` && m.state.viewingWeekId === vw;
    try { ps.closeAllScreens('test'); } catch {}
    return ok;
  };
  const probeForged = async (m) => ({
    forgedNext: await forgedTap(m, STATES.midWeek.setup, 'g24', 'open-gameday', 'next-picks'),
    forgedResults: await forgedTap(m, STATES.midWeek.setup, 'g24', 'open-gameday', 'week-results'),
    forgedGday: await forgedTap(m, STATES.finalNextDue.setup, 'g24', 'next-picks', 'open-gameday'),
  });
  const F0 = await probeForged(app);
  assert(F0.forgedNext === true, `8f: a tampered "Make your picks" (next-picks) where the model offers only Open Game Day does NOTHING: no Picks tab, the Game view stays, the viewed week untouched (${F0.forgedNext})`);
  assert(F0.forgedResults === true, `8g: a tampered "See week results" in a week that is NOT server-confirmed final does nothing (${F0.forgedResults})`);
  assert(F0.forgedGday === true, `8h: a tampered "Open Game Day" where the model offers Make your picks does nothing (${F0.forgedGday})`);
  // …and the reviewer's three surviving gap mutants (reviewer-gameday/r3/gaps.json) each turn its own case RED — scratch copies of app.js loaded as data: URLs, never the file
  {
    const base = new URL('./js/', import.meta.url).href;
    const retarget = (src) => src.replace(/(from\s+|import\s*\(\s*)'\.\/([\w./-]+)'/g, (_m, pre, f) => `${pre}'${base}${f}'`);
    const R = (a, b) => { if (APP.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return APP.replace(a, b); };
    const GAPS = [
      ['R-next: a next-picks tap is not checked against the model\'s current offer', R("if (!n || n.action !== 'next-picks' || typeof n.weekId !== 'string' || !getWeek(n.weekId)) return;", "if (!n || typeof n.weekId !== 'string') return;"), 'forgedNext'],
      ['R-results: See week results is honoured before the week is server-confirmed final', R("if (!r.results || r.results.final !== true) return;", "if (!r.results) return;"), 'forgedResults'],
      ['R-gday: an Open Game Day tap is not checked against the model\'s offer', R("if (!n || n.action !== 'open-gameday') return;", ';'), 'forgedGday'],
    ];
    for (const [name, src, check] of GAPS) {
      let res;
      try {
        quiet();
        const mod = await import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random());
        loud();
        res = await probeForged(mod);
      } catch (err) { loud(); res = { [check]: 'ERR ' + String(err.message).slice(0, 90) }; }
      assert(src !== APP && res[check] === false, `8-K: gap mutant "${name}" turns ${check} RED${typeof res[check] === 'string' ? ' (' + res[check] + ')' : ''}`);
    }
  }
  reset(); quiet(); app._navigateToForTest('home'); loud();
}

// ═══ [9] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[9] The Game view repaints IN PLACE (DI-572(a)) and speaks only a flip or a finish, only with focus inside it (DI-591 / DI-593; fix round 2)…');
{
  // (Every navigation here goes through THIS app module's own navigateTo — section [7] loaded mutant copies of app.js, and window.navigateTo belongs to the last one imported.)
  // A REAL data repaint arms the screen's repaint (P-2): the score is changed in the store, Home paints (renderHomePage — the app's own paint), its onRender hook invalidates the open screen, and the
  // shell's own 1 s debounce fires. Nothing here calls the repaint function directly.
  const LOGO = (n) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${n}.png`;
  const setupLive = () => {
    seed();
    const p1 = storage.getPlayers().find((p) => p.playerId === 'p1');
    storage.savePlayer({ ...p1, preferences: { ...(p1.preferences || {}), logoView: true } });
    storage.getGames('w2').forEach((g, i) => storage.saveGame({ ...g, homeLogo: LOGO(100 + i), awayLogo: LOGO(200 + i) }));
    for (const gid of ['g22', 'g23']) { const g = storage.getGames('w2').find((x) => x.gameId === gid); storage.saveGame({ ...g, status: 'live', homeScore: 10, awayScore: 7 }); }
    const w = storage.getWeeks().find((x) => x.weekId === 'w2'); storage.saveWeek({ ...w, status: 'live' });
  };
  const mine = () => storage.getPicks('w2', 'p1').find((p) => p.gameId === 'g22').selectedTeam;
  const g22 = () => storage.getGames('w2').find((x) => x.gameId === 'g22');
  const scoreFor = (covering) => { const g = g22(); const home = mine() === g.homeTeam; const big = 40; return covering === home ? { homeScore: big, awayScore: 0 } : { homeScore: 0, awayScore: big }; };
  const paint = async () => { quiet(); app._renderHomePageForTest(); loud(); await wait(1150); };     // a real Home paint, then the screen's own repaint debounce
  const level = () => (root() ? root().querySelectorAll('.ps-level').find((l) => l.getAttribute('data-ps-id') === 'game:g22') : null);
  const countWrites = (el) => { let n = 0; const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'innerHTML'); Object.defineProperty(el, 'innerHTML', { get() { return desc.get.call(this); }, set(v) { n++; desc.set.call(this, v); }, configurable: true }); return () => n; };

  setupLive();
  reset(); quiet(); app._navigateToForTest('home'); app._openGameViewForTest('g22'); loud();
  const lv = level(), body = lv && lv.querySelector('[data-ps-body]');
  const imgs = body ? body.querySelectorAll('.gv-score img') : [];
  assert(!!body && imgs.length === 2 && imgs.every((i) => /^https:\/\/a\.espncdn\.com\//.test(i.getAttribute('src'))), `9-0: (fixture) the Game view of a LIVE game is open with both team logos drawn (Team logos on): ${imgs.length} <img>`);
  const big = body.querySelector('[data-bind="score"]'), status = body.querySelector('[data-bind="status"]');
  const btn = body.querySelector('[data-gv-action="open-thread"]');
  btn.focus();
  body.scrollTop = 140;
  const writes = countWrites(body);
  storage.saveGame({ ...g22(), homeScore: 13, awayScore: 7 });
  await paint();
  const imgs2 = body.querySelectorAll('.gv-score img');
  assert(/13/.test(big.textContent) && writes() === 0, `9a: DI-572(a) — a score tick reached the screen through a REAL Home paint and was PATCHED, not rewritten (the score now reads "${big.textContent}"; whole-body writes: ${writes()})`);
  assert(imgs2.length === 2 && imgs2[0] === imgs[0] && imgs2[1] === imgs[1], '9b: …both logo <img>s are the SAME nodes (a tick never recreates a logo, so it never blinks)');
  assert(body.querySelector('[data-bind="score"]') === big && body.querySelector('[data-bind="status"]') === status, '9c: …the score and status parts are the same nodes, patched in place');
  assert(btn.isConnected && document.activeElement === btn && body.querySelector('[data-gv-action="open-thread"]') === btn, '9d: …focus stays on the button the reader was on (the same, still-attached node)');
  assert(body.scrollTop === 140, `9e: …and the scroll offset is untouched (${body.scrollTop})`);

  // the stepper's pair is patched too: the pressed button keeps focus; at the end of the list focus moves to the one still enabled (a disabled button cannot hold it)
  const next = root().querySelector('.ps-level:last-child [data-gv-action="next"]');
  next.focus();
  quiet(); next.dispatchEvent({ type: 'click', target: next }); loud();
  const prevBtn = root().querySelector('.ps-level:last-child [data-gv-action="prev"]');
  const nextNow = root().querySelector('.ps-level:last-child [data-gv-action="next"]');
  assert(nextNow === next && next.hasAttribute('disabled') && document.activeElement === prevBtn, `9f: the stepper's buttons are patched in place (the same nodes); Next is now disabled at the end of the live games, so focus moved to Previous (active: ${document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-gv-action')})`);
  quiet(); ps.closeAllScreens('test'); loud();

  // announcements: a cover flip, with focus inside the screen, is said once, politely, 1 s after the repaint that brought it; with focus elsewhere nothing is said
  setupLive();
  storage.saveGame({ ...g22(), ...scoreFor(true) });
  reset(); quiet(); app._navigateToForTest('home'); app._openGameViewForTest('g22'); loud();
  const lv2 = level(), live = () => (lv2 ? lv2.querySelector('[data-gv-live]') : null);
  assert(!!live() && live().getAttribute('aria-live') === 'polite' && live().getAttribute('role') === 'status' && live().textContent === '', '9g: the screen has ONE polite live region, empty, from its first paint');
  lv2.querySelector('[data-gv-action="open-thread"]').focus();
  storage.saveGame({ ...g22(), ...scoreFor(false) });
  await paint();
  const early = live().textContent;
  await wait(1050);
  assert(early === '' && /^[A-Za-z .]+ \d+, [A-Za-z .]+ \d+\. You're trailing by [\d.]+\.$/.test(live().textContent), `9h: DI-591 — the viewer's cover FLIPS while focus is inside the screen: one polite sentence about 1 s after the repaint (right after: "${early}"; then: "${live().textContent}")`);
  storage.saveGame({ ...g22(), status: 'final', ...scoreFor(true) });
  await paint();
  await wait(5200);
  assert(/^Final\. .+ covered by [\d.]+\. You covered by [\d.]+\.$|^Final\. .+\. You covered/.test(live().textContent), `9i: DI-593 — the game ENDS with focus inside: "Final. {who} covered by {n}." then the viewer's own result, after the 5 s throttle ("${live().textContent}")`);
  quiet(); ps.closeAllScreens('test'); loud();
  setupLive();
  storage.saveGame({ ...g22(), ...scoreFor(true) });
  reset(); quiet(); app._navigateToForTest('home'); app._openGameViewForTest('g22'); loud();
  const lv3 = level();
  document.body.focus();
  storage.saveGame({ ...g22(), ...scoreFor(false) });
  await paint(); await wait(1100);
  assert(lv3.querySelector('[data-gv-live]').textContent === '', '9j: …with focus OUTSIDE the screen the same flip says nothing');
  quiet(); ps.closeAllScreens('test'); loud();

  // Game Day's open-card rows draw the shared lockup with Team logos on (fix round 2, PF-446): their logo events are the app's one binder on #page-home (load -> shown, error -> the abbreviation)
  setupLive();
  reset(); quiet(); app._navigateToForTest('home'); loud();
  await wait(40);
  quiet(); app.openGameDay({}); loud();
  const page = document.getElementById('page-home');
  const rowImgs = page ? page.querySelectorAll('.gd-row .tl img') : [];
  assert(!!page && page._logoEventsWired === true && rowImgs.length >= 2, `9k: (wiring) with Team logos on the open Game Day card's rows draw logo <img>s (${rowImgs.length}) inside #page-home, whose logo events the app has bound`, `rows ${page && page.querySelectorAll('.gd-row').length} kind ${page && (page.querySelector('#gd-card') || { getAttribute: () => 'none' }).getAttribute('data-gd-kind')} expanded ${page && (page.querySelector('#gd-card') || { getAttribute: () => 'none' }).getAttribute('data-gd-expanded')}`);
  if (rowImgs.length >= 2) {
    rowImgs[0].dispatchEvent({ type: 'load', target: rowImgs[0] });
    rowImgs[1].dispatchEvent({ type: 'error', target: rowImgs[1] });
    assert(rowImgs[0].classList.contains('is-loaded') && rowImgs[1].closest('.matrix-hdr-logo-box').classList.contains('logo-broken'), '9l: …a row logo that loads is shown (is-loaded) and one that fails falls back to its abbreviation (logo-broken on its box) through that binder');
  }
  // DI-593 / DI-596: "See week results" on a Final game of a finalized week pushes the week's DETAIL screen (History lane) directly above the game, and Back returns to the game
  seed();
  reset(); quiet(); app._navigateToForTest('home'); app._openGameViewForTest('g24'); loud();
  const view = app._getHomeWiringForTest().homeView.resolveGameView('g24');
  const wr = root() ? root().querySelector('.ps-level:last-child [data-gv-action="week-results"]') : null;
  assert(!!view && !!view.results && view.results.final === true && typeof view.results.cardId === 'string' && /^week\.result:/.test(view.results.cardId) && !!wr, `9m: (fixture) a Final game of a FINALIZED week offers "See week results", backed by the week's result card (${view && view.results && view.results.cardId})`);
  if (wr) {
    quiet(); wr.dispatchEvent({ type: 'click', target: wr }); loud();
    const topId = ps.topScreenId();
    quiet(); ps.popScreen({ instant: true }); loud();
    assert(topId === 'week:w2' && ps.screenDepth() === 1 && ps.topScreenId() === 'game:g24', `9n: …the tap pushes the week's DETAIL (History lane's openWeekDetail) ABOVE the game (${topId}) and Back returns to the game (${ps.topScreenId()})`);
  }
  // …and where the detail cannot open (a week the member's Standings history does not show), the older route still works: the week's Standings
  quiet(); ps.closeAllScreens('test'); loud();
  seed(); storage.saveWeek({ ...storage.getWeek('w2'), showInHistory: false });
  reset(); quiet(); app._navigateToForTest('home'); app._openGameViewForTest('g24'); loud();
  const wr2 = root() ? root().querySelector('.ps-level:last-child [data-gv-action="week-results"]') : null;
  if (wr2) { quiet(); wr2.dispatchEvent({ type: 'click', target: wr2 }); loud(); }
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(!!wr2 && app.state.currentTab === 'leaderboard' && !ps.isScreenOpen(), `9n2: …a week hidden from Standings' history has no detail (and no result card), so "See week results" falls back to the Standings tab it always opened (${app.state.currentTab})`);
  seed();
  quiet(); ps.closeAllScreens('test'); loud();
  reset(); quiet(); app._navigateToForTest('home'); loud();
}

// ═══ [10] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[10] The game thread sheet (DI-592, consolidated Game Day round 2026-10-08): opened from the Game view through the real dispatcher…');
{
  const chatUi = await import('./js/chat-ui.js');
  const tapNode = (n) => { quiet(); try { n.dispatchEvent({ type: 'click', target: n }); } finally { loud(); } };
  const openThread = (gid) => {
    reset(); quiet(); app._navigateToForTest('home'); app._openGameViewForTest(gid); loud();
    const b = root() ? root().querySelector('.ps-level:last-child [data-gv-action="open-thread"]') : null;
    if (b) tapNode(b);
    return document.getElementById('chat-sheet-wrap');
  };
  // (a) web: the subtitle, the close, the row, no grabber, no drag
  seed();
  const wrap = openThread('g24');
  const sheet = wrap ? wrap.querySelector('#chat-thread-sheet') : null;
  const header = wrap ? wrap.querySelector('.chat-sheet-header') : null;
  assert(!!wrap && !!sheet && !!header, '10a: (fixture) "open-thread" on the Game view opens the thread sheet (#chat-thread-sheet) above it');
  const lens = wrap ? wrap.querySelector('.chat-sheet-lens') : null;
  assert(!!lens && lens.textContent.trim() === 'Also appears in the Locker Room' && !!header && header.contains(lens), '10b: the header says, permanently, "Also appears in the Locker Room"');
  assert(!!wrap && !wrap.querySelector('#chat-sheet-hint') && store.get('cfbp_chat_sheet_hint') === undefined, '10c: …the one-time hint is gone (no hint node, nothing written under cfbp_chat_sheet_hint)');
  const close = wrap ? wrap.querySelector('#chat-sheet-close') : null;
  assert(!!close && close.getAttribute('aria-label') === 'Close' && /<svg/.test(close.innerHTML) && !/✕/.test(close.textContent), '10d: the close is the icon family\'s ✕ (an svg, no ✕ character), labelled "Close"');
  const openMain = wrap ? wrap.querySelector('#chat-sheet-open-main') : null;
  assert(!!openMain && !header.contains(openMain) && !!openMain.closest('.chat-sheet-openrow') && openMain.textContent.trim() === 'Open in chat', '10e: "Open in chat" sits in its own row beneath the header, label kept');
  assert(!!wrap && !wrap.querySelector('.sheet-grabber') && header.listenerCount('touchstart') === 0, '10f: on the web there is no grabber and no drag (bindSwipeToDismiss is native-only); ✕, the backdrop and Esc close it');
  // (b) Esc closes ONLY the sheet: the Game view beneath stays (its own Esc listener sees the sheet and stands down, and the sheet closes a task later)
  const depth = ps.screenDepth();
  quiet(); document.dispatchEvent({ type: 'keydown', key: 'Escape' }); loud();
  assert(document.getElementById('chat-sheet-wrap') === wrap, '10g: Esc does not pop the sheet synchronously (every keydown listener still sees it)');
  await wait(10);
  assert(document.getElementById('chat-sheet-wrap') === null && ps.screenDepth() === depth && depth === 1 && ps.topScreenId() === 'game:g24', `10h: …a task later the sheet is closed and the Game view beneath is still open (depth ${ps.screenDepth()}, top ${ps.topScreenId()})`);
  quiet(); document.dispatchEvent({ type: 'keydown', key: 'Escape' }); loud();
  await wait(10);
  // the ✕, tapped for real: the sheet goes (its state too), the Game view stays
  const wrapX = openThread('g24');
  const xBtn = wrapX ? wrapX.querySelector('#chat-sheet-close') : null;
  if (xBtn) tapNode(xBtn);
  assert(!!xBtn && document.getElementById('chat-sheet-wrap') === null && chatUi._getChatSheetGameIdForTest() === null && ps.topScreenId() === 'game:g24', '10h-2: a real tap on the ✕ closes the sheet (and its state) and leaves the Game view');
  // (c) a modal over the sheet takes Esc first
  const wrapM = openThread('g24');
  const modal = document.createElement('div'); modal.className = 'modal-overlay'; document.body.appendChild(modal);
  quiet(); document.dispatchEvent({ type: 'keydown', key: 'Escape' }); loud();
  await wait(10);
  assert(document.getElementById('chat-sheet-wrap') === wrapM, '10i: with a modal over the sheet, Esc leaves the sheet alone');
  modal.remove();
  // (d) "Open in chat" through the real button: the sheet and the Game view close (the Back chain is recorded), the filter is this game, and the Chat tab's nav item is pressed (navToChat; this harness
  // binds no bottom nav, so the press itself is what is observed)
  const navChat = document.querySelector('.nav-item[data-tab="chat"]');
  let navPressed = 0;
  navChat?.addEventListener('click', () => { navPressed += 1; });
  tapNode(wrapM.querySelector('#chat-sheet-open-main'));
  await wait(ps.EXIT_FALLBACK_MS + 100);
  assert(document.getElementById('chat-sheet-wrap') === null && ps.screenDepth() === 0 && chatUi._getChatFilterForTest() === 'g24' && navPressed === 1, `10j: "Open in chat" closes the sheet and the Game view and opens Chat on this game's thread (depth ${ps.screenDepth()}, filter ${chatUi._getChatFilterForTest()}, nav pressed ${navPressed})`);
  chatUi._setChatFilterForTest('all');
  // (e) the empty copy says what is true for THIS game
  const sched = { status: 'scheduled', kickoff: new Date(Date.now() + 86400e3).toISOString() };
  const liveG = { status: 'live', kickoff: new Date(Date.now() - 3600e3).toISOString() };
  const finalOld = { status: 'final', kickoff: new Date(Date.now() - 30 * 86400e3).toISOString() };
  const finalNew = { status: 'final', kickoff: new Date(Date.now() - 3600e3).toISOString() };
  assert(chatUi.threadEmptyCopy(sched) === 'No messages about this game yet.' && chatUi.threadEmptyCopy(liveG) === 'No messages about this game yet.', '10k: upcoming or live: "No messages about this game yet."');
  assert(chatUi.threadEmptyCopy(finalOld) === 'No one talked about this game.', '10l: final, retention off: "No one talked about this game."');
  storage.saveSettings({ ...storage.getSettings(), chatRetentionDays: 7 });
  assert(chatUi.threadEmptyCopy(finalOld) === "Older messages are hidden by this league's chat retention." && chatUi.threadEmptyCopy(finalNew) === 'No one talked about this game.', '10m: retention on: a game that kicked off before the cutoff says the messages are hidden; a newer one does not');
  seed();
  const wrapE = openThread('g24');
  const empty = wrapE ? wrapE.querySelector('#chat-sheet-scroll .chat-empty') : null;
  assert(!!empty && empty.textContent === 'No one talked about this game.', `10n: the sheet draws it (a final game with no messages: "${empty ? empty.textContent : '(none)'}")`);
  quiet(); chatUi.resetGameChatSheetForTeardown(); loud();
  // (f) native: the grabber and the drag-down (the wizard sheet's recipe)
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  const drag = (h, to) => { h.dispatchEvent({ type: 'touchstart', touches: [{ clientX: 100, clientY: 0 }] }); h.dispatchEvent({ type: 'touchmove', touches: [{ clientX: 100, clientY: 20 }] }); h.dispatchEvent({ type: 'touchmove', touches: [{ clientX: 100, clientY: to }] }); h.dispatchEvent({ type: 'touchend', touches: [] }); };
  try {
    seed();
    const wN = openThread('g24');
    const hN = wN ? wN.querySelector('.chat-sheet-header') : null;
    const sN = wN ? wN.querySelector('#chat-thread-sheet') : null;
    assert(!!wN && !!wN.querySelector('.chat-sheet-header .sheet-grabber') && hN.listenerCount('touchstart') === 1, '10o: native: a grabber in the header and the drag bound on the header (only there, so the message list keeps its own scroll)');
    quiet(); drag(hN, 640); loud();                                   // 640 / 800 = 80%
    assert(wN.style['--thread-drag-y'] === '1' && document.getElementById('chat-sheet-wrap') === wN, '10p: past the threshold the sheet plays the rest of the slide (offset 1) and is still there mid-slide (never pops)');
    // P-3: a NEW touch during the slide-out (a tap on the fading backdrop) is the same idempotent close; the late transitionend after it does nothing
    const bd = wN.querySelector('.chat-sheet-backdrop');
    let threw = false;
    try { quiet(); if (bd) tapNode(bd); sN.dispatchEvent({ type: 'transitionend', target: sN }); } catch { threw = true; } finally { loud(); }
    assert(!threw && document.getElementById('chat-sheet-wrap') === null && chatUi._getChatSheetGameIdForTest() === null && ps.topScreenId() === 'game:g24', '10q: P-3 — a tap on the backdrop DURING the slide-out closes it at once, the late transitionend is harmless, the sheet and its state are gone and the Game view beneath stays');
    const wS = openThread('g24');
    const hS = wS.querySelector('.chat-sheet-header');
    quiet();
    hS.dispatchEvent({ type: 'touchstart', touches: [{ clientX: 100, clientY: 0 }] });
    hS.dispatchEvent({ type: 'touchmove', touches: [{ clientX: 100, clientY: 20 }] });
    await wait(400);
    hS.dispatchEvent({ type: 'touchmove', touches: [{ clientX: 100, clientY: 60 }] });
    await wait(50);
    hS.dispatchEvent({ type: 'touchend', touches: [] });
    loud();
    assert(document.getElementById('chat-sheet-wrap') === wS && wS.style['--thread-drag-y'] === '0', '10r: a short, slow drag springs back (offset 0) and the sheet stays');
    const m2 = document.createElement('div'); m2.className = 'modal-overlay'; document.body.appendChild(m2);
    quiet(); drag(hS, 640); loud();
    assert(document.getElementById('chat-sheet-wrap') === wS, '10s: with a modal over it, the drag never dismisses the sheet');
    m2.remove();
    globalThis.matchMedia = (q) => ({ matches: /reduce/.test(String(q)) });
    quiet(); drag(hS, 640); loud();
    assert(document.getElementById('chat-sheet-wrap') === null, '10t: under Reduce Motion a dismissed sheet is removed at once (no slide to wait for)');
  } finally {
    globalThis.matchMedia = () => ({ matches: false });
    delete globalThis.Capacitor;
    quiet(); try { chatUi.resetGameChatSheetForTeardown(); ps.closeAllScreens('test'); } catch {} loud();
  }
  reset(); quiet(); app._navigateToForTest('home'); loud();
}

_log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
