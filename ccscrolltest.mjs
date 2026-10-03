/**
 * CFB Pickems — ccscrolltest.mjs
 * ==============================
 * SB-05 CC-SCROLL-THROUGH (Drew, 2026-09-30, Munera iOS / TestFlight): "when I
 * swipe open the control center I can still scroll up and down on the page
 * underneath and it makes it look choppy. When sliding open the control
 * center, the underlying page should remain static."
 *
 * ENGINE-MEASURED through the REAL app (index.html + css/styles.css +
 * js/app.js in headless Chromium, local PIN mode, network blocked — the
 * wizardsheettest.mjs / chatpagetest.mjs boot recipe): six players, an open
 * week of 16 games, signed in as a player, on Picks, at iPhone SE size
 * (375×667, where the drawer's own content overflows and can scroll).
 *
 * What moved the page under the drawer, measured on main 52580eb before the
 * fix (every number below is a real reading from this suite's own probe):
 *   1. THE ROOT STAYED A LIVE SCROLLER (CSS). The drawer is position:fixed
 *      and `.page-wrapper` is made `inert` while it is up — but `inert` only
 *      removes hit-testing and focus; it does not stop the DOCUMENT from
 *      scrolling. Every vertical gesture the drawer itself did not consume
 *      chained to the root scroller: a swipe on the scrim (300→602), a swipe
 *      past the end of the drawer's own list (300→702), a swipe during the
 *      260 ms closing slide (300→603), and — the report itself — the vertical
 *      drift of the drag that opens (300→456, 300→190) or closes (300→126)
 *      the drawer, momentum included.
 *   2. THE DRAWER'S LIST DID NOT CONTAIN ITS OVERSCROLL. No
 *      overscroll-behavior on `.control-center-pane-content`, so its
 *      end-of-list chain went to the page (1, above).
 *   3. THE T-29 BOTTOM BOUNCE HAD NO AXIS LOCK (JS). bindBottomBounce(window,
 *      .page-wrapper) decides eligibility once, at touchstart, and then lifts
 *      `.page-wrapper` for every upward finger movement — so a drawer drag
 *      that started with the page at its bottom (or on a page short enough to
 *      fit) and drifted upward lifted the whole page ~18px under the opening
 *      drawer and sprang it back on release. Its sibling pull-to-refresh
 *      already yields to a horizontal drag (the Step 6 axis lock); this one
 *      never did.
 *   4. (M1, reviewer 2026-10-01) THE ROOT'S OWN BOUNCE. Since RG-TBD-A4 the
 *      iOS shell runs the native WKWebView bounce (alwaysBounceVertical), and
 *      with the keyboard up WebKit can pan the page regardless of overflow.
 *      html AND body carry overscroll-behavior:none for exactly the lock's
 *      span (the RG-289 Chat pair). Blink cannot show that bounce, so the
 *      assertions marked M1 pin the computed value; the bounce is a device
 *      check.
 *
 * Two CSS guards, not one, hold the in-list chain (A-7, B-4): the list's
 * `contain` and the root lock — each sufficient alone in Blink, mutation-
 * measured. B-4b pins the lock's computed style at progress 0, not a
 * measured movement (Blink does not move the page on that gesture unlocked).
 *
 * Also proved: the drawer's own list still scrolls both ways; the page's
 * scroll position survives open→close exactly (tap and drag, reduced motion
 * included); nothing shifts sideways or vertically; the page scrolls again
 * the moment the drawer is fully closed; the T-29 bounce still works for a
 * plain vertical drag; the ≥700px web layout (wheel over scrim / drawer).
 *
 * Only a device can show WebKit's own behaviour (rubber band, momentum,
 * UIScrollView pan vs. the drawer's axis lock). Blink measures the same
 * relations; the device checklist in the SB-05 hand-off covers the rest.
 *
 * Run: node ccscrolltest.mjs
 * Override the browser: CCSCROLL_ENGINE=/path/to/Chromium (falls back to
 * CHATPAGE_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then the
 * usual /Applications paths).
 * Mutation runs: CCSCROLL_ROOT=/path/to/a/COPY/of/cfb-pickems serves that
 * tree instead of this one — mutate the copy, never this checkout.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer, get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.CCSCROLL_ROOT || here;
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
const override = process.env.CCSCROLL_ENGINE || process.env.CHATPAGE_ENGINE || process.env.WIZTEST_ENGINE
  || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: CCSCROLL_ENGINE=/path/to/Chromium node ccscrolltest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (CCSCROLL_ROOT — serving ${ROOT})`);

// ── the app server: the real tree, local-mode config, no service worker ─────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; }
  if (p === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  // Serve the app and nothing else: no dot-segments, no dotfiles (.env*,
  // .git…), nothing under /supabase/ (tests/.env* live there).
  if (p.split('/').some(seg => seg.startsWith('.')) || p.startsWith('/supabase/') || p === '/supabase') { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
// Raw request paths (fetch() would normalize dot-segments away before sending).
const rawStatus = (path) => new Promise(res => {
  const rq = httpGet({ host: '127.0.0.1', port: server.address().port, path }, r => { r.resume(); res(r.statusCode); });
  rq.on('error', () => res(-1));
});
for (const path of ['/supabase/tests/.env.local', '/supabase/migrations/', '/.git/HEAD', '/js/../../CLAUDE.md', '/js/%2e%2e/%2e%2e/CLAUDE.md', '/js/.hidden']) {
  assert(await rawStatus(path) === 404, `0-srv: the suite's server refuses ${path} (404) — app files only, no dotfiles, no dot-segments, nothing under /supabase/`);
}
assert(await rawStatus('/config.json') === 200 && await rawStatus('/js/app.js') === 200, '0-srv: …and still serves /config.json (as {}) and the app\'s own files');

// ── the CDP client (same shape as chatpagetest.mjs / wizardsheettest.mjs) ───
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-ccscroll-'));
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0',
    '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
    '--disable-background-networking', '--disable-sync', '--disable-component-update',
    '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen',
    '--metrics-recording-only', '--mute-audio',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',   // no network but this suite's own server
    'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', d => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/\S+/);
      if (m) { clearTimeout(t); res({ proc, ws: m[0] }); }
    });
    proc.on('error', e => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await fetch('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find(t => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    sock.addEventListener('open', res, { once: true });
    sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true });
  });
  let id = 0; const pending = new Map(); const waiters = [];
  sock.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) waiters.filter(w => w.method === msg.method).forEach(w => w.res());
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, m => m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result));
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  const once = method => new Promise(res => waiters.push({ method, res }));
  return { send, once };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const pg = await attach(engine.ws);
  await pg.send('Page.enable');
  await pg.send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) { if (await evaluate(`!!(${expression})`)) return true; await sleep(100); }
    return false;
  };
  const navigate = async () => {
    const loaded = pg.once('Page.loadEventFired');
    await pg.send('Page.navigate', { url: ORIGIN + '/index.html' });
    await loaded;
  };
  const viewport = async (w, h) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(150);
  };
  const swipe = async (x, y, yDistance) => {   // a real touch scroll gesture, finger down at (x,y)
    await pg.send('Input.synthesizeScrollGesture', { x: Math.round(x), y: Math.round(y), yDistance, gestureSourceType: 'touch', speed: 1200 });
    await sleep(400);
  };
  const wheel = async (x, y, deltaY) => {
    await pg.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY });
    await sleep(400);
  };

  // ── measurement ──────────────────────────────────────────────────────────
  // Everything that can move under the drawer, in one read. `maxDelta` is the
  // largest |scrollY - base| a window 'scroll' listener saw since park(); `lift`
  // is the largest translateY written to .page-wrapper since park() (the JS
  // bounce springs back on release — only a recorder catches it); `navFlips`
  // counts .bottom-nav nav-hidden class changes (T-24 hide-on-scroll).
  const S = `(() => {
    const cc = document.getElementById('control-center'), hs = getComputedStyle(document.documentElement), bs = getComputedStyle(document.body);
    const pane = [...document.querySelectorAll('#control-center .control-center-pane-content')].find(e => e.offsetParent);
    const pw = document.querySelector('.page-wrapper').getBoundingClientRect();
    const card = document.querySelector('#page-picks .card, #page-picks [data-game-id], #page-picks .pick-card');
    return { win: Math.round(scrollY), vw: innerWidth, vh: innerHeight, docH: document.documentElement.scrollHeight, cw: document.documentElement.clientWidth,
      open: cc?.dataset.open, phase: cc?.dataset.phase, dragging: cc?.dataset.dragging, prog: Number(cc?.style.getPropertyValue('--cc-drag-progress') || 0),
      hOy: hs.overflowY, maxDelta: window.__maxDelta || 0, lift: window.__lift || 0, navFlips: window.__navFlips || 0,
      ob: 'html ' + hs.overscrollBehaviorX + '/' + hs.overscrollBehaviorY + ', body ' + bs.overscrollBehaviorX + '/' + bs.overscrollBehaviorY,
      pane: pane ? { sT: Math.round(pane.scrollTop), cH: pane.clientHeight, sH: pane.scrollHeight } : null,
      pw: { l: Math.round(pw.left), w: Math.round(pw.width) }, cardTop: card ? Math.round(card.getBoundingClientRect().top) : null,
      inert: document.querySelector('.page-wrapper').hasAttribute('inert') };
  })()`;
  // `__yAtClosed` is the page's scroll offset at the instant the drawer's phase
  // becomes 'closed' — "static until the drawer fully closes" is judged there;
  // anything a still-running gesture does AFTER that is the page being free.
  const installRecorders = () => evaluate(`(() => {
    if (window.__recOn) return; window.__recOn = true; window.__lift = 0; window.__maxDelta = 0; window.__navFlips = 0; window.__base = null; window.__yAtClosed = null;
    const cc = document.getElementById('control-center');
    new MutationObserver(() => { if (cc.dataset.phase === 'closed' && window.__yAtClosed === null) window.__yAtClosed = Math.round(scrollY); })
      .observe(cc, { attributes: true, attributeFilter: ['data-phase'] });
    const pw = document.querySelector('.page-wrapper');
    new MutationObserver(() => { const m = /translateY\\((-?[\\d.]+)px\\)/.exec(pw.style.transform); if (m) window.__lift = Math.max(window.__lift, Math.abs(+m[1])); })
      .observe(pw, { attributes: true, attributeFilter: ['style'] });
    addEventListener('scroll', () => { if (window.__base !== null) window.__maxDelta = Math.max(window.__maxDelta, Math.abs(scrollY - window.__base)); }, { passive: true });
    const nav = document.querySelector('.bottom-nav'); let was = nav?.classList.contains('nav-hidden');
    if (nav) new MutationObserver(() => { const now = nav.classList.contains('nav-hidden'); if (now !== was) { window.__navFlips++; was = now; } })
      .observe(nav, { attributes: true, attributeFilter: ['class'] });
  })()`);
  /** Park the page mid-document (a leak in EITHER direction is then visible)
   *  and zero the recorders. Programmatic scrolling stays allowed under a lock. */
  const park = async (y) => {
    await evaluate(`window.scrollTo({ top: ${y}, behavior: 'instant' })`);
    await sleep(80);
    await evaluate(`(() => { window.__lift = 0; window.__maxDelta = 0; window.__navFlips = 0; window.__base = scrollY; window.__yAtClosed = null; })()`);
    return evaluate(S);
  };
  /** A finger drag the page's own JS AND the engine's gesture recognizer both
   *  see (touchstart/move/end → touch scrolling), sampled EARLY (move 5 of 20,
   *  ~80 ms after the drawer claimed the drag on move 1 — the lock is live by
   *  then), MID-gesture (last move, finger still down) and again after the
   *  release has settled (momentum included). */
  const dragPath = async (points) => {   // points[0] = finger down; the rest = moves, 16 ms apart
    let early = null;
    await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(points[0][0]), y: Math.round(points[0][1]) }] });
    for (let i = 1; i < points.length; i++) {
      await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(points[i][0]), y: Math.round(points[i][1]) }] });
      await sleep(16);
      if (i === 5) early = await evaluate(S);
    }
    const mid = await evaluate(S);
    await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
    return { early, mid, after: await evaluate(S) };
  };
  const drag = (x, y, dx, dy, steps = 20) =>
    dragPath(Array.from({ length: steps + 1 }, (_, i) => [x + dx * i / steps, y + dy * i / steps]));
  // The ONE movement no passive-listener fix can remove (SB-05 hand-off): every
  // touch listener in this app is `{ passive: true }`, so the engine starts a
  // touch scroll on its own thread in the same instant the drawer's JS decides
  // the drag is horizontal (AXIS_DEAD_ZONE_PX = 8, js/nav-gestures.js) — the
  // lock lands a frame later. Measured: 5px (drift up), 3px (drift down), on
  // move 1 only. Bounded here by that dead zone; everything AFTER the claim is
  // held to exactly zero. v0.27.3 moved the page 125–157px plus momentum.
  const PRE_CLAIM_MAX_PX = 8;
  // M1 (reviewer, 2026-10-01) — the root's OWN bounce. The iOS shell turned the
  // native WKWebView bounce back on (RG-TBD-A4, alwaysBounceVertical), which
  // Blink cannot show; what Blink CAN pin is the computed value WebKit reads:
  // html AND body `none` (both axes) for exactly as long as the page lock, and
  // DI-327's `auto` the moment the drawer is fully closed.
  const OB_NONE = 'html none/none, body none/none';
  const OB_AUTO = 'html auto/auto, body auto/auto';
  const tapOpen = async () => { await evaluate(`document.getElementById('control-center-trigger').click()`); await waitFor(`document.getElementById('control-center').dataset.phase === 'open'`, 2000); await sleep(60); };
  const tapClose = async () => { await evaluate(`document.querySelector('#control-center [data-action="cc-close"]').click()`); await waitFor(`document.getElementById('control-center').dataset.phase === 'closed'`, 2000); await sleep(60); };
  const suspended = () => evaluate(`import('./js/nav-gestures.js').then(m => m.gesturesSuspended())`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode): six players, an open week of 16 games, signed in as a player, on Picks (375×667)…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(375, 667);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`),
    '1-0: fixture — the real index.html + js/app.js booted in the engine');
  await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'].map((n, i) => ({ ...dm.createPlayer(n, '', '0000', '', n[0]), playerId: 'p' + (i + 1), active: true }))
      .forEach(p => st.savePlayer(p));
    const wk = dm.createWeek(2026, 5); wk.status = 'open'; st.saveWeek(wk); st.setActiveWeekId(wk.weekId);
    for (let i = 0; i < 16; i++) st.saveGame(dm.createGame(wk.weekId, { homeTeam: 'Home ' + i, awayTeam: 'Away ' + i,
      kickoff: new Date(Date.now() + 86400000).toISOString(), spread: -3.5 }));
    st.setSession('p1', false, true);
    await new Promise(r => setTimeout(r, 1200));   // storage.js's debounced write lands
  })()`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo && document.getElementById('control-center')`),
    '1-1: fixture — after reload the app is past the site gate, signed in as a player, with the control-center drawer mounted');
  await evaluate(`window.navigateTo('picks')`);
  await sleep(400);
  await installRecorders();
  let s = await evaluate(S);
  assert(s.docH > s.vh + 1200, `1-2: fixture — Picks is a long scrolling document (${s.docH}px in ${s.vh}px), so a leak in either direction is observable`);
  assert(s.open === 'false' && s.phase === 'closed' && s.hOy === 'visible',
    `1-3: fixture — the drawer starts closed and the page is a normal scroller (data-open ${s.open}, phase ${s.phase}, html overflow-y "${s.hOy}")`);
  assert(s.ob === OB_AUTO,
    `1-3b: fixture — with the drawer closed the page keeps DI-327's native bounce (overscroll-behavior ${s.ob}; want ${OB_AUTO})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] Drawer OPEN — the page underneath never moves; the drawer\'s own list still scrolls…');
  // ═════════════════════════════════════════════════════════════════════════
  await park(300);
  await tapOpen();
  s = await evaluate(S);
  assert(s.open === 'true' && s.phase === 'open' && s.inert, `A-0: fixture — the drawer is open (tap on the header trigger) and the page is inert behind it (phase ${s.phase}, inert ${s.inert})`);
  assert(s.hOy === 'hidden',
    `A-1: THE BUG (root) — the document is NOT user-scrollable while the drawer is up (html overflow-y "${s.hOy}"; v0.27.3: "visible")`);
  assert(s.ob === OB_NONE,
    `A-1b: M1 — …and the root's OWN bounce is off while the drawer is up, html AND body (overscroll-behavior ${s.ob}; want ${OB_NONE}) — computed style only: the native WKWebView bounce this turns off is a device check`);
  const paneStyle = await evaluate(`(() => { const cs = getComputedStyle([...document.querySelectorAll('#control-center .control-center-pane-content')].find(e => e.offsetParent)); return { oy: cs.overflowY, ob: cs.overscrollBehaviorY }; })()`);
  assert(paneStyle.oy === 'auto' && paneStyle.ob === 'contain',
    `A-2: the drawer's own list is a scroller that CONTAINS its overscroll (overflow-y "${paneStyle.oy}", overscroll-behavior-y "${paneStyle.ob}") — its own bounce stays, nothing chains to the page`);
  assert(s.pane && s.pane.sH > s.pane.cH + 100, `A-3: fixture — at 375×667 the drawer's own content overflows (${s.pane?.sH}px in ${s.pane?.cH}px), so there is something for IT to scroll`);
  const ccW = await evaluate(`Math.round(document.getElementById('control-center').getBoundingClientRect().right)`);
  const scrimX = Math.round((ccW + s.vw) / 2), drawerX = Math.round(ccW / 2), midY = Math.round(s.vh / 2);
  let a = await park(300);
  await swipe(scrimX, midY, -300);
  let b = await evaluate(S);
  assert(b.win === a.win && b.maxDelta === 0,
    `A-4: THE BUG — a vertical swipe on the dimmed SCRIM beside the drawer does not scroll the page (window ${a.win}→${b.win}, max excursion ${b.maxDelta}px; v0.27.3: 300→602)`);
  a = await park(300);
  await swipe(scrimX, midY, 300);
  b = await evaluate(S);
  assert(b.win === a.win && b.maxDelta === 0, `A-5: …nor does one in the other direction (window ${a.win}→${b.win})`);
  a = await park(300);
  await swipe(drawerX, midY, -200);
  b = await evaluate(S);
  assert(b.pane.sT > a.pane.sT + 50 && b.win === a.win && b.maxDelta === 0,
    `A-6: a swipe INSIDE the drawer scrolls the drawer's own list (${a.pane.sT}→${b.pane.sT}) and not the page (window ${a.win}→${b.win})`);
  for (let i = 0; i < 3; i++) await swipe(drawerX, midY, -600);   // reach the end BY FINGER
  a = await park(300);
  await swipe(drawerX, midY, -400);
  await swipe(drawerX, midY, -400);
  b = await evaluate(S);
  assert(a.pane.sT >= a.pane.sH - a.pane.cH - 1 && b.win === a.win && b.maxDelta === 0,
    `A-7: THE BUG — swiping on PAST the end of the drawer's list does not chain to the page (list at ${a.pane.sT}/${a.pane.sH - a.pane.cH}, window ${a.win}→${b.win}; v0.27.3: 300→702). TWO CSS guards hold this, each sufficient alone in Blink (mutation-measured 2026-10-01: either removed → still green; both removed → 300→1095): the list's own \`contain\` (A-2) and the root lock (A-1). On iOS the list's \`contain\` is the guard WebKit applies to its chain`);
  a = await park(300);
  await swipe(drawerX, midY, 2400);
  b = await evaluate(S);
  assert(b.pane.sT === 0 && b.win === a.win && b.maxDelta === 0,
    `A-8: swiping back DOWN past the drawer's top returns its list to 0 and does not pull the page with it (list ${b.pane.sT}, window ${a.win}→${b.win})`);
  a = await park(300);
  await wheel(scrimX, midY, 400);
  b = await evaluate(S);
  assert(b.win === a.win, `A-9: a mouse wheel over the scrim does not scroll the page (window ${a.win}→${b.win})`);
  assert(await suspended() === true && b.navFlips === 0,
    `A-10: gesturesSuspended() is TRUE while the drawer is open and the nav's hide-on-scroll never flipped (${b.navFlips} flips) — nav-hide / pull-to-refresh / week-swipe / bottom bounce all stand down`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] The DRAG that opens / closes the drawer — the page stays static from drag start until fully closed…');
  // ═════════════════════════════════════════════════════════════════════════
  await tapClose();
  a = await park(300);
  // Drew's gesture: a left-edge swipe with the natural diagonal drift of a thumb.
  let d = await drag(20, 420, 180, -150);
  assert(d.mid.dragging === 'true' && d.mid.open === 'true' && d.mid.prog > 0.3,
    `B-0: fixture — mid-gesture the drawer is being dragged open by the finger (data-dragging ${d.mid.dragging}, progress ${d.mid.prog.toFixed(2)})`);
  assert(d.early.hOy === 'hidden' && d.mid.hOy === 'hidden',
    `B-1: the page is locked DURING the drag, from the moment the drawer claims it — not only once it settles (html overflow-y "${d.early.hOy}" at move 5, "${d.mid.hOy}" mid-drag)`);
  assert(d.early.ob === OB_NONE && d.mid.ob === OB_NONE,
    `B-1b: M1 — the root's own bounce is off DURING the drag too (move 5: ${d.early.ob}; mid-drag: ${d.mid.ob}; want ${OB_NONE})`);
  assert(d.mid.win === d.early.win && d.after.win === d.early.win,
    `B-2: THE BUG (the report) — once the drawer has claimed the drag, the thumb's upward drift does not move the page at all, nor does momentum after release (window ${d.early.win} at move 5 → ${d.mid.win} mid-drag → ${d.after.win} after release; v0.27.3: 300→456)`);
  assert(Math.abs(d.early.win - a.win) <= PRE_CLAIM_MAX_PX && d.after.maxDelta <= PRE_CLAIM_MAX_PX,
    `B-2b: …and the whole gesture moved it no more than the pre-claim window (${a.win}→${d.after.win}, max excursion ${d.after.maxDelta}px ≤ ${PRE_CLAIM_MAX_PX}; see PRE_CLAIM_MAX_PX)`);
  assert(d.after.phase === 'open', `B-3: …and the drawer still settles OPEN from that drag (phase ${d.after.phase})`);
  a = await park(300);
  d = await drag(250, 360, -200, 160);   // drag the open drawer closed, drifting down
  assert(d.mid.win === a.win && d.after.win === a.win && d.after.maxDelta === 0,
    `B-4: THE BUG — dragging the drawer CLOSED with a downward drift does not scroll the page (window ${a.win} → ${d.mid.win} → ${d.after.win}, max ${d.after.maxDelta}px; v0.27.3: 300→126). The finger starts on the drawer's list, so — like A-7 — TWO CSS guards hold this, each sufficient alone in Blink (mutation-measured 2026-10-01: both removed → 300→136): the list's \`contain\` and the root lock`);
  assert(d.after.phase === 'closed' && d.after.hOy === 'visible',
    `B-5: …the drawer closes and the lock is released once it has (phase ${d.after.phase}, html overflow-y "${d.after.hOy}")`);
  assert(d.after.ob === OB_AUTO,
    `B-5b: M1 — …and the page's own bounce comes back (DI-327) once it has (overscroll-behavior ${d.after.ob}; want ${OB_AUTO})`);
  // An OPENING drag the thumb changes its mind about — out to the right, then
  // back to the edge (progress 0) with the finger still down and still drifting.
  // The phase never left 'closed', so data-open is "false" there
  // (isDrawerVisuallyOpen() needs progress > 0 mid-drag); only data-dragging
  // keeps the page locked until the finger lifts.
  a = await park(300);
  const outAndBack = [];
  for (let i = 0; i <= 10; i++) outAndBack.push([20 + 16 * i, 300 + 6 * i]);         // out: +160 right, drifting down
  for (let i = 1; i <= 14; i++) outAndBack.push([180 - 13 * i, 360 + 10 * i]);       // back: to x -2 (clamped 0), still drifting down
  d = await dragPath(outAndBack);
  assert(d.mid.dragging === 'true' && d.mid.open === 'false' && d.mid.prog === 0 && d.mid.phase === 'closed',
    `B-4b-0: fixture — mid-gesture the drawer has been dragged out and all the way back, finger still down (data-dragging ${d.mid.dragging}, data-open ${d.mid.open}, progress ${d.mid.prog}, phase ${d.mid.phase})`);
  assert(d.mid.hOy === 'hidden' && d.mid.win === d.early.win && d.after.win === d.early.win,
    `B-4b: the page LOCK holds for the whole drag, including the stretch back at progress 0 where only data-dragging keeps it (computed html overflow-y "${d.mid.hOy}" there; window ${d.early.win} at move 5 → ${d.mid.win} → ${d.after.win}). What this proves is the COMPUTED STYLE, not a measured movement: Blink does not move the page on this gesture even unlocked (mutation-measured 2026-10-01: lock removed → window 300 → 300 → 300, this assertion fails on overflow-y "visible" alone)`);
  assert(d.mid.ob === OB_NONE,
    `B-4b-3: M1 — the root's own bounce is off there too (data-dragging alone, progress 0: ${d.mid.ob}; want ${OB_NONE})`);
  assert(d.after.maxDelta <= PRE_CLAIM_MAX_PX && d.after.phase === 'closed' && d.after.hOy === 'visible',
    `B-4b-2: …within the pre-claim window overall (max ${d.after.maxDelta}px), the drawer stays closed and the lock lifts with the finger (phase ${d.after.phase}, overflow-y "${d.after.hOy}")`);
  a = await park(300);
  d = await drag(20, 300, 150, 130);   // open, drifting DOWN
  assert(d.mid.win === d.early.win && d.after.win === d.early.win && d.after.phase === 'open',
    `B-6: THE BUG — an opening swipe drifting DOWN does not scroll the page up once the drawer has claimed it (window ${d.early.win} at move 5 → ${d.mid.win} → ${d.after.win}; v0.27.3: 300→190)`);
  assert(d.after.maxDelta <= PRE_CLAIM_MAX_PX, `B-6b: …whole gesture within the pre-claim window (${a.win}→${d.after.win}, max ${d.after.maxDelta}px ≤ ${PRE_CLAIM_MAX_PX})`);
  // The 260 ms closing slide: the drawer is still on screen, so the page stays
  // put until the phase reaches 'closed' (the swipe outlasts the slide; what it
  // does to the page AFTER 'closed' is the page being free again — C-5).
  a = await park(300);
  await evaluate(`document.querySelector('#control-center [data-action="cc-close"]').click()`);
  const closing = await evaluate(S);
  await swipe(Math.round(s.vw * 0.8), midY, -300);
  await waitFor(`document.getElementById('control-center').dataset.phase === 'closed'`, 2000);
  const yAtClosed = await evaluate('window.__yAtClosed');
  assert(closing.phase === 'closing' && closing.hOy === 'hidden' && yAtClosed === a.win,
    `B-7: THE BUG — a swipe begun during the closing slide (phase "${closing.phase}", overflow-y "${closing.hOy}") does not move the page while the drawer is still on screen (window ${a.win} → ${yAtClosed} at the instant it reached 'closed'; v0.27.3: 300→603)`);
  // The page at its BOTTOM: the T-29 JS bounce was the other thing that moved.
  a = await park(1e6);
  d = await drag(20, 420, 180, -150);
  assert(d.mid.lift === 0 && d.after.lift === 0,
    `B-8: THE BUG (JS bounce) — at the page's bottom an upward-drifting drawer swipe does not lift .page-wrapper (largest lift ${d.after.lift.toFixed(1)}px; v0.27.3: 18.3px under the opening drawer)`);
  assert(d.after.win === a.win && d.after.maxDelta === 0 && d.after.phase === 'open',
    `B-9: …nor scroll it (window ${a.win}→${d.after.win}, max excursion ${d.after.maxDelta}px), and the drawer opened (phase ${d.after.phase})`);
  assert(d.after.navFlips === 0, `B-10: no nav hide/show flip during any of it (${d.after.navFlips})`);
  await tapClose();

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] Scroll position kept exactly, no layout shift, and the page is free again once closed…');
  // ═════════════════════════════════════════════════════════════════════════
  a = await park(420);
  await tapOpen();
  const during = await evaluate(S);
  await tapClose();
  b = await evaluate(S);
  assert(a.win === 420 && during.win === 420 && b.win === 420,
    `C-1: a tap open → close never moves or resets the page's scroll position (420 → ${during.win} while open → ${b.win} after close) — no jump to top`);
  assert(during.pw.l === a.pw.l && during.pw.w === a.pw.w && during.cw === a.cw && during.cardTop === a.cardTop && b.cardTop === a.cardTop,
    `C-2: no layout shift — the page keeps its box and its content stays where it was (page-wrapper x ${a.pw.l}/${during.pw.l}, width ${a.pw.w}/${during.pw.w}, client width ${a.cw}/${during.cw}, first card top ${a.cardTop}/${during.cardTop}/${b.cardTop})`);
  a = await park(420);
  d = await drag(20, 420, 180, -150);
  // Re-base the recorders where the page now stands (no scrolling), so the
  // close drag's excursion is its own, not the opening drag's pre-claim window.
  await evaluate(`(() => { window.__lift = 0; window.__maxDelta = 0; window.__navFlips = 0; window.__base = scrollY; })()`);
  const d2 = await drag(250, 360, -200, 120);
  assert(d.after.phase === 'open' && d2.after.phase === 'closed' && d2.after.win === d.early.win && d2.after.maxDelta === 0,
    `C-3: a DRAG open → DRAG closed ends exactly where the page stood when the drawer claimed the opening drag — no jump on close (${d.early.win} → ${d.after.win} open → ${d2.after.win} closed, close-drag excursion ${d2.after.maxDelta}px)`);
  assert(Math.abs(d2.after.win - a.win) <= PRE_CLAIM_MAX_PX,
    `C-3b: …within the pre-claim window of where the thumb started (${a.win} → ${d2.after.win})`);
  assert(d2.after.hOy === 'visible' && await suspended() === false,
    `C-4: once fully closed the root is a normal scroller again (html overflow-y "${d2.after.hOy}") and gesturesSuspended() is false`);
  a = await park(420);
  await swipe(Math.round(s.vw / 2), midY, -250);
  b = await evaluate(S);
  assert(b.win > a.win + 50, `C-5: after close the page scrolls normally again (window ${a.win}→${b.win}) — the lock is released, not stuck`);
  // A horizontal drag that never opens the drawer (right-to-left from the zone) leaves the page free afterwards.
  d = await drag(60, 420, -40, 0, 8);
  a = await park(420);
  await swipe(Math.round(s.vw / 2), midY, -250);
  b = await evaluate(S);
  assert(d.after.phase === 'closed' && d.after.hOy === 'visible' && b.win > a.win + 50,
    `C-6: a horizontal drag that does not open the drawer leaves no lock behind (phase ${d.after.phase}, overflow-y "${d.after.hOy}", page scrolls ${a.win}→${b.win})`);
  // Control: the T-29 bottom bounce still works for a plain VERTICAL drag (anti-vacuity for B-8).
  a = await park(1e6);
  d = await drag(Math.round(s.vw / 2), 500, 0, -140);
  assert(d.mid.lift > 5, `C-7: control — a plain vertical drag up at the page's bottom still gets the T-29 rubber band (lift ${d.mid.lift.toFixed(1)}px): only a horizontal drag is excluded`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] prefers-reduced-motion: the lock follows the instant open/close, same guarantees…');
  // ═════════════════════════════════════════════════════════════════════════
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(100);
  a = await park(360);
  const rmOpen = await evaluate(`(() => { document.getElementById('control-center-trigger').click(); const cc = document.getElementById('control-center');
    return { phase: cc.dataset.phase, hOy: getComputedStyle(document.documentElement).overflowY, ob: (() => { const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body); return 'html ' + h.overscrollBehaviorX + '/' + h.overscrollBehaviorY + ', body ' + b.overscrollBehaviorX + '/' + b.overscrollBehaviorY; })() }; })()`);
  assert(rmOpen.phase === 'open' && rmOpen.hOy === 'hidden', `D-1: reduced motion — the drawer opens instantly and the page is locked in the same frame (phase ${rmOpen.phase}, overflow-y "${rmOpen.hOy}")`);
  assert(rmOpen.ob === OB_NONE, `D-1b: M1 — reduced motion — the root's own bounce is off in that same frame (${rmOpen.ob}; want ${OB_NONE})`);
  await swipe(scrimX, midY, -300);
  b = await evaluate(S);
  assert(b.win === a.win && b.maxDelta === 0, `D-2: reduced motion — a scrim swipe does not scroll the page (window ${a.win}→${b.win})`);
  const rmClose = await evaluate(`(() => { document.querySelector('#control-center [data-action="cc-close"]').click(); const cc = document.getElementById('control-center');
    return { phase: cc.dataset.phase, hOy: getComputedStyle(document.documentElement).overflowY, win: Math.round(scrollY), ob: (() => { const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body); return 'html ' + h.overscrollBehaviorX + '/' + h.overscrollBehaviorY + ', body ' + b.overscrollBehaviorX + '/' + b.overscrollBehaviorY; })() }; })()`);
  assert(rmClose.phase === 'closed' && rmClose.hOy === 'visible' && rmClose.win === 360,
    `D-3: reduced motion — close is instant, the lock lifts in the same frame, and the position is exact (phase ${rmClose.phase}, overflow-y "${rmClose.hOy}", window ${rmClose.win})`);
  assert(rmClose.ob === OB_AUTO, `D-3b: M1 — reduced motion — the page's own bounce (DI-327) returns in that same frame (${rmClose.ob}; want ${OB_AUTO})`);
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(100);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] Web at ≥700px (desktop / iPad): wheel over the scrim or the drawer never scrolls the page…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(1024, 768);
  await evaluate(`window.navigateTo('picks')`);
  await sleep(300);
  a = await park(300);
  await tapOpen();
  const wide = await evaluate(`(() => { const r = document.getElementById('control-center').getBoundingClientRect(); return { right: Math.round(r.right), vw: innerWidth, vh: innerHeight }; })()`);
  await wheel((wide.right + wide.vw) / 2, wide.vh / 2, 500);
  await wheel(wide.right / 2, wide.vh / 2, 500);
  b = await evaluate(S);
  assert(wide.right < wide.vw - 300 && b.win === a.win && b.maxDelta === 0,
    `E-1: at 1024×768 a wheel over the scrim or over the drawer does not scroll the page (drawer right edge ${wide.right}, window ${a.win}→${b.win})`);
  await tapClose();
  b = await evaluate(S);
  assert(b.win === a.win && b.hOy === 'visible', `E-2: …and closing restores the same position and a free page (window ${b.win}, overflow-y "${b.hOy}")`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[F] SB-15 — a repaint under a drawer drag must never strand the drawer (nor, through the data-dragging lock above, the page)…');
  // ═════════════════════════════════════════════════════════════════════════
  // The reviewer's probe on SB-05 (scratchpad review-sb05/m0/probe.mjs): a Picks
  // repaint (innerHTML) mid-drag replaced the node under the finger; the rest of
  // the touch went to the detached node, the window-level drawer binder never
  // heard touchend, and the drawer sat at data-dragging="true", progress 0.28 —
  // ✕ and the scrim dead, the page frozen. Two halves here:
  //   F-1…F-4  the app's OWN repaint path (navigateTo('picks') → renderPicksPage,
  //            the same-tab Realtime repaint) waits for the drawer's release;
  //   F-5…F-12 a repaint OUTSIDE that door (the probe's raw innerHTML, standing
  //            in for any page without it) still strands the touch's end — and
  //            the next touch, ✕ or the scrim recovers the drawer and the page.
  await viewport(375, 667);
  /** Each scenario starts from a freshly loaded app (same stored league + session), so a drawer stranded
   *  by one scenario — the very bug, unrecoverable before SB-15 — can never pollute the next one's fixture. */
  const freshPicks = async () => {
    await navigate();
    await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo && document.getElementById('control-center')`);
    await evaluate(`window.navigateTo('picks')`);
    await sleep(400);
    await installRecorders();
    await evaluate(`addEventListener('touchstart', e => { window.__tt = e.target; }, true)`);
  };
  const tStart = (x, y) => pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  const tMove = async (x, y) => { await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(16); };
  const tEnd = () => pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const RAW_REPAINT = `(() => { const c = document.getElementById('page-picks'); c.innerHTML = c.innerHTML; })()`;
  /** The probe's gesture: an opening drag from the edge, a repaint after move 6, six more moves, release. */
  const dragWithRepaint = async (repaintExpr) => {
    await tStart(20, 420);
    for (let i = 1; i <= 6; i++) await tMove(20 + 15 * i, 420 - 2 * i);
    const before = await evaluate(`(() => { const t = window.__tt, p = document.getElementById('page-picks'); window.__firstBefore = p.firstElementChild;
      return { inPicks: !!(t && p.contains(t)), dragging: document.getElementById('control-center').dataset.dragging }; })()`);
    await evaluate(repaintExpr);
    const afterRepaint = await evaluate(`({ fingerNodeAttached: !!(window.__tt && window.__tt.isConnected), samePage: document.getElementById('page-picks').firstElementChild === window.__firstBefore })`);
    for (let i = 7; i <= 12; i++) await tMove(20 + 15 * i, 420 - 2 * i);
    await tEnd();
    await sleep(700);
    const after = await evaluate(`(() => ({ repainted: document.getElementById('page-picks').firstElementChild !== window.__firstBefore }))()`);
    return { before, afterRepaint, after, s: await evaluate(S) };
  };
  // ── (a) the app's own repaint waits for the release ──
  await freshPicks();
  a = await park(300);
  let r = await dragWithRepaint(`window.navigateTo('picks')`);
  assert(r.before.inPicks && r.before.dragging === 'true',
    `F-0: fixture — the finger came down on a node INSIDE #page-picks and the drawer is being dragged when the repaint is asked for (in picks ${r.before.inPicks}, data-dragging ${r.before.dragging})`);
  assert(r.afterRepaint.fingerNodeAttached && r.afterRepaint.samePage,
    `F-1: THE ROOT CAUSE — the app's own Picks repaint asked for mid-drag (navigateTo('picks'), the same-tab Realtime path) is PARKED: the node under the finger stays attached (attached ${r.afterRepaint.fingerNodeAttached}, page untouched ${r.afterRepaint.samePage})`);
  assert(r.s.dragging === 'false' && r.s.phase === 'open',
    `F-2: THE BUG — so the finger's release reaches the drawer and it settles (data-dragging ${r.s.dragging}, phase ${r.s.phase}; probe before SB-15: "true", stuck at 0.28)`);
  assert(r.after.repainted,
    `F-3: …and the parked repaint runs once the drawer has the release (page repainted after the drag ${r.after.repainted}) — nothing is lost, only moved after the finger`);
  await tapClose();
  a = await park(300);
  await swipe(Math.round(s.vw / 2), midY, -250);
  b = await evaluate(S);
  assert(b.win > a.win + 50 && b.hOy === 'visible', `F-4: …close, and the page scrolls (window ${a.win}→${b.win}, overflow-y "${b.hOy}")`);
  // ── (b) a repaint outside the door still loses the end — every way back works ──
  await freshPicks();
  a = await park(300);
  r = await dragWithRepaint(RAW_REPAINT);
  assert(!r.afterRepaint.fingerNodeAttached && r.s.dragging === 'true' && r.s.prog > 0.2 && r.s.hOy === 'hidden',
    `F-5: fixture — a raw innerHTML repaint (no deferral door) detaches the finger's node and the release is lost: stranded mid-drag exactly as the probe found it (attached ${r.afterRepaint.fingerNodeAttached}, data-dragging ${r.s.dragging}, progress ${r.s.prog.toFixed(2)}, page overflow-y "${r.s.hOy}")`);
  await evaluate(`document.querySelector('#control-center [data-action="cc-close"]').click()`);
  await waitFor(`document.getElementById('control-center').dataset.phase === 'closed' && document.getElementById('control-center').dataset.dragging === 'false'`, 2000);
  let c2 = await evaluate(S);
  assert(c2.dragging === 'false' && c2.open === 'false' && c2.phase === 'closed' && c2.hOy === 'visible' && !c2.inert,
    `F-6: THE BUG — ✕ closes the stranded drawer (data-dragging ${c2.dragging}, data-open ${c2.open}, phase ${c2.phase}), the page lock lifts (overflow-y "${c2.hOy}") and the page is live again (inert ${c2.inert}); the probe's exact step — before SB-15 nothing changed`);
  a = await park(300);
  await swipe(Math.round(s.vw / 2), midY, -250);
  b = await evaluate(S);
  assert(b.win > a.win + 50, `F-7: …and the page scrolls (window ${a.win}→${b.win})`);
  await freshPicks();
  a = await park(300);
  r = await dragWithRepaint(RAW_REPAINT);
  await evaluate(`document.getElementById('control-center-backdrop').click()`);
  await waitFor(`document.getElementById('control-center').dataset.phase === 'closed' && document.getElementById('control-center').dataset.dragging === 'false'`, 2000);
  c2 = await evaluate(S);
  assert(r.s.dragging === 'true' && c2.dragging === 'false' && c2.phase === 'closed' && c2.hOy === 'visible',
    `F-8: THE BUG — the dimmed SCRIM closes a stranded drawer too (stranded ${r.s.dragging} → data-dragging ${c2.dragging}, phase ${c2.phase}, overflow-y "${c2.hOy}")`);
  await freshPicks();
  a = await park(300);
  r = await dragWithRepaint(RAW_REPAINT);
  // The next touch lands in the LEFT QUARTER — where the drawer's own binder re-arms. Before SB-15 that
  // touchstart reset the binder's "drag active" WITHOUT ending the drag, so the drawer stayed stranded for
  // good (a touch outside the zone only cleared it by accident, at its END, with the lost drag's velocity).
  await tStart(40, 300);
  const atStart = await evaluate(S);
  await tEnd();
  await sleep(500);
  c2 = await evaluate(S);
  assert(r.s.dragging === 'true' && atStart.dragging === 'false' && c2.dragging === 'false' && c2.phase === 'closed' && c2.hOy === 'visible',
    `F-9: THE BUG — the NEXT touch (a tap in the left quarter, where the drawer re-arms) clears the stranded drag AT ITS START: the opening drag is cancelled back to closed and the page is free (stranded ${r.s.dragging} → at touchstart data-dragging ${atStart.dragging} → after: ${c2.dragging}, phase ${c2.phase}, overflow-y "${c2.hOy}")`);
  // The worst case: stranded at progress 0 — out and back, the repaint there, the end lost. data-open is
  // "false" (nothing on screen to tap), only data-dragging holds SB-05's page lock.
  await freshPicks();
  a = await park(300);
  await tStart(20, 420);
  for (let i = 1; i <= 8; i++) await tMove(20 + 15 * i, 420);
  for (let i = 1; i <= 10; i++) await tMove(140 - 15 * i, 420);
  await evaluate(RAW_REPAINT);
  await tMove(0, 420);
  await tEnd();
  await sleep(500);
  const z = await evaluate(S);
  assert(z.dragging === 'true' && z.open === 'false' && z.prog === 0 && z.hOy === 'hidden',
    `F-10: fixture — stranded at progress 0: invisible (data-open ${z.open}, progress ${z.prog}) yet the page is locked (data-dragging ${z.dragging}, overflow-y "${z.hOy}")`);
  await swipe(40, midY, -250);                                  // the player just tries to scroll (thumb on the left)
  a = await park(300);
  await swipe(40, midY, -250);
  b = await evaluate(S);
  assert(b.dragging === 'false' && b.hOy === 'visible' && b.win > a.win + 50,
    `F-11: THE BUG — the next touch releases it and the page scrolls again (data-dragging ${b.dragging}, overflow-y "${b.hOy}", window ${a.win}→${b.win}); before SB-15 the page stayed frozen until a drawer drag happened to end`);
  const bounce = await evaluate(S);
  assert(bounce.ob === OB_AUTO, `F-12: …and the page's own bounce is back too (${bounce.ob})`);
} catch (e) {
  assert(false, `the engine sections ran to completion (threw: ${e && e.message})`);
} finally {
  if (engine) {
    try { engine.proc.kill(); } catch { /* already gone */ }
    await new Promise(r => { if (engine.proc.exitCode !== null) r(); else { engine.proc.once('exit', r); setTimeout(r, 3000); } });
  }
  server.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 20000).unref();
