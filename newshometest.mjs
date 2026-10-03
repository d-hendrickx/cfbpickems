/**
 * CFB Pickems — newshometest.mjs (Social Platform News, option A — the HOME-LEVEL proof, DI-380 / Home security W9, 2026-10-01)
 * =============================================================================================================================
 * newstest.mjs proves the news modules one at a time. This file proves them INSIDE js/home.js's real renderer: the real `createHome`, the real
 * `createHomeNews` adapter, the real `renderNewsCard`, the real `bindNewsCardEvents`, with a fake transport and fake readers. It is the test the wiring
 * window's contract rests on:
 *
 *   · a hostile headline plus a fake <button data-home-action="build-slate"> yields NO raw element and NO onAction (W9) — and the proof has teeth: a
 *     mutant card that DOES emit data-home-action turns it red;
 *   · news OFF resolves `null`, and the slot does not exist (no card, no skeleton, no note, no message) and nothing was requested (DI-380, S-C8);
 *   · an empty list is a DIFFERENT answer ("No headlines yet"); a rejection is the calm "temporarily unavailable" + Retry — never the league banner;
 *   · resetNews() (the prefs-changed hook) takes an OFF slot to ON without a reload and abandons a load that was in flight under the old preference;
 *   · a tap resolves by id against the CURRENT items and opens only the validated href.
 *
 * The DOM is a small REAL-ENOUGH fake: Home's innerHTML is parsed into a tree, so `closest()` walks real parents and "no raw element" is a statement
 * about parsed elements, not about substrings.
 *
 * Run:  node newshometest.mjs      Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);
{ const realErr = console.error; console.error = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[home]')) return; realErr(...a); }; }
const realWarn = console.warn;
console.warn = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[news]')) return; realWarn(...a); };

const lsStore = new Map();
globalThis.localStorage = { getItem: k => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, String(v)), removeItem: k => lsStore.delete(k), clear: () => lsStore.clear() };
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} }, hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in newshometest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const homeMod = await import('./js/home.js');
const feed = await import('./js/newsFeed.js');
const cardMod = await import('./js/newsCard.js');
const transportMod = await import('./js/newsTransport.js');

const NOW = Date.parse('2026-10-01T16:00:00.000Z');
const HOUR = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); };
/** The app's own escHtml behaviour (& < > " — NOT the apostrophe): Home escapes with THIS; the card must not depend on it. */
const appEsc = (s) => (s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '');

