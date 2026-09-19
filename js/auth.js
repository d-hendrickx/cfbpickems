/**
 * CFB Pickems — js/auth.js (Phase III, Step 3a — the sign-in front door)
 * =======================================================================
 * Scope: DI-180 (Google sign-in gate), DI-181 (league flow), DI-184 (active
 * league label) — the UI contract's DATA/LOGIC half. `js/app.js` owns every
 * DOM render for these; this module owns the Supabase client, the
 * authMode flag, session state, and the ONE invariant DI-184d requires:
 * `getActiveLeagueId()` is the single source of truth both the header pill's
 * text AND every read/write scope must use.
 *
 * NOT built here (Step 3b, DI-182/DI-183 — do not build):
 *   - the member-management card, permission-denied card (DI-182)
 *   - the six-player transition/link flow, claim codes (DI-183)
 * clearMirror() is imported from backend.js — an already-EXPORTED accessor,
 * called (not reimplemented) from signOut() below. This is reading/using
 * backend.js's public API, not editing backend.js.
 *
 * NOT built here (Step 4, js/supabase-backend.js):
 *   - actually reading/writing picks/games/etc. against Supabase. Game data
 *     keeps flowing through the existing Sheets-backed storage.js seam even
 *     when authMode:'supabase' — this module only gates WHO gets in and WHAT
 *     playerId/isAdmin resolve to. `switchActiveLeague()`'s "re-hydrate"
 *     step below is a documented stub for that reason (see its comment).
 *
 * CONVENTIONS #9 — reads stay synchronous. `getSupabaseSession()` and
 * `hasValidSupabaseSession()` are both plain synchronous reads of in-memory/
 * localStorage state; every network call (getMemberships, sign-in, sign-out)
 * is async and none of them are exposed as a synchronous API.
 */

import { clearMirror, setDataMode } from './backend.js';
// Phase III Step 4 Part B (DI §3.2, §6.6) — THE DATA ADAPTER.
// One direction only: js/supabase-backend.js imports ONLY
// ./supabase-projection.js (its own header, constraint 2), so this edge is not
// a cycle. It is also why the PROBE goes the other way — the adapter REGISTERS
// hasSupabaseDataBackend()'s implementation on this module (§1.3) rather than
// this module reading the adapter's internals.
//
// WHAT THIS MODULE USES IT FOR, and nothing else: the league-switch sequence
// (§3.2) and the handover/sign-out mirror drop (§6.6). The adapter's init() —
// which needs storage.js's setSiteUnlocked/isSiteUnlocked, and storage.js
// imports THIS module — is called from js/app.js, where every accessor is
// already in scope and no cycle is possible.
import * as sb from './supabase-backend.js';
// DI-180q — the handover clear has to stop the OUTGOING player's pushes landing
// on the INCOMING player's phone, and OneSignal's external-id binding is the
// thing that decides where a player-targeted push goes. js/push-onesignal.js has
// no imports of its own and no top-level side effects, so this edge introduces
// no cycle and costs a 'pins' boot nothing (the function early-returns without a
// configured App ID). Using its EXPORTED accessor, never a reimplementation.
import { logoutOneSignal } from './push-onesignal.js';

// ── Typed errors (AD-06 loud-fail) ───────────────────────────────────────────
// Two named classes, not bare Error strings, because two DIFFERENT callers have
// to tell these apart from a generic network failure and render different copy:
// storage.save()'s interlock refusal (SEC F1) and app.js's "can't reach sign-in"
// banner (SEC F2 / reviewer N4). `code` is the stable string; `name` is what
// `instanceof`-free call sites (and tests across module boundaries) match on.

/** The build's DATA layer and its AUTH layer disagree — authMode:'supabase'
 *  while the only live data backend is still the Sheets one. Every write is
 *  refused while this holds (see storage.js's save() guard). */
export class AuthModeMismatchError extends Error {
  constructor(message) {
    super(message || "This build's data layer is not ready for Supabase sign-in.");
    this.name = 'AuthModeMismatchError';
    this.code = 'auth_mode_mismatch';
  }
}

/** Sign-in itself is unreachable — no vendored SDK on the page, no configured
 *  project URL/anon key, or the membership read failed. NEVER degraded into
 *  "you have no leagues" (which is what SEC F2 caught: a stranger-shaped
 *  join/create landing rendered on top of an infrastructure failure). */
export class AuthUnavailableError extends Error {
  constructor(message) {
    super(message || "Can't reach sign-in right now.");
    this.name = 'AuthUnavailableError';
    this.code = 'auth_unavailable';
  }
}

// ── Config (DI-180f) ─────────────────────────────────────────────────────────
let _cfg = { authMode: 'pins', dataMode: 'sheets', supabaseUrl: '', supabaseAnonKey: '' };

/**
 * SEC F1 (CRITICAL) — THE INTERLOCK SEAM.
 *
 * `authMode:'supabase'` says "identity comes from Supabase." It says nothing
 * about where picks, games, weeks and players live. In THIS build they still
 * live in the one shared Google Sheet, reached through storage.js's existing
 * seam, because js/supabase-backend.js (Step 4) does not exist yet.
 *
 * That combination is not merely incomplete, it is dangerous: a synthesized
 * session derives `isAdmin` from `league_members.role` in a Supabase project
 * ANY Google account can sign into and create a league in — and then that
 * derived `isAdmin:true` would be handed to an app whose writes all land in
 * the six-player league's Sheet. A stranger becomes commissioner of the real
 * league. Hence: this function returns false until a Supabase DATA backend is
 * actually wired, and everything downstream treats "modes disagree" as a hard
 * stop rather than a degraded mode.
 *
 * ══ STEP 4 PART B (2026-09-18) — IT IS A REAL CHECK NOW (entry condition #2) ══
 *
 * The constant is gone. `hasSupabaseDataBackend()` reads the adapter's LIVE
 * state machine, through a probe the adapter registers below.
 *
 * WHY REGISTERED AND NOT IMPORTED. `auth.js -> supabase-backend.js` is already
 * an edge (see the import at the top, for §3.2/§6.6). The probe cannot be an
 * import of a *value* — it has to be a live call every time, because the whole
 * point is that the answer changes between ACTIVE and SWITCHING within one
 * tick. Registration also means this file never has to know the adapter's state
 * names, which is what keeps "may return true only from ACTIVE" a single
 * definition living beside the state machine (supabase-backend.js:157).
 *
 * WHAT THE PROBE ANSWERS TRUE FOR — two states, ACTIVE and ACTIVE-STALE, and no
 * others. Not IDLE, not HYDRATING, not SWITCHING, not HELD, and deliberately
 * not OFFLINE-READONLY: lifting the interlock is what would ALLOW A WRITE, and
 * an offline device must not accept one (§5.3). A config flag, a URL being
 * present, or "hydrate started" is explicitly not enough (§0.3 item 6) — which
 * is adaptertest A7's mutant.
 *
 * A THROWN PROBE IS FALSE. storage.save()'s interlock has no catch of its own,
 * so a probe that threw would take down the write path rather than refuse the
 * write; and "we cannot tell" must read as "not ready", never as permission.
 */
let _hasSupabaseDataBackendOverrideForTest = null;
let _dataBackendProbe = null;             // () => boolean, registered by the adapter

/**
 * DI §1.3 — called once by js/app.js's boot, via the adapter's `init({register})`.
 * A non-function argument UNREGISTERS rather than throwing: unlike
 * chatTransport's predicate (DI-T4.12, where a bad install silently disabled a
 * cross-league interlock and therefore has to stop the boot), a missing probe
 * here fails CLOSED all by itself — `hasSupabaseDataBackend()` answers false so
 * every write is refused, AND (2026-09-18) `isAuthDataLayerMismatch()` reads the
 * unregistered probe as "this build has no data layer", so the interlock holds
 * the whole mode and the player sees the hold gate. The loud failure is already
 * built; a throw would only turn a locked app into a blank one.
 *
 * THE REGISTRATION IS THE CONFIGURATION FACT; CALLING IT IS THE READINESS ONE.
 * That distinction is the whole of the cutover fix — see isAuthDataLayerMismatch().
 */
export function registerSupabaseDataBackend(probe) {
  _dataBackendProbe = typeof probe === 'function' ? probe : null;
  if (!_dataBackendProbe && probe !== null && probe !== undefined) {
    console.warn('[auth] registerSupabaseDataBackend() was given a non-function — the data-layer probe is UNREGISTERED, '
      + 'so hasSupabaseDataBackend() answers false and the interlock holds the whole supabase mode.');
  }
  return !!_dataBackendProbe;
}
/** Test-only — a suite that registered a probe has to be able to take it back
 *  out, and production has no path that unregisters. */
export function _resetSupabaseDataBackendForTest() { _dataBackendProbe = null; }

export function hasSupabaseDataBackend() {
  if (_hasSupabaseDataBackendOverrideForTest !== null) return _hasSupabaseDataBackendOverrideForTest;
  try { return _dataBackendProbe ? _dataBackendProbe() === true : false; } catch (e) {
    console.warn('[auth] the data-layer probe threw — treating the Supabase data backend as ABSENT (writes refused)', e && e.name);
    return false;
  }
}

/**
 * ══ TWO QUESTIONS, TWO PREDICATES (live cutover defect, 2026-09-18) ══════════
 *
 * WHAT HAPPENED. On the night of the cutover (config.json authMode:'supabase' +
 * dataMode:'supabase') every device, including a phone that had never opened the
 * app, painted the INTERLOCK hold gate instead of the Google sign-in gate. The
 * mode could not boot at all.
 *
 * WHY. This function used to be `authMode === 'supabase' && !hasSupabaseDataBackend()`
 * — i.e. it answered the interlock's question with the adapter's LIVE readiness
 * probe. The adapter cannot hydrate until a JWT exists (every RLS policy needs
 * auth.uid()), so on a device with no session the probe is necessarily false,
 * so the mismatch was necessarily true, so app.js's applyAuthModeDecision() held
 * the mode BEFORE offering the gate that would have produced the session the
 * probe was waiting for. A deadlock with the shape of a misconfiguration.
 *
 * THE SPLIT, and which caller needs which:
 *
 *   isAuthDataLayerMismatch()   CONFIGURATION — "is this build wired for a
 *                               Supabase data layer at all?" Answerable at boot,
 *                               from the two config flags plus the fact of a
 *                               registered probe. This is what SEC F1 is about
 *                               (identity from Supabase while every write lands
 *                               in the six players' Sheet), and it is what
 *                               app.js's interlock and picks-card copy mean:
 *                               "Sign-in isn't ready on THIS BUILD."
 *
 *   isSupabaseWriteWithheld()   READINESS — "is the adapter serving right now?"
 *                               The OLD predicate, verbatim, for the ONE caller
 *                               that needs it: js/storage.js's save() refusal.
 *                               Deliberately false for most
 *                               of a boot — HYDRATING, SWITCHING, HELD and
 *                               OFFLINE-READONLY all withhold the write, and the
 *                               adapter's header (supabase-backend.js:124) says
 *                               "writes NEVER — the interlock does the refusing",
 *                               so that behaviour is preserved EXACTLY.
 *
 * WHY THE CONFIGURATION TERM IS `_dataBackendProbe !== null` AND NOT THE PROBE'S
 * ANSWER: a registered probe is the fact that a Supabase data layer exists in
 * this build (registerSupabaseDataBackend() is called from app.js's
 * wireSupabaseAdapter(), the first thing boot() does after the chat predicate).
 * CALLING it asks whether that layer is serving, which is the other question.
 * A missing registration still fails CLOSED — an unwired adapter cannot be a
 * data layer, so the interlock still holds the mode, which is the §1.3 rule
 * read as configuration rather than as state.
 */
export function isAuthDataLayerMismatch() {
  if (_cfg.authMode !== 'supabase') return false;
  // THE ONE TEST SEAM, honoured by BOTH predicates. `_setHasSupabaseDataBackendForTest()`
  // means "pretend this build does / does not have a Supabase data layer", which
  // is the configuration question stated in the affirmative — so a suite that
  // sets it must get the same answer from both, or every fixture in authtest
  // that stands a hold gate up would have to re-state the whole cutover config
  // to test something that is not about the cutover at all. No module under js/
  // calls the setter (authtest [45] pins that), so this line is inert on every
  // device. The sections that are about the derivation — [16], [44a], [45] —
  // take the override AWAY and drive the real terms below.
  if (_hasSupabaseDataBackendOverrideForTest !== null) return !_hasSupabaseDataBackendOverrideForTest;
  return !(getDataMode() === 'supabase' && _dataBackendProbe !== null);
}

/** READINESS. The pre-2026-09-18 form of the predicate above, unchanged, with
 *  exactly one consumer: storage.save()'s SEC F1 write refusal. True whenever a
 *  Supabase-identity build's data layer is not serving, which includes every
 *  not-yet-hydrated instant of a perfectly healthy boot — that is the point. */
export function isSupabaseWriteWithheld() {
  return _cfg.authMode === 'supabase' && !hasSupabaseDataBackend();
}

function _normalizeAuthMode(raw) {
  return (raw === 'supabase' || raw === 'prelink') ? raw : 'pins';
}

/**
 * DI §1.4 — `dataMode` is the SECOND flag, and the four combinations are a
 * table, not a matrix of guesses:
 *
 *   pins/prelink + sheets     today, byte-identical. The world every device is in.
 *   pins/prelink + supabase   REFUSED at boot and normalized back to 'sheets'.
 *                             A Supabase data layer with no Supabase identity has
 *                             no auth.uid(), so every RLS policy sees an anon
 *                             caller and the hydrate returns nothing — which
 *                             would then look exactly like an empty league. It
 *                             is NOT a hold (a flag-off device must never lock):
 *                             a loud console line, and Sheets.
 *   supabase + sheets         the current build's interlock. Hold gate 'interlock'.
 *   supabase + supabase       Step 4: the adapter is constructed and the
 *                             interlock passes once it is ACTIVE.
 *
 * ── FAIL-CLOSED ON A FAILED CONFIG READ ──────────────────────────────────────
 * `loadDeployedConfig()` carries `dataMode` on its SUCCESS branches only (the
 * same shape SEC F1-R1 gave `authMode`: a read that could not happen must not
 * ANSWER). So when `authModeKnown !== true` this KEEPS the mode a successful
 * read last established IN THIS PAGE rather than silently downgrading to
 * 'sheets' — because 'sheets' under `authMode:'supabase'` is the interlock, and
 * a transient config blip must not tear a working session down to a hold
 * mid-session. Across pages the memory is deliberately NOT persisted (see the
 * handoff note): a cold boot with an unreadable config resolves authMode from
 * `cfbp_auth_mode_last_known`, gets 'sheets' for the data layer, and HOLDS —
 * which is the correct, designed, fail-closed outcome for that device.
 *
 * Called once from app.js boot(), right after loadDeployedConfig() resolves
 * (same object backend.js already reads config.json into — see its own
 * DI-180f comment). Idempotent; safe to call again if config is re-read.
 */
function _normalizeDataMode(raw) {
  return raw === 'supabase' ? 'supabase' : 'sheets';
}
export function configureAuth({ authMode, dataMode, supabaseUrl, supabaseAnonKey, authModeKnown } = {}) {
  const nextAuthMode = _normalizeAuthMode(authMode);
  let nextDataMode = (authModeKnown !== true && dataMode === undefined)
    ? _cfg.dataMode                       // the read failed — keep what a successful one established
    : _normalizeDataMode(dataMode);
  if (nextDataMode === 'supabase' && nextAuthMode !== 'supabase') {
    console.error(`[auth] config.json asks for dataMode:'supabase' with authMode:'${nextAuthMode}'. `
      + 'A Supabase data layer with no Supabase identity has no auth.uid(), so RLS would return an EMPTY league '
      + "on every device — indistinguishable from a wiped one. Normalizing dataMode back to 'sheets'. "
      + 'Set BOTH keys in the same commit (DI §8.1 step 3) or neither.');
    nextDataMode = 'sheets';
  }
  _cfg = {
    authMode: nextAuthMode,
    dataMode: nextDataMode,
    supabaseUrl: String(supabaseUrl || '').trim(),
    supabaseAnonKey: String(supabaseAnonKey || '').trim(),
  };
  // js/backend.js's relay allow-list (§2.7) reads its OWN copy, set here from
  // the one config read that actually happened rather than from the persisted
  // `cfbp_backend_config` blob — which survives a rollback and would otherwise
  // keep refusing every relay on a device that is back on the Sheet.
  try { setDataMode(_cfg.dataMode); }
  catch (e) { console.warn('[auth] could not propagate dataMode to the Sheets relay guard', e); }
}
export function getAuthMode() { return _cfg.authMode; }
export function getDataMode() { return _cfg.dataMode; }
/**
 * THE PREDICATE js/chatTransport.js IS HANDED AT BOOT (DI-T4.12, §7.3), and the
 * one js/app.js branches the adapter boot on.
 *
 * It CANNOT THROW — a plain property read of a module-private object — and that
 * is load-bearing rather than incidental: once Part B installs a real predicate,
 * chatTransport fails CLOSED on a predicate that throws (refuses the append), so
 * a throwing predicate here would take chat off every device for the session.
 */
export function isSupabaseDataMode() { return _cfg.dataMode === 'supabase'; }

// ── Client (lazy — no top-level side effects, so importing this module in
//    loadtest.mjs's DOM-stub environment, where window.supabase does not
//    exist, never throws) ────────────────────────────────────────────────────
const AUTH_STORAGE_KEY = 'cfbp_supabase_session';
// Device-local record of which league is "active" on THIS device, same
// category as storage.js's own SESSION/SITE_UNLOCK device-local keys (see
// storage.js's DEVICE_LOCAL_KEYS comment) but owned here, under its own key —
// deliberately NOT storage.js's literal 'cfbp_session' key, so a device that
// has run in both 'pins' and 'supabase' mode never has one mode's session
// shape silently overwritten by the other's (a PIN-mode {playerId,isAdmin,
// playerVerified,setAt} object and this module's {activeLeagueId} record are
// different shapes; sharing a key would make a rollback read a garbled mix).
const ACTIVE_LEAGUE_KEY = 'cfbp_supabase_active_league';
/**
 * SEC F1-R1 — THE LAST AUTH MODE THIS DEVICE IS KNOWN TO HAVE BOOTED IN.
 *
 * Third device-local key owned by this module, same category and same rules as
 * the two above (declared here, documented in js/storage.js's DEVICE_LOCAL_KEYS
 * comment block so that list stays the one place a reader sees everything that
 * stays on the handset).
 *
 * WHY IT EXISTS, stated as the failure it closes: loadDeployedConfig() USED TO
 * return a hardcoded `authMode:'pins'` on every failure branch — a 404 behind a
 * captive portal, a Pages 5xx, a service-worker 503, an offline cold boot. Once
 * the league has cut over, that silently downgrades a supabase device to pins,
 * and pins mode makes storage.getSession() read `cfbp_session` again — a record
 * that may still say `isAdmin:true` from before cutover, on a device where
 * `cfbp_site_unlocked` is already set. Result: the full commissioner panel, no
 * gate, and the only banner on screen talking about sync.
 *
 * So the read failure is not allowed to CHOOSE a mode. It keeps the last mode a
 * successful read established. Written only on a config read that actually
 * succeeded; never written by a failure path, so it can only ever record an
 * answer the server really gave.
 */
const LAST_AUTH_MODE_KEY = 'cfbp_auth_mode_last_known';
/**
 * ══ DI-180q — WHOSE DATA IS ON THIS PHONE? (Drew's ruling, option (a),
 *    2026-09-17) ═══════════════════════════════════════════════════════════════
 *
 * FOURTH device-local key owned by this module, same category and same rules as
 * the three above.
 *
 * THE GAP IT CLOSES, stated as the sequence. A9 (approved) says the previous
 * player's device-local items — chat cache, read cursors, notification log, the
 * UNSENT chat outbox, the local mirror — are cleared the moment a DIFFERENT
 * account is proven at the device. The build only did that when a SUSPENDED
 * SLATE existed to compare against. If player A's sign-in died before the app
 * ever worked out who A was (a dead saved token discovered at boot), there is no
 * suspension box and no "previous account" anywhere in memory — so when B signed
 * in, B inherited A's cached chat, A's read positions, A's notification log and
 * any unsent messages A had queued, WHICH WOULD THEN SEND UNDER B'S SESSION.
 * That last one is the consequence that is not merely cosmetic.
 *
 * WHY A MARKER AND NOT "CLEAR WHENEVER WE DON'T KNOW". Without a record of whose
 * data this is, the only fail-closed rule available is "clear on every sign-in
 * where the previous owner is unknown" — which is every cold start, so every
 * player re-downloads the room every morning and any message typed offline is
 * lost. v0.21.0's instant-chat boot exists precisely to avoid that.
 *
 * WHAT IT HOLDS: the FULL identity tuple — account id AND active league id,
 * joined with IDENTITY_KEY_SEP. The league term is load-bearing (sixth-gate
 * reviewer): the chat cache, the read cursors and the unread counts are all
 * LEAGUE-scoped, so one account switching between two leagues must not inherit
 * the other league's cached room. Opaque ids only — never the email, never a
 * display name — and never synced anywhere: this is a fact about a handset.
 *
 * THE RULE, on every RESOLVED sign-in (account known):
 *   marker matches           -> keep everything (instant chat boot preserved)
 *   marker differs           -> CLEAR before first paint, then set
 *   marker missing + data     -> clear once (fail-closed), then set
 *   marker missing + no data  -> just set; there is nothing to inherit
 *   marker unwritable         -> behaves as MISSING next time, i.e. clears again.
 *                               Never as a match.
 * THE MARKER IS WRITTEN LAST, after the clear has completed. An interrupted
 * clear (a device that dies mid-sweep) therefore re-clears on the next boot
 * rather than recording an owner for data that is still half somebody else's.
 * Explicit Sign Out clears the data AND the marker together.
 *
 * ORDERING WITH THE IDENTITY EPOCH (both gates required these land together, and
 * this is why): a membership read issued for A can still be in flight when B is
 * proven at the device. Without the epoch, that read lands AFTER the clear and
 * repopulates the very cache DI-180q just wiped — the marker would then be B's
 * while the data underneath it was A's again. The epoch discards it; this marker
 * decides what to wipe. Neither is sufficient alone.
 *
 * REPORTED, NOT EDITED: js/storage.js's DEVICE_LOCAL_KEYS comment block is the
 * one place a reader sees everything that stays on the handset, and it needs one
 * more line for this key. storage.js is ask-first, so the line is reported to
 * Drew rather than written here.
 *
 * KNOWN ONE-TIME COST, stated so it is not read as a regression: every existing
 * phone has no marker and does have device-local data, so all six players get
 * exactly ONE chat re-download on the first boot after this ships.
 */
