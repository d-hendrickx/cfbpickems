/**
 * CFB Pickems — projectiontest.mjs (Phase III, Step 2, §5.2 B2)
 * =================================================================
 * MANDATORY per the Step 2 design input. Run:
 *
 *   node projectiontest.mjs
 *   TZ=UTC node projectiontest.mjs && TZ=America/Los_Angeles node projectiontest.mjs
 *
 * Covers:
 *   [1]  fromRows(toRows(v)) round-trips for every key in KEY_TABLES, on
 *        (a) a factory-built fixture, (b) an "old Sheet row" fixture with
 *        fields entirely ABSENT, (c) a fixture carrying an unknown extra
 *        field (must survive via `extra`).
 *   [2]  canonicalize() is order-insensitive (for id-bearing record arrays)
 *        and stable across repeated calls.
 *   [3]  toIso() is a no-op on `toISOString()` output.
 *   [3b] export-sheet.mjs's exportAll() against a LOCAL fixture HTTP server
 *        (paging, per-player scribeMemoryList/notifyLog scoping) — NEVER the
 *        real Apps Script backend.
 *   [4]  The importer's upsert planner is idempotent against an in-memory
 *        mock of `import_rows` — two runs produce an identical mock state.
 *   [5]  Member-ref hard stop (checkMemberRefs) fires on a bad reference and
 *        passes clean on a good one.
 *   [6]  verifyImport/verifyMessages/verifySeasonArchive report ✅ against a
 *        freshly-imported mock, and a tampered mock produces a ❌ / nonzero
 *        exit.
 *   [7]  computeResultsDrift: exit 0 on a fixture that matches, exit 3 on a
 *        tampered one.
 *   [8]  crossCheckBackup passes on a matching Full Backup, fails on a stale
 *        one.
 *   [9]  --dry-run against a mock endpoint (simulated: the importer functions
 *        run without invoking any client write) produces the verification
 *        table with diff=0 on a fixture export, and a nonzero exit on a
 *        tampered one (the same [6] proof, restated as the CLI's contract).
 *   [10] The real CLI, invoked as a child process with
 *        SUPABASE_SERVICE_ROLE_KEY unset, exits 2 — proving `main()` is
 *        wired without this suite ever holding a real key.
 *   [13] The two comparator defects from Drew's FIRST REAL IMPORT
 *        (2026-09-18), both reported as `count=N db=N hash=MISMATCH`:
 *        (a) a kickoff string with no seconds vs. the `ts` column's
 *        normalized form, and (b) the notify-log / notification `actor`
 *        object landing in a `text` column. Written against the projection
 *        module alone, and it models the Postgres column coercion the mock
 *        client cannot.
 */

import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { exportAll } from './supabase/import/export-sheet.mjs';

import { createPlayer, createWeek, createGame, createPick } from './js/data-model.js';
import {
  KEY_TABLES, toRows, fromRows, canonicalize, toIso, stripCredentials, normalizeForCompare,
  messageToRow, rowToMessage, memoryToRow, rowToMemory, notifyLogToRow, rowToNotifyLog,
  actorToColumn, actorFromColumn,
} from './js/supabase-projection.js';
import {
  buildRowsForImport, applyRowsByTable, MockImportRowsClient, parseImportRowsSchema,
  buildMemberIdMap, checkMemberRefs, verifyImport, verifyMessages, verifyNotifyLog,
  verifyScribeMemory, verifySeasonArchive,
  computeResultsDrift, crossCheckBackup, findOrphans, EXIT,
} from './supabase/import/import-backup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── the JS<->SQL seam (REV F3/F4) ─────────────────────────────────────────
// Every mock client below is constructed WITH the column lists parsed out of
// the real `0003_functions.sql`, so every suite in this file is also asserting
// that what the projection emits is what `import_rows` will actually accept.
// Without this, a key the SQL does not name is dropped silently by
// jsonb_to_recordset and BOTH sides of the round-trip hash end up missing the
// same field — the test passes while the data is gone.
const FUNCTIONS_SQL_PATH = path.join(__dirname, 'supabase', 'migrations', '0003_functions.sql');
const SCHEMA = parseImportRowsSchema(readFileSync(FUNCTIONS_SQL_PATH, 'utf8'));
const newMock = () => new MockImportRowsClient({ schema: SCHEMA });

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
function deepEqual(a, b) { return canonicalize(a) === canonicalize(b); }

const CTX = { leagueId: 'L1', memberIds: new Set(['p1', 'p2', 'p3']) };

// ─── [1] round-trip fixtures, per key ──────────────────────────────────────
console.log('\n[1] Round-trip fromRows(toRows(v)) === v (or stripCredentials(v) for the two credentialed keys)…');

function roundTrip(key, value, ctx = CTX) {
  const rows = toRows[key](value, ctx);
  return fromRows[key](rows, ctx);
}

// (a) factory-built fixtures ------------------------------------------------
const week1 = createWeek('2026', 1, '2026-08-28', '2026-09-01');
const game1 = createGame(week1.weekId, { homeTeam: 'Alpha', awayTeam: 'Beta', spread: -3.5, favorite: 'Alpha' });
const pick1 = createPick(week1.weekId, game1.gameId, 'p1', 'Alpha');
const player1 = createPlayer('Ann', 'ann@example.com', '1234', 'Ohio State', 'AC');

assert(deepEqual(roundTrip('cfbp_weeks', [week1]), [week1]), 'weeks: factory fixture round-trips exactly');
assert(deepEqual(roundTrip('cfbp_games', [game1]), [game1]), 'games: factory fixture round-trips exactly');
assert(deepEqual(roundTrip('cfbp_picks', [pick1]), [pick1]), 'picks: factory fixture round-trips exactly');
{
  const stripped = stripCredentials('cfbp_players', [player1]);
  assert(deepEqual(roundTrip('cfbp_players', [player1]), stripped),
    'players: factory fixture round-trips to itself MINUS pinHash (credential stripped by design)');
  assert(!('pinHash' in roundTrip('cfbp_players', [player1])[0]), 'players: pinHash never reappears after round-trip');
}
// REV F6 + DI-T7.7 — email is canonicalized (lower-cased) ON THE WAY OUT, so the importer and the
// app agree on the stored bytes and a re-import is a genuine no-op. DI-T7.7 (approved 2026-09-17)
// then DELETED the `extra.__email_case` marker that used to preserve the original spelling:
// `extra` is a MEMBER-READABLE column, so for any founder whose Sheet address had a capital letter
// the marker left a full readable copy of that address one `select` away from all five co-members
// — defeating DI-T7.1's revoke of the `email` column by parking the value next door.
//
// So the round trip is no longer byte-exact on `cfbp_players`; it is EXACT MODULO EMAIL CASE, and
// this section says so out loud rather than asserting a weaker equality and hoping a reader
// notices. The other half of that decision is `normalizeForCompare()`, which the importer's
// verifier applies to BOTH sides before hashing — without it the first re-import of a mixed-case
// founder reports a false diff and the importer exits 1, refusing a perfectly good import over a
// capital letter. Both halves are asserted here, together, because either alone is a defect.
{
  const mixed = { ...createPlayer('Cap', 'Ann.Capital@Example.COM', '9999', 'Ohio State', 'CA'), playerId: 'p_mixed' };
  const row = toRows.cfbp_players([mixed], CTX).league_members[0];
  assert(row.email === 'ann.capital@example.com', 'players: email is lower-cased in the written row (REV F6)');
  assert(!('__email_case' in row.extra),
    'players: and NOTHING is written into extra to remember the original spelling (DI-T7.7 — extra is member-readable)');
  assert(!JSON.stringify(row.extra).includes('@'),
    'players: extra carries no address-shaped value at all for a mixed-case player (the invariant, not just the one key)');

  const restored = roundTrip('cfbp_players', [mixed])[0];
  assert(restored.email === 'ann.capital@example.com',
    'players: the round trip returns the LOWER-CASED address — the original spelling is gone by design, not by accident');
  assert(!deepEqual(restored, stripCredentials('cfbp_players', [mixed])[0]),
    'players: so a mixed-case player does NOT round-trip byte-for-byte any more (if this ever passes again, the marker is back)');

  // …and THIS is what makes that acceptable: the importer's verifier normalizes both sides, so the
  // two hashes it compares are equal. Exactly the comparison verifyImport performs.
  assert(canonicalize(normalizeForCompare('cfbp_players', [mixed]))
    === canonicalize(normalizeForCompare('cfbp_players', [restored])),
    'players: normalizeForCompare() makes the Sheet side and the Supabase side hash IDENTICALLY (the both-sides rule DI-T7.7 requires)');
  assert(canonicalize(stripCredentials('cfbp_players', [mixed]))
    !== canonicalize(stripCredentials('cfbp_players', [restored])),
    'players: and it is load-bearing — with stripCredentials alone (the old normalizer) the same pair hashes DIFFERENTLY, which is the false diff that would refuse the import');
  assert(!('pinHash' in normalizeForCompare('cfbp_players', [mixed])[0]),
    'players: normalizeForCompare still strips credentials (it wraps stripCredentials, it does not replace it)');

  // A re-import must produce the SAME row bytes — that is the property the lower-casing exists for,
  // and it is now true WITHOUT the marker, because both passes lower-case unconditionally.
  const row2 = toRows.cfbp_players([restored], CTX).league_members[0];
  assert(deepEqual(row, row2), 'players: re-projecting the restored object yields an identical row (re-import is a no-op)');
  const restored2 = roundTrip('cfbp_players', [restored])[0];
  assert(deepEqual(restored, restored2),
    'players: and the SECOND round trip is byte-exact — the case change happens once, on the way in, and never again (idempotent)');

  const already = { ...createPlayer('Low', 'low@example.com', '1', '', 'LO'), playerId: 'p_low' };
  const lowRow = toRows.cfbp_players([already], CTX).league_members[0];
  assert(!('__email_case' in lowRow.extra), 'players: an already-lower-case email adds no __email_case noise');
  assert(deepEqual(roundTrip('cfbp_players', [already])[0], stripCredentials('cfbp_players', [already])[0]),
    'players: an already-lower-case player still round-trips byte-for-byte (only case is modulo, nothing else moved)');
}

const result1 = {
  resultId: 'wr_w1_p1', weekId: 'w1', playerId: 'p1', displayName: 'Ann',
  correctPicks: 4, incorrectPicks: 1, correctCount: 4, incorrectCount: 1,
  noDecisions: 0, pending: 0, tiebreakerGuess: 45, tiebreakerDelta: 3,
  rank: 1, isWinner: true, isLoser: false, wonByTiebreaker: false,
};
assert(deepEqual(roundTrip('cfbp_results', [result1]), [result1]), 'results: fixture round-trips exactly');

const obligation1 = {
  obligationId: 'ob_1', type: 'weekly', weekId: 'w1', payerPlayerId: 'p2', recipientPlayerId: 'p1',
  amountOrPrize: 'a beer', status: 'unpaid', createdAt: new Date().toISOString(), paidAt: null,
  needsReview: false, reviewNote: null, voided: false, voidedAt: null, voidReason: null,
  mergedInto: null, mergedFrom: [],
};
assert(deepEqual(roundTrip('cfbp_obligations', [obligation1]), obligation1 && [obligation1]), 'obligations: fixture round-trips exactly');

const feedback1 = {
  id: 'fb_1', name: 'Ann', kind: 'bug', weekId: 'w1', body: 'the thing broke',
  submittedAt: new Date().toISOString(), appVersion: 'v0.21.2', siteUrl: 'https://irbfootball.com/',
};
assert(deepEqual(roundTrip('cfbp_feedback', [feedback1]), [feedback1]),
  'feedback: fixture (no memberId/status/excludedFromExport — those are Step-1-only) round-trips exactly');

const comment1 = { commentId: 'c_1', weekId: 'w1', gameId: 'g1', authorId: 'p1', authorKind: 'player', body: 'nice pick', createdAt: new Date().toISOString() };
assert(deepEqual(roundTrip('cfbp_comments', [comment1]), [comment1]), 'comments (player-authored): fixture round-trips exactly');
const botComment1 = { commentId: 'c_2', weekId: 'w1', gameId: 'g1', authorId: 'bot', authorKind: 'bot', botEventKey: 'ev1', body: 'final!', createdAt: new Date().toISOString() };
assert(deepEqual(roundTrip('cfbp_comments', [botComment1]), [botComment1]), 'comments (bot-authored, botEventKey present): fixture round-trips exactly');
{
  const rows = toRows.cfbp_comments([comment1], CTX).comments[0];
  assert(rows.author_member_id === 'p1', 'comments: author_member_id derived correctly for a real member');
  const botRows = toRows.cfbp_comments([botComment1], CTX).comments[0];
  assert(botRows.author_member_id === null, 'comments: author_member_id is null for the literal "bot" author');
}

const notif1 = {
  id: 'n_1', playerId: 'p1', event: 'PICKS_OPEN', actor: null, title: 'Picks are open', body: 'Go pick.',
  destination: { tab: 'picks' }, createdAt: new Date().toISOString(), readAt: null, dedupKey: 'PICKS_OPEN|w1|p1',
  deliveryState: { inApp: 'delivered', push: 'skipped' }, weekId: 'w1', meta: { foo: 'bar' },
};
assert(deepEqual(roundTrip('cfbp_notifications', [notif1]), [notif1]),
  'notifications: fixture round-trips exactly, including deliveryState surviving via extra (no column for it)');

const nicknames1 = { 'w1__p1': 'Big Ann' };
assert(deepEqual(roundTrip('cfbp_nicknames', nicknames1), nicknames1), 'nicknames: kv passthrough round-trips exactly');
const lockOvr1 = { g1: 'unlocked' };
assert(deepEqual(roundTrip('cfbp_lock_overrides', lockOvr1), lockOvr1), 'lock_overrides: kv passthrough round-trips exactly');
const rejected1 = { w1: ['espn123'] };
assert(deepEqual(roundTrip('cfbp_rejected_suggestions', rejected1), rejected1), 'rejected_suggestions: kv passthrough round-trips exactly');
assert(roundTrip('cfbp_active_week', 'w1') === 'w1', 'active_week: kv passthrough (string) round-trips exactly');
assert(roundTrip('cfbp_active_week', null) === null, 'active_week: kv passthrough (null) round-trips exactly');
const fetchProof1 = { fetchedAt: new Date().toISOString(), gamesFound: 12 };
assert(deepEqual(roundTrip('cfbp_fetch_proof', fetchProof1), fetchProof1), 'fetch_proof: kv passthrough round-trips exactly');
const excludedIds1 = ['fb_1', 'fb_2'];
assert(deepEqual(roundTrip('cfbp_feedback_excluded_ids', excludedIds1), excludedIds1), 'feedback_excluded_ids: kv passthrough (array) round-trips exactly');

