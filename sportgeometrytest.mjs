/**
 * CFB Pickems — sportgeometrytest.mjs (D1 / v0.30.0, thread 100726-D1; third pass item 2, P-8 / D-66 "styling is proven in a real browser")
 * ===================================================================================================================================
 * ENGINE-MEASURED proof of the multisport client's SURFACES: a real headless Chromium boots the REAL app (index.html, css/styles.css, js/app.js) from this
 * suite's own localhost server, in local mode, over a two-sport league seeded through the page's own storage, and every claim below is a measured distance,
 * a computed colour or a real tap hit-tested by the engine - never a class name or a source grep.
 *
 *   SURFACES   the sport switcher and its due dot (Picks, Dashboard with "All sports", Standings); the All sports view (its gate row and the .dc-sport-tag);
 *              Home's .sport-chip with the card's chevron; the header pill's due dot; the league overview sheet (member and commissioner); the Comm sport lens,
 *              in the ordinary state and with a SEPARATE lens and its caption (DI-534 REV 5); the Comm "All sports" card; the Add a sport sheet.
 *   SIZES      375 x 812 and 390 x 844, default text and 1.35x text (the root font size at 135%: every rem scales, the Dynamic Type stand-in gamedaybudgettest uses).
 *
 *   [1]..[6]   per surface: every control >= 44 pt; Breathing Room (8 pt in a group, 16 pt between groups and from a card or screen edge, a button never on a line);
 *              groups centred; no horizontal overflow; the switcher never wraps (one row at every size, its labels fit); the pill rows WRAP (and keep their gap) when the
 *              text is large; the due dots are 8 pt, inside their control, clear of the label.
 *   [7]        TOKEN COLOURS: every colour token in the sheet is re-pointed twice (two unrelated palettes, injected as one !important rule); every painted colour of every
 *              surface must MOVE between the two. A colour that stays put is a literal (or the UA's), whatever its class says.
 *   [8]        REAL TAPS through the app's own dispatcher (CDP mouse events at the element's centre, hit-tested by the engine): every new control on these surfaces does what
 *              it says - switch sport, All sports, the gate's "Make your picks", the pill, the overview's chips / cards / rows / close, a feed card, the Comm lens, a sport
 *              row's next action, the Add a sport radios and Cancel.
 *   [9]        ANTI-VACUITY (S-3, the encoded kit for this suite): each detector is re-run on the real page with an override sheet that breaks the one rule it measures,
 *              and must go RED - a padding knocked down, a target shrunk, a gap removed, a group pushed off-centre, the switcher allowed to wrap, the pills held on one
 *              line, a literal colour.
 *
 * Fonts are deterministic: network resolution is blocked, so the web-font @import never loads and every run lays out with the same local fallbacks. The browser's
 * zone is pinned (America/Chicago), so the dates the page prints do not depend on this Mac. What only a device shows (WebKit's own metrics, Dynamic Type's real
 * steps, the press feel, VoiceOver) is on the on-device checklist in the hand-off.
 *
 * Run:  node sportgeometrytest.mjs      Override the browser: SPORTGEO_ENGINE=/path/to/Chromium (falls back to SPACINGTEST_ENGINE, NAVTEST_ENGINE).
 *       SPORTGEO_ROOT=/path/to/a/COPY/of/cfb-pickems serves that tree instead (the mutation kit does this; never point it at the checkout you are editing).
 *       A missing browser is a FAILURE, never a skip.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.SPORTGEO_ROOT || here;
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
const fmt = (v) => String(JSON.stringify(v)).slice(0, 420);

console.log('\nsportgeometrytest.mjs — the multisport surfaces, engine-measured (computed geometry, computed colour, real taps)\n');

// ── [0] Engine and server ──────────────────────────────────────────────────────────────────────────────────────────────
console.log('[0] Engine…');
const ENGINES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'];
const override = process.env.SPORTGEO_ENGINE || process.env.SPACINGTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find((p) => existsSync(p));
assert(!!bin && existsSync(bin), !bin ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: SPORTGEO_ENGINE=/path/to/Chromium node sportgeometrytest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}` : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (ROOT !== here) console.log(`  (SPORTGEO_ROOT — serving ${ROOT})`);

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

const tmp = mkdtempSync(join(tmpdir(), 'cfbp-sportgeo-'));
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

// ── the in-page fixture: a league with one or two sports, written through the page's own localStorage before a reload (the shapes sportenv.mjs builds) ──
const SEED = (o) => {
  const { viewer = 'p1', isAdmin = false, sports = ['cfb', 'nfl'], plays = { nfl: ['p1', 'p3'] }, submitted = { cfb: ['p1', 'p2', 'p3', 'p4'], nfl: ['p3'] }, liveCfb = false, pointer = null } = o || {};
  const L = 'L-geo-0001';
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
  sports.forEach((sp, i) => {
    const cid = CID[sp];
    const optIn = Object.prototype.hasOwnProperty.call(plays, sp);
    comps.push({ id: cid, sport: sp, kind: 'season', enrollment: optIn ? 'opt_in' : 'all', isDefault: i === 0, archivedAt: null, activeWeekId: null, settings: {}, createdAt: `2026-0${i + 1}-01T00:00:00.000Z` });
    if (optIn) for (const m of plays[sp]) members.push({ id: `${cid}:${m}`, competitionId: cid, memberId: m, enrolledBy: 'self', joinedAt: '2026-09-01T00:00:00.000Z' });
    const w1 = `w_${sp}_1`, w2 = `w_${sp}_2`;
    const cf = i === 0 ? {} : { competitionId: cid };
    const mkWeek = (weekId, n, status) => ({ weekId, weekNumber: n, season: 2026, name: `Week ${n}`, status, dataSourceMode: 'live', startDate: '2026-10-08', endDate: '2026-10-12', picksOpenAt: null, picksLockAt: null, tiebreakerQuestion: 'Total points?',
      actualTiebreakerValue: null, showInHistory: true, blurb: `${sp.toUpperCase()} week ${n}: a blurb long enough to count for the open gate.`, extraPointEnabled: false, extraPointActual: null, extraPointDetect: null, autoLockOffsetMinutes: 30, ...cf });
    weeks.push(mkWeek(w1, 1, 'final'), mkWeek(w2, 2, sp === 'cfb' && liveCfb ? 'live' : 'open'));
    const mkGame = (weekId, gid, home, away, at, extra = {}) => ({ gameId: `${weekId}_${gid}`, weekId, espnEventId: null, dataQuality: 'manual', dataSource: 'manual', homeTeam: home, awayTeam: away, homeConference: '', awayConference: '', homeRank: null, awayRank: null,
      kickoff: iso(NOW + at * H), kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening', spread: -3.5, favorite: home, lockedSpread: null, homeScore: null, awayScore: null, status: 'scheduled', actualWinner: null, atsWinner: null,
      isAlmaMaterGame: false, spreadSource: 'manual', oddsProvider: null, lastUpdated: null, venue: null, venueDisplay: null, neutralSite: false, multiplier: 1, ...(sp === 'nfl' ? { espnSport: 'nfl' } : {}), ...extra });
    const [t1, t2, t3] = TEAMS[sp];
    const g1 = mkGame(w1, 'g1', t1[0], t1[1], -200, { status: 'final', homeScore: 28, awayScore: 21, actualWinner: t1[0], atsWinner: t1[0], lastUpdated: iso(NOW - 190 * H) });
    const live = sp === 'cfb' && liveCfb;
    const g2 = mkGame(w2, 'g1', t2[0], t2[1], live ? -1 : 25, live ? { status: 'live', homeScore: 7, awayScore: 3, lockedSpread: -3.5 } : {});
    const g3 = mkGame(w2, 'g2', t3[0], t3[1], 28);
    games.push(g1, g2, g3);
    const entrants = optIn ? plays[sp] : PLAYERS.map((p) => p.playerId);
    for (const m of (submitted[sp] || [])) {
      if (!entrants.includes(m)) continue;
      for (const g of [g2, g3]) picks.push({ pickId: `pk_${g.gameId}_${m}`, weekId: w2, gameId: g.gameId, playerId: m, selectedTeam: g.homeTeam, submittedAt: iso(NOW - 5 * H) });
    }
    for (const m of entrants) {
      const home = m === 'p1' || m === 'p3';
      picks.push({ pickId: `pk_${w1}_${m}`, weekId: w1, gameId: g1.gameId, playerId: m, selectedTeam: home ? g1.homeTeam : g1.awayTeam, submittedAt: '2026-10-01T00:00:00.000Z' });
      results.push({ weekId: w1, playerId: m, rank: home ? 1 : 3, correctPicks: home ? 1 : 0, incorrectPicks: home ? 0 : 1, correctCount: home ? 1 : 0, incorrectCount: home ? 0 : 1, noDecisions: 0, isWinner: m === 'p1', isLoser: m === 'p2' });
    }
  });
  put('cfbp_competitions', comps); put('cfbp_competition_members', members); put('cfbp_players', PLAYERS); put('cfbp_weeks', weeks); put('cfbp_games', games);
  put('cfbp_picks', picks); put('cfbp_weekly_results', results); put('cfbp_session', { playerId: viewer, isAdmin, playerVerified: !!viewer }); put('cfbp_active_week', `w_${sports[0]}_2`);
  if (pointer) put('cfbp_active_sport', { local: { [L]: pointer } });
  return { comps: comps.length, weeks: weeks.length, picks: picks.length };
};

// ── the in-page measurement library (installed on window.__geo after every load) ──
const LIB = String.raw`
(() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const shown = (e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const gap2 = (a, b) => { const dx = Math.max(0, Math.max(b.l - a.r, a.l - b.r)), dy = Math.max(0, Math.max(b.t - a.b, a.t - b.b)); return Math.hypot(dx, dy); };
  const minPair = (els) => { const rs = els.filter(shown).map(R); let m = Infinity; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.min(m, gap2(rs[i], rs[j])); return m === Infinity ? null : +m.toFixed(2); };
  const label = (e) => ((e.getAttribute('aria-label') || e.textContent || e.className || e.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 28);
  const CONTROLS = 'button, [role="button"], [role="radio"], a[href], input:not([type="hidden"]), select, textarea';
  const geo = {
    R, shown, gap2, minPair, label,
    q: (sel, root = document) => root.querySelector(sel),
    qa: (sel, root = document) => [...root.querySelectorAll(sel)],
    // every visible control under root smaller than 44 pt on either axis
    small(root, sel = CONTROLS) { return [...root.querySelectorAll(sel)].filter(shown).map((e) => ({ e, r: R(e) })).filter((x) => x.r.h < 43.5 || x.r.w < 43.5).map((x) => label(x.e) + ' ' + Math.round(x.r.w) + 'x' + Math.round(x.r.h)); },
    // distinct row tops of a set of items
    rows(els) { return new Set(els.filter(shown).map((e) => Math.round(R(e).t))).size; },
    // horizontal overflow: the root's own scroll, any descendant past the viewport or the root, and the document
    overflowX(root) {
      const rr = R(root); const vw = document.documentElement.clientWidth; const bad = [];
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (!shown(e)) continue;
        const r = R(e);
        if (r.r > Math.min(vw, rr.r) + 1 || r.l < Math.max(0, rr.l) - 1) bad.push(label(e) + ' [' + Math.round(r.l) + '..' + Math.round(r.r) + ']');
      }
      return { scroll: root.scrollWidth - root.clientWidth, doc: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 4) };
    },
    clipped(e) { return e.scrollWidth > e.clientWidth + 1; },
    // the inner content box of a container (its padding edge minus padding)
    content(e) { const r = R(e), s = getComputedStyle(e); return { l: r.l + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft), r: r.r - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight), t: r.t + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop), b: r.b - parseFloat(s.borderBottomWidth) - parseFloat(s.paddingBottom) }; },
    union(els) { const rs = els.filter(shown).map(R); return rs.length ? { l: Math.min(...rs.map((r) => r.l)), r: Math.max(...rs.map((r) => r.r)), t: Math.min(...rs.map((r) => r.t)), b: Math.max(...rs.map((r) => r.b)) } : null; },
    centerDev(els, box) { const u = geo.union(els); return u ? +Math.abs((u.l + u.r) / 2 - (box.l + box.r) / 2).toFixed(2) : null; },
    // the box of an element's own text (a Range over its direct text nodes): what a dot must not cover
    textBox(e) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()); if (!nodes.length) return null; const rg = document.createRange(); rg.setStartBefore(nodes[0]); rg.setEndAfter(nodes[nodes.length - 1]); const r = rg.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; },
    // how many LINES an element's own text runs to (its text nodes' line boxes, clustered by top): a pill that wraps INSIDE itself reads 2+
    textLines(e) { const tops = []; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.width > 0.5) tops.push(r.top); } tops.sort((x, y) => x - y); let lines = 0, last = -1e9; for (const t of tops) { if (t - last > 3) { lines++; last = t; } } return lines; },
    // vertical gap between consecutive shown children
    stackGaps(parent) { const kids = [...parent.children].filter(shown).map(R); const out = []; for (let i = 1; i < kids.length; i++) out.push(+(kids[i].t - kids[i - 1].b).toFixed(2)); return out; },
    // ── colour: the painted colours of a subtree (text, fills, borders that exist, SVG paint) ──
    paints(root, skip = '') {
      const out = [];
      const add = (e, prop, v) => { if (!v || /^rgba\(\d+, \d+, \d+, 0\)$/.test(v) || v === 'transparent' || v === 'none') return; out.push({ k: (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\s+/)[0]) + ':' + prop, v }); };
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (!shown(e) && !(e instanceof SVGElement)) continue;
        if (skip && e.closest(skip)) continue;
        const s = getComputedStyle(e);
        if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) add(e, 'color', s.color);
        add(e, 'background-color', s.backgroundColor);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s['border' + side + 'Width']) > 0 && !/none|hidden/.test(s['border' + side + 'Style'])) add(e, 'border-' + side.toLowerCase() + '-color', s['border' + side + 'Color']);
        if (e instanceof SVGElement && e.tagName.toLowerCase() !== 'svg') { if (s.stroke && s.stroke !== 'none') add(e, 'stroke', s.stroke); if (s.fill && s.fill !== 'none' && !/^rgb\(0, 0, 0\)$/.test(s.fill)) add(e, 'fill', s.fill); }
      }
      return out;
    },
    // every custom property the sheets define whose value is a colour (resolved on body)
    colorTokens() {
      const names = new Set();
      for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } const walk = (list) => { for (const r of list) { if (r.style) for (let i = 0; i < r.style.length; i++) { const n = r.style[i]; if (n.startsWith('--')) names.add(n); } if (r.cssRules) walk(r.cssRules); } }; walk(rules); }
      const cs = getComputedStyle(document.body);
      return [...names].filter((n) => { const v = cs.getPropertyValue(n).trim(); return v && CSS.supports('color', v) && !/^(inherit|initial|unset|currentcolor)$/i.test(v); });
    },
    // re-point every colour token at once (palette 0 = remove)
    palette(n) {
      document.getElementById('geo-palette')?.remove();
      if (!n) return 0;
      const toks = geo.colorTokens();
      const decl = toks.map((t, i) => t + ':rgb(' + ((i * 37 + n * 101) % 256) + ',' + ((i * 73 + n * 59) % 256) + ',' + ((i * 151 + n * 23) % 256) + ')!important').join(';');
      const st = document.createElement('style'); st.id = 'geo-palette'; st.textContent = '*,*::before,*::after{' + decl + '}'; document.head.appendChild(st);
      return toks.length;
    },
    mutant(css) { document.getElementById('geo-mutant')?.remove(); if (!css) return; const st = document.createElement('style'); st.id = 'geo-mutant'; st.textContent = css; document.head.appendChild(st); },
  };
  window.__geo = geo;
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
  const inPage = (fn, arg = null) => evaluate(`(async () => { const g = window.__geo; return (${fn.toString()})(g, ${JSON.stringify(arg)}); })()`);
  const waitFor = async (expression, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await evaluate(`!!(${expression})`)) return true; await sleep(100); } return false; };
  const navigate = async () => { const loaded = pg.once('Page.loadEventFired'); await pg.send('Page.navigate', { url: ORIGIN + '/index.html' }); await loaded; };
  let VW = 375, VH = 812, SCALE = 1;
  const viewport = async (w, h) => { VW = w; VH = h; await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await sleep(60); };
  const textScale = async (s) => { SCALE = s; await evaluate(`document.documentElement.style.fontSize='${s === 1 ? '' : s * 100 + '%'}'`); await sleep(60); };
  const settle = () => evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(true), 40))))');
  const go = async (tab) => { await evaluate(`window.navigateTo(${JSON.stringify(tab)})`); await settle(); };
  // Boot a fixture: seed, reload, wait for the app; optionally enter Supabase AUTH mode (data stays local) through auth.js's own test hooks so the header's league pill renders as in production.
  const boot = async (seedOpts, { member = null } = {}) => {
    await navigate();
    await waitFor('window.navigateTo || document.getElementById("site-gate-overlay")');
    const seeded = await evaluate(`(${SEED.toString()})(${JSON.stringify(seedOpts)})`);
    await navigate();
    const up = await waitFor('window.navigateTo && !document.getElementById("site-gate-overlay")', 10000);
    await evaluate(LIB);
    if (member) await enterAuthMember(member);
    await settle();
    return { seeded, up };
  };
  // The header's league pill renders only in Supabase AUTH mode (renderLeaguePill). auth.js's own test hooks put the page there with the data left local: enough to render and tap the REAL pill.
  // Only READS are trusted after this (the storage seam refuses device writes while the Supabase adapter is not serving), so every tap that writes runs before it, in plain local mode.
  const enterAuthMember = (member) => evaluate(`(async () => {
    const auth = await import('./js/auth.js'); const app = await import('./js/app.js');
    auth.configureAuth({ authMode: 'supabase', dataMode: 'sheets', supabaseUrl: 'https://p.test', supabaseAnonKey: 'anon', authModeKnown: true });
    auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: 'u-${member.memberId}', email: '${member.memberId}@test' } });
    auth._setMembershipsForTest([{ leagueId: 'L-geo-0001', memberId: '${member.memberId}', role: '${member.role}', displayName: 'Me', leagueName: 'IRB Pick Ems' }]);
    auth.setActiveLeagueId('L-geo-0001');
    app.renderLeaguePill();
    return true;
  })()`);
  // The league overview, opened by the app's own opener (the pill that opens it in production is tapped in [3]).
  const openOverview = async () => { await evaluate(`document.getElementById('league-overview-sheet-wrap')?.remove()`); await evaluate(`(async () => (await import('./js/app.js'))._openLeagueOverviewForTest())()`); await sleep(380); };
  // A REAL tap: scroll the element to the middle, check the engine's hit-test lands inside it (nothing covers it), then a mouse press and release at its centre.
  const tap = async (selector) => {
    const at = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, inside: !!hit && (hit === e || e.contains(hit)), hit: hit ? (hit.id || String(hit.className || hit.tagName)).slice(0, 40) : null }; })()`);
    if (!at) return { found: false };
    await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await settle(); await sleep(120);
    return { found: true, inside: at.inside, hit: at.hit, x: Math.round(at.x), y: Math.round(at.y) };
  };
  const SIZES = [{ w: 375, h: 812, s: 1 }, { w: 375, h: 812, s: 1.35 }, { w: 390, h: 844, s: 1 }, { w: 390, h: 844, s: 1.35 }];
  const sz = (x) => `${x.w}/${x.s}x`;

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The surface measurers. Each returns plain numbers; the assertions read them, and [9] re-runs the SAME measurer under a mutant.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const M = {
    // the sport switcher (DI-521 rev 3): the segmented control, its thumb and its due dot
    switcher: (g, { page }) => {
      const host = g.q(`#${page} .sport-seg-host`); if (!host) return { missing: true };
      const seg = g.q('.sport-seg', host), btns = g.qa('.sport-seg-btn', seg), thumb = g.q('.sport-seg-thumb', seg);
      const sel = btns.find((b) => b.getAttribute('aria-checked') === 'true');
      const vw = document.documentElement.clientWidth, hr = g.R(seg);
      const next = host.nextElementSibling && g.shown(host.nextElementSibling) ? g.R(host.nextElementSibling) : null;
      const dots = g.qa('.sport-seg-dot', seg).map((d) => { const b = d.closest('.sport-seg-btn'), dr = g.R(d), br = g.R(b), tb = g.textBox(b);
        return { w: +dr.w.toFixed(1), h: +dr.h.toFixed(1), inside: dr.l >= br.l - 0.5 && dr.r <= br.r + 0.5 && dr.t >= br.t - 0.5 && dr.b <= br.b + 0.5, clearOfText: !tb || g.gap2(dr, tb) >= 2, onSelected: b.getAttribute('aria-checked') === 'true' }; });
      return {
        n: btns.length, small: g.small(seg), rows: g.rows(btns), clipped: btns.filter((b) => g.clipped(b)).map((b) => g.label(b)),
        left: +hr.l.toFixed(1), right: +(vw - hr.r).toFixed(1), segL: +Math.min(...btns.map((b) => g.R(b).l)).toFixed(1), segR: +(vw - Math.max(...btns.map((b) => g.R(b).r))).toFixed(1), toNext: next ? +(next.t - hr.b).toFixed(1) : null,
        thumbDev: sel && thumb ? +Math.max(Math.abs(g.R(thumb).l - g.R(sel).l), Math.abs(g.R(thumb).r - g.R(sel).r)).toFixed(1) : null,
        dots, overflow: g.overflowX(host),
      };
    },
    // the All sports view (DI-525 rev 3): the static "This week" block, each row's .dc-sport-tag, the per-sport gate row
    allSports: (g) => {
      const page = g.q('#page-dashboard');
      const wk = g.q('.all-sports-weeknav', page), head = wk && g.q('.week-heading', wk);
      const tags = g.qa('.dc-sport-tag', page).map((t) => { const row = t.closest('.dc-game'), line = t.parentElement, tr = g.R(t), lr = g.R(row);
        const tb = g.textBox(line); const sameLine = tb && Math.abs((tb.t + tb.b) / 2 - (tr.t + tr.b) / 2) < tr.h / 2;
        return { inRow: tr.r <= lr.r + 0.5 && tr.l >= lr.l - 0.5, gapToText: sameLine ? +(tr.l - tb.r).toFixed(1) : null, clipped: g.clipped(t) }; });
      const gates = g.qa('.all-sports-gate', page).map((gt) => { const b = g.q('button, .btn', gt), box = g.R(gt), br = b ? g.R(b) : null; const txt = b && b.previousElementSibling ? g.R(b.previousElementSibling) : null;
        return { hasBtn: !!b, small: g.small(gt), centerDev: b ? g.centerDev([b], g.content(gt)) : null, inLeft: br ? +(br.l - box.l).toFixed(1) : null, inRight: br ? +(box.r - br.r).toFixed(1) : null, toText: br && txt ? +(br.t - txt.b).toFixed(1) : null }; });
      return { weekDev: head && wk ? g.centerDev([head], g.content(wk)) : null, tags, gates, overflow: g.overflowX(page) };
    },
    // Home: a feed card's eyebrow with the sport chip and the chevron (DI-528; the D1 merge's `.sport-chip + .feed-card-chev`)
    homeChips: (g) => {
      const out = [];
      for (const eb of g.qa('#page-home .feed-card-eyebrow')) {
        const chip = g.q('.sport-chip', eb); if (!chip) continue;
        const chev = g.q('.feed-card-chev', eb), card = eb.closest('.feed-card'), cr = g.R(chip), er = g.content(eb);
        const vr = chev ? g.R(chev) : null; const sameLine = vr && Math.abs((vr.t + vr.b) / 2 - (cr.t + cr.b) / 2) < 4;
        const reason = g.q('.feed-card-reason', eb), rr = reason ? g.R(reason) : null; const reasonSame = rr && Math.abs((rr.t + rr.b) / 2 - (cr.t + cr.b) / 2) < 4;
        // W-92 (DI-W92-8): the chip, the card's time and the chevron are ONE trailing group; the chip's NEXT neighbour (the time, or the chevron) is what it must keep 8 pt from.
        const nx = chip.nextElementSibling, nr = nx ? g.R(nx) : null; const nextSame = nr && Math.abs((nr.t + nr.b) / 2 - (cr.t + cr.b) / 2) < 4;
        out.push({ chev: !!chev, chevTrail: vr ? +(er.r - vr.r).toFixed(1) : null, chipToChev: sameLine ? +(vr.l - cr.r).toFixed(1) : null, chipToNext: nextSame ? +(nr.l - cr.r).toFixed(1) : null, reasonToChip: reasonSame ? +(cr.l - rr.r).toFixed(1) : null,
          clipped: g.clipped(chip), inCard: cr.r <= g.content(card).r + 0.5, cardH: +g.R(card).h.toFixed(1), tappable: card.getAttribute('role') === 'button' });
      }
      // W-92 (DI-W92-8, P-8): every event card's time, measured in the real browser — its computed style against the tokens, and where it sits.
      const probe = document.createElement('span'); probe.style.color = 'var(--text-secondary)'; document.body.appendChild(probe); const secondary = getComputedStyle(probe).color; probe.style.color = 'var(--text-muted)'; const muted = getComputedStyle(probe).color; probe.remove();
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const times = [];
      for (const t of g.qa('#page-home .feed-card-eyebrow time.feed-card-time')) {
        const cs = getComputedStyle(t), tr = g.R(t), eb = t.closest('.feed-card-eyebrow'), card = t.closest('.feed-card'), er = g.content(eb);
        const nx = t.nextElementSibling, nr = nx ? g.R(nx) : null; const nextSame = nr && Math.abs((nr.t + nr.b) / 2 - (tr.t + tr.b) / 2) < 4;
        const trail = t.closest('.feed-card-trail'), trr = trail ? g.R(trail) : null;
        times.push({ text: t.textContent, fontPx: +parseFloat(cs.fontSize).toFixed(2), wantPx: +(rootPx * 0.75).toFixed(2), color: cs.color, secondary, muted, tabular: /tabular-nums/.test(cs.fontVariantNumeric), nowrap: cs.whiteSpace === 'nowrap',
          weight: cs.fontWeight, clipped: g.clipped(t), inCard: tr.r <= g.content(card).r + 0.5 && tr.l >= g.content(card).l - 0.5, toNext: nextSame ? +(nr.l - tr.r).toFixed(1) : null, trailEnd: trr ? +(er.r - trr.r).toFixed(1) : null, label: (card.getAttribute('aria-label') || '') });
      }
      return { chips: out, times, overflow: g.overflowX(g.q('#page-home')) };
    },
    // the header pill's due dot (DI-556)
    pill: (g) => {
      const p = g.q('#league-pill'); if (!p || p.hidden) return { missing: true };
      const d = g.q('.league-pill-badge', p), pr = g.R(p), dr = d ? g.R(d) : null, tb = g.textBox(p), hdr = p.closest('header') || p.parentElement;
      return { dot: !!d, w: dr && +dr.w.toFixed(1), h: dr && +dr.h.toFixed(1), leading: !!dr && !!tb && dr.r <= tb.l + 0.5, toText: dr && tb ? +(tb.l - dr.r).toFixed(1) : null,
        vDev: dr ? +Math.abs((dr.t + dr.b) / 2 - (pr.t + pr.b) / 2).toFixed(1) : null, inside: !!dr && dr.l >= pr.l && dr.r <= pr.r && dr.t >= pr.t && dr.b <= pr.b,
        pillH: +pr.h.toFixed(1), pillW: +pr.w.toFixed(1), headerOverflow: hdr ? hdr.scrollWidth - hdr.clientWidth : null,
        // the drawn CAPSULE (::before) against the SAME markup without role="button" (the pill's own unchanged style): same box, same paint
        capsule: (() => {
          // the SAME element, measured with role="button" removed (the pill's own, unchanged style, in the same flex row), then restored
          p.removeAttribute('role'); const old = g.R(p), os = getComputedStyle(p); const oldPaint = { bg: os.backgroundColor, line: os.borderTopColor, lw: os.borderTopWidth, rad: os.borderTopLeftRadius }; const rowWithout = g.R(hdr).h;
          p.setAttribute('role', 'button');
          const now = g.R(p), b = getComputedStyle(p, '::before'); const drawn = b.content && b.content !== 'none'; const top = drawn ? (parseFloat(b.top) || 0) : 0, bottom = drawn ? (parseFloat(b.bottom) || 0) : 0;   // no ::before (an older tree): the element IS the capsule
          const cap = { t: now.t + top, b: now.b - bottom, h: +(now.h - top - bottom).toFixed(1), w: +(now.w - (drawn ? (parseFloat(b.left) || 0) + (parseFloat(b.right) || 0) : 0)).toFixed(1) };
          const hitAbove = document.elementFromPoint((now.l + now.r) / 2, Math.max(0, cap.t - 5)), hitBelow = document.elementFromPoint((now.l + now.r) / 2, cap.b + 5);
          return { h: cap.h, w: cap.w, oldH: +old.h.toFixed(1), oldW: +old.w.toFixed(1), dt: +(cap.t - old.t).toFixed(1), bg: (drawn ? b : getComputedStyle(p)).backgroundColor === oldPaint.bg, line: (drawn ? b : getComputedStyle(p)).borderTopColor === oldPaint.line && (drawn ? b : getComputedStyle(p)).borderTopWidth === oldPaint.lw,
            radius: (drawn ? b : getComputedStyle(p)).borderTopLeftRadius === oldPaint.rad, hitAbove: !!hitAbove && (hitAbove === p || p.contains(hitAbove)), hitBelow: !!hitBelow && (hitBelow === p || p.contains(hitBelow)),
            hitAboveIs: hitAbove ? (hitAbove.id || String(hitAbove.className)) : null, rowWith: +g.R(hdr).h.toFixed(1), rowWithout: +rowWithout.toFixed(1) };
        })() };
    },
    // the league overview sheet (DI-554)
    overview: (g) => {
      const sh = g.q('#league-overview-sheet'); if (!sh) return { missing: true };
      const body = g.q('.lo-body', sh), sr = g.R(sh);
      const blocks = [...body.children].filter(g.shown);
      const inset = blocks.map((b) => { const r = g.R(b); return Math.min(r.l - sr.l, sr.r - r.r); });
      const groups = g.qa('.lo-group', body).map((gr) => g.minPair([...gr.children].filter((c) => !c.matches('.lo-lbl'))));
      const glance = g.q('.lo-glance', body), chips = glance ? g.qa('.lo-chip', glance) : [];
      const pills = g.qa('.lo-pills', body).map((p) => { const card = g.content(p.closest('.lo-card')); const bs = g.qa('.badge', p); return { gap: g.minPair(bs), rows: g.rows(bs), lines: Math.max(0, ...bs.map((x) => g.textLines(x))), over: bs.some((x) => g.R(x).r > card.r + 0.5 || g.clipped(x)) }; });   // the PILLS' own boxes: the row's box always spans the card
      const rows = g.qa('.lo-row', body).map((row) => { const rr = g.R(row), tx = g.R(g.q('.lo-row-tx', row)), ch = g.q('.lo-row-chev', row); return { h: +rr.h.toFixed(1), textIn: +(tx.l - rr.l).toFixed(1), chevIn: ch ? +(rr.r - g.R(ch).r).toFixed(1) : null, toLine: +(tx.t - rr.t).toFixed(1) }; });
      const close = g.q('.lo-close', sh), clr = close ? g.R(close) : null;
      return {
        small: g.small(sh), minInset: inset.length ? +Math.min(...inset).toFixed(1) : null, stack: g.stackGaps(body), groups,
        glance: chips.length ? { n: chips.length, gap: g.minPair(chips), rows: g.rows(chips), lines: Math.max(0, ...chips.map((x) => g.textLines(x))), over: chips.some((c) => g.R(c).r > g.content(glance).r + 0.5) } : null,
        pills, rows, closeRight: clr ? +(sr.r - clr.r).toFixed(1) : null, closeTop: clr ? +(clr.t - sr.t).toFixed(1) : null, overflow: g.overflowX(sh),
      };
    },
    // the Comm sport lens (DI-534 REV 5) and, in the separate-lens state, its caption
    lens: (g, { id = 'comm-sport-lens' } = {}) => {
      const sec = g.q('#' + id); if (!sec) return { missing: true };
      const track = g.q('.cc-quick-track', sec), segs = g.qa('.cc-quick-seg', track), cap = g.q('.comm-lens-note', sec), tr = g.R(track), vw = document.documentElement.clientWidth;
      let nextEl = sec.nextElementSibling; while (nextEl && !g.shown(nextEl)) nextEl = nextEl.nextElementSibling;
      const after = cap ? g.R(cap).b : tr.b;
      return { small: g.small(track), rows: g.rows(segs), clipped: segs.filter((s) => g.clipped(s)).map((s) => g.label(s)), left: +tr.l.toFixed(1), right: +(vw - tr.r).toFixed(1),
        segL: +Math.min(...segs.map((x) => g.R(x).l)).toFixed(1), segR: +(vw - Math.max(...segs.map((x) => g.R(x).r))).toFixed(1),
        caption: cap ? cap.textContent : null, capCount: g.qa('.comm-lens-note', sec).length, capGap: cap ? +(g.R(cap).t - tr.b).toFixed(1) : null, capOver: cap ? g.clipped(cap) || (() => { const tb = g.textBox(cap); return !!tb && (tb.r > g.content(sec).r + 0.5 || tb.l < g.content(sec).l - 0.5); })() : null,
        describedBy: track.getAttribute('aria-describedby'), toNext: nextEl ? +(g.R(nextEl).t - after).toFixed(1) : null, overflow: g.overflowX(sec) };
    },
    // the Comm "All sports" card (DI-534)
    commAllSports: (g) => {
      const card = g.q('#comm-all-sports-card'); if (!card) return { missing: true };
      const cr = g.R(card), btns = g.qa('[data-action="comm-sport-action"]', card);
      const rows = g.qa('.comm-sport-row', card).map((row, i, all) => { const head = row.firstElementChild, spans = [...head.children], b = g.q('button', row);
        const nxt = all[i + 1]; return { headGap: spans.length > 1 ? +(g.R(spans[1]).l - g.R(spans[0]).r).toFixed(1) : null, btnToLine: b && nxt ? +(g.R(nxt).t - g.R(b).b).toFixed(1) : null, lineToHead: +(g.R(head).t - g.R(row).t).toFixed(1) }; });
      return { small: g.small(card), btnIn: btns.map((b) => +Math.min(g.R(b).l - cr.l, cr.r - g.R(b).r).toFixed(1)), rows, overflow: g.overflowX(card) };
    },
    // the Add a sport sheet (DI-532)
    addSport: (g) => {
      const sh = g.q('#add-sport-sheet'); if (!sh) return { missing: true };
      const body = g.q('#add-sport-body', sh), sr = g.R(sh), radios = g.qa('.as-radio', sh), acts = g.q('.as-actions', sh), ab = acts ? g.qa('button', acts) : [];
      const inner = [...body.querySelectorAll('.as-radio, .as-actions .btn, .as-line')].filter(g.shown).map((e) => { const r = g.R(e); return Math.min(r.l - sr.l, sr.r - r.r); });
      return { small: g.small(sh), radios: radios.length, radioGap: g.minPair(radios), stack: g.stackGaps(body), actGap: g.minPair(ab), actDev: acts ? g.centerDev(ab, g.content(acts)) : null, actN: ab.length,
        minInset: inner.length ? +Math.min(...inner).toFixed(1) : null, overflow: g.overflowX(sh) };
    },
  };
  const measure = (name, arg) => inPage(M[name], arg);
  const noOverflow = (o) => !!o && o.scroll <= 1 && o.doc <= 1 && o.bad.length === 0;

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Fixture P (a member who plays both sports, CFB submitted, NFL due) - the switcher and its due dot on Picks, Dashboard and Standings…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const FIX_P = { viewer: 'p1', isAdmin: false, pointer: 'cfb' };
  await viewport(375, 812);
  const bp = await boot(FIX_P);
  assert(bp.up && bp.seeded.comps === 2, `[1-0] fixture: the real app booted on a two-sport league seeded through its own storage (${fmt(bp)})`);
  const SW = {};
  for (const x of SIZES) {
    await viewport(x.w, x.h); await textScale(x.s);
    for (const [tab, page] of [['picks', 'page-picks'], ['dashboard', 'page-dashboard'], ['leaderboard', 'page-leaderboard']]) { await go(tab); SW[`${tab} ${sz(x)}`] = await measure('switcher', { page }); }
  }
  await textScale(1);
  const swAll = Object.entries(SW);
  assert(swAll.every(([, m]) => !m.missing) && SW['picks 375/1x'].n === 2 && SW['dashboard 375/1x'].n === 3 && SW['leaderboard 375/1x'].n === 2, `[1-1] fixture: the switcher is on Picks (2 segments), Dashboard (3, with All sports) and Standings (2) at every size (${swAll.filter(([, m]) => m.missing).map(([k]) => k).join(', ') || 'all present'})`);
  assert(swAll.every(([, m]) => m.small.length === 0), `[1-2] every segment is >= 44 pt, in ${swAll.length} measurements (2 widths x 2 text sizes x 3 tabs)${swAll.filter(([, m]) => m.small.length).slice(0, 2).map(([k, m]) => ` — ${k}: ${m.small.join(', ')}`).join('')}`);
  assert(swAll.every(([, m]) => m.rows === 1 && m.clipped.length === 0), `[1-3] the switcher NEVER WRAPS: one row of segments and no clipped label at every size, "All sports" at 1.35x included${swAll.filter(([, m]) => m.rows !== 1 || m.clipped.length).slice(0, 2).map(([k, m]) => ` — ${k}: rows ${m.rows}, clipped ${m.clipped}`).join('')}`);
  // Breathing Room is about BUTTONS: a segment is >= 16 pt from the screen edge. The track around the segments sits on the page's own inset (--page-pad, 16 pt on every phone width since W-57 Part 2 - it was 14 pt from v0.15 - app-wide), and the
  // segments sit 3 pt inside it - the native segmented control, whose segments fill their own track. The control as a whole is centred on the screen.
  assert(swAll.every(([, m]) => m.segL >= 15.5 && m.segR >= 15.5 && Math.abs(m.left - m.right) <= 1), `[1-4] every segment is 16 pt from both screen edges and the control is centred (segments ${[...new Set(swAll.map(([, m]) => `${m.segL}/${m.segR}`))].join(', ')}; track ${[...new Set(swAll.map(([, m]) => `${m.left}/${m.right}`))].join(', ')})`);
  assert(swAll.every(([, m]) => m.toNext === null || m.toNext >= 15.5), `[1-5] 16 pt between the switcher and the next group below it (min ${Math.min(...swAll.map(([, m]) => m.toNext ?? 99))})`);
  assert(swAll.every(([, m]) => m.thumbDev !== null && m.thumbDev <= 1.5), `[1-6] the thumb sits exactly under the selected segment (worst ${Math.max(...swAll.map(([, m]) => m.thumbDev ?? 99))} pt)`);
  const dots = swAll.flatMap(([k, m]) => m.dots.map((d) => ({ k, ...d })));
  assert(dots.length >= 12 && dots.every((d) => d.w >= 7.5 && d.w <= 8.5 && d.h >= 7.5 && d.h <= 8.5 && d.inside && d.clearOfText && !d.onSelected), `[1-7] the due dot: 8 pt, inside its segment, clear of the label, only on an UNSELECTED segment (${dots.length} dots; bad: ${fmt(dots.filter((d) => !(d.w >= 7.5 && d.w <= 8.5 && d.inside && d.clearOfText && !d.onSelected)).slice(0, 2))})`);
  assert(swAll.every(([, m]) => noOverflow(m.overflow)), `[1-8] nothing in the switcher runs past the screen or its host${swAll.filter(([, m]) => !noOverflow(m.overflow)).slice(0, 2).map(([k, m]) => ` — ${k}: ${fmt(m.overflow)}`).join('')}`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] The All sports view: the static "This week" block, the .dc-sport-tag, the per-sport gate row…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  await viewport(375, 812); await go('dashboard');
  const tAll = await tap('#page-dashboard .sport-seg-btn[data-sport="all"]');
  assert(tAll.found && tAll.inside && await waitFor('document.getElementById("all-sports-rows")'), '[8-1] TAP (real dispatcher): "All sports" on the Dashboard switcher opens the combined slate');
  const AS = {};
  for (const x of SIZES) { await viewport(x.w, x.h); await textScale(x.s); await go('dashboard'); AS[sz(x)] = await measure('allSports'); }
  await textScale(1);
  const asAll = Object.entries(AS);
  assert(asAll.every(([, m]) => m.tags.length >= 2 && m.gates.length === 1 && m.gates[0].hasBtn), `[2-0] fixture: CFB rows carry their tag and the NFL (not submitted) shows ONE gate row with its button (${fmt(asAll.map(([k, m]) => k + ':' + m.tags.length + 't/' + m.gates.length + 'g'))})`);
  assert(asAll.every(([, m]) => m.weekDev !== null && m.weekDev <= 1), `[2-1] the static "This week" block is centred (worst ${Math.max(...asAll.map(([, m]) => m.weekDev ?? 99))} pt)`);
  assert(asAll.every(([, m]) => m.tags.every((t) => t.inRow && !t.clipped && (t.gapToText === null || t.gapToText >= 7.5))), `[2-2] every .dc-sport-tag sits inside its row, unclipped, 8 pt clear of the matchup text when on its line (${fmt(asAll.flatMap(([, m]) => m.tags).filter((t) => !(t.inRow && !t.clipped && (t.gapToText === null || t.gapToText >= 7.5))).slice(0, 2))})`);
  assert(asAll.every(([, m]) => m.gates.every((gt) => gt.small.length === 0 && gt.centerDev <= 1 && gt.inLeft >= 15.5 && gt.inRight >= 15.5 && (gt.toText === null || gt.toText >= 15.5))), `[2-3] the gate row's button: >= 44 pt, centred, 16 pt from the row's edges and 16 pt below its sentence (${fmt(asAll.map(([k, m]) => k + ' ' + fmt(m.gates[0])))})`);
  assert(asAll.every(([, m]) => noOverflow(m.overflow)), `[2-4] the All sports page has no horizontal overflow at 375 pt or 1.35x${asAll.filter(([, m]) => !noOverflow(m.overflow)).slice(0, 2).map(([k, m]) => ` — ${k}: ${fmt(m.overflow)}`).join('')}`);
  await viewport(375, 812);
  const tGate = await tap('.all-sports-gate button');
  const afterGate = await evaluate(`({ tab: document.querySelector('.page-section.active')?.id, label: document.querySelector('#page-picks .picks-week-nav-label')?.textContent })`);
  assert(tGate.found && tGate.inside && afterGate.tab === 'page-picks' && afterGate.label === 'NFL · Week 2', `[8-2] TAP: the gate's "Make your NFL picks" opens Picks on the NFL week (${fmt(afterGate)})`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] Home: a feed card\'s .sport-chip and its chevron; the header pill\'s due dot…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const HC = {};
  for (const x of SIZES) { await viewport(x.w, x.h); await textScale(x.s); await go('home'); await sleep(150); HC[sz(x)] = await measure('homeChips'); }
  await textScale(1);
  const hcAll = Object.entries(HC);
  const chips = hcAll.flatMap(([k, m]) => m.chips.map((c) => ({ k, ...c })));
  assert(chips.length >= 8 && chips.every((c) => c.chev && c.tappable), `[3-0] fixture: Home shows tappable cards that carry BOTH a sport chip and the chevron (${chips.length} across the sizes)`);
  assert(chips.every((c) => c.chevTrail !== null && Math.abs(c.chevTrail) <= 1), `[3-1] the chevron sits at the eyebrow's trailing edge, every size (worst ${Math.max(...chips.map((c) => Math.abs(c.chevTrail ?? 99)))} pt)`);
  assert(chips.every((c) => (c.chipToChev === null || c.chipToChev >= 7.5) && (c.reasonToChip === null || c.reasonToChip >= 7.5) && !c.clipped && c.inCard), `[3-2] chip and chevron are 8 pt apart (and the chip 8 pt from the reason pill) when they share a line, the chip is unclipped and inside its card (${fmt(chips.filter((c) => !((c.chipToChev === null || c.chipToChev >= 7.5) && (c.reasonToChip === null || c.reasonToChip >= 7.5) && !c.clipped && c.inCard)).slice(0, 2))})`);
  assert(chips.every((c) => c.cardH >= 44), '[3-3] the card (the whole card is the tap target) is >= 44 pt');
  assert(chips.every((c) => c.chipToNext === null || c.chipToNext >= 7.5) && chips.some((c) => c.chipToNext !== null), `[3-2b] W-92: the chip keeps 8 pt from whatever follows it in the trailing group (the card's time) on the same line (${fmt(chips.filter((c) => c.chipToNext !== null && c.chipToNext < 7.5).slice(0, 2))})`);
  const times = hcAll.flatMap(([k, m]) => m.times.map((t) => ({ k, ...t })));
  assert(times.length >= 8 && times.every((t) => Math.abs(t.fontPx - t.wantPx) <= 0.1 && t.color === t.secondary && t.color !== t.muted && t.tabular && t.nowrap), `[3-5a] W-92 (P-8): every card time is caption level in the REAL browser — .75rem (${times[0] && times[0].fontPx} px at 1x), var(--text-secondary) (never --text-muted), tabular figures, no wrap (${times.length} times; off: ${fmt(times.filter((t) => !(Math.abs(t.fontPx - t.wantPx) <= 0.1 && t.color === t.secondary && t.tabular && t.nowrap)).slice(0, 2))})`);
  assert(times.every((t) => !t.clipped && t.inCard && t.trailEnd !== null && Math.abs(t.trailEnd) <= 1 && (t.toNext === null || t.toNext >= 7.5)), `[3-5b] …unclipped and inside its card at every size, in a trailing group that ends at the eyebrow's trailing edge, 8 pt from the chevron when they share a line (${fmt(times.filter((t) => !(!t.clipped && t.inCard && Math.abs(t.trailEnd ?? 99) <= 1)).slice(0, 2))})`);
  assert(times.every((t) => / Opens details\.$/.test(t.label) && (/(ago|yesterday|just now|[A-Z][a-z]+ \d{1,2}(, \d{4})?)\. Opens details\.$/.test(t.label))), '[3-5c] …and the tappable card\'s VoiceOver label ends with that time, spoken, then "Opens details."');
  assert(hcAll.every(([, m]) => noOverflow(m.overflow)), `[3-4] no horizontal overflow on Home${hcAll.filter(([, m]) => !noOverflow(m.overflow)).slice(0, 1).map(([k, m]) => ` — ${k}: ${fmt(m.overflow)}`).join('')}`);
  await viewport(375, 812); await go('home');
  const tCard = await tap('#page-home .feed-card--tap .sport-chip');
  const cardOpened = await waitFor('document.querySelector("[data-ps-back]")', 3000);
  assert(tCard.found && tCard.inside && cardOpened, `[8-3] TAP: a feed card that names its sport (pressed on its chip) opens its detail (${fmt(tCard)})`);
  // The detail is a PUSHED SCREEN: it makes the page beneath inert, so it is closed through its own door (a bare DOM sweep would orphan that state, app.js's own warning) - a real tap on Back.
  const tBack = await tap('[data-ps-back]');
  await sleep(400);
  const pageLive = await evaluate(`(() => { const r = document.querySelector('#page-home .feed-card--tap').getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2)); return !document.querySelector('[data-ps-back]') && !document.querySelector('.page-wrapper [inert], .page-wrapper[inert]') && !!h && !!h.closest('.feed-card'); })()`);
  assert(tBack.found && tBack.inside && pageLive, `[8-3b] TAP: the detail's Back returns to Home, and Home takes taps again (nothing left inert) (${fmt(tBack)})`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] The league overview sheet (member), opened by a real tap on the pill…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const OV = {};
  for (const x of SIZES) {
    await viewport(x.w, x.h); await textScale(x.s); await go('home');
    await openOverview();
    OV[sz(x)] = await measure('overview');
    await evaluate(`document.getElementById('league-overview-sheet-wrap')?.remove()`); await settle();
  }
  await textScale(1);
  const ovAll = Object.entries(OV);
  assert(ovAll.every(([, m]) => !m.missing && m.glance && m.pills.length >= 2), `[4-0] fixture: the sheet has At-a-glance chips and a card per sport (${fmt(ovAll.map(([k, m]) => k + ':' + (m.glance ? m.glance.n : 0) + 'chips/' + m.pills.length + 'cards'))})`);
  assert(ovAll.every(([, m]) => m.small.length === 0), `[4-1] every control in the sheet is >= 44 pt (close, chips, cards, rows)${ovAll.filter(([, m]) => m.small.length).slice(0, 2).map(([k, m]) => ` — ${k}: ${m.small.join(', ')}`).join('')}`);
  assert(ovAll.every(([, m]) => m.minInset >= 15.5), `[4-2] every block of the sheet's body is 16 pt from the sheet's edges (min ${Math.min(...ovAll.map(([, m]) => m.minInset))})`);
  assert(ovAll.every(([, m]) => m.stack.every((s) => s >= 15.5)), `[4-3] 16 pt between the groups of the body (min ${Math.min(...ovAll.flatMap(([, m]) => m.stack))})`);
  assert(ovAll.every(([, m]) => m.groups.every((v) => v === null || v >= 7.5) && m.glance.gap === null || ovAll.every(([, mm]) => mm.glance.gap === null || mm.glance.gap >= 7.5)), `[4-4] 8 pt between the items of a group: cards, At-a-glance chips (min ${Math.min(...ovAll.flatMap(([, m]) => [...m.groups.filter((v) => v !== null), m.glance.gap ?? 99]))})`);
  assert(ovAll.every(([, m]) => m.pills.every((p) => (p.gap === null || p.gap >= 7.5) && !p.over)), `[4-5] each card's status pills keep 8 pt and stay inside the card (${fmt(ovAll.flatMap(([, m]) => m.pills).filter((p) => !((p.gap === null || p.gap >= 7.5) && !p.over)).slice(0, 2))})`);
  assert(ovAll.every(([, m]) => !m.glance.over && !m.pills.some((p) => p.over) && m.glance.lines === 1 && m.pills.every((p) => p.lines === 1)), `[4-6] the pill ROWS wrap and the pills never do: no chip or pill crosses its container, and every one is a single line of text at every size (lines: ${[...new Set(ovAll.flatMap(([, m]) => [m.glance.lines, ...m.pills.map((p) => p.lines)]))].join(', ')})`);
  const big = OV['375/1.35x'];
  assert(big.pills.some((p) => p.rows > 1) && big.pills.every((p) => p.gap >= 7.5), `[4-7] at 375 pt and 1.35x a card's pills really DO wrap onto a second row, and the wrap keeps the 8 pt gap (rows: ${big.pills.map((p) => p.rows).join(', ')})`);
  assert(ovAll.every(([, m]) => noOverflow(m.overflow)), `[4-8] nothing in the sheet runs past it${ovAll.filter(([, m]) => !noOverflow(m.overflow)).slice(0, 2).map(([k, m]) => ` — ${k}: ${fmt(m.overflow)}`).join('')}`);
  // RE-PINNED 2026-10-08 (W-57 Part 2, the app-wide Breathing Room audit; the coordinator's order). The approved drawing (D-60, docs/mockups/d1/league-overview-sheet.html: `.sh{padding:8px 8px 8px 16px}`)
  // put the close 8 pt from the sheet's trailing edge and 8 pt below its top; Breathing Room asks 16 pt from a card or screen edge for a button, and the note that used to sit here said so ("raised in the hand-off
  // for Drew"). It is now 16 and 16. The mockup file is therefore one revision behind (design-matrix-pm / user-experience own it).
  assert(ovAll.every(([, m]) => Math.abs(m.closeRight - 16) <= 0.5 && Math.abs(m.closeTop - 16) <= 0.5), `[4-9] the close button is 16 pt in from the trailing edge and 16 pt from the top — never nearer than Breathing Room's 16 (got ${[...new Set(ovAll.map(([, m]) => m.closeRight + '/' + m.closeTop))].join(', ')})`);
  // taps in the sheet: a glance chip, a sport card, close
  await viewport(375, 812); await go('home');
  await openOverview();
  const tChip = await tap('#league-overview-sheet .lo-chip');
  const afterChip = await evaluate(`({ sheet: !!document.getElementById('league-overview-sheet'), tab: document.querySelector('.page-section.active')?.id, label: document.querySelector('#page-picks .picks-week-nav-label')?.textContent })`);
  assert(tChip.found && tChip.inside && afterChip.tab === 'page-picks' && afterChip.label === 'NFL · Week 2', `[8-5] TAP: the At-a-glance "Picks due · NFL" chip takes the member to NFL Picks (${fmt(afterChip)})`);
  await waitFor('!document.getElementById("league-overview-sheet")', 2000);
  await go('home'); await openOverview();
  const tCardCfb = await tap('#league-overview-sheet .lo-card[data-sport="cfb"]');
  const afterCard = await evaluate(`({ tab: document.querySelector('.page-section.active')?.id, label: document.querySelector('.page-section.active .picks-week-nav-label')?.textContent })`);
  assert(tCardCfb.found && tCardCfb.inside && afterCard.tab === 'page-dashboard' && afterCard.label === 'CFB · Week 2', `[8-6] TAP: the CFB card enters CFB on the tab it names (the Dashboard) (${fmt(afterCard)})`);
  await waitFor('!document.getElementById("league-overview-sheet")', 2000);
  await go('home'); await openOverview();
  const tClose = await tap('#league-overview-close');

  assert(tClose.found && tClose.inside && await waitFor('!document.getElementById("league-overview-sheet")', 2000), '[8-7] TAP: the sheet\'s close button closes it');
  await evaluate(`document.getElementById('league-overview-sheet-wrap')?.remove()`); await settle();   // a sheet a failed close left open must not cover the taps below (one red, not a cascade)
  // the switcher's own tap (Picks -> NFL)
  await go('picks');
  const tSeg = await tap('#page-picks .sport-seg-btn[data-sport="nfl"]');
  const afterSeg = await evaluate(`({ label: document.querySelector('#page-picks .picks-week-nav-label')?.textContent, checked: document.querySelector('#page-picks .sport-seg-btn[aria-checked="true"]')?.dataset.sport })`);
  assert(tSeg.found && tSeg.inside && afterSeg.label === 'NFL · Week 2' && afterSeg.checked === 'nfl', `[8-8] TAP: the switcher's NFL segment moves Picks to the NFL week (${fmt(afterSeg)})`);

  // ── [3b] the header pill and its due dot: the pill renders only in Supabase AUTH mode, entered now (reads only from here on in this fixture) ──
  console.log('\n[3b] The header pill\'s due dot, rendered by the real renderLeaguePill (auth mode entered through auth.js\'s own test hooks)…');
  await viewport(375, 812); await textScale(1); await go('home');
  await enterAuthMember({ memberId: 'p1', role: 'player' }); await settle();
  const PL = {};
  for (const x of SIZES) { await viewport(x.w, x.h); await textScale(x.s); await go('home'); await evaluate(`(async () => (await import('./js/app.js')).renderLeaguePill())()`); await settle(); PL[sz(x)] = await measure('pill'); }
  await textScale(1); await viewport(375, 812);
  const plAll = Object.entries(PL);
  assert(plAll.every(([, m]) => !m.missing && m.dot), `[3-5] fixture: the header pill renders (the real renderLeaguePill) with its due dot, every size`);
  assert(plAll.every(([, m]) => m.w >= 7.5 && m.w <= 8.5 && m.h >= 7.5 && m.h <= 8.5 && m.leading && m.inside && m.vDev <= 1.5 && m.toText >= 5.5), `[3-6] the pill's dot: 8 pt, LEADING the name (the pill ellipsizes at its end), inside the pill, centred on its line, 6 pt clear of the text (${fmt(plAll.map(([k, m]) => k + ' ' + m.w + 'x' + m.h + ' lead ' + m.leading + ' v' + m.vDev + ' gap ' + m.toText))})`);
  assert(plAll.every(([, m]) => m.pillH >= 43.5 && m.capsule.hitAbove && m.capsule.hitBelow), `[3-7] the pill (a control: it opens the overview) is a >= 44 pt TAP TARGET - a tap 5 pt above or below the drawn capsule still lands on it (heights ${[...new Set(plAll.map(([, m]) => m.pillH))].join(', ')}; above hits ${[...new Set(plAll.map(([, m]) => m.capsule.hitAboveIs))].join(', ')})`);
  assert(plAll.every(([, m]) => Math.abs(m.capsule.h - m.capsule.oldH) <= 0.5 && Math.abs(m.capsule.w - m.capsule.oldW) <= 0.5 && Math.abs(m.capsule.dt) <= 0.5 && m.capsule.bg && m.capsule.line && m.capsule.radius), `[3-9] ...and the DRAWN capsule is the pill's own unchanged box and paint: the same height, width, position, fill, outline and radius as the same element without the button role (${fmt(plAll.map(([k, m]) => k + ' ' + m.capsule.h + '/' + m.capsule.oldH + ' x ' + m.capsule.w + '/' + m.capsule.oldW))})`);
  assert(plAll.every(([, m]) => m.capsule.rowWith === m.capsule.rowWithout), `[3-10] ...and the one-line header row is exactly as tall with the 44 pt target as without it (${fmt(plAll.map(([k, m]) => k + ' ' + m.capsule.rowWith + '/' + m.capsule.rowWithout))})`);
  assert(plAll.every(([, m]) => m.headerOverflow !== null && m.headerOverflow <= 1), '[3-8] the one-line header does not overflow with the dot in the pill');
  await go('home');
  const tPill = await tap('#league-pill');

  assert(tPill.found && tPill.inside && await waitFor('document.getElementById("league-overview-sheet")', 3000), '[8-4] TAP: the header pill opens the league overview (DI-556)');
  await evaluate(`document.getElementById('league-overview-sheet-wrap')?.remove()`); await settle();

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] Fixture C (a commissioner who plays only CFB) - the Comm lens (ordinary, then SEPARATE with its caption) and the All sports card…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  await viewport(375, 812); await textScale(1);
  const bc = await boot({ viewer: 'p2', isAdmin: true, pointer: 'cfb' });
  assert(bc.up, '[5-0] fixture: the commissioner\'s app booted');
  await evaluate(`(async () => { (await import('./js/app.js')).state.commTab = 'week'; })()`);
  const LN = {}, LS = {}, CA = {};
  for (const x of SIZES) { await viewport(x.w, x.h); await textScale(x.s); await go('commissioner'); LN[sz(x)] = await measure('lens', { id: 'comm-sport-lens' }); CA[sz(x)] = await measure('commAllSports'); }
  await viewport(375, 812); await textScale(1); await go('commissioner');
  const tLens = await tap('#comm-sport-lens .cc-quick-seg[data-sport="nfl"]');
  const sepState = await evaluate(`(async () => { const seam = await import('./js/sport-seam.js'); const comp = await import('./js/competition.js'); return { separate: seam.lensIsSeparate(), lens: seam.getLensSport(), pointer: comp.getActiveSportKey(), header: document.querySelector('#header-meta-week strong')?.textContent }; })()`);
  assert(tLens.found && tLens.inside && sepState.separate === true && sepState.lens === 'nfl' && sepState.pointer === 'cfb' && sepState.header === 'NFL Week 2', `[8-9] TAP: the Comm lens's NFL segment (he has not joined the NFL) gives a SEPARATE lens: Comm and the header on NFL, his pointer still CFB (${fmt(sepState)})`);
  for (const x of SIZES) { await viewport(x.w, x.h); await textScale(x.s); await go('commissioner'); LS[sz(x)] = await measure('lens', { id: 'comm-sport-lens' }); }
  await textScale(1);
  const lnAll = Object.entries(LN), lsAll = Object.entries(LS), caAll = Object.entries(CA);
  assert([...lnAll, ...lsAll].every(([, m]) => !m.missing && m.small.length === 0 && m.rows === 1 && m.clipped.length === 0), `[5-1] the lens: segments >= 44 pt, one row, no clipped label, every size and both states`);
  assert([...lnAll, ...lsAll].every(([, m]) => m.segL >= 15.5 && m.segR >= 15.5 && Math.abs(m.left - m.right) <= 1), `[5-2] every lens segment is 16 pt from both screen edges and the lens is centred (segments ${[...new Set([...lnAll, ...lsAll].map(([, m]) => m.segL + '/' + m.segR))].join(', ')})`);
  assert(lnAll.every(([, m]) => m.caption === null && m.capCount === 0 && m.describedBy === null), '[5-3] ORDINARY state (the lens is the pointer): no caption under the lens, and nothing describes the radiogroup');
  assert(lsAll.every(([, m]) => m.caption === 'These controls change NFL only.' && m.capCount === 1 && m.describedBy === 'comm-lens-note-week'), `[5-4] SEPARATE state: exactly one caption, "These controls change NFL only.", and the radiogroup is described by it (${fmt(lsAll.map(([k, m]) => k + ':' + m.caption))})`);
  assert(lsAll.every(([, m]) => m.capGap >= 7.5 && m.capGap <= 8.5 && !m.capOver), `[5-5] the caption sits 8 pt under the control and its text wraps inside the section (never past it), every size (gaps ${[...new Set(lsAll.map(([, m]) => m.capGap))].join(', ')})`);
  assert([...lnAll, ...lsAll].every(([, m]) => m.toNext === null || m.toNext >= 15.5), `[5-6] 16 pt between the lens (or its caption) and the next card (min ${Math.min(...[...lnAll, ...lsAll].map(([, m]) => m.toNext ?? 99))})`);
  assert([...lnAll, ...lsAll].every(([, m]) => noOverflow(m.overflow)), '[5-7] nothing in the lens section runs past the screen');
  assert(caAll.every(([, m]) => !m.missing && m.small.length === 0 && m.btnIn.every((v) => v >= 15.5)), `[5-8] the All sports card: every next-action button >= 44 pt and 16 pt inside the card (${fmt(caAll.map(([k, m]) => k + ' ' + m.btnIn.join('/') + ' ' + m.small.join(',')))})`);
  assert(caAll.every(([, m]) => m.rows.every((r) => (r.headGap === null || r.headGap >= 7.5) && (r.btnToLine === null || r.btnToLine >= 7.5) && r.lineToHead >= 7.5)), `[5-9] ...each row's week label and badge 8 pt apart, and nothing touches the row dividers (8 pt) (${fmt(caAll.flatMap(([, m]) => m.rows).slice(0, 3))})`);
  assert(caAll.every(([, m]) => noOverflow(m.overflow)), '[5-10] ...and no horizontal overflow');
  // the games-tab lens carries the caption too, once
  await viewport(375, 812);
  await evaluate(`(async () => { (await import('./js/app.js')).state.commTab = 'games'; })()`); await go('commissioner');
  const gl = await measure('lens', { id: 'comm-sport-lens-games' });
  assert(!gl.missing && gl.caption === 'These controls change NFL only.' && gl.capCount === 1 && gl.capGap >= 7.5 && gl.capGap <= 8.5, `[5-11] the Games-tab lens carries the same caption once, 8 pt under it (${fmt(gl)})`);
  await evaluate(`(async () => { (await import('./js/app.js')).state.commTab = 'week'; })()`); await go('commissioner');
  const tAct = await tap('#comm-all-sports-card [data-action="comm-sport-action"][data-sport="nfl"]');
  const afterAct = await evaluate(`(async () => { const st = await import('./js/storage.js'); return { nfl: st.getWeek('w_nfl_2')?.status, cfb: st.getWeek('w_cfb_2')?.status }; })()`);
  assert(tAct.found && tAct.inside && afterAct.nfl === 'locked' && afterAct.cfb === 'open', `[8-10] TAP: the NFL row's "Lock" locks the NFL week and leaves CFB open (${fmt(afterAct)})`);
  // the commissioner's overview rows
  await go('home'); await openOverview();
  const OC = await measure('overview');
  assert(!OC.missing && OC.rows.length >= 3 && OC.rows.every((r) => r.h >= 44 && r.textIn >= 15.5 && (r.chevIn === null || r.chevIn >= 15.5) && r.toLine >= 7.5), `[5-12] the overview's Commissioner and League rows: >= 44 pt, text and chevron 16 pt inside the list, 8 pt clear of the dividers (${fmt(OC.rows)})`);
  const tManage = await tap('#league-overview-sheet .lo-row[data-lo-action="comm-manage"][data-sport="nfl"]');
  const afterManage = await evaluate(`(async () => ({ tab: document.querySelector('.page-section.active')?.id, lens: (await import('./js/sport-seam.js')).getLensSport(), commTab: (await import('./js/app.js')).state.commTab }))()`);
  assert(tManage.found && tManage.inside && afterManage.tab === 'page-commissioner' && afterManage.lens === 'nfl' && afterManage.commTab === 'week', `[8-11] TAP: "Manage NFL" opens Comm -> Week on the NFL lens (${fmt(afterManage)})`);
  await go('home'); await openOverview();
  const tEntries = await tap('#league-overview-sheet .lo-row[data-lo-action="comm-entries"]');
  const afterEntries = await evaluate(`(async () => ({ tab: document.querySelector('.page-section.active')?.id, commTab: (await import('./js/app.js')).state.commTab, card: !!document.getElementById('comm-sport-entries-card') }))()`);
  assert(tEntries.found && tEntries.inside && afterEntries.tab === 'page-commissioner' && afterEntries.commTab === 'players' && afterEntries.card, `[8-12] TAP: "Sport entries" opens Comm -> Players with the Sport entries card (${fmt(afterEntries)})`);
  await go('home'); await openOverview();
  const tLeague = await tap('#league-overview-sheet .lo-row[data-lo-action="switch-league"]');
  assert(tLeague.found && tLeague.inside && await waitFor('!document.getElementById("league-overview-sheet") && document.querySelector("[role=dialog]")', 2500), '[8-13] TAP: "Switch or join a league" opens the league selector (and closes the overview)');
  await evaluate(`document.querySelectorAll('[data-hold-teardown], .modal-overlay').forEach((e) => e.remove())`); await settle();

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] Fixture A (a commissioner of a ONE-sport league) - the Add a sport sheet, opened from the overview\'s row…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  await viewport(375, 812);
  const ba = await boot({ viewer: 'p1', isAdmin: true, sports: ['cfb'], plays: {}, submitted: { cfb: ['p1'] } });
  await evaluate(`(async () => (await import('./js/auth.js'))._setOfferedSportsForTest(['cfb', 'nfl']))()`);   // the platform offers both (in production: the server's platform config, read at sign-in)
  assert(ba.up && ba.seeded.comps === 1, '[6-0] fixture: a one-sport league, its commissioner signed in');
  await go('home'); await openOverview();
  const tAdd = await tap('#league-overview-sheet .lo-row[data-lo-action="comm-add-sport"]');
  assert(tAdd.found && tAdd.inside && await waitFor('document.getElementById("add-sport-sheet")', 2500), '[8-14] TAP: the overview\'s "Add a sport" row opens the Add a sport sheet');
  const AD = {};
  for (const x of SIZES) {
    await viewport(x.w, x.h); await textScale(x.s);
    if (!(await evaluate('!!document.getElementById("add-sport-sheet")'))) { await evaluate(`(async () => (await import('./js/app.js')).openAddSportSheet())()`); }
    await sleep(380); AD[sz(x)] = await measure('addSport');
  }
  await textScale(1); await viewport(375, 812);
  const adAll = Object.entries(AD);
  assert(adAll.every(([, m]) => !m.missing && m.radios >= 1 && m.actN === 2), `[6-1] fixture: the sheet offers a sport (radio rows) and two actions (${fmt(adAll.map(([k, m]) => k + ':' + m.radios + 'r/' + m.actN + 'a'))})`);
  assert(adAll.every(([, m]) => m.small.length === 0), `[6-2] every control >= 44 pt (radio rows, actions)${adAll.filter(([, m]) => m.small.length).slice(0, 2).map(([k, m]) => ` — ${k}: ${m.small.join(', ')}`).join('')}`);
  assert(adAll.every(([, m]) => (m.radioGap === null || m.radioGap >= 7.5) && m.actGap >= 7.5 && m.stack.every((s) => s >= 15.5)), `[6-3] 8 pt between radio rows and between the two actions; 16 pt between the sheet's groups (${fmt(adAll.map(([k, m]) => k + ' r' + m.radioGap + ' a' + m.actGap + ' s' + m.stack.join('/')))})`);
  assert(adAll.every(([, m]) => m.actDev <= 1 && m.minInset >= 15.5), `[6-4] the action pair is centred and every row and button is 16 pt from the sheet's edges (dev ${Math.max(...adAll.map(([, m]) => m.actDev))}, inset ${Math.min(...adAll.map(([, m]) => m.minInset))})`);
  assert(adAll.every(([, m]) => noOverflow(m.overflow)), '[6-5] nothing in the sheet runs past it');
  const tRadio = await tap('#add-sport-sheet .as-radio');
  const radioOn = await evaluate(`document.querySelector('#add-sport-sheet .as-radio')?.getAttribute('aria-checked')`);
  assert(tRadio.found && tRadio.inside && radioOn === 'true', `[8-15] TAP: a sport's radio row selects it (aria-checked ${radioOn})`);
  const cancelSel = await evaluate(`(() => { const b = [...document.querySelectorAll('#add-sport-sheet .as-actions button')].find((x) => /cancel|not now/i.test(x.textContent)); if (!b) return null; b.id = b.id || 'geo-add-cancel'; return '#' + b.id; })()`);
  const tCancel = cancelSel ? await tap(cancelSel) : { found: false };
  assert(tCancel.found && tCancel.inside && await waitFor('!document.getElementById("add-sport-sheet")', 2500) && await evaluate(`(async () => (await import('./js/storage.js')).getCompetitions?.().length ?? JSON.parse(localStorage.getItem('cfbp_competitions')).length)()`) === 1, '[8-16] TAP: Cancel closes the sheet and adds nothing (still one sport)');
  await evaluate(`(async () => (await import('./js/app.js')).openAddSportSheet())()`); await sleep(380);
  const tAddX = await tap('#add-sport-close');
  assert(tAddX.found && tAddX.inside && await waitFor('!document.getElementById("add-sport-sheet")', 2500), '[8-17] TAP: the Add a sport sheet\'s close button closes it');

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] TOKEN COLOURS: every colour token re-pointed to two unrelated palettes; every painted colour of every surface must move…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The shared sheet scrim (.chat-sheet-backdrop, rgba(0,0,0,.45), every sheet since v0.21) is the one literal on these surfaces and predates D1; it is skipped by name and reported.
  const SCRIM = '.chat-sheet-backdrop';
  const tokenRun = async (selectors, setup) => {
    const stillOut = [];
    let tokens = 0, painted = 0;
    const snap = async () => inPage((g, { sels, skip }) => sels.flatMap((s) => g.qa(s).flatMap((root) => g.paints(root, skip).map((p) => ({ k: s + ' ' + p.k, v: p.v })))), { sels: selectors, skip: SCRIM });
    await setup();
    tokens = await inPage((g) => g.palette(1)); await settle();
    const a = await snap();
    await inPage((g) => g.palette(2)); await settle();
    const b = await snap();
    await inPage((g) => g.palette(0)); await settle();
    painted = a.length;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i].k === b[i].k && a[i].v === b[i].v) stillOut.push(`${a[i].k}=${a[i].v}`);
    return { tokens, painted, literal: [...new Set(stillOut)], aligned: a.length === b.length };
  };
  // fixture P again for the member surfaces
  await viewport(375, 812);
  await boot(FIX_P);
  const T = {};
  T.switcher = await tokenRun(['#page-picks .sport-seg-host'], () => go('picks'));
  T.allSports = await tokenRun(['#page-dashboard .sport-seg-host', '#page-dashboard .all-sports-weeknav', '#page-dashboard .dc-sport-tag', '#page-dashboard .all-sports-gate'], async () => { await go('dashboard'); await tap('#page-dashboard .sport-seg-btn[data-sport="all"]'); });
  T.home = await tokenRun(['#page-home .sport-chip', '#page-home .feed-card--tap .feed-card-chev'], () => go('home'));
  T.overview = await tokenRun(['#league-overview-sheet'], async () => { await go('home'); await openOverview(); });
  const scrim = await inPage((g) => { const e = document.querySelector('#league-overview-sheet-wrap .chat-sheet-backdrop'); return e ? getComputedStyle(e).backgroundColor : null; });
  await evaluate(`document.getElementById('league-overview-sheet-wrap')?.remove()`);
  await boot({ viewer: 'p2', isAdmin: true, pointer: 'cfb' });
  await evaluate(`(async () => { (await import('./js/app.js')).state.commTab = 'week'; (await import('./js/sport-seam.js')).setLensSport('nfl'); })()`);
  T.lens = await tokenRun(['#comm-sport-lens'], () => go('commissioner'));
  T.commAll = await tokenRun(['#comm-all-sports-card'], () => go('commissioner'));
  await boot({ viewer: 'p1', isAdmin: true, sports: ['cfb'], plays: {}, submitted: { cfb: ['p1'] } });
  await evaluate(`(async () => (await import('./js/auth.js'))._setOfferedSportsForTest(['cfb', 'nfl']))()`);
  T.addSport = await tokenRun(['#add-sport-sheet'], async () => { await evaluate(`(async () => (await import('./js/app.js')).openAddSportSheet())()`); await sleep(380); });
  await boot(FIX_P); await go('home'); await enterAuthMember({ memberId: 'p1', role: 'player' }); await settle();
  T.pill = await tokenRun(['#league-pill'], async () => { await go('home'); await evaluate(`(async () => (await import('./js/app.js')).renderLeaguePill())()`); });
  const tAllRes = Object.entries(T);
  assert(tAllRes.every(([, r]) => r.tokens >= 40), `[7-0] fixture: the sheet defines the colour tokens the palettes re-point (${tAllRes[0][1].tokens} tokens)`);
  assert(tAllRes.every(([, r]) => r.painted >= 3 && r.aligned), `[7-1] fixture: every surface paints colours to compare (${tAllRes.map(([k, r]) => k + ' ' + r.painted).join(', ')})`);
  for (const [k, r] of tAllRes) assert(r.literal.length === 0, `[7-${k}] ${k}: every painted colour follows the tokens (${r.painted} painted; literal: ${r.literal.slice(0, 4).join(' | ') || 'none'})`);
  console.log(`  (info) skipped by name: the shared sheet scrim ${SCRIM} paints ${scrim} on every sheet (pre-D1, every sheet since v0.21) - reported in the hand-off, not a D1 surface`);
  await evaluate(`document.querySelectorAll('[data-hold-teardown]').forEach((e) => e.remove())`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[9] ANTI-VACUITY (S-3: this section is the kit): each detector, on the real page, under an override sheet that breaks the one rule it measures, must go RED…');
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const red = async (id, what, css, run, isRed) => {
    await inPage((g, c) => g.mutant(c), css); await settle();
    let m; try { m = await run(); } finally { await inPage((g) => g.mutant(null)); await settle(); }
    const caught = isRed(m);
    assert(caught === true, `${id} MUTANT ${what} -> ${caught ? 'RED (caught)' : 'SURVIVED'}: ${fmt(m)}`);
  };
  await boot(FIX_P);
  await viewport(375, 812); await textScale(1);
  // the overview: padding knocked down, a target shrunk, an in-group gap removed, the pills held on one line
  const ovOpen = async () => { await go('home'); await openOverview(); return measure('overview'); };
  await red('[9-1]', 'a padding knocked down (.lo-body 16 -> 4 pt at the sides)', '.lo-body{padding-left:4px!important;padding-right:4px!important}', ovOpen, (m) => !(m.minInset >= 15.5));
  await red('[9-2]', 'a target shrunk (the overview\'s chips 44 -> 30 pt)', '.lo-chip{min-height:30px!important;height:30px!important}', ovOpen, (m) => m.small.length > 0);
  await red('[9-3]', 'a group\'s gap removed (.lo-group gap 8 -> 0)', '.lo-group{gap:0!important}', ovOpen, (m) => !m.groups.every((v) => v === null || v >= 7.5));
  await textScale(1.35);
  await red('[9-4]', 'the pills held on one line (.lo-pills nowrap) at 1.35x: the row cannot wrap, so a pill breaks INSIDE itself', '.lo-pills{flex-wrap:nowrap!important}', ovOpen, (m) => m.pills.some((p) => p.over || p.lines > 1) || !noOverflow(m.overflow));
  await textScale(1);
  await evaluate(`document.getElementById('league-overview-sheet-wrap')?.remove()`);
  // the switcher: a segment shrunk; allowed to wrap; the gap to the next group cut; the dot moved onto the label; the thumb off its segment
  const swRun = async () => { await go('dashboard'); await tap('#page-dashboard .sport-seg-btn[data-sport="cfb"]'); return measure('switcher', { page: 'page-dashboard' }); };
  await red('[9-5]', 'a target shrunk (.sport-seg-btn 44 -> 30 pt)', '.sport-seg-btn{min-height:30px!important;height:30px!important}', swRun, (m) => m.small.length > 0);
  await red('[9-6]', 'the switcher allowed to wrap', '.sport-seg{flex-wrap:wrap!important}.sport-seg-btn{flex:0 0 55%!important}', swRun, (m) => m.rows > 1);
  await red('[9-7]', 'the 16 pt under the switcher cut to 4', '.sport-seg-host{margin-bottom:4px!important}', swRun, (m) => !(m.toNext >= 15.5));
  await red('[9-8]', 'the due dot moved onto the label', '.sport-seg-dot{right:auto!important;left:50%!important;top:50%!important}', swRun, (m) => m.dots.some((d) => !d.clearOfText));
  // the All sports gate: its button pushed off-centre
  const gateRun = async () => { await go('dashboard'); await tap('#page-dashboard .sport-seg-btn[data-sport="all"]'); return measure('allSports'); };
  await red('[9-9]', 'the gate\'s button pushed off-centre', '.all-sports-gate{text-align:left!important}', gateRun, (m) => m.gates.some((gt) => gt.centerDev > 1));
  // a literal colour on a D1 surface
  await red('[9-10]', 'a literal colour on the due dot', '.sport-seg-dot{background:#c9a227!important}', async () => tokenRun(['#page-picks .sport-seg-host'], () => go('picks')), (r) => r.literal.length > 0);
  // the Home chip pressed against the chevron
  // W-92: the chip now sits in the trailing group [chip][time][chevron]; the gap that keeps it off its neighbour is that group's own.
  await red('[9-11]', 'the chip pressed against the time beside it (trailing group gap 0)', '.feed-card-trail{gap:0!important}', async () => { await go('home'); await sleep(150); return measure('homeChips'); }, (m) => m.chips.some((c) => c.chipToNext !== null && c.chipToNext < 7.5));
  await red('[9-12]', 'the card time drawn in --text-muted (fails AA on a card)', '.feed-card-time{color:var(--text-muted)!important}', async () => { await go('home'); await sleep(150); return measure('homeChips'); }, (m) => m.times.some((t) => t.color !== t.secondary));
  await red('[9-13]', 'the card time allowed to wrap and the trailing group pushed to the leading edge', '.feed-card-time{white-space:normal!important}.feed-card-trail{margin-left:0!important}', async () => { await go('home'); await sleep(150); return measure('homeChips'); }, (m) => m.times.some((t) => !t.nowrap || Math.abs(t.trailEnd ?? 99) > 1));
} catch (e) {
  fail++;
  console.error('  ❌ the engine run threw:', e && e.stack ? e.stack : e);
} finally {
  try { engine && engine.proc.kill(); } catch { /* gone */ }
  try { server.close(); } catch { /* closed */ }
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
