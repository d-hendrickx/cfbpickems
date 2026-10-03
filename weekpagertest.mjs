/**
 * CFB Pickems — weekpagertest.mjs
 * ===============================
 * SB-23 (Drew, 2026-10-01, verbatim): "when swiping between weeks in
 * dashboard/picks it looks jumpy because you can still scroll vertically.
 * While swiping between weeks, you should only see the horizontal
 * scroll/swipe and vetical should stay static. You can also see the current
 * week sliding out but can't see the new week sliding in".
 *
 * ENGINE-MEASURED, through the REAL app: the real index.html, css/styles.css
 * and js/app.js booted in a real headless Chromium, players and weeks seeded
 * through the app's OWN js/storage.js + js/data-model.js, the pages opened
 * through the real navigateTo() (which binds bindWeekSwipe()), and every
 * gesture a REAL touch sequence (CDP Input.dispatchTouchEvent) hit-tested and
 * scrolled by the engine. Same harness shape as weekswipetest.mjs.
 *
 *   [A] AXIS LOCK — once a drag is recognised as a horizontal week swipe the
 *       page does not move vertically until the finger lifts, even when the
 *       finger drifts steeply (a 42° drag: 10 px across, 9 px up per move —
 *       Blink rails shallower drags by itself; an iPhone's scroll view does
 *       not, so this is the case Blink can reproduce).
 *   [B] PAGER — mid-swipe the INCOMING week is on screen beside the outgoing
 *       one, and it moves with the finger; on release it lands exactly where
 *       it was shown (Dashboard at the same scroll offset, Picks at its top —
 *       the existing T-27 rule) with no vertical motion during the slide, and
 *       it is painted once, never twice.
 *   [C] CANCEL — a short release springs back: the incoming week slides back
 *       out WITH the page, then is gone; the week, and the shared week field,
 *       are unchanged.
 *   [D] VERTICAL-FIRST — a drag that starts vertical scrolls natively and
 *       never becomes a swipe (no sideways motion, no incoming week, no lock).
 *   [E] THE DOCUMENT LOCK — computed style: from the claim to the release the
 *       root is not user-scrollable and its bounce is off (the SB-05 idiom);
 *       it lifts on release, on a hidden → visible return mid-drag, and at the
 *       next touch if a release was lost. The pages carry touch-action:pan-y.
 *   [F] COST — exactly ONE render of the incoming week per direction per drag,
 *       never one per move; a vertical drag renders none.
 *   [G] REDUCE MOTION — the drag still shows the incoming week (direct
 *       manipulation); the release never animates movement: a commit
 *       cross-fades with the incoming week already at rest, a cancel drops the
 *       incoming week at once.
 *   [H] NO REGRESSIONS — the control-center drawer still opens from the left
 *       quarter (no incoming week, no week lock); pull-to-refresh at the top
 *       still refreshes.
 *   [I] LIVE REPAINT — a repaint landing mid-drag is parked; the incoming week
 *       stays up and keeps following the finger.
 *   [J] BLIND RULE — the incoming preview of an OPEN week the viewer has not
 *       submitted shows exactly what that week's page shows (the "submit
 *       first" gate on Dashboard; only the viewer's own nothing on Picks) and
 *       not one pick of anyone else's; preview markup === landed markup.
 *   [K] FOCUS — with a field inside the page focused, the swipe still works but
 *       renders no preview: the field keeps focus and its value.
 *   [L] INNER SCROLLERS keep their own offsets across the preview render.
 *   [M] INERT — nothing in the incoming week can take focus.
 *
 * Every probe is a RELATION measured on what is painted (text the incoming
 * week's games carry, the document's scroll offset), never a class name of
 * the implementation: "the next week's games are visible to the right of the
 * outgoing page" holds for any correct fix. Two exceptions, named where they
 * are used: [J]'s markup equality and [E]'s attribute-free computed style.
 *
 * The app boots in LOCAL (PIN) mode: this suite's own localhost server
 * answers /config.json with `{}` and 404s service-worker.js; all other
 * network resolution is blocked.
 *
 * WHAT ONLY A DEVICE CAN CONFIRM: Blink is not WebKit. Whether iOS's scroll
 * view honours `touch-action` for a slow diagonal drag exactly as Blink does,
 * and the feel of the pager under a real finger, are Drew's on-device walk.
 *
 * Run: node weekpagertest.mjs   (spawned by loadtest.mjs [136])
 * Override the browser: WEEKPAGER_ENGINE=/path/to/Chromium (falls back to
 * WEEKSWIPE_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE).
 * Mutation runs: WEEKPAGER_ROOT=/path/to/a/COPY/of/cfb-pickems serves that
 * tree instead of this one — mutate the copy, never this checkout.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.WEEKPAGER_ROOT || here;
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
const override = process.env.WEEKPAGER_ENGINE || process.env.WEEKSWIPE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: WEEKPAGER_ENGINE=/path/to/Chromium node weekpagertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (WEEKPAGER_ROOT — serving ${ROOT})`);

// ── the app server: the real tree, local-mode config, no service worker ─────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; }
  if (p === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  // App files only: no dot-segments, no dotfiles (.env*, .git…), nothing
  // under /supabase/ (tests/.env* live there).
  if (p.split('/').some(seg => seg.startsWith('.')) || p.startsWith('/supabase/') || p === '/supabase') { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ── the CDP client (same shape as weekswipetest.mjs) ─────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-weekpager-'));
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
  await pg.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pg.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(150);

  // Real touches, hit-tested (and scrolled) by the engine. Each move waits a
  // frame so a read after it sees what the move did.
  const touch = {
    async down(x, y) { await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); },
    async move(x, y) { await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(16); await evaluate('new Promise(r => requestAnimationFrame(() => r(true)))'); },
    async up() { await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
  };

  // Page-side helpers, installed after the load (installHelpers):
  //  __painted(pageId, n) — what is PAINTED for week n: every text node naming
  //    one of week n's games ("Away n-g" / "Home n-g"), clipped by every
  //    ancestor that clips and by the viewport; plus the page root's rect, the
  //    document's scroll offset, the page's label/opacity. Implementation-
  //    agnostic: whatever draws the incoming week, its games' names are on
  //    screen or they are not.
  //  __startFrames — the same, every animation frame, for "did it slide or
  //    jump" questions about real frames. __lock — the document's computed
  //    scroll lock. __weekText — week n's text anywhere in the document
  //    outside the hidden tabs.
  //  __renders — new week cards created (one per real page render).
  const installHelpers = () => evaluate(`(() => {
    window.__painted = (pageId, n) => {
      const re = new RegExp('\\\\b(Away|Home) ' + n + '-\\\\d\\\\b');
      const vw = innerWidth, vh = innerHeight;
      const clipOf = (node) => {
        const rg = document.createRange(); rg.selectNodeContents(node); const r = rg.getBoundingClientRect();
        let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
        for (let el = node.parentElement; el; el = el.parentElement) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
          if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && el !== document.documentElement && el !== document.body) {
            const c = el.getBoundingClientRect();
            if (cs.overflowX !== 'visible') { box.l = Math.max(box.l, c.left); box.r = Math.min(box.r, c.right); }
            if (cs.overflowY !== 'visible') { box.t = Math.max(box.t, c.top); box.b = Math.min(box.b, c.bottom); }
          }
        }
        box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, vw), b: Math.min(box.b, vh) };
        return (box.r - box.l > 1 && box.b - box.t > 1) ? { left: Math.round(r.left * 10) / 10, top: Math.round(r.top * 10) / 10, visL: Math.round(box.l), visR: Math.round(box.r), text: node.textContent.trim().slice(0, 40) } : null;
      };
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) { if (re.test(t.textContent)) { const v = clipOf(t); if (v) out.push(v); } }
      const root = document.getElementById(pageId);
      const rr = root.getBoundingClientRect();
      return { visible: out, rootLeft: Math.round(rr.left * 10) / 10, rootRight: Math.round(rr.right * 10) / 10,
        scrollY: Math.round(scrollY * 10) / 10, label: root.querySelector('.picks-week-nav-label')?.textContent || null,
        opacity: Number(getComputedStyle(root).opacity), anim: root.dataset.weekSwipeAnimating || null };
    };
    window.__startFrames = (pageId, n, ms) => {
      window.__frames = []; const t0 = performance.now();
      (function loop() { const s = window.__painted(pageId, n); s.t = Math.round(performance.now() - t0); s.dom = window.__weekText(n); window.__frames.push(s);
        if (performance.now() - t0 < ms) requestAnimationFrame(loop); })();
      return true;
    };
    window.__lock = () => { const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body);
      return { oy: h.overflowY, hob: h.overscrollBehaviorY, bob: b.overscrollBehaviorY }; };
    // (Hidden tabs keep their last render in the DOM — a page that is not the
    // active one is not part of what this tab shows, so it is not counted.)
    window.__weekText = (n) => { const re = new RegExp('\\\\b(Away|Home) ' + n + '-\\\\d\\\\b'); let c = 0;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) if (re.test(t.textContent) && !t.parentElement?.closest('.page-section:not(.active)')) c++; return c; };
    window.__textVisibleRight = (pageId, needle) => { const root = document.getElementById(pageId); const edge = root.getBoundingClientRect().right;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) { if (!t.textContent.includes(needle)) continue;
        const rg = document.createRange(); rg.selectNodeContents(t); const r = rg.getBoundingClientRect();
        if (r.width && r.left >= edge - 2 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight) return true; }
      return false; };
    // Render counter — every NEW week card (.picks-week-nav) an engine render
    // creates; parked-and-restored nodes are the same objects, so not counted.
    window.__seen = new WeakSet(document.querySelectorAll('.picks-week-nav'));
    window.__renders = 0;
    if (window.__renderObs) window.__renderObs.disconnect();
    window.__renderObs = new MutationObserver(recs => { for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      const cards = [...(n.matches('.picks-week-nav') ? [n] : []), ...n.querySelectorAll('.picks-week-nav')];
      for (const c of cards) if (!window.__seen.has(c)) { window.__seen.add(c); window.__renders++; } } });
    window.__renderObs.observe(document.body, { childList: true, subtree: true });
    return true;
  })()`);
  const painted = (pageId, n) => evaluate(`window.__painted('${pageId}', ${n})`);
  const frames = async (ms) => { await sleep(ms + 120); return evaluate('window.__frames'); };
  const settleIdle = async (id) => {
    await waitFor(`!document.querySelector('.week-swipe-exit-layer') && !document.getElementById('${id}').dataset.weekSwipeAnimating`, 3000);
    await sleep(120);
  };
  // A right-to-left (next-week) drag of `steps` × 10 px with `rise` px of
  // upward finger drift per step; every move sampled.
  const steepDrag = async (pageId, n, x0, y0, steps, rise) => {
    const out = [];
    await touch.down(x0, y0);
    for (let i = 1; i <= steps; i++) {
      await touch.move(x0 - i * 10, y0 - Math.round(i * rise));
      out.push({ dx: -i * 10, ...(await painted(pageId, n)) });
    }
    return out;
  };
  // A flat drag from x0 by `dxs` (a list of offsets from x0), sampled.
  const flatDrag = async (pageId, n, x0, y, dxs) => {
    const out = [];
    await touch.down(x0, y);
    for (const dx of dxs) { await touch.move(x0 + dx, y); out.push({ dx, ...(await painted(pageId, n)) }); }
    return out;
  };
  const range = (from, to, step) => { const a = []; for (let v = from; step > 0 ? v <= to : v >= to; v += step) a.push(v); return a; };
  // Strips the outgoing page uncovered: right of it (next week) / left of it (previous).
  const inStrip = (s) => (s?.visible || []).filter(v => v.visR > s.rootRight - 1 && v.visL >= s.rootRight - 2);
  const inStripLeft = (s) => (s?.visible || []).filter(v => v.visL < s.rootLeft + 1 && v.visR <= s.rootLeft + 2);
  const pair = (a, b, strip = inStrip) => {
    const A = strip(a), B = strip(b);
    for (const x of B) { const y = A.find(z => z.text === x.text && Math.abs(z.top - x.top) <= 1); if (y) return { from: y.left, to: x.left }; }
    return null;
  };
  const nearest = (list, text, top) => list.filter(v => v.text === text).sort((p, q) => Math.abs(p.top - top) - Math.abs(q.top - top))[0] || null;
  const setVisibility = (st) => evaluate(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${st}' });
    document.dispatchEvent(new Event('visibilitychange')); return true; })()`);
  const reducedMotion = async (on) => {
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
    await sleep(60);
  };
  const toWeek = async (pageId, want) => {
    for (let i = 0; i < 6; i++) {
      const l = await evaluate(`document.querySelector('#${pageId} .picks-week-nav-label')?.textContent`);
      if (l === want) return true;
      const n = Number(String(l).replace(/\D+/g, '')), w = Number(want.replace(/\D+/g, ''));
      await evaluate(`document.querySelector('#${pageId} .picks-week-nav > button[aria-label="${w > n ? 'Next' : 'Previous'} week"]')?.click()`);
      await sleep(150);
    }
    return (await evaluate(`document.querySelector('#${pageId} .picks-week-nav-label')?.textContent`)) === want;
  };

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode): six players, four final weeks with picks, and an OPEN Week 5 the viewer has not submitted…');
  // ═════════════════════════════════════════════════════════════════════════
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`),
    '1-0: fixture — the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
    const players = NAMES.map((n) => ({ ...dm.createPlayer(n, '', '1234', '', n.slice(0, 2).toUpperCase()), playerId: 'pl_' + n.toLowerCase() }));
    players.forEach(p => st.savePlayer(p));
    const picks = [];
    for (let wn = 1; wn <= 4; wn++) {
      const wk = { ...dm.createWeek(2026, wn), weekId: 'wk_' + wn, status: 'final' };
      st.saveWeek(wk);
      // Week 1 is a SHORT week (one game) — [R]'s neighbour, shorter than a deep-scrolled Week 2.
      for (let gi = 0; gi < (wn === 1 ? 1 : 8); gi++) {
        const g = dm.createGame(wk.weekId, { gameId: 'g_' + wn + '_' + gi, homeTeam: 'Home ' + wn + '-' + gi, awayTeam: 'Away ' + wn + '-' + gi,
          kickoff: new Date(Date.UTC(2026, 8, wn * 7, 17 + (gi % 4))).toISOString(), kickoffConfirmed: true,
          spread: -3.5, lockedSpread: -3.5, homeScore: 24 + gi, awayScore: 17, status: 'final' });
        st.saveGame(g);
        players.forEach((p, pi) => picks.push({ ...dm.createPick(wk.weekId, g.gameId, p.playerId, (gi + pi) % 2 ? g.homeTeam : g.awayTeam),
          pickId: 'pk_' + wn + '_' + gi + '_' + pi, submittedAt: '2026-09-01T00:00:00Z' }));
      }
    }
    // [J]'s week: OPEN, kickoffs months away, five players submitted, the viewer (Drew) not.
    st.saveWeek({ ...dm.createWeek(2026, 5), weekId: 'wk_5', status: 'open' });
    for (let gi = 0; gi < 8; gi++) {
      const g = dm.createGame('wk_5', { gameId: 'g_5_' + gi, homeTeam: 'Home 5-' + gi, awayTeam: 'Away 5-' + gi,
        kickoff: new Date(Date.UTC(2027, 0, 10, 17 + (gi % 4))).toISOString(), kickoffConfirmed: true, spread: -3.5, status: 'scheduled' });
      st.saveGame(g);
      players.slice(1).forEach((p, pi) => picks.push({ ...dm.createPick('wk_5', g.gameId, p.playerId, (gi + pi) % 2 ? g.homeTeam : g.awayTeam),
        pickId: 'pk_5_' + gi + '_' + pi, submittedAt: '2026-09-30T00:00:00Z' }));
    }
    st.saveAllPicks(picks);
    st.setActiveWeekId('wk_2');
    st.setSession('pl_drew', false, true);
    await new Promise(r => setTimeout(r, 1200));   // storage.js's debounced write lands
    return { players: st.getPlayers().filter(p => p.playerId.startsWith('pl_')).length,
      weeks: st.getWeeks().filter(w => w.weekId.startsWith('wk_')).length, picks: st.getPicks().filter(p => p.pickId.startsWith('pk_')).length };
  })()`);
  assert(seeded.players === 6 && seeded.weeks === 5 && seeded.picks === 6 * 8 * 3 + 6 + 5 * 8,
    `1-1: fixture — 6 players, 4 final weeks (Week 1 a one-game week) + 1 open week, ${6 * 8 * 3 + 6 + 5 * 8} picks seeded through the app's own storage.js (got ${JSON.stringify(seeded)})`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`),
    '1-2: fixture — after reload the app is past the site gate with a verified player session');
  await evaluate(`window.navigateTo('dashboard')`);
  assert(await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`),
    '1-3: fixture — navigateTo("dashboard") (the real path that binds the week swipe) rendered the week card');
  await installHelpers();

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] SB-23 axis lock — a recognised horizontal swipe never scrolls the page vertically…');
  // ═════════════════════════════════════════════════════════════════════════
  // Dashboard, Week 2, scrolled to 300 px so a vertical drift could go either
  // way. 12 moves of 10 px left and 9 px up: past the 8 px dead zone the
  // binder locks HORIZONTAL (|dx| > |dy|), so this is a week swipe.
  const dash0 = await painted('page-dashboard', 2);
  assert(dash0.label === 'Week 2', `A-pre: fixture — the Dashboard shows Week 2 (got "${dash0.label}")`);
  const REST = dash0.rootLeft;
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' })`);
  await sleep(150);
  const yA = await evaluate('Math.round(scrollY)');
  assert(yA === 300, `A-pre2: fixture — the Dashboard is scrolled to 300 px (got ${yA}) — tall enough to scroll either way`);
  const dDrag = await steepDrag('page-dashboard', 3, 320, 560, 12, 9);
  const dLocked = dDrag.filter(s => Math.abs(s.rootLeft - REST - s.dx) <= 12);
  assert(dLocked.length >= 10, `A-0: fixture — the drag locked HORIZONTAL: the week follows the finger (${dLocked.length}/12 moves within a move of 1:1)`);
  const dDrift = dDrag.map(s => s.scrollY - yA);
  assert(dDrift.every(d => Math.abs(d) <= 0.5),
    `A-1: THE BUG (Dashboard) — while the week swipe owns the drag the page does NOT scroll vertically (scrollY drift per move: ${dDrift.join(', ')} px)`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] SB-23 pager — the incoming week is on screen beside the outgoing one, moves with the finger, and lands where it was shown…');
  // ═════════════════════════════════════════════════════════════════════════
  const d80 = dDrag.find(s => s.dx === -80), d120 = dDrag.find(s => s.dx === -120);
  assert(inStrip(d120).length >= 1,
    `B-1: THE BUG (Dashboard) — 120 px into a next-week swipe, Week 3's games are painted in the strip the outgoing week uncovered (x ≥ ${d120?.rootRight}): ${inStrip(d120).length} visible (${JSON.stringify(inStrip(d120).slice(0, 2))})`);
  const moved = pair(d80, d120);
  assert(!!moved && Math.abs((moved.to - moved.from) - -40) <= 1.5,
    `B-2: THE BUG (Dashboard) — the incoming week moves WITH the finger: the same Week 3 line shifts −40 px between dx −80 and dx −120 (${moved ? `${moved.from} → ${moved.to}` : 'never on screen at both'})`);
  const refD = inStrip(d120)[0] || null;
  await evaluate(`window.__startFrames('page-dashboard', 3, 520)`);
  await touch.up();
  let fr = await frames(520);
  await settleIdle('page-dashboard');
  const dLanded = await painted('page-dashboard', 3);
  assert(dLanded.label === 'Week 3', `B-3: fixture — the release lands on Week 3 (got "${dLanded.label}")`);
  assert(fr.length >= 8 && fr.every(f => Math.abs(f.scrollY - yA) <= 0.5),
    `B-7: Dashboard keeps its scroll offset (DI-325) and NOTHING moves vertically through the release slide either: every one of ${fr.length} frames reads scrollY ${yA} (${[...new Set(fr.map(f => f.scrollY))].join(', ')})`);
  const dupD = refD ? fr.filter(f => f.visible.filter(v => v.text === refD.text && Math.abs(v.top - refD.top) <= 2).length > 1) : [];
  assert(!!refD && dupD.length === 0,
    `B-8: the incoming week is painted ONCE through the release — never a second copy riding out with the outgoing week ("${refD?.text}" doubled in ${dupD.length} frames)`);
  const domD = await evaluate('window.__weekText(3)');
  const slideD = fr.filter(f => f.anim === 'commit');
  assert(slideD.length >= 4 && slideD.every(f => f.dom === domD),
    `B-8b: …and it EXISTS once: no hidden copy rides out inside the outgoing layer either (Week 3 text nodes per slide frame ${[...new Set(slideD.map(f => f.dom))].join(',')}; landed page ${domD}; ${slideD.length} slide frames)`);
  const landD = refD ? nearest(dLanded.visible, refD.text, refD.top) : null;
  const wantLeftD = refD ? REST + (refD.left - d120.rootRight) : null;
  assert(!!landD && Math.abs(landD.top - refD.top) <= 1.5 && Math.abs(landD.left - wantLeftD) <= 1.5,
    `B-9: …and it lands EXACTLY where it was shown: "${refD?.text}" previewed at top ${refD?.top}, ${refD ? Math.round((refD.left - d120.rootRight) * 10) / 10 : '?'} px into the page; landed at top ${landD?.top}, left ${landD?.left} (want ${wantLeftD}) — no jump at the hand-over`);

  // Picks — the same defects on the other tab. Picks shows the CURRENT
  // week's card list (tall); scrolled down 500 px, a next-week swipe.
  await evaluate(`window.navigateTo('picks')`);
  await waitFor(`document.querySelector('#page-picks.active .picks-week-nav-label')`);
  await toWeek('page-picks', 'Week 2');
  const pick0 = await painted('page-picks', 3);
  assert(pick0.label === 'Week 2', `B-pre: fixture — Picks shows Week 2 (got "${pick0.label}")`);
  await evaluate(`window.scrollTo({ top: 500, behavior: 'instant' })`);
  await sleep(150);
  const yP = await evaluate('Math.round(scrollY)');
  assert(Math.abs(yP - 500) <= 1, `B-pre2: fixture — Picks is scrolled to ~500 px (got ${yP})`);
  const pDrag = await steepDrag('page-picks', 3, 320, 560, 12, 9);
  const pDrift = pDrag.map(s => s.scrollY - yP);
  assert(pDrift.every(d => Math.abs(d) <= 0.5),
    `A-2: THE BUG (Picks) — while the week swipe owns the drag the page does NOT scroll vertically (scrollY drift per move: ${pDrift.join(', ')} px)`);
  const p80 = pDrag.find(s => s.dx === -80), p120 = pDrag.find(s => s.dx === -120);
  assert(inStrip(p120).length >= 1,
    `B-4: THE BUG (Picks) — 120 px into a next-week swipe, Week 3's games are painted in the uncovered strip (x ≥ ${p120?.rootRight}): ${inStrip(p120).length} visible`);
  const pMoved = pair(p80, p120);
  assert(!!pMoved && Math.abs((pMoved.to - pMoved.from) - -40) <= 1.5,
    `B-5: THE BUG (Picks) — the incoming week moves WITH the finger (${pMoved ? `${pMoved.from} → ${pMoved.to}` : 'never on screen at both'})`);
  const refP = inStrip(p120).sort((a, b) => a.top - b.top)[0] || null;
  await evaluate(`window.__startFrames('page-picks', 3, 520)`);
  await touch.up();
  fr = await frames(520);
  await settleIdle('page-picks');
  const pLanded = await painted('page-picks', 3);
  assert(pLanded.label === 'Week 3', `B-6: fixture — the release lands on Week 3 (got "${pLanded.label}")`);
  const released = fr.slice(Math.max(0, fr.findIndex(f => Math.abs(f.scrollY - yP) > 0.5)));
  assert(released.length >= 6 && released.every(f => f.scrollY === 0) && released.some(f => f.anim === 'commit'),
    `B-10: Picks lands at its TOP (DI-325) in ONE step at release — every frame of the slide reads scrollY 0, no glide (scrollY per frame: ${[...new Set(fr.map(f => f.scrollY))].join(' → ')}; ${released.length} frames after the release, ${released.filter(f => f.anim === 'commit').length} mid-slide)`);
  const dupP = refP ? fr.filter(f => f.visible.filter(v => v.text === refP.text).length > 1 && f.visible.filter(v => v.text === refP.text && v.visR > 0).length > 1) : [];
  assert(!!refP && dupP.length === 0, `B-11: Picks — the incoming week is painted once through the release ("${refP?.text}" doubled in ${dupP.length} frames)`);
  const domP = await evaluate('window.__weekText(3)');
  const slideP = fr.filter(f => f.anim === 'commit');
  assert(slideP.length >= 4 && slideP.every(f => f.dom === domP),
    `B-11b: Picks — the incoming week exists once through the release (Week 3 text nodes per slide frame ${[...new Set(slideP.map(f => f.dom))].join(',')}; landed page ${domP})`);
  const landP = refP ? nearest(pLanded.visible, refP.text, refP.top) : null;
  const wantLeftP = refP ? REST + (refP.left - p120.rootRight) : null;
  assert(!!landP && pLanded.scrollY === 0 && Math.abs(landP.top - refP.top) <= 1.5 && Math.abs(landP.left - wantLeftP) <= 1.5,
    `B-12: Picks — the preview showed Week 3 from ITS TOP, so it lands exactly where it was shown: "${refP?.text}" previewed at top ${refP?.top}, landed at top ${landP?.top} with scrollY ${pLanded.scrollY}; left ${landP?.left} (want ${wantLeftP})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] Cancel — a short release springs back; the incoming week slides out with the page, then is gone…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.navigateTo('dashboard')`);
  await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`);
  assert(await toWeek('page-dashboard', 'Week 3'), 'C-pre: fixture — the Dashboard shows Week 3');
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' })`);
  await sleep(150);
  let drag = await flatDrag('page-dashboard', 4, 320, 500, [-10, -20, -30]);
  const c30 = drag.at(-1);
  assert(Math.abs(c30.rootLeft - REST - -30) <= 1.5 && inStrip(c30).length >= 1,
    `C-0: fixture — 30 px into a next-week drag the page follows the finger (${c30.rootLeft - REST}) with Week 4 beside it (${inStrip(c30).length} lines)`);
  await sleep(160);   // the finger rests before lifting: a short release, not a flick
  const c30x = inStrip(c30)[0]?.left;
  await evaluate(`window.__startFrames('page-dashboard', 4, 320)`);
  await touch.up();
  fr = await frames(320);
  const outFrames = fr.filter(f => inStrip(f).length && inStrip(f)[0].left > c30x + 1 && f.rootLeft < REST - 0.5);
  assert(outFrames.length >= 2,
    `C-1: the incoming week slides back OUT with the page — ${outFrames.length} frames with Week 4 still beside it, both moving right (Week 4 left per frame: ${fr.map(f => inStrip(f)[0]?.left ?? '-').slice(0, 10).join(', ')})`);
  await settleIdle('page-dashboard');
  const c1 = await evaluate(`({ ...window.__painted('page-dashboard', 4), any: window.__weekText(4) })`);
  assert(c1.label === 'Week 3' && Math.abs(c1.rootLeft - REST) <= 0.5 && c1.any === 0,
    `C-2: …then it is GONE: Week 3 at rest, and not one Week 4 line left anywhere in the document (label "${c1.label}", offset ${c1.rootLeft - REST}, Week 4 text nodes ${c1.any})`);
  await evaluate(`window.navigateTo('dashboard')`);
  await sleep(150);
  const c3 = await painted('page-dashboard', 3);
  assert(c3.label === 'Week 3',
    `C-3: the preview left the shared week field alone — a repaint after the cancelled swipe still paints Week 3 (got "${c3.label}")`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] Vertical-first — a drag that starts vertical scrolls natively and never becomes a swipe…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' }); window.__renders = 0`);
  await sleep(150);
  const yD = await evaluate('Math.round(scrollY)');
  const vd = [];
  await touch.down(250, 600);
  for (let i = 1; i <= 8; i++) {
    await touch.move(250 + i * 3, 600 - i * 12);
    vd.push({ ...(await painted('page-dashboard', 4)), lock: await evaluate('window.__lock().oy') });
  }
  const vRenders = await evaluate('window.__renders');
  await touch.up();
  await sleep(300);
  const yD2 = await evaluate('Math.round(scrollY)');
  assert(yD2 > yD + 40, `D-1: a vertical-first drag (with sideways drift) scrolls the page natively (${yD} → ${yD2})`);
  assert(vd.every(s => Math.abs(s.rootLeft - REST) <= 0.5 && s.visible.length === 0 && s.lock !== 'hidden'),
    `D-2: …and never becomes a swipe: no sideways motion, no incoming week, the document never locked (offsets ${[...new Set(vd.map(s => s.rootLeft - REST))].join(',')}; Week 4 lines ${Math.max(...vd.map(s => s.visible.length))}; overflow-y ${[...new Set(vd.map(s => s.lock))].join(',')})`);
  assert(vRenders === 0, `D-3: …and renders no incoming week at all (${vRenders} renders during the drag)`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] The document lock — computed style, the SB-05 idiom, lifted on release and on every recovery path…');
  // ═════════════════════════════════════════════════════════════════════════
  const ta = await evaluate(`[getComputedStyle(document.getElementById('page-dashboard')).touchAction, getComputedStyle(document.getElementById('page-picks')).touchAction]`);
  assert(ta.every(v => v === 'pan-y pinch-zoom'),
    `E-0: both swipe pages tell the browser a horizontal-first drag is not a scroll (touch-action ${ta.join(' / ')})`);
  const rest0 = await evaluate('window.__lock()');
  assert(rest0.oy === 'visible' && rest0.hob === 'auto' && rest0.bob === 'auto',
    `E-1: at rest the document is a free scroller with its bounce on (overflow-y ${rest0.oy}, overscroll html/body ${rest0.hob}/${rest0.bob})`);
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' })`);
  await sleep(120);
  drag = await flatDrag('page-dashboard', 4, 320, 500, [-10, -20, -30]);
  const lockMid = await evaluate('window.__lock()');
  assert(lockMid.oy === 'hidden' && lockMid.hob === 'none' && lockMid.bob === 'none',
    `E-2: from the claim, the document is NOT user-scrollable and its bounce is off — the SB-05 lock, keyed on the week swipe (overflow-y ${lockMid.oy}, overscroll html/body ${lockMid.hob}/${lockMid.bob})`);
  await sleep(160);
  await touch.up();
  const lockUp = await evaluate('window.__lock()');
  assert(lockUp.oy === 'visible' && lockUp.hob === 'auto' && lockUp.bob === 'auto',
    `E-3: the lock lifts the moment the finger does — before the spring-back ends (overflow-y ${lockUp.oy}, overscroll ${lockUp.hob}/${lockUp.bob})`);
  await settleIdle('page-dashboard');
  drag = await flatDrag('page-dashboard', 4, 320, 500, [-10, -20, -30]);
  await setVisibility('hidden');
  await setVisibility('visible');
  await sleep(80);
  const lockVis = await evaluate(`({ ...window.__lock(), ...window.__painted('page-dashboard', 4), any: window.__weekText(4) })`);
  await evaluate(`delete document.visibilityState; true`);
  await touch.up();
  await settleIdle('page-dashboard');
  assert(lockVis.oy === 'visible' && Math.abs(lockVis.rootLeft - REST) <= 0.5 && lockVis.any === 0,
    `E-4: backgrounded mid-swipe (hidden → visible), the lock lifts and the page and incoming week are put away (overflow-y ${lockVis.oy}, offset ${lockVis.rootLeft - REST}, Week 4 text nodes ${lockVis.any})`);
  // Fault injection (names the attribute, deliberately): a lock whose release never arrived.
  await evaluate(`document.getElementById('page-dashboard').dataset.weekSwipeDragging = 'true'`);
  const stale = await evaluate('window.__lock().oy');
  await touch.down(300, 500);
  const staleNext = await evaluate('window.__lock().oy');
  await touch.up();
  assert(stale === 'hidden' && staleNext === 'visible',
    `E-5: a lock left behind by a lost release is lifted at the very next touch's start (stale ${stale} → at touchstart ${staleNext})`);
  const yE0 = await evaluate('Math.round(scrollY)');
  await touch.down(250, 600);
  for (let i = 1; i <= 6; i++) await touch.move(250, 600 - i * 12);
  await touch.up();
  await sleep(300);
  const yE1 = await evaluate('Math.round(scrollY)');
  assert(yE1 > yE0 + 30, `E-6: …and the page scrolls again (${yE0} → ${yE1})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[F] Cost — one render of the incoming week per direction per drag, never one per move…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' }); window.__renders = 0`);
  await sleep(120);
  drag = await flatDrag('page-dashboard', 4, 330, 500, range(-10, -120, -10).concat([-100, -80, -60, -40, -30, -20]));
  const f1 = await evaluate('window.__renders');
  assert(f1 === 1 && inStrip(drag.find(s => s.dx === -120)).length >= 1,
    `F-1: an 18-move drag toward the next week renders the incoming week exactly ONCE (${f1} renders), and it was on screen`);
  await sleep(160);
  await touch.up();
  await settleIdle('page-dashboard');
  await evaluate('window.__renders = 0');
  // (A previous-week layer shows the RIGHT edge of its page first, and the
  // game names sit left in each card — so its text is on screen from ~+200.)
  drag = await flatDrag('page-dashboard', 2, 120, 500, [-10, -30, -60, -30, 0, 30, 60, 120, 180, 250, 180, 120, 60, 30, 20]);
  const f2 = await evaluate('window.__renders');
  const f2prev = drag.find(s => s.dx === 250);
  assert(f2 === 2 && inStripLeft(f2prev).length >= 1,
    `F-2: a drag that crosses to the other side renders each neighbour once — 2 renders, and the PREVIOUS week (Week 2) is on screen to the left at +250 (${f2} renders, ${inStripLeft(f2prev).length} Week 2 lines)`);
  await sleep(160);
  await touch.up();
  await settleIdle('page-dashboard');
  const fWeek = await painted('page-dashboard', 3);
  assert(fWeek.label === 'Week 3', `F-3: fixture — both drags were cancelled; still Week 3 (got "${fWeek.label}")`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[G] Reduce Motion — the drag still shows the incoming week; the release never animates movement…');
  // ═════════════════════════════════════════════════════════════════════════
  await reducedMotion(true);
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' })`);
  await sleep(120);
  drag = await flatDrag('page-dashboard', 4, 320, 500, range(-10, -120, -10));
  const g120 = drag.at(-1);
  assert(Math.abs(g120.rootLeft - REST - -120) <= 1.5 && inStrip(g120).length >= 1,
    `G-1: Reduce Motion — direct manipulation is not animation: the page follows the finger and Week 4 is beside it (offset ${g120.rootLeft - REST}, ${inStrip(g120).length} Week 4 lines)`);
  const refG = inStrip(g120)[0];
  await evaluate(`window.__startFrames('page-dashboard', 4, 360)`);
  await touch.up();
  fr = await frames(360);
  await settleIdle('page-dashboard');
  const gLanded = await painted('page-dashboard', 4);
  const landG = nearest(gLanded.visible, refG?.text, refG?.top);
  const afterRel = fr.slice(Math.max(0, fr.findIndex(f => f.anim === 'fade' || f.label === 'Week 4')));
  const strayG = afterRel.filter(f => f.visible.some(v => v.text === refG?.text && Math.abs(v.top - refG.top) <= 2 && Math.abs(v.left - landG?.left) > 1));
  assert(gLanded.label === 'Week 4' && afterRel.length >= 4 && strayG.length === 0,
    `G-2: Reduce Motion commit — from the release on, Week 4 is only ever painted AT REST (no frame part-way: ${strayG.length} found in ${afterRel.length}); it cross-fades in place (landed "${gLanded.label}")`);
  assert(afterRel.some(f => f.opacity > 0.05 && f.opacity < 0.95),
    `G-3: …and it is a cross-fade, not a cut (page opacity per frame: ${[...new Set(afterRel.map(f => Math.round(f.opacity * 100) / 100))].slice(0, 8).join(', ')})`);
  drag = await flatDrag('page-dashboard', 3, 120, 500, [10, 30, 60, 120, 180, 250]);
  assert(inStripLeft(drag.at(-1)).length >= 1, `G-4-pre: fixture — Reduce Motion, 250 px toward the previous week, Week 3 is beside the page (${inStripLeft(drag.at(-1)).length} lines)`);
  for (const dx of [180, 120, 60, 30]) await touch.move(120 + dx, 500);
  await sleep(160);   // back to 30 px and at rest: a cancel
  const gPre = await evaluate('window.__weekText(3)');
  await touch.up();
  const gPost = await evaluate(`({ n: window.__weekText(3), ...window.__painted('page-dashboard', 3) })`);
  assert(gPre > 0 && gPost.n === 0 && Math.abs(gPost.rootLeft - REST) <= 0.5 && gPost.label === 'Week 4',
    `G-4: Reduce Motion cancel — the page settles at once and the incoming week is dropped at once, not slid out (Week 3 text nodes ${gPre} before the release → ${gPost.n} right after it; offset ${gPost.rootLeft - REST}; "${gPost.label}")`);
  await settleIdle('page-dashboard');
  await reducedMotion(false);
  // The contrast that makes G-4 mean something: WITHOUT Reduce Motion the same
  // cancel keeps the incoming week sliding out with the page.
  drag = await flatDrag('page-dashboard', 3, 120, 500, [10, 30, 60, 120, 180, 250]);
  for (const dx of [180, 120, 60, 30]) await touch.move(120 + dx, 500);
  await sleep(160);
  await touch.up();
  const gSpring = await evaluate('window.__weekText(3)');
  await settleIdle('page-dashboard');
  const gGone = await evaluate('window.__weekText(3)');
  assert(gSpring > 0 && gGone === 0,
    `G-5: …while without Reduce Motion it rides the spring out and is gone once the spring ends (Week 3 text nodes right after release ${gSpring}, after the spring ${gGone})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[H] No regressions — the drawer still opens from the left quarter; pull-to-refresh still refreshes…');
  // ═════════════════════════════════════════════════════════════════════════
  const h0 = await painted('page-dashboard', 3);
  assert(h0.label === 'Week 4', `H-pre: fixture — the Dashboard shows Week 4 (got "${h0.label}")`);
  await evaluate('window.__renders = 0');
  const hd = [];
  await touch.down(40, 500);
  for (let x = 50; x <= 240; x += 10) {
    await touch.move(x, 500);
    hd.push(await evaluate(`({ ...window.__painted('page-dashboard', 3), open: document.querySelector('#control-center')?.dataset.open === 'true' })`));
  }
  const hRenders = await evaluate('window.__renders');
  await touch.up();
  await sleep(500);
  assert(hd.some(s => s.open) && hd.every(s => s.visible.length === 0 && Math.abs(s.rootLeft - REST) <= 0.5) && hRenders === 0,
    `H-1: a left-to-right drag from the left quarter opens the control center (SB-15 owner) — the week never moves and no previous week is rendered or painted (open ${hd.some(s => s.open)}, max Week 3 lines ${Math.max(...hd.map(s => s.visible.length))}, renders ${hRenders})`);
  await evaluate(`document.getElementById('control-center-backdrop')?.click()`);
  assert(await waitFor(`document.querySelector('#control-center')?.dataset.phase === 'closed'`, 3000), 'H-1b: fixture — the drawer closes again');
  await sleep(200);
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await sleep(150);
  await evaluate(`document.querySelector('#page-dashboard .dc-game, #page-dashboard .card').dataset.probe = 'ptr'`);
  await touch.down(250, 300);
  for (let y = 312; y <= 460; y += 12) await touch.move(250, y);
  await touch.up();
  const ptr = await waitFor(`!document.querySelector('#page-dashboard [data-probe="ptr"]')`, 3000);
  const hAfter = await painted('page-dashboard', 3);
  assert(ptr && hAfter.label === 'Week 4' && Math.abs(hAfter.rootLeft - REST) <= 0.5,
    `H-2: a pull down at the top still runs pull-to-refresh (the page repainted: ${ptr}) and never moves or changes the week ("${hAfter.label}", offset ${hAfter.rootLeft - REST})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[I] A live repaint mid-drag is parked; the incoming week stays up and keeps following the finger…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.scrollTo({ top: 300, behavior: 'instant' })`);
  await sleep(150);
  drag = await flatDrag('page-dashboard', 3, 100, 500, [60, 120, 180, 240]);
  await evaluate(`window.navigateTo('dashboard')`);   // the Realtime / live-score repaint path, mid-drag
  const parkedI = await evaluate(`import('./js/nav-gestures.js').then(m => m._deferredRenderCount())`);
  await touch.move(380, 500);                          // +280
  const i280 = { dx: 280, ...(await painted('page-dashboard', 3)) };
  const iMoved = pair(drag.at(-1), i280, inStripLeft);
  assert(parkedI === 1 && !!iMoved && Math.abs((iMoved.to - iMoved.from) - 40) <= 1.5,
    `I-1: a repaint landing mid-drag is PARKED (${parkedI}) and the incoming Week 3 stays up, still following the finger (+40 px: ${iMoved ? `${iMoved.from} → ${iMoved.to}` : 'gone'})`);
  for (const x of [300, 220, 160, 130]) await touch.move(x, 500);
  await sleep(160);
  await touch.up();
  await settleIdle('page-dashboard');
  const iAfter = await evaluate(`(async () => ({ ...window.__painted('page-dashboard', 3), parked: (await import('./js/nav-gestures.js'))._deferredRenderCount(), any: window.__weekText(3) }))()`);
  assert(iAfter.parked === 0 && iAfter.label === 'Week 4' && iAfter.any === 0 && Math.abs(iAfter.rootLeft - REST) <= 0.5,
    `I-2: …and on the (cancelled) release the parked repaint runs, the page rests on Week 4 and the incoming week is gone (parked ${iAfter.parked}, "${iAfter.label}", Week 3 text nodes ${iAfter.any})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[J] Blind rule — the preview of an OPEN week shows exactly what that week\'s page shows, never one pick more…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await sleep(120);
  drag = await flatDrag('page-dashboard', 5, 320, 500, range(-10, -120, -10));
  const jGate = await evaluate(`window.__textVisibleRight('page-dashboard', 'Submit Your Picks First')`);
  const jAny = await evaluate('window.__weekText(5)');
  // White-box, deliberately: the incoming layer's markup, to compare with the landed page's.
  const jPreview = await evaluate(`(document.querySelector('#page-dashboard .week-swipe-incoming-layer')?.firstElementChild?.innerHTML || '').replace(/\\s+/g, ' ').trim()`);
  assert(jGate, `J-1: Dashboard, swiping toward the OPEN Week 5 the viewer has not submitted — the incoming week shows the page's own blind gate ("Submit Your Picks First") in the uncovered strip`);
  assert(jAny === 0, `J-2: …and not one Week 5 game or pick is anywhere in the document while it is up (${jAny} text nodes) — five players' picks for Week 5 exist`);
  await touch.up();
  await settleIdle('page-dashboard');
  const jLanded = await evaluate(`({ label: document.querySelector('#page-dashboard .picks-week-nav-label')?.textContent || null, html: document.getElementById('page-dashboard').innerHTML.replace(/\\s+/g, ' ').trim() })`);
  assert(jPreview.length > 40 && jPreview === jLanded.html,
    `J-3: the preview IS the page — its markup equals what the Dashboard paints after landing on Week 5 (preview ${jPreview.length} chars, landed ${jLanded.html.length}; first difference at ${(() => { for (let i = 0; i < Math.max(jPreview.length, jLanded.html.length); i++) if (jPreview[i] !== jLanded.html[i]) return i; return 'none'; })()})`);
  await evaluate(`window.navigateTo('picks')`);
  await waitFor(`document.querySelector('#page-picks.active .picks-week-nav-label')`);
  assert(await toWeek('page-picks', 'Week 4'), 'J-pre: fixture — Picks shows Week 4');
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await sleep(120);
  drag = await flatDrag('page-picks', 5, 320, 500, range(-10, -120, -10));
  const jp = drag.at(-1);
  const jpPreview = await evaluate(`(document.querySelector('#page-picks .week-swipe-incoming-layer')?.firstElementChild?.innerHTML || '').replace(/\\s+/g, ' ').trim()`);
  assert(inStrip(jp).length >= 1, `J-4: Picks — Week 5's read-only slate is beside the page mid-swipe (${inStrip(jp).length} lines)`);
  await touch.up();
  await settleIdle('page-picks');
  const jpLanded = await evaluate(`({ html: document.getElementById('page-picks').innerHTML.replace(/\\s+/g, ' ').trim(), picks: document.querySelectorAll('#page-picks .hist-pick').length, label: document.querySelector('#page-picks .picks-week-nav-label')?.textContent })`);
  assert(jpLanded.label === 'Week 5' && jpLanded.picks === 0 && jpPreview === jpLanded.html,
    `J-5: Picks — the preview's markup equals the landed Week 5 page, which shows no pick of anyone's (the viewer has none; locked/open weeks never show others') (landed "${jpLanded.label}", pick badges ${jpLanded.picks}, equal ${jpPreview === jpLanded.html})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[K] A focused field inside the page — the swipe still works, renders no preview, and the field keeps focus and value…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`(() => { const i = document.createElement('input'); i.id = 'sb23-probe-input'; i.value = 'abc';
    document.getElementById('page-picks').prepend(i); i.focus(); window.__renders = 0; return true; })()`);
  drag = await flatDrag('page-picks', 4, 120, 500, [10, 30, 60, 120, 180, 250]);
  const k = await evaluate(`({ focused: document.activeElement?.id || null, value: document.getElementById('sb23-probe-input')?.value, renders: window.__renders, any: window.__weekText(4) })`);
  assert(k.focused === 'sb23-probe-input' && k.value === 'abc',
    `K-1: the focused field keeps focus and its value through the swipe (active "${k.focused}", value "${k.value}")`);
  assert(k.renders === 0 && k.any === 0 && Math.abs(drag.at(-1).rootLeft - REST - 250) <= 1.5,
    `K-2: …no preview is rendered (${k.renders} renders, ${k.any} Week 4 text nodes in the document), and the page still follows the finger (offset ${drag.at(-1).rootLeft - REST})`);
  for (const x of [300, 220, 160, 150]) await touch.move(x, 500);
  await sleep(160);
  await touch.up();
  await settleIdle('page-picks');
  await evaluate(`document.getElementById('sb23-probe-input')?.remove(); document.activeElement?.blur?.(); true`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[L] Inner scrollers keep their own offsets across the preview render…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`(() => { const s = document.createElement('div'); s.id = 'sb23-probe-scroller';
    s.style.cssText = 'overflow-x:auto;width:200px;height:24px'; s.innerHTML = '<div style="width:900px;height:20px">wide</div>';
    document.getElementById('page-picks').append(s); s.scrollLeft = 60; window.__renders = 0; return s.scrollLeft; })()`);
  drag = await flatDrag('page-picks', 4, 120, 500, [10, 30, 60, 120, 180, 250]);
  const l1 = await evaluate(`({ sl: document.getElementById('sb23-probe-scroller')?.scrollLeft, renders: window.__renders })`);
  assert(l1.renders === 1 && inStripLeft(drag.at(-1)).length >= 1, `L-pre: fixture — the preview rendered (${l1.renders}) and Week 4 is beside the page (${inStripLeft(drag.at(-1)).length} lines)`);
  assert(l1.sl === 60, `L-1: an inner scroller's offset survives the preview render (scrollLeft ${l1.sl}, was 60)`);
  for (const x of [300, 220, 160, 150]) await touch.move(x, 500);
  await sleep(160);
  await touch.up();
  await settleIdle('page-picks');
  const l2 = await evaluate(`document.getElementById('sb23-probe-scroller')?.scrollLeft`);
  assert(l2 === 60, `L-2: …and after the cancelled release (scrollLeft ${l2})`);
  await evaluate(`document.getElementById('sb23-probe-scroller')?.remove(); true`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[M] The incoming week is inert — nothing in it can take focus…');
  // ═════════════════════════════════════════════════════════════════════════
  drag = await flatDrag('page-picks', 4, 120, 500, [10, 30, 60, 120, 180, 250]);
  // Controls painted in the strip left of the page, app chrome (header, nav,
  // drawer) excluded: whatever is there belongs to the incoming week.
  const m = await evaluate(`(() => { const root = document.getElementById('page-picks'); const edge = root.getBoundingClientRect().left;
    const btns = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(b => { const r = b.getBoundingClientRect();
      return r.width && r.right <= edge + 1 && r.right > 0 && r.top < innerHeight && r.bottom > 0 && !b.closest('.app-header, .bottom-nav, #control-center, header, nav'); });
    const before = document.activeElement; let took = 0;
    for (const b of btns) { b.focus(); if (document.activeElement === b) took++; }
    return { n: btns.length, took, hidden: btns.every(b => !!b.closest('[aria-hidden="true"]')), back: document.activeElement === before }; })()`);
  assert(m.n >= 1 && m.took === 0 && m.hidden,
    `M-1: every control painted in the incoming week (${m.n}) refuses focus (${m.took} took it) and sits under aria-hidden (${m.hidden}) — a preview, never a second live page`);
  for (const x of [300, 220, 160, 150]) await touch.move(x, 500);
  await sleep(160);
  await touch.up();
  await settleIdle('page-picks');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[N] C1 (reviewer) — the preview paint never touches the live page\'s section-drag binding (SP-57)…');
  // ═════════════════════════════════════════════════════════════════════════
  // Week 3 gets a tiebreaker question (one more Dashboard section); Week 4, the
  // incoming week, has none — so a preview paint of Week 4 that reached the
  // engine would re-stamp the live page with a list missing that section.
  // (White-box by necessity: `_sectionDragOpts` is the engine's own record of
  // what the live paint handed it — js/section-drag.js attach().)
  const secPoint = (id) => evaluate(`(() => { const s = document.querySelector('#page-dashboard .layout-section[data-section-id="${id}"]');
    const h = s.querySelector('[data-section-header]'); const t = h.querySelector('.card-title') || h; const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(24, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`);
  const secOrder = () => evaluate(`[...document.querySelectorAll('#page-dashboard .layout-section[data-section-id]')].map(s => s.dataset.sectionId)`);
  // (createWeek() gives every week a default tiebreaker question, so Week 4's is cleared here: no question, no section.)
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.saveWeek({ ...st.getWeek('wk_3'), tiebreakerQuestion: 'Total points in the night game?' });
    st.saveWeek({ ...st.getWeek('wk_4'), tiebreakerQuestion: '' }); return true; })()`);
  // The shared week field is on Week 5, whose Dashboard is the blind gate (no
  // week card, no arrows) — move it with the Picks arrows (the field is shared).
  await toWeek('page-picks', 'Week 3');
  await evaluate(`window.navigateTo('dashboard')`);
  await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`);
  assert(await toWeek('page-dashboard', 'Week 3'), 'N-pre: fixture — the Dashboard shows Week 3');
  await evaluate(`window.navigateTo('dashboard'); window.scrollTo({ top: 0, behavior: 'instant' }); true`);
  await sleep(250);
  const n0 = await evaluate(`(() => { const r = document.getElementById('page-dashboard'); window.__liveOpts = r._sectionDragOpts || null;
    return { wired: !!r._sectionDragWired, visible: r._sectionDragOpts?.visible || null }; })()`);
  assert(n0.wired && Array.isArray(n0.visible) && n0.visible.includes('dash-tiebreaker') && n0.visible.length >= 3,
    `N-pre2: fixture — the live Week 3 paint handed the section-drag engine its visible list, tiebreaker included (${JSON.stringify(n0.visible)}; wired ${n0.wired})`);
  await evaluate('window.__renders = 0');
  drag = await flatDrag('page-dashboard', 4, 320, 500, range(-10, -120, -10));
  const nRenders = await evaluate('window.__renders');
  const nPrevIds = await evaluate(`[...document.querySelectorAll('#page-dashboard .week-swipe-incoming-layer .layout-section[data-section-id]')].map(s => s.dataset.sectionId)`);
  assert(nRenders === 1 && inStrip(drag.at(-1)).length >= 1 && nPrevIds.length >= 2 && !nPrevIds.includes('dash-tiebreaker'),
    `N-pre3: fixture — the preview of Week 4 rendered once, is on screen, and really has a DIFFERENT section set — no tiebreaker (${nRenders} renders; preview sections ${nPrevIds.join(',')})`);
  for (const dx of [-100, -60, -30, -20]) await touch.move(320 + dx, 500);
  await sleep(160);
  await touch.up();
  await settleIdle('page-dashboard');
  const n1 = await evaluate(`(() => { const r = document.getElementById('page-dashboard'); const o = r._sectionDragOpts || null;
    return { same: o === window.__liveOpts, visible: o?.visible || null, label: r.querySelector('.picks-week-nav-label')?.textContent,
      bar: !!document.getElementById('layout-edit-bar'), grips: r.querySelectorAll('.layout-grip').length }; })()`);
  assert(n1.label === 'Week 3' && n1.same && n1.visible?.includes('dash-tiebreaker'),
    `N-1: C1 — after a cancelled swipe the live page is still wired to the SAME options object its own paint stamped, with ITS visible list (same object ${n1.same}; visible ${JSON.stringify(n1.visible)}; still "${n1.label}")`);
  assert(!n1.bar && n1.grips === 0, `N-2: …and the preview mounted no edit bar and no grips on the live page (bar ${n1.bar}, grips ${n1.grips})`);
  // …so a REAL long-press section drag still works against the live list. The
  // engine REFUSES to arm when the page's sections and its `visible` list
  // disagree (js/section-drag.js beginGesture(): "a stale opts is a wiring
  // bug") — so the hazard C1 closes is a hold that does nothing at all until
  // the next paint. SP-57's own AT10 sequence: hold the tiebreaker, carry it
  // up through the top auto-scroll zone to the top of the page, drop it first.
  const order0 = await secOrder();
  assert(order0.join() === n0.visible.join(), `N-3-pre: fixture — the page shows the sections the engine was handed (${order0.join()})`);
  {
    const tb0 = await secPoint('dash-tiebreaker');
    await evaluate(`window.scrollTo({ top: Math.round(scrollY + ${tb0.y} - 400), left: 0, behavior: 'instant' })`);
    await sleep(340);   // the engine ignores a press within 120 ms of a scroll event (B2); a programmatic scroll fires one too
    const tb = await secPoint('dash-tiebreaker');
    await touch.down(tb.x, tb.y);
    await sleep(640);
    const lifted = await evaluate(`document.querySelectorAll('#page-dashboard [data-lifted]').length`);
    await touch.move(tb.x, tb.y - 40);
    await touch.move(tb.x, 56);                       // the top auto-scroll zone, under the edit bar
    for (let i = 0; i < 80; i++) { if ((await evaluate('Math.round(scrollY)')) <= 0) break; await sleep(100); }
    await touch.move(tb.x, 300);                      // off the edge; the held title sits near the top of the first card
    await sleep(200);
    await touch.up();
    await sleep(800);
    const order1 = await secOrder();
    const saved1 = await evaluate(`import('./js/storage.js').then(st => st.getSectionOrder('dashboard'))`);
    assert(lifted === 1, `N-3: after the cancelled swipe a 640 ms hold on a title still LIFTS its section (${lifted} lifted) — with the neighbour's list stamped on the page the engine refuses to arm`);
    assert(order1.join() === 'dash-tiebreaker,dash-picks,dash-alma,dash-summary' && saved1.join() === order1.join(),
      `N-3b: …and the drop reorders against the live list: the tiebreaker lands FIRST, on the page and in the saved layout (page ${order1.join()}; saved ${saved1.join()})`);
  }
  await evaluate(`(async () => { document.getElementById('layout-edit-bar')?.querySelector('.layout-bar-done')?.click();
    (await import('./js/storage.js')).clearSectionOrder('dashboard'); return true; })()`);
  await sleep(450);
  await evaluate(`window.navigateTo('dashboard')`);
  await sleep(200);
  assert(!(await evaluate(`!!document.getElementById('layout-edit-bar')`)), 'N-4: fixture — edit mode ended and the saved layout was cleared');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[S] FL1 (reviewer) — the preview guard is RELEASED: after a COMMITTED swipe the landed paint re-binds the section drag and mounts the edit bar…');
  // ═════════════════════════════════════════════════════════════════════════
  // [N] covers a CANCELLED swipe, where the live page keeps the paint it had —
  // so a `weekSwipePreviewRendering` that is never reset (the `finally` reset
  // lost: mutant FL1) passes it, because nothing new is painted. A COMMITTED
  // swipe is where a stuck guard shows: the landed renderDashboard() would skip
  // bindLayoutEditHandlers() and syncLayoutEditBar(), leaving the engine on an
  // OLD week's list (so it refuses to arm) and edit mode with no Done bar (and
  // the week swipe, which suspends on that bar, live under an edit). [N]'s
  // fixture still stands: Week 3 has the tiebreaker section, Week 4 does not.
  await evaluate(`window.navigateTo('dashboard')`);
  await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`);
  assert(await toWeek('page-dashboard', 'Week 3'), 'S-pre: fixture — the Dashboard shows Week 3');
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' }); true`);
  await sleep(250);
  const s0 = await evaluate(`document.getElementById('page-dashboard')._sectionDragOpts?.visible || null`);
  assert(Array.isArray(s0) && s0.includes('dash-tiebreaker'),
    `S-pre2: fixture — the live Week 3 page handed the engine a list WITH the tiebreaker (${JSON.stringify(s0)})`);
  drag = await flatDrag('page-dashboard', 4, 320, 500, range(-10, -120, -10));
  await touch.up();
  await settleIdle('page-dashboard');
  const s1 = await evaluate(`(() => { const r = document.getElementById('page-dashboard');
    return { label: r.querySelector('.picks-week-nav-label')?.textContent, visible: r._sectionDragOpts?.visible || null,
      dom: [...r.querySelectorAll('.layout-section[data-section-id]')].map(s => s.dataset.sectionId) }; })()`);
  assert(s1.label === 'Week 4' && s1.dom.length >= 2 && !s1.dom.includes('dash-tiebreaker') && JSON.stringify(s1.visible) === JSON.stringify(s1.dom),
    `S-1: FL1 — after a COMMITTED swipe to Week 4 (no tiebreaker) the engine holds the LANDED week's list (landed "${s1.label}"; engine ${JSON.stringify(s1.visible)}; page ${s1.dom.join(',')})`);
  {
    const sid = s1.dom[1];
    const sp0 = await secPoint(sid);
    await evaluate(`window.scrollTo({ top: Math.max(0, Math.round(scrollY + ${sp0.y} - 400)), left: 0, behavior: 'instant' })`);
    await sleep(340);   // the engine ignores a press within 120 ms of a scroll event (B2)
    const sp = await secPoint(sid);
    await touch.down(sp.x, sp.y);
    await sleep(640);
    const s2 = await evaluate(`({ lifted: document.querySelectorAll('#page-dashboard [data-lifted]').length,
      id: document.querySelector('#page-dashboard [data-lifted]')?.dataset.sectionId || null,
      done: !!document.querySelector('#layout-edit-bar .layout-bar-done') })`);
    await touch.up();
    await sleep(800);
    assert(s2.lifted === 1 && s2.id === sid && s2.done,
      `S-2: …and a 640 ms hold on "${sid}" LIFTS it and mounts the edit bar's Done (${s2.lifted} lifted, ${s2.id}; Done ${s2.done}) — a stuck guard leaves the engine on a stale list (it refuses to arm) and mounts no bar`);
  }
  await evaluate(`(async () => { document.getElementById('layout-edit-bar')?.querySelector('.layout-bar-done')?.click();
    (await import('./js/storage.js')).clearSectionOrder('dashboard'); return true; })()`);
  await sleep(450);
  await evaluate(`window.navigateTo('dashboard')`);
  await sleep(200);
  assert(!(await evaluate(`!!document.getElementById('layout-edit-bar')`)), 'S-3: fixture — edit mode ended and the saved layout was cleared');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[R] N3 (reviewer) — what the preview render can disturb comes back: the document scroll (deep, toward a SHORT week) and the page element\'s classes…');
  // ═════════════════════════════════════════════════════════════════════════
  // The standard (wide matrix) layout READS layout in the middle of its render
  // (initScrollFades() → scrollWidth). With the live page parked and a SHORT
  // week (Week 1: one game) in its place, that read is the moment the document
  // would clamp a deep scroll — Blink clamps synchronously and the clamp
  // sticks after the live nodes go back (measured 2026-10-01: emptied page,
  // forced layout, scrollY 2108 → 0, and 0 after restoring). The probe records
  // scrollY AT that read, the one point a frame-level probe cannot see.
  const DRAG_L = [10, 30, 60, 120, 180, 250], BACK_L = [180, 120, 60, 30];
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const p = st.getPlayer('pl_drew');
    st.savePlayer({ ...p, preferences: { ...(p.preferences || {}), dashboardLayout: 'standard' } }); return true; })()`);
  await evaluate(`window.navigateTo('dashboard')`);
  await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`);
  assert(await toWeek('page-dashboard', 'Week 2'), 'R-pre: fixture — the Dashboard shows Week 2');
  const rStd = await evaluate(`!!document.querySelector('#page-dashboard .dashboard-scroll')`);
  assert(rStd, 'R-pre2: fixture — the Dashboard is in the STANDARD layout (the wide matrix in a .dashboard-scroll)');
  await evaluate(`window.scrollTo({ top: document.scrollingElement.scrollHeight - innerHeight, left: 0, behavior: 'instant' })`);
  await sleep(250);
  const yR = await evaluate('Math.round(scrollY)');
  // A class a Dashboard render strips (renderDashboardInner() clears it), set on the live page: it must come back.
  const cls0 = await evaluate(`(() => { const r = document.getElementById('page-dashboard'); r.classList.add('layout-editing'); return r.className; })()`);
  await evaluate(`(() => { window.__midY = []; window.__swDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get() { const v = window.__swDesc.get.call(this); window.__midY.push(Math.round(scrollY)); return v; } });
    return true; })()`);
  drag = await flatDrag('page-dashboard', 1, 120, 500, DRAG_L);
  const rMid = await evaluate(`({ midY: window.__midY.slice(), w1: window.__weekText(1) })`);
  await evaluate(`(() => { Object.defineProperty(Element.prototype, 'scrollWidth', window.__swDesc); return true; })()`);
  const rH1 = await evaluate(`(() => { const l = document.querySelector('#page-dashboard .week-swipe-incoming-layer'); return l ? Math.round(l.firstElementChild.getBoundingClientRect().height) : null; })()`);
  assert(yR > 1000 && rMid.midY.length >= 1 && rMid.w1 > 0,
    `R-0: fixture — deep in Week 2 (scrollY ${yR}), the preview of the SHORT Week 1 (${rH1} px of page) rendered and read layout mid-render (${rMid.midY.length} reads)`);
  assert(rMid.midY.every(y => y === yR) && drag.every(s => Math.abs(s.scrollY - yR) <= 0.5),
    `R-1: the document scroll NEVER moves — not at the layout read in the middle of the preview render (scrollY there ${[...new Set(rMid.midY)].join(',')}), not on any move (${[...new Set(drag.map(s => s.scrollY))].join(',')}); want ${yR}`);
  for (const dx of BACK_L) await touch.move(120 + dx, 500);
  await sleep(160);
  await touch.up();
  await settleIdle('page-dashboard');
  // Fault injection (deliberate): a render that MOVES the document mid-render
  // (what a future focus() or scrollIntoView() inside a page render would do)
  // is undone before the frame.
  await evaluate(`(() => { window.__swDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth'); let once = false;
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get() { if (!once) { once = true; window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } return window.__swDesc.get.call(this); } });
    return true; })()`);
  drag = await flatDrag('page-dashboard', 1, 120, 500, DRAG_L);
  await evaluate(`(() => { Object.defineProperty(Element.prototype, 'scrollWidth', window.__swDesc); return true; })()`);
  assert(drag.every(s => Math.abs(s.scrollY - yR) <= 0.5),
    `R-2: a render that scrolls the document in the middle of the preview is put back before any frame (scrollY per move ${[...new Set(drag.map(s => s.scrollY))].join(',')}; want ${yR})`);
  for (const dx of BACK_L) await touch.move(120 + dx, 500);
  await sleep(160);
  await touch.up();
  await settleIdle('page-dashboard');
  const rEnd = await evaluate(`({ y: Math.round(scrollY), cls: document.getElementById('page-dashboard').className, label: document.querySelector('#page-dashboard .picks-week-nav-label')?.textContent })`);
  assert(rEnd.y === yR && rEnd.label === 'Week 2', `R-3: …and after both cancelled swipes the page is where it was (scrollY ${rEnd.y}, "${rEnd.label}")`);
  assert(rEnd.cls === cls0, `R-4: the page element's classes come back exactly — including the one a Dashboard render strips (before "${cls0}", after "${rEnd.cls}")`);
  await evaluate(`(async () => { document.getElementById('page-dashboard').classList.remove('layout-editing');
    const st = await import('./js/storage.js'); const p = st.getPlayer('pl_drew'); const pr = { ...(p.preferences || {}) }; delete pr.dashboardLayout;
    st.savePlayer({ ...p, preferences: pr }); window.navigateTo('dashboard'); window.scrollTo({ top: 0, behavior: 'instant' }); return true; })()`);
  await sleep(250);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[O] N4 (reviewer) — preview === landed for an OPEN week the viewer HAS submitted (masked cells) and for a LOCKED week…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const mine = st.getGames('wk_5').map((g, gi) => ({ ...dm.createPick('wk_5', g.gameId, 'pl_drew', gi % 2 ? g.homeTeam : g.awayTeam), pickId: 'pk_5_' + gi + '_drew', submittedAt: '2026-09-30T00:00:00Z' }));
    st.saveAllPicks([...st.getPicks(), ...mine]); return st.hasPlayerSubmitted('wk_5', 'pl_drew'); })()`);
  const swipeEq = async (tag) => {
    await evaluate(`window.navigateTo('dashboard')`);
    await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`);
    await toWeek('page-dashboard', 'Week 4');
    await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
    await sleep(150);
    drag = await flatDrag('page-dashboard', 5, 320, 500, range(-10, -120, -10));
    const pv = await evaluate(`(document.querySelector('#page-dashboard .week-swipe-incoming-layer')?.firstElementChild?.innerHTML || '').replace(/\\s+/g, ' ').trim()`);
    await touch.up();
    await settleIdle('page-dashboard');
    const ld = await evaluate(`({ label: document.querySelector('#page-dashboard .picks-week-nav-label')?.textContent, html: document.getElementById('page-dashboard').innerHTML.replace(/\\s+/g, ' ').trim() })`);
    return { pv, ld, tag };
  };
  const oOpen = await swipeEq('open-submitted');
  assert(oOpen.ld.label === 'Week 5' && /blind-note/.test(oOpen.pv) && oOpen.pv === oOpen.ld.html,
    `O-1: OPEN, the viewer submitted — the preview carries the page's own masked cells and blind note, and equals the landed page (landed "${oOpen.ld.label}", blind note in preview ${/blind-note/.test(oOpen.pv)}, ${oOpen.pv.length} vs ${oOpen.ld.html.length} chars, equal ${oOpen.pv === oOpen.ld.html})`);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.saveWeek({ ...st.getWeek('wk_5'), status: 'locked' }); return true; })()`);
  const oLocked = await swipeEq('locked');
  assert(oLocked.ld.label === 'Week 5' && oLocked.pv.length > 200 && oLocked.pv === oLocked.ld.html,
    `O-2: LOCKED — the preview equals the landed page (landed "${oLocked.ld.label}", ${oLocked.pv.length} vs ${oLocked.ld.html.length} chars, equal ${oLocked.pv === oLocked.ld.html})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[P] N6 (reviewer) — the week ARROWS land at the top in one step too, the way the swipe does…');
  // ═════════════════════════════════════════════════════════════════════════
  const arrowLands = async (tab, page, from, to) => {
    await evaluate(`window.navigateTo('${tab}')`);
    await waitFor(`document.querySelector('#${page}.active .picks-week-nav-label')`);
    await toWeek(page, from);
    await evaluate(`window.scrollTo({ top: 500, left: 0, behavior: 'instant' })`);
    await sleep(200);
    const y0 = await evaluate('Math.round(scrollY)');
    await evaluate(`window.__startFrames('${page}', 0, 450)`);
    await evaluate(`document.querySelector('#${page} .picks-week-nav > button[aria-label="Next week"]').click()`);
    const f = await frames(450);
    const after = f.slice(Math.max(0, f.findIndex(x => x.label === to)));
    return { y0, after, labels: [...new Set(f.map(x => x.label))] };
  };
  const pA = await arrowLands('picks', 'page-picks', 'Week 2', 'Week 3');
  assert(pA.y0 >= 400 && pA.after.length >= 6 && pA.after.every(x => x.scrollY === 0),
    `P-1: Picks › from ${pA.y0} px down — Week 3 is at the top on its first frame and every frame after (scrollY ${[...new Set(pA.after.map(x => x.scrollY))].join(' → ')}; ${pA.labels.join(' → ')}) — no glide under html{scroll-behavior:smooth}`);
  const dA = await arrowLands('dashboard', 'page-dashboard', 'Week 3', 'Week 4');
  assert(dA.y0 >= 400 && dA.after.length >= 6 && dA.after.every(x => x.scrollY === 0),
    `P-2: Dashboard › from ${dA.y0} px down — Week 4 is at the top in one step (scrollY ${[...new Set(dA.after.map(x => x.scrollY))].join(' → ')}; ${dA.labels.join(' → ')})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[Q] N1 (reviewer) — an engine that REJECTS behavior:\'instant\' (iOS 15) still lands the swipe and the arrows at the top, and nothing throws…');
  // ═════════════════════════════════════════════════════════════════════════
  // Fault injection: window.scrollTo throws the TypeError an engine without
  // the 'instant' enum value throws for the options form.
  await evaluate(`window.navigateTo('picks')`);
  await waitFor(`document.querySelector('#page-picks.active .picks-week-nav-label')`);
  await toWeek('page-picks', 'Week 2');
  await evaluate(`(() => { window.__errs = []; window.__onErr = (e) => window.__errs.push(String(e.message || e)); window.addEventListener('error', window.__onErr);
    window.__origScrollTo = window.scrollTo;
    window.scrollTo = function (a, b) { if (a && typeof a === 'object' && a.behavior === 'instant') throw new TypeError("The provided value 'instant' is not a valid enum value of type ScrollBehavior."); return window.__origScrollTo.call(window, a, b); };
    window.__origScrollTo.call(window, { top: 500, left: 0, behavior: 'instant' }); return true; })()`);
  await sleep(200);
  const qY0 = await evaluate('Math.round(scrollY)');
  drag = await flatDrag('page-picks', 3, 320, 500, range(-10, -120, -10));
  await touch.up();
  await settleIdle('page-picks');
  await waitFor('Math.round(scrollY) === 0', 2500);    // the numeric fallback may be smoothed by the stylesheet — it still arrives
  const q1 = await evaluate(`({ y: Math.round(scrollY), label: document.querySelector('#page-picks .picks-week-nav-label')?.textContent, errs: window.__errs.slice() })`);
  assert(qY0 >= 400 && q1.label === 'Week 3' && q1.y === 0 && q1.errs.length === 0,
    `Q-1: the swipe commits and lands at the top with 'instant' rejected (from ${qY0}: "${q1.label}", scrollY ${q1.y}; errors ${JSON.stringify(q1.errs)})`);
  await evaluate(`window.__origScrollTo.call(window, { top: 500, left: 0, behavior: 'instant' }); true`);
  await sleep(200);
  await evaluate(`document.querySelector('#page-picks .picks-week-nav > button[aria-label="Next week"]').click()`);
  await waitFor('Math.round(scrollY) === 0', 2500);
  const q2 = await evaluate(`({ y: Math.round(scrollY), label: document.querySelector('#page-picks .picks-week-nav-label')?.textContent, errs: window.__errs.slice() })`);
  assert(q2.label === 'Week 4' && q2.y === 0 && q2.errs.length === 0,
    `Q-2: …and so does the › arrow ("${q2.label}", scrollY ${q2.y}; errors ${JSON.stringify(q2.errs)})`);
  await evaluate(`(() => { window.scrollTo = window.__origScrollTo; window.removeEventListener('error', window.__onErr); return true; })()`);
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
