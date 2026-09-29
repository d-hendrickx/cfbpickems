/**
 * refreshtest.mjs — the auto-refresh interval actually takes effect.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * fb_1788025448083_fuvk2 (v0.17.7): "The scores don't seem to be refreshing at
 * the time interval that is selected. I have to manually hit refresh scores for
 * it to update."
 *
 * The setting existed (Off / 30s / 60s / 5min) and setupAutoRefresh() armed a
 * setInterval from it — so at first glance nothing was wrong. The defect was in
 * the tick body: it returned early on ANY tab except 'dashboard'
 * (`if (state.currentTab !== 'dashboard') return;`) BEFORE ever calling
 * doRefreshScores(). A player or the commissioner sitting on the Picks tab
 * during a live window therefore got ZERO auto-fetches and had to hit the
 * dashboard's "Refresh Scores" button by hand — exactly the report.
 *
 * That gate also contradicts the live-polling contract in CLAUDE.md:
 * "Live scoring: 60-second polling loop … only runs on non-demo weeks" — NOT
 * "only on the dashboard tab."
 *
 * ROOT CAUSE (single, not two): the tab gate sat in front of the DATA fetch
 * instead of in front of the RE-RENDER. Fix: the interval callback is extracted
 * to the exported runAutoRefreshTick(); the demo/manual guards stay, but the
 * fetch now runs on every non-demo/non-manual week regardless of active tab.
 * Only the wholesale dashboard re-render stays tab-scoped. (The Picks-tab live
 * render is DI-2, feature-builder's — deliberately NOT done here, since a full
 * renderPicksPage() every interval would wipe a player's in-progress edits.)
 *
 * WHAT THIS FILE ASSERTS
 *   [1] runAutoRefreshTick() fetches on Picks / dashboard / any tab — the bug.
 *   [2] demo and fully-manual weeks still never fetch — the guard is intact.
 *   [3] setupAutoRefresh() arms exactly one timer, re-arms without stacking a
 *       duplicate, and honors "Off" (interval 0) by arming none.
 *
 * NOT covered here (browser-only): that a live ESPN response actually paints
 * new scores on screen, and DI-2's Picks-tab quarter/clock render. This file
 * proves the TIMER and DATA-FETCH plumbing; rendering pixels needs a browser.
 *
 * DOM / localStorage stubs mirror the almatest.mjs / slatetest.mjs shape.
 */

// ── DOM / localStorage stubs ────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
const selectorSets = new Map();

function makeEl(id) {
  const listeners = new Map();
  const e = {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
  };
  return e;
}
function bySelector(sel) {
  if (typeof sel === 'string' && sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const set = selectorSets.get(sel);
  return set && set.length ? set[0] : null;
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__el__'),
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

// ── fetch spy: any call means the auto-refresh actually reached ESPN ─────────
let fetchCalls = [];
function installFetchSpy() {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ events: [] }) };
  };
}

// ── R1/R2 (Step 6 Phase 6 validation gate, 2026-09-20) ──────────────────────
// A REAL ESPN payload, not an empty one. Everything section [5] asserts —
// liveStatusById being filled, SCRIBE's live detector firing, a score write
// happening or not happening — is vacuous against `{events: []}`, because the
// parse produces no `updated[]` entry at all and the whole loop is skipped.
// Same fixture shape scoresRefresh.twin.mjs uses, so a drift in what the real
// parser reads is caught in both places.
function espnEvent({
  id = '401520100', statusName = 'STATUS_IN_PROGRESS',
  homeScore = '7', awayScore = '10', detail = 'Q3 5:12', shortDetail = 'Q3 5:12',
} = {}) {
  return {
    id, date: '2026-09-08T18:00Z',
    status: { type: { name: statusName, detail, shortDetail } },
    competitions: [{
      timeValid: true, neutralSite: false,
      competitors: [
        { homeAway: 'home', id: '1', score: homeScore, curatedRank: { current: 99 }, team: { id: '1', location: 'Home', name: 'Hosts', shortDisplayName: 'Home' } },
        { homeAway: 'away', id: '2', score: awayScore, curatedRank: { current: 99 }, team: { id: '2', location: 'Away', name: 'Visitors', shortDisplayName: 'Away' } },
      ],
      odds: [], broadcasts: [], notes: [],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } },
    }],
  };
}

/** Serves a real scoreboard body to every ESPN URL, and records every URL asked
 *  for — which is also how the S1 assertion sees whether a CORS proxy was
 *  reached. `direct: false` fails the DIRECT fetch only, which is the exact
 *  condition `resilientFetch()`'s proxy fallback exists for. */
function installEspnStub(events, { direct = true } = {}) {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    const isDirect = u.startsWith('https://site.api.espn.com');
    if (isDirect && !direct) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
    const body = JSON.stringify({ events });
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, json: async () => JSON.parse(body), text: async () => body };
  };
}
const proxyCalls = () => fetchCalls.filter(u =>
  u.includes('allorigins') || u.includes('corsproxy.io') || u.includes('codetabs'));

// ── write spy on the ONE key a score refresh persists ────────────────────────
// R1's claim is "no saveGame of score/status/actualWinner/kickoff fields", and
// the honest way to check a negative is to watch the seam's own output rather
// than to trust a flag. `cfbp_games` is the key js/storage.js's saveGame()
// writes (probed, not assumed).
const _rawSetItem = globalThis.localStorage.setItem;
let gameWrites = 0;
globalThis.localStorage.setItem = (k, v) => { if (String(k) === 'cfbp_games') gameWrites += 1; return _rawSetItem(k, v); };
function resetWrites() { gameWrites = 0; }

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const dm = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');

const { WEEK_STATUS, GAME_STATUS } = dm;
const { runAutoRefreshTick, setupAutoRefresh, state } = app;

console.log('[refreshtest] app.js exports —', Object.keys(app).length);
assert(typeof runAutoRefreshTick === 'function', 'fixture check: runAutoRefreshTick() is exported (extracted for direct testability)');
assert(typeof setupAutoRefresh === 'function', 'fixture check: setupAutoRefresh() is exported');

// ── Fixtures ────────────────────────────────────────────────────────────────
function liveWeek(o = {}) {
  return {
    weekId: 'rw1', weekNumber: 1, label: 'Week 1', season: 2026,
    status: WEEK_STATUS.LIVE, dataSourceMode: 'espn_live',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    ...o,
  };
}
function refreshableGame(o = {}) {
  return {
    gameId: 'rg1', weekId: 'rw1',
    homeTeam: 'Home', awayTeam: 'Away', homeMascot: '', awayMascot: '',
    kickoff: '2026-09-08T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread: -3, favorite: 'Home', lockedSpread: -3,
    homeScore: 7, awayScore: 3,
    status: GAME_STATUS.IN_PROGRESS ?? 'in_progress', actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_live', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: '401520100', espnSport: 'college-football',
    ...o,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The reported bug: the interval fetches regardless of active tab…');
{
  // ── Picks tab — this is where the reporter sat during the live window ──
  localStorage.clear();
  storage.saveWeek(liveWeek());
  storage.saveGame(refreshableGame());
  installFetchSpy();
  state.currentTab = 'picks';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0,
    'ON THE PICKS TAB, a live-week tick reaches ESPN — the exact fb_1788025448083 scenario. Before the fix the tab gate returned early here and fetchCalls stayed empty.');

  // ── Dashboard — the one tab that always worked (control) ──
  installFetchSpy();
  state.currentTab = 'dashboard';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0, 'on the dashboard the tick still fetches (control — this never regressed)');

  // ── Any other tab (rules) — data freshness is not tab-specific ──
  installFetchSpy();
  state.currentTab = 'rules';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0, 'on an unrelated tab (rules) the DATA still refreshes — the live poll runs per the "non-demo weeks" contract, not per tab');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Guards preserved: simulated/commissioner-entered weeks never fetch…');
{
  // Demo week — must not be walked over by live ESPN.
  localStorage.clear();
  storage.saveWeek(liveWeek({ dataSourceMode: 'demo' }));
  storage.saveGame(refreshableGame());
  installFetchSpy();
  state.currentTab = 'picks';
  await runAutoRefreshTick();
  assert(fetchCalls.length === 0, 'a DEMO week never auto-fetches, on any tab (would clobber the simulation — "demo resets after a few seconds")');

  // Fully-manual week — commissioner enters scores by hand.
  localStorage.clear();
  storage.saveWeek(liveWeek({ dataSourceMode: 'manual' }));
  storage.saveGame(refreshableGame());
  installFetchSpy();
  state.currentTab = 'dashboard';
  await runAutoRefreshTick();
  assert(fetchCalls.length === 0, 'a fully-MANUAL week never auto-fetches (would overwrite hand-entered scores)');
}

