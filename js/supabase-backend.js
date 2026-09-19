/**
 * CFB Pickems — supabase-backend.js (Phase III, Step 4 Part A, DI-T4.1…T4.7)
 * ===========================================================================
 * THE THIRD STORAGE MODE. Same public surface as js/backend.js's mirror half
 * (`isReady`/`isStale`/`get`/`set`/`hydrate`/`flush`/`onStatus`/`getStatus`),
 * so js/storage.js can route to either without a call-site change — see
 * `backend.js:434` `isBackendReady()`, `:436` `isMirrorStale()`, `:804-806`
 * `cacheGet()`, `:815-829` `cacheSet()`, `:701-787` `hydrate()`, `:924-1018`
 * `flushPush()`, `:472-473` `onBackendStatus()`, `:297-305` `getSyncStatus()`.
 *
 * THREE CONSTRAINTS THAT SHAPE EVERY LINE BELOW.
 *
 * 1. ZERO TOP-LEVEL SIDE EFFECTS. Importing this module creates no client,
 *    reads no storage, arms no timer and touches no DOM. Part B (the seam
 *    wiring in `storage.js`/`auth.js`/`app.js`) is then a wiring change and
 *    `loadtest.mjs`'s DOM stub can import the seam exactly as it does today.
 *
 * 2. NO IMPORT OF auth.js / app.js / storage.js / backend.js. The only import
 *    is `./supabase-projection.js`, which is a pure module (its own header:
 *    "Imports ONLY `./data-model.js`"). Everything this adapter needs from
 *    auth.js and friends arrives through `init({…})` as INJECTED FUNCTIONS:
 *      - `auth.js` imports `backend.js` (`auth.js:31`) and `storage.js` imports
 *        `auth.js` (`storage.js:27`). An `import … from './auth.js'` here would
 *        make `auth.js -> supabase-backend.js -> auth.js` a cycle, which is
 *        exactly why DI §1.3 has the adapter REGISTER its probe on auth.js
 *        rather than be imported by it.
 *      - `storage.js`'s `setSiteUnlocked()` (`storage.js:676-679`) and
 *        `backend.js`'s `clearMirror()` (`backend.js:469`) are the two
 *        Sheets-era device records §6.1 wipes. Both arrive injected, so the
 *        first-boot wipe does not drag an ask-first module into this graph.
 *
 * 3. READS ARE SYNCHRONOUS. `get()` is a Map lookup. There is no `await`
 *    anywhere inside `get`, `set` or `isReady` — CONVENTIONS #9, and the
 *    assessment's risk 1 ("Reviewer treats any `await` in a read path as an
 *    automatic BLOCK"). `adaptertest.mjs` A1 greps this file for it.
 *
 * NEVER RE-IMPLEMENT A PROJECTION. `toRows` / `fromRows` / `KEY_TABLES` /
 * `canonicalize` / `stripCredentials` come from `js/supabase-projection.js`
 * verbatim. That module is the single definition of "what a pick looks like as
 * a row" in both directions, and a second opinion about it is how the import
 * verifier and the live app come to disagree.
 *
 * ── RESIDUALS CARRIED OUT OF PART B (2026-09-18, coordinator-accepted) ─────
 * `cfbp_auth_mode_last_known` still stores a BARE authMode string, not DI
 * §1.4's `{authMode, dataMode}` pair. Part B implemented the in-page half only:
 * `configureAuth()` keeps the dataMode a SUCCESSFUL config read last
 * established rather than downgrading on a failed one, so a transient blip
 * cannot tear a working session down to a hold mid-session. ACROSS pages the
 * memory is deliberately absent: a cold boot with an unreadable config resolves
 * authMode from the record, gets 'sheets' for the data layer, and HOLDS behind
 * the interlock — which is the correct fail-closed outcome for that device, and
 * the only thing the persisted pair would buy is avoiding it. Not built because
 * changing the stored format of a security-critical fail-closed record is a
 * real risk against a benefit that is a hold either way. Revisit at cutover if
 * Drew wants the hold gone.
 *
 * ── A NOTE FOR PART B, and it is a REPORTED DISCREPANCY, not an edit ────────
 * DI §1.2's table renames `useSheets(key)` to `useBackend(key)` and routes
 * `load()` to this module's synchronous read when it is true. When the adapter
 * is NOT ready (`HELD`, `HYDRATING`, `SWITCHING`), `useBackend()` would be
 * false and `load()` would fall through to its `localStorage.getItem` branch —
 * which on a post-cutover device can still hold Sheets-era league data under
 * the same `cfbp_*` key. `isContentWithheld()` (§5.1) stops it being PAINTED,
 * but the read itself is not what §0.3 item 3 promises.
 *
 * CLOSED BY DI-T4.10 AND BUILT IN PART B (2026-09-18): `useBackend()` is
 * decided by the MODE in `supabase`, and readiness decides only what this
 * module ANSWERS — `null`. See `storage.js`'s `useBackend()` comment for the
 * asymmetry with the googleSheets arm and why that arm is right to differ.
 * `persisttest [9]` drives it against real Sheets-era rows on the device.
 */

import {
  toRows, fromRows, KEY_TABLES, canonicalize, stripCredentials,
} from './supabase-projection.js';

// ══════════════════════════════════════════════════════════════════════════
// 0 · typed errors (AD-06 loud-fail; the shape auth.js:50-67 established)
// ══════════════════════════════════════════════════════════════════════════

/**
 * A write the SERVER refused, or one the adapter refused CLIENT-SIDE because it
 * knows the server would (§5.2). Never a silent no-op: a no-op looks exactly
 * like a successful save to every caller, which is the failure AD-06 exists for.
 *
 * `serverMessage` is the server's OWN words when there are any (`42501`'s
 * message, or an RPC's named exception such as `bad_transition` /
 * `not_commissioner` / `bad_key`), so the red banner names the rule rather than
 * a number. It is UNTRUSTED TEXT — every render path must run it through
 * `escHtml()` (CONVENTIONS, and `xsstest.mjs` is the guard).
 */
