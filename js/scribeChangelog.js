/**
 * scribeChangelog.js — the in-room announcement of an auto-applied learning.
 * ===========================================================================
 * SCRIBE v3, Package C (2026-09-23, UN-252 / DI-279).
 *
 * Drew's ruling 3, verbatim: "Fast-learn: tone/style learnings auto-apply, are
 * ANNOUNCED IN CHAT, and can be undone by the commissioner." This file is the
 * announcement half — one pure function that turns a stored learning row into
 * the `messages` row both server writers insert, and one that turns it into the
 * sentence.
 *
 * ── WHY IT IS A SHARED `js/` MODULE AND NOT A COPY IN EACH HANDLER. ─────────
 * `supabase/functions/trainer/index.js` and `supabase/functions/scribe-learn/
 * index.js` are Deno; both already import `../../../js/scribe-trainer-rules.js`
 * for exactly this reason (DI-T6.14(b): "a Node twin where logic is shared").
 * The client imports it too, so the Training card can render the same sentence
 * the room saw. Three callers, one sentence — a second copy is how the chat
 * post and the card come to credit different people.
 *
 * ── IT SPEAKS AS `system`, NOT AS SCRIBE. ──────────────────────────────────
 * `author:'system'`, `author_kind:'system'`, `notify:false` — the same shape
 * the Trainer's own E5a summary post uses (Code.gs:6081-6089). This is a
 * changelog entry, not banter: SCRIBE announcing its own behaviour change in
 * character would be SCRIBE commenting on SCRIBE, and CONVENTIONS #38's "no
 * streaming commentary" instinct applies. It also must not buzz five phones at
 * 3am, which is what `notify:false` is for.
 *
 * ── THE COPY IS PLAIN AND FUNCTIONAL, ON PURPOSE, FOR NOW. ─────────────────
 * The `scribe` agent owns SCRIBE's voice and may polish these lines later; what
 * this file fixes is the DATA the line is allowed to draw on
 * (`{playerDisplayName, category, instructionSummary, origin}`) and the shape of
 * the row. Until that pass, the lines below say what happened in the fewest
 * words that are still true.
 *
 * ── EVERY STRING HERE DESCENDS FROM A PLAYER'S OWN WORDS. ──────────────────
 * `instruction` is Opus output derived from a player's typed feedback, and the
 * display name is a player-editable field. Both are flattened and clamped here,
 * at the boundary, before they enter a `messages.body` that every device
 * renders. The client render path escapes on top of that (CONVENTIONS #12); the
 * server has no escaping layer at all, which is why the flattening has to
 * happen in the one function both of them call.
 */

/** `messages.body` carries `check (length(body) <= 1000)` and the service role
 *  does NOT bypass a check constraint. The changelog line is built to ~140 and
 *  bounded well under that; the summary is the part that can grow. */
export const CHANGELOG_SUMMARY_MAX = 80;
export const CHANGELOG_BODY_MAX = 300;

/** DI-291 — the private affordance, a second sentence, appended (not woven
 *  into the reviewed/shipped sentence above). `flatten()` collapses real
 *  newlines to a space (see its own comment), so this is the LAST clause of
 *  one line, not a second visual line — the one-line-only invariant that
 *  keeps a system notice from being forged holds either way. */
export const CHANGELOG_PRIVATE_LINE = '🔒 Only you can see this.';

/** Human labels for the learning categories the instant path may produce.
 *  A category outside the list renders as itself — a new category from a future
 *  Trainer must not produce an empty phrase. */
export const CHANGELOG_CATEGORY_LABELS = Object.freeze({
  roast_intensity: 'how hard it roasts',
  brevity: 'how long its posts are',
  humor: 'its sense of humor',
  frequency: 'how often it speaks',
  profanity: 'its language',
  callbacks: 'its callbacks',
  factual: 'its facts',
  target_selection: 'who it aims at',
  animation: 'its delivery',
});

/** One player-authored-descended string, flattened and clamped. Newlines
 *  collapse: a changelog line is one line, and a body that can forge a second
 *  one is a body that can imitate a system notice in the room. */
