/**
 * CFB Pickems — the Locker Room's sport filter pills, as pure builders (D1, DI-553 / W-57; Drew D-48: "in this release i want sport filter pills in the locker room")
 * =====================================================================================================================================================================
 *
 * The Locker Room is ONE conversation in ONE log. The pills are a VIEW over it: `All`, then one pill per non-archived sport of the league, narrowing the rows that are SHOWN (and
 * the rows an unread dot COUNTS) to that sport's. Nothing here stores, copies or shards a message, and nothing here reads one: this module only turns a small view-model that
 * js/chat-ui.js assembles into markup. WHICH sports a league runs is not decided here (W-57 Part 2: it is js/competition.js `isMultiSport() ? leagueSports() : []`, the one list every sport-aware
 * surface reads); the filtering itself is js/chat.js messageSport() / appearsUnderSport().
 *
 * WHY A MODULE OF ITS OWN. It keeps js/chat-ui.js's hunk small (chat-ui is a shared file), it is testable without a DOM, and it is the one place the pill row's markup contract
 * lives: a `radiogroup` of `radio` buttons, each pill's accessible NAME carrying its state ("NFL, 2 unread, selected"), a 44 pt target (css/styles.css `.chat-pill`), the Munera
 * icon family's glyph, and nothing that can carry markup except the one constant SVG the icon family returns.
 *
 * IMPORTS: js/icons.js (a pure table of constant SVG strings) and js/sport-tag.js (the closed set of sport codes, itself a leaf with no imports) — exactly those two, pinned by chatsporttest [0f].
 * No storage, no auth, no DOM, no chat.js — so it can be scanned and exercised in isolation.
 */

import { icon } from './icons.js';
import { validSportTag } from './sport-tag.js';

/** One pill's accessible name: "NFL, 2 unread, selected" (DI-553: the name carries the state, so VoiceOver reads it in one go). */
export function sportPillName({ code, unread, selected }) {
  const n = Math.max(0, Math.floor(Number(unread) || 0));
  return `${code}${n > 0 ? `, ${n > 99 ? '99+' : n} unread` : ''}${selected ? ', selected' : ''}`;
}

/**
 * The pill row's markup. `esc` is REQUIRED (the house escaper is passed in, never assumed: a missing one throws rather than rendering unescaped).
 *
 * @param {object}   args
 * @param {Array}    args.sports    lockerRoomSports()'s result; `[]` renders ''
 * @param {string}   args.selected  'all' or a dbCode in `sports` (anything else renders as 'all' selected)
 * @param {object}   args.allUnread `{ badge, unread }` for the `All` pill (badge: the dot's text, '' = none; unread: the number, for the accessible name)
 * @param {Function} args.unreadOf  (dbCode) => `{ badge, unread }` for that sport's pill
 * @param {Function} args.esc       the HTML escaper
 * @returns {string} the `<div class="chat-sport-pills" role="radiogroup">…</div>` row, or ''
 */
export function sportPillsMarkup({ sports, selected, allUnread, unreadOf, esc } = {}) {
  if (typeof esc !== 'function') throw new TypeError('sportPillsMarkup: an HTML escaper is required');
  // Only entries whose dbCode is one of the closed codes (js/sport-tag.js) are pills. The LIST ("which sports does this league run") is the sports lane's — js/competition.js `isMultiSport() ? leagueSports() :
  // []` — so this builder is the one wall between a competition row's `sport` string and the page: a markup-bearing, prototype-named or unknown code is never a pill, a value or an aria-label.
  const list = (Array.isArray(sports) ? sports : []).filter((s) => s && validSportTag(s.dbCode));
  if (list.length < 2) return '';
  const sel = list.some((s) => s.dbCode === selected) ? selected : 'all';
  const dot = (badge) => (badge ? ['<span class="chat-unread-dot">', esc(badge), '</span>'].join('') : '');
  const pill = ({ value, text, glyphKey, badge, unread }) => {
    const on = value === sel;
    const name = sportPillName({ code: text, unread, selected: on });
    return [
      '<button type="button" class="chat-pill chat-sport-pill', on ? ' active' : '', '" role="radio" aria-checked="', on ? 'true' : 'false',
      '" aria-label="', esc(name), '" data-chat-sport-filter="', esc(value), '">',
      glyphKey ? ['<span class="chat-sport-glyph" aria-hidden="true">', icon(glyphKey), '</span>'].join('') : '',
      esc(text), dot(badge), '</button>',
    ].join('');
  };
  const all = allUnread && typeof allUnread === 'object' ? allUnread : { badge: '', unread: 0 };
  const parts = [pill({ value: 'all', text: 'All', glyphKey: '', badge: all.badge || '', unread: all.unread })];
  for (const s of list) {
    const u = (typeof unreadOf === 'function' ? unreadOf(s.dbCode) : null) || { badge: '', unread: 0 };
    parts.push(pill({ value: s.dbCode, text: s.code, glyphKey: s.glyphKey, badge: u.badge || '', unread: u.unread }));
  }
  return ['<div class="chat-sport-pills" role="radiogroup" aria-label="Filter by sport">', parts.join(''), '</div>'].join('');
}
