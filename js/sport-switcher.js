/**
 * CFB Pickems — sport-switcher.js (D1 / v0.30.0, DI-521 rev 3, DI-555)
 *
 * The sport SWITCHER: an iOS-style segmented control that sits at the top of Picks, Dashboard and Standings and nowhere else. It lists ONLY the sports the member plays, renders only when
 * they play TWO OR MORE (DI-555: a CFB-only member in a two-sport league sees no switcher, no NFL button and nothing that leads to a Join), and on the Dashboard alone gains a last
 * segment, "All sports" (DI-525 rev 3, Drew D-59). Approved as drawn in `docs/mockups/d1/dashboard-sort-sport.html`.
 *
 * A PURE LEAF: it imports nothing, reads nothing and touches no DOM. app.js asks `playedSports()` who the member plays and which of those have picks due; this module only draws that
 * and answers the keyboard. (The sliding thumb and the haptic are DOM and native concerns and live in app.js.)
 *
 *   sportSwitcherHTML({ sports, selected, dueCodes, allSports, escHtml })   '' unless two or more sports are played
 *   nextSegmentIndex(count, index, key)                                      roving-tab-index keyboard model for a radiogroup
 *   segmentValues(sports, allSports)                                         the ordered values ('cfb','nfl','all')
 *
 * `sports` is `[{ dbCode, code, label }]`; `selected` is a dbCode or 'all'; `dueCodes` is the dbCodes with picks due (the SAME list the header dot and the At-a-glance chip read, so
 * the three cannot disagree); a due dot is drawn on an UNSELECTED segment only, and the due time is in the segment's accessible name as well (never colour alone).
 */

export const ALL_SPORTS_VALUE = 'all';

function requireEscHtml(escHtml) {
  if (typeof escHtml !== 'function') throw new TypeError('sportSwitcherHTML() requires an injected escHtml function (CONVENTIONS #12)');
  return escHtml;
}

/** The ordered segment values: each played sport's dbCode, then 'all' when the Dashboard offers it. */
export function segmentValues(sports, allSports = false) {
  const list = (Array.isArray(sports) ? sports : []).map((s) => String(s && s.dbCode || '')).filter(Boolean);
  return allSports ? [...list, ALL_SPORTS_VALUE] : list;
}

/**
 * The control. Returns '' unless `sports.length >= 2` (the participation rule, DI-555) — no wrapper, no empty box.
 * `dueLabels` is an optional `{ [dbCode]: 'picks due in 21 hours' }` folded into the accessible name.
 */
export function sportSwitcherHTML({ sports = [], selected = '', dueCodes = [], dueLabels = {}, allSports = false, escHtml } = {}) {
  const esc = requireEscHtml(escHtml);
  const played = Array.isArray(sports) ? sports.filter((s) => s && s.dbCode) : [];
  if (played.length < 2) return '';
  const values = segmentValues(played, allSports);
  const sel = values.includes(selected) ? selected : values[0];
  const selIndex = Math.max(0, values.indexOf(sel));
  const due = new Set(Array.isArray(dueCodes) ? dueCodes.map(String) : []);
  const seg = (value, label, aria, hasDot) => {
    const checked = value === sel;
    return `<button type="button" class="sport-seg-btn" role="radio" aria-checked="${checked ? 'true' : 'false'}" tabindex="${checked ? '0' : '-1'}" data-sport="${esc(value)}" aria-label="${esc(aria)}">${esc(label)}${hasDot ? '<span class="sport-seg-dot" aria-hidden="true"></span>' : ''}</button>`;
  };
  const buttons = played.map((s) => {
    const code = String(s.code || s.dbCode);
    const isDue = due.has(String(s.dbCode)) && String(s.dbCode) !== sel;
    const dueText = dueLabels && dueLabels[s.dbCode] ? `, ${dueLabels[s.dbCode]}` : (isDue ? ', picks due' : '');
    return seg(String(s.dbCode), code, `${code}${isDue ? dueText : ''}`, isDue);
  });
  if (allSports) buttons.push(seg(ALL_SPORTS_VALUE, 'All sports', 'All sports', false));
  const n = values.length;
  return `<div class="sport-seg-host"><div class="sport-seg" role="radiogroup" aria-label="Sport" style="--seg-n:${n};--seg-i:${selIndex}"><span class="sport-seg-thumb" aria-hidden="true"></span>${buttons.join('')}</div></div>`;
}

/**
 * Roving focus for a radiogroup (the WAI-ARIA pattern a native segmented control follows): Right / Down move to the next segment, Left / Up to the previous, Home / End to the ends;
 * they wrap neither way (a segmented control has two ends). Any other key answers `index`, unchanged.
 */
export function nextSegmentIndex(count, index, key) {
  const n = Math.floor(Number(count));
  if (!(n > 0)) return 0;
  const i = Math.min(Math.max(Math.floor(Number(index)) || 0, 0), n - 1);
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return Math.min(i + 1, n - 1);
    case 'ArrowLeft': case 'ArrowUp': return Math.max(i - 1, 0);
    case 'Home': return 0;
    case 'End': return n - 1;
    default: return i;
  }
}
