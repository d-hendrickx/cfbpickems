/**
 * CFB Pickems — adaptertest.mjs
 * ==============================
 * Phase III Step 4 Part A, DI-T4.9 §9.1-§9.3. The offline proof of
 * `js/supabase-backend.js`: the state machine, the flush planner, the per-key
 * routing, the composite writes, the contact write rule, the write-during-
 * switch gate, loud-fail, the offline rule, the first-boot wipe, Realtime's
 * JOINED-vs-LIVE gap, and the byte-identity of `load()` between the two
 * adapters on a projected league.
 *
 * Run:  node adaptertest.mjs
 *       for tz in UTC America/Los_Angeles; do TZ=$tz node adaptertest.mjs; done
 *
 * Precedent: `authtest.mjs` / `grouptest.mjs` — a focused standalone suite
 * beside `loadtest.mjs`, not folded into it. Part B wires it into loadtest's
 * spawned list (`loadtest.mjs` is a Part B file and is NOT edited here).
 *
 * ── THE MOCK IS A MODEL, AND IT MUST BE ABLE TO REFUSE ──────────────────────
 * The assessment's §10 standard is blunt: "A mock that always succeeds tests
 * nothing." So the fake client below is a PostgREST-shaped in-memory store
 * with RLS-LIKE FILTERING, driven by a JS model of `0002_rls.sql`'s grant
 * table, its policy table and its guard triggers, plus `0003_functions.sql`'s
 * RPC guards — parameterised by the fake session's
 * `{ userId, memberId, role, leagueId }`. Every refusal comes back the way
 * PostgREST returns one: `{ error: { code: '42501', message } }` for a
 * privilege or WITH CHECK failure, `{ data: [], error: null }` for a USING
 * clause that matched no row, and `{ error: { message: '<named>' } }` for an
 * RPC's own exception (`not_commissioner`, `bad_transition`, `not_member`, …).
 *
 * IT IS A MODEL, NOT TRUTH, and the line is stated rather than blurred:
 * `supabase/tests/rls.test.mjs` on the real project remains the proof of the
 * SQL; this file proves the ADAPTER'S RESPONSE to it. Where the two could
 * drift, the live suite is authoritative.
 *
 * ── WHAT THIS FILE CANNOT PROVE, said plainly ───────────────────────────────
 * Three assertions the DI's table names are PART B work by construction, and
 * they are declared as known-gap SKIPS rather than asserted against code that
 * does not exist yet (the `gskip` discipline `supabase/tests/rls.test.mjs:135-159`
 * established: a skip is printed, counted separately, carries its reason and
 * its follow-up, and is never a silent deletion or a green that proves
 * nothing):
 *   A9b  `ensureSeedData()` seeds no USER_MUTABLE_KEYS in the new mode — the
 *        mode test is one line in `js/storage.js:338`, a Part B file.
 *   A14b `clearDeviceLocalSessionData()` calls `dropMirror()` — the call site
 *        is in `js/auth.js:2098`, a Part B file. `dropMirror()`'s own contract
 *        IS asserted here (A14).
 *   A17  the Sheets relay allow-list in `call()` — `js/backend.js:665-688`, a
 *        Part B file.
 *
 * WHAT THE MOCK DELIBERATELY DOES NOT MODEL, named so nobody reads its green as
 * wider than it is (security O-4):
 *   • `is_platform_admin()`. `get_member_contacts()` has a platform-admin
 *     all-rows branch (`0007_contact_privacy.sql:158`) and this mock has only
 *     the commissioner / member / not_member ones. No adapter behaviour depends
 *     on it — the adapter never runs as a platform admin, and
 *     `week_submission_status` has no such branch BY DESIGN (0008's S8 register
 *     entry says why). `rls.test.mjs`'s CT1.rpc-admin is the live coverage.
 *   • the `notifications` COMPOSITE FOREIGN KEY `(league_id, member_id) ->
 *     league_members` and the `(league_id, member_id, dedup_key, origin)`
 *     unique constraint (`0001_schema.sql`, notifications). The mock accepts any
 *     `member_id` a policy admits, so it cannot fail an insert the database
 *     would fail on referential grounds. The adapter refuses every
 *     notifications write on BOTH sides of §2.1's table, so there is no client
 *     path for that to matter in Step 4 — but if one is ever opened, this is the
 *     gap to close first.
 *
 * Runtime rendering is not covered by any of this; the handoff names what to
 * click.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── device stubs (the authtest.mjs pattern, trimmed to what the adapter uses:
//    localStorage and console. No DOM — the adapter touches none.) ───────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
};
globalThis.window = globalThis;

const _realLog = console.log.bind(console);
const _realErr = console.error.bind(console);
let pass = 0, fail = 0;
const failures = [];
const SKIPPED = [];
function assert(cond, label) {
  if (cond) { pass++; _realLog('  ✅', label); }
  else { fail++; failures.push(label); _realErr('  ❌', label); }
}
function skip(code, reason) {
  SKIPPED.push({ code, reason });
  _realLog(`  ⏭  ${code} SKIPPED — ${reason}`);
}

/**
 * PER-SECTION ISOLATION, and it is not decoration — it is RG-41d's lesson applied to this suite.
 *
 * Found while running §9.2's `planner-patches-status` mutant: with the status diff no longer
 * recognised, the finalize op vanished from the plan and the NEXT assertion in [A4] dereferenced
 * `fin[0].args`. The suite threw a TypeError, printed no summary, and exited 1 — so the mutation
 * proof read as "the harness is broken" rather than as a failure set, and every section AFTER [A4]
 * never ran. That is exactly the shape that cost `rls.test.mjs` twelve groups on 2026-09-16, and
 * the fix is the same one: each section runs in its own try/catch, a throw costs that section and
 * nothing else, and it is reported by NAME as `runtime-error:<section>` and counted as a failure.
 *
 * A section that threw abandoned its remaining assertions, so its later reds may be collateral —
 * which is why the name is printed again in the summary rather than folded into the count.
 */
const RUNTIME_ERRORS = [];
async function section(label, fn) {
  _realLog(label);
  try {
    await fn();
  } catch (e) {
    fail++;
    failures.push(`runtime-error:${label.trim()}`);
    RUNTIME_ERRORS.push(label.trim());
    _realErr(`  ❌ RUNTIME ERROR in ${label.trim()} — ${(e && (e.stack || e.message)) || e}`);
  }
}
/** Console capture, so an assertion can read what the adapter SAID (a console
 *  line naming a discarded row is part of §2.2's contract, not decoration). */
let _captured = [];
function captureConsole(fn) {
  const w = console.warn, i = console.info, e = console.error;
  _captured = [];
  const sink = (...a) => _captured.push(a.map(String).join(' '));
  console.warn = sink; console.info = sink; console.error = sink;
  try { return fn(); } finally { console.warn = w; console.info = i; console.error = e; }
}
async function captureConsoleAsync(fn) {
  const w = console.warn, i = console.info, e = console.error;
  _captured = [];
  const sink = (...a) => _captured.push(a.map(String).join(' '));
  console.warn = sink; console.info = sink; console.error = sink;
  try { return await fn(); } finally { console.warn = w; console.info = i; console.error = e; }
}
const said = (re) => _captured.some((l) => re.test(l));

const sb = await import('./js/supabase-backend.js');
const proj = await import('./js/supabase-projection.js');
const transport = await import('./js/chatTransport.js');

// ══════════════════════════════════════════════════════════════════════════
// THE MOCK — a PostgREST-shaped store with RLS-like filtering (§9.1)
// ══════════════════════════════════════════════════════════════════════════

const LEAGUE_A = 'L-aaaa';
const LEAGUE_B = 'L-bbbb';
const NOW = Date.UTC(2026, 8, 20, 18, 0, 0);           // fixed instant; TZ-independent by construction

/** `0002_rls.sql:165-193` — the verbs a policy exists for. A verb absent here
 *  is `permission denied for table X` (42501), which is what PostgREST returns
 *  for a missing GRANT, BEFORE any policy runs. 0008 adds comments
 *  insert/delete and notifications insert. */
const GRANTS = {
  league_members: ['select', 'update'],
  league_kv: ['select', 'insert', 'update'],
  weeks: ['select', 'insert', 'update', 'delete'],
  games: ['select', 'insert', 'update', 'delete'],
  picks: ['select', 'insert', 'update', 'delete'],
  tiebreaker_guesses: ['select', 'insert', 'update', 'delete'],
  extra_point_guesses: ['select', 'insert', 'update', 'delete'],
  results: ['select'],
  standings: ['select'],
  obligations: ['select', 'insert', 'update'],
  messages: ['select', 'insert'],
  reactions: ['select', 'insert', 'delete'],
  comments: ['select', 'insert', 'delete'],           // 0008 (was select only)
  feedback: ['select', 'insert', 'update'],
  notifications: ['select', 'update', 'insert'],      // 0008 added insert
  game_requests: ['select', 'insert'],
  scribe_learnings: ['select', 'update'],
  scribe_canon: ['select', 'update'],
  scribe_reports: ['select'],
  season_archives: ['select'],
};

/** `league_members`' SELECT grant is a COLUMN LIST after 0007, and PostgREST
 *  expands `*` to every column — so `select('*')` on that table is refused for
 *  lack of column privilege, for every caller. The mock enforces it, because
 *  that is a real failure mode the adapter has to avoid (it enumerates the
 *  fifteen columns; `js/supabase-backend.js` SELECT_COLS). */
const COLUMN_GRANTS = {
  league_members: new Set('league_id,id,user_id,role,legacy_player_id,display_name,initials,alma_mater,active,notify_prefs,preferences,linked_at,extra,created_at,updated_at'.split(',')),
};

function makeStore() {
  const s = {
    league_members: [
      row({ league_id: LEAGUE_A, id: 'p1', user_id: 'u-drew', role: 'commissioner', display_name: 'Drew', initials: 'DH', alma_mater: 'Iowa State', active: true, email: 'drew@example.com', phone: '+15550000001', phone_verified: true, notify_prefs: {}, preferences: { tz: 'America/Chicago' } }),
      row({ league_id: LEAGUE_A, id: 'p2', user_id: 'u-kevin', role: 'player', display_name: 'Kevin', initials: 'KV', alma_mater: 'Notre Dame', active: true, email: 'kevin@example.com', phone: '', phone_verified: false, notify_prefs: {}, preferences: {} }),
      row({ league_id: LEAGUE_A, id: 'p3', user_id: null, role: 'player', display_name: 'Koby', initials: 'KB', alma_mater: '', active: true, email: 'koby@example.com', phone: '', phone_verified: false, notify_prefs: {}, preferences: {} }),
      // u-drew is a member of BOTH leagues — that is the multi-membership case
      // the switch test needs. u-bcomm is a member of B ONLY, which is what
      // makes §3.3's LAYER 3 observable: a session with no membership in A.
      row({ league_id: LEAGUE_B, id: 'q1', user_id: 'u-drew', role: 'commissioner', display_name: 'Drew', initials: 'DH', alma_mater: '', active: true, email: 'drew@example.com', phone: '', phone_verified: false, notify_prefs: {}, preferences: {} }),
      row({ league_id: LEAGUE_B, id: 'q2', user_id: 'u-bcomm', role: 'commissioner', display_name: 'B Comm', initials: 'BC', alma_mater: '', active: true, email: 'bcomm@example.com', phone: '', phone_verified: false, notify_prefs: {}, preferences: {} }),
    ],
    weeks: [
      row({ league_id: LEAGUE_A, id: 'w1', sport: 'cfb', season: '2026', week_number: 1, label: 'Week 1', status: 'open', picks_lock_at: new Date(NOW + 3600e3).toISOString(), revealed_at: null, locked_at: null, locked_alma_maters: null, pending_finalization: false }),
      row({ league_id: LEAGUE_A, id: 'w2', sport: 'cfb', season: '2026', week_number: 2, label: 'Week 2', status: 'live', picks_lock_at: new Date(NOW - 3600e3).toISOString(), revealed_at: new Date(NOW - 1800e3).toISOString(), locked_at: new Date(NOW - 3600e3).toISOString(), locked_alma_maters: [], pending_finalization: true }),
      row({ league_id: LEAGUE_B, id: 'x1', sport: 'cfb', season: '2026', week_number: 1, label: 'B Week 1', status: 'open', picks_lock_at: null, revealed_at: null }),
    ],
    games: [
      row({ league_id: LEAGUE_A, id: 'g1', week_id: 'w1', home_team: 'Iowa State', away_team: 'Kansas', status: 'scheduled', kickoff: new Date(NOW + 7200e3).toISOString(), spread: -3.5, favorite: 'Iowa State', multiplier: 1, home_score: 0, away_score: 0, last_updated: null, ats_winner: null }),
      row({ league_id: LEAGUE_A, id: 'g2', week_id: 'w1', home_team: 'Purdue', away_team: 'Ohio State', status: 'scheduled', kickoff: new Date(NOW + 10800e3).toISOString(), spread: 7, favorite: 'Ohio State', multiplier: 2, home_score: 0, away_score: 0, last_updated: null, ats_winner: null }),
      row({ league_id: LEAGUE_A, id: 'g3', week_id: 'w2', home_team: 'Iowa', away_team: 'Nebraska', status: 'final', kickoff: new Date(NOW - 10800e3).toISOString(), spread: -1, favorite: 'Iowa', multiplier: 1, home_score: 24, away_score: 21, last_updated: null, ats_winner: null }),
      row({ league_id: LEAGUE_B, id: 'y1', week_id: 'x1', home_team: 'X', away_team: 'Y', status: 'scheduled', kickoff: null, spread: 0, multiplier: 1 }),
    ],
    picks: [
      row({ league_id: LEAGUE_A, id: 'pk1', week_id: 'w1', game_id: 'g1', member_id: 'p1', selected_team: 'Iowa State', selected_at: new Date(NOW - 600e3).toISOString(), updated_at: new Date(NOW - 600e3).toISOString(), locked: false, result: 'pending' }),
      row({ league_id: LEAGUE_A, id: 'pk2', week_id: 'w1', game_id: 'g1', member_id: 'p2', selected_team: 'Kansas', selected_at: new Date(NOW - 500e3).toISOString(), updated_at: new Date(NOW - 500e3).toISOString(), locked: false, result: 'pending' }),
      row({ league_id: LEAGUE_A, id: 'pk3', week_id: 'w1', game_id: 'g2', member_id: 'p2', selected_team: 'Purdue', selected_at: new Date(NOW - 400e3).toISOString(), updated_at: new Date(NOW - 400e3).toISOString(), locked: false, result: 'pending' }),
      row({ league_id: LEAGUE_A, id: 'pk4', week_id: 'w2', game_id: 'g3', member_id: 'p1', selected_team: 'Iowa', selected_at: new Date(NOW - 20000e3).toISOString(), updated_at: new Date(NOW - 20000e3).toISOString(), locked: true, result: 'win' }),
      row({ league_id: LEAGUE_A, id: 'pk5', week_id: 'w2', game_id: 'g3', member_id: 'p2', selected_team: 'Nebraska', selected_at: new Date(NOW - 20000e3).toISOString(), updated_at: new Date(NOW - 20000e3).toISOString(), locked: true, result: 'loss' }),
      row({ league_id: LEAGUE_B, id: 'bk1', week_id: 'x1', game_id: 'y1', member_id: 'q1', selected_team: 'X', selected_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(), locked: false, result: 'pending' }),
    ],
    tiebreaker_guesses: [
      row({ league_id: LEAGUE_A, id: 'tb_w1__p1', week_id: 'w1', member_id: 'p1', guess: 42, updated_at: new Date(NOW).toISOString() }),
      row({ league_id: LEAGUE_A, id: 'tb_w1__p2', week_id: 'w1', member_id: 'p2', guess: 55, updated_at: new Date(NOW).toISOString() }),
    ],
    extra_point_guesses: [
      row({ league_id: LEAGUE_A, id: 'ep_w1__p2', week_id: 'w1', member_id: 'p2', guess: 37, updated_at: new Date(NOW).toISOString() }),
    ],
    league_kv: [
      row({ league_id: LEAGUE_A, key: 'settings', value: { chatEnabled: true, commissionerEmail: 'drew@example.com', autoRefreshInterval: 60 } }),
      row({ league_id: LEAGUE_A, key: 'nicknames', value: { p2: 'The Colonel' } }),
      row({ league_id: LEAGUE_A, key: 'lock_overrides', value: {} }),
      row({ league_id: LEAGUE_A, key: 'active_week', value: 'w1' }),
      row({ league_id: LEAGUE_A, key: 'rejected_suggestions', value: {} }),
      row({ league_id: LEAGUE_A, key: 'fetch_proof', value: null }),
      row({ league_id: LEAGUE_A, key: 'feedback_excluded_ids', value: [] }),
    ],
    results: [
      row({ league_id: LEAGUE_A, id: 'wr_w2_p1', week_id: 'w2', member_id: 'p1', display_name: 'Drew', correct_picks: 1, incorrect_picks: 0, correct_count: 1, incorrect_count: 0, no_decisions: 0, pending: 0, tiebreaker_guess: null, tiebreaker_delta: null, rank: 1, is_winner: true, is_loser: false, won_by_tiebreaker: false }),
    ],
    obligations: [
      row({ league_id: LEAGUE_A, id: 'ob1', type: 'weekly', week_id: 'w2', payer_member_id: 'p2', recipient_member_id: 'p1', amount_or_prize: 'beer', status: 'unpaid', paid_at: null, needs_review: false, review_note: null, voided: false, voided_at: null, void_reason: null, merged_into: null, merged_from: [] }),
    ],
    reactions: [
      row({ league_id: LEAGUE_A, id: 'rx_w1_g1_p2_1f525', week_id: 'w1', game_id: 'g1', member_id: 'p2', emoji: '\u{1f525}', created_at: new Date(NOW).toISOString() }),
    ],
    comments: [
      row({ league_id: LEAGUE_A, id: 'c1', week_id: 'w1', game_id: 'g1', author_id: 'p2', author_member_id: 'p2', author_kind: 'player', bot_event_key: null, body: 'lock of the week', created_at: new Date(NOW - 300e3).toISOString() }),
      // Authored by p1 (the commissioner), so the player session's "another member's comment" case
      // is really another member's. `author_id === author_member_id` on both, which is DI-T4.6a's
      // conjunct and the shape the projection produces.
      row({ league_id: LEAGUE_A, id: 'c2', week_id: 'w1', game_id: 'g1', author_id: 'p1', author_member_id: 'p1', author_kind: 'player', bot_event_key: null, body: 'not so fast', created_at: new Date(NOW - 200e3).toISOString() }),
    ],
    feedback: [
      row({ league_id: LEAGUE_A, id: 'fb1', member_id: 'p2', name: 'Kevin', kind: 'bug', week_id: 'w1', body: 'the chip is tiny', submitted_at: new Date(NOW).toISOString(), app_version: 'v0.21.2', site_url: 'https://irbfootball.com', status: 'new', excluded_from_export: false }),
    ],
    notifications: [
      row({ league_id: LEAGUE_A, id: 'nt1', member_id: 'p1', origin: 'client', event: 'PICKS_OPEN', actor: '{"kind":"commissioner","playerId":"p1"}', title: 'Picks are open', body: 'Week 1', destination: null, created_at: new Date(NOW).toISOString(), read_at: null, dedup_key: 'nt1', week_id: 'w1', meta: null }),
    ],
    scribe_learnings: [
      row({ league_id: LEAGUE_A, id: 'sl_r1_0', ord: 0, run_id: 'r1', kind: 'learning', status: 'pending', payload: { kind: 'learning', learningId: null, runId: 'r1', category: 'tone', instruction: 'be shorter', status: 'pending' }, created_at: new Date(NOW).toISOString() }),
      row({ league_id: LEAGUE_A, id: 'sl_r1_1', ord: 1, run_id: 'r1', kind: 'experiment', status: 'pending', payload: { kind: 'experiment', runId: 'r1', experiment: 'more Kihoon', status: 'pending' }, created_at: new Date(NOW).toISOString() }),
    ],
    scribe_canon: [],
    scribe_reports: [
      row({ league_id: LEAGUE_A, id: 'r1', ord: 0, payload: { runId: 'r1', sections: [] }, created_at: new Date(NOW).toISOString() }),
    ],
    game_requests: [
      row({ league_id: LEAGUE_A, id: 'gr1', kind: 'request', member_id: 'p2', target_request_id: null, created_at: new Date(NOW).toISOString(), payload: { homeTeam: 'Iowa', awayTeam: 'Iowa State', gameDate: '2026-09-12' } }),
    ],
  };
  return s;
}
function row(o) { return { extra: {}, ...o }; }

/** The session shapes the mock understands. `anon` has no `authenticated`
 *  role at all, which is what makes an RPC EXECUTE refusal a 42501 rather than
 *  a named exception. */
const SESSIONS = {
  commissioner: { userId: 'u-drew', memberId: 'p1', leagueId: LEAGUE_A, role: 'commissioner', authenticated: true },
  player: { userId: 'u-kevin', memberId: 'p2', leagueId: LEAGUE_A, role: 'player', authenticated: true },
  nonMember: { userId: 'u-stranger', memberId: null, leagueId: null, role: 'none', authenticated: true },
  anon: { userId: null, memberId: null, leagueId: null, role: 'none', authenticated: false },
  commissionerB: { userId: 'u-drew', memberId: 'q1', leagueId: LEAGUE_B, role: 'commissioner', authenticated: true },
  bOnly: { userId: 'u-bcomm', memberId: 'q2', leagueId: LEAGUE_B, role: 'commissioner', authenticated: true },
};

function refuse(msg) { return { data: null, error: { code: '42501', message: msg } }; }
function named(name) { return { data: null, error: { code: 'P0001', message: name } }; }
/**
 * TEACH THE FAKE: THE PRIMARY KEY (2026-09-19).
 *
 * Every routed table in `0001_schema.sql` is `primary key (league_id, id)` — `league_kv` is
 * `(league_id, key)`. The fake had NO keys and NO constraints, so a second INSERT of a row the
 * store already held simply appended a duplicate and answered 200. That is precisely the shape of
 * the five defects the 2026-09-19 cutover night found live and this suite could not: PostgREST
 * answers `23505` with HTTP 409, the adapter turns it into an `AdapterWriteRefusedError`, and the
 * player gets the red "Nothing was saved" banner for a row that saved perfectly well the first time.
 *
 * `details` carries Postgres's own `Key (league_id, id)=(…) already exists.` wording, because the
 * adapter's `_refusalFrom()` reads `error.code || error.details` and a test that supplied only a
 * code would not notice if that ever changed.
 */
function conflict(table, r, col) {
  return {
    data: null,
    status: 409,
    error: {
      code: '23505',
      message: `duplicate key value violates unique constraint "${table}_pkey"`,
      details: `Key (league_id, ${col})=(${r.league_id}, ${r[col]}) already exists.`,
    },
  };
}

