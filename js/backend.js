/**
 * CFB Pickems — Backend Adapter (Phase II)
 * =========================================
 * Talks to the Google Apps Script web app and keeps an in-memory mirror of all
 * storage keys so the rest of the app can keep using SYNCHRONOUS load()/save().
 *
 * Why a mirror?
 *   The whole app was built around synchronous localStorage. Rewriting every
 *   call site to be async would be a huge, risky change. Instead:
 *     - At startup we pull the full snapshot ONCE (async) into `_cache`.
 *     - storage.js reads/writes `_cache` synchronously (instant, like before).
 *     - Writes are also queued and pushed to the Sheet (debounced) in the
 *       background. Last-write-wins, which is fine for a small league.
 *
 * Modes (storage.js decides which to use based on settings.storageMode):
 *   - 'local'         : pure localStorage (default; offline; per-device)
 *   - 'googleSheets'  : this adapter (shared across devices)
 *
 * Config lives in localStorage (so it survives reloads and never ships in source):
 *   cfbp_backend_config = { url, token }
 */

const CFG_KEY = 'cfbp_backend_config';

/**
 * v0.16.0 — SNAPSHOT MIRROR (boot-performance fix).
 * After every successful hydrate/push, the full key/value snapshot is persisted
 * to localStorage under MIRROR_KEY. On the NEXT boot, primeFromMirror() loads
 * it synchronously so the app renders league data in <1s instead of blocking
 * on a Google Apps Script cold start (measured 10–20s).
 *
 * This is NOT a silent storage fallback (loud-fail decision still holds):
 *  - the UI shows a visible "Syncing…" badge until the background hydrate lands;
 *  - if that hydrate FAILS, the persistent red banner appears exactly as before;
 *  - pushes are HELD while stale (see flushPush) so a stale mirror can never
 *    overwrite fresher remote data — local edits are rebased onto the fresh
 *    snapshot when hydrate completes, then pushed.
 */
const MIRROR_KEY = 'cfbp_sheet_mirror';
let _stale = false;            // true = serving mirror data, hydrate not yet landed

const _cache = new Map();      // key -> parsed value (the synchronous mirror)
let _ready = false;            // true once hydrated from the Sheet
let _config = null;            // { url, token }
let _pushTimer = null;
const _dirty = new Set();      // keys changed since last push

/**
 * RG-24 — field-scoped rebase for composite blob keys.
 *
 * `_dirty` is KEY-granular, and so is the rebase in hydrate() below. That is
 * right for keys whose value IS the local intent (picks, weeks, games — the
 * whole array is authored here). It is wrong for `cfbp_settings`, one key
 * holding ~17 independent fields: a device whose mirror predates another
 * device's change writes one field and re-applies its stale view of the other
 * 16, silently reverting them. That is how UN-112's cleared chat came back —
 * chatEpochSeq went to 0 — and it applies identically to chatEnabled and
 * randomizePicksEnabled.
 *
 *   key -> Set(field)  the caller declared which fields it changed
 *   key -> null        a whole-value write is pending; it supersedes fields
 *   (absent)           nothing pending, or a non-object value
 *
 * This makes AD-08's stated promise ("a stale mirror can never overwrite
 * fresher remote data") true for composite blobs, where it previously was not.
 * It does NOT change what gets PUSHED — only what a held write is rebased onto.
 */
const _dirtyFields = new Map();

/**
 * User data whose loss is unrecoverable — see storage.js USER_MUTABLE_KEYS.
 *
 * RG-49 — the last two entries read `cfbp_tb_guesses` / `cfbp_ep_guesses` until
 * 2026-09-02. Neither string has ever existed anywhere in the app; storage.js
 * calls those keys `cfbp_tiebreaker_guesses` / `cfbp_extra_point_guesses`. So
 * `_USER_DATA_KEYS.includes(k)` was false for both REAL keys, and defense (c)
 * was INERT for tiebreaker and Extra Point guesses from the day it was written
 * while reading, to any human or any source-text audit, as though it covered
 * them. persisttest [6] is the structural check that every key named in this
 * array is a key storage.js actually defines.
 *
 * Keep key names in the array itself, not in comments inside it: [6] reads the
 * string literals out of this block, so a retired key name mentioned between
 * the brackets will fail that assertion. Failing loud on a comment is the safe
 * direction, but the comment belongs up here regardless.
 *
 * Build 2b, Group E (2026-09-10, UN-161…163) added the last two entries
 * below — SCRIBE Trainer learnings/Canon. Deliberately HERE, not in
 * `_APPEND_ONLY_ID`: those two keys are commissioner-edited IN PLACE (an
 * approve/reject flips a status field on an EXISTING array entry, per the
 * design input) rather than append-only. A union-by-id merge is not viable
 * either — the model-supplied learning/canon ids are not guaranteed non-
 * empty, and an experiment or fact-candidate item carries no id field at
 * all (see storage.js KEYS.SCRIBE_LEARNINGS for the full shape). Shrink
 * protection is the right, narrower defense: `runTrainer` (backend/Code.gs)
 * writes this key directly, server-side, entirely outside this client's
 * push/pull cycle, so a commissioner approving an item on a device whose
 * mirror predates a fresh Trainer run would otherwise push a SHORTER array
 * back and silently erase whatever the run just added. The third key,
 * cfbp_scribe_reports, is NOT listed: no client code path ever calls
 * save() on it (the only client accessor is a read), so nothing is ever
 * locally dirty for this defense to protect.
 */
const _USER_DATA_KEYS = [
  'cfbp_players', 'cfbp_weeks', 'cfbp_games', 'cfbp_picks', 'cfbp_results',
  'cfbp_obligations', 'cfbp_tiebreaker_guesses', 'cfbp_extra_point_guesses',
  'cfbp_scribe_learnings', 'cfbp_scribe_canon',
];
function _size(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v ? 1 : 0;
}
/** True when applying `local` over `remote` would destroy records. */
function _shrinks(local, remote) { return _size(local) < _size(remote); }
/**
 * Test-only seam for RG-12 defense (c).
 *
 * This export is LOAD-BEARING, not a convenience. loadtest.mjs's defense-(c)
 * block used to branch on `typeof be._shrinksForTest === 'function'` and fall
 * back to matching the guard's SOURCE TEXT when it was absent. The export was
 * never added, so the fallback is what ran — and a source-text match cannot
 * tell a working guard from a gutted one. Verified 2026-08-12: replacing the
 * guard's body with `_cache.set(k, v)` (protection gone, text intact) left the
 * suite fully green at 552/552. That is RG-12's own failure mode reproduced
 * inside the commit written to eliminate it. Do not remove this export.
 */
export function _shrinksForTest(local, remote) { return _shrinks(local, remote); }
function _isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/**
 * RG-39 DEFENSE (d), 2026-08-26 — FIELD-LEVEL staleness, not just record-level.
 *
 * Drew, after a deploy: "all the emails for the players went away and the pins
 * reset. We need to make sure that if we input personal information it stays,
 * and if we update security information it stays."
 *
 * Defense (c) above asks `_shrinks()`, and `_size()` counts RECORDS. A device
 * booting on a mirror from before the commissioner typed anyone's email holds
 * six players — the same six, in the same order, all well-formed — that merely
 * lack `email` and `pinHash`. Six is not fewer than six, so (c) does not fire,
 * the stale array is re-applied wholesale, and flushPush sends it to the Sheet.
 * Every player's contact and login data, gone league-wide, from ONE ordinary tap
 * during the 10–20s Apps Script cold start while the app is already interactive.
 *
 * `pinHash` makes it worse than it sounds: a wiped hash does not reset a PIN, it
 * removes the credential. Until RG-40 (2026-08-26) verifyPlayerPin() returned
 * TRUE when the field was absent, so such an account accepted any PIN at all;
 * it now fails closed, so the same wipe locks the player out until the
 * commissioner re-issues. Neither outcome is acceptable — this defense is what
 * prevents the wipe.
 *
 * Same principle (c) already states — "a held write may ADD to user data, it may
 * never make it smaller" — measured at the resolution the data actually lives
 * at. Per record, matched on a stable id: a field the local copy does not have
 * is taken from the fresher remote; a field it DOES have wins, so a genuine edit
 * is never reverted. Nested preference objects merge the same way rather than
 * replacing wholesale, so one device's theme change cannot drop another's tz.
 *
 * Deliberately scoped to `cfbp_players` — the only key holding authentication
 * and contact data, and the only one with a reported failure and a reproduction
 * (synctest.mjs [1]). Picks/games/weeks have their own field semantics and no
 * evidence of this failure; widening this without a reproduction would be
 * exactly the speculative change this defense exists to prevent.
 */