const DEVICE_DATA_OWNER_KEY = 'cfbp_device_data_owner';

/**
 * SEC S-2 — THE IN-MEMORY COPY, AND WHY IT IS NOT BELT-AND-BRACES.
 *
 * `setLastKnownAuthMode()` used to be `try { setItem } catch {}` — a write that
 * fails OPEN. A device that cannot persist (iOS private browsing, a full quota,
 * storage partitioned by an in-app browser) therefore NEVER establishes a mode:
 * every boot writes nothing, `getLastKnownAuthMode()` keeps answering '', and
 * the first config read that fails on that device downgrades it to PINs — the
 * exact escalation SEC F1-R1 was written to close, reintroduced through a
 * swallowed exception.
 *
 * So the write is now verified (write, then READ BACK), it REPORTS whether it
 * stuck, and the value is mirrored in module memory for the life of the page so
 * the rest of THIS session still knows what mode it is in even when nothing can
 * be written down. The caller (app.js's resolveEffectiveAuthMode) logs loudly on
 * a failed persist of 'supabase'; it does not change the boot, because this
 * boot's config read already answered the question.
 */
let _lastKnownAuthModeMemory = '';

/** '' when this device has never completed a successful config read — which is
 *  the ONLY case allowed to fall back to today's 'pins' behavior. Prefers the
 *  persisted value (it outlives the page); falls back to the in-memory copy
 *  when storage holds nothing or cannot be read at all. */
export function getLastKnownAuthMode() {
  try {
    const stored = _normalizeAuthModeOrEmpty(localStorage.getItem(LAST_AUTH_MODE_KEY));
    if (stored) return stored;
  } catch {}
  return _lastKnownAuthModeMemory;
}
/** @returns {boolean} true when the value is genuinely on the device after this
 *  call — proven by reading it back, not by setItem() failing to throw. */
export function setLastKnownAuthMode(mode) {
  const norm = _normalizeAuthModeOrEmpty(mode);
  _lastKnownAuthModeMemory = norm;
  try {
    if (norm) localStorage.setItem(LAST_AUTH_MODE_KEY, norm);
    else localStorage.removeItem(LAST_AUTH_MODE_KEY);
    return _normalizeAuthModeOrEmpty(localStorage.getItem(LAST_AUTH_MODE_KEY)) === norm;
  } catch { return false; }
}
/** Unlike _normalizeAuthMode(), an unrecognised/absent value here reads as ''
 *  ("this device has no last-known mode"), NOT as 'pins' — the whole point of
 *  the key is to tell "never established" apart from "established as pins". */
function _normalizeAuthModeOrEmpty(raw) {
  return (raw === 'supabase' || raw === 'prelink' || raw === 'pins') ? raw : '';
}

let _client = null;
// SEC concern 2 — TWO terms, not one. `_signingOut` used to be set true for the
// duration of the awaited client.auth.signOut() call and cleared in a finally
// block, which assumed the SDK fires SIGNED_OUT synchronously INSIDE that
// await. It does not have to: a listener that runs one tick later found the
// flag already cleared and reported a DELIBERATE sign-out as "your session
// expired." The flag is now consumed BY the SIGNED_OUT event itself (never in a
// finally), and a timestamp covers the case where the event arrives AFTER
// signOut() has already returned — any SIGNED_OUT within SIGNOUT_GRACE_MS of a
// deliberate signOut() is deliberate. Two terms, because each covers a case the
// other cannot: the flag covers an event fired INSIDE the await (however long
// that takes), the timestamp covers one fired shortly after it. The flag is
// also cleared at the END of signOut(), so it can never latch permanently on an
// SDK that never fires the event at all — which would mute a genuine expiry
// for the rest of the session.
let _signingOut = false;
let _signOutAt = 0;
const SIGNOUT_GRACE_MS = 1000;
let _sessionExpired = false;
let _membershipsCache = null;   // null = never fetched; [] = fetched, zero memberships
// SEC F2 — the LAST membership-read failure, or null. Distinct from an empty
// cache: [] means "asked, and the answer was zero leagues"; a non-null error
// here means "could not ask," which must never look like zero leagues.
let _membershipsError = null;
let _synthesizedSession = { playerId: null, isAdmin: false, playerVerified: false };
const _authListeners = new Set();

/**
 * ══ THE IDENTITY EPOCH (security F-1, SIXTH gate, 2026-09-17) ════════════════
 *
 * THE DEFECT, as the two sequences that actually reach it:
 *
 *   (A) A supabase boot kicks off the membership read. The player taps Sign Out
 *       while the round trip is still out. `signOut()` cleared the cache, the
 *       account id and the pointer — but NOT the in-flight promise. The read
 *       landed afterwards, wrote `_membershipsCache`, auto-resolved
 *       `setActiveLeagueId()` and recomputed the synthesized session, so a
 *       device with no token on it answered
 *       `getSession() = {playerId:'mA', isAdmin:true}`.
 *
 *   (B) The same handset is handed from player A to player B. B's own
 *       preference-free read was COALESCED into A's in-flight promise (reviewer
 *       F1's single-flight gate, which keyed on nothing but "is one open") — one
 *       network call, and B was served A's rows, A's league and A's
 *       commissioner role.
 *
 * WHAT THE FIX IS, stated as the rule: **every asynchronous round trip in this
 * module belongs to the identity that issued it, and may only land if that
 * identity is still the one this device is acting on.** A monotonic counter is
 * the cheapest honest expression of that — it needs no comparison of tuples, it
 * cannot be forged by a partially-resolved state, and "it moved" is exactly the
 * question both call sites need answered.
 *
 * WHAT MOVES IT (and, just as load-bearing, what does not):
 *   • `signOut()`                       — the device is deliberately nobody now
 *   • `forceSignedOutSession()`         — the interlock / config-unreadable hold
 *   • the account id changing to a DIFFERENT value, or to none — in
 *     `getMemberships()` and in `_handleAuthStateChange`, both routed through
 *     the ONE setter `_setAccountUserId()` so a path added later cannot skip it
 *   • `_clearExpiredSessionFromDevice()` — through that same setter
 *
 *   • NOT the first resolve of an UNKNOWN account id (`'' -> 'uA'`). That is the
 *     ordinary boot, and work issued while the account was unknown was issued
 *     for nobody in particular — there is no previous person it could belong to,
 *     because FORGETTING a person ('uA' -> '') is itself a bump. Bumping here
 *     would break reviewer F1's coalescing on every single boot (the SDK's
 *     INITIAL_SESSION handler and applyAuthModeDecision() would stop sharing a
 *     read), which is a real regression bought for no safety.
 *
 * HOW IT IS USED, in three places:
 *   1. captured on entry to `_refreshMembershipsAndSessionOnce()` and to
 *      `_verifySessionStillAlive()`; on resolve, if it moved, the result is
 *      DISCARDED — no cache write, no pointer move, no release, no emit, one
 *      console.warn and nothing else;
 *   2. both single-flight latches store the epoch they were opened under, so a
 *      caller arriving under a DIFFERENT identity is never served the previous
 *      one's promise (that is (B), closed structurally rather than by timing);
 *   3. `_bumpIdentityEpoch()` also nulls both latches. Deliberately redundant
 *      with (2) — a latch nulled and a latch made unshareable are two
 *      independent reasons B cannot be served A's answer, and this is the third
 *      time in this arc that a lock with one reason behind it was got around.
 *
 * EXPORTED as `getIdentityEpoch()`. DI-180q (the device-data owner marker) is
 * not built and not approved, but when it is, the marker it stamps has to be
 * comparable against the identity a landing read belongs to — so the hook is
 * here, beside the two accessors DI-180q's option (a) already needs
 * (`getAccountUserId()` + `getActiveLeagueId()`, joined with IDENTITY_KEY_SEP).
 */
let _identityEpoch = 0;
/** Read hook (DI-180q will stamp/compare against this; authtest reads it to
 *  prove a bump happened rather than inferring it from a side effect). */
export function getIdentityEpoch() { return _identityEpoch; }
function _bumpIdentityEpoch(reason) {
  _identityEpoch++;
  // Both in-flight latches belonged to the identity that just ended. Nulling
  // them here means no later caller can even find them; the epoch stamped on
  // each one means a caller that somehow did could not use it either.
  _membershipRefreshInFlight = null;
  _verificationInFlight = null;
  console.info(`[auth] identity epoch -> ${_identityEpoch} (${reason}) — any in-flight membership read or verification round issued for the previous identity is now void`);
  return _identityEpoch;
}
/**
 * ══ SECURITY F-3 (seventh gate) — THE TRAIL MAY NOT CARRY THE IDENTIFIER ═════
 *
 * The epoch line above is an INFO log, so it survives into every browser's
 * console, into a screenshot a player sends the commissioner, and into whatever
 * a future remote-logging hook forwards. It used to be handed
 * `"memberships-read: <uuid-A> -> <uuid-B>"` — two raw Supabase account ids, the
 * stable cross-league primary key for a person, printed on a handover (i.e. on
 * exactly the device that just changed hands).
 *
 * A 6-hex-character FNV-1a digest keeps the ONLY property the log is read for —
 * "did the person actually change, or is this the same id twice?" — and drops
 * the identifier. It is deliberately NOT a security primitive: it is short, and
 * anyone holding a candidate uuid can confirm it. That is fine, and stated so
 * nobody mistakes it for one. Its job is to stop a bystander, a screenshot and a
 * log sink from being handed the id for free.
 *
 * '(none)' is kept verbatim for the empty id, because "nobody" is not an
 * identifier and hashing it would make the signed-out case unreadable.
 */
function _idTag(id) {
  if (!id) return '(none)';
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `#${h.toString(16).padStart(8, '0').slice(0, 6)}`;
}
export const _idTagForTest = _idTag;

/** True when the identity this operation was issued for is no longer the one
 *  this device is acting on. `op` is the little token captured on entry. */
function _identityEpochMoved(op) { return !op || op.epoch !== _identityEpoch; }
function _warnStaleIdentity(what) {
  console.warn(`[auth] ${what} resolved for an identity this device has already left — DISCARDED (nothing written, nothing released, nothing emitted)`);
}

/**
 * TERM 1's ONE WRITE SITE — the Supabase account id.
 *
 * Every path that changes it goes through here, for the same reason
 * setActiveLeagueId() is the only writer of term 2: a list of the places
 * somebody remembered to bump the epoch is exactly the shape that failed three
 * times in this arc already. authtest [17d] rule (6) still audits the write by
 * name, so a second writer added anywhere in this file is reported.
 *
 * `notify:false` is for the ONE caller whose own trailing emit is the
 * notification (_handleAuthStateChange passes every raw SDK event straight to
 * the listener set, and app.js routes all of them into its chokepoint) — the
 * tuple is still RECORDED, so the coalescer knows it was announced.
 *
 * @returns {boolean} true when the value actually changed.
 */
function _setAccountUserId(uid, { notify = true, reason = 'account-id' } = {}) {
  const next = uid || '';
  if (next === _accountUserId) return false;
  // '' -> 'uA' is the ordinary boot resolving an unknown account, not a change
  // of person: see the epoch block above for why bumping there would cost
  // reviewer F1's coalescing and buy nothing.
  // SECURITY F-3 (seventh gate) — DIGESTS, NEVER THE ACCOUNT IDS THEMSELVES.
  // This string lands in an INFO log; see _idTag()'s note for why that is not a
  // place a Supabase account uuid may appear.
  if (_accountUserId) _bumpIdentityEpoch(`${reason}: ${_idTag(_accountUserId)} -> ${_idTag(next)}`);
  _accountUserId = next;
  if (notify) _notifyIdentityMaybeChanged();
  else _recordIdentityNotified();
  return true;
}

/**
 * ══ REVIEWER F-1/F-2, THIRD PASS — INSTRUMENT THE WRITE, NOT THE CALLER ══════
 *
 * THE CLASS, AND WHY THREE PASSES MISSED IT. app.js owns ONE chokepoint
 * (applyIdentityDeltaIfChanged) that compares the identity tuple and, when it
 * moved, clears the pick draft / tiebreaker / Extra Point guess / layout edit
 * mode and re-binds OneSignal. Each of the first three passes made sure the
 * chokepoint was reached by ENUMERATING CALLERS BY HAND — refreshAuthUI, the
 * Account sheet's Sign Out, doSwitchActiveLeague's finally, boot()'s two hold
 * branches — and each time a path that changes identity WITHOUT going through
 * any of those names was left out. The third one was joinLeague()/createLeague()
 * here in auth.js: they wrote the active-league pointer AFTER
 * refreshMembershipsAndSession() had emitted its last event, so League A's
 * draft survived into League B, the OneSignal binding stayed on A's member id,
 * and app.js's latch was left holding a stale key — which made the NEXT
 * background TOKEN_REFRESHED look like an identity change and wipe a draft the
 * player had legitimately entered (F-1, reborn).
 *
 * A list of callers is a list of the paths somebody remembered. The identity
 * tuple has exactly THREE backing terms, all of them in this file:
 *
 *   1. the Supabase account id      -> `_accountUserId`
 *   2. the active league id         -> localStorage[ACTIVE_LEAGUE_KEY],
 *                                      written ONLY by setActiveLeagueId()
 *   3. the synthesized playerId     -> `_synthesizedSession`
 *
 * So the notification is attached to the WRITES. Every assignment to those
 * three ends by calling _notifyIdentityMaybeChanged() (or is immediately
 * followed, before its function returns, by an emit to `_authListeners` that
 * app.js routes into the same chokepoint). A path added next year that moves
 * identity cannot avoid one of these three writes, so it cannot avoid
 * notifying — and authtest [17d] now anchors its static rule on the writes for
 * the same reason.
 *
 * WHAT IT EMITS: one event, 'IDENTITY_MAYBE_CHANGED', with no opinion about
 * whether anything actually needs resetting. app.js's chokepoint is still the
 * single decision point (it compares the tuple and is idempotent). "Maybe" is
 * the honest name: this module reports that a term was written, not that the
 * player changed.
 *
 * COALESCING, and its two rules:
 *   - Never emit twice for the same tuple. A no-op write (setActiveLeagueId to
 *     the value already there, a recompute that lands on the same membership)
 *     produces no event, so a token refresh stays as cheap as it was.
 *   - While a BATCH is open, hold the notification and emit at most once, for
 *     the FINAL tuple. join/create/switch/sign-out each move two or three terms
 *     in a row; without this the chokepoint would see a transient intermediate
 *     identity (e.g. "account known, league null") and fire a reset, then fire a
 *     second one for the real destination. One change, one reset.
 * Neither rule can SUPPRESS a real change: both are keyed on the same tuple the
 * chokepoint compares, and a batch always flushes in a `finally`.
 */
let _lastNotifiedIdentity = null;
let _identityBatchDepth = 0;
let _identityBatchPending = false;

/**
 * ══ THE IDENTITY KEY'S FIELD SEPARATOR — ONE CONSTANT, TWO MODULES ═══════════
 * (security 9 / reviewer, fifth gate, 2026-09-17.)
 *
 * It is U+0000 and not a space, so a league name or id containing a space
 * cannot forge a different tuple, and it is written as the ESCAPE `'\u0000'`
 * rather than as a literal NUL byte in the source: a literal is invisible in
 * every editor and every diff, survives a copy-paste as a space or vanishes
 * entirely, and app.js's copy of this constant really did contain the literal
 * byte until this pass.
 *
 * It lives HERE, and app.js imports it, because app.js already imports this
 * module and the reverse edge would be a cycle. Before this pass the two files
 * each had their own separator and they DISAGREED — auth.js joined with a
 * space, app.js with a NUL — so the two tuples were not the same string for the
 * same identity. Nothing compared them across the boundary yet, which is
 * exactly the kind of latent disagreement that becomes a defect the first time
 * something does (DI-180o(b)'s parser was the first thing to read a term back
 * out of a key, and got it wrong once already for this same reason).
 */
export const IDENTITY_KEY_SEP = '\u0000';

/** The three terms, flattened. Deliberately the same shape, the same separator
 *  and the same 'null'-for-unknown convention as app.js's currentIdentityKey(),
 *  so "unknown" and "resolved" can never collide here either — and so the two
 *  modules' keys are byte-identical for the same identity. */
function _identityTuple() {
  let leagueId = '';
  try { leagueId = localStorage.getItem(ACTIVE_LEAGUE_KEY) || ''; } catch { leagueId = ''; }
  return [_accountUserId || 'null', leagueId || 'null', _synthesizedSession?.playerId || 'null'].join(IDENTITY_KEY_SEP);
}

/**
 * Called by EVERY emit in this file, so that an event which already carried
 * the new identity to app.js (MEMBERSHIPS_REFRESHED, SIGNED_OUT, SWITCH_END,
 * a raw SDK event) is counted as the notification and never duplicated.
 *
 * REVIEWER F4 (fourth gate, 2026-09-17) — RECORD ONLY WHAT WAS DELIVERED.
 * `_lastNotifiedIdentity` is a record of "app.js has been told about this
 * tuple". With no listener attached, nobody was told — so recording the tuple
 * SUPPRESSES the first genuine notification after a listener is finally wired.
 * That is not hypothetical: boot() calls forceSignedOutSession() (an
 * instrumented write) on both hold branches BEFORE wireAuthUIEvents() has run,
 * and every test hook that mutates identity before wiring does the same. The
 * closed answer is to record nothing when there is nobody to deliver to.
 */
function _recordIdentityNotified() {
  if (_authListeners.size === 0) return;
  _lastNotifiedIdentity = _identityTuple();
}

function _notifyIdentityMaybeChanged() {
  if (_identityBatchDepth > 0) { _identityBatchPending = true; return; }
  // REVIEWER F4 — same rule as _recordIdentityNotified(): an emit into an empty
  // listener set delivered nothing, so it may not latch the tuple as announced.
  if (_authListeners.size === 0) return;
  const tuple = _identityTuple();
  if (tuple === _lastNotifiedIdentity) return;
  _lastNotifiedIdentity = tuple;
  _authListeners.forEach(fn => {
    try { fn('IDENTITY_MAYBE_CHANGED', { identity: tuple }); }
    catch (e) { console.warn('[auth] listener failed', e); }
  });
}

/**
 * Run `fn` (SYNCHRONOUS only — an await inside would let a concurrent event
 * land mid-batch) with identity notifications held, then emit at most one.
 *
 * `emitsOwnEvent:true` means the caller emits its own event to `_authListeners`
 * IMMEDIATELY after this returns, and app.js routes every event into the
 * chokepoint unconditionally — so that emit IS the notification, and a second
 * one would only buy a redundant full re-render. The tuple is recorded either
 * way, so the next genuine change still fires.
 *
 * REVIEWER F5 (fourth gate, 2026-09-17) — `emitsOwnEvent` IS A PROMISE ABOUT
 * THE NEXT LINE, AND A THROW BREAKS IT. If `fn` throws, the caller's own emit
 * (the line after this call) never runs, so recording the tuple as "announced"
 * would swallow a HALF-APPLIED identity: the terms `fn` wrote before it threw
 * stay written, nothing is told, and the next genuine change compares against a
 * tuple app.js has never seen. On a throw the batch therefore falls back to the
 * ordinary notifier, which is the closed answer — one event for a partial write
 * is strictly better than none.
 */
function _withIdentityBatch(fn, { emitsOwnEvent = false } = {}) {
  _identityBatchDepth++;
  let threw = false;
  try {
    return fn();
  } catch (e) {
    threw = true;
    throw e;
  } finally {
    _identityBatchDepth--;
    if (_identityBatchDepth === 0) {
      const pending = _identityBatchPending;
      _identityBatchPending = false;
      if (threw) { if (pending) _notifyIdentityMaybeChanged(); }
      else if (emitsOwnEvent) _recordIdentityNotified();
      else if (pending) _notifyIdentityMaybeChanged();
    }
  }
}

