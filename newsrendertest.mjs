/**
 * CFB Pickems — newsrendertest.mjs (D1 Lane C, P-8 / S-2, 2026-10-08)
 * =====================================================================
 * THE GROUPED NEWS CARD, THE STORYLINE CARD AND THE "ALSO FROM" SHEET, MEASURED AND TAPPED IN A REAL BROWSER ENGINE (headless Chromium over the DevTools protocol: the mechanism
 * adminairendertest.mjs / leaguesettingsrendertest.mjs use). newsd1test.mjs asserts markup and the dispatchers against a small fake DOM; this suite loads the REAL css/styles.css and
 * the REAL js/newsCard.js inside Home's real page chrome (main.main-content > #page-home > #home-root > .home-feed > .feed-item) and measures COMPUTED STYLE and LAYOUT:
 *
 *   [A] 320 and 375 pt, light and dark, default text AND 1.35x text: no sideways overflow; the grouped card wears the SAME shell as a plain news card (radius, background, border);
 *       the "Also from" button is >= 44 pt tall, 16 pt in from both card edges, 16 pt below the article text and 16 pt above the card's bottom edge; its background differs from
 *       the card's (a visible control in both schemes); the storyline eyebrow is 12 pt caption text with an 8 pt gap, its kind label never clipped, a long tag truncates with an
 *       ellipsis inside the card; the text really grew at 1.35x
 *   [B] the "Also from" sheet at 375x667 (an SE), default and 1.35x: fits the viewport and scrolls inside itself, the close button is 44x44, every row >= 44 pt, rows 8 pt apart,
 *       the body inset 16 pt, a long headline wraps inside its row (never clips, never pushes "Open" out)
 *   [C] press feedback: a real mouse-down on the card's main block, the "Also from" button and a sheet row compresses each to 97% and release returns it to 1; the grouped card's
 *       OUTER shell does not compress as well (no double scale); Reduce Motion: no movement and no transition
 *   [D] THE REAL DISPATCHERS, tapped with real input events: the main block opens the article (its own validated URL), the "Also from" button opens the sheet and never the article,
 *       a sheet row opens THAT alternate's validated URL; Enter on the focused main block opens it too; a focused main block shows its focus ring INSIDE the card's clip
 *   [E] MEASUREMENT CANARIES (anti-vacuity): a 30 pt "Also from" button, a 0-gap sheet list and a 0-inset row are each REPORTED by the same measurement code
 *   [F] the sheet shell this page builds is the markup js/app.js really emits (source-text pins on mountSheetShell and openNewsAlsoSheet), so the replica cannot drift
 *
 * WHAT THIS DOES NOT PROVE, said plainly: it is Chromium, not WKWebView on a handset. Real touch, the iOS safe areas, VoiceOver, the light haptic, the swipe-down physics of the sheet
 * and Dynamic Type's own scaling are device checks (the hand-off names them). A missing browser is a FAILURE here, never a skip.
 *
 * Run:  node newsrendertest.mjs        Override the browser: NEWSRENDER_ENGINE=/path/to/Chromium (falls back to ADMINAI_ENGINE, LSTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then /Applications).
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.NEWSRENDER_ENGINE || process.env.ADMINAI_ENGINE || process.env.LSTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find((p) => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: NEWSRENDER_ENGINE=/path/to/Chromium node newsrendertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

const tmp = mkdtempSync(join(tmpdir(), 'cfbp-newsrender-'));
const cssHref = 'file://' + here + 'css/styles.css';
const jsBase = 'file://' + here + 'js/';
const APP_SRC = readFileSync(join(here, 'js', 'app.js'), 'utf8');

const pageFor = (attrs) => {
  const f = join(tmp, `news-${attrs.includes('dark') ? 'dark' : 'light'}.html`);
  writeFileSync(f, `<!DOCTYPE html><html ${attrs}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${cssHref}"></head>
<body data-tab="home">
<main class="main-content"><section class="page-section active" id="page-home"><div id="home-root"></div></section></main>
<script type="module">
import { renderNewsCard, renderStorylineCard, renderAlsoFromSheet, bindNewsCardEvents, bindAlsoFromSheetEvents } from '${jsBase}newsCard.js';
import { icon } from '${jsBase}icons.js';
import { renderContentCard, renderContentErrorNote, bindContentCardEvents, contentDetailHTML, insightSectionHTML } from '${jsBase}content-card.js';
import { configurePushedScreens, pushScreen, closeAllScreens } from '${jsBase}pushed-screen.js';
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const LONG = 'Texas holds off Oklahoma late as the Longhorns survive a fourth-quarter rally in the Cotton Bowl, and the Big 12 race tightens';
const alt = (o) => Object.freeze({ id: 'news_2', publisher: 'Yahoo Sports', via: null, headline: 'Texas holds off Oklahoma in a Red River thriller', publishedAt: iso(NOW - 3 * 3600e3), url: 'https://sports.yahoo.com/a.html', linkHosts: Object.freeze(['sports.yahoo.com']), ...o });
const GROUPED = Object.freeze({ id: 'news_1', url: 'https://www.cbssports.com/college-football/news/a/', source: 'CBS Sports', publisher: 'CBS Sports', via: null, headline: 'Texas holds off Oklahoma late in the Red River Rivalry',
  imageUrl: null, publishedAt: iso(NOW - 2 * 3600e3), updatedAt: null, sport: 'cfb', reason: "In this week's slate", linkHosts: Object.freeze(['www.cbssports.com']), imageHosts: Object.freeze([]),
  alsoFrom: Object.freeze([alt(), alt({ id: 'news_3', publisher: 'Sports Illustrated', headline: LONG, url: 'https://www.si.com/college/x', linkHosts: Object.freeze(['www.si.com']) }), alt({ id: 'news_4', publisher: 'NBC Sports', url: 'https://www.nbcsports.com/x', linkHosts: Object.freeze(['www.nbcsports.com']) })]) });
const PLAIN = Object.freeze({ ...GROUPED, id: 'news_5', alsoFrom: undefined, url: 'https://www.cbssports.com/college-football/news/b/' });
const STORY = Object.freeze({ ...PLAIN, id: 'news_6', url: 'https://www.cbssports.com/college-football/news/c/', cardKind: 'storyline', storyline: Object.freeze({ tag: 'Oklahoma State at Texas Tech · Sat', gameId: 'g1' }) });
const STORY_LONG = Object.freeze({ ...STORY, id: 'news_7', url: 'https://www.cbssports.com/college-football/news/d/', storyline: Object.freeze({ tag: 'Massachusetts Minutemen at Louisiana-Monroe Warhawks · Sat', gameId: 'g2' }) });
const ITEMS = [GROUPED, PLAIN, STORY, STORY_LONG];
window.__opened = [];
const item = (key, html) => '<div class="feed-item" data-card-key="' + key + '">' + html + '</div>';
window.__mountCards = () => {
  document.getElementById('news-also-sheet-wrap')?.remove();
  const root = document.getElementById('home-root');
  root.innerHTML = '<div class="home-feed" aria-busy="false">' + item('news:news_1', renderNewsCard(GROUPED)) + item('news:news_5', renderNewsCard(PLAIN))
    + item('news:news_6', renderStorylineCard(STORY)) + item('news:news_7', renderStorylineCard(STORY_LONG)) + '</div>';
  bindNewsCardEvents(root, { items: () => ITEMS, onOpen: (h) => window.__opened.push(h), onAlsoFrom: (it) => window.__mountSheet(it) });
};
// the sheet shell, markup-for-markup what js/app.js mountSheetShell() + openNewsAlsoSheet() emit ([F] pins the source text); the row dispatcher is the REAL one
window.__mountSheet = (it) => {
  document.getElementById('news-also-sheet-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'news-also-sheet-wrap';
  wrap.setAttribute('data-hold-teardown', '');
  wrap.innerHTML = '<div class="chat-sheet-backdrop"></div><div class="chat-sheet" id="news-also-sheet" role="dialog" aria-modal="true" aria-labelledby="news-also-sheet-title">'
    + '<div class="chat-sheet-header"><div class="chat-sheet-title" id="news-also-sheet-title" tabindex="-1">Also covered by</div><button type="button" class="chat-sheet-close admin-ai-close" id="news-also-sheet-close" aria-label="Close">' + icon('close') + '</button></div>'
    + '<div id="news-also-sheet-body" class="chat-sheet-scroll"></div></div>';
  document.body.appendChild(wrap);
  document.getElementById('news-also-sheet-body').innerHTML = renderAlsoFromSheet(it);
  bindAlsoFromSheetEvents(wrap, it, { onOpen: (h) => { window.__opened.push('sheet:' + h); wrap.remove(); } });
};
window.__mountSheetFor = () => window.__mountSheet(GROUPED);
// ── D1 Lane C content cards (DI-660…664, DI-669): the REAL renderer, the REAL dispatcher, the REAL pushed-screen shell for the detail ──
const isoC = (ms) => new Date(ms).toISOString();
const CBASE = { contentId: '00000000-0000-4000-8000-000000000001', sport: 'cfb', eventRef: 'espn:event:401856716', teamKeys: ['missouri'], publishedAt: isoC(NOW - 3600e3), freshAsOf: isoC(NOW - 3600e3), eligibleUntil: isoC(NOW + 86400e3), gaps: [], version: 1 };
const C_OK = Object.freeze({ ...CBASE, id: 'content_00000000-0000-4000-8000-000000000001', cardKind: 'matchup.preview', reason: "In this week's slate", synthesisStatus: 'ok',
  card: { headline: 'Texas A&M at Missouri', away: { name: 'Texas A&M', record: '3-2', rank: null }, home: { name: 'Missouri', record: '4-1', rank: 14 }, kickoff: '2026-10-10T16:00:00.000Z', venue: 'Memorial Stadium', tv: ['ABC'] },
  summary: 'Missouri is 4-1 and has won three of its last four; Texas A&M is 3-2 after a 34-7 win over Arkansas.', watch: [{ text: 'Missouri scores 37.6 points a game, the most of any team Texas A&M has faced this season.' }, { text: 'Texas A&M allows 18.6 points a game.' }],
  talk: { text: 'Which defense has the tougher job on Saturday: the one facing 37.6 a game, or the one allowing 20.0?' },
  facts: [{ id: 'm:1:rec:142', text: 'Missouri is 4-1, 1-1 in conference (2026 season · 5 games).', source: { label: 'ESPN', publishedAt: '2026-10-08' } }, { id: 'm:1:last:142', text: "Missouri's last game: beat Florida Gators 45-17 on Oct 3.", source: { label: 'ESPN', publishedAt: '2026-10-08' } }],
  sources: [{ label: 'ESPN', publishedAt: '2026-10-08' }, { label: 'ESPN stats', publishedAt: '2026-10-08' }] });
const C_STALE = Object.freeze({ ...C_OK, id: 'content_00000000-0000-4000-8000-000000000002', contentId: '00000000-0000-4000-8000-000000000002', synthesisStatus: 'structured', summary: null, watch: [], talk: null, reason: 'CFB', freshAsOf: isoC(NOW - 8 * 3600e3) });
const C_PLAYER = Object.freeze({ ...CBASE, id: 'content_00000000-0000-4000-8000-000000000003', contentId: '00000000-0000-4000-8000-000000000003', cardKind: 'player.preview', reason: 'Your pick', synthesisStatus: 'structured', summary: null, watch: [], talk: null,
  card: { headline: 'Christian Watson', name: 'Christian Watson', team: 'Green Bay', opponent: 'Chicago', position: 'WR/TE', label: 'Top receiver', seasonLine: '2026 season · 4 games: 20 catches, 331 receiving yards, 4 TD (63% catch rate)', last3Line: 'Last 3 games: 14 catches, 184 receiving yards, 2 TD', trend: 'down', injury: null },
  facts: [], sources: [{ label: 'ESPN stats', publishedAt: '2026-10-08' }] });
const C_SPOT = Object.freeze({ ...CBASE, id: 'content_00000000-0000-4000-8000-000000000004', contentId: '00000000-0000-4000-8000-000000000004', cardKind: 'spotlight', reason: 'CFB', synthesisStatus: 'structured', summary: null, watch: [], talk: null,
  card: { headline: 'Braden Atkinson', name: 'Braden Atkinson', team: 'Oregon State', opponent: 'Colorado State', score: '56-26', result: 'won', date: '2026-10-03', lines: ['31/34, 427 passing yards, 5 TD, 0 INT'],
    why: 'Why featured: 427 passing yards in a 56-26 win. Selected under the Munera Spotlight standard v2 (QB: 400+ passing yards).', rationale: { standardVersion: '2', rule: 'QB: 400+ passing yards', rank: 1, ofCandidates: 4 } }, facts: [], sources: [{ label: 'ESPN box score', publishedAt: '2026-10-08' }] });
const CITEMS = [C_OK, C_STALE, C_PLAYER, C_SPOT];
window.__contentOpened = []; window.__contentRetried = 0;
window.__mountContent = () => {
  const root = document.getElementById('home-root');
  root.innerHTML = '<div class="home-feed" aria-busy="false">' + CITEMS.map((c) => item('news:' + c.id, renderContentCard(c))).join('') + item('news:content-error', renderContentErrorNote()) + '</div>';
  bindContentCardEvents(root, { items: () => CITEMS, onOpen: (it) => window.__contentOpened.push(it.id), onRetry: () => { window.__contentRetried++; } });
};
let _pushedConfigured = false;
window.__openContentDetail = (k) => {
  const row = CITEMS[k];
  if (!_pushedConfigured) { configurePushedScreens({ escHtml: (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]), isContentWithheld: () => false }); _pushedConfigured = true; }
  closeAllScreens('test');
  pushScreen({ id: 'content:' + row.contentId, title: 'Details', backLabel: 'Home', render: () => contentDetailHTML(row, { gameAvailable: true }) });
};
// DI-667: "SCRIBE's read" as a section of a card detail, in the real shell (the year-ago detail splices it before its actions)
window.__openInsight = (status) => {
  if (!_pushedConfigured) { configurePushedScreens({ escHtml: (v) => String(v), isContentWithheld: () => false }); _pushedConfigured = true; }
  closeAllScreens('test');
  const read = 'Week 6 of 2025 went to Kihoon, who got 6 right, while Brayden got 2. Through Week 5 this season Kevin has 22 correct picks against 21 at the same point last year, the only member ahead of his 2025 pace.\\n\\nKihoon and Brayden traded a drink twice between Week 4 and Week 8 of 2025.';
  pushScreen({ id: 'insight', title: 'A year ago', backLabel: 'Home', render: () => '<div class="cd">' + insightSectionHTML(status === 'ok' ? { status: 'ok', read, createdAt: new Date().toISOString() } : { status: 'none' }) + '<div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary">See the 2025 record</button></div></div>' });
};
window.__ready = true;
</script></body></html>`);
  return f;
};
const PAGES = { light: pageFor('class="theme-neutral" data-color-scheme="light"'), dark: pageFor('class="theme-neutral" data-color-scheme="dark"') };

// ── the CDP client (the shape adminairendertest.mjs uses) ──
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps',
    '--disable-extensions', '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', (d) => { buf += d.toString(); const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(t); res({ proc, ws: m[0] }); } });
    proc.on('error', (e) => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await fetch('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true }); });
  let id = 0; const pending = new Map(); const waiters = [];
  sock.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) waiters.filter((w) => w.method === msg.method).forEach((w) => w.res());
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result)));
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the measurement code, ONE string used by every case (so the canaries exercise the SAME code) ──
const MEASURE = `
window.__measure = () => {
  const R = (e) => e.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => { const r = R(e); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const px = (v) => +parseFloat(v).toFixed(2);
  const out = { vw, vh, docOverflowX: +(document.documentElement.scrollWidth - vw).toFixed(1), problems: [] };
  const g = document.querySelector('.news-card--grouped');
  if (g) {
    const gs = getComputedStyle(g), p = document.querySelector('.news-card:not(.news-card--grouped):not(.news-card--storyline)'), ps = p ? getComputedStyle(p) : null;
    const btn = g.querySelector('.news-card__also'), body = g.querySelector('.news-card__body'), meta = g.querySelector('.news-card__meta');
    const gr = R(g), br = R(btn), mr = R(meta);
    out.grouped = { radius: gs.borderTopLeftRadius, bg: gs.backgroundColor, border: gs.borderTopWidth + ' ' + gs.borderTopStyle + ' ' + gs.borderTopColor,
      plainRadius: ps && ps.borderTopLeftRadius, plainBg: ps && ps.backgroundColor, plainBorder: ps && (ps.borderTopWidth + ' ' + ps.borderTopStyle + ' ' + ps.borderTopColor),
      // insets are measured from the card's INNER edge (inside its 1 pt border), the edge the body's own 16 pt padding is measured from, and the button must line up with the text
      btnH: +br.height.toFixed(1), btnLeft: +(br.left - gr.left - g.clientLeft).toFixed(1), btnRight: +(gr.right - parseFloat(gs.borderRightWidth) - br.right).toFixed(1), btnBelowText: +(br.top - mr.bottom).toFixed(1),
      btnAboveEdge: +(gr.bottom - parseFloat(gs.borderBottomWidth) - br.bottom).toFixed(1), alignOff: +(br.left - R(g.querySelector('.news-card__headline')).left).toFixed(1),
      btnBg: getComputedStyle(btn).backgroundColor, btnFont: px(getComputedStyle(btn).fontSize), btnClipped: btn.scrollWidth > btn.clientWidth + 1, overflowX: g.scrollWidth > g.clientWidth + 1 };
  }
  out.eyebrows = [...document.querySelectorAll('.news-card__eyebrow')].filter(vis).map((e) => {
    const kind = e.querySelector('.news-card__kind'), tag = e.querySelector('.news-card__tag'), card = e.closest('.news-card'), cs = getComputedStyle(e);
    return { font: px(cs.fontSize), gap: px(cs.columnGap), kindClipped: kind.scrollWidth > kind.clientWidth + 1, kindW: +R(kind).width.toFixed(1), tagEllipsis: getComputedStyle(tag).textOverflow,
      tagTruncated: tag.scrollWidth > tag.clientWidth + 1, insideCard: R(e).right <= R(card).right - 15.5 + 0.01, cardOverflow: card.scrollWidth > card.clientWidth + 1, headlineFont: px(getComputedStyle(card.querySelector('.news-card__headline')).fontSize) };
  });
  const sh = document.getElementById('news-also-sheet'), sb = document.getElementById('news-also-sheet-body');
  if (sh && sb) {
    const rows = [...sb.querySelectorAll('.news-also-open')].filter(vis), list = sb.querySelector('.news-also-list'), close = document.getElementById('news-also-sheet-close'), bs = getComputedStyle(sb);
    out.sheet = { top: +R(sh).top.toFixed(1), bottom: +R(sh).bottom.toFixed(1), overflowY: bs.overflowY, padL: px(bs.paddingLeft), padR: px(bs.paddingRight), padT: px(bs.paddingTop),
      closeW: +R(close).width.toFixed(1), closeH: +R(close).height.toFixed(1), rows: rows.map((r) => +R(r).height.toFixed(1)), listGap: list ? px(getComputedStyle(list).rowGap) : null,
      gaps: rows.slice(1).map((r, i) => +(R(r).top - R(rows[i]).bottom).toFixed(1)),
      rowClipped: rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length, openOut: rows.filter((r) => { const o = r.querySelector('.news-also-go'); return o && (R(o).right > R(r).right + 0.5); }).length,
      longWraps: rows.some((r) => R(r.querySelector('.news-also-headline')).height > 30) };
  }
  return out;
};
`;

let engine = null;
const tallyAndExit = async () => {
  console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  try { engine?.proc?.kill(); } catch { /* the browser is going away anyway */ }
  process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
};
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const pg = await attach(engine.ws);
  await pg.send('Page.enable'); await pg.send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const open = async (w, h, { text = 1, reducedMotion = false, mode = 'light' } = {}) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    const loaded = pg.once('Page.loadEventFired');
    await pg.send('Page.navigate', { url: 'file://' + PAGES[mode] });
    await loaded;
    for (let i = 0; i < 80 && !(await evaluate('!!window.__ready')); i++) await sleep(50);
    await evaluate(MEASURE);
    await evaluate(`document.documentElement.style.fontSize = '${text * 100}%'`);
  };
  const settle = async () => {
    await evaluate('(async () => { try { await document.fonts.ready; } catch {} return true; })()');
    for (let i = 0; i < 40; i++) { await sleep(50); if ((await evaluate('document.getAnimations().length')) === 0) break; }
    await sleep(50);
  };
  const mouse = async (type, x, y) => pg.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  const center = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20) }; })()`);
  const tap = async (sel) => { const c = await center(sel); await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(30); await mouse('mouseReleased', c.x, c.y); await sleep(60); };
  const scaleOf = (sel) => evaluate(`(() => { const t = getComputedStyle(document.querySelector(${JSON.stringify(sel)})).transform; if (t === 'none') return 1; const m = t.match(/matrix\\(([^)]+)\\)/); return m ? +parseFloat(m[1].split(',')[0]).toFixed(3) : null; })()`);
  const press = async (sel, alsoSel = null) => {
    const c = await center(sel);
    await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(260);
    const down = await scaleOf(sel); const other = alsoSel ? await scaleOf(alsoSel) : null;
    await mouse('mouseReleased', c.x, c.y); await sleep(260);
    const up = await scaleOf(sel);
    return { down, up, other };
  };

  const cardProblems = (m) => {
    const p = [];
    if (m.docOverflowX > 0.5) p.push(`page overflows sideways by ${m.docOverflowX}`);
    const g = m.grouped;
    if (!g) { p.push('no grouped card'); return p; }
    if (g.radius !== g.plainRadius || g.bg !== g.plainBg || g.border !== g.plainBorder) p.push(`the grouped card's shell differs from a plain news card (${g.radius}/${g.bg}/${g.border} vs ${g.plainRadius}/${g.plainBg}/${g.plainBorder})`);
    if (g.btnH < 43.5) p.push(`"Also from" is ${g.btnH} tall, under 44`);
    if (Math.abs(g.btnLeft - 16) > 0.6 || Math.abs(g.btnRight - 16) > 0.6) p.push(`"Also from" sits ${g.btnLeft}/${g.btnRight} from the card edges, not 16`);
    if (Math.abs(g.alignOff) > 0.6) p.push(`"Also from" is ${g.alignOff} off the headline's left edge (not aligned with the text column)`);
    if (g.btnBelowText < 15.5) p.push(`"Also from" is ${g.btnBelowText} below the article text, under 16`);
    if (Math.abs(g.btnAboveEdge - 16) > 0.6) p.push(`"Also from" is ${g.btnAboveEdge} above the card's bottom edge, not 16`);
    if (g.btnBg === g.bg) p.push(`"Also from" has the card's own background (${g.btnBg}): not a visible control`);
    if (g.btnClipped || g.overflowX) p.push('"Also from" text or the grouped card is clipped sideways');
    for (const e of m.eyebrows) {
      if (e.kindClipped) p.push('the storyline kind label is clipped');
      if (Math.abs(e.gap - 8) > 0.6) p.push(`eyebrow gap ${e.gap}, not 8`);
      if (e.tagEllipsis !== 'ellipsis') p.push('the tag does not truncate with an ellipsis');
      if (!e.insideCard || e.cardOverflow) p.push('the eyebrow reaches past the card\'s 16 pt inset');
    }
    return p;
  };
  const sheetProblems = (m) => {
    const p = [];
    const s = m.sheet;
    if (!s) { p.push('no sheet'); return p; }
    if (s.bottom > m.vh + 0.5 || s.top < -0.5) p.push(`the sheet leaves the viewport (${s.top}..${s.bottom} of ${m.vh})`);
    if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') p.push(`the sheet body does not scroll inside itself (${s.overflowY})`);
    if (Math.abs(s.padL - 16) > 0.6 || Math.abs(s.padR - 16) > 0.6 || Math.abs(s.padT - 16) > 0.6) p.push(`sheet body inset ${s.padT}/${s.padR}/${s.padL}, not 16`);
    if (s.closeW < 43.5 || s.closeH < 43.5) p.push(`close button ${s.closeW}x${s.closeH}, under 44x44`);
    if (s.rows.some((h) => h < 43.5)) p.push(`a row is under 44 pt (${JSON.stringify(s.rows)})`);
    if (s.gaps.some((x) => Math.abs(x - 8) > 0.6)) p.push(`rows are ${JSON.stringify(s.gaps)} apart, not 8`);
    if (s.rowClipped || s.openOut) p.push('a row clips its content or pushes "Open" out');
    return p;
  };

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] THE CARDS at 320 and 375 pt, light and dark, default and 1.35x text…');
  const fonts = {};
  for (const mode of ['light', 'dark']) {
    for (const w of [320, 375]) {
      for (const text of [1, 1.35]) {
        await open(w, 812, { text, mode }); await evaluate('__mountCards()'); await settle();
        const m = await evaluate('__measure()');
        const p = cardProblems(m);
        if (p.length) console.error('     A ' + [mode, w, text].join(' ') + ' → ' + p.join(' | '));
        assert(p.length === 0 && m.eyebrows.length === 2,
          `A ${mode}, ${w} pt, ${text}x text: no overflow; the grouped card wears the plain card's shell; "Also from" ${m.grouped && m.grouped.btnH} pt tall, ${m.grouped && m.grouped.btnLeft}/${m.grouped && m.grouped.btnRight} from the edges, ${m.grouped && m.grouped.btnBelowText} below the text, ${m.grouped && m.grouped.btnAboveEdge} above the edge, its own fill; both storyline eyebrows fit with an 8 pt gap and an ellipsis`);
        if (text === 1 && mode === 'light') {
          fonts[w] = m.eyebrows[0] && m.eyebrows[0].font;
          assert(m.eyebrows.every((e) => e.font === 12 && e.headlineFont > e.font), `A ${w} pt: the eyebrow is 12 pt caption text, smaller than the headline (${m.eyebrows.map((e) => e.font + '/' + e.headlineFont).join(', ')})`);
          assert(m.eyebrows.some((e) => e.tagTruncated) && m.eyebrows.every((e) => !e.kindClipped && e.kindW > 40), `A ${w} pt: the long tag is the one that truncates; "Storyline" is never cut (${m.eyebrows.map((e) => e.kindW).join(', ')} px)`);
        }
        if (text === 1.35 && mode === 'light') assert(m.eyebrows[0].font > fonts[w] * 1.3, `A ${w} pt: the eyebrow text really grew at 1.35x (${fonts[w]} -> ${m.eyebrows[0].font} px), so the larger-text pass is not vacuous`);
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] THE "ALSO FROM" SHEET at 375x667 (an SE), light and dark, default and 1.35x…');
  for (const mode of ['light', 'dark']) {
    for (const text of [1, 1.35]) {
      await open(375, 667, { text, mode }); await evaluate('__mountCards(); __mountSheetFor()'); await settle();
      const m = await evaluate('__measure()');
      const p = sheetProblems(m);
      if (p.length) console.error('     B ' + [mode, text].join(' ') + ' → ' + p.join(' | '));
      assert(p.length === 0 && m.sheet.rows.length === 3 && m.sheet.longWraps,
        `B ${mode}, ${text}x: the sheet fits the 375x667 viewport and scrolls inside itself, close ${m.sheet && m.sheet.closeW}x${m.sheet && m.sheet.closeH}, ${m.sheet && m.sheet.rows.length} rows >= 44 pt (${m.sheet && m.sheet.rows.join('/')}), 8 pt apart, body inset 16, the long headline wraps inside its row`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] PRESS FEEDBACK - a real mouse-down compresses to 97% and releasing returns it…');
  {
    await open(375, 812); await evaluate('__mountCards()'); await settle();
    const main = await press('.news-card--grouped .news-card__main', '.news-card--grouped');
    assert(Math.abs(main.down - 0.97) <= 0.011 && main.up === 1 && main.other === 1, `C the grouped card's main block: pressed ${main.down}, released ${main.up}; the OUTER shell stays at ${main.other} (no double scale)`);
    await evaluate('__mountCards()'); await settle();
    // press without releasing on the button, read, then release OFF the button so no sheet opens mid-measure
    const c = await center('.news-card__also');
    await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(260);
    const bDown = await scaleOf('.news-card__also'), bOuter = await scaleOf('.news-card--grouped');
    await mouse('mouseMoved', 2, 2); await mouse('mouseReleased', 2, 2); await sleep(260);
    const bUp = await scaleOf('.news-card__also');
    assert(Math.abs(bDown - 0.97) <= 0.011 && bUp === 1 && bOuter === 1, `C "Also from": pressed ${bDown}, released ${bUp}; the card around it stays at ${bOuter}`);
    await evaluate('__mountSheetFor()'); await settle();
    const r = await evaluate(`(() => { const e = document.querySelector('[data-news-also-open="news_2"]'); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await mouse('mouseMoved', r.x, r.y); await mouse('mousePressed', r.x, r.y); await sleep(260);
    const rDown = await scaleOf('[data-news-also-open="news_2"]');
    await mouse('mouseMoved', 2, 2); await mouse('mouseReleased', 2, 2); await sleep(260);
    const rUp = await scaleOf('[data-news-also-open="news_2"]');
    assert(Math.abs(rDown - 0.97) <= 0.011 && rUp === 1, `C a sheet row: pressed ${rDown}, released ${rUp}`);
    const dur = await evaluate(`[getComputedStyle(document.querySelector('.news-card__main')).transitionDuration, getComputedStyle(document.querySelector('.news-card__also')).transitionDuration, getComputedStyle(document.querySelector('.news-also-open')).transitionDuration]`);
    assert(dur.every((d) => /^0\.1[0-9]*s$|^0\.2[0-9]*s$/.test(d)), `C the press transitions use the motion tokens (fast: ${dur.join(', ')})`);

    await open(375, 812, { reducedMotion: true }); await evaluate('__mountCards()'); await settle();
    const rm = await evaluate(`[getComputedStyle(document.querySelector('.news-card__main')).transitionDuration, getComputedStyle(document.querySelector('.news-card__also')).transitionDuration]`);
    const c2 = await center('.news-card--grouped .news-card__main');
    await mouse('mouseMoved', c2.x, c2.y); await mouse('mousePressed', c2.x, c2.y); await sleep(120);
    const rmDown = await scaleOf('.news-card--grouped .news-card__main');
    await mouse('mouseMoved', 2, 2); await mouse('mouseReleased', 2, 2);
    assert(rm.every((d) => /^0s$/.test(d)) && rmDown === 1, `C Reduce Motion: no transition (${rm.join(', ')}) and no movement on press (scale ${rmDown})`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] THE REAL DISPATCHERS, tapped with real input events…');
  {
    await open(375, 812); await evaluate('__opened = []; __mountCards()'); await settle();
    await tap('.news-card--grouped .news-card__headline');
    let opened = await evaluate('__opened.slice()');
    assert(opened.length === 1 && opened[0] === 'https://www.cbssports.com/college-football/news/a/' && !(await evaluate('!!document.getElementById("news-also-sheet-wrap")')),
      `D a tap on the grouped card's headline opens ITS article (${opened[0]}) and no sheet`);
    await tap('.news-card__also');
    opened = await evaluate('__opened.slice()');
    const sheetUp = await evaluate('!!document.getElementById("news-also-sheet-wrap")');
    assert(sheetUp && opened.length === 1, 'D a tap on "Also from" opens the sheet and NEVER the article');
    await settle();
    await tap('[data-news-also-open="news_3"]');
    opened = await evaluate('__opened.slice()');
    assert(opened.length === 2 && opened[1] === 'sheet:https://www.si.com/college/x', `D a tap on a sheet row opens THAT alternate's validated URL (${opened[1]})`);
    await evaluate('__mountCards()'); await settle();
    await evaluate(`document.querySelector('.news-card--grouped .news-card__main').focus()`);
    await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(60);
    opened = await evaluate('__opened.slice()');
    assert(opened.length === 3 && opened[2] === 'https://www.cbssports.com/college-football/news/a/', 'D Enter on the focused main block opens its article (keyboard / switch control)');
    const ring = await evaluate(`(() => { const e = document.querySelector('.news-card--grouped .news-card__main'); e.focus(); const s = getComputedStyle(e, null); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset), clip: getComputedStyle(e.closest('.news-card')).overflow }; })()`);
    assert(ring.style === 'solid' && ring.width === 2 && ring.offset <= -2 && ring.clip === 'hidden', `D a focused main block draws a 2 pt ring INSIDE the card's clip (offset ${ring.offset}, card overflow ${ring.clip}) — never cut off`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[G] THE HOME CONTENT CARDS (D1 Lane C, DI-660…664) - the feed card shell, measured; the real dispatcher; the press…');
  const contentMeasure = `(() => {
    const R = (e) => e.getBoundingClientRect(); const px = (v) => +parseFloat(v).toFixed(2);
    const cards = [...document.querySelectorAll('.content-card')];
    const plainFeedCardPad = (() => { const t = document.createElement('article'); t.className = 'card feed-card'; document.querySelector('.home-feed').appendChild(t); const s = getComputedStyle(t); const v = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(px).join('/'); const g = px(s.rowGap); t.remove(); return { v, g }; })();
    return { vw: innerWidth, overflowX: +(document.documentElement.scrollWidth - innerWidth).toFixed(1), plainFeedCardPad,
      cards: cards.map((c) => { const s = getComputedStyle(c); const icon = c.querySelector('.feed-card-icon'); const cap = c.querySelector('.content-card-caption'); const title = c.querySelector('.feed-card-title');
        return { kind: c.className.replace(/.*content-card--(\\w+).*/, '$1'), pad: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(px).join('/'), gap: px(s.rowGap), radius: s.borderTopLeftRadius,
          clipped: c.scrollWidth > c.clientWidth + 1, iconW: icon ? +R(icon).width.toFixed(1) : 0, capText: cap ? cap.textContent : '', capColor: cap ? getComputedStyle(cap).color : '', titleWeight: title ? getComputedStyle(title).fontWeight : '', titleFont: title ? px(getComputedStyle(title).fontSize) : 0 }; }),
      muted: (() => { const t = document.createElement('span'); t.style.color = 'var(--text-muted)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })(),
      secondary: (() => { const t = document.createElement('span'); t.style.color = 'var(--text-secondary)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })(),
      retry: (() => { const b = document.querySelector('[data-content-retry]'); return b ? { h: +R(b).height.toFixed(1) } : null; })() };
  })()`;
  const fontsG = {};
  for (const mode of ['light', 'dark']) {
    for (const w of [320, 375]) {
      for (const text of [1, 1.35]) {
        await open(w, 812, { text, mode }); await evaluate('__mountContent()'); await settle();
        const m = await evaluate(contentMeasure);
        const bad = [];
        if (m.overflowX > 0.5) bad.push(`page overflows by ${m.overflowX}`);
        for (const c of m.cards) {
          if (c.pad !== m.plainFeedCardPad.v || c.gap !== m.plainFeedCardPad.g) bad.push(`${c.kind}: padding ${c.pad} / gap ${c.gap} differ from a plain feed card's ${m.plainFeedCardPad.v} / ${m.plainFeedCardPad.g}`);
          if (c.clipped) bad.push(`${c.kind}: content clipped sideways`);
          if (Math.abs(c.iconW - 16) > 0.6) bad.push(`${c.kind}: the kind icon is ${c.iconW} wide, not 16`);
        }
        if (!m.retry || m.retry.h < 43.5) bad.push(`Retry under 44 pt (${m.retry && m.retry.h})`);
        if (bad.length) console.error('     G ' + [mode, w, text].join(' ') + ' → ' + bad.join(' | '));
        assert(bad.length === 0 && m.cards.length === 4,
          `G ${mode}, ${w} pt, ${text}x: four content cards in the feed card's own shell (padding ${m.plainFeedCardPad.v}, gap ${m.plainFeedCardPad.g}), no overflow, nothing clipped, 16 pt kind icons, a 44 pt Retry`);
        if (mode === 'light' && text === 1) fontsG[w] = m.cards[0].titleFont;
        if (mode === 'light' && text === 1.35) assert(m.cards[0].titleFont > fontsG[w] * 1.3, `G ${w} pt: the card title really grew at 1.35x (${fontsG[w]} -> ${m.cards[0].titleFont}), so the larger-text pass is not vacuous`);
        if (mode === 'light' && w === 375 && text === 1) {
          const [ok, stale] = m.cards;
          assert(/^SCRIBE · from public sources · as of /.test(ok.capText) && ok.capColor === m.secondary, `G the model-written card's caption names SCRIBE, in the secondary tone ("${ok.capText}")`);
          assert(/^From ESPN · Last updated /.test(stale.capText) && stale.capColor === m.muted && m.muted !== m.secondary, `G the stale card's caption reads "From ESPN · Last updated …" (review N1: the author stays) in the MUTED tone (${stale.capColor}; "${stale.capText}")`);
          assert(m.cards.every((c) => c.titleWeight === '600'), 'G every content card title is the one step-up weight (600), like every feed card');
        }
      }
    }
  }
  {
    // a TALL viewport: this test page's feed does not scroll the way the app's main column does, so every card must be on screen for a real pointer to reach it
    await open(375, 1800); await evaluate('__contentOpened = []; __contentRetried = 0; __mountContent()'); await settle();
    await tap('.content-card--spotlight .feed-card-title');
    let opened = await evaluate('__contentOpened.slice()');
    assert(opened.length === 1 && opened[0] === 'content_00000000-0000-4000-8000-000000000004', `G a real tap on the spotlight card opens THAT card through the real dispatcher (${opened[0]})`);
    await tap('[data-content-retry]');
    assert((await evaluate('__contentRetried')) === 1 && (await evaluate('__contentOpened.length')) === 1, 'G a real tap on Retry calls back and opens no card');
    await evaluate(`document.querySelector('.content-card--matchup').focus()`);
    await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(60);
    opened = await evaluate('__contentOpened.slice()');
    assert(opened.length === 2 && opened[1] === 'content_00000000-0000-4000-8000-000000000001', 'G Enter on a focused content card opens it (keyboard / switch control)');
    const pr = await press('.content-card--player');
    assert(Math.abs(pr.down - 0.97) <= 0.011 && pr.up === 1, `G a content card presses to 97% and returns (${pr.down} -> ${pr.up})`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[H] THE CONTENT DETAIL (DI-669) in the REAL pushed-screen shell, at 375x667 and 320, default and 1.35x…');
  const detailMeasure = `(() => {
    const R = (e) => e.getBoundingClientRect(); const px = (v) => +parseFloat(v).toFixed(2);
    const root = document.getElementById('pushed-root'); if (!root) return null;
    const lvl = [...root.querySelectorAll('section')].pop();
    const acts = [...document.querySelectorAll('#pushed-root .cd-actions button')].filter((b) => R(b).height > 0);
    const group = document.querySelector('#pushed-root .cd-actions');
    const gr = group ? R(group) : null;
    const cards = [...document.querySelectorAll('#pushed-root .cd-card')];
    return { vw: innerWidth, overflowX: +(document.documentElement.scrollWidth - innerWidth).toFixed(1), sections: [...document.querySelectorAll('#pushed-root .cd-h')].map((h) => h.textContent),
      acts: acts.map((b) => ({ h: +R(b).height.toFixed(1), label: b.textContent })), between: acts.length === 2 ? (Math.abs(R(acts[0]).top - R(acts[1]).top) < 2 ? +(R(acts[1]).left - R(acts[0]).right).toFixed(1) : +(R(acts[1]).top - R(acts[0]).bottom).toFixed(1)) : null,
      centerOff: acts.length ? +(((Math.min(...acts.map((b) => R(b).left)) + Math.max(...acts.map((b) => R(b).right))) / 2) - (gr.left + gr.right) / 2).toFixed(1) : null,
      cardPad: cards.map((c) => px(getComputedStyle(c).paddingLeft)), clipped: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length };
  })()`;
  for (const [k, label, sections, actions] of [[0, 'matchup', ['The matchup', 'What to watch', 'Talk about it', 'Sources'], ['Talk about it', 'Open game']], [2, 'player', ['Season', 'Last 3 games', 'Role', 'Why he matters', 'Sources'], ['Open game']], [3, 'spotlight', ['Stat lines', 'The game', 'Why featured', 'Sources'], ['Share…', 'Talk about it']]]) {
    for (const [w, text] of [[375, 1], [320, 1.35]]) {
      await open(w, 667, { text }); await evaluate(`__openContentDetail(${k})`); await settle();
      const m = await evaluate(detailMeasure);
      const bad = [];
      if (!m) bad.push('no pushed screen');
      else {
        if (m.overflowX > 0.5) bad.push(`overflow ${m.overflowX}`);
        if (JSON.stringify(m.sections) !== JSON.stringify(sections)) bad.push(`sections ${JSON.stringify(m.sections)}`);
        if (JSON.stringify(m.acts.map((a) => a.label)) !== JSON.stringify(actions)) bad.push(`actions ${JSON.stringify(m.acts.map((a) => a.label))}`);
        if (m.acts.some((a) => a.h < 43.5)) bad.push(`an action under 44 pt (${JSON.stringify(m.acts)})`);
        if (m.acts.length === 2 && Math.abs(m.between - 8) > 0.6) bad.push(`actions ${m.between} apart, not 8`);
        if (m.centerOff !== null && Math.abs(m.centerOff) > 1.5) bad.push(`actions ${m.centerOff} off centre`);
        if (m.cardPad.some((p) => p < 15.5)) bad.push(`a section is inset ${JSON.stringify(m.cardPad)}`);
        if (m.clipped) bad.push(`${m.clipped} section(s) clip their content`);
      }
      if (bad.length) console.error('     H ' + [label, w, text].join(' ') + ' → ' + bad.join(' | '));
      assert(bad.length === 0, `H ${label} detail at ${w} pt, ${text}x: the sections in DI-669's order, its actions (${actions.join(', ')}) 44 pt+, centred${actions.length === 2 ? ', 8 pt apart' : ''}, every section inset 16, no overflow`);
    }
  }
  for (const [status, w, text] of [['ok', 375, 1], ['ok', 320, 1.35], ['none', 320, 1.35]]) {
    await open(w, 667, { text }); await evaluate(`__openInsight(${JSON.stringify(status)})`); await settle();
    const m = await evaluate(detailMeasure);
    const ok = m && m.overflowX <= 0.5 && m.cardPad.every((p) => p >= 15.5) && !m.clipped && JSON.stringify(m.sections) === JSON.stringify(["SCRIBE's read"]) && m.acts.every((a) => a.h >= 43.5);
    assert(ok, `H "SCRIBE's read" (${status}) at ${w} pt, ${text}x: one inset section in the real shell, before the detail's actions, no overflow (${JSON.stringify(m && { sections: m.sections, pad: m.cardPad, ox: m.overflowX })})`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] MEASUREMENT CANARIES - the SAME measurement code must REPORT a broken layout…');
  {
    const inject = (css) => evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return true; })()`);
    await open(375, 812); await evaluate('__mountCards()'); await settle();
    await inject('.news-card__also{min-height:0 !important;height:30px !important;padding:0 8px !important}');
    let p = cardProblems(await evaluate('__measure()'));
    assert(p.some((x) => /under 44/.test(x)), `E canary 1: a 30 pt "Also from" button is REPORTED (${p.join(' | ')})`);
    await open(375, 812); await evaluate('__mountCards()'); await settle();
    await inject('.news-card__also-row{padding:0 !important}');
    p = cardProblems(await evaluate('__measure()'));
    assert(p.some((x) => /from the card edges/.test(x)) && p.some((x) => /bottom edge/.test(x)), `E canary 2: a 0-inset "Also from" row is REPORTED (${p.join(' | ')})`);
    await open(375, 667); await evaluate('__mountCards(); __mountSheetFor()'); await settle();
    await inject('.news-also-list{gap:0 !important}');
    p = sheetProblems(await evaluate('__measure()'));
    assert(p.some((x) => /apart, not 8/.test(x)), `E canary 3: a 0-gap sheet list is REPORTED (${p.join(' | ')})`);
    // canary 4 (D1 Lane C content cards): a content card that drifts from the feed card's shell is SEEN by [G]'s comparison
    await open(375, 812); await evaluate('__mountContent()'); await settle();
    await inject('.content-card{padding:10px !important}');
    const mc = await evaluate(contentMeasure);
    assert(mc.cards.every((c) => c.pad === '10/10/10/10') && mc.plainFeedCardPad.v === '16/16/16/16', `E canary 4: a content card forced to 10 pt padding measures 10 against the plain feed card's 16 (the [G] comparison would report it)`);
  }
} catch (e) {
  assert(false, 'the browser run completed without throwing — ' + String((e && e.message) || e).slice(0, 300));
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[F] THE REPLICA IS THE APP\'S MARKUP (source-text pins on js/app.js)…');
{
  const shell = APP_SRC.slice(APP_SRC.indexOf('function mountSheetShell('), APP_SRC.indexOf('function openWeekWizardSheet('));
  const sheet = APP_SRC.slice(APP_SRC.indexOf('function openNewsAlsoSheet('), APP_SRC.indexOf('function mountSheetShell('));
  assert(/<div class="chat-sheet-backdrop"><\/div>\s*<div class="chat-sheet" id="\$\{escHtml\(sheetId\)\}"\$\{sheetAttrs\}>\s*<div class="chat-sheet-header">/.test(shell) && /<div id="\$\{escHtml\(bodyId\)\}" class="chat-sheet-scroll"><\/div>/.test(shell),
    'F mountSheetShell emits backdrop > .chat-sheet#id > .chat-sheet-header … > #body.chat-sheet-scroll, as the replica');
  assert(/wrapId: NEWS_ALSO_SHEET_WRAP_ID, sheetId: 'news-also-sheet'/.test(sheet) && /sheetAttrs: ' role="dialog" aria-modal="true" aria-labelledby="news-also-sheet-title"'/.test(sheet)
    && /<div class="chat-sheet-title" id="news-also-sheet-title" tabindex="-1">Also covered by<\/div><button type="button" class="chat-sheet-close admin-ai-close" id="news-also-sheet-close" aria-label="Close">\$\{icon\('close'\)\}<\/button>/.test(sheet)
    && /bodyId: 'news-also-sheet-body'/.test(sheet) && /renderAlsoFromSheet\(item\)/.test(sheet) && /bindAlsoFromSheetEvents\(wrap, item,/.test(sheet),
    'F openNewsAlsoSheet: the same ids, dialog attributes, title, close button, body and the SAME two newsCard.js functions the replica calls');
  assert(/const NEWS_ALSO_SHEET_WRAP_ID = 'news-also-sheet-wrap';/.test(APP_SRC), 'F the wrap id is news-also-sheet-wrap');
}

await tallyAndExit();