const settings1 = { season: '2026', theme: 'dark', adminPasswordHash: 'SECRET', sitePin: '0000', storageMode: 'googleSheets' };
{
  const restored = roundTrip('cfbp_settings', settings1);
  const strippedExpected = stripCredentials('cfbp_settings', settings1);
  assert(deepEqual(restored, strippedExpected), 'settings: round-trips to itself MINUS the three credential fields');
  assert(!('adminPasswordHash' in restored) && !('sitePin' in restored) && !('storageMode' in restored),
    'settings: none of the three credential fields ever reach Supabase or come back');
}

const tbGuesses1 = { 'w1__p1': 45, 'w1__p2': 50 };
assert(deepEqual(roundTrip('cfbp_tiebreaker_guesses', tbGuesses1), tbGuesses1), 'tiebreaker_guesses: map round-trips exactly');
const epGuesses1 = { 'w1__p1': 38 };
assert(deepEqual(roundTrip('cfbp_extra_point_guesses', epGuesses1), epGuesses1), 'extra_point_guesses: map round-trips exactly');

const reactions1 = { w1: { g1: { '🔥': ['p2', 'p1'] } } };
{
  const restored = roundTrip('cfbp_reactions', reactions1);
  // DI-183a: array order inside [playerId] is explicitly not preserved —
  // compare sorted, not literal.
  const sortedExpected = { w1: { g1: { '🔥': ['p1', 'p2'] } } };
  assert(deepEqual(restored, sortedExpected), 'reactions: nested map round-trips (player order sorted, per DI-183a)');
}

const gameRequest1 = {
  id: 'gr_1', kind: 'request', playerId: 'p1', playerName: 'Ann', espnEventId: '12345', espnSport: 'college-football',
  homeTeam: 'Alpha', awayTeam: 'Beta', homeMascot: 'Aces', awayMascot: 'Bears', homeRank: null, awayRank: 12,
  kickoff: new Date().toISOString(), gameDate: '2026-09-05', season: '2026', createdAt: new Date().toISOString(), appVersion: 'v0.21.2',
};
assert(deepEqual(roundTrip('cfbp_game_requests', [gameRequest1]), [gameRequest1]), 'game_requests (request kind): fixture round-trips exactly');
const withdraw1 = { id: 'gr_2', kind: 'withdraw', targetRequestId: 'gr_1', playerId: 'p1', createdAt: new Date().toISOString() };
assert(deepEqual(roundTrip('cfbp_game_requests', [withdraw1]), [withdraw1]), 'game_requests (withdraw kind): fixture round-trips exactly');

const learning1 = { kind: 'learning', learningId: 'lrn_1', category: 'x', instruction: 'y', evidenceSummary: 'z', confidence: 0.8, status: 'pending', createdAt: new Date().toISOString(), reviewAt: '', runId: 'run_1' };
const experiment1 = { kind: 'experiment', experiment: 'e', reason: 'r', confidence: 0.5, status: 'pending', createdAt: new Date().toISOString(), runId: 'run_1' };
assert(deepEqual(roundTrip('cfbp_scribe_learnings', [learning1, experiment1]), [learning1, experiment1]),
  'scribe_learnings: mixed kinds round-trip exactly, including a synthesized-id experiment row');
{
  const rows = toRows.cfbp_scribe_learnings([learning1, experiment1], CTX).scribe_learnings;
  assert(rows[0].id === 'lrn_1', 'scribe_learnings: a learning kind keeps its own learningId as the row id');
  assert(rows[1].id === 'sl_run_1_1', 'scribe_learnings: an experiment kind synthesizes sl_<runId>_<ord>');
}

const canon1 = { canonId: 'cn_1', contextSummary: 'a', relevantFacts: 'b', preferredResponse: 'c', whyItWorked: 'd', pattern: 'e', source: 'f', confidence: 0.9, approvalStatus: 'approved', createdAt: new Date().toISOString(), runId: 'run_1' };
assert(deepEqual(roundTrip('cfbp_scribe_canon', [canon1]), [canon1]), 'scribe_canon: fixture round-trips exactly');

const report1 = { runId: 'run_1', createdAt: new Date().toISOString(), report: { summary: 'ok' }, metrics: {}, counts: {} };
assert(deepEqual(roundTrip('cfbp_scribe_reports', [report1]), [report1]), 'scribe_reports: fixture round-trips exactly');
{
  // REV n11 — scribe_reports has no run_id column (its PK *is* the runId). Emitting one meant
  // jsonb_to_recordset discarded the key without a word.
  const row = toRows.cfbp_scribe_reports([report1], CTX).scribe_reports[0];
  assert(!('run_id' in row), 'scribe_reports: no run_id key is emitted (the table has no such column)');
  assert(row.id === 'run_1', 'scribe_reports: the row id IS the runId, which is why run_id would be redundant');
  const learnRow = toRows.cfbp_scribe_canon([canon1], CTX).scribe_canon[0];
  assert(learnRow.run_id === 'run_1', 'scribe_canon: DOES still emit run_id (that table has the column)');
}

const season1 = { season: { label: 'CFP 2K25' }, obligations: [{ id: 'x' }] };
assert(deepEqual(roundTrip('SEASON_2025', season1), season1), 'SEASON_2025: composed payload round-trips exactly');

// (b) old-Sheet-row fixtures with fields entirely ABSENT --------------------
console.log('\n[1b] Absent-field fixtures — restored object never gains a field the legacy row never had…');

{
  const oldWeek = { ...week1 };
  delete oldWeek.groupId; delete oldWeek.isGroupTiebreaker; delete oldWeek.lockedAlmaMaters;
  const restored = roundTrip('cfbp_weeks', [oldWeek])[0];
  assert(!('groupId' in restored) && !('isGroupTiebreaker' in restored) && !('lockedAlmaMaters' in restored),
    'weeks: fields absent on the legacy row stay absent after round-trip (not resurrected as null)');
  assert(deepEqual({ ...restored, groupId: null, isGroupTiebreaker: false, lockedAlmaMaters: null }, week1),
    'weeks: every OTHER field is untouched by the absence of those three');
  const row = toRows.cfbp_weeks([oldWeek], CTX).weeks[0];
  assert(row.sport === 'cfb', 'weeks: `sport` (never a legacy field at all) defaults to \'cfb\' on write');
  assert(!('sport' in restored), 'weeks: `sport` never reappears on the restored legacy object (it never had one)');
}
{
  const oldGame = { ...game1 };
  delete oldGame.nationalTV; delete oldGame.broadcastNetwork; delete oldGame.marqueeEvent; delete oldGame.espnSport;
  const restored = roundTrip('cfbp_games', [oldGame])[0];
  assert(!('nationalTV' in restored) && !('espnSport' in restored), 'games: pre-DI-7 absent fields stay absent after round-trip');
}
{
  const oldPlayer = { ...player1 };
  delete oldPlayer.phone; delete oldPlayer.phoneVerified; delete oldPlayer.notifyPrefs; delete oldPlayer.preferences;
  const restored = roundTrip('cfbp_players', [oldPlayer])[0];
  assert(!('phone' in restored) && !('preferences' in restored), 'players: pre-notification-fields absent stays absent after round-trip');
}
{
  const oldObligation = { obligationId: 'ob_2', type: 'weekly', weekId: 'w1', payerPlayerId: 'p1', recipientPlayerId: 'p2', amountOrPrize: 'x', status: 'paid', createdAt: new Date().toISOString(), paidAt: new Date().toISOString() };
  const restored = roundTrip('cfbp_obligations', [oldObligation])[0];
  assert(!('needsReview' in restored) && !('voided' in restored) && !('mergedFrom' in restored),
    'obligations: UN-126\'s five/seven new fields absent on a pre-UN-126 record stay absent after round-trip');
  assert(restored.obligationId === 'ob_2' && restored.status === 'paid', 'obligations: the fields that WERE present are untouched');
}
{
  const oldFeedback = { id: 'fb_2', name: 'Bob', weekId: null, body: 'pre-UN-122 row', submittedAt: new Date().toISOString(), appVersion: 'v0.10.0', siteUrl: '' };
  const restored = roundTrip('cfbp_feedback', [oldFeedback])[0];
  assert(!('kind' in restored), 'feedback: pre-UN-122 row has no `kind` field, and none reappears after round-trip');
  const row = toRows.cfbp_feedback([oldFeedback], CTX).feedback[0];
  assert(row.kind === 'unspecified', 'feedback: `kind` DOES default to \'unspecified\' in the written row (DI-183a)');
}

// (c) unknown extra field survives -------------------------------------------
console.log('\n[1c] An unknown legacy field survives a round-trip via `extra`…');
{
  const weirdWeek = { ...week1, __futureField: { nested: true, n: 3 } };
  const restored = roundTrip('cfbp_weeks', [weirdWeek])[0];
  assert(deepEqual(restored.__futureField, { nested: true, n: 3 }), 'weeks: an unmodeled field is preserved verbatim via extra');
}
{
  const weirdPick = { ...pick1, futureFlag: true };
  const restored = roundTrip('cfbp_picks', [weirdPick])[0];
  assert(restored.futureFlag === true, 'picks: an unmodeled field is preserved verbatim via extra');
}
{
  const weirdComment = { ...comment1, reactionCount: 4 };
  const restored = roundTrip('cfbp_comments', [weirdComment])[0];
  assert(restored.reactionCount === 4, 'comments: an unmodeled field is preserved verbatim via extra');
}

