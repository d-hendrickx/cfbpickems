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
import { SCRIBE_FEEDBACK_REASON_CHIPS } from './data-model.js';

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
 * Per-category string ceiling (DI-269). Everything that isn't listed keeps the
 * 1000-char clamp `recordFeedback()` has had since the pilot; `reason_note` is
 * capped at 280 because it is a quick "why," not a rewrite, and the input that
 * produces it carries `maxlength="280"` to match.
 *
 * NULL-PROTOTYPE ON PURPOSE. `category` is a caller-supplied string that gets
 * used as a lookup key one line later: on a plain object literal,
 * `MAX_LEN['constructor']` answers with a FUNCTION — truthy, so `?? 1000` never
 * fires — and `value.slice(0, Function)` clamps to the empty string, silently
 * discarding the player's text. chat.js's fold already refuses `constructor` as
 * a category at ingest (its UNSAFE_OBJECT_KEYS guard), so nothing could persist;
 * this closes the same hole one layer earlier, where the data is still intact.
 */
const FEEDBACK_MAX_LEN = Object.freeze(Object.assign(Object.create(null), { reason_note: 280 }));
const FEEDBACK_MAX_LEN_DEFAULT = 1000;

/**
 * `category`: 'rating' | 'rewrite' | 'remember_this' | 'weigh_in' |
 *             'reason_note' (DI-269).
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
  const maxLen = FEEDBACK_MAX_LEN[category] ?? FEEDBACK_MAX_LEN_DEFAULT;
  const clamped = typeof value === 'string' ? value.slice(0, maxLen) : value;
  return sendEvent({ type: 'feedback', targetId, author, notify: false, meta: { category, value: clamped } });
}

// ── DI-268 — reason chips (UN-245) ──────────────────────────────────────────
/**
 * The CURRENT FULL SET of a player's reason chips for one SCRIBE line, written
 * as one event.
 *
 * A SET, NOT A DIFF, DELIBERATELY. chat.js's fold is latest-wins per
 * `(author, category)` and is order-independent by design (AD-09/AD-10) — a
 * stream of "+annoying" / "-annoying" deltas would need arrival order to
 * reconstruct, which is the one thing this log does not promise. Writing the
 * whole set means any single event, applied alone, IS the answer.
 *
 * THE ALLOW-LIST IS THE WRITE BOUNDARY (CONVENTIONS #7), the same discipline
 * `recordFeedback()`'s length clamp is: a chip that is not in
 * `SCRIBE_FEEDBACK_REASON_CHIPS` never leaves THIS function, so no reader
 * downstream has to carry a defence against a string THIS CLIENT invented.
 *
 * THAT IS THE WHOLE OF THE GUARANTEE, AND IT IS NARROWER THAN IT LOOKS
 * (security finding F-2, 2026-09-23 — this comment previously claimed an
 * unknown chip "never enters the append-only log", which is not something a
 * client-side filter can promise). The log itself is only as constrained as
 * `messages_insert`, which does not inspect `meta` — it is opaque jsonb, and
 * any authenticated league member with a console can append a 'feedback' event
 * carrying whatever value they like. EVERY READER MUST THEREFORE FILTER
 * AGAINST `SCRIBE_FEEDBACK_REASON_CHIPS` AT ITS OWN BOUNDARY: the popover
 * (chat-ui.js's `reasonChipsOf()`), any export, and Package C's Trainer. This
 * function is the write-side half of that discipline, not a substitute for it.
 *
 * Duplicates collapse; an empty array is a legal value and means "I cleared
 * them all."
 *
 * Gated by the same master switch as every other write here: the switch means
 * "no new instrumentation is captured," not "no new instrumentation is offered."
 */
export function recordFeedbackReasons({ targetId, chips, author }) {
  if (!targetId || !author) return null;
  if (!isScribeFeedbackEnabled()) return { ok: false, reason: 'disabled' };
  const clean = Array.from(new Set(
    (Array.isArray(chips) ? chips : []).filter(c => SCRIBE_FEEDBACK_REASON_CHIPS.includes(c)),
  ));
  return sendEvent({ type: 'feedback', targetId, author, notify: false, meta: { category: 'reason', value: clean } });
}

