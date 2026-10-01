/**
 * coverfliptest.mjs — SCRIBE's coverage-flip line fires too often (RG-TBD-D1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT (Drew, 2026-09-29)
 *
 *   "For scribe, it comments too much during the games about the spread being
 *    flipped. We should make this only happen in the second half, because if it
 *    gets flipped in the first quarter it may just be after the first touch
 *    down. ... Overall it happens too much and should only happen if there is a
 *    real upset in spread coverage."
 *
 * THE MECHANISM (js/chat-ui.js scribeLiveGameCheck, before this fix)
 *
 *   The detector was stateless. On every 60-second score poll it compared the
 *   mirror's stored row (`prevGame`) against the ESPN-fresh row (`nextGame`),
 *   and posted a `coverageFlip` line whenever the covering side differed:
 *     - in ANY quarter — there was no period input at all;
 *     - on EVERY cover change — a back-and-forth game posted on each swing,
 *       bounded only by a per-device 60-minute room cooldown and a 30-minute
 *       deterministic-id bucket, neither of which is shared across the six
 *       devices;
 *     - against a baseline that is not an observation. On a player device the
 *       stored row is the SERVER's row (the score overlay is dropped on every
 *       hydrate and every Realtime `games` event), so a device opening the app,
 *       or re-hydrating, compared a lagging row to live ESPN and "saw" a flip
 *       that happened long before.
 *
 * THE RULE THIS FILE PINS (the whole of it)
 *
 *   A coverage-flip line posts for a game only when ALL FOUR hold:
 *     1. SECOND HALF — ESPN reports period >= 3 (Q3, Q4, every OT) on the poll
 *        where this device first sees the covering side change. No period
 *        reported means no flip (fail quiet).
 *     2. OBSERVED — the change is between two of THIS DEVICE'S OWN observations
 *        of the ESPN score. A device's first observation of a game only sets
 *        its baseline; it never counts as a flip.
 *     3. SUSTAINED — the new side holds on every poll for 5 minutes. A poll back
 *        on the old side, or exactly on the number, cancels it: a game that
 *        flips back and forth inside the window posts nothing.
 *     4. ONCE PER DIRECTION — no coverage-flip post for that game in that
 *        direction (home now covering / away now covering) is already in the
 *        shared chat log. At most two per game, ever, league-wide.
 *
 * AMENDED BY N8 (DI-439 §3, 2026-09-29 — Drew's "definition A"): a held turn now also
 * has to be one the ROOM is on the wrong side of — L >= 2 of the room on the team now
 * NOT covering, and L > G (the count on the team that is). This file's fixture is
 * three Home picks and one Away pick, so ONLY a turn toward AWAY covering qualifies
 * (L=3, G=1); a turn back to HOME covering is L=1, G=3 and is SILENT. That is a change
 * of expectation, not of mechanism, in two assertions and nowhere else — [4]'s 4-2 and
 * 4-3 (the four rules above are pinned unchanged by every other section, all of which
 * turn toward AWAY). The "overtime counts as second half" claim 4-2 used to carry moves
 * to liveupsettest.mjs, on a direction the crowd rule lets through. Section [10] adds the
 * `espnSport: null` variant of the fixture (the value every ordinary ESPN college game
 * actually carries — the seed below says 'college-football').
 *
 * Every section runs through the REAL call sites — `doRefreshScores()` in both
 * its full-write and display-only modes, with a real ESPN-shaped payload — and
 * reads the OUTCOME from the chat fold. Each section uses its own gameId: the
 * fold is a module-level append-only log and ids are deterministic per game.
 *
 * NOT covered here (browser/device only): that the line renders in the room,
 * and six real phones converging on one post over Realtime. Section [5] proves
 * the shared-log half of rule 4 with a planted post standing in for the other
 * device.
 */

// ── DOM / localStorage stubs (refreshtest.mjs shape) ────────────────────────
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
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// ── A controllable clock. Everything the rule depends on — the sustain window,
//    the room cooldown, the id bucket — reads Date.now(). ──────────────────────
const realNow = Date.now.bind(Date);
const T0 = Date.parse('2026-09-26T20:00:00Z');
let clock = T0;
Date.now = () => clock;
const MIN = 60 * 1000;

