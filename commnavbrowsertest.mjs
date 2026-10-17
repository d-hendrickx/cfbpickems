/**
 * CFB Pickems - commnavbrowsertest.mjs
 * =====================================
 * W-70 (Deployment 1, batch D, 2026-10-14; DI-W70.1 .. DI-W70.6) - NATIVE NAVIGATION IN COMM, proven in a real engine.
 *
 * Drew, 2026-10-14: "you should be able to swipe down to close the week wizard and left and right to navigate within in. And left and right to navigate between tabs in the com panel."
 *
 * ENGINE-MEASURED through the REAL app: the real index.html, css/styles.css and js/app.js booted in a real headless Chromium, a commissioner session and a draft week seeded through the
 * app's OWN js/storage.js + js/data-model.js, the Comm page opened through the real navigateTo() (which binds the tab pager) and the wizard opened by clicking its real entry button
 * (which mounts the sheet and binds the step pager). Every gesture is a REAL touch sequence (CDP Input.dispatchTouchEvent) hit-tested by the engine. Nothing here calls bindWeekSwipe()
 * or bindSwipeToDismiss() directly: a gate the page arms for itself is armed by the page (P-2).
 *
 *   [A] COMM TABS   swipe left/right moves Week > Games > Players > Rules > SCRIBE through the same engine as the week swipe; the strip follows; the bounds rubber-band with no
 *                   change; the incoming tab is on screen beside the outgoing one during the drag and the outgoing layer carries ONLY its own tab; nothing re-renders (typed text and
 *                   a marked node survive); no gesture ever changes the bottom tab (T-27).
 *   [B] ARBITRATION the drawer rule: a left-to-right swipe starting in the left quarter opens the Control Center and does not change tab; elsewhere it changes tab. A text field and the
 *                   tab strip keep their own touch; a sideways scroller would.
 *   [C] HOLDS       a repaint parked while the pager owns the touch runs when it ends (P-2); a NEW touch landing during that hold, and during a spring-back, still works (P-3).
 *   [D] WIZARD DISMISS  swipe down closes the sheet from the header AND from the body at scroll-top, on a TOUCH device in the WEB app (no native shell); a body scrolled down scrolls
 *                   instead; the body does not scroll or bounce under a claimed drag; a drag that starts upward is a scroll and never dismisses; the side-panel layout (>= 700 px)
 *                   is not armed; edits make every close path (swipe, X, backdrop) ask first, Keep Editing returns focus to the field, Discard Changes closes; a finalize in flight
 *                   refuses all three with a toast.
 *   [E] WIZARD PAGER swipe left/right moves between steps through the same buttons the footer has; Step 1 and Step 6 never advance by swipe; a refused Next (empty blurb) springs
 *                   back and shows the button's own inline error; a Back swipe with edits asks first; the outgoing step stays under the finger inside the TRANSFORMED sheet; the
 *                   incoming step is drawn beside it; Reduce Motion cross-fades.
 *   [F] STYLING     computed style in the engine for what is new (P-8): the pane and clip, the pager's touch-action and transform, the layers' visibility rules, the drag-time body lock.
 *
 * WHAT ONLY A DEVICE CAN CONFIRM: Blink is not WebKit. Whether iOS 15's scroll view really stops rubber-banding a body under a claimed drag, how the finger feels against the filmstrip,
 * the haptics, and the transformed-sheet alignment in WKWebView are Drew's on-device walk.
 *
 * The app boots in LOCAL (PIN) mode: this suite's own localhost server answers /config.json with `{}` and 404s service-worker.js; all other network resolution is blocked.
 *
 * Run: node commnavbrowsertest.mjs
 * Override the browser: COMMNAV_ENGINE=/path/to/Chromium (falls back to WEEKPAGER_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE).
 * Mutation runs: COMMNAV_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree instead of this one - mutate the copy, never this checkout.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.COMMNAV_ROOT || here;
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
const override = process.env.COMMNAV_ENGINE || process.env.WEEKPAGER_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: COMMNAV_ENGINE=/path/to/Chromium node commnavbrowsertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (COMMNAV_ROOT - serving ${ROOT})`);

// -- the app server: the real tree, local-mode config, no service worker -------------------------------------------------------------------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; }
  if (p === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  if (p.split('/').some(seg => seg.startsWith('.')) || p.startsWith('/supabase/') || p === '/supabase') { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// -- the CDP client (same shape as weekpagertest.mjs / wizardsheettest.mjs) ----------------------------------------------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-commnav-'));
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
  const frame = () => evaluate('new Promise(r => requestAnimationFrame(() => r(true)))');
  const reducedMotion = async (on) => {
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
    await sleep(60);
  };

  // Real touches, hit-tested by the engine. `land` queues the landing with its leading moves together (Chrome holds back moves inside its touch slop), as weekpagertest does.
  const LEAD_PX = 20;
  const touch = {
    async down(x, y) { await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); },
    async move(x, y) { await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(16); await frame(); },
    async up() { await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
    async land(x0, y0, pts) {
      const lead = Math.max(1, pts.findIndex(([x, y]) => Math.hypot(x - x0, y - y0) >= LEAD_PX) + 1 || pts.length);
      await Promise.all([pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] }),
        ...pts.slice(0, lead).map(([x, y]) => pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }))]);
      await sleep(16); await frame();
      return lead;
    },
  };
  const line = (x0, y0, x1, y1, n = 8) => Array.from({ length: n }, (_, i) => [Math.round(x0 + (x1 - x0) * (i + 1) / n), Math.round(y0 + (y1 - y0) * (i + 1) / n)]);
  /** A whole drag: land, move along `pts`, optionally `hold` mid-way (so the caller can sample), then lift. Returns after the lift. */
  const drag = async (x0, y0, pts, { holdAt = null, onHold = null, lift = true } = {}) => {
    const lead = await touch.land(x0, y0, pts);
    for (let i = lead; i < pts.length; i++) {
      await touch.move(pts[i][0], pts[i][1]);
      if (holdAt === i && onHold) await onHold();
    }
    if (holdAt === pts.length - 1 && onHold && holdAt < lead) await onHold();
    if (lift) await touch.up();
  };
  const settleIdle = async (rootId) => {
    await waitFor(`!document.querySelector('.week-swipe-exit-layer') && !document.getElementById('${rootId}')?.dataset.weekSwipeAnimating`, 4000);
    await sleep(80);
  };

  // ======================================================================================================================================================================================
  console.log('\n[1] Boot the REAL app (local mode), seed a commissioner + a DRAFT week of 16 games with no spreads, a typed-in-able Comm page…');
  // ======================================================================================================================================================================================
  await viewport(390, 844);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '1-0: fixture - the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const wk = dm.createWeek(2026, 5); wk.status = 'draft';
    const base = new Date(Date.now() + 3 * 86400000); base.setUTCHours(20, 34, 17, 0);
    wk.startDate = base.toISOString().slice(0, 10); wk.endDate = wk.startDate;      // W-71: Find spreads re-reads ESPN for the week's dates
    st.saveWeek(wk); st.setActiveWeekId(wk.weekId);
    for (let i = 0; i < 16; i++) st.saveGame(dm.createGame(wk.weekId, { homeTeam: 'Home ' + i, awayTeam: 'Away ' + i, kickoff: base.toISOString(), spread: null,
      kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening', lockedSpread: -2.5, espnEventId: '40199900' + i }));
    st.setSession(null, true, false);
    await new Promise(r => setTimeout(r, 1200));
    return { weekId: wk.weekId, games: st.getGames(wk.weekId).length };
  })()`);
  assert(seeded.games === 16, `1-1: fixture - 16 games seeded on a draft week through the app's own storage.js (got ${seeded.games})`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '1-2: fixture - after reload the app is past the site gate with a commissioner session');
  // The boot's own last step is Home's first render (W-22): wait for it, then go to Comm through the REAL navigateTo() - the call that binds the tab pager.
  await waitFor(`document.querySelector('#page-home.active') && !document.querySelector('#home-root .home-feed[aria-busy="true"]')`, 10000);
  const gotoComm = async (tab = 'week') => {
    await evaluate(`window.navigateTo('commissioner')`);
    await waitFor(`document.querySelector('#page-commissioner.active .comm-tabbar')`, 6000);
    await evaluate(`document.querySelector('#page-commissioner [data-comm-tab-btn="${tab}"]').click()`);
    await sleep(500);                                  // the tab's fade-in
    await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
    await settleIdle('page-commissioner');
  };
  await gotoComm('week');
  const TABS = ['week', 'games', 'players', 'rules', 'scribe'];
  const commState = () => evaluate(`({ tab: document.getElementById('page-commissioner').getAttribute('data-comm-active'), btn: document.querySelector('#page-commissioner .comm-tab.active')?.dataset.commTabBtn || null,
    bottom: document.body.dataset.tab, cc: document.querySelector('#control-center')?.dataset.open || null, x: getComputedStyle(document.getElementById('page-commissioner')).transform })`);
  const fx = await commState();
  assert(fx.tab === 'week' && fx.btn === 'week' && fx.bottom === 'commissioner',
    `1-3: fixture - the Comm panel is up on its Week tab (flag "${fx.tab}", active button "${fx.btn}", bottom tab "${fx.bottom}")`);
  const geo = await evaluate(`(() => { const r = document.getElementById('page-commissioner').getBoundingClientRect(); const tb = document.querySelector('#page-commissioner .comm-tabbar').getBoundingClientRect();
    return { vw: innerWidth, vh: innerHeight, rootL: r.left, rootR: r.right, tabTop: tb.top, tabBottom: tb.bottom, tabbarFits: document.querySelector('#page-commissioner .comm-tabbar').scrollWidth <= document.querySelector('#page-commissioner .comm-tabbar').clientWidth + 1 }; })()`);
  const MID_Y = Math.round(Math.max(geo.tabBottom + 120, 320));      // a point well below the tab strip, on the page body
  // Sections visible per layer, by their tab - the engine's own painted state.
  const sectionsIn = (sel) => evaluate(`(() => { const out = []; for (const el of document.querySelectorAll(${JSON.stringify(sel)} + ' .admin-section[data-comm-tab]')) {
    const cs = getComputedStyle(el); if (cs.display !== 'none') out.push(el.getAttribute('data-comm-tab')); } return [...new Set(out)]; })()`);

  // A swipe's first touch must land on ordinary page body: a text field, a select or a sideways scroller keeps its own touch BY DESIGN (B), so the plain paging cases pick a row of the
  // page that has none under either start point - decided by the app's own predicates (isPagerYieldTarget / _isDrawerYieldTarget), not by this harness's idea of what yields.
  const safeY = (xs = [150, 330]) => evaluate(`(async () => {
    const ng = await import('./js/nav-gestures.js'); const root = document.getElementById('page-commissioner');
    const top = Math.round(document.querySelector('#page-commissioner .comm-tabbar').getBoundingClientRect().bottom) + 24;
    for (let y = top; y < innerHeight - 90; y += 6) {
      if (${JSON.stringify(xs)}.every(x => { const el = document.elementFromPoint(x, y); return el && root.contains(el) && !ng.isPagerYieldTarget(el, root) && !ng._isDrawerYieldTarget(el) && !el.closest('button, a, [role="button"], summary'); })) return y;
    }
    return null; })()`);

  // ======================================================================================================================================================================================
  console.log('\n[A] Comm tabs - swipe left/right between Week . Games . Players . Rules . SCRIBE (the week swipe’s engine and direction table)…');
  // ======================================================================================================================================================================================
  await evaluate(`window.__mark = document.createElement('i'); window.__mark.id = 'markA'; document.querySelector('#page-commissioner [data-comm-tab="week"]').appendChild(window.__mark); true`);
  let Y = MID_Y;
  const refreshY = async () => { Y = (await safeY()) ?? MID_Y; return Y; };
  const swipeLeft = async (y = null, fromX = 330, toX = 90) => { const yy = y ?? (await safeY()) ?? MID_Y; return drag(fromX, yy, line(fromX, yy, toX, yy)); };
  const swipeRight = async (y = null, fromX = 150, toX = 340) => { const yy = y ?? (await safeY()) ?? MID_Y; return drag(fromX, yy, line(fromX, yy, toX, yy)); };
  for (let i = 0; i < TABS.length - 1; i++) {
    await swipeLeft();
    await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === '${TABS[i + 1]}'`, 3000);
    await settleIdle('page-commissioner');
    const s = await commState();
    assert(s.tab === TABS[i + 1] && s.btn === TABS[i + 1] && s.bottom === 'commissioner',
      `A-${i + 1}: swipe LEFT from mid-screen goes to the NEXT tab - ${TABS[i]} → ${TABS[i + 1]} (flag "${s.tab}", strip button "${s.btn}"); the bottom tab is still "${s.bottom}" (T-27)`);
  }
  let last = await commState();
  await swipeLeft();
  await sleep(450); await settleIdle('page-commissioner');
  let s2 = await commState();
  assert(last.tab === 'scribe' && s2.tab === 'scribe' && s2.bottom === 'commissioner', `A-5: at SCRIBE (the last tab) a left swipe changes nothing (still "${s2.tab}") - it rubber-bands`);
  assert(/^none$|^matrix\(1, 0, 0, 1, 0, 0\)$/.test(s2.x), `A-5b: and the page is back at rest after the bounce (transform "${s2.x}")`);
  for (let i = TABS.length - 1; i > 0; i--) {
    await swipeRight();
    await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === '${TABS[i - 1]}'`, 3000);
    await settleIdle('page-commissioner');
    const s = await commState();
    assert(s.tab === TABS[i - 1] && s.btn === TABS[i - 1], `A-${6 + (TABS.length - 1 - i)}: swipe RIGHT from mid-screen goes to the PREVIOUS tab - ${TABS[i]} → ${TABS[i - 1]} (flag "${s.tab}", strip button "${s.btn}")`);
  }
  await swipeRight();
  await sleep(450); await settleIdle('page-commissioner');
  s2 = await commState();
  assert(s2.tab === 'week' && s2.cc !== 'true', `A-10: on Week (the first tab) a right swipe from mid-screen changes nothing and opens no drawer (flag "${s2.tab}", drawer "${s2.cc}") - it rubber-bands`);
  const survived = await evaluate(`document.getElementById('markA')?.isConnected === true && document.querySelector('#page-commissioner [data-comm-tab="week"]').contains(document.getElementById('markA'))`);
  assert(survived, 'A-11: eight tab swipes later the node we planted on the Week tab is still the same node in the document - a swipe changes the visible tab and RE-RENDERS NOTHING (typed text, collapsed sections and focus survive)');

  // The preview: the incoming tab beside the outgoing one while the finger is still down, and the outgoing layer holds ONLY the tab it was showing.
  const peek = async (dir) => {
    await refreshY();
    const x0 = dir < 0 ? 330 : 150, x1 = dir < 0 ? 130 : 350;
    let seen = null;
    await drag(x0, Y, line(x0, Y, x1, Y, 10), { holdAt: 9, onHold: async () => {
      seen = await evaluate(`(() => { const root = document.getElementById('page-commissioner'); const layer = root.querySelector('.week-swipe-incoming-layer');
        const lr = layer && layer.getBoundingClientRect(), rr = root.getBoundingClientRect();
        return { has: !!layer, pane: layer?.querySelector('.comm-pane')?.getAttribute('data-comm-pane') || null, inert: layer?.hasAttribute('inert') === true, left: lr ? Math.round(lr.left) : null, right: lr ? Math.round(lr.right) : null,
          rootL: Math.round(rr.left), rootR: Math.round(rr.right), vw: innerWidth, lock: getComputedStyle(document.documentElement).overflowY,
          visible: layer ? [...new Set([...layer.querySelectorAll('.admin-section[data-comm-tab]')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.getAttribute('data-comm-tab')))] : [],
          activeInLayer: layer?.querySelector('.comm-tab.active')?.dataset.commTabBtn || null,
          ids: layer ? layer.querySelectorAll('[id]').length : -1, names: layer ? layer.querySelectorAll('[name]').length : -1 }; })()`);
    } });
    await sleep(450); await settleIdle('page-commissioner');
    return seen;
  };
  let pk = await peek(-1);       // on Week, dragging toward Games
  assert(pk && pk.has && pk.pane === 'games' && pk.inert, `A-12: mid-drag from Week toward Games, the Games tab is on screen in an inert layer (pane "${pk?.pane}", inert ${pk?.inert})`);
  assert(pk && pk.left >= pk.rootR - 2 && pk.left < pk.vw, `A-13: that layer sits flush against the right edge of the page and is partly inside the viewport (layer left ${pk?.left}, page right ${pk?.rootR}, viewport ${pk?.vw}) - the next tab is "coming in"`);
  assert(pk && pk.visible.length === 1 && pk.visible[0] === 'games' && pk.activeInLayer === 'games',
    `A-14: the layer shows ONLY the Games sections (${JSON.stringify(pk?.visible)}) with Games marked active in its copy of the tab strip ("${pk?.activeInLayer}") - not the live panel's flag, not all five tabs stacked`);
  assert(pk && pk.ids === 0 && pk.names === 0, `A-15: the copy carries no ids and no radio-group names (${pk?.ids} ids, ${pk?.names} names): it cannot shadow a real node or join - and un-check - a real radio group`);
  assert(pk && pk.lock === 'hidden', `A-16: while the swipe owns the touch the document is locked against vertical scroll, as SB-23 does for the week swipe (overflow-y "${pk?.lock}")`);
  assert((await commState()).tab === 'games', 'A-16b: the peek was a full swipe: its release committed (Week \u2192 Games), so the next one starts on Games');
  pk = await peek(1);            // on Games, dragging back toward Week
  assert(pk && pk.has && pk.pane === 'week' && pk.right <= pk.rootL + 2 && pk.right > 0, `A-17: dragging right from Games, the Week tab is in a layer flush against the LEFT edge (pane "${pk?.pane}", layer right ${pk?.right}, page left ${pk?.rootL})`);
  const lockAfter = await evaluate(`getComputedStyle(document.documentElement).overflowY`);
  assert(lockAfter !== 'hidden', `A-18: the lock lifts when the finger does (overflow-y "${lockAfter}")`);
  assert((await commState()).tab === 'week', 'A-18b: ...and its release committed back to Week');

  // The exit layer: during the commit slide it carries only the tab that was showing (it sits outside the rules keyed on the panel).
  let exitSeen = null;
  await refreshY();
  await drag(330, Y, line(330, Y, 100, Y, 8), { lift: false });
  await evaluate(`window.__exit = null; new MutationObserver((recs, ob) => { const el = document.querySelector('.week-swipe-exit-layer'); if (el && !window.__exit) { window.__exit = { pane: el.getAttribute('data-comm-pane'), sections: [...new Set([...el.querySelectorAll('.admin-section[data-comm-tab]')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.getAttribute('data-comm-tab')))], all: [...new Set([...el.querySelectorAll('.admin-section[data-comm-tab]')].map(e => e.getAttribute('data-comm-tab')))], position: getComputedStyle(el).position }; ob.disconnect(); } }).observe(document.querySelector('.main-content') || document.body, { childList: true, subtree: true }); true`);
  await touch.up();
  await waitFor('window.__exit', 3000);
  exitSeen = await evaluate('window.__exit');
  await settleIdle('page-commissioner');
  assert(exitSeen && exitSeen.pane === 'week' && exitSeen.sections.length === 1 && exitSeen.sections[0] === 'week' && exitSeen.all.length === 1,
    `A-19: on release the outgoing layer is a copy of the WEEK tab only - ${JSON.stringify(exitSeen?.all)} sections in it, ${JSON.stringify(exitSeen?.sections)} visible (not all five tabs stacked for the length of the slide)`);
  assert(exitSeen && exitSeen.position === 'fixed', `A-19b: on a PAGE (not a sheet) the exit layer is viewport-fixed exactly as for Picks and Dashboard (position "${exitSeen?.position}") - the pane-mode geometry is used only inside the wizard`);
  await swipeRight(); await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === 'week'`, 3000); await settleIdle('page-commissioner');

  // N-7 (review 2026-10-14): the instant-switch flag lives for the slide only, and clearing it must not replay the tab's fade-in over the tab that has just landed. A per-frame sampler runs
  // across a real swipe (Week -> Games) and for 700 ms after it; the Games section's computed opacity must never dip, the flag must have been up during the slide and gone after it.
  await evaluate(`(() => { window.__n7 = { op: [], flag: [], stop: false }; const loop = () => { const el = document.querySelector('#page-commissioner .admin-section[data-comm-tab="games"]'); const r = document.getElementById('page-commissioner');
    window.__n7.op.push(el ? Number(getComputedStyle(el).opacity) : -1); window.__n7.flag.push(r.getAttribute('data-comm-instant') === 'true'); if (!window.__n7.stop) requestAnimationFrame(loop); }; requestAnimationFrame(loop); return true; })()`);
  await swipeLeft();
  await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === 'games'`, 3000);
  await sleep(900);
  const n7 = await evaluate(`(() => { window.__n7.stop = true; const o = window.__n7; return { frames: o.op.length, min: Math.min(...o.op), sawFlag: o.flag.some(Boolean), flagNow: document.getElementById('page-commissioner').getAttribute('data-comm-instant'),
    running: [...document.querySelectorAll('#page-commissioner .admin-section[data-comm-tab="games"]')].reduce((n, e) => n + e.getAnimations().filter(a => a.playState === 'running').length, 0) }; })()`);
  assert(n7.frames > 20 && n7.sawFlag === true && n7.flagNow === null, `A-20: the instant-switch flag was up during the slide (${n7.sawFlag}) and is gone when it ends (now ${JSON.stringify(n7.flagNow)}), over ${n7.frames} sampled frames`);
  assert(n7.min >= 0.99 && n7.running === 0, `A-20b: clearing it does not replay the tab's fade-in over the tab that just landed: the Games section's opacity never dipped (min ${n7.min}) and no animation is running on it (${n7.running})`);
  await swipeRight(); await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === 'week'`, 3000); await settleIdle('page-commissioner');

  // ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  console.log('\n[B] Arbitration - the drawer rule, text fields, the tab strip…');
  // ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // Left quarter, rightward: the Control Center opens and the tab does not change.
  await refreshY();
  await drag(40, Y, line(40, Y, 300, Y, 10));
  await sleep(600);
  let b = await commState();
  assert(b.cc === 'true' && b.tab === 'week', `B-1: a left-to-right swipe that STARTS in the left quarter (x 40 of 390) opens the Control Center and does not change tab (drawer "${b.cc}", tab "${b.tab}")`);
  await evaluate(`document.querySelector('#control-center-backdrop')?.click() || document.querySelector('#control-center [data-action="close"]')?.click(); true`);
  await sleep(500);
  if ((await commState()).cc === 'true') await drag(300, 500, line(300, 500, 20, 500, 8));      // closing drag, in case the backdrop tap did not
  await sleep(500);
  await swipeRight(null, 140, 330);
  await sleep(500); await settleIdle('page-commissioner');
  b = await commState();
  assert(b.cc !== 'true' && b.tab === 'week', `B-2: the same swipe starting further in (x 140) does not open the drawer, and Week has no previous tab (drawer "${b.cc}", tab "${b.tab}")`);
  // Left swipe from the left quarter changes tab (it can never mean the drawer).
  await gotoComm('week'); await refreshY();
  await drag(70, Y, line(70, Y, 8, Y, 8));
  await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') !== 'week'`, 3000); await settleIdle('page-commissioner');
  b = await commState();
  assert(b.tab === 'games' && b.cc !== 'true', `B-3: a swipe LEFT that starts inside the left quarter (x 70) still moves to the next tab (tab "${b.tab}", drawer "${b.cc}")`);
  // Back to Week for the remaining cases.
  await gotoComm('week');

  // A text field keeps its touch: find a text control on the Week tab and drag across it.
  const field = await evaluate(`(() => { const el = [...document.querySelectorAll('#page-commissioner [data-comm-tab="week"] textarea, #page-commissioner [data-comm-tab="week"] input[type="text"], #page-commissioner [data-comm-tab="week"] input:not([type])')].find(e => { const r = e.getBoundingClientRect(); return r.width > 80 && r.height > 20 && getComputedStyle(e).display !== 'none'; });
    if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: el.id }; })()`);
  assert(!!field, `B-4: fixture - a text field exists on the Week tab (${field?.id || 'none found'})`);
  if (field) {
    await sleep(150);
    const f2 = await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(field.id)}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await drag(f2.x + 60, f2.y, line(f2.x + 60, f2.y, f2.x - 100, f2.y, 8));
    await sleep(450); await settleIdle('page-commissioner');
    b = await commState();
    assert(b.tab === 'week', `B-5: a swipe that STARTS on a text field (#${field.id}) does not change tab (tab "${b.tab}") - the field keeps its touch`);
    await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  }
  // The tab strip keeps its touch: a horizontal drag that starts on it does not page.
  const strip = await evaluate(`(() => { const r = document.querySelector('#page-commissioner .comm-tabbar').getBoundingClientRect(); return { y: Math.round(r.top + r.height / 2) }; })()`);
  await drag(320, strip.y, line(320, strip.y, 80, strip.y, 8));
  await sleep(450); await settleIdle('page-commissioner');
  b = await commState();
  assert(b.tab === 'week', `B-6: a swipe that STARTS on the tab strip does not page the tabs (tab "${b.tab}") - the strip keeps its touch`);
  await drag(40, strip.y, line(40, strip.y, 300, strip.y, 8));
  await sleep(600);
  b = await commState();
  assert(b.cc !== 'true', `B-7: and a left-quarter rightward swipe that starts ON the strip does not open the drawer either (drawer "${b.cc}") - the pager and the drawer both stand down for it`);
  const nav0 = await evaluate(`document.body.dataset.tab`);
  assert(nav0 === 'commissioner', `B-8: after every gesture above the bottom tab is still "${nav0}" - no swipe ever changed a bottom tab (T-27 / DI-W70.5)`);

  // ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  console.log('\n[C] Holds - a parked repaint, and a NEW touch during it (P-2 / P-3)…');
  // ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // P-2: the deferral is armed by a REAL swipe (the page's own binder claims the touch), not by calling the arming function.
  await evaluate(`window.__marker = document.createElement('i'); window.__marker.id = 'markC'; document.querySelector('#page-commissioner [data-comm-tab="week"]').appendChild(window.__marker); true`);
  await refreshY();
  await drag(330, Y, line(330, Y, 200, Y, 8), { lift: false });
  await evaluate(`window.navigateTo('commissioner'); true`);          // the page's OWN repaint path (a second import of app.js would be a second app instance)
  await sleep(120);
  const midHold = await evaluate(`document.getElementById('markC')?.isConnected === true`);
  assert(midHold, 'C-1: a repaint requested while the Comm pager owns the touch is PARKED - the node under the finger is still in the document mid-drag');
  await touch.up();
  await waitFor(`document.getElementById('markC') === null || !document.getElementById('markC')?.isConnected`, 3000);
  await sleep(500); await settleIdle('page-commissioner');
  const afterHold = await evaluate(`({ gone: !document.getElementById('markC'), tab: document.getElementById('page-commissioner').getAttribute('data-comm-active') })`);
  assert(afterHold.gone, 'C-2: and the parked repaint RUNS when the touch ends (the planted node is gone: the page was repainted once the finger lifted)');
  await gotoComm('week');
  // P-3: a new touch during the spring-back works. Refuse a swipe at the first tab (right on Week bounces), then swipe left again at once.
  await refreshY();
  await drag(150, Y, line(150, Y, 330, Y, 8));        // bounce
  await sleep(40);                                                 // inside the 150 ms spring-back
  await drag(330, Y, line(330, Y, 90, Y, 8));
  await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === 'games'`, 3000); await settleIdle('page-commissioner');
  b = await commState();
  assert(b.tab === 'games', `C-3: P-3 - a NEW swipe that lands 40 ms into a spring-back still works (tab "${b.tab}")`);
  // P-3 for the parked repaint: a repaint parked during a drag, and a new touch BEFORE the lift of the old one cannot happen (one finger) - so: park, lift, and the very next touch is accepted.
  await refreshY();
  await drag(330, Y, line(330, Y, 200, Y, 6), { lift: false });
  await evaluate(`window.navigateTo('commissioner'); true`);
  await touch.up();
  await sleep(30);
  await drag(330, Y, line(330, Y, 90, Y, 8));
  await sleep(700); await settleIdle('page-commissioner');
  b = await commState();
  assert(b.tab === 'players', `C-4: P-3 - with a repaint parked and the finger just lifted, the NEXT swipe is accepted (Games → ${b.tab})`);

  // ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  console.log('\n[F1] Styling (P-8) - the Comm pager, computed in the engine…');
  // ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const css1 = await evaluate(`(() => { const cs = getComputedStyle(document.getElementById('page-commissioner')); return { ta: cs.touchAction, tr: cs.transform }; })()`);
  assert(/pan-y/.test(css1.ta) && /pinch-zoom/.test(css1.ta), `F1-1: the Comm page carries touch-action pan-y pinch-zoom (a drag that begins sideways is not a scroll) - "${css1.ta}"`);
  const stripTa = await evaluate(`getComputedStyle(document.querySelector('#page-commissioner .comm-tabbar')).touchAction`);
  assert(stripTa === 'auto', `F1-2: the tab strip keeps touch-action auto (it pans sideways itself) - "${stripTa}"`);
  await refreshY();
  await drag(330, Y, line(330, Y, 250, Y, 6), { lift: false });
  const drgStyle = await evaluate(`(() => { const r = document.getElementById('page-commissioner'); const cs = getComputedStyle(r); return { tr: cs.transform, x: r.style.getPropertyValue('--week-swipe-x'), trans: cs.transitionProperty, dur: cs.transitionDuration }; })()`);
  assert(/^matrix/.test(drgStyle.tr) && /px$/.test(drgStyle.x) && parseFloat(drgStyle.x) < -30, `F1-3: while dragging, the page's computed transform follows --week-swipe-x (${drgStyle.x} → "${drgStyle.tr}")`);
  await touch.up(); await sleep(500); await settleIdle('page-commissioner');
  await reducedMotion(true);
  await gotoComm('week');
  await refreshY();
  await drag(330, Y, line(330, Y, 90, Y, 8), { lift: false });
  const rmDrag = await evaluate(`document.getElementById('page-commissioner').style.getPropertyValue('--week-swipe-x')`);
  await touch.up();
  const rmSeen = await evaluate(`new Promise(res => { const t0 = performance.now(); let kind = null; (function loop() { const k = document.getElementById('page-commissioner').dataset.weekSwipeAnimating; if (k) kind = kind || k; if (performance.now() - t0 < 400) requestAnimationFrame(loop); else res(kind); })(); })`);
  await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === 'games'`, 3000); await settleIdle('page-commissioner');
  assert(/px$/.test(rmDrag) && rmSeen === 'fade' && (await commState()).tab === 'games', `F1-4: Reduce Motion - the page still FOLLOWS the finger (${rmDrag}) and the release cross-fades ("${rmSeen}") instead of sliding; the tab still changes`);
  await reducedMotion(false);


  // ======================================================================================================================================================================================
  console.log('\n[D] Wizard - swipe down to close (touch, WEB app, no native shell)…');
  // ======================================================================================================================================================================================
  const wizOpen = () => evaluate(`!!document.getElementById('week-wizard-sheet-wrap')`);
  const stepNow = () => evaluate(`(() => { const m = /Step (\\d+) of/.exec((document.getElementById('week-wizard-step-tracker')?.textContent || '').replace(/\\s+/g, ' ')); return m ? Number(m[1]) : null; })()`);
  const wizGeo = () => evaluate(`(() => { const r = (id) => { const e = typeof id === 'string' ? document.getElementById(id) : id; if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    return { sheet: r('week-wizard-sheet'), body: r('week-wizard-body'), pager: r('week-wizard-pager'), clip: r(document.querySelector('.wiz-pager-clip')), header: r(document.querySelector('#week-wizard-sheet .chat-sheet-header')),
      tracker: r('week-wizard-step-tracker'), vw: innerWidth, vh: innerHeight, scrollTop: document.getElementById('week-wizard-body')?.scrollTop ?? null }; })()`);
  const waitWizSettled = async () => { await waitFor(`(() => { const s = document.getElementById('week-wizard-sheet'); return s && s.getAnimations().length === 0 && getComputedStyle(s).transform === 'none'; })()`, 3000); await sleep(80); };
  const openWiz = async () => {
    await evaluate(`window.navigateTo('commissioner')`);
    await waitFor(`document.getElementById('week-wizard-entry-btn')`, 6000);
    await evaluate(`document.getElementById('week-wizard-entry-btn').click()`);
    const ok = await waitFor(`document.querySelector('#week-wizard-body button, #week-wizard-body input')`, 6000);
    await waitWizSettled();
    return ok;
  };
  const closeWizHard = async () => { await evaluate(`(() => { document.getElementById('ls-action-layer')?.querySelector('[data-ls-action="discard"]')?.click(); document.getElementById('week-wizard-close')?.click(); document.getElementById('ls-action-layer')?.querySelector('[data-ls-action="discard"]')?.click(); return true; })()`); await sleep(150); };
  const goStep = async (n) => {
    for (let g = 0; g < 9; g++) {
      const cur = await stepNow(); if (cur === n) return true;
      if (cur < n) {
        if (cur === 5) await evaluate(`(() => { const t = document.getElementById('wiz-blurb-body'); if (t) t.value = 'A fine blurb for the week.'; return true; })()`);
        await evaluate(`(document.getElementById(${JSON.stringify(cur === 1 ? 'wiz-step1-create' : `wiz-step${cur}-next`)}) || {}).click?.()`);
      } else await evaluate(`(document.getElementById('wiz-step${cur}-back') || {}).click?.()`);
      await sleep(120);
    }
    return (await stepNow()) === n;
  };
  const layerInfo = () => evaluate(`(() => { const l = document.getElementById('ls-action-layer'); if (!l) return null; const t = l.querySelector('.lc-as-ttl'); const keep = l.querySelector('[data-ls-action="keep-editing"].lc-as-act, .lc-as-bold'); const dis = l.querySelector('.lc-as-danger');
    const rc = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; };
    return { title: t?.textContent || '', msg: l.querySelector('.lc-as-msg')?.textContent || '', danger: dis?.textContent, bold: keep?.textContent, keepAt: rc(keep), discardAt: rc(dis), z: getComputedStyle(l).zIndex,
      topAtKeep: (() => { const p = rc(keep); const e = document.elementFromPoint(p.x, p.y); return e && (e === keep || keep.contains(e)); })() }; })()`);
  const tap = async (x, y) => { await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(120); };

  assert(await openWiz(), 'D-0: fixture - the wizard opened from its real entry button over the Comm page (a draft week with 16 games lands on Step 3)');
  let g = await wizGeo();
  assert(g.sheet && g.sheet.b <= g.vh + 0.5 && g.sheet.t >= 0 && g.body.h > 180, `D-0b: the sheet is bounded inside the viewport with a usable body (sheet ${Math.round(g.sheet.t)}..${Math.round(g.sheet.b)} of ${g.vh}; body ${Math.round(g.body.h)} px) - the new pane and clip changed no geometry`);
  assert(g.clip && g.pager && Math.abs(g.clip.t - g.pager.t) < 1 && Math.abs(g.body.t - g.pager.t) < 1 && Math.abs(g.body.h - g.pager.h) < 1 && Math.abs(g.clip.h - g.body.h) < 1,
    `D-0c: the body fills its pane and the pane fills its clip exactly (clip ${Math.round(g.clip.h)}, pane ${Math.round(g.pager.h)}, body ${Math.round(g.body.h)})`);
  assert((await stepNow()) === 3, `D-0d: the draft week lands on Step 3 (got ${await stepNow()})`);
  const midBody = () => ({ x: Math.round(g.sheet.l + g.sheet.w / 2), y: Math.round(g.body.t + 40) });

  // D-1: from the body at scroll-top, mid-drag styling, then dismissed
  g = await wizGeo();
  let hold = null;
  {
    const m = midBody();
    await drag(m.x, m.y, line(m.x, m.y, m.x, m.y + 420, 10), { holdAt: 6, onHold: async () => {
      hold = await evaluate(`(() => { const w = document.getElementById('week-wizard-sheet-wrap'), s = document.getElementById('week-wizard-sheet'), b = document.getElementById('week-wizard-body'); const cs = getComputedStyle(b);
        return { y: Number(w.style.getPropertyValue('--wizard-drag-y')), dragging: s.getAttribute('data-dragging'), oy: cs.overflowY, ob: cs.overscrollBehaviorY, st: b.scrollTop, tr: getComputedStyle(s).transform }; })()`);
    } });
  }
  assert(hold && hold.y > 0.1 && hold.dragging === 'true' && /^matrix/.test(hold.tr), `D-1a: a drag that starts on the BODY at scroll-top follows the finger - the sheet is translated (drag ${hold?.y?.toFixed?.(2)}, transform "${hold?.tr}")`);
  assert(hold && hold.oy === 'hidden' && hold.ob === 'none' && hold.st === 0, `D-1b: P-8 - while the drag is claimed the BODY is not scrollable and does not rubber-band under the finger (computed overflow-y "${hold?.oy}", overscroll-behavior-y "${hold?.ob}", scrollTop ${hold?.st})`);
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`, 3000);
  assert(!(await wizOpen()), 'D-1c: released past 40% the sheet slides away and is removed (a clean sheet closes with no question)');
  assert(!(await evaluate(`!!document.getElementById('ls-action-layer')`)), 'D-1d: …and no "Discard changes?" was raised');

  // D-2: from the header
  await openWiz(); g = await wizGeo();
  await drag(Math.round(g.header.l + 120), Math.round(g.header.t + g.header.h / 2), line(Math.round(g.header.l + 120), Math.round(g.header.t + g.header.h / 2), Math.round(g.header.l + 120), Math.round(g.header.t + 450), 10));
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`, 3000);
  assert(!(await wizOpen()), 'D-2: a drag down from the HEADER closes the sheet too (on the web app, which had no swipe-down at all before)');

  // D-3: the body scrolled down scrolls instead
  await openWiz(); g = await wizGeo();
  await evaluate(`document.getElementById('week-wizard-body').scrollTop = 300`); await sleep(100);
  const st0 = (await wizGeo()).scrollTop;
  hold = null;
  {
    const m = midBody();
    await drag(m.x, m.y, line(m.x, m.y, m.x, m.y + 160, 8), { holdAt: 7, onHold: async () => {
      hold = await evaluate(`(() => { const w = document.getElementById('week-wizard-sheet-wrap'), s = document.getElementById('week-wizard-sheet'); return { y: Number(w.style.getPropertyValue('--wizard-drag-y') || 0), dragging: s.getAttribute('data-dragging'), st: document.getElementById('week-wizard-body').scrollTop }; })()`);
    } });
  }
  await sleep(300);
  assert(st0 >= 250 && hold && hold.y === 0 && hold.dragging === null && hold.st < st0 - 50 && (await wizOpen()), `D-3: a body scrolled down (${st0}) SCROLLS on a downward drag (${hold?.st}) and the sheet does not move or dismiss (drag ${hold?.y}, dragging ${hold?.dragging})`);

  // D-4: an upward-first drag at scroll-top is a scroll
  await evaluate(`document.getElementById('week-wizard-body').scrollTop = 0`); await sleep(100);
  hold = null;
  {
    const m = midBody();
    await drag(m.x, m.y + 200, line(m.x, m.y + 200, m.x, m.y - 20, 8).concat(line(m.x, m.y - 20, m.x, m.y + 300, 4)), { holdAt: 6, onHold: async () => {
      hold = await evaluate(`(() => { const s = document.getElementById('week-wizard-sheet'); return { dragging: s.getAttribute('data-dragging'), st: document.getElementById('week-wizard-body').scrollTop }; })()`);
    } });
  }
  await sleep(300);
  assert(hold && hold.dragging === null && (await wizOpen()), `D-4: a drag whose first movement goes UP is a scroll (scrollTop ${hold?.st}): never claimed, and coming back down does not dismiss`);

  // D-5: the side panel (>= 700 px) has no swipe-down
  await closeWizHard();
  await viewport(800, 900);
  await openWiz(); g = await wizGeo();
  assert(g.sheet.w < 500 && g.sheet.l > 300, `D-5a: (fixture) at 800 px wide the shell is the right-hand side panel (${Math.round(g.sheet.w)} px wide at x ${Math.round(g.sheet.l)})`);
  await drag(Math.round(g.header.l + 100), Math.round(g.header.t + 20), line(Math.round(g.header.l + 100), Math.round(g.header.t + 20), Math.round(g.header.l + 100), Math.round(g.header.t + 600), 10));
  await sleep(500);
  assert(await wizOpen(), 'D-5b: a swipe down on the SIDE PANEL does not dismiss it (the swipe-down is a bottom-sheet gesture; the ✕ and the backdrop remain)');
  await closeWizHard();
  await viewport(390, 844);

  // D-6: unsaved edits - every close path asks
  await openWiz(); await goStep(4);
  g = await wizGeo();
  await evaluate(`(() => { const f = document.getElementById('wiz-auto-lock-offset'); f.focus(); f.value = '45'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const hdrX = Math.round(g.header.l + 140), hdrY = Math.round(g.header.t + g.header.h / 2);
  await drag(hdrX, hdrY, line(hdrX, hdrY, hdrX, hdrY + 450, 10));
  await sleep(700);
  let L = await layerInfo(); g = await wizGeo();
  const dragY = await evaluate(`document.getElementById('week-wizard-sheet-wrap')?.style.getPropertyValue('--wizard-drag-y')`);
  assert(L && L.title === 'Discard changes?' && (await wizOpen()) && Number(dragY) === 0, `D-6a: a dismissing swipe with an unsaved edit SPRINGS BACK (drag ${dragY}) and raises "${L?.title}" - nothing slid away and then came back`);
  assert(L && L.msg === "You have changes on this step that haven't been saved." && L.danger === 'Discard Changes' && L.bold === 'Keep Editing', `D-6b: with the DI’s copy (message "${L?.msg}", destructive "${L?.danger}", bold "${L?.bold}")`);
  assert(L && L.topAtKeep === true && Number(L.z) > 8000, `D-6c: P-8 - the question is ABOVE the wizard sheet: a hit-test at its Keep Editing button lands on the button (z-index ${L?.z} over the sheet’s 8000)`);
  await tap(L.keepAt.x, L.keepAt.y);
  L = await layerInfo();
  const act = await evaluate(`({ id: document.activeElement?.id, v: document.getElementById('wiz-auto-lock-offset')?.value })`);
  assert(!L && (await wizOpen()) && act.id === 'wiz-auto-lock-offset' && act.v === '45', `D-6d: a real tap on Keep Editing closes the question, keeps the sheet and the typed value, and puts focus back in the field (focus on #${act.id}, value ${act.v})`);
  // the ✕, tapped for real
  const xBtn = await evaluate(`(() => { const b = document.getElementById('week-wizard-close').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  await tap(xBtn.x, xBtn.y); await sleep(200);
  L = await layerInfo();
  assert(L && L.title === 'Discard changes?' && (await wizOpen()), 'D-6e: the ✕, tapped, asks too');
  await tap(L.keepAt.x, L.keepAt.y);
  // the backdrop
  g = await wizGeo();
  await tap(Math.round(g.vw / 2), Math.max(8, Math.round(g.sheet.t / 2)));
  await sleep(200);
  L = await layerInfo();
  assert(L && L.title === 'Discard changes?' && (await wizOpen()), 'D-6f: a tap on the dimmed backdrop above the sheet asks too');
  await tap(L.discardAt.x, L.discardAt.y); await sleep(300);
  assert(!(await wizOpen()) && !(await layerInfo()), 'D-6g: a real tap on Discard Changes closes the sheet');
  // a checkbox counts; the same step untouched does not
  await openWiz(); await goStep(4);
  await evaluate(`document.getElementById('week-wizard-close').click()`); await sleep(250);
  assert(!(await wizOpen()) && !(await layerInfo()), 'D-6h: the same Step 4 with nothing changed closes at once - the baseline is the freshly painted state, not "empty"');
  await openWiz(); await goStep(4);
  await evaluate(`document.getElementById('wiz-auto-live-enabled').click()`);
  await evaluate(`document.getElementById('week-wizard-close').click()`); await sleep(250);
  L = await layerInfo();
  assert(L && L.title === 'Discard changes?', 'D-6i: a toggled checkbox is an unsaved edit');
  await closeWizHard();

  // ======================================================================================================================================================================================
  console.log('\n[E] Wizard - swipe left/right between steps (the footer buttons, by swipe)…');
  // ======================================================================================================================================================================================
  await openWiz();
  const pagerSwipe = async (dx, { y = null, x0 = null, noWait = false } = {}) => {
    g = await wizGeo();
    // Ordinary step body: the step's own section title (a field would keep its touch - that is E-3a's case, not this one).
    const titleY = await evaluate(`(() => { const t = document.querySelector('#week-wizard-body .admin-section-title'); if (!t) return null; const b = t.getBoundingClientRect(); return Math.round(b.top + b.height / 2); })()`);
    const yy = y ?? titleY ?? Math.round(g.body.t + Math.min(g.body.h / 2, 120)), xx = x0 ?? (dx < 0 ? 330 : 80);
    await drag(xx, yy, line(xx, yy, xx + dx, yy, 8));
    if (!noWait) { await sleep(120); await settleIdle('week-wizard-pager'); }
  };
  assert((await stepNow()) === 3, 'E-0: (fixture) Step 3');
  // E-1: left from Step 3 - with the incoming layer and the exit layer sampled
  g = await wizGeo();
  let mid = null, exitSeenW = null;
  await evaluate(`window.__exitW = null; new MutationObserver((recs, ob) => { const el = document.querySelector('.week-swipe-exit-layer'); if (el && !window.__exitW) { const p = document.getElementById('week-wizard-pager').getBoundingClientRect(), r = el.getBoundingClientRect(), cr = document.querySelector('.wiz-pager-clip').getBoundingClientRect();
    window.__exitW = { pos: getComputedStyle(el).position, parentCls: el.parentElement.className, top: r.top, left: r.left, pTop: p.top, pLeft: p.left, clipTop: cr.top, clipLeft: cr.left, w: r.width, pw: p.width, h: r.height, ph: p.height }; ob.disconnect(); } }).observe(document.getElementById('week-wizard-sheet'), { childList: true, subtree: true }); true`);
  {
    const yy = Math.round(g.body.t + 120);
    await drag(330, yy, line(330, yy, 110, yy, 10), { holdAt: 9, onHold: async () => {
      mid = await evaluate(`(() => { const p = document.getElementById('week-wizard-pager'); const layer = p.querySelector('.week-swipe-incoming-layer'); const lr = layer && layer.getBoundingClientRect(), pr = p.getBoundingClientRect(), cr = document.querySelector('.wiz-pager-clip').getBoundingClientRect();
        return { has: !!layer, inert: layer?.hasAttribute('inert') === true, text: (layer?.textContent || '').replace(/\\s+/g, ' ').slice(0, 80), left: lr && Math.round(lr.left), right: lr && Math.round(lr.right), pRight: Math.round(pr.right), pLeft: Math.round(pr.left),
          clipRight: Math.round(cr.right), vis: lr ? Math.round(Math.min(lr.right, cr.right) - Math.max(lr.left, cr.left)) : 0, ids: layer ? layer.querySelectorAll('[id]').length : -1, tr: getComputedStyle(p).transform, lock: getComputedStyle(document.documentElement).overflowY, layerTop: lr && Math.round(lr.top), pTop: Math.round(pr.top) }; })()`);
    } });
  }
  await sleep(500); await settleIdle('week-wizard-pager');
  exitSeenW = await evaluate('window.__exitW');
  assert(mid && mid.has && mid.inert && /Timing/.test(mid.text), `E-1a: mid-drag from Step 3 the NEXT step (Step 4, "Timing & auto-transitions") is on screen in an inert layer beside the outgoing one: "${mid?.text}"`);
  assert(mid && mid.left >= mid.pRight - 2 && mid.vis > 20 && mid.layerTop === mid.pTop, `E-1b: …flush against the pane’s right edge, partly inside the clip (${mid?.vis} px visible), level with the pane (layer top ${mid?.layerTop}, pane top ${mid?.pTop}) - inside the TRANSFORMED sheet`);
  assert(mid && /^matrix\(1, 0, 0, 1, -/.test(mid.tr) && mid.ids === 0, `E-1c: …while the pane follows the finger (computed "${mid?.tr}") and the copy carries no ids`);
  assert((await stepNow()) === 4, 'E-1d: released, Step 3 → Step 4');
  assert(exitSeenW && exitSeenW.pos === 'absolute' && /wiz-pager-clip/.test(exitSeenW.parentCls), `E-1e: on release the outgoing step’s layer is ABSOLUTE inside the clip (position "${exitSeenW?.pos}", parent "${exitSeenW?.parentCls}") - not viewport-fixed inside a transformed sheet`);
  assert(exitSeenW && Math.abs(exitSeenW.top - exitSeenW.clipTop) <= 1 && Math.abs(exitSeenW.w - exitSeenW.pw) <= 1 && Math.abs(exitSeenW.left - (exitSeenW.clipLeft - 220)) <= 3,
    `E-1f: real-engine alignment - the outgoing layer starts exactly under the finger inside the transformed sheet: top ${exitSeenW?.top?.toFixed?.(1)} = the clip's ${exitSeenW?.clipTop?.toFixed?.(1)}, left ${exitSeenW?.left?.toFixed?.(1)} = the clip's ${exitSeenW?.clipLeft?.toFixed?.(1)} less the 220 px the finger had carried it, width ${Math.round(exitSeenW?.w)} = ${Math.round(exitSeenW?.pw)}`);
  assert((await evaluate(`getComputedStyle(document.documentElement).overflowY`)) === 'hidden', 'E-1g: (the sheet keeps the page behind it locked, as before)');
  await pagerSwipe(-220);
  assert((await stepNow()) === 5, `E-2a: Step 4 → 5 (no blurb yet) by swipe (got ${await stepNow()})`);
  // refused: empty blurb
  let animSeen = null;
  await evaluate(`window.__anim = []; new MutationObserver(() => { const p = document.getElementById('week-wizard-pager'); const k = p?.dataset.weekSwipeAnimating; if (k) window.__anim.push(k); window.__ex = window.__ex || !!document.querySelector('.week-swipe-exit-layer'); }).observe(document.getElementById('week-wizard-pager'), { attributes: true, subtree: false }); window.__ex = false; true`);
  await pagerSwipe(-220, { noWait: true });
  await sleep(200);
  animSeen = await evaluate(`({ kinds: [...new Set(window.__anim)], ex: window.__ex, err: (document.getElementById('wiz-blurb-error')?.textContent || '').trim(), vis: getComputedStyle(document.getElementById('wiz-blurb-error')).opacity, step: null })`);
  await settleIdle('week-wizard-pager');
  assert((await stepNow()) === 5 && animSeen.err.length > 0, `E-2b: Step 5 with an EMPTY blurb - the swipe does not advance, and the Next button’s OWN inline message appears ("${animSeen.err}")`);
  assert(animSeen.ex === false && !animSeen.kinds.includes('commit'), `E-2c: …and NO slide ever played (animation kinds seen: ${JSON.stringify(animSeen.kinds)}; an exit layer appeared: ${animSeen.ex}) - a refused step change springs back`);
  // P-3: a new swipe lands during the spring-back
  await evaluate(`(() => { const t = document.getElementById('wiz-blurb-body'); t.value = 'A fine blurb for the week.'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await pagerSwipe(-220, { noWait: true });
  await sleep(60);
  await evaluate(`(() => { const t = document.getElementById('wiz-blurb-body'); return true; })()`);
  await settleIdle('week-wizard-pager');
  assert((await stepNow()) === 6, `E-2d: with a valid blurb the swipe goes to Step 6 (got ${await stepNow()})`);
  await pagerSwipe(-220);
  assert((await stepNow()) === 6, 'E-2e: Step 6 - a swipe LEFT never advances (Open now / Schedule Open / Keep as draft are buttons)');
  const openBtnBefore = await evaluate(`({ week: JSON.stringify((() => { return document.querySelector('#wiz-open-btn') ? 'present' : 'absent'; })()) })`);
  await pagerSwipe(220);
  assert((await stepNow()) === 5, `E-2f: Step 6 → Step 5 by swipe RIGHT (got ${await stepNow()})`);
  // a field keeps its touch
  g = await wizGeo();
  const ta = await evaluate(`(() => { const b = document.getElementById('wiz-blurb-body').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  await drag(ta.x + 100, ta.y, line(ta.x + 100, ta.y, ta.x - 150, ta.y, 8));
  await sleep(300); await settleIdle('week-wizard-pager');
  assert((await stepNow()) === 5, 'E-3a: a swipe that STARTS on the blurb field pages nothing (the field keeps its touch)');
  // Back with edits asks first
  await evaluate(`(() => { const t = document.getElementById('wiz-blurb-body'); t.value = 'A different blurb, edited.'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await pagerSwipe(220);
  L = await layerInfo();
  assert((await stepNow()) === 5 && L && L.title === 'Discard changes?', `E-3b: a Back swipe on a step with an unsaved edit springs back and raises the SAME "Discard changes?" (Step ${await stepNow()}, "${L?.title}")`);
  await tap(L.keepAt.x, L.keepAt.y); await sleep(200);
  assert((await stepNow()) === 5 && !(await layerInfo()), 'E-3c: Keep Editing: still Step 5');
  await pagerSwipe(220); L = await layerInfo();
  await tap(L.discardAt.x, L.discardAt.y); await sleep(500); await settleIdle('week-wizard-pager');
  assert((await stepNow()) === 4, `E-3d: Discard Changes then steps back (Step ${await stepNow()}) - the Back button’s own path`);
  // Step 1 and Step 2
  await goStep(2);
  await pagerSwipe(220);
  assert((await stepNow()) === 1, 'E-4a: Step 2 → Step 1 by swipe RIGHT');
  await pagerSwipe(-220);
  assert((await stepNow()) === 1, 'E-4b: Step 1 - a swipe LEFT does not advance (Create Week writes the week; only the button does it)');
  await pagerSwipe(220);
  assert((await stepNow()) === 1, 'E-4c: …and there is nothing before Step 1');
  // Reduce Motion
  await goStep(3);
  await reducedMotion(true);
  await evaluate(`window.__fade = new Set(); new MutationObserver(() => { const k = document.getElementById('week-wizard-pager')?.dataset.weekSwipeAnimating; if (k) window.__fade.add(k); }).observe(document.getElementById('week-wizard-pager'), { attributes: true }); true`);
  await pagerSwipe(-220, { noWait: true });
  await sleep(300); await settleIdle('week-wizard-pager');
  const rmKinds = await evaluate('[...window.__fade]');
  assert((await stepNow()) === 4 && rmKinds.includes('fade') && !rmKinds.includes('commit'), `E-5: Reduce Motion - the step change CROSS-FADES (kinds ${JSON.stringify(rmKinds)}), it does not slide`);
  await reducedMotion(false);
  // the other surface rule
  await evaluate(`(() => { const d = document.createElement('div'); d.id = 'swap-picker-sheet-wrap'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none'; document.body.appendChild(d); return true; })()`);
  await pagerSwipe(220);
  assert((await stepNow()) === 4, 'E-6: with the swap picker sheet up the step pager does not arm (it is another surface on top)');
  await evaluate(`document.getElementById('swap-picker-sheet-wrap').remove()`);

  // ======================================================================================================================================================================================
  console.log('\n[F2] Styling (P-8) - the wizard’s pane and clip, computed in the engine…');
  // ======================================================================================================================================================================================
  const wcss = await evaluate(`(() => { const clip = getComputedStyle(document.querySelector('.wiz-pager-clip')), p = getComputedStyle(document.getElementById('week-wizard-pager')), b = getComputedStyle(document.getElementById('week-wizard-body'));
    return { clipOv: clip.overflow, clipPos: clip.position, clipFlex: clip.flexGrow, pTa: p.touchAction, pTr: p.transform, pDisp: p.display, bOy: b.overflowY, bOb: b.overscrollBehaviorY }; })()`);
  assert(wcss.clipOv === 'hidden' && wcss.clipPos === 'relative' && wcss.clipFlex === '1', `F2-1: the clip is a stationary, relatively positioned, overflow-hidden box that grows to fill the sheet (${wcss.clipOv} / ${wcss.clipPos} / flex-grow ${wcss.clipFlex})`);
  assert(/pan-y/.test(wcss.pTa) && /^matrix|^none$/.test(wcss.pTr) && wcss.pDisp === 'flex', `F2-2: the pane takes touch-action pan-y pinch-zoom and a transform (it slides) and lays the body out as before (touch-action "${wcss.pTa}", transform "${wcss.pTr}")`);
  assert(wcss.bOy === 'auto' && wcss.bOb === 'contain', `F2-3: at rest the body is the scroller it always was (overflow-y "${wcss.bOy}", overscroll-behavior-y "${wcss.bOb}") - the drag-time lock is gone with the drag`);
  await closeWizHard();


  // ======================================================================================================================================================================================
  console.log('\n[H] W-71 - Find spreads: the new surface in a real engine (P-8) - geometry, motion, press feedback, and the three taps through real touches…');
  // ======================================================================================================================================================================================
  // The app's lookup is answered by the suite (the `_setOddsLookupForTest` seam of js/odds-lookup-client.js - the SAME module instance the app imported), and ESPN by a page-level fetch that answers
  // the scoreboard with one unrelated event (so the re-read succeeds and finds no line for the slate): the real wizard, the real button, the real cards, the real stylesheet.
  await closeWizHard();
  await evaluate(`(() => {
    window.__realFetch = window.__realFetch || window.fetch.bind(window);
    window.fetch = (u, ...a) => {
      if (/espn\.com|espncdn/.test(String(u))) {
        const d = new Date(Date.now() + 3 * 86400000); d.setUTCHours(20, 34, 17, 0);
        const iso = d.toISOString();
        const c = (id, side, loc, ab, nm) => ({ id, homeAway: side, score: '0', team: { id, location: loc, name: nm, abbreviation: ab, displayName: loc + ' ' + nm, shortDisplayName: loc } });
        const ev = { id: '4019999999', date: iso, name: 'Zed at Yale', shortName: 'ZED @ YAL', status: { type: { name: 'STATUS_SCHEDULED', detail: '3:00 PM ET', completed: false } },
          competitions: [{ id: '4019999999', date: iso, competitors: [c('1h', 'home', 'Yale', 'YAL', 'Bulldogs'), c('1a', 'away', 'Zed', 'ZED', 'Zebras')], venue: { fullName: 'S', address: { city: 'C', state: 'CA' } } }] };
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ events: [ev] }) });
      }
      return window.__realFetch(u, ...a);
    };
    return true; })()`);
  await evaluate(`(async () => {
    const c = await import('./js/odds-lookup-client.js'); const st = await import('./js/storage.js');
    window.__lookups = 0;
    c._setOddsLookupForTest(async (weekId) => { window.__lookups++; const games = st.getGames(weekId).filter(g => typeof g.spread !== 'number'); 
      return { ok: true, unmatched: 0, results: games.slice(0, 3).map((g, i) => ({ gameId: g.gameId, provider: ['FanDuel', 'DraftKings', 'BetMGM'][i], favorite: i === 2 ? null : (i === 0 ? g.homeTeam : g.awayTeam), margin: i === 2 ? 0 : 3.5 + i, pk: i === 2, asOf: new Date().toISOString() })) }; });
    return true; })()`);
  await viewport(375, 812);
  await openWiz(); await goStep(3);
  const WK_H = await evaluate(`document.querySelector('#week-wizard-body [data-spread-host]').getAttribute('data-week-id')`);
  const sfGeo = () => evaluate(`(() => { const q = (s) => document.querySelector(s); const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const host = q('#week-wizard-body [data-spread-host]'), find = q('#week-wizard-body [data-spread-action="find"]'), blk = q('#week-wizard-body .spread-find');
    const cs = (e, p) => e ? getComputedStyle(e)[p] : null;
    return { host: !!host, findText: find?.textContent.trim(), find: r(find), findMinH: cs(find, 'minHeight'), blk: cs(blk, 'display') + '|' + cs(blk, 'flexDirection') + '|' + cs(blk, 'rowGap') + '|' + cs(blk, 'marginBottom'),
      row: cs(q('#week-wizard-body .spread-find-row'), 'justifyContent'), banner: r(q('#week-wizard-body .warning-box')), vw: innerWidth }; })()`);
  let sf = await sfGeo();
  assert(sf.host && sf.findText === 'Find spreads' && Number(sf.findMinH.replace('px', '')) >= 44 && sf.find.h >= 43.5, `H-1: Step 3 shows "Find spreads" under the count line - a 44 pt target (min-height ${sf.findMinH}, height ${sf.find?.h?.toFixed?.(1)})`);
  assert(sf.blk === 'flex|column|8px|16px' && sf.row === 'center', `H-2: P-8 - the block is a column with an 8 pt gap and 16 pt below, its button centred in its row (computed "${sf.blk}", justify "${sf.row}")`);
  assert(sf.banner && sf.find.t - sf.banner.b >= 8 && sf.find.l >= 8 && sf.find.r <= sf.vw - 8, `H-3: the button never touches the count line above it (${(sf.find.t - sf.banner.b).toFixed(1)} pt gap) or the screen edges at 375 pt`);

  // tap it for real
  const tapCenter = async (sel) => { const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`); if (!p) return false; await sleep(80); const q2 = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`); await tap(q2.x, q2.y); return true; };
  let busyText = null;
  await evaluate(`window.__busy = []; new MutationObserver(() => { const b = document.querySelector('#week-wizard-body [data-spread-action="find"]'); if (b) window.__busy.push([b.textContent.trim(), b.disabled, b.getAttribute('aria-busy')]); }).observe(document.getElementById('week-wizard-body'), { childList: true, subtree: true, attributes: true, characterData: true }); true`);
  assert(await tapCenter('#week-wizard-body [data-spread-action="find"]'), 'H-4: (fixture) Find spreads tapped with a real touch');
  await waitFor(`document.querySelectorAll('#week-wizard-body [data-spread-card]').length === 3`, 6000);
  busyText = await evaluate('window.__busy');
  assert(busyText.some(([t, d, a]) => /Checking/.test(t) && d === true && a === 'true'), `H-5: while the check runs the button is disabled, aria-busy and reads "Checking…" (saw ${JSON.stringify([...new Set(busyText.map((x) => x[0]))])})`);
  const lookups = await evaluate('window.__lookups');
  assert(lookups === 1, `H-6: one lookup (${lookups})`);
  const cardInfo = () => evaluate(`(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const card = document.querySelector('#week-wizard-body .spread-card'); const ref = document.createElement('div'); ref.className = 'info-box'; document.body.appendChild(ref);
    const cs = getComputedStyle(card), rs = getComputedStyle(ref);
    const btns = [...card.querySelectorAll('.spread-card-btn')].map(r); const acts = card.querySelector('.spread-card-actions');
    const out = { n: document.querySelectorAll('#week-wizard-body .spread-card').length, disp: cs.display, dir: cs.flexDirection, gap: cs.rowGap, pad: cs.paddingTop + '/' + cs.paddingLeft, bg: cs.backgroundColor, refBg: rs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, rad: cs.borderTopLeftRadius, refRad: rs.borderTopLeftRadius,
      card: r(card), btns, actsJ: getComputedStyle(acts).justifyContent, actsGap: getComputedStyle(acts).columnGap + '|' + getComputedStyle(acts).rowGap, ov: card.scrollWidth <= card.clientWidth + 1, vw: innerWidth, trans: cs.transitionProperty + ' ' + cs.transitionDuration,
      text: card.textContent.replace(/\\s+/g, ' ').trim(), btnH: btns.map(b => Math.round(b.h)) }; ref.remove(); return out; })()`);
  let ci = await cardInfo();
  assert(ci.n === 3 && ci.disp === 'flex' && ci.dir === 'column' && ci.gap === '8px' && ci.pad === '16px/16px', `H-7: P-8 - three cards, each a column with an 8 pt gap and 16 pt padding (computed "${ci.disp} ${ci.dir} gap ${ci.gap} pad ${ci.pad}")`);
  assert(ci.bg === ci.refBg && ci.rad === ci.refRad && ci.border.startsWith('1px solid'), `H-8: …wearing the existing .info-box look exactly - same fill (${ci.bg}), radius (${ci.rad}) and 1 px border - no new colour`);
  assert(ci.btns.length === 2 && ci.btnH.every((h) => h >= 44) && ci.actsJ === 'center', `H-9: …with two 44 pt buttons (heights ${JSON.stringify(ci.btnH)}) in a centred group`);
  const [b1, b2] = ci.btns;
  const gapX = b2.l - b1.r, gapY = b2.t - b1.b;
  assert((gapX >= 8 && Math.abs(b1.t - b2.t) < 2) || gapY >= 8, `H-10: the two buttons never touch: side by side with ${gapX.toFixed(1)} pt between, or stacked with ${gapY.toFixed(1)} pt (>= 8 either way)`);
  assert(b1.l - ci.card.l >= 15.5 && ci.card.r - Math.max(b1.r, b2.r) >= 15.5 && ci.card.l >= 8 && ci.card.r <= ci.vw - 8 && ci.ov, `H-11: …and 16 pt from the card's edges, the card inside the screen, nothing overflowing, at 375 pt (button left inset ${(b1.l - ci.card.l).toFixed(1)}, card ${ci.card.l.toFixed(0)}..${ci.card.r.toFixed(0)} of ${ci.vw})`);
  assert(/FanDuel has .* -3\.5/.test(ci.text) && /Not an ESPN line/.test(ci.text) && /updated/.test(ci.text) && /Include this spread\?/.test(ci.text), `H-12: the first card reads as the DI's: "${ci.text}"`);
  assert(/opacity 0\.2s/.test(ci.trans) || /0\.2s/.test(ci.trans), `H-13: a card's transition is 200 ms (computed "${ci.trans}")`);
  // largest text: nothing may overflow or collide when the root font grows
  await evaluate(`document.documentElement.style.fontSize = '26px'; true`); await sleep(150);
  const big = await cardInfo();
  const [c1, c2] = big.btns;
  assert(big.ov && big.card.r <= big.vw - 8 && (c2.l - c1.r >= 8 || c2.t - c1.b >= 8) && big.btnH.every((h) => h >= 44), `H-14: at the largest text (root 26 px) the card still fits (no overflow), the buttons still keep >= 8 pt apart and 44 pt tall (side-by-side gap ${(c2.l - c1.r).toFixed(1)}, stacked gap ${(c2.t - c1.b).toFixed(1)})`);
  await evaluate(`document.documentElement.style.fontSize = ''; true`);

  // press feedback: the shared 97% over --motion-fast, held with a real mouse press
  const incl = await evaluate(`(() => { const b = document.querySelector('#week-wizard-body [data-spread-action="include"]'); b.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await sleep(80);
  const incl2 = await evaluate(`(() => { const r = document.querySelector('#week-wizard-body [data-spread-action="include"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: incl2.x, y: incl2.y, button: 'left', clickCount: 1 });
  await sleep(300);
  const pressed = await evaluate(`getComputedStyle(document.querySelector('#week-wizard-body [data-spread-action="include"]')).transform`);
  await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 });
  await sleep(200);
  assert(/^matrix\(0\.97/.test(pressed), `H-15: pressed, a card button compresses to 97% (computed "${pressed}"); released off the button it returns and nothing was included`);
  void incl;
  const untouched = await evaluate(`(async () => { const st = await import('./js/storage.js'); return st.getGames('${WK_H}').filter(g => typeof g.spread === 'number').length; })()`);
  assert(untouched === 0, `H-16: INVARIANT 1, in the engine - the cards are up and not one game has a spread (${untouched})`);

  // No thanks, for real: the card collapses over 200 ms and nothing is written
  const gid1 = await evaluate(`document.querySelector('#week-wizard-body .spread-card [data-spread-action="decline"]').getAttribute('data-game-id')`);
  // sampled on every animation frame (a class that is there for 200 ms is seen by a frame loop, whatever the observer's timing)
  await evaluate(`window.__leave = null; window.__rm = matchMedia('(prefers-reduced-motion: reduce)').matches; (function loop(n) { const c = document.querySelector('#week-wizard-body .spread-card.is-leaving'); if (c && !window.__leave) { const cs = getComputedStyle(c); window.__leave = { dur: cs.transitionDuration, op: cs.opacity, mh: cs.maxHeight }; } if (n < 90) requestAnimationFrame(() => loop(n + 1)); })(0); true`);
  assert(await tapCenter('#week-wizard-body .spread-card [data-spread-action="decline"]'), 'H-17: (fixture) No thanks tapped with a real touch');
  await waitFor(`document.querySelectorAll('#week-wizard-body .spread-card').length === 2`, 3000);
  const lv = await evaluate('window.__leave');
  assert(lv && /0\.2s/.test(lv.dur), `H-18: the card collapsed through an is-leaving state with a 200 ms transition (${JSON.stringify(lv)}) and then went`);
  const after1 = await evaluate(`(async () => { const st = await import('./js/storage.js'); return st.getGames('${WK_H}').filter(g => typeof g.spread === 'number').length; })()`);
  assert(after1 === 0 && !(await evaluate(`!!document.querySelector('#week-wizard-body [data-spread-card="${gid1}"]')`)), `H-19: No thanks wrote nothing (${after1} spreads) and the card is gone`);

  // Include, for real
  const incGid = await evaluate(`document.querySelector('#week-wizard-body .spread-card [data-spread-action="include"]').getAttribute('data-game-id')`);
  assert(await tapCenter('#week-wizard-body .spread-card [data-spread-action="include"]'), 'H-20: (fixture) Include tapped with a real touch');
  await waitFor(`!document.querySelector('#week-wizard-body [data-spread-card="${incGid}"]')`, 3000);
  await sleep(250);
  const inc = await evaluate(`(async () => { const st = await import('./js/storage.js'); const g = st.getGames('${WK_H}').find(x => x.gameId === ${JSON.stringify(incGid)});
    if (!g) return { missing: true, ids: st.getGames('${WK_H}').map(x => x.gameId).slice(0, 4), weeks: st.getWeeks().map(w => w.weekId + ':' + w.status) };
    return { spread: g.spread, fav: g.favorite, src: g.spreadSource, prov: g.oddsProvider, locked: g.lockedSpread, home: g.homeTeam, away: g.awayTeam, toast: [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent.trim()), banner: document.querySelector('#week-wizard-body .warning-box')?.textContent.trim() }; })()`);
  if (inc.missing) console.log('  (debug)', JSON.stringify(inc), incGid);
  assert(typeof inc.spread === 'number' && inc.src === 'odds_api' && ['FanDuel', 'DraftKings', 'BetMGM'].includes(inc.prov) && inc.locked === -2.5 && (inc.fav === inc.home ? inc.spread < 0 : (inc.fav === inc.away ? inc.spread > 0 : inc.spread === 0)),
    `H-21: Include wrote the line SIGNED HOME-PERSPECTIVE (favorite ${inc.fav} of ${inc.home} v ${inc.away}: spread ${inc.spread}), source odds_api, book ${inc.prov}; the game's existing lockedSpread (-2.5, seeded) is exactly as it was`);
  assert(inc.toast.some((t) => /^Spread added: .* \((FanDuel|DraftKings|BetMGM)\)\.$/.test(t)), `H-22: toast "Spread added: …" (${JSON.stringify(inc.toast)})`);
  assert(/15 games still need a spread|15 games/.test(inc.banner || ''), `H-23: the count line dropped by one (${inc.banner})`);

  // Reduce Motion: no collapse transition, no press transform
  await reducedMotion(true);
  const rm = await evaluate(`(() => { const c = document.querySelector('#week-wizard-body .spread-card'); const b = document.querySelector('#week-wizard-body .spread-card-btn'); return { card: c ? getComputedStyle(c).transitionDuration : null, btn: b ? getComputedStyle(b).transitionDuration : null }; })()`);
  assert(rm.card === '0s' && rm.btn === '0s', `H-24: Reduce Motion drops the card collapse and the press transition (card ${rm.card}, button ${rm.btn})`);
  await reducedMotion(false);

  // the Games tab entry point
  await closeWizHard();
  await gotoComm('games');
  const gt = await evaluate(`(() => { const s = document.querySelector('#games-section #games-spreads'); if (!s) return null;
    const f = s.querySelector('[data-spread-action="find"]'); const b = f.getBoundingClientRect(); const cs = getComputedStyle(f); return { text: s.querySelector('p')?.textContent.trim(), h: b.height, w: b.width, vis: cs.display !== 'none', cards: s.querySelectorAll('.spread-card').length,
      inGames: !!s.closest('#games-section'), standalone: [...document.querySelectorAll('#page-commissioner .admin-section[data-comm-tab="games"]')].some(x => x.querySelector('.admin-section-title')?.textContent.trim() === 'Spreads') }; })()`);
  assert(gt && /games? still needs? a spread\./.test(gt.text) && gt.h >= 43.5 && gt.vis && gt.inGames && !gt.standalone,
    `H-25: DI-W71.2 - the Games list's summary area (inside #games-section) holds the count and a 44 pt Find spreads, and there is no separate Spreads card (${JSON.stringify(gt)})`);
  // The summary entry's geometry (Breathing Room): the count line 8 pt above the block's button, 16 pt between the block and the segmented control below - not doubled
  const sumGeo = await evaluate(`(() => { const sec = document.querySelector('#games-section'); const p = sec.querySelector('#games-spreads [data-bind="spread-count"]'); const blk = sec.querySelector('#games-spreads .spread-find'); const segs = sec.querySelector('#games-segs'); const sum = sec.querySelector('#games-summary');
    const r = (e) => e.getBoundingClientRect(); return { pGap: Math.round((r(blk).top - r(p).bottom) * 10) / 10, below: Math.round((r(segs).top - r(blk).bottom) * 10) / 10, mb: getComputedStyle(blk).marginBottom, above: Math.round((r(p).top - r(sum).bottom) * 10) / 10 }; })()`);
  assert(sumGeo.mb === '16px' && sumGeo.below === 16 && sumGeo.pGap === 8, `H-26: N-5 - in the Games list the block is 8 pt under its count line (${sumGeo.pGap}) and 16 pt above the segmented control (${sumGeo.below}; margin ${sumGeo.mb}) - one gap, not two stacked`);
  // DI-W71.2: a row's "Find spread" - 44 pt, first in the row's actions, and a real touch on it runs the same action
  await evaluate(`(async () => { const c = await import('./js/odds-lookup-client.js'); window.__lookups = 0; c._setOddsLookupForTest(async () => { window.__lookups++; return { ok: false, reason: 'vendor_error' }; }); return true; })()`);
  const rowGeo = await evaluate(`(() => { const row = [...document.querySelectorAll('#games-section .games-row')].find(r => r.querySelector('[data-action="row-find-spread"]')); if (!row) return null; const b = row.querySelector('[data-action="row-find-spread"]'); const acts = [...row.querySelectorAll('.games-row-actions > *')];
    const br = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { n: document.querySelectorAll('#games-section [data-action="row-find-spread"]').length, text: b.textContent.trim(), h: br.height, w: br.width, first: acts[0] === b, gap: acts[1] ? Math.round((acts[1].getBoundingClientRect().left - br.right) * 10) / 10 : null, aria: b.getAttribute('aria-label'), within: br.right <= row.getBoundingClientRect().right + 0.5 && br.left >= row.getBoundingClientRect().left - 0.5, minH: cs.minHeight }; })()`);
  assert(rowGeo && rowGeo.n >= 1 && rowGeo.text === 'Find spread' && rowGeo.h >= 43.5 && rowGeo.first && rowGeo.within && /^Find spread /.test(rowGeo.aria),
    `H-26b: DI-W71.2 - the row's "Find spread" is a 44 pt target (${rowGeo && rowGeo.h}), first in the actions, inside its row, and named for a screen reader (${JSON.stringify(rowGeo)})`);
  assert(rowGeo && (rowGeo.gap === null || rowGeo.gap >= 7.5), `H-26c: …and 8 pt from the button beside it (${rowGeo && rowGeo.gap})`);
  await viewport(320, 700);
  const narrow = await evaluate(`(() => { const rows = [...document.querySelectorAll('#games-section .games-row')].filter(r => r.querySelector('[data-action="row-find-spread"]')); const bad = rows.filter(r => { const rr = r.getBoundingClientRect(); return [...r.querySelectorAll('.games-row-actions > *')].some(b => { const x = b.getBoundingClientRect(); return x.right > rr.right + 0.5 || x.left < rr.left - 0.5 || x.height < 43.5; }); }).length;
    return { rows: rows.length, bad, overflowX: document.documentElement.scrollWidth - innerWidth, vw: innerWidth }; })()`);
  assert(narrow.rows >= 1 && narrow.bad === 0 && narrow.overflowX <= 0, `H-26c2: at the narrowest phone (${narrow.vw} px) every row action stays inside its row at 44 pt, wrapping rather than overflowing (rows ${narrow.rows}, bad ${narrow.bad}, page overflow ${narrow.overflowX})`);
  await viewport(375, 812);
  assert(await tapCenter('#games-section [data-action="row-find-spread"]'), 'H-26d: (fixture) a row\'s Find spread tapped with a real touch');
  await waitFor('window.__lookups === 1', 8000);
  await waitFor(`!document.querySelector('#games-section [data-action="row-find-spread"][aria-busy="true"]') && document.querySelector('#games-spreads .spread-find-note')`, 8000);
  const rowAfter = await evaluate(`(() => { const b = document.querySelector('#games-section [data-action="row-find-spread"]'); return { disabled: b.disabled, busy: b.hasAttribute('aria-busy'), text: b.textContent.trim(), note: document.querySelector('#games-spreads .spread-find-note')?.textContent.trim() }; })()`);
  assert((await evaluate('window.__lookups')) === 1 && rowAfter.disabled === false && rowAfter.busy === false && rowAfter.text === 'Find spread' && /Couldn't check other sources/.test(rowAfter.note || ''),
    `H-26e: the tap ran the week-wide action once and the button is back to "Find spread" (${JSON.stringify(rowAfter)})`);
  // N-3 (review 2026-10-14): the error note's Try again is a 44 pt target on its own line, 8 pt under the sentence, centred - and tapping it asks again
  await evaluate(`(async () => { const c = await import('./js/odds-lookup-client.js'); window.__lookups = 0; c._setOddsLookupForTest(async () => { window.__lookups++; return { ok: false, reason: 'vendor_error' }; }); return true; })()`);
  const GFIND = '#games-spreads [data-spread-action="find"]';
  assert(await tapCenter(GFIND), 'H-27: (fixture) Find spreads on the Games tab tapped with a real touch (the lookup now answers with a vendor error)');
  await waitFor(`document.querySelector('#games-spreads .spread-find-note button')`, 6000);
  const tryAgain = await evaluate(`(() => { const s = document.querySelector('#games-spreads'); const n = s.querySelector('.spread-find-note'); const b = n.querySelector('button'); const r = b.getBoundingClientRect(), nr = n.getBoundingClientRect(), cr = s.getBoundingClientRect(); const cs = getComputedStyle(b);
    const textBottom = (() => { const range = document.createRange(); range.setStart(n.firstChild, 0); range.setEnd(n.firstChild, n.firstChild.length); return range.getBoundingClientRect().bottom; })();
    return { text: n.firstChild.textContent.trim(), h: r.height, display: cs.display, mt: cs.marginTop, centerOff: Math.abs((r.left + r.right) / 2 - (cr.left + cr.right) / 2), gapUnderText: Math.round((r.top - textBottom) * 10) / 10, lookups: window.__lookups }; })()`);
  assert(tryAgain.text === "Couldn't check other sources. Try again." && tryAgain.h >= 43.5 && tryAgain.display === 'block' && tryAgain.mt === '8px' && tryAgain.centerOff <= 2 && tryAgain.gapUnderText >= 7.5 && tryAgain.lookups === 1,
    `H-28: N-3 - after an error "Try again" is a 44 pt target (${tryAgain.h}) on its own line (${tryAgain.display}), centred (off by ${tryAgain.centerOff}), 8 pt under the sentence (margin ${tryAgain.mt}; ${tryAgain.gapUnderText} px from the text) - and one lookup was made (${tryAgain.lookups})`);
  assert(await tapCenter('#games-spreads .spread-find-note button'), 'H-29: (fixture) Try again tapped with a real touch');
  await waitFor('window.__lookups === 2', 6000);
  assert((await evaluate('window.__lookups')) === 2, 'H-29b: tapping Try again asks the other source again (a second lookup)');
  await viewport(390, 844);

  // ======================================================================================================================================================================================
  console.log('\n[G] The iPhone app (native shell emulated: Capacitor bridge + a recording Haptics plugin) - the same gestures, the haptics once…');
  // ======================================================================================================================================================================================
  await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__h = []; window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { Haptics: {
    impact: (o) => window.__h.push('impact:' + (o && o.style)), selectionStart() {}, selectionChanged: () => window.__h.push('selection'), selectionEnd() {}, notification: (o) => window.__h.push('notif:' + (o && o.type)) } } };` });
  await navigate();
  await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`);
  await waitFor(`document.querySelector('#page-home.active') && !document.querySelector('#home-root .home-feed[aria-busy="true"]')`, 10000);
  assert(await evaluate(`document.body.classList.contains('native-shell') && !!window.Capacitor`), 'G-0: (fixture) the app booted as the native shell (body.native-shell, a Capacitor bridge with a recording Haptics plugin)');
  await gotoComm('week');
  const hlog = () => evaluate('window.__h.slice()');
  const hclear = () => evaluate('window.__h.length = 0; true');
  await hclear();
  const yN = await safeY();
  await drag(330, yN, line(330, yN, 90, yN));
  await waitFor(`document.getElementById('page-commissioner').getAttribute('data-comm-active') === 'games'`, 3000); await settleIdle('page-commissioner');
  let hl = await hlog();
  assert((await commState()).tab === 'games' && hl.length === 1 && hl[0] === 'impact:LIGHT', `G-1: a Comm tab SWIPE plays the engine's one light impact and nothing else (${JSON.stringify(hl)}) - no second haptic from the tab switch`);
  await hclear();
  await evaluate(`document.querySelector('#page-commissioner [data-comm-tab-btn="players"]').click()`); await sleep(300);
  hl = await hlog();
  assert((await commState()).tab === 'players' && hl.length === 1 && hl[0] === 'selection', `G-2: a tab TAP plays the selection haptic once and no light impact (${JSON.stringify(hl)}) - tab changes (Interaction Principles)`);
  await openWiz();
  assert(await evaluate(`!!document.querySelector('#week-wizard-sheet .sheet-grabber')`), 'G-3: (fixture) the native sheet shows its grabber');
  await hclear();
  g = await wizGeo();
  const bx = Math.round(g.sheet.l + g.sheet.w / 2), by = Math.round(g.body.t + 40);
  await drag(bx, by, line(bx, by, bx, by + 420, 10));
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`, 3000);
  assert(!(await wizOpen()), 'G-4: on the iPhone shell a drag down from the BODY at scroll-top closes the sheet');
  await openWiz(); g = await wizGeo();
  await drag(Math.round(g.header.l + 120), Math.round(g.header.t + 20), line(Math.round(g.header.l + 120), Math.round(g.header.t + 20), Math.round(g.header.l + 120), Math.round(g.header.t + 450), 10));
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`, 3000);
  assert(!(await wizOpen()), 'G-5: ...and from the grabber/header');
  await openWiz(); await goStep(3);
  await hclear();
  await pagerSwipe(-220);
  hl = await hlog();
  assert((await stepNow()) === 4 && hl.length === 1 && hl[0] === 'impact:LIGHT', `G-6: a step swipe plays the engine's one light impact (${JSON.stringify(hl)})`);
  await evaluate(`(() => { const f = document.getElementById('wiz-auto-lock-offset'); f.value = '45'; return true; })()`);
  await hclear();
  g = await wizGeo();
  await drag(Math.round(g.header.l + 120), Math.round(g.header.t + 20), line(Math.round(g.header.l + 120), Math.round(g.header.t + 20), Math.round(g.header.l + 120), Math.round(g.header.t + 450), 10));
  await sleep(600);
  L = await layerInfo(); hl = await hlog();
  assert(L && L.title === 'Discard changes?' && hl.includes('notif:WARNING'), `G-7: the discard question plays its confirmation (warning) haptic (${JSON.stringify(hl)})`);
  await closeWizHard();

} catch (e) {
  fail++;
  console.error('  ❌ the suite threw:', e && e.stack || e);
} finally {
  try { engine?.proc?.kill(); } catch { /* gone */ }
  server.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
