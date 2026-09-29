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