function flatten(value, max) {
  const s = String(value === null || value === undefined ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The data a copy template may draw on — DI-279's own list, and nothing else.
 * Exported separately from the sentence so a future `scribe` voice pass can
 * rewrite the words without re-deriving (or widening) the inputs.
 */
export function changelogFields({ playerDisplayName, category, instruction, origin }) {
  return {
    playerDisplayName: flatten(playerDisplayName, 40) || 'a player',
    category: String(category || ''),
    categoryLabel: Object.prototype.hasOwnProperty.call(CHANGELOG_CATEGORY_LABELS, String(category || ''))
      ? CHANGELOG_CATEGORY_LABELS[String(category || '')] : flatten(category, 40),
    instructionSummary: flatten(instruction, CHANGELOG_SUMMARY_MAX),
    origin: origin === 'instant' ? 'instant' : 'trainer',
  };
}

/**
 * The sentence. Plain and functional (see the header): it names WHO caused the
 * change, WHAT changed, and that it can be undone — which are the three things
 * UN-252's acceptance criteria require to be visible in the room.
 *
 * THE INSTRUCTION IS QUOTED, never pasted as prose. It is generated text
 * descended from a player's own words; presenting it unquoted would read as the
 * app speaking rather than as the app reporting.
 */
export function changelogBody(fields, isPrivate = false) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const who = f.playerDisplayName || 'a player';
  const what = f.categoryLabel ? ` about ${f.categoryLabel}` : '';
  const how = f.origin === 'instant' ? 'right away' : 'in last night\'s training pass';
  const summary = f.instructionSummary ? ` "${f.instructionSummary}"` : '';
  const sentence = `📓 SCRIBE update — feedback from ${who} changed something${what} ${how}:${summary} `
    + '(Commissioner can undo this in Comm → Data → SCRIBE Training.)';
  if (!isPrivate) return flatten(sentence, CHANGELOG_BODY_MAX);
  // DI-291 — reserve the tell's own budget EXPLICITLY, before flattening the
  // sentence, so a long sentence can never truncate the tell away and the
  // tell can never push the combined body over CHANGELOG_BODY_MAX. `+1` is
  // the separating space between the clipped sentence and the tell.
  const reserved = CHANGELOG_PRIVATE_LINE.length + 1;
  const sentenceBudget = Math.max(0, CHANGELOG_BODY_MAX - reserved);
  const clippedSentence = flatten(sentence, sentenceBudget);
  return flatten(`${clippedSentence} ${CHANGELOG_PRIVATE_LINE}`, CHANGELOG_BODY_MAX);
}

/** A stable, per-learning id, so a retried insert is the SAME row rather than a
 *  second announcement. Idempotency by construction, the same discipline
 *  `addBotPostIfNew({eventKey})` gives the client pools (CONVENTIONS #37). */
export function changelogMessageId(learningId) {
  return `sys_scribe_changelog_${String(learningId || '')}`;
}

/**
 * The whole `messages` row both handlers insert. Returned rather than inserted,
 * so this module stays pure and both twins can assert on the ROW instead of on
 * a mock database.
 */
export function buildChangelogPost({ leagueId, learningId, playerDisplayName, playerId, category, instruction, origin }) {
  const fields = changelogFields({ playerDisplayName, category, instruction, origin });
  const recipientId = String(playerId || '');
  const row = {
    league_id: leagueId,
    // DI-292 — the id shape carries the privacy tell client-side, because the
    // client cannot read `visible_to` at all (see below). A `__private`
    // suffix on a PRIVATE row, the un-suffixed shape unchanged for the
    // public/windowed case, so `sys_scribe_changelog_` alone (no suffix)
    // still means what it meant before this DI — a structural tell, not a
    // wording one.
    //
    // WHY `__private` AND NOT THE ORIGINAL `_p` (coordinator finding 1,
    // reviewer APPROVE WITH NOTES on F-1, 2026-09-24): `learningId` on the
    // TRAINER path is `capStored(model_output.learning_id, …)` —
    // model-supplied, `capStored` only TRUNCATES, does not sanitise — so a
    // PUBLIC (windowed, no credited player) row whose model-chosen
    // learning_id happened to end in `_p` would false-positive the client's
    // id-based private detector. `__private` is a longer, wordier suffix a
    // model's short learning-id token is far less likely to end in BY
    // ACCIDENT, and `isPrivateScribeChangelog()` (js/chat.js) additionally
    // requires `meta.playerId` non-empty as a SECOND, independent lock — the
    // one field that is only ever non-empty when this very branch fired — so
    // even a coincidental id match on the trainer path (playerId always ''
    // there, see js/chat.js's own comment) still fails the meta check.
    id: recipientId ? `${changelogMessageId(learningId)}__private` : changelogMessageId(learningId),
    type: 'message',
    author: 'system',
    author_kind: 'system',
    game_tag: '',
    body: changelogBody(fields, !!recipientId),
    notify: false,
    meta: {
      kind: 'scribeChangelog',
      learningId: String(learningId || ''),
      origin: fields.origin,
      category: fields.category,
      // The credited player's ID, not their words. The DISPLAY NAME is already
      // in the body where the room reads it; carrying the id as well is what
      // lets the Training card link the row back to the person without
      // re-parsing a sentence.
      playerId: recipientId,
    },
  };
  // DI-290 — private to the credited player, and ONLY when there is one. A
  // windowed/aggregate learning has no single feedback-giver (`playerId` is
  // ''), and there is no one person to make it private TO — that row stays
  // public exactly as it behaved before this DI (UN-252's transparency need
  // is still live for that case). `visible_to` is a service-role write here
  // (both callers run under `serviceClient()`), so RLS's `messages_select`
  // policy (migration 0018:181, generic over `visible_to`, not self-test-
  // specific) scopes the row with ZERO new migration, grant, or policy change
  // — see DI-P5. `playerId` here must already be the `league_members.id` the
  // policy's `my_member_id(league_id)` compares against; both current callers
  // (scribe-learn/index.js's `row.author`, trainer/index.js's
  // `sourcePlayerId`) already pass exactly that id.
  if (recipientId) row.visible_to = recipientId;
  return row;
}