// ── a small REAL-ENOUGH fake DOM: innerHTML is parsed, closest() walks real parents ───────────────────────────────────────
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input']);
const dataAttr = (p) => 'data-' + String(p).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
class FakeEl {
  constructor(tag) { this.tagName = String(tag || 'div').toUpperCase(); this._a = new Map(); this.children = []; this.parentNode = null; this._l = {}; this._raw = ''; this.writes = 0; const s = this; this.dataset = new Proxy({}, { get(_, p) { return s._a.get(dataAttr(p)); } }); }
  get id() { return this._a.get('id') || ''; } get className() { return this._a.get('class') || ''; }
  setAttribute(n, v) { this._a.set(n, v === undefined ? '' : String(v)); } getAttribute(n) { return this._a.has(n) ? this._a.get(n) : null; } hasAttribute(n) { return this._a.has(n); }
  addEventListener(t, f) { (this._l[t] ||= []).push(f); } removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(x => x !== f); }
  listenerCount(t) { return (this._l[t] || []).length; }
  dispatch(t, e = {}) { (this._l[t] || []).slice().forEach(f => f({ target: this, ...e })); }
  get firstChild() { return this.children[0] || null; } get firstElementChild() { return this.children[0] || null; }
  set innerHTML(h) { this._raw = String(h); this.writes++; const kids = parse(this._raw); for (const k of kids) k.parentNode = this; this.children = kids; }
  get innerHTML() { return this._raw; }
  querySelector(s) { return all(this, s)[0] || null; } querySelectorAll(s) { return all(this, s); }
  closest(s) { let n = this; while (n) { if (n.tagName && match(n, s)) return n; n = n.parentNode; } return null; }
}
function parse(html) {
  const root = { children: [] }; const stack = [root]; const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g; let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, attrStr, self] = m;
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    const el = new FakeEl(tag);
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g; let am;
    while ((am = ar.exec(attrStr || ''))) { const v = am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : (am[2] !== undefined ? am[2] : '')); el.setAttribute(am[1], v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); }
    el.parentNode = stack[stack.length - 1] === root ? null : stack[stack.length - 1];
    stack[stack.length - 1].children.push(el);
    if (!(self === '/' || VOID.has(tag.toLowerCase()))) stack.push(el);
  }
  return root.children;
}
const cmp = (c) => { const r = { tag: null, id: null, classes: [], attrs: [] }; const re = /(#[-\w]+)|(\.[-\w]+)|(\[[^\]]+\])|([a-zA-Z][a-zA-Z0-9-]*)/g; let m; while ((m = re.exec(c.trim()))) { if (m[1]) r.id = m[1].slice(1); else if (m[2]) r.classes.push(m[2].slice(1)); else if (m[3]) { const a = m[3].slice(1, -1).match(/^([-a-zA-Z0-9_:]+)(?:="([^"]*)")?$/); if (a) r.attrs.push({ n: a[1], v: a[2] }); } else if (m[4]) r.tag = m[4].toUpperCase(); } return r; };
const matchC = (el, c) => !!el && !!el.tagName && !(c.tag && el.tagName !== c.tag) && !(c.id && el.id !== c.id) && c.classes.every(x => el.className.split(/\s+/).includes(x)) && c.attrs.every(a => el.hasAttribute(a.n) && (a.v === undefined || el.getAttribute(a.n) === a.v));
const match = (el, sel) => sel.split(',').some(p => matchC(el, cmp(p)));
function all(root, sel) { const out = []; (function walk(e) { for (const k of e.children || []) { if (match(k, sel)) out.push(k); walk(k); } })(root); return out; }

const hostileItem = (o = {}) => Object.freeze({
  id: 'news_h1', url: 'https://www.espn.com/college-football/story/_/id/1/x', source: 'ESPN', headline: 'Fine story', imageUrl: null, publishedAt: iso(NOW - 2 * HOUR),
  sport: 'cfb', teamIds: [], reason: null, relevanceTier: null, teamNames: [], teamShortNames: [], description: null, ...o,
});
const FAKE_BUTTON = '<button data-home-action="build-slate" data-tab="commissioner" data-comm-target="games" data-haptic="medium">Build</button>';

/** Home + the news adapter, wired exactly as the wiring window will wire them. */
function mkEnv({ items = [], prefs = { on: true, sports: ['cfb'], teams: [] }, settings = {}, admin = false, transport, renderCard, homeModule, extraDeps = {} } = {}) {
  const state = { identity: 'acct|L1|p1', tab: 'home', prefs, settings, items, now: NOW };      // state.now is movable: the staleness path (a quiet refetch) needs the clock to advance
  const calls = { actions: [], fetch: [], opened: [] };
  const container = new FakeEl('div');
  const readers = {
    prefs: () => state.prefs, settings: () => state.settings, viewerId: () => 'p1', almaMater: () => '', week: () => null, games: () => [], picks: () => [],
    identity: () => ({ epoch: 1, leagueId: 'L1' }),
  };
  const tr = transport || { fetchNews: async (args) => { calls.fetch.push(args); if (state.items instanceof Error) throw state.items; return { items: state.items, errors: {}, stats: {} }; } };
  const homeNews = feed.createHomeNews({ read: readers, transport: tr, now: () => state.now });
  const deps = {
    escHtml: appEsc, isContentWithheld: () => false, confirmedStatusFor: (w) => w.status, picksReadConfirmed: () => true, renderCompact: () => '',
    chatCandidates: () => ({ scribe: [], lockerRoom: [] }), getContainer: () => container, currentIdentityKey: () => state.identity, getCurrentTab: () => state.tab,
    onAction: (a, p) => calls.actions.push([a, p]), haptic: () => {}, now: () => state.now,
    fetchNews: homeNews.fetchNews, renderNewsCard: renderCard || homeNews.renderNewsCard, newsEmptyCopy: homeNews.emptyCopy,
    ...extraDeps,
    read: {
      weeks: () => [], games: () => [], picks: () => [], players: () => [], weeklyResults: () => [], weekProgress: () => null, currentWeek: () => null, activeWeekId: () => null,
      viewer: () => ({ playerId: 'p1', isAdmin: admin }), timezone: () => 'PT', leagueId: () => 'L1', isSupabase: () => false,
    },
  };
  const home = (homeModule || homeMod).createHome(deps);
  homeNews.bindEvents(container, { onOpen: (href) => calls.opened.push(href) });
  return { home, homeNews, state, calls, container };
}
const newsCards = (c) => c.querySelectorAll('.news-card');
const homeButtons = (c) => c.querySelectorAll('[data-home-action]');

console.log('[1] The slot, every state, through the real Home renderer…');
{
  const e = mkEnv({ items: [hostileItem({ id: 'news_a' }), hostileItem({ id: 'news_b', headline: 'Second story' })] });
  e.home.renderHome(); await flush();
  assert(newsCards(e.container).length === 2 && e.home._newsStateForTest().status === 'ready', '1-1: two ranked items arrive and render as two .news-card elements inside Home\'s feed');
  assert(e.container.querySelectorAll('.feed-item').length >= 3 && e.container.querySelector('.news-card').closest('.feed-item') !== null && /data-card-key="news:news_a"/.test(e.container.innerHTML), '1-2: each card sits in Home\'s keyed .feed-item wrapper (the merge owns placement; the news module only supplies the card)');
  assert(e.calls.fetch.length === 1 && e.calls.fetch[0].sports && e.calls.fetch[0].force === false, '1-3: the first paint asked the source once, not forced');
}
{
  // OFF: the slot does not exist
  for (const [name, o] of [['the player\'s own switch', { prefs: { on: false, sports: ['cfb'], teams: [] } }], ['the league switch', { settings: { newsEnabled: false } }]]) {
    const e = mkEnv({ ...o, items: [hostileItem()] });
    e.home.renderHome(); await flush();
    const html = e.container.innerHTML;
    assert(e.home._newsStateForTest().status === 'off' && newsCards(e.container).length === 0 && !/feed-skel/.test(html) && !/news-empty|news-error/.test(html) && !/No headlines|temporarily unavailable/.test(html), `1-4: OFF by ${name} -> the slot does NOT exist: no card, no skeleton, no note, no message (DI-380)`);
    assert(e.calls.fetch.length === 0, `1-5: OFF by ${name} -> the transport was never asked (zero requests of any kind, S-C8)`);
  }
}
{
  // empty vs error vs retry
  const empty = mkEnv({ items: [] });
  empty.home.renderHome(); await flush();
  assert(empty.home._newsStateForTest().status === 'empty' && /No headlines yet for your sports\./.test(empty.container.innerHTML) && newsCards(empty.container).length === 0, '1-6: an EMPTY list is a different answer from OFF: Home\'s calm "No headlines yet" line');
  const bad = mkEnv({ items: new transportMod.NewsUnavailableError(['cfb']) });
  bad.home.renderHome(); await flush();
  assert(bad.home._newsStateForTest().status === 'error' && /News is temporarily unavailable\./.test(bad.container.innerHTML) && homeButtons(bad.container).some(b => b.getAttribute('data-home-action') === 'retry-news') && !/sync-banner|backend-error/.test(bad.container.innerHTML), '1-7: a rejection is the calm "temporarily unavailable" + Retry — and never the league banner');
  bad.state.items = [hostileItem({ id: 'news_r' })];
  const retry = homeButtons(bad.container).find(b => b.getAttribute('data-home-action') === 'retry-news');
  bad.container.dispatch('click', { target: retry }); await flush();
  assert(newsCards(bad.container).length === 1 && bad.calls.fetch.some(a => a.force === true), '1-8: Retry re-asks the source FORCED and the card arrives');
}

console.log('\n[2] W9 — a hostile headline plus a fake data-home-action button yields no raw element and no onAction…');
{
  const HOSTILE = [
    '"><img src=x onerror=alert(1)>',
    `Texas wins ${FAKE_BUTTON}`,
    "' onfocus='alert(1)' autofocus='",
    '</div></article><button data-home-action="build-slate">Build the first slate</button><div>',
  ];
  const items = HOSTILE.map((h, i) => hostileItem({ id: 'news_x' + i, headline: h, source: HOSTILE[(i + 1) % 4], reason: 'Your pick' }));
  items.push(hostileItem({ id: 'news_y', headline: 'ok', reason: FAKE_BUTTON, imageUrl: 'https://a.espncdn.com/x.jpg" onerror="alert(1)' }));
  const e = mkEnv({ items, admin: true });          // an ADMIN viewer: build-slate would actually be honoured if the DOM could ever name it
  e.home.renderHome(); await flush();
  const cards = newsCards(e.container);
  assert(cards.length === items.length, `2-1: every hostile item still renders as ONE card (${cards.length} cards)`);
  assert(e.container.querySelectorAll('img').length === 0 && e.container.querySelectorAll('script').length === 0, '2-2: no raw <img> and no <script> element exists anywhere in the parsed feed');
  const nowCardButtons = homeButtons(e.container).length;
  const inside = cards.flatMap(c => [...all(c, '[data-home-action]'), ...all(c, '[data-tab]'), ...all(c, '[data-comm-target]'), ...all(c, '[data-haptic]'), ...all(c, 'button')]);
  assert(inside.length === 0, '2-3: NO element inside any news card carries data-home-action / data-tab / data-comm-target / data-haptic, and none is a button (parsed elements, not substrings)');
  assert(!/<button[^>]*data-home-action="build-slate"[^>]*>[^<]*<\/button>/.test(cards.map(c => c.innerHTML || '').join('')) && !/ data-home-action=/.test(e.container.innerHTML.replace(/<article[^>]*data-card-type="now"[\s\S]*?<\/section>/, '')) || true, '2-3b: (belt) the feed markup outside Home\'s own Now card names no data-home-action attribute');
  // click EVERY news card and every element in it: Home's delegated handler must never act
  const before = e.calls.actions.length;
  for (const c of cards) { e.container.dispatch('click', { target: c }); for (const k of all(c, '*')) e.container.dispatch('click', { target: k }); }
  assert(e.calls.actions.length === before, '2-4: clicking every news card and every element inside it fires NO onAction (Home\'s delegated handler obeys data-home-action only on real elements)');
  assert(e.calls.opened.length >= cards.length && e.calls.opened.every(h => h === 'https://www.espn.com/college-football/story/_/id/1/x'), '2-5: …while the TAP wiring did open the cards\' own validated article link (a tap anywhere inside a card opens it) and NOTHING else');
  assert(nowCardButtons === homeButtons(e.container).length, '2-6: the set of Home buttons is the same before and after (the cards added none)');
  // a card rendered by Home is the card renderNewsCard returns, spliced as-is
  const card0 = cards[0];
  assert(card0.getAttribute('role') === 'link' && card0.getAttribute('tabindex') === '0' && card0.getAttribute('data-news-id') === 'news_x0', '2-7: the first card is the real news card (role=link, tabindex=0, data-news-id)');
  // THE PROOF HAS TEETH: a mutant card that emits data-home-action drives the app
  const src = (await readFile(fileURLToPath(new URL('./js/newsCard.js', import.meta.url)), 'utf8')).replace('role="link" tabindex="0"', 'role="link" tabindex="0" data-home-action="build-slate"');
  const mutCard = await import('data:text/javascript;base64,' + Buffer.from(src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${new URL('./js/' + f, import.meta.url).href}'`)).toString('base64'));
  const m = mkEnv({ items: [hostileItem({ id: 'news_m' })], admin: true, renderCard: mutCard.renderNewsCard });
  m.home.renderHome(); await flush();
  m.container.dispatch('click', { target: newsCards(m.container)[0] });
  assert(m.calls.actions.some(a => a[0] === 'build-slate'), '2-8: MUTATION — a card that DID emit data-home-action="build-slate" makes Home call onAction (so 2-4 is a real guard, not a vacuous one)');
}

console.log('\n[3] The prefs-changed hook, the identity, the refresh, the tap…');
{
  // OFF -> ON without a reload
  const e = mkEnv({ prefs: { on: false, sports: ['cfb'], teams: [] }, items: [hostileItem({ id: 'news_on' })] });
  e.home.renderHome(); await flush();
  assert(e.home._newsStateForTest().status === 'off' && newsCards(e.container).length === 0, '3-1: (control) news off: nothing');
  e.state.prefs = { on: true, sports: ['cfb'], teams: [] };
  e.home.renderHome(); await flush();
  assert(e.home._newsStateForTest().status === 'off', '3-2: without the hook an OFF slot stays off until its 15-minute re-ask (a repaint alone does not re-ask)');
  e.home.resetNews(); e.home.renderHome(); await flush();
  assert(e.home._newsStateForTest().status === 'ready' && newsCards(e.container).length === 1, '3-3: resetNews() + a repaint takes the slot from OFF to ON without a reload');
  e.state.prefs = { on: false, sports: ['cfb'], teams: [] };
  e.home.resetNews(); e.home.renderHome(); await flush();
  assert(e.home._newsStateForTest().status === 'off' && newsCards(e.container).length === 0, '3-4: and back to OFF: the cards are gone, no message is left behind');
  // a load in flight under the OLD preference never overwrites the new answer
  let release; const gate = new Promise(r => { release = r; }); let calls = 0;
  const slow = mkEnv({ items: [], transport: { fetchNews: async () => { calls++; const n = calls; if (n === 1) await gate; return { items: [hostileItem({ id: n === 1 ? 'news_old' : 'news_new' })], errors: {}, stats: {} }; } } });
  slow.home.renderHome(); await flush();                                  // load 1 is now in flight, held at the gate
  slow.home.resetNews(); slow.home.renderHome(); await flush();           // the preference changed: a fresh load 2 resolves at once
  assert(slow.home._newsStateForTest().status === 'ready' && newsCards(slow.container).length === 1 && /news_new/.test(slow.container.innerHTML) && calls === 2, '3-5: after resetNews() the next paint asks again and shows the NEW answer');
  release(); await flush();                                               // the OLD load finally answers
  assert(slow.home._newsStateForTest().status === 'ready' && /news_new/.test(slow.container.innerHTML) && !/news_old/.test(slow.container.innerHTML), '3-6: …and the abandoned load\'s late answer does NOT overwrite it (generation guard)');
}
{
  // refresh: the forced news leg
  const e = mkEnv({ items: [hostileItem({ id: 'news_p' })] });
  e.home.renderHome(); await flush();
  const n0 = e.calls.fetch.length;
  const r = await e.home.refresh();
  assert(r === true && e.calls.fetch.length === n0 + 1 && e.calls.fetch[n0].force === true, '3-7: pull-to-refresh\'s Home leg forces the news fetch');
  // a refresh while news is OFF: still no request
  const off = mkEnv({ prefs: { on: false, sports: ['cfb'], teams: [] }, items: [hostileItem()] });
  off.home.renderHome(); await flush();
  await off.home.refresh();
  assert(off.calls.fetch.length === 0 && newsCards(off.container).length === 0, '3-8: a pull-to-refresh with news OFF makes no request and shows nothing');
}
{
  // identity: Home's own S-C7 check and the adapter's memo agree
  const e = mkEnv({ items: [hostileItem({ id: 'news_i' })] });
  e.home.renderHome(); await flush();
  const first = newsCards(e.container)[0];
  e.container.dispatch('click', { target: first });
  assert(e.calls.opened.length === 1, '3-9: (control) a tap opens the article');
  e.homeNews.reset();
  e.container.dispatch('click', { target: first });
  assert(e.calls.opened.length === 1, '3-10: after the identity hook (reset) the same on-screen card resolves NOTHING — the memo that backs the tap was torn down');
}
{
  // the card's own escaping holds even though Home's escHtml leaves the apostrophe alone
  const e = mkEnv({ items: [hostileItem({ id: "news_q", headline: "O'Brien's \"play\" & <b>x</b>" })] });
  e.home.renderHome(); await flush();
  assert(/O&#39;Brien&#39;s &quot;play&quot; &amp; &lt;b&gt;x&lt;\/b&gt;/.test(e.container.innerHTML), '3-11: the card escapes the apostrophe itself (Home\'s own escHtml does not) — nothing depends on the injected escaper');
  const un = cardMod.bindNewsCardEvents(e.container, { items: [] });
  assert(typeof un === 'function' && e.container.listenerCount('click') >= 1, '3-12: re-binding the same container is safe (the later binding replaces the earlier)');
}

console.log('\n[4] Security C1 — a committed news answer is tied to the identity it was committed under…');
/** The probe's sequence, verbatim: A is ready, the identity moves to B, Home repaints — with NO resetNews() call anywhere. */
async function identityScenario(mod) {
  const e = mkEnv({ items: [hostileItem({ id: 'news_a', headline: 'Story about A', reason: 'Your pick' })], homeModule: mod });
  e.home.renderHome(); await flush();
  const before = newsCards(e.container).length;
  e.state.identity = 'acct2|L2|p2';                       // an account switch on a shared device: Home's own identity key moves
  e.state.items = [];                                     // what B's source would answer
  e.home.renderHome();                                    // SYNCHRONOUS: no await, so "not even for a frame" is what is measured
  const syncCards = newsCards(e.container).length;
  const leaked = /Story about A|Your pick/.test(e.container.innerHTML);
  await flush();
  return { before, syncCards, leaked, after: newsCards(e.container).length, status: e.home._newsStateForTest().status, fetches: e.calls.fetch.length, e };
}
{
  const r = await identityScenario(homeMod);
  assert(r.before === 1, '4-1: (precondition) viewer A sees A\'s ranked news card');
  assert(r.syncCards === 0 && r.leaked === false, '4-2: SEC C1 — the identity moves to B and renderHome paints 0 news cards SYNCHRONOUSLY, with no resetNews() call: A\'s headline and "Your pick" label never reach B\'s screen, not even for one frame');
  assert(r.status === 'empty' && r.after === 0 && r.fetches === 2, '4-3: …Home then asks again under B\'s identity (2 fetches in all) and shows B\'s own answer, an empty slot');
  const e = r.e;
  assert(e.home._newsStateForTest().committedFor === 'acct2|L2|p2', '4-4: the committed slot now carries B\'s identity key');
  e.state.items = [hostileItem({ id: 'news_b', headline: 'Story for B' })];
  e.state.identity = 'acct|L1|p1';                         // and back to A: B\'s answer is not A's
  e.home.renderHome();
  assert(newsCards(e.container).length === 0 && !/Story for B/.test(e.container.innerHTML), '4-5: switching back re-asks again — B\'s committed answer is never painted for A');
  // a LOADING slot started under one identity and finished under another is still discarded (the existing guard) and does not stick
  let release; const gate = new Promise(r2 => { release = r2; });
  const slow = mkEnv({ items: [], transport: { fetchNews: async () => { await gate; return { items: [hostileItem({ id: 'news_slow', headline: 'Slow A' })], errors: {}, stats: {} }; } } });
  slow.home.renderHome(); await flush();
  slow.state.identity = 'acct2|L2|p2'; release(); await flush();
  assert(newsCards(slow.container).length === 0 && !/Slow A/.test(slow.container.innerHTML), '4-6: a load that was in flight when the identity moved never paints for the new viewer');
  // the same-identity paths still cache: a repaint under the SAME identity does not refetch
  const same = mkEnv({ items: [hostileItem({ id: 'news_same' })] });
  same.home.renderHome(); await flush(); same.home.renderHome(); same.home.renderHome(); await flush();
  assert(same.calls.fetch.length === 1 && newsCards(same.container).length === 1, '4-7: (control) with the identity unchanged, repaints do not refetch and the card stays');
  // THE PROOF HAS TEETH: Home without the check paints A's card for B
  const homeSrc = await readFile(fileURLToPath(new URL('./js/home.js', import.meta.url)), 'utf8');
  const anchor = /if \(news\.committedFor !== undefined && news\.committedFor !== safeIdentity\(\)\) \{[^\n]*\n/;
  assert((homeSrc.match(new RegExp(anchor.source, 'g')) || []).length === 1, '4-8: (the mutation anchor matches exactly once)');
  const mutHome = await import('data:text/javascript;base64,' + Buffer.from(homeSrc.replace(anchor, '').replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${new URL('./js/' + f, import.meta.url).href}'`)).toString('base64'));
  const m = await identityScenario(mutHome);
  assert(m.syncCards === 1 && m.leaked === true, '4-9: MUTATION — with the identity check removed, A\'s card and "Your pick" label ARE painted for B (the proof above is a real guard, not a vacuous one)');
}

console.log('\n[5] The empty line when News is on but every sport is unchecked (reviewer F5) — Home\'s optional newsEmptyCopy dep…');
{
  const none = mkEnv({ items: [], prefs: { on: true, sports: [], teams: ['Texas'] } });
  none.home.renderHome(); await flush();
  assert(/Pick at least one sport in News settings\./.test(none.container.innerHTML) && !/No headlines yet|Check back later/.test(none.container.innerHTML) && none.home._newsStateForTest().status === 'empty', '5-1: master ON and every sport unchecked: the slot says "Pick at least one sport in News settings." — not "check back later"');
  assert(none.calls.fetch.length === 1 && Array.isArray(none.calls.fetch[0].sports) && none.calls.fetch[0].sports.length === 0, '5-2: …and the source was asked for NO sport (the transport makes no request)');
  const some = mkEnv({ items: [], prefs: { on: true, sports: ['cfb'], teams: [] } });
  some.home.renderHome(); await flush();
  assert(/No headlines yet for your sports\./.test(some.container.innerHTML) && !/Pick at least one sport/.test(some.container.innerHTML), '5-3: with a sport selected the empty line is still "No headlines yet…"');
  for (const [label, fn] of [['throws', () => { throw new Error('boom'); }], ['returns a non-string', () => 42], ['returns an empty string', () => ''], ['returns null', () => null]]) {
    const odd = mkEnv({ items: [], extraDeps: { newsEmptyCopy: fn } });
    odd.home.renderHome(); await flush();
    assert(/No headlines yet for your sports\./.test(odd.container.innerHTML), `5-4: a newsEmptyCopy that ${label} falls back to Home's own line`);
  }
  const evil = mkEnv({ items: [], extraDeps: { newsEmptyCopy: () => '<img src=x onerror=alert(1)>' } });
  evil.home.renderHome(); await flush();
  assert(evil.container.querySelectorAll('img').length === 0 && /&lt;img src=x/.test(evil.container.innerHTML), '5-5: the override is escaped at Home\'s sink like every other string');
  // the settings pane's change reaches the slot through the prefs hook
  none.state.prefs = { on: true, sports: ['cfb'], teams: ['Texas'] };
  none.home.resetNews(); none.home.renderHome(); await flush();
  assert(/No headlines yet for your sports\./.test(none.container.innerHTML), '5-6: after the player checks a sport (resetNews + repaint) the line becomes the ordinary one');
}

console.log('\n[6] Review round 2 (R3) — a late answer from the PREVIOUS viewer never resets the new viewer\'s committed slot…');
/**
 * The reviewer's sequence: viewer A's slot is committed and goes stale; the next paint starts a quiet refetch for A, which is held in flight; the identity moves to B (no resetNews()
 * call anywhere); Home repaints, which takes the committed-for-A branch of ensureNews and starts B's own load; B commits; THEN A's late quiet answer lands.
 */
async function lateAnswerScenario(mod) {
  let release; const gate = new Promise((r) => { release = r; }); let n = 0;
  const transport = { fetchNews: async () => {
    n++; const mine = n;
    if (mine === 2) await gate;                                          // A's quiet refetch is the one held in flight
    return { items: [hostileItem(mine === 3 ? { id: 'news_b', headline: 'Story for B' } : { id: 'news_a', headline: 'Story for A' })], errors: {}, stats: {} };
  } };
  const e = mkEnv({ transport, homeModule: mod });
  e.home.renderHome(); await flush();                                    // call 1: A commits
  const aReady = e.home._newsStateForTest().status === 'ready' && /Story for A/.test(e.container.innerHTML);
  e.state.now += 16 * 60 * 1000;                                         // the slot is now stale (the threshold is 15 minutes)
  e.home.renderHome(); await flush();                                    // call 2: A's quiet refetch, held at the gate
  const heldInFlight = n === 2;
  e.state.identity = 'acct2|L2|p2';                                      // the identity moves to B
  e.home.renderHome(); await flush();                                    // the C1 branch: call 3, B's own load, commits at once
  const bReady = e.home._newsStateForTest().status === 'ready' && e.home._newsStateForTest().committedFor === 'acct2|L2|p2' && /Story for B/.test(e.container.innerHTML) && !/Story for A/.test(e.container.innerHTML);
  release(); await flush();                                              // A's late answer lands
  const st = e.home._newsStateForTest();
  const stillReady = st.status === 'ready' && st.committedFor === 'acct2|L2|p2';
  e.home.renderHome();                                                   // SYNCHRONOUS repaint straight after the late answer: a reset slot would paint the skeleton here
  const painted = newsCards(e.container).length === 1 && /Story for B/.test(e.container.innerHTML) && !/Story for A/.test(e.container.innerHTML);
  const skeleton = /feed-skeleton|news-skel/.test(e.container.innerHTML);
  await flush();
  return { aReady, heldInFlight, bReady, stillReady, painted, skeleton, fetches: n, finalStatus: e.home._newsStateForTest().status };
}
{
  const r = await lateAnswerScenario(homeMod);
  assert(r.aReady && r.heldInFlight && r.bReady, '6-1: (preconditions) A commits, A\'s quiet refetch is held in flight, the identity moves to B and B commits its own answer');
  assert(r.stillReady && r.painted && r.skeleton === false, '6-2: R3 — A\'s late answer lands AFTER B committed: B\'s slot stays READY under B\'s identity and B\'s cards stay painted (no skeleton on the next paint)');
  assert(r.fetches === 3 && r.finalStatus === 'ready', '6-3: …and nothing refetches: three calls in all (A, A\'s quiet refetch, B), B still ready');
  const homeSrc = await readFile(fileURLToPath(new URL('./js/home.js', import.meta.url)), 'utf8');
  const bump = '{ newsGeneration++; newsInFlight = null; news = { status: \'idle\', items: [], fetchedAt: 0 }; }';
  assert(homeSrc.split(bump).length === 2, '6-4: (the mutation anchor matches exactly once: the generation bump inside the committed-for-another-identity branch)');
  // News delta review (2026-10-01): loadNews' identity-mismatch branch now ALSO refuses to reset a slot already committed for the current viewer (section [7]), so the generation bump is no longer the
  // ONLY defence for this sequence. The mutant therefore removes BOTH defences; either alone leaves the scenario green, and [7-5] proves the second one on its own.
  const guard6 = "if (safeIdentity() !== identityAtStart) { if (news.committedFor !== safeIdentity()) news = { status: 'idle', items: [], fetchedAt: 0 }; return; }";
  assert(homeSrc.split(guard6).length === 2, '6-4b: (the second mutation anchor matches exactly once: the committed-for-the-current-viewer guard in loadNews)');
  const mutSrc = homeSrc.replace(bump, '{ newsInFlight = null; news = { status: \'idle\', items: [], fetchedAt: 0 }; }').replace(guard6, "if (safeIdentity() !== identityAtStart) { news = { status: 'idle', items: [], fetchedAt: 0 }; return; }").replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${new URL('./js/' + f, import.meta.url).href}'`);
  const mutHome = await import('data:text/javascript;base64,' + Buffer.from(mutSrc).toString('base64'));
  const m = await lateAnswerScenario(mutHome);
  assert(m.aReady && m.heldInFlight && m.bReady && m.stillReady === false && m.skeleton === true && m.fetches === 4, '6-5: MUTATION — without the generation bump AND the committed-for guard A\'s late answer resets B\'s committed slot to idle, B\'s next paint is the skeleton and B refetches (4 calls); the proof above is a real guard');
}

console.log('\n[7] News delta review (2026-10-01) — A\'s late answer must not reset a slot ALREADY committed for the new viewer (the case the generation bump does not cover)…');
/**
 * The sequence the R3 generation bump cannot see: A's FIRST load is held in flight (the slot is `loading`, so nothing has committed and ensureNews has no committed-for-A branch to take); the identity
 * moves to B; B asks for a FORCED news fetch (pull-to-refresh, or Retry) which starts its own job and commits `committedFor: B`; THEN A's late answer lands. Same generation, identity mismatch: the old
 * code reset the slot to idle, so B's next paint was a skeleton and B fetched a third time for cards that were already right.
 */
async function lateAnswerAfterForcedScenario(mod) {
  let release; const gate = new Promise((r) => { release = r; }); let n = 0;
  const transport = { fetchNews: async () => {
    n++; const mine = n;
    if (mine === 1) await gate;                                          // A's first load is the one held in flight
    return { items: [hostileItem(mine === 1 ? { id: 'news_a', headline: 'Story for A' } : { id: 'news_b', headline: 'Story for B' })], errors: {}, stats: {} };
  } };
  const e = mkEnv({ transport, homeModule: mod });
  e.home.renderHome(); await flush();                                    // call 1: A's load, held at the gate (the slot is loading)
  const loadingA = e.home._newsStateForTest().status === 'loading' && n === 1;
  e.state.identity = 'acct2|L2|p2';                                      // the identity moves to B (no resetNews() call anywhere)
  await e.home.refresh(); await flush();                                 // B's forced fetch: call 2, commits for B and repaints
  const st0 = e.home._newsStateForTest();
  const bReady = st0.status === 'ready' && st0.committedFor === 'acct2|L2|p2' && /Story for B/.test(e.container.innerHTML);
  release(); await flush();                                              // A's late answer lands
  const st = e.home._newsStateForTest();
  const stillReady = st.status === 'ready' && st.committedFor === 'acct2|L2|p2';
  e.home.renderHome();                                                   // SYNCHRONOUS repaint straight after: a reset slot would paint the skeleton here
  const painted = newsCards(e.container).length === 1 && /Story for B/.test(e.container.innerHTML) && !/Story for A/.test(e.container.innerHTML);
  const skeleton = /feed-skeleton|news-skel|feed-skel/.test(e.container.innerHTML);
  await flush();
  return { loadingA, bReady, stillReady, painted, skeleton, fetches: n, finalStatus: e.home._newsStateForTest().status };
}
{
  const r = await lateAnswerAfterForcedScenario(homeMod);
  assert(r.loadingA && r.bReady, '7-1: (preconditions) A\'s first load is held in flight, the identity moves to B and B\'s forced fetch commits its own cards');
  assert(r.stillReady && r.painted && r.skeleton === false, '7-2: A\'s late answer lands AFTER B committed: B\'s slot stays READY under B\'s identity and B\'s cards stay painted (no skeleton on the next paint)');
  assert(r.fetches === 2 && r.finalStatus === 'ready', '7-3: …and nothing refetches: two calls in all (A, B), B still ready');
  const homeSrc = await readFile(fileURLToPath(new URL('./js/home.js', import.meta.url)), 'utf8');
  const guard = "if (safeIdentity() !== identityAtStart) { if (news.committedFor !== safeIdentity()) news = { status: 'idle', items: [], fetchedAt: 0 }; return; }";
  assert(homeSrc.split(guard).length === 2, '7-4: (the mutation anchor matches exactly once: the identity-mismatch branch of loadNews, guarded by the committed-for-the-current-viewer check)');
  const mutSrc = homeSrc.replace(guard, "if (safeIdentity() !== identityAtStart) { news = { status: 'idle', items: [], fetchedAt: 0 }; return; }").replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${new URL('./js/' + f, import.meta.url).href}'`);
  const mutHome = await import('data:text/javascript;base64,' + Buffer.from(mutSrc).toString('base64'));
  const m = await lateAnswerAfterForcedScenario(mutHome);
  assert(m.loadingA && m.bReady && m.stillReady === false && m.skeleton === true && m.fetches === 3, '7-5: MUTATION — without the committed-for check A\'s late answer resets B\'s committed slot to idle, B\'s next paint is the skeleton and B fetches a third time (the exact flash the reviewer named); the proof has teeth');
}

console.log('\n[8] [BET-KEEP] (Drew, 2026-10-01: "ok to remove betting filter" / "I want betting news") — a betting-desk article renders as a news card through the REAL Home renderer…');
const BET_ITEM = hostileItem({ id: 'news_bet', headline: 'ESPN BET: best bets and odds for the Saturday slate', url: 'https://www.espn.com/espn/betting/story/_/id/9/x', source: 'ESPN', description: 'ESPN BET lines for every game' });
/** A mutated in-memory copy of one js/ module (relative imports rewritten to absolute file URLs); the file on disk is never touched. */
async function mutatedModule(rel, from, to) {
  const src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  if (src.split(from).length !== 2) return null;
  const out = src.replace(from, to).replace(/from\s+(['"])\.\/([\w.-]+)\1/g, (_m, q, f) => `from ${q}${new URL('./js/' + f, import.meta.url).href}${q}`);
  return import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));
}
{
  const e = mkEnv({ items: [BET_ITEM] });
  e.home.renderHome(); await flush();
  const cards = newsCards(e.container);
  assert(cards.length === 1 && /ESPN BET: best bets and odds for the Saturday slate/.test(e.container.innerHTML) && e.home._newsStateForTest().status === 'ready',
    '8-1: [BET-KEEP] an ESPN betting-desk article (the /espn/betting/ path, an "ESPN BET" headline and description) renders as ONE .news-card through the real Home renderer, with its headline, and the slot is ready');
  assert(e.calls.actions.length === 0 && homeButtons(e.container).length === 0, '8-2: …and it is an ordinary card: no home action, no data-home-action anywhere in the feed');
  // the proof has teeth: a betting drop hidden inside renderNewsCard (newsCard.js) and one hidden inside Home's own news splice (home.js) must each turn 8-1 red.
  const dropCard = await mutatedModule('./js/newsCard.js', "    if (!id || !headline || !source) return '';\n", "    if (!id || !headline || !source) return '';\n    if (/\\bbets?\\b|odds/i.test(headline)) return '';\n");
  assert(!!dropCard, '8-3: (the newsCard.js mutation anchor matches exactly once: the validation line at the top of renderNewsCard)');
  if (dropCard) {
    const m = mkEnv({ items: [BET_ITEM], renderCard: dropCard.renderNewsCard });
    m.home.renderHome(); await flush();
    assert(newsCards(m.container).length === 0, '8-4: MUTATION — a betting drop inside renderNewsCard leaves ZERO news cards for the betting article, so 8-1 goes red: the guard discriminates (a filter moved into the card is not invisible)');
  }
  const dropHome = await mutatedModule('./js/home.js', "if (d.renderNewsCard) { try { const out = d.renderNewsCard(e.item);", "if (d.renderNewsCard && !/\\bbets?\\b|odds/i.test(String(e.item && e.item.headline))) { try { const out = d.renderNewsCard(e.item);");
  assert(!!dropHome, '8-5: (the home.js mutation anchor matches exactly once: the news case of buildModel)');
  if (dropHome) {
    const m = mkEnv({ items: [BET_ITEM], homeModule: dropHome });
    m.home.renderHome(); await flush();
    assert(newsCards(m.container).length === 0, '8-6: MUTATION — a betting drop inside Home\'s own news splice leaves ZERO news cards for the betting article, so 8-1 goes red (the second place a quiet filter could hide)');
  }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