// ─── [1d] DI-T7.6 — contact fields are ABSENT, never blank ──────────────────
//
// Migration 0007 takes `email`, `phone` and `phone_verified` off the member-readable grant on
// `league_members`; they come back only from `get_member_contacts()`, which returns every row to a
// commissioner and exactly one row — his own — to everybody else. So a row handed to this
// projection now arrives in one of two shapes, and the difference is the PRESENCE OF THE PROPERTY:
//
//   service role / commissioner : { …, email: 'a@b.c', phone: '+1…', phone_verified: true }
//   plain member, co-member row : { …                                                     }
//
// THE HAZARD this section exists for. `createPlayer()` defaults email and phone to the EMPTY
// STRING, so a redacted row that projected through the ordinary path would come back as
// `email: ''` — and the next `save(cfbp_players, …)` by any member would write those empty strings
// back over five other people's real addresses. Total, silent, and the Sheet backup would agree
// with it. "Absent" is the only shape that cannot do that, because a field that is not there is
// not written.
console.log('\n[1d] DI-T7.6 — a redacted read projects contact fields as ABSENT, and a round-trip can never blank them…');
{
  const CONTACT_LEGACY = ['email', 'phone', 'phoneVerified'];
  const CONTACT_COLUMNS = ['email', 'phone', 'phone_verified'];

  // The service-role/importer shape, unchanged — checked FIRST, because everything else here is
  // about narrowing and the one thing that must not narrow is the import.
  {
    const rows = toRows.cfbp_players([player1], CTX).league_members;
    assert(rows.length === 1 && CONTACT_COLUMNS.every((c) => c in rows[0]),
      'players/importer: a full player record still emits all three contact COLUMNS (the six founders\' emails and phones import exactly as before)');
    assert(rows[0].email === 'ann@example.com' && rows[0].phone === player1.phone &&
      rows[0].phone_verified === player1.phoneVerified,
      'players/importer: and with their real values, not defaults');
    const back = fromRows.cfbp_players({ league_members: rows }, CTX)[0];
    assert(back.email === 'ann@example.com' && back.phone === player1.phone,
      'players/importer: the service-role round-trip is unchanged (every column is present, so nothing is redacted)');
  }

  /** What a plain member's `select(LM_SELECT_COLS)` returns: every granted column, and no key at
   *  all for the three revoked ones. Built by DELETING from the real projection output rather than
   *  by hand, so it cannot drift from what toRows actually writes. */
  const redactedRow = () => {
    const row = toRows.cfbp_players([player1], CTX).league_members[0];
    for (const c of CONTACT_COLUMNS) delete row[c];
    return row;
  };

  {
    const restored = fromRows.cfbp_players({ league_members: [redactedRow()] }, CTX)[0];
    for (const f of CONTACT_LEGACY) {
      assert(!(f in restored), `players/redacted: \`${f}\` is ABSENT from the projected player (not '' and not null)`);
    }
    assert(restored.displayName === player1.displayName && restored.almaMater === player1.almaMater,
      'players/redacted: every field the member CAN read is projected normally');
  }

  // THE ROUND-TRIP-NEVER-BLANKS PROOF. Project a redacted read back into rows, which is what a
  // Step 4 adapter does on save, and require that no contact column appears at all — not as '',
  // not as null, not as false.
  {
    const restored = fromRows.cfbp_players({ league_members: [redactedRow()] }, CTX)[0];
    const rewritten = toRows.cfbp_players([restored], CTX).league_members[0];
    for (const c of CONTACT_COLUMNS) {
      assert(!(c in rewritten),
        `players/round-trip: writing a redacted player back emits NO \`${c}\` column (an absent field cannot overwrite a real value)`);
      assert(rewritten[c] !== '' && rewritten[c] !== false,
        `players/round-trip: and \`${c}\` is certainly not the factory default (the blanking hazard, stated as its own assertion)`);
    }
    assert(Array.isArray(rewritten.extra.__absent) && CONTACT_LEGACY.every((f) => rewritten.extra.__absent.includes(f)),
      'players/round-trip: the absence is still RECORDED in extra.__absent, so the next read re-omits the fields rather than resurrecting them');
    assert(rewritten.display_name === player1.displayName,
      'players/round-trip: and everything the member could read is written back unchanged');
  }

  // The commissioner path: get_member_contacts()' rows, merged by member id. PostgREST's shape
  // ({ member_id, email, phone, phone_verified }) is consumed as-is — a reshaping step in the
  // caller is somewhere for a field to go missing.
  {
    const contacts = [{ member_id: player1.playerId, email: 'ann@example.com', phone: '+15125550123', phone_verified: true }];
    const restored = fromRows.cfbp_players({ league_members: [redactedRow()] }, { ...CTX, contacts })[0];
    assert(restored.email === 'ann@example.com' && restored.phone === '+15125550123' && restored.phoneVerified === true,
      'players/contacts: get_member_contacts() rows merge back in by member id');
    const other = { ...player1, playerId: 'p_other' };
    const otherRow = toRows.cfbp_players([other], CTX).league_members[0];
    for (const c of CONTACT_COLUMNS) delete otherRow[c];
    const otherRestored = fromRows.cfbp_players({ league_members: [otherRow] }, { ...CTX, contacts })[0];
    assert(CONTACT_LEGACY.every((f) => !(f in otherRestored)),
      'players/contacts: a member the contacts list does NOT name stays absent (the plain-member case: one row back, five redacted)');
  }

  // DI-T7.7 — THE `extra` BLOB CARRIES NO ADDRESS, so a redacted read has nothing to resurrect one
  // from. This block used to assert the opposite half of the same question: the marker was written,
  // and the restore ORDER was what kept a redacted row from handing an address back out of `extra`.
  // The order no longer matters because the value is not there — which is a strictly better place
  // to be, and the assertion changes shape to say so. It is written against the WHOLE blob, not
  // against the one key that used to exist, so a differently-named marker would fail it too.
  {
    const cased = { ...player1, email: 'Ann@Example.com' };
    const row = toRows.cfbp_players([cased], CTX).league_members[0];
    assert(row.email === 'ann@example.com', 'players/email-case: the written row carries the lower-cased address');
    assert(!JSON.stringify(row.extra).includes('@') && !('__email_case' in row.extra),
      'players/email-case: and `extra` carries NO address-shaped value and no case marker (DI-T7.7 — extra is member-readable)');
    for (const c of CONTACT_COLUMNS) delete row[c];
    const restored = fromRows.cfbp_players({ league_members: [row] }, CTX)[0];
    assert(!('email' in restored),
      'players/email-case: so a redacted row cannot resurrect the address (there is nothing in `extra` to resurrect it from)');
  }

  // ── F-11: `__absent` vs the contacts list, with TRUTHFUL ROW SHAPES ─────────────────────
  //
  // These fixtures are exactly what `get_member_contacts()` can return, and that is the whole
  // point of rewriting them. `league_members.phone` is `text not null default ''` and
  // `phone_verified` is `boolean not null default false` (0001_schema.sql:78-79), so the RPC
  // CANNOT report null for either: it reports `''` and `false`. Only `email` is nullable.
  //
  // The earlier version of this block hand-built `phone: null`, a shape the live function cannot
  // produce — and the guard it was testing ("non-null from the list wins") therefore looked
  // correct while being wrong for two of the three fields: every row would have taken that branch
  // and resurrected `phone: ''` / `phoneVerified: false` on pre-notification records. A test whose
  // fixture cannot occur is worse than no test, because it reports confidence.
  //
  // The rule under test: a contacts value overrides `__absent` only when it CARRIES INFORMATION —
  // non-null, non-empty, and not the column's NOT NULL default. `phone_verified` travels with
  // `phone`, because `false` beside a real number is information and `false` beside an empty
  // string is just the default.
  {
    // A pre-notification Sheet record: email only, no phone fields at all.
    const noPhone = { ...player1 };
    delete noPhone.phone;
    delete noPhone.phoneVerified;
    const row = toRows.cfbp_players([noPhone], CTX).league_members[0];
    // What the RPC really returns for that member, read by the commissioner.
    const contacts = [{ member_id: noPhone.playerId, email: 'ann@example.com', phone: '', phone_verified: false }];
    const restored = fromRows.cfbp_players({ league_members: [row] }, { ...CTX, contacts })[0];
    assert(!('phone' in restored) && !('phoneVerified' in restored),
      'players/F-11: a pre-notification record stays WITHOUT phone/phoneVerified when the RPC reports the NOT NULL defaults (\'\' and false) — the values the live function actually sends');
    assert(restored.email === 'ann@example.com',
      'players/F-11: while the informative email IS merged from the same list');

    // …and the marker survives a COMMISSIONER-SIDE round trip, which is the write that used to
    // destroy it: read with contacts, project back to a row, read again.
    const rewritten = toRows.cfbp_players([restored], CTX).league_members[0];
    assert(rewritten.extra.__absent.includes('phone') && rewritten.extra.__absent.includes('phoneVerified'),
      'players/F-11: and a commissioner-side write-back PRESERVES the __absent marker (the non-null test destroyed it on the first save)');
    const again = fromRows.cfbp_players({ league_members: [rewritten] }, { ...CTX, contacts })[0];
    assert(!('phone' in again) && !('phoneVerified' in again),
      'players/F-11: so the second read is identical — the record does not acquire a phone by being looked at twice');
  }
  {
    // The other direction: a REAL phone, and a stale marker that wrongly names it. The value wins.
    const row = toRows.cfbp_players([player1], CTX).league_members[0];
    const poisoned = { ...row, extra: { ...row.extra, __absent: ['email', 'phone', 'phoneVerified'] } };
    const contacts = [{ member_id: player1.playerId, email: 'ann@example.com', phone: '+15125550123', phone_verified: false }];
    const restored = fromRows.cfbp_players({ league_members: [poisoned] }, { ...CTX, contacts })[0];
    assert(restored.phone === '+15125550123',
      'players/F-11: a REAL phone from the list beats a stale __absent marker (information outranks a wrong marker)');
    assert(restored.phoneVerified === false,
      'players/F-11: and phoneVerified travels WITH it even though `false` is the column default — "we have his number and nobody has verified it" is information about a real number');
    assert(restored.email === 'ann@example.com',
      'players/F-11: the informative email comes back too');
  }
  {
    // And the uninformative case on a record that is NOT marked absent: `phone: ''` is the real
    // value createPlayer() gives every new player, and it must be projected, not deleted.
    const row = toRows.cfbp_players([player1], CTX).league_members[0];
    const contacts = [{ member_id: player1.playerId, email: 'ann@example.com', phone: '', phone_verified: false }];
    const restored = fromRows.cfbp_players({ league_members: [row] }, { ...CTX, contacts })[0];
    assert(restored.phone === '' && restored.phoneVerified === false,
      'players/F-11: an uninformative value on a record with no marker is still the record\'s real value, and is projected (createPlayer gives every new player phone: \'\')');
  }

  // ── F-10(b) — A STALE `__absent` CAN NO LONGER HIDE A REAL VALUE ────────────────────────
  //
  // The reviewer's repro, pinned in both halves. A caller that reads rows WITHOUT `ctx.contacts`
  // — which is every client read now that no client can SELECT the three columns — projects all
  // three as absent, and a save from that projection writes
  // `extra.__absent: [email, phone, phoneVerified]` into a row whose COLUMNS still hold the real
  // values. That marker is wrong, and it used to be decisive: it outranked the contacts list, so
  // every later read, including the commissioner's own with a good list in hand, deleted the
  // fields again — permanently hiding data that was right there in the table, with nothing the
  // caller could do about it.
  //
  // First half: the stale marker really is produced (this is the write-side hazard, and it is a
  // Step 4 design question — see the precedence note in js/supabase-projection.js).
  // Second half: it is now INERT. A non-null value from the contacts list wins, so the
  // commissioner gets the real values back.
  {
    // A player with REAL contact details — which is the case that matters, and (F-11) the only one
    // where recovery is even meaningful: an empty phone carries no information to recover.
    const withPhone = { ...player1, phone: '+15125550123', phoneVerified: true };
    const fullRow = toRows.cfbp_players([withPhone], CTX).league_members[0];
    const redacted = { ...fullRow };
    for (const c of CONTACT_COLUMNS) delete redacted[c];

    const blindProjection = fromRows.cfbp_players({ league_members: [redacted] }, CTX)[0];
    const poisonedRow = toRows.cfbp_players([blindProjection], CTX).league_members[0];
    assert(CONTACT_LEGACY.every((f) => poisonedRow.extra.__absent.includes(f)),
      'players/F-10(b): a contacts-less round trip DOES write a stale extra.__absent naming all three contact fields (the write-side hazard, reproduced, not assumed)');

    // …and the row in the database still has the real values in its columns. Reading that row WITH
    // a contacts list must return them, stale marker or not.
    const stored = { ...poisonedRow, email: fullRow.email, phone: fullRow.phone, phone_verified: fullRow.phone_verified };
    const contacts = [{
      member_id: withPhone.playerId, email: fullRow.email, phone: fullRow.phone, phone_verified: fullRow.phone_verified,
    }];
    const recovered = fromRows.cfbp_players({ league_members: [stored] }, { ...CTX, contacts })[0];
    assert(recovered.email === fullRow.email && recovered.phone === '+15125550123',
      'players/F-10(b): and an INFORMATIVE value from get_member_contacts() OUTRANKS that stale marker — the commissioner gets the real values back, so a caller mistake can no longer hide data permanently');
    assert(recovered.phoneVerified === true,
      'players/F-10(b): including the boolean, which travels with the informative phone rather than being judged alone');
  }
}

// ─── [2] canonicalize ───────────────────────────────────────────────────────
console.log('\n[2] canonicalize() — order-insensitive, stable…');
{
  const a = [{ pickId: 'x', v: 1 }, { pickId: 'a', v: 2 }];
  const b = [{ pickId: 'a', v: 2 }, { pickId: 'x', v: 1 }];
  assert(canonicalize(a) === canonicalize(b), 'canonicalize: an array of id-bearing records is order-insensitive');
  assert(canonicalize({ b: 1, a: 2 }) === canonicalize({ a: 2, b: 1 }), 'canonicalize: object key order is insensitive');
  assert(canonicalize(a) === canonicalize(a), 'canonicalize: stable across repeated calls on the same input');
  assert(canonicalize(-0) === canonicalize(0), 'canonicalize: -0 normalizes to 0');
  const resultsArr1 = [{ weekId: 'w1', playerId: 'p2', v: 1 }, { weekId: 'w1', playerId: 'p1', v: 2 }];
  const resultsArr2 = [{ weekId: 'w1', playerId: 'p1', v: 2 }, { weekId: 'w1', playerId: 'p2', v: 1 }];
  assert(canonicalize(resultsArr1) === canonicalize(resultsArr2), 'canonicalize: results-style weekId+playerId composite arrays are order-insensitive');
}

// ─── [3] toIso no-op ────────────────────────────────────────────────────────
console.log('\n[3] toIso() is a no-op on toISOString() output…');
{
  const now = new Date().toISOString();
  assert(toIso(now) === now, 'toIso: byte-identical on an already-ISO string');
  assert(toIso(null) === null, 'toIso: null -> null');
  assert(toIso(undefined) === null, 'toIso: undefined -> null');
  assert(toIso('not a date') === null, 'toIso: unparseable input fails closed to null, never "Invalid Date"');
}

// ─── [3b] export-sheet.mjs against a LOCAL fixture server (never the real
//     Apps Script backend — Drew's rule, DI-183b). Run BEFORE section [7]
//     installs the results-drift DOM/localStorage stub, which stubs out
//     `fetch` — this section needs the REAL `fetch` to reach the fixture
//     HTTP server below. ─────────────────────────────────────────────────
console.log('\n[3b] export-sheet.mjs — exportAll() against a local fixture HTTP server (paging, per-player scoping)…');
{
  const FIXTURE_TOKEN = 'test-token-xyz';
  const FIXTURE_PLAYERS = [
    { playerId: 'p1', displayName: 'Ann' },
    { playerId: 'p2', displayName: 'Bob' },
  ];
  const FIXTURE_STORE = { cfbp_players: FIXTURE_PLAYERS, cfbp_weeks: [], cfbp_games: [] };
  // 1200 events so chatSince (pageSize 500) must page THREE times.
  const FIXTURE_MESSAGES = Array.from({ length: 1200 }, (_, i) => ({
    seq: i + 1, id: `m${i + 1}`, ts: Date.now(), type: 'message', author: 'p1',
    gameTag: '', body: `msg ${i + 1}`, targetId: '', replyTo: '', notify: false, meta: null,
  }));
  const FIXTURE_MEMORY = [
    { id: 'mem_p1', playerId: 'p1', kind: 'fact', key: 'k', value: 'v', provenance: 'chat', confidence: 0.6, createdAt: new Date().toISOString(), reviewAt: '', sourceMessageId: 'm1', refreshedAt: null },
    { id: 'mem_p2', playerId: 'p2', kind: 'fact', key: 'k2', value: 'v2', provenance: 'chat', confidence: 0.6, createdAt: new Date().toISOString(), reviewAt: '', sourceMessageId: 'm2', refreshedAt: null },
  ];
  const FIXTURE_NOTIFYLOG = {
    p1: Array.from({ length: 3 }, (_, i) => ({ seq: i + 1, id: `nl_p1_${i + 1}`, playerId: 'p1', event: 'PICKS_LOCKING_SOON', actor: null, title: 't', body: 'b', destination: null, createdAt: new Date().toISOString(), dedupKey: `d${i}`, weekId: null, meta: {} })),
    p2: [],
  };
  const seenActions = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let reqJson;
      try { reqJson = JSON.parse(body); } catch { reqJson = {}; }
      seenActions.push(reqJson.action);
      const reply = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (reqJson.token !== FIXTURE_TOKEN) return reply({ ok: false, error: 'Unauthorized' });
      if (reqJson.action === 'getAll') return reply({ ok: true, data: FIXTURE_STORE, chatHead: FIXTURE_MESSAGES.length });
      if (reqJson.action === 'chatSince') {
        const after = Number(reqJson.seq || 0);
        const limit = Math.min(Number(reqJson.limit || 500), 1000);
        const events = FIXTURE_MESSAGES.filter((e) => e.seq > after).slice(0, limit);
        return reply({ ok: true, events, head: FIXTURE_MESSAGES.length });
      }
      if (reqJson.action === 'scribeMemoryList') {
        const pid = reqJson.playerId;
        const records = FIXTURE_MEMORY.filter((m) => m.playerId === pid);
        return reply({ ok: true, records });
      }
      if (reqJson.action === 'notifyLog') {
        const pid = reqJson.playerId;
        const after = Number(reqJson.afterSeq || 0);
        const limit = Math.min(Number(reqJson.limit || 500), 1000);
        const all = FIXTURE_NOTIFYLOG[pid] || [];
        const records = all.filter((r) => r.seq > after).slice(0, limit);
        return reply({ ok: true, records, head: all.length });
      }
      return reply({ ok: false, error: 'Unknown action: ' + reqJson.action });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const bundle = await exportAll({ base, token: FIXTURE_TOKEN });
    assert(bundle.store.cfbp_players.length === 2, 'exportAll: getAll() store round-trips through the fixture server');
    assert(bundle.messages.length === 1200, `exportAll: chatSince pages correctly across 3 pages of 500 (got ${bundle.messages.length})`);
    assert(bundle.messages[0].id === 'm1' && bundle.messages[1199].id === 'm1200', 'exportAll: paged messages arrive in order, none dropped or duplicated');
    assert(bundle.scribeMemory.length === 2, 'exportAll: scribeMemoryList loops once per player and unions the results (2 players -> 2 records)');
    assert(bundle.notifyLog.length === 3, 'exportAll: notifyLog loops once per player and unions the results (only p1 has records)');
    assert(seenActions.includes('getAll') && seenActions.includes('chatSince') && seenActions.includes('scribeMemoryList') && seenActions.includes('notifyLog'),
      'exportAll: uses only existing, already-shipped read actions — never a new/invented one');

    // Wrong token -> the export must fail loudly, not silently return partial data.
    let threw = false;
    try { await exportAll({ base, token: 'wrong-token' }); } catch { threw = true; }
    assert(threw, 'exportAll: a bad token throws rather than returning a silently-empty export');
  } finally {
    server.close();
  }
}