const _FIELD_REBASE_ID = { cfbp_players: 'playerId' };
function _isBlank(v) { return v === undefined || v === null || v === ''; }
function _rebaseRecords(local, remote, idField) {
  if (!Array.isArray(local) || !Array.isArray(remote)) return local;
  const byId = new Map();
  remote.forEach(r => { if (_isPlainObject(r) && r[idField] != null) byId.set(r[idField], r); });
  return local.map(l => {
    if (!_isPlainObject(l) || l[idField] == null) return l;
    const r = byId.get(l[idField]);
    if (!r) return l;                                  // local-only record: keep as-is
    const merged = { ...l };
    for (const f of Object.keys(r)) {
      const lv = merged[f], rv = r[f];
      if (_isBlank(rv)) continue;                      // nothing to restore; never invent a field
      if (_isBlank(lv)) { merged[f] = rv; continue; }  // local dropped it -> take the remote's
      // Both populated. A genuine local edit wins. For a nested prefs object,
      // merge key-by-key so a local write of one preference cannot blank the rest.
      if (_isPlainObject(lv) && _isPlainObject(rv)) merged[f] = { ...rv, ...lv };
    }
    return merged;
  });
}

/**
 * RG-49 — APPEND-ONLY LOGS merge by id; they are never re-applied wholesale.
 *
 * `cfbp_feedback` is a list of immutable rows written by six different people
 * at six different times into ONE seam key. A device booting on a stale mirror
 * holds a well-formed, populated, obsolete copy of the whole list; the default
 * branch in hydrate() re-applies it over the fresher remote and flushPush sends
 * it to the Sheet. Every submission silently deletes the queue behind it —
 * which is how the bug-reporting channel itself became lossy, and therefore why
 * no other report in the queue could be trusted to be complete. Drew, 2026-09-01:
 * "I don't think the feature/bug feedback submitted is always getting saved."
 *
 * `_shrinks` (defense (c)) is NOT the fix for this shape. Dropping the smaller
 * side would throw away the submission the player just made — the same silent
 * loss, arrived at from the other direction. Both halves are pinned by
 * persisttest [3] and [4]. The merge is a UNION keyed on the row id: remote
 * first, then any local row the remote has not seen.
 *
 * Scoped to `cfbp_feedback` on purpose. `cfbp_comments` has the identical shape
 * and the identical exposure, but it also has an ORDINARY, player-reachable
 * delete (`deleteComment`, wired to the per-game comment bubbles), and a union
 * would resurrect a comment someone deleted — the inverse hazard ledger §6
 * already records against `_rebaseRecords()`. That is Drew's decision, not a
 * guess to make here, so it is deliberately left out.
 *
 * Feedback's own delete surface, CHECKED 2026-09-02 rather than assumed:
 *   clearFeedback()  no production call site at all; its only two callers are
 *                    loadtest.mjs fixtures, which run in LOCAL mode and never
 *                    reach this rebase.
 *   resetToDemo()    DOES clear feedback and IS reachable (commissioner Full
 *                    Factory Reset), so this union can undo a factory reset's
 *                    feedback clear if one is run inside the stale window.
 * That residual is accepted on defense (c)'s own stated principle: a deletion is
 * rare, visible, and can simply be redone once synced; silently destroying every
 * player's submissions is neither. The trade only ever runs in that direction.
 *
 * A row with no id is KEPT rather than deduped: it may duplicate on a later
 * hydrate, which is visible and recoverable. Dropping a submission is not.
 *
 * `cfbp_notifications` joined this map 2026-09-10 (NON-BLOCKING #4/#5
 * remediation, Groups A/B notifications) on the SAME `cfbp_feedback`
 * reasoning, checked the same way: js/notifications.js has no ordinary,
 * player-reachable delete for an individual notification row (retention
 * pruning is a policy-layer batch operation applied at READ time only as of
 * this remediation — see that module's createInAppNotification()/
 * getNotificationsForPlayer() header notes — never a single-row delete a
 * union could resurrect the INVERSE of). `readAt` is device-local for every
 * row regardless of origin (same pass), so this key's shared copy is, in
 * practice, append-only from the policy layer: no per-row delete or field
 * mutation is ever written back. The one shorter write is resetToDemo()
 * (storage.js) saving [] — the same accepted residual as cfbp_feedback
 * above: a device holding a pre-reset mirror can union old rows back until
 * it re-hydrates, and read-time age pruning keeps any resurrected row out
 * of the visible window.
 *
 * `cfbp_game_requests` joined this map 2026-09-12 (FEAT-2 / UN-175, DI-175d),
 * and WITHOUT IT THE FEATURE IS BROKEN IN THE QUIET WAY: a request made on
 * Kevin's phone is destroyed the next time Drew's device pushes a stale mirror
 * — the identical failure Drew reported on 2026-09-01 about feedback going
 * missing, on the identical shape (immutable rows written by six people into
 * one seam key).
 *
 * Its delete surface, CHECKED against js/storage.js rather than assumed:
 *   - there is NO per-row delete. A withdrawal is an APPENDED 'withdraw'
 *     tombstone row, so the union cannot resurrect the inverse of a deletion
 *     the way it could for `cfbp_comments` above.
 *   - there is NO per-row field mutation. Every mutable property (withdrawn /
 *     onSlate / missed / passed) is DERIVED at read time by
 *     foldGameRequests(), which returns copies and never rewrites an input row
 *     — so there is no local field flip for this union to silently revert.
 *   - read-time retention (21 days) HIDES old rows; it never shortens the array.
 *   - the only shrinking write in the whole module is resetToDemo() — the same
 *     accepted residual as cfbp_feedback above, and for the same reason: a
 *     factory reset is rare, visible and repeatable; silently eating six
 *     players' requests is none of those.
 */
const _APPEND_ONLY_ID = { cfbp_feedback: 'id', cfbp_notifications: 'id', cfbp_game_requests: 'id' };
function _unionById(local, remote, idField) {
  if (!Array.isArray(local) || !Array.isArray(remote)) return local;
  const seen = new Set();
  const out = [];
  remote.forEach(r => {
    if (_isPlainObject(r) && r[idField] != null) seen.add(r[idField]);
    out.push(r);
  });
  local.forEach(l => {
    const id = _isPlainObject(l) ? l[idField] : null;
    if (id != null && seen.has(id)) return;
    if (id != null) seen.add(id);
    out.push(l);
  });
  return out;
}
/**
 * Test-only seam, LOAD-BEARING for the same reason `_shrinksForTest` is (RG-27):
 * a source-text match cannot tell a working union from a gutted one. Verified by
 * mutation 2026-09-02 — replacing the body with `return local` leaves the name,
 * the export, the call site and this comment intact and destroys the protection.
 */
export function _unionByIdForTest(local, remote, idField) { return _unionById(local, remote, idField); }

const _listeners = new Set();  // status change subscribers

// Sync observability — exposed via getSyncStatus() so the UI can render a
// human-readable "synced 12s ago" / "3 pending writes" / "last error: …" panel.
let _lastSyncAt = null;        // ISO timestamp of last successful push or pull
let _lastError = null;         // last error message or null

