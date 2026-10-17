/**
 * CFB Pickems — gameslistbrowsertest.mjs (D1 W-68 / W-69, 2026-10-14; P-8: "a new surface's styling is proven by a computed-style check in a real browser, not by class names")
 * ====================================================================================================================================================================
 * The Comm -> Games list, the add-or-swap action sheet and the swap picker sheet, driven through the REAL app in a REAL headless Chromium: the real index.html, css/styles.css and js/app.js booted in local
 * mode, a commissioner and an OPEN week (10 on the slate, 4 in the pool, picks on two games) seeded through the app's own js/storage.js, the Commissioner page opened, and every control tapped with a real
 * mouse event at its real on-screen position. Nothing is a fixture of the surface under test. gameslisttest.mjs and slateaddswaptest.mjs prove the behaviour in a Node tree; this proves the PAINT.
 *
 *   [1] the Games section paints as a list of cards: each row a flex column with the card's padding (12 / 16), radius, background, shadow and 8 pt gap; the segmented control, the summary, the controls.
 *   [2] 44 pt: every control and row button is at least 44 pt tall; buttons never touch (>= 8 pt); the destructive Remove computes the loss colour; the On slate mark is the win colour; nothing is dimmed.
 *   [3] no overflow and no collision at 320, 375 and 430 pt, and at 375 pt with the text doubled (the Dynamic Type stand-in), light and dark.
 *   [4] the add-or-swap action sheet: a fixed layer above everything (z 8100), pinned to the bottom with a margin, actions >= 54 pt with a divider, a bold Cancel; what a tap at an action's centre hits.
 *   [5] the swap picker: a fixed bottom sheet (z 8000) over the page, 56 pt radio rows, the radio dot, the picks chip and the amber warning, the footer button (50 pt, full width, disabled until a row is chosen),
 *       the page behind locked; a tap on Swap swaps, the sheet leaves, the toast is visible above it.
 *   [6] Remove in place: the page does not jump (scrollY), the row flips with the 150 ms fade, in the On slate segment it collapses (a real max-height transition) and is then gone; under Reduce Motion it is instant.
 *   [7] stacking: the choice sheet is above the week wizard sheet (the manual add on Step 2), and a tap on its action hits the action.
 *   [8] Paper Dark and Dark: the rows keep readable contrast (>= 4.5:1 for the matchup and the caption); Paper Dark's rows are light paper cards (the Paper scope lists the new row).
 *   [9] the other Comm tabs repaint once, when the commissioner leaves Games after an in-place change (the real MutationObserver).
 *   [10] ANTI-VACUITY: served with the new CSS block removed, the SAME detectors go red (buttons 34 pt, no card, no fixed sheet).
 *
 * The page boots in LOCAL (PIN) mode: this suite's own localhost server answers /config.json with `{}` and 404s service-worker.js. ALL other network resolution is blocked.
 *
 * Run: node gameslistbrowsertest.mjs     (engine override: WIZTEST_ENGINE / SHELLTEST_ENGINE / NAVTEST_ENGINE)
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.GLBROWSER_ROOT || here;
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: WIZTEST_ENGINE=/path/to/Chromium node gameslistbrowsertest.mjs. A missing browser is a FAILURE, never a skip.` : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (GLBROWSER_ROOT — serving ${ROOT})`);

// ── the app server: the real tree, local-mode config, no service worker; `cssTransform` serves a MODIFIED stylesheet (the anti-vacuity run) ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
let cssTransform = null;
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; }
  if (p === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  if (p.split('/').some(seg => seg.startsWith('.')) || p.startsWith('/supabase/') || p === '/supabase') { res.writeHead(404); res.end(); return; }
  try {
    let body = await readFile(join(ROOT, p));
    if (cssTransform && p.startsWith('/css/styles.css')) body = Buffer.from(cssTransform(body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ── the CDP client (the wizardsheettest shape) ──
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-gamesbrowser-'));
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', d => { buf += d.toString(); const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(t); res({ proc, ws: m[0] }); } });
    proc.on('error', e => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await fetch('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find(t => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true }); });
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
  await pg.send('Page.enable'); await pg.send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await evaluate(`!!(${expression})`)) return true; await sleep(100); } return false; };
  const navigate = async () => { const loaded = pg.once('Page.loadEventFired'); await pg.send('Page.navigate', { url: ORIGIN + '/index.html' }); await loaded; };
  const viewport = async (w, h = 844) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(150);
  };
  const clickAt = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await pg.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
  /** The centre of the first element matching `sel` whose text matches `re` (or any), scrolled into view first. Returns { x, y, w, h } or null. */
  const centre = (sel, re = null) => evaluate(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
    const el = els.find(e => ${re ? `new RegExp(${JSON.stringify(re)}).test(e.textContent)` : 'true'}); if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const tapSel = async (sel, re = null) => { const c = await centre(sel, re); if (!c) return false; await clickAt(c.x, c.y); await sleep(120); return true; };
  const staleNow = () => evaluate(`import(document.querySelector('script[type="module"][src*="js/app.js"]').src).then(a => a._commStaleForTest())`);
  const waitForAnimations = (sel) => waitFor(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getAnimations({ subtree: true }).every(a => a.playState === 'finished' || a.playState === 'idle'); })()`, 3000);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode), seed a commissioner + an OPEN week (10 on the slate, 4 in the pool, picks on two games)…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(375);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '1-0: fixture — the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const wk = dm.createWeek(2026, 7, '2026-10-17', '2026-10-18'); wk.status = 'open'; wk.blurb = 'A weekly blurb that is long enough to count.'; st.saveWeek(wk); st.setActiveWeekId(wk.weekId);
    const base = Date.UTC(2026, 9, 17, 16, 0);
    const mk = (i, o = {}) => dm.createGame(wk.weekId, { homeTeam: 'Home ' + i, awayTeam: 'Away ' + i, kickoff: new Date(base + i * 45 * 60000).toISOString(), kickoffConfirmed: true, spread: -3.5, favorite: 'Home ' + i, spreadSource: 'espn', espnEventId: 'E' + i, ...o });
    for (let i = 0; i < 10; i++) st.saveGame({ ...mk(i, i === 0 ? { dataSource: 'partial' } : {}), gameId: 'g' + i });   // g0 carries a data-quality chip (review F-4)
    const pool = []; for (let i = 0; i < 10; i++) pool.push(mk(i)); for (const n of [20, 21, 22, 23]) pool.push(mk(n));
    st.saveAvailableGames(wk.weekId, pool);
    const picks = []; for (const [gi, n] of [[2, 3], [5, 1]]) for (let k = 0; k < n; k++) picks.push({ ...dm.createPick(wk.weekId, 'g' + gi, 'p' + (k + 1), 'ZZPICKED'), pickId: 'pk' + gi + '_' + k });
    st.saveAllPicks(picks);
    st.setSession(null, true, false);
    await new Promise(r => setTimeout(r, 1200));
    return { weekId: wk.weekId, games: st.getGames(wk.weekId).length, pool: st.getAvailableGames(wk.weekId).length, picks: st.getPicks(wk.weekId).length };
  })()`);
  assert(seeded.games === 10 && seeded.pool === 14 && seeded.picks === 4, `1-1: fixture — the OPEN week has 10 slate games, a 14-game pool and 4 picks, seeded through the app's own storage (${JSON.stringify(seeded)})`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '1-2: fixture — after reload the app is past the site gate');
  assert(await waitFor(`document.querySelector('#page-home.active') && !document.querySelector('#home-root .home-feed[aria-busy="true"]')`, 12000), '1-3: fixture — the boot landed (its first Home render)');
  const openGames = async () => {
    await evaluate(`window.navigateTo('commissioner')`);
    await waitFor(`document.querySelector('.comm-tab[data-comm-tab-btn="games"]')`);
    await evaluate(`document.querySelector('.comm-tab[data-comm-tab-btn="games"]').click()`);
    return waitFor(`document.querySelector('#games-section .games-row')`, 8000);
  };
  assert(await openGames(), '1-4: fixture — Comm -> Games painted the ONE list');
  const NAMES = `(() => document.querySelectorAll('#games-section .games-row').length)()`;
  assert(await evaluate(NAMES) === 14, `1-5: 14 rows (10 on the slate + 4 not on it), each game exactly once (${await evaluate(NAMES)})`);

  // the detectors — plain page functions, run again for each viewport / mode / anti-vacuity stylesheet
  const LISTMEASURE = `(() => {
    const px = (v) => parseFloat(v) || 0;
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const sec = document.getElementById('games-section'); const rows = [...sec.querySelectorAll('.games-row')];
    const on = rows.find(r => r.getAttribute('data-row-state') === 'on'), off = rows.find(r => r.getAttribute('data-row-state') === 'off');
    const cs = getComputedStyle(on);
    const btns = [...sec.querySelectorAll('.games-row-btn, .games-ctl, .lc-seg')].filter(b => b.offsetParent !== null);
    const gapOf = (parent, sel) => { const bs = [...parent.querySelectorAll(sel)].filter(b => b.offsetParent !== null).map(R); let g = Infinity;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], b = bs[j]; const dx = Math.max(a.l - b.r, b.l - a.r), dy = Math.max(a.t - b.b, b.t - a.b); g = Math.min(g, Math.max(dx, dy)); } return g === Infinity ? null : g; };
    const remove = on.querySelector('[data-action="row-remove"]'), mark = on.querySelector('.games-row-mark');
    const lossTok = (() => { const t = document.createElement('span'); t.style.color = 'var(--loss)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })();
    const winTok = (() => { const t = document.createElement('span'); t.style.color = 'var(--win)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })();
    const cardTok = (() => { const t = document.createElement('span'); t.style.color = 'var(--bg-card)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })();
    const seg = [...sec.querySelectorAll('.lc-seg')];
    const controls = document.getElementById('games-controls'), segs = document.getElementById('games-segs');
    const nextAfterControls = controls.nextElementSibling;
    return {
      display: cs.display, dir: cs.flexDirection, gap: cs.rowGap, pt: px(cs.paddingTop), pl: px(cs.paddingLeft), radius: px(cs.borderTopLeftRadius), bg: cs.backgroundColor, cardTok, shadow: cs.boxShadow, mb: px(cs.marginBottom),
      opacity: cs.opacity, onOpacity: getComputedStyle(on).opacity, offOpacity: getComputedStyle(off).opacity,
      minBtn: btns.length ? Math.min(...btns.map(b => R(b).h)) : 0, nBtns: btns.length,
      rowBtnGap: gapOf(on, '.games-row-btn'), ctlGap: gapOf(controls, '.games-ctl'), segGap: gapOf(segs, '.lc-seg'),
      removeColor: remove ? getComputedStyle(remove).color : null, lossTok, markColor: mark ? getComputedStyle(mark).color : null, winTok, markSvg: mark && mark.querySelector('svg') ? R(mark.querySelector('svg')).w : 0, markDisplay: mark ? getComputedStyle(mark).display : null,
      segOnBg: getComputedStyle(seg.find(s => s.classList.contains('lc-seg-on'))).backgroundColor, segOffBg: getComputedStyle(seg.find(s => !s.classList.contains('lc-seg-on'))).backgroundColor,
      controlsBelow: nextAfterControls ? R(nextAfterControls).t - R(controls).b : null, segsMb: px(getComputedStyle(segs).marginBottom),
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      rowsInside: rows.every(r => R(r).l >= -0.5 && R(r).r <= innerWidth + 0.5),
      btnsInsideRow: [...on.querySelectorAll('.games-row-btn')].every(b => R(b).r <= R(on).r + 0.5 && R(b).l >= R(on).l - 0.5),
      matchupWraps: on.querySelector('.games-row-matchup') ? R(on.querySelector('.games-row-matchup')).r <= R(on).r + 0.5 : false,
      dq: (() => { const d = on.querySelector('.games-row-matchup .dq-badge'), e = on.querySelector('.games-row-meta .games-row-espn'); if (!d || !e) return null; const a = R(d), b = R(e), m = mark ? R(mark) : null, rr = R(on);
        const hit = (x, y) => !(x.r <= y.l || y.r <= x.l || x.b <= y.t || y.b <= x.t);
        return { badgeInside: a.l >= rr.l - 0.5 && a.r <= rr.r + 0.5, idInside: b.l >= rr.l - 0.5 && b.r <= rr.r + 0.5, badgeVsMark: m ? hit(a, m) : false, badgeH: a.h, idRem: Math.round(parseFloat(getComputedStyle(e).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize) * 100) / 100, idColor: getComputedStyle(e).color !== getComputedStyle(on.querySelector('.games-row-matchup')).color }; })(),
      groupHdrH: (() => { const h = sec.querySelector('.avail-group-header'); return h ? R(h).h : null; })(),
    };
  })()`;
  const listChecks = (m) => ({
    'a flex column': m.display === 'flex' && m.dir === 'column', 'gap 8': m.gap === '8px', 'padding 12/16': m.pt === 12 && m.pl === 16, 'radius >= 12': m.radius >= 12, 'card background (--bg-card)': m.bg === m.cardTok,
    'card shadow': m.shadow !== 'none', 'margin-bottom 8': m.mb === 8, 'nothing dimmed': m.onOpacity === '1' && m.offOpacity === '1', 'every control >= 44': m.minBtn >= 43.5 && m.nBtns >= 10,
    'buttons >= 8 apart': (m.rowBtnGap === null || m.rowBtnGap >= 8) && (m.ctlGap === null || m.ctlGap >= 8), 'segments distinct': m.segOnBg !== m.segOffBg, 'Remove is --loss': m.removeColor === m.lossTok,
    'On slate mark is --win': m.markColor === m.winTok, 'mark icon 10-16': m.markSvg >= 10 && m.markSvg <= 16 && ['flex', 'inline-flex'].includes(m.markDisplay), 'controls 16 below': m.controlsBelow !== null && m.controlsBelow >= 15.5 && m.segsMb === 16,
    'no horizontal overflow': !m.overflowX && m.rowsInside && m.btnsInsideRow, 'data-quality chip and ESPN id inside the row, clear of the On slate mark': !!m.dq && m.dq.badgeInside && m.dq.idInside && !m.dq.badgeVsMark && m.dq.idRem >= 0.6 && m.dq.idRem <= 0.8 && m.dq.idColor, 'group header >= 44': m.groupHdrH === null || m.groupHdrH >= 43.5,
  });
  const listOk = (m) => Object.values(listChecks(m)).every(Boolean);
  const explain = (m) => `${Object.entries(listChecks(m)).filter(([, v]) => !v).map(([k]) => 'FAILS: ' + k).join('; ') || 'every check holds'} — display ${m.display}/${m.dir}, gap ${m.gap}, padding ${m.pt}/${m.pl}, radius ${m.radius}, mb ${m.mb}, smallest control ${m.minBtn}, gaps row ${m.rowBtnGap} ctl ${m.ctlGap} seg ${m.segGap}, controls-below ${m.controlsBelow}, segs mb ${m.segsMb}, group header ${m.groupHdrH}, chip ${JSON.stringify(m.dq)}, mark svg ${m.markSvg} display ${m.markDisplay}`;

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[2] The list paints as cards, 44 pt controls, 8 pt apart, the destructive and the success colours from the tokens, nothing dimmed — and holds at 320 / 375 / 430 and 375 at double text…');
  // ═════════════════════════════════════════════════════════════════════════
  for (const scheme of ['light', 'dark']) {
    await evaluate(`document.body.setAttribute('data-color-scheme', ${JSON.stringify(scheme)}); document.documentElement.style.fontSize = ''`);
    for (const [w, scale] of [[320, 1], [375, 1], [430, 1], [375, 2]]) {
      await viewport(w);
      await evaluate(`document.documentElement.style.fontSize = '${scale * 100}%'; window.scrollTo(0, 0)`);
      await sleep(80);
      const m = await evaluate(LISTMEASURE);
      assert(listOk(m), `2-${scheme}-${w}x${scale}: ${scheme}, ${w} pt wide at ${scale}x text — ${explain(m)}`);
    }
  }
  await evaluate(`document.body.removeAttribute('data-color-scheme'); document.documentElement.style.fontSize = ''`);
  await viewport(375);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[3] The add-or-swap action sheet (a real tap on Add at 10): a fixed layer above everything, pinned to the bottom, 54 pt actions with a divider, a bold Cancel…');
  // ═════════════════════════════════════════════════════════════════════════
  const SHEET = `(() => {
    const L = document.getElementById('ls-action-layer'); if (!L) return null;
    const s = L.querySelector('.lc-actionsheet'), cs = getComputedStyle(L), ss = getComputedStyle(s), R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const acts = [...s.querySelectorAll('.lc-as-act')], first = acts[0], second = acts[1], cancel = s.querySelector('.lc-as-bold');
    const centre = (e) => { const r = R(e); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }; };
    const hit = (e) => { const c = centre(e); const h = document.elementFromPoint(c.x, c.y); return !!h && (h === e || e.contains(h)); };
    return { pos: cs.position, z: cs.zIndex, inset: [cs.top, cs.left, cs.right, cs.bottom].join(','), sheetPos: ss.position, left: R(s).l, right: innerWidth - R(s).r, bottom: innerHeight - R(s).b, top: R(s).t, width: R(s).w,
      actH: acts.map(a => R(a).h), n: acts.length, dividerTop: second ? getComputedStyle(second).borderTopWidth : null, cancelWeight: parseInt(getComputedStyle(cancel).fontWeight, 10), firstColor: getComputedStyle(first).color,
      hits: acts.every(hit) && hit(cancel), scrim: !!L.querySelector('.lc-scrim'), scrimCovers: (() => { const r = R(L.querySelector('.lc-scrim')); return r.w >= innerWidth - 1 && r.h >= innerHeight - 1; })(), title: L.querySelector('.lc-as-ttl')?.textContent };
  })()`;
  const sheetOk = (m) => !!m && m.pos === 'fixed' && m.z === '8100' && m.n === 3 && m.actH.every(h => h >= 53.5) && m.dividerTop === '1px' && m.cancelWeight >= 700 && m.hits && m.scrimCovers && m.left >= 7.5 && m.right >= 7.5 && m.bottom >= 9.5 && m.top >= 0 && m.width <= 375 - 15;
  assert(await tapSel('#games-section [data-action="row-add"]'), '3-1: a real tap landed on the first Not-on-slate row\'s Add');
  await waitFor(`document.getElementById('ls-action-layer')`);
  await waitForAnimations('#ls-action-layer');
  let sm = await evaluate(SHEET);
  assert(sheetOk(sm), `3-2: the choice sheet (2 actions + Cancel) — position ${sm?.pos}, z-index ${sm?.z} (above the wizard's 8000 and the picker's), margins L${sm?.left} R${sm?.right} B${sm?.bottom}, top ${sm?.top}, actions ${JSON.stringify(sm?.actH)} pt, divider ${sm?.dividerTop}, Cancel weight ${sm?.cancelWeight}, a tap at each action's centre hits it: ${sm?.hits}, scrim covers the screen: ${sm?.scrimCovers}`);
  assert(/The slate has 10 games/.test(sm?.title || ''), `3-3: the title reads "The slate has 10 games" (${sm?.title})`);
  await evaluate(`document.documentElement.style.fontSize = '200%'`); await sleep(120);
  sm = await evaluate(SHEET);
  assert(sheetOk({ ...sm, width: Math.min(sm.width, 360) }) && sm.top >= 0, `3-4: at double text the sheet still fits on screen and keeps its margins (top ${sm?.top}, bottom gap ${sm?.bottom}, actions ${JSON.stringify(sm?.actH)})`);
  await evaluate(`document.documentElement.style.fontSize = ''`); await sleep(80);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[4] The swap picker (a real tap on "Swap with a game on the slate"): a fixed bottom sheet over the page, 56 pt radio rows, the picks chip and warning, a 50 pt footer button…');
  // ═════════════════════════════════════════════════════════════════════════
  assert(await tapSel('#ls-action-layer .lc-as-act', 'Swap with a game'), '4-1: a real tap landed on "Swap with a game on the slate"');
  assert(await waitFor(`document.getElementById('swap-picker-sheet-wrap')`), '4-2: the picker opened (and the choice sheet closed)');
  await waitForAnimations('#swap-picker-sheet');
  await sleep(150);
  const PICKER = `(() => {
    const W = document.getElementById('swap-picker-sheet-wrap'); if (!W) return null;
    const S = document.getElementById('swap-picker-sheet'), B = document.getElementById('swap-picker-body'), F = document.getElementById('swap-picker-footer'), go = document.getElementById('swap-picker-go');
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const wc = getComputedStyle(W), sc = getComputedStyle(S), bc = getComputedStyle(B), fc = getComputedStyle(F), gc = getComputedStyle(go);
    const rows = [...B.querySelectorAll('.swap-pk-opt')], list = B.querySelector('.swap-pk-list'), adding = B.querySelector('.swap-pk-adding');
    const dot = rows[0].querySelector('.swap-pk-dot'), close = document.getElementById('swap-picker-close');
    const hit = (e) => { const r = R(e); const h = document.elementFromPoint(r.l + r.w / 2, r.t + r.h / 2); return !!h && (h === e || e.contains(h)); };
    return { wrapPos: wc.position, wrapZ: wc.zIndex, sheetBottom: Math.round(innerHeight - R(S).b), sheetH: R(S).h, maxH: sc.maxHeight, sheetRadiusTL: parseFloat(sc.borderTopLeftRadius),
      bodyOverflowY: bc.overflowY, bodyOverscroll: bc.overscrollBehaviorY, htmlOverflow: getComputedStyle(document.documentElement).overflow,
      rowH: rows.map(r => R(r).h), nRows: rows.length, rowsMin: Math.min(...rows.map(r => R(r).h)), listRadius: parseFloat(getComputedStyle(list).borderTopLeftRadius), listOverflow: getComputedStyle(list).overflow, listBorder: getComputedStyle(list).borderTopWidth,
      addingBg: getComputedStyle(adding).backgroundColor, addingRadius: parseFloat(getComputedStyle(adding).borderTopLeftRadius), dot: [R(dot).w, R(dot).h], dotBorder: getComputedStyle(dot).borderTopWidth, dotRadius: getComputedStyle(dot).borderTopLeftRadius,
      footBorder: fc.borderTopWidth, footPadTop: parseFloat(fc.paddingTop), goH: R(go).h, goW: R(go).w, footW: R(F).w, goDisabled: go.disabled, goOpacity: gc.opacity, goBg: gc.backgroundColor,
      closeSize: close ? [R(close).w, R(close).h] : null, grabber: !!S.querySelector('.sheet-grabber'), hitGo: hit(go), hitRow: hit(rows[3]), overflowX: document.documentElement.scrollWidth > innerWidth + 1 || B.scrollWidth > B.clientWidth + 1,
      chips: [...B.querySelectorAll('.swap-pk-picks')].map(c => ({ t: c.textContent, bg: getComputedStyle(c).backgroundColor, r: parseFloat(getComputedStyle(c).borderTopLeftRadius) })),
      scrollable: B.scrollHeight > B.clientHeight, bodyBottomClear: R(B).b <= R(F).t + 0.5,
      dotRight: R(dot).l >= R(rows[0].querySelector('.swap-pk-l')).r - 0.5, dotMid: Math.abs((R(dot).t + R(dot).h / 2) - (R(rows[0]).t + R(rows[0]).h / 2)) <= 4 };
  })()`;
  const pickerOk = (m) => !!m && m.wrapPos === 'fixed' && m.wrapZ === '8000' && m.sheetBottom <= 1 && m.bodyOverflowY === 'auto' && m.bodyOverscroll === 'contain' && m.htmlOverflow === 'hidden' && m.nRows === 10 && m.rowsMin >= 55.5
    && m.listRadius >= 12 && m.listOverflow === 'hidden' && m.listBorder === '1px' && m.addingRadius >= 12 && m.dot[0] === 22 && m.dot[1] === 22 && m.dotBorder === '2px' && m.dotRadius.includes('50%') === true
    && m.footBorder === '1px' && m.footPadTop === 16 && m.goH >= 49.5 && m.goW >= m.footW - 8.5 && m.goDisabled && Number(m.goOpacity) < 1 && !m.overflowX && m.bodyBottomClear && m.hitGo && m.chips.length === 2 && m.dotRight && m.dotMid;
  let pm = await evaluate(PICKER);
  assert(pickerOk({ ...pm, dotRadius: pm?.dotRadius || '' }), `4-3: the picker — wrap ${pm?.wrapPos} z ${pm?.wrapZ}, sheet bottom gap ${pm?.sheetBottom}, body overflow ${pm?.bodyOverflowY} / ${pm?.bodyOverscroll}, page locked (html overflow ${pm?.htmlOverflow}), rows ${pm?.nRows} x >= ${pm?.rowsMin} pt, list radius ${pm?.listRadius}, dot ${JSON.stringify(pm?.dot)} border ${pm?.dotBorder}, footer border ${pm?.footBorder} pad ${pm?.footPadTop}, Swap ${pm?.goW}x${pm?.goH} (footer ${pm?.footW}) disabled ${pm?.goDisabled} opacity ${pm?.goOpacity}, the dot sits right of the label (${pm?.dotRight}) and mid-row (${pm?.dotMid})`);
  assert(pm && pm.chips.every(c => c.bg !== 'rgba(0, 0, 0, 0)' && c.r >= 8) && pm.chips.map(c => c.t).sort().join() === '1 pick,3 picks', `4-4: the picks chips are pills with a fill (${JSON.stringify(pm?.chips)})`);
  assert(pm && pm.closeSize && pm.closeSize[0] >= 43.5 && pm.closeSize[1] >= 43.5 && !pm.grabber, `4-5: on web the header ✕ is a 44 pt target and there is no grabber (${JSON.stringify(pm?.closeSize)})`);
  assert(pm && pm.sheetH <= 844 * 0.82 + 2, `4-6: the sheet is clamped to 82% of the viewport (${Math.round(pm?.sheetH)} pt of 844; max-height ${pm?.maxH}) and the list scrolls inside it (${pm?.scrollable})`);
  // choose the game with 3 picks (row index 2) by a real tap, then read the footer
  assert(await evaluate(`(() => { const r = document.querySelectorAll('#swap-picker-body .swap-pk-opt')[2]; r.scrollIntoView({ block: 'center' }); return !!r; })()`) && await tapSel('#swap-picker-body .swap-pk-opt', 'Away 2'), '4-7: a real tap landed on the "Away 2 @ Home 2" row (3 picks)');
  const AFTER_SELECT = `(() => { const B = document.getElementById('swap-picker-body'), F = document.getElementById('swap-picker-footer'), go = document.getElementById('swap-picker-go'), sel = B.querySelector('.swap-pk-opt[aria-checked="true"]'), warn = F.querySelector('.swap-pk-warn');
    const R = (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right }; };
    return { selBg: sel ? getComputedStyle(sel).backgroundColor : null, otherBg: getComputedStyle(B.querySelector('.swap-pk-opt[aria-checked="false"]')).backgroundColor, dotBorder: sel ? getComputedStyle(sel.querySelector('.swap-pk-dot')).borderTopColor : null, otherDot: getComputedStyle(B.querySelector('.swap-pk-opt[aria-checked="false"] .swap-pk-dot')).borderTopColor,
      goText: go.textContent.trim(), goDisabled: go.disabled, goOpacity: getComputedStyle(go).opacity, warnDisplay: warn ? getComputedStyle(warn).display : null, warnSvg: warn && warn.querySelector('svg') ? R(warn.querySelector('svg')).w : 0, warnText: warn ? warn.textContent.trim() : '', warnBg: warn ? getComputedStyle(warn).backgroundColor : null,
      goInsideFooter: R(go).l >= R(F).l - 0.5 && R(go).r <= R(F).r + 0.5, warnAbove: !!warn && warn.getBoundingClientRect().bottom <= go.getBoundingClientRect().top + 0.5, goFull: R(go).w >= R(F).w - 8.5, selectedCount: B.querySelectorAll('.swap-pk-opt[aria-checked="true"]').length }; })()`;
  let am = await evaluate(AFTER_SELECT);
  assert(am.selectedCount === 1 && am.selBg !== am.otherBg && am.dotBorder !== am.otherDot && am.goText === 'Swap and delete 3 picks' && !am.goDisabled && Number(am.goOpacity) === 1,
    `4-8: choosing a row fills it (${am.selBg} vs ${am.otherBg}), its dot takes the accent, and the button enables as "${am.goText}" (opacity ${am.goOpacity})`);
  assert(am.warnDisplay === 'flex' && am.warnSvg >= 14 && am.warnSvg <= 18 && /3 submitted picks on Away 2 @ Home 2 will be deleted\./.test(am.warnText) && am.warnBg !== 'rgba(0, 0, 0, 0)' && am.goInsideFooter && am.warnAbove && am.goFull,
    `4-9: the picks warning is a flex box with a 16 pt icon and a fill, ABOVE the button (${am.warnAbove}), and the button is still full width under it (${am.goFull}) ("${am.warnText}")`);
  // swap for real
  const before = await evaluate(`import('./js/storage.js').then(s => ({ n: s.getGames(s.getCurrentWeek().weekId).length, picks: s.getPicks(s.getCurrentWeek().weekId).length }))`);
  assert(await tapSel('#swap-picker-go'), '4-10: a real tap landed on "Swap and delete 3 picks"');
  assert(await waitFor(`!document.getElementById('swap-picker-sheet-wrap')`, 4000), '4-11: the picker slid out and is gone');
  const afterSwap = await evaluate(`import('./js/storage.js').then(s => ({ n: s.getGames(s.getCurrentWeek().weekId).length, picks: s.getPicks(s.getCurrentWeek().weekId).length, names: s.getGames(s.getCurrentWeek().weekId).map(g => g.homeTeam) }))`);
  assert(afterSwap.n === 10 && afterSwap.picks === before.picks - 3 && !afterSwap.names.includes('Home 2') && afterSwap.names.includes('Home 20'), `4-12: the swap happened: still 10 games, Away 2 @ Home 2 and its 3 picks gone, the new game in (${JSON.stringify(afterSwap)})`);
  assert(await waitFor(`[...document.querySelectorAll('#toast-container .toast')].some(t => /Swapped Away 2 @ Home 2 for Away 20 @ Home 20\\./.test(t.textContent))`, 2500), '4-13: the toast names the swap');
  const toastTop = await evaluate(`(() => { const t = [...document.querySelectorAll('#toast-container .toast')].pop(); if (!t) return null; const r = t.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { visible: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight, top: !!h && (h === t || t.contains(h)) }; })()`);
  assert(toastTop && toastTop.visible && toastTop.top, '4-14: the toast is on screen and on TOP (a tap at its centre hits it)');
  const rowsAfter = await evaluate(NAMES);
  assert(rowsAfter === 14, `4-15: the list behind already shows the swap (still 14 rows: ${rowsAfter})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[5] Remove in place: the page does not jump, the row flips with a 150 ms fade, in the On slate segment it collapses (a real transition) and is then gone; Reduce Motion is instant…');
  // ═════════════════════════════════════════════════════════════════════════
  await evaluate(`window.scrollTo({ top: 400, behavior: 'instant' })`); await sleep(100);
  const y0 = await evaluate(`Math.round(scrollY)`);
  assert(y0 >= 100, `5-0: fixture — the page is scrolled down (${y0}) so a jump would be visible`);
  const target = await evaluate(`(() => { const r = document.querySelector('#games-section .games-row[data-key="e:E4"]'); r.scrollIntoView({ block: 'center', behavior: 'instant' }); window.__node4 = r; return Math.round(scrollY); })()`);
  await evaluate(`window.__anim = []; document.addEventListener('animationstart', (e) => window.__anim.push({ name: e.animationName, key: e.target.getAttribute && e.target.getAttribute('data-key'), dur: getComputedStyle(e.target).animationDuration }), true)`);
  assert(await tapSel('#games-section .games-row[data-key="e:E4"] [data-action="row-remove"]'), '5-1: a real tap on Remove for "Away 4 @ Home 4"');
  assert(await waitFor(`document.getElementById('ls-action-layer')`), '5-2: the remove sheet is up');
  await waitForAnimations('#ls-action-layer');
  const yBefore = await evaluate(`Math.round(scrollY)`);
  assert(await tapSel('#ls-action-layer .lc-as-danger'), '5-3: a real tap on "Remove from Slate"');
  await sleep(60);
  const flip = await evaluate(`(() => { const r = document.querySelector('#games-section .games-row[data-key="e:E4"]'); if (!r) return null; const a = window.__anim.find(x => x.name === 'games-row-flip' && x.key === 'e:E4'); return { state: r.getAttribute('data-row-state'), replaced: r !== window.__node4, animName: a ? a.name : 'none', hasAnim: !!a, dur: a ? a.dur : null, addBtn: !!r.querySelector('[data-action="row-add"]'), y: Math.round(scrollY) }; })()`);
  assert(flip && flip.state === 'off' && flip.replaced && flip.addBtn && Math.abs(flip.y - yBefore) <= 1, `5-4: the row flipped in place to its Not-on-slate form (state ${flip?.state}, new node ${flip?.replaced}) and the page did not jump (scrollY ${yBefore} -> ${flip?.y})`);
  assert(flip && flip.animName === 'games-row-flip' && flip.hasAnim && flip.dur === '0.15s', `5-5: the flip plays the 150 ms fade (--motion-fast), captured at its animationstart: animation "${flip?.animName}", duration ${flip?.dur}`);
  // On slate segment: collapse
  await evaluate(`document.querySelector('#games-segs [data-seg="on"]').click()`); await sleep(120);
  await evaluate(`(() => { const r = document.querySelector('#games-section .games-row[data-key="e:E6"]'); r.scrollIntoView({ block: 'center', behavior: 'instant' }); window.__node6 = r; })()`);
  assert(await tapSel('#games-section .games-row[data-key="e:E6"] [data-action="row-remove"]') && await waitFor(`document.getElementById('ls-action-layer')`), '5-6: Remove on "Away 6 @ Home 6" in the On slate segment');
  await waitForAnimations('#ls-action-layer');
  // D-1 (delta review, 2026-10-14): the collapse is caught when it STARTS, the way 5-5 catches the flip - never sampled "about 160 ms into" a 200 ms transition, which a loaded machine
  // can stretch past its end (1 solo run in 6 read an empty list). A capture-phase `transitionrun` listener records, at the moment each transition is created, the row, the property, whether
  // the row is marked leaving and still in the page, and the transition's own duration.
  await evaluate(`window.__trans = []; document.addEventListener('transitionrun', (e) => { const t = e.target; const a = t.getAnimations ? t.getAnimations().find((x) => x.transitionProperty === e.propertyName) : null;
    window.__trans.push({ key: t.getAttribute ? t.getAttribute('data-key') : null, prop: e.propertyName, leaving: !!(t.classList && t.classList.contains('is-leaving')), connected: t.isConnected, dur: a ? a.effect.getTiming().duration : null }); }, true)`);
  assert(await tapSel('#ls-action-layer .lc-as-danger'), '5-7: confirmed');
  assert(await waitFor(`window.__trans.some((t) => t.key === 'e:E6' && t.prop === 'opacity') && window.__trans.some((t) => t.key === 'e:E6' && t.prop === 'max-height')`, 3000), '5-7a: the collapse started (a max-height and an opacity transition were created on the row)');
  const coll = await evaluate(`(() => { const ts = window.__trans.filter((t) => t.key === 'e:E6'); return { props: ts.map((t) => t.prop), allLeaving: ts.every((t) => t.leaving), allConnected: ts.every((t) => t.connected), durs: [...new Set(ts.map((t) => t.dur))] }; })()`);
  assert(coll.allConnected && coll.allLeaving && coll.props.includes('max-height') && coll.props.includes('opacity') && coll.durs.length === 1 && coll.durs[0] === 200, `5-8: the row is collapsing: marked leaving and still in the page when its transitions start, a real max-height and opacity transition of 200 ms each (${JSON.stringify(coll)})`);
  assert(await waitFor(`!window.__node6.isConnected`, 2000), '5-9: after the collapse the row is gone from the page');
  // Reduce Motion: instant
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`(() => { const r = document.querySelector('#games-section .games-row[data-key="e:E7"]'); r.scrollIntoView({ block: 'center', behavior: 'instant' }); window.__node7 = r; })()`);
  assert(await tapSel('#games-section .games-row[data-key="e:E7"] [data-action="row-remove"]') && await waitFor(`document.getElementById('ls-action-layer')`), '5-10: Remove on "Away 7 @ Home 7" under Reduce Motion');
  await waitForAnimations('#ls-action-layer');
  assert(await tapSel('#ls-action-layer .lc-as-danger'), '5-11: confirmed');
  await sleep(40);
  assert(await evaluate(`!window.__node7.isConnected`), '5-12: under Reduce Motion the row is removed at once (no collapse)');
  await pg.send('Emulation.setEmulatedMedia', { features: [] });
  await evaluate(`document.querySelector('#games-segs [data-seg="all"]').click()`); await sleep(100);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[6] Stacking: the add-or-swap sheet is ABOVE the week wizard sheet (the manual add on Step 2), and a tap on its action hits the action…');
  // ═════════════════════════════════════════════════════════════════════════
  // the wizard works a DRAFT week: flip this one to draft, and top the slate back up to 10 (the swap kept 10, then three were removed above: add three back by storage so the choice sheet appears)
  await evaluate(`(async () => { const st = await import('./js/storage.js'), dm = await import('./js/data-model.js'); const w = st.getCurrentWeek().weekId; const base = Date.UTC(2026, 9, 17, 16, 0);
    st.saveWeek({ ...st.getWeeks().find(x => x.weekId === w), status: 'draft' });
    for (let i = 30; i < 33; i++) st.saveGame({ ...dm.createGame(w, { homeTeam: 'Home ' + i, awayTeam: 'Away ' + i, kickoff: new Date(base + i * 45 * 60000).toISOString(), kickoffConfirmed: true, spread: -3.5, favorite: 'Home ' + i, spreadSource: 'espn', espnEventId: 'E' + i }), gameId: 'g' + i }); })()`);
  await evaluate(`window.navigateTo('commissioner')`); await waitFor(`document.getElementById('week-wizard-entry-btn')`);
  await evaluate(`document.getElementById('week-wizard-entry-btn').click()`);
  assert(await waitFor(`document.getElementById('week-wizard-sheet-wrap')`), '6-1: the week wizard sheet opened over the page');
  await waitForAnimations('#week-wizard-sheet');
  for (let i = 0; i < 6; i++) { if (await evaluate(`!!document.getElementById('wiz-step2-add-manual')`)) break; await evaluate(`(() => { const b = [...document.querySelectorAll('#week-wizard-body button')].find(x => /^wiz-step\\d-back$/.test(x.id)); if (b) b.click(); })()`); await sleep(120); }
  assert(await evaluate(`!!document.getElementById('wiz-step2-add-manual')`), '6-2: the wizard is on Step 2 (Populate games)');
  assert(await evaluate(`/10 games on your slate/.test(document.getElementById('wiz-step2-count').textContent)`), '6-3: Step 2 shows "10 games on your slate" (the standing count line)');
  assert(await tapSel('#wiz-step2-add-manual'), '6-4: a real tap on "Add a game manually"');
  assert(await waitFor(`document.getElementById('ls-action-layer')`), '6-5: the choice sheet opened');
  await waitForAnimations('#ls-action-layer');
  const stack = await evaluate(`(() => { const L = document.getElementById('ls-action-layer'), W = document.getElementById('week-wizard-sheet-wrap'); const a = [...L.querySelectorAll('.lc-as-act')][0]; const r = a.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { layerZ: getComputedStyle(L).zIndex, wizZ: getComputedStyle(W).zIndex, hitAction: !!h && (h === a || a.contains(h)), after: L.compareDocumentPosition(W) }; })()`);
  assert(Number(stack.layerZ) > Number(stack.wizZ) && stack.hitAction, `6-6: the choice sheet (z ${stack.layerZ}) is above the wizard sheet (z ${stack.wizZ}) and a tap at its first action's centre hits the action`);
  assert(await tapSel('#ls-action-layer .lc-as-bold'), '6-7: Cancel');
  assert(await waitFor(`!document.getElementById('ls-action-layer')`), '6-8: Cancel closes the sheet; the wizard is still up, untouched');
  assert(await evaluate(`!!document.getElementById('week-wizard-sheet-wrap') && !document.getElementById('m-save')`), '6-9: …and no game form opened (nothing typed is lost)');
  // review F-3: the wizard's text buttons on the slate steps are 44 pt targets, none touches another, measured here (Step 2, Step 3, Step 3 empty)
  const WIZ_BTNS = `(() => { const body = document.getElementById('week-wizard-body'); const bs = [...body.querySelectorAll('button')].filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height > 0);
    const rs = bs.map((b) => ({ id: b.id || b.className.split(' ')[0], r: b.getBoundingClientRect() }));
    let gap = Infinity; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i].r, c = rs[j].r; const dx = Math.max(a.left - c.right, c.left - a.right), dy = Math.max(a.top - c.bottom, c.top - a.bottom); gap = Math.min(gap, Math.max(dx, dy)); }
    const by = (id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null; };
    return { n: rs.length, minH: Math.min(...rs.map((x) => x.r.height)), gap: gap === Infinity ? null : Math.round(gap * 10) / 10, addManual: by('wiz-step2-add-manual'), review: by('wiz-step2-review'), edit: by('wiz-step3-edit-in-games-tab'), backToAdd: by('wiz-step3-back-to-add'),
      removes: [...body.querySelectorAll('[data-wiz-remove]')].map((b) => b.getBoundingClientRect().height), overflowX: body.scrollWidth > body.clientWidth + 1 }; })()`;
  let wz = await evaluate(WIZ_BTNS);
  assert(wz.addManual >= 43.5 && wz.review >= 43.5 && wz.minH >= 33 && (wz.gap === null || wz.gap >= 7.5) && !wz.overflowX, `6-10 F-3 Step 2: "Add a game manually" ${wz.addManual} pt and "Review slate" ${wz.review} pt (both >= 44), the closest two buttons are ${wz.gap} pt apart (>= 8), no overflow`);
  assert(await tapSel('#wiz-step2-review'), '6-11: a real tap on "Review slate"');
  assert(await waitFor(`document.getElementById('wiz-step3-edit-in-games-tab')`), '6-12: Step 3 (Confirm slate) opened');
  await sleep(200);
  wz = await evaluate(WIZ_BTNS);
  assert(wz.edit >= 43.5 && wz.removes.length >= 10 && wz.removes.every((h) => h >= 43.5) && (wz.gap === null || wz.gap >= 7.5) && !wz.overflowX, `6-13 F-3 Step 3: "Edit slate in Games tab" ${wz.edit} pt, ${wz.removes.length} row Removes all >= 44 (smallest ${Math.min(...wz.removes)}), the closest two buttons are ${wz.gap} pt apart (>= 8)`);
  // the empty state ("Back to add games"): one game left, removed with real taps
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const w = st.getCurrentWeek().weekId; window.__keptGames = st.getGames(w); for (const g of window.__keptGames.slice(1)) st.deleteGame(g.gameId); })()`);
  await evaluate(`document.getElementById('wiz-step3-back').click()`); await sleep(150);
  assert(await tapSel('#wiz-step2-review') && await waitFor(`document.querySelectorAll('#week-wizard-body [data-wiz-remove]').length === 1`), '6-14: Step 3 with one game left');
  assert(await tapSel('#week-wizard-body [data-wiz-remove]') && await waitFor(`document.getElementById('ls-action-layer')`), '6-15: a real tap on that row\'s Remove raised the app\'s sheet');
  await waitForAnimations('#ls-action-layer');
  assert(await tapSel('#ls-action-layer .lc-as-danger'), '6-16: confirmed');
  assert(await waitFor(`document.getElementById('wiz-step3-back-to-add')`, 3000), '6-17: after the collapse Step 3 shows its empty state');
  await sleep(200);
  wz = await evaluate(WIZ_BTNS);
  assert(wz.backToAdd >= 43.5 && wz.edit >= 43.5 && (wz.gap === null || wz.gap >= 7.5), `6-18 F-3 Step 3 empty: "Back to add games" ${wz.backToAdd} pt and "Edit slate in Games tab" ${wz.edit} pt (>= 44), the closest two buttons are ${wz.gap} pt apart (>= 8)`);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); for (const g of window.__keptGames) st.saveGame(g); })()`);   // put the slate back for the sections below
  await evaluate(`document.getElementById('week-wizard-close').click()`);
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[7] Dark and Paper Dark: the rows stay readable (>= 4.5:1) and Paper Dark\'s rows are light paper cards…');
  // ═════════════════════════════════════════════════════════════════════════
  await openGames();
  const CONTRAST = `(() => {
    const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0.99) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const row = document.querySelector('#games-section .games-row[data-row-state="on"]');
    const pick = (sel) => { const e = row.querySelector(sel); return e ? ratio(parse(getComputedStyle(e).color), bgOf(e)) : null; };
    const card = parse(getComputedStyle(row).backgroundColor);
    return { matchup: pick('.games-row-matchup'), meta: pick('.games-row-meta'), cardLum: L(card), card: getComputedStyle(row).backgroundColor, text: getComputedStyle(row).color };
  })()`;
  // a look = a theme CLASS on <body> (applyTheme's own mechanism: exactly one theme-* class) and the Appearance axis (data-color-scheme)
  const look = (theme, scheme) => `(() => { const b = document.body; [...b.classList].forEach(c => { if (c.startsWith('theme-')) b.classList.remove(c); }); b.classList.add('theme-${theme}'); b.setAttribute('data-color-scheme', '${scheme}'); })()`;
  const looks = [['neutral dark', look('neutral', 'dark'), 'dark'], ['paper dark', look('paper', 'dark'), 'paper'], ['neutral light', look('neutral', 'light'), 'light']];
  for (const [name, setup, kind] of looks) {
    await evaluate(setup); await sleep(150);
    const c = await evaluate(CONTRAST);
    const lightCard = c.cardLum > 0.5;
    assert(c.matchup >= 4.5 && c.meta >= 4.5 && (kind === 'dark' ? !lightCard : lightCard), `7-${kind}: ${name} — the matchup reads ${c.matchup?.toFixed(2)}:1 and the caption ${c.meta?.toFixed(2)}:1 on ${c.card}${kind === 'paper' ? ' (a LIGHT paper card)' : ''}`);
  }
  // Paper on a phone set to dark with the Appearance axis left on System: the scope's OTHER trigger (the prefers-color-scheme media list, no data-color-scheme attribute)
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await evaluate(look('paper', 'dark') + `; document.body.removeAttribute('data-color-scheme')`); await sleep(150);
  const cs = await evaluate(CONTRAST);
  assert(cs.matchup >= 4.5 && cs.meta >= 4.5 && cs.cardLum > 0.5, `7-paper-system: Paper with System appearance on a dark phone — the matchup reads ${cs.matchup?.toFixed(2)}:1 and the caption ${cs.meta?.toFixed(2)}:1 on ${cs.card} (a LIGHT paper card: the media-query list names the row too)`);
  await pg.send('Emulation.setEmulatedMedia', { features: [] });
  await evaluate(look('neutral', 'light') + `; document.body.removeAttribute('data-color-scheme')`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[8] The other Comm tabs repaint ONCE, when the commissioner leaves Games after an in-place change (the real MutationObserver)…');
  // ═════════════════════════════════════════════════════════════════════════
  await openGames();
  // a clean baseline: earlier in-place changes left the other tabs stale; going to Week and back repaints them once (the observer under test), so "stale" starts false
  await evaluate(`document.querySelector('.comm-tab[data-comm-tab-btn="week"]').click()`); await sleep(300);
  await openGames();
  const stale0 = await staleNow();
  const addN = await evaluate(`document.querySelectorAll('#games-section .games-row[data-row-state="off"]').length`);
  assert(addN >= 1, `8-0: fixture — a Not-on-slate row exists (${addN})`);
  // make room under the size so the add is direct: remove two via storage then repaint, then tap Add
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const w = st.getCurrentWeek().weekId; for (const id of ['g30', 'g31']) st.deleteGame(id); window.navigateTo('commissioner'); })()`);
  await openGames();
  assert(await tapSel('#games-section [data-action="row-add"]'), '8-1: a real tap on Add (below the size: added at once, no sheet)');
  await sleep(150);
  const stale1 = await staleNow();
  assert(stale0 === false && stale1 === true, `8-2: the in-place add marks the other tabs stale (before ${stale0}, after ${stale1})`);
  const pageNode = await evaluate(`(window.__pageMarker = document.getElementById('page-commissioner').querySelector('.comm-tabbar'), !!window.__pageMarker)`);
  await evaluate(`document.querySelector('.comm-tab[data-comm-tab-btn="week"]').click()`);
  await sleep(300);
  const stale2 = await staleNow();
  const repainted = await evaluate(`document.getElementById('page-commissioner').querySelector('.comm-tabbar') !== window.__pageMarker && document.getElementById('page-commissioner').getAttribute('data-comm-active') === 'week'`);
  assert(pageNode && stale2 === false && repainted, `8-3: leaving Games to Week repainted the Comm page once (stale cleared: ${stale2 === false}, new tab bar: ${repainted}) and stayed on Week`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[9] ANTI-VACUITY: served with the new CSS block removed, the SAME detectors go red…');
  // ═════════════════════════════════════════════════════════════════════════
  const stripBlock = (css) => css.replace(/\/\* ═══ D1 W-68 \/ W-69 \(2026-10-14\)[\s\S]*?\/\* ═══ END D1 W-68 \/ W-69 [^\n]*\n/, '');
  cssTransform = stripBlock;
  await navigate();
  await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`);
  await waitFor(`document.querySelector('#page-home.active') && !document.querySelector('#home-root .home-feed[aria-busy="true"]')`, 12000);
  const okOld = await openGames();
  assert(okOld, '9-0: fixture — the Games list paints with the block removed');
  const mo = await evaluate(LISTMEASURE);
  assert(!listOk(mo) && mo.minBtn < 40 && mo.radius < 12, `9-1: with the new rules removed the list detector FAILS (smallest button ${mo.minBtn} pt, radius ${mo.radius}, shadow ${mo.shadow === 'none' ? 'none' : 'yes'}, card bg ${mo.bg === mo.cardTok}) — so [2] is a measurement, not a constant`);
  assert(await tapSel('#games-section [data-action="row-add"]'), '9-2: (still tappable)');
  const mo2 = await evaluate(`(() => { const s = document.getElementById('games-section'); return { cardLike: getComputedStyle(s.querySelector('.games-row')).boxShadow !== 'none' }; })()`);
  assert(mo2.cardLike === false, '9-3: …and the rows are not cards without the block (no shadow, no radius)');
  cssTransform = (css) => css.replace('#swap-picker-sheet-wrap{position:fixed;inset:0;z-index:8000}', '');
  await navigate();
  await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`);
  await waitFor(`document.querySelector('#page-home.active') && !document.querySelector('#home-root .home-feed[aria-busy="true"]')`, 12000);
  await openGames();
  // fill the slate to 10 again through storage so Add asks, then open the picker
  await evaluate(`(async () => { const st = await import('./js/storage.js'), dm = await import('./js/data-model.js'); const w = st.getCurrentWeek().weekId; const base = Date.UTC(2026, 9, 17, 16, 0);
    let n = st.getGames(w).length; for (let i = 40; n < 10; i++, n++) st.saveGame({ ...dm.createGame(w, { homeTeam: 'Home ' + i, awayTeam: 'Away ' + i, kickoff: new Date(base + i * 45 * 60000).toISOString(), kickoffConfirmed: true, spread: -3.5, favorite: 'Home ' + i, espnEventId: 'E' + i }), gameId: 'g' + i }); window.navigateTo('commissioner'); })()`);
  await openGames();
  await tapSel('#games-section [data-action="row-add"]');
  await waitFor(`document.getElementById('ls-action-layer')`); await waitForAnimations('#ls-action-layer');
  await tapSel('#ls-action-layer .lc-as-act', 'Swap with a game');
  await waitFor(`document.getElementById('swap-picker-sheet-wrap')`);
  await sleep(300);
  const pmo = await evaluate(PICKER);
  assert(!pickerOk(pmo) && pmo && pmo.wrapPos !== 'fixed', `9-4: with only the picker wrap's \`position:fixed; z-index:8000\` rule removed, the SAME picker detector FAILS (wrap position ${pmo?.wrapPos}, z ${pmo?.wrapZ}) — [4-3] is a measurement`);
} catch (e) {
  fail++; console.error('  ❌ the browser run did not complete:', e && e.message ? e.message : e);
} finally {
  try { engine?.proc.kill(); } catch { /* gone */ }
  server.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
console.log(`\n${fail ? '❌ FAILURES' : '✅ ALL PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
