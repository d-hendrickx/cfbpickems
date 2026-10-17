/**
 * CFB Pickems — gdseamtest.mjs (Deployment 1, Lane B Game Day, the consolidated round: the Lane A seam on the app side, 2026-10-08)
 * ==============================================================================================================================
 * Game Day, the Game view and the card detail were built before Lane A's sport model landed, with placeholders where the sport plugs in. The merge of int wires them. This suite drives the REAL app.js over the
 * real index.html (minidom.mjs, the d1wiringtest way) in a league that runs TWO sports, and taps each control through its real dispatcher:
 *
 *   [1] Game Day's footer "Open Dashboard" with scope 'all' opens the Dashboard's All sports view (getDashboardScope() === 'all'); a sport scope opens THAT sport's Dashboard; a one-sport league is as before
 *   [2] "Make your picks" on a Game view opens THAT game's sport and week, even with the pointer on the other sport
 *   [3] What's next's "Make your NFL picks" sets the sport AND the week
 *   [4] openSportWeek (the card detail's "Open Dashboard" / "Make your picks"): the week's OWN sport; an unknown week moves nothing
 *   [5] the league overview's "{n} live now" chip: the sport ops carry openGameDay, and it opens Home with Game Day open
 *   [6] the All sports Sort row (DI-607 REV 3): drawn, reads the EFFECTIVE mode (a saved Custom reads Kickoff time and is never overwritten), the sheet's Custom is disabled, Live first reorders the
 *       combined slate, and a saved Live first orders the first paint (dashboardSavedSortMode is the member's saved mode)
 *   [7] MUTATION PROOFS — scratch copies of app.js loaded as data: URLs (never the file)
 *
 * Run:  node gdseamtest.mjs
 */
import { readFileSync } from 'node:fs';
import { MiniDocument } from './minidom.mjs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in gdseamtest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollY = 0;
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const INDEX = read('./index.html');
const APP = read('./js/app.js');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); const m = INDEX.match(/<body[^>]*data-tab="([^"]*)"/); if (m) doc.body.dataset.tab = m[1]; doc.body.innerHTML = bodyHtmlOf(INDEX); return doc; };
globalThis.document = freshDoc();

quiet();
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const comp = await import('./js/competition.js');
const ps = await import('./js/pushed-screen.js');
loud();

