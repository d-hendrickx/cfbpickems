/**
 * CFB Pickems — themefixtures.mjs (SP-52 DI-456 [T11] support module; test-only, never loaded by the app)
 * ============================================================================
 * Drives the REAL renderers into HTML strings so themetest.mjs [T11] can resolve every text-bearing element's effective colour and
 * painted background through the cascade on all 20 sides. Importing this module installs DOM/localStorage stubs on globalThis (the
 * logotoggletest.mjs shape: elements that hold real innerHTML), so it must be imported LAST by a test that has already done its
 * stylesheet-only work.
 *
 * What is rendered (every one is real app code, not a hand-copy of its markup, unless named otherwise):
 *   dashboard-compact-final / -live / -open   renderDashboardCompact()  — chips, status pills, the LIVE pill, covering/trailing, blind chips
 *   dashboard-matrix-final / -live / -open    renderDashboardTable()    — the matrix: header, rows, zebra, result/live/blind cells
 *   picks-card-open / -final                  renderGameCard()          — the Picks card (pick buttons; the submitted/result card)
 *   standings                                 renderLeaderboard()       — the Standings page
 *   control-center                            renderControlCenter()     — the drawer INCLUDING the quick Light/Dark row (js/control-center.js)
 *   alma-watch                                renderAlmaMaterWatch()
 *   chat-page                                 chat-ui messageHTML() (incl. the "NEW" divider) / pillsHTML() / the sync badge, in renderChatPage()'s
 *                                             real #page-chat > .chat-surface > #chat-scroll mount (themes DI A1.10; the composer is a skeleton)
 *   chat, modal, toast, league-page           STRUCTURAL fixtures: the class skeleton js/chat-ui.js / showModal() / showToast() / the league
 *                                             page emit, written out by hand with sample text (those renderers need a live DOM). Named limit.
 */
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const registry = new Map();
function makeEl(id) {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
const el = (id) => { if (!registry.has(id)) registry.set(id, makeEl(id)); return registry.get(id); };
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: (id) => registry.get(id) || null,
  querySelector: (sel) => (typeof sel === 'string' && sel.startsWith('#') ? registry.get(sel.slice(1)) || null : null),
  querySelectorAll: () => [],
  createElement: () => makeEl('__created__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in themefixtures'); };

