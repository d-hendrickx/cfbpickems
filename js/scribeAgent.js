/**
 * scribeAgent.js — Build 2, Group C (2026-09-10, UN-150…154, DI Doc 1)
 * =======================================================================
 * Client-side caller for the interactive (LLM-backed) @SCRIBE runtime.
 * Deliberately thin: it assembles nothing and decides nothing about SCRIBE's
 * content — it only (a) gates the network round trip behind the
 * commissioner's client-visible convenience setting, and (b) relays to the
 * one new backend action, `scribeAsk` (backend/Code.gs). All context
 * assembly, tool execution, and the actual Anthropic call happen
 * server-side (C1/C5) — this module never sees a model response, a tool
 * result, or an API key. Per CLAUDE.md's prohibited-moves list, the
 * Anthropic key lives ONLY in Code.gs Script Properties; nothing here could
 * expose it even by accident, because it is never sent to the client.
 *
 * Cold-start UX — C-5, Drew's 2026-09-10 ruling, OVERRIDES the design input's
 * own recommendation. The DI recommended a client-LOCAL-only pending bubble
 * (visible only to the asker); Drew ruled "Everyone should see" it. That is
 * built as a SERVER-side broadcast: the moment `scribeAsk` wins the dedup
 * lock, Code.gs appends a `type:'system'`, non-notify chat event
 * (`meta.kind:'scribeAsk'`) directly to the shared log — every device sees
 * it on the next ordinary poll, through the SAME rendering path as any other
 * system event. It is superseded (filtered out of the render list) once the
 * real reply lands, in chat-ui.js (`filterSupersededScribeAcks`). Nothing in
 * THIS module renders a bubble — that would duplicate the server's ack.
 *
 * Two settings gate this from the client side, `getSettings()` through the
 * seam (AD-02) — see data-model.js DEFAULT_SETTINGS for the default-when-
 * missing story:
 *   scribeInteractiveEnabled — commissioner convenience off-switch (saves a
 *     wasted round trip; the AUTHORITATIVE gate is server-side).
 *   scribeWebSearchEnabled   — informational only from the client's side;
 *     the actual web-search tool declaration is entirely server-side
 *     (`SCRIBE_WEB_SEARCH_ENABLED` Script Property). Exposed here so the
 *     Comm→Settings toggle has something to read/write through the seam.
 */
import { getSettings, getScribeLearnings, getScribeCanon } from './storage.js';
import { SCRIBE_FREQUENCY_LEVELS, SCRIBE_FREQUENCY_DEFAULT } from './data-model.js';
// ── NOTHING IS IMPORTED FROM js/backend.js ANY MORE (2026-09-23) ────────────
// The four Apps Script relays this module wrapped — `scribeAskRemote`,
// `runTrainerRemote`, `scribeAutonomousRemote`, `scribeClassifyRemote` — are
// deleted with the transport. Each had a Supabase twin already, gated on its
// own `settings.serverJobs.*` switch; what goes is the OTHER arm of each
// branch, not the branch's outcome.
import { chatTransportMode, askScribe } from './chatTransport.js';
// ── PHASE III STEP 6 (Phases 3/4/5) — the class-U Edge Function seam ────────
// `getSupabaseClient`/`getActiveLeagueId` from js/auth.js (no cycle: auth.js imports backend.js,
// supabase-backend.js and push-onesignal.js, never this module) — the SAME client/session
// js/supabase-backend.js's adapter uses (auth.js's own §1.1 rule: "one session, one token, one
// onAuthStateChange" — a second createClient() would race this one's own refresh loop).
import { getSupabaseClient, getActiveLeagueId } from './auth.js';
// `isServerJobEnabled` from js/notifications.js (same non-cycle, and the SAME reader DI-T6.1's
// own client gate already uses for `notifyFanout` — one function, one shared boolean-in-settings
// reader, not a second copy of it here). Reviewer note 5 (2026-09-20): a second implementation of
// "is this server job on" is exactly the parallel abstraction AD-02 forbids for storage, applied
// to a flag whose two sides disagreeing means a double paid model call. `isServerJobEnabled()`
// never throws and reads OFF on an unreadable blob, which is the safe direction for this gate too
// (an unreadable blob keeps the legacy path working).
import { isServerJobEnabled } from './notifications.js';

export function isScribeInteractiveEnabled() {
  return getSettings().scribeInteractiveEnabled !== false;
}
export function isScribeWebSearchEnabled() {
  return getSettings().scribeWebSearchEnabled !== false;
}