export class AdapterWriteRefusedError extends Error {
  constructor(message, { code = 'write_refused', key = '', rowId = null, leagueId = null, serverMessage = '' } = {}) {
    super(message || 'The server refused to save that change.');
    this.name = 'AdapterWriteRefusedError';
    this.code = code;
    this.key = key;
    this.rowId = rowId;
    this.leagueId = leagueId;
    this.serverMessage = serverMessage;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1 · state
// ══════════════════════════════════════════════════════════════════════════

/**
 * THE STATE MACHINE (DI §1.3). Every transition goes through ONE function,
 * `_setState(next, reason)`, which is also the only place `onStatus` is emitted
 * FOR A STATE CHANGE. (`flush()` additionally emits `'refused'`/`'error'`/
 * `'synced'` WITHOUT changing state — a refusal is a fact about one write, not
 * a reason to unload the league. `_refusedKeys` is its own latch in §1.3's
 * table for exactly that reason.)
 *
 *   IDLE              nothing loaded. The initial state, and where dropMirror() lands.
 *   HYDRATING         the FIRST hydrate for this league; nothing to serve yet.
 *   ACTIVE            hydrated for the active league under the current identity epoch.
 *   ACTIVE-STALE      serving the owner-verified device snapshot while a hydrate is in flight.
 *   SWITCHING         a league switch is in progress (§3.2). Writes refused.
 *   HELD              a data hold (§5.1): hydrate failed with nothing serveable, or
 *                     withhold() was called (session expired, §6.3).
 *   OFFLINE-READONLY  serving the snapshot with no live hydrate (§5.3). Reads yes,
 *                     writes NEVER — the interlock does the refusing.
 */
/**
 * SECURITY F-3 / F-E — AN ALLOW-LIST THAT IS ACTUALLY IMMUTABLE. It took two goes.
 *
 * FIRST ATTEMPT: `Object.freeze(new Set(...))`. Worthless — a Set's contents are INTERNAL SLOTS,
 * not object properties, so freezing leaves `add`/`delete`/`clear` fully working.
 * `GAME_SCORE_FIELDS.add('spread')` succeeded on a "frozen" Set, and that one line turns the player
 * score overlay into a write path for the signed spread (AD-03's column).
 *
 * SECOND ATTEMPT: keep the Set, replace the three mutators on the INSTANCE with throwing stubs,
 * then freeze. Better, and still bypassable in one line — `Set.prototype.add.call(set, 'spread')`
 * walks straight past an own-property stub and mutates the internal slot anyway (security F-E).
 * Own-property shadowing cannot defend a data structure whose state lives somewhere the property
 * lookup never goes.
 *
 * WHAT ACTUALLY WORKS: a FROZEN ARRAY. An array's elements ARE indexed properties and its length is
 * a property, so `Object.freeze` reaches all of it — `push`, `pop`, index assignment and
 * `Array.prototype.push.call(arr, x)` all throw in strict mode (ES modules are always strict).
 * There is no internal slot to go around, because there is no internal slot.
 *
 * The cost is `.includes()` instead of `.has()`: O(n) on lists of 4, 6 and 10 entries, read a
 * handful of times per flush. That is not a trade worth thinking about, and it buys an invariant
 * that a one-line probe cannot break.
 */
function frozenList(values) {
  return Object.freeze([...values]);
}

const STATES = ['IDLE', 'HYDRATING', 'ACTIVE', 'ACTIVE-STALE', 'SWITCHING', 'HELD', 'OFFLINE-READONLY'];

/** The five status values `onStatus` carries (DI §1.1). `detail.state` carries
 *  the machine state itself, so the sync badge (`app.js:1167-1188`) can say
 *  WHY rather than only "error". IDLE maps to 'offline' rather than 'error'
 *  because "no league is loaded" is not a sync failure — it is the state a
 *  handover clear deliberately leaves behind (§6.6). */
const STATUS_FOR = {
  IDLE: 'offline',
  HYDRATING: 'syncing',
  ACTIVE: 'synced',
  'ACTIVE-STALE': 'syncing',
  SWITCHING: 'syncing',
  HELD: 'error',
  'OFFLINE-READONLY': 'offline',
};

/** The probe `hasSupabaseDataBackend()` reads (DI §1.3, entry condition #2).
 *  TRUE in exactly two states. `OFFLINE-READONLY` is deliberately NOT one of
 *  them: lifting the interlock is what would ALLOW A WRITE, and an offline
 *  device must not accept one. */
const PROBE_TRUE_STATES = frozenList(['ACTIVE', 'ACTIVE-STALE']);

/** Reads are served in these three. `OFFLINE-READONLY` IS here — the whole
 *  point of §5.3 is that the player can read his own league — which is why
 *  `isReady()` and the probe are two different questions and not one. */
const READY_STATES = frozenList(['ACTIVE', 'ACTIVE-STALE', 'OFFLINE-READONLY']);

const SNAPSHOT_KEY = 'cfbp_supabase_mirror';
const PUSH_DEBOUNCE_MS = 800;          // backend.js:834
const DERIVED_PROGRESS_KEY = 'cfbp_week_progress';

let _state = 'IDLE';
let _stateReason = '';
let _mirror = new Map();               // cfbp key -> projected legacy value (the SYNCHRONOUS read source)
let _baseRows = new Map();             // cfbp key -> Map(row.id -> row) as the server last served it
let _baseValues = new Map();           // cfbp key -> the legacy value that projection produced (kv + RG-12 checks)
const _overlay = new Map();            // cfbp_games ONLY (§2.1): rendered, never pushed, never persisted
const _dirty = new Map();              // cfbp key -> { fields:Set|null, leagueId, epoch, switchSeq }
const _refusedKeys = new Map();        // cfbp key -> { code, serverMessage, atHydrateSeq }
let _mirrorTag = null;                 // { leagueId, epoch, switchSeq, at }
let _switchSeq = 0;
let _hydrateSeq = 0;                   // ++ on every hydrate that LANDS
let _pushTimer = null;
let _lastSyncAt = null;
let _lastError = null;
let _firstSupabaseBootDone = false;
let _rt = null;                        // { channel, phase: 'joined' | 'live', leagueId }
let _rtRehydrateArmed = false;
const _listeners = new Set();
let _deps = null;
/** The `get_member_contacts()` rows from the CURRENT hydrate, keyed by
 *  member_id. §2.4 rule 1 reads this and nothing else: a contact column the
 *  adapter did not READ this hydrate can never be WRITTEN. Cleared by
 *  `dropMirror()` along with the mirror it describes. */
let _lastContacts = new Map();

/** Injected accessors. The SEVEN the Step 4 brief pins are required; the rest
 *  are optional and default to something safe, so a caller (and `adaptertest`)
 *  can construct the adapter without stubbing the whole of auth.js. */
const DEP_DEFAULTS = {
  getClient: () => null,
  getActiveLeagueId: () => null,
  getIdentityEpoch: () => 0,
  getAccountUserId: () => '',
  getDeviceDataOwnerTuple: () => '',
  getDeviceDataOwner: () => '',
  register: null,
  // optional
  getLeagueName: () => '',                 // §3.3 — the banner names BOTH leagues
  getLeagueNameById: null,                 // when the caller can resolve a name for an id it has left
  getSession: () => ({ isAdmin: false, playerId: '' }),
  hasValidSupabaseSession: () => false,    // §5.3 condition (1)
  isPrivilegeHeld: () => false,            // §6.4
  clearMirror: () => {},                   // backend.js:469 — §6.1
  setSiteUnlocked: () => {},               // storage.js:676-679 — §6.1
  // Reviewer F9 — the READ-BACK half of §6.1, injected beside the two clearers rather than read
  // off key literals this module does not own. `null` (no accessor) reports NOT VERIFIED.
  hasSheetMirror: null,                    // () => boolean — is cfbp_sheet_mirror still on the device?
  isSiteUnlocked: null,                    // () => boolean — storage.js's own getSiteUnlocked()
  onRealtimeEvent: null,                   // §4.2 — Part B repaints from this
  now: () => Date.now(),
};

function _dep(name) {
  const d = _deps && _deps[name];
  return typeof d === 'function' ? d : DEP_DEFAULTS[name];
}

function _safe(name, ...args) {
  try {
    const fn = _dep(name);
    return typeof fn === 'function' ? fn(...args) : null;
  } catch (e) {
    console.warn(`[sb] injected ${name}() threw; treated as unavailable`, e && e.name);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 2 · init / registration surface (DI §1.3 — registered, never imported)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Wire the adapter to its host. Called ONCE by Part B (js/auth.js), which
 * supplies its own accessors; the adapter then calls `register(probe)` —
 * `registerSupabaseDataBackend()` — so `hasSupabaseDataBackend()` derives from
 * the LIVE state machine and never from a config flag (entry condition #2,
 * A7's mutant).
 *
 * Idempotent: calling it again replaces the accessor set and re-registers the
 * same probe. It does NOT hydrate, does not read storage and does not create a
 * client — every one of those is an explicit later call.
 */
export function init(deps = {}) {
  _deps = { ...deps };
  const register = _deps.register;
  if (typeof register === 'function') {
    try { register(probe); } catch (e) { console.warn('[sb] registerSupabaseDataBackend() failed', e); }
  }
  return { probe };
}

/**
 * THE PROBE. Exported as a named function as well as handed to `register()`,
 * so a test can read it directly and so `init()` has one thing to pass.
 *
 * `isPrivilegeHeld()` (§6.4, `auth.js:1015`) is folded in here rather than
 * given a latch of its own: while a re-verification is in flight the server
 * would refuse the write, and the client must not offer an action it knows may
 * be refused. Release is the existing `SESSION_REVERIFIED` path — no new latch,
 * so R2's release test is the existing one plus "a save() after
 * SESSION_REVERIFIED succeeds".
 */
export function probe() {
  if (!PROBE_TRUE_STATES.includes(_state)) return false;
  // FAIL CLOSED, and deliberately NOT through `_safe()`: that helper answers
  // `null` for both "returned nothing" and "threw", which for a SECURITY
  // predicate is the wrong direction — a privilege check this device cannot
  // evaluate must read as HELD, not as permission. The probe itself still never
  // throws, because `storage.save()`'s interlock has no catch of its own.
  let held = false;
  try { held = _dep('isPrivilegeHeld')() === true; }
  catch (e) { held = true; console.warn('[sb] isPrivilegeHeld() threw — treating the privilege as HELD (writes refused)', e && e.name); }
  return !held;
}

// ══════════════════════════════════════════════════════════════════════════
// 3 · status channel + the ONE state transition
// ══════════════════════════════════════════════════════════════════════════

export function onStatus(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

function emit(status, detail) {
  _listeners.forEach((fn) => { try { fn(status, detail); } catch { /* a listener's failure is not the adapter's */ } });
}

/** THE ONLY function that changes `_state` (DI §1.3). Emits on every call —
 *  including a same-state call, because a second `HELD` for a different reason
 *  is a different thing to say to the player. */
function _setState(next, reason) {
  if (!STATES.includes(next)) throw new Error(`[sb] unknown state ${next}`);
  const prev = _state;
  _state = next;
  _stateReason = String(reason || '');
  emit(STATUS_FOR[next], {
    state: next, prev, reason: _stateReason,
    leagueId: _mirrorTag ? _mirrorTag.leagueId : null,
    lastError: _lastError, pendingWrites: _dirty.size,
    refusedKeys: [..._refusedKeys.keys()],
  });
  return next;
}

export function getStatus() {
  return {
    state: _state,
    reason: _stateReason,
    leagueId: _mirrorTag ? _mirrorTag.leagueId : null,
    epoch: _mirrorTag ? _mirrorTag.epoch : null,
    switchSeq: _switchSeq,
    lastSyncAt: _lastSyncAt,
    lastError: _lastError,
    pendingWrites: _dirty.size,
    refusedKeys: [..._refusedKeys.keys()],
    realtime: _rt ? _rt.phase : 'off',
    stale: _state === 'ACTIVE-STALE',
  };
}

export function isReady() { return READY_STATES.includes(_state); }
export function isStale() { return _state === 'ACTIVE-STALE'; }
export function getState() { return _state; }

// ══════════════════════════════════════════════════════════════════════════
// 4 · per-key routing table (DI §2.1)
// ══════════════════════════════════════════════════════════════════════════

/**
 * READ = what `hydrate()` selects for the active league (PostgREST, as the
 * caller, RLS applied — the client is never a superuser). WRITE = what the
 * flush planner emits for a change to that key, by the caller's role.
 *
 * `verb` values:
 *   'rows'    PostgREST insert / patch / delete on the diff
 *   'kv'      patch_kv(key, …) — merge when the writer declared fields, replace otherwise
 *   'rpc'     a named RPC owns the write (weeks status legs, results)
 *   'refuse'  typed AdapterWriteRefusedError, loud (§5.2)
 *
 * `ownRowsOnly` means the diff may only emit operations for rows whose
 * `member_id` is mine. `noDelete` means a vanished row is NEVER sent as a
 * delete (AD-28 obligations; append-only game_requests).
 */
const ID_FIELD = {
  cfbp_players: 'playerId',
  cfbp_weeks: 'weekId',
  cfbp_games: 'gameId',
  cfbp_picks: 'pickId',
  cfbp_results: 'resultId',
  cfbp_obligations: 'obligationId',
  cfbp_feedback: 'id',
  cfbp_comments: 'commentId',
  cfbp_notifications: 'id',
  cfbp_game_requests: 'id',
};

/** Columns the PROJECTION stamps with "now" every time it runs
 *  (`supabase-projection.js:494` `updated_at: toIso(new Date())`, `:1100`
 *  `created_at: toIso(new Date())`). Comparing them would mark every row
 *  changed on every flush, so they are excluded from the change comparison —
 *  and from the columns a patch sends. This is a real property of those two
 *  `toRows` implementations, not a convenience. */
const VOLATILE_COLS = {
  tiebreaker_guesses: ['updated_at'],
  extra_point_guesses: ['updated_at'],
  reactions: ['created_at'],
};

/** The score fields ESPN writes on every device (`app.js:13495`
 *  `doRefreshScores()` -> `saveGame()`, `storage.js:938-944`). On a
 *  non-commissioner device a change confined to these is an OVERLAY: rendered,
 *  never pushed (§2.1, §7.1 item 3). Any other field is a refusal. */
const GAME_SCORE_FIELDS = frozenList([
  'homeScore', 'awayScore', 'status', 'lastUpdated',
  'actualWinner', 'period', 'clock', 'situation', 'lastPlay', 'statusDetail',
]);

const ROUTES = {
  cfbp_settings: { table: 'league_kv', kvKey: 'settings', comm: 'kv', player: 'refuse' },
  cfbp_players: { table: 'league_members', comm: 'rows', player: 'rows', ownRowsOnly: true, noDelete: true, memberIdCol: 'id' },
  cfbp_weeks: { table: 'weeks', comm: 'rows', player: 'refuse' },
  cfbp_games: { table: 'games', comm: 'rows', player: 'overlay' },
  cfbp_picks: { table: 'picks', comm: 'rows', player: 'rows', ownRowsOnly: true },
  cfbp_results: { table: 'results', comm: 'rpc-finalize', player: 'refuse' },
  cfbp_obligations: { table: 'obligations', comm: 'rows', player: 'rows', ownRowsOnly: true, noDelete: true, memberIdCol: null },
  cfbp_nicknames: { table: 'league_kv', kvKey: 'nicknames', comm: 'kv', player: 'refuse' },
  cfbp_lock_overrides: { table: 'league_kv', kvKey: 'lock_overrides', comm: 'kv', player: 'refuse' },
  cfbp_tiebreaker_guesses: { table: 'tiebreaker_guesses', comm: 'rows', player: 'rows', ownRowsOnly: true },
  cfbp_extra_point_guesses: { table: 'extra_point_guesses', comm: 'rows', player: 'rows', ownRowsOnly: true },
  cfbp_rejected_suggestions: { table: 'league_kv', kvKey: 'rejected_suggestions', comm: 'kv', player: 'refuse' },
  cfbp_reactions: { table: 'reactions', comm: 'rows', player: 'rows', ownRowsOnly: true },
  cfbp_feedback: { table: 'feedback', comm: 'rows', player: 'rows', noDelete: true, memberIdCol: null },
  cfbp_feedback_excluded_ids: { table: 'league_kv', kvKey: 'feedback_excluded_ids', comm: 'kv', kvMode: 'replace', player: 'refuse' },
  // `ownRowsOnly` (security F-6) is what routes this key into `_mayOperateOnRow`'s comments branch
  // at all — without it the function returns true on its first line and a player's whole-array
  // rewrite would emit a delete for every comment that vanished from the array, including five
  // other people's. The commissioner still passes, by the admin branch: 0008's `comments_delete` is
  // `own row OR commissioner`.
  cfbp_comments: { table: 'comments', comm: 'rows', player: 'rows', ownRowsOnly: true },
  cfbp_active_week: { table: 'league_kv', kvKey: 'active_week', comm: 'kv', kvMode: 'replace', player: 'refuse' },
  cfbp_fetch_proof: { table: 'league_kv', kvKey: 'fetch_proof', comm: 'kv', kvMode: 'replace', player: 'refuse' },
  cfbp_notifications: { table: 'notifications', comm: 'refuse', player: 'refuse' },
  cfbp_scribe_learnings: { table: 'scribe_learnings', comm: 'rows', player: 'refuse', noDelete: true, patchCols: ['status'] },
  cfbp_scribe_canon: { table: 'scribe_canon', comm: 'rows', player: 'refuse', noDelete: true, patchCols: ['approval_status'] },
  cfbp_scribe_reports: { table: 'scribe_reports', comm: 'refuse', player: 'refuse' },
  cfbp_game_requests: { table: 'game_requests', comm: 'rows', player: 'rows', noDelete: true, insertOnly: true, memberIdCol: 'member_id' },
};

/**
 * SECURITY F-3 — THE ROUTING TABLE IS FROZEN, ENTRY BY ENTRY.
 *
 * `ROUTES` decides, for every key, whether a write is a row operation, an RPC, a mirror-only
 * overlay or a refusal. It is the authorization table this module is built on, and until this line
 * it was an ordinary mutable object: any module in the page (a console paste, a future import, a
 * third-party script a CDN ever serves) could have set `ROUTES.cfbp_results.player = 'rows'` and
 * turned every refusal in §2.1 into a write, with no error and no log line.
 *
 * Freezing is not a security boundary against code running in the same realm — anything that can
 * evaluate can still reach a great deal — but it converts a SILENT redefinition into a thrown
 * TypeError under strict mode (ES modules are always strict), which is the difference between a
 * change nobody sees and one that stops. The same reasoning covers the other four tables: the state
 * sets the probe reads, the field allow-list the overlay reads, and the transition allow-list.
 *
 * Each ENTRY is frozen too, not merely the outer object: `Object.freeze(ROUTES)` alone would leave
 * every `{ table, comm, player }` record writable, which is where the interesting mutation is.
 */
for (const entry of Object.values(ROUTES)) Object.freeze(entry);
Object.freeze(ROUTES);

/**
 * WHY `cfbp_notifications` IS `refuse` ON BOTH SIDES, and it is not an
 * oversight (§2.1, Q10). The only client-side mutation of a notification is
 * `readAt`, and the read position is DEVICE-LOCAL by policy
 * (`js/notifications.js:382-395`, and the schema says so at
 * `0001_schema.sql` notifications.read_at: "kept for shape; read position is
 * device-local"). So there is no client write to route. Migration 0008 opens
 * INSERT to the COMMISSIONER for the lifecycle fan-out; that fan-out is
 * `notifications.js`'s own path, not a `save(cfbp_notifications, …)`, and
 * wiring it is Step 4 Part B / Step 6. A refusal here is therefore loud about
 * something that should never happen rather than a missing feature.
 */

/** Which tables `hydrate()` selects. `messages` is ABSENT — AD-16, Step 5 —
 *  and so is `standings` (D-2: nothing writes it until Step 6, so reading it
 *  would render an empty table over a computed one). */
const READ_TABLES = [
  'league_kv', 'league_members', 'weeks', 'games', 'picks', 'results', 'obligations',
  'tiebreaker_guesses', 'extra_point_guesses', 'reactions', 'feedback', 'comments',
  'notifications', 'scribe_learnings', 'scribe_canon', 'scribe_reports', 'game_requests',
];

/**
 * `select('*')` DOES NOT WORK ON `league_members` ANY MORE, and never will
 * again: 0007 replaced the table grant with a COLUMN LIST, and PostgREST
 * expands `*` to every column of the table — so the request is refused for
 * lack of column privilege, for every caller, member or not. The fifteen
 * columns below are 0007's own `grant select (…)` list
 * (`0007_contact_privacy.sql:98-100`), and `rls.test.mjs`'s `LM_SELECT_COLS`
 * (`rls.test.mjs:318-319`) is the same list for the same reason.
 * `email`/`phone`/`phone_verified` are absent on purpose — they come back only
 * from `get_member_contacts()` (§2.4).
 */
const SELECT_COLS = Object.freeze({
  league_members: 'league_id,id,user_id,role,legacy_player_id,display_name,initials,'
    + 'alma_mater,active,notify_prefs,preferences,linked_at,extra,created_at,updated_at',
});

/** cfbp key(s) fed by each table, so one select fills the right mirror keys. */
const KEYS_FOR_TABLE = (() => {
  const out = {};
  for (const [key, spec] of Object.entries(KEY_TABLES)) {
    if (key === 'SEASON_2025') continue;            // synthetic; history-2025.js, not a storage key
    for (const t of spec.tables) (out[t] = out[t] || []).push(key);
  }
  return out;
})();

// ══════════════════════════════════════════════════════════════════════════
// 5 · synchronous reads (§1.1 — a Map lookup and nothing else)
// ══════════════════════════════════════════════════════════════════════════

/**
 * The ONE read path. No `await`, no promise, no network, ever.
 *
 * The `cfbp_games` overlay is applied HERE rather than written into the mirror,
 * so the mirror keeps server truth and the next hydrate/Realtime event
 * replaces the overlay by construction instead of by a cleanup step
 * (§2.1 note, §7.1 item 3).
 */
export function get(key) {
  if (!_mirror.has(key) && !_overlay.has(key)) return null;
  if (key === 'cfbp_games' && _overlay.has('cfbp_games')) return _applyGameOverlay();
  return _mirror.has(key) ? _mirror.get(key) : null;
}

function _applyGameOverlay() {
  const base = _mirror.get('cfbp_games');
  if (!Array.isArray(base)) return base === undefined ? null : base;
  const ov = _overlay.get('cfbp_games');
  if (!ov || !ov.size) return base;
  return base.map((g) => (g && ov.has(g.gameId) ? { ...g, ...ov.get(g.gameId) } : g));
}

// ══════════════════════════════════════════════════════════════════════════
// 6 · synchronous writes (§2.1 routing, §3.3 layer 1, §5.2 loud-fail)
// ══════════════════════════════════════════════════════════════════════════

function _isAdmin() {
  const s = _safe('getSession');
  return !!(s && s.isAdmin);
}
function _myMemberId() {
  const s = _safe('getSession');
  return (s && (s.playerId || s.memberId)) || '';
}

function _routeFor(key) {
  const r = ROUTES[key];
  if (!r) return null;
  const verb = _isAdmin() ? r.comm : r.player;
  return { ...r, verb };
}

/**
 * `set(key, value, fields)` — mirror write + dirty mark + debounced push, all
 * synchronous (`backend.js:815-829` is the shape). Four things happen in a
 * fixed order, and the order is the design:
 *
 *   1. the DERIVED key is refused outright (§4.3 — `cfbp_week_progress` comes
 *      from an RPC and is never written by `save()`);
 *   2. the route is resolved for THIS CALLER'S ROLE and a `refuse` verdict
 *      throws BEFORE the mirror is touched — the user sees their change not
 *      happen, with a banner, rather than see it happen and silently vanish;
 *   3. the `cfbp_games` player OVERLAY is taken (no dirty mark, no push);
 *   4. otherwise the mirror takes the value and the dirty entry CAPTURES
 *      `{leagueId, epoch, switchSeq}` — §3.3 layer 1's token, compared at
 *      flush against the mirror's tag.
 */
export function set(key, value, fields) {
  if (key === DERIVED_PROGRESS_KEY) {
    throw new AdapterWriteRefusedError(
      `Refusing to write "${key}": it is DERIVED from week_submission_status() and has no row to write to.`,
      { code: 'derived_key', key });
  }
  const route = _routeFor(key);
  if (!route) {
    throw new AdapterWriteRefusedError(
      `Refusing to write "${key}": no Supabase route is declared for it.`,
      { code: 'no_route', key });
  }
  if (route.verb === 'refuse') {
    throw new AdapterWriteRefusedError(
      `Refusing to write "${key}": ${_isAdmin() ? 'the commissioner' : 'a player'} may not write it in Supabase data mode.`
      + ' Nothing was saved.',
      { code: 'route_refused', key, leagueId: _safe('getActiveLeagueId') });
  }
  if (route.verb === 'overlay') return _setOverlay(key, value, route);

  _mirror.set(key, value);
  const prev = _dirty.get(key);
  const declared = Array.isArray(fields) && fields.length ? new Set(fields) : null;
  // RG-24's rule, transplanted (`backend.js:816-825`): a whole-value write
  // already pending for a key is never narrowed back down to a field patch.
  let mergedFields = null;
  if (prev && prev.fields === null) mergedFields = null;
  else if (declared) mergedFields = new Set([...(prev && prev.fields ? prev.fields : []), ...declared]);
  else mergedFields = null;
  _dirty.set(key, {
    fields: mergedFields,
    leagueId: _safe('getActiveLeagueId'),
    epoch: _safe('getIdentityEpoch'),
    switchSeq: _switchSeq,
  });
  _schedulePush();
  return true;
}

/**
 * The player-device score overlay (§2.1 `cfbp_games`). `saveGame()` rewrites
 * the WHOLE array, so the decision is made per CHANGED FIELD against the
 * mirror: a change confined to `GAME_SCORE_FIELDS` is rendered and dropped; a
 * change to anything else is a refusal naming the field. "Six phones write the
 * same cells" (`ARCHITECTURE_PHASE_III.md:94`) ends one step early — no player
 * device writes a score to the shared store any more.
 */
function _setOverlay(key, value, route) {
  const base = Array.isArray(_mirror.get(key)) ? _mirror.get(key) : [];
  const byId = new Map(base.filter((g) => g && g.gameId != null).map((g) => [g.gameId, g]));
  const next = Array.isArray(value) ? value : [];
  // REVIEWER F8 — BUILD INTO A SCRATCH MAP, COMMIT ONLY AFTER THE CHECK PASSES.
  //
  // This used to mutate the LIVE overlay inside the loop and then throw if any field turned out to
  // be off the allow-list — so a write of `{homeScore: 21, spread: -10}` was refused with the words
  // "Nothing was saved" while the score half had already been applied and was already rendering.
  // The message has to be TRUE (AD-06: a refusal that partially succeeds is the silent-write class
  // wearing a loud error's clothes), and the only way to make it true is to decide first and commit
  // second. `staged` starts as a COPY, so a refusal leaves the previous overlay exactly as it was.
  const live = _overlay.get(key) instanceof Map ? _overlay.get(key) : new Map();
  const staged = new Map(live);
  const offending = [];
  for (const g of next) {
    if (!g || g.gameId == null) continue;
    const old = byId.get(g.gameId);
    if (!old) { offending.push(`${g.gameId}:<new game>`); continue; }
    const patch = {};
    for (const f of Object.keys(g)) {
      if (canonicalize(g[f]) === canonicalize(old[f])) continue;
      if (!GAME_SCORE_FIELDS.includes(f)) { offending.push(`${g.gameId}.${f}`); continue; }
      patch[f] = g[f];
    }
    if (Object.keys(patch).length) staged.set(g.gameId, { ...(staged.get(g.gameId) || {}), ...patch });
  }
  if (byId.size > next.filter((g) => g && g.gameId != null).length) offending.push('<game removed>');
  if (offending.length) {
    throw new AdapterWriteRefusedError(
      `Refusing to write "${key}": a player device may only render live scores, not persist game data (${offending.join(', ')}).`
      + ' Nothing was saved.',
      { code: 'overlay_only', key, leagueId: _safe('getActiveLeagueId') });
  }
  if (staged.size) _overlay.set(key, staged);
  return true;
}

function _schedulePush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => { flush().catch((e) => console.warn('[sb] flush failed', e && e.message)); }, PUSH_DEBOUNCE_MS);
  if (_pushTimer && typeof _pushTimer.unref === 'function') _pushTimer.unref();
}

// ══════════════════════════════════════════════════════════════════════════
// 7 · hydrate (§1.1, §2.1 READ column, §4.1 blind rule, §4.3 progress)
// ══════════════════════════════════════════════════════════════════════════

function _ctx(leagueId, extra = {}) {
  const members = _mirror.get('cfbp_players');
  const memberIds = new Set(Array.isArray(members) ? members.map((p) => p && p.playerId).filter(Boolean) : []);
  return { leagueId, memberIds, ...extra };
}

function _sizeOf(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v ? 1 : 0;
}

async function _select(client, table, leagueId) {
  const cols = SELECT_COLS[table] || '*';
  const res = await client.from(table).select(cols).eq('league_id', leagueId);
  if (res && res.error) {
    const err = new Error(`select ${table}: ${res.error.message || res.error.code || 'refused'}`);
    err.pgCode = res.error.code || '';
    // REVIEWER F4 / SECURITY F1 — CARRY THE HTTP STATUS. The SDK sets `code` to
    // '' for a body PostgREST did not author — an edge 403, a gateway 502, a
    // captive portal's 200-shaped interception — so a classifier that reads only
    // `code` sees nothing at all for exactly the responses that most need to be
    // read as "the server answered". `res.status` is on the response object;
    // `res.error.status` is where some SDK versions put it. Both, because a
    // missing status is what makes the difference invisible.
    err.httpStatus = Number(res.status ?? res.error.status ?? 0) || 0;
    err.table = table;
    throw err;
  }
  return (res && res.data) || [];
}

/**
 * League-scoped hydrate. `leagueId` comes from `getActiveLeagueId()` AT THE
 * CALL SITE and nowhere else (DI-184d, §3.1) — the header pill's text and every
 * select's `league_id` predicate come from the same call, which is what
 * `authtest [3]`'s read counter proves.
 *
 * `.eq('league_id', leagueId)` is on EVERY select. Composite keys mean a row
 * from another league cannot even be referenced (assessment §4 Principle 1),
 * and the filter is the second half of that: the client never HOLDS a row it
 * may not see, so the blind rule needs no client-side redaction (§4.1).
 */
export async function hydrate(leagueId, { epoch = null, reason = 'hydrate' } = {}) {
  const client = _safe('getClient');
  if (!client) {
    _lastError = 'Supabase client unavailable';
    return _fail(new Error(_lastError), leagueId, reason);
  }
  const op = {
    leagueId,
    epoch: epoch === null ? _safe('getIdentityEpoch') : epoch,
    switchSeq: _switchSeq,
  };
  if (_mirror.size === 0 && _state !== 'OFFLINE-READONLY') _setState('HYDRATING', reason);
  emit('syncing', { state: _state, reason });

  let rowsByTable;
  let contacts = [];
  try {
    const tables = READ_TABLES;
    const results = await Promise.all(tables.map((t) => _select(client, t, leagueId)));
    rowsByTable = {};
    tables.forEach((t, i) => { rowsByTable[t] = results[i]; });

    // §2.4 — the contact read. `get_member_contacts()` returns every row to a
    // commissioner or platform admin and exactly one row (his own) to a plain
    // member (`0007_contact_privacy.sql:152-174`). A THROW here is a hydrate
    // failure like any other; an EMPTY list is legitimate (a member with no
    // contact details of his own), and the projection distinguishes the two by
    // presence, never by value.
    const cRes = await client.rpc('get_member_contacts', { p_league: leagueId });
    if (cRes && cRes.error) {
      const e = new Error(`get_member_contacts: ${cRes.error.message || cRes.error.code}`);
      e.pgCode = cRes.error.code || '';
      throw e;
    }
    contacts = (cRes && cRes.data) || [];
  } catch (err) {
    return _fail(err, leagueId, reason);
  }

  // I6 (`auth.js:849`) — no asynchronous result may be applied under an epoch
  // other than the one it was issued under. Checked AFTER the awaits and
  // BEFORE anything is written, the same discipline `_identityEpochMoved()`
  // applies at `auth.js:404`.
  if (_opMoved(op)) {
    console.warn('[sb] a hydrate resolved for an identity/league this device has already left'
      + ' — DISCARDED (nothing written, nothing emitted, no state change)');
    return 0;
  }

  // ── RG-12 DEFENCE (b), transplanted from backend.js:706-727 ───────────────
  // If this device is holding substantive league data and the server returns
  // none of it, that is far more likely a partial read than a genuinely emptied
  // league. Preserve what we have and fail LOUD. Adopting the void is what
  // makes `ensureSeedData()` reseed a draft template into a real league.
  const mirrorHadLeague = ['cfbp_players', 'cfbp_weeks', 'cfbp_picks'].some((k) => _sizeOf(_mirror.get(k)) > 0);
  const remoteHasLeague = ['league_members', 'weeks', 'picks'].some((t) => (rowsByTable[t] || []).length > 0);
  if (mirrorHadLeague && !remoteHasLeague) {
    const rgErr = new Error(
      'Sync refused: the server returned no players, weeks or picks while this device still holds them. '
      + 'Your local data is preserved and nothing was overwritten. '
      + 'This is usually a partial read — retry in a moment.');
    // REVIEWER F1's third exclusion. This is NOT "the network did not answer" —
    // it answered, and the answer was wrong. Dropping to OFFLINE-READONLY here
    // would preserve the mirror correctly and then explain it with an amber
    // "You're offline" banner, on a device that is demonstrably online. That is
    // the BUG-A misdirection class exactly: a guard doing its job while
    // describing the wrong problem, which cost a session of hunting a data-loss
    // bug that was not happening. A partial read stays HELD and keeps its own
    // words.
    rgErr.rgPartialRead = true;
    return _fail(rgErr, leagueId, reason);
  }

  // Capture the local edits made while stale BEFORE the mirror is replaced —
  // but ONLY the ones whose captured token belongs to THIS hydrate's league,
  // epoch and switch. An entry captured under another league must never be
  // grafted onto this league's fresh value: that would be the cross-league
  // write §3.3 exists to prevent, arriving through the rebase instead of
  // through the push. Such an entry stays DIRTY and is refused loudly by
  // `flush()` (§3.3 layer 2), which is the difference between "not saved, and
  // told why" and "silently applied somewhere else".
  const localEdits = new Map();
  _dirty.forEach((entry, k) => {
    if (!_mirror.has(k)) return;
    if (entry.leagueId !== op.leagueId || entry.epoch !== op.epoch || entry.switchSeq !== op.switchSeq) return;
    localEdits.set(k, _mirror.get(k));
  });

  const fresh = new Map();
  const freshBaseRows = new Map();
  // league_members first: every other projection's ctx wants `memberIds`.
  const orderedTables = ['league_members', ...READ_TABLES.filter((t) => t !== 'league_members')];
  const nextMirror = new Map();
  for (const table of orderedTables) {
    for (const key of KEYS_FOR_TABLE[table] || []) {
      if (fresh.has(key)) continue;
      const ctx = _ctx(leagueId, { contacts });
      // The projection reads EVERY table its key names, so hand it the whole
      // rowsByTable rather than one table's slice — that is the shape
      // `fromRows` is written against (`supabase-projection.js:435-449`).
      const value = fromRows[key](rowsByTable, ctx);
      fresh.set(key, value);
      nextMirror.set(key, value);
      const rows = rowsByTable[table] || [];
      freshBaseRows.set(key, new Map(rows.filter((r) => r && r.id != null).map((r) => [r.id, r])));
      if (table === 'league_members') {
        // Make the freshly-projected members visible to the ctx of every later
        // key (comments/messages derive author_member_id from it).
        _mirror.set(key, value);
      }
    }
  }

  _mirror = nextMirror;
  _baseRows = freshBaseRows;
  _baseValues = new Map(fresh);
  // §2.4 rule 1's evidence: exactly the contacts THIS hydrate read, replaced
  // wholesale so a previous hydrate's entry can never authorize a write.
  _lastContacts = new Map((contacts || []).filter((c) => c && c.member_id != null).map((c) => [c.member_id, c]));
  _overlay.clear();            // the overlay is re-based on every hydrate, by construction

  // The rebase: user intent wins for the keys THIS DEVICE changed, the server
  // wins for everything else. RG-24's field graft is kept verbatim in spirit
  // (`backend.js:736-772`) — a field-scoped write re-applies only its own
  // fields onto the fresh value, so one device's settings write can no longer
  // revert another's.
  localEdits.forEach((v, k) => {
    const entry = _dirty.get(k);
    const freshValue = _mirror.get(k);
    if (entry && entry.fields instanceof Set && _isPlainObject(freshValue) && _isPlainObject(v)) {
      const merged = { ...freshValue };
      entry.fields.forEach((f) => { if (f in v) merged[f] = v[f]; else delete merged[f]; });
      _mirror.set(k, merged);
    } else {
      _mirror.set(k, v);
    }
  });

  // §4.3 — the derived progress key. Read for every week that is NOT live or
  // final, because those are the weeks on which a client cannot count rows it
  // cannot see. A failure here is NOT a hydrate failure: the counts are
  // informational and the league is already loaded.
  await _refreshWeekProgress(client, leagueId, op);

  _mirrorTag = { leagueId, epoch: op.epoch, switchSeq: op.switchSeq, at: new Date().toISOString() };
  _hydrateSeq++;
  _lastSyncAt = _mirrorTag.at;
  _lastError = null;
  _setState('ACTIVE', reason);
  if (!_dirty.size) _persistSnapshot();
  _runFirstBootWipe();
  if (_dirty.size) _schedulePush();
  return _mirror.size;
}

/**
 * §4.3 — `week_submission_status(p_league, p_week)` folded into the DERIVED,
 * read-only mirror key `cfbp_week_progress`:
 *
 *   { [weekId]: { [memberId]: { pickCount, hasTiebreaker, hasExtraPoint, lastUpdated } } }
 *
 * It is never written by `save()` (`set()` refuses it above) and never
 * persisted to the device snapshot: it is an answer about the server's rows,
 * and a stale copy of it would tell a player "nobody else has submitted" —
 * which is the exact thing §4.3 exists to stop.
 */
async function _refreshWeekProgress(client, leagueId, op) {
  const weeks = _mirror.get('cfbp_weeks');
  if (!Array.isArray(weeks) || !weeks.length) { _mirror.set(DERIVED_PROGRESS_KEY, { at: new Date().toISOString(), weeks: {} }); return; }
  const wanted = weeks
    .filter((w) => w && w.weekId && w.status !== 'live' && w.status !== 'final')
    .map((w) => w.weekId);
  const out = {};
  for (const weekId of wanted) {
    try {
      const res = await client.rpc('week_submission_status', { p_league: leagueId, p_week: weekId });
      if (op && _opMoved(op)) return;                 // I6 again — one await, one check
      if (res && res.error) { console.warn(`[sb] week_submission_status(${weekId}) refused`, res.error.code || res.error.message); continue; }
      const byMember = {};
      for (const r of (res && res.data) || []) {
        if (!r || r.member_id == null) continue;
        byMember[r.member_id] = {
          pickCount: Number(r.pick_count) || 0,
          hasTiebreaker: !!r.has_tiebreaker,
          hasExtraPoint: !!r.has_extra_point,
          lastUpdated: r.last_updated || null,
        };
      }
      out[weekId] = byMember;
    } catch (e) {
      console.warn(`[sb] week_submission_status(${weekId}) threw`, e && e.message);
    }
  }
  // DI-T4.11 GROUNDWORK — the value is `{ at, weeks }`, not a bare map.
  //
  // The counts are an ANSWER ABOUT A MOMENT, and the surfaces that render them ("3 of 6 submitted")
  // have no other way to tell a fresh answer from a stale one. Part B renders an ABSENT key as
  // UNKNOWN rather than as zero — which is the same rule §4.3 states about rows ("a row the client
  // cannot see must not be rendered as absent"), applied to the count itself. `at` is what lets a
  // later build say "as of 4 minutes ago" instead of implying "now".
  //
  // The key is DERIVED and never persisted (see `_persistSnapshot`), so while ACTIVE-STALE there is
  // no entry at all and `get()` answers `null` — not `{}`, which would read as "six members, none
  // submitted". That distinction is the whole point of the shape.
  _mirror.set(DERIVED_PROGRESS_KEY, { at: new Date().toISOString(), weeks: out });
}

function _isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function _opMoved(op) {
  if (!op) return true;
  if (op.switchSeq !== _switchSeq) return true;
  const epochNow = _safe('getIdentityEpoch');
  if (op.epoch !== null && epochNow !== null && op.epoch !== epochNow) return true;
  const active = _safe('getActiveLeagueId');
  return !!(active && op.leagueId && active !== op.leagueId);
}

/**
 * §5.1 — a hydrate failure NEVER becomes local mode. The three
 * `setBackendMode('local'); initStorage()` arms at `app.js:954`, `:957`, `:965`
 * are the Sheets path and are not reachable in this mode; what happens here is
 * a hold, or the offline read-only state when — and only when — §5.3's four
 * conditions hold.
 *
 * A refusal on a READ additionally warrants a membership refresh (a role may
 * have changed under us), which Part B wires off the `'error'` detail's
 * `membershipSuspect` flag rather than by importing auth.js here.
 */
/**
 * ══ SECURITY F1 (delta audit #15, 2026-09-18) ══════════════════════════════
 *
 * THE RULE, on one line so it cannot be half-read:
 *     allow-list of network failures; default HELD.
 *
 * WITH ONE STATED EXCEPTION, because the line above was not the whole truth
 * (reviewer F-C). An empty error, a malformed one or a thrown string normally
 * falls to the closed default — but if it carries NO Postgres code and NO HTTP
 * status AND the browser itself reports `navigator.onLine === false`, it is
 * classified as a network failure and SERVES. That is deliberate: a failure
 * with nothing in it, on a device the OS says has no network, is an outage by
 * every available signal. It is also the weakest inference in this function,
 * which is why it is fenced by `!answered` and why it is written down here
 * rather than left for a reader to find in the fourth allow-list entry.
 *
 * THE DEFECT THIS REPLACES, and it is the shape of every fail-open bug in this
 * codebase. The first version asked `serverAnswered = privilege || sessionSuspect
 * || partialRead` and treated EVERYTHING ELSE as "the network did not answer" —
 * a DENY-list of three known shapes with an open default. The audit walked
 * straight through it: `{status:403, message:'Forbidden'}` (an edge/proxy
 * refusal), `{}` (an error object with nothing in it), `{code:'PGRST103'}` (a
 * PostgREST range error) — none of the three matched, so all three reached
 * OFFLINE-READONLY and PAINTED A LEAGUE from the device snapshot. A 403 is the
 * server saying no. An empty error is us not knowing what happened. Neither is
 * a reason to serve six people's picks.
 *
 * SO IT IS INVERTED. OFFLINE-READONLY is reachable for a GENUINE NETWORK
 * FAILURE and nothing else; every other outcome — any HTTP status, any
 * PostgREST or Postgres code, an empty or malformed error, a thrown string —
 * falls to HELD. Adding a new server behaviour cannot open the offline path by
 * default; it can only close it, which is the direction that costs a re-download
 * rather than a leak.
 *
 * WHAT COUNTS AS "THE NETWORK DID NOT ANSWER" — the whole list, and each entry
 * is a case where no HTTP response exists at all:
 *   • a fetch TypeError — 'Failed to fetch' (Chrome), 'NetworkError when
 *     attempting to fetch resource' (Firefox), 'Load failed' (Safari). Three
 *     browsers, three strings, one event.
 *   • an AbortError or a timeout — the request was given up on.
 *   • the Postgres CONNECTION classes: 08xxx (connection exception) and
 *     57P01/02/03 (admin shutdown, crash shutdown, cannot connect now). These
 *     arrive as a code because PostgREST got far enough to report one, but they
 *     describe a connection that died rather than a request that was judged.
 *   • `navigator.onLine === false` — the browser itself says there is no
 *     network. Checked LAST, and only after the named server answers below,
 *     so a cached 42501 cannot be re-labelled offline by a flapping radio.
 *
 * The three NAMED server answers keep their own branches inside the closed
 * default, because each carries a different reason and a different log line —
 * they are not merely "not network", they are three specific things that went
 * wrong and the player deserves to be told which.
 */
const CONNECTION_SQLSTATES = Object.freeze([
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',   // connection exception
  '57P01', '57P02', '57P03',                                       // admin/crash shutdown, cannot connect now
]);
const NETWORK_MESSAGE_RE = /failed to fetch|networkerror|network error|load failed|the internet connection appears to be offline|timed? ?out/i;

/** @returns {'privilege'|'session'|'http-status'|'partial-read'|'network'|'unclassified'} */
function _classifyHydrateFailure(err) {
  // ── THE NAMED SERVER ANSWERS, FIRST ──────────────────────────────────────
  // Checked before any network signal, deliberately: if the server told us
  // something, that is what happened, and a radio that flapped afterwards does
  // not change it.
  if (err && err.rgPartialRead === true) return 'partial-read';
  const pgCode = String((err && err.pgCode) || '');
  if (pgCode === '42501') return 'privilege';
  if (pgCode === 'PGRST301' || pgCode === '401') return 'session';
  const httpStatus = Number((err && err.httpStatus) || (err && err.status) || 0) || 0;

  // ── REVIEWER F-A (pass 4) — A CONNECTION SQLSTATE *ARRIVES WITH* A 503 ────
  //
  // THE DEFECT THIS ORDERING FIXES, and it was introduced by the previous
  // pass's own fix. `httpStatus >= 100` used to be tested BEFORE the connection
  // SQLSTATEs — which was harmless only for as long as `_select()` did not
  // carry a status. Once it did (reviewer F4), a Supabase POOLER RESTART — the
  // single most common real outage on the free tier, and the one UN-187 is
  // actually about — arrives as `08006` WITH HTTP 503, matched `http-status`
  // first, and went HELD. A blank gate for the exact event the offline
  // read-only state was designed for.
  //
  // So the connection classes are checked FIRST, but NOT unconditionally: the
  // status still has to be CONSISTENT with a connection failure. 503 (or no
  // status at all, which is what a thrown fetch produces) is what PostgREST and
  // its pooler return when the database is unreachable. Any OTHER status
  // carrying a connection code is incoherent — a 403 that claims `08006` is
  // either an edge inventing a body or something spoofing one — and an
  // incoherent answer is still an ANSWER, so it holds.
  if (CONNECTION_SQLSTATES.includes(pgCode)) {
    if (httpStatus === 0 || httpStatus === 503) return 'network';
    return 'http-status';        // a connection code under any other status: incoherent ⇒ answer ⇒ HELD
  }

  // REVIEWER F4 — ANY OTHER HTTP STATUS IS AN ANSWER. A response existed;
  // something read the request and replied. 401/403 are the ones that matter
  // most (an edge or a gateway refusing on the server's behalf, with `code`
  // empty so no PostgREST rule matches), but the reasoning holds for every one
  // of them: a 502 is a proxy saying the backend is unreachable, which is a
  // FACT ABOUT THE SERVER and not about this handset's radio. None may serve.
  if (httpStatus >= 100) return httpStatus === 401 || httpStatus === 403 ? 'session' : 'http-status';

  // ── THE REST OF THE NETWORK ALLOW-LIST ───────────────────────────────────
  const name = String((err && err.name) || '');
  const message = String((err && err.message) || '');
  if (name === 'AbortError' || name === 'TimeoutError') return 'network';
  if (name === 'TypeError' && NETWORK_MESSAGE_RE.test(message)) return 'network';
  if (!pgCode && NETWORK_MESSAGE_RE.test(message)) return 'network';
  // `navigator.onLine` is the WEAKEST signal here, so it decides LAST and only
  // when nothing else did. A failure carrying a Postgres code or an HTTP status
  // has already told us a response existed; a radio that dropped afterwards
  // does not un-answer it. (It is also the signal most likely to be wrong —
  // `onLine` is true on a captive-portal wifi that resolves nothing.)
  const answered = !!pgCode || httpStatus >= 100;
  try {
    if (!answered && typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return 'network';
  } catch { /* no navigator: not a browser, and not a reason to serve */ }

  // ── THE CLOSED DEFAULT ───────────────────────────────────────────────────
  // Any HTTP status, any other PostgREST/PG code, an empty error, a malformed
  // one, a thrown string. We do not know what happened, and "we do not know" is
  // never permission to paint a league.
  return 'unclassified';
}
/** Test seam — the classifier is the whole of security F1 and has to be
 *  drivable without constructing a hydrate around every shape. */
export function _classifyHydrateFailureForTest(err) { return _classifyHydrateFailure(err); }
export function _connectionSqlstatesForTest() { return [...CONNECTION_SQLSTATES]; }

function _fail(err, leagueId, reason) {
  _lastError = String((err && err.message) || err);
  const pgCode = String((err && err.pgCode) || '');
  const kind = _classifyHydrateFailure(err);
  const privilege = kind === 'privilege';
  const sessionSuspect = kind === 'session';

  // §5.3 / D-1 (a) / reviewer F1 — a LIVE page that loses signal goes on serving
  // the league it already had, read-only, behind the amber banner. The state is
  // reachable from ACTIVE as well as ACTIVE-STALE (a page that has already
  // hydrated is the state everybody is actually in), and ONLY for `network`.
  const serveable = kind === 'network'
    && (_state === 'ACTIVE-STALE' || _state === 'ACTIVE')
    && _offlineConditionsHold(leagueId);

  if (serveable) {
    // DI-T4.11 — THE DERIVED COUNTS DO NOT SURVIVE THE TRANSITION.
    //
    // ACTIVE-STALE reaches this state with no progress key (it was never
    // persisted to the snapshot, deliberately). ACTIVE reaches it holding a
    // LIVE one — and OFFLINE-READONLY is a SERVING state, so `getWeekProgress()`
    // would hand that map straight to the dashboard and five players would be
    // told "3 of 6 submitted" as of a moment that has passed, with no way to
    // tell. Absent is the only honest answer once we have stopped asking, so
    // the key is deleted rather than left to age.
    if (_mirror.has(DERIVED_PROGRESS_KEY)) {
      _mirror.delete(DERIVED_PROGRESS_KEY);
      console.info('[sb] going offline read-only: the week_submission_status() counts are DROPPED,'
        + ' because a serving state must not hand out an answer it has stopped re-asking.');
    }
    _setState('OFFLINE-READONLY', `${reason}: ${_lastError}`);
  } else {
    // THE CLOSED DEFAULT. Each named answer says which thing went wrong, because
    // "your league could not load" is four different problems with four
    // different fixes and only one of them is the player's to make.
    if (privilege) {
      console.warn('[sb] the server REFUSED the read (42501) — this account’s rights in this league may have changed.'
        + ' Holding rather than serving a snapshot taken under the old answer (§5.2).');
    } else if (sessionSuspect) {
      console.warn('[sb] the server REJECTED the token (PGRST301/401) — holding. A8 forbids painting a league for an'
        + ' identity the server has refused, and §5.3’s hasValidSupabaseSession() is a LOCAL check a rejected token still passes.');
    } else if (kind === 'partial-read') {
      console.warn('[sb] RG-12 (b): a 200 that carried no league — holding with the "Sync refused" wording rather than'
        + ' explaining an online device with an "offline" banner (the BUG-A misdirection class).');
    } else if (kind === 'http-status') {
      console.warn(`[sb] the server ANSWERED with HTTP ${Number((err && err.httpStatus) || (err && err.status) || 0)} — holding.`
        + ' A response existed, so something read this request and replied; that is never "the network did not answer".');
    } else {
      console.warn(`[sb] the hydrate failed in a way this build does not classify as a network outage (code ${JSON.stringify(pgCode) || 'none'},`
        + ` name ${JSON.stringify(String((err && err.name) || ''))}) — HOLDING. Serving a snapshot is reserved for a`
        + ' proven network failure; anything else might be the server saying no.');
    }
    _setState('HELD', `${reason}: ${_lastError}`);
  }
  emit('error', {
    state: _state, error: _lastError, reason,
    // PGRST301/401 is NOT classified here (§5.2): it belongs to auth.js's ONE
    // classifier (`isSessionExpiredError`, `auth.js:1362`, verify-before-destroy
    // per DI-180p). The adapter never clears a token.
    sessionSuspect,
    membershipSuspect: privilege,
    banner: 'Couldn’t load your league. Nothing has changed — retry in a moment.',
  });
  return 0;
}

// ══════════════════════════════════════════════════════════════════════════
// 8 · the flush PLANNER (§2.2) and the composite writes (§2.3)
// ══════════════════════════════════════════════════════════════════════════

/**
 * A ROW DIFF, computed through the projection.
 *
 * `save(k, v)` hands the adapter whole arrays and whole blobs, because that is
 * what every accessor writes (`saveAllPicks` `storage.js:1604-1612`,
 * `savePlayer` `:865-871`, `saveGame` `:938-944`, `saveObligation`
 * `:1649-1654`). So the planner projects the NEW value with the same `toRows`
 * the importer uses and compares it, BY ROW ID, against the rows the server
 * last served (`_baseRows`).
 *
 * That the base is the SERVER'S ROWS — not a re-projection of the old value —
 * is what makes two §2.2 properties true rather than hoped-for:
 *   • a row the caller could not SEE is in neither `_base` nor the mirror, so
 *     it can never appear as a delete (§4.1, the blind rule coexisting with
 *     whole-array writes);
 *   • a patch carries exactly the columns that actually differ from what the
 *     server holds, so an unchanged field is never re-sent and RG-39's
 *     field-blanking class cannot arise from a whole-array write.
 */
function _diffRows(key, route, value, leagueId) {
  const table = route.table;
  const projected = toRows[key](stripCredentials(key, value), _ctx(leagueId));
  const newRows = (projected && projected[table]) || [];
  const base = _baseRows.get(key) || new Map();
  const volatile = new Set(VOLATILE_COLS[table] || []);
  const inserts = [];
  const patches = [];
  const seen = new Set();

  for (const row of newRows) {
    if (!row || row.id == null) continue;
    seen.add(row.id);
    const old = base.get(row.id);
    if (!old) { inserts.push(row); continue; }
    const changed = {};
    for (const col of Object.keys(row)) {
      if (col === 'league_id' || col === 'id' || volatile.has(col)) continue;
      if (canonicalize(row[col]) !== canonicalize(old[col])) changed[col] = row[col];
    }
    if (route.patchCols) {
      // scribe_learnings / scribe_canon: `scribe_guard` (0002:618-645) refuses a
      // change to id/ord/run_id/created_at and only the status column may move,
      // so the planner narrows the patch to it rather than letting the guard
      // raise 42501 on a column the client never meant to send. Q8: the patch is
      // keyed by the SYNTHESIZED ROW ID, never by array index — the approve flip
      // at `app.js:12023-12027` rewrites `all[idx]` in place, so `ord` (and
      // therefore the id) is stable across it. A reorder of that array WOULD move
      // the ids, which is why this is id-keyed and asserted (adaptertest A16).
      for (const col of Object.keys(changed)) if (!route.patchCols.includes(col)) delete changed[col];
    }
    if (Object.keys(changed).length) patches.push({ id: row.id, changed });
  }

  const deletes = [];
  for (const id of base.keys()) {
    if (seen.has(id)) continue;
    if (route.noDelete || route.insertOnly) {
      console.warn(`[sb] ${key}: row ${id} vanished from a key that has no delete path —`
        + ' left to the server (cascade) and to the next hydrate to reconcile. Nothing was deleted.');
      continue;
    }
    deletes.push({ id, row: base.get(id) });
  }
  return { inserts, patches, deletes };
}

/**
 * §2.2's second rule. A delete is emitted ONLY for a row the caller may
 * delete; every other vanished row is "the server will cascade or the next
 * hydrate will reconcile", with a console line naming it — never a silent drop
 * of a row the caller DID own.
 *
 * The concrete case: `deletePicksForGame()` (`storage.js:952-957`) filters
 * every player's picks for that game out of the array. Five of those rows are
 * not mine; sending their deletes would be refused by `picks_delete`
 * (`0002:260-261`), and the `games` delete cascades them server-side anyway
 * (`0001:228`).
 */
function _mayOperateOnRow(key, route, row) {
  if (!route.ownRowsOnly) return true;
  if (_isAdmin() && key !== 'cfbp_picks' && key !== 'cfbp_tiebreaker_guesses'
    && key !== 'cfbp_extra_point_guesses' && key !== 'cfbp_reactions') return true;
  const me = _myMemberId();
  if (!me) return false;
  if (key === 'cfbp_players') return row && row.id === me;
  if (key === 'cfbp_obligations') {
    return !!row && (row.payer_member_id === me || row.recipient_member_id === me || _isAdmin());
  }
  if (key === 'cfbp_feedback') return !!row && (row.member_id === me || _isAdmin());
  // SECURITY F-6 — `comments` is keyed on `author_member_id`, NOT `member_id`.
  //
  // Without this branch the fallthrough below asked `row.member_id === me` on a table that has no
  // `member_id` column: `undefined === 'p2'` is false, so EVERY comment operation looked like
  // somebody else's and was dropped from the plan — including the caller's own delete of his own
  // comment, and including the commissioner's moderation delete. The failure direction was safe
  // (nothing was written) and therefore invisible: the delete simply never happened, with a console
  // line blaming ownership. 0008's `comments_delete` is `own row OR commissioner`, and this is that
  // rule stated where the planner can act on it.
  if (key === 'cfbp_comments') return !!row && (row.author_member_id === me || _isAdmin());
  return !!row && row.member_id === me;
}

/** The three status legs of `cfbp_weeks` and the RPC each one requires
 *  (`0003:282-307` transition_week's allow-list, `:323` lock_week, `:376`
 *  finalize_week). A diff the planner cannot map is refused client-side with
 *  the SERVER'S OWN error name, so the banner names the rule and not a 42501
 *  (§2.3's last paragraph). */
const TRANSITION_ALLOWED = frozenList([
  'draft>open', 'open>draft', 'locked>open', 'locked>live', 'live>locked', 'final>live',
]);

function _planWeekStatus(fromStatus, toStatus, weekId, leagueId) {
  if (toStatus === 'locked') {
    if (fromStatus !== 'open') {
      throw new AdapterWriteRefusedError(
        `Refusing to lock "${weekId}": lock_week requires the week to be open (it is ${fromStatus}). Nothing was saved.`,
        { code: 'bad_transition', key: 'cfbp_weeks', rowId: weekId, leagueId, serverMessage: 'bad_transition' });
    }
    return { kind: 'rpc', name: 'lock_week', args: { p_league: leagueId, p_week: weekId }, key: 'cfbp_weeks', rowId: weekId };
  }
  if (toStatus === 'final') {
    if (fromStatus !== 'live') {
      throw new AdapterWriteRefusedError(
        `Refusing to finalize "${weekId}": finalize_week requires the week to be live (it is ${fromStatus}). Nothing was saved.`,
        { code: 'bad_transition', key: 'cfbp_weeks', rowId: weekId, leagueId, serverMessage: 'bad_transition' });
    }
    return { kind: 'finalize', weekId, key: 'cfbp_weeks', rowId: weekId };
  }
  if (!TRANSITION_ALLOWED.includes(`${fromStatus}>${toStatus}`)) {
    throw new AdapterWriteRefusedError(
      `Refusing to move "${weekId}" from ${fromStatus} to ${toStatus}: the server allows no such transition. Nothing was saved.`,
      { code: 'bad_transition', key: 'cfbp_weeks', rowId: weekId, leagueId, serverMessage: 'bad_transition' });
  }
  return {
    kind: 'rpc', name: 'transition_week',
    args: { p_league: leagueId, p_week: weekId, p_to: toStatus },
    key: 'cfbp_weeks', rowId: weekId,
  };
}

/**
 * §2.4 — THE CONTACT WRITE RULE (DI-T7.6's write side, entry condition #7).
 *
 * The read side is built: a plain member's `cfbp_players` projection carries no
 * `email`/`phone`/`phoneVerified` for anyone else, and `extra.__absent` keeps
 * the round trip exact (`supabase-projection.js:913-1020`). The projection's own
 * comment (`:991-995`) leaves the write side to this document. The rule, in
 * three parts, all applied here:
 *
 *   1. NEVER EMIT A CONTACT COLUMN NOT READ THIS HYDRATE. A contact column
 *      survives into a patch only when the adapter holds a
 *      `get_member_contacts()` entry for that member from the CURRENT hydrate
 *      and the value genuinely differs from it. A member who cannot read the
 *      column therefore cannot blank it — and a redaction that reads as data
 *      is worse than no redaction: it is silent, total, and the Sheet backup
 *      would agree with it.
 *   2. STRIP CONTACT NAMES FROM `__absent`. A plain member's projection marks
 *      all three absent; writing that marker would let a LATER commissioner
 *      read hide real values (reviewer F-10(b)'s write-side half).
 *   3. UNINFORMATIVE IS NOT A VALUE. `''` / `false` produced by
 *      `createPlayer()`'s defaults is never written over a column — the same
 *      `carriesInformation` test the projection applies on the read side
 *      (`:996-1002`), applied at the write.
 */
function _contactsByMember() {
  return _lastContacts instanceof Map ? _lastContacts : new Map();
}

function _carriesInformation(entry, column) {
  if (!entry || !Object.prototype.hasOwnProperty.call(entry, column)) return false;
  const v = entry[column];
  if (v === null || v === undefined || v === '') return false;
  if (column === 'phone_verified') return v === true || _carriesInformation(entry, 'phone');
  return true;
}

const CONTACT_COLUMNS = ['email', 'phone', 'phone_verified'];
const CONTACT_LEGACY = ['email', 'phone', 'phoneVerified'];

function _applyContactWriteRule(rowId, changed) {
  const entry = _contactsByMember().get(rowId);
  for (const col of CONTACT_COLUMNS) {
    if (!(col in changed)) continue;
    const readThisHydrate = !!entry && Object.prototype.hasOwnProperty.call(entry, col);
    const informative = _carriesInformation({ [col]: changed[col], phone: changed.phone }, col);
    if (!readThisHydrate || !informative) {
      delete changed[col];
      continue;
    }
    if (canonicalize(changed[col]) === canonicalize(entry[col])) delete changed[col];
  }
  if (changed.extra && Array.isArray(changed.extra.__absent)) {
    const pruned = changed.extra.__absent.filter((f) => !CONTACT_LEGACY.includes(f));
    if (pruned.length !== changed.extra.__absent.length) {
      changed.extra = { ...changed.extra, __absent: pruned };
      if (!pruned.length) { const e = { ...changed.extra }; delete e.__absent; changed.extra = e; }
    }
  }
  return changed;
}

/**
 * Build the whole plan, then execute it. Split in two so `adaptertest` can read
 * the plan without a network, and so a client-side refusal happens before ANY
 * operation is sent — a half-executed composite is worse than a refused one.
 */
export function planFlush() {
  // SECURITY O-5 — THE GUARD IS STRUCTURAL, NOT CALLER-ORDERED.
  //
  // `flush()` checks the state before calling this, which was fine as long as `flush()` was the
  // only caller. It is exported (adaptertest reads the plan without a network, and Part B may
  // reasonably want to show a pending-writes panel), and an exported planner that builds a plan
  // from a `HELD` or `SWITCHING` mirror is a plan built against a league this device is no longer
  // acting in. Asking here as well costs one comparison and removes the dependency on call order —
  // which is the same reasoning §3.3 gives for having three layers instead of one.
  if (_state !== 'ACTIVE') return { plan: [], refusals: [], stale: [], leagueId: null, heldBy: _state };
  const leagueId = _mirrorTag ? _mirrorTag.leagueId : _safe('getActiveLeagueId');
  const plan = [];
  const refusals = [];
  const stale = [];

  for (const [key, entry] of _dirty) {
    // ── §3.3 LAYER 2 — write-during-switch ────────────────────────────────
    // The captured token is compared to the MIRROR'S tag. A mismatch is
    // REFUSED, never redirected and never re-queued under the new league: a
    // pick made in A is not a pick in B (UN-184).
    if (!_mirrorTag
      || entry.leagueId !== _mirrorTag.leagueId
      || entry.epoch !== _mirrorTag.epoch
      || entry.switchSeq !== _mirrorTag.switchSeq) {
      stale.push({ key, from: entry.leagueId, to: _mirrorTag ? _mirrorTag.leagueId : null });
      continue;
    }
    const route = _routeFor(key);
    if (!route || route.verb === 'refuse') {
      refusals.push(new AdapterWriteRefusedError(
        `Refusing to save "${key}": no write path exists for this caller. Nothing was saved.`,
        { code: 'route_refused', key, leagueId }));
      continue;
    }
    if (route.verb === 'overlay') continue;            // never pushed, by construction
    if (route.verb === 'kv') {
      const value = _mirror.get(key);
      const mode = route.kvMode === 'replace' || !entry.fields ? (route.kvMode || 'replace') : 'merge';
      const payload = entry.fields && mode === 'merge'
        ? _kvFieldPatch(value, entry.fields, _baseValues.get(key))
        : stripCredentials(key, value);
      plan.push({
        kind: 'rpc', name: 'patch_kv', key,
        args: { p_league: leagueId, p_key: route.kvKey, p_value: payload, p_mode: mode },
      });
      continue;
    }
    if (route.verb === 'rpc-finalize') {
      // §2.1 `cfbp_results` — `finalize_week` is the ONLY writer. A
      // `saveAllWeeklyResults()` outside a finalize (the tiebreaker re-persist
      // at `app.js:9299`) is refused, and named as a residual in DI §11.3: the
      // commissioner's recourse is the existing final->live + re-finalize UI.
      if (!_dirty.has('cfbp_weeks') || !_pendingFinalizeWeek(leagueId)) {
        refusals.push(new AdapterWriteRefusedError(
          'Refusing to save weekly results outside a finalize: `results` is written only by finalize_week(). '
          + 'Nothing was saved — move the week back to live and finalize it again.',
          { code: 'results_outside_finalize', key, leagueId, serverMessage: 'no insert grant on results' }));
      }
      continue;
    }
    if (route.verb === 'rows') {
      try { _planRowKey(plan, key, route, leagueId); }
      catch (e) { refusals.push(e); }
      continue;
    }
    refusals.push(new AdapterWriteRefusedError(
      `Refusing to save "${key}": unknown verb ${route.verb}.`, { code: 'no_route', key, leagueId }));
  }

  // §2.3 — the composite ordering: the `games` patches (atsWinner) go BEFORE
  // the finalize RPC, and the finalize RPC carries that week's results and its
  // NEW obligations, so four keys dirtied in one synchronous tick land as one
  // batch the server can validate in one transaction.
  plan.sort((a, b) => _planOrder(a) - _planOrder(b));
  return { plan, refusals, stale, leagueId };
}

function _planOrder(op) {
  if (op.kind === 'rows' && op.key === 'cfbp_games') return 0;
  if (op.kind === 'finalize') return 2;
  if (op.kind === 'rpc' && (op.name === 'lock_week' || op.name === 'transition_week')) return 1;
  return 3;
}

/**
 * SECURITY O-1 — WHY THE LITERAL `'cfbp_settings'` IS CORRECT HERE AND NOT A COPY-PASTE.
 *
 * This helper is reached only from the `kv` branch of `planFlush()`, and `stripCredentials` is
 * keyed by the CFBP KEY, not by the kv key — `CREDENTIAL_FIELDS` (supabase-projection.js:261-264)
 * has entries for exactly `cfbp_settings` (adminPasswordHash, sitePin, storageMode) and
 * `cfbp_players`. For every OTHER kv key it is an identity function, so passing the settings key
 * unconditionally is not a bug waiting to be found: it strips the three credentials when the value
 * is settings and does nothing at all when it is nicknames, lock_overrides, active_week,
 * rejected_suggestions, fetch_proof or feedback_excluded_ids.
 *
 * Deliberately NOT `stripCredentials(key, …)` with the caller's key: that would read as more
 * careful and be strictly weaker, because a FIELD-SCOPED settings write arrives here with a
 * `$unset` array and a handful of fields, and the one thing that must never travel is a credential
 * a caller named in `fields`. Naming the settings key outright is what guarantees the strip runs on
 * the one value that has something to strip. (The whole-value branch in `planFlush()` passes the
 * real key, because there the value IS the whole key's value.)
 */
function _kvFieldPatch(value, fields, baseValue) {
  if (!_isPlainObject(value)) return stripCredentials('cfbp_settings', value);
  const patch = {};
  const unset = [];
  fields.forEach((f) => {
    if (f in value) patch[f] = value[f];
    else if (_isPlainObject(baseValue) && f in baseValue) unset.push(f);
  });
  if (unset.length) patch.$unset = unset;              // patch_kv's own `$unset` (0003:462-466)
  return stripCredentials('cfbp_settings', patch);
}

function _pendingFinalizeWeek(leagueId) {
  const weeks = _mirror.get('cfbp_weeks');
  const base = _baseRows.get('cfbp_weeks') || new Map();
  if (!Array.isArray(weeks)) return null;
  for (const w of weeks) {
    if (!w || !w.weekId) continue;
    const old = base.get(w.weekId);
    if (old && old.status !== w.status && w.status === 'final') return w.weekId;
  }
  return null;
}

function _planRowKey(plan, key, route, leagueId) {
  const value = _mirror.get(key);
  const { inserts, patches, deletes } = _diffRows(key, route, value, leagueId);

  if (key === 'cfbp_weeks') {
    // A status diff MUST be recognised: `weeks_status_guard` (`0002:452-491`)
    // refuses a direct status PATCH with 42501, so sending it as a PATCH is a
    // red-banner defect rather than a fallback (§2.1's note, A5's mutant).
    const base = _baseRows.get(key) || new Map();
    for (const p of patches) {
      if (!('status' in p.changed)) continue;
      const from = (base.get(p.id) || {}).status;
      plan.push(_planWeekStatus(from, p.changed.status, p.id, leagueId));
      delete p.changed.status;
      // `locked_at` / `locked_alma_maters` / `finalized_at` / `revealed_at` are
      // SERVER-SET inside those RPCs (`0003:354-356`, `:435-437`, `:300-303`).
      // The client's own values are DISCARDED from the plan and re-read from
      // the RPC's return and the next hydrate.
      for (const col of ['locked_at', 'locked_alma_maters', 'finalized_at', 'revealed_at']) delete p.changed[col];
    }
  }

  if (key === 'cfbp_players') for (const p of patches) _applyContactWriteRule(p.id, p.changed);

  const usable = (rows, what) => rows.filter((r) => {
    const row = what === 'delete' ? r.row : r;
    if (_mayOperateOnRow(key, route, row)) return true;
    console.warn(`[sb] ${key}: ${what} of row ${r.id} is not this caller's to make`
      + ' — DROPPED from the plan (the server would refuse it, and the next hydrate reconciles the mirror).');
    return false;
  });

  const ins = usable(inserts, 'insert');
  if (ins.length) plan.push({ kind: 'rows', op: 'insert', key, table: route.table, rows: ins });

  for (const p of patches) {
    if (!Object.keys(p.changed).length) continue;
    const row = (_baseRows.get(key) || new Map()).get(p.id);
    if (!_mayOperateOnRow(key, route, row)) {
      console.warn(`[sb] ${key}: patch of row ${p.id} is not this caller's to make — DROPPED from the plan.`);
      continue;
    }
    if (route.insertOnly) {
      console.warn(`[sb] ${key} is append-only: a field change on row ${p.id} is DROPPED`
        + ' (every mutable property of a game request is derived at read time — storage.js foldGameRequests()).');
      continue;
    }
    plan.push({ kind: 'rows', op: 'patch', key, table: route.table, rowId: p.id, changed: p.changed });
  }

  for (const d of usable(deletes, 'delete')) {
    plan.push({ kind: 'rows', op: 'delete', key, table: route.table, rowId: d.id });
  }
}

/**
 * Execute the plan. Every refusal is TYPED, SHOWN and NOT RETRIED BLINDLY
 * (§5.2): the key goes into `_refusedKeys` stamped with the hydrate sequence it
 * was refused under, and `flush()` retries it only once a hydrate has landed
 * SINCE — a refusal is an answer about THIS request, and retrying it three
 * times only delays the honest error (`backend.js:602-604` gives the same
 * reasoning for a 4xx).
 */
export async function flush() {
  if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
  if (!_dirty.size) return { pushed: 0 };
  // Held writes stay held while stale (`backend.js:930`): a plan built on a
  // stale base could clobber fresher server rows. The dirty entries stay
  // queued and are re-diffed against the FRESH base when hydrate lands.
  if (_state === 'ACTIVE-STALE') return { pushed: 0, held: true };
  if (_state !== 'ACTIVE') return { pushed: 0, held: true, state: _state };

  const client = _safe('getClient');
  if (!client) return { pushed: 0, skipped: true };

  const { plan, refusals, stale, leagueId } = planFlush();

  if (stale.length) _reportStaleSwitch(stale);

  // A key whose refusal has not been followed by a landed hydrate is not
  // re-sent. It stays dirty and stays named in the banner.
  const blocked = new Set();
  for (const [key, rec] of _refusedKeys) {
    if (rec.atHydrateSeq === _hydrateSeq) blocked.add(key);
  }
  const runnable = plan.filter((op) => !blocked.has(op.key));

  const sentKeys = new Set();
  const errors = [...refusals];
  emit('syncing', { state: _state, pendingWrites: _dirty.size });
  for (const op of runnable) {
    try {
      await _execute(client, op, leagueId);
      sentKeys.add(op.key);
    } catch (e) {
      errors.push(e);
      if (e instanceof AdapterWriteRefusedError) {
        _refusedKeys.set(op.key, { code: e.code, serverMessage: e.serverMessage, atHydrateSeq: _hydrateSeq });
      }
    }
  }

  for (const e of errors) {
    if (e instanceof AdapterWriteRefusedError && !_refusedKeys.has(e.key)) {
      _refusedKeys.set(e.key, { code: e.code, serverMessage: e.serverMessage, atHydrateSeq: _hydrateSeq });
    }
  }

  // A key whose every operation went through is clean. A key with a refusal
  // stays dirty — the mirror keeps the value the user set until the next
  // hydrate rebases it, so they see their change vanish WITH the banner that
  // explains why, never silently (§5.2 item 4).
  const failedKeys = new Set(errors.map((e) => e && e.key).filter(Boolean));
  for (const key of sentKeys) {
    if (failedKeys.has(key)) continue;
    _dirty.delete(key);
    _refusedKeys.delete(key);
  }
  for (const s of stale) _dirty.delete(s.key);

  if (errors.length) {
    const first = errors[0];
    _lastError = first.message;
    emit('refused', {
      state: _state,
      error: _lastError,
      keys: [...failedKeys],
      refusedKeys: [..._refusedKeys.keys()],
      banner: `The server refused to save ${[...failedKeys].join(', ') || 'a change'}: `
        + `${first.serverMessage || first.message} Nothing was saved.`,
    });
    return { pushed: sentKeys.size, refused: [...failedKeys] };
  }

  // A write-during-switch refusal is NOT a success, even when everything else
  // in the batch went through. `_reportStaleSwitch()` has already emitted
  // 'refused' and set the banner text; clearing `_lastError` here and emitting
  // 'synced' would take that banner down in the same tick it went up, which is
  // how a loud failure becomes a silent one.
  if (stale.length) {
    _lastSyncAt = sentKeys.size ? new Date().toISOString() : _lastSyncAt;
    if (!_dirty.size) _persistSnapshot();
    return { pushed: sentKeys.size, refusedStale: stale.map((s) => s.key) };
  }

  // REVIEWER F6 — 'synced' MAY NOT BE EMITTED WHILE A KEY IS STILL REFUSED.
  //
  // `_refusedKeys` is latched until a hydrate lands (§5.2 item 3), and the badge reads the status
  // channel. So a later flush that happened to carry only clean keys would have emitted 'synced'
  // and taken the red banner down while the refused write was still unsent and still unsaved — the
  // player would be told everything is fine about the one thing that is not. The banner comes down
  // when the SET is empty, which is what §1.3's latch table already says releases it.
  if (_refusedKeys.size) {
    emit('refused', {
      state: _state,
      error: _lastError,
      keys: [],
      refusedKeys: [..._refusedKeys.keys()],
      banner: _lastError || `Still unsaved: ${[..._refusedKeys.keys()].join(', ')}.`,
    });
    return { pushed: sentKeys.size, stillRefused: [..._refusedKeys.keys()] };
  }

  _lastSyncAt = new Date().toISOString();
  _lastError = null;
  if (!_dirty.size) _persistSnapshot();
  emit('synced', { state: _state, pushed: sentKeys.size, pendingWrites: _dirty.size });
  return { pushed: sentKeys.size };
}

/** §3.3 layer 2's banner. Names BOTH leagues, through the injected
 *  `getLeagueName` — the adapter never holds a display string of its own
 *  (DI-184d/g: the name and the id come from the same call). */
function _reportStaleSwitch(stale) {
  const toName = _safe('getLeagueName') || 'the league you switched to';
  const fromName = (() => {
    const byId = _deps && typeof _deps.getLeagueNameById === 'function' ? _deps.getLeagueNameById : null;
    if (!byId) return 'the league you left';
    try { return byId(stale[0].from) || 'the league you left'; } catch { return 'the league you left'; }
  })();
  const keys = stale.map((s) => s.key).join(', ');
  _lastError = `A change made in ${fromName} was not saved because you switched to ${toName}. Re-enter it there.`;
  console.warn(`[sb] write-during-switch REFUSED for ${keys}: captured league ${stale[0].from} !== mirror league `
    + `${stale[0].to} — discarded from the plan, NOT re-queued under the new league.`);
  emit('refused', {
    state: _state, error: _lastError, keys: stale.map((s) => s.key),
    fromLeagueId: stale[0].from, toLeagueId: stale[0].to,
    banner: _lastError,
  });
}

function _refusalFrom(error, { key, rowId, leagueId }) {
  const code = (error && (error.code || error.details)) || '';
  const msg = (error && error.message) || '';
  // 42501 is BOTH PostgREST's insufficient-privilege and every guard trigger's
  // errcode (`0002:467-486`). PGRST301 is a JWT problem and is handed on rather
  // than classified here (§5.2).
  if (code === '42501' || /permission denied|violates row-level security/i.test(msg)) {
    return new AdapterWriteRefusedError(
      `The server refused to save ${key}: ${msg || 'insufficient privilege'}. Nothing was saved.`,
      { code: '42501', key, rowId, leagueId, serverMessage: msg || '42501' });
  }
  if (code === 'PGRST301' || code === '401') {
    const e = new Error(`${key}: ${msg || 'session'}`);
    e.pgCode = code;
    e.sessionSuspect = true;
    return e;
  }
  // An RPC's named exception arrives as the message: not_commissioner,
  // bad_transition, not_member, bad_key, bad_mode, bad_value, use_lock_week,
  // use_finalize_week, bad_results, not_found (0003).
  const named = /^(not_commissioner|bad_transition|not_member|bad_key|bad_mode|bad_value|use_lock_week|use_finalize_week|bad_results|not_found|not_authenticated|last_commissioner)$/
    .exec(String(msg).trim());
  if (named) {
    return new AdapterWriteRefusedError(
      `The server refused to save ${key}: ${named[1]}. Nothing was saved.`,
      { code: named[1], key, rowId, leagueId, serverMessage: named[1] });
  }
  return new AdapterWriteRefusedError(
    `The server refused to save ${key}: ${msg || 'unknown error'}. Nothing was saved.`,
    { code: code || 'error', key, rowId, leagueId, serverMessage: msg });
}

async function _execute(client, op, leagueId) {
  if (op.kind === 'rpc') {
    const res = await client.rpc(op.name, op.args);
    if (res && res.error) throw _refusalFrom(res.error, { key: op.key, rowId: op.rowId || null, leagueId });
    return res && res.data;
  }
  if (op.kind === 'finalize') {
    const args = _finalizeArgs(op.weekId, leagueId);
    const res = await client.rpc('finalize_week', args);
    if (res && res.error) throw _refusalFrom(res.error, { key: 'cfbp_weeks', rowId: op.weekId, leagueId });
    // The three keys the RPC wrote are no longer dirty: the server owns them now.
    _dirty.delete('cfbp_results');
    _dirty.delete('cfbp_obligations');
    return res && res.data;
  }
  if (op.kind === 'rows') {
    let res;
    if (op.op === 'insert') {
      res = await client.from(op.table).insert(op.rows).select();
    } else if (op.op === 'patch') {
      res = await client.from(op.table).update(op.changed).eq('league_id', leagueId).eq('id', op.rowId).select();
    } else {
      res = await client.from(op.table).delete().eq('league_id', leagueId).eq('id', op.rowId).select();
    }
    if (res && res.error) throw _refusalFrom(res.error, { key: op.key, rowId: op.rowId || null, leagueId });
    // A policy that DENIES a row reports zero rows affected and NO error
    // (`rls.test.mjs:167-170` `wasRefused()` models both mechanisms). A
    // zero-row patch or delete is therefore a refusal, not a success.
    if (op.op !== 'insert' && Array.isArray(res && res.data) && res.data.length === 0) {
      throw new AdapterWriteRefusedError(
        `The server refused to save ${op.key}: the row-level policy matched no row for ${op.rowId}. Nothing was saved.`,
        { code: '42501', key: op.key, rowId: op.rowId, leagueId, serverMessage: 'policy matched no row' });
    }
    return res && res.data;
  }
  throw new Error(`[sb] unknown plan op ${op.kind}`);
}

/**
 * §2.3's finalize gather. `finalize_week(p_league, p_week, p_results,
 * p_obligations)` (`0003:376`) validates every row against real
 * `league_members` ids and against the target week BEFORE any write, and
 * inserts only obligations that do not already exist by id — so the planner
 * sends that week's results and only the obligations the server has not seen.
 */
function _finalizeArgs(weekId, leagueId) {
  const results = (_mirror.get('cfbp_results') || []).filter((r) => r && r.weekId === weekId);
  const obBase = _baseRows.get('cfbp_obligations') || new Map();
  const obligations = (_mirror.get('cfbp_obligations') || [])
    .filter((o) => o && o.weekId === weekId && !obBase.has(o.obligationId));
  return { p_league: leagueId, p_week: weekId, p_results: results, p_obligations: obligations };
}

// ══════════════════════════════════════════════════════════════════════════
// 9 · league scoping (§3.2) — switch = clear + re-hydrate BEFORE SWITCH_END
// ══════════════════════════════════════════════════════════════════════════

/**
 * The hook `auth.js`'s `switchActiveLeague()` awaits between its pointer write
 * (`auth.js:1818-1823`, the Step 4 TODO at `:1820-1822`) and `SWITCH_END`
 * (`:1831`). Part B registers it; the adapter owns what it does.
 *
 * `SWITCH_END` is emitted AFTER the awaited hydrate, and a hydrate FAILURE
 * during a switch must NOT emit it: the overlay stays up, the banner names the
 * failure, and the adapter is HELD for that league. A half-hydrated league is
 * never painted as if it were whole (DI-181c's blind-rule obligation).
 * `switchLeague()` therefore RESOLVES `{ ok:false }` rather than throwing, so
 * the caller can decide not to fire the event without a try/catch of its own.
 */
export function beginSwitch(fromLeagueId, toLeagueId) {
  _switchSeq++;
  unsubscribeRealtime();
  dropMirror(`league-switch:${fromLeagueId || 'none'}->${toLeagueId || 'none'}`);
  _setState('SWITCHING', `league-switch:${toLeagueId || 'none'}`);
  return { switchSeq: _switchSeq };
}

export async function switchLeague(toLeagueId, { from = null } = {}) {
  beginSwitch(from, toLeagueId);
  const ownerTuple = _safe('getDeviceDataOwnerTuple');
  primeFromSnapshot(ownerTuple, toLeagueId);           // normally 0 — the marker has just moved
  const keys = await hydrate(toLeagueId, { epoch: _safe('getIdentityEpoch'), reason: 'league-switch' });
  if (_state !== 'ACTIVE') return { ok: false, state: _state, error: _lastError };
  subscribeRealtime();
  return { ok: true, keys };
}

// ══════════════════════════════════════════════════════════════════════════
// 10 · the device snapshot (§5.3) and the offline read-only rule
// ══════════════════════════════════════════════════════════════════════════

/**
 * ONE device-local key, `cfbp_supabase_mirror` — the entry DI §0.3 item 4
 * allows, and the one line `storage.js`'s inventory comment gains in Part B.
 * It replaces `cfbp_sheet_mirror` (`backend.js:39`) in this mode, and that key
 * is wiped at the first Supabase boot (§6.1).
 *
 * WRITTEN ONLY FROM SERVER TRUTH. Never while `ACTIVE-STALE` and never with
 * dirty keys pending: it holds what the server said, so no held write survives
 * a reload — which is the honest version of `backend.js:976-982`'s note about
 * a held write that reappears and then vanishes.
 */
function _persistSnapshot() {
  if (_state === 'ACTIVE-STALE' || _dirty.size) return false;
  if (!_mirrorTag) return false;
  const owner = _safe('getDeviceDataOwnerTuple');
  if (!owner) return false;
  const data = {};
  _mirror.forEach((v, k) => { if (k !== DERIVED_PROGRESS_KEY) data[k] = v; });
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      owner, leagueId: _mirrorTag.leagueId, epoch: _mirrorTag.epoch, at: _mirrorTag.at, data,
    }));
    return true;
  } catch (e) {
    console.warn('[sb] device snapshot persist failed', e && e.name);
    return false;
  }
}

/** Exported so `clearDeviceLocalSessionData()` (`auth.js:2059-2169`) can read
 *  the new key back through an ACCESSOR rather than a second key literal
 *  beside `auth.js:2098-2099` (§5.3's last paragraph). */
export function hasDeviceSnapshot() {
  try { return localStorage.getItem(SNAPSHOT_KEY) !== null; } catch { return false; }
}

function _readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || typeof snap.data !== 'object' || !snap.data) return null;
    return snap;
  } catch (e) {
    console.warn('[sb] device snapshot unreadable, ignoring', e && e.name);
    return null;
  }
}

