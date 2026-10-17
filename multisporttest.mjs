/**
 * CFB Pickems - multisporttest.mjs
 * ================================
 * D1 (v0.30.0, thread 100726-D1, Lane A): the commissioner's multisport operations, pure half (js/multisport-admin.js) and the seam to the client branch (js/sport-seam.js).
 * DI-532 (Add a sport, archive), DI-533 (a week for a chosen sport), DI-534 (the all-sports card, Sport entries), DI-536 (slate size).
 *
 *   [1]  SHA-256 equals node:crypto's on every length around the block boundaries, and the derived competition id is a stable, well-formed v5-shaped UUID.
 *   [2]  addSportOptions - offered x profiles minus running sports; an archived sport is RESTORED (its own id), never duplicated; nothing left -> [] (no dead stub).
 *   [3]  newCompetitionRow - the deterministic id, opt_in / all, never a guessed enrollment, no `extra`.
 *   [4]  archiveBlocker - open / locked / live / pending finalization block; draft / final do not.
 *   [5]  nextActionFor - Open for picks, Lock, Finalize, Set up Week N, per sport, from the week alone.
 *   [6]  allSportsRows - one row per live competition, counts only (blind-safe), the lens flagged, an archived sport absent.
 *   [7]  sportEntriesModel - In / Not in, the removal block, "Counts from next week".
 *   [8]  The wizard helpers - per-competition week numbers, the NFL slate clamp, the tiebreaker game default (the LAST kickoff).
 *   [9]  The seam - with no client-branch API it answers the single-sport rule; with it, it defers; the lens validates against the live sports.
 *
 * Run: node multisporttest.mjs
 */
import { createHash } from 'node:crypto';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' }, hidden: false };
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in multisporttest'); };

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ms = await import('./js/multisport-admin.js');
const seam = await import('./js/sport-seam.js');
const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');
const { listProfiles } = await import('./js/sports/index.js');
const { NFL_PROFILE } = await import('./js/sports/nfl.js');
const { CFB_PROFILE } = await import('./js/sports/cfb.js');

