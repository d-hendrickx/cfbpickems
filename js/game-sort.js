/**
 * CFB Pickems — game-sort.js (Deployment 1, Lane B, DI-607 / DI-581 / PF-445 rev 3, 2026-10-08)
 * =============================================================================================
 * The WORDS and MARKUP of the Dashboard's Sort control and of Custom arranging — and the one pure move function. Drew (D-59): "Sorting is a secondary control ... a Sort / Filter button near the top of the game list.
 * Tapping it can open a compact sheet with options such as: Kickoff time · Live games first · My custom order" — and (D-59, the coordinator's wording ruling) the modes are named **Kickoff time · Live first · Custom**,
 * the reset is **"Reset to kickoff time"**, the save toast **"Arrangement saved."**, and **the word "order" appears in no Sort or Arrange label, help line, toast, `aria-label` or announcement** (gamesorttest scans every
 * string exported here for it).
 *
 *   SORT_MODES / MODE_LABEL / SORT_COPY      the strings, exactly
 *   effectiveMode(saved, { allSports })      in All sports (Lane A, DI-525 rev 3) a saved Custom reads as Kickoff time WITHOUT being overwritten
 *   listControlHTML({ ... })                 the row under the card header: "{n} games" + a caption, and the 44 pt Sort button (or, while arranging, "Arranging" + Done)
 *   sortSheetBodyHTML({ ... })               the three radio rows, Arrange games / Reset to kickoff time under Custom, the Standard-layout note
 *   moveId(ids, id, dir)                     the pure move: a NEW array with `id` one place up or down (clamped; never wraps)
 *   arrangeRowControlsHTML({ ... })          the grip and the Move up / Move down buttons of one row while arranging
 *
 * Every renderer takes the escaper as a REQUIRED parameter (a missing one throws); the glyphs are the icon family's own constants (this leaf imports js/icons.js and nothing else, so the glyph hosts live here with their scoped svg rules: .dc-sort-glyph, .dc-arrange-grip, .dc-arrange-mv). Every attribute is double-quoted.
 */
import { icon } from './icons.js';

const requireFn = (f, name, who) => { if (typeof f !== 'function') throw new TypeError(`${who}() requires an injected ${name} function (CONVENTIONS #12): there is no fallback`); return f; };

export const SORT_MODES = Object.freeze([
  { key: 'kickoff', label: 'Kickoff time', help: 'Earliest kickoff first. Ties break the same way every time.' },
  { key: 'live-first', label: 'Live first', help: 'Live now, then not started, then final. A game that ends moves to the end.' },
  { key: 'manual', label: 'Custom', help: 'Your own arrangement for this week. Finished games stay where you put them.' },
]);
export const MODE_LABEL = Object.freeze(Object.fromEntries(SORT_MODES.map(m => [m.key, m.label])));
export const SORT_COPY = Object.freeze({
  button: 'Sort', sheetTitle: 'Sort games', sheetSub: 'Applies to your Dashboard', groupLabel: 'Sort by',
  customAllSports: 'Set per sport. Choose CFB or NFL to arrange.',
  arrange: 'Arrange games', reset: 'Reset to kickoff time', done: 'Done', close: 'Close',
  arranging: 'Arranging', arrangeHelp: (weekN) => `Hold a game and drag it, or use the arrows. Saved for Week ${weekN}.`,
  saved: 'Arrangement saved.', resetToast: 'Reset to kickoff time.', standardNote: 'Switch to Compact to rearrange.',
  moveUp: 'Move up', moveDown: 'Move down',
});

/** In All sports a saved Custom is shown (and applied) as Kickoff time; the SAVED mode is never touched — back in a single sport the arrangement is as the member left it. */
export function effectiveMode(saved, { allSports = false } = {}) {
  const m = SORT_MODES.some(x => x.key === saved) ? saved : 'kickoff';
  return allSports && m === 'manual' ? 'kickoff' : m;
}

/** A NEW id list with `id` moved one place up (dir < 0) or down (dir > 0). Clamped at the ends; an unknown id returns the list unchanged. Never mutates its input. */
export function moveId(ids, id, dir) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  const i = list.indexOf(id);
  if (i < 0) return list;
  const j = Math.max(0, Math.min(list.length - 1, i + (dir < 0 ? -1 : 1)));
  if (j === i) return list;
  list.splice(i, 1);
  list.splice(j, 0, id);
  return list;
}

/** "{away} at {home} moved to position {n} of {m}." — VoiceOver, polite, after each move (no "order"). */
export function arrangeAnnouncement({ label, n, m } = {}) { return `${label} moved to position ${n} of ${m}.`; }
export function finalMovedAnnouncement(label) { return `${label} is final and moved to the end.`; }
export function finalMovedManyAnnouncement(n) { return `${n} games are final and moved to the end.`; }

/**
 * @param {{n:number, caption:string, mode:string, arranging:boolean, weekN?:(string|number), escHtml:Function, numHtml:Function}} o
 */