// ── ESPN stub: one in-progress event whose score/period the test sets per poll.
function espnEvent({ id, home, away, period, statusName = 'STATUS_IN_PROGRESS' }) {
  const status = { type: { name: statusName, detail: `Q${period ?? '?'}`, shortDetail: `Q${period ?? '?'}` } };
  if (period !== undefined) status.period = period;
  return {
    id, date: '2026-09-26T18:00Z',
    status,
    competitions: [{
      timeValid: true, neutralSite: false,
      competitors: [
        { homeAway: 'home', id: '1', score: String(home), curatedRank: { current: 99 }, team: { id: '1', location: 'Home', name: 'Hosts', shortDisplayName: 'Home' } },
        { homeAway: 'away', id: '2', score: String(away), curatedRank: { current: 99 }, team: { id: '2', location: 'Away', name: 'Visitors', shortDisplayName: 'Away' } },
      ],
      odds: [], broadcasts: [], notes: [],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } },
    }],
  };
}
function installEspn(ev) {
  globalThis.fetch = async () => {
    const body = JSON.stringify({ events: [ev] });
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, json: async () => JSON.parse(body), text: async () => body };
  };
}

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const dm = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const chat = await import('./js/chat.js');
const { WEEK_STATUS, GAME_STATUS } = dm;
const { doRefreshScores, liveStatusById } = app;

// ── Fixtures ────────────────────────────────────────────────────────────────
// Home favoured by 3 (signed home-perspective spread -3, AD-03). With the home
// score H and away score A, home covers when H - 3 > A.
//   14-7  -> home covering by 4      14-14 -> away covering by 3
//   21-14 -> home covering by 4      21-21 -> away covering by 3
// The underdog never leads by 9+, so the upset-watch detector stays out of it.
const PLAYERS = [['p1', 'Brayden'], ['p2', 'Kevin'], ['p3', 'Koby'], ['p4', 'Jacob']];
function seed(gameId, eventId, { home = 0, away = 0, serverJobs, espnSport = 'college-football' } = {}) {
  localStorage.clear();
  storage.saveWeek({
    weekId: 'cw1', weekNumber: 1, label: 'Week 1', season: 2026,
    status: WEEK_STATUS.LIVE, dataSourceMode: 'espn_live',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
  });
  storage.saveGame({
    gameId, weekId: 'cw1',
    homeTeam: 'Home', awayTeam: 'Away', homeMascot: '', awayMascot: '',
    kickoff: '2026-09-26T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread: -3, favorite: 'Home', lockedSpread: -3,
    homeScore: home, awayScore: away,
    status: GAME_STATUS.LIVE, actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_live', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: eventId, espnSport,
  });
  PLAYERS.forEach(([playerId, displayName]) =>
    storage.savePlayer({ playerId, displayName, active: true, almaMater: '', preferences: {} }));
  storage.saveAllPicks(PLAYERS.map(([playerId], i) => ({
    pickId: `pk_${gameId}_${playerId}`, weekId: 'cw1', gameId, playerId,
    selectedTeam: i === 3 ? 'Away' : 'Home', createdAt: new Date(T0).toISOString(),
  })));
  storage.saveSetting('serverJobs', serverJobs);
  liveStatusById.clear();
}
const week = () => storage.getWeeks().find(w => w.weekId === 'cw1');

/** One score poll at `atMin` minutes past this section's start, through the
 *  REAL doRefreshScores() call site. */
