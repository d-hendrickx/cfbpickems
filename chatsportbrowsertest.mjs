/**
 * chatsportbrowsertest.mjs — THE LOCKER ROOM'S SPORT PILLS, MEASURED IN A REAL ENGINE (D1, DI-553 / W-57)
 * =========================================================================================================
 * Drew, D-48: "in this release i want sport filter pills in the locker room."
 *
 * chatsporttest.mjs proves the logic without a DOM. This suite proves what only an engine can: the REAL index.html + css/styles.css + js/app.js in headless Chromium (local PIN mode, network
 * blocked — chatpagetest.mjs's boot recipe), a two-sport league on the storage seam (CFB + NFL, a live game in each), a mixed Locker Room (plain messages, a CFB thread, an NFL thread,
 * a system row of each week), the player on Chat. It taps with real mouse events and reads the page back.
 *
 *   [1] boot and the gate          the row exists ONLY with two sports; a one-sport league has none and its pills are still 44 pt; game pills read "{code} · {away} @ {home}" only with two sports
 *   [2] geometry (375 / 390 pt)    every pill >= 44 pt tall, 8 pt apart, >= 8 pt below the header's divider, >= 16 pt between the two rows (8 + 8), and >= 16 pt from the screen edge
 *                                  (the Chat page's inset was 14 pt until N4, 2026-10-08, and this line used to claim 16 without measuring it); at the largest text size the row SCROLLS
 *                                  past the edge instead of wrapping or clipping (momentum scrolling kept)
 *   [3] taps                       a real tap filters the one shared room (and the game pills), lands on the newest message, keeps the composer's draft, never moves the sport
 *                                  context, repaints in place; tapping the selected pill does nothing; All restores everything; the selection survives a tab round trip
 *   [4] unread                     dots per pill, cleared by opening THAT pill only, All's own cursor untouched
 *   [5] touch feedback and motion  97% press compress (forced :active), the 150 ms list fade, Reduce Motion = no animation, no transform
 *   [6] a target is never hidden   "Open in chat" for a message the pill would hide resets to All and brings the message into view; an account change drops the selection
 *
 * NOT MEASURABLE HERE (Drew's on-device list): the selection haptic, VoiceOver reading "NFL, 2 unread, selected", momentum feel and the fade as a thumb sees it, Dynamic Type at
 * the system's real largest size (modelled here as a 400% root font size (a stress bound)), the safe-area/home-indicator geometry.
 *
 * Run: node chatsportbrowsertest.mjs
 * Override the browser: CHATSPORT_ENGINE=/path/to/Chromium (falls back to CHATPAGE_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then /Applications).
 * Mutation runs: CHATSPORT_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree instead of this one — mutate the copy, never this checkout.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.CHATSPORT_ROOT || here;
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
const override = process.env.CHATSPORT_ENGINE || process.env.CHATPAGE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: CHATSPORT_ENGINE=/path/to/Chromium node chatsportbrowsertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (CHATSPORT_ROOT — serving ${ROOT})`);

// ── the app server: the real tree, local-mode config, no service worker, app files only ──────────
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

// ── the CDP client (chatpagetest.mjs's shape) ────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-chatsport-'));
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0',
    '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
    '--disable-background-networking', '--disable-sync', '--disable-component-update',
    '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen',
    '--metrics-recording-only', '--mute-audio',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
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
  await pg.send('DOM.enable');
  await pg.send('CSS.enable');
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
  /** A REAL tap: the pointer goes down and up on the centre of the element's box, so the page's own click handler runs exactly as it would for a thumb. */
  const tap = async (selector) => {
    const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!box) throw new Error('nothing to tap: ' + selector);
    for (const type of ['mousePressed', 'mouseReleased']) await pg.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(80);
  };
  const SPORT = (code) => `#page-chat .chat-sport-pill[data-chat-sport-filter="${code}"]`;
  /** The Locker Room's visible state in one read. */
  const READ = `(() => {
    const ids = [...document.querySelectorAll('#chat-scroll [data-mid]')].map(e => e.getAttribute('data-mid'));
    const sportRow = document.querySelector('#page-chat .chat-sport-pills');
    const pills = [...document.querySelectorAll('#page-chat .chat-sport-pill')].map(b => ({ v: b.dataset.chatSportFilter, on: b.getAttribute('aria-checked'), name: b.getAttribute('aria-label'), dot: (b.querySelector('.chat-unread-dot') || {}).textContent || '' }));
    const games = [...document.querySelectorAll('#page-chat .chat-pills-scroll [data-chat-filter]')].map(b => b.dataset.chatFilter).filter(v => v !== 'all' && v !== 'records');
    const lr = document.querySelector('#page-chat .chat-pills-scroll [data-chat-filter="all"]');
    const cs = document.getElementById('chat-scroll');
    return { ids, hasRow: !!sportRow, pills, games, lrDot: lr ? ((lr.querySelector('.chat-unread-dot') || {}).textContent || '') : null,
      sT: cs ? Math.round(cs.scrollTop) : null, atBottom: cs ? Math.abs(cs.scrollHeight - cs.scrollTop - cs.clientHeight) <= 2 : null,
      draft: (document.getElementById('chat-input') || {}).value, fade: cs ? cs.classList.contains('chat-scroll-fade') : null };
  })()`;
  const ROW = `(() => {
    const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height, w: b.width }; };
    const row = document.querySelector('#page-chat .chat-sport-pills'), game = document.querySelector('#page-chat .chat-pills-scroll'), head = document.querySelector('#page-chat .chat-header-row');
    const pills = row ? [...row.querySelectorAll('.chat-pill')].map(r) : [];
    const gpills = game ? [...game.querySelectorAll('.chat-pill')].map(r) : [];
    const cs = row ? getComputedStyle(row) : null;
    const card = document.querySelector('#page-chat .chat-surface');
    return { card: card && r(card), row: row && r(row), game: game && r(game), head: head && r(head), pills, gpills,
      overflowX: cs && cs.overflowX, momentum: cs && (cs.webkitOverflowScrolling || ''), scrollW: row && row.scrollWidth, clientW: row && row.clientWidth, vw: innerWidth,
      wrapped: pills.length > 1 && pills.some(p => Math.abs(p.t - pills[0].t) > 2) };
  })()`;

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode): two sports (CFB + NFL), a live game in each, a mixed Locker Room; land on Picks, then Chat…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(390, 844);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '1-0: fixture — the real index.html + js/app.js booted in the engine');
  const SEED = (twoSports) => `(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'].map((n, i) => ({ ...dm.createPlayer(n, '', '0000', '', n[0]), playerId: 'p' + (i + 1), active: true })).forEach(p => st.savePlayer(p));
    const CID = { cfb: '11111111-1111-4111-8111-111111111111', nfl: '22222222-2222-4222-8222-222222222222' };
    st.saveCompetition({ id: CID.cfb, sport: 'cfb', kind: 'season', enrollment: 'all', isDefault: true, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-01-01T00:00:00.000Z' });
    ${twoSports ? `st.saveCompetition({ id: CID.nfl, sport: 'nfl', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-02-01T00:00:00.000Z' });` : ''}
    const wk = dm.createWeek(2026, 6); wk.weekId = 'w_cfb'; wk.status = 'open'; st.saveWeek(wk); st.setActiveWeekId(wk.weekId);
    const kick = new Date(Date.now() + 86400000).toISOString();
    st.saveGame({ ...dm.createGame('w_cfb', { homeTeam: 'Michigan', awayTeam: 'Ohio State', kickoff: kick, spread: -3.5 }), gameId: 'gC', status: 'live' });
    ${twoSports ? `
    const nw = dm.createWeek(2026, 5); nw.weekId = 'w_nfl'; nw.status = 'open'; nw.competitionId = CID.nfl; st.saveWeek(nw);
    st.saveGame({ ...dm.createGame('w_nfl', { homeTeam: 'Green Bay', awayTeam: 'Detroit', kickoff: kick, spread: -2.5 }), gameId: 'gN', status: 'live' });
    st.saveGame({ ...dm.createGame('w_nfl', { homeTeam: 'Dallas', awayTeam: 'Seattle', kickoff: kick, spread: 1.5 }), gameId: 'gN2', status: 'scheduled' });` : ''}
    st.saveSetting('chatEnabled', true); st.saveSetting('chatEpochSeq', 0); st.saveSetting('chatRetentionDays', 0);
    st.setSession('p1', false, true);
    await new Promise(r => setTimeout(r, 1200));
  })()`;
  await evaluate(SEED(true));
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '1-1: fixture — after reload the app is past the site gate, signed in as a player');
  await evaluate(`window.navigateTo('picks')`);
  await sleep(300);
  const MSGS = `(async () => { const chat = await import('./js/chat.js'); let seq = 500; const T = (n) => Date.now() - (60 - n) * 60000;
    const mk = (id, extra) => ({ id, seq: ++seq, ts: T(seq - 500), type: 'message', author: 'p3', gameTag: '', body: id, replyTo: '', notify: true, meta: null, targetId: '', ...extra });
    chat.ingest([
      mk('plain1'), mk('cfbThread1', { gameTag: 'gC', sportTag: 'cfb' }), mk('nflThread1', { gameTag: 'gN', sportTag: 'nfl' }),
      mk('plain2', { author: 'p4' }), mk('sysCfb', { type: 'system', author: 'system', notify: false, meta: { kind: 'picksLocked', weekId: 'w_cfb' } }),
      mk('sysNfl', { type: 'system', author: 'system', notify: false, meta: { kind: 'weekFinal', weekId: 'w_nfl' } }),
      mk('nflLegacy', { gameTag: 'gN', author: 'p5' }), mk('plain3', { author: 'p6' }),
    ]); })()`;
  await evaluate(MSGS);
  await evaluate(`window.navigateTo('chat')`);
  await waitFor(`document.querySelectorAll('#chat-scroll [data-mid]').length >= 6`);
  await sleep(400);
  let s = await evaluate(READ);
  assert(s.hasRow && eq(s.pills.map(p => p.v), ['all', 'cfb', 'nfl']), `1-2: two sports -> the sport row exists: All · CFB · NFL (got ${JSON.stringify(s.pills.map(p => p.v))})`);
  assert(s.pills[0].on === 'true' && s.pills[1].on === 'false' && s.pills[2].on === 'false', '1-3: All is selected by default');
  const order = await evaluate(`(() => { const r = document.querySelector('#page-chat .chat-sport-pills'), g = document.querySelector('#page-chat .chat-pills-scroll'); return !!r && !!g && !!(r.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) && r.parentElement === g.parentElement; })()`);
  assert(order, '1-4: the sport row sits ABOVE the Locker Room / Records / game row, in the same sticky stack');
  assert(s.ids.length === 8, `1-5: All shows every row of the one shared room (${s.ids.length} of 8)`);
  assert(eq(s.games.slice().sort(), ['gC', 'gN']), `1-6: All lists every sport's game pills — the live NFL game gets one from ITS week too, the scheduled one with no thread does not (got ${JSON.stringify(s.games)})`);
  const pillText = async (id) => evaluate(`(() => { const b = document.querySelector('#page-chat .chat-pills-scroll [data-chat-filter="${id}"]'); if (!b) return null; const c = b.cloneNode(true); c.querySelectorAll('.chat-unread-dot').forEach((x) => x.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); })()`);
  assert(await pillText('gN') === 'NFL · DETR @ GB' && await pillText('gC') === 'CFB · OSU @ MICH', `1-6b: N6 (DI-530) — two sports: game pills read "{code} · {away} @ {home}" (${JSON.stringify([await pillText('gN'), await pillText('gC')])})`);
  const sheetSub = async (id) => {
    await evaluate(`(async () => { const ui = await import('./js/chat-ui.js'); ui.openGameChatSheet(${JSON.stringify(id)}); })()`);
    await sleep(200);
    const t = await evaluate(`(() => { const e = document.querySelector('#chat-sheet-wrap .chat-sheet-sub'); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    await evaluate(`document.getElementById('chat-sheet-close')?.click()`);
    await sleep(100);
    return t;
  };
  const subN = await sheetSub('gN'), subC = await sheetSub('gC');
  assert(/^NFL · /.test(subN) && /^CFB · /.test(subC), `1-6c: N6 — the game thread sheet's header names the sport in a two-sport league (${JSON.stringify([subN, subC])})`);
  const roles = await evaluate(`(() => { const r = document.querySelector('#page-chat .chat-sport-pills'); return { g: r.getAttribute('role'), l: r.getAttribute('aria-label'), b: [...r.querySelectorAll('button')].every(b => b.getAttribute('role') === 'radio' && b.type === 'button') }; })()`);
  assert(roles.g === 'radiogroup' && roles.l === 'Filter by sport' && roles.b, '1-7: a radiogroup "Filter by sport" of radio buttons');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[2] Geometry: 44 pt targets, 8 pt gaps, Breathing Room, no wrap — at 390 and 375, and at 400% text…');
  // ═════════════════════════════════════════════════════════════════════════
  const geom = async (label) => {
    const g = await evaluate(ROW);
    assert(g.pills.length === 3 && g.pills.every(p => p.h >= 43.9), `${label}-a: every sport pill is >= 44 pt tall (${g.pills.map(p => p.h).join('/')})`);
    assert(g.gpills.length >= 3 && g.gpills.every(p => p.h >= 43.9), `${label}-b: …and so is every existing pill (Locker Room, Records, game pills): ${g.gpills.map(p => p.h).join('/')}`);
    const gaps = g.pills.slice(1).map((p, i) => p.l - g.pills[i].r);
    assert(gaps.every(x => x >= 7.9), `${label}-c: 8 pt between the pills (${gaps.map(x => x.toFixed(1)).join('/')}) — they never touch`);
    assert(g.pills[0].t - g.head.b >= 7.9, `${label}-d: the first pill starts >= 8 pt below the header's divider (${(g.pills[0].t - g.head.b).toFixed(1)}) — a button never touches a line`);
    assert(g.game.t - g.row.b >= -0.1 && g.gpills[0].t - g.pills[0].b >= 15.9, `${label}-e: R1 — >= 16 pt between the sport row's pills and the next row's: 8 below the one + 8 above the other (${(g.gpills[0].t - g.pills[0].b).toFixed(1)})`);
    assert(Math.abs(g.pills[0].l - g.gpills[0].l) < 0.5, `${label}-f: the sport row's left edge lines up with the pill row below it (${g.pills[0].l.toFixed(1)} / ${g.gpills[0].l.toFixed(1)}) — one column, the page's own margin`);
    assert(g.pills[0].l >= 15.9 && g.gpills[0].l >= 15.9, `${label}-f2: N4 — the pills start >= 16 pt from the screen edge (${g.pills[0].l.toFixed(1)}), the Chat page's inset raised from 14`);
    assert(g.vw - g.card.r >= 15.9, `${label}-f3: …and so does the RIGHT edge — the thread's card ends >= 16 pt short of the screen (${(g.vw - g.card.r).toFixed(1)}): both sides moved, not just the left`);
    assert(g.card && Math.abs(g.card.l - g.pills[0].l) < 0.5, `${label}-f4: the thread's card shares the pills' left edge (${g.card && g.card.l.toFixed(1)}): the whole page moved to 16, not just one row`);
    assert(g.overflowX === 'auto' && !g.wrapped, `${label}-g: the row is a horizontal scroller (overflow-x ${g.overflowX}) and never wraps`);
    return g;
  };
  let g = await geom('2-390');
  await viewport(375, 667);
  await sleep(300);
  g = await geom('2-375');
  assert(g.scrollW <= g.clientW + 1, `2-375-h: at the smallest iPhone width the three pills fit without scrolling (${g.scrollW} in ${g.clientW})`);
  // The largest text size, modelled as a 400% root font size: a STRESS bound above iOS's largest Dynamic Type step (about 310%; three pills still just fit at 300% on a 375 pt phone, so the
  // scroll is exercised past it). The real setting is on Drew's device list.
  await evaluate(`document.documentElement.style.fontSize = '400%'`);
  await sleep(300);
  g = await evaluate(ROW);
  assert(g.scrollW > g.clientW + 1 && g.overflowX === 'auto' && !g.wrapped, `2-xl-a: at 400% text the row SCROLLS past the edge (${g.scrollW} > ${g.clientW}) instead of wrapping or clipping`);
  assert(g.pills.every(p => p.h >= 43.9) && g.pills.slice(1).every((p, i) => p.l - g.pills[i].r >= 7.9), '2-xl-b: …pills stay >= 44 pt tall with 8 pt between them');
  const lastReach = await evaluate(`(() => { const r = document.querySelector('#page-chat .chat-sport-pills'); r.scrollLeft = r.scrollWidth; const l = [...r.querySelectorAll('.chat-pill')].pop().getBoundingClientRect(); return { right: l.right, vw: innerWidth }; })()`);
  assert(lastReach.right <= lastReach.vw + 0.5, `2-xl-c: scrolled to the end, the last pill is fully reachable (${lastReach.right.toFixed(1)} <= ${lastReach.vw})`);
  await evaluate(`document.documentElement.style.fontSize = ''`);
  await viewport(390, 844);
  await sleep(300);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[3] Taps: the one shared room is filtered, in place — never forked, never tagged, never the sport context…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`(() => { const i = document.getElementById('chat-input'); i.value = 'a draft I have not sent'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const ctxBefore = await evaluate(`JSON.stringify(Object.keys(localStorage).filter(k => /sport|active_sport/i.test(k)).sort())`);
  await tap(SPORT('nfl'));
  await sleep(150);
  s = await evaluate(READ);
  const nflRows = ['plain1', 'nflThread1', 'plain2', 'sysNfl', 'nflLegacy', 'plain3'];
  assert(eq(s.ids.slice().sort(), nflRows.slice().sort()), `3-1: the NFL pill shows plain messages + NFL thread/system/legacy rows only (${JSON.stringify(s.ids)})`);
  assert(!s.ids.includes('cfbThread1') && !s.ids.includes('sysCfb'), '3-2: …and hides the CFB thread and the CFB system row');
  assert(s.pills.find(p => p.v === 'nfl').on === 'true' && s.pills.find(p => p.v === 'all').on === 'false', '3-3: the NFL pill is the selected radio (aria-checked), All is not');
  assert(/^NFL(, \d+ unread)?, selected$/.test(s.pills.find(p => p.v === 'nfl').name), `3-4: its accessible name carries the state ("${s.pills.find(p => p.v === 'nfl').name}")`);
  assert(eq(s.games, ['gN']), `3-5: the game pills narrow to the NFL's (${JSON.stringify(s.games)}) — no CFB game offered`);
  assert(s.atBottom, '3-6: the filtered view lands on its newest message');
  assert(s.draft === 'a draft I have not sent', '3-7: the composer\'s draft survives the repaint (nothing was rebuilt around it)');
  const ctxAfter = await evaluate(`JSON.stringify(Object.keys(localStorage).filter(k => /sport|active_sport/i.test(k)).sort())`);
  assert(ctxBefore === ctxAfter, `3-8: selecting a pill writes NOTHING to device storage and never touches a sport context (${ctxAfter})`);
  const noOtherRoom = await evaluate(`(async () => { const chat = await import('./js/chat.js'); return chat.getMessages({ tag: 'all' }).length; })()`);
  assert(noOtherRoom === 8, `3-9: still ONE log with ONE copy of every message (${noOtherRoom} rows in the fold)`);

  await tap(SPORT('nfl'));
  await sleep(100);
  s = await evaluate(READ);
  assert(s.pills.find(p => p.v === 'nfl').on === 'true' && s.ids.length === 6, '3-10: tapping the SELECTED pill again changes nothing');

  await tap(SPORT('cfb'));
  await sleep(150);
  s = await evaluate(READ);
  assert(eq(s.ids.slice().sort(), ['cfbThread1', 'plain1', 'plain2', 'plain3', 'sysCfb'].sort()), `3-11: the CFB pill shows plain messages + the CFB thread + the CFB system row (${JSON.stringify(s.ids)})`);
  assert(eq(s.games, ['gC']), `3-12: …and only the CFB game pill (${JSON.stringify(s.games)})`);

  await tap(SPORT('all'));
  await sleep(150);
  s = await evaluate(READ);
  assert(s.ids.length === 8 && s.pills.find(p => p.v === 'all').on === 'true', '3-13: All restores every row of the room');

  // a message sent under a pill is NOT tagged by the pill (the composer rule), and shows under every pill
  await tap(SPORT('nfl'));
  await sleep(100);
  await evaluate(`(() => { const i = document.getElementById('chat-input'); i.value = 'sent while NFL is selected'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('chat-send').click(); })()`);
  await sleep(300);
  const sent = await evaluate(`(async () => { const chat = await import('./js/chat.js'); const m = chat.getMessages({ tag: 'all' }).find(x => x.body === 'sent while NFL is selected'); return m ? { sport: m.sportTag || '', game: m.gameTag } : null; })()`);
  assert(sent && sent.sport === '' && sent.game === '', `3-14: a plain message sent under the NFL pill carries NO sport tag (the viewer's filter never tags what they send): ${JSON.stringify(sent)}`);
  await tap(SPORT('cfb'));
  await sleep(150);
  s = await evaluate(READ);
  assert(s.ids.length === 6 && await evaluate(`!!document.querySelector('#chat-scroll .chat-msg-text, #chat-scroll')`), '3-15: …and it shows under the CFB pill too (sport-agnostic): 5 rows + the new one');
  assert(await evaluate(`[...document.querySelectorAll('#chat-scroll')].some(e => e.textContent.includes('sent while NFL is selected'))`), '3-15: …the new message is in the CFB pill\'s list');

  // a pill tap from the middle of a long list lands on the newest message of the NEW view (not the place the reader had in the old one)
  await evaluate(`(async () => { const chat = await import('./js/chat.js'); let seq = 600;
    chat.ingest(Array.from({ length: 40 }, (_, i) => ({ id: 'own' + i, seq: ++seq, ts: Date.now() - (50 - i) * 1000, type: 'message', author: 'p1', gameTag: '', body: 'my filler ' + i, replyTo: '', notify: true, meta: null, targetId: '' }))); })()`);
  await tap(SPORT('all'));
  await sleep(200);
  await evaluate(`document.getElementById('chat-scroll').scrollTop = 0`);
  await sleep(100);
  const longList = await evaluate(`(() => { const e = document.getElementById('chat-scroll'); return { sH: e.scrollHeight, cH: e.clientHeight, sT: e.scrollTop }; })()`);
  assert(longList.sH > longList.cH + 400 && longList.sT === 0, `3-15b: fixture — the list is long (${longList.sH} in ${longList.cH}) and the reader is at its TOP`);
  await tap(SPORT('nfl'));
  await sleep(200);
  s = await evaluate(READ);
  assert(s.atBottom, '3-15c: a pill tap from the top of a long list lands on the NEWEST message of the filtered view');
  await evaluate(`document.getElementById('chat-scroll').scrollTop = 0`);
  await sleep(100);
  await tap(SPORT('all'));
  await sleep(200);
  assert((await evaluate(READ)).atBottom, '3-15d: …and so does a tap back to All');

  // the selection is kept across a tab round trip (Tab Bar: preserve state)
  await tap(SPORT('nfl'));
  await sleep(100);
  await evaluate(`window.navigateTo('dashboard')`);
  await sleep(300);
  await evaluate(`window.navigateTo('chat')`);
  await sleep(500);
  s = await evaluate(READ);
  assert(s.pills.find(p => p.v === 'nfl').on === 'true', '3-16: leaving Chat for another tab and coming back keeps the selected pill (the session\'s filter)');
  await tap(SPORT('all'));

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[4] Unread: a dot per pill, cleared by opening THAT pill only…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.navigateTo('picks')`);
  await sleep(300);
  await evaluate(`(async () => { const chat = await import('./js/chat.js'); chat.markSeen('all');
    const mk = (id, extra) => ({ id, seq: 900 + Math.floor(Math.random() * 1e6), ts: Date.now(), type: 'message', author: 'p3', gameTag: '', body: id, replyTo: '', notify: true, meta: null, targetId: '', ...extra });
    let n = 0; const e = (id, x) => ({ ...mk(id, x), seq: 700 + (++n) });
    chat.ingest([e('uPlain'), e('uCfb', { gameTag: 'gC', sportTag: 'cfb' }), e('uNfl', { gameTag: 'gN', sportTag: 'nfl' }), e('uNfl2', { sportTag: 'nfl' })]); })()`);
  await evaluate(`window.navigateTo('chat')`);
  await sleep(300);
  // Chat has just been entered: the 1 s mark-read timer is running against the CURRENT view (All); read the dots before it fires.
  s = await evaluate(READ);
  const dots = Object.fromEntries(s.pills.map(p => [p.v, p.dot]));
  assert(dots.all === '4' && dots.cfb === '2' && dots.nfl === '3', `4-1: dots before anything is opened — All 4, CFB 2 (plain + CFB thread), NFL 3 (plain + NFL thread + tagged): ${JSON.stringify(dots)}`);
  assert(s.lrDot === '4', '4-2: the existing Locker Room pill carries the same room count (unchanged)');
  assert(/All, 4 unread/.test(s.pills[0].name) && /NFL, 3 unread/.test(s.pills[2].name), `4-3: the accessible names carry the counts (${s.pills.map(p => p.name).join(' | ')})`);
  // open the NFL pill and let the 1 s mark-read run: ONLY NFL clears
  await tap(SPORT('nfl'));
  await sleep(1500);
  s = await evaluate(READ);
  const dots2 = Object.fromEntries(s.pills.map(p => [p.v, p.dot]));
  // CHANGED 2026-10-08 (coordinator decision N1, W-57 review). This line used to expect All still 4 after reading the NFL pill: the room cursor did not move, so All kept counting rows the reader had
  // just read (uPlain, uNfl, uNfl2). Reading under a pill now ALSO advances the room cursor, up to but never past the oldest unread row that pill hides (the CFB thread row uCfb, seq 702): All is 3.
  assert(dots2.nfl === '' && dots2.cfb === '2' && dots2.all === '3', `4-4: reading the NFL pill clears NFL; All drops 4 -> 3 (the room cursor follows, held below the unread CFB-thread row); CFB is still 2 — each pill clears only when opened: ${JSON.stringify(dots2)}`);
  const n1 = await evaluate(`(async () => { const chat = await import('./js/chat.js'); const nav = document.querySelector('.nav-item[data-tab="chat"] .nav-unread'); return { room: chat.getLastSeen().seq, lr: (document.querySelector('#page-chat .chat-pills-scroll [data-chat-filter="all"] .chat-unread-dot') || {}).textContent || '', nav: nav ? nav.textContent : '', title: document.title, cfbCursor: chat.getLastSeen().byTag['sport:cfb'] }; })()`);
  assert(n1.room === 701, `4-4b: the room cursor stopped at 701, one BEFORE the oldest unread row the NFL pill hides (uCfb, 702) — never past a hidden unread row (got ${n1.room})`);
  assert(n1.lr === '3' && n1.nav === '3' && /^\(3\) /.test(n1.title), `4-4c: the Locker Room pill, the Chat tab badge and the page title all say 3 (${n1.lr} / ${n1.nav} / ${JSON.stringify(n1.title)})`);
  assert(n1.cfbCursor === 640, `4-4d: the CFB pill's cursor was fixed where it stood (640) so reading NFL cannot clear CFB's dot (got ${n1.cfbCursor})`);
  await tap(SPORT('all'));
  await sleep(1500);
  s = await evaluate(READ);
  assert(s.pills.every(p => p.dot === '') && s.lrDot === '', `4-5: opening All reads the room: every dot clears (${JSON.stringify(s.pills.map(p => p.dot))})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[5] Touch feedback and motion…');
  // ═════════════════════════════════════════════════════════════════════════
  const pressed = async (selector) => {
    const doc = await pg.send('DOM.getDocument', { depth: 1 });
    const q = await pg.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    await pg.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: ['active'] });
    await sleep(250);
    const t = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transform`);
    await pg.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: [] });
    await sleep(250);
    return t;
  };
  const tr = await pressed(SPORT('cfb'));
  assert(tr === 'matrix(0.97, 0, 0, 0.97, 0, 0)', `5-1: a pressed sport pill compresses to 97% (${tr})`);
  const trg = await pressed('#page-chat .chat-pills-scroll [data-chat-filter="records"]');
  assert(trg === 'matrix(0.97, 0, 0, 0.97, 0, 0)', `5-2: …and so does every EXISTING pill (the touched-screen audit: Records ${trg})`);
  const rel = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(SPORT('cfb'))})).transform`);
  assert(rel === 'none', `5-3: released, it returns to its resting size (${rel})`);
  const dur = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(SPORT('cfb'))})).transitionDuration`);
  assert(dur === '0.15s', `5-4: the return is smooth over --motion-fast, 150 ms (${dur})`);
  // the list fade after a tap
  await tap(SPORT('nfl'));
  const fade = await evaluate(READ);
  const fadeCss = await evaluate(`(() => { const e = document.getElementById('chat-scroll'); return { has: e.classList.contains('chat-scroll-fade'), anim: getComputedStyle(e).animationName, dur: getComputedStyle(e).animationDuration }; })()`);
  assert(fadeCss.has && fadeCss.anim === 'chatSportFade' && fadeCss.dur === '0.15s', `5-5: right after a pill tap the new list fades in over 150 ms (${JSON.stringify(fadeCss)})`);
  await sleep(400);
  assert(!(await evaluate(`document.getElementById('chat-scroll').classList.contains('chat-scroll-fade')`)), '5-6: …and the class is removed when the animation ends (nothing is left animating)');
  void fade;
  // P-3 (a new touch during a hold; Testing Protocol 228): the 150 ms fade is a class on the ALREADY-painted list, never a gate - a second tap that lands INSIDE the fade is honoured at once. `tap()` waits 80 ms after
  // each press, so the second press below lands ~80 ms into the first tap's fade (the class is still on the list when it arrives; asserted, so the test cannot pass by arriving late).
  await tap(SPORT('cfb'));
  const duringFade = await evaluate(`document.getElementById('chat-scroll').classList.contains('chat-scroll-fade')`);
  await tap(SPORT('nfl'));
  const afterSecond = await evaluate(READ);
  assert(duringFade === true, '5-6b: a tap on the NFL pill has landed while the CFB tap\'s fade was still running (the fade class was on the list when the second press arrived)');
  assert(afterSecond.pills.find(p => p.v === 'nfl').on === 'true' && afterSecond.pills.find(p => p.v === 'cfb').on === 'false' && afterSecond.ids.includes('nflThread1') && !afterSecond.ids.includes('cfbThread1'),
    `5-6c: …and that second tap was honoured at once - the NFL pill is selected and the list is the NFL's (${JSON.stringify(afterSecond.ids)})`);
  await sleep(400);
  assert(!(await evaluate(`document.getElementById('chat-scroll').classList.contains('chat-scroll-fade')`)), '5-6d: …and nothing is left animating after the back-to-back taps');
  // Reduce Motion: instant (no fade class), no press transform, no transition
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(150);
  await tap(SPORT('cfb'));
  const rm = await evaluate(`(() => { const e = document.getElementById('chat-scroll'); return { has: e.classList.contains('chat-scroll-fade'), anim: getComputedStyle(e).animationName }; })()`);
  assert(!rm.has, `5-7: Reduce Motion: the list swaps INSTANTLY (no fade class; animation "${rm.anim}")`);
  const trRm = await pressed(SPORT('nfl'));
  const durRm = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(SPORT('nfl'))})).transitionDuration`);
  assert(trRm === 'none' && durRm === '0s', `5-8: Reduce Motion: no press compress and no transition (${trRm} / ${durRm})`);
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await tap(SPORT('all'));

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[6] A target is never hidden; the filter belongs to one account…');
  // ═════════════════════════════════════════════════════════════════════════
  await tap(SPORT('cfb'));
  await sleep(150);
  assert(!(await evaluate(READ)).ids.includes('nflThread1'), '6-0: fixture — with CFB selected the NFL thread message is not in the list');
  const opened = await evaluate(`(async () => { const ui = await import('./js/chat-ui.js'); return ui.showChatMessage('nflThread1'); })()`);
  await sleep(200);
  s = await evaluate(READ);
  assert(opened === true && s.pills.find(p => p.v === 'all').on === 'true' && s.ids.includes('nflThread1'), `6-1: "Open in chat" for a message the CFB pill would hide resets the filter to All first and the message is on screen (opened ${opened})`);
  assert(await evaluate(`!!document.querySelector('#chat-scroll [data-mid="nflThread1"].chat-flash')`), '6-2: …and it gets the house flash');
  // the PUSH path: a notification tap lands in deepLinkTo() (window.deepLinkTo), which must reset the pill BEFORE the room paints, or the message it scrolls to is not in the list
  await tap(SPORT('cfb'));
  await sleep(150);
  assert(!(await evaluate(READ)).ids.includes('nflThread1'), '6-2b: fixture — CFB selected again, the NFL thread message is hidden');
  await evaluate(`window.deepLinkTo({ tab: 'chat', params: { messageId: 'nflThread1' } })`);
  assert(await waitFor(`document.querySelector('#chat-scroll [data-mid="nflThread1"].chat-flash')`, 4000), '6-2c: a push/notification deep link to a message the CFB pill would hide opens it (the filter was reset first) and flashes it');
  assert((await evaluate(READ)).pills.find(p => p.v === 'all').on === 'true', '6-2d: …and the selected pill is All');
  // a game THREAD of the other sport (the existing game pill) while CFB is selected: the pill row yields
  await tap(SPORT('cfb'));
  await sleep(100);
  await evaluate(`(async () => { const ui = await import('./js/chat-ui.js'); ui.setChatChannel('game:gN'); ui.renderChatPage(); })()`);
  await sleep(150);
  s = await evaluate(READ);
  assert(s.pills.find(p => p.v === 'all').on === 'true', '6-3: opening an NFL game thread while CFB is selected resets the filter to All (a thread is never hidden behind a pill)');
  await evaluate(`(async () => { const ui = await import('./js/chat-ui.js'); ui.setChatChannel('all'); ui.renderChatPage(); })()`);
  // another account does not inherit the selection
  await tap(SPORT('nfl'));
  await sleep(100);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const ui = await import('./js/chat-ui.js'); st.setSession('p2', false, true); ui.renderChatPage(); })()`);
  await sleep(200);
  s = await evaluate(READ);
  assert(s.pills.find(p => p.v === 'all').on === 'true', '6-4: a different signed-in member does not inherit the previous member\'s selected pill');
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p1', false, true); })()`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[7] A one-sport league: no row at all, and its pills are still 44 pt…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`localStorage.clear()`);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '7-0: fixture — rebooted');
  await evaluate(SEED(false));
  await navigate();
  await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`);
  await evaluate(`window.navigateTo('picks')`);
  await sleep(300);
  await evaluate(MSGS);
  await evaluate(`window.navigateTo('chat')`);
  await waitFor(`document.querySelectorAll('#chat-scroll [data-mid]').length >= 5`);
  await sleep(400);
  s = await evaluate(READ);
  assert(!s.hasRow && s.pills.length === 0 && (await evaluate(`!document.querySelector('#page-chat [class*="chat-sport"], #page-chat [data-chat-sport-filter]')`)), '7-1: ONE sport -> not one sport element on the page');
  g = await evaluate(ROW);
  assert(g.gpills.length >= 2 && g.gpills.every(p => p.h >= 43.9), `7-2: …and the existing pills are 44 pt (${g.gpills.map(p => p.h).join('/')})`);
  assert(g.gpills[0].t - g.head.b >= 7.9, `7-2b: R1 — in a one-sport league the pill row starts >= 8 pt below the header's divider (${(g.gpills[0].t - g.head.b).toFixed(1)}; it was 2)`);
  assert(g.gpills[0].l >= 15.9, `7-2c: N4 — and 16 pt from the screen edge (${g.gpills[0].l.toFixed(1)}; it was 14)`);
  const slot = await evaluate(`(() => { const h = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().height : null; }; return { pills: h('#page-chat .chat-pills-scroll') }; })()`);
  await evaluate(`document.getElementById('chat-search-btn').click()`);
  await sleep(250);
  const searchSlot = await evaluate(`(() => { const e = document.querySelector('#page-chat .chat-search-row'); const b = e && e.getBoundingClientRect(); const i = document.getElementById('chat-search-input'); return b ? { h: b.height, input: i.getBoundingClientRect().height } : null; })()`);
  assert(searchSlot && Math.abs(searchSlot.h - slot.pills) < 0.6 && searchSlot.input >= 43.9, `7-2d: opening search swaps the pills row for the search row in a slot of the SAME height (${slot.pills} / ${searchSlot && searchSlot.h}) — the 44 pt pills and the 8 pt divider gap did not make the page jump — and its field is 44 pt (${searchSlot && searchSlot.input})`);
  await evaluate(`document.getElementById('chat-search-close').click()`);
  await sleep(200);
  assert(await pillText('gC') === 'OSU/MICH', `7-2e: a ONE-sport league's game pill is still the short "AWAY/HOME" form, byte-identical to before (${JSON.stringify(await pillText('gC'))})`);
  assert(!/^CFB · /.test(await sheetSub('gC')), '7-2f: …and its thread sheet header does not name a sport');
  assert(eq(s.games.slice().sort(), ['gC']) && s.ids.length === 8, `7-3: the room and its game pills are exactly as they were (one game pill ${JSON.stringify(s.games)}, ${s.ids.length} rows)`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[8] W-57 Part 2 — the phone page inset is 16 pt on EVERY tab (the Chat-only 16 had made the page edge jump 2 pt between tabs): computed style, in the real app…');
  // ═════════════════════════════════════════════════════════════════════════
  // The hard-coded v14.1 "mobile edge guard" (.main-content{padding:0 14px}) and the 14 / 10 pt phone tiers of --page-pad set the inset to 14 pt (10 below 360 pt) on every tab but Chat. One token, 16 pt, on
  // every phone width; the tablet tier (24 pt from 768 pt) is not touched.
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p1', true, true); })()`);
  const TABS = ['picks', 'dashboard', 'home', 'chat', 'leaderboard', 'rules', 'commissioner', 'admin'];
  const insetOf = async (tab) => {
    await evaluate(`window.navigateTo(${JSON.stringify(tab)})`);
    await waitFor(`document.getElementById('page-${tab}')?.classList.contains('active')`, 3000);
    await sleep(150);
    return evaluate(`(() => { const mc = document.querySelector('.main-content'), cs = getComputedStyle(mc), pg = document.getElementById('page-${tab}'); const r = pg.getBoundingClientRect();
      return { active: pg.classList.contains('active'), padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), left: r.left, rightGap: innerWidth - r.right, vw: innerWidth, pageDisplay: getComputedStyle(pg).display }; })()`);
  };
  for (const [w, h] of [[390, 844], [375, 667], [360, 740], [320, 568]]) {
    await viewport(w, h);
    const bad = [];
    for (const tab of TABS) {
      const m = await insetOf(tab);
      if (!m.active || m.pageDisplay === 'none') { bad.push(`${tab}:not shown`); continue; }
      if (Math.abs(m.padL - 16) > 0.1 || Math.abs(m.padR - 16) > 0.1 || Math.abs(m.left - 16) > 0.6 || Math.abs(m.rightGap - 16) > 0.6) bad.push(`${tab}: pad ${m.padL}/${m.padR}, left ${m.left.toFixed(1)}, right gap ${m.rightGap.toFixed(1)}`);
    }
    assert(bad.length === 0, `8-${w}: at ${w} pt wide every tab's content (${TABS.join(', ')}) sits 16 pt from both screen edges — computed .main-content padding AND the page's own box${bad.length ? ' — ' + bad.join(' | ') : ''}`);
  }
  await viewport(768, 1024);
  const tablet = await insetOf('picks');
  assert(Math.abs(tablet.padL - 24) < 0.1 && Math.abs(tablet.padR - 24) < 0.1, `8-768: the tablet tier is untouched — 24 pt from 768 pt up (${tablet.padL}/${tablet.padR})`);
  await viewport(390, 844);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[9] W-57 follow-up N4 - the SCRIBE feedback popover keeps 16 pt from the screen edge on BOTH entry points (it sat 6 pt away at 390): computed geometry in the real app…');
  // ═════════════════════════════════════════════════════════════════════════
  // The natural popover is 320 pt wide and opens from the message column's left edge (x = 64 on the row path, 65 on the long-press bar), so on a 385-400 pt phone its right edge was 0-15 pt from the
  // screen edge. It is now capped at 100vw - 82px: the 2x2 grid stays 2x2 and its columns give back a few points. Below 385 pt the single-column rule still applies. Nothing else about it changes: every
  // option is still >= 44 pt in both axes, and the reason row (which appears once a rating is chosen) stays inside the popover.
  const POP = `(() => { const p = document.getElementById('chat-feedback-picker'); if (!p) return null; const b = p.getBoundingClientRect(); const g = p.querySelector('.feedback-picker-grid'); const rs = p.querySelector('.feedback-reason'); const rb = rs && rs.getBoundingClientRect();
    const opts = [...p.querySelectorAll('.feedback-pick-option')].map(o => { const r = o.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right }; });
    return { host: p.parentElement.className, l: b.left, r: b.right, vw: innerWidth, gap: innerWidth - b.right, cols: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0, n: opts.length,
      smallest: opts.length ? Math.min(...opts.map(o => Math.min(o.w, o.h))) : 0, optOut: opts.some(o => o.l < b.left - 0.5 || o.r > b.right + 0.5), reason: rb && { l: rb.left, r: rb.right, inside: rb.left >= b.left - 0.5 && rb.right <= b.right + 0.5 } }; })()`;
  const tapEl = async (selector) => { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`); await sleep(120); await tap(selector); await sleep(250); };
  let fbSeq = 900;
  const edgeCases = [];
  for (const [w, h] of [[430, 900], [400, 860], [393, 852], [390, 844], [385, 840], [384, 840], [375, 667], [360, 740], [320, 568]]) {
    await viewport(w, h);
    const id = `fbN4_${w}`;
    await evaluate(`(async () => { const chat = await import('./js/chat.js'); chat.ingest([{ id: ${JSON.stringify(id)}, seq: ${++fbSeq}, ts: Date.now() - 1000, type: 'message', author: 'scribe', gameTag: '', body: 'a SCRIBE line to rate at ${w}', replyTo: '', notify: true, meta: null, targetId: '' }]); })()`);
    await evaluate(`window.navigateTo('chat')`);
    await waitFor(`document.querySelector('#chat-scroll [data-mid="${id}"] .chat-fb-star')`, 4000);
    await sleep(300);
    // the row path: the persistent star, tapped for real
    await tapEl(`#chat-scroll [data-mid="${id}"] .chat-fb-star`);
    const row = await evaluate(POP);
    // choosing a rating reveals the reason row in the SAME popover
    if (row) await tapEl('#chat-feedback-picker .feedback-pick-option');
    const rated = await evaluate(POP);
    await tapEl(`#chat-scroll [data-mid="${id}"] .chat-fb-star`);                       // the star again is the dismissal (R-4)
    await evaluate(`window.navigateTo('picks')`); await sleep(150);
    await evaluate(`window.navigateTo('chat')`); await waitFor(`document.querySelector('#chat-scroll [data-mid="${id}"]')`, 4000); await sleep(250);
    // the long-press bar path: the bar is revealed (the hold itself is a device check), its feedback button tapped for real
    await evaluate(`document.querySelector('#chat-scroll [data-mid="${id}"]')?.classList.add('chat-actions-revealed')`); await sleep(120);
    await tapEl(`#chat-scroll [data-mid="${id}"] .chat-act-feedback`);
    const bar = await evaluate(POP);
    await evaluate(`window.navigateTo('picks')`); await sleep(100);
    const wantCols = w <= 384 ? 1 : 2;
    const okEdge = (x) => !!x && x.gap >= 15.9 && x.l >= 15.9;
    assert(!!row && !!bar && row.host.includes('chat-reactions') && bar.host.includes('chat-actions') && okEdge(row) && okEdge(bar),
      `9-${w}a: at ${w} pt wide the popover sits >= 16 pt from BOTH screen edges on both entry points - row path ${row ? `${row.l.toFixed(0)}..${row.r.toFixed(0)} (right gap ${row.gap.toFixed(1)})` : 'DID NOT OPEN'}, long-press bar ${bar ? `${bar.l.toFixed(0)}..${bar.r.toFixed(0)} (right gap ${bar.gap.toFixed(1)})` : 'DID NOT OPEN'}`);
    assert(!!row && row.cols === wantCols && row.n === 4 && row.smallest >= 43.9 && !row.optOut,
      `9-${w}b: ${wantCols === 2 ? 'the 2x2 grid is kept' : 'the single-column fallback applies'} (${row && row.cols} column${row && row.cols === 1 ? '' : 's'}), all ${row && row.n} options are >= 44 pt in both axes (smallest ${row && row.smallest.toFixed(1)}) and inside the popover`);
    assert(!!rated && !!rated.reason && rated.reason.inside && okEdge(rated) && !!row && Math.abs(rated.r - row.r) < 0.6 && Math.abs(rated.l - row.l) < 0.6,
      `9-${w}c: once a rating is chosen the reason row appears INSIDE the same popover, the popover still keeps 16 pt and does NOT change width (no jump on the tap): reason ${rated && rated.reason ? `${rated.reason.l.toFixed(0)}..${rated.reason.r.toFixed(0)}` : 'ABSENT'}, popover ${row ? `${row.l.toFixed(0)}..${row.r.toFixed(0)}` : '-'} -> ${rated ? `${rated.l.toFixed(0)}..${rated.r.toFixed(0)} (right gap ${rated.gap.toFixed(1)})` : '-'}`);
    edgeCases.push([w, row && row.gap, bar && bar.gap]);
  }
  assert(edgeCases.find(([w]) => w === 390)[1] >= 15.9 && edgeCases.find(([w]) => w === 393)[1] >= 15.9 && edgeCases.find(([w]) => w === 385)[1] >= 15.9,
    `9-edge: the three widths that were short of Breathing Room (385 / 390 / 393) are all >= 16 pt now (right gaps ${JSON.stringify(edgeCases.filter(([w]) => [385, 390, 393].includes(w)).map(([w, g]) => `${w}: ${g && g.toFixed(1)}`))}; at 390 it was 6)`);
  await viewport(390, 844);
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

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 20000).unref();
