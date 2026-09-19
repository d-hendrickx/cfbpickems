/**
 * chatTransport.js — v0.17.0
 * ============================
 * THE ONLY module that talks to the chat backend. (AD-16: transport isolation.)
 * Exposes exactly the interface from the revised chat spec:
 *
 *   appendEvents(events)   -> { assigned:[{id,seq,ts}], head }
 *   fetchSince(seq, limit) -> { events, head }
 *   fetchBefore(seq,limit) -> { events }
 *   fetchHead()            -> { head }
 *   subscribe(onEvents)    -> unsubscribe()          (polling impl today; websocket later)
 *
 * No other module may reference Apps Script URLs, sheet names, or polling
 * mechanics. Swapping this file for a Supabase implementation is the entire
 * client-side migration.
 *
 * DI-168 (2026-09-11) — subscribe()'s return value gained a second capability,
 * a player-triggered forced poll. It is STILL directly callable as a bare
 * unsubscribe function (every existing caller, incl. boottest.mjs, does
 * exactly that) — it also carries `.unsubscribe` (itself) and `.forceTick()`
 * as properties, so a caller that wants the second capability can destructure
 * `{ unsubscribe, forceTick } = subscribe(...)` instead. See the DI-168f
 * comment on subscribe() itself for why both shapes coexist on one function.
 *
 * ── PHASE III STEP 5 (2026-09-18) — A THIRD MODE, BEHIND THE SAME INTERFACE ─
 *
 * This file now carries TWO backends and one interface. `chat.js` imports
 * exactly what it imported before and cannot tell which is underneath it; there
 * is no `supabase-chat.js` beside this file and there never will be, because
 * AD-16 is the reason this module exists at all.
 *
 *   Sheets    the Apps Script implementation below — GET reads, text/plain POST
 *             writes, adaptive polling. Unchanged, byte for byte, and it is what
 *             every device runs today.
 *   Supabase  PostgREST reads with an explicit column list, `chat_append` /
 *             `chat_append_system` writes, and a `postgres_changes` INSERT
 *             subscription with a contiguity rule in front of it (DI-T5.3).
 *             Reached ONLY when the Step 4 dataMode predicate answers true AND
 *             `installSupabaseChat()` has been called.
 *
 * With `dataMode` absent — every device until Drew flips the flag —
 * `installSupabaseChat()` is never called, `chatTransportMode()` answers
 * 'sheets', and the cost is one extra predicate evaluation per request. No new
 * import was added to this file, deliberately: `rowToMessage` arrives by
 * injection so `js/supabase-projection.js` is not downloaded on a flag-off
 * device (DI-T5.11, Step 4's "zero extra bytes" requirement).
 *
 * v0.17.2 — presence removed (AD-19 amended). The `heartbeat()` method is gone
 * from this interface; the server's `presence` endpoint stays deployed but is
 * never called. Do not re-add a heartbeat without re-opening AD-19.
 *
 * Transport details (Apps Script implementation):
 *  - Reads (head/since/before/metrics) go over GET with query params —
 *    simple requests, no CORS preflight, and they hit the server-side
 *    CacheService fast paths.
 *  - Writes (append) go over POST with Content-Type text/plain — the same
 *    preflight-free pattern the picks sync has used in production since v0.15.
 *  - STALE-DEPLOYMENT DETECTION (the v0.16 chat-outage root cause): if the
 *    deployed Apps Script predates the chat endpoints, every call returns
 *    `Unknown action: …`. We classify that specific failure so the UI can say
 *    "redeploy Code.gs" instead of a generic offline banner.
 */

import { getBackendConfig, isBackendConfigured, requestWithMisrouteGuard } from './backend.js';

/**
 * BUG-A (2026-09-11) — this module has its OWN fetch calls (get/post below), so
 * js/backend.js's `call()` guard does not cover it. A deployed Apps Script that
 * answers a non-ping action with its ping payload (`{ok:true, service:
 * 'cfbp-backend'}`) would have made `appendEvents()` report a message as
 * appended when it never reached the log, and `fetchSince()` report head 0 —
 * i.e. silent chat loss wearing the same "chat is offline" costume RG-09 wore.
 *
 * The detection rule is IMPORTED rather than re-implemented: two copies of a
 * transport invariant is how they drift. `requestWithMisrouteGuard` is a pure
 * retry wrapper around a caller-supplied fetch — AD-16 still holds, this file
 * remains the only module that knows the chat URLs, actions and polling.
 */

export class StaleDeploymentError extends Error {
  constructor(action) {
    super(`Backend deployment is out of date (no '${action}' endpoint). ` +
          `Open Apps Script → Deploy → Manage deployments → Edit → New version.`);
    this.name = 'StaleDeploymentError';
    this.stale = true;
  }
}

/**
 * ── PHASE III STEP 4, §7.3 — THE CHAT TRANSPORT INTERLOCK ────────────────────
 *
 * Every `get()`/`post()` below carries the PRODUCTION league's token to the
 * PRODUCTION league's Sheet (js/backend.js `getBackendConfig()`, whose values
 * come from `config.json` — AD-05). That is correct while the league's data
 * lives in that Sheet. It is a CROSS-LEAGUE BLEED the moment a league's data
 * lives in Supabase instead: a test league running on the Supabase data
 * adapter would be appending its chat to, and reading its chat from, the six
 * players' real log. Same class as SEC F1 (a stranger becoming commissioner),
 * one layer out.
 *
 * So in `dataMode:'supabase'` this module REFUSES BEFORE ANY FETCH, with a
 * typed error, and `subscribe()` delivers nothing. Chat moves to Supabase in
 * Step 5 (AD-16 keeps that a change to THIS file and nothing else); until then
 * a Supabase-scoped league has no chat, loudly, by design — DI §11.3 names it
 * as a residual and Drew decision D-4 makes Step 5 precede cutover because of
 * it.
 *
 * WHY A PREDICATE AND NOT AN IMPORT. `js/backend.js` will own `dataMode`
 * (DI §1.4), and this module already imports backend.js — but Part A of Step 4
 * may not edit backend.js, and a transport that reached into the auth/config
 * layer for a mode flag would be a second opinion about it. So the predicate is
 * INJECTED, defaults to `() => false`, and Part B sets it once at boot. With
 * the default in place this file behaves byte-identically to v0.17.0: one
 * extra function call per request that answers false.
 */
export class ChatTransportUnavailableError extends Error {
  constructor(action) {
    super('Chat moves to the new system in the next build. '
      + `Nothing was sent or read ('${action}' was refused before any request).`);
    this.name = 'ChatTransportUnavailableError';
    this.code = 'chat_transport_unavailable';
    this.action = action;
    /** Marks this as an EXPECTED, designed refusal rather than an outage, so
     *  chat.js's existing catch can hold the outbox and the chat page can show
     *  its "chat is offline" status without a red sync banner. */
    this.interlocked = true;
  }
}

/**
 * ── PHASE III STEP 5, DI-T5.4 — THE ONE PLACE A SUPABASE REFUSAL IS CLASSIFIED ──────────────
 *
 * Every RPC/PostgREST error is turned into one of three classes HERE, once, and surfaced through
 * the channels chat.js already has. No new UI, no second opinion anywhere else in the app.
 *
 *   'permanent'  the server will answer the same way forever — `bad_author`, `bad_state`,
 *                `bad_system_*`, a 42501 policy refusal, a malformed batch. Retrying is noise.
 *                The id is remembered (see `_permanentRefusals`) so the outbox's remaining
 *                attempts cost ZERO network round trips: the message ends on the FAILED chip,
 *                which is what the player needs to see, without hammering the backend on the way.
 *   'retryable'  a rate limit, a 5xx, a dropped connection. The batch is worth sending again.
 *                `retryAfterMs` says how long the transport will refuse locally before it will
 *                even attempt the network again (D-5: a rate limit answered in 2s is the same
 *                answer).
 *   'identity'   `not_member`, `not_authenticated` (28000), PGRST301/401. NOT decided here —
 *                Step 4 §5.2 gives identity ONE classifier, in js/auth.js. This class exists so
 *                the error carries the fact rather than being mistaken for a permanent refusal.
 *
 * `message` is what the player reads (it reaches chat.js's `S.lastError` through
 * `handleTransportError()` and from there the chat status line), so it is written for a person.
 * `serverMessage` keeps the server's own words for the console and the commissioner's banner.
 */
export class ChatWriteRefusedError extends Error {
  constructor({ action, code = '', refusal = 'retryable', message, serverMessage = '', retryAfterMs = 0 }) {
    super(message);
    this.name = 'ChatWriteRefusedError';
    this.action = action;
    this.code = code;
    this.refusal = refusal;
    this.serverMessage = serverMessage;
    this.retryAfterMs = retryAfterMs;
    /** Marks this as a DESIGNED refusal rather than an outage, the same way
     *  ChatTransportUnavailableError does — so chat.js's catch does not raise the red sync
     *  banner for a message the server simply declined. */
    this.refused = true;
  }
}

let _isSupabaseDataMode = null;   // null = NEVER INSTALLED. See interlocked() below.

/**
 * Part B calls this ONCE at boot with the real predicate.
 *
 * DI-T4.12 / security F-1 — THE TWO STATES ARE NOT THE SAME STATE, and the first version of this
 * file collapsed them:
 *
 *   NEVER INSTALLED   this build has no Supabase data layer at all — the flag-off world, which is
 *                     every device today. Chat is available, and must be BYTE-IDENTICAL to
 *                     v0.17.0. Nothing has claimed otherwise, so there is nothing to fail closed
 *                     about.
 *   INSTALLED         Part B has handed this module a live predicate. From that moment the module
 *                     KNOWS the question matters, and a predicate it cannot evaluate is a question
 *                     it cannot answer — which, for a cross-league bleed, must read as "yes,
 *                     interlocked". Failing OPEN there would send a Supabase-scoped league's chat
 *                     to the six players' production Sheet on exactly the devices where the mode
 *                     check is broken, which is the failure this interlock exists to prevent.
 *
 * A NON-FUNCTION ARGUMENT NOW THROWS. It used to silently restore the default — so
 * `setSupabaseDataModePredicate(auth.isSupabaseDataMode)` with a typo'd or not-yet-exported name
 * passed `undefined`, reverted to "chat is available", and the interlock was off for the whole
 * session with no error and no log line. That is a PROGRAMMING error in Part B's wiring, and a
 * programming error should stop at the line that made it, loudly, during the first boot of the
 * build that introduced it — not become a silent security downgrade in production.
 */
export function setSupabaseDataModePredicate(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('setSupabaseDataModePredicate(fn) requires a function; '
      + `received ${fn === null ? 'null' : typeof fn}. `
      + 'Silently reverting to "chat is available" would disable the Step 4 cross-league interlock '
      + 'for the whole session.');
  }
  _isSupabaseDataMode = fn;
}