// ── DI-271 — talk-to-train (UN-248) ─────────────────────────────────────────
/**
 * The closed verdict set a classifier may return. `unclear` is a real verdict,
 * not an error code: "they said something about SCRIBE and we could not tell
 * whether it was praise" is information, and it is the honest landing place for
 * anything malformed.
 */
export const TALK_TO_TRAIN_VERDICTS = Object.freeze(['hit', 'mid', 'too_much', 'unclear']);
const TALK_TO_TRAIN_QUOTE_MAX = 300;

/**
 * Coerce a classifier's answer into the one shape this category may hold.
 *
 * EXPORTED, AND EXPORTED ON PURPOSE. `recordFeedback()`'s existing clamp only
 * touches `typeof value === 'string'`, and this category's value is an OBJECT —
 * so without an explicit validator an unbounded classifier response would go
 * into the append-only log verbatim. Package C/D wires the classifier call;
 * this is the seam it has to come through, and it is exported so C can sanitize
 * at its own boundary too if it wants to inspect before writing.
 *
 * `quote` is the PLAYER'S OWN WORDS and stays untrusted data forever: capped
 * here, and — per DI-269/§7's binding contract on Package C — wrapped as
 * quoted, attributed text if it is ever read into a prompt, never concatenated
 * as an instruction. Nothing in Package B sends it to a model.
 *
 * AND THE SAME READ-BOUNDARY RULE APPLIES (F-2, 2026-09-23). Sanitizing here
 * constrains what THIS CLIENT writes; it constrains nothing about what is in
 * the log. `chat_append`/`messages_insert` stores `meta` as opaque jsonb and
 * never inspects it, so a reader that assumes `value.verdict` is one of
 * TALK_TO_TRAIN_VERDICTS, or that `value.quote` is a capped string, is
 * assuming something the database does not enforce. Every reader — the
 * popover, an export, Package C's Trainer, and anything that builds a prompt —
 * runs the row through `sanitizeTalkToTrain()` (or its own equivalent) at its
 * own boundary. It is exported for exactly that.
 */
export function sanitizeTalkToTrain(v) {
  const raw = v && typeof v === 'object' ? v : {};
  const confidence = Number(raw.confidence);
  return {
    verdict: TALK_TO_TRAIN_VERDICTS.includes(raw.verdict) ? raw.verdict : 'unclear',
    quote: typeof raw.quote === 'string' ? raw.quote.slice(0, TALK_TO_TRAIN_QUOTE_MAX) : '',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}

/**
 * Log an ordinary chat remark about a SCRIBE post as feedback (UN-248).
 *
 * NO CALLER YET, AND THAT IS THE DESIGN INPUT'S OWN STATEMENT. DI-271 scopes
 * Package B to the event shape and the write path; the trigger (a reply to a
 * SCRIBE message, or an `@scribe` mention carrying evaluative language) and the
 * Haiku classification that fills `value` are Package C/D's wiring, against
 * `supabase/functions/scribe-classify`. Exported and unreferenced is therefore
 * the correct end state for this pass — not an oversight, and not dead code
 * that should be deleted before C arrives.
 *
 * Rides the SAME `'feedback'` event type as every other category: one stream,
 * no new storage key, folded per `(targetId, author, 'talk_to_train')`, so a
 * second remark by the same player about the same post replaces the first
 * exactly like a changed rating does.
 */
export function recordTalkToTrain({ targetId, author, value }) {
  if (!targetId || !author) return null;
  if (!isScribeFeedbackEnabled()) return { ok: false, reason: 'disabled' };
  return sendEvent({
    type: 'feedback', targetId, author, notify: false,
    meta: { category: 'talk_to_train', value: sanitizeTalkToTrain(value) },
  });
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
