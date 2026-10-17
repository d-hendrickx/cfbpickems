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

import { readFileSync, readdirSync } from 'node:fs';
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
// 0046 — the 2K25 ledger's parties, for the fake settle_2025_obligation (static.check pins 0046's SQL list equal to this).
const h2025 = await import('./js/history-2025.js');

// ══════════════════════════════════════════════════════════════════════════
// THE MOCK — a PostgREST-shaped store with RLS-like filtering (§9.1)
// ══════════════════════════════════════════════════════════════════════════

const LEAGUE_A = 'L-aaaa';
const LEAGUE_B = 'L-bbbb';
const NOW = Date.UTC(2026, 8, 20, 18, 0, 0);           // fixed instant; TZ-independent by construction
/** FB-026 — how much later the SERVER'S `now()` is than the client's `createdAt` when finalize_week inserts an
 *  obligation (the debounce plus the round trip). Any non-zero value reproduces the live disagreement. */
const FINALIZE_SERVER_LAG_MS = 1234;

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
  competitions: ['select', 'insert', 'update'],       // 0033 — no delete: competitions are archived, never deleted
  competition_members: ['select', 'insert', 'delete'], // 0033 §5 — inserted or deleted, NEVER updated (D1 DI-531)
};

/** `league_members`' SELECT grant is a COLUMN LIST after 0007, and PostgREST
 *  expands `*` to every column — so `select('*')` on that table is refused for
 *  lack of column privilege, for every caller. The mock enforces it, because
 *  that is a real failure mode the adapter has to avoid (it enumerates the
 *  fifteen columns; `js/supabase-backend.js` SELECT_COLS). */
const COLUMN_GRANTS = {
  // + tournament_only_guest: 0033's additive column grant (DI-403).
  league_members: new Set('league_id,id,user_id,role,legacy_player_id,display_name,initials,alma_mater,active,notify_prefs,preferences,linked_at,extra,created_at,updated_at,tournament_only_guest'.split(',')),
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
    // 0046 — the fake settle_2025_obligation reads `pilot` and `status` (league_active) off this, as 0046 PART D does.
    leagues: [
      { id: LEAGUE_A, pilot: true, status: 'active' },
      { id: LEAGUE_B, pilot: false, status: 'active' },
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
    // Multi-Sport 0033 — the backfill's ONE default competition per league. Starts empty here so the
    // pre-existing sections read exactly what they always read; competitiontest.mjs seeds its own.
    competitions: [],
    // D1 DI-531 — migration 0033 §5: who plays each opt-in sport. Empty here; [A-CM] seeds its own.
    competition_members: [],
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
    // 0033 — `competitions_select/_insert/_update` (the league_active() conjunct is modelled nowhere in
    // this fake: it has no paused leagues).
    competitions: {
      select: (r) => isMember(r.league_id),
      insert: (r) => isCommissioner(r.league_id),
      update: (r) => isCommissioner(r.league_id),
    },
    // D1 DI-531 — 0033 §5. cm_select (a member reads), cm_self_insert (my OWN row, enrolled_by 'self', an opt_in competition that is not archived), cm_commissioner_all (any row).
    // cm_self_delete is modelled as "my own self-enrolled row" (its before-the-first-lock condition is the week/game clock, which this fake does not need: the adapter never plans a self-delete).
    competition_members: {
      select: (r) => isMember(r.league_id),
      insert: (r) => isCommissioner(r.league_id)
        || (r.enrolled_by === 'self' && r.league_member_id === myMemberId(r.league_id)
          && st.competitions.some((c) => c.league_id === r.league_id && c.id === r.competition_id && c.enrollment === 'opt_in' && !c.archived_at)),
      delete: (r) => isCommissioner(r.league_id) || (r.enrolled_by === 'self' && r.league_member_id === myMemberId(r.league_id)),
    },
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
        for (const c of ['role', 'active', 'email', 'phone_verified', 'created_at', 'tournament_only_guest']) {   // + 0033's DI-403 line
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
      // R-19 — TEACH THE FAKE THE REST OF THE GUARD (0002_rls.sql:537-552). The fake stopped at the column list, so any
      // status/paid_at patch from a player passed here, legal or not. The real guard also holds a player to the
      // non-admin rows of obligationNextStatus() (payer unpaid→pending; recipient unpaid→paid, pending→paid,
      // pending→unpaid) and requires paid_at set exactly when the row is paid.
      const me = myMemberId(oldRow.league_id);
      const next = { ...oldRow, ...patch };
      const payer = me === oldRow.payer_member_id, recipient = me === oldRow.recipient_member_id;
      const legal = (payer && oldRow.status === 'unpaid' && next.status === 'pending')
        || (recipient && oldRow.status === 'unpaid' && next.status === 'paid')
        || (recipient && oldRow.status === 'pending' && next.status === 'paid')
        || (recipient && oldRow.status === 'pending' && next.status === 'unpaid');
      if (next.status !== oldRow.status && !legal) return 'obligations: illegal status transition for this role';
      // 0046 — TEACH THE FAKE THE THREE ADDED BLOCKS (0046_r19_obligation_settle.sql PART C), which MUTATE the row the
      // way the real BEFORE trigger mutates NEW: the update loop hands this guard a COPY of the payload, so what the
      // client SENT (CLIENT._calls.updates) stays what it sent.
      //   (a) security F2 — paid_at and denied_reason move only in an UPDATE that also moves the status;
      //   (b) only the recipient gives a reason, and only in pending→unpaid; every other player move clears it;
      //   (c) security F2 — a player's move to paid is dated with the SERVER's clock.
      const same = (a, b) => (a ?? null) === (b ?? null);
      if (next.status === oldRow.status) {
        if (!same(next.paid_at, oldRow.paid_at)) return 'obligations: paid_at may change only with a status change';
        if (!same(next.denied_reason, oldRow.denied_reason)) return 'obligations: denied_reason may change only with a status change';
      }
      if (next.status !== oldRow.status && !(oldRow.status === 'pending' && next.status === 'unpaid')) {
        if (next.denied_reason != null && !same(next.denied_reason, oldRow.denied_reason)) {
          return 'obligations: only the recipient may give a reason, and only when denying';
        }
        patch.denied_reason = null;
        next.denied_reason = null;
      }
      if (next.status === 'paid' && next.status !== oldRow.status) {
        patch.paid_at = new Date(now()).toISOString();
        next.paid_at = patch.paid_at;
      }
      if (next.status === 'paid' && next.paid_at == null) return 'obligations: paid_at required when moving to paid';
      if (next.status !== 'paid' && next.paid_at != null) return 'obligations: paid_at must be null off paid';
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

  /**
   * SB-01 / RG-265 — TEACH THE FAKE: THE SERVER'S ROW CAP, AND THE READ VERBS THAT PAGE AROUND IT.
   *
   * Hosted PostgREST applies a "Max rows" limit to EVERY read (Supabase's default is 1,000) and
   * truncates SILENTLY: HTTP 200, a partial array, no error. The fake used to return every matching
   * row, so a hydrate that never paged looked complete here and could not be caught. Now:
   *   • `maxRows` (default 1,000, the hosted default) caps every select, with or without `.limit()`;
   *     the effective limit is `min(limit, maxRows)`, exactly as PostgREST computes it.
   *   • `.order(col)` sorts, `.gt(col, v)` filters, `.limit(n)` / `.range(a, b)` page — and the sort
   *     and the `gt` use ONE comparator, which is the property Postgres gives `ORDER BY id` and
   *     `id > $1` under the same collation, and the one keyset paging depends on.
   *   • `select(cols, { count: 'exact' })` answers `count` = every row the filters and the policy
   *     admit, BEFORE the limit — computed in the same call as the page, as PostgREST computes it in
   *     the same statement. Without the option `count` is `null`, as supabase-js reports it.
   *   • `dropCount` models a proxy that strips Content-Range (so `count` is `null` even when asked
   *     for); `ignoreGt` models a server that ignores the keyset filter and hands back the first
   *     page again — the shape a paging loop must refuse rather than spin on.
   * With no `.order()` the fake returns rows in store order, which is what a heap scan does most
   * of the time and all the unordered hydrate ever had.
   */
  const MAX_ROWS = typeof opts.maxRows === 'number' ? opts.maxRows : 1000;   // Infinity = an uncapped server
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /**
   * SB-01 pass 2 (security S-C1) — THE GATEWAY'S URL LIMIT, and the URL the SDK would really send.
   *
   * supabase-js appends every filter with `url.searchParams.append(col, 'gt.' + value)` (form-
   * urlencoding) and `.range()` sets `offset`/`limit`; the URL below is built the same way, so its
   * length is the length the gateway judges. Past `maxUrl` (default 16,384 — Cloudflare's limit)
   * the request never reaches PostgREST: it is answered 414 with an HTML body, which the SDK hands
   * back as `{ message: <the HTML> }` with no code (its non-JSON error branch). Also modelled:
   *   • `beforeSelect(b)` — runs as a select is served, so a test can move the table BETWEEN two
   *     pages of one read (a concurrent insert/delete) deterministically;
   *   • `capFor(table, n)` — a per-request cap (the n-th select of that table), for a server whose
   *     Max rows changes mid-read;
   *   • `inflateCount` — tables whose count claims one row more than exists (a read that can never
   *     be proven complete);
   *   • `gatewayHtml` — tables whose every select is answered by the gateway's 414 page.
   */
  const MAX_URL = typeof opts.maxUrl === 'number' ? opts.maxUrl : 16384;
  const perTableSelects = new Map();
  const GATEWAY_414 = '<html><head><title>414 Request-URI Too Large</title></head><body><center><h1>414 Request-URI Too Large</h1></center><hr><center>cloudflare</center></body></html>';
  function requestUrl(b) {
    const u = new URL(`https://proj.supabase.test/rest/v1/${b._table}`);
    u.searchParams.set('select', String(b._cols).replace(/\s/g, ''));
    for (const [c, v] of b._eq) u.searchParams.append(c, `eq.${v}`);
    for (const [c, v] of b._gt) u.searchParams.append(c, `gt.${v}`);
    if (b._order) u.searchParams.set('order', `${b._order.col}.${b._order.ascending ? 'asc' : 'desc'}`);
    if (b._ranged) u.searchParams.set('offset', String(b._offset));
    if (b._limit !== null) u.searchParams.set('limit', String(b._limit));
    return u.toString();
  }

  function builder(table) {
    const b = {
      _table: table, _eq: [], _in: [], _gt: [], _op: 'select', _cols: '*', _payload: null, _returning: false, _retCols: '*',
      _order: null, _limit: null, _offset: 0, _ranged: false, _count: null,
      select(cols, selOpts) {
        if (b._op === 'select') { b._cols = cols || '*'; b._count = (selOpts && selOpts.count) || null; }
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
      gt(col, val) { b._gt.push([col, val]); return b; },
      order(col, o) { b._order = { col, ascending: !(o && o.ascending === false) }; return b; },
      limit(n) { b._limit = n; return b; },
      range(from, to) { b._ranged = true; b._offset = from; b._limit = to - from + 1; return b; },
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
    return b._eq.every(([c, v]) => r[c] === v) && b._in.every(([c, vs]) => vs.includes(r[c]))
      && (opts.ignoreGt || b._gt.every(([c, v]) => cmp(r[c], v) > 0));
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
      const url = requestUrl(b);
      calls.selects.push({ table, cols: b._cols, eq: b._eq.slice(), gt: b._gt.slice(), order: b._order, limit: b._limit,
        offset: b._ranged ? b._offset : null, count: b._count, urlLength: url.length });
      // THE GATEWAY answers before PostgREST sees anything: an over-long URL, or a table the test
      // has put behind a failing edge, is a 414 with an HTML body and no PostgREST code.
      if (url.length > MAX_URL || (opts.gatewayHtml && opts.gatewayHtml.includes(table))) {
        return { data: null, count: null, status: 414, statusText: 'URI Too Long', error: { message: GATEWAY_414 } };
      }
      const nth = (perTableSelects.get(table) || 0) + 1;
      perTableSelects.set(table, nth);
      if (opts.beforeSelect) opts.beforeSelect(b, nth);
      // A RUNAWAY BREAKER, not a model of anything: a paging loop that fails to terminate against
      // `ignoreGt` would otherwise spin on resolved promises and HANG the suite (microtasks starve
      // every timer), which reads as "the harness broke" rather than as a red. Past this many
      // requests the fake answers with an error the assertions can see was NOT the adapter's own.
      if (calls.selects.length > 2000) return { data: null, error: { code: 'TEST_RUNAWAY', message: 'fake: runaway paging loop' } };
      // A PARTIAL READ — the transport artifact RG-12 defence (b) exists for:
      // a 200 that carries no rows for a table that has them. Modelled as an
      // override rather than by emptying the store, so `is_member()` and the
      // RPCs keep answering truthfully (an emptied league_members would make
      // the caller a non-member and the test would prove something else).
      if (opts.emptySelects && opts.emptySelects.includes(table)) return { data: [], error: null };
      // A SELECT THAT FAILS FOR ONE TABLE ONLY (2026-09-30, [A-MS2]) — every other table answers normally.
      // This is the shape of "the client shipped before its migration": PostgREST answers 404 / PGRST205
      // ("Could not find the table 'public.competitions' in the schema cache") for the one table the new
      // client reads and the database does not have yet. `failSelects` fails EVERY table, which cannot
      // distinguish "the competitions read failed" from "the whole hydrate failed".
      if (opts.failTables && opts.failTables[table]) {
        const f = opts.failTables[table];
        const res = { data: null, error: { code: f.code, message: f.message } };
        if (f.status) res.status = f.status;
        return res;
      }
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
      // SB-01 — order, then offset/limit under the server's cap (see MAX_ROWS above).
      if (b._order) {
        const { col, ascending } = b._order;
        rows.sort((x, y) => (ascending ? 1 : -1) * cmp(x[col], y[col]));
      }
      const total = rows.length + (opts.inflateCount && opts.inflateCount.includes(table) ? 1 : 0);
      const cap = opts.capFor ? opts.capFor(table, nth) : MAX_ROWS;
      const limit = Math.min(b._limit === null ? Infinity : b._limit, cap);
      const page = rows.slice(b._offset, b._offset + limit);
      const counted = b._count === 'exact' && !opts.dropCount;
      return {
        data: page.map((r) => ({ ...r })),
        error: null,
        count: counted ? total : null,
        status: counted && page.length < total ? 206 : 200,
      };
    }

    if (b._op === 'insert') {
      calls.inserts.push({ table, rows: b._payload });
      // D1 DI-531 — competition_members.id is GENERATED ALWAYS (0033 §5): a value for it is refused BEFORE any policy runs (Postgres 428C9), and the stored row computes it. joined_at takes
      // its column default (the server's now()) when the request names none.
      if (table === 'competition_members') {
        for (const r of b._payload) {
          if ('id' in r) return { data: null, status: 400, error: { code: '428C9', message: 'cannot insert a non-DEFAULT value into column "id"', details: 'Column "id" is a generated column.' } };
        }
        b._payload = b._payload.map((r) => ({ ...r, id: `${r.competition_id}:${r.league_member_id}`, joined_at: r.joined_at ?? new Date(NOW).toISOString() }));
      }
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
        // A COPY: a BEFORE trigger may rewrite NEW (0046's obligations_guard does), and what the client SENT stays in
        // calls.updates unchanged. Guards that do not mutate behave exactly as before.
        const applied = { ...b._payload };
        if (g) { const msg = g(r, applied, flags); if (msg) return refuse(msg); }
        // 0046 PART A — the CHECK obligations_denied_reason_shape (null, or 1-200 characters, not blank, none of the
        // refused class), raised as Postgres raises a CHECK violation: 23514, the whole statement refused.
        if (table === 'obligations' && 'denied_reason' in applied && applied.denied_reason != null) {
          const v = applied.denied_reason;
          const ok = typeof v === 'string' && [...v].length >= 1 && [...v].length <= 200 && v.replace(/^ +| +$/g, '') !== ''
            && !/[\u0001-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/.test(v);
          if (!ok) return { data: null, error: { code: '23514', message: 'new row for relation "obligations" violates check constraint "obligations_denied_reason_shape"' } };
        }
        Object.assign(r, applied);
        // FB-005 — TEACH THE FAKE: scribe_guard's MIRROR-SYNC (0024_scribe_learn.sql:162, :171, :182). The real
        // BEFORE UPDATE trigger rewrites the payload's copy of the flip column (and of `origin`) from the column
        // on every update, and the payload is what `fromRows` hands the client — so an approval reads back as
        // approved after a refresh ONLY because of this. The fake never did it, so a refresh read a stale copy.
        if (table === 'scribe_learnings' || table === 'scribe_canon') {
          const p = { ...(r.payload || {}) };
          if (table === 'scribe_learnings') p.status = r.status; else p.approvalStatus = r.approval_status;
          if ('origin' in r) p.origin = r.origin ?? null;
          r.payload = p;
        }
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
    // 0046 PART D — TEACH THE FAKE settle_2025_obligation, rule for rule: the caller's own ACTIVE seat (my_member_id), the
    // PILOT league only, not paused, one of the fifteen 2K25 rows, the caller party to it, one of the four non-admin moves
    // (obligationNextStatus), then ONE key of settings.ob2025 (absent = unpaid; legacy `true` = paid). Returns the row.
    settle_2025_obligation({ p_league, p_obligation, p_action }) {
      const raise = (code, message) => ({ data: null, error: { code, message } });
      if (!session.authenticated) return raise('28000', 'not_authenticated');
      const me = myMemberId(p_league);
      if (!me) return raise('42501', 'not_member');
      const lg = (st.leagues || []).find((l) => l.id === p_league);
      if (!lg || !lg.pilot) return raise('42501', 'not_pilot');
      if (lg.status !== 'active') return raise('42501', 'league_paused');
      if (!['mark', 'confirm', 'deny'].includes(p_action)) return raise('22023', 'bad_action');
      const ob = h2025.season2025Obligations().find((r) => r.obligationId === p_obligation);
      if (!ob) return raise('22023', 'not_found');
      if (me !== ob.payerPlayerId && me !== ob.recipientPlayerId) return raise('42501', 'not_party');
      let kv = st.league_kv.find((r) => r.league_id === p_league && r.key === 'settings');
      const value = kv && kv.value && typeof kv.value === 'object' ? kv.value : {};
      const map = value.ob2025 && typeof value.ob2025 === 'object' && !Array.isArray(value.ob2025) ? { ...value.ob2025 } : {};
      const raw = map[p_obligation];
      const cur = raw === true ? 'paid' : (raw === 'pending' || raw === 'paid') ? raw : 'unpaid';
      const next = (p_action === 'mark' && cur === 'unpaid' && me === ob.payerPlayerId) ? 'pending'
        : (p_action === 'mark' && cur === 'unpaid' && me === ob.recipientPlayerId) ? 'paid'
        : (p_action === 'confirm' && cur === 'pending' && me === ob.recipientPlayerId) ? 'paid'
        : (p_action === 'deny' && cur === 'pending' && me === ob.recipientPlayerId) ? 'unpaid' : null;
      if (!next) return raise('42501', 'illegal_transition');
      if (next === 'unpaid') delete map[p_obligation]; else map[p_obligation] = next;
      const newValue = { ...value, ob2025: map };
      if (!kv) { kv = row({ league_id: p_league, key: 'settings', value: newValue }); st.league_kv.push(kv); }
      else kv.value = newValue;
      kv.updated_at = new Date(now()).toISOString();
      kv.updated_by = session.userId;
      return { data: { obligationId: p_obligation, status: next, row: { ...kv } }, error: null };
    },
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
      // FB-026 — TEACH THE FAKE: THE REAL OBLIGATIONS INSERT (0026_b_roles_pilot.sql:2255-2264, the live body).
      // The fake used to write a row that looked exactly like the client's projection, so the defect could not
      // exist here. The real statement does two things the client's `toRows` does not:
      //   • it names no `created_at`, so the column DEFAULT (`now()`, 0001_schema.sql:315) stamps the SERVER'S
      //     clock — always later than the client's `createdAt` (the 800 ms debounce plus the round trip);
      //   • its `extra` is the payload minus NINE typed keys, so the seven other typed fields the client sends
      //     (createdAt, paidAt, voided, voidedAt, voidReason, mergedInto, mergedFrom) land in `extra` too, as
      //     SHADOWS of real columns. The columns themselves take their DEFAULTS.
      // Both are modelled exactly. `FINALIZE_SERVER_LAG_MS` is the stand-in for "the server's clock at insert".
      const FINALIZE_TYPED = ['obligationId', 'type', 'weekId', 'payerPlayerId', 'recipientPlayerId', 'amountOrPrize', 'status', 'needsReview', 'reviewNote'];
      for (const o of p_obligations || []) {
        if (st.obligations.some((x) => x.league_id === p_league && x.id === o.obligationId)) continue;
        const extra = { ...o };
        for (const k of FINALIZE_TYPED) delete extra[k];
        st.obligations.push({ league_id: p_league, id: o.obligationId, type: o.type || 'weekly', week_id: p_week, payer_member_id: o.payerPlayerId, recipient_member_id: o.recipientPlayerId, amount_or_prize: o.amountOrPrize || '', status: o.status || 'unpaid', needs_review: !!o.needsReview, review_note: o.reviewNote ?? null,
          created_at: new Date(now() + FINALIZE_SERVER_LAG_MS).toISOString(), paid_at: null, voided: false, voided_at: null, void_reason: null, merged_into: null, merged_from: [],
          extra });
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
  failTables = null, timers = null, refreshSession = null, random = null,
  maxRows = undefined, dropCount = false, ignoreGt = false,
  maxUrl = undefined, beforeSelect = null, capFor = null, inflateCount = null, gatewayHtml = null, server = null } = {}) {
  sb._resetForTest();
  store.clear();
  statuses.length = 0;
  bannerSeen.length = 0;
  detailSeen.length = 0;
  // 0046 — `server`: the SAME server, signed into by a different session (the stale-reason test walks commissioner -> payer ->
  // commissioner over one set of rows). Every other caller gets a fresh store, exactly as before.
  ST = server || makeStore();
  const session = SESSIONS[who];
  CLIENT = makeClient(ST, session, { rpcOverride, emptySelects, failTables, maxRows, dropCount, ignoreGt, maxUrl, beforeSelect, capFor, inflateCount, gatewayHtml });
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
  // 15 = 0007's list; +1 = 0033's additive `tournament_only_guest` column grant (DI-403). Named, not just counted.
  assert(selects[0].cols.split(',').length === 16 && selects[0].cols.split(',').includes('tournament_only_guest'),
    'and the list is 0007’s fifteen columns plus 0033’s tournament_only_guest');
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
await section('\n[A5b] RG-251 — a status diff that SKIPS a leg is refused, and the server-confirmed status is readable…', async () => {
  // RG-251 (game day 2026-09-26): tickAutoTransition() wrote open->live in ONE save. The refusal
  // below is the guard that caught it, and it is KEPT — the fix is in the caller (one leg per tick)
  // and in the caller's reading of `getConfirmedWeekStatus()`, never in widening this list.
  const legsOf = (plan) => plan.filter((o) => o.kind === 'finalize'
    || (o.kind === 'rpc' && (o.name === 'lock_week' || o.name === 'transition_week')));
  const atServer = async (status) => {
    initAdapter({ who: 'commissioner' });
    ST.weeks.find((w) => w.id === 'w1').status = status;
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  };
  const moveMirror = (status) => {
    const weeks = sb.get('cfbp_weeks').map((w) => ({ ...w }));
    weeks.find((w) => w.weekId === 'w1').status = status;
    sb.set('cfbp_weeks', weeks);
  };

  // (1) THE GUARD, KEPT — every diff that is two or more legs from the server's status is refused
  //     client-side, with the server's own error name, and sends nothing for the week.
  for (const [from, to] of [['open', 'live'], ['draft', 'locked'], ['draft', 'live'], ['open', 'final'], ['locked', 'final'], ['draft', 'final']]) {
    await atServer(from);
    moveMirror(to);
    const r = sb.planFlush();
    assert(r.refusals.length === 1 && r.refusals[0].code === 'bad_transition' && !legsOf(r.plan).length,
      `[A5b] ${from} -> ${to} skips a leg: refused CLIENT-SIDE as bad_transition, no status RPC planned (refusals ${JSON.stringify(r.refusals.map((e) => e.code))}, legs ${legsOf(r.plan).length})`);
  }
  // (2) CONTROL — the single legs a one-leg-per-tick caller produces are each ONE RPC, nothing refused.
  for (const [from, to, name] of [['open', 'locked', 'lock_week'], ['locked', 'live', 'transition_week'], ['live', 'final', 'finalize']]) {
    await atServer(from);
    moveMirror(to);
    const r = sb.planFlush();
    const legs = legsOf(r.plan);
    assert(!r.refusals.length && legs.length === 1 && (legs[0].name || legs[0].kind) === name,
      `[A5b] ${from} -> ${to} (one leg) plans exactly one ${name} and refuses nothing (got ${JSON.stringify(legs.map((o) => o.name || o.kind))})`);
  }

  // (3) getConfirmedWeekStatus() — the status the SERVER last confirmed, never the mirror's.
  assert(typeof sb.getConfirmedWeekStatus === 'function', '[A5b] the adapter exports getConfirmedWeekStatus()');
  if (typeof sb.getConfirmedWeekStatus !== 'function') return;
  await atServer('open');
  assert(sb.getConfirmedWeekStatus('w1') === 'open', '[A5b] after a hydrate it reports the server\'s status (open)');
  assert(sb.getConfirmedWeekStatus('no-such-week') === null, '[A5b] an unknown week is null — the caller falls back to the mirror');
  moveMirror('live');
  assert(sb.getConfirmedWeekStatus('w1') === 'open' && sb.get('cfbp_weeks').find((w) => w.weekId === 'w1').status === 'live',
    '[A5b] with an unsent status in the mirror it still reports OPEN — the mirror says live, the server does not');
  await captureConsoleAsync(() => sb.flush());
  assert(sb.getConfirmedWeekStatus('w1') === 'open' && ST.weeks.find((w) => w.id === 'w1').status === 'open'
    && sb.get('cfbp_weeks').find((w) => w.weekId === 'w1').status === 'live',
    '[A5b] after the refusal: server OPEN, confirmed OPEN, and the mirror STILL says live (the polluted state RG-251 left on the commissioner\'s device — the caller must read around it)');
  // Recovery in-app: re-save the ONE leg the server allows, then Retry (a re-hydrate) releases the
  // block the refusal set, and lock_week lands.
  moveMirror('locked');
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  await captureConsoleAsync(() => sb.flush());
  assert(ST.weeks.find((w) => w.id === 'w1').status === 'locked' && sb.getConfirmedWeekStatus('w1') === 'locked',
    `[A5b] re-saving LOCKED and a re-hydrate (Retry) sends lock_week from the real base, and the confirmed status advances (server ${ST.weeks.find((w) => w.id === 'w1').status}, confirmed ${sb.getConfirmedWeekStatus('w1')})`);
  captureConsole(() => sb._resetForTest());
  assert(sb.getConfirmedWeekStatus('w1') === null, '[A5b] with no hydrated mirror it is null, never a stale guess');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-N1] SECURITY N-1 (0045 delta) — getConfirmedMemberRole(): the role the SERVER served, for the hydrated league\'s ACTIVE members only…', async () => {
  // The chat relay (js/notifications.js, via app.js's setMemberRoleSource) grants a COMMISSIONER_ANNOUNCEMENT its never-silenceable push only
  // when this answers 'commissioner' for the row's league and author. Every other answer is null, and the relay fails CLOSED on it.
  assert(typeof sb.getConfirmedMemberRole === 'function', '[A-N1] the adapter exports getConfirmedMemberRole()');
  if (typeof sb.getConfirmedMemberRole !== 'function') return;
  captureConsole(() => sb._resetForTest());
  assert(sb.getConfirmedMemberRole(LEAGUE_A, 'p1') === null, '[A-N1] with no hydrated mirror it is null (the relay fails closed until a hydrate lands)');
  await hydrated();
  assert(sb.getConfirmedMemberRole(LEAGUE_A, 'p1') === 'commissioner' && sb.getConfirmedMemberRole(LEAGUE_A, 'p2') === 'player',
    `[A-N1] after a hydrate it reports the base row's role: p1 commissioner, p2 player (got ${sb.getConfirmedMemberRole(LEAGUE_A, 'p1')}, ${sb.getConfirmedMemberRole(LEAGUE_A, 'p2')})`);
  assert(sb.getConfirmedMemberRole(LEAGUE_B, 'q1') === null && sb.getConfirmedMemberRole(LEAGUE_A, 'q1') === null,
    '[A-N1] another league is null (this mirror holds league A only, so B\'s commissioner is not vouched for), and so is a member id A does not have');
  // reviewer gap (38f65a98): the LEAGUE check on its own — p1 IS a commissioner in this mirror's base rows, asked about under league B's id
  assert(sb.getConfirmedMemberRole(LEAGUE_B, 'p1') === null && sb.getConfirmedMemberRole('L-zzzz', 'p1') === null,
    '[A-N1] a member id this mirror holds, asked under ANOTHER league\'s id, is null: the role is vouched for only in the league the base rows came from');
  assert(sb.getConfirmedMemberRole('', 'p1') === null && sb.getConfirmedMemberRole(LEAGUE_A, '') === null && sb.getConfirmedMemberRole(null, 'p1') === null
    && sb.getConfirmedMemberRole(LEAGUE_A, 'scribe') === null,
    '[A-N1] an empty or missing league or author is null, and so is SCRIBE (not a member)');
  // the attacker's shape on THIS device: the mirror (member-writable, and the thing a forged client would edit) says p2 is a commissioner
  captureConsole(() => sb.set('cfbp_players', sb.get('cfbp_players').map((pl) => (pl.playerId === 'p2' ? { ...pl, role: 'commissioner', isAdmin: true } : pl))));
  assert(sb.getConfirmedMemberRole(LEAGUE_A, 'p2') === 'player',
    '[A-N1] a mirror edit that claims p2 is a commissioner changes nothing: the answer is the SERVER\'s base row, never the mirror');
  // a deactivated commissioner (public.is_commissioner()'s `m.active` conjunct)
  captureConsole(() => sb._resetForTest());
  initAdapter();
  // p3 (not this session's seat) is made a commissioner and deactivated, server-side
  Object.assign(ST.league_members.find((m) => m.league_id === LEAGUE_A && m.id === 'p3'), { role: 'commissioner', active: false });
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  assert(sb.getState() === 'ACTIVE' && sb.getConfirmedMemberRole(LEAGUE_A, 'p3') === null && sb.getConfirmedMemberRole(LEAGUE_A, 'p1') === 'commissioner',
    `[A-N1] a DEACTIVATED commissioner is null (fails closed), as is_commissioner() would answer, over a hydrate that LANDED (p1 still reads commissioner; state ${sb.getState()})`);
  captureConsole(() => sb._resetForTest());
  assert(sb.getConfirmedMemberRole(LEAGUE_A, 'p1') === null, '[A-N1] and after a reset it is null again, never a stale answer');
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A5c] RG-253 (SEC-2) — a week-status change is COMPARE-AND-SET: a leg made against one server status is never replayed over another…', async () => {
  // SECURITY SEC-2 on dac4891. A hydrate re-applies a pending status edit over the fresh base
  // (hydrate()'s rebase), and so does a Realtime fold (RG-252). The planner diffed base against
  // mirror, so a phone that pressed Go Live against LOCKED and slept while another device took the
  // week live and then FINAL woke up to plan final->live — which transition_week() allows — and
  // reopened a finalized week. Now each leg carries the status it was made against; a moved base
  // is refused LOUDLY and the server's status is taken.
  const w1 = () => ST.weeks.find((w) => w.id === 'w1');
  const mirrorW1 = () => sb.get('cfbp_weeks').find((w) => w.weekId === 'w1');
  const setW1 = (patch) => sb.set('cfbp_weeks', sb.get('cfbp_weeks').map((w) => (w.weekId === 'w1' ? { ...w, ...patch } : { ...w })));
  const legs = (plan) => plan.filter((o) => o.kind === 'finalize' || (o.kind === 'rpc' && (o.name === 'lock_week' || o.name === 'transition_week')));
  const atServer = async (status) => {
    initAdapter({ who: 'commissioner' });
    w1().status = status;
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  };

  // (1) THE REPRODUCTION — pending live over LOCKED; the server goes live and then final elsewhere.
  await atServer('locked');
  setW1({ status: 'live' });                                             // Go Live, not yet flushed
  w1().status = 'final'; w1().finalized_at = new Date(NOW).toISOString(); // another device: locked->live->final
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  assert(mirrorW1().status === 'live' && sb.getConfirmedWeekStatus('w1') === 'final',
    '[A5c] (1) fixture: the wake-up hydrate re-applied the pending LIVE over a FINAL base (this IS the replay SEC-2 names)');
  const r1 = captureConsole(() => sb.planFlush());
  assert(!legs(r1.plan).length && r1.refusals.some((e) => e.code === 'status_moved'),
    `[A5c] (1) the planner sends NO final->live transition — the leg is refused as status_moved (legs ${JSON.stringify(legs(r1.plan).map((o) => o.name || o.kind))}, refusals ${JSON.stringify(r1.refusals.map((e) => e.code))})`);
  const b1 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(w1().status === 'final', `[A5c] (1) the finalized week is NOT reopened (server ${w1().status})`);
  assert(mirrorW1().status === 'final', `[A5c] (1) the mirror takes the server's FINAL (mirror ${mirrorW1().status})`);
  assert(bannerSeen.length > b1 && /is now final/.test(bannerSeen[bannerSeen.length - 1]),
    `[A5c] (1) …LOUDLY: the red banner says the week is now final and the change was not applied (${bannerSeen[bannerSeen.length - 1]})`);
  assert(!CLIENT._calls.rpc.some((c) => c.name === 'transition_week'), '[A5c] (1) no transition_week RPC ever reached the server');

  // (2) CONTROL — the same pending leg over an UNMOVED base is sent, through the same hydrate.
  await atServer('locked');
  setW1({ status: 'live' });
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  await captureConsoleAsync(() => sb.flush());
  assert(w1().status === 'live' && !sb._refusedKeysForTest().length,
    `[A5c] (2) control: a pending leg whose base did NOT move still goes out after a hydrate (server ${w1().status})`);

  // (3) CONTROL — the user's OWN chain across an acknowledged leg is not a "move".
  await atServer('open');
  setW1({ status: 'locked' });
  await captureConsoleAsync(() => sb.flush());
  setW1({ status: 'live' });                                             // pressed after the lock landed
  const r3 = captureConsole(() => sb.planFlush());
  assert(!r3.refusals.length && legs(r3.plan).length === 1 && legs(r3.plan)[0].name === 'transition_week',
    `[A5c] (3) control: Lock landed, then Go Live — one transition_week from the acknowledged LOCKED, nothing refused (refusals ${JSON.stringify(r3.refusals.map((e) => e.code))})`);

  // (4) THE SNAPSHOT BOOT (reviewer F1 / SEC-3) — a leg written while ACTIVE-STALE is made against
  //     the SNAPSHOT's status. Here: snapshot OPEN, a Lock written before the hydrate, and meanwhile
  //     the server went LIVE. Replayed, that is live->locked (allowed) — a live week PAUSED by a
  //     phone that never saw it go live.
  await atServer('open');
  const snap = localStorage.getItem(sb._snapshotKeyForTest());
  assert(!!snap, '[A5c] (4) fixture: an OPEN snapshot exists');
  initAdapter({ who: 'commissioner' });
  localStorage.setItem(sb._snapshotKeyForTest(), snap);
  captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_A));
  assert(sb.getState() === 'ACTIVE-STALE' && mirrorW1().status === 'open', '[A5c] (4) fixture: ACTIVE-STALE, painting the OPEN snapshot');
  setW1({ status: 'locked' });                                           // the boot tick's lock, held
  w1().status = 'live'; w1().revealed_at = new Date(NOW).toISOString();   // the server, meanwhile
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  const r4 = captureConsole(() => sb.planFlush());
  assert(!legs(r4.plan).length && r4.refusals.some((e) => e.code === 'status_moved'),
    `[A5c] (4) the held lock is NOT replayed as live->locked over the server's LIVE (legs ${JSON.stringify(legs(r4.plan).map((o) => o.name))}, refusals ${JSON.stringify(r4.refusals.map((e) => e.code))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(w1().status === 'live' && mirrorW1().status === 'live', `[A5c] (4) the live week stays LIVE, on the server and on this device (server ${w1().status}, mirror ${mirrorW1().status})`);

  // (5) REVIEWER F5 — the refusal aborts planning for the WHOLE cfbp_weeks key; the OTHER week's
  //     queued edit must still go out (one follow-up run), and the emit must carry what the app needs
  //     to repaint and to word the notice (code, key, the moved rows — never only the storage key).
  await atServer('locked');
  setW1({ status: 'live' });                                             // pending leg, made against LOCKED
  sb.set('cfbp_weeks', sb.get('cfbp_weeks').map((w) => (w.weekId === 'w2' ? { ...w, blurb: 'queued with it' } : { ...w })));
  w1().status = 'final';                                                 // the server moved w1 elsewhere
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  const d5 = detailSeen.length;
  await captureConsoleAsync(() => sb.flush());
  const ref5 = detailSeen.slice(d5).find(([s, d]) => s === 'refused' && d && d.code === 'status_moved');
  assert(!!ref5 && ref5[1].key === 'cfbp_weeks' && Array.isArray(ref5[1].moved) && ref5[1].moved[0].id === 'w1'
    && ref5[1].moved[0].server === 'final' && ref5[1].moved[0].local === 'live',
    `[A5c] (5) the refused emit carries code status_moved, the key and the moved rows (${JSON.stringify(ref5 && { key: ref5[1].key, code: ref5[1].code, moved: ref5[1].moved })})`);
  await captureConsoleAsync(() => new Promise((r) => setTimeout(r, 20)));
  const w2s = ST.weeks.find((w) => w.id === 'w2');
  assert(w2s.blurb === 'queued with it' && w1().status === 'final',
    `[A5c] (5) one follow-up run sends the OTHER week's queued edit, and w1 stays FINAL (w2 blurb ${JSON.stringify(w2s.blurb)}, w1 ${w1().status})`);
  assert(!sb._dirtyKeysForTest().includes('cfbp_weeks'), `[A5c] (5) …and the key is clean afterwards (dirty ${JSON.stringify(sb._dirtyKeysForTest())})`);
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

/**
 * THE SCHEMA, READ FROM EVERY MIGRATION IN ORDER (RG-TBD-N14, 2026-09-29).
 *
 * `table -> Map(column -> { name, notNull, def })`, where `def` is the DEFAULT's SQL text or null.
 * `create table [if not exists] public.X (…)`, then every `alter table public.X add column …`,
 * `alter column … set|drop not null` and `alter column … set|drop default` in file order. Comments
 * are blanked first — 0024 carries a commented-out ROLLBACK block (`-- alter table … drop column`)
 * that must not be read as schema. A parser that finds nothing proves nothing, so [A-NN] asserts it
 * read both a 0001 column and a 0028 `add column` before anything is compared against it.
 */
function schemaFromMigrations() {
  const dir = join(__dirname, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => /^\d{4}_[^/]*\.sql$/.test(f)).sort();
  const schema = {};
  const colDef = (text) => {
    const line = String(text).trim();
    const mm = /^([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
    if (!mm || ['primary', 'foreign', 'unique', 'check', 'constraint', 'exclude'].includes(mm[1].toLowerCase())) return null;
    const d = /\bdefault\s+('(?:[^']|'')*'(?:::[a-z_]+(?:\[\])?)?|[a-z_]+\(\)|-?\d+(?:\.\d+)?|true|false|null)/i.exec(line);
    return { name: mm[1], notNull: /\bnot null\b/i.test(line), def: d ? d[1] : null };
  };
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      const cols = (schema[m[1]] = schema[m[1]] || new Map());
      for (const raw of m[2].split('\n')) { const c = colDef(raw.replace(/,\s*$/, '')); if (c) cols.set(c.name, c); }
    }
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:only )?public\.([a-z_]+)\s+(add column[^;]*);/gi)) {
      if (!schema[m[1]]) continue;
      for (const part of m[2].split(/,\s*(?=add column\b)/i)) {
        const c = colDef(part.replace(/^add column\s+(?:if not exists\s+)?/i, ''));
        if (c && !schema[m[1]].has(c.name)) schema[m[1]].set(c.name, c);
      }
    }
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:only )?public\.([a-z_]+)\s+alter column ([a-z_]+)\s+(set|drop) not null/gi)) {
      const c = schema[m[1]] && schema[m[1]].get(m[2]);
      if (c) c.notNull = m[3].toLowerCase() === 'set';
    }
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:only )?public\.([a-z_]+)\s+alter column ([a-z_]+)\s+(?:set default\s+('(?:[^']|'')*'(?:::[a-z_]+)?|[a-z_]+\(\)|-?\d+(?:\.\d+)?|true|false)|drop default)/gi)) {
      const c = schema[m[1]] && schema[m[1]].get(m[2]);
      if (c) c.def = m[3] || null;
    }
  }
  return schema;
}