function _removeSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* best effort */ }
  return !hasDeviceSnapshot();
}

/**
 * §5.3's FOUR-CONDITION RULE (Drew decision D-1(a)), written as one predicate
 * so there is one place to read it and one place to break it:
 *
 *   (1) `hasValidSupabaseSession()` — an unexpired token on the device
 *       (`auth.js:745-755`);
 *   (2) the identity has RESOLVED on this page — `getAccountUserId()` non-empty
 *       AND an active league is set (the hold predicate at `app.js:2003`);
 *   (3) the snapshot's stored owner tuple === `_deviceDataOwnerTuple()`
 *       (`auth.js:2177-2185`) AND its `leagueId` === `getActiveLeagueId()`;
 *   (4) the owner MARKER on the device (`getDeviceDataOwner()`, `:2189-2191`)
 *       equals the same tuple.
 *
 * Any one false ⇒ the snapshot is treated as MISSING, and for a TUPLE MISMATCH
 * it is CLEARED. Fail-closed: a snapshot that cannot prove whose it is is
 * another player's league until proven otherwise.
 */
function _offlineConditionsHold(leagueId, snap = _readSnapshot()) {
  if (!snap) return false;
  if (_safe('hasValidSupabaseSession') !== true) return false;
  const account = _safe('getAccountUserId');
  const active = leagueId || _safe('getActiveLeagueId');
  if (!account || !active) return false;
  const tuple = _safe('getDeviceDataOwnerTuple');
  if (!tuple || snap.owner !== tuple) return false;
  if (snap.leagueId !== active) return false;
  return _safe('getDeviceDataOwner') === tuple;
}