export async function buildFixtures() {
  const storage = await import('./js/storage.js');
  const app = await import('./js/app.js');
  const cc = await import('./js/control-center.js');
  const { icon } = await import('./js/icons.js');
  const escHtml = (await import('./js/utils.js').catch(() => ({}))).escHtml || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  storage.setBackendMode('local');
  ['page-dashboard', 'page-picks', 'page-leaderboard', 'page-commissioner', 'toast-container', 'games-list', 'submitted-games'].forEach(el);

  const LOGO = (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
  const PLAYERS = [
    { playerId: 'th_drew', displayName: 'Drew', initials: 'DH', active: true, preferences: {} },
    { playerId: 'th_brayden', displayName: 'Brayden', initials: 'BR', active: true, preferences: {} },
    { playerId: 'th_kevin', displayName: 'Kevin', initials: 'KV', active: true, preferences: {} },
    { playerId: 'th_koby', displayName: 'Koby', initials: 'KB', active: true, preferences: {} },
    { playerId: 'th_jacob', displayName: 'Jacob', initials: 'JC', active: true, preferences: {} },
    { playerId: 'th_kihoon', displayName: 'Kihoon', initials: 'KH', active: true, preferences: {} },
  ];
  PLAYERS.forEach((p) => storage.addPlayer(p));
  const week = (o) => ({
    season: 2026, dataSourceMode: 'live', startDate: '2026-09-26', endDate: '2026-09-27', picksOpenAt: null, picksLockAt: null, lockedAt: null,
    finalizedAt: null, tiebreakerQuestion: 'Total points?', actualTiebreakerValue: 45, tiebreakerFinalized: false, showInHistory: true, blurb: '', recap: '',
    groupId: null, isGroupTiebreaker: false, extraPointEnabled: false, extraPointActual: null, extraPointDetect: null, ...o,
  });
  const game = (weekId, i, away, home, logoId, o = {}) => ({
    gameId: `${weekId}_g${i}`, weekId, espnEventId: String(7000 + logoId), dataQuality: 'espn_historical', dataSource: 'espn_historical',
    homeTeam: home, awayTeam: away, homeMascot: '', awayMascot: '', homeConference: 'Power', awayConference: 'Power', homeRank: null, awayRank: null,
    kickoff: '2026-09-26T20:00:00Z', kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening', spread: -3.5, favorite: home, lockedSpread: -3.5,
    homeScore: null, awayScore: null, status: 'scheduled', actualWinner: null, atsWinner: null, isAlmaMaterGame: false, spreadSource: 'espn', oddsProvider: 'DraftKings',
    lastUpdated: null, venue: null, venueDisplay: null, neutralSite: false, multiplier: 1, isManual: false, homeLogo: LOGO(logoId), awayLogo: LOGO(logoId + 500), ...o,
  });
  const mkPicks = (weekId, games, locked) => {
    const out = [];
    games.forEach((g, gi) => PLAYERS.forEach((p, pi) => out.push({
      pickId: `th_pk_${weekId}_${gi}_${pi}`, weekId, gameId: g.gameId, playerId: p.playerId, selectedTeam: (gi + pi) % 2 === 0 ? g.homeTeam : g.awayTeam,
      selectedAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z', locked,
      result: g.status === 'final' ? (g.atsWinner === ((gi + pi) % 2 === 0 ? g.homeTeam : g.awayTeam) ? 'correct' : 'incorrect') : null,
    })));
    return out;
  };
  const results = (weekId) => PLAYERS.map((p, i) => ({ weekId, playerId: p.playerId, rank: i + 1, correctPicks: 3 - (i % 3), incorrectPicks: i % 3, correctCount: 3 - (i % 3), incorrectCount: i % 3, noDecisions: 0, isWinner: i === 0, isLoser: i === PLAYERS.length - 1 }));

  const W_FINAL = 'th_wfinal', W_LIVE = 'th_wlive', W_OPEN = 'th_wopen';
  storage.saveWeek(week({ weekId: W_FINAL, weekNumber: 5, name: 'Week 5', label: 'Week 5', status: 'final' }));
  const finalGames = [
    game(W_FINAL, 0, 'Texas A&M', 'Alabama', 21, { homeScore: 27, awayScore: 20, status: 'final', actualWinner: 'Alabama', atsWinner: 'Alabama', isAlmaMaterGame: true }),
    game(W_FINAL, 1, 'Ohio State', 'Michigan', 12, { homeScore: 10, awayScore: 24, status: 'final', actualWinner: 'Ohio State', atsWinner: 'Ohio State' }),
    game(W_FINAL, 2, 'Oregon', 'Washington', 66, { homeScore: 31, awayScore: 28, status: 'final', actualWinner: 'Washington', atsWinner: 'Oregon' }),
  ];
  storage.saveAllGamesForWeek(W_FINAL, finalGames); storage.saveAllPicks(mkPicks(W_FINAL, finalGames, true)); storage.saveAllWeeklyResults(W_FINAL, results(W_FINAL));

  storage.saveWeek(week({ weekId: W_LIVE, weekNumber: 6, name: 'Week 6', label: 'Week 6', status: 'live', actualTiebreakerValue: null, startDate: '2026-10-03', endDate: '2026-10-04' }));
  const liveGames = [
    game(W_LIVE, 0, 'Georgia', 'Tennessee', 33, { status: 'live', homeScore: 17, awayScore: 10, kickoff: '2026-10-03T16:00:00Z', liveClock: '8:42', livePeriod: 3, isAlmaMaterGame: true }),
    game(W_LIVE, 1, 'Oklahoma', 'Texas', 7, { status: 'live', homeScore: 14, awayScore: 21, kickoff: '2026-10-03T16:30:00Z', liveClock: '2:10', livePeriod: 2 }),
    game(W_LIVE, 2, 'Clemson', 'Florida State', 40, { status: 'final', homeScore: 20, awayScore: 24, actualWinner: 'Clemson', atsWinner: 'Clemson', kickoff: '2026-10-03T12:00:00Z' }),
    game(W_LIVE, 3, 'Notre Dame', 'Purdue', 9, { status: 'scheduled', kickoff: '2026-10-03T23:30:00Z' }),
  ];
  storage.saveAllGamesForWeek(W_LIVE, liveGames); storage.saveAllPicks(mkPicks(W_LIVE, liveGames, true)); storage.saveAllWeeklyResults(W_LIVE, results(W_LIVE));

  storage.saveWeek(week({ weekId: W_OPEN, weekNumber: 7, name: 'Week 7', label: 'Week 7', status: 'open', startDate: '2099-10-10', endDate: '2099-10-11', actualTiebreakerValue: null, blurb: 'Rivalry week. The lines are tight.' }));
  const openGames = [
    game(W_OPEN, 0, 'Georgia', 'Tennessee', 33, { kickoff: '2099-10-10T20:00:00Z', isAlmaMaterGame: true }),
    game(W_OPEN, 1, 'Oklahoma', 'Texas', 7, { kickoff: '2099-10-10T23:30:00Z' }),
  ];
  storage.saveAllGamesForWeek(W_OPEN, openGames);
  // OPEN is BLIND: Drew (the viewer), Brayden and Kevin have picked; the dashboard shows Drew's own chip and the dashed blind chip (•••) for the other two
  storage.saveAllPicks([...mkPicks(W_FINAL, finalGames, true), ...mkPicks(W_LIVE, liveGames, true),
    ...['th_drew', 'th_brayden', 'th_kevin'].flatMap((pid) => openGames.map((g, gi) => ({ pickId: `th_pk_open_${pid}_${gi}`, weekId: W_OPEN, gameId: g.gameId, playerId: pid, selectedTeam: g.homeTeam, selectedAt: '2099-01-01T00:00:00Z', updatedAt: '2099-01-01T00:00:00Z', locked: false, result: null })))]);

  storage.setSession('th_drew', false, true);
  const p = storage.getPlayer('th_drew');
  storage.savePlayer({ ...p, preferences: { ...(p.preferences || {}), logoView: true } });

  const F = {};
  const out = (name, html) => { F[name] = String(html || ''); };
  for (const [tag, wk, games] of [['final', W_FINAL, finalGames], ['live', W_LIVE, liveGames], ['open', W_OPEN, openGames]]) {
    const res = storage.getWeeklyResults ? storage.getWeeklyResults(wk) : [];
    const picks = storage.getPicks(wk);
    // wrapped exactly as the dashboard page wraps them (js/app.js: the dashboard `.card`, then `.dashboard-compact` / `.dashboard-scroll`)
    try { out(`dashboard-compact-${tag}`, `<div class="card mb-md"><div class="dashboard-compact">${app.renderDashboardCompact(PLAYERS, games, picks, res, wk, 45)}</div></div>`); } catch (e) { out(`dashboard-compact-${tag}`, ''); console.warn('[themefixtures] compact', tag, e && e.message); }
    try { out(`dashboard-matrix-${tag}`, `<div class="card mb-md"><div class="dashboard-scroll">${app.renderDashboardTable(PLAYERS, games, picks, res, wk, 45)}</div></div>`); } catch (e) { out(`dashboard-matrix-${tag}`, ''); console.warn('[themefixtures] matrix', tag, e && e.message); }
  }
  out('picks-card-open', app.renderGameCard(openGames[0], null, null, false, false));
  out('picks-card-picked', app.renderGameCard(openGames[1], openGames[1].homeTeam, null, false, false));
  out('picks-card-final-win', app.renderGameCard(finalGames[0], finalGames[0].homeTeam, 'correct', true, true));
  out('picks-card-final-loss', app.renderGameCard(finalGames[1], finalGames[1].homeTeam, 'incorrect', true, true));
  out('picks-card-live', app.renderGameCard(liveGames[0], liveGames[0].homeTeam, 'live', true, true));
  el('page-leaderboard').innerHTML = '';
  try { app.renderLeaderboard(); } catch (e) { console.warn('[themefixtures] renderLeaderboard', e && e.message); }
  out('standings', el('page-leaderboard').innerHTML);
  try { out('alma-watch', app.renderAlmaMaterWatch(W_FINAL, finalGames)); } catch { out('alma-watch', ''); }

  // the PICKS PAGE (open week): the week-status card, the week nav, the pick cards, the submit bar, the timing note — rendered through the real navigation chokepoint
  try {
    storage.setActiveWeekId(W_OPEN);
    ['page-picks', 'games-list', 'submitted-games'].forEach((id) => { el(id).innerHTML = ''; });
    // a signed-in player who has NOT picked yet, so the draft form (pick buttons + submit bar) renders
    storage.setSession('th_koby', false, true);
    app.state.currentTab = 'picks';
    app._buildControlCenterCtxForTest().callbacks.onNavigate('picks');   // the real navigation chokepoint (navigateTo() itself is not exported)
    out('picks-page', ['page-picks', 'games-list', 'submitted-games'].map((id) => el(id).innerHTML).join('\n'));
    storage.setSession('th_drew', false, true);
  } catch (e) { out('picks-page', ''); console.warn('[themefixtures] picks page', e && e.message); }
  // the COMMISSIONER page (Games tab): the tab bar, the slate cards, the available-games group and filter bar
  try {
    el('page-commissioner').innerHTML = '';
    storage.setSession('th_drew', true, true);
    app.state.currentTab = 'commissioner';
    app.renderCommPage();
    out('comm-page', el('page-commissioner').innerHTML);
    storage.setSession('th_drew', false, true);
  } catch (e) { out('comm-page', ''); console.warn('[themefixtures] comm page', e && e.message); }

  // the drawer, including the quick Light/Dark row (signed in, a pinned scheme so the "Match my phone" button shows too)
  const ccCtx = (scheme) => ({
    session: { player: { id: 'th_drew', displayName: 'Drew', initials: 'DH', almaMater: 'Texas A&M' }, isAdmin: true },
    memberships: [], league: { id: 'l1', name: "IRB Pick'Ems", pilot: false },
    escHtml, icon, isNativeShell: () => false,
    flags: { isCommissioner: false, isPlatformAdmin: false, isSuperAdmin: false, isPilotLeague: false },
    version: { APP_VERSION: '0.29.0', APP_VERSION_DATE: '2026-10-01' },
    bodies: {
      notifSettingsHTML: '<p class="text-muted">Push is on for this device.</p>', chatPrefsHTML: '<p class="text-muted">Chat settings</p>', scribeFileHTML: '',
      feedbackCardHTML: '<p class="text-muted">Tell us what you think.</p>', gameRequestHTML: '<p class="text-muted">Request a game.</p>', releaseNotesHTML: '<p class="text-muted">v0.29.0</p>',
    },
    currentTimeZone: 'ET', currentTheme: 'neutral', currentColorScheme: scheme, systemIsDark: false, logoView: false, callbacks: {},
  });
  try {
    const st = cc.initialControlCenterState(); st.settingsOpenRow = 'appearance';
    out('control-center-pinned', cc.renderControlCenter(ccCtx('dark'), st));
    out('control-center-system', cc.renderControlCenter(ccCtx('system'), st));
  } catch (e) { out('control-center-pinned', ''); out('control-center-system', ''); console.warn('[themefixtures] control center', e && e.message); }

  // STRUCTURAL fixtures (named limit): the class skeletons of surfaces whose renderers need a live DOM
  out('modal', `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h3>Edit game</h3><button class="modal-close">x</button></div>
      <div class="modal-body"><p class="text-muted">Spread is set from the favorite.</p><label class="form-label">Margin</label><input class="form-input" value="3.5"><div class="info-box">Heads up: picks lock at kickoff.</div>
      <div class="modal-actions"><button class="btn btn-primary">Save</button><button class="btn btn-secondary">Cancel</button></div></div></div></div>`);
  out('toast', `<div class="toast success">Picks saved</div><div class="toast error">Could not save</div><div class="chat-toast">New message</div>`);
  out('chat', `<div class="chat-view-header"><span class="chat-view-title">Locker Room</span></div>
      <div class="chat-scroll"><div class="chat-msg"><div class="chat-avatar chat-avatar-mine">DH</div><div class="chat-bubble chat-bubble-mine"><span class="chat-author">You</span><span class="chat-text">Georgia -3.5 is free money</span></div></div>
      <div class="chat-msg"><div class="chat-avatar">KV</div><div class="chat-bubble"><span class="chat-author">Kevin</span><span class="chat-text">Not a chance</span><span class="chat-time">9:41 PM</span></div></div>
      <div class="chat-msg chat-msg-bot"><div class="chat-bubble chat-bubble-bot"><span class="chat-author">SCRIBE</span><span class="chat-text">Kevin is 1-4 against the spread.</span></div></div></div>
      <div class="chat-composer"><input class="chat-input" placeholder="Message"><button class="chat-send-btn">Send</button></div>`);
  out('league-page', `<div class="league-standings-row"><span class="league-name">Drew</span><span class="text-muted">4-1</span></div><div class="card"><div class="card-title">Standings</div><p class="text-secondary">Season to date</p></div>`);

  // the CHAT PAGE (themes DI A1.10, 2026-10-01). The `chat` fixture above is a class skeleton with no #page-chat and no .chat-surface, which is
  // why [T11] never saw the DI-442 gap (the thread's card moved to .chat-surface; `#page-chat .chat-scroll{background:none}`). This one uses the
  // REAL chat-ui renderers — messageHTML() (incl. the "NEW" divider), pillsHTML(), the sync badge — inside renderChatPage()'s own mount:
  // #page-chat > .chat-sticky-stack + .chat-surface > #chat-scroll. Named limit: the composer is its composerHTML() class skeleton (not exported).
  try {
    const chatUi = await import('./js/chat-ui.js');
    const msg = (id, seq, author, body, o = {}) => ({ id, seq, ts: Date.parse('2026-10-01T20:00:00Z') + seq * 60000, author, body, type: 'message', notify: true, ...o });
    // Each row's ↩ reply glyph (.chat-swipe-reply-icon) is opacity:0 and aria-hidden at rest — it paints nothing until the reply-swipe arms the row
    // (js/chat-ui.js sets data-swipe-armed; `.chat-msg[data-swipe-armed="true"] .chat-swipe-reply-icon{opacity:1}` is the ONLY rule that attribute
    // drives). So every row carrying the glyph is rendered ARMED: the glyph is measured where it is actually painted, like any other text. At rest
    // it would read 1.00 (fully transparent) on every side — a state contrast does not apply to; no advisory and no evaluator change for it.
    const armed = (html, id) => html.replace(`data-mid="${id}"`, `data-mid="${id}" data-swipe-armed="true"`);
    const thread = [
      armed(chatUi._messageHTMLForTest(msg('th_c1', 1, 'th_kevin', 'Not a chance'), 'th_drew', false), 'th_c1'),
      armed(chatUi._messageHTMLForTest(msg('th_c2', 2, 'th_brayden', 'Georgia covers by the half'), 'th_drew', true), 'th_c2'),
      armed(chatUi._messageHTMLForTest(msg('th_c3', 3, 'th_drew', 'Georgia -3.5 is free money'), 'th_drew', false), 'th_c3'),
      chatUi._messageHTMLForTest(msg('th_c4', 4, 'scribe', 'Kevin is 1-4 against the spread.', { type: 'system' }), 'th_drew', false),
    ].join('\n');
    out('chat-page', `<main class="main-content"><section class="page-section active" id="page-chat">
      <div class="chat-sticky-stack"><div class="chat-header-row"><h2>Chat <span class="badge badge-beta">BETA</span> ${chatUi._chatSyncBadgeHTML()}</h2>
        <div class="chat-header-actions"><button class="btn btn-ghost btn-sm" id="chat-search-btn" aria-label="Search chat">🔍</button></div></div>
        ${chatUi._pillsHTMLForTest()}</div>
      <div class="chat-surface"><div class="chat-scroll" id="chat-scroll">
        <button class="chat-load-older" id="chat-load-older">↑ load earlier</button>
        <div class="chat-day-sep">${escHtml(new Date(Date.parse('2026-10-01T20:00:00Z')).toDateString())}</div>
        ${thread}
      </div>
      <div class="chat-pull-refresh-wrap"><div class="chat-pull-refresh" id="chat-pull-refresh" data-phase="idle" aria-hidden="true"></div></div>
      <div class="chat-composer"><div class="chat-composer-row"><textarea class="chat-input" id="chat-input" rows="1" placeholder="Message the league…"></textarea><button class="chat-send-btn" id="chat-send">➤</button></div></div>
      </div></section></main>`);
  } catch (e) { out('chat-page', ''); console.warn('[themefixtures] chat page', e && e.message); }
  return F;
}