/** A DEFAULT's SQL text as the value the server would store. `now()` is the suite's fixed instant; a
 *  function this does not evaluate comes back as a marker string — still NOT NULL, which is all the
 *  constraint check needs. */
function evalSqlDefault(def) {
  if (def == null || /^null$/i.test(def)) return null;
  if (/^true$/i.test(def)) return true;
  if (/^false$/i.test(def)) return false;
  if (/^-?\d/.test(def)) return Number(def);
  if (/^now\(\)$/i.test(def)) return new Date(NOW).toISOString();
  const s = /^'((?:[^']|'')*)'(?:::([a-z_]+))?/i.exec(def);
  if (s) { const v = s[1].replace(/''/g, "'"); return /^jsonb?$/i.test(s[2] || '') ? JSON.parse(v) : v; }
  return `<default ${def}>`;
}

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-NN] the planner NEVER sends null into a NOT NULL column (live cutover defect, 2026-09-19)…', async () => {
  // (1) The map is the SCHEMA's. Derive it from EVERY migration (not 0001 alone — RG-170's filed
  //     follow-up, closed by RG-TBD-N14 on 2026-09-29: 0024 had added three NOT NULL columns this
  //     check could not see) and fail on drift — a NOT NULL column with a default that this list
  //     does not name is exactly the column whose null would refuse a whole row.
  const SCHEMA = schemaFromMigrations();
  const mapped = sb._notNullColsForTest();
  assert(Object.keys(mapped).length >= 15, `[A-NN] fixture: the map covers the routed tables (got ${Object.keys(mapped).length})`);
  assert(Object.keys(SCHEMA).length >= 15 && SCHEMA.games && SCHEMA.games.has('spread_source') && SCHEMA.games.has('home_logo'),
    `[A-NN] fixture: the migration parser read 0001's tables AND a later migration's add column (games.home_logo, 0028) — ${Object.keys(SCHEMA).length} tables`);
  const routedTables = [...new Set(Object.values(sb._routesForTest()).map((r) => r && r.table).filter(Boolean))];
  for (const t of routedTables) {
    assert(Array.isArray(mapped[t]), `[A-NN] every ROUTED table has a NOT_NULL_COLS entry (${t})`);
  }
  for (const [table, cols] of Object.entries(mapped)) {
    const derived = SCHEMA[table] ? [...SCHEMA[table].values()].filter((c) => c.notNull).map((c) => c.name).sort() : null;
    const have = [...cols].sort();
    assert(!!derived && JSON.stringify(derived) === JSON.stringify(have),
      `[A-NN] NOT_NULL_COLS.${table} equals the NOT NULL columns ALL migrations declare (derived ${derived && derived.length}, mapped ${cols.length}`
      + `${derived ? `; missing from map: ${JSON.stringify(derived.filter((c) => !have.includes(c)))}; extra in map: ${JSON.stringify(have.filter((c) => !derived.includes(c)))}` : ''})`);
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

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-NN2] a MULTI-ROW insert never turns an omitted NOT NULL column into NULL — through the REAL SDK (live, 2026-09-29, games.spread_source)…', async () => {
  // THE LIVE DEFECT (RG-TBD-N14). Drew's device, v0.27.2: "The server refused to save cfbp_games:
  // null value in column "spread_source" of relation "games" violates not-null constraint."
  //
  // [A-NN]'s rule — "omit the key so the column DEFAULT applies" — is true for a ONE-row insert and
  // FALSE for a batch. supabase-js 2.116.0 sends an array insert with `?columns=` set to the UNION
  // of every row's keys, and PostgREST fills a column named there but absent from one object with
  // NULL — the DEFAULT only under `Prefer: missing=default` (`defaultToNull: false`). So a slate
  // that mixes a game ESPN has a line for (`spreadSource: 'espn'`) with one it has not posted yet
  // (`extractSpread()` → `spreadSource: null`, data-provider.js) — "Apply Suggested", the week
  // wizard's auto-build, two quick adds inside one debounce — sends ONE insert whose union names
  // spread_source, and the line-less game's omitted key becomes NULL.
  //
  // This suite's fake `insert(rows)` stores whatever it is handed and never looks at `columns`, so
  // it could not see this. Here ONLY the insert goes through the vendored SDK's own builder (the
  // authtest [77] precedent), into a scripted fetch that applies PostgREST's rule and the schema's
  // NOT NULL / DEFAULT from EVERY migration. It models PostgREST; it is not PostgREST — the live
  // write is the proof, and the handoff names it.
  const vm = await import('node:vm');
  const dm = await import('./js/data-model.js');
  const SCHEMA = schemaFromMigrations();
  const sdkSrc = readFileSync(join(__dirname, 'vendor', 'supabase-js-2.116.0.js'), 'utf8');
  const realm = { console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
    Headers, Request, Response, AbortController, TextEncoder, TextDecoder, queueMicrotask, structuredClone,
    btoa, atob, crypto: globalThis.crypto, WebSocket: globalThis.WebSocket,
    fetch: async () => { throw new Error('realm fetch unused — global.fetch is injected'); } };
  realm.globalThis = realm; realm.self = realm; realm.window = realm;
  vm.createContext(realm);
  vm.runInContext(sdkSrc, realm);

  const wire = [];                                   // every request the SDK put on the "wire"
  const stored = [];                                 // every row the emulated server accepted
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  /** PostgREST's bulk-insert rule, over the migrations' schema. */
  const postgrest = async (url, init) => {
    const u = new URL(String(url));
    const table = u.pathname.split('/rest/v1/')[1];
    const prefer = String(new Headers(init && init.headers).get('prefer') || '').split(',').map((s) => s.trim());
    const body = JSON.parse((init && init.body) || 'null');
    const rows = Array.isArray(body) ? body : [body];
    const named = u.searchParams.get('columns');
    const cols = named ? named.split(',').map((c) => c.replace(/^"|"$/g, '')) : Object.keys(rows[0] || {});
    wire.push({ table, method: init && init.method, cols, prefer, rows });
    if ((init && init.method) !== 'POST') return json(501, { message: 'emulator: POST only' });
    const tbl = SCHEMA[table];
    if (!tbl) return json(404, { code: '42P01', message: `relation "public.${table}" does not exist` });
    const unknown = cols.find((c) => !tbl.has(c));
    if (unknown) return json(400, { code: 'PGRST204', message: `Could not find the '${unknown}' column of '${table}' in the schema cache` });
    const out = [];
    for (const r of rows) {
      const full = {};
      for (const [c, d] of tbl) {
        if (!cols.includes(c)) full[c] = evalSqlDefault(d.def);                          // not in the INSERT list: DEFAULT
        else if (Object.prototype.hasOwnProperty.call(r, c)) full[c] = r[c];              // present (an explicit null stays null)
        else full[c] = prefer.includes('missing=default') ? evalSqlDefault(d.def) : null; // named, but absent from THIS object
      }
      const bad = [...tbl.values()].find((d) => d.notNull && full[d.name] == null);
      if (bad) {
        return json(400, { code: '23502', details: 'Failing row contains (…).', hint: null,
          message: `null value in column "${bad.name}" of relation "${table}" violates not-null constraint` });
      }
      out.push(full);
    }
    stored.push(...out.map((r) => ({ table, row: r })));
    return json(201, out);
  };
  const sdk = realm.supabase.createClient('https://x.test', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: postgrest },
  });
  /** Hydrate through the fake (reads, RLS model), then route ONLY `insert` to the real SDK builder. */
  const hydratedWithRealInsert = async () => {
    await hydrated({ who: 'commissioner' });
    const fakeFrom = CLIENT.from;
    CLIENT.from = (t) => { const b = fakeFrom(t); b.insert = (rows, o) => sdk.from(t).insert(rows, o); return b; };
    wire.length = 0; stored.length = 0;
  };
  const refusedBanner = () => bannerSeen.find((b) => /not-null|violates/i.test(b)) || null;

  // (0) THE MECHANISM, pinned on the vendored SDK itself: an array insert names the UNION of the
  //     rows' keys in `?columns=`, so a key one row omits is still NAMED for that row.
  wire.length = 0;
  await sdk.from('games').insert([{ league_id: LEAGUE_A, id: 'probe1', week_id: 'w1', spread_source: 'espn' }, { league_id: LEAGUE_A, id: 'probe2', week_id: 'w1' }]).select('*');
  assert(wire.length === 1 && wire[0].cols.includes('spread_source') && !('spread_source' in wire[0].rows[1]),
    `[A-NN2] fixture — the vendored SDK names the UNION of keys in ?columns= (${JSON.stringify(wire[0] && wire[0].cols)}), so row 2's OMITTED spread_source is still a named column`);
  assert(!wire[0].prefer.includes('missing=default'),
    '[A-NN2] fixture — and by default (defaultToNull) it does NOT ask for missing=default: PostgREST fills that omitted key with NULL');

  // (1) THE LIVE SHAPE: one slate save, one game with a posted line and one without.
  await hydratedWithRealInsert();
  const lined = dm.createGame('w1', { homeTeam: 'Iowa', awayTeam: 'Minnesota', dataSource: 'espn_live', dataQuality: 'confirmed',
    spread: -7, favorite: 'Iowa', spreadSource: 'espn', oddsProvider: 'ESPN BET', espnEventId: '401999001' });
  // Exactly what extractSpread() returns when ESPN has not posted odds (data-provider.js), carried
  // through createGame()'s overrides — which REPLACE its own spreadSource:'manual' default with null.
  const unlined = dm.createGame('w1', { homeTeam: 'Kansas State', awayTeam: 'Baylor', dataSource: 'espn_live', dataQuality: 'confirmed',
    spread: null, favorite: null, spreadSource: null, oddsProvider: null, espnEventId: '401999002' });
  assert(unlined.spreadSource === null && lined.spreadSource === 'espn', '[A-NN2] fixture — createGame() keeps the null spreadSource an odds-less ESPN game carries');
  sb.set('cfbp_games', [...sb.get('cfbp_games'), lined, unlined]);
  const r1 = await captureConsoleAsync(() => sb.flush());
  const post = wire.filter((w) => w.table === 'games');
  assert(post.length === 1 && post[0].rows.length === 2, `[A-NN2] fixture — ONE insert carrying BOTH games reached the wire (${post.length} request(s))`);
  assert(!(r1 && r1.refused) && !refusedBanner(),
    `[A-NN2] THE LIVE DEFECT — a slate mixing a lined and an unlined game SAVES (refused: ${JSON.stringify(r1 && r1.refused)}; banner: ${JSON.stringify(refusedBanner())})`);
  const got = (id) => (stored.find((s) => s.table === 'games' && s.row.id === id) || {}).row || null;
  assert(!!got(unlined.gameId) && got(unlined.gameId).spread_source === 'manual',
    `[A-NN2] …the unlined game's omitted spread_source took the column DEFAULT 'manual' (stored: ${JSON.stringify(got(unlined.gameId) && got(unlined.gameId).spread_source)})`);
  assert(!!got(lined.gameId) && got(lined.gameId).spread_source === 'espn', '[A-NN2] …and the lined game kept its own value (espn)');
  assert(!!got(unlined.gameId) && got(unlined.gameId).spread === null && got(unlined.gameId).favorite === null,
    '[A-NN2] …while an EXPLICIT null in a NULLABLE column stays null (spread/favorite — AD-03: no line is no line, never a defaulted one)');
  assert(!sb._dirtyKeysForTest().includes('cfbp_games') && !sb._refusedKeysForTest().includes('cfbp_games'),
    '[A-NN2] …cfbp_games is clean and NOT latched — sync stays on');

  // (2) EVERY NOT NULL column of `games`, derived from the migrations — not a hand list. For each
  //     one with a DEFAULT: two games in one save, one carrying the field and one with it nulled.
  //     A column with no legacy field on createGame() must be one the projection never nulls.
  const legacyKeys = Object.keys(dm.createGame(''));
  const nnCols = [...SCHEMA.games.values()].filter((c) => c.notNull);
  assert(nnCols.length >= 20 && nnCols.some((c) => c.name === 'spread_source'),
    `[A-NN2] fixture — ${nnCols.length} NOT NULL columns of games derived from the migrations, spread_source among them`);
  for (const c of nnCols) {
    const legacy = legacyKeys.find((k) => k.toLowerCase() === c.name.replace(/_/g, ''));
    if (c.def == null) {
      // No DEFAULT (league_id, id, week_id): nothing to fall back to, so the projection must always fill it.
      const row = (proj.toRows.cfbp_games([dm.createGame('w1', { homeTeam: 'A', awayTeam: 'B' })], { leagueId: LEAGUE_A }) || {}).games || [];
      assert(row.length === 1 && row[0][c.name] != null, `[A-NN2] games.${c.name} has no DEFAULT, and the projection always fills it (${JSON.stringify(row[0] && row[0][c.name])})`);
      continue;
    }
    if (!legacy) {
      const row = (proj.toRows.cfbp_games([dm.createGame('w1', { homeTeam: 'A', awayTeam: 'B' })], { leagueId: LEAGUE_A }) || {}).games || [];
      assert(row.length === 1 && row[0][c.name] != null, `[A-NN2] games.${c.name} has no createGame() field, and the projection never emits it null`);
      continue;
    }
    await hydratedWithRealInsert();
    const a = dm.createGame('w1', { homeTeam: `A ${c.name}`, awayTeam: 'Opp A' });
    const b = dm.createGame('w1', { homeTeam: `B ${c.name}`, awayTeam: 'Opp B', [legacy]: null });
    if (legacy === 'homeTeam') b.awayTeam = 'Opp B';
    sb.set('cfbp_games', [...sb.get('cfbp_games'), a, b]);
    const r = await captureConsoleAsync(() => sb.flush());
    const sb2 = got(b.gameId);
    assert(!(r && r.refused) && !!sb2 && sb2[c.name] != null,
      `[A-NN2] games.${c.name} (${legacy}) — one game carrying it and one with it null, in ONE save: saved, the null one took the DEFAULT `
      + `(stored ${JSON.stringify(sb2 && sb2[c.name])}; refused ${JSON.stringify(r && r.refused)}; ${refusedBanner() || 'no banner'})`);
  }

  // (3) THE SOURCE PIN: every insert the adapter makes asks for missing=default, so a future second
  //     insert site cannot quietly reopen this. Comment-blanked; a scan that finds nothing fails.
  const code = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const inserts = code.match(/\.(insert|upsert)\(/g) || [];
  const safe = code.match(/\.(insert|upsert)\([^()]*,\s*\{\s*defaultToNull:\s*false\s*\}\)/g) || [];
  assert(inserts.length >= 1 && safe.length === inserts.length,
    `[A-NN2] every .insert()/.upsert() in the adapter passes { defaultToNull: false } (${safe.length} of ${inserts.length})`);
});