/**
 * Prime the mirror from the device snapshot, SYNCHRONOUSLY, and return the
 * number of keys primed (0 = nothing serveable; the caller must await
 * `hydrate()` before rendering league data — `backend.js:443-459`'s contract).
 *
 * Called AFTER the membership resolve, never before: the owner tuple needs the
 * account id, which is not known until then. That is the deliberate cost DI
 * §1.5 item 1 names — on a Supabase device the first paint is the SKELETON, not
 * league data, because no league row may be in the DOM before an identity is
 * proven (A6 becomes a data boundary, §6.2).
 */
export function primeFromSnapshot(ownerTuple, leagueId) {
  const snap = _readSnapshot();
  if (!snap) return 0;
  if (ownerTuple && snap.owner !== ownerTuple) {
    console.warn('[sb] the device snapshot belongs to a different (account, league) — CLEARED, not served.');
    _removeSnapshot();
    return 0;
  }
  if (!_offlineConditionsHold(leagueId, snap)) {
    console.warn('[sb] the device snapshot did not satisfy the four-condition rule (§5.3) — treated as MISSING.');
    return 0;
  }
  _mirror = new Map(Object.entries(snap.data));
  _baseRows = new Map();
  _baseValues = new Map(Object.entries(snap.data));
  _mirrorTag = { leagueId: snap.leagueId, epoch: snap.epoch, switchSeq: _switchSeq, at: snap.at };
  _lastSyncAt = snap.at || null;
  _setState('ACTIVE-STALE', 'device-snapshot');
  return _mirror.size;
}

