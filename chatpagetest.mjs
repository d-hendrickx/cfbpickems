/**
 * CFB Pickems — chatpagetest.mjs
 * ==============================
 * RG-289 (live v0.27.0, Drew 2026-09-28): "the chat tab has the rubber band
 * scroll at the top and bottom, but this tab should not be able to scroll up
 * and down it should remain static. Any vertical scrolling on this page should
 * only be the chat thread to scroll up to see past messages."
 *
 * ENGINE-MEASURED through the REAL app (index.html + css/styles.css +
 * js/app.js in headless Chromium, local PIN mode, network blocked — the
 * wizardsheettest.mjs boot recipe): six players, an open week, chat on, an
 * 80-message thread folded through the app's OWN js/chat.js, the player
 * landing on Picks first (the normal path) and then tapping Chat.
 *
 * What moved the Chat page, measured on release/v0.27.1 before the fix:
 *   1. THE BOTTOM RUBBER BAND (JS). bindBottomBounce(window, .page-wrapper) is
 *      bound once, on the first non-Chat tab, and never again (WeakMap
 *      idempotency on the STABLE `window` key) — its window touch listeners
 *      stay live on Chat. Chat never scrolls `window`, so its "true bottom"
 *      test (scrollY + innerHeight >= scrollHeight - 1) is true for EVERY
 *      touch: each upward drag anywhere on Chat — composer, thread at its
 *      bottom, and mid-history — lifted the whole page by up to ~20px and
 *      sprang it back. RG-285's twin (the window pull-to-refresh) got an
 *      isActive denylist; this binder never did.
 *   2. THE PULL-UP LIFTED THE PAGE TOO. DI-399(b-ii)'s Chat pull-up was
 *      given `.page-wrapper` as its rubber-band target, so a drag up while
 *      the thread sat at its newest message (the default state) lifted the
 *      header, thread and composer together — the page moving, not the
 *      thread.
 *   3. THE ROOT STAYED A LIVE SCROLLER (CSS). html/body carry DI-327's
 *      overscroll-behavior:auto and the root was never made non-scrollable
 *      on Chat, so WebKit (Safari tab, home-screen PWA, WKWebView — all bounce
 *      the root even when the document fits) rubber-banded the whole page at
 *      top and bottom, and the thread's own overscroll chained to it. In a
 *      Safari tab `.page-wrapper{min-height:100vh}` is the LARGE viewport, so
 *      the document was also genuinely taller than the visible area by the
 *      toolbar height and scrolled. Blink cannot show a WebKit bounce: [A]
 *      pins the computed values WebKit reads, and [B] models the large-
 *      viewport case explicitly (see its header).
 *
 * Also proved: the thread still scrolls both ways by touch and wheel, the
 * pull-up still ARMS at the thread's true bottom (DI-399 b-ii), the keyboard-
 * up layout (T-25) keeps the composer visible with the page static, the
 * home-screen/safe-area case, and that Picks keeps its window scroll and its
 * T-29 bottom bounce (the fix is Chat-only).
 *
 * Run: node chatpagetest.mjs
 * Override the browser: CHATPAGE_ENGINE=/path/to/Chromium (falls back to
 * WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then /Applications).
 * Mutation runs: CHATPAGE_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree
 * instead of this one — mutate the copy, never this checkout.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer, get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.CHATPAGE_ROOT || here;
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
const override = process.env.CHATPAGE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: CHATPAGE_ENGINE=/path/to/Chromium node chatpagetest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (CHATPAGE_ROOT — serving ${ROOT})`);

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

// ── the CDP client (same shape as shellrendertest.mjs / navtest.mjs [7]) ────
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-chatpage-'));
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
  const click = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await pg.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };
  const swipe = async (x, y, yDistance) => {   // a real touch scroll gesture, finger down at (x,y)
    await pg.send('Input.synthesizeScrollGesture', { x: Math.round(x), y: Math.round(y), yDistance, gestureSourceType: 'touch', speed: 1200 });
    await sleep(350);
  };
  const wheel = async (x, y, deltaY) => {
    await pg.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY });
    await sleep(350);
  };

  // ── measurement helpers ────────────────────────────────────────────────────
  // Everything a player can see move on Chat, in one read. `lift` is the
  // largest translateY ever written to .page-wrapper since the last reset —
  // the JS rubber bands spring back on touchend, so only a recorder catches them.
  const M = `(() => {
    const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) }; };
    const cs = document.getElementById('chat-scroll');
    return { tab: document.body.dataset.tab, vh: innerHeight, docH: document.documentElement.scrollHeight, win: Math.round(scrollY),
      page: r(document.getElementById('page-chat')), hdr: r(document.querySelector('#page-chat .chat-sticky-stack')),
      comp: r(document.querySelector('#page-chat .chat-composer')),
      thread: cs ? { sT: Math.round(cs.scrollTop), cH: cs.clientHeight, sH: cs.scrollHeight, t: Math.round(cs.getBoundingClientRect().top), b: Math.round(cs.getBoundingClientRect().bottom) } : null,
      lift: window.__lift || 0, phase: window.__phaseMax || 'idle', wrapT: document.querySelector('.page-wrapper').style.transform };
  })()`;
  const installRecorders = () => evaluate(`(() => {
    if (window.__recOn) return; window.__recOn = true; window.__lift = 0; window.__phaseMax = 'idle';
    const pw = document.querySelector('.page-wrapper');
    new MutationObserver(() => { const m = /translateY\\((-?[\\d.]+)px\\)/.exec(pw.style.transform); if (m) window.__lift = Math.max(window.__lift, Math.abs(+m[1])); })
      .observe(pw, { attributes: true, attributeFilter: ['style'] });
    const rank = { idle: 0, pulling: 1, armed: 2, refreshing: 3 };
    new MutationObserver(() => { const el = document.getElementById('chat-pull-refresh'); const p = el?.dataset?.phase;
      if (p && (rank[p] ?? 0) > (rank[window.__phaseMax] ?? 0)) window.__phaseMax = p; })
      .observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-phase'] });
  })()`);
  const resetRec = () => evaluate(`(() => { window.__lift = 0; window.__phaseMax = 'idle'; })()`);
  /** A finger drag the page's own JS sees (touchstart/move/end), sampled
   *  MID-gesture — the rubber bands are only visible while the finger is down. */
  const drag = async (x, y, dy) => {
    await resetRec();
    await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y) }] });
    for (let i = 1; i <= 10; i++) { await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x), y: Math.round(y + dy * i / 10) }] }); await sleep(16); }
    const mid = await evaluate(M);
    await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(450);
    return { mid, after: await evaluate(M) };
  };
  const bottomOut = () => evaluate(`(() => { const s = document.getElementById('chat-scroll'); s.scrollTop = s.scrollHeight; return s.scrollHeight - s.scrollTop - s.clientHeight; })()`);
  const same = (a, b) => a && b && a.t === b.t && a.b === b.b;
  const cx = 195;

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode): six players, an open week, chat on, an 80-message thread; land on Picks, then tap Chat…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(390, 844);
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
    st.saveSetting('chatEnabled', true); st.saveSetting('chatEpochSeq', 0); st.saveSetting('chatRetentionDays', 0);
    st.setSession('p1', false, true);
    await new Promise(r => setTimeout(r, 1200));   // storage.js's debounced write lands
  })()`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '1-1: fixture — after reload the app is past the site gate, signed in as a player');
  await installRecorders();
  // Every client passes through a non-Chat tab first (the landing tab), which
  // is where the window binders are bound once — the leak's precondition.
  await evaluate(`window.navigateTo('picks')`);
  await sleep(300);
  await evaluate(`(async () => { const chat = await import('./js/chat.js'); let seq = 500;
    chat.ingest(Array.from({ length: 80 }, () => { seq++; return { id: 'm' + seq, seq, ts: Date.now() - (600 - seq) * 60000, type: 'message', author: 'p' + (2 + seq % 5),
      gameTag: '', body: 'message ' + seq, replyTo: '', notify: true, meta: null, targetId: '' }; })); })()`);
  let picks = await evaluate(`({ docH: document.documentElement.scrollHeight, vh: innerHeight })`);
  assert(picks.docH > picks.vh + 200, `1-2: fixture — Picks is a normal scrolling document (${picks.docH}px in ${picks.vh}px)`);
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' })`);
  await sleep(100);
  await evaluate(`window.navigateTo('chat')`);
  await waitFor(`document.querySelectorAll('#chat-scroll .chat-msg').length >= 60`);
  await sleep(500);
  let m = await evaluate(M);
  assert(m.tab === 'chat' && m.thread && m.thread.sH > m.thread.cH + 2000,
    `1-3: fixture — Chat is showing with a real backlog (thread ${m.thread?.sH}px of content in ${m.thread?.cH}px)`);
  assert(m.thread && Math.abs(m.thread.sH - m.thread.sT - m.thread.cH) <= 1, `1-4: fixture — the thread opens on the newest message (RG-279 behaviour, sT ${m.thread?.sT})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] RG-289 — on Chat the PAGE is static and the thread is the only vertical scroller (390×844, touch + wheel)…');
  // ═════════════════════════════════════════════════════════════════════════
  assert(m.win === 0, `A-1: arriving from a Picks page scrolled to 300px, the window is at 0 on Chat (scrollY ${m.win})`);
  assert(m.docH <= m.vh, `A-2: the document is no taller than the viewport on Chat (${m.docH}px vs ${m.vh}px) — nothing below the composer to scroll to`);
  assert(m.comp && m.comp.b <= m.vh && m.hdr && m.hdr.t >= 0, `A-3: header (${m.hdr?.t}) and composer (…${m.comp?.b}) are both inside the viewport`);
  const root = await evaluate(`(() => { const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body), s = getComputedStyle(document.getElementById('chat-scroll'));
    return { hOy: h.overflowY, hOb: h.overscrollBehaviorY, bOb: b.overscrollBehaviorY, sOy: s.overflowY, sOb: s.overscrollBehaviorY }; })()`);
  assert(root.hOy === 'hidden',
    `A-4: THE BUG (top AND bottom) — the root is not user-scrollable on Chat (html overflow-y "${root.hOy}"); WebKit rubber-bands a user-scrollable root even when the document fits`);
  assert(root.hOb === 'none' && root.bOb === 'none',
    `A-5: THE BUG — the root's own rubber band is off on Chat (html/body overscroll-behavior-y "${root.hOb}"/"${root.bOb}") — the property WebKit reads for the page bounce (iOS 16+)`);
  assert(root.sOy === 'auto' && root.sOb === 'contain',
    `A-6: the thread is the scroller and CONTAINS its overscroll (overflow-y "${root.sOy}", overscroll-behavior-y "${root.sOb}") — its own bounce stays, nothing chains to the page`);

  let d = await drag(cx, m.comp.t + m.comp.h / 2, -220);
  assert(d.mid.lift === 0 && same(d.mid.comp, m.comp) && same(d.mid.hdr, m.hdr) && d.mid.win === 0,
    `A-7: THE BUG (bottom) — a drag UP on the composer moves nothing: page lift ${d.mid.lift.toFixed(1)}px (v0.27.1 tree: ~20px), composer ${d.mid.comp?.t}…${d.mid.comp?.b}, header ${d.mid.hdr?.t}, window ${d.mid.win}`);
  const th = m.thread, midY = (th.t + th.b) / 2;
  d = await drag(cx, midY, -220);
  assert(d.mid.lift === 0 && same(d.mid.comp, m.comp) && same(d.mid.hdr, m.hdr) && d.mid.win === 0,
    `A-8: THE BUG (bottom) — a drag UP inside the thread at its newest message moves nothing but the thread: page lift ${d.mid.lift.toFixed(1)}px, header/composer still, window ${d.mid.win}`);
  d = await drag(cx, midY, 320);
  assert(d.after.thread.sT < th.sT - 150 && d.mid.lift === 0 && d.after.win === 0 && same(d.after.hdr, m.hdr),
    `A-9: a drag DOWN inside the thread scrolls the THREAD to older messages (${th.sT}→${d.after.thread.sT}) and nothing else (lift ${d.mid.lift}, window ${d.after.win})`);
  const beforeUp = d.after.thread.sT;
  d = await drag(cx, midY, -160);
  assert(d.after.thread.sT > beforeUp + 60 && d.mid.lift === 0 && d.mid.win === 0 && same(d.mid.comp, m.comp),
    `A-10: THE BUG — a drag UP mid-history scrolls the thread (${beforeUp}→${d.after.thread.sT}) WITHOUT lifting the page (lift ${d.mid.lift.toFixed(1)}px; v0.27.1 tree: ~19px on every such drag)`);
  d = await drag(cx, m.hdr.t + 20, 240);
  assert(d.mid.lift === 0 && same(d.mid.hdr, m.hdr) && same(d.mid.comp, m.comp) && d.after.win === 0,
    `A-11: a drag DOWN on the header moves nothing (header ${d.mid.hdr?.t}, window ${d.after.win})`);

  // Compositor-driven scrolls (the engine's own touch scrolling, not just JS listeners).
  let a = await evaluate(M);
  await swipe(cx, m.comp.t + m.comp.h / 2, -350);
  let b = await evaluate(M);
  assert(b.win === 0 && b.thread.sT === a.thread.sT && same(b.comp, m.comp), `A-12: a real touch scroll gesture on the composer scrolls nothing (window ${b.win}, thread ${a.thread.sT}→${b.thread.sT})`);
  await swipe(cx, m.hdr.t + 20, 350);
  b = await evaluate(M);
  assert(b.win === 0 && same(b.hdr, m.hdr), `A-13: …nor one on the header (window ${b.win})`);
  a = await evaluate(M);
  await swipe(cx, midY, 400);
  b = await evaluate(M);
  assert(b.thread.sT < a.thread.sT - 150 && b.win === 0, `A-14: a real touch scroll gesture inside the thread scrolls the thread (${a.thread.sT}→${b.thread.sT}), never the window (${b.win})`);
  await swipe(cx, midY, 20000);   // to the OLDEST end, then keep pulling
  a = await evaluate(M);
  await swipe(cx, midY, 600);
  b = await evaluate(M);
  assert(a.thread.sT === 0 && b.win === 0 && same(b.hdr, m.hdr), `A-15: pulling past the thread's OLDEST end does not chain to the page (thread ${b.thread.sT}, window ${b.win})`);
  a = await evaluate(M);
  await wheel(cx, m.comp.t + m.comp.h / 2, 400);
  await wheel(cx, m.hdr.t + 20, -400);
  b = await evaluate(M);
  assert(b.win === 0 && b.thread.sT === a.thread.sT, `A-16: a mouse wheel over the composer or the header scrolls nothing (window ${b.win}, thread ${a.thread.sT}→${b.thread.sT})`);
  await wheel(cx, midY, 500);
  b = await evaluate(M);
  assert(b.thread.sT > a.thread.sT + 100 && b.win === 0, `A-17: a wheel over the thread scrolls the thread (${a.thread.sT}→${b.thread.sT}), not the window`);

  // DI-399(b-ii) survives: the pull-up still arms at the TRUE bottom of the thread.
  assert(await bottomOut() <= 1, 'A-18: fixture — thread back at its newest message');
  await sleep(200);
  d = await drag(cx, midY, -200);
  assert(d.mid.phase === 'armed' || d.mid.phase === 'refreshing',
    `A-19: DI-399(b-ii) intact — a drag up past the thread's newest message still ARMS Chat's pull-up refresh (#chat-pull-refresh phase reached "${d.mid.phase}")`);
  assert(d.mid.lift === 0 && same(d.mid.hdr, m.hdr) && same(d.mid.comp, m.comp),
    `A-20: THE BUG — …and arming it no longer lifts the whole page (header, thread and composer) — page lift ${d.mid.lift.toFixed(1)}px (v0.27.1 tree: ~20px)`);
  await sleep(1500);
  await evaluate(`document.querySelectorAll('.sync-failure-banner,[data-sync-failure]').forEach(n => n.remove())`);
  await bottomOut();
  await sleep(150);
  d = await drag(cx, midY, 400);
  assert(d.mid.phase === 'idle', `A-21: a drag DOWN from the newest message never arms the pull-up (phase "${d.mid.phase}") — only the thread scrolls`);
  const navHidden = await evaluate(`document.querySelector('.bottom-nav')?.classList.contains('nav-hidden') ?? null`);
  assert(navHidden !== null, `A-22: fixture — the bottom nav is present on Chat`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] RG-289 — the Safari-tab case: 100vh is the LARGE viewport (toolbars collapsed), taller than what is visible…');
  // ═════════════════════════════════════════════════════════════════════════
  // Blink has one viewport height; iOS Safari has two, and `100vh` is the
  // larger one, so `.page-wrapper{min-height:100vh}` made the document taller
  // than the visible area by the toolbar height (≈83px on a 390×844 iPhone)
  // — a real, scrollable, bouncing root on Chat. Modelled here by making the
  // shared base rule resolve 83px taller than the visible viewport, exactly
  // what iOS resolves it to. `dvh` is the visible height in both engines.
  await evaluate(`(() => { const s = document.createElement('style'); s.id = 'lvh-model'; s.textContent = '.page-wrapper{min-height:calc(100vh + 83px)}'; document.head.appendChild(s); })()`);
  await evaluate(`window.navigateTo('picks')`);
  await sleep(300);
  await evaluate(`window.scrollTo({ top: 400, behavior: 'instant' })`);
  await sleep(100);
  await evaluate(`window.navigateTo('chat')`);
  await sleep(600);
  m = await evaluate(M);
  assert(m.win === 0 && m.docH <= m.vh,
    `B-1: THE BUG — with 100vh taller than the visible area, the Chat document still fits the visible viewport (${m.docH}px vs ${m.vh}px) and sits at the top (scrollY ${m.win}); a leftover offset here would hide the header with nothing to scroll it back`);
  a = await evaluate(M);
  await swipe(cx, m.comp.t + m.comp.h / 2, -400);
  await wheel(cx, m.comp.t + m.comp.h / 2, 400);
  b = await evaluate(M);
  assert(b.win === 0 && same(b.comp, a.comp), `B-2: THE BUG — a swipe/wheel on the composer does not scroll the page up by the toolbar height (window ${a.win}→${b.win})`);
  await evaluate(`window.navigateTo('picks')`);
  await sleep(300);
  picks = await evaluate(`({ minH: getComputedStyle(document.querySelector('.page-wrapper')).minHeight, vh: innerHeight })`);
  assert(parseFloat(picks.minH) === picks.vh + 83, `B-3: control — off Chat the shared base rule is untouched (Picks .page-wrapper min-height ${picks.minH} under the model)`);
  await evaluate(`document.getElementById('lvh-model').remove()`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] T-25 — keyboard up on Chat: composer visible above it, page still static…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.navigateTo('chat')`);
  await sleep(500);
  await evaluate(`document.getElementById('chat-input').focus()`);
  await sleep(100);
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 508, deviceScaleFactor: 1, mobile: true });   // a 336px keyboard
  const kbd = await waitFor(`document.body.hasAttribute('data-keyboard-up')`, 3000);
  assert(kbd, 'C-1: fixture — the REAL bindKeyboardAvoid() flagged body[data-keyboard-up] on focus + a 336px viewport drop');
  await sleep(300);
  m = await evaluate(M);
  assert(m.comp && m.comp.b <= m.vh && m.comp.t > m.vh / 2, `C-2: the composer sits at the bottom of the shrunken viewport, visible (${m.comp?.t}…${m.comp?.b} of ${m.vh})`);
  assert(m.win === 0 && m.docH <= m.vh, `C-3: the page is still static with the keyboard up (document ${m.docH}px in ${m.vh}px, scrollY ${m.win})`);
  d = await drag(cx, m.comp.t + m.comp.h / 2, -200);
  assert(d.mid.lift === 0 && same(d.mid.comp, m.comp) && d.after.win === 0, `C-4: a drag on the composer with the keyboard up moves nothing (lift ${d.mid.lift}, window ${d.after.win})`);
  a = await evaluate(M);
  await swipe(cx, (m.thread.t + m.thread.b) / 2, 250);
  b = await evaluate(M);
  assert(b.thread.sT < a.thread.sT && b.win === 0, `C-5: the thread still scrolls with the keyboard up (${a.thread.sT}→${b.thread.sT}), the window does not`);
  await evaluate(`document.getElementById('chat-input').blur()`);
  await viewport(390, 844);
  await waitFor(`!document.body.hasAttribute('data-keyboard-up')`, 3000);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[F] RG-291 — "↓ latest" with the keyboard up goes to the newest message and leaves the keyboard alone…');
  // ═════════════════════════════════════════════════════════════════════════
  // Drew, live v0.27.1 (2026-09-28): "When in the chat, with the keyboard
  // pulled up if you hit 'latest' it swipes the keyboard away and doesn't
  // bring you to the most recent message." Headless Chromium has no software
  // keyboard, so "the keyboard went away" is measured as what the app itself
  // does when it does: the composer loses focus and the REAL
  // bindKeyboardAvoid() drops body[data-keyboard-up] (restoring the nav
  // clearance and moving the button 56px up the screen mid-tap).
  const raiseKeyboard = async () => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(150);
    await evaluate(`document.getElementById('chat-input').focus()`);
    await sleep(100);
    await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 508, deviceScaleFactor: 1, mobile: true });
    return waitFor(`document.body.hasAttribute('data-keyboard-up') && document.activeElement?.id === 'chat-input'`, 3000);
  };
  const scrollUpForJump = async () => {
    await evaluate(`(() => { const s = document.getElementById('chat-scroll'); s.scrollTop = 200; s.dispatchEvent(new Event('scroll')); })()`);
    return waitFor(`document.getElementById('chat-jump')?.style.display === 'block' && document.getElementById('chat-jump').getBoundingClientRect().height > 0`, 2000);
  };
  const KB = `(() => { const s = document.getElementById('chat-scroll'), j = document.getElementById('chat-jump'), r = j.getBoundingClientRect();
    return { active: document.activeElement?.id || document.activeElement?.tagName, kbd: document.body.hasAttribute('data-keyboard-up'),
      dist: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight), jump: j.style.display, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
  await evaluate(`window.navigateTo('chat')`);
  await sleep(500);
  assert(await raiseKeyboard(), 'F-0: fixture — composer focused, the REAL bindKeyboardAvoid() flagged body[data-keyboard-up]');
  assert(await scrollUpForJump(), 'F-1: fixture — scrolled up into history, the "↓ latest" button is showing');
  // Where the tap's click actually lands (diagnostic for F-5's message).
  await evaluate(`(() => { if (window.__clickRec) return; window.__clickRec = true;
    document.addEventListener('click', e => { window.__lastClick = e.target.id || e.target.className || e.target.tagName; }, true); })()`);
  let kb = await evaluate(KB);
  assert(kb.dist > 1000, `F-2: fixture — the reader is well away from the newest message (${kb.dist}px from the bottom)`);
  // A real finger tap (touch emulation on: touchstart/touchend → the
  // engine's own synthesized mousedown/focus/mouseup/click).
  await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(kb.x), y: Math.round(kb.y) }] });
  await sleep(40);
  await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
  kb = await evaluate(KB);
  assert(kb.active === 'chat-input', `F-3: THE BUG — tapping "↓ latest" leaves the composer focused, so the keyboard stays up (activeElement "${kb.active}")`);
  assert(kb.kbd, `F-4: THE BUG — …body[data-keyboard-up] is unchanged by the tap (${kb.kbd})`);
  const clicked = await evaluate(`window.__lastClick || '(no click)'`);
  assert(kb.dist <= 1, `F-5: THE BUG — …and the thread is at the newest message (${kb.dist}px from the bottom; the tap's click landed on "${clicked}")`);
  assert(kb.jump === 'none', `F-6: …and the button hides itself once there (display "${kb.jump}")`);

  // Desktop mouse: the mousedown is what moves focus in every engine.
  if (!(await evaluate(`document.body.hasAttribute('data-keyboard-up') && document.activeElement?.id === 'chat-input'`))) await raiseKeyboard();
  await scrollUpForJump();
  kb = await evaluate(KB);
  await click(Math.round(kb.x), Math.round(kb.y));
  await sleep(600);
  kb = await evaluate(KB);
  assert(kb.active === 'chat-input' && kb.kbd && kb.dist <= 1,
    `F-7: a mouse click on "↓ latest" does the same — composer keeps focus (${kb.active}), layout unchanged (${kb.kbd}), newest message (${kb.dist}px)`);

  // Keyboard-only desktop user: the button is still reachable and operable.
  await scrollUpForJump();
  await evaluate(`document.getElementById('chat-jump').focus()`);
  const focusable = await evaluate(`document.activeElement?.id === 'chat-jump'`);
  await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(400);
  kb = await evaluate(KB);
  assert(focusable && kb.dist <= 1, `F-8: the button is still keyboard-focusable (${focusable}) and Enter on it jumps to the newest message (${kb.dist}px)`);

  await evaluate(`document.activeElement?.blur?.()`);
  await viewport(390, 844);
  await waitFor(`!document.body.hasAttribute('data-keyboard-up')`, 3000);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[G] RG-291 follow-up sweep — every control within reach of the focused composer keeps the tap AND the keyboard…');
  // ═════════════════════════════════════════════════════════════════════════
  // RG-291 review (2026-09-28): "any keyboard-up layout change: tap every
  // control within reach of the composer with the composer focused, and check
  // that focus and the tap target stay put." Same mechanism [F] measured: a
  // tap on a <button> moves focus off the textarea at mousedown, the REAL
  // bindKeyboardAvoid() drops body[data-keyboard-up] on the focusout, the nav
  // clearance comes back and the composer + thread move --nav-bar-clearance up
  // the screen BETWEEN mousedown and mouseup — so the click lands on a common
  // ancestor and the control's handler never runs. Per control: a real touch
  // tap with the composer focused and the keyboard up; measured are (a) the
  // click hit the control and its handler ran, (b) body[data-keyboard-up] is
  // unchanged, (c) the composer never blurred during the tap.
  const G_REC = `(() => { window.__g = { sel: '', hit: 0, landed: '', blurs: 0, atClick: null };
    if (window.__gRec) return; window.__gRec = true;
    document.addEventListener('click', e => { const g = window.__g; g.landed = e.target.id || String(e.target.className || e.target.tagName);
      if (!g.atClick) g.atClick = { active: document.activeElement?.id || document.activeElement?.tagName, kbd: document.body.hasAttribute('data-keyboard-up'), blurs: g.blurs };
      if (g.sel && e.target.closest?.(g.sel)) g.hit++; }, true);
    document.addEventListener('focusout', e => { if (e.target.classList?.contains('chat-input')) window.__g.blurs++; }, true); })()`;
  const tapSel = async (sel) => {
    await evaluate(G_REC);
    await evaluate(`window.__g.sel = ${JSON.stringify(sel)}`);
    // The finger goes down on what the player SEES: wait (≤2s) until the
    // control is the topmost element at its own centre — e.g. the bottom nav
    // finishes its keyboard-up slide-out before ➤ is tappable. The bug under
    // test happens AFTER touchdown, so this never hides it.
    const where = `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return null; const x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height / 2);
      return { x, y, top: !!document.elementFromPoint(x, y)?.closest(${JSON.stringify(sel)}) }; })()`;
    let r = await evaluate(where);
    for (let i = 0; i < 20 && r && !r.top; i++) { await sleep(100); r = await evaluate(where); }
    if (!r || !r.top) return { missing: true, hit: 0, blurs: 0, landed: r ? '(control covered at its centre)' : '(control not on screen)' };
    await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
    await sleep(40);
    await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    return evaluate(`(() => ({ ...window.__g, active: document.activeElement?.id || document.activeElement?.tagName, kbd: document.body.hasAttribute('data-keyboard-up') }))()`);
  };
  const setDraft = (id, text) => evaluate(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(text)};
    i.setSelectionRange(i.value.length, i.value.length); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const lastBody = () => evaluate(`(() => { const b = [...document.querySelectorAll('#chat-scroll .chat-msg .chat-bubble')].pop(); return b ? b.textContent.trim() : ''; })()`);
  const fmt = g => `click landed on "${g.landed}", hit ${g.hit}; at the click: focus "${g.atClick?.active}", keyboard-up ${g.atClick?.kbd}, composer blurs ${g.atClick?.blurs}; after: focus "${g.active}", keyboard-up ${g.kbd}, composer blurs ${g.blurs}`;
  // A CONFIRMED reaction by ANOTHER player (Brayden, server ts + seq) on the
  // newest message, folded through the app's own js/chat.js; the tap then adds
  // MY vote to that pill (count 1→2, .me). Toggling my OWN reaction off is not
  // observable here: an optimistic op carries stamp {0,0} and chat.js's latest-
  // wins fold keeps the earlier op until the server echo — local mode never acks.
  const seedReaction = (scrollSel) => evaluate(`(async () => { const chat = await import('./js/chat.js');
    const m = [...document.querySelectorAll('${scrollSel} .chat-msg[data-mid]')].pop(); const em = m.querySelector('[data-quick-react]').dataset.emoji;
    window.__gSeq = (window.__gSeq || 9000) + 1;
    chat.ingest([{ id: 'gr' + window.__gSeq, seq: window.__gSeq, ts: Date.now(), type: 'react', author: 'p2', gameTag: '', body: '', replyTo: '', notify: false, meta: { emoji: em }, targetId: m.dataset.mid }]);
    return { mid: m.dataset.mid, em }; })()`);
  const pillState = (scrollSel, r) => evaluate(`(() => { const p = document.querySelector('${scrollSel} .chat-msg[data-mid="${r.mid}"] [data-react="${r.em}"]');
    return p ? { me: p.classList.contains('me'), n: parseInt(p.textContent.replace(/\\D+/g, ' ').trim().split(' ').pop(), 10) } : null; })()`);
  // The draft-keeping controls below repaint the page (renderChatPage() rebuilds
  // the composer; RG-174 carries the draft AND the focus across). Reported, not
  // asserted: whether body[data-keyboard-up] survives that repaint. In Chromium
  // the removal of the focused textarea fires focusout, bindKeyboardAvoid() drops
  // the flag, and the re-focus re-baselines at the shrunken height — a separate
  // mechanism from the tap (see the RG-296 report).
  const repaintNote = (tag, g) => console.log(`   (${tag} diagnostic — after the repaint: keyboard-up ${g.kbd}, composer blurs ${g.blurs} (at the click ${g.atClick?.blurs}))`);
  // The TAP kept the composer: at the moment the click was dispatched the
  // composer was still focused, never blurred, and the layout had not moved.
  const tapKept = (g, id = 'chat-input') => g.hit >= 1 && g.atClick && g.atClick.active === id && g.atClick.kbd === true && g.atClick.blurs === 0;
  const toChat = async () => { await evaluate(`window.navigateTo('chat')`); await sleep(400); await bottomOut(); };
  const resetKbd = async () => { await evaluate(`document.activeElement?.blur?.()`); await viewport(390, 844); await waitFor(`!document.body.hasAttribute('data-keyboard-up')`, 3000); };

  // ── G-1: ➤ Send, mid-typing ────────────────────────────────────────────────
  await resetKbd();
  await toChat();
  assert(await raiseKeyboard(), 'G-1-0: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'sweep send one');
  let g = await tapSel('#chat-send');
  const g1Last = await lastBody();
  assert(g.hit >= 1 && g1Last === 'sweep send one', `G-1a: THE BUG — a tap on ➤ with the keyboard up delivers the click and SENDS the message (last message "${g1Last}"; ${fmt(g)})`);
  assert(tapKept(g), `G-1b: THE BUG — …because the tap never takes focus off the composer: still focused and keyboard-up still set when the click is dispatched (${fmt(g)})`);
  // NOT asserted here, reported: after the send, renderChatPage() rebuilds the
  // composer, and RG-174 restores focus only for a NON-EMPTY draft, so the
  // fresh (empty) composer is unfocused after every send — a separate,
  // pre-existing mechanism (the send's own repaint, not the tap).
  console.log(`   (G-1 diagnostic — after the send's own repaint: focus "${g.active}", keyboard-up ${g.kbd})`);
  // Keyboard-only desktop user: ➤ is still focusable and Enter on it still sends.
  await resetKbd();
  await toChat();
  await evaluate(`(() => { const i = document.getElementById('chat-input'); i.value = 'sweep send two'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('chat-send').focus(); })()`);
  const sendFocusable = await evaluate(`document.activeElement?.id === 'chat-send'`);
  await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(400);
  assert(sendFocusable && (await lastBody()) === 'sweep send two', `G-1d: ➤ is still keyboard-focusable (${sendFocusable}) and Enter on it sends (last "${await lastBody()}")`);

  // ── G-2: @mention menu option ──────────────────────────────────────────────
  await resetKbd();
  await toChat();
  assert(await raiseKeyboard(), 'G-2-0: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'hey @Bra');
  assert(await waitFor(`document.getElementById('chat-mention-menu')?.style.display === 'flex' && document.querySelector('[data-mention="Brayden"]')`, 2000), 'G-2-1: fixture — typing "@Bra" opens the mention menu with Brayden in it');
  g = await tapSel('[data-mention="Brayden"]');
  const g2val = await evaluate(`document.getElementById('chat-input')?.value`);
  const g2tab = await evaluate(`document.body.dataset.tab`);
  assert(g.hit >= 1 && g2val === 'hey @Brayden ' && g2tab === 'chat', `G-2a: THE BUG — a tap on the @Brayden option lands and completes the mention, and the app stays on Chat (composer "${g2val}", tab "${g2tab}"; ${fmt(g)})`);
  assert(tapKept(g), `G-2b: THE BUG — …the tap never takes focus off the composer (${fmt(g)})`);
  assert(g.blurs === 0 && g.active === 'chat-input' && g.kbd === true,
    `G-2c: …and no blur → re-focus bounce afterwards either: the composer never blurred, is focused, keyboard-up still set (${fmt(g)})`);
  assert(await evaluate(`(() => { const i = document.getElementById('chat-input'); return i.selectionStart === i.value.length; })()`),
    'G-2d: …with the caret after the inserted mention, ready to keep typing');

  // ── G-3: reply-target ✕ ────────────────────────────────────────────────────
  await resetKbd();
  await toChat();
  await evaluate(`document.querySelectorAll('#chat-scroll [data-reply]')[document.querySelectorAll('#chat-scroll [data-reply]').length - 2].click()`);
  await sleep(300);
  assert(await evaluate(`!!document.getElementById('chat-cancel-reply')`), 'G-3-0: fixture — replying to a message, the reply banner with its ✕ is showing');
  await resetKbd();
  assert(await raiseKeyboard(), 'G-3-1: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a reply');
  g = await tapSel('#chat-cancel-reply');
  const g3 = await evaluate(`({ banner: !!document.getElementById('chat-cancel-reply'), val: document.getElementById('chat-input')?.value })`);
  assert(g.hit >= 1 && !g3.banner && tapKept(g), `G-3a: a tap on the reply ✕ lands, cancels the reply, and never takes focus off the composer (banner still up: ${g3.banner}; ${fmt(g)})`);
  assert(g.active === 'chat-input' && g3.val === 'draft under a reply',
    `G-3b: …the draft stays and the composer is focused after the repaint (draft "${g3.val}"; ${fmt(g)})`);
  repaintNote('G-3', g);
  await evaluate(`document.getElementById('chat-cancel-reply')?.click()`);   // never leak an open reply into the next case

  // ── G-4: reaction pill (tap-to-vote) on the newest message ─────────────────
  await resetKbd();
  await toChat();
  await evaluate(`document.getElementById('chat-input').value = ''`);
  const r4 = await seedReaction('#chat-scroll');
  await sleep(300);
  await bottomOut();
  const p4 = await pillState('#chat-scroll', r4);
  assert(p4 && !p4.me && p4.n === 1, `G-4-0: fixture — the newest message carries Brayden's ${r4.em} (pill ${JSON.stringify(p4)})`);
  assert(await raiseKeyboard(), 'G-4-1: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a react');
  await bottomOut();
  await evaluate(`document.querySelector('#chat-scroll .chat-msg[data-mid="${r4.mid}"] [data-react="${r4.em}"]').id = 'g4-pill'`);
  g = await tapSel('#g4-pill');
  const p4b = await pillState('#chat-scroll', r4);
  const g4 = await evaluate(`({ val: document.getElementById('chat-input')?.value })`);
  assert(g.hit >= 1 && p4b?.me && p4b.n === 2 && tapKept(g), `G-4a: THE BUG — a tap on the reaction pill lands, adds my vote, and never takes focus off the composer (pill ${JSON.stringify(p4)}→${JSON.stringify(p4b)}; ${fmt(g)})`);
  assert(g.active === 'chat-input' && g4.val === 'draft under a react',
    `G-4b: …the draft stays and the composer is focused after the repaint (draft "${g4.val}"; ${fmt(g)})`);
  repaintNote('G-4', g);

  // ── G-5: the per-message ➕ (more reactions) and a reaction-picker option ─
  await resetKbd();
  await toChat();
  await evaluate(`document.getElementById('chat-input').value = ''`);
  await bottomOut();
  assert(await raiseKeyboard(), 'G-5-0: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a picker');
  await bottomOut();
  // Diagnostic only (reported, not asserted — the long-press binder is gesture
  // code outside this sweep): a real long-press on the newest message with
  // the keyboard up. In Chromium the release is a tap whose mousedown blurs
  // the composer, so the reveal it just made is undone on release.
  const lp = await evaluate(`(() => { const m = [...document.querySelectorAll('#chat-scroll .chat-msg .chat-bubble')].pop(); const b = m.getBoundingClientRect(); return { x: Math.round(b.left + 20), y: Math.round(b.top + b.height / 2) }; })()`);
  await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [lp] });
  await sleep(420);
  const lpHeld = await evaluate(`!!document.querySelector('#chat-scroll .chat-msg.chat-actions-revealed')`);
  await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const lpAfter = await evaluate(`({ rev: !!document.querySelector('#chat-scroll .chat-msg.chat-actions-revealed'), a: document.activeElement?.id || document.activeElement?.tagName, k: document.body.hasAttribute('data-keyboard-up') })`);
  console.log(`   (G-5 diagnostic — long-press with the keyboard up: revealed while held ${lpHeld}; after release revealed ${lpAfter.rev}, focus "${lpAfter.a}", keyboard-up ${lpAfter.k})`);
  // Fixture: reveal through the REAL revealMessageActions() (same module
  // instance the app uses), composer focused, keyboard up.
  await resetKbd();
  await toChat();
  assert(await raiseKeyboard(), 'G-5-0b: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a picker');
  await bottomOut();
  await sleep(250);   // let the scroll event land first — scrolling dismisses a reveal (DI-120a)
  await evaluate(`(async () => { const ui = await import('./js/chat-ui.js'); const m = [...document.querySelectorAll('#chat-scroll .chat-msg[data-mid]')].pop(); ui._revealMessageActions(m.dataset.mid, 'chat-scroll'); })()`);
  await sleep(150);
  const revealed = await evaluate(`!!document.querySelector('#chat-scroll .chat-msg.chat-actions-revealed [data-react-open]')`);
  assert(revealed && await evaluate(`document.activeElement?.id === 'chat-input' && document.body.hasAttribute('data-keyboard-up')`),
    `G-5-1: fixture — the newest message's actions are revealed with the composer still focused (revealed ${revealed})`);
  g = await tapSel('#chat-scroll .chat-msg.chat-actions-revealed [data-react-open]');
  const pickerUp = await evaluate(`!!document.getElementById('chat-react-picker')`);
  assert(g.hit >= 1 && pickerUp && tapKept(g), `G-5a: a tap on ➕ lands, opens the reaction picker, and never takes focus off the composer (picker ${pickerUp}; ${fmt(g)})`);
  assert(g.blurs === 0 && g.kbd === true && g.active === 'chat-input', `G-5b: …the composer is still focused afterwards, body[data-keyboard-up] unchanged (${fmt(g)})`);
  if (pickerUp) {
    const before = await evaluate(`document.querySelectorAll('#chat-scroll [data-react]').length`);
    await evaluate(`(() => { const m = document.querySelector('#chat-scroll .chat-msg.chat-actions-revealed'); const have = m ? [...m.querySelectorAll('[data-react]')].map(p => p.dataset.react) : [];
      const o = [...document.querySelectorAll('#chat-react-picker [data-emoji]')].find(b => !have.includes(b.dataset.emoji)); if (o) o.id = 'g5-opt'; })()`);
    g = await tapSel('#g5-opt');
    const g5 = await evaluate(`({ pills: document.querySelectorAll('#chat-scroll [data-react]').length, val: document.getElementById('chat-input')?.value, picker: !!document.getElementById('chat-react-picker') })`);
    assert(g.hit >= 1 && g5.pills === before + 1 && !g5.picker && tapKept(g), `G-5c: a tap on a picker emoji lands, adds the reaction, closes the picker, and never takes focus off the composer (pills ${before}→${g5.pills}; ${fmt(g)})`);
    assert(g.active === 'chat-input' && g5.val === 'draft under a picker',
      `G-5d: …the draft stays and the composer is focused after the repaint (draft "${g5.val}"; ${fmt(g)})`);
    repaintNote('G-5c', g);
  } else {
    assert(false, 'G-5c: (picker never opened — cannot tap an option)');
    assert(false, 'G-5d: (picker never opened — cannot tap an option)');
  }
  // The Tapback-style quick-react row beside ➕ (DI-326) — same row, same reaction.
  await resetKbd();
  await toChat();
  assert(await raiseKeyboard(), 'G-5-2: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a quick react');
  await bottomOut();
  await sleep(250);   // let the scroll event land first — scrolling dismisses a reveal (DI-120a)
  await evaluate(`(async () => { const ui = await import('./js/chat-ui.js'); const m = [...document.querySelectorAll('#chat-scroll .chat-msg[data-mid]')].pop(); ui._revealMessageActions(m.dataset.mid, 'chat-scroll'); })()`);
  await sleep(150);
  const qBefore = await evaluate(`document.querySelectorAll('#chat-scroll [data-react]').length`);
  await evaluate(`(() => { const m = document.querySelector('#chat-scroll .chat-msg.chat-actions-revealed'); if (!m) return; const have = [...m.querySelectorAll('[data-react]')].map(p => p.dataset.react);
    const q = [...m.querySelectorAll('[data-quick-react]')].find(b => !have.includes(b.dataset.emoji)); if (q) q.id = 'g5-quick'; })()`);
  g = await tapSel('#g5-quick');
  const g5q = await evaluate(`({ pills: document.querySelectorAll('#chat-scroll [data-react]').length, val: document.getElementById('chat-input')?.value })`);
  assert(g.hit >= 1 && g5q.pills === qBefore + 1 && tapKept(g), `G-5e: a tap on a quick-react lands, adds the reaction, and never takes focus off the composer (pills ${qBefore}→${g5q.pills}; ${fmt(g)})`);
  assert(g.active === 'chat-input' && g5q.val === 'draft under a quick react',
    `G-5f: …the draft stays and the composer is focused after the repaint (draft "${g5q.val}"; ${fmt(g)})`);
  repaintNote('G-5e', g);

  // ── G-6: ➤ Send in the game-chat sheet ────────────────────────────────────
  await resetKbd();
  await evaluate(`document.getElementById('chat-input').value = ''`);
  const gid = await evaluate(`(async () => { const st = await import('./js/storage.js'); const ui = await import('./js/chat-ui.js');
    const g = st.getGames?.(st.getActiveWeekId?.())?.[0] || Object.values(st.load?.('cfbp_games') || {})[0]; ui.openGameChatSheet(g.gameId); return g.gameId; })()`);
  assert(await waitFor(`document.getElementById('chat-sheet-input') && document.getElementById('chat-sheet-send')`, 3000), `G-6-0: fixture — the game-chat sheet is open with its composer (game ${gid})`);
  await sleep(400);
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  await evaluate(`document.getElementById('chat-sheet-input').focus()`);
  await sleep(100);
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 508, deviceScaleFactor: 1, mobile: true });
  assert(await waitFor(`document.body.hasAttribute('data-keyboard-up') && document.activeElement?.id === 'chat-sheet-input'`, 3000), 'G-6-1: fixture — sheet composer focused, keyboard up');
  await setDraft('chat-sheet-input', 'sweep sheet send');
  g = await tapSel('#chat-sheet-send');
  const sheetLast = await evaluate(`(() => { const b = [...document.querySelectorAll('#chat-sheet-scroll .chat-msg .chat-bubble')].pop(); return b ? b.textContent.trim() : ''; })()`);
  assert(g.hit >= 1 && sheetLast === 'sweep sheet send', `G-6a: a tap on the sheet's ➤ with the keyboard up delivers the click and sends (last "${sheetLast}"; ${fmt(g)})`);
  assert(tapKept(g, 'chat-sheet-input'), `G-6b: …and the tap never takes focus off the sheet composer (${fmt(g)})`);
  console.log(`   (G-6 diagnostic — after the sheet send's own composer repaint: focus "${g.active}", keyboard-up ${g.kbd})`);
  // The sheet's reaction pill (tap-to-vote, renderSheetMessages' [data-react]).
  const r6 = await seedReaction('#chat-sheet-scroll');
  await sleep(300);
  const p6 = await pillState('#chat-sheet-scroll', r6);
  assert(p6 && !p6.me && p6.n === 1, `G-6-2: fixture — the sheet's newest message carries Brayden's ${r6.em} (pill ${JSON.stringify(p6)})`);
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  await evaluate(`document.getElementById('chat-sheet-input').focus()`);
  await sleep(100);
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 508, deviceScaleFactor: 1, mobile: true });
  assert(await waitFor(`document.body.hasAttribute('data-keyboard-up') && document.activeElement?.id === 'chat-sheet-input'`, 3000), 'G-6-3: fixture — sheet composer focused, keyboard up');
  await setDraft('chat-sheet-input', 'sheet draft under a react');
  await evaluate(`(() => { const p = document.querySelector('#chat-sheet-scroll .chat-msg[data-mid="${r6.mid}"] [data-react="${r6.em}"]'); p.id = 'g6-pill'; p.scrollIntoView({ block: 'center' }); })()`);
  await sleep(250);
  g = await tapSel('#g6-pill');
  const p6b = await pillState('#chat-sheet-scroll', r6);
  const g6p = await evaluate(`({ val: document.getElementById('chat-sheet-input')?.value })`);
  assert(g.hit >= 1 && p6b?.me && p6b.n === 2 && tapKept(g, 'chat-sheet-input'),
    `G-6c: a tap on the reaction pill in the sheet lands, adds my vote, and never takes focus off the sheet composer (pill ${JSON.stringify(p6)}→${JSON.stringify(p6b)}; ${fmt(g)})`);
  assert(g.kbd === true && g.active === 'chat-sheet-input' && g6p.val === 'sheet draft under a react',
    `G-6d: …the sheet composer is still focused with its draft afterwards, body[data-keyboard-up] unchanged (draft "${g6p.val}"; ${fmt(g)})`);
  await evaluate(`document.getElementById('chat-sheet-wrap')?.remove()`);

  // ── G-7: the game-tag chip's ✕ (the composer's other ✕) ────────────────────
  await resetKbd();
  await toChat();
  const gamePill = await evaluate(`(() => { const p = [...document.querySelectorAll('#page-chat [data-chat-filter]')].find(b => !['all', 'records', 'mentions'].includes(b.dataset.chatFilter)); if (!p) return null; p.click(); return p.dataset.chatFilter; })()`);
  await sleep(300);
  assert(gamePill && await evaluate(`!!document.getElementById('chat-strip-tag')`), `G-7-0: fixture — in a game's room (${gamePill}) the composer carries the game-tag chip with its ✕`);
  assert(await raiseKeyboard(), 'G-7-1: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a tag');
  g = await tapSel('#chat-strip-tag');
  const g7 = await evaluate(`({ chip: !!document.getElementById('chat-strip-tag'), val: document.getElementById('chat-input')?.value })`);
  assert(g.hit >= 1 && !g7.chip && tapKept(g), `G-7a: a tap on the tag chip's ✕ lands, strips the tag, and never takes focus off the composer (chip still up: ${g7.chip}; ${fmt(g)})`);
  assert(g.active === 'chat-input' && g7.val === 'draft under a tag',
    `G-7b: …the draft stays and the composer is focused after the repaint (draft "${g7.val}"; ${fmt(g)})`);
  repaintNote('G-7', g);
  await resetKbd();
  await evaluate(`(() => { document.getElementById('chat-input').value = ''; document.querySelector('#page-chat [data-chat-filter="all"]')?.click(); })()`);
  await sleep(200);

  // ── G-9…G-12: the controls the RG-296 sweep missed (reviewer finding 1) ────
  // RG-297 (2026-09-28): ↩ reply, 🏛 pin, 📎 callout and ⟳ retry were still
  // plain buttons — the same mousedown focus move, the same layout jump, the
  // same click landing on an ancestor. Each measured exactly as G-1…G-7 are.
  // Where the control repaints the page, (b) also asserts the keyboard-up flag
  // SURVIVES the repaint (RG-297 — the composer is no longer destroyed).
  const revealLast = (scrollId, midSel = '') => evaluate(`(async () => { const ui = await import('./js/chat-ui.js');
    const all = [...document.querySelectorAll('#${scrollId} .chat-msg[data-mid]${midSel}')]; const m = all.pop(); if (!m) return null;
    m.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 250));
    ui._revealMessageActions(m.dataset.mid, '${scrollId}'); return m.dataset.mid; })()`);
  const afterRepaintKept = (g, id = 'chat-input') => g.active === id && g.kbd === true && g.blurs === 0;

  // ── G-9: ↩ reply on a message, main feed ───────────────────────────────────
  await resetKbd();
  await toChat();
  await evaluate(`document.getElementById('chat-input').value = ''`);
  assert(await raiseKeyboard(), 'G-9-0: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a reply tap');
  await bottomOut();
  await sleep(250);
  const r9 = await revealLast('chat-scroll');
  await sleep(150);
  assert(!!r9 && await evaluate(`!!document.querySelector('#chat-scroll .chat-msg.chat-actions-revealed [data-reply]')`), `G-9-1: fixture — the newest message's ↩ is revealed (message ${r9})`);
  g = await tapSel('#chat-scroll .chat-msg.chat-actions-revealed [data-reply]');
  const g9 = await evaluate(`({ banner: !!document.getElementById('chat-cancel-reply'), val: document.getElementById('chat-input')?.value })`);
  assert(g.hit >= 1 && g9.banner && tapKept(g), `G-9a: THE BUG — a tap on ↩ lands, opens the reply, and never takes focus off the composer (reply banner ${g9.banner}; ${fmt(g)})`);
  assert(afterRepaintKept(g) && g9.val === 'draft under a reply tap',
    `G-9b: …the draft stays, the composer is focused and body[data-keyboard-up] survives the reply repaint (draft "${g9.val}"; ${fmt(g)})`);
  await evaluate(`document.getElementById('chat-cancel-reply')?.click()`);   // never leak an open reply into the next case

  // ── G-10: 🏛 pin ────────────────────────────────────────────────────────────
  await resetKbd();
  await toChat();
  await evaluate(`document.getElementById('chat-input').value = ''`);
  assert(await raiseKeyboard(), 'G-10-0: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a pin');
  await bottomOut();
  await sleep(250);
  const r10 = await revealLast('chat-scroll');
  await sleep(150);
  g = await tapSel('#chat-scroll .chat-msg.chat-actions-revealed [data-pin]');
  const g10 = await evaluate(`({ val: document.getElementById('chat-input')?.value, pinned: !!document.querySelector('#chat-scroll .chat-msg[data-mid="${r10}"] .chat-pinned') })`);
  assert(g.hit >= 1 && tapKept(g), `G-10a: THE BUG — a tap on 🏛 lands and never takes focus off the composer (pinned marker ${g10.pinned}; ${fmt(g)})`);
  assert(afterRepaintKept(g) && g10.val === 'draft under a pin',
    `G-10b: …the draft stays, the composer is focused and body[data-keyboard-up] survives the repaint (draft "${g10.val}"; ${fmt(g)})`);

  // ── G-11: 📎 callout — needs a tagged pre-kick message whose author lost ATS
  // in a FINAL game of a public week. A separate FINAL week, so the open
  // week's Picks page ([E]) is untouched.
  await resetKbd();
  const co = await evaluate(`(async () => { const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js'); const chat = await import('./js/chat.js');
    const wk = dm.createWeek(2026, 4); wk.status = 'final'; st.saveWeek(wk);
    const kick = Date.now() - 86400000;
    const gm = dm.createGame(wk.weekId, { homeTeam: 'Callout Home', awayTeam: 'Callout Away', kickoff: new Date(kick).toISOString(), spread: -3.5 });
    gm.status = 'final'; gm.homeScore = 30; gm.awayScore = 10; st.saveGame(gm);
    st.saveAllPicks([dm.createPick(wk.weekId, gm.gameId, 'p2', 'Callout Away')]);
    chat.ingest([{ id: 'co9801', seq: 9801, ts: kick - 86400000, type: 'message', author: 'p2', gameTag: gm.gameId, body: 'callout home will not cover', replyTo: '', notify: true, meta: null, targetId: '' }]);
    return gm.gameId; })()`);
  await toChat();
  await evaluate(`document.getElementById('chat-input').value = ''`);
  assert(await raiseKeyboard(), 'G-11-0: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a callout');
  await revealLast('chat-scroll', '[data-mid="co9801"]');
  await sleep(150);
  assert(await evaluate(`!!document.querySelector('#chat-scroll .chat-msg.chat-actions-revealed [data-callout]')`), `G-11-1: fixture — the losing pick's pre-kick message carries a revealed 📎 (game ${co})`);
  const before11 = await evaluate(`document.querySelectorAll('#chat-scroll .chat-msg[data-mid]').length`);
  g = await tapSel('#chat-scroll .chat-msg.chat-actions-revealed [data-callout]');
  const g11 = await evaluate(`({ val: document.getElementById('chat-input')?.value, n: document.querySelectorAll('#chat-scroll .chat-msg[data-mid]').length })`);
  assert(g.hit >= 1 && g11.n === before11 + 1 && tapKept(g), `G-11a: THE BUG — a tap on 📎 lands, posts the callout, and never takes focus off the composer (messages ${before11}→${g11.n}; ${fmt(g)})`);
  assert(afterRepaintKept(g) && g11.val === 'draft under a callout',
    `G-11b: …the draft stays, the composer is focused and body[data-keyboard-up] survives the repaint (draft "${g11.val}"; ${fmt(g)})`);

  // ── G-12: ⟳ retry on a FAILED send, main feed ──────────────────────────────
  await resetKbd();
  await toChat();
  await setDraft('chat-input', 'this one will fail');
  await evaluate(`document.getElementById('chat-send').click()`);
  await sleep(200);
  const f12 = await evaluate(`(async () => { const chat = await import('./js/chat.js'); const ui = await import('./js/chat-ui.js');
    const m = [...document.querySelectorAll('#chat-scroll .chat-msg.is-pending[data-mid]')].pop(); if (!m) return null;
    const ok = chat._markFailedForTest(m.dataset.mid); ui.renderChatPage(); return ok ? m.dataset.mid : null; })()`);
  await bottomOut();
  assert(!!f12 && await evaluate(`!!document.querySelector('#chat-scroll [data-retry="${f12}"]')`), `G-12-0: fixture — my send is on the FAILED path with its retry button showing (${f12})`);
  assert(await raiseKeyboard(), 'G-12-1: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'draft under a retry');
  await bottomOut();
  g = await tapSel(`#chat-scroll [data-retry="${f12}"]`);
  const g12 = await evaluate(`({ val: document.getElementById('chat-input')?.value, still: !!document.querySelector('#chat-scroll [data-retry="${f12}"]') })`);
  assert(g.hit >= 1 && !g12.still && tapKept(g), `G-12a: THE BUG — a tap on retry lands, re-queues the send, and never takes focus off the composer (retry still showing ${g12.still}; ${fmt(g)})`);
  assert(afterRepaintKept(g) && g12.val === 'draft under a retry',
    `G-12b: …the draft stays, the composer is focused and body[data-keyboard-up] survives the repaint (draft "${g12.val}"; ${fmt(g)})`);
  await resetKbd();
  await evaluate(`document.getElementById('chat-input').value = ''`);

  // ── G-8: "↓ latest" press feedback (reviewer note on RG-291) ───────────────
  // Every other button carries the :active{transform:scale(.97)} press
  // feedback (.btn, .nav-item, .pick-btn, .chat-quick-react-btn…); the
  // "↓ latest" pill did not. Measured with the engine's own :active state.
  await toChat();
  assert(await scrollUpForJump(), 'G-8-0: fixture — scrolled up, "↓ latest" showing');
  await pg.send('DOM.enable');
  await pg.send('CSS.enable');
  const { root: domRoot } = await pg.send('DOM.getDocument', { depth: 1 });
  const { nodeId: jumpNode } = await pg.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector: '#chat-jump' });
  const restT = await evaluate(`getComputedStyle(document.getElementById('chat-jump')).transform`);
  await pg.send('CSS.forcePseudoState', { nodeId: jumpNode, forcedPseudoClasses: ['active'] });
  await sleep(300);   // RG-297 — the press now EASES in over --motion-fast; read where it settles
  const pressT = await evaluate(`getComputedStyle(document.getElementById('chat-jump')).transform`);
  await pg.send('CSS.forcePseudoState', { nodeId: jumpNode, forcedPseudoClasses: [] });
  await sleep(300);
  assert(restT === 'none' && pressT === 'matrix(0.97, 0, 0, 0.97, 0, 0)',
    `G-8: "↓ latest" gives the same scale(.97) press feedback as every other button (at rest "${restT}", pressed "${pressT}")`);
  // RG-297 polish (RG-296 review F) — the press animates like every sibling
  // (.chat-quick-react-btn: transform over --motion-fast, ease-out), and ➤
  // Send gets the same press feedback it never had.
  const tr = sel => evaluate(`(() => { const cs = getComputedStyle(document.querySelector(${JSON.stringify(sel)})); return { p: cs.transitionProperty, d: cs.transitionDuration, f: cs.transitionTimingFunction }; })()`);
  const jt = await tr('#chat-jump');
  assert(/\btransform\b/.test(jt.p) && jt.d.split(',')[jt.p.split(',').map(x => x.trim()).indexOf('transform')]?.trim() === '0.15s' && /ease-out/.test(jt.f),
    `G-8b: "↓ latest" animates its press — transform over 150ms ease-out at rest, so press AND release ease (property "${jt.p}", duration "${jt.d}", easing "${jt.f}")`);
  const { nodeId: sendNode } = await pg.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector: '#chat-send' });
  const sendRest = await evaluate(`getComputedStyle(document.getElementById('chat-send')).transform`);
  await pg.send('CSS.forcePseudoState', { nodeId: sendNode, forcedPseudoClasses: ['active'] });
  await sleep(300);
  const sendPress = await evaluate(`getComputedStyle(document.getElementById('chat-send')).transform`);
  await pg.send('CSS.forcePseudoState', { nodeId: sendNode, forcedPseudoClasses: [] });
  const st8 = await tr('#chat-send');
  assert(sendRest === 'none' && sendPress === 'matrix(0.97, 0, 0, 0.97, 0, 0)' && /\btransform\b/.test(st8.p) && /ease-out/.test(st8.f),
    `G-8c: ➤ Send gives the same scale(.97) press feedback, eased (at rest "${sendRest}", pressed "${sendPress}", transition "${st8.p}" ${st8.d} ${st8.f})`);
  await pg.send('CSS.disable').catch(() => {});
  await bottomOut();

  await resetKbd();

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[H] RG-297 — a repaint never takes the keyboard down: send, an inbound message, the game sheet, and a sheet reply…');
  // ═════════════════════════════════════════════════════════════════════════
  // RG-296 review (2026-09-28). B: the keyboard dropped after EVERY send —
  // the send's own repaint rebuilt an empty composer, and RG-174's capture
  // returns null for an empty one, so "was focused" was thrown away; the
  // sheet's send swapped its composer's outerHTML with no capture at all.
  // A: when a FOCUSED composer was rebuilt, removing it fired focusout,
  // bindKeyboardAvoid() cleared body[data-keyboard-up], and the re-focus
  // re-baselined at the already-shrunken height — so the nav clearance came
  // back above a raised keyboard. E: starting or cancelling a reply in the
  // game sheet wiped a typed draft (the sheet had no RG-174 at all).
  // Every case asserts ALL of: focus, the flag, the draft, and that the
  // composer never blurred (a blur → re-focus is the iOS keyboard bounce) —
  // a test that checked focus alone would pass a mutant that re-focuses and
  // loses the flag. The composer must also not move on screen.
  const H = (id) => `(() => { const i = document.getElementById('${id}'); const c = i?.closest('.chat-composer'); const r = c?.getBoundingClientRect();
    return { active: document.activeElement?.id || document.activeElement?.tagName, kbd: document.body.hasAttribute('data-keyboard-up'),
      val: i?.value ?? null, caret: i ? [i.selectionStart, i.selectionEnd] : null, same: !!i && i === window.__hNode, blurs: window.__g?.blurs ?? -1,
      compB: r ? Math.round(r.bottom) : null, compT: r ? Math.round(r.top) : null }; })()`;
  const markNode = (id) => evaluate(`(() => { window.__hNode = document.getElementById('${id}'); })()`);
  const hFmt = h => `focus "${h.active}", keyboard-up ${h.kbd}, draft "${h.val}", composer blurs ${h.blurs}, same textarea ${h.same}, composer ${h.compT}…${h.compB}`;
  const kept = (h, id) => h.active === id && h.kbd === true && h.blurs === 0;

  // ── H-1: ➤ Send with the keyboard up (main feed) ──────────────────────────
  await resetKbd();
  await toChat();
  await evaluate(`document.getElementById('chat-input').value = ''`);
  assert(await raiseKeyboard(), 'H-1-0: fixture — composer focused, keyboard up');
  await bottomOut();
  await setDraft('chat-input', 'rg297 send keeps the keyboard');
  await markNode('chat-input');
  let h0 = await evaluate(H('chat-input'));
  g = await tapSel('#chat-send');
  let h = await evaluate(H('chat-input'));
  const myLast = () => evaluate(`(() => { const b = [...document.querySelectorAll('#chat-scroll .chat-msg.chat-mine .chat-bubble')].pop(); return b ? b.textContent.trim() : ''; })()`);
  assert(g.hit >= 1 && (await myLast()) === 'rg297 send keeps the keyboard' && h.val === '',
    `H-1a: fixture — the tap sent the message and emptied the composer (my last "${await myLast()}", composer "${h.val}")`);
  assert(kept(h, 'chat-input'), `H-1b: THE BUG (B + A) — after a send the composer is STILL focused, body[data-keyboard-up] is still set, and it never blurred (${hFmt(h)})`);
  assert(h.compB === h0.compB, `H-1c: THE BUG (A) — the composer did not move after the send: no nav clearance above the keyboard (bottom ${h0.compB}→${h.compB})`);
  assert(h.same, `H-1d: …because it is the SAME textarea element — the repaint moved the page around it instead of rebuilding it (${hFmt(h)})`);

  // Each case below starts from its OWN precondition (composer focused, the
  // keyboard up) rather than inheriting the previous case's end state.
  const ensureUp = async () => (await evaluate(`document.body.hasAttribute('data-keyboard-up') && document.activeElement?.id === 'chat-input'`)) || raiseKeyboard();

  // ── H-2: an inbound message lands while typing (the RG-174 trigger) ───────
  assert(await ensureUp(), 'H-2-f: fixture — composer focused, keyboard up');
  await setDraft('chat-input', 'typing while brayden posts');
  await evaluate(`(() => { const i = document.getElementById('chat-input'); i.setSelectionRange(6, 6); })()`);
  await markNode('chat-input');
  await evaluate(G_REC);
  h0 = await evaluate(H('chat-input'));
  const scrollBefore = await evaluate(`(() => { window.__hScroll = document.getElementById('chat-scroll'); return true; })()`);
  await evaluate(`(async () => { const chat = await import('./js/chat.js');
    chat.ingest([{ id: 'h9901', seq: 9901, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: 'inbound during a draft', replyTo: '', notify: true, meta: null, targetId: '' }]); })()`);
  await sleep(400);
  h = await evaluate(H('chat-input'));
  const repainted = await evaluate(`document.getElementById('chat-scroll') !== window.__hScroll`);
  assert(scrollBefore && repainted && (await lastBody()) === 'inbound during a draft', `H-2-0: fixture — the inbound message arrived and renderChatPage() really repainted the page (new thread node ${repainted})`);
  assert(kept(h, 'chat-input') && h.val === 'typing while brayden posts' && h.caret?.[0] === 6 && h.caret?.[1] === 6,
    `H-2a: THE BUG (A) — an inbound repaint keeps focus, the keyboard-up flag, the draft AND the caret, with no blur (${hFmt(h)}, caret ${JSON.stringify(h.caret)})`);
  assert(h.compB === h0.compB && h.same, `H-2b: …and the composer never moved (bottom ${h0.compB}→${h.compB}; same textarea ${h.same})`);

  // ── H-3: an inbound message while focused with NOTHING typed ─────────────
  assert(await ensureUp(), 'H-3-f: fixture — composer focused, keyboard up');
  await setDraft('chat-input', '');
  await evaluate(G_REC);
  await evaluate(`(async () => { const chat = await import('./js/chat.js');
    chat.ingest([{ id: 'h9902', seq: 9902, ts: Date.now(), type: 'message', author: 'p3', gameTag: '', body: 'inbound on an empty composer', replyTo: '', notify: true, meta: null, targetId: '' }]); })()`);
  await sleep(400);
  h = await evaluate(H('chat-input'));
  assert((await lastBody()) === 'inbound on an empty composer' && kept(h, 'chat-input') && h.val === '',
    `H-3: THE BUG (B) — an EMPTY focused composer keeps focus and the keyboard-up flag through an inbound repaint (RG-174 captured nothing for an empty draft) (${hFmt(h)})`);

  // ── H-4: an UNFOCUSED composer is never focused by a repaint (RG-174 §7) ──
  await resetKbd();
  await toChat();
  await setDraft('chat-input', 'left alone');
  await evaluate(`document.getElementById('chat-input').blur()`);
  await evaluate(`(async () => { const chat = await import('./js/chat.js');
    chat.ingest([{ id: 'h9903', seq: 9903, ts: Date.now(), type: 'message', author: 'p4', gameTag: '', body: 'inbound, composer idle', replyTo: '', notify: true, meta: null, targetId: '' }]); })()`);
  await sleep(400);
  h = await evaluate(H('chat-input'));
  assert(h.active !== 'chat-input' && !h.kbd && h.val === 'left alone',
    `H-4: control — a composer the player was NOT in stays unfocused through a repaint (no keyboard pops up), draft kept (${hFmt(h)})`);
  await evaluate(`document.getElementById('chat-input').value = ''`);

  // ── H-5: ➤ Send in the game sheet with the keyboard up ────────────────────
  await resetKbd();
  const openSheet = async () => {
    await evaluate(`(async () => { const st = await import('./js/storage.js'); const ui = await import('./js/chat-ui.js');
      const g = st.getGames(st.getActiveWeekId())[0]; ui.openGameChatSheet(g.gameId); })()`);
    await waitFor(`document.getElementById('chat-sheet-input')`, 3000);
    await sleep(400);
    await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(150);
    await evaluate(`document.getElementById('chat-sheet-input').focus()`);
    await sleep(100);
    await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 508, deviceScaleFactor: 1, mobile: true });
    return waitFor(`document.body.hasAttribute('data-keyboard-up') && document.activeElement?.id === 'chat-sheet-input'`, 3000);
  };
  assert(await openSheet(), 'H-5-0: fixture — game sheet open, its composer focused, keyboard up');
  await setDraft('chat-sheet-input', 'rg297 sheet send keeps the keyboard');
  await markNode('chat-sheet-input');
  h0 = await evaluate(H('chat-sheet-input'));
  g = await tapSel('#chat-sheet-send');
  h = await evaluate(H('chat-sheet-input'));
  // My newest message (SCRIBE may answer a burst of sends right after it).
  const sheetLastH = await evaluate(`(() => { const b = [...document.querySelectorAll('#chat-sheet-scroll .chat-msg.chat-mine .chat-bubble')].pop(); return b ? b.textContent.trim() : ''; })()`);
  assert(g.hit >= 1 && sheetLastH === 'rg297 sheet send keeps the keyboard' && h.val === '', `H-5a: fixture — the sheet send posted and emptied the composer (last "${sheetLastH}", composer "${h.val}")`);
  assert(kept(h, 'chat-sheet-input'), `H-5b: THE BUG (B) — after a sheet send its composer is still focused, the keyboard-up flag is still set, and it never blurred (${hFmt(h)})`);
  assert(h.compB === h0.compB && h.same, `H-5c: …and the sheet composer did not move or get rebuilt (bottom ${h0.compB}→${h.compB}; same textarea ${h.same})`);

  // ── H-6: E — a typed sheet draft survives ↩ and ✕ (keyboard up, real taps) ─
  await setDraft('chat-sheet-input', 'sheet draft through a reply');
  await markNode('chat-sheet-input');
  const r6h = await revealLast('chat-sheet-scroll');
  await sleep(150);
  assert(!!r6h && await evaluate(`!!document.querySelector('#chat-sheet-scroll .chat-msg.chat-actions-revealed [data-reply]')`), `H-6-0: fixture — a sheet message's ↩ is revealed (${r6h})`);
  g = await tapSel('#chat-sheet-scroll .chat-msg.chat-actions-revealed [data-reply]');
  h = await evaluate(H('chat-sheet-input'));
  const banner6 = await evaluate(`!!document.getElementById('chat-sheet-cancel-reply')`);
  assert(g.hit >= 1 && banner6 && tapKept(g, 'chat-sheet-input'), `H-6a: a tap on ↩ in the sheet lands, opens the reply, and never takes focus off the sheet composer (banner ${banner6}; ${fmt(g)})`);
  assert(h.val === 'sheet draft through a reply' && kept(h, 'chat-sheet-input'),
    `H-6b: THE BUG (E) — starting a reply in the sheet KEEPS the typed draft, focus and the keyboard-up flag (${hFmt(h)})`);
  g = await tapSel('#chat-sheet-cancel-reply');
  h = await evaluate(H('chat-sheet-input'));
  const banner6b = await evaluate(`!!document.getElementById('chat-sheet-cancel-reply')`);
  assert(g.hit >= 1 && !banner6b && tapKept(g, 'chat-sheet-input'), `H-6c: THE BUG (finding 1) — a tap on the sheet reply ✕ lands, cancels, and never takes focus off the sheet composer (banner still up ${banner6b}; ${fmt(g)})`);
  assert(h.val === 'sheet draft through a reply' && kept(h, 'chat-sheet-input') && h.same,
    `H-6d: THE BUG (E) — cancelling the reply KEEPS the typed draft, focus and the keyboard-up flag (${hFmt(h)})`);

  // ── H-7: E with the keyboard DOWN — ↩ / ✕ by click, draft kept ────────────
  await resetKbd();
  await setDraft('chat-sheet-input', 'idle sheet draft');
  await evaluate(`document.getElementById('chat-sheet-input').blur()`);
  await revealLast('chat-sheet-scroll');
  await sleep(150);
  await evaluate(`document.querySelector('#chat-sheet-scroll .chat-msg.chat-actions-revealed [data-reply]')?.click()`);
  await sleep(200);
  const h7a = await evaluate(`({ val: document.getElementById('chat-sheet-input')?.value, banner: !!document.getElementById('chat-sheet-cancel-reply') })`);
  await evaluate(`document.getElementById('chat-sheet-cancel-reply')?.click()`);
  await sleep(200);
  const h7b = await evaluate(`({ val: document.getElementById('chat-sheet-input')?.value, banner: !!document.getElementById('chat-sheet-cancel-reply') })`);
  assert(h7a.banner && h7a.val === 'idle sheet draft' && !h7b.banner && h7b.val === 'idle sheet draft',
    `H-7: THE BUG (E) — keyboard down, ↩ then ✕ in the sheet keep the draft (after ↩ "${h7a.val}" banner ${h7a.banner}; after ✕ "${h7b.val}" banner ${h7b.banner})`);

  // ── H-8: ⟳ retry in the sheet (the other half of finding 1's [data-retry]) ─
  await resetKbd();
  await setDraft('chat-sheet-input', 'this sheet send will fail');
  await evaluate(`document.getElementById('chat-sheet-send').click()`);
  await sleep(200);
  const f8 = await evaluate(`(async () => { const chat = await import('./js/chat.js'); const ui = await import('./js/chat-ui.js');
    const m = [...document.querySelectorAll('#chat-sheet-scroll .chat-msg.is-pending[data-mid]')].pop(); if (!m) return null;
    const ok = chat._markFailedForTest(m.dataset.mid); ui._renderSheetMessagesForTest(ui._getChatSheetGameIdForTest()); return ok ? m.dataset.mid : null; })()`);
  assert(!!f8 && await evaluate(`!!document.querySelector('#chat-sheet-scroll [data-retry="${f8}"]')`), `H-8-0: fixture — a sheet send is on the FAILED path with its retry showing (${f8})`);
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  await evaluate(`document.getElementById('chat-sheet-input').focus()`);
  await sleep(100);
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 508, deviceScaleFactor: 1, mobile: true });
  assert(await waitFor(`document.body.hasAttribute('data-keyboard-up') && document.activeElement?.id === 'chat-sheet-input'`, 3000), 'H-8-1: fixture — sheet composer focused, keyboard up');
  await setDraft('chat-sheet-input', 'sheet draft under a retry');
  await evaluate(`document.querySelector('#chat-sheet-scroll [data-retry="${f8}"]').scrollIntoView({ block: 'center' })`);
  await sleep(250);
  g = await tapSel(`#chat-sheet-scroll [data-retry="${f8}"]`);
  const h8 = await evaluate(`({ val: document.getElementById('chat-sheet-input')?.value, still: !!document.querySelector('#chat-sheet-scroll [data-retry="${f8}"]') })`);
  assert(g.hit >= 1 && !h8.still && tapKept(g, 'chat-sheet-input') && g.kbd && g.active === 'chat-sheet-input' && h8.val === 'sheet draft under a retry',
    `H-8: THE BUG (finding 1) — a tap on retry in the sheet lands, re-queues, and the sheet composer keeps focus, flag and draft (retry still showing ${h8.still}; ${fmt(g)})`);

  // ── H-9: the kept textareas carry ONE set of listeners, however many repaints
  // (a kept node re-bound on every render would stack a keydown per repaint —
  // Enter-to-send running doSend() N times). Read with the engine's own
  // DOMDebugger, not inferred.
  const listenerCounts = async (id) => {
    const { result } = await pg.send('Runtime.evaluate', { expression: `document.getElementById('${id}')` });
    const { listeners } = await pg.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const by = {}; for (const l of listeners) by[l.type] = (by[l.type] || 0) + 1; return by;
  };
  const sheetL = await listenerCounts('chat-sheet-input');
  await evaluate(`document.getElementById('chat-sheet-wrap')?.remove()`);
  await resetKbd();
  await toChat();
  for (let i = 0; i < 3; i++) { await evaluate(`(async () => (await import('./js/chat-ui.js')).renderChatPage())()`); }
  const mainL = await listenerCounts('chat-input');
  assert(mainL.input === 1 && mainL.keydown === 1, `H-9a: after repeated repaints the main composer carries exactly one 'input' and one 'keydown' listener (${JSON.stringify(mainL)})`);
  assert(sheetL.keydown === 1, `H-9b: after a send, a reply and a cancel the sheet composer carries exactly one 'keydown' listener (${JSON.stringify(sheetL)})`);
  await resetKbd();

  // ── H-10: the carried textarea still takes the NEW markup's attributes ─────
  // (a paused-league render disables it and swaps the placeholder; the next
  // unpaused render must bring it back — exactly what a rebuilt node would).
  await toChat();
  await markNode('chat-input');
  await evaluate(`(() => { const i = document.getElementById('chat-input'); i.disabled = true; i.placeholder = 'paused'; i.setAttribute('data-stale', '1'); })()`);
  await evaluate(`(async () => (await import('./js/chat-ui.js')).renderChatPage())()`);
  const h10 = await evaluate(`(() => { const i = document.getElementById('chat-input'); return { same: i === window.__hNode, disabled: i.disabled, ph: i.placeholder, stale: i.hasAttribute('data-stale'), rows: i.getAttribute('rows'), max: i.getAttribute('maxlength') }; })()`);
  assert(h10.same && !h10.disabled && h10.ph === 'Message the league…' && !h10.stale && h10.rows === '1' && h10.max === '1000',
    `H-10: a carried composer takes the fresh markup's attributes — not left disabled, placeholder restored, stray attribute gone (${JSON.stringify(h10)})`);

  // ── H-11: the carry is for the SAME player only (RG-174 owner rule, RG-51 class)
  // A draft typed by one player is never carried into another player's
  // composer — a tap on ➤ would post A's words under B's name.
  await setDraft('chat-input', 'drew typed this');
  await markNode('chat-input');
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p2', false, true); (await import('./js/chat-ui.js')).renderChatPage(); })()`);
  const h11 = await evaluate(`(() => { const i = document.getElementById('chat-input'); return { same: i === window.__hNode, val: i.value }; })()`);
  assert(!h11.same && h11.val === '', `H-11: after a session change the next render builds a FRESH, EMPTY composer — the previous player's draft is not carried (${JSON.stringify(h11)})`);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p1', false, true); (await import('./js/chat-ui.js')).renderChatPage(); })()`);
  assert(await evaluate(`(async () => (await import('./js/storage.js')).getSession()?.playerId === 'p1')()`), 'H-11-r: fixture — signed back in as Drew for the sections that follow');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] Home-screen app / notched device: safe-area insets (59 top, 34 bottom), standalone display mode…');
  // ═════════════════════════════════════════════════════════════════════════
  let insetsOk = true;
  try { await pg.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 } }); }
  catch (e) { insetsOk = false; console.log('   (setSafeAreaInsetsOverride: ' + e.message + ')'); }
  try { await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }); } catch { /* optional */ }
  assert(insetsOk, 'D-0: fixture — the engine accepted the safe-area inset override (Chrome 136+)');
  await evaluate(`window.navigateTo('picks')`); await sleep(200);
  await evaluate(`window.navigateTo('chat')`); await sleep(500);
  const ins = await evaluate(`(() => { const p = document.createElement('div'); p.style.cssText = 'position:fixed;top:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)'; document.body.appendChild(p); const cs = getComputedStyle(p); const r = { t: parseFloat(cs.paddingTop), b: parseFloat(cs.paddingBottom) }; p.remove(); return r; })()`);
  assert(ins.t === 59 && ins.b === 34, `D-1: fixture — env(safe-area-inset-top/bottom) resolve to ${ins.t}/${ins.b}px in the page`);
  m = await evaluate(M);
  assert(m.win === 0 && m.docH <= m.vh && m.comp.b <= m.vh - 34 && m.hdr.t >= 0,
    `D-2: with insets the page still fits (document ${m.docH}px in ${m.vh}px), the composer clears the home indicator (…${m.comp.b} ≤ ${m.vh - 34}), window ${m.win}`);
  d = await drag(cx, m.comp.t + m.comp.h / 2, -220);
  const d2 = await drag(cx, m.hdr.t + 20, 220);
  assert(d.mid.lift === 0 && d2.mid.lift === 0 && same(d.mid.comp, m.comp) && same(d2.mid.hdr, m.hdr) && d2.after.win === 0,
    `D-3: drags on the composer and the header move nothing in the home-screen layout (lift ${d.mid.lift}/${d2.mid.lift})`);
  await pg.send('Emulation.setSafeAreaInsetsOverride', { insets: {} }).catch(() => {});
  await pg.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] Control — every other tab keeps its window scroll, its root bounce and its T-29 bottom bounce…');
  // ═════════════════════════════════════════════════════════════════════════
  for (const tab of ['picks', 'dashboard']) {
    await evaluate(`window.navigateTo('${tab}')`);
    await sleep(400);
    await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
    await sleep(100);
    const st = await evaluate(`(() => { const h = getComputedStyle(document.documentElement); return { oy: h.overflowY, ob: h.overscrollBehaviorY, docH: document.documentElement.scrollHeight, vh: innerHeight }; })()`);
    assert(st.oy === 'visible' && st.ob === 'auto', `E-1-${tab}: the root is an ordinary scroller again (html overflow-y "${st.oy}", overscroll-behavior-y "${st.ob}") — DI-327's native bounce stands off Chat`);
    if (st.docH > st.vh + 150) {
      a = await evaluate(M);
      await swipe(cx, 500, -300);
      b = await evaluate(M);
      assert(b.win > a.win + 100, `E-2-${tab}: a swipe scrolls the window (${a.win}→${b.win})`);
      await evaluate(`window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`);
      await sleep(150);
      d = await drag(cx, 500, -200);
      assert(d.mid.lift > 5, `E-3-${tab}: at the bottom of the page, the T-29 bottom bounce still applies (page lift ${d.mid.lift.toFixed(1)}px) — the Chat gate denies Chat only`);
    } else {
      // This fixture's Dashboard (no picks, no results) fits the viewport;
      // Picks (16 games) is the tall page the scroll + bounce controls use.
      assert(tab !== 'picks', tab === 'picks'
        ? `E-2-picks: fixture — Picks must be tall enough to scroll (${st.docH}px in ${st.vh}px)`
        : `E-2-${tab}: (${tab} fits the viewport in this fixture, ${st.docH}px in ${st.vh}px — the scroll and bounce controls run on Picks)`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[N4] DI-427 reviewer round 3 — the ↩ reply glyph appears in the space the BUBBLE vacates, never over the avatar, on received AND own rows (390×844, real touch drag)…');
  // ═════════════════════════════════════════════════════════════════════════
  // The reviewer's exact measurement, repeated: a real L→R touch drag on a
  // message, held (finger down) long enough for the 150ms opacity fade, then
  // the glyph's, bubble's and avatar's rects read in the engine. Round 2 put
  // the glyph at a fixed left:8px on the row — x 32–45 on BOTH row types,
  // over a received row's avatar (24–54) and ~260px from an own bubble.
  await evaluate(`window.navigateTo('chat')`);
  await sleep(400);
  await evaluate(`(async () => { const chat = await import('./js/chat.js');
    chat.ingest([{ id: 'n4own', seq: 900, ts: Date.now() - 1000, type: 'message', author: 'p1', gameTag: '', body: 'ok', replyTo: '', notify: true, meta: null, targetId: '' }]); })()`);
  await waitFor(`document.querySelector('#chat-scroll .chat-msg.chat-mine[data-mid="n4own"]')`);
  await sleep(300);
  await bottomOut();
  await sleep(200);
  const N4_GEOM = (sel) => `(() => {
    const row = document.querySelector(${JSON.stringify(sel)});
    if (!row) return null;
    const rr = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    const av = row.querySelector('.chat-avatar');
    const glyph = row.querySelector('.chat-swipe-reply-icon');
    return { mid: row.dataset.mid, armed: row.dataset.swipeArmed || '', bubble: rr(row.querySelector('.chat-bubble')),
      avatar: av && getComputedStyle(av).display !== 'none' ? rr(av) : null,
      glyph: rr(glyph), glyphOpacity: glyph ? parseFloat(getComputedStyle(glyph).opacity) : -1,
      replying: !!document.getElementById('chat-cancel-reply'),
      thread: (() => { const t = document.getElementById('chat-scroll'); return t ? { sL: t.scrollLeft, sW: t.scrollWidth, cW: t.clientWidth, ox: getComputedStyle(t).overflowX } : null; })() };
  })()`;
  /** A real finger drag, L→R by `dx`, sampled while the finger is still
   *  down; ended with `endType` (touchCancel = release without committing,
   *  touchEnd = a deliberate release, which commits an armed reply). */
  const replyDrag = async (sel, dx, endType) => {
    const rest = await evaluate(N4_GEOM(sel));
    const x0 = Math.round(rest.bubble.l + Math.min(20, rest.bubble.w / 2)), y0 = Math.round((rest.bubble.t + rest.bubble.b) / 2);
    await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 8; i++) { await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + Math.round(dx * i / 8), y: y0 }] }); await sleep(16); }
    await sleep(220);   // the glyph's --motion-fast (150ms) opacity fade completes
    const mid = await evaluate(N4_GEOM(sel));
    await pg.send('Input.dispatchTouchEvent', { type: endType, touchPoints: [] });
    await sleep(400);
    const after = await evaluate(N4_GEOM(sel));
    return { rest, mid, after };
  };
  const inBand = (g, lo, hi) => g && g.l >= lo - 0.5 && g.r <= hi + 0.5;
  const vCentered = (g, bub) => g && bub && Math.abs((g.t + g.b) / 2 - (bub.t + bub.b) / 2) <= 2;
  const RECEIVED = '#chat-scroll .chat-msg:not(.chat-mine):not(.chat-scribe):not(.chat-system):not(.chat-gamereact):nth-last-child(1 of .chat-msg:not(.chat-mine):not(.chat-scribe):not(.chat-system):not(.chat-gamereact))';
  const OWN = '#chat-scroll .chat-msg.chat-mine[data-mid="n4own"]';

  const rcv = await replyDrag(RECEIVED, 60, 'touchCancel');
  assert(rcv.rest && rcv.rest.avatar && rcv.rest.bubble && rcv.rest.glyph,
    `N4-r0: fixture — a received row with a visible avatar and bubble (${JSON.stringify(rcv.rest && { mid: rcv.rest.mid, avatar: rcv.rest.avatar, bubble: rcv.rest.bubble })})`);
  if (rcv.rest?.avatar && rcv.mid?.glyph) {
    const L0 = rcv.rest.bubble.l, L1 = rcv.mid.bubble.l, g = rcv.mid.glyph;
    console.log(`   received ${rcv.rest.mid}: avatar ${rcv.rest.avatar.l.toFixed(0)}–${rcv.rest.avatar.r.toFixed(0)}, bubble left ${L0.toFixed(0)} → ${L1.toFixed(0)} while dragged, glyph ${g.l.toFixed(1)}–${g.r.toFixed(1)} (opacity ${rcv.mid.glyphOpacity})`);
    assert(rcv.mid.armed === 'true' && rcv.mid.glyphOpacity >= 0.95 && L1 >= L0 + 30,
      `N4-r1: fixture — the drag armed the reply: bubble slid ${(L1 - L0).toFixed(0)}px right and the glyph is visible (opacity ${rcv.mid.glyphOpacity})`);
    assert(g.l >= rcv.rest.avatar.r,
      `N4-r2: THE BUG — the glyph is never over the avatar (glyph left ${g.l.toFixed(1)} ≥ avatar right ${rcv.rest.avatar.r.toFixed(1)}; round 2: 32 vs 54)`);
    assert(inBand(g, L0, L1),
      `N4-r3: THE BUG — the glyph sits inside the band the bubble vacated [${L0.toFixed(0)}, ${L1.toFixed(0)}] (glyph ${g.l.toFixed(1)}–${g.r.toFixed(1)})`);
    assert(L1 - g.r <= 40,
      `N4-r4: …adjacent to the dragged bubble's left edge (gap ${(L1 - g.r).toFixed(1)}px ≤ 40)`);
    assert(vCentered(g, rcv.mid.bubble),
      `N4-r5: …and vertically centred on the bubble (glyph mid ${((g.t + g.b) / 2).toFixed(1)}, bubble mid ${((rcv.mid.bubble.t + rcv.mid.bubble.b) / 2).toFixed(1)})`);
    assert(rcv.after.glyphOpacity === 0 && Math.abs(rcv.after.bubble.l - L0) <= 0.5 && !rcv.after.replying,
      `N4-r6: released without committing (touchcancel): the bubble rubber-bands back to ${rcv.after.bubble.l.toFixed(1)} (rest ${L0.toFixed(1)}), the glyph fades out (opacity ${rcv.after.glyphOpacity}), no reply opened`);
  }

  const own = await replyDrag(OWN, 60, 'touchCancel');
  assert(own.rest && own.rest.bubble && own.rest.glyph && !own.rest.avatar,
    `N4-o0: fixture — an own row (avatar hidden, bubble right-aligned at ${own.rest?.bubble?.l?.toFixed?.(0)}–${own.rest?.bubble?.r?.toFixed?.(0)})`);
  if (own.mid?.glyph && own.rest?.bubble) {
    const L0 = own.rest.bubble.l, L1 = own.mid.bubble.l, g = own.mid.glyph;
    console.log(`   own ${own.rest.mid}: bubble left ${L0.toFixed(0)} → ${L1.toFixed(0)} while dragged, glyph ${g.l.toFixed(1)}–${g.r.toFixed(1)} (opacity ${own.mid.glyphOpacity}); thread mid-drag ${JSON.stringify(own.mid.thread)}, after ${JSON.stringify(own.after.thread)}`);
    assert(own.mid.armed === 'true' && own.mid.glyphOpacity >= 0.95 && L1 >= L0 + 30,
      `N4-o1: fixture — the drag armed the reply: bubble slid ${(L1 - L0).toFixed(0)}px right and the glyph is visible (opacity ${own.mid.glyphOpacity})`);
    assert(inBand(g, L0, L1),
      `N4-o2: THE BUG — the glyph sits inside the band the own bubble vacated [${L0.toFixed(0)}, ${L1.toFixed(0)}] (glyph ${g.l.toFixed(1)}–${g.r.toFixed(1)}; round 2: 32–45, ~260px away)`);
    assert(L1 - g.r <= 40,
      `N4-o3: …within 40px left of the dragged bubble's left edge (gap ${(L1 - g.r).toFixed(1)}px)`);
    assert(vCentered(g, own.mid.bubble),
      `N4-o4: …and vertically centred on the bubble`);
    assert(own.after.glyphOpacity === 0 && Math.abs(own.after.bubble.l - L0) <= 0.5,
      `N4-o5: released: the own bubble rubber-bands back to ${own.after.bubble.l.toFixed(1)} (rest ${L0.toFixed(1)}) and the glyph fades out`);
    // Touched-screen audit: the own bubble overflows the thread mid-drag
    // (scrollWidth > clientWidth), and the thread's overflow-x is auto at
    // rest — so for the drag's duration it must not be sideways-scrollable.
    assert(own.mid.thread && own.mid.thread.sW > own.mid.thread.cW && own.mid.thread.ox === 'hidden' && own.mid.thread.sL === 0,
      `N4-o6: mid-drag the own bubble overflows the thread (${own.mid.thread?.sW} > ${own.mid.thread?.cW}) and the thread is NOT sideways-scrollable for the gesture (overflow-x "${own.mid.thread?.ox}", scrollLeft ${own.mid.thread?.sL})`);
    assert(own.after.thread && own.after.thread.ox === 'auto' && own.after.thread.sL === 0,
      `N4-o7: …and the clip is lifted once the spring-back ends (overflow-x "${own.after.thread?.ox}") — the thread's resting style is unchanged`);
  }

  // Commit-on-release is unchanged: the same drag ended with a deliberate
  // release (touchend) opens the reply.
  const commit = await replyDrag(RECEIVED, 60, 'touchEnd');
  assert(commit.mid?.armed === 'true' && commit.after?.replying,
    `N4-c1: a deliberate release while armed commits the reply (reply bar ${commit.after?.replying ? 'open' : 'absent'})`);
  await evaluate(`document.getElementById('chat-cancel-reply')?.click()`);
  await sleep(200);
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