function _factory() {
  return (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function')
    ? window.supabase.createClient
    : null;
}

/** Lazily creates the Supabase client from the configured project URL/anon
 *  key. Returns null (never throws) if not yet configured or the vendored
 *  SDK isn't loaded — every caller below already treats "no client" as "not
 *  signed in," which is the correct degraded state (loud-fail lives in the
 *  gate render, not here: an unconfigured client just means the gate never
 *  clears, which IS the loud failure for this seam). */
function ensureClient() {
  if (_client) return _client;
  if (!_cfg.supabaseUrl || !_cfg.supabaseAnonKey) return null;
  const createClient = _factory();
  if (!createClient) return null;
  _client = createClient(_cfg.supabaseUrl, _cfg.supabaseAnonKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  try {
    _client.auth.onAuthStateChange((event, session) => _handleAuthStateChange(event, session));
  } catch (e) { console.warn('[auth] onAuthStateChange wiring failed', e); }
  return _client;
}

/**
 * DI §1.1 — THE ADAPTER USES THIS MODULE'S CLIENT, never one of its own.
 * One session, one token, one `onAuthStateChange`. A second `createClient()`
 * would give the data layer its own refresh loop racing this one's, and two
 * SDK instances writing the same `storageKey` is how a token gets clobbered
 * mid-refresh.
 *
 * Returns null (never throws) exactly as `ensureClient()` does; the adapter
 * treats "no client" as a hydrate failure, which is the loud-fail path (§5.1),
 * not a degraded read.
 */
export function getSupabaseClient() { return ensureClient(); }

let _accountEmail = '';
let _accountUserId = '';
/** DI-180d "Account sheet body — Signed in as `<email>`". Synchronous read
 *  of the last known session's email, cached at the same points the
 *  synthesized session is recomputed. '' when signed out. */
export function getAccountEmail() { return _accountEmail; }
/**
 * Reviewer F-1/F-2 — the FIRST term of the identity tuple app.js's
 * session-change chokepoint latches on. The Supabase account id, not the
 * membership id: two different Google accounts can resolve to the same
 * member id in two different leagues, and a device handed from one player to
 * another changes this even when nothing else does. '' when signed out.
 *
 * Synchronous in-memory read (CONVENTIONS #9), cached at the same two points
 * the session is: every auth state change that carries a session, and every
 * membership read (which asks the SDK for the session anyway).
 */
export function getAccountUserId() { return _accountUserId; }

function _handleAuthStateChange(event, session) {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
    // ── REVIEWER F2 — THE SECOND PROVEN-GOOD RELEASE ────────────────────────
    // SIGNED_IN and TOKEN_REFRESHED are the two events the SDK only fires after
    // the GoTrue server minted a token, so a session on either of them is proof
    // the refresh token works — which is exactly what an 'unknown' verdict could
    // not establish. Without this, the privilege lock and the strike counter
    // survived a completed sign-in for the life of the page (isAdmin:false, no
    // banner, and the next unrelated 401 destroying the saved sign-in as
    // "strike two").
    //
    // NARROW ON PURPOSE, in the fail-closed direction: INITIAL_SESSION is a
    // LOCAL rehydrate (it fires with whatever is in localStorage, including on
    // the boot where the token is already dead) and USER_UPDATED can carry a
    // profile change, so neither is treated as proof. The session must also
    // actually exist — either carrying an access_token or matching the
    // unexpired token this device has persisted.
    //
    // ── SECURITY F-3 (sixth gate) — THE BANNER LATCH IS NOT CLEARED HERE ────
    // `_sessionExpired = false;` used to run for ALL FOUR of these events while
    // the privilege release below was narrowed to two of them. So an
    // INITIAL_SESSION (a purely LOCAL rehydrate, fired on every page load with
    // whatever is in localStorage) or a USER_UPDATED took the "your session
    // expired" banner down while `_privilegeHeld` stayed up — the commissioner
    // surface gone, and nothing on screen saying why. That is the exact shape
    // reviewer F2 had already closed once from the other direction.
    //
    // The latch now has exactly three releases, all of them proven-good or
    // deliberate: _releaseExpiryHoldOnProof() (below), signOut(), and
    // clearSessionExpired() (the banner's own dismiss). The invariant both the
    // code and authtest hold to is `isPrivilegeHeld() => isSessionExpired()`.
    //
    // ── REVIEWER F9 (sixth gate) — THE RELEASE RUNS *BELOW* THE ASSIGNMENTS ──
    // It emits SESSION_REVERIFIED, and a listener woken by that reads the
    // session accessors. Running it first meant the event carried the OLD
    // account id/email — i.e. announced a re-verification of the person who had
    // just been replaced.
    _accountEmail = session?.user?.email || _accountEmail;
    _setAccountUserId(session?.user?.id || _accountUserId, { notify: false, reason: `auth:${event}` });
    // SIGNED_IN and TOKEN_REFRESHED are the two events the SDK only fires after
    // the GoTrue server minted a token, so a session on either of them is proof
    // the refresh token works. NARROW ON PURPOSE (see above).
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
        && !!session && (!!session.access_token || hasValidSupabaseSession())) {
      _releaseExpiryHoldOnProof(`auth:${event}`);
    }
    refreshMembershipsAndSession().catch(e => console.warn('[auth] membership refresh failed', e));
  } else if (event === 'SIGNED_OUT') {
    // DI-180c's "Session expired" state fires ONLY for a background/
    // involuntary sign-out (refresh token revoked, long idle, cleared
    // storage) — not for our OWN deliberate signOut() call, which sets
    // _signingOut first specifically so this branch can tell the difference.
    const deliberate = _signingOut || (_signOutAt > 0 && (Date.now() - _signOutAt) < SIGNOUT_GRACE_MS);
    if (!deliberate) _sessionExpired = true;
    _signingOut = false;   // consumed HERE, by the event — not in signOut()'s finally
    _membershipsCache = null;
    _membershipsError = null;
    _accountEmail = '';
    // Security F-1 — through the ONE setter, so the identity epoch moves and any
    // membership read still out for the departing account can no longer land.
    _setAccountUserId('', { notify: false, reason: 'auth:SIGNED_OUT' });
    _synthesizedSession = { playerId: null, isAdmin: false, playerVerified: false };
  }
  // The identity writes above (`_accountUserId` on the way in, `_accountUserId`
  // + `_synthesizedSession` on the way out) are notified by THIS emit: app.js
  // routes every event it receives into the one chokepoint, so a separate
  // IDENTITY_MAYBE_CHANGED here would be the same notification twice. Recorded
  // so the coalescer knows the tuple has been announced (see
  // _notifyIdentityMaybeChanged) — and recorded BEFORE the emit, never after,
  // so a listener that writes identity of its own still gets its own event.
  _recordIdentityNotified();
  _authListeners.forEach(fn => { try { fn(event, session); } catch (e) { console.warn('[auth] listener failed', e); } });
}

/** Subscribe to auth/membership lifecycle events. Fired with an event name —
 *  the raw Supabase ones ('SIGNED_IN','SIGNED_OUT','TOKEN_REFRESHED', …) plus
 *  this module's own 'MEMBERSHIPS_REFRESHED' — and a payload. app.js wires
 *  ONE listener at boot to re-render the gate/header/league-flow overlay;
 *  mirrors js/chat.js's onChat(fn) shape. Returns an unsubscribe function. */
export function onAuthEvent(fn) { _authListeners.add(fn); return () => _authListeners.delete(fn); }

// ── Session (synchronous) ────────────────────────────────────────────────────

/**
 * DI-180a/f — boot()'s gate decision. A best-effort, LOCAL, synchronous
 * check: does a persisted session exist under our own storageKey, and does
 * its `expires_at` look unexpired? This deliberately does NOT make a network
 * call (CONVENTIONS #9) — real invalidation (revoked token, server-side
 * sign-out elsewhere) is caught in the background by the SDK's own
 * autoRefreshToken machinery once the client exists, surfacing as DI-180c's
 * "Session expired" banner via _handleAuthStateChange's SIGNED_OUT branch
 * above, not by this function suddenly starting to lie.
 */
export function hasValidSupabaseSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw);
    if (!session || !session.access_token) return false;
    const expiresAt = Number(session.expires_at) || 0;
    return expiresAt * 1000 > Date.now();
  } catch { return false; }
}

export function isSessionExpired() { return _sessionExpired; }
export function clearSessionExpired() { _sessionExpired = false; }

/**
 * ══ THE STATE TABLE (reviewer + security, fifth gate; EXTENDED at the SIXTH,
 *    2026-09-17) ══════════════════════════════════════════════════════════════
 *
 * Both gates named the same failure mode for the fourth and fifth time in this
 * arc: a lock is asserted at the instant it goes UP, and nothing proves it stays
 * true afterwards or is ever RELEASED. DI-180p's first implementation had both
 * halves of that defect (reviewer F1 and F2), so the machine is written down
 * here FIRST and the code below is made to match it.
 *
 * WHY IT IS BIGGER NOW. The fifth-gate table enumerated four terms and the code
 * matched it — and the sixth gate found three more defects, every one of them in
 * state that lived OUTSIDE the table: the two in-flight PROMISES, the DOM's
 * `inert` attribute, and the `_sessionForcedOut` latch (a latch with no
 * production release at all). A state table that covers some of the machine is
 * a map of the part nobody was going to get wrong. So this one now lists EVERY
 * latch the feature owns, in both modules, each with the thing that sets it and
 * the thing that clears it — and standing test rule R2 asserts the RELEASE of
 * each, not just the assertion.
 *
 * ── PART 1: THE EXPIRY MACHINE (js/auth.js) ─────────────────────────────────
 *
 * THE FOUR TERMS
 *   held     `_privilegeHeld`        — isAdmin is forced false while true
 *   strikes  `_expiredStrikes`       — COMPLETED verification rounds since the
 *                                      last proven-good. Never counts CALLS.
 *   expired  `_sessionExpired`       — the banner latch
 *   flight   `_verificationInFlight` — the ONE round, shared by every concurrent
 *                                      caller under the SAME identity epoch
 *                                      (null when none)
 *
 * STATES (the only reachable combinations)
 *   S0 CLEAR        held=F strikes=0 expired=F flight=null
 *   S1 VERIFYING    held=T strikes=0 expired=T flight=<p>   first round
 *   S2 HELD         held=T strikes=1 expired=T flight=null  verdict was 'unknown'
 *   S3 SECOND-STRIKE held=T strikes=1 expired=T flight=<p>  the second round.
 *                   RENAMED at the sixth gate (reviewer F10): it was called
 *                   VERIFYING2, and the code does NOT verify anything here — the
 *                   round opens, inspects the counter (`_expiredStrikes >= 1`)
 *                   and answers 'dead' without asking the SDK. The name now says
 *                   what the code does; "a second COMPLETED round with no
 *                   intervening success" is the proof, and the round is a counter
 *                   inspection, not a second refresh.
 *   S4 DESTROYED    held=F strikes≥1 expired=T flight=null  token off the device,
 *                                                           session signed out
 *
 * EVENTS
 *   E1 an expiry-shaped membership failure (isSessionExpiredError)
 *   E2 verdict 'alive'      E3 verdict 'unknown'      E4 verdict 'dead'
 *   E5 a membership read SUCCEEDS          (proven good — server accepted the JWT)
 *   E6 SIGNED_IN/TOKEN_REFRESHED + session (proven good — server minted a token)
 *   E7 signOut()                           E8 a CONCURRENT second E1
 *   E9 the identity EPOCH moved while a round/read was out (security F-1)
 *
 * TRANSITIONS
 *   S0 -E1-> S1   lock + banner IMMEDIATELY, destroy nothing, start one round
 *   S1 -E8-> S1   shares the SAME in-flight verdict; strikes does NOT move (F1:
 *                 this is the transition that used to destroy a LIVE session on
 *                 the first boot, because two concurrent 401s from ONE cause
 *                 each incremented the counter and the second short-circuited)
 *   S1 -E2-> S0   release + SESSION_REVERIFIED + ONE re-read, which may not open
 *                 a round of its own (that is how one 401 becomes a refresh loop)
 *   S1 -E3-> S2   fail CLOSED on the lock, fail SAFE on the data
 *   S1 -E4-> S4   the one destroy call site
 *   S2 -E1-> S3 -E4-> S4   a second COMPLETED round with no intervening success
 *                          IS the proof DI-180p means by "second consecutive"
 *   S2 -E5-> S0   release + SESSION_REVERIFIED  (F2 — the release that was missing)
 *   S2 -E6-> S0   release + SESSION_REVERIFIED  (F2 — likewise)
 *   S4 -E6-> S0   a fresh sign-in resets the machine
 *   any -E7-> S0  an explicit sign-out ends the expiry conversation
 *   S1/S3 -E9-> unchanged   the verdict is DISCARDED: strikes does not move, no
 *                 release, no destroy, no emit. The round belonged to somebody
 *                 who has left the device (security F-1).
 *   ALSO: the RE-READ that follows an 'alive' verdict may not itself destroy.
 *                 It used to be hard-coded to 'dead' (`_afterVerifyReread ?
 *                 'dead' : …`), which is a THIRD destroy trigger absent from
 *                 this table and a violation of I4: 401 -> refresh alive ->
 *                 strikes 0 -> the re-read hits the same flaky 401 -> destroyed
 *                 with strikes at ZERO. It resolves 'unknown' now (reviewer F3,
 *                 sixth gate): keep the lock, keep the banner, open no round,
 *                 destroy nothing — and let the NEXT classification be a genuine
 *                 second round.
 *
 * INVARIANTS the code and the tests both hold to
 *   I1  strikes counts COMPLETED rounds, never calls.
 *   I2  at most ONE verification round exists per page at a time, per epoch.
 *   I3  held=T never survives a proven-good path (E2/E5/E6/E7).
 *   I4  the destroy is reachable only from S1/S3 via E4, at the one call site.
 *   I5  held=T => expired=T, after every event (security F-3).
 *   I6  no asynchronous result may be applied under an epoch other than the one
 *       it was issued under (security F-1).
 *
 * ── PART 2: EVERY OTHER LATCH THIS FEATURE OWNS ─────────────────────────────
 * (sixth gate. Each row is: latch — what SETS it — what RELEASES it.)
 *
 * js/auth.js
 *   `_sessionForcedOut`           SET by forceSignedOutSession() (the
 *                                 config-unreadable hold and the interlock, the
 *                                 only two callers). RELEASED by
 *                                 clearForcedSignOut(), called by
 *                                 applyAuthModeDecision() once it is past EVERY
 *                                 hold branch — the exact inverse of the two
 *                                 places it is set. Before the sixth gate it had
 *                                 NO production release at all (only
 *                                 _resetAuthForTest), so a device that recovered
 *                                 with a perfectly valid saved session painted
 *                                 its league as nobody, for the life of the page
 *                                 (reviewer F2). NOTE it is deliberately NOT
 *                                 released by _releaseExpiryHoldOnProof(): a
 *                                 successful membership read is NOT a reason to
 *                                 un-force the interlock, which exists precisely
 *                                 to refuse an isAdmin the server would grant.
 *   `_membershipRefreshInFlight`  SET by the single-flight gate in
 *                                 refreshMembershipsAndSession(). RELEASED when
 *                                 the run settles, and NULLED by
 *                                 _bumpIdentityEpoch(). Carries its epoch.
 *   `_verificationInFlight`       SET/released by _verifySessionStillAlive()'s
 *                                 own finally, and NULLED by
 *                                 _bumpIdentityEpoch(). Carries its epoch.
 *   `_identityEpoch`              monotonic; never released, only advanced. It
 *                                 is what makes the two rows above safe.
 *   `_signingOut` / `_signOutAt`  SET at the top of signOut(); the flag is
 *                                 consumed by the SIGNED_OUT event and cleared
 *                                 again at the end of signOut() (so an SDK that
 *                                 never fires the event cannot latch it), the
 *                                 timestamp expires after SIGNOUT_GRACE_MS.
 *   `_membershipsError`           SET on a failed read; cleared by a successful
 *                                 one, by _releaseExpiryHoldOnProof(), by
 *                                 signOut() and by clearMembershipsError().
 *   DEVICE_DATA_OWNER_KEY         DI-180q (Drew's ruling, option (a)). Not a
 *   `cfbp_device_data_owner`      boolean latch but a per-device RECORD, so its
 *                                 row is set/cleared/compared:
 *                                   SET   by reconcileDeviceDataOwner(), and
 *                                         only AFTER any clear has completed;
 *                                   CLEARED by signOut() (with the data it
 *                                         describes) and by _resetAuthForTest;
 *                                   COMPARED on every resolved sign-in and every
 *                                         completed league switch.
 *                                 Holds account id + active league id joined
 *                                 with IDENTITY_KEY_SEP. An unwritable marker
 *                                 reads as MISSING next boot (clear), never as a
 *                                 match. Paired with the epoch: the epoch stops
 *                                 a stale read repopulating what this just
 *                                 wiped, which is why both landed in one pass.
 *
 * js/app.js
 *   `_authHoldReason`             SET by showAuthHoldGate(); RELEASED by
 *                                 clearAuthHoldReason() — which
 *                                 applyAuthModeDecision() calls once past every
 *                                 hold branch, and which re-asserts on a throw
 *                                 between that point and the resolved gate's
 *                                 paint (security F-7).
 *   `_authHoldTimer`              armed by scheduleAuthHoldRecheck(); cleared by
 *                                 clearAuthHoldReason() and by runAuthHoldCheck.
 *   `_authHoldCheckInFlight`      SET/cleared around one re-check (its finally).
 *   `_appContentInert`            the DOM latch: `inert` + `aria-hidden` on
 *                                 .main-content/.bottom-nav. SET by the hold
 *                                 teardown; RELEASED by
 *                                 releaseWithholdIfResolved(). It was a
 *                                 call-site obligation and the sign-in path was
 *                                 not one of the call sites, which is how a
 *                                 recovered page ended up painted but DEAD
 *                                 (reviewer F1 / security F-2).
 *   `_timersParkedForHold`        SET by _parkTimersForHold(); RELEASED (the
 *                                 timers re-armed) by the same transition —
 *                                 cleared AFTER both re-arms are attempted, each
 *                                 in its own try/catch, so a throw in one cannot
 *                                 skip the other and cannot leave the flag
 *                                 claiming "not parked" over a dead device
 *                                 (reviewer F1, seventh gate).
 *   `_bootStoppedAtHold`          SET when boot() returns at a hold. NEVER
 *                                 CLEARED IN PRODUCTION — only
 *                                 _resetAuthHoldForTest() drops it, because a
 *                                 page that stopped at a hold did so once and
 *                                 the fact stays true for the life of that page.
 *                                 It is therefore a PRECONDITION, not a
 *                                 one-shot: `_withholdReleased` below is the
 *                                 thing that makes the expensive half
 *                                 once-per-page. (Reviewer F4, seventh gate —
 *                                 this row used to say "consumed by the
 *                                 transition", which reads as "cleared by it".)
 *   `_withholdReleased`           the once-per-page latch on that transition
 *                                 (replaces `_authHoldResumeDone`). SET BEFORE
 *                                 the work, as the re-entrancy guard — and RESET
 *                                 to false if that work throws, so the next
 *                                 session event retries it. Set-above-the-work
 *                                 with no reset was reviewer F1's BLOCK at the
 *                                 seventh gate: it produced a page that was
 *                                 painted, operable and permanently
 *                                 un-hydrated/un-tailed.
 *   `_postHydrateTailDone`        boot()'s tail runs once per page.
 *   `_suspendedSlate`             DI-180o(b); set on an expiry, released by
 *                                 restore / discard / different-account wipe.
 *   `_lastIdentityKey`            the chokepoint's comparison latch.
 *
 * ══ DI-180p — VERIFY BEFORE YOU DESTROY (security F-2, approved 2026-09-17) ══
 *
 * THE FALSE POSITIVE. The clear below fires on a 401 from the data server, and
 * a 401 can be wrong about the session: a handset whose clock is ≥ 90 seconds
 * slow gets one on a perfectly good token (the SDK only sends tokens it
 * believes have ≥ 90 s of life left), and so does every open tab the moment the
 * project's public key is rotated. Before this input, that deleted the saved
 * sign-in on every boot for that player — and, with DI-180o(b), would have been
 * the trigger that suspended a slate nobody had abandoned.
 *
 * THE SPLIT, stated once: the LOCK is immediate, the DESTRUCTION waits for
 * proof. On the first expired classification the app raises the expired banner,
 * holds every privileged surface (below), destroys NOTHING, and asks the SDK to
 * refresh the session exactly once. The saved sign-in is cleared only when
 * (a) the SDK itself reports a dead refresh token — its own enumerated codes,
 * see _isDeadRefreshTokenError() — or (b) a SECOND COMPLETED VERIFICATION ROUND
 * with no intervening success lands in the same page. A refresh that succeeds
 * takes the banner down and costs the player nothing.
 *
 * WHY THE LOCK DOES NOT MOVE THE IDENTITY TUPLE. `isAdmin` is deliberately NOT
 * one of the three terms app.js's chokepoint compares (account id, league id,
 * playerId). So holding privilege locks the commissioner panel without
 * registering as a change of person — which is what makes "a 401 followed by a
 * successful refresh fires no identity change and loses no draft" implementable
 * rather than a contradiction.
 *
 * WHAT A PLAYER CAN STILL DO INSIDE THE VERIFY WINDOW (security 5, decided
 * rather than inherited). `playerVerified` and `playerId` are deliberately
 * untouched by the hold — that is what makes a false alarm cost nothing — and
 * submitPicks() needs only those two. So for the width of one bounded refresh
 * (SESSION_REFRESH_TIMEOUT_MS below, never unbounded — that was security 5's
 * actual finding) a player CAN still submit a slate under an identity the
 * server may already have rejected. The residual is accepted for Step 3a and
 * named here: picks in this build are written to the SHEET through storage.js,
 * which never sees the Supabase JWT, so the write does not depend on the token
 * being alive and cannot half-succeed on it. What is missing is the CLIENT
 * boundary once the data layer moves.
 *   STEP 4 TODO (do not widen the lock for it here): once picks are written
 *   through the Supabase data layer, the Picks page must be held for the verify
 *   window too — the server refuses the write in that world, and the client
 *   must not offer an action it knows may be refused. No new UI in this pass.
 *
 * LOAD-BEARING SDK BEHAVIOUR, pinned here because the destroy path depends on
 * it (reviewer, fourth gate): after our own removeItem() of AUTH_STORAGE_KEY,
 * an SDK refresh that is still in flight re-reads the storage key before
 * persisting, sees that it changed underneath itself, and DISCARDS its result
 * rather than writing the session back. That is why a clear cannot be undone by
 * a late-arriving refresh, and why the verify-then-destroy order is safe.
 */
let _privilegeHeld = false;
let _expiredStrikes = 0;
/** I2 — the ONE in-flight verification round, shared by every concurrent
 *  caller. `null` when no round is open. Replaces the module-global
 *  `_postRefreshRereadDepth` (security finding 6): the re-read's "do not open a
 *  round of your own" rule is now a PER-CALL argument
 *  (`_afterVerifyReread`), so it cannot leak across an unrelated concurrent
 *  classification the way a module-scoped depth counter did. */
let _verificationInFlight = null;

/** True while an expiry classification is UNVERIFIED — every privileged
 *  surface is treated as signed out, but nothing has been destroyed. */
export function isPrivilegeHeld() { return _privilegeHeld; }

/**
 * ══ REVIEWER F2 — THE ONE RELEASE ════════════════════════════════════════════
 *
 * Before this, the ONLY path that released the lock was the 'alive' verdict.
 * So after an 'unknown' verdict (a 401 whose refresh then failed with a 429, a
 * 5xx, or a dropped connection) a later FULLY SUCCESSFUL membership read left
 * `_privilegeHeld` true, `isAdmin` false and `strikes` at 1 for the life of the
 * page — with no banner explaining it, because the next TOKEN_REFRESHED clears
 * `_sessionExpired`. The commissioner's panel was gone and nothing on screen
 * said why, and the NEXT unrelated 401 was strike two and destroyed the saved
 * sign-in without ever verifying it.
 *
 * So every PROVEN-GOOD path calls this, and it is the only thing that lowers the
 * lock outside the 'alive' verdict. Proven-good means the SERVER accepted us:
 * a membership read that returned rows, or an SDK event carrying a session.
 *
 * It emits SESSION_REVERIFIED (the event app.js already takes both banners down
 * on) — but only when something really was held, so the ordinary boot stays
 * silent. The repaint that follows is MEMBERSHIPS_REFRESHED's / the raw event's
 * own; privilege is a VIEW over the unchanged session (getSupabaseSession()), so
 * releasing it restores the commissioner surface without moving any identity
 * term, which is what keeps this compatible with DI-180o(b).
 *
 * @returns {boolean} true when it actually released something.
 */
function _releaseExpiryHoldOnProof(reason) {
  if (!_privilegeHeld && _expiredStrikes === 0 && !_sessionExpired) return false;
  _privilegeHeld = false;
  _expiredStrikes = 0;
  _sessionExpired = false;
  _membershipsError = null;
  _authListeners.forEach(fn => {
    try { fn('SESSION_REVERIFIED', { reason, released: true }); }
    catch (e) { console.warn('[auth] listener failed', e); }
  });
  return true;
}

/**
 * The SDK's OWN "this refresh token is gone" vocabulary, and nothing wider.
 * Deliberately NARROWER than isSessionExpiredError(): a bare 401/PGRST301 is
 * exactly the shape a slow clock or a rotated key produces, so it is the one
 * thing that must NOT authorise a destroy on its own. Sources, cited so the
 * list is checkable (vendor/supabase-js-2.116.0.js, minified):
 *   • ~182311 — the SDK's own INITIAL_SESSION handler enumerates
 *     `refresh_token_not_found` / `refresh_token_already_used` /
 *     `session_expired` as "the session is gone, this is not a bug".
 *   • ~122669 — the wire body's code is read as `code` ELSE `error_code`, and
 *     `session_not_found` maps to AuthSessionMissingError (~110353, status 400).
 *   • `invalid_grant` / "Invalid Refresh Token" are the GoTrue SERVER's words
 *     for a revoked refresh token; matched as text, not claimed as constants.
 */
