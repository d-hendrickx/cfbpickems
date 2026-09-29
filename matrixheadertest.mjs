/**
 * CFB Pickems — matrixheadertest.mjs
 * ===================================
 * DI-428(c) (2026-09-28, amends DI-331f) — the standard dashboard matrix's
 * per-game row label (`.game-info-cell`'s `.game-info-matchup` line — the one
 * place this table identifies which game a row is; DI-428(c) calls it the
 * matrix's "game header cells"). RG-292's finding: DI-331f deliberately left
 * this surface unconverted while the pick buttons and compact-dashboard chips
 * got logos. This closes it — OR proves it shouldn't be closed, depending on
 * what the measurement below actually shows.
 *
 * The DI is explicit that the decision is conditional on a real measurement:
 * "the matrix dashboard's game header cells render the logo above the
 * abbreviation at the existing header size — OR, if that breaks the matrix's
 * column width on a laptop, the abbreviation keeps priority and the logo is
 * skipped there and builder measures at 1024/1280 and states which."
 *
 * PART 1 (render-level, no browser) drives the REAL exported
 * `renderDashboardTable()` directly — same technique loadtest.mjs [1c] and
 * this repo's other dashboard-matrix suites use ("pure HTML, blind rule only
 * meaningfully tested against the markup actually served") — through a
 * realistic six-player, eight-game fixture, and checks toggle on/off,
 * fallback (manual game / missing logo), XSS-escaping of the logo URL, and a
 * light blind-rule non-regression check (the header treats both teams as
 * public schedule data; the PICK CELLS' own blind rule, already covered by
 * grouptest.mjs/UN-116's own suite, is untouched by this DI and is spot-
 * checked here only as a "did not regress" control).
 *
 * PART 2 (ENGINE-MEASURED) renders the SAME two real HTML strings from Part 1
 * inside a static fixture carrying the REAL css/styles.css and the REAL
 * `.main-content > #page-dashboard.active > .dashboard-scroll` shell (the
 * `wizardsheettest.mjs`/`chatpagetest.mjs` real-app-boot recipe, scaled down
 * to "a static fixture with the real CSS" per this DI's own build note — no
 * full app boot needed since renderDashboardTable() output is static HTML),
 * in headless Chrome, at 1024px and 1280px — the matrix's own two breakpoints
 * (1024 is where `.main-content:has(#page-dashboard.active){max-width:1400px}`
 * first applies AND where DI-311 first switches the layout to 'standard';
 * 1280 is a common laptop width comfortably inside that cap) — and measures
 * whether `.game-info-cell` (and the table as a whole) get WIDER with the
 * header logos than without. The verdict this run produces is quoted in the
 * handoff, not just asserted here.
 *
 * Run: node matrixheadertest.mjs
 * Override the browser: MATRIXHDR_ENGINE=/path/to/Chromium (falls back to
 * CHATPAGE_ENGINE, WIZTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then
 * /Applications).
 */

import { existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── DOM / localStorage stubs (loadtest.mjs shape) — just enough for
//    js/app.js + js/storage.js to import cleanly and for
//    renderDashboardTable() (a pure-HTML exported function) to run. No
//    interaction is driven through this DOM — Part 2 does the real rendering
//    in an actual browser. ─────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const nullEl = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (p === 'style') return {};
    if (p === 'dataset') return {};
    if (['addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'insertAdjacentHTML', 'remove', 'focus', 'scrollTo'].includes(p)) return () => {};
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector' || p === 'closest') return () => null;
    if (p === 'innerHTML' || p === 'textContent' || p === 'value') return '';
    return undefined;
  },
  set: () => true,
});
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => nullEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => nullEl,
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
// Part [1] imports js/app.js with network disabled, matching every other
// suite's stub (RG-03 precedent: app.js must import cleanly with no network).
// Part [2] needs a REAL fetch (to the suite's own localhost server and the
// local Chromium DevTools endpoint) — realFetch is captured here, before the
// stub takes over, and Part [2] restores it just before launching the engine.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('network disabled in matrixheadertest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

console.log('\n[0] Importing js/storage.js + js/app.js…');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
assert(typeof app.renderDashboardTable === 'function', '0-1: js/app.js exports renderDashboardTable()');