/** Test-only seam: return the module to its NEVER-INSTALLED state, which no production path can
 *  reach (Part B installs once, at boot). Without it a suite could not exercise the flag-off world
 *  after exercising the installed one. */
export function _resetSupabaseDataModePredicateForTest() {
  _isSupabaseDataMode = null;
}

/**
 * True when this transport must not touch the network.
 *
 * Never throws — an exception here would propagate out of `appendEvents()` as something no caller
 * classifies. But it does NOT answer `false` unconditionally on a throw: see the two states above.
 * Uninstalled and available is the default; installed and unevaluable is INTERLOCKED.
 */
function interlocked() {
  if (_isSupabaseDataMode === null) return false;      // never installed — today's world, unchanged
  let answer;
  try {
    answer = _isSupabaseDataMode();
  } catch (e) {
    console.warn('[chatTransport] the dataMode predicate THREW after being installed — '
      + 'treating chat as INTERLOCKED (fail closed). A league whose mode cannot be determined '
      + 'must not append to the production Sheet.', e && e.name);
    return true;
  }
  // SECURITY F-B — A NON-BOOLEAN ANSWER IS NOT AN ANSWER.
  //
  // `answer === true` alone read every other value as "not interlocked", which is fail-OPEN for a
  // whole family of plausible mistakes, and every one of them is a mistake someone makes on purpose:
  //     () => 'supabase'      returning the MODE STRING instead of a comparison — the single most
  //                           likely wiring error, because `dataMode` is a string in config.json
  //     () => 1               a truthy flag
  //     () => ({ mode: … })   returning the config object
  //     async () => true      forgetting the predicate is synchronous; a Promise is truthy and
  //                           `=== true` is false, so chat went out on EVERY tick
  // In each case the caller clearly believes chat should be interlocked, and each one silently sent
  // a Supabase-scoped league's chat to the six players' production Sheet. So the rule is the same as
  // the throw's: installed, and unevaluable, means INTERLOCKED — and "unevaluable" now includes
  // "answered with something that is not a boolean".
  if (typeof answer !== 'boolean') {
    console.warn('[chatTransport] the dataMode predicate returned a NON-BOOLEAN '
      + `(${answer === null ? 'null' : typeof answer}) after being installed — treating chat as `
      + 'INTERLOCKED (fail closed). It must return exactly true or false, synchronously.');
    return true;
  }
  return answer;
}

/**
 * ══ PHASE III STEP 5 — THE SUPABASE CHAT CONTEXT (DI-T5.1) ══════════════════════════════════
 *
 * `_isSupabaseDataMode` above says WHETHER this league's data lives in Supabase. This says
 * whether this build can actually SERVE chat from there. They are separate for a reason that is
 * not theoretical: Part B installs the predicate and the chat context in the same boot, and if
 * they ever land in separate commits there is a build in between. That build must FAIL CLOSED —
 * the Step 4 interlock, with its own copy — never fall back to the six players' production Sheet.
 *
 *   predicate never installed        -> 'sheets'        today's world. BYTE-IDENTICAL to v0.17.0.
 *   predicate installed, answers no  -> 'sheets'        unchanged.
 *   predicate installed, answers yes + context installed     -> 'supabase'    this step.
 *   predicate installed, answers yes + context NOT installed -> 'interlocked' Step 4's refusal.
 *   predicate throws / non-boolean                           -> 'interlocked' DI-T4.12, unchanged.
 *
 * INJECTED, NEVER IMPORTED — the same rule and the same reason as
 * `setSupabaseDataModePredicate()` (see its note above): this module must not reach into the
 * auth/config layer and must not import the Step 4 adapter. It also buys DI-T5.11's hard
 * requirement — `rowToMessage` arrives as an argument, so `js/supabase-projection.js` is NOT
 * downloaded on a flag-off device and this file adds ZERO new imports.
 *
 *   getClient()         js/auth.js's ensureClient() — the SAME client the data adapter gets, so
 *                       one session, one setAuth, one websocket.
 *   getLeagueId()       js/auth.js's getActiveLeagueId() — DI-184d's invariant: the header pill
 *                       and every league_id predicate come from one call.
 *   rowToMessage(row)   js/supabase-projection.js's existing export. The column<->field map is
 *                       INJECTED, never re-implemented — a second hand-authored copy of a map is
 *                       the defect class RG-27/131/149 record three times over.
 *   isReady()           the adapter's isReady(). Chat does not fetch from a mirror that is not
 *                       serving (DI-T5.8).
 *   getIdentityEpoch()  OPTIONAL, defaults to `() => null`. ADDITIVE to the four the DI names,
 *                       and reported as such: without it `_chatOpMoved()` can only compare the
 *                       LEAGUE term, and an account change that does not move the league (a
 *                       handover on the same phone) would leave an in-flight fetch to fold under
 *                       the new identity. app.js's chokepoint already tears the subscription down
 *                       for that case; this is the transport's own copy of `_opMoved()`'s I6
 *                       discipline (js/supabase-backend.js:873) rather than a dependency on that
 *                       ordering holding.
 *
 * A non-function in any of the four REQUIRED slots throws a TypeError at install time, for the
 * reason DI-T4.12 recorded about the predicate: a silent revert is a security downgrade that
 * lasts the whole session, and a programming error should stop at the line that made it.
 */
let _sbChat = null;

export function installSupabaseChat(deps = {}) {
  const {
    getClient, getLeagueId, rowToMessage, isReady,
    getIdentityEpoch = () => null,
    onAdapterSynced = null,
  } = deps || {};
  const required = { getClient, getLeagueId, rowToMessage, isReady };
  for (const [slot, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') {
      throw new TypeError(`installSupabaseChat({ ${slot} }) requires a function; `
        + `received ${fn === null ? 'null' : typeof fn}. `
        + 'Silently accepting a partial install would leave chat INTERLOCKED for the whole '
        + 'session with no error and no log line — the DI-T4.12 failure, one slot over.');
    }
  }
  if (typeof getIdentityEpoch !== 'function') {
    throw new TypeError('installSupabaseChat({ getIdentityEpoch }) must be a function when supplied.');
  }
  if (onAdapterSynced !== null && typeof onAdapterSynced !== 'function') {
    throw new TypeError('installSupabaseChat({ onAdapterSynced }) must be a function when supplied.');
  }
  _sbChat = { getClient, getLeagueId, rowToMessage, isReady, getIdentityEpoch };
  // A7 — subscribe to the adapter's `synced` signal, and drop any previous subscription first so a
  // re-install cannot leave two listeners racing the same parked set.
  if (typeof _adapterSyncedOff === 'function') { try { _adapterSyncedOff(); } catch { /* a dead unsubscriber is not this module's problem */ } }
  _adapterSyncedOff = null;
  if (typeof onAdapterSynced === 'function') {
    try {
      const off = onAdapterSynced(() => _releaseParkedNow());
      _adapterSyncedOff = typeof off === 'function' ? off : null;
    } catch (e) {
      // NOT fatal, unlike a missing required dep: without it the ladder's first rung is the
      // fallback the amendment already names, so the posts still go out — just a little later.
      console.warn('[chatTransport] onAdapterSynced() threw at install; the parked-post ladder will use its own timer', e && e.name);
    }
  }
}

/** Test-only seam, the `_resetSupabaseDataModePredicateForTest` convention. No production path
 *  can reach it — Part B installs once, at boot. */
export function _resetSupabaseChatForTest() {
  if (typeof _adapterSyncedOff === 'function') { try { _adapterSyncedOff(); } catch { /* ignore */ } }
  _adapterSyncedOff = null;
  _dropParked('the chat context was reset');
  _sbChat = null;
}

/** 'sheets' | 'supabase' | 'interlocked'. The ONE place the four-state table above is evaluated.
 *  Exported because js/scribeAgent.js's `@scribe` branch (DI-T5.6) needs the same answer and
 *  must not form a second opinion about it. */
export function chatTransportMode() {
  if (!interlocked()) return 'sheets';
  return _sbChat ? 'supabase' : 'interlocked';
}

/**
 * The route every exported request takes, in one place. Returns 'sheets' or 'supabase'; throws
 * the Step 4 refusal for 'interlocked'.
 *
 * WHY THE THROW MOVED UP HERE, rather than being left to get()/post(): `interlocked()` emits ONE
 * console warning per evaluation for a throwing or non-boolean predicate (that warning is itself
 * asserted — a safe-but-silent refusal is undiagnosable), and asking the question twice per
 * request would double it. get()/post() keep their own guard below as defence in depth; on this
 * path it is now unreachable, which is the correct direction for a guard to be redundant in.
 */
function routeOrRefuse(action) {
  const m = chatTransportMode();
  if (m === 'interlocked') throw new ChatTransportUnavailableError(action);
  return m;
}

/** Never throws — a broken dependency must read as "not ready", not as an exception escaping
 *  `appendEvents()` that no caller classifies. */
function _sbCall(name, ...args) {
  try { return _sbChat && typeof _sbChat[name] === 'function' ? _sbChat[name](...args) : null; }
  catch (e) { console.warn(`[chatTransport] the injected ${name}() threw`, e && e.name); return null; }
}

function sbClient() { return _sbCall('getClient'); }
function sbLeague() { const v = _sbCall('getLeagueId'); return v ? String(v) : ''; }
function sbEpoch() { const v = _sbCall('getIdentityEpoch'); return v === undefined ? null : v; }

/** The token every asynchronous Supabase chat operation is issued under, and the predicate that
 *  says it has moved. `_opMoved()`'s discipline (js/supabase-backend.js:873, reviewer F2): no
 *  asynchronous result may be applied under a league/identity other than the one it was issued
 *  under. One predicate, every call site, no second opinion. */
function _chatToken() { return { leagueId: sbLeague(), epoch: sbEpoch() }; }
function _chatOpMoved(token) {
  if (!token) return false;
  if (sbLeague() !== token.leagueId) return true;
  const now = sbEpoch();
  return token.epoch !== null && now !== null && now !== token.epoch;
}

/** True when a Supabase-mode read/write may actually be attempted right now (DI-T5.8). */
function sbReady() {
  if (!_sbChat) return false;
  if (!sbLeague() || !sbClient()) return false;
  let ready = false;
  try { ready = _sbChat.isReady() === true; } catch (e) { console.warn('[chatTransport] isReady() threw', e && e.name); return false; }
  if (!ready) return false;
  // DI-T5.8's OFFLINE half. A device the browser reports as offline issues no fetch and opens no
  // channel; chat renders from the device-local events cache and the outbox ACCEPTS sends and
  // holds them, which is the one place chat is deliberately more permissive than save().
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return false;
  return true;
}

