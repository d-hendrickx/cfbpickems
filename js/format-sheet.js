/**
 * CFB Pickems - format-sheet.js (D2 lane 2, DI-914 / DI-918; UN-515 / UN-516; mockup docs/mockups/d2-sport-rules.html frames 7 and 8)
 * ======================================================================================================================================
 * The PURE markup of the two commissioner sheets and the settings rows that open them: "How should NHL picks work?" (the pick format) and "Lines shown on Picks". Pure (it imports only the format
 * leaf): every string is escaped by the injected `escHtml`, nothing reads storage or a clock, and the state machine (choose, saving, saved, failed) is data the caller hands in, so a Node suite proves
 * every state and app.js only mounts it in the shared action-sheet layer and runs the writes.
 *
 *   settingsRowsModel(...)   the three 52 pt rows on a sport's settings card as DATA (id, label, value, editable): Pick format, Lines shown on Picks, Rules; app.js draws them (so every printed value is escaped where it is written)
 *   formatSheetHTML(...)     the radio list (a 56 pt row per format: the name and one sentence), Save (disabled until the choice changes), the Draft-slate switch, the inline "applies from now on" confirmation
 *   linesSheetHTML(...)      three 56 pt switch rows that SAVE AS THEY ARE FLIPPED; the spread locked ON for an against-the-spread sport; "No lines yet" for a market nothing on the slate carries; the footnote
 *   FORMAT_SHEET_COPY        the sentences (DI-914), fixed
 */

import { icon } from './icons.js';
import { offeredFormats, formatLabel, formatSentence, isPickTheWinner, marketsSummary, marketLocked, MARKET_ROWS, MARKETS_FOOTNOTE } from './formats.js';

export const FORMAT_SHEET_COPY = Object.freeze({
  title: (label) => `How should ${label} picks work?`,
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  appliesFromNow: 'This applies to slates you create from now on. Slates already built keep their format.',
  changeFormat: 'Change format',
  back: 'Back',
  failed: "Couldn't save. The format was not changed. Try again.",
  retry: 'Retry',
  draftSwitch: (slateLabel) => `Also change the draft slate (${slateLabel})`,
  draftNote: 'Slates that are open, locked, live or final never change.',
  draftCleared: 'Lines are cleared on its games.',
  draftNeedsSpread: 'Games without a line need one before the slate can open.',
  toast: (label, format, fmtLabel) => `${label} picks: ${isPickTheWinner(format) ? 'pick the winner' : fmtLabel.toLowerCase()}.`,
  linesTitle: 'Lines shown on Picks',
  linesDone: 'Done',
  linesSaved: 'Saved',
  linesFailed: "Couldn't save. Try again.",
  noLinesYet: 'No lines yet',
  readOnlyNote: 'Only a commissioner can change this.',
  rowPickFormat: 'Pick format',
  rowLines: 'Lines shown on Picks',
  rowRules: 'Rules',
});

const req = (escHtml, fn) => { if (typeof escHtml !== 'function') throw new TypeError(`${fn}() requires an injected escHtml function (CONVENTIONS #12)`); return escHtml; };

/** The three 52 pt rows of a sport's settings card. `canEdit` false (a member) renders the value as read-only text and keeps the Rules link. `chevron` is the icon markup the caller owns. */
export function settingsRowsModel({ profile, format, shown, canEdit = true } = {}) {
  return [
    { id: 'sport-format-row', label: FORMAT_SHEET_COPY.rowPickFormat, value: formatLabel(profile, format), editable: !!canEdit },
    { id: 'sport-lines-row', label: FORMAT_SHEET_COPY.rowLines, value: marketsSummary(shown), editable: !!canEdit },
    { id: 'sport-rules-row', label: FORMAT_SHEET_COPY.rowRules, value: '', editable: true },
  ];
}

/**
 * The pick-format sheet. State: `current` (what is saved), `selected` (the radio), `phase` 'choose' | 'saving' | 'saved' | 'failed', `draft` ({ label, count } of the one Draft slate, or null) with `applyDraft`.
 * A sport that offers ONE format (college football) shows it read-only with its sentence and no Save. A member (`canEdit` false) sees the value and the sentence only.
 */