function makeClient(st, session, opts = {}) {
  const calls = { selects: [], inserts: [], updates: [], deletes: [], rpc: [], fetches: 0 };
  const now = () => NOW;

  const isMember = (lid) => !!(session.authenticated && st.league_members.some(
    (m) => m.league_id === lid && m.user_id === session.userId && m.active));
  const isCommissioner = (lid) => !!(session.authenticated && st.league_members.some(
    (m) => m.league_id === lid && m.user_id === session.userId && m.active && m.role === 'commissioner'));
  const myMemberId = (lid) => {
    const m = st.league_members.find((x) => x.league_id === lid && x.user_id === session.userId && x.active);
    return m ? m.id : null;
  };
  const week = (lid, wid) => st.weeks.find((w) => w.league_id === lid && w.id === wid) || null;
  const pickWindowOpen = (lid, wid) => {
    const w = week(lid, wid);
    return !!(w && w.status === 'open' && (!w.picks_lock_at || now() < Date.parse(w.picks_lock_at)));
  };
  const gamePickable = (lid, gid) => {
    const kv = st.league_kv.find((r) => r.league_id === lid && r.key === 'lock_overrides');
    if (kv && kv.value && kv.value[gid] === 'unlocked') return true;
    const g = st.games.find((x) => x.league_id === lid && x.id === gid);
    return !!(g && g.status === 'scheduled' && (!g.kickoff || now() < Date.parse(g.kickoff)));
  };
  const picksVisible = (lid, wid, mid) => {
    if (!isMember(lid)) return false;
    if (mid === myMemberId(lid)) return true;
    const w = week(lid, wid);
    return !!(w && (w.status === 'live' || w.status === 'final'));
  };

  /** `0002_rls.sql:203-340`, verb by verb. `null` means "no policy for this
   *  verb" — which, combined with the GRANTS table, is how 0002 refuses
   *  `league_members` INSERT and `results` INSERT without saying so twice. */
  const POLICY = {
    league_members: {
      select: (r) => isMember(r.league_id),
      update: (r) => isCommissioner(r.league_id) || r.id === myMemberId(r.league_id),
    },
    league_kv: {
      select: (r) => isMember(r.league_id),
      insert: (r) => isCommissioner(r.league_id),
      update: (r) => isCommissioner(r.league_id),
    },
    weeks: {
      select: (r) => isMember(r.league_id),
      insert: (r) => isCommissioner(r.league_id),
      update: (r) => isCommissioner(r.league_id),
      delete: (r) => isCommissioner(r.league_id),
    },
    games: {
      select: (r) => isMember(r.league_id),
      insert: (r) => isCommissioner(r.league_id),
      update: (r) => isCommissioner(r.league_id),
      delete: (r) => isCommissioner(r.league_id),
    },
    picks: {
      select: (r) => picksVisible(r.league_id, r.week_id, r.member_id),
      insert: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id) && gamePickable(r.league_id, r.game_id),
      update: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id) && gamePickable(r.league_id, r.game_id),
      delete: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id) && gamePickable(r.league_id, r.game_id),
    },
    tiebreaker_guesses: {
      select: (r) => picksVisible(r.league_id, r.week_id, r.member_id),
      insert: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id),
      update: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id),
      delete: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id),
    },
    extra_point_guesses: {
      select: (r) => picksVisible(r.league_id, r.week_id, r.member_id),
      insert: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id),
      update: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id),
      delete: (r) => r.member_id === myMemberId(r.league_id) && pickWindowOpen(r.league_id, r.week_id),
    },
    results: { select: (r) => isMember(r.league_id) },
    obligations: {
      select: (r) => isMember(r.league_id),
      insert: (r) => isCommissioner(r.league_id),
      update: (r) => isCommissioner(r.league_id) || [r.payer_member_id, r.recipient_member_id].includes(myMemberId(r.league_id)),
    },
    reactions: {
      select: (r) => isMember(r.league_id),
      insert: (r) => r.member_id === myMemberId(r.league_id),
      delete: (r) => r.member_id === myMemberId(r.league_id),
    },
    // 0008 — the two new policies, modelled exactly as written.
    comments: {
      select: (r) => isMember(r.league_id),
      // DI-T4.6a (reviewer F1) — FOUR conjuncts. `author_id` is the column js/app.js:6456/6458
      // renders and moderates by; binding it to `author_member_id` is what stops a row that
      // satisfies the FK from displaying under somebody else's name.
      insert: (r) => r.author_member_id === myMemberId(r.league_id)
        && r.author_id === r.author_member_id
        && r.author_kind === 'player' && String(r.body || '').length <= 400,
      delete: (r) => r.author_member_id === myMemberId(r.league_id) || isCommissioner(r.league_id),
    },
    feedback: {
      select: (r) => r.member_id === myMemberId(r.league_id) || isCommissioner(r.league_id),
      insert: (r) => isMember(r.league_id) && r.member_id === myMemberId(r.league_id),
      update: (r) => isCommissioner(r.league_id),
    },
    notifications: {
      select: (r) => r.member_id === myMemberId(r.league_id),
      update: (r) => r.member_id === myMemberId(r.league_id),
      insert: (r) => isCommissioner(r.league_id),                 // 0008, Q10
    },
    game_requests: {
      select: (r) => isMember(r.league_id),
      insert: (r) => r.member_id === myMemberId(r.league_id)
        && (r.kind === 'request' || st.game_requests.some((x) => x.league_id === r.league_id && x.id === r.target_request_id && x.kind === 'request' && x.member_id === myMemberId(r.league_id))),
    },
    scribe_learnings: { select: (r) => isMember(r.league_id), update: (r) => isCommissioner(r.league_id) },
    scribe_canon: { select: (r) => isMember(r.league_id), update: (r) => isCommissioner(r.league_id) },
    scribe_reports: { select: (r) => isMember(r.league_id) },
  };

  /** The guard triggers of `0002_rls.sql:365-706`, as BEFORE-UPDATE rules that
   *  can raise 42501. `weekTransition` is the transaction-local GUC the
   *  transition RPCs set (`0003:299`, `:334`, `:404`); a direct PATCH never
   *  has it, which is the whole of A5. */
  const GUARDS = {
    weeks(oldRow, patch, ctxFlags) {
      if ('status' in patch && patch.status !== oldRow.status && !ctxFlags.weekTransition) {
        return 'weeks: status changes require a transition RPC';
      }
      if ('revealed_at' in patch && patch.revealed_at !== oldRow.revealed_at && !ctxFlags.weekTransition) {
        return 'weeks: revealed_at may change only inside a transition RPC';
      }
      return null;
    },
    league_members(oldRow, patch) {
      for (const c of ['user_id', 'claim_code', 'claim_code_expires_at', 'linked_at', 'legacy_player_id', 'id', 'league_id']) {
        if (c in patch && patch[c] !== oldRow[c]) return 'league_members: identity/link columns require a linking RPC';
      }
      if (!isCommissioner(oldRow.league_id)) {
        for (const c of ['role', 'active', 'email', 'phone_verified', 'created_at']) {
          if (c in patch && patch[c] !== oldRow[c]) {
            return 'league_members: only display_name, initials, alma_mater, phone, notify_prefs, preferences, extra may be self-edited';
          }
        }
      }
      return null;
    },
    obligations(oldRow, patch) {
      for (const c of ['payer_member_id', 'recipient_member_id', 'week_id', 'type', 'created_at']) {
        if (c in patch && patch[c] !== oldRow[c]) return 'obligations: payer/recipient/week/type/created_at are immutable';
      }
      if (isCommissioner(oldRow.league_id)) return null;
      for (const c of ['amount_or_prize', 'needs_review', 'review_note', 'voided', 'voided_at', 'void_reason', 'merged_into', 'merged_from', 'extra']) {
        if (c in patch && JSON.stringify(patch[c]) !== JSON.stringify(oldRow[c])) return 'obligations: only status/paid_at may be self-edited';
      }
      return null;
    },
    feedback(oldRow, patch) {
      for (const c of ['member_id', 'name', 'kind', 'week_id', 'body', 'submitted_at', 'app_version', 'site_url']) {
        if (c in patch && patch[c] !== oldRow[c]) return 'feedback: only status/excluded_from_export may change';
      }
      return null;
    },
    notifications(oldRow, patch) {
      for (const c of ['member_id', 'origin', 'event', 'actor', 'title', 'body', 'destination', 'created_at', 'dedup_key', 'week_id', 'meta']) {
        if (c in patch && JSON.stringify(patch[c]) !== JSON.stringify(oldRow[c])) return 'notifications: only read_at may change';
      }
      return null;
    },
    scribe_learnings(oldRow, patch) {
      for (const c of ['id', 'ord', 'run_id', 'created_at', 'kind']) {
        if (c in patch && patch[c] !== oldRow[c]) return 'scribe: only the status column may change';
      }
      return null;
    },
    scribe_canon(oldRow, patch) {
      for (const c of ['id', 'ord', 'run_id', 'created_at']) {
        if (c in patch && patch[c] !== oldRow[c]) return 'scribe: only the status column may change';
      }
      return null;
    },
  };

  const flags = { weekTransition: false };

  function builder(table) {
    const b = {
      _table: table, _eq: [], _in: [], _op: 'select', _cols: '*', _payload: null, _returning: false, _retCols: '*',
      select(cols) {
        if (b._op === 'select') b._cols = cols || '*';
        // REVIEWER N3 — `RETURNING` IS A PROJECTION, and the fake used to ignore it.
        // PostgREST returns the columns the request ASKED FOR, and on `league_members` the adapter
        // asks for SELECT_COLS — which omits email/phone/phone_verified, because 0007's SELECT
        // grant does. A fake that handed back the whole row made an acknowledged contact write look
        // like it had advanced the base when the real server's answer cannot.
        else { b._returning = true; b._retCols = cols || '*'; }
        return b;
      },
      insert(rows) { b._op = 'insert'; b._payload = Array.isArray(rows) ? rows : [rows]; return b; },
      update(patch) { b._op = 'update'; b._payload = patch; return b; },
      delete() { b._op = 'delete'; return b; },
      upsert(rows) { b._op = 'insert'; b._payload = Array.isArray(rows) ? rows : [rows]; return b; },
      eq(col, val) { b._eq.push([col, val]); return b; },
      in(col, vals) { b._in.push([col, vals]); return b; },
      then(resolve, reject) {
        // REVIEWER N2 — A WRITE WHOSE RESPONSE IS SLOW ENOUGH FOR A HYDRATE TO LAND BEHIND IT.
        // The whole of `run(b)` is deferred, not just its return: the store must not move until the
        // caller says the request reached the server, or the test could not stage the ORDER it is
        // about (the hydrate reads a server that does not yet hold this write).
        if (opts.delayWrites && b._op !== 'select') {
          return Promise.resolve(opts.delayWrites()).then(() => run(b)).then(resolve, reject);
        }
        return Promise.resolve(run(b)).then(resolve, reject);
      },
    };
    return b;
  }

  function matches(r, b) {
    return b._eq.every(([c, v]) => r[c] === v) && b._in.every(([c, vs]) => vs.includes(r[c]));
  }

  /** The `RETURNING` list, applied. `'*'` is every column (the tables with no column grant);
   *  anything else is exactly the columns named, which is what PostgREST hands back. */
  function project(rows, cols) {
    if (!cols || cols === '*') return rows.map((r) => ({ ...r }));
    const want = String(cols).split(',').map((s) => s.trim()).filter(Boolean);
    return rows.map((r) => {
      const o = {};
      for (const c of want) if (c in r) o[c] = r[c];
      return o;
    });
  }

  function run(b) {
    calls.fetches++;
    const table = b._table;
    const grant = GRANTS[table] || [];
    // A WRITE THAT NEVER REACHED A SERVER (2026-09-19). The read side has had `throwSelects` /
    // `failSelects` since security F1; the WRITE side had neither, so every write test in this file
    // ran against a server that was always reachable. Both shapes are real: supabase-js lets a
    // `fetch` rejection propagate (`throwWrites`), and some versions catch it and hand back an
    // error OBJECT with an empty `code` and the fetch message (`failWrites`). Checked FIRST,
    // because a transport failure happens before any grant, policy or constraint is consulted.
    if (b._op !== 'select') {
      if (opts.throwWrites) throw opts.throwWrites();
      if (opts.failWrites) {
        const res = { data: null, error: opts.failWrites };
        if (opts.failWriteStatus) res.status = opts.failWriteStatus;
        return res;
      }
      // SECURITY F2 — A HOOK THAT FIRES *DURING* A WRITE, not before or after it.
      //
      // The interleaving the finding is about cannot be staged from outside: `dropMirror()` has to
      // land while one operation of a multi-operation plan is in flight, i.e. between the plan and
      // the NEXT operation. A setTimeout race would prove nothing deterministically. The hook runs
      // where the request would be on the wire — after the transport checks, before the store is
      // touched — so the operation it fires inside of is genuinely SENT and every later one is not.
      if (opts.onWrite) opts.onWrite(table, b._op, b);
    }
    if (!session.authenticated) return refuse(`permission denied for table ${table}`);
    if (!grant.includes(b._op)) return refuse(`permission denied for table ${table}`);
    const pol = (POLICY[table] || {})[b._op];
    if (!pol) return refuse(`permission denied for table ${table}`);

    if (b._op === 'select') {
      calls.selects.push({ table, cols: b._cols, eq: b._eq.slice() });
      // A PARTIAL READ — the transport artifact RG-12 defence (b) exists for:
      // a 200 that carries no rows for a table that has them. Modelled as an
      // override rather than by emptying the store, so `is_member()` and the
      // RPCs keep answering truthfully (an emptied league_members would make
      // the caller a non-member and the test would prove something else).
      if (opts.emptySelects && opts.emptySelects.includes(table)) return { data: [], error: null };
      // REVIEWER F1 — A SELECT THAT FAILS OUTRIGHT, with a caller-chosen code.
      // The three codes that matter to _fail()'s serveable test are different
      // KINDS of failure, not degrees of one: '08006' (the network did not
      // answer), '42501' (the server answered "no" about this device's rights)
      // and 'PGRST301' (the server rejected the token). A mock that could only
      // return rows or empty rows could not tell them apart, and the widen that
      // lets a live page go offline read-only turns entirely on that difference.
      if (opts.failSelects) {
        // `status` sits on the RESPONSE, not on the error — which is the whole
        // of reviewer F4: the SDK leaves `error.code` EMPTY for a body
        // PostgREST did not author, so the only trace of an edge 403 is here.
        // A test that put the status on the error object would pass even if
        // _select() never carried it.
        const res = { data: null, error: opts.failSelects };
        if (opts.failStatus) res.status = opts.failStatus;
        return res;
      }
      // SECURITY F1 — a select that THROWS rather than returning an error
      // object. This is the REAL fetch-failure path: `fetch` rejects, the SDK
      // never builds a PostgREST error, and the exception propagates out of the
      // await in _select(). A mock that could only return `{error}` could not
      // reach the branch that actually fires on a Saturday.
      if (opts.throwSelects) throw opts.throwSelects();
      const allowed = COLUMN_GRANTS[table];
      if (allowed) {
        const asked = b._cols === '*' ? null : String(b._cols).split(',').map((s) => s.trim());
        if (!asked) return refuse(`permission denied for table ${table}`);   // `*` on a column-granted table
        const bad = asked.filter((c) => !allowed.has(c));
        if (bad.length) return refuse(`permission denied for column ${bad[0]}`);
      }
      const rows = st[table].filter((r) => matches(r, b) && pol(r));
      return { data: rows.map((r) => ({ ...r })), error: null };
    }

    if (b._op === 'insert') {
      calls.inserts.push({ table, rows: b._payload });
      for (const r of b._payload) {
        if (!pol(r)) return refuse(`new row violates row-level security policy for table "${table}"`);
      }
      // THE PRIMARY KEY (see conflict() above). Checked AFTER the policy, which is the order
      // Postgres uses: the WITH CHECK runs on a row the statement is allowed to attempt, and a
      // unique violation aborts the whole statement — so one duplicate refuses the batch and
      // nothing in it is stored.
      {
        const col = table === 'league_kv' ? 'key' : 'id';
        const batch = new Set();
        for (const r of b._payload) {
          const k = `${r.league_id} ${r[col]}`;
          if (batch.has(k) || st[table].some((x) => x.league_id === r.league_id && x[col] === r[col])) {
            return conflict(table, r, col);
          }
          batch.add(k);
        }
      }
      const added = b._payload.map((r) => ({ extra: {}, ...r }));
      st[table].push(...added);
      return { data: project(added, b._retCols), error: null };
    }

    const hits = st[table].filter((r) => matches(r, b) && pol(r));
    if (b._op === 'update') {
      calls.updates.push({ table, patch: b._payload, eq: b._eq.slice() });
      const out = [];
      for (const r of hits) {
        const g = GUARDS[table];
        if (g) { const msg = g(r, b._payload, flags); if (msg) return refuse(msg); }
        Object.assign(r, b._payload);
        if (!pol(r)) return refuse(`new row violates row-level security policy for table "${table}"`);
        out.push(r);
      }
      return { data: project(out, b._retCols), error: null };
    }
    calls.deletes.push({ table, eq: b._eq.slice() });
    const removed = [];
    for (const r of hits) {
      const i = st[table].indexOf(r);
      if (i >= 0) { st[table].splice(i, 1); removed.push(r); }
    }
    return { data: project(removed, b._retCols), error: null };
  }

  const RPC = {
    get_member_contacts({ p_league }) {
      if (!session.authenticated) return refuse('permission denied for function get_member_contacts');
      if (isCommissioner(p_league)) {
        return { data: st.league_members.filter((m) => m.league_id === p_league)
          .map((m) => ({ member_id: m.id, email: m.email, phone: m.phone, phone_verified: m.phone_verified })), error: null };
      }
      if (isMember(p_league)) {
        const me = myMemberId(p_league);
        return { data: st.league_members.filter((m) => m.league_id === p_league && m.id === me)
          .map((m) => ({ member_id: m.id, email: m.email, phone: m.phone, phone_verified: m.phone_verified })), error: null };
      }
      return named('not_member');
    },
    // 0008, §4.3 — COUNTS ONLY. The mock returns exactly the five columns the
    // migration's RETURNS names, so an adapter that tried to read a pick out of
    // this response would find nothing to read.
    week_submission_status({ p_league, p_week }) {
      if (!session.authenticated) return refuse('permission denied for function week_submission_status');
      if (!isMember(p_league)) return named('not_member');
      const data = st.league_members.filter((m) => m.league_id === p_league && m.active).map((m) => {
        const mine = st.picks.filter((p) => p.league_id === p_league && p.week_id === p_week && p.member_id === m.id);
        return {
          member_id: m.id,
          pick_count: mine.length,
          has_tiebreaker: st.tiebreaker_guesses.some((t) => t.league_id === p_league && t.week_id === p_week && t.member_id === m.id),
          has_extra_point: st.extra_point_guesses.some((e) => e.league_id === p_league && e.week_id === p_week && e.member_id === m.id),
          last_updated: mine.length ? mine.map((p) => p.updated_at).sort().slice(-1)[0] : null,
        };
      });
      return { data, error: null };
    },
    patch_kv({ p_league, p_key, p_value, p_mode }) {
      if (!session.authenticated) return named('not_authenticated');
      if (!isCommissioner(p_league)) return named('not_commissioner');
      const ALLOWED = ['settings', 'nicknames', 'lock_overrides', 'rejected_suggestions', 'active_week', 'fetch_proof', 'feedback_excluded_ids'];
      if (!ALLOWED.includes(p_key)) return named('bad_key');
      if (p_mode !== 'merge' && p_mode !== 'replace') return named('bad_mode');
      if (p_mode === 'merge' && (p_value === null || typeof p_value !== 'object' || Array.isArray(p_value))) return named('bad_value');
      let r = st.league_kv.find((x) => x.league_id === p_league && x.key === p_key);
      if (!r) { r = row({ league_id: p_league, key: p_key, value: null }); st.league_kv.push(r); }
      if (p_mode === 'replace') r.value = p_value;
      else {
        const unset = Array.isArray(p_value.$unset) ? p_value.$unset : [];
        const patch = { ...p_value }; delete patch.$unset;
        r.value = { ...(r.value && typeof r.value === 'object' ? r.value : {}), ...patch };
        for (const k of unset) delete r.value[k];
      }
      return { data: r.value, error: null };
    },
    transition_week({ p_league, p_week, p_to }) {
      if (!session.authenticated) return named('not_authenticated');
      if (!isCommissioner(p_league)) return named('not_commissioner');
      if (!['draft', 'open', 'locked', 'live', 'final'].includes(p_to)) return named('bad_transition');
      if (p_to === 'locked') return named('use_lock_week');
      if (p_to === 'final') return named('use_finalize_week');
      const w = week(p_league, p_week);
      if (!w) return named('not_found');
      const ok = [['draft', 'open'], ['open', 'draft'], ['locked', 'open'], ['locked', 'live'], ['live', 'locked'], ['final', 'live']]
        .some(([a, bb]) => a === w.status && bb === p_to);
      if (!ok) return named('bad_transition');
      const from = w.status;
      w.status = p_to;
      if (p_to === 'live') w.revealed_at = w.revealed_at || new Date(now()).toISOString();
      return { data: { from, to: p_to }, error: null };
    },
    lock_week({ p_league, p_week }) {
      if (!session.authenticated) return named('not_authenticated');
      if (!isCommissioner(p_league)) return named('not_commissioner');
      const w = week(p_league, p_week);
      if (!w) return named('not_found');
      if (w.status !== 'open') return named('bad_transition');
      const refusals = [];
      for (const g of st.games.filter((x) => x.league_id === p_league && x.week_id === p_week && x.spread !== null && x.spread !== undefined)) {
        const consistent = g.spread === 0 || g.favorite == null
          || (g.spread < 0 && g.favorite === g.home_team) || (g.spread > 0 && g.favorite === g.away_team);
        if (consistent) g.locked_spread = g.spread; else refusals.push(g.id);
      }
      w.status = 'locked';
      w.locked_at = new Date(now()).toISOString();
      w.locked_alma_maters = [...new Set(st.league_members.filter((m) => m.league_id === p_league && m.active && m.alma_mater).map((m) => m.alma_mater))];
      return { data: { refusals, lockedAt: w.locked_at }, error: null };
    },
    finalize_week({ p_league, p_week, p_results, p_obligations }) {
      if (!session.authenticated) return named('not_authenticated');
      if (!isCommissioner(p_league)) return named('not_commissioner');
      const w = week(p_league, p_week);
      if (!w) return named('not_found');
      if (w.status !== 'live') return named('bad_transition');
      for (const r of p_results || []) {
        if (r.weekId !== p_week) return named('bad_results');
        if (!st.league_members.some((m) => m.league_id === p_league && m.id === r.playerId)) return named('bad_results');
      }
      for (const o of p_obligations || []) {
        if (o.weekId !== p_week) return named('bad_results');
        if (!st.league_members.some((m) => m.league_id === p_league && m.id === o.payerPlayerId)) return named('bad_results');
        if (!st.league_members.some((m) => m.league_id === p_league && m.id === o.recipientPlayerId)) return named('bad_results');
      }
      st.results = st.results.filter((r) => !(r.league_id === p_league && r.week_id === p_week));
      for (const r of p_results || []) {
        st.results.push(row({ league_id: p_league, id: r.resultId || `wr_${p_week}_${r.playerId}`, week_id: p_week, member_id: r.playerId, display_name: r.displayName || '', correct_picks: r.correctPicks || 0, incorrect_picks: r.incorrectPicks || 0, correct_count: r.correctCount || 0, incorrect_count: r.incorrectCount || 0, no_decisions: r.noDecisions || 0, pending: r.pending || 0, tiebreaker_guess: r.tiebreakerGuess ?? null, tiebreaker_delta: r.tiebreakerDelta ?? null, rank: r.rank || 0, is_winner: !!r.isWinner, is_loser: !!r.isLoser, won_by_tiebreaker: !!r.wonByTiebreaker }));
      }
      let obCount = 0;
      for (const o of p_obligations || []) {
        if (st.obligations.some((x) => x.league_id === p_league && x.id === o.obligationId)) continue;
        st.obligations.push(row({ league_id: p_league, id: o.obligationId, type: o.type || 'weekly', week_id: p_week, payer_member_id: o.payerPlayerId, recipient_member_id: o.recipientPlayerId, amount_or_prize: o.amountOrPrize || '', status: o.status || 'unpaid', needs_review: !!o.needsReview, review_note: o.reviewNote ?? null }));
        obCount++;
      }
      w.status = 'final';
      w.finalized_at = new Date(now()).toISOString();
      return { data: { results: (p_results || []).length, obligations: obCount }, error: null };
    },
  };

  const channels = [];
  return {
    _calls: calls,
    _store: st,
    _session: session,
    _channels: channels,
    from: builder,
    rpc(name, args) {
      calls.rpc.push({ name, args });
      calls.fetches++;
      // The RPC half of throwWrites/failWrites. Scoped to the WRITING RPCs by name: a hydrate's
      // `get_member_contacts` / `week_submission_status` must keep answering, or the test would be
      // proving something about a hydrate rather than about a flush.
      const WRITE_RPCS = ['patch_kv', 'lock_week', 'transition_week', 'finalize_week'];
      if (WRITE_RPCS.includes(name)) {
        if (opts.throwWrites) throw opts.throwWrites();
        if (opts.failWrites) {
          // SECURITY F1 — the RPC half. `status` sits on the RESPONSE here exactly as it does on a
          // table write; a fake that carried it on only one of the two would let a classifier that
          // reads the status for `from()` and not for `rpc()` pass.
          const res = { data: null, error: opts.failWrites };
          if (opts.failWriteStatus) res.status = opts.failWriteStatus;
          return Promise.resolve(res);
        }
        if (opts.onWrite) opts.onWrite(name, 'rpc', args);
      }
      const fn = RPC[name];
      if (!fn) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } });
      if (opts.rpcOverride) {
        const o = opts.rpcOverride(name, args);
        if (o) return Promise.resolve(o);
      }
      return Promise.resolve(fn(args || {}));
    },
    channel(name) {
      const ch = {
        name, _handlers: [], _subscribed: null,
        on(evt, cfg, cb) { ch._handlers.push({ evt, cfg, cb }); return ch; },
        subscribe(cb) { ch._subscribed = cb; channels.push(ch); return ch; },
        unsubscribe() { ch._unsubscribed = true; return ch; },
      };
      return ch;
    },
    removeChannel(ch) { if (ch) ch._removed = true; },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// harness helpers
// ══════════════════════════════════════════════════════════════════════════

let ST, CLIENT, OWNER, ACCOUNT, ACTIVE_LEAGUE, EPOCH, VALID_SESSION, PRIV_HELD, WIPES;
const statuses = [];
/** Every `detail.banner` the adapter has emitted this scenario. The banner text
 *  IS part of the contract (§5.1, §5.2, §3.3 all specify copy), so it is read
 *  rather than assumed. */
const bannerSeen = [];
/** The FULL detail of every status this scenario has emitted. The banner array above reads the copy;
 *  this reads the CONTRACT — `js/app.js`'s `onSupabaseDataStatus()` renders off named fields
 *  (`detail.heldOffline`, `detail.banner`), and boottest [26] drives that renderer with this shape.
 *  If the two ever drift, one of the two suites is measuring a message nobody sends. */
const detailSeen = [];

/**
 * [A-RETRY] — FAKE TIMERS, because a bounded backoff tested with real sleeps is a suite that
 * takes twelve seconds per scenario and still proves nothing about the SCHEDULE. The adapter's
 * retry timer goes through the injected `setTimer`/`clearTimer` seam (the same discipline
 * `auth.js`'s `_setRefreshDeadlineForTest` uses), so a test drives milliseconds instead of waiting
 * them. The callback the adapter registers RETURNS its promise, which `setTimeout` ignores in a
 * browser and this queue awaits — so `runNext()` resolves only once the retry has actually run.
 */
function makeFakeTimers() {
  const q = [];
  let id = 0;
  return {
    set: (fn, ms) => { const h = ++id; q.push({ h, fn, ms }); return h; },
    clear: (h) => { const i = q.findIndex((t) => t.h === h); if (i >= 0) q.splice(i, 1); },
    delays: () => q.map((t) => t.ms),
    count: () => q.length,
    async runNext() { const t = q.shift(); if (!t) return null; await t.fn(); return t; },
  };
}

function initAdapter({ who = 'commissioner', leagueId = LEAGUE_A, rpcOverride = null, emptySelects = null,
  timers = null, refreshSession = null, random = null } = {}) {
  sb._resetForTest();
  store.clear();
  statuses.length = 0;
  bannerSeen.length = 0;
  detailSeen.length = 0;
  ST = makeStore();
  const session = SESSIONS[who];
  CLIENT = makeClient(ST, session, { rpcOverride, emptySelects });
  ACCOUNT = session.userId || '';
  ACTIVE_LEAGUE = leagueId;
  EPOCH = 7;
  OWNER = ACCOUNT ? `${ACCOUNT}\u0000${leagueId}` : '';
  VALID_SESSION = !!session.authenticated;
  PRIV_HELD = false;
  WIPES = { clearMirror: 0, setSiteUnlocked: [] };
  let registered = null;
  sb.init({
    getClient: () => CLIENT,
    getActiveLeagueId: () => ACTIVE_LEAGUE,
    getIdentityEpoch: () => EPOCH,
    getAccountUserId: () => ACCOUNT,
    getDeviceDataOwnerTuple: () => OWNER,
    getDeviceDataOwner: () => localStorage.getItem('cfbp_device_data_owner') || '',
    register: (p) => { registered = p; },
    getLeagueName: () => (ACTIVE_LEAGUE === LEAGUE_A ? 'IRB Pick ’Ems' : 'Test League B'),
    getLeagueNameById: (id) => (id === LEAGUE_A ? 'IRB Pick ’Ems' : id === LEAGUE_B ? 'Test League B' : ''),
    getSession: () => ({ isAdmin: session.role === 'commissioner', playerId: session.memberId || '' }),
    hasValidSupabaseSession: () => VALID_SESSION,
    isPrivilegeHeld: () => PRIV_HELD,
    clearMirror: () => { WIPES.clearMirror++; localStorage.removeItem('cfbp_sheet_mirror'); },
    setSiteUnlocked: (v) => { WIPES.setSiteUnlocked.push(v); if (!v) localStorage.removeItem('cfbp_site_unlocked'); },
    // Reviewer F9 — the READ-BACK half, injected beside the clearers rather than read off key
    // literals inside the adapter. These stand in for backend.js's own mirror predicate and
    // storage.js's getSiteUnlocked().
    hasSheetMirror: () => localStorage.getItem('cfbp_sheet_mirror') !== null,
    isSiteUnlocked: () => localStorage.getItem('cfbp_site_unlocked') !== null,
    // [A-RETRY] — the three seams the bounded write retry uses. `random` defaults to 0 so the
    // jitter term is deterministic and the SCHEDULE itself can be asserted; one case overrides it
    // to 1 to prove the jitter is really applied and really bounded.
    random: random || (() => 0),
    ...(timers ? { setTimer: timers.set, clearTimer: timers.clear } : {}),
    ...(refreshSession ? { refreshSession } : {}),
  });
  sb.onStatus((s, d) => { statuses.push([s, d && d.state]); detailSeen.push([s, d]); if (d && d.banner) bannerSeen.push(String(d.banner)); });
  localStorage.setItem('cfbp_device_data_owner', OWNER);
  return registered;
}

async function hydrated(opts = {}) {
  initAdapter(opts);
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  return sb.getState();
}

function thrown(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A1] load() is SYNCHRONOUS in supabase mode, and the source says so…', async () => {
  await hydrated();
  // R1 (forward drive): a get() issued while a hydrate is UNRESOLVED returns
  // the previous value, never a Promise.
  const first = sb.get('cfbp_weeks');
  ST.weeks.push(row({ league_id: LEAGUE_A, id: 'w9', season: '2026', week_number: 9, status: 'draft' }));
  const p = sb.hydrate(LEAGUE_A, { epoch: EPOCH });
  const during = sb.get('cfbp_weeks');
  assert(!(during instanceof Promise), 'get() during an in-flight hydrate is not a Promise');
  assert(JSON.stringify(during) === JSON.stringify(first), 'get() during an in-flight hydrate returns the PREVIOUS value');
  await p;
  assert(sb.get('cfbp_weeks').length === first.length + 1, 'and the value moves once the hydrate lands (R1 forward drive)');

  // The grep A1 names, run against the file itself: no `await` inside
  // get / set / isReady. Read as text because that is the invariant — a future
  // edit that made one of them async would still pass every behavioural test
  // on the first tick and break the entire app on the second.
  const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
  // RG (2026-09-19 cutover, live): a bare `.select()` after insert/update/delete is `RETURNING *`,
  // and on a table whose SELECT grant is a COLUMN LIST (league_members since 0007) PostgREST refuses
  // the whole WRITE — "permission denied for table league_members" — though the UPDATE is allowed.
  // This fake applies no column privileges, so the rule is pinned on the source, comment-blanked.
  {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert(!/\.select\(\s*\)/.test(code),
      '[A-RET] no bare `.select()` anywhere in the adapter — every write names its RETURNING columns (a bare one is RETURNING * and is refused on a column-granted table)');
    assert(/const returning = SELECT_COLS\[op\.table\] \|\| '\*';/.test(code)
      && (code.match(/\.select\(returning\)/g) || []).length === 3,
      '[A-RET] the rows writer returns SELECT_COLS[table] on all three verbs (insert, patch, delete) — the same list _select() reads with');
  }
  const bodyOf = (name) => {
    const m = new RegExp(`export function ${name}\\s*\\(`).exec(src);
    if (!m) return null;
    let i = src.indexOf('{', m.index), depth = 0, start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
    }
    return null;
  };
  for (const name of ['get', 'set', 'isReady']) {
    const body = bodyOf(name);
    assert(!!body, `the ${name}() body was found by the grep (a scan that finds nothing proves nothing)`);
    assert(body && !/\bawait\b/.test(body), `${name}() contains no \`await\``);
    assert(body && !/\basync\b/.test(body), `${name}() is not declared async`);
  }
  assert(!/export async function (get|set|isReady)\b/.test(src), 'none of the three is exported as async');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A2] the blind rule survives the hydrate: RLS is the only boundary (§4.1)…', async () => {
  await hydrated({ who: 'player' });
  const picks = sb.get('cfbp_picks');
  const openWeek = picks.filter((p) => p.weekId === 'w1');
  assert(openWeek.length === 2 && openWeek.every((p) => p.playerId === 'p2'),
    'a PLAYER hydrate of an OPEN week yields exactly his own picks (2 of 3 rows withheld)');
  const liveWeek = picks.filter((p) => p.weekId === 'w2');
  assert(liveWeek.length === 2, 'and BOTH members’ picks once the week is live');
  const tb = sb.get('cfbp_tiebreaker_guesses');
  assert(Object.keys(tb).length === 1 && 'w1__p2' in tb, 'tiebreaker guesses on the open week: own row only');

  await hydrated({ who: 'commissioner' });
  const cPicks = sb.get('cfbp_picks').filter((p) => p.weekId === 'w1');
  assert(cPicks.length === 1 && cPicks[0].playerId === 'p1',
    'the COMMISSIONER gets no escape hatch on an open week either (his own row only)');
  assert(!_captured.some((l) => /second select|service.?role/i.test(l)),
    'and the adapter never issues a second select to fill in what RLS withheld');
  const selects = CLIENT._calls.selects.filter((s) => s.table === 'league_members');
  assert(selects.length === 1 && selects[0].cols !== '*',
    'league_members is selected by an explicit COLUMN LIST, never `*` (0007 made `*` a 42501)');
  assert(selects[0].cols.split(',').length === 15, 'and the list is 0007’s fifteen columns');
  assert(!/(^|,)(email|phone|phone_verified)(,|$)/.test(selects[0].cols),
    'and it names no contact column (those come only from get_member_contacts)');
  assert(CLIENT._calls.selects.every((s) => s.eq.some(([c, v]) => c === 'league_id' && v === LEAGUE_A)),
    'every select carries .eq(league_id, <active>) — §3.1');
  assert(!CLIENT._calls.selects.some((s) => s.table === 'messages'), 'and never selects `messages` (AD-16, Step 5)');
  assert(!CLIENT._calls.selects.some((s) => s.table === 'standings'), 'and never selects `standings` (D-2: nothing writes it until Step 6)');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A3] whole-array writes become ROW DIFFS (§2.2)…', async () => {
  await hydrated({ who: 'player' });
  // saveAllPicks of the player's picks with ONE changed -> exactly one patch.
  const picks = sb.get('cfbp_picks').map((p) => ({ ...p }));
  const mine = picks.find((p) => p.pickId === 'pk2');
  mine.selectedTeam = 'Iowa State';
  sb.set('cfbp_picks', picks);
  let plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].op === 'patch' && plan[0].rowId === 'pk2',
    'saveAllPicks with one changed pick -> exactly ONE patch, keyed by row id');
  assert(JSON.stringify(Object.keys(plan[0].changed)) === '["selected_team"]',
    'and the patch carries only the column that actually differs');

  // toggleReaction rewrites the nested blob -> one insert or one delete.
  await hydrated({ who: 'player' });
  const rx = JSON.parse(JSON.stringify(sb.get('cfbp_reactions')));
  rx.w1 = rx.w1 || {}; rx.w1.g2 = rx.w1.g2 || {};
  rx.w1.g2['\u{1f44d}'] = ['p2'];
  sb.set('cfbp_reactions', rx);
  plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].op === 'insert' && plan[0].rows.length === 1,
    'toggleReaction ON -> exactly one reactions insert');
  await hydrated({ who: 'player' });
  const rx2 = JSON.parse(JSON.stringify(sb.get('cfbp_reactions')));
  delete rx2.w1.g1['\u{1f525}'];
  sb.set('cfbp_reactions', rx2);
  plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].op === 'delete' && plan[0].rowId === 'rx_w1_g1_p2_1f525',
    'toggleReaction OFF -> exactly one reactions delete, by the projection’s own row id');

  // deleteGame -> ONE games delete and ZERO picks deletes for other members.
  await hydrated({ who: 'commissioner' });
  const games = sb.get('cfbp_games').filter((g) => g.gameId !== 'g1');
  sb.set('cfbp_games', games);
  // deletePicksForGame() also strips every player's picks for that game.
  const remaining = sb.get('cfbp_picks').filter((p) => p.gameId !== 'g1');
  sb.set('cfbp_picks', remaining);
  const res = captureConsole(() => sb.planFlush());
  const gameOps = res.plan.filter((o) => o.key === 'cfbp_games');
  const pickOps = res.plan.filter((o) => o.key === 'cfbp_picks');
  assert(gameOps.length === 1 && gameOps[0].op === 'delete' && gameOps[0].rowId === 'g1',
    'deleteGame -> exactly ONE games delete');
  assert(pickOps.length === 1 && pickOps[0].op === 'delete' && pickOps[0].rowId === 'pk1',
    'and exactly ONE picks delete — the commissioner’s OWN pick, which he may delete');
  assert(!pickOps.some((o) => o.rowId === 'pk2'),
    'and ZERO picks deletes for other members — pk2 was never in the base, so it CANNOT appear as a delete (§2.2’s first rule)');

  // The other half of §2.2's second rule, on a week where the caller CAN see a
  // row he may not delete: a LIVE week reveals everyone's picks, so removing
  // another member's row from the array is a delete the planner must drop —
  // loudly, with a console line naming it, never silently.
  await hydrated({ who: 'player' });
  const live = sb.get('cfbp_picks').filter((p) => !(p.weekId === 'w2' && p.playerId === 'p1'));
  sb.set('cfbp_picks', live);
  const res2 = captureConsole(() => sb.planFlush());
  assert(!res2.plan.some((o) => o.key === 'cfbp_picks' && o.rowId === 'pk4'),
    'a player removing ANOTHER member’s visible pick emits no delete for it');
  assert(said(/is not this caller's to make/),
    'and a console line names the row it DROPPED rather than dropping it silently (§2.2)');

  // The property that makes all of this safe: a row the caller never saw is in
  // neither base nor mirror, so it can never appear as a delete.
  await hydrated({ who: 'player' });
  sb.set('cfbp_picks', sb.get('cfbp_picks'));
  assert(sb.planFlush().plan.length === 0,
    're-saving exactly what was hydrated produces an EMPTY plan (no row the caller could not see is ever deleted)');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A4] composite writes: lock, transition, finalize (§2.3)…', async () => {
  // LOCK — one lock_week, and NO weeks PATCH carrying status.
  await hydrated({ who: 'commissioner' });
  let weeks = sb.get('cfbp_weeks').map((w) => ({ ...w }));
  const w1 = weeks.find((w) => w.weekId === 'w1');
  w1.status = 'locked';
  w1.lockedAt = new Date(NOW).toISOString();
  w1.lockedAlmaMaters = ['Iowa State'];
  sb.set('cfbp_weeks', weeks);
  let plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].kind === 'rpc' && plan[0].name === 'lock_week',
    'lock -> exactly one rpc(lock_week)');
  assert(!plan.some((o) => o.kind === 'rows' && o.changed && 'status' in o.changed),
    'and NO weeks PATCH carrying status (weeks_status_guard would refuse it with 42501)');
  await sb.flush();
  assert(ST.weeks.find((w) => w.id === 'w1').status === 'locked', 'the server applied the lock');
  assert(ST.games.find((g) => g.id === 'g1').locked_spread === -3.5,
    'and the SERVER froze the spread — the client’s own lockedSpread was discarded from the plan');

  // TRANSITION — locked -> live goes through transition_week.
  weeks = sb.get('cfbp_weeks').map((w) => ({ ...w }));
  const wl = weeks.find((w) => w.weekId === 'w1');
  // the mirror was rebased by the lock RPC only at the next hydrate, so re-read
  await sb.hydrate(LEAGUE_A, { epoch: EPOCH });
  const weeks2 = sb.get('cfbp_weeks').map((w) => ({ ...w }));
  weeks2.find((w) => w.weekId === 'w1').status = 'live';
  sb.set('cfbp_weeks', weeks2);
  plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].name === 'transition_week' && plan[0].args.p_to === 'live',
    'locked -> live goes through rpc(transition_week)');
  await sb.flush();
  assert(!!ST.weeks.find((w) => w.id === 'w1').revealed_at,
    'and revealed_at is SERVER-set on the first move to live');
  void wl;

  // FINALIZE — games patches, then ONE finalize_week carrying results + new obligations.
  await hydrated({ who: 'commissioner' });
  const g = sb.get('cfbp_games').map((x) => ({ ...x }));
  g.find((x) => x.gameId === 'g3').atsWinner = 'Iowa';
  sb.set('cfbp_games', g);
  const wk = sb.get('cfbp_weeks').map((x) => ({ ...x }));
  wk.find((x) => x.weekId === 'w2').status = 'final';
  sb.set('cfbp_weeks', wk);
  sb.set('cfbp_results', [...sb.get('cfbp_results'), {
    resultId: 'wr_w2_p2', weekId: 'w2', playerId: 'p2', displayName: 'Kevin',
    correctPicks: 0, incorrectPicks: 1, correctCount: 0, incorrectCount: 1,
    noDecisions: 0, pending: 0, tiebreakerGuess: null, tiebreakerDelta: null,
    rank: 2, isWinner: false, isLoser: true, wonByTiebreaker: false,
  }]);
  sb.set('cfbp_obligations', [...sb.get('cfbp_obligations'), {
    obligationId: 'ob2', type: 'weekly', weekId: 'w2', payerPlayerId: 'p2', recipientPlayerId: 'p1',
    amountOrPrize: 'beer', status: 'unpaid', createdAt: new Date(NOW).toISOString(), paidAt: null,
    needsReview: false, reviewNote: null, voided: false, voidedAt: null, voidReason: null,
    mergedInto: null, mergedFrom: [],
  }]);
  plan = sb.planFlush().plan;
  const order = plan.map((o) => (o.kind === 'finalize' ? 'finalize' : `${o.kind}:${o.key}`));
  assert(order.indexOf('rows:cfbp_games') === 0, 'the games patch (atsWinner) is FIRST in the plan');
  assert(order.filter((o) => o === 'finalize').length === 1, 'and there is exactly ONE finalize op');
  assert(order.indexOf('finalize') > order.indexOf('rows:cfbp_games'), 'and it comes after the games patch');
  await sb.flush();
  const fin = CLIENT._calls.rpc.filter((c) => c.name === 'finalize_week');
  assert(fin.length === 1, 'exactly one finalize_week call reached the server');
  assert(fin[0].args.p_results.length === 2 && fin[0].args.p_results.every((r) => r.weekId === 'w2'),
    'carrying that week’s results (and only that week’s)');
  assert(fin[0].args.p_obligations.length === 1 && fin[0].args.p_obligations[0].obligationId === 'ob2',
    'and only the NEW obligation (ob1 already exists by id, so finalize_week is not asked to insert it)');
  assert(ST.weeks.find((w) => w.id === 'w2').status === 'final', 'the week is final on the server');

  // A saveAllWeeklyResults OUTSIDE a finalize is refused (the tiebreaker
  // re-persist path, app.js:9299 — DI §11.3's named residual).
  await hydrated({ who: 'commissioner' });
  sb.set('cfbp_results', [...sb.get('cfbp_results'), {
    resultId: 'wr_w2_p3', weekId: 'w2', playerId: 'p3', displayName: 'Koby',
    correctPicks: 0, incorrectPicks: 0, correctCount: 0, incorrectCount: 0, noDecisions: 0,
    pending: 0, tiebreakerGuess: 9, tiebreakerDelta: 1, rank: 3, isWinner: false, isLoser: false, wonByTiebreaker: false,
  }]);
  const r = sb.planFlush();
  assert(r.refusals.length === 1 && r.refusals[0].name === 'AdapterWriteRefusedError'
    && r.refusals[0].code === 'results_outside_finalize',
    'a results write outside a finalize is a typed AdapterWriteRefusedError');
  assert(/finalize_week/.test(r.refusals[0].message) && /Nothing was saved/.test(r.refusals[0].message),
    'and the message names the only writer and says nothing was saved');
  assert(!r.plan.some((o) => o.key === 'cfbp_results'), 'and no results operation is in the plan');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A5] a status diff can never be sent as a PATCH (§2.1, weeks_status_guard)…', async () => {
  await hydrated({ who: 'commissioner' });
  const weeks = sb.get('cfbp_weeks').map((w) => ({ ...w }));
  weeks.find((w) => w.weekId === 'w1').status = 'live';        // open -> live: not an allowed step
  sb.set('cfbp_weeks', weeks);
  const r = sb.planFlush();
  assert(r.refusals.length === 1 && r.refusals[0].code === 'bad_transition',
    'an UNMAPPABLE status diff is refused CLIENT-SIDE with the server’s own error name (bad_transition)');
  assert(/open to live/.test(r.refusals[0].message), 'and the message names both ends of the step it refused');
  assert(!r.plan.length, 'and nothing at all is sent');

  // The teeth: prove the mock's guard REALLY refuses a direct status PATCH, so
  // A5 is a statement about Postgres's behaviour and not only about the planner.
  const direct = await CLIENT.from('weeks').update({ status: 'live' }).eq('league_id', LEAGUE_A).eq('id', 'w1').select();
  assert(direct.error && direct.error.code === '42501' && /transition RPC/.test(direct.error.message),
    'and a direct weeks.status PATCH is refused 42501 by the modelled guard (so the planner’s job is real)');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A6] WRITE-DURING-SWITCH — the hard gate, all three layers (§3.3)…', async () => {
  // LAYER 1 — at save() time. During SWITCHING the probe is false, which is
  // what makes storage.save() throw AuthModeMismatchError before the mirror is
  // touched (storage.js:292-295). Asserted on the probe, because the throw
  // itself lives in a Part B file.
  await hydrated({ who: 'commissioner' });
  assert(sb.probe() === true, 'ACTIVE: the probe is true, so save() passes the interlock');
  const picksBefore = JSON.stringify(ST.picks.filter((p) => p.league_id === LEAGUE_A));
  sb.beginSwitch(LEAGUE_A, LEAGUE_B);
  assert(sb.getState() === 'SWITCHING' && sb.probe() === false,
    'SWITCHING: the probe is FALSE (layer 1 — storage.save() throws before the mirror is touched)');

  // LAYER 2 — at flush() time, for a write the drop in layer 1 did not catch:
  // the entry was captured under league A, the mirror has since been re-tagged
  // to league B, and the captured token no longer matches the mirror's.
  await hydrated({ who: 'commissioner' });
  const picks = sb.get('cfbp_picks').map((p) => ({ ...p }));
  picks.find((p) => p.pickId === 'pk1').selectedTeam = 'Kansas';
  sb.set('cfbp_picks', picks);                       // captured under league A
  ACTIVE_LEAGUE = LEAGUE_B;                          // the pointer moves
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_B, { epoch: EPOCH }));   // the mirror is re-tagged to B
  assert(sb._mirrorTagForTest().leagueId === LEAGUE_B, 'the mirror is now tagged to league B');
  assert(sb._dirtyKeysForTest().includes('cfbp_picks'),
    'and the write captured under A is STILL DIRTY — the rebase refused to graft it onto B’s value');
  assert(!sb.get('cfbp_picks').some((p) => p.pickId === 'pk1'),
    'and league A’s picks did not follow the rebase into league B’s mirror');
  const out = await captureConsoleAsync(() => sb.flush());
  const refusedStatus = statuses.filter(([s]) => s === 'refused');
  assert(out.pushed === 0, 'a write captured in league A is NOT pushed after the pointer moved to B');
  assert(refusedStatus.length >= 1, 'a ‘refused’ status was emitted');
  const msg = sb.getStatus().lastError;
  assert(/IRB Pick/.test(msg) && /Test League B/.test(msg),
    'and the banner names BOTH leagues by NAME (through the injected getLeagueName)');
  assert(/Re-enter it there/.test(msg), 'and tells the player what to do about it');
  assert(said(/NOT re-queued under the new league/),
    'and the console states it was discarded rather than re-queued (a pick made in A is not a pick in B)');
  assert(sb._dirtyKeysForTest().length === 0, 'the dirty entry is GONE, not queued under B');
  assert(JSON.stringify(ST.picks.filter((p) => p.league_id === LEAGUE_A)) === picksBefore,
    'and league A’s store is byte-for-byte unchanged');

  // LAYER 3 — the server. Exists so a bug in layers 1-2 is still a LOUD
  // failure and never a cross-league write: the row carries A's league_id and
  // this session is not a member of A.
  initAdapter({ who: 'bOnly', leagueId: LEAGUE_B });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_B, { epoch: EPOCH }));
  const crossRes = await CLIENT.from('picks').update({ selected_team: 'Kansas' })
    .eq('league_id', LEAGUE_A).eq('id', 'pk1').select();
  assert((crossRes.data || []).length === 0 || crossRes.error,
    'layer 3: a PATCH carrying league A’s league_id from a session that is not a member of A lands on NO ROW');
  assert(ST.picks.find((p) => p.id === 'pk1').selected_team === 'Iowa State',
    'and league A’s row is untouched');

  // R2 — the RELEASE. A completed switch leaves the adapter ACTIVE on B, the
  // probe true, and a write to B accepted.
  initAdapter({ who: 'commissionerB', leagueId: LEAGUE_B });
  const sw = await captureConsoleAsync(() => sb.switchLeague(LEAGUE_B, { from: LEAGUE_A }));
  assert(sw.ok === true && sb.getState() === 'ACTIVE' && sb.probe() === true,
    'R2: after a successful switch the adapter is ACTIVE on B and the probe is true again');
  const bWeeks = sb.get('cfbp_weeks');
  assert(bWeeks.length === 1 && bWeeks[0].weekId === 'x1', 'and the mirror holds league B’s week and nothing of A’s');

  // And a FAILED switch does not: the adapter is HELD, so the caller must not
  // fire SWITCH_END (§3.2 — a half-hydrated league is never painted as whole).
  initAdapter({ who: 'commissionerB', leagueId: LEAGUE_B, rpcOverride: (n) => (n === 'get_member_contacts' ? { data: null, error: { code: '08006', message: 'network' } } : null) });
  const bad = await captureConsoleAsync(() => sb.switchLeague(LEAGUE_B, { from: LEAGUE_A }));
  assert(bad.ok === false && sb.getState() === 'HELD',
    'a hydrate failure DURING a switch leaves the adapter HELD and reports ok:false (so SWITCH_END is not fired)');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A7] hasSupabaseDataBackend() DERIVES from the state machine (entry condition #2)…', async () => {
  const registered = initAdapter();
  assert(typeof registered === 'function', 'init() REGISTERS the probe on its host (never an import edge)');
  assert(registered === sb.probe, 'and it registers the adapter’s own probe function');
  for (const s of ['IDLE', 'HYDRATING', 'SWITCHING', 'HELD', 'OFFLINE-READONLY']) {
    sb._setStateForTest(s, 'test');
    assert(sb.probe() === false, `probe() is FALSE in ${s}`);
  }
  for (const s of ['ACTIVE', 'ACTIVE-STALE']) {
    sb._setStateForTest(s, 'test');
    assert(sb.probe() === true, `probe() is TRUE in ${s}`);
  }
  // THE MUTANT'S SHAPE, driven as a scenario: constructed with everything a
  // config flag would give it and NO hydrate. A probe reading a flag would say
  // true here; this one says false because nothing has been hydrated.
  initAdapter();
  assert(sb.getState() === 'IDLE' && sb.probe() === false,
    'constructed with a full accessor set and NO hydrate, the probe is FALSE (a config-flag probe would be true)');
  // §6.4 — the verify window. Latch and release, no new mechanism.
  await hydrated();
  assert(sb.probe() === true, 'ACTIVE + no privilege hold -> probe true');
  PRIV_HELD = true;
  assert(sb.probe() === false, 'R1: isPrivilegeHeld() true -> probe FALSE even in ACTIVE (§6.4)');
  PRIV_HELD = false;
  assert(sb.probe() === true, 'R2: the release is the existing SESSION_REVERIFIED path — probe true again, no new latch');
  // A thrown probe dependency must be treated as FALSE and must never escape into
  // storage.save() — the interlock's caller has no catch of its own.
  sb.init({
    getClient: () => CLIENT, getActiveLeagueId: () => ACTIVE_LEAGUE, getIdentityEpoch: () => EPOCH,
    getAccountUserId: () => ACCOUNT, getDeviceDataOwnerTuple: () => OWNER, getDeviceDataOwner: () => OWNER,
    register: () => {}, getSession: () => ({ isAdmin: true, playerId: 'p1' }),
    isPrivilegeHeld: () => { throw new Error('boom'); },
  });
  sb._setStateForTest('ACTIVE', 'test');
  assert(thrown(() => captureConsole(() => sb.probe())) === null, 'probe() never throws, even when an injected accessor does');
  assert(captureConsole(() => sb.probe()) === false, 'and a throwing isPrivilegeHeld() is treated as HELD (false), never as permission');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-NN] the planner NEVER sends null into a NOT NULL column (live cutover defect, 2026-09-19)…', async () => {
  // (1) The map is the SCHEMA's. Derive it from 0001_schema.sql the same way the adapter's constant
  //     was generated, and fail on drift — a new NOT NULL column with a default that this list does
  //     not name is exactly the column whose null would refuse a whole row.
  const sql = readFileSync(join(__dirname, 'supabase', 'migrations', '0001_schema.sql'), 'utf8');
  const mapped = sb._notNullColsForTest();
  assert(Object.keys(mapped).length >= 15, `[A-NN] fixture: the map covers the routed tables (got ${Object.keys(mapped).length})`);
  for (const [table, cols] of Object.entries(mapped)) {
    const m = new RegExp(`create table public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`).exec(sql);
    const derived = [];
    for (const raw of (m ? m[1].split('\n') : [])) {
      const line = raw.split('--')[0].trim();
      const mm = /^([a-z_]+)\s+[a-z]/.exec(line);
      if (mm && /\bnot null\b/.test(line) && !['primary', 'foreign', 'unique', 'check', 'constraint'].includes(mm[1])) derived.push(mm[1]);
    }
    assert(!!m && JSON.stringify(derived) === JSON.stringify(cols),
      `[A-NN] NOT_NULL_COLS.${table} equals the NOT NULL columns 0001_schema.sql declares (derived ${derived.length}, mapped ${cols.length})`);
  }

  // (2) THE LIVE DEFECT, driven: a player whose record has NO `preferences` key (the Sheet never
  //     stored one) while the served row holds the column default `{}`. Before the fix the diff saw
  //     null !== {} and sent `preferences: null` ⇒ "violates not-null constraint" ⇒ red sync banner.
  await hydrated({ who: 'player' });
  let players = sb.get('cfbp_players').map((p) => ({ ...p }));
  const mine = players.find((p) => p.playerId === 'p2');
  delete mine.preferences;                    // exactly the live shape: the key is ABSENT
  mine.displayName = 'Kevin NN';              // one REAL change, so a patch exists to inspect
  sb.set('cfbp_players', players);
  const pl = sb.planFlush().plan.filter((o) => o.key === 'cfbp_players');
  assert(pl.length === 1 && pl[0].changed.display_name === 'Kevin NN', `[A-NN] fixture: the real change still travels (changed: ${JSON.stringify(pl[0] && Object.keys(pl[0].changed))})`);
  assert(!('preferences' in pl[0].changed),
    `[A-NN] an ABSENT legacy field is never sent as null into a NOT NULL column (changed: ${JSON.stringify(Object.keys(pl[0].changed))})`);
  assert(!Object.entries(pl[0].changed).some(([c, v]) => v == null && mapped.league_members.includes(c)),
    '[A-NN] …and no NOT NULL column carries a null anywhere in the patch');

  // (3) A genuinely NULLABLE column still takes a null — this is the schema's list, not a blanket filter.
  await hydrated({ who: 'commissioner' });
  const weeks = sb.get('cfbp_weeks').map((w) => ({ ...w }));
  if (weeks.length) {
    weeks[0].actualTiebreakerValue = null;
    const before = sb.get('cfbp_weeks')[0].actualTiebreakerValue;
    sb.set('cfbp_weeks', weeks);
    const wp = sb.planFlush().plan.filter((o) => o.key === 'cfbp_weeks' && o.op === 'patch');
    assert(before == null || (wp.length === 1 && 'actual_tiebreaker_value' in wp[0].changed && wp[0].changed.actual_tiebreaker_value === null),
      '[A-NN] a nullable column (weeks.actual_tiebreaker_value) can still be cleared to null');
  }
});

