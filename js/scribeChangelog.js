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
export function changelogBody(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const who = f.playerDisplayName || 'a player';
  const what = f.categoryLabel ? ` about ${f.categoryLabel}` : '';
  const how = f.origin === 'instant' ? 'right away' : 'in last night\'s training pass';
  const summary = f.instructionSummary ? ` "${f.instructionSummary}"` : '';
  return flatten(
    `📓 SCRIBE update — feedback from ${who} changed something${what} ${how}:${summary} `
    + '(Commissioner can undo this in Comm → Data → SCRIBE Training.)',
    CHANGELOG_BODY_MAX,
  );
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
  return {
    league_id: leagueId,
    id: changelogMessageId(learningId),
    type: 'message',
    author: 'system',
    author_kind: 'system',
    game_tag: '',
    body: changelogBody(fields),
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
      playerId: String(playerId || ''),
    },
  };
}