/**
 * §6.6 — the in-memory mirror is dropped on handover and on sign-out.
 * `clearDeviceLocalSessionData()` (`auth.js:2059-2169`) swept storage and the
 * Sheets mirror BACKUP but explicitly not the live in-memory mirror
 * (`auth.js:1855-1861`: "not cleared here because it is not league-scoped
 * today"). It is league-scoped now.
 *
 * Returns a READ-BACK verdict so it can feed that routine's `complete` flag —
 * a clear that fails OPEN is how a fail-closed rule becomes a no-op on exactly
 * the devices that need it.
 */
/**
 * §3.3's rule reaches here too: a pending write is REFUSED, never dropped
 * silently. `dropMirror()` is called on a league switch, a handover and a
 * sign-out, and in all three the queued write is not going to be saved — so
 * the player is TOLD, with the league it was made in named, instead of
 * watching it disappear. Then, and only then, the queue is cleared.
 */
function _refuseDirtyLoudly(reason) {
  if (!_dirty.size) return [];
  const keys = [..._dirty.keys()];
  const fromId = _mirrorTag ? _mirrorTag.leagueId : null;
  const byId = _deps && typeof _deps.getLeagueNameById === 'function' ? _deps.getLeagueNameById : null;
  let fromName = '';
  if (byId && fromId) { try { fromName = byId(fromId) || ''; } catch { fromName = ''; } }
  const toName = _safe('getLeagueName') || '';
  const isSwitch = /^league-switch/.test(String(reason));
  _lastError = isSwitch
    ? `A change made in ${fromName || 'the league you left'} was not saved because you switched to `
      + `${toName || 'another league'}. Re-enter it there.`
    : `${keys.length} unsaved change${keys.length === 1 ? '' : 's'} could not be saved before this device changed hands. Nothing was sent.`;
  console.warn(`[sb] ${keys.join(', ')} were still queued when the mirror was dropped (${reason})`
    + ' — REFUSED and reported, NOT re-queued under the new league.');
  emit('refused', {
    state: _state, error: _lastError, keys, fromLeagueId: fromId, reason, banner: _lastError,
  });
  return keys;
}

