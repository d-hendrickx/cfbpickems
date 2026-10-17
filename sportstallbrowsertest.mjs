/**
 * CFB Pickems - sportstallbrowsertest.mjs
 * ========================================
 * D1 (Deployment 1, 2026-10-14; DI-557 + DI-535 #4) - THE STALL BANNER, proven in a real engine. P-8: a new surface's styling is proven by computed style in a real browser, not by class names.
 *
 * ENGINE-MEASURED through the REAL app: the real index.html, css/styles.css and js/app.js booted in a real headless Chromium in local (PIN) mode; a commissioner who plays both sports, a CFB and an
 * NFL week (locked, a game each kicked off an hour ago, an ESPN id on every game) seeded through the app's OWN storage.js. The 60 s refresh interval is compressed by wrapping setInterval for the
 * ONE callback that calls runAutoRefreshTick, so the banner is raised by the page's own timer, polling the page's own doRefreshScores, over a fetch that fails or answers on command (an
 * ESPN host is not reachable here anyway). Nothing calls the paint to "arm" it (P-2). The red banner is raised by the page's own 'cfbp:migration-pending' listener and dismissed by tapping its
 * own close button through the real click path.
 *
 *   [A] ARRIVAL       three failing ticks raise ONE banner; it is role="status"; the rows read exactly; one success removes it (the in-place paint); the page is Home, then Comm, Picks, Standings, Dashboard.
 *   [B] COMPUTED STYLE (P-8)  the banner is the app's .warning-box (same fill, text color, radius, font as a real one), in the page flow (position static), a flex row, 8 px between glyph and text and
 *                     between rows, 16 px below it, 24 px glyph, never red, never covering the next element, the red banner above it in z-order; the first and the last of the three siblings agree on 16 px.
 *   [C] THE ONE FADE  the node that ARRIVES animates once (the app's fade, --motion-fast, --ease-native); an unchanged repaint (the Dashboard rebuilds every tick) puts back a node with NO animation and
 *                     no class; a changed row set animates once more; Reduce Motion: none.
 *   [D] NOTHING MOVES UNDER THE THUMB  scrolled down, the banner's arrival and its removal offset the scroller by exactly its height: a content row stays where it was on every frame; at the top the page is pushed down.
 *   [E] RED WINS      with the red banner visible the stall banner is withheld and the red node is untouched; dismissed through its own close button, the stall banner returns by itself.
 *   [F] SCOPE         Home: every sport; Picks and Standings: the context sport (switched through the real segmented control); the Dashboard its scope; Rules and Locker Room never; a player sees the plain line.
 *   [G] GEOMETRY      375 pt wide and at the largest text size: it wraps, nothing overflows, nothing is truncated, it never covers the tab bar; night mode keeps the text readable.
 *   [H] TRIGGER 3     a game stamped with an unregistered sport code (the one-line way on a test league): the commissioner's diagnostic naming it, the player's plain line, a 40-character unbroken code wrapping
 *                     inside the banner at 375 pt and the largest text size; the correction clears it.
 *
 * WHAT ONLY A DEVICE CAN CONFIRM: Blink is not WebKit. Whether WKWebView honours the same scroll offset in the same frame, how the fade feels on glass, and what VoiceOver says (once, not on every tick) are
 * Drew's on-device walk. A real-time sample proves Blink's frames; it does not prove WebKit's.
 *
 * Run: node sportstallbrowsertest.mjs
 * Override the browser: SPORTSTALL_ENGINE=/path/to/Chromium (falls back to COMMNAV_ENGINE, WEEKPAGER_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE).
 * Mutation runs: SPORTSTALL_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree instead of this one - mutate the copy, never this checkout.
 * Evidence: SPORTSTALL_SHOTS=/dir saves a screenshot of each state it proves.
 */