// ── Fixture: six players, eight games, realistic name lengths, a final
//    (fully public) week so every cell is populated — worst-case width, and
//    the same on both renders so the header treatment is the ONLY delta. ──
storage.setBackendMode('local');
const PLAYERS = [
  { playerId: 'pl_drew',   displayName: 'Drew',    active: true, preferences: {} },
  { playerId: 'pl_brayden',displayName: 'Brayden', active: true, preferences: {} },
  { playerId: 'pl_kevin',  displayName: 'Kevin',   active: true, preferences: {} },
  { playerId: 'pl_koby',   displayName: 'Koby',    active: true, preferences: {} },
  { playerId: 'pl_jacob',  displayName: 'Jacob',   active: true, preferences: {} },
  { playerId: 'pl_kihoon', displayName: 'Kihoon',  active: true, preferences: {} },
];
PLAYERS.forEach(p => storage.addPlayer(p));

const WEEK_ID = 'mh_w1';
storage.saveWeek({
  weekId: WEEK_ID, weekNumber: 5, season: 2026, name: 'Week 5',
  status: 'final', dataSourceMode: 'live',
  startDate: '2026-09-26', endDate: '2026-09-27',
  picksOpenAt: null, picksLockAt: null,
  tiebreakerQuestion: 'Total points?', actualTiebreakerValue: 45,
  showInHistory: true, blurb: '', extraPointEnabled: false,
  extraPointActual: null, extraPointDetect: null,
});