// ── DI-T5.2 — the column list, and it is never `*` ────────────────────────────────────────────
// `author_member_id`, `author_kind` and `emitted_by` are DELIBERATELY absent. They are derived
// and attribution columns that have never existed on the wire event; selecting them would be one
// step from leaking them into `meta`, and `emitted_by` in particular is excluded from every
// member-readable grant by 0010 (annotation A2) — naming it here would turn every read into a
// 42501. supabase/tests/static.check.mjs pins that this list never grows it.
const SB_MESSAGE_COLS = 'league_id,id,seq,ts,type,author,game_tag,body,target_id,reply_to,notify,meta';

function sbMapRow(row) {
  const map = _sbChat && _sbChat.rowToMessage;
  return map(row);
}

// ── DI-T5.4 — refusal classification, and the two local brakes it needs ───────────────────────
//
// THE HONEST LIMIT, stated here rather than discovered later. The DI asks that a permanent
// refusal leave the outbox immediately and that a rate refusal retry at 60s rather than on the
// 2s ladder. BOTH of those are decisions of the outbox SCHEDULER, which lives in js/chat.js — a
// file Step 5 may not edit (DI §10). What this module can do, and does, is make sure neither
// costs the backend anything: a permanently-refused id and an open rate cooldown are both
// answered LOCALLY, with no request, so chat.js's existing bounded ladder runs out against this
// file instead of against the server. The residual — the FAILED chip arrives after the ladder
// rather than on the first refusal — is reported as a named partial.
const RATE_COOLDOWN_MS = 60000;
const PERMANENT_REFUSAL_MAX = 200;   // bounded: an unbounded id map is a memory leak wearing a guard's clothes
const _permanentRefusals = new Map();   // event id -> { code, at }
let _rateCooldownUntil = 0;

function _rememberPermanent(ids, code) {
  for (const id of ids) {
    if (!id) continue;
    if (_permanentRefusals.size >= PERMANENT_REFUSAL_MAX) {
      const oldest = _permanentRefusals.keys().next().value;
      _permanentRefusals.delete(oldest);
    }
    _permanentRefusals.set(String(id), { code, at: Date.now() });
  }
}

/**
 * ══ AMENDMENT A7 (coordinator, 2026-09-18) — PARK AND RETRY A `bad_state` ══════════════════
 *
 * THE RACE. Migration 0010's annotation A1 gates the ritual posts on the state their deterministic
 * id asserts. The client emits the post and performs the transition in the SAME tick, and the two
 * travel on DIFFERENT debounced queues: the chat outbox at FLUSH_COALESCE_MS = 750 ms
 * (js/chat.js:692) and the data adapter's push at PUSH_DEBOUNCE_MS = 800 ms
 * (js/supabase-backend.js:165). So `sys_final_<game>` can reach the server ~50 ms BEFORE
 * `games.status = 'final'` does, and be refused for a state that is about to be true. Same shape
 * for `sys_reveal_<week>` against `transition_week`, and for `pin_wk_<week>` against the finalize.
 *
 * THE FIX, and it is entirely inside this module because js/chat.js may not be edited: a
 * `bad_state` refusal PARKS the event here, in RAM, keyed by its deterministic id, and this module
 * re-sends it —
 *   • immediately when the adapter reports its flush LANDED (the injected `onAdapterSynced(cb)`;
 *     with no dep injected the first rung of the ladder below is the fallback, which is why its
 *     first step is 2 s rather than something cleverer);
 *   • then on a BOUNDED ladder, never more than ONE resend in flight per id;
 *   • until a 60 s ceiling, after which it becomes the permanent refusal — the FAILED chip.
 *
 * BOUNDED IS LOAD-BEARING, for the reason every accelerated path in this file is bounded: an
 * unbounded resend against a state that is never going to arrive is a quota bug wearing a fix's
 * clothes, and it would keep a post alive long after the player had been told it failed.
 *
 * WHY THE RESEND DOES NOT NEED TO SETTLE ANYTHING. The event is still in chat.js's outbox and
 * still in its `S.items` as a local item with `seq === null`. When the parked resend lands, the
 * row is in the log — and the subscription ingests it on the next delivery, at which point
 * `ingest()`'s reconcile branch (js/chat.js:538-541) sets the seq and calls `settleAppend()`. That
 * is the same path RG-95 already relies on for an append whose own reply was lost. Nothing here
 * reaches into chat.js, and nothing here reports a message as sent that was not.
 *
 * R1/R2 — THE PARKED SET IS IDENTITY-SCOPED. Every entry carries the `(leagueId, epoch)` token it
 * was issued under, and the whole set is dropped when that token moves or when the subscription is
 * torn down (a league switch, an account handover, a hold gate). A parked post belongs to one room
 * under one identity; relaying it into another is the same failure chat.js's own outbox league
 * stamp exists to prevent (SECURITY F-4), one layer out.
 */
const PARK_STEPS = Object.freeze([2000, 5000, 10000, 20000]);
const PARK_CEILING_MS = 60000;
let _parkSteps = PARK_STEPS;
let _parkCeilingMs = PARK_CEILING_MS;
const _parked = new Map();   // event id -> { ev, token, attempts, firstAt, timer, inFlight }
let _adapterSyncedOff = null;

function _clearParkTimer(entry) {
  if (entry && entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
}

/** Drops the whole parked set. Called on a league/epoch move and on teardown (R2). Logs a COUNT,
 *  never an id and never a body — the same rule js/chat.js:1006-1010 applies to its outbox guard. */
function _dropParked(reason) {
  if (!_parked.size) return 0;
  const n = _parked.size;
  for (const entry of _parked.values()) _clearParkTimer(entry);
  _parked.clear();
  console.warn(`[chatTransport] ${n} parked system post(s) dropped — ${reason}`);
  return n;
}

function _expirePark(id) {
  const entry = _parked.get(id);
  if (!entry) return;
  _clearParkTimer(entry);
  _parked.delete(id);
  // THE CEILING IS WHERE `bad_state` FINALLY BECOMES WHAT DI-T5.4'S TABLE CALLS IT. Up to here it
  // was treated as transient because the race makes it transient; past here the state is simply
  // not going to arrive, and the player is owed the FAILED chip rather than a post that never
  // stops trying.
  _rememberPermanent([id], 'bad_state');
  console.warn('[chatTransport] 1 parked system post reached the retry ceiling and is now a permanent refusal');
}

function _scheduleParked(id) {
  const entry = _parked.get(id);
  if (!entry) return;
  if (entry.timer || entry.inFlight) return;            // ONE resend in flight per id, always
  if (Date.now() - entry.firstAt >= _parkCeilingMs || entry.attempts >= _parkSteps.length) {
    _expirePark(id);
    return;
  }
  const wait = _parkSteps[Math.min(entry.attempts, _parkSteps.length - 1)];
  entry.timer = setTimeout(() => { entry.timer = null; _resendParked(id); }, wait);
  entry.timer?.unref?.();   // never hold a Node test harness open (the push-onesignal.js precedent)
}

async function _resendParked(id) {
  const entry = _parked.get(id);
  if (!entry) return;
  if (_chatOpMoved(entry.token)) { _dropParked('the league/identity moved while it was parked'); return; }
  if (!sbReady()) { entry.attempts++; _scheduleParked(id); return; }
  entry.inFlight = true;
  try {
    const { error } = await sbClient().rpc('chat_append_system', {
      p_league: entry.token.leagueId,
      p_events: [sbPackEvent(entry.ev)],
    });
    entry.inFlight = false;
    // I6 again — the answer must not be acted on under an identity it was not issued under.
    if (_chatOpMoved(entry.token)) { _dropParked('the league/identity moved mid-resend'); return; }
    if (!error) { _clearParkTimer(entry); _parked.delete(id); return; }
    entry.attempts++;
    _scheduleParked(id);
  } catch {
    entry.inFlight = false;
    entry.attempts++;
    _scheduleParked(id);
  }
}

/** The adapter said its flush landed, so the state the parked posts are waiting on is now in the
 *  database. Resend every one of them NOW rather than at the next rung — this is the whole reason
 *  the dep exists, and it turns a 2-to-20-second wait into one round trip. */
function _releaseParkedNow() {
  for (const [id, entry] of _parked) {
    if (entry.inFlight) continue;
    _clearParkTimer(entry);
    _resendParked(id);
  }
}

function _parkBadState(events, token) {
  for (const ev of events) {
    const id = String(ev && ev.id || '');
    if (!id || _parked.has(id)) continue;
    _parked.set(id, { ev, token, attempts: 0, firstAt: Date.now(), timer: null, inFlight: false });
    _scheduleParked(id);
  }
}

/** Test seam only — production never clears these (a page load does). */
export function _resetRefusalStateForTest() {
  _permanentRefusals.clear();
  _rateCooldownUntil = 0;
  for (const entry of _parked.values()) _clearParkTimer(entry);
  _parked.clear();
  _parkSteps = PARK_STEPS;
  _parkCeilingMs = PARK_CEILING_MS;
}
export function _refusalStateForTest() {
  return {
    permanent: [..._permanentRefusals.keys()],
    rateCooldownUntil: _rateCooldownUntil,
    parked: [..._parked.keys()],
  };
}
/** Test seam — compress A7's ladder so the ceiling is reachable in a suite rather than in a
 *  minute. The `_setAppendWaitMsForTest` precedent (js/scribeLines.js:468). Production never calls
 *  it, and it can only make the schedule SHORTER, never unbounded: the ceiling is still enforced
 *  and the step list is still finite. */
export function _setParkScheduleForTest({ steps = null, ceilingMs = null } = {}) {
  _parkSteps = Array.isArray(steps) && steps.length ? Object.freeze(steps.slice()) : PARK_STEPS;
  _parkCeilingMs = typeof ceilingMs === 'number' && ceilingMs > 0 ? ceilingMs : PARK_CEILING_MS;
}

const RATE_COPY = 'Sending too fast — your messages will go out in a minute.';

function classifySupabaseError(action, error) {
  const code = String((error && (error.code || error.status)) || '');
  const server = String((error && (error.message || error.details)) || error || '');
  const mk = (refusal, message, retryAfterMs = 0) => new ChatWriteRefusedError({
    action, code, refusal, message, serverMessage: server, retryAfterMs,
  });
  // IDENTITY IS NOT DECIDED HERE (Step 4 §5.2 — auth.js owns the ONE classifier). The class is
  // carried so the outbox HOLDS rather than failing the message under a resolvable identity.
  if (code === '28000' || code === 'PGRST301' || code === '401'
      || /not_authenticated|not_member|jwt|invalid\s+token/i.test(server)) {
    return mk('identity', 'Your session needs to be re-established before this can be sent.');
  }
  if (/message_rate|system_rate|rate limit exceeded/i.test(server)) {
    return mk('retryable', RATE_COPY, RATE_COOLDOWN_MS);
  }
  if (/bad_author/i.test(server)) {
    return mk('permanent', 'That message was refused: it is not attributed to you.');
  }
  if (/bad_state/i.test(server)) {
    // CLASSIFIED PERMANENT HERE, AND HANDLED AS TRANSIENT BY THE CALLER — and the split is the
    // point. The server's answer IS final for the state it saw; what makes `bad_state` different
    // from every other permanent refusal is that the state itself is usually about to change,
    // because 0010's annotation A1 gates on a transition that travels on a different debounced
    // queue from the post (js/chat.js:692's 750ms outbox vs js/supabase-backend.js:165's 800ms
    // push). So `sbAppendEvents()` intercepts this class BEFORE the memo and hands it to A7's
    // park-and-retry, which is the thing that knows how to wait. Anything that reaches this branch
    // and is NOT intercepted there — a future caller, a direct classification — still gets the
    // honest permanent answer rather than an optimistic one.
    return mk('permanent', 'That post was refused: the week or game it describes is not in that state yet.');
  }
  if (/bad_system_author|bad_system_id|bad_system_type/i.test(server)) {
    return mk('permanent', 'That automatic post was refused by the server.');
  }
  if (/bad_events|too_many_events/i.test(server)) {
    return mk('permanent', 'That batch was refused by the server.');
  }
  if (code === '42501' || /permission denied|row-level security|policy/i.test(server)) {
    return mk('permanent', server || 'That message was refused by the server.');
  }
  // Everything else — network, 5xx, a dropped socket. Worth another go on the existing ladder.
  return mk('retryable', server || 'Chat could not reach the server.');
}

function classify(action, err) {
  if (/unknown action/i.test(String(err?.message || err))) return new StaleDeploymentError(action);
  return err;
}

async function get(action, params = {}) {
  // FIRST LINE, before the config read and before any fetch — §7.3. The order
  // matters: a device in Supabase data mode may still hold a perfectly valid
  // Sheets config, so "not configured" would never fire and the request would
  // go out.
  if (interlocked()) throw new ChatTransportUnavailableError(action);
  const c = getBackendConfig();
  if (!c || !c.url) throw new Error('Backend not configured');
  const u = new URL(c.url);
  u.searchParams.set('action', action);
  u.searchParams.set('token', c.token || '');
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, String(v)); });
  const data = await requestWithMisrouteGuard(action, async () => {
    const res = await fetch(u.toString(), { method: 'GET', redirect: 'follow' });
    // BUG-E — carry the status on the error so requestWithMisrouteGuard can tell
    // a transient (retryable) status from a permanent one without parsing prose.
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.json();
  });
  if (!data.ok) throw classify(action, new Error(data.error || 'Backend error'));
  return data;
}

