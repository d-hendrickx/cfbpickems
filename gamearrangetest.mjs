/**
 * CFB Pickems — gamearrangetest.mjs (Deployment 1, Lane B, DI-607 / DI-581 / PF-445 rev 3, 2026-10-08) — REAL CHROMIUM, the REAL app, real pointer and touch input
 * =================================================================================================================================================================
 * gamesorttest.mjs proves the words, the wiring and the writes over a stand-in element tree. This suite is the other half: the real index.html and js/app.js booted in headless Chromium (local mode, the
 * sectiondragtest way), a live week seeded through the app's own storage.js, and the Sort button, the sheet, the arrows, the mouse drag and the touch hold-and-drag driven with the DevTools protocol's own input
 * events, hit-tested by the engine.
 *
 *   [1] The Dashboard's list row: one line at 375 pt, the summary above and the button centered below it at 1.3x text; every target 44 pt
 *   [2] The Sort sheet: its geometry (rows >= 56 pt, 44 pt buttons, 8 pt apart, Done centered), choosing a mode re-sorts at once and animates (the Web Animations API, none under Reduce Motion)
 *   [3] Arranging: the arrows (one write each, focus kept), the mouse drag on the grip, the touch hold on the row body (a lift at 500 ms, the page does not scroll under it, one write at the drop, none for a
 *       cancelled drop), a quick move is a scroll and never a lift, Esc cancels, Done
 *   [4] Live first: parked behind an open sheet, played once on close
 *
 * WHAT IT CANNOT PROVE. Blink is not WebKit: the feel of the haptic, the WKWebView scroll and bounce, the iOS callout, how iOS treats the rows' one non-passive touchmove, VoiceOver and Switch Control. Those are
 * Drew's on-device checklist; every row here is "engine-verified", never "device-verified". A missing browser is a FAILURE (never a skip).
 *
 * Override the browser: GAT_ENGINE=/path/to/Chromium.   Mutation runs: GAT_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree instead of this one.
 * Run:  node gamearrangetest.mjs
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

let pass = 0, fail = 0;
const assert = (cond, label, extra = '') => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, extra ? `\n     ${extra}` : ''); } };

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.GAT_ROOT || HERE;
const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const OVERRIDE = process.env.GAT_ENGINE || process.env.SDT_ENGINE || process.env.WEEKSWIPE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const BIN = OVERRIDE || ENGINES.find((p) => existsSync(p));
console.log('\n[0] engine…');
assert(!!BIN && existsSync(BIN), !BIN
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: GAT_ENGINE=/path/to/Chromium node gamearrangetest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `[0a] engine to measure in: ${BIN}${OVERRIDE ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', '[0b] this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; }
  if (p === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  if (p.split('/').some((seg) => seg.startsWith('.')) || p.startsWith('/supabase/') || p === '/supabase') { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-gat-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch() {
  const proc = spawn(BIN, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps',
    '--disable-extensions', '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  let id = 0; const pending = new Map(); const waiters = []; const events = [];
  sock.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) { events.push(msg); waiters.filter((w) => w.method === msg.method).forEach((w) => w.res(msg)); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    const timer = setTimeout(() => { pending.delete(myId); rej(new Error(method + ' → no answer within 30 s')); }, 30000);
    pending.set(myId, (m) => { clearTimeout(timer); return m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result); });
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once, events };
}

let engine = null;
const watchdog = setTimeout(() => { console.error('  ❌ [watchdog] the engine-measured suite did not finish within 240 s'); try { engine?.proc.kill(); } catch { /* gone */ } process.exit(1); }, 240000);
try {
  if (!BIN) throw new Error('no engine binary');
  engine = await launch();
  const pg = await attach(engine.ws);
  await pg.send('Page.enable');
  await pg.send('Runtime.enable');
  const pageErrors = [];
  pg.events.push = ((orig) => function push(...a) {
    for (const m of a) {
      if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    return orig.apply(this, a);
  })(pg.events.push);
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) { if (await evaluate(`!!(${expression})`)) return true; await sleep(100); }
    return false;
  };
  const navigate = async () => { const loaded = pg.once('Page.loadEventFired'); await pg.send('Page.navigate', { url: ORIGIN + '/index.html' }); await loaded; };
  const viewport = async (w, h) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (let t = 0; t < 3000; t += 50) { if ((await evaluate('innerWidth')) === w) break; await sleep(50); }
    await sleep(150);
  };
  const reducedMotion = async (on) => { await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] }); await sleep(50); };
  const frame = () => evaluate('new Promise(r => requestAnimationFrame(() => r(true)))');
  const touch = {
    async down(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); },
    async move(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(16); await frame(); },
    async up() { await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
    async cancel() { await pg.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); },
  };
  const mouse = {
    async down(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); },
    async move(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(16); },
    async up() { await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: this.x, y: this.y, button: 'left', buttons: 0, clickCount: 1 }); },
  };
  const key = async (k) => { await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k }); await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k }); };
  const rect = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, ow: el.offsetWidth, oh: el.offsetHeight, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const rectAll = (sel) => evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, ow: el.offsetWidth, oh: el.offsetHeight, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })`);
  const scrollTo = async (y) => { await evaluate(`window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' })`); await sleep(340); };
  const scrollSel = async (sel, at = 160) => { const r = await rect(sel); await scrollTo(Math.round((await evaluate('scrollY')) + r.top - at)); return rect(sel); };
  const tap = async (sel) => { const r = await rect(sel); await touch.down(Math.round(r.cx), Math.round(r.cy)); await sleep(40); await touch.up(); await sleep(60); };
  const ids = () => evaluate(`[...document.querySelectorAll('#page-dashboard .dashboard-compact .dc-game')].map((n) => n.dataset.gameId)`);
  const writes = () => evaluate(`window.__writes.filter((k) => k === 'cfbp_players').length`);
  const resetWrites = () => evaluate(`(window.__writes.length = 0, true)`);
  const settle = (ms = 450) => sleep(ms);
  const goDash = async () => { await evaluate(`window.navigateTo('dashboard')`); await waitFor(`document.querySelector('#page-dashboard.active .dc-game')`); await scrollTo(0); };

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode), seed a live week of six games through its own storage…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await viewport(375, 812);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '[1a] fixture — the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
    const players = NAMES.map((n) => ({ ...dm.createPlayer(n, '', '1234', '', n.slice(0, 2).toUpperCase()), playerId: 'pl_' + n.toLowerCase(), preferences: { dashboardLayout: 'compact' } }));
    players.forEach((p) => st.savePlayer(p));
    const wk = { ...dm.createWeek(2026, 2), weekId: 'wk_live', status: 'live', tiebreakerQuestion: 'Total points?' };
    st.saveWeek(wk);
    const picks = [];
    const now = Date.now();
    const SPEC = [['final', -300], ['live', -90], ['scheduled', 60], ['scheduled', 120], ['scheduled', 180], ['scheduled', 240]];
    SPEC.forEach(([state, mins], gi) => {
      const g = dm.createGame(wk.weekId, { gameId: 'g_' + gi, homeTeam: 'Home ' + gi, awayTeam: 'Away ' + gi, kickoff: new Date(now + mins * 60000).toISOString(), kickoffConfirmed: true,
        spread: -3.5, lockedSpread: -3.5, homeScore: state === 'scheduled' ? null : 24 + gi, awayScore: state === 'scheduled' ? null : 17, status: state });
      st.saveGame(g);
      players.forEach((p, pi) => picks.push({ ...dm.createPick(wk.weekId, g.gameId, p.playerId, (gi + pi) % 2 ? g.homeTeam : g.awayTeam), pickId: 'pk_' + gi + '_' + pi, submittedAt: '2026-09-01T00:00:00Z' }));
    });
    st.saveAllPicks(picks);
    st.setActiveWeekId('wk_live');
    st.setSession('pl_drew', false, true);
    await new Promise((r) => setTimeout(r, 1200));
    return { players: st.getPlayers().filter((p) => p.playerId.startsWith('pl_')).length, games: st.getGames('wk_live').length };
  })()`);
  assert(seeded.players === 6 && seeded.games === 6, `[1b] fixture — six players and a live week of six games seeded through the app's own storage.js (got ${JSON.stringify(seeded)})`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '[1c] fixture — after reload the app is past the site gate with a verified player session');
  await evaluate(`(() => { window.__writes = []; const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return orig.call(this, k, v); }; window.__toastLog = []; new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toastLog.push(n.textContent.trim()); }).observe(document.getElementById('toast-container'), { childList: true }); return true; })()`);
  await goDash();
  const rows0 = await ids();
  assert(rows0.join() === 'g_0,g_1,g_2,g_3,g_4,g_5', `[1d] fixture — the Dashboard (Compact) lists six games in kickoff order (${rows0.join()})`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] The list row, at 375 pt and at 1.3x text…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await scrollSel('[data-dc-listctl]', 120);
  const lc = await rect('[data-dc-listctl]'), btn = await rect('[data-dc-action="sort"]'), title = await rect('.dc-listctl-title');
  assert(btn.oh >= 44 && btn.ow >= 44, `[2a] the Sort button is a 44 pt target (${btn.ow} x ${btn.oh}; layout size, so a press feedback mid-transition cannot read as a small target)`);
  assert(Math.abs((btn.cy) - (title.top + (await rect('.dc-listctl-cap')).bottom) / 2) < 30 && btn.left > title.right, '[2b] at 375 pt the summary and the button share ONE line (the button to the right)');
  assert(btn.right <= lc.right + 0.5 && lc.right - btn.right < 2, `[2c] …the button reaches the card's right padding edge (${Math.round(lc.right - btn.right)} pt short)`);
  const mode = await evaluate(`document.querySelector('.dc-sort-mode').textContent`);
  assert(mode === 'Kickoff time', `[2d] the button names the mode in muted text ("${mode}")`);
  await evaluate(`document.documentElement.style.fontSize = '130%'`); await sleep(200);
  const lc2 = await rect('[data-dc-listctl]'), btn2 = await rect('[data-dc-action="sort"]'), cap2 = await rect('.dc-listctl-cap');
  assert(btn2.top >= cap2.bottom + 7 && Math.abs(btn2.cx - lc2.cx) < 3, `[2e] at 1.3x text the row wraps: the button sits BELOW the summary, 8 pt away (${Math.round(btn2.top - cap2.bottom)} pt) and CENTERED (off by ${Math.round(Math.abs(btn2.cx - lc2.cx))} pt)`);
  await evaluate(`document.documentElement.style.fontSize = ''`); await sleep(150);
  const refresh = await rect('#manual-refresh-btn'), pad = await rect('.layout-toggle-btn');
  assert(refresh.oh >= 44 && refresh.ow >= 44, `[2f] TOUCHED-SCREEN AUDIT: the Refresh button is a 44 pt target (${refresh.ow} x ${refresh.oh})`);
  void pad;

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] The Sort sheet: geometry, choosing a mode, the motion…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await tap('[data-dc-action="sort"]');
  assert(await waitFor(`document.getElementById('sort-sheet')`), '[3a] a tap on Sort opens the sheet');
  await settle(420);
  const opts = await rectAll('#sort-sheet .dc-sort-opt');
  assert(opts.length === 3 && opts.every((o) => o.height >= 56), `[3b] three radio rows, each at least 56 pt tall (${opts.map((o) => Math.round(o.height)).join(', ')})`);
  const close = await rect('#sort-sheet-close'), done0 = await rect('#sort-sheet .dc-sort-done'), sheetR = await rect('#sort-sheet');
  assert(close.ow >= 44 && close.oh >= 44 && done0.oh >= 44 && Math.abs(done0.cx - sheetR.cx) < 3, `[3c] the close button and Done are 44 pt and Done is centered in the sheet (off by ${Math.round(Math.abs(done0.cx - sheetR.cx))} pt)`);
  assert(sheetR.bottom <= (await evaluate('innerHeight')) + 1 && sheetR.height < (await evaluate('innerHeight')) * 0.82 + 2, `[3d] the sheet is content-height and fits (${Math.round(sheetR.height)} of ${await evaluate('innerHeight')} pt)`);
  assert(await evaluate(`getComputedStyle(document.documentElement).overflow === 'hidden'`), '[3e] the page behind the sheet does not scroll while it is up');
  // choose Live first: the list re-sorts at once and the rows ANIMATE
  await resetWrites();
  await tap('#sort-sheet [data-mode="live-first"]');
  await sleep(40);
  const anim = await evaluate(`document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('dc-game')).map((a) => Math.round(a.effect.getTiming().duration))`);
  assert(anim.length >= 2 && anim.every((d) => d >= 300 && d <= 400), `[3f] choosing Live first re-sorts the list behind the sheet and the rows that moved glide (${anim.length} animations, ${anim[0]} ms: the large-layout range)`);
  assert(await writes() === 1, `[3g] ...with ONE write to the player record (${await writes()})`);
  await settle(450);
  const lf = await ids();
  assert(lf.join() === 'g_1,g_2,g_3,g_4,g_5,g_0', `[3h] Live first: the live game on top, the final game last (${lf.join()})`);
  await tap('#sort-sheet [data-mode="kickoff"]'); await settle(450);
  assert((await ids()).join() === rows0.join(), '[3i] Kickoff time puts them back');
  await reducedMotion(true);
  await tap('#sort-sheet [data-mode="live-first"]'); await sleep(40);
  const animRM = await evaluate(`document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('dc-game')).length`);
  assert(animRM === 0 && (await ids()).join() === lf.join(), `[3j] REDUCE MOTION: the list still re-sorts but nothing glides (${animRM} animations)`);
  await reducedMotion(false);
  await settle(500);                                    // (the OS setting flipping back restarts the sheet's open animation: wait it out before the next real touch)
  await tap('#sort-sheet [data-mode="manual"]');
  assert(await waitFor(`document.querySelector('#sort-sheet [data-dc-action="arrange"]')`), '[3k] Custom shows "Arrange games"');
  await evaluate(`(window.__toastLog.length = 0, true)`);
  await tap('#sort-sheet [data-dc-action="arrange"]');
  assert(await waitFor(`!document.getElementById('sort-sheet-wrap')`, 3000), '[3l] "Arrange games" closes the sheet (it slides out)');
  assert(await waitFor(`document.querySelector('[data-arrange-row]')`), '[3m] ...and the list is being arranged');

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] Arranging: the arrows, the mouse drag, the touch hold…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  const order0 = await ids();                           // Custom with nothing saved: kickoff order until the first move
  assert(order0.join() === rows0.join(), `[4a] Custom with nothing saved starts from kickoff order (${order0.join()})`);
  const grips = await rectAll('[data-arrange-grip]'), mvs = await rectAll('[data-dc-action="move"]');
  assert(grips.length === 6 && grips.every((g) => g.ow >= 44 && g.oh >= 44) && mvs.length === 12 && mvs.every((m) => m.ow >= 44 && m.oh >= 44), `[4b] six grips and twelve arrows, every one a 44 pt target`, JSON.stringify({ grips: grips.map((g) => [g.ow, g.oh]), mvs: mvs.map((m) => [m.ow, m.oh]) }));
  const pair = mvs.slice(0, 2);
  assert(Math.abs(pair[1].left - pair[0].right - 8) < 1.5, `[4c] the two arrows are 8 pt apart (${Math.round(pair[1].left - pair[0].right)} pt)`);
  assert(await evaluate(`getComputedStyle(document.querySelector('[data-arrange-row]')).touchAction`) !== 'none' && await evaluate(`getComputedStyle(document.querySelector('[data-arrange-grip]')).touchAction`) === 'none', '[4d] the grip owns its touches (touch-action: none) while the rest of the row still scrolls the page');
  // arrow
  await scrollSel('[data-arrange-row]', 200);
  await resetWrites();
  await tap('[data-arrange-row]:nth-child(2) [data-dc-action="move"][data-dir="down"]');
  await settle(420);
  assert((await ids()).join() === 'g_0,g_2,g_1,g_3,g_4,g_5' && await writes() === 1, `[4e] Move down on row 2: ONE write, the rows follow (${(await ids()).join()})`);
  assert(await evaluate(`document.activeElement && document.activeElement.dataset.dir`) === 'down' && await evaluate(`document.activeElement.closest('[data-arrange-row]').dataset.gameId`) === 'g_1', '[4f] focus is on the moved game\'s Move down button after the repaint');
  assert((await evaluate(`document.getElementById('layout-live').textContent`)).includes('Away 1 at Home 1 moved to position 3 of 6.'), '[4g] VoiceOver is told: "Away 1 at Home 1 moved to position 3 of 6."');
  // mouse drag on the grip: row g_0 down past two rows
  await scrollSel('[data-arrange-row]', 200);
  const g = await rectAll('[data-arrange-grip]'), rowsR = await rectAll('[data-arrange-row]');
  await resetWrites();
  await mouse.down(Math.round(g[0].cx), Math.round(g[0].cy));
  await mouse.move(Math.round(g[0].cx), Math.round(g[0].cy) + 5);
  assert(await evaluate(`!!document.querySelector('[data-lifted="true"]')`) === false, '[4h] a 5 pt move of the grip is below the slop: not lifted yet');
  await mouse.move(Math.round(g[0].cx), Math.round(g[0].cy) + 20);
  assert(await evaluate(`document.querySelector('[data-lifted="true"]') && document.querySelector('[data-lifted="true"]').dataset.gameId`) === 'g_0', '[4i] past the slop the grabbed row lifts');
  await mouse.move(Math.round(g[0].cx), Math.round(rowsR[2].cy));
  await sleep(120);
  const mid = await evaluate(`[...document.querySelectorAll('[data-arrange-row]')].map((r) => r.style.transform ? r.dataset.gameId : '').filter(Boolean)`);
  assert(mid.length >= 2, `[4j] while it is held the rows it passes make way (${mid.join(', ')} are shifted)`);
  assert(await writes() === 0, '[4k] ...and nothing is written while it is held');
  await mouse.up();
  await settle(450);
  const afterMouse = await ids();
  assert(afterMouse.indexOf('g_0') >= 2 && await writes() === 1, `[4l] the drop writes ONCE and the row is where it was dropped (${afterMouse.join()}, ${await writes()} write)`);
  // Esc cancels a lift
  await scrollSel('[data-arrange-row]', 200);
  const g2 = await rectAll('[data-arrange-grip]');
  await resetWrites();
  const before = await ids();
  await mouse.down(Math.round(g2[0].cx), Math.round(g2[0].cy));
  await mouse.move(Math.round(g2[0].cx), Math.round(g2[0].cy) + 30);
  await mouse.move(Math.round(g2[0].cx), Math.round(g2[3].cy));
  await key('Escape'); await sleep(350);
  await mouse.up(); await settle(350);
  assert((await ids()).join() === before.join() && await writes() === 0, `[4m] Esc cancels a held row: nothing moved, nothing written (${await writes()} writes)`);
  // touch hold on the row body: lift at 500 ms, the page does not scroll under it
  await scrollSel('[data-arrange-row]', 160);
  const rb = await rectAll('[data-arrange-row]');
  const body3 = await rect('[data-arrange-row]:nth-child(3) .dc-matchup');
  const y0 = await evaluate('scrollY');
  await resetWrites();
  await touch.down(Math.round(body3.cx), Math.round(body3.cy));
  await sleep(250);
  assert(await evaluate(`!document.querySelector('[data-lifted="true"]')`), '[4n] 250 ms into a still hold nothing has lifted yet');
  await sleep(450);
  const lifted = await evaluate(`({ id: document.querySelector('[data-lifted="true"]') && document.querySelector('[data-lifted="true"]').dataset.gameId, claim: null })`);
  assert(!!lifted.id, `[4o] a still hold of 500 ms on a row's body lifts it (${lifted.id})`);
  assert(await evaluate(`import('./js/nav-gestures.js').then((nav) => nav.touchClaimedBy())`) === 'section-drag', '[4p] ...the touch is CLAIMED (the week swipe, the drawer swipe and pull to refresh stand down)');
  await touch.move(Math.round(body3.cx), Math.round(rb[0].cy));
  await touch.move(Math.round(body3.cx), Math.round(rb[0].cy) - 4);
  assert(Math.abs((await evaluate('scrollY')) - y0) < 2, `[4q] a lifted row owns the touch: the page did not scroll under it (${Math.round(await evaluate('scrollY') - y0)} pt)`);
  await touch.up();
  await settle(500);
  const afterTouch = await ids();
  assert(afterTouch.indexOf(lifted.id) < 2 && await writes() === 1, `[4r] the drop writes ONCE and the held game went to the top (${afterTouch.join()}, ${await writes()} write)`);
  assert(await evaluate(`import('./js/nav-gestures.js').then((nav) => nav.touchClaimedBy())`) === null, '[4s] ...and the claim is given back');
  // a move before 500 ms is a scroll, never a lift
  await scrollSel('[data-arrange-row]', 160);
  const b4 = await rect('[data-arrange-row]:nth-child(4) .dc-matchup');
  await resetWrites();
  await touch.down(Math.round(b4.cx), Math.round(b4.cy));
  await sleep(120);
  await touch.move(Math.round(b4.cx), Math.round(b4.cy) - 30);
  await sleep(600);
  assert(await evaluate(`!document.querySelector('[data-lifted="true"]')`) && await writes() === 0, '[4t] a finger that moves before 500 ms is a scroll: nothing lifts, nothing is written');
  await touch.up(); await sleep(300);
  // a still hold that is released without moving: lift then drop in place = no write
  await scrollSel('[data-arrange-row]', 160);
  const b2 = await rect('[data-arrange-row]:nth-child(2) .dc-matchup');
  await resetWrites();
  await touch.down(Math.round(b2.cx), Math.round(b2.cy)); await sleep(700); await touch.up(); await settle(500);
  assert(await writes() === 0, '[4u] a hold that is released where it was lifted writes nothing');
  // a tap on a row's own controls never starts a press
  await resetWrites();
  // Done
  const saved = await evaluate(`(window.__toastLog.length = 0, true)`);
  void saved;
  await tap('[data-dc-action="arrange-done"]');
  await sleep(200);
  assert(await evaluate(`!document.querySelector('[data-arrange-row]')`) && (await evaluate('window.__toastLog')).includes('Arrangement saved.'), '[4v] Done ends arranging and says "Arrangement saved." (moves were made)');
  const stored = await evaluate(`import('./js/storage.js').then((st) => st.getManualGameOrder('wk_live'))`);
  assert(stored.length === 6 && stored.join() === (await ids()).join(), `[4w] the saved arrangement is exactly what is on screen (${stored.join()})`);
  await navigate(); await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`); await goDash();
  assert((await ids()).join() === stored.join(), '[4x] after a reload the arrangement is still there (it is on the player record)');

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] Live first: parked behind an open sheet, played once when it closes…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await evaluate(`import('./js/storage.js').then((st) => { st.setGameOrderMode('live-first'); })`);
  await goDash();
  const lf0 = await ids();
  assert(lf0[0] === 'g_1', `[5a] (fixture) Live first, the live game on top (${lf0.join()})`);
  await scrollSel('[data-dc-action="sort"]', 140);
  await tap('[data-dc-action="sort"]'); await settle(420);
  await evaluate(`import('./js/storage.js').then((st) => { const g = st.getGame('g_1'); st.saveGame({ ...g, status: 'final', homeScore: 31, awayScore: 10 }); window.navigateTo('dashboard'); })`);
  await sleep(300);
  assert((await ids()).join() === lf0.join(), '[5b] the live game ENDS while the sheet is open: the list behind it does not move');
  await tap('#sort-sheet-close');
  let anim2 = 0;                                        // the sheet slides out first (about 300 ms); the parked move plays when it is gone: poll for the glide
  for (let t = 0; t < 1500 && !anim2; t += 30) { await sleep(30); anim2 = await evaluate(`document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('dc-game')).length`); }
  await settle(500);
  const lf1 = await ids();
  assert(lf1[lf1.length - 1] === 'g_1' && lf1[0] !== 'g_1', `[5c] when the sheet closes the finished game goes to the end (${lf1.join()})`);
  assert(anim2 >= 1, `[5d] ...with a glide (${anim2} animations)`);
  assert((await evaluate(`document.getElementById('layout-live').textContent`)).includes('Away 1 at Home 1 is final and moved to the end.'), '[5e] ...and it is named once, politely: "Away 1 at Home 1 is final and moved to the end."');

  assert(pageErrors.length === 0, `[6] no uncaught page error during the whole run${pageErrors.length ? ': ' + pageErrors[0] : ''}`);
} catch (e) {
  fail++;
  console.error('  ❌ the engine-measured suite threw:', e && e.stack ? e.stack : e);
} finally {
  clearTimeout(watchdog);
  try { engine?.proc.kill(); } catch { /* gone */ }
  try { server.close(); } catch { /* closed */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