async function poll(gameId, eventId, start, atMin, home, away, period, { displayOnly = false } = {}) {
  clock = start + atMin * MIN;
  installEspn(espnEvent({ id: eventId, home, away, period }));
  await doRefreshScores(week(), storage.getGames('cw1'), displayOnly ? { displayOnly: true } : undefined);
}
const flips = gameId => chat.getMessages({ tag: gameId })
  .filter(m => m.author === 'scribe' && m.meta?.trigger === 'coverageFlip');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] A first-half flip never posts — "if it gets flipped in the first quarter it may just be after the first touch down"…');
{
  const g = 'cf_q1', e = '401900001', s = T0;
  seed(g, e);
  await poll(g, e, s, 0, 7, 0, 1);     // Q1, home covering
  await poll(g, e, s, 1, 7, 7, 1);     // Q1, away covering — the flip Drew described
  for (let m = 2; m <= 12; m++) await poll(g, e, s, m, 7, 7, m < 8 ? 1 : 2);
  assert(flips(g).length === 0,
    `1-1: a cover change in Q1, held through Q2, posts NO coverage-flip line (got ${flips(g).length})`);
  const entry = liveStatusById.get(g);
  assert(entry && entry.period === 2,
    `1-2: the live-status map carries ESPN's numeric period — the input rule 1 reads (got ${JSON.stringify(entry && entry.period)})`);
  const persisted = storage.getGames('cw1').find(x => x.gameId === g) || {};
  assert(!('period' in persisted),
    '1-3: …and `period` stays transient: it never reaches the persisted game row (same rule as detail/shortDetail/quarter/clock)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] A second-half flip posts once, and only after it has held for 5 minutes…');
{
  const g = 'cf_q3', e = '401900002', s = T0 + 1000 * MIN;
  seed(g, e);
  await poll(g, e, s, 0, 14, 7, 3);    // Q3, home covering (baseline)
  await poll(g, e, s, 1, 14, 14, 3);   // Q3, away covering — armed, not posted
  assert(flips(g).length === 0,
    `2-1: the poll that first sees the second-half flip posts NOTHING yet (got ${flips(g).length})`);
  for (let m = 2; m <= 5; m++) await poll(g, e, s, m, 14, 14, 3);
  assert(flips(g).length === 0,
    `2-2: …nor 4 minutes later, still inside the sustain window (got ${flips(g).length})`);
  await poll(g, e, s, 6, 14, 14, 3);   // 5 minutes after the flip was first seen
  assert(flips(g).length === 1,
    `2-3: at 5 minutes held, exactly ONE coverage-flip line posts (got ${flips(g).length})`);
  for (let m = 7; m <= 20; m++) await poll(g, e, s, m, 14, 14, m < 15 ? 3 : 4);
  assert(flips(g).length === 1,
    `2-4: …and the same held state never posts again on later polls (got ${flips(g).length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] A game that flips back and forth inside the window posts nothing…');
{
  const g = 'cf_ping', e = '401900003', s = T0 + 2000 * MIN;
  seed(g, e);
  await poll(g, e, s, 0, 14, 7, 3);    // home
  await poll(g, e, s, 1, 14, 14, 3);   // away (armed)
  await poll(g, e, s, 3, 21, 14, 3);   // home again — cancelled
  await poll(g, e, s, 5, 21, 21, 4);   // away (armed)
  await poll(g, e, s, 7, 28, 21, 4);   // home again — cancelled
  for (let m = 8; m <= 25; m++) await poll(g, e, s, m, 28, 21, 4);
  assert(flips(g).length === 0,
    `3-1: four swings, none held for 5 minutes, ending on the original side — ZERO coverage-flip lines (got ${flips(g).length})`);

  const g2 = 'cf_push', e2 = '401900013', s2 = T0 + 2500 * MIN;
  seed(g2, e2);
  await poll(g2, e2, s2, 0, 14, 7, 3);   // home
  await poll(g2, e2, s2, 1, 14, 14, 3);  // away (armed)
  await poll(g2, e2, s2, 3, 17, 14, 3);  // exactly on the number (17 - 3 = 14): a push cancels
  await poll(g2, e2, s2, 4, 17, 17, 3);  // away again — re-armed from here
  for (let m = 5; m <= 8; m++) await poll(g2, e2, s2, m, 17, 17, 3);
  assert(flips(g2).length === 0,
    `3-2: landing exactly on the number cancels the pending flip, and the re-armed one has not yet held 5 minutes (got ${flips(g2).length})`);
  await poll(g2, e2, s2, 9, 17, 17, 3);
  assert(flips(g2).length === 1,
    `3-3: …it posts once it has held 5 minutes from the re-arm (got ${flips(g2).length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] At most one line per game per direction — the OT flip back is silent (definition A), the third swing is too…');
{
  const g = 'cf_dir', e = '401900004', s = T0 + 3000 * MIN;
  seed(g, e);
  await poll(g, e, s, 0, 14, 7, 3);                               // home
  await poll(g, e, s, 1, 14, 14, 3);                              // away
  for (let m = 2; m <= 7; m++) await poll(g, e, s, m, 14, 14, 3);
  assert(flips(g).length === 1, `4-1: the first sustained flip (to AWAY covering) posts (got ${flips(g).length})`);
  // Well past the 60-minute room cooldown, so the ONLY thing that can stop a
  // post below is rule 4.
  await poll(g, e, s, 80, 21, 14, 5);                             // OT: home covering again
  for (let m = 81; m <= 86; m++) await poll(g, e, s, m, 21, 14, 5);
  // AMENDED (N8, definition A): this fixture is 3 Home picks to 1 Away. The turn back to
  // HOME covering leaves L = 1 (the lone Away pick) on the team now NOT covering and G = 3 —
  // one player, and the room is on the RIGHT side. It is silent. ("OT counts as the second
  // half" is proven in liveupsettest.mjs on a direction the crowd rule lets through.)
  assert(flips(g).length === 1,
    `4-2: a sustained flip in OVERTIME back to HOME covering is SILENT under definition A — L=1, G=3, the room is not on the wrong side of it (got ${flips(g).length})`);
  await poll(g, e, s, 160, 21, 21, 6);                            // 2OT: away covering again
  for (let m = 161; m <= 170; m++) await poll(g, e, s, m, 21, 21, 6);
  assert(flips(g).length === 1,
    `4-3: a THIRD sustained flip, back to AWAY covering, posts NOTHING more — that direction has already been called for this game (got ${flips(g).length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] The direction cap is read from the SHARED log, so another device\'s post counts…');
{
  const g = 'cf_other', e = '401900005', s = T0 + 4000 * MIN;
  seed(g, e);
  // Another phone confirmed the same flip a minute earlier; its post arrived
  // over Realtime before this device's own window elapsed.
  chat.ingest([{
    id: `scribe_coverageFlip_${g}_away_1`, seq: 900001, type: 'message', author: 'scribe', gameTag: g,
    body: 'The cover has changed hands. No further comment at this time.', ts: s,
    meta: { source: 'tier0', trigger: 'coverageFlip' },
  }], 900001, { caughtUp: true });
  await poll(g, e, s, 0, 14, 7, 3);
  await poll(g, e, s, 1, 14, 14, 3);
  for (let m = 2; m <= 10; m++) await poll(g, e, s, m, 14, 14, 3);
  assert(flips(g).length === 1,
    `5-1: with another device's away-covering post already in the fold, this device posts NOTHING more (got ${flips(g).length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] A device\'s first look at a game is a baseline, never a flip (the stale-row case)…');
{
  const g = 'cf_open', e = '401900006', s = T0 + 5000 * MIN;
  // The mirror row says home is covering — what the server last wrote, long ago.
  seed(g, e, { home: 14, away: 7 });
  // This device opens the app in the third quarter: ESPN says away is covering.
  for (let m = 0; m <= 15; m++) await poll(g, e, s, m, 14, 14, 3);
  assert(flips(g).length === 0,
    `6-1: comparing a lagging stored row to live ESPN on the first poll posts NOTHING, even once the state has held 15 minutes (got ${flips(g).length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] No period reported, no flip (fail quiet)…');
{
  const g = 'cf_noper', e = '401900007', s = T0 + 6000 * MIN;
  seed(g, e);
  await poll(g, e, s, 0, 14, 7, undefined);
  await poll(g, e, s, 1, 14, 14, undefined);
  for (let m = 2; m <= 10; m++) await poll(g, e, s, m, 14, 14, undefined);
  assert(flips(g).length === 0,
    `7-1: a payload with no status.period posts no coverage-flip line — the rule cannot prove "second half", so it stays quiet (got ${flips(g).length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] The display-only poll (serverJobs.scoresRefresh ON) runs the same rule…');
{
  const g = 'cf_disp', e = '401900008', s = T0 + 7000 * MIN;
  seed(g, e, { home: 14, away: 7, serverJobs: { scoresRefresh: true } });
  const opts = { displayOnly: true };
  await poll(g, e, s, 0, 14, 7, 3, opts);
  await poll(g, e, s, 1, 14, 14, 3, opts);
  assert(flips(g).length === 0, `8-1: display-only — the flip poll posts nothing yet (got ${flips(g).length})`);
  for (let m = 2; m <= 7; m++) await poll(g, e, s, m, 14, 14, 3, opts);
  assert(flips(g).length === 1,
    `8-2: display-only — the sustained second-half flip posts exactly once, off the in-memory ESPN merge (the stored row never changed) (got ${flips(g).length})`);
  const stored = storage.getGames('cw1').find(x => x.gameId === g);
  assert(stored && stored.homeScore === 14 && stored.awayScore === 7,
    '8-3: …and the stored row is untouched — the server is still the single writer');
}

// ═════════════════════════════════════════════════════════════════════════════
// [9] REVIEWER FINDING 1 on 194a542 (2026-09-29) — rule 4's fold check only
//     REDUCES cross-device duplicates: two phones that confirm the same flip
//     before either sees the other's post each send one. The server's
//     `on conflict (league_id,id) do nothing` collapses them only when the ids
//     are IDENTICAL, and a 30-minute time bucket in the id split them whenever
//     the two confirmations straddled a :00/:30 boundary. Rule 4 already allows
//     one post per game per direction, so the id carries no time at all.
//     Two devices are simulated in one process by clearing the fold, the flip
//     state and localStorage between them — device B has not yet received A's
//     post, which is exactly the race.
console.log('\n[9] Two phones confirming the same flip either side of a 30-minute boundary produce the SAME post id…');
{
  const chatUi = await import('./js/chat-ui.js');
  const g = 'cf_twodev', e = '401900009', s = T0 + 9000 * MIN;   // `s` is on a :00/:30 boundary
  const BUCKET = 30 * MIN;
  // Device A: polls every minute, sees the flip at s-7, confirms at s-2.
  seed(g, e);
  await poll(g, e, s, -8, 14, 7, 3);
  for (let m = -7; m <= -2; m++) await poll(g, e, s, m, 14, 14, 3);
  const postA = flips(g)[0];
  assert(flips(g).length === 1, `9-1: device A posts once, at s-2 (got ${flips(g).length})`);
  // Device B: same game, same ESPN timeline, but asleep between s-8 and s-3,
  // so it arms at s-3 and confirms at s+2 — the other side of the boundary.
  chat._resetForTest();
  chatUi._resetCoverageFlipStateForTest();
  seed(g, e);
  await poll(g, e, s, -8, 14, 7, 3);
  for (let m = -3; m <= 2; m++) await poll(g, e, s, m, 14, 14, 3);
  const postB = flips(g)[0];
  assert(Math.floor((s - 2 * MIN) / BUCKET) !== Math.floor((s + 2 * MIN) / BUCKET),
    '9-2: fixture — the two confirmations really are in DIFFERENT 30-minute buckets (non-vacuity for 9-3)');
  assert(!!postA && !!postB && postA.id === postB.id,
    `9-3: …and both devices send the SAME id, so the server's on-conflict(id) keeps exactly one (A=${postA && postA.id}, B=${postB && postB.id})`);
  chat.ingest([{ ...postA, local: false, seq: 900009 }], 900009, { caughtUp: true });
  assert(flips(g).length === 1,
    `9-4: when A's post reaches B's fold it collapses onto B's own — one line in the room (got ${flips(g).length})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// [10] N8 (DI-439 §2, R1) — THE FIXTURE'S OTHER SPELLING. A game row's `espnSport` is
//      null for every ordinary ESPN college game (createGame() never sets it; only a
//      manual multi-sport link does) — it is NEVER the string 'cfb'. The seed above
//      says 'college-football', which is the legacy path key; a sport resolver that
//      read "unknown" as silent would have silenced the null spelling, i.e. EVERY
//      college game, and this file's other nine sections would still have been green.
console.log('\n[10] espnSport null (the value an ordinary ESPN college game carries) is football: the same flip posts…');
{
  const g = 'cf_null', e = '401900010', s = T0 + 10000 * MIN;
  seed(g, e, { espnSport: null });
  assert(storage.getGames('cw1').find(x => x.gameId === g).espnSport === null,
    '10-1: fixture — the stored game really carries espnSport: null (non-vacuity for 10-2)');
  await poll(g, e, s, 0, 14, 7, 3);
  await poll(g, e, s, 1, 14, 14, 3);
  for (let m = 2; m <= 7; m++) await poll(g, e, s, m, 14, 14, 3);
  assert(flips(g).length === 1,
    `10-2: a sustained second-half flip toward AWAY posts exactly once for espnSport null (got ${flips(g).length})`);

  const g2 = 'cf_unk', e2 = '401900011', s2 = T0 + 10500 * MIN;
  seed(g2, e2, { espnSport: 'curling' });
  await poll(g2, e2, s2, 0, 14, 7, 3);
  await poll(g2, e2, s2, 1, 14, 14, 3);
  for (let m = 2; m <= 7; m++) await poll(g2, e2, s2, m, 14, 14, 3);
  assert(flips(g2).length === 0,
    `10-3: …while a sport this build has no second-half rule for ('curling') stays silent — an unknown sport is never guessed at (got ${flips(g2).length})`);
}

clock = realNow();
Date.now = realNow;

console.log(`\n[coverfliptest] ${pass} passed, ${fail} failed`);
// Same exit shim as refreshtest.mjs (reviewer F3 / security F-6): drain both
// streams before exiting, with an unref'd backstop so a wedged pipe cannot hang
// a parent spawnSync().
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
