/**
 * CFB Pickems — logotoggletest.mjs (RG-TBD-N15, live v0.27.2, 2026-09-29)
 * =========================================================================
 * Drew, verbatim: "i toggle off the logos but theyre still there on the
 * dashboard".
 *
 * ROOT CAUSE (proved in [2] below). The Team-logos row in the control-center
 * drawer calls `onSetLogoView` (js/app.js buildControlCenterCtx()), which
 * wrote `player.preferences.logoView` and then repainted ONLY THE DRAWER
 * (`refreshControlCenterAndSettingsPage()` — "it now updates the drawer
 * alone"). Every logo render path reads `getLogoView()` at RENDER TIME, so
 * the page under the drawer kept the markup it was painted with until some
 * unrelated repaint happened to fire: a navigation to another tab, a live
 * score tick, or a Realtime games/weeks/picks/league_kv event.
 * `league_members` is not a subscribed Realtime table, so the player's own
 * preference write never echoes back as a repaint either. On a quiet
 * Tuesday, with the player already on Dashboard, that is "forever".
 *
 * Run:  node logotoggletest.mjs
 * Also: TZ=UTC node logotoggletest.mjs && TZ=America/Los_Angeles node logotoggletest.mjs
 *
 * Covers, in order:
 *   [1] EVERY render path that emits a team logo honors the toggle in BOTH
 *       states — the Picks card's pick buttons (pre-submission), the
 *       submitted/result card, the Standard dashboard matrix header, the
 *       Compact dashboard chips, and the commissioner Games tab's pool and
 *       slate rows. Plus two negative controls (Alma Mater Watch and the
 *       Standings page render no team logos in either state).
 *   [2] THE BUG — the REAL drawer callback, `onSetLogoView`, repaints the
 *       page under the drawer, in both directions, on Dashboard (Standard AND
 *       Compact) and on Picks (open-week buttons AND final-week result card).
 *       Each direction starts from a page freshly painted in the OPPOSITE
 *       state, so neither half can pass on stale markup.
 *   [3] Structural guard — every `logoOk(` read of a game's logo in
 *       js/app.js sits on a line that also reads the toggle, so a sixth logo
 *       path added later without the gate fails here, not on Drew's phone.
 *   [4] The same bug class across the drawer's other handlers (coordinator
 *       sweep, 2026-09-29): onSetTimeZone (kickoff times, both directions,
 *       Picks + Dashboard), onSaveDisplayName and onSaveInitials repaint the
 *       page under the drawer; onSetTheme / onSetColorScheme are proved
 *       CSS-only (identical page markup under two values), so they need none.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── DOM / localStorage stubs (almatest.mjs shape — registered elements that
//    hold real innerHTML, so navigateTo()'s page renders land somewhere this
//    file can read back) ─────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const registry = new Map();
function makeEl(id) {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
function el(id) { if (!registry.has(id)) registry.set(id, makeEl(id)); return registry.get(id); }
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => (typeof sel === 'string' && sel.startsWith('#') ? registry.get(sel.slice(1)) || null : null),
  querySelectorAll: () => [],
  createElement: () => makeEl('__created__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in logotoggletest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log('\n[0] Importing js/storage.js + js/app.js…');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
assert(typeof app._buildControlCenterCtxForTest === 'function', '0-1: fixture — the real drawer ctx builder is reachable (_buildControlCenterCtxForTest)');
assert(typeof app.renderGameCard === 'function' && typeof app.renderDashboardTable === 'function'
  && typeof app.renderDashboardCompact === 'function' && typeof app.renderAvailableGamesList === 'function'
  && typeof app.renderAdminGamesList === 'function', '0-2: fixture — every logo render path is exported for direct rendering');

// ── Fixture ────────────────────────────────────────────────────────────────
storage.setBackendMode('local');
el('page-dashboard'); el('page-picks'); el('page-leaderboard'); el('toast-container');

const LOGO = (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
// Any of these in markup means a team logo was drawn.
const LOGO_MARKERS = ['pick-btn-logo', 'team-name-logo', 'matrix-hdr-logo', 'dc-chip-logo', 'slate-row-logo', 'a.espncdn.com/i/teamlogos'];
const hasLogo = (html) => LOGO_MARKERS.some(m => String(html || '').includes(m));
const whichLogo = (html) => LOGO_MARKERS.filter(m => String(html || '').includes(m)).join(', ') || 'none';

const PLAYERS = [
  { playerId: 'lt_drew',    displayName: 'Drew',    initials: 'DH', active: true, preferences: {} },
  { playerId: 'lt_brayden', displayName: 'Brayden', initials: 'BR', active: true, preferences: {} },
  { playerId: 'lt_kevin',   displayName: 'Kevin',   initials: 'KV', active: true, preferences: {} },
  { playerId: 'lt_koby',    displayName: 'Koby',    initials: 'KB', active: true, preferences: {} },
  { playerId: 'lt_jacob',   displayName: 'Jacob',   initials: 'JC', active: true, preferences: {} },
  { playerId: 'lt_kihoon',  displayName: 'Kihoon',  initials: 'KH', active: true, preferences: {} },
];
PLAYERS.forEach(p => storage.addPlayer(p));

function week(o) {
  return {
    season: 2026, dataSourceMode: 'live', startDate: '2026-09-26', endDate: '2026-09-27',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    tiebreakerQuestion: 'Total points?', actualTiebreakerValue: 45, tiebreakerFinalized: false,
    showInHistory: true, blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    extraPointEnabled: false, extraPointActual: null, extraPointDetect: null, ...o,
  };
}
function game(weekId, i, away, home, logoId, o = {}) {
  return {
    gameId: `${weekId}_g${i}`, weekId, espnEventId: String(7000 + logoId),
    dataQuality: 'espn_historical', dataSource: 'espn_historical',
    homeTeam: home, awayTeam: away, homeMascot: '', awayMascot: '',
    homeConference: 'Power', awayConference: 'Power', homeRank: null, awayRank: null,
    kickoff: '2026-09-26T20:00:00Z', kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening',
    spread: -3.5, favorite: home, lockedSpread: -3.5,
    homeScore: null, awayScore: null, status: 'scheduled',
    actualWinner: null, atsWinner: null, isAlmaMaterGame: false,
    spreadSource: 'espn', oddsProvider: 'DraftKings', lastUpdated: null,
    venue: null, venueDisplay: null, neutralSite: false, multiplier: 1,
    isManual: false, homeLogo: LOGO(logoId), awayLogo: LOGO(logoId + 500), ...o,
  };
}

// FINAL week — public, so the dashboard shows every pick and the Picks page
// shows the submitted/result cards.
const W_FINAL = 'lt_wfinal';
storage.saveWeek(week({ weekId: W_FINAL, weekNumber: 5, name: 'Week 5', label: 'Week 5', status: 'final' }));
const finalGames = [
  game(W_FINAL, 0, 'Texas A&M', 'Alabama', 21, { homeScore: 27, awayScore: 20, status: 'final', actualWinner: 'Alabama', atsWinner: 'Alabama' }),
  game(W_FINAL, 1, 'Ohio State', 'Michigan', 12, { homeScore: 10, awayScore: 24, status: 'final', actualWinner: 'Ohio State', atsWinner: 'Ohio State' }),
  game(W_FINAL, 2, 'Oregon', 'Washington', 66, { homeScore: 31, awayScore: 28, status: 'final', actualWinner: 'Washington', atsWinner: 'Oregon' }),
];
storage.saveAllGamesForWeek(W_FINAL, finalGames);
const finalPicks = [];
finalGames.forEach((g, gi) => PLAYERS.forEach((p, pi) => finalPicks.push({
  pickId: `lt_pk_${gi}_${pi}`, weekId: W_FINAL, gameId: g.gameId, playerId: p.playerId,
  selectedTeam: (gi + pi) % 2 === 0 ? g.homeTeam : g.awayTeam,
  selectedAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z', locked: true,
  result: g.atsWinner === ((gi + pi) % 2 === 0 ? g.homeTeam : g.awayTeam) ? 'correct' : 'incorrect',
})));
storage.saveAllPicks(finalPicks);
storage.saveAllWeeklyResults(W_FINAL, PLAYERS.map((p, i) => ({
  weekId: W_FINAL, playerId: p.playerId, rank: i + 1,
  correctPicks: 3 - (i % 3), incorrectPicks: i % 3, correctCount: 3 - (i % 3), incorrectCount: i % 3,
  noDecisions: 0, isWinner: i === 0, isLoser: i === PLAYERS.length - 1,
})));

// OPEN week — nobody has picked, so the Picks page shows the pick buttons.
const W_OPEN = 'lt_wopen';
storage.saveWeek(week({ weekId: W_OPEN, weekNumber: 6, name: 'Week 6', label: 'Week 6', status: 'open',
  startDate: '2099-10-03', endDate: '2099-10-04', actualTiebreakerValue: null }));
const openGames = [
  game(W_OPEN, 0, 'Georgia', 'Tennessee', 33, { kickoff: '2099-10-03T20:00:00Z' }),
  game(W_OPEN, 1, 'Oklahoma', 'Texas', 7, { kickoff: '2099-10-03T23:30:00Z' }),
];
storage.saveAllGamesForWeek(W_OPEN, openGames);

storage.setSession('lt_drew', false, true);   // a verified, non-commissioner player

function setLogoPref(on) {
  const p = storage.getPlayer('lt_drew');
  storage.savePlayer({ ...p, preferences: { ...(p.preferences || {}), logoView: on } });
}
function setLayoutPref(layout) {
  const p = storage.getPlayer('lt_drew');
  storage.savePlayer({ ...p, preferences: { ...(p.preferences || {}), dashboardLayout: layout } });
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] Every render path that draws a team logo honors the toggle, both states…');
// ═════════════════════════════════════════════════════════════════════════
{
  const results = storage.getWeeklyResults ? storage.getWeeklyResults(W_FINAL) : [];
  const paths = [
    ['1a Picks card — pick buttons (open week, pre-submission)', 'pick-btn-logo',
      () => app.renderGameCard(openGames[0], null, null, false, false)],
    ['1b Picks card — submitted/result card (final week)', 'team-name-logo',
      () => app.renderGameCard(finalGames[0], finalGames[0].homeTeam, 'correct', true, true)],
    ['1c Dashboard Standard — matrix game header', 'matrix-hdr-logo',
      () => app.renderDashboardTable(PLAYERS, finalGames, storage.getPicks(W_FINAL), results, W_FINAL, 45)],
    ['1d Dashboard Compact — pick chips', 'dc-chip-logo',
      () => app.renderDashboardCompact(PLAYERS, finalGames, storage.getPicks(W_FINAL), results, W_FINAL, 45)],
    ['1e Comm Games tab — Available Games pool rows', 'slate-row-logo',
      () => app.renderAvailableGamesList(openGames, [], storage.getWeek(W_OPEN))],
    ['1f Comm Games tab — slate rows', 'slate-row-logo',
      () => app.renderAdminGamesList([...openGames], storage.getWeek(W_OPEN), {})],
  ];
  for (const [label, marker, render] of paths) {
    setLogoPref(true);
    const on = render();
    setLogoPref(false);
    const off = render();
    assert(on.includes(marker) && on.includes('a.espncdn.com/i/teamlogos'), `${label}: toggle ON draws the logo (${marker})`);
    assert(!hasLogo(off), `${label}: toggle OFF draws no logo at all (found: ${whichLogo(off)})`);
  }

  // Negative controls — surfaces the brief named that are NOT logo paths.
  // Proven in the ON state, where a leak would show.
  setLogoPref(true);
  const watch = app.renderAlmaMaterWatch(W_FINAL, finalGames);
  assert(typeof watch === 'string' && !hasLogo(watch), `1g Alma Mater Watch draws no team logo even with the toggle ON (straight-up W/L text only; found: ${whichLogo(watch)})`);
  el('page-leaderboard').innerHTML = '';
  try { app.renderLeaderboard(); } catch (e) { console.warn('[logotoggletest] renderLeaderboard threw', e && e.message); }
  const standings = el('page-leaderboard').innerHTML;
  assert(standings.length > 0 && !hasLogo(standings), `1h Standings draws no team logo even with the toggle ON (rendered ${standings.length} chars; found: ${whichLogo(standings)})`);
  setLogoPref(false);
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] THE BUG — flipping the REAL drawer toggle repaints the page under the drawer…');
// ═════════════════════════════════════════════════════════════════════════
{
  const ctx0 = app._buildControlCenterCtxForTest();
  assert(typeof ctx0?.callbacks?.onSetLogoView === 'function' && typeof ctx0?.callbacks?.onNavigate === 'function',
    '2-0: fixture — the drawer ctx carries the real onSetLogoView and onNavigate callbacks');

  // The Picks page writes its shell into #page-picks and then its cards into a
  // CHILD container (#games-list for the draft form, #submitted-games for the
  // submitted view). This stub DOM does not parse innerHTML into children, so
  // those two containers are registered up front and read as part of the
  // page — in a real browser their markup IS inside #page-picks.
  const PAGE_PARTS = { dashboard: ['page-dashboard'], picks: ['page-picks', 'games-list', 'submitted-games'] };
  PAGE_PARTS.picks.forEach(el);
  const clearPage = (tab) => PAGE_PARTS[tab].forEach(id => { el(id).innerHTML = ''; });
  const pageHTML = (tab) => PAGE_PARTS[tab].map(id => el(id).innerHTML).join('\n');

  // Paint `tab` with the toggle in state `from` through the real navigation
  // chokepoint, then flip it with the real drawer callback. Returns both
  // snapshots of the page.
  function flip(tab, from) {
    setLogoPref(from);
    app.state.currentTab = tab;
    clearPage(tab);
    app._buildControlCenterCtxForTest().callbacks.onNavigate(tab);
    const before = pageHTML(tab);
    // The drawer's own action handler reads ctx.logoView and passes its
    // negation (js/control-center.js 'cc-toggle-logo-view') — replicated
    // here from a FRESH ctx, exactly as the mounted drawer would hold it.
    const ctx = app._buildControlCenterCtxForTest();
    ctx.callbacks.onSetLogoView(!(ctx.logoView === true));
    const after = pageHTML(tab);
    return { before, after };
  }

  const cases = [
    ['Dashboard (Standard matrix)', 'dashboard', W_FINAL, () => setLayoutPref('standard'), 'matrix-hdr-logo'],
    ['Dashboard (Compact chips)',   'dashboard', W_FINAL, () => setLayoutPref('compact'),  'dc-chip-logo'],
    ['Picks (final week, result cards)', 'picks', W_FINAL, () => {}, 'team-name-logo'],
    ['Picks (open week, pick buttons)',  'picks', W_OPEN,  () => {}, 'pick-btn-logo'],
  ];
  for (const [label, tab, weekId, setup, marker] of cases) {
    storage.setActiveWeekId(weekId);
    app.state.viewingWeekId = null;
    setup();

    const off = flip(tab, true);   // ON -> OFF (Drew's report)
    assert(off.before.includes(marker), `2 ${label}: fixture — painted with the toggle ON, the page shows logos (${marker}) before the flip`);
    assert(storage.getLogoView() === false, `2 ${label}: the drawer flip ON -> OFF persisted player.preferences.logoView = false`);
    assert(!hasLogo(off.after), `2 ${label}: THE BUG — after toggling OFF in the drawer, the page under it shows NO logos (found: ${whichLogo(off.after)})`);

    const on = flip(tab, false);   // OFF -> ON (the mirror image)
    assert(!hasLogo(on.before), `2 ${label}: fixture — painted with the toggle OFF, the page shows no logos before the flip`);
    assert(storage.getLogoView() === true, `2 ${label}: the drawer flip OFF -> ON persisted player.preferences.logoView = true`);
    assert(on.after.includes(marker), `2 ${label}: after toggling ON in the drawer, the page under it shows logos (${marker})`);
  }
  setLayoutPref(null);
  setLogoPref(false);
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] Structural — every logo read in js/app.js is gated on the toggle…');
// ═════════════════════════════════════════════════════════════════════════
{
  const src = readFileSync(fileURLToPath(new URL('./js/app.js', import.meta.url)), 'utf8');
  const code = src.split('\n').map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  const reads = code.filter(({ l }) => /logoOk\(/.test(l));
  assert(reads.length >= 7, `3-0: fixture — found the known logoOk() reads in js/app.js (got ${reads.length}, expected at least 7)`);
  const ungated = reads.filter(({ l }) => !/logoViewOn/.test(l));
  assert(ungated.length === 0, `3-1: every logoOk() read sits on a line that also reads the toggle (logoViewOn) — ungated: ${ungated.map(r => 'app.js:' + r.n).join(', ') || 'none'}`);
  // Every <img> template in js/app.js is either the body of teamLogoImgHTML()
  // (whose only callers are the gated helpers above) or the gated
  // dc-chip-logo chip.
  const lines = src.split('\n');
  const imgs = code.filter(({ l }) => /<img\b/.test(l));
  const imgOk = imgs.length > 0 && imgs.every(({ n, l }) => /dc-chip-logo/.test(l) || /function teamLogoImgHTML\(/.test(lines[n - 2] || ''));
  assert(imgOk, `3-2: js/app.js emits <img> only inside teamLogoImgHTML() or the gated dc-chip-logo — no second, unguarded logo template (${imgs.map(r => 'app.js:' + r.n).join(', ')})`);
  const onSet = src.slice(src.indexOf('onSetLogoView: (v) =>'), src.indexOf('onNavigate: (target) =>'));
  assert(/navigateTo\(state\.currentTab/.test(onSet), '3-3: onSetLogoView repaints the current tab through navigateTo() — the same chokepoint onSaveAlmaMater and every Realtime repaint use');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] Same bug class — the drawer\'s OTHER player-preference handlers repaint what they change…');
// ═════════════════════════════════════════════════════════════════════════
// The sweep (2026-09-29): every callback in buildControlCenterCtx() that
// writes something the page under the drawer renders from must repaint that
// page. onSetTimeZone (kickoff/lock times) and onSaveDisplayName /
// onSaveInitials (names and initials on Picks/Dashboard) had the same
// missing repaint as onSetLogoView. onSetTheme / onSetColorScheme are
// CSS-only (a body class / data attribute) — [4d] PROVES that by rendering
// the page under two values and requiring identical markup, so if a future
// render starts reading the theme, this fails and says the handler now needs
// a repaint too.
{
  const dm = await import('./js/data-model.js');
  const PARTS = { dashboard: ['page-dashboard'], picks: ['page-picks', 'games-list', 'submitted-games'] };
  PARTS.picks.forEach(el);
  const html = (tab) => PARTS[tab].map(id => el(id).innerHTML).join('\n');
  function paint(tab) {
    app.state.currentTab = tab;
    PARTS[tab].forEach(id => { el(id).innerHTML = ''; });
    app._buildControlCenterCtxForTest().callbacks.onNavigate(tab);
    return html(tab);
  }
  const g0 = openGames[0];
  const timeIn = (tzKey) => dm.formatGameTime(g0.kickoff, tzKey, g0);
  assert(timeIn('PT') !== timeIn('ET') && timeIn('PT').length > 0, `4-0: fixture — the open game's kickoff reads differently in PT (${timeIn('PT')}) and ET (${timeIn('ET')})`);

  // [4a] Time zone, both directions, on Picks (open week, draft form) and
  // Dashboard (open week, after this player submits — the blind gate opens).
  storage.setActiveWeekId(W_OPEN);
  app.state.viewingWeekId = null;
  setLayoutPref('standard');
  for (const tab of ['picks', 'dashboard']) {
    if (tab === 'dashboard') {
      storage.saveAllPicks(openGames.map((g, i) => ({
        pickId: `lt_open_${i}`, weekId: W_OPEN, gameId: g.gameId, playerId: 'lt_drew', selectedTeam: g.homeTeam,
        selectedAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z', locked: false, result: 'pending',
      })));
    }
    for (const [from, to] of [['PT', 'ET'], ['ET', 'PT']]) {
      storage.setTimezone(from);
      const before = paint(tab);
      assert(before.includes(timeIn(from)) && !before.includes(timeIn(to)),
        `4a ${tab} ${from}->${to}: fixture — painted in ${from}, the page shows ${timeIn(from)} and not ${timeIn(to)}`);
      app._buildControlCenterCtxForTest().callbacks.onSetTimeZone(to);
      assert(storage.getTimezone() === to, `4a ${tab} ${from}->${to}: the drawer's time-zone row persisted ${to}`);
      const after = html(tab);
      assert(after.includes(timeIn(to)) && !after.includes(timeIn(from)),
        `4a ${tab} ${from}->${to}: THE TWIN — the page under the drawer now shows kickoff in ${to} (${timeIn(to)}), not ${from} (${timeIn(from)})`);
    }
  }
  storage.setTimezone('PT');

  // [4b] Display name, on Picks and Dashboard (final week — every column public).
  storage.setActiveWeekId(W_FINAL);
  for (const tab of ['picks', 'dashboard']) {
    const p = storage.getPlayer('lt_drew');
    storage.savePlayer({ ...p, displayName: 'Drew' });
    const before = paint(tab);
    assert(before.includes('Drew') && !before.includes('Drewski'), `4b ${tab}: fixture — painted with displayName "Drew"`);
    app._buildControlCenterCtxForTest().callbacks.onSaveDisplayName('Drewski');
    assert(storage.getPlayer('lt_drew').displayName === 'Drewski', `4b ${tab}: the Profile save persisted displayName "Drewski"`);
    assert(html(tab).includes('Drewski'), `4b ${tab}: the page under the drawer now shows the new display name`);
  }
  { const p = storage.getPlayer('lt_drew'); storage.savePlayer({ ...p, displayName: 'Drew' }); }

  // [4c] Initials, on the Compact dashboard (its chips carry them).
  setLayoutPref('compact');
  {
    const p = storage.getPlayer('lt_drew');
    storage.savePlayer({ ...p, initials: 'DH' });
    const before = paint('dashboard');
    assert(before.includes('>DH<') && !before.includes('>QZ<'), '4c dashboard (Compact): fixture — painted with initials DH on the chips');
    app._buildControlCenterCtxForTest().callbacks.onSaveInitials('QZ');
    assert(storage.getPlayer('lt_drew').initials === 'QZ', '4c dashboard (Compact): the Profile save persisted initials QZ');
    assert(html('dashboard').includes('>QZ<'), '4c dashboard (Compact): the page under the drawer now shows the new initials');
    storage.savePlayer({ ...storage.getPlayer('lt_drew'), initials: 'DH' });
  }
  setLayoutPref('standard');

  // [4d] Theme and color scheme are CSS-only: the page markup is identical
  // under two values, so their handlers correctly need no repaint.
  for (const tab of ['picks', 'dashboard']) {
    storage.setTheme('neutral');
    const a = paint(tab);
    storage.setTheme(dm.THEMES.find(t => t.key !== 'neutral').key);
    const b = paint(tab);
    assert(a.length > 0 && a === b, `4d ${tab}: page markup is identical under two themes — onSetTheme's CSS-only apply needs no page repaint`);
    storage.setColorScheme('light');
    const c = paint(tab);
    storage.setColorScheme('dark');
    const d = paint(tab);
    assert(c.length > 0 && c === d, `4d ${tab}: page markup is identical under light and dark — onSetColorScheme's CSS-only apply needs no page repaint`);
  }
  storage.setTheme('neutral'); storage.setColorScheme('system');
  setLayoutPref(null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