export function _isDeadRefreshTokenError(err) {
  if (!err) return false;
  const code = String(err.code ?? err.error_code ?? '');
  if (['refresh_token_not_found', 'refresh_token_already_used', 'session_expired',
       'session_not_found', 'invalid_grant'].includes(code)) return true;
  if (String(err.name ?? '') === 'AuthSessionMissingError') return true;
  const raw = `${err.message ?? ''} ${err.error_description ?? ''}`;
  return /invalid refresh token|refresh token not found|refresh_token_not_found|refresh_token_already_used|session_expired|\binvalid_grant\b|auth session missing/i.test(raw);
}

/**
 * ══ SECURITY 5 / REVIEWER F6 — THE REFRESH GETS A DEADLINE ══════════════════
 *
 * `client.auth.refreshSession()` was awaited with no bound. The SDK's fetch can
 * hang the same three ways ensureSupabaseSdkLoaded()'s script tag can (a captive
 * portal that accepts the socket and holds it, a proxy that stalls mid-body, an
 * iOS tab backgrounded before the response completes) — and while it hangs, the
 * privilege lock is up, the banner is up, and the machine never reaches a
 * verdict. That is not a fail-closed state, it is a PERMANENT one: the player
 * has lost the commissioner surface with no path back short of a reload, and the
 * one thing that could release the lock is the answer that never comes.
 *
 * Same shape as the SDK loader's deadline, for the same reason and with the same
 * injectable parameter so a test drives milliseconds instead of sleeping ten
 * seconds: the losing branch resolves 'unknown', which is the honest answer
 * ("we still cannot tell") and keeps the lock without destroying anything. The
 * race does not cancel the refresh — if it lands at second 30 the SDK persists
 * the new token and the next proven-good path releases the lock.
 */
const SESSION_REFRESH_TIMEOUT_MS = 10000;
let _refreshDeadlineMsForTest = null;
/** Test hook (mirrors ensureSupabaseSdkLoaded's `timeoutMs` parameter — the
 *  production value is the constant above). Production never calls this. */
export function _setRefreshDeadlineForTest(ms) {
  _refreshDeadlineMsForTest = (ms === null || ms === undefined) ? null : Number(ms);
}

async function _refreshSessionWithinDeadline(client) {
  const attempt = (async () => {
    try {
      const { data, error } = await client.auth.refreshSession();
      if (error) return _isDeadRefreshTokenError(error) ? 'dead' : 'unknown';
      return data?.session?.access_token ? 'alive' : 'unknown';
    } catch (e) {
      return _isDeadRefreshTokenError(e) ? 'dead' : 'unknown';
    }
  })();
  const timeoutMs = (_refreshDeadlineMsForTest === null) ? SESSION_REFRESH_TIMEOUT_MS : _refreshDeadlineMsForTest;
  if (typeof setTimeout !== 'function') return attempt;
  let timer = null;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      timer = null;
      console.warn(`[auth] the SDK's session refresh did not answer within ${timeoutMs}ms — the expiry stays UNVERIFIED (the lock holds, nothing is destroyed)`);
      resolve('unknown');
    }, timeoutMs);
    // Node-only (authtest/boottest): a 10s deadline must not hold the process
    // open. No-op in a browser.
    if (typeof timer?.unref === 'function') timer.unref();
  });
  try { return await Promise.race([attempt, deadline]); }
  finally { if (timer !== null) { clearTimeout(timer); timer = null; } }
}

/**
 * ONE round of DI-180p's verification, shared by every concurrent caller
 * (invariant I2). Returns 'dead' (destroy), 'alive' (nothing was wrong) or
 * 'unknown' (we still cannot tell — keep the lock, keep the banner, destroy
 * nothing, and let the next round be strike two).
 *
 * ══ REVIEWER F1 — WHY THIS IS SINGLE-FLIGHT, AND WHY strikes COUNTS ROUNDS ══
 *
 * The old body opened with `_expiredStrikes++; if (_expiredStrikes >= 2) return
 * 'dead';` — i.e. it counted CALLS, before any refresh, and the second call
 * short-circuited straight to "destroy". Every supabase boot issues TWO
 * membership reads concurrently (applyAuthModeDecision() and the SDK's
 * INITIAL_SESSION handler), so ONE cause that 401s them both — a handset clock
 * ≥ 90 s slow, a rotated anon key — reached strike two on the FIRST BOOT with a
 * perfectly live session: the saved sign-in destroyed and, under DI-180o(b), the
 * slate suspended, for a player who had done nothing.
 *
 * So: concurrent callers share one verdict, and `_expiredStrikes` is advanced
 * exactly once per COMPLETED round, by the bookkeeping below rather than by the
 * caller. "A second consecutive 401" therefore means what DI-180p says it means
 * — a second completed verification round with no intervening success.
 */
async function _verifySessionStillAlive(triggerErr) {
  // I2 — a round is already open: share its verdict. Not merely an
  // optimisation; this is the transition (S1 -E8-> S1) that used to destroy a
  // live session.
  //
  // I6 (security F-1) — …but only a round opened under the SAME identity. A
  // round issued for player A must never answer for player B: 'alive' for A,
  // arriving after B is at the device, would release B's lock on A's evidence.
  if (_verificationInFlight && _verificationInFlight.epoch === _identityEpoch) return _verificationInFlight.promise;
  const epoch0 = _identityEpoch;
  const round = (async () => {
    // (b) A second COMPLETED round with no intervening success. One 401 can be
    // a clock skew or a key rotation; two rounds in a row is the session.
    if (_expiredStrikes >= 1) return 'dead';
    // (a) The trigger itself is one of the SDK's dead-refresh-token codes:
    // there is no refresh token left to try, so there is nothing to verify.
    if (_isDeadRefreshTokenError(triggerErr)) return 'dead';
    try {
      const client = ensureClient();
      if (!client || typeof client.auth?.refreshSession !== 'function') return 'unknown';
      return await _refreshSessionWithinDeadline(client);
    } catch (e) {
      // A round NEVER rejects: a throw out of createClient()/the SDK is "we
      // still cannot tell", which keeps the lock and destroys nothing. A
      // rejecting round would also poison the shared in-flight promise every
      // concurrent caller is waiting on.
      console.warn('[auth] the session verification round threw — treating the expiry as UNVERIFIED', e);
      return _isDeadRefreshTokenError(e) ? 'dead' : 'unknown';
    }
  })().then(verdict => {
    // I6 — the round belonged to an identity this device has left. DISCARD it:
    // the strike counter must not move (it is a fact about the OLD session), and
    // the caller's own epoch guard turns the 'stale' answer into "do nothing".
    if (_identityEpoch !== epoch0) { _warnStaleIdentity('a session-verification round'); return 'stale'; }
    // I1 — the ONE place the strike counter moves. A round that PROVED the
    // session alive resets it (that is an intervening success); every other
    // completed round advances it by exactly one, however many callers were
    // waiting on it.
    if (verdict === 'alive') _expiredStrikes = 0;
    else _expiredStrikes++;
    return verdict;
  });
  const entry = { epoch: epoch0, promise: round };
  _verificationInFlight = entry;
  try { return await round; }
  finally { if (_verificationInFlight === entry) _verificationInFlight = null; }
}

/** The synthesized getSession() shape (DI-180j) — {playerId, isAdmin,
 *  playerVerified} sourced from the ACTIVE membership, structurally
 *  identical to storage.js's own default shape so every isAdmin call site in
 *  app.js is unaffected. Synchronous — reads the in-memory cache populated
 *  by refreshMembershipsAndSession(), never triggers a fetch itself.
 *
 *  DI-180p — while an expiry is unverified, `isAdmin` is forced false here
 *  rather than at the write: the hold is a VIEW over the same session, so a
 *  refresh that succeeds restores privilege without any state having moved
 *  (and therefore without an identity delta). playerId is untouched, which is
 *  the whole point — see _privilegeHeld's comment block. */
export function getSupabaseSession() {
  if (_privilegeHeld && _synthesizedSession?.isAdmin) {
    return { ..._synthesizedSession, isAdmin: false };
  }
  return _synthesizedSession;
}

/**
 * SEC F1 — the interlock's client-side half. Called by app.js's boot() the
 * moment it detects authMode:'supabase' against a data layer that is not
 * Supabase. Latches the synthesized session to the signed-out shape so no
 * `isAdmin` can be derived, and keeps it latched: _recomputeSynthesizedSession()
 * checks the same latch, so a membership refresh that lands later (or a league
 * pointer write) cannot quietly re-derive commissioner rights underneath it.
 */
let _sessionForcedOut = false;
export function forceSignedOutSession() {
  _sessionForcedOut = true;
  // Security F-1 — whoever this device thought it was, it is now nobody, so
  // every membership read and verification round still out there was issued for
  // an identity that no longer applies. The bump voids both.
  _bumpIdentityEpoch('forceSignedOutSession');
  _synthesizedSession = { playerId: null, isAdmin: false, playerVerified: false };
  _notifyIdentityMaybeChanged();   // instrumented write (term 3)
}
export function isSessionForcedOut() { return _sessionForcedOut; }

/**
 * ══ REVIEWER F2 (SIXTH gate, 2026-09-17) — THE LATCH GETS A PRODUCTION RELEASE ═
 *
 * THE DEFECT. `_sessionForcedOut` was set on both of applyAuthModeDecision()'s
 * fail-closed hold branches and cleared in exactly ONE place: `_resetAuthForTest`.
 * `_recomputeSynthesizedSession()` short-circuits on it forever, so a device that
 * booted into the config-unreadable hold — which A2 promises RESOLVES BY ITSELF,
 * silently, on a twenty-second timer — came back with a perfectly valid saved
 * session and painted its league as nobody: no playerId, playerVerified false, no
 * commissioner surface, and nothing on screen explaining it. A latch asserted at
 * the instant it goes up with nothing that ever takes it down is the class lesson
 * of this whole arc, and this was an instance of it hiding inside the fix for a
 * different instance of it.
 *
 * WHERE THE RELEASE BELONGS, and where it deliberately does NOT. It is called by
 * applyAuthModeDecision() at the one point that is the exact inverse of the two
 * places the latch is set: past the config-unreadable branch, past the interlock,
 * past the sdk-unavailable branch — i.e. the config really was read, the data
 * layer really does agree, and the SDK really is on the page. Beside
 * clearAuthHoldReason(), because they answer the same question.
 *
 * It is NOT called from _releaseExpiryHoldOnProof(), and that is the important
 * half: a successful membership read is proof the SERVER accepts this JWT, which
 * is not remotely the same claim as "this build's data layer is ready for a
 * Supabase-derived isAdmin". Releasing there would hand a stranger's
 * `league_members.role = 'commissioner'` straight to an app whose writes land in
 * the six-player league's Sheet — SEC F1, the CRITICAL finding this latch exists
 * to close, reopened through its own release path.
 *
 * @returns {boolean} true when it actually released something (so the caller can
 *          route the identity change through app.js's one chokepoint, exactly as
 *          both SET sites already do).
 */
export function clearForcedSignOut() {
  if (!_sessionForcedOut) return false;
  _sessionForcedOut = false;
  // Term 3's one write site — it notifies, so this release announces itself like
  // every other identity change.
  _recomputeSynthesizedSession();
  return true;
}

/** Term 3's ONE write site. Every path that can change the synthesized session
 *  goes through here (or through the SIGNED_OUT branch above, which emits its
 *  own event), so the notify at the bottom covers all of them — including
 *  callers that do not know they changed identity. */
function _recomputeSynthesizedSession() {
  if (_sessionForcedOut) {
    _synthesizedSession = { playerId: null, isAdmin: false, playerVerified: false };
    _notifyIdentityMaybeChanged();
    return;
  }
  const activeId = getActiveLeagueId();
  const membership = (_membershipsCache || []).find(m => m.leagueId === activeId);
  _synthesizedSession = membership
    ? { playerId: membership.memberId, isAdmin: membership.role === 'commissioner', playerVerified: true }
    : { playerId: null, isAdmin: false, playerVerified: false };
  _notifyIdentityMaybeChanged();
}

// ── Active league (DI-184d's invariant — ONE function, two consumers) ───────

// DI-184h asks the tests to prove the header pill's text and the active
// read/write scope come from the SAME CALL, not from two values that merely
// agree once. ES modules cannot be monkey-patched from a test, so the spy
// lives here: a plain read counter, incremented by the one function, read by
// authtest [3]. Production never reads it.
let _activeLeagueIdReads = 0;
export function _getActiveLeagueIdReadsForTest() { return _activeLeagueIdReads; }
export function _resetActiveLeagueIdReadsForTest() { _activeLeagueIdReads = 0; }

export function getActiveLeagueId() {
  _activeLeagueIdReads++;
  try { return localStorage.getItem(ACTIVE_LEAGUE_KEY) || null; }
  catch { return null; }
}
/** Term 2's ONE write site — the only place in the app that touches
 *  ACTIVE_LEAGUE_KEY in storage (authtest [17d] pins that), so instrumenting it
 *  here covers every caller, including ones added later. */
export function setActiveLeagueId(leagueId) {
  try {
    if (leagueId) localStorage.setItem(ACTIVE_LEAGUE_KEY, leagueId);
    else localStorage.removeItem(ACTIVE_LEAGUE_KEY);
  } catch {}
  _recomputeSynthesizedSession();
  // Explicit, not merely transitive through the recompute above: this function
  // must notify on its OWN terms even if the recompute's shape ever changes.
  // Coalesced, so the pair costs one event, not two.
  _notifyIdentityMaybeChanged();
}

/** DI-184's header pill and DI-181's dashboard both read league NAME off the
 *  same getActiveLeagueId() call this returns from — never a separately
 *  cached display string (DI-184d/g). */
export function getActiveLeagueName() {
  const activeId = getActiveLeagueId();
  const membership = (_membershipsCache || []).find(m => m.leagueId === activeId);
  return membership ? membership.leagueName : '';
}

export function hasResolvedMemberships() { return _membershipsCache !== null; }
/** SEC F2 — non-null while the last membership read FAILED. app.js renders a
 *  persistent banner off this and refuses to render DI-181's landing. */
export function getMembershipsError() { return _membershipsError; }
export function clearMembershipsError() { _membershipsError = null; }
export function getCachedMemberships() { return _membershipsCache || []; }

// ── Memberships (network) ────────────────────────────────────────────────────

/**
 * SEC F4 — is this failure "your session expired" rather than "sign-in is
 * unreachable"? Three independent signals, because PostgREST/GoTrue surface the
 * same condition three ways depending on which layer rejected:
 *   - `status` / `code` 401 (the HTTP status PostgREST returns on a bad JWT),
 *   - PostgREST's own `PGRST301` ("JWT expired"),
 *   - GoTrue's `not_authenticated` / an explicit "jwt expired" message.
 * Deliberately NARROW: anything it does not recognise falls through to the
 * auth-unavailable banner, which is the honest "we don't know" answer. Being
 * wrong in that direction costs a player one extra tap; being wrong in the
 * other direction tells a player with a live session that their session died.
 */
export function isSessionExpiredError(err) {
  if (!err) return false;
  const status = Number(err.status ?? err.statusCode ?? NaN);
  if (status === 401) return true;
  // SEC S-4 — GoTrue's REFRESH-token rejections, which arrive as 400/403 (not
  // 401) and so were falling through to "can't reach sign-in" while the player's
  // session was in fact permanently dead.
  //
  // WHAT WAS MATCHED, AND WHERE IT CAME FROM (vendor/supabase-js-2.116.0.js,
  // minified — offsets are into that file):
  //   • `AuthApiError` (~110014) is `class … { this.name='AuthApiError';
  //     this.status=t; this.code=n }` — so a GoTrue rejection really does carry
  //     BOTH `.status` and a string `.code`, which is what this reads.
  //   • ~182311, the SDK's own INITIAL_SESSION handler, enumerates exactly the
  //     codes it considers "the session is gone, this is not a bug":
  //     `t.code === 'refresh_token_not_found' || t.code ===
  //     'refresh_token_already_used' || t.code === 'session_expired'`.
  //     Taking the SDK's own list rather than inventing one.
  //   • ~122669 shows the wire body's code is read as `t.code` ELSE
  //     `t.error_code`, and that `session_not_found` is mapped to
  //     `AuthSessionMissingError` (~110353, name 'AuthSessionMissingError',
  //     status 400, message 'Auth session missing!').
  //   • `invalid_grant` and the literal string "Invalid Refresh Token" do NOT
  //     appear in the vendored bundle — they are what the GoTrue SERVER puts in
  //     the response body's `error` / `error_description` for a revoked refresh
  //     token, and they reach us through message/error_code, so they are matched
  //     as text rather than claimed as SDK constants.
  // Still deliberately NARROW: an unrecognised 400/403/500 falls through to the
  // auth-unavailable banner, which is the honest "we don't know".
  const code = String(err.code ?? err.error_code ?? '');
  if (code === 'PGRST301' || code === '401') return true;
  if (['refresh_token_not_found', 'refresh_token_already_used', 'session_expired',
       'session_not_found', 'invalid_grant'].includes(code)) return true;
  if (String(err.name ?? '') === 'AuthSessionMissingError') return true;
  const raw = `${err.message ?? ''} ${err.error_description ?? ''} ${code}`;
  return /\bPGRST301\b|jwt expired|jwt is expired|not_authenticated|invalid (?:jwt|token)/i.test(raw)
      || /invalid refresh token|refresh token not found|refresh_token_not_found|refresh_token_already_used|session_expired|\binvalid_grant\b|auth session missing/i.test(raw);
}

/** Enumerated columns only (never select('*')) — the league_members SELECT
 *  grant itself already excludes claim_code/claim_code_expires_at (0002_rls
 *  A2), but this file enumerates its OWN narrower list on top of that, per
 *  the task's explicit instruction, and embeds `leagues(name)` via the FK
 *  PostgREST already has (league_members.league_id -> leagues.id). */
export async function getMemberships(op = null) {
  // SEC F2 / reviewer N4 — AD-06 loud-fail. This used to `return []` when the
  // client could not be built (no vendored SDK on the page, no supabaseUrl, no
  // anon key). An empty list is indistinguishable from "this account genuinely
  // belongs to no league," which is exactly the state DI-181a renders a
  // join/create landing for — so an infrastructure failure was being shown to
  // one of the six real players as "you're not in a league yet." That is the
  // silent-fallback shape AD-06 exists to forbid. It throws now; every caller
  // surfaces a visible banner and NEVER the landing.
  if (!_cfg.supabaseUrl || !_cfg.supabaseAnonKey) {
    throw new AuthUnavailableError('Supabase project URL/anon key are not configured.');
  }
  const client = ensureClient();
  if (!client) {
    throw new AuthUnavailableError('The Supabase SDK is not loaded on this page.');
  }
  // SECURITY (fourth gate, 2026-09-17) — THIS ERROR USED TO BE DROPPED.
  // The destructuring was `const { data: sessData } = await …`, which threw the
  // `error` half away. Two consequences the security reviewer named: a GoTrue
  // rejection HERE (a dead refresh token the SDK discovered while rehydrating)
  // became an indistinguishable "no uid", i.e. the honest-but-mute "could not
  // ask" answer below — so the PostgREST read was in practice the ONLY live
  // trigger for the whole expiry path; and any other SDK failure vanished with
  // no console trace at all. Handled deliberately now: an expiry shape is
  // re-thrown so the ONE classifier in refreshMembershipsAndSession() judges it
  // (never a second copy of that judgement here), anything else is reported
  // loudly and then falls through to the unchanged `!uid` answer.
  const { data: sessData, error: sessErr } = await client.auth.getSession();
  if (sessErr) {
    if (isSessionExpiredError(sessErr)) throw sessErr;
    console.warn('[auth] client.auth.getSession() reported an error while reading memberships', sessErr);
  }
  const uid = sessData?.session?.user?.id;
  // SEC F2 (second pass) — WHAT THIS DOES WHEN THE READ COMES BACK EMPTY.
  // No signed-in user is not an error (the gate owns that state) but it is
  // also NOT the answer "this account belongs to zero leagues": nobody was
  // asked. `return []` made those two indistinguishable, and the SDK has a
  // real window where they diverge — hasValidSupabaseSession() reads an
  // unexpired token straight off localStorage while client.auth.getSession()
  // is still rehydrating it, so a founding member's boot could resolve
  // "signed in" and "zero leagues" in the same tick and be shown DI-181a's
  // "You're not in a league yet". null is the closed answer: could not ask.
  // refreshMembershipsAndSession() leaves _membershipsCache at null on it, so
  // hasResolvedMemberships() stays false and the landing stays unreachable.
  if (!uid) return null;
  // ── SECURITY F-1 (sixth gate) — THE READ MAY NOT ADOPT AN ACCOUNT FOR A
  //    DEVICE THAT HAS ALREADY MOVED ON ─────────────────────────────────────
  // `await client.auth.getSession()` is a round trip of its own, and a Sign Out
  // (or a handover) can land inside it. Adopting `uid` after that would write
  // the DEPARTED account id back over the signed-out state and then spend a
  // second round trip reading its league rows.
  if (op && _identityEpochMoved(op)) {
    _warnStaleIdentity('a membership read (at the account-adoption step)');
    return null;   // "could not ask" — the one answer that writes nothing
  }
  // Instrumented write (term 1), through the ONE setter so the identity epoch
  // moves with it. Notified immediately rather than at the end of the read: if
  // this device has been handed to a different Google account, the app must not
  // spend the width of a network round trip still believing it belongs to the
  // previous one.
  if (_setAccountUserId(uid, { reason: 'memberships-read' }) && op) {
    // The bump this read CAUSED is its own; it must not invalidate itself. Any
    // bump from anywhere else still does.
    op.epoch = _identityEpoch;
  }
  const { data, error } = await client
    .from('league_members')
    .select('league_id, id, role, display_name, active, leagues(name)')
    .eq('user_id', uid)
    .eq('active', true);
  if (error) throw error;
  return (data || []).map(row => ({
    leagueId: row.league_id,
    memberId: row.id,
    role: row.role,
    displayName: row.display_name,
    leagueName: row.leagues?.name || '',
  }));
}