export function dropMirror(reason = '') {
  unsubscribeRealtime();
  if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
  const refused = _refuseDirtyLoudly(reason);
  _mirror = new Map();
  _baseRows = new Map();
  _baseValues = new Map();
  _overlay.clear();
  _dirty.clear();
  _refusedKeys.clear();
  _lastContacts = new Map();
  _mirrorTag = null;
  // `_lastError` is cleared ONLY when there was nothing to report. A refusal
  // raised one line ago is the banner text the player is about to read, and
  // clearing it here would take the banner down in the same tick it went up.
  if (!refused.length) _lastError = null;
  const cleared = _removeSnapshot();
  if (!cleared) console.warn('[sb] the device snapshot could not be removed — reporting an INCOMPLETE clear.');
  if (_state !== 'SWITCHING') _setState('IDLE', `dropMirror:${reason}`);
  return { cleared, reason };
}

/** §6.3 (A8) — post-identity expiry becomes a GATE, not a banner. Also §6.4's
 *  verify window and any other "the player is proven but the league is not"
 *  event. The probe goes false, so `save()` throws through the EXISTING
 *  interlock (`storage.js:292-295`) — no second refusal mechanism. */
export function withhold(reason = 'withheld') {
  _setState('HELD', reason);
  unsubscribeRealtime();
  return _state;
}