await section('\n[A-ADD] Add Player is absent in Supabase mode (INSERT into league_members is forbidden by schema — reviewer F1, 2026-09-19)…', async () => {
  const blank = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const app = blank(readFileSync(join(__dirname, 'js', 'app.js'), 'utf8'));
  const markup = app.indexOf('id="admin-add-player-btn"');
  const gate = app.lastIndexOf('isSupabaseDataMode() ?', markup);
  assert(markup > 0 && gate > 0 && markup - gate < 900 && app.slice(gate, markup).includes('admin-add-player-note'),
    '[A-ADD] the Add control renders only in the non-Supabase arm of an isSupabaseDataMode() branch (absent, not disabled)');
  const h = app.indexOf("getElementById('admin-add-player-btn')?.addEventListener");
  const body = app.slice(h, app.indexOf('addPlayer(createPlayer(', h));
  assert(h > 0 && /if\s*\(\s*isSupabaseDataMode\(\)\s*\)\s*return/.test(body),
    '[A-ADD] …and the click handler refuses in Supabase mode BEFORE addPlayer() (second guard)');
});

await section('\n[A-RESET] Full Factory Reset is absent in Supabase mode (it would write demo data over the live league — reviewer, 2026-09-19)…', async () => {
  const blank = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const app = blank(readFileSync(join(__dirname, 'js', 'app.js'), 'utf8'));
  assert(/\$\{isSupabaseDataMode\(\) \? '' : `<button[^`]*id="reset-demo-btn"/.test(app),
    '[A-RESET] the button renders only in the non-Supabase arm (absent, not disabled)');
  const h = app.indexOf("getElementById('reset-demo-btn')?.addEventListener");
  const body = app.slice(h, app.indexOf('resetToDemo()', h));
  assert(h > 0 && /if\s*\(\s*isSupabaseDataMode\(\)\s*\)\s*return/.test(body) && body.indexOf('isSupabaseDataMode') < body.indexOf('prompt('),
    '[A-RESET] …and the handler refuses in Supabase mode before the password prompt and before resetToDemo()');
});

await section('\n[A-HIDE] Supabase mode flushes pending writes when the app is hidden/closed (the Sheets-only beforeunload flush left a ~800ms loss window)…', async () => {
  const blank = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const app = blank(readFileSync(join(__dirname, 'js', 'app.js'), 'utf8'));
  assert(/const _flushSupabaseOnHide = \(\) => \{ try \{ if \(isSupabaseDataMode\(\)\) sb\.flush\(\)\.catch\(/.test(app),
    '[A-HIDE] the hide handler calls sb.flush() only in Supabase mode, and cannot throw or reject unhandled');
  assert(/addEventListener\('pagehide', _flushSupabaseOnHide\)/.test(app), '[A-HIDE] wired to pagehide');
  assert(/addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden\) _flushSupabaseOnHide\(\); \}\)/.test(app),
    '[A-HIDE] …and to visibilitychange, on the HIDDEN edge only');
  // Behaviour: an explicit flush() sends a debounced write immediately — nothing waits for the timer.
  await hydrated({ who: 'commissioner' });
  const players = sb.get('cfbp_players').map((p) => ({ ...p }));
  players[0] = { ...players[0], preferences: { ...(players[0].preferences || {}), theme: 'hide-flush-probe' } };
  sb.set('cfbp_players', players);
  assert(sb.planFlush().plan.some((o) => o.key === 'cfbp_players'), '[A-HIDE] fixture: the write is pending (debounced, not yet sent)');
  const r = await sb.flush();
  assert(r && r.pushed >= 1 && !sb.planFlush().plan.some((o) => o.key === 'cfbp_players'),
    `[A-HIDE] flush() pushes it NOW and leaves nothing pending (got ${JSON.stringify(r)})`);
});