// A realistic, mixed-length CFB slate — logos are real ESPN CDN-shaped URLs
// (https, well under logoOk()'s length cap).
const LOGO = (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
const SLATE = [
  ['Texas A&M', 'Alabama', 21], ['Ohio State', 'Michigan', 12],
  ['Notre Dame', 'USC', 5], ['Georgia', 'Tennessee', 33],
  ['Oklahoma', 'Texas', 7], ['Florida State', 'Clemson', 44],
  ['Penn State', 'Wisconsin', 55], ['Oregon', 'Washington', 66],
];
const games = SLATE.map(([away, home, id], i) => ({
  gameId: `${WEEK_ID}_g${i}`, weekId: WEEK_ID, espnEventId: String(2000 + i),
  dataQuality: 'espn_historical', dataSource: 'espn_historical',
  homeTeam: home, awayTeam: away, homeConference: 'Power', awayConference: 'Power',
  homeRank: null, awayRank: null,
  kickoff: '2026-09-26T20:00:00Z', kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening',
  spread: -3.5, favorite: home, lockedSpread: -3.5,
  homeScore: 27, awayScore: 20, status: 'final',
  actualWinner: home, atsWinner: home, isAlmaMaterGame: false,
  spreadSource: 'espn', oddsProvider: 'DraftKings', lastUpdated: null,
  venue: null, venueDisplay: null, neutralSite: false, multiplier: 1,
  isManual: false, homeLogo: LOGO(id), awayLogo: LOGO(id + 500),
}));
games.forEach(g => storage.saveGame(g));

// Every player picks every game (alternating sides) — fully populated pick
// cells on every render, so the game-info column is the only thing that can
// move between the baseline and logo-view measurements.
const allPicks = [];
games.forEach((g, gi) => PLAYERS.forEach((p, pi) => {
  allPicks.push({
    pickId: `mh_pk_${gi}_${pi}`, weekId: WEEK_ID, gameId: g.gameId, playerId: p.playerId,
    selectedTeam: (gi + pi) % 2 === 0 ? g.homeTeam : g.awayTeam,
    submittedAt: '2026-09-25T00:00:00Z',
  });
}));
storage.saveAllPicks(allPicks);
storage.saveAllWeeklyResults(WEEK_ID, PLAYERS.map((p, i) => ({
  weekId: WEEK_ID, playerId: p.playerId, rank: i + 1,
  correctPicks: 8 - i, incorrectPicks: i, correctCount: 8 - i, incorrectCount: i,
  noDecisions: 0, isWinner: i === 0, isLoser: i === PLAYERS.length - 1,
})));
storage.setSession('pl_drew', false, true);

function tableHTML(logoViewOn, gamesOverride = games) {
  const p = storage.getPlayer('pl_drew');
  storage.savePlayer({ ...p, preferences: { ...p.preferences, logoView: logoViewOn } });
  const picks = storage.getPicks(WEEK_ID);
  const results = storage.getWeeklyResults ? storage.getWeeklyResults(WEEK_ID) : [];
  return app.renderDashboardTable(PLAYERS, gamesOverride, picks, results, WEEK_ID, 45);
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] Render-level — renderDashboardTable(), toggle on/off, fallback, XSS…');
// ═════════════════════════════════════════════════════════════════════════
{
  const off = tableHTML(false);
  const on = tableHTML(true);

  assert(off.includes('Texas A&amp;M @ Alabama') && off.includes('Ohio State @ Michigan'),
    '1-0: fixture check — toggle OFF renders the full-name matchupBare() header, unchanged');
  assert(!off.includes('matrix-hdr-logo') && !off.includes('matrix-hdr-abbr'),
    '1-1: toggle OFF — byte-shape unchanged, no new markup at all (DI-428c is additive, never on by default)');

  assert(on.includes('matrix-hdr-logo-box') && on.includes('matrix-hdr-abbr'),
    '1-2: toggle ON — the new logo+abbreviation header markup is present');
  assert((on.match(/class="matrix-hdr-logo-box"/g) || []).length >= games.length * 2 - 2,
    `1-3: toggle ON — roughly two logo boxes per game row across the slate (got ${(on.match(/class="matrix-hdr-logo-box"/g) || []).length} for ${games.length} games)`);
  assert(on.includes(LOGO(21)) && on.includes(LOGO(521)),
    '1-4: toggle ON — the real per-game logo URLs (both away and home) appear in the row for the first game');
  // Abbreviation reuses shortTeam() — same <=4-char map the compact dashboard
  // and the red-zone mark already abbreviate with (never a second, drifting
  // abbreviation convention for the same schools).
  assert(/matrix-hdr-abbr">[A-Z0-9]{1,4} @ [A-Z0-9]{1,4}</.test(on),
    '1-5: the abbreviation text is the shortTeam() <=4-char form, not the full school name');
  // Round 2 (reviewer F1) — the separator rendered TWICE in round 1 (once
  // next to the logos, once in the abbreviation). Now it exists in exactly
  // ONE place: no separator span next to the logo pair at all.
  assert(!on.includes('matrix-hdr-logo-sep'),
    '1-5b: the logo-pair row carries no separator span any more — "@"/"vs" appears only once, inside .matrix-hdr-abbr');
  const blockStart = on.indexOf('<span class="matrix-hdr-block">');
  const abbrOpen = on.indexOf('class="matrix-hdr-abbr"', blockStart);
  const abbrClose = on.indexOf('</span>', abbrOpen) + '</span>'.length;
  const firstBlock = (blockStart >= 0 && abbrOpen >= 0) ? on.slice(blockStart, abbrClose) : '';
  assert(firstBlock.length > 0, '1-5c-pre: fixture — located the first row\'s whole .matrix-hdr-block…matrix-hdr-abbr span for inspection');
  assert((firstBlock.match(/@|vs/g) || []).length === 1,
    `1-5c: exactly ONE separator glyph inside the first row's whole .matrix-hdr-block (got ${(firstBlock.match(/@|vs/g) || []).length}: ${JSON.stringify(firstBlock)})`);
  // Round 2 (reviewer F1) — the stack is a hard flex-column, not a
  // wrap-dependent row; structurally verified here (the geometry proof is
  // [2], ENGINE-MEASURED, below).
  assert(/<span class="matrix-hdr-block">\s*<span class="matrix-hdr-logos">/.test(on),
    '1-5d: the logo pair (.matrix-hdr-logos) is the FIRST child of .matrix-hdr-block — before the abbreviation in source order, inside a flex-column wrapper (css/styles.css), never a flex-wrap row');

  // Fallback — a manual game never gets a logo (D-12), regardless of toggle;
  // falls back to the byte-identical matchupBare() text, never a broken box.
  // Passed as its OWN single-game render (not merely saved to storage) —
  // renderDashboardTable() takes its games list as an explicit argument, so
  // a game only reaches the render if it's IN that list.
  const manualGame = { ...games[0], gameId: 'mh_manual', isManual: true, homeLogo: null, awayLogo: null };
  const onWithManual = tableHTML(true, [manualGame]);
  assert(onWithManual.includes('Texas A&amp;M @ Alabama') && !onWithManual.includes('matrix-hdr-logo-box'),
    '1-6: a manual game (toggle ON) falls back to the byte-identical matchupBare() text, no logo markup at all (D-12)');
  assert(!/<img class="matrix-hdr-logo"[^>]*src="(null|undefined)?"/.test(onWithManual),
    '1-7: a manual game never renders a broken/null-src <img> in the header');

  // XSS — a malicious team name is escHtml()'d on the fallback path exactly
  // like everywhere else (CONVENTIONS #12). No usable logo -> the fallback
  // (escHtml(matchupBare(game))) is the path actually under test.
  const evilGame = { ...games[0], gameId: 'mh_evil', homeTeam: '<script>alert(1)</script>', isManual: false, homeLogo: null, awayLogo: null };
  const evilHtml = tableHTML(true, [evilGame]);
  assert(!/<script>alert\(1\)<\/script>/.test(evilHtml) && evilHtml.includes('&lt;script&gt;'),
    '1-8: a malicious team name is escaped even through the fallback (no usable logo) path');

  // XSS — a poisoned logo URL (attribute breakout) never breaks out of src=.
  const quoteUrl = 'https://a.espncdn.com/i/teamlogos/ncaa/500/"><script>alert(1)</script><img src="x.png';
  const poisoned = { ...games[0], gameId: 'mh_poison', homeLogo: quoteUrl, awayLogo: quoteUrl };
  const poisonHtml = tableHTML(true, [poisoned]);
  assert(!/<script>alert\(1\)<\/script>/.test(poisonHtml),
    '1-9: a "-bearing logo URL cannot inject a <script> tag via attribute breakout in the matrix header either');
  assert(poisonHtml.includes('&quot;'),
    '1-9b: …the literal double-quote in the URL is escHtml()\'d — the actual mechanism that prevents the breakout, same as pickButtonContentHTML\'s own 1b-8c in loadtest.mjs');

  // Blind-rule NON-REGRESSION control — this DI touches only the header
  // (public schedule data for BOTH teams, never a pick); the pick CELLS'
  // own blind rule (UN-116, tested exhaustively in that suite) must still
  // fire, unaffected by any of the above. Viewer (drew) HAS submitted (so
  // the render reaches the table at all — an unsubmitted viewer gets the
  // early "submit first" prompt instead, a different code path this DI
  // does not touch); the OTHER player (Brayden) has not, and the week is
  // OPEN (not yet live), so Brayden's cell must still be blind.
  const openWeekId = 'mh_w_open';
  storage.saveWeek({
    weekId: openWeekId, weekNumber: 6, season: 2026, name: 'Week 6', status: 'open',
    dataSourceMode: 'live', startDate: '2026-10-03', endDate: '2026-10-04',
    picksOpenAt: null, picksLockAt: null, tiebreakerQuestion: 'Q', actualTiebreakerValue: null,
    showInHistory: true, blurb: '', extraPointEnabled: false, extraPointActual: null, extraPointDetect: null,
  });
  const openGame = { ...games[0], gameId: 'mh_w_open_g0', weekId: openWeekId, status: 'scheduled', homeScore: null, awayScore: null, atsWinner: null, actualWinner: null,
    kickoff: new Date(Date.now() + 3 * 86400000).toISOString() };
  // hasPlayerSubmitted()/getGames() (the early public/submitted gate inside
  // renderDashboardTable()) read the STORED game list, independent of the
  // `gamesOverride` array passed into the render call below — both need it.
  storage.saveGame(openGame);
  storage.saveAllPicks([
    { pickId: 'mh_op0', weekId: openWeekId, gameId: 'mh_w_open_g0', playerId: 'pl_drew', selectedTeam: openGame.awayTeam, submittedAt: '2026-10-01T00:00:00Z' },
    { pickId: 'mh_op1', weekId: openWeekId, gameId: 'mh_w_open_g0', playerId: 'pl_brayden', selectedTeam: openGame.homeTeam, submittedAt: '2026-10-01T00:00:00Z' },
  ]);
  storage.setSession('pl_drew', false, true);
  const openPicks = storage.getPicks(openWeekId);
  const p1 = storage.getPlayer('pl_drew');
  storage.savePlayer({ ...p1, preferences: { ...p1.preferences, logoView: true } });
  const openHtml = app.renderDashboardTable(PLAYERS, [openGame], openPicks, [], openWeekId, null);
  const blindCellCount = (openHtml.match(/pick-cell-blind/g) || []).length;
  assert(blindCellCount === 1 && openHtml.includes('•••'),
    `1-10: blind-rule control — exactly ONE blind ••• pick cell (Brayden's, on this six-player/one-game render; got ${blindCellCount}) — the pick CELLS' own blind rule still fires, DI-428c did not touch it`);
  // Priority 7 (DI-T4.11) reorders the VIEWER's own column first, so the
  // first `<td class="pick-cell` in the row is drew's own and the SECOND is
  // Brayden's blind cell. (DI-T4.11's own comment: column PRESENCE — i.e.
  // Brayden's NAME in the `.player-col` header — is legitimately public,
  // "who has submitted"; what must stay hidden is WHAT he picked, inside his
  // pick cell specifically — that's what 1-10b checks.)
  const pickCellPieces = openHtml.split('<td class="pick-cell');
  const drewCellPiece = pickCellPieces[1] || '';
  const braydenCellPiece = (pickCellPieces[2] || '').slice(0, (pickCellPieces[2] || '').indexOf('</td>'));
  assert(!drewCellPiece.startsWith(' pick-cell-blind'),
    "1-10c: …while the VIEWER's own column is exempt from the blind rule — his own pick cell (reordered first, Priority 7) is never blind");
  assert(braydenCellPiece.startsWith(' pick-cell-blind') && !braydenCellPiece.includes(openGame.homeTeam) && !braydenCellPiece.includes(openGame.awayTeam),
    `1-10b: …and Brayden's own pick CELL (not the public column header) names neither team he might have picked — only the blind ••• glyph (got ${JSON.stringify(braydenCellPiece.slice(0,60))})`);
  assert(openHtml.includes('matrix-hdr-logo-box'),
    '1-10d: header logo rendering reaches this render regardless of the pick-cell blind state (both teams are PUBLIC schedule data either way)');
  storage.setSession('pl_drew', false, true);
}

console.log(`\n[1] subtotal: this far — pass=${pass} fail=${fail}`);

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] ENGINE-MEASURED — 1024px / 1280px, real css/styles.css, real markup…');
// ═════════════════════════════════════════════════════════════════════════
globalThis.fetch = realFetch;   // Part [1]'s network-disabled stub is done with
const baselineHTML = tableHTML(false);
const logoHTML = tableHTML(true);

