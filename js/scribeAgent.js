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
import { scribeAskRemote as scribeAskRemoteBackend, runTrainerRemote as runTrainerRemoteBackend, scribeAutonomousRemote as scribeAutonomousRemoteBackend, scribeClassifyRemote as scribeClassifyRemoteBackend } from './backend.js';

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
 *  triggering paid model calls has to actually know the password. */
export async function runTrainerRemote({ adminPasswordHash = '' } = {}) {
  return runTrainerRemoteBackend({ adminPasswordHash });
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
export async function scribeAskRemote({ triggerMessageId, playerId, weekId = '', gameTag = '' }) {
  return scribeAskRemoteBackend({ triggerMessageId, playerId, weekId, gameTag, webSearch: isScribeWebSearchEnabled() });
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

// ── The two new backend relays ──────────────────────────────────────────────
//
// STOP-AND-REPORT, PER THE TASK'S OWN INSTRUCTION. These two actions need a
// transport, and this module has none of its own: it relays through NAMED
// wrappers exported by js/backend.js (`scribeAskRemote`, `runTrainerRemote`
// above), because `call()` — the one function that knows the URL, the token,
// the misroute guard (RG-92) and the NO_RETRY_ACTIONS money-safety list — is
// module-private there by design. js/backend.js is NOT in this pass's
// editable file set, and re-implementing `call()` here would be a parallel
// transport: a second place that knows the backend URL, a second place that
// could miss a misroute, and a second path that could retry a paid action.
// That is precisely the class of shortcut AD-02/AD-16 exist to prevent.
//
// So the transport is INJECTED instead of invented. Until it is wired, both
// relays resolve to `{ ok:true, skipped:'transport_unwired' }` — a clean
// no-op that costs nothing and posts nothing, which is the correct behaviour
// for an autonomous path that is allowed to stay silent (C1's contract).
//
// WIRED (coordinator, 2026-09-11) — js/backend.js now exports both relays
// and carries both on its NO_RETRY_ACTIONS list, so neither is ever retried:
// each one spends real money and gets exactly one attempt. Pass 1 shipped
// this as an injection seam because js/backend.js was outside its file set
// and re-implementing `call()` here would have been a parallel transport —
// a second place knowing the backend URL, a second place able to miss a
// misroute (RG-92). That reasoning is why the seam still exists below; it is
// now a TEST seam rather than a placeholder.
let remoteTransport = { autonomous: scribeAutonomousRemoteBackend, classify: scribeClassifyRemoteBackend };

/** TEST SEAM — swaps the two relays out (scoringtest.mjs drives the entire
 *  D1 gate through stubs, with no network). Production never calls this: the
 *  default above IS the real js/backend.js relay pair. Calling it with `{}`
 *  deliberately unwires both, which is how a test proves the "transport
 *  unavailable -> reserve nothing, never touch tier-0" path. */
export function wireScribeRemoteTransport({ autonomous = null, classify = null } = {}) {
  remoteTransport = { autonomous, classify };
}
/** Restores the production relays after a test has replaced them. */
export function _restoreScribeRemoteTransportForTest() {
  remoteTransport = { autonomous: scribeAutonomousRemoteBackend, classify: scribeClassifyRemoteBackend };
}

/** True only when autonomy could ACTUALLY post right now from this device:
 *  the client gate is on AND the transport is wired. js/scribeLines.js checks
 *  this BEFORE it reserves a SCRIBE cooldown on an autonomous candidate — see
 *  the long note at `considerAutonomous` for why reserving a cooldown for a
 *  post that can never happen would silence the free tier-0 lines. */
export function isScribeAutonomousReady() {
  return isScribeAutonomousEnabled() && !!(remoteTransport && remoteTransport.autonomous);
}

/** Relay to backend/Code.gs's `scribeAutonomous` action (D1). Never throws —
 *  an autonomous opportunity that cannot reach the server is DROPPED, never
 *  surfaced and never retried (C1: mentions fall back to a canned line,
 *  autonomous posts fall back to silence). */
export async function scribeAutonomousRemote({ trigger, subject = '', evidence = {}, playerId = '' } = {}) {
  if (!isScribeAutonomousEnabled()) return { ok: true, skipped: 'disabled_client' };
  if (!remoteTransport || !remoteTransport.autonomous) return { ok: true, skipped: 'transport_unwired' };
  try {
    return await remoteTransport.autonomous({ trigger, subject, evidence, playerId });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}

/** Relay to backend/Code.gs's `scribeClassify` action (D-2, correction #6).
 *  Returns `{ points }` — 0 for anything that is not a confident claim, and
 *  0 for every failure path, so a classifier outage can only ever make
 *  SCRIBE quieter. */
export async function scribeClassifyRemote({ messageId } = {}) {
  if (!isScribeAutonomousEnabled()) return { ok: true, skipped: 'disabled_client', points: 0 };
  if (!remoteTransport || !remoteTransport.classify) return { ok: true, skipped: 'transport_unwired', points: 0 };
  try {
    const r = await remoteTransport.classify({ messageId });
    return { ...r, points: Number(r && r.points) || 0 };
  } catch {
    return { ok: false, error: 'unreachable', points: 0 };
  }
}