// ── the league: two sports (CFB the default, NFL the second), every member in both ──────────────────────────────────────────────────────────────────────
const LEAGUE = 'L-gdseam-0001';
const CID = { cfb: '11111111-1111-4111-8111-111111111111', nfl: '22222222-2222-4222-8222-222222222222' };
const HOUR = 3600e3, NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const PLAYERS = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ playerId: id, displayName: ['Drew', 'Brayden', 'Kevin', 'Koby'][i], initials: ['DH', 'BR', 'KC', 'KR'][i], active: true, preferences: {} }));
const mkGame = (weekId, gameId, home, away, at, extra = {}) => ({
  gameId, weekId, espnEventId: null, dataQuality: 'manual', dataSource: 'manual', homeTeam: home, awayTeam: away, homeRank: null, awayRank: null,
  kickoff: iso(NOW + at * HOUR), kickoffConfirmed: true, spread: -3.5, favorite: home, lockedSpread: null, homeScore: null, awayScore: null, status: 'scheduled',
  actualWinner: null, atsWinner: null, isAlmaMaterGame: false, lastUpdated: null, multiplier: 1, ...extra,
});
const mkWeek = (weekId, weekNumber, status, extra = {}) => ({ weekId, weekNumber, season: 2026, name: `Week ${weekNumber}`, status, dataSourceMode: 'live', picksLockAt: null, tiebreakerQuestion: 'Total points?', showInHistory: true, createdAt: iso(NOW - 10 * 24 * HOUR), ...extra });
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function seed({ sports = ['cfb', 'nfl'], gameOrder = null, nflPicked = false, nflPlayers = null } = {}) {
  store.clear();
  localStorage.setItem('cfbp_supabase_active_league', LEAGUE);
  const comps = sports.map((sp, i) => ({ id: CID[sp], sport: sp, kind: 'season', enrollment: sp === 'nfl' && nflPlayers ? 'opt_in' : 'all', isDefault: i === 0, archivedAt: null, activeWeekId: null, settings: {}, createdAt: `2026-0${i + 1}-01T00:00:00.000Z` }));
  const cidOf = (sp) => (sp === sports[0] ? {} : { competitionId: CID[sp] });
  const weeks = [], games = [], picks = [], results = [];
  if (sports.includes('cfb')) {
    weeks.push(mkWeek('w_cfb_1', 1, 'final', cidOf('cfb')), mkWeek('w_cfb_2', 2, 'live', { ...cidOf('cfb'), picksLockAt: iso(NOW - 6 * HOUR) }));
    games.push(mkGame('w_cfb_1', 'c1', 'Texas', 'Oklahoma', -7 * 24, { status: 'final', homeScore: 28, awayScore: 21, actualWinner: 'Texas', atsWinner: 'Texas', lastUpdated: iso(NOW - 6 * 24 * HOUR) }));
    games.push(mkGame('w_cfb_2', 'c3', 'Georgia', 'Alabama', -4, { status: 'final', homeScore: 24, awayScore: 20, actualWinner: 'Georgia', atsWinner: 'Georgia', lastUpdated: iso(NOW - HOUR) }));   // kicked off FIRST, already over
    games.push(mkGame('w_cfb_2', 'c2', 'Michigan', 'Ohio State', -1, { status: 'live', homeScore: 10, awayScore: 7 }));                                                                   // kicked off later, still live
    for (const p of PLAYERS) {
      picks.push({ pickId: `pk_c1_${p.playerId}`, weekId: 'w_cfb_1', gameId: 'c1', playerId: p.playerId, selectedTeam: 'Texas', submittedAt: iso(NOW - 8 * 24 * HOUR) });
      for (const g of ['c2', 'c3']) picks.push({ pickId: `pk_${g}_${p.playerId}`, weekId: 'w_cfb_2', gameId: g, playerId: p.playerId, selectedTeam: g === 'c2' ? 'Michigan' : 'Georgia', submittedAt: iso(NOW - 8 * HOUR) });
      results.push({ weekId: 'w_cfb_1', playerId: p.playerId, rank: 1, correctPicks: 1, incorrectPicks: 0, correctCount: 1, incorrectCount: 0, noDecisions: 0, isWinner: p.playerId === 'p1', isLoser: false });
    }
  }
  if (sports.includes('nfl')) {
    weeks.push(mkWeek('w_nfl_1', 1, 'final', cidOf('nfl')), mkWeek('w_nfl_2', 2, 'open', { ...cidOf('nfl'), picksLockAt: iso(NOW + 24 * HOUR) }));
    games.push(mkGame('w_nfl_1', 'n1', 'Bills', 'Jets', -7 * 24, { status: 'final', homeScore: 20, awayScore: 10, actualWinner: 'Bills', atsWinner: 'Bills', lastUpdated: iso(NOW - 6 * 24 * HOUR) }));
    games.push(mkGame('w_nfl_2', 'n2', 'Chiefs', 'Raiders', 30), mkGame('w_nfl_2', 'n3', 'Lions', 'Bears', 33));
    for (const p of PLAYERS) {
      picks.push({ pickId: `pk_n1_${p.playerId}`, weekId: 'w_nfl_1', gameId: 'n1', playerId: p.playerId, selectedTeam: 'Bills', submittedAt: iso(NOW - 8 * 24 * HOUR) });
      results.push({ weekId: 'w_nfl_1', playerId: p.playerId, rank: 1, correctPicks: 1, incorrectPicks: 0, correctCount: 1, incorrectCount: 0, noDecisions: 0, isWinner: p.playerId === 'p1', isLoser: false });
    }
    // the viewer's own NFL Week 2 slate, when a test needs the NFL rows on All sports (an unsubmitted, not-yet-public week shows the per-sport "Submit your NFL picks" gate instead)
    if (nflPicked) for (const g of ['n2', 'n3']) picks.push({ pickId: `pk_${g}_p1`, weekId: 'w_nfl_2', gameId: g, playerId: 'p1', selectedTeam: g === 'n2' ? 'Chiefs' : 'Lions', submittedAt: iso(NOW - HOUR) });
  }
  put('cfbp_competitions', sports.length > 1 ? comps : []);
  put('cfbp_competition_members', nflPlayers ? nflPlayers.map((m) => ({ id: `${CID.nfl}:${m}`, competitionId: CID.nfl, memberId: m, enrolledBy: 'self', joinedAt: '2026-09-01T00:00:00.000Z' })) : []);   // nflPlayers: NFL is opt-in and only they joined
  put('cfbp_players', PLAYERS.map((p) => ({ ...p, preferences: gameOrder ? { gameOrder: { mode: gameOrder } } : {} })));
  put('cfbp_weeks', weeks);
  put('cfbp_games', games);
  put('cfbp_picks', picks);
  put('cfbp_weekly_results', results);
  put('cfbp_session', { playerId: 'p1', isAdmin: false, playerVerified: true });
}
const reset = () => { try { ps.closeAllScreens('test'); } catch {} globalThis.document = freshDoc(); app._resetHomeWiringForTest(); app.state.currentTab = 'home'; app.state.viewingWeekId = null; globalThis.scrollY = 0; };
const go = (tab) => { quiet(); try { app._navigateToForTest(tab); } finally { loud(); } };
const tap = (n) => { quiet(); try { n.dispatchEvent({ type: 'click', target: n }); } finally { loud(); } };
const pageHtml = (id) => document.getElementById(id)?.innerHTML || '';
const rowIds = () => document.getElementById('page-dashboard').querySelectorAll('.dashboard-compact .dc-game[data-game-id]').map((n) => n.getAttribute('data-game-id'));

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] Game Day\'s footer "Open Dashboard" applies its scope…');
{
  seed(); reset(); go('home');
  assert(comp.isMultiSport() === true && comp.playedSports().length === 2, '1-0: (fixture) a league that runs CFB and NFL, the viewer plays both');
  quiet(); app.openGameDay({}); loud();
  const foot = document.getElementById('page-home').querySelector('[data-home-action="gd-dashboard"]');
  assert(!!foot && foot.getAttribute('data-scope') === 'all', `1a: (fixture) the open Game Day card's footer carries scope "all" (the viewer plays both sports) (${foot && foot.getAttribute('data-scope')})`);
  if (foot) tap(foot);
  await wait(20);
  assert(app.state.currentTab === 'dashboard' && comp.getDashboardScope() === comp.DASHBOARD_ALL && /all-sports-weeknav/.test(pageHtml('page-dashboard')), `1b: the tap opens the Dashboard's ALL SPORTS view (scope ${comp.getDashboardScope()}, tab ${app.state.currentTab})`);
  // a sport scope (forged onto the footer, then re-validated by home.js against the card's own sports): THAT sport's Dashboard, never All sports
  comp.setDashboardScope(null); comp.setActiveSportKey('cfb');
  reset(); go('home'); quiet(); app.openGameDay({}); loud();
  const f2 = document.getElementById('page-home').querySelector('[data-home-action="gd-dashboard"]');
  f2.setAttribute('data-scope', 'nfl');
  tap(f2);
  await wait(20);
  assert(app.state.currentTab === 'dashboard' && comp.getActiveSportKey() === 'nfl' && comp.getDashboardScope() !== comp.DASHBOARD_ALL && app.state.viewingWeekId === null, `1c: a sport scope opens THAT sport's Dashboard on its current week (pointer ${comp.getActiveSportKey()}, scope ${comp.getDashboardScope()}, week ${app.state.viewingWeekId})`);
  comp.setActiveSportKey('cfb');
  reset(); go('home'); quiet(); app.openGameDay({}); loud();
  const f3 = document.getElementById('page-home').querySelector('[data-home-action="gd-dashboard"]');
  f3.setAttribute('data-scope', 'nhl');
  tap(f3);
  await wait(20);
  assert(app.state.currentTab === 'dashboard' && comp.getActiveSportKey() === 'cfb' && comp.getDashboardScope() !== comp.DASHBOARD_ALL, '1d: a scope the card does not hold (forged "nhl") moves nothing: the pointer sport\'s single Dashboard');
  // one sport: exactly as before (no pointer write, the current week)
  seed({ sports: ['cfb'] }); reset(); go('home');
  app.state.viewingWeekId = 'w_cfb_1';
  quiet(); app._openDashboardFromGameDayForTest('cfb'); loud();
  assert(comp.isMultiSport() === false && app.state.currentTab === 'dashboard' && app.state.viewingWeekId === null && store.get('cfbp_active_sport') === undefined, '1e: a one-sport league opens the Dashboard on the current week and writes no sport pointer');
  // Reviewer G5 (2026-10-14): a FORGED "all" from a member who plays ONE sport of the two: never All sports — the pointer sport's single Dashboard, on its CURRENT week, the pointer untouched
  seed({ nflPlayers: ['p2', 'p3'] }); comp.setDashboardScope(null); comp.setActiveSportKey('cfb'); reset(); go('home');
  quiet(); app.openGameDay({}); loud();
  const f4 = document.getElementById('page-home').querySelector('[data-home-action="gd-dashboard"]');
  assert(comp.isMultiSport() === true && comp.playedSports().length === 1 && !!f4 && f4.getAttribute('data-scope') !== 'all', `1f-0: (fixture) p1 plays CFB only (NFL is opt-in, he never joined); his footer's own scope is not "all" (${f4 && f4.getAttribute('data-scope')})`);
  if (f4) f4.setAttribute('data-scope', 'all');
  app.state.viewingWeekId = 'w_cfb_1';                       // he was looking at an earlier week
  if (f4) tap(f4);
  await wait(20);
  assert(app.state.currentTab === 'dashboard' && comp.getDashboardScope() !== comp.DASHBOARD_ALL && !/all-sports-weeknav/.test(pageHtml('page-dashboard')) && app.state.viewingWeekId === null && comp.getActiveSportKey() === 'cfb',
    `1f: a forged "all" from a one-sport member opens NO All sports view: his sport's Dashboard on its current week, the pointer untouched (scope ${comp.getDashboardScope()}, week ${app.state.viewingWeekId}, pointer ${comp.getActiveSportKey()})`);
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] "Make your picks" on a Game view opens THAT game\'s sport and week…');
{
  seed(); comp.setActiveSportKey('cfb'); reset(); go('home');
  quiet(); app._openGameViewForTest('n2'); loud();
  const b = document.getElementById('pushed-root')?.querySelector('.ps-level:last-child [data-gv-action="make-picks"]');
  assert(!!b, '2-0: (fixture) the Game view of an open NFL game the viewer has not picked offers "Make your picks"');
  if (b) tap(b);
  await wait(ps.EXIT_FALLBACK_MS + 100);
  assert(app.state.currentTab === 'picks' && comp.getActiveSportKey() === 'nfl' && app.state.viewingWeekId === null, `2a: the tap moves the pointer to NFL and opens NFL's Picks on that week (pointer ${comp.getActiveSportKey()}, tab ${app.state.currentTab}, week ${app.state.viewingWeekId})`);
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3] What\'s next\'s "Make your NFL picks" sets the sport AND the week…');
{
  seed(); comp.setActiveSportKey('cfb'); reset(); go('home');
  quiet(); app._openGameViewForTest('c1'); loud();
  const b = document.getElementById('pushed-root')?.querySelector('.ps-level:last-child [data-gv-action="next-picks"]');
  assert(!!b && /Make your NFL picks/.test(b.textContent), `3-0: (fixture) a FINAL CFB game's What's next offers "Make your NFL picks" (${b ? b.textContent.trim() : 'none'})`);
  if (b) tap(b);
  await wait(ps.EXIT_FALLBACK_MS + 100);
  assert(app.state.currentTab === 'picks' && comp.getActiveSportKey() === 'nfl' && app.state.viewingWeekId === null, `3a: the tap opens NFL's Picks on NFL Week 2 (pointer ${comp.getActiveSportKey()}, week ${app.state.viewingWeekId})`);
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[4] openSportWeek: the card detail\'s "Open Dashboard" and "Make your picks" go to the week\'s OWN sport…');
{
  seed(); comp.setActiveSportKey('cfb'); reset(); go('home');
  quiet(); app._openSportWeekForTest('dashboard', 'w_nfl_1', { source: 'card' }); loud();
  assert(app.state.currentTab === 'dashboard' && comp.getActiveSportKey() === 'nfl' && app.state.viewingWeekId === 'w_nfl_1', `4a: an NFL week that is not NFL's current one: the pointer moves to NFL and the Dashboard opens ON that week (${app.state.viewingWeekId})`);
  comp.setActiveSportKey('cfb'); reset(); go('home');
  quiet(); app._openSportWeekForTest('picks', 'w_cfb_2', { source: 'card' }); loud();
  assert(app.state.currentTab === 'picks' && comp.getActiveSportKey() === 'cfb' && app.state.viewingWeekId === null, '4b: CFB\'s current week from CFB: the current week is stored as null (the shared convention)');
  comp.setActiveSportKey('cfb'); reset(); go('home'); app.state.viewingWeekId = 'w_cfb_1';
  quiet(); app._openSportWeekForTest('dashboard', 'no-such-week', { source: 'card' }); loud();
  assert(app.state.currentTab === 'dashboard' && comp.getActiveSportKey() === 'cfb' && app.state.viewingWeekId === 'w_cfb_1', '4c: a week that does not exist moves nothing: no pointer change, no week written, the tab as it stands');
  const src = APP.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(/if \(act === 'go-picks'\) \{ openSportWeek\('picks', weekId, \{ source: 'card' \}\); return; \}/.test(src) && /if \(act === 'go-dashboard'\) \{ openSportWeek\('dashboard', weekId, \{ source: 'card' \}\); return; \}/.test(src),
    '4d: the card detail\'s two tab buttons call openSportWeek with the week the detail\'s model validated (onCardDetailClick re-resolves the model before it acts)');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5] The league overview\'s "{n} live now" chip opens Game Day (the sport ops)…');
{
  seed(); reset(); go('dashboard');
  const ops = app.buildSportOps({});
  assert(typeof ops.openGameDay === 'function', '5a: the sport ops carry openGameDay (the overview chip calls _sportOps.openGameDay())');
  quiet(); ops.openGameDay(); loud();
  assert(app.state.currentTab === 'home' && /data-gd-expanded="true"/.test(pageHtml('page-home')), '5b: calling it switches to Home with the Game Day card OPEN in place');
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6] The All sports Sort row (DI-607 REV 3)…');
{
  seed({ gameOrder: 'manual', nflPicked: true }); comp.setDashboardScope(comp.DASHBOARD_ALL); reset(); go('dashboard');
  const page = document.getElementById('page-dashboard');
  const sortBtn = page.querySelector('[data-dc-action="sort"]');
  assert(/all-sports-weeknav/.test(page.innerHTML) && !!sortBtn && sortBtn.getAttribute('aria-label') === 'Sort games. Currently Kickoff time.', `6a: All sports draws the Sort row, and a saved Custom reads as Kickoff time there (${sortBtn && sortBtn.getAttribute('aria-label')})`);
  assert(storage.getGameOrderMode() === 'manual', '6b: …and the saved mode is NOT overwritten by the view (back in one sport the arrangement is as the member left it)');
  assert(rowIds().join() === 'c3,c2,n2,n3', `6c: kickoff order across sports (the finished CFB game kicked off first) (${rowIds().join()})`);
  if (sortBtn) tap(sortBtn);
  const wrap = document.getElementById('sort-sheet-wrap');
  const custom = wrap ? wrap.querySelector('[data-mode="manual"]') : null;
  assert(!!wrap && !!custom && custom.hasAttribute('disabled'), '6d: the Sort button opens the sheet, and Custom is DISABLED in All sports');
  const liveFirst = wrap ? wrap.querySelector('[data-mode="live-first"]') : null;
  if (liveFirst) tap(liveFirst);
  assert(storage.getGameOrderMode() === 'live-first' && rowIds().join() === 'c2,n2,n3,c3', `6e: choosing Live first saves it and reorders the combined slate: live, then not started, then final (${rowIds().join()})`);
  quiet(); try { app._closeSortSheetForTest({ immediate: true }); } catch {} loud();
  // a fresh paint with Live first already saved: the first paint is ordered by it (dashboardSavedSortMode is the member's saved mode)
  seed({ gameOrder: 'live-first', nflPicked: true }); comp.setDashboardScope(comp.DASHBOARD_ALL); reset(); go('dashboard');
  assert(rowIds().join() === 'c2,n2,n3,c3' && document.getElementById('page-dashboard').querySelector('[data-dc-action="sort"]')?.getAttribute('aria-label') === 'Sort games. Currently Live first.', `6f: a saved Live first orders the first paint of All sports and the button says so (${rowIds().join()})`);
  comp.setDashboardScope(null);
}