/**
 * ══ REVIEWER F1 — ONE MEMBERSHIP READ IN FLIGHT AT A TIME ════════════════════
 *
 * THE FINDING, restated as the sequence: every supabase boot calls this TWICE,
 * concurrently — once from applyAuthModeDecision() (app.js, the warm-return
 * kick-off) and once from the SDK's INITIAL_SESSION handler
 * (_handleAuthStateChange above). Two reads, one cause of failure, two expiry
 * classifications in the same tick. With DI-180p counting CALLS that was strike
 * two on the first boot; even with the counter fixed it is two PostgREST round
 * trips per boot for one answer.
 *
 * So preference-free calls COALESCE: the second caller awaits the first
 * caller's promise and gets the same result (or the same rejection — every
 * existing caller already has its own .catch()).
 *
 * WHAT IS DELIBERATELY *NOT* COALESCED, and why:
 *   • a call carrying `preferMemberId`/`preferLeagueId` — joinLeague() and
 *     createLeague() pass "this is the league the player just asked for", and
 *     folding that into an in-flight preference-FREE read would silently drop
 *     the preference and leave the new league unselected (reviewer F-1/F-2's
 *     defect, re-entered through the coalescer).
 *   • the re-read a successful verification triggers (`_afterVerifyReread`) —
 *     it runs INSIDE the in-flight call, so sharing would make it await itself.
 * Both are therefore run on their own, which is also the honest answer: they
 * are different questions from the one already in flight.
 *
 * Refetches memberships, auto-resolves the active league for the "exactly one
 * membership" case (DI-181c/g — no screen at all), and recomputes the
 * synthesized session. Called after every sign-in/token-refresh and after
 * DI-181's join/create actions.
 */
let _membershipRefreshInFlight = null;   // null | { epoch, promise }
export async function refreshMembershipsAndSession({ preferMemberId = null, preferLeagueId = null, _afterVerifyReread = false } = {}) {
  const shareable = !preferMemberId && !preferLeagueId && !_afterVerifyReread;
  // ── SECURITY F-1 (sixth gate) — THE LATCH IS KEYED ON THE IDENTITY EPOCH ──
  // Coalescing is a promise that two callers are asking the SAME QUESTION. Two
  // callers under two different identities are not: reproduction (B) is a
  // handset handed from A to B while A's read is out, where B's own
  // preference-free read was folded into A's promise and B received A's rows,
  // A's league and A's commissioner role — over ONE network call, so not even
  // the request count gave it away.
  if (shareable && _membershipRefreshInFlight && _membershipRefreshInFlight.epoch === _identityEpoch) {
    return _membershipRefreshInFlight.promise;
  }
  const run = _refreshMembershipsAndSessionOnce({ preferMemberId, preferLeagueId, _afterVerifyReread });
  if (shareable) {
    const entry = { epoch: _identityEpoch, promise: run };
    _membershipRefreshInFlight = entry;
    // The latch is dropped when the run SETTLES, either way. The extra
    // `.catch()` is there so storing the promise cannot turn a rejection every
    // caller already handles into an unhandled one.
    run.catch(() => {}).then(() => { if (_membershipRefreshInFlight === entry) _membershipRefreshInFlight = null; });
  }
  return run;
}

/** The worker — the body this function has always had. Never called directly
 *  except through the single-flight gate above (and by the two cases that are
 *  deliberately not shared). */
async function _refreshMembershipsAndSessionOnce({ preferMemberId = null, preferLeagueId = null, _afterVerifyReread = false } = {}) {
  // SECURITY F-1 / I6 — this run belongs to the identity that issued it. `op` is
  // that claim, checked at every point where the run would otherwise WRITE
  // something (the cache, the pointer, the lock, an emit).
  const op = { epoch: _identityEpoch };
  let list;
  try {
    list = await getMemberships(op);
  } catch (err) {
    // I6, first checkpoint — the failure belongs to somebody who has left. Do
    // not raise a banner for them, do not lock the CURRENT player's privileges
    // on their 401, and do not start a verification round on their behalf. The
    // rejection is still handed back, because every caller has its own catch.
    if (_identityEpochMoved(op)) { _warnStaleIdentity('a failed membership read'); throw err; }
    // SEC F2 / reviewer N4 — latch the failure, tell every listener, and leave
    // _membershipsCache at null. null is "never resolved", which is what
    // hasResolvedMemberships() reports and what needsLeagueFlowScreen() needs
    // in order to be structurally incapable of rendering the join/create
    // landing over an infrastructure failure. Re-thrown so existing callers'
    // own .catch()es still see it.
    _membershipsError = err;
    // SEC F4 — an expired/rejected JWT is a DIFFERENT failure from an
    // unreachable sign-in service, and telling a player the wrong one sends
    // them to reset their wifi when what they need is one tap on "Sign In".
    // Classified here, once, so both the banner choice and the expiry latch
    // read the same judgement.
    const expired = isSessionExpiredError(err);
    if (!expired) {
      _authListeners.forEach(fn => {
        try { fn('MEMBERSHIPS_FAILED', { error: err, expired: false }); }
        catch (e) { console.warn('[auth] listener failed', e); }
      });
      throw err;
    }
    _sessionExpired = true;
    // ── DI-180p — LOCK NOW, DESTROY ONLY ON PROOF ────────────────────────────
    // The lock: every privileged surface reads signed-out from this instant
    // (getSupabaseSession() forces isAdmin false while _privilegeHeld), so a
    // commissioner panel is never left painted over a session the server has
    // rejected — which is the whole of what SEC S-4 was protecting. The lock
    // costs nothing if we turn out to be wrong, and it does NOT move the
    // identity tuple, so no draft is suspended by a false alarm.
    _privilegeHeld = true;
    // The banner goes up BEFORE the verification round trip: the player is
    // owed the news immediately, and `verified:false` tells app.js this is the
    // provisional half.
    _authListeners.forEach(fn => {
      try { fn('MEMBERSHIPS_FAILED', { error: err, expired: true, verified: false }); }
      catch (e) { console.warn('[auth] listener failed', e); }
    });
    // A re-read triggered BY a successful verification is not allowed to run
    // its own verification round (that is how one 401 would become an infinite
    // refresh loop); it counts as strike two instead, which is exactly what
    // "a second consecutive 401 in the same page" means.
    //
    // SECURITY FINDING 6 — THIS IS A PER-CALL ARGUMENT NOW, not a module-global
    // depth counter. The counter was shared by every concurrent caller, so an
    // UNRELATED expiry classification that happened to land inside the re-read
    // window was short-circuited straight to 'dead' — destroying a session that
    // had never been verified at all. An argument cannot leak between calls.
    //
    // ── REVIEWER F3 (SIXTH gate, 2026-09-17) — THE RE-READ RESOLVES 'unknown',
    //    NOT 'dead' ───────────────────────────────────────────────────────────
    // This line used to be `_afterVerifyReread ? 'dead' : …`, which is a THIRD
    // destroy trigger and one that appears nowhere in the state table — i.e. a
    // violation of I4 ("the destroy is reachable only from S1/S3 via E4"). The
    // sequence it produced, with no second round anywhere in it: a 401 -> the
    // refresh proves the session ALIVE -> the strike counter is RESET to zero ->
    // the single confirming re-read hits the same flaky 401 (a rotated key and a
    // slow clock are both persistent for minutes, so this is the LIKELY case,
    // not the unlucky one) -> destroyed, with strikes at 0 and the SDK having
    // just told us the refresh token works.
    //
    // 'unknown' is the honest answer and the fail-closed one: keep the lock,
    // keep the banner, open no round of its own (that rule was the whole reason
    // for the flag — a re-read that verified would be an infinite refresh loop),
    // and destroy nothing. The NEXT expired classification in this page opens a
    // genuine second round, which is exactly what DI-180p means by "a second
    // consecutive 401".
    const verdict = _afterVerifyReread ? 'unknown' : await _verifySessionStillAlive(err);
    // I6, second checkpoint — the verdict may have taken a network round trip,
    // and the person at the device can have changed inside it. A stale 'alive'
    // releases nothing; a stale anything destroys nothing.
    if (_identityEpochMoved(op)) { _warnStaleIdentity('a session-verification verdict'); throw err; }
    if (verdict === 'alive') {
      // Nothing was wrong. Nothing was destroyed, nothing was suspended, and no
      // identity term ever moved — so there is no delta to announce. The release
      // goes through the ONE release routine (reviewer F2) so this path and
      // every other proven-good path cannot drift apart.
      _releaseExpiryHoldOnProof('verification-alive');
      try { await refreshMembershipsAndSession({ preferMemberId, preferLeagueId, _afterVerifyReread: true }); }
      catch (e) { console.warn('[auth] membership re-read after a successful refresh failed', e); }
      throw err;
    }
    if (verdict !== 'dead') {
      // 'unknown' — we still cannot tell. Fail closed on the LOCK (it stays on,
      // the banner stays up) and fail SAFE on the data: destroy nothing. The
      // next expired classification in this page is strike two and destroys.
      //
      // Written as `!== 'dead'` rather than `=== 'unknown'` deliberately: the
      // destroy below is the one irreversible act in this module, and it must be
      // reachable ONLY by a verdict that explicitly says so. 'stale' (a round
      // discarded by the epoch guard) lands here too, which is belt to the
      // braces of the checkpoint above.
      throw err;
    }
    // ── SEC S-4 — AN EXPIRED SESSION HAS TO BE TAKEN OFF THE DEVICE ──────────
    // Reached only with proof (verdict 'dead'). The old code set a banner latch
    // and changed NOTHING else: the dead access token stayed in localStorage, so
    // hasValidSupabaseSession() kept answering TRUE; `_membershipsCache` kept
    // its last good rows, so the synthesized session kept deriving a playerId
    // and — for a commissioner — isAdmin:true. The result on screen was a full
    // commissioner panel painted over a session the server had already
    // rejected, with one banner at the top of it.
    //
    // Every clear below goes through the INSTRUMENTED writes (the prefix sweep,
    // then _recomputeSynthesizedSession() via the batch) so app.js's chokepoint
    // is told, exactly as it is on every other identity change. Batched with
    // emitsOwnEvent because MEMBERSHIPS_FAILED is emitted immediately after and
    // app.js routes it into the same chokepoint.
    //
    // The active-league POINTER is deliberately left alone: the player is about
    // to sign back into the same league, and re-scoping the device is not part
    // of "your token died". A9 keeps it exempt on this path for the same
    // reason (it is an opaque id and grants nothing on its own).
    _clearExpiredSessionFromDevice(err);
    throw err;
  }
  // ── SECURITY F-1 (sixth gate), I6's LOAD-BEARING CHECKPOINT ───────────────
  // THIS is reproduction (A): a supabase boot kicks off the read, the player
  // taps Sign Out mid-round-trip, and the read LANDS. Everything below this line
  // writes: `_membershipsCache` gets the departed player's rows, the lock is
  // released on their evidence, setActiveLeagueId() auto-resolves their league,
  // the synthesized session recomputes — and a device with no token on it
  // answers getSession() = {playerId:'mA', isAdmin:true}. So the run stops here,
  // with the same "could not ask" answer a race already produces: no cache
  // write, no pointer move, no release, no emit. One warning, and nothing else.
  if (_identityEpochMoved(op)) { _warnStaleIdentity('a successful membership read'); return null; }
  // SEC F2 — "could not ask" (see getMemberships()). NOT an error and NOT a
  // resolved answer: leave the cache at null, leave the active-league pointer
  // alone (a race must never re-scope a device), emit nothing that could be
  // read as a resolved membership set, and tell the caller by returning null.
  if (list === null) return null;
  _membershipsError = null;
  _membershipsCache = list;
  // ── REVIEWER F2 — A SUCCESSFUL READ IS PROOF, SO IT RELEASES THE LOCK ──────
  // The server accepted this JWT and answered with rows. That is the strongest
  // evidence available in this build that the session is alive, so an 'unknown'
  // verdict's lock (and its strike) may not outlive it. Called AFTER the cache
  // is assigned, so a listener woken by SESSION_REVERIFIED reads the new
  // memberships, and BEFORE the batch/emit below, so the privilege restored here
  // is visible to the MEMBERSHIPS_REFRESHED repaint that follows.
  // No-op (and silent) when nothing was held, which is every ordinary boot.
  _releaseExpiryHoldOnProof('memberships-read-succeeded');
  // ── THE POINTER MOVES BEFORE THE EVENT, ALWAYS (reviewer F-1/F-2, 3rd pass) ─
  // `preferMemberId`/`preferLeagueId` exist so joinLeague()/createLeague() can
  // say "this is the league the player just asked for" BEFORE this function
  // emits. They used to call setActiveLeagueId() AFTER the await — i.e. after
  // the last event had already gone out — which is precisely how identity moved
  // with nothing routing through app.js's chokepoint. Passing the preference in
  // makes the emitted tuple the FINAL one, and makes a trailing pointer write
  // unnecessary rather than merely discouraged.
  let activeId = getActiveLeagueId();
  const preferred = preferMemberId ? list.find(m => m.memberId === preferMemberId)
                  : preferLeagueId ? list.find(m => m.leagueId === preferLeagueId)
                  : null;
  _withIdentityBatch(() => {
    if (preferred) {
      activeId = preferred.leagueId;
      setActiveLeagueId(activeId);
    } else if (!(activeId && list.some(m => m.leagueId === activeId))) {
      activeId = (list.length === 1) ? list[0].leagueId : null;
      setActiveLeagueId(activeId);   // also recomputes the synthesized session
    } else {
      _recomputeSynthesizedSession();
    }
  }, { emitsOwnEvent: true });
  // ── DI-180q — BEFORE THE EVENT THAT PAINTS ────────────────────────────────
  // This is the one moment a sign-in is RESOLVED: the account id is known and
  // the active-league pointer has settled one line above. It runs HERE, and not
  // in app.js's chokepoint, for two reasons that are the same reason: the emit
  // on the next line is what makes app.js repaint, so "clear before first paint"
  // is a fact about the order of these two statements; and the chokepoint only
  // fires when the identity tuple MOVED, which is precisely the case DI-180q
  // exists for the absence of (A's sign-in died before the app ever learned who
  // A was, so there is no previous tuple to differ from).
  reconcileDeviceDataOwner('memberships-resolved');
  _authListeners.forEach(fn => {
    try { fn('MEMBERSHIPS_REFRESHED', { memberships: list, activeLeagueId: activeId }); }
    catch (e) { console.warn('[auth] listener failed', e); }
  });
  return list;
}

/** DI-181 "Join a League" — p_code is the LEAGUE join code (leagues.join_code,
 *  distinct from DI-183's per-player claim code, out of scope here). Throws
 *  on an invalid/closed code (`invalid_code` from join_league()'s own RAISE
 *  EXCEPTION); the caller renders DI-181d's inline error. On success,
 *  refetches memberships and makes the newly-joined league active — DI-181c
 *  "routes straight to that league's dashboard (skips DI-181's own
 *  selector)". */
export async function joinLeague(code) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  // join_league() RETURNS the member row's own id (v_member_id, or the
  // existing one if already joined — it's idempotent), which is a precise
  // key to find the just-joined league by after refetching, rather than
  // diffing old/new membership lists.
  const { data: memberId, error } = await client.rpc('join_league', { p_code: String(code || '').trim() });
  if (error) throw error;
  // REVIEWER F-1/F-2 (third pass) — THE POINTER IS NOT WRITTEN HERE ANY MORE.
  //
  // This used to be `await refreshMembershipsAndSession()` followed by
  // `if (joined) setActiveLeagueId(joined.leagueId)`. That trailing line moved
  // the active league — and therefore getSession().playerId, and therefore the
  // identity — AFTER the refresh had emitted its last event, so nothing routed
  // through app.js's chokepoint: League A's draft picks, tiebreaker, Extra Point
  // guess and layoutEditing survived into League B, League B's pushes still went
  // to A's OneSignal binding, and the chokepoint's latch was left holding A's
  // key, so the next background TOKEN_REFRESHED read as an identity change and
  // wiped a draft the player had legitimately entered in B.
  //
  // Handing the preference DOWN instead means the pointer is written, the
  // session recomputed, and THEN one event emitted carrying the final tuple —
  // the order the reviewer asked for, and one reset instead of two.
  //
  // SEC F2 — refreshMembershipsAndSession() returns null for "could not ask".
  // `(list || [])` rather than a bare .find(), so a race can never turn a
  // successful join into a TypeError the player reads as a failed join.
  const list = await refreshMembershipsAndSession({ preferMemberId: memberId });
  return (list || []).find(m => m.memberId === memberId) || null;
}

/** DI-181 "Create a League" — create_league(p_name) returns the new league's
 *  uuid; the caller becomes its commissioner (create_league's own INSERT).
 *  Same post-success shape as joinLeague(). */
export async function createLeague(name) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { data: leagueId, error } = await client.rpc('create_league', { p_name: String(name || '').trim() });
  if (error) throw error;
  // Same shape, same reason as joinLeague() above — and a sharper case, because
  // creating a league also flips role player -> commissioner, so the identity
  // that moved with nothing watching carried isAdmin with it.
  await refreshMembershipsAndSession({ preferLeagueId: leagueId });
  return leagueId;
}

/**
 * A league switch failed to bring the new league's data down. Typed so app.js
 * can keep DI-181c's blocking overlay UP and name the failure, rather than
 * treating the throw as "the switch did not happen" — it DID: the pointer has
 * moved, the mirror is gone, and the adapter is HELD for the new league.
 */
export class LeagueSwitchFailedError extends Error {
  constructor(leagueId, reason) {
    super(`Switched to that league, but its data could not be loaded (${reason || 'hydrate failed'}). `
      + 'Nothing from the league you left was changed. Retry in a moment.');
    this.name = 'LeagueSwitchFailedError';
    this.code = 'league_switch_failed';
    this.leagueId = leagueId || null;
  }
}

/** §3.3 — the banner has to name BOTH leagues, and at the moment the adapter
 *  refuses a queued write the ACTIVE pointer may not have moved yet. So the
 *  destination is held here for the width of the switch and the adapter's
 *  injected `getLeagueName()` reads it. Null at every other instant, so the
 *  accessor degrades to "the active league", which is what it means elsewhere. */
let _pendingSwitchToLeagueId = null;
/** @internal — read by the accessors js/app.js injects into the adapter. */
export function _leagueNameById(leagueId) {
  const m = (_membershipsCache || []).find(x => x.leagueId === leagueId);
  return m ? m.leagueName : '';
}
export function _switchBannerLeagueName() {
  return _leagueNameById(_pendingSwitchToLeagueId || getActiveLeagueId());
}

/**
 * DI-181c "Switching leagues…" — sets the new active league and re-derives
 * the synthesized session immediately (same tick, DI-184h).
 *
 * ══ STEP 4 PART B (§3.2) — THE Step-4 TODO IS FILLED ═════════════════════════
 *
 * The stub is gone. The sequence below is §3.2's, in its order, and the ORDER
 * IS THE DESIGN:
 *
 *   SWITCH_START           app.js paints the blocking overlay (already built)
 *   sb.beginSwitch(A, B)   SWITCHING; Realtime down; the mirror and the device
 *                          snapshot DROPPED; any queued write refused LOUDLY
 *                          under A's name and NOT re-queued under B (UN-184).
 *                          BEFORE the pointer moves, so there is no instant at
 *                          which the header pill says B while the mirror still
 *                          holds A's picks.
 *   setActiveLeagueId(B)   the ONE pointer write
 *   reconcileDeviceDataOwner()   CLEAR FIRST, MARK LAST — the chat cache,
 *                          cursors and outbox that are league-scoped
 *   sb.switchLeague(B)     prime from the snapshot (normally 0 — the marker has
 *                          just moved), then AWAIT the hydrate, then subscribe
 *   SWITCH_END             only now, and only on success
 *
 * A HYDRATE FAILURE DOES NOT EMIT SWITCH_END. It throws instead: the overlay
 * stays up, the banner names the failure, and the adapter is HELD for B. A
 * half-hydrated league is never painted as if it were whole — DI-181c's
 * blind-rule obligation ("never allowing taps through to a half-hydrated
 * view"), which is only honest if the event that takes the overlay down is
 * gated on the data actually being there.
 *
 * In `dataMode:'sheets'` every adapter line below is skipped and this function
 * is byte-identical to the Step 3a stub. Never called for the six current
 * players (single membership — DI-181g).
 */