// ── Build 2b, E4 (2026-09-10, UN-162) ───────────────────────────────────────
// `settings.scribeLearningsEnabled` — kill switch on Trainer-approved
// learnings/Canon reaching SCRIBE's live generation context. Default TRUE
// (missing value reads as ON, CONVENTIONS #10 — see data-model.js's
// DEFAULT_SETTINGS comment). The AUTHORITATIVE filter runs server-side
// (backend/Code.gs's scribeActiveLearningsText_/scribeCanonExamplesText_,
// called from scribeAsk before every mention reply) — generation itself
// happens entirely server-side, so nothing here can influence what SCRIBE
// actually says. This client-side mirror exists ONLY for display: the E5b
// Comm→Data card's "active right now" count, so a commissioner can see what
// is CURRENTLY live without needing Apps Script access. Kept in sync BY
// HAND with the server-side filter (same obligation as every other
// client/server contract in this codebase — RG-55/RG-56's lesson applied to
// a read path, not a write path, so the failure mode here is a stale COUNT,
// never a stale runtime behavior).
export const SCRIBE_RUNTIME_CONFIDENCE_THRESHOLD = 0.75;

export function isScribeLearningsEnabled() {
  return getSettings().scribeLearningsEnabled !== false;
}

/**
 * Read-only mirror of the server's E4 filter — `status/approvalStatus ===
 * 'approved' && confidence >= 0.75`, or both empty when the kill switch is
 * off. Returns `{ activeLearnings, canonExamples }` (full row objects, not
 * rendered text — the caller decides how to display them).
 */
export function getActiveContext() {
  if (!isScribeLearningsEnabled()) return { activeLearnings: [], canonExamples: [] };
  const activeLearnings = getScribeLearnings().filter(l =>
    l.kind === 'learning' && l.status === 'approved' && Number(l.confidence) >= SCRIBE_RUNTIME_CONFIDENCE_THRESHOLD);
  const canonExamples = getScribeCanon().filter(c =>
    c.approvalStatus === 'approved' && Number(c.confidence) >= SCRIBE_RUNTIME_CONFIDENCE_THRESHOLD);
  return { activeLearnings, canonExamples };
}

/** Relay to backend/Code.gs's `runTrainer` action (E3). Thin — all analysis,
 *  the model call, and persistence happen server-side; the client only
 *  triggers the run and re-hydrates to see the result (the server writes
 *  through the SAME setOne()/getOne() seam every other key uses, bypassing
 *  the debounced client push entirely — a plain hydrate() picks it up).
 *
 *  `adminPasswordHash` is the commissioner credential the server requires
 *  (reviewer SIGNIFICANT #8) — `btoa(password)`, produced at the call site
 *  from a prompt, never read out of the synced settings blob, so the person
 *  triggering paid model calls has to actually know the password.
 *
 *  ── RETIRED 2026-09-23. THE FUNCTION SURVIVES; ITS TRANSPORT DOES NOT. ──
 *  Reviewer note 5 (2026-09-20) put the refusal INSIDE this relay rather than
 *  only at js/app.js's button, because the switch-on's real risk was a DOUBLE
 *  SPEND: while `settings.serverJobs.trainer` was true, an Apps Script
 *  `runTrainer` was a second, independent paid Anthropic call — against a
 *  frozen Sheet, so not even analysing real data, and drawing on no budget this
 *  project could see. That refusal is now UNCONDITIONAL, because there is
 *  nothing behind it: the Apps Script /exec URL is gone from config.json and
 *  `call()` is gone from js/backend.js.
 *
 *  THE EXPORT SURVIVES rather than being deleted because it is the honest
 *  answer to a real question. js/app.js's button branches
 *  `isServerJobEnabled('trainer') ? runTrainerViaEdgeFunction() : runTrainerRemote()`,
 *  and the false arm still happens — on a device whose settings blob has not
 *  hydrated, or a league where Drew has flipped the job off. It must say
 *  something, and `{ok:true, skipped:'disabled'}` (DI-T6.0(f)'s envelope) is
 *  what app.js's existing `result.skipped` branch already renders as an
 *  advisory toast. Deleting the export would make that arm a TypeError.
 *
 *  THE STALE-CLIENT NOTE IS NOW CLOSED, not merely bounded. It used to read:
 *  "a phone on an OLDER cached shell has no knowledge of the switch and still
 *  calls Apps Script directly — code cannot close a stale-client hole; a
 *  deleted trigger can." Drew deletes the triggers and archives the deployment
 *  in the retirement ceremony (SUPABASE_LIVE_RUNBOOK §RETIREMENT), which is
 *  what actually shuts that door for every client, cached or not. */