export function getSyncStatus() {
  return {
    ready: _ready,
    configured: !!(getBackendConfig() && getBackendConfig().url),
    lastSyncAt: _lastSyncAt,
    lastError: _lastError,
    pendingWrites: _dirty.size,
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Load deployed config from `config.json` next to the published site.
 * This is the "Option A" auto-connect path — the commissioner sets the URL +
 * token ONCE in config.json before deploying, and every device that opens
 * the site picks it up automatically. No per-device setup, no Commissioner
 * panel visit, no token sharing.
 *
 * Returns:
 *   { ok: true,  url, token }              — config.json exists, has values
 *   { ok: false, reason: 'missing' }       — file 404 or fetch failed
 *   { ok: false, reason: 'empty' }         — file exists but values blank
 *   { ok: false, reason: 'malformed', error } — file exists but invalid JSON
 *
 * The caller (boot in app.js) decides what to do with each outcome — typically
 * 'empty' or 'missing' → silent fall back to local mode (a fork-friendly
 * default), while real connection errors get surfaced loudly to the user.
 */
// Phase III Step 3a (DI-180f) — additive read only, no new behavior for the
// existing url/token contract. `authMode`/`supabaseUrl`/`supabaseAnonKey` are
// three more fields on the SAME config.json this function already fetches;
// this is still "reading config," not a new backend responsibility. Returned
// on EVERY branch (including the failure branches) so app.js's boot() can
// make its gate decision off one object without a second fetch or a
// null-check per branch — CONVENTIONS #10, an absent/invalid authMode reads
// as 'pins', the safe default, never as 'supabase'.
function _normalizeAuthMode(raw) {
  return (raw === 'supabase' || raw === 'prelink') ? raw : 'pins';
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase III Step 4 Part B, DI §2.7 — THE SHEETS RELAY ALLOW-LIST
// ══════════════════════════════════════════════════════════════════════════════
/**
 * `dataMode` — 'sheets' (today, and the default when the key is absent) or
 * 'supabase' (the third storage mode, js/supabase-backend.js). Read from
 * config.json on the SUCCESS branches of loadDeployedConfig() below, beside
 * `authMode`, and normalized here with the same CONVENTIONS #10 shape: anything
 * that is not literally 'supabase' is 'sheets'. The key is DELIBERATELY ABSENT
 * from the shipped config.json — absent means 'sheets', which is what every
 * device does today, and DI §8.1 step 3 sets it in the same commit as
 * `authMode` at cutover, never alone.
 *
 * The name is `dataMode` and not the assessment's `storageMode` because
 * `storageMode` is already a legacy `cfbp_settings` field the projection strips
 * as a credential (supabase-projection.js:261-270) — reusing it would make a
 * grep ambiguous (DI §1.4).
 */
function _normalizeDataMode(raw) {
  return raw === 'supabase' ? 'supabase' : 'sheets';
}

/**
 * The module's live answer to "is this league's data on Supabase?".
 *
 * NOT read off getBackendConfig(): that object is the url/token pair and it is
 * persisted to localStorage, so a cutover-era value could be read back on a
 * device whose config.json has since been rolled back. This is set once per
 * page, by js/auth.js's configureAuth(), from the config read that actually
 * happened — and it defaults to 'sheets', which is the flag-off world.
 *
 * js/auth.js already imports this module (auth.js:31); this module imports
 * nothing of auth.js's, so there is no cycle and no second config fetch.
 */
let _dataMode = 'sheets';
export function getDataMode() { return _dataMode; }
export function setDataMode(mode) { _dataMode = _normalizeDataMode(mode); return _dataMode; }

/**
 * DI §2.7 — every relay below carries the PRODUCTION league's token to the
 * PRODUCTION league's Sheet, and several of them READ league data server-side
 * (`scribeAsk` assembles context out of CFBP_STORE). A test league running on
 * Supabase that reaches any of them is a cross-league bleed — the SEC F1
 * stranger-as-commissioner class, one layer over.
 *
 * So in `dataMode:'supabase'` call() refuses every action except these two
 * (Drew decision D-4):
 *   • `ping`       the Comm -> Settings connection test. Reads and writes
 *                  nothing; its whole job is to answer "is the Sheet reachable".
 *   • `notifyPush` OneSignal delivery is league-agnostic: `external_id` is the
 *                  member id, unique across leagues by construction
 *                  (`p1…p6` in IRB, `p_<ts>_<rand>` elsewhere, 0003:74-113),
 *                  and the `dedupKey` embeds the league-unique `weekId`.
 *
 * A FROZEN ARRAY, not a Set — the same lesson supabase-backend.js:110-131
 * wrote up at the seventh gate. A Set's contents live in internal slots, so
 * `Object.freeze(new Set([...]))` leaves `add()` fully working and
 * `Set.prototype.add.call(s, 'runTrainer')` walks past any own-property stub.
 * An array's elements ARE properties, so freeze reaches all of them and
 * `Array.prototype.push.call(arr, x)` throws in strict mode (ES modules always
 * are). `.includes()` on a two-element list, a handful of times per session, is
 * not a trade worth thinking about.
 */
const SHEETS_RELAY_ALLOWLIST = Object.freeze(['ping', 'notifyPush']);
/** Test-only read — never mutated, and a copy so a caller cannot reach the
 *  frozen original by reference either. */
export function _sheetsRelayAllowlistForTest() { return [...SHEETS_RELAY_ALLOWLIST]; }

/**
 * A relay this build DELIBERATELY refuses, typed so callers can tell it from a
 * network failure. `code` is the stable string (the same shape auth.js:50-67
 * and supabase-backend.js:75-85 established); every caller of a relay already
 * wraps in try/catch (backend.js:1104-1113 documents that), so the degraded
 * behaviour is the one they already have — canned scribeLines, a Comm -> Data
 * toast — rather than a new failure path.
 *
 * `action` is an INTERNAL action name from this module's own call sites, never
 * user data; the banner copy in app.js still escapes it, because "it happens to
 * be safe today" is not a rendering rule.
 */
export class SheetsRelayRefusedError extends Error {
  constructor(action) {
    super(`Refusing to send "${action}" to the Google Sheet: this league's data lives in Supabase, `
      + 'and that relay would read or write the other league\'s Sheet. Nothing was sent.');
    this.name = 'SheetsRelayRefusedError';
    this.code = 'sheets_relay_refused';
    this.action = String(action || '');
    /** Marks this as an EXPECTED, designed refusal rather than an outage —
     *  the same flag chatTransport.js's ChatTransportUnavailableError carries
     *  (chatTransport.js:103) and for the same reason: the sync badge must not
     *  go red because a feature that is scheduled for Step 6 is off. */
    this.interlocked = true;
  }
}

/**
 * SEC F1-R1 — `authModeKnown` IS THE FINDING.
 *
 * Both failure branches below used to return a hardcoded `authMode:'pins'`.
 * That is a config read ANSWERING a question it could not ask: an offline cold
 * boot, a Pages 5xx, a service-worker 503 or a captive portal would all report
 * "this league is on PINs" with the same confidence as a config.json that
 * actually says so. After cutover that downgrade is a privilege escalation —
 * pins mode makes storage.getSession() read `cfbp_session` again, which on a
 * pre-cutover device may still say `isAdmin:true`, on a device where
 * `cfbp_site_unlocked` is already set.
 *
 * So the failure branches no longer carry an authMode at all; they carry
 * `authModeKnown:false`, and app.js's boot() decides (js/app.js
 * resolveEffectiveAuthMode(): keep the last-known-good mode, and if there is
 * none, behave exactly as today). `authModeKnown:true` on the success branches
 * so the flag is explicit in both directions rather than inferred from the
 * absence of a key.
 *
 * Unchanged for every existing consumer of ok/url/token/reason.
 */
export async function loadDeployedConfig() {
  try {
    // Cache-bust on every load so a fresh deploy is picked up immediately
    const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: 'missing', authModeKnown: false };
    const data = await res.json();
    const url = (data?.backendUrl || '').trim();
    const token = (data?.backendToken || '').trim();
    const authMode = _normalizeAuthMode(data?.authMode);
    // DI §1.4 — carried on the SUCCESS branches only, exactly like authMode.
    // The failure branches deliberately carry neither (SEC F1-R1: a config read
    // that could not happen must not ANSWER a question it could not ask), and
    // js/auth.js's configureAuth() keeps the last successfully-established mode.
    const dataMode = _normalizeDataMode(data?.dataMode);
    const supabaseUrl = (data?.supabaseUrl || '').trim();
    const supabaseAnonKey = (data?.supabaseAnonKey || '').trim();
    if (!url || !token) return { ok: false, reason: 'empty', authMode, dataMode, authModeKnown: true, supabaseUrl, supabaseAnonKey };
    return { ok: true, url, token, authMode, dataMode, authModeKnown: true, supabaseUrl, supabaseAnonKey };
  } catch (err) {
    return { ok: false, reason: 'malformed', error: String(err.message || err), authModeKnown: false };
  }
}

export function getBackendConfig() {
  if (_config) return _config;
  try { _config = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); }
  catch { _config = null; }
  return _config;
}
/**
 * SEC F-1 (2026-09-17) — THE DEVICE WRITE MAY NOT ABORT THE CALLER.
 *
 * These two used to write localStorage unguarded, and boot() calls
 * setBackendConfig() (js/app.js, right after loadDeployedConfig()) with no
 * enclosing try — ABOVE resolveEffectiveAuthMode() and every fail-closed auth
 * branch. On a device whose storage rejects writes (quota exhausted; private
 * mode on some browsers) boot() rejected at that line and nothing below it
 * ran: with the flag off, a dead boot and not even a banner (an AD-06
 * loud-fail violation by omission); after cut-over, the app left in the
 * default 'pins' mode with a possibly stale PIN-era session and no gate.
 *
 * So the persistence is now best-effort and the in-memory `_config` — which is
 * what every read in THIS page actually uses (see getBackendConfig()) — is set
 * either way. That is deliberately NOT a silent localStorage fallback in the
 * AD-06 sense: sync is unaffected this session (the config is in memory and
 * hydrate runs from it), so the proportionate report is one console warning,
 * not a red banner. The only cost is that the config has to be re-read from
 * config.json on the next open, which every boot does anyway.
 *
 * Neither the token nor the URL is ever logged; only the error's name.
 */
function _persistConfig(payload) {
  try {
    if (payload === null) localStorage.removeItem(CFG_KEY);
    else localStorage.setItem(CFG_KEY, payload);
    return true;
  } catch (e) {
    console.warn(`[backend] backend config could not be ${payload === null ? 'cleared on' : 'saved to'} this device (${e && e.name || 'storage error'}); this session runs from memory.`);
    return false;
  }
}
/**
 * @returns {{url:string, token:string, persisted:boolean}} a COPY of the
 * in-memory config (always set) plus whether it also reached the device.
 * `persisted` is on the returned copy only — never in the stored payload.
 */
export function setBackendConfig(url, token) {
  _config = { url: (url || '').trim().replace(/\/$/, ''), token: (token || '').trim() };
  const persisted = _persistConfig(JSON.stringify(_config));
  return { ..._config, persisted };
}
/** @returns {boolean} true when the key is really gone from the device. */
export function clearBackendConfig() {
  _config = null;
  return _persistConfig(null);
}
export function isBackendConfigured() {
  const c = getBackendConfig();
  return !!(c && c.url && c.token);
}
export function isBackendReady() { return _ready; }

export function isMirrorStale() { return _stale; }

/**
 * Synchronously load the last-known snapshot into the in-memory cache.
 * Returns the number of keys primed (0 = no mirror; caller must await hydrate
 * before rendering league data). Marks the backend "ready but stale".
 */
export function primeFromMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return 0;
    const snap = JSON.parse(raw);
    if (!snap || typeof snap.data !== 'object') return 0;
    _cache.clear();
    Object.entries(snap.data).forEach(([k, v]) => _cache.set(k, v));
    _ready = true;
    _stale = true;
    _lastSyncAt = snap.at || null;
    return _cache.size;
  } catch (e) {
    console.warn('[backend] mirror unreadable, ignoring', e);
    return 0;
  }
}

