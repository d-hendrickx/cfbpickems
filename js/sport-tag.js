/**
 * CFB Pickems — the closed set of sport tags a chat message may carry (D1, DI-553 / DI-530; security A4)
 * =====================================================================================================
 *
 * `messages.sport_tag` is a COARSE sport-level tag beside `game_tag`: '' (untagged, sport-agnostic) or one of the sport dbCodes. Migration 0033 §6 CHECKs the column to exactly this
 * set (`'', 'cfb', 'nfl', 'nba', 'cbb', 'mm', 'nhl', 'wjc'`), so the server is the final judge of any value that reaches a row. This module is the CLIENT's copy of that set, and the
 * only reason it exists is that a value outside it would be refused by the CHECK and take the whole append with it, so the client never writes one (js/chat.js sendEvent) and never
 * believes one it was handed (js/supabase-projection.js rowToMessage, js/chat.js newItem).
 *
 * THE TAG IS UNTRUSTED INPUT even when it is in the set. Any league member can set `sport_tag` through `chat_append`, so a tag is a FILING HINT for the Locker Room's sport pills and a
 * NARROWING hint for push fan-out, never an authority: js/chat.js messageSport() honors it only when it names a non-archived sport of THIS league. It can narrow who is pushed to; it can
 * never widen anything, and it never hides a row from the `All` view.
 *
 * ONE MORE COPY, PINNED. js/chatTransport.js may import exactly `./backend.js` and `./platform.js` (static.check S5/T5.11), so it carries its own list of the same seven codes. supabase/tests/static.check.mjs
 * (F2) replays EVERY migration to derive the EFFECTIVE `messages.sport_tag` CHECK and pins this module and chatTransport's copy to it, with teeth (a later migration that narrows or replaces the CHECK turns it
 * red); chatsporttest.mjs pins the two client copies to each other and the list of profiles in js/sports/index.js to a subset of the set.
 *
 * PURE: no imports, no storage, no DOM.
 */

/** The dbCodes `messages.sport_tag` may hold (besides ''). Order is 0033's. */
export const SPORT_TAG_CODES = Object.freeze(['cfb', 'nfl', 'nba', 'cbb', 'mm', 'nhl', 'wjc']);

const CODES = new Set(SPORT_TAG_CODES);

/** The tag if it is exactly one of the closed codes, else '' (a non-string, a near miss, a prototype name, markup: all ''). Never throws. */
export function validSportTag(value) {
  return typeof value === 'string' && CODES.has(value) ? value : '';
}
