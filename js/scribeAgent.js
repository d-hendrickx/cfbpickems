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
import { scribeAskRemote as scribeAskRemoteBackend, runTrainerRemote as runTrainerRemoteBackend } from './backend.js';

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