// ─── build a realistic fixture store for [4]-[9] ──────────────────────────
function buildFixtureStore() {
  const w = createWeek('2026', 1, '2026-08-28', '2026-09-01');
  w.status = 'final';
  w.actualTiebreakerValue = 45;
  const g1 = createGame(w.weekId, { homeTeam: 'Alpha', awayTeam: 'Beta', spread: -3, favorite: 'Alpha', lockedSpread: -3, homeScore: 24, awayScore: 10, status: 'final', atsWinner: 'Alpha' });
  const players = [
    createPlayer('Ann', 'ann@x.com', '1111', 'Ohio State', 'AC'),
    createPlayer('Bob', 'bob@x.com', '2222', 'Michigan', 'BB'),
  ];
  players[0].playerId = 'p1'; players[1].playerId = 'p2';
  const picks = [
    { ...createPick(w.weekId, g1.gameId, 'p1', 'Alpha') },
    { ...createPick(w.weekId, g1.gameId, 'p2', 'Beta') },
  ];
  // matches evaluatePick()/gameMultiplier() for a straightforward ATS win/loss
  const results = [
    { resultId: `wr_${w.weekId}_p1`, weekId: w.weekId, playerId: 'p1', displayName: 'Ann', correctPicks: 1, incorrectPicks: 0, correctCount: 1, incorrectCount: 0, noDecisions: 0, pending: 0, tiebreakerGuess: 45, tiebreakerDelta: 0, rank: 1, isWinner: true, isLoser: false, wonByTiebreaker: false },
    { resultId: `wr_${w.weekId}_p2`, weekId: w.weekId, playerId: 'p2', displayName: 'Bob', correctPicks: 0, incorrectPicks: 1, correctCount: 0, incorrectCount: 1, noDecisions: 0, pending: 0, tiebreakerGuess: 50, tiebreakerDelta: 5, rank: 2, isWinner: false, isLoser: true, wonByTiebreaker: false },
  ];
  const obligations = [
    { obligationId: 'ob_1', type: 'weekly', weekId: w.weekId, payerPlayerId: 'p2', recipientPlayerId: 'p1', amountOrPrize: 'a beer', status: 'unpaid', createdAt: new Date().toISOString(), paidAt: null, needsReview: false, reviewNote: null, voided: false, voidedAt: null, voidReason: null, mergedInto: null, mergedFrom: [] },
  ];
  return {
    cfbp_settings: { season: '2026', theme: 'dark' },
    cfbp_players: players,
    cfbp_weeks: [w],
    cfbp_games: [g1],
    cfbp_picks: picks,
    cfbp_results: results,
    cfbp_obligations: obligations,
    cfbp_nicknames: {},
    cfbp_lock_overrides: {},
    cfbp_tiebreaker_guesses: { [`${w.weekId}__p1`]: 45, [`${w.weekId}__p2`]: 50 },
    cfbp_extra_point_guesses: {},
    cfbp_rejected_suggestions: {},
    cfbp_reactions: {},
    cfbp_feedback: [],
    cfbp_feedback_excluded_ids: [],
    cfbp_comments: [],
    cfbp_active_week: w.weekId,
    cfbp_fetch_proof: null,
    cfbp_notifications: [],
    cfbp_scribe_learnings: [],
    cfbp_scribe_canon: [],
    cfbp_scribe_reports: [],
    cfbp_game_requests: [],
  };
}
const exportBundle = { exportedAt: new Date().toISOString(), store: buildFixtureStore(), messages: [
  { seq: 1, id: 'm1', ts: Date.now(), type: 'message', author: 'p1', gameTag: '', body: 'hi', targetId: '', replyTo: '', notify: false, meta: null },
  { seq: 2, id: 'm2', ts: Date.now(), type: 'message', author: 'scribe', gameTag: '', body: 'roast', targetId: '', replyTo: '', notify: true, meta: { x: 1 } },
], scribeMemory: [
  { id: 'mem_1', playerId: 'p1', kind: 'fact', key: 'k', value: 'v', provenance: 'chat', confidence: 0.7, createdAt: new Date().toISOString(), reviewAt: '', sourceMessageId: 'm1', refreshedAt: null },
], notifyLog: [
  { seq: 1, id: 'nl_1', playerId: 'p1', event: 'PICKS_LOCKING_SOON', actor: null, title: 't', body: 'b', destination: null, createdAt: new Date().toISOString(), dedupKey: 'd1', weekId: null, meta: {} },
] };

// ─── [4] importer upsert-planner idempotency ──────────────────────────────
console.log('\n[4] Importer upsert planner is idempotent against MockImportRowsClient…');
{
  const store = exportBundle.store;
  const ctx = { leagueId: 'L1', memberIds: new Set(store.cfbp_players.map((p) => p.playerId)) };
  const rowsByTable = buildRowsForImport(store, exportBundle, ctx, { commissionerId: 'p1', seasonPayload: null });

  const client1 = newMock();
  await applyRowsByTable(rowsByTable, client1, ctx);
  const snap1 = client1.snapshot();

  const client2 = newMock();
  await applyRowsByTable(rowsByTable, client2, ctx);
  await applyRowsByTable(rowsByTable, client2, ctx);   // run TWICE against the same client
  const snap2 = client2.snapshot();

  assert(deepEqual(snap1, snap2), 'two runs against the same export produce an IDENTICAL mock DB state (idempotent upsert)');
  assert(client1.selectRows('picks').length === 2, 'sanity: picks actually landed (2 rows)');
  assert(client1.selectRows('league_kv').length === 7, 'sanity: all 7 league_kv sub-keys landed as 7 rows');
  assert(client1.selectRows('league_seq_counters')[0].next_seq === 3, 'league_seq_counters ends at max(seq)+1 after messages (2 messages -> next_seq=3)');

  const orphansNone = findOrphans(rowsByTable, client1);
  assert(Object.keys(orphansNone).length === 0, 'findOrphans: no orphans when the export is re-applied against itself');

  // Simulate week 2 removed from a later export -> its game/pick become orphans.
  const w2 = createWeek('2026', 2);
  const g2 = createGame(w2.weekId);
  const store3 = { ...store, cfbp_weeks: [...store.cfbp_weeks, w2], cfbp_games: [...store.cfbp_games, g2] };
  const rowsByTable3 = buildRowsForImport(store3, exportBundle, ctx, { commissionerId: 'p1', seasonPayload: null });
  const client3 = newMock();
  await applyRowsByTable(rowsByTable3, client3, ctx);
  const orphansAfterRemoval = findOrphans(rowsByTable, client3);   // re-plan against the SMALLER export
  assert(orphansAfterRemoval.games && orphansAfterRemoval.games.includes(g2.gameId), 'findOrphans: a game removed from the export is reported as an orphan');
  assert(orphansAfterRemoval.weeks && orphansAfterRemoval.weeks.includes(w2.weekId), 'findOrphans: a week removed from the export is reported as an orphan');
}

// ─── [4b] the JS<->SQL seam: RED against the pre-fix SQL, GREEN against the fixed SQL ────
// REV F3 / REV F4. These are the proofs that section [4]'s green run means something. The seam
// check is only evidence if it goes RED on the shapes that were actually broken — so each case
// below rebuilds a deliberately PRE-FIX schema (a scratch copy in memory, never a mutated file)
// and asserts the mock refuses rows the projection really emits.
console.log('\n[4b] import_rows seam — parsed from 0003_functions.sql, RED on the pre-fix shapes…');
{
  assert(SCHEMA.size >= 20, `seam: parsed ${SCHEMA.size} import_rows branches out of 0003_functions.sql`);
  assert(SCHEMA.has('league_seq_counters'), 'seam: 0003 now HAS a league_seq_counters branch (REV F3)');
  assert(SCHEMA.get('comments').has('extra'), 'seam: import_rows("comments") accepts `extra` (REV F4)');
  assert(SCHEMA.get('notifications').has('extra'), 'seam: import_rows("notifications") accepts `extra` (REV F4)');
  assert(!SCHEMA.get('scribe_reports').has('run_id'), 'seam: import_rows("scribe_reports") has no run_id column (REV n11)');

  /** A copy of the parsed schema with `mutate` applied — the pre-fix shape, in memory only. */
  function preFixSchema(mutate) {
    const copy = new Map([...SCHEMA].map(([t, cols]) => [t, new Set(cols)]));
    mutate(copy);
    return copy;
  }
  async function expectRefusal(label, schema, table, rows, needle) {
    const client = new MockImportRowsClient({ schema });
    let err = null;
    try { await client.importRows(table, rows, CTX); } catch (e) { err = e; }
    assert(!!err && err.message.includes(needle), label, err ? err.message : '(no error thrown)');
  }

  const ctx = CTX;

  // REV F4 — comments.extra. The projection emits `extra` on every comment row (it is where an
  // unmodeled legacy field and the `__absent` list live). Against the pre-fix column list,
  // jsonb_to_recordset dropped it silently: the count matched, the hash matched on both sides
  // because both sides were missing it, and the data was simply gone.
  const commentRows = toRows.cfbp_comments(
    [{ commentId: 'c_seam', weekId: 'w1', gameId: 'g1', authorId: 'p1', authorKind: 'player',
       body: 'x', createdAt: new Date().toISOString(), someUnmodeledField: 42 }], ctx).comments;
  assert('extra' in commentRows[0] && commentRows[0].extra.someUnmodeledField === 42,
    'seam: the projection really does emit comments.extra with the unmodeled field in it');
  await expectRefusal('seam RED: pre-fix comments branch REFUSES the projection\'s `extra` column',
    preFixSchema((m) => m.get('comments').delete('extra')), 'comments', commentRows, 'no recordset column "extra"');

  // REV F4 — notifications.extra. `deliveryState` has no column of its own and rides in `extra`,
  // so the pre-fix branch silently discarded every notification's delivery record.
  const notifRows = toRows.cfbp_notifications(
    [{ id: 'n_seam', playerId: 'p1', event: 'PICKS_OPEN', actor: null, title: 't', body: 'b',
       destination: null, createdAt: new Date().toISOString(), readAt: null, dedupKey: 'd',
       deliveryState: { inApp: 'delivered' }, weekId: 'w1', meta: null }], ctx).notifications;
  assert(notifRows[0].extra.deliveryState.inApp === 'delivered',
    'seam: the projection really does carry deliveryState in notifications.extra');
  await expectRefusal('seam RED: pre-fix notifications branch REFUSES the projection\'s `extra` column',
    preFixSchema((m) => m.get('notifications').delete('extra')), 'notifications', notifRows, 'no recordset column "extra"');

  // REV F3 — league_seq_counters had no branch at all, so the importer's third step would have
  // hit the `else` arm and raised bad_table, aborting the whole import.
  await expectRefusal('seam RED: with no league_seq_counters branch, the importer\'s call is refused (bad_table)',
    preFixSchema((m) => m.delete('league_seq_counters')), 'league_seq_counters',
    [{ league_id: 'L1', next_seq: 1 }], 'no branch for table "league_seq_counters"');

  // REV n11 — the same check, from the other direction: an emitted key the SQL does not name.
  await expectRefusal('seam RED: a scribe_reports row carrying run_id is refused (REV n11\'s pre-fix shape)',
    SCHEMA, 'scribe_reports',
    [{ league_id: 'L1', id: 'run_1', ord: 0, run_id: 'run_1', payload: {}, created_at: null }],
    'no recordset column "run_id"');

  // GREEN, against the real schema — the same rows the RED cases used.
  {
    const client = newMock();
    let threw = null;
    try {
      await client.importRows('comments', commentRows, ctx);
      await client.importRows('notifications', notifRows, ctx);
      await client.importRows('league_seq_counters', [{ league_id: 'L1', next_seq: 1 }], ctx);
      await client.importRows('scribe_reports', toRows.cfbp_scribe_reports([report1], ctx).scribe_reports, ctx);
    } catch (e) { threw = e; }
    assert(!threw, 'seam GREEN: every one of those rows is accepted by the FIXED schema', threw?.message);
  }

  // And an unknown table is refused outright, which is what import_rows' `else` arm does.
  await expectRefusal('seam: an entirely unknown table is refused (import_rows raises bad_table)',
    SCHEMA, 'not_a_real_table', [{ league_id: 'L1', id: 'x' }], 'no branch for table');

  // Every table applyRowsByTable pushes must have a branch — the whole-plan version of the above.
  {
    const store = exportBundle.store;
    const planCtx = { leagueId: 'L1', memberIds: new Set(store.cfbp_players.map((p) => p.playerId)) };
    const rowsByTable = buildRowsForImport(store, exportBundle, planCtx, { commissionerId: 'p1', seasonPayload: { season: {}, obligations: [] } });
    const missing = Object.keys(rowsByTable).filter((t) => !SCHEMA.has(t));
    assert(missing.length === 0, 'seam: every table the importer plans rows for has an import_rows branch', JSON.stringify(missing));
  }
}

