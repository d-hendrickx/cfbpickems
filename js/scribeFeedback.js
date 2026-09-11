/**
 * scribeFeedback.js — SCRIBE pilot feedback capture (UN-159/UN-160, v0.18.x)
 * ============================================================================
 * Thin query/write surface over chat.js's 'feedback' fold — sits beside
 * chat.js the way scribeLines.js already does for SCRIBE's own posting logic
 * (DESIGN_INPUTS_BATCH1_091026.md, Document 2, "Export/read surface for the
 * Trainer").
 *
 * STORAGE: NO new KV key. Every feedback record is a chat event
 * (`type:'feedback'`), sent through chat.js's `sendEvent()` → the SAME
 * append-only, incrementally-read Messages sheet every reaction/edit/pin
 * event already rides (chatTransport.js, AD-16). See DEVELOPMENT_LEDGER.md's
 * E2 rationale — this was evaluated against the alternative (a new
 * `KEYS.SCRIBE_FEEDBACK` seam key) and rejected explicitly, because
 * `cfbp_picks`/`cfbp_games` are already on a named, dated trajectory toward
 * the Google Sheets per-cell cap (RG-55/RG-56), and every read/write of that
 * seam does a full-sheet scan regardless of which key changed. Adding a
 * continuously-growing, season-long key to THAT seam would compound a
 * documented, still-open risk. `feedbacktest.mjs` pins this with a
 * structural scan so a future change can't silently drift back.
 *
 * TWO DIFFERENT READ SHAPES, DELIBERATELY:
 *  - `getFeedbackFor()` reads the DEVICE'S already-hydrated chat.js fold —
 *    correct for E1's UI, which only ever needs "my own state" + "the room's
 *    current state on this one message."
 *  - `getAllFeedbackSince()` / `getFeedbackInRange()` are NOT fold-based —
 *    Part 0b correction #6 (binding, DESIGN_INPUTS_BATCH1_091026.md): the
 *    fold only holds the device's backfilled window, but the Trainer (E3,
 *    later) needs the FULL season. Both page through chatTransport.js's
 *    fetchSince() directly, from seq 0, never through chat.js's client fold.
 *    (This deliberately corrects Document 2's own first draft, which
 *    described these as "a pure function over getMessages()'s already-
 *    hydrated fold" — that description was superseded by correction #6
 *    before this was built; do not revert to it.)
 */

import { sendEvent, getMessage } from './chat.js';
import { fetchSince } from './chatTransport.js';
import { getSettings } from './storage.js';

// ── E1 master switch (D5 — commissioner master switch, Drew's decision) ──────
// `settings.scribeFeedbackEnabled` is in DEFAULT_SETTINGS (data-model.js,
// ~line 412). Default TRUE for the pilot ("temporary pilot instrumentation...
// an on/off", Drew's briefing) — a missing value (every settings blob written
// before this field existed) must not silently turn the six players'
// instrumentation off. Same `!== false` pattern as `isChatEnabled()` (chat.js).
export function isScribeFeedbackEnabled() {
  return getSettings().scribeFeedbackEnabled !== false;
}

// ── Write ──────────────────────────────────────────────────────────────────
/**
 * `category`: 'rating' | 'rewrite' | 'remember_this' | 'weigh_in'.
 * `value`: 'hit'|'mid'|'too_much' (rating) · free text ≤1000 chars (rewrite)
 *          · boolean, OR free text when supplied via the "Weigh in" modal's
 *          optional field, correction #7 (remember_this/weigh_in) · `null` to
 *          explicitly clear a rating back to untouched (E1's "re-tapping the
 *          CURRENTLY selected rating clears it" requirement — an explicit
 *          clear event, not silence, so the clear itself is part of the
 *          reconstructible record).
 * Thin wrapper over `sendEvent()` — see chat.js's `applyTo()` 'feedback'
 * branch for the fold/replace-on-resubmit semantics.
 */
export function recordFeedback({ targetId, category, value, author }) {
  if (!targetId || !category || !author) return null;
  // Reviewer note (2026-09-10, approved) — the MASTER SWITCH gates the WRITE,
  // not just the UI. chat-ui.js already omits every ⭐/🚩 affordance when the
  // switch is off, but that is a RENDER-time check: a player who already had
  // the feedback popover open when the commissioner flipped the switch off
  // still had a live click handler bound to a button in the DOM, and tapping
  // it would have written a real event into the append-only chat log. The
  // switch has to mean "no new instrumentation is captured," not "no new
  // instrumentation is offered." Enforced here, at the one write seam every
  // entry point funnels through, so no current or future caller can bypass
  // it. Returns a shaped result rather than throwing — a disabled pilot is a
  // normal state, not an error.
  if (!isScribeFeedbackEnabled()) return { ok: false, reason: 'disabled' };
  // Non-blocking finding #9 — the UI's own textarea already caps at 1000
  // chars (maxlength="1000", E1's explicit reuse of the composer's own
  // limit), but recordFeedback() is a real API surface, not just a UI event
  // handler — clamp at the BOUNDARY too (CONVENTIONS #7: defensive coercion
  // at a data boundary) so a future/programmatic caller can't write an
  // unbounded string into the append-only chat log.
  const clamped = typeof value === 'string' ? value.slice(0, 1000) : value;
  return sendEvent({ type: 'feedback', targetId, author, notify: false, meta: { category, value: clamped } });
}

/**
 * Every player's CURRENT feedback state for one response/message, read from
 * this device's already-hydrated fold. Returns `{ [playerId]: { rating,
 * rewrite, remember_this, weigh_in } }` — a POINTER read (chat.js's folded
 * `message.feedback`), never a copy of the target's body.
 */
export function getFeedbackFor(targetId) {
  return getMessage(targetId)?.feedback || {};
}

// ── Trainer batch read (E3, later — specified now, per E2) ───────────────────
// Code.gs's chatSince() hard-caps `limit` at 1000 regardless of what's
// requested (backend/Code.gs) — page rather than assume one call covers a
// season.
const SINCE_PAGE_LIMIT = 1000;

/**
 * Every 'feedback' event at seq > `seq`, across the WHOLE season — pages
 * chatTransport.js's fetchSince() forward from `seq` (default 0) until the
 * server's head is reached. Returns the raw events (each already carries
 * `targetId`/`author`/`meta.{category,value}`/`ts`/`seq`/`id`) — a pointer
 * list, never a copy of any target message's body (feedbacktest.mjs proves
 * this structurally).
 */
export async function getAllFeedbackSince(seq = 0) {
  const out = [];
  let cursor = Math.max(0, Number(seq) || 0);
  for (;;) {
    const { events, head } = await fetchSince(cursor, SINCE_PAGE_LIMIT);
    const batch = events || [];
    batch.forEach(ev => { if (ev?.type === 'feedback') out.push(ev); });
    if (!batch.length) break;
    const maxSeq = batch.reduce((m, ev) => Math.max(m, ev.seq || 0), cursor);
    if (maxSeq <= cursor) break;              // no forward progress — stop, never loop forever
    cursor = maxSeq;
    if (cursor >= head || batch.length < SINCE_PAGE_LIMIT) break;   // caught up
  }
  return out;
}

/** Same full-range read, filtered to a wall-clock window. Built on
 *  getAllFeedbackSince(0) rather than a second network path — chatSince() is
 *  seq-indexed, not time-indexed, so there is no cheaper server-side range
 *  query to call instead. */
export async function getFeedbackInRange(startMs, endMs) {
  const all = await getAllFeedbackSince(0);
  return all.filter(ev => (ev.ts || 0) >= startMs && (ev.ts || 0) <= endMs);
}