/** §5.1 — `isContentWithheld()`'s third clause, computed here so app.js reads
 *  one predicate rather than re-deriving the state list. */
export function isContentWithheldByAdapter() {
  return !READY_STATES.includes(_state);
}

// ══════════════════════════════════════════════════════════════════════════
// 11 · first Supabase data boot: wipe the two Sheets-era device records (§6.1)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Entry condition #9. On the adapter's FIRST `ACTIVE` transition on this
 * device, remove `cfbp_sheet_mirror` (through `backend.js`'s own exported
 * `clearMirror()`, injected) and `cfbp_site_unlocked` (through
 * `storage.js`'s `setSiteUnlocked(false)`, injected) — the two Sheets-era
 * device records a rollback to `pins` would otherwise read straight back. The
 * precedent and its reasoning are the one-time `cfbp_session` removal at
 * `app.js:657-681`.
 *
 * A failure to remove is a WARNING, not a dead boot — same as that precedent.
 * Read-back verified, one console line, and it never runs twice in a page.
 */
function _runFirstBootWipe() {
  if (_firstSupabaseBootDone) return { ran: false };
  _firstSupabaseBootDone = true;
  let ok = true;
  try { _dep('clearMirror')(); } catch (e) { ok = false; console.warn('[sb] clearMirror() failed on the first Supabase boot', e && e.name); }
  try { _dep('setSiteUnlocked')(false); } catch (e) { ok = false; console.warn('[sb] setSiteUnlocked(false) failed on the first Supabase boot', e && e.name); }
  // REVIEWER F9 — THE READ-BACK GOES THROUGH ACCESSORS, NOT KEY LITERALS.
  //
  // It used to read `localStorage.getItem('cfbp_sheet_mirror')` and `'cfbp_site_unlocked'`
  // directly. That is a second copy of two key names this module does not own — `backend.js:39`
  // owns the first and `data-model.js`'s SITE_PIN_KEY (via `storage.js:50`) owns the second — and
  // it is the exact shape RG-49 is about: `_USER_DATA_KEYS` named two keys that had never existed,
  // so a guard read as though it covered them and was inert for the life of the file. A read-back
  // keyed on a literal that drifts reports "absent" about a key nobody stores under that name.
  // Both now arrive injected, beside the two clearers they verify, and default to "cannot tell"
  // (`null`) — which is reported as NOT VERIFIED rather than as success.
  const probeBack = (name) => {
    const fn = _deps && typeof _deps[name] === 'function' ? _deps[name] : null;
    if (!fn) return null;
    try { return fn() === false; } catch (e) { console.warn(`[sb] ${name}() threw during the first-boot read-back`, e && e.name); return false; }
  };
  const mirrorGone = probeBack('hasSheetMirror');
  const unlockGone = probeBack('isSiteUnlocked');
  const verdict = (v) => (v === null ? 'NOT VERIFIED (no accessor injected)' : v ? 'absent' : 'STILL PRESENT');
  console.info(`[sb] first Supabase data boot: the Sheets mirror is ${verdict(mirrorGone)},`
    + ` the site unlock is ${verdict(unlockGone)}`);
  return { ran: true, ok: ok && mirrorGone === true && unlockGone === true, mirrorGone, unlockGone };
}

// ══════════════════════════════════════════════════════════════════════════
// 12 · Realtime (§4.2) — JOINED is not LIVE, and the re-hydrate is the probe
// ══════════════════════════════════════════════════════════════════════════

/**
 * Tables in the publication are `messages, games, weeks, picks, league_kv`
 * (`0005_realtime.sql:8`), all `replica identity full` (`:3-7`) so the SELECT
 * policy filters every event kind. The adapter subscribes to FOUR of them and
 * NEVER to `messages` — AD-16, and chat is Step 5.
 *
 * THE SUBSCRIBED-vs-REGISTERED GAP (RG-136, Drew's run 3): `SUBSCRIBED` fires
 * when the channel JOINS, before the server has registered `postgres_changes`
 * underneath it, so events committed in that window reach nobody. The app
 * cannot do what `rls.test.mjs` B7 does — write a control row — because a
 * "probe pick" would be a real pick. So THE RE-HYDRATE IS THE PROBE:
 *
 *   1. on `SUBSCRIBED` the channel is JOINED, not LIVE, and a re-hydrate is
 *      scheduled immediately (the hydrate is the truth; the channel is a hint,
 *      assessment risk 8);
 *   2. it becomes LIVE on the first event received OR when that post-join
 *      hydrate lands, whichever is first;
 *   3. every event is checked against the mirror's `(leagueId, epoch,
 *      switchSeq)` before it folds; a stale event is DISCARDED with a console
 *      line, the same discipline as `_identityEpochMoved` (`auth.js:404`);
 *   4. `visibilitychange`(visible) and `online` trigger a RE-HYDRATE, never a
 *      "trust the channel" — RG-94/95/96's cursor lesson.
 */
export function subscribeRealtime() {
  const client = _safe('getClient');
  const leagueId = _mirrorTag ? _mirrorTag.leagueId : _safe('getActiveLeagueId');
  if (!client || !leagueId || _state !== 'ACTIVE') return null;
  if (_rt && _rt.leagueId === leagueId) return _rt;
  unsubscribeRealtime();
  if (typeof client.channel !== 'function') return null;

  let channel = client.channel(`league:${leagueId}`);
  const filter = `league_id=eq.${leagueId}`;
  for (const table of ['games', 'weeks', 'picks', 'league_kv']) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter },
      (payload) => _onRealtimeEvent(table, payload, { leagueId, epoch: _mirrorTag && _mirrorTag.epoch, switchSeq: _switchSeq }));
  }
  _rt = { channel, phase: 'joined', leagueId };
  _rtRehydrateArmed = false;
  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    // JOINED, not LIVE. Schedule the post-join re-hydrate — the probe.
    if (_rtRehydrateArmed) return;
    _rtRehydrateArmed = true;
    Promise.resolve()
      .then(() => hydrate(leagueId, { epoch: _safe('getIdentityEpoch'), reason: 'realtime-post-join' }))
      .then(() => { if (_rt && _rt.leagueId === leagueId && _rt.phase === 'joined') _rt.phase = 'live'; })
      .catch((e) => console.warn('[sb] post-join re-hydrate failed', e && e.message));
  });
  return _rt;
}

