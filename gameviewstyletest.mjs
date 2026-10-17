/**
 * CFB Pickems — gameviewstyletest.mjs (Deployment 1, Lane B, Game Day fix round 2, P-8 / TP 233, 2026-10-08)
 * ========================================================================================================
 * P-8: a new surface's styling is proven by COMPUTED GEOMETRY in a real browser, never by asserting class names. The markup is the app's own: the REAL app.js runs over a real element tree built from
 * the real index.html (minidom.mjs, the d1wiringtest way) and paints, in turn, the Game view (a final game with Related cards, What's next and the thread card; a live game with the prev / next pair;
 * an Open week's "Make your picks"), Game Day's open card with Team logos on, the web Dashboard's Standard matrix with "Show picks: By team" (its note), and the Chat tab with the "Back to …" chip.
 * Each captured page is laid out by a real Chromium with the REAL css/styles.css inside the real index.html shell, at 375 pt wide, at default text and at 1.35x text, and measured:
 *
 *   [1] The Game view: the prev / next buttons are 44 x 44 pt; every action group's buttons are >= 44 pt tall, CENTRED in the group and 8 pt apart (side by side or stacked); the cards are 16 pt apart;
 *       nothing is wider than the screen (no horizontal overflow, the body's or any card's); the Related cards are laid out (each a full-width card, 8 pt apart, inside the body); the score card's
 *       team lockups are 48 x 48 pt; during the prev / next cross-fade the old body's ghost covers the body exactly and a NEW tap goes through it to the real control (P-3)
 *       What's next (a FINAL game, DI-599 / DI-593) with one and with two buttons: its sentence laid out inside the card, its buttons >= 44 pt, centred, 8 pt apart, 16 pt below the card above it
 *       the status chip's cross-fade stacks old and new in one cell (DI-593)
 *   [2] Game Day's open card with Team logos on: each row's two lockups are 24 x 24 pt, the row is >= 44 pt, nothing in a row is wider than the row; a leaving pill (DI-604) computes to opacity 0,
 *       pointer-events none, and keeps its box during the fade
 *       (the Home Final card's "Next: …" line and its fold-away at the largest text are measured in gamedaybudgettest [1l] / [2i] / [4g], over the fixed-clock fixtures)
 *   [3] The Dashboard's Standard matrix + By team: the note is drawn, its Compact button is >= 44 pt, the note sits 16 pt above what follows it, nothing overflows
 *   [4] Chat's "Back to …" chip: >= 44 pt tall, 16 pt in from the sides, 8 pt above the pills, a long label ellipsizes inside the chip (never past it)
 *   [6] The game thread sheet (DI-592, the consolidated round 2026-10-08), opened from the Game view through its real "open-thread" button, web and native: the close is 44 x 44 pt; "Open in chat" is
 *       >= 44 pt, centred in its own row, 8 pt under the row's hairline; the subtitle "Also appears in the Locker Room" is laid out inside the header; the title block never runs under the actions; nothing is
 *       wider than the sheet; native: the grabber is 36 x 5 pt, centred, and the title sits below it
 *   [7] Share to chat (DI-597): the sheet (web and native, both text sizes) — the close 44 x 44, the comment field >= 44 pt and full width, "Post to chat" / "Cancel" >= 44 pt, centred, 8 pt apart,
 *       the body's parts 16 pt apart, the preview's 16 pt glyph, nothing wider than the sheet, the native grabber 36 x 5; and a shared message's "Open details" attachment in Chat (>= 44 pt, inside its column)
 *   [5] Anti-vacuity: every detector is fed a sheet that breaks its rule and must go RED (5k/5l: the thread sheet's; 5m/5n: Share's)
 *
 * Fonts are deterministic (network blocked: the web font never loads, the local fallbacks are wider than Oswald, so conservative). Only a device confirms the final pixels.
 *
 * Run:  node gameviewstyletest.mjs     Override the browser: GAMEVIEWSTYLE_ENGINE=/path/to/Chromium (falls back to SPACINGTEST_ENGINE, NAVTEST_ENGINE). A missing browser is a FAILURE, never a skip.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MiniDocument } from './minidom.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const REAL_FETCH = globalThis.fetch;
let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
function assert(cond, label) { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label); } }
const read = (rel) => readFileSync(join(here, rel), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the app, in a real element tree (the d1wiringtest way) ─────────────────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in gameviewstyletest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollY = 0;
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const INDEX = read('index.html');
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

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] gameviewstyletest.mjs — the Game view, Game Day's row logos, the Standard note and the Back chip, laid out in a real engine\n`);

const LOGO = (n) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${n}.png`;
function seed({ w2 = 'final', layout = 'compact', picksViewDash = null } = {}) {
  store.clear();
  const L = fx.buildLeague({ w2, calculateWeeklyResults });
  L.players.forEach((p) => storage.savePlayer({ ...p, preferences: { ...(p.preferences || {}), dashboardLayout: layout, ...(p.playerId === 'p1' ? { logoView: true } : {}) } }));
  L.weeks.forEach((w) => storage.saveWeek(w));
  L.games.forEach((g, i) => storage.saveGame({ ...g, homeLogo: LOGO(100 + i), awayLogo: LOGO(200 + i) }));
  storage.saveAllPicks(L.picks);
  for (const wid of ['w1', 'w2']) storage.saveAllWeeklyResults(wid, L.weeklyResults.filter((r) => r.weekId === wid));
  storage.setSession('p1', false, true);
  if (picksViewDash) storage.setPicksView('dashboard', picksViewDash);
  return L;
}
const reset = () => { try { ps.closeAllScreens('test'); } catch {} globalThis.document = freshDoc(); app._resetHomeWiringForTest(); app.state.currentTab = 'home'; app.state.viewingWeekId = null; globalThis.scrollY = 0; };
const go = (tab) => { quiet(); app._navigateToForTest(tab); loud(); };
const live = (gids) => { for (const gid of gids) { const g = storage.getGames('w2').find((x) => x.gameId === gid); storage.saveGame({ ...g, status: 'live', homeScore: 10, awayScore: 7 }); } const w = storage.getWeeks().find((x) => x.weekId === 'w2'); storage.saveWeek({ ...w, status: 'live' }); };
const rootHtml = () => { const r = document.getElementById('pushed-root'); return r ? r.outerHTML : ''; };
const sectionHtml = (id) => { const s = document.getElementById(id); return s ? s.outerHTML : ''; };

console.log('[0] The app paints every surface (real app.js over the real index.html)…');
const CAP = {};
// the Game view: a FINAL game (Related cards, What's next with See week results, the thread card with its two buttons)
seed(); reset(); go('home'); quiet(); app._openGameViewForTest('g21'); loud();
CAP.gvFinal = rootHtml();
// the Game view: a FINAL game whose What's next has TWO buttons (picks due in a published Week 3: "Make your picks" + "See week results")
seed();
storage.saveWeek({ weekId: 'w3', weekNumber: 3, season: '2026', status: 'open', picksLockAt: new Date(Date.now() + 86400e3).toISOString(), createdAt: new Date(Date.now() - 86400e3).toISOString() });
storage.saveGame({ ...storage.getGames('w2')[0], gameId: 'g31x', weekId: 'w3', status: 'scheduled', homeScore: null, awayScore: null, kickoff: new Date(Date.now() + 2 * 86400e3).toISOString() });
reset(); go('home'); quiet(); app._openGameViewForTest('g24'); loud();
CAP.gvNext = rootHtml();
// the Game view: a LIVE game with the prev / next pair
seed(); live(['g22', 'g23']); reset(); go('home'); quiet(); app._openGameViewForTest('g22'); loud();
CAP.gvLive = rootHtml();
// the Game view: an Open week the member has not submitted ("Make your picks")
seed();
{ const w = storage.getWeeks().find((x) => x.weekId === 'w2'); storage.saveWeek({ ...w, status: 'open', picksLockAt: new Date(Date.now() + 86400e3).toISOString() }); storage.saveGame({ ...storage.getGames('w2')[0], gameId: 'g_extra', status: 'scheduled', homeScore: null, awayScore: null, kickoff: new Date(Date.now() + 2 * 86400e3).toISOString() }); }
reset(); go('home'); quiet(); app._openGameViewForTest('g24'); loud();
CAP.gvDue = rootHtml();
// Game Day's OPEN card with Team logos on (and, first, the COLLAPSED card with its live pills)
seed(); live(['g22', 'g23']); reset(); go('home'); await wait(30);
CAP.homeCollapsed = sectionHtml('page-home');
quiet(); app.openGameDay({}); loud();
CAP.home = sectionHtml('page-home');
// the Dashboard: the Standard (web) matrix with "Show picks: By team"
seed({ w2: 'live', layout: 'standard', picksViewDash: 'team' }); reset(); go('dashboard');
CAP.dash = sectionHtml('page-dashboard');
// Chat: the "Back to …" chip, after "Locker Room" on a Game view
seed(); reset(); go('home'); quiet(); app._openGameViewForTest('g21'); loud();
{ const b = document.getElementById('pushed-root').querySelector('[data-gv-action="locker-room"]'); quiet(); b.dispatchEvent({ type: 'click', target: b }); loud(); }
await wait(ps.EXIT_FALLBACK_MS + 100);
CAP.chat = sectionHtml('page-chat');
reset(); go('home');   // leave Chat (its own pill timers run against a fresh tree, never the captured one)
await wait(50);
// the game thread sheet (DI-592), from the Game view's own "open-thread" button — on the web, and in the native shell (the grabber and the drag handle are native-only)
const chatUi = await import('./js/chat-ui.js');
const threadFrom = (gid) => {
  seed(); reset(); go('home'); quiet(); app._openGameViewForTest(gid); loud();
  const b = document.getElementById('pushed-root').querySelector('.ps-level:last-child [data-gv-action="open-thread"]');
  quiet(); b.dispatchEvent({ type: 'click', target: b }); loud();
  const w = document.getElementById('chat-sheet-wrap');
  const html = w ? w.outerHTML : '';
  quiet(); chatUi.resetGameChatSheetForTeardown(); loud();
  return html;
};
CAP.thread = threadFrom('g21');
globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
CAP.threadNative = threadFrom('g21');
delete globalThis.Capacitor;
// Share to chat (DI-597): the sheet from the Game view's own button, web and native; and the attachment another member sees in Chat
const shareFrom = (gid) => {
  seed(); reset(); go('home'); quiet(); app._openGameViewForTest(gid); loud();
  const b = document.getElementById('pushed-root').querySelector('.ps-level:last-child [data-gv-action="share"]');
  quiet(); b.dispatchEvent({ type: 'click', target: b }); loud();
  const w = document.getElementById('share-sheet-wrap');
  const html = w ? w.outerHTML : '';
  quiet(); app._closeShareSheetForTest({ immediate: true }); loud();
  return html;
};
CAP.share = shareFrom('g21');
globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
CAP.shareNative = shareFrom('g21');
delete globalThis.Capacitor;
{
  seed(); reset(); go('chat');
  quiet(); chatUi.postShareToChat({ ref: { type: 'game', id: 'g24' }, line: 'Final · Oregon at Washington: Oregon 31, Washington 24 — Oregon covered by 4.', comment: 'Called it' }); loud();
  storage.setSession('p2', false, true);
  reset(); go('chat');
  CAP.chatShare = sectionHtml('page-chat');
  storage.setSession('p1', false, true);
}
reset(); go('home');
await wait(50);
assert(/data-gv="related"/.test(CAP.gvFinal) && /class="gv-rel"/.test(CAP.gvFinal) && /data-gv="next"/.test(CAP.gvFinal) && /data-gv="thread"/.test(CAP.gvFinal) && /class="tl"/.test(CAP.gvFinal), '0a: (fixture) the FINAL Game view has Related cards, What\'s next, the thread card and the score card\'s lockups');
assert(/gv-step-btn/.test(CAP.gvLive) && /data-gv-action="make-picks"/.test(CAP.gvDue), '0b: (fixture) the LIVE Game view has the prev / next pair; the Open-week one offers "Make your picks"');
assert(/data-gv="next"[\s\S]*data-gv-action="next-picks"[\s\S]*data-gv-action="week-results"/.test(CAP.gvNext), '0b-2: (fixture) a FINAL game\'s What\'s next with two buttons (Make your picks, See week results)');
assert(/data-gd-expanded="true"/.test(CAP.home) && /class="tl tl--sm"/.test(CAP.home), '0c: (fixture) Game Day is OPEN on Home with the row lockups (Team logos on)');
assert(/data-pg-std-note/.test(CAP.dash) && /dashboard-scroll/.test(CAP.dash), '0d: (fixture) the Dashboard shows the Standard matrix with the By team note');
assert(/chat-return-chip/.test(CAP.chat), '0e: (fixture) Chat shows the "Back to …" chip');
assert(/id="chat-thread-sheet"/.test(CAP.thread) && /chat-sheet-lens/.test(CAP.thread) && !/sheet-grabber/.test(CAP.thread) && /sheet-grabber/.test(CAP.threadNative), '0f: (fixture) the thread sheet, web (no grabber) and native (grabber)');
assert(/id="share-sheet"/.test(CAP.share) && /data-share-action="post"/.test(CAP.share) && !/sheet-grabber/.test(CAP.share) && /sheet-grabber/.test(CAP.shareNative) && /data-share-open=/.test(CAP.chatShare), '0g: (fixture) the Share sheet, web and native, and a shared message\'s "Open details" in Chat');

// ── the engine ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[E] Engine…');
const ENGINES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'];
const override = process.env.GAMEVIEWSTYLE_ENGINE || process.env.SPACINGTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find((p) => existsSync(p));
assert(!!bin && existsSync(bin), !bin ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: GAMEVIEWSTYLE_ENGINE=/path/to/Chromium node gameviewstyletest.mjs. A missing browser is a FAILURE, never a skip.` : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

const tmp = mkdtempSync(join(tmpdir(), 'cfbp-gvstyle-'));
const CSS_HREF = 'file://' + here + 'css/styles.css';
const NOANIM = '<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>';
let fileN = 0;
/** The REAL index.html shell (scripts removed, the boot cover lifted) with one captured surface in place: a page section replaced, or the pushed root appended. */
function shell({ section = null, sectionId = null, pushed = null, tab = 'home', css = CSS_HREF, bodyClass = '' }) {
  let h = INDEX.replace(/<script[\s\S]*?<\/script>/g, '').replace(/ inert(?=[\s>])/g, '').replace(/ aria-hidden="true"(?=[^>]*class="(?:main-content|bottom-nav)")/g, '');
  h = h.replace(/<link[^>]*rel="stylesheet"[^>]*>/g, `<link rel="stylesheet" href="${css}">`).replace(/<link[^>]*rel="(manifest|apple-touch-icon|icon)"[^>]*>/g, '');
  if (section && sectionId) {
    h = h.replace(/<section class="page-section[^"]*" id="page-home">[\s\S]*?<\/section>/, (m) => m.replace(' active', ''));
    h = h.replace(new RegExp(`<section class="page-section[^"]*" id="${sectionId}">[\\s\\S]*?</section>`), section.replace(/class="page-section(?![^"]*active)/, 'class="page-section active'));
  }
  if (pushed) h = h.replace('</body>', `${pushed}</body>`);
  h = h.replace('</head>', `${NOANIM}</head>`);
  h = h.replace(/<body class="cfbp-booting"[^>]*>/, `<body class="theme-neutral${bodyClass ? ' ' + bodyClass : ''}" data-tab="${tab}" data-color-scheme="light">`);
  const file = join(tmp, `p${++fileN}.html`);
  writeFileSync(file, h);
  return file;
}
function sheet(transform) {
  const css = read('css/styles.css');
  const out = transform(css);
  if (out === css) throw new Error('sheet(): the transform changed nothing');
  const file = join(tmp, `s${++fileN}.css`);
  writeFileSync(file, out);
  return 'file://' + file;
}
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--allow-file-access-from-files', '--hide-scrollbars', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions',
    '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', (d) => { buf += d.toString(); const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(t); res({ proc, ws: m[0] }); } });
    proc.on('error', (e) => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await REAL_FETCH('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true }); });
  let id = 0; const pending = new Map(); const waiters = [];
  sock.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) waiters.filter((w) => w.method === msg.method).forEach((w) => w.res()); });
  const send = (method, params = {}) => new Promise((res, rej) => { const myId = ++id; pending.set(myId, (m) => (m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result))); sock.send(JSON.stringify({ id: myId, method, params })); });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once };
}