function persistMirror() {
  try {
    const data = {};
    _cache.forEach((v, k) => { data[k] = v; });
    localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: new Date().toISOString(), data }));
  } catch (e) { console.warn('[backend] mirror persist failed', e); }
}

export function clearMirror() { try { localStorage.removeItem(MIRROR_KEY); } catch {} }

// ── Status events (so the UI can show a sync indicator) ────────────────────────
export function onBackendStatus(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function emit(status, detail) { _listeners.forEach(fn => { try { fn(status, detail); } catch {} }); }

// ── Low-level transport ─────────────────────────────────────────────────────

/**
 * BUG-A (2026-09-11) — MISROUTE DETECTION: a 200/ok reply that does not belong
 * to the request that was sent.
 *
 * `backend/Code.gs` `handle()` opened with `var action = req.action || 'ping'`.
 * A request arriving with NO action was therefore answered with the PING
 * payload — HTTP 200, `{ok:true, time, service:'cfbp-backend', version:2}` —
 * whatever the client had actually asked for. Two paths deliver an action-less
 * request, BOTH reproduced against the live /exec URL on 2026-09-11:
 *   - doPost receives an empty `postData.contents` (observed correlating with
 *     Apps Script cold start);
 *   - a POST that Apps Script 302-redirects arrives at doGet as a GET with no
 *     body and no `action` param.
 *
 * `call()` below only asked `if (!data.ok) throw`. A ping payload IS ok, so
 * EVERY caller read a misrouted reply as a successful reply to its own action:
 *   getAll     → no `data` → hydrate()'s RG-12 guard fires → "Sync refused…",
 *                a guard doing its job while describing the wrong problem;
 *   scribeAsk  → no responseMessageId → the canned-line degrade;
 *   runTrainer → no `skipped` → app.js toasts success for a run that never ran;
 *   set/setMany/chatAppend/notifyPush → a write that NEVER REACHED THE SERVER
 *                reported as synced. That last one is the dangerous one, and
 *                it is the one nobody could report, because it is invisible.
 *
 * A misroute is detected three ways, newest deployment first:
 *   (a) `misrouted:true`        — the fixed Code.gs says so outright;
 *   (b) `_action` echo mismatch — the fixed Code.gs echoes, under a RESERVED
 *       name, the action it ran. Underscored deliberately (review finding 2,
 *       2026-09-11): the echo is transport metadata, not payload. On the plain
 *       name, the first handler to return a top-level `action` of its own —
 *       entirely reasonable, nothing here forbids it — would have its correct
 *       reply read as a misroute, retried, and then thrown at the player as a
 *       sync failure;
 *   (c) `service:'cfbp-backend'` on a non-ping action — the ping marker. This
 *       is the ONLY signal available against a deployment that predates the
 *       Code.gs fix, i.e. the server in production right now, which is why the
 *       client fix ships independently of the redeploy. Do not delete (c)
 *       afterwards either: a browser holding cached JS (RG-04) can be talking
 *       to a deployment older than itself in either direction.
 */
const PING_MARKER = 'cfbp-backend';

/**
 * Backoff for a misrouted reply. Short on purpose — the observed window is the
 * first handful of requests after an Apps Script cold start, and the caller is
 * usually a human waiting on a tap.
 */
const MISROUTE_RETRY_DELAYS = [400, 1200];   // up to 3 attempts total

/**
 * Actions that are NEVER retried automatically, even though the evidence says a
 * misrouted request never reached the dispatcher at all.
 *
 * Retry safety was CHECKED, not assumed, for every other action:
 *   getAll/get/chatHead/chatSince/chatBefore/chatMetrics/listSnapshots/
 *   notifyLog/ping  reads, no side effect;
 *   set/setMany     last-write-wins on the identical payload (Code.gs setOne/
 *                   setMany) — re-sending is a no-op;
 *   chatAppend      id-deduped server-side (Code.gs chatAppend → knownIds() over
 *                   the last 2000 events + idSeqFullScan fallback), which is
 *                   exactly what makes the chat log append-only and
 *                   order-independent (AD-09/AD-10);
 *   notifyPush      dedupKey-deduped server-side (Code.gs notifyPush →
 *                   dedupKeyAlreadySent) so a duplicate relay cannot double-push;
 *   snapshot/restoreSnapshot  a duplicate backup row is harmless, and a backup
 *                   the commissioner THINKS was taken is not.
 *
 * `scribeAsk` and `runTrainer` are different in kind: each spends real money at
 * Anthropic. The misroute evidence is strong but not a proof, and the cost of
 * being wrong is an unasked-for charge, so these two throw on the FIRST
 * misroute and let the paths that already exist handle it — scribeLines.js's
 * mention branch degrades to canned lines (C1: one fallback mechanism, not
 * two), app.js's Comm→Data handler toasts `err.message`. Both now name
 * misrouting instead of blaming sync.
 */
const NO_RETRY_ACTIONS = { scribeAsk: 1, runTrainer: 1, scribeAutonomous: 1, scribeClassify: 1 };   // Build 3 pass 1: both spend money — one attempt only

/**
 * True when `data` is a reply to some OTHER request than `action`.
 * Exported because js/chatTransport.js has its own fetch path and must apply
 * the identical rule — one definition, so the two cannot drift. This is a pure
 * predicate; AD-16 (chatTransport is the only module touching the chat backend)
 * is untouched, no URL, sheet name or polling mechanic crosses the seam.
 */
export function isMisroutedResponse(action, data) {
  if (!data || typeof data !== 'object') return false;
  if (data.misrouted === true) return true;                              // (a)
  if (typeof data._action === 'string' && data._action) return data._action !== action;  // (b)
  if (action === 'ping') return false;             // ping's own payload, legitimately
  return data.service === PING_MARKER;                                   // (c)
}

function misrouteError(action) {
  const err = new Error(
    'Backend misrouted the request (empty action) — retry in a moment. ' +
    `The server answered '${action}' with its health-check payload, which means the ` +
    'request never reached the dispatcher: nothing was read, written or spent.'
  );
  err.misrouted = true;
  err.action = action;
  return err;
}

/**
 * BUG-E (2026-09-11) — TRANSIENT HTTP, the misroute's twin.
 *
 * Drew, same day, same live site: a **404** on a request that had already
 * completed server-side. Apps Script answers a POST with a 302 to a
 * `googleusercontent.com` URL and the client follows it; that second leg is a
 * different host on a different edge and it can 404, 500 or 503 on its own,
 * with the real work already done. `call()` and chatTransport's get()/post()
 * both did `if (!res.ok) throw new Error('HTTP ' + res.status)` — straight past
 * the guard, out to the caller. At boot that single flake is a red sync banner
 * (getAll) or a dead first chat tick, and BUG-F showed what a dead first chat
 * tick used to cost: up to 68 seconds of blank room.
 *
 * Retried on the SAME schedule as a misroute, for the same reason and with the
 * same safety analysis: a misroute means the action never ran, and a transient
 * status on the redirect leg means we cannot tell whether it ran — which is why
 * the retry-safety audit above (reads have no side effect; set/setMany are
 * last-write-wins on an identical payload; chatAppend is id-deduped;
 * notifyPush is dedupKey-deduped; a duplicate snapshot row is harmless) is what
 * this leans on, unchanged. `NO_RETRY_ACTIONS` is honoured identically —
 * scribeAsk and runTrainer spend real money and get exactly one attempt.
 *
 * Only statuses that can mean "try again" are retried. A 400/401/403 is a real,
 * permanent answer about THIS request (bad token, bad payload) and retrying it
 * three times only delays the honest error.
 */
// RG-99 F3 (reviewer, 2026-09-11): 429 is deliberately NOT in this set. An
// Apps Script 429 means "over a per-user quota"; retrying it at 400/1200ms is
// the one case where a fast retry makes things worse. It fails loud instead.
const TRANSIENT_HTTP = new Set([404, 408, 425, 500, 502, 503, 504]);

/** The transient HTTP status carried by `err`, or 0. Reads `err.status` (set at
 *  the throw sites here and in chatTransport) and falls back to the message
 *  text, so a caller that only has the string still classifies correctly. */
export function transientHttpStatus(err) {
  let n = Number(err?.status || 0);
  if (!n) { const m = /^HTTP (\d{3})/.exec(String(err?.message || '')); if (m) n = Number(m[1]); }
  return TRANSIENT_HTTP.has(n) ? n : 0;
}

function transientHttpError(action, status, attempts) {
  // Message keeps the `HTTP <status>` prefix the old error had — it is what
  // makes the failure diagnosable at a glance, and anything matching on it
  // keeps working — then says what was already tried, so a player reading the
  // red banner is not told to "retry in a moment" by code that just did.
  // `attempts === 1` is the NO_RETRY_ACTIONS path (scribeAsk/runTrainer), which
  // gets exactly one try on purpose — the copy must not imply we kept trying.
  const err = new Error(
    `HTTP ${status} — the backend failed '${action}'` +
    (attempts > 1 ? ` on all ${attempts} attempts. ` : '. ') +
    'Nothing was lost locally; this is usually a cold start or a dropped response.'
  );
  err.status = status;
  err.transient = true;
  err.action = action;
  return err;
}

/**
 * Run `send()` (which resolves to the parsed JSON body) and reject a misrouted
 * reply instead of handing it back as success. Retries per the rules above —
 * both for a misrouted reply and for a transient HTTP status (BUG-E).
 * Shared by call() here and by js/chatTransport.js's get()/post().
 */
export async function requestWithMisrouteGuard(action, send) {
  const delays = NO_RETRY_ACTIONS[action] ? [] : MISROUTE_RETRY_DELAYS;
  for (let attempt = 0; ; attempt++) {
    let data;
    try {
      data = await send();
    } catch (err) {
      const status = transientHttpStatus(err);
      if (!status) throw err;                                   // permanent, or not an HTTP status at all
      if (attempt >= delays.length) throw transientHttpError(action, status, attempt + 1);
      console.warn(`[backend] HTTP ${status} on '${action}' — retrying in ${delays[attempt]}ms`);
      await new Promise(r => setTimeout(r, delays[attempt]));
      continue;
    }
    if (!isMisroutedResponse(action, data)) return data;
    if (attempt >= delays.length) throw misrouteError(action);
    console.warn(`[backend] misrouted reply to '${action}' — retrying in ${delays[attempt]}ms`);
    await new Promise(r => setTimeout(r, delays[attempt]));
  }
}

async function call(action, payload = {}) {
  // ── DI §2.7 — THE ALLOW-LIST GUARD, BEFORE ANYTHING ELSE ──────────────────
  // Above getBackendConfig(), above the body construction, above every retry
  // wrapper, and therefore unambiguously BEFORE ANY fetch(). The refusal is a
  // fact about this build's data mode, not about whether a backend happens to
  // be configured, so it must not be reachable only on the configured path.
  if (_dataMode === 'supabase' && !SHEETS_RELAY_ALLOWLIST.includes(action)) {
    throw new SheetsRelayRefusedError(action);
  }
  const c = getBackendConfig();
  if (!c || !c.url) throw new Error('Backend not configured');
  const body = JSON.stringify({ action, token: c.token, ...payload });
  // BUG-A — the misroute check runs BEFORE the `!data.ok` check below, so the
  // fixed server's `{ok:false, misrouted:true}` empty-request reply is retried
  // rather than surfacing as a dead error.
  const data = await requestWithMisrouteGuard(action, async () => {
    // Apps Script web apps accept text/plain without a CORS preflight, which
    // avoids the OPTIONS request that Apps Script does not handle.
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
    });
    // BUG-E — carry the status on the error so requestWithMisrouteGuard can tell
    // a transient (retryable) status from a permanent one without parsing prose.
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.json();
  });
  if (!data.ok) throw new Error(data.error || 'Backend error');
  return data;
}