console.log('\n[1] SHA-256 and the deterministic competition id');
{
  const hex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const inputs = ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(119), 'x'.repeat(120), 'x'.repeat(1000), 'café ☃ \u{1F3C8}', 'cfbp-competition:11111111-1111-1111-1111-111111111111:nfl:season'];
  const bad = inputs.filter((s) => hex(ms.sha256Bytes(s)) !== createHash('sha256').update(s, 'utf8').digest('hex'));
  assert(bad.length === 0, `[1a] sha256Bytes equals node:crypto on ${inputs.length} inputs around every block boundary (mismatches: ${bad.length})`);
  const L = '11111111-1111-1111-1111-111111111111';
  const id = ms.deterministicCompetitionId(L, 'nfl');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), `[1b] a well-formed UUID with the version (5) and variant bits set (${id})`);
  assert(id === ms.deterministicCompetitionId(L, 'nfl'), '[1c] stable: the same league and sport give the same id every time (a retry or a double tap writes the same row)');
  assert(id !== ms.deterministicCompetitionId(L, 'cfb') && id !== ms.deterministicCompetitionId('22222222-2222-2222-2222-222222222222', 'nfl'), '[1d] distinct per sport and per league');
  const raw = createHash('sha256').update(`cfbp-competition:${L}:nfl:season`).digest();
  const expect = Array.from(raw.subarray(0, 16)); expect[6] = (expect[6] & 0x0f) | 0x50; expect[8] = (expect[8] & 0x3f) | 0x80;
  const h = expect.map((x) => x.toString(16).padStart(2, '0')).join('');
  assert(id === `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, "[1e] it is sha256('cfbp-competition:' + leagueId + ':' + dbCode + ':season') with the v5 / variant bits set, exactly as DI-532 writes it");
}

console.log('\n[2] addSportOptions');
{
  const profiles = listProfiles();
  const base = { profiles };
  const cfbOnly = [{ id: 'c1', sport: 'cfb', isDefault: true }];
  let o = ms.addSportOptions({ ...base, offeredSports: ['cfb', 'nfl'], competitions: cfbOnly });
  assert(o.length === 1 && o[0].dbCode === 'nfl' && o[0].state === 'new' && o[0].competitionId === null && o[0].label === 'NFL' && o[0].listLabel === 'NFL', '[2a] a CFB-only league offered {cfb, nfl}: exactly NFL is addable, as a new sport');
  o = ms.addSportOptions({ ...base, offeredSports: ['cfb'], competitions: cfbOnly });
  assert(o.length === 0, '[2b] NFL not offered by the platform: nothing to add (no card, never a dead stub)');
  o = ms.addSportOptions({ ...base, offeredSports: ['cfb', 'nfl'], competitions: [...cfbOnly, { id: 'c2', sport: 'nfl' }] });
  assert(o.length === 0, '[2c] a league already running NFL: nothing left to add');
  o = ms.addSportOptions({ ...base, offeredSports: ['cfb', 'nfl'], competitions: [...cfbOnly, { id: 'c2', sport: 'nfl', archivedAt: '2026-10-01T00:00:00.000Z' }] });
  assert(o.length === 1 && o[0].state === 'archived' && o[0].competitionId === 'c2' && o[0].listLabel === 'NFL (archived, history kept)', '[2d] an ARCHIVED NFL is offered as "NFL (archived, history kept)" and carries its own competition id (restored, not duplicated)');
  o = ms.addSportOptions({ ...base, offeredSports: ['cfb', 'nfl', 'nba'], competitions: cfbOnly });
  assert(o.map((x) => x.dbCode).join() === 'nfl', '[2e] a sport the platform offers but has no registered profile (nba) never appears');
  assert(eq(ms.addSportOptions({}), []) && eq(ms.addSportOptions({ offeredSports: 'nfl', profiles, competitions: null }), []), '[2f] absent or malformed inputs answer [] and never throw');
}

console.log('\n[3] newCompetitionRow');
{
  const L = '11111111-1111-1111-1111-111111111111';
  const r = ms.newCompetitionRow({ leagueId: L, dbCode: 'nfl', enrollment: 'opt_in', seasonLabel: '2026' });
  assert(r.id === ms.deterministicCompetitionId(L, 'nfl') && r.sport === 'nfl' && r.kind === 'season' && r.enrollment === 'opt_in' && r.isDefault === false && r.archivedAt === null && eq(r.settings, {}) && r.seasonLabel === '2026',
    '[3a] opt_in NFL: the deterministic id, a season, not the default, not archived, empty settings');
  assert(!('extra' in r), '[3b] the row carries NO `extra` field (a competitions row has no such column: batch T)');
  assert(ms.newCompetitionRow({ leagueId: L, dbCode: 'nfl', enrollment: 'all' }).enrollment === 'all', '[3c] "Everyone in the league" is enrollment all');
  assert(ms.newCompetitionRow({ leagueId: L, dbCode: 'nfl', enrollment: 'maybe' }) === null && ms.newCompetitionRow({ leagueId: L, dbCode: 'nfl' }) === null && ms.newCompetitionRow({ dbCode: 'nfl', enrollment: 'all' }) === null,
    '[3d] an unknown or missing enrollment, league or sport is refused with null: never a guessed row');
  const restored = ms.newCompetitionRow({ leagueId: L, dbCode: 'nfl', enrollment: 'opt_in', existing: { id: 'old-id', settings: { weeklyGameCount: 9 }, seasonLabel: '2025', archivedAt: '2026-01-01T00:00:00.000Z' } });
  assert(restored.id === 'old-id' && restored.archivedAt === null && restored.settings.weeklyGameCount === 9 && restored.seasonLabel === '2025', '[3e] restoring an archived sport keeps its id and settings and clears archivedAt');
}

console.log('\n[4] archiveBlocker');
{
  const w = (status, extra = {}) => ({ weekId: status, status, ...extra });
  for (const st of ['open', 'locked', 'live']) assert(/has a week in progress/.test(ms.archiveBlocker({ weeks: [w(st)], label: 'NFL' }) || ''), `[4a-${st}] a ${st} week blocks the archive`);
  assert(ms.archiveBlocker({ weeks: [w('live', { pendingFinalization: true })], label: 'NFL' }) === 'NFL has a week in progress. Finish or re-open it first.', '[4b] the exact copy');
  assert(ms.archiveBlocker({ weeks: [w('draft'), w('final')], label: 'NFL' }) === null && ms.archiveBlocker({ weeks: [], label: 'NFL' }) === null, '[4c] drafts and finished weeks do not block; no weeks at all does not block');
  assert(ms.archiveBlocker({ weeks: [w('final', { pendingFinalization: true })] }) === null, '[4d] a final week is never "pending"');
}

console.log('\n[5] nextActionFor');
{
  const g = (status) => ({ status });
  assert(ms.nextActionFor({ week: null, nextWeekNumber: 7 }).label === 'Set up Week 7', '[5a] no week: Set up Week {N}');
  assert(ms.nextActionFor({ week: { status: 'final' }, nextWeekNumber: 8 }).kind === 'setup', '[5b] a final week: set up the next');
  assert(ms.nextActionFor({ week: { status: 'draft' } }).label === 'Open for picks', '[5c] a draft: Open for picks');
  assert(ms.nextActionFor({ week: { status: 'open' } }).label === 'Lock', '[5d] an open week: Lock');
  assert(ms.nextActionFor({ week: { status: 'live' }, games: [g('final'), g('live')] }) === null, '[5e] a live week with a game still going: no button');
  assert(ms.nextActionFor({ week: { status: 'live' }, games: [g('final'), g('final')] }).label === 'Finalize', '[5f] every game final: Finalize');
  assert(ms.nextActionFor({ week: { status: 'locked', pendingFinalization: true }, games: [] }).label === 'Finalize', '[5g] pending finalization: Finalize');
  assert(ms.nextActionFor({ week: { status: 'live' }, games: [] }) === null, '[5h] a live week with no games is not "all final"');
}

console.log('\n[6] allSportsRows');
{
  const comps = [{ id: 'cA', sport: 'cfb', isDefault: true }, { id: 'cB', sport: 'nfl' }, { id: 'cC', sport: 'nfl', archivedAt: 'x' }];
  const weeks = { cA: [{ weekId: 'wa', weekNumber: 6, status: 'locked' }], cB: [{ weekId: 'wb5', weekNumber: 5, status: 'final' }, { weekId: 'wb', weekNumber: 6, status: 'open' }] };
  const games = { wa: [{ kickoff: '2026-10-10T18:00:00Z', status: 'scheduled' }], wb: [{ kickoff: '2026-10-11T17:00:00Z', status: 'scheduled' }] };
  const people = [{ playerId: 'p1' }, { playerId: 'p2' }, { playerId: 'p3' }];
  const readers = {
    currentWeekFor: (id) => (weeks[id] ? weeks[id][weeks[id].length - 1] : null), gamesFor: (id) => games[id] || [], weeksFor: (id) => weeks[id] || [],
    entrantsFor: () => people, submittedFor: (wid, pid) => (wid === 'wb' ? pid !== 'p3' : null),
    lockState: (w) => ({ phase: w.status, label: w.status === 'open' ? 'Open' : w.status, lockAtMs: w.status === 'open' ? Date.parse('2026-10-11T16:30:00Z') : null }), formatTime: (ms2) => `T${ms2}`,
  };
  const rows = ms.allSportsRows({ competitions: comps, profiles: listProfiles(), readers, lensDbCode: 'nfl' });
  assert(rows.length === 2 && rows.map((r) => r.code).join() === 'CFB,NFL', '[6a] one row per LIVE competition, default first; the archived NFL competition is absent');
  const nfl = rows[1];
  assert(nfl.weekNumber === 6 && nfl.status === 'open' && nfl.inCount === 2 && nfl.entrantCount === 3 && nfl.showCounts === true && nfl.action.label === 'Lock' && nfl.isLens === true, '[6b] the NFL row: Week 6, open, "2 of 3 in", the Lock button, flagged as the lens');
  assert(/^Locks T/.test(nfl.timeLabel) && ms.nextDeadlinesLine(rows) === `Next: NFL locks T${Date.parse('2026-10-11T16:30:00Z')}.`, '[6c] the open week shows its lock time; the deadlines line names it');
  const cfb = rows[0];
  assert(cfb.status === 'locked' && cfb.showCounts === false && cfb.inCount === null && cfb.action === null && /^Kicks off T/.test(cfb.timeLabel), '[6d] the college row: locked, NO counts (counts exist only while a week is open), no button until the games finish, the kickoff time');
  const none = ms.allSportsRows({ competitions: [{ id: 'cZ', sport: 'nfl' }], profiles: listProfiles(), readers: { ...readers, currentWeekFor: () => null, weeksFor: () => [] } })[0];
  assert(none.status === 'none' && none.statusLabel === 'NO WEEK' && none.action.label === 'Set up Week 1' && none.weekId === null, '[6e] a sport with no week: NO WEEK and Set up Week 1');
  // S2: any unknown entrant => NO count at all (never "2 of 3" when the third is only unknown)
  const unk = ms.allSportsRows({ competitions: comps, profiles: listProfiles(), readers: { ...readers, submittedFor: (wid, pid) => (wid === 'wb' ? (pid === 'p3' ? null : pid === 'p1') : null) }, lensDbCode: 'nfl' })[1];
  assert(unk.inCount === null && unk.showCounts === false && unk.entrantCount === 3, '[6g] S2: when any entrant\'s answer is unknown the row shows NO "k of n in" count (a number would read as "missing" for someone who may be in)');
  const all = ms.allSportsRows({ competitions: comps, profiles: listProfiles(), readers: { ...readers, submittedFor: () => true }, lensDbCode: 'nfl' })[1];
  assert(all.inCount === 3 && all.showCounts === true, '[6h] ...and with every answer known the count returns');
  // S13: the deadlines line leads with the soonest lock, whatever order the sports are listed in
  const t1 = Date.parse('2026-10-11T16:30:00Z'), t2 = Date.parse('2026-10-10T16:30:00Z');
  const mk = (code, at) => ({ code, status: 'open', timeLabel: `Locks T${at}`, lockAtMs: at });
  assert(ms.nextDeadlinesLine([mk('CFB', t1), mk('NFL', t2)]) === `Next: NFL locks T${t2}. CFB locks T${t1}.`, '[6i] S13: the deadlines line is soonest first (NFL before CFB here, though CFB is listed first)');
  assert(ms.nextDeadlinesLine([mk('A', t1), mk('B', t1), mk('C', t2)]) === `Next: C locks T${t2}. A locks T${t1}. B locks T${t1}.`, '[6j] ...equal instants keep their listed order');
  assert(ms.nextDeadlinesLine([{ code: 'X', status: 'open', timeLabel: 'Locks later', lockAtMs: null }, mk('Y', t1)]) === `Next: Y locks T${t1}. X locks later.`, '[6k] ...and a row with no known lock instant sorts last');
  const json = JSON.stringify(rows);
  assert(!/selected|pick"|tiebreakerGuess/i.test(json.replace(/pickCount/g, '')), '[6f] the rows hold ids, labels and counts - never a pick');
}

console.log('\n[7] sportEntriesModel');
{
  const comp = { id: 'cB', sport: 'nfl', enrollment: 'opt_in' };
  const members = [{ playerId: 'p1', displayName: 'Ann', active: true }, { playerId: 'p2', displayName: 'Ben', active: true }, { playerId: 'p3', displayName: 'Cal', active: true }, { playerId: 'px', displayName: 'Gone', active: false }];
  const lock = Date.parse('2026-10-11T16:30:00Z');
  const rows = [{ memberId: 'p1', joinedAt: '2026-10-01T00:00:00Z', enrolledBy: 'self' }, { memberId: 'p2', joinedAt: '2026-10-11T18:00:00Z', enrolledBy: 'commissioner' }];
  const m = ms.sportEntriesModel({ competition: comp, members, entryRows: rows, currentLockAtMs: lock, hasPicksInProgress: (id) => id === 'p1', label: 'NFL' });
  assert(m.rows.length === 3 && m.rows.map((r) => r.isIn).join() === 'true,true,false' && m.caption === 'Who plays NFL', '[7a] every ACTIVE member a row; In for the entrants, Not in for the rest; the inactive member is absent');
  assert(m.rows[0].canRemove === false && m.rows[0].blockReason === 'Ann has picks in a week that is in progress.', '[7b] removing a member with picks in a week in progress is BLOCKED with the exact copy');
  assert(m.rows[1].canRemove === true && m.rows[1].note === 'Counts from next week', '[7c] a commissioner-inserted row created after the lock reads "Counts from next week" and can be removed');
  assert(m.rows[0].note === '' && eq(m.notInIds, ['p3']), '[7d] an early entrant carries no note; "Add everyone" has exactly the Not-in ids');
  assert(ms.sportEntriesModel({ competition: { id: 'x', sport: 'cfb', enrollment: 'all' }, members }) === null && ms.sportEntriesModel({}) === null, '[7e] an enrollment-all sport has no entries card (null)');
}

console.log('\n[8] wizard helpers');
{
  assert(ms.nextWeekNumberFor([{ weekNumber: 5 }, { weekNumber: 6 }]) === 7 && ms.nextWeekNumberFor([]) === 1 && ms.nextWeekNumberFor(null) === 1, '[8a] the next week number is max + 1 over ONE competition\'s weeks (1 when it has none)');
  assert(ms.slateSizeFor(NFL_PROFILE) === 10 && ms.slateSizeFor(NFL_PROFILE, 8) === 8 && ms.slateSizeFor(NFL_PROFILE, 3) === 8 && ms.slateSizeFor(NFL_PROFILE, 99) === 10 && ms.slateSizeFor(NFL_PROFILE, 'abc') === 10 && ms.slateSizeFor(NFL_PROFILE, '9') === 9,
    '[8b] the NFL slate is 8..10, default 10: a request is clamped into the range, junk is the default');
  assert(ms.slateSizeFor(CFB_PROFILE) === 10 && ms.slateSizeFor(null) === 10, '[8c] college football (and no profile) is 10, unchanged');
  const games = [{ gameId: 'g1', kickoff: '2026-10-11T17:00:00Z', awayTeam: 'A', homeTeam: 'B' }, { gameId: 'g3', kickoff: '2026-10-13T00:15:00Z', awayTeam: 'Detroit Lions', homeTeam: 'Green Bay Packers' }, { gameId: 'g2', kickoff: '2026-10-11T20:25:00Z', awayTeam: 'C', homeTeam: 'D' }];
  const opts = ms.tiebreakerGameOptions(games);
  assert(opts[0].gameId === 'g3' && opts[0].isDefault === true && opts[0].label === 'Detroit Lions at Green Bay Packers' && opts.filter((o) => o.isDefault).length === 1, '[8d] the default tiebreaker game is the LAST kickoff on the slate (Monday night), listed first');
  const f = ms.tiebreakerFieldsFor({ week: { weekId: 'w' }, game: games[1], profile: NFL_PROFILE, questionFor: dm.tiebreakerQuestionFor });
  assert(f.tiebreakerGameId === 'g3' && f.tiebreakerType === 'custom' && f.tiebreakerCalculationMode === 'manual' && f.tiebreakerQuestion === 'What is the total combined points scored in Detroit Lions at Green Bay Packers?',
    '[8e] the fields a choice writes: the game id, custom / manual (existing CHECK values) and the question naming the matchup');
  assert(dm.tiebreakerQuestionFor(CFB_PROFILE) === CFB_PROFILE.tiebreakerDefault.question && dm.tiebreakerQuestionFor(null) === null, '[8f] a college profile\'s question is returned as written; no profile is null');
}

console.log('\n[8b] suggestSlateFor (the NFL slate: Sunday and Monday, by kickoff, no alma / rank / conference signal)');
{
  // Real ET weekdays: 2026-10-11 is a Sunday, 10-12 a Monday, 10-08 a Thursday, 10-10 a Saturday.
  const g = (id, iso) => ({ gameId: id, kickoff: iso, homeTeam: `H${id}`, awayTeam: `A${id}` });
  const cands = [
    g('thu', '2026-10-09T00:15:00Z'),                                   // Thursday 8:15 PM ET (Oct 8 ET)
    g('sat', '2026-10-10T20:00:00Z'),                                   // Saturday
    ...Array.from({ length: 11 }, (_, i) => g(`sun${i}`, new Date(Date.parse('2026-10-11T17:00:00Z') + i * 1800000).toISOString())),
    g('snf', '2026-10-12T00:20:00Z'),                                   // Sunday night 8:20 PM ET - Monday in UTC
    g('mnf', '2026-10-13T00:15:00Z'),                                   // Monday night 8:15 PM ET
    { gameId: 'tbd', kickoff: null },
  ];
  const r = ms.suggestSlateFor({ profile: NFL_PROFILE, candidates: cands });
  assert(r.slate.length === 10 && r.slate.every((x) => !['thu', 'sat', 'tbd'].includes(x.gameId)), '[8b-a] ten games; a Thursday, a Saturday and a game with no kickoff are NOT in the default slate');
  assert(r.slate.map((x) => Date.parse(x.kickoff)).every((t, i, a) => i === 0 || t >= a[i - 1]), '[8b-b] in kickoff order');
  assert(ms.weekdayKeyET('2026-10-12T00:20:00Z') === 'sun' && ms.weekdayKeyET('2026-10-13T00:15:00Z') === 'mon' && ms.weekdayKeyET('2026-10-09T00:15:00Z') === 'thu' && ms.weekdayKeyET('nope') === '', '[8b-c] weekdays are read in Eastern time: Sunday night\'s 8:20 PM kickoff is a Sunday game though it is Monday in UTC');
  const r8 = ms.suggestSlateFor({ profile: NFL_PROFILE, candidates: cands, size: 8 });
  assert(r8.slate.length === 8, '[8b-d] the commissioner can choose 8');
  assert(ms.suggestSlateFor({ profile: NFL_PROFILE, candidates: cands, size: 3 }).slate.length === 8 && ms.suggestSlateFor({ profile: NFL_PROFILE, candidates: cands, size: 40 }).slate.length === 10, '[8b-e] the choice is clamped to the profile\'s 8..10');
  const few = ms.suggestSlateFor({ profile: NFL_PROFILE, candidates: cands.filter((x) => ['thu', 'sat', 'sun0', 'sun1', 'mnf'].includes(x.gameId)) });
  assert(few.slate.map((x) => x.gameId).join() === 'sun0,sun1,mnf', '[8b-f] fewer Sunday/Monday games than the size: a SHORT slate, never padded with Thursday or Saturday');
  assert(r.shortlist.some((x) => x.gameId === 'sat' || x.gameId === 'thu') === false || r.shortlist.every((x) => x.gameId !== 'tbd'), '[8b-g] the shortlist never holds a game with no kickoff');
  assert(ms.suggestSlateFor({ profile: null, candidates: [] }).slate.length === 0, '[8b-h] nothing to suggest is an empty slate, not a throw');
}

console.log('\n[9] the seam');
{
  store.clear();
  storage.setSession(null, false, false);
  // RE-DERIVED 2026-10-08 (merge). OLD: "the seam reports whether the client branch's API is present (both answers are valid; the rest holds either way)" - true on a tree with the client's competition.js,
  // false on the server branch alone. NEW: the two are one tree, so only ONE answer is valid; the fallbacks in the seam are dead belts.
  assert(seam.sportSeamBackedByClientBranch() === true, '[9a] the seam is BACKED by competition.js (playersForWeek, isMultiSport, getActiveSportKey, setActiveSportKey all present): its fallbacks are dead code');
  assert(seam.isMultiSportLeague() === false && seam.liveCompetitions().length === 0, '[9b] pre-backfill (no competition rows): not multi-sport');
  storage.addPlayer({ playerId: 'p1', displayName: 'Ann', active: true, almaMater: 'A' }); storage.addPlayer({ playerId: 'p2', displayName: 'Ben', active: false, almaMater: 'B' });
  const ents = seam.entrantsForWeek({ weekId: 'w', competitionId: null });
  assert(ents.length >= 1 && ents.every((p) => p.active), '[9c] entrantsForWeek answers every ACTIVE player under the single-sport rule (never nobody)');
  storage.saveCompetition({ id: 'cA', sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  storage.saveCompetition({ id: 'cB', sport: 'nfl', enrollment: 'opt_in', kind: 'season' });
  assert(seam.isMultiSportLeague() === true && seam.liveCompetitions().map((c) => c.sport).join() === 'cfb,nfl', '[9d] two non-archived competitions: multi-sport');
  // D1 third pass (DI-534 REV 5 (b)): the lens below is moved by a VERIFIED COMMISSIONER (Ann; she plays no opt-in NFL, so the NFL lens is a separate one). Moved by nobody - the session the
  // section opened with - it is refused, which sportsurfacetest [L-d] pins.
  storage.setSession('p1', true, true);
  assert(seam.getLensSport() === 'cfb', '[9e] the lens starts on the default sport');
  assert(seam.setLensSport('nfl') === true && seam.getLensSport() === 'nfl' && seam.lensCompetition().id === 'cB', '[9f] the lens moves to a sport the league runs');
  assert(seam.setLensSport('nba') === false && seam.getLensSport() === 'nfl', '[9g] a sport the league does not run is refused and the lens stays');
  storage.saveCompetition({ id: 'cB', sport: 'nfl', enrollment: 'opt_in', kind: 'season', archivedAt: '2026-10-01T00:00:00.000Z' });
  assert(seam.getLensSport() === 'cfb', '[9h] a lens on a sport that is then ARCHIVED falls back to the default (a stale pointer is never followed)');
  // ADDED 2026-10-08 (coordinator: resetLensSport() is called ONCE, from onContextSwitch - the archive path no longer calls it): a local lens that went stale is FORGOTTEN, so restoring the sport later does
  // not silently put Comm back on it.
  storage.saveCompetition({ id: 'cB', sport: 'nfl', enrollment: 'opt_in', kind: 'season', archivedAt: null });
  assert(seam.getLensSport() === 'cfb', '[9h2] ...and when that sport is RESTORED the lens does not resurrect: it stays on the default until the commissioner chooses the sport again');
  seam.resetLensSport();
  storage.saveCompetition({ id: 'cB', sport: 'nfl', enrollment: 'opt_in', kind: 'season' });
  const w = { weekId: 'wn', weekNumber: 6, status: 'open', season: '2026', competitionId: 'cB' };
  storage.saveWeek(w);
  seam.setLensSport('nfl');
  assert(seam.lensWeek()?.weekId === 'wn', '[9i] lensWeek() is the lens sport\'s current week (through getCurrentWeekFor, the one resolver)');
  seam.setLensSport('cfb');
  assert(seam.lensWeek(null) === null, '[9j] the college lens, with no college week, is null - never the NFL\'s week');
}

console.log('\n[2b] addSportRowSubtitle - the overview row\'s words come from the options (Part 2 item 4)');
{
  const o = (code, state = 'new') => ({ dbCode: code.toLowerCase(), label: code, code, state, competitionId: null, listLabel: code });
  assert(ms.addSportRowSubtitle([]) === '' && ms.addSportRowSubtitle(null) === '', '[2b-a] nothing to add: no words (and so no row)');
  assert(ms.addSportRowSubtitle([o('NFL')]) === 'NFL is available for this league', '[2b-b] one option: "NFL is available for this league"');
  assert(ms.addSportRowSubtitle([o('NFL'), o('NHL')]) === 'NFL and NHL are available for this league', '[2b-c] two options: "NFL and NHL are available for this league"');
  assert(ms.addSportRowSubtitle([o('NFL'), o('NHL'), o('MLB')]) === 'NFL, NHL and MLB are available for this league', '[2b-d] three: a list with "and" last');
  assert(ms.addSportRowSubtitle([o('NFL', 'archived')]) === 'NFL is available for this league', '[2b-e] an archived sport the commissioner can restore reads the same');
}

console.log('\n[9b] the ONE "k of n in" rule (inCountOf / inCountText) - merge 2026-10-08: the all-sports row and the overview card used to carry a copy each');
{
  const E = [{ playerId: 'a' }, { playerId: 'b' }, { playerId: 'c' }];
  const ans = (m) => (pid) => m[pid];
  assert(eq(ms.inCountOf(E, ans({ a: true, b: false, c: true })), { inCount: 2, entrantCount: 3 }) && ms.inCountText(ms.inCountOf(E, ans({ a: true, b: false, c: true }))) === '2 of 3 in', '[9b-a] every answer known: "2 of 3 in", counted over the entrants handed in');
  assert(ms.inCountOf(E, ans({ a: true, b: false })) === null && ms.inCountOf(E, ans({ a: true, b: undefined, c: false })) === null && ms.inCountOf(E, ans({ a: 'yes', b: true, c: true })) === null, '[9b-b] ANY unknown answer (undefined, null or a non-boolean) means NO count: a number would read as "missing" for someone who may be in');
  assert(ms.inCountOf([], ans({})) === null && ms.inCountOf(null, ans({})) === null && ms.inCountOf(E, null) === null && ms.inCountText(null) === '' && ms.inCountText({ inCount: NaN, entrantCount: 3 }) === '', '[9b-c] nobody to count (or no reader) is no count, never "0 of 0 in"; the text of no count is empty');
  assert(ms.inCountOf([null, { playerId: 'a' }], ans({ a: true })).entrantCount === 1, '[9b-d] a null entry in the roster is skipped, never counted');
}

console.log('\n[10] addSportAction and archiveSportAction (the orchestration, over injected deps)');
{
  const L = '11111111-1111-1111-1111-111111111111';
  const mk = () => { const rows = new Map(); const entries = []; const posts = []; return { rows, entries, posts, deps: {
    saveCompetition: (r) => rows.set(r.id, r), addEntry: (cid, mid, by) => { entries.push([cid, mid, by]); return true; }, announce: (b) => { posts.push(b); return true; } } }; };
  const opt = { dbCode: 'nfl', label: 'NFL', state: 'new', competitionId: null };
  let m = mk();
  let r = ms.addSportAction({ leagueId: L, leagueName: 'IRB Football', option: opt, enrollment: 'opt_in', commissionerMemberId: 'p1', announce: true, deps: m.deps });
  assert(r.ok && m.rows.size === 1 && r.row.enrollment === 'opt_in' && eq(m.entries, [[r.competitionId, 'p1', 'commissioner']]) && r.entryAdded && r.announced, '[10a] opt_in: one competition row, the commissioner\'s own entry, and the announcement');
  assert(m.posts[0] === 'NFL is now part of IRB Football. Picks open when the commissioner publishes the first week.', '[10b] the announcement is the exact DI-532 sentence');
  const again = ms.addSportAction({ leagueId: L, leagueName: 'IRB Football', option: opt, enrollment: 'opt_in', commissionerMemberId: 'p1', announce: false, deps: m.deps });
  assert(again.ok && again.competitionId === r.competitionId && m.rows.size === 1, '[10c] a retry or a double tap writes the SAME row: still one competition, never a duplicate sport');
  m = mk();
  r = ms.addSportAction({ leagueId: L, option: opt, enrollment: 'all', commissionerMemberId: 'p1', deps: m.deps });
  assert(r.ok && r.row.enrollment === 'all' && m.entries.length === 0 && r.entryAdded === false && r.announced === false, '[10d] "Everyone in the league": enrollment all, NO per-member row, no announcement unless asked');
  m = mk(); m.deps.saveCompetition = () => { throw new Error('refused by the server'); };
  r = ms.addSportAction({ leagueId: L, option: opt, enrollment: 'opt_in', commissionerMemberId: 'p1', announce: true, deps: m.deps });
  assert(r.ok === false && r.error === "Couldn't add NFL. Nothing was changed. Try again." && m.entries.length === 0 && m.posts.length === 0, '[10e] a refused save: the exact failure copy, and NOTHING else was attempted (no entry, no announcement)');
  m = mk(); m.deps.addEntry = () => { throw new Error('entry refused'); }; m.deps.announce = () => { throw new Error('chat down'); };
  r = ms.addSportAction({ leagueId: L, option: opt, enrollment: 'opt_in', commissionerMemberId: 'p1', announce: true, deps: m.deps });
  assert(r.ok && m.rows.size === 1 && r.entryAdded === false && r.announced === false, '[10f] a failed entry or announcement does not undo the sport: it is added and the two failures are reported');
  assert(ms.addSportAction({ leagueId: L, option: opt, enrollment: 'maybe', deps: m.deps }).ok === false, '[10g] an unknown enrollment is refused');
  const restored = ms.addSportAction({ leagueId: L, option: { ...opt, state: 'archived', competitionId: 'old' }, enrollment: 'opt_in', existing: { id: 'old', archivedAt: 'x', settings: {} }, deps: mk().deps });
  assert(restored.ok && restored.competitionId === 'old' && restored.row.archivedAt === null, '[10h] restoring an archived sport reuses its id and clears archivedAt');
  // archive
  const c = { id: 'cB', sport: 'nfl', enrollment: 'opt_in', isDefault: false };
  const saved = []; const dep = { saveCompetition: (x) => saved.push(x) };
  assert(ms.archiveSportAction({ competition: c, weeks: [{ status: 'open' }], label: 'NFL', deps: dep }).ok === false && saved.length === 0, '[10i] archive is REFUSED while a week is open, and nothing is written');
  const ok = ms.archiveSportAction({ competition: c, weeks: [{ status: 'final' }, { status: 'draft' }], label: 'NFL', now: () => '2026-10-08T00:00:00.000Z', deps: dep });
  assert(ok.ok && saved.length === 1 && saved[0].archivedAt === '2026-10-08T00:00:00.000Z' && saved[0].id === 'cB' && saved[0].sport === 'nfl', '[10j] archiving sets archivedAt on the same row and deletes nothing');
  assert(ms.archiveSportAction({ competition: { ...c, isDefault: true }, weeks: [], label: 'CFB', deps: dep }).ok === false, '[10k] the league\'s main (default) sport is never archived from here');
  assert(ms.archiveSportAction({ competition: c, weeks: [], label: 'NFL', deps: { saveCompetition: () => { throw new Error('x'); } } }).ok === false, '[10l] a refused archive write reports failure');
}

console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
