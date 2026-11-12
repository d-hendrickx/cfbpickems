/**
 * js/obligations-toggle.js — THE OBLIGATIONS SWITCH, THE PURE HALF (D2 lane 1, UN-541 / PF-541, DI-1015..1021; mockup d2-obligations.html frames 1 and 2)
 * ==========================================================================================================================================
 * Obligations (the weekly loser owes the winner, and the commissioner marks the payment) can be switched OFF for a group that just plays for fun. This module is the words, the one decision and the markup:
 *
 *   - `OBT_KEY`            the stored key: `obligationsEnabled`, a boolean. League default in the league settings blob; a per-sport override in `competitions.settings` (js/competition.js owns the resolution
 *                          and is the ONLY reader of the raw value: `obligationsOn(competitionId)`).
 *   - `isOn(value)`        the DEFAULT-WHEN-MISSING story (CONVENTIONS #10): ONLY an explicit `false` is off. A league that never stored the key, a competition that carries none, a stray string, `null`: ON, exactly the
 *                          app as it was before this setting existed.
 *   - `rowHTML()`          the ROW for the Competition & rules page (lane 6's `data-league-slot="obligations"`) and, with `scope: 'sport'`, for a sport's page: the League Settings switch row's own structure (a 48 pt
 *                          `role="switch"` button, the shipped 40 x 24 switch), the helper under it, and the failed line. A person who may not change it gets NOTHING (a player sees no switch: DI-1020).
 *   - `confirmTitle()` / `confirmSheetHTML()`  the two confirmation sentences, word for word (DI-1018); the sheet is the shell's action sheet (title only, as the mockup shows it).
 * It builds no state and reads no storage: `escHtml` is a REQUIRED injected dependency (CONVENTIONS #12). The taps, the writes and the gating of every obligation surface are js/app.js's.
 */
import { actionSheetHTML } from './league-create.js';

export const OBT_KEY = 'obligationsEnabled';
/** The default-when-missing story: only an explicit `false` turns obligations off. */
export const isOn = (value) => value !== false;

export const OBT_COPY = Object.freeze({
  label: 'Obligations',
  sub: 'Weekly prizes owed and paid',
  helper: 'On: the weekly loser owes the winner and the commissioner can mark payments. Off: you just play for fun.',
  failed: "Couldn't save. Nothing was changed. Try again.",
  offConfirm: 'Turn Off',
  onConfirm: 'Turn On',
  cancel: 'Cancel',
  /** The league-wide wording when the switch is the league default (the Competition & rules page). */
  leagueScope: 'this league',
  rulesNone: 'Prizes: none. This league plays for fun.',
});

const requireEscHtml = (escHtml, who) => { if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an escHtml function: a sport's name and a league's name are data`); };
const plural = (n, one, many) => (n === 1 ? one : many);

/** DI-1018, word for word. `scopeLabel` is the sport ("College Football") or `OBT_COPY.leagueScope`; `unpaid` the count of unpaid obligations that would be hidden (the sentence is omitted at zero). */
export function confirmTitle({ turningOff, scopeLabel = OBT_COPY.leagueScope, unpaid = 0 } = {}) {
  const scope = String(scopeLabel || OBT_COPY.leagueScope);
  if (turningOff) {
    const n = Number.isFinite(Number(unpaid)) && Number(unpaid) > 0 ? Math.floor(Number(unpaid)) : 0;
    // security C-1 (copy only): the rows are kept and the APP stops showing them; that is display, not privacy (a member can still read an unpaid row), so the sentence says "doesn't show", never "hidden".
    // The singular also agrees now ("stays ... and comes back").
    return `Turn off obligations for ${scope}? New weeks won't create any.${n > 0 ? ` ${n} unpaid ${plural(n, 'obligation stays on record and comes back', 'obligations stay on record and come back')} if you turn this on again. Until then the app doesn't show ${plural(n, 'it', 'them')}.` : ''}`;
  }
  return `Turn on obligations for ${scope}? Weeks you finalize from now on will create them. Earlier weeks are not changed.`;
}

/** The confirmation action sheet: the title only (the mockup's frame 2), the destructive-styled confirm, Cancel. The actions are `obt-confirm` and `cancel` on the shell's layer dispatcher. */
export function confirmSheetHTML({ turningOff, scopeLabel, unpaid, escHtml } = {}) {
  requireEscHtml(escHtml, 'confirmSheetHTML');
  return actionSheetHTML({ escHtml, titleId: 'obt-title', title: confirmTitle({ turningOff, scopeLabel, unpaid }), danger: { label: turningOff ? OBT_COPY.offConfirm : OBT_COPY.onConfirm, action: 'obt-confirm' },
    cancel: { label: OBT_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: 'data-ls-action' });
}

/**
 * The row. `value` is the last CONFIRMED value (a save in flight keeps showing it: no optimistic flip). `phase`: 'ready' | 'saving' | 'failed' (the last save failed: the sentence shows under the row,
 * the switch is back to the confirmed value) | 'readonly' (an archived sport: shown, not changeable). `canEdit` false (a player) renders NOTHING. `scope`: 'league' (the default) | 'sport'; `competitionId` is the
 * sport's id (an id: escaped) and rides `data-obt-competition`.
 */
export function rowHTML({ value = true, phase = 'ready', canEdit = false, scope = 'league', competitionId = '' } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'rowHTML');
  if (!canEdit) return '';
  const on = isOn(value);
  const inert = phase === 'readonly' ? ' aria-disabled="true" disabled' : phase === 'saving' ? ' aria-disabled="true" aria-busy="true"' : '';
  const sc = scope === 'sport' ? 'sport' : 'league';
  const comp = sc === 'sport' && competitionId ? ` data-obt-competition="${escHtml(competitionId)}"` : '';
  return `<div class="obt-block" data-obt-scope="${sc}"${comp}>`
    + `<div class="card ls-card"><button type="button" class="ls-row ls-row-switch" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${escHtml(OBT_COPY.label)}" data-obt-action="obt-toggle" data-obt-phase="${escHtml(phase)}"${inert}>`
    + `<span class="ls-row-label">${escHtml(OBT_COPY.label)}<span class="ob-switch-sub">${escHtml(OBT_COPY.sub)}</span></span><span class="cc-row-switch" data-on="${on ? 'true' : 'false'}" aria-hidden="true"></span></button></div>`
    + `<p class="ls-footer obt-helper">${escHtml(OBT_COPY.helper)}</p>`
    + `<p class="ls-footer obt-err" role="alert" aria-live="assertive"${phase === 'failed' ? '' : ' hidden'}>${phase === 'failed' ? escHtml(OBT_COPY.failed) : ''}</p></div>`;
}