export function formatSheetHTML({ escHtml, profile, current, selected = current, phase = 'choose', draft = null, applyDraft = true, canEdit = true } = {}) {
  req(escHtml, 'formatSheetHTML');
  const label = profile && profile.label ? profile.label : 'this sport';
  const offered = offeredFormats(profile);
  const title = FORMAT_SHEET_COPY.title(label);
  if (phase === 'saved') {
    return `<div class="lc-scrim" data-ls-action="cancel"></div>
    <div class="lc-actionsheet fmt-sheet" role="alertdialog" aria-modal="true" aria-labelledby="fmt-sheet-title">
      <div class="lc-as-grp"><div class="lc-as-ttl lc-as-ttl-has-msg" id="fmt-sheet-title">${escHtml(title)}</div><div class="lc-as-msg" role="status">${escHtml(FORMAT_SHEET_COPY.appliesFromNow)}</div>
        <button type="button" class="lc-as-act" data-ls-action="fmt-change">${escHtml(FORMAT_SHEET_COPY.changeFormat)}</button></div>
      <div class="lc-as-grp"><button type="button" class="lc-as-act lc-as-bold" data-ls-action="cancel">${escHtml(FORMAT_SHEET_COPY.back)}</button></div>
    </div>`;
  }
  const rows = offered.map((f) => {
    const on = f === selected;
    return `<button type="button" class="fmt-row${on ? ' selected' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" data-ls-action="fmt-select:${escHtml(f)}"${canEdit && offered.length > 1 && phase !== 'saving' ? '' : ' disabled'}>
        <span class="fmt-row-name">${escHtml(formatLabel(profile, f))}</span><span class="fmt-row-sentence text-muted">${escHtml(formatSentence(profile, f))}</span><span class="fmt-check" aria-hidden="true">${on ? icon('check') : ''}</span></button>`;   // the chosen row carries a CHECK, never tint alone
  }).join('');
  const draftHTML = draft && canEdit && offered.length > 1
    ? `<div class="fmt-draft"><button type="button" class="control-center-row control-center-row--toggle fmt-draft-row" role="switch" aria-checked="${applyDraft ? 'true' : 'false'}" data-ls-action="fmt-draft-toggle"${phase === 'saving' ? ' disabled' : ''}><span class="cc-row-label">${escHtml(FORMAT_SHEET_COPY.draftSwitch(draft.label))}</span><span class="cc-row-switch" data-on="${applyDraft ? 'true' : 'false'}" aria-hidden="true"></span></button>
        <p class="text-muted text-xs">${escHtml(applyDraft ? (isPickTheWinner(selected) ? FORMAT_SHEET_COPY.draftCleared : FORMAT_SHEET_COPY.draftNeedsSpread) : '')}</p></div>`
    : '';
  const changed = selected !== current;
  const failed = phase === 'failed' ? `<div class="fmt-error warning-box" role="alert">${escHtml(FORMAT_SHEET_COPY.failed)}</div>` : '';
  const saveLabel = phase === 'saving' ? FORMAT_SHEET_COPY.saving : (phase === 'failed' ? FORMAT_SHEET_COPY.retry : FORMAT_SHEET_COPY.save);
  const save = canEdit && offered.length > 1
    ? `<button type="button" class="lc-as-act lc-as-bold fmt-save" data-ls-action="fmt-save"${(changed && phase !== 'saving') || phase === 'failed' ? '' : ' disabled'}>${escHtml(saveLabel)}</button>`
    : '';
  const note = !canEdit ? `<p class="text-muted text-xs">${escHtml(FORMAT_SHEET_COPY.readOnlyNote)}</p>` : '';
  return `<div class="lc-scrim" data-ls-action="cancel"></div>
    <div class="lc-actionsheet fmt-sheet" role="alertdialog" aria-modal="true" aria-labelledby="fmt-sheet-title">
      <div class="lc-as-grp"><div class="lc-as-ttl" id="fmt-sheet-title">${escHtml(title)}</div>
        <div class="fmt-list" role="radiogroup" aria-label="${escHtml(title)}">${rows}</div>${draftHTML}${failed}${note}</div>
      <div class="lc-as-grp">${save}<button type="button" class="lc-as-act" data-ls-action="cancel">${escHtml(FORMAT_SHEET_COPY.cancel)}</button></div>
    </div>`;
}

/**
 * The lines sheet. `shown` is the markets currently on; `available` maps a market to whether ANY game of the current slate carries it (false -> "No lines yet", still switchable); `phase` is the last
 * flip's state ('idle' | 'saving' | 'saved' | 'failed'). The spread's switch is locked ON for an against-the-spread sport.
 */
export function linesSheetHTML({ escHtml, profile, format, shown = [], available = {}, phase = 'idle', canEdit = true } = {}) {
  req(escHtml, 'linesSheetHTML');
  const display = profile && profile.markets && Array.isArray(profile.markets.display) ? profile.markets.display : [];
  const rows = MARKET_ROWS.filter((m) => display.includes(m.key)).map((m) => {
    const on = shown.includes(m.key), locked = marketLocked(format, m.key);
    const sentence = m.sentence;
    const none = available[m.key] === false ? `<span class="fmt-nolines text-muted text-xs">${escHtml(FORMAT_SHEET_COPY.noLinesYet)}</span>` : '';
    // the shared SWITCH ROW (the one on/off control of the control center and League Settings: a role="switch" button with the .cc-row-switch track), never a raw browser checkbox
    return `<button type="button" class="control-center-row control-center-row--toggle lines-row" role="switch" aria-checked="${on ? 'true' : 'false'}" data-ls-action="lines-toggle:${escHtml(m.key)}"${locked || !canEdit || phase === 'saving' ? ' disabled' : ''} aria-label="${escHtml(m.label)}">
        <span class="lines-row-text cc-row-label"><span class="lines-row-name">${escHtml(m.label)}</span><span class="lines-row-sentence text-muted text-xs">${escHtml(sentence)}</span>${none}</span>
        <span class="cc-row-switch" data-on="${on ? 'true' : 'false'}" aria-hidden="true"></span></button>`;
  }).join('');
  const status = phase === 'saved' ? `<span class="text-muted text-xs" role="status">${escHtml(FORMAT_SHEET_COPY.linesSaved)}</span>`
    : phase === 'failed' ? `<span class="warning-box" role="alert">${escHtml(FORMAT_SHEET_COPY.linesFailed)}</span>`
    : phase === 'saving' ? `<span class="text-muted text-xs" role="status">${escHtml(FORMAT_SHEET_COPY.saving)}</span>` : '';
  return `<div class="lc-scrim" data-ls-action="cancel"></div>
    <div class="lc-actionsheet lines-sheet" role="alertdialog" aria-modal="true" aria-labelledby="lines-sheet-title">
      <div class="lc-as-grp"><div class="lc-as-ttl" id="lines-sheet-title">${escHtml(FORMAT_SHEET_COPY.linesTitle)}</div>${rows}
        <p class="text-muted text-xs lines-foot">${escHtml(MARKETS_FOOTNOTE)}</p>${status}</div>
      <div class="lc-as-grp"><button type="button" class="lc-as-act lc-as-bold" data-ls-action="cancel">${escHtml(FORMAT_SHEET_COPY.linesDone)}</button></div>
    </div>`;
}