// ─── [5] member-ref hard stop ──────────────────────────────────────────────
console.log('\n[5] checkMemberRefs — hard stop on an unresolved reference…');
{
  const store = exportBundle.store;
  const map = buildMemberIdMap(store);
  const clean = checkMemberRefs(store, exportBundle, map, { commissionerId: 'p1' });
  assert(clean.ok, 'checkMemberRefs: clean fixture passes with zero errors');

  const badStore = { ...store, cfbp_picks: [...store.cfbp_picks, { pickId: 'pk_bad', weekId: 'w1', gameId: 'g1', playerId: 'p999', selectedTeam: 'Alpha' }] };
  const bad = checkMemberRefs(badStore, exportBundle, map, { commissionerId: 'p1' });
  assert(!bad.ok && bad.errors.some((e) => e.value === 'p999'), 'checkMemberRefs: an unresolved playerId is reported, not silently dropped');

  const literalOk = checkMemberRefs({ ...store, cfbp_comments: [{ commentId: 'c1', authorId: 'bot', authorKind: 'bot', body: 'x', createdAt: new Date().toISOString() }] }, exportBundle, map, { commissionerId: 'p1' });
  assert(literalOk.ok, 'checkMemberRefs: the literal "bot" author is allow-listed, not flagged');

  const badCommissioner = checkMemberRefs(store, exportBundle, map, { commissionerId: 'p999' });
  assert(!badCommissioner.ok, 'checkMemberRefs: --commissioner must also resolve through the map');
}

// ─── [6] verifyImport / verifyMessages / verifySeasonArchive ──────────────
console.log('\n[6] verifyImport / verifyMessages / verifySeasonArchive…');
{
  const store = exportBundle.store;
  const ctx = { leagueId: 'L1', memberIds: new Set(store.cfbp_players.map((p) => p.playerId)) };
  const seasonPayload = { season: { label: 'CFP 2K25' }, obligations: [] };
  const rowsByTable = buildRowsForImport(store, exportBundle, ctx, { commissionerId: 'p1', seasonPayload });
  const client = newMock();
  await applyRowsByTable(rowsByTable, client, ctx);

  const v = verifyImport(store, client, ctx);
  assert(v.allOk, 'verifyImport: every key ✅ against a freshly-imported mock');
  assert(v.rows.length === Object.keys(KEY_TABLES).length - 1, 'verifyImport: checks every KEY_TABLES entry except SEASON_2025');

  const vm = verifyMessages(exportBundle, client);
  assert(vm.ok && vm.contiguous && vm.count === 2, 'verifyMessages: count+hash+contiguity all ✅');

  const vn = verifyNotifyLog(exportBundle, client);
  assert(vn.ok && vn.count === 1, 'verifyNotifyLog: count+hash ✅, and does not double-count client-origin notifications');

  const vsm = verifyScribeMemory(exportBundle, client);
  assert(vsm.ok && vsm.count === 1, 'verifyScribeMemory: count+hash ✅');

  const vs = verifySeasonArchive(seasonPayload, client, ctx);
  assert(vs.ok, 'verifySeasonArchive: hash ✅ against the mock');

  // Tamper: mutate a stored result directly in the mock DB, prove it's caught.
  const badClient = newMock();
  await applyRowsByTable(rowsByTable, badClient, ctx);
  const resultsTable = badClient.tables.get('results');
  const firstRow = [...resultsTable.values()][0];
  resultsTable.set(firstRow.id, { ...firstRow, correct_picks: 999 });
  const vBad = verifyImport(store, badClient, ctx);
  assert(!vBad.allOk, 'verifyImport: a tampered DB row is caught (❌, not silently ✅)');
  assert(vBad.rows.find((r) => r.key === 'cfbp_results' && !r.ok), 'verifyImport: the tampered key specifically is cfbp_results');

  // ── DI-T7.7 END TO END: a MIXED-CASE Sheet email imports, verifies, and re-imports ───────
  //
  // The shared fixture above uses already-lower-case addresses, so it cannot see this at all.
  // This is the case that actually exists in the live Sheet — a founder who typed
  // `Drew@Example.com` — and it is the one that breaks if only ONE side of verifyImport is
  // normalized: the store side keeps the capital letter, the Supabase side does not (the
  // projection lower-cases unconditionally now that `extra.__email_case` is gone), the two sha256
  // hashes differ, and the importer exits 1 refusing a correct import.
  //
  // Its own store and its own mock, so nothing here can perturb sections [7]-[9].
  {
    const mixedStore = {
      ...store,
      cfbp_players: store.cfbp_players.map((p, i) => (i === 0 ? { ...p, email: 'Ann.Capital@Example.COM' } : p)),
    };
    const mixedCtx = { leagueId: 'L1', memberIds: new Set(mixedStore.cfbp_players.map((p) => p.playerId)) };
    const mixedBundle = { ...exportBundle, store: mixedStore };
    const mixedRows = buildRowsForImport(mixedStore, mixedBundle, mixedCtx, { commissionerId: 'p1', seasonPayload });
    const mixedClient = newMock();
    await applyRowsByTable(mixedRows, mixedClient, mixedCtx);

    const stored = [...mixedClient.tables.get('league_members').values()].find((r) => r.id === 'p1');
    assert(stored.email === 'ann.capital@example.com',
      'DI-T7.7 e2e: the mixed-case Sheet address is STORED lower-cased');
    assert(!JSON.stringify(stored.extra).includes('@'),
      'DI-T7.7 e2e: and no copy of it rides in the member-readable `extra` blob');

    const vMixed = verifyImport(mixedStore, mixedClient, mixedCtx);
    assert(vMixed.allOk,
      'DI-T7.7 e2e: verifyImport still reports ✅ on every key — the both-sides normalizer is what makes a lower-cased address match a capitalised Sheet (one-sided, this is exit 1)');
    assert(vMixed.rows.find((r) => r.key === 'cfbp_players' && r.ok),
      'DI-T7.7 e2e: and cfbp_players specifically is ✅, not merely allOk by luck');

    // Re-import the SAME export into the SAME mock: idempotent, and still verified.
    await applyRowsByTable(mixedRows, mixedClient, mixedCtx);
    const stored2 = [...mixedClient.tables.get('league_members').values()].find((r) => r.id === 'p1');
    assert(canonicalize(stored) === canonicalize(stored2),
      'DI-T7.7 e2e: a re-import writes the identical row (the case change happens once, on the way in)');
    assert(verifyImport(mixedStore, mixedClient, mixedCtx).allOk,
      'DI-T7.7 e2e: and the re-imported league still verifies ✅ (no drift, no false diff on the second run)');
  }

  // ── REVIEWER F-9 / SECURITY 5: THE CREDENTIAL ALARM, RESTORED EXPLICITLY ─────────────────
  //
  // Before DI-T7.7 only the STORE side was credential-stripped, so a credential that had somehow
  // reached the database made the two hashes differ and stopped the import — by accident.
  // Normalizing both sides (required for the email case) silenced that. So verifyImport now checks
  // for the credential KEYS on the DB side explicitly, names them, and fails that key.
  //
  // Simulated the only honest way: put `pinHash` back on a row already in the mock DB, which is
  // exactly what a projection bug or a hand-written row would look like. The key is written with a
  // deliberately EMPTY value to make the point that presence, not truthiness, is the test.
  {
    const leakClient = newMock();
    await applyRowsByTable(rowsByTable, leakClient, ctx);
    const members = leakClient.tables.get('league_members');
    const victim = [...members.values()][0];
    members.set(victim.id, { ...victim, extra: { ...victim.extra, pinHash: '' } });

    const vLeak = verifyImport(store, leakClient, ctx);
    const playersRow = vLeak.rows.find((r) => r.key === 'cfbp_players');
    assert(!vLeak.allOk && playersRow && !playersRow.ok,
      'F-9: a credential key reaching the database FAILS verifyImport (the alarm the both-sides normalizer would otherwise have silenced)');
    assert(playersRow.credentialLeak && playersRow.credentialLeak.includes('pinHash'),
      'F-9: and the failure NAMES the credential field, so the report says what to go and look for');
    assert(playersRow.hashMatch === true,
      'F-9: while the hashes still MATCH — which is precisely why this check has to be explicit rather than a side effect of an asymmetric normalizer');
    assert(Array.isArray(playersRow.credentialLeak) &&
      playersRow.credentialLeak.every((f) => typeof f === 'string') &&
      playersRow.credentialLeak.join(',') === 'pinHash',
      'F-9: and what it carries is a list of NAMES, nothing else — credentialKeysPresent reads keys and never touches a value');
    // A real credential value, to prove presence is what is tested and that the value is not
    // echoed into the report.
    members.set(victim.id, { ...victim, extra: { ...victim.extra, pinHash: 'TOTALLY-SECRET' } });
    const vLeak2 = verifyImport(store, leakClient, ctx);
    const row2 = vLeak2.rows.find((r) => r.key === 'cfbp_players');
    assert(!vLeak2.allOk && !JSON.stringify(row2).includes('TOTALLY-SECRET'),
      'F-9: a non-empty credential value is caught too, and does NOT appear anywhere in the verification row');
  }
}

// ─── [7] computeResultsDrift ────────────────────────────────────────────────
console.log('\n[7] computeResultsDrift — exit 0 on a match, exit 3 on tampered stored results…');
{
  const store = exportBundle.store;
  const clean = await computeResultsDrift(store, {});
  if (!clean.ok) {
    console.log('    (fixture drift detail, for debugging if this fails):', JSON.stringify(clean.drifts, null, 2));
  }
  assert(clean.ok && clean.exitCode === EXIT.OK, 'computeResultsDrift: fixture recompute matches stored results exactly (exit 0)');

  const tamperedStore = { ...store, cfbp_results: store.cfbp_results.map((r, i) => i === 0 ? { ...r, correctPicks: 999 } : r) };
  const tampered = await computeResultsDrift(tamperedStore, {});
  assert(!tampered.ok && tampered.exitCode === EXIT.DRIFT, 'computeResultsDrift: a tampered stored result is caught (exit 3)');
  assert(tampered.drifts.some((d) => d.field === 'correctPicks'), 'computeResultsDrift: the drift line names the specific field');

  const allowed = await computeResultsDrift(tamperedStore, { allowDrift: true });
  assert(allowed.exitCode === EXIT.OK, '--allow-drift downgrades a real drift from exit 3 to exit 0 (printed warning is the caller\'s job)');
}

// ─── [8] crossCheckBackup ───────────────────────────────────────────────────
console.log('\n[8] crossCheckBackup — Full Backup vs. Sheet export…');
{
  const store = exportBundle.store;
  const matchingBackup = {
    settings: store.cfbp_settings, players: store.cfbp_players, weeks: store.cfbp_weeks, games: store.cfbp_games,
    picks: store.cfbp_picks, results: store.cfbp_results, obligations: store.cfbp_obligations,
    nicknames: store.cfbp_nicknames, tiebreakerGuesses: store.cfbp_tiebreaker_guesses, extraPointGuesses: store.cfbp_extra_point_guesses,
  };
  const good = crossCheckBackup(store, matchingBackup);
  assert(good.ok, 'crossCheckBackup: a backup taken at the same moment as the export matches');

  const staleBackup = { ...matchingBackup, picks: [] };
  const bad = crossCheckBackup(store, staleBackup);
  assert(!bad.ok && bad.mismatches.includes('cfbp_picks'), 'crossCheckBackup: a stale backup is caught, and the specific key is named');
}

// ─── [9] --dry-run wiring: verification table with diff=0 / nonzero exit ──
console.log('\n[9] --dry-run wiring — diff=0 on a fixture export, nonzero on a tampered one…');
{
  // "Dry-run" here means: run the whole plan/verify pipeline WITHOUT ever
  // calling a real network client — exactly what --dry-run means in main().
  // Proven directly against the mock (no network/service-role key exists to
  // prove it against the real CLI end to end — see [10] for what IS proven
  // about the CLI's own wiring).
  const store = exportBundle.store;
  const ctx = { leagueId: 'L1', memberIds: new Set(store.cfbp_players.map((p) => p.playerId)) };
  const rowsByTable = buildRowsForImport(store, exportBundle, ctx, { commissionerId: 'p1' });
  const client = newMock();
  await applyRowsByTable(rowsByTable, client, ctx);
  const v = verifyImport(store, client, ctx);
  const diff = v.rows.filter((r) => !r.ok).length;
  assert(diff === 0, '--dry-run-style verify: diff=0 on a fixture export that matches');

  const tamperedClient = newMock();
  await applyRowsByTable(rowsByTable, tamperedClient, ctx);
  tamperedClient.tables.get('games').forEach((row, id) => tamperedClient.tables.get('games').set(id, { ...row, home_score: 9999 }));
  const vBad = verifyImport(store, tamperedClient, ctx);
  const diffBad = vBad.rows.filter((r) => !r.ok).length;
  assert(diffBad > 0, '--dry-run-style verify: a tampered mock produces diff > 0 (would be a nonzero CLI exit)');
}

// ─── [10] the real CLI: SUPABASE_SERVICE_ROLE_KEY unset -> exit 2 ─────────
console.log('\n[10] Real CLI process, service-role key unset -> exit 2 (proves wiring without ever holding a key)…');
const cliPath = path.join(__dirname, 'supabase', 'import', 'import-backup.mjs');
{
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const res = spawnSync(process.execPath, [cliPath, '--export', 'nonexistent.json', '--league', 'L1', '--commissioner', 'p1'], { env, encoding: 'utf8' });
  assert(res.status === EXIT.NO_SERVICE_ROLE, `import-backup.mjs exits ${EXIT.NO_SERVICE_ROLE} with SUPABASE_SERVICE_ROLE_KEY unset (got ${res.status})`);

  const res2 = spawnSync(process.execPath, [cliPath, '--service-role-key', 'shouldnotmatter'], { env, encoding: 'utf8' });
  assert(res2.status === EXIT.NO_SERVICE_ROLE, 'import-backup.mjs refuses a --service-role-key argument outright, never reads it');
  assert(!res2.stdout.includes('shouldnotmatter') && !res2.stderr.includes('shouldnotmatter'), 'the refused key value is never echoed anywhere');
}