async function post(action, payload = {}) {
  // §7.3 — same rule, same position, for the write half. `appendEvents()` is
  // the one that matters most: an append that reached the production Sheet
  // could not be taken back.
  if (interlocked()) throw new ChatTransportUnavailableError(action);
  const c = getBackendConfig();
  if (!c || !c.url) throw new Error('Backend not configured');
  const data = await requestWithMisrouteGuard(action, async () => {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: c.token, ...payload }),
      redirect: 'follow',
    });
    // BUG-E — carry the status on the error so requestWithMisrouteGuard can tell
    // a transient (retryable) status from a permanent one without parsing prose.
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.json();
  });
  if (!data.ok) throw classify(action, new Error(data.error || 'Backend error'));
  return data;
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// SUPABASE IMPLEMENTATION (Phase III Step 5) — the same six functions, a different backend.
//
// AD-16 holds by construction: there is no second module, no second URL, no second polling
// mechanic. `chat.js` imports exactly what it imported before and cannot tell which backend is
// underneath it — which is the whole shape of DI-T5.1.
// ══════════════════════════════════════════════════════════════════════════════════════════

/** `chat_head(p_league)` returns a bare bigint, so `data` is the number itself. */
async function sbFetchHead() {
  const client = sbClient();
  const leagueId = sbLeague();
  const { data, error } = await client.rpc('chat_head', { p_league: leagueId });
  if (error) throw classifySupabaseError('chatHead', error);
  return { head: Number(data) || 0 };
}

async function sbFetchSince(seq, limit) {
  const client = sbClient();
  const token = _chatToken();
  const { data, error } = await client
    .from('messages')
    .select(SB_MESSAGE_COLS)
    .eq('league_id', token.leagueId)
    .gt('seq', seq)
    .order('seq', { ascending: true })
    .limit(limit);
  if (error) throw classifySupabaseError('chatSince', error);
  // I6 — no asynchronous result may be applied under a league/identity other than the one it was
  // issued under (js/supabase-backend.js `_opMoved()`). Discarded with a console line, never
  // folded, and never allowed to advance a cursor that now belongs to a different room.
  if (_chatOpMoved(token)) {
    console.warn('[chatTransport] a chat page arrived for a league/identity this device has already left — DISCARDED');
    return { events: [], head: 0 };
  }
  // The head is a SEPARATE chat_head call and NEVER max(seq) of this page. The paging contract
  // (BUG-B / RG-94) is exactly the difference between the two: drainSince() walks forward until
  // the events in hand reach the TRUE head, and a page-derived head would say it had arrived on
  // the first page, every time.
  const { head } = await sbFetchHead();
  if (_chatOpMoved(token)) {
    console.warn('[chatTransport] the chat head arrived for a league/identity this device has already left — DISCARDED');
    return { events: [], head: 0 };
  }
  return { events: (data || []).map(sbMapRow), head };
}

async function sbFetchBefore(seq, limit) {
  const client = sbClient();
  const token = _chatToken();
  const { data, error } = await client
    .from('messages')
    .select(SB_MESSAGE_COLS)
    .eq('league_id', token.leagueId)
    .lt('seq', seq)
    .order('seq', { ascending: false })
    .limit(limit);
  if (error) throw classifySupabaseError('chatBefore', error);
  if (_chatOpMoved(token)) {
    console.warn('[chatTransport] a backfill page arrived for a league/identity this device has already left — DISCARDED');
    return { events: [] };
  }
  // REVERSED. `backfill()` has always been handed ASCENDING history; the descending order above
  // is only how you ask Postgres for "the newest N below this seq".
  return { events: (data || []).reverse().map(sbMapRow) };
}

// ── DI-T5.4 / DI-T5.5 — the write path ────────────────────────────────────────────────────────
const SB_PLAYER_BATCH_MAX = 50;   // chat_append raises `too_many_events` above 50 (0008:343)
const SB_SYSTEM_BATCH_MAX = 20;   // chat_append_system raises it above 20 (0010)
const SB_SYSTEM_AUTHORS = Object.freeze(['scribe', 'system']);

function isSystemAuthored(ev) { return SB_SYSTEM_AUTHORS.includes(String(ev && ev.author || '')); }

/**
 * DI-T5.4(a) — `notify` IS PACKED AS `meta._n`, and missing it is a live defect rather than a
 * detail. `chat_append` reads `coalesce((v_ev->'meta'->>'_n')::boolean, false)` (0008:364) — the
 * SHEET's packed shape, which Code.gs:930-931 produces. The client event carries a TOP-LEVEL
 * `notify` and a `meta` with no `_n` (chat.js:633-653), so posting the raw event would write
 * `notify = false` on every row and silently take out the unread badge, the teaser, the mention
 * count and every push (the relay gates on `notify`). `chat_append` stores `meta - '_n'`, so the
 * round trip back through `rowToMessage()` is exact.
 *
 * Only the fields the RPC reads go on the wire: `leagueId`, `local` and `_localTs` are
 * device-side bookkeeping and have no business in the log.
 */
function sbPackEvent(ev) {
  const meta = { ...(ev.meta || {}), _n: ev.notify ? 1 : 0 };
  return {
    id: ev.id,
    type: ev.type || 'message',
    author: ev.author || 'unknown',
    gameTag: ev.gameTag || '',
    body: ev.body || '',
    targetId: ev.targetId || '',
    replyTo: ev.replyTo || '',
    meta,
  };
}

/**
 * Split the batch into runs that preserve ORDER and respect each RPC's own cap. Consecutive
 * events of the same kind stay together; a player event between two SCRIBE posts splits the run
 * rather than being reordered around it, because the log's order is the room's order.
 */
function sbPlanBatches(events) {
  const runs = [];
  for (const ev of events) {
    const kind = isSystemAuthored(ev) ? 'system' : 'player';
    const cap = kind === 'system' ? SB_SYSTEM_BATCH_MAX : SB_PLAYER_BATCH_MAX;
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && last.events.length < cap) last.events.push(ev);
    else runs.push({ kind, events: [ev] });
  }
  return runs;
}

