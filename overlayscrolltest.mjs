/**
 * CFB Pickems — overlayscrolltest.mjs
 * ===================================
 * SB-16 OVERLAY SCROLL-THROUGH (Social Platform thread, bugfixer, 2026-10-01).
 * SB-05 locked the page behind the control-center drawer
 * (`html:has(#control-center[data-open="true"]) {overflow:hidden}` + the M1
 * `overscroll-behavior:none` pair on html and body). Four more surfaces sit on
 * top of the page the same way and had NO such lock, so a vertical swipe on
 * them moved the page underneath:
 *   - `.modal-overlay`        every showXModal() / sheet (Account, Notification
 *                             Settings, the game modal, Edit Player, wagers…)
 *   - `#chat-sheet-wrap`      the per-game chat bottom sheet (js/chat-ui.js)
 *   - `#league-page-overlay`  the League Page full-screen push (js/app.js)
 *   - `#leagues-home-overlay` Your Leagues, the same shape (js/app.js)
 *
 * Their open state is PRESENCE: each is appended to <body> when it opens and
 * removed when it closes — the same predicate gesturesSuspended()
 * (js/nav-gestures.js) and _dismissBlockingSurfaceUp() (js/app.js) already
 * read. So the lock is the wizard / league-create / delete-account idiom keyed
 * on that presence, `html:has(<surface>)`, with SB-05's full pair.
 *
 * ENGINE-MEASURED through the REAL app (index.html + css/styles.css +
 * js/app.js in headless Chromium, local PIN mode, network blocked — the
 * ccscrolltest.mjs boot recipe): six players, an open week of 16 games, signed
 * in as a player, on Picks, at iPhone SE size (375×667). Each overlay is opened
 * through the app's own opener on the SAME module instance index.html booted
 * (the module script's own URL, ?v= included — a bare './js/app.js' would boot
 * a second copy of the app).
 *
 * For every overlay:
 *   X-0  fixture — open, on top at the swipe point
 *   X-1  THE BUG — the document is not user-scrollable while it is up
 *   X-1b SB-05 M1 — html AND body overscroll-behavior none (the native
 *        WKWebView bounce; computed style only, the bounce is a device check)
 *   X-2  THE BUG — a vertical swipe on the overlay (scrim, header, a body that
 *        does not scroll) does not move the page, both directions
 *   X-3  a mouse wheel over it does not either (web, ≥600px commissioner use)
 *   X-4  its OWN scroller contains its overscroll (`contain`, never `none`)
 *   X-5  its own content still scrolls — and the page does not
 *   X-6  swiping on past the end of its own content does not chain to the page
 *   X-7  close: the page is exactly where it was, the lock and the bounce are
 *        back to DI-327, and the page scrolls again
 * Then [G] — the locks do not fight: a modal over Chat / over the drawer / over
 * the League Page, closed, leaves the surface beneath it still locked; nothing
 * open leaves nothing locked; every `html:has()` lock in styles.css sets only
 * `overflow:hidden` / `overscroll-behavior:none`, so no combination can
 * resolve to a different value.
 *
 * Only a device can show WebKit's own behaviour (UIScrollView momentum, the
 * rubber band, the keyboard pan). iOS 15.0–15.3 has no :has(), so there — as
 * for every :has() lock in this app (Chat, wizard, drawer, league-create,
 * delete-account) — the rule is ignored and the pre-SB-16 behaviour remains.
 *
 * Run: node overlayscrolltest.mjs
 * Override the browser: OVERLAYSCROLL_ENGINE=/path/to/Chromium (falls back to
 * CCSCROLL_ENGINE, CHATPAGE_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE,
 * NAVTEST_ENGINE, then the usual /Applications paths).
 * Mutation runs: OVERLAYSCROLL_ROOT=/path/to/a/COPY/of/cfb-pickems serves that
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
const ROOT = process.env.OVERLAYSCROLL_ROOT || here;
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
const override = process.env.OVERLAYSCROLL_ENGINE || process.env.CCSCROLL_ENGINE || process.env.CHATPAGE_ENGINE
  || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: OVERLAYSCROLL_ENGINE=/path/to/Chromium node overlayscrolltest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (OVERLAYSCROLL_ROOT — serving ${ROOT})`);

// ── [G-css] the static half: read styles.css as served ──────────────────────
const CSS = (await readFile(join(ROOT, 'css/styles.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

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
const rawStatus = (path) => new Promise(res => {
  const rq = httpGet({ host: '127.0.0.1', port: server.address().port, path }, r => { r.resume(); res(r.statusCode); });
  rq.on('error', () => res(-1));
});
for (const path of ['/supabase/tests/.env.local', '/supabase/migrations/', '/.git/HEAD', '/js/../../CLAUDE.md', '/js/%2e%2e/%2e%2e/CLAUDE.md', '/js/.hidden']) {
  assert(await rawStatus(path) === 404, `0-srv: the suite's server refuses ${path} (404) — app files only, no dotfiles, no dot-segments, nothing under /supabase/`);
}
assert(await rawStatus('/config.json') === 200 && await rawStatus('/js/app.js') === 200, '0-srv: …and still serves /config.json (as {}) and the app\'s own files');

// ── the CDP client (same shape as ccscrolltest.mjs) ─────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-ovscroll-'));
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
  // `maxDelta` is the largest |scrollY - base| a window 'scroll' listener saw
  // since park() — a page that moved and came back still shows up here.
  const S = `(() => {
    const hs = getComputedStyle(document.documentElement), bs = getComputedStyle(document.body);
    return { win: Math.round(scrollY), vw: innerWidth, vh: innerHeight, docH: document.documentElement.scrollHeight,
      hOy: hs.overflowY, maxDelta: window.__maxDelta || 0,
      ob: 'html ' + hs.overscrollBehaviorX + '/' + hs.overscrollBehaviorY + ', body ' + bs.overscrollBehaviorX + '/' + bs.overscrollBehaviorY };
  })()`;
  const installRecorders = () => evaluate(`(() => {
    if (window.__recOn) return; window.__recOn = true; window.__maxDelta = 0; window.__base = null;
    addEventListener('scroll', () => { if (window.__base !== null) window.__maxDelta = Math.max(window.__maxDelta, Math.abs(scrollY - window.__base)); }, { passive: true });
  })()`);
  /** Park the page mid-document (a leak in EITHER direction is then visible)
   *  and zero the recorder. Programmatic scrolling stays allowed under a lock. */
  const park = async (y) => {
    await evaluate(`window.scrollTo({ top: ${y}, behavior: 'instant' })`);
    await sleep(80);
    await evaluate(`(() => { window.__maxDelta = 0; window.__base = scrollY; })()`);
    return evaluate(S);
  };
  // SB-05 M1's pair — what WebKit reads for the native root bounce.
  const OB_NONE = 'html none/none, body none/none';
  const OB_AUTO = 'html auto/auto, body auto/auto';
  /** The app module index.html booted — the module script's OWN url (?v= included), so this is the same instance, not a second app. */
  const APP = `import(document.querySelector('script[type="module"][src*="js/app.js"]').src)`;
  /** Scroll state of one element (by selector), or null. */
  const box = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const cs = getComputedStyle(e);
    return { sT: Math.round(e.scrollTop), cH: e.clientHeight, sH: e.scrollHeight, oy: cs.overflowY, ob: cs.overscrollBehaviorY }; })()`);
  /** Is the topmost element at (x,y) inside `sel`? */
  const onTop = (sel, x, y) => evaluate(`!!document.elementFromPoint(${Math.round(x)}, ${Math.round(y)})?.closest(${JSON.stringify(sel)})`);

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
    '1-1: fixture — after reload the app is past the site gate, signed in as a player');
  await evaluate(`window.navigateTo('picks')`);
  await sleep(400);
  await installRecorders();
  // 60 messages tagged to the first game, so the game-chat sheet's own list overflows.
  const gid = await evaluate(`(async () => { const st = await import('./js/storage.js'); const chat = await import('./js/chat.js');
    const g = st.getGames(st.getActiveWeekId())[0]; let seq = 900;
    chat.ingest(Array.from({ length: 60 }, () => { seq++; return { id: 'm' + seq, seq, ts: Date.now() - (1000 - seq) * 60000, type: 'message', author: 'p' + (2 + seq % 5),
      gameTag: g.gameId, body: 'game thread message ' + seq, replyTo: '', notify: true, meta: null, targetId: '' }; }));
    return g.gameId; })()`);
  assert(typeof gid === 'string' && gid.length > 0, `1-2: fixture — 60 chat messages tagged to game ${gid}`);
  assert(await evaluate(`${APP}.then(m => typeof m.showAccountSheet === 'function' && m.openWagerModal === window.openWagerModal)`),
    '1-3: fixture — the app module reached through the module script\'s own URL IS the running instance (its openWagerModal is the one on window), not a second boot');
  let s = await evaluate(S);
  assert(s.docH > s.vh + 1200, `1-4: fixture — Picks is a long scrolling document (${s.docH}px in ${s.vh}px), so a leak in either direction is observable`);
  assert(s.hOy === 'visible' && s.ob === OB_AUTO && await evaluate(`!document.querySelector('.modal-overlay, #chat-sheet-wrap, #league-page-overlay, #leagues-home-overlay')`),
    `1-5: fixture — nothing is open and the page is a normal scroller with DI-327's bounce (html overflow-y "${s.hOy}", ${s.ob})`);

  // ═════════════════════════════════════════════════════════════════════════
  // One runner, four overlays.
  // ═════════════════════════════════════════════════════════════════════════
  const OVERLAYS = [
    { tag: 'M', name: '.modal-overlay (the Account sheet, a real showAccountSheet())', present: '.modal-overlay',
      open: `${APP}.then(m => m.showAccountSheet())`,
      close: `document.getElementById('account-sheet-close').click()`,
      // The centred .modal is short: dimmed scrim above and below it.
      points: async (st) => { const r = await evaluate(`(() => { const r = document.querySelector('.modal-overlay .modal').getBoundingClientRect(); return { t: r.top, b: r.bottom }; })()`);
        return [{ where: 'the scrim ABOVE the sheet', x: st.vw / 2, y: r.t / 2, dy: 280 }, { where: 'the scrim BELOW the sheet', x: st.vw / 2, y: (r.b + st.vh) / 2, dy: -280 }]; },
      scroller: '.modal-overlay .modal',
      filler: `document.querySelector('.modal-overlay .modal').insertAdjacentHTML('beforeend', '<div id="ovs-filler" style="height:1600px"></div>')` },
    { tag: 'C', name: '#chat-sheet-wrap (the game-chat bottom sheet, openGameChatSheet())', present: '#chat-sheet-wrap',
      open: `import('./js/chat-ui.js').then(ui => ui.openGameChatSheet(${JSON.stringify(gid)}))`,
      close: `document.getElementById('chat-sheet-close').click()`,
      points: async (st) => { const r = await evaluate(`(() => { const r = document.querySelector('#chat-sheet-wrap .chat-sheet').getBoundingClientRect(), h = document.querySelector('#chat-sheet-wrap .chat-sheet-header').getBoundingClientRect(); return { t: r.top, hy: (h.top + h.bottom) / 2 }; })()`);
        return [{ where: 'the dimmed backdrop above the sheet', x: st.vw / 2, y: r.t / 2, dy: 280 }, { where: 'the sheet\'s own header', x: st.vw / 4, y: r.hy, dy: 280 }]; },
      scroller: '#chat-sheet-scroll', filler: null },
    { tag: 'L', name: '#league-page-overlay (the League Page push)', present: '#league-page-overlay',
      open: `${APP}.then(m => m._showLeaguePageOverlayForTest())`,
      close: `${APP}.then(m => m._hideLeaguePageOverlayForTest())`,
      points: async (st) => [{ where: 'the overlay (its content fits, so it does not scroll)', x: st.vw / 2, y: st.vh / 2, dy: -280 }, { where: '…the other direction', x: st.vw / 2, y: st.vh / 3, dy: 280 }],
      scroller: '#league-page-overlay',
      filler: `document.getElementById('league-page-overlay').insertAdjacentHTML('beforeend', '<div id="ovs-filler" style="height:2400px"></div>')` },
    { tag: 'H', name: '#leagues-home-overlay (Your Leagues)', present: '#leagues-home-overlay',
      open: `${APP}.then(m => m._showLeaguesHomeOverlayForTest())`,
      close: `${APP}.then(m => m._hideLeaguesHomeOverlayForTest())`,
      points: async (st) => [{ where: 'the overlay (its content fits, so it does not scroll)', x: st.vw / 2, y: st.vh / 2, dy: -280 }, { where: '…the other direction', x: st.vw / 2, y: st.vh / 3, dy: 280 }],
      scroller: '#leagues-home-overlay',
      filler: `document.getElementById('leagues-home-overlay').insertAdjacentHTML('beforeend', '<div id="ovs-filler" style="height:2400px"></div>')` },
  ];

  for (const O of OVERLAYS) {
    console.log(`\n[${O.tag}] ${O.name} — the page underneath never moves; its own content still scrolls…`);
    await evaluate(`window.navigateTo('picks')`);
    await sleep(250);
    let a = await park(300);
    await evaluate(O.open);
    const opened = await waitFor(`document.querySelector(${JSON.stringify(O.present)})`, 3000);
    await sleep(300);
    s = await evaluate(S);
    const pts = opened ? await O.points(s) : [];
    const tops = [];
    for (const p of pts) tops.push(await onTop(O.present, p.x, p.y));
    assert(opened && pts.length === 2 && tops.every(Boolean),
      `${O.tag}-0: fixture — ${O.present} is open and on top at both swipe points (${pts.map((p, i) => `${p.where} (${Math.round(p.x)},${Math.round(p.y)}): ${tops[i]}`).join('; ') || 'not opened'})`);
    assert(s.hOy === 'hidden',
      `${O.tag}-1: THE BUG (root) — the document is NOT user-scrollable while ${O.present} is up (html overflow-y "${s.hOy}"; before SB-16: "visible")`);
    assert(s.ob === OB_NONE,
      `${O.tag}-1b: SB-05 M1 — …and the root's OWN bounce is off while it is up, html AND body (${s.ob}; want ${OB_NONE}) — computed style only: the native WKWebView bounce this turns off is a device check`);
    for (const [i, p] of pts.entries()) {
      a = await park(300);
      await swipe(p.x, p.y, p.dy);
      const b = await evaluate(S);
      assert(b.win === a.win && b.maxDelta === 0,
        `${O.tag}-2${'ab'[i]}: THE BUG — a vertical swipe on ${p.where} does not scroll the page (window ${a.win}→${b.win}, max excursion ${b.maxDelta}px)`);
    }
    if (pts.length) {
      a = await park(300);
      await wheel(pts[0].x, pts[0].y, 400);
      const b = await evaluate(S);
      assert(b.win === a.win && b.maxDelta === 0, `${O.tag}-3: a mouse wheel over ${pts[0].where} does not scroll the page (window ${a.win}→${b.win})`);
    }
    let sc = await box(O.scroller);
    assert(!!sc && (sc.oy === 'auto' || sc.oy === 'scroll') && sc.ob === 'contain',
      `${O.tag}-4: its own scroller (${O.scroller}) is a scroller that CONTAINS its overscroll (overflow-y "${sc?.oy}", overscroll-behavior-y "${sc?.ob}") — its own bounce stays, nothing chains to the page`);
    if (O.filler) { await evaluate(O.filler); await sleep(100); }
    sc = await box(O.scroller);
    assert(!!sc && sc.sH > sc.cH + 300, `${O.tag}-5-0: fixture — its own content overflows (${sc?.sH}px in ${sc?.cH}px), so there is something for IT to scroll`);
    // Start the in-overlay swipes at the scroller's own centre.
    const c = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(O.scroller)}).getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; })()`);
    // Move the list to its top first (a fresh chat sheet opens on the newest message, at the bottom).
    await evaluate(`document.querySelector(${JSON.stringify(O.scroller)}).scrollTop = 0`);
    await sleep(80);
    a = await park(300);
    let s0 = await box(O.scroller);
    await swipe(c.x, c.y, -200);
    let b = await evaluate(S);
    let s1 = await box(O.scroller);
    assert(s1.sT > s0.sT + 50 && b.win === a.win && b.maxDelta === 0,
      `${O.tag}-5: a swipe INSIDE it scrolls its own content (${s0.sT}→${s1.sT}) and not the page (window ${a.win}→${b.win})`);
    await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(O.scroller)}); e.scrollTop = e.scrollHeight; })()`);
    await sleep(80);
    a = await park(300);
    s0 = await box(O.scroller);
    await swipe(c.x, c.y, -400);
    await swipe(c.x, c.y, -400);
    b = await evaluate(S);
    assert(s0.sT >= s0.sH - s0.cH - 1 && b.win === a.win && b.maxDelta === 0,
      `${O.tag}-6: THE BUG — swiping on PAST the end of its own content does not chain to the page (content at ${s0.sT}/${s0.sH - s0.cH}, window ${a.win}→${b.win}, max excursion ${b.maxDelta}px)`);
    await evaluate(`document.querySelector(${JSON.stringify(O.scroller)}).scrollTop = 0`);
    await sleep(80);
    a = await park(300);
    await swipe(c.x, c.y, 400);
    b = await evaluate(S);
    assert(b.win === a.win && b.maxDelta === 0,
      `${O.tag}-6b: …nor does swiping DOWN past its top pull the page with it (window ${a.win}→${b.win})`);
    // Close: exact position, lock lifted, bounce back, page free.
    a = await park(420);
    await evaluate(O.close);
    const closed = await waitFor(`!document.querySelector(${JSON.stringify(O.present)})`, 3000);
    await sleep(200);
    b = await evaluate(S);
    assert(closed && b.win === 420 && b.hOy === 'visible' && b.ob === OB_AUTO,
      `${O.tag}-7: close — the page is exactly where it was (window ${b.win}, want 420), the root is a normal scroller again (overflow-y "${b.hOy}") with DI-327's bounce (${b.ob})`);
    a = await park(420);
    await swipe(s.vw / 2, s.vh / 2, -250);
    b = await evaluate(S);
    assert(b.win > a.win + 50, `${O.tag}-7b: …and the page scrolls normally again (window ${a.win}→${b.win}) — the lock is released, not stuck`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[G] The locks do not fight — closing one surface never unlocks the one still beneath it…');
  // ═════════════════════════════════════════════════════════════════════════
  const lockState = () => evaluate(S);
  // G-1 Chat tab (RG-289's own lock) + a modal over it.
  await evaluate(`window.navigateTo('chat')`);
  await sleep(400);
  let g0 = await lockState();
  await evaluate(`${APP}.then(m => m.showAccountSheet())`);
  await waitFor(`document.querySelector('.modal-overlay')`, 2000);
  const g1 = await lockState();
  await evaluate(`document.getElementById('account-sheet-close').click()`);
  await sleep(150);
  let g2 = await lockState();
  assert(g0.hOy === 'hidden' && g1.hOy === 'hidden' && g2.hOy === 'hidden' && g2.ob === OB_NONE,
    `G-1: Chat (RG-289's lock) + a modal: locked before (${g0.hOy}), during (${g1.hOy}) and AFTER the modal closes (${g2.hOy}, ${g2.ob}) — Chat's own lock still holds`);
  await evaluate(`window.navigateTo('picks')`);
  await sleep(400);
  g2 = await lockState();
  assert(g2.hOy === 'visible' && g2.ob === OB_AUTO, `G-1b: …and leaving Chat with nothing open frees the page (${g2.hOy}, ${g2.ob})`);
  // G-2 the control-center drawer (SB-05) + a modal over it.
  await evaluate(`document.getElementById('control-center-trigger').click()`);
  await waitFor(`document.getElementById('control-center').dataset.phase === 'open'`, 2000);
  await evaluate(`${APP}.then(m => m.showAccountSheet())`);
  await waitFor(`document.querySelector('.modal-overlay')`, 2000);
  await evaluate(`document.getElementById('account-sheet-close').click()`);
  await sleep(150);
  g2 = await lockState();
  const ccOpen = await evaluate(`document.getElementById('control-center').dataset.phase`);
  assert(ccOpen === 'open' && g2.hOy === 'hidden' && g2.ob === OB_NONE,
    `G-2: the drawer (SB-05's lock) + a modal: with the modal closed and the drawer still open (phase ${ccOpen}) the page is still locked (${g2.hOy}, ${g2.ob})`);
  await evaluate(`document.querySelector('#control-center [data-action="cc-close"]').click()`);
  await waitFor(`document.getElementById('control-center').dataset.phase === 'closed'`, 2000);
  await sleep(100);
  g2 = await lockState();
  assert(g2.hOy === 'visible' && g2.ob === OB_AUTO, `G-2b: …and closing the drawer too frees the page (${g2.hOy}, ${g2.ob})`);
  // G-3 the League Page (SB-16) + a modal over it (z 200 over 150).
  await evaluate(`${APP}.then(m => m._showLeaguePageOverlayForTest())`);
  await waitFor(`document.getElementById('league-page-overlay')`, 2000);
  await evaluate(`${APP}.then(m => m.showAccountSheet())`);
  await waitFor(`document.querySelector('.modal-overlay')`, 2000);
  await evaluate(`document.getElementById('account-sheet-close').click()`);
  await sleep(150);
  g2 = await lockState();
  assert(await evaluate(`!!document.getElementById('league-page-overlay')`) && g2.hOy === 'hidden' && g2.ob === OB_NONE,
    `G-3: the League Page + a modal over it: with the modal closed and the League Page still up the page is still locked (${g2.hOy}, ${g2.ob})`);
  await evaluate(`${APP}.then(m => m._hideLeaguePageOverlayForTest())`);
  await sleep(150);
  g2 = await lockState();
  assert(g2.hOy === 'visible' && g2.ob === OB_AUTO, `G-3b: …and closing it frees the page (${g2.hOy}, ${g2.ob})`);
  // G-4 two at once (Your Leagues + the game-chat sheet), closed in either order, leave nothing behind.
  await evaluate(`${APP}.then(m => m._showLeaguesHomeOverlayForTest())`);
  await evaluate(`import('./js/chat-ui.js').then(ui => ui.openGameChatSheet(${JSON.stringify(gid)}))`);
  await waitFor(`document.getElementById('leagues-home-overlay') && document.getElementById('chat-sheet-wrap')`, 2000);
  await evaluate(`document.getElementById('chat-sheet-close').click()`);
  await sleep(100);
  const mid = await lockState();
  await evaluate(`${APP}.then(m => m._hideLeaguesHomeOverlayForTest())`);
  await sleep(150);
  g2 = await lockState();
  assert(mid.hOy === 'hidden' && g2.hOy === 'visible' && g2.ob === OB_AUTO,
    `G-4: two surfaces at once — closing the top one keeps the lock (${mid.hOy}), closing the last frees the page (${g2.hOy}, ${g2.ob})`);
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

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[G-css] Every html:has() page lock in styles.css sets the SAME values, so no combination of open surfaces can fight…');
// ═════════════════════════════════════════════════════════════════════════
{
  // Every rule whose selector list contains `html:has(`.
  const rules = [...CSS.matchAll(/([^{}]*html:has\([^{}]*)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2].trim() }));
  const decls = rules.flatMap(r => r.body.split(';').map(d => d.trim()).filter(Boolean).map(d => ({ sel: r.sel, d: d.replace(/\s+/g, '') })));
  const ALLOWED = new Set(['overflow:hidden', 'overscroll-behavior:none']);
  const odd = decls.filter(x => !ALLOWED.has(x.d));
  assert(rules.length >= 7 && odd.length === 0,
    `G-css-1: all ${rules.length} html:has() rules declare only overflow:hidden / overscroll-behavior:none — a lock can only ever ADD the same lock (odd declarations: ${odd.length ? JSON.stringify(odd.map(x => x.sel.slice(0, 60) + ' → ' + x.d)) : 'none'})`);
  const selText = rules.map(r => r.sel).join(',');
  for (const [surf, sel] of [['.modal-overlay', 'html:has(.modal-overlay)'], ['#chat-sheet-wrap', 'html:has(#chat-sheet-wrap)'],
    ['#league-page-overlay', 'html:has(#league-page-overlay)'], ['#leagues-home-overlay', 'html:has(#leagues-home-overlay)']]) {
    const overflowRule = rules.find(r => r.body.replace(/\s+/g, '') === 'overflow:hidden' && r.sel.split(',').map(x => x.trim()).includes(sel));
    const obRule = rules.find(r => r.body.replace(/\s+/g, '') === 'overscroll-behavior:none' && r.sel.split(',').map(x => x.trim()).includes(sel) && r.sel.split(',').map(x => x.trim()).includes(sel + ' body'));
    assert(!!overflowRule && !!obRule, `G-css-2: ${surf} has its lock pair keyed on its presence — \`${sel}{overflow:hidden}\` and \`${sel}, ${sel} body{overscroll-behavior:none}\``);
  }
  // The pre-existing five are still there (none of them was rewritten to make room).
  for (const sel of ['html:has(> body[data-tab="chat"])', 'html:has(#week-wizard-sheet-wrap)', 'html:has(#control-center[data-open="true"])', 'html:has(#league-create-sheet-wrap)', 'html:has(#pwacct-delete-overlay)']) {
    assert(selText.includes(sel), `G-css-3: the pre-existing lock ${sel} is untouched`);
  }
  // Canary — the scan can fail.
  const canary = [...'html:has(.x){overflow:auto}'.matchAll(/([^{}]*html:has\([^{}]*)\{([^{}]*)\}/g)].map(m => m[2].trim());
  assert(canary.length === 1 && !ALLOWED.has(canary[0]), 'G-css-4: canary — a :has() rule setting a DIFFERENT value is seen and would be flagged');
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 20000).unref();