// ══════════════════════════════════════════════════════════════════════════
// Multi-Sport Phase 1a (DI-220, migration 0033) — competitions, competition_id, the new games columns
// and tournament_only_guest THROUGH THE REAL PLANNER. The fake models 0033's grants, policies and the
// guard line; what this section proves is the ADAPTER's behaviour against them.
await section('\n[A-MS] Multi-Sport 0033 — the adapter reads/writes competitions safely and CFB rows never re-diff…', async () => {
  const COMP_D = '11111111-1111-4111-8111-111111111111';   // LEAGUE_A's default competition
  const COMP_N = '22222222-2222-4222-8222-222222222222';   // an NFL competition
  const seed = (who = 'commissioner') => {
    initAdapter({ who });
    ST.competitions.push(
      row({ league_id: LEAGUE_A, id: COMP_D, sport: 'cfb', kind: 'season', enrollment: 'all', is_default: true, settings: {}, season_label: null, parent_competition_id: null, archived_at: null, active_week_id: null, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() }),
      row({ league_id: LEAGUE_A, id: COMP_N, sport: 'nfl', kind: 'season', enrollment: 'all', is_default: false, settings: { weeklyPrize: 'a steak' }, season_label: '2026', parent_competition_id: null, archived_at: null, active_week_id: 'wn1', created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() }),
    );
    ST.weeks.push(row({ league_id: LEAGUE_A, id: 'wn1', sport: 'cfb', season: '2026', week_number: 1, label: 'NFL Week 1', status: 'open', competition_id: COMP_N, picks_lock_at: null, revealed_at: null }));
    ST.league_members.find((m) => m.league_id === LEAGUE_A && m.id === 'p3').tournament_only_guest = true;
  };
  const hydrateNow = () => captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));

  // (1) READ — the new key is hydrated, projected camelCase, and the two hydrate lists know it.
  seed(); await hydrateNow();
  assert(sb._readTablesForTest().includes('competitions'), '[A-MS] hydrate() reads the `competitions` table');
  assert(sb._routesForTest().cfbp_competitions && sb._routesForTest().cfbp_competitions.table === 'competitions'
    && sb._routesForTest().cfbp_competitions.player === 'refuse' && sb._routesForTest().cfbp_competitions.noDelete === true,
    '[A-MS] ROUTES.cfbp_competitions: rows for the commissioner, REFUSED for a player, never a delete');
  const comps = sb.get('cfbp_competitions');
  assert(Array.isArray(comps) && comps.length === 2, `[A-MS] the mirror holds both competitions (${comps && comps.length})`);
  const cd = comps.find((c) => c.id === COMP_D);
  const cn = comps.find((c) => c.id === COMP_N);
  assert(cd && cd.isDefault === true && cd.sport === 'cfb' && cd.kind === 'season' && cd.enrollment === 'all',
    '[A-MS] the default competition projects to {isDefault:true, sport:cfb, kind:season, enrollment:all}');
  assert(cn && cn.sport === 'nfl' && cn.isDefault === false && cn.settings.weeklyPrize === 'a steak' && cn.activeWeekId === 'wn1' && cn.seasonLabel === '2026',
    '[A-MS] a non-default competition keeps its settings, seasonLabel and activeWeekId');

  // (2) READ — the new columns reach the objects ONLY when they carry a value (CFB rows unchanged).
  const wks = sb.get('cfbp_weeks');
  assert(wks.find((w) => w.weekId === 'wn1').competitionId === COMP_N, '[A-MS] a week in the NFL competition carries competitionId');
  assert(wks.filter((w) => w.weekId !== 'wn1').every((w) => !('competitionId' in w)),
    '[A-MS] every default-competition week has NO competitionId key at all (NULL restores as absent — CFB byte-identical)');
  assert(sb.get('cfbp_games').every((g) => !('parentGameId' in g) && !('periodGoals' in g) && !('feedStats' in g) && !('providerEventId' in g)),
    '[A-MS] no game carries parentGameId/periodGoals/feedStats/providerEventId keys (CFB games byte-identical)');
  const pls = sb.get('cfbp_players');
  assert(pls.find((p) => p.playerId === 'p3').tournamentOnlyGuest === true, '[A-MS] a tournament-only guest reads tournamentOnlyGuest === true (the typed column, over any __absent marker)');
  assert(pls.filter((p) => p.playerId !== 'p3').every((p) => !('tournamentOnlyGuest' in p)), '[A-MS] every other player has NO tournamentOnlyGuest key (CFB byte-identical)');

  // (3) THE ZERO-SPURIOUS-DIFF PROOF — untouched CFB rows must not become patches because the
  //     projection gained columns. Re-saving every key the migration touches, unchanged, plans NOTHING.
  seed('commissioner'); await hydrateNow();
  for (const key of ['cfbp_weeks', 'cfbp_games', 'cfbp_players', 'cfbp_competitions']) sb.set(key, sb.get(key).map((r) => ({ ...r })));
  const idle = captureConsole(() => sb.planFlush()).plan;
  assert(idle.length === 0, `[A-MS] re-saving unchanged weeks/games/players/competitions plans ZERO operations (got ${JSON.stringify(idle.map((o) => `${o.key}:${o.op}:${o.rowId}`))})`);

  // (4) DI-220's TOP RISK — saving a week in competition B emits ZERO deletes for competition A. The
  //     write is exactly storage.js's saveWeek(): the WHOLE, unfiltered array with one row replaced.
  seed('commissioner'); await hydrateNow();
  const all = sb.get('cfbp_weeks').map((w) => ({ ...w }));
  all.find((w) => w.weekId === 'wn1').blurb = 'NFL opener';
  sb.set('cfbp_weeks', all);
  const planB = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_weeks');
  assert(planB.length === 1 && planB[0].op === 'patch' && planB[0].rowId === 'wn1' && planB[0].changed.blurb === 'NFL opener',
    `[A-MS] saveWeek in competition B is ONE patch of that week (${JSON.stringify(planB.map((o) => `${o.op}:${o.rowId}`))})`);
  assert(!planB.some((o) => o.op === 'delete'), '[A-MS] …and ZERO deletes for competition A\'s weeks');
  // THE CONTROL: the same write built from a competition-FILTERED array is the hazard, and the planner
  // DOES see it as "A's weeks were deleted" — so the assertion above is not vacuous. This is why
  // getWeeksForCompetition() is read-only and storage.js's saveWeek/deleteWeek stay on getWeeks().
  seed('commissioner'); await hydrateNow();
  sb.set('cfbp_weeks', sb.get('cfbp_weeks').filter((w) => w.competitionId === COMP_N));
  const planBad = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_weeks' && o.op === 'delete');
  assert(planBad.length >= 2, `[A-MS] CONTROL: a write from a competition-filtered array DOES plan deletes for the other competition's weeks (${planBad.length}) — the hazard is real`);

  // (5) A PLAYER device may not write competitions — the route refuses before the network does.
  seed('player'); await hydrateNow();
  const denied = thrown(() => sb.set('cfbp_competitions', sb.get('cfbp_competitions').concat([{ id: 'x', sport: 'nhl' }])));
  assert(denied && /may not write it/.test(denied.message), `[A-MS] a player writing cfbp_competitions is refused loudly (${denied && denied.message})`);

  // (6) A commissioner INSERT of a new competition omits every NOT NULL column it has no opinion on,
  //     so the table defaults apply — and `sport` (NOT NULL, no default) is the one thing it must carry.
  seed('commissioner'); await hydrateNow();
  sb.set('cfbp_competitions', sb.get('cfbp_competitions').concat([{ id: '33333333-3333-4333-8333-333333333333', sport: 'nhl' }]));
  const ins = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_competitions');
  assert(ins.length === 1 && ins[0].op === 'insert' && ins[0].rows.length === 1, '[A-MS] a new competition plans exactly one INSERT');
  const irow = ins[0].rows[0];
  assert(irow.sport === 'nhl' && irow.id === '33333333-3333-4333-8333-333333333333' && irow.league_id === LEAGUE_A,
    '[A-MS] …carrying id, sport and the active league');
  assert(!('extra' in irow), `[A-MS] …and NO \`extra\` field: the competitions table has no such column (batch T finding, D1 DI-531) — ${JSON.stringify(Object.keys(irow))}`);
  assert(!('kind' in irow) && !('enrollment' in irow) && !('is_default' in irow) && !('settings' in irow) && !('created_at' in irow) && !('updated_at' in irow),
    `[A-MS] …and OMITTING every NOT NULL column it has no value for, so the DEFAULTS apply (kind/enrollment/is_default/settings never invented) — ${JSON.stringify(Object.keys(irow))}`);
  await captureConsoleAsync(() => sb.flush());
  assert(ST.competitions.some((c) => c.id === '33333333-3333-4333-8333-333333333333'), '[A-MS] …and the commissioner\'s insert lands (RLS + grant modelled)');

  // (7) tournament_only_guest — never written from a stale/rebuilt object, and a self-mark is fenced.
  seed('commissioner'); await hydrateNow();
  const stale = sb.get('cfbp_players').map((p) => ({ ...p }));
  const koby = stale.find((p) => p.playerId === 'p3');
  delete koby.tournamentOnlyGuest;                      // a rebuilt/stale object that lost the flag
  koby.displayName = 'Koby Z';                          // one real change so a patch exists
  sb.set('cfbp_players', stale);
  const pp = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_players');
  assert(pp.length === 1 && pp[0].changed.display_name === 'Koby Z' && !('tournament_only_guest' in pp[0].changed),
    `[A-MS] an object that LOST tournamentOnlyGuest never writes tournament_only_guest=false over the server's true (${JSON.stringify(pp[0] && pp[0].changed)})`);
  seed('commissioner'); await hydrateNow();
  const unguest = sb.get('cfbp_players').map((p) => ({ ...p }));
  unguest.find((p) => p.playerId === 'p3').tournamentOnlyGuest = false;
  sb.set('cfbp_players', unguest);
  const pu = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_players');
  assert(pu.length === 1 && pu[0].changed.tournament_only_guest === false, '[A-MS] the commissioner\'s EXPLICIT un-guest does write tournament_only_guest=false');
  seed('player'); await hydrateNow();
  const selfMark = sb.get('cfbp_players').map((p) => ({ ...p }));
  selfMark.find((p) => p.playerId === 'p2').tournamentOnlyGuest = true;
  sb.set('cfbp_players', selfMark);
  const sm = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_players');
  assert(sm.length === 1 && sm[0].changed.tournament_only_guest === true, '[A-MS] (fixture) a player\'s self-mark plans a patch — the DB fence is what stops it');
  await captureConsoleAsync(() => sb.flush());
  assert(!ST.league_members.find((m) => m.id === 'p2' && m.league_id === LEAGUE_A).tournament_only_guest,
    '[A-MS] …and the modelled league_members_guard refuses it (42501) — the flag never moved');

  // (8) A week object that lost competitionId never moves the week back to the default competition.
  seed('commissioner'); await hydrateNow();
  const wk = sb.get('cfbp_weeks').map((w) => ({ ...w }));
  const nfl = wk.find((w) => w.weekId === 'wn1');
  delete nfl.competitionId; nfl.blurb = 'rebuilt';
  sb.set('cfbp_weeks', wk);
  const wp = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_weeks');
  assert(wp.length === 1 && wp[0].changed.blurb === 'rebuilt' && !('competition_id' in wp[0].changed),
    `[A-MS] a week object that lost competitionId never writes competition_id=null (${JSON.stringify(wp[0] && wp[0].changed)})`);

  // (9) The new games columns round-trip when present (a Hockey Question row + a WJC parent).
  seed('commissioner');
  ST.games.push(
    row({ league_id: LEAGUE_A, id: 'gq1', week_id: 'w1', home_team: 'A', away_team: 'B', status: 'scheduled', kickoff: null, spread: 0, multiplier: 1, parent_game_id: 'g1', espn_event_id: null }),
    row({ league_id: LEAGUE_A, id: 'gw1', week_id: 'w1', home_team: 'C', away_team: 'D', status: 'scheduled', kickoff: null, spread: 0, multiplier: 1, provider_event_id: '123456', period_goals: [{ p: 1, h: 1, a: 0 }], feed_stats: { goalsSumOk: true } }),
  );
  await hydrateNow();
  const gq = sb.get('cfbp_games').find((g) => g.gameId === 'gq1');
  const gw = sb.get('cfbp_games').find((g) => g.gameId === 'gw1');
  assert(gq.parentGameId === 'g1' && gw.providerEventId === '123456' && gw.periodGoals[0].h === 1 && gw.feedStats.goalsSumOk === true,
    '[A-MS] a question row keeps parentGameId; a WJC game keeps providerEventId / periodGoals / feedStats');
  const g2 = sb.get('cfbp_games').map((g) => ({ ...g }));
  g2.find((g) => g.gameId === 'gq1').parentGameId = null;
  sb.set('cfbp_games', g2);
  const gp = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_games');
  assert(gp.length === 1 && gp[0].changed.parent_game_id === null, '[A-MS] clearing parentGameId is a real patch (a NULLABLE column still takes a null)');
});