export async function switchActiveLeague(leagueId) {
  if (!(_membershipsCache || []).some(m => m.leagueId === leagueId)) {
    throw new Error('Not a member of that league');
  }
  const fromLeagueId = getActiveLeagueId();
  // Security F-6 — every emit in this module reports a failing listener on the
  // same console channel. A bare `catch {}` here meant a listener that threw
  // took its own event down silently, on a path (a league switch) whose whole
  // job is blocking every write surface until it settles.
  _authListeners.forEach(fn => {
    try { fn('SWITCH_START', { leagueId }); }
    catch (e) { console.warn('[auth] listener failed', e); }
  });
  // ── §3.2 STEP 1 — the mirror goes BEFORE the pointer moves ────────────────
  const supabaseData = isSupabaseDataMode();
  if (supabaseData) {
    _pendingSwitchToLeagueId = leagueId;
    try { sb.beginSwitch(fromLeagueId, leagueId); }
    catch (e) { console.warn('[auth] the data adapter could not begin the league switch', e); }
  }
  // Batched with emitsOwnEvent: SWITCH_END goes out below and app.js routes it
  // into the chokepoint, so the pointer write is announced exactly once, by the
  // event that already describes it.
  _withIdentityBatch(() => {
    setActiveLeagueId(leagueId);
  }, { emitsOwnEvent: true });
  // DI-180q — the SECOND angle on "a resolved sign-in". The account has not
  // changed, but the LEAGUE term of the marker has, and the chat cache, the read
  // cursors and the unread counts are all league-scoped: one account switching
  // between two leagues must not inherit the other league's cached room. Before
  // SWITCH_END, for the same paint-ordering reason as the membership path.
  reconcileDeviceDataOwner(`league-switch:${leagueId}`);
  // ── §3.2 STEP 2 — prime, then AWAIT the hydrate, before SWITCH_END ────────
  if (supabaseData) {
    let result = null;
    try {
      // `switchLeague()` re-enters beginSwitch() (idempotent: the mirror is
      // already empty and the dirty queue already refused, so the second call
      // only bumps the switch token again — which can never make a stale write
      // look fresh, only staler). Using the adapter's own exported sequence
      // rather than re-assembling prime/hydrate/subscribe here keeps ONE
      // definition of what a switch does to the data layer.
      result = await sb.switchLeague(leagueId, { from: fromLeagueId });
    } catch (e) {
      result = { ok: false, error: String((e && e.message) || e) };
    }
    _pendingSwitchToLeagueId = null;
    if (!result || result.ok !== true) {
      // NO SWITCH_END. app.js's overlay stays up, and the throw carries the
      // copy the banner shows. The pointer HAS moved and the mirror IS gone —
      // that is the fail-closed direction: an empty, held league is honest,
      // where a painted half-league is not.
      console.error(`[auth] the league switch to ${leagueId} completed its pointer flip but the data hydrate did not land`
        + ' — holding the switching overlay rather than emitting SWITCH_END over a half-loaded league.');
      throw new LeagueSwitchFailedError(leagueId, result && result.error);
    }
  }
  _authListeners.forEach(fn => {
    try { fn('SWITCH_END', { leagueId }); }
    catch (e) { console.warn('[auth] listener failed', e); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3b (DI-182 / DI-183) — CLAIM CODES, LINKING, AND MEMBER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
/**
 * EVERY WRAPPER BELOW HAS THE SAME SHAPE, AND IT IS joinLeague()'s:
 *
 *     RPC  →  refreshMembershipsAndSession()  →  return
 *
 * never a bare local state flip. The reason is the one the third-pass reviewer
 * wrote up on joinLeague() itself: refreshMembershipsAndSession() is the ONLY
 * function that recomputes `_synthesizedSession`, and therefore the only one
 * that can move `getSession().isAdmin` and `getSession().playerId`. A wrapper
 * that wrote the server and then flipped a local flag would leave the app
 * rendering the OLD role — which for a demotion means a demoted commissioner
 * keeps every Comm-tab affordance until the next boot (DI-182i's explicit
 * must-not), and for a link means the confirmation card paints under the
 * previous identity.
 *
 * THE TWO CODE TYPES ARE NOT INTERCHANGEABLE, and this is the crux of DI-183's
 * blind-rule answer (brief §3d). They are different credentials with different
 * server functions:
 *   • the LEAGUE JOIN code (`leagues.join_code`) → joinLeague() → join_league().
 *     It makes the caller a NEW member of a league.
 *   • the MEMBER CLAIM code (`league_members.claim_code`) → linkMember() →
 *     link_member(). It attaches the caller's account to an EXISTING member row
 *     that already has a season of history on it.
 * Handing one to the other's RPC must produce that RPC's own honest rejection,
 * never a "close enough" accept. The client validates SHAPE first (below) and
 * the server's error is always the final word.
 */

/** Both codes are 8 characters from `[A-Z2-9]` (no 0/O/1/I — a transcription-
 *  safe alphabet). The shapes are IDENTICAL today, which is exactly why the
 *  client must never treat "it looks like a code" as "it is the right KIND of
 *  code" — see the note above. This is a typo filter, nothing more: it saves a
 *  round trip on obvious mistakes (a pasted URL, six characters, a dash someone
 *  added themselves) and has no authority over a well-formed code. */
const CLAIM_CODE_RE = /^[A-Z2-9]{8}$/;
export const _CLAIM_CODE_RE_FOR_TEST = CLAIM_CODE_RE;
/** Normalise the way the server does before comparing: `upper(trim(p_code))`.
 *  Spaces and a hyphen a player inserted themselves are stripped, because the
 *  commissioner reads the code aloud over the phone at least once. */
export function normalizeClaimCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[\s-]/g, '');
}
/** @returns {boolean} true when `raw` could be a claim code at all. NEVER used
 *  to decide that a code is VALID — only to decide whether asking the server is
 *  worth a round trip. */
export function isClaimCodeShape(raw) {
  return CLAIM_CODE_RE.test(normalizeClaimCode(raw));
}

/**
 * DI-183e — THE AUTO-LINK. `link_member_by_email()` matches the caller's
 * VERIFIED Google email against unlinked `league_members` rows and attaches
 * them. Zero matches is NOT an error (the TECH doc says so explicitly, and the
 * base DI calls it "not a failure state"): it is the expected path for anyone
 * whose Google address differs from the one on file, and the caller routes them
 * to the claim-code screen in the same tick.
 *
 * @returns {Array<{leagueId:string, memberId:string}>} the rows linked — empty
 *          when nothing matched.
 */
export async function linkMemberByEmail() {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { data, error } = await client.rpc('link_member_by_email');
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : (data ? [data] : []))
    .map(r => ({ leagueId: r.league_id, memberId: r.member_id }))
    .filter(r => r.leagueId && r.memberId);
  if (!rows.length) return [];
  // A link is an identity change: the caller now IS a member they were not a
  // member of a moment ago. preferMemberId points the refresh at the row that
  // was just claimed, exactly as joinLeague() does — link_member_by_email()
  // returns the same {league_id, member_id} tuple join_league does, so no new
  // plumbing is needed for it.
  await refreshMembershipsAndSession({ preferMemberId: rows[0].memberId });
  return rows;
}

/**
 * DI-183e — THE CLAIM CODE. `link_member(p_code)` attaches the caller's account
 * to one existing member row.
 *
 * FOUR DISTINCT SERVER ERRORS, and the caller must be able to tell them apart
 * (brief §2's flagged copy gap — the base DI wrote ONE error string for what
 * are actually four outcomes): `invalid_code`, `code_expired`, `already_linked`
 * (somebody has already claimed that row), `already_member` (the caller is
 * already in that league). They are rethrown unchanged — the client maps them to
 * copy, it never decides them.
 *
 * @returns {{leagueId:string, memberId:string}}
 */
export async function linkMember(code) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const normalized = normalizeClaimCode(code);
  // SHAPE FIRST, SERVER LAST. A code that cannot possibly be one is refused
  // here so the player gets an instant answer instead of a round trip — but the
  // instant a code is well-formed, the server is the only authority on whether
  // it is real, unexpired, unclaimed and not the caller's own league.
  if (!CLAIM_CODE_RE.test(normalized)) {
    throw Object.assign(new Error('That code is not the right shape.'), { code: 'invalid_code', clientShapeCheck: true });
  }
  const { data, error } = await client.rpc('link_member', { p_code: normalized });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) || null;
  if (!row || !row.league_id || !row.member_id) {
    // The RPC succeeded and returned nothing usable. Fail LOUD rather than
    // painting "you're linked" over an unknown state — a confirmation card is
    // the control DI-183h forbids skipping, and a card shown over nothing is
    // worse than no card.
    throw Object.assign(new Error('The link did not come back with a member to confirm.'), { code: 'invalid_code' });
  }
  await refreshMembershipsAndSession({ preferMemberId: row.member_id });
  return { leagueId: row.league_id, memberId: row.member_id };
}

/**
 * DI-183e "This isn't me" AND DI-182e "Unlink Account" — ONE implementation,
 * two callers, per the brief's §4 ruling. `unlink_member(p_league, p_member)`.
 *
 * DESTRUCTIVE FIRST. The base DI's own coordinator annotation is unambiguous:
 * the mis-link has already granted this account read and write access to another
 * player's picks, so it "cannot stay in place for one second longer than
 * needed." The RPC goes out BEFORE anything paints; the refresh follows; the
 * claim-code screen is rendered by the caller only after both have returned.
 */
export async function unlinkMember(leagueId, memberId) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { error } = await client.rpc('unlink_member', { p_league: leagueId, p_member: memberId });
  if (error) throw error;
  // The refresh does two jobs here: it drops the disputed membership out of the
  // synthesized session, and it drops the ROLE that membership may have granted.
  // For the commissioner acting on somebody ELSE's row this changes nothing
  // about their own identity (correct — their account/league tuple has not
  // moved, so no epoch bump fires), and it still re-renders the member card.
  //
  // ══ REVIEWER F-E (audit #11) — THE TWO FAILURES ARE NOT THE SAME FAILURE ═══
  //
  // Until now both threw the same way, so every caller reported "we couldn't
  // unlink that" for BOTH. One of those messages is a lie, and it is the
  // dangerous direction: the unlink has ALREADY HAPPENED server-side. The row is
  // unlinked, the disputed account has lost its access — which is the entire
  // point of the control — and the player is told it failed and invited to try
  // again. The retry then calls `unlink_member` on a row that is no longer
  // theirs, `my_member_id()` no longer returns that id, and the server answers
  // `not_commissioner`. So the honest outcome reads as a hard failure, twice,
  // and the player ends up telling their commissioner that "This isn't me" is
  // broken when it worked the first time.
  //
  // A DISTINCT ERROR TYPE, not a flag, so a caller cannot forget to check it:
  // an `instanceof`/`.code` test is the shape every other refusal in this module
  // already uses, and a boolean on a thrown Error is the kind of thing that gets
  // dropped by a `catch (e) { showToast(e.message) }`.
  try {
    await refreshMembershipsAndSession();
  } catch (e) {
    throw Object.assign(
      new Error('The unlink succeeded, but this page could not refresh afterwards.'),
      { code: 'unlink_refresh_failed', unlinkApplied: true, cause: e },
    );
  }
}

/**
 * DI-182i — THE CLAIM CODES, READ THE ONLY WAY THEY MAY BE READ.
 *
 * `get_claim_codes(p_league)`, INVOKER, `is_commissioner`-guarded server-side.
 * NEVER a select of `claim_code` off `league_members`: the `authenticated`
 * SELECT grant on that table is a COLUMN LIST that deliberately excludes
 * `claim_code`/`claim_code_expires_at` (TECH doc annotation A2), because an
 * unclaimed code is a bearer credential. A generic member-list read that asked
 * for the column would not leak it — it would fail with a column-privilege
 * error — but it would also mean the client had a code-shaped hole in it that
 * a later grant change could quietly fill. There is one path, and this is it.
 *
 * @returns {Array<{memberId:string, claimCode:string, expiresAt:string|null}>}
 */
export async function getClaimCodes(leagueId) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { data, error } = await client.rpc('get_claim_codes', { p_league: leagueId });
  if (error) throw error;
  return (data || []).map(r => ({
    memberId: r.member_id,
    claimCode: r.claim_code || '',
    expiresAt: r.claim_code_expires_at || null,
  }));
}

/**
 * DI-182e "New Code" / DI-183 issuance — `issue_claim_code(p_league, p_member)`.
 *
 * `p_ttl` IS DELIBERATELY NOT PASSED (brief §4's recommendation, approved). The
 * server clamps to a 7-day default, which is more than enough for six founders
 * being onboarded once; exposing a TTL picker would be "structural depth added
 * for the model's benefit, paid for in taps," which is what DI-181's root driver
 * warns against. It is a one-field addition to the regenerate confirm flow if
 * Drew ever wants it.
 *
 * Re-issuing REPLACES the old code (the RPC is idempotent-by-replacement), so
 * there is no separate revoke call and no window in which two codes are live.
 *
 * @returns {string} the new code.
 */
export async function issueClaimCode(leagueId, memberId) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { data, error } = await client.rpc('issue_claim_code', { p_league: leagueId, p_member: memberId });
  if (error) throw error;
  return String(data || '');
}

/**
 * DI-T7.3 — `get_member_contacts(p_league)`. The ONLY path to a member's email
 * after migration 0007: the contact columns left the member-readable grant, so
 * a commissioner reads them here and a plain member gets back exactly their own
 * row. Never merged into a row this client then writes back — the adapter rule
 * is "never write a contact field you did not read" (DI-T7.6).
 *
 * @returns {Array<{memberId:string, email:string, phone:string, phoneVerified:boolean}>}
 */
export async function getMemberContacts(leagueId) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { data, error } = await client.rpc('get_member_contacts', { p_league: leagueId });
  if (error) throw error;
  return (data || []).map(r => ({
    memberId: r.member_id,
    email: r.email || '',
    phone: r.phone || '',
    phoneVerified: !!r.phone_verified,
  }));
}

/**
 * DI-182b/d — the member list behind the League Members card.
 *
 * WHAT IT DOES NOT ASK FOR IS THE POINT. The column list is explicit and
 * contains no `claim_code`, no `claim_code_expires_at`, no `email`, no `phone`:
 * those three families each have their own commissioner-gated RPC above. An
 * explicit list rather than `select('*')` so a future column added to
 * `league_members` cannot arrive in this render path by default — the same
 * "invisible unless a policy allows it" default UN-182's root driver is about,
 * expressed on the client side too.
 *
 * @returns {Array<{memberId, displayName, role, active, linked, initials, almaMater}>}
 */
export async function listLeagueMembers(leagueId) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { data, error } = await client
    .from('league_members')
    // DI-183e-A2 — `link_disputed_at` joins the list. The column is in the
    // member-readable grant (migration 0009 adds it to 0007's 15), carries no
    // contact value, and is what the commissioner's link-status card renders the
    // dispute warning from. Named explicitly, like every other column here:
    // `select('*')` would let a future column arrive in this render path by
    // default, which is the opposite of the "invisible unless a policy allows
    // it" default UN-182's root driver is about.
    .select('id, display_name, role, active, user_id, initials, alma_mater, link_disputed_at')
    .eq('league_id', leagueId);
  if (error) throw error;
  return (data || []).map(r => ({
    memberId: r.id,
    displayName: r.display_name || '',
    role: r.role || 'player',
    active: r.active !== false,
    // A BOOLEAN, NOT THE ID. `user_id` is the stable cross-league primary key
    // for a person; the card only ever needs to know WHETHER the row is claimed,
    // so the id is collapsed here and never reaches a render path or a log.
    linked: !!r.user_id,
    initials: r.initials || '',
    almaMater: r.alma_mater || '',
    // A TIMESTAMP OR NULL, passed through as the server sent it. Not coerced to
    // '' like the strings above: '' and null both read falsy, but a date this
    // client cannot parse must stay distinguishable from "no dispute" — the card
    // renders a WARNING off this value, and a warning that appears because a
    // string was empty is worse than one that never appears.
    linkDisputedAt: r.link_disputed_at || null,
  }));
}

/**
 * DI-182e "Make Commissioner" / "Make Player" — a scoped UPDATE on
 * `league_members.role`, permitted by that table's UPDATE policy for a
 * commissioner of the league (DI-182g's own "Server proof" column names the
 * policy, not an RPC; there is no `set_member_role` in the approved contract).
 * The server refuses a non-commissioner and refuses demoting the last
 * commissioner (`last_commissioner`); the client never decides either.
 *
 * DI-182i's "immediately, not after a refresh" is the refresh call below: it is
 * the only thing that re-derives `getSession().isAdmin`, so demoting the ACTIVE
 * commissioner flips renderCommPage()'s gate on the very next render.
 */
export async function setMemberRole(leagueId, memberId, role) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  if (role !== 'commissioner' && role !== 'player') {
    throw new Error(`Unknown role "${String(role)}" — the role column is a one-value CHECK enum plus 'player'; a co-commissioner role is deferred (UN-182 adjacent #4).`);
  }
  const { error } = await client
    .from('league_members').update({ role })
    .eq('league_id', leagueId).eq('id', memberId);
  if (error) throw error;
  await refreshMembershipsAndSession();
}

/**
 * DI-182e "Remove from League" — A STATUS WRITE, NEVER A DELETE.
 *
 * DI-182g's acceptance row: "a removed member's history survives." That is
 * server-enforced already (no DELETE policy exists on `picks`/`obligations` —
 * AD-28's Postgres equivalent), and the client's only obligation is to not claim
 * otherwise. So this sets `active=false` and the confirm copy says "Their
 * history is kept, not deleted," which is true of the write this actually makes.
 */
export async function setMemberActive(leagueId, memberId, active) {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured.');
  const { error } = await client
    .from('league_members').update({ active: !!active })
    .eq('league_id', leagueId).eq('id', memberId);
  if (error) throw error;
  await refreshMembershipsAndSession();
}

// ── Sign in / out ─────────────────────────────────────────────────────────────

/** PKCE OAuth, per DI-180. Throws if misconfigured (no client) — the caller
 *  (app.js's gate) is expected to show DI-180c's "Failed" state on rejection. */
export async function signInWithGoogle() {
  const client = ensureClient();
  if (!client) throw new AuthUnavailableError('Supabase client is not configured (missing supabaseUrl/supabaseAnonKey or the vendored SDK).');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: (typeof window !== 'undefined' ? window.location.origin : undefined) },
  });
  if (error) throw error;
}

/**
 * DI-180d/annotation 4 — single tap, no confirm. Clears:
 *   1. The Supabase SDK's own persisted token (client.auth.signOut()).
 *   2. This module's in-memory membership/session cache + active-league
 *      pointer (a second account on this device must not inherit it).
 *   3. The backend.js Sheets mirror's localStorage backup (clearMirror()) —
 *      the EXPORTED accessor, not a reimplementation; the live in-memory
 *      mirror inside backend.js is not cleared here because it is not
 *      league-scoped today (Step 3a's game/pick data still comes from the
 *      ONE shared Sheet regardless of authMode — see this file's header
 *      comment) and backend.js is out of scope for this build beyond its
 *      config-reading function.
 *   4. Chat/notification device-local caches that key off the OUTGOING
 *      player's identity, so the next account never inherits stale read
 *      cursors or a cached notify log. These are read directly by KEY
 *      NAME (not import) because chat.js/chat-ui.js/notifications.js are
 *      out of scope to edit for this build (CLAUDE.md's four-sensitive-file
 *      list + this task's explicit "do not touch chat*.js beyond reading");
 *      the key literals are cited by file:line so a future rename is
 *      grep-able. No page reload (matches the existing PIN-mode "logout"
 *      precedent in app.js, which is clearSession()+re-render, never a
 *      reload).
 */
const _SIGNOUT_LOCAL_KEYS = [
  // SEC F3 — the PIN-mode session record. storage.js's KEYS.SESSION, cited by
  // literal rather than imported because storage.js already imports THIS file
  // (getAuthMode/getSupabaseSession) and the reverse edge would be a cycle;
  // same convention as the chat/notify literals below. Why it must go: in
  // 'supabase' mode getSession() does not read this key, so a stale
  // `{isAdmin:true}` left in it is invisible — until anything puts the device
  // back in 'pins' mode (a rollback, or the config-read downgrade SEC F1-R1
  // closes), at which point it is read straight back as a live commissioner
  // session on a device whose site PIN is already satisfied. Sign-out is the
  // one moment we can be certain nobody wants it kept.
  'cfbp_session',               // js/storage.js KEYS.SESSION
  'cfbp_chat_lastseen2',        // js/chat.js:49  K_LASTSEEN
  'cfbp_chat_outbox2',          // js/chat.js:50  K_OUTBOX — see note below
  'cfbp_chat_epoch_applied',    // js/chat.js:51  K_EPOCH_APPLIED
  'cfbp_chat_events_cache',     // js/chat.js:61  K_EVENTS_CACHE
  'cfbp_chat_seenmap',          // js/chat.js:1161 (legacy key, still cleared there)
  'cfbp_notify_log_cache',      // js/notifications.js:399 K_NOTIFY_LOG_CACHE
  'cfbp_notif_readstate',       // js/notifications.js:400 K_NOTIF_READSTATE
];

/**
 * Enumerate this device's localStorage keys. `Object.keys(localStorage)` works
 * on a real Storage object but not on every stub, and `.length`/`.key(i)` is
 * the interface the spec actually defines — try the specified one first, then
 * fall back to the enumerable one.
 *
 * ══ SECURITY F-1 (EIGHTH gate, 2026-09-18) — AN UNREADABLE STORE MUST NOT READ
 *    AS AN EMPTY ONE. CUTOVER BLOCKER, FIXED HERE ═══════════════════════════════
 *
 * THE FINDING. This used to be one `try { … } catch { return []; }` around BOTH
 * strategies, so a store that throws from `localStorage.length` (iOS private
 * browsing, a partitioned in-app browser, a quota-dead handset, a stub whose
 * getter throws) produced `[]` — indistinguishable from "this device is clean".
 * Three fail-closed rules were defeated by that one value, all in the same
 * direction:
 *   1. `_keysToClear()` enumerated nothing, so `clearDeviceLocalSessionData()`
 *      swept nothing, its post-sweep re-ask was also empty, and it returned
 *      `complete === true`. reconcileDeviceDataOwner() then wrote the owner
 *      marker OVER the previous player's still-present data — and because the
 *      marker now MATCHED, every later boot returned 'kept' and never looked
 *      again. That is the exact RG-51-class outcome the seventh gate's inversion
 *      was meant to close, reachable through the one line the inversion left
 *      fail-OPEN.
 *   2. `_hasDeviceLocalSessionData()` answered "nothing to inherit", which is
 *      the 'adopted' branch — the same leak from the other side.
 *   3. `_removeLocalKeysWithPrefix()` (the PKCE `<storageKey>-…` sweep) removed
 *      nothing and said nothing, leaving half an authorization-code exchange on
 *      a handed-over phone (SEC F3's finding, resurrected).
 *
 * THE FIX. Enumeration failure is now VISIBLE — `{keys, enumerated}` — and each
 * of the three callers above reads `enumerated === false` in ITS OWN fail-closed
 * direction: the clear reports INCOMPLETE (so the marker is left unwritten and
 * the next boot clears again), the "is there anything here" question answers YES
 * (so the device is cleared rather than adopted), and the prefix sweep reports
 * incomplete. The `Object.keys()` fallback now sits in its OWN try OUTSIDE the
 * first one, so a store with a throwing `length` getter but working enumeration
 * is still read correctly instead of being abandoned to `[]`.
 *
 * `_localStorageKeys()` keeps returning a plain array, because every other
 * caller (and every suite) wants the list and not the verdict.
 *
 * @returns {{keys: string[], enumerated: boolean}}
 */
function _enumerateLocalStorageKeys() {
  try {
    if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (typeof k === 'string') out.push(k);
      }
      return { keys: out, enumerated: true };
    }
  } catch { /* fall through to the enumerable interface — NOT to [] */ }
  try {
    return { keys: Object.keys(localStorage).filter(k => typeof k === 'string'), enumerated: true };
  } catch { /* both interfaces are gone: say so, loudly, below */ }
  console.warn('[auth] this device\'s localStorage cannot be ENUMERATED (neither .length/.key(i) nor Object.keys works) — every sweep that depends on it now reports INCOMPLETE rather than clean');
  return { keys: [], enumerated: false };
}
function _localStorageKeys() { return _enumerateLocalStorageKeys().keys; }
/** @returns {boolean} true only when the store could be enumerated AND every
 *  matching key was actually removed. An un-enumerable store returns false —
 *  SECURITY F-1 (eighth gate): "I found nothing" and "I could not look" are not
 *  the same answer, and only one of them is safe to act on. */
function _removeLocalKeysWithPrefix(prefix) {
  const { keys, enumerated } = _enumerateLocalStorageKeys();
  let complete = enumerated;
  for (const k of keys) {
    if (!k.startsWith(prefix)) continue;
    try { localStorage.removeItem(k); } catch (e) { complete = false; console.warn(`[auth] could not remove ${k}`, e); }
  }
  return complete;
}
export const _localStorageKeysForTest = _localStorageKeys;
export const _enumerateLocalStorageKeysForTest = _enumerateLocalStorageKeys;
export const _removeLocalKeysWithPrefixForTest = _removeLocalKeysWithPrefix;

