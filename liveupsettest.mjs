/**
 * liveupsettest.mjs — SCRIBE's live-upset call-outs (N8 · DI-439 / DI-440, 2026-09-29).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS (the CLIENT half; the SERVER half is scribeAutonomous.twin.mjs [N8])
 *
 *   Drew's rulings Q1-Q4 (UN-314 / UN-384), plus his 2026-09-29 ruling that the alma
 *   call-out fires on BOTH conditions. Three detectors ride the one score poll that
 *   coverfliptest.mjs already drives, behind one gate and the same four rules
 *   (second half, observed, held 5 minutes, once per direction):
 *
 *     CROWD      a cover that turned against a real crowd — definition A: L >= 2 of the
 *                room on the team now NOT covering, and L > G.
 *     ALMA       a locked-in claimed school's team that turns to LOSING STRAIGHT-UP or to
 *                NOT COVERING. One situation is one post whichever applies.
 *     UPSET      an underdog leading by 9+ for 5 minutes AND the crowd rule.
 *
 *   ROUTING (DI-440 §2): a settled call goes to the SERVER path (`considerAutonomous
 *   ('liveUpset', …)`) naming nobody; only `not_ready` / `server_off_latch` falls back to
 *   the unnamed tier-0 line; every other refusal posts nothing.
 *
 * EVERYTHING HERE RUNS THE REAL `scribeLiveGameCheck()` over the REAL storage, chat fold and
 * `considerAutonomous()`, with a controllable clock and a recording stand-in for the network
 * transport (the seam `scribeAgent.wireScribeRemoteTransport` documents for exactly this).
 *
 * NOT covered here (device only): that a line renders in the room, and six phones converging
 * on one post over Realtime.
 */

