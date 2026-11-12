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

// ─── D2 sweep, W-128 (UN-533 / DI-792…795): the Locker Room's ONE scope button and its anchored menu ──────────────────────────────────────────────────────────────────────────────────
// The old title row ("Chat" + BETA), the sport row and the thread row are three stacked pieces above the thread (about 150 pt). The sport row is REPLACED by one pill at the leading edge of the
// thread row: "{league name} · {sport}" ("Weekend Crew · All"). It opens a small anchored menu with two sections, League (only when the member has more than one league) and Sport (All
// sports, then each sport of the league; a radiogroup that keeps this module's accessible-name contract, "NFL, 2 unread, selected"). In a league that runs ONE sport the button reads the
// league name alone and opens the league selector itself (the same action as the header pill). The filtering is unchanged (js/chat.js messageSport() / appearsUnderSport()); these are
// pure builders over the same view-model sportPillsMarkup() takes, escaped with the house escaper that is passed in.

const textOf = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
/** The sports whose tag is in the closed set (js/sport-tag.js): the same wall sportPillsMarkup() puts between a competition row's `sport` string and the page. */
const closedSports = (sports) => (Array.isArray(sports) ? sports : []).filter((s) => !!s && validSportTag(s.dbCode));

/**
 * What the scope button shows and does. `visible` is false when there is nothing to scope (no league name known and fewer than two sports). `kind` is 'menu' (two or more sports: the
 * menu) or 'league' (one sport: the button itself opens the league selector). `sportCode` is 'All' or the selected sport's display code (only for kind 'menu').
 */
export function scopeButtonModel({ leagueName, sports, selected } = {}) {
  const list = closedSports(sports);
  const league = textOf(leagueName).slice(0, 80);
  const multi = list.length >= 2;
  if (!multi) return league ? { visible: true, kind: 'league', league, sportCode: '' } : { visible: false, kind: 'league', league: '', sportCode: '' };
  const hit = list.find((s) => s.dbCode === selected);
  return { visible: true, kind: 'menu', league, sportCode: hit ? textOf(hit.code) || 'All' : 'All' };
}

/** The button's plain label, the way it reads on screen and to VoiceOver: "Weekend Crew · All", "Weekend Crew", "All" (no league name known). */
export function scopeLabelText(model) {
  if (!model || !model.visible) return '';
  if (model.kind === 'league') return model.league;
  return model.league ? `${model.league} · ${model.sportCode}` : model.sportCode;
}

/**
 * The button's markup. The league name is its own element so a long name ellipsizes while the sport suffix never does (an ellipsis never empties the label). `otherUnread` is the number of
 * unread rows in the scopes this button is NOT showing: a dot, never a count, with its meaning in the accessible name. `open` is the menu's state.
 */
export function scopeButtonMarkup({ model, otherUnread = 0, open = false, esc } = {}) {
  if (typeof esc !== 'function') throw new TypeError('scopeButtonMarkup: an HTML escaper is required');
  if (!model || !model.visible) return '';
  const n = Math.max(0, Math.floor(Number(otherUnread) || 0));
  const menu = model.kind === 'menu';
  const spoken = `${scopeLabelText(model) || 'All'}${n > 0 ? `, ${n > 99 ? '99+' : n} unread in other sports` : ''}. ${menu ? 'Choose a league or sport.' : 'Opens your leagues.'}`;
  return [
    '<button type="button" class="chat-scope-btn" id="chat-scope-btn" data-chat-scope="', menu ? 'menu' : 'league', '" aria-label="', esc(spoken), '"',
    menu ? [' aria-haspopup="true" aria-expanded="', open ? 'true' : 'false', '" aria-controls="chat-scope-menu"'].join('') : '', '>',
    '<span class="chat-scope-pill">',
    model.league ? ['<span class="chat-scope-league">', esc(model.league), '</span>'].join('') : '',
    menu ? ['<span class="chat-scope-sport">', model.league ? ' · ' : '', esc(model.sportCode), '</span>'].join('') : '',
    '<span class="chat-scope-caret" aria-hidden="true">▾</span>',
    n > 0 ? '<span class="chat-scope-dot" aria-hidden="true"></span>' : '',
    '</span></button>',
  ].join('');
}

/**
 * The menu's markup. League section only when `showLeague` (the member has more than one league): one 44 pt row naming the active league that opens the league selector (`data-chat-scope-action
 * ="league"`; the same selector the header pill opens). Sport section: a radiogroup with `All sports` and one row per sport, each 44 pt with its unread dot and a check on the selected one; every
 * row carries `data-chat-sport-filter` (the attribute the sport pills used, so one handler serves both) and an accessible name from sportPillName(). `sports` below two renders no Sport section.
 */
export function scopeMenuMarkup({ showLeague = false, leagueName = '', sports, selected, allUnread, unreadOf, esc } = {}) {
  if (typeof esc !== 'function') throw new TypeError('scopeMenuMarkup: an HTML escaper is required');
  const list = closedSports(sports);
  const sel = list.some((s) => s.dbCode === selected) ? selected : 'all';
  const dot = (badge) => (badge ? ['<span class="chat-unread-dot">', esc(badge), '</span>'].join('') : '');
  const check = (on) => (on ? ['<span class="chat-scope-check" aria-hidden="true">', icon('check'), '</span>'].join('') : '');
  const row = ({ value, text, glyphKey, badge, unread }) => {
    const on = value === sel;
    return [
      '<button type="button" class="chat-scope-opt chat-scope-sport-opt', on ? ' is-selected' : '', '" role="radio" aria-checked="', on ? 'true' : 'false',
      '" aria-label="', esc(sportPillName({ code: text, unread, selected: on })), '" data-chat-sport-filter="', esc(value), '">',
      glyphKey ? ['<span class="chat-sport-glyph" aria-hidden="true">', icon(glyphKey), '</span>'].join('') : '',
      '<span class="chat-scope-opt-label">', esc(text === 'All' ? 'All sports' : text), '</span>', dot(badge), check(on), '</button>',
    ].join('');
  };
  const parts = ['<div class="chat-scope-menu" id="chat-scope-menu" role="group" aria-label="Chat scope">'];
  if (showLeague && textOf(leagueName)) {
    parts.push([
      '<div class="chat-scope-section"><div class="chat-scope-heading">League</div>',
      '<button type="button" class="chat-scope-opt" data-chat-scope-action="league" aria-label="', esc(`${textOf(leagueName)}. Switch league.`), '">',
      '<span class="chat-scope-opt-label">', esc(textOf(leagueName)), '</span><span class="chat-scope-chevron" aria-hidden="true">', icon('chevronRight'), '</span></button></div>',
    ].join(''));
  }
  if (list.length >= 2) {
    const all = allUnread && typeof allUnread === 'object' ? allUnread : { badge: '', unread: 0 };
    const rows = [row({ value: 'all', text: 'All', glyphKey: '', badge: all.badge || '', unread: all.unread })];
    for (const s of list) {
      const u = (typeof unreadOf === 'function' ? unreadOf(s.dbCode) : null) || { badge: '', unread: 0 };
      rows.push(row({ value: s.dbCode, text: s.code, glyphKey: s.glyphKey, badge: u.badge || '', unread: u.unread }));
    }
    parts.push(['<div class="chat-scope-section"><div class="chat-scope-heading">Sport</div><div role="radiogroup" aria-label="Filter by sport">', rows.join(''), '</div></div>'].join(''));
  }
  parts.push('</div>');
  return parts.join('');
}