export async function runTrainerRemote(/* { adminPasswordHash } */) {
  return { ok: true, skipped: 'disabled',
    error: 'The Apps Script Trainer was retired on 2026-09-23. Run it from Comm \u2192 Data, which calls the trainer Edge Function.' };
}

/**
 * Phase III Step 6 PHASE 4 (`trainer`, DI-T6.4). The MANUAL entry point, class U — invoked ONLY
 * when `isServerJobEnabled('trainer')` is true (js/app.js's own gate; this function does not
 * re-check the switch, the same division of labour DI-T6.1's `notifications.js` gate uses).
 *
 * NO CREDENTIAL IS SENT. Unlike `runTrainerRemote()` above, the Edge Function derives the caller
 * from the SIGNED-IN SUPABASE SESSION's own JWT (`_shared/auth.js`'s `requireCommissioner()`) —
 * there is no `adminPasswordHash` for it to check, and sending one would be a second, unused
 * credential on the wire. `supabase-js`'s `functions.invoke()` attaches the current session's
 * access token automatically; this module never touches a token directly.
 *
 * Returns the SAME envelope shape `runTrainerRemote()` does (`{ok, skipped?, error?, runId, …}` —
 * DI-T6.0(f)), so `js/app.js`'s click handler branches on it identically regardless of which path
 * answered — DI-T6.0(f)'s whole point.
 */
export async function runTrainerViaEdgeFunction() {
  const client = getSupabaseClient();
  const leagueId = getActiveLeagueId();
  if (!client || !leagueId) {
    return { ok: false, error: 'Not signed in to a league — cannot reach the Trainer function' };
  }
  const { data, error } = await client.functions.invoke('trainer', { body: { league_id: leagueId } });
  if (error) throw error;
  return data;
}

/**
 * Relay to backend/Code.gs's `scribeAsk` action. Body shape is EXACTLY the
 * DI's contract: `{ triggerMessageId, playerId, weekId, gameTag }` — the
 * server re-reads the triggering message's own body from `CFBP_MESSAGES` by
 * id rather than trusting a client-supplied string (closes a prompt-spoof
 * vector, C1).
 *
 * Return shape (never throws for a normal degrade outcome):
 *   { ok:true, responseMessageId, deduped:false }  — server posted the real
 *     reply directly to chat; nothing more for the caller to do, the normal
 *     chat poll will surface it.
 *   { ok:true, deduped:true, responseMessageId }   — already answered.
 *   { ok:true, disabled:true }                     — server kill switch is
 *     off. Not a failure — matches "a disabled trigger produces no response
 *     at all," never a fallback line.
 *   { ok:true, throttled:true, reason }            — mention throttle,
 *     league throttle, monthly budget cap, Anthropic outage-after-retry, or
 *     the iteration/wall-clock cap. The caller posts the SAME canned
 *     degraded-mode fallback for every one of these (C1's "one fallback
 *     mechanism, not two").
 * Throws only when the backend is unreachable/unconfigured, or the server
 * returned a genuine `{ok:false}` error — the caller treats that identically
 * to `throttled` (outage is one of the states the throttle path already
 * covers).
 */
// F5 remediation (2026-09-10, round 1) — `scribeWebSearchEnabled` used to be
// read (isScribeWebSearchEnabled(), above) but never actually SENT anywhere,
// so the Comm→Settings toggle was cosmetic. Wired here as `req.webSearch`:
// the server (Code.gs's `effectiveWebSearch`) treats it ONLY as a further
// RESTRICTION — `SCRIBE_WEB_SEARCH_ENABLED` (the Script Property) stays the
// master switch and this can never turn search back on when that property
// is off.
// ── PHASE III STEP 5, DI-T5.6 / Drew's D-4 — THE ONE BRANCH ──────────────────
//
// The Apps Script relay re-reads the trigger message out of the PRODUCTION
// league's Sheet. On a Supabase-scoped league that is a cross-league bleed —
// the same class as the chat transport interlock, one action over — and D-4's
// relay allow-list (`ping` + `notifyPush`) already refuses `scribeAsk` there.
// So the route is chosen by the mode, and the mode is asked of the ONE module
// that owns the answer (chatTransport.js's `chatTransportMode()`), never
// re-derived here: a second opinion about which backend a league is on is how
// two of them end up disagreeing on the device where it matters.
//
// In Supabase mode `askScribe()` makes no network call and answers
// `{ ok:true, unavailable:true }`. `fireScribeMention()`'s only success test is
// `r.ok && r.responseMessageId` (js/scribeLines.js:539), so the player gets the
// canned SCRIBE line under the same deterministic id — never silence, never a
// spinner. Step 6 replaces askScribe()'s body with the Edge Function call and
// touches nothing here.
//
// The import is of chatTransport.js, which chat.js already loads on every
// device, so this adds no bytes to a flag-off boot.
export async function scribeAskRemote({ triggerMessageId, playerId, weekId = '', gameTag = '' }) {
  const webSearch = isScribeWebSearchEnabled();
  // ONE ROUTE (2026-09-23). This used to read
  // `if (chatTransportMode() !== 'sheets') return askScribe(...)` and fall
  // through to the Apps Script relay otherwise. `chatTransportMode()` never
  // answers 'sheets' any more and there is no relay to fall through to, so the
  // branch and its second arm are both gone. `askScribe()` itself already
  // handles every non-Supabase state by returning the canned-line degrade —
  // that contract is stated in its own header and is unchanged.
  return askScribe({ triggerMessageId, playerId, weekId, gameTag, webSearch });
}