async function sbAppendEvents(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return { assigned: [], head: 0 };

  // LOCAL BRAKE 1 — a permanently-refused id is answered without a request. See the note on
  // `_permanentRefusals`: the outbox's remaining attempts must not become a retry loop against
  // the server for an answer that cannot change.
  const alreadyRefused = list.filter((e) => _permanentRefusals.has(String(e && e.id)));
  if (alreadyRefused.length) {
    const code = _permanentRefusals.get(String(alreadyRefused[0].id)).code;
    // A COUNT, never a body and never an id (chat.js:1006-1010's rule).
    console.warn(`[chatTransport] ${alreadyRefused.length} event(s) in this batch were already permanently refused (${code}) — not re-sent`);
    throw new ChatWriteRefusedError({
      action: 'chatAppend', code, refusal: 'permanent',
      message: 'That message was refused by the server and will not be sent again.',
      serverMessage: code,
    });
  }
  // LOCAL BRAKE 1b — A7. An id this module is already re-sending on its own ladder must not also
  // be sent by the outbox: "never more than one resend in flight per id" is the amendment's own
  // wording, and two senders for one deterministic id is how a bounded ladder becomes an
  // unbounded one. Refused locally, with no request, and classified RETRYABLE so the outbox KEEPS
  // the event rather than failing it — the park is what is carrying it.
  const parkedHere = list.filter((e) => _parked.has(String(e && e.id)));
  if (parkedHere.length) {
    throw new ChatWriteRefusedError({
      action: 'chatAppend', code: 'bad_state', refusal: 'retryable',
      message: 'Waiting for the week or game this post describes to catch up.',
      serverMessage: 'parked pending state',
      retryAfterMs: _parkSteps[0],
    });
  }
  // LOCAL BRAKE 2 — D-5's cooldown. A rate limit answered two seconds later is the same answer,
  // so the transport refuses locally for the rest of the window instead of asking again.
  const now = Date.now();
  if (_rateCooldownUntil > now) {
    throw new ChatWriteRefusedError({
      action: 'chatAppend', code: 'message_rate', refusal: 'retryable',
      message: RATE_COPY, serverMessage: 'local rate cooldown',
      retryAfterMs: _rateCooldownUntil - now,
    });
  }

  const client = sbClient();
  const token = _chatToken();
  const assigned = [];
  for (const run of sbPlanBatches(list)) {
    const fn = run.kind === 'system' ? 'chat_append_system' : 'chat_append';
    const { data, error } = await client.rpc(fn, {
      p_league: token.leagueId,
      p_events: run.events.map(sbPackEvent),
    });
    if (error) {
      const refusal = classifySupabaseError('chatAppend', error);
      // ── A7 — `bad_state` IS THE ONE REFUSAL THIS MODULE CARRIES ITSELF ─────────────────────
      // It is never memoised here (that would drop it on the first answer) and it does not spend
      // the rate cooldown (it is not a rate limit). The run is PARKED and this module re-sends it
      // on its own bounded ladder; the throw below is classified RETRYABLE so the outbox keeps the
      // event, and LOCAL BRAKE 1b above then answers the outbox's own retries without a request.
      if (/bad_state/i.test(refusal.serverMessage)) {
        _parkBadState(run.events, token);
        throw new ChatWriteRefusedError({
          action: 'chatAppend', code: 'bad_state', refusal: 'retryable',
          message: 'Waiting for the week or game this post describes to catch up.',
          serverMessage: refusal.serverMessage,
          retryAfterMs: _parkSteps[0],
        });
      }
      if (refusal.refusal === 'permanent') _rememberPermanent(run.events.map((e) => e.id), refusal.code || 'refused');
      if (refusal.retryAfterMs) _rateCooldownUntil = Date.now() + refusal.retryAfterMs;
      throw refusal;
    }
    // I6 again. An append whose reply lands after the identity moved must not be reconciled into
    // a room that is no longer this device's: the ids are deterministic and the server deduped
    // them, so nothing is lost by declining to fold the acknowledgement.
    if (_chatOpMoved(token)) {
      console.warn('[chatTransport] an append acknowledgement arrived for a league/identity this device has already left — DISCARDED');
      return { assigned: [], head: 0 };
    }
    for (const a of data || []) {
      assigned.push({ id: a.id, seq: a.seq, ts: sbTs(a.ts), deduped: a.deduped === true });
    }
  }
  // `head` here is the highest seq THIS CALL assigned — it is NOT a head, and RG-95 forbids any
  // caller adopting it as a poll cursor. chat.js deliberately ignores it, exactly as it ignores
  // the Sheets path's true head. Kept on the return only so the shape is the same one.
  const top = assigned.reduce((m, a) => (typeof a.seq === 'number' && a.seq > m ? a.seq : m), 0);
  return { assigned, head: top };
}

/** `chat_append`/`chat_append_system` return `ts` as a timestamptz string (D-2). The wire event
 *  has always carried epoch ms, and chat.js's `cmpOrder` is `(ts, seq)` — so the conversion
 *  happens here, once, on the way in. A value that will not parse is dropped rather than turned
 *  into NaN, which would sort the sender's own message to the top of the room forever. */
function sbTs(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : undefined;
}

// ── Interface ────────────────────────────────────────────────────────────────

export async function appendEvents(events) {
  if (routeOrRefuse('chatAppend') === 'supabase') return sbAppendEvents(events);
  const r = await post('chatAppend', { events });
  // `head` here is the server's TRUE sheet head, NOT a head this device has
  // received events up to. RG-95: chat.js deliberately ignores it, and no
  // other caller may adopt it as a poll cursor — doing so claims every event
  // between here and the true head as already seen. It stays on the return
  // only as a transport-level diagnostic (backendtest.mjs asserts on it to
  // prove an append survived a misroute, BUG-A); treat it as read-only.
  return { assigned: r.assigned || [], head: r.head ?? 0 };
}

export async function fetchSince(seq, limit = 300) {
  if (routeOrRefuse('chatSince') === 'supabase') return sbFetchSince(seq, limit);
  const r = await get('chatSince', { seq, limit });
  return { events: r.events || [], head: r.head ?? 0 };
}

export async function fetchBefore(seq, limit = 100) {
  if (routeOrRefuse('chatBefore') === 'supabase') return sbFetchBefore(seq, limit);
  const r = await get('chatBefore', { seq, limit });
  return { events: r.events || [] };
}

export async function fetchHead() {
  if (routeOrRefuse('chatHead') === 'supabase') return sbFetchHead();
  const r = await get('chatHead');
  return { head: r.head ?? 0 };
}

/**
 * DI-T5.10 — `fetchMetrics()` is an APPS SCRIPT QUOTA DIAGNOSTIC. Supabase has no such thing:
 * there is no execution count, no per-day cap and no CacheService hit rate to report. So in
 * Supabase mode it answers honestly rather than inventing an empty series, and the extra
 * `unsupported` flag is what lets the Comm→Settings card say "not applicable" instead of the
 * current "No metrics yet — they accrue once chat traffic starts", which would be a lie on a
 * backend that has no such metric.
 *
 * NAMED FOLLOW-UP (D-6): reading that flag is a two-string change in js/app.js:13361 and
 * js/app.js:13348, which Step 4 Part B owns right now. Until it lands the card falls through to
 * the existing empty-state copy — visibly wrong, never misleading about DATA.
 */
export async function fetchMetrics(days = 7) {
  if (routeOrRefuse('chatMetrics') === 'supabase') return { rows: [], unsupported: true };
  const r = await get('chatMetrics', { days });
  return { rows: r.rows || [] };
}

/**
 * DI-T5.6 / D-4 — THE `@scribe` SEAM, DEFINED NOW, IMPLEMENTED IN STEP 6.
 *
 * Today the relay is Apps Script: it re-reads the trigger message out of the production Sheet,
 * calls Anthropic, and writes BOTH the ack and the reply as `author:'scribe'`. Under D-4's
 * allow-list that relay is refused in `dataMode:'supabase'` — it would read the production
 * league's log, which is a cross-league bleed.
 *
 * So for Step 5 this makes NO network call and answers `{ ok: true, unavailable: true }`.
 * `fireScribeMention()` (js/scribeLines.js:514) treats every non-answer identically — its only
 * success test is `r.ok && r.responseMessageId` — so the player gets SCRIBE's voice from the
 * local pool under the same deterministic `scribe_llm_<triggerMessageId>` id, with no dead air
 * and no change to js/scribeLines.js. The degrade post itself is `author:'scribe'` and therefore
 * rides DI-T5.5's `chat_append_system` path.
 *
 * THE CONTRACT STEP 6 MUST HONOUR, fixed here so Step 6 cannot re-open AD-16:
 *   request   { leagueId, triggerMessageId, playerId, weekId, gameTag, webSearch }
 *   response  { ok, responseMessageId | null, disabled?, deduped?, error? }
 * Step 6 replaces the body below with `client.functions.invoke('scribe-ask', …)` and touches
 * nothing else; the Edge Function writes the ack and the reply with the SERVICE ROLE, which is
 * what 0002:290's "service-role only" sentence always meant.
 */
export async function askScribe({ triggerMessageId = '', playerId = '', weekId = '', gameTag = '', webSearch = false } = {}) {
  void triggerMessageId; void playerId; void weekId; void gameTag; void webSearch;
  return { ok: true, unavailable: true, responseMessageId: null };
}

/**
 * subscribe(onEvents, opts) — polling implementation of a push interface.
 * Two-phase: polls the cheap cached head; only calls fetchSince when the head
 * has actually advanced. The ONE exception is a tick with nothing known yet
 * (getKnownHead() === 0), which fetches directly — see tick() below.
 * Whenever it does fetch, it PAGES forward to the head (drainSince) — the
 * server caps a page at 500 rows while still reporting the true head, so one
 * call is not one complete answer on a long log (BUG-B).
 * Adaptive interval + ±20% jitter + hidden-pause live HERE (transport
 * concern), so a websocket swap deletes them wholesale.
 *
 * onEvents(events, head, { caughtUp }) — the third argument marks the delivery
 * as a mid-walk page (false) or one that reaches the server's true head (true).
 * BUG-C: consumers must not infer that from call ordering.
 *
 * opts.getMode()      -> 'hot' | 'warm' | 'idle' | 'closed'   (room activity, supplied by chat.js)
 * opts.getKnownHead() -> highest seq already ingested
 * opts.onStatus(s, detail) -> 'online' | 'offline' | 'error'
 */
const INTERVALS = { hot: 5000, warm: 15000, idle: 45000, closed: 60000 };

// ── Paging (BUG-B) ───────────────────────────────────────────────────────────
// The server's chatSince(seq, limit) caps the page it RETURNS at 500 rows but
// still reports the TRUE head (Code.gs `chatSince`). One call is therefore NOT
// one complete answer once the log passes 500 events: the response says
// "here are 500 events, and by the way the head is 1237". Handing that head
// upstream as if the page had reached it made chat.js set S.head = 1237, which
// made every later tick's `head > known` false — the newest 737 events were
// never requested again for the life of the session, and backfill() could not
// recover them (it walks backward from the OLDEST seq seen, not from a gap).
//
// So: walk forward a page at a time until the events in hand actually reach
// the head. Each page is handed up as it arrives (the room fills progressively
// instead of blocking on the whole backlog), but the TRUE head is only
// reported on the page that genuinely reaches it — every other page reports
// the highest seq it really delivered, which keeps getKnownHead() an honest
// cursor and lets the next tick resume exactly where this one stopped.
// BUG-C (2026-09-11) — paging also changed what a delivery MEANS, and the
// third argument says so out loud. Downstream of the fold, js/notifications.js
// had to answer "is this batch history or news?" and was answering it by
// counting notifications ("the first one is the backfill"), which paging turned
// into "the first PAGE is the backfill" — it then relayed a push for all 737
// messages on pages 2 and 3 of a mid-season cold boot. The transport is the
// only layer that actually KNOWS, because `caughtUp` is computed right here, so
// it reports it rather than leaving consumers to infer it from timing:
//
//   onEvents(events, head, { caughtUp })
//
//     caughtUp === false -> a page of a walk still short of the server's head.
//                           More is coming; nothing in it is news.
//     caughtUp === true  -> the events in hand reach the true head. The room is
//                           complete as of this delivery.
//
// `caughtUp` is a fact about THIS delivery, not about the session — the
// "was the room already complete before this batch?" question that decides
// live-vs-history lives in chat.js, which is the layer that holds session
// state. See chat.js ingest() and notifications.js wireChatNotifications().
//
// 500 is a CHOICE, not a ceiling: Code.gs chatSince clamps to
// Math.min(limit || 500, 1000), so 1000 would be honored (the comment here used
// to claim otherwise — review finding 6, 2026-09-11). Kept conservative so each
// round trip stays small: one page is one Apps Script read, one JSON parse and
// one fold, and a smaller page puts the first messages on screen sooner and
// costs less if the request dies mid-flight. The walk below makes page size a
// latency knob rather than a correctness one.
const PAGE_LIMIT = 500;
const MAX_PAGES_PER_TICK = 20;   // hard bound — a broken server can never spin this loop

