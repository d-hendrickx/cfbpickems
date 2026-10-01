/**
 * CFB Pickems — weekswipetest.mjs
 * ===============================
 * ENGINE-MEASURED week swipe, reorder arbitration and week-title centring,
 * driven through the REAL app: the real index.html, css/styles.css and
 * js/app.js booted in a real headless Chromium, six players and four final
 * weeks seeded through the app's OWN js/storage.js + js/data-model.js, the
 * Dashboard and Picks tabs opened through the real navigateTo() (which is
 * what binds bindWeekSwipe(), the real block-check gesturesSuspended() and
 * the control-center edge swipe), and every gesture a REAL touch sequence
 * (CDP Input.dispatchTouchEvent) hit-tested by the engine. Nothing about the
 * page, the binders or the chips is a fixture. Testing Protocol 168: a
 * gesture binder needs one test that opens its surface through the real
 * app.js path with the real block-check — this is that test for the week
 * swipe and the compact-Dashboard reorder.
 *
 *   [A] RG-TBD-A1 (Drew, 2026-09-29, live v0.27.2): "when swiping left and
 *       right in dashboard and picks I still dont have the visual feedback of
 *       the screen swiping left and right, instead it just jumps to the next
 *       week. I want to watch the current week slide out and the next week
 *       slide in." Measured here: the week follows the finger for the WHOLE
 *       drag (1:1, not just the first 40 px), the displayed week never
 *       changes while the finger is down, release past the threshold slides
 *       both weeks together (intermediate frames with both layers on screen),
 *       a short release springs back, the first/last week rubber-bands and
 *       springs back without navigating, a vertical drag never moves the page
 *       sideways, and under Reduce Motion the week still follows the finger
 *       but the release never animates movement (a commit cross-fades, a
 *       cancel settles at once — the rule the chat reply swipe shares).
 *
 *   [B] RG-TBD-A2 (Drew, same day): "when pressing a name in the compact
 *       dashboard and rearranging the order, the phone gets confused and
 *       thinks i'm trying to swipe between weeks". Measured here: after a
 *       long-press puts a chip into reorder mode, a horizontal drag across
 *       the row neither moves nor changes the week, never opens the control
 *       center (the chip in the left quarter is inside the drawer's zone), and
 *       the reorder lands; the reverse — a week swipe that has locked
 *       horizontally, then holds still past the long-press delay — never
 *       enters reorder mode.
 *
 *   [C] RG-TBD-A3 (Drew, same day): "the week title at top of the dashboard
 *       is not centered". Measured here: the week name line and the date line
 *       are centred on the week card (±1 px) at 320/390/430/768/1280 px, with
 *       the web arrows, with the native shell's arrows hidden, on a
 *       single-week league (no arrows rendered at all), and with
 *       deliberately asymmetric arrows.
 *
 *   [D] RG-TBD-A4 (Drew, same day, iOS app): "The ios vertical scroll barely
 *       rubberband overscolls on the bottom and doesn't at all on the top".
 *       Root cause is NATIVE (Capacitor's CAPBridgeViewController sets
 *       scrollView.bounces = false; the fix is the iOS thread's). Pinned here:
 *       the web layer never suppresses vertical overscroll — on Picks,
 *       Dashboard, Standings, Rules and Chat every touch/wheel listener on the
 *       scroll chain is passive, no vertical pull at the top or push at the
 *       bottom is ever defaultPrevented (reorder chips and the week swipe's
 *       direction lock included), and the root keeps overscroll-behavior:auto
 *       (Chat's thread, by RG-289's design, is its own bouncing scroller).
 *       A GUARD, not a reproduction: this layer was never the cause.
 *
 * The app boots in LOCAL (PIN) mode: this suite's own localhost server
 * answers /config.json with `{}` (the real config.json is never read) and
 * 404s service-worker.js. ALL other network resolution is blocked (fallback
 * fonts, no ESPN, no Supabase) — every assertion is a RELATION (follows the
 * finger, both layers on screen, centred), which does not depend on the font.
 *
 * WHAT ONLY A DEVICE CAN CONFIRM: Blink is not WebKit. The feel of the slide
 * on an iPhone (frame pacing under a real finger, iOS's own scroll view
 * taking a diagonal drag, Reduce Motion as the phone reports it) is Drew's
 * on-device walk, listed in the RG row.
 *
 * Run: node weekswipetest.mjs   (spawned by loadtest.mjs; serialise Chrome
 * suites on a shared Mac with `lockf /tmp/cfbp-loadtest.lock`)
 * Override the browser: WEEKSWIPE_ENGINE=/path/to/Chromium (falls back to
 * WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then the usual paths).
 * Mutation runs: WEEKSWIPE_ROOT=/path/to/a/COPY/of/cfb-pickems serves that
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
const ROOT = process.env.WEEKSWIPE_ROOT || here;
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
const override = process.env.WEEKSWIPE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: WEEKSWIPE_ENGINE=/path/to/Chromium node weekswipetest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (WEEKSWIPE_ROOT — serving ${ROOT})`);

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

// ── the CDP client (same shape as wizardsheettest.mjs / shellrendertest.mjs) ─
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-weekswipe-'));
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
  const reducedMotion = async (on) => {
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
    await sleep(50);
  };
  // Real touches, hit-tested by the engine. `touch` keeps the finger's last
  // point so a caller can move and release in separate steps.
  const touch = {
    async down(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); },
    // Chrome delivers touchmove aligned to the next frame, so wait one frame
    // before anything reads what the move did.
    async move(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(16); await evaluate('new Promise(r => requestAnimationFrame(() => r(true)))'); },
    async up() { await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
    // Explicit event times (ms since epoch -> CDP's seconds), so a velocity
    // test measures the gesture it describes, not how loaded this Mac is.
    async downAt(x, y, ms) { await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: ms / 1000 }); },
    async moveAt(x, y, ms) { await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }], timestamp: ms / 1000 }); },
    async upAt(ms) { await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ms / 1000 }); },
  };

  // What the page is showing, and where: the week the card names, the page's
  // painted horizontal offset (its rect vs. its resting rect — includes any
  // transform), the outgoing clone layer if one exists, and the page opacity.
  const PAGE = (id) => `(() => {
    const root = document.getElementById('${id}');
    const label = root?.querySelector('.picks-week-nav-label')?.textContent || null;
    const r = root.getBoundingClientRect();
    const clone = document.querySelector('.week-swipe-exit-layer');
    const cr = clone ? clone.getBoundingClientRect() : null;
    const rest = root.parentElement.getBoundingClientRect().left + parseFloat(getComputedStyle(root.parentElement).paddingLeft || '0');
    return { label, x: Math.round((r.left - rest) * 10) / 10, w: Math.round(r.width), cloneX: cr ? Math.round((cr.left - rest) * 10) / 10 : null,
      cloneOpacity: clone ? Number(getComputedStyle(clone).opacity) : null,
      opacity: Number(getComputedStyle(root).opacity), animating: root.dataset.weekSwipeAnimating || null,
      drawer: !!document.querySelector('#control-center[data-open="true"]') };
  })()`;
  // A per-frame recorder for the release half of a gesture — every rAF for
  // `ms`, the same fields as PAGE, so "did it slide or did it jump" is a
  // question about real frames, not about the end state.
  const startFrames = (id, ms) => evaluate(`(() => {
    window.__frames = []; const t0 = performance.now();
    const probe = () => ${PAGE(id).replace(/\n\s*/g, ' ')};
    (function loop() { const s = probe(); s.t = Math.round(performance.now() - t0); window.__frames.push(s); if (performance.now() - t0 < ${ms}) requestAnimationFrame(loop); })();
    return true;
  })()`);
  const frames = async (ms) => { await sleep(ms + 80); return evaluate('window.__frames'); };
  const dragH = async (id, x0, y, x1, step = 10) => {   // a horizontal drag, sampled after every move
    const out = [];
    await touch.down(x0, y);
    const dir = Math.sign(x1 - x0);
    for (let x = x0 + dir * step; dir > 0 ? x <= x1 : x >= x1; x += dir * step) {
      await touch.move(x, y + (Math.abs(x - x0) > 30 ? 2 : 0));   // a real finger drifts a little vertically
      out.push({ dx: x - x0, ...(await evaluate(PAGE(id))) });
    }
    return out;
  };
  const settleIdle = async (id) => {
    await waitFor(`!document.querySelector('.week-swipe-exit-layer') && !document.getElementById('${id}').dataset.weekSwipeAnimating`, 3000);
    await sleep(60);
  };

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode), seed six players and four final weeks with picks…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(390, 844);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`),
    '1-0: fixture — the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
    const players = NAMES.map((n, i) => ({ ...dm.createPlayer(n, '', '1234', '', n.slice(0, 2).toUpperCase()), playerId: 'pl_' + n.toLowerCase() }));
    players.forEach(p => st.savePlayer(p));
    const picks = [];
    for (let wn = 1; wn <= 4; wn++) {
      const wk = { ...dm.createWeek(2026, wn), weekId: 'wk_' + wn, status: 'final' };
      st.saveWeek(wk);
      for (let gi = 0; gi < 8; gi++) {
        const g = dm.createGame(wk.weekId, { gameId: 'g_' + wn + '_' + gi, homeTeam: 'Home ' + wn + '-' + gi, awayTeam: 'Away ' + wn + '-' + gi,
          kickoff: new Date(Date.UTC(2026, 8, wn * 7, 17 + (gi % 4))).toISOString(), kickoffConfirmed: true,
          spread: -3.5, lockedSpread: -3.5, homeScore: 24 + gi, awayScore: 17, status: 'final' });
        st.saveGame(g);
        players.forEach((p, pi) => picks.push({ ...dm.createPick(wk.weekId, g.gameId, p.playerId, (gi + pi) % 2 ? g.homeTeam : g.awayTeam),
          pickId: 'pk_' + wn + '_' + gi + '_' + pi, submittedAt: '2026-09-01T00:00:00Z' }));
      }
    }
    st.saveAllPicks(picks);
    st.setActiveWeekId('wk_2');
    st.setSession('pl_drew', false, true);
    await new Promise(r => setTimeout(r, 1200));   // storage.js's debounced write lands
    // Local mode boots with its own starter records beside these; count ours.
    return { players: st.getPlayers().filter(p => p.playerId.startsWith('pl_')).length,
      weeks: st.getWeeks().filter(w => w.weekId.startsWith('wk_')).length, picks: st.getPicks().filter(p => p.pickId.startsWith('pk_')).length };
  })()`);
  assert(seeded.players === 6 && seeded.weeks === 4 && seeded.picks === 6 * 8 * 4,
    `1-1: fixture — 6 players, 4 final weeks, 192 picks seeded through the app's own storage.js (got ${JSON.stringify(seeded)})`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`),
    '1-2: fixture — after reload the app is past the site gate with a verified player session');
  await evaluate(`window.navigateTo('dashboard')`);
  assert(await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`),
    '1-3: fixture — navigateTo("dashboard") (the real path that binds the week swipe) rendered the week card');
  const boot = await evaluate(`(async () => ({ label: document.querySelector('#page-dashboard .picks-week-nav-label').textContent,
    chips: document.querySelectorAll('#page-dashboard .dc-chip[draggable="true"]').length,
    suspended: (await import('./js/nav-gestures.js')).gesturesSuspended(), vw: innerWidth }))()`);
  assert(boot.label === 'Week 2' && boot.chips >= 12 && boot.suspended === false,
    `1-4: fixture — the Dashboard shows the current week (Week 2), in the COMPACT layout with draggable chips (${boot.chips}), and no overlay suspends gestures (label "${boot.label}", suspended ${boot.suspended})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] RG-TBD-A1 — the week follows the finger, then slides; short drags spring back; edges resist…');
  // ═════════════════════════════════════════════════════════════════════════
  // A right-to-left drag of 170 px starting at x=320 (outside the drawer's
  // left-quarter zone), on the week card's row height so it lands on page content.
  const cardY = await evaluate(`(() => { const r = document.querySelector('#page-dashboard .dc-game')?.getBoundingClientRect(); return r ? Math.round(r.top + 12) : 400; })()`);
  let drag = await dragH('page-dashboard', 320, cardY, 150);
  const at = (dx) => drag.find(s => s.dx === dx);
  const mid = [at(-60), at(-120), at(-170)];
  assert(mid.every(s => s && s.label === 'Week 2'),
    `A-1: THE BUG — the displayed week does NOT change while the finger is still down, even 60/120/170 px into the drag (labels: ${mid.map(s => s?.label).join(', ')}; v0.27.2 swapped to the next week at 40 px)`);
  assert(mid.every(s => s && Math.abs(s.x - s.dx) <= 1.5 && s.cloneX === null),
    `A-2: THE BUG — the page follows the finger 1:1 for the whole drag, not just the first 40 px (page offset at dx −60/−120/−170: ${mid.map(s => s?.x).join(' / ')}; an animating clone present: ${mid.map(s => s?.cloneX !== null).join('/')})`);
  assert(drag.every(s => s.animating === null), `A-3: no transition is attached while the finger drives the page — raw tracking, never lagging behind it (${[...new Set(drag.map(s => s.animating))].join(',')})`);
  await startFrames('page-dashboard', 520);
  await touch.up();
  let fr = await frames(520);
  const both = fr.filter(f => f.cloneX !== null && f.cloneX < -171 && f.cloneX > -f.w + 1 && f.x > 0 && f.x < f.w - 171);
  assert(both.length >= 4,
    `A-4: THE BUG — after release BOTH weeks are on screen and moving together: ${both.length} frames with the outgoing week part-way off to the left and the incoming week part-way in from the right (need ≥4; frames: ${JSON.stringify(fr.slice(0, 8).map(f => [f.t, f.x, f.cloneX]))})`);
  const firstMoving = fr.find(f => f.cloneX !== null);
  assert(!!firstMoving && Math.abs((firstMoving.x) - (firstMoving.cloneX + firstMoving.w)) <= 2,
    `A-5: the incoming week starts flush against the outgoing one — no gap, no jump back to the resting position on release (first frame: incoming at ${firstMoving?.x}, outgoing right edge at ${firstMoving ? firstMoving.cloneX + firstMoving.w : null})`);
  await settleIdle('page-dashboard');
  let now = await evaluate(PAGE('page-dashboard'));
  assert(now.label === 'Week 3' && Math.abs(now.x) <= 0.5 && now.cloneX === null && now.animating === null,
    `A-6: it lands on the NEXT week (Week 3), at rest, with the outgoing layer removed (label "${now.label}", offset ${now.x}, clone ${now.cloneX}, animating ${now.animating})`);

  // A-7..9 — release SHORT of the threshold: springs back, never navigates.
  drag = await dragH('page-dashboard', 300, cardY, 270);
  assert(Math.abs(drag.at(-1).x - -30) <= 1.5 && drag.at(-1).label === 'Week 3', `A-7: fixture — a 30 px drag follows the finger (offset ${drag.at(-1).x}) on Week 3`);
  await sleep(150);   // the finger rests before lifting — distance decides (a FAST 30 px flick commits: A-24)
  await startFrames('page-dashboard', 300);
  await touch.up();
  fr = await frames(300);
  assert(fr.some(f => f.x < -2 && f.x > -28), `A-8: a release short of the threshold SPRINGS back through intermediate frames, not a snap (${JSON.stringify(fr.slice(0, 6).map(f => f.x))})`);
  await settleIdle('page-dashboard');
  now = await evaluate(PAGE('page-dashboard'));
  assert(now.label === 'Week 3' && Math.abs(now.x) <= 0.5, `A-9: …and stays on Week 3, at rest (label "${now.label}", offset ${now.x})`);

  // A-10..12 — at the LAST week: resist, spring back, never navigate.
  drag = await dragH('page-dashboard', 320, cardY, 150);   // Week 3 → Week 4
  await touch.up();
  await settleIdle('page-dashboard');
  assert((await evaluate(PAGE('page-dashboard'))).label === 'Week 4', 'A-10: fixture — a second swipe reaches the last week (Week 4)');
  drag = await dragH('page-dashboard', 320, cardY, 120);
  const edge = drag.at(-1);
  assert(edge.label === 'Week 4' && edge.x < -2 && edge.x > -49 && Math.abs(edge.x) < 200 / 3,
    `A-11: at the last week a 200 px "next" drag is RESISTED — the page moves a little (rubber band, ${edge.x} px, cap 48), never 1:1 and never onto a week that does not exist`);
  await touch.up();
  await settleIdle('page-dashboard');
  now = await evaluate(PAGE('page-dashboard'));
  assert(now.label === 'Week 4' && Math.abs(now.x) <= 0.5, `A-12: …and release springs it back to rest on Week 4 (label "${now.label}", offset ${now.x})`);

  // A-13..14 — the other direction, on PICKS (same binder, the Picks getter).
  await evaluate(`window.navigateTo('picks')`);
  assert(await waitFor(`document.querySelector('#page-picks.active .picks-week-nav-label')`), 'A-13-pre: fixture — navigateTo("picks") rendered the Picks week card');
  const picksLabel0 = await evaluate(`document.querySelector('#page-picks .picks-week-nav-label').textContent`);
  drag = await dragH('page-picks', 130, 420, 300);   // left→right, starting outside the drawer's left quarter (97.5 px at 390)
  const pMid = drag.find(s => s.dx === 120);
  assert(pMid && pMid.label === picksLabel0 && Math.abs(pMid.x - 120) <= 1.5,
    `A-13: THE BUG, Picks — 120 px into a left→right drag the page follows the finger (offset ${pMid?.x}) and still shows ${picksLabel0} (label "${pMid?.label}")`);
  await touch.up();
  await settleIdle('page-picks');
  const pNow = await evaluate(PAGE('page-picks'));
  const wantPrev = 'Week ' + (Number(String(picksLabel0).replace(/\D+/g, '')) - 1);
  assert(pNow.label === wantPrev && Math.abs(pNow.x) <= 0.5, `A-14: …and release lands on the PREVIOUS week (${wantPrev}; got "${pNow.label}", offset ${pNow.x})`);

  // A-15..16 — a VERTICAL drag never moves the page sideways and still scrolls.
  await evaluate(`window.navigateTo('dashboard')`);
  await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav-label')`);
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  const y0 = await evaluate('Math.round(scrollY)');
  await pg.send('Input.synthesizeScrollGesture', { x: 250, y: 600, xDistance: 18, yDistance: -300, gestureSourceType: 'touch', speed: 1200 });
  await sleep(350);
  const afterV = await evaluate(`({ ...${PAGE('page-dashboard')}, y: Math.round(scrollY) })`);
  assert(afterV.y > y0 + 100, `A-15: a vertical finger scroll (with a little sideways drift) still scrolls the page (${y0} → ${afterV.y})`);
  assert(Math.abs(afterV.x) <= 0.5 && afterV.animating === null, `A-16: …and never moves the week sideways or starts a week animation (offset ${afterV.x}, animating ${afterV.animating})`);
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  // Direction lock on a hand-driven drag: vertical first, then a large sideways component.
  const vdrag = [];
  await touch.down(250, 600);
  for (const [x, y] of [[251, 588], [252, 576], [262, 566], [300, 560], [340, 556]]) { await touch.move(x, y); vdrag.push(await evaluate(PAGE('page-dashboard'))); }
  await touch.up();
  assert(vdrag.every(s => Math.abs(s.x) <= 0.5), `A-17: once a drag has locked VERTICAL in its first pixels, later sideways movement never drags the week (${vdrag.map(s => s.x).join(', ')})`);
  await settleIdle('page-dashboard');

  // A-18..23 — Reduce Motion (the coordinator-approved rule, shared with the
  // chat reply swipe): the week STILL follows the finger during the drag;
  // the release never animates movement — a commit cross-fades, a cancel
  // settles at once. The Reduce-Motion-OFF path is A-1..A-12 above.
  await reducedMotion(true);
  const rmLabel0 = (await evaluate(PAGE('page-dashboard'))).label;
  drag = await dragH('page-dashboard', 320, cardY, 150);
  const rmMid = [drag.find(s => s.dx === -60), drag.find(s => s.dx === -170)];
  assert(rmMid.every(s => s && Math.abs(s.x - s.dx) <= 1.5 && s.label === rmLabel0),
    `A-18: Reduce Motion — the page STILL follows the finger 1:1 during the drag, and the week does not change while it is down (offsets at dx −60/−170: ${rmMid.map(s => s?.x).join(' / ')}) — the DI-409 version froze it at 0, which is "it just jumps"`);
  await startFrames('page-dashboard', 320);
  await touch.up();
  fr = await frames(320);
  const slid = fr.filter(f => f.x < -2 && f.x > -168);
  assert(slid.length === 0 && fr.every(f => f.cloneX === null || Math.abs(f.cloneX - -170) <= 1.5),
    `A-19: Reduce Motion — the RELEASE never animates movement: the incoming week is placed straight at rest (no frame part-way, ${slid.length} found) and the outgoing week stays exactly where the finger let go (outgoing offsets ${[...new Set(fr.filter(f => f.cloneX !== null).map(f => f.cloneX))].join(',')})`);
  const xfade = fr.filter(f => f.cloneOpacity !== null && f.opacity > 0.05 && f.opacity < 0.95 && f.cloneOpacity > 0.05 && f.cloneOpacity < 0.95);
  assert(xfade.length >= 2,
    `A-20: THE REDUCE-MOTION HALF — the weeks CROSS-FADE: ${xfade.length} frames with the incoming week part-way in AND the outgoing week part-way out (need ≥2; in/out opacity: ${JSON.stringify(fr.filter(f => f.opacity < 1 || f.cloneOpacity !== null).slice(0, 8).map(f => [f.opacity, f.cloneOpacity]))}; v0.27.2 swapped instantly)`);
  await settleIdle('page-dashboard');
  now = await evaluate(PAGE('page-dashboard'));
  assert(now.label !== rmLabel0 && now.opacity === 1, `A-21: Reduce Motion — …and it lands on the new week, fully opaque (${rmLabel0} → ${now.label}, opacity ${now.opacity})`);
  // A-22..23 — a short release under Reduce Motion SETTLES, never springs.
  const rmLabel1 = now.label;
  drag = await dragH('page-dashboard', 200, cardY, 230);   // left→right 30 px, outside the drawer zone
  assert(Math.abs(drag.at(-1).x - 30) <= 1.5, `A-22-pre: fixture — Reduce Motion, a 30 px drag follows the finger (offset ${drag.at(-1).x})`);
  await sleep(150);   // at rest before lifting — a short release, not a flick
  await startFrames('page-dashboard', 250);
  await touch.up();
  fr = await frames(250);
  const released = fr.slice(fr.findIndex(f => Math.abs(f.x) <= 0.5));
  assert(released.length > 0 && released.every(f => Math.abs(f.x) <= 0.5) && fr.every(f => f.animating !== 'bounce' && (Math.abs(f.x) <= 0.5 || Math.abs(f.x - 30) <= 1.5)),
    `A-22: Reduce Motion — a release short of the threshold SETTLES straight back to rest: no spring frames in between (offsets ${[...new Set(fr.map(f => f.x))].join(',')}) — the Reduce-Motion-OFF spring is A-8`);
  now = await evaluate(PAGE('page-dashboard'));
  assert(now.label === rmLabel1, `A-23: …and stays on ${rmLabel1} (got ${now.label})`);
  await reducedMotion(false);

  // A-24..27 — reviewer's velocity note: release reads the finger's MOTION.
  const labelNum = (l) => Number(String(l).replace(/\D+/g, ''));
  const wk0 = (await evaluate(PAGE('page-dashboard'))).label;               // Week 4 (the last) here
  let T = Date.now();
  await touch.downAt(200, cardY, T);                                       // left→right = previous week, outside the drawer zone
  for (const x of [210, 220, 230]) await touch.moveAt(x, cardY, T += 16);  // 10 px a frame: 30 px in 48 ms
  await touch.upAt(T += 8);                                                // straight off the flick
  const rel24 = await evaluate(`import('./js/nav-gestures.js').then(m => m._weekSwipeLastRelease())`);
  await settleIdle('page-dashboard');
  const wk1 = (await evaluate(PAGE('page-dashboard'))).label;
  assert(labelNum(wk1) === labelNum(wk0) - 1,
    `A-24: a FAST 30 px flick commits — short of the 40 px distance, but moving outward past 0.3 px/ms at release (${wk0} → ${wk1}; release ${JSON.stringify(rel24)})`);
  T = Date.now();
  await touch.downAt(150, cardY, T);
  for (let x = 160; x <= 300; x += 10) await touch.moveAt(x, cardY, T += 16);   // out to +150 px
  for (let x = 295; x >= 195; x -= 5) await touch.moveAt(x, cardY, T += 40);    // slowly back to +45 px (0.125 px/ms)
  const back = await evaluate(PAGE('page-dashboard'));
  await touch.upAt(T += 16);                                               // released while still heading back
  const rel25 = await evaluate(`import('./js/nav-gestures.js').then(m => m._weekSwipeLastRelease())`);
  await settleIdle('page-dashboard');
  const wk2 = (await evaluate(PAGE('page-dashboard'))).label;
  assert(rel25?.dx === 45 && rel25?.go === false && wk2 === wk1,
    `A-25: out to 150 px, then SLOWLY back to 45 px (released at ${rel25?.dx} px; page read ${back.x}) and released while still moving back → it follows the final direction and springs back (${wk1} → ${wk2}); held still at 45 px it would commit (navgesturestest 5q-d) (release dx ${rel25?.dx}, t ${rel25?.releaseT}, go ${rel25?.go}, tail ${JSON.stringify((rel25?.samples || []).slice(-4))})`);

  // A-26..29 — reviewer's stranding note: a live repaint mid-drag (the
  // Realtime chokepoint — onRealtimeEvent → _repaintForSupabaseData →
  // navigateTo() on the SAME tab, which is what a live-score change runs)
  // must not replace the node under the finger.
  await evaluate(`document.querySelector('#page-dashboard .dc-game').dataset.probe = 'before-repaint'`);
  const probeY = await evaluate(`(() => { const r = document.querySelector('#page-dashboard .dc-game[data-probe]').getBoundingClientRect(); return Math.round(r.top + 12); })()`);
  await touch.down(300, probeY);
  await touch.move(290, probeY); await touch.move(270, probeY);            // locked horizontal, week under the finger at -30
  await evaluate(`window.navigateTo('dashboard')`);                        // a live repaint lands mid-drag
  const midRepaint = await evaluate(`(async () => ({ probe: !!document.querySelector('#page-dashboard .dc-game[data-probe]'),
    parked: (await import('./js/nav-gestures.js'))._deferredRenderCount() }))()`);
  await touch.move(265, probeY);
  const afterMove = await evaluate(PAGE('page-dashboard'));
  await sleep(150);                                                        // rest, then lift short of the threshold
  await touch.up();
  await settleIdle('page-dashboard');
  await sleep(100);
  const afterRelease = await evaluate(`(async () => ({ ...${PAGE('page-dashboard')}, probe: !!document.querySelector('#page-dashboard .dc-game[data-probe]'),
    parked: (await import('./js/nav-gestures.js'))._deferredRenderCount(), claim: (await import('./js/nav-gestures.js')).touchClaimedBy() }))()`);
  assert(midRepaint.probe && midRepaint.parked === 1,
    `A-26: THE STRANDING RISK — a live repaint that lands mid-drag is PARKED: the node under the finger is still the original (${midRepaint.probe}), one repaint waiting (${midRepaint.parked})`);
  assert(Math.abs(afterMove.x - -35) <= 1.5,
    `A-27: …so the page keeps following the finger after it (offset ${afterMove.x}, expected -35)`);
  assert(Math.abs(afterRelease.x) <= 0.5 && afterRelease.animating === null && afterRelease.claim === null,
    `A-28: …and the release still reaches the binder: the page springs back to REST, nothing left parked at the finger's offset (offset ${afterRelease.x}, claim ${afterRelease.claim})`);
  assert(!afterRelease.probe && afterRelease.parked === 0,
    `A-29: …and the parked repaint RAN on release — the page now shows the repainted content (probe node gone: ${!afterRelease.probe}, still parked: ${afterRelease.parked})`);

  // A-30..33 — the reviewer's safety net on c7f8bee. (1) Backgrounded
  // mid-drag, the touch's end never comes: coming back (hidden → visible)
  // runs the parked repaint and puts the week at rest.
  const NGI = `import('./js/nav-gestures.js')`;
  const setVisibility = (state) => evaluate(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${state}' });
    document.dispatchEvent(new Event('visibilitychange')); return true; })()`);
  await evaluate(`document.querySelector('#page-dashboard .dc-game').dataset.probe = 'before-background'`);
  const vY = await evaluate(`(() => { const r = document.querySelector('#page-dashboard .dc-game[data-probe]').getBoundingClientRect(); return Math.round(r.top + 12); })()`);
  const vLabel = (await evaluate(PAGE('page-dashboard'))).label;
  await touch.down(300, vY); await touch.move(290, vY); await touch.move(240, vY);   // -60, finger down
  await evaluate(`window.navigateTo('dashboard')`);                                   // a live repaint parks
  const parkedV = await evaluate(`${NGI}.then(m => m._deferredRenderCount())`);
  await setVisibility('hidden');
  await setVisibility('visible');
  await sleep(80);
  const backV = await evaluate(`(async () => ({ ...${PAGE('page-dashboard')}, probe: !!document.querySelector('#page-dashboard .dc-game[data-probe]'),
    parked: (await ${NGI})._deferredRenderCount(), claim: (await ${NGI}).touchClaimedBy() }))()`);
  await evaluate(`delete document.visibilityState; true`);
  await touch.up();                                                                   // the late end of the abandoned touch
  await settleIdle('page-dashboard');
  const lateV = await evaluate(PAGE('page-dashboard'));
  assert(parkedV === 1 && !backV.probe && backV.parked === 0,
    `A-30: SAFETY NET — backgrounded mid-drag with a repaint parked: coming back (hidden → visible) RUNS it (parked before ${parkedV}, after ${backV.parked}; probe node gone ${!backV.probe})`);
  assert(Math.abs(backV.x) <= 0.5 && backV.claim === null && lateV.label === vLabel && Math.abs(lateV.x) <= 0.5,
    `A-31: …puts the week back at rest and gives the touch back (offset ${backV.x}, claim ${backV.claim}); a late touchend changes nothing (${vLabel} → ${lateV.label})`);
  // (2) A claim left stale (its touchend never arrived) when a NEW touch
  // starts: the new swipe must proceed, and the parked repaint land after it.
  await evaluate(`document.querySelector('#page-dashboard .dc-game').dataset.probe = 'stale-claim'`);
  const sY = await evaluate(`(() => { const r = document.querySelector('#page-dashboard .dc-game[data-probe]').getBoundingClientRect(); return Math.round(r.top + 12); })()`);
  await evaluate(`${NGI}.then(m => { m.claimTouch('week-swipe'); window.navigateTo('dashboard'); return m._deferredRenderCount(); })`);
  await touch.down(300, sY); await touch.move(290, sY); await touch.move(270, sY);   // a NEW swipe, -30
  await sleep(40);
  const midS = await evaluate(`(async () => ({ ...${PAGE('page-dashboard')}, probe: !!document.querySelector('#page-dashboard .dc-game[data-probe]'),
    claim: (await ${NGI}).touchClaimedBy() }))()`);
  await sleep(150);
  await touch.up();                                                                   // rest, then a short release
  await settleIdle('page-dashboard');
  await sleep(60);
  const endS = await evaluate(`(async () => ({ ...${PAGE('page-dashboard')}, probe: !!document.querySelector('#page-dashboard .dc-game[data-probe]'),
    parked: (await ${NGI})._deferredRenderCount() }))()`);
  assert(midS.probe && Math.abs(midS.x - -30) <= 1.5 && midS.claim === 'week-swipe',
    `A-32: SAFETY NET — a new touch that finds a STALE claim swipes normally: the node under the finger is untouched (${midS.probe}), the week follows it (offset ${midS.x}), and the new swipe owns the touch (${midS.claim})`);
  assert(!endS.probe && endS.parked === 0 && Math.abs(endS.x) <= 0.5,
    `A-33: …and the stale claim's parked repaint lands AFTER that touch ends (probe node gone ${!endS.probe}, parked ${endS.parked}, at rest ${endS.x})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] RG-TBD-A2 — a reorder drag in the compact Dashboard never becomes a week swipe (or opens the drawer)…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.navigateTo('dashboard')`);
  // Start on a MIDDLE week, so a stray week swipe could navigate in EITHER
  // direction — at the last week a leftward one only rubber-bands, which
  // would hide half of the bug.
  for (let i = 0; i < 4 && (await evaluate(PAGE('page-dashboard'))).label === 'Week 4'; i++) {
    await evaluate(`document.querySelector('#page-dashboard .picks-week-nav > button[aria-label="Previous week"]')?.click()`);
    await sleep(100);
  }
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await sleep(100);
  const midWeek = (await evaluate(PAGE('page-dashboard'))).label;
  assert(midWeek === 'Week 2' || midWeek === 'Week 3', `B-pre: fixture — section [B] starts on a middle week (${midWeek}), so a stray week swipe could change the week either way`);
  const savedOrder = () => evaluate(`import('./js/storage.js').then(st => st.getSettings().dashboardColumnOrder || [])`);
  const CHIPS =`(() => { const row = document.querySelector('#page-dashboard .dc-chips');
    return [...row.querySelectorAll('.dc-chip[draggable="true"]')].map((c, i) => { const r = c.getBoundingClientRect(); return { i, id: c.dataset.playerId, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: Math.round(r.left), r: Math.round(r.right) }; }); })()`;
  // Pick chips by GEOMETRY (the row wraps differently per font/width): a
  // source and a target on the same line, far enough apart that the drag
  // crosses the 40 px week-swipe threshold several times over.
  const pickPair = (chips, want) => {
    for (const a of chips) for (const b of chips) {
      if (a === b || Math.abs(a.y - b.y) > 4) continue;
      if (want(a, b)) return [a, b];
    }
    return [null, null];
  };
  const zone = boot.vw * 0.25;
  const reorderDrag = async (a, b) => {
    const chips = await evaluate(CHIPS);
    const label0 = (await evaluate(PAGE('page-dashboard'))).label;
    await touch.down(a.x, a.y);
    await sleep(480);                                     // past the 350 ms long-press
    const armed = await evaluate(`!!document.querySelector('#page-dashboard .dc-chip.col-dragging')`);
    const samples = [];
    const dir = Math.sign(b.x - a.x);
    for (let x = a.x + dir * 8; dir > 0 ? x <= b.x : x >= b.x; x += dir * 8) { await touch.move(x, a.y); samples.push(await evaluate(PAGE('page-dashboard'))); }
    await touch.move(b.x, b.y);
    samples.push(await evaluate(PAGE('page-dashboard')));
    await touch.up();
    await sleep(400);
    const after = await evaluate(PAGE('page-dashboard'));
    const order = (await evaluate(CHIPS)).map(c => c.id);
    return { a, b, chips, armed, samples, after, label0, order };
  };
  const chips0 = await evaluate(CHIPS);
  console.log(`  (chip layout at ${boot.vw} px: ${chips0.map(c => `${c.id}@${c.l}-${c.r},${c.y}`).join(' ')})`);
  // B-1..3 — a non-viewer chip OUTSIDE the drawer zone dragged LEFT onto
  // another non-viewer chip (the week swipe's "next week" direction).
  const [s1, t1] = pickPair(chips0, (a, b) => a.i > 0 && b.i > 0 && a.x >= zone && a.x - b.x >= 60);
  assert(!!s1, `B-0-pre: fixture — two non-viewer chips on one line ≥60 px apart, the source outside the drawer zone (${s1?.id} → ${t1?.id})`);
  const r1 = s1 ? await reorderDrag(s1, t1) : null;
  if (r1) {
    assert(r1.armed, `B-0: fixture — a 480 ms press on ${r1.a.id} put it into reorder mode (.col-dragging)`);
    assert(r1.samples.every(s => Math.abs(s.x) <= 0.5 && s.animating === null && s.cloneX === null),
      `B-1: THE BUG — during a ${r1.a.x - r1.b.x} px leftward reorder drag the week never moves with the finger (offsets ${[...new Set(r1.samples.map(s => s.x))].join(',')})`);
    assert(r1.samples.every(s => s.label === r1.label0) && r1.after.label === r1.label0,
      `B-2: THE BUG — …and the week never changes, during or after (${r1.label0} → ${[...new Set(r1.samples.map(s => s.label))].join('/')} → ${r1.after.label})`);
    // reorderPlayerColumn() moves the source into the target's slot: dragged
    // LEFT, the source lands immediately BEFORE the target.
    assert(r1.order.indexOf(r1.a.id) === r1.order.indexOf(r1.b.id) - 1,
      `B-3: …and the reorder itself LANDS — ${r1.a.id} now sits immediately before ${r1.b.id} (chip order ${r1.order.join(',')})`);
  }
  // B-4..6 — the viewer's own chip, INSIDE the drawer's left-quarter zone,
  // dragged RIGHT (the drawer's opening direction).
  const chips1 = await evaluate(CHIPS);
  const [s2, t2] = pickPair(chips1, (a, b) => a.i === 0 && a.x < zone && b.x - a.x >= 60);
  assert(!!s2, `B-4-pre0: fixture — the first chip sits inside the drawer's left-quarter zone with a chip ≥60 px to its right on the same line (${s2?.id}@${s2?.x} → ${t2?.id})`);
  const r2 = s2 ? await reorderDrag(s2, t2) : null;
  if (r2) {
    assert(r2.armed, `B-4-pre: fixture — the long-pressed chip (x ${r2.a.x} of ${boot.vw}, zone < ${zone}) is in reorder mode`);
    assert(r2.samples.every(s => !s.drawer) && !r2.after.drawer,
      `B-4: THE BUG — a left→right reorder drag from the left quarter never opens the control center (${r2.samples.filter(s => s.drawer).length} of ${r2.samples.length} samples with the drawer open)`);
    if (r2.after.drawer || r2.samples.some(s => s.drawer)) { await evaluate(`document.getElementById('control-center-backdrop')?.click()`); await sleep(400); }
    assert(r2.samples.every(s => Math.abs(s.x) <= 0.5) && r2.after.label === r2.label0,
      `B-5: …nor moves or changes the week (${r2.label0} → ${r2.after.label})`);
    // Dragged RIGHT, the source lands immediately AFTER the target — in the
    // SAVED order; the display re-pins the viewer's own chip first by design.
    const saved2 = await savedOrder();
    assert(saved2.indexOf(r2.a.id) > 0 && saved2[saved2.indexOf(r2.a.id) - 1] === r2.b.id,
      `B-6: …and that drop is handled as a reorder — the saved column order now has ${r2.a.id} right after ${r2.b.id} (${saved2.join(',')})`);
  }
  // B-7..9 — the REVERSE: a week swipe that has locked horizontally, held
  // still past the long-press delay, never enters reorder mode.
  {
    const chips = await evaluate(CHIPS);
    const a = chips.find(c => c.x >= zone && c.x + 150 < boot.vw - 4) || chips[1];
    const label0 = (await evaluate(PAGE('page-dashboard'))).label;
    const order0 = chips.map(c => c.id);
    await touch.down(a.x, a.y);
    await touch.move(a.x + 12, a.y);
    await touch.move(a.x + 24, a.y);                       // locked horizontal, the week is following the finger
    const locked = await evaluate(PAGE('page-dashboard'));
    await sleep(480);                                     // hold still past the long-press delay
    const armedLate = await evaluate(`!!document.querySelector('#page-dashboard .dc-chip.col-dragging')`);
    for (let d = 36; d <= 150; d += 12) await touch.move(a.x + d, a.y);
    const stillArmed = await evaluate(`!!document.querySelector('#page-dashboard .dc-chip.col-dragging')`);
    await touch.up();
    await settleIdle('page-dashboard');
    const after = await evaluate(PAGE('page-dashboard'));
    const order = (await evaluate(CHIPS)).map(c => c.id);
    assert(Math.abs(locked.x - 24) <= 1.5, `B-7: fixture — the drag on a chip locked horizontal and the week is following it (offset ${locked.x})`);
    assert(!armedLate && !stillArmed, `B-8: a week swipe that has locked horizontally never becomes a reorder, even held still past the long-press delay (armed ${armedLate}/${stillArmed})`);
    assert(after.label !== label0 && order.join(',') === order0.join(','),
      `B-9: …the swipe completes as a week change (${label0} → ${after.label}) and the column order is untouched`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] RG-TBD-A3 — the week title is centred on its card…');
  // ═════════════════════════════════════════════════════════════════════════
  const CENTRE = `(() => {
    const card = document.querySelector('#page-dashboard .picks-week-nav');
    const label = card.querySelector('.picks-week-nav-label'), badge = card.querySelector('.week-heading > .badge'), dates = card.querySelector('.week-heading-dates');
    const c = card.getBoundingClientRect(), l = label.getBoundingClientRect(), b = badge.getBoundingClientRect();
    const rg = document.createRange(); rg.selectNodeContents(dates); const d = rg.getBoundingClientRect();
    const cc = (c.left + c.right) / 2;
    return { card: Math.round(c.width), name: Math.round(((Math.min(l.left, b.left) + Math.max(l.right, b.right)) / 2 - cc) * 10) / 10,
      dates: Math.round(((d.left + d.right) / 2 - cc) * 10) / 10, buttons: card.querySelectorAll('button').length,
      visibleButtons: [...card.querySelectorAll('button')].filter(x => x.getClientRects().length).length };
  })()`;
  const centreCase = async (name, prep) => {
    await evaluate(`window.navigateTo('dashboard')`);
    await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav')`);
    if (prep) await evaluate(prep);
    await sleep(60);
    const m = await evaluate(CENTRE);
    assert(Math.abs(m.name) <= 1 && Math.abs(m.dates) <= 1,
      `C: ${name} — week name line off-centre by ${m.name} px, date line by ${m.dates} px (card ${m.card} px, ${m.visibleButtons}/${m.buttons} arrows visible; tolerance ±1)`);
    return m;
  };
  for (const w of [320, 390, 430, 768, 1280]) {
    await viewport(w, 900);
    await centreCase(`${w} px, web arrows`, null);
  }
  await viewport(390, 844);
  await centreCase('390 px, first week (‹ disabled)', `(() => { for (let i = 0; i < 6; i++) { const b = document.querySelector('#page-dashboard .picks-week-nav > button[aria-label="Previous week"]'); if (!b || b.disabled) break; b.click(); } })()`);
  await centreCase('390 px, native shell (arrows hidden)', `document.body.classList.add('native-shell')`);
  await evaluate(`document.body.classList.remove('native-shell')`);
  await centreCase('390 px, single-week league (no arrows rendered)', `document.querySelectorAll('#page-dashboard .picks-week-nav > button').forEach(b => b.remove())`);
  await centreCase('390 px, asymmetric arrows (‹ is 40 px wider than ›)', `document.querySelector('#page-dashboard .picks-week-nav > button').style.paddingLeft = '54px'`);
  await centreCase('390 px, only the › arrow present', `document.querySelector('#page-dashboard .picks-week-nav > button').remove()`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] RG-TBD-A4 — nothing in the web layer suppresses vertical rubber-band overscroll (top and bottom), on every tab…');
  // ═════════════════════════════════════════════════════════════════════════
  // Drew, 2026-09-29, iOS app: "The ios vertical scroll barely rubberband
  // overscolls on the bottom and doesn't at all on the top". ROOT CAUSE IS
  // NATIVE, not here: Capacitor 8.5.2's CAPBridgeViewController.prepareWebView()
  // sets `aWebView.scrollView.bounces = false` (CAPBridgeViewController.swift:301)
  // and the Munera shell uses the stock controller (SceneDelegate.swift), so the
  // document never rubber-bands in the app; the only "bounce" left is
  // bindBottomBounce()'s 24 px JS fallback at the bottom (DI-327) — "barely" —
  // and nothing at the top. The native fix is the shell's MuneraBridgeViewController
  // (bounces + alwaysBounceVertical back on; pinned by the shell's configtest),
  // and [E] below proves the web side stands its fallback down there. What this
  // section pins is the web layer's half of the contract, so re-enabling the
  // native bounce actually shows: every touch/wheel listener on the scroll chain
  // is PASSIVE, no vertical drag at the top or bottom is ever defaultPrevented
  // (the week swipe's direction lock included, and the compact Dashboard's
  // non-passive reorder chips outside reorder mode), the week swipe never claims
  // a vertical touch, and the document stays the root scroller with
  // overscroll-behavior-y:auto on html/body (Chat excepted by RG-289's design:
  // its root is static and its thread, #chat-scroll, keeps its own bounce).
  await viewport(390, 844);
  await reducedMotion(false);
  await evaluate(`(() => {
    window.__vmoves = [];
    window.addEventListener('touchmove', (e) => { window.__vmoves.push({ prevented: e.defaultPrevented, cancelable: e.cancelable }); }, { passive: true });
  })()`);
  const listenersOf = async (expr) => {
    const r = await pg.send('Runtime.evaluate', { expression: expr });
    if (!r.result?.objectId) return null;
    const { listeners } = await pg.send('DOMDebugger.getEventListeners', { objectId: r.result.objectId });
    return listeners.filter(l => /^(touchstart|touchmove|touchend|touchcancel|wheel)$/.test(l.type));
  };
  const vDrag = async (x, y0, y1) => {           // a vertical finger drag, 12 px per move
    await evaluate(`window.__vmoves = []`);
    await touch.down(x, y0);
    const dir = Math.sign(y1 - y0);
    for (let y = y0 + dir * 12; dir > 0 ? y <= y1 : y >= y1; y += dir * 12) await touch.move(x + (y % 3), y);
    await touch.up();
    await sleep(120);
    return evaluate(`window.__vmoves`);
  };
  for (const tab of ['picks', 'dashboard', 'leaderboard', 'rules', 'chat']) {
    await evaluate(`window.navigateTo('${tab}')`);
    await waitFor(`document.querySelector('#page-${tab}.active')`);
    await sleep(250);
    const css = await evaluate(`(() => {
      const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body), cs = document.getElementById('chat-scroll');
      return { html: h.overscrollBehaviorY, body: b.overscrollBehaviorY, bodyPos: b.position, htmlOy: h.overflowY, bodyOy: b.overflowY,
        root: document.scrollingElement === document.documentElement, thread: cs ? getComputedStyle(cs).overscrollBehaviorY : null,
        threadOy: cs ? getComputedStyle(cs).overflowY : null };
    })()`);
    if (tab === 'chat') {
      assert(css.thread === 'contain' && /auto|scroll/.test(css.threadOy),
        `D-${tab}-css: Chat (RG-289, by design) — the root is static (html/body overscroll ${css.html}/${css.body}) and the THREAD is the scroller that keeps its own bounce (#chat-scroll overflow-y ${css.threadOy}, overscroll-behavior-y ${css.thread})`);
    } else {
      assert(css.html === 'auto' && css.body === 'auto' && css.bodyPos !== 'fixed' && css.htmlOy !== 'hidden' && css.bodyOy !== 'hidden' && css.root,
        `D-${tab}-css: ${tab} — the document is the root scroller with native overscroll left ON (html/body overscroll-behavior-y ${css.html}/${css.body}, body position ${css.bodyPos}, overflow-y ${css.htmlOy}/${css.bodyOy}, scrollingElement is <html>: ${css.root})`);
    }
    const nodes = { window: 'window', document: 'document', html: 'document.documentElement', body: 'document.body',
      '.page-wrapper': `document.querySelector('.page-wrapper')`, [`#page-${tab}`]: `document.getElementById('page-${tab}')`,
      ...(tab === 'chat' ? { '#chat-scroll': `document.getElementById('chat-scroll')` } : {}) };
    const blocking = [];
    let inspected = 0;
    for (const [name, expr] of Object.entries(nodes)) {
      const ls = await listenersOf(expr);
      for (const l of ls || []) {
        if (l.type === 'touchstart' || l.type === 'touchmove') inspected++;
        if (!l.passive && l.type !== 'touchend' && l.type !== 'touchcancel') blocking.push(`${name}:${l.type}@${l.lineNumber}`);
      }
    }
    // Anti-vacuity: window alone carries pull-to-refresh, the bottom bounce,
    // the drawer edge swipe and this suite's own recorder — an empty listener
    // read would otherwise "pass" by seeing nothing.
    assert(inspected >= 6 && blocking.length === 0,
      `D-${tab}-passive: every touchstart/touchmove/wheel listener on the scroll chain (window, document, html, body, .page-wrapper, #page-${tab}${tab === 'chat' ? ', #chat-scroll' : ''}) is PASSIVE — none can hold back or cancel the native scroll/bounce (${inspected} touchstart/touchmove listeners inspected; non-passive: ${blocking.join(', ') || 'none'})`);
    // Top: pull DOWN from the very top. Bottom: scroll to the end, then push UP.
    const scroller = tab === 'chat' ? `document.getElementById('chat-scroll')` : 'document.scrollingElement';
    await evaluate(`${scroller}.scrollTo({ top: 0, behavior: 'instant' })`);
    const startOn = tab === 'dashboard'
      ? await evaluate(`(() => { const c = document.querySelector('#page-dashboard .dc-chip'); const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)
      : { x: 250, y: 300 };
    const top = await vDrag(startOn.x, Math.max(120, startOn.y), Math.max(120, startOn.y) + 180);
    await evaluate(`${scroller}.scrollTo({ top: ${scroller}.scrollHeight, behavior: 'instant' })`);
    await sleep(80);
    const bottom = await vDrag(250, 600, 360);
    const prevented = [...top, ...bottom].filter(m => m.prevented).length;
    const claimed = await evaluate(`import('./js/nav-gestures.js').then(m => m.touchClaimedBy())`);
    const moved = await evaluate(`(() => { const p = document.getElementById('page-${tab}'); return getComputedStyle(p).getPropertyValue('--week-swipe-x').trim() || '0px'; })()`);
    assert(top.length >= 8 && bottom.length >= 8 && prevented === 0,
      `D-${tab}-drag: ${tab} — a vertical pull at the TOP (${top.length} moves${tab === 'dashboard' ? ', starting on a reorder chip' : ''}) and a push at the BOTTOM (${bottom.length} moves) are never preventDefault()ed (${prevented} prevented) — the native rubber band is free to run at both ends`);
    assert(claimed === null && (moved === '0px' || moved === ''),
      `D-${tab}-lock: …and the week swipe's direction lock never claims a vertical touch or moves the page sideways (claim ${claimed}, --week-swipe-x ${moved})`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] RG-TBD-A4 — the JS bottom rubber band runs on the WEB only; the native shell leaves the bottom to the WKWebView\'s own bounce…');
  // ═════════════════════════════════════════════════════════════════════════
  // navigateTo() binds bindBottomBounce() only when !isNativeShell(): the
  // shell now re-enables the native bounce, and the 24 px JS lift on
  // .page-wrapper would double it. Same real app, same real touches, a web
  // load and then a load with a Capacitor bridge stub (isNativePlatform()
  // true) injected before any app script runs. Runs LAST — it reloads.
  const bottomPush = async () => {
    await evaluate(`window.navigateTo('dashboard')`);
    await waitFor(`document.querySelector('#page-dashboard.active .picks-week-nav')`);
    await sleep(200);
    await evaluate(`document.scrollingElement.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: 'instant' })`);
    await sleep(120);
    const lifts = [];
    await touch.down(250, 600);
    for (let y = 588; y >= 420; y -= 12) {
      await touch.move(250, y);
      lifts.push(await evaluate(`document.querySelector('.page-wrapper').style.transform || ''`));
    }
    await touch.up();
    await sleep(300);
    return { lifts, native: await evaluate(`import('./js/platform.js').then(m => m.isNativeShell())`),
      bodyNative: await evaluate(`document.body.classList.contains('native-shell')`) };
  };
  const web = await bottomPush();
  assert(web.native === false && web.lifts.some(t => /translateY\(-\d/.test(t)),
    `E-1: WEB (unchanged) — at the bottom of Dashboard an upward push still lifts .page-wrapper with the JS rubber band (${[...new Set(web.lifts)].slice(0, 4).join(' | ')})`);
  await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__haptics = []; window.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => window.__haptics.push(o) } } };` });
  await navigate();
  const nativeBooted = await waitFor(`window.navigateTo && !document.getElementById('site-gate-overlay')`, 10000);
  assert(nativeBooted, 'E-2-pre: fixture — the app boots with a Capacitor bridge stub (isNativeShell() true) and is past the gate');
  if (nativeBooted) {
    const nat = await bottomPush();
    assert(nat.native === true && nat.bodyNative === true, `E-2-fixture: fixture — the page really is running as the native shell (isNativeShell ${nat.native}, body.native-shell ${nat.bodyNative})`);
    assert(nat.lifts.length >= 8 && nat.lifts.every(t => t === ''),
      `E-2: NATIVE — the SAME upward push at the bottom writes NO JS lift at all: the WKWebView's own bounce owns it, never both (transforms seen: ${[...new Set(nat.lifts)].join(' | ') || 'none'}) — MUTATION: bind bindBottomBounce() unconditionally and this goes red`);
    // Reviewer note on RG-TBD-A2 — the reorder's long-press cue went through
    // navigator.vibrate(), which iOS never had: silent on every iPhone. It
    // now uses the app's haptic() (the Capacitor Haptics plugin, native only).
    await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' }); window.__haptics.length = 0`);
    await sleep(100);
    const chip = await evaluate(`(() => { const c = document.querySelector('#page-dashboard .dc-chip[draggable="true"]'); const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await touch.down(chip.x, chip.y);
    await sleep(480);
    const pressed = await evaluate(`({ armed: !!document.querySelector('#page-dashboard .dc-chip.col-dragging'), haptics: window.__haptics.slice() })`);
    await touch.up();
    await sleep(200);
    assert(pressed.armed && pressed.haptics.some(h => h && h.style === 'LIGHT'),
      `E-4: NATIVE — the long-press that puts a chip into reorder mode fires the app's LIGHT haptic through the Capacitor plugin (armed ${pressed.armed}, impacts ${JSON.stringify(pressed.haptics)}) — navigator.vibrate() never reached an iPhone`);
    drag = await dragH('page-dashboard', 320, 300, 200);
    assert(Math.abs(drag.at(-1).x - -120) <= 1.5,
      `E-3: …while the native shell's other gestures are still wired by the same navigateTo() — the week still follows the finger there (offset ${drag.at(-1).x})`);
    await touch.up();
    await settleIdle('page-dashboard');
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