// ─── [11] REV F2 — main() is actually WIRED, proven end to end ────────────
// The finding: main() built the row plan, printed it, and returned — it never called
// applyRowsByTable, verifyImport, computeResultsDrift or findOrphans, never instantiated
// SupabaseImportClient, and silently ignored --prune and --allow-drift. Every one of those
// functions had its own green unit test, which is precisely why nobody noticed.
//
// A unit test cannot catch that again, because the defect was in the CALLING, not the callee. So
// this section runs the REAL CLI, as a child process, against a LOCAL HTTP server that speaks
// just enough PostgREST for the tool's three verbs (rpc/import_rows, select, delete). No Supabase
// project, no service-role key, no network beyond 127.0.0.1 — and the whole pipeline executes.
console.log('\n[11] REV F2 — the real CLI against a local PostgREST stand-in (plan -> apply -> verify -> drift -> orphans)…');
{
  const os = await import('node:os');
  const fs = await import('node:fs/promises');

  /**
   * Async child runner. NOT spawnSync: spawnSync blocks this process's event loop until the child
   * exits, so the local HTTP server below — which lives in this same process — could never answer
   * the child's requests, and the two would deadlock. ([10] above still uses spawnSync, correctly:
   * those runs never reach the network.)
   */
  function runNode(args, env) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfbp-import-'));
  const exportPath = path.join(tmpDir, 'export.json');
  await fs.writeFile(exportPath, JSON.stringify(exportBundle));

  /** Enough PostgREST to run the importer against. Row storage and upsert semantics are the same
   *  MockImportRowsClient the unit tests use, including the parsed-schema seam check — so a
   *  column the SQL does not name fails HERE too, in the CLI path. */
  function startFakePostgrest({ seed = {}, dropOnRead = null, injectOnSecondSnapshot = null } = {}) {
    const db = newMock();
    const putRow = (table, row) => {
      if (!db.tables.has(table)) db.tables.set(table, new Map());
      db.tables.get(table).set(row[db._pk(table)], row);
    };
    for (const [table, rows] of Object.entries(seed)) for (const row of rows) putRow(table, row);
    const seen = { imported: [], selected: [], deleted: [], injected: false };
    const getCounts = new Map();
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (!req.headers.apikey || !req.headers.authorization) return send(401, { message: 'no key' });
        const url = new URL(req.url, 'http://x');

        if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/import_rows') {
          const { p_table, p_rows } = JSON.parse(body);
          seen.imported.push({ table: p_table, count: p_rows.length });
          try { await db.importRows(p_table, p_rows, CTX); } catch (e) { return send(400, { message: e.message }); }
          return send(200, {});
        }
        const table = url.pathname.replace('/rest/v1/', '');
        if (req.method === 'GET') {
          seen.selected.push(table);
          const n = (getCounts.get(table) || 0) + 1;
          getCounts.set(table, n);
          // REV F4: main() reads the whole league TWICE — once for the orphan gate (whose cache is
          // then reused by verify), and once at the very end for the final orphan re-check. This
          // hook plants a row between the two, at the first GET of the SECOND snapshot. It is
          // invisible to the gate, invisible to verify, and visible only to the fresh read — which
          // is precisely the window a concurrent writer occupies, and precisely what the old
          // final check (which re-used the FIRST cache) could not see.
          if (injectOnSecondSnapshot && table === injectOnSecondSnapshot.triggerTable && n === 2) {
            putRow(injectOnSecondSnapshot.table, injectOnSecondSnapshot.row);
            seen.injected = true;
          }
          let rows = db.selectRows(table);
          if (dropOnRead && dropOnRead.table === table) rows = rows.slice(1);
          return send(200, rows);
        }
        if (req.method === 'DELETE') {
          const pk = db._pk(table);
          const raw = url.searchParams.get(pk) || '';
          const ids = raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
          seen.deleted.push({ table, ids });
          db.deleteRows(table, ids);
          return send(204, {});
        }
        return send(404, { message: 'unhandled' });
      });
    });
    return { server, db, seen };
  }

  async function runCli(extraArgs, { seed, dropOnRead, injectOnSecondSnapshot } = {}) {
    const fake = startFakePostgrest({ seed, dropOnRead, injectOnSecondSnapshot });
    await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
    const port = fake.server.address().port;
    try {
      const res = await runNode(
        [cliPath, '--export', exportPath, '--league', 'L1', '--commissioner', 'p1', '--no-archive-2025', ...extraArgs],
        { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'fake-local-key' },
      );
      return { res, ...fake };
    } finally {
      fake.server.close();
    }
  }

  // --dry-run must stop after the plan, having touched nothing.
  {
    const { res, seen } = await runCli(['--dry-run']);
    assert(res.status === EXIT.OK, `--dry-run exits 0 (got ${res.status}) — ${res.stderr.slice(0, 300)}`);
    assert(seen.imported.length === 0 && seen.selected.length === 0, '--dry-run writes NOTHING and reads NOTHING');
    assert(res.stdout.includes('planned rows for') && res.stdout.includes('NOTHING written'), '--dry-run prints the plan table and says so');
  }

  // The full run: apply -> verify -> drift -> orphans, exit 0.
  let firstDb = null;
  {
    const { res, seen, db } = await runCli([]);
    firstDb = db;
    assert(res.status === EXIT.OK, `full run exits 0 (got ${res.status}) — ${res.stderr.slice(0, 600)}`);
    assert(seen.imported.length > 0, 'REV F2 — main() actually CALLED applyRowsByTable (import_rows was invoked)');
    assert(seen.imported.some((c) => c.table === 'picks') && seen.imported.some((c) => c.table === 'messages'),
      'REV F2 — the apply pass covered picks and messages, not just the first table');
    const order = seen.imported.map((c) => c.table);
    assert(order.indexOf('league_kv') === 0 && order.indexOf('league_members') === 1 && order.indexOf('league_seq_counters') === 2,
      `REV F2 — DI-183c's upsert order is preserved (got ${order.slice(0, 4).join(' -> ')})`);
    assert(order.lastIndexOf('league_seq_counters') > order.indexOf('messages'),
      'REV F2 — league_seq_counters is revisited AFTER messages, with the real max(seq)+1');
    assert(seen.selected.length > 0, 'REV F2 — main() actually CALLED verifyImport (it read every table back)');
    assert(res.stdout.includes('verification ✅'), 'REV F2 — the per-key count+sha256 table was printed and passed');
    assert(res.stdout.includes('results drift ✅'), 'REV F2 — main() actually CALLED computeResultsDrift');
    assert(res.stdout.includes('orphans ✅'), 'REV F2 — main() actually CALLED findOrphans');
    assert(res.stdout.includes('DONE'), 'REV F2 — the run reports completion');
    assert(db.selectRows('picks').length === 2, 'REV F2 — the picks really landed in the stand-in database');
  }

  // Idempotent: a second run against a database that already holds the first run's rows.
  {
    const seed = {};
    for (const [table, store] of firstDb.tables) seed[table] = [...store.values()];
    const { res } = await runCli([], { seed });
    assert(res.status === EXIT.OK, `a second run over the same data exits 0 (got ${res.status}) — ${res.stderr.slice(0, 400)}`);
  }

  // Verification diff -> exit 1. The stand-in hides one row on read; nothing else changes.
  {
    const { res } = await runCli([], { dropOnRead: { table: 'picks' } });
    assert(res.status === EXIT.DIFF, `a verification diff exits ${EXIT.DIFF} (got ${res.status})`);
    assert(res.stderr.includes('VERIFICATION DIFF'), 'the verification diff is reported, not swallowed');
  }

  // Orphans -> exit 1 without --prune; deleted, re-verified and exit 0 with it.
  {
    const orphanSeed = { games: [{ league_id: 'L1', id: 'g_orphan', week_id: 'w_gone', home_team: 'Old', away_team: 'Gone', extra: {} }] };
    const { res: noPrune } = await runCli([], { seed: orphanSeed });
    assert(noPrune.status === EXIT.DIFF, `orphans without --prune exit ${EXIT.DIFF} (got ${noPrune.status})`);
    assert(noPrune.stderr.includes('g_orphan'), 'the orphan row is named, not just counted');
    assert(noPrune.stderr.includes('--prune'), 'the message says what to do about it');

    const { res: pruned, seen, db } = await runCli(['--prune'], { seed: orphanSeed });
    assert(pruned.status === EXIT.OK, `--prune exits 0 after deleting and re-verifying (got ${pruned.status}) — ${pruned.stderr.slice(0, 400)}`);
    assert(seen.deleted.some((d) => d.table === 'games' && d.ids.includes('g_orphan')), '--prune actually issued the DELETE');
    assert(!db.selectRows('games').some((r) => r.id === 'g_orphan'), '--prune removed the orphan from the database');
    assert(pruned.stdout.includes('post-prune re-verification ✅'), '--prune RE-VERIFIES afterwards (a half-done delete reads like a clean one)');
    // The ordering deviation, asserted rather than described: with orphans present, running
    // verifyImport first would ALWAYS diff (an orphan is by definition a row the db has and the
    // export does not), so --prune would be unreachable code. The prune must precede the verify.
    assert(pruned.stdout.indexOf('pruned 1 row(s) from games') < pruned.stdout.indexOf('verification ✅'),
      '--prune runs BEFORE the verification, which is the only order in which either can pass');
    assert(!seen.deleted.some((d) => ['messages', 'league_members', 'audit_log'].includes(d.table)),
      '--prune never touches messages / league_members / audit_log');
  }

  // REV F4 — a row that appears AFTER the apply pass must still be caught, by the FINAL re-check.
  // Before the fix this check re-used the very cache the orphan gate had already cleared, so it
  // could only ever pass: a check that cannot fail reads like coverage and provides none.
  {
    const { res, seen } = await runCli([], {
      injectOnSecondSnapshot: {
        triggerTable: 'league_kv',   // first table of the second snapshot
        table: 'games',
        row: { league_id: 'L1', id: 'g_late_arrival', week_id: 'w_gone', home_team: 'Late', away_team: 'Arrival', extra: {} },
      },
    });
    assert(seen.injected, 'REV F4 — the stand-in actually planted the late row (otherwise this proves nothing)');
    assert(res.status === EXIT.DIFF, `REV F4 — a row that appears after the apply pass exits ${EXIT.DIFF} (got ${res.status}) — ${res.stderr.slice(0, 300)}`);
    assert(res.stderr.includes('fresh read'), 'REV F4 — and it is the FINAL, fresh-read orphan check that reports it');
    assert(res.stderr.includes('g_late_arrival'), 'REV F4 — the late row is named');
    assert(res.stdout.includes('verification ✅'), 'REV F4 — verification had already passed, so this could only be caught by the re-read');
    assert(res.stderr.includes('wrote to this league while the import was running'),
      'REV F4 — and the message says what that actually means');
  }

  // Results drift -> exit 3, and --allow-drift downgrades it.
  {
    const tampered = JSON.parse(JSON.stringify(exportBundle));
    tampered.store.cfbp_results[0].correctPicks = 999;
    const driftPath = path.join(tmpDir, 'export-drift.json');
    await fs.writeFile(driftPath, JSON.stringify(tampered));

    const fake = startFakePostgrest({});
    await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
    const port = fake.server.address().port;
    const env = { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'fake-local-key' };
    const base = [cliPath, '--export', driftPath, '--league', 'L1', '--commissioner', 'p1', '--no-archive-2025'];
    const drifted = await runNode(base, env);
    assert(drifted.status === EXIT.DRIFT, `results drift exits ${EXIT.DRIFT} (got ${drifted.status}) — ${drifted.stderr.slice(0, 400)}`);
    assert(drifted.stderr.includes('correctPicks'), 'the drift line names the specific field');

    const allowed = await runNode([...base, '--allow-drift'], env);
    assert(allowed.status === EXIT.OK, `--allow-drift downgrades the same run to 0 (got ${allowed.status}) — ${allowed.stderr.slice(0, 400)}`);
    assert(allowed.stderr.includes('ACCEPTED'), '--allow-drift says out loud that it accepted a real drift');
    fake.server.close();
  }

  // Setup errors stay exit 2, and never 1 — a missing argument is not a data disagreement.
  {
    const fake = startFakePostgrest({});
    await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
    const port = fake.server.address().port;
    const env = { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'fake-local-key' };
    const noArgs = await runNode([cliPath], env);
    assert(noArgs.status === EXIT.NO_SERVICE_ROLE, `missing required arguments exits ${EXIT.NO_SERVICE_ROLE} (got ${noArgs.status})`);
    const badFile = await runNode([cliPath, '--export', path.join(tmpDir, 'nope.json'), '--league', 'L1', '--commissioner', 'p1'], env);
    assert(badFile.status === EXIT.NO_SERVICE_ROLE, `an unreadable --export exits ${EXIT.NO_SERVICE_ROLE} (got ${badFile.status})`);
    fake.server.close();
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
}

// ─── [12] export-sheet.mjs refuses to write a credential dump into the repo ───
console.log('\n[12] SEC F10 — export-sheet.mjs refuses an --out path inside a git working tree…');
{
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const { gitWorkingTreeFor } = await import('./supabase/import/export-sheet.mjs');
  const exportCli = path.join(__dirname, 'supabase', 'import', 'export-sheet.mjs');

  assert(!!gitWorkingTreeFor(path.join(__dirname, 'supabase', 'import', 'x.json')),
    'gitWorkingTreeFor: a path inside this repo is recognised as in-tree');

  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfbp-out-'));
  assert(gitWorkingTreeFor(path.join(outsideDir, 'x.json')) === null,
    'gitWorkingTreeFor: a path under the OS temp dir is not in any working tree');

  const inTree = spawnSync(process.execPath, [exportCli, '--out', path.join(__dirname, 'supabase', 'import', 'dump.json')], { encoding: 'utf8' });
  assert(inTree.status === 2, `export-sheet refuses an in-tree --out (exit 2, got ${inTree.status})`);
  assert(inTree.stderr.includes('inside the git working tree'), 'the refusal says why');
  assert(inTree.stderr.includes('pinHash'), 'the refusal says what is in the file that makes it matter');
  assert(inTree.stderr.includes('--allow-in-tree'), 'the refusal names the deliberate override');

  await fs.rm(outsideDir, { recursive: true, force: true });
}