// ── DOM / localStorage stubs (coverfliptest.mjs shape) ──────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
function makeEl(id) {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
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
globalThis.fetch = async () => { throw new Error('network disabled in liveupsettest'); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// ── A controllable clock: the sustain window, the cooldowns and the id buckets all read it. ──
const realNow = Date.now.bind(Date);
const T0 = Date.parse('2026-09-26T20:00:00Z');
let clock = T0;
Date.now = () => clock;
const MIN = 60 * 1000;

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const dm = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const scribeLines = await import('./js/scribeLines.js');
const scribeAgent = await import('./js/scribeAgent.js');
const scoring = await import('./js/scribe-scoring.js');
const app = await import('./js/app.js');
const { listProfiles, normalizeSportKey } = await import('./js/sports/index.js');
const { WEEK_STATUS, GAME_STATUS } = dm;
const { SCRIBE_POOLS } = scribeLines;

// ── Fixtures ────────────────────────────────────────────────────────────────
// Home favoured by 3 (signed home-perspective spread -3, AD-03). With scores H and A the home
// team covers when H - 3 > A:  14-7 -> home covers by 4;  14-14 -> AWAY covers by 3.
const ROSTER = [['p1', 'Brayden', ''], ['p2', 'Kevin', ''], ['p3', 'Koby', ''], ['p4', 'Jacob', '']];

/** Seeds one live week, one game and a roster, and wires autonomy. `mode`:
 *    'notready' — no transport wired: autonomy is NOT ready, so a settled call falls back to tier-0;
 *    'ready'    — a recording transport is wired: a settled call goes to the (stub) server. */
function seed(gameId, {
  home = 'Home', away = 'Away', spread = -3, favorite = 'Home',
  picks = { p1: 'Home', p2: 'Home', p3: 'Home', p4: 'Away' },
  players = ROSTER, lockedAlma = null, weekStatus = WEEK_STATUS.LIVE,
  espnSport = null, mode = 'notready', frequency = 'balanced', extra = {}, autonomousResult = { ok: true, posted: true },
} = {}) {
  localStorage.clear();
  scribeLines._resetAutonomousStateForTest();
  chatUi._resetCoverageFlipStateForTest();
  chat._resetForTest();
  storage.saveSetting('scribeFrequency', frequency);
  storage.saveSetting('scribeAutonomousEnabled', true);
  const calls = [];
  if (mode === 'ready') {
    scribeAgent.wireScribeRemoteTransport({
      autonomous: async body => { calls.push(body); return typeof autonomousResult === 'function' ? autonomousResult(body) : autonomousResult; },
    });
  } else {
    scribeAgent.wireScribeRemoteTransport({});
  }
  storage.saveWeek({
    weekId: 'lw1', weekNumber: 1, label: 'Week 1', season: 2026,
    status: weekStatus, dataSourceMode: 'espn_live',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    lockedAlmaMaters: lockedAlma,
  });
  const game = {
    gameId, weekId: 'lw1', homeTeam: home, awayTeam: away, homeMascot: '', awayMascot: '',
    kickoff: '2026-09-26T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread, favorite, lockedSpread: spread,
    homeScore: 0, awayScore: 0, status: GAME_STATUS.LIVE, actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_live', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: null, espnSport,
  };
  storage.saveGame(game);
  players.forEach(([playerId, displayName, almaMater]) =>
    storage.savePlayer({ playerId, displayName, active: true, almaMater, preferences: {} }));
  storage.saveAllPicks(Object.entries(picks).map(([playerId, selectedTeam]) => ({
    pickId: `pk_${gameId}_${playerId}`, weekId: 'lw1', gameId, playerId, selectedTeam, createdAt: new Date(T0).toISOString(),
  })));
  return { gameId, game: { ...game, ...extra }, calls, start: clock };
}

/** One score poll at `atMin` minutes past the section's start, through the REAL detector. */
function poll(g, atMin, home, away, period) {
  clock = g.start + atMin * MIN;
  const next = { ...g.game, homeScore: home, awayScore: away };
  chatUi.scribeLiveGameCheck({ ...g.game, homeScore: 0, awayScore: 0 }, next, period === undefined ? null : { period });
}
/** Polls a script: `[[min, home, away, period], …]`. */
function run(g, script) { for (const [m, h, a, p] of script) poll(g, m, h, a, p); }
/** Holds a state one poll per minute from `from` to `to` inclusive. */
function hold(g, from, to, h, a, p) { for (let m = from; m <= to; m++) poll(g, m, h, a, p); }

const scribeRows = (gameId) => chat.getMessages({ tag: gameId }).filter(m => m.author === 'scribe');
const lines = (gameId, trigger) => scribeRows(gameId).filter(m => m.meta?.trigger === trigger);
const tick = () => new Promise(r => setImmediate(r));
let seqCounter = 950000;
function plant(gameId, id, body = 'planted', author = 'scribe') {
  seqCounter += 1;
  chat.ingest([{ id, seq: seqCounter, type: 'message', author, gameTag: gameId, body, ts: clock, meta: { source: 'tier0' } }], seqCounter, { caughtUp: true });
}

// A cover turn toward AWAY, the qualifying direction for the fixture's 3-1 room.
const TURN_AWAY = g => { run(g, [[0, 14, 7, 3], [1, 14, 14, 3]]); hold(g, 2, 6, 14, 14, 3); };

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The pure predicates — the sport resolver, the second-half table, definition A, the alma state…');
{
  const S = scoring;
  // R1 — a stored game's espnSport is null / 'college-football' / 'nfl', NEVER 'cfb'.
  assert(S.sportDbCodeForGame({ espnSport: null }) === 'cfb' && S.sportDbCodeForGame({}) === 'cfb' && S.sportDbCodeForGame({ espnSport: undefined }) === 'cfb',
    '1-1: espnSport null / absent is college football — the value EVERY ordinary ESPN college game carries');
  assert(S.sportDbCodeForGame({ espnSport: 'college-football' }) === 'cfb' && S.sportDbCodeForGame({ espnSport: 'nfl' }) === 'nfl',
    "1-2: 'college-football' -> cfb, 'nfl' -> nfl");
  for (const bad of ['cfb', 'NFL', 'basketball', '', ' nfl', 'curling', 7, {}, []]) {
    assert(S.sportDbCodeForGame({ espnSport: bad }) === null, `1-3: espnSport ${JSON.stringify(bad)} is UNKNOWN -> silent (null) — a sport this build has no rule for is never guessed at`);
  }
  assert(S.sportDbCodeForGame(null) === null && S.sportDbCodeForGame(undefined) === null && S.sportDbCodeForGame('nfl') === null,
    '1-4: no game object at all is silent');
  // Profile parity (the interim table and the resolver are pinned to Phase 0's registry).
  const profiles = listProfiles();
  assert(profiles.length >= 2 && profiles.every(p => S.sportDbCodeForGame({ espnSport: normalizeSportKey(p.key) }) === p.key),
    `1-5: for every registered profile, the resolver maps its legacy ESPN key back to its dbCode (${profiles.map(p => p.key).join(', ')}) — the resolver cannot drift from listProfiles()`);
  assert(profiles.every(p => S.SECOND_HALF_FROM_PERIOD[p.key] === p.secondHalfFromPeriod),
    '1-6: …and the interim second-half table equals every profile\'s own `secondHalfFromPeriod` slot');
  assert(JSON.stringify(Object.keys(S.SECOND_HALF_FROM_PERIOD)) === JSON.stringify(['cfb', 'nfl', 'nba', 'cbb', 'mm', 'nhl', 'wjc'])
    && Object.isFrozen(S.SECOND_HALF_FROM_PERIOD), '1-7: the table has exactly the seven DI keys and is frozen');
  // Period edges per sport.
  const edge = (code, p) => { const n = S.secondHalfFromPeriod(code); return n !== null && p >= n; };
  assert(!edge('cfb', 2) && edge('cfb', 3) && edge('cfb', 5), '1-8: football: period 2 is the first half, 3 the second, overtime (5) counts');
  assert(!edge('nfl', 2) && edge('nfl', 3), '1-9: nfl the same');
  assert(!edge('cbb', 1) && edge('cbb', 2) && !edge('mm', 1) && edge('mm', 2) && !edge('nba', 2) && edge('nba', 3),
    '1-10: two-half college basketball / March Madness start the second half at period 2; nba at 3');
  assert(S.secondHalfFromPeriod('nhl') === null && S.secondHalfFromPeriod('wjc') === null,
    '1-11: hockey has NO second half — null, the sport never fires');
  for (const bad of ['constructor', '__proto__', 'toString', 'zzz', '', null, undefined, 3]) {
    assert(S.secondHalfFromPeriod(bad) === null, `1-12: secondHalfFromPeriod(${JSON.stringify(bad)}) is null (own-property lookup; prototype names are unknown)`);
  }
  // Definition A.
  const A = S.crowdTurn;
  assert(A(1, 0) === false, '1-13: (L=1, G=0) is one player — silent');
  assert(A(2, 2) === false && A(3, 3) === false, '1-14: (2,2) and (3,3) are a split room — silent');
  assert(A(0, 2) === false && A(0, 0) === false, '1-15: (0,2) is the room being RIGHT — silent');
  assert(A(2, 1) === true && A(3, 1) === true && A(2, 0) === true && A(4, 3) === true, '1-16: (2,1), (3,1), (2,0), (4,3) fire — L >= 2 and L > G');
  assert(A(NaN, 1) === false && A(2, NaN) === false && A(undefined, 0) === false && A('x', 0) === false, '1-17: a non-count is silent');
  // The alma state.
  const st = (h, a, spread, side) => S.almaSideState({ homeScore: h, awayScore: a, spread, side });
  assert(JSON.stringify(st(14, 17, -3, 'home')) === '{"su":true,"ats":true}', '1-18: a 3-point favorite trailing 14-17 is BOTH behind');
  assert(JSON.stringify(st(14, 17, 10, 'home')) === '{"su":true,"ats":false}', '1-19: a +10 underdog trailing 14-17 is behind straight-up but still COVERING');
  assert(JSON.stringify(st(21, 17, -7, 'home')) === '{"su":false,"ats":true}', '1-20: a 7-point favorite leading 21-17 is winning but NOT covering');
  assert(JSON.stringify(st(14, 14, 10, 'home')) === '{"su":false,"ats":false}', '1-21: a tie is "on the number" — not behind straight-up (and a +10 dog covers)');
  assert(JSON.stringify(st(17, 14, -3, 'home')) === '{"su":false,"ats":false}', '1-22: exactly ON the number (17-3 = 14) is not "not covering"');
  assert(JSON.stringify(st(17, 14, -3, 'away')) === '{"su":true,"ats":false}', '1-23: …and from the AWAY side the same score is behind straight-up only');
  assert(JSON.stringify(st(14, 17, null, 'home')) === '{"su":true,"ats":false}' && JSON.stringify(st(14, 17, '', 'home')) === '{"su":true,"ats":false}',
    '1-24: no line means `ats` is false — never a guess');
  assert(st(null, 17, -3, 'home') === null && st(14, undefined, -3, 'home') === null && st(14, 17, -3, 'up') === null && st('x', 1, -3, 'home') === null,
    '1-25: a missing score or an unknown side is no state at all');
  assert(S.almaCondition({ su: true, ats: true }) === 'both' && S.almaCondition({ su: true, ats: false }) === 'su'
    && S.almaCondition({ su: false, ats: true }) === 'ats' && S.almaCondition({ su: false, ats: false }) === null && S.almaCondition(null) === null,
    '1-26: almaCondition names which condition(s) apply');
}

console.log('\n[1b] almaMaterPlayersForTeam — the pure helper, and its parity with claimedAlmaMaters()…');
{
  const roster = [
    { playerId: 'a', active: true, almaMater: 'USC' }, { playerId: 'b', active: true, almaMater: '  usc ' },
    { playerId: 'c', active: false, almaMater: 'USC' }, { playerId: 'd', active: true, almaMater: 'Arkansas' },
    { playerId: 'e', active: true, almaMater: '' },
  ];
  const ids = (l) => l.map(p => p.playerId).join(',');
  const H = dm.almaMaterPlayersForTeam;
  assert(ids(H(roster, 'USC', ['USC', 'Arkansas'])) === 'a,b', "1b-1: the ACTIVE claimants of 'USC' — trim + case-insensitive, and NOT the deactivated player");
  assert(ids(H(roster, 'Southern California', ['USC', 'Arkansas'])) === 'a,b', '1b-2: …matched through getAlmaMaterMatch\'s patterns ("Southern California" is USC)');
  assert(ids(H(roster, 'Arkansas State', ['USC', 'Arkansas'])) === '', '1b-3: "Arkansas State" is NOT Arkansas (RG-02\'s exclusion table applies — the ONE shared matcher)');
  assert(ids(H(roster, 'Arkansas', ['USC', 'Arkansas'])) === 'd', '1b-4: …while Arkansas itself is');
  assert(ids(H(roster, 'USC', ['Arkansas'])) === '', '1b-5: a school NOT in the locked list has no claimants, however many players typed it');
  for (const bad of [null, undefined, [], 'USC', {}]) assert(ids(H(roster, 'USC', bad)) === '', `1b-6: a locked list of ${JSON.stringify(bad)} means NO alma call-out (never a fall-back to the live catalog or roster)`);
  assert(ids(H(null, 'USC', ['USC'])) === '' && ids(H(roster, '', ['USC'])) === '' && ids(H(roster, null, ['USC'])) === '', '1b-7: degenerate inputs are empty, never a throw');
  assert(dm.almaMaterPlayersForTeam.length === 3, '1b-8: it takes (players, teamName, lockedAlmaMaters) and nothing ambient');
  // Parity with app.js's claimedAlmaMaters() on ONE roster.
  localStorage.clear();
  for (const p of roster) storage.savePlayer({ ...p, displayName: p.playerId, preferences: {} });
  const claimed = app.claimedAlmaMaters();
  assert(JSON.stringify(claimed) === JSON.stringify(['USC', 'Arkansas']),
    `1b-9: fixture — claimedAlmaMaters() on this roster is the deduped, active-only ["USC","Arkansas"] (got ${JSON.stringify(claimed)})`);
  const norm = s => String(s || '').trim().toLowerCase();
  for (const school of claimed) {
    const expected = storage.getPlayers().filter(p => p.active && norm(p.almaMater) === norm(school)).map(p => p.playerId).join(',');
    assert(ids(H(storage.getPlayers(), school, claimed)) === expected && expected.length > 0,
      `1b-10: PARITY — for the claimed school "${school}", the helper returns exactly the players claimedAlmaMaters() built that entry from (${expected})`);
  }
  assert(ids(H(storage.getPlayers(), 'Purdue', claimed)) === '', '1b-11: …and a school nobody claims returns none');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] The gates — the blind rule, the sport, the second half, the hold…');
{
  // Control: the standard turn posts the unnamed tier-0 line (autonomy not ready).
  const g0 = seed('lu_ctl');
  TURN_AWAY(g0);
  assert(lines('lu_ctl', 'coverageFlip').length === 1, `2-0: control — a held second-half turn toward AWAY (3 of 4 on the team now NOT covering) posts once (got ${lines('lu_ctl', 'coverageFlip').length})`);
  assert(lines('lu_ctl', 'coverageFlip')[0].id === 'scribe_coverageFlip_lu_ctl_away_0', `2-0b: …under the fallback id <game>_<side> with bucketMin 1e9 giving _0 (got ${lines('lu_ctl', 'coverageFlip')[0].id})`);

  // THE BLIND RULE — before picks are public, nothing.
  for (const [label, status] of [['OPEN', WEEK_STATUS.OPEN], ['LOCKED', WEEK_STATUS.LOCKED], ['DRAFT', WEEK_STATUS.DRAFT]]) {
    const g = seed(`lu_blind_${label}`, { weekStatus: status });
    TURN_AWAY(g);
    assert(scribeRows(g.gameId).length === 0 && chatUi._coverageFlipStateForTest(g.gameId) === null,
      `2-1: a ${label}-week game posts NOTHING and is not even observed — the blind rule gates the whole function (arePicksPublic)`);
  }
  {
    const g = seed('lu_blind_ready', { weekStatus: WEEK_STATUS.OPEN, mode: 'ready' });
    TURN_AWAY(g);
    assert(g.calls.length === 0, '2-2: …and the SERVER path is not called either');
  }
  // The sport.
  {
    const g = seed('lu_q', { extra: { market: { type: 'question' } } });
    TURN_AWAY(g);
    assert(scribeRows('lu_q').length === 0, '2-3: a hockey-style QUESTION row is not a game to call');
    const g2 = seed('lu_child', { extra: { parentGameId: 'lu_parent' } });
    TURN_AWAY(g2);
    assert(scribeRows('lu_child').length === 0, '2-4: …nor is a CHILD of one');
    const g3 = seed('lu_curl', { espnSport: 'curling' });
    TURN_AWAY(g3);
    assert(scribeRows('lu_curl').length === 0, '2-5: an unknown sport is silent');
    for (const [id, sport] of [['lu_nfl', 'nfl'], ['lu_cfbkey', 'college-football'], ['lu_nullsport', null]]) {
      const gs = seed(id, { espnSport: sport });
      TURN_AWAY(gs);
      assert(lines(id, 'coverageFlip').length === 1, `2-6: espnSport ${JSON.stringify(sport)} fires (a football sport)`);
    }
  }
  // The second half, per the resolver's sport: period edges.
  {
    const g = seed('lu_p2');
    run(g, [[0, 14, 7, 2], [1, 14, 14, 2]]); hold(g, 2, 12, 14, 14, 2);
    assert(lines('lu_p2', 'coverageFlip').length === 0, '2-7: a football turn held through period 2 (the first half\'s last period) posts nothing');
    const g2 = seed('lu_p3');
    run(g2, [[0, 14, 7, 3], [1, 14, 14, 3]]); hold(g2, 2, 6, 14, 14, 3);
    assert(lines('lu_p3', 'coverageFlip').length === 1, '2-8: …and the same turn in period 3 posts');
    const g3 = seed('lu_ot');
    run(g3, [[0, 21, 14, 5], [1, 21, 21, 5]]); hold(g3, 2, 6, 21, 21, 5);
    assert(lines('lu_ot', 'coverageFlip').length === 1, '2-9: OVERTIME counts as the second half — on a direction the crowd rule lets through (AWAY covering, 3 of 4 on Home)');
    const g4 = seed('lu_noper');
    run(g4, [[0, 14, 7], [1, 14, 14]]); hold(g4, 2, 12, 14, 14);
    assert(lines('lu_noper', 'coverageFlip').length === 0, '2-10: no period reported, no call (fail quiet)');
  }
  // The hold.
  {
    const g = seed('lu_hold');
    run(g, [[0, 14, 7, 3], [1, 14, 14, 3]]); hold(g, 2, 5, 14, 14, 3);
    assert(lines('lu_hold', 'coverageFlip').length === 0, '2-11: 4 minutes held is not enough');
    poll(g, 6, 14, 14, 3);
    assert(lines('lu_hold', 'coverageFlip').length === 1, '2-12: at 5 minutes held it posts');
    const g2 = seed('lu_cancel');
    run(g2, [[0, 14, 7, 3], [1, 14, 14, 3], [3, 21, 14, 3]]); hold(g2, 4, 9, 21, 14, 3);
    assert(lines('lu_cancel', 'coverageFlip').length === 0, '2-13: a swing back inside the window cancels it');
  }
  // Baseline and once-per-direction stay the bug half's, unchanged.
  {
    const g = seed('lu_base');
    hold(g, 0, 15, 14, 14, 3);
    assert(lines('lu_base', 'coverageFlip').length === 0, '2-14: a device\'s first look at a game is a baseline — never a call');
  }
}

console.log('\n[3] Definition A through the detector — the room must be on the wrong side of it…');
{
  const cases = [
    ['L=1, G=3 (the room is RIGHT)', { p1: 'Home', p2: 'Away', p3: 'Away', p4: 'Away' }, 'home-then-away', 0],
    ['L=2, G=2 (a split room)', { p1: 'Home', p2: 'Home', p3: 'Away', p4: 'Away' }, 'home-then-away', 0],
    ['L=2, G=1 (fires)', { p1: 'Home', p2: 'Home', p3: 'Away' }, 'home-then-away', 1],
    ['L=3, G=1 (fires)', { p1: 'Home', p2: 'Home', p3: 'Home', p4: 'Away' }, 'home-then-away', 1],
    ['nPicks = 2 (below three, even with L=2, G=0)', { p1: 'Home', p2: 'Home' }, 'home-then-away', 0],
    ['nobody picked it', {}, 'home-then-away', 0],
  ];
  let i = 0;
  for (const [label, picks, , want] of cases) {
    const id = `lu_crowd_${i++}`;
    const g = seed(id, { picks });
    TURN_AWAY(g);
    assert(lines(id, 'coverageFlip').length === want, `3-1: ${label} -> ${want} post(s) (got ${lines(id, 'coverageFlip').length})`);
  }
  // The crowd counts ACTIVE roster players' picks; a deactivated player's does not count.
  const g = seed('lu_inactive', { picks: { p1: 'Home', p2: 'Home', p3: 'Home', p4: 'Away' } });
  storage.savePlayer({ playerId: 'p1', displayName: 'Brayden', active: false, almaMater: '', preferences: {} });
  storage.savePlayer({ playerId: 'p2', displayName: 'Kevin', active: false, almaMater: '', preferences: {} });
  TURN_AWAY(g);
  assert(lines('lu_inactive', 'coverageFlip').length === 0, '3-2: two of the three Home pickers are deactivated — L drops to 1 and the call is silent (the room is the ACTIVE roster)');
  // The other direction: a turn back toward HOME is silent in this room (L=1, G=3).
  const g2 = seed('lu_backhome');
  run(g2, [[0, 14, 14, 3], [1, 21, 14, 3]]); hold(g2, 2, 8, 21, 14, 3);
  assert(lines('lu_backhome', 'coverageFlip').length === 0, '3-3: a turn toward HOME covering is silent in a 3-to-1 Home room — nobody is on the wrong side');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Routing — the server path first, the unnamed line only when it is unavailable…');
{
  // Ready and clears (Balanced, 55 >= 45): ONE autonomous call, NO tier-0 line.
  const g = seed('lu_rt_ready', { mode: 'ready' });
  TURN_AWAY(g);
  assert(g.calls.length === 1 && lines('lu_rt_ready', 'coverageFlip').length === 0,
    `4-1: autonomy ready + the dial clears -> exactly ONE server call and NO tier-0 line (calls ${g.calls.length}, lines ${lines('lu_rt_ready', 'coverageFlip').length})`);
  const c = g.calls[0];
  assert(c.trigger === 'liveUpset' && c.subject === 'lu_rt_ready_crowd_away' && c.evidence.reason === 'crowd' && c.evidence.gameTag === 'lu_rt_ready' && c.evidence.weekId === 'lw1',
    `4-2: …trigger liveUpset, subject <game>_crowd_<side>, reason "crowd" (the ONLY selector), the game tag and week (got ${JSON.stringify({ t: c.trigger, s: c.subject, r: c.evidence.reason })})`);
  assert(Array.isArray(c.evidence.points) && c.evidence.points.length === 1 && c.evidence.points[0].signal === 'liveUpset',
    '4-3: …scored as `[trigger]` only — one signal, `liveUpset`, however many others were in the bucket');
  const wire = JSON.stringify(c);
  assert(!/Brayden|Kevin|Koby|Jacob|p1|p2|p3|p4/.test(wire.replace(/lu_rt_ready/g, '')), '4-4: NO player name or id is in the payload — the server derives the roll call');
  assert(!/Home|Away/.test(JSON.stringify({ subject: c.subject, evidence: { ...c.evidence, gameTag: '' } })), '4-5: …and no team name either (only the game id, the reason and the side)');

  // Not ready: ONE unnamed line, no server call.
  const g2 = seed('lu_rt_notready', { mode: 'notready' });
  TURN_AWAY(g2);
  assert(g2.calls.length === 0 && lines('lu_rt_notready', 'coverageFlip').length === 1, '4-6: autonomy NOT ready -> the unnamed tier-0 line stands in, and the server is not called');
  assert(!/Brayden|Kevin|Koby|Jacob/.test(lines('lu_rt_notready', 'coverageFlip')[0].body), '4-7: …and the line names nobody (a canned line has no hard-line check, so it may not name anyone)');
  assert(lines('lu_rt_notready', 'coverageFlip')[0].meta.source === 'tier0', '4-8: …stamped tier0');

  // Reserved / Quiet: the dial says quiet. Nothing at all.
  for (const level of ['reserved', 'quiet']) {
    const gq = seed(`lu_rt_${level}`, { mode: 'ready', frequency: level });
    TURN_AWAY(gq);
    assert(gq.calls.length === 0 && scribeRows(gq.gameId).length === 0,
      `4-9: on ${level.toUpperCase()} the call-out is silent — no server call AND no canned fallback (the dial said quiet)`);
  }
  for (const level of ['active', 'unhinged']) {
    const gl = seed(`lu_rt_${level}`, { mode: 'ready', frequency: level });
    TURN_AWAY(gl);
    assert(gl.calls.length === 1, `4-10: on ${level.toUpperCase()} it clears and goes to the server`);
  }
  // THE COMMISSIONER'S OFF SWITCH (`settings.scribeAutonomousEnabled === false`): the named path is not
  // ready, so the call-out is the UNNAMED line only — never a server call, never a name.
  {
    const go = seed('lu_rt_off', { mode: 'ready' });
    storage.saveSetting('scribeAutonomousEnabled', false);
    TURN_AWAY(go);
    assert(go.calls.length === 0 && lines('lu_rt_off', 'coverageFlip').length === 1,
      `4-10b: with the commissioner's autonomy switch OFF the named path is unavailable -> exactly the unnamed tier-0 line, and the server is never called (calls ${go.calls.length}, lines ${lines('lu_rt_off', 'coverageFlip').length})`);
    const go2 = seed('lu_rt_off_alma', { home: 'USC', away: 'Rival', players: [['p1', 'Brayden', 'USC'], ['p2', 'Kevin', '']], lockedAlma: ['USC'], picks: {}, mode: 'ready' });
    storage.saveSetting('scribeAutonomousEnabled', false);
    const shippedTrailing410 = SCRIBE_POOLS.almaTrailing;
    SCRIBE_POOLS.almaTrailing = ['TEST-ONLY alma trailing line.'];
    run(go2, [[0, 14, 10, 3], [1, 14, 17, 3]]); hold(go2, 2, 6, 14, 17, 3);
    SCRIBE_POOLS.almaTrailing = shippedTrailing410;
    assert(go2.calls.length === 0 && scribeRows('lu_rt_off_alma').filter(m => m.meta?.trigger === 'almaTrailing').length === 1,
      '4-10c: …and the alma call-out likewise falls back to the unnamed line (its own pool), with no server call');
  }
  // A cooldown: nothing.
  {
    const gc = seed('lu_rt_cool', { mode: 'ready' });
    const lp = { 'lu_rt_cool': clock + 1000 };   // a post in this room "just now"
    localStorage.setItem('cfbp_scribe_lastpost', JSON.stringify(lp));
    TURN_AWAY(gc);
    assert(gc.calls.length === 0 && scribeRows('lu_rt_cool').length === 0, '4-11: inside the room cooldown -> nothing (no call, no canned line)');
  }
  // The consecutive guard: an autonomous SCRIBE post with no human since -> nothing.
  {
    const gcg = seed('lu_rt_consec', { mode: 'ready' });
    chat.ingest([{ id: 'auto_prior', seq: 960001, type: 'message', author: 'scribe', gameTag: 'lu_rt_consec', body: 'earlier', ts: clock, meta: { autonomous: true } }], 960001, { caughtUp: true });
    TURN_AWAY(gcg);
    assert(gcg.calls.length === 0, '4-12: an autonomous post with no human since blocks another (never two in a row) -> nothing');
  }
  // A server that DECLINES stays silent (C1), and the latch turns the NEXT call into the fallback.
  {
    const gd = seed('lu_rt_decline', { mode: 'ready', autonomousResult: { ok: true, skipped: 'no_work', what: 'unverified' } });
    TURN_AWAY(gd);
    await tick();
    assert(gd.calls.length === 1 && scribeRows('lu_rt_decline').length === 0,
      '4-13: a server that DECLINES (unverified) leaves the room silent — no canned line follows a declined attempt (C1)');
    const gl = seed('lu_rt_latch', { mode: 'ready', autonomousResult: { ok: true, skipped: 'disabled_autonomous' } });
    TURN_AWAY(gl);
    await tick();
    assert(gl.calls.length === 1 && scribeRows('lu_rt_latch').length === 0, '4-14: a server that says autonomy is DISABLED posts nothing for that attempt…');
    const gl2 = { ...seed('lu_rt_latch2', { mode: 'ready', autonomousResult: { ok: true, posted: true } }) };
    // seed() reset the module state, so re-arm the latch the way a real "disabled" answer does.
    scribeAgent.wireScribeRemoteTransport({ autonomous: async () => ({ ok: true, skipped: 'disabled_autonomous' }) });
    scribeLines.considerAutonomous('liveUpset', { subject: 'primer', gameTag: 'lu_primer', signals: [{ signal: 'liveUpset' }], reason: 'crowd' });
    await tick();
    TURN_AWAY(gl2);
    assert(lines('lu_rt_latch2', 'coverageFlip').length === 1,
      '4-15: …and once latched (`server_off_latch`) the NEXT settled call falls back to the unnamed line');
  }
}

console.log('\n[5] Once per (game, direction) — the tier-0 prefixes suppress on the client; the autonomous prefix does NOT…');
{
  const g = seed('lu_pre_flip');
  plant('lu_pre_flip', 'scribe_coverageFlip_lu_pre_flip_away_0');
  TURN_AWAY(g);
  assert(lines('lu_pre_flip', 'coverageFlip').length === 0 && scribeRows('lu_pre_flip').length === 1, '5-1: a planted `scribe_coverageFlip_<game>_<side>_` row suppresses the crowd call-out');
  const g2 = seed('lu_pre_other');
  plant('lu_pre_other', 'scribe_coverageFlip_lu_pre_other_home_0');
  TURN_AWAY(g2);
  assert(lines('lu_pre_other', 'coverageFlip').length === 1, '5-2: …the OTHER direction\'s row does not');
  const g3 = seed('lu_pre_auto', { mode: 'ready' });
  plant('lu_pre_auto', 'scribe_auto_liveUpset_lu_pre_auto_crowd_away_9');
  TURN_AWAY(g3);
  assert(g3.calls.length === 1,
    '5-3: a planted `scribe_auto_liveUpset_…` row does NOT suppress on the client — a client cannot read `emitted_by`, so a member-minted row would otherwise silence the call-out for everyone; the SERVER checks it');
  const g4 = seed('lu_pre_auto2');
  plant('lu_pre_auto2', 'scribe_auto_liveUpset_lu_pre_auto2_crowd_away_9');
  TURN_AWAY(g4);
  assert(lines('lu_pre_auto2', 'coverageFlip').length === 1, '5-4: …in the not-ready fallback too');
  const g5 = seed('lu_pre_alma_x', { lockedAlma: null });
  plant('lu_pre_alma_x', 'scribe_almaTrailing_lu_pre_alma_x_away_0');
  TURN_AWAY(g5);
  assert(lines('lu_pre_alma_x', 'coverageFlip').length === 1, '5-5: an ALMA prefix does not suppress the CROWD call-out — different reasons');
  // The fallback id is `<game>_<side>` and bucketMin 1e9 gives a constant `_0`.
  const g6 = seed('lu_pre_id');
  TURN_AWAY(g6);
  const id1 = lines('lu_pre_id', 'coverageFlip')[0].id;
  assert(id1 === 'scribe_coverageFlip_lu_pre_id_away_0', `5-6: the crowd fallback id is scribe_coverageFlip_<game>_<side>_0 (got ${id1})`);
  // Two devices at different times get the SAME id (no time bucket in it).
  clock += 9 * 3600 * 1000;
  chat._resetForTest(); chatUi._resetCoverageFlipStateForTest();
  const g7 = { ...g6, start: clock };
  scribeLines._resetAutonomousStateForTest(); localStorage.removeItem('cfbp_scribe_lastpost'); localStorage.removeItem('cfbp_scribe_ledger');
  TURN_AWAY(g7);
  assert(lines('lu_pre_id', 'coverageFlip').length === 1 && lines('lu_pre_id', 'coverageFlip')[0].id === id1, '5-7: …and it is the SAME id hours later — one id per game per direction, so the server\'s on-conflict(id) collapses two phones');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The upset watch — the second half AND a real upset…');
{
  const teamLine = ['{TEAM} clearly didn\'t see the spread.'];
  const savedPool = SCRIBE_POOLS.upsetWatch.slice();
  // The dog (Away) leads 7-17 (by 10) from the second half; Home is the favourite; 3 of 4 picked Home.
  const dogScript = (g, period = 3) => { hold(g, 0, 5, 7, 17, period); };
  {
    const g = seed('lu_uw_ok');
    dogScript(g);
    assert(lines('lu_uw_ok', 'upsetWatch').length === 1, '6-1: an underdog up by 10 for 5 minutes in the second half, against a room that took the favorite (L=3, G=1), posts once');
    const id = lines('lu_uw_ok', 'upsetWatch')[0].id;
    assert(id === 'scribe_upsetWatch_lu_uw_ok_0', `6-2: …under the id scribe_upsetWatch_<game>_0 (bucketMin 1e9) (got ${id})`);
    hold(g, 6, 40, 7, 17, 4);
    assert(lines('lu_uw_ok', 'upsetWatch').length === 1, '6-3: …once per game — a second post is silent however long the lead lasts');
    assert(lines('lu_uw_ok', 'coverageFlip').length === 0, '6-4: (and no coverage-flip line — the first look was a baseline)');
  }
  {
    const g = seed('lu_uw_h1');
    dogScript(g, 2);
    hold(g, 6, 30, 7, 17, 2);
    assert(lines('lu_uw_h1', 'upsetWatch').length === 0, '6-5: the FIRST half never posts, however long the lead');
    const g2 = seed('lu_uw_short');
    hold(g2, 0, 4, 7, 17, 3);
    assert(lines('lu_uw_short', 'upsetWatch').length === 0, '6-6: 4 minutes is not 5');
    hold(g2, 5, 5, 7, 12, 3);
    hold(g2, 6, 12, 7, 12, 3);
    assert(lines('lu_uw_short', 'upsetWatch').length === 0, '6-7: …and a lead that shrinks below 9 resets the hold');
    const g3 = seed('lu_uw_eight');
    hold(g3, 0, 20, 7, 15, 3);
    assert(lines('lu_uw_eight', 'upsetWatch').length === 0, '6-8: an underdog up by 8 is not "9+"');
  }
  {
    const cases = [
      ['favorite pickers L=1', { p1: 'Home', p2: 'Away', p3: 'Away', p4: 'Away' }],
      ['L=2, G=2 (split)', { p1: 'Home', p2: 'Home', p3: 'Away', p4: 'Away' }],
      ['nPicks < 3', { p1: 'Home', p2: 'Home' }],
    ];
    let i = 0;
    for (const [label, picks] of cases) {
      const id = `lu_uw_crowd_${i++}`;
      const g = seed(id, { picks });
      dogScript(g);
      assert(lines(id, 'upsetWatch').length === 0, `6-9: ${label} -> silent — a real upset needs the room on the wrong side`);
    }
    const g = seed('lu_uw_21', { picks: { p1: 'Home', p2: 'Home', p3: 'Away' } });
    dogScript(g);
    assert(lines('lu_uw_21', 'upsetWatch').length === 1, '6-10: control — L=2, G=1 fires');
  }
  {
    const gpk = seed('lu_uw_pk', { spread: 0, favorite: null });
    dogScript(gpk);
    assert(lines('lu_uw_pk', 'upsetWatch').length === 0, '6-11: a PK game (no favorite) is silent');
    const gnull = seed('lu_uw_nofav', { spread: null, favorite: null });
    dogScript(gnull);
    assert(lines('lu_uw_nofav', 'upsetWatch').length === 0, '6-12: no line, no favorite -> silent');
    const gunk = seed('lu_uw_curl', { espnSport: 'curling' });
    dogScript(gunk);
    assert(lines('lu_uw_curl', 'upsetWatch').length === 0, '6-13: an unknown sport is silent');
    const gbad = seed('lu_uw_badfav', { favorite: 'Nobody' });
    dogScript(gbad);
    assert(lines('lu_uw_badfav', 'upsetWatch').length === 0, '6-14: a favorite that is neither team is silent');
    const gblind = seed('lu_uw_blind', { weekStatus: WEEK_STATUS.LOCKED });
    dogScript(gblind);
    assert(scribeRows('lu_uw_blind').length === 0, '6-15: a LOCKED week is silent (the blind rule)');
    const gnfl = seed('lu_uw_nfl', { espnSport: 'nfl' });
    dogScript(gnfl);
    assert(lines('lu_uw_nfl', 'upsetWatch').length === 1, '6-16: nfl fires (football-scaled: cfb and nfl only)');
  }
  // `{TEAM}`: substituted, with a FUNCTION replacer.
  {
    SCRIBE_POOLS.upsetWatch = teamLine;
    const g = seed('lu_uw_team', { home: 'Home', away: 'Fighting Owls' });
    dogScript(g);
    const b = lines('lu_uw_team', 'upsetWatch')[0]?.body || '';
    assert(b === "Fighting Owls clearly didn't see the spread.", `6-17: {TEAM} is substituted with the underdog's name (got ${JSON.stringify(b)})`);
    const g2 = seed('lu_uw_dollar', { home: 'Home', away: 'Ba$&d $1 $$' });
    dogScript(g2);
    const b2 = lines('lu_uw_dollar', 'upsetWatch')[0]?.body || '';
    assert(b2 === "Ba$&d $1 $$ clearly didn't see the spread.", `6-18: a team named with regexp-replacement patterns ($&, $1, $$) renders LITERALLY (got ${JSON.stringify(b2)})`);
    SCRIBE_POOLS.upsetWatch = savedPool;
  }
  // The shipped pool still reads clean.
  {
    assert(SCRIBE_POOLS.upsetWatch.length === savedPool.length && SCRIBE_POOLS.upsetWatch.some(l => l.includes('{TEAM}')),
      '6-19: fixture — the shipped upsetWatch pool is restored and still carries its {TEAM} line');
    const braceOK = l => !/\{(?!TEAM\}|NAME\}|N\})/.test(l);
    assert(['coverageFlip', 'upsetWatch'].every(k => SCRIBE_POOLS[k].every(braceOK)),
      '6-20: no shipped line in the two pools this detector posts from carries a placeholder pickLine() does not substitute ({NAME}, {N}, {TEAM})');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] An alma mater going behind — losing straight-up OR not covering, one situation one post…');
{
  const ALMA_ROSTER = [['p1', 'Brayden', 'USC'], ['p2', 'Kevin', ''], ['p3', 'Koby', 'USC'], ['p4', 'Jacob', '']];
  const almaSeed = (id, o = {}) => seed(id, { home: 'USC', away: 'Rival', players: ALMA_ROSTER, lockedAlma: ['USC'], picks: {}, ...o });
  // Test-only pools: the lines below exist ONLY in this process and prove the ROUTING — which pool,
  // which id — not the voice (the shipped copy is asserted in [8]). The shipped pools are captured
  // first and put back at the end of this section, so [8] reads the real ones.
  const SHIPPED_ALMA = { t: SCRIBE_POOLS.almaTrailing, n: SCRIBE_POOLS.almaNotCovering };
  SCRIBE_POOLS.almaTrailing = ['TEST-ONLY alma trailing line.'];
  SCRIBE_POOLS.almaNotCovering = ['TEST-ONLY alma not covering line.'];
  const almaLines = (id) => scribeRows(id).filter(m => m.meta?.trigger === 'almaTrailing' || m.meta?.trigger === 'almaNotCovering');

  // ── SU-only: a +10 underdog, tied, then behind 14-17 — losing outright, still covering.
  const suTurn = (g) => { run(g, [[0, 14, 14, 3], [1, 14, 17, 3]]); hold(g, 2, 6, 14, 17, 3); };
  {
    const g = almaSeed('lu_al_su', { spread: 10, favorite: 'Rival', mode: 'ready' });
    suTurn(g);
    assert(g.calls.length === 1 && g.calls[0].trigger === 'liveUpset' && g.calls[0].evidence.reason === 'alma' && g.calls[0].subject === 'lu_al_su_alma_home',
      `7-1: SU-ONLY (tied -> behind; the +10 still covers) sends ONE server call, reason "alma", subject <game>_alma_<side> (got ${g.calls.length}: ${JSON.stringify(g.calls[0] && { r: g.calls[0].evidence.reason, s: g.calls[0].subject })})`);
    assert(almaLines('lu_al_su').length === 0, '7-2: …and no canned line beside it');
    assert(!/usc|Brayden|Koby/i.test(JSON.stringify({ ...g.calls[0], evidence: { ...g.calls[0].evidence, gameTag: '' } }).replace('lu_al_su_alma_home', '')),
      '7-3: …the payload names no school and no player (the server derives both from the GAME ROW and its roster)');
    const gf = almaSeed('lu_al_su_fb', { spread: 10, favorite: 'Rival' });
    suTurn(gf);
    assert(almaLines('lu_al_su_fb').length === 1 && almaLines('lu_al_su_fb')[0].meta.trigger === 'almaTrailing'
      && almaLines('lu_al_su_fb')[0].id === 'scribe_almaTrailing_lu_al_su_fb_home_0',
      `7-4: not-ready fallback for SU-only is the "almaTrailing" pool, id scribe_almaTrailing_<game>_<side>_0 (got ${almaLines('lu_al_su_fb').map(m => m.id)})`);
  }
  // ── ATS-only: a 7-point favorite leading 21-17 — winning, not covering.
  const atsTurn = (g) => { run(g, [[0, 21, 10, 3], [1, 21, 17, 3]]); hold(g, 2, 6, 21, 17, 3); };
  {
    const g = almaSeed('lu_al_ats', { spread: -7, favorite: 'USC', mode: 'ready' });
    atsTurn(g);
    assert(g.calls.length === 1 && g.calls[0].evidence.reason === 'alma' && g.calls[0].subject === 'lu_al_ats_alma_home',
      `7-5: ATS-ONLY (leading 21-17 as a 7-point favorite) sends ONE server call (got ${g.calls.length})`);
    const gf = almaSeed('lu_al_ats_fb', { spread: -7, favorite: 'USC' });
    atsTurn(gf);
    assert(almaLines('lu_al_ats_fb').length === 1 && almaLines('lu_al_ats_fb')[0].meta.trigger === 'almaNotCovering'
      && almaLines('lu_al_ats_fb')[0].id === 'scribe_almaNotCovering_lu_al_ats_fb_home_0',
      `7-6: …and the not-ready fallback states the ONE condition that applies — the "almaNotCovering" pool (got ${almaLines('lu_al_ats_fb').map(m => m.id)})`);
  }
  // ── BOTH: a 3-point favorite trailing 14-17.
  const bothTurn = (g) => { run(g, [[0, 14, 10, 3], [1, 14, 17, 3]]); hold(g, 2, 6, 14, 17, 3); };
  {
    const g = almaSeed('lu_al_both', { spread: -3, favorite: 'USC', mode: 'ready' });
    bothTurn(g);
    assert(g.calls.length === 1, `7-7: BOTH conditions at once are ONE situation, ONE call — never two (got ${g.calls.length})`);
    const gf = almaSeed('lu_al_both_fb', { spread: -3, favorite: 'USC' });
    bothTurn(gf);
    assert(almaLines('lu_al_both_fb').length === 1 && almaLines('lu_al_both_fb')[0].meta.trigger === 'almaTrailing',
      '7-8: …and the fallback line is "losing outright" (true in both) — one line, from the almaTrailing pool');
    // ATS-only first, then SU joins, hold continuous: ONE call, however the condition changes underneath.
    const gd = almaSeed('lu_al_dedupe', { spread: -3, favorite: 'USC', mode: 'ready' });
    run(gd, [[0, 17, 10, 3], [1, 14, 14, 3], [3, 14, 17, 3]]); hold(gd, 4, 9, 14, 17, 3);
    assert(gd.calls.length === 1, `7-9: not covering at minute 1, losing outright too by minute 3, held continuously — ONE call at the 5-minute mark (got ${gd.calls.length})`);
    hold(gd, 10, 30, 14, 20, 4); hold(gd, 31, 35, 14, 14, 4); hold(gd, 36, 60, 14, 21, 4);
    assert(gd.calls.length === 1, '7-10: …and however the state moves afterwards (worse, tied, worse again) it never sends a second one for this game');
  }
  // ── The turn rules.
  {
    const g = almaSeed('lu_al_allgame', { spread: -3, favorite: 'USC', mode: 'ready' });
    hold(g, 0, 30, 14, 17, 3);
    assert(g.calls.length === 0, '7-11: a team that was behind at the first look (all game) never "turns" — silent');
    const g2 = almaSeed('lu_al_h1', { spread: -3, favorite: 'USC', mode: 'ready' });
    run(g2, [[0, 14, 10, 1], [1, 14, 17, 2]]); hold(g2, 2, 30, 14, 17, 2);
    hold(g2, 31, 60, 14, 17, 3);
    assert(g2.calls.length === 0, '7-12: a turn of BOTH conditions that happened entirely in the FIRST half is only tracked — silent in the second, however long it lasts');
    // ── TWO PARALLEL MACHINES (reviewer BLOCK on DI-439 item 4). 7-12 above is silent because BOTH
    //    conditions turned in the first half; a condition that turns in the SECOND half is news even when
    //    the other was already true. The combined "behind" flag this replaced read all three of these as silence.
    const g2b = almaSeed('lu_al_lead2loss', { spread: -7, favorite: 'USC', mode: 'ready' });
    poll(g2b, 0, 21, 17, 2);                                     // half: leading, NOT covering (21 - 7 - 17 < 0)
    const base = chatUi._almaBehindStateForTest('lu_al_lead2loss', 'home');
    assert(base && base.su.settled === false && base.ats.settled === true,
      '7-12a: the two conditions are tracked SEPARATELY — leading (straight-up fine) but not covering (ATS behind) is su=false, ats=true, not one "behind" flag');
    hold(g2b, 1, 30, 21, 17, 2);
    assert(g2b.calls.length === 0, '7-12b: nothing at half — the team was already not covering at the first look');
    hold(g2b, 31, 36, 21, 24, 3);                                // Q3: loses the lead; held 5 minutes
    assert(g2b.calls.length === 1 && g2b.calls[0].evidence.reason === 'alma' && g2b.calls[0].subject === 'lu_al_lead2loss_alma_home',
      `7-12c: LEADING-BUT-NOT-COVERING AT HALF, THEN LOSING OUTRIGHT IN Q3 is ONE call (straight-up turned; ATS never did) (got ${g2b.calls.length})`);
    const g2bf = almaSeed('lu_al_lead2loss_fb', { spread: -7, favorite: 'USC' });
    poll(g2bf, 0, 21, 17, 2); hold(g2bf, 1, 30, 21, 17, 2); hold(g2bf, 31, 36, 21, 24, 3);
    assert(almaLines('lu_al_lead2loss_fb').length === 1 && almaLines('lu_al_lead2loss_fb')[0].meta.trigger === 'almaTrailing',
      '7-12d: …and its unnamed fallback is almaTrailing — the team is losing straight-up NOW (the pool follows the current state)');
    // The underdog mirror: trailing since half but covering; in Q3 it stops covering.
    const g2c = almaSeed('lu_al_dogmirror', { spread: 10, favorite: 'Rival', mode: 'ready' });
    poll(g2c, 0, 10, 17, 2);                                     // half: trailing, still covering (10 + 10 - 17 > 0)
    hold(g2c, 1, 30, 10, 17, 2);
    assert(g2c.calls.length === 0, '7-12e: nothing at half — the team was already losing outright at the first look');
    hold(g2c, 31, 36, 10, 24, 3);                                // Q3: 10 + 10 - 24 < 0 — no longer covering
    assert(g2c.calls.length === 1 && g2c.calls[0].evidence.reason === 'alma',
      `7-12f: the UNDERDOG MIRROR — trailing since half, covering until Q3 — is ONE call on the ATS turn (got ${g2c.calls.length})`);
    // Reviewer BLOCK N1 (2026-09-30), the EXACT failing sequence: the turn is ATS, but at 10-24 the team is
    // ALSO losing outright, so almaNotCovering ("Not losing, not covering…", "The scoreboard has no
    // complaints…") would be false. The pool follows the CURRENT state: almaTrailing.
    const g2cf = almaSeed('lu_al_dogmirror_fb', { spread: 10, favorite: 'Rival' });
    poll(g2cf, 0, 10, 17, 2); hold(g2cf, 1, 30, 10, 17, 2); hold(g2cf, 31, 36, 10, 24, 3);
    assert(almaLines('lu_al_dogmirror_fb').length === 1 && almaLines('lu_al_dogmirror_fb')[0].meta.trigger === 'almaTrailing'
      && almaLines('lu_al_dogmirror_fb')[0].id === 'scribe_almaTrailing_lu_al_dogmirror_fb_home_0',
      `7-12g: …and its fallback is almaTrailing, NOT almaNotCovering — the turn was ATS, but at 10-24 the team is losing outright too, and the pool follows the CURRENT state (reviewer N1) (got ${almaLines('lu_al_dogmirror_fb').map(m => m.id)})`);
    // Staggered turns inside one situation: straight-up settles first, ATS three minutes later. ONE post.
    const g2d = almaSeed('lu_al_stagger', { spread: 10, favorite: 'Rival', mode: 'ready' });
    run(g2d, [[0, 14, 10, 3], [1, 14, 17, 3], [4, 14, 25, 3]]); hold(g2d, 5, 14, 14, 25, 3);
    assert(g2d.calls.length === 1,
      `7-12h: straight-up turns first (settles at minute 6), ATS turns three minutes behind it (settles at 9) — ONE situation, ONE call (got ${g2d.calls.length})`);
    const g2df = almaSeed('lu_al_stagger_fb', { spread: 10, favorite: 'Rival' });
    run(g2df, [[0, 14, 10, 3], [1, 14, 17, 3], [4, 14, 25, 3]]); hold(g2df, 5, 14, 14, 25, 3);
    assert(almaLines('lu_al_stagger_fb').length === 1 && almaLines('lu_al_stagger_fb')[0].meta.trigger === 'almaTrailing',
      '7-12i: …in the fallback too: one line (almaTrailing — losing outright when the first turn settles); the second turn finds the first one\'s post in the fold');
    const g3 = almaSeed('lu_al_short', { spread: -3, favorite: 'USC', mode: 'ready' });
    run(g3, [[0, 14, 10, 3], [1, 14, 17, 3]]); hold(g3, 2, 5, 14, 17, 3);
    assert(g3.calls.length === 0, '7-13: 4 minutes behind is not 5');
    poll(g3, 6, 14, 17, 3);
    assert(g3.calls.length === 1, '7-14: 5 minutes held fires');
    const g4 = almaSeed('lu_al_flick', { spread: -3, favorite: 'USC', mode: 'ready' });
    run(g4, [[0, 14, 10, 3], [1, 14, 17, 3], [3, 21, 17, 3]]); hold(g4, 4, 10, 21, 17, 3);
    assert(g4.calls.length === 0, '7-15: back to winning-and-covering inside the window cancels it');
    const g5 = almaSeed('lu_al_np', { spread: -3, favorite: 'USC', mode: 'ready' });
    run(g5, [[0, 14, 10], [1, 14, 17]]); hold(g5, 2, 12, 14, 17);
    assert(g5.calls.length === 0, '7-16: no period reported -> silent');
  }
  // ── Recovery is not news, and a fresh turn after it is a turn.
  {
    const g = almaSeed('lu_al_recover', { spread: -3, favorite: 'USC', mode: 'notready' });
    bothTurn(g);
    assert(almaLines('lu_al_recover').length === 1, '7-17: fixture — the first turn posts');
    hold(g, 7, 20, 24, 10, 3);            // recovered: winning and covering, held
    hold(g, 21, 30, 14, 17, 3);           // and behind again, held
    assert(almaLines('lu_al_recover').length === 1, '7-18: behind, recovered, behind again — the same side already has a post in the shared fold, so it is silent (once per game and direction)');
  }
  // ── The locked list, the claimants, the game row.
  {
    const cases = [
      ['a school NOT in weeks.lockedAlmaMaters', { lockedAlma: ['Notre Dame'] }],
      ['a week with no locked list (null)', { lockedAlma: null }],
      ['an empty locked list', { lockedAlma: [] }],
      ['a locked school with no active claimant', { players: ROSTER }],
    ];
    let i = 0;
    for (const [label, o] of cases) {
      const g = almaSeed(`lu_al_gate_${i++}`, { spread: -3, favorite: 'USC', mode: 'ready', ...o });
      bothTurn(g);
      assert(g.calls.length === 0, `7-19: ${label} -> silent`);
    }
    // A school typed mid-game: p2 types 'USC' but the week locked only 'Notre Dame'.
    const gm = almaSeed('lu_al_typed', { spread: -3, favorite: 'USC', mode: 'ready', lockedAlma: ['Notre Dame'], players: [['p1', 'Brayden', 'Notre Dame'], ['p2', 'Kevin', 'USC']] });
    bothTurn(gm);
    assert(gm.calls.length === 0, '7-20: a player who typed "USC" after lock (the week locked Notre Dame) does not make USC a claimed school');
    // The claimant's typing does not reach the wire.
    const gc = almaSeed('lu_al_cased', { spread: -3, favorite: 'USC', mode: 'ready', players: [['p1', 'Brayden', '  usc '], ['p3', 'Koby', 'USC']] });
    bothTurn(gc);
    assert(gc.calls.length === 1 && !/ usc /.test(JSON.stringify(gc.calls[0])),
      '7-21: a claimant\'s free-text alma_mater ("  usc ") matches after trim + case-fold, and is never echoed into the payload');
    // Two claimants, one event.
    const g2 = almaSeed('lu_al_two', { spread: -3, favorite: 'USC', mode: 'ready' });
    bothTurn(g2);
    assert(g2.calls.length === 1, '7-22: two players claim USC — ONE event, ONE call');
    // No pick count: nobody picked this game.
    assert(scribeLines.SIGNAL_POINTS.liveUpset === 55 && g2.calls.length === 1, '7-23: …with NO picks at all on the game (an alma call-out is about a school, not a crowd)');
  }
  // ── The away team as the alma team.
  {
    const g = almaSeed('lu_al_away', { home: 'Rival', away: 'USC', spread: 3, favorite: 'USC', mode: 'ready' });
    run(g, [[0, 10, 14, 3], [1, 17, 14, 3]]); hold(g, 2, 6, 17, 14, 3);
    assert(g.calls.length === 1 && g.calls[0].subject === 'lu_al_away_alma_away', `7-24: an AWAY alma team is tracked from its own side: subject <game>_alma_away (got ${g.calls[0] && g.calls[0].subject})`);
  }
  // ── The blind gate and the sport.
  {
    for (const status of [WEEK_STATUS.OPEN, WEEK_STATUS.LOCKED]) {
      const g = almaSeed(`lu_al_blind_${status}`, { spread: -3, favorite: 'USC', mode: 'ready', weekStatus: status });
      bothTurn(g);
      assert(g.calls.length === 0, `7-25: a ${status.toUpperCase()}-week game is silent for the alma call-out too`);
    }
    const gs = almaSeed('lu_al_curl', { spread: -3, favorite: 'USC', mode: 'ready', espnSport: 'curling' });
    bothTurn(gs);
    assert(gs.calls.length === 0, '7-26: an unknown sport is silent');
  }
  // ── Tier-0 prefixes and the autonomous one.
  {
    for (const id of ['scribe_almaTrailing_lu_al_pf1_home_0', 'scribe_almaNotCovering_lu_al_pf1_home_0']) {
      const g = almaSeed('lu_al_pf1', { spread: -3, favorite: 'USC', mode: 'ready' });
      plant('lu_al_pf1', id);
      bothTurn(g);
      assert(g.calls.length === 0, `7-27: a planted ${id.split('_lu_')[0]} row suppresses the alma call-out (either pool counts — one situation, one post)`);
    }
    const ga = almaSeed('lu_al_pf2', { spread: -3, favorite: 'USC', mode: 'ready' });
    plant('lu_al_pf2', 'scribe_auto_liveUpset_lu_al_pf2_alma_home_5');
    bothTurn(ga);
    assert(ga.calls.length === 1, '7-28: a planted autonomous-prefix row does NOT suppress on the client (the server\'s `emitted_by IS NULL` check owns that prefix)');
    const gx = almaSeed('lu_al_pf3', { spread: -3, favorite: 'USC', mode: 'ready' });
    plant('lu_al_pf3', 'scribe_coverageFlip_lu_al_pf3_home_0');
    bothTurn(gx);
    assert(gx.calls.length === 1, '7-29: the CROWD prefix does not suppress the ALMA call-out');
  }
  // ── The dial and the cooldown apply as they do to the crowd call-out.
  {
    for (const level of ['reserved', 'quiet']) {
      const g = almaSeed(`lu_al_${level}`, { spread: -3, favorite: 'USC', mode: 'ready', frequency: level });
      bothTurn(g);
      assert(g.calls.length === 0 && almaLines(g.gameId).length === 0, `7-30: ${level.toUpperCase()} -> silent, and no canned line either`);
    }
  }
  // ── A missing pool is a SILENT fallback, never a crash and never a line.
  {
    const saved = { t: SCRIBE_POOLS.almaTrailing, n: SCRIBE_POOLS.almaNotCovering };
    delete SCRIBE_POOLS.almaTrailing; delete SCRIBE_POOLS.almaNotCovering;
    const g = almaSeed('lu_al_nopool', { spread: -3, favorite: 'USC' });
    bothTurn(g);
    assert(almaLines('lu_al_nopool').length === 0 && scribeRows('lu_al_nopool').length === 0,
      '7-31: with no alma pool present (a missing pool is a silent fallback) the not-ready fallback is silent — nothing posts and nothing throws');
    SCRIBE_POOLS.almaTrailing = saved.t; SCRIBE_POOLS.almaNotCovering = saved.n;
  }
  SCRIBE_POOLS.almaTrailing = SHIPPED_ALMA.t; SCRIBE_POOLS.almaNotCovering = SHIPPED_ALMA.n;
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7b] The alma fallback pool follows the team\'s CURRENT state — every (su, ats) combination, every shipped line true…');
{
  // Reviewer BLOCK N1 (2026-09-30): the pool was chosen from the condition that TURNED, so an ATS turn by a
  // team that was ALSO losing outright posted "Not losing, not covering…". SCRIBE never states anything
  // false (SCRIBE.md). This section runs against the SHIPPED pools ([7] restored them above).
  //
  // THE TRUTH ORACLE — what each shipped alma line CLAIMS about the team, read off its words. Every line
  // must be recognised: a new line this table cannot read fails 7b-1 until its claim is written down here.
  const CLAIMS = [
    { re: /\bnot losing\b|\bscoreboard has no complaints\b/i, su: false },
    { re: /\bis losing\b|\blosing this one\b|\bbehind\b|\bwrong end of the score\b/i, su: true },
    { re: /\bisn't covering\b|\bnot covering\b|\bspread has turned\b|\bthe spread does\b|\bfailing the number\b/i, ats: true },
    { re: /\b(?:is|still) covering\b|\bcovers\b/i, ats: false },
  ];
  /** `{su?, ats?}` the line asserts, or null if it asserts nothing this oracle reads (or contradicts itself). */
  const claimsOf = (line) => {
    const out = {};
    for (const c of CLAIMS) {
      if (!c.re.test(line)) continue;
      for (const k of ['su', 'ats']) {
        if (!(k in c)) continue;
        if (k in out && out[k] !== c[k]) return null;
        out[k] = c[k];
      }
    }
    return Object.keys(out).length ? out : null;
  };
  const lineTrue = (line, state) => { const c = claimsOf(line); return !!c && Object.keys(c).every(k => c[k] === state[k]); };
  const poolTrue = (pool, state) => Array.isArray(SCRIBE_POOLS[pool]) && SCRIBE_POOLS[pool].length > 0
    && SCRIBE_POOLS[pool].every(l => lineTrue(l, state));
  const ALMA_POOLS = ['almaTrailing', 'almaNotCovering'];
  const S = (su, ats) => ({ su, ats });
  const fmt = st => `su=${st.su} ats=${st.ats}`;

  const unread = ALMA_POOLS.flatMap(k => SCRIBE_POOLS[k].filter(l => !claimsOf(l)));
  assert(ALMA_POOLS.every(k => SCRIBE_POOLS[k].length === 5 && SCRIBE_POOLS[k].every(l => !l.startsWith('TEST-ONLY'))) && unread.length === 0,
    `7b-1: the oracle reads a claim off every one of the ten SHIPPED alma lines (unread: ${JSON.stringify(unread)})`);
  // The oracle can see the falsehood N1 was about — it is not a tautology.
  assert(!poolTrue('almaNotCovering', S(true, true)) && !lineTrue('Not losing, not covering. One of our schools should pick a lane.', S(true, true))
    && !lineTrue('The scoreboard has no complaints about one of our schools. The spread does.', S(true, true)),
    '7b-2: control — the oracle reads almaNotCovering as FALSE for a team losing outright AND not covering (the N1 state)');

  // ── THE PURE SWEEP: all four (su, ats) combinations.
  const EXPECT = [
    [S(true, true), 'almaTrailing'],
    [S(true, false), 'almaTrailing'],
    [S(false, true), 'almaNotCovering'],
    [S(false, false), null],
  ];
  for (const [st, want] of EXPECT) {
    const got = chatUi._almaFallbackPoolForTest(st);
    assert(got === want, `7b-3: ${fmt(st)} -> ${want === null ? 'no pool' : want} (got ${got})`);
    if (got) {
      const falseLines = SCRIBE_POOLS[got].filter(l => !lineTrue(l, st));
      assert(falseLines.length === 0, `7b-4: ${fmt(st)} — every line of ${got} is TRUE of the team (false: ${JSON.stringify(falseLines)})`);
    } else {
      assert(ALMA_POOLS.every(k => !poolTrue(k, st)),
        `7b-4: ${fmt(st)} — no alma pool is wholly true of a team that is neither losing nor failing the number, so no line is chosen`);
    }
    // And the choice is never a pool with a false line in it while a wholly true one exists.
    assert(!got || poolTrue(got, st), `7b-5: ${fmt(st)} — the chosen pool is wholly true`);
  }
  assert(chatUi._almaFallbackPoolForTest(null) === null && chatUi._almaFallbackPoolForTest(undefined) === null,
    '7b-6: no state is no pool');

  // ── THE END-TO-END SWEEP: the REAL detector, the not-ready fallback, every reachable turn. Each script is
  //    segments [fromMin, toMin, home, away, period], one poll a minute. The state is read at the poll that
  //    posted, off the same scores the detector saw.
  const sweepSeed = (id, o) => seed(id, {
    home: 'USC', away: 'Rival', lockedAlma: ['USC'], picks: {},
    players: [['p1', 'Brayden', 'USC'], ['p2', 'Kevin', ''], ['p3', 'Koby', 'USC'], ['p4', 'Jacob', '']], ...o,
  });
  const almaRows = (id) => scribeRows(id).filter(m => ALMA_POOLS.includes(m.meta?.trigger));
  const drive = (id, o, script) => {
    const g = sweepSeed(id, o);
    const side = o.away === 'USC' ? 'away' : 'home';
    let postedState = null;
    for (const [from, to, h, a, p] of script) {
      for (let m = from; m <= to; m++) {
        const before = almaRows(id).length;
        poll(g, m, h, a, p);
        if (almaRows(id).length > before && !postedState) {
          postedState = scoring.almaSideState({ homeScore: h, awayScore: a, spread: o.spread, side });
        }
      }
    }
    return { rows: almaRows(id), postedState };
  };
  // [label, id, seed options, script, the (su, ats) the team is in when it posts, or null for "never posts"]
  const FAV = { spread: -7, favorite: 'USC' }, DOG = { spread: 10, favorite: 'Rival' }, PK = { spread: 0, favorite: null };
  const SCENARIOS = [
    ['7-pt favorite: covering -> leading 21-17 (ATS turns)', 'lu_sw_fav_ats', FAV,
      [[0, 0, 28, 10, 3], [1, 7, 21, 17, 3]], S(false, true)],
    ['7-pt favorite: tied 17-17 after covering (ATS turns; a tie is not losing)', 'lu_sw_fav_tie', FAV,
      [[0, 0, 28, 10, 3], [1, 7, 17, 17, 3]], S(false, true)],
    ['7-pt favorite: covering -> trailing 21-24 (BOTH turn)', 'lu_sw_fav_both', FAV,
      [[0, 0, 28, 10, 3], [1, 7, 21, 24, 3]], S(true, true)],
    ['7-pt favorite: not covering since half -> trailing in Q3 (straight-up turns)', 'lu_sw_fav_su', FAV,
      [[0, 30, 21, 17, 2], [31, 37, 21, 24, 3]], S(true, true)],
    ['7-pt favorite: ATS turns at 1, losing outright from 3 — ATS settles FIRST, while the team is losing (N1\'s twin)', 'lu_sw_fav_stag', FAV,
      [[0, 0, 28, 10, 3], [1, 2, 21, 17, 3], [3, 12, 21, 24, 3]], S(true, true)],
    ['+10 underdog: leading -> trailing 14-17, still covering (straight-up turns)', 'lu_sw_dog_su', DOG,
      [[0, 0, 14, 10, 3], [1, 7, 14, 17, 3]], S(true, false)],
    ['+10 underdog: leading -> trailing 14-25 (BOTH turn)', 'lu_sw_dog_both', DOG,
      [[0, 0, 14, 10, 3], [1, 7, 14, 25, 3]], S(true, true)],
    ['+10 underdog: trailing 10-17 since half -> 10-24 in Q3 (ATS turns — the reviewer\'s EXACT N1 sequence)', 'lu_sw_dog_n1', DOG,
      [[0, 0, 10, 17, 2], [1, 30, 10, 17, 2], [31, 36, 10, 24, 3]], S(true, true)],
    ['+10 underdog: straight-up turns at 1, ATS at 4 — straight-up settles at 6 while the team is ALSO failing the number', 'lu_sw_dog_stag', DOG,
      [[0, 0, 14, 10, 3], [1, 3, 14, 17, 3], [4, 14, 14, 25, 3]], S(true, true)],
    ['+10 underdog: straight-up turns and settles (still covering), ATS turns after — the second turn is silent', 'lu_sw_dog_stag2', DOG,
      [[0, 0, 14, 10, 3], [1, 7, 14, 17, 3], [8, 20, 14, 25, 3]], S(true, false)],
    ['PK: leading -> trailing (su and ats are one fact)', 'lu_sw_pk', PK,
      [[0, 0, 14, 10, 3], [1, 7, 14, 17, 3]], S(true, true)],
    ['no line: leading -> trailing (ats is never a guess)', 'lu_sw_noline', { spread: null, favorite: null },
      [[0, 0, 14, 10, 3], [1, 7, 14, 17, 3]], S(true, false)],
    ['AWAY alma team, 7-pt favorite: covering -> leading 21-17 on the road (ATS turns)', 'lu_sw_away_ats', { home: 'Rival', away: 'USC', spread: 7, favorite: 'USC' },
      [[0, 0, 10, 28, 3], [1, 7, 17, 21, 3]], S(false, true)],
    ['AWAY alma team, 7-pt favorite: covering -> trailing 24-21 on the road (BOTH turn)', 'lu_sw_away_both', { home: 'Rival', away: 'USC', spread: 7, favorite: 'USC' },
      [[0, 0, 10, 28, 3], [1, 7, 24, 21, 3]], S(true, true)],
    ['7-pt favorite covering all half (neither condition ever holds)', 'lu_sw_fav_never', FAV,
      [[0, 30, 28, 10, 3]], null],
    ['+10 underdog: trailing -> recovered to leading (recovery is not news)', 'lu_sw_dog_recover', DOG,
      [[0, 30, 10, 24, 2], [31, 40, 21, 17, 3]], null],
  ];
  const seen = new Set();
  for (const [label, id, o, script, want] of SCENARIOS) {
    const { rows, postedState } = drive(id, o, script);
    if (want === null) {
      assert(rows.length === 0, `7b-7: ${label} -> no alma line (got ${rows.length})`);
      continue;
    }
    const row = rows[0];
    const pool = row?.meta?.trigger;
    const okState = postedState && postedState.su === want.su && postedState.ats === want.ats;
    assert(rows.length === 1 && okState,
      `7b-7: ${label} -> ONE alma line, posted while the team is ${fmt(want)} (got ${rows.length}${postedState ? `, ${fmt(postedState)}` : ''})`);
    if (!row || !postedState) continue;
    seen.add(fmt(postedState));
    const wantPool = postedState.su ? 'almaTrailing' : 'almaNotCovering';
    assert(pool === wantPool && row.id === `scribe_${wantPool}_${id}_${o.away === 'USC' ? 'away' : 'home'}_0`,
      `7b-8: …from ${wantPool} (${postedState.su ? 'losing straight-up NOW' : 'not losing, only failing the number'}) (got ${pool}, ${row.id})`);
    assert(SCRIBE_POOLS[pool].includes(row.body) && lineTrue(row.body, postedState),
      `7b-9: …and the line that posted is a shipped ${pool} line that is TRUE of the team (${JSON.stringify(row.body)})`);
    const falseLines = (SCRIBE_POOLS[pool] || []).filter(l => !lineTrue(l, postedState));
    assert(falseLines.length === 0,
      `7b-10: …and so is every other line that pool could have picked (false: ${JSON.stringify(falseLines)})`);
  }
  assert(['su=true ats=true', 'su=true ats=false', 'su=false ats=true'].every(k => seen.has(k)),
    `7b-11: the end-to-end sweep posted from all three reachable states (${[...seen].join(' | ')}); the fourth (su=false ats=false) never posts (7b-7)`);
}

console.log('\n[8] Every scribe line this file provoked is clean text, and the tables agree…');
{
  const braces = [];
  for (const m of chat.getMessages({ tag: 'all' })) {
    if (m.author === 'scribe' && /\{|\}/.test(m.body || '')) braces.push(m.id);
  }
  assert(braces.length === 0, `8-1: no SCRIBE line in the fold carries a literal brace (got ${JSON.stringify(braces)})`);
  assert(JSON.stringify(scribeLines.SIGNAL_POINTS) === JSON.stringify(scoring.SIGNAL_POINTS),
    '8-2: the client\'s SIGNAL_POINTS and the server\'s are identical, key order included');
  assert(scoring.SIGNAL_POINTS.liveUpset === 55 && scribeLines.SIGNAL_POINTS.liveUpset === 55, '8-3: liveUpset is worth 55 on both sides');
  const P = scribeLines.SCRIBE_POOLS;
  const live3 = ['coverageFlip', 'almaTrailing', 'almaNotCovering'];
  assert(live3.every(k => Array.isArray(P[k]) && P[k].every(l => !l.startsWith('TEST-ONLY'))),
    '8-4: the three fallback pools exist and no test-only line leaked into them');
  assert(P.coverageFlip.length === 6 && P.almaTrailing.length === 5 && P.almaNotCovering.length === 5,
    `8-5: pool sizes are 6 / 5 / 5 (DI-441 §2) (got ${P.coverageFlip.length} / ${P.almaTrailing.length} / ${P.almaNotCovering.length})`);
  assert(live3.every(k => P[k].every(l => !/[{}]/.test(l))),
    '8-6: no fallback line carries a placeholder — scribeTrigger() passes no vars for these pools, so {NAME}/{N}/{TEAM} would render as "gentlemen"/"several"/"the underdog"');
  assert(live3.every(k => P[k].every(l => !/\d/.test(l))),
    '8-7: no digit in any fallback line (no count, score, minute or quarter number is available to it)');
  assert(live3.every(k => P[k].every(l => !/\b(first|second|third|fourth|half|halftime|quarter|q[1-4]|early|late|minutes?|clock|overtime)\b/i.test(l))),
    '8-8: no fallback line frames a period, a clock or "early"/"late" (these fire only in the second half after a held turn; timing is not in the data they get)');
  assert(live3.every(k => P[k].every(l => !/\b(Brayden|Kevin|Koby|Jacob|Kihoon|Drew|USC|Purdue|Oklahoma|Arkansas|Texas|Aggies|Trojans|Sooners|Razorbacks|Boilermakers)\b/i.test(l))),
    '8-9: no fallback line names a player, a school or a team (hard lines cannot load on the tier-0 path)');
  assert(live3.every(k => P[k].every(l => l.length <= 90)),
    `8-10: every fallback line is one to two short sentences (<= 90 chars) (longest ${Math.max(...live3.flatMap(k => P[k].map(l => l.length)))})`);
  assert(live3.every(k => P[k].every(l => !/\b(order|orders|the room|league chat|chalk|sharp|public money|the chart|breaking|massive|shocking)\b/i.test(l)) && P[k].every(l => !/!/.test(l))),
    '8-11: none of the retired or banned words (order/orders, "the room", "League Chat", bit words, hype words) and no exclamation points');
  assert(live3.every(k => new Set(P[k]).size === P[k].length) && new Set(live3.flatMap(k => P[k])).size === 16,
    '8-12: sixteen distinct lines across the three pools — none repeated inside a pool or across them');
  assert(P.almaTrailing.every(l => !/\b(spread|cover|covers|covering|number)\b/i.test(l.replace(/No spread required\./, ''))),
    '8-13: almaTrailing says nothing about the spread except the one straight-up aside (it fires for a scoreboard loss, alone or with the line failing)');
  assert(P.almaNotCovering.every(l => !/\b(winning|ahead|leading|leads)\b/i.test(l)),
    '8-14: almaNotCovering never says "winning", "ahead" or "leading" — a tied favorite failing the number also lands here');
}

clock = realNow();
Date.now = realNow;

console.log(`\n[liveupsettest] ${pass} passed, ${fail} failed`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