function wrapFixture(tableHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/styles.css">
<style>body{margin:0}</style>
</head><body data-tab="dashboard">
<div class="page-wrapper">
<main class="main-content">
<section class="page-section active" id="page-dashboard">
<div class="dashboard-scroll">${tableHtml}</div>
</section>
</main>
</div>
</body></html>`;
}

const TYPES = { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/fixture-baseline.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(wrapFixture(baselineHTML)); return; }
  if (p === '/fixture-logo.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(wrapFixture(logoHTML)); return; }
  if (p === '/css/styles.css') {
    try {
      const { readFile } = await import('node:fs/promises');
      const body = await readFile(join(here, 'css', 'styles.css'));
      res.writeHead(200, { 'content-type': 'text/css' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.MATRIXHDR_ENGINE || process.env.CHATPAGE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: MATRIXHDR_ENGINE=/path/to/Chromium node matrixheadertest.mjs. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

const tmp = mkdtempSync(join(tmpdir(), 'cfbp-matrixhdr-'));
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
const results = {};
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
  const viewport = async (w, h) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(120);
  };
  const navigate = async (path) => {
    const loaded = pg.once('Page.loadEventFired');
    await pg.send('Page.navigate', { url: ORIGIN + path });
    await loaded;
    await sleep(120);
  };
  const M = `(() => {
    const scroll = document.querySelector('.dashboard-scroll');
    const cell = document.querySelector('.game-info-cell');
    const table = document.querySelector('.dashboard-table');
    const mc = document.querySelector('.main-content');
    const rows = Array.from(document.querySelectorAll('.dashboard-table tbody tr'));
    const rect = el => el ? Math.round(el.getBoundingClientRect().width) : null;
    // ROUND 2 (reviewer F1) — per-row geometry, not just the first row: the
    // reported bug was two ADJACENT rows disagreeing on shape ("TAMU @ BAMA"
    // wraps under, "OSU @ MICH" sits beside") depending on each row's own
    // content width, so this reads EVERY row's logo-box top and abbreviation
    // top, not one sample that could hide a per-row inconsistency.
    const rowGeo = rows.map(tr => {
      const logoRow = tr.querySelector('.matrix-hdr-logos');
      const box = tr.querySelector('.matrix-hdr-logo-box');
      const abbr = tr.querySelector('.matrix-hdr-abbr');
      const h = Math.round(tr.getBoundingClientRect().height);
      if (!box || !abbr || !logoRow) return { hasLogo: false, rowH: h };
      const lr = logoRow.getBoundingClientRect();
      const ar = abbr.getBoundingClientRect();
      const bt = Math.round(box.getBoundingClientRect().top);
      const at = Math.round(ar.top);
      // TRUE stacking, not merely "numerically less top" (which a
      // side-by-side, vertically-centered row can also produce, since a
      // 24px logo box's top sits a few px above a shorter text line's top
      // even when they are on the SAME visual line — the exact shape a
      // reverted flex-wrap:wrap;align-items:center row would still pass a
      // bare top-coordinate check under). Two independent geometric facts:
      // (a) same LEFT edge (one is directly under the other, not beside it)
      // and (b) the abbreviation starts at/after the logo row's BOTTOM edge
      // (no vertical overlap between the two lines).
      const sameLeft = Math.abs(Math.round(lr.left) - Math.round(ar.left)) <= 1;
      const belowBottom = Math.round(ar.top) >= Math.round(lr.bottom) - 1;
      return { hasLogo: true, rowH: h, logoTop: bt, abbrTop: at,
        logoLeft: Math.round(lr.left), abbrLeft: Math.round(ar.left), logoBottom: Math.round(lr.bottom),
        stacked: bt < at && sameLeft && belowBottom };
    });
    return {
      mainContentW: rect(mc),
      scrollClientW: scroll ? scroll.clientWidth : null,
      scrollScrollW: scroll ? scroll.scrollWidth : null,
      cellW: rect(cell),
      tableW: rect(table),
      overflowing: scroll ? (scroll.scrollWidth > scroll.clientWidth + 1) : null,
      firstRowH: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
      rowGeo,
    };
  })()`;

  for (const width of [375, 390, 1024, 1280]) {
    await viewport(width, 900);
    await navigate('/fixture-baseline.html');
    const base = await evaluate(M);
    await navigate('/fixture-logo.html');
    const logo = await evaluate(M);
    results[width] = { base, logo };

    assert(base.mainContentW !== null && base.cellW !== null,
      `2-${width}-0: fixture — the baseline fixture rendered a real .main-content/.game-info-cell at ${width}px`);
    assert(logo.mainContentW !== null && logo.cellW !== null,
      `2-${width}-0b: fixture — the logo-view fixture rendered a real .main-content/.game-info-cell at ${width}px`);
    assert(base.mainContentW === logo.mainContentW,
      `2-${width}-1: fixture — .main-content itself is the same width in both renders (${base.mainContentW} vs ${logo.mainContentW}px) — any .game-info-cell delta below is the header treatment, not a container difference`);

    // ── F1 — STACKED, not "wraps depending on content", on EVERY row ──
    const withLogo = logo.rowGeo.filter(r => r.hasLogo);
    assert(withLogo.length === logo.rowGeo.length && withLogo.length > 0,
      `2-${width}-2: fixture — every row in the logo-view render actually has both a .matrix-hdr-logo-box and a .matrix-hdr-abbr (got ${withLogo.length}/${logo.rowGeo.length})`);
    const notStacked = withLogo.filter(r => !r.stacked);
    assert(notStacked.length === 0,
      `2-${width}-3: EVERY row has the logo pair ABOVE the abbreviation (logoTop < abbrTop) — not a per-row wrap decision (got ${notStacked.length}/${withLogo.length} rows NOT stacked: ${JSON.stringify(notStacked.slice(0, 3))})`);
    // Same shape on every row — the reported bug was ADJACENT rows disagreeing.
    const gaps = withLogo.map(r => r.abbrTop - r.logoTop);
    const gapSpread = Math.max(...gaps) - Math.min(...gaps);
    assert(gapSpread <= 2,
      `2-${width}-4: every row stacks with the SAME (logoTop, abbrTop) gap, within 2px rounding — no row wraps differently from its neighbor (gaps: ${JSON.stringify(gaps)}, spread ${gapSpread}px)`);

    // ── Row-height cost — RECORDED, per the coordinator's instruction (the
    //    DI's "breaks the matrix" clause was width-only; this states the
    //    vertical cost honestly rather than letting it pass unmeasured). ──
    const rowHDelta = logo.firstRowH - base.firstRowH;

    const cellDelta = logo.cellW - base.cellW;
    const tableDelta = logo.tableW - base.tableW;
    console.log(`     [measurement @ ${width}px] .game-info-cell: ${base.cellW}px -> ${logo.cellW}px (Δ${cellDelta >= 0 ? '+' : ''}${cellDelta}px)   .dashboard-table: ${base.tableW}px -> ${logo.tableW}px (Δ${tableDelta >= 0 ? '+' : ''}${tableDelta}px)   row height: ${base.firstRowH}px -> ${logo.firstRowH}px (Δ${rowHDelta >= 0 ? '+' : ''}${rowHDelta}px)   overflowing (scroll>client): base=${base.overflowing} logo=${logo.overflowing}`);
  }
} catch (e) {
  assert(false, `[2] the engine-measured pass threw — ${e?.message || e}`);
} finally {
  server.close();
  if (engine) engine.proc.kill();
}

// ── THE VERDICT ──────────────────────────────────────────────────────────
// Per DI-428(c): the logo stays if it does not widen the .game-info-cell (or
// force the table into new horizontal overflow it didn't already have) at
// EITHER 1024px or 1280px. A positive delta at either width is "it broke the
// column width" and the shipped code must fall back to abbreviation-only —
// this assertion is the one the whole suite exists to run.
if (results[1024] && results[1280]) {
  const grew = (w) => results[w].logo.cellW > results[w].base.cellW;
  const newOverflow = (w) => !results[w].base.overflowing && results[w].logo.overflowing;
  const broke1024 = grew(1024) || newOverflow(1024);
  const broke1280 = grew(1280) || newOverflow(1280);
  assert(!broke1024,
    `VERDICT-1024: .game-info-cell must not widen at 1024px for the logo to ship there (base ${results[1024].base.cellW}px, logo ${results[1024].logo.cellW}px)`);
  assert(!broke1280,
    `VERDICT-1280: .game-info-cell must not widen at 1280px for the logo to ship there (base ${results[1280].base.cellW}px, logo ${results[1280].logo.cellW}px)`);
  console.log(`\n  ${(!broke1024 && !broke1280) ? 'VERDICT: logo SHIPS (no column growth at 1024 or 1280).' : 'VERDICT: logo must be SKIPPED at the width(s) that grew — code does not yet reflect this if the assertions above are red.'}`);

  // Row-height cost — the DI's "breaks the matrix" clause is width-only and
  // says nothing about height; stacking (round 2, F1) has a real vertical
  // cost, recorded here per the coordinator's instruction rather than left
  // unstated.
  for (const w of [375, 390, 1024, 1280]) {
    if (!results[w]) continue;
    const d = results[w].logo.firstRowH - results[w].base.firstRowH;
    console.log(`  ROW HEIGHT @ ${w}px: ${results[w].base.firstRowH}px -> ${results[w].logo.firstRowH}px (Δ${d >= 0 ? '+' : ''}${d}px per row, stacked layout)`);
  }
}

console.log(`\n══════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