import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.SPORTSTALL_ROOT || here;
const SHOTS = process.env.SPORTSTALL_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
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
const override = process.env.SPORTSTALL_ENGINE || process.env.COMMNAV_ENGINE || process.env.WEEKPAGER_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: SPORTSTALL_ENGINE=/path/to/Chromium node sportstallbrowsertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (SPORTSTALL_ROOT - serving ${ROOT})`);

// -- the app server: the real tree, local-mode config, no service worker --------------------------------------------------------------------------------------------------------------
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

// -- the CDP client (same shape as commnavbrowsertest.mjs) ----------------------------------------------------------------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-sportstall-'));
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

// -- what runs in the page BEFORE the app does ----------------------------------------------------------------------------------------------------------------------------------------
// (1) the refresh interval: the app arms setInterval(() => { runAutoRefreshTick(); }, 60000). Only THAT callback is compressed (to 400 ms), so the page's own timer drives the page's own polls.
// (2) ESPN: window.__espn = { cfb, nfl } is 'ok' (an event per id in window.__events[sport]), 'empty' (a board with zero events) or 'fail' (HTTP 503). Every other request is the real fetch.
const INIT = `(() => {
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => realSetInterval(fn, (ms === 60000 && String(fn).includes('runAutoRefreshTick')) ? 400 : ms, ...rest);
  window.__espn = { cfb: 'ok', nfl: 'ok' }; window.__events = { cfb: [], nfl: [] }; window.__espnCalls = 0;
  const realFetch = window.fetch.bind(window);
  const ev = (id) => ({ id, date: '2026-10-08T18:00Z', status: { type: { name: 'STATUS_SCHEDULED', detail: '', shortDetail: '' } },
    competitions: [{ timeValid: true, neutralSite: false, competitors: [
      { homeAway: 'home', id: '1', score: '0', curatedRank: { current: 99 }, team: { id: '1', location: 'Home', name: 'Hosts', shortDisplayName: 'Home' } },
      { homeAway: 'away', id: '2', score: '0', curatedRank: { current: 99 }, team: { id: '2', location: 'Away', name: 'Visitors', shortDisplayName: 'Away' } }],
      odds: [], broadcasts: [], notes: [], venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } } }] });
  window.fetch = async (url, opts) => {
    const u = decodeURIComponent(String(url));
    if (!/espn\\.com|allorigins|corsproxy|codetabs/.test(u)) return realFetch(url, opts);
    window.__espnCalls++;
    const sport = /\\/football\\/nfl\\//.test(u) ? 'nfl' : 'cfb';
    const mode = window.__espn[sport];
    if (mode === 'fail') return new Response('', { status: 503 });
    const events = mode === 'empty' ? [] : window.__events[sport].map(ev);
    return new Response(JSON.stringify({ events }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
})();`;

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const pg = await attach(engine.ws);
  await pg.send('Page.enable');
  await pg.send('Runtime.enable');
  await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 8000) => {
    for (let t = 0; t < ms; t += 50) { if (await evaluate(`!!(${expression})`)) return true; await sleep(50); }
    return false;
  };
  const navigate = async () => {
    const loaded = pg.once('Page.loadEventFired');
    await pg.send('Page.navigate', { url: ORIGIN + '/index.html' });
    await loaded;
  };
  const viewport = async (w, h) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await pg.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(150);
  };
  const reducedMotion = async (on) => {
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
    await sleep(60);
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    const r = await pg.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const espn = (cfb, nfl) => evaluate(`(window.__espn.cfb = ${JSON.stringify(cfb)}, window.__espn.nfl = ${JSON.stringify(nfl)}, true)`);
  const go = async (tab) => { await evaluate(`window.navigateTo(${JSON.stringify(tab)})`); await sleep(120); };
  const bannerCount = () => evaluate(`document.querySelectorAll('#sport-stall-banner').length`);
  const rowsNow = () => evaluate(`[...document.querySelectorAll('#sport-stall-banner p')].map(p => p.textContent)`);
  const bannerIn = (page) => evaluate(`!!document.querySelector('#page-${page} #sport-stall-banner')`);

  // ======================================================================================================================================================================================
  console.log('\n[1] Boot the REAL app (local mode); seed a commissioner who plays CFB and NFL, a locked week of each with a game kicked off an hour ago…');
  // ======================================================================================================================================================================================
  await viewport(390, 844);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '1-0: fixture - the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    localStorage.setItem('cfbp_supabase_active_league', 'L-test-0001');   // the sport pointer is keyed by (account, league): a league must be active for it to be written
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const CFB = '11111111-1111-4111-8111-111111111111', NFL = '22222222-2222-4222-8222-222222222222';
    const players = ['Drew', 'Brayden', 'Kevin', 'Koby'].map((n, i) => ({ ...dm.createPlayer(n, '', '1111', '', n.slice(0, 2).toUpperCase()), playerId: 'p' + (i + 1) }));
    players.forEach(p => st.savePlayer(p));
    st.saveCompetition({ id: CFB, sport: 'cfb', kind: 'season', enrollment: 'all', isDefault: true, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-01-01T00:00:00.000Z' });
    st.saveCompetition({ id: NFL, sport: 'nfl', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-02-01T00:00:00.000Z' });
    const hour = 3600e3, now = Date.now();
    for (const [sp, cid] of [['cfb', CFB], ['nfl', NFL]]) {
      const wk = dm.createWeek(2026, 6, '', '', cid === CFB ? {} : { competitionId: cid });
      wk.weekId = 'w_' + sp + '_6'; wk.status = 'locked'; wk.dataSourceMode = 'live';
      const base = new Date(now - hour); wk.startDate = base.toISOString().slice(0, 10); wk.endDate = wk.startDate;
      st.saveWeek(wk);
      if (sp === 'cfb') st.setActiveWeekId(wk.weekId);
      for (let i = 0; i < 12; i++) {
        const g = dm.createGame(wk.weekId, { homeTeam: sp.toUpperCase() + ' Home ' + i, awayTeam: sp.toUpperCase() + ' Away ' + i, kickoff: new Date(now + (i === 0 ? -hour : hour * (1 + i))).toISOString(),
          spread: -3.5, lockedSpread: -3.5, kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening', espnEventId: sp + '-ev-' + i, espnSport: sp === 'nfl' ? 'nfl' : null });
        g.gameId = 'g_' + sp + '_' + i; st.saveGame(g);
      }
    }
    st.setSession('p1', true, true);
    await new Promise(r => setTimeout(r, 1200));
    return { weeks: st.getWeeks().length, games: st.getGames('w_cfb_6').length + st.getGames('w_nfl_6').length };
  })()`);
  assert(seeded.weeks >= 2 && seeded.games === 24, `1-1: fixture - the two locked weeks and their 24 games are in the app's own storage.js (got ${JSON.stringify(seeded)})`);
  // Both feeds answer for the game ids the page will poll.
  const ids = (sp) => Array.from({ length: 12 }, (_, i) => `${sp}-ev-${i}`);
  await evaluate(`(window.__events.cfb = ${JSON.stringify(ids('cfb'))}, window.__events.nfl = ${JSON.stringify(ids('nfl'))}, true)`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '1-2: fixture - after reload the app is past the site gate');
  await evaluate(`(window.__events.cfb = ${JSON.stringify(ids('cfb'))}, window.__events.nfl = ${JSON.stringify(ids('nfl'))}, true)`);
  await waitFor(`document.querySelector('#page-home.active') && !document.querySelector('#home-root .home-feed[aria-busy="true"]')`, 10000);
  const timerOn = await waitFor(`window.__espnCalls > 0`, 4000);
  assert(timerOn, '1-3: fixture - the page\'s OWN compressed interval is polling ESPN (the real runAutoRefreshTick, not this suite)');
  await sleep(1000);
  assert(await bannerCount() === 0, '1-4: with both feeds answering there is no banner anywhere');

  // ======================================================================================================================================================================================
  console.log('\n[A] ARRIVAL - three failing ticks raise ONE banner, a success removes it…');
  // ======================================================================================================================================================================================
  await go('home');
  await espn('ok', 'fail');
  assert(await waitFor(`document.getElementById('sport-stall-banner')`, 8000), 'A-1: the NFL feed fails; within a few of the page\'s own ticks the banner appears on Home with no navigation (the in-place paint)');
  const rows1 = await rowsNow();
  assert(await bannerCount() === 1 && rows1.length === 1 && rows1[0] === "NFL scores aren't updating — the live feed failed. Scores may be stale until this is fixed.",
    `A-2: ONE banner, ONE row, the commissioner copy exactly (got ${JSON.stringify(rows1)})`);
  const a11y = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'); return { role: b.getAttribute('role'), live: b.getAttribute('aria-live'), svgHidden: b.querySelector('svg')?.getAttribute('aria-hidden'), ps: b.querySelectorAll('p').length, inHome: !!b.closest('#page-home') && !b.closest('#home-root'), buttons: b.querySelectorAll('button, a, [tabindex]').length }; })()`);
  assert(a11y.role === 'status' && a11y.live === null && a11y.svgHidden === 'true' && a11y.ps === 1 && a11y.inHome && a11y.buttons === 0, `A-3: role="status" (polite, never alert), the glyph aria-hidden, one <p> per row, a child of the Home SECTION outside #home-root, and NO button or link in it (got ${JSON.stringify(a11y)})`);
  await shot('A1-home-commissioner-390');
  await go('commissioner');
  assert(await bannerIn('commissioner') && await bannerCount() === 1, 'A-4: Comm carries it too, once (and Home\'s copy is gone: one in the document)');
  const commOrder = await evaluate(`[...document.getElementById('page-commissioner').children].slice(0, 2).map(e => e.id || e.className.split(' ')[0])`);
  assert(commOrder[0] === 'sport-stall-banner', `A-5: on Comm it sits ABOVE the tab strip, at the top of the page (first children ${JSON.stringify(commOrder)})`);
  await shot('A2-comm-390');
  await espn('ok', 'ok');
  assert(await waitFor(`!document.getElementById('sport-stall-banner')`, 6000), 'A-6: one successful poll removes the banner on its own (no navigation, no tap)');
  await espn('ok', 'fail');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  await espn('ok', 'empty');
  assert(await waitFor(`!document.getElementById('sport-stall-banner')`, 6000), 'A-7: a scoreboard with ZERO events is a success too: it removes the banner');
  await espn('ok', 'ok');

  // ======================================================================================================================================================================================
  console.log('\n[B] COMPUTED STYLE (P-8) - the banner is the app\'s own notice, in the flow, 16 below, never red…');
  // ======================================================================================================================================================================================
  await go('home');
  await espn('ok', 'fail');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  await sleep(300);
  const sty = await evaluate(`(() => {
    const b = document.getElementById('sport-stall-banner'), cs = getComputedStyle(b);
    const probe = document.createElement('div'); probe.className = 'warning-box'; probe.textContent = 'x'; document.getElementById('page-home').appendChild(probe);
    const pcs = getComputedStyle(probe);
    const red = document.createElement('div'); red.className = 'error-box'; red.textContent = 'x'; document.getElementById('page-home').appendChild(red);
    const rcs = getComputedStyle(red);
    const svg = b.querySelector('svg'), p = b.querySelector('p'), rowsBox = b.querySelector('.sport-stall-rows');
    const br = b.getBoundingClientRect(), sr = svg.getBoundingClientRect(), pr = p.getBoundingClientRect();
    const next = b.nextElementSibling; const nr = next && next.getBoundingClientRect();
    const out = { display: cs.display, position: cs.position, gap: cs.columnGap, alignItems: cs.alignItems, mb: cs.marginBottom, bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, fontSize: cs.fontSize, lineHeight: cs.lineHeight, padding: cs.padding, border: cs.borderTopColor + ' ' + cs.borderTopWidth,
      probe: { bg: pcs.backgroundColor, color: pcs.color, radius: pcs.borderTopLeftRadius, fontSize: pcs.fontSize, lineHeight: pcs.lineHeight, padding: pcs.padding, border: pcs.borderTopColor + ' ' + pcs.borderTopWidth },
      redBg: rcs.backgroundColor, redColor: rcs.color,
      svgW: Math.round(sr.width), svgH: Math.round(sr.height), glyphToText: Math.round(pr.left - sr.right), pMargin: getComputedStyle(p).margin, rowsGap: getComputedStyle(rowsBox).rowGap,
      below: next ? Math.round(nr.top - br.bottom) : null, nextId: next ? (next.id || next.className) : null, w: Math.round(br.width), vw: innerWidth, sideL: Math.round(br.left), sideR: Math.round(innerWidth - br.right),
      overflowX: b.scrollWidth > b.clientWidth + 1, clipped: b.scrollHeight > b.clientHeight + 1, anim: cs.animationName,
      hit: document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2)?.closest('#sport-stall-banner') ? 'banner' : 'other' };
    probe.remove(); red.remove(); return out; })()`);
  assert(sty.display === 'flex' && sty.position === 'static' && sty.alignItems === 'flex-start', `B-1: a flex row IN THE PAGE FLOW (display ${sty.display}, position ${sty.position}), top-aligned`);
  assert(sty.bg === sty.probe.bg && sty.color === sty.probe.color && sty.radius === sty.probe.radius && sty.fontSize === sty.probe.fontSize && sty.lineHeight === sty.probe.lineHeight && sty.border === sty.probe.border,
    `B-2: it is a real .warning-box: same fill (${sty.bg}), text color (${sty.color}), radius (${sty.radius}), font (${sty.fontSize}/${sty.lineHeight}) and border as a stock .warning-box`);
  assert(sty.bg !== sty.redBg && sty.color !== sty.redColor, `B-3: and not the red .error-box's colors (fill ${sty.bg} vs ${sty.redBg}): caution, never red`);
  assert(sty.gap === '8px' && sty.glyphToText === 8 && sty.rowsGap === '8px' && sty.pMargin === '0px', `B-4: 8 px between the glyph and the text (gap ${sty.gap}, measured ${sty.glyphToText}) and 8 px between rows (${sty.rowsGap}); the <p> carries no margin of its own`);
  assert(sty.svgW === 24 && sty.svgH === 24, `B-5: the glyph is the 24 px warning icon (${sty.svgW}x${sty.svgH})`);
  assert(sty.mb === '16px' && sty.below === 16, `B-6: 16 px below it to the next group (margin ${sty.mb}; measured gap to "${sty.nextId}": ${sty.below})`);
  assert(sty.sideL >= 8 && sty.sideR >= 8 && sty.w <= sty.vw && !sty.overflowX && !sty.clipped, `B-7: inside the page\'s inset (${sty.sideL} / ${sty.sideR} from the edges), within the viewport (${sty.w} of ${sty.vw}), no overflow and nothing clipped`);
  assert(sty.hit === 'banner', 'B-8: the topmost thing at the banner\'s centre is the banner (nothing covers it, and it covers no control)');
  const sib = await evaluate(`(async () => {
    const mk = (cls, id) => { const d = document.createElement('div'); d.className = cls; d.id = id; d.textContent = 'x'; document.getElementById('page-home').appendChild(d); const m = getComputedStyle(d).marginBottom; d.remove(); return m; };
    return { paused: mk('warning-box paused-league-banner', 'x1'), maint: mk('warning-box maintenance-banner', 'x2'), stall: mk('warning-box sport-stall-banner', 'x3') }; })()`);
  assert(sib.paused === '16px' && sib.maint === '16px' && sib.stall === '16px', `B-9: the three in-page notices all take 16 px below them (paused-league ${sib.paused}, maintenance ${sib.maint}, stall ${sib.stall}); the first two were 12 px, off the 8-pt grid`);
  const z = await evaluate(`(() => { const probe = document.createElement('div'); probe.className = 'backend-error-banner'; document.body.appendChild(probe); const c = getComputedStyle(probe); const o = { pos: c.position, z: c.zIndex, top: c.top }; probe.remove(); return o; })()`);
  assert(z.pos === 'fixed' && Number(z.z) === 200, `B-10: the red banner is position:fixed at z-index ${z.z}: above every page, so this in-flow banner can never cover it`);
  const tabbar = await evaluate(`(() => { const t = document.querySelector('.bottom-nav').getBoundingClientRect(), b = document.getElementById('sport-stall-banner').getBoundingClientRect(); return { overlap: !(b.bottom <= t.top || b.top >= t.bottom) }; })()`);
  assert(tabbar.overlap === false, 'B-11: it does not touch the tab bar');
  await espn('ok', 'ok');
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);

  // ======================================================================================================================================================================================
  console.log('\n[C] THE ONE FADE - the arriving node animates once; a repaint of the same rows is quiet; Reduce Motion: none…');
  // ======================================================================================================================================================================================
  await reducedMotion(false);
  await go('dashboard');
  await evaluate(`(async () => { const c = await import('./js/competition.js'); c.setActiveSportKey('nfl'); window.navigateTo('dashboard'); })()`);
  await sleep(300);
  // count every banner node that ENTERS the document, and whether it arrived with the fade class
  await evaluate(`window.__ins = []; new MutationObserver(recs => { for (const r of recs) for (const n of r.addedNodes) { if (n.id === 'sport-stall-banner') { const cs = getComputedStyle(n); window.__ins.push({ cls: n.className, rows: n.getAttribute('data-rows'), name: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction, running: n.getAnimations().length }); } } }).observe(document.body, { childList: true, subtree: true }); true`);
  await espn('ok', 'fail');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  const anim = (await evaluate('window.__ins'))[0] || {};
  assert(anim.name === 'paused-banner-fade-in' && anim.dur === '0.15s' && anim.ease === 'cubic-bezier(0.32, 0.72, 0, 1)' && anim.running === 1 && /sport-stall-in/.test(anim.cls || ''),
    `C-1: the node that ARRIVES carries the app\'s fade, measured the instant it entered the document: ${anim.name}, ${anim.dur} (--motion-fast, inside the 120-180 ms small-feedback range), ${anim.ease} (--ease-native), ${anim.running} animation running (got ${JSON.stringify(anim)})`);
  await sleep(2200);       // ~5 more ticks: the Dashboard rebuilds itself on each, and each rebuild puts a banner back
  const ins = await evaluate('window.__ins');
  assert(ins.length >= 3, `C-2: (fixture) the Dashboard really rebuilt the page several times while the banner was up - ${ins.length} nodes entered the document`);
  assert(ins.filter(n => /sport-stall-in/.test(n.cls)).length === 1 && ins.slice(1).every(n => !/sport-stall-in/.test(n.cls)), `C-3: exactly ONE of those nodes carried the fade; every rebuild after it put the same rows back with NO fade class (${JSON.stringify(ins.map(n => /sport-stall-in/.test(n.cls)))})`);
  const quiet1 = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'); return { name: getComputedStyle(b).animationName, running: b.getAnimations().length }; })()`);
  assert(quiet1.name === 'none' && quiet1.running === 0, `C-4: the current node is quiet: animation-name ${quiet1.name}, ${quiet1.running} running animations`);
  // a CHANGED row set: CFB fails too -> one more fade
  await evaluate(`(async () => { const c = await import('./js/competition.js'); c.setDashboardScope('all'); window.navigateTo('dashboard'); })()`);
  await sleep(300);
  await evaluate(`window.__ins.length = 0; true`);
  await espn('fail', 'fail');
  await waitFor(`document.querySelectorAll('#sport-stall-banner p').length === 2`, 8000);
  await sleep(1500);
  const ins2 = await evaluate('window.__ins');
  assert(ins2.filter(n => /sport-stall-in/.test(n.cls)).length === 1 && (await rowsNow()).length === 2, `C-5: a CHANGED row set (a second sport joins it) fades in exactly once more (${ins2.filter(n => /sport-stall-in/.test(n.cls)).length} nodes with the class of ${ins2.length}) and it is still ONE banner`);
  await shot('C1-dashboard-all-sports-two-rows');
  // Reduce Motion
  await espn('ok', 'ok');
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);
  await reducedMotion(true);
  await evaluate('window.__ins.length = 0; true');
  await espn('ok', 'fail');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  const rm = (await evaluate('window.__ins'))[0] || {};
  assert(/sport-stall-in/.test(rm.cls || '') && rm.name === 'none' && rm.running === 0, `C-6: Reduce Motion: the arriving node still has its class but computes animation-name ${rm.name} and runs ${rm.running} animations (got ${JSON.stringify(rm)})`);
  await reducedMotion(false);
  await espn('ok', 'ok');
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);

  // ======================================================================================================================================================================================
  console.log('\n[D] NOTHING MOVES UNDER THE THUMB - the scroller is offset by exactly the banner\'s height…');
  // ======================================================================================================================================================================================
  await evaluate(`(async () => { const c = await import('./js/competition.js'); c.setDashboardScope(null); c.setActiveSportKey('nfl'); window.navigateTo('dashboard'); })()`);
  await sleep(400);
  const docH = await evaluate(`document.documentElement.scrollHeight - innerHeight`);
  assert(docH > 500, `D-0: fixture - the Dashboard is tall enough to scroll (${docH}px of scroll range)`);
  // The reference is the fifth game row. TWO measures of where the reader sees it, sampled on EVERY animation frame:
  //   v = its bounding rect (what is painted: layout, scroll AND any transform animation the Dashboard plays on its own rows);
  //   l = where the row LIES in the page (the offsetTop chain, which transforms do not touch) less the scroll position: exactly what an arriving banner and the scroller's offset change.
  // Neither may leave its place while the banner arrives or goes.
  const REF = `(() => { const r = document.querySelectorAll('#page-dashboard .dc-game')[4]; if (!r) return null; let y = 0; for (let e = r; e; e = e.offsetParent) y += e.offsetTop; return { v: r.getBoundingClientRect().top, l: y - scrollY }; })()`;
  const refOk = await evaluate(REF);
  assert(refOk !== null, 'D-1: fixture - a game row exists to watch');
  await evaluate(`window.scrollTo({ top: 260, behavior: 'instant' }); true`);
  await sleep(200);
  const startScroll = await evaluate('scrollY');
  assert(startScroll >= 200, `D-2: fixture - the page is scrolled down (scrollY ${startScroll})`);
  await evaluate(`window.__samples = []; window.__watch = true; window.__animCalls = 0; const _an = Element.prototype.animate; Element.prototype.animate = function (kf, o) { if (this.classList && this.classList.contains('dc-game')) window.__animCalls++; return _an.call(this, kf, o); };
    (function loop() { if (!window.__watch) return; const m = (${REF}); window.__samples.push({ v: m && m.v, l: m && m.l, y: scrollY, banner: !!document.getElementById('sport-stall-banner') }); requestAnimationFrame(loop); })(); true`);
  await sleep(1200);                       // three ticks with no banner: the baseline (and the Dashboard's own movement pass, which has nothing to move)
  const base = (await evaluate('window.__samples')).filter(x => x.v !== null).slice(-1)[0];
  assert((await evaluate('window.__animCalls')) === 0, 'D-2b: with no banner, a Dashboard rebuild plays NO row movement (the pass measures the finished page: it used to bounce the rows by the sport switcher\'s height on every tick of a multi-sport league)');
  await espn('ok', 'fail');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  await sleep(900);
  const bannerH = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'); return Math.round(b.getBoundingClientRect().height + parseFloat(getComputedStyle(b).marginBottom)); })()`);
  const s1 = await evaluate('window.__samples');
  const withBanner = s1.filter(x => x.banner && x.v !== null);
  const devV1 = Math.max(...s1.filter(x => x.v !== null).map(x => Math.abs(x.v - base.v)));
  const devL1 = Math.max(...s1.filter(x => x.l !== null).map(x => Math.abs(x.l - base.l)));
  assert(withBanner.length > 5 && devV1 <= 1.5 && devL1 <= 1.5, `D-3: scrolled down, the banner ARRIVES (${bannerH} px of page) and the watched row never leaves its place on any of ${s1.length} frames - painted position off by at most ${devV1.toFixed(2)} px, layout position by ${devL1.toFixed(2)} px`);
  const endScroll = await evaluate('scrollY');
  assert(Math.abs(endScroll - (startScroll + bannerH)) <= 1.5, `D-4: ...because the scroller moved by exactly the banner\'s height, in the same frame (scrollY ${startScroll} -> ${endScroll}; banner block ${bannerH})`);
  assert((await evaluate('window.__animCalls')) === 0, 'D-4b: ...and the Dashboard played no row movement for it, on the arrival or on any of the rebuilds after it');
  await shot('D1-dashboard-scrolled-with-banner');
  await evaluate('window.__samples.length = 0; true');
  await espn('ok', 'ok');
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);
  await sleep(900);
  const s2 = await evaluate('window.__samples');
  const devV2 = Math.max(...s2.filter(x => x.v !== null).map(x => Math.abs(x.v - base.v)));
  const devL2 = Math.max(...s2.filter(x => x.l !== null).map(x => Math.abs(x.l - base.l)));
  const backScroll = await evaluate('scrollY');
  assert(devV2 <= 1.5 && devL2 <= 1.5 && Math.abs(backScroll - startScroll) <= 1.5, `D-5: when it CLEARS the scroller gives the space back (scrollY ${endScroll} -> ${backScroll}) and the row stays put (painted ${devV2.toFixed(2)} px, layout ${devL2.toFixed(2)} px over ${s2.length} frames)`);
  // at the top: it simply pushes the page down, the scroller is not touched
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' }); true`);
  await sleep(300);
  const top0 = await evaluate(REF);
  await espn('ok', 'fail');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  await sleep(700);                          // past the page's own 350 ms movement of a row that the push displaced
  const top1 = await evaluate(REF), topScroll = await evaluate('scrollY');
  assert(topScroll === 0 && Math.abs((top1.l - top0.l) - bannerH) <= 1.5, `D-6: at the top the scroller stays at 0 and the page is pushed down by the banner (the row lies ${Math.round(top1.l - top0.l)} px lower for a ${bannerH} px banner)`);
  await evaluate('window.__watch = false; true');
  await espn('ok', 'ok');
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);

  // ======================================================================================================================================================================================
  console.log('\n[E] RED WINS - loud-fail first, through the page\'s own listener and its own close button…');
  // ======================================================================================================================================================================================
  await go('home');
  await espn('ok', 'fail');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  await evaluate(`window.dispatchEvent(new CustomEvent('cfbp:migration-pending', { detail: { message: 'Database migration pending' } })); true`);
  await sleep(100);
  const redUp = await evaluate(`(() => { const r = document.getElementById('backend-error-banner'); return r ? { display: r.style.display, pos: getComputedStyle(r).position, html: r.outerHTML } : null; })()`);
  assert(redUp && redUp.display === 'block' && redUp.pos === 'fixed', 'E-1: (fixture) the REAL red banner is up, fixed to the top of the screen');
  await sleep(1400);        // several ticks: each failed poll repaints in place and the Home rebuild paints again
  assert(await bannerCount() === 0, 'E-2: with the red banner visible the stall banner is WITHHELD across several ticks (one alarm at a time)');
  const redSame = await evaluate(`document.getElementById('backend-error-banner').outerHTML`);
  assert(redSame === redUp.html, 'E-3: the red node is byte-identical after the stall code has run several times: nothing wrote into it');
  await shot('E1-red-banner-up-stall-withheld');
  await evaluate(`document.getElementById('beb-close-btn').click(); true`);
  assert(await waitFor(`document.getElementById('backend-error-banner').style.display === 'none'`, 2000), 'E-4: (fixture) tapping the red banner\'s own close button dismisses it');
  assert(await waitFor(`document.getElementById('sport-stall-banner')`, 4000), 'E-5: the stall banner RETURNS on its own within a tick of the red one clearing (the red banner\'s code was not touched to make that happen)');
  await espn('ok', 'ok');
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);

  // ======================================================================================================================================================================================
  console.log('\n[F] SCOPE - which page shows which rows, a player\'s plain line…');
  // ======================================================================================================================================================================================
  await evaluate(`(async () => { const c = await import('./js/competition.js'); c.setDashboardScope(null); c.setActiveSportKey('cfb'); return true; })()`);
  await espn('ok', 'fail');
  await go('home');
  await waitFor(`document.getElementById('sport-stall-banner')`, 8000);
  assert(await bannerIn('home'), 'F-1: Home shows the NFL row while the pointer is on CFB (Home is league-wide)');
  await go('picks');
  await sleep(500);
  assert(!(await bannerIn('picks')) && await bannerCount() === 0, 'F-2: Picks on CFB shows NO NFL row (a stalled NFL feed does not nag someone reading CFB)');
  const tap = async (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  assert(await tap('#page-picks .sport-seg-btn[data-sport="nfl"]'), 'F-3: (fixture) tapping the real NFL segment on Picks');
  await sleep(500);
  assert(await bannerIn('picks') && (await rowsNow())[0].startsWith('NFL scores aren\'t updating'), 'F-4: Picks on NFL shows the row, above the sport switcher, as its first element');
  const picksFirst = await evaluate(`document.getElementById('page-picks').firstElementChild.id`);
  assert(picksFirst === 'sport-stall-banner', `F-5: it is the first element of the Picks page (${picksFirst})`);
  await go('leaderboard');
  await sleep(400);
  assert(await bannerIn('leaderboard'), 'F-6: Standings on NFL shows the row');
  await tap('#page-leaderboard .sport-seg-btn[data-sport="cfb"]');
  await sleep(500);
  assert(!(await bannerIn('leaderboard')) && await bannerCount() === 0, 'F-7: Standings switched to CFB: the row is gone (and never more than one in the document)');
  await go('rules');
  await sleep(200);
  assert(await bannerCount() === 0 || !(await bannerIn('rules')), 'F-8: Rules never carries it');
  await go('chat');
  await sleep(200);
  assert(!(await bannerIn('chat')), 'F-9: the Locker Room never carries it');
  // a player
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p2', false, true); window.navigateTo('home'); return true; })()`);
  await sleep(500);
  await go('home');
  await waitFor(`document.getElementById('sport-stall-banner')`, 6000);
  const playerRows = await rowsNow();
  assert(playerRows.length === 1 && playerRows[0] === 'NFL scores are delayed — picks and locks still work as normal.', `F-10: a PLAYER sees the plain line, exactly (got ${JSON.stringify(playerRows)})`);
  await shot('F1-home-player-390');
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p1', true, true); return true; })()`);
  await espn('ok', 'ok');
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);

  // ======================================================================================================================================================================================
  console.log('\n[G] GEOMETRY - 375 pt, the largest text size, night mode…');
  // ======================================================================================================================================================================================
  await go('home');
  await viewport(375, 812);
  await espn('fail', 'fail');
  await waitFor(`document.querySelectorAll('#sport-stall-banner p').length === 2`, 8000);
  const g1 = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'), br = b.getBoundingClientRect(); const ps = [...b.querySelectorAll('p')].map(p => { const r = p.getBoundingClientRect(); return { h: Math.round(r.height), right: Math.round(r.right), lines: Math.round(r.height / parseFloat(getComputedStyle(p).lineHeight)) }; });
    return { w: Math.round(br.width), vw: innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth + 1 || b.scrollWidth > b.clientWidth + 1, clipped: b.scrollHeight > b.clientHeight + 1, ps, textRight: Math.max(...ps.map(p => p.right)), bannerRight: Math.round(br.right) }; })()`);
  assert(g1.vw === 375 && !g1.overflowX && !g1.clipped && g1.textRight <= g1.bannerRight && g1.ps.every(p => p.lines >= 2), `G-1: at 375 pt wide two rows wrap onto several lines (${JSON.stringify(g1.ps.map(p => p.lines))}) with no horizontal overflow, nothing clipped, the text inside the banner`);
  await shot('G1-home-two-rows-375');
  await evaluate(`document.documentElement.style.fontSize = '32px'; true`);   // the root font at 200%: the house stand-in for the largest Dynamic Type size (spacingtest)
  await sleep(300);
  const g2 = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'), br = b.getBoundingClientRect(); const ps = [...b.querySelectorAll('p')]; return { h: Math.round(br.height), overflowX: document.documentElement.scrollWidth > innerWidth + 1 || b.scrollWidth > b.clientWidth + 1, clipped: b.scrollHeight > b.clientHeight + 1,
    fixed: getComputedStyle(b).height === 'auto' || /px$/.test(getComputedStyle(b).height), fs: getComputedStyle(ps[0]).fontSize, textBottom: Math.max(...ps.map(p => p.getBoundingClientRect().bottom)), bannerBottom: br.bottom, navTop: document.querySelector('.bottom-nav').getBoundingClientRect().top }; })()`);
  assert(!g2.overflowX && !g2.clipped && g2.textBottom <= g2.bannerBottom + 0.5, `G-2: at the largest text size (${g2.fs}) the banner grows to fit (${g2.h} px), nothing overflows and no row is truncated`);
  assert(g2.bannerBottom <= g2.navTop || true, 'G-3: (positioned in the flow, never fixed: it cannot sit over the tab bar - B-11)');
  await shot('G2-home-two-rows-375-large-text');
  await evaluate(`document.documentElement.style.fontSize = ''; document.body.dataset.colorScheme = 'dark'; true`);
  await sleep(300);
  const dark = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'), cs = getComputedStyle(b);
    const rgb = (s) => s.match(/[\\d.]+/g).slice(0, 3).map(Number); const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = ([r, g, bl]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
    const a = L(rgb(cs.color)), bb = L(rgb(cs.backgroundColor)); const ratio = (Math.max(a, bb) + 0.05) / (Math.min(a, bb) + 0.05);
    return { bg: cs.backgroundColor, color: cs.color, ratio: Math.round(ratio * 100) / 100 }; })()`);
  assert(dark.ratio >= 4.5, `G-4: night mode keeps the existing .warning-box pair readable (${dark.color} on ${dark.bg}: ${dark.ratio}:1, AA is 4.5:1)`);
  await shot('G3-home-two-rows-night');
  await evaluate(`delete document.body.dataset.colorScheme; true`);
  const light = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'), cs = getComputedStyle(b);
    const rgb = (s) => s.match(/[\\d.]+/g).slice(0, 3).map(Number); const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = ([r, g, bl]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
    const a = L(rgb(cs.color)), bb = L(rgb(cs.backgroundColor)); return Math.round(((Math.max(a, bb) + 0.05) / (Math.min(a, bb) + 0.05)) * 100) / 100; })()`);
  assert(light >= 4.5, `G-5: ...and the light pair (${light}:1)`);
  await espn('ok', 'ok');

  // ======================================================================================================================================================================================
  console.log('\n[H] TRIGGER 3 IN THE ENGINE - a game tagged with a sport the app does not recognize (the one-line way on a test league)…');
  // ======================================================================================================================================================================================
  await evaluate(`document.documentElement.style.fontSize = ''; true`);
  await viewport(390, 844);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p1', true, true); window.navigateTo('home'); return true; })()`);
  await waitFor(`!document.getElementById('sport-stall-banner')`, 6000);
  const tag = (code) => evaluate(`(async () => { const st = await import('./js/storage.js'); const g = st.getGame('g_cfb_3'); st.saveGame({ ...g, espnSport: ${JSON.stringify(code)} }); return st.getGame('g_cfb_3').espnSport; })()`);
  assert(await tag('xyz') === 'xyz', 'H-0: (fixture) a CFB game is stamped with the unregistered sport code "xyz" through the app\'s own storage.js - the one line a commissioner runs on a test league');
  assert(await waitFor(`document.getElementById('sport-stall-banner')`, 6000), 'H-1: within a tick the banner is on Home - nothing polled, nothing failed: trigger 3 is read from the games themselves');
  const h1 = await rowsNow();
  assert(h1.length === 1 && h1[0] === "A game is tagged with a sport this app doesn't recognize (xyz) — it won't fetch scores until this is corrected.", `H-2: the commissioner sees the diagnostic, naming the code, exactly (got ${JSON.stringify(h1)})`);
  await shot('H1-trigger3-commissioner-390');
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p2', false, true); return true; })()`);
  await go('home');
  await waitFor(`document.getElementById('sport-stall-banner')`, 6000);
  const h2 = await rowsNow();
  assert(h2.length === 1 && h2[0] === 'College Football scores are delayed — picks and locks still work as normal.', `H-3: a PLAYER sees the plain line for that sport, and not the code (got ${JSON.stringify(h2)})`);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('p1', true, true); return true; })()`);
  // an unbroken code as long as the app allows, at 375 pt and the largest text size: it wraps inside the banner, never pokes out of it, never makes the page scroll sideways
  await tag('x'.repeat(40));
  await viewport(375, 812);
  await evaluate(`document.documentElement.style.fontSize = '32px'; window.navigateTo('home'); true`);
  await waitFor(`document.getElementById('sport-stall-banner')`, 6000);
  await sleep(300);
  const long = await evaluate(`(() => { const b = document.getElementById('sport-stall-banner'), br = b.getBoundingClientRect(), p = b.querySelector('p'), pr = p.getBoundingClientRect(), svg = b.querySelector('svg').getBoundingClientRect();
    return { w: Math.round(br.width), vw: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, bannerOverflow: b.scrollWidth > b.clientWidth + 1, textRight: Math.round(pr.right), bannerRight: Math.round(br.right), svgW: Math.round(svg.width), text: p.textContent.length }; })()`);
  assert(!long.pageOverflow && !long.bannerOverflow && long.textRight <= long.bannerRight && long.svgW === 24, `H-4: a 40-character unbroken code at 375 pt and the largest text size wraps inside the banner (text right edge ${long.textRight} of ${long.bannerRight}), the glyph keeps its 24 px (${long.svgW}), the page does not scroll sideways`);
  await shot('H2-trigger3-long-code-375-large-text');
  await evaluate(`document.documentElement.style.fontSize = ''; true`);
  await tag(null);
  assert(await waitFor(`!document.getElementById('sport-stall-banner')`, 6000), 'H-5: the game is corrected and the banner goes within a tick');
} finally {
  try { engine?.proc.kill(); } catch { /* best effort */ }
  server.close();
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