// ═════════════════════════════════════════════════════════════════════════════
// [4] DI-T6.6 — the scores-refresh client gate (Phase III Step 6, Phase 6).
// Mutation-canary pattern: notifytest.mjs [28g] is the precedent — BOTH states
// are asserted, because only one of them is the new behaviour and the OTHER
// must stay byte-identical to today.
//
// ══ CORRECTED AT THE VALIDATION GATE (reviewer R1, 2026-09-20) ══════════════
// 4-3/4-4/4-5 used to assert "the switch ON ⇒ ZERO ESPN fetches". That was the
// implementation's claim, and the reviewer's BLOCK is that it was the wrong
// claim: the server took over the score WRITE, while the same client loop also
// owned the quarter/clock/red-zone map (in-memory, no columns, five readers)
// and SCRIBE's live detectors. The gate is now about WRITES, which is what the
// server actually took over, and the fetch continues as a display-only pass.
// The three assertions below were rewritten rather than deleted — the canary
// still fires in both directions, on the correct fact.
console.log('\n[4] DI-T6.6 — the client stands down its score WRITE only when the server switch is true…');
{
  // ── 4a. ABSENT — the shape every league has today. ─────────────────────
  localStorage.clear();
  storage.saveWeek(liveWeek());
  storage.saveGame(refreshableGame());
  storage.saveSetting('serverJobs', undefined);
  installFetchSpy();
  state.currentTab = 'dashboard';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0,
    '4-1: with NO serverJobs key at all the client fetches ESPN exactly as it does today (CONVENTIONS #10: an absent switch changes nothing)');

  // ── 4b. EXPLICIT FALSE — the shape after Drew flips it back off. ────────
  storage.saveSetting('serverJobs', { scoresRefresh: false });
  installFetchSpy();
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0,
    '4-2: …and with scoresRefresh:false it fetches too — the rollback is a flip, and a flip back has to restore live polling on the very next tick with no deploy');

  // ── 4c. TRUE — the server is the one WRITER now. The poll continues. ────
  //    Asserted against a REAL ESPN body that genuinely differs from the stored
  //    row (7-3 live -> 7-10), so "zero writes" is a fact about behaviour and
  //    not a side effect of there being nothing to write.
  localStorage.clear();
  storage.saveWeek(liveWeek());
  storage.saveGame(refreshableGame());
  storage.saveSetting('serverJobs', { scoresRefresh: true });
  installEspnStub([espnEvent()]);
  resetWrites();
  state.currentTab = 'dashboard';
  await runAutoRefreshTick();
  assert(fetchCalls.length > 0,
    `4-3: with scoresRefresh:true the client STILL polls ESPN (got ${fetchCalls.length}) — R1: the server took over the score WRITE, not the quarter/clock/red-zone map, which has no columns and no server path`);
  assert(gameWrites === 0,
    `4-3b: …and writes NOTHING to cfbp_games (got ${gameWrites} writes) — one writer, no interleaving, which is what DI-T6.6's gate was actually for`);

  // ── 4d. tickAutoTransition() and the re-render are UNCHANGED. Proven by NOT
  //    throwing when the current tab is 'picks' (the re-render path) and by
  //    the timer plumbing in [3] below being completely unaffected.
  state.currentTab = 'picks';
  installEspnStub([espnEvent()]);
  resetWrites();
  let threw = false;
  try { await runAutoRefreshTick(); } catch { threw = true; }
  assert(!threw && gameWrites === 0,
    '4-4: on the Picks tab, with the switch on, the tick still runs its transition-check/re-render half without error and still writes no game');

  // ── 4e. ONLY THE LITERAL `true` STANDS THE WRITE DOWN. ──────────────────
  for (const [label, value] of [['the string "true"', { scoresRefresh: 'true' }],
                                ['the number 1', { scoresRefresh: 1 }],
                                ['a null bag', null],
                                ['an empty object', {}]]) {
    localStorage.clear();
    storage.saveWeek(liveWeek());
    storage.saveGame(refreshableGame());
    storage.saveSetting('serverJobs', value);
    installEspnStub([espnEvent()]);
    resetWrites();
    state.currentTab = 'dashboard';
    await runAutoRefreshTick();
    assert(fetchCalls.length > 0 && gameWrites > 0,
      `4-5: ${label} does NOT stand the write down — only the boolean does (a commissioner-editable settings blob must never let a truthy string silence live scoring). fetches=${fetchCalls.length}, writes=${gameWrites}`);
  }

  // ── 4f. THE CLIENT'S READER AND THE SERVER'S ARE THE SAME DECISION —
  //    notifications.js's isServerJobEnabled() IS the function DI-T6.1's gate
  //    already uses and already cross-checks against
  //    _shared/job-rules.mjs's isJobEnabledFromSettings() in notifytest.mjs
  //    [28f]; this assertion is the same claim for the 'scoresRefresh' name.
  const notif4 = await import('./js/notifications.js');
  storage.saveSetting('serverJobs', { scoresRefresh: true });
  assert(notif4.isServerJobEnabled('scoresRefresh') === true,
    '4-6: notifications.js\'s isServerJobEnabled(\'scoresRefresh\') is exactly the reader this gate calls — one decision, not two independently-maintained copies');
  storage.saveSetting('serverJobs', { scoresRefresh: false });
  assert(notif4.isServerJobEnabled('scoresRefresh') === false, '4-7: …and it flips off the same way');

  // Reset for the sections below.
  storage.saveSetting('serverJobs', undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
// [5] THE VALIDATION-GATE BLOCK (reviewer, 2026-09-20) — R1's display-only poll
//     and R2's idempotent catch-up emitter, driven through the REAL wiring.
//
// WHY THESE ARE DRIVEN AND NOT STUBBED. The reviewer's objection to the first
// implementation was not that a flag was set wrongly; it was that four
// player-visible behaviours silently stopped. A test that asserted "displayOnly
// was passed" would have passed against exactly that defect. So each assertion
// below drives runAutoRefreshTick()/reconcileGameEvents() for real and reads the
// OUTCOME: the live-status map the five renderers read, the storage seam's own
// write count, and the chat fold itself.
console.log('\n[5] R1/R2 — display-only polling and the idempotent kickoff/final catch-up…');
{
  const chat = await import('./js/chat.js');
  const { doRefreshScores, reconcileGameEvents, liveStatusById } = app;
  const provider = await import('./js/data-provider.js');

  const PLAYERS = [['p1', 'Brayden'], ['p2', 'Kevin'], ['p3', 'Koby'], ['p4', 'Jacob']];
  /** A live week, one game, four players, four picks — three on Home, one on
   *  Away. Home is favoured by 3 (spread -3, home perspective, AD-03). */
  //  EVERY BLOCK GETS ITS OWN gameId, and that is not tidiness. The chat fold
  //  is a MODULE-LEVEL append-only log: `localStorage.clear()` resets storage
  //  but cannot un-append a message, and the whole point of these ids is that
  //  they are deterministic per game. Sharing one gameId across blocks would
  //  mean block N+1 inherits block N's `sys_kick_`/`sys_final_` rows and every
  //  "nothing was posted" assertion would pass for the wrong reason.
  function seed(gameId, { gameOver = {}, weekOver = {} } = {}) {
    localStorage.clear();
    storage.saveWeek(liveWeek(weekOver));
    storage.saveGame(refreshableGame({ gameId, ...gameOver }));
    PLAYERS.forEach(([playerId, displayName]) =>
      storage.savePlayer({ playerId, displayName, active: true, almaMater: '', preferences: {} }));
    storage.saveAllPicks(PLAYERS.map(([playerId], i) => ({
      pickId: `pk_${playerId}`, weekId: 'rw1', gameId, playerId,
      selectedTeam: i === 3 ? 'Away' : 'Home', createdAt: new Date().toISOString(),
    })));
    liveStatusById.clear();
    resetWrites();
  }
  const week = () => storage.getWeeks().find(w => w.weekId === 'rw1');
  const sysIds = tag => chat.getMessages({ tag }).map(m => m.id);
  const body = id => (chat.getMessage(id) || {}).body || '';

  // ── 5a. THE DISPLAY-ONLY POLL STILL FEEDS THE FIVE LIVE-STATUS READERS ───
  {
    // The mirror row is LIVE because the SERVER wrote it there — which is the
    // state this whole phase creates and the one the tick must cope with.
    // (Note for the next reader: refreshableGame()'s own default status is the
    // string 'in_progress', from a `GAME_STATUS.IN_PROGRESS ?? …` that has never
    // resolved — GAME_STATUS is {SCHEDULED, LIVE, FINAL}. Harmless for sections
    // [1]-[4], which only exercise the fetch filter, but it is not a status any
    // renderer or reconcile matches, so it is set explicitly here.)
    seed('rg_a', { gameOver: { status: GAME_STATUS.LIVE } });
    storage.saveSetting('serverJobs', { scoresRefresh: true });
    installEspnStub([espnEvent()]);              // 7-10, in progress, "Q3 5:12"
    state.currentTab = 'dashboard';
    const before = JSON.stringify(storage.getGames('rw1'));
    await runAutoRefreshTick();

    const entry = liveStatusById.get('rg_a');
    assert(!!entry && entry.detail === 'Q3 5:12',
      `5a-1: with the switch ON the poll still fills liveStatusById (got ${JSON.stringify(entry && entry.detail)}) — quarter/clock and the red-zone mark are in-memory only, have no columns on public.games and no server path; the first cut of this gate made all five readers render nothing`);
    assert(gameWrites === 0,
      `5a-2: …and performs ZERO writes to cfbp_games (got ${gameWrites}) — the server is the single writer of score/status/actualWinner`);
    assert(JSON.stringify(storage.getGames('rw1')) === before,
      '5a-3: …and the stored row is byte-identical afterwards, including lastUpdated — a "write" that only stamps a timestamp is still a write and still broadcasts to six phones');
    const flip = chat.getMessages({ tag: 'rg_a' }).find(m => m.id.startsWith('scribe_coverageFlip_'));
    assert(!!flip,
      '5a-4: …and scribeLiveGameCheck() STILL RAN — the coverage flip (home covering by 1 -> losing by 6) posted. This is the assertion that proves the `fresh` argument is a real in-memory merge of the ESPN payload: passing the STORED row twice makes before === after and no detector can ever fire');
    assert(!!chat.getMessage('sys_kick_rg_a'),
      '5a-5: …and R2\'s reconcile is WIRED INTO THE TICK (call site i), not merely callable — the game is LIVE in the mirror with its kickoff passed, and the kickoff post arrived from the tick itself');
  }

  // ── 5b. A REALTIME-STYLE MIRROR CHANGE: scheduled -> LIVE ────────────────
  //    The shape of a server write arriving: the row in the mirror is already
  //    LIVE and nothing on this device observed the transition.
  {
    seed('rg_b', { gameOver: { status: GAME_STATUS.LIVE } });
    const r1 = reconcileGameEvents(week());
    assert(r1.kickoffs === 1 && !!chat.getMessage('sys_kick_rg_b'),
      `5b-1: a game that is LIVE in the mirror with no sys_kick_<gameId> in the fold gets exactly ONE kickoff post (got ${JSON.stringify(r1)})`);
    assert(body('sys_kick_rg_b').includes('Kickoff'),
      `5b-2: …and it is the real emitKickoffEvent() body, not a placeholder (got ${JSON.stringify(body('sys_kick_rg_b').slice(0, 40))})`);

    // ── 5c. THE SECOND PHONE / THE SECOND CALL. ──
    const r2 = reconcileGameEvents(week());
    assert(r2.kickoffs === 0 && sysIds('rg_b').filter(id => id === 'sys_kick_rg_b').length === 1,
      `5c-1: a second reconcile — the next poll, the next Realtime change, or another player's phone — posts NOTHING more (got ${JSON.stringify(r2)}) and the fold still holds exactly one sys_kick_rg_b. Exactly-once rests on the deterministic id, here in the fold and server-side on chat_append_system's \`on conflict (league_id,id) do nothing\``);
  }

  // ── 5d. FINAL — one post, the right rosters, from the stored ats winner ──
  {
    // Home 24, Away 10, spread -3 -> home covers by 11. Three players took
    // Home (right), one took Away (wrong).
    seed('rg_d', { gameOver: { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10, actualWinner: 'Home', atsWinner: 'Home' } });
    const r = reconcileGameEvents(week());
    assert(r.finals === 1 && !!chat.getMessage('sys_final_rg_d'),
      `5d-1: a game FINAL in the mirror with no sys_final_<gameId> gets exactly ONE final post (got ${JSON.stringify(r)})`);
    const text = body('sys_final_rg_d');
    assert(/right: Brayden, Kevin, Koby/.test(text) && /wrong: Jacob/.test(text),
      `5d-2: …with the SAME winner/loser derivation doRefreshScores() uses — right: the three who took the cover, wrong: the one who did not (got ${JSON.stringify(text)})`);
    assert(r.kickoffs === 0 && !chat.getMessage('sys_kick_rg_d'),
      '5d-3: …and NO kickoff post for a game that is already FINAL — a "🏈 Kickoff" arriving after the result is noise, and the log is append-only so it could not be taken back');
    const again = reconcileGameEvents(week());
    assert(again.finals === 0 && sysIds('rg_d').filter(id => id === 'sys_final_rg_d').length === 1,
      `5d-4: the second call posts nothing more (got ${JSON.stringify(again)}) — the FINAL-before-anyone-opened catch-up is idempotent across all six devices`);
  }

  // ── 5e. THE BLIND RULE IS UNTOUCHED, AND A BLOCKED POST LEAVES THE ID FREE ─
  {
    seed('rg_e', {
      gameOver: { status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 10, actualWinner: 'Home', atsWinner: 'Home' },
      weekOver: { status: WEEK_STATUS.OPEN },
    });
    const blocked = reconcileGameEvents(week());
    assert(blocked.finals === 0 && !chat.getMessage('sys_final_rg_e'),
      `5e-1: with the week still OPEN — picks not public — NOTHING is posted (got ${JSON.stringify(blocked)}). RG-45: this post carries per-game pick attribution BY NAME and emitGameFinalEvent() gates the whole event on arePicksPublic()`);
    // The id must be UNCONSUMED, which is the half a redacted post would break.
    storage.saveWeek({ ...week(), status: WEEK_STATUS.LIVE });
    const after = reconcileGameEvents(week());
    assert(after.finals === 1 && /right: Brayden/.test(body('sys_final_rg_e')),
      `5e-2: …and the moment the week is public the COMPLETE event arrives, rosters and all (got ${JSON.stringify(after)}) — the id was left unconsumed, so nothing was lost to a redaction`);
  }

  // ── 5f. A KICKOFF THAT HAS NOT HAPPENED YET IS NEVER POSTED ─────────────
  //    chat_append_system refuses sys_kick_<game> unless `g.kickoff <= now()`
  //    (0010_step5_chat_system.sql) and it refuses by RAISING, which rolls the
  //    whole append batch back — including any human message batched with it —
  //    and leaves the id free for the next tick to try again. Mirroring the
  //    server's rule here is what stops a TBD-kickoff game becoming a
  //    once-a-minute failing append.
  {
    seed('rg_f1', { gameOver: { status: GAME_STATUS.LIVE, kickoff: new Date(Date.now() + 3600e3).toISOString() } });
    const future = reconcileGameEvents(week());
    assert(future.kickoffs === 0 && !chat.getMessage('sys_kick_rg_f1'),
      `5f-1: a LIVE game whose stored kickoff is still in the FUTURE gets no kickoff post (got ${JSON.stringify(future)}) — the client mirrors chat_append_system's own precondition instead of discovering it as a rolled-back batch`);
    seed('rg_f2', { gameOver: { status: GAME_STATUS.LIVE, kickoff: null } });
    const tbd = reconcileGameEvents(week());
    assert(tbd.kickoffs === 0 && !chat.getMessage('sys_kick_rg_f2'),
      `5f-2: …and neither does a TBD game with no kickoff at all (got ${JSON.stringify(tbd)})`);
  }

  // ── 5g. THE SWITCH OFF: legacy behaviour, and reconcile does not double-post ─
  {
    seed('rg_g');
    storage.saveSetting('serverJobs', { scoresRefresh: false });
    installEspnStub([espnEvent({ statusName: 'STATUS_FINAL', homeScore: '24', awayScore: '10' })]);
    state.currentTab = 'dashboard';
    await runAutoRefreshTick();
    assert(gameWrites > 0 && storage.getGame('rg_g').status === GAME_STATUS.FINAL,
      `5g-1: with the switch OFF the legacy path still WRITES the score and status (writes=${gameWrites}, status=${storage.getGame('rg_g').status}) — byte-for-byte today's behaviour`);
    assert(!!chat.getMessage('sys_final_rg_g'),
      '5g-2: …and the legacy transition path is still the emitter — doRefreshScores() posted the final itself');
    const finalBodyBefore = body('sys_final_rg_g');
    const n = sysIds('rg_g').length;
    const r = reconcileGameEvents(week());
    assert(r.finals === 0 && r.kickoffs === 0 && sysIds('rg_g').length === n && body('sys_final_rg_g') === finalBodyBefore,
      `5g-3: …and a reconcile immediately afterwards adds NOTHING and rewrites nothing (got ${JSON.stringify(r)}) — the two emitters share the same deterministic ids, which is what makes running both safe`);
  }

  // ── 5h. SECURITY S1 — the CORS proxies, from the client module's own seam ─
  {
    const stored = [{ gameId: 'rg1', espnEventId: '401520100', espnSport: 'college-football' }];
    installEspnStub([espnEvent()], { direct: false });      // the direct fetch fails
    const noProxy = await provider.refreshScoresByEventIds(['401520100'], stored, { allowProxy: false });
    assert(proxyCalls().length === 0,
      `5h-1: with {allowProxy:false} a FAILED direct fetch reaches ZERO proxies (got ${JSON.stringify(proxyCalls())}) — this is the option supabase/functions/scores-refresh passes; a server bouncing ESPN off allorigins/corsproxy.io/codetabs would hand a stranger the league's live-window traffic and let an attacker-controlled body decide what the service role writes`);
    assert(!noProxy.updated.length && noProxy.errors.length > 0,
      `5h-2: …and the run is an honest error with nothing updated (updated=${noProxy.updated.length}, errors=${noProxy.errors.length}) — fail closed, never a silent zero score`);

    installEspnStub([espnEvent()], { direct: false });
    const dflt = await provider.refreshScoresByEventIds(['401520100'], stored);
    assert(proxyCalls().length === 1 && proxyCalls()[0].includes('allorigins') && dflt.updated.length === 1,
      `5h-3: THE BROWSER IS UNCHANGED — with no options at all the SAME failure falls back to the first proxy and SUCCEEDS (proxies=${JSON.stringify(proxyCalls())}, updated=${dflt.updated.length}). The default is TRUE; only the server opts out (CONVENTIONS #10's direction: absent behaves exactly as before)`);
  }

  // ── 5j. RG-260 candidate (2026-09-26) — the User-Agent is SERVER-ONLY ─────
  //    ESPN's edge now 403s `Deno/<ver>`, so scores-refresh sends an explicit
  //    User-Agent via fetchOptions.userAgent. A browser MUST NOT: the Fetch spec
  //    no longer forbids User-Agent (Firefox honours a script-set value, Chromium
  //    ignores it), and a script-set value is not CORS-safelisted, so it would
  //    force a preflight ESPN does not answer and break the fetch. What protects
  //    the browser is that every browser call site passes NO options — so its
  //    fetch init must stay exactly what it was: headers
  //    { Accept: 'application/json' } and nothing else (5j-1 / 5j-2 / 5j-2b).
  {
    let inits = [];
    const installInitSpy = () => {
      inits = [];
      globalThis.fetch = async (url, init = {}) => {
        inits.push({ url: String(url), headers: init.headers });
        const body = JSON.stringify({ events: [espnEvent()] });
        return { ok: true, status: 200, headers: { get: () => String(body.length) }, json: async () => JSON.parse(body), text: async () => body };
      };
    };
    const stored = [{ gameId: 'rg1', espnEventId: '401520100', espnSport: 'college-football' }];

    installInitSpy();
    await provider.refreshScoresByEventIds(['401520100'], stored);
    assert(inits.length === 1 && JSON.stringify(inits[0].headers) === JSON.stringify({ Accept: 'application/json' }),
      `5j-1: THE BROWSER'S FETCH IS BYTE-IDENTICAL — refreshScoresByEventIds() with no options sends headers exactly {"Accept":"application/json"}, no User-Agent (got ${JSON.stringify(inits.map(i => i.headers))})`);

    installInitSpy();
    await provider.fetchCurrentCFBGames();
    assert(inits.length >= 1 && inits.every(i => JSON.stringify(i.headers) === JSON.stringify({ Accept: 'application/json' })),
      `5j-2: …and the commissioner's slate fetch (fetchCurrentCFBGames) likewise (got ${JSON.stringify(inits.map(i => i.headers))})`);

    // fetchEspnTeamsList() calls attemptFetch() DIRECTLY (not via resilientFetch),
    // so attemptFetch's own default is what it gets — pinned separately.
    installInitSpy();
    await provider.fetchEspnTeamsList();
    assert(inits.length >= 1 && inits.every(i => JSON.stringify(i.headers) === JSON.stringify({ Accept: 'application/json' })),
      `5j-2b: …and the alma-mater teams fetch (fetchEspnTeamsList, attemptFetch's own default) likewise (got ${JSON.stringify(inits.map(i => i.headers))})`);

    installInitSpy();
    await provider.refreshScoresByEventIds(['401520100'], stored, { allowProxy: false, userAgent: '' });
    assert(inits.length === 1 && !('User-Agent' in (inits[0].headers || {})),
      `5j-3: an EMPTY userAgent adds no header at all — opt-in means a non-empty string (got ${JSON.stringify(inits.map(i => i.headers))})`);

    installInitSpy();
    await provider.refreshScoresByEventIds(['401520100'], stored, { allowProxy: false, userAgent: 'axios/1.7.7 test/1.0' });
    assert(inits.length === 1 && inits[0].headers?.['User-Agent'] === 'axios/1.7.7 test/1.0' && inits[0].headers?.Accept === 'application/json',
      `5j-4: a caller that DOES pass userAgent gets it on the direct fetch, beside Accept (got ${JSON.stringify(inits.map(i => i.headers))}) — the seam scores-refresh uses`);
  }

  // ── 5i. THE OTHER TWO CALL SITES, PINNED WHERE THEY CANNOT BE DRIVEN ────
  //    Call site (i) is driven for real in 5a-5. Sites (ii) and (iii) live
  //    inside the Supabase adapter's wiring — `sb.init({onRealtimeEvent})` and
  //    `afterSupabaseHydrate()`'s ACTIVE branch — neither of which can be
  //    reached from this harness without standing up a Supabase client. They
  //    are pinned structurally instead, WITH a fixture check on each anchor, so
  //    a rename that silently drops the call is red rather than vacuous.
  {
    const { readFileSync } = await import('node:fs');
    const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const realtimeLine = appSrc.split('\n').find(l => l.includes('onRealtimeEvent:'));
    assert(!!realtimeLine, '5i-0: fixture check — the onRealtimeEvent wiring line was found in js/app.js (a scan that found nothing would make the next assertion vacuous)');
    assert(!!realtimeLine && realtimeLine.includes('reconcileGameEvents('),
      `5i-1: call site (ii) — the Realtime handler reconciles after folding the change into the mirror. This is where a SERVER-performed LIVE/FINAL transition arrives, with no before/after pair for anything on this device to have noticed (got ${JSON.stringify((realtimeLine || '').trim().slice(0, 80))})`);
    const hydrateTail = appSrc.slice(appSrc.indexOf('sb.subscribeRealtime();'), appSrc.indexOf('sb.subscribeRealtime();') + 1200);
    assert(hydrateTail.includes('sb.subscribeRealtime();'), '5i-2: fixture check — the post-hydrate ACTIVE branch was located');
    assert(hydrateTail.includes('reconcileGameEvents(getCurrentWeek())'),
      '5i-3: call site (iii) — the boot/re-hydrate catch-up. The case it exists for is the whole Saturday that finalizes with no phone open: the first app opened afterwards posts what is owed, once, by deterministic id');
  }

  storage.saveSetting('serverJobs', undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Timer lifecycle: one timer, re-armed cleanly, "Off" honored…');
{
  // Fake timer registry so we can count LIVE (armed-and-not-cleared) intervals.
  const live = new Map();     // handle -> period(ms)
  let nextHandle = 1;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => { const h = nextHandle++; live.set(h, ms); return h; };
  globalThis.clearInterval = (h) => { live.delete(h); };

  try {
    localStorage.clear();
    // A live week so the immediate tickAutoTransition() inside setupAutoRefresh
    // has something to read without throwing.
    storage.saveWeek(liveWeek());
    storage.saveGame(refreshableGame());

    storage.saveSetting('autoRefreshInterval', 30);
    setupAutoRefresh();
    assert(live.size === 1, 'interval 30s → exactly ONE timer armed');
    assert([...live.values()][0] === 30000, 'the armed timer fires every 30s (30 × 1000ms) — the SELECTED interval, not a hardcoded default');

    // Re-arm (what a second interval-setting save, or a re-boot, does).
    storage.saveSetting('autoRefreshInterval', 60);
    setupAutoRefresh();
    assert(live.size === 1, 're-arming clears the old timer first — no stacked/duplicate intervals (the leak guard)');
    assert([...live.values()][0] === 60000, 'the surviving timer now uses the NEW 60s interval');

    // "Off".
    storage.saveSetting('autoRefreshInterval', 0);
    setupAutoRefresh();
    assert(live.size === 0, '"Off" (interval 0) arms NO timer and clears any prior one');
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// [6] REVIEWER NOTE 1 (re-gate, 2026-09-20) — THE LEGACY PATH'S atsWinner WRITE
//     IS COMMISSIONER-ONLY.
//
// WHAT IS WRONG IN PRODUCTION RIGHT NOW, established by reading the adapter
// rather than guessed:
//
//   js/app.js's doRefreshScores() legacy branch does `saveGame({...fresh,
//   atsWinner: ats})` on the final transition, on ALL SIX phones. `atsWinner` is
//   NOT in js/supabase-backend.js's GAME_SCORE_FIELDS, and `cfbp_games` routes
//   to `player: 'overlay'` — so on the five non-commissioner phones
//   `_setOverlay()` throws AdapterWriteRefusedError("…a player device may only
//   render live scores, not persist game data (<id>.atsWinner). Nothing was
//   saved."), synchronously, out of storage.save() (js/storage.js:395 does NOT
//   swallow it).
//
//   WHAT THE PLAYER ACTUALLY SEES: NOTHING. No red banner and no toast — the
//   adapter's set() throws to its caller and emits no status, and the caller is
//   inside doRefreshScores()'s own `try { … } catch(e){ console.warn('[refresh]
//   game-final event', e); }`. So the refusal ends as one console line.
//
//   THE REAL COST IS THE LINE THAT NEVER RUNS. `saveGame()` throws BEFORE
//   `emitGameFinalEvent(...)` in the SAME try block, so on those five phones the
//   per-game FINAL post is never even attempted. Today the ATS result only
//   reaches the Locker Room if the COMMISSIONER's device is open when the game
//   goes final. (R2's reconcile now covers this too, from a path that attempts
//   no write at all — but the legacy path should not be attempting a refused
//   write in the first place.)
//
// THE FIX: that one persist happens only for a session that may write game rows.
// Everyone else relies on js/scoring.js:106's `game.atsWinner ??
// calculateAtsWinner(game)` fallback, which is already there and is untouched.
//
// WHAT THIS HARNESS CAN AND CANNOT SHOW. Storage here is LOCAL, so the write
// succeeds and the refusal cannot be reproduced. What is asserted instead is the
// precondition that removes it: under a non-commissioner session the write is
// NOT ATTEMPTED, while the chat post still happens.
console.log('\n[6] Reviewer note 1 — a player phone no longer attempts the refused atsWinner write…');
{
  const auth6 = await import('./js/auth.js');
  const chat6 = await import('./js/chat.js');
  const LEAGUE6 = 'L-REGATE';

  /** A live week with one live game about to go final, under a REAL supabase
   *  auth/data config (the two always move together — configureAuth normalizes
   *  a split pair back to 'sheets', so this fixture cannot cheat by splitting
   *  them). `_setHasSupabaseDataBackendForTest(true)` is what stops
   *  isSupabaseWriteWithheld() refusing every write before the seam is reached;
   *  storage's own _backendMode stays 'local', which is what keeps the writes
   *  observable here. */
  async function runFinalTransitionAs(role, gameId) {
    localStorage.clear();
    auth6._resetAuthForTest?.();
    auth6.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true,
      supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
    auth6._setHasSupabaseDataBackendForTest(true);
    auth6._setMembershipsForTest([{ leagueId: LEAGUE6, memberId: 'p1', role, displayName: 'Tester', leagueName: 'IRB' }]);
    auth6.setActiveLeagueId(LEAGUE6);
    auth6._setAccountUserIdForTest('u-tester');

    storage.saveWeek(liveWeek());
    storage.saveGame(refreshableGame({ gameId, status: GAME_STATUS.LIVE, homeScore: 7, awayScore: 3, atsWinner: null }));
    storage.savePlayer({ playerId: 'p1', displayName: 'Tester', active: true, almaMater: '', preferences: {} });
    storage.saveAllPicks([{ pickId: `pk6_${gameId}`, weekId: 'rw1', gameId, playerId: 'p1', selectedTeam: 'Home', createdAt: new Date().toISOString() }]);
    storage.saveSetting('serverJobs', { scoresRefresh: false });          // the LEGACY path
    installEspnStub([espnEvent({ statusName: 'STATUS_FINAL', homeScore: '24', awayScore: '10' })]);
    state.currentTab = 'dashboard';
    // doRefreshScores() DIRECTLY, not through runAutoRefreshTick(). The tick's
    // first line is `if (isContentWithheld()) return;` (SECURITY S-2 — a device
    // with no proven identity does not tick at all), and a PROVEN supabase
    // identity needs a real auth session this harness cannot mint. The line
    // under test lives in doRefreshScores(), and the tick's own path is already
    // driven end-to-end by sections [1]-[5] under the local/PIN config.
    await app.doRefreshScores(storage.getCurrentWeek(), storage.getGames('rw1'));
    return storage.getGame(gameId);
  }

  const asPlayer = await runFinalTransitionAs('player', 'rg_n1p');
  assert(asPlayer.status === GAME_STATUS.FINAL && asPlayer.homeScore === 24,
    `6-0: fixture check — the legacy path still wrote the SCORE and STATUS on a player phone (those ARE in GAME_SCORE_FIELDS, so they are the overlay, not a refusal) (got ${JSON.stringify({ s: asPlayer.status, h: asPlayer.homeScore })})`);
  assert(asPlayer.atsWinner == null,
    `6-1: …and did NOT attempt the atsWinner persist (got ${JSON.stringify(asPlayer.atsWinner)}). In production that call is an AdapterWriteRefusedError swallowed into a console.warn — and the throw skipped emitGameFinalEvent() on the same line, which is why the ATS post only ever arrived from the commissioner's device`);
  assert(!!chat6.getMessage('sys_final_rg_n1p'),
    '6-2: …while the FINAL chat post STILL happens on that phone — the post never needed the write, and js/scoring.js:106 already falls back to calculateAtsWinner(game) when the column is null');

  const asComm = await runFinalTransitionAs('commissioner', 'rg_n1c');
  assert(asComm.atsWinner === 'Home',
    `6-3: THE COMMISSIONER'S DEVICE IS UNCHANGED — it still persists atsWinner, exactly as today (got ${JSON.stringify(asComm.atsWinner)}). This is the half a "just delete the write" fix would have broken silently`);
  assert(!!chat6.getMessage('sys_final_rg_n1c'),
    '6-4: …and posts the same event');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Logo backfill (Drew, 2026-09-27: "I flipped the logos switch and');
console.log('    didn\'t see any logos") — a null stored logo is filled from the same');
console.log('    ESPN read a score refresh already makes; a set one is never overwritten…');
{
  // A raw ESPN event WITH team.logo URLs — espnEvent() (section [1]-[6]'s own
  // fixture) never sets this field, so this is a local, self-contained
  // payload rather than widening that shared helper's shape for every other
  // section in this file.
  function espnEventWithLogos({ id = '401520200', homeLogo = 'https://a.espncdn.com/i/teamlogos/ncaa/500/1.png', awayLogo = 'https://a.espncdn.com/i/teamlogos/ncaa/500/2.png' } = {}) {
    return {
      id, date: '2026-09-08T18:00Z',
      status: { type: { name: 'STATUS_IN_PROGRESS', detail: 'Q2', shortDetail: 'Q2' } },
      competitions: [{
        timeValid: true, neutralSite: false,
        competitors: [
          { homeAway: 'home', id: '1', score: '10', curatedRank: { current: 99 }, team: { id: '1', location: 'Home', name: 'Hosts', shortDisplayName: 'Home', logo: homeLogo } },
          { homeAway: 'away', id: '2', score: '3', curatedRank: { current: 99 }, team: { id: '2', location: 'Away', name: 'Visitors', shortDisplayName: 'Away', logo: awayLogo } },
        ],
        odds: [], broadcasts: [], notes: [],
        venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } },
      }],
    };
  }

  // FIXTURE (2026-09-28, security F1): this section is the LOCAL / non-supabase
  // world — every device may write every column, so mayPersistGameGrading() is
  // true. Stated explicitly, because until now it inherited section [6]'s last
  // supabase-mode COMMISSIONER session by accident, and a reorder of [6] would
  // have turned 7-1 red for a reason unrelated to the backfill. The player and
  // commissioner halves in supabase mode are section [8].
  (await import('./js/auth.js'))._resetAuthForTest();
  assert((await import('./js/auth.js')).isSupabaseDataMode() === false,
    '7-0: fixture check — section [7] runs in the non-supabase (local) data mode, where every device persists');

  // ── (a) a stored game with NULL logos gains them on refresh ──────────────
  localStorage.clear();
  storage.saveWeek(liveWeek());
  storage.saveGame(refreshableGame({ gameId: 'rg_logo_null', espnEventId: '401520200', homeLogo: null, awayLogo: null }));
  installEspnStub([espnEventWithLogos()]);
  await app.doRefreshScores(storage.getCurrentWeek(), storage.getGames('rw1'));
  const filled = storage.getGame('rg_logo_null');
  assert(filled.homeLogo === 'https://a.espncdn.com/i/teamlogos/ncaa/500/1.png' && filled.awayLogo === 'https://a.espncdn.com/i/teamlogos/ncaa/500/2.png',
    `7-1: a stored game with null homeLogo/awayLogo gains them from this same ESPN read (got ${JSON.stringify({ h: filled.homeLogo, a: filled.awayLogo })})`);

  // ── (b) a stored, already-set logo is NEVER overwritten by a live poll ───
  localStorage.clear();
  storage.saveWeek(liveWeek());
  storage.saveGame(refreshableGame({ gameId: 'rg_logo_set', espnEventId: '401520200', homeLogo: 'https://irbfootball.example/custom-home.png', awayLogo: 'https://irbfootball.example/custom-away.png' }));
  installEspnStub([espnEventWithLogos()]);
  await app.doRefreshScores(storage.getCurrentWeek(), storage.getGames('rw1'));
  const kept = storage.getGame('rg_logo_set');
  assert(kept.homeLogo === 'https://irbfootball.example/custom-home.png' && kept.awayLogo === 'https://irbfootball.example/custom-away.png',
    `7-2: a game whose logos are already set is UNCHANGED by a live poll — never silently overwritten (got ${JSON.stringify({ h: kept.homeLogo, a: kept.awayLogo })})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// [8] SECURITY-REVIEWER F1 (full-branch audit, 2026-09-28) — THE LOGO BACKFILL
//     THREW overlay_only ON EVERY PLAYER DEVICE.
//
// Section [7] runs with storage in LOCAL mode, where every write succeeds, so it
// could not see this. In supabase data mode a player device's saveGame() of
// `cfbp_games` is routed to the adapter's `_setOverlay()`, whose contract is
// that a player may change ONLY GAME_SCORE_FIELDS — homeLogo/awayLogo are not
// on it (8-C proves the adapter refuses them, code 'overlay_only'). The
// backfill merged them into the player's write regardless.
//
// WHAT THE REAL SEAM ACTUALLY DOES WITH THAT WRITE (measured here, 2026-09-28,
// not predicted): with the overlay empty — the state every player device is in
// after a hydrate — `sb.get('cfbp_games')` hands back the mirror array BY
// REFERENCE, saveGame() replaces the row inside it in place, and `_setOverlay()`
// then diffs the mirror against itself and finds nothing to refuse. So the
// audit's predicted throw does not fire; instead the logo fields land in the
// player's mirror — the copy that is supposed to hold SERVER TRUTH — through a
// path that never consulted the allow-list. (Not pushed: no dirty mark.) The
// aliasing is a separate, pre-existing adapter defect reported for its own fix;
// this section pins the part that is this change's: the player path must not
// carry logo fields at all, so it no longer depends on the aliasing to survive.
//
// Driven through the REAL adapter (js/supabase-backend.js) over an ACTIVE
// hydrated base, with the REAL role resolution (storage.getSession() ->
// auth.js memberships).
console.log('\n[8] Security F1 — a player device\'s refresh never sends logo fields (the real adapter)…');
{
  const auth8 = await import('./js/auth.js');
  const sb8 = await import('./js/supabase-backend.js');
  const LEAGUE8 = 'L-LOGO';
  const LOGO_H = 'https://a.espncdn.com/i/teamlogos/ncaa/500/31.png';
  const LOGO_A = 'https://a.espncdn.com/i/teamlogos/ncaa/500/32.png';
  const quiet8 = async (fn) => {
    const rl = console.log, rw = console.warn, re = console.error, ri = console.info;
    console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try { return await fn(); } finally { console.log = rl; console.warn = rw; console.error = re; console.info = ri; }
  };
  /** A live event carrying team logos — the ESPN shape that triggers
   *  data-provider.js's backfill for any stored row whose logo is null. */
  const ev8 = (id, home, away) => ({
    id, date: '2026-09-08T18:00Z',
    status: { type: { name: 'STATUS_IN_PROGRESS', detail: 'Q2', shortDetail: 'Q2' } },
    competitions: [{
      timeValid: true, neutralSite: false,
      competitors: [
        { homeAway: 'home', id: '31', score: String(home), curatedRank: { current: 99 }, team: { id: '31', location: 'Home', name: 'Hosts', shortDisplayName: 'Home', logo: LOGO_H } },
        { homeAway: 'away', id: '32', score: String(away), curatedRank: { current: 99 }, team: { id: '32', location: 'Away', name: 'Visitors', shortDisplayName: 'Away', logo: LOGO_A } },
      ],
      odds: [], broadcasts: [], notes: [],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } },
    }],
  });
  // Game 1 has NULL logos (a pre-v0.26.0 row — the backfill's target) and comes
  // FIRST, so on the defect it throws before game 2 is ever reached. Game 2's
  // logos are already set, so it never backfills — it is the "remaining game".
  const games8 = () => ([
    refreshableGame({ gameId: 'rg_f1_null', espnEventId: '401520301', status: GAME_STATUS.LIVE, homeScore: 0, awayScore: 0, homeLogo: null, awayLogo: null }),
    refreshableGame({ gameId: 'rg_f1_set', espnEventId: '401520302', status: GAME_STATUS.LIVE, homeScore: 0, awayScore: 0, homeLogo: 'https://irbfootball.example/h.png', awayLogo: 'https://irbfootball.example/a.png' }),
  ]);
  const fakeClient8 = () => {
    const thenable = () => ({ select() { return this; }, eq() { return this; }, then(res) { return res({ data: [], error: null }); } });
    return { from: () => thenable(), rpc: async () => ({ data: [], error: null }) };
  };

  async function runAs(role) {
    localStorage.clear();
    auth8._resetAuthForTest?.();
    auth8.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true,
      supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
    auth8._setMembershipsForTest([{ leagueId: LEAGUE8, memberId: 'p1', role, displayName: 'Tester', leagueName: 'IRB' }]);
    await quiet8(() => auth8.setActiveLeagueId(LEAGUE8));
    auth8._setAccountUserIdForTest('u-logo');
    auth8._setStoredSessionForTest?.({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    auth8._setHasSupabaseDataBackendForTest(true);
    sb8._resetForTest();
    sb8.init({
      register: auth8.registerSupabaseDataBackend,
      getClient: () => fakeClient8(),
      getActiveLeagueId: () => LEAGUE8,
      getIdentityEpoch: auth8.getIdentityEpoch,
      getAccountUserId: auth8.getAccountUserId,
      getDeviceDataOwnerTuple: auth8.getDeviceDataOwnerTuple,
      getDeviceDataOwner: auth8.getDeviceDataOwner,
      getLeagueName: auth8._switchBannerLeagueName,
      getLeagueNameById: auth8._leagueNameById,
      getSession: storage.getSession,          // the REAL role resolution
      hasValidSupabaseSession: auth8.hasValidSupabaseSession,
      isPrivilegeHeld: auth8.isPrivilegeHeld,
      hasSheetMirror: auth8.hasSheetMirrorOnDevice,
      isSiteUnlocked: storage.isSiteUnlocked,
    });
    await quiet8(() => sb8.hydrate(LEAGUE8, { epoch: auth8.getIdentityEpoch() }));
    storage.setBackendMode('supabase');
    // The hydrated base: what the server last wrote, i.e. the mirror the
    // overlay diffs against.
    sb8._seedMirrorForTest('cfbp_weeks', [liveWeek()]);
    sb8._seedMirrorForTest('cfbp_active_week', 'rw1');
    sb8._seedMirrorForTest('cfbp_games', games8());
    sb8._seedMirrorForTest('cfbp_settings', { serverJobs: { scoresRefresh: false } });   // server job OFF: the client is the writer
    sb8._seedMirrorForTest('cfbp_picks', []);
    sb8._seedMirrorForTest('cfbp_lock_overrides', {});
    installEspnStub([ev8('401520301', 14, 7), ev8('401520302', 21, 3)]);
    let threw = null;
    await quiet8(async () => {
      try { await app.doRefreshScores(storage.getCurrentWeek(), storage.getGames('rw1')); }
      catch (e) { threw = e; }
    });
    // THE PLANNED WRITE, as a field diff against the hydrated base: every field
    // of every row that the refresh changed. Whatever reached the adapter is in
    // here (the aliased mirror, or the overlay on top of it — storage.getGame()
    // reads both), so this is the write, not a flag about the write.
    const base = new Map(games8().map(g => [g.gameId, g]));
    const changed = [];
    for (const g of storage.getGames('rw1')) {
      const b = base.get(g.gameId) || {};
      for (const k of new Set([...Object.keys(g), ...Object.keys(b)])) {
        if (JSON.stringify(g[k]) !== JSON.stringify(b[k])) changed.push(`${g.gameId}.${k}`);
      }
    }
    const out = {
      threw, changed,
      state: sb8.getState(),
      isAdmin: storage.getSession().isAdmin,
      overlay: new Map(sb8._overlayForTest()),
      dirty: sb8._dirtyKeysForTest(),
      g1: storage.getGame('rg_f1_null'),
      g2: storage.getGame('rg_f1_set'),
    };
    storage.setBackendMode('local');
    await quiet8(() => sb8._resetForTest());
    return out;
  }

  // ── (a) THE PLAYER PHONE — the defect ────────────────────────────────────
  const p = await runAs('player');
  assert(p.state === 'ACTIVE' && p.isAdmin === false,
    `8-0: fixture check — a PLAYER session over an ACTIVE hydrated adapter (state=${p.state}, isAdmin=${p.isAdmin}); anything else and the overlay route is not the one under test`);
  assert(p.threw === null,
    `8-1: a player device's refresh does NOT throw (got ${p.threw ? `${p.threw.name} code=${p.threw.code || (p.threw.detail && p.threw.detail.code)}: ${String(p.threw.message).slice(0, 160)}` : 'no throw'}) — saveGame() sits outside any try in doRefreshScores(), so a refusal here would abort the loop for every later game`);
  assert(p.g1 && p.g1.homeScore === 14 && p.g1.awayScore === 7,
    `8-2: the null-logo game's live SCORE still reaches this phone (got ${JSON.stringify(p.g1 && { h: p.g1.homeScore, a: p.g1.awayScore })})`);
  assert(p.g2 && p.g2.homeScore === 21 && p.g2.awayScore === 3,
    `8-3: …and so does the NEXT game's — the loop completed for every game on the slate (got ${JSON.stringify(p.g2 && { h: p.g2.homeScore, a: p.g2.awayScore })}); the score the audit feared would stop updating`);
  const fieldsOf = list => [...new Set(list.map(x => x.slice(x.indexOf('.') + 1)))].sort();
  assert(p.changed.some(x => x === 'rg_f1_null.homeScore') && p.changed.some(x => x === 'rg_f1_set.homeScore'),
    `8-4a: fixture check — the refresh really wrote both games (changed: ${JSON.stringify(p.changed)}); a diff of nothing would make 8-4 vacuous`);
  assert(!p.changed.some(x => /\.(homeLogo|awayLogo)$/.test(x)),
    `8-4: NO logo field in the player's planned write (changed fields: ${JSON.stringify(fieldsOf(p.changed))}) — before the fix rg_f1_null.homeLogo/awayLogo were in it, off the adapter's allow-list`);
  // `updatedAt` is saveGame()'s own stamp (js/storage.js saveGame) and was on
  // the player path before the backfill existed; it is named here so this
  // assertion states the pre-backfill write exactly rather than approximately.
  const allowed = [...sb8._gameScoreFieldsForTest(), 'updatedAt'];
  assert(fieldsOf(p.changed).every(f => allowed.includes(f)),
    `8-5: …every changed field is a GAME_SCORE_FIELDS field (or saveGame's updatedAt stamp) — the player path is byte-identical to before the backfill (fields: ${JSON.stringify(fieldsOf(p.changed))})`);
  assert(p.dirty.length === 0,
    `8-6: …and a player phone queued NO push (dirty: ${JSON.stringify(p.dirty)})`);
  assert(p.g1 && p.g1.homeLogo == null && p.g1.awayLogo == null,
    `8-7: …and the null logo stays null on the player's copy — the commissioner device is the one that backfills it (got ${JSON.stringify(p.g1 && { h: p.g1.homeLogo, a: p.g1.awayLogo })})`);

  // ── (c) THE CONTRACT THE GATE PROTECTS — the adapter REFUSES a player's logo
  //    write when it can see it (a non-aliased value, i.e. a real diff). This is
  //    what makes 8-4 a security property and not a style preference.
  {
    localStorage.clear();
    auth8._resetAuthForTest?.();
    auth8.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true,
      supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
    auth8._setMembershipsForTest([{ leagueId: LEAGUE8, memberId: 'p1', role: 'player', displayName: 'Tester', leagueName: 'IRB' }]);
    await quiet8(() => auth8.setActiveLeagueId(LEAGUE8));
    sb8._resetForTest();
    sb8.init({ getSession: storage.getSession, getActiveLeagueId: () => LEAGUE8, isPrivilegeHeld: () => false });
    sb8._seedMirrorForTest('cfbp_games', games8());
    let refused = null;
    try { sb8.set('cfbp_games', games8().map(g => (g.gameId === 'rg_f1_null' ? { ...g, homeLogo: LOGO_H } : g))); }
    catch (e) { refused = e; }
    const code = refused && (refused.code || (refused.detail && refused.detail.code));
    assert(storage.getSession().isAdmin === false && code === 'overlay_only' && /rg_f1_null\.homeLogo/.test(String(refused.message)),
      `8-C: the adapter REFUSES a player's homeLogo change with overlay_only when handed a real diff (got ${refused ? `${refused.name} ${code}` : 'no refusal'}) — logos are not player-writable, so the player path must never carry them`);
    await quiet8(() => sb8._resetForTest());
  }

  // ── (b) THE COMMISSIONER DEVICE — backfills, never overwrites ────────────
  const c = await runAs('commissioner');
  assert(c.state === 'ACTIVE' && c.isAdmin === true,
    `8-8: fixture check — the SAME fixture as a COMMISSIONER session (state=${c.state}, isAdmin=${c.isAdmin})`);
  assert(c.threw === null && c.dirty.includes('cfbp_games'),
    `8-9: the commissioner's refresh completes and queues the games write (threw=${c.threw && c.threw.name}, dirty=${JSON.stringify(c.dirty)})`);
  assert(c.g1 && c.g1.homeLogo === LOGO_H && c.g1.awayLogo === LOGO_A,
    `8-10: …and BACKFILLS the null logo from the same ESPN read (got ${JSON.stringify(c.g1 && { h: c.g1.homeLogo, a: c.g1.awayLogo })})`);
  assert(c.g2 && c.g2.homeLogo === 'https://irbfootball.example/h.png' && c.g2.awayLogo === 'https://irbfootball.example/a.png',
    `8-11: …and NEVER overwrites a stored logo (got ${JSON.stringify(c.g2 && { h: c.g2.homeLogo, a: c.g2.awayLogo })})`);
  assert(c.g1 && c.g2 && c.g1.homeScore === 14 && c.g2.homeScore === 21,
    '8-12: …and still writes both scores (the commissioner path is unchanged apart from the gate)');
}

// ═════════════════════════════════════════════════════════════════════════════
// [9] RG-292 (Drew, v0.27.1, 2026-09-28: "I'm refreshing scores on the existing
//     week and the logos aren't popping up for the games on the slate") — the
//     DISPLAY-ONLY poll never backfilled a logo on ANY device.
//
// While `settings.serverJobs.scoresRefresh` is true every device's 60s tick
// calls doRefreshScores({displayOnly:true}) (runAutoRefreshTick(), section [4]),
// and that branch `continue`d before the logo merge — so with the switch on,
// the only logo writer left was a commissioner pressing a manual refresh. The
// server job (`scores-refresh`) writes score columns only. Logos are not
// grading data and have no second writer to interleave with, so the
// commissioner/grader device now persists a LOGO-ONLY merge (nothing else on
// the row moves) even in display-only mode. A player device is unchanged: it
// still sends no logo field at all (section [8], RG-276).
//
// Driven through the REAL adapter with the hydrated games rows folded into its
// server base (`_foldRealtimeRowForTest`), so 9-3 reads the actual PATCH the
// planner would send — column by column — not a field diff of the mirror.
//
// WHAT THIS DOES NOT COVER (reported, not fixed here): on a LIVE week the
// Picks tab renders the SUBMITTED view, whose renderGameCard(…, showResult=true)
// omits the pick buttons — the only place a Picks card draws a logo — so the
// data this section proves is persisted is still not drawn on that card.
console.log('\n[9] RG-292 — the display-only poll (server switch ON) backfills logos on the commissioner device, logo columns only…');
{
  const auth9 = await import('./js/auth.js');
  const sb9 = await import('./js/supabase-backend.js');
  const proj9 = await import('./js/supabase-projection.js');
  const LEAGUE9 = 'L-LOGO9';
  const LOGO_H = 'https://a.espncdn.com/i/teamlogos/ncaa/500/41.png';
  const LOGO_A = 'https://a.espncdn.com/i/teamlogos/ncaa/500/42.png';
  const quiet9 = async (fn) => {
    const rl = console.log, rw = console.warn, re = console.error, ri = console.info;
    console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try { return await fn(); } finally { console.log = rl; console.warn = rw; console.error = re; console.info = ri; }
  };
  // ESPN says 28-7; the stored rows (what the SERVER last wrote) say 0-0. A
  // display-only poll must leave 0-0 on the row — the server job owns scores.
  const ev9 = (id) => ({
    id, date: '2026-09-08T18:00Z',
    status: { type: { name: 'STATUS_IN_PROGRESS', detail: 'Q3 4:10', shortDetail: 'Q3 4:10' } },
    competitions: [{
      timeValid: true, neutralSite: false,
      competitors: [
        { homeAway: 'home', id: '41', score: '28', curatedRank: { current: 99 }, team: { id: '41', location: 'Home', name: 'Hosts', shortDisplayName: 'Home', logo: LOGO_H } },
        { homeAway: 'away', id: '42', score: '7', curatedRank: { current: 99 }, team: { id: '42', location: 'Away', name: 'Visitors', shortDisplayName: 'Away', logo: LOGO_A } },
      ],
      odds: [], broadcasts: [], notes: [],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } },
    }],
  });
  // `updatedAt` is set because every served row has one (games.updated_at is
  // NOT NULL): without it the projection records the field in `extra.__absent`,
  // saveGame()'s stamp removes it from that list, and 9-3 would see an `extra`
  // change that no real hydrated row can produce.
  const games9 = () => ([
    refreshableGame({ gameId: 'rg_292_null', espnEventId: '401520901', status: GAME_STATUS.LIVE, homeScore: 0, awayScore: 0, lastUpdated: '2026-09-08T18:30:00.000Z', updatedAt: '2026-09-08T18:30:00.000Z', homeLogo: null, awayLogo: null }),
    refreshableGame({ gameId: 'rg_292_set', espnEventId: '401520902', status: GAME_STATUS.LIVE, homeScore: 0, awayScore: 0, lastUpdated: '2026-09-08T18:30:00.000Z', updatedAt: '2026-09-08T18:30:00.000Z', homeLogo: 'https://irbfootball.example/h9.png', awayLogo: 'https://irbfootball.example/a9.png' }),
  ]);
  const fakeClient9 = () => {
    const thenable = () => ({ select() { return this; }, eq() { return this; }, then(res) { return res({ data: [], error: null }); } });
    return { from: () => thenable(), rpc: async () => ({ data: [], error: null }) };
  };

  async function runDisplayOnlyAs(role) {
    localStorage.clear();
    auth9._resetAuthForTest?.();
    auth9.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true,
      supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
    auth9._setMembershipsForTest([{ leagueId: LEAGUE9, memberId: 'p1', role, displayName: 'Tester', leagueName: 'IRB' }]);
    await quiet9(() => auth9.setActiveLeagueId(LEAGUE9));
    auth9._setAccountUserIdForTest('u-logo9');
    auth9._setStoredSessionForTest?.({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    auth9._setHasSupabaseDataBackendForTest(true);
    sb9._resetForTest();
    sb9.init({
      register: auth9.registerSupabaseDataBackend,
      getClient: () => fakeClient9(),
      getActiveLeagueId: () => LEAGUE9,
      getIdentityEpoch: auth9.getIdentityEpoch,
      getAccountUserId: auth9.getAccountUserId,
      getDeviceDataOwnerTuple: auth9.getDeviceDataOwnerTuple,
      getDeviceDataOwner: auth9.getDeviceDataOwner,
      getLeagueName: auth9._switchBannerLeagueName,
      getLeagueNameById: auth9._leagueNameById,
      getSession: storage.getSession,          // the REAL role resolution
      hasValidSupabaseSession: auth9.hasValidSupabaseSession,
      isPrivilegeHeld: auth9.isPrivilegeHeld,
      hasSheetMirror: auth9.hasSheetMirrorOnDevice,
      isSiteUnlocked: storage.isSiteUnlocked,
    });
    await quiet9(() => sb9.hydrate(LEAGUE9, { epoch: auth9.getIdentityEpoch() }));
    storage.setBackendMode('supabase');
    sb9._seedMirrorForTest('cfbp_weeks', [liveWeek()]);
    sb9._seedMirrorForTest('cfbp_active_week', 'rw1');
    sb9._seedMirrorForTest('cfbp_settings', { serverJobs: { scoresRefresh: true } });   // server job ON: the tick is display-only
    sb9._seedMirrorForTest('cfbp_picks', []);
    sb9._seedMirrorForTest('cfbp_lock_overrides', {});
    // The server's rows, folded into the adapter's BASE (as a hydrate/Realtime
    // would), so planFlush() diffs against what the server really holds.
    for (const row of proj9.toRows.cfbp_games(games9(), { leagueId: LEAGUE9 }).games) {
      sb9._foldRealtimeRowForTest('games', { eventType: 'INSERT', new: { ...row, league_id: LEAGUE9 } });
    }
    const notif9 = await import('./js/notifications.js');
    const switchOn = notif9.isServerJobEnabled('scoresRefresh');
    app.liveStatusById.clear();
    installEspnStub([ev9('401520901'), ev9('401520902')]);
    let threw = null;
    await quiet9(async () => {
      // EXACTLY the call runAutoRefreshTick() makes with the switch on (js/app.js,
      // the `isServerJobEnabled('scoresRefresh')` branch; section [4] 4-3 drives
      // the tick itself). Called directly because the tick re-hydrates first in
      // supabase mode, which over this fake client would empty the seeded base.
      try { await app.doRefreshScores(storage.getCurrentWeek(), storage.getGames('rw1'), { displayOnly: switchOn }); }
      catch (e) { threw = e; }
    });
    const { plan, refusals } = sb9.planFlush();
    const out = {
      threw, switchOn,
      state: sb9.getState(),
      isAdmin: storage.getSession().isAdmin,
      gamesOps: plan.filter(op => op && op.table === 'games'),
      refusals,
      overlay: new Map(sb9._overlayForTest()),
      dirty: sb9._dirtyKeysForTest(),
      g1: storage.getGame('rg_292_null'),
      g2: storage.getGame('rg_292_set'),
      live1: app.liveStatusById.get('rg_292_null'),
    };
    storage.setBackendMode('local');
    await quiet9(() => sb9._resetForTest());
    return out;
  }

  // ── (a) THE COMMISSIONER DEVICE — the reported defect ────────────────────
  const c = await runDisplayOnlyAs('commissioner');
  assert(c.state === 'ACTIVE' && c.isAdmin === true && c.switchOn === true,
    `9-0: fixture check — a COMMISSIONER session over an ACTIVE adapter with serverJobs.scoresRefresh ON (state=${c.state}, isAdmin=${c.isAdmin}, switch=${c.switchOn})`);
  assert(c.threw === null,
    `9-1a: the display-only refresh completes (threw=${c.threw && c.threw.name})`);
  assert(c.g1 && c.g1.homeLogo === LOGO_H && c.g1.awayLogo === LOGO_A,
    `9-1: with the server switch ON, the commissioner device's display-only poll BACKFILLS the null logos from the same ESPN read (got ${JSON.stringify(c.g1 && { h: c.g1.homeLogo, a: c.g1.awayLogo })}) — before RG-292 the display-only branch continued past the merge and no device ever wrote them`);
  assert(c.dirty.includes('cfbp_games'),
    `9-2: …and queues the games write so the backfill reaches every phone (dirty=${JSON.stringify(c.dirty)})`);
  assert(c.g1 && c.g1.homeScore === 0 && c.g1.awayScore === 0 && c.g1.status === GAME_STATUS.LIVE && c.g1.lastUpdated === '2026-09-08T18:30:00.000Z',
    `9-3a: …while the row's SCORE/STATUS/lastUpdated stay exactly what the server wrote (got ${JSON.stringify(c.g1 && { h: c.g1.homeScore, a: c.g1.awayScore, s: c.g1.status, lu: c.g1.lastUpdated })}); ESPN said 28-7, the server job owns that column`);
  const patch1 = c.gamesOps.filter(op => op.op === 'patch' && op.rowId === 'rg_292_null');
  const cols1 = patch1.length === 1 ? Object.keys(patch1[0].changed || {}).sort() : null;
  assert(!!cols1 && cols1.includes('home_logo') && cols1.includes('away_logo')
      && cols1.every(col => ['home_logo', 'away_logo', 'updated_at'].includes(col)),
    `9-3: THE REAL PATCH the planner would send touches ONLY home_logo/away_logo (+ saveGame's updated_at stamp) — never home_score/away_score/status/actual_winner/ats_winner/last_updated/kickoff (got ${JSON.stringify(cols1)}, ops=${JSON.stringify(c.gamesOps.map(o => ({ op: o.op, id: o.rowId })))}, refusals=${c.refusals.length})`);
  assert(!c.gamesOps.some(op => op.rowId === 'rg_292_set') && c.g2 && c.g2.homeLogo === 'https://irbfootball.example/h9.png' && c.g2.awayLogo === 'https://irbfootball.example/a9.png' && c.g2.homeScore === 0,
    `9-4: a game whose logos are already set gets NO write at all in display-only mode — never overwritten, and no score smuggled in (ops for it: ${JSON.stringify(c.gamesOps.filter(o => o.rowId === 'rg_292_set').map(o => o.op))})`);
  assert(!!c.live1 && c.live1.detail === 'Q3 4:10',
    `9-5: …and the display-only pass still fills liveStatusById, the thing it exists for (got ${JSON.stringify(c.live1 && c.live1.detail)})`);

  // ── (b) THE PLAYER PHONE — unchanged: no logo field, no write ────────────
  const p = await runDisplayOnlyAs('player');
  assert(p.state === 'ACTIVE' && p.isAdmin === false && p.switchOn === true,
    `9-6: fixture check — the SAME fixture as a PLAYER session (state=${p.state}, isAdmin=${p.isAdmin}, switch=${p.switchOn})`);
  assert(p.threw === null && p.dirty.length === 0 && p.gamesOps.length === 0 && p.overlay.size === 0,
    `9-7: a player's display-only poll still writes NOTHING — no push, no plan, no overlay (threw=${p.threw && p.threw.name}, dirty=${JSON.stringify(p.dirty)}, ops=${p.gamesOps.length}, overlay=${p.overlay.size}); logos are not on the player allow-list (8-C)`);
  assert(p.g1 && p.g1.homeLogo == null && p.g1.awayLogo == null && p.g1.homeScore === 0,
    `9-8: …and the player's copy is untouched — it receives the logo when the commissioner's write lands via Realtime (got ${JSON.stringify(p.g1 && { h: p.g1.homeLogo, a: p.g1.awayLogo, s: p.g1.homeScore })})`);
  assert(!!p.live1 && p.live1.detail === 'Q3 4:10',
    `9-9: …while its quarter/clock still render (got ${JSON.stringify(p.live1 && p.live1.detail)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n[refreshtest] ${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