// ── Build 3, Group D (2026-09-11, DI-D1/DI-D2) ──────────────────────────────
//
// Two more settings gates, same shape and same reasoning as the pair above:
// the client-visible one saves a round trip, the server-side Script Property
// is authoritative.

/** The frequency dial's level name, VALIDATED against the canonical table
 *  (N-3, reviewer round 2). Default-when-missing AND default-when-garbage:
 *  'balanced'. It used to return whatever string was in the settings blob,
 *  which only happened to be safe because every consumer re-defaulted
 *  downstream — a future caller reading it directly would have gotten
 *  'BALANCED' or 'quiet ' or a half-written value straight through
 *  (CONVENTIONS #7: coerce at the boundary). A malformed value must make
 *  SCRIBE quieter-or-equal, never open the gate. */
export function getScribeFrequency() {
  const level = String(getSettings().scribeFrequency || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCRIBE_FREQUENCY_LEVELS, level) ? level : SCRIBE_FREQUENCY_DEFAULT;
}

/** Client-side convenience gate on autonomous participation. `!== false` so a
 *  settings blob written before this field existed reads as ON — the
 *  AUTHORITATIVE gate is SCRIBE_AUTONOMOUS_ENABLED server-side, which
 *  defaults OFF, so "on" here still means "nothing happens" until Drew sets
 *  the Script Property. */
export function isScribeAutonomousEnabled() {
  return getSettings().scribeAutonomousEnabled !== false;
}

// ── THE AUTONOMOUS / CLASSIFY TRANSPORT SEAM ────────────────────────────────
//
// HISTORY, KEPT SHORT BUT KEPT. These two actions spend real money at
// Anthropic, so they were never allowed to be retried. Pass 1 (2026-09-11)
// built this as an INJECTION seam rather than re-implementing a transport here,
// because `call()` — the one function that knew the URL, the token, the
// misroute guard (RG-92) and the NO_RETRY_ACTIONS money-safety list — was
// module-private in js/backend.js, and a second copy of it here would have been
// exactly the parallel abstraction AD-02/AD-16 forbid. The coordinator then
// wired the real Apps Script pair into it, and Step 6 Phase 5 added the Edge
// Function branch below.
//
// AS OF 2026-09-23 THE SEAM HAS NO PRODUCTION DEFAULT, and that is the whole of
// the change here. The Apps Script pair is deleted; `scribe-autonomous` and
// `scribe-classify` are the only transports, reached through
// `invokeScribeEdgeFunction()` when the job switch is on. With both slots null,
// the pre-existing `transport_unwired` branch answers every other case —
// `{ ok:true, skipped:'transport_unwired' }`, a clean no-op that costs nothing
// and posts nothing, which is the correct behaviour for an autonomous path that
// is allowed to stay silent (C1's contract). Nothing about the gate order, the
// money-safety reasoning or `isScribeAutonomousReady()` changes.
// RETIRED 2026-09-23 — the DEFAULTS are now NULL, not the Apps Script relay
// pair. `wireScribeRemoteTransport()` survives as a pure TEST seam (scoringtest
// drives the whole D1 gate through stubs), and `isScribeAutonomousReady()`
// below reads it exactly as before: with both unwired, autonomy is ready only
// when the server switch is on, which is the true state of every device.
let remoteTransport = { autonomous: null, classify: null };

/** TEST SEAM — swaps the two relays in (scoringtest.mjs drives the entire
 *  D1 gate through stubs, with no network). Production never calls this, and
 *  since 2026-09-23 the default is BOTH UNWIRED rather than the Apps Script
 *  relay pair. Calling it with `{}` restores that default, which is how a test
 *  proves the "transport unavailable -> reserve nothing, never touch tier-0"
 *  path — the path every device is now on whenever the server switch is off. */
