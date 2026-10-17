/**
 * CFB Pickems — logofailtest.mjs (Deployment 1, Lane B, the batch L follow-up to FB-024, 2026-10-07)
 * ==================================================================================================
 * The reviewer's note on FB-024: Live Peek and Home remember the logos they LOADED (so a repaint never blanks one), but a logo file that FAILED was asked for again on every repaint — every score
 * tick, news arrival and pull-to-refresh built a new <img>, hit the network again, flashed opacity 0 and then fell back to the name. Now the default file's failure is remembered for the page's life
 * and the emit side writes no `src` for it.
 *
 *   [1] The error arm remembers a failed DEFAULT file — and only that (not a missing dark file, not offline, not a non-logo image, not past the cap)
 *   [2] The emit side: no `src` (so no request) for a known-failed file; byte-identical markup for every other file
 *   [3] The repaint step: a `data-logo-failed` <img> gets the SAME fallback the error arm gives, once, with no network
 *   [4] The REAL Home: the Live Peek chip's logo fails once; every later repaint requests nothing and shows the label
 *   [5] What it must never do: touch parse-time logoOk() (a stored game logo), persist anything, survive a page
 *   [6] Source pins, and MUTATION PROOFS on a scratch copy of app.js
 *
 * NOT COVERED HERE (a device): whether WKWebView's image loader really issues no request for an <img> with no src; the 150 ms label swap's feel.
 *
 * Run:  node logofailtest.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const assert = (cond, label) => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } };
const read = (rel) => readFile(path.join(root, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
try { globalThis.navigator = { serviceWorker: undefined, onLine: true, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, onLine: true }, configurable: true }); }
const setOnline = (v) => { try { globalThis.navigator.onLine = v; } catch { Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true }); } };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.fetch = async () => { throw new Error('network disabled in logofailtest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollY = 0;
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const { MiniDocument, MiniElement } = await import('./minidom.mjs');
const INDEX_HTML = await read('index.html');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); doc.body.innerHTML = bodyHtmlOf(INDEX_HTML); return doc; };
if (typeof MiniElement.prototype.insertAdjacentHTML !== 'function') {
  MiniElement.prototype.insertAdjacentHTML = function (pos, html) {
    const t = this.ownerDocument.createElement('div'); t.innerHTML = html;
    const kids = [...t._children]; t._children = [];
    if (pos === 'afterbegin') { for (const k of kids.reverse()) { k.parentNode = this; this._children.unshift(k); } }
    else { for (const k of kids) { k.parentNode = this; this._children.push(k); } }
  };
}
globalThis.document = freshDoc();

const quietLogs = async (fn) => { const w = console.warn, i = console.info, e = console.error; console.warn = console.info = console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; console.error = e; } };
const dp = await import('./js/data-provider.js');
const app = await quietLogs(() => import('./js/app.js'));
const storage = await import('./js/storage.js');
const V = app._logoVariantForTest;
const bind = app._bindLogoImageEventsForTest;
const APP_SRC = await read('js/app.js');

const URL_A = 'https://a.espncdn.com/i/teamlogos/ncaa/500/245.png';
const URL_B = 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png';
const reset = () => { V.failedLogoUrls.clear(); V.failedDarkLogoUrls.clear(); V.loadedLogoUrls.clear(); setOnline(true); };

// ── a MutationObserver stand-in with the browser's delivery timing (minidom has none), as logovarianttest [9] does ──
const observers = [];
globalThis.MutationObserver = class FakeMutationObserver {
  constructor(cb) { this.cb = cb; this.targets = []; }
  observe(target, opts) { this.targets.push({ target, opts: opts || {} }); if (!observers.includes(this)) observers.push(this); }
  disconnect() { this.targets = []; const i = observers.indexOf(this); if (i >= 0) observers.splice(i, 1); }
  takeRecords() { return []; }
};
{
  const ihDesc = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'innerHTML');
  Object.defineProperty(MiniElement.prototype, 'innerHTML', {
    configurable: true, get: ihDesc.get,
    set(html) {
      const removedNodes = [...this._children];
      ihDesc.set.call(this, html);
      const addedNodes = [...this._children];
      for (const o of observers) for (const { target, opts } of o.targets) {
        if (opts.childList && (target === this || (opts.subtree && typeof target.contains === 'function' && target.contains(this)))) { const rec = { type: 'childList', target: this, addedNodes, removedNodes }; queueMicrotask(() => o.cb([rec], o)); }
      }
    },
  });
}
const microtasks = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

// a fake <img> / container for the unit cases
const fakeImg = (cls, src, wrapSel = null) => {
  const added = [], wrapAdded = [];
  const img = {
    classList: { added, contains: (c) => c === cls, add(c) { added.push(c); } }, dataset: {}, _src: src, style: {}, wrapAdded,
    getAttribute(n) { return n === 'src' ? this._src : null; }, setAttribute(n, v) { if (n === 'src') this._src = v; }, hasAttribute() { return false; },
    closest: (sel) => (wrapSel && sel === wrapSel ? { classList: { add: (c) => wrapAdded.push(c) } } : null), parentElement: null,
  };
  return img;
};
const handlers = {};
bind({ addEventListener(type, fn) { handlers[type] = fn; } });

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The error arm remembers a failed default file — and only that…');
{
  reset();
  assert(V.failedLogoUrls instanceof Set && typeof V.isKnownFailedLogo === 'function' && typeof V.logoSrcAttr === 'function' && typeof V.applyKnownFailedLogo === 'function' && typeof V.markLogoBroken === 'function', '1-0: (fixture) the seam exposes the failed-logo set and its four functions');
  for (const [cls, wrap] of [['pick-btn-logo', '.pick-btn-logo-wrap'], ['dc-chip-logo', '.dc-chip-pick'], ['matrix-hdr-logo', '.matrix-hdr-logo-box']]) {
    reset();
    const img = fakeImg(cls, URL_A, wrap);
    handlers.error({ target: img });
    assert(V.failedLogoUrls.has(URL_A) && img.wrapAdded.includes('logo-broken'), `1-1 ${cls}: a failed default file is remembered AND still reaches its .logo-broken fallback`);
  }
  reset();
  const slate = fakeImg('slate-row-logo', URL_A);
  handlers.error({ target: slate });
  assert(V.failedLogoUrls.has(URL_A) && slate.style.display === 'none', '1-2: slate-row-logo: remembered, and the broken-image glyph is hidden');
  // a dark file that 404s reverts to the stored default and is NOT remembered as a failed default
  reset();
  const dark = fakeImg('pick-btn-logo', dp.darkLogoUrl(URL_A), '.pick-btn-logo-wrap');
  dark.dataset.logoVariant = 'dark'; dark.dataset.logoDefault = URL_A;
  handlers.error({ target: dark });
  assert(!V.failedLogoUrls.has(URL_A) && !V.failedLogoUrls.has(dp.darkLogoUrl(URL_A)) && V.failedDarkLogoUrls.has(dp.darkLogoUrl(URL_A)) && dark._src === URL_A && dark.wrapAdded.length === 0,
    '1-3: a missing DARK file is the dark set\'s business (reverts to the stored default, no fallback) — the default file is not marked failed');
  // offline is not "broken"
  reset(); setOnline(false);
  const off = fakeImg('dc-chip-logo', URL_A, '.dc-chip-pick');
  handlers.error({ target: off });
  assert(V.failedLogoUrls.size === 0 && off.wrapAdded.includes('logo-broken'), '1-4: while offline every logo fails, so none is remembered as broken — but the fallback still shows');
  reset();
  // not a team logo
  const other = fakeImg('news-card__image', URL_A);
  handlers.error({ target: other });
  assert(V.failedLogoUrls.size === 0, '1-5: an <img> that is not one of the four team-logo classes is never remembered');
  assert(V.FAILED_LOGO_CAP === 400, '1-6: the set is capped at 400 URLs');
  for (let i = 0; i < 450; i++) handlers.error({ target: fakeImg('dc-chip-logo', `https://a.espncdn.com/i/teamlogos/ncaa/500/${1000 + i}.png`, '.dc-chip-pick') });
  assert(V.failedLogoUrls.size === 400, `1-7: …and a flood of failures cannot grow it past the cap (${V.failedLogoUrls.size})`);
  reset();
  // an error with no target / a detached target never throws
  let threw = false;
  try { handlers.error({ target: null }); handlers.error({ target: {} }); handlers.error({}); } catch { threw = true; }
  assert(!threw && V.failedLogoUrls.size === 0, '1-8: an error event with no usable target is harmless');
  // the file that failed is forgotten as "loaded"
  V.loadedLogoUrls.add(URL_A);
  handlers.error({ target: fakeImg('dc-chip-logo', URL_A, '.dc-chip-pick') });
  assert(!V.loadedLogoUrls.has(URL_A) && V.failedLogoUrls.has(URL_A), '1-9: FB-024 still holds: a file that errors is no longer "loaded" (and is now "failed")');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] The emit side — no src, no request…');
{
  reset();
  const ok = app._pickButtonContentHTMLForTest('Texas A&M', URL_A, true, false);
  const expectOk = `<span class="pick-btn-logo-wrap">
    <span class="pick-btn-logo-box"><img class="pick-btn-logo" src="${URL_A}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
    <span class="pick-btn-logo-name">Texas A&amp;M</span>
  </span>`;
  assert(ok === expectOk, '2-1: BYTE-IDENTICAL — with nothing failed, the pick button\'s logo markup is exactly what shipped (class, src, alt, loading, referrerpolicy, in that order)');
  const slateOk = app._slateRowLogoHTMLForTest(URL_A, false, true);
  assert(slateOk === `<img class="slate-row-logo" src="${URL_A}" alt="" loading="lazy" referrerpolicy="no-referrer">`, '2-2: …and so is the Games-tab slate row\'s');
  V.failedLogoUrls.add(URL_A);
  const bad = app._pickButtonContentHTMLForTest('Texas A&M', URL_A, true, false);
  assert(!/\bsrc=/.test(bad) && /data-logo-failed="1"/.test(bad) && /class="pick-btn-logo"/.test(bad) && /Texas A&amp;M/.test(bad) && /alt=""/.test(bad) && /referrerpolicy="no-referrer"/.test(bad),
    '2-3: a known-failed file is emitted with NO src (nothing to request), marked data-logo-failed, with the same class, empty alt, referrer policy and the team name beside it');
  const good = app._pickButtonContentHTMLForTest('Texas', URL_B, true, false);
  assert(/src="https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500\/251\.png"/.test(good) && !/data-logo-failed/.test(good), '2-4: a DIFFERENT file is unaffected — the memory is per URL, not per surface');
  const slateBad = app._slateRowLogoHTMLForTest(URL_A, false, true);
  assert(!/\bsrc=/.test(slateBad) && /data-logo-failed="1"/.test(slateBad), '2-5: the same one template serves the Games-tab row');
  assert(app._pickButtonContentHTMLForTest('Texas', URL_A, false, false) === 'Texas' && app._slateRowLogoHTMLForTest(URL_A, false, false) === '', '2-6: with Team logos OFF nothing changes at all (no <img>, failed or not)');
  assert(V.logoSrcAttr('https://a.espncdn.com/x.png"><script>') === 'src="https://a.espncdn.com/x.png&quot;&gt;&lt;script&gt;"', '2-7: a URL that is NOT remembered is still escaped at the sink (quote and angle brackets)');
  assert(V.isKnownFailedLogo(null) === false && V.isKnownFailedLogo(undefined) === false && V.isKnownFailedLogo(5) === false && V.isKnownFailedLogo('') === false, '2-8: non-strings are never "known failed"');
  reset();
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The repaint step — the same fallback, once, with no request…');
{
  reset();
  const doc = globalThis.document;
  const host = doc.createElement('div'); doc.body.appendChild(host);
  const html = `<span class="pick-btn-logo-wrap"><span class="pick-btn-logo-box"><img class="pick-btn-logo" data-logo-failed="1" alt="" referrerpolicy="no-referrer"></span><span class="pick-btn-logo-name">Texas</span></span>`
    + `<span class="dc-chip-pick"><img class="dc-chip-logo" data-logo-failed="1" alt="Texas"><span class="dc-chip-pick-fallback">TEX</span></span>`
    + `<span class="matrix-hdr-logo-box"><img class="matrix-hdr-logo" data-logo-failed="1" alt=""></span>`
    + `<img class="slate-row-logo" data-logo-failed="1" alt="">`;
  host.innerHTML = html;
  assert(V.primeLoadedLogosIn(host) === 0, '3-1: with NOTHING remembered (no loaded, no failed file) the repaint step is inert');
  V.failedLogoUrls.add(URL_A);
  host.innerHTML = html;
  const n = V.primeLoadedLogosIn(host);
  const wrap = host.querySelector('.pick-btn-logo-wrap'), chip = host.querySelector('.dc-chip-pick'), box = host.querySelector('.matrix-hdr-logo-box'), slate = host.querySelector('.slate-row-logo');
  assert(n === 4 && wrap.classList.contains('logo-broken') && chip.classList.contains('logo-broken') && box.classList.contains('logo-broken') && slate.style.display === 'none',
    `3-2: with a failed file remembered, every marked <img> gets its class's error-arm fallback (${n} of 4) — through ONE function (markLogoBroken), not a second copy of the arms`);
  assert(host.querySelectorAll('img').every((i) => i.dataset.logoFailedApplied === '1') && V.primeLoadedLogosIn(host) === 0, '3-3: …once: a second pass changes nothing');
  // an <img> that is not marked is left to the load path
  host.innerHTML = `<span class="pick-btn-logo-wrap"><img class="pick-btn-logo" src="${URL_B}" alt=""></span>`;
  V.primeLoadedLogosIn(host);
  assert(!host.querySelector('.pick-btn-logo-wrap').classList.contains('logo-broken'), '3-4: an <img> with a real src is never marked broken by this step (it waits for its own load or error)');
  // a foreign marker on a non-logo image does nothing
  host.innerHTML = `<span class="x"><img class="news-card__image" data-logo-failed="1" alt=""></span>`;
  V.primeLoadedLogosIn(host);
  assert(!host.querySelector('.x').classList.contains('logo-broken'), '3-5: data-logo-failed on a non-logo <img> does nothing');
  // through the observer on a bound container
  const bound = doc.createElement('div'); doc.body.appendChild(bound);
  bind(bound);
  bound.innerHTML = html;
  await microtasks();
  assert(bound.querySelector('.pick-btn-logo-wrap').classList.contains('logo-broken') && bound.querySelector('.dc-chip-pick').classList.contains('logo-broken'),
    '3-6: on a bound container the repaint is picked up by the same observer FB-024 uses (before the next frame): the fallback is applied with no event from the network');
  reset();
  bound.innerHTML = html;
  await microtasks();
  assert(!bound.querySelector('.pick-btn-logo-wrap').classList.contains('logo-broken'), '3-7: after the memory is cleared (a new page) the same markup is left alone');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
// D1 Lane B (Game Day, 2026-10-08): the Live Peek is retired (Home's Now card is the Game Day card, which paints no team logo). The one place Home now paints team logos is the GAME VIEW (the pushed screen a
// Game Day row opens: two `.matrix-hdr-logo` lockups, mounted in #pushed-root, whose onMount binds the same binder), so the real-Home fixture below opens the Game view of the seeded game from Home's own
// `open-game` action instead of reading the Live Peek chip; the assertions are the same ones (a failed file is remembered, a repaint asks for nothing, a different file is requested normally).
console.log('\n[4] The REAL Home: the Game view\'s team lockups…');
{
  const KICKED = new Date(Date.now() - 3600e3).toISOString();
  const seedPeek = ({ logoView = true, homeScore = 14 } = {}) => {
    store.clear();
    storage.savePlayer({ playerId: 'lf_me', displayName: 'Peek Viewer', active: true, preferences: { logoView } });
    storage.saveWeek({ weekId: 'lf_w', weekNumber: 1, season: 2026, name: 'Week 1', status: 'live', dataSourceMode: 'live' });
    storage.saveGame({ gameId: 'lf_g', weekId: 'lf_w', homeTeam: 'Texas A&M', awayTeam: 'Texas', homeLogo: URL_A, awayLogo: URL_B, status: 'live', homeScore, awayScore: 7, spread: -3, lockedSpread: -3, favorite: 'Texas A&M', multiplier: 1, kickoff: KICKED, isManual: false });
    storage.saveAllPicks([{ weekId: 'lf_w', gameId: 'lf_g', playerId: 'lf_me', selectedTeam: 'Texas A&M' }]);
    storage.setSession('lf_me', false, true);
  };
  const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const ps = await import('./js/pushed-screen.js');
  const openGv = () => { try { ps.closeAllScreens('test'); } catch { /* none open */ } app.state.currentTab = 'home'; app._renderHomePageForTest(); app._onHomeActionForTest('open-game', { gameId: 'lf_g' }); };
  const paint = () => quietLogs(async () => { openGv(); await settle(); });
  const paintNow = async () => { const w = console.warn, i = console.info, e = console.error; console.warn = console.info = console.error = () => {}; try { openGv(); } finally { console.warn = w; console.info = i; console.error = e; } await microtasks(); };
  const peek = () => [...globalThis.document.querySelectorAll('#pushed-root img.matrix-hdr-logo')];
  const peekA = () => peek().filter((i) => i.getAttribute('src') === URL_A || i.hasAttribute('data-logo-failed'));
  const fire = (img, type) => img.dispatchEvent({ type, bubbles: true });
  reset();
  globalThis.document = freshDoc(); app._resetHomeWiringForTest(); seedPeek();
  await paint();
  const first = peek().find((i) => i.getAttribute('src') === URL_A);
  assert(!!first && peek().length === 2 && !first.hasAttribute('data-logo-failed'), '4-1: (fixture) the first Game-view paint asks for both teams\' logos (a real src each)');
  const lockupText = () => [...globalThis.document.querySelectorAll('#pushed-root .tl-abbr')].map((n) => n.textContent.trim()).join('/');
  const offText = await (async () => { globalThis.document = freshDoc(); app._resetHomeWiringForTest(); seedPeek({ logoView: false }); await paint(); return lockupText(); })();
  reset();
  globalThis.document = freshDoc(); app._resetHomeWiringForTest(); seedPeek();
  await paint();
  const broken = peek().find((i) => i.getAttribute('src') === URL_A);
  fire(broken, 'error');
  assert(V.failedLogoUrls.has(URL_A) && broken.closest('.matrix-hdr-logo-box').classList.contains('logo-broken'), '4-2: the logo fails once: the file is remembered and the lockup shows its label (as before)');
  // a score tick: Home repaints, the chip is a NEW element
  seedPeek({ homeScore: 21 });
  await paintNow();
  assert(peek().length === 1 && !peek().some((i) => i.getAttribute('src') === URL_A) && !globalThis.document.querySelector('#pushed-root [data-logo-failed]'), '4-3: THE FIX — the repaint asks for nothing: the Game view paints NO <img> for the file that already failed (its src is never written), and the team that has a good file still has its logo');
  assert(lockupText() === offText && offText.length > 0, `4-4: …and the lockup already shows exactly the label it shows without logos ("${offText}") by the time the frame paints — no flash of an empty logo box`);
  seedPeek({ homeScore: 28 });
  await paintNow();
  assert(peek().length === 1 && !peek().some((i) => i.getAttribute('src') === URL_A) && lockupText() === offText, '4-5: every later repaint is the same: still no <img> for the failed file, still the label');
  // pull-to-refresh path = the same renderer; a different file on the same chip is requested normally
  storage.saveGame({ gameId: 'lf_g', weekId: 'lf_w', homeTeam: 'Texas A&M', awayTeam: 'Texas', homeLogo: URL_B, awayLogo: URL_A, status: 'live', homeScore: 28, awayScore: 7, spread: -3, lockedSpread: -3, favorite: 'Texas A&M', multiplier: 1, kickoff: KICKED, isManual: false });
  await paintNow();
  const other = peek().find((i) => i.getAttribute('src') === URL_B);
  assert(!!other && !other.hasAttribute('data-logo-failed'), '4-6: a different logo file on the same chip is requested normally (only the exact failed URL is skipped)');
  // a fresh page (the memory is in-process only)
  reset();
  seedPeek();
  await paintNow();
  assert(peek().some((i) => i.getAttribute('src') === URL_A), '4-7: with the memory gone (a new page load) the file is tried again — nothing is persisted');
  reset();
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] What it must never do…');
{
  reset();
  V.failedLogoUrls.add(URL_A);
  assert(dp.logoOk(URL_A) === URL_A, '5-1: parse-time logoOk() (the value STORED on a game) is untouched — a transient client-side failure can never null a logo that is saved with the game');
  const code = stripComments(APP_SRC);
  assert(!/localStorage|sessionStorage|save\(/.test((code.match(/const _failedLogoUrls[\s\S]*?function applyKnownFailedLogo[\s\S]*?\n\}\n/) || [''])[0]), '5-2: the failed-URL block touches no storage of any kind (memory only)');
  assert(!/_failedLogoUrls/.test((code.match(/function parseAndReport[\s\S]*?\n\}\n/) || [''])[0]) && !/_failedLogoUrls|isKnownFailedLogo/.test(await read('js/data-provider.js')), '5-3: data-provider.js (the ESPN parse that stores logos) does not know the memory exists');
  reset();
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Source pins and MUTATION PROOFS…');
{
  const code = stripComments(APP_SRC);
  const bindFn = (code.match(/function bindLogoImageEvents\([\s\S]*?\n\}\n/) || [''])[0];
  assert(/addEventListener\('error', e => \{\s*const img = e\.target; forgetLoadedLogo\(img\); if \(revertDarkLogo\(img\)\) return;\s*rememberFailedLogo\(img\);\s*markLogoBroken\(img\);/.test(bindFn),
    '6-1: the error listener, in order: forget the loaded mark, revert a dark file (and stop), REMEMBER the failed default, then the fallback arm');
  assert(/function teamLogoImgHTML\([^)]*\) \{\s*return `<img class="\$\{escHtml\(cssClass\)\}" \$\{logoSrcAttr\(url\)\} alt=""/.test(code), '6-2: the one <img> template writes its src only through logoSrcAttr()');
  // D1 Lane B (DI-612, 2026-10-08): the Dashboard's member chip (the compact row's pick chip, which the Live Peek reused until Game Day replaced it) moved VERBATIM into js/pick-chips.js's
  // gamePickChipsHTML, and it still writes its src ONLY through the injected logoSrcAttr (the app's, which asks the failed-logo memory). The <img> templates are pinned across both files.
  const chipsCode = stripComments(await read('js/pick-chips.js'));
  assert(/<img class="dc-chip-logo" \$\{logoSrcAttr\(pickLogoUrl\)\} alt=/.test(chipsCode) , '6-3: …and so does the Dashboard pick chip (now in js/pick-chips.js)');
  assert((code.match(/<img\b/g) || []).length === 1 && (chipsCode.match(/<img\b/g) || []).length === 1, '6-4: there are still exactly two <img> templates (the shared one in app.js and the chip in js/pick-chips.js) — no third path that could bypass the memory');
  const observe = (code.match(/function observeLogoRepaints[\s\S]*?\n\}\n/) || [''])[0];
  assert(/if \(!_loadedLogoUrls\.size && !_failedLogoUrls\.size\) return;/.test(observe) && /if \(!root \|\| \(!_loadedLogoUrls\.size && !_failedLogoUrls\.size\)\) return 0;/.test(code), '6-5: the repaint observer and primer run when EITHER memory has something (the failed set alone is enough)');

  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace(/(from\s+|import\s*\(\s*)'\.\/([\w./-]+)'/g, (_m, pre, f) => `${pre}'${base}${f}'`);
  const R = (a, b) => { if (APP_SRC.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return APP_SRC.replace(a, b); };
  const mutants = [
    ['the error arm no longer remembers the failure', R('    rememberFailedLogo(img);   // D1 (batch L follow-up)', '    // (mutant)   // D1 (batch L follow-up)'), 'remembered'],
    ['the emit side ignores the memory', R("function logoSrcAttr(url) { return isKnownFailedLogo(url) ? 'data-logo-failed=\"1\"' : `src=\"${escHtml(url)}\"`; }", 'function logoSrcAttr(url) { return `src="${escHtml(url)}"`; }'), 'noSrc'],
    ['the repaint step never applies the fallback', R("if (!isTeamLogoImg(img) || typeof img.hasAttribute !== 'function' || !img.hasAttribute('data-logo-failed') || img.dataset?.logoFailedApplied) return false;", 'return false;'), 'applied'],
    ['offline failures are remembered too', R("if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return;   // offline: every logo fails; none of them is broken", ''), 'offline'],
    ['the set has no cap', R('if (u && _failedLogoUrls.size < FAILED_LOGO_CAP) _failedLogoUrls.add(u);', 'if (u) _failedLogoUrls.add(u);'), 'cap'],
    ['a missing dark file marks the default as failed too', R('const img = e.target; forgetLoadedLogo(img); if (revertDarkLogo(img)) return;', 'const img = e.target; forgetLoadedLogo(img); rememberFailedLogo(img); if (revertDarkLogo(img)) return;'), 'darkNotDefault'],
    ['the observer ignores a repaint when only failures are remembered', R('      if (!_loadedLogoUrls.size && !_failedLogoUrls.size) return;', '      if (!_loadedLogoUrls.size) return;'), 'observer'],
  ];
  const probe = async (mod) => {
    const M = mod._logoVariantForTest, B = mod._bindLogoImageEventsForTest;
    const o = {};
    const resetM = () => { M.failedLogoUrls.clear(); M.failedDarkLogoUrls.clear(); M.loadedLogoUrls.clear(); setOnline(true); };
    const h = {}; B({ addEventListener(t, fn) { h[t] = fn; } });
    resetM();
    h.error({ target: fakeImg('dc-chip-logo', URL_A, '.dc-chip-pick') });
    o.remembered = M.failedLogoUrls.has(URL_A);
    o.noSrc = !/\bsrc=/.test(mod._pickButtonContentHTMLForTest('T', URL_A, true, false));
    resetM(); M.failedLogoUrls.add(URL_A);
    const host = globalThis.document.createElement('div'); globalThis.document.body.appendChild(host);
    host.innerHTML = `<span class="dc-chip-pick"><img class="dc-chip-logo" data-logo-failed="1" alt=""></span>`;
    M.primeLoadedLogosIn(host);
    o.applied = host.querySelector('.dc-chip-pick').classList.contains('logo-broken');
    resetM(); setOnline(false);
    h.error({ target: fakeImg('dc-chip-logo', URL_A, '.dc-chip-pick') });
    o.offline = M.failedLogoUrls.size === 0; setOnline(true);
    resetM();
    for (let i = 0; i < 450; i++) h.error({ target: fakeImg('dc-chip-logo', `https://a.espncdn.com/i/teamlogos/ncaa/500/${2000 + i}.png`, '.dc-chip-pick') });
    o.cap = M.failedLogoUrls.size === M.FAILED_LOGO_CAP;
    resetM();
    const dk = fakeImg('pick-btn-logo', dp.darkLogoUrl(URL_A), '.pick-btn-logo-wrap'); dk.dataset.logoVariant = 'dark'; dk.dataset.logoDefault = URL_A;
    h.error({ target: dk });
    o.darkNotDefault = !M.failedLogoUrls.has(URL_A);
    resetM(); M.failedLogoUrls.add(URL_A);
    const bnd = globalThis.document.createElement('div'); globalThis.document.body.appendChild(bnd);
    B(bnd);
    bnd.innerHTML = `<span class="dc-chip-pick"><img class="dc-chip-logo" data-logo-failed="1" alt=""></span>`;
    await microtasks();
    o.observer = bnd.querySelector('.dc-chip-pick').classList.contains('logo-broken');
    resetM();
    return o;
  };
  const baseRes = await probe(app);
  assert(Object.values(baseRes).every(Boolean), `6-0: the probe is GREEN on the real app.js (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  for (const [name, src, check] of mutants) {
    let res;
    try {
      const mod = await quietLogs(() => import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random()));
      res = await probe(mod);
    } catch (err) { res = { [check]: 'ERR ' + String(err.message).slice(0, 90) }; }
    assert(src !== APP_SRC && res[check] === false, `6: mutant "${name}" turns ${check} RED${typeof res[check] === 'string' ? ' (' + res[check] + ')' : ''}`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
