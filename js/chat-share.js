/**
 * CFB Pickems — chat-share.js (Deployment 1, Lane B, DI-597 / PF-454: "Share to chat", one contextual message)
 * ==========================================================================================================
 * PURE. The rules of a share, with no DOM, no store and no network, so the security properties are provable on their own:
 *
 *   validShareRef(ref)              the ONE gate on a reference, on the way OUT (the sheet) and on the way IN (every reader): a plain object with exactly { type, id }, `type` in the closed set,
 *                                   `id` a bounded, plain charset. Anything else — an extra key, a prototype trick, a long or odd id — is null, and a reader treats null as "not available".
 *   cleanShareComment(text)         the member's optional comment: plain text, control characters removed, whitespace runs folded, at most 200 characters
 *   shareLine({ eyebrow, title })   the one-line, allow-listed headline the message carries ("Final · Oregon at Washington: Oregon 31, Washington 24 — Oregon covered by 4.")
 *   shareBody(comment, line)        the message body: the comment (if any) + " — " + the headline, so a client that ignores the reference (TestFlight build 3, v0.27.2) still shows a complete message
 *   findRecentShare(msgs, q)        "You already shared this": the same author, the same reference, the same place (game tag), within 10 minutes, not withdrawn
 *   shareMeta(ref)                  the message's `meta`: `{ ref: { type, id } }` and NOTHING else — no key migration 0045 reserves on the player path (sources, trigger, source, occasion, kind)
 *
 * What a share never carries: a hidden pick, a member's selection, a private reason, a tiebreaker value, an id of its own (chat.js mints a uuid for every player event; a sys_ / scribe_ / pin_ id is
 * refused by 0045 and never produced here), or any text a reader would render from the reference — a reader rebuilds the attachment from ITS OWN data and fixed copy (SHARE_COPY).
 */

export const SHARE_REF_TYPES = Object.freeze(['card', 'game', 'week', 'compare']);
// A card id is `${type}:${leagueId}:${weekId}:${memberId}:${suffix}` (feed-cards.js buildCardId): three uuids and a type reach ~160 characters, so the bound is 200.
export const SHARE_ID_MAX = 200;
const SHARE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
export const SHARE_COMMENT_MAX = 200;
export const SHARE_LINE_MAX = 240;
export const SHARE_DEDUPE_MS = 10 * 60 * 1000;

/** The sheet's and the attachment's words (fixed copy: nothing a reader sees comes from the message's meta). */
export const SHARE_COPY = Object.freeze({
  button: 'Share to chat',
  title: 'Share to Locker Room',
  subtitle: 'One message, in the chat everyone reads',
  placeholder: 'Add a comment (optional)',
  post: 'Post to chat',
  cancel: 'Cancel',
  footnote: 'Only what is already visible to the whole league is shared.',
  posted: 'Shared to the Locker Room.',
  failed: "Couldn't share. Try again.",
  retry: 'Retry',
  already: 'You already shared this.',
  viewInChat: 'View in chat',
  open: 'Open details',
  unavailable: "This item isn't available to you right now.",
});

const isStr = (v) => typeof v === 'string';

/** @returns {{type:string, id:string}|null} */
export function validShareRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  if (Object.getPrototypeOf(ref) !== Object.prototype && Object.getPrototypeOf(ref) !== null) return null;
  const keys = Object.keys(ref);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('id')) return null;
  const { type, id } = ref;
  if (!isStr(type) || !SHARE_REF_TYPES.includes(type)) return null;
  if (!isStr(id) || id.length > SHARE_ID_MAX || !SHARE_ID_RE.test(id)) return null;
  if (/^(?:__proto__|constructor|prototype)$/.test(id)) return null;
  return { type, id };
}

/** Plain text: no control characters, whitespace runs folded to one space, trimmed, at most SHARE_COMMENT_MAX characters (counted by code point, never splitting a pair). */
export function cleanShareComment(text) {
  if (!isStr(text)) return '';
  const flat = text.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  const cps = Array.from(flat);
  return cps.length > SHARE_COMMENT_MAX ? cps.slice(0, SHARE_COMMENT_MAX).join('').trimEnd() : flat;
}

/** The one-line headline: "{eyebrow}: {title}", or the eyebrow alone. Plain text, one line, bounded. */
export function shareLine({ eyebrow = '', title = '' } = {}) {
  const one = (s) => (isStr(s) ? s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim() : '');
  const e = one(eyebrow), t = one(title);
  const line = e && t ? `${e}: ${t}` : (e || t);
  const cps = Array.from(line);
  return cps.length > SHARE_LINE_MAX ? `${cps.slice(0, SHARE_LINE_MAX - 1).join('').trimEnd()}…` : line;
}

/** The message body. Complete without the reference (an older client shows exactly this). */
export function shareBody(comment, line) {
  const c = cleanShareComment(comment), l = shareLine({ eyebrow: line });
  if (!l) return '';
  return c ? `${c} — ${l}` : l;
}

/** The message's meta: the reference and nothing else. Null when the reference is not valid (nothing is posted). */
export function shareMeta(ref) {
  const r = validShareRef(ref);
  return r ? { ref: { type: r.type, id: r.id } } : null;
}

/** The same author's same reference in the same place within the window (and not withdrawn): the message, or null. `messages` are chat.js's message objects. */
export function findRecentShare(messages, { ref, gameTag = '', author, now = Date.now(), windowMs = SHARE_DEDUPE_MS } = {}) {
  const r = validShareRef(ref);
  if (!r || !isStr(author) || !author) return null;
  const place = isStr(gameTag) ? gameTag : '';
  let best = null;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.type !== 'message' || m.author !== author || m.deleted) continue;
    if ((m.gameTag || '') !== place) continue;
    const mr = validShareRef(m.meta && m.meta.ref);
    if (!mr || mr.type !== r.type || mr.id !== r.id) continue;
    const ts = Number(m.ts || m._localTs || 0);
    if (!(now - ts <= windowMs)) continue;
    if (!best || ts > Number(best.ts || best._localTs || 0)) best = m;
  }
  return best;
}