// ── Connection test ───────────────────────────────────────────────────────────
export async function pingBackend() {
  try {
    const data = await call('ping');
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// ── Hydrate the in-memory mirror from the Sheet ────────────────────────────────
export async function hydrate() {
  emit('syncing');
  try {
    const data = await call('getAll');

    // ── RG-12 DEFENSE (b), rebuilt 2026-08-12 ──────────────────────────────
    // The ledger recorded this guard as shipped in v0.17.1. It was NOT in the
    // code, and its absence let live picks be destroyed a second time.
    //
    // If the mirror currently holds substantive league data and the remote
    // returns none of it, that is far more likely a cold start, a transient
    // 200-with-empty-body, or a partial read than a genuinely emptied Sheet.
    // Preserve the mirror and fail LOUD (AD-06) rather than adopt the void —
    // because adopting it means ensureSeedData reseeds a DRAFT template and
    // flushPush sends it to every device.
    const fresh = data.data || {};
    const hadData = k => { const v = _cache.get(k); return Array.isArray(v) ? v.length > 0 : !!v; };
    const freshHas = k => { const v = fresh[k]; return Array.isArray(v) ? v.length > 0 : !!v; };
    const mirrorHadLeague = hadData('cfbp_players') || hadData('cfbp_weeks') || hadData('cfbp_picks');
    const remoteHasLeague = freshHas('cfbp_players') || freshHas('cfbp_weeks') || freshHas('cfbp_picks');
    if (mirrorHadLeague && !remoteHasLeague) {
      throw new Error(
        'Sync refused: the server returned no players, weeks or picks while this device ' +
        'still holds them. Your local data is preserved and nothing was overwritten. ' +
        'This is usually a cold start or a dropped response — retry in a moment.'
      );
    }

    // Capture any local edits made while stale (dirty keys) BEFORE clearing,
    // then re-apply them over the fresh snapshot — user intent wins for keys
    // they touched this session; everything else takes the fresh remote value.
    const localEdits = new Map();
    _dirty.forEach(k => { if (_cache.has(k)) localEdits.set(k, _cache.get(k)); });
    _cache.clear();
    Object.entries(fresh).forEach(([k, v]) => _cache.set(k, v));
    localEdits.forEach((v, k) => {
      // RG-24 — when the writer declared WHICH fields it changed, graft only
      // those onto the fresh remote value. Everything else keeps the remote
      // value, so one device's settings write can no longer revert another's.
      const fields = _dirtyFields.get(k);
      const fresh = _cache.get(k);
      if (fields instanceof Set && _isPlainObject(fresh) && _isPlainObject(v)) {
        const merged = { ...fresh };
        fields.forEach(f => {
          if (f in v) merged[f] = v[f]; else delete merged[f];
        });
        _cache.set(k, merged);
      } else if (_APPEND_ONLY_ID[k]) {
        // RG-49 — append-only log: union by id, never wholesale replace.
        _cache.set(k, _unionById(v, _cache.get(k), _APPEND_ONLY_ID[k]));
      } else if (_USER_DATA_KEYS.includes(k) && _shrinks(v, _cache.get(k))) {
        // NEW DEFENSE (c), 2026-08-12. RG-12's two guards both protect against
        // an empty REMOTE. Neither protects against a stale LOCAL that looks
        // perfectly valid — a device booting on a mirror from before the picks
        // were made holds a well-formed, populated, and completely obsolete
        // WEEKS/PICKS. Re-applying it here and pushing it is indistinguishable
        // from a legitimate edit, and it destroys everyone's data.
        //
        // A held write may ADD to user data. It may never make it smaller.
        // Deletions are rare, recoverable, and can be redone; silent mass loss
        // is neither. Keep the fresher remote and drop the stale local.
        console.warn('[backend] DROPPED a stale held write that would have shrunk', k,
          `(local ${_size(v)} -> remote ${_size(_cache.get(k))}). Remote kept.`);
        _dirty.delete(k);
        _dirtyFields.delete(k);
      } else if (_FIELD_REBASE_ID[k]) {
        // RG-39 DEFENSE (d) — same record count, missing FIELDS. See above.
        _cache.set(k, _rebaseRecords(v, _cache.get(k), _FIELD_REBASE_ID[k]));
      } else {
        _cache.set(k, v);
      }
    });
    _ready = true;
    _stale = false;
    _lastSyncAt = new Date().toISOString();
    _lastError = null;
    persistMirror();
    emit('synced', { keys: _cache.size });
    // Any held-back stale writes can now flush safely.
    if (_dirty.size) schedulePush();
    return _cache.size;
  } catch (err) {
    _lastError = String(err.message || err);
    emit('error', { error: _lastError });
    throw err;
  }
}

/**
 * Seed an EMPTY backend from a local snapshot (first-time migration).
 * Only writes keys the backend doesn't already have, unless force=true.
 */
export async function seedFromLocal(localSnapshot, force = false) {
  const remote = (await call('getAll')).data || {};
  const entries = {};
  Object.entries(localSnapshot).forEach(([k, v]) => {
    if (force || !(k in remote)) entries[k] = v;
  });
  if (Object.keys(entries).length) await call('setMany', { entries });
  return Object.keys(entries).length;
}

// ── Synchronous cache accessors (used by storage.js when in sheets mode) ───────
export function cacheGet(key) {
  return _cache.has(key) ? _cache.get(key) : null;
}
/**
 * @param {string}    key
 * @param {*}         value
 * @param {string[]=} fields  RG-24 — for a plain-object value, the fields the
 *   caller actually changed. Omitted (every caller but saveSetting) = a
 *   whole-value write, identical to the previous behaviour. A whole-value
 *   write already pending for a key is never downgraded to a field patch.
 */
export function cacheSet(key, value, fields) {
  if (_dirtyFields.get(key) === null) {
    // a whole-value write (e.g. resetToDemo) is already queued for this key —
    // it wins; a later field write cannot narrow it back down.
  } else if (Array.isArray(fields) && fields.length && _isPlainObject(value)) {
    const set = _dirtyFields.get(key) || new Set();
    fields.forEach(f => set.add(f));
    _dirtyFields.set(key, set);
  } else {
    _dirtyFields.set(key, null);
  }
  _cache.set(key, value);
  _dirty.add(key);
  schedulePush();
}

// ── Debounced background push to the Sheet ─────────────────────────────────────
function schedulePush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(flushPush, 800);
}

/**
 * RG-56 (2026-09-04) — THE BATCH IS NOT ALL-OR-NOTHING ANY MORE.
 *
 * Drew, live site, mid-week, an hour before a pick deadline: "I cleared the
 * pool, am still getting the red banner. This is a big issue if it wont sync
 * because it will not be usable and will not be able to receive picks from the
 * last person before the deadline."
 *
 * One app storage key is ONE Google Sheets cell, and Sheets caps a cell at
 * 50,000 characters. `backend/Code.gs` `setMany()` walks `Object.keys(entries)`
 * writing each in turn with NO chunking and NO size check; an over-cap value
 * makes Apps Script throw, `handle()`'s catch returns `{ok:false}` for the WHOLE
 * request, and the keys ordered after the offender never write. The catch below
 * then re-queued every key in the batch, so the identical doomed batch was
 * retried on every subsequent write — indefinitely. On the commissioner's
 * device that put the slate, the week status and his own picks permanently
 * behind `cfbp_avail_games`, a scratch pad of third-party ESPN rows.
 *
 * Two things follow, and they are separate fixes:
 *   - The pool should never have been in the batch. That is storage.js's
 *     DEVICE_LOCAL_KEYS, and it removes today's trigger.
 *   - A single unstorable value must never again take irreplaceable user data
 *     down with it. That is this guard, and it is the one that matters, because
 *     the trigger is not unique to the pool: at a MEASURED 238 chars a pick and
 *     60 picks a week, `cfbp_picks` crosses the same cap around WEEK 3, and
 *     `cfbp_games` (942 chars a game) around week 5. Both are keys we cannot make device-local.
 *
 * So: measure each value the way Code.gs will, hold back anything it provably
 * cannot store, send the rest, and fail LOUD (AD-06) with the offending key
 * NAMED in the banner. Held-back keys stay dirty — quarantined, never dropped —
 * so they go the moment they fit again. The alternative (send it anyway and let
 * the Sheet refuse) is what produced the outage.
 *
 * UPDATE 2026-09-05 (Item CAP) — THE REAL FIX NOW EXISTS. backend/Code.gs chunks
 * a single over-cap value transparently across as many 50,000-char cells as it
 * needs and reassembles it on read, so a value larger than one cell is no longer
 * unstorable. The 50,000-char PER-CELL limit therefore stopped being the binding
 * constraint on a single app key. This constant is repurposed (name kept for
 * continuity — pushtest and the banner text reference it): it is no longer the
 * Sheets cell cap, it is a TOTAL-PAYLOAD RUNAWAY TRIPWIRE on one key.
 *
 * ┌─ DEPLOY ORDER — READ THIS BEFORE SHIPPING ────────────────────────────────┐
 * │ This raised ceiling is ONLY safe once Code.gs's chunking is DEPLOYED and   │
 * │ CONFIRMED live on the same backend this client talks to. Ship the raised   │
 * │ client cap against an OLD, non-chunking Code.gs and you reproduce the      │
 * │ RG-56 outage EXACTLY: the client stops quarantining the over-cap picks,    │
 * │ sends them, the old server throws on the over-cap cell, handle() returns   │
 * │ {ok:false} for the WHOLE batch, and picks + slate + week status all fail   │
 * │ behind one value — mid-season, an hour before a deadline. Correct order:   │
 * │   (1) deploy Code.gs chunking and CONFIRM it (see captest.mjs/chunkstore); │
 * │   (2) THEN ship this raised cap. Never the reverse.                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * WHY 2,000,000, and why a ceiling still exists at all:
 *   - The RG-56 loud-fail quarantine must SURVIVE. A value a bug has let run
 *     away (an unbounded append, a serialization loop) must still fail loud and
 *     be held back rather than shipped. Removing the guard, not raising it, is
 *     what would be dangerous.
 *   - The number sits far above any LEGITIMATE single-key payload: a full
 *     15-week season of cfbp_picks measures ~214,111 chars (pushtest [8], via the
 *     real createPick path). 2,000,000 is ~9x that — comfortable headroom for
 *     more players, more games a week, and record-shape growth — while a
 *     multi-MB single key can only be a defect.
 *   - It is a per-KEY tripwire, NOT a target. The Google Sheet has a finite
 *     per-spreadsheet cell budget, and chunking a value spends MORE cells, not
 *     fewer, so a runaway is doubly expensive. This ceiling is a smoke alarm,
 *     not a storage quota to fill.
 */
export const SHEET_CELL_MAX = 2000000;

/**
 * Exactly what `Code.gs` computes: `JSON.stringify(entries[key]).length`.
 * Returns 0 for a value JSON cannot represent (stringify yields undefined) —
 * such a value never reaches the Sheet as text at all, so it cannot overflow a
 * cell, and measuring it as over-cap would quarantine it forever.
 *
 * Test-only seam, LOAD-BEARING for the reason `_shrinksForTest` documents
 * (RG-27): a source-text match cannot tell a working size check from a gutted
 * one. Mutation-verified 2026-09-04 — replacing the body with `return 0`
 * leaves the name, the export, the call site and this comment intact and
 * destroys the protection; pushtest [5] goes red.
 */
export function cellChars(value) {
  const s = JSON.stringify(value);
  return typeof s === 'string' ? s.length : 0;
}

export async function flushPush() {
  if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
  if (!_dirty.size) return { pushed: 0 };
  // HOLD writes while serving stale mirror data — pushing a full blob based on
  // a stale snapshot could clobber fresher remote data. Dirty keys stay queued
  // and are rebased + flushed automatically when hydrate() lands.
  if (_stale) return { pushed: 0, held: true };
  // If the backend isn't configured (e.g. user disconnected mid-session), keep
  // the dirty set for later and bail quietly instead of throwing.
  const c = getBackendConfig();
  if (!c || !c.url) return { pushed: 0, skipped: true };
  const entries = {};
  _dirty.forEach(k => { entries[k] = _cache.has(k) ? _cache.get(k) : null; });
  // RG-24 — the field list describes writes that have NOT yet reached the
  // Sheet. Keep a copy so a failed push can restore it along with _dirty;
  // losing it would silently downgrade the retry's rebase to whole-value.
  const sentFields = new Map(_dirtyFields);
  _dirty.clear();
  _dirtyFields.clear();

  // RG-56 / Item CAP — quarantine anything so large it can only be a runaway,
  // BEFORE the call, so it cannot fail the batch that carries the picks. Since
  // 2026-09-05 SHEET_CELL_MAX is a TOTAL-PAYLOAD tripwire (2,000,000), NOT the
  // 50,000-char Sheets per-cell limit: Code.gs now chunks a single over-cap value
  // across cells, so ordinary large keys (season-scale cfbp_picks, ~214k) are
  // SENT and chunked server-side, not held back. DEPLOY ORDER (see SHEET_CELL_MAX
  // above): this only holds while the LIVE Code.gs actually chunks — against an
  // old non-chunking backend an over-cap value sent here throws server-side and
  // fails the whole batch (the RG-56 outage). Confirm chunking is live first.
  const oversize = [];
  for (const k of Object.keys(entries)) {
    const chars = cellChars(entries[k]);
    if (chars > SHEET_CELL_MAX) { oversize.push({ key: k, chars }); delete entries[k]; }
  }
  /** Put keys back in the queue, restoring RG-24's field list with them. */
  const requeue = keys => keys.forEach(k => {
    _dirty.add(k);
    if (!_dirtyFields.has(k) && sentFields.has(k)) _dirtyFields.set(k, sentFields.get(k));
  });
  const sendable = Object.keys(entries);

  emit('syncing');
  try {
    // Skip the round trip when the whole batch was quarantined — there is
    // nothing to write, and an empty setMany would report a false success.
    // `_lastSyncAt` moves only when something actually reached the Sheet, so
    // the status panel can never read "synced just now" off a push that sent
    // nothing.
    //
    // persistMirror() runs either way, but be precise about what that buys: the
    // mirror holds the held-back value, so primeFromMirror() shows it after a
    // reload — and then the NEXT hydrate() clears _cache, re-applies the remote,
    // and the value is gone, because _dirty is RAM-only so the key is not in
    // localEdits. Worse, that hydrate emits 'synced', which CLEARS the red
    // banner. At week 3 the key is cfbp_picks and the sequence reads: banner
    // names the problem -> player reloads -> picks render for a moment -> picks
    // vanish -> no banner. This does NOT make a held write survive a reload.
    // Ledger section 6 tracks that (held writes are memory-only); it is not
    // solved here and this comment must not imply it is.
    if (sendable.length) {
      await call('setMany', { entries });
      _lastSyncAt = new Date().toISOString();
    }
    persistMirror();
  } catch (err) {
    // Re-mark dirty so a later push retries — including the quarantined keys,
    // which are still unsent.
    requeue(sendable);
    requeue(oversize.map(o => o.key));
    _lastError = String(err.message || err);
    emit('error', { error: _lastError });
    throw err;
  }

  if (oversize.length) {
    requeue(oversize.map(o => o.key));
    _lastError =
      'Too large to sync (runaway value over the safety ceiling), held back and NOT synced: ' +
      oversize.map(o => `${o.key} (${o.chars.toLocaleString()} chars, limit ${SHEET_CELL_MAX.toLocaleString()})`).join('; ') +
      // Only true when something was actually sent. With the whole batch
      // quarantined, sendable.length is 0, no round trip happens, and NOTHING
      // synced — the banner is the only diagnostic anyone reads, so it must not
      // claim otherwise.
      (sendable.length ? '. Everything else in this batch did sync.' : '. Nothing in this batch synced.');
    console.warn('[backend] RG-56 quarantine —', _lastError);
    // LOUD (AD-06): the banner stays up while any key is unsyncable, and it
    // names the key so the next person does not have to guess which one.
    emit('error', { error: _lastError });
    return { pushed: sendable.length, oversize };
  }

  _lastError = null;
  emit('synced', { pushed: sendable.length });
  return { pushed: sendable.length };
}

// ── Manual full refresh (pull) ─────────────────────────────────────────────────
export async function refreshFromBackend() { return hydrate(); }

// ── Season snapshots / backups ─────────────────────────────────────────────────
export async function createSnapshot(label = '') { return call('snapshot', { label }); }
export async function listSnapshots() { return (await call('listSnapshots')).snapshots || []; }
export async function restoreSnapshot(id) { const r = await call('restoreSnapshot', { id }); await hydrate(); return r; }


// ── Chat transport (v0.16.0) ───────────────────────────────────────────────────
// The chat log does NOT ride the debounced blob push — it has its own
// append + incremental-fetch endpoints so six concurrent authors can never
// clobber each other (append-only, server-assigned seq, id-level dedupe).

export async function chatAppendRemote(events) {
  const r = await call('chatAppend', { events });
  return { assigned: r.assigned || [], head: r.head ?? 0 };
}
export async function chatSinceRemote(afterSeq, limit = 500) {
  const r = await call('chatSince', { seq: afterSeq, limit });
  return { events: r.events || [], head: r.head ?? 0 };
}
export async function chatBeforeRemote(beforeSeq, limit = 100) {
  const r = await call('chatBefore', { seq: beforeSeq, limit });
  return { events: r.events || [], head: r.head ?? 0 };
}

// ── Push-notification relay (Groups A/B, 2026-09-10) ───────────────────────────
// notifyPush is a client → server relay for IMMEDIATE lifecycle events (chat
// message, picks opened/locked, results finalized, obligations, commissioner
// announcements). It never sends the push itself — js/notifications.js builds
// the notification record and Code.gs holds the OneSignal REST key, making the
// one batched UrlFetchApp call server-side (see backend/Code.gs and
// DESIGN_INPUTS_BATCH1_091026.md §4/§5). Scheduled reminders (24h/1h/15m
// before lock, "locking soon") are NOT sent through this path — those are
// entirely server-side (Code.gs's `scanReminders` time trigger), the same
// immediate-vs-scheduled split chat's own append/fetch functions model above.
export async function notifyPushRelay({ dedupKey, playerIds, title, body, destination, event }) {
  return call('notifyPush', { dedupKey, playerIds, title, body, destination, event });
}

// ── Server-fired notifyLog read (F2, 2026-09-10 remediation) ───────────────
// PICKS_REMINDER/PICKS_LOCKING_SOON fire ENTIRELY server-side (Code.gs's
// scanReminders trigger) and were previously push-only, with no persistent
// record for anyone who didn't have push granted or had the app closed when
// it arrived. CFBP_NOTIFY_LOG (Code.gs) is the server's OWN append-only
// record of those two events; this is a READ of it — never written back to
// cfbp_notifications (RG-49 clobber class). js/notifications.js folds the
// result into a separate, device-local cache (see that file's header note).
// `afterSeq` is CFBP_NOTIFY_LOG's own row-index cursor (same "contiguous row
// = seq" trick chat's msgHead uses) — 0 fetches the player's full log.
export async function notifyLogFetch(playerId, afterSeq = 0) {
  if (!isBackendConfigured()) return { records: [], head: afterSeq };
  const r = await call('notifyLog', { playerId, afterSeq });
  return { records: r.records || [], head: r.head ?? afterSeq };
}

// ── Interactive SCRIBE relay (Build 2, Group C, 2026-09-10, UN-150…154) ────
// `scribeAsk` is the ONE new action for the LLM-backed @SCRIBE runtime. The
// entire tool-use loop (context assembly, league/sports tools, the Anthropic
// call itself) runs server-side inside Code.gs — this is a thin relay, same
// shape as notifyPushRelay above. `call()`'s existing contract governs: a
// normal DEGRADE outcome (throttled/budget-capped/disabled) is `{ok:true,
// ...}` and returns normally; only a genuine server-side error/unreachable
// backend throws, which js/scribeLines.js's mention branch treats as the
// SAME degrade path as a throttle (C1: "one fallback mechanism, not two").
export async function scribeAskRemote({ triggerMessageId, playerId, weekId = '', gameTag = '', webSearch }) {
  return call('scribeAsk', { triggerMessageId, playerId, weekId, gameTag, webSearch });
}

// ── SCRIBE Trainer relay (Build 2b, Group E, 2026-09-10, UN-161…163) ───────
// Thin trigger, same shape as `createSnapshot`/`restoreSnapshot` above. The
// entire analysis pass, model call, and persistence to
// KEYS.SCRIBE_LEARNINGS/CANON/REPORTS happen server-side; the caller
// (js/scribeAgent.js) re-hydrates afterward to see the result, exactly like
// `restoreSnapshot()` already does.
//
// Round-2 remediation (reviewer SIGNIFICANT #8) — the shared backend token
// is NOT sufficient for this action. It ships in `config.json` on every
// player's device (AD-05), and `runTrainer` spends real money at Anthropic.
// The server now additionally requires the commissioner password hash, the
// same `btoa(password)` credential app.js already checks before destructive
// commissioner actions. `adminPasswordHash` is supplied by the caller (the
// Comm→Data button prompts for it).
//
// CORRECTED round 3 — this comment used to claim a missing/incorrect
// credential "returns `{ok:false, error}` rather than throwing here." It does
// not. The server returns `{ok:false, error}`, and `call()` above turns any
// `!data.ok` body into `throw new Error(data.error)` (see the `if (!data.ok)`
// line in `call()`), so the REJECTION reaches the caller as a thrown Error,
// not a resolved value. The behaviour is correct and unchanged — app.js's
// Comm→Data handler wraps this in try/catch and surfaces `err.message` in
// the failure toast — only the comment was wrong. Callers must keep the
// try/catch; do not write `if (!result.ok)` and expect it to fire.
export async function runTrainerRemote({ adminPasswordHash = '' } = {}) {
  return call('runTrainer', { adminPasswordHash });
}

// ── Build 3, Group D (2026-09-11) — the two D1 relays ─────────────────────
// Same shape as scribeAskRemote/runTrainerRemote: thin, paid, one attempt
// (NO_RETRY_ACTIONS). The gate chain (kill switch, threshold re-check,
// budget, hourly bucket, consecutive-post guard, deterministic id) is
// entirely server-side in Code.gs's scribeAutonomous / scribeClassify.
export async function scribeAutonomousRemote({ trigger, subject = '', evidence = {}, playerId = '' } = {}) {
  return call('scribeAutonomous', { trigger, subject, evidence, playerId });
}
export async function scribeClassifyRemote({ messageId } = {}) {
  return call('scribeClassify', { messageId });
}

// ── Build 3, Group D pass 2 (2026-09-11) — the four SCRIBE-memory relays ──
//
// Same thin shape as scribeAskRemote / scribeAutonomousRemote above: every
// decision (ownership, kind restrictions, provenance forcing, true row
// delete, the approved-fact sweep) lives server-side in backend/Code.gs.
// This file only knows the action names and the body shape.
//
// DELIBERATELY NOT on NO_RETRY_ACTIONS — unlike scribeAsk/runTrainer/
// scribeAutonomous/scribeClassify, none of these four spends a cent at
// Anthropic, and each is safe to repeat:
//   scribeMemoryList    a read, no side effect;
//   scribeMemoryUpsert  server-deduped on (playerId, kind, key) — a repeat
//                       rewrites the same row rather than appending a second;
//   scribeMemoryDelete  keyed on the row id — a repeat answers
//                       {deleted:false, reason:'not_found'};
//   scribeMemorySync    idempotent by construction (an applied fact row is
//                       stamped `memoryAppliedAt`; a second sync reports 0).
// So they inherit `call()`'s ordinary misroute/transient-HTTP retry, which
// is what a flaky Apps Script redirect leg (BUG-E) needs.
//
// EVERY call passes the CURRENT player's `playerId`. The server treats it as
// the REQUESTER (scribeMemoryOwnershipOk_) and narrows or refuses anything
// that is not about him — best-effort in exactly the sense Code.gs's own
// comment states, since a PIN-gated app has no authenticated identity.
// Commissioner-scoped actions (scribeMemorySync) carry the admin password
// hash instead, the same credential runTrainer requires.
//
// These rows are NOT in the KV store and must never be read or written
// through js/storage.js — they live in their own CFBP_SCRIBE_MEMORY sheet
// precisely so a row can be physically deleted (DI-D2). The UI keeps them in
// a module-level cache with an explicit refresh, never in `load()`/`save()`.
export async function scribeMemoryListRemote({ playerId, kinds = null } = {}) {
  return call('scribeMemoryList', { playerId, ...(kinds && kinds.length ? { kinds } : {}) });
}
/**
 * RG-120 item (xii), THE COUPLING, NAMED (2026-09-12). `playerId` here is taken
 * FROM THE RECORD, not from the signed-in session — so the requester the server
 * authorises against is, by construction, the row's own owner.
 *
 * That is what makes a THIRD-PARTY wager work: Kevin taps 🤝 on Drew's claim and
 * app.js's logWager() writes `{ playerId: proposerId }` (the record is ABOUT
 * Drew, and AD-49 says Drew must be able to delete it), while Kevin is preserved
 * only inside the envelope's `b` field. Code.gs's non-commissioner branch checks
 * requester === row owner and passes.
 *
 * ANYONE HARDENING THIS RELAY TO SEND THE TRUE ACTOR (the obvious, and
 * generally correct, security improvement) MUST ADD A SERVER-SIDE
 * `kind === 'wager'` CARVE-OUT IN THE SAME CHANGE — otherwise every
 * third-party 🤝 begins failing with "that memory belongs to another player,"
 * and it will look like a wager bug rather than an auth change. The twin note
 * lives at js/app.js's logWager().
 */
export async function scribeMemoryUpsertRemote(record = {}) {
  return call('scribeMemoryUpsert', { playerId: record.playerId, record });
}
export async function scribeMemoryDeleteRemote({ id, playerId } = {}) {
  return call('scribeMemoryDelete', { id, playerId });
}
export async function scribeMemorySyncRemote({ adminPasswordHash = '' } = {}) {
  return call('scribeMemorySync', { adminPasswordHash });
}
