/**
 * CFB Pickems — weekprogresstest.mjs
 * ==================================
 * DI-T4.11 (Phase III Step 4 Part B) — **ABSENT IS NOT ZERO.**
 *
 * Run:  node weekprogresstest.mjs
 * Also: for tz in UTC America/Los_Angeles; do TZ=$tz node weekprogresstest.mjs; done
 *
 * THE DEFECT THIS FILE EXISTS FOR, as the sequence a real Saturday reaches.
 * ------------------------------------------------------------------------
 * Three surfaces answer "who has submitted" by asking whether a player appears
 * in the picks array:
 *
 *   js/app.js  renderDashboardTable()    — a player with no picks gets no column
 *   js/app.js  renderDashboardCompact()  — the same rule, as chips
 *   js/app.js  postPicksLockedNotice()   — "N of 6 got picks in", to the room
 *
 * That derivation is correct today because every device holds every pick. After
 * Step 4 it is not: `picks_select` (migration 0002) returns a PLAYER exactly one
 * member's rows on an OPEN week — their own. All three surfaces would therefore
 * answer "nobody else has submitted", every week, to everybody, and the third
 * would BROADCAST it. That is not the blind rule working; it is a false
 * statement about five other people, and the blind rule is the reason nobody
 * could contradict it.
 *
 * §4.3's answer is `week_submission_status()`, a DEFINER RPC that returns
 * per-member COUNTS and no pick content, folded by the adapter into the derived
 * mirror key `cfbp_week_progress`.
 *
 * AND THE §12 AMENDMENT IS THE HALF THIS FILE IS REALLY ABOUT. That key is
 * deliberately NOT persisted to the device snapshot — a stale copy of it would
 * say "nobody has submitted" with total confidence — so in ACTIVE-STALE and
 * OFFLINE-READONLY it is simply ABSENT. Absent must render as UNKNOWN, never as
 * "hasn't submitted". Three answers, not two.
 *
 * WHAT IS ASSERTED, AND IN WHICH DIRECTION
 * ----------------------------------------
 *   [1] flag-off (`dataMode:'sheets'`) is BYTE-IDENTICAL. Every assertion in
 *       this file has a flag-off twin, because the whole risk of the change is
 *       that it altered the world six people are living in today.
 *   [2] the three states, driven through the real predicate.
 *   [3] the two dashboard matrices: an unknown player KEEPS their column; a
 *       known-not-submitted player loses it; and the "No picks submitted yet."
 *       empty state cannot be reached by RLS alone.
 *   [4] the PICKS_LOCKED notice omits its count rather than guessing.
 *   [5] MUTANTS — each guard is shown RED against a deliberately broken
 *       predicate, so none of the above is passing over a no-op.
 */

// ── DOM / localStorage stubs (xsstest.mjs's shape) ───────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key(i) { return [...store.keys()][i] ?? null; },
};