export function listControlHTML({ n, caption = '', mode, arranging = false, weekN = '', escHtml, numHtml } = {}) {
  requireFn(escHtml, 'escHtml', 'listControlHTML'); requireFn(numHtml, 'numHtml', 'listControlHTML');
  if (arranging) {
    return `<div class="dc-listctl dc-listctl--arranging" data-dc-listctl><div class="dc-listctl-text"><b class="dc-listctl-title">${escHtml(SORT_COPY.arranging)}</b><span class="dc-listctl-cap">${escHtml(SORT_COPY.arrangeHelp(weekN))}</span></div>`
      + `<button type="button" class="btn btn-primary dc-sort-done" data-dc-action="arrange-done" data-haptic="success">${escHtml(SORT_COPY.done)}</button></div>`;
  }
  const label = MODE_LABEL[mode] || MODE_LABEL.kickoff;
  return `<div class="dc-listctl" data-dc-listctl><div class="dc-listctl-text"><b class="dc-listctl-title">${numHtml(n)} ${n === 1 ? 'game' : 'games'}</b>${caption ? `<span class="dc-listctl-cap">${escHtml(caption)}</span>` : ''}</div>`
    + `<button type="button" class="btn dc-sort-btn" data-dc-action="sort" data-haptic="light" aria-haspopup="dialog" aria-label="${escHtml(`Sort games. Currently ${label}.`)}"><span class="dc-sort-glyph" aria-hidden="true">${icon('sort')}</span><span class="dc-sort-name">${escHtml(SORT_COPY.button)}</span><span class="dc-sort-mode">${escHtml(label)}</span></button></div>`;
}

/**
 * The sheet's BODY (the shell — header, ✕, backdrop — is app.js's mountSheetShell). `canArrange` is false in the Standard web matrix (it has no drag handle column: PBD-B6), which shows the note instead.
 * @param {{mode:string, allSports:boolean, canArrange:boolean, hasSaved:boolean, escHtml:Function}} o
 */
export function sortSheetBodyHTML({ mode, allSports = false, canArrange = true, hasSaved = false, escHtml } = {}) {
  requireFn(escHtml, 'escHtml', 'sortSheetBodyHTML');
  const eff = effectiveMode(mode, { allSports });
  const rows = SORT_MODES.map(m => {
    const disabled = m.key === 'manual' && allSports;
    const help = disabled ? SORT_COPY.customAllSports : m.help;
    return `<button type="button" class="dc-sort-opt" role="radio" aria-checked="${eff === m.key ? 'true' : 'false'}" data-dc-action="set-mode" data-mode="${escHtml(m.key)}" data-haptic="selection"${disabled ? ' disabled aria-disabled="true"' : ''}><span class="dc-sort-opt-tx"><b>${escHtml(m.label)}</b><span>${escHtml(help)}</span></span><span class="dc-sort-radio" aria-hidden="true"></span></button>`;
  }).join('');
  let under = '';
  if (eff === 'manual' && !allSports) {
    under = canArrange
      ? `<div class="dc-sort-actions"><button type="button" class="btn dc-sort-act" data-dc-action="arrange" data-haptic="light">${escHtml(SORT_COPY.arrange)}</button>${hasSaved ? `<button type="button" class="btn dc-sort-act dc-sort-act--ghost" data-dc-action="reset" data-haptic="light">${escHtml(SORT_COPY.reset)}</button>` : ''}</div>`
      : `<p class="dc-sort-note">${escHtml(SORT_COPY.standardNote)}</p>`;
  }
  return `<div class="dc-sort-body"><div class="dc-sort-group" role="radiogroup" aria-label="${escHtml(SORT_COPY.groupLabel)}">${rows}</div>${under}<div class="dc-sort-foot"><button type="button" class="btn btn-primary dc-sort-done" data-dc-action="sort-done" data-haptic="light">${escHtml(SORT_COPY.done)}</button></div></div>`;
}

/** The sheet's two header lines: title and subtitle (the shell adds the close button). */
export function sortSheetHeaderHTML({ escHtml } = {}) {
  requireFn(escHtml, 'escHtml', 'sortSheetHeaderHTML');
  return `<div class="dc-sort-head"><div class="chat-sheet-title" id="sort-sheet-title" tabindex="-1">${escHtml(SORT_COPY.sheetTitle)}</div><div class="chat-sheet-sub">${escHtml(SORT_COPY.sheetSub)}</div></div>`;
}

/**
 * The grip (leading) and Move up / Move down (trailing) of one row while arranging (DI-581). `label` is "{away} at {home}" and is the only data in it (escaped).
 * @param {{label:string, index:number, count:number, escHtml:Function}} o
 */
export function arrangeRowControlsHTML({ label, index, count, escHtml } = {}) {
  requireFn(escHtml, 'escHtml', 'arrangeRowControlsHTML');
  const atTop = index <= 0, atEnd = index >= count - 1;
  const grip = `<span class="dc-arrange-grip" data-arrange-grip aria-hidden="true">${icon('grip')}</span>`;
  const btn = (dir, ic, off, name) => `<button type="button" class="dc-arrange-mv dc-arrange-mv--${dir}" data-dc-action="move" data-dir="${dir}" data-haptic="selection" aria-label="${escHtml(`${name} ${label}`)}"${off ? ' disabled aria-disabled="true"' : ''}>${ic}</button>`;
  // Move up / Move down are chevronLeft / chevronRight turned a quarter turn by CSS (.dc-arrange-mv svg{transform:rotate(90deg)}): no new glyph in the family.
  return { grip, arrows: `<span class="dc-arrange-arrows">${btn('up', icon('chevronLeft'), atTop, SORT_COPY.moveUp)}${btn('down', icon('chevronRight'), atEnd, SORT_COPY.moveDown)}</span>` };
}