/**
 * ══ SECURITY F-1 (seventh gate, 2026-09-17) — THE SWEEP IS A PREFIX RULE WITH
 *    AN EXPLICIT KEEP-LIST, NOT AN INCLUDE-LIST ════════════════════════════════
 *
 * THE FINDING, as the sequence a real handset reaches. `save()` in js/storage.js
 * writes RAW localStorage whenever the backend mirror is not live — an offline
 * boot, a hydrate that failed behind AD-06's red banner, a device that has not
 * been connected yet. Every league key lands on the handset under `cfbp_`:
 * `cfbp_picks` (all six players' picks), `cfbp_comments` (the whole chat log),
 * `cfbp_players`, `cfbp_notifications`, `cfbp_results`, `cfbp_obligations`,
 * `cfbp_nicknames`, the SCRIBE keys — twenty-two of them. The clear below was an
 * eight-name INCLUDE-list, so all twenty-two survived a handover and survived an
 * explicit Sign Out. The eight names were the ones somebody remembered, which is
 * the same shape as the call-site lists that failed three times earlier in this
 * arc, one layer down.
 *
 * SO IT IS INVERTED. Everything under the app's own `cfbp_` prefix goes, and the
 * only things that stay are named here WITH THEIR JUSTIFICATION. A key added
 * next season is swept by default; forgetting to think about it now costs a
 * re-download, not a leak. (The named `_SIGNOUT_LOCAL_KEYS` list above is kept
 * as DOCUMENTATION — it is what carries the file:line citations and what the
 * suites seed — and it is unioned in, so it can never be weakened by a prefix
 * change either.)
 *
 * WHAT IS KEPT, AND WHY EACH ONE:
 *   • `cfbp_site_unlocked` — the SITE PIN gate. It records that this DEVICE got
 *     through the front door, not who is behind it; it holds no league content
 *     and identifies nobody. Sweeping it would make every handover and every
 *     Sign Out re-prompt for a PIN the new player is about to be given anyway,
 *     for no privacy gain.
 *   • `cfbp_auth_mode_last_known` — SEC F1-R1's fail-CLOSED memory of the last
 *     authMode a successful config read established. Its entire job is to be
 *     readable when the network is not; clearing it is what would make a failed
 *     config read silently select 'pins' and resurrect a stale session.
 *   • `cfbp_backend_config` — the backend url/token pair from config.json, which
 *     ships in the repo and is identical on every device (AD-05). Not
 *     player-scoped, not league-scoped. Clearing it would leave a handset unable
 *     to reach the Sheet until the next successful config read — i.e. it would
 *     make an offline handover unrecoverable, which is the opposite of the goal.
 *   • `cfbp_supabase_active_league` — A9's explicit exemption, unchanged: an
 *     opaque uuid that grants nothing on its own. signOut() clears it separately
 *     on its own line, so the difference between the two callers stays visible
 *     instead of being hidden in here. It is also READ by the caller to compute
 *     the owner tuple, so clearing it mid-routine would change the value the
 *     marker is about to be written with.
 *   • `cfbp_device_data_owner` — the marker itself, written by the caller AFTER
 *     this returns precisely so an interrupted clear re-clears next boot.
 *   • `cfbp_supabase_session` — THE TOKEN, and the one that depends on WHICH
 *     caller this is. See DEVICE_CLEAR_MODES below.
 *   • `cfbp_scribe_ledger` / `cfbp_scribe_lastpost` — SCRIBE's two restraint
 *     ledgers (reviewer F-2, eighth gate). `{hash: ms}` and `{rateKey: ms}`:
 *     they identify nobody, and clearing them LOOSENS a rate limiter rather
 *     than protecting anything. See their entries in the list for the full
 *     justification.
 *
 * ANYTHING NOT IN THAT LIST IS SWEPT, including the SDK's `<storageKey>-…` PKCE
 * artefacts (they start with `cfbp_supabase_session-`, not with the token key
 * itself, so the keep entry does not cover them — deliberately: an abandoned
 * code verifier is half of an authorization-code exchange, which is exactly what
 * SEC F3 removed from the sign-out path, and a handover deserves the same).
 */
const DEVICE_CLEAR_PREFIX = 'cfbp_';
const _CLEAR_KEEP_KEYS = Object.freeze([
  'cfbp_site_unlocked',            // js/storage.js KEYS.SITE_UNLOCK — the device got through the front door; identifies nobody
  'cfbp_auth_mode_last_known',     // js/auth.js LAST_AUTH_MODE_KEY — the fail-CLOSED mode memory; must survive to do its job
  'cfbp_backend_config',           // js/backend.js — repo-shipped url/token, identical on every device (AD-05)
  'cfbp_supabase_active_league',   // js/auth.js ACTIVE_LEAGUE_KEY — A9's exemption; signOut() clears it separately
  'cfbp_device_data_owner',        // js/auth.js DEVICE_DATA_OWNER_KEY — written LAST by the caller, by design
  // ── REVIEWER F-2 (eighth gate, coordinator ruling 2026-09-18) — SCRIBE'S TWO
  //    RESTRAINT LEDGERS. Both hold `{opaqueKey: epochMs}` and nothing else: no
  //    player id, no display name, no pick, no message text. They identify
  //    NOBODY, so sweeping them buys zero privacy — and it costs something real,
  //    because their only job is to hold SCRIBE BACK. Clearing them LOOSENS her:
  //    a line she used yesterday becomes fresh again, and a room she just posted
  //    in becomes eligible again. A handover would make the app chattier, which
  //    is the opposite of what a sweep is for.
  'cfbp_scribe_ledger',            // js/scribeLines.js:65 LEDGER_KEY   — { lineHash: lastUsedMs }, the repetition damper
  'cfbp_scribe_lastpost',          // js/scribeLines.js:66 LAST_POST_KEY — { rateKey: lastMs }, the per-room rate limiter
]);
// SECURITY F-5 (eighth gate) — FROZEN. These three lists are exported for the
// suites (`_CLEAR_KEEP_KEYS_FOR_TEST` etc.), and an exported mutable array is an
// allow-list any module — or any test that ran earlier in the same process —
// can push a name onto. A single `_CLEAR_KEEP_KEYS_FOR_TEST.push('cfbp_picks')`
// would silently exempt the whole pick set from every sweep, in production code,
// with no diff to show for it. Freezing makes that a no-op (and a TypeError in
// strict mode, which ES modules are).
export const _CLEAR_KEEP_KEYS_FOR_TEST = _CLEAR_KEEP_KEYS;

/**
 * THE TOKEN KEY IS THE ONE DIFFERENCE BETWEEN THE TWO CALLERS, so it is a
 * parameter rather than a hidden branch:
 *
 *   'handover' (the default) — a DIFFERENT account has just been PROVEN at this
 *       device. The token on the handset at this moment is B's, freshly written
 *       by the SDK; A's was replaced by the sign-in that got us here. Removing
 *       it would sign the incoming player straight back out on their first
 *       paint. KEPT.
 *   'signout'  — the player asked to leave. Nothing about this session may
 *       survive. REMOVED. (signOut() also removes it by name, unconditionally,
 *       above its call to this routine — SEC F2's "the one step that must
 *       survive every failure above it". This is the belt to that brace, not a
 *       replacement for it.)
 */
// SECURITY F-5 (eighth gate) — FROZEN, same reasoning as _CLEAR_KEEP_KEYS: a
// pushed-on mode name would make clearDeviceLocalSessionData()'s fail-closed
// validation accept it, and the one thing that validation exists to stop is a
// typo choosing to KEEP the previous player's token.
const DEVICE_CLEAR_MODES = Object.freeze(['handover', 'signout']);
export const _DEVICE_CLEAR_MODES_FOR_TEST = DEVICE_CLEAR_MODES;

/** The exact set this device would sweep right now, in `mode`. Exported for the
 *  suites so "no cfbp_ key outside KEEP remains" is asserted against the same
 *  predicate the production sweep uses, never a re-derivation of it. */
function _scanKeysToClear(mode) {
  const keep = new Set(_CLEAR_KEEP_KEYS);
  if (mode !== 'signout') keep.add(AUTH_STORAGE_KEY);
  const out = new Set();
  // SECURITY F-1 (eighth gate) — the ENUMERATION VERDICT travels with the list.
  // A store that cannot be enumerated yields an empty list that means "I could
  // not look", and every caller below must not read that as "there is nothing
  // here". The flag is what makes the difference expressible.
  const { keys, enumerated } = _enumerateLocalStorageKeys();
  for (const k of keys) {
    if (k.startsWith(DEVICE_CLEAR_PREFIX) && !keep.has(k)) out.add(k);
  }
  // Unioned with the documented list so a future change to the prefix (or a key
  // that somehow does not carry it) can never quietly narrow the sweep — but
  // ONLY for names actually on the device. This function has to mean "what is
  // still left to clear", because the sweep RE-ASKS it afterwards as its own
  // verification; an unconditional union made that re-ask permanently non-empty
  // and every clear report "incomplete", which then refused to write the owner
  // marker. (Caught by authtest on the first run of this change.)
  for (const k of _SIGNOUT_LOCAL_KEYS) {
    if (keep.has(k)) continue;
    // A store that cannot even be READ is counted as still holding the key —
    // the fail-closed direction: the clear reports incomplete, the marker is
    // left unwritten, and the next boot clears again.
    try { if (localStorage.getItem(k) !== null) out.add(k); } catch { out.add(k); }
  }
  return { keys: [...out], enumerated };
}
/** The list only — what every caller that just wants the names asks for. */
function _keysToClear(mode) { return _scanKeysToClear(mode).keys; }
export const _keysToClearForTest = _keysToClear;
export const _scanKeysToClearForTest = _scanKeysToClear;

/**
 * ══ A9 (approved 2026-09-17) — ONE CLEARING ROUTINE, TWO CALLERS ════════════
 *
 * THE FINDING. signOut() removed a list of device-local keys AND the Sheets
 * mirror backup; the expiry path removed only the SDK's own token and its PKCE
 * artefacts. So a handset whose session expired and was then handed to a second
 * player still carried the first player's chat cache, read cursors, notification
 * log and unsent outbox — the RG-51 class, one layer down from the pick draft.
 * Two hand-written lists is how they drifted, so there is now exactly one.
 *
 * WHAT IS *NOT* IN HERE, and why: the SDK token + PKCE sweep (that is
 * "this session is over", which the expiry path does on proof and sign-out does
 * unconditionally) and the ACTIVE-LEAGUE POINTER. The pointer is exempt on the
 * expiry path by A9's explicit ruling — it is an opaque uuid that grants nothing
 * on its own, and the returning player is about to land in the same league — so
 * signOut() clears it separately, on its own line, rather than hiding a
 * difference between the two paths inside a shared routine.
 *
 * TIMING under DI-180o(b): sign-out calls this IMMEDIATELY. The expiry path
 * does NOT — a player whose token died and who signs straight back in as
 * themselves must find their room, their cursors and their outbox where they
 * left them. app.js's chokepoint calls this the moment a DIFFERENT account is
 * proven at the device instead.
 */
export function clearDeviceLocalSessionData({ mode = 'handover' } = {}) {
  // THE MODE IS VALIDATED, and an unrecognised one FAILS CLOSED to 'signout'
  // (sweep everything, keep nothing) rather than silently behaving as a
  // handover. A typo in a future caller must not quietly leave the previous
  // player's token on the device — that is the one difference between the two
  // modes, so it is the one thing a typo must not be able to choose.
  if (!DEVICE_CLEAR_MODES.includes(mode)) {
    console.warn(`[auth] the device-local clear was asked for an unknown mode (${String(mode)}) — falling back to the strictest one ('signout'), which keeps nothing`);
    mode = 'signout';
  }
  // ── DI-180q — THE SWEEP IS VERIFIED, AND IT REPORTS ───────────────────────
  // It used to be `try { removeItem } catch {}` per key: a store that refuses
  // one key (a quota error mid-sweep, a device dying, a partitioned in-app
  // browser) swallowed the throw, the loop carried on, and the routine returned
  // as if it had succeeded. DI-180q's caller then wrote the owner marker over
  // data that was still half the previous player's — and, because the marker
  // then MATCHED, the next boot kept it forever. That is the exact shape SEC S-2
  // fixed for setLastKnownAuthMode(): a write that fails OPEN turns a
  // fail-closed rule into a no-op on precisely the devices that need it.
  //
  // So every removal is read BACK, and the verdict is returned rather than
  // assumed. The caller refuses to mark the device when the sweep did not
  // complete, which is what makes "an interrupted clear re-clears next boot" a
  // property of the code.
  //
  // SECURITY F-1 (seventh gate) — the SET it acts on is the prefix rule above,
  // not an eight-name include-list. Read-back and verdict are unchanged.
  //
  // SECURITY F-1 (EIGHTH gate) — AN UN-ENUMERABLE STORE IS AN INCOMPLETE CLEAR.
  // This is the whole finding: the scan below used to be `_keysToClear(mode)`,
  // which flattened "I could not look" into the empty list. Both reads of it
  // (the sweep and the post-sweep re-ask) then agreed the device was clean, this
  // returned `true`, and the caller stamped the owner marker over the previous
  // player's data — permanently, because the marker matched from then on. The
  // enumeration verdict is now read explicitly, FIRST, and it can only ever push
  // `complete` toward false.
  const firstScan = _scanKeysToClear(mode);
  let complete = firstScan.enumerated;
  if (!firstScan.enumerated) {
    console.warn('[auth] the device-local clear could not ENUMERATE this handset\'s storage, so it cannot claim to have swept it — reporting INCOMPLETE so the owner marker is left unwritten and the next boot tries again');
  }
  firstScan.keys.forEach(k => {
    try { localStorage.removeItem(k); } catch (e) { complete = false; console.warn(`[auth] the device-local clear could not remove ${k}`, e); }
    try { if (localStorage.getItem(k) !== null) complete = false; } catch { complete = false; }
  });
  // The whole point of a prefix rule is that it stays true AFTER the sweep, so
  // it is re-asked rather than assumed. A store that accepted every removeItem()
  // and still enumerates a `cfbp_` key is not a complete clear — and one that
  // cannot be enumerated on the re-ask either is not one either.
  const reScan = _scanKeysToClear(mode);
  if (reScan.keys.length > 0 || !reScan.enumerated) complete = false;
  // The backend.js Sheets mirror's localStorage backup, through its own
  // EXPORTED accessor (never a reimplementation of it) — and read back through
  // the key literal, because backend.js exports a clearer but no predicate.
  try { clearMirror(); } catch (e) { complete = false; console.warn('[auth] clearMirror() failed', e); }
  try { if (localStorage.getItem(_MIRROR_KEY_FOR_OWNER_CHECK) !== null) complete = false; } catch { complete = false; }
  // ── STEP 4 PART B (§6.6 / security F5, audit 7) — THE LIVE IN-MEMORY MIRROR ─
  //
  // The comment two functions up used to say the in-memory Sheets mirror is
  // "not cleared here because it is not league-scoped today". It is
  // league-scoped now. The Supabase adapter holds one league's players, picks,
  // weeks, comments and notifications in a Map that survives a handover
  // unchanged — a same-page handover never reloads — so a sweep that clears
  // twenty-two localStorage keys and leaves that Map populated has cleared the
  // COPY and kept the ORIGINAL.
  //
  // dropMirror() clears the in-memory mirror AND the device snapshot
  // (`cfbp_supabase_mirror`, which the prefix rule above has usually already
  // removed — asserted, not assumed) and returns a READ-BACK verdict, which
  // feeds `complete` like every other step here: a clear that fails OPEN is how
  // a fail-closed rule becomes a no-op on exactly the devices that need it.
  //
  // It also REFUSES any queued write loudly before discarding it, so a player
  // whose device changed hands mid-save is told rather than watching it vanish.
  //
  // Unconditional — NOT gated on isSupabaseDataMode(). A device that was in
  // Supabase mode a moment ago and has since had its config rolled back still
  // has the Map in RAM, and "we are not in that mode any more" is not a reason
  // to leave the previous player's league in memory. In the flag-off world the
  // adapter is IDLE with an empty Map and this is a no-op that reports true.
  //
  // THE VERDICT'S OWN MUTATION RED IS STRUCTURAL, AND THAT IS BY DESIGN (gap 5,
  // coordinator-accepted 2026-09-18). Deleting `drop.cleared === false` leaves
  // authtest [44e] GREEN, because the prefix sweep above ALSO read this key
  // back and already pushed `complete` to false — three independent read-backs
  // of the same fact (the sweep's, the adapter's, and hasDeviceSnapshot()
  // below), which is what defence in depth looks like when it is working. The
  // clause is kept and its red is adaptertest's A14b structural rule, stated
  // here so the next reader does not mistake a redundant guard for a dead one
  // and delete it.
  try {
    const drop = sb.dropMirror('handover');
    if (drop && drop.cleared === false) complete = false;
  } catch (e) { complete = false; console.warn('[auth] the data adapter\'s mirror could not be dropped', e); }
  // Read back through the adapter's own exported predicate rather than a third
  // key literal in this file (reviewer F9's rule, the same one the first-boot
  // wipe follows): backend.js exports a clearer but no predicate, which is why
  // _MIRROR_KEY_FOR_OWNER_CHECK above still exists and is still a reported
  // discrepancy; supabase-backend.js exports both, so this one does not repeat it.
  try { if (sb.hasDeviceSnapshot()) complete = false; } catch { complete = false; }
  // ── DI-180q (approved 2026-09-17) — TWO THINGS THAT ARE NOT localStorage ───
  //
  // (1) THE PUSH BINDING. Device-local data is not only keys: a handset that has
  //     been handed over is still bound to the OUTGOING player's OneSignal
  //     external id, so every push addressed to them lands on the new player's
  //     lock screen — by name, with content. logoutOneSignal() is the SDK's own
  //     supported way to unlink it (OneSignal.logout(), which also drops the
  //     tags associated with that external id; this app sets none today, so the
  //     external id is the whole binding). Fire-and-forget with its own catch:
  //     a clear must never fail because a push SDK is unreachable, and the call
  //     is a no-op on a device with no App ID configured.
  //
  //     NOTE for whoever reads this next: the OneSignal SDK also keeps state in
  //     its OWN IndexedDB, which nothing here can reach directly. OneSignal.logout()
  //     is the supported way to clear it — which is exactly why this goes through
  //     the SDK rather than sweeping storage by hand.
  try { Promise.resolve(logoutOneSignal()).catch(e => console.warn('[auth] OneSignal logout failed during the device-local clear', e)); }
  catch (e) { console.warn('[auth] OneSignal logout could not be started', e); }
  //
  // (2) THE HOME-SCREEN BADGE. An installed PWA's badge is a count of six named
  //     people's messages, sitting on the home screen of a device that now
  //     belongs to somebody else. Feature-detected — Badging is iOS-standalone
  //     and Chromium only.
  try { if (typeof navigator !== 'undefined' && typeof navigator.clearAppBadge === 'function') navigator.clearAppBadge(); }
  catch (e) { console.warn('[auth] clearAppBadge() failed during the device-local clear', e); }
  //
  // WHAT IS DELIBERATELY *NOT* CLEARED HERE, so it is a decision and not an
  // omission. SECURITY F-1 (seventh gate): this block used to describe an
  // eight-name include-list and was therefore FALSE by omission — it listed
  // three exemptions while twenty-two league keys were being left behind
  // unmentioned. The authoritative list is `_CLEAR_KEEP_KEYS` above, each entry
  // justified beside itself; what follows is the same list in prose plus the two
  // non-localStorage exemptions, and nothing else survives:
  //   • `cfbp_site_unlocked` — the device got through the front door; it holds
  //     no content and identifies nobody.
  //   • `cfbp_auth_mode_last_known` — the fail-CLOSED mode memory (SEC F1-R1);
  //     clearing it is what would let a failed config read select 'pins'.
  //   • `cfbp_backend_config` — repo-shipped, identical on every device (AD-05);
  //     clearing it makes an offline handover unrecoverable.
  //   • THE ACTIVE-LEAGUE POINTER (`cfbp_supabase_active_league`) — A9's
  //     explicit exemption, unchanged. An opaque uuid that grants nothing on its
  //     own, and signOut() clears it separately, on its own line, so the
  //     difference between the two callers stays visible rather than hidden in
  //     here. The caller also READS it to build the owner tuple.
  //   • THE DEVICE-DATA OWNER MARKER ITSELF (`cfbp_device_data_owner`). It is
  //     set by the caller AFTER this routine returns (see
  //     reconcileDeviceDataOwner) precisely so that an interrupted clear
  //     re-clears next boot; clearing it in here would be the caller writing it
  //     twice. signOut() removes it explicitly.
  //   • THE SUPABASE TOKEN (`cfbp_supabase_session`) — ON A HANDOVER ONLY, and
  //     because the token on the device at that instant belongs to the INCOMING
  //     player. In `mode: 'signout'` it is swept like everything else.
  //   • SCRIBE'S TWO RESTRAINT LEDGERS (`cfbp_scribe_ledger`,
  //     `cfbp_scribe_lastpost`) — reviewer F-2, eighth gate. `{hash: ms}` and
  //     `{rateKey: ms}`; no id, no name, no content. Clearing them loosens
  //     SCRIBE instead of protecting anyone.
  //   • THE SERVICE-WORKER CACHES. They hold APP ASSETS — HTML, CSS, JS, icons —
  //     and nothing league-scoped or player-scoped. Clearing them would force
  //     every handover to re-download the whole app for no privacy gain, and
  //     would collide with the CACHE_NAME versioning that is the release
  //     checklist's business (RG-04).
  //
  // WHAT THE INVERSION COSTS, stated rather than discovered later — CORRECTED at
  // the EIGHTH gate, because the seventh gate's version said "one re-hydrate"
  // and that was only two thirds of the bill:
  //
  //   (1) ONE RE-HYDRATE. On a device in LOCAL mode the league keys are a cache
  //       of the shared Sheet, so they come straight back.
  //   (2) FIVE BOUNDED RE-FIRES. Five of the swept keys are not caches at all —
  //       they are ONE-SHOT LEDGERS whose whole job is to remember that
  //       something already happened. Clearing them lets that something happen
  //       once more on this device. All four are bounded (a fixed number of
  //       weeks/games, not an unbounded stream), all four are cosmetic, and
  //       none of them touches a pick, a score or an obligation:
  //         • `cfbp_scribe_weeksignals` (js/app.js:12928) — SCRIBE's per-week
  //           signal ledger; at most one re-fire per week already played.
  //         • `cfbp_scribe_anniv` (js/chat-ui.js:3144) — the anniversary post;
  //           at most one re-fire.
  //         • `cfbp_reveal_emitted` (js/app.js:1236) — the pick-reveal notice;
  //           at most one re-fire per already-revealed week. NOT a blind-rule
  //           risk: it only re-announces a reveal that has ALREADY happened,
  //           and the reveal itself is gated on week status, not on this key.
  //         • `cfbp_chat_sheet_hint` (js/chat-ui.js:2712) — the "swipe up" chat
  //           sheet hint; re-shows once to the incoming player, who has not
  //           seen it on this device anyway.
  //         • `cfbp_chat_teaser_dismiss_seq` (js/chat-ui.js:2827) — the teaser's
  //           dismissed-at sequence number; at most one re-show.
  //       Two more one-shot ledgers, SCRIBE's `cfbp_scribe_ledger` and
  //       `cfbp_scribe_lastpost`, WOULD have been in this list — they are KEPT
  //       instead, per reviewer F-2 above, precisely because their re-fire is
  //       unbounded-ish (every line she has ever used becomes fresh again).
  //   (3) ONE GENUINE LOSS: an UNSYNCED write composed offline — and it belongs
  //       to the player who just left the device, which is the whole reason the
  //       sweep exists.
  //
  // The two best-effort steps above (the push binding, the badge) deliberately
  // do NOT affect the verdict: neither is storage, neither can leave a readable
  // artefact of the previous player on this device, and failing the whole clear
  // because a push SDK is unreachable would make an offline handover unclearable.
  return complete;
}