export function unsubscribeRealtime() {
  if (!_rt) return false;
  try {
    const client = _safe('getClient');
    if (client && typeof client.removeChannel === 'function') client.removeChannel(_rt.channel);
    else if (_rt.channel && typeof _rt.channel.unsubscribe === 'function') _rt.channel.unsubscribe();
  } catch (e) { console.warn('[sb] removeChannel failed', e && e.name); }
  _rt = null;
  _rtRehydrateArmed = false;
  return true;
}

function _onRealtimeEvent(table, payload, token) {
  // REVIEWER F2 — this used to compare `token.epoch` to `_mirrorTag.epoch`, which is INERT: the
  // token is stamped from the mirror tag at subscribe time, so the two are equal by construction
  // and the clause could never fire. An account change bumps `getIdentityEpoch()` and, on its own
  // (no league switch, no dropMirror yet), left the mirror tag and the token both holding the OLD
  // epoch — so an event for the previous identity would have folded. `_opMoved()` is the ONE
  // comparison that asks the live question, and it is the same one `hydrate()` asks after every
  // await (I6, `auth.js:849`): no asynchronous result may be applied under an epoch other than the
  // one it was issued under. One predicate, three call sites, no second opinion.
  if (!_mirrorTag
    || _opMoved({ leagueId: token.leagueId, epoch: token.epoch, switchSeq: token.switchSeq })) {
    console.warn(`[sb] a Realtime ${table} event arrived for an identity/league this device has already left — DISCARDED`);
    return false;
  }
  const row = (payload && (payload.new || payload.old)) || null;
  if (row && row.league_id && row.league_id !== _mirrorTag.leagueId) {
    console.warn('[sb] a Realtime event carried another league’s league_id — DISCARDED');
    return false;
  }
  if (_rt) _rt.phase = 'live';
  _foldRealtimeRow(table, payload);
  const cb = _deps && typeof _deps.onRealtimeEvent === 'function' ? _deps.onRealtimeEvent : null;
  if (cb) { try { cb(table, payload); } catch (e) { console.warn('[sb] onRealtimeEvent listener failed', e && e.name); } }
  return true;
}

/**
 * Fold ONE row event into the mirror and the base, then re-project through
 * `fromRows` so the mirror value is always something the projection produced —
 * never something this file assembled by hand. The overlay for that key is
 * dropped, because the server has just spoken.
 */
function _foldRealtimeRow(table, payload) {
  const keys = KEYS_FOR_TABLE[table] || [];
  if (!keys.length) return;
  const evt = (payload && payload.eventType) || (payload && payload.event) || 'UPDATE';
  for (const key of keys) {
    const base = _baseRows.get(key) || new Map();
    if (evt === 'DELETE') {
      const old = payload && payload.old;
      if (old && old.id != null) base.delete(old.id);
    } else {
      const row = payload && payload.new;
      if (!row || row.id == null) continue;
      if (table === 'league_kv') {
        // league_kv is keyed by (league_id, key); its rows carry no `id`, so a
        // kv event is folded by its `key` column instead. Handled separately
        // rather than pretending kv rows have ids.
        continue;
      }
      base.set(row.id, { ...(base.get(row.id) || {}), ...row });
    }
    _baseRows.set(key, base);
    const rowsByTable = { [table]: [...base.values()] };
    try {
      _mirror.set(key, fromRows[key](rowsByTable, _ctx(_mirrorTag.leagueId, { contacts: [..._lastContacts.values()] })));
    } catch (e) { console.warn(`[sb] could not re-project ${key} after a Realtime event`, e && e.message); }
  }
  if (table === 'games') _overlay.delete('cfbp_games');
  if (table === 'league_kv') {
    const row = payload && (payload.new || payload.old);
    const kvKey = row && row.key;
    for (const [key, route] of Object.entries(ROUTES)) {
      if (route.table !== 'league_kv' || route.kvKey !== kvKey) continue;
      const rowsByTable = { league_kv: [row].filter(Boolean) };
      try { _mirror.set(key, fromRows[key](rowsByTable, _ctx(_mirrorTag.leagueId))); }
      catch (e) { console.warn(`[sb] could not re-project ${key} after a league_kv event`, e && e.message); }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 13 · test seams (the `_xxxForTest` convention; no production call site)
// ══════════════════════════════════════════════════════════════════════════

export function _resetForTest() {
  unsubscribeRealtime();
  if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
  _state = 'IDLE'; _stateReason = '';
  _mirror = new Map(); _baseRows = new Map(); _baseValues = new Map();
  _overlay.clear(); _dirty.clear(); _refusedKeys.clear();
  _lastContacts = new Map();
  _mirrorTag = null; _switchSeq = 0; _hydrateSeq = 0;
  _lastSyncAt = null; _lastError = null; _firstSupabaseBootDone = false;
  _listeners.clear();
  _deps = null;
}
export function _setStateForTest(next, reason = 'test') { return _setState(next, reason); }
export function _dirtyKeysForTest() { return [..._dirty.keys()]; }
export function _refusedKeysForTest() { return [..._refusedKeys.keys()]; }
export function _overlayForTest() { return _overlay.get('cfbp_games') || new Map(); }
export function _setContactsForTest(list) {
  _lastContacts = new Map((list || []).map((c) => [c.member_id, c]));
}
export function _snapshotKeyForTest() { return SNAPSHOT_KEY; }
/**
 * Test-only mirror seeder (Part B, 2026-09-18 — weekprogresstest.mjs).
 *
 * `set()` cannot do this: it is the WRITE path, so it consults the routing
 * table (most keys are `refuse` for a player) and refuses `cfbp_week_progress`
 * outright, which is correct and is itself asserted. A suite whose subject is
 * what the RENDER does with a given mirror needs to state the mirror, not
 * re-derive it through a hydrate whose fidelity adaptertest.mjs already proves.
 * Production has no caller and cannot: nothing exported from here writes the
 * mirror without going through set() or hydrate().
 */
export function _seedMirrorForTest(key, value) { _mirror.set(key, value); return _mirror.size; }
export function _firstBootDoneForTest() { return _firstSupabaseBootDone; }
export function _hydrateSeqForTest() { return _hydrateSeq; }
export function _mirrorTagForTest() { return _mirrorTag ? { ..._mirrorTag } : null; }
/** A DEEP COPY (security F-3). Handing a test the live, frozen table would make every mutation
 *  attempt throw inside the test rather than inside the code under test — and handing it a shallow
 *  copy would hand back the same frozen entries. The copy is what lets `adaptertest` prove the
 *  ORIGINAL is frozen without depending on the reference it was given. */
export function _routesForTest() {
  const out = {};
  for (const [k, v] of Object.entries(ROUTES)) out[k] = { ...v };
  return out;
}
export function _frozenTablesForTest() {
  return { ROUTES, GAME_SCORE_FIELDS, TRANSITION_ALLOWED, PROBE_TRUE_STATES, READY_STATES, SELECT_COLS };
}
export function _readTablesForTest() { return [...READ_TABLES]; }
export function _selectColsForTest() { return { ...SELECT_COLS }; }
export function _gameScoreFieldsForTest() { return [...GAME_SCORE_FIELDS]; }
export const _DERIVED_PROGRESS_KEY_FOR_TEST = DERIVED_PROGRESS_KEY;