/**
 * Returns `{ cursor, caughtUp, head }`.
 *
 * BUG-F (2026-09-11) — the return grew from a bare cursor to this triple so
 * tick() can tell the two endings apart. Reaching the head and giving up short
 * of it used to be indistinguishable to the caller, and the caller is the half
 * that decides WHEN to look again. `head` is the server's true head as last
 * reported (NOT the per-delivery head handed to onEvents, which is deliberately
 * capped at what the page actually delivered — RG-94; nothing here changes what
 * the fold is told).
 */
async function drainSince(fromSeq, onEvents) {
  let cursor = fromSeq;
  let lastHead = 0;
  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    const { events, head } = await fetchSince(cursor, PAGE_LIMIT);
    lastHead = head;
    let maxSeq = cursor;
    for (const ev of events || []) {
      if (typeof ev?.seq === 'number' && ev.seq > maxSeq) maxSeq = ev.seq;
    }
    // RG-100 F2 (reviewer finding, 2026-09-11) — a cold-start chatSince(0) can
    // answer {events:[], head:0}: a real Apps Script artifact of a sheet
    // whose getLastRow() has not warmed up yet, reporting a room that LOOKS
    // empty even though it holds real messages (the boot-ladder's costume
    // (a), documented above on BOOT_RETRY_DELAYS). Before this fix,
    // `maxSeq >= head` read that as (0 >= 0) = TRUE — "caught up" — so
    // chat.js's ingest() (the ONLY place S.caughtUp is set) latched
    // S.caughtUp=true off a delivery that reached no real head at all. One
    // tick later, when the sheet actually warms up and the REAL backfill
    // arrives already-caughtUp too, chat.js computed wasCaughtUp=true off
    // that stale latch — notifications.js's wireChatNotifications() then
    // classifies the WHOLE backfill as LIVE (its rule is exactly
    // "wasCaughtUp && caughtUp = live"), relaying a push for every message in
    // it. Measured: 90 relay sends on an 18-message room (CHAT_RELAY_BURST_CAP
    // only saves rooms bigger than ~20 messages). Consistent with the SAME
    // head>0 requirement `seenRoom` already applies a few lines down in
    // subscribe() (search "seenRoom = true" — that check was already right;
    // this one was the gap): a delivery that reports a head of 0 has not
    // actually reached anything, honest or not, and must never count as
    // "the room is complete." Accepted trade, same as seenRoom's: the very
    // first message ever posted in a brand-new, genuinely empty league
    // classifies as history on the tick that reveals it — no push for that
    // one message — which is the correct, conservative side to fail to.
    const caughtUp = head > 0 && maxSeq >= head;
    // Empty page, or a page that failed to advance the cursor (a server we
    // cannot make progress against): deliver whatever came back, but never
    // advance the reported head past what we hold, and stop — no spin.
    if (!(events || []).length || maxSeq <= cursor) {
      onEvents(events || [], caughtUp ? head : cursor, { caughtUp });
      return { cursor, caughtUp, head };
    }
    cursor = maxSeq;
    onEvents(events, caughtUp ? head : maxSeq, { caughtUp });
    if (caughtUp) return { cursor, caughtUp, head };
  }
  // Bound hit; the next tick resumes from here — and, per the schedule below,
  // it does so in a second rather than at the room's idle cadence.
  return { cursor, caughtUp: false, head: lastHead };
}

/**
 * BUG-F (2026-09-11) — THE BOOT LADDER. Drew, installed iOS PWA, v0.20.1:
 * "sometimes the chat still stays blank for a minute before all of the previous
 * messages populate again… from a fresh open of the installed app." The log was
 * 234 events — ONE page — so neither paging (RG-94) nor the server explains a
 * minute. Measured in boottest.mjs: 68.9 SECONDS.
 *
 * The interval above is chosen by ROOM ACTIVITY, and on a fresh open the player
 * lands on the dashboard, so chat.js's roomMode() says 'closed' → 60s ±20%.
 * That is the right clock for "nothing has changed since we last looked." It is
 * the WRONG clock for "we have never once managed to look" — and before this
 * fix EVERY way the first tick could fail to produce the room fell through to
 * it. Five costumes, one cause (boottest.mjs §2-§6 measures each):
 *
 *   a) chatSince(0) answers {events: [], head: 0} — a cold-start read of a
 *      sheet whose getLastRow() has not warmed up. caughtUp is (0 >= 0) = TRUE,
 *      so tick() scored it a SUCCESS, reset the backoff, and booked the next
 *      look 60s out. The blank minute, exactly.                        68.9s
 *   b) an empty page with an honest head: the walk stops (correctly — a server
 *      that cannot advance the cursor must never spin the loop), but we KNOW
 *      we are behind and still waited a full interval.                 68.9s
 *   c) document.hidden at the first tick (iOS launches the webview behind the
 *      splash screen) and the visibilitychange that would wake us never
 *      arrives.                                                        68.0s
 *   d) isBackendConfigured() false at the first tick because config.json has
 *      not landed. NOTHING fires when it does.                         68.0s
 *   e) the tick throws. [2s, 5s, 15s, 60s] is sane in the steady state and
 *      costs 22s across three failures at boot — on top of each attempt's own
 *      3 round trips and 1.6s of misroute backoff.                     37.5s
 *
 * So: until a delivery has actually reached a real head, reschedule on a short
 * bounded ladder instead of the room interval, whatever the reason the last
 * attempt came up empty. Bounded is load-bearing — an unbounded fast poll is a
 * quota bug wearing a fix's clothes. After BOOT_RETRY_DELAYS is exhausted the
 * normal rules resume, so a genuinely dead backend settles back to 60s
 * (boottest.mjs §7 pins both halves).
 *
 * This does NOT change what is fetched, when a fetch is ALLOWED (the
 * document.hidden early-return still blocks the request itself, which is the
 * mechanism RG-96's CHAT_RELAY_BURST_CAP leans on), or what onEvents is told.
 * It changes only the delay to the next attempt.
 */
const BOOT_RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];
// A drain that stopped short of the head is a KNOWN-behind state at any point
// in the session, not just at boot — including the MAX_PAGES_PER_TICK bound.
// Resume promptly rather than at the room's idle cadence.
//
// BOUNDED for the same reason the boot ladder is. Unbounded, this accelerates
// the MAX_PAGES_PER_TICK walk to 20 pages per SECOND against a server that
// keeps reporting a head we cannot reach — 20× the traffic the old 45s cadence
// allowed, which is a quota regression hiding inside a latency fix. Five
// consecutive fast rounds carry 5 × 20 × 500 = 50,000 events, orders of
// magnitude past any real backlog (the live log is 234); past that it is a
// misbehaving server, not a backlog, and the room interval is the right answer.
const CATCHUP_DELAY = 1000;
const MAX_FAST_CATCHUPS = 5;

/**
 * BUG-12 (2026-09-12) — Drew, verbatim: "When I receive a push notification it
 * doesn't show up in the chat for at least 30 seconds after the notification.
 * When I click the push, I should be able to see the message in the chat."
 *
 * The interval above is chosen by ROOM ACTIVITY, and a player who is not
 * sitting in the room is 'idle' (45s) or 'closed' (60s). That is the right
 * clock for "nothing has told us anything changed" — and a push is exactly
 * something telling us that. Nothing in the push-tap, foreground-push or
 * app-resume paths asked this transport to look, so the message the banner had
 * already announced sat unrequested until the next scheduled poll.
 *
 * wake() below is that ask — the SAME tick()/drainSince() path the interval,
 * the visibilitychange fast path and DI-168's manual refresh all use, never a
 * second fetch path (AD-16: this module stays the only one that talks to the
 * chat backend, and it now owns one more reason to poll rather than exporting
 * the machinery to do it elsewhere).
 *
 * BOUNDED, for the reason every other accelerated path here is bounded: iOS
 * fires visibility pairs while the app switcher is scrubbed, and an unbounded
 * wake is one flap away from a quota bug. One forced fetch per gap.
 *
 * NOT DROPPED, though — and that half is load-bearing. A wake is the only
 * signal we have that a message exists; discarding one because another arrived
 * four seconds ago re-creates this exact bug one flap later. A wake inside the
 * window is DEFERRED to the end of it and still resolves to its caller, which
 * is what lets the notification deep link await the fetch instead of scrolling
 * to an element that does not exist yet.
 *
 * 5s = INTERVALS.hot: the fastest cadence this app already considers
 * acceptable for a room someone is actively watching. A push tap is at least
 * that interesting, and never more expensive.
 */
const WAKE_MIN_GAP_MS = 5000;