// ─── [13] THE FIRST REAL IMPORT (2026-09-18) — two comparator defects ────────
//
// Both were found by Drew's first real import against the dev Supabase project, both reported as
// a hash MISMATCH on a key whose COUNT matched, and in both cases the rows in Supabase were
// CORRECT — what was wrong was the comparison. That is the shape to recognise: `count=N db=N
// hash=MISMATCH` means "the same records, described differently," not "data lost."
//
// Everything below is deliberately writable against the projection module ALONE — no mock client,
// no importer, no CLI — for two reasons. First, it is the layer the defect is in. Second, and this
// is the reason [13b] existed to be found at all: `MockImportRowsClient` stores whatever object it
// is handed, so it cannot reproduce a Postgres COLUMN-TYPE COERCION. Sections [4], [6] and [11]
// all ran green on a notifications row whose `actor` was an object in a `text` column. Where that
// coercion is what matters, [13b] models it explicitly instead of trusting the mock.
//
// MIRROR-EXTRACT BEGIN [13] — this block is extracted verbatim by the scratch mirror harness and
// evaluated against a pre-fix copy of js/supabase-projection.js to prove it goes RED. It therefore
// uses only: assert, deepEqual, canonicalize, toIso, normalizeForCompare, toRows, fromRows,
// notifyLogToRow, rowToNotifyLog, messageToRow, actorToColumn, actorFromColumn, createWeek,
// createGame, CTX — and declares every fixture of its own.
console.log('\n[13a] kickoff without seconds — the cfbp_games hash MISMATCH on the first real import…');
{
  // The exact value in the Sheet: ESPN kickoff strings carry no seconds.
  const SHEET_KICKOFF = '2026-08-29T21:30Z';
  const FULL_ISO = '2026-08-29T21:30:00.000Z';

  // THE DEFECT, in one line. `kickoff` is a `ts` column, so the DB side is normalized by `toIso`;
  // the store side was left alone because ISO_RE demanded seconds. Same instant, two hashes.
  assert(canonicalize(SHEET_KICKOFF) === canonicalize(FULL_ISO),
    'canonicalize: a no-seconds kickoff and its full-ISO form are the SAME canonical value (the 38-row cfbp_games mismatch)');
  assert(canonicalize(SHEET_KICKOFF) === JSON.stringify(FULL_ISO),
    'canonicalize: and the canonical form is the full ISO string, not the short one (normalization, not leniency)');

  // toIso is pinned on the no-seconds shape (fix item 2): JS Date does parse it, and to the same
  // instant. If a future engine ever stopped, this assertion says so before the importer does.
  assert(toIso(SHEET_KICKOFF) === FULL_ISO && toIso('2026-08-29T21:30:00Z') === FULL_ISO,
    'toIso: a no-seconds string produces the IDENTICAL output to the full one');

  // Every spelling of that same instant — including the microsecond form PostgREST returns for a
  // timestamptz, and both offset notations — collapses to one canonical value.
  const SAME_INSTANT = [
    '2026-08-29T21:30Z',
    '2026-08-29T21:30:00Z',
    '2026-08-29T21:30:00.000Z',
    '2026-08-29T21:30:00.000000Z',
    '2026-08-29T21:30:00+00:00',
    '2026-08-29T21:30:00+0000',
    '2026-08-29T21:30+00:00',
    '2026-08-29T16:30:00-05:00',
    '2026-08-29T16:30-05:00',
  ];
  for (const s of SAME_INSTANT) {
    assert(canonicalize(s) === JSON.stringify(FULL_ISO),
      `canonicalize: '${s}' canonicalizes to the one instant ${FULL_ISO}`);
  }

  // …and each of them survives the games round trip with canonicalize equality, which is the
  // property verifyImport actually tests.
  for (const s of [...SAME_INSTANT, '2026-08-29T21:30:00.5Z', '2026-09-05T20:15:00.123456+00:00', '2026-08-29T21:30:00-05:00']) {
    const g = { gameId: 'g_k1', weekId: 'w_k1', homeTeam: 'Alpha', awayTeam: 'Beta', kickoff: s };
    const back = fromRows.cfbp_games(toRows.cfbp_games([g], CTX), CTX)[0];
    assert(canonicalize([g]) === canonicalize([back]),
      `games: a game with kickoff '${s}' round-trips to an EQUAL canonical form`);
  }

  // Sub-millisecond precision, stated as a limit rather than left to be discovered: Date truncates
  // below the millisecond, so a Postgres microsecond value compares equal to the millisecond value
  // that produced it (which is the whole point) and NOT to a different millisecond.
  assert(canonicalize('2026-09-05T20:15:00.123456+00:00') === canonicalize('2026-09-05T20:15:00.123Z'),
    'canonicalize: Postgres microseconds collapse onto the millisecond the app wrote (the fractional-digit half of the fix)');
  assert(canonicalize('2026-08-29T21:30:00.5Z') !== canonicalize('2026-08-29T21:30:00Z'),
    'canonicalize: but a real half-second difference is still a difference — widening the pattern did not make it lenient');

  // DATE-ONLY STRINGS ARE NOT TIMESTAMPS. `weeks.start_date`/`end_date` are the commissioner's
  // calendar dates (deliberately not `ts` columns) and a game request carries a date-only
  // `gameDate`. `new Date('2026-08-29')` parses happily, so the ONLY thing keeping these as typed
  // is that the pattern requires the `T`.
  assert(canonicalize('2026-08-29') === JSON.stringify('2026-08-29'),
    'canonicalize: a DATE-ONLY string is left exactly as it is (not rewritten to midnight UTC)');
  assert(canonicalize('g_1785991043548_bu2n9') === JSON.stringify('g_1785991043548_bu2n9'),
    'canonicalize: a game id is left exactly as it is');
  {
    const wk = createWeek('2026', 1, '2026-08-28', '2026-09-01');
    const row = toRows.cfbp_weeks([wk], CTX).weeks[0];
    assert(row.start_date === '2026-08-28' && row.end_date === '2026-09-01',
      'weeks: start_date/end_date are written as the commissioner\'s date-only TEXT, never toIso\'d');
    const back = fromRows.cfbp_weeks({ weeks: [row] }, CTX)[0];
    assert(back.startDate === '2026-08-28' && back.endDate === '2026-09-01',
      'weeks: and they come back date-only, byte-for-byte');
    assert(canonicalize([wk]) === canonicalize([back]),
      'weeks: the whole week round-trips to an equal canonical form with date-only fields present');
  }
  {
    const gr = { id: 'gr_k1', kind: 'request', playerId: 'p1', espnEventId: '1', gameDate: '2026-09-05',
      kickoff: '2026-09-05T20:15Z', createdAt: '2026-09-01T00:00:00.000Z' };
    const back = fromRows.cfbp_game_requests(toRows.cfbp_game_requests([gr], CTX), CTX)[0];
    assert(back.gameDate === '2026-09-05',
      'game_requests: a date-only `gameDate` in the jsonb payload is not rewritten by the round trip');
    assert(canonicalize([gr]) === canonicalize([back]),
      'game_requests: and the record with a no-seconds kickoff beside a date-only gameDate canonicalizes equal');
  }

  // A ZONE IS MANDATORY — this is the RG-38 guard. `new Date('2026-08-29T21:30')` is LOCAL time:
  // 21:30Z under TZ=UTC, 04:30Z the next day under TZ=America/Los_Angeles. If the pattern admitted
  // it, the canonical form (and therefore the import verdict) would depend on the operator's
  // timezone. These two assertions are why this suite is run under both zones.
  assert(canonicalize('2026-08-29T21:30') === JSON.stringify('2026-08-29T21:30'),
    'canonicalize: a ZONE-LESS date-time is NOT normalized (it is local time — normalizing it would make the hash TZ-dependent, RG-38)');
  assert(canonicalize('2026-08-29T21:30:00') === JSON.stringify('2026-08-29T21:30:00'),
    'canonicalize: same for the zone-less form WITH seconds (the old pattern did not admit it either — this pins that it still does not)');

  // A string the widened pattern matches but Date cannot parse must stay a STRING. Nulling it
  // would erase it from both sides of the hash, so two DIFFERENT bad timestamps would compare
  // EQUAL and the import would be declared clean.
  assert(canonicalize('2026-13-01T00:00Z') === JSON.stringify('2026-13-01T00:00Z'),
    'canonicalize: an ISO-SHAPED but unparseable timestamp is left as the string it is, never nulled');
  assert(canonicalize('2026-13-01T00:00Z') !== canonicalize('2026-14-01T00:00Z'),
    'canonicalize: so two different bad timestamps still compare as different (nulling both would have hidden a real diff)');

  // THE FULL-STORE REGRESSION — the comparison verifyImport actually performs, on both sides, with
  // the value that was in the Sheet. This is the assertion that was RED before the fix.
  {
    const w = createWeek('2026', 1, '2026-08-28', '2026-09-01');
    const g = createGame(w.weekId, { homeTeam: 'Alpha', awayTeam: 'Beta', spread: -3.5, favorite: 'Alpha' });
    g.kickoff = SHEET_KICKOFF;                       // exactly what ESPN/the Sheet holds
    const store = { cfbp_weeks: [w], cfbp_games: [g] };
    for (const key of ['cfbp_weeks', 'cfbp_games']) {
      const dbValue = fromRows[key](toRows[key](store[key], CTX), CTX);
      const hashA = canonicalize(normalizeForCompare(key, store[key]));
      const hashB = canonicalize(normalizeForCompare(key, dbValue));
      assert(hashA === hashB,
        `verifyImport-style compare: ${key} hashes IDENTICALLY on both sides with a no-seconds kickoff in the store (the reported MISMATCH)`);
    }
    // Fix item 4, answered by assertion: `toRows` DOES normalize on the way in — the `ts` column
    // type already did this, which is precisely why only one side moved.
    const row = toRows.cfbp_games([g], CTX).games[0];
    assert(row.kickoff === FULL_ISO,
      'games: toRows normalizes kickoff to full ISO on the way IN (the `ts` type already did — the DB holds …:00.000Z, and always did)');
    // And what a consumer that later reads that normalized string does with it. Every kickoff
    // consumer in the app parses with Date/Date.parse — none compares kickoff strings lexically —
    // so the two spellings are interchangeable to all of them. Pinned as arithmetic here; the
    // grep that establishes "none compares lexically" is in the handoff.
    assert(new Date(SHEET_KICKOFF).getTime() === new Date(row.kickoff).getTime(),
      'consumers: the Sheet spelling and the normalized DB spelling are the same instant to Date-based logic (isGamePickable, computeFirstKickoff, the kickoff sorts)');
  }
}