// ── DI-180q — THE OWNER MARKER ──────────────────────────────────────────────

/** The tuple this device's local data would belong to RIGHT NOW: account id +
 *  active league id, joined with the one shared separator. '' when no account
 *  is resolved — an unresolved identity is never written as an owner, because
 *  "nobody" is not an owner and a marker of '' must keep reading as MISSING. */
function _deviceDataOwnerTuple() {
  if (!_accountUserId) return '';
  let leagueId = '';
  try { leagueId = localStorage.getItem(ACTIVE_LEAGUE_KEY) || ''; } catch { leagueId = ''; }
  // 'null' for an unresolved league, the same convention _identityTuple() and
  // app.js's currentIdentityKey() use, so "no league yet" and "league null"
  // cannot collide with a real id.
  return [_accountUserId, leagueId || 'null'].join(IDENTITY_KEY_SEP);
}

/** '' when this device has never recorded an owner — which, per DI-180q, is the
 *  fail-closed answer for an unreadable store too. */
export function getDeviceDataOwner() {
  try { return localStorage.getItem(DEVICE_DATA_OWNER_KEY) || ''; } catch { return ''; }
}

/** Step 4 Part B — the same tuple, EXPORTED, because §5.3's four-condition
 *  offline rule compares the device SNAPSHOT's stored owner against it and the
 *  adapter must not re-derive it from two accessors of its own. One definition
 *  of "whose data is this", read by the marker writer and by the snapshot
 *  reader alike. */
export function getDeviceDataOwnerTuple() { return _deviceDataOwnerTuple(); }

/** Step 4 Part B, §6.1 read-back (reviewer F9) — the FIRST-BOOT WIPE verifies
 *  `cfbp_sheet_mirror` is gone through an accessor rather than a key literal
 *  inside supabase-backend.js, which does not own that key. This file already
 *  holds the literal (`_MIRROR_KEY_FOR_OWNER_CHECK` above, itself a reported
 *  discrepancy: js/backend.js exports a clearer but no predicate, and adding
 *  one there is an edit this pass may not make). Exporting the EXISTING copy
 *  adds no new literal anywhere and keeps the read-back honest. */
export function hasSheetMirrorOnDevice() {
  try { return localStorage.getItem(_MIRROR_KEY_FOR_OWNER_CHECK) !== null; } catch { return true; }
}

/** @returns {boolean} true only when the value is genuinely on the device after
 *  this call — proven by reading it back, the same discipline
 *  setLastKnownAuthMode() uses and for the same reason: a write that fails OPEN
 *  is how a fail-closed rule becomes a no-op on exactly the devices that need
 *  it (iOS private browsing, a full quota, a partitioned in-app browser). */
function _setDeviceDataOwner(tuple) {
  try {
    if (tuple) localStorage.setItem(DEVICE_DATA_OWNER_KEY, tuple);
    else localStorage.removeItem(DEVICE_DATA_OWNER_KEY);
    return (localStorage.getItem(DEVICE_DATA_OWNER_KEY) || '') === (tuple || '');
  } catch { return false; }
}

/** js/backend.js:39 MIRROR_KEY — cited by literal rather than imported for the
 *  same reason the chat/notify keys below are: backend.js exports a CLEARER
 *  (clearMirror) but no "is there one" predicate, and adding one is an edit to
 *  a file this pass may not make. Reported rather than written. */
const _MIRROR_KEY_FOR_OWNER_CHECK = 'cfbp_sheet_mirror';

/** Is there anything on this handset that could belong to a previous player?
 *  The same list the clear acts on, asked as a question — so "marker missing"
 *  can be told apart from "marker missing AND there is nothing to inherit",
 *  which is the difference between a wasted chat re-download and a correct
 *  fail-closed wipe. */
function _hasDeviceLocalSessionData() {
  // SECURITY F-1 (seventh gate) — THE SAME PREDICATE, not a second list. It used
  // to ask the eight-name include-list, so a handset carrying nothing but
  // `cfbp_picks` and `cfbp_comments` (the offline/local-mode case) answered
  // "nothing to inherit" and was ADOPTED — marked as the new player's, with the
  // previous player's picks and chat log still on it and a marker that now
  // matched, forever. Asking `_keysToClear()` means the question and the action
  // can never drift apart again.
  //
  // SECURITY F-1 (EIGHTH gate) — AND AN UN-ENUMERABLE STORE ANSWERS *YES*. The
  // fail-closed direction for this question is the opposite of the clear's:
  // "there might be something here" routes reconcileDeviceDataOwner() down the
  // CLEAR branch, where "there is definitely nothing" routes it down ADOPT. A
  // store we cannot read must never buy an adoption.
  const scan = _scanKeysToClear('handover');
  if (!scan.enumerated) return true;
  if (scan.keys.length > 0) return true;
  try { if (localStorage.getItem(_MIRROR_KEY_FOR_OWNER_CHECK) !== null) return true; } catch { return true; }
  return false;
}

/**
 * ══ DI-180q — THE DECISION, IN ONE PLACE ═════════════════════════════════════
 *
 * Called at the ONE moment a sign-in is RESOLVED — the account id is known and
 * the active-league pointer has settled — and called there rather than at a list
 * of remembered call sites, which is the shape that failed three times in this
 * arc. Two callers today, and both are that same moment seen from two angles:
 * a membership read that resolved (any sign-in, any boot, any handover) and a
 * completed league switch (same account, different league scope).
 *
 * ORDER IS THE WHOLE INPUT: CLEAR FIRST, MARK LAST.
 *   marker === now            -> keep everything (instant chat boot preserved)
 *   marker differs            -> clear, then mark
 *   no marker, data present   -> clear once (fail-closed), then mark
 *   no marker, nothing there  -> mark; there was never anything to inherit
 * A marker that cannot be persisted is REPORTED and left absent, so the next
 * boot reads "missing" and clears again. It is never treated as a match.
 *
 * WHY THE MARK IS LAST: if the device dies, the tab is closed, or the sweep
 * throws half-way, the marker is still absent — so the next boot re-clears
 * rather than recording an owner for data that is still half somebody else's.
 * Marking first would make a partial clear permanent.
 *
 * WHY IT IS SAFE AGAINST A LATE-LANDING READ (and why the epoch had to ship in
 * the same pass): a membership read issued for the PREVIOUS account can still be
 * in flight when this runs. Without the identity epoch it would land immediately
 * afterwards and repopulate the very cache this just wiped — a marker saying B
 * over data that is A's again. The epoch discards it (I6); this decides what to
 * wipe. authtest drives exactly that ordering.
 *
 * @returns {{action:string, persisted?:boolean, owner?:string}} for the tests
 *          and for the console trail. Production ignores it.
 */
/**
 * DI-180q + DI-183 (Step 3b) — THE LAST OUTCOME, READ-ONLY.
 *
 * The confirmation card's one-time "Refreshing your league on this phone" line
 * is conditioned on the clear having ACTUALLY fired, not shown unconditionally
 * (brief §3b: "conditioned on the re-download actually firing"). app.js cannot
 * see reconcileDeviceDataOwner()'s return value — it is called from inside this
 * module, on the membership-resolved path, before the event that paints — so the
 * outcome is recorded here and read through an accessor.
 *
 * A PLAIN OBJECT, NOT A STORAGE KEY. This is per-PAGE state about something that
 * just happened; persisting it would be a new device-local key (which Step 3b
 * may not add) and would also be a lie the moment the page reloaded.
 */
let _lastDeviceDataReconcile = null;
export function getLastDeviceDataReconcile() { return _lastDeviceDataReconcile ? { ..._lastDeviceDataReconcile } : null; }
/** Every return of reconcileDeviceDataOwner() goes through here.
 *
 *  DELIBERATELY NOT A WRAPPER FUNCTION. The first attempt at this recorded the
 *  outcome in an exported `reconcileDeviceDataOwner()` that delegated to a
 *  private `_reconcileDeviceDataOwner()` — and three structural rules in
 *  authtest went red at once, because they read the EXPORTED function's body to
 *  prove the clear happens before the mark and that the handover caller uses the
 *  default mode. Those rules are right and the wrapper was wrong: hollowing out
 *  the function they inspect would have left them asserting about an empty
 *  shell. One function, one body, recorded on the way out. */
function _recordReconcile(result, reason) {
  _lastDeviceDataReconcile = { ...result, reason, at: Date.now() };
  return result;
}

export function reconcileDeviceDataOwner(reason = '') {
  const now = _deviceDataOwnerTuple();
  // No account resolved yet: there is nothing to compare and nothing to record.
  // Deliberately NOT a clear — "we do not know who this is yet" is the ordinary
  // state of every boot for the width of one network call, and clearing there
  // would wipe every player's cache on every cold start (option (b), which Drew
  // did not rule for).
  if (!now) return _recordReconcile({ action: 'unresolved' }, reason);
  const marker = getDeviceDataOwner();
  if (marker && marker === now) return _recordReconcile({ action: 'kept', owner: now }, reason);
  const mustClear = !!marker || _hasDeviceLocalSessionData();
  if (mustClear) {
    console.info(`[auth] DI-180q: this device's local data belongs to ${marker ? 'a different identity' : 'an UNRECORDED owner'} (${reason}) — clearing it before the new player's first paint`);
    // THE MARKER IS NOT WRITTEN OVER A PARTIAL CLEAR. A sweep that could not
    // finish leaves the device with no marker, so the next boot reads MISSING
    // and clears again — the one direction that cannot strand one player's
    // cached room under another player's name.
    if (clearDeviceLocalSessionData() !== true) {
      console.warn('[auth] DI-180q: the device-local clear did NOT complete (this handset is refusing removals) — the owner marker is deliberately left unwritten, so the next boot clears again rather than adopting data that is still partly somebody else\'s.');
      return _recordReconcile({ action: 'clear-incomplete', persisted: false, owner: now }, reason);
    }
  }
  const persisted = _setDeviceDataOwner(now);
  if (!persisted) {
    console.warn('[auth] DI-180q: the device-data owner marker could NOT be persisted on this handset. It will read as MISSING on the next boot, which means this data is cleared again — that is the fail-closed direction and it costs one chat re-download, not a cross-account leak.');
  }
  return _recordReconcile({ action: mustClear ? 'cleared' : 'adopted', persisted, owner: now }, reason);
}

/**
 * DI-180p — THE ONE CALL SITE THAT MAY DESTROY A SAVED SIGN-IN.
 *
 * Every removal of the SDK's token lives here (sign-out has its own,
 * deliberate, unconditional copy — see signOut()'s SEC F2 comment for why that
 * one must survive every failure above it). A static rule in authtest asserts
 * that nothing else in this module reaches this function, so "verify before you
 * destroy" is a property of the code and not of the path somebody remembered.
 *
 * Reached ONLY with proof: the SDK reported a dead refresh token, or a second
 * consecutive expired classification landed in the same page.
 */
function _clearExpiredSessionFromDevice(err) {
  _withIdentityBatch(() => {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
    _removeLocalKeysWithPrefix(`${AUTH_STORAGE_KEY}-`);
    _membershipsCache = null;
    _accountEmail = '';
    // Through the ONE setter — a destroy voids the identity, so an in-flight
    // read issued for it may not land afterwards either (security F-1).
    _setAccountUserId('', { notify: false, reason: 'expired-session-cleared' });
    // The lock has done its job — the session really is gone now, and the
    // synthesized session below is the signed-out shape, so holding privilege
    // on top of it would be a second latch saying the same thing.
    _privilegeHeld = false;
    _recomputeSynthesizedSession();
  }, { emitsOwnEvent: true });
  // NOT clearDeviceLocalSessionData() — A9's timing ruling. The chat cache,
  // read cursors, notify log and outbox stay until a DIFFERENT account signs in
  // (app.js's chokepoint) or the player signs out explicitly.
  _authListeners.forEach(fn => {
    try { fn('MEMBERSHIPS_FAILED', { error: err, expired: true, verified: true }); }
    catch (e) { console.warn('[auth] listener failed', e); }
  });
}

export async function signOut() {
  _signingOut = true;
  _signOutAt = Date.now();
  // ── SECURITY F-1 (sixth gate) — BEFORE THE AWAIT, NOT AFTER IT ────────────
  // Reproduction (A) in one line: the player taps Sign Out while the boot's
  // membership read is still out. Everything below this point is synchronous
  // enough, but `await client.auth.signOut()` is not — and the read can land
  // inside it. Bumping FIRST (which also nulls both in-flight latches) means the
  // read is void from the instant the tap happens, not from whenever the SDK
  // gets back to us. It is also what stops the next caller being handed the
  // departing player's promise.
  _bumpIdentityEpoch('signOut');
  const client = ensureClient();
  if (client) { try { await client.auth.signOut(); } catch (e) { console.warn('[auth] signOut() call failed', e); } }
  // SEC F2's last probe — ensureClient() returns null whenever the SDK is
  // absent or the project is unconfigured, and the OLD code then skipped the
  // token removal entirely: "Sign Out" left a valid persisted session on the
  // device, and the very next hasValidSupabaseSession() read it back and let
  // the app straight through. Removing our own storageKey is UNCONDITIONAL
  // now — it is the one step that must survive every failure above it. (The
  // SDK writes to this exact key; ensureClient() configures it.)
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
  // SEC F3 — the token is not the only thing the SDK writes under that name.
  // A PKCE flow parks its code verifier at `<storageKey>-code-verifier`, and a
  // flow that was started and abandoned leaves `<storageKey>-flow-<id>-code-
  // verifier` behind. Removing only the session record left those on the
  // device: a verifier is one half of an authorization-code exchange, so the
  // next account on a shared phone inherited a usable artefact of the previous
  // player's abandoned sign-in. Swept by PREFIX rather than by a hardcoded
  // list, because the suffixes are the SDK's private business and a version
  // bump is allowed to add one.
  _removeLocalKeysWithPrefix(`${AUTH_STORAGE_KEY}-`);
  // The flag's job is done — from here the TIMESTAMP is what marks the next
  // second's worth of SIGNED_OUT events as deliberate. Leaving the flag set
  // would mute every later expiry for the rest of the session.
  _signingOut = false;
  // All three identity terms move here, one after another. Batched so the
  // chokepoint sees one final signed-out tuple rather than an intermediate one,
  // and emitsOwnEvent because the SIGNED_OUT emit at the bottom of this function
  // is the notification app.js acts on.
  _withIdentityBatch(() => {
    _membershipsCache = null;
    _membershipsError = null;
    _accountEmail = '';
    // Through the ONE setter (the epoch has already moved at the top of this
    // function; this is the state write, and it keeps term 1 to a single writer).
    _setAccountUserId('', { notify: false, reason: 'signOut' });
    setActiveLeagueId(null);   // also recomputes the (now signed-out) synthesized session
  }, { emitsOwnEvent: true });
  _sessionExpired = false;
  // DI-180p — an explicit sign-out ends the expiry conversation: there is
  // nothing left to verify and nothing left to hold.
  _privilegeHeld = false;
  _expiredStrikes = 0;
  // A9 — the ONE shared clearing routine, not a second hand-written list.
  // `mode: 'signout'` is the ONE difference between the two callers, and it is
  // a parameter rather than a hidden branch (SECURITY F-1, seventh gate): a
  // handover must KEEP the token the incoming player just acquired, an explicit
  // Sign Out must not keep anything. The unconditional removeItem() above stays
  // where it is — this is the belt to that brace.
  //
  // K_OUTBOX ("outbox after flush") — clearing it loses only UNSENT drafts
  // already attributed to the outgoing player's identity in their event
  // payloads, which is a data-loss risk for that player, not a cross-account
  // leak to the next one. SECURITY F-4 (seventh gate) closed the other half: the
  // in-RAM copy is dropped through chat.js's own exported clearOutbox(), and
  // flushOutbox() refuses to send an entry whose author is not the current
  // session's member id, so the marker-independent case is covered too.
  clearDeviceLocalSessionData({ mode: 'signout' });
  // DI-180q — the DATA and the MARKER go together on an explicit Sign Out. The
  // data is gone, so recording an owner for it would be a lie; and leaving the
  // departing player's tuple behind would make the NEXT sign-in by that same
  // player read "marker matches" over a cache that no longer exists. Removed by
  // the same verified writer, so an unwritable device still reads MISSING next
  // boot and clears again — never a match.
  _setDeviceDataOwner('');
  _authListeners.forEach(fn => {
    try { fn('SIGNED_OUT', null); }
    catch (e) { console.warn('[auth] listener failed', e); }
  });
}

// ── Test hooks (mirrors js/chat.js's _resetForTest() precedent — production
//    code never calls these) ──────────────────────────────────────────────────
export function _resetAuthForTest() {
  // Listeners go FIRST, before any identity write below. Not cosmetic: those
  // writes are instrumented now, so a reset performed with the previous
  // section's listeners still attached would fire IDENTITY_MAYBE_CHANGED into a
  // world that is being torn down. Clearing first means the notifier below emits
  // into an empty set — a real no-op — and this function still obeys the same
  // write-then-notify rule every other write site does (no exemption, because an
  // exemption is a hole in the rule).
  _authListeners.clear();
  _client = null;
  _signingOut = false;
  _signOutAt = 0;
  _sessionExpired = false;
  _sessionForcedOut = false;
  // DI-180p — every term of the verify-before-destroy state machine (the state
  // table at _privilegeHeld's declaration is the list; a term left behind here
  // would make the next section's first expiry behave like a second strike).
  _privilegeHeld = false;
  _expiredStrikes = 0;
  _verificationInFlight = null;
  _membershipRefreshInFlight = null;
  _refreshDeadlineMsForTest = null;
  _hasSupabaseDataBackendOverrideForTest = null;
  _membershipsCache = null;
  _membershipsError = null;
  _accountEmail = '';
  _accountUserId = '';
  // Security F-1 — the epoch is per-PAGE state, and a suite driving several
  // sections is several pages. Leaving it advanced would be harmless; leaving
  // the two latches behind would not, which is why they are nulled above.
  _identityEpoch = 0;
  _lastKnownAuthModeMemory = '';
  _lastNotifiedIdentity = null;
  _identityBatchDepth = 0;
  _identityBatchPending = false;
  _cfg = { authMode: 'pins', supabaseUrl: '', supabaseAnonKey: '' };
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
  try { localStorage.removeItem(LAST_AUTH_MODE_KEY); } catch {}
  // DI-180q — per-DEVICE state, and a suite's sections are different devices.
  try { localStorage.removeItem(DEVICE_DATA_OWNER_KEY); } catch {}
  // Step 3b — the last reconcile outcome is per-PAGE, same lifecycle as the
  // marker above. Left behind, it would make the next section's confirmation
  // card claim a re-download that belonged to the previous one.
  _lastDeviceDataReconcile = null;
  // Through the instrumented write, not a raw removeItem: setActiveLeagueId() is
  // the only function allowed to touch ACTIVE_LEAGUE_KEY, and it recomputes and
  // notifies (into the now-empty listener set) on the way out. It also resets
  // `_synthesizedSession` to the signed-out shape for us.
  setActiveLeagueId(null);
  // The read counter last, so setActiveLeagueId()'s own getActiveLeagueId() call
  // above is not counted against the next section's DI-184h spy.
  _activeLeagueIdReads = 0;
  // Same write-then-notify shape as every other write site (into the empty
  // listener set cleared at the top). No exemption for test hooks.
  _notifyIdentityMaybeChanged();
}
export function _setStoredSessionForTest(session) {
  try {
    if (session) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
}
export function _setMembershipsForTest(list) {
  _membershipsCache = list;
  _recomputeSynthesizedSession();
}
export function _fireAuthEventForTest(event, payload) { _handleAuthStateChange(event, payload); }
export function _setAccountEmailForTest(email) { _accountEmail = email || ''; }
/** SEC F1 — lets authtest drive BOTH sides of the interlock. Production never
 *  calls this; hasSupabaseDataBackend() is a constant false until Step 4. */
export function _setHasSupabaseDataBackendForTest(v) {
  _hasSupabaseDataBackendOverrideForTest = (v === null) ? null : !!v;
}
export function _setAccountUserIdForTest(uid) { _accountUserId = uid || ''; _notifyIdentityMaybeChanged(); }
/** DI-180p — how many COMPLETED verification rounds this page has run since
 *  the last proven-good path (invariant I1). Read by authtest to prove "a
 *  second consecutive 401" is counted per ROUND, not per call and not guessed. */
export function _expiredStrikesForTest() { return _expiredStrikes; }
/** I2 — true while a verification round is open. Lets authtest prove that two
 *  concurrent classifications share ONE round rather than opening two. */
export function _isVerificationInFlightForTest() { return _verificationInFlight !== null; }
/** Reviewer F1 — true while a preference-free membership read is in flight, so
 *  the single-flight latch is observable rather than inferred from call counts
 *  alone. */
export function _isMembershipRefreshInFlightForTest() { return _membershipRefreshInFlight !== null; }
/** DI-180q — lets authtest drive the "marker cannot be persisted" case without
 *  breaking every other write on the stub. Production never calls it. */
export function _setDeviceDataOwnerForTest(tuple) { return _setDeviceDataOwner(tuple); }
export const _AUTH_STORAGE_KEY_FOR_TEST = AUTH_STORAGE_KEY;
export const _DEVICE_DATA_OWNER_KEY_FOR_TEST = DEVICE_DATA_OWNER_KEY;
export const _ACTIVE_LEAGUE_KEY_FOR_TEST = ACTIVE_LEAGUE_KEY;
export const _LAST_AUTH_MODE_KEY_FOR_TEST = LAST_AUTH_MODE_KEY;
export const _SIGNOUT_LOCAL_KEYS_FOR_TEST = _SIGNOUT_LOCAL_KEYS;
