/**
 * CFB Pickems — sportcontexttest.mjs
 * ===================================
 * Deployment 1 (v0.30.0), thread 100726-D1, Lane A — the multisport client's MODEL: DI-520 (the sport context: pointer, resolution, the Dashboard scope), DI-531 (who is in a sport, with
 * the joined-before-lock rule C1) and DI-555 (surfaces show only the sports the member plays). Security A3 (a non-entrant counts for nothing), A4 (a forged pointer is ignored),
 * A5 (device-stored state is keyed by account and league) and C1 are each proven here by the sequence that breaks them, not by a neighbouring property.
 *
 * Run:  node sportcontexttest.mjs
 *
 *   [1]  THE SINGLE-SPORT RULE — pre-backfill, one competition, and one-plus-an-ARCHIVED-one answer exactly as v0.29.0 did: every active player, getContextWeek() IS getCurrentWeek(),
 *        getContextWeeks() is getWeeks() (a copy), no pointer is read or written, no switcher is ever warranted.
 *   [2]  playersForCompetition — enrollment 'all' / 'opt_in', the tournament-only guest, an unknown or archived competition, the default (null) competition.
 *   [3]  C1 — the joined-before-lock rule: before / at the exact instant / after, the lockedAt fallback, no instant at all, a row with no joinedAt, a commissioner-enrolled row.
 *   [4]  the pointer — resolution order (stored → first played → default read-only), a forged / stale / unplayed / archived / other-account / poisoned entry is ignored and never persisted.
 *   [5]  the Dashboard scope — 'all' only for a member who plays two or more sports; a forged value; it never moves the pointer.
 *   [6]  A5 — two accounts on one handset; clearSportContextExcept; keyed by league as well.
 *   [7]  the context week and weeks in a two-sport league; read-only copies; playersForWeek for a dangling competition.
 *   [8]  the storage seam — the new keys are device-local, the competition_members accessors insert and delete only, the pointer writes go through save().
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in sportcontexttest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const storage = await import('./js/storage.js');
const auth = await import('./js/auth.js');
const comp = await import('./js/competition.js');
const {
  isMultiSport, playersForCompetition, playersForWeek, viewerPlaysCompetition, playedSports, leagueSports, competitionForSport,
  getActiveSportKey, setActiveSportKey, getContextCompetition, getContextWeek, getContextWeeks, getDashboardScope, setDashboardScope,
  clearSportContextExcept, DASHBOARD_ALL, getWeeksForCompetition,
} = comp;

const LEAGUE = 'L-test-0001';
const LEAGUE_2 = 'L-test-0002';
const KEY_ACTIVE_LEAGUE = 'cfbp_supabase_active_league';
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const readKey = (k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; };

const CID = {
  D: '11111111-1111-4111-8111-111111111111',   // cfb, the default, enrollment all
  N: '22222222-2222-4222-8222-222222222222',   // nfl, opt_in
  H: '33333333-3333-4333-8333-333333333333',   // nhl, enrollment all (a third sport)
};
const C = {
  D: { id: CID.D, sport: 'cfb', kind: 'season', enrollment: 'all', isDefault: true, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-01-01T00:00:00.000Z' },
  N: { id: CID.N, sport: 'nfl', kind: 'season', enrollment: 'opt_in', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-02-01T00:00:00.000Z' },
  H: { id: CID.H, sport: 'nhl', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-03-01T00:00:00.000Z' },
};
const P = (id, extra = {}) => ({ playerId: id, displayName: id.toUpperCase(), active: true, ...extra });
const PLAYERS = [P('p1'), P('p2'), P('p3'), P('p4'), P('p5', { active: false }), P('p6', { tournamentOnlyGuest: true })];
const NFL_LOCK = '2026-10-11T16:30:00.000Z';          // the NFL week's picksLockAt (the commissioner set it)
const MEMBER = (competitionId, memberId, joinedAt, enrolledBy = 'self') => ({ id: `${competitionId}:${memberId}`, competitionId, memberId, enrolledBy, joinedAt });

function reset({ comps = [], members = [], players = PLAYERS, session = 'p1', weeks = [], games = [], league = LEAGUE } = {}) {
  store.clear();
  auth._resetAuthForTest();
  if (league) localStorage.setItem(KEY_ACTIVE_LEAGUE, league);
  put('cfbp_competitions', comps);
  put('cfbp_competition_members', members);
  put('cfbp_players', players);
  put('cfbp_weeks', weeks);
  put('cfbp_games', games);
  if (session) put('cfbp_session', { playerId: session, isAdmin: false, playerVerified: true });
}
const wk = (weekId, extra = {}) => ({ weekId, weekNumber: 6, status: 'open', startDate: '', endDate: '', ...extra });
const ids = (list) => list.map((p) => p.playerId);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] THE SINGLE-SPORT RULE — every answer is v0.29.0\'s…');
{
  // (a) pre-backfill: zero competition rows
  reset({ comps: [], weeks: [wk('w1'), wk('w2', { status: 'final', weekNumber: 5 })] });
  assert(isMultiSport() === false, '[1a] pre-backfill: isMultiSport() is false');
  assert(eq(ids(playersForCompetition()), ['p1', 'p2', 'p3', 'p4', 'p6']), `[1a] pre-backfill: playersForCompetition() is every ACTIVE player, tournament-only guest included — exactly getPlayers().filter(active) (${ids(playersForCompetition())})`);
  assert(eq(ids(playersForCompetition()), ids(storage.getPlayers().filter((p) => p.active))), '[1a] …and equal to the expression every consumer used before');
  assert(getActiveSportKey() === 'cfb', '[1a] pre-backfill: the sport is cfb');
  assert(eq(getContextWeek(), storage.getCurrentWeek()), '[1a] pre-backfill: getContextWeek() deep-equals getCurrentWeek()');
  assert(eq(getContextWeeks(), storage.getWeeks()) && getContextWeeks() !== storage.getWeeks(), '[1a] pre-backfill: getContextWeeks() equals getWeeks() and is a COPY');
  assert(setActiveSportKey('cfb') === false && localStorage.getItem('cfbp_active_sport') === null, '[1a] pre-backfill: setActiveSportKey writes NOTHING');
  assert(getDashboardScope() === 'cfb' && setDashboardScope(DASHBOARD_ALL) === false && localStorage.getItem('cfbp_dashboard_scope') === null, '[1a] pre-backfill: no All sports, nothing stored');
  assert(eq(playedSports(), []), '[1a] pre-backfill: playedSports() is [] (there is no competition to name)');

  // (b) one competition, the default
  reset({ comps: [C.D], weeks: [wk('w1')], session: null });
  assert(isMultiSport() === false, '[1b] one competition: isMultiSport() is false');
  assert(getActiveSportKey() === 'cfb' && getContextCompetition().id === CID.D, '[1b] one competition: the sport is its sport, whoever is looking (a SIGNED-OUT viewer too)');
  assert(eq(getContextWeek(), storage.getCurrentWeek()) && eq(ids(playersForCompetition(CID.D)), ['p1', 'p2', 'p3', 'p4', 'p6']), '[1b] one competition: the context week is the current week, the roster is every active player');
  assert(eq(playedSports().map((s) => s.dbCode), ['cfb']), '[1b] one competition: playedSports() is that one sport for any viewer');

  // (c) one live competition plus an ARCHIVED one is still single-sport
  reset({ comps: [C.D, { ...C.N, archivedAt: '2026-09-01T00:00:00.000Z' }], weeks: [wk('w1')] });
  assert(isMultiSport() === false, '[1c] one live + one archived competition: still single-sport (an archived sport counts for nothing, DI-520)');
  assert(eq(ids(playersForCompetition(CID.D)), ['p1', 'p2', 'p3', 'p4', 'p6']) && getActiveSportKey() === 'cfb', '[1c] …the roster is everyone and the sport is cfb');
  assert(eq(playersForCompetition(CID.N), playersForCompetition(CID.N)) && eq(ids(playersForCompetition(CID.N)), ['p1', 'p2', 'p3', 'p4', 'p6']), '[1c] …even an archived competition\'s id answers the single-sport roster (nothing branches on it)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] playersForCompetition — enrollment, the guest, unknown and archived…');
{
  const members = [MEMBER(CID.N, 'p1', '2026-10-01T00:00:00.000Z'), MEMBER(CID.N, 'p3', '2026-10-01T00:00:00.000Z', 'commissioner'), MEMBER(CID.N, 'p5', '2026-10-01T00:00:00.000Z'), MEMBER(CID.D, 'p2', '2026-10-01T00:00:00.000Z')];
  reset({ comps: [C.D, C.N], members });
  assert(isMultiSport() === true, '[2a] two live competitions: isMultiSport()');
  assert(eq(ids(playersForCompetition(CID.D)), ['p1', 'p2', 'p3', 'p4']), `[2a] an enrollment:'all' sport: every active member EXCEPT the tournament-only guest, and not the inactive p5 (${ids(playersForCompetition(CID.D))})`);
  assert(eq(ids(playersForCompetition(null)), ['p1', 'p2', 'p3', 'p4']), '[2a] null means the default competition');
  assert(eq(ids(playersForCompetition(CID.N)), ['p1', 'p3']), `[2b] an opt_in sport: only members with a row — p1 (self) and p3 (commissioner-enrolled); NOT p2 (a row for the OTHER competition), NOT inactive p5 (${ids(playersForCompetition(CID.N))})`);
  assert(eq(ids(playersForCompetition('99999999-9999-4999-8999-999999999999')), []), '[2c] an unknown competition id has NOBODY (never the default roster)');
  reset({ comps: [C.D, C.N, { ...C.H, archivedAt: '2026-09-02T00:00:00.000Z' }], members });
  assert(eq(playersForCompetition(CID.H), []), '[2d] an ARCHIVED competition has nobody once the league is multi-sport');
  assert(Array.isArray(playersForCompetition(CID.D)) && playersForCompetition(CID.D) !== storage.getPlayers(), '[2e] the result is a new array');
  // viewer
  reset({ comps: [C.D, C.N], members, session: 'p1' });
  assert(viewerPlaysCompetition(CID.N) === true && viewerPlaysCompetition(CID.D) === true, '[2f] p1 plays both');
  reset({ comps: [C.D, C.N], members, session: 'p2' });
  assert(viewerPlaysCompetition(CID.N) === false && viewerPlaysCompetition(CID.D) === true, '[2f] p2 plays CFB only');
  reset({ comps: [C.D, C.N], members, session: null });
  assert(viewerPlaysCompetition(CID.D) === false, '[2f] a signed-out viewer plays nothing');
  put('cfbp_session', { playerId: 'p1', isAdmin: false, playerVerified: false });
  assert(comp.viewerMemberId() === null && viewerPlaysCompetition(CID.D) === false, '[2f] an UNVERIFIED session plays nothing (the Picks page\'s own "verified player" test)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] C1 — a member counts for a week only if they joined BEFORE its lock instant…');
{
  const week = wk('wn1', { competitionId: CID.N, picksLockAt: NFL_LOCK });
  const lockMs = Date.parse(NFL_LOCK);
  const iso = (ms) => new Date(ms).toISOString();
  const members = [
    MEMBER(CID.N, 'p1', iso(lockMs - 1)),          // one ms before the lock: counts
    MEMBER(CID.N, 'p2', iso(lockMs)),              // EXACTLY at the lock: late
    MEMBER(CID.N, 'p3', iso(lockMs + 1000), 'commissioner'),   // after the lock, commissioner-enrolled: late too
    MEMBER(CID.N, 'p4', undefined),                // no joinedAt at all (legacy / local): counts
  ];
  reset({ comps: [C.D, C.N], members, weeks: [week] });
  assert(eq(ids(playersForCompetition(CID.N, { weekId: 'wn1' })), ['p1', 'p4']), `[3a] week roster: before-the-lock and no-joinedAt count; AT the exact instant and after do not (${ids(playersForCompetition(CID.N, { weekId: 'wn1' }))})`);
  assert(eq(ids(playersForCompetition(CID.N)), ['p1', 'p2', 'p3', 'p4']), '[3b] WITHOUT a weekId the roster is "now": all four (a late joiner counts from the NEXT week)');
  assert(eq(ids(playersForWeek(week)), ['p1', 'p4']), '[3c] playersForWeek(week) is the same call with the week\'s own competition and id');
  // a commissioner-enrolled row gets no pass
  assert(!ids(playersForWeek(week)).includes('p3'), '[3d] a COMMISSIONER-inserted row after the lock is a late join too (the rule is on joinedAt, not on who inserted)');
  // the same members for the NEXT week (a later lock) all count
  const next = wk('wn2', { competitionId: CID.N, weekNumber: 7, picksLockAt: iso(lockMs + 7 * 86400000) });
  reset({ comps: [C.D, C.N], members, weeks: [week, next] });
  assert(eq(ids(playersForWeek(next)), ['p1', 'p2', 'p3', 'p4']), '[3e] the next week (lock a week later): everyone who joined before THAT lock counts');
  // lock instant derived from the first kickoff when no picksLockAt (computeEffectiveLockAt: first kickoff - 30 min)
  const kick = Date.parse('2026-10-11T17:00:00.000Z');
  const w3 = wk('wn3', { competitionId: CID.N, picksLockAt: null });
  reset({ comps: [C.D, C.N], members: [MEMBER(CID.N, 'p1', iso(kick - 30 * 60000 - 1)), MEMBER(CID.N, 'p2', iso(kick - 30 * 60000))], weeks: [w3],
    games: [{ gameId: 'g1', weekId: 'wn3', kickoff: iso(kick), status: 'scheduled' }] });
  assert(eq(ids(playersForWeek(w3)), ['p1']), '[3f] with no picksLockAt the instant is the first kickoff minus 30 minutes (the one week-lock state): 1 ms before counts, exactly at does not');
  // no lock instant at all (no picksLockAt, no dated game, never locked): nobody is late
  const w4 = wk('wn4', { competitionId: CID.N, picksLockAt: null });
  reset({ comps: [C.D, C.N], members: [MEMBER(CID.N, 'p1', '2099-01-01T00:00:00.000Z')], weeks: [w4] });
  assert(eq(ids(playersForWeek(w4)), ['p1']), '[3g] a week with NO lock instant and no lockedAt has no cutoff: every entrant counts');
  // a hand-locked week with no dated games uses its lockedAt
  const w5 = wk('wn5', { competitionId: CID.N, picksLockAt: null, status: 'locked', lockedAt: iso(lockMs) });
  reset({ comps: [C.D, C.N], members: [MEMBER(CID.N, 'p1', iso(lockMs - 5)), MEMBER(CID.N, 'p2', iso(lockMs + 5))], weeks: [w5] });
  assert(eq(ids(playersForWeek(w5)), ['p1']), '[3h] a week the commissioner locked by hand (no dated games) is cut off at its lockedAt');
  // an unparseable joinedAt is not a reason to drop someone from results
  reset({ comps: [C.D, C.N], members: [MEMBER(CID.N, 'p1', 'not a date')], weeks: [week] });
  assert(eq(ids(playersForWeek(week)), ['p1']), '[3i] an unparseable joinedAt counts (a garbled stamp never silently removes a player from standings)');
  // enrollment 'all' ignores the rule (no per-member rows exist)
  reset({ comps: [C.D, C.N], members, weeks: [wk('wc1', { picksLockAt: NFL_LOCK })] });
  assert(eq(ids(playersForCompetition(CID.D, { weekId: 'wc1' })), ['p1', 'p2', 'p3', 'p4']), '[3j] an enrollment:\'all\' sport is unaffected by the join rule');
  // dangling reference
  reset({ comps: [C.D, C.N], members, weeks: [wk('wx', { competitionId: '99999999-9999-4999-8999-999999999999' })] });
  assert(eq(playersForWeek(storage.getWeek('wx')), []), '[3k] a week whose competition reference dangles has NOBODY (fail closed, never the default roster)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] the pointer — resolution, and everything forged is ignored…');
{
  const both = [MEMBER(CID.N, 'p1', '2026-10-01T00:00:00.000Z')];
  reset({ comps: [C.D, C.N], members: both, session: 'p1' });
  assert(getActiveSportKey() === 'cfb', '[4a] nothing stored: the first sport the viewer plays (the default, cfb)');
  assert(setActiveSportKey('nfl') === true && getActiveSportKey() === 'nfl', '[4b] a played sport can be chosen');
  assert(getContextCompetition().id === CID.N, '[4b] …and it is the context competition');
  assert(eq(readKey('cfbp_active_sport'), { local: { [LEAGUE]: 'nfl' } }), `[4c] stored per account (here the device\'s 'local') and per league: ${localStorage.getItem('cfbp_active_sport')}`);
  assert(setActiveSportKey('nhl') === false && setActiveSportKey('') === false && setActiveSportKey(null) === false && setActiveSportKey({}) === false && getActiveSportKey() === 'nfl',
    '[4d] an unknown / blank / non-string sport is refused and changes nothing');
  // A4 — a forged pointer
  put('cfbp_active_sport', { local: { [LEAGUE]: 'nhl' } });
  assert(getActiveSportKey() === 'cfb', '[4e] a stored pointer naming a sport this league does not have is IGNORED (resolves to the first played)');
  const before = localStorage.getItem('cfbp_active_sport');
  getActiveSportKey();
  assert(localStorage.getItem('cfbp_active_sport') === before, '[4e] …and reading never persists the repair');
  put('cfbp_active_sport', { local: { [LEAGUE]: { sport: 'nfl' } } });
  assert(getActiveSportKey() === 'cfb', '[4f] a stored object where a string belongs is ignored');
  localStorage.setItem('cfbp_active_sport', 'not json {');
  const realErr = console.error; console.error = () => {};      // storage.js load() logs the parse failure; that line is the seam working, not noise to assert on
  try { assert(getActiveSportKey() === 'cfb', '[4g] unparseable JSON is ignored'); } finally { console.error = realErr; }
  put('cfbp_active_sport', ['nfl']);
  assert(getActiveSportKey() === 'cfb', '[4h] an array where the map belongs is ignored');
  // unplayed sport (DI-555): p2 does not play NFL
  reset({ comps: [C.D, C.N], members: both, session: 'p2' });
  put('cfbp_active_sport', { local: { [LEAGUE]: 'nfl' } });
  assert(getActiveSportKey() === 'cfb', '[4i] a pointer at a sport the viewer has NOT joined resolves to a played sport (DI-555)');
  assert(setActiveSportKey('nfl') === false, '[4i] …and setActiveSportKey refuses it');
  assert(eq(playedSports().map((s) => s.dbCode), ['cfb']) && eq(leagueSports().map((s) => s.dbCode), ['cfb', 'nfl']), '[4j] playedSports() is CFB only; leagueSports() still lists both (the overview offers NFL\'s Join)');
  // plays none
  reset({ comps: [C.D, C.N], members: [], session: 'p2', players: PLAYERS.map((p) => (p.playerId === 'p2' ? { ...p } : p)) });
  put('cfbp_competitions', [{ ...C.D, enrollment: 'opt_in' }, C.N]);
  assert(eq(playedSports(), []) && getActiveSportKey() === 'cfb', '[4k] a member who plays no sport: playedSports() is [] and the pointer is the league default (read-only)');
  // archived pointer
  reset({ comps: [C.D, { ...C.N, archivedAt: '2026-09-01T00:00:00.000Z' }], members: both, session: 'p1' });
  put('cfbp_active_sport', { local: { [LEAGUE]: 'nfl' } });
  assert(getActiveSportKey() === 'cfb' && isMultiSport() === false, '[4l] a pointer at an ARCHIVED sport is ignored (and the league is single-sport again)');
  // poisoned keys can never be written or believed
  reset({ comps: [C.D, C.N], members: both, session: 'p1' });
  put('cfbp_active_sport', JSON.parse('{"__proto__":{"x":1},"local":{"__proto__":"nfl"}}'));
  assert(getActiveSportKey() === 'cfb', '[4m] __proto__ in the stored map is ignored');
  localStorage.setItem(KEY_ACTIVE_LEAGUE, '__proto__');
  assert(setActiveSportKey('nfl') === false && ({}).x === undefined, '[4m] a league id of "__proto__" cannot be written (no pointer, no prototype pollution)');
  localStorage.setItem(KEY_ACTIVE_LEAGUE, LEAGUE);
  // three sports: the third (enrollment all) is played by everyone
  reset({ comps: [C.D, C.N, C.H], members: both, session: 'p1' });
  assert(eq(playedSports().map((s) => s.dbCode), ['cfb', 'nfl', 'nhl']) && setActiveSportKey('nhl') === true && getActiveSportKey() === 'nhl', '[4n] playedSports() lists every sport in competition order; any played one can be chosen');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] the Dashboard scope — All sports is a scope, never a sport…');
{
  const both = [MEMBER(CID.N, 'p1', '2026-10-01T00:00:00.000Z')];
  reset({ comps: [C.D, C.N], members: both, session: 'p1' });
  assert(getDashboardScope() === 'cfb', '[5a] default: the context sport');
  assert(setDashboardScope('all') === true && getDashboardScope() === 'all', '[5b] a member who plays TWO sports can choose All sports');
  assert(getActiveSportKey() === 'cfb', '[5c] …and the POINTER did not move (Picks and Standings never see it)');
  assert(setActiveSportKey('nfl') === true && getDashboardScope() === 'all' && getActiveSportKey() === 'nfl', '[5d] choosing a sport elsewhere moves the pointer; the Dashboard keeps its own scope');
  assert(setDashboardScope('cfb') === true && getDashboardScope() === 'nfl', '[5e] clearing the scope returns the Dashboard to the pointer\'s sport');
  assert(!/"all"/.test(localStorage.getItem('cfbp_dashboard_scope') || ''), '[5e] …and the stored entry is gone');
  // a member who plays one of two
  reset({ comps: [C.D, C.N], members: both, session: 'p2' });
  assert(setDashboardScope('all') === false && getDashboardScope() === 'cfb', '[5f] a member who plays ONE sport is refused All sports (C7: it can never reach an unplayed sport)');
  put('cfbp_dashboard_scope', { local: { [LEAGUE]: 'all' } });
  assert(getDashboardScope() === 'cfb', '[5g] a FORGED stored "all" for a one-sport member is ignored');
  // single-sport league
  reset({ comps: [C.D], members: [], session: 'p1' });
  put('cfbp_dashboard_scope', { local: { [LEAGUE]: 'all' } });
  assert(getDashboardScope() === 'cfb', '[5h] a forged "all" in a single-sport league is ignored');
  // junk values
  reset({ comps: [C.D, C.N], members: both, session: 'p1' });
  for (const junk of ['ALL', 'nfl', 1, true, {}, ['all']]) {
    put('cfbp_dashboard_scope', { local: { [LEAGUE]: junk } });
    if (getDashboardScope() !== 'cfb') { assert(false, `[5i] junk scope ${JSON.stringify(junk)} must be ignored`); break; }
  }
  assert(true, '[5i] only the exact string "all" is a scope; "ALL", a sport code, numbers, booleans, objects and arrays are ignored');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] A5 — device-stored state is keyed by account and league…');
{
  const both = [MEMBER(CID.N, 'p1', '2026-10-01T00:00:00.000Z')];
  reset({ comps: [C.D, C.N], members: both, session: 'p1' });
  auth._setAccountUserIdForTest('u-alice');
  setActiveSportKey('nfl'); setDashboardScope('all');
  assert(getActiveSportKey() === 'nfl' && getDashboardScope() === 'all', '[6a] account A\'s pointer and scope');
  assert(eq(readKey('cfbp_active_sport'), { 'u-alice': { [LEAGUE]: 'nfl' } }), '[6a] …are stored under A\'s id');
  // account B on the same handset, same league, same membership row (the worst case: the same player id)
  auth._setAccountUserIdForTest('u-bob');
  assert(getActiveSportKey() === 'cfb' && getDashboardScope() === 'cfb', '[6b] account B sees NONE of A\'s pointer or scope — it resolves to B\'s own default, not A\'s last sport');
  setActiveSportKey('nfl');
  const m = readKey('cfbp_active_sport');
  assert(m['u-alice'][LEAGUE] === 'nfl' && m['u-bob'][LEAGUE] === 'nfl', '[6c] both accounts coexist until the account change hook runs');
  clearSportContextExcept('u-bob');
  const after = readKey('cfbp_active_sport');
  assert(!('u-alice' in after) && after['u-bob'][LEAGUE] === 'nfl', '[6d] clearSportContextExcept(B) deletes A\'s entry and keeps B\'s');
  assert(!('u-alice' in (readKey('cfbp_dashboard_scope') || {})), '[6d] …in the scope map too');
  auth._setAccountUserIdForTest('u-alice');
  assert(getActiveSportKey() === 'cfb', '[6e] after the sweep, A returning finds nothing of the old entry');
  clearSportContextExcept(null);
  assert(eq(readKey('cfbp_active_sport'), {}) && eq(readKey('cfbp_dashboard_scope'), {}), '[6f] clearSportContextExcept(nobody) empties both maps');
  // keyed by league too
  auth._setAccountUserIdForTest('u-alice');
  setActiveSportKey('nfl');
  localStorage.setItem(KEY_ACTIVE_LEAGUE, LEAGUE_2);
  assert(isMultiSport() && getActiveSportKey() === 'cfb', '[6g] the same account in ANOTHER league does not inherit this league\'s pointer (still two sports here, so a real resolution)');
  localStorage.setItem(KEY_ACTIVE_LEAGUE, LEAGUE);
  assert(getActiveSportKey() === 'nfl', '[6g] …and switching back finds it again (the pointer is per league)');
  auth._setAccountUserIdForTest('');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] the context week and weeks in a two-sport league…');
{
  const weeks = [
    wk('wc5', { weekNumber: 5, status: 'final' }),
    wk('wc6', { weekNumber: 6, status: 'open' }),
    wk('wn5', { weekNumber: 5, status: 'final', competitionId: CID.N }),
    wk('wn6', { weekNumber: 6, status: 'locked', competitionId: CID.N }),
  ];
  const both = [MEMBER(CID.N, 'p1', '2026-10-01T00:00:00.000Z')];
  reset({ comps: [C.D, C.N], members: both, weeks, session: 'p1' });
  assert(getContextWeek().weekId === 'wc6' && eq(getContextWeeks().map((w) => w.weekId), ['wc5', 'wc6']), '[7a] on CFB: the CFB current week and only CFB weeks');
  setActiveSportKey('nfl');
  assert(getContextWeek().weekId === 'wn6' && eq(getContextWeeks().map((w) => w.weekId), ['wn5', 'wn6']), '[7b] on NFL: the NFL current week and only NFL weeks');
  assert(eq(getContextWeeks().map((w) => w.weekId), getWeeksForCompetition(CID.N).map((w) => w.weekId)), '[7c] getContextWeeks() is getWeeksForCompetition(context)');
  const copy = getContextWeeks(); copy.length = 0;
  assert(storage.getWeeks().length === 4, '[7d] mutating the result never touches the store (a read-only copy: DI-220\'s top risk)');
  assert(competitionForSport('nfl').id === CID.N && competitionForSport('nhl') === null, '[7e] competitionForSport finds a live sport and nothing else');
  // a member who plays only CFB is on CFB whatever the stored pointer says
  reset({ comps: [C.D, C.N], members: both, weeks, session: 'p2' });
  put('cfbp_active_sport', { local: { [LEAGUE]: 'nfl' } });
  assert(getContextWeek().weekId === 'wc6' && getContextCompetition().id === CID.D, '[7f] a CFB-only member never gets the NFL week from a stale pointer');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] the storage seam…');
{
  const stor = await readFile(join(HERE, 'js', 'storage.js'), 'utf8');
  const devSet = (stor.match(/const DEVICE_LOCAL_KEYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
  assert(/KEYS\.ACTIVE_SPORT/.test(devSet) && /KEYS\.DASHBOARD_SCOPE/.test(devSet), '[8a] the pointer and scope keys are DEVICE-LOCAL (never league data, never synced)');
  assert(!/KEYS\.COMPETITION_MEMBERS/.test(devSet), '[8b] competition_members is SHARED league data (not device-local)');
  assert(devSet.includes("'cfbp_active_sport'") === false && /ACTIVE_SPORT: 'cfbp_active_sport'/.test(stor), '[8c] the key is declared once, in KEYS');
  const src = await readFile(join(HERE, 'js', 'competition.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert(!/localStorage/.test(noComments), '[8d] competition.js never touches localStorage: every read and write of the pointer goes through the seam\'s accessors');
  // addCompetitionMember / removeCompetitionMember
  reset({ comps: [C.D, C.N], members: [], session: 'p2' });
  assert(storage.addCompetitionMember({ competitionId: CID.N, memberId: 'p2' }) === true, '[8e] addCompetitionMember inserts');
  assert(storage.addCompetitionMember({ competitionId: CID.N, memberId: 'p2' }) === false && storage.getCompetitionMembers().length === 1, '[8e] …idempotently (a second Join of the same pair changes nothing)');
  const row = storage.getCompetitionMembers()[0];
  assert(row.id === `${CID.N}:p2` && row.enrolledBy === 'self' && Number.isFinite(Date.parse(row.joinedAt)), `[8f] the local entry carries id, enrolledBy 'self' and a joinedAt for the mirror (${JSON.stringify(row)})`);
  assert(storage.addCompetitionMember({ competitionId: '', memberId: 'p2' }) === false && storage.addCompetitionMember({}) === false, '[8g] a blank pair is refused');
  assert(viewerPlaysCompetition(CID.N) === true, '[8h] the member now plays NFL (the roster reads the entry)');
  assert(storage.removeCompetitionMember({ competitionId: CID.N, memberId: 'p2' }) === true && storage.getCompetitionMembers().length === 0 && storage.removeCompetitionMember({ competitionId: CID.N, memberId: 'p2' }) === false, '[8i] removeCompetitionMember removes once');
  assert(storage.addCompetitionMember({ competitionId: CID.N, memberId: 'p2', enrolledBy: 'commissioner' }) && storage.getCompetitionMembers()[0].enrolledBy === 'commissioner', '[8j] a commissioner-enrolled entry says so');
  assert(storage.addCompetitionMember({ competitionId: CID.N, memberId: 'p3', enrolledBy: 'nonsense' }) && storage.getCompetitionMembers().find((r) => r.memberId === 'p3').enrolledBy === 'self', '[8k] an unknown enrolledBy is stored as self (the check constraint admits only two values)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[9] homeFeedContexts — the sports the Home feed spans (DI-528), the entrants of each (C4)…');
{
  const { homeFeedContexts } = comp;
  const NOW = Date.parse('2026-10-08T12:00:00.000Z');
  // (a) the single-sport rule: no contexts at all, so Home runs exactly as v0.29.0 did
  reset({ comps: [], weeks: [wk('w1')] });
  assert(homeFeedContexts({ now: NOW }) === null, '[9a] pre-backfill: no contexts (null)');
  reset({ comps: [C.D], weeks: [wk('w1')] });
  assert(homeFeedContexts({ now: NOW }) === null, '[9a] one competition: no contexts (null)');
  reset({ comps: [C.D, { ...C.N, archivedAt: '2026-09-01T00:00:00.000Z' }], weeks: [wk('w1')] });
  assert(homeFeedContexts({ now: NOW }) === null, '[9a] one live + one archived: no contexts (an archived sport is gone)');

  // (b) two sports, both live
  const members = [MEMBER(CID.N, 'p1', '2026-09-20T00:00:00.000Z'), MEMBER(CID.N, 'p3', '2026-09-20T00:00:00.000Z')];
  reset({
    comps: [C.D, C.N], members,
    weeks: [wk('w1', { weekNumber: 6, status: 'live' }), wk('w0', { weekNumber: 5, status: 'final' }), wk('wn1', { weekNumber: 4, status: 'open', competitionId: CID.N, picksLockAt: NFL_LOCK })],
  });
  const ctx = homeFeedContexts({ now: NOW });
  assert(Array.isArray(ctx) && ctx.length === 2 && ctx[0].competitionId === CID.D && ctx[1].competitionId === CID.N, `[9b] two live sports: two contexts, the default first (${JSON.stringify((ctx || []).map((c) => c.dbCode))})`);
  assert(eq(ctx[0].weekIds, ['w1', 'w0']) && eq(ctx[1].weekIds, ['wn1']), '[9b] each context owns ONLY its competition\'s weeks - no week appears in two');
  assert(eq(ctx[0].playerIds, ['p1', 'p2', 'p3', 'p4']) && eq(ctx[1].playerIds, ['p1', 'p3']),
    `[9b] C4: CFB (enrollment all) has every active member except the tournament-only guest, NFL (opt_in) only the two who joined - never the active roster (${JSON.stringify(ctx.map((c) => c.playerIds))})`);
  assert(ctx[0].currentWeekId === 'w1' && ctx[1].currentWeekId === 'wn1' && ctx[0].code === 'CFB' && ctx[1].code === 'NFL', '[9b] each context names its own current week and the code the chip prints');

  // (c) a non-default sport with no live week and nothing starting soon is not a context (R7); the default always is
  reset({
    comps: [C.D, C.N], members,
    weeks: [wk('w1', { status: 'final' }), wk('wn1', { status: 'final', competitionId: CID.N, startDate: '2026-01-01' })],
  });
  const quiet = homeFeedContexts({ now: NOW });
  assert(Array.isArray(quiet) && quiet.length === 1 && quiet[0].competitionId === CID.D, '[9c] an NFL competition with only final weeks contributes no context (R7); the default competition always does');
  // ...but it STILL makes the league multi-sport, so the cards that remain carry their chip
  assert(isMultiSport() === true, '[9c] ...and the league is still multi-sport (the chip stays on the CFB cards)');

  // (d) a draft-only NFL week starting within three days is a context (R7's lookahead)
  reset({
    comps: [C.D, C.N], members,
    weeks: [wk('w1', { status: 'live' }), wk('wn1', { status: 'draft', competitionId: CID.N, startDate: '2026-10-10' })],
  });
  const soon = homeFeedContexts({ now: NOW });
  assert(Array.isArray(soon) && soon.length === 2, '[9d] an NFL week that starts within three days is a context even while it is still a draft (the cards themselves hide a draft from members)');

  // (e) it reads, it never writes
  const before = JSON.stringify([...store.entries()].sort());
  homeFeedContexts({ now: NOW });
  assert(JSON.stringify([...store.entries()].sort()) === before, '[9e] homeFeedContexts() writes nothing');

  // (f) security N1 (Part 2 item 10, 2026-10-08): EACH WEEK'S entrants, not today's. `playerIds` is the roster as of NOW; a member who joined after an EARLIER week locked was never an entrant of
  // that week, so a pick row they hold there (the server admitted it) must count for nothing in that week's slice - which needs the per-week list.
  const LOCK1 = '2026-10-04T16:30:00.000Z', LOCK2 = '2026-10-11T16:30:00.000Z';
  const late = [MEMBER(CID.N, 'p1', '2026-09-20T00:00:00.000Z'), MEMBER(CID.N, 'p3', '2026-09-20T00:00:00.000Z'), MEMBER(CID.N, 'p4', '2026-10-07T00:00:00.000Z')];   // p4 joins AFTER week 1 locked, BEFORE week 2 locks
  reset({
    comps: [C.D, C.N], members: late,
    weeks: [wk('w1', { status: 'live' }), wk('wn1', { weekNumber: 1, status: 'final', competitionId: CID.N, picksLockAt: LOCK1 }), wk('wn2', { weekNumber: 2, status: 'open', competitionId: CID.N, picksLockAt: LOCK2 })],
  });
  const lateCtx = homeFeedContexts({ now: NOW }).find((c) => c.dbCode === 'nfl');
  assert(eq(lateCtx.playerIds, ['p1', 'p3', 'p4']), `[9f] playerIds stays the roster as of now (the late joiner is on it: he counts from his next week) (${JSON.stringify(lateCtx.playerIds)})`);
  assert(lateCtx.weekEntrants && eq(lateCtx.weekEntrants.wn1, ['p1', 'p3']) && eq(lateCtx.weekEntrants.wn2, ['p1', 'p3', 'p4']),
    `[9g] weekEntrants names each week's own entrants: the late joiner is NOT an entrant of the week that locked before he joined, and IS of the next (${JSON.stringify(lateCtx.weekEntrants)})`);
  assert(Object.keys(lateCtx.weekEntrants).sort().join() === 'wn1,wn2', '[9h] ...one list per week of THAT sport, none for the other sport\'s weeks');
  const defCtx = homeFeedContexts({ now: NOW }).find((c) => c.dbCode === 'cfb');
  assert(eq(defCtx.weekEntrants, { w1: ['p1', 'p2', 'p3', 'p4'] }), '[9i] an enrollment-all sport: every week\'s entrants are the whole roster');
}

console.log('\n' + (fail ? '❌ FAILURES' : '✅ ALL PASS') + ` — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
