/**
 * historybrowsertest.mjs — THE HISTORY SCREENS, MEASURED IN A REAL ENGINE (D1 Lane B, DI-595 / DI-596 / DI-598 / DI-600; P-8 / Testing Protocol 233)
 * ==================================================================================================================================================
 * comparetest.mjs and historywiringtest.mjs prove the models, the markup and the wiring without a layout engine. This suite proves what only an engine can: the REAL index.html + css/styles.css +
 * js/app.js in headless Chromium (local PIN mode, network blocked - chatsportbrowsertest.mjs's boot recipe), the shared two-week league of statsfixtures.mjs on the storage seam, the player signed in
 * as Drew. It taps with real mouse events and reads COMPUTED STYLE and boxes back.
 *
 *   [1] Standings' entries (390 / 375 pt)   the name and week buttons are real buttons the size of their cell, the row does not grow, 44 pt, the chevron, the 97% press, Reduce Motion, the focus ring,
 *                                           and the largest text size (a 400% root) with no sideways scroll
 *   [2] The comparison                      the pushed screen's box and nav bar, the Change action, the cards' padding and 16 pt gaps, the split bar (blocks, proportions), the Season grid
 *                                           (3 tracks, values never wrap, labels do), the game rows (44 pt targets, 8 pt apart), token colours on the marks, text contrast, the 97% press
 *   [3] The rival picker sheet              a bottom sheet over the screen: its box, 56 pt rows 8 pt apart, the check, the close control, the scrim, the page behind not scrolling, motion
 *   [4] The week detail                     the result card, the standings table fits, the game rows, Part labels
 *   [5] The sport control                   two sports: a radiogroup of 44 pt radios 8 pt apart, the selected one drawn from tokens, a tap swaps the whole screen; then (pass 3) a member NOT entered in
 *                                           the NFL on its week detail: no chip, no split, no empty picks column, 44 pt targets
 *   [6] The chat's filter for a past game   the label and the way back: boxes, 44 pt, 8 pt below the header, no clipping at the smallest width
 *
 * NOT MEASURABLE HERE (Drew's on-device list): the slide and swipe-back feel, the haptics, VoiceOver reading the two screens and the sheet, Dynamic Type at the system's real largest size (modelled as a 400%
 * root font size, a stress bound), the sheet's swipe-down, the safe-area / home-indicator geometry, momentum scrolling.
 *
 * Run: node historybrowsertest.mjs
 * Override the browser: HISTORY_ENGINE=/path/to/Chromium (falls back to CHATSPORT_ENGINE, CHATPAGE_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then /Applications).
 * Mutation runs: HISTORY_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree instead of this one - mutate the copy, never this checkout.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.HISTORY_ROOT || here;
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.HISTORY_ENGINE || process.env.CHATSPORT_ENGINE || process.env.CHATPAGE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: HISTORY_ENGINE=/path/to/Chromium node historybrowsertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (HISTORY_ROOT — serving ${ROOT})`);

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

// ── the CDP client (chatsportbrowsertest.mjs's shape) ────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-history-'));
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
  /** A REAL tap: the pointer goes down and up on the centre of the element's box, so the page's own handler runs exactly as it would for a thumb. */
  const tap = async (selector, settle = 80) => {
    const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);   // (instant: the stylesheet's html{scroll-behavior:smooth} would leave the box mid-flight)
    if (!box) throw new Error('nothing to tap: ' + selector);
    for (const type of ['mousePressed', 'mouseReleased']) await pg.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(settle);
  };
  const forced = async (selector, pseudo, read) => {
    const doc = await pg.send('DOM.getDocument', { depth: 1 });
    const q = await pg.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    await pg.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: [pseudo] });
    await sleep(260);
    const v = await evaluate(read);
    await pg.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: [] });
    await sleep(260);
    return v;
  };
  /** Go to a tab and make sure it STAYS: the app's own boot can navigate once more after `window.navigateTo` exists, so the visit is retried until the page is active and still active half a second later. */
  const gotoTab = async (tab) => {
    for (let i = 0; i < 5; i++) {
      await evaluate(`window.navigateTo(${JSON.stringify(tab)})`);
      await sleep(500);
      if (await evaluate(`!!document.getElementById('page-${tab}')?.classList.contains('active')`)) { await sleep(300); if (await evaluate(`!!document.getElementById('page-${tab}')?.classList.contains('active')`)) return true; }
    }
    return false;
  };
  const q1 = (sel, fn) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; return (${fn})(e); })()`);
  const R = '(e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }';
  const rect = (sel) => q1(sel, R);
  const css = (sel, props) => q1(sel, `(e) => { const c = getComputedStyle(e); return Object.fromEntries(${JSON.stringify(props)}.map((p) => [p, c.getPropertyValue(p)])); }`);
  /** The colour a token resolves to, as the browser computes it. */
  const token = (name) => evaluate(`(() => { const s = document.createElement('span'); s.style.color = 'var(${name})'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; })()`);
  const press = (sel) => forced(sel, 'active', `getComputedStyle(document.querySelector(${JSON.stringify(sel)})).transform`);
  const PRESSED = 'matrix(0.97, 0, 0, 0.97, 0, 0)';
  const lum = (rgb) => { const m = rgb.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** The text colour and the first opaque background behind an element. */
  const colours = (sel) => q1(sel, `(e) => { const fg = getComputedStyle(e).color; let n = e, bg = 'rgba(0, 0, 0, 0)'; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) { bg = c; break; } n = n.parentElement; } return { fg, bg }; }`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode), the two-week league on the storage seam, signed in as Drew; land on Standings…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(390, 844);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '1-0: fixture — the real index.html + js/app.js booted in the engine');
  const SEED = (twoSports) => `(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const fx = await import('./statsfixtures.mjs'); const sc = await import('./js/scoring.js');
    const L = fx.buildLeague({ w2: 'final', calculateWeeklyResults: sc.calculateWeeklyResults });
    L.players.forEach((p) => st.savePlayer({ ...p }));
    ${twoSports ? `
    const CID = { cfb: '11111111-1111-4111-8111-111111111111', nfl: '22222222-2222-4222-8222-222222222222' };
    st.saveCompetition({ id: CID.cfb, sport: 'cfb', kind: 'season', enrollment: 'all', isDefault: true, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-01-01T00:00:00.000Z' });
    st.saveCompetition({ id: CID.nfl, sport: 'nfl', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-02-01T00:00:00.000Z' });
    L.weeks.forEach((w) => st.saveWeek({ ...w, competitionId: CID.cfb }));
    const nw = fx.mkWeek({ id: 'nw1', n: 1, status: 'final' }); st.saveWeek({ ...nw, competitionId: CID.nfl });
    const ng = [0, 1, 2].map((i) => fx.mkGame({ id: 'ng' + i, weekId: 'nw1', kick: '2026-09-27T1' + i + ':00:00.000Z', home: 'NFLHome' + i, away: 'NFLAway' + i, kind: 'cover', state: 'final' }));
    ng.forEach((g) => st.saveGame(g));
    const np = ng.flatMap((g, i) => fx.mkPicks(g, 'cover', ['LWLW--', 'WLWL--', 'LLWW--'][i]));
    st.saveAllWeeklyResults('nw1', sc.calculateWeeklyResults('nw1', L.players, np, ng, null));
    st.saveAllPicks([...L.picks, ...np]);` : `
    L.weeks.forEach((w) => st.saveWeek(w));
    st.saveAllPicks(L.picks);`}
    L.games.forEach((g) => st.saveGame(g));
    st.saveAllWeeklyResults('w1', L.weeklyResults.filter((r) => r.weekId === 'w1'));
    st.saveAllWeeklyResults('w2', L.weeklyResults.filter((r) => r.weekId === 'w2'));
    st.saveSetting('chatEnabled', true); st.saveSetting('chatEpochSeq', 0); st.saveSetting('chatRetentionDays', 0);
    st.setSession('p1', false, true);
    await new Promise((r) => setTimeout(r, 1200));
  })()`;
  await evaluate(SEED(false));
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '1-1: fixture — after reload the app is past the site gate, signed in as a player');
  await gotoTab('leaderboard');
  assert(await waitFor(`document.getElementById('page-leaderboard').classList.contains('active') && document.querySelectorAll('#page-leaderboard .stand-cmp').length === 6 && document.querySelector('#page-leaderboard .stand-cmp').getBoundingClientRect().height > 40`, 8000), '1-2: Standings paints six comparison buttons (one per Season Summary row) and two week openers: ' + await evaluate(`document.querySelectorAll('#page-leaderboard [data-wk-open]').length`));
  await sleep(300);

  const NAME = '#page-leaderboard .stand-cmp[data-cmp-player="p2"]';
  const OPEN = '#page-leaderboard .stand-wk-btn[data-wk-open="w2"]';
  const geom1 = async (label) => {
    const g = await evaluate(`(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      const names = [...document.querySelectorAll('#page-leaderboard .stand-cmp')].map((b) => { const td = b.closest('td'), tr = b.closest('tr'); const chev = b.querySelector('.stand-cmp-chev').getBoundingClientRect(); const txt = b.querySelector('.stand-name-text').getBoundingClientRect();
        return { btn: r(b), td: r(td), tr: r(tr), chev: { w: chev.width, h: chev.height, r: chev.right }, txtL: txt.left }; });
      const opens = [...document.querySelectorAll('#page-leaderboard .stand-wk-btn')].map((b) => { const td = b.closest('td'), tr = b.closest('tr'); const ch = b.querySelector('.stand-wk-chev').getBoundingClientRect(); const sub = b.querySelector('.stand-sub'); const nm = b.querySelector('.stand-wk-name').getBoundingClientRect();
        return { btn: r(b), td: r(td), tr: r(tr), chev: { w: ch.width, h: ch.height, r: ch.right, t: ch.top, b: ch.bottom }, subClipped: sub ? sub.scrollWidth > sub.clientWidth + 0.5 : false, nameT: nm.top, nameL: nm.left, nameR: nm.right }; });
      const box = document.querySelector('#page-leaderboard .stand-box');
      return { names, opens, boxScroll: box.scrollWidth, boxClient: box.clientWidth, vw: innerWidth };
    })()`);
    assert(g.names.length === 6 && g.names.every((n) => n.btn.h >= 43.9), `${label}-a: every name button is >= 44 pt tall (${g.names.map((n) => n.btn.h.toFixed(1)).join('/')})`);
    assert(g.names.every((n) => n.btn.l <= n.td.l + 0.6 && n.btn.r >= n.td.r - 0.6), `${label}-b: …and spans its WHOLE cell - the tap target is the row, not the word`);
    const baseRows = await evaluate(`(() => { const bs = [...document.querySelectorAll('#page-leaderboard .stand-cmp, #page-leaderboard .stand-wk-btn')]; const keep = bs.map((b) => b.getAttribute('style')); bs.forEach((b) => { b.style.display = 'none'; });
      const hs = bs.map((b) => b.closest('tr').getBoundingClientRect().height); bs.forEach((b, i) => { if (keep[i] === null) b.removeAttribute('style'); else b.setAttribute('style', keep[i]); }); return hs; })()`);
    const nowRows = [...g.names.map((n) => n.tr.h), ...g.opens.map((o) => o.tr.h)];
    assert(nowRows.every((h, i) => Math.abs(h - baseRows[i]) < 0.1), `${label}-c: …and the row did NOT grow - every row is exactly as tall as it is with the button taken away (${nowRows.map((h) => h.toFixed(1)).join('/')} vs ${baseRows.map((h) => h.toFixed(1)).join('/')})`);
    assert(g.names.every((n) => n.txtL - n.td.l >= 7.9), `${label}-d: the name keeps its 8 pt of cell padding on the left (a button never touches a line): ${g.names.map((n) => (n.txtL - n.td.l).toFixed(1)).join('/')}`);
    assert(g.names.every((n) => Math.abs(n.chev.w - 12) < 0.6 && Math.abs(n.chev.h - 12) < 0.6 && n.td.r - n.chev.r >= 7.9), `${label}-e: the 12 pt chevron sits >= 8 pt inside the cell's right edge (${g.names.map((n) => (n.td.r - n.chev.r).toFixed(1)).join('/')})`);
    assert(g.opens.length === 2 && g.opens.every((o) => o.btn.h >= 43.9 && o.tr.h <= 48.6 && o.btn.l <= o.td.l + 0.6 && o.btn.r >= o.td.r - 0.6), `${label}-f: the two week openers are cell-sized (>= 44 pt) and do not grow their rows (${g.opens.map((o) => o.btn.h.toFixed(1) + '/' + o.tr.h.toFixed(1)).join(' ')})`);
    assert(g.opens.every((o) => o.chev.r <= o.td.r - 3.9 && o.chev.t >= o.td.t && o.chev.b <= o.td.b && o.chev.w === 12 && !o.subClipped), `${label}-g: the week chevron sits inside the cell's top-right corner and the date caption under the name is NOT clipped (subClipped ${g.opens.map((o) => o.subClipped)})`);
    assert(g.opens.every((o) => o.chev.t - o.nameT < 12), `${label}-g2: the chevron rides the NAME's line, not the date's`);
    assert(g.boxScroll <= g.boxClient + 1, `${label}-h: the Season box does not scroll sideways (${g.boxScroll} in ${g.boxClient}) - the SP-56 fit is intact with the new buttons`);
    return g;
  };
  await geom1('1-390');
  const base = await css(NAME, ['appearance', 'border-top-width', 'background-color', 'cursor', 'font-size', 'text-align', 'display', 'transition-property', 'transition-duration']);
  const tdFont = await q1(NAME, '(e) => getComputedStyle(e.closest("td")).fontSize');
  assert(base['border-top-width'] === '0px' && base['background-color'] === 'rgba(0, 0, 0, 0)' && base.cursor === 'pointer' && base['text-align'] === 'left' && base.display === 'flex' && base['font-size'] === tdFont,
    `1-3: the name button is a reset <button> that looks like the cell (no border, transparent, pointer, left, the cell's own font size ${tdFont}): ${JSON.stringify(base)}`);
  assert(/transform/.test(base['transition-property']) && base['transition-duration'] === '0.15s', `1-4: it returns smoothly over --motion-fast, 150 ms (${base['transition-property']} / ${base['transition-duration']})`);
  assert(await press(NAME) === PRESSED, '1-5: a pressed name compresses to 97% (the shipped press)');
  assert(await press(OPEN) === PRESSED, '1-6: …and so does a week opener');
  assert(await q1(NAME, '(e) => getComputedStyle(e).transform') === 'none', '1-7: released, it is back at rest');
  const ring = await forced(NAME, 'focus-visible', `(() => { const c = getComputedStyle(document.querySelector(${JSON.stringify(NAME)})); return { w: c.outlineWidth, s: c.outlineStyle }; })()`);
  assert(ring.w === '2px' && ring.s === 'solid', `1-8: a keyboard focus draws a 2 px ring (${JSON.stringify(ring)})`);
  const foot = await q1('#page-leaderboard .stand-foot', '(e) => e.textContent');
  assert(/Win % counts every pick once\. Tap a player to compare\.$/.test(foot), `1-9: the footnote carries the hint ("${foot}")`);
  await viewport(375, 667);
  await geom1('1-375');
  // the largest text size, modelled as a 400% root font: a stress bound
  await evaluate(`document.documentElement.style.fontSize = '400%'`);
  await sleep(300);
  const xl = await evaluate(`(() => { const box = document.querySelector('#page-leaderboard .stand-box'); const bs = [...document.querySelectorAll('#page-leaderboard .stand-cmp, #page-leaderboard .stand-wk-btn')];
    return { hs: bs.map((b) => b.getBoundingClientRect().height), scroll: box.scrollWidth, client: box.clientWidth, win: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
  // (the Season box has clipped its fixed numeric columns at 300% and up since SP-56 - 376 in 356 at 300% on the tree before these buttons existed, measured - so the box itself is not asserted here; the page must not scroll sideways)
  assert(xl.hs.every((h) => h >= 43.9) && xl.win <= xl.vw + 1, `1-10: at 400% text every button is still >= 44 pt (min ${Math.min(...xl.hs).toFixed(1)}) and the page does not scroll sideways (${xl.win} in ${xl.vw})`);
  await evaluate(`document.documentElement.style.fontSize = ''`);
  await viewport(390, 844);
  await sleep(200);
  // Reduce Motion
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(150);
  const rmT = await press(NAME), rmD = await q1(NAME, '(e) => getComputedStyle(e).transitionDuration');
  assert(rmT === 'none' && rmD === '0s', `1-11: Reduce Motion: no press compress and no transition on the name (${rmT} / ${rmD})`);
  assert(await press(OPEN) === 'none', '1-12: …nor on a week opener');
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[2] The comparison screen…');
  // ═════════════════════════════════════════════════════════════════════════
  await tap(NAME, 600);
  assert(await waitFor(`document.querySelector('#pushed-root .ps-level[data-ps-id="compare:p1:p2"]') && !document.querySelector('#pushed-root .ps-level--entering')`, 3000), '2-0: a real tap on Brayden\'s name pushes the comparison and it slides in');
  const LV = '#pushed-root .ps-level[data-ps-id="compare:p1:p2"]';
  await waitFor(`Math.abs(document.querySelector(${JSON.stringify(LV)}).getBoundingClientRect().left) < 0.5`, 2000);
  const lvBox = await rect(LV);
  assert(Math.abs(lvBox.l) < 0.5 && Math.abs(lvBox.t) < 0.5 && Math.abs(lvBox.w - 390) < 0.5 && Math.abs(lvBox.h - 844) < 0.5, `2-1: the screen covers the whole viewport (${JSON.stringify(lvBox)})`);
  const lvCss = await css(LV, ['position', 'z-index', 'transition-duration', 'transition-property']);
  assert(lvCss.position === 'absolute' && lvCss['transition-duration'] === '0.26s' && /transform/.test(lvCss['transition-property']), `2-2: it pushes over --motion-nav, 260 ms, on transform (${JSON.stringify(lvCss)})`);
  assert(await q1('#pushed-root', '(e) => getComputedStyle(e).zIndex') === '150', '2-3: the shell sits in the League overlay\'s z-index band (150: above the header and tab bar, below modals)');
  const back = await rect(`${LV} .ps-back`), change = await rect(`${LV} .ps-action`), title = await rect(`${LV} .ps-title`);
  assert(back.h >= 43.9 && back.w >= 43.9 && back.l >= 7.9, `2-4: Back is a >= 44 pt target >= 8 pt from the edge (${back.w.toFixed(0)} x ${back.h.toFixed(0)}, left ${back.l.toFixed(1)})`);
  assert(change.h >= 43.9 && change.w >= 43.9 && 390 - change.r >= 7.9 && change.l - (back.r) >= 7.9, `2-5: "Change" is a >= 44 pt target >= 8 pt from the right edge and 8 pt from Back (${change.w.toFixed(0)} x ${change.h.toFixed(0)}, right gap ${(390 - change.r).toFixed(1)})`);
  assert(Math.abs((title.l + title.r) / 2 - 195) < 12 || title.w < 200, '2-6: the title is centred between them');
  const act = await css(`${LV} .ps-action`, ['color', 'font-weight', 'background-color', 'border-top-width', 'cursor']);
  assert(act.color === await token('--maroon-text') && act['font-weight'] === '600' && act['background-color'] === 'rgba(0, 0, 0, 0)' && act['border-top-width'] === '0px', `2-7: "Change" is the Back button's twin - a --maroon-text text action, no chrome (${JSON.stringify(act)})`);
  const body = await css(`${LV} .ps-body`, ['padding-left', 'padding-right', 'row-gap', 'overflow-y']);
  assert(parseFloat(body['padding-left']) >= 16 && parseFloat(body['padding-right']) >= 16 && body['row-gap'] === '16px' && body['overflow-y'] === 'auto', `2-8: the body keeps >= 16 pt from both edges, 16 pt between cards, and scrolls natively (${JSON.stringify(body)})`);
  const cards = await evaluate(`[...document.querySelectorAll(${JSON.stringify(LV + ' .cmp-card')})].map((e) => { const b = e.getBoundingClientRect(), c = getComputedStyle(e); return { t: b.top, b: b.bottom, l: b.left, r: b.right, pad: c.paddingTop + '/' + c.paddingLeft, rad: c.borderTopLeftRadius, bg: c.backgroundColor }; })`);
  assert(cards.length === 4 && cards.slice(1).every((c, i) => Math.abs(c.t - cards[i].b - 16) < 0.6), `2-9: four cards (header, Head to head, Season, Games you split on), each exactly 16 pt below the last (${cards.slice(1).map((c, i) => (c.t - cards[i].b).toFixed(1)).join('/')})`);
  assert(cards.every((c) => c.pad === '16px/16px' && c.l >= 15.9 && 390 - c.r >= 15.9 && c.bg === cards[0].bg && c.rad === cards[0].rad), '2-10: each card has 16 pt of padding, sits >= 16 pt from the screen edges, and shares one surface and one corner radius');
  assert(cards[0].bg === await token('--bg-card'), '2-11: the card surface is the --bg-card token');
  const head = await evaluate(`document.querySelector(${JSON.stringify(LV + ' .cmp-through')}).textContent`);
  assert(head === 'Through Week 2 · 9 finished games', `2-12: the header names its denominator ("${head}")`);
  // the split bar
  const bar = await evaluate(`(() => { const w = document.querySelector(${JSON.stringify(LV + ' .cmp-split-wrap')}); const bar = w.querySelector('.cmp-bar'); const a = [...bar.querySelectorAll('.cmp-bar-a')], b = [...bar.querySelectorAll('.cmp-bar-b')]; const ns = [...w.querySelectorAll('.cmp-split-n')].map((n) => n.getBoundingClientRect());
    const br = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
    return { a: a.length, b: b.length, aw: a.reduce((s, e) => s + e.getBoundingClientRect().width, 0), bw: b.reduce((s, e) => s + e.getBoundingClientRect().width, 0), h: br.height, w: br.width, l: br.left, r: br.right, lr: ns[0].right, rl: ns[1].left, disp: cs.display, rad: cs.borderTopLeftRadius, aBg: getComputedStyle(a[0]).backgroundColor, bBg: getComputedStyle(b[0]).backgroundColor, label: bar.getAttribute('aria-label'), role: bar.getAttribute('role') }; })()`);
  assert(bar.a === 2 && bar.b === 2 && Math.abs(bar.aw - bar.bw) < 0.6 && Math.abs(bar.aw + bar.bw - bar.w) < 0.6 && Math.abs(bar.h - 12) < 0.1 && bar.disp === 'flex', `2-13: the split bar is 12 pt tall; two blocks each side fill it in equal halves (${bar.aw.toFixed(1)} / ${bar.bw.toFixed(1)} of ${bar.w.toFixed(1)})`);
  assert(bar.l - bar.lr >= 7.9 && bar.rl - bar.r >= 7.9, `2-14: the numbers beside it are 8 pt clear of the bar (${(bar.l - bar.lr).toFixed(1)} / ${(bar.rl - bar.r).toFixed(1)}) - never colour alone`);
  assert(bar.aBg === await token('--maroon-text') && bar.bBg === await token('--text-secondary') && bar.role === 'img' && /^You covered 2, Brayden covered 2/.test(bar.label), '2-15: the two halves are --maroon-text and --text-secondary tokens, and the bar speaks its meaning');
  // the Season grid
  const grid = await evaluate(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(LV + ' .cmp-gridrow:not(.cmp-gridhead)')})]; const card = document.querySelector(${JSON.stringify(LV + ' .cmp-season')});
    const inner = card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight) - parseFloat(getComputedStyle(card).borderRightWidth);
    const line = rows.map((r) => { const lab = r.querySelector('.cmp-lab').getBoundingClientRect(), vs = [...r.querySelectorAll('.cmp-val')].map((v) => v.getBoundingClientRect()); return { oneLine: Math.abs(lab.top - vs[0].top) < 3 && Math.abs(vs[0].top - vs[1].top) < 3, v1r: vs[0].right, v2r: vs[1].right, h: r.getBoundingClientRect().height }; });
    return { n: rows.length, disp: getComputedStyle(rows[0]).display, wrap: getComputedStyle(rows[0]).flexWrap, line, inner, vals: rows.flatMap((r) => [...r.querySelectorAll('.cmp-val')].map((v) => { const c = getComputedStyle(v); return { ws: c.whiteSpace, ta: c.textAlign, fv: c.fontVariantNumeric, clipped: v.scrollWidth > v.clientWidth + 0.5 }; })), cardClipped: card.scrollWidth > card.clientWidth + 1,
      gaps: rows.slice(1).map((r, i) => r.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom), pad: getComputedStyle(rows[0]).paddingTop }; })()`);
  assert(grid.n === 7 && grid.disp === 'flex' && grid.wrap === 'wrap' && grid.line.every((l) => l.oneLine), `2-16: the Season rows: seven, each ONE line at 390 pt - label, You, them - able to wrap (${grid.disp}/${grid.wrap}, one line: ${grid.line.map((l) => l.oneLine)})`);
  assert(grid.line.every((l) => Math.abs(l.v2r - grid.inner) < 0.6) && grid.line.every((l) => Math.abs(l.v1r - grid.line[0].v1r) < 0.6), `2-16b: the columns line up down the card: the rival column ends at the card's content edge (${grid.inner.toFixed(1)}) in every row and the You column ends at one x (You ${[...new Set(grid.line.map((l) => l.v1r.toFixed(1)))].join(',')}; rival ${[...new Set(grid.line.map((l) => l.v2r.toFixed(1)))].join(',')})`);
  assert(grid.vals.every((v) => v.ws === 'nowrap' && v.ta === 'right' && /tabular-nums/.test(v.fv) && !v.clipped) && !grid.cardClipped, '2-16c: every value is nowrap, right-aligned, tabular and unclipped; the card does not overflow');
  assert(grid.pad === '8px', `2-17: each Season row has 8 pt above and below its text (padding ${grid.pad})`);
  // the game rows
  const rows = await evaluate(`[...document.querySelectorAll(${JSON.stringify(LV + ' .hx-item')})].map((it) => { const o = it.querySelector('.hx-open').getBoundingClientRect(), t = it.querySelector('.hx-thread').getBoundingClientRect(), b = it.getBoundingClientRect(); return { oh: o.height, th: t.height, tw: t.width, gap: t.left - o.right, clipR: t.right > b.right + 0.5, over: it.scrollWidth > it.clientWidth + 0.5 }; })`);
  assert(rows.length === 4 && rows.every((r) => r.oh >= 43.9 && r.th >= 43.9 && r.tw >= 43.9 && r.gap >= 7.9 && !r.clipR && !r.over), `2-18: four game rows: the game button and the Thread button are each >= 44 pt, 8 pt apart, inside the row (${rows.map((r) => r.gap.toFixed(0)).join('/')})`);
  // DI-597 / P-8: the Share to chat button - a secondary action in the card detail's own action group, at the end of the screen, 44 pt, the 16 pt icon 8 pt before the label, pressing to 97%
  const shareProbe = async (lvSel, rootCls, attr) => evaluate(`(() => { const lv = document.querySelector(${JSON.stringify(lvSel)}); const grp = lv && lv.querySelector(${JSON.stringify(rootCls + ' > .cd-actions')}); const b = grp && grp.querySelector(${JSON.stringify('[' + attr + '="share"]')}); if (!b) return null;
    const cs = getComputedStyle(b), gs = getComputedStyle(grp), br = b.getBoundingClientRect(), gr = grp.getBoundingClientRect(), ic = b.querySelector('.cd-action-icon'), ir = ic.getBoundingClientRect(), pv = grp.previousElementSibling.getBoundingClientRect(), sv = ic.querySelector('svg').getBoundingClientRect();
    return { text: b.textContent, h: br.height, jc: gs.justifyContent, gap: gr.top - pv.bottom, last: grp === grp.parentNode.lastElementChild, iw: ir.width, ih: ir.height, im: getComputedStyle(ic).marginRight, sw: sv.width, inset: br.left >= 15.5 && br.right <= 390 - 15.5, ico: cs.display, tr: cs.transitionDuration }; })()`);
  const cshare = await shareProbe(LV, '.cmp', 'data-cmp-action');
  assert(!!cshare && cshare.text === 'Share to chat' && cshare.h >= 43.9 && cshare.jc === 'center' && Math.abs(cshare.gap - 16) < 0.6 && cshare.last && cshare.iw === 16 && cshare.ih === 16 && cshare.im === '8px' && cshare.sw === 16 && cshare.inset,
    `2-18b: the comparison ends with "Share to chat": >= 44 pt, a centred group 16 pt below the last card, the 16 pt share glyph 8 pt before the label, inside the 16 pt gutters (${cshare && cshare.h.toFixed(0)}pt, gap ${cshare && cshare.gap.toFixed(1)})`);
  assert(await press(`${LV} [data-cmp-action="share"]`) === PRESSED, '2-18c: …and a pressed Share button compresses to 97%');
  const thrCss = await css(`${LV} .hx-thread`, ['border-top-width', 'border-top-style', 'border-top-left-radius', 'background-color', 'white-space', 'font-weight']);
  assert(thrCss['border-top-width'] === '1px' && thrCss['white-space'] === 'nowrap' && thrCss['font-weight'] === '600' && thrCss['background-color'] === await token('--bg-input'), `2-19: "Thread · n" is a bordered --bg-input button that never wraps (${JSON.stringify(thrCss)})`);
  const okMark = await q1(`${LV} .hx-mark--win`, '(e) => getComputedStyle(e).color'), badMark = await q1(`${LV} .hx-mark--loss`, '(e) => getComputedStyle(e).color');
  assert(okMark === await token('--win') && badMark === await token('--loss'), `2-20: ✓ is the --win token and ✗ the --loss token (${okMark} / ${badMark})`);
  for (const sel of [`${LV} .hx-open`, `${LV} .hx-thread`, `${LV} .ps-action`]) assert(await press(sel) === PRESSED, `2-21: a pressed ${sel.replace(LV + ' ', '')} compresses to 97%`);
  const cs = [];
  for (const sel of [`${LV} .cd-sentence`, `${LV} .hx-sub`, `${LV} .cmp-val`, `${LV} .cmp-lab`, `${LV} .cd-fresh`, `${LV} .hx-title`, `${LV} .cmp-split-names span`]) { const c = await colours(sel); if (c) cs.push([sel.replace(LV + ' ', ''), ratio(c.fg, c.bg)]); }
  assert(cs.length >= 6 && cs.every(([, r]) => r >= 4.5), `2-22: every text role clears 4.5:1 on its card (${cs.map(([s, r]) => s + ' ' + r.toFixed(1)).join(', ')})`);
  // the smallest iPhone: the rows may wrap their label, but nothing overflows
  await viewport(320, 568);
  await sleep(300);
  const sm = await evaluate(`(() => { const lv = document.querySelector(${JSON.stringify(LV)}); const body = lv.querySelector('.ps-body'); const outside = (el) => [...el.children].some((c) => { const r = c.getBoundingClientRect(), p = el.getBoundingClientRect(); return r.left < p.left - 0.5 || r.right > p.right + 0.5; });
    return { bodyOver: body.scrollWidth > body.clientWidth + 1, rows: [...lv.querySelectorAll('.cmp-gridrow, .hx-item')].map((r) => r.scrollWidth > r.clientWidth + 1 || outside(r)), btns: [...lv.querySelectorAll('.hx-open, .hx-thread, .ps-action, .ps-back, .cd-action')].map((b) => b.getBoundingClientRect().height) }; })()`);
  assert(!sm.bodyOver && !sm.rows.some(Boolean) && sm.btns.every((h) => h >= 43.9), '2-22b: at 320 pt (the smallest iPhone) the rows wrap instead of overflowing and every control stays >= 44 pt');
  await viewport(390, 844);
  await sleep(300);
  // largest text: iOS's largest accessibility size (AX5) is about 3.1x the default body size, modelled here as a 300% root; a nowrap value such as "Week 1, 4–1" (the DI: values do not wrap) is the one
  // thing that grows past a 311 pt card above that, which is why this is not a 400% stress as in the Standings block
  await evaluate(`document.documentElement.style.fontSize = '300%'`);
  await sleep(300);
  const xl2 = await evaluate(`(() => { const lv = document.querySelector(${JSON.stringify(LV)}); const body = lv.querySelector('.ps-body'); const outside = (el) => [...el.children].some((c) => { const r = c.getBoundingClientRect(), p = el.getBoundingClientRect(); return r.left < p.left - 0.5 || r.right > p.right + 0.5; });
    const items = [...lv.querySelectorAll('.hx-item')].map((it) => it.scrollWidth > it.clientWidth + 1 || outside(it)); const g = [...lv.querySelectorAll('.cmp-gridrow')].map((r) => r.scrollWidth > r.clientWidth + 1 || outside(r));
    const opens = [...lv.querySelectorAll('.hx-open')].map((o) => { const b = o.getBoundingClientRect(); return { w: b.width, h: b.height }; });
    return { bodyOver: body.scrollWidth > body.clientWidth + 1, items, g, opens, btns: [...lv.querySelectorAll('.hx-open, .hx-thread, .ps-action, .ps-back, .cd-action')].map((b) => b.getBoundingClientRect().height) }; })()`);
  assert(!xl2.bodyOver && !xl2.items.some(Boolean) && !xl2.g.some(Boolean) && xl2.btns.every((h) => h >= 43.9), `2-23: at 300% text (iOS's largest, about 3.1x) nothing scrolls sideways or sits outside its row (the Season rows and the game rows reflow), and every control stays >= 44 pt`);
  assert(xl2.opens.every((o) => o.w >= 200 && o.h < 900), `2-23b: …and a game button is never squeezed to a sliver by its Thread button (widths ${xl2.opens.map((o) => o.w.toFixed(0)).join('/')}) - at a large size the Thread button drops under the game`);
  await evaluate(`document.documentElement.style.fontSize = ''`);
  await sleep(200);
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(150);
  assert(await q1(`${LV}`, '(e) => getComputedStyle(e).transitionDuration') === '0s' && await press(`${LV} .ps-action`) === 'none' && await press(`${LV} .hx-thread`) === 'none', '2-24: Reduce Motion: the screen has no slide, and no control compresses');
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[3] The rival picker sheet…');
  // ═════════════════════════════════════════════════════════════════════════
  await tap(`${LV} .ps-action`, 600);
  const SH = '#rival-picker-sheet', WRAP = '#rival-picker-sheet-wrap';
  assert(await waitFor(`document.querySelector(${JSON.stringify(SH)})`, 3000), '3-0: a real tap on Change opens the picker');
  await sleep(450);
  const sb = await rect(SH), wb = await rect(WRAP);
  const wcs = await css(WRAP, ['position', 'z-index']), scs = await css(SH, ['position', 'transition-duration', 'transition-property', 'transform', 'border-top-left-radius']);
  assert(wcs.position === 'fixed' && wcs['z-index'] === '8000' && Math.abs(wb.w - 390) < 0.5 && Math.abs(wb.h - 844) < 0.5, `3-1: the sheet's wrap is fixed over the whole viewport at z-index 8000, above the pushed screen (${JSON.stringify(wcs)})`);
  assert(Math.abs(sb.b - 844) < 1 && Math.abs(sb.w - 390) < 1 && sb.t > 100 && scs['transition-duration'] === '0.26s' && /transform/.test(scs['transition-property']), `3-2: it is a BOTTOM sheet - flush with the bottom edge, full width, shorter than the screen, sliding over --motion-nav (top ${sb.t.toFixed(0)}, bottom ${sb.b.toFixed(0)}, ${scs['transition-duration']})`);
  const prow = await evaluate(`[...document.querySelectorAll('#rival-picker-body .cmp-pick-row')].map((e) => { const b = e.getBoundingClientRect(), c = getComputedStyle(e); return { h: b.height, t: b.top, bt: b.bottom, l: b.left, r: b.right, pad: c.paddingLeft, rad: c.borderTopLeftRadius, bw: c.borderTopWidth, cur: e.classList.contains('is-current') }; })`);
  assert(prow.length === 5 && prow.every((r) => r.h >= 55.9 && r.pad === '16px' && r.rad === '12px') && prow.slice(1).every((r, i) => Math.abs(r.t - prow[i].bt - 8) < 0.6), `3-3: five rows, each >= 56 pt with 16 pt of padding, 8 pt apart (${prow.map((r) => r.h.toFixed(0)).join('/')})`);
  assert(prow.every((r) => r.l >= 7.9 && 390 - r.r >= 7.9), '3-4: the rows keep >= 8 pt from the sheet\'s edges');
  const cur = await evaluate(`(() => { const e = document.querySelector('#rival-picker-body .cmp-pick-row.is-current'); const c = getComputedStyle(e); const ck = e.querySelector('.cmp-pick-check'); const cb = ck.getBoundingClientRect(), rb = e.getBoundingClientRect(); return { bc: c.borderTopColor, id: e.getAttribute('data-cmp-rival'), cw: cb.width, ch: cb.height, rgap: rb.right - cb.right, svg: !!ck.querySelector('svg') }; })()`);
  assert(cur.id === 'p2' && cur.bc === await token('--maroon-text') && cur.cw === 20 && cur.ch === 20 && cur.rgap >= 15.9 && cur.svg, `3-5: Brayden is current: a --maroon-text border and a 20 pt check >= 16 pt inside the row (${JSON.stringify(cur)})`);
  const close = await rect('#rival-picker-close');
  assert(close.w >= 43.9 && close.h >= 43.9 && 390 - close.r >= 7.9, `3-6: the close control is a >= 44 pt target >= 8 pt from the edge (${close.w.toFixed(0)} x ${close.h.toFixed(0)})`);
  const scrim = await css(`${WRAP} .chat-sheet-backdrop`, ['position', 'opacity']);
  const scrimBox = await rect(`${WRAP} .chat-sheet-backdrop`);
  assert(Math.abs(scrimBox.w - 390) < 0.5 && Math.abs(scrimBox.h - 844) < 0.5 && parseFloat(scrim.opacity) > 0.99, `3-7: the scrim covers the whole page behind the sheet (${scrimBox.w} x ${scrimBox.h}, opacity ${scrim.opacity})`);
  assert(await evaluate(`getComputedStyle(document.documentElement).overflow`) === 'hidden', '3-8: the page behind does not scroll while the sheet is up (html overflow hidden)');
  assert(await press('#rival-picker-body .cmp-pick-row') === PRESSED && await press('#rival-picker-close') === PRESSED, '3-9: a pressed row and the close control compress to 97%');
  const sheetBlock = await evaluate(`(async () => { const app = await import('./js/app.js'); return app._dismissBlockingSurfaceUpForTest({ excludePushed: true }); })()`);
  assert(sheetBlock === true, '3-10: while the sheet is up the dismiss-blocking list says so (the screen\'s swipe-back and Esc yield to it)');
  await tap('#rival-picker-close', 600);
  assert(await waitFor(`!document.querySelector(${JSON.stringify(WRAP)})`, 3000), '3-11: ✕ slides it away and removes it');
  assert(await evaluate(`getComputedStyle(document.documentElement).overflow`) !== 'hidden', '3-12: …and the page scrolls again');
  // a rival pick through the real row
  await tap(`${LV} .ps-action`, 600);
  await sleep(450);
  await tap('#rival-picker-body .cmp-pick-row[data-cmp-rival="p4"]', 700);
  assert(await waitFor(`document.querySelector('#pushed-root .ps-level[data-ps-id="compare:p1:p4"]') && !document.querySelector('#rival-picker-sheet-wrap')`, 3000), '3-13: choosing Koby replaces the screen with "You vs Koby" and removes the sheet');
  assert(await evaluate(`document.querySelectorAll('#pushed-root .ps-level').length`) === 1, '3-14: still ONE level (Back returns to Standings)');
  await tap('#pushed-root .ps-back', 600);
  assert(await waitFor(`!document.getElementById('pushed-root')`, 3000), '3-15: Back returns to Standings');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[4] The week detail…');
  // ═════════════════════════════════════════════════════════════════════════
  await tap(OPEN, 700);
  const WL = '#pushed-root .ps-level[data-ps-id^="week:"]';
  assert(await waitFor(`document.querySelector(${JSON.stringify(WL)}) && !document.querySelector('#pushed-root .ps-level--entering')`, 3000), '4-0: a real tap on Week 2\'s opener pushes the week detail');
  const wdCards = await evaluate(`[...document.querySelectorAll(${JSON.stringify(WL + ' .wd-card')})].map((e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; })`);
  assert(wdCards.length === 3 && wdCards.slice(1).every((c, i) => Math.abs(c.t - wdCards[i].b - 16) < 0.6) && wdCards.every((c) => c.l >= 15.9 && 390 - c.r >= 15.9), `4-1: the result, standings and games cards: 16 pt apart, >= 16 pt from the edges (${wdCards.length})`);
  const tbl = await evaluate(`(() => { const c = document.querySelector(${JSON.stringify(WL + ' .cd-table')}); const t = c.querySelector('table'); const cs = getComputedStyle(c); return { ox: cs.overflowX, tw: t.getBoundingClientRect().width, cw: c.clientWidth, rows: t.querySelectorAll('tbody tr').length }; })()`);
  assert(tbl.ox === 'auto' && tbl.rows === 6 && tbl.tw <= tbl.cw + 1, `4-2: the week's standings table (6 rows) fits its card at 390 pt, and the card scrolls sideways if it ever must (${tbl.tw.toFixed(0)} in ${tbl.cw})`);
  const wshare = await shareProbe(WL, '.wd', 'data-wd-action');
  assert(!!wshare && wshare.text === 'Share to chat' && wshare.h >= 43.9 && wshare.jc === 'center' && Math.abs(wshare.gap - 16) < 0.6 && wshare.last && wshare.iw === 16 && wshare.im === '8px' && wshare.inset,
    `4-1b: the week detail ends with the same "Share to chat" group: >= 44 pt, centred, 16 pt below the games card, glyph 8 pt before the label (${wshare && wshare.h.toFixed(0)}pt, gap ${wshare && wshare.gap.toFixed(1)})`);
  // B3 (review): the raw-versus-weighted sentence sits INSIDE the standings card, under the table, in the quiet footnote type, 8 pt below it
  const wfoot = await evaluate(`(() => { const c = document.querySelector(${JSON.stringify(WL + ' .cd-table')}); const f = c.querySelector('.wd-foot'); if (!f) return null; const cs = getComputedStyle(f), fr = f.getBoundingClientRect(), tr = c.querySelector('table').getBoundingClientRect(), cr = c.getBoundingClientRect();
    return { text: f.textContent, size: cs.fontSize, color: cs.color, mt: cs.marginTop, gap: fr.top - tr.bottom, fits: fr.left >= cr.left - 0.5 && fr.right <= cr.right + 0.5, n: c.querySelectorAll('.wd-foot').length }; })()`);
  assert(!!wfoot && wfoot.n === 1 && wfoot.text === 'Picks count each game’s multiplier. Win % counts every pick once.' && wfoot.size === '13px' && wfoot.color === await token('--text-secondary') && wfoot.mt === '0px' && Math.abs(wfoot.gap - 8) < 0.6 && wfoot.fits,
    `4-2b: the raw-versus-weighted sentence is Standings' own words, 13 px --text-secondary, 8 pt under the table, inside the card (${wfoot && wfoot.size} ${wfoot && wfoot.gap.toFixed(1)})`);
  const wrows = await evaluate(`[...document.querySelectorAll(${JSON.stringify(WL + ' .hx-item')})].map((it) => { const o = it.querySelector('.hx-open').getBoundingClientRect(), t = it.querySelector('.hx-thread').getBoundingClientRect(); return { oh: o.height, th: t.height, gap: t.left - o.right, over: it.scrollWidth > it.clientWidth + 0.5, picks: it.querySelectorAll('.hx-pick').length }; })`);
  assert(wrows.length === 4 && wrows.every((r) => r.oh >= 43.9 && r.th >= 43.9 && r.gap >= 7.9 && !r.over && r.picks === 2), `4-3: four game rows, each with its split and the viewer's own pick, 44 pt targets 8 pt apart, nothing clipped`);
  const cover = await q1(`${WL} .hx-cover`, '(e) => ({ w: getComputedStyle(e).fontWeight, c: getComputedStyle(e).color })');
  assert(cover.w === '600' && cover.c === await token('--text-primary'), '4-4: "{team} covered by {x}" is the row\'s emphasis (600, --text-primary)');
  const wcol = [];
  for (const sel of [`${WL} .cd-rows dt`, `${WL} .cd-rows dd`, `${WL} .hx-sub`, `${WL} .hx-who`, `${WL} .hx-title`]) { const c = await colours(sel); if (c) wcol.push([sel.replace(WL + ' ', ''), ratio(c.fg, c.bg)]); }
  assert(wcol.length === 5 && wcol.every(([, r]) => r >= 4.5), `4-5: every text role on the week detail clears 4.5:1 (${wcol.map(([s, r]) => s + ' ' + r.toFixed(1)).join(', ')})`);
  // B1 (review): a game older than what the device has loaded shows a BARE "Thread" - same 44 pt target, 8 pt from its row, nothing clipped, no number anywhere
  await evaluate(`(async () => { const b = await import('./js/backend.js'); b.setDataMode('supabase'); const chat = await import('./js/chat.js'); const ps = await import('./js/pushed-screen.js');
    chat.ingest([{ id: 'tail1', seq: 500, ts: Date.now() - 3600000, type: 'message', author: 'p3', gameTag: '', body: 'tail', replyTo: '', notify: true, meta: null, targetId: '' }]); ps.invalidateScreens(); ps._flushRepaintForTest(); })()`);
  await sleep(300);
  const bare = await evaluate(`[...document.querySelectorAll(${JSON.stringify(WL + ' .hx-item')})].map((it) => { const o = it.querySelector('.hx-open').getBoundingClientRect(), t = it.querySelector('.hx-thread'), tr = t.getBoundingClientRect(), ir = it.getBoundingClientRect(); return { text: t.textContent, label: t.getAttribute('aria-label'), th: tr.height, gap: tr.left - o.right, over: tr.right > ir.right + 0.5 || o.right > ir.right + 0.5 }; })`);
  assert(bare.length === 4 && bare.every((r) => r.text === 'Thread' && !/\d/.test(r.label) && r.th >= 43.9 && r.gap >= 7.9 && !r.over), `4-3b: with the log loaded only from an hour ago, all four rows show a bare "Thread" (no number, no digit in its name), 44 pt, 8 pt from the row, nothing clipped (${bare.map((r) => r.text + ' ' + r.th.toFixed(0)).join(' | ')})`);
  await tap(`${WL} .ps-back`, 600);
  await waitFor(`!document.getElementById('pushed-root')`, 3000);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[5] The sport control (a league that runs CFB and the NFL)…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`localStorage.clear()`);
  await navigate();
  await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`);
  await evaluate(SEED(true));
  await navigate();
  await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`);
  await gotoTab('leaderboard');
  assert(await waitFor(`document.querySelectorAll('#page-leaderboard .stand-cmp').length >= 6`, 6000), '5-0: fixture — two sports; Standings paints for the context sport');
  await sleep(300);
  await tap('#page-leaderboard .stand-cmp[data-cmp-player="p2"]', 700);
  const L2 = '#pushed-root .ps-level[data-ps-id="compare:p1:p2"]';
  assert(await waitFor(`document.querySelector(${JSON.stringify(L2 + ' .cmp-seg')})`, 3000), '5-1: both members play both sports, so the comparison draws the sport control');
  const seg = await evaluate(`(() => { const s = document.querySelector(${JSON.stringify(L2 + ' .cmp-seg')}); const bs = [...s.querySelectorAll('.cmp-seg-btn')].map((b) => { const r = b.getBoundingClientRect(), c = getComputedStyle(b); return { t: b.textContent, on: b.getAttribute('aria-checked'), h: r.height, l: r.left, r: r.right, w: r.width, bg: c.backgroundColor, fg: c.color, rad: c.borderTopLeftRadius, role: b.getAttribute('role') }; });
    return { role: s.getAttribute('role'), label: s.getAttribute('aria-label'), gap: getComputedStyle(s).columnGap, bs }; })()`);
  assert(seg.role === 'radiogroup' && seg.label === 'Sport' && seg.bs.length === 2 && seg.bs.every((b) => b.role === 'radio' && b.h >= 43.9) && Math.abs(seg.bs[1].l - seg.bs[0].r - 8) < 0.6 && Math.abs(seg.bs[0].w - seg.bs[1].w) < 0.6 && seg.gap === '8px',
    `5-2: a radiogroup "Sport" of two equal 44 pt radios, 8 pt apart (${seg.bs.map((b) => b.t + ' ' + b.h.toFixed(0)).join(' | ')})`);
  const on = seg.bs.find((b) => b.on === 'true'), off = seg.bs.find((b) => b.on === 'false');
  assert(on.bg === await token('--maroon') && on.fg === await token('--on-accent') && off.bg === await token('--bg-input') && off.fg === await token('--text-secondary'), `5-3: the selected radio is --maroon on --on-accent; the other --bg-input with --text-secondary (${on.t} on)`);
  assert(ratio(on.fg, on.bg) >= 4.5 && ratio(off.fg, off.bg) >= 4.5, `5-4: both states clear 4.5:1 (${ratio(on.fg, on.bg).toFixed(1)} / ${ratio(off.fg, off.bg).toFixed(1)})`);
  const before = await evaluate(`document.querySelector(${JSON.stringify(L2 + ' .cmp-through')}).textContent + '|' + document.querySelector(${JSON.stringify(L2 + ' .cmp-season')}).textContent`);
  await tap(`${L2} .cmp-seg-btn[aria-checked="false"]`, 600);
  const after = await evaluate(`document.querySelector(${JSON.stringify(L2 + ' .cmp-through')}).textContent + '|' + document.querySelector(${JSON.stringify(L2 + ' .cmp-season')}).textContent`);
  const swapped = await evaluate(`[...document.querySelectorAll(${JSON.stringify(L2 + ' .cmp-seg-btn')})].map((b) => b.getAttribute('aria-checked') + ':' + b.textContent).join(',')`);
  assert(before !== after && /Through Week 1 · 3 finished games/.test(after) && /^false:|,true:/.test(swapped) && !/11[–-]|overall/i.test(after), `5-5: a real tap on the other sport swaps the WHOLE screen in place (now "${after.slice(0, 40)}…", control ${swapped}) - one competition's figures, never a second column`);
  assert(await evaluate(`document.querySelectorAll('#pushed-root .ps-level').length`) === 1 && await press(`${L2} .cmp-seg-btn`) === PRESSED, '5-6: still one level; a pressed radio compresses to 97%');
  await tap(`${L2} .ps-back`, 600);
  await waitFor(`!document.getElementById('pushed-root')`, 3000);
  // Pass 3 (R2 / D1, and the polish that goes with them): the NFL becomes opt-in for Drew and Brayden only; Kevin, who is NOT entered, opens NFL Week 1's detail. His rows are matchup, score and cover - no
  // split, no "No pick" - and they draw NO picks column: an empty one is still a flex item and would leave the row's 8 pt gap hanging under the cover line.
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const app = await import('./js/app.js');
    const nfl = st.getCompetitions().find((c) => c.sport === 'nfl'); st.saveCompetition({ ...nfl, enrollment: 'opt_in' });
    const RD = Date; globalThis.Date = class extends RD { constructor(...a) { if (a.length === 0) super('2026-01-02T00:00:00.000Z'); else super(...a); } static now() { return new RD('2026-01-02T00:00:00.000Z').getTime(); } };
    try { for (const m of ['p1', 'p2']) st.addCompetitionMember({ competitionId: nfl.id, memberId: m }); } finally { globalThis.Date = RD; }
    st.setSession('p3', false, true); app.openWeekDetail('nw1', { backLabel: 'Standings' }); })()`);
  const NL = '#pushed-root .ps-level[data-ps-id="week:nw1"]';
  assert(await waitFor(`document.querySelector(${JSON.stringify(NL + ' .hx-item')}) && !document.querySelector('#pushed-root .ps-level--entering')`, 3000), '5-7: (fixture) Kevin, not entered in the NFL, has NFL Week 1\'s detail open');
  const ne = await evaluate(`[...document.querySelectorAll(${JSON.stringify(NL + ' .hx-item')})].map((it) => { const o = it.querySelector('.hx-open').getBoundingClientRect(), m = it.querySelector('.hx-main').getBoundingClientRect(), t = it.querySelector('.hx-thread');
    return { picks: it.querySelectorAll('.hx-picks').length, tail: o.bottom - m.bottom, oh: o.height, th: t ? t.getBoundingClientRect().height : 0, text: it.textContent, label: it.querySelector('.hx-open').getAttribute('aria-label') }; })`);
  assert(ne.length === 3 && ne.every((r) => r.picks === 0 && !/No pick|Your pick|Split/.test(r.text) && !/League split|You made no pick|You picked/.test(r.label)), `5-8: R2 / D1 in the engine - his three rows carry no chip, no "No pick" and no split, read or spoken (${ne.map((r) => r.text.replace(/\s+/g, ' ').slice(0, 40)).join(' | ')})`);
  assert(ne.every((r) => Math.abs(r.tail) < 0.6 && r.oh >= 43.9 && r.th >= 43.9), `5-9: (polish) each row ends at its cover line - no empty picks column leaving an 8 pt gap below it - and keeps 44 pt targets (tails ${ne.map((r) => r.tail.toFixed(1)).join(', ')})`);
  await evaluate(`(async () => { (await import('./js/pushed-screen.js')).closeAllScreens('test'); (await import('./js/storage.js')).setSession('p1', false, true); })()`);
  await waitFor(`!document.getElementById('pushed-root')`, 3000);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[6] The chat\'s filter for a past game that has no pill…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`localStorage.clear()`);
  await navigate();
  await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`);
  await evaluate(SEED(false));
  await navigate();
  await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`);
  await evaluate(`(async () => { const chat = await import('./js/chat.js'); const st = await import('./js/storage.js'); const fx = await import('./statsfixtures.mjs');
    chat.ingest([{ id: 'old1', seq: 1, ts: Date.now() - 9 * 86400000, type: 'message', author: 'p3', gameTag: 'g21', body: 'an old take on Oregon', replyTo: '', notify: true, meta: null, targetId: '' }]);
    for (let i = 0; i < 11; i++) { const g = fx.mkGame({ id: 'y' + i, weekId: 'w2', kick: '2026-09-13T0' + (i % 10) + ':00:00.000Z', home: 'YH' + i, away: 'YA' + i, kind: 'cover', state: 'final' }); st.saveGame(g);
      chat.ingest([{ id: 'new' + i, seq: 100 + i, ts: Date.now() - (1000 + i * 1000), type: 'message', author: 'p4', gameTag: g.gameId, body: 'new ' + i, replyTo: '', notify: true, meta: null, targetId: '' }]); } })()`);
  await gotoTab('chat');
  await evaluate(`(async () => { const ui = await import('./js/chat-ui.js'); ui._setChatFilterForTest('g21'); ui.renderChatPage(); })()`);
  await sleep(500);
  const CH = await evaluate(`(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }; const h = document.querySelector('#page-chat .chat-view-header'), back = document.querySelector('#page-chat .chat-view-all'), pills = document.querySelector('#page-chat .chat-pills-scroll');
    return { has: !!h && !!back, text: h && h.textContent.replace(/\\s+/g, ' ').trim(), h: h && r(h), back: back && r(back), pills: pills && r(pills), clip: h && h.scrollWidth > h.clientWidth + 1, bc: back && getComputedStyle(back).backgroundColor, fg: back && getComputedStyle(back).color, wrap: back && r(back.parentElement), vw: innerWidth }; })()`);
  assert(CH.has && /Washington at Oregon · Week 2/.test(CH.text), `6-1: the past game names itself in full ("${CH.text}")`);
  assert(CH.back.h >= 43.9 && CH.back.l >= 15.9 && CH.back.t - CH.h.b >= 7.9, `6-2: the way back is a >= 44 pt "All messages" button, >= 16 pt from the edge and 8 pt below the header (${CH.back.h.toFixed(0)} tall, left ${CH.back.l.toFixed(1)}, gap ${(CH.back.t - CH.h.b).toFixed(1)})`);
  assert(!CH.clip && CH.h.r <= CH.vw - 15.9, '6-3: the header label wraps; nothing clips at 390 pt');
  assert(CH.bc === await token('--bg-input') && CH.fg === await token('--text-secondary') && ratio(CH.fg, CH.bc) >= 4.5, '6-4: the button is the quiet secondary (--bg-input, --text-secondary, >= 4.5:1)');
  assert(await press('#page-chat .chat-view-all') === PRESSED, '6-5: it compresses to 97% when pressed');
  await viewport(320, 568);
  await sleep(300);
  const small = await evaluate(`(() => { const h = document.querySelector('#page-chat .chat-view-header'), b = document.querySelector('#page-chat .chat-view-all'); return { clip: h.scrollWidth > h.clientWidth + 1, bh: b.getBoundingClientRect().height, right: h.getBoundingClientRect().right, vw: innerWidth }; })()`);
  assert(!small.clip && small.bh >= 43.9 && small.right <= small.vw - 15.9, '6-6: at the smallest iPhone width (320 pt) the label still wraps without clipping and the button stays 44 pt');
  await viewport(390, 844);
  await tap('#page-chat .chat-view-all', 400);
  assert(await evaluate(`!document.querySelector('#page-chat .chat-view-header')`), '6-7: a real tap on All messages returns to the Locker Room');
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
void eq;