// ── in-page measurement library ──
function R(e) { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
function vis(e) { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }
function gap2(a, b) { const dx = Math.max(0, Math.max(b.l - a.r, a.l - b.r)), dy = Math.max(0, Math.max(b.t - a.b, a.t - b.b)); return Math.hypot(dx, dy); }
function minPair(list) { const rs = list.filter(vis).map(R); let m = Infinity; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.min(m, gap2(rs[i], rs[j])); return m === Infinity ? null : +m.toFixed(2); }
const LIB = [R, vis, gap2, minPair].map((f) => f.toString()).join('\n');

/** [1] the Game view, measured. */
function gvMeasure() {
  const level = document.querySelector('#pushed-root .ps-level:last-child');
  const body = level.querySelector('[data-ps-body]');
  const gv = body.querySelector('.gv');
  const cards = [...gv.children].filter((e) => !e.hasAttribute('data-gv-live') && vis(e));
  const cardGaps = cards.slice(1).map((c, i) => +(c.getBoundingClientRect().top - cards[i].getBoundingClientRect().bottom).toFixed(2));
  const steps = [...level.querySelectorAll('.gv-step-btn')].map((b) => [+b.getBoundingClientRect().width.toFixed(1), +b.getBoundingClientRect().height.toFixed(1)]);
  const stepGap = minPair([...level.querySelectorAll('.gv-step-btn')]);
  const groups = [...gv.querySelectorAll('.gv-actions')].filter(vis).map((g) => {
    const bs = [...g.querySelectorAll('button')].filter(vis);
    const gr = g.getBoundingClientRect();
    const u = bs.length ? { l: Math.min(...bs.map((b) => b.getBoundingClientRect().left)), r: Math.max(...bs.map((b) => b.getBoundingClientRect().right)) } : null;
    return { n: bs.length, h: bs.map((b) => +b.getBoundingClientRect().height.toFixed(1)), gap: bs.length > 1 ? minPair(bs) : null, centerDev: u ? +Math.abs((u.l + u.r) / 2 - (gr.left + gr.right) / 2).toFixed(2) : null, inside: bs.every((b) => b.getBoundingClientRect().left >= gr.left - 0.5 && b.getBoundingClientRect().right <= gr.right + 0.5) };
  });
  const overflow = Math.max(document.documentElement.scrollWidth - innerWidth, body.scrollWidth - body.clientWidth, ...cards.map((c) => c.scrollWidth - c.clientWidth));
  const wide = [...gv.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > body.getBoundingClientRect().right + 0.5 && vis(e)).slice(0, 3).map((e) => (e.className || e.tagName) + '');
  const rels = [...gv.querySelectorAll('.gv-rel')].filter(vis);
  const br = body.getBoundingClientRect();
  const relInfo = rels.map((r) => R(r));
  const relGaps = relInfo.slice(1).map((r, i) => +(r.t - relInfo[i].b).toFixed(2));
  const lockups = [...gv.querySelectorAll('.gv-score .tl')].map((t) => [+t.getBoundingClientRect().width.toFixed(1), +t.getBoundingClientRect().height.toFixed(1)]);
  return { cards: cards.length, cardGaps, steps, stepGap, groups, overflow, wide, rels: rels.length, relWidths: relInfo.map((r) => +r.w.toFixed(1)), relHeights: relInfo.map((r) => +r.h.toFixed(1)), relInside: relInfo.every((r) => r.l >= br.left - 0.5 && r.r <= br.right + 0.5), relGaps, lockups, bodyW: +br.width.toFixed(1) };
}
/** [1k] What's next (DI-599 / DI-593): the block, its sentence, its buttons. */
function nextMeasure() {
  const level = document.querySelector('#pushed-root .ps-level:last-child');
  const body = level.querySelector('[data-ps-body]');
  const card = body.querySelector('[data-gv="next"]');
  if (!card || !vis(card)) return { present: false };
  const line = card.querySelector('[data-bind="next-line"]'), cap = card.querySelector('[data-bind="next-results"]');
  const g = card.querySelector('.gv-actions');
  const bs = g ? [...g.querySelectorAll('button')].filter(vis) : [];
  const gr = g ? g.getBoundingClientRect() : null, cr = card.getBoundingClientRect();
  const u = bs.length ? { l: Math.min(...bs.map((b) => b.getBoundingClientRect().left)), r: Math.max(...bs.map((b) => b.getBoundingClientRect().right)) } : null;
  let prev = card.previousElementSibling; while (prev && !vis(prev)) prev = prev.previousElementSibling;
  const kids = [...card.children].filter(vis);
  const innerGaps = kids.slice(1).map((k, i) => +(k.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom).toFixed(2));
  return {
    present: true, lineH: line ? +line.getBoundingClientRect().height.toFixed(1) : 0, lineInside: !!line && line.getBoundingClientRect().right <= cr.right + 0.5 && line.scrollWidth <= line.clientWidth + 1,
    capShown: !!cap && vis(cap), btns: bs.length, btnH: bs.map((b) => +b.getBoundingClientRect().height.toFixed(1)), btnGap: bs.length > 1 ? minPair(bs) : null,
    centerDev: u && gr ? +Math.abs((u.l + u.r) / 2 - (gr.left + gr.right) / 2).toFixed(2) : null, gapAbove: prev ? +(cr.top - prev.getBoundingClientRect().bottom).toFixed(2) : null,
    innerGaps, overflow: Math.max(card.scrollWidth - card.clientWidth, document.documentElement.scrollWidth - innerWidth),
  };
}
/** [2] Game Day's open card rows with logos. */
function rowsMeasure() {
  const rows = [...document.querySelectorAll('#gd-card .gd-row')].filter(vis);
  const tls = [...document.querySelectorAll('#gd-card .gd-row .tl--sm')].map((t) => [+t.getBoundingClientRect().width.toFixed(1), +t.getBoundingClientRect().height.toFixed(1)]);
  const over = rows.filter((r) => [...r.querySelectorAll('*')].some((e) => vis(e) && e.getBoundingClientRect().right > r.getBoundingClientRect().right + 0.5)).length;
  const card = document.getElementById('gd-card');
  return { rows: rows.length, rowH: rows.map((r) => +r.getBoundingClientRect().height.toFixed(1)), tls, over, cardOverflow: card.scrollWidth - card.clientWidth, docOverflow: document.documentElement.scrollWidth - innerWidth };
}
/** [3] the Standard note. */
function noteMeasure() {
  const n = document.querySelector('[data-pg-std-note]');
  if (!n) return { present: false };
  const btn = n.querySelector('button'), tx = n.querySelector('.pg-std-note-tx');
  const nr = n.getBoundingClientRect(), b = btn.getBoundingClientRect();
  let next = n.nextElementSibling; while (next && !vis(next)) next = next.nextElementSibling;
  const items = [tx, btn].filter(vis);
  const u = { l: Math.min(...items.map((e) => e.getBoundingClientRect().left)), r: Math.max(...items.map((e) => e.getBoundingClientRect().right)) };
  return { present: vis(n), btnH: +b.height.toFixed(1), btnW: +b.width.toFixed(1), gapToNext: next ? +(next.getBoundingClientRect().top - nr.bottom).toFixed(2) : null, itemGap: minPair(items), centerDev: +Math.abs((u.l + u.r) / 2 - (nr.left + nr.right) / 2).toFixed(2), overflow: Math.max(n.scrollWidth - n.clientWidth, document.documentElement.scrollWidth - innerWidth), btnInside: b.left >= nr.left - 0.5 && b.right <= nr.right + 0.5 };
}
/** [4] the Back chip. */
function chipMeasure(longLabel) {
  const row = document.querySelector('.chat-return-row'), chip = row && row.querySelector('.chat-return-chip'), text = chip && chip.querySelector('.chat-return-text');
  if (!row || !chip) return { present: false };
  if (longLabel) text.textContent = 'Back to ' + longLabel;
  const rr = row.getBoundingClientRect(), cr = chip.getBoundingClientRect();
  let next = row.nextElementSibling; while (next && !vis(next)) next = next.nextElementSibling;
  return { present: vis(chip), chipH: +cr.height.toFixed(1), leftInset: +(cr.left - rr.left).toFixed(2), rightRoom: +(rr.right - cr.right).toFixed(2), textInside: text.getBoundingClientRect().right <= cr.right + 0.5, ellipsis: getComputedStyle(text).textOverflow, bottomPad: +(rr.bottom - cr.bottom).toFixed(2), docOverflow: document.documentElement.scrollWidth - innerWidth, nextGap: next ? +(next.getBoundingClientRect().top - cr.bottom).toFixed(2) : null };
}

/** [6] the game thread sheet (DI-592). */
function threadMeasure() {
  const wrap = document.getElementById('chat-sheet-wrap'), sheetEl = document.getElementById('chat-thread-sheet');
  if (!wrap || !sheetEl) return { present: false };
  const header = sheetEl.querySelector('.chat-sheet-header'), head = sheetEl.querySelector('.chat-sheet-head-text'), actions = sheetEl.querySelector('.chat-sheet-header-actions');
  const close = document.getElementById('chat-sheet-close'), row = sheetEl.querySelector('.chat-sheet-openrow'), open = document.getElementById('chat-sheet-open-main');
  const lens = sheetEl.querySelector('.chat-sheet-lens'), title = sheetEl.querySelector('.chat-sheet-title'), grab = sheetEl.querySelector('.sheet-grabber');
  const cr = close.getBoundingClientRect(), rr = row.getBoundingClientRect(), orr = open.getBoundingClientRect(), hr = header.getBoundingClientRect(), sr = sheetEl.getBoundingClientRect();
  const lr = lens.getBoundingClientRect(), tr = title.getBoundingClientRect();
  const out = {
    present: true, closeW: +cr.width.toFixed(1), closeH: +cr.height.toFixed(1), openH: +orr.height.toFixed(1),
    openCenterDev: +Math.abs((orr.left + orr.right) / 2 - (rr.left + rr.right) / 2).toFixed(2), openBelowLine: +(orr.top - rr.top - parseFloat(getComputedStyle(row).borderTopWidth || '0')).toFixed(2), rowLine: getComputedStyle(row).borderTopWidth,
    lensShown: vis(lens) && lr.top >= hr.top - 0.5 && lr.bottom <= hr.bottom + 0.5 && lens.textContent.trim() === 'Also appears in the Locker Room',
    headClear: head.getBoundingClientRect().right <= actions.getBoundingClientRect().left + 0.5,
    overflow: Math.max(0, sheetEl.scrollWidth - sheetEl.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
  if (grab) {
    const gr = grab.getBoundingClientRect();
    Object.assign(out, { grab: true, grabW: +gr.width.toFixed(1), grabH: +gr.height.toFixed(1), grabCenterDev: +Math.abs((gr.left + gr.right) / 2 - (hr.left + hr.right) / 2).toFixed(2), titleBelowGrab: tr.top >= gr.bottom });
  } else out.grab = false;
  void sr;
  return out;
}

/** [7] the Share sheet (DI-597). */
function shareMeasure() {
  const sheetEl = document.getElementById('share-sheet');
  if (!sheetEl) return { present: false };
  const body = document.getElementById('share-sheet-body'), close = document.getElementById('share-sheet-close'), ta = document.getElementById('share-comment');
  const btns = [...sheetEl.querySelectorAll('.share-actions .share-btn')], row = sheetEl.querySelector('.share-actions'), icon = sheetEl.querySelector('.share-eyebrow-icon');
  const header = sheetEl.querySelector('.chat-sheet-header'), grab = sheetEl.querySelector('.sheet-grabber'), title = document.getElementById('share-sheet-title');
  const cr = close.getBoundingClientRect(), tr = ta.getBoundingClientRect(), br = body.getBoundingClientRect(), rr = row.getBoundingClientRect();
  const kids = [...body.children].filter(vis).map(R);
  const gaps = []; for (let i = 1; i < kids.length; i++) gaps.push(+(kids[i].t - kids[i - 1].b).toFixed(2));
  const brs = btns.map((b) => b.getBoundingClientRect());
  const lo = Math.min(...brs.map((x) => x.left)), hi = Math.max(...brs.map((x) => x.right));
  const out = {
    present: true, closeW: +cr.width.toFixed(1), closeH: +cr.height.toFixed(1), taH: +tr.height.toFixed(1), taFull: Math.abs(tr.width - br.width) <= 8.5,
    btnH: brs.map((x) => +x.height.toFixed(1)), btnTop: brs.map((x) => +x.top.toFixed(1)), btnW: brs.map((x) => +x.width.toFixed(1)), rowW: +rr.width.toFixed(1), btnGap: minPair(btns), centerDev: +Math.abs((lo + hi) / 2 - (rr.left + rr.right) / 2).toFixed(2), gaps,
    icon: icon ? [+icon.getBoundingClientRect().width.toFixed(1), +icon.getBoundingClientRect().height.toFixed(1)] : null,
    overflow: Math.max(0, sheetEl.scrollWidth - sheetEl.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
  if (grab) { const gr = grab.getBoundingClientRect(), hr = header.getBoundingClientRect(); Object.assign(out, { grab: [+gr.width.toFixed(1), +gr.height.toFixed(1)], grabDev: +Math.abs((gr.left + gr.right) / 2 - (hr.left + hr.right) / 2).toFixed(2), titleBelow: title.getBoundingClientRect().top >= gr.bottom }); }
  return out;
}
/** [7] a shared message's attachment in Chat. */
function attachMeasure() {
  const a = document.querySelector('.chat-share-attach[data-share-open]');
  if (!a) return { present: false };
  const ar = a.getBoundingClientRect(), col = a.closest('.chat-bubble-col').getBoundingClientRect();
  return { present: true, h: +ar.height.toFixed(1), inside: ar.left >= col.left - 0.5 && ar.right <= col.right + 0.5, overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth) };
}

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const cdp = await attach(engine.ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  async function measure(file, fn, { w = 375, h = 812, scale = 1, args = null } = {}) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: 'file://' + file });
    await loaded;
    if (scale !== 1) await cdp.send('Runtime.evaluate', { expression: `document.documentElement.style.fontSize='${scale * 100}%'` });
    const r = await cdp.send('Runtime.evaluate', { expression: `(async () => { ${LIB}\n return (${fn.toString()})(${JSON.stringify(args)}); })()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('measure threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  }
  const TEXTS = [{ name: 'default', scale: 1 }, { name: '1.35x', scale: 1.35 }];

  // ── [1] THE GAME VIEW ──
  console.log('\n[1] The Game view at 375 pt, default and 1.35x text…');
  const GV = { final: CAP.gvFinal, live: CAP.gvLive, due: CAP.gvDue };
  const gvRows = [];
  for (const [name, pushed] of Object.entries(GV)) for (const tx of TEXTS) gvRows.push({ name, tx: tx.name, ...(await measure(shell({ pushed }), gvMeasure, { scale: tx.scale })) });
  const liveRows = gvRows.filter((r) => r.name === 'live');
  assert(liveRows.every((r) => r.steps.length === 2 && r.steps.every(([w, h]) => Math.abs(w - 44) <= 0.5 && Math.abs(h - 44) <= 0.5) && r.stepGap >= 7.5), `1a: the prev / next buttons are 44 x 44 pt and 8 pt apart, at both text sizes (${liveRows.map((r) => `${r.tx}: ${JSON.stringify(r.steps)} gap ${r.stepGap}`).join('; ')})`);
  const allGroups = gvRows.flatMap((r) => r.groups.map((g) => ({ ...g, where: `${r.name}/${r.tx}` })));
  assert(allGroups.length >= 6 && allGroups.every((g) => g.h.every((x) => x >= 43.5)), `1b: every button in every action group is >= 44 pt tall (${allGroups.length} groups: the thread's Open thread / Locker Room, What's next, Make your picks)${allGroups.some((g) => g.h.some((x) => x < 43.5)) ? ' — SHORT: ' + allGroups.filter((g) => g.h.some((x) => x < 43.5)).map((g) => g.where + ' ' + g.h).join('; ') : ''}`);
  assert(allGroups.every((g) => g.centerDev !== null && g.centerDev <= 1.5 && g.inside), `1c: …each group is CENTRED in its card (worst deviation ${Math.max(...allGroups.map((g) => g.centerDev))} pt) and stays inside it`);
  const pairs = allGroups.filter((g) => g.n > 1);
  assert(pairs.length >= 3 && pairs.every((g) => g.gap >= 7.5 && g.gap <= 8.5), `1d: …and its buttons are 8 pt apart, side by side or stacked (${pairs.map((g) => `${g.where} ${g.gap}`).join(', ')})`);
  assert(gvRows.every((r) => r.cards >= 3 && r.cardGaps.every((g) => Math.abs(g - 16) <= 0.5)), `1e: the cards are 16 pt apart (${gvRows.map((r) => `${r.name}/${r.tx}: ${r.cardGaps.join(',')}`).join('; ')})`);
  assert(gvRows.every((r) => r.overflow <= 1), `1f: NO horizontal overflow — not the document, not the body, not a card — at 375 pt and 1.35x text${gvRows.some((r) => r.overflow > 1) ? ' — WIDE: ' + gvRows.filter((r) => r.overflow > 1).map((r) => `${r.name}/${r.tx} +${r.overflow} ${r.wide.join(',')}`).join('; ') : ''}`);
  const fin = gvRows.filter((r) => r.name === 'final');
  assert(fin.every((r) => r.rels === 3 && r.relInside && r.relWidths.every((w) => w >= r.bodyW - 32 - 1) && r.relHeights.every((h) => h >= 44) && r.relGaps.every((g) => Math.abs(g - 8) <= 0.5)), `1g: the Related cards are LAID OUT: three full-width cards inside the body, each >= 44 pt tall, 8 pt apart (${fin.map((r) => `${r.tx}: ${r.rels} cards, widths ${r.relWidths.join('/')} of ${r.bodyW}, gaps ${r.relGaps.join(',')}`).join('; ')})`);
  assert(gvRows.every((r) => r.lockups.length === 2 && r.lockups.every(([w, h]) => Math.abs(w - 48) <= 0.5 && Math.abs(h - 48) <= 0.5)), '1h: the score card\'s team lockups are 48 x 48 pt (DI-572: the box never changes size)');

  // [1k] What's next: the block on a FINAL game, with two buttons (Make your picks, See week results) and with one (See week results)
  {
    const nx = [];
    for (const [name, pushed] of [['two', CAP.gvNext], ['one', CAP.gvFinal]]) for (const tx of TEXTS) nx.push({ name, tx: tx.name, ...(await measure(shell({ pushed }), nextMeasure, { scale: tx.scale })) });
    assert(nx.every((r) => r.present && r.lineH >= 16 && r.lineInside && r.overflow <= 1), `1k: What's next is drawn on a Final game, its sentence laid out inside the card (no overflow) at both text sizes (${nx.map((r) => `${r.name}/${r.tx}: line ${r.lineH} pt`).join('; ')})`);
    assert(nx.every((r) => r.btns === (r.name === 'two' ? 2 : 1) && r.btnH.every((h) => h >= 43.5) && r.centerDev !== null && r.centerDev <= 1.5 && (r.btnGap === null || (r.btnGap >= 7.5 && r.btnGap <= 8.5))), `1l: …its buttons are >= 44 pt, centred, and 8 pt apart side by side or stacked (${nx.map((r) => `${r.name}/${r.tx}: ${r.btns} btn ${r.btnH.join('/')} gap ${r.btnGap} dev ${r.centerDev}`).join('; ')})`);
    assert(nx.every((r) => Math.abs(r.gapAbove - 16) <= 0.5 && r.innerGaps.every((g) => Math.abs(g - 8) <= 0.5)), `1m: …16 pt below the card above it, its parts 8 pt apart (${nx.map((r) => `${r.name}/${r.tx}: above ${r.gapAbove}, inside ${r.innerGaps.join(',')}`).join('; ')})`);
  }

  // [1n] DI-593: the status chip's CROSS-FADE lays the old chip and the new one in the SAME cell (no jump), the old one aria-hidden and untouchable
  {
    const xf = async ({ src }) => {
      const dom = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const st = document.querySelector('#pushed-root .ps-level:last-child [data-bind="status"]');
      const before = st.getBoundingClientRect();
      const did = dom.crossFadePart(st, () => { st.innerHTML = '<span class="gd-st gd-st--final">Final</span>'; }, { reduced: false, setTimer: (fn, ms) => setTimeout(fn, ms) });
      const ghost = st.querySelector('.gv-xf-ghost'), now = st.querySelector('.gd-st--final');
      const gr = ghost.getBoundingClientRect(), nr = now.getBoundingClientRect(), after = st.getBoundingClientRect();
      const cs = getComputedStyle(ghost);
      return { did, sameCell: Math.abs((gr.top + gr.bottom) / 2 - (nr.top + nr.bottom) / 2) <= 1 && Math.abs((gr.left + gr.right) / 2 - (nr.left + nr.right) / 2) <= 1, heightJump: +(after.height - before.height).toFixed(1), pe: cs.pointerEvents, hidden: ghost.getAttribute('aria-hidden') };
    };
    const X = await measure(shell({ pushed: CAP.gvLive }), xf, { args: { src: read('js/gameday-dom.js') } });
    assert(X.did && X.sameCell && Math.abs(X.heightJump) <= 1 && X.pe === 'none' && X.hidden === 'true', `1n: DI-593 — the status chip's cross-fade stacks the old chip and "Final" in ONE cell, centred on each other (no jump: ${X.heightJump} pt), the old one aria-hidden and untouchable (${X.pe})`);
  }

  // [1i] P-3 for the prev / next CROSS-FADE (a 150 ms deferral): while the old body's ghost is fading on top, a NEW tap lands on the real body underneath — the ghost takes no touches
  {
    const domSrc = read('js/gameday-dom.js');
    const ghostProbe = async ({ src }) => {
      const dom = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const level = document.querySelector('#pushed-root .ps-level:last-child');
      const body = level.querySelector('[data-ps-body]');
      const started = dom.crossFadeBody(body, () => {}, { reduced: false, setTimer: (fn, ms) => setTimeout(fn, ms) });
      const ghost = level.querySelector('.ps-body-ghost');
      const target = [...body.querySelectorAll('[data-gv-action]')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top > 80 && r.bottom < innerHeight - 20; });
      const r = target.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const cs = ghost ? getComputedStyle(ghost) : null;
      const pe = cs ? cs.pointerEvents : null, pos = cs ? cs.position : null;      // read NOW: a computed style is live, and empty once the ghost is gone
      const gr = ghost ? ghost.getBoundingClientRect() : null, br = body.getBoundingClientRect();
      const hitReal = !!hit && !hit.closest('.ps-body-ghost') && !!hit.closest('[data-ps-body]') && hit.closest('[data-gv-action]') === target;
      await new Promise((res) => setTimeout(res, 260));
      return { started, ghost: !!ghost, pe, pos, sameBox: !!gr && Math.abs(gr.top - br.top) <= 0.5 && Math.abs(gr.height - br.height) <= 0.5 && Math.abs(gr.width - br.width) <= 0.5, hitReal, gone: !level.querySelector('.ps-body-ghost') };
    };
    const G = await measure(shell({ pushed: CAP.gvLive }), ghostProbe, { args: { src: domSrc } });
    assert(G.started && G.ghost && G.pos === 'absolute' && G.sameBox && G.pe === 'none', `1i: the prev / next cross-fade lays the old body's ghost exactly over the body (absolute, same box) and it takes no touches (pointer-events: ${G.pe})`);
    assert(G.hitReal && G.gone, `1j: P-3 — a NEW tap during the 150 ms fade lands on the real button underneath (hit the real control: ${G.hitReal}); the ghost is gone after the fade (${G.gone})`);
  }

  // ── [2] GAME DAY'S ROW LOGOS ──
  console.log('\n[2] Game Day\'s open card with Team logos on…');
  const gdRows = [];
  for (const tx of TEXTS) gdRows.push({ tx: tx.name, ...(await measure(shell({ section: CAP.home, sectionId: 'page-home' }), rowsMeasure, { scale: tx.scale })) });
  assert(gdRows.every((r) => r.rows >= 2 && r.tls.length === r.rows * 2 && r.tls.every(([w, h]) => Math.abs(w - 24) <= 0.5 && Math.abs(h - 24) <= 0.5)), `2a: every row's two lockups are 24 x 24 pt (${gdRows.map((r) => `${r.tx}: ${r.tls.length} lockups in ${r.rows} rows`).join('; ')})`);
  // [2c] DI-604: a LEAVING pill (collapsed card, live games) is invisible and untouchable for its fade, and keeps its box (nothing shifts until it is removed)
  {
    const leave = () => {
      const pills = [...document.querySelectorAll('#gd-card .gdp')];
      const p = pills[0], next = pills[1];
      const w0 = p.getBoundingClientRect().width, x1 = next.getBoundingClientRect().left;
      p.setAttribute('data-leaving', 'true');
      const cs = getComputedStyle(p);
      return { n: pills.length, opacity: cs.opacity, pe: cs.pointerEvents, keepsBox: Math.abs(p.getBoundingClientRect().width - w0) <= 0.5 && Math.abs(next.getBoundingClientRect().left - x1) <= 0.5 };
    };
    const Lv = await measure(shell({ section: CAP.homeCollapsed, sectionId: 'page-home' }), leave);
    assert(Lv.n >= 2 && Lv.opacity === '0' && Lv.pe === 'none' && Lv.keepsBox, `2c: DI-604 — a leaving pill computes to opacity ${Lv.opacity}, pointer-events ${Lv.pe}, and keeps its box (the next pill does not move during the fade: ${Lv.keepsBox})`);
  }
  assert(gdRows.every((r) => r.rowH.every((h) => h >= 43.5) && r.over === 0 && r.cardOverflow <= 1 && r.docOverflow <= 1), `2b: …each row is >= 44 pt and nothing in it is wider than the row or the card, at 375 pt and 1.35x (${gdRows.map((r) => `${r.tx}: rows ${r.rowH.join('/')}`).join('; ')})`);

  // ── [3] THE STANDARD NOTE ──
  console.log('\n[3] The Dashboard\'s Standard matrix + By team note…');
  const notes = [];
  for (const tx of TEXTS) notes.push({ tx: tx.name, ...(await measure(shell({ section: CAP.dash, sectionId: 'page-dashboard', tab: 'dashboard' }), noteMeasure, { scale: tx.scale })) });
  assert(notes.every((n) => n.present && n.btnH >= 43.5 && n.btnInside), `3a: the note is drawn and its Compact button is >= 44 pt, inside it (${notes.map((n) => `${n.tx}: ${n.btnW}x${n.btnH}`).join('; ')})`);
  assert(notes.every((n) => n.gapToNext !== null && n.gapToNext >= 15.5 && n.itemGap >= 7.5 && n.centerDev <= 1.5 && n.overflow <= 1), `3b: …16 pt above the matrix, the sentence and the button 8 pt or more apart and centred, nothing overflowing (${notes.map((n) => `${n.tx}: next ${n.gapToNext}, gap ${n.itemGap}, dev ${n.centerDev}`).join('; ')})`);

  // ── [4] THE BACK CHIP ──
  console.log('\n[4] Chat\'s "Back to …" chip…');
  const chips = [];
  for (const tx of TEXTS) for (const long of [null, 'Florida State at North Carolina State — Week 12 (part 2) and a very long name']) chips.push({ tx: tx.name, long: !!long, ...(await measure(shell({ section: CAP.chat, sectionId: 'page-chat', tab: 'chat' }), chipMeasure, { scale: tx.scale, args: long })) });
  assert(chips.every((c) => c.present && c.chipH >= 43.5 && Math.abs(c.leftInset - 16) <= 0.5 && c.rightRoom >= 15.5), `4a: the chip is >= 44 pt tall and 16 pt in from both sides (${chips.map((c) => `${c.tx}${c.long ? ' long' : ''}: ${c.chipH} pt, in ${c.leftInset}/${c.rightRoom}`).join('; ')})`);
  assert(chips.every((c) => c.textInside && c.ellipsis === 'ellipsis' && c.docOverflow <= 1 && Math.abs(c.bottomPad - 8) <= 0.5), `4b: …a long label ellipsizes INSIDE the chip (never past it, no page overflow), with 8 pt below it to the pills (${chips.map((c) => `${c.tx}${c.long ? ' long' : ''}: pad ${c.bottomPad}`).join('; ')})`);

  // ── [6] THE GAME THREAD SHEET ──
  console.log('\n[6] The game thread sheet (DI-592), web and native, default and 1.35x text…');
  const threads = [];
  for (const tx of TEXTS) for (const [kind, pushed, bodyClass] of [['web', CAP.thread, ''], ['native', CAP.threadNative, 'native-shell']]) threads.push({ kind, tx: tx.name, ...(await measure(shell({ pushed, bodyClass }), threadMeasure, { scale: tx.scale })) });
  const fmtT = (f) => threads.map((t) => `${t.kind}/${t.tx}: ${f(t)}`).join('; ');
  assert(threads.length === 4 && threads.every((t) => t.present && Math.abs(t.closeW - 44) <= 0.5 && Math.abs(t.closeH - 44) <= 0.5), `6a: the close is 44 x 44 pt (${fmtT((t) => `${t.closeW}x${t.closeH}`)})`);
  assert(threads.every((t) => t.openH >= 43.5 && t.openCenterDev <= 1 && Math.abs(t.openBelowLine - 8) <= 0.5 && t.rowLine === '1px'), `6b: "Open in chat" is >= 44 pt, centred in its own row, 8 pt under the row's hairline (${fmtT((t) => `${t.openH} pt, off ${t.openCenterDev}, ${t.openBelowLine} below a ${t.rowLine} line`)})`);
  assert(threads.every((t) => t.lensShown && t.headClear && t.overflow <= 1), `6c: the subtitle is laid out inside the header, the title block never runs under the actions, nothing is wider than the sheet (${fmtT((t) => `lens ${t.lensShown}, clear ${t.headClear}, over ${t.overflow}`)})`);
  const natives = threads.filter((t) => t.kind === 'native'), webs = threads.filter((t) => t.kind === 'web');
  assert(natives.every((t) => t.grab && Math.abs(t.grabW - 36) <= 0.5 && Math.abs(t.grabH - 5) <= 0.5 && t.grabCenterDev <= 1 && t.titleBelowGrab) && webs.every((t) => !t.grab), `6d: native: the grabber is 36 x 5 pt, centred, above the title; the web has none (${natives.map((t) => `${t.tx}: ${t.grabW}x${t.grabH}, off ${t.grabCenterDev}, below ${t.titleBelowGrab}`).join('; ')})`);

  // ── [7] SHARE TO CHAT ──
  console.log('\n[7] Share to chat (DI-597): the sheet, web and native, default and 1.35x text; the attachment in Chat…');
  const sheets = [];
  for (const tx of TEXTS) for (const [kind, pushed, bodyClass] of [['web', CAP.share, ''], ['native', CAP.shareNative, 'native-shell']]) sheets.push({ kind, tx: tx.name, ...(await measure(shell({ pushed, bodyClass }), shareMeasure, { scale: tx.scale })) });
  const fmtS = (f) => sheets.map((t) => `${t.kind}/${t.tx}: ${f(t)}`).join('; ');
  assert(sheets.length === 4 && sheets.every((t) => t.present && Math.abs(t.closeW - 44) <= 0.5 && Math.abs(t.closeH - 44) <= 0.5), `7a: the close is 44 x 44 pt (${fmtS((t) => `${t.closeW}x${t.closeH}`)})`);
  assert(sheets.every((t) => t.btnH.length === 2 && t.btnH.every((h) => h >= 43.5) && Math.max(...t.btnH) - Math.min(...t.btnH) <= 0.5 && t.btnGap !== null && t.btnGap >= 7.5 && t.btnGap <= 8.5 && t.centerDev <= 1), `7b: "Post to chat" and "Cancel" are >= 44 pt and ONE height (side by side, or stacked at the largest text), 8 pt apart, centred (${fmtS((t) => `${t.btnH.join('/')} pt tall at ${t.btnTop.join('/')}, ${t.btnW.join('/')} wide in ${t.rowW}, gap ${t.btnGap}, off ${t.centerDev}`)})`);
  assert(sheets.every((t) => t.taH >= 43.5 && t.taFull && t.gaps.length >= 3 && t.gaps.every((g) => Math.abs(g - 16) <= 0.5) && t.icon && Math.abs(t.icon[0] - 16) <= 0.5 && Math.abs(t.icon[1] - 16) <= 0.5 && t.overflow <= 1), `7c: the comment field is >= 44 pt and full width, the body's parts are 16 pt apart, the preview's glyph is 16 pt, nothing overflows (${fmtS((t) => `field ${t.taH}, gaps ${t.gaps.join(',')}, over ${t.overflow}`)})`);
  const sNat = sheets.filter((t) => t.kind === 'native');
  assert(sNat.every((t) => t.grab && Math.abs(t.grab[0] - 36) <= 0.5 && Math.abs(t.grab[1] - 5) <= 0.5 && t.grabDev <= 1 && t.titleBelow) && sheets.filter((t) => t.kind === 'web').every((t) => !t.grab), `7d: native: the grabber is 36 x 5 pt, centred, above the title; the web has none (${sNat.map((t) => `${t.tx}: ${t.grab}, off ${t.grabDev}`).join('; ')})`);
  const atts = [];
  for (const tx of TEXTS) atts.push({ tx: tx.name, ...(await measure(shell({ section: CAP.chatShare, sectionId: 'page-chat', tab: 'chat' }), attachMeasure, { scale: tx.scale })) });
  assert(atts.every((a) => a.present && a.h >= 43.5 && a.inside && a.overflow <= 1), `7e: a shared message's "Open details" is >= 44 pt and stays inside its bubble column (${atts.map((a) => `${a.tx}: ${a.h} pt, inside ${a.inside}`).join('; ')})`);

  // ── [5] ANTI-VACUITY ──
  console.log('\n[5] Anti-vacuity — every detector fed a sheet that breaks its rule must go RED…');
  {
    const a = await measure(shell({ pushed: CAP.gvLive, css: sheet((c) => c + '\n.gv-step-btn{width:30px;height:30px}\n') }), gvMeasure);
    assert(a.steps.some(([w, h]) => w < 43 || h < 43), `5a: with 30 pt step buttons the 44 x 44 detector reads ${JSON.stringify(a.steps)} — so [1a] is a measurement`);
    const b = await measure(shell({ pushed: CAP.gvFinal, css: sheet((c) => c + '\n.gv-actions{gap:0}\n') }), gvMeasure);
    assert(b.groups.some((g) => g.n > 1 && g.gap < 7.5), '5b: with the group gap removed the buttons touch — so [1d] can fail');
    const c2 = await measure(shell({ pushed: CAP.gvFinal, css: sheet((c) => c + '\n.gv{gap:4px}\n') }), gvMeasure);
    assert(c2.cardGaps.some((g) => Math.abs(g - 16) > 0.5), `5c: with a 4 pt card gap the 16 pt detector reads ${c2.cardGaps.join(',')} — so [1e] can fail`);
    const d = await measure(shell({ pushed: CAP.gvFinal, css: sheet((c) => c + '\n.gv-card{min-width:520px}\n') }), gvMeasure);
    assert(d.overflow > 1, `5d: a card 520 pt wide overflows (${d.overflow}) — so [1f] can fail`);
    const e = await measure(shell({ pushed: CAP.gvFinal, css: sheet((c) => c + '\n.gv-actions{justify-content:flex-start}\n.gv-btn{flex:0 0 auto}\n') }), gvMeasure);
    assert(e.groups.some((g) => g.centerDev > 1.5), '5e: a left-packed group is caught off-centre — so [1c] can fail');
    const f = await measure(shell({ pushed: CAP.gvFinal, css: sheet((c) => c + '\n.gv-related-list{display:none}\n') }), gvMeasure);
    assert(f.rels === 0, '5f: Related cards that are not laid out are counted as missing — so [1g] can fail');
    const g = await measure(shell({ section: CAP.home, sectionId: 'page-home', css: sheet((c) => c + '\n.tl--sm{width:40px;height:40px}\n') }), rowsMeasure);
    assert(g.tls.some(([w]) => Math.abs(w - 24) > 0.5), '5g: a row lockup that is not 24 pt is caught — so [2a] can fail');
    const h2 = await measure(shell({ section: CAP.dash, sectionId: 'page-dashboard', tab: 'dashboard', css: sheet((c) => c + '\n.pg-std-note .btn{min-height:30px;height:30px}\n.pg-std-note{margin:0}\n') }), noteMeasure);
    assert(h2.btnH < 43.5 && h2.gapToNext < 15.5, `5h: a 30 pt Compact button and a note with no margin are caught (${h2.btnH} pt, ${h2.gapToNext} pt) — so [3a]/[3b] can fail`);
    const gProbe = async ({ src }) => {
      const dom = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const level = document.querySelector('#pushed-root .ps-level:last-child'), body = level.querySelector('[data-ps-body]');
      dom.crossFadeBody(body, () => {}, { reduced: false, setTimer: (fn, ms) => setTimeout(fn, ms) });
      level.querySelector('.ps-body-ghost').removeAttribute('inert');       // (the mutant: neither inert nor pointer-events:none)
      const target = [...body.querySelectorAll('[data-gv-action]')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top > 80 && r.bottom < innerHeight - 20; });
      const r = target.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { hitReal: !!hit && !hit.closest('.ps-body-ghost') && hit.closest('[data-gv-action]') === target };
    };
    const gv2 = await measure(shell({ pushed: CAP.gvLive, css: sheet((c) => c.replace('background:var(--bg);pointer-events:none;animation:gd-fade-out', 'background:var(--bg);animation:gd-fade-out')) }), gProbe, { args: { src: read('js/gameday-dom.js') } });
    assert(gv2.hitReal === false, '5j: a ghost that is neither inert nor pointer-events:none SWALLOWS the tap — so [1j] measures the pass-through (each of the two alone keeps it working)');
    const i2 = await measure(shell({ section: CAP.chat, sectionId: 'page-chat', tab: 'chat', css: sheet((c) => c + '\n.chat-return-row{padding:0}\n.chat-return-chip{min-height:30px}\n') }), chipMeasure);
    assert(i2.chipH < 43.5 && Math.abs(i2.leftInset - 16) > 0.5, `5i: a 30 pt chip flush to the edge is caught (${i2.chipH} pt, in ${i2.leftInset}) — so [4a] can fail`);
    const k2 = await measure(shell({ pushed: CAP.thread, css: sheet((c) => c.replace('#chat-thread-sheet .chat-sheet-close{width:44px;height:44px;', '#chat-thread-sheet .chat-sheet-close{width:30px;height:30px;')) }), threadMeasure);
    assert(k2.closeW < 43 && k2.closeH < 43, `5k: the shared 30 pt close is caught (${k2.closeW}x${k2.closeH}) — so [6a] can fail`);
    const l2 = await measure(shell({ pushed: CAP.threadNative, bodyClass: 'native-shell', css: sheet((c) => c.replace('.chat-sheet-openrow{display:flex;justify-content:center;margin:0 0 8px;padding-top:8px;', '.chat-sheet-openrow{display:flex;justify-content:flex-start;margin:0 0 8px;padding-top:0;').replace('body.native-shell #chat-thread-sheet .chat-sheet-header{position:relative;padding-top:14px;', 'body.native-shell #chat-thread-sheet .chat-sheet-header{position:relative;padding-top:0;').replace('width:36px;height:5px;border-radius:3px;', 'width:60px;height:5px;border-radius:3px;')) }), threadMeasure);
    const m2 = await measure(shell({ pushed: CAP.share, css: sheet((c) => c.replace('#share-sheet .chat-sheet-close{width:44px;height:44px;', '#share-sheet .chat-sheet-close{width:30px;height:30px;').replace('.share-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}', '.share-actions{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:0}').replace('#share-sheet-body{overscroll-behavior:contain;padding:0 4px 8px;display:flex;flex-direction:column;gap:16px}', '#share-sheet-body{overscroll-behavior:contain;padding:0 4px 8px;display:flex;flex-direction:column;gap:4px}')) }), shareMeasure);
    assert(m2.closeW < 43 && (m2.btnGap === null || m2.btnGap < 7.5) && m2.gaps.some((g) => Math.abs(g - 16) > 0.5), `5m: a 30 pt close, touching buttons and 4 pt section gaps are each caught (${m2.closeW}, gap ${m2.btnGap}, ${m2.gaps.join(',')}) — so [7a]-[7c] can fail`);
    const n2 = await measure(shell({ section: CAP.chatShare, sectionId: 'page-chat', tab: 'chat', css: sheet((c) => c.replace('.chat-share-attach{display:inline-flex;align-items:center;gap:8px;margin:8px 0 0;min-height:44px;', '.chat-share-attach{display:inline-flex;align-items:center;gap:8px;margin:8px 0 0;min-height:20px;')) }), attachMeasure);
    assert(n2.h < 43.5, `5n: a 20 pt attachment is caught (${n2.h}) — so [7e] can fail`);
    assert(l2.openCenterDev > 1 && Math.abs(l2.openBelowLine - 8) > 0.5 && Math.abs(l2.grabW - 36) > 0.5 && !l2.titleBelowGrab, `5l: a left-packed "Open in chat" flush to its line, a 60 pt grabber and a header with no room above the title are each caught (off ${l2.openCenterDev}, ${l2.openBelowLine} below, grab ${l2.grabW} wide, title below ${l2.titleBelowGrab}) — so [6b]/[6d] can fail`);
  }
} catch (e) {
  fail++;
  _err('  ❌ the engine run threw:', e && e.stack ? e.stack : e);
} finally {
  try { engine && engine.proc.kill(); } catch { /* gone */ }
}

_log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