console.log('\n[13b] notify-log `actor` — an OBJECT in a TEXT column (the notify_log hash MISMATCH)…');
{
  /**
   * What Postgres/PostgREST does to a value sent for a `text` column: a string is stored as it is,
   * anything else arrives as its JSON text. The mock client does NOT do this — it stores the
   * object — which is exactly why every existing section stayed green on the broken row. Modelled
   * here so the coercion is part of the test rather than part of the surprise.
   */
  const coerceTextColumn = (v) => (v === null || v === undefined ? null : (typeof v === 'string' ? v : JSON.stringify(v)));

  const baseRec = (actor) => ({
    seq: 1, id: 'nl_a1', playerId: 'p1', event: 'PICKS_LOCKING_SOON', actor,
    title: 't', body: 'b', destination: null, createdAt: '2026-09-05T20:15:00.000Z',
    dedupKey: 'd1', weekId: null, meta: {},
  });

  for (const actor of [{ kind: 'scribe', playerId: null }, { kind: 'commissioner', playerId: 'p1' }]) {
    const rec = baseRec(actor);
    const row = notifyLogToRow(rec, CTX);
    // THE ONE ASSERTION THE DEFECT FAILS: the column value must already BE text, so the database
    // has no representation choice left to make.
    assert(typeof row.actor === 'string',
      `notify_log: actor is written to the TEXT column as TEXT for ${JSON.stringify(actor)} (an object here is what Postgres silently coerced)`);
    assert(coerceTextColumn(row.actor) === row.actor,
      'notify_log: so the database\'s own coercion is a NO-OP on what we send (nothing changes shape on the wire)');
    const back = rowToNotifyLog({ ...row, actor: coerceTextColumn(row.actor) });
    assert(deepEqual(back.actor, actor),
      `notify_log: and the actor comes back as the OBJECT the app model uses (${JSON.stringify(actor)})`);
    assert(canonicalize(rec) === canonicalize(back),
      'notify_log: the whole record round-trips through the coerced column to an EQUAL canonical form (the count=7 hash=MISMATCH)');
  }

  // null / undefined / legacy plain-string actors.
  {
    const nullRow = notifyLogToRow(baseRec(null), CTX);
    assert(nullRow.actor === null && rowToNotifyLog(nullRow).actor === null,
      'notify_log: a null actor stays null in both directions (unchanged behaviour)');
    const undefRec = baseRec(undefined);
    delete undefRec.actor;
    assert(notifyLogToRow(undefRec, CTX).actor === null,
      'notify_log: a missing actor is still written as null, exactly as before');
    const strRow = notifyLogToRow(baseRec('p1'), CTX);
    assert(strRow.actor === 'p1' && rowToNotifyLog(strRow).actor === 'p1',
      'notify_log: a legacy PLAIN-STRING actor stays a plain string — it is not wrapped, quoted or reinterpreted');
    assert(actorFromColumn('123') === '123' && actorFromColumn('system') === 'system',
      'actorFromColumn: text that is not object/array-shaped is returned UNCHANGED (\'123\' must not become the number 123)');
    assert(actorFromColumn('{not json') === '{not json',
      'actorFromColumn: text that only LOOKS like JSON and does not parse is returned unchanged, never nulled');
    assert(actorToColumn(null) === null && actorToColumn(undefined) === null,
      'actorToColumn: null/undefined -> null');
  }

  // KEY ORDER. The same actor built by two call sites must produce the same column bytes, or a
  // re-import rewrites the row and `verifyImport` reports a diff that is really just insertion
  // order. JSON.stringify alone does NOT give this — it preserves insertion order.
  {
    const a = notifyLogToRow(baseRec({ kind: 'commissioner', playerId: 'p1' }), CTX).actor;
    const b = notifyLogToRow(baseRec({ playerId: 'p1', kind: 'commissioner' }), CTX).actor;
    assert(a === b, 'notify_log: {kind,playerId} and {playerId,kind} produce the IDENTICAL column text (keys are sorted)');
    assert(a === JSON.stringify({ kind: 'commissioner', playerId: 'p1' }),
      'notify_log: and that text is the key-sorted JSON of the actor, so the bytes are a function of the value alone');
    const rec = baseRec({ playerId: 'p1', kind: 'commissioner' });
    const row1 = notifyLogToRow(rec, CTX);
    const row2 = notifyLogToRow(rowToNotifyLog({ ...row1, actor: coerceTextColumn(row1.actor) }), CTX);
    assert(canonicalize(row1) === canonicalize(row2),
      'notify_log: re-projecting the restored record yields an identical row (a re-import is a genuine no-op)');
  }

  // An `undefined` INSIDE the actor must not make the key vanish — JSON.stringify drops it, which
  // would change the shape on the way back and put the diff straight back.
  {
    const rec = baseRec({ kind: 'system', playerId: undefined });
    const row = notifyLogToRow(rec, CTX);
    assert(row.actor === JSON.stringify({ kind: 'system', playerId: null }),
      'notify_log: an undefined field inside the actor is written as null, not dropped');
    const back = rowToNotifyLog({ ...row, actor: coerceTextColumn(row.actor) });
    assert(back.actor.kind === 'system' && back.actor.playerId === null && canonicalize(rec) === canonicalize(back),
      'notify_log: so the shape survives and the record still canonicalizes equal');
  }

  // THE SAME DEFECT LIVES IN THE CLIENT-ORIGIN PROJECTION — `cfbp_notifications` maps `actor` to
  // the same `text` column, so fixing only the notify-log path would have left half of it in place.
  {
    const notif = {
      id: 'n_a1', playerId: 'p1', event: 'PICKS_OPEN', actor: { kind: 'commissioner', playerId: 'p1' },
      title: 'Picks are open', body: 'Go pick.', destination: { tab: 'picks' },
      createdAt: '2026-09-05T20:15:00.000Z', readAt: null, dedupKey: 'PICKS_OPEN|w1|p1',
      deliveryState: { inApp: 'delivered', push: 'skipped' }, weekId: 'w1', meta: { foo: 'bar' },
    };
    const row = toRows.cfbp_notifications([notif], CTX).notifications[0];
    assert(typeof row.actor === 'string',
      'cfbp_notifications: the client-origin projection also writes actor as TEXT');
    assert(coerceTextColumn(row.actor) === row.actor,
      'cfbp_notifications: and the database coercion is a no-op there too');
    const back = fromRows.cfbp_notifications({ notifications: [{ ...row, actor: coerceTextColumn(row.actor) }] }, CTX)[0];
    assert(deepEqual(back.actor, notif.actor),
      'cfbp_notifications: the actor object comes back intact through the coerced column');
    assert(canonicalize(normalizeForCompare('cfbp_notifications', [notif]))
      === canonicalize(normalizeForCompare('cfbp_notifications', [back])),
      'verifyImport-style compare: cfbp_notifications hashes IDENTICALLY on both sides with an object actor');
    assert(deepEqual(back.destination, notif.destination) && deepEqual(back.meta, notif.meta),
      'cfbp_notifications: `destination` and `meta` are jsonb and keep carrying objects verbatim — only the TEXT column needed a representation');
  }

  // AND THE FIELDS THAT ARE NOT AFFECTED, asserted rather than assumed. `comments.author_id` and
  // `messages.author` are member-id strings by design; if a future change ever made one of them
  // structured, this is where it would be noticed.
  {
    const c = { commentId: 'c_a1', weekId: 'w1', gameId: 'g1', authorId: 'p1', authorKind: 'player',
      body: 'x', createdAt: '2026-09-05T20:15:00.000Z' };
    const crow = toRows.cfbp_comments([c], CTX).comments[0];
    assert(typeof crow.author_id === 'string' && crow.author_id === 'p1',
      'comments: author_id is an unchanged member-id STRING (not touched by the actor fix)');
    const mrow = messageToRow({ seq: 1, id: 'm1', ts: 1756503000000, type: 'message', author: 'p1',
      gameTag: '', body: 'hi', targetId: '', replyTo: '', notify: false, meta: null }, CTX);
    assert(typeof mrow.author === 'string' && mrow.author === 'p1',
      'messages: author is an unchanged member-id STRING (not touched by the actor fix)');
  }
}
// MIRROR-EXTRACT END [13]

// ─── [13c] THE CLASS, not the instance — no structured value may be written to a
//     column that is not `jsonb` ─────────────────────────────────────────────────
//
// [13b] fixes ONE field. This is the rule it broke, and it is the guard that makes the whole class
// impossible rather than that one field: a legacy value that is an OBJECT can only be written to a
// `jsonb` column. Sent to any other column type, PostgREST/Postgres picks a representation for it
// — text gets JSON, and the value comes back a string — and NO in-memory test can see that,
// because nothing in memory performs the coercion. `MockImportRowsClient` stores what it is given,
// so sections [4], [6] and [11] all ran green on the broken `actor` row for as long as it existed.
//
// The column TYPES are parsed out of the real `0001_schema.sql`, the same way `SCHEMA` above is
// parsed out of `0003_functions.sql` and for the same reason: a hand-kept list of "which columns
// are jsonb" is a second opinion that drifts. Every `cfbp_*` key must appear in the fixture
// registry below, asserted — a guard that quietly stops covering a key is not a guard.
console.log('\n[13c] no structured value reaches a non-jsonb column (the CLASS the `actor` defect belonged to)…');
{
  const SCHEMA_SQL_PATH = path.join(__dirname, 'supabase', 'migrations', '0001_schema.sql');
  const schemaSql = readFileSync(SCHEMA_SQL_PATH, 'utf8');

  /** table -> Map(column -> declared type token), from the DDL text. */
  function parseColumnTypes(sql) {
    const byTable = new Map();
    const re = /create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g;
    const RESERVED = new Set(['primary', 'foreign', 'unique', 'check', 'constraint', 'exclude', 'like']);
    let m;
    while ((m = re.exec(sql)) !== null) {
      const cols = new Map();
      for (const raw of m[2].split('\n')) {
        const line = raw.replace(/--.*$/, '').trim();
        if (!line) continue;
        const cm = /^([a-z_][a-z0-9_]*)\s+([a-z][a-z0-9_ ]*?)(\s|\(|,|$)/.exec(line);
        if (!cm || RESERVED.has(cm[1])) continue;
        cols.set(cm[1], cm[2].trim().split(/\s+/)[0]);
      }
      byTable.set(m[1], cols);
    }
    return byTable;
  }
  const COLUMN_TYPES = parseColumnTypes(schemaSql);
  assert(COLUMN_TYPES.size >= 20, `class guard: parsed ${COLUMN_TYPES.size} tables out of 0001_schema.sql`);
  assert(COLUMN_TYPES.get('notifications').get('actor') === 'text',
    'class guard: and it really reads `notifications.actor` as TEXT — the fact the whole rule turns on');
  assert(COLUMN_TYPES.get('notifications').get('meta') === 'jsonb' &&
    COLUMN_TYPES.get('league_members').get('preferences') === 'jsonb',
    'class guard: while `meta` and `preferences` read as jsonb (so the rule is discriminating, not vacuous)');

  // One OBJECT-RICH fixture per key — every field whose legacy value can be structured is
  // populated, because a field left null proves nothing about where an object would land.
  const richPlayer = {
    ...createPlayer('Rich', 'rich@example.com', '4321', 'Ohio State', 'RP'),
    playerId: 'p1',
    notifyPrefs: { master: true, categories: { chat: false } },
    preferences: { tz: 'CT', theme: 'dark', sectionOrder: ['a', 'b'], notifyCategories: { league: true } },
  };
  const richWeek = {
    ...createWeek('2026', 1, '2026-08-28', '2026-09-01'),
    lockedAlmaMaters: [{ playerId: 'p1', almaMater: 'Ohio State' }],
    extraPointDetect: { mode: 'sum', gameIds: ['g1'] },
  };
  const richObligation = { ...obligation1, mergedFrom: ['ob_2', 'ob_3'] };
  const richNotification = {
    ...notif1,
    actor: { kind: 'commissioner', playerId: 'p1' },
    destination: { tab: 'picks', weekId: 'w1' },
    meta: { nested: { deep: true } },
    deliveryState: { inApp: 'delivered', push: 'sent' },
  };
  const richNotifyLogRec = {
    seq: 1, id: 'nl_c1', playerId: 'p1', event: 'PICKS_LOCKING_SOON',
    actor: { kind: 'scribe', playerId: null }, title: 't', body: 'b',
    destination: { tab: 'picks' }, createdAt: '2026-09-05T20:15:00.000Z',
    dedupKey: 'd1', weekId: 'w1', meta: { a: { b: 1 } },
  };
  const richMessage = {
    seq: 1, id: 'm_c1', ts: Date.now(), type: 'message', author: 'p1', gameTag: 'g1',
    body: 'hi', targetId: '', replyTo: '', notify: true, meta: { mentions: ['p2'] },
  };
  const richMemory = {
    id: 'mem_c1', playerId: 'p1', kind: 'fact', key: 'k', value: 'v', provenance: 'chat',
    confidence: 0.7, createdAt: '2026-09-05T20:15:00.000Z', reviewAt: '', sourceMessageId: 'm1', refreshedAt: null,
  };

  const CLASS_FIXTURES = {
    cfbp_settings: { season: '2026', nested: { a: 1 } },
    cfbp_players: [richPlayer],
    cfbp_weeks: [richWeek],
    cfbp_games: [game1],
    cfbp_picks: [pick1],
    cfbp_results: [result1],
    cfbp_obligations: [richObligation],
    cfbp_nicknames: { 'w1__p1': 'Big Ann' },
    cfbp_lock_overrides: { g1: 'unlocked' },
    cfbp_tiebreaker_guesses: { 'w1__p1': 45 },
    cfbp_extra_point_guesses: { 'w1__p1': 38 },
    cfbp_rejected_suggestions: { w1: ['espn123'] },
    cfbp_reactions: { w1: { g1: { '🔥': ['p1'] } } },
    cfbp_feedback: [feedback1],
    cfbp_feedback_excluded_ids: ['fb_1'],
    cfbp_comments: [comment1],
    cfbp_active_week: 'w1',
    cfbp_fetch_proof: { fetchedAt: '2026-09-05T20:15:00.000Z', gamesFound: 12 },
    cfbp_notifications: [richNotification],
    cfbp_scribe_learnings: [learning1],
    cfbp_scribe_canon: [canon1],
    cfbp_scribe_reports: [report1],
    cfbp_game_requests: [gameRequest1],
    SEASON_2025: { season: { label: 'CFP 2K25' }, obligations: [{ id: 'x' }] },
  };
  const uncovered = Object.keys(KEY_TABLES).filter((k) => !(k in CLASS_FIXTURES));
  assert(uncovered.length === 0, 'class guard: EVERY key in KEY_TABLES has a fixture here', JSON.stringify(uncovered));

  /** Every column of every row: an object value is only legal in a json/jsonb column. RETURNS the
   *  offenders rather than asserting, so the same scanner can be pointed at the defect it was
   *  written for (the `scanExtraWrites` precedent in supabase/tests/static.check.mjs). */
  function scanRows(rowsByTable) {
    const offenders = [];
    for (const [table, rows] of Object.entries(rowsByTable)) {
      const cols = COLUMN_TYPES.get(table);
      if (!cols) { offenders.push(`${table}: NOT FOUND in 0001_schema.sql`); continue; }
      for (const row of rows) {
        for (const [col, v] of Object.entries(row)) {
          const type = cols.get(col);
          if (!type) { offenders.push(`${table}.${col}: no such column in the DDL`); continue; }
          if (type === 'jsonb' || type === 'json') continue;
          if (v !== null && typeof v === 'object') {
            offenders.push(`${table}.${col} is ${type} but received a ${Array.isArray(v) ? 'array' : 'object'}`);
          }
        }
      }
    }
    return offenders;
  }
  const checkRows = (label, rowsByTable) => {
    const offenders = scanRows(rowsByTable);
    assert(offenders.length === 0,
      `class guard: ${label} writes no structured value into a non-jsonb column`, offenders.join('; '));
  };

  for (const key of Object.keys(KEY_TABLES)) {
    checkRows(key, toRows[key](CLASS_FIXTURES[key], CTX));
  }
  // The three paged event logs are not in `toRows` and get checked the same way.
  checkRows('messageToRow', { messages: [messageToRow(richMessage, CTX)] });
  checkRows('notifyLogToRow', { notifications: [notifyLogToRow(richNotifyLogRec, CTX)] });
  checkRows('memoryToRow', { scribe_memory: [memoryToRow(richMemory, CTX)] });

  // And the rule is load-bearing, proven the only honest way: point the scanner at the PRE-FIX row
  // (the actor object put straight into the text column) and require it to report exactly that.
  // Without this, a rule that never fires looks exactly like a rule that always passes.
  {
    const preFixRow = { ...notifyLogToRow(richNotifyLogRec, CTX), actor: richNotifyLogRec.actor };
    const offenders = scanRows({ notifications: [preFixRow] });
    assert(offenders.length === 1 && offenders[0] === 'notifications.actor is text but received a object',
      'class guard: RED on the PRE-FIX row — an actor OBJECT in the text column is caught, and named',
      JSON.stringify(offenders));
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
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
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