// ══════════════════════════════════════════════════════════════════════════
// D1 (v0.30.0) DI-531, migration 0033 §5 — competition_members THROUGH THE REAL PLANNER: who plays each opt-in sport. The fake models the table exactly as 0033 declares it (grants:
// select/insert/delete and NO update; id GENERATED ALWAYS; joined_at defaulted by the server; cm_self_insert / cm_commissioner_all), so what this section proves is the ADAPTER's
// behaviour against it: the read, the Join insert that carries no id and no joined_at, the ownership rule, and that no PATCH is ever planned.
await section('\n[A-CM] D1 DI-531 — competition_members: read, a member\'s own Join (no id, no joined_at on the wire), ownership, never a PATCH…', async () => {
  const COMP_D = '11111111-1111-4111-8111-111111111111';
  const COMP_N = '22222222-2222-4222-8222-222222222222';
  const COMP_A = '44444444-4444-4444-8444-444444444444';   // an enrollment:'all' competition
  const seed = (who = 'player') => {
    initAdapter({ who });
    ST.competitions.push(
      row({ league_id: LEAGUE_A, id: COMP_D, sport: 'cfb', kind: 'season', enrollment: 'all', is_default: true, settings: {}, season_label: null, parent_competition_id: null, archived_at: null, active_week_id: null, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() }),
      row({ league_id: LEAGUE_A, id: COMP_N, sport: 'nfl', kind: 'season', enrollment: 'opt_in', is_default: false, settings: {}, season_label: '2026', parent_competition_id: null, archived_at: null, active_week_id: null, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() }),
      row({ league_id: LEAGUE_A, id: COMP_A, sport: 'nhl', kind: 'season', enrollment: 'all', is_default: false, settings: {}, season_label: null, parent_competition_id: null, archived_at: null, active_week_id: null, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() }),
    );
    // Two entrants on the server already: p1 (self) and p4 (enrolled by the commissioner), with a server-stamped joined_at.
    ST.competition_members.push(
      { league_id: LEAGUE_A, competition_id: COMP_N, league_member_id: 'p1', enrolled_by: 'self', joined_at: '2026-10-01T12:00:00.000Z', id: `${COMP_N}:p1` },
      { league_id: LEAGUE_A, competition_id: COMP_N, league_member_id: 'p4', enrolled_by: 'commissioner', joined_at: '2026-10-02T12:00:00.000Z', id: `${COMP_N}:p4` },
    );
  };
  const hydrateNow = () => captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));

  // (1) READ — the table is hydrated into a camelCase key; the lists, route and projection all know it.
  seed('player'); await hydrateNow();
  assert(sb._readTablesForTest().includes('competition_members'), '[A-CM] hydrate() reads the `competition_members` table');
  const r = sb._routesForTest().cfbp_competition_members;
  assert(r && r.table === 'competition_members' && r.comm === 'rows' && r.player === 'rows' && r.ownRowsOnly === true && r.noPatch === true
    && JSON.stringify(r.generatedCols) === '["id"]' && JSON.stringify(r.serverOwnedCols) === '["joined_at"]' && r.memberIdCol === 'league_member_id',
    `[A-CM] ROUTES.cfbp_competition_members: rows for both roles, own rows only for a player, no PATCH, the generated id stripped at the wire, joined_at server-owned (${JSON.stringify(r)})`);
  const cm = sb.get('cfbp_competition_members');
  assert(Array.isArray(cm) && cm.length === 2, `[A-CM] the mirror holds both entries (${cm && cm.length})`);
  const e1 = cm.find((x) => x.memberId === 'p1');
  assert(e1 && e1.competitionId === COMP_N && e1.enrolledBy === 'self' && e1.joinedAt === '2026-10-01T12:00:00.000Z' && e1.id === `${COMP_N}:p1`,
    `[A-CM] an entry projects to {id, competitionId, memberId, enrolledBy, joinedAt} (${JSON.stringify(e1)})`);
  assert(cm.every((x) => !('extra' in x) && !('league_id' in x) && !('league_member_id' in x)), '[A-CM] …with no `extra` and no raw column names on the object');
  assert(sb.getState() === 'ACTIVE', `[A-CM] the hydrate with the new table in the read list is ACTIVE, not HELD (${sb.getState()})`);

  // (2) ZERO SPURIOUS DIFF — re-saving the key unchanged plans nothing (joined_at is not projected, so a server-stamped time never reads as a change).
  sb.set('cfbp_competition_members', sb.get('cfbp_competition_members').map((x) => ({ ...x })));
  const idle = captureConsole(() => sb.planFlush()).plan;
  assert(idle.length === 0, `[A-CM] re-saving the entries unchanged plans ZERO operations (got ${JSON.stringify(idle.map((o) => `${o.key}:${o.op}:${o.rowId}`))})`);

  // (3) A MEMBER'S OWN JOIN — one INSERT; the planned row carries id (the planner's identity) but NOT joined_at; the WIRE carries neither.
  seed('player'); await hydrateNow();   // p2 (Kevin) is the player session
  const joined = [...sb.get('cfbp_competition_members'), { id: `${COMP_N}:p2`, competitionId: COMP_N, memberId: 'p2', enrolledBy: 'self', joinedAt: '2000-01-01T00:00:00.000Z' }];
  sb.set('cfbp_competition_members', joined);
  const plan = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_competition_members');
  assert(plan.length === 1 && plan[0].op === 'insert' && plan[0].rows.length === 1, `[A-CM] a Join plans exactly ONE insert (${JSON.stringify(plan.map((o) => o.op))})`);
  const prow = plan[0].rows[0];
  assert(prow.competition_id === COMP_N && prow.league_member_id === 'p2' && prow.enrolled_by === 'self' && prow.league_id === LEAGUE_A && prow.id === `${COMP_N}:p2`,
    `[A-CM] …for this member, this competition, enrolled_by 'self' (${JSON.stringify(prow)})`);
  assert(!('joined_at' in prow), '[A-CM] …and the planned row has NO joined_at even though the local entry carried a back-dated one (C1: the client never writes it)');
  assert(!('extra' in prow), '[A-CM] …and no `extra` (the table has no such column)');
  await captureConsoleAsync(() => sb.flush());
  const sent = CLIENT._calls.inserts.filter((i) => i.table === 'competition_members');
  assert(sent.length === 1 && sent[0].rows.length === 1 && !('id' in sent[0].rows[0]) && !('joined_at' in sent[0].rows[0]),
    `[A-CM] …and what reached the wire has NEITHER id (GENERATED ALWAYS) NOR joined_at (${JSON.stringify(sent.map((i) => i.rows.map((x) => Object.keys(x))))})`);
  const stored = ST.competition_members.find((x) => x.league_member_id === 'p2');
  assert(stored && stored.id === `${COMP_N}:p2` && stored.joined_at === new Date(NOW).toISOString(),
    `[A-CM] …the server computed the id and stamped joined_at itself, not the client's 2000-01-01 (${JSON.stringify(stored)})`);
  assert(sb.getState() === 'ACTIVE' && sb._dirtyKeysForTest().length === 0, '[A-CM] …the key ends clean, no refusal, no banner');
  // a second save of the same state plans nothing (the fold advanced the base by the RETURNED row, which carries the id)
  sb.set('cfbp_competition_members', sb.get('cfbp_competition_members').map((x) => ({ ...x })));
  assert(captureConsole(() => sb.planFlush()).plan.length === 0, '[A-CM] …and a re-save after the Join plans nothing (no 23505 on the next flush)');

  // (4) OWNERSHIP — a player's insert of ANOTHER member's row is dropped from the plan (said, never sent); the commissioner's is not.
  seed('player'); await hydrateNow();
  sb.set('cfbp_competition_members', [...sb.get('cfbp_competition_members'), { id: `${COMP_N}:p5`, competitionId: COMP_N, memberId: 'p5', enrolledBy: 'self' }]);
  const dropped = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_competition_members');
  assert(dropped.length === 0 && said(/not this caller's to make/), `[A-CM] a player's Join for ANOTHER member is dropped from the plan and the console says so (${dropped.length} ops)`);
  seed('commissioner'); await hydrateNow();
  sb.set('cfbp_competition_members', [...sb.get('cfbp_competition_members'), { id: `${COMP_N}:p5`, competitionId: COMP_N, memberId: 'p5', enrolledBy: 'commissioner' }]);
  const cplan = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_competition_members');
  assert(cplan.length === 1 && cplan[0].op === 'insert' && cplan[0].rows[0].league_member_id === 'p5' && cplan[0].rows[0].enrolled_by === 'commissioner', '[A-CM] the commissioner may add any member (enrolled_by commissioner)');
  await captureConsoleAsync(() => sb.flush());
  assert(ST.competition_members.some((x) => x.league_member_id === 'p5' && x.enrolled_by === 'commissioner'), '[A-CM] …and it lands (cm_commissioner_all modelled)');

  // (5) THE POLICY BOUNDARY, in the fake as in 0033: a member cannot enroll in an enrollment:'all' competition, and cannot write another member's row even when the planner is bypassed.
  seed('player'); await hydrateNow();
  const direct = await CLIENT.from('competition_members').insert([{ league_id: LEAGUE_A, competition_id: COMP_A, league_member_id: 'p2', enrolled_by: 'self' }]).select('*');
  assert(direct.error && direct.error.code === '42501', '[A-CM] cm_self_insert refuses an enrollment:\'all\' competition (a direct request, bypassing the adapter)');
  const forged = await CLIENT.from('competition_members').insert([{ league_id: LEAGUE_A, competition_id: COMP_N, league_member_id: 'p6', enrolled_by: 'self' }]).select('*');
  assert(forged.error && forged.error.code === '42501', '[A-CM] …and refuses a row for another member');
  const withId = await CLIENT.from('competition_members').insert([{ league_id: LEAGUE_A, competition_id: COMP_N, league_member_id: 'p2', enrolled_by: 'self', id: 'x' }]).select('*');
  assert(withId.error && withId.error.code === '428C9', '[A-CM] …and Postgres refuses a client-supplied value for the GENERATED id (the reason the wire strip exists)');
  const upd = await CLIENT.from('competition_members').update({ enrolled_by: 'commissioner' }).eq('league_id', LEAGUE_A).eq('id', `${COMP_N}:p1`).select('*');
  assert(upd.error && upd.error.code === '42501', '[A-CM] …and there is no UPDATE grant at all');

  // (6) NEVER A PATCH — a local entry that disagrees with the server's row plans no operation (and says so).
  seed('commissioner'); await hydrateNow();
  sb.set('cfbp_competition_members', sb.get('cfbp_competition_members').map((x) => (x.memberId === 'p1' ? { ...x, enrolledBy: 'commissioner' } : { ...x })));
  const noPatch = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_competition_members');
  assert(noPatch.length === 0 && said(/no UPDATE path/), `[A-CM] a changed enrolledBy plans NO patch (the table has no UPDATE grant) and the console says why (${noPatch.length} ops)`);

  // (7) A DELETE (the commissioner removing an entry) is keyed by the generated id.
  seed('commissioner'); await hydrateNow();
  sb.set('cfbp_competition_members', sb.get('cfbp_competition_members').filter((x) => x.memberId !== 'p4'));
  const del = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_competition_members');
  assert(del.length === 1 && del[0].op === 'delete' && del[0].rowId === `${COMP_N}:p4`, `[A-CM] removing an entry plans one DELETE keyed by the generated id (${JSON.stringify(del.map((o) => `${o.op}:${o.rowId}`))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(!ST.competition_members.some((x) => x.league_member_id === 'p4'), '[A-CM] …and it lands');

  // (7b) THE PROJECTION KEEPS joined_at (a restore must carry each entry's original join time, C1b); only the client's INSERT withholds it.
  {
    const pr = proj.toRows.cfbp_competition_members([{ id: `${COMP_N}:p1`, competitionId: COMP_N, memberId: 'p1', enrolledBy: 'self', joinedAt: '2026-10-01T12:00:00.000Z' }], { leagueId: LEAGUE_A }).competition_members[0];
    assert(pr.joined_at === '2026-10-01T12:00:00.000Z' && !('extra' in pr), `[A-CM] toRows keeps joined_at (the importer needs it) and drops extra (${JSON.stringify(Object.keys(pr))})`);
  }

  // (8) THE SOURCE PINS — the strip is at the wire and ONLY the wire (the planned row keeps its id for the fold), and the insert is still { defaultToNull:false } (A-NN2's rule).
  const code = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert(/generatedCols/.test(code) && /client\.from\(op\.table\)\.insert\(wireRows,\s*\{\s*defaultToNull:\s*false\s*\}\)/.test(code),
    '[A-CM] source pin: _executeOp inserts the generatedCols-stripped rows with { defaultToNull:false }');
  const diffBody = (code.match(/function _diffRows\([\s\S]*?\n\}\n/) || [''])[0];
  assert(diffBody.length > 200 && !/generatedCols/.test(diffBody), '[A-CM] source pin: the planner (_diffRows) does NOT strip the generated column — the planned row keeps the id the base fold and the already-saved narrowing key by');
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
await section('\n[A-PRIME] RG-257 — a re-hydrate on a SERVING device never re-primes the mirror from the snapshot over unsent edits…', async () => {
  // Found while fixing security F1 on f16d87c (2026-09-26). app.js's ensureSupabaseDataHydrated() —
  // the tick's re-hydrate (Realtime not live, or the base > 5 min old), visibilitychange, online and
  // the banner's Retry — calls primeFromSnapshot() before every hydrate. primeFromSnapshot() had no
  // state guard: on an ACTIVE device holding a snapshot it replaced the mirror with the LAST CLEAN
  // snapshot and emptied the base. A pick still inside its ~800 ms debounce vanished from the
  // mirror, hydrate()'s rebase then captured the snapshot's value as the "local edit", the plan
  // diffed to [] and the key was marked clean — RG-252's silent pick loss through another door.
  await hydrated({ who: 'player' });
  assert(sb.hasDeviceSnapshot() === true, '[A-PRIME] fixture: a clean hydrate persisted the device snapshot');
  const all = sb.get('cfbp_picks').map((p) => ({ ...p }));
  all.find((p) => p.pickId === 'pk2').selectedTeam = 'Iowa State';        // was Kansas — still in its debounce
  sb.set('cfbp_picks', all);
  const primed = captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_A));
  assert(primed === 0 && sb.getState() === 'ACTIVE',
    `[A-PRIME] priming a SERVING (ACTIVE) mirror is refused — the snapshot is older than what is on screen (primed ${primed}, state ${sb.getState()})`);
  assert(sb.get('cfbp_picks').find((p) => p.pickId === 'pk2').selectedTeam === 'Iowa State',
    '[A-PRIME] …and the unsent pick is still in the mirror');
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  await captureConsoleAsync(() => sb.flush());
  assert(ST.picks.find((p) => p.id === 'pk2').selected_team === 'Iowa State',
    `[A-PRIME] …and after the re-hydrate the pick reaches the server (server ${ST.picks.find((p) => p.id === 'pk2').selected_team})`);
  // Dirty edits are protected in EVERY state, not only ACTIVE (a held write in ACTIVE-STALE is still owed).
  await hydrated({ who: 'player' });
  const snap = localStorage.getItem(sb._snapshotKeyForTest());
  initAdapter({ who: 'player' });
  localStorage.setItem(sb._snapshotKeyForTest(), snap);
  captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_A));
  const all2 = sb.get('cfbp_picks').map((p) => ({ ...p }));
  all2.find((p) => p.pickId === 'pk2').selectedTeam = 'Iowa State';
  sb.set('cfbp_picks', all2);                                             // a held write in ACTIVE-STALE
  const primed2 = captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_A));
  assert(primed2 === 0 && sb.get('cfbp_picks').find((p) => p.pickId === 'pk2').selectedTeam === 'Iowa State',
    `[A-PRIME] a second prime over a DIRTY ACTIVE-STALE mirror is refused too — the held pick survives (primed ${primed2})`);
  // Control: the boot prime (nothing loaded) still works.
  initAdapter({ who: 'player' });
  localStorage.setItem(sb._snapshotKeyForTest(), snap);
  assert(captureConsole(() => sb.primeFromSnapshot(OWNER, LEAGUE_A)) > 0 && sb.getState() === 'ACTIVE-STALE',
    '[A-PRIME] control: the boot prime over an empty mirror still paints the snapshot');
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
await section('\n[A-RT1] RG-252 — a Realtime fold NEVER discards an unsent (dirty) edit; the echo of my own write stays a clean no-op…', async () => {
  // RG-252 (found by the RG-251 bugfixer, 2026-09-26). `_foldRealtimeRow()` used to RE-PROJECT the
  // whole key from the base on every event. For a key with an edit still inside its ~800 ms
  // debounce that REPLACED the edit with the server's value: the player set pick A (flushed), set
  // pick B, the Realtime echo of A landed while B was still queued, the mirror went back to A, the
  // plan diffed to [] and the key was marked clean — B silently gone, no banner. The rule now is
  // hydrate()'s own rebase rule, taken at ROW granularity: the base advances to what the server
  // said; the rows/columns THIS device changed are re-applied on top; every other row is the
  // server's. So nothing unsent is discarded, and nothing another device wrote is reverted.
  const pickOf = (id) => (sb.get('cfbp_picks') || []).find((p) => p.pickId === id);
  const setPick = (id, team) => {
    const all = sb.get('cfbp_picks').map((p) => ({ ...p }));
    const p = all.find((x) => x.pickId === id);
    p.selectedTeam = team; p.updatedAt = new Date(NOW + 1000).toISOString();
    sb.set('cfbp_picks', all);
  };
  const serverPick = (id) => ST.picks.find((p) => p.id === id).selected_team;
  const handlerFor = (ch, table) => ch.channel._handlers.find((h) => h.cfg.table === table).cb;
  const writes = () => CLIENT._calls.inserts.length + CLIENT._calls.updates.length + CLIENT._calls.deletes.length
    + CLIENT._calls.rpc.filter((c) => ['patch_kv', 'lock_week', 'transition_week', 'finalize_week'].includes(c.name)).length;

  // ── (1) PICKS — the reported reproduction, on a PLAYER device ─────────────────────────────────
  await hydrated({ who: 'player' });
  const chP = sb.subscribeRealtime();
  const onPicks = handlerFor(chP, 'picks');
  setPick('pk2', 'Iowa State');                                          // pick A
  await captureConsoleAsync(() => sb.flush());
  assert(serverPick('pk2') === 'Iowa State' && !sb._dirtyKeysForTest().includes('cfbp_picks'),
    '[A-RT1] (1) fixture: pick A flushed and landed; the key is clean');
  setPick('pk2', 'Kansas');                                              // pick B — still in its debounce
  const echoA = { ...ST.picks.find((p) => p.id === 'pk2') };            // the server's row: A
  captureConsole(() => onPicks({ eventType: 'UPDATE', new: echoA }));
  assert(pickOf('pk2').selectedTeam === 'Kansas',
    `[A-RT1] (1) the Realtime echo of A does NOT revert the unsent pick B in the mirror (mirror ${pickOf('pk2').selectedTeam})`);
  assert(sb._dirtyKeysForTest().includes('cfbp_picks'), '[A-RT1] (1) …and the key is still DIRTY (B is still owed to the server)');
  const planP = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_picks');
  assert(planP.length === 1 && planP[0].op === 'patch' && planP[0].rowId === 'pk2' && planP[0].changed.selected_team === 'Kansas',
    `[A-RT1] (1) …and the plan still carries B as one patch of pk2 (got ${JSON.stringify(planP.map((o) => [o.op, o.rowId, o.changed]))})`);
  const bannersBefore1 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(serverPick('pk2') === 'Kansas' && !sb._dirtyKeysForTest().includes('cfbp_picks') && bannerSeen.length === bannersBefore1,
    `[A-RT1] (1) …and B reaches the server; the key is clean; no banner (server ${serverPick('pk2')})`);
  assert(serverPick('pk3') === 'Purdue', '[A-RT1] (1) the player\'s OTHER pick was never touched');

  // ── (2) THE ECHO OF MY OWN WRITE — a clean key stays clean and nothing is sent ────────────────
  const beforeEcho = JSON.stringify(sb.get('cfbp_picks'));
  const w0 = writes();
  captureConsole(() => onPicks({ eventType: 'UPDATE', new: { ...ST.picks.find((p) => p.id === 'pk2') } }));
  assert(JSON.stringify(sb.get('cfbp_picks')) === beforeEcho, '[A-RT1] (2) the echo of my own landed write leaves the mirror byte-identical');
  assert(!sb._dirtyKeysForTest().length, `[A-RT1] (2) …marks nothing dirty (dirty ${JSON.stringify(sb._dirtyKeysForTest())})`);
  await captureConsoleAsync(() => sb.flush());
  assert(writes() === w0, '[A-RT1] (2) …and a flush after it sends NOTHING');

  // ── (3) A GENUINE SERVER-SIDE CONFLICT STILL SURFACES THROUGH THE BANNER ─────────────────────
  // B' is queued; meanwhile the commissioner locks the week (the Realtime weeks event reaches this
  // phone). The fold keeps B' (it is still the player's intent), and the server's refusal of it is
  // loud — the fold is never where a conflict gets decided.
  setPick('pk3', 'Ohio State');
  const wk = ST.weeks.find((w) => w.id === 'w1');
  wk.status = 'locked';
  captureConsole(() => handlerFor(chP, 'weeks')({ eventType: 'UPDATE', new: { ...wk } }));
  assert(pickOf('pk3').selectedTeam === 'Ohio State' && sb._dirtyKeysForTest().includes('cfbp_picks'),
    '[A-RT1] (3) a Realtime event on ANOTHER table leaves the queued pick exactly as the player set it');
  const b3 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(serverPick('pk3') === 'Purdue' && bannerSeen.length > b3 && /refused to save cfbp_picks/.test(bannerSeen[bannerSeen.length - 1]),
    `[A-RT1] (3) …and the server's refusal of it is LOUD — the red banner names cfbp_picks (last banner: ${bannerSeen[bannerSeen.length - 1]})`);
  assert(sb._dirtyKeysForTest().includes('cfbp_picks'), '[A-RT1] (3) …and the refused pick is still named as unsaved, never marked clean');

  // ── (4) ANOTHER DEVICE'S ROW IS TAKEN, MY ROW IS KEPT — no widening, no revert ───────────────
  await hydrated({ who: 'commissioner' });
  const chW = sb.subscribeRealtime();
  const onWeeks = handlerFor(chW, 'weeks');
  const weeksNow = () => sb.get('cfbp_weeks');
  const setWeek = (id, patch) => sb.set('cfbp_weeks', weeksNow().map((w) => (w.weekId === id ? { ...w, ...patch } : { ...w })));
  setWeek('w2', { blurb: 'my unsent blurb' });                         // this device: w2, queued
  const w1s = ST.weeks.find((w) => w.id === 'w1');
  w1s.label = 'Week 1 (renamed elsewhere)';                            // another device: w1, landed
  captureConsole(() => onWeeks({ eventType: 'UPDATE', new: { ...w1s } }));
  const m1 = weeksNow().find((w) => w.weekId === 'w1');
  const m2 = weeksNow().find((w) => w.weekId === 'w2');
  assert(m2.blurb === 'my unsent blurb', `[A-RT1] (4) my unsent w2 blurb survives the w1 event (mirror ${JSON.stringify(m2.blurb)})`);
  assert(m1.label === 'Week 1 (renamed elsewhere)', '[A-RT1] (4) …and the other device\'s w1 rename IS in the mirror');
  const planW = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_weeks');
  assert(planW.length === 1 && planW[0].op === 'patch' && planW[0].rowId === 'w2' && JSON.stringify(Object.keys(planW[0].changed)) === '["blurb"]',
    `[A-RT1] (4) …and the plan is exactly my w2 blurb — nothing that would revert w1 (got ${JSON.stringify(planW.map((o) => [o.op, o.rowId, o.changed]))})`);

  // ── (5) A PENDING STATUS LEG SURVIVES AN EVENT THAT DID NOT MOVE THE STATUS ───────────────────
  await hydrated({ who: 'commissioner' });
  const onWeeks5 = handlerFor(sb.subscribeRealtime(), 'weeks');
  setWeek('w1', { status: 'locked' });                                  // Lock Week pressed, in debounce
  const w1b = ST.weeks.find((w) => w.id === 'w1');
  w1b.blurb = 'blurb from the other device';
  captureConsole(() => onWeeks5({ eventType: 'UPDATE', new: { ...w1b } }));
  assert(weeksNow().find((w) => w.weekId === 'w1').status === 'locked' && sb.getConfirmedWeekStatus('w1') === 'open',
    '[A-RT1] (5) the queued Lock survives an unrelated w1 event (mirror locked, confirmed still open)');
  const plan5 = captureConsole(() => sb.planFlush());
  assert(plan5.plan.some((o) => o.name === 'lock_week') && !plan5.refusals.length,
    `[A-RT1] (5) …and lock_week is still planned, nothing refused (refusals ${JSON.stringify(plan5.refusals.map((e) => e.code))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(ST.weeks.find((w) => w.id === 'w1').status === 'locked' && ST.weeks.find((w) => w.id === 'w1').blurb === 'blurb from the other device',
    '[A-RT1] (5) …and it lands, without overwriting the other device\'s blurb');

  // ── (6) RG-251 — a REFUSED leg is kept while the server's status is where it was refused… ─────
  await hydrated({ who: 'commissioner' });
  const onWeeks6 = handlerFor(sb.subscribeRealtime(), 'weeks');
  setWeek('w1', { status: 'live' });                                    // open -> live: refused client-side
  await captureConsoleAsync(() => sb.flush());
  assert(sb._refusedKeysForTest().includes('cfbp_weeks') && ST.weeks.find((w) => w.id === 'w1').status === 'open',
    '[A-RT1] (6) fixture: the open->live leg is REFUSED and the server is still OPEN');
  const w1c = ST.weeks.find((w) => w.id === 'w1');
  w1c.blurb = 'renamed while refused';
  captureConsole(() => onWeeks6({ eventType: 'UPDATE', new: { ...w1c } }));
  assert(sb.getConfirmedWeekStatus('w1') === 'open' && weeksNow().find((w) => w.weekId === 'w1').blurb === 'renamed while refused',
    '[A-RT1] (6) a Realtime OPEN event advances the base (confirmed open) and brings the other device\'s change in');
  assert(weeksNow().find((w) => w.weekId === 'w1').status === 'live',
    '[A-RT1] (6) …the mirror still holds the refused LIVE, exactly as flush() left it (the fold neither drops it nor decides it)');
  assert(sb._dirtyKeysForTest().includes('cfbp_weeks') && sb._refusedKeysForTest().includes('cfbp_weeks'),
    '[A-RT1] (6) …and the refused key is NOT quietly marked clean by the fold — it stays dirty and named');
  const b6 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(bannerSeen.length > b6 && /cfbp_weeks/.test(bannerSeen[bannerSeen.length - 1]) && /open to live/.test(String(sb.getStatus().lastError))
    && ST.weeks.find((w) => w.id === 'w1').status === 'open',
    `[A-RT1] (6) …so the next flush is still LOUD about it, and still sends nothing (last banner: ${bannerSeen[bannerSeen.length - 1]}; lastError: ${sb.getStatus().lastError})`);

  // ── (7) …but NEVER RESURRECTED once the server's status moves under it ─────────────────────────
  // Another commissioner device locks the week. OPEN->LIVE was refused; LOCKED->LIVE is allowed, so
  // a 'live' re-applied over the new base would plan a leg nobody chose. The fold keeps the edit
  // (RG-252 — it never decides a conflict); the planner's compare-and-set (RG-253) refuses the moved
  // leg LOUDLY and takes the server's status.
  const w1d = ST.weeks.find((w) => w.id === 'w1');
  w1d.status = 'locked'; w1d.locked_at = new Date(NOW).toISOString();
  captureConsole(() => onWeeks6({ eventType: 'UPDATE', new: { ...w1d } }));
  assert(sb.getConfirmedWeekStatus('w1') === 'locked', '[A-RT1] (7) the Realtime LOCKED event advances the confirmed status');
  const plan7 = captureConsole(() => sb.planFlush());
  assert(!plan7.plan.some((o) => o.name === 'transition_week' || o.kind === 'finalize')
    && plan7.refusals.some((e) => e.code === 'status_moved'),
    `[A-RT1] (7) NO transition_week(live) is planned from the moved base — the leg is refused as status_moved (plan ${JSON.stringify(plan7.plan.map((o) => o.name || o.op))}, refusals ${JSON.stringify(plan7.refusals.map((e) => e.code))})`);
  const b7 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  const m7 = weeksNow().find((w) => w.weekId === 'w1');
  assert(ST.weeks.find((w) => w.id === 'w1').status === 'locked' && m7.status === 'locked',
    `[A-RT1] (7) the server stays LOCKED and the mirror takes the server's LOCKED (mirror ${m7.status})`);
  assert(bannerSeen.length > b7 && /is now locked/.test(bannerSeen[bannerSeen.length - 1]),
    `[A-RT1] (7) …and it is LOUD: the banner says the week is now locked and the change was not applied (last banner: ${bannerSeen[bannerSeen.length - 1]})`);
  await captureConsoleAsync(() => sb.flush());
  assert(!sb._dirtyKeysForTest().includes('cfbp_weeks') && !sb._refusedKeysForTest().includes('cfbp_weeks') && sb.getStatus().lastError === null,
    `[A-RT1] (7) the next flush finds nothing left to save: the key is clean and its latch released (RG-254) (lastError ${sb.getStatus().lastError})`);

  // ── (8) SETTINGS (league_kv) — a queued field-scoped write survives another field's event ─────
  await hydrated({ who: 'commissioner' });
  const onKv = handlerFor(sb.subscribeRealtime(), 'league_kv');
  sb.set('cfbp_settings', { ...sb.get('cfbp_settings'), chatEnabled: false }, ['chatEnabled']);
  const kvRow = ST.league_kv.find((r) => r.key === 'settings');
  kvRow.value = { ...kvRow.value, autoRefreshInterval: 30 };            // another device, another field
  captureConsole(() => onKv({ eventType: 'UPDATE', new: { ...kvRow } }));
  const s8 = sb.get('cfbp_settings');
  assert(s8.chatEnabled === false && s8.autoRefreshInterval === 30,
    `[A-RT1] (8) settings: my queued chatEnabled=false survives, and the other device's autoRefreshInterval=30 arrives (got chatEnabled ${s8.chatEnabled}, interval ${s8.autoRefreshInterval})`);
  const plan8 = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_settings');
  assert(plan8.length === 1 && JSON.stringify(Object.keys(plan8[0].args.p_value)) === '["chatEnabled"]' && plan8[0].args.p_mode === 'merge',
    `[A-RT1] (8) …and the patch is exactly the field I changed, merged (got ${JSON.stringify(plan8.map((o) => o.args))})`);

  // ── (9) COMMENTS — not on the Realtime channel today, but the fold is generic: prove it for rows
  //        a player INSERTED (an unsent comment) against another member's INSERT. ───────────────
  await hydrated({ who: 'player' });
  const foldSeam = typeof sb._foldRealtimeRowForTest === 'function' ? sb._foldRealtimeRowForTest : null;
  assert(!!foldSeam, '[A-RT1] (9) the fold is reachable for a table the channel does not bind (_foldRealtimeRowForTest)');
  if (foldSeam) {
    sb.set('cfbp_comments', [...sb.get('cfbp_comments'), {
      commentId: 'c_mine', weekId: 'w1', gameId: 'g1', authorId: 'p2', authorKind: 'player',
      botEventKey: null, body: 'my unsent comment', createdAt: new Date(NOW).toISOString(),
    }]);
    const theirs = row({ league_id: LEAGUE_A, id: 'c_theirs', week_id: 'w1', game_id: 'g1', author_id: 'p1', author_member_id: 'p1', author_kind: 'player', bot_event_key: null, body: 'from the commissioner', created_at: new Date(NOW + 5e3).toISOString() });
    ST.comments.push(theirs);
    captureConsole(() => foldSeam('comments', { eventType: 'INSERT', new: { ...theirs } }));
    const ids = sb.get('cfbp_comments').map((c) => c.commentId).sort();
    assert(ids.includes('c_mine') && ids.includes('c_theirs'),
      `[A-RT1] (9) comments: my unsent comment AND the other member's new one are both in the mirror (got ${JSON.stringify(ids)})`);
    const plan9 = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_comments');
    assert(plan9.length === 1 && plan9[0].op === 'insert' && plan9[0].rows.length === 1 && plan9[0].rows[0].id === 'c_mine',
      `[A-RT1] (9) …and the plan inserts exactly mine — no delete of theirs, no second copy (got ${JSON.stringify(plan9.map((o) => [o.op, (o.rows || []).map((r) => r.id), o.rowId]))})`);
  }

  // ── (10) SECURITY F4 on f16d87c — a Realtime DELETE of a row with a pending PATCH drops the patch;
  //         a pending INSERT survives. Never re-create a row the server just removed. ─────────────
  await hydrated({ who: 'player' });
  const onPicks10 = handlerFor(sb.subscribeRealtime(), 'picks');
  setPick('pk3', 'Ohio State');                                          // pending PATCH of pk3
  sb.set('cfbp_picks', [...sb.get('cfbp_picks').map((p) => ({ ...p })), {   // pending INSERT of a new pick
    pickId: 'pk_new10', weekId: 'w1', gameId: 'g1', playerId: 'p2', selectedTeam: 'Kansas',
    selectedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), locked: false, result: 'pending',
  }]);
  ST.picks = ST.picks.filter((p) => p.id !== 'pk3');                     // the server deletes pk3 (its game went away)
  captureConsole(() => onPicks10({ eventType: 'DELETE', old: { id: 'pk3', league_id: LEAGUE_A } }));
  assert(!pickOf('pk3') && said(/deleted on the server/),
    '[A-RT1] (10) the pending PATCH of a row the server DELETED is dropped (and said so), not re-created in the mirror');
  assert(!!pickOf('pk_new10'), '[A-RT1] (10) …while a pending INSERT of a different row survives the DELETE');
  const plan10 = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_picks');
  assert(!plan10.some((o) => o.op === 'insert' && o.rows.some((r) => r.id === 'pk3'))
    && plan10.some((o) => o.op === 'insert' && o.rows.some((r) => r.id === 'pk_new10')),
    `[A-RT1] (10) …so the plan never INSERTs pk3 back, and still inserts the new pick (${JSON.stringify(plan10.map((o) => [o.op, (o.rows || []).map((r) => r.id), o.rowId]))})`);

  // ── (11) SECURITY F5 on f16d87c — the fold re-applies only an edit captured under THIS mirror's
  //         token, exactly as hydrate()'s rebase does; any other is left to planFlush()'s loud refusal.
  await hydrated({ who: 'player' });
  if (foldSeam) {
    EPOCH = 8;                                                           // the edit is captured under another identity epoch
    setPick('pk2', 'Iowa State');
    EPOCH = 7;
    captureConsole(() => foldSeam('picks', { eventType: 'UPDATE', new: { ...ST.picks.find((p) => p.id === 'pk3') } }));
    assert(pickOf('pk2').selectedTeam === 'Kansas',
      `[A-RT1] (11) an edit captured under another epoch is NOT grafted onto this mirror by the fold (mirror ${pickOf('pk2').selectedTeam})`);
    const r11 = captureConsole(() => sb.planFlush());
    assert(r11.stale.some((s) => s.key === 'cfbp_picks') && !r11.plan.some((o) => o.key === 'cfbp_picks'),
      '[A-RT1] (11) …it stays dirty and planFlush() refuses it as write-during-switch (loud), sending nothing');
  }
});

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-RT2] RG-255 (SEC-1) — a week that goes public over Realtime is RE-READ, and the reveal read is tracked…', async () => {
  // The reveal changes no picks row, so no picks event follows it: after a Realtime weeks event to
  // LIVE this device holds only its own picks for a week every screen now treats as public. The
  // adapter re-reads once (the post-join probe's own path), and `picksReadWhilePublic()` tells a
  // caller building something permanent from the picks whether such a read has landed.
  await hydrated({ who: 'player' });
  // Reviewer F3 — a week counts only if it was ALREADY public when the read began (the selects run
  // in parallel, so the FIRST read that sees it public may have read picks before the reveal).
  assert(sb.picksReadWhilePublic('w2') === false,
    '[A-RT2] the FIRST hydrate that sees w2 live does not count it — nothing proves its picks read came after the reveal');
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  assert(sb.picksReadWhilePublic('w2') === true && sb.picksReadWhilePublic('w1') === false,
    '[A-RT2] a hydrate that began with w2 already live counts it (w2 live: yes; w1 open: no)');
  // THE STRADDLE — w1 goes live on the server while a hydrate is in flight (no Realtime event yet).
  // The read sees weeks=live; its picks read may predate the commit. It must NOT count.
  {
    const w1s = ST.weeks.find((w) => w.id === 'w1');
    const hydrating = sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH });     // requests issued: w1 still open in the base
    w1s.status = 'live'; w1s.revealed_at = new Date(NOW).toISOString(); // the reveal commits mid-read
    await captureConsoleAsync(() => hydrating);
    assert(sb.getConfirmedWeekStatus('w1') === 'live' && sb.picksReadWhilePublic('w1') === false,
      '[A-RT2] a hydrate that STRADDLES the reveal (w1 open when it began, live in its answer) does not count w1 as read while public');
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    assert(sb.picksReadWhilePublic('w1') === true, '[A-RT2] …the next hydrate, begun with w1 already live, does');
    w1s.status = 'open'; w1s.revealed_at = null;                   // back to the fixture for the Realtime half
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  }
  assert(!(sb.get('cfbp_picks') || []).some((p) => p.weekId === 'w1' && p.playerId !== 'p2'),
    '[A-RT2] fixture: on OPEN w1 the player holds only his own picks (RLS)');
  const ch = sb.subscribeRealtime();
  const onWeeks = ch.channel._handlers.find((h) => h.cfg.table === 'weeks').cb;
  const selects0 = CLIENT._calls.selects.length;
  // An update to a week that was ALREADY public triggers nothing.
  captureConsole(() => onWeeks({ eventType: 'UPDATE', new: { ...ST.weeks.find((w) => w.id === 'w2'), blurb: 'x' } }));
  await new Promise((r) => setTimeout(r, 5));
  assert(CLIENT._calls.selects.length === selects0, '[A-RT2] an event on an already-public week does NOT re-read');
  // w1 goes LIVE on the server; the event reaches this phone.
  const w1 = ST.weeks.find((w) => w.id === 'w1');
  w1.status = 'live'; w1.revealed_at = new Date(NOW).toISOString();
  captureConsole(() => onWeeks({ eventType: 'UPDATE', new: { ...w1 } }));
  assert(sb.getConfirmedWeekStatus('w1') === 'live' && sb.picksReadWhilePublic('w1') === false,
    '[A-RT2] the event makes w1 public in the base at once — and it is NOT yet counted as read while public');
  await captureConsoleAsync(() => new Promise((r) => setTimeout(r, 10)));
  assert(CLIENT._calls.selects.length > selects0, '[A-RT2] …and a re-read is scheduled by the event itself');
  assert(sb.picksReadWhilePublic('w1') === true,
    '[A-RT2] once that re-read lands, w1 counts as read while public');
  assert((sb.get('cfbp_picks') || []).some((p) => p.weekId === 'w1' && p.playerId === 'p1'),
    '[A-RT2] …and the other member\'s w1 pick is now on this device (the dashboard is no longer half-blank)');
  captureConsole(() => sb._resetForTest());
  assert(sb.picksReadWhilePublic('w2') === false, '[A-RT2] with no mirror it is false, never a stale yes');
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
// UN-412 / DI-502e (2026-10-01, "Who's in"). refreshWeekProgress() is the adapter's SECOND caller of week_submission_status: the same RPC, the
// same derived never-persisted key, re-asked between hydrates so the strip is not frozen at the last hydrate. Every case below is a way it could
// state a count it has no right to state, or lose one it should keep.
await section('\n[A-PROG] refreshWeekProgress() — the progress answer re-asked between hydrates…', async () => {
  const progKey = () => sb.get('cfbp_week_progress');
  const rpcCalls = () => CLIENT._calls.rpc.filter((c) => c.name === 'week_submission_status');
  const newPick = (id, member, week = 'w1', game = 'g1') => row({ league_id: LEAGUE_A, id, week_id: week, game_id: game, member_id: member, selected_team: 'Kansas', selected_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(), locked: false, result: 'pending' });

  // ── the happy path: someone submitted since the hydrate, and nothing else moves ──
  await hydrated({ who: 'player' });
  const hydrateSeq = sb._hydrateSeqForTest();
  const tagAt = sb._mirrorTagForTest().at;
  const before = progKey();
  assert(before.weeks.w1.p3.pickCount === 0 && before.weeks.w1.p2.pickCount === 2, 'fixture: after the hydrate Koby (p3) has no picks and Kevin (p2) has two');
  ST.picks.push(newPick('pk_prog_1', 'p3', 'w1', 'g1'), newPick('pk_prog_2', 'p3', 'w1', 'g2'));
  const selectsBefore = CLIENT._calls.selects.length;
  const rpcBefore = rpcCalls().length;
  const r = await captureConsoleAsync(() => sb.refreshWeekProgress());
  const after = progKey();
  assert(r.ok === true && JSON.stringify(r.refreshed) === '["w1"]' && r.failed.length === 0, 'a refresh answers { ok:true, refreshed:["w1"] } — the one open week');
  assert(after.weeks.w1.p3.pickCount === 2, 'Koby\'s new full slate is in the answer (2 picks)');
  assert(after.weeks.w1.p2.pickCount === 2 && after.weeks.w1.p1.pickCount === 1, 'and the other members\' counts are what the RPC said');
  assert(!('w2' in after.weeks), 'a LIVE week is never asked for (its rows are public; the client counts them itself)');
  assert(Date.parse(after.at) >= Date.parse(before.at), 'the `at` stamp moves forward (the strip can say "as of")');
  assert(rpcCalls().length === rpcBefore + 1 && rpcCalls()[rpcCalls().length - 1].args.p_league === LEAGUE_A && rpcCalls()[rpcCalls().length - 1].args.p_week === 'w1',
    'exactly ONE week_submission_status call, for the open week, under the active league');
  assert(CLIENT._calls.selects.length === selectsBefore, 'NO table select was issued — a refresh is one RPC and never a re-read of the league');
  assert(sb._hydrateSeqForTest() === hydrateSeq && sb._mirrorTagForTest().at === tagAt, 'and it is not a hydrate: the hydrate sequence and the mirror tag are untouched');
  assert(JSON.stringify([...Object.keys(after.weeks.w1.p3)].sort()) === '["hasExtraPoint","hasTiebreaker","lastUpdated","pickCount"]', 'each entry has exactly the four derived fields and no pick content');
  assert(sb.getState() === 'ACTIVE', 'the adapter stays ACTIVE');

  // ── never persisted, never dirty, still unwritable ──
  assert(sb._dirtyKeysForTest().length === 0, 'the derived key is NEVER dirty after a refresh (nothing is queued to push)');
  assert(!String(localStorage.getItem(sb._snapshotKeyForTest()) || '').includes('cfbp_week_progress'), 'and it is never persisted to the device snapshot (a stale copy would say "nobody has submitted")');
  assert(thrown(() => sb.set('cfbp_week_progress', {})).code === 'derived_key', 'save() on it is still refused');

  // ── the weekIds argument narrows the ask ──
  const rpc1 = rpcCalls().length;
  const rLive = await captureConsoleAsync(() => sb.refreshWeekProgress({ weekIds: ['w2'] }));
  assert(rpcCalls().length === rpc1 && rLive.refreshed.length === 0, 'weekIds:["w2"] (a live week) asks NOTHING');
  const rOne = await captureConsoleAsync(() => sb.refreshWeekProgress({ weekIds: ['w1'] }));
  assert(rpcCalls().length === rpc1 + 1 && rOne.refreshed.join() === 'w1', 'weekIds:["w1"] asks for exactly that week');

  // ── single flight ──
  const rpc2 = rpcCalls().length;
  const pA = sb.refreshWeekProgress(); const pB = sb.refreshWeekProgress();
  const [ra, rb] = await captureConsoleAsync(() => Promise.all([pA, pB]));
  assert(rpcCalls().length === rpc2 + 1 && ra === rb, 'two calls at once share ONE flight (one RPC, the same result object)');
  const rNext = await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(rpcCalls().length === rpc2 + 2 && rNext.ok === true, 'and the flight latch clears: the next call asks again');

  // ── public weeks are pruned from the map ──
  captureConsole(() => sb._seedMirrorForTest('cfbp_week_progress', { at: new Date().toISOString(), weeks: { w1: { p1: { pickCount: 1 } }, w2: { p1: { pickCount: 9 } } } }));
  await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(!('w2' in progKey().weeks), 'a week that has gone live is pruned from the derived map on the next refresh');

  // ── not ACTIVE: a device that has stopped asking does not get to state a count ──
  for (const st of ['ACTIVE-STALE', 'OFFLINE-READONLY', 'HELD', 'IDLE']) {
    captureConsole(() => sb._setStateForTest(st, 'adaptertest'));
    const rpcN = rpcCalls().length;
    const keyBefore = JSON.stringify(progKey());
    const rr = await sb.refreshWeekProgress();
    assert(rr.ok === false && rr.reason === 'not-active' && rpcCalls().length === rpcN && JSON.stringify(progKey()) === keyBefore, `state ${st}: refused ("not-active"), no RPC issued, the key untouched`);
  }
  captureConsole(() => sb._setStateForTest('ACTIVE', 'adaptertest'));

  // ── a FAILED read keeps the previous answer, and does not claim to be fresh ──
  let calls = 0;
  await hydrated({ who: 'player', rpcOverride: (n) => (n === 'week_submission_status' && ++calls > 1 ? { data: null, error: { code: '08006', message: 'network' } } : null) });
  const prevAnswer = JSON.stringify(progKey().weeks);
  const prevAt = progKey().at;
  await new Promise((res) => setTimeout(res, 5));
  const rFail = await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(rFail.ok === false && rFail.failed.join() === 'w1', 'a refused read answers { ok:false, failed:["w1"] }');
  assert(JSON.stringify(progKey().weeks) === prevAnswer, 'the PREVIOUS answer stays on the device (the strip keeps what it knew)');
  assert(progKey().at === prevAt, 'and `at` does NOT advance — "as of" never claims more than was read');
  assert(said(/week_submission_status\(w1\) refused/), 'the refusal is logged by week');

  // ── ...except an account the server no longer recognises ──
  await hydrated({ who: 'player' });
  assert(!!progKey().weeks.w1, 'fixture: the answer is on the device');
  {
    const orig = CLIENT.rpc.bind(CLIENT);
    CLIENT.rpc = (name, args) => (name === 'week_submission_status' ? Promise.resolve(named('not_member')) : orig(name, args));
  }
  await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(!('w1' in progKey().weeks) && !!progKey(), 'not_member DELETES that week\'s entry (it renders as UNKNOWN, never as a stale count or a zero) and the key itself survives');

  // ── identity / league moved while the answer was in flight: DISCARDED ──
  await hydrated({ who: 'player' });
  const keepJson = JSON.stringify(progKey());
  CLIENT.rpc = ((orig) => (name, args) => { if (name === 'week_submission_status') EPOCH = EPOCH + 1; return orig(name, args); })(CLIENT.rpc.bind(CLIENT));
  const rMoved = await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(rMoved.ok === false && rMoved.reason === 'moved' && JSON.stringify(progKey()) === keepJson, 'the identity epoch moved during the await: the answer is DISCARDED and the key is untouched (I6, as for a hydrate)');
  EPOCH = 7;
  await hydrated({ who: 'player' });
  const keepJson2 = JSON.stringify(progKey());
  CLIENT.rpc = ((orig) => (name, args) => { if (name === 'week_submission_status') ACTIVE_LEAGUE = LEAGUE_B; return orig(name, args); })(CLIENT.rpc.bind(CLIENT));
  const rLeague = await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(rLeague.ok === false && rLeague.reason === 'moved' && JSON.stringify(progKey()) === keepJson2, 'the active league changed during the await: DISCARDED');
  ACTIVE_LEAGUE = LEAGUE_A;

  // ── a hydrate that lands while the refresh is in flight WINS ──
  await hydrated({ who: 'player' });
  ST.picks.push(newPick('pk_prog_9', 'p3', 'w1', 'g1'), newPick('pk_prog_10', 'p3', 'w1', 'g2'));
  const staleRows = [{ member_id: 'p1', pick_count: 0, has_tiebreaker: false, has_extra_point: false, last_updated: null }, { member_id: 'p2', pick_count: 0, has_tiebreaker: false, has_extra_point: false, last_updated: null }, { member_id: 'p3', pick_count: 0, has_tiebreaker: false, has_extra_point: false, last_updated: null }];
  const realRpc = CLIENT.rpc.bind(CLIENT);
  let intercepted = 0;
  CLIENT.rpc = (name, args) => {
    if (name === 'week_submission_status' && intercepted === 0) {
      intercepted++;
      // this request's answer arrives only AFTER a full hydrate has landed (and is OLDER than it)
      return (async () => { await sb.hydrate(LEAGUE_A, { epoch: EPOCH }); return { data: staleRows, error: null }; })();
    }
    return realRpc(name, args);
  };
  const seqBefore = sb._hydrateSeqForTest();
  const rRace = await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(sb._hydrateSeqForTest() === seqBefore + 1, 'fixture: a hydrate really landed while the refresh was in flight');
  assert(rRace.ok === false && rRace.reason === 'moved', 'the refresh whose answer is OLDER than that hydrate is dropped ("moved")');
  assert(progKey().weeks.w1.p3.pickCount === 2 && progKey().weeks.w1.p1.pickCount === 1, 'and the hydrate\'s fresher answer is what stays (the stale zeros never overwrite it)');

  // ── one week failing leaves the others, and `at`, alone ──
  initAdapter({ who: 'player' });
  ST.weeks.push(row({ league_id: LEAGUE_A, id: 'w3', sport: 'cfb', season: '2026', week_number: 3, label: 'Week 3', status: 'open', picks_lock_at: null, revealed_at: null }));
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  assert(!!progKey().weeks.w1 && !!progKey().weeks.w3, 'fixture: two open weeks, both answered by the hydrate');
  const atTwo = progKey().at;
  await new Promise((res) => setTimeout(res, 5));
  ST.picks.push(newPick('pk_prog_11', 'p1', 'w1', 'g2'));
  {
    const orig = CLIENT.rpc.bind(CLIENT);
    CLIENT.rpc = (name, args) => (name === 'week_submission_status' && args.p_week === 'w3' ? Promise.resolve({ data: null, error: { code: '08006', message: 'network' } }) : orig(name, args));
  }
  const rPart = await captureConsoleAsync(() => sb.refreshWeekProgress());
  assert(rPart.ok === false && rPart.failed.join() === 'w3' && rPart.refreshed.join() === 'w1', 'one week failing: { ok:false, failed:["w3"], refreshed:["w1"] }');
  assert(progKey().weeks.w1.p1.pickCount === 2 && !!progKey().weeks.w3, 'the week that answered is updated, the one that failed keeps its previous answer');
  assert(progKey().at === atTwo, 'and `at` stays where it was: it advances only when EVERY requested week was read');

  // ── the source, comment-blanked: one RPC, no table read, no persistence, no dirty mark ──
  {
    const codeOnly = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const at0 = codeOnly.indexOf('export function refreshWeekProgress(');
    const fn = codeOnly.slice(at0, codeOnly.indexOf('function _isPlainObject', at0));
    assert(fn.length > 800 && /client\.rpc\('week_submission_status'/.test(fn), 'source: refreshWeekProgress() calls week_submission_status');
    assert(!/\.from\(|\.select\(|_persistSnapshot|_dirty|_schedulePush|emit\(/.test(fn), 'source: it reads no table, persists nothing, marks nothing dirty and emits no status event');
    assert(/_opMoved\(op\)/.test(fn) && /seq !== _hydrateSeq/.test(fn) && /_state !== 'ACTIVE'/.test(fn), 'source: the three discard guards (identity/league moved, a hydrate landed, not ACTIVE) are all present');
    assert(/_state !== 'ACTIVE'\) return Promise\.resolve\(\{ ok: false, reason: 'not-active'/.test(fn), 'source: ACTIVE-only, refused before any client work');
  }
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
  assert(!t.TRANSITION_ALLOWED.includes('live>locked'),
    '[F6] live>locked is NOT in the planner allow-list — unreachable server-side (transition_week raises use_lock_week for any p_to=locked; lock_week requires open)');
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
// [A-MS2] review 2026-09-30 (#10): the client shipped BEFORE migration 0033. The ONE table the new client reads
// that the database does not have yet is `competitions`, and PostgREST answers it 404 / PGRST205. The adapter
// must HOLD on that — the red "couldn't load your league" banner, no snapshot painted, no write path opened —
// never fall to OFFLINE-READONLY (which serves the league behind an amber "you're offline" banner, the wrong
// words for a server that answered) and never quietly hydrate without the table. CLAUDE.md prohibited move:
// never silently fall back when sync fails.
await section('\n[A-MS2] a 404 / PGRST205 on the competitions hydrate HOLDS the client (red banner, never the snapshot)…', async () => {
  const MISSING = "Could not find the table 'public.competitions' in the schema cache";
  const failComp = (status) => ({ competitions: { code: 'PGRST205', message: MISSING, ...(status ? { status } : {}) } });

  // The classifier's own answer for both transports — neither may be 'network', the only class that serves.
  assert(sb._classifyHydrateFailureForTest({ pgCode: 'PGRST205', httpStatus: 404 }) === 'http-status',
    '[A-MS2] PGRST205 + HTTP 404 classifies as http-status (a response existed; something read the request and replied)');
  assert(sb._classifyHydrateFailureForTest({ pgCode: 'PGRST205' }) === 'unclassified',
    '[A-MS2] PGRST205 with NO status classifies as unclassified — the closed default, still not network');

  // (1) FROM A LIVE PAGE — ACTIVE, then the next hydrate meets the missing table.
  {
    assert(await hydrated() === 'ACTIVE' && sb.get('cfbp_weeks').length >= 1,
      '[A-MS2] fixture: a LIVE page — hydrated, ACTIVE, holding the league');
    CLIENT = makeClient(ST, SESSIONS.commissioner, { failTables: failComp(404) });
    bannerSeen.length = 0;
    statuses.length = 0;
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    assert(sb.getState() === 'HELD',
      '[A-MS2] ACTIVE + 404/PGRST205 on competitions -> HELD, not OFFLINE-READONLY (the server ANSWERED)');
    assert(!statuses.some(([, st]) => st === 'OFFLINE-READONLY'),
      '[A-MS2] …and OFFLINE-READONLY was never entered on the way (no amber "you are offline" serving state)');
    assert(sb.isContentWithheldByAdapter() === true && sb.probe() === false,
      '[A-MS2] …content is WITHHELD by the adapter and the write probe is false (nothing painted, nothing written)');
    assert(bannerSeen.some((b) => /Couldn’t load your league/.test(b)),
      `[A-MS2] …and the error was EMITTED with the red banner (${JSON.stringify(bannerSeen)})`);
    assert(/competitions/.test(sb.getStatus().lastError || ''),
      '[A-MS2] …whose last error names the missing table, so the failure is diagnosable and is not a generic hydrate failure');
  }

  // (2) FROM A SNAPSHOT — the device boots ACTIVE-STALE from a persisted snapshot; the hydrate then meets
  //     the missing table. The snapshot must not be served as though nothing were wrong.
  {
    await hydrated();
    const snap = localStorage.getItem(sb._snapshotKeyForTest());
    assert(!!snap, '[A-MS2] fixture: a persisted snapshot exists to prime ACTIVE-STALE from');
    initAdapter({ failTables: failComp(404) });
    localStorage.setItem(sb._snapshotKeyForTest(), snap);
    const primed = sb.primeFromSnapshot(OWNER, LEAGUE_A);
    assert(primed > 0 && sb.getState() === 'ACTIVE-STALE', '[A-MS2] fixture: ACTIVE-STALE, painting the snapshot');
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    assert(sb.getState() === 'HELD' && sb.isContentWithheldByAdapter() === true && sb.probe() === false,
      '[A-MS2] ACTIVE-STALE + 404/PGRST205 -> HELD, content withheld, probe false: the snapshot is NOT served');
    assert(bannerSeen.some((b) => /Couldn’t load your league/.test(b)),
      '[A-MS2] …with the red banner emitted');
  }

  // (3) THE FIRST HYDRATE ON A DEVICE WITH NOTHING — no snapshot, no prior state, no status on the error
  //     (the second transport shape). HELD, and the mirror stays empty: the client does not build a league
  //     out of the tables that did answer.
  {
    initAdapter({ failTables: failComp(0) });
    await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
    assert(sb.getState() === 'HELD' && sb.isReady() === false && sb.isContentWithheldByAdapter() === true,
      '[A-MS2] a FIRST hydrate meeting PGRST205 (no status on the error) is HELD and not ready — it does not serve a partial league');
    assert(bannerSeen.some((b) => /Couldn’t load your league/.test(b)),
      '[A-MS2] …with the red banner emitted');
  }

  // (4) THE CONTROL — same store, same client, the table answering: ACTIVE. So (1)-(3) are the competitions
  //     read and nothing else.
  assert(await hydrated() === 'ACTIVE' && sb.isReady() === true,
    '[A-MS2] control: the same fixture with the competitions table answering hydrates ACTIVE — the holds above are that one read');
  // (5) The source pin: the hydrate does not swallow a failure of THIS table (a `catch` that continues
  //     without it would turn the missing table into a silent, partial league).
  {
    const src = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8');
    assert(/const READ_TABLES = \[[^\]]*'competitions'[^\]]*\]/.test(src),
      '[A-MS2] source pin: competitions is in READ_TABLES, so its failure goes through the same _fail() as every other table');
  }
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

// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-LATCH2] RG-254 — the refusal latch describes what is refused NOW, never an older refusal…', async () => {
  // Found by the RG-251 bugfixer (2026-09-26). After a refused OPEN->LIVE leg the latch held the
  // key until a hydrate landed, whatever it planned next — so the commissioner's valid re-save
  // (Lock Week) was withheld too, and every later flush re-raised "Refusing to move … from open to
  // live" about a leg nobody was asking for any more. The latch now records WHAT it refused.
  const w1 = () => ST.weeks.find((w) => w.id === 'w1');
  const setW1 = (patch) => sb.set('cfbp_weeks', sb.get('cfbp_weeks').map((w) => (w.weekId === 'w1' ? { ...w, ...patch } : { ...w })));
  const lastBanner = () => bannerSeen[bannerSeen.length - 1] || '';
  const lastStatus = () => statuses[statuses.length - 1] && statuses[statuses.length - 1][0];

  // (1) THE REPORTED SYMPTOM — a refused leg, then a VALID re-save, with no hydrate in between.
  await hydrated({ who: 'commissioner' });
  setW1({ status: 'live' });
  await captureConsoleAsync(() => sb.flush());
  assert(/open to live/.test(String(sb.getStatus().lastError)) && sb._refusedKeysForTest().includes('cfbp_weeks'),
    '[A-LATCH2] (1) fixture: OPEN->LIVE is refused and latched');
  setW1({ status: 'locked' });                                            // the one leg the server allows
  const b1 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(w1().status === 'locked', `[A-LATCH2] (1) the valid re-save is SENT at once — lock_week lands without waiting for a hydrate (server ${w1().status})`);
  assert(sb.getStatus().lastError === null && !sb._refusedKeysForTest().length && lastStatus() === 'synced',
    `[A-LATCH2] (1) …and the latch, the error text and the banner all come down ('synced'; lastError ${sb.getStatus().lastError})`);
  assert(!bannerSeen.slice(b1).some((b) => /open to live/.test(b)),
    '[A-LATCH2] (1) …and the stale "open to live" sentence is never raised again after the re-save');

  // (2) TWO REFUSALS, ONE FIXED — the banner names the one still refused, in its own words.
  await hydrated({ who: 'commissioner' });
  setW1({ status: 'live' });                                              // planner refusal (weeks)
  sb.set('cfbp_picks', sb.get('cfbp_picks').map((p) => (p.pickId === 'pk4' ? { ...p, selectedTeam: 'Nebraska' } : { ...p })));
  await captureConsoleAsync(() => sb.flush());                          // pk4 is on a LIVE week: the server refuses it
  assert(JSON.stringify(sb._refusedKeysForTest().sort()) === '["cfbp_picks","cfbp_weeks"]',
    `[A-LATCH2] (2) fixture: both keys refused (${JSON.stringify(sb._refusedKeysForTest())})`);
  setW1({ status: 'locked' });
  const b2 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(w1().status === 'locked' && JSON.stringify(sb._refusedKeysForTest()) === '["cfbp_picks"]',
    `[A-LATCH2] (2) the fixed key saves and is released; the other stays latched (${JSON.stringify(sb._refusedKeysForTest())})`);
  assert(bannerSeen.length > b2 && !/open to live/.test(lastBanner()) && /policy matched no row/.test(lastBanner()),
    `[A-LATCH2] (2) the banner now speaks for cfbp_picks, not for the saved week (${lastBanner()})`);
  assert(!/open to live/.test(String(sb.getStatus().lastError)), `[A-LATCH2] (2) …and so does lastError (${sb.getStatus().lastError})`);

  // (3) AN IDENTICAL PLAN IS STILL NOT RETRIED BLINDLY (§5.2) — the loud-fail half is unchanged.
  const pickUpdates = () => CLIENT._calls.updates.filter((u) => u.table === 'picks').length;
  const u3 = pickUpdates();
  const b3 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(pickUpdates() === u3, '[A-LATCH2] (3) the refused pick is NOT re-sent while it plans the same thing');
  assert(bannerSeen.length > b3 && lastStatus() === 'refused' && sb._dirtyKeysForTest().includes('cfbp_picks'),
    '[A-LATCH2] (3) …and the banner stays up, the pick still named as unsaved');
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
    // AMENDED 2026-09-26 (RG-253 compare-and-set + reviewer F5): the finalize was made against LIVE and
    // the server has since moved the week to LOCKED, so the re-read is where the compare-and-set sees
    // the move — the leg is refused LOUDLY as status_moved (the red banner above), the mirror takes the
    // server's LOCKED, and one follow-up run finds nothing left to send. It is no longer "queued":
    // it was a leg from a status the week is no longer at. What must still hold is that it was NOT
    // silently dropped (the banner) and NOT sent (the server is still LOCKED).
    assert(ST.weeks.find((w) => w.id === 'w2').status === 'locked'
      && sb.get('cfbp_weeks').find((w) => w.weekId === 'w2').status === 'locked'
      && bannersSince(m10).some((t) => /status moved|now locked/i.test(t)),
      `[A-RETRY9] (b) …the refused leg was never sent (server still LOCKED), the device shows the server's LOCKED, and the banner says the status moved (${JSON.stringify(bannersSince(m10))})`);
  }

  {
    // (c) PF-1 (2026-10-01, DI-494 / DI-492) — THE SERVER LOCKED FIRST. From migration 0039 the cron job auto_lock_weeks() locks a due week with no device. A commissioner whose device ticked
    // (or who pressed Lock Week) in the same minute planned lock_week from the base it had read, `open`; by the time the RPC lands the server says `locked`, so lock_week answers `bad_transition`.
    // That is the 23505 of the lock path: the retry of a write whose goal was already met by someone else. It must be classified `conflict` (a re-read), end CLEAN with no banner, and must
    // NEVER be silenced when the week genuinely is not lockable (part 2 below).
    const t11 = makeFakeTimers();
    await hydrated({ who: 'commissioner', timers: t11 });
    const wk11 = sb.get('cfbp_weeks').map((x) => ({ ...x }));
    wk11.find((x) => x.weekId === 'w1').status = 'locked';
    sb.set('cfbp_weeks', wk11);
    assert(sb.planFlush().plan.some((o) => o.kind === 'rpc' && o.name === 'lock_week'),
      '[A-RETRY9] (c) fixture — the plan really is lock_week from the base the device read (open)');
    ST.weeks.find((w) => w.id === 'w1').status = 'locked';       // the job got there first
    const m11 = bannerSeen.length;
    await captureConsoleAsync(() => sb.flush());
    assert(!bannersSince(m11).some((t) => /Nothing was saved|bad_transition/.test(t)),
      `[A-RETRY9] (c) a bad_transition on lock_week raises no banner on the first attempt (${JSON.stringify(bannersSince(m11))})`);
    assert(t11.count() === 1, `[A-RETRY9] (c) …it arms a re-read instead (${JSON.stringify(t11.delays())})`);
    await captureConsoleAsync(() => t11.runNext());
    assert(!bannersSince(m11).some((t) => /Nothing was saved|bad_transition|status moved/i.test(t)),
      `[A-RETRY9] (c) …and the rebase finds the week already locked, so the operation vanishes and nothing is reported (${JSON.stringify(bannersSince(m11))})`);
    assert(!sb._refusedKeysForTest().length && !sb._dirtyKeysForTest().includes('cfbp_weeks') && sb.get('cfbp_weeks').find((x) => x.weekId === 'w1').status === 'locked',
      `[A-RETRY9] (c) …the run ends CLEAN, the device shows the server's LOCKED, and nothing is left pending (${JSON.stringify(sb._refusedKeysForTest())}, ${JSON.stringify(sb._dirtyKeysForTest())})`);
    assert(!CLIENT._calls.rpc.some((c) => c.name === 'transition_week'),
      '[A-RETRY9] (c) …and no transition_week was ever sent to repair it (the lock is not re-issued, nothing is reopened)');
  }
  {
    // (c2) …but a lock_week that is REALLY not allowed still ends red: the week is DRAFT on the server, nothing locked it, and the re-read finds a genuine refusal.
    const t12 = makeFakeTimers();
    await hydrated({ who: 'commissioner', timers: t12 });
    const wk12 = sb.get('cfbp_weeks').map((x) => ({ ...x }));
    wk12.find((x) => x.weekId === 'w1').status = 'locked';
    sb.set('cfbp_weeks', wk12);
    ST.weeks.find((w) => w.id === 'w1').status = 'draft';        // someone sent it back to draft: lock_week requires open
    const m12 = bannerSeen.length;
    await captureConsoleAsync(() => sb.flush());
    let guard12 = 0;
    while (t12.count() && guard12++ < 6) await captureConsoleAsync(() => t12.runNext());
    assert(ST.weeks.find((w) => w.id === 'w1').status === 'draft' && bannersSince(m12).some((t) => /bad_transition|Nothing was saved|Refusing to lock|status moved|now draft/i.test(t)),
      `[A-RETRY9] (c2) a lock_week that is genuinely refused still ends RED — the re-read is a check, not a silencer, and the server's DRAFT was never overwritten (${JSON.stringify(bannersSince(m12))})`);
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

// ══════════════════════════════════════════════════════════════════════════
// SB-01 / RG-265 — HYDRATE-ROW-CAP (architecture audit 2026-09-26; latent, not yet seen live).
//
// `_select()` issued ONE unordered, unranged, uncounted select per table. Hosted PostgREST caps
// every read at "Max rows" (1,000 by default) and truncates SILENTLY — HTTP 200, a partial array —
// and RG-12's guard fires only when a read is entirely EMPTY, so a short read was adopted as the
// league. `picks` crosses 1,000 at ~6 players x 12 games x 14 weeks. The fake above now models
// the cap; these assertions are the reproduction made permanent.
//
// The crux, asserted by (2): the server's cap is UNKNOWN to the client and may be SMALLER than the
// page size it asks for, so "a page shorter than I asked for is the last page" is exactly the
// silent-truncation rule again. Completeness has to be PROVEN — by the exact count that arrives
// in the same statement as the first page, or by reading the key range until it is exhausted.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-PAGE] SB-01 / RG-265 — every hydrate read is PAGED and PROVEN complete; a server row cap never truncates a table silently…', async () => {
  const KEYS = Object.keys(sb._routesForTest());
  const canonOf = (v) => JSON.stringify(v === undefined ? null : v);
  const snapshot = () => Object.fromEntries(KEYS.map((k) => [k, canonOf(sb.get(k))]));
  const hasPageSeam = typeof sb._setHydratePageSizeForTest === 'function';
  const hasKeySeam = typeof sb._hydratePageKeyForTest === 'function';
  assert(hasPageSeam, '[A-PAGE] the hydrate page size is drivable from a test (_setHydratePageSizeForTest) — the page-size-below-cap and boundary cases need it');
  assert(hasKeySeam, '[A-PAGE] the column each table is ordered and keyset-paged on is readable from a test (_hydratePageKeyForTest)');
  const pageKey = (t) => (hasKeySeam ? sb._hydratePageKeyForTest(t) : null);
  const PAST = (s) => new Date(NOW - s * 1000).toISOString();

  /** Grows LEAGUE_A in place. Every added row is visible to the commissioner (final weeks; his own
   *  notifications), so the expected count per table is simply what RLS admits. Rows are pushed in
   *  REVERSE key order, so store order is not key order and nothing passes by accident of insertion. */
  function grow(st, { extraMembers = [], weeks = 0, gamesPerWeek = 0, notes = 0 } = {}) {
    const add = (table, rows) => st[table].push(...rows.reverse());
    add('league_members', extraMembers.map((id) => row({ league_id: LEAGUE_A, id, user_id: `u-${id}`, role: 'player', display_name: id.toUpperCase(), initials: id.toUpperCase(), alma_mater: '', active: true, email: `${id}@example.com`, phone: '', phone_verified: false, notify_prefs: {}, preferences: {} })));
    const members = [...new Set(st.league_members.filter((m) => m.league_id === LEAGUE_A && m.active).map((m) => m.id))];
    const wk = [], gm = [], pk = [];
    for (let w = 1; w <= weeks; w++) {
      const wid = `wb${String(w).padStart(2, '0')}`;
      wk.push(row({ league_id: LEAGUE_A, id: wid, sport: 'cfb', season: '2026', week_number: 100 + w, label: `Bulk ${w}`, status: 'final', picks_lock_at: PAST(90000), revealed_at: PAST(80000), locked_at: PAST(90000), locked_alma_maters: [], pending_finalization: false }));
      for (let g = 1; g <= gamesPerWeek; g++) {
        const gid = `g${wid}_${String(g).padStart(2, '0')}`;
        gm.push(row({ league_id: LEAGUE_A, id: gid, week_id: wid, home_team: `H${g}`, away_team: `A${g}`, status: 'final', kickoff: PAST(86000), spread: -3, favorite: `H${g}`, multiplier: 1, home_score: 10, away_score: 7, last_updated: null, ats_winner: null }));
        for (const m of members) {
          pk.push(row({ league_id: LEAGUE_A, id: `pk_${gid}_${m}`, week_id: wid, game_id: gid, member_id: m, selected_team: `H${g}`, selected_at: PAST(87000), updated_at: PAST(87000), locked: true, result: 'win' }));
        }
      }
    }
    add('weeks', wk); add('games', gm); add('picks', pk);
    const nt = [];
    for (let i = 1; i <= notes; i++) {
      const id = `nt_bulk_${String(i).padStart(3, '0')}`;
      nt.push(row({ league_id: LEAGUE_A, id, member_id: 'p1', origin: 'client', event: 'PICKS_OPEN', actor: null, title: `Note ${i}`, body: 'bulk', destination: null, created_at: PAST(i), read_at: null, dedup_key: id, week_id: null, meta: null }));
    }
    add('notifications', nt);
  }
  /** What the commissioner's RLS admits from `picks` in LEAGUE_A — his own, plus every live/final week's. */
  const visiblePicks = (st) => st.picks.filter((r) => r.league_id === LEAGUE_A && (r.member_id === 'p1'
    || ['live', 'final'].includes((st.weeks.find((w) => w.league_id === LEAGUE_A && w.id === r.week_id) || {}).status))).length;

  async function hydrateWith(clientOpts, growOpts, pageSize = null) {
    initAdapter({ who: 'commissioner', ...clientOpts });
    if (pageSize !== null && hasPageSeam) sb._setHydratePageSizeForTest(pageSize);
    grow(ST, growOpts);
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    return { state: sb.getState(), snap: snapshot(), selects: CLIENT._calls.selects.slice(), st: ST };
  }
  const diffKeys = (a, b) => KEYS.filter((k) => a.snap[k] !== b.snap[k]);

  // ── (1) THE REPRODUCTION, at the hosted default: Max rows 1,000, a late-season picks table ─────
  // 6 members x 12 games x 14 final weeks = 1,008 picks, plus the fixture's own three he can see.
  {
    const r = await hydrateWith({}, { extraMembers: ['p4', 'p5', 'p6'], weeks: 14, gamesPerWeek: 12 });
    const want = visiblePicks(r.st);
    const got = (sb.get('cfbp_picks') || []);
    assert(want === 1011, `[A-PAGE](1) fixture: the league holds ${want} picks this commissioner may see — past the 1,000-row hosted cap`);
    assert(r.state === 'ACTIVE' && got.length === want,
      `[A-PAGE](1) at Supabase's default Max rows (1,000) EVERY one of the ${want} picks reaches the mirror (got ${got.length}, state ${r.state}) — the unpaged read kept 1,000 and adopted them as the league, with no error`);
    assert(new Set(got.map((p) => p.pickId)).size === got.length,
      '[A-PAGE](1) …and no pick is duplicated across a page boundary');
    const pickReads = r.selects.filter((s) => s.table === 'picks').length;
    assert(pickReads === 2,
      `[A-PAGE](1) …in ceil(1011/1000) = 2 requests: a full first page proves the cap is at least the page size, so the short second page is the end and no empty third page is asked for (picks requests: ${pickReads})`);
  }

  // ── (2) THE CRUX: a server cap SMALLER than the page size is detected, never read as "the end" ───
  const SMALL = { extraMembers: ['p4', 'p5', 'p6'], weeks: 4, gamesPerWeek: 4, notes: 12 };
  const ref = await hydrateWith({ maxRows: Infinity }, SMALL);
  assert(ref.state === 'ACTIVE' && JSON.parse(ref.snap.cfbp_picks).length === 99 && JSON.parse(ref.snap.cfbp_players).length === 6,
    `[A-PAGE](2) fixture: the UNCAPPED reference read is complete (state ${ref.state}; 99 picks, 6 members, 7 league_kv rows, 13 own notifications)`);
  const cap5 = await hydrateWith({ maxRows: 5 }, SMALL);
  assert(cap5.state === 'ACTIVE' && diffKeys(cap5, ref).length === 0,
    `[A-PAGE](2) server cap 5 under a page size of 1,000: every routed key is byte-identical to the uncapped read (state ${cap5.state}; keys that differ: ${JSON.stringify(diffKeys(cap5, ref))})`);

  // ── (3) a page size SMALLER than the cap, and pages that end exactly on a table's last row ──────
  // Page size 3: 99 picks and 6 members are exact multiples, so the last full page is followed by
  // an empty one — the boundary where an off-by-one either drops the tail or never stops.
  const p3cap5 = await hydrateWith({ maxRows: 5 }, SMALL, 3);
  assert(p3cap5.state === 'ACTIVE' && diffKeys(p3cap5, ref).length === 0,
    `[A-PAGE](3) page size 3 under a cap of 5: byte-identical to the uncapped read (state ${p3cap5.state}; differs: ${JSON.stringify(diffKeys(p3cap5, ref))})`);
  const p7cap7 = await hydrateWith({ maxRows: 7 }, SMALL, 7);
  assert(p7cap7.state === 'ACTIVE' && diffKeys(p7cap7, ref).length === 0,
    `[A-PAGE](3) page size = cap = 7 = league_kv's exact row count: byte-identical (state ${p7cap7.state}; differs: ${JSON.stringify(diffKeys(p7cap7, ref))})`);
  const kvReads = p7cap7.selects.filter((s) => s.table === 'league_kv').length;
  assert(kvReads === 1,
    `[A-PAGE](3) …and the table that fits exactly is ONE request: the count in the same statement proves page 1 complete (league_kv requests: ${kvReads})`);

  // ── (3b) THE CRUX, BY REQUEST COUNT: when is a short page trusted as the end? ──────────────────
  // The rule (pass 2): a page ends the read when it is shorter than it asked for AND shorter than
  // the largest page this server has already returned — a cap at least that large cannot have
  // shortened it. A page EQUAL to the largest one so far proves nothing (it may be the cap), and the
  // read goes on.
  //   • league_kv, 7 rows, page size 3, no cap: pages 3,3,1 — the 1 is short of both, 3 requests.
  //   • league_kv, 7 rows, cap 5, page size 1,000: pages 5,2 — the 2 is short of the 5 the server
  //     already returned, so it is the end: 2 requests.
  //   • 10 own notifications, cap 5: pages 5,5,0 — the second 5 could be the cap again, so the read
  //     asks once more and gets an empty page: 3 requests. A loop that ended on the first short page
  //     would have stopped at 5 rows (that is (2)'s mutant).
  {
    const p3open = await hydrateWith({ maxRows: Infinity }, SMALL, 3);
    const kv3 = p3open.selects.filter((s) => s.table === 'league_kv').length;
    assert(p3open.state === 'ACTIVE' && diffKeys(p3open, ref).length === 0 && kv3 === 3,
      `[A-PAGE](3b) page size 3, no cap: pages 3,3,1 — the short page ends the read (league_kv requests: ${kv3}, want 3; differs: ${JSON.stringify(diffKeys(p3open, ref))})`);
    const kv5 = cap5.selects.filter((s) => s.table === 'league_kv');
    assert(kv5.length === 2 && kv5[1].gt.length === 1,
      `[A-PAGE](3b) cap 5 under page size 1,000: pages 5,2 — a page shorter than one the server already returned ends the read (league_kv requests: ${kv5.length}, want 2)`);
    const ten = await hydrateWith({ maxRows: 5 }, { notes: 9 });
    const ntReads = ten.selects.filter((s) => s.table === 'notifications').length;
    const nts = (sb.get('cfbp_notifications') || []).length;
    assert(ten.state === 'ACTIVE' && nts === 10 && ntReads === 3,
      `[A-PAGE](3b) 10 rows under a cap of 5: pages 5,5,0 — a page EQUAL to the cap is never trusted as the end, so the read asks until a page proves it (notifications ${nts}/10 in ${ntReads} requests, want 3)`);
  }

  // ── (4) no count (a proxy that strips Content-Range): still complete, by reading to an empty page ─
  const noCount = await hydrateWith({ maxRows: 5, dropCount: true }, SMALL);
  assert(noCount.state === 'ACTIVE' && diffKeys(noCount, ref).length === 0,
    `[A-PAGE](4) with the count withheld and a cap of 5, the read still completes — it reads the key range until it is exhausted, never trusts a short page (state ${noCount.state}; differs: ${JSON.stringify(diffKeys(noCount, ref))})`);

  // ── (5) EVERY request — the continuation pages included — is league-scoped and key-ordered ──────
  {
    const unscoped = cap5.selects.filter((s) => !s.eq.some(([c, v]) => c === 'league_id' && v === LEAGUE_A));
    assert(cap5.selects.length > sb._readTablesForTest().length && unscoped.length === 0,
      `[A-PAGE](5) every one of the ${cap5.selects.length} paged requests carries .eq('league_id', <active league>) — DI-184d holds on the continuation pages too (unscoped: ${unscoped.length})`);
    const unordered = cap5.selects.filter((s) => !s.order || s.order.col !== pageKey(s.table) || s.order.ascending !== true);
    assert(unordered.length === 0,
      `[A-PAGE](5) every request is ordered ASCENDING on its table's page key, so the keyset is exact (unordered: ${JSON.stringify(unordered.slice(0, 3).map((s) => [s.table, s.order]))})`);
    const cont = cap5.selects.filter((s) => s.gt.length);
    assert(cont.length > 0 && cont.every((s) => s.gt.length === 1 && s.gt[0][0] === pageKey(s.table)),
      `[A-PAGE](5) a continuation page is a KEYSET read on the same column (.gt(pageKey, lastKey)), never an offset a concurrent insert or delete could shift (continuations: ${cont.length})`);
    const lmCols = cap5.selects.filter((s) => s.table === 'league_members').map((s) => s.cols);
    assert(lmCols.length > 1 && lmCols.every((c) => c === sb._selectColsForTest().league_members),
      '[A-PAGE](5) league_members keeps its 0007 column list on EVERY page (select(*) is refused on a column-granted table)');
  }

  // ── (6) the common case costs NOTHING extra: one request per table, each carrying the count ─────
  {
    initAdapter({ who: 'commissioner' });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const sel = CLIENT._calls.selects;
    assert(sb.getState() === 'ACTIVE' && sel.length === sb._readTablesForTest().length,
      `[A-PAGE](6) a league whose every table fits one page is read in exactly ${sb._readTablesForTest().length} requests, one per READ_TABLE — no extra round trip (got ${sel.length})`);
    assert(sel.every((s) => s.count === 'exact'),
      '[A-PAGE](6) …and each of them asks for the EXACT count, which is what proves that single page complete');
  }

  // ── (7) the page key IS the primary key, derived from the schema rather than restated ──────────
  // From EVERY migration, in file order (a READ_TABLE need not be born in 0001: `competitions` is 0033's),
  // comments blanked first exactly as schemaFromMigrations() does; the LAST `create table` of a name wins.
  {
    const dir = join(__dirname, 'supabase', 'migrations');
    const sqls = readdirSync(dir).filter((f) => /^\d{4}_[^/]*\.sql$/.test(f)).sort()
      .map((f) => readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, ''));
    const drift = [];
    for (const t of sb._readTablesForTest()) {
      let body = '';
      for (const sql of sqls) {
        const c = new RegExp(`create table (?:if not exists )?public\\.${t}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql);
        if (c) body = c[1];
      }
      // D1 DI-531 — `competition_members`' real key is the COMPOSITE (league_id, competition_id, league_member_id) (0033 §5); a keyset read needs ONE unique column, and the table carries one:
      // `id text generated always as (competition_id::text || ':' || league_member_id) stored`. A composite key whose table has such a generated `id` is paged on it — and ONLY then:
      // any other composite key (or a generated column that is not `id`) still reads as drift, so this exception cannot hide a real mismatch.
      const generatedId = /(^|[\s,(])id\s+text\s+generated\s+always\s+as\s*\(/i.test(body);
      const m = body.match(/primary key \(league_id, (\w+)\)/) || (generatedId && /primary key \(league_id, \w+, \w+/.test(body) ? [null, 'id'] : null);
      if (!m || pageKey(t) !== m[1]) drift.push(`${t}: schema ${m ? m[1] : '?'} vs adapter ${pageKey(t)}`);
      const cols = sb._selectColsForTest()[t];
      if (cols && !cols.split(',').includes(pageKey(t))) drift.push(`${t}: SELECT_COLS lacks ${pageKey(t)}`);
    }
    assert(drift.length === 0,
      `[A-PAGE](7) every READ_TABLE is paged on its PRIMARY KEY's non-league column (league_id is pinned by the eq), derived from every migration, and its select list carries that column (drift: ${JSON.stringify(drift)})`);
  }

  // ── (8) a server that IGNORES the keyset is refused LOUDLY — never a hang, never adopted ─────────
  {
    await hydrated({ who: 'commissioner' });
    const before = snapshot();
    const mark = detailSeen.length;
    CLIENT = makeClient(ST, SESSIONS.commissioner, { maxRows: 5, ignoreGt: true });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const evs = detailSeen.slice(mark).filter(([s, d]) => s === 'error' && d && 'banner' in d).map(([, d]) => d);
    assert(sb.getState() === 'HELD',
      `[A-PAGE](8) a server that answers every page with the FIRST page again leaves the device HELD, not ACTIVE on a truncated read (state ${sb.getState()})`);
    assert(said(/HydratePagingError.*repeated a row/) && !said(/TEST_RUNAWAY|runaway/),
      `[A-PAGE](8) …refused by the adapter's own NAMED paging check (the console carries it), not by the fake's runaway breaker — the loop terminates on its own`);
    assert(evs.length > 0 && evs.every((d) => d.error === d.banner && !/select |repeated|HydratePaging/i.test(String(d.error))),
      `[A-PAGE](8) …and the banner says the adapter's plain sentence, never the paging detail (${JSON.stringify(evs.map((d) => d.error))})`);
    assert(KEYS.every((k) => snapshot()[k] === before[k]),
      '[A-PAGE](8) …and the league this device already held is preserved untouched');
  }

  // ── (9) a count with NO rows (a body truncated to nothing) is a partial read, not an empty league ─
  {
    initAdapter({ who: 'commissioner', maxRows: 0 });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    assert(sb.getState() === 'HELD' && said(/HydratePagingError.*counted \d+ rows? but returned none/),
      `[A-PAGE](9) a first page that returns zero rows while the same statement counts N is REFUSED on a first boot too, where RG-12's held-data guard cannot fire (state ${sb.getState()})`);
    assert(said(/RG-12 \(b\)/),
      '[A-PAGE](9) …classified as a PARTIAL READ (_fail\'s partial-read branch spoke: the server answered, and the answer was incomplete) — HELD, never OFFLINE-READONLY');
  }

  // ══ SB-01 PASS 2 ═════════════════════════════════════════════════════════════════════════════
  // The `_fail()` emit (the one carrying `banner`), not `_setState('HELD')`'s own status emit beside it.
  const lastErrorEv = () => { const e = detailSeen.filter(([s, d]) => s === 'error' && d && 'banner' in d).pop(); return e ? e[1] : null; };
  const commentIds = () => (sb.get('cfbp_comments') || []).map((c) => c.commentId).sort();
  const storeCommentIds = (st) => st.comments.filter((c) => c.league_id === LEAGUE_A).map((c) => c.id).sort();
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // the fake's order: one comparator for sort and gt

  // ── (10) SECURITY S-C1 — A MEMBER-AUTHORED KEY NEVER GOES INTO A URL IT WOULD BREAK ────────────────
  // A member can insert comments with any id (comments_insert checks the author, not the id). The
  // attack: 999 short ids that sort first, then ONE 6 KB id of a repeated 3-byte character, so it
  // lands 1,000th — the LAST row of page one. A keyset continuation would send `.gt(id, <6 KB>)`:
  // ~18,000 characters percent-encoded, past the gateway's 16,384, so every device's hydrate gets a
  // 414 and HOLDS — a league withheld from all six by one member, with recovery only by SQL. The
  // fake here refuses any URL over 16,384 characters exactly as the gateway does.
  const LONG_KEY = '0000999' + '€'.repeat(2000);
  function plantLongKey(st) {
    const rows = [];
    for (let i = 0; i < 999; i++) {
      rows.push(row({ league_id: LEAGUE_A, id: `0${String(i).padStart(6, '0')}`, week_id: 'w1', game_id: 'g1', author_id: 'p2', author_member_id: 'p2', author_kind: 'player', bot_event_key: null, body: '', created_at: PAST(60) }));
    }
    rows.push(row({ league_id: LEAGUE_A, id: LONG_KEY, week_id: 'w1', game_id: 'g1', author_id: 'p2', author_member_id: 'p2', author_kind: 'player', bot_event_key: null, body: '', created_at: PAST(60) }));
    // REVIEWER N1 (SB-01 pass 3) — LEAGUE B's comments, sorting AFTER the anchor. The commissioner's
    // account (u-drew) is a member of BOTH leagues, so RLS alone would hand these to a request that
    // dropped `.eq('league_id', …)`: an unscoped offset page pulls them into league A's mirror, which
    // is the cross-league read DI-184d forbids — and without them, RLS hid that mutant entirely.
    for (const id of ['x_b1', 'x_b2', 'x_b3']) {
      rows.push(row({ league_id: LEAGUE_B, id, week_id: 'x1', game_id: 'y1', author_id: 'q1', author_member_id: 'q1', author_kind: 'player', bot_event_key: null, body: 'league B', created_at: PAST(60) }));
    }
    st.comments.push(...rows.reverse());
  }
  /** DI-184d on EVERY request of a read, offset pages included. */
  const unscopedOf = (sel) => sel.filter((s) => !s.eq.some(([c, v]) => c === 'league_id' && v === LEAGUE_A));
  for (const phase of ['first hydrate', 're-hydrate of an ACTIVE device']) {
    initAdapter({ who: 'commissioner' });                 // the default fake: 1,000-row cap, 16,384-char URLs
    if (phase !== 'first hydrate') {
      await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
      assert(sb.getState() === 'ACTIVE' && commentIds().length === 2, `[A-PAGE](10) fixture: the device is ACTIVE on the clean league before the rows are planted (${sb.getState()})`);
    }
    plantLongKey(ST);
    const mark = CLIENT._calls.selects.length;
    const errsBefore = detailSeen.filter(([s]) => s === 'error').length;
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const sel = CLIENT._calls.selects.slice(mark);
    const want = storeCommentIds(ST);
    const got = commentIds();
    assert(sb.getState() === 'ACTIVE' && want.length === 1002 && sameList(got, want),
      `[A-PAGE](10) ${phase}: a 6 KB member-authored id at the page boundary — the device ends ACTIVE with EVERY comment (state ${sb.getState()}; ${got.length}/${want.length}) — before pass 2 the keyset read put it in a URL, got a 414 and HELD the league`);
    assert(got.includes(LONG_KEY) && got.includes('c1') && got.includes('c2'),
      `[A-PAGE](10) ${phase}: …the planted row itself AND the rows that sort after it are all present`);
    const longest = Math.max(...sel.map((s) => s.urlLength));
    assert(longest < 2048,
      `[A-PAGE](10) ${phase}: …and no request URL was long: the longest this hydrate sent was ${longest} characters (the key is never put into a URL past the bound)`);
    const cont = sel.filter((s) => s.table === 'comments').slice(1);
    assert(cont.length >= 1 && cont[0].gt.length === 0 && cont[0].offset === 999,
      `[A-PAGE](10) ${phase}: …the page after the long key is read by OFFSET from that key's own position (offset 999, anchored on it), not by keyset (${JSON.stringify(cont.map((s) => ({ gt: s.gt.length, offset: s.offset })))})`);
    assert(detailSeen.filter(([s]) => s === 'error').length === errsBefore,
      `[A-PAGE](10) ${phase}: …and no error was raised at any point`);
    assert(unscopedOf(sel).length === 0 && !got.some((id) => /^x_b/.test(id)),
      `[A-PAGE](10) ${phase}: …every one of the ${sel.length} requests — the OFFSET page included — carries .eq('league_id', <league A>), and none of league B's comments (readable to this account through RLS) reached league A's mirror (unscoped: ${JSON.stringify(unscopedOf(sel).map((s) => [s.table, s.offset]))})`);
  }

  // ── (11) AN OFFSET PAGE IS ANCHORED: a shift before it is caught, even when the count still adds up ──
  // Offset's weakness is that a delete BEFORE the offset slides every later row back one, and the
  // row that slides into the gap is silently skipped. Worse, an insert past the end can put the
  // total back where it was, so the count cannot see it. Here, as the offset page is served, one row
  // already read is deleted and one row is inserted at the end: a blind offset would skip 'c1' and
  // still collect exactly the counted number of rows. The page starts ONE row early, on the last key
  // already read; that row must come back first, or the table is re-read from the top.
  {
    let fired = false;
    initAdapter({ who: 'commissioner', beforeSelect: (b) => {
      if (fired || b._table !== 'comments' || !b._ranged || !(b._offset > 0)) return;
      fired = true;
      ST.comments.splice(ST.comments.findIndex((c) => c.id === '0000000'), 1);
      ST.comments.push(row({ league_id: LEAGUE_A, id: 'zz_new', week_id: 'w1', game_id: 'g1', author_id: 'p2', author_member_id: 'p2', author_kind: 'player', bot_event_key: null, body: '', created_at: PAST(1) }));
    } });
    plantLongKey(ST);
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const want = storeCommentIds(ST);
    const got = commentIds();
    const firstPages = CLIENT._calls.selects.filter((s) => s.table === 'comments' && s.count === 'exact').length;
    assert(fired, '[A-PAGE](11) fixture: the table moved between two pages of one read (a delete before the offset, an insert after it)');
    assert(sb.getState() === 'ACTIVE' && sameList(got, want) && got.includes('c1') && !got.includes('0000000'),
      `[A-PAGE](11) the shift is caught by the anchor and the table is read again: every row the server now holds, 'c1' included (state ${sb.getState()}; ${got.length}/${want.length}; c1 ${got.includes('c1')})`);
    assert(firstPages === 2 && said(/moved while it was being read/),
      `[A-PAGE](11) …by a re-read of that table from the top, said in the console (comments first pages: ${firstPages}, want 2)`);
    const sel11 = CLIENT._calls.selects;
    assert(unscopedOf(sel11).length === 0 && !got.some((id) => /^x_b/.test(id)),
      `[A-PAGE](11) …and every request of it, the anchored offset pages and the re-read included, carries .eq('league_id', <league A>) — no league-B row in the mirror (unscoped: ${JSON.stringify(unscopedOf(sel11).map((s) => [s.table, s.offset]))})`);
  }

  // ── (12) A SHORTFALL AGAINST THE COUNT: the read goes on to a PROOF, never restarts, never truncates ─
  // Pass 3 (reviewer N2). A read that ends short of its own first-page count used to restart from the
  // top — and a member deleting rows while it ran could spend all three reads and HOLD every device.
  // Now a short page the count contradicts does not end the read: it CONTINUES by keyset from the last
  // key until an EMPTY page (rule 3), which proves no row is left past the last key read. Keyset pages
  // never miss a row that existed for the whole read, so a shortfall that survives an empty page can
  // only be rows DELETED while the read ran: adopted, with a console warning. The count therefore
  // never ENDS a read early — rule 1 needs rows >= count — it can only make a read go further.
  // (a) Max rows drops from 1,000 to 5 between two pages of the picks read. The second page's 5 rows
  //     are short of the 1,000 the server already returned, so on their own they would end the read at
  //     1,005 of 1,011. The count contradicts that; the read CONTINUES by keyset to an empty page.
  {
    initAdapter({ who: 'commissioner', capFor: (t, n) => (t === 'picks' && n > 1 ? 5 : 1000) });
    grow(ST, { extraMembers: ['p4', 'p5', 'p6'], weeks: 14, gamesPerWeek: 12 });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const got = (sb.get('cfbp_picks') || []).length;
    const pk = CLIENT._calls.selects.filter((s) => s.table === 'picks');
    const firstPages = pk.filter((s) => s.count === 'exact').length;
    assert(sb.getState() === 'ACTIVE' && got === visiblePicks(ST) && firstPages === 1 && pk[pk.length - 1].gt.length === 1,
      `[A-PAGE](12) (a) a short page the count contradicts does not end the read: it CONTINUES by keyset to an empty page — ${got}/${visiblePicks(ST)} picks, state ${sb.getState()}, one read of the table (first pages ${firstPages}, want 1), ${pk.length} requests`);
  }
  // (b) A count that can never be met (it claims one row more than exists), under a cap of 5. The
  //     read ends on an EMPTY keyset page — every real row is provably in hand — so it is ADOPTED with
  //     a warning, not HELD; and the inflated count cannot truncate: it only kept the read going.
  {
    initAdapter({ who: 'commissioner' });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const plain = snapshot();
    initAdapter({ who: 'commissioner', inflateCount: ['league_kv'], maxRows: 5 });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const inflated = snapshot();
    const kv = CLIENT._calls.selects.filter((s) => s.table === 'league_kv');
    const differ = KEYS.filter((k) => inflated[k] !== plain[k]);
    assert(sb.getState() === 'ACTIVE' && differ.length === 0,
      `[A-PAGE](12) (b) an inflated count under a cap of 5 ends ACTIVE with every key byte-identical to the uncapped, honest read — adopted after an empty page, never truncated (state ${sb.getState()}; differ: ${JSON.stringify(differ)})`);
    assert(kv.length === 3 && kv.filter((s) => s.count === 'exact').length === 1 && kv[2].gt.length === 1,
      `[A-PAGE](12) (b) …pages 5, 2, then an EMPTY keyset page: the 2 did not end it (the count said more), the empty page did — one read, no restart (league_kv requests: ${kv.length}, want 3)`);
    assert(said(/league_kv: read 7 rows against its own first-page count of 8.*no row was left unread/),
      '[A-PAGE](12) (b) …and the shortfall is SAID in the console, not swallowed');
  }
  // (c) SUSTAINED DELETIONS during a keyset read no longer HOLD the device. Every continuation page
  //     of a 1,263-row picks read deletes one row already read and one not yet read. Before pass 3 each
  //     of the three reads ended short, and the device went HELD; now the read goes on to its empty
  //     page and is adopted: every row that existed for the whole read is present.
  {
    const deleted = new Set();
    initAdapter({ who: 'commissioner', beforeSelect: (b) => {
      if (b._table !== 'picks' || !b._gt.length) return;
      const cur = b._gt[0][1];
      const mine = ST.picks.filter((r) => r.league_id === LEAGUE_A && /^pk_gwb/.test(r.id)).sort((x, y) => cmpId(x.id, y.id));
      const read = mine.find((r) => cmpId(r.id, cur) <= 0);
      const unread = [...mine].reverse().find((r) => cmpId(r.id, cur) > 0);
      for (const r of [read, unread]) if (r) { deleted.add(r.id); ST.picks.splice(ST.picks.indexOf(r), 1); }
    } });
    grow(ST, { extraMembers: ['p4', 'p5', 'p6'], weeks: 14, gamesPerWeek: 15 });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const got = new Set((sb.get('cfbp_picks') || []).map((p) => p.pickId));
    const survivors = ST.picks.filter((r) => r.league_id === LEAGUE_A && (r.member_id === 'p1'
      || ['live', 'final'].includes((ST.weeks.find((w) => w.league_id === LEAGUE_A && w.id === r.week_id) || {}).status))).map((r) => r.id);
    const missing = survivors.filter((id) => !got.has(id));
    const strays = [...got].filter((id) => !survivors.includes(id) && !deleted.has(id));
    const firstPages = CLIENT._calls.selects.filter((s) => s.table === 'picks' && s.count === 'exact').length;
    assert(deleted.size >= 2, `[A-PAGE](12) (c) fixture: rows were deleted while the read ran (${deleted.size})`);
    assert(sb.getState() === 'ACTIVE' && missing.length === 0 && strays.length === 0 && firstPages === 1,
      `[A-PAGE](12) (c) sustained member deletions during a keyset read do NOT hold the device: ACTIVE, every surviving row present, nothing invented, one read of the table (state ${sb.getState()}; missing ${missing.length}; strays ${strays.length}; first pages ${firstPages})`);
    assert(said(/picks: read \d+ rows against its own first-page count of \d+.*deleted while it ran/),
      '[A-PAGE](12) (c) …the difference is named as deletions in the console');
  }
  // (d) THE ACCEPTED RESIDUAL, kept LOUD: churn AHEAD of an over-length key. On the offset path an
  //     empty page cannot be asked for (the key cannot go in a URL), so a page whose anchor moved is
  //     still read again from the top, three times at most. A member who plants the key AND keeps the
  //     rows before it moving on every read spends that budget: HELD, a named error, the plain banner.
  //     (Security accepted this on 8755e5f; the planned database length CHECK removes the key.)
  {
    initAdapter({ who: 'commissioner', beforeSelect: (b) => {
      if (b._table !== 'comments') return;
      if (b._ranged && b._offset > 0) {             // every offset page: a row appears ahead of the anchor
        ST.comments.push(row({ league_id: LEAGUE_A, id: `0000000_${ST.comments.length}`, week_id: 'w1', game_id: 'g1', author_id: 'p2', author_member_id: 'p2', author_kind: 'player', bot_event_key: null, body: '', created_at: PAST(1) }));
      } else if (b._count === 'exact') {            // every first page: one goes, so the long key is last again
        const i = ST.comments.findIndex((c) => c.league_id === LEAGUE_A && /^0000000_/.test(c.id));
        if (i >= 0) ST.comments.splice(i, 1);
      }
    } });
    plantLongKey(ST);
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const reads = CLIENT._calls.selects.filter((s) => s.table === 'comments' && s.count === 'exact').length;
    const ev = lastErrorEv();
    assert(sb.getState() === 'HELD' && reads === 3 && said(/HydratePagingError.*comments.*could not be proven complete/) && ev && ev.error === ev.banner,
      `[A-PAGE](12) (d) churn ahead of an over-length key, on every read: three anchored re-reads, then a NAMED error, HELD, the plain banner — loud, bounded, never adopted (state ${sb.getState()}; reads ${reads})`);
  }
  // (e) A shortfall found on the OFFSET path is re-read, not continued: the page after the cap drop
  //     ends on a SECOND over-length key, where no empty keyset page can be asked for. One re-read
  //     from the top, under the new cap, reads every row.
  {
    const LONG_2 = LONG_KEY + '€';
    initAdapter({ who: 'commissioner', capFor: (t, n) => (t === 'comments' && n > 1 ? 2 : 1000) });
    plantLongKey(ST);
    ST.comments.push(row({ league_id: LEAGUE_A, id: LONG_2, week_id: 'w1', game_id: 'g1', author_id: 'p2', author_member_id: 'p2', author_kind: 'player', bot_event_key: null, body: '', created_at: PAST(60) }));
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const want = storeCommentIds(ST);
    const got = commentIds();
    const sel = CLIENT._calls.selects.filter((s) => s.table === 'comments');
    assert(sb.getState() === 'ACTIVE' && sameList(got, want) && got.includes(LONG_2) && sel.filter((s) => s.count === 'exact').length === 2,
      `[A-PAGE](12) (e) a shortfall on the offset path (the page ends on another over-length key) is read again from the top and completes: ${got.length}/${want.length}, state ${sb.getState()}, first pages ${sel.filter((s) => s.count === 'exact').length} (want 2)`);
    assert(said(/over-length key/) && Math.max(...sel.map((s) => s.urlLength)) < 2048 && unscopedOf(sel).length === 0,
      '[A-PAGE](12) (e) …said in the console; and still no long URL and no unscoped request');
  }

  // ── (13) NO TECHNICAL TEXT REACHES THE PLAYER: a gateway's HTML page, a paging refusal ────────────
  // app.js renders `detail.error` / `getStatus().lastError` into the red banner and the retry toast
  // verbatim. A 414 from the gateway arrives as `{ message: '<html>…' }`; before this pass that HTML
  // WAS the banner. Interaction Principles, Error States: never expose technical messages.
  {
    initAdapter({ who: 'commissioner', gatewayHtml: ['weeks'] });
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
    const st = sb.getStatus();
    const ev = lastErrorEv();
    const shown = `${st.lastError} ${ev && ev.error}`;
    assert(sb.getState() === 'HELD' && ev && st.lastError === ev.banner && ev.error === ev.banner,
      `[A-PAGE](13) a gateway 414 HOLDS, and what the banner and the retry toast render is the adapter's plain sentence (${JSON.stringify(st.lastError)})`);
    assert(!/[<>]|html|select weeks|414|Request-URI/i.test(shown),
      `[A-PAGE](13) …no markup, no table name, no status code reaches the player (${JSON.stringify(shown)})`);
    assert(said(/select weeks: HTTP 414/) && !said(/<html|<body|cloudflare/i),
      '[A-PAGE](13) …the console keeps the technical detail (table and status), and the gateway\'s HTML body is not echoed anywhere');
  }
});


// ════════════════════════════════════════════════════════════════════════
await section('\n[A-SNAP] SP-54 / DI-465 (migration 0038) - weeks.locked_alma_by_player is SERVER-OWNED: restored when the column holds a value, absent when it is NULL, and NEVER written by the client...', async () => {
  // lock_week() writes {memberId: school} into the new column and nothing else does. The projection restores it onto the week object as `lockedAlmaByPlayer`
  // (read by js/tie-context.js) and DROPS it from every write, so a stale client object can never overwrite the server's snapshot. This is the offline half of that
  // contract through the REAL planner and the REAL Realtime fold; rls.test.mjs S36.* is the live half (Drew runs it).
  const weekOf = (id) => (sb.get('cfbp_weeks') || []).find((w) => w.weekId === id);
  const handlerFor = (ch, table) => ch.channel._handlers.find((h) => h.cfg.table === table).cb;
  const planOf = () => captureConsole(() => sb.planFlush()).plan;
  const rowsPlan = () => planOf().filter((o) => o.key === 'cfbp_weeks');
  const SERVER_MAP = { p1: 'Iowa State', p2: 'Kansas' };

  // (1) a pre-migration week (the column is not on the row at all) restores with NO key: every existing week object round-trips byte-identical
  await hydrated({ who: 'commissioner' });
  assert(weekOf('w1') && !('lockedAlmaByPlayer' in weekOf('w1')) && !('locked_alma_by_player' in weekOf('w1')),
    '[A-SNAP] (1) a week whose row has no locked_alma_by_player restores with NO lockedAlmaByPlayer key (and no raw column name leaks onto the object)');
  assert(!sb._dirtyKeysForTest().includes('cfbp_weeks') && rowsPlan().length === 0,
    '[A-SNAP] (1) ...and a hydrate over such rows leaves nothing dirty: the quiet-absent rule means no week is PATCHed on the first save after the deploy');

  // (2) a locked row carrying the column restores the map; a NULL column restores no key
  initAdapter({ who: 'commissioner' });
  const w1row = ST.weeks.find((w) => w.id === 'w1');
  w1row.status = 'locked'; w1row.locked_at = new Date(NOW - 60e3).toISOString(); w1row.locked_alma_by_player = { ...SERVER_MAP };
  const w2row = ST.weeks.find((w) => w.id === 'w2');
  w2row.locked_alma_by_player = null;
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  assert(JSON.stringify(weekOf('w1').lockedAlmaByPlayer) === JSON.stringify(SERVER_MAP),
    `[A-SNAP] (2) a locked row with the column restores lockedAlmaByPlayer onto the week object (got ${JSON.stringify(weekOf('w1').lockedAlmaByPlayer)})`);
  assert(!('lockedAlmaByPlayer' in weekOf('w2')), '[A-SNAP] (2) a row whose column is NULL restores with NO key (never an explicit null)');
  assert(!sb._dirtyKeysForTest().includes('cfbp_weeks') && rowsPlan().length === 0, '[A-SNAP] (2) ...and the hydrate left nothing owed to the server');

  // (3) the client NEVER emits the column: an edit of the locked week, a client-set value, and a brand-new week with the field, through the real planner
  sb.set('cfbp_weeks', sb.get('cfbp_weeks').map((w) => (w.weekId === 'w1' ? { ...w, blurb: 'edited after the lock', lockedAlmaByPlayer: { p1: 'CLIENT-SET' } } : { ...w })));
  let plan = rowsPlan();
  assert(plan.length === 1 && plan[0].op === 'patch' && plan[0].rowId === 'w1' && JSON.stringify(Object.keys(plan[0].changed)) === '["blurb"]',
    `[A-SNAP] (3) a PATCH of the locked week carries ONLY the blurb: the client-set map is not in it (got ${JSON.stringify(plan.map((o) => [o.op, o.rowId, Object.keys(o.changed || {})]))})`);
  assert(!/locked_alma_by_player/.test(JSON.stringify(plan)), '[A-SNAP] (3) ...and the column name appears nowhere in the planned writes');
  const fresh = { ...sb.get('cfbp_weeks').find((w) => w.weekId === 'w2'), weekId: 'w_snap_new', weekNumber: 77, label: 'Snap', lockedAlmaByPlayer: { p1: 'INSERT-ME' } };
  sb.set('cfbp_weeks', [...sb.get('cfbp_weeks'), fresh]);
  const all = planOf();
  const ins = all.filter((o) => o.key === 'cfbp_weeks' && o.op === 'insert').flatMap((o) => o.rows);
  assert(ins.length === 1 && ins[0].id === 'w_snap_new' && !('locked_alma_by_player' in ins[0]), '[A-SNAP] (3) an INSERT of a new week whose object carries the field does not send the column (the row has no such key)');
  assert(!/locked_alma_by_player|INSERT-ME|CLIENT-SET/.test(JSON.stringify(all)), '[A-SNAP] (3) ...no write of any kind (insert, patch, upsert, rpc) names the column or carries either client-set value');

  // (4) the server's value always wins: a Realtime event, then a hydrate; and a NULL column deletes the key
  await hydrated({ who: 'commissioner' });
  const onWeeks = handlerFor(sb.subscribeRealtime(), 'weeks');
  const srv = ST.weeks.find((w) => w.id === 'w1');
  sb.set('cfbp_weeks', sb.get('cfbp_weeks').map((w) => (w.weekId === 'w1' ? { ...w, status: 'locked', lockedAlmaByPlayer: { A: 'client' }, blurb: 'my unsent blurb' } : { ...w })));
  assert(JSON.stringify(weekOf('w1').lockedAlmaByPlayer) === '{"A":"client"}', '[A-SNAP] (4) fixture: the mirror holds a CLIENT-SET {A} (what a client lock path stamps before the server answers)');
  srv.status = 'locked'; srv.locked_at = new Date(NOW - 30e3).toISOString(); srv.locked_alma_by_player = { B: 'server' };
  captureConsole(() => onWeeks({ eventType: 'UPDATE', new: { ...srv } }));
  assert(JSON.stringify(weekOf('w1').lockedAlmaByPlayer) === '{"B":"server"}', `[A-SNAP] (4) after the Realtime event the mirror holds the SERVER's {B}, not the client's {A} (got ${JSON.stringify(weekOf('w1').lockedAlmaByPlayer)})`);
  assert(weekOf('w1').blurb === 'my unsent blurb' && sb._dirtyKeysForTest().includes('cfbp_weeks'), '[A-SNAP] (4) ...while the unsent blurb edit survived the fold (RG-252): the snapshot is not part of what this device owes');
  assert(!/locked_alma_by_player/.test(JSON.stringify(planOf())), '[A-SNAP] (4) ...and the plan after the fold still never names the column');
  srv.locked_alma_by_player = null;
  captureConsole(() => onWeeks({ eventType: 'UPDATE', new: { ...srv } }));
  assert(!('lockedAlmaByPlayer' in weekOf('w1')), '[A-SNAP] (4) a Realtime event whose column is NULL DELETES the key from the mirror (never an explicit null)');
  // (the key must be CLEAN for a hydrate to take the server's rows: over a still-dirty key a hydrate keeps this device's unsent edit, hydrate()'s own rebase rule)
  await captureConsoleAsync(() => sb.flush());
  assert(!sb._dirtyKeysForTest().includes('cfbp_weeks') && ST.weeks.find((w) => w.id === 'w1').blurb === 'my unsent blurb', '[A-SNAP] (4) fixture: the unsent blurb reached the server and the key is clean');
  srv.locked_alma_by_player = { C: 'after-hydrate' };
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  assert(JSON.stringify(weekOf('w1').lockedAlmaByPlayer) === '{"C":"after-hydrate"}', `[A-SNAP] (4) a hydrate carrying the locked row holds the server's map again (got ${JSON.stringify(weekOf('w1').lockedAlmaByPlayer)}; dirty ${JSON.stringify(sb._dirtyKeysForTest())})`);
  srv.locked_alma_by_player = null;
  await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  assert(!('lockedAlmaByPlayer' in weekOf('w1')), '[A-SNAP] (4) ...and a hydrate over a NULL column deletes it');
});


// ════════════════════════════════════════════════════════════════════════
await section('\n[A-RECALC] SP-54 / Q9 - in a shared league "Recalculate Finalized Weeks" cannot change a stored result: finalize_week() is the ONLY writer, it needs a live -> final transition, and it carries the tie-break descriptor...', async () => {
  // The coordinator's question (SB-04 review, 2026-10-01): Q9 asks Drew to run Comm -> Data -> Recalculate before the deploy, but the adapter refuses
  // saveAllWeeklyResults() outside a finalize. This is the offline proof of that refusal through the REAL planner, and of the one path that DOES write results.
  const w2 = () => ST.weeks.find((w) => w.id === 'w2');
  const mirrorW2 = () => sb.get('cfbp_weeks').find((w) => w.weekId === 'w2');
  const setW2 = (patch) => sb.set('cfbp_weeks', sb.get('cfbp_weeks').map((w) => (w.weekId === 'w2' ? { ...w, ...patch } : { ...w })));
  const TB = { v: 1, end: 'winner', stage: 'alma', vs: 'p2', src: 'snapshot', me: { team: 'Iowa', cov: 1, mis: 0, psh: 0, src: 'snapshot' }, other: { team: 'Nebraska', cov: 0, mis: 1, psh: 0, src: 'snapshot' } };
  const legs = (plan) => plan.filter((o) => o.kind === 'finalize' || (o.kind === 'rpc' && (o.name === 'lock_week' || o.name === 'transition_week')));
  const finalAtServer = async () => {
    initAdapter({ who: 'commissioner' });
    w2().status = 'final'; w2().finalized_at = new Date(NOW - 3600e3).toISOString();
    await captureConsoleAsync(() => sb.hydrate(ACTIVE_LEAGUE, { epoch: EPOCH }));
  };

  // (1) a FINAL week; the recompute produces rows that are byte-identical (the "no changes" baseline Q9's R-2 wanted), and rows that CHANGED (the winner flipped, a descriptor added)
  await finalAtServer();
  assert(sb.getConfirmedWeekStatus('w2') === 'final' && sb.get('cfbp_results').some((r) => r.weekId === 'w2'), '[A-RECALC] (1) fixture: w2 is FINAL on the server and has a stored results row');
  sb.set('cfbp_results', sb.get('cfbp_results').map((r) => ({ ...r })));
  let r = captureConsole(() => sb.planFlush());
  assert(!r.plan.some((o) => o.key === 'cfbp_results') && !legs(r.plan).length && r.refusals.length === 1 && r.refusals[0].code === 'results_outside_finalize',
    `[A-RECALC] (1) even a recompute that changes NOTHING (byte-identical rows re-saved) is REFUSED as results_outside_finalize: the refusal does not look at the content, so the "no changes" baseline Q9's R-2 wanted cannot be taken in a shared league (refusals ${JSON.stringify(r.refusals.map((e) => e.code))})`);
  sb.set('cfbp_results', sb.get('cfbp_results').map((row) => (row.weekId === 'w2' ? { ...row, isWinner: !row.isWinner, isLoser: !row.isLoser, tieBreak: TB } : { ...row })));
  r = captureConsole(() => sb.planFlush());
  assert(r.refusals.length === 1 && r.refusals[0].code === 'results_outside_finalize' && !r.plan.some((o) => o.key === 'cfbp_results') && !legs(r.plan).length,
    `[A-RECALC] (1) a recompute that CHANGES the stored winner (with a tieBreak descriptor) is REFUSED as results_outside_finalize, and nothing is planned (refusals ${JSON.stringify(r.refusals.map((e) => e.code))})`);
  const before = JSON.stringify(ST.results.filter((x) => x.week_id === 'w2'));
  const b1 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(JSON.stringify(ST.results.filter((x) => x.week_id === 'w2')) === before && !CLIENT._calls.rpc.some((c) => c.name === 'finalize_week'),
    '[A-RECALC] (1) after the flush the server\'s stored rows are BYTE-IDENTICAL and finalize_week was never called: the recompute changed nothing the page reads');
  assert(bannerSeen.length > b1 && /Nothing was saved/.test(bannerSeen[bannerSeen.length - 1]) && /no insert grant on results/.test(bannerSeen[bannerSeen.length - 1]),
    `[A-RECALC] (1) ...and it was LOUD (loud-fail): the red banner a commissioner would see is "${bannerSeen[bannerSeen.length - 1]}"`);

  // (2) the recourse the message names is real: final -> live is planned as a transition_week leg, and the next live -> final is ONE finalize op whose payload carries the descriptor
  await finalAtServer();
  setW2({ status: 'live' });
  let p = captureConsole(() => sb.planFlush());
  assert(!p.refusals.length && legs(p.plan).length === 1 && legs(p.plan)[0].name === 'transition_week' && legs(p.plan)[0].args.p_to === 'live',
    `[A-RECALC] (2) moving a FINAL week back to LIVE is one transition_week(live) leg, nothing refused (legs ${JSON.stringify(legs(p.plan).map((o) => o.name || o.kind))}, refusals ${JSON.stringify(p.refusals.map((e) => e.code))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(w2().status === 'live', `[A-RECALC] (2) the server's week is LIVE again (${w2().status})`);
  setW2({ status: 'final' });
  sb.set('cfbp_results', sb.get('cfbp_results').map((row) => (row.weekId === 'w2' ? { ...row, isWinner: true, tieBreak: TB } : { ...row })));
  p = captureConsole(() => sb.planFlush());
  const fin = p.plan.filter((o) => o.kind === 'finalize');
  assert(!p.refusals.length && fin.length === 1, `[A-RECALC] (2) the re-finalize is exactly ONE finalize op and nothing is refused (refusals ${JSON.stringify(p.refusals.map((e) => e.code))})`);
  await captureConsoleAsync(() => sb.flush());
  const call = CLIENT._calls.rpc.filter((c) => c.name === 'finalize_week');
  assert(call.length === 1 && call[0].args.p_results.some((x) => x.playerId === 'p1' && JSON.stringify(x.tieBreak) === JSON.stringify(TB)),
    '[A-RECALC] (2) the finalize_week payload carries the tie-break descriptor on the result row (a key the typed columns do not name, so 0026\'s finalize_week stores it in results.extra: `v.value - {typed keys}`)');
  assert(w2().status === 'final', '[A-RECALC] (2) and the week is FINAL on the server again');
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FB026] — Drew, v0.29.0 (Feedback Log row 27, PM-126): "i clicked finalize week and this popped up:
// Cross-device sync is OFF on this device. The server refused to save cfbp_obligations: obligations:
// payer/recipient/week/type/created_at are immutable Nothing was saved."
//
// THE MECHANISM, end to end (the fake's finalize_week now writes what 0026's really writes — see FB-026 there):
//   1. finalize_week inserts the week's new obligation with the SERVER'S created_at, and copies the client's
//      createdAt (and six other typed fields) into `extra`;
//   2. on the next hydrate (a reload, or any return to the app), `legacyFromRow` spreads `extra` over the typed
//      columns, so the mirror says createdAt = the client's time while the base row says the server's;
//   3. the next obligations save of ANY kind diffs EVERY row, so that row plans a PATCH carrying `created_at`
//      (and `extra`), and obligations_guard refuses it — next week's Finalize is exactly such a save.
// Plus the silent half the loud one was hiding: a typed column moved by a later patch (paid, voided) is read
// back as its stale shadow in `extra`, and the next save would write the stale value back.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-FB026] FB-026 — after a reload, finalizing the next week never re-sends an obligation\'s immutable columns, and a paid/voided obligation reads back as the server holds it…', async () => {
  // createObligation()'s exact shape (js/storage.js), so the payload is the one the app really sends.
  const newOb = (id, weekId, createdAt) => ({
    obligationId: id, type: 'weekly', weekId, payerPlayerId: 'p2', recipientPlayerId: 'p1',
    amountOrPrize: 'beer', status: 'unpaid', createdAt, paidAt: null,
    needsReview: false, reviewNote: null, voided: false, voidedAt: null, voidReason: null, mergedInto: null, mergedFrom: [],
  });
  // What app.js finalizeWeek() writes in ONE synchronous tick: the week's status, its results, and the
  // obligation reconcileWeeklyObligation() appends (saveObligation -> save of the WHOLE array).
  const finalizeInOneTick = (weekId, ob) => {
    sb.set('cfbp_weeks', sb.get('cfbp_weeks').map((w) => (w.weekId === weekId ? { ...w, status: 'final' } : { ...w })));
    sb.set('cfbp_results', [...sb.get('cfbp_results'), {
      resultId: `wr_${weekId}_p2`, weekId, playerId: 'p2', displayName: 'Kevin',
      correctPicks: 0, incorrectPicks: 1, correctCount: 0, incorrectCount: 1, noDecisions: 0, pending: 0,
      tiebreakerGuess: null, tiebreakerDelta: null, rank: 2, isWinner: false, isLoser: true, wonByTiebreaker: false,
    }]);
    sb.set('cfbp_obligations', [...sb.get('cfbp_obligations'), ob]);
  };
  const IMMUTABLE = ['payer_member_id', 'recipient_member_id', 'week_id', 'type', 'created_at'];
  const reload = () => captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const srvOb = (id) => ST.obligations.filter((o) => o.id === id);
  const mirrorOb = (id) => sb.get('cfbp_obligations').find((o) => o.obligationId === id);
  const obUpdatesSince = (n) => CLIENT._calls.updates.slice(n).filter((u) => u.table === 'obligations');

  // ── (0) Week 2 finalizes. The fake now writes the LIVE row shape; prove it, so a revert of the fake is red here.
  await hydrated({ who: 'commissioner' });
  const C2 = new Date(NOW).toISOString();
  finalizeInOneTick('w2', newOb('ob2', 'w2', C2));
  await captureConsoleAsync(() => sb.flush());
  assert(srvOb('ob2').length === 1 && srvOb('ob2')[0].created_at !== C2 && srvOb('ob2')[0].extra.createdAt === C2,
    `[A-FB026] (0) precondition: finalize_week stamped the SERVER'S created_at and shadowed the client's in extra, as 0026 does live (${JSON.stringify(srvOb('ob2')[0] && { created_at: srvOb('ob2')[0].created_at, extra: srvOb('ob2')[0].extra })})`);
  const S2 = srvOb('ob2')[0].created_at;

  // ── (1) DREW'S REPORT. Week 3 goes live server-side, the app reloads, and the commissioner finalizes week 3.
  ST.weeks.push(row({ league_id: LEAGUE_A, id: 'w3', sport: 'cfb', season: '2026', week_number: 3, label: 'Week 3', status: 'live', picks_lock_at: new Date(NOW - 3600e3).toISOString(), revealed_at: new Date(NOW - 1800e3).toISOString(), locked_at: new Date(NOW - 3600e3).toISOString(), locked_alma_maters: [], pending_finalization: true }));
  await reload();
  const C3 = new Date(NOW + 7 * 86400e3).toISOString();
  finalizeInOneTick('w3', newOb('ob3', 'w3', C3));
  const plan1 = captureConsole(() => sb.planFlush()).plan;
  const leaked = plan1.filter((o) => o.key === 'cfbp_obligations' && o.op === 'patch' && IMMUTABLE.some((c) => c in o.changed));
  assert(!leaked.length,
    `[A-FB026] (1) the finalize batch plans NO obligations PATCH naming payer/recipient/week/type/created_at (${JSON.stringify(leaked.map((o) => ({ id: o.rowId, cols: Object.keys(o.changed) })))})`);
  const mark1 = bannerSeen.length;
  const upd1 = CLIENT._calls.updates.length;
  await captureConsoleAsync(() => sb.flush());
  assert(!bannersSince(mark1).some((t) => /immutable|Nothing was saved/i.test(t)),
    `[A-FB026] (1) …and finalizing week 3 raises NO red "Nothing was saved" banner (${JSON.stringify(bannersSince(mark1))})`);
  assert(!sb._refusedKeysForTest().includes('cfbp_obligations') && !sb._dirtyKeysForTest().includes('cfbp_obligations'),
    `[A-FB026] (1) …cfbp_obligations ends neither refused nor pending (refused ${JSON.stringify(sb._refusedKeysForTest())}, dirty ${JSON.stringify(sb._dirtyKeysForTest())})`);
  assert(!obUpdatesSince(upd1).some((u) => IMMUTABLE.some((c) => c in u.patch)),
    `[A-FB026] (1) …no obligations UPDATE that reached the server named an immutable column (${JSON.stringify(obUpdatesSince(upd1).map((u) => Object.keys(u.patch)))})`);
  assert(ST.weeks.find((w) => w.id === 'w3').status === 'final' && srvOb('ob3').length === 1 && srvOb('ob2')[0].created_at === S2,
    `[A-FB026] (1) …week 3 is FINAL, its obligation is on the server exactly once, and week 2's obligation is untouched (ob3 x${srvOb('ob3').length})`);
  // Retry / double-tap: the same tick replayed, then a second flush. Nothing is duplicated and nothing is re-sent.
  const rpc1 = CLIENT._calls.rpc.length, ins1 = CLIENT._calls.inserts.length, upd1b = CLIENT._calls.updates.length;
  sb.set('cfbp_obligations', sb.get('cfbp_obligations').map((o) => ({ ...o })));
  await captureConsoleAsync(() => sb.flush());
  await captureConsoleAsync(() => sb.flush());
  assert(srvOb('ob3').length === 1 && CLIENT._calls.inserts.length === ins1 && CLIENT._calls.updates.length === upd1b
    && !CLIENT._calls.rpc.slice(rpc1).some((c) => c.name === 'finalize_week'),
    `[A-FB026] (1) a retry / double-tap re-sends nothing and duplicates nothing (ob3 x${srvOb('ob3').length}, +${CLIENT._calls.inserts.length - ins1} inserts, +${CLIENT._calls.updates.length - upd1b} updates)`);

  // ── (2) THE SILENT HALF — fix (A). A row the server moved to PAID by a status/paid_at-only patch still carries
  //    `extra.paidAt: null` from finalize_week. It must read back PAID WITH ITS DATE, and the next obligations save
  //    must not write the stale null back.
  const PAID_AT = new Date(NOW + 2 * 86400e3).toISOString();
  Object.assign(srvOb('ob2')[0], { status: 'paid', paid_at: PAID_AT });
  assert(srvOb('ob2')[0].extra.paidAt === null, '[A-FB026] (2) precondition: the live row still shadows paidAt: null in extra');
  await reload();
  assert(mirrorOb('ob2').status === 'paid' && mirrorOb('ob2').paidAt === PAID_AT,
    `[A-FB026] (2) after a reload the mirror reads the COLUMN, not its stale shadow: paid, paidAt ${PAID_AT} (${JSON.stringify(mirrorOb('ob2') && { status: mirrorOb('ob2').status, paidAt: mirrorOb('ob2').paidAt })})`);
  assert(Date.parse(mirrorOb('ob2').createdAt) === Date.parse(S2),
    `[A-FB026] (2) …and createdAt is the server's instant, not the shadowed client one (${mirrorOb('ob2').createdAt} vs ${S2})`);
  sb.set('cfbp_obligations', sb.get('cfbp_obligations').map((o) => (o.obligationId === 'ob1' ? { ...o, needsReview: true, reviewNote: 'check' } : { ...o })));
  const plan2 = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_obligations');
  assert(plan2.length === 1 && plan2[0].op === 'patch' && plan2[0].rowId === 'ob1',
    `[A-FB026] (2) an unrelated obligations save plans ONE patch (ob1) and nothing for ob2 — the stale shadow is never written back (${JSON.stringify(plan2.map((o) => ({ id: o.rowId, changed: o.changed })))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(srvOb('ob2')[0].paid_at === PAID_AT && srvOb('ob2')[0].status === 'paid', '[A-FB026] (2) …and the server still holds ob2 PAID with its date');

  // ── (3) VOID on a finalize-created row, then a reload. The patch carries only what changed; the void survives.
  await reload();
  const VOID_AT = new Date(NOW + 3 * 86400e3).toISOString();
  sb.set('cfbp_obligations', sb.get('cfbp_obligations').map((o) => (o.obligationId === 'ob3'
    ? { ...o, voided: true, voidedAt: VOID_AT, voidReason: 'duplicate', needsReview: false } : { ...o })));
  const plan3 = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_obligations');
  assert(plan3.length === 1 && plan3[0].rowId === 'ob3'
    && Object.keys(plan3[0].changed).sort().join(',') === 'void_reason,voided,voided_at',
    `[A-FB026] (3) voiding ob3 plans ONE patch carrying exactly voided/voided_at/void_reason — no created_at, no extra (${JSON.stringify(plan3.map((o) => ({ id: o.rowId, cols: Object.keys(o.changed || {}) })))})`);
  const mark3 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(!bannersSince(mark3).length && srvOb('ob3')[0].voided === true,
    `[A-FB026] (3) …the server accepts it (voided ${srvOb('ob3')[0].voided}; banners ${JSON.stringify(bannersSince(mark3))})`);
  await reload();
  // CLEAN first: a key still dirty keeps this device's own value across a hydrate (the rebase), which would make the
  // next assertion pass without reading the server at all.
  assert(!sb._dirtyKeysForTest().includes('cfbp_obligations') && mirrorOb('ob3').voided === true && mirrorOb('ob3').voidedAt === VOID_AT,
    `[A-FB026] (3) …and after a reload (key clean, so read from the SERVER) ob3 is STILL voided — not resurrected by the voided:false shadow in extra (${JSON.stringify(mirrorOb('ob3') && { voided: mirrorOb('ob3').voided, voidedAt: mirrorOb('ob3').voidedAt })}, dirty ${JSON.stringify(sb._dirtyKeysForTest())})`);
  sb.set('cfbp_obligations', sb.get('cfbp_obligations').map((o) => ({ ...o })));
  const plan3b = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_obligations');
  assert(!plan3b.length, `[A-FB026] (3) …and re-saving the unchanged array plans nothing at all — no un-void (${JSON.stringify(plan3b.map((o) => ({ id: o.rowId, changed: o.changed })))})`);

  // ── (4) THE GUARD (C), on its own. Whatever the mirror says about an immutable column, a PATCH never carries it:
  //    obligations_guard refuses any change to one, for everybody, so sending it can only ever be a refusal.
  await reload();
  sb.set('cfbp_obligations', sb.get('cfbp_obligations').map((o) => (o.obligationId === 'ob2'
    ? { ...o, createdAt: new Date(NOW - 86400e3).toISOString(), weekId: 'w1', needsReview: true } : { ...o })));
  const p4 = captureConsole(() => sb.planFlush());
  const ob2p = p4.plan.filter((o) => o.key === 'cfbp_obligations' && o.rowId === 'ob2');
  assert(ob2p.length === 1 && 'needs_review' in ob2p[0].changed && !IMMUTABLE.some((c) => c in ob2p[0].changed),
    `[A-FB026] (4) a diverged created_at/week_id is NEVER sent in a PATCH; the mutable change still goes (${JSON.stringify(ob2p.map((o) => o.changed))})`);
  assert(said(/ob2/) && said(/created_at/) && said(/week_id/),
    '[A-FB026] (4) …and the drop is not silent: the console names the row and both immutable columns');
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FB005] — Drew, v0.29.0 (Feedback Log row 6, PM-105): "approve scribe learnings glitching out and not marking as
// approve".
//
// THE MECHANISM. `fromRows.cfbp_scribe_learnings` returns each row's payload in `ord` order and drops the row id;
// `toRows` re-derives it from the ARRAY POSITION (`sl_<runId>_<position>` for every row without a learningId). The
// server's writers (trainer/index.js nextOrd, scribe-learn/index.js) name a row `sl_<runId>_<max(ord)+1+i>`. The
// two agree only while `ord` is exactly 0..n-1 — which nothing enforces (no unique constraint on ord; two writers
// that read the same max write the same ord; any stray or probe row leaves a gap). When they disagree the approve
// flip is planned against the WRONG ids: a position whose derived id belongs to a NEIGHBOUR patches the neighbour
// (silently approving a different proposal), and a derived id the server never wrote becomes an INSERT that the
// table refuses (no insert grant) — red banner, and the next refresh shows the row still pending.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-FB005] FB-005 — approving a SCRIBE proposal patches the SERVER\'S row, never a position-derived id…', async () => {
  const at = new Date(NOW).toISOString();
  const reload = () => captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const srv = (id) => ST.scribe_learnings.find((r) => r.id === id);
  const approveAt = (pred) => {
    const all = sb.get('cfbp_scribe_learnings').map((l) => ({ ...l }));
    const idx = all.findIndex(pred);
    // applyScribeLearningDecision()'s exact flip (js/app.js): all[idx] rewritten in place, whole array saved.
    if (idx >= 0) { all[idx] = { ...all[idx], status: 'approved' }; sb.set('cfbp_scribe_learnings', all); }
    return idx;
  };

  // ── (1) TWO WRITERS, ONE ORD. scribe-learn (an instant learning) and a Trainer run both read max(ord) = 1 and both
  //    wrote ord 2. The Trainer's experiment is sl_r2_2, its fact candidate sl_r2_3 — positions 3 and 4 on the client.
  await hydrated({ who: 'commissioner' });
  ST.scribe_learnings.push(
    row({ league_id: LEAGUE_A, id: 'sl_instant_fb9', ord: 2, run_id: 'ri', kind: 'learning', status: 'approved', origin: 'instant', payload: { kind: 'learning', learningId: 'sl_instant_fb9', runId: 'ri', category: 'humor', instruction: 'fewer puns', confidence: 0.8, status: 'approved', origin: 'instant', createdAt: at }, created_at: at }),
    row({ league_id: LEAGUE_A, id: 'sl_r2_2', ord: 2, run_id: 'r2', kind: 'experiment', status: 'pending', origin: 'trainer', payload: { kind: 'experiment', runId: 'r2', experiment: 'more Kihoon', reason: 'reigning champion', confidence: 0.6, status: 'pending', origin: 'trainer', createdAt: at }, created_at: at }),
    row({ league_id: LEAGUE_A, id: 'sl_r2_3', ord: 3, run_id: 'r2', kind: 'fact_candidate', status: 'pending', origin: 'trainer', payload: { kind: 'fact_candidate', runId: 'r2', playerId: 'p2', key: 'school', value: 'Notre Dame', confidence: 0.7, status: 'pending', createdAt: at }, created_at: at }),
  );
  await reload();
  const before1 = sb.get('cfbp_scribe_learnings');
  const expIdx = before1.findIndex((l) => l.kind === 'experiment' && l.runId === 'r2');
  const derived = proj.toRows.cfbp_scribe_learnings(before1, { leagueId: LEAGUE_A }).scribe_learnings[expIdx].id;
  assert(expIdx >= 0 && derived !== 'sl_r2_2',
    `[A-FB005] (1) precondition: the experiment sits at position ${expIdx}, where the position rule derives "${derived}" — not its server id sl_r2_2`);
  approveAt((l) => l.kind === 'experiment' && l.runId === 'r2');
  const p1 = captureConsole(() => sb.planFlush());
  const ops1 = p1.plan.filter((o) => o.key === 'cfbp_scribe_learnings');
  assert(ops1.length === 1 && ops1[0].op === 'patch' && ops1[0].rowId === 'sl_r2_2' && JSON.stringify(ops1[0].changed) === '{"status":"approved"}' && !p1.refusals.length,
    `[A-FB005] (1) approving the experiment plans ONE status patch on its SERVER id sl_r2_2 — no insert, no neighbour (${JSON.stringify(ops1.map((o) => ({ op: o.op, id: o.rowId, changed: o.changed })))})`);
  const mark1 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(srv('sl_r2_2').status === 'approved' && srv('sl_r2_3').status === 'pending' && !bannersSince(mark1).length,
    `[A-FB005] (1) …the server approved the experiment and NOT the fact candidate beside it, with no banner (exp ${srv('sl_r2_2').status}, fact ${srv('sl_r2_3').status}, banners ${JSON.stringify(bannersSince(mark1))})`);
  await reload();
  const after1 = sb.get('cfbp_scribe_learnings');
  // CLEAN first, for the same reason as [A-FB026] (3): a dirty key's own value survives a hydrate.
  assert(!sb._dirtyKeysForTest().includes('cfbp_scribe_learnings')
    && after1.find((l) => l.kind === 'experiment' && l.runId === 'r2').status === 'approved'
    && after1.find((l) => l.kind === 'fact_candidate' && l.runId === 'r2').status === 'pending'
    && after1.length === before1.length && ST.scribe_learnings.length === 5,
    `[A-FB005] (1) …after a refresh (any device) it still reads approved, its neighbour still pending, and nothing was duplicated (${after1.length} items, ${ST.scribe_learnings.length} rows)`);

  // ── (2) A GAP. A stray row at a high ord (a verification probe that committed) and the Trainer's next row after it.
  ST.scribe_learnings.push(
    row({ league_id: LEAGUE_A, id: 'v0022_a', ord: 900001, run_id: 'v0022', kind: 'fact_candidate', status: 'approved', payload: { kind: 'fact_candidate', status: 'approved', playerId: 'p2', key: 'v0022:probe-a', value: 'verification probe A', confidence: 0.9 }, created_at: at }),
    row({ league_id: LEAGUE_A, id: 'sl_r3_900002', ord: 900002, run_id: 'r3', kind: 'experiment', status: 'pending', origin: 'trainer', payload: { kind: 'experiment', runId: 'r3', experiment: 'shorter recaps', reason: 'fewer scrolls', confidence: 0.6, status: 'pending', origin: 'trainer', createdAt: at }, created_at: at }),
  );
  await reload();
  approveAt((l) => l.kind === 'experiment' && l.runId === 'r3');
  const p2 = captureConsole(() => sb.planFlush());
  const ops2 = p2.plan.filter((o) => o.key === 'cfbp_scribe_learnings');
  assert(ops2.length === 1 && ops2[0].op === 'patch' && ops2[0].rowId === 'sl_r3_900002' && !p2.refusals.length,
    `[A-FB005] (2) behind a gap the approve still patches the server id sl_r3_900002 — not an INSERT of sl_r3_<position> (${JSON.stringify(ops2.map((o) => ({ op: o.op, id: o.rowId || (o.rows || []).map((r) => r.id) })))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(srv('sl_r3_900002').status === 'approved' && ST.scribe_learnings.length === 7,
    `[A-FB005] (2) …and the server holds it approved, with no extra row (${srv('sl_r3_900002').status}, ${ST.scribe_learnings.length} rows)`);

  // ── (3) CANON, the same screen's other list. A canon row whose model omitted canon_id is `sc_<runId>_<ord>` on the
  //    server and '' on the client.
  ST.scribe_canon.push(row({ league_id: LEAGUE_A, id: 'sc_r2_0', ord: 0, approval_status: 'pending', run_id: 'r2', kind: 'canon', origin: 'trainer', payload: { canonId: '', kind: 'canon', runId: 'r2', contextSummary: 'a bad beat', preferredResponse: 'brutal', confidence: 0.8, approvalStatus: 'pending', origin: 'trainer', createdAt: at }, created_at: at }));
  await reload();
  sb.set('cfbp_scribe_canon', sb.get('cfbp_scribe_canon').map((c) => ({ ...c, approvalStatus: 'approved' })));
  const p3 = captureConsole(() => sb.planFlush());
  const ops3 = p3.plan.filter((o) => o.key === 'cfbp_scribe_canon');
  assert(ops3.length === 1 && ops3[0].op === 'patch' && ops3[0].rowId === 'sc_r2_0' && JSON.stringify(ops3[0].changed) === '{"approval_status":"approved"}',
    `[A-FB005] (3) approving a canon entry with no canonId patches its server id sc_r2_0 (${JSON.stringify(ops3.map((o) => ({ op: o.op, id: o.rowId || (o.rows || []).map((r) => r.id), changed: o.changed })))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(ST.scribe_canon.length === 1 && ST.scribe_canon[0].approval_status === 'approved', `[A-FB005] (3) …and the server holds it approved (${ST.scribe_canon.length} row)`);

  // ── (4) A FAILED SAVE is loud, leaves the learning INACTIVE on the server, and is retryable.
  await reload();
  const comm = ST.league_members.find((m) => m.id === 'p1');
  comm.role = 'player';                                    // the server no longer takes this device's approvals
  approveAt((l) => l.kind === 'fact_candidate' && l.runId === 'r2');
  const mark4 = bannerSeen.length;
  await captureConsoleAsync(() => sb.flush());
  assert(bannersSince(mark4).some((t) => /cfbp_scribe_learnings/.test(t) && /Nothing was saved/.test(t)) && srv('sl_r2_3').status === 'pending',
    `[A-FB005] (4) a refused approve raises the red banner naming the key, and the server row stays PENDING — the learning is not active (${srv('sl_r2_3').status}; ${JSON.stringify(bannersSince(mark4))})`);
  comm.role = 'commissioner';                              // rights restored; the Retry path is a re-hydrate, then the queued write
  await reload();
  await captureConsoleAsync(() => sb.flush());
  assert(srv('sl_r2_3').status === 'approved' && ST.scribe_learnings.length === 7 && !sb._refusedKeysForTest().includes('cfbp_scribe_learnings'),
    `[A-FB005] (4) …and the retry lands it on the SAME row, once (${srv('sl_r2_3').status}, ${ST.scribe_learnings.length} rows)`);

  // ── (5) A PAYLOAD THE SERVER CHANGED SINCE THE REFRESH still identifies its row. scribe_memory_apply stamps
  //    `payload.memoryAppliedAt` on an approved fact, and the Trainer confirms a provisional learning; a write's
  //    answer carries that change into the base while the mirror keeps the refreshed copy. Identity is the
  //    proposal (kind, run, id), not its whole content — otherwise the NEXT approve would be refused.
  ST.scribe_learnings.push(
    row({ league_id: LEAGUE_A, id: 'sl_r4_900003', ord: 900003, run_id: 'r4', kind: 'fact_candidate', status: 'pending', origin: 'trainer', payload: { kind: 'fact_candidate', runId: 'r4', playerId: 'p3', key: 'school', value: 'Iowa State', confidence: 0.8, status: 'pending', origin: 'trainer', createdAt: at }, created_at: at }),
    row({ league_id: LEAGUE_A, id: 'sl_r4_900004', ord: 900004, run_id: 'r4', kind: 'experiment', status: 'pending', origin: 'trainer', payload: { kind: 'experiment', runId: 'r4', experiment: 'roast the spread', reason: 'it moved', confidence: 0.6, status: 'pending', origin: 'trainer', createdAt: at }, created_at: at }),
  );
  await reload();
  approveAt((l) => l.kind === 'fact_candidate' && l.runId === 'r4');
  srv('sl_r4_900003').payload = { ...srv('sl_r4_900003').payload, memoryAppliedAt: at };   // the server's own stamp, after the refresh
  await captureConsoleAsync(() => sb.flush());
  approveAt((l) => l.kind === 'experiment' && l.runId === 'r4');
  const p5 = captureConsole(() => sb.planFlush());
  const ops5 = p5.plan.filter((o) => o.key === 'cfbp_scribe_learnings');
  assert(!p5.refusals.length && ops5.length === 1 && ops5[0].rowId === 'sl_r4_900004',
    `[A-FB005] (5) a payload the server changed after the refresh does not stop the next approve: ONE patch on sl_r4_900004, nothing refused (${JSON.stringify({ ops: ops5.map((o) => o.rowId), refusals: p5.refusals.map((e) => e.code) })})`);

  // ── (6) AN ITEM THAT MATCHES NO SERVER ROW IS REFUSED, NEVER SENT UNDER A GUESSED ID. Spliced in at position 2 with
  //    run r2, its position-derived id is sl_r2_2 — the experiment's real row — so sending it would overwrite that
  //    row's status. (No production writer of this key changes the array's shape; this is the backstop.)
  await reload();
  const spliced = sb.get('cfbp_scribe_learnings').map((l) => ({ ...l }));
  spliced.splice(2, 0, { kind: 'experiment', runId: 'r2', experiment: 'a local-only line', reason: '?', confidence: 0.5, status: 'rejected' });
  sb.set('cfbp_scribe_learnings', spliced);
  const p6 = captureConsole(() => sb.planFlush());
  assert(p6.refusals.some((e) => e.code === 'row_identity_unresolved' && e.key === 'cfbp_scribe_learnings' && /Nothing was saved/.test(e.message))
    && !p6.plan.some((o) => o.key === 'cfbp_scribe_learnings'),
    `[A-FB005] (6) an item with no server row is REFUSED loudly and nothing is planned for the key — no insert, no write onto sl_r2_2 (${JSON.stringify({ refusals: p6.refusals.map((e) => e.code), ops: p6.plan.filter((o) => o.key === 'cfbp_scribe_learnings').map((o) => o.rowId || o.op) })})`);
});

// ══════════════════════════════════════════════════════════════════════════
// [A-FB005b] — F1 (security review of batch O, 2026-10-07): THE PENDING-EDIT REPLAY KEYS EVERY ROW THE WAY THE PLANNER DOES.
//
// RG-252's fold lays this device's unsent edits back over a base the server has moved (`_pendingRowEdits` ->
// `_reapplyPendingRows`). For the two SCRIBE review keys `toRows` names a row by ARRAY POSITION, and `_diffRows` re-keys
// it to the server row it was read from before comparing anything (`serverRowIds`, FB-005). The replay did not: a pending
// approve was laid back onto the POSITION-DERIVED id — a neighbour's row (a different proposal reads as approved in the
// mirror) or an id the server never wrote (a phantom duplicate item). `scribe_learnings` is not one of the four tables the
// channel binds today, so the fold is driven through `_foldRealtimeRowForTest`, the seam RG-252 itself is tested with.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-FB005b] F1 — a replayed pending edit keeps the SERVER row id (neighbour, phantom row, unresolved)…', async () => {
  const at = new Date(NOW).toISOString();
  const reload = () => captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const srv = (id) => ST.scribe_learnings.find((r) => r.id === id);
  const approveAt = (pred) => {
    const all = sb.get('cfbp_scribe_learnings').map((l) => ({ ...l }));
    const idx = all.findIndex(pred);
    if (idx >= 0) { all[idx] = { ...all[idx], status: 'approved' }; sb.set('cfbp_scribe_learnings', all); }
    return idx;
  };
  const statusOf = (pred) => (sb.get('cfbp_scribe_learnings').find(pred) || {}).status;
  const isExp = (l) => l.kind === 'experiment' && l.runId === 'r2';
  const isFact = (l) => l.kind === 'fact_candidate' && l.runId === 'r2';
  // The event the fold receives: ANY other change to the table (a Trainer run confirming an unrelated learning).
  const otherEvent = (id, extra = {}) => ({ eventType: 'UPDATE', new: { ...srv(id), ...extra, league_id: LEAGUE_A } });

  await hydrated({ who: 'commissioner' });
  ST.scribe_learnings.push(
    row({ league_id: LEAGUE_A, id: 'sl_instant_fb9', ord: 2, run_id: 'ri', kind: 'learning', status: 'approved', origin: 'instant', payload: { kind: 'learning', learningId: 'sl_instant_fb9', runId: 'ri', category: 'humor', instruction: 'fewer puns', confidence: 0.8, status: 'approved', origin: 'instant', createdAt: at }, created_at: at }),
    row({ league_id: LEAGUE_A, id: 'sl_r2_2', ord: 2, run_id: 'r2', kind: 'experiment', status: 'pending', origin: 'trainer', payload: { kind: 'experiment', runId: 'r2', experiment: 'more Kihoon', reason: 'reigning champion', confidence: 0.6, status: 'pending', origin: 'trainer', createdAt: at }, created_at: at }),
    row({ league_id: LEAGUE_A, id: 'sl_r2_3', ord: 3, run_id: 'r2', kind: 'fact_candidate', status: 'pending', origin: 'trainer', payload: { kind: 'fact_candidate', runId: 'r2', playerId: 'p2', key: 'school', value: 'Notre Dame', confidence: 0.7, status: 'pending', createdAt: at }, created_at: at }),
  );
  await reload();
  const items0 = sb.get('cfbp_scribe_learnings').length;
  const expIdx = sb.get('cfbp_scribe_learnings').findIndex(isExp);
  const derived = proj.toRows.cfbp_scribe_learnings(sb.get('cfbp_scribe_learnings'), { leagueId: LEAGUE_A }).scribe_learnings[expIdx].id;
  assert(expIdx >= 0 && derived === 'sl_r2_3',
    `[A-FB005b] (0) precondition: the experiment's POSITION-DERIVED id is "${derived}" — its neighbour the fact candidate's real server id (the experiment's own is sl_r2_2)`);

  // ── (1) THE NEIGHBOUR. Approve the experiment (unsent), then ANY row event folds in.
  approveAt(isExp);
  assert(sb._dirtyKeysForTest().includes('cfbp_scribe_learnings'), '[A-FB005b] (1) precondition: the approve is unsent (the key is dirty)');
  captureConsole(() => sb._foldRealtimeRowForTest('scribe_learnings', otherEvent('sl_instant_fb9', { payload: { ...srv('sl_instant_fb9').payload, instruction: 'fewer puns, please' } })));
  assert(statusOf(isExp) === 'approved' && statusOf(isFact) === 'pending',
    `[A-FB005b] (1) after the fold the mirror still has the EXPERIMENT approved and its neighbour the fact candidate PENDING (experiment ${statusOf(isExp)}, fact ${statusOf(isFact)}) — the replay used to approve the neighbour`);
  assert(sb.get('cfbp_scribe_learnings').length === items0,
    `[A-FB005b] (1) …and no item was added or lost (${sb.get('cfbp_scribe_learnings').length} vs ${items0})`);
  const p1 = captureConsole(() => sb.planFlush());
  const ops1 = p1.plan.filter((o) => o.key === 'cfbp_scribe_learnings');
  assert(ops1.length === 1 && ops1[0].op === 'patch' && ops1[0].rowId === 'sl_r2_2' && JSON.stringify(ops1[0].changed) === '{"status":"approved"}' && !p1.refusals.length,
    `[A-FB005b] (1) …and the edit the fold kept is still exactly ONE status patch on sl_r2_2 (${JSON.stringify(ops1.map((o) => ({ op: o.op, id: o.rowId, changed: o.changed })))})`);
  await captureConsoleAsync(() => sb.flush());
  assert(srv('sl_r2_2').status === 'approved' && srv('sl_r2_3').status === 'pending',
    `[A-FB005b] (1) …and the server approved the experiment and not the neighbour (exp ${srv('sl_r2_2').status}, fact ${srv('sl_r2_3').status})`);

  // ── (2) THE PHANTOM. A gap puts the derived id nowhere on the server: the replay used to INSERT a duplicate item.
  ST.scribe_learnings.push(
    row({ league_id: LEAGUE_A, id: 'v0022_a', ord: 900001, run_id: 'v0022', kind: 'fact_candidate', status: 'approved', payload: { kind: 'fact_candidate', status: 'approved', playerId: 'p2', key: 'v0022:probe-a', value: 'verification probe A', confidence: 0.9 }, created_at: at }),
    row({ league_id: LEAGUE_A, id: 'sl_r3_900002', ord: 900002, run_id: 'r3', kind: 'experiment', status: 'pending', origin: 'trainer', payload: { kind: 'experiment', runId: 'r3', experiment: 'shorter recaps', reason: 'fewer scrolls', confidence: 0.6, status: 'pending', origin: 'trainer', createdAt: at }, created_at: at }),
  );
  await reload();
  const items2 = sb.get('cfbp_scribe_learnings').length;
  const isR3 = (l) => l.kind === 'experiment' && l.runId === 'r3';
  approveAt(isR3);
  captureConsole(() => sb._foldRealtimeRowForTest('scribe_learnings', otherEvent('sl_instant_fb9', { payload: { ...srv('sl_instant_fb9').payload, instruction: 'fewer puns, truly' } })));
  assert(sb.get('cfbp_scribe_learnings').length === items2 && statusOf(isR3) === 'approved',
    `[A-FB005b] (2) behind a gap the fold adds NO phantom item and keeps the approve on the r3 experiment (${sb.get('cfbp_scribe_learnings').length} vs ${items2} items; r3 ${statusOf(isR3)})`);
  const p2 = captureConsole(() => sb.planFlush());
  const ops2 = p2.plan.filter((o) => o.key === 'cfbp_scribe_learnings');
  assert(ops2.length === 1 && ops2[0].op === 'patch' && ops2[0].rowId === 'sl_r3_900002' && !p2.refusals.length,
    `[A-FB005b] (2) …and the plan is still one patch on sl_r3_900002, never an insert (${JSON.stringify(ops2.map((o) => ({ op: o.op, id: o.rowId || (o.rows || []).map((r) => r.id) })))})`);
  await captureConsoleAsync(() => sb.flush());

  // ── (3) NO SERVER ROW. An item the base cannot place is never replayed under a guessed id: the fold KEEPS the mirror and says so.
  await reload();
  const spliced = sb.get('cfbp_scribe_learnings').map((l) => ({ ...l }));
  spliced.splice(2, 0, { kind: 'experiment', runId: 'r2', experiment: 'a local-only line', reason: '?', confidence: 0.5, status: 'rejected' });
  sb.set('cfbp_scribe_learnings', spliced);
  const before3 = JSON.stringify(sb.get('cfbp_scribe_learnings'));
  captureConsole(() => sb._foldRealtimeRowForTest('scribe_learnings', otherEvent('sl_instant_fb9', { payload: { ...srv('sl_instant_fb9').payload, instruction: 'x' } })));
  assert(JSON.stringify(sb.get('cfbp_scribe_learnings')) === before3 && said(/could not be read as rows/),
    '[A-FB005b] (3) an item with no server row: the fold leaves the mirror exactly as the device had it and the console says why (never a guessed id, never a dropped edit)');

  // ── (4) THE SOURCE PIN. The replay and the planner share ONE keying call (a regression that re-derives it in one place only is this defect again).
  const code = readFileSync(join(__dirname, 'js', 'supabase-backend.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = (name) => { const i = code.indexOf(`function ${name}(`); return i < 0 ? '' : code.slice(i, code.indexOf('\n}\n', i)); };
  assert(/route\.serverRowIds\)\s*newRows\s*=\s*_serverRowIdsByPosition\(/.test(body('_diffRows'))
    && /route\.serverRowIds\)\s*local\s*=\s*_serverRowIdsByPosition\(/.test(body('_pendingRowEdits')),
    '[A-FB005b] (4) both `_diffRows` (the planner) and `_pendingRowEdits` (the replay) key serverRowIds routes through _serverRowIdsByPosition');
});

// ══════════════════════════════════════════════════════════════════════════
// [A-R19] — W-60 / R-19 (Drew D-44, "r-19 approve"): a PLAYER cannot mark an obligation paid, confirm it or deny it.
// Every attempt raised the red banner "The server refused to save cfbp_obligations: obligations: only status/paid_at
// may be self-edited … Nothing was saved."
//
// THE MECHANISM. handleObligationAction() (js/app.js) writes `deniedReason` on all three actions — null on Mark Paid
// and Confirm, the typed reason on Deny. `deniedReason` is not a column, so the projection carries it in `extra`
// (supabase-projection.js rowFromLegacy), and the row diff sent `extra` in the PATCH. obligations_guard
// (0002_rls.sql:526-535) refuses ANY change to `extra` (or to any column but status/paid_at) from a non-commissioner,
// so the WHOLE row was refused — the status change with it. The commissioner's path never failed: the guard returns
// before that check for him.
//
// 0046 (Drew M-28 / D-53) — the reason moves to obligations.denied_reason, a player's paid date is the SERVER's, and a reason never
// outlives its denial; (0) teaches the fake those rules, (3)/(5b)/(6)/(9) prove the client meets them. See also [A-0046-2K25].
// Each action runs on a FRESH adapter, so one refusal cannot latch the key and decide the next action's outcome.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-R19] R-19 + 0046 — a player\'s Mark Paid / Confirm / Deny reaches the server: status, the SERVER\'s date, the reason in its own column…', async () => {
  const at = new Date(NOW).toISOString();
  const later = new Date(NOW + 1234).toISOString();
  // The fake guard's clock (`now()` = NOW): 0046 dates a PLAYER's move to paid with it, never with the client's value.
  const SERVER_NOW = new Date(NOW).toISOString();
  const ob = (o) => row({ league_id: LEAGUE_A, type: 'weekly', week_id: 'w2', amount_or_prize: 'beer', created_at: at, paid_at: null,
    needs_review: false, review_note: null, voided: false, voided_at: null, void_reason: null, merged_into: null, merged_from: [],
    denied_reason: null, ...o });
  // What finalize_week leaves in a live row's `extra` (0026_b_roles_pilot.sql:2255-2264; [A-FB026] (0) proves the fake writes the same).
  const SHADOWS = { createdAt: at, paidAt: null, voided: false, voidedAt: null, voidReason: null, mergedInto: null, mergedFrom: [] };
  const seed = () => ST.obligations.push(
    ob({ id: 'obF', payer_member_id: 'p2', recipient_member_id: 'p3', status: 'unpaid', created_at: later, extra: { ...SHADOWS } }),
    // After 0046's backfill: an earlier commissioner denial, its reason in the COLUMN.
    ob({ id: 'obX', payer_member_id: 'p2', recipient_member_id: 'p3', status: 'unpaid', denied_reason: 'not received' }),
    // BEFORE the backfill reached it (an old client wrote it between the paste and the deploy): the reason still in `extra`.
    ob({ id: 'obL', payer_member_id: 'p2', recipient_member_id: 'p3', status: 'unpaid', extra: { deniedReason: 'stale' } }),
    ob({ id: 'obU', payer_member_id: 'p3', recipient_member_id: 'p2', status: 'unpaid' }),
    ob({ id: 'obC', payer_member_id: 'p3', recipient_member_id: 'p2', status: 'pending' }),
    ob({ id: 'obC2', payer_member_id: 'p3', recipient_member_id: 'p2', status: 'pending' }),
    ob({ id: 'obD', payer_member_id: 'p3', recipient_member_id: 'p2', status: 'pending' }),
    ob({ id: 'obS', payer_member_id: 'p2', recipient_member_id: 'p3', status: 'pending' }),
    ob({ id: 'obB', payer_member_id: 'p1', recipient_member_id: 'p3', status: 'unpaid' }),
  );
  const reload = () => captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const fresh = async (who) => { initAdapter({ who }); seed(); await reload(); };
  const srvOb = (id) => ST.obligations.find((o) => o.id === id);
  const mirrorOb = (id) => sb.get('cfbp_obligations').find((o) => o.obligationId === id);
  // saveObligation()'s exact shape (js/storage.js): the record replaced in place, the WHOLE array saved.
  const saveOb = (next) => sb.set('cfbp_obligations', sb.get('cfbp_obligations').map((o) => (o.obligationId === next.obligationId ? next : { ...o })));
  // handleObligationAction()'s / applyObligationDeny()'s exact writes (js/app.js), one per (action, resulting status).
  const WRITES = {
    markPending: (o) => ({ ...o, status: 'pending', deniedReason: null }),
    markPaid: (o) => ({ ...o, status: 'paid', paidAt: later, deniedReason: null }),
    confirm: (o) => ({ ...o, status: 'paid', paidAt: later, deniedReason: null }),
    deny: (o, reason) => ({ ...o, status: 'unpaid', deniedReason: reason, paidAt: null }),
  };
  /** Plan + flush what is in the mirror now, capturing everything the adapter said at BOTH steps. */
  const push = async () => {
    const planned = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_obligations');
    const logs = [..._captured];                       // everything the adapter said while planning…
    const mark = bannerSeen.length;
    await captureConsoleAsync(() => sb.flush());
    logs.push(..._captured);                           // …and while flushing (warn/info/error — the adapter uses no other)
    return { planned, logs, banners: bannersSince(mark), refused: sb._refusedKeysForTest().includes('cfbp_obligations'),
      dirty: sb._dirtyKeysForTest().includes('cfbp_obligations') };
  };
  /** One action, end to end, on a FRESH adapter (one refusal can never latch the key and decide the next action). */
  const act = async (who, id, write, reason) => {
    await fresh(who);
    saveOb(write(mirrorOb(id), reason));
    const r = await push();
    return { ...r, srv: { ...srvOb(id) } };
  };
  const cols = (r) => r.planned.map((o) => `${o.op}:${o.rowId}:${Object.keys(o.changed || {}).sort().join('+')}`).join(' ');
  const clean = (r) => !r.banners.length && !r.refused && !r.dirty;
  const seen = (r) => JSON.stringify({ planned: cols(r), status: r.srv.status, paid_at: r.srv.paid_at, denied_reason: r.srv.denied_reason, banners: r.banners });

  // ── (0) THE FAKE HAS TEETH — 0002's column/transition rules plus 0046's three additions and its CHECK. A green below means something.
  await fresh('player');
  const direct = (id, patch) => CLIENT.from('obligations').update(patch).eq('league_id', LEAGUE_A).eq('id', id).select('id');
  const t1 = await direct('ob1', { status: 'pending', extra: { deniedReason: null } });            // a player may not touch extra
  const t2 = await direct('obU', { paid_at: later });                                             // F2: a date alone
  const t3 = await direct('ob1', { status: 'paid', paid_at: later });                             // the payer confirming himself
  const t4 = await direct('ob1', { status: 'pending', paid_at: later });                          // a date on a row that is not paid
  const t5 = await direct('ob1', { status: 'pending', denied_reason: 'my own reason' });          // the PAYER giving a reason
  const t6 = await direct('obD', { denied_reason: 'no status move' });                            // a reason alone
  const t7 = await direct('obD', { status: 'unpaid', denied_reason: 'x'.repeat(201) });           // over 200 characters (CHECK)
  const t8 = await direct('obD', { status: 'unpaid', denied_reason: '   ' });                     // blank (CHECK)
  const msgs = [t1, t2, t3, t4, t5, t6, t7, t8].map((t) => t.error && `${t.error.code}:${t.error.message}`);
  assert(/42501:.*only status\/paid_at may be self-edited/.test(msgs[0]) && /42501:.*paid_at may change only with a status change/.test(msgs[1])
    && /42501:.*illegal status transition/.test(msgs[2]) && /42501:.*paid_at must be null off paid/.test(msgs[3])
    && /42501:.*only the recipient may give a reason/.test(msgs[4]) && /42501:.*denied_reason may change only with a status change/.test(msgs[5])
    && /^23514:.*obligations_denied_reason_shape/.test(msgs[6]) && /^23514:.*obligations_denied_reason_shape/.test(msgs[7])
    && srvOb('ob1').status === 'unpaid' && srvOb('ob1').paid_at == null && srvOb('ob1').denied_reason == null
    && srvOb('obU').status === 'unpaid' && srvOb('obU').paid_at == null && srvOb('obD').status === 'pending' && srvOb('obD').denied_reason == null,
    `[A-R19] (0) the modelled guard (0002 + 0046) refuses extra, a date alone, a self-confirm, a date off paid, a payer's reason, a reason alone, and the CHECK refuses an over-long or blank reason — each row unchanged (${JSON.stringify(msgs)})`);
  const t9 = await direct('obC', { status: 'paid', paid_at: '2020-01-01T00:00:00.000Z' });
  assert(!t9.error && srvOb('obC').status === 'paid' && srvOb('obC').paid_at === SERVER_NOW,
    `[A-R19] (0) …and a creditor's back-dated Confirm is ACCEPTED but dated by the server (security F2: ${srvOb('obC').paid_at}, not 2020)`);

  // ── (1) PAYER — Mark Paid (unpaid → pending, "waiting on the creditor").
  const r1 = await act('player', 'ob1', WRITES.markPending);
  assert(cols(r1) === 'patch:ob1:status', `[A-R19] (1) the payer's Mark Paid plans ONE patch carrying status alone — no extra (${cols(r1)})`);
  assert(r1.srv.status === 'pending' && r1.srv.paid_at == null && clean(r1),
    `[A-R19] (1) …the server holds it PENDING, and no red banner, nothing refused, nothing left unsent (${seen(r1)})`);

  // ── (2) PAYER — Mark Paid on a row finalize_week created (its `extra` holds seven typed-column shadows).
  const r2 = await act('player', 'obF', WRITES.markPending);
  assert(cols(r2) === 'patch:obF:status' && r2.srv.status === 'pending' && clean(r2)
    && JSON.stringify(r2.srv.extra) === JSON.stringify(SHADOWS) && r2.srv.created_at === later,
    `[A-R19] (2) on a live finalize-created row too: status alone, PENDING, extra and created_at as the server wrote them (${seen(r2)})`);

  // ── (3) PAYER — Mark Paid again after the COMMISSIONER denied it with a reason. 0046: the reason is a column the payer may
  //    CLEAR (and the guard clears it anyway), so the old reason leaves with the new claim — the stale-reason bug's first half.
  const r3 = await act('player', 'obX', WRITES.markPending);
  assert(cols(r3) === 'patch:obX:denied_reason+status' && r3.srv.status === 'pending' && r3.srv.denied_reason == null && clean(r3),
    `[A-R19] (3) after a commissioner's denial: status + the cleared reason, PENDING, and the server's reason is GONE (${seen(r3)})`);

  // ── (3b) A row the backfill has not reached yet (reason still in `extra`): the mirror shows NO reason (the column wins over its
  //    shadow), and the payer's tap sends status only — a player never writes `extra`, so the old key stays for the re-paste to sweep.
  await fresh('player');
  const shownBefore = 'deniedReason' in mirrorOb('obL');
  saveOb(WRITES.markPending(mirrorOb('obL')));
  const r3b = { ...(await push()), srv: { ...srvOb('obL') } };
  assert(!shownBefore && cols(r3b) === 'patch:obL:status' && r3b.srv.status === 'pending' && r3b.srv.extra.deniedReason === 'stale' && clean(r3b),
    `[A-R19] (3b) a pre-backfill row: no reason shown, the tap sends status alone, PENDING, extra left for the backfill (${seen(r3b)}, shown before: ${shownBefore})`);

  // ── (4) CREDITOR — "Confirm Paid" straight from unpaid. The client still sends its date (so a 0002-era guard accepts it too), and
  //    the server KEEPS ITS OWN (0046, security F2).
  const r4 = await act('player', 'obU', WRITES.markPaid);
  assert(cols(r4) === 'patch:obU:paid_at+status' && r4.srv.status === 'paid' && r4.srv.paid_at === SERVER_NOW && clean(r4),
    `[A-R19] (4) the creditor's Confirm Paid plans status + paid_at, and the server holds it PAID with the SERVER's date (${seen(r4)})`);

  // ── (5) CREDITOR — Confirm a pending payment.
  const r5 = await act('player', 'obC', WRITES.confirm);
  assert(cols(r5) === 'patch:obC:paid_at+status' && r5.srv.status === 'paid' && r5.srv.paid_at === SERVER_NOW && clean(r5),
    `[A-R19] (5) the creditor's Confirm plans status + paid_at, and the server holds it PAID with the SERVER's date (${seen(r5)})`);

  // ── (5b) TWO CONFIRMS IN A ROW on one device. After the first, this device's paidAt (its clock) and the server's differ, and
  //    `obligations` is not in the Realtime publication — so the SECOND save must not re-send the first row's date alone, which
  //    the guard would refuse WHOLE (security F2). The planner holds paid_at/denied_reason to a status move.
  await fresh('player');
  saveOb(WRITES.confirm(mirrorOb('obC')));
  const first = await push();
  saveOb(WRITES.confirm(mirrorOb('obC2')));
  const second = await push();
  assert(clean(first) && cols(second) === 'patch:obC2:paid_at+status' && clean(second)
    && srvOb('obC').status === 'paid' && srvOb('obC2').status === 'paid' && srvOb('obC2').paid_at === SERVER_NOW
    && second.logs.some((l) => /^(?=.*\bobC\b)(?=.*\bpaid_at\b)(?=.*not in its status)/.test(l)),
    `[A-R19] (5b) a second Confirm on the same device sends ONLY the second row, both land, no banner — and the held-back date is SAID (${cols(second)}; ${JSON.stringify(second.banners)})`);

  // ── (6) CREDITOR — Deny a pending payment, with a reason: it travels in its own column and the server keeps it.
  const r6 = await act('player', 'obD', WRITES.deny, 'never got it');
  assert(cols(r6) === 'patch:obD:denied_reason+status' && r6.srv.status === 'unpaid' && r6.srv.paid_at == null
    && r6.srv.denied_reason === 'never got it' && JSON.stringify(r6.srv.extra) === '{}' && clean(r6),
    `[A-R19] (6) the creditor's Deny plans status + the reason, and the server holds it UNPAID with the reason in denied_reason, extra untouched (${seen(r6)})`);
  await reload();
  assert(!sb._dirtyKeysForTest().includes('cfbp_obligations') && mirrorOb('obD').status === 'unpaid' && mirrorOb('obD').deniedReason === 'never got it',
    `[A-R19] (6) …and after a refresh (key clean, so read from the SERVER) the payer's device shows the denial AND its reason (${JSON.stringify(mirrorOb('obD') && { status: mirrorOb('obD').status, deniedReason: mirrorOb('obD').deniedReason })})`);
  // (6c) The reason edited later, with no status move: never sent (the guard would refuse it whole), said in ONE console line that
  //      names the row and the column — and (security hardening, R-19 review) no console line at plan or flush carries the text.
  saveOb({ ...mirrorOb('obD'), deniedReason: 'changed my mind about it' });
  const r6c = await push();
  assert(!r6c.planned.length && r6c.logs.some((l) => /^(?=.*\bobD\b)(?=.*\bdenied_reason\b)(?=.*not in its status)/.test(l))
    && srvOb('obD').denied_reason === 'never got it' && !r6c.banners.length,
    `[A-R19] (6c) a reason changed without a status move is NOT sent, and that is said by row and column; the server's reason stands (${JSON.stringify(r6c.logs)})`);
  assert(r6c.logs.length > 0 && ![...r6.logs, ...r6c.logs].some((l) => l.includes('never got it') || l.includes('changed my mind')),
    `[A-R19] (6c) …and no console line, at plan or at flush, carries a reason's text (${r6.logs.length + r6c.logs.length} line(s) read)`);

  // ── (7) AUTHORITY STAYS: a row Kevin is not party to is never planned, whatever his mirror says. RLS is the boundary;
  //    the planner does not even ask.
  await fresh('player');
  saveOb({ ...mirrorOb('obB'), status: 'paid', paidAt: later });
  const p7 = captureConsole(() => sb.planFlush()).plan.filter((o) => o.key === 'cfbp_obligations');
  await captureConsoleAsync(() => sb.flush());
  assert(!p7.length && srvOb('obB').status === 'unpaid',
    `[A-R19] (7) a bystander's change to someone else's obligation is never planned, and the server row is untouched (${JSON.stringify(p7.map((o) => o.rowId))})`);

  // ── (8) THE COMMISSIONER IS NOT NARROWED. His Deny carries the reason to the same column; the guard's commissioner branch is unchanged.
  const r8 = await act('commissioner', 'obC', WRITES.deny, 'wrong week');
  assert(cols(r8) === 'patch:obC:denied_reason+status' && r8.srv.status === 'unpaid' && r8.srv.denied_reason === 'wrong week'
    && JSON.stringify(r8.srv.extra) === '{}' && clean(r8),
    `[A-R19] (8) the commissioner's Deny sends status AND the reason, and the server keeps both, in the column (${seen(r8)})`);

  // ── (9) THE STALE-REASON BUG, END TO END, ON ONE SERVER: the commissioner denies with a reason; the payer claims it again; the
  //    commissioner denies AGAIN without one. Before 0046 the payer could not clear `extra`, so the first reason came back on the
  //    second denial. Now it never does.
  await fresh('commissioner');
  const SRV = ST;
  saveOb(WRITES.deny(mirrorOb('obS'), 'wrong week'));
  const s1 = await push();
  initAdapter({ who: 'player', server: SRV }); await reload();
  const payerSaw = mirrorOb('obS').deniedReason;
  saveOb(WRITES.markPending(mirrorOb('obS')));
  const s2 = await push();
  const afterClaim = { ...srvOb('obS') };
  initAdapter({ who: 'commissioner', server: SRV }); await reload();
  saveOb(WRITES.deny(mirrorOb('obS'), null));
  const s3 = await push();
  initAdapter({ who: 'player', server: SRV }); await reload();
  assert(clean(s1) && clean(s2) && clean(s3) && payerSaw === 'wrong week' && afterClaim.status === 'pending' && afterClaim.denied_reason == null
    && srvOb('obS').status === 'unpaid' && srvOb('obS').denied_reason == null && !('deniedReason' in mirrorOb('obS')),
    `[A-R19] (9) the payer saw "wrong week"; his new claim cleared it; the second denial (no reason) shows NO reason — the old one never comes back (${JSON.stringify({ payerSaw, afterClaim: afterClaim.denied_reason, final: srvOb('obS').denied_reason, mirror: mirrorOb('obS') && mirrorOb('obS').deniedReason })})`);
});

// ══════════════════════════════════════════════════════════════════════════
// [A-0046-2K25] — the 2K25 "Outstanding Balances" card. Its status lives in league_kv settings.ob2025, which only the commissioner
// may write; a PLAYER's saveSetting() was refused on his device and never saved. 0046's settle_2025_obligation is the narrow
// server path; sb.settleOb2025() calls it, folds the returned settings row in like a Realtime event, and REJECTS on every refusal.
// In this fake Kevin is p2: the RECIPIENT of ob_2025_wk1 (p3 -> p2) and wk2/wk5 (-> p2), the PAYER of ob_2025_wk6 (p2 -> p6);
// ob_2025_wk4 (p6 -> p5) is not his.
// ══════════════════════════════════════════════════════════════════════════
await section('\n[A-0046-2K25] a player settles HIS OWN 2K25 balance through settle_2025_obligation, and every refusal rejects — never a silent no-op…', async () => {
  const kvRow = (lid = LEAGUE_A) => ST.league_kv.find((r) => r.league_id === lid && r.key === 'settings');
  const srvMap = () => (kvRow().value && kvRow().value.ob2025) || {};
  const mirrorMap = () => (sb.get('cfbp_settings') || {}).ob2025 || {};
  const tryIt = async (args) => { try { return { ok: await sb.settleOb2025(args) }; } catch (e) { return { err: e }; } };
  const rpcCalls = () => CLIENT._calls.rpc.filter((c) => c.name === 'settle_2025_obligation');

  await hydrated({ who: 'player' });
  const othersBefore = JSON.stringify({ ...kvRow().value, ob2025: undefined });
  const r1 = await tryIt({ obligationId: 'ob_2025_wk6', action: 'mark' });
  assert(r1.ok && r1.ok.status === 'pending' && srvMap().ob_2025_wk6 === 'pending' && mirrorMap().ob_2025_wk6 === 'pending'
    && !sb._dirtyKeysForTest().includes('cfbp_settings') && rpcCalls().length === 1 && rpcCalls()[0].args.p_league === LEAGUE_A,
    `[A-0046-2K25] (1) the PAYER's Mark Paid lands PENDING on the server, and this device's settings show it at once without a pending write (${JSON.stringify({ r: r1.ok, srv: srvMap(), mirror: mirrorMap() })})`);
  assert(JSON.stringify({ ...kvRow().value, ob2025: undefined }) === othersBefore,
    '[A-0046-2K25] (1) …and nothing else in the settings row moved — one key of one map');

  const r2 = await tryIt({ obligationId: 'ob_2025_wk1', action: 'mark' });
  assert(r2.ok && r2.ok.status === 'paid' && srvMap().ob_2025_wk1 === 'paid' && mirrorMap().ob_2025_wk1 === 'paid',
    `[A-0046-2K25] (2) the RECIPIENT's Confirm Paid (unpaid -> paid) lands PAID (${JSON.stringify(srvMap())})`);

  // Two payments the payers claimed elsewhere: pending on the server, then a refresh.
  kvRow().value = { ...kvRow().value, ob2025: { ...srvMap(), ob_2025_wk2: 'pending', ob_2025_wk5: 'pending' } };
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const r3 = await tryIt({ obligationId: 'ob_2025_wk2', action: 'confirm' });
  const r4 = await tryIt({ obligationId: 'ob_2025_wk5', action: 'deny' });
  assert(r3.ok && r3.ok.status === 'paid' && srvMap().ob_2025_wk2 === 'paid' && r4.ok && r4.ok.status === 'unpaid'
    && !('ob_2025_wk5' in srvMap()) && !('ob_2025_wk5' in mirrorMap()),
    `[A-0046-2K25] (3) the recipient's Confirm lands PAID, his Deny puts it back to UNPAID (the key ABSENT, as the client writes it) (${JSON.stringify(srvMap())})`);

  // REFUSALS — each REJECTS with the server's named code, and the map is unchanged.
  const mapNow = JSON.stringify(srvMap());
  const refusals = {
    not_party: await tryIt({ obligationId: 'ob_2025_wk4', action: 'mark' }),
    illegal_transition: await tryIt({ obligationId: 'ob_2025_wk6', action: 'confirm' }),   // the payer cannot confirm his own claim
    bad_action: await tryIt({ obligationId: 'ob_2025_wk6', action: 'undo' }),              // undo is the commissioner's
    not_found: await tryIt({ obligationId: 'ob_2025_wk99', action: 'mark' }),
  };
  assert(Object.entries(refusals).every(([code, r]) => r.err && r.err.code === code) && JSON.stringify(srvMap()) === mapNow,
    `[A-0046-2K25] (4) a non-party, an illegal move, a commissioner-only action and an unknown row each REJECT with the server's own code; nothing moved (${JSON.stringify(Object.fromEntries(Object.entries(refusals).map(([k, r]) => [k, r.err ? r.err.code : 'RESOLVED'])))})`);
  ST.leagues.find((l) => l.id === LEAGUE_A).status = 'paused';
  const paused = await tryIt({ obligationId: 'ob_2025_wk6', action: 'mark' });
  ST.leagues.find((l) => l.id === LEAGUE_A).status = 'active';
  assert(paused.err && paused.err.code === 'league_paused' && JSON.stringify(srvMap()) === mapNow,
    `[A-0046-2K25] (4) a PAUSED league refuses (${paused.err && paused.err.code})`);

  initAdapter({ who: 'bOnly', leagueId: LEAGUE_B });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_B, { epoch: EPOCH }));
  const notPilot = await tryIt({ obligationId: 'ob_2025_wk6', action: 'mark' });
  assert(notPilot.err && notPilot.err.code === 'not_pilot' && !(kvRow(LEAGUE_B) && kvRow(LEAGUE_B).value && kvRow(LEAGUE_B).value.ob2025),
    `[A-0046-2K25] (5) a league that is NOT the pilot refuses (${notPilot.err && notPilot.err.code}), and its settings gain no 2K25 map`);

  initAdapter({ who: 'nonMember' });
  const stranger = await tryIt({ obligationId: 'ob_2025_wk6', action: 'mark' });
  assert(stranger.err && stranger.err.code === 'not_member' && !srvMap().ob_2025_wk6,
    `[A-0046-2K25] (5) an account with no seat in the league refuses (${stranger.err && stranger.err.code})`);

  initAdapter({ who: 'player', rpcOverride: (name) => (name === 'settle_2025_obligation' ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : null) });
  await captureConsoleAsync(() => sb.hydrate(LEAGUE_A, { epoch: EPOCH }));
  const offline = await tryIt({ obligationId: 'ob_2025_wk6', action: 'mark' });
  assert(offline.err && offline.err.code === 'unavailable' && !srvMap().ob_2025_wk6,
    `[A-0046-2K25] (6) a network failure REJECTS as 'unavailable' — never a resolved no-op (${offline.err && offline.err.code})`);
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