export function wireScribeRemoteTransport({ autonomous = null, classify = null } = {}) {
  remoteTransport = { autonomous, classify };
}
/** Restores the production state after a test has replaced it. Since 2026-09-23
 *  that state is "both unwired" — the Apps Script pair this restored is gone. */
export function _restoreScribeRemoteTransportForTest() {
  remoteTransport = { autonomous: null, classify: null };
}

// ── PHASE III STEP 6, PHASE 5 — THE EDGE FUNCTION SEAM, DEFINED HERE, GATED ON THE SAME BOOLEAN
//    `js/notifications.js`'s `isServerJobEnabled()` ALREADY READS. ──────────────────────────────
//
// Mirrors `scribeAskRemote`'s own mode branch (this file, above): the choice of transport is made
// ONCE, at the top of each relay, and the two paths never both run — the double-post failure mode
// this switch exists to avoid is the exact analogue of DI-T6.1's double-push for notify-fanout.
//
// WHEN THE SWITCH IS ABSENT OR FALSE, THIS CODE IS BYTE-IDENTICAL TO WHAT SHIPPED BEFORE PHASE 5:
// the `isServerJobEnabled(...)` branch below is a NEW early return that falls through to every
// existing line, unedited, when it does not fire. A mutation canary (`scoringtest.mjs`, the D1
// gate's own home) proves the OLD path still runs exactly once when the switch is off/absent, and
// that it does NOT ALSO run when the switch is on — the shape `notifytest.mjs [28]` already proves
// for `js/notifications.js`.
async function invokeScribeEdgeFunction(name, body) {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: 'no_client' };
  try {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) return { ok: false, error: String((error && error.message) || error) };
    return data || { ok: false, error: 'empty_response' };
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}

/** True only when autonomy could ACTUALLY post right now from this device:
 *  the client gate is on AND (the server switch is on, or the legacy transport is wired).
 *  js/scribeLines.js checks this BEFORE it reserves a SCRIBE cooldown on an autonomous candidate —
 *  see the long note at `considerAutonomous` for why reserving a cooldown for a post that can never
 *  happen would silence the free tier-0 lines. */
export function isScribeAutonomousReady() {
  if (!isScribeAutonomousEnabled()) return false;
  if (isServerJobEnabled('scribeAutonomous')) return true;
  return !!(remoteTransport && remoteTransport.autonomous);
}

/** Relay to `scribe-autonomous` (DI-T6.5) when the server switch is on, else to backend/Code.gs's
 *  `scribeAutonomous` action (D1), UNCHANGED. Never throws — an autonomous opportunity that cannot
 *  reach the server is DROPPED, never surfaced and never retried (C1: mentions fall back to a
 *  canned line, autonomous posts fall back to silence). */
export async function scribeAutonomousRemote({ trigger, subject = '', evidence = {}, playerId = '' } = {}) {
  if (!isScribeAutonomousEnabled()) return { ok: true, skipped: 'disabled_client' };
  if (isServerJobEnabled('scribeAutonomous')) {
    const leagueId = getActiveLeagueId();
    if (!leagueId) return { ok: true, skipped: 'transport_unwired' };
    return invokeScribeEdgeFunction('scribe-autonomous', { leagueId, trigger, subject, evidence, playerId });
  }
  if (!remoteTransport || !remoteTransport.autonomous) return { ok: true, skipped: 'transport_unwired' };
  try {
    return await remoteTransport.autonomous({ trigger, subject, evidence, playerId });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}

/** Relay to `scribe-classify` (DI-T6.5) when the server switch is on, else to backend/Code.gs's
 *  `scribeClassify` action (D-2, correction #6), UNCHANGED. Returns `{ points }` — 0 for anything
 *  that is not a confident claim, and 0 for every failure path, so a classifier outage can only
 *  ever make SCRIBE quieter. */
export async function scribeClassifyRemote({ messageId } = {}) {
  if (!isScribeAutonomousEnabled()) return { ok: true, skipped: 'disabled_client', points: 0 };
  if (isServerJobEnabled('scribeClassify')) {
    const leagueId = getActiveLeagueId();
    if (!leagueId) return { ok: true, skipped: 'transport_unwired', points: 0 };
    const r = await invokeScribeEdgeFunction('scribe-classify', { leagueId, messageId });
    return { ...r, points: Number(r && r.points) || 0 };
  }
  if (!remoteTransport || !remoteTransport.classify) return { ok: true, skipped: 'transport_unwired', points: 0 };
  try {
    const r = await remoteTransport.classify({ messageId });
    return { ...r, points: Number(r && r.points) || 0 };
  } catch {
    return { ok: false, error: 'unreachable', points: 0 };
  }
}
