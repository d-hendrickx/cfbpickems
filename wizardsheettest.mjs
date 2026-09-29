/**
 * CFB Pickems — wizardsheettest.mjs
 * =================================
 * ENGINE-MEASURED week-setup wizard sheet, driven through the REAL app: the
 * real index.html, css/styles.css and js/app.js booted in a real headless
 * Chromium, a commissioner session and a draft week seeded through the app's
 * OWN js/storage.js + js/data-model.js, the Commissioner tab opened, and the
 * wizard opened by clicking its real entry button. Nothing about the sheet,
 * its step content or the game modal is a fixture — both live bugs below were
 * reproduced this way before any fix existed.
 *
 *   [A] RG-282 (live v0.27.0 web, Drew 2026-09-28): "when you're in the week
 *       wizard on the web app, the actual wizard doesn't scroll up and down but
 *       the page behind it scrolls when you swipe up and down." The document
 *       stayed a live, user-scrollable root scroller underneath the
 *       position:fixed sheet, and the sheet's scroller had no
 *       overscroll-behavior — so EVERY gesture the sheet body did not itself
 *       consume chained to the page: a swipe on the header or the tracker, on
 *       the scrim, past either end of the list, or anywhere on a step whose
 *       content does not overflow (the "wizard doesn't scroll" half — there
 *       was nothing in it to scroll, so the page moved instead). Measured
 *       here: touch AND wheel, inside the list / past its end / on the header
 *       / on the scrim / on a short step, at 390×844 and on the ≥700px
 *       side-panel layout — the list moves when it has room, window.scrollY
 *       never moves; the page's own scroll position survives open→close
 *       untouched; the page scrolls again after close AND after the wrap is
 *       removed WITHOUT closeWeekWizardSheet() (the hold-teardown path); and
 *       gesturesSuspended() is true for exactly the life of the sheet.
 *
 *   [B] RG-283 (same report): "When you click into a game on the slate when
 *       building it pulls up an edit game option, but it pulls it up behind the
 *       wizard." showGameModal()'s .modal-overlay (z-index 200) was appended
 *       to <body> AFTER #week-wizard-sheet-wrap (z-index 8000) and painted
 *       under it. Measured here: after a REAL click on a slate row the modal
 *       is what a tap at its centre hits, its inputs take focus and text, the
 *       wizard stays mounted on the same step underneath, ✕ and a scrim tap
 *       close ONLY the modal, Esc never closes the sheet, and the z-index
 *       ladder (styles.css "Z-INDEX LADDER" block) holds as computed values —
 *       including that a modal NOT launched from a sheet stays at 200, under
 *       the control-center drawer (the S2-2 contract).
 *
 *   [C] RG-284 (found on [B]'s path, 2026-09-28): the wizard's Step 3 passed
 *       showGameModal() an onSave of `() => renderWeekWizardSheetBody()`,
 *       discarding the edited fields — showGameModal() never saves on its
 *       own (every other caller does `saveGame({...g, ...data})`). Hidden
 *       until now only because [B] made the modal unreachable; Drew's
 *       workaround (close the wizard, then Save in the uncovered modal) lost
 *       the edit the same way. Measured here: a spread entered through the
 *       real modal lands in storage signed home-perspective (AD-03), on the
 *       SAME game (no duplicate), and the wizard row repaints with it.
 *
 *   [C] continued, RG-286 (reviewer BLOCK on round 1, 2026-09-28): the modal
 *       filled its datetime-local kickoff from toISOString().slice(0,16) (UTC
 *       wall time) and read it back with new Date() (LOCAL), so a spread-only
 *       save moved the kickoff by the device's UTC offset — live on the Comm
 *       page editor all season, and newly reachable from the wizard by RG-284.
 *       Measured here UNDER A PINNED NON-UTC ZONE (America/Chicago — in UTC
 *       the bug is invisible): an untouched kickoff and every flag riding with
 *       it survive a spread-only save byte-for-byte, a TBD game stays TBD, the
 *       field shows local wall time, and a typed time is saved as that local
 *       time, confirmed, in one state.
 *
 *   [D] RG-287 (same review): Step 4's "Auto-Open At" had the identical
 *       fill/parse pair — every Step 4/Manage save moved a scheduled open by
 *       the UTC offset (hours late in the US). Untouched ⇒ byte-identical;
 *       typed ⇒ that local wall time.
 *
 *   [B] also pins RG-288: #toast-container (was 1000) under the sheets (8000)
 *       hid every toast fired while the wizard was up.
 *
 * TIMEZONE: the page runs under Emulation.setTimezoneOverride America/Chicago
 * whatever the host's TZ — asserted, not assumed (1-tz).
 *
 * The app boots in LOCAL (PIN) mode: this suite's own localhost server answers
 * /config.json with `{}` (the real config.json is never read or touched) and
 * 404s service-worker.js so no cache can serve stale code between the two
 * navigations. ALL other network resolution is blocked (fallback fonts, no
 * ESPN, no Supabase) — the assertions are layout/hit-test/scroll RELATIONS,
 * which do not depend on the font.
 *
 * Run: node wizardsheettest.mjs
 * Override the browser: WIZTEST_ENGINE=/path/to/Chromium (falls back to
 * SHELLTEST_ENGINE, NAVTEST_ENGINE, then the usual /Applications paths).
 * Mutation runs: WIZTEST_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree
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
const ROOT = process.env.WIZTEST_ROOT || here;
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
const override = process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: WIZTEST_ENGINE=/path/to/Chromium node wizardsheettest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (WIZTEST_ROOT — serving ${ROOT})`);

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
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-wizsheet-'));
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
const TZ = 'America/Chicago';
/** An instant's wall time in TZ as `YYYY-MM-DDTHH:MM`, computed in NODE (never
 *  by the helper under test). */
