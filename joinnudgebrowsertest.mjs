/**
 * CFB Pickems — joinnudgebrowsertest.mjs (D1 / v0.30.0, DESIGN_D1_E: the join nudge in a REAL browser; Drew D-88, 2026-10-15; P-8 "styling is proven in a real browser")
 * ================================================================================================================================================================
 * ENGINE-MEASURED proof of the join nudge ("Want in?" under the newest tease card of a sport the member has not joined) and of the red Game Day card's "Join NFL picks": a real headless Chromium boots the
 * REAL app (index.html, css/styles.css, js/app.js) from this suite's own localhost server, in local mode, over a CFB + NFL league seeded through the page's own storage, the viewer a CFB-only member. Every
 * claim is a measured distance, a computed colour, a sampled pseudo-class or a real tap hit-tested by the engine - never a class name or a source grep.
 *
 *   [1]  VARIANT A (the NFL week is Open: a button), 375 pt wide, default text and the largest (1.35x), Light and Dark: exactly one nudge, right after the newest NFL card; a 44 pt button; an 8 pt text group;
 *        16 pt from the text group to the button; 16 pt of card padding on every side; the button inside the card by 16 pt each side; the chip leading; legible text (WCAG 4.5:1); no overflow, nothing clipped.
 *   [2]  VARIANT B (the NFL week is Locked: text only): the same geometry without a button, nothing tappable inside it.
 *   [3]  Not gold, not a due pill (the colours of a real commissioner nudge and a real due badge are read from probes and must differ), the button is the neutral tone, and at 700 pt the button group
 *        stops stretching and stays centred. Touch: pressed (:active) the button scales to about 97%.
 *   [4]  TOKEN COLOURS: every colour token re-pointed to two unrelated palettes; every painted colour of the nudge must move (a literal would stay put).
 *   [5]  REAL TAPS through the real dispatcher (CDP mouse events, hit-tested by the engine): the button opens the league overview focused on the NFL card and WRITES NOTHING; a forged data-sport is
 *        dropped and writes nothing; a touch that lands while the sheet is still arriving (Reduce Motion: a fade) still works; the sheet's Join joins, the toast says so, and the nudge is gone at the
 *        next Home paint with no reload.
 *   [6]  GAME DAY (the W-85 scene: CFB final, NFL open, the Now card on the NFL week): the red card says where the member stands and offers Join NFL picks, not Make picks; its size budget, tap targets
 *        and spacing hold at both phones, both text sizes, Light and Dark; its button is the same route; after the Join the card no longer offers it.
 *   [7]  ANTI-VACUITY (S-3, the encoded kit for this suite): each detector is re-run on the real page under an override sheet that breaks the one rule it measures, and must go RED.
 *
 * Fonts are deterministic: network resolution is blocked, so the web-font @import never loads and every run lays out with the same local fallbacks. The browser's zone is pinned. What only a device shows
 * (WebKit's own metrics, Dynamic Type's real steps, the press feel, the haptics, VoiceOver) is on the on-device checklist in the hand-off.
 *
 * Run:  node joinnudgebrowsertest.mjs     Override the browser: JOINNUDGE_ENGINE=/path/to/Chromium (falls back to SPORTGEO_ENGINE, SPACINGTEST_ENGINE, NAVTEST_ENGINE).
 *       JOINNUDGE_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree instead (a mutation kit does this; never point it at the checkout you are editing). A missing browser is a FAILURE, never a skip.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.JOINNUDGE_ROOT || here;
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
const fmt = (v) => String(JSON.stringify(v)).slice(0, 420);

console.log('\njoinnudgebrowsertest.mjs — the join nudge and the red card\'s Join button, engine-measured (computed geometry, computed colour, real taps)\n');

// ── [0] Engine and server ───────────────────────────────────────────────────────────────────────
console.log('[0] Engine…');
const ENGINES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'];
const override = process.env.JOINNUDGE_ENGINE || process.env.SPORTGEO_ENGINE || process.env.SPACINGTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find((p) => existsSync(p));
assert(!!bin && existsSync(bin), !bin ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: JOINNUDGE_ENGINE=/path/to/Chromium node joinnudgebrowsertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}` : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (JOINNUDGE_ROOT — serving ${ROOT})`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; }   // LOCAL mode: the real config.json is never read
  if (p === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  if (p.split('/').some((seg) => seg.startsWith('.')) || p.startsWith('/supabase/') || p === '/supabase') { res.writeHead(404); res.end(); return; }   // app files only: no dotfiles, nothing under /supabase/
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const tmp = mkdtempSync(join(tmpdir(), 'cfbp-joinnudge-'));
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio',
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
  let id = 0; const pending = new Map(); const waiters = [];
  sock.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) waiters.filter((w) => w.method === msg.method).forEach((w) => w.res());
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const myId = ++id; pending.set(myId, (m) => (m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result))); sock.send(JSON.stringify({ id: myId, method, params })); });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the in-page fixture: a CFB + NFL league written through the page's own localStorage before a reload; the viewer plays CFB only ──
const SEED = (o) => {
  const { viewer = 'p1', cfbW2 = 'open', nflW2 = 'open', activeWeek = 'w_cfb_2', plays = { nfl: ['p3'] } } = o || {};
  const L = 'L-nudge-0001';
  const CID = { cfb: '11111111-1111-4111-8111-111111111111', nfl: '22222222-2222-4222-8222-222222222222' };
  const NOW = Date.now(), H = 3600e3;
  const iso = (ms) => new Date(ms).toISOString();
  localStorage.clear();
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem('cfbp_site_unlocked', '1');
  localStorage.setItem('cfbp_supabase_active_league', L);
  const PLAYERS = [['p1', 'Drew', 'DH'], ['p2', 'Brayden', 'BR'], ['p3', 'Kevin', 'KC'], ['p4', 'Koby', 'KR']].map(([playerId, displayName, initials]) => ({ playerId, displayName, initials, active: true, pin: '1111', preferences: {} }));
  const comps = [], members = [], weeks = [], games = [], picks = [], results = [];
  const TEAMS = { cfb: [['Texas A&M', 'Alabama'], ['Notre Dame', 'Southern California'], ['Oklahoma', 'Texas']], nfl: [['Detroit Lions', 'Green Bay Packers'], ['Kansas City Chiefs', 'Buffalo Bills'], ['New York Jets', 'New York Giants']] };
  const status2 = { cfb: cfbW2, nfl: nflW2 };
  ['cfb', 'nfl'].forEach((sp, i) => {
    const cid = CID[sp];
    const optIn = Object.prototype.hasOwnProperty.call(plays, sp);
    comps.push({ id: cid, sport: sp, kind: 'season', enrollment: optIn ? 'opt_in' : 'all', isDefault: i === 0, archivedAt: null, activeWeekId: null, settings: {}, createdAt: `2026-0${i + 1}-01T00:00:00.000Z` });
    if (optIn) for (const m of plays[sp]) members.push({ id: `${cid}:${m}`, competitionId: cid, memberId: m, enrolledBy: 'self', joinedAt: '2026-09-01T00:00:00.000Z' });
    const w1 = `w_${sp}_1`, w2 = `w_${sp}_2`;
    const cf = i === 0 ? {} : { competitionId: cid };
    const mkWeek = (weekId, n, status) => ({ weekId, weekNumber: n, season: 2026, name: `Week ${n}`, status, dataSourceMode: 'live', startDate: '2026-10-08', endDate: '2026-10-12', picksOpenAt: null, picksLockAt: null, tiebreakerQuestion: 'Total points?',
      actualTiebreakerValue: null, showInHistory: true, blurb: `${sp.toUpperCase()} week ${n}: a blurb long enough to count for the open gate.`, extraPointEnabled: false, extraPointActual: null, extraPointDetect: null, autoLockOffsetMinutes: 30, ...cf });
    weeks.push(mkWeek(w1, 1, 'final'), mkWeek(w2, 2, status2[sp]));
    const mkGame = (weekId, gid, home, away, at, extra = {}) => ({ gameId: `${weekId}_${gid}`, weekId, espnEventId: null, dataQuality: 'manual', dataSource: 'manual', homeTeam: home, awayTeam: away, homeConference: '', awayConference: '', homeRank: null, awayRank: null,
      kickoff: iso(NOW + at * H), kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening', spread: -3.5, favorite: home, lockedSpread: null, homeScore: null, awayScore: null, status: 'scheduled', actualWinner: null, atsWinner: null,
      isAlmaMaterGame: false, spreadSource: 'manual', oddsProvider: null, lastUpdated: null, venue: null, venueDisplay: null, neutralSite: false, multiplier: 1, ...(sp === 'nfl' ? { espnSport: 'nfl' } : {}), ...extra });
    const [t1, t2, t3] = TEAMS[sp];
    const g1 = mkGame(w1, 'g1', t1[0], t1[1], -200, { status: 'final', homeScore: 28, awayScore: 21, actualWinner: t1[0], atsWinner: t1[0], lastUpdated: iso(NOW - 190 * H) });
    const done = status2[sp] === 'final';
    const g2 = mkGame(w2, 'g1', t2[0], t2[1], done ? -6 : 25, done ? { status: 'final', homeScore: 24, awayScore: 10, actualWinner: t2[0], atsWinner: t2[0], lockedSpread: -3.5, lastUpdated: iso(NOW - 3 * H) } : {});
    const g3 = mkGame(w2, 'g2', t3[0], t3[1], done ? -5 : 28, done ? { status: 'final', homeScore: 20, awayScore: 17, actualWinner: t3[0], atsWinner: t3[0], lockedSpread: -3.5, lastUpdated: iso(NOW - 2 * H) } : {});
    games.push(g1, g2, g3);
    const entrants = optIn ? plays[sp] : PLAYERS.map((p) => p.playerId);
    for (const m of (sp === 'cfb' ? ['p1', 'p2', 'p3', 'p4'] : ['p3'])) {
      if (!entrants.includes(m)) continue;
      for (const g of [g2, g3]) picks.push({ pickId: `pk_${g.gameId}_${m}`, weekId: w2, gameId: g.gameId, playerId: m, selectedTeam: g.homeTeam, submittedAt: iso(NOW - 5 * H) });
    }
    for (const m of entrants) {
      const home = m === 'p1' || m === 'p3';
      picks.push({ pickId: `pk_${w1}_${m}`, weekId: w1, gameId: g1.gameId, playerId: m, selectedTeam: home ? g1.homeTeam : g1.awayTeam, submittedAt: '2026-10-01T00:00:00.000Z' });
      results.push({ weekId: w1, playerId: m, rank: home ? 1 : 3, correctPicks: home ? 1 : 0, incorrectPicks: home ? 0 : 1, correctCount: home ? 1 : 0, incorrectCount: home ? 0 : 1, noDecisions: 0, isWinner: m === 'p1' || (sp === 'nfl' && m === 'p3'), isLoser: m === 'p2' });
    }
  });
  put('cfbp_competitions', comps); put('cfbp_competition_members', members); put('cfbp_players', PLAYERS); put('cfbp_weeks', weeks); put('cfbp_games', games);
  put('cfbp_picks', picks); put('cfbp_weekly_results', results); put('cfbp_session', { playerId: viewer, isAdmin: false, playerVerified: !!viewer }); put('cfbp_active_week', activeWeek);
  return { comps: comps.length, weeks: weeks.length, picks: picks.length, members: members.length };
};

// ── the in-page measurement library (installed on window.__jn after every load) ──
const LIB = String.raw`
(() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const shown = (e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const gap2 = (a, b) => { const dx = Math.max(0, Math.max(b.l - a.r, a.l - b.r)), dy = Math.max(0, Math.max(b.t - a.b, a.t - b.b)); return Math.hypot(dx, dy); };
  const minPair = (els) => { const rs = els.filter(shown).map(R); let m = Infinity; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.min(m, gap2(rs[i], rs[j])); return m === Infinity ? null : +m.toFixed(2); };
  const label = (e) => ((e.getAttribute('aria-label') || e.textContent || e.className || e.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 28);
  const CONTROLS = 'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea';
  const rgb = (s) => (String(s).match(/[\d.]+/g) || [0, 0, 0, 1]).map(Number);
  const over = (fg, bg) => { const f = rgb(fg), b = rgb(bg), a = f.length > 3 ? f[3] : 1; return [0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const la = lum(a), lb = lum(b); return +((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(2); };
  const geo = {
    R, shown, gap2, minPair, label, rgb, over, lum, contrast,
    q: (sel, root = document) => root.querySelector(sel),
    qa: (sel, root = document) => [...root.querySelectorAll(sel)],
    small(root, sel = CONTROLS) { return [...root.querySelectorAll(sel)].filter(shown).map((e) => ({ e, r: R(e) })).filter((x) => x.r.h < 43.5 || x.r.w < 43.5).map((x) => label(x.e) + ' ' + Math.round(x.r.w) + 'x' + Math.round(x.r.h)); },
    content(e) { const r = R(e), s = getComputedStyle(e); return { l: r.l + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft), r: r.r - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight), t: r.t + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop), b: r.b - parseFloat(s.borderBottomWidth) - parseFloat(s.paddingBottom) }; },
    clipped(e) { return e.scrollWidth > e.clientWidth + 1; },
    overflowX(root) {
      const rr = R(root); const vw = document.documentElement.clientWidth; const bad = [];
      for (const e of [root, ...root.querySelectorAll('*')]) { if (!shown(e)) continue; const r = R(e); if (r.r > Math.min(vw, rr.r) + 1 || r.l < Math.max(0, rr.l) - 1) bad.push(label(e) + ' [' + Math.round(r.l) + '..' + Math.round(r.r) + ']'); }
      return { scroll: root.scrollWidth - root.clientWidth, doc: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 4) };
    },
    probe(html) { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-9999px;top:0;width:300px'; d.innerHTML = html; document.body.appendChild(d); const el = d.firstElementChild; const s = getComputedStyle(el); const out = { bg: s.backgroundColor, bd: s.borderTopColor, color: s.color }; d.remove(); return out; },
    paints(root) {
      const out = [];
      const add = (e, prop, v) => { if (!v || /^rgba\(\d+, \d+, \d+, 0\)$/.test(v) || v === 'transparent' || v === 'none') return; out.push({ k: (e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\s+/)[0]) + ':' + prop, v }); };
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (!shown(e)) continue;
        const s = getComputedStyle(e);
        if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) add(e, 'color', s.color);
        add(e, 'background-color', s.backgroundColor);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s['border' + side + 'Width']) > 0 && !/none|hidden/.test(s['border' + side + 'Style'])) add(e, 'border-' + side.toLowerCase() + '-color', s['border' + side + 'Color']);
      }
      return out;
    },
    colorTokens() {
      const names = new Set();
      for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } const walk = (list) => { for (const r of list) { if (r.style) for (let i = 0; i < r.style.length; i++) { const n = r.style[i]; if (n.startsWith('--')) names.add(n); } if (r.cssRules) walk(r.cssRules); } }; walk(rules); }
      const cs = getComputedStyle(document.body);
      return [...names].filter((n) => { const v = cs.getPropertyValue(n).trim(); return v && CSS.supports('color', v) && !/^(inherit|initial|unset|currentcolor)$/i.test(v); });
    },
    palette(n) {
      document.getElementById('jn-palette')?.remove();
      if (!n) return 0;
      const toks = geo.colorTokens();
      const decl = toks.map((t, i) => t + ':rgb(' + ((i * 37 + n * 101) % 256) + ',' + ((i * 73 + n * 59) % 256) + ',' + ((i * 151 + n * 23) % 256) + ')!important').join(';');
      const st = document.createElement('style'); st.id = 'jn-palette'; st.textContent = '*,*::before,*::after{' + decl + '}'; document.head.appendChild(st);
      return toks.length;
    },
    mutant(css) { document.getElementById('jn-mutant')?.remove(); if (!css) return; const st = document.createElement('style'); st.id = 'jn-mutant'; st.textContent = css; document.head.appendChild(st); },
  };
  window.__jn = geo;
  return true;
})()`;

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const pg = await attach(engine.ws);
  await pg.send('Page.enable'); await pg.send('Runtime.enable');
  await pg.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Chicago' });
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 600));
    return r.result.value;
  };
  const inPage = (fn, arg = null) => evaluate(`(async () => { const g = window.__jn; return (${fn.toString()})(g, ${JSON.stringify(arg)}); })()`);
  const waitFor = async (expression, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await evaluate(`!!(${expression})`)) return true; await sleep(50); } return false; };
  const navigate = async () => { const loaded = pg.once('Page.loadEventFired'); await pg.send('Page.navigate', { url: ORIGIN + '/index.html' }); await loaded; };
  const viewport = async (w, h) => { await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await sleep(60); };
  const textScale = async (s) => { await evaluate(`document.documentElement.style.fontSize='${s === 1 ? '' : s * 100 + '%'}'`); await sleep(60); };
  const scheme = async (dark) => { await evaluate(`(() => { if (${dark}) document.body.dataset.colorScheme = 'dark'; else delete document.body.dataset.colorScheme; })()`); await sleep(450); };   // longer than the colour transitions (--transition, the scheme fade): a measure is of the settled paint
  const reduceMotion = (on) => pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
  const settle = () => evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(true), 40))))');
  const go = async (tab) => { await evaluate(`window.navigateTo(${JSON.stringify(tab)})`); await settle(); };
  const boot = async (seedOpts) => {
    await navigate();
    await waitFor('window.navigateTo || document.getElementById("site-gate-overlay")');
    const seeded = await evaluate(`(${SEED.toString()})(${JSON.stringify(seedOpts)})`);
    await navigate();
    const up = await waitFor('window.navigateTo && !document.getElementById("site-gate-overlay")', 10000);
    await evaluate(LIB);
    await go('home');
    await sleep(150);
    return { seeded, up };
  };
  const members = () => evaluate(`localStorage.getItem('cfbp_competition_members')`);
  // A REAL tap: scroll the element to the middle, check the engine's hit-test lands inside it (nothing covers it), then a mouse press and release at its centre.
  const pressAt = async (selector) => {
    const at = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, inside: !!hit && (hit === e || e.contains(hit)), hit: hit ? (hit.id || String(hit.className || hit.tagName)).slice(0, 40) : null }; })()`);
    return at;
  };
  const tap = async (selector, { settleAfter = true } = {}) => {
    const at = await pressAt(selector);
    if (!at) return { found: false };
    await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    if (settleAfter) { await settle(); await sleep(120); }
    return { found: true, inside: at.inside, hit: at.hit, x: Math.round(at.x), y: Math.round(at.y) };
  };
  const SIZES = [{ w: 375, h: 812, s: 1 }, { w: 375, h: 812, s: 1.35 }];
  const sz = (x, dark) => `${x.w}/${x.s}x/${dark ? 'dark' : 'light'}`;

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The measurers. Each returns plain numbers; the assertions read them, and [7] re-runs the SAME measurer under a mutant.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const M = {
    nudge: (g) => {
      const items = g.qa('#page-home .feed-item');
      const nudges = g.qa('#page-home .feed-join');
      const card = nudges[0];
      if (!card) return { missing: true, count: 0 };
      const idx = items.findIndex((i) => i.contains(card));
      const host = items[idx - 1] || null;
      const cs = getComputedStyle(card);
      const text = g.q('.feed-card-text', card), eyebrow = g.q('.feed-card-eyebrow', card), chip = g.q('.sport-chip', card), title = g.q('.feed-card-title', card), body = g.q('.feed-card-body', card);
      const actions = g.q('.feed-actions', card), btn = g.q('button', card);
      const cr = g.R(card), content = g.content(card), tr = g.R(text);
      const pad = { t: parseFloat(cs.paddingTop), r: parseFloat(cs.paddingRight), b: parseFloat(cs.paddingBottom), l: parseFloat(cs.paddingLeft) };
      const cardBg = cs.backgroundColor;
      const col = (e) => g.contrast(g.over(getComputedStyle(e).color, cardBg), g.rgb(cardBg).slice(0, 3));
      const out = {
        count: nudges.length, afterNfl: !!host && !!host.querySelector('[data-sport="nfl"]') && !host.querySelector('.feed-join'), key: items[idx] ? items[idx].getAttribute('data-card-key') : null,
        pad, cardW: +cr.w.toFixed(1),
        gaps: { chipToTitle: +(g.R(title).t - g.R(eyebrow).b).toFixed(2), titleToBody: +(g.R(body).t - g.R(title).b).toFixed(2), rowGap: cs.rowGap, textGap: getComputedStyle(text).rowGap },
        chipLead: +(g.R(chip).l - content.l).toFixed(2),
        titleContrast: col(title), bodyContrast: col(body),
        textToBtn: btn ? +(g.R(actions).t - tr.b).toFixed(2) : null,
        btn: null, buttons: g.qa('button, a, [role="button"], [data-home-action]', card).length,
        cardCursor: cs.cursor, role: card.getAttribute('role'), tabindex: card.getAttribute('tabindex'),
        clipped: [title, body].concat(btn ? [btn] : []).filter((e) => g.clipped(e)).map((e) => g.label(e)), overflow: g.overflowX(card), small: g.small(card),
        topInset: +(tr.t - cr.t).toFixed(2), bottomInset: +(cr.b - (btn ? g.R(btn).b : tr.b)).toFixed(2),
      };
      if (btn) {
        const br = g.R(btn), bs = getComputedStyle(btn);
        const btnBg = bs.backgroundColor;
        out.btn = { h: +br.h.toFixed(1), w: +br.w.toFixed(1), inL: +(br.l - cr.l).toFixed(2), inR: +(cr.r - br.r).toFixed(2), centerDev: +Math.abs((br.l + br.r) / 2 - (content.l + content.r) / 2).toFixed(2), bg: btnBg, bd: bs.borderTopColor, color: bs.color,
          textContrast: (() => { const opaque = g.over(btnBg, cardBg); return g.contrast(g.over(bs.color, 'rgb(' + opaque.join(',') + ')'), opaque); })(),
          label: btn.textContent.trim(), sport: btn.getAttribute('data-sport'), action: btn.getAttribute('data-home-action'), tab: btn.getAttribute('data-tab'), haptic: btn.getAttribute('data-haptic'), cls: btn.className };
      }
      return out;
    },
    colors: (g) => {
      const card = g.q('#page-home .feed-join'); const btn = card && g.q('button', card);
      return { gold: g.probe('<article class="card feed-card feed-nudge"></article>'), due: g.probe('<span class="badge badge-due">x</span>'), neutral: g.probe('<button class="btn feed-action feed-action--neutral">x</button>'),
        card: card ? { bg: getComputedStyle(card).backgroundColor, bd: getComputedStyle(card).borderTopColor } : null, btn: btn ? { bg: getComputedStyle(btn).backgroundColor, bd: getComputedStyle(btn).borderTopColor } : null };
    },
    gameDay: (g) => {
      const gdEl = document.getElementById('gd-card'); if (!gdEl) return { missing: true };
      const hdr = document.querySelector('.app-header'), nav = document.querySelector('.bottom-nav');
      const cardH = gdEl.getBoundingClientRect().height;
      const headerBottom = hdr ? hdr.getBoundingClientRect().bottom : 0, navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
      const windowH = navTop - headerBottom;
      const items = g.qa('.home-feed .feed-item');
      const nowIdx = items.findIndex((i) => i.contains(gdEl));
      const next = items[nowIdx + 1] || null;
      const nextTitle = next ? next.querySelector('.feed-card-title, .feed-card-body') : null;
      const btns = g.qa('.gd-msg button', gdEl).filter(g.shown);
      const tx = g.q('.gd-tx', gdEl);
      return {
        kind: gdEl.getAttribute('data-gd-kind'), cardH: +cardH.toFixed(1), windowH: +windowH.toFixed(1), ratio: +(cardH / windowH).toFixed(4), navTop: +navTop.toFixed(1),
        titleBottom: nextTitle ? +nextTitle.getBoundingClientRect().bottom.toFixed(1) : null, small: g.small(gdEl), btnGap: btns.length > 1 ? g.minPair(btns) : null,
        btnLabel: btns[0] ? btns[0].textContent.trim() : null, btnCount: btns.length, btnH: btns[0] ? +g.R(btns[0]).h.toFixed(1) : null, text: tx ? tx.textContent.replace(/\s+/g, ' ').trim() : '',
        nextShown: (() => { const nx = g.q('.gd-next', gdEl); return nx ? getComputedStyle(nx).display !== 'none' : null; })(), btnSport: btns[0] ? btns[0].getAttribute('data-sport') : null, btnTab: btns[0] ? btns[0].getAttribute('data-tab') : null, btnAction: btns[0] ? btns[0].getAttribute('data-home-action') : null,
        clipped: g.qa('.gd-tx b, .gd-tx span', gdEl).filter((e) => g.clipped(e)).length, overflow: g.overflowX(gdEl), vOverflow: gdEl.scrollHeight - gdEl.clientHeight,
      };
    },
  };
  const measure = (name, arg) => inPage(M[name], arg);
  const noOverflow = (o) => !!o && o.scroll <= 1 && o.doc <= 1 && o.bad.length === 0;
  const near = (v, t, d = 0.75) => typeof v === 'number' && Math.abs(v - t) <= d;

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] VARIANT A (the NFL week is Open) - exactly one nudge, right after the newest NFL card; geometry, legibility, Light and Dark, default and largest text…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const FIX_A = { viewer: 'p1', cfbW2: 'open', nflW2: 'open', activeWeek: 'w_cfb_2' };
  await viewport(375, 812);
  const ba = await boot(FIX_A);
  assert(ba.up && ba.seeded.comps === 2 && ba.seeded.members === 1, `[1-0] fixture: the real app booted on a CFB + NFL league seeded through its own storage; the viewer (p1) plays CFB only (${fmt(ba)})`);
  const sportsSeen = await evaluate(`[...document.querySelectorAll('#page-home .feed-item .sport-chip')].map((c) => c.textContent.trim())`);
  assert(sportsSeen.includes('NFL') && sportsSeen.includes('CFB'), `[1-0b] fixture: the Home feed teases the NFL (NFL cards are in the feed) beside the member's own CFB cards (chips: ${[...new Set(sportsSeen)].join(', ')})`);
  const A = {};
  for (const dark of [false, true]) {
    await scheme(dark);
    for (const x of SIZES) { await viewport(x.w, x.h); await textScale(x.s); await sleep(60); A[sz(x, dark)] = await measure('nudge'); }
  }
  await textScale(1); await scheme(false); await viewport(375, 812);
  const aAll = Object.entries(A);
  assert(aAll.every(([, m]) => !m.missing && m.count === 1 && m.key === 'join:nfl' && m.afterNfl), `[1-1] exactly ONE nudge (key join:nfl), directly after the newest NFL card, in all ${aAll.length} size/scheme combinations`);
  assert(aAll.every(([, m]) => m.pad.t >= 15.5 && m.pad.r >= 15.5 && m.pad.b >= 15.5 && m.pad.l >= 15.5), `[1-2] 16 pt of card padding on every side (${fmt(aAll[0][1].pad)})`);
  assert(aAll.every(([, m]) => m.btn && m.btn.h >= 43.5), `[1-3] the button is >= 44 pt tall at every size (${aAll.map(([k, m]) => k + ':' + (m.btn && m.btn.h)).join(' ')})`);
  assert(aAll.every(([, m]) => near(m.gaps.chipToTitle, 8) && near(m.gaps.titleToBody, 8) && m.gaps.textGap === '8px'), `[1-4] the text group is an 8 pt stack: chip -> title ${aAll[0][1].gaps.chipToTitle}, title -> body ${aAll[0][1].gaps.titleToBody}, row-gap ${aAll[0][1].gaps.textGap}`);
  assert(aAll.every(([, m]) => m.textToBtn >= 15.5 && m.textToBtn <= 16.5), `[1-5] 16 pt from the text group to the button (${aAll.map(([, m]) => m.textToBtn).join(', ')})`);
  assert(aAll.every(([, m]) => m.btn.inL >= 15.5 && m.btn.inR >= 15.5 && m.btn.centerDev <= 1 && m.bottomInset >= 15.5 && near(m.topInset, m.bottomInset, 1.5)), `[1-6] the button group is centred in the card: ${aAll[0][1].btn.inL}/${aAll[0][1].btn.inR} pt in from each side, ${aAll[0][1].topInset} above and ${aAll[0][1].bottomInset} below (equal space top and bottom)`);
  assert(aAll.every(([, m]) => near(m.chipLead, 0, 1)), `[1-7] the sport chip LEADS the card (it sits at the card's content edge, ${aAll[0][1].chipLead} pt in) like the commissioner nudge's label`);
  assert(aAll.every(([, m]) => m.titleContrast >= 4.5 && m.bodyContrast >= 4.5 && m.btn.textContrast >= 4.5), `[1-8] the words clear WCAG AA (4.5:1) on their own backgrounds, Light and Dark: ${aAll.map(([k, m]) => k + ' title ' + m.titleContrast + ' body ' + m.bodyContrast + ' button ' + m.btn.textContrast).join(' | ')}`);
  assert(aAll.every(([, m]) => m.clipped.length === 0 && noOverflow(m.overflow) && m.small.length === 0), `[1-9] nothing clips, nothing runs past the card or the screen, and every control is >= 44 pt (${aAll.map(([, m]) => m.clipped.length).join('')})`);
  assert(aAll.every(([, m]) => m.btn.label === 'Join NFL picks' && m.btn.sport === 'nfl' && m.btn.action === 'go-tab' && m.btn.tab === 'picks' && m.btn.haptic === 'light' && /feed-action--neutral/.test(m.btn.cls)), `[1-10] the button reads "Join NFL picks" and is the existing go-tab to picks with the sport (neutral tone, light haptic): ${fmt(aAll[0][1].btn.label)}`);
  const lightDark = [A[sz(SIZES[0], false)], A[sz(SIZES[0], true)]];
  assert(lightDark[0].btn.bg !== lightDark[1].btn.bg || lightDark[0].titleContrast !== lightDark[1].titleContrast, `[1-11] Dark really is a different paint (the button background or the text contrast moves: ${lightDark[0].btn.bg} -> ${lightDark[1].btn.bg})`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] VARIANT B (the NFL week is Locked) - the same words, no button, nothing tappable…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const FIX_B = { viewer: 'p1', cfbW2: 'open', nflW2: 'locked', activeWeek: 'w_cfb_2' };
  await viewport(375, 812);
  const bb = await boot(FIX_B);
  const Bm = {};
  for (const dark of [false, true]) {
    await scheme(dark);
    for (const x of SIZES) { await viewport(x.w, x.h); await textScale(x.s); await sleep(60); Bm[sz(x, dark)] = await measure('nudge'); }
  }
  await textScale(1); await scheme(false); await viewport(375, 812);
  const bAll = Object.entries(Bm);
  const bText = await evaluate(`document.querySelector('#page-home .feed-join')?.innerText.replace(/\\s+/g, ' ').trim()`);
  assert(bb.up && bAll.every(([, m]) => !m.missing && m.count === 1 && m.key === 'join:nfl' && m.afterNfl), `[2-1] Locked NFL week: still exactly one nudge, right after the newest NFL card (the tease exists in this window; FOMO is highest here)`);
  assert(bText === "NFL Want in? You're watching NFL from the sidelines. You can join when the next NFL week opens.", `[2-2] the words are the closed variant's, the sheet's own caption as the second sentence ("${bText}")`);
  assert(bAll.every(([, m]) => m.buttons === 0 && m.btn === null && m.cardCursor !== 'pointer' && m.role === null && m.tabindex === null), '[2-3] NO button and nothing tappable: no control, no role, no tabindex, no pointer cursor (plain text, never a dead end)');
  assert(bAll.every(([, m]) => m.pad.t >= 15.5 && m.pad.b >= 15.5 && m.pad.l >= 15.5 && m.pad.r >= 15.5 && near(m.gaps.chipToTitle, 8) && near(m.gaps.titleToBody, 8) && m.bottomInset >= 15.5 && m.clipped.length === 0 && noOverflow(m.overflow)), '[2-4] 16 pt padding, the 8 pt text stack, nothing clipped or overflowing - in all four combinations');
  assert(bAll.every(([, m]) => m.titleContrast >= 4.5 && m.bodyContrast >= 4.5), `[2-5] the words clear 4.5:1, Light and Dark (${bAll.map(([, m]) => m.bodyContrast).join(', ')})`);
  const beforeB = await members();
  const tB = await tap('#page-home .feed-join .feed-card-body');
  assert(tB.found && !(await evaluate(`!!document.getElementById('league-overview-sheet')`)) && (await members()) === beforeB, '[2-6] TAP: tapping the closed nudge does nothing (no sheet, nothing written)');

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] Not gold, not a due pill; the neutral button; a wide screen; the press…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  await boot(FIX_A);
  const col = await measure('colors');
  assert(col.card && col.card.bg !== col.gold.bg && col.card.bd !== col.gold.bd && col.card.bg !== col.due.bg, `[3-1] the card is neither the commissioner nudge's gold (${col.gold.bg} / ${col.gold.bd}) nor a due badge (${col.due.bg}): it is ${col.card && col.card.bg} / ${col.card && col.card.bd}`);
  assert(col.btn && col.btn.bg === col.neutral.bg && col.btn.bd === col.neutral.bd && col.btn.bg !== col.gold.bg, `[3-2] the button is the feed's neutral tone (${col.btn && col.btn.bg} = ${col.neutral.bg}), not gold`);
  await scheme(true);
  const colD = await measure('colors');
  assert(colD.card.bg !== colD.gold.bg && colD.btn.bg === colD.neutral.bg, '[3-3] ...and in Dark too');
  await scheme(false);
  await viewport(700, 900); await sleep(80);
  const wide = await measure('nudge');
  assert(wide.btn && wide.btn.w < wide.cardW - 120 && wide.btn.centerDev <= 1.5 && wide.btn.h >= 43.5, `[3-4] at 700 pt the button stops stretching (${wide.btn && wide.btn.w} pt of a ${wide.cardW} pt card) and stays centred (${wide.btn && wide.btn.centerDev} pt off)`);
  await viewport(375, 812); await sleep(80);
  // pressed: a real mouse press held on the button; the computed transform is read while :active, then the pointer is moved off before release (so no click)
  const pa = await pressAt('#page-home .feed-join button');
  await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pa.x, y: pa.y });
  await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pa.x, y: pa.y, button: 'left', clickCount: 1 });
  await sleep(320);
  const pressed = await evaluate(`(() => { const b = document.querySelector('#page-home .feed-join button'); const s = getComputedStyle(b); return { active: b.matches(':active'), transform: s.transform, duration: s.transitionDuration }; })()`);
  await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
  await sleep(320);
  const released = await evaluate(`getComputedStyle(document.querySelector('#page-home .feed-join button')).transform`);
  const scaleOf = (t) => { const m = /matrix\(([-\d.e]+),/.exec(t || ''); return m ? +m[1] : 1; };
  assert(pressed.active && near(scaleOf(pressed.transform), 0.97, 0.01), `[3-5] PRESSED (:active, a real held mouse press) the button compresses to about 97% (${pressed.transform})`);
  assert(scaleOf(released) === 1 && !(await evaluate(`!!document.getElementById('league-overview-sheet')`)), `[3-6] ...and returns to full size on release (${released}); a press released elsewhere opens nothing`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] TOKEN COLOURS: every colour token re-pointed to two unrelated palettes; every painted colour of the nudge must move…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const tokenRun = async (sel) => {
    const snap = () => inPage((g, s) => g.qa(s).flatMap((root) => g.paints(root).map((p) => ({ k: s + ' ' + p.k, v: p.v }))), sel);
    const tokens = await inPage((g) => g.palette(1)); await settle();
    const a = await snap();
    await inPage((g) => g.palette(2)); await settle();
    const b = await snap();
    await inPage((g) => g.palette(0)); await settle();
    const stillOut = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i].k === b[i].k && a[i].v === b[i].v) stillOut.push(`${a[i].k}=${a[i].v}`);
    return { tokens, painted: a.length, literal: [...new Set(stillOut)], aligned: a.length === b.length };
  };
  const tok = await tokenRun('#page-home .feed-join');
  assert(tok.tokens >= 40 && tok.painted >= 6 && tok.aligned, `[4-0] fixture: the sheet defines the colour tokens the palettes re-point (${tok.tokens}) and the nudge paints ${tok.painted} colours to compare`);
  assert(tok.literal.length === 0, `[4-1] every painted colour of the nudge follows the tokens (literal: ${tok.literal.slice(0, 4).join(' | ') || 'none'})`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] REAL TAPS through the real dispatcher - the button opens the sheet at the NFL card and writes NOTHING; a forged sport is dropped; a touch during the sheet\'s arrival works; Join joins; the nudge ends…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  await reduceMotion(false);
  await boot(FIX_A);
  const before = await members();
  const t1 = await tap('#page-home .feed-join button');
  const sheetUp = await waitFor('document.getElementById("league-overview-sheet")', 3000);
  await sleep(380);
  const focus = await evaluate(`document.querySelector('#league-overview-sheet .lo-card--focus')?.getAttribute('data-sport') || null`);
  const tabNow = await evaluate('document.body.dataset.tab');
  assert(t1.found && t1.inside && sheetUp && focus === 'nfl', `[5-1] TAP: the nudge's button opens the league overview focused on the NFL card (hit ${t1.hit}, focus ${focus})`);
  assert((await members()) === before, '[5-2] ...and NOTHING was written by the first tap: cfbp_competition_members is byte-for-byte what it was');
  assert(tabNow === 'home', `[5-3] ...Home stays underneath (the tab is still ${tabNow}); the member is not moved off the page he was reading`);
  const joinBtn = await evaluate(`(() => { const b = document.querySelector('#league-overview-sheet .lo-card[data-sport="nfl"] [data-lo-action="join"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })()`);
  assert(joinBtn && joinBtn.text === 'Join NFL picks' && !joinBtn.disabled, `[5-4] the sheet's own Join button is the same words as the nudge's (${fmt(joinBtn)})`);
  const t2 = await tap('#league-overview-sheet .lo-card[data-sport="nfl"] [data-lo-action="join"]');
  const joined = await waitFor(`JSON.parse(localStorage.getItem('cfbp_competition_members') || '[]').some((m) => m.memberId === 'p1' && m.competitionId === '22222222-2222-4222-8222-222222222222')`, 4000);
  const toast = await waitFor(`/You.re in NFL picks/.test(document.getElementById('toast-container')?.textContent || '')`, 3000);
  assert(t2.found && t2.inside && joined, `[5-5] TAP: the sheet's Join writes the member's own NFL row (hit ${t2.hit})`);
  assert(toast, '[5-6] ...and the toast says "You\'re in NFL picks."');
  await sleep(200);
  const nudgeAfter = await evaluate(`document.querySelectorAll('#page-home .feed-join').length`);
  assert(nudgeAfter === 0, `[5-7] the nudge is GONE at the next Home paint with no reload (${nudgeAfter} left), though the sheet is still up over Home`);
  // the forged sport
  await boot(FIX_A);
  const beforeF = await members();
  await evaluate(`document.querySelector('#page-home .feed-join button').setAttribute('data-sport', 'zzz')`);
  const tf = await tap('#page-home .feed-join button');
  await sleep(300);
  const afterF = { sheet: await evaluate(`!!document.getElementById('league-overview-sheet')`), tab: await evaluate('document.body.dataset.tab'), written: (await members()) !== beforeF };
  assert(tf.found && !afterF.sheet && !afterF.written, `[5-8] TAP: a FORGED data-sport is dropped by the dispatcher - no sheet for it, nothing written (the tap degrades to the button's plain Picks navigation: tab ${afterF.tab})`);
  // a touch that lands while the sheet is still ARRIVING: the page's animation clock is slowed to a tenth (CDP Animation.setPlaybackRate 0.1) so the sheet's 300 ms slide takes 3 s and is held mid-flight with
  // near-still geometry; once the Join button is on screen the engine's hit-test finds it where it is DRAWN and a real press goes through the real dispatcher
  await boot(FIX_A);
  await pg.send('Animation.enable');
  await pg.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
  const t3 = await tap('#page-home .feed-join button', { settleAfter: false });
  const armed = await waitFor('(() => { const b = document.querySelector("#league-overview-sheet .lo-card[data-sport=nfl] [data-lo-action=join]"); if (!b) return false; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()', 8000);
  const mid = await evaluate(`(() => { const sh = document.getElementById('league-overview-sheet'); const w = document.getElementById('league-overview-sheet-wrap'); const anims = [...(sh ? sh.getAnimations() : []), ...(w ? w.getAnimations() : [])];
    return { running: anims.filter((a) => a.playState === 'running' && a.effect && a.currentTime < a.effect.getComputedTiming().endTime).length, total: anims.length, transform: sh ? getComputedStyle(sh).transform : null }; })()`);
  const t4 = await tap('#league-overview-sheet .lo-card[data-sport="nfl"] [data-lo-action="join"]', { settleAfter: false });
  await pg.send('Animation.setPlaybackRate', { playbackRate: 1 });
  const joined2 = await waitFor(`JSON.parse(localStorage.getItem('cfbp_competition_members') || '[]').some((m) => m.memberId === 'p1' && m.competitionId === '22222222-2222-4222-8222-222222222222')`, 4000);
  assert(t3.found && armed && mid.running > 0 && t4.found && t4.inside && joined2, `[5-9] TAP: a touch that lands while the sheet is still arriving (${mid.running} of ${mid.total} animations in flight, transform ${mid.transform}, hit ${t4.hit}) still works - the Join went through`);
  await pg.send('Animation.disable');

  // a STALE nudge: the member joined on another device (or another tab) and Home has not repainted yet - the same tap then lands on that sport's Picks, the normal path (DI-E1.4)
  await boot(FIX_A);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.addCompetitionMember({ competitionId: '22222222-2222-4222-8222-222222222222', memberId: 'p1', enrolledBy: 'self' }); })()`);
  const staleStill = await evaluate(`document.querySelectorAll('#page-home .feed-join').length`);
  const ts = await tap('#page-home .feed-join button');
  await sleep(250);
  const stale = await evaluate(`(async () => ({ tab: document.body.dataset.tab, sheet: !!document.getElementById('league-overview-sheet'), sport: (await import('./js/competition.js')).getActiveSportKey() }))()`);
  assert(staleStill === 1 && ts.found && stale.tab === 'picks' && !stale.sheet && stale.sport === 'nfl', `[5-10] TAP: a STALE nudge (he joined elsewhere; Home has not repainted) lands on that sport's Picks, the normal path - no sheet, no second join (${fmt(stale)})`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] GAME DAY (the W-85 scene: CFB final, NFL open, the Now card on the NFL week) - the red card says where he stands and offers Join NFL picks…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const FIX_G = { viewer: 'p1', cfbW2: 'final', nflW2: 'open', activeWeek: 'w_nfl_2' };
  await viewport(375, 812);
  const bg = await boot(FIX_G);
  const G = {};
  for (const dark of [false, true]) {
    await scheme(dark);
    for (const ph of [{ w: 375, h: 812 }, { w: 375, h: 667 }]) {
      for (const s of [1, 1.35]) { await viewport(ph.w, ph.h); await textScale(s); await sleep(150); G[`${ph.h}/${s}x/${dark ? 'dark' : 'light'}`] = await measure('gameDay'); }
    }
  }
  await textScale(1); await scheme(false); await viewport(375, 812);
  const gAll = Object.entries(G);
  const g0 = gAll[0][1];
  assert(bg.up && gAll.every(([, m]) => !m.missing && m.kind === 'open-due'), `[6-1] fixture: the red card is the OPEN card of the NFL week for a CFB-only member (${gAll.map(([, m]) => m.kind).join(',')})`);
  assert(/you're not in NFL picks yet/.test(g0.text) && !/Make picks|have not picked|you have/.test(g0.text), `[6-2] it says where he stands and does not ask a non-player to pick: "${g0.text}"`);
  assert(gAll.every(([, m]) => m.btnCount === 1 && m.btnLabel === 'Join NFL picks' && m.btnAction === 'go-tab' && m.btnTab === 'picks' && m.btnSport === 'nfl'), `[6-3] its one button is "Join NFL picks": the existing go-tab to picks with the sport (${g0.btnLabel}, ${g0.btnAction}, ${g0.btnTab}, ${g0.btnSport})`);
  const worst = gAll.reduce((a, [k, m]) => (m.ratio > a.ratio ? { k, ratio: m.ratio } : a), { k: '', ratio: 0 });
  assert(gAll.every(([, m]) => m.ratio <= 0.33), `[6-4] SIZE BUDGET: the collapsed red card is never over 33% of the content window in ${gAll.length} measurements (2 phones x 2 text sizes x Light/Dark) - worst ${worst.k} ${(worst.ratio * 100).toFixed(1)}%`);
  const foldRows = gAll.map(([k, m]) => `${k}:${m.nextShown === null ? 'n/a' : m.nextShown ? 'shown' : 'folded'}`);
  assert(['812', '667'].every((h) => ['light', 'dark'].every((c) => G[`${h}/1x/${c}`].nextShown === true && G[`${h}/1.35x/${c}`].nextShown === false)), `[6-4b] the "you're not in NFL picks yet" clause shows at the default text size on both phones and FOLDS away at the largest text - exactly as the Final card's "Next:" does - where the wider "Join NFL picks" button leaves the column too narrow (${foldRows.join(' ')}); the button names the action either way`);
  assert(gAll.every(([, m]) => m.titleBottom !== null && m.titleBottom <= m.navTop), '[6-5] the first feed card\'s title is still above the tab bar under it (the beginning of the feed stays visible)');
  assert(gAll.every(([, m]) => m.small.length === 0 && m.btnH >= 43.5), `[6-6] every control in the card is >= 44 pt (the button ${gAll.map(([, m]) => m.btnH).join(', ')})`);
  assert(gAll.every(([, m]) => m.clipped === 0 && noOverflow(m.overflow) && m.vOverflow <= 1), '[6-7] nothing clips or overflows the card at any size');
  // the tap
  await boot(FIX_G);
  const beforeG = await members();
  const tg = await tap('#gd-card .gd-btn');
  const sheetG = await waitFor('document.getElementById("league-overview-sheet")', 3000);
  await sleep(380);
  const focusG = await evaluate(`document.querySelector('#league-overview-sheet .lo-card--focus')?.getAttribute('data-sport') || null`);
  assert(tg.found && tg.inside && sheetG && focusG === 'nfl' && (await members()) === beforeG, `[6-8] TAP: the red card's Join NFL picks opens the overview at the NFL card and writes nothing (focus ${focusG})`);
  await tap('#league-overview-sheet .lo-card[data-sport="nfl"] [data-lo-action="join"]');
  await waitFor(`JSON.parse(localStorage.getItem('cfbp_competition_members') || '[]').some((m) => m.memberId === 'p1')`, 4000);
  await sleep(300);
  const gdAfter = await measure('gameDay');
  assert(!gdAfter.missing && gdAfter.btnLabel !== 'Join NFL picks' && !/not in NFL/.test(gdAfter.text), `[6-9] after the Join the red card no longer offers it or says he is out (button "${gdAfter.btnLabel}", "${gdAfter.text}") - repainted with no reload`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] ANTI-VACUITY (S-3: this section is the kit): each detector, on the real page, under an override sheet that breaks the one rule it measures, must go RED…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const red = async (id, what, css, run, isRed) => {
    await inPage((g, c) => g.mutant(c), css); await settle(); await sleep(350);
    let m; try { m = await run(); } finally { await inPage((g) => g.mutant(null)); await settle(); await sleep(350); }
    const caught = isRed(m);
    assert(caught === true, `${id} MUTANT ${what} -> ${caught ? 'RED (caught)' : 'SURVIVED'}: ${fmt(m)}`);
  };
  await viewport(375, 812); await boot(FIX_A);
  const nudgeNow = () => measure('nudge');
  await red('[7-1]', 'card padding knocked down (.feed-join 16 -> 4 pt)', '.feed-join{padding:4px!important}', nudgeNow, (m) => !(m.pad.l >= 15.5 && m.pad.t >= 15.5));
  await red('[7-2]', 'the button shrunk (44 -> 30 pt)', '.feed-join .feed-action{min-height:30px!important;height:30px!important}', nudgeNow, (m) => !(m.btn.h >= 43.5) || m.small.length > 0);
  await red('[7-3]', 'the 16 pt between the text group and the button removed (.feed-join gap 16 -> 0)', '.feed-join{gap:0!important}', nudgeNow, (m) => !(m.textToBtn >= 15.5));
  await red('[7-4]', 'the 8 pt text stack removed (.feed-card-text gap 8 -> 0)', '.feed-join .feed-card-text{gap:0!important}', nudgeNow, (m) => !(near(m.gaps.chipToTitle, 8) && near(m.gaps.titleToBody, 8)));
  await red('[7-5]', 'the button pushed off-centre (the group justified to the start, the button not stretched)', '.feed-join .feed-actions{justify-content:flex-start!important}.feed-join .feed-action{flex:0 0 120px!important}', nudgeNow, (m) => !(m.btn.centerDev <= 1));
  await red('[7-6]', 'the chip pushed to the trailing edge (the other cards\' placement)', '.feed-join .sport-chip{margin-left:auto!important}', nudgeNow, (m) => !near(m.chipLead, 0, 1));
  await red('[7-7]', 'the card turned into the commissioner nudge\'s gold', '.feed-join{background:var(--gold-pale)!important;border-color:var(--gold)!important}', async () => measure('colors'), (m) => m.card.bg === m.gold.bg);
  await red('[7-8]', 'the button turned into a due-pill gold', '.feed-join .feed-action{background:var(--gold-pale)!important}', async () => measure('colors'), (m) => m.btn.bg === m.due.bg);
  await red('[7-9]', 'a literal colour on the card', '.feed-join{background:#c9a227!important}', async () => tokenRun('#page-home .feed-join'), (r) => r.literal.length > 0);
  await red('[7-10]', 'text low-contrast (body text a pale grey)', '.feed-join .feed-card-body{color:#c8c8c8!important}', nudgeNow, (m) => !(m.bodyContrast >= 4.5));
  await red('[7-11]', 'the press removed (:active does not scale)', '.feed-join .btn:active:not(:disabled){transform:none!important}', async () => {
    const pa2 = await pressAt('#page-home .feed-join button');
    await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pa2.x, y: pa2.y, button: 'left', clickCount: 1 });
    await sleep(320);
    const t = await evaluate(`getComputedStyle(document.querySelector('#page-home .feed-join button')).transform`);
    await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
    await sleep(200);
    return { transform: t, scale: scaleOf(t) };
  }, (m) => !near(m.scale, 0.97, 0.01));
  await red('[7-12]', 'the card overflowing the screen (a fixed 500 pt width)', '.feed-join{width:500px!important;max-width:none!important}', nudgeNow, (m) => !noOverflow(m.overflow));
  // the Game Day card
  await boot(FIX_G);
  const gdNow = () => measure('gameDay');
  await red('[7-13]', 'the red card\'s size budget broken (the message padded to 340 pt tall)', '#gd-card .gd-msg{min-height:340px!important}', gdNow, (m) => !(m.ratio <= 0.33));
  await red('[7-14]', 'the red card\'s button shrunk (44 -> 28 pt)', '#gd-card .gd-btn{min-height:28px!important;height:28px!important}', gdNow, (m) => m.small.length > 0 || !(m.btnH >= 43.5));
  await red('[7-16]', 'the fold removed (the clause never folds): on the smallest phone at the largest text the collapsed red card goes over its 33% cap', '.gd-next{display:inline!important}', async () => { await viewport(375, 667); await textScale(1.35); await sleep(80); const m = await measure('gameDay'); await textScale(1); await viewport(375, 812); return m; }, (m) => !(m.ratio <= 0.33));
  await red('[7-15]', 'the red card clipping its line (overflow hidden at one line)', '#gd-card .gd-tx span{white-space:nowrap!important;display:block!important;width:40px!important;overflow:hidden!important}', gdNow, (m) => m.clipped > 0);
} catch (e) {
  fail++; console.error('  ❌ the suite threw:', e && e.stack || e);
} finally {
  try { engine && engine.proc.kill(); } catch { /* gone */ }
  server.close();
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