export function subscribe(onEvents, opts = {}) {
  let timer = null, stopped = false, fails = 0, backoff = 0;
  let seenRoom = false;      // a caught-up delivery reporting a real head has landed
  let bootAttempts = 0;      // reschedules taken before that happened
  let behind = false;        // the last drain ended short of the server's head
  let catchups = 0;          // consecutive accelerated catch-up rounds
  // DI-168f (2026-09-11) — true while a tick's network round trip is actually
  // running. Lets a concurrent trigger (the visibilitychange fast path, or the
  // new forceTick() below) COALESCE into a no-op instead of doubling the poll.
  // Closes a pre-existing latent gap at the same time: before this, a
  // visibilitychange firing mid-tick could already double-call tick() — fixing
  // it here fixes it for both triggers, since both now go through the same
  // guard on the same function.
  let inFlight = false;
  // BUG-12 (2026-09-12) — the wake bound. `wakeTimer` non-null IS the open
  // window; `wakePending` records a wake that landed inside it (deferred, never
  // dropped); `wakeWaiters` are the callers awaiting that deferred fetch. See
  // WAKE_MIN_GAP_MS above for why bounded and why not dropped.
  let wakeTimer = null;
  let wakePending = false;
  let wakeWaiters = [];
  // RG-98 F1 (reviewer finding, 2026-09-11) — true only for a tick that
  // actually reached the network (past the isBackendConfigured()/hidden
  // early-return, below). delay() must not spend a BOOT_RETRY_DELAYS rung on
  // a tick that COULDN'T attempt anything — see the comment on delay() for
  // what that cost before this fix.
  let attempted = false;
  // ── PHASE III STEP 5 (DI-T5.3) — the Realtime channel ──────────────────────
  // `rt` is null in Sheets mode and on every flag-off device, so nothing below
  // it ever runs there. `phase` is the whole safety model: JOINED is not LIVE.
  let rt = null;                 // { channel, phase: 'joined'|'live', leagueId, token }
  let rtDrainArmed = false;      // the post-join drain has been scheduled for THIS join
  let gapPending = false;        // a Realtime gap arrived while a drain was in flight

  /** Which "can this tick reach the network" question applies, per backend. */
  function readyToFetch(m) {
    return m === 'supabase' ? sbReady() : isBackendConfigured();
  }

  /**
   * DI-T5.3 — ONE channel, `chat:<leagueId>`, ONE listener, INSERT only.
   *
   * INSERT only because the log is append-only (AD-09): `messages` carries `grant select, insert`
   * and nothing else (0002:181), so there is no UPDATE or DELETE path in the entire schema and
   * subscribing to `*` would widen the surface for nothing.
   *
   * A SEPARATE channel from the adapter's `league:<id>` because of AD-16: the adapter must not
   * carry chat events and this module must not read the adapter's channel. Two channels ride one
   * websocket either way.
   */
  function ensureChannel(m) {
    if (m !== 'supabase') { dropChannel(); return; }
    const leagueId = sbLeague();
    if (!leagueId) { dropChannel(); return; }
    if (rt && rt.leagueId === leagueId) return;
    // R2 — THE LEAGUE SWITCH RELEASE. The channel is dropped before a new one is opened, and the
    // new one is scoped to the NEW league_id. This runs on every tick, so it heals the ordering
    // itself rather than depending on app.js dropping the subscription first.
    //
    // A7 — AND THE PARKED SET GOES WITH IT, but only on a genuine MOVE (`rt` already held a
    // different league), never on the first subscribe. A parked post belongs to one room under one
    // identity; relaying it into another is the same failure chat.js's outbox league stamp exists
    // to prevent (SECURITY F-4), one layer out.
    if (rt && rt.leagueId !== leagueId) _dropParked('the active league moved');
    dropChannel();
    const client = sbClient();
    if (!client || typeof client.channel !== 'function') return;
    const token = _chatToken();
    let channel = client.channel(`chat:${leagueId}`);
    channel = channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `league_id=eq.${leagueId}` },
      (payload) => onRealtimeRow(payload, token),
    );
    rt = { channel, phase: 'joined', leagueId, token };
    rtDrainArmed = false;
    try {
      channel.subscribe((status) => onChannelStatus(status, leagueId));
    } catch (e) {
      console.warn('[chatTransport] the chat Realtime channel could not subscribe — the poll ladder still has the room', e && e.name);
    }
  }

  function teardownChannelIfMoved(m) {
    if (m !== 'supabase') dropChannel();
  }

  function dropChannel() {
    if (!rt) return;
    const channel = rt.channel;
    rt = null;
    rtDrainArmed = false;
    try {
      const client = sbClient();
      if (client && typeof client.removeChannel === 'function') client.removeChannel(channel);
      else if (channel && typeof channel.unsubscribe === 'function') channel.unsubscribe();
    } catch (e) { console.warn('[chatTransport] removeChannel failed', e && e.name); }
  }

  /**
   * THE SUBSCRIBED-BEFORE-REGISTERED GAP (RG-136 / rls.test B7's bracket). `SUBSCRIBED` fires
   * when the channel JOINS, which is earlier than when the server registers `postgres_changes`
   * underneath it — events committed in that window reach nobody. The adapter's answer was "the
   * re-hydrate is the probe"; chat's is the same shape and cheaper, because chat already has a
   * cursor: a drain from the known head cannot miss anything, because it asks the table.
   *
   * So on SUBSCRIBED the channel is JOINED, NOT LIVE. It becomes LIVE on the first event received
   * OR when the post-join drain lands caught-up, whichever is first — and while it is merely
   * JOINED the existing poll ladder keeps running at its existing cadence. Nothing is switched
   * off on the strength of a channel that has not proven itself.
   */
  function onChannelStatus(status, leagueId) {
    if (stopped || !rt || rt.leagueId !== leagueId) return;
    if (status === 'SUBSCRIBED') {
      if (rtDrainArmed) return;
      rtDrainArmed = true;
      Promise.resolve()
        .then(() => gapDrain())
        .then(() => { if (rt && rt.leagueId === leagueId && rt.phase === 'joined' && seenRoom) rt.phase = 'live'; })
        .catch((e) => console.warn('[chatTransport] the post-join chat drain failed', e && e.message));
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // Back to JOINED (at best), the full ladder resumes, and the post-join drain is re-armed
      // for the next join. A channel that cannot join is NOT an outage on its own — the poll
      // still works — so nothing is reported to the player here. Only a failing FETCH is offline.
      if (rt) { rt.phase = 'joined'; }
      rtDrainArmed = false;
      console.warn(`[chatTransport] the chat Realtime channel reported ${status} — the poll ladder has the room`);
    }
  }

  /**
   * ══ THE ORDERING RULE — the one that bites if it is not written down ══════════════════════
   *
   * `chat.js`'s ingest() advances the cursor from the event itself (`if (ev.seq > S.head) S.head
   * = ev.seq`, chat.js:530). A Realtime INSERT arriving with seq 500 while this device holds 497
   * would therefore set the cursor to 500, and 498 and 499 would never be requested again for the
   * life of the session — RG-94 exactly, re-created through a new door. Realtime delivery is not
   * guaranteed contiguous: a commit the subscriber missed, a reconnect, two writers.
   *
   *   n <= known      DROP. Already held. The fold would dedupe it anyway (AD-10), but the cursor
   *                   must not be re-litigated.
   *   n === known + 1 DELIVER immediately — this is the 2-seconds-instead-of-60 win.
   *   n >  known + 1  A GAP. Deliver NOTHING. Drain from the cursor, in order, as pages; the
   *                   buffered row folds in by id with no duplicate.
   */
  function onRealtimeRow(payload, token) {
    if (stopped) return;
    if (!rt || rt.leagueId !== token.leagueId) return;
    if (_chatOpMoved(token)) {
      console.warn('[chatTransport] a Realtime chat event arrived for a league/identity this device has already left — DISCARDED');
      return;
    }
    const row = payload && payload.new;
    if (!row) return;
    if (row.league_id && String(row.league_id) !== token.leagueId) {
      console.warn('[chatTransport] a Realtime chat event carried another league’s league_id — DISCARDED');
      return;
    }
    // A delivery is the proof the channel is registered server-side, so this is where JOINED
    // becomes LIVE.
    if (rt.phase === 'joined') rt.phase = 'live';
    let ev;
    try { ev = sbMapRow(row); } catch (e) { console.warn('[chatTransport] could not map a Realtime chat row', e && e.message); return; }
    const n = Number(ev && ev.seq);
    if (!Number.isFinite(n)) return;
    const known = opts.getKnownHead?.() || 0;
    if (n <= known) return;
    if (n === known + 1) { onEvents([ev], n, { caughtUp: true }); return; }
    gapDrain();
  }

  /** The gap filler, and the post-join probe. Coalesced on the SAME `inFlight` guard the poll
   *  uses, so a burst of out-of-order rows costs one walk, not one per row. */
  async function gapDrain() {
    if (stopped) return;
    if (inFlight) { gapPending = true; return; }
    if (!readyToFetch(chatTransportMode())) return;
    inFlight = true;
    try {
      const r = await drainSince(opts.getKnownHead?.() || 0, onEvents);
      behind = !r.caughtUp;
      if (r.caughtUp && r.head > 0) seenRoom = true;
    } catch (err) {
      behind = false;
      console.warn('[chatTransport] a Realtime gap drain failed; the poll ladder will retry', err && err.message);
    } finally {
      inFlight = false;
    }
    if (gapPending && !stopped) { gapPending = false; await gapDrain(); }
  }

  const jitter = ms => Math.round(ms * (0.8 + Math.random() * 0.4));
  const delay = () => {
    // DI-T5.3 / Drew's D-3 — THE RECONCILE TICK. Once the channel is LIVE the room arrives over
    // Realtime, so the adaptive ladder's job is over and its cadence would just be cost. What
    // survives is a single 60s ±20% tick, and what that tick does is already head-only: tick()'s
    // `known > 0` branch calls fetchHead() and drains ONLY if the head is ahead. One cheap RPC
    // per device per minute.
    //
    // WHY NOT "no poll at all while LIVE", which is what the brief originally said: a channel
    // that reports healthy and silently stops is exactly the failure `phase:'live'` cannot
    // detect, and it is invisible until somebody asks why the room went quiet. This is Drew's own
    // D-7 shape for picks — Realtime primary, a poll as the net, never Realtime alone. A drop
    // back to JOINED restores the full ladder on the next delay(), because `rt.phase` moves first.
    if (rt && rt.phase === 'live') { catchups = 0; return jitter(INTERVALS.closed); }
    if (!behind) catchups = 0;
    else if (catchups < MAX_FAST_CATCHUPS) { catchups++; return jitter(CATCHUP_DELAY); }
    if (!seenRoom && bootAttempts < BOOT_RETRY_DELAYS.length) {
      // RG-98 F1 — a tick that returned early (config not loaded yet, or the
      // iOS webview still hidden behind the splash screen) consumed a rung
      // here unconditionally before this fix, EVEN THOUGH IT NEVER ISSUED A
      // REQUEST. A tab hidden for the ladder's whole ~30s cumulative span (1+
      // 2+4+8+15s) could exhaust all five rungs without a single attempt ever
      // having been made — so the FIRST real attempt, whenever visibility
      // finally returned, landed with the ladder already spent, falling
      // through to the room-interval branch below for what should have been
      // rung one. Measured: a tab hidden ≥31s with no visibilitychange event
      // pushed room-complete to 90.9s vs. the ~68s baseline. Fix: only
      // ADVANCE bootAttempts on a tick that actually attempted a request; a
      // tick that couldn't retries at the SAME (still-unconsumed) rung,
      // holding the ladder's fast cadence open until a real attempt is
      // finally possible.
      const rung = BOOT_RETRY_DELAYS[bootAttempts];
      if (attempted) bootAttempts++;
      return jitter(rung);
    }
    return backoff || jitter(INTERVALS[opts.getMode?.() || 'idle'] || 45000);
  };

  /**
   * Returns `true` on a successful round trip, `false` on a thrown one — new
   * with DI-168, and additive: every existing caller (the scheduled timer,
   * onVis) ignores the return value exactly as before. `forceTick()` (below)
   * is the one caller that reads it, so a manual refresh can resolve/reject
   * off the REAL outcome of the tick it triggered rather than a second,
   * separately-tracked status.
   */
  async function tick() {
    if (stopped) return false;
    // §7.3 — the interlock joins the two conditions that already mean "this
    // tick cannot reach the network", rather than tearing the subscription
    // down. Part B sets the predicate during boot, which can land AFTER
    // chat.js has already subscribed (DI §1.5's boot order), so a
    // subscribe-time decision would be made too early on exactly the devices
    // that need it. `attempted = false` is the existing RG-98 F1 contract: a
    // tick that issued no request must not spend a boot-ladder rung. No fetch,
    // no onEvents, so the subscription DELIVERS NOTHING while interlocked, and
    // resumes with no re-subscribe if the mode ever flips back.
    //
    // STEP 5 — the gate now asks the MODE first, because "can this tick reach the network" has a
    // different answer per backend and the Sheets answer (`isBackendConfigured()`) is about a
    // config a Supabase-scoped device may still be carrying. Flag-off is unchanged: mode() is
    // 'sheets', the second term is the identical isBackendConfigured() call, and the only
    // difference from v0.17.0 is one extra predicate evaluation that answers false.
    const m = chatTransportMode();
    if (m === 'interlocked' || !readyToFetch(m) || (typeof document !== 'undefined' && document.hidden)) {
      attempted = false;   // RG-98 F1 — this tick could not reach the network; delay() must not spend a boot rung on it
      teardownChannelIfMoved(m);
      schedule();
      return false;
    }
    ensureChannel(m);
    attempted = true;      // RG-98 F1 — past this point a real request WILL be issued
    inFlight = true;
    let ok = true;
    try {
      const known = opts.getKnownHead?.() || 0;
      // Nothing known yet (cold boot, or a reload with no device-local cache
      // to prime S.head — DI-169 gives chat.js one now, which is exactly why
      // a cache-primed boot's FIRST tick lands in the ELSE branch below
      // instead of here): the head probe cannot tell us anything we would
      // act on. Any head > 0 means "fetch everything from 0", and head === 0
      // means the room is empty, which fetchSince(0) reports just as well. So
      // the probe buys nothing and costs a full Apps Script cold start
      // (10-20s, ledger §5) in front of the first message the player sees —
      // the "it starts off blank" half of Drew's report. Skip straight to
      // the fetch.
      //
      // Every tick WITH something known keeps the two-phase head-then-since
      // behaviour, which is what keeps the steady-state poll cheap — and, as
      // of DI-169, is also what turns a cache-primed cold boot into a single
      // cheap chatHead probe followed by an INCREMENTAL chatSince(cachedHead)
      // instead of RG-91's full chatSince(0, 500) — chat.js's initChat() sets
      // S.head from the device-local cache before this subscription's first
      // tick ever runs, so getKnownHead() is already non-zero here on attempt
      // #1. No change needed in this function for that to be true — it falls
      // out of the existing known>0 branch below.
      if (known === 0) {
        const r = await drainSince(0, onEvents);
        behind = !r.caughtUp;
        if (r.caughtUp && r.head > 0) seenRoom = true;
      } else {
        const { head } = await fetchHead();
        if (head > known) {
          const r = await drainSince(known, onEvents);
          behind = !r.caughtUp;
          if (r.caughtUp && r.head > 0) seenRoom = true;
        } else {
          // Nothing new, and the cheap probe agrees with our cursor: this
          // device has the room. (head === 0 here means a genuinely empty
          // room — see the boot-ladder note on why that alone is not enough
          // to call the room SEEN.)
          behind = false;
          // RG-101 / BUG-H (reviewer BLOCK on the v0.20.3 candidate,
          // 2026-09-11) — REPORT the empty-but-complete delivery. Until
          // DI-169 this branch was only ever reached mid-session, after some
          // earlier delivery had already told chat.js the room was complete,
          // so calling onEvents() with nothing to deliver looked like pure
          // cost. DI-169 changed who gets here FIRST: a cache-primed boot
          // hands getKnownHead() a non-zero cursor on tick #1, so the
          // ordinary "nothing happened while the app was closed" boot lands
          // here having delivered NOTHING all session. S.caughtUp lives in
          // chat.js and is set ONLY by ingest(), which only runs when
          // onEvents() is called — so it never latched, and the next
          // genuinely new message arrived with wasCaughtUp === false.
          // notifications.js's rule (live == wasCaughtUp && caughtUp)
          // correctly classified that message as HISTORY: zero pushes for
          // the first real message of the session, on every device, plus the
          // sender's own post (sendEvent() passes {caughtUp: S.caughtUp}).
          // An empty delivery IS a delivery: it is this transport saying
          // "the server's head is X and you already hold it," which is
          // exactly the fact the caughtUp flag records. `head > 0` is the
          // SAME requirement seenRoom applies on the line below — a head of
          // 0 has not reached anything real (RG-100) — and it is one
          // condition with one meaning, not two. Costs nothing downstream:
          // chat.js's ingest() fires no notification for an empty event
          // array, so no toast, no badge, no scan; only the latch moves.
          if (head > 0) { seenRoom = true; onEvents([], head, { caughtUp: true }); }
        }
      }
      if (fails >= 3) opts.onStatus?.('online');
      fails = 0; backoff = 0;
    } catch (err) {
      ok = false;
      fails++;
      // A thrown tick tells us nothing about how far behind we are; drop the
      // catch-up claim so the error ladder (or the boot ladder, while the room
      // is still unseen) governs rather than a 1s retry loop against a server
      // that is failing.
      behind = false;
      backoff = Math.min(60000, [0, 2000, 5000, 15000][fails] || 60000);
      if (fails === 3 || err?.stale) opts.onStatus?.('offline', { error: String(err?.message || err), stale: !!err?.stale });
    } finally {
      inFlight = false;
    }
    schedule();
    return ok;
  }

  function schedule() { if (!stopped) timer = setTimeout(tick, delay()); }

  /**
   * BUG-12 — the event-driven forced fetch. Returns a promise that settles when
   * the fetch this wake is answerable for has actually completed (immediately
   * for the wake that runs now; at the end of the window for one that was
   * deferred into it), so a caller that must not act until the room is current
   * — the notification deep link — can await it.
   */
  function wake() {
    if (stopped) { settleWakeWaiters(false); return Promise.resolve(false); }
    // Inside the window, or a round trip is already running: fold into the one
    // fetch at the end of the window rather than adding a second.
    if (wakeTimer !== null || inFlight) {
      wakePending = true;
      openWakeWindow();
      return new Promise(res => wakeWaiters.push(res));
    }
    openWakeWindow();
    clearTimeout(timer);
    const p = tick();
    p.then(ok => settleWakeWaiters(ok), () => settleWakeWaiters(false));
    return p;
  }
  function openWakeWindow() {
    if (wakeTimer !== null) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      if (wakePending) { wakePending = false; wake(); }
    }, WAKE_MIN_GAP_MS);
    wakeTimer?.unref?.();   // never hold a Node test harness open (push-onesignal.js precedent)
  }
  function settleWakeWaiters(v) {
    const waiting = wakeWaiters;
    wakeWaiters = [];
    for (const res of waiting) { try { res(v); } catch { /* a waiter's own failure is not this transport's problem */ } }
  }

  // BUG-12 — the resume half. visibilitychange was already here (and already
  // forced a tick); it now goes through wake() so it inherits the bound, and
  // `focus` joins it because an iOS standalone resume does not reliably fire
  // visibilitychange at all (boottest.mjs §5's stated unknown). Both arriving
  // costs one fetch, not two — that is what the bound is for.
  const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) wake(); };
  const onFocus = () => { if (typeof document === 'undefined' || !document.hidden) wake(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus);
  tick();

  /**
   * DI-168f — a player-triggered fast path, same mechanism the
   * visibilitychange fast path already uses (clear the pending timer, tick
   * now). Coalesces with any trigger already in flight rather than doubling
   * the network round trip: if `inFlight`, this is a no-op and resolves to
   * `null` — under real UI use this is unreachable (chat-ui.js's own button
   * disables itself while checking, DI-168f item 3's belt-and-suspenders UI
   * guard), so it only matters to a caller that bypasses that guard, e.g. a
   * test firing two forceRefresh() calls back to back.
   */
  async function forceTick() {
    if (stopped) return false;
    if (inFlight) return null;
    clearTimeout(timer);
    return tick();
  }

  // BUG-F (2026-09-11) reconciliation — the DI's literal interface is
  // `{ unsubscribe, forceTick }`, written when chat.js's _subscribeNow() was
  // believed to be subscribe()'s only caller. boottest.mjs (BUG-F, same
  // session) calls subscribe() directly and invokes the return value AS A
  // FUNCTION (`const unsub = transport.subscribe(...); …; unsub();`) — a file
  // this build does not touch and whose §7 steady-state timing assertions
  // must not be disturbed. Reconciled by making the return value BOTH: a bare
  // callable (unsubscribe — every existing caller, including boottest.mjs)
  // AND an object carrying `.unsubscribe` (a self-reference) and
  // `.forceTick`, so chat.js's _subscribeNow() can destructure
  // `{ unsubscribe, forceTick }` exactly as the DI specifies. One function,
  // two calling conventions, never two implementations.
  const unsubscribe = () => {
    stopped = true;
    // DI-T5.7 / DI-T5.8 — R2. Every teardown path reaches here: app.js's identity chokepoint,
    // chat.js's setPollMode('paused') behind a hold gate, refreshChatEnabled()'s OFF branch and
    // _resetForTest(). The Realtime channel is part of the subscription, so it goes with it —
    // which is what makes "the unread badge cannot count behind a hold" true of Realtime too,
    // and it needed no change in js/chat.js to be true.
    //
    // A7 — the parked posts go with it. A hold gate exists so that NO league data moves while it
    // is up, and a background ladder quietly re-sending a reveal from behind the lock would be
    // exactly the shape DI §6.5 was written to stop (the unread badge reappearing in front of the
    // lock, one queue over).
    _dropParked('the chat subscription was torn down');
    dropChannel();
    clearTimeout(timer);
    clearTimeout(wakeTimer); wakeTimer = null; wakePending = false;
    settleWakeWaiters(false);   // BUG-12 — a deferred wake on a torn-down subscription answers, rather than leaving its caller hanging
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus);
  };
  unsubscribe.unsubscribe = unsubscribe;
  unsubscribe.forceTick = forceTick;
  unsubscribe.wake = wake;      // BUG-12 — chat.js hands this to the push-tap / foreground-push paths via wakeChat()
  /** TEST SEAM (Step 5) — 'off' | 'joined' | 'live'. Production never reads it. It exists
   *  because "JOINED is not LIVE" is a STATE, and a suite that could only observe deliveries
   *  could not tell a channel that proved itself from one that merely joined. */
  unsubscribe._rtPhaseForTest = () => (rt ? rt.phase : 'off');
  return unsubscribe;
}