function wallInTz(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

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
  const SCROLLS = `({ list: document.getElementById('week-wizard-body')?.scrollTop ?? null, win: Math.round(scrollY) })`;
  const GEO = `(() => {
    const s = document.getElementById('week-wizard-sheet'), b = document.getElementById('week-wizard-body'), h = s.querySelector('.chat-sheet-header');
    const r = s.getBoundingClientRect(), br = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
    return { sheet: { l: r.left, t: r.top, r: r.right, b: r.bottom }, list: { t: br.top, b: br.bottom, ch: b.clientHeight, sh: b.scrollHeight },
      hdr: { x: hr.left + hr.width / 2, y: hr.top + hr.height / 2 }, vw: innerWidth, vh: innerHeight, docH: document.documentElement.scrollHeight };
  })()`;
  // The sheet slides up (`sheetUp`, 220ms) — measure only once it has landed.
  const settle = async () => {
    await waitFor(`(() => { const s = document.getElementById('week-wizard-sheet'); return s && s.getAnimations().length === 0 && getComputedStyle(s).transform === 'none'; })()`, 3000);
    await sleep(80);
  };
  // Park the page mid-document before every leak check, so a leak in EITHER
  // direction is visible (a page already at its max scroll cannot move and
  // would hide one). Programmatic scrolling stays allowed under the lock.
  const park = async () => { await evaluate(`window.scrollTo({ top: 200, behavior: 'instant' })`); await sleep(60); return evaluate(SCROLLS); };
  const openWizard = async () => {
    await evaluate(`window.navigateTo('commissioner')`);
    const found = await waitFor(`document.getElementById('week-wizard-entry-btn')`);
    if (!found) return false;
    await evaluate(`document.getElementById('week-wizard-entry-btn').click()`);   // the entry card is not under test
    const ok = await waitFor(`document.querySelector('#week-wizard-body [data-game-id], #week-wizard-body #wiz-step3-next, #week-wizard-body button')`);
    await settle();
    return ok;
  };

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Boot the REAL app (local mode), seed a commissioner + a draft week of 16 games, no spreads…');
  // ═════════════════════════════════════════════════════════════════════════
  await pg.send('Emulation.setTimezoneOverride', { timezoneId: TZ });
  await viewport(390, 844);
  await navigate();
  const tzSeen = await evaluate(`({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, off: new Date('2026-10-01T20:34:00Z').getTimezoneOffset() })`);
  assert(tzSeen.tz === TZ && tzSeen.off === 300,
    `1-tz: the page runs in ${TZ} (resolved "${tzSeen.tz}", UTC offset ${tzSeen.off} min on 2026-10-01) — a non-UTC zone, where a datetime-local round trip that mixes UTC and local shows up`);
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`),
    '1-0: fixture — the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const wk = dm.createWeek(2026, 5); wk.status = 'draft'; st.saveWeek(wk); st.setActiveWeekId(wk.weekId);
    // Kickoffs carry NON-ZERO SECONDS, so a minute-truncated round trip is
    // detectable even when it lands on the right minute. Every game also
    // carries the fields a spread-only edit must never touch (C-4).
    const base = new Date(Date.now() + 3 * 86400000); base.setUTCHours(20, 34, 17, 0);
    const kickoff = base.toISOString();
    for (let i = 0; i < 16; i++) st.saveGame(dm.createGame(wk.weekId, { homeTeam: 'Home ' + i, awayTeam: 'Away ' + i, kickoff, spread: null,
      kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening', lockedSpread: -2.5, espnEventId: '40199900' + i,
      homeLogo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/' + (100 + i) + '.png', awayLogo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/' + (200 + i) + '.png' }));
    // Game 2 is a genuine TBD (date known, time not): ESPN's midnight-Eastern placeholder.
    const tbd = st.getGames(wk.weekId)[2]; const ph = new Date(base); ph.setUTCHours(4, 0, 0, 0);
    st.saveGame({ ...tbd, kickoff: ph.toISOString(), kickoffConfirmed: false, kickoffDateOnly: true, timeWindow: 'morning' });
    // Game 15 becomes a pure manual, non-ESPN-linked game (DI-415, UN-370) —
    // every OTHER game here is ESPN-refreshable and DI-415 locks its kickoff
    // field to read-only display; the typed-kickoff tests (C-6/C-6b/C-7) need
    // ONE game the lock leaves fully editable. Kickoff/confirmed/dateOnly
    // stay whatever the loop above gave it — only the source fields change.
    const manual15 = st.getGames(wk.weekId)[15];
    st.saveGame({ ...manual15, isManual: true, espnSport: null, espnEventId: null });
    // Step 4's Auto-Open At, two days out, with seconds.
    const open = new Date(Date.now() + 2 * 86400000); open.setUTCHours(18, 5, 41, 0);
    st.saveWeek({ ...st.getWeeks().find(w => w.weekId === wk.weekId), picksOpenAt: open.toISOString() });
    st.setSession(null, true, false);
    await new Promise(r => setTimeout(r, 1200));   // storage.js's debounced write lands
    return { weekId: wk.weekId, games: st.getGames(wk.weekId).length, picksOpenAt: open.toISOString() };
  })()`);
  assert(seeded.games === 16, `1-1: fixture — 16 games seeded on a draft week through the app's own storage.js (got ${seeded.games})`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`),
    '1-2: fixture — after reload the app is past the site gate with a commissioner session');
  assert(await openWizard(), '1-3: fixture — the wizard sheet opened from its real entry button');
  const step3 = await evaluate(`({ title: document.getElementById('week-wizard-title')?.textContent, rows: document.querySelectorAll('#week-wizard-body [data-game-id]').length, parent: document.getElementById('week-wizard-sheet-wrap')?.parentElement?.tagName })`);
  assert(step3.rows === 16 && step3.parent === 'BODY',
    `1-4: fixture — it landed on Step 3 (Confirm slate + spreads) with all 16 rows, the wrap mounted on <body> (title "${step3.title}", rows ${step3.rows})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] RG-282 — the wizard scrolls; the page behind it never does (390×844, touch + wheel)…');
  // ═════════════════════════════════════════════════════════════════════════
  let g = await evaluate(GEO);
  assert(g.docH > g.vh + 400, `A-0: fixture — the Commissioner page behind the sheet is itself scrollable (document ${g.docH}px vs viewport ${g.vh}px), so a leak is observable`);
  assert(g.sheet.t >= 0 && g.sheet.b <= g.vh + 0.5 && g.list.sh > g.list.ch + 200,
    `A-1: the sheet is bounded inside the viewport (${g.sheet.t.toFixed(0)}…${g.sheet.b.toFixed(0)} of ${g.vh}) and its list overflows (${g.list.sh}px of content in ${g.list.ch}px) — there is something to scroll`);
  const listStyle = await evaluate(`(() => { const cs = getComputedStyle(document.getElementById('week-wizard-body')); return { oy: cs.overflowY, ob: cs.overscrollBehaviorY }; })()`);
  assert(listStyle.oy === 'auto', `A-2: the sheet list is the scroller (overflow-y ${listStyle.oy})`);
  assert(listStyle.ob === 'contain',
    `A-3: the sheet list CONTAINS its overscroll (overscroll-behavior-y "${listStyle.ob}") — its own rubber band stays, nothing chains to the page (WebKit's belt beside A-lock)`);
  const cx = (g.sheet.l + g.sheet.r) / 2, midY = (g.list.t + g.list.b) / 2;
  let a = await park();
  await swipe(cx, midY, -220);
  let b = await evaluate(SCROLLS);
  assert(b.list > a.list + 50 && b.win === a.win,
    `A-4: a finger swipe INSIDE the list scrolls the list (${a.list}→${b.list}) and not the page (window ${a.win}→${b.win})`);
  // Reach the end BY FINGER (as a player does), then start fresh gestures there.
  for (let i = 0; i < 4; i++) await swipe(cx, midY, -500);
  a = await park();
  await swipe(cx, midY, -400); await swipe(cx, midY, -400);
  b = await evaluate(SCROLLS);
  assert(b.win === a.win,
    `A-5: THE BUG — swiping on PAST the end of the list does not chain to the page (list ${a.list}→${b.list}, window ${a.win}→${b.win}; v0.27.0 moved the page ~300px)`);
  a = await park();
  await swipe(cx, midY, 2400);
  b = await evaluate(SCROLLS);
  assert(b.list === 0 && b.win === a.win, `A-6: swiping DOWN past the list's top returns it to 0 and does not pull the page with it (list ${b.list}, window ${a.win}→${b.win})`);
  a = await park();
  await swipe(g.hdr.x, g.hdr.y, -300);
  b = await evaluate(SCROLLS);
  assert(b.win === a.win, `A-7: THE BUG — a swipe starting on the sheet HEADER does not scroll the page (window ${a.win}→${b.win})`);
  a = await park();
  await swipe(g.vw / 2, Math.max(12, g.sheet.t / 2), -300);
  b = await evaluate(SCROLLS);
  assert(b.win === a.win, `A-8: THE BUG — a swipe on the dimmed SCRIM above the sheet does not scroll the page (window ${a.win}→${b.win})`);
  a = await park();
  await wheel(cx, midY, 300);
  b = await evaluate(SCROLLS);
  assert(b.list > a.list + 50 && b.win === a.win, `A-9: a mouse wheel over the list scrolls the list (${a.list}→${b.list}), not the page (window ${a.win}→${b.win})`);
  a = await park();
  await wheel(g.vw / 2, Math.max(12, g.sheet.t / 2), 400);
  b = await evaluate(SCROLLS);
  assert(b.win === a.win, `A-10: a wheel over the scrim does not scroll the page (window ${a.win}→${b.win})`);
  const susp = await evaluate(`import('./js/nav-gestures.js').then(m => m.gesturesSuspended())`);
  assert(susp === true, 'A-11: gesturesSuspended() is TRUE while the sheet is open — nav-hide, pull-to-refresh, week-swipe and bottom-bounce all stand down (nav-gestures.js)');

  // Header drag events still reach JS under the page lock — the native
  // drag-to-dismiss binder (bindSwipeToDismiss on the header, native-only)
  // depends on touchstart/touchmove arriving there; the lock is CSS-only.
  await evaluate(`(() => { window.__hdrTouch = 0; document.querySelector('#week-wizard-sheet .chat-sheet-header').addEventListener('touchmove', () => { window.__hdrTouch++; }, { passive: true }); })()`);
  await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.hdr.x, y: g.hdr.y }] });
  for (let i = 1; i <= 5; i++) await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.hdr.x, y: g.hdr.y + i * 20 }] });
  await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  const hdrTouch = await evaluate('window.__hdrTouch');
  assert(hdrTouch >= 3, `A-12: a downward drag on the header still delivers touchmove to the header's listeners (${hdrTouch} events) — the drag-to-dismiss handle is not starved by the page lock`);
  assert(await evaluate(`!!document.getElementById('week-wizard-sheet-wrap')`), 'A-13: …and on web that drag did not dismiss the sheet (the gesture is native-only by design; dismissal on web is ✕ / scrim)');

  // A step whose content does NOT overflow — Step 2 (Back from Step 3).
  await evaluate(`document.getElementById('wiz-step3-back')?.click()`);
  await waitFor(`!document.querySelector('#week-wizard-body [data-game-id]')`);
  await sleep(150);
  g = await evaluate(GEO);
  a = await park();
  await swipe((g.sheet.l + g.sheet.r) / 2, (g.list.t + g.list.b) / 2, -300);
  b = await evaluate(SCROLLS);
  assert(g.list.sh <= g.list.ch + 1 && b.win === a.win,
    `A-14: THE BUG, "the wizard doesn't scroll" half — on a SHORT step (content ${g.list.sh}px in ${g.list.ch}px, nothing to scroll) a swipe on the sheet leaves the page alone (window ${a.win}→${b.win})`);
  await evaluate(`document.getElementById('week-wizard-close').click()`);
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`);

  // The lock is scoped to the sheet's lifetime and keeps the page's position.
  await evaluate(`window.scrollTo({ top: 420, behavior: 'instant' })`);
  await sleep(100);
  const before = await evaluate('Math.round(scrollY)');
  await evaluate(`document.getElementById('week-wizard-entry-btn').click()`);
  await waitFor(`document.getElementById('week-wizard-sheet-wrap')`);
  await settle();
  const during = await evaluate('Math.round(scrollY)');
  await evaluate(`document.getElementById('week-wizard-close').click()`);
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`);
  await sleep(150);
  const after = await evaluate('Math.round(scrollY)');
  assert(before === 420 && during === before && after === before,
    `A-15: opening and closing the sheet never moves or resets the page's own scroll position (${before} → ${during} while open → ${after} after close)`);
  g = await evaluate(`({ vw: innerWidth, vh: innerHeight })`);
  a = await evaluate(SCROLLS);
  await swipe(g.vw / 2, g.vh / 2, -250);
  b = await evaluate(SCROLLS);
  assert(b.win > a.win + 50, `A-16: after ✕ the page scrolls again normally (window ${a.win}→${b.win}) — the lock is released`);
  assert(await evaluate(`import('./js/nav-gestures.js').then(m => m.gesturesSuspended() === false)`), 'A-17: …and gesturesSuspended() is false again');
  // Removed WITHOUT closeWeekWizardSheet() — the security hold's
  // tearDownRenderedContentForHold() sweeps [data-hold-teardown] nodes directly.
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await evaluate(`document.getElementById('week-wizard-entry-btn').click()`);
  await waitFor(`document.getElementById('week-wizard-sheet-wrap')`);
  await evaluate(`document.querySelectorAll('[data-hold-teardown]').forEach(n => n.remove())`);
  await sleep(150);
  a = await evaluate(SCROLLS);
  await swipe(g.vw / 2, g.vh / 2, -250);
  b = await evaluate(SCROLLS);
  assert(b.win > a.win + 50, `A-18: a wrap removed by the hold-teardown sweep (no close handler ran) leaves NO stuck lock — the page scrolls (window ${a.win}→${b.win})`);

  // The ≥700px side-panel layout (desktop web, phone landscape, iPad).
  await viewport(1024, 768);
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  assert(await openWizard(), 'A-19: fixture — the sheet reopens at 1024×768 (the side-panel layout)');
  g = await evaluate(GEO);
  a = await park();
  await wheel(g.sheet.l / 2, g.vh / 2, 400);
  b = await evaluate(SCROLLS);
  assert(g.sheet.l > 200 && b.win === a.win,
    `A-20: THE BUG, wide layout — a wheel over the scrim beside the side panel (panel at x ${g.sheet.l.toFixed(0)}) does not scroll the page (window ${a.win}→${b.win})`);
  a = await park();
  await wheel((g.sheet.l + g.sheet.r) / 2, (g.list.t + g.list.b) / 2, 400);
  b = await evaluate(SCROLLS);
  assert(b.list > a.list && b.win === a.win, `A-21: …while a wheel over the panel's list scrolls the list (${a.list}→${b.list}), not the page`);
  await evaluate(`document.getElementById('week-wizard-close').click()`);
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] RG-283 — the game editor opened FROM the sheet stacks ABOVE it (390×844)…');
  // ═════════════════════════════════════════════════════════════════════════
  await viewport(390, 844);
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  assert(await openWizard(), 'B-0: fixture — the sheet reopened on Step 3');
  const MODAL = `(() => {
    const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov) return null;
    const m = ov.querySelector('.modal'), r = m.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const hitTop = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    const wrap = document.getElementById('week-wizard-sheet-wrap');
    return { z: Number(getComputedStyle(ov).zIndex), wrapZ: wrap ? Number(getComputedStyle(wrap).zIndex) : null,
      title: ov.querySelector('.modal-header h3')?.textContent, hitInModal: !!(hit && m.contains(hit)), hitTopInModal: !!(hitTop && m.contains(hitTop)),
      hitIsSheet: !!(hit && wrap && wrap.contains(hit)), hitDesc: hit ? (hit.id || hit.className || hit.tagName) : null,
      w: r.width, h: r.height };
  })()`;
  const row = await evaluate(`(() => { const e = document.querySelectorAll('#week-wizard-body [data-game-id]')[1]; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.dataset.gameId }; })()`);
  await click(row.x, row.y);                                // a REAL click, through hit-testing
  assert(await waitFor(`document.querySelector('.modal-overlay')`, 3000), 'B-1: fixture — tapping a slate row opened the game modal (showGameModal, AD-03 Favorite + Margin)');
  const m1 = await evaluate(MODAL);
  assert(m1 && m1.z > m1.wrapZ, `B-2: the modal overlay stacks ABOVE the sheet wrap (z-index ${m1?.z} vs ${m1?.wrapZ}; v0.27.0 had 200 vs 8000)`);
  assert(m1 && m1.hitInModal && m1.hitTopInModal && !m1.hitIsSheet,
    `B-3: THE BUG — a tap at the modal's centre and on its title bar lands IN the modal, not on the wizard (hit: ${m1?.hitDesc}; "${m1?.title}")`);
  const marg = await evaluate(`(() => { const e = document.getElementById('m-spread-margin'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await click(marg.x, marg.y);
  await sleep(100);
  await pg.send('Input.insertText', { text: '3.5' });
  const typed = await evaluate(`({ focused: document.activeElement?.id, value: document.getElementById('m-spread-margin')?.value })`);
  assert(typed.focused === 'm-spread-margin' && typed.value === '3.5',
    `B-4: the modal is interactive — a real tap focuses the margin field and it takes typed text (focused #${typed.focused}, value "${typed.value}")`);
  const under = await evaluate(`({ wrap: !!document.getElementById('week-wizard-sheet-wrap'), rows: document.querySelectorAll('#week-wizard-body [data-game-id]').length, title: document.getElementById('week-wizard-title')?.textContent })`);
  assert(under.wrap && under.rows === 16, `B-5: the wizard stays mounted underneath on the same step (Step 3, ${under.rows} rows, "${under.title}")`);
  await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(150);
  const esc = await evaluate(`({ wrap: !!document.getElementById('week-wizard-sheet-wrap'), modal: !!document.querySelector('.modal-overlay') })`);
  assert(esc.wrap, `B-6: Esc never closes the sheet out from under the modal (sheet mounted: ${esc.wrap}; modal still open: ${esc.modal} — no .modal-overlay has an Esc handler app-wide, pre-existing)`);
  const closeBtn = await evaluate(`(() => { const e = [...document.querySelectorAll('.modal-overlay')].pop().querySelector('#mc'); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, onTop: e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; })()`);
  assert(closeBtn.onTop, 'B-7a: the modal\'s ✕ is the topmost element at its own centre (tappable, not under the sheet)');
  await click(closeBtn.x, closeBtn.y);
  await sleep(150);
  const afterX = await evaluate(`({ modal: !!document.querySelector('.modal-overlay'), wrap: !!document.getElementById('week-wizard-sheet-wrap'), rows: document.querySelectorAll('#week-wizard-body [data-game-id]').length })`);
  assert(!afterX.modal && afterX.wrap && afterX.rows === 16, `B-7: the modal's ✕ (a real tap) closes ONLY the modal — back on the same wizard step (sheet ${afterX.wrap}, rows ${afterX.rows})`);
  await click(row.x, row.y);
  await waitFor(`document.querySelector('.modal-overlay')`, 3000);
  const scrim = await evaluate(`(() => { const ov = [...document.querySelectorAll('.modal-overlay')].pop(); const r = ov.querySelector('.modal').getBoundingClientRect(); const y = r.top > 24 ? r.top / 2 : (r.bottom + innerHeight) / 2; return { x: 8, y, isOverlay: document.elementFromPoint(8, y) === ov }; })()`);
  assert(scrim.isOverlay, `B-8: fixture — the point (8, ${scrim.y.toFixed(0)}) is the modal's own scrim (it is on top there, not the sheet's backdrop)`);
  await click(scrim.x, scrim.y);
  await sleep(150);
  const afterScrim = await evaluate(`({ modal: !!document.querySelector('.modal-overlay'), wrap: !!document.getElementById('week-wizard-sheet-wrap') })`);
  assert(!afterScrim.modal && afterScrim.wrap, `B-9: a tap on the modal's scrim closes ONLY the modal — the sheet stays (v0.27.0: the same tap hit the sheet's backdrop and closed the WIZARD)`);

  // The ladder, as computed values. `.modal-overlay` not launched from a sheet
  // must stay at 200 — UNDER the drawer (500/501): control-center.js S2-2
  // closes the drawer before opening one, and relies on that order.
  const ladder = await evaluate(`(() => {
    const z = el => el ? Number(getComputedStyle(el).zIndex) : null;
    const loose = document.createElement('div'); loose.className = 'modal-overlay';
    const wrap = document.getElementById('week-wizard-sheet-wrap');
    document.body.insertBefore(loose, wrap);            // mounted BEFORE the sheet: not launched from it
    const r = { header: z(document.querySelector('.app-header')), nav: z(document.querySelector('.bottom-nav')),
      looseModal: z(loose), ccScrim: z(document.getElementById('control-center-backdrop')), cc: z(document.getElementById('control-center')),
      toast: z(document.getElementById('toast-container')), sheet: z(wrap) };
    loose.remove();
    const fromSheet = document.createElement('div'); fromSheet.className = 'modal-overlay'; document.body.appendChild(fromSheet);
    r.fromSheet = z(fromSheet); fromSheet.remove();
    const gate = document.createElement('div'); gate.id = 'site-gate-overlay'; gate.style.display = 'none'; document.body.appendChild(gate);
    r.gate = z(gate); gate.remove();
    return r;
  })()`);
  assert(ladder.header === 100 && ladder.nav === 100, `B-10: ladder — header/nav at 100 (${ladder.header}/${ladder.nav})`);
  assert(ladder.looseModal === 200 && ladder.looseModal < (ladder.ccScrim ?? 500),
    `B-11: ladder — a modal NOT launched from a sheet stays 200, under the control-center drawer scrim 500 (${ladder.looseModal} < ${ladder.ccScrim ?? '500 (drawer not mounted in this session)'})`);
  assert(ladder.sheet === 8000, `B-12: ladder — bottom sheets at 8000 (${ladder.sheet})`);
  assert(ladder.fromSheet === 8100 && ladder.fromSheet > ladder.sheet && ladder.fromSheet < ladder.gate,
    `B-13: ladder — a modal mounted after the sheet sits at 8100: above sheets (8000), below the site gate (${ladder.gate}) (got ${ladder.fromSheet})`);
  assert(ladder.toast === 8200 && ladder.toast > ladder.fromSheet && ladder.toast < ladder.gate,
    `B-14: ladder — toasts at 8200: above sheets and a modal opened from one, below the site gate (got ${ladder.toast}; v0.27.0 had 1000, under the sheets)`);
  await evaluate(`window.showToast('RG-288 probe', 'info')`);
  await sleep(400);                                         // toast-in animation
  const toastHit = await evaluate(`(() => {
    const t = [...document.querySelectorAll('#toast-container .toast')].pop(); if (!t) return null;
    const r = t.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { inToast: !!(hit && t.contains(hit)), hit: hit ? (hit.id || hit.className || hit.tagName) : null, wrap: !!document.getElementById('week-wizard-sheet-wrap') };
  })()`);
  assert(toastHit && toastHit.wrap && toastHit.inToast,
    `B-15: RG-288 — a toast fired while the wizard is open is what a tap at its centre hits (hit: ${toastHit?.hit}) — not the wizard's scrim`);
  await evaluate(`document.querySelectorAll('#toast-container .toast').forEach(t => t.remove())`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] RG-284 — a spread entered in the wizard\'s game modal is SAVED (390×844)…');
  // ═════════════════════════════════════════════════════════════════════════
  await click(row.x, row.y);
  assert(await waitFor(`document.querySelector('.modal-overlay')`, 3000), 'C-0: fixture — the row\'s modal reopened');
  await evaluate(`(() => { const s = document.getElementById('m-spread-fav'); s.value = 'home'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const marg2 = await evaluate(`(() => { const e = document.getElementById('m-spread-margin'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await click(marg2.x, marg2.y);
  await evaluate(`document.getElementById('m-spread-margin').select()`);
  await pg.send('Input.insertText', { text: '3.5' });
  const save = await evaluate(`(() => { const e = document.getElementById('m-save'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await click(save.x, save.y);                              // a REAL tap on Save
  await waitFor(`!document.querySelector('.modal-overlay')`, 3000);
  await sleep(1200);                                        // debounced write
  const saved = await evaluate(`(async () => {
    const st = await import('./js/storage.js');
    const games = st.getGames('${seeded.weekId}');
    const gm = games.find(x => x.gameId === '${row.id}');
    const rowEl = document.querySelector('#week-wizard-body [data-game-id="${row.id}"]');
    return { count: games.length, spread: gm?.spread, favorite: gm?.favorite, home: gm?.homeTeam, weekId: gm?.weekId,
      rowText: rowEl?.textContent.replace(/\\s+/g, ' ').trim(), wrap: !!document.getElementById('week-wizard-sheet-wrap') };
  })()`);
  assert(saved.spread === -3.5 && saved.favorite === saved.home,
    `C-1: THE BUG — the edit is SAVED, signed home-perspective (AD-03): home favored by 3.5 ⇒ spread ${saved.spread}, favorite "${saved.favorite}" (v0.27.0 discarded it: spread stayed null)`);
  assert(saved.count === 16 && saved.weekId === seeded.weekId, `C-2: the SAME game was updated — no duplicate, same week (${saved.count} games)`);
  assert(saved.wrap && !/Set spread/.test(saved.rowText || ''),
    `C-3: the wizard stays open on Step 3 and the row repaints with the new line ("${saved.rowText}")`);

  // ── RG-286 — the kickoff round trip, under America/Chicago ────────────────
  const KEEP = ['kickoff', 'kickoffConfirmed', 'kickoffDateOnly', 'timeWindow', 'lockedSpread', 'homeLogo', 'awayLogo', 'espnEventId'];
  const readGame = (id) => evaluate(`import('./js/storage.js').then(st => st.getGames('${seeded.weekId}').find(x => x.gameId === ${JSON.stringify(id)}))`);
  const rowIds = await evaluate(`[...document.querySelectorAll('#week-wizard-body [data-game-id]')].map(e => e.dataset.gameId)`);
  const openRow = async (id) => {
    const p = await evaluate(`(() => { const e = document.querySelector('#week-wizard-body [data-game-id="${id}"]'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(p.x, p.y);
    // DI-415 (UN-370) locks an ESPN-refreshable game's kickoff field to
    // read-only display — #m-kickoff no longer renders for those games at
    // all. #m-save renders unconditionally, locked or not.
    return waitFor(`document.querySelector('.modal-overlay #m-save')`, 3000);
  };
  const saveModal = async () => {
    const sv = await evaluate(`(() => { const e = document.getElementById('m-save'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(sv.x, sv.y);
    await waitFor(`!document.querySelector('.modal-overlay')`, 3000);
    await sleep(1200);
  };
  const setSpreadOnly = async (fav, margin) => {
    await evaluate(`(() => { const s = document.getElementById('m-spread-fav'); s.value = '${fav}'; s.dispatchEvent(new Event('change', { bubbles: true }));
      const m = document.getElementById('m-spread-margin'); m.value = '${margin}'; m.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  };
  // DI-415 (UN-370) REVIEWER ROUND 2 re-fixture — rowIds[15] is the seeded
  // manual, non-ESPN-linked game; every OTHER row is ESPN-refreshable and
  // DI-415 locks its kickoff to read-only display (no #m-kickoff at all).
  // C-6/C-6b/C-7 (typing a kickoff) move onto the manual game; C-4/C-5 stay
  // on ESPN games, which now prove the LOCKED path is byte-identical.
  const manualId = rowIds[15];

  // C-7 first (the field as shown), on the manual game, untouched so far.
  const g3 = await readGame(manualId);
  await openRow(manualId);
  const shown = await evaluate(`document.getElementById('m-kickoff').value`);
  assert(shown === wallInTz(g3.kickoff),
    `C-7: the kickoff field shows LOCAL wall time — ${g3.kickoff} in ${TZ} is "${wallInTz(g3.kickoff)}" (field shows "${shown}"; the UTC-wall fill showed "${g3.kickoff.slice(0, 16)}")`);
  await evaluate(`[...document.querySelectorAll('.modal-overlay')].forEach(o => o.remove())`);

  // C-4 — a spread-only edit on an ESPN-refreshable (now LOCKED) game leaves
  // its kickoff (and everything else DI-415 locks) byte-identical — proving
  // the LOCK, not merely the pre-DI-415 "an untouched field round-trips"
  // behavior (#m-kickoff does not even exist to leave untouched anymore).
  await openRow(rowIds[3]);
  await setSpreadOnly('away', '7');
  const before4 = await readGame(rowIds[3]);
  await saveModal();
  const after4 = await readGame(rowIds[3]);
  const changed = KEEP.filter(k => JSON.stringify(before4[k]) !== JSON.stringify(after4[k]));
  assert(after4.spread === 7 && changed.length === 0,
    `C-4: THE LOCK — a spread-only edit (away by 7 ⇒ spread ${after4.spread}) on an ESPN-refreshable (LOCKED) game leaves ${KEEP.join(', ')} byte-identical${changed.length ? ' — CHANGED: ' + changed.map(k => `${k} ${JSON.stringify(before4[k])} → ${JSON.stringify(after4[k])}`).join('; ') : ` (kickoff ${after4.kickoff})`}`);
  // C-5 — the TBD game (also ESPN-refreshable, also locked).
  const before5 = await readGame(rowIds[2]);
  await openRow(rowIds[2]);
  await setSpreadOnly('home', '1.5');
  await saveModal();
  const after5 = await readGame(rowIds[2]);
  assert(before5.kickoffDateOnly === true && after5.kickoffDateOnly === true && after5.kickoffConfirmed === false && after5.kickoff === before5.kickoff && after5.spread === -1.5,
    `C-5: a TBD (date-only), ESPN-refreshable (LOCKED) game STAYS TBD through a spread-only edit — kickoffDateOnly ${after5.kickoffDateOnly}, kickoffConfirmed ${after5.kickoffConfirmed}, kickoff ${before5.kickoff} → ${after5.kickoff}`);
  // C-6 — a typed time on the MANUAL (non-refreshable, unlocked) game is
  // that LOCAL time, confirmed, one state.
  await openRow(manualId);
  await evaluate(`(() => { const e = document.getElementById('m-kickoff'); e.value = '2026-10-10T14:30'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await saveModal();
  const after6 = await readGame(manualId);
  assert(after6.kickoff === '2026-10-10T19:30:00.000Z' && after6.kickoffConfirmed === true && after6.kickoffDateOnly === false && after6.timeWindow === 'afternoon',
    `C-6: typing 2:30 PM (Chicago, CDT) on the manual (unlocked) game saves 19:30Z, confirmed and NOT date-only (RG-57's one state), time window re-derived (kickoff ${after6.kickoff}, confirmed ${after6.kickoffConfirmed}, dateOnly ${after6.kickoffDateOnly}, window ${after6.timeWindow})`);
  await openRow(manualId);
  const reshown = await evaluate(`document.getElementById('m-kickoff').value`);
  assert(reshown === '2026-10-10T14:30', `C-6b: reopened, the manual game's field shows the time as typed ("${reshown}") — the round trip is stable`);
  await evaluate(`[...document.querySelectorAll('.modal-overlay')].forEach(o => o.remove())`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] RG-287 — Step 4 "Auto-Open At" round trip, under America/Chicago…');
  // ═════════════════════════════════════════════════════════════════════════
  const toStep4 = async () => {
    await evaluate(`document.getElementById('wiz-step3-next')?.click()`);
    return waitFor(`document.getElementById('wiz-picks-open-at')`, 3000);
  };
  assert(await toStep4(), 'D-0: fixture — Next from Step 3 lands on Step 4 (timing)');
  const openShown = await evaluate(`document.getElementById('wiz-picks-open-at').value`);
  assert(openShown === wallInTz(seeded.picksOpenAt),
    `D-1: Auto-Open At shows LOCAL wall time — ${seeded.picksOpenAt} in ${TZ} is "${wallInTz(seeded.picksOpenAt)}" (field "${openShown}")`);
  await evaluate(`document.getElementById('wiz-step4-next').click()`);
  await sleep(1200);
  const open1 = await evaluate(`import('./js/storage.js').then(st => st.getWeeks().find(w => w.weekId === '${seeded.weekId}').picksOpenAt)`);
  assert(open1 === seeded.picksOpenAt,
    `D-2: THE BUG — Next on an UNTOUCHED Auto-Open At keeps the scheduled open byte-identical (${seeded.picksOpenAt} → ${open1}; v0.27.0 moved it +5 h)`);
  await evaluate(`document.getElementById('week-wizard-close').click()`);
  await waitFor(`!document.getElementById('week-wizard-sheet-wrap')`);
  await evaluate(`document.getElementById('week-wizard-entry-btn').click()`);
  await waitFor(`document.getElementById('wiz-step3-next')`, 3000);
  assert(await toStep4(), 'D-3: fixture — back on Step 4 after reopening');
  await evaluate(`(() => { const e = document.getElementById('wiz-picks-open-at'); e.value = '2026-10-02T09:15'; e.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('wiz-step4-next').click(); })()`);
  await sleep(1200);
  const open2 = await evaluate(`import('./js/storage.js').then(st => st.getWeeks().find(w => w.weekId === '${seeded.weekId}').picksOpenAt)`);
  assert(open2 === '2026-10-02T14:15:00.000Z', `D-4: a typed 9:15 AM (Chicago, CDT) is saved as 14:15Z — the local wall time the commissioner meant (got ${open2})`);
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