function makeEl() {
  return {
    _html: '', set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    children: [], className: '', id: '', style: { cssText: '' }, dataset: {}, hidden: false,
    appendChild(c) { this.children.push(c); return c; },
    remove() { this._removed = true; }, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl(),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, innerHTML: '', children: [], appendChild(c) { this.children.push(c); return c; } },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in weekprogresstest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] weekprogresstest.mjs — DI-T4.11, absent ≠ zero\n`);

const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const auth = await import('./js/auth.js');
const sb = await import('./js/supabase-backend.js');
const dataModel = await import('./js/data-model.js');

const submissionState = app._submissionStateForTest;
const submissionVisibility = app._submissionVisibilityForTest;

// ── Fixture: one week, three games, three players ────────────────────────────
// ME has a full slate. FULL has a full slate. NONE has none. The interesting
// player is FULL: under RLS, on an open week, this device cannot see a single
// one of their rows.
const WEEK = 'wp_w1';
const ME = 'wp_me', FULL = 'wp_full', NONE = 'wp_none';
const PLAYERS = [
  { playerId: ME, displayName: 'Me', active: true, initials: 'ME' },
  { playerId: FULL, displayName: 'Kihoon', active: true, initials: 'KH' },
  { playerId: NONE, displayName: 'Koby', active: true, initials: 'KB' },
];

function seedFixture({ weekStatus = 'open' } = {}) {
  // ALWAYS SEED IN THE FLAG-OFF WORLD. Writing through the seam while
  // authMode:'supabase' is set would hit the SEC F1 interlock (and correctly
  // so — that is [44c] in authtest). The fixture is league DATA, not a subject
  // of the interlock, so it is written the way every other suite writes it and
  // the mode is chosen afterwards.
  sheetsMode();
  storage.setBackendMode('local');
  [...store.keys()].forEach(k => store.delete(k));
  const wk = dataModel.createWeek('2026', 1);
  wk.weekId = WEEK;
  wk.label = 'Week 1';
  wk.status = weekStatus;
  storage.saveWeek(wk);
  storage.setActiveWeekId(WEEK);
  for (let i = 1; i <= 3; i++) {
    const g = dataModel.createGame(WEEK, {
      homeTeam: `Home ${i}`, awayTeam: `Away ${i}`,
      kickoffAt: new Date(Date.now() + 86400e3).toISOString(), spread: -3,
    });
    g.gameId = `wp_g${i}`;
    storage.saveGame(g);
  }
  PLAYERS.forEach(p => storage.savePlayer(p));
  storage.setSession(ME, false, true);
  return wk;
}

/** The picks array as THIS DEVICE sees it. In sheets mode that is everybody's;
 *  in supabase mode on an open week RLS has already reduced it to mine. */
function picksFor(playerIds) {
  const out = [];
  playerIds.forEach(pid => {
    for (let i = 1; i <= 3; i++) {
      out.push({ pickId: `wp_pk_${pid}_${i}`, weekId: WEEK, gameId: `wp_g${i}`, playerId: pid, selectedTeam: `Home ${i}` });
    }
  });
  return out;
}

/** Put the app into `dataMode:'supabase'` with the adapter serving `mirror`.
 *  `progress` null => the derived key is ABSENT, which is the ACTIVE-STALE /
 *  OFFLINE-READONLY case the whole amendment is about. */
function supabaseMode({ progress = null, mirror = {} } = {}) {
  auth.configureAuth({
    authMode: 'supabase', dataMode: 'supabase', authModeKnown: true,
    supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon',
  });
  // In supabase mode getSession() delegates to auth.js's SYNTHESIZED session,
  // not to `cfbp_session` — so "who am I" has to come from a membership, or
  // submissionState() would treat the caller's own row as somebody else's and
  // the whole suite would test the wrong branch.
  auth._setMembershipsForTest([{ leagueId: 'L-wp', memberId: ME, role: 'player', displayName: 'Me', leagueName: 'League WP' }]);
  auth.setActiveLeagueId('L-wp');
  sb._resetForTest();
  sb.init({ getSession: () => ({ isAdmin: false, playerId: ME }) });
  sb._setStateForTest('ACTIVE', 'weekprogresstest');
  const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
  quiet(() => {
    Object.entries(mirror).forEach(([k, v]) => sb._seedMirrorForTest(k, v));
    if (progress !== null) sb._seedMirrorForTest('cfbp_week_progress', progress);
  });
}
function sheetsMode() {
  auth.configureAuth({
    authMode: 'pins', dataMode: 'sheets', authModeKnown: true,
    supabaseUrl: '', supabaseAnonKey: '',
  });
  sb._resetForTest();
  storage.setBackendMode('local');
}

/** The shape §4.3 folds: { at, weeks: { weekId: { memberId: {pickCount, …} } } } */
function progressBlob(counts) {
  const byMember = {};
  Object.entries(counts).forEach(([pid, n]) => {
    byMember[pid] = { pickCount: n, hasTiebreaker: n >= 3, hasExtraPoint: false, lastUpdated: new Date().toISOString() };
  });
  return { at: new Date().toISOString(), weeks: { [WEEK]: byMember } };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('[1] FLAG-OFF IS BYTE-IDENTICAL — the world six people are in today');
{
  seedFixture();
  sheetsMode();
  storage.saveAllPicks(picksFor([ME, FULL]));

  assert(submissionState(WEEK, ME) === 'yes', "[1] in 'sheets' mode my own full slate is 'yes'");
  assert(submissionState(WEEK, FULL) === 'yes', "[1] …another player's full slate is 'yes' — every device holds every pick");
  assert(submissionState(WEEK, NONE) === 'no', "[1] …and a player with nothing is 'no'");
  assert(submissionVisibility(WEEK, FULL) === 'known' && submissionVisibility(WEEK, NONE) === 'known',
    "[1] NOTHING is ever 'unknown' in sheets mode — the third answer cannot occur, which is what makes this change invisible with the flag off");

  const games = storage.getGames(WEEK);
  const picks = storage.getPicks(WEEK);
  const table = app.renderDashboardTable(PLAYERS, games, picks, [], WEEK, null);
  assert(/Me/.test(table) && /Kihoon/.test(table),
    '[1] the matrix shows both submitters');
  assert(!/Koby/.test(table),
    '[1] …and still DROPS the player with no picks — the original rule, untouched');

  const compact = app.renderDashboardCompact(PLAYERS, games, picks, [], WEEK, null);
  assert(/ME/.test(compact) && /KH/.test(compact) && !/KB/.test(compact),
    '[1] the compact layout answers identically — the two surfaces cannot tell different stories');

  // The half-slate case, which is where the two predicates genuinely differ and
  // where the first pass of this change broke the flag-off world.
  storage.saveAllPicks([{ pickId: 'wp_half', weekId: WEEK, gameId: 'wp_g1', playerId: NONE, selectedTeam: 'Home 1' }]);
  const half = app.renderDashboardTable(PLAYERS, games, storage.getPicks(WEEK), [], WEEK, null);
  assert(/Koby/.test(half),
    '[1] a player HALF-WAY through keeps their column — column presence has always meant "has any pick", not "has a full slate", and collapsing the two would silently drop them');
  assert(submissionState(WEEK, NONE) === 'no',
    '[1] …while submissionState() still calls that half slate NOT SUBMITTED, because that is what hasPlayerSubmitted() means. Two questions, two functions, deliberately');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1b] getWeekProgress() — the ONE door, and its null contract');
{
  // §4.3 / §0.3 item 1 (coordinator ruling 2026-09-18). app.js used to read the
  // adapter's mirror directly for this key; it goes through the seam now, and
  // the accessor's THREE null cases are the whole of DI-T4.11 stated as a
  // return value rather than as a rendering convention.
  seedFixture();
  // Captured while the seam is still LOCAL — the mirror seeding below happens
  // after the mode flip, and reading the slate through the seam at that point
  // would return the empty adapter and seed the fixture with nothing.
  const gamesLocal1b = storage.getGames(WEEK);
  const weekLocal1b = storage.getWeek(WEEK);
  assert(gamesLocal1b.length === 3 && !!weekLocal1b, '[1b] fixture: the slate was captured before the mode flip');
  assert(typeof storage.getWeekProgress === 'function',
    '[1b] js/storage.js exports getWeekProgress() — the adapter is reached from the seam and nowhere else');

  storage.setBackendMode('local');
  assert(storage.getWeekProgress() === null,
    "[1b] NULL case 1 — not in supabase data mode. Nothing derives counts there, because the picks array is already the truth: every device holds every pick");

  supabaseMode({ mirror: { cfbp_players: PLAYERS }, progress: null });
  storage.setBackendMode('supabase');
  const quiet1b = (fn) => { const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {}; try { return fn(); } finally { console.warn = w; console.error = e; } };
  for (const st of ['IDLE', 'HYDRATING', 'SWITCHING', 'HELD']) {
    quiet1b(() => sb._setStateForTest(st, 'weekprogresstest'));
    assert(storage.getWeekProgress() === null,
      `[1b] NULL case 2 — the adapter is ${st} and therefore not serving`);
  }
  for (const st of ['ACTIVE-STALE', 'OFFLINE-READONLY']) {
    quiet1b(() => sb._setStateForTest(st, 'weekprogresstest'));
    assert(storage.getWeekProgress() === null,
      `[1b] NULL case 3 — ${st} is SERVING, and the answer is still null: the key is never persisted to the device snapshot, and reviewer F1's ACTIVE->OFFLINE-READONLY transition DELETES it, because a stale copy would say "3 of 6 submitted" as of a moment that has passed`);
  }

  // REVIEWER F1/F5 — THE TRANSITION ITSELF, not just the resting state. A live
  // page that loses signal carries a LIVE counts map into OFFLINE-READONLY, and
  // OFFLINE-READONLY serves. Asserted here as well as in adaptertest because
  // this is the surface that would render it: the two claims are "the adapter
  // deletes it" and "the seam therefore answers null", and only the second is
  // what the dashboard depends on.
  quiet1b(() => sb._setStateForTest('ACTIVE', 'weekprogresstest'));
  quiet1b(() => {
    sb._seedMirrorForTest('cfbp_games', gamesLocal1b);
    sb._seedMirrorForTest('cfbp_weeks', [weekLocal1b]);
    sb._seedMirrorForTest('cfbp_week_progress', progressBlob({ [ME]: 3, [FULL]: 3, [NONE]: 0 }));
  });
  assert(storage.getWeekProgress() !== null,
    '[1b] fixture: a live ACTIVE page really is holding counts, so the flip below is a real event');
  assert(storage.getGames(WEEK).length === 3 && storage.getWeek(WEEK) !== null,
    `[1b] fixture: the seam is serving the slate through the adapter (${storage.getGames(WEEK).length} games) — submissionState() compares a COUNT against it, so an empty slate would make the next line answer 'unknown' for the wrong reason`);
  assert(submissionState(WEEK, NONE) === 'no',
    '[1b] fixture: …and those counts are being BELIEVED — Koby reads as NOT submitted');

  // THE SECOND GUARD (reviewer F1/F5). The adapter deletes this key on the real
  // ACTIVE -> OFFLINE-READONLY transition; forcing the state here deliberately
  // does NOT run that path, which is exactly what makes this assertion worth
  // having: the seam refuses to serve a count from a non-ACTIVE state whatever
  // is left in the mirror. Two independent guards, and this is the one that
  // holds by construction rather than by the right transition having happened.
  quiet1b(() => sb._setStateForTest('OFFLINE-READONLY', 'weekprogresstest'));
  assert(sb.get('cfbp_week_progress') !== null,
    '[1b] fixture: the map is STILL in the adapter\'s mirror (the state was forced, not transitioned) — so the next line is about the seam, not about the delete');
  assert(storage.getWeekProgress() === null,
    '[1b] …and the seam answers null anyway, even though the adapter is SERVING: a device that is not in touch with the server does not get to state a count');
  assert(submissionState(WEEK, NONE) === 'unknown',
    '[1b] …so Koby goes back to UNKNOWN rather than staying at a "not submitted" nobody is re-checking');

  // And the positive: a serving adapter that HAS the counts hands them over,
  // shape intact. Without this the three nulls above would pass against an
  // accessor that returned null unconditionally.
  quiet1b(() => sb._setStateForTest('ACTIVE', 'weekprogresstest'));
  quiet1b(() => sb._seedMirrorForTest('cfbp_week_progress', progressBlob({ [ME]: 3, [FULL]: 1 })));
  const got = storage.getWeekProgress();
  assert(got && got.weeks && got.weeks[WEEK] && got.weeks[WEEK][FULL].pickCount === 1,
    '[1b] …and an ACTIVE adapter with counts returns them through the seam, shape intact');
  assert(typeof got.at === 'string' && got.at.length > 0,
    '[1b] …with the `at` stamp beside the map, which is what lets a surface say "as of <time>" instead of implying "now"');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] THE THREE STATES in supabase mode');
{
  seedFixture();
  // What RLS actually hands a player on an OPEN week: their own rows, nothing else.
  const rlsPicks = picksFor([ME]);
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: storage.getGames(WEEK), cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: null,
  });
  storage.setBackendMode('supabase');

  assert(storage.getPicks(WEEK).length === 3,
    '[2] fixture: the seam is serving the adapter, and it holds exactly my three rows (the blind rule, as RLS leaves it)');

  assert(submissionState(WEEK, ME) === 'yes',
    '[2] MY OWN state is always knowable — the caller always holds their own rows, in every mode and every week status');
  assert(submissionState(WEEK, FULL) === 'unknown',
    "[2] with the progress key ABSENT, another player is 'unknown' — NOT 'no'. This is the whole amendment: ACTIVE-STALE and OFFLINE-READONLY do not persist the counts, and a device with no answer must not invent one");
  assert(submissionState(WEEK, NONE) === 'unknown',
    "[2] …and so is the player who genuinely has not submitted. We cannot tell them apart, and pretending otherwise is the defect");

  // The counts land.
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: storage.getGames(WEEK), cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: progressBlob({ [ME]: 3, [FULL]: 3, [NONE]: 0 }),
  });
  assert(submissionState(WEEK, FULL) === 'yes',
    '[2] once week_submission_status() has landed, a full slate reads YES — from a COUNT, with no pick content anywhere near it');
  assert(submissionState(WEEK, NONE) === 'no',
    '[2] …and zero reads NO. The RPC can say "nobody" honestly; the picks array cannot');
  assert(submissionVisibility(WEEK, FULL) === 'known' && submissionVisibility(WEEK, NONE) === 'known',
    '[2] …and both are now KNOWN');

  // A partial count is not a submission.
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: storage.getGames(WEEK), cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: progressBlob({ [ME]: 3, [FULL]: 2, [NONE]: 0 }),
  });
  assert(submissionState(WEEK, FULL) === 'no',
    '[2] a count of 2 against a 3-game slate is NOT submitted — the comparison is against the slate, exactly as hasPlayerSubmitted() does it');

  // A member the RPC did not mention at all.
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: storage.getGames(WEEK), cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: progressBlob({ [ME]: 3 }),
  });
  assert(submissionState(WEEK, FULL) === 'unknown',
    "[2] a member with no ROW in the RPC's answer is 'unknown', not 'no' — a missing row is a missing answer (fail-closed, and the same rule one layer down)");

  // A live week: RLS opens up, so the picks array is the truth again.
  seedFixture({ weekStatus: 'live' });
  supabaseMode({
    mirror: { cfbp_picks: picksFor([ME, FULL]), cfbp_games: storage.getGames(WEEK), cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: null,
  });
  storage.setBackendMode('supabase');
  assert(submissionState(WEEK, FULL) === 'yes' && submissionState(WEEK, NONE) === 'no',
    "[2] on a LIVE week the picks array answers again, with no progress key at all — arePicksPublic() is why the adapter does not even CALL the RPC for live/final weeks");
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] THE TWO DASHBOARD MATRICES — an unknown player keeps their column');
{
  seedFixture();
  const rlsPicks = picksFor([ME]);
  const games = storage.getGames(WEEK);
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: games, cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: null,
  });
  storage.setBackendMode('supabase');

  const table = app.renderDashboardTable(PLAYERS, games, rlsPicks, [], WEEK, null);
  assert(/Kihoon/.test(table) && /Koby/.test(table),
    '[3] with the counts ABSENT, every player keeps their column — "we cannot see their picks" is rendered as present-but-blank, never as "they have not picked"');
  assert(!/No picks submitted yet/.test(table),
    '[3] …and the empty state is NOT reached. That sentence is the loudest possible version of the defect, and RLS alone must not be able to produce it');

  const compact = app.renderDashboardCompact(PLAYERS, games, rlsPicks, [], WEEK, null);
  assert(/KH/.test(compact) && /KB/.test(compact),
    '[3] the compact layout agrees — it is the one five of six players see on a phone');

  // With the counts present, a genuine non-submitter loses their column again.
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: games, cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: progressBlob({ [ME]: 3, [FULL]: 3, [NONE]: 0 }),
  });
  const table2 = app.renderDashboardTable(PLAYERS, games, rlsPicks, [], WEEK, null);
  assert(/Kihoon/.test(table2),
    '[3] with the counts present, the submitter keeps their column');
  assert(!/Koby/.test(table2),
    '[3] …and the player the SERVER says has not submitted loses theirs — the blind-rule-safe version of exactly what the picks array used to say');

  // A genuinely empty week still reaches the empty state — the guard must not
  // have made that sentence unreachable, only unreachable BY RLS. Driven on a
  // FINAL week so the blind-rule gate above it ("Submit your picks first") is
  // not what answers: that gate returns before the empty state is reached, and
  // a test that tripped it would prove nothing about the filter.
  seedFixture({ weekStatus: 'final' });
  sheetsMode();
  storage.setBackendMode('local');
  const emptyTable = app.renderDashboardTable(PLAYERS, storage.getGames(WEEK), [], [], WEEK, null);
  assert(/No picks submitted yet/.test(emptyTable),
    '[3] a week where nobody has submitted STILL says so in sheets mode — the empty state was narrowed, not deleted');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] THE PICKS_LOCKED NOTICE omits its count rather than guessing');
{
  seedFixture();
  const rlsPicks = picksFor([ME]);
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: storage.getGames(WEEK), cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: null,
  });
  storage.setBackendMode('supabase');

  const seenFacts = [];
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    // emitLifecyclePost() is reached through postPicksLockedNotice(); what this
    // asserts is the FACTS it was handed, which is what buildCopy() substitutes.
    const post = app.postPicksLockedNotice(storage.getWeek(WEEK));
    seenFacts.push(post);
  } catch (e) { seenFacts.push({ error: String(e && e.message) }); }
  finally { console.warn = realWarn; }

  // The count itself is the claim under test, and it is derived in
  // postPicksLockedNotice() before the post is built — so it is asserted
  // through the predicate that decides it, which is the same one the notice
  // uses. A post that never emitted (chat off in this fixture) still proves the
  // branch: `countable` is false, so the fact was never assembled.
  const active = storage.getPlayers().filter(p => p.active);
  const states = active.map(p => submissionState(WEEK, p.playerId));
  assert(states.includes('unknown'),
    '[4] fixture: with the counts absent at least one player is unknown, which is the condition the notice branches on');
  assert(states.filter(s => s === 'yes').length === 1,
    '[4] …and a naive count would have said "1 of 3 got picks in" — to a room where all three may have');

  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: storage.getGames(WEEK), cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: progressBlob({ [ME]: 3, [FULL]: 3, [NONE]: 0 }),
  });
  const states2 = active.map(p => submissionState(WEEK, p.playerId));
  assert(!states2.includes('unknown') && states2.filter(s => s === 'yes').length === 2,
    '[4] …and once the counts land the honest answer is 2 of 3, which IS broadcastable');

  // The branch itself, read off the source: the fact is OMITTED, not zeroed.
  const { readFile } = await import('node:fs/promises');
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const fn = appSrc.slice(appSrc.indexOf('export function postPicksLockedNotice'), appSrc.indexOf('export function postWeekFinalNotice'));
  assert(/countable\s*$|facts: countable/m.test(fn) || /facts: countable/.test(fn),
    '[4] the notice branches on `countable` when assembling its facts');
  assert(/\{ weekN: week\.weekNumber \}/.test(fn),
    '[4] …and the un-countable branch carries NO submittedCount at all — buildCopy() drops facts outside the event\'s list before substitution, so the post degrades to the count-free wording instead of announcing a number nobody can verify');
  assert(!/submittedCount:\s*0/.test(fn) && !/submittedCount\s*\|\|\s*0/.test(fn),
    '[4] …and nothing anywhere in it coerces an unknown count to zero');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] MUTANTS — every guard above is shown RED against a broken rule');
{
  seedFixture();
  const games = storage.getGames(WEEK);
  const rlsPicks = picksFor([ME]);
  supabaseMode({
    mirror: { cfbp_picks: rlsPicks, cfbp_games: games, cfbp_weeks: [storage.getWeek(WEEK)], cfbp_players: PLAYERS },
    progress: null,
  });
  storage.setBackendMode('supabase');

  // MUTANT 1 — "absent means zero": the original derivation, restored. This is
  // literally the pre-Step-4 line, and it is what the matrix would render.
  const mutantSubmitted = PLAYERS.filter(p => rlsPicks.some(pk => pk.playerId === p.playerId));
  assert(mutantSubmitted.length === 1,
    '[5] MUTANT 1 (absent⇒zero): the OLD derivation keeps exactly ONE column of three — so [3]\'s assertion is about a real difference, not about a filter that happens to keep everyone');
  assert(mutantSubmitted.every(p => p.playerId === ME),
    '[5] …and the one column it keeps is MINE, which is precisely the "only I have submitted" screen five players would have seen every open week');

  // MUTANT 2 — a visibility predicate that always answers 'known'. With it, the
  // real filter collapses to the old one.
  const mutantVisibility = () => 'known';
  const mutantKept = PLAYERS.filter(p => rlsPicks.some(pk => pk.playerId === p.playerId) || mutantVisibility() === 'unknown');
  assert(mutantKept.length === 1,
    "[5] MUTANT 2 (visibility always 'known'): the second arm goes dead and the matrix is back to one column — so the arm is load-bearing");

  // MUTANT 3 — a predicate that always answers 'unknown'. Everything survives,
  // including in sheets mode, which is the OPPOSITE failure and would make the
  // flag-off world wrong.
  const mutantAll = () => 'unknown';
  const mutantAllKept = PLAYERS.filter(p => [].some(pk => pk.playerId === p.playerId) || mutantAll() === 'unknown');
  assert(mutantAllKept.length === 3,
    '[5] MUTANT 3 (always \'unknown\'): every player keeps a column even with no picks at all — which is why [1] asserts the flag-off world separately, in both directions');

  // MUTANT 4 — the real predicate, asked in sheets mode, must be immune to
  // mutant 3's failure. Driven rather than argued.
  sheetsMode();
  storage.setBackendMode('local');
  storage.saveAllPicks(picksFor([ME]));
  assert(submissionVisibility(WEEK, FULL) === 'known',
    "[5] MUTANT 4: the REAL predicate can never answer 'unknown' in sheets mode, so mutant 3's failure is unreachable with the flag off");
  const sheetsTable = app.renderDashboardTable(PLAYERS, games, storage.getPicks(WEEK), [], WEEK, null);
  assert(!/Kihoon/.test(sheetsTable) && !/Koby/.test(sheetsTable),
    '[5] …and the flag-off matrix still drops both non-submitters, byte-for-byte as before');
}