// ═══ [6b] ════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6b] DI-588: a sport pill IS a chat filter pill — tapped for real, it ends the Back chip…');
{
  seed(); comp.setActiveSportKey('cfb'); reset(); go('home');
  quiet(); app._openGameViewForTest('c2'); loud();
  const lr = document.getElementById('pushed-root')?.querySelector('.ps-level:last-child [data-gv-action="locker-room"]');
  if (lr) tap(lr);
  await wait(ps.EXIT_FALLBACK_MS + 100);
  const chainBefore = app._readingChainForTest();
  const pill = document.getElementById('page-chat')?.querySelector('[data-chat-sport-filter="nfl"]');
  assert(app.state.currentTab === 'chat' && !!chainBefore && !!pill && !!document.getElementById('page-chat').querySelector('[data-chat-return]'), '6b-0: (fixture) "Locker Room" from a Game view lands on Chat with the Back chip, and the sport row is drawn (two sports)');
  if (pill) tap(pill);
  assert(app._readingChainForTest() === null, `6b-1: a REAL tap on the NFL pill (bindFilterButtons' own listener) ends the Back chip, as a filter pill tap does (chain ${JSON.stringify(app._readingChainForTest())})`);
  reset();
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[7] MUTATION PROOFS — scratch copies of app.js loaded as data: URLs (never the file)…');
{
  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace(/(from\s+|import\s*\(\s*)'\.\/([\w./-]+)'/g, (_m, pre, f) => `${pre}'${base}${f}'`);
  const R = (a, b) => { if (APP.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return APP.replace(a, b); };
  const probe = async (m) => {
    const o = {};
    const resetM = () => { try { ps.closeAllScreens('test'); } catch {} globalThis.document = freshDoc(); m._resetHomeWiringForTest(); m.state.currentTab = 'home'; m.state.viewingWeekId = null; };
    seed(); comp.setDashboardScope(null); comp.setActiveSportKey('cfb'); resetM(); quiet(); m._navigateToForTest('home'); m._openDashboardFromGameDayForTest('all'); loud();
    o.allScope = comp.getDashboardScope() === comp.DASHBOARD_ALL;
    comp.setDashboardScope(null); comp.setActiveSportKey('cfb'); resetM(); quiet(); m._navigateToForTest('home'); m._openSportWeekForTest('dashboard', 'w_nfl_1'); loud();
    o.sportWeek = comp.getActiveSportKey() === 'nfl' && m.state.viewingWeekId === 'w_nfl_1';
    o.ops = typeof m.buildSportOps({}).openGameDay === 'function';
    seed({ nflPlayers: ['p2', 'p3'] }); comp.setDashboardScope(null); comp.setActiveSportKey('cfb'); resetM(); quiet(); m._navigateToForTest('home'); loud();
    m.state.viewingWeekId = 'w_cfb_1';
    quiet(); m._openDashboardFromGameDayForTest('all'); loud();
    o.forgedAll = comp.getDashboardScope() !== comp.DASHBOARD_ALL && m.state.viewingWeekId === null && comp.getActiveSportKey() === 'cfb';
    for (const [key, gid, act] of [['makePicks', 'n2', 'make-picks'], ['nextPicks', 'c1', 'next-picks']]) {
      seed(); comp.setActiveSportKey('cfb'); resetM(); quiet(); m._navigateToForTest('home'); m._openGameViewForTest(gid); loud();
      const b = document.getElementById('pushed-root')?.querySelector(`.ps-level:last-child [data-gv-action="${act}"]`);
      if (b) tap(b);
      await wait(ps.EXIT_FALLBACK_MS + 100);
      o[key] = !!b && m.state.currentTab === 'picks' && comp.getActiveSportKey() === 'nfl';
    }
    seed({ gameOrder: 'live-first', nflPicked: true }); comp.setDashboardScope(comp.DASHBOARD_ALL); resetM(); quiet(); m._navigateToForTest('dashboard'); loud();
    o.savedMode = rowIds().join() === 'c2,n2,n3,c3';
    o.sortRow = !!document.getElementById('page-dashboard').querySelector('[data-dc-action="sort"]');
    comp.setDashboardScope(null);
    return o;
  };
  const mutants = [
    ['openDashboardFromGameDay ignores its scope again (the placeholder)', R("  if (isMultiSport() && !isContentWithheld()) {\n    const played = playedSports();", "  if (false) {\n    const played = playedSports();"), 'allScope'],
    ['openSportWeek takes the week but never the sport (the pre-merge go-dashboard)', R("    if (comp && typeof comp.sport === 'string' && comp.sport) return enterSportContext(comp.sport, { tab, weekId: w.weekId, source });", "    if (comp && false) return null;\n    if (w) state.viewingWeekId = w.weekId;"), 'sportWeek'],
    ['"Make your picks" on a Game view opens Picks without its sport (the pre-merge tap)', R("openSportWeek('picks', getGame(st.gameId)?.weekId || null, { source: 'game' }); return; }", "navigateTo('picks'); return; }"), 'makePicks'],
    ['"Make your NFL picks" sets the week but not the sport (the pre-merge LANE A SEAM placeholder)', R("      openSportWeek('picks', n.weekId, { source: 'whats-next' });", "      state.viewingWeekId = (n.weekId === getCurrentWeek()?.weekId) ? null : n.weekId;\n      navigateTo('picks');"), 'nextPicks'],
    ['reviewer G5: "all" is honoured for a member who plays ONE sport (the guard loosened to >= 1)', R("    if (scope === DASHBOARD_ALL && played.length >= 2) {", "    if (scope === DASHBOARD_ALL && played.length >= 1) {"), 'forgedAll'],
    ['the sport ops lose openGameDay', R("const ops = { weekInCount: sportWeekInCountText, openGameDay: () => openGameDay({ source: 'overview' }) };", "const ops = { weekInCount: sportWeekInCountText };"), 'ops'],
    ['the saved sort mode is the placeholder again', R("function dashboardSavedSortMode() { const m = getGameOrderMode(); return m === 'live-first' ? 'live' : m; }", "function dashboardSavedSortMode() { return 'kickoff'; }"), 'savedMode'],
    ['the saved mode is passed in the Dashboard\'s words ("live-first"), which all-sports.js reads as Kickoff', R("function dashboardSavedSortMode() { const m = getGameOrderMode(); return m === 'live-first' ? 'live' : m; }", "function dashboardSavedSortMode() { return getGameOrderMode(); }"), 'savedMode'],
    ['All sports draws no Sort row', R("  const sortRowHTML = session && session.playerId && shownGames.length >= 2", "  const sortRowHTML = false && session && session.playerId && shownGames.length >= 2"), 'sortRow'],
  ];
  const baseRes = await probe(app);
  assert(Object.values(baseRes).every(Boolean), `7-0: the probe is GREEN on the real app.js (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  for (const [name, src, check] of mutants) {
    let res;
    try {
      quiet();
      const mod = await import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random());
      loud();
      res = await probe(mod);
    } catch (err) { loud(); res = { [check]: 'ERR ' + String(err.message).slice(0, 90) }; }
    assert(src !== APP && res[check] === false, `7: mutant "${name}" turns ${check} RED${typeof res[check] === 'string' ? ' (' + res[check] + ')' : ''}`);
  }
}

_log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