await section('\n[A8] the CONTACT WRITE RULE (§2.4, DI-T7.6’s write side)…', async () => {
  // A commissioner with NO contacts entry for that member: the patch carries no
  // contact column and no contact name in __absent.
  await hydrated({ who: 'commissioner' });
  sb._setContactsForTest([]);                 // as if get_member_contacts returned nothing for p2
  let players = sb.get('cfbp_players').map((p) => ({ ...p }));
  let p2 = players.find((p) => p.playerId === 'p2');
  p2.displayName = 'Kevin (ND)';
  p2.email = '';                              // the blanking shape the rule exists to stop
  p2.phone = '';
  p2.phoneVerified = false;
  sb.set('cfbp_players', players);
  let plan = sb.planFlush().plan.filter((o) => o.key === 'cfbp_players');
  assert(plan.length === 1 && plan[0].rowId === 'p2', 'one league_members patch for the edited row');
  assert(!('email' in plan[0].changed) && !('phone' in plan[0].changed) && !('phone_verified' in plan[0].changed),
    'a commissioner-shaped write with NO contacts entry carries NO contact column');
  const absent = plan[0].changed.extra && plan[0].changed.extra.__absent;
  assert(!absent || !absent.some((f) => ['email', 'phone', 'phoneVerified'].includes(f)),
    'and no contact field name in __absent (a later commissioner read must not be hidden by this write)');
  await sb.flush();
  assert(ST.league_members.find((m) => m.id === 'p2').email === 'kevin@example.com',
    'and the mock’s row KEEPS its email — the redaction did not become data');

  // With an entry AND a changed value: exactly that column travels.
  await hydrated({ who: 'commissioner' });
  players = sb.get('cfbp_players').map((p) => ({ ...p }));
  p2 = players.find((p) => p.playerId === 'p2');
  p2.phone = '+15559998888';
  sb.set('cfbp_players', players);
  plan = sb.planFlush().plan.filter((o) => o.key === 'cfbp_players');
  assert(plan.length === 1 && plan[0].changed.phone === '+15559998888',
    'with a contacts entry from THIS hydrate and a genuinely different value, exactly that column travels');
  assert(!('email' in plan[0].changed), 'and the unchanged email does not');

  // A PLAYER never carries another member's contact field.
  await hydrated({ who: 'player' });
  players = sb.get('cfbp_players').map((p) => ({ ...p }));
  const other = players.find((p) => p.playerId === 'p1');
  other.phone = '+15550000009';
  other.displayName = 'Drew (hacked)';     // a NON-contact column, so the row survives the contact rule and must be dropped for OWNERSHIP
  const mine = players.find((p) => p.playerId === 'p2');
  mine.preferences = { ...mine.preferences, theme: 'dark' };
  sb.set('cfbp_players', players);
  const res = captureConsole(() => sb.planFlush());
  const pl = res.plan.filter((o) => o.key === 'cfbp_players');
  assert(pl.length === 1 && pl[0].rowId === 'p2',
    'a player’s whole-array write reduces to a patch of HIS OWN row only');
  assert(!pl.some((o) => 'phone' in (o.changed || {})),
    'and it carries no contact field for anybody, least of all another member');
  assert(said(/is not this caller's to make/), 'and the other member’s row is reported as dropped');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A9] LOUD-FAIL: a hydrate failure holds, it never becomes local mode (§5.1)…', async () => {
  const before = [...store.keys()];
  initAdapter({ rpcOverride: (n) => (n === 'get_member_contacts' ? { data: null, error: { code: '08006', message: 'network down' } } : null) });
  const keysAtInit = new Set(store.keys());
  const n = await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(n === 0 && sb.getState() === 'HELD', 'a rejected hydrate with nothing serveable -> HELD');
  assert(sb.isContentWithheldByAdapter() === true, 'isContentWithheld()’s adapter clause is TRUE');
  assert(statuses.some(([s]) => s === 'error'), 'an ‘error’ status was emitted');
  assert(bannerSeen.some((b) => /Couldn’t load your league/.test(b) && /Nothing has changed/.test(b)),
    'and the detail carries §5.1’s data-hold copy verbatim ("Couldn’t load your league. Nothing has changed — retry in a moment.")');
  assert(!bannerSeen.some((b) => /sign in|PIN/i.test(b)),
    'with no Google button and no PIN field in it — this is a DATA hold, not DI-180l’s identity hold');
  assert(sb.get('cfbp_picks') === null, 'and nothing is served (the skeleton stays)');
  const added = [...store.keys()].filter((k) => !keysAtInit.has(k));
  assert(added.length === 0, `no cfbp_* localStorage key was written by the failure (added: ${JSON.stringify(added)})`);
  assert(sb.probe() === false, 'the probe is false, so every save() is refused through the existing interlock');
  void before;

  // R2 — the RELEASE. The banner's Retry re-runs the adapter hydrate, and a
  // success clears the hold. Driven forward rather than asserted about.
  initAdapter();
  const ok = await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(ok > 0 && sb.getState() === 'ACTIVE' && sb.isContentWithheldByAdapter() === false,
    'R2: a later successful hydrate clears the hold and content is no longer withheld');

  // RG-12 defence (b), transplanted: a PARTIAL READ returns no players, weeks
  // or picks while the mirror holds them -> REFUSE, preserve, fail loud. The
  // rows are still in the store and `is_member()` still answers truthfully —
  // this is a transport artifact, which is exactly the case adopting the void
  // would destroy a season over.
  await hydrated();
  const held = sb.get('cfbp_players').length;
  CLIENT._calls.fetches = 0;
  CLIENT = makeClient(ST, SESSIONS.commissioner, { emptySelects: ['league_members', 'weeks', 'picks'] });
  const n2 = await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(n2 === 0 && sb.getState() === 'HELD', 'RG-12 (b): an empty remote over a populated mirror is REFUSED');
  assert(sb.get('cfbp_players').length === held, 'and the mirror is PRESERVED, not emptied');
  assert(/Sync refused/.test(sb.getStatus().lastError), 'with the same ‘Sync refused’ message the Sheets path uses');

  // A9b — PART B LANDED (2026-09-18), the skip is CLOSED.
  //
  // The line is in js/storage.js, which Part A could not edit, and the DRIVE is
  // in persisttest.mjs [8] — which imports the real seam and can therefore set
  // the mode, call ensureSeedData() for real, and read the keys back. What is
  // asserted HERE is that the line says what the design said it must, and that
  // the drive exists: a follow-up that is only a comment is not a follow-up.
  {
    const stSrc = readFileSync(join(__dirname, 'js', 'storage.js'), 'utf8');
    // Comments stripped: the line's own comment QUOTES the old test it
    // replaced, and a static rule that matches prose instead of code passes
    // over the thing it is describing (RG-49's shape).
    const fn = stSrc.slice(stSrc.indexOf('export function ensureSeedData'),
      stSrc.indexOf('export function resetToDemo'))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    // THE STRONGER RULE FIRST (coordinator ruling 2026-09-18): supabase mode
    // does not reach the walk AT ALL. The RG-12 guard below it protects only
    // USER_MUTABLE_KEYS, so without this the walk would still push
    // cfbp_settings / cfbp_comments / cfbp_notifications / the SCRIBE keys at
    // the adapter — a commissioner session OVERWRITING a live settings blob
    // with defaults, and every other session throwing out of a boot path.
    const earlyReturn = fn.slice(0, fn.indexOf('const shared ='));
    assert(/if \(getBackendMode\(\) === 'supabase'\) \{[\s\S]*?return;[\s\S]*?\}/.test(earlyReturn),
      'A9b: ensureSeedData() RETURNS immediately in supabase mode, BEFORE the seed walk — the server is the seed, and a device never invents league data');
    assert(!/opts\.confirmEmpty/.test(earlyReturn),
      "A9b: …and { confirmEmpty: true } does NOT override it — that flag answers \"is this SHEET brand new\", a question the Supabase path never asks");
    assert(/const shared = getBackendMode\(\) !== 'local';/.test(fn),
      "A9b: RG-12's own test is `getBackendMode() !== 'local'` — the question is \"is this a SHARED store\", not \"is this the Sheet\"");
    assert(!/=== 'googleSheets'/.test(fn),
      'A9b: …and the old googleSheets-only test is GONE, not merely supplemented (a second test is a second answer)');
    assert(/maySeedUserData = !shared \|\| opts\.confirmEmpty === true/.test(fn),
      'A9b: …and it still feeds the SAME maySeedUserData gate, so googleSheets keeps exactly the behaviour it shipped with');
    const ptSrc = readFileSync(join(__dirname, 'persisttest.mjs'), 'utf8');
    assert(/setBackendMode\('supabase'\)/.test(ptSrc) && /USER_MUTABLE_KEYS/.test(ptSrc),
      'A9b: …and persisttest.mjs really drives it in supabase mode (the follow-up this skip named was actually done)');
  }
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A10] the refusal path: typed, shown, and not retried blindly (§5.2)…', async () => {
  await hydrated({ who: 'player' });
  // A player patching a week: the route refuses BEFORE the mirror is touched.
  const e = thrown(() => sb.set('cfbp_weeks', []));
  assert(e && e.name === 'AdapterWriteRefusedError' && e.code === 'route_refused',
    'a player writing cfbp_weeks throws a typed AdapterWriteRefusedError at set() time');
  assert(/Nothing was saved/.test(e.message), 'and says nothing was saved');

  // A refusal from the SERVER on a push.
  await hydrated({ who: 'player' });
  const picks = sb.get('cfbp_picks').map((p) => ({ ...p }));
  picks.find((p) => p.pickId === 'pk3').selectedTeam = 'Ohio State';
  sb.set('cfbp_picks', picks);
  // Close the pick window server-side so picks_update refuses (USING matches
  // no row -> zero rows -> a refusal, which is how a policy says no).
  ST.weeks.find((w) => w.id === 'w1').status = 'locked';
  const out = await captureConsoleAsync(() => sb.flush());
  assert(out.refused && out.refused.includes('cfbp_picks'), 'the push is refused');
  assert(sb._refusedKeysForTest().includes('cfbp_picks'), 'and the key is in _refusedKeys');
  assert(statuses.some(([s]) => s === 'refused'), 'a ‘refused’ status — distinct from ‘error’ — was emitted');
  assert(sb.getState() === 'ACTIVE', 'and the STATE is unchanged: a refusal is a fact about one write, not a reason to unload the league');
  assert(sb.get('cfbp_picks').find((p) => p.pickId === 'pk3').selectedTeam === 'Ohio State',
    'the mirror KEEPS the value the user set until a hydrate rebases it (never a silent revert)');

  // REVIEWER F6 — 'synced' MAY NOT BE EMITTED WHILE A KEY IS STILL REFUSED.
  // `_refusedKeys` is latched until a hydrate lands, and the badge reads this channel: a later
  // flush carrying only clean keys would otherwise take the red banner down while the refused write
  // is still unsent and still unsaved.
  statuses.length = 0;
  bannerSeen.length = 0;
  sb.set('cfbp_reactions', { ...sb.get('cfbp_reactions'), w9: { g9: { hot: ['p2'] } } });
  const second = await captureConsoleAsync(() => sb.flush());
  assert(sb._refusedKeysForTest().includes('cfbp_picks'), 'the earlier refusal is still latched');
  assert(!statuses.some(([st]) => st === 'synced'),
    'a later flush of a CLEAN key emits NO \u2018synced\u2019 while a refused key is still latched');
  assert(statuses.some(([st]) => st === 'refused'), 'it emits \u2018refused\u2019 instead');
  assert(Array.isArray(second.stillRefused) && second.stillRefused.includes('cfbp_picks'),
    'and the return names the set that is still unsaved, so a caller can say which');
  assert(bannerSeen.some((bn) => /cfbp_picks/.test(bn)), 'the banner still names the refused key');

  // NOT RETRIED until a hydrate has landed since.
  const before = CLIENT._calls.updates.length;
  await captureConsoleAsync(() => sb.flush());
  assert(CLIENT._calls.updates.length === before, 'a second flush does NOT re-send the refused key');
  // R2 — the release: a hydrate lands, and the key is retried exactly once.
  ST.weeks.find((w) => w.id === 'w1').status = 'open';
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const after = CLIENT._calls.updates.length;
  await captureConsoleAsync(() => sb.flush());
  assert(CLIENT._calls.updates.length > after, 'R2: after a hydrate lands, the refused key IS retried');
  assert(sb._refusedKeysForTest().length === 0, 'and _refusedKeys is empty once it goes through (the banner comes down)');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A11] the OFFLINE rule — all four conditions (§5.3, D-1(a))…', async () => {
  // Build a snapshot the honest way: hydrate, then let the adapter persist it.
  await hydrated();
  assert(sb.hasDeviceSnapshot() === true, 'a successful hydrate with no dirty keys persists the device snapshot');
  const snapRaw = localStorage.getItem(sb._snapshotKeyForTest());

  // (a) matching owner + valid session + resolved identity -> ACTIVE-STALE on
  //     prime, then OFFLINE-READONLY when the hydrate fails.
  initAdapter({ rpcOverride: (n) => (n === 'get_member_contacts' ? { data: null, error: { code: '08006', message: 'offline' } } : null) });
  localStorage.setItem(sb._snapshotKeyForTest(), snapRaw);
  const primed = sb.primeFromSnapshot(OWNER, LEAGUE_A);
  assert(primed > 0 && sb.getState() === 'ACTIVE-STALE', 'prime from an owner-matched snapshot -> ACTIVE-STALE');
  assert(sb.get('cfbp_weeks').length === 2, 'and it PAINTS (reads are served from the snapshot)');
  assert(sb.probe() === true, 'ACTIVE-STALE: the probe is true — held writes are allowed, and held');
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.getState() === 'OFFLINE-READONLY', 'a failed hydrate over a serveable snapshot -> OFFLINE-READONLY');
  assert(sb.isReady() === true, 'reads are still served (isReady true)');
  assert(sb.probe() === false, 'but the PROBE IS FALSE — offline viewing must never lift the interlock');
  assert(statuses.some(([s]) => s === 'offline'), 'and an ‘offline’ status (the amber weight class) was emitted');

  // ── (a2) REVIEWER F1 — A *LIVE* PAGE THAT LOSES SIGNAL (R1/R2) ───────────
  //
  // THE CASE (a) ABOVE DOES NOT COVER, and the one every player is actually in:
  // a page that has ALREADY hydrated. It is ACTIVE, not ACTIVE-STALE, so the
  // original `serveable` test excluded it and a dropped connection took the
  // whole dashboard to HELD — a blank gate, on a Saturday, for six people who
  // could have gone on reading their own picks. D-1 chose (a) precisely to
  // avoid that.
  await hydrated();
  assert(sb.getState() === 'ACTIVE' && sb.get('cfbp_weeks').length === 2,
    'R1 fixture: a LIVE page — hydrated, ACTIVE, painting a league');
  assert(sb.get(sb._DERIVED_PROGRESS_KEY_FOR_TEST) !== null,
    'R1 fixture: …and holding live week_submission_status() counts, which is what makes the delete below a real event');
  // The network stops answering. No pgCode: a timeout, a dropped connection, a
  // captive portal — nothing about who this device is has changed.
  CLIENT = makeClient(ST, SESSIONS.commissioner, { failSelects: { code: '08006', message: 'connection failure' } });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.getState() === 'OFFLINE-READONLY',
    'R1: ACTIVE + a network failure -> OFFLINE-READONLY, not HELD (reviewer F1 — this is the whole of UN-187)');
  assert(sb.isReady() === true && sb.get('cfbp_weeks').length === 2 && sb.get('cfbp_picks') !== null,
    'R1: …with the MIRROR INTACT — the player goes on reading the league they already had');
  assert(sb.probe() === false,
    'R1: …and the probe still false, so every save is refused through the existing interlock. Reading is not writing');
  assert(sb.get(sb._DERIVED_PROGRESS_KEY_FOR_TEST) === null,
    'R1: …and the derived counts are GONE (DI-T4.11). OFFLINE-READONLY is a SERVING state, so a surviving map would tell five players "3 of 6 submitted" as of a moment that has passed, with no way to tell');
  assert(said(/counts are DROPPED/), 'R1: …and it says so, rather than dropping them silently');

  // THE EXCLUSION, and it is the half that makes the widen safe: a 42501 is the
  // SERVER ANSWERING — a demoted commissioner, a removed member — so something
  // about WHO this device is has changed and the snapshot was taken under the
  // old answer. HELD, per §5.2.
  await hydrated();
  assert(sb.getState() === 'ACTIVE', 'fixture: ACTIVE again before the privilege case');
  CLIENT = makeClient(ST, SESSIONS.commissioner, { failSelects: { code: '42501', message: 'permission denied for table weeks' } });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.getState() === 'HELD',
    'a 42501 READ refusal from ACTIVE goes HELD, never offline — the server answered, and the answer was about this device\u2019s rights (§5.2)');
  assert(sb.isContentWithheldByAdapter() === true,
    '…so content is withheld rather than painted from a snapshot taken under a role this account may no longer have');

  // …and the same for a REJECTED TOKEN. §5.3's condition (1) is a LOCAL expiry
  // check, which a token the server has just refused can still satisfy, so the
  // four-condition rule alone would have served it.
  await hydrated();
  CLIENT = makeClient(ST, SESSIONS.commissioner, { failSelects: { code: 'PGRST301', message: 'JWT expired' } });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.getState() === 'HELD',
    'a PGRST301/401 from ACTIVE also goes HELD — a rejected token is an answer about identity, and A8 forbids painting a league for one');

  // R2 — THE RELEASE. Driven forward: the signal comes back, the next tick's
  // hydrate lands, and everything the failure did is undone.
  await hydrated();
  assert(sb.getState() === 'ACTIVE' && sb.probe() === true,
    'R2: a successful hydrate flips it back to ACTIVE and restores writes');
  assert(sb.get(sb._DERIVED_PROGRESS_KEY_FOR_TEST) !== null,
    'R2: …and the counts come back with it, re-asked rather than un-forgotten');
  assert(sb.isContentWithheldByAdapter() === false, 'R2: …and nothing is withheld');

  // (b) a snapshot for a DIFFERENT owner tuple is cleared, not served.
  initAdapter();
  localStorage.setItem(sb._snapshotKeyForTest(), snapRaw);
  const n = captureConsole(() => sb.primeFromSnapshot('u-someone-else\u0000L-aaaa', LEAGUE_A));
  assert(n === 0, 'a snapshot whose owner tuple does not match primes NOTHING');
  assert(sb.hasDeviceSnapshot() === false, 'and is CLEARED from the device');
  assert(said(/different \(account, league\)/), 'with a console line saying so');

  // (c) an expired/absent token: the four-condition rule fails at (1).
  initAdapter();
  localStorage.setItem(sb._snapshotKeyForTest(), snapRaw);
  VALID_SESSION = false;
  const n2 = captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_A));
  assert(n2 === 0 && sb.getState() === 'IDLE', 'no valid session -> the snapshot is treated as MISSING, nothing paints');
  assert(said(/four-condition rule/), 'and the rule is named in the log');

  // (d) condition (4): the owner MARKER on the device must match too.
  initAdapter();
  localStorage.setItem(sb._snapshotKeyForTest(), snapRaw);
  localStorage.setItem('cfbp_device_data_owner', 'u-drew\u0000L-bbbb');
  assert(captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_A)) === 0,
    'the device owner MARKER disagreeing with the tuple also fails the rule');

  // (e) condition (3b): a snapshot for another LEAGUE is never served.
  initAdapter();
  localStorage.setItem(sb._snapshotKeyForTest(), snapRaw);
  ACTIVE_LEAGUE = LEAGUE_B;
  OWNER = `${ACCOUNT}\u0000${LEAGUE_B}`;
  localStorage.setItem('cfbp_device_data_owner', OWNER);
  assert(captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_B)) === 0,
    'a snapshot whose leagueId is not the active league is never served (§5.3 ‘never show another league’s snapshot’)');

  // R2 — the release: `online` / the 60 s tick retries, and success flips to
  // ACTIVE and drops the amber banner.
  initAdapter();
  localStorage.setItem(sb._snapshotKeyForTest(), snapRaw);
  sb.primeFromSnapshot(OWNER, LEAGUE_A);
  const keys = await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(keys > 0 && sb.getState() === 'ACTIVE' && sb.probe() === true,
    'R2: a successful retry flips OFFLINE-READONLY/ACTIVE-STALE to ACTIVE and restores writes');

  // The snapshot holds SERVER TRUTH only: never written while stale, never with
  // dirty keys, and never carrying the derived progress key.
  await hydrated();
  sb.set('cfbp_reactions', { ...sb.get('cfbp_reactions'), zzz: {} });
  localStorage.removeItem(sb._snapshotKeyForTest());
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.hasDeviceSnapshot() === false, 'a hydrate with DIRTY keys does not persist a snapshot (no held write survives a reload)');
  const snapObj = JSON.parse(snapRaw);
  assert(!(sb._DERIVED_PROGRESS_KEY_FOR_TEST in snapObj.data),
    'and the derived cfbp_week_progress key is never persisted (a stale count would say "nobody has submitted")');
  // REVIEWER F5 — ASSERT THE READ DIRECTLY, not only the absence from the snapshot. What Part B
  // actually calls is `get()`, and "the key is not in the snapshot" and "get() answers null" are two
  // different claims: a future prime that defaulted a missing key to `{}` would satisfy the first
  // and break the second, and `{}` renders as "six members, none submitted" rather than as unknown.
  initAdapter();
  localStorage.setItem(sb._snapshotKeyForTest(), snapRaw);
  sb.primeFromSnapshot(OWNER, LEAGUE_A);
  assert(sb.getState() === 'ACTIVE-STALE', 'primed from the snapshot, the adapter is ACTIVE-STALE');
  assert(sb.get(sb._DERIVED_PROGRESS_KEY_FOR_TEST) === null,
    'and get(cfbp_week_progress) answers NULL while ACTIVE-STALE — never {} (Part B renders absent as UNKNOWN, and {} would render as "nobody has submitted")');
  assert(sb.get('cfbp_weeks') !== null,
    'while the rest of the snapshot IS served, so the null above is the derived key and not an empty mirror');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A12] Realtime: JOINED is not LIVE, and every event is token-checked (§4.2)…', async () => {
  await hydrated();
  const ch = sb.subscribeRealtime();
  assert(!!ch && ch.phase === 'joined', 'subscribeRealtime() starts the channel JOINED, not LIVE');
  const tables = ch.channel._handlers.map((h) => h.cfg.table).sort();
  assert(JSON.stringify(tables) === JSON.stringify(['games', 'league_kv', 'picks', 'weeks']),
    'it subscribes to exactly games/league_kv/picks/weeks');
  assert(!tables.includes('messages'), 'and NEVER to messages (AD-16, Step 5)');
  assert(ch.channel._handlers.every((h) => h.cfg.filter === `league_id=eq.${LEAGUE_A}`),
    'every binding is filtered league_id=eq.<active>');

  // SUBSCRIBED alone does not make it live, and it schedules the re-hydrate
  // that IS the probe (there are no client probe writes — a probe pick would
  // be a real pick).
  const selectsBefore = CLIENT._calls.selects.length;
  ch.channel._subscribed('SUBSCRIBED');
  assert(sb.getStatus().realtime === 'joined', 'SUBSCRIBED alone leaves the channel JOINED');
  await new Promise((r) => setTimeout(r, 5));
  assert(CLIENT._calls.selects.length > selectsBefore, 'and immediately schedules a full re-hydrate (the probe)');
  assert(sb.getStatus().realtime === 'live', 'which is what promotes it to LIVE');

  // An event whose token matches FOLDS.
  await hydrated();
  const ch2 = sb.subscribeRealtime();
  const handler = ch2.channel._handlers.find((h) => h.cfg.table === 'games').cb;
  const g1 = { ...ST.games.find((g) => g.id === 'g1'), home_score: 21, away_score: 7, status: 'live' };
  const folded = captureConsole(() => handler({ eventType: 'UPDATE', new: g1 }));
  assert(folded === true, 'a matching-token games event is folded');
  assert(sb.get('cfbp_games').find((g) => g.gameId === 'g1').homeScore === 21,
    'and the mirror shows the new score, re-projected through fromRows');

  // An event after a SWITCH is discarded.
  sb.beginSwitch(LEAGUE_A, LEAGUE_B);
  await hydrated();
  const ch3 = sb.subscribeRealtime();
  const h3 = ch3.channel._handlers.find((h) => h.cfg.table === 'picks').cb;
  const stale = captureConsole(() => h3({ eventType: 'UPDATE', new: { ...ST.picks[0], selected_team: 'Nowhere' } , _forceStale: true }));
  void stale;
  const before = JSON.stringify(sb.get('cfbp_picks'));
  sb.beginSwitch(LEAGUE_A, LEAGUE_B);
  const discarded = captureConsole(() => h3({ eventType: 'UPDATE', new: { ...ST.picks[0], selected_team: 'Nowhere' } }));
  assert(discarded === false, 'an event delivered after a league switch is DISCARDED');
  assert(said(/already left/), 'with the same "already left" console discipline auth.js:404 uses');
  void before;

  // REVIEWER F2 — AN ACCOUNT CHANGE WITH NO SWITCH AND NO dropMirror YET.
  //
  // This is the case the old clause could not see: it compared `token.epoch` to `_mirrorTag.epoch`,
  // and the token is stamped FROM the mirror tag at subscribe time, so the two were equal by
  // construction. Bump the LIVE epoch — an account change (`auth.js:356-368`) — while the mirror
  // tag and the token both still hold the old one, and the inert clause folds an event belonging to
  // the identity this device has just left. `_opMoved()` asks the live question instead, and it is
  // the same predicate `hydrate()` asks after every await (I6, `auth.js:849`).
  await hydrated();
  const chE = sb.subscribeRealtime();
  const hE = chE.channel._handlers.find((h) => h.cfg.table === 'games').cb;
  const beforeE = JSON.stringify(sb.get('cfbp_games'));
  EPOCH = 99;                       // the account changed; no switch, no dropMirror, same league
  const afterEpoch = captureConsole(() => hE({ eventType: 'UPDATE', new: { ...ST.games.find((g) => g.id === 'g1'), home_score: 77 } }));
  assert(afterEpoch === false,
    'an event arriving after the IDENTITY EPOCH moved — no league switch, no dropMirror — is DISCARDED');
  assert(said(/already left/), 'with the same "already left" console line');
  assert(JSON.stringify(sb.get('cfbp_games')) === beforeE,
    'and the mirror is untouched: the previous identity\u2019s event did not fold');

  // An event carrying another league's league_id is discarded even if the
  // channel filter somehow let it through.
  await hydrated();
  const ch4 = sb.subscribeRealtime();
  const h4 = ch4.channel._handlers.find((h) => h.cfg.table === 'weeks').cb;
  const foreign = captureConsole(() => h4({ eventType: 'UPDATE', new: { league_id: LEAGUE_B, id: 'x1', status: 'final' } }));
  assert(foreign === false, 'an event carrying another league’s league_id is DISCARDED');

  // unsubscribe is idempotent and drops the channel.
  await hydrated();
  sb.subscribeRealtime();
  assert(sb.unsubscribeRealtime() === true && sb.getStatus().realtime === 'off', 'unsubscribeRealtime() drops the channel');
  assert(sb.unsubscribeRealtime() === false, 'and is idempotent');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A13] the FIRST-BOOT WIPE of cfbp_sheet_mirror + cfbp_site_unlocked (§6.1)…', async () => {
  initAdapter();
  localStorage.setItem('cfbp_sheet_mirror', JSON.stringify({ at: 'yesterday', data: { cfbp_picks: [] } }));
  localStorage.setItem('cfbp_site_unlocked', 'true');
  assert(localStorage.getItem('cfbp_sheet_mirror') !== null && localStorage.getItem('cfbp_site_unlocked') !== null,
    'both Sheets-era device records are present BEFORE the first Supabase boot');
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(localStorage.getItem('cfbp_sheet_mirror') === null, 'after the first ACTIVE, cfbp_sheet_mirror is absent');
  assert(localStorage.getItem('cfbp_site_unlocked') === null, 'and cfbp_site_unlocked is absent');
  assert(WIPES.clearMirror === 1, 'through backend.js’s own exported clearMirror(), called exactly once');
  assert(JSON.stringify(WIPES.setSiteUnlocked) === '[false]', 'and storage.js’s setSiteUnlocked(false), exactly once');
  assert(said(/first Supabase data boot/), 'with one console line recording the read-back verdict');
  // REVIEWER F9 — THE READ-BACK GOES THROUGH THE INJECTED ACCESSORS, NOT KEY LITERALS.
  // Proven two ways: the literal is gone from the module, and accessors that DISAGREE with reality
  // are believed (a direct localStorage read would have reported "absent" and never noticed).
  {
    // Comments stripped first, and for a reason this scan hit immediately: the F9 note in the
    // adapter QUOTES the line it replaced, verbatim, so a raw-text scan reports the documentation
    // as the offence. A rule about code has to read code — the same correction the 0008 grant rules
    // needed in static.check.mjs.
    const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    assert(!/localStorage\.getItem\('cfbp_sheet_mirror'\)/.test(src) && !/localStorage\.getItem\('cfbp_site_unlocked'\)/.test(src),
      'the adapter no longer READS either Sheets-era key as a localStorage literal');
    sb._resetForTest();
    store.clear();
    let probes = 0;
    sb.init({
      getClient: () => CLIENT, getActiveLeagueId: () => LEAGUE_A, getIdentityEpoch: () => 7,
      getAccountUserId: () => 'u-drew', getDeviceDataOwnerTuple: () => OWNER, getDeviceDataOwner: () => OWNER,
      register: () => {}, getSession: () => ({ isAdmin: true, playerId: 'p1' }),
      clearMirror: () => {}, setSiteUnlocked: () => {},
      hasSheetMirror: () => { probes++; return true; },   // LIES: says the mirror is still there
      isSiteUnlocked: () => { probes++; return true; },
    });
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: 7 }));
    assert(probes === 2, 'both injected read-back accessors were called, once each');
    assert(said(/STILL PRESENT/),
      'and a read-back reporting the keys are STILL PRESENT is logged as such, never as success');
  }

  // A second ACTIVE in the same page does not re-run it.
  localStorage.setItem('cfbp_site_unlocked', 'true');
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(WIPES.clearMirror === 1 && WIPES.setSiteUnlocked.length === 1, 'a second ACTIVE in the same page does NOT re-run the wipe');
  assert(localStorage.getItem('cfbp_site_unlocked') === 'true', 'so a later legitimate unlock survives');

  // A failure to remove is a WARNING, not a dead boot (the cfbp_session precedent).
  initAdapter();
  sb.init({
    getClient: () => CLIENT, getActiveLeagueId: () => ACTIVE_LEAGUE, getIdentityEpoch: () => EPOCH,
    getAccountUserId: () => ACCOUNT, getDeviceDataOwnerTuple: () => OWNER, getDeviceDataOwner: () => OWNER,
    register: () => {},
    clearMirror: () => { throw new Error('quota'); },
    setSiteUnlocked: () => { throw new Error('quota'); },
    getSession: () => ({ isAdmin: true, playerId: 'p1' }),
  });
  const keys = await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(keys > 0 && sb.getState() === 'ACTIVE', 'a wipe that throws does not kill the boot');
  assert(said(/clearMirror\(\) failed/), 'it warns instead');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A14] dropMirror() — handover and sign-out (§6.6, §3.2)…', async () => {
  await hydrated();
  sb.subscribeRealtime();
  sb.set('cfbp_reactions', { ...sb.get('cfbp_reactions'), w9: {} });
  assert(sb.get('cfbp_players') !== null && sb.hasDeviceSnapshot() === true, 'a hydrated adapter holds a mirror and a snapshot');
  const verdict = captureConsole(() => sb.dropMirror('handover'));
  assert(verdict.cleared === true, 'dropMirror() returns a READ-BACK verdict (so the sweep’s `complete` flag can use it)');
  assert(sb.get('cfbp_players') === null && sb.get('cfbp_picks') === null, 'get() is empty afterwards');
  assert(sb.hasDeviceSnapshot() === false, 'cfbp_supabase_mirror is absent');
  assert(sb._dirtyKeysForTest().length === 0 && sb._refusedKeysForTest().length === 0, 'the dirty and refused sets are cleared');
  assert(sb.getStatus().realtime === 'off', 'the Realtime channel is dropped with it');
  assert(sb.getState() === 'IDLE' && sb.probe() === false, 'and the adapter is IDLE with the probe false');
  assert(sb._mirrorTagForTest() === null, 'the mirror tag is gone, so a late-landing hydrate cannot repopulate what this wiped');

  // A late-landing select cannot repopulate it: the epoch bump that accompanies
  // every account change voids the in-flight op (I6).
  await hydrated();
  const p = sb.hydrate(LEAGUE_A, { epoch: EPOCH });
  captureConsole(() => sb.dropMirror('handover'));
  EPOCH = 8;                                       // the account change bumps the epoch
  await captureConsoleAsync(() => p);
  assert(sb.get('cfbp_players') === null,
    'a hydrate that resolves AFTER a handover (under a new epoch) is discarded, not applied');

  // A14b — PART B LANDED (2026-09-18), the skip is CLOSED.
  //
  // dropMirror()'s own contract is asserted above. What was missing was the
  // CALL SITE: a clearer nobody calls clears nothing. The behavioural drive is
  // authtest.mjs's handover/sign-out sections (which own the fake client and
  // the whole identity lifecycle); here the call site and — the half that
  // actually matters — its verdict feeding `complete` are pinned structurally.
  {
    const authSrc = readFileSync(join(__dirname, 'js', 'auth.js'), 'utf8');
    const fn = authSrc.slice(authSrc.indexOf('export function clearDeviceLocalSessionData'),
      authSrc.indexOf('// ── DI-180q — THE OWNER MARKER'));
    assert(fn.length > 500, 'A14b: fixture — clearDeviceLocalSessionData() was located (a failed slice would make the rest vacuous)');
    assert(/sb\.dropMirror\('handover'\)/.test(fn),
      'A14b: the handover/sign-out clear really CALLS sb.dropMirror() — the live in-memory mirror is league-scoped now, and a sweep that clears the copy and keeps the original has cleared nothing');
    assert(/drop\.cleared === false\) complete = false/.test(fn),
      "A14b: …and the READ-BACK VERDICT feeds `complete`, so a drop that fails OPEN cannot buy an owner-marker stamp (DI-180q's fail-closed rule)");
    assert(/sb\.hasDeviceSnapshot\(\)\) complete = false/.test(fn),
      'A14b: …and the device snapshot is re-asked through the adapter\u2019s own predicate, not through a third copy of the key literal (reviewer F9)');
    assert(!/'cfbp_supabase_mirror'/.test(authSrc),
      'A14b: …so js/auth.js never names cfbp_supabase_mirror by literal at all');
  }
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A15] the cfbp_games OVERLAY: rendered, never pushed (§2.1, §7.1)…', async () => {
  await hydrated({ who: 'player' });
  const games = sb.get('cfbp_games').map((g) => ({ ...g }));
  const g1 = games.find((g) => g.gameId === 'g1');
  g1.homeScore = 17; g1.awayScore = 10; g1.status = 'live';
  g1.lastUpdated = new Date(NOW).toISOString();
  sb.set('cfbp_games', games);
  assert(sb.get('cfbp_games').find((g) => g.gameId === 'g1').homeScore === 17,
    'a player-session saveGame of SCORE fields updates get(cfbp_games)');
  assert(sb._dirtyKeysForTest().includes('cfbp_games') === false, 'and marks nothing dirty');
  assert(sb.planFlush().plan.length === 0, 'so it emits NO push at all');
  assert(sb._overlayForTest().has('g1'), 'it is held as an overlay, keyed by game id');

  // The same write with a NON-score field is a refusal naming the field.
  const bad = games.map((g) => ({ ...g }));
  bad.find((g) => g.gameId === 'g2').spread = -10;
  const e = thrown(() => sb.set('cfbp_games', bad));
  assert(e && e.name === 'AdapterWriteRefusedError' && e.code === 'overlay_only',
    'a player writing a NON-score game field is refused, typed');
  assert(/g2\.spread/.test(e.message), 'and the message names the offending field');
  assert(ST.games.find((g) => g.id === 'g2').spread === 7, 'the server’s row is untouched');
  // REVIEWER F8 — "Nothing was saved" HAS TO BE TRUE.
  //
  // The old code mutated the LIVE overlay inside the loop and threw afterwards, so a write carrying
  // a legal score change AND an illegal field applied the legal half and then refused — the score
  // was already rendering under a message that said nothing had been saved. That is the silent-write
  // class (AD-06) wearing a loud error's clothes, so the decision now happens before the commit.
  assert(sb._overlayForTest().get('g1').homeScore === 17,
    'the overlay still holds only the previously ACCEPTED value for g1');
  const mixed = games.map((g) => ({ ...g }));
  mixed.find((g) => g.gameId === 'g1').homeScore = 999;     // a LEGAL field, a new value
  mixed.find((g) => g.gameId === 'g2').spread = -10;        // an ILLEGAL field, same call
  assert(thrown(() => sb.set('cfbp_games', mixed)) !== null, 'a MIXED legal+illegal write is refused');
  assert(sb._overlayForTest().get('g1').homeScore === 17,
    'and the LEGAL half of it was not applied either — the refusal is atomic');
  assert(sb.get('cfbp_games').find((g) => g.gameId === 'g1').homeScore === 17,
    'which is what get() reports too: the 999 never rendered');

  // The overlay is REPLACED by the next hydrate, by construction.
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb._overlayForTest().size === 0, 'the overlay is cleared on every hydrate');
  assert(sb.get('cfbp_games').find((g) => g.gameId === 'g1').homeScore === 0,
    'and the server’s row is what renders again');

  // The COMMISSIONER pushes them for real.
  await hydrated({ who: 'commissioner' });
  const cg = sb.get('cfbp_games').map((g) => ({ ...g }));
  cg.find((g) => g.gameId === 'g1').homeScore = 28;
  sb.set('cfbp_games', cg);
  const plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].op === 'patch' && plan[0].changed.home_score === 28,
    'the COMMISSIONER’s device patches the score for real (policy 0002:241)');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A16] Q8 — a SCRIBE approve flip patches by SYNTHESIZED ID, never by index…', async () => {
  await hydrated({ who: 'commissioner' });
  const learnings = sb.get('cfbp_scribe_learnings').map((l) => ({ ...l }));
  assert(learnings.length === 2, 'the two learnings projected back in `ord` order');
  // app.js:12023-12027 rewrites all[idx] in place and saves the whole array.
  const idx = 1;
  learnings[idx] = { ...learnings[idx], status: 'approved' };
  sb.set('cfbp_scribe_learnings', learnings);
  const plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].op === 'patch', 'one scribe_learnings patch');
  assert(plan[0].rowId === 'sl_r1_1',
    'keyed by the projection’s SYNTHESIZED id (sl_<runId>_<ord>), never by the array index');
  assert(JSON.stringify(plan[0].changed) === '{"status":"approved"}',
    'and narrowed to the status column, which is the only one scribe_guard permits');
  await sb.flush();
  assert(ST.scribe_learnings.find((l) => l.id === 'sl_r1_1').status === 'approved', 'the server applied it');
  // A player may not.
  await hydrated({ who: 'player' });
  const e = thrown(() => sb.set('cfbp_scribe_learnings', []));
  assert(e && e.code === 'route_refused', 'a player writing cfbp_scribe_learnings is refused client-side');
  // scribe_reports is read-only on both sides.
  const e2 = thrown(() => sb.set('cfbp_scribe_reports', []));
  assert(e2 && e2.code === 'route_refused', 'and cfbp_scribe_reports is refused for everyone (storage.js:1148-1153 has no writer)');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A17] the Sheets RELAY allow-list (§2.7)…', async () => {
  // ── THE ALLOW-LIST IS GONE BECAUSE THE RELAY IS (2026-09-23) ──────────────
  // Step 4 Part B put a guard in `call()` at js/backend.js: every relay except
  // `ping`/`notifyPush` refused with a typed `SheetsRelayRefusedError` once
  // `dataMode` was 'supabase', so a Supabase-scoped league could not read or
  // write the production league's Sheet. `backendtest.mjs [14]` drove thirteen
  // of them, each refused before any fetch.
  //
  // THE SHEETS RETIREMENT REPLACES A GUARD WITH AN ABSENCE, which is strictly
  // stronger: an allow-list is one edit away from admitting an action, and a
  // deleted transport is not. So what this section asserts now is that neither
  // half exists — not the refusal class, not the list, and not `call()` itself.
  {
    const beSrc = readFileSync(join(__dirname, 'js', 'backend.js'), 'utf8');
    const beCode = beSrc.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert(!/SheetsRelayRefusedError|SHEETS_RELAY_ALLOWLIST/.test(beCode),
      'A17: js/backend.js has no SheetsRelayRefusedError and no allow-list — there is nothing left for either to gate');
    assert(!/async function call\s*\(/.test(beCode) && !/script\.google\.com/.test(beCode),
      "A17: …and no call() and no Apps Script URL anywhere in executable code. An allow-list is one edit away from admitting an action; a deleted transport is not");
    assert(!/\bfetch\s*\(/.test(beCode.replace(/fetch\('config\.json[^)]*\)/g, ' ')),
      'A17: …and the ONE fetch left in the module is the config.json read — a same-origin static file beside index.html, not a backend');
  }
  // What Part A could already assert, and still does: the adapter itself never reaches a relay.
  const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
  assert(!/from '\.\/backend\.js'/.test(src) && !/from "\.\/backend\.js"/.test(src),
    'the adapter does not import backend.js (so it can reach no relay at all)');
  assert(!/\bfetch\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')),
    'and contains no fetch() of its own — every request goes through the injected Supabase client');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A18] the CHAT TRANSPORT interlock (§7.3)…', async () => {
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('network disabled in adaptertest'); };
  // Flag OFF: PORTED 2026-09-23. This used to assert that the transport TRIED
  // and failed for the ordinary reason (no backend config) rather than for the
  // interlock — the flag-off world, where 'sheets' meant a live Apps Script
  // log. There is no such world: `chatTransportMode()` never answers 'sheets'
  // again, so predicate-false is `interlocked` too. What survives, and is what
  // this section is actually for, is the ON half below: refused BEFORE any
  // fetch, typed, all five.
  transport.setSupabaseDataModePredicate(() => false);
  let e = await transport.appendEvents([{ id: 'x' }]).then(() => null, (err) => err);
  assert(e && e.name === 'ChatTransportUnavailableError',
    'predicate FALSE: appendEvents is refused too — a device with no shared chat backend has nowhere to append, and says so with the typed designed-refusal error');

  // Flag ON: refused BEFORE any fetch, typed.
  transport.setSupabaseDataModePredicate(() => true);
  const before = fetches;
  for (const [name, call] of [
    ['appendEvents', () => transport.appendEvents([{ id: 'x' }])],
    ['fetchSince', () => transport.fetchSince(0)],
    ['fetchBefore', () => transport.fetchBefore(10)],
    ['fetchHead', () => transport.fetchHead()],
    ['fetchMetrics', () => transport.fetchMetrics(7)],
  ]) {
    e = await call().then(() => null, (err) => err);
    assert(e && e.name === 'ChatTransportUnavailableError' && e.code === 'chat_transport_unavailable',
      `${name}() throws a typed ChatTransportUnavailableError in supabase data mode`);
    assert(e && e.interlocked === true, `${name}()’s error is marked interlocked (a designed refusal, not an outage)`);
  }
  assert(fetches === before, 'and NOT ONE fetch was issued (the refusal is before the request)');
  // COPY AMENDED 2026-09-23. §7.3's original sentence was "Chat moves to the new
  // system in the next build", which was true while this error only ever meant
  // Step 4's cross-league interlock. It now ALSO means "this device has no
  // shared chat backend at all", so telling that player to wait for the next
  // build would be a promise nobody made.
  assert(/no shared backend/.test(e.message) && !/next build/.test(e.message),
    'the message says the device has no shared backend, and no longer promises a next build');
  // Restored, and PROVEN restored. The observable had to change with the copy:
  // predicate-false no longer lets a request out (there is no Apps Script path
  // behind it), so "restored" is proven by the MODE rather than by a successful
  // fetch. A suite that left an INSTALLED predicate answering true behind it
  // would make every later chat assertion in this process pass for the wrong
  // reason, and the reset below is what stops that.
  transport._resetSupabaseDataModePredicateForTest();
  assert(transport.chatTransportMode() === 'interlocked',
    'and the predicate is reset afterwards — nothing later in this process inherits an installed predicate answering true');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[§4.3] cfbp_week_progress — the derived key the client cannot count itself…', async () => {
  await hydrated({ who: 'player' });
  const prog = sb.get('cfbp_week_progress');
  // DI-T4.11 groundwork: the value is `{ at, weeks }`, not a bare map — the counts are an answer
  // ABOUT A MOMENT, and Part B needs to be able to say "as of 4 minutes ago" rather than imply now.
  assert(!!prog && typeof prog.at === 'string' && !!prog.weeks, 'the progress key carries { at, weeks }');
  assert(!Number.isNaN(Date.parse(prog.at)), 'and `at` is a parseable ISO instant');
  assert(!!prog.weeks.w1, 'the open week has a progress entry');
  assert(!('w2' in prog.weeks), 'and a LIVE week does not (the client can count those rows itself)');
  assert(Object.keys(prog.weeks.w1).sort().join(',') === 'p1,p2,p3', 'one entry per ACTIVE member, including members the caller cannot see picks for');
  assert(prog.weeks.w1.p1.pickCount === 1 && prog.weeks.w1.p2.pickCount === 2 && prog.weeks.w1.p3.pickCount === 0,
    'carrying COUNTS for every member — which is how "N of 6" stays true under RLS');
  const keys = new Set(Object.keys(prog.weeks.w1.p1));
  assert(!['selectedTeam', 'guess', 'gameId', 'pickId'].some((k) => keys.has(k)),
    'and no pick, guess or game column anywhere in the response');
  assert(JSON.stringify([...keys].sort()) === '["hasExtraPoint","hasTiebreaker","lastUpdated","pickCount"]',
    'exactly the four derived fields, and nothing else');
  const e = thrown(() => sb.set('cfbp_week_progress', {}));
  assert(e && e.code === 'derived_key', 'and save() on it is refused: it is DERIVED and has no row to write to');

  // A non-member gets not_member, and the adapter treats that as "no counts",
  // not as a hydrate failure.
  initAdapter({ who: 'nonMember' });
  const n = await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(n === 0 && sb.getState() === 'HELD', 'a NON-MEMBER hydrate of that league fails closed (HELD, nothing served)');

  // week_submission_status failing on its own does NOT fail the hydrate.
  initAdapter({ who: 'player', rpcOverride: (name) => (name === 'week_submission_status' ? { data: null, error: { code: '42501', message: 'permission denied for function week_submission_status' } } : null) });
  const k = await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(k > 0 && sb.getState() === 'ACTIVE', 'a refused week_submission_status does NOT fail the hydrate (counts are informational)');
  assert(JSON.stringify(sb.get('cfbp_week_progress').weeks) === '{}', 'the progress key\u2019s `weeks` map is simply empty (and `at` still says when that was answered)');
  assert(said(/week_submission_status\(w1\) refused/), 'and the refusal is logged by week');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[§2.1] the per-key ROUTING TABLE is complete and refuses by default…', async () => {
  const storageSrc = readFileSync(join(__dirname, 'js', 'storage.js'), 'utf8');
  const keysBlock = storageSrc.slice(storageSrc.indexOf('const KEYS = {'), storageSrc.indexOf('\n};', storageSrc.indexOf('const KEYS = {')));
  const declared = [...keysBlock.matchAll(/'(cfbp_[a-z_]+)'/g)].map((m) => m[1]);
  assert(declared.length >= 20, `storage.js's KEYS block was parsed (${declared.length} cfbp_* keys)`);
  const routes = sb._routesForTest();
  // S-C16 (round 1 gate, Drew-approved for this one purpose) — DERIVED from
  // js/storage.js's own device-local list via its read-only test export,
  // not a hand-maintained second copy. The hand-maintained copy this
  // replaced went stale the moment cfbp_shell_ui_state (DI-210b) was added
  // to storage.js and this file was not — the exact drift this change
  // exists to stop from recurring. Nothing else in this file changed.
  const storageMod = await import('./js/storage.js');
  const deviceLocal = storageMod.getDeviceLocalKeysForTest();
  const unrouted = declared.filter((k) => !deviceLocal.has(k) && !(k in routes));
  assert(unrouted.length === 0,
    `every non-device-local cfbp_* key has a declared route (unrouted: ${JSON.stringify(unrouted)})`);
  const stray = Object.keys(routes).filter((k) => !declared.includes(k));
  assert(stray.length === 0, `and the routing table declares no key storage.js does not (${JSON.stringify(stray)})`);
  // Defaulting: an undeclared key is refused, never quietly written.
  await hydrated();
  const e = thrown(() => sb.set('cfbp_something_new', []));
  assert(e && e.code === 'no_route', 'an UNDECLARED key is refused with no_route — never a silent write');
  // Q17: the only player-reachable settings writer is chat.js's startFreshChat,
  // a commissioner action. Grepped rather than assumed.
  const chatSrc = readFileSync(join(__dirname, 'js', 'chat.js'), 'utf8');
  const settingWrites = [...chatSrc.matchAll(/saveSetting\('([^']+)'/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(settingWrites) === '["chatEpochSeq","chatEpochSetAt"]',
    'Q17 grep: chat.js writes exactly chatEpochSeq/chatEpochSetAt and nothing else');
  const chatUiSrc = readFileSync(join(__dirname, 'js', 'chat-ui.js'), 'utf8');
  assert(!/saveSetting\(/.test(chatUiSrc), 'and chat-ui.js writes no setting at all');

  // ── DI §4.3 — THE DERIVED KEY'S NAME EXISTS TWICE, SO IT IS PINNED ───────
  // This module owns `DERIVED_PROGRESS_KEY`; js/storage.js declares its own
  // copy to front it with getWeekProgress() (the seam is the only door, §0.3
  // item 1). Two copies of a string is RG-49's exact shape — `_USER_DATA_KEYS`
  // named two keys that had never existed, so a guard read as though it covered
  // them and was inert for the life of the file. Asserted equal, not assumed.
  const storageKeyLiteral = (storageSrc.match(/const WEEK_PROGRESS_KEY = '([a-z_]+)';/) || [])[1];
  assert(storageKeyLiteral === sb._DERIVED_PROGRESS_KEY_FOR_TEST,
    `storage.js's WEEK_PROGRESS_KEY is byte-identical to the adapter's own (${JSON.stringify(storageKeyLiteral)} vs ${JSON.stringify(sb._DERIVED_PROGRESS_KEY_FOR_TEST)})`);
  assert(/export function getWeekProgress\(\)\{/.test(storageSrc.replace(/\s+/g, ' ').replace(/getWeekProgress\(\) \{/, 'getWeekProgress(){')),
    'and js/storage.js exports getWeekProgress() — the ONE accessor every caller reads the counts through');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[§9.3] BYTE-IDENTITY of load() between the two adapters, per key…', async () => {
  // The offline half of §9.3, and the comparison is deliberately exact: build
  // rows with `toRows` from a fixture league, serve them through `sb.get()`
  // after a real hydrate, and compare
  // `canonicalize(stripCredentials(k, sheetsValue))` to
  // `canonicalize(stripCredentials(k, sb.get(k)))`.
  //
  // RUN AS THE COMMISSIONER, which is the ONE documented exception: a plain
  // member's `cfbp_players` legitimately lacks other members' contact fields
  // (DI-T7.6), so a member-role comparison would differ BY DESIGN. Run under
  // both TZs (RG-38's trap) — the command in this file's header.
  const ctx = { leagueId: LEAGUE_A, memberIds: new Set(['p1', 'p2', 'p3']) };
  const sheetsValues = {
    cfbp_weeks: [
      { weekId: 'w1', season: '2026', weekNumber: 1, label: 'Week 1', status: 'open',
        picksLockAt: new Date(NOW + 3600e3).toISOString(), lockedAt: null, pendingFinalization: false },
    ],
    cfbp_picks: [
      { pickId: 'pk1', weekId: 'w1', gameId: 'g1', playerId: 'p1', selectedTeam: 'Iowa State',
        selectedAt: new Date(NOW - 600e3).toISOString(), updatedAt: new Date(NOW - 600e3).toISOString(),
        locked: false, result: 'pending' },
    ],
    cfbp_nicknames: { p2: 'The Colonel' },
    cfbp_tiebreaker_guesses: { 'w1__p1': 42 },
    cfbp_reactions: { w1: { g1: { '\u{1f525}': ['p2'] } } },
    cfbp_comments: [
      { commentId: 'c1', weekId: 'w1', gameId: 'g1', authorId: 'p2', authorKind: 'player',
        botEventKey: null, body: 'lock of the week', createdAt: new Date(NOW - 300e3).toISOString() },
    ],
    cfbp_game_requests: [
      { id: 'gr1', kind: 'request', playerId: 'p2', homeTeam: 'Iowa', awayTeam: 'Iowa State',
        gameDate: '2026-09-12', createdAt: new Date(NOW).toISOString() },
    ],
  };

  // Replace the mock store's rows with exactly what `toRows` produces from the
  // Sheets-shaped values — that is what makes this a comparison of the two
  // ADAPTERS and not of two hand-written fixtures.
  initAdapter({ who: 'commissioner' });
  for (const [key, value] of Object.entries(sheetsValues)) {
    const produced = proj.toRows[key](value, ctx);
    for (const [table, rows] of Object.entries(produced)) {
      if (table === 'league_kv') {
        for (const r of rows) {
          const existing = ST.league_kv.find((x) => x.league_id === r.league_id && x.key === r.key);
          if (existing) existing.value = r.value; else ST.league_kv.push(row(r));
        }
      } else {
        ST[table] = rows.map((r) => row(r));
      }
    }
  }
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  let compared = 0;
  for (const [key, value] of Object.entries(sheetsValues)) {
    const sheets = proj.canonicalize(proj.stripCredentials(key, value));
    const supa = proj.canonicalize(proj.stripCredentials(key, sb.get(key)));
    assert(sheets === supa, `${key}: load() is BYTE-IDENTICAL between the Sheets value and sb.get() (${process.env.TZ || 'system TZ'})`);
    compared++;
  }
  assert(compared === Object.keys(sheetsValues).length, `all ${compared} projected keys were compared (a loop that compared nothing would pass)`);
  // Teeth: the comparator must be able to SEE a difference.
  const mutated = JSON.parse(JSON.stringify(sheetsValues.cfbp_picks));
  mutated[0].selectedTeam = 'Kansas';
  assert(proj.canonicalize(mutated) !== proj.canonicalize(sheetsValues.cfbp_picks),
    'and the comparator really does distinguish two different values');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[state table] every transition goes through ONE _setState, and it emits…', async () => {
  initAdapter();
  const seen = [];
  sb.onStatus((s, d) => seen.push(`${s}:${d && d.state}`));
  const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // `=(?!=)` — an assignment, not a comparison. Without the negative lookahead
  // every `_state === next` counted as a write and the rule said 8.
  const assignments = [...code.matchAll(/(^|[^\w.])_state\s*=(?!=)/g)].length;
  assert(assignments === 3,
    '_state is assigned in exactly THREE places — its `let` declaration, inside _setState(), and '
    + `inside _resetForTest() (found ${assignments}); no other function may move the state machine`);
  const setStateBody = code.slice(code.indexOf('function _setState('), code.indexOf('function getStatus('));
  assert((setStateBody.match(/(^|[^\w.])_state\s*=(?!=)/g) || []).length === 1,
    'and exactly one of those three is inside _setState()');
  assert(/function _setState\(next, reason\)/.test(code), 'and the transition function has the signature §1.3 names');
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(seen.includes('syncing:HYDRATING'), 'IDLE -> HYDRATING emits syncing');
  assert(seen.includes('synced:ACTIVE'), 'HYDRATING -> ACTIVE emits synced');
  assert(seen.some((s) => s.startsWith('syncing:') || s.startsWith('synced:')),
    'every emit carries detail.state so the badge can say WHY, not only "error"');
  sb._setStateForTest('HELD', 'test');
  assert(seen.includes('error:HELD'), 'HELD emits error');
  sb._setStateForTest('OFFLINE-READONLY', 'test');
  assert(seen.includes('offline:OFFLINE-READONLY'), 'OFFLINE-READONLY emits offline (amber, not a sync error)');
  sb._setStateForTest('SWITCHING', 'test');
  assert(seen.includes('syncing:SWITCHING'), 'SWITCHING emits syncing');
  assert(thrown(() => sb._setStateForTest('NONSENSE', 'test')) !== null, 'an unknown state throws rather than being accepted');
  const st = sb.getStatus();
  assert(['state', 'leagueId', 'epoch', 'lastSyncAt', 'lastError', 'pendingWrites'].every((k) => k in st),
    'getStatus() carries the six fields §1.1 names');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[security F-3] the authorization tables are FROZEN…', async () => {
  // SECURITY F-3. ROUTES decides, per key, whether a write is a row operation, an RPC, a
  // mirror-only overlay or a refusal — it is the authorization table this module is built on, and
  // as an ordinary mutable object any code in the page could have set
  // `ROUTES.cfbp_results.player = 'rows'` and turned every refusal in §2.1 into a write, silently.
  // Freezing is not a boundary against same-realm code; it converts a silent redefinition into a
  // thrown TypeError under strict mode (ES modules always are), which is the difference between a
  // change nobody sees and one that stops.
  const t = sb._frozenTablesForTest();
  for (const [name, obj] of Object.entries(t)) {
    assert(Object.isFrozen(obj), `${name} is frozen`);
  }
  // The ENTRIES too, not just the outer object — that is where the interesting mutation is.
  for (const [key, entry] of Object.entries(t.ROUTES)) {
    assert(Object.isFrozen(entry), `ROUTES.${key} is frozen entry-deep`);
  }
  assert(thrown(() => { t.ROUTES.cfbp_results.player = 'rows'; }) instanceof TypeError,
    'the exact escalation the freeze exists for — turning cfbp_results\u2019 player refusal into a write — THROWS');
  assert(t.ROUTES.cfbp_results.player === 'refuse', 'and the table is unchanged');
  assert(thrown(() => { t.ROUTES.cfbp_new_key = { table: 'x', comm: 'rows', player: 'rows' }; }) instanceof TypeError,
    'and ADDING a route throws too (a frozen object refuses new keys, not only new values)');
  // SECURITY F-E — THE ALLOW-LISTS ARE FROZEN ARRAYS, NOT SETS, AND THIS IS WHY.
  //
  // Two earlier shapes both failed a one-line probe. `Object.freeze(new Set(...))` leaves
  // add/delete/clear working, because a Set's contents are internal slots rather than properties.
  // Replacing the three mutators with own-property stubs and freezing was better and still
  // bypassable: `Set.prototype.add.call(set, x)` walks past an own-property stub and mutates the
  // internal slot anyway. An array has no internal slot to go around — its elements ARE indexed
  // properties and its length IS a property — so `Object.freeze` reaches all of it.
  //
  // THE PROBE IS SHAPE-AGNOSTIC ON PURPOSE. Asserting "push() throws" is satisfied by a value that
  // has no `push` at all — which is exactly what a Set is — so those assertions would have passed
  // against the shape they exist to reject. What is actually being claimed is that THE CONTENTS DO
  // NOT CHANGE, whatever is thrown at them, so that is what is measured: snapshot, attempt every
  // bypass, compare. A throw is allowed and a silent no-op is allowed; a mutation is not.
  for (const [name, list] of [['GAME_SCORE_FIELDS', t.GAME_SCORE_FIELDS], ['TRANSITION_ALLOWED', t.TRANSITION_ALLOWED],
    ['PROBE_TRUE_STATES', t.PROBE_TRUE_STATES], ['READY_STATES', t.READY_STATES]]) {
    assert(Array.isArray(list), `${name} is a frozen ARRAY, not a Set (a Set's contents are internal slots and cannot be frozen)`);
    assert(Object.isFrozen(list), `${name} is frozen`);
    const before = JSON.stringify([...list]);
    const attempts = [
      ['push', () => list.push('MUTATED')],
      ['index write', () => { list[0] = 'MUTATED'; }],
      ['length = 0', () => { list.length = 0; }],
      // THE PROTOTYPE-CALL PROBES — the exact bypasses that defeated the two earlier shapes.
      ['Array.prototype.push.call', () => Array.prototype.push.call(list, 'MUTATED')],
      ['Array.prototype.splice.call', () => Array.prototype.splice.call(list, 0, 1)],
      ['Set.prototype.add.call', () => Set.prototype.add.call(list, 'MUTATED')],
      ['Set.prototype.delete.call', () => Set.prototype.delete.call(list, [...list][0])],
      ['Set.prototype.clear.call', () => Set.prototype.clear.call(list)],
    ];
    for (const [label, fn] of attempts) {
      thrown(fn);                                    // a throw is fine; a mutation is not
      assert(JSON.stringify([...list]) === before, `${name} is UNCHANGED after ${label}`);
    }
    assert(list.length === JSON.parse(before).length, `${name} still has its ${JSON.parse(before).length} entries`);
  }
  // The specific escalations, named rather than left to the loop.
  assert(thrown(() => Array.prototype.push.call(t.GAME_SCORE_FIELDS, 'spread')) instanceof TypeError,
    'widening the overlay field allow-list with `spread` — which would make the player overlay a write path for the SIGNED SPREAD (AD-03) — throws, even through the prototype');
  assert(thrown(() => Array.prototype.push.call(t.TRANSITION_ALLOWED, 'final>open')) instanceof TypeError,
    'and so does widening the week-transition allow-list');
  assert(thrown(() => Array.prototype.push.call(t.PROBE_TRUE_STATES, 'HELD')) instanceof TypeError,
    'and adding a state to the probe\u2019s true-list — which would lift the write interlock during a hold');
  // And the lists still ANSWER correctly: an immutable allow-list that stopped matching would be a
  // silent refusal of everything, which is its own outage.
  assert(t.GAME_SCORE_FIELDS.includes('homeScore') && !t.GAME_SCORE_FIELDS.includes('spread'),
    'membership still reads correctly: homeScore is in the overlay list and spread is not');
  assert(t.PROBE_TRUE_STATES.includes('ACTIVE') && !t.PROBE_TRUE_STATES.includes('HELD'),
    'and the probe list still contains ACTIVE and not HELD');
  assert(t.TRANSITION_ALLOWED.includes('locked>live') && !t.TRANSITION_ALLOWED.includes('final>open'),
    'and the transition list still contains locked>live and not final>open');

  // _routesForTest() hands back a DEEP COPY, so a test can read the shape without being handed the
  // frozen original (and so a mutation of the copy proves nothing about the real one).
  const copy = sb._routesForTest();
  assert(copy !== t.ROUTES && Object.isFrozen(copy) === false, '_routesForTest() returns an unfrozen COPY');
  copy.cfbp_results.player = 'rows';
  assert(t.ROUTES.cfbp_results.player === 'refuse', 'and mutating that copy does not reach the real table');
});

await section('\n[security F-6] comments ownership in the planner\u2026', async () => {
  // SECURITY F-6. `comments` is keyed on `author_member_id`, NOT `member_id`. Before this branch
  // the route carried no `ownRowsOnly` at all, so `_mayOperateOnRow` returned true on its first
  // line and a player's whole-array rewrite emitted a delete for EVERY comment that vanished from
  // it \u2014 including other people's, which 0008's comments_delete would refuse one layer later.
  await hydrated({ who: 'player' });          // the player is p2; c1 is p2's, c2 is p1's
  const all = sb.get('cfbp_comments');
  assert(all.length === 2, 'the player sees both comments (comments_select is is_member)');

  const withoutOther = all.filter((c) => c.commentId !== 'c2');   // drop the COMMISSIONER's comment
  sb.set('cfbp_comments', withoutOther);
  const rP = captureConsole(() => sb.planFlush());
  assert(!rP.plan.some((o) => o.key === 'cfbp_comments' && o.op === 'delete'),
    'a PLAYER losing another member\u2019s comment from the array emits NO delete for it');
  assert(said(/is not this caller's to make/), 'and the drop is named on the console, not silent');

  // His OWN comment vanishing IS a delete he may make.
  await hydrated({ who: 'player' });
  sb.set('cfbp_comments', sb.get('cfbp_comments').filter((c) => c.commentId !== 'c1'));
  const rOwn = captureConsole(() => sb.planFlush());
  assert(rOwn.plan.some((o) => o.key === 'cfbp_comments' && o.op === 'delete' && o.rowId === 'c1'),
    'but his OWN comment vanishing DOES emit a delete');

  // And the commissioner may delete anyone's \u2014 the moderation half of comments_delete.
  await hydrated({ who: 'commissioner' });
  sb.set('cfbp_comments', sb.get('cfbp_comments').filter((c) => c.commentId !== 'c1'));
  const rComm = captureConsole(() => sb.planFlush());
  assert(rComm.plan.some((o) => o.key === 'cfbp_comments' && o.op === 'delete' && o.rowId === 'c1'),
    'the COMMISSIONER deleting another member\u2019s comment DOES emit a delete (0008: own row OR commissioner)');

  // An INSERT carries author_id === author_member_id, which is DI-T4.6a's conjunct. The projection
  // derives both from the same legacy `authorId`, so this checks that the projection and the policy
  // agree \u2014 not the adapter's own arithmetic.
  await hydrated({ who: 'player' });
  sb.set('cfbp_comments', [...sb.get('cfbp_comments'), {
    commentId: `cm_new_${Date.now()}`, weekId: 'w1', gameId: 'g1', authorId: 'p2',
    authorKind: 'player', botEventKey: null, body: 'new one', createdAt: new Date(NOW).toISOString(),
  }]);
  const rIns = captureConsole(() => sb.planFlush());
  const ins = rIns.plan.find((o) => o.key === 'cfbp_comments' && o.op === 'insert');
  assert(!!ins && ins.rows[0].author_id === ins.rows[0].author_member_id,
    'a comment INSERT carries author_id === author_member_id, so 0008\u2019s DI-T4.6a conjunct admits it');
  assert(ins && ins.rows[0].author_member_id === 'p2', 'and both are the caller\u2019s own member id');
});

await section('\n[security O-5] planFlush() refuses structurally, not by call order…', async () => {
  // planFlush() is exported — adaptertest reads the plan without a network, and Part B may want a
  // pending-writes panel. An exported planner that builds a plan from a HELD or SWITCHING mirror is
  // building it against a league this device is no longer acting in, so the guard lives HERE rather
  // than only in flush()'s prologue.
  await hydrated({ who: 'commissioner' });
  const picks = sb.get('cfbp_picks').map((x) => ({ ...x }));
  picks.find((x) => x.pickId === 'pk1').selectedTeam = 'Kansas';
  sb.set('cfbp_picks', picks);
  assert(sb.planFlush().plan.length === 1, 'ACTIVE: the plan is built');
  for (const st of ['HELD', 'SWITCHING', 'OFFLINE-READONLY', 'ACTIVE-STALE', 'IDLE', 'HYDRATING']) {
    sb._setStateForTest(st, 'test');
    const r = sb.planFlush();
    assert(r.plan.length === 0 && r.heldBy === st,
      `${st}: planFlush() returns an EMPTY plan and names the state that refused it`);
  }
  sb._setStateForTest('ACTIVE', 'test');
  assert(sb.planFlush().plan.length === 1, 'and back in ACTIVE the same dirty entry plans again (R2)');
});

await section('\n[zero side effects] importing the adapter does nothing…', async () => {
  // The property Part B depends on: `import * as sb` must not create a client,
  // read storage, arm a timer or touch the DOM. Asserted as source text
  // because a behavioural test cannot distinguish "did nothing" from "did
  // something idempotent".
  const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const imports = [...code.matchAll(/^import\s[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert(JSON.stringify(imports) === JSON.stringify(['./supabase-projection.js']),
    `the ONLY import is ./supabase-projection.js (found ${JSON.stringify(imports)})`);
  for (const forbidden of ['./auth.js', './app.js', './storage.js', './backend.js']) {
    assert(!imports.includes(forbidden), `it does not import ${forbidden}`);
  }
  // COLUMN 0 ONLY, deliberately: an indented `localStorage.setItem` is inside a
  // function and runs when that function is called. A trimmed match reported
  // `_persistSnapshot()`'s own write as a module-level side effect.
  const topLevel = code.split('\n').filter((l) => /^(localStorage|document|window|setTimeout|setInterval)\b/.test(l));
  assert(topLevel.length === 0, `no top-level localStorage/document/window/timer statement (${JSON.stringify(topLevel)})`);
  assert(!/^\s*(await|sb\.init|init\()/m.test(code.split('\n').filter((l) => !/^\s/.test(l)).join('\n')),
    'and nothing is invoked at module scope');
});

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
await section('\n[SEC-F1] _fail() is an ALLOW-LIST of network failures; the default is HELD…', async () => {
  // THE FINDING (delta audit #15). The first version asked "is this one of three
  // KNOWN server answers?" and treated everything else as a network outage — a
  // deny-list with an open default. Three shapes the auditor walked through it
  // with are the first three cases below, and all three PAINTED A LEAGUE from
  // the device snapshot. A 403 is the server saying no; an empty error is us not
  // knowing what happened; neither is a reason to serve six people's picks.

  // ── (1) THE CLASSIFIER, DIRECTLY. It is the whole of the fix, so it is
  //        driven shape by shape rather than only through a hydrate.
  const c = sb._classifyHydrateFailureForTest;
  const mk = (o) => Object.assign(new Error(o.message || 'x'), o);

  // The three the audit reproduced.
  assert(c(mk({ status: 403, message: 'Forbidden' })) !== 'network',
    'SEC-F1: {status:403, Forbidden} is NOT network — an edge or proxy refusing the request is the server saying no, and it carries no pgCode for a deny-list to match on');
  assert(c(mk({})) === 'unclassified',
    'SEC-F1: an EMPTY error is unclassified — "we do not know what happened" is never permission to paint a league');
  assert(c(mk({ pgCode: 'PGRST103' })) === 'unclassified',
    'SEC-F1: a PostgREST code that is not one of the named three is unclassified — new server behaviour cannot open the offline path by default');

  // A thrown non-Error, and a thrown string.
  assert(c('boom') === 'unclassified', 'SEC-F1: a thrown STRING is unclassified');
  assert(c(null) === 'unclassified', 'SEC-F1: a thrown null is unclassified');
  assert(c(undefined) === 'unclassified', 'SEC-F1: …and so is nothing at all');

  // ── REVIEWER F4 — ANY HTTP STATUS IS AN ANSWER ──────────────────────────
  // The LABELS differ (401/403 read as a session problem so the player is told
  // to sign in; the rest are 'http-status'), but the PROPERTY under test is the
  // same for all of them and it is the only one that matters: not 'network',
  // therefore HELD. Asserted that way round so a future relabelling cannot
  // quietly move one of them into the serving path.
  for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
    const kind = c(mk({ status, message: `HTTP ${status}` }));
    assert(kind !== 'network',
      `SEC-F1: HTTP ${status} is NOT network (got '${kind}') — a response arrived, so something read the request and replied`);
  }
  assert(c(mk({ status: 403, code: '', message: 'Forbidden' })) === 'session',
    "SEC-F1: {status:403, code:''} — the shape the SDK produces for a body PostgREST did not author (an edge or gateway refusal) — reads as a SESSION problem, so the player is told to sign in rather than shown a connection error");
  assert(c(mk({ httpStatus: 403, message: 'Forbidden' })) === 'session',
    'SEC-F1: …and the same through `httpStatus`, which is what _select() now carries off the response');
  assert(c(mk({ status: 502, message: 'Bad Gateway' })) === 'http-status',
    'SEC-F1: a 502 is the PROXY saying the backend is unreachable — a fact about the SERVER, not about this handset\u2019s radio, so it holds');

  // ── (2) THE ALLOW-LIST. Each entry is a case where NO HTTP RESPONSE EXISTS.
  assert(c(mk({ name: 'TypeError', message: 'Failed to fetch' })) === 'network',
    'SEC-F1: a fetch TypeError is NETWORK (Chrome’s wording)');
  assert(c(mk({ name: 'TypeError', message: 'NetworkError when attempting to fetch resource.' })) === 'network',
    'SEC-F1: …Firefox’s wording');
  assert(c(mk({ name: 'TypeError', message: 'Load failed' })) === 'network',
    'SEC-F1: …and Safari’s. Three browsers, three strings, one event');
  assert(c(mk({ name: 'AbortError', message: 'The operation was aborted.' })) === 'network',
    'SEC-F1: an AbortError is network — the request was given up on');
  assert(c(mk({ name: 'TimeoutError', message: 'timeout' })) === 'network', 'SEC-F1: …and a TimeoutError');
  for (const code of sb._connectionSqlstatesForTest()) {
    assert(c(mk({ pgCode: code })) === 'network',
      `SEC-F1: SQLSTATE ${code} is network — a connection that died, not a request that was judged`);
    // ── REVIEWER F-A — AND IT STILL IS WHEN IT ARRIVES WITH ITS 503 ────────
    // PostgREST answers 503 when the pooler cannot reach the database, so the
    // code and the status arrive TOGETHER. The previous pass tested the status
    // first, which meant every real pooler restart — the commonest free-tier
    // outage, and the one UN-187 exists for — classified 'http-status' and went
    // to a blank gate.
    assert(c(mk({ pgCode: code, status: 503 })) === 'network',
      `SEC-F1/F-A: SQLSTATE ${code} WITH HTTP 503 is still network — that pairing IS what a pooler restart looks like on the wire`);
    // …but the status has to be CONSISTENT. A connection code under any other
    // status is incoherent — an edge inventing a body, or something spoofing
    // one — and an incoherent answer is still an answer.
    assert(c(mk({ pgCode: code, status: 403 })) === 'http-status',
      `SEC-F1/F-A: SQLSTATE ${code} under HTTP 403 is an ANSWER, not network — a 403 that claims a connection failure is not describing this handset's radio`);
    assert(c(mk({ pgCode: code, status: 200 })) === 'http-status',
      `SEC-F1/F-A: …and so is ${code} under a 200`);
  }
  assert(sb._connectionSqlstatesForTest().every((x) => /^08|^57P0/.test(x)),
    'SEC-F1: …and the list is exactly the 08xxx connection class plus 57P0x shutdown/cannot-connect');

  // A TypeError whose message is NOT a network string is still unclassified —
  // otherwise any programming error in the adapter would read as "offline".
  assert(c(mk({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'id')" })) === 'unclassified',
    'SEC-F1: a TypeError that is a BUG, not a fetch failure, is unclassified — a crash must not become an offline banner');

  // ── (3) THE NAMED ANSWERS still win, and they win FIRST.
  assert(c(mk({ pgCode: '42501' })) === 'privilege', 'SEC-F1: 42501 is privilege');
  assert(c(mk({ pgCode: 'PGRST301' })) === 'session' && c(mk({ pgCode: '401' })) === 'session', 'SEC-F1: PGRST301/401 is session');
  assert(c(Object.assign(new Error('x'), { rgPartialRead: true })) === 'partial-read', 'SEC-F1: RG-12 (b) is partial-read');
  // …and a named answer is not re-labelled by a flapping radio.
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setNav = (v) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true });
  try {
    setNav({ onLine: false });
    assert(c(mk({ pgCode: '42501' })) === 'privilege',
      'SEC-F1: with navigator.onLine FALSE, a 42501 is STILL privilege — the server told us something, and a radio that flapped afterwards does not change it');
    assert(c(mk({ pgCode: 'PGRST103' })) !== 'network',
      'SEC-F1: …and a failure carrying a POSTGRES CODE is not re-labelled either — a response existed, and onLine is the weakest signal in the function, so it decides LAST and only when nothing else did');
    assert(c(mk({ status: 502 })) !== 'network',
      'SEC-F1: …nor one carrying an HTTP status');
    assert(c(mk({ message: 'something went wrong' })) === 'network',
      'SEC-F1: …while a failure with NO code and NO status, on a browser reporting no network, IS network — the one place onLine is allowed to decide');
  } finally {
    if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc);
    else setNav(undefined);
  }

  // ── (4) END TO END: each shape, through a real hydrate from ACTIVE.
  for (const [label, failure, expected] of [
    ['{status:403}', { status: 403, message: 'Forbidden' }, 'HELD'],
    ['{} (empty)', {}, 'HELD'],
    ["{code:'PGRST103'}", { code: 'PGRST103', message: 'Requested range not satisfiable' }, 'HELD'],
    ["{code:'08006'}", { code: '08006', message: 'connection failure' }, 'OFFLINE-READONLY'],
  ]) {
    await hydrated();
    assert(sb.getState() === 'ACTIVE', `SEC-F1 fixture: ACTIVE before ${label}`);
    CLIENT = makeClient(ST, SESSIONS.commissioner, { failSelects: failure });
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    assert(sb.getState() === expected,
      `SEC-F1 end-to-end: a select failing with ${label} from ACTIVE -> ${expected} (got ${sb.getState()})`);
  }

  // ── (4c) REVIEWER F4 — THE STATUS IS ON THE *RESPONSE*, AND _select() CARRIES IT ──
  // The end-to-end case the classifier's own unit assertions CANNOT reach: the
  // error object is `{code:'', message:'Forbidden'}` — nothing in it says 403 —
  // and the status lives on the response beside it. If `_select()` does not
  // copy it onto the thrown error, the classifier sees a code-less, status-less
  // failure. (With `navigator.onLine` false, which a phone on a captive-portal
  // wifi may well report, that combination would have been NETWORK and served.)
  {
    await hydrated();
    assert(sb.getState() === 'ACTIVE', 'F4 fixture: ACTIVE before the edge-403');
    CLIENT = makeClient(ST, SESSIONS.commissioner, {
      failSelects: { code: '', message: 'Forbidden' }, failStatus: 403,
    });
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    assert(sb.getState() === 'HELD',
      'REVIEWER F4: an edge 403 whose error carries NO code -> HELD. The only trace of it is res.status, so this passes only because _select() carries it onto the thrown error');
    assert(said(/REJECTED the token|ANSWERED with HTTP/),
      '…and the log names it as a server ANSWER rather than as an outage');

    // THE CASE WHERE THE CARRY ACTUALLY DECIDES, and the reason it is a finding
    // rather than a tidiness note. Without the status, this failure is
    // code-less AND status-less — and `navigator.onLine === false` is then
    // allowed to label it NETWORK, which SERVES the snapshot. A phone on a
    // captive-portal wifi reports exactly that combination: onLine true or
    // false depending on the OS, and a portal happily returning a 403 to an
    // API call. So: edge 403 + the browser claiming no network must STILL hold.
    const navDesc2 = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
      await hydrated();
      CLIENT = makeClient(ST, SESSIONS.commissioner, {
        failSelects: { code: '', message: 'Forbidden' }, failStatus: 403,
      });
      await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
      assert(sb.getState() === 'HELD',
        'REVIEWER F4 + SEC-F1: an edge 403 with the browser ALSO reporting no network is STILL HELD — this is the combination that would have served a league off a captive portal, and it is only distinguishable because _select() carried the status');
    } finally {
      if (navDesc2) Object.defineProperty(globalThis, 'navigator', navDesc2);
      else Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
    }
  }

  // ── (4d) REVIEWER F-A, END TO END — THE POOLER RESTART ──────────────────
  // The whole point of D-1 (a), driven as the event it actually is: the
  // database goes away for thirty seconds, PostgREST answers 503 with a
  // class-08 code, and six people go on reading the league they already had.
  for (const [code, label] of [['08006', 'connection_failure'], ['57P03', 'cannot_connect_now']]) {
    await hydrated();
    assert(sb.getState() === 'ACTIVE', `F-A fixture: ACTIVE before the ${label} restart`);
    const weeksBefore = sb.get('cfbp_weeks').length;
    CLIENT = makeClient(ST, SESSIONS.commissioner, {
      failSelects: { code, message: label }, failStatus: 503,
    });
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    assert(sb.getState() === 'OFFLINE-READONLY',
      `REVIEWER F-A: a pooler restart (${code} + HTTP 503) from ACTIVE -> OFFLINE-READONLY (got ${sb.getState()}) — the single most common real outage on this tier, and the one that used to produce a blank gate`);
    assert(sb.get('cfbp_weeks').length === weeksBefore && sb.get('cfbp_picks') !== null,
      `REVIEWER F-A: …with the MIRROR INTACT for ${code} — the player goes on reading their league`);
    assert(sb.probe() === false,
      'REVIEWER F-A: …and writes still refused, because reading is not writing');
  }
  // The incoherent pairing, end to end: a 403 that carries a connection code.
  await hydrated();
  CLIENT = makeClient(ST, SESSIONS.commissioner, {
    failSelects: { code: '08006', message: 'connection_failure' }, failStatus: 403,
  });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.getState() === 'HELD',
    'REVIEWER F-A: a 403 CARRYING 08006 is HELD — the status and the code disagree, and a disagreement is still the server having said something');

  // A CLIENT THAT THROWS — the real fetch-failure path, where no `error` object
  // is produced at all and the exception propagates out of the await.
  await hydrated();
  CLIENT = makeClient(ST, SESSIONS.commissioner, { throwSelects: () => Object.assign(new TypeError('Failed to fetch'), {}) });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.getState() === 'OFFLINE-READONLY',
    'SEC-F1 end-to-end: a THROWN fetch TypeError (no error object at all) -> OFFLINE-READONLY, which is the real Saturday-afternoon case');
  assert(sb.get('cfbp_weeks').length === 2, 'SEC-F1: …with the mirror intact');

  await hydrated();
  CLIENT = makeClient(ST, SESSIONS.commissioner, { throwSelects: () => 'a thrown string, not an Error' });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb.getState() === 'HELD',
    'SEC-F1 end-to-end: a thrown STRING -> HELD. The classifier must survive a non-Error without treating it as an outage');

  // ── (4b) REVIEWER F5 — RG-12 (b) FROM *ACTIVE-STALE*, THE CHANGED EDGE ──
  //
  // Before the partial-read exclusion, an ACTIVE-STALE device that got a
  // 200-carrying-no-league went OFFLINE-READONLY (it was serveable). It now
  // goes HELD, and the reviewer accepted that as MORE correct — so the edge is
  // pinned here in the direction it was chosen, rather than left to be
  // rediscovered as a behaviour change.
  //
  // WHY HELD IS RIGHT EVEN THOUGH THE DEVICE CAN SERVE. The snapshot is intact
  // either way; what differs is what the player is TOLD. The amber banner says
  // "You're offline" — and this device is demonstrably online, because it just
  // received a 200. The honest words are RG-12's own ("Sync refused … usually a
  // partial read — retry in a moment"), and those only appear on the hold. One
  // wrong sentence on a Saturday is how BUG-A cost a session of hunting a
  // data-loss bug that was not happening.
  {
    await hydrated();
    const snapForStale = localStorage.getItem(sb._snapshotKeyForTest());
    assert(!!snapForStale, 'SEC-F1/F5 fixture: a snapshot exists to prime ACTIVE-STALE from');
    initAdapter({ emptySelects: ['league_members', 'weeks', 'picks'] });
    localStorage.setItem(sb._snapshotKeyForTest(), snapForStale);
    const primedStale = sb.primeFromSnapshot(OWNER, LEAGUE_A);
    assert(primedStale > 0 && sb.getState() === 'ACTIVE-STALE',
      'SEC-F1/F5 fixture: ACTIVE-STALE, serving the snapshot — the one state that USED to serve a partial read');
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    assert(sb.getState() === 'HELD',
      'REVIEWER F5: a partial read from ACTIVE-STALE now goes HELD, not OFFLINE-READONLY — a behaviour change, taken deliberately, in the direction that tells the truth');
    assert(/Sync refused/.test(sb.getStatus().lastError),
      '…keeping RG-12\u2019s own words, which are the accurate ones for a 200 that carried no league');
    // The branch earns its keep through the WORDS, not the state: without the
    // `rgPartialRead` marker this failure would fall to the closed default and
    // HOLD anyway — same outcome, but logged as "a way this build does not
    // classify", which tells the next reader nothing about a guard that fired
    // on purpose. Asserted so the branch has a red of its own.
    assert(said(/RG-12 \(b\)/),
      '…and the console line NAMES RG-12 (b), so the guard that fired is identifiable rather than filed under "unclassified"');
    assert(sb.get('cfbp_players') !== null,
      '…and the mirror is STILL PRESERVED: holding is about what the player is told, never about throwing their data away');
  }

  // ── (5) THE CLASS RULE (audit item 3): the DEFAULT BRANCH IS THE CLOSED ONE,
  //        pinned textually so a future edit cannot flip the polarity while the
  //        prose above it still claims an allow-list.
  const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
  const fn = src.slice(src.indexOf('function _classifyHydrateFailure(err)'), src.indexOf('function _fail(err, leagueId, reason)'));
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const returns = [...code.matchAll(/return '([a-z-]+)'/g)].map((m) => m[1]);
  assert(returns[returns.length - 1] === 'unclassified',
    `SEC-F1 class rule: the LAST return in the classifier — its default — is 'unclassified' (got ${JSON.stringify(returns[returns.length - 1])}), i.e. the CLOSED one`);
  assert(returns.filter((r) => r === 'network').length >= 3 && !code.trimEnd().endsWith("return 'network';"),
    'SEC-F1 class rule: …and ‘network’ is only ever reached by an explicit match, never by falling off the end');
  const failFn = src.slice(src.indexOf('function _fail(err, leagueId, reason)'), src.indexOf("emit('error', {"));
  assert(/kind === 'network'/.test(failFn) && /} else {[\s\S]*_setState\('HELD'/.test(failFn),
    "SEC-F1 class rule: _fail() serves ONLY on kind === 'network' and its else branch is HELD — the default is the closed state");
  assert(/allow-list of network failures; default HELD/i.test(src),
    'SEC-F1 class rule: …and the comment states the polarity in those exact words, on ONE line, so it cannot be half-read');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-PREF] RG-179 — a player preference change is a real patch, both ways…', async () => {
  // THE WRITE HALF of "it's not saving my color scheme preference when I close
  // the app" (Drew, 2026-09-19). It IS saving, and this is where that is proven
  // rather than assumed — boottest [25] owns the re-apply half.
  //
  // Three things could have swallowed it and none of them do:
  //   1. NOT_NULL_COLS lists `preferences`, and the PATCH rule drops a null for
  //      a NOT NULL column. A non-null preferences change must survive it.
  //   2. `preferences` is a nested JSON blob compared by `canonicalize()`, which
  //      is deep and key-order-insensitive — a change confined to `.theme` has
  //      to register as a change.
  //   3. `cfbp_players` is `ownRowsOnly`, so a plain member's own-row patch must
  //      pass `_mayOperateOnRow` (0002's `league_members_update` policy allows
  //      exactly this, and `league_members_guard` names `preferences` in its
  //      self-editable list).
  await hydrated({ who: 'player' });
  const players = sb.get('cfbp_players');
  const idx = players.findIndex((p) => p.playerId === 'p2');
  assert(idx >= 0 && JSON.stringify(players[idx].preferences) === '{}',
    'fixture: Kevin’s member row serves an EMPTY preferences blob — the shape a member has before he ever touched a control');

  // Exactly what storage.js `_setPlayerPref()` does (`:606-616`): copy the blob,
  // set one key, write the WHOLE array back through the seam.
  const write = (key, value) => {
    const all = sb.get('cfbp_players').slice();
    const i = all.findIndex((p) => p.playerId === 'p2');
    all[i] = { ...all[i], preferences: { ...(all[i].preferences || {}), [key]: value } };
    sb.set('cfbp_players', all);
  };

  write('theme', 'boilermaker');
  {
    const { plan, refusals, stale } = sb.planFlush();
    assert(!refusals.length && !stale.length,
      `[A-PREF] a member's own preference write is neither refused nor stale (${refusals.map((r) => r.message).join(' | ')})`);
    assert(plan.length === 1 && plan[0].op === 'patch' && plan[0].table === 'league_members' && plan[0].rowId === 'p2',
      `[A-PREF] it plans exactly ONE league_members patch, on his own row (${JSON.stringify(plan.map((p) => [p.op, p.table, p.rowId]))})`);
    assert(JSON.stringify(Object.keys(plan[0].changed)) === '["preferences"]',
      `[A-PREF] …carrying the preferences column and nothing else — NOT_NULL_COLS drops a NULL for a NOT NULL column, never a real value (${JSON.stringify(plan[0].changed)})`);
    assert(plan[0].changed.preferences.theme === 'boilermaker',
      '[A-PREF] …and the nested key the player actually changed is in it (canonicalize() is deep, so a change confined to .theme is still a change)');
  }
  await captureConsoleAsync(() => sb.flush());
  assert(ST.league_members.find((m) => m.id === 'p2').preferences.theme === 'boilermaker',
    '[A-PREF] the flush lands it on the member row — the server, not just the mirror');

  // The other three preferences that live in the same blob, one at a time, the
  // way a player actually sets them. A merge bug here would silently discard
  // whichever one he set first.
  write('tz', 'ET');
  await captureConsoleAsync(() => sb.flush());
  write('sectionOrder', { dashboard: ['standings', 'slate'] });
  await captureConsoleAsync(() => sb.flush());
  write('accent', '#7c3aed');
  await captureConsoleAsync(() => sb.flush());
  {
    const row2 = ST.league_members.find((m) => m.id === 'p2');
    assert(row2.preferences.theme === 'boilermaker' && row2.preferences.tz === 'ET'
      && row2.preferences.accent === '#7c3aed'
      && JSON.stringify(row2.preferences.sectionOrder) === '{"dashboard":["standings","slate"]}',
      `[A-PREF] all four coexist on the row — theme, timezone, dashboard column order and chat accent share ONE blob, so each write must merge rather than replace (${JSON.stringify(row2.preferences)})`);
  }

  // A REDUNDANT WRITE IS A NO-OP, AND THAT IS THE 2026-09-19 CORRECTION.
  //
  // This block used to assert the opposite — "a redundant write re-sends the SAME value" — and
  // said why in as many words: "`flush()` deliberately does not fold its own RETURNING back into
  // the base". It was not deliberate, it was RG-180 hole (2): the base advanced only on a hydrate,
  // so every write before the next one re-diffed against a pre-flush row. On a PATCH that was
  // merely extra bytes, which is why it read as harmless here; on an INSERT it was a 23505 and a
  // red "Nothing was saved" banner for a row that had saved, and on a DELETE a 42501. The base is
  // folded from the write's own RETURNING now, so the redundant write has nothing to send — and a
  // REAL change still does, which is the assertion that keeps this from passing vacuously.
  write('theme', 'boilermaker');
  {
    const again = sb.planFlush().plan;
    assert(again.length === 0,
      `[A-PREF] a redundant write plans NOTHING (${JSON.stringify(again.map((p) => p.changed))}) — the base advanced when the patch was acknowledged`);
  }
  write('theme', 'razorback');
  {
    const moved = sb.planFlush().plan;
    assert(moved.length === 1 && moved[0].changed.preferences.theme === 'razorback'
      && moved[0].changed.preferences.tz === 'ET',
      `[A-PREF] …and a REAL change still plans exactly one patch, carrying the merged blob (${JSON.stringify(moved.map((p) => p.changed))})`);
  }
  await captureConsoleAsync(() => sb.flush());
  write('theme', 'boilermaker');
  await captureConsoleAsync(() => sb.flush());

  // THE READ HALF: a fresh hydrate — i.e. closing the app and opening it again —
  // brings every one of them back on the player record.
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const reopened = sb.get('cfbp_players').find((p) => p.playerId === 'p2');
  assert(reopened.preferences.theme === 'boilermaker' && reopened.preferences.tz === 'ET'
    && reopened.preferences.accent === '#7c3aed',
    `[A-PREF] and a REOPEN reads them straight back off the member row (${JSON.stringify(reopened.preferences)}) — which is why RG-179 was never a storage defect`);
});

// ══════════════════════════════════════════════════════════════════════════
// RG-180 — THE THREE HOLES IN flush(), AND THEY INTERLEAVE
// ══════════════════════════════════════════════════════════════════════════
//
// The reviewer's BLOCK on 5c2aa38 (`pagehide` + `visibilitychange:hidden` -> sb.flush()) was one
// symptom of three: both DOM events fire on ONE backgrounding, and the 800ms debounce timer can
// land on top of them. Every section below drives TWO callers at once, because every one of these
// was invisible to a test that drove one caller at a time — which is how all three shipped.
//
// The fake grew a primary key for them (see `conflict()`): without `(league_id, id)` uniqueness
// answering 23505, hole (2) looks like a duplicate row in an array nobody reads, instead of the red
// banner six players actually get.
const tbPut = (weekMember, guess) => {
  const cur = { ...(sb.get('cfbp_tiebreaker_guesses') || {}) };
  cur[weekMember] = guess;
  sb.set('cfbp_tiebreaker_guesses', cur);
};
const epPut = (weekMember, guess) => {
  const cur = { ...(sb.get('cfbp_extra_point_guesses') || {}) };
  if (guess === null) delete cur[weekMember]; else cur[weekMember] = guess;
  sb.set('cfbp_extra_point_guesses', cur);
};
const bannersSince = (n) => bannerSeen.slice(n);

await section('\n[A-FLUSH1] hole 1 — two flushes in one tick are ONE run plus ONE coalesced follow-up, never two senders…', async () => {
  await hydrated({ who: 'commissioner' });
  // A brand-new GAME: an INSERT, because an insert is where the missing latch stops being extra
  // bytes and becomes a duplicate-key refusal. Cloned off a served row so every projected column
  // is the shape the projection really produces.
  const games = sb.get('cfbp_games').map((g) => ({ ...g }));
  games.push({ ...games.find((g) => g.gameId === 'g1'), gameId: 'g-new' });
  sb.set('cfbp_games', games);
  const mark = bannerSeen.length;
  // THE REVIEWER'S REPRODUCTION, VERBATIM: `const a = sb.flush(); const b = sb.flush();`
  // pagehide and visibilitychange:hidden both fire on one backgrounding.
  const a = sb.flush();
  const b = sb.flush();
  const [ra, rb] = await captureConsoleAsync(() => Promise.all([a, b]));

  const insertCalls = CLIENT._calls.inserts.filter((i) => i.table === 'games').length;
  assert(insertCalls === 1,
    `[A-FLUSH1] exactly ONE insert reaches the server across both callers (sent ${insertCalls})`);
  assert(ST.games.filter((g) => g.id === 'g-new').length === 1,
    '[A-FLUSH1] …and the row exists exactly once');
  assert(!bannersSince(mark).some((t) => /Nothing was saved/.test(t)),
    `[A-FLUSH1] no "Nothing was saved" banner for a write that SAVED (${JSON.stringify(bannersSince(mark))})`);
  assert(!sb._refusedKeysForTest().includes('cfbp_games'),
    `[A-FLUSH1] …and cfbp_games is not latched into _refusedKeys, which would block the key until a hydrate lands (${JSON.stringify(sb._refusedKeysForTest())})`);
  assert(!(rb && rb.refused && rb.refused.length),
    `[A-FLUSH1] the second caller is told the truth, not a refusal (${JSON.stringify(rb)})`);
  assert(((ra && ra.pushed) || 0) + ((rb && rb.pushed) || 0) === 1,
    `[A-FLUSH1] exactly one caller reports having pushed the key (a=${JSON.stringify(ra)}, b=${JSON.stringify(rb)})`);
  assert(sb._dirtyKeysForTest().length === 0,
    `[A-FLUSH1] and nothing is left pending (${JSON.stringify(sb._dirtyKeysForTest())})`);

  // THE COALESCE IS NOT A DROP. A caller that arrives mid-flight with a NEWER edit must still be
  // sent — one follow-up run, however many callers queue behind it.
  const mark2 = bannerSeen.length;
  tbPut('w1__p1', 61);
  const c = sb.flush();
  tbPut('w1__p1', 62);
  const d = sb.flush();
  const e = sb.flush();
  await captureConsoleAsync(() => Promise.all([c, d, e]));
  const tbRow = ST.tiebreaker_guesses.find((r) => r.id === 'tb_w1__p1');
  assert(tbRow && Number(tbRow.guess) === 62,
    `[A-FLUSH1] three overlapping callers land the NEWEST value (server holds ${tbRow && tbRow.guess}, expected 62)`);
  assert(!bannersSince(mark2).length,
    `[A-FLUSH1] …with no banner at all (${JSON.stringify(bannersSince(mark2))})`);
  assert(sb._dirtyKeysForTest().length === 0,
    `[A-FLUSH1] …and nothing left dirty (${JSON.stringify(sb._dirtyKeysForTest())})`);
});

await section('\n[A-FLUSH2] hole 2 — a successful write advances _baseRows, so the SECOND edit patches the row instead of re-inserting it…', async () => {
  await hydrated({ who: 'commissioner' });
  // `extra_point_guesses` is deliberately NOT one of the four tables in the Realtime publication
  // (0005_realtime.sql: messages, games, weeks, picks, league_kv), so nothing but a hydrate could
  // ever rebase it — and the rehydrate tick is minutes.
  epPut('w1__p1', 21);
  await captureConsoleAsync(() => sb.flush());
  const first = ST.extra_point_guesses.filter((r) => r.id === 'ep_w1__p1');
  assert(first.length === 1 && Number(first[0].guess) === 21,
    `[A-FLUSH2] fixture: the INSERT landed (${JSON.stringify(first.map((r) => r.guess))})`);

  // NO HYDRATE between the two edits. This is the live sequence: make a guess, change your mind.
  const mark = bannerSeen.length;
  epPut('w1__p1', 24);
  const plan = sb.planFlush().plan;
  assert(plan.length === 1 && plan[0].op === 'patch',
    `[A-FLUSH2] the second edit plans a PATCH, not a second INSERT (${JSON.stringify(plan.map((p) => [p.op, p.rowId]))})`);
  const r2 = await captureConsoleAsync(() => sb.flush());
  const after = ST.extra_point_guesses.filter((x) => x.id === 'ep_w1__p1');
  assert(after.length === 1 && Number(after[0].guess) === 24,
    `[A-FLUSH2] …and the edit is SAVED (server holds ${JSON.stringify(after.map((x) => x.guess))})`);
  assert(!bannersSince(mark).some((t) => /Nothing was saved/.test(t)),
    `[A-FLUSH2] …with no false "Nothing was saved" banner (${JSON.stringify(bannersSince(mark))})`);
  assert(!sb._refusedKeysForTest().length && !sb._dirtyKeysForTest().length,
    `[A-FLUSH2] …and nothing refused or left pending (refused ${JSON.stringify(sb._refusedKeysForTest())}, dirty ${JSON.stringify(sb._dirtyKeysForTest())}, result ${JSON.stringify(r2)})`);

  // THE DELETE HALF: the same staleness with the opposite sign — the row is gone from the server
  // and still in the base, so the next save of that key re-sends the DELETE, matches no row, and
  // raises the "policy matched no row" refusal about a row that was deleted successfully.
  const mark2 = bannerSeen.length;
  epPut('w1__p1', null);
  await captureConsoleAsync(() => sb.flush());
  assert(!ST.extra_point_guesses.some((x) => x.id === 'ep_w1__p1'),
    '[A-FLUSH2] fixture: the DELETE landed');
  sb.set('cfbp_extra_point_guesses', { ...(sb.get('cfbp_extra_point_guesses') || {}) });   // a plain re-save
  const plan2 = sb.planFlush().plan;
  assert(!plan2.some((p) => p.op === 'delete'),
    `[A-FLUSH2] a later save does NOT re-send the delete (${JSON.stringify(plan2.map((p) => [p.op, p.rowId]))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(!bannersSince(mark2).some((t) => /matched no row|Nothing was saved/.test(t)),
    `[A-FLUSH2] …so no phantom 42501 banner (${JSON.stringify(bannersSince(mark2))})`);
  // THE OTHER SIDE OF ADVANCING THE BASE, and it has to be asserted or the fix trades a false
  // banner for a stuck queue: a re-save that diffs to NOTHING produces no operation, so nothing
  // ever marked the key clean. A key stuck dirty reads as a pending write in the badge and — worse
  // — `_persistSnapshot()` refuses to run while anything is dirty, so the device would stop
  // updating the snapshot a warm open reads.
  assert(!sb._dirtyKeysForTest().length && sb.getStatus().pendingWrites === 0,
    `[A-FLUSH2] …and a save with nothing to send leaves the queue EMPTY (${JSON.stringify(sb._dirtyKeysForTest())})`);

  // IDEMPOTENT AGAINST THE REALTIME ECHO. The write folds the server's own returned row into the
  // base; the Realtime event for that same write then arrives and folds it again. The second fold
  // must change nothing — same keying (row.id), same shape.
  const mark3 = bannerSeen.length;
  sb.subscribeRealtime();
  const ch = CLIENT._channels[0];
  const picks = sb.get('cfbp_picks').map((p) => ({ ...p }));
  const mine = picks.find((p) => p.playerId === 'p1' && p.weekId === 'w1');
  mine.selectedTeam = 'Kansas';
  sb.set('cfbp_picks', picks);
  await captureConsoleAsync(() => sb.flush());
  const serverPick = ST.picks.find((p) => p.id === mine.pickId);
  assert(serverPick && serverPick.selected_team === 'Kansas', '[A-FLUSH2] fixture: the pick patch landed');
  const h = ch && ch._handlers.find((x) => x.cfg && x.cfg.table === 'picks');
  assert(!!h, '[A-FLUSH2] fixture: the picks Realtime handler is registered');
  captureConsole(() => h.cb({ eventType: 'UPDATE', new: { ...serverPick }, old: null }));
  const plan3 = sb.planFlush().plan;
  assert(plan3.length === 0,
    `[A-FLUSH2] the Realtime echo of our own write leaves NOTHING to re-send (${JSON.stringify(plan3.map((p) => [p.op, p.key, p.rowId]))})`);
  assert(!bannersSince(mark3).length,
    `[A-FLUSH2] …and says nothing to the player about it (${JSON.stringify(bannersSince(mark3))})`);
  sb.unsubscribeRealtime();
});

await section('\n[A-FLUSH3] hole 3 — an edit made WHILE a flush is in flight stays dirty and goes out…', async () => {
  await hydrated({ who: 'commissioner' });
  // A row the hydrate already served, so this section depends on nothing hole (2) fixes.
  tbPut('w1__p1', 50);
  const p = sb.flush();                      // the plan is built synchronously, here
  tbPut('w1__p1', 51);                       // …and the player changes his mind during the await
  const r1 = await captureConsoleAsync(() => p);
  // Read the DECISION, not the clock. The follow-up run starts the moment this one settles, so
  // "is the key still dirty right now" is a race with the fix working; the run's own line is
  // emitted synchronously at the point the decision is made.
  assert(said(/changed while the flush was in flight/),
    `[A-FLUSH3] the run KEPT the mid-flight edit dirty instead of deleting the key it had planned (result ${JSON.stringify(r1)})`);
  assert(JSON.stringify(sb.get('cfbp_tiebreaker_guesses')['w1__p1']) === '51',
    '[A-FLUSH3] fixture: and the newer value is in the mirror, which is what makes losing it silent');
  await captureConsoleAsync(() => sb.flush());
  const sent = CLIENT._calls.updates.filter((u) => u.table === 'tiebreaker_guesses').map((u) => u.patch && u.patch.guess);
  const end = ST.tiebreaker_guesses.find((x) => x.id === 'tb_w1__p1');
  assert(end && Number(end.guess) === 51,
    `[A-FLUSH3] …and it reaches the server with NO hydrate in between (${end && end.guess})`);
  assert(sent.length === 2 && sent[0] === 50 && sent[1] === 51,
    `[A-FLUSH3] …in exactly ONE follow-up write carrying the NEW value (sent ${JSON.stringify(sent)})`);
  assert(!sb._dirtyKeysForTest().length,
    `[A-FLUSH3] …leaving nothing pending (${JSON.stringify(sb._dirtyKeysForTest())})`);
});

await section('\n[A-FLUSH4] a write that never reached a server is a NETWORK hold, not a server refusal…', async () => {
  // AD-06 cuts both ways. A refusal must be loud; a dropped fetch must NOT be dressed as one —
  // "The server refused to save cfbp_picks… Nothing was saved" about a request no server ever saw
  // is the BUG-A misdirection class, and `_refusedKeys` would then block the key until a hydrate.
  await hydrated({ who: 'commissioner' });
  const good = CLIENT;
  for (const [label, opt] of [
    ['a thrown fetch (the SDK lets the rejection propagate)', { throwWrites: () => new TypeError('Failed to fetch') }],
    ['an error OBJECT carrying the fetch message with an empty code', { failWrites: { code: '', message: 'TypeError: Failed to fetch' } }],
    ['an aborted request', { throwWrites: () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) }],
  ]) {
    tbPut('w1__p1', 60);
    CLIENT = makeClient(ST, SESSIONS.commissioner, opt);
    const mark = bannerSeen.length;
    const res = await captureConsoleAsync(() => sb.flush());
    assert(!bannersSince(mark).some((t) => /Nothing was saved|server refused/i.test(t)),
      `[A-FLUSH4] ${label}: no server-refusal banner (${JSON.stringify(bannersSince(mark))})`);
    assert(!sb._refusedKeysForTest().length,
      `[A-FLUSH4] ${label}: …and the key is NOT latched refused (${JSON.stringify(sb._refusedKeysForTest())})`);
    assert(sb._dirtyKeysForTest().includes('cfbp_tiebreaker_guesses'),
      `[A-FLUSH4] ${label}: …the write is HELD for retry (${JSON.stringify(sb._dirtyKeysForTest())}, result ${JSON.stringify(res)})`);
    assert(statuses.some(([s]) => s === 'offline'),
      `[A-FLUSH4] ${label}: …and the player is told OFFLINE, not refused (${JSON.stringify(statuses.slice(-3))})`);
    statuses.length = 0;
  }
  // THE SHAPE THE RENDERER READS. `js/app.js:onSupabaseDataStatus()` decides what to put on screen
  // from NAMED FIELDS of this detail — `heldOffline` and `banner` — and boottest [26] drives that
  // function with exactly this shape. Asserting the fields here is what stops the two suites
  // agreeing with each other about a message the adapter does not actually send (reviewer N1).
  {
    const off = detailSeen.filter(([s]) => s === 'offline').pop();
    assert(!!off && Array.isArray(off[1].heldOffline) && off[1].heldOffline.length === 1,
      `[A-FLUSH4] the 'offline' status carries heldOffline — the KEYS that did not go (${JSON.stringify(off && off[1])})`);
    assert(!!off && typeof off[1].banner === 'string' && /still to save/.test(off[1].banner)
      && typeof off[1].pendingWrites === 'number' && off[1].pendingWrites > 0,
      `[A-FLUSH4] …and the banner copy plus the pending count the badge reads (${JSON.stringify(off && off[1])})`);
  }

  // WHAT THE PLAYER SEES ON RETURN: the held write goes out on the next flush, unchanged.
  CLIENT = good;
  await captureConsoleAsync(() => sb.flush());
  const row = ST.tiebreaker_guesses.find((x) => x.id === 'tb_w1__p1');
  assert(row && Number(row.guess) === 60,
    `[A-FLUSH4] the held write lands when the network comes back (${row && row.guess})`);

  // THE CLOSED DEFAULT IS INTACT: a real refusal is still loud. This is the assertion that stops
  // the allow-list being widened into "every failure is the network".
  tbPut('w1__p1', 64);
  CLIENT = makeClient(ST, SESSIONS.commissioner, { failWrites: { code: '42501', message: 'permission denied for table tiebreaker_guesses' } });
  const mark = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(bannersSince(mark).some((t) => /permission denied/.test(t) && /Nothing was saved/.test(t)),
    `[A-FLUSH4] a 42501 is STILL a loud refusal, in the server's own words (${JSON.stringify(bannersSince(mark))})`);
  assert(sb._refusedKeysForTest().includes('cfbp_tiebreaker_guesses'),
    '[A-FLUSH4] …and still latches the key until a hydrate lands (§5.2 item 3)');
  CLIENT = good;

  // ══ SECURITY F1 (2026-09-19) — THE WRITE PATH HAS TO CARRY THE HTTP STATUS ══
  //
  // `_select()` copies `res.status` onto the error it throws, which is what lets the read-side rule
  // "any HTTP status is an ANSWER" fire (supabase-backend.js:1091-1097). The WRITE path handed
  // `res.error` to `_writeFailure()` raw — and supabase-js puts the status on the RESPONSE, never on
  // the error. So the single most common real outage shape, a GATEWAY answer with an empty PostgREST
  // code, matched the network allow-list on its MESSAGE alone and was HELD.
  //
  // Why that is a security finding and not a cosmetic one: a 5xx raised AFTER the statement
  // committed (a proxy that gave up on a slow response) is held and RETRIED, the retry re-INSERTs a
  // row the server already has, and the 23505 that comes back is the false "Nothing was saved"
  // refusal RG-180 had just removed. A held write also never reaches the device snapshot
  // (`_persistSnapshot()` refuses while dirty), so an iOS PWA kill loses it silently.
  //
  // The four shapes below are one allow-list decision each: STATUS PRESENT ⇒ answered ⇒ loud;
  // no response at all ⇒ held; a PostgREST code ⇒ loud. AD-59's closed default, from the write side.
  //
  // ══ AMENDED 2026-09-20 (RG-202) — *WHEN* LOUD, NOT *WHETHER* ══════════════════════════════════
  //
  // These three assertions used to read the FIRST attempt and require the red banner there. They
  // were right about the classification and wrong about the timing, and the cost landed on Drew:
  // a red "Cross-device sync is OFF on this device" every time a request hiccuped, resolved every
  // time by one tap of Retry. A banner that is wrong most of the time stops being read, which is
  // the failure mode AD-06 exists to prevent.
  //
  // WHAT IS UNCHANGED, and it is the whole of the security finding: an ANSWER is still never an
  // OUTAGE. None of these three may ever emit 'offline', reach OFFLINE-READONLY or serve a
  // snapshot — `_isWriteNetworkFailure()` is untouched and still refuses all three. Each is
  // asserted below across the WHOLE lifecycle instead of at one instant: quiet while the bounded
  // schedule runs, LOUD and latched the moment it is exhausted, never 'offline' at any point, and
  // never clean until a server confirmed the write.
  for (const [label, opt, expect] of [
    ['a gateway timeout: empty code, a message that READS like a network timeout, HTTP 504',
      { failWrites: { code: '', message: 'upstream request timeout' }, failWriteStatus: 504 }, 'loud'],
    ['a 502 from the edge, with the body it did not author',
      { failWrites: { code: '', message: 'Bad Gateway' }, failWriteStatus: 502 }, 'loud'],
    ['a duplicate key — the shape a blind retry of a committed write produces',
      { failWrites: { code: '23505', message: 'duplicate key value violates unique constraint "tiebreaker_guesses_pkey"' }, failWriteStatus: 409 }, 'loud'],
    ['a thrown fetch TypeError — no response exists, so there is no status to carry',
      { throwWrites: () => new TypeError('Failed to fetch') }, 'held'],
  ]) {
    const tf = makeFakeTimers();
    await hydrated({ who: 'commissioner', timers: tf });   // a clean latch + a clean queue per shape
    tbPut('w1__p1', 66);
    CLIENT = makeClient(ST, SESSIONS.commissioner, opt);
    const m = bannerSeen.length;
    statuses.length = 0;
    const res = await captureConsoleAsync(() => sb.flush());
    if (expect === 'loud') {
      assert(!bannersSince(m).some((t) => /Nothing was saved/.test(t)) && !sb._refusedKeysForTest().length,
        `[A-FLUSH4] ${label}: the FIRST attempt is quiet — a hiccup is not a breakage `
        + `(banner ${JSON.stringify(bannersSince(m))}, refusedKeys ${JSON.stringify(sb._refusedKeysForTest())}, result ${JSON.stringify(res)})`);
      // Exhaust the bounded schedule against the same failing client.
      let guard = 0;
      while (tf.count() && guard++ < 6) await captureConsoleAsync(() => tf.runNext());
      assert(bannersSince(m).some((t) => /Nothing was saved/.test(t))
        && sb._refusedKeysForTest().includes('cfbp_tiebreaker_guesses'),
        `[A-FLUSH4] ${label}: …and once the retries are exhausted the server ANSWERED, so it is a LOUD refusal — not a silent hold `
        + `(banner ${JSON.stringify(bannersSince(m))}, refusedKeys ${JSON.stringify(sb._refusedKeysForTest())})`);
      assert(sb._dirtyKeysForTest().includes('cfbp_tiebreaker_guesses'),
        `[A-FLUSH4] ${label}: …with the write still queued: no retry path ever drops or cleans a change (${JSON.stringify(sb._dirtyKeysForTest())})`);
      assert(!statuses.some(([s]) => s === 'offline'),
        `[A-FLUSH4] ${label}: …and the player is never told OFFLINE about a device that is demonstrably on the network, at ANY point in the schedule (${JSON.stringify(statuses.map(([s]) => s))})`);
    } else {
      const loud = bannersSince(m).some((t) => /Nothing was saved/.test(t));
      const latched = sb._refusedKeysForTest().includes('cfbp_tiebreaker_guesses');
      assert(!loud && !latched && sb._dirtyKeysForTest().includes('cfbp_tiebreaker_guesses'),
        `[A-FLUSH4] ${label}: …stays HELD, unlatched and queued (banner ${JSON.stringify(bannersSince(m))}, dirty ${JSON.stringify(sb._dirtyKeysForTest())})`);
      assert(statuses.some(([s]) => s === 'offline'),
        `[A-FLUSH4] ${label}: …and says offline (${JSON.stringify(statuses.map(([s]) => s))})`);
      assert(tf.count() === 0,
        `[A-FLUSH4] ${label}: …and arms no write-retry timer: the network hold has its own recovery (the online/visible re-hydrate), and two schedules for one queue is a storm (${JSON.stringify(tf.delays())})`);
    }
  }

  // THE RPC LEG OF THE SAME RULE. `patch_kv` / `lock_week` / `transition_week` / `finalize_week` go
  // through `client.rpc()`, a different call site with the same defect — and a fix applied to only
  // the table writes would leave every settings save classifiable as offline by its message.
  const tRpc = makeFakeTimers();
  await hydrated({ who: 'commissioner', timers: tRpc });
  sb.set('cfbp_settings', { ...(sb.get('cfbp_settings') || {}), autoRefreshInterval: 90 });
  CLIENT = makeClient(ST, SESSIONS.commissioner, {
    failWrites: { code: '', message: 'upstream request timeout' }, failWriteStatus: 504,
  });
  const mk = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  // RG-202 — same amendment as the table-write loop above: the RPC leg is retried on the same
  // bounded schedule and is LOUD once it is exhausted. The classification is what this assertion
  // guards, and it is unchanged: a 504 on an RPC is an ANSWER, never an outage.
  assert(!bannersSince(mk).some((t) => /Nothing was saved/.test(t)) && tRpc.count() === 1,
    `[A-FLUSH4] an RPC write that comes back with HTTP 504 is retried, quietly, first (${JSON.stringify(bannersSince(mk))}, ${JSON.stringify(tRpc.delays())})`);
  let rpcGuard = 0;
  while (tRpc.count() && rpcGuard++ < 6) await captureConsoleAsync(() => tRpc.runNext());
  assert(bannersSince(mk).some((t) => /Nothing was saved/.test(t)),
    `[A-FLUSH4] …and an RPC write that comes back with HTTP 504 is a LOUD refusal too once the retries are exhausted (${JSON.stringify(bannersSince(mk))})`);

  // STRUCTURAL, because the finalize leg is a third call site and a behavioural test for it needs a
  // live week: EVERY `_writeFailure(` call passes the response's status, not just the error.
  const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
  const calls = src.match(/_writeFailure\(res\.error[^\n]*/g) || [];
  assert(calls.length >= 3 && calls.every((c) => /res\.status/.test(c)),
    `[A-FLUSH4] every _writeFailure() call site carries the RESPONSE's status (found ${calls.length}: ${JSON.stringify(calls)}) [structural]`);
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FLUSH5] SECURITY F2 — AN IN-FLIGHT FLUSH KEEPS WRITING AFTER THE MIRROR IS DROPPED
// ══════════════════════════════════════════════════════════════════════════
//
// `_runFlush()` built its plan against ONE mirror and then awaited each operation in turn with no
// re-check between them. `_opMoved()` exists and is applied to every asynchronous READ (hydrate,
// week_submission_status, Realtime) — the write loop was the one path that never asked.
//
// WHAT THAT IS, CONCRETELY. Two writes are queued. `flush()` starts. During operation #1 the device
// is handed over — `dropMirror('device-handover')` clears the queue, the mirror and the tag, and
// tells the player "Nothing was sent." Operation #2 is then sent ANYWAY, on the one shared client,
// which by then carries the NEXT account's JWT. The write lands (or is refused) under an identity
// that never made it, in a league that account may not even belong to, and `flush()` reports
// `pushed: 2` about a queue it no longer has. The banner and the wire disagree, and the banner is
// the thing six people read.
//
// The rule this pins: the identity/league/switch token is checked at the TOP OF EVERY ITERATION and
// before the coalesced follow-up starts. Remaining operations are REPORTED, never sent, and the
// result says what was and was not sent. §3.3's three layers cover the PLAN; this is the same rule
// applied to the EXECUTION, which is where the awaits are.
await section('\n[A-FLUSH5] SEC-F2 — an in-flight flush STOPS the moment the mirror is dropped; nothing is sent under the next identity…', async () => {
  // ── (a) ROWS: two operations on one key, dropped during the first ─────────
  {
    await hydrated({ who: 'commissioner' });
    let dropped = 0;
    CLIENT = makeClient(ST, SESSIONS.commissioner, {
      onWrite: () => { if (!dropped++) captureConsole(() => sb.dropMirror('device-handover')); },
    });
    const games = sb.get('cfbp_games').map((g) => ({ ...g }));
    games.push({ ...games.find((g) => g.gameId === 'g1'), gameId: 'g-new' });     // op 1: INSERT
    games.find((g) => g.gameId === 'g1').multiplier = 3;                          // op 2: PATCH
    sb.set('cfbp_games', games);
    const planned = sb.planFlush().plan;
    assert(planned.length === 2 && planned[0].op === 'insert' && planned[1].op === 'patch',
      `[A-FLUSH5] fixture: the plan really is two operations (${JSON.stringify(planned.map((p) => p.op))})`);
    const mark = bannerSeen.length;
    const res = await captureConsoleAsync(() => sb.flush());

    assert(CLIENT._calls.updates.filter((u) => u.table === 'games').length === 0,
      `[A-FLUSH5] (rows) ZERO writes reach the server after the drop (${JSON.stringify(CLIENT._calls.updates.map((u) => u.table))})`);
    assert((ST.games.find((g) => g.id === 'g1') || {}).multiplier === 1,
      '[A-FLUSH5] (rows) …so the row the second operation named is untouched on the server');
    assert(res && res.abandoned === true && (res.notSent || []).includes('cfbp_games') && res.pushed === 1,
      `[A-FLUSH5] (rows) …and the result is TRUTHFUL about what was and was not sent (${JSON.stringify(res)})`);
    assert(bannersSince(mark).length > 0 && !bannersSince(mark).some((t) => /Nothing was sent/.test(t)),
      `[A-FLUSH5] (rows) …and the banner does not claim "Nothing was sent" when an operation had already gone (${JSON.stringify(bannersSince(mark))})`);
    assert(!sb._dirtyKeysForTest().length && !sb._refusedKeysForTest().length,
      `[A-FLUSH5] (rows) …and the abandoned run writes nothing back into the dropped queue (dirty ${JSON.stringify(sb._dirtyKeysForTest())}, refused ${JSON.stringify(sb._refusedKeysForTest())})`);
  }

  // ── (b) KV, dropped by a LEAGUE SWITCH: the shared client is about to be a different league's ──
  {
    await hydrated({ who: 'commissioner' });
    let n = 0;
    CLIENT = makeClient(ST, SESSIONS.commissioner, {
      onWrite: (name) => { if (name === 'patch_kv' && !n++) captureConsole(() => sb.beginSwitch(LEAGUE_A, LEAGUE_B)); },
    });
    sb.set('cfbp_nicknames', { ...(sb.get('cfbp_nicknames') || {}), p3: 'Kobe' });
    sb.set('cfbp_lock_overrides', { g1: 'unlocked' });
    const kvOps = sb.planFlush().plan.filter((p) => p.name === 'patch_kv');
    assert(kvOps.length === 2, `[A-FLUSH5] fixture: two kv operations are queued (${kvOps.length})`);
    const res = await captureConsoleAsync(() => sb.flush());
    const sent = CLIENT._calls.rpc.filter((r) => r.name === 'patch_kv');
    assert(sent.length === 1,
      `[A-FLUSH5] (kv) exactly ONE patch_kv reached the server — the second was abandoned, not sent into league B (${JSON.stringify(sent.map((r) => r.args && r.args.p_key))})`);
    assert(!(ST.league_kv.find((r) => r.league_id === LEAGUE_A && r.key === 'lock_overrides') || {}).value?.g1,
      '[A-FLUSH5] (kv) …and the second key is untouched on the server');
    assert(res && res.abandoned === true,
      `[A-FLUSH5] (kv) …and the caller is told the run was abandoned (${JSON.stringify(res)})`);
  }

  // ── (c) a TRANSITION RPC behind a row operation, dropped by SIGN-OUT ──────
  //   The composite ordering puts the games patch first and the week transition second (§2.3), so a
  //   sign-out during the patch is exactly the window in which a week could be moved for a league
  //   this device has just stopped belonging to.
  {
    await hydrated({ who: 'commissioner' });
    let n = 0;
    CLIENT = makeClient(ST, SESSIONS.commissioner, {
      onWrite: () => { if (!n++) captureConsole(() => sb.dropMirror('sign-out')); },
    });
    const games = sb.get('cfbp_games').map((g) => ({ ...g }));
    games.find((g) => g.gameId === 'g1').multiplier = 4;
    sb.set('cfbp_games', games);
    const weeks = sb.get('cfbp_weeks').map((w) => ({ ...w }));
    weeks.find((w) => w.weekId === 'w1').status = 'draft';
    sb.set('cfbp_weeks', weeks);
    const plan = sb.planFlush().plan;
    assert(plan.length === 2 && plan[0].kind === 'rows' && plan[1].name === 'transition_week',
      `[A-FLUSH5] fixture: the plan is [games patch, transition_week] (${JSON.stringify(plan.map((p) => p.name || p.op))})`);
    await captureConsoleAsync(() => sb.flush());
    assert(!CLIENT._calls.rpc.some((r) => r.name === 'transition_week'),
      `[A-FLUSH5] (rpc) the transition never fires after the sign-out (${JSON.stringify(CLIENT._calls.rpc.map((r) => r.name))})`);
    assert((ST.weeks.find((w) => w.id === 'w1') || {}).status === 'open',
      '[A-FLUSH5] (rpc) …and the week is exactly where the commissioner left it on the server');
  }

  // ── (d) THE COALESCED FOLLOW-UP IS GATED BY THE SAME TOKEN ────────────────
  //   `flush()`'s one queue slot starts a REAL run when the current one settles. A drop during the
  //   first run must not be followed by a second run that sends the (now foreign) queue.
  {
    await hydrated({ who: 'commissioner' });
    let n = 0;
    CLIENT = makeClient(ST, SESSIONS.commissioner, {
      onWrite: () => { if (!n++) captureConsole(() => sb.dropMirror('device-handover')); },
    });
    tbPut('w1__p1', 77);
    const a = sb.flush();
    const b = sb.flush();                    // queues the single follow-up
    await captureConsoleAsync(() => Promise.all([a, b]));
    await new Promise((r) => setTimeout(r, 0));
    const after = ST.tiebreaker_guesses.find((x) => x.id === 'tb_w1__p1');
    assert(CLIENT._calls.updates.filter((u) => u.table === 'tiebreaker_guesses').length <= 1,
      `[A-FLUSH5] (follow-up) the coalesced run does not re-send a dropped queue (${CLIENT._calls.updates.length} writes, guess ${after && after.guess})`);
    assert(!sb._dirtyKeysForTest().length,
      `[A-FLUSH5] (follow-up) …and nothing is left queued under the dropped mirror (${JSON.stringify(sb._dirtyKeysForTest())})`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FLUSH6] REVIEWER N2 — A HYDRATE THAT LANDS BETWEEN A WRITE AND ITS BASE FOLD
// ══════════════════════════════════════════════════════════════════════════
//
// THE NOTE THIS SECTION EXISTS TO SETTLE. Reviewer N2 reads: `_foldWriteIntoBase()` guards
// `leagueId` but not `_hydrateSeq`, so a hydrate landing mid-flight replaces `_baseRows` and the
// late fold can "re-add a row the fresher hydrate says is gone", whose next diff plans a DELETE
// matching no row — a false 42501. The prescribed fix was to capture `_hydrateSeq` at plan time and
// SKIP the fold if it moved.
//
// WHAT THE INTERLEAVING ACTUALLY DOES, staged below rather than argued: when a hydrate lands while
// a key's write is in flight, that key is STILL DIRTY (`_runFlush()` clears sent keys only after
// the loop), so `hydrate()`'s rebase re-grafts the device's own value back over the fresh
// projection (`supabase-backend.js:894-904`). The mirror therefore KEEPS the written row, and the
// fold is what keeps `_baseRows` in agreement with it. Skipping the fold leaves base WITHOUT a row
// the mirror HAS — which plans a second INSERT and earns the 23505 that RG-180 hole 2 was opened
// to remove. The direction of the defect is the opposite of the one the note describes, and it is
// the direction that was already reported live.
//
// The second half stages the note's own premise — another device deletes the row between our write
// and the hydrate's read — and shows where it really ends: the write itself matches no row and is
// refused, so no fold happens at all.
//
// Either way this section is the guard: it pins what the base must look like after a mid-flight
// hydrate, so a future change to the fold (in either direction) has to answer to it.
await section('\n[A-FLUSH6] N2 — a hydrate that lands behind an in-flight write leaves NOTHING to re-send…', async () => {
  // ── (a) the ordinary order: the hydrate reads a server that does not yet hold our write ──
  await hydrated({ who: 'commissioner' });
  let release;
  const gate = new Promise((r) => { release = r; });
  const seqBefore = sb._hydrateSeqForTest();
  CLIENT = makeClient(ST, SESSIONS.commissioner, { delayWrites: () => gate });
  epPut('w1__p1', 21);                                   // an INSERT — the shape that earns a 23505
  const p = sb.flush();                                  // parked: the request has not reached the server
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  assert(sb._hydrateSeqForTest() > seqBefore,
    '[A-FLUSH6] fixture: a hydrate really did land while the write was in flight (_baseRows was replaced)');
  release();
  await captureConsoleAsync(() => p);
  assert(ST.extra_point_guesses.filter((r) => r.id === 'ep_w1__p1').length === 1,
    `[A-FLUSH6] fixture: the write landed exactly once (${JSON.stringify(ST.extra_point_guesses.map((r) => r.id))})`);
  assert(Number((sb.get('cfbp_extra_point_guesses') || {})['w1__p1']) === 21,
    '[A-FLUSH6] fixture: and the rebase kept the device’s own value in the mirror (the graft, :894-904)');

  const mark = bannerSeen.length;
  epPut('w1__p1', 21);                                   // a plain re-save: the diff decides everything
  const plan = sb.planFlush().plan;
  assert(plan.length === 0,
    `[A-FLUSH6] the post-hydrate base and the mirror AGREE — nothing is re-sent (${JSON.stringify(plan.map((o) => [o.op, o.rowId]))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(!bannersSince(mark).some((t) => /Nothing was saved|matched no row|duplicate key/.test(t)),
    `[A-FLUSH6] …and the player is told nothing, because nothing went wrong (${JSON.stringify(bannersSince(mark))})`);
  assert(ST.extra_point_guesses.filter((r) => r.id === 'ep_w1__p1').length === 1,
    '[A-FLUSH6] …and the row still exists exactly once on the server');

  // ── (b) the note's own premise: another device DELETES the row behind our write ──
  {
    await hydrated({ who: 'commissioner' });
    epPut('w1__p1', 30);
    await captureConsoleAsync(() => sb.flush());         // the row now exists on the server and in base
    let go;
    const gate2 = new Promise((r) => { go = r; });
    CLIENT = makeClient(ST, SESSIONS.commissioner, { delayWrites: () => gate2 });
    epPut('w1__p1', 31);                                 // a PATCH this time
    const q = sb.flush();
    ST.extra_point_guesses = ST.extra_point_guesses.filter((r) => r.id !== 'ep_w1__p1');   // another device
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    const m2 = bannerSeen.length;
    go();
    const res = await captureConsoleAsync(() => q);
    assert(!ST.extra_point_guesses.some((r) => r.id === 'ep_w1__p1'),
      '[A-FLUSH6] (b) fixture: the row really is gone from the server');
    assert((res && res.refused && res.refused.length) || bannersSince(m2).some((t) => /matched no row/.test(t)),
      `[A-FLUSH6] (b) a write whose row vanished under it is REFUSED, loudly — so there is no returned row to fold anywhere (${JSON.stringify(res)}, ${JSON.stringify(bannersSince(m2))})`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FLUSH7] REVIEWER N3 — A CONTACT PATCH RE-SENDS ITSELF ON EVERY FLUSH
// ══════════════════════════════════════════════════════════════════════════
//
// `SELECT_COLS.league_members` omits email/phone/phone_verified on purpose (0007 made the SELECT
// grant a column list; the values come back only from `get_member_contacts()`). The write path uses
// that SAME list as its `RETURNING`, which is correct — a bare `.select()` is refused outright on
// that table. But it means an ACKNOWLEDGED contact write comes back WITHOUT the column it wrote, so
// `_foldWriteIntoBase()` cannot advance the base for it: the next diff sees the mirror's phone
// against a base that has none, plans the same patch again, and does so on EVERY flush until a
// hydrate lands. A phone number on the wire once is a save; on the wire every eight seconds it is a
// pattern of chatter about the one column 0007 exists to keep quiet.
//
// The fold merges the SENT contact columns back into the IN-MEMORY base — and nothing else:
//   • `_baseRows` is never persisted (`_persistSnapshot()` writes the projected mirror only), which
//     the last assertion here proves by reading the snapshot rather than by asserting the intent;
//   • it runs only for a caller who READ those contacts this hydrate — the same evidence §2.4
//     rule 1 requires before the column may be written at all.
await section('\n[A-FLUSH7] N3 — an acknowledged contact patch converges instead of re-sending itself…', async () => {
  await hydrated({ who: 'commissioner' });
  const players = sb.get('cfbp_players').map((p) => ({ ...p }));
  const kevin = players.find((p) => p.playerId === 'p2');
  assert(!!kevin, '[A-FLUSH7] fixture: the commissioner can see every member');
  kevin.phone = '+15550009999';
  sb.set('cfbp_players', players);
  const first = sb.planFlush().plan.filter((o) => o.op === 'patch' && o.rowId === 'p2');
  assert(first.length === 1 && first[0].changed.phone === '+15550009999',
    `[A-FLUSH7] fixture: the contact write rule lets the commissioner's patch through (${JSON.stringify(first.map((o) => o.changed))})`);
  const mark = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert((ST.league_members.find((m) => m.id === 'p2') || {}).phone === '+15550009999',
    '[A-FLUSH7] fixture: …and the server took it');
  assert(!bannersSince(mark).length, `[A-FLUSH7] fixture: …quietly (${JSON.stringify(bannersSince(mark))})`);

  // THE FINDING: a re-save with nothing new in it must plan nothing.
  const before = CLIENT._calls.updates.filter((u) => u.table === 'league_members').length;
  sb.set('cfbp_players', sb.get('cfbp_players').map((p) => ({ ...p })));
  const again = sb.planFlush().plan;
  assert(again.length === 0,
    `[A-FLUSH7] the acknowledged contact column is folded into the base, so the next flush plans NOTHING (${JSON.stringify(again.map((o) => [o.op, o.rowId, Object.keys(o.changed || {})]))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(CLIENT._calls.updates.filter((u) => u.table === 'league_members').length === before,
    '[A-FLUSH7] …and no second patch reaches the wire carrying a phone number');
  assert(!sb._dirtyKeysForTest().length,
    `[A-FLUSH7] …and the key does not get stuck dirty either (${JSON.stringify(sb._dirtyKeysForTest())})`);

  // THE FOLD MOVES THE EVIDENCE WITH IT, and this is the assertion that forces it to. §2.4 rule 1
  // drops a contact column whose value EQUALS the `get_member_contacts()` entry ("the server
  // already has it"). Advance the base without advancing that entry and a REVERT to the previously
  // read number is dropped in silence: the base says 1111, the diff emits the original, the rule
  // compares it to a stale entry that still reads the original, and deletes it. The commissioner
  // watches a phone number change back and stay changed on his screen only.
  {
    const own = (n) => {
      const all = sb.get('cfbp_players').map((p) => ({ ...p }));
      all.find((p) => p.playerId === 'p1').phone = n;
      sb.set('cfbp_players', all);
    };
    own('+15550001111');
    await captureConsoleAsync(() => sb.flush());
    assert((ST.league_members.find((m) => m.id === 'p1') || {}).phone === '+15550001111',
      '[A-FLUSH7] fixture: the commissioner changes his own number');
    own('+15550000001');                                  // …and changes his mind, back to the read value
    const revert = sb.planFlush().plan;
    assert(revert.length === 1 && revert[0].changed.phone === '+15550000001',
      `[A-FLUSH7] a REVERT to the previously-read number is still sent — the contacts evidence moved with the base (${JSON.stringify(revert.map((o) => o.changed))})`);
    await captureConsoleAsync(() => sb.flush());
    assert((ST.league_members.find((m) => m.id === 'p1') || {}).phone === '+15550000001',
      '[A-FLUSH7] …and the server holds the reverted value');
  }

  // THE SNAPSHOT IS THE PROJECTED MIRROR, NOT THE BASE. Security's adjacent concern on the insert
  // fallback: rows the planner SENT are folded into `_baseRows`, and for `league_members` those
  // rows carry contact columns. `_persistSnapshot()` must not be able to see them — it writes
  // `_mirror` and nothing else, so a row-shaped key (snake_case `phone_verified`, `member_id`,
  // `league_id`) appearing in the snapshot would mean a base row had leaked into it.
  const snapRaw = localStorage.getItem(sb._snapshotKeyForTest());
  assert(!!snapRaw, '[A-FLUSH7] fixture: the device snapshot was written (nothing dirty)');
  assert(!/"phone_verified"|"league_id"|"member_id"/.test(String(snapRaw)),
    '[A-FLUSH7] nothing ROW-SHAPED — and so nothing from _baseRows — reaches the device snapshot');

  // A PLAIN MEMBER GETS THE SAME FOLD, ON HIS OWN ROW — amended 2026-09-19 (reviewer NOTE 2).
  // This block asserted the OPPOSITE until then: the fold was gated on `_isAdmin()` and the
  // asymmetry was pinned here as "the narrow reading of §2.4 rule 1". It was narrower than the rule
  // itself, which asks for EVIDENCE — a `get_member_contacts()` entry from the current hydrate — and
  // a member has exactly that for his own row. [A-FLUSH9] owns what the asymmetry actually cost.
  await hydrated({ who: 'player' });
  const me = sb.get('cfbp_players').map((p) => ({ ...p }));
  me.find((p) => p.playerId === 'p2').phone = '+15550007777';
  sb.set('cfbp_players', me);
  await captureConsoleAsync(() => sb.flush());
  assert((ST.league_members.find((m) => m.id === 'p2') || {}).phone === '+15550007777',
    '[A-FLUSH7] a plain member’s own contact write still saves');
  sb.set('cfbp_players', sb.get('cfbp_players').map((p) => ({ ...p })));
  const memberAgain = sb.planFlush().plan;
  assert(memberAgain.length === 0,
    `[A-FLUSH7] …and converges the same way — the fold follows the contacts he READ, not the role he holds (${JSON.stringify(memberAgain.map((o) => Object.keys(o.changed || {})))})`);
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FLUSH8] REVIEWER NOTE 1 — F2 HONESTY WAS APPLIED TO ONE BRANCH OF A TWO-BRANCH REPORTER
// ══════════════════════════════════════════════════════════════════════════
//
// `_refuseDirtyLoudly()` is called from `dropMirror()` for THREE reasons — a league switch, a
// device handover and a sign-out — and it writes the banner in two branches. c6b2f50 taught the
// non-switch branch to read `_inFlightSent` and stop claiming "Nothing was sent" about a run that
// had already put an operation on the wire. The LEAGUE-SWITCH branch was left saying, flatly, "A
// change made in X was not saved because you switched to Y. Re-enter it there."
//
// That claim is made from the same instant, about the same queue. `_dirty` is not cleared until
// AFTER `_runFlush()`'s loop, so at the moment of the drop it still names keys whose operation is
// suspended on its await — already sent, acknowledgement unknown. [A-FLUSH5] (kv) stages exactly
// that: two `patch_kv` operations, the switch fired from inside the first write. The player is then
// told to re-enter a change that DID save, and re-entering it is a double post — on `cfbp_comments`
// or `cfbp_chat` a visible duplicate, on a pick an edit the player believes he is making for the
// first time.
//
// So the honesty is asserted PER BRANCH and in both directions: the qualified wording when
// something went, the flat wording when nothing did. A branch that cannot say the true thing is
// worse than no banner, because the player acts on it.
await section('\n[A-FLUSH8] NOTE 1 — the drop banner is honest on EVERY branch, not just the handover one…', async () => {
  // Two kv operations, the drop fired from inside the FIRST write. Returns the banners raised and
  // how many operations actually reached the server, so "honest" is measured against the wire and
  // not against the adapter's own opinion.
  const dropDuringFirstWrite = async (drop) => {
    await hydrated({ who: 'commissioner' });
    let n = 0;
    CLIENT = makeClient(ST, SESSIONS.commissioner, {
      onWrite: (name) => { if (name === 'patch_kv' && !n++) captureConsole(() => drop()); },
    });
    sb.set('cfbp_nicknames', { ...(sb.get('cfbp_nicknames') || {}), p3: 'Kobe' });
    sb.set('cfbp_lock_overrides', { g1: 'unlocked' });
    const mark = bannerSeen.length;
    const res = await captureConsoleAsync(() => sb.flush());
    return { res, banners: bannersSince(mark), sent: CLIENT._calls.rpc.filter((r) => r.name === 'patch_kv').length };
  };
  // The same two operations, dropped BEFORE any flush runs: nothing has been sent, and the flat
  // wording is the true one. This is the direction that keeps the fix from being "delete the claim".
  const dropWithNothingInFlight = async (drop) => {
    await hydrated({ who: 'commissioner' });
    sb.set('cfbp_nicknames', { ...(sb.get('cfbp_nicknames') || {}), p3: 'Kobe' });
    sb.set('cfbp_lock_overrides', { g1: 'unlocked' });
    const mark = bannerSeen.length;
    captureConsole(() => drop());
    return { banners: bannersSince(mark), sent: CLIENT._calls.rpc.filter((r) => r.name === 'patch_kv').length };
  };

  // ── (a) LEAGUE SWITCH, mid-flight — the branch NOTE 1 is about ────────────
  {
    const { banners, sent } = await dropDuringFirstWrite(() => sb.beginSwitch(LEAGUE_A, LEAGUE_B));
    assert(sent === 1, `[A-FLUSH8] (switch) fixture: one operation really did reach the server before the switch (${sent})`);
    assert(banners.length > 0, `[A-FLUSH8] (switch) fixture: a banner was raised (${JSON.stringify(banners)})`);
    assert(!banners.some((t) => /was not saved because you switched/.test(t)),
      `[A-FLUSH8] (switch) the banner does NOT claim the change "was not saved" while an operation was already on the wire (${JSON.stringify(banners)})`);
    assert(banners.some((t) => /may already have saved/.test(t)),
      `[A-FLUSH8] (switch) …it says what the handover branch says — changes sent just before it may already have saved (${JSON.stringify(banners)})`);
    assert(!banners.some((t) => /^(?!.*may already have saved).*Re-enter it there/.test(t)),
      `[A-FLUSH8] (switch) …and nobody is told to re-enter something that may have saved, which is how a pick or a comment gets double-posted (${JSON.stringify(banners)})`);
    assert(banners.some((t) => /IRB Pick/.test(t)),
      `[A-FLUSH8] (switch) …while still NAMING the league the change was made in — the honesty may not cost the player the one fact he needs (${JSON.stringify(banners)})`);
  }

  // ── (b) LEAGUE SWITCH with nothing in flight — the flat wording is TRUE here ──
  {
    const { banners, sent } = await dropWithNothingInFlight(() => sb.beginSwitch(LEAGUE_A, LEAGUE_B));
    assert(sent === 0, `[A-FLUSH8] (switch, idle) fixture: nothing was sent (${sent})`);
    assert(banners.some((t) => /was not saved because you switched/.test(t) && /Re-enter it there/.test(t)),
      `[A-FLUSH8] (switch, idle) …so the flat "was not saved — re-enter it there" is kept, because it is true (${JSON.stringify(banners)})`);
  }

  // ── (c) SIGN-OUT, mid-flight — c6b2f50's branch, pinned rather than assumed ──
  {
    const { banners, sent } = await dropDuringFirstWrite(() => sb.dropMirror('sign-out'));
    assert(sent === 1, `[A-FLUSH8] (sign-out) fixture: one operation reached the server first (${sent})`);
    assert(!banners.some((t) => /Nothing was sent/.test(t)) && banners.some((t) => /may already have saved/.test(t)),
      `[A-FLUSH8] (sign-out) a sign-out mid-flight says what went, not "Nothing was sent" (${JSON.stringify(banners)})`);
  }

  // ── (d) DEVICE HANDOVER with nothing in flight — the flat claim is TRUE here ──
  {
    const { banners, sent } = await dropWithNothingInFlight(() => sb.dropMirror('device-handover'));
    assert(sent === 0, `[A-FLUSH8] (handover, idle) fixture: nothing was sent (${sent})`);
    assert(banners.some((t) => /Nothing was sent/.test(t)),
      `[A-FLUSH8] (handover, idle) …so "Nothing was sent" is kept — the fix is honesty, not the deletion of every claim (${JSON.stringify(banners)})`);
  }

  // ── (e) THE STALE-SWITCH REPORTER IS A DIFFERENT ONE, AND IT DOES NOT LIE ──
  //   `_reportStaleSwitch()` uses the same "was not saved … Re-enter it there" copy, so it was
  //   audited too. It fires from `_runFlush()` BEFORE the send loop, about keys whose captured
  //   token no longer matches the mirror and which are therefore DISCARDED FROM THE PLAN — never
  //   sent, this run or any other. Its claim is true by construction, and this assertion is what
  //   would notice if that ordering ever changed.
  {
    await hydrated({ who: 'commissioner' });
    sb.set('cfbp_nicknames', { ...(sb.get('cfbp_nicknames') || {}), p3: 'Kobe' });   // captured under A
    ACTIVE_LEAGUE = LEAGUE_B;
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_B, { epoch: EPOCH }));         // re-tagged to B ([A6] layer 2)
    const { plan, stale } = sb.planFlush();
    assert(stale.some((s) => s.key === 'cfbp_nicknames'),
      `[A-FLUSH8] (stale) fixture: the write captured under A really is stale against B's mirror (${JSON.stringify(stale)})`);
    assert(!plan.some((o) => o.key === 'cfbp_nicknames'),
      '[A-FLUSH8] (stale) …and it is DISCARDED FROM THE PLAN before the send loop starts');
    const mark = bannerSeen.length;
    await captureConsoleAsync(() => sb.flush());
    const nickSent = CLIENT._calls.rpc.filter((r) => r.name === 'patch_kv' && r.args && r.args.p_key === 'nicknames').length;
    assert(nickSent === 0 && bannersSince(mark).some((t) => /was not saved because you switched/.test(t)),
      `[A-FLUSH8] (stale) …so _reportStaleSwitch()'s identical copy is TRUE by construction and is left alone (${nickSent} sent, ${JSON.stringify(bannersSince(mark))})`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FLUSH9] REVIEWER NOTE 2 — THE CONTACT FOLD WAS GATED ON ROLE, NOT ON EVIDENCE
// ══════════════════════════════════════════════════════════════════════════
//
// N3's fold was scoped to `_isAdmin()` with the reasoning that the commissioner is the caller who
// read every member's contacts this hydrate. The SECOND half of that sentence is the real rule:
// `get_member_contacts()` returns all rows to him and EXACTLY ONE — his own — to a plain member
// (`0007_contact_privacy.sql:152-174`), and `_lastContacts` holds precisely what this hydrate read.
// So `_lastContacts.has(rowId)` is the same predicate `_applyContactWriteRule` already uses to
// decide whether the column may be WRITTEN at all (§2.4 rule 1). Gating the fold on the role
// instead of on the evidence left the member's own row outside it for no reason the rule states.
//
// What that cost, in the app rather than in the abstract: `cfbp_players` is ONE key, and a theme,
// timezone, dashboard-order or chat-accent change writes the whole array through it ([A-PREF]).
// With the base never advancing for his phone, every one of those saves re-planned the phone patch
// too — the member's number back on the wire on every preference change, for the life of the page,
// about the one column 0007 exists to keep quiet.
//
// The in-memory boundary is unchanged and is re-proved for the member case below: `_baseRows` and
// `_lastContacts` are not persisted, and `_persistSnapshot()` writes the projected mirror only.
await section('\n[A-FLUSH9] NOTE 2 — the contact fold follows the EVIDENCE, so a member’s own phone stops riding along on every theme save…', async () => {
  await hydrated({ who: 'player' });                       // Kevin, p2 — reads his own contacts only
  const setOn = (playerId, patch) => {
    const all = sb.get('cfbp_players').map((p) => ({ ...p }));
    Object.assign(all.find((p) => p.playerId === playerId), patch);
    sb.set('cfbp_players', all);
  };

  setOn('p2', { phone: '+15550007777' });
  const first = sb.planFlush().plan;
  assert(first.length === 1 && first[0].changed.phone === '+15550007777',
    `[A-FLUSH9] fixture: a member's own contact write is planned (0007 allows it) (${JSON.stringify(first.map((o) => Object.keys(o.changed || {})))})`);
  await captureConsoleAsync(() => sb.flush());
  assert((ST.league_members.find((m) => m.id === 'p2') || {}).phone === '+15550007777',
    '[A-FLUSH9] fixture: …and the server took it');

  // THE FINDING, in the shape the app actually produces it: he changes his THEME.
  setOn('p2', { preferences: { theme: 'boilermaker' } });
  const second = sb.planFlush().plan;
  assert(second.length === 1 && second[0].rowId === 'p2',
    `[A-FLUSH9] fixture: the theme change is one patch on his own row (${JSON.stringify(second.map((o) => [o.op, o.rowId]))})`);
  assert(!('phone' in (second[0].changed || {})),
    `[A-FLUSH9] the second plan carries NO phone column — the acknowledged contact write advanced his base (${JSON.stringify(Object.keys(second[0].changed || {}))})`);
  const wireBefore = CLIENT._calls.updates.filter((u) => u.table === 'league_members').length;
  await captureConsoleAsync(() => sb.flush());
  assert(!CLIENT._calls.updates.slice(wireBefore).some((u) => u.patch && 'phone' in u.patch),
    `[A-FLUSH9] …and no phone number reaches the wire for a theme change (${JSON.stringify(CLIENT._calls.updates.slice(wireBefore).map((u) => Object.keys(u.patch || {})))})`);

  // A REVERT STILL SENDS: the evidence moved with the base for the member too, so §2.4 rule 1's
  // "the server already has it" comparison is made against the CURRENT number, not a stale one.
  setOn('p2', { phone: '+15550000002' });
  const revert = sb.planFlush().plan;
  assert(revert.length === 1 && revert[0].changed.phone === '+15550000002',
    `[A-FLUSH9] a member's revert to his previously-read number is still sent (${JSON.stringify(revert.map((o) => o.changed))})`);
  await captureConsoleAsync(() => sb.flush());

  // EVIDENCE, NOT ROLE — proved by removing the evidence. With no `get_member_contacts()` entry for
  // his row, §2.4 rule 1 drops the column at the planner and the fold has nothing to fold: the gate
  // is the contacts map, not `isAdmin`.
  sb._setContactsForTest([]);
  setOn('p2', { phone: '+15550008888' });
  const noEvidence = sb.planFlush().plan;
  assert(!noEvidence.some((o) => 'phone' in (o.changed || {})),
    `[A-FLUSH9] with the contacts evidence gone, no contact column is planned at all — the fold cannot outlive the read that authorized it (${JSON.stringify(noEvidence.map((o) => Object.keys(o.changed || {})))})`);

  // THE IN-MEMORY BOUNDARY, re-proved for the member case ([A-FLUSH7]'s read-back, his side of it).
  await hydrated({ who: 'player' });
  setOn('p2', { phone: '+15550006666' });
  await captureConsoleAsync(() => sb.flush());
  setOn('p2', { preferences: { theme: 'razorback' } });
  await captureConsoleAsync(() => sb.flush());
  const snapRaw = localStorage.getItem(sb._snapshotKeyForTest());
  assert(!!snapRaw, '[A-FLUSH9] fixture: the device snapshot was written (nothing dirty)');
  assert(!/"phone_verified"|"league_id"|"member_id"/.test(String(snapRaw)),
    `[A-FLUSH9] nothing ROW-SHAPED — and so nothing from the member's folded _baseRows — reaches the device snapshot`);
});

await section('\n[A-HIDE2] 5c2aa38 re-validated: two hide events plus the debounce timer are ONE network write per op…', async () => {
  await hydrated({ who: 'commissioner' });
  tbPut('w1__p1', 70);                       // arms the ~800ms debounce timer
  const before = CLIENT._calls.updates.filter((u) => u.table === 'tiebreaker_guesses').length;
  const h1 = sb.flush();                     // pagehide
  const h2 = sb.flush();                     // visibilitychange:hidden — same backgrounding
  await captureConsoleAsync(() => Promise.all([h1, h2]));
  const sent = CLIENT._calls.updates.filter((u) => u.table === 'tiebreaker_guesses').length - before;
  assert(sent === 1, `[A-HIDE2] one update for one edit across both hide events (sent ${sent})`);
  assert(sb.getStatus().pendingWrites === 0,
    `[A-HIDE2] …and the debounce timer has nothing left to send (${sb.getStatus().pendingWrites} pending)`);
  // The timer itself must not fire a third write. A macrotask is enough to prove it was cleared:
  // flush() disarms it at the top of the run, so a pending timer cannot outlive the run.
  await new Promise((r) => setTimeout(r, 0));
  const later = CLIENT._calls.updates.filter((u) => u.table === 'tiebreaker_guesses').length - before;
  assert(later === 1, `[A-HIDE2] …and nothing else follows it (${later})`);
  // THE OFFLINE HIDE: backgrounded with no network. Nothing may be reported as refused, and the
  // write must survive to the next foreground.
  tbPut('w1__p1', 71);
  const good = CLIENT;
  CLIENT = makeClient(ST, SESSIONS.commissioner, { throwWrites: () => new TypeError('Failed to fetch') });
  const mark = bannerSeen.length;
  await captureConsoleAsync(() => Promise.all([sb.flush(), sb.flush()]));
  assert(!bannersSince(mark).some((t) => /Nothing was saved/.test(t)) && !sb._refusedKeysForTest().length,
    `[A-HIDE2] hidden + offline says nothing about a refusal (${JSON.stringify(bannersSince(mark))})`);
  assert(sb._dirtyKeysForTest().includes('cfbp_tiebreaker_guesses'),
    '[A-HIDE2] …and the write is still queued when the app comes back');
  CLIENT = good;
  await captureConsoleAsync(() => sb.flush());
  const row = ST.tiebreaker_guesses.find((x) => x.id === 'tb_w1__p1');
  assert(row && Number(row.guess) === 71, `[A-HIDE2] …and then it saves (${row && row.guess})`);
});

await section('\n[A-HIDE3] the hide listeners are registered ONCE per page, though the tail has two callers…', async () => {
  const blank = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const app = blank(readFileSync(join(__dirname, 'js', 'app.js'), 'utf8'));
  assert(/let _unloadListenersWired = false;/.test(app)
    && /&& !_unloadListenersWired\) \{\s*_unloadListenersWired = true;/.test(app),
    '[A-HIDE3] the unload/hide listener block is behind its own page-lifetime latch, set on entry [structural]');
  const reset = app.slice(app.indexOf('export function _resetAuthHoldForTest'), app.indexOf('export function showGoogleSignInGate'));
  assert(reset.length > 0 && !/_unloadListenersWired/.test(reset),
    '[A-HIDE3] …and the test hook that drops _postHydrateTailDone does NOT drop it — a window keeps its listeners across a re-driven boot, and a suite that re-armed them would be measuring a page that cannot exist [structural]');
  // AMENDED 2026-09-23: there is ONE hide event registered here now, not two.
  // `beforeunload` carried `flushPush()`, the SHEETS queue, and went with it.
  // The `pagehide` + `visibilitychange:hidden` pair is the one that matters on a
  // phone anyway — RG-179's own finding was that `beforeunload` is not reliable
  // on iOS, so the line that just went was not carrying this weight there even
  // while it existed.
  assert((app.match(/addEventListener\('pagehide'/g) || []).length === 1,
    '[A-HIDE3] …and there is exactly one registration site for `pagehide` [structural]');
  assert((app.match(/addEventListener\('beforeunload'/g) || []).length === 0,
    '[A-HIDE3] …and none at all for `beforeunload`, whose only handler was the retired Sheets flushPush() [structural]');
  assert((app.match(/addEventListener\('visibilitychange'/g) || []).length >= 1,
    '[A-HIDE3] …while visibilitychange:hidden — the event iOS actually delivers — is still wired beside it');
});

// ══════════════════════════════════════════════════════════════════════════
// [A-LSV] DI-218 (migration 0018) — THE TWO NEW `league_members` COLUMNS ARE
// INVISIBLE TO THE ADAPTER'S DIFF/UPSERT PATH.
//
// `last_seen_version` and `last_seen_at` are written by ONE thing — the DEFINER
// `report_app_version()` RPC, stamping the caller's own row. The adapter must
// never read them, never send them, and above all never NULL them.
//
// THE FAILURE THIS PREVENTS IS NOT HYPOTHETICAL: it is RG-39's field-blanking
// class, and the 2026-09-19 cutover defect NOT_NULL_COLS exists because of. A
// projection that produced `last_seen_version: null` on every player record
// (the Sheet never had the field) would send that null in the first profile
// save, and every member's reported version would be erased by the first person
// to edit a nickname.
//
// THREE INDEPENDENT REASONS IT CANNOT HAPPEN, all asserted, because any one of
// them alone could be edited away by someone who did not know about the other
// two:
//   1. the PROJECTION does not emit the columns, so they never enter a row;
//   2. `SELECT_COLS.league_members` does not name them, so they are never in
//      `_base` either and cannot appear as a "change";
//   3. the SELECT GRANT in 0018 does not include them, so even a hand-written
//      `.select('last_seen_version')` would be 42501.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-LSV] DI-218 — last_seen_version/last_seen_at never reach the adapter\'s diff or upsert…', async () => {
  const NEW_COLS = ['last_seen_version', 'last_seen_at'];
  const selectCols = sb._selectColsForTest ? sb._selectColsForTest() : null;
  const notNull = sb._notNullColsForTest();

  assert(Array.isArray(notNull.league_members) && notNull.league_members.length > 0,
    '[A-LSV] fixture check — NOT_NULL_COLS.league_members was read (an empty read would make the next assertion vacuous)');
  assert(NEW_COLS.every((c) => !notNull.league_members.includes(c)),
    '[A-LSV] neither column is in NOT_NULL_COLS.league_members — correct, because both are NULLABLE in 0018; listing them there would make the planner SKIP a legitimate null on some other nullable column by implying a rule that is not the schema\'s');

  // 1. The projection.
  // `playerId` / `displayName` — THE REAL PLAYER-RECORD SHAPE. Corrected at the combined release
  // (2026-09-20, reviewer BLOCK R1): this fixture said `{ id, name }`, which is not the shape
  // `PLAYER_COLS` reads (js/supabase-projection.js:545 maps legacy `playerId` -> column `id` and
  // legacy `displayName` -> `display_name`), so the projected row carried `id: undefined` and the
  // assertions below — which only ask whether two OTHER columns are absent — passed over it. The
  // same wrong shape in js/app.js's `nameOf` was a live rendering defect; here it was a fixture
  // quietly proving less than it claimed. Fixed in both places together.
  const projected = proj.toRows.cfbp_players(
    [{ playerId: 'p1', displayName: 'Drew', initials: 'DH', active: true, almaMater: '', preferences: {} }],
    { leagueId: LEAGUE_A, memberIds: ['p1'], now: NOW },
  );
  const rows = (projected && projected.league_members) || [];
  assert(rows.length === 1,
    `[A-LSV] fixture check — the player projection produced a league_members row (got ${rows.length})`);
  assert(rows[0].id === 'p1' && rows[0].display_name === 'Drew',
    `[A-LSV] fixture check — …and it carries the MAPPED id and display name, proving the input shape is the one PLAYER_COLS actually reads (got ${JSON.stringify({ id: rows[0].id, display_name: rows[0].display_name })})`);
  assert(rows.every((r) => NEW_COLS.every((c) => !Object.prototype.hasOwnProperty.call(r, c))),
    `[A-LSV] the projection emits NEITHER column — not as a value and not as an explicit null, so neither can enter an INSERT or a PATCH at all (got ${JSON.stringify(Object.keys(rows[0]))})`);

  // 2. The read column list.
  const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
  const selBlock = src.slice(src.indexOf('const SELECT_COLS'), src.indexOf('const SELECT_COLS') + 600);
  assert(/league_members:/.test(selBlock),
    '[A-LSV] fixture check — SELECT_COLS.league_members was located in the source');
  assert(NEW_COLS.every((c) => !selBlock.includes(c)),
    '[A-LSV] …and it names NEITHER column, so neither is ever in `_base` — a column the adapter cannot see cannot be diffed, and a column that is never diffed can never be sent back as an erase (RG-39)');

  // 3. The grant, in the migration itself.
  const mig = readFileSync(join(__dirname, 'supabase', 'migrations', '0018_push_selftest.sql'), 'utf8');
  const grants = mig.match(/grant select[\s\S]{0,200}?on public\.league_members/g) || [];
  assert(grants.length === 0,
    `[A-LSV] …and 0018 issues NO new select grant on league_members at all, so even a hand-written .select('last_seen_version') is 42501 for every client role (found ${grants.length})`);
  assert(/member_app_versions/.test(mig),
    '[A-LSV] …the commissioner reads them through the DEFINER member_app_versions() RPC instead — the same "a DEFINER RPC, not a widened grant" shape 0007 uses for the contact columns, and for the same reason: a grant cannot be narrowed to one reader');
});

// ══════════════════════════════════════════════════════════════════════════
// [A-OBL] / [A-LATCH] / [A-RETRY] — RG-202: "I keep getting the banner"
//
// Drew, 2026-09-20, commissioner, his own devices: "Cross-device sync is OFF on this device.
// Still unsaved: cfbp_obligations. … I keep getting the banner and manually hit retry and it
// resolves." Three defects, in the order they fire:
//
//  1. [A-OBL]   THE FINALIZE BATCH SENDS THE NEW OBLIGATION TWICE. `planFlush()` builds the
//               obligations INSERT against the base as it stood BEFORE the run; `finalize_week`
//               then inserts those same rows itself (`_finalizeArgs`) and folds them into the
//               base. The already-planned insert still goes, PostgREST answers 23505/409, and the
//               commissioner gets "The server refused to save cfbp_obligations … Nothing was
//               saved" about an obligation that saved. Every week, on every finalize.
//  2. [A-LATCH] THE LATCH OUTLIVES THE THING IT DESCRIBES. `_refusedKeys` is released by exactly
//               one event — a later SUCCESSFUL write of that same key — although the code's own
//               comments say "latched until a hydrate lands". After the hydrate the key re-diffs
//               to nothing and goes CLEAN, so the latch now describes a key that is saved and not
//               pending; every subsequent flush of any key re-raises the red banner with the
//               fallback wording `Still unsaved: cfbp_obligations.` (which is exactly the string
//               Drew quoted — it can only appear once `_lastError` has been cleared by a
//               successful hydrate). The Retry button only re-hydrates, so it hides the banner
//               without clearing the latch, and the banner comes straight back.
//  3. [A-RETRY] A HICCUP IS NOT A BREAKAGE. Every answered-but-transient write failure — 408/425/
//               429/5xx, a 401 on a token that is about to refresh, a 23505 a re-diff would
//               dissolve — went to the red banner on the first attempt with no retry at all.
//
// AD-59 IS NOT WIDENED BY ANY OF THIS. `_isWriteNetworkFailure()` is unchanged: a 504 is still not
// "the network did not answer", still never reaches OFFLINE-READONLY and still never serves a
// snapshot. What changes is only WHEN an answered failure escalates to the red banner.
// ══════════════════════════════════════════════════════════════════════════

/** Swap the client for one that fails every write with a given shape, keeping the same store. */
function failingClient(failWrites, failWriteStatus = 0) {
  return makeClient(ST, SESSIONS.commissioner, failWriteStatus
    ? { failWrites, failWriteStatus }
    : { failWrites });
}

await section('\n[A-OBL] a finalize never sends the new obligation twice (RG-202 root cause)…', async () => {
  await hydrated({ who: 'commissioner' });
  const g = sb.get('cfbp_games').map((x) => ({ ...x }));
  g.find((x) => x.gameId === 'g3').atsWinner = 'Iowa';
  sb.set('cfbp_games', g);
  const wk = sb.get('cfbp_weeks').map((x) => ({ ...x }));
  wk.find((x) => x.weekId === 'w2').status = 'final';
  sb.set('cfbp_weeks', wk);
  sb.set('cfbp_results', [...sb.get('cfbp_results'), {
    resultId: 'wr_w2_p2', weekId: 'w2', playerId: 'p2', displayName: 'Kevin',
    correctPicks: 0, incorrectPicks: 1, correctCount: 0, incorrectCount: 1,
    noDecisions: 0, pending: 0, tiebreakerGuess: null, tiebreakerDelta: null,
    rank: 2, isWinner: false, isLoser: true, wonByTiebreaker: false,
  }]);
  // The obligation `reconcileWeeklyObligation()` creates in the SAME synchronous tick as the
  // status change (js/app.js:15303-15304 inside finalizeWeek) — the real shape, not a contrived one.
  sb.set('cfbp_obligations', [...sb.get('cfbp_obligations'), {
    obligationId: 'ob2', type: 'weekly', weekId: 'w2', payerPlayerId: 'p2', recipientPlayerId: 'p1',
    amountOrPrize: 'beer', status: 'unpaid', createdAt: new Date(NOW).toISOString(), paidAt: null,
    needsReview: false, reviewNote: null, voided: false, voidedAt: null, voidReason: null,
    mergedInto: null, mergedFrom: [],
  }]);
  const mark = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());

  assert(ST.obligations.filter((o) => o.id === 'ob2').length === 1,
    `[A-OBL] the obligation is on the server exactly once (${ST.obligations.filter((o) => o.id === 'ob2').length})`);
  assert(CLIENT._calls.inserts.filter((i) => i.table === 'obligations').length === 0,
    `[A-OBL] and NO obligations INSERT statement was issued at all — finalize_week already carried it `
    + `(${JSON.stringify(CLIENT._calls.inserts.filter((i) => i.table === 'obligations'))})`);
  assert(!sb._refusedKeysForTest().includes('cfbp_obligations'),
    `[A-OBL] …so cfbp_obligations is NOT latched refused (${JSON.stringify(sb._refusedKeysForTest())})`);
  assert(!bannersSince(mark).some((t) => /Nothing was saved|duplicate key/i.test(t)),
    `[A-OBL] …and the commissioner sees no "Nothing was saved" banner for a write that saved (${JSON.stringify(bannersSince(mark))})`);
  assert(!sb._dirtyKeysForTest().includes('cfbp_obligations'),
    `[A-OBL] …and the key ends CLEAN (${JSON.stringify(sb._dirtyKeysForTest())})`);
});

// ══════════════════════════════════════════════════════════════════════════
// [A-NARROW-DIVERGE] — SECURITY F1 on the RG-202 gate (MEDIUM, 2026-09-20)
//
// `_narrowInsertAgainstBase()` dropped a planned INSERT row whenever the base merely held the SAME
// ID, and the call site then counted the key as SENT. For the finalize case that is exactly right —
// the base row IS the row we were about to send. But the base can move mid-run for reasons that
// bring DIFFERENT content with them (a Realtime echo of another device's row, a hydrate that lands
// behind an in-flight write), and in that case the dropped row is the one carrying THIS device's
// value. Marked clean, never sent, silently replaced at the next hydrate: a loud-fail violation of
// exactly the kind AD-06 exists to stop, introduced by the fix for a loud-fail violation.
//
// The staging is [A-FLUSH6]'s, because it is the real mechanism rather than a poke at internals:
// `delayWrites` parks the first operation of a two-operation plan, another device's row lands on
// the server, and a hydrate replaces `_baseRows` before the second operation is sent.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-NARROW-DIVERGE] an INSERT is narrowed away only when the base row is what we were about to send…', async () => {
  // ── (a) DIVERGENT content: the row must NOT be silently abandoned ──────────────────────────
  await hydrated({ who: 'commissioner' });
  const good = CLIENT;
  let release;
  const gate = new Promise((r) => { release = r; });
  CLIENT = makeClient(ST, SESSIONS.commissioner, { delayWrites: () => gate });
  // Two operations, in a known order: the games patch is `_planOrder` 0, the guesses INSERT is 3.
  const games = sb.get('cfbp_games').map((x) => ({ ...x }));
  games.find((x) => x.gameId === 'g1').homeScore = 14;
  sb.set('cfbp_games', games);
  epPut('w1__p1', 21);                                   // a NEW row -> an INSERT
  assert(sb.planFlush().plan.some((o) => o.op === 'insert' && o.key === 'cfbp_extra_point_guesses'),
    '[A-NARROW-DIVERGE] fixture — the guesses operation really is an INSERT');
  const p = sb.flush();                                  // parked on the games patch
  // Another device inserts the SAME id with a DIFFERENT value, and a hydrate lands behind us.
  ST.extra_point_guesses.push(row({ league_id: LEAGUE_A, id: 'ep_w1__p1', week_id: 'w1', member_id: 'p1', guess: 99, updated_at: new Date(NOW).toISOString() }));
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const mark = bannerSeen.length;
  release();
  await captureConsoleAsync(() => p);

  assert(Number((sb.get('cfbp_extra_point_guesses') || {})['w1__p1']) === 21,
    `[A-NARROW-DIVERGE] fixture — the rebase kept this device's own value in the mirror (${JSON.stringify((sb.get('cfbp_extra_point_guesses') || {})['w1__p1'])})`);
  assert(!CLIENT._calls.inserts.some((i) => i.table === 'extra_point_guesses'),
    `[A-NARROW-DIVERGE] the doomed INSERT is still not sent — re-sending it would be a 23505 (${JSON.stringify(CLIENT._calls.inserts.map((i) => i.table))})`);
  // THE FINDING: it must not be marked clean with nothing sent.
  //
  // NOTHING BELOW CALLS flush(). The run has to have ARMED the follow-up itself
  // (`_flushNeedsFollowUp`), and these ticks only let that armed run settle — an earlier draft of
  // this section flushed by hand here, which made the arming invisible and let a mutant that
  // removed it pass. If no follow-up was armed, the value simply never goes and every assertion
  // below fails.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  const serverRow = ST.extra_point_guesses.find((r) => r.id === 'ep_w1__p1');
  assert(!!serverRow && Number(serverRow.guess) === 21,
    `[A-NARROW-DIVERGE] the device's value REACHES THE SERVER, as a PATCH against the advanced base (${serverRow && serverRow.guess})`);
  assert(ST.extra_point_guesses.filter((r) => r.id === 'ep_w1__p1').length === 1,
    '[A-NARROW-DIVERGE] …exactly once, with no duplicate row');
  assert(!sb._dirtyKeysForTest().includes('cfbp_extra_point_guesses'),
    `[A-NARROW-DIVERGE] …and only THEN is the key clean (${JSON.stringify(sb._dirtyKeysForTest())})`);
  assert(!bannersSince(mark).some((t) => /Nothing was saved/.test(t)),
    `[A-NARROW-DIVERGE] …with no red banner at any point: nothing was refused (${JSON.stringify(bannersSince(mark))})`);
  CLIENT = good;

  // ── (b) EQUAL content: the finalize case still narrows to nothing ──────────────────────────
  // The same staging, except the row another device lands is byte-identical to the one we planned.
  // There is genuinely nothing left to send, so the key is clean and no follow-up is armed —
  // without this half, the fix above could have been "never narrow", which re-opens RG-202.
  await hydrated({ who: 'commissioner' });
  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  CLIENT = makeClient(ST, SESSIONS.commissioner, { delayWrites: () => gate2 });
  const games2 = sb.get('cfbp_games').map((x) => ({ ...x }));
  games2.find((x) => x.gameId === 'g1').homeScore = 17;
  sb.set('cfbp_games', games2);
  epPut('w1__p2', 44);
  const q = sb.flush();
  ST.extra_point_guesses.push(row({ league_id: LEAGUE_A, id: 'ep_w1__p2', week_id: 'w1', member_id: 'p2', guess: 44, updated_at: new Date(NOW).toISOString() }));
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const mark2 = bannerSeen.length;
  release2();
  await captureConsoleAsync(() => q);
  assert(!CLIENT._calls.inserts.some((i) => i.table === 'extra_point_guesses'),
    '[A-NARROW-DIVERGE] (b) an identical row is still narrowed out of the statement');
  assert(!sb._dirtyKeysForTest().includes('cfbp_extra_point_guesses'),
    `[A-NARROW-DIVERGE] (b) …and the key IS clean, because there is nothing left to send (${JSON.stringify(sb._dirtyKeysForTest())})`);
  assert(!bannersSince(mark2).some((t) => /Nothing was saved/.test(t)),
    `[A-NARROW-DIVERGE] (b) …and nothing is reported to the player (${JSON.stringify(bannersSince(mark2))})`);
});

await section('\n[A-LATCH] the refusal latch may not outlive the thing it describes…', async () => {
  // A genuine refusal, latched. Then the condition goes away (the row is on the server, so the
  // re-diff after a hydrate plans nothing) and the key goes clean. The banner must go with it.
  await hydrated({ who: 'commissioner' });
  const good = CLIENT;
  tbPut('w1__p1', 77);
  CLIENT = failingClient({ code: '42501', message: 'permission denied for table tiebreaker_guesses' });
  await captureConsoleAsync(() => sb.flush());
  assert(sb._refusedKeysForTest().includes('cfbp_tiebreaker_guesses'),
    '[A-LATCH] fixture — a 42501 latches the key (if it did not, the rest of this section proves nothing)');

  // The server now holds the value anyway (another device wrote it), so the hydrate rebases the
  // key and the next flush has nothing to send for it.
  ST.tiebreaker_guesses.find((x) => x.id === 'tb_w1__p1').guess = 77;
  CLIENT = good;
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const mark = bannerSeen.length;
  statuses.length = 0;
  const res = await captureConsoleAsync(() => sb.flush());
  assert(!sb._dirtyKeysForTest().includes('cfbp_tiebreaker_guesses'),
    `[A-LATCH] fixture — the key is no longer dirty after the rebase (${JSON.stringify(sb._dirtyKeysForTest())})`);
  assert(!sb._refusedKeysForTest().length,
    `[A-LATCH] …so the latch is RELEASED — a key with nothing left to save is not "still unsaved" (${JSON.stringify(sb._refusedKeysForTest())})`);
  assert(!bannersSince(mark).some((t) => /Still unsaved/.test(t)),
    `[A-LATCH] …and no "Still unsaved:" banner is raised for it (${JSON.stringify(bannersSince(mark))})`);
  assert(statuses.some(([s]) => s === 'synced') && !statuses.some(([s]) => s === 'refused'),
    `[A-LATCH] …the run reports SYNCED, so app.js takes the red banner down with no tap (${JSON.stringify(statuses.map(([s]) => s))}, ${JSON.stringify(res)})`);

  // THE OTHER HALF, and it is the one that keeps AD-06 loud: a key that IS still dirty keeps its
  // latch, so reviewer F6 ('synced' may not be emitted while a refused key is still unsaved) holds.
  await hydrated({ who: 'commissioner' });
  const good2 = CLIENT;
  tbPut('w1__p1', 78);
  CLIENT = failingClient({ code: '42501', message: 'permission denied for table tiebreaker_guesses' });
  await captureConsoleAsync(() => sb.flush());
  CLIENT = good2;
  statuses.length = 0;
  sb.set('cfbp_reactions', { ...sb.get('cfbp_reactions'), w9: { g9: { hot: ['p2'] } } });
  await captureConsoleAsync(() => sb.flush());
  assert(sb._refusedKeysForTest().includes('cfbp_tiebreaker_guesses'),
    '[A-LATCH] a refused key that is STILL DIRTY keeps its latch (the release is "nothing left to save", never "time passed")');
  assert(!statuses.some(([s]) => s === 'synced'),
    `[A-LATCH] …and no 'synced' is emitted while it is unsaved (reviewer F6 intact) (${JSON.stringify(statuses.map(([s]) => s))})`);
});

await section('\n[A-RETRY] a transient write failure is retried automatically, bounded, before any red banner…', async () => {
  // ── 1. FAILS, THEN SUCCEEDS: no red banner, one successful write, no duplicate ──────────────
  const timers = makeFakeTimers();
  await hydrated({ who: 'commissioner', timers });
  const good = CLIENT;
  tbPut('w1__p1', 81);
  CLIENT = failingClient({ code: '', message: 'Service Unavailable' }, 503);
  let mark = bannerSeen.length;
  statuses.length = 0;
  const first = await captureConsoleAsync(() => sb.flush());
  assert(!bannersSince(mark).length,
    `[A-RETRY1] a 503 raises NO banner at all on the first attempt (${JSON.stringify(bannersSince(mark))})`);
  assert(!sb._refusedKeysForTest().length,
    `[A-RETRY1] …and latches nothing (${JSON.stringify(sb._refusedKeysForTest())})`);
  assert(sb._dirtyKeysForTest().includes('cfbp_tiebreaker_guesses'),
    `[A-RETRY1] …the write stays QUEUED and the key stays named as unsaved (${JSON.stringify(sb._dirtyKeysForTest())})`);
  assert(!statuses.some(([s]) => s === 'refused'),
    `[A-RETRY1] …no 'refused' status (${JSON.stringify(statuses.map(([s]) => s))})`);
  assert(!statuses.some(([s]) => s === 'offline'),
    `[A-RETRY1] …and never 'offline' either: the server ANSWERED, and AD-59's rule that an answer is not an outage is untouched (${JSON.stringify(statuses.map(([s]) => s))})`);
  assert(timers.delays().length === 1 && timers.delays()[0] === 1000,
    `[A-RETRY1] …exactly one retry is scheduled, at ~1s (${JSON.stringify(timers.delays())})`);
  assert(first && Array.isArray(first.retrying) && first.retrying.includes('cfbp_tiebreaker_guesses'),
    `[A-RETRY1] …and the run names what it is retrying (${JSON.stringify(first)})`);

  CLIENT = good;
  const before = CLIENT._calls.updates.length;
  await timers.runNext();
  assert(CLIENT._calls.updates.length === before + 1,
    `[A-RETRY1] the retry sends the write exactly ONCE (${CLIENT._calls.updates.length - before})`);
  assert(ST.tiebreaker_guesses.filter((x) => x.id === 'tb_w1__p1').length === 1
    && Number(ST.tiebreaker_guesses.find((x) => x.id === 'tb_w1__p1').guess) === 81,
    '[A-RETRY1] …the value lands, with no duplicate row');
  assert(!sb._dirtyKeysForTest().length && !sb._refusedKeysForTest().length,
    `[A-RETRY1] …the key ends CLEAN and unlatched (${JSON.stringify(sb._dirtyKeysForTest())}, ${JSON.stringify(sb._refusedKeysForTest())})`);
  assert(statuses.some(([s]) => s === 'synced'),
    `[A-RETRY1] …and the state clears itself with no tap (${JSON.stringify(statuses.map(([s]) => s))})`);
  assert(timers.count() === 0, '[A-RETRY1] …and no further retry is left armed');

  // ── 2. PERSISTENT FAILURE: red only after the bounded schedule, key still listed ────────────
  const t2 = makeFakeTimers();
  await hydrated({ who: 'commissioner', timers: t2 });
  tbPut('w1__p1', 82);
  CLIENT = failingClient({ code: '', message: 'Service Unavailable' }, 503);
  mark = bannerSeen.length;
  statuses.length = 0;
  await captureConsoleAsync(() => sb.flush());
  const schedule = [];
  for (let i = 0; i < 3; i++) {
    schedule.push(t2.delays()[0]);
    await captureConsoleAsync(() => t2.runNext());
  }
  assert(JSON.stringify(schedule) === JSON.stringify([1000, 3000, 8000]),
    `[A-RETRY2] the backoff is bounded and ascending — 1s, 3s, 8s, then stop (${JSON.stringify(schedule)})`);
  assert(t2.count() === 0, `[A-RETRY2] …and nothing is left armed after the last one (${t2.count()})`);
  assert(bannersSince(mark).some((t) => /Nothing was saved/.test(t)),
    `[A-RETRY2] …and only THEN does the red banner go up (${JSON.stringify(bannersSince(mark))})`);
  assert(sb._refusedKeysForTest().includes('cfbp_tiebreaker_guesses'),
    '[A-RETRY2] …with the key latched');
  assert(sb._dirtyKeysForTest().includes('cfbp_tiebreaker_guesses'),
    `[A-RETRY2] …and STILL listed as unsaved: nothing was dropped and nothing was marked clean (${JSON.stringify(sb._dirtyKeysForTest())})`);
  assert(!statuses.some(([s]) => s === 'offline'),
    `[A-RETRY2] …and the player is never told "offline" about a device that is demonstrably on the network (${JSON.stringify(statuses.map(([s]) => s))})`);

  // ── 3. A NON-TRANSIENT REFUSAL IS RED IMMEDIATELY, WITH NO RETRIES ─────────────────────────
  for (const [label, shape, status] of [
    ['42501 — an RLS/privilege refusal', { code: '42501', message: 'permission denied for table tiebreaker_guesses' }, 0],
    ['a 403 from the edge', { code: '', message: 'Forbidden' }, 403],
    ['a 400 PostgREST rejects outright', { code: 'PGRST102', message: 'invalid request body' }, 400],
    ['23502 — a not-null violation, which no re-diff dissolves', { code: '23502', message: 'null value in column "guess" violates not-null constraint' }, 0],
  ]) {
    const t3 = makeFakeTimers();
    await hydrated({ who: 'commissioner', timers: t3 });
    tbPut('w1__p1', 83);
    CLIENT = failingClient(shape, status);
    const m = bannerSeen.length;
    await captureConsoleAsync(() => sb.flush());
    assert(t3.count() === 0, `[A-RETRY3] ${label}: NO retry is scheduled (${JSON.stringify(t3.delays())})`);
    assert(bannersSince(m).some((t) => /Nothing was saved/.test(t)),
      `[A-RETRY3] ${label}: …the red banner goes up immediately (${JSON.stringify(bannersSince(m))})`);
    assert(sb._refusedKeysForTest().includes('cfbp_tiebreaker_guesses'),
      `[A-RETRY3] ${label}: …and the key is latched`);
  }

  // ── 4. IDENTITY CHANGE MID-BACKOFF: the retry is ABANDONED, never re-addressed ──────────────
  const t4 = makeFakeTimers();
  await hydrated({ who: 'commissioner', timers: t4 });
  tbPut('w1__p1', 84);
  CLIENT = failingClient({ code: '', message: 'Service Unavailable' }, 503);
  await captureConsoleAsync(() => sb.flush());
  assert(t4.count() === 1, '[A-RETRY4] fixture — a retry is armed');
  CLIENT = good;
  const sentBefore = CLIENT._calls.updates.length;
  EPOCH = 99;                                   // the device is now a different identity
  await captureConsoleAsync(() => t4.runNext());
  assert(CLIENT._calls.updates.length === sentBefore,
    `[A-RETRY4] a retry whose identity moved sends NOTHING (${CLIENT._calls.updates.length - sentBefore})`);
  // THE RETRY'S OWN GATE, not the flush's. `_runFlush()` has an abandon check of its own, so an
  // assertion that only reads "nothing was sent" or "something said ABANDONED" passes even with
  // the retry's gate deleted — the mutation proof found exactly that. These two are specific to
  // `_runRetry()`: its own wording, and its own reset of the schedule (a run that abandoned inside
  // `_runFlush()` leaves the attempt counter where it was).
  assert(said(/automatic write retry was ABANDONED/),
    `[A-RETRY4] …and the RETRY says so in its own words, before it ever reaches a flush (${JSON.stringify(_captured.slice(-3))})`);
  assert(sb._retryStateForTest().attempt === 0,
    `[A-RETRY4] …and the schedule is reset rather than carried across an identity (${JSON.stringify(sb._retryStateForTest())})`);
  assert(t4.count() === 0, '[A-RETRY4] …and does not re-arm itself');

  // ── 5. TWO KEYS FAILING: ONE retry in flight, not one per key ───────────────────────────────
  const t5 = makeFakeTimers();
  await hydrated({ who: 'commissioner', timers: t5 });
  tbPut('w1__p1', 85);
  epPut('w1__p1', 3);
  CLIENT = failingClient({ code: '', message: 'Service Unavailable' }, 503);
  await captureConsoleAsync(() => sb.flush());
  assert(t5.count() === 1,
    `[A-RETRY5] two failing keys arm exactly ONE retry, not one per key — six phones must not storm (${JSON.stringify(t5.delays())})`);
  assert(sb._dirtyKeysForTest().length === 2,
    `[A-RETRY5] …and both keys stay queued (${JSON.stringify(sb._dirtyKeysForTest())})`);
  CLIENT = good;
  await captureConsoleAsync(() => t5.runNext());
  assert(!sb._dirtyKeysForTest().length,
    `[A-RETRY5] …and one retry run carries both (${JSON.stringify(sb._dirtyKeysForTest())})`);

  // ── 6. AN AUTH-CLASS FAILURE REFRESHES THE SESSION FIRST ────────────────────────────────────
  const t6 = makeFakeTimers();
  let refreshes = 0;
  await hydrated({ who: 'commissioner', timers: t6, refreshSession: async () => { refreshes++; CLIENT = ST._good; } });
  ST._good = CLIENT;
  tbPut('w1__p1', 86);
  CLIENT = failingClient({ code: 'PGRST301', message: 'JWT expired' });
  const m6 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(!bannersSince(m6).length,
    `[A-RETRY6] a JWT-expired write raises no banner on the first attempt (${JSON.stringify(bannersSince(m6))})`);
  assert(t6.count() === 1, '[A-RETRY6] …and arms a retry');
  await captureConsoleAsync(() => t6.runNext());
  assert(refreshes === 1,
    `[A-RETRY6] …the session is refreshed exactly once BEFORE the retry, through the host's own single-flight path (${refreshes})`);
  assert(!sb._dirtyKeysForTest().length && !sb._refusedKeysForTest().length,
    `[A-RETRY6] …and the write then lands (${JSON.stringify(sb._dirtyKeysForTest())}, ${JSON.stringify(sb._refusedKeysForTest())})`);

  // ── 7. A CONFLICT RE-DIFFS AGAINST A FRESH BASE INSTEAD OF GOING RED ───────────────────────
  // A 23505 means the server ALREADY HOLDS the row. Re-sending the same insert is guaranteed to
  // fail the same way; the honest retry is to re-read and diff again, which turns the insert into
  // nothing (or into a patch). This is the shape SECURITY F1 warned a blind 5xx retry would
  // produce, and it is why the 5xx retry above is safe.
  const t7 = makeFakeTimers();
  await hydrated({ who: 'commissioner', timers: t7 });
  const good7 = CLIENT;
  // Make the write an INSERT: the row is absent from the base this hydrate read. This is exactly
  // the shape RG-202's finalize duplicate produced live — a row the client believes is new and the
  // server already holds.
  ST.tiebreaker_guesses = ST.tiebreaker_guesses.filter((x) => x.id !== 'tb_w1__p1');
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  tbPut('w1__p1', 91);
  assert(sb.planFlush().plan.some((o) => o.op === 'insert' && o.key === 'cfbp_tiebreaker_guesses'),
    '[A-RETRY7] fixture — the planned operation really is an INSERT (a patch would prove nothing about 23505)');
  CLIENT = failingClient({ code: '23505', message: 'duplicate key value violates unique constraint "tiebreaker_guesses_pkey"' }, 409);
  const m7 = bannerSeen.length;
  const selectsBefore = good7._calls.selects.length;
  await captureConsoleAsync(() => sb.flush());
  assert(!bannersSince(m7).length,
    `[A-RETRY7] a 23505 raises no banner on the first attempt (${JSON.stringify(bannersSince(m7))})`);
  assert(t7.count() === 1, '[A-RETRY7] …and arms a retry');
  // The row IS on the server, which is what the conflict was telling us.
  ST.tiebreaker_guesses.push(row({ league_id: LEAGUE_A, id: 'tb_w1__p1', week_id: 'w1', member_id: 'p1', guess: 91, updated_at: new Date(NOW).toISOString() }));
  CLIENT = good7;
  await captureConsoleAsync(() => t7.runNext());
  assert(good7._calls.selects.length > selectsBefore,
    '[A-RETRY7] …the retry RE-READS first: a conflict is re-diffed against a fresh base, never blindly re-sent');
  assert(good7._calls.inserts.filter((i) => i.table === 'tiebreaker_guesses').length === 0,
    `[A-RETRY7] …so no duplicate INSERT is issued (${JSON.stringify(good7._calls.inserts.filter((i) => i.table === 'tiebreaker_guesses'))})`);
  assert(!sb._refusedKeysForTest().length && !sb._dirtyKeysForTest().length,
    `[A-RETRY7] …and nothing is left refused or pending (${JSON.stringify(sb._refusedKeysForTest())}, ${JSON.stringify(sb._dirtyKeysForTest())})`);

  // ── 9. F2 — A WEEK-STATUS RPC THAT COMMITTED AND THEN LOST ITS RESPONSE ─────────────────────
  //
  // `finalize_week` raises `bad_transition` when the week is not live (0003_functions.sql:386), and
  // PostgREST hands that back as P0001 with HTTP 400 — class `hard`, so the commissioner got
  // "The server refused to save cfbp_weeks: bad_transition. Nothing was saved." about a week that
  // finalized perfectly. It is the 23505 of the RPC path: the retry of a committed write, judged
  // against the state that write itself produced. It is classified `conflict`, which RE-READS —
  // and the re-read is what distinguishes the two outcomes below, neither of which is assumed.
  {
    // (a) IT DID COMMIT. The server already holds 'final'; the rebase dissolves the operation.
    const t9 = makeFakeTimers();
    await hydrated({ who: 'commissioner', timers: t9 });
    const wk9 = sb.get('cfbp_weeks').map((x) => ({ ...x }));
    wk9.find((x) => x.weekId === 'w2').status = 'final';
    sb.set('cfbp_weeks', wk9);
    ST.weeks.find((w) => w.id === 'w2').status = 'final';     // the lost response: it committed
    const m9 = bannerSeen.length;
    statuses.length = 0;
    await captureConsoleAsync(() => sb.flush());
    assert(!bannersSince(m9).some((t) => /Nothing was saved/.test(t)),
      `[A-RETRY9] (a) a bad_transition on a finalize raises no banner on the first attempt (${JSON.stringify(bannersSince(m9))})`);
    assert(t9.count() === 1, `[A-RETRY9] (a) …it arms a re-read instead (${JSON.stringify(t9.delays())})`);
    await captureConsoleAsync(() => t9.runNext());
    assert(!bannersSince(m9).some((t) => /Nothing was saved/.test(t)),
      `[A-RETRY9] (a) …and the rebase finds the week already final, so the operation vanishes and nothing is reported (${JSON.stringify(bannersSince(m9))})`);
    assert(!sb._refusedKeysForTest().length && !sb._dirtyKeysForTest().includes('cfbp_weeks'),
      `[A-RETRY9] (a) …the run ends CLEAN (${JSON.stringify(sb._refusedKeysForTest())}, ${JSON.stringify(sb._dirtyKeysForTest())})`);
  }
  {
    // (b) IT DID NOT. A genuine bad transition is NEVER silenced by the re-read.
    const t10 = makeFakeTimers();
    await hydrated({ who: 'commissioner', timers: t10 });
    const wk10 = sb.get('cfbp_weeks').map((x) => ({ ...x }));
    wk10.find((x) => x.weekId === 'w2').status = 'final';
    sb.set('cfbp_weeks', wk10);
    ST.weeks.find((w) => w.id === 'w2').status = 'locked';    // another device moved it back
    const m10 = bannerSeen.length;
    await captureConsoleAsync(() => sb.flush());
    let guard = 0;
    while (t10.count() && guard++ < 6) await captureConsoleAsync(() => t10.runNext());
    assert(bannersSince(m10).some((t) => /bad_transition|Nothing was saved|Refusing to finalize/i.test(t)),
      `[A-RETRY9] (b) a GENUINE bad transition still ends RED — the re-read is a check, not a silencer (${JSON.stringify(bannersSince(m10))})`);
    assert(sb._dirtyKeysForTest().includes('cfbp_weeks'),
      `[A-RETRY9] (b) …with the change still queued and still named as unsaved (${JSON.stringify(sb._dirtyKeysForTest())})`);
  }

  // ── 8. THE JITTER IS REAL AND BOUNDED ───────────────────────────────────────────────────────
  const t8 = makeFakeTimers();
  await hydrated({ who: 'commissioner', timers: t8, random: () => 1 });
  tbPut('w1__p1', 88);
  CLIENT = failingClient({ code: '', message: 'Service Unavailable' }, 503);
  await captureConsoleAsync(() => sb.flush());
  assert(t8.delays()[0] > 1000 && t8.delays()[0] <= 1400,
    `[A-RETRY8] the delay carries a bounded jitter term, so six phones do not re-send in lockstep (${JSON.stringify(t8.delays())})`);
});

_realLog(`\n${pass} passed, ${fail} failed, ${SKIPPED.length} skipped.`);
if (fail) _realLog(`Failed: ${failures.join(' | ')}`);
if (RUNTIME_ERRORS.length) {
  _realLog(`Sections that ABORTED (their later assertions never ran, so reds below them may be collateral): ${RUNTIME_ERRORS.join(', ')}`);
}
if (SKIPPED.length) {
  _realLog('Skipped (known gaps — neither pass nor fail; each names its Part B follow-up):');
  for (const s of SKIPPED) _realLog(`  ⏭  ${s.code} — ${s.reason}`);
}
// Flush stdout before exiting (the 34-suite fix from Step 3a pass 8): a
// process.exit() on a piped stdout can truncate the last lines, and a suite
// whose verdict is cut off is indistinguishable from one that crashed.
await new Promise((r) => (process.stdout.write('') ? r() : process.stdout.once('drain', r)));
process.exit(fail > 0 ? 1 : 0);