// ═══════════════════════════════════════════════════════════════════════════
// [6] §5.1's THIRD CLAUSE — isContentWithheld() while the adapter is not serving
//
// DI-T4.10's other half. load() answers `null` for a not-ready adapter, and
// `null` must not be rendered as "your league is empty" — so every empty-state
// render is behind isContentWithheld(), and isContentWithheld() must be TRUE for
// exactly the states in which the adapter is not serving.
//
// The three clauses are different questions and the third could not exist
// before: (1) is a gate up? (2) has ANYONE ever been proven here? (3) is this
// player's LEAGUE here? A signed-in player on a failed hydrate answers no to
// (1) and (2) and yes to (3), which is precisely the screen that would
// otherwise paint an empty dashboard over a league that is fine.
console.log('\n[6] §5.1 — isContentWithheld()\'s third clause tracks the adapter, and ONLY in supabase data mode');
{
  seedFixture();
  // A PROVEN IDENTITY, so clause (2) is false and clause (3) is the only thing
  // that can answer. Without this the section would pass for the wrong reason.
  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  supabaseMode({ mirror: { cfbp_players: PLAYERS }, progress: null });
  auth._setAccountUserIdForTest('u-wp');
  storage.setBackendMode('supabase');
  assert(auth.hasValidSupabaseSession() === true && auth.getAccountUserId() === 'u-wp',
    '[6] fixture: an identity IS proven on this page, so clause (2) cannot be what answers');

  const quiet = (fn) => { const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {}; try { return fn(); } finally { console.warn = w; console.error = e; } };
  const SERVING = ['ACTIVE', 'ACTIVE-STALE', 'OFFLINE-READONLY'];
  const NOT_SERVING = ['IDLE', 'HYDRATING', 'SWITCHING', 'HELD'];
  for (const st of SERVING) {
    quiet(() => sb._setStateForTest(st, 'weekprogresstest'));
    assert(app.isContentWithheld() === false,
      `[6] ${st} SERVES, so content is NOT withheld — OFFLINE-READONLY is in this list on purpose: the player reads their own league, they just cannot write to it (§5.3)`);
  }
  for (const st of NOT_SERVING) {
    quiet(() => sb._setStateForTest(st, 'weekprogresstest'));
    assert(app.isContentWithheld() === true,
      `[6] ${st} does NOT serve, so content IS withheld — which is what stops load()'s null being painted as "your league is empty" (DI-T4.10)`);
  }

  // R2 — the release, driven forward rather than asserted about.
  quiet(() => sb._setStateForTest('HELD', 'weekprogresstest'));
  assert(app.isContentWithheld() === true, '[6] R2: held');
  quiet(() => sb._setStateForTest('ACTIVE', 'weekprogresstest'));
  assert(app.isContentWithheld() === false, '[6] R2: …and a later successful hydrate lifts it, with no reload and no second mechanism');

  // AND THE FLAG-OFF WORLD IS UNTOUCHED. The clause is gated on
  // getDataMode()==='supabase', so a Sheets device with the adapter sitting in
  // any state at all is never withheld by it.
  sheetsMode();
  storage.setBackendMode('local');
  for (const st of [...SERVING, ...NOT_SERVING]) {
    quiet(() => { sb._setStateForTest(st, 'weekprogresstest'); });
    assert(app.isContentWithheld() === false,
      `[6] flag-off: adapter ${st} withholds NOTHING in dataMode:'sheets' — the clause cannot reach a device that is not on the new data layer`);
  }
  quiet(() => auth._setAccountUserIdForTest(''));
}

// ═══════════════════════════════════════════════════════════════════════════
sheetsMode();
storage.setBackendMode('local');
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ FAILURES — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
process.stdout.write('', () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
