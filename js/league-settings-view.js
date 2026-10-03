/**
 * js/league-settings-view.js — LEAGUE SETTINGS, THE RENDERED HALF (SP-53, UN-345…349, DI-457…462 as amended by Amendment 1, 2026-09-30)
 * ============================================================================
 * `js/league-settings.js` is the PURE TEXT half: the copy for every outcome, the error classifier, the three wrappers and the small facts (Q-W, "(left)", the enable rules). It builds no
 * HTML and imports nothing (leaguesettingstest [11a]/[11c] pin both). THIS module is where that text becomes markup: the League Settings page, the name card, the accepting-members
 * switch, the Leave row and its footers, the three confirmation sheets (discard, leave / leave-and-archive, waive), the sole commissioner's hand-off sheet, and the few sentences the
 * Commissioner Panel borrows (the Invite line, the roster caption). It is pure in the same sense as js/account-exit.js and js/league-create.js: data in, markup or plain values out; no DOM,
 * no network, no storage, no clock. `app.js` is its DOM and network wiring and nothing else.
 *
 * `escHtml` IS A REQUIRED INJECTED DEPENDENCY on every renderer (CONVENTIONS #12). A league name and a member's display name are user data (SC-L14), so a caller that forgets it fails
 * LOUDLY instead of rendering `<img onerror>`. Rules this module keeps everywhere a name or a number reaches markup:
 *   - a name is placed ONLY as a text node or inside a DOUBLE-quoted attribute (`escHtml` does not escape the single quote), never in a single-quoted attribute, an inline handler, a
 *     `style` value or a JS string literal (leaguesettingsuitest pins the source for single-quoted attribute interpolation);
 *   - a number that can be ZERO is rendered through `num()` (`escHtml(0)` is the EMPTY STRING), never through escHtml;
 *   - every icon is `icon(name)` from the one family (an unknown name resolves to ''), never an emoji and never a hex colour or `rgb()`.
 *
 * THE RULE LIVES ON THE SERVER. Nothing here derives who may lead a league. The page is told `isCommissioner` (the cached role), the hand-off sheet is handed the SERVER's preflight row
 * (account_exit_leagues(), through auth.js) and renders it, and the leave footers carry the commissioner-only sentences CONDITIONALLY on that cached role so the client never says "you are
 * the only commissioner" on its own authority (CONVENTIONS #21, DI-461 acceptance 1). The hand-off picker is js/account-exit.js's `pickerHTML`, imported and used UNCHANGED: this module
 * builds the account-exit state that picker reads and nothing else about it.
 *
 * THE BLIND RULE. No renderer here is given, or can name, a pick: the leave sheet's picks sentence is a FACT (a boolean the caller derived from the leaver's OWN picks); nothing renders a
 * selection, a tiebreaker, a spread or another player's anything.
 */

import { actionSheetHTML, bannerHTML as lcBannerHTML, NAME_MAX } from './league-create.js';
import * as AX from './account-exit.js';
import { LS_COPY, leagueLabel, leaveFooterCopy, leaveSheetCopy, leaveBlockedSentence, canSaveName, trimmedName, weeksInProgressForMember } from './league-settings.js';

function requireEscHtml(escHtml, who) {
  if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an escHtml function — a league name or a member's name must never render unescaped`);
}
const noIcon = () => '';
/** A number for markup. `Number()`-coerced, so it can carry no markup and a ZERO survives (escHtml(0) is ''). */
const num = (n) => String(Number.isFinite(Number(n)) ? Number(n) : 0);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. COPY — the sentences the design input does not already give the core module (builder-authored, DI-457…462; D4)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const LSV_COPY = Object.freeze({
  title: 'League Settings',
  back: 'Back',
  sectionLeague: 'League',
  sectionNew: 'New members',
  sectionMore: 'More',
  nameLabel: 'League name',
  namePlain: 'Name',
  nameReadOnly: "Only the league's commissioner can change the name.",
  nameHelper: "Everyone in the league sees this name. They'll see the new one the next time they open the app.",
  clearName: 'Clear name',
  save: 'Save Name',
  saving: 'Saving…',
  saved: 'Saved',
  factSports: 'Sports',
  factRole: 'Your role',
  roleCommissioner: 'Commissioner',
  rolePlayer: 'Player',
  acceptLabel: 'Accepting new members',
  acceptChecking: 'Checking…',
  acceptLoadFailed: "Couldn't load this setting.",
  acceptFooter: "When this is off, your join code stops working until you turn it back on. People already in the league aren't affected.",
  tryAgain: 'Try Again',
  moreRules: 'League Rules',
  moreComm: 'Commissioner Panel',
  moreCommSecondary: 'Invite code, members, rules, SCRIBE and the rest',
  // discard (DI-458, mockup B8)
  discardTitle: 'Discard changes?',
  discardMessage: "Your new league name hasn't been saved.",
  discardDanger: 'Discard Changes',
  keepEditing: 'Keep Editing',
  // the hand-off sheet (DI-461)
  sheetTitle: 'New Commissioner',
  sheetClose: 'Close',
  handoffLead: 'Choose who takes over before you leave. You can stay on as co-commissioner until you\'re ready.',
  handoffFoot: "You can undo it from the Commissioner Panel while you're still in the league.",
  stayInLeague: 'Stay in League',
  // the waive confirmation (DI-462 section C)
  waiveTitle: 'Waive this obligation?',
  waiveDanger: 'Waive Obligation',
  waiveButton: 'Waive',
  reopenButton: 'Undo',
  waived: 'Obligation waived.',
  reopened: 'Obligation reopened.',
  // the Commissioner Panel (DI-458 / DI-459 / DI-462)
  inviteClosed: "New members are turned off, so this code won't work right now. Turn it back on in League Settings.",
  leftCaption: 'Left the league. To give them their old spot back: Restore, then New Code.',
  // A seat a commissioner REMOVED ("(removed)") cannot be issued a claim code either (issue_claim_code refuses an inactive seat), so its disabled codes say why in the same plain words.
  removedCaption: 'Removed from the league. To bring them back: Restore, then New Code.',
  // A seat removed while still LINKED to a sign-in: Restore alone brings the person back (the account is still attached), and New Code stays disabled for a linked row ("Unlink first"), so the
  // "Restore, then New Code" guidance would send the commissioner down a path that cannot work. This line says what Restore actually does.
  removedLinkedCaption: 'Removed from the league. Restore brings them back with the same sign-in.',
});

/** DI-458 straggler 1: the Invite card's helper line, for EVERY league (the pilot literal is gone). The name is plain text; the caller escapes it. */
export const inviteLineFor = (leagueName) => `Share this code with anyone joining ${leagueLabelOr(leagueName, 'your league')}.`;
function leagueLabelOr(name, fallback) { return String(name == null ? '' : name).trim() || fallback; }

/**
 * DI-459: the sentence the Invite card shows. `accepting` is the cached value: `false` -> the closed sentence; `true`, `null` (not loaded) or anything else -> today's line, so an unknown
 * value never claims the code is dead. Adds no control: copy only.
 */
export function inviteHelperText({ leagueName = '', accepting = null } = {}) {
  return accepting === false ? LSV_COPY.inviteClosed : inviteLineFor(leagueName);
}

/**
 * The roster caption under an INACTIVE row (DI-462 section B), by the label `departedLabel()` gave it: "(left)" gets the Restore-then-New-Code guidance; "(removed)" gets its sibling (a disabled
 * control says why, as text: a tooltip does not fire on touch). An active row gets none. Plain text.
 * `linked` is the seat's own `linked` flag (the boolean listLeagueMembers collapses `user_id` to): "Restore, then New Code" is only true for a seat with NO sign-in attached. A seat removed
 * while linked comes back with the same sign-in on Restore, and its New Code stays disabled, so it gets its own sentence. A "(left)" seat is never linked (the label requires it).
 */
export function inactiveRowCaption(label, { linked = false } = {}) {
  if (label === '(left)') return LSV_COPY.leftCaption;
  if (label === '(removed)') return linked === true ? LSV_COPY.removedLinkedCaption : LSV_COPY.removedCaption;
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. THE NAME CARD — pure view state, then markup (patched IN PLACE by app.js: the field is never re-rendered)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Every state of the name card (DI-458's table) as plain values. `phase`: 'idle' | 'saving' | 'saved'. `paused` wins over everything (the field is disabled WITH the reason).
 * Returns { state, enabled, label, busy, ok, fieldDisabled, count }.
 *   state    'paused' | 'saving' | 'saved' | 'empty' | 'pristine' | 'edited'
 *   enabled  true only for 'edited': the trimmed draft is non-empty AND differs from the stored name (core `canSaveName`)
 *   count    the draft's length in UTF-16 units — the unit `maxlength` enforces, so the counter can never disagree with the field
 */
export function nameCardView({ draft = '', stored = '', phase = 'idle', paused = false } = {}) {
  const count = String(draft == null ? '' : draft).length;
  const base = { enabled: false, label: LSV_COPY.save, busy: false, ok: false, fieldDisabled: false, count };
  if (paused) return { ...base, state: 'paused', fieldDisabled: true };
  if (phase === 'saving') return { ...base, state: 'saving', label: LSV_COPY.saving, busy: true, fieldDisabled: true };
  if (phase === 'saved') return { ...base, state: 'saved', label: LSV_COPY.saved, ok: true };
  if (trimmedName(draft) === '') return { ...base, state: 'empty' };
  return canSaveName(draft, stored) ? { ...base, state: 'edited', enabled: true } : { ...base, state: 'pristine' };
}

/**
 * The Save Name button's PARTS for a view, so the wiring patches the ONE button in place (class, disabled, inner markup) instead of rebuilding the card: the field, the caret and the keyboard
 * survive every state change. `className` is whole; `disabled` is `aria-disabled` + `disabled` (no press animation); `innerHTML` is escaped; `state` is the view's state name.
 */
export function nameButtonParts(view, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'nameButtonParts');
  const v = view || nameCardView();
  const className = `lc-btn lc-btn-primary ls-save${v.busy ? ' lc-btn-busy' : ''}${v.ok ? ' ls-btn-ok' : ''}`;
  const innerHTML = v.busy ? `<span class="lc-spin" aria-hidden="true"></span><span>${escHtml(v.label)}</span>`
    : v.ok ? `<span class="lc-btn-ic" aria-hidden="true">${icon('check')}</span><span>${escHtml(v.label)}</span>`
      : `<span>${escHtml(v.label)}</span>`;
  return { className, disabled: !v.enabled, innerHTML, state: v.state };
}

/** The Save Name button for a view. ONE fixed height in every state (`.lc-btn` is 50 px), so a state change never moves the layout. Disabled is `aria-disabled` + `disabled`: no press animation. */
export function nameButtonHTML(view, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'nameButtonHTML');
  const p = nameButtonParts(view, { escHtml, icon });
  const dis = p.disabled ? ' aria-disabled="true" disabled' : '';
  return `<button type="button" class="${p.className}" id="ls-name-save" data-ls-action="save-name" data-ls-state="${escHtml(p.state)}"${dis}>${p.innerHTML}</button>`;
}

/** The counter text, `{n} / 80`. */
export const nameCountText = (n) => `${num(n)} / ${NAME_MAX}`;

/**
 * The commissioner's name card, rendered ONCE (typing patches the counter, the clear control and the button in place; a repaint would drop the caret and the keyboard). No autofocus. Return
 * blurs and does not save. The font is 1.06rem (>= 16 px) so WKWebView never zooms on focus. The paused reason is a field note; the page already carries the one verbatim paused sentence.
 */
export function nameCardHTML({ name = '', paused = false } = {}, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'nameCardHTML');
  const view = nameCardView({ draft: name, stored: name, paused });
  const len = String(name == null ? '' : name).length;
  return `<div class="card ls-card ls-name-card" id="ls-name-card" data-ls-paused="${paused ? 'true' : 'false'}">
      <label class="lc-label" for="ls-name-input">${escHtml(LSV_COPY.nameLabel)}</label>
      <div class="lc-input${paused ? ' lc-input-disabled' : ''}">
        <input type="text" id="ls-name-input" class="lc-input-field" value="${escHtml(name || '')}" maxlength="${NAME_MAX}" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-describedby="ls-name-helper"${paused ? ' disabled' : ''}>
        <button type="button" class="lc-input-clear" id="ls-name-clear" data-ls-action="clear-name" aria-label="${escHtml(LSV_COPY.clearName)}"${len && !paused ? '' : ' hidden'}>${icon('clear')}</button>
      </div>
      <div class="lc-count" id="ls-name-count" aria-hidden="true">${escHtml(nameCountText(len))}</div>
      <div class="lc-helper ls-field-note" id="ls-name-helper">${escHtml(paused ? LS_COPY.renamePaused : LSV_COPY.nameHelper)}</div>
      ${nameButtonHTML(view, { escHtml, icon })}
    </div>`;
}

/** The player's read-only name row and its one-sentence reason (DI-458): no field, no chevron. */
export function nameReadOnlyHTML({ name = '' } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'nameReadOnlyHTML');
  return `<div class="card ls-card"><div class="ls-row ls-row-static"><span class="ls-row-label">${escHtml(LSV_COPY.namePlain)}</span><span class="ls-row-value">${escHtml(name || '')}</span></div></div>
    <div class="lc-helper ls-footer">${escHtml(LSV_COPY.nameReadOnly)}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. THE ACCEPTING-MEMBERS SWITCH (DI-459)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The switch row for a state: 'loading' | 'on' | 'off' | 'toggling' | 'failed' (the LOAD failed) | 'paused'. `value` is the last confirmed value (a toggle in flight keeps showing it: NO
 * optimistic flip). The whole row is the 48 px tap target; the shipped 40 by 24 switch (`.cc-row-switch`) is the control. Loading: a muted "Checking…" and an inert placeholder, no spinner.
 */
export function acceptingRowHTML({ phase = 'loading', value = null } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'acceptingRowHTML');
  const label = `<span class="ls-row-label">${escHtml(LSV_COPY.acceptLabel)}`;
  if (phase === 'loading') {
    return `<div class="ls-row ls-row-static" data-ls-accept="loading" aria-busy="true">${label}<span class="cc-row-secondary">${escHtml(LSV_COPY.acceptChecking)}</span></span><span class="cc-row-switch ls-switch-inert" aria-hidden="true"></span></div>`;
  }
  if (phase === 'failed') {
    return `<div class="ls-row ls-row-static" data-ls-accept="failed">${label}<span class="cc-row-secondary">${escHtml(LSV_COPY.acceptLoadFailed)}</span></span>`
      + `<button type="button" class="lc-btn lc-btn-text lc-btn-sm ls-inline-btn" data-ls-action="retry-accepting">${escHtml(LSV_COPY.tryAgain)}</button></div>`;
  }
  const on = value === true;
  // A toggle in flight is `aria-busy` + `aria-disabled` WITHOUT the `disabled` property, so VoiceOver focus stays on the control; only a paused league disables it outright.
  const inert = phase === 'paused' ? ' aria-disabled="true" disabled' : phase === 'toggling' ? ' aria-disabled="true"' : '';
  return `<button type="button" class="ls-row ls-row-switch" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${escHtml(LSV_COPY.acceptLabel)}" data-ls-action="toggle-accepting" data-ls-accept="${escHtml(phase)}"`
    + `${phase === 'toggling' ? ' aria-busy="true"' : ''}${inert}>${label}</span><span class="cc-row-switch" data-on="${on ? 'true' : 'false'}" aria-hidden="true"></span></button>`;
}

/** The footer under the switch card: the DI sentence, or the paused reason. */
export const acceptingFooterText = ({ paused = false } = {}) => (paused ? LS_COPY.acceptingPaused : LSV_COPY.acceptFooter);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. THE LEAVE GROUP (DI-460) — the red row and its footers
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The Leave row. `phase`: 'idle' | 'checking' (a commissioner's preflight is out: the group's one spinner, the label unchanged — nothing has been confirmed yet) | 'leaving' (the confirmed
 * call is out: "Leaving…" and the spinner). Either busy phase makes the row inert. `blockedWeeks` (Q-W (a)) is the number of the leaver's OWN in-progress weeks: above zero the row is DIMMED
 * (`aria-disabled`, no press animation, never hidden) and the footer says why. The row is danger-red by token (`--loss`), 48 px, no chevron.
 */
export function leaveRowHTML({ phase = 'idle', blockedWeeks = 0 } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'leaveRowHTML');
  const busy = phase === 'checking' || phase === 'leaving';
  const blocked = Number(blockedWeeks) > 0;
  const dis = busy || blocked ? ' aria-disabled="true"' : '';
  const dis2 = busy ? ' disabled' : '';
  return `<button type="button" class="ls-row ls-row-danger${blocked ? ' ls-row-dim' : ''}" id="ls-leave-row" data-ls-action="leave"${dis}${dis2}${busy ? ' aria-busy="true"' : ''}>`
    + `<span class="ls-row-label">${escHtml(phase === 'leaving' ? LS_COPY.leaving : LS_COPY.leaveRow)}</span>${busy ? '<span class="lc-spin" aria-hidden="true"></span>' : ''}</button>`;
}

/**
 * The footers under the Leave row, as markup: Q-W's reason (only when blocked) directly under the row, then the "everyone" sentence, the commissioner-only conditional sentence (absent for a
 * player, so the client never derives "sole commissioner" or "only member"), and the muted Delete Account pointer.
 */
export function leaveFooterHTML({ leagueName = '', isCommissioner = false, blockedWeeks = 0 } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'leaveFooterHTML');
  const f = leaveFooterCopy({ leagueName, isCommissioner });
  const blocked = Number(blockedWeeks) > 0 ? `<div class="lc-helper ls-footer ls-footer-reason" id="ls-leave-reason">${escHtml(leaveBlockedSentence(blockedWeeks))}</div>` : '';
  const extra = f.commissionerExtra ? ` ${escHtml(f.commissionerExtra)}` : '';
  return `${blocked}<div class="lc-helper ls-footer" id="ls-leave-footer">${escHtml(f.everyone)}${extra}</div><div class="lc-helper ls-footer ls-footer-muted">${escHtml(f.muted)}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. THE PAGE (DI-457) — one body, patched in place afterwards
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A banner in the New League family (`.lc-banner`): red and persistent for an error (`role="alert"`), gold for a calm note. One optional action (`Reload`). Used for the failure slot.
 */
export function pageBannerHTML(kind, text, { cta = null, escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'pageBannerHTML');
  return lcBannerHTML(kind === 'err' ? 'err' : 'info', text, { escHtml, icon, cta });
}

/** The paused sentence, in the warning family with the `pause` icon (DI-457 row 2): the caller passes PAUSED_LEAGUE_BANNER_TEXT verbatim. */
export function pausedBannerHTML(text, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'pausedBannerHTML');
  return `<div class="lc-banner lc-banner-info ls-paused" role="status" data-ls-paused-banner="true"><span class="lc-banner-ic" aria-hidden="true">${icon('pause')}</span><span>${escHtml(text)}</span></div>`;
}

/**
 * The whole League Settings view (header + body). `ctx`:
 *   leagueName, isCommissioner (the cached role: the page shows a commissioner's controls only when true; a player's DOM has NO commissioner control), paused (leagues.status),
 *   pausedText (PAUSED_LEAGUE_BANNER_TEXT), sportsLabel (comma-joined labels), accepting ({ phase, value } for the switch's first paint), blockedWeeks (Q-W: own in-progress weeks).
 * Content, top to bottom (DI-457): paused sentence (when paused), the failure-banner slot, League (name card + facts), New members (commissioner only), More (pointers), Leave.
 */
export function settingsPageHTML(ctx = {}, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'settingsPageHTML');
  const c = ctx || {};
  const name = String(c.leagueName == null ? '' : c.leagueName);
  const isComm = c.isCommissioner === true;
  const paused = c.paused === true;
  const chev = `<span class="ls-row-chevron" aria-hidden="true">${icon('chevronRight')}</span>`;
  const nameBlock = isComm ? nameCardHTML({ name, paused }, { escHtml, icon }) : nameReadOnlyHTML({ name }, { escHtml });
  const facts = `<div class="card ls-card ls-facts"><div class="ls-row ls-row-static"><span class="ls-row-label">${escHtml(LSV_COPY.factSports)}</span><span class="ls-row-value">${escHtml(c.sportsLabel || '')}</span></div>`
    + `<div class="ls-row ls-row-static"><span class="ls-row-label">${escHtml(LSV_COPY.factRole)}</span><span class="ls-row-value">${escHtml(isComm ? LSV_COPY.roleCommissioner : LSV_COPY.rolePlayer)}</span></div></div>`;
  const accept = isComm
    ? `<div class="ls-group" data-ls-group="new-members"><div class="admin-section-title">${escHtml(LSV_COPY.sectionNew)}</div>`
      + `<div class="card ls-card" id="ls-accept-card">${acceptingRowHTML(c.accepting || { phase: 'loading', value: null }, { escHtml })}</div>`
      + `<div id="ls-accept-note" aria-live="polite"></div>`
      + `<div class="lc-helper ls-footer" id="ls-accept-footer">${escHtml(acceptingFooterText({ paused }))}</div></div>`
    : '';
  const commRow = isComm
    ? `<button type="button" class="ls-row ls-row-nav" data-ls-action="open-comm" aria-label="${escHtml(LSV_COPY.moreComm)}"><span class="ls-row-label">${escHtml(LSV_COPY.moreComm)}<span class="cc-row-secondary">${escHtml(LSV_COPY.moreCommSecondary)}</span></span>${chev}</button>`
    : '';
  const more = `<div class="ls-group" data-ls-group="more"><div class="admin-section-title">${escHtml(LSV_COPY.sectionMore)}</div><div class="card ls-card">`
    + `<button type="button" class="ls-row ls-row-nav" data-ls-action="open-rules" aria-label="${escHtml(LSV_COPY.moreRules)}"><span class="ls-row-label">${escHtml(LSV_COPY.moreRules)}</span>${chev}</button>${commRow}</div></div>`;
  const leave = `<div class="ls-group" data-ls-group="leave"><div class="card ls-card" id="ls-leave-card">${leaveRowHTML({ blockedWeeks: c.blockedWeeks }, { escHtml })}</div>`
    + `<div id="ls-leave-foot">${leaveFooterHTML({ leagueName: name, isCommissioner: isComm, blockedWeeks: c.blockedWeeks }, { escHtml })}</div></div>`;
  return `<div class="league-page-header ls-header">
      <button type="button" class="league-page-back" data-ls-action="back" aria-label="${escHtml(LSV_COPY.back)}">${icon('chevronLeft')}</button>
      <h2 class="league-page-title" id="ls-title" tabindex="-1">${escHtml(LSV_COPY.title)}</h2>
    </div>
    <div class="league-page-body ls-body" data-ls-role="${isComm ? 'commissioner' : 'player'}">
      ${paused ? pausedBannerHTML(c.pausedText || '', { escHtml, icon }) : ''}
      <div id="ls-banner" aria-live="polite"></div>
      <div class="ls-group" data-ls-group="league"><div class="admin-section-title">${escHtml(LSV_COPY.sectionLeague)}</div><div class="ls-stack"><div class="ls-name-block">${nameBlock}</div>${facts}</div></div>
      ${accept}
      ${more}
      ${leave}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 6. THE CONFIRMATION SHEETS — all through the ONE action-sheet builder (league-create.js `actionSheetHTML`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const LS_ACTION = 'data-ls-action';

/** The discard prompt (Back or swipe-back with an unsaved name). Scrim tap = Keep Editing. */
export function discardSheetHTML({ escHtml } = {}) {
  requireEscHtml(escHtml, 'discardSheetHTML');
  return actionSheetHTML({
    escHtml, titleId: 'ls-discard-title', title: LSV_COPY.discardTitle, message: LSV_COPY.discardMessage, scrimAction: 'keep-editing', actionAttr: LS_ACTION,
    danger: { label: LSV_COPY.discardDanger, action: 'discard' }, cancel: { label: LSV_COPY.keepEditing, action: 'keep-editing' },
  });
}

/**
 * The leave confirmation. `archive` selects the league-of-one sheet ("Leave and archive"), whose confirm is the ONLY control that passes `confirmArchive: true` (SC-L9). Otherwise the plain
 * sheet, with the unsettled-obligation sentence only when `obligationCount` > 0 and the picks sentence only when the leaver has picks in an OPEN week (Q-W (a): a locked or live week blocks
 * the leave outright). Scrim tap = Cancel. NO typed confirmation: leaving is reversible.
 */
export function leaveSheetHTML({ leagueName = '', obligationCount = 0, openWeekPicks = false, archive = false } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'leaveSheetHTML');
  const copy = leaveSheetCopy({ leagueName, obligationCount, openWeekPicks, archive });
  return actionSheetHTML({
    escHtml, titleId: 'ls-leave-title', title: copy.title, message: copy.message, scrimAction: 'cancel', actionAttr: LS_ACTION,
    danger: { label: copy.danger, action: archive ? 'confirm-leave-archive' : 'confirm-leave' }, cancel: { label: copy.cancel, action: 'cancel' },
  });
}

/** The waive confirmation (Comm Obligations card). Names are plain text through escHtml; nothing is deleted and the sheet says so. */
export function waiveSheetHTML({ payerName = '', recipientName = '', weekLabel = '' } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'waiveSheetHTML');
  const payer = leagueLabelOr(payerName, 'Someone');
  const recipient = leagueLabelOr(recipientName, 'someone');
  const forWhat = String(weekLabel == null ? '' : weekLabel).trim();
  const message = `${payer} owes ${recipient}${forWhat ? ` for ${forWhat}` : ''}. It stays on the league's record as Waived. Nothing is deleted.`;
  return actionSheetHTML({
    escHtml, titleId: 'ls-waive-title', title: LSV_COPY.waiveTitle, message, scrimAction: 'cancel', actionAttr: LS_ACTION,
    danger: { label: LSV_COPY.waiveDanger, action: 'confirm-waive' }, cancel: { label: LS_COPY.cancel, action: 'cancel' },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 7. THE HAND-OFF SHEET (DI-461) — the existing picker, reused unchanged
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The account-exit state the picker reads, built from the SERVER's preflight row. `row` is `getAccountExitLeagues()`'s row for THIS league (`{ leagueId, leagueName, pilot, blocks,
 * autoArchive, candidates: [{ memberId, displayName }] }`); the state opens on the picker step. The row is cloned with `pilot: true` for the picker's sake only: that is the flag that makes
 * `pickerHTML` omit its Archive control, and no archive is offered anywhere on this path, pilot or not (DI-461: a league of one never sees a picker, and a blocked league is handed over, never
 * archived). The real `pilot` flag is read separately for the pilot sentence.
 */
export function handOffState(row, { leagueName = '' } = {}) {
  const r = row || {};
  const id = String(r.leagueId || '');
  const name = r.leagueName || leagueName || '';
  const picker = { leagueId: id, leagueName: name, pilot: true, blocks: true, autoArchive: false, candidates: Array.isArray(r.candidates) ? r.candidates : [] };
  let st = AX.createInitialState({ commissionerLeagues: [{ leagueId: id, leagueName: name }] });
  st = AX.reduce(st, { type: 'preflight-ok', rows: [picker] });
  st = AX.reduce(st, { type: 'open-picker', leagueId: id });
  return st;
}

/** The sheet header: the title (focused on open, so VoiceOver reads it first) and a 44 px close. */
export function handOffNavHTML({ escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'handOffNavHTML');
  return `<div class="ax-nav"><div class="ax-nav-title" id="ls-sheet-title" tabindex="-1">${escHtml(LSV_COPY.sheetTitle)}</div>`
    + `<button type="button" class="ax-nav-btn ax-nav-close" id="ls-sheet-close" data-ls-action="sheet-close" aria-label="${escHtml(LSV_COPY.sheetClose)}"><span class="ax-nav-ic" aria-hidden="true">${icon('close')}</span></button></div>`;
}

/**
 * The hand-off sheet's body. `h`: { phase: 'pick' | 'handed', leagueName, pilot, axState (handOffState), handedName, notice }.
 *   pick    the lead sentences, the stale notice (when set), the pilot sentence (when the SERVER says pilot), then js/account-exit.js `pickerHTML(axState)` byte for byte, then the undo footer.
 *           With no candidates the picker says `pickerEmpty` and nothing can proceed (the pilot always blocks, D-6).
 *   handed  `handedLine`, and the two outcomes: the red Leave League and Stay in League. Staying is a real outcome (the hand-off is reversible from Comm while the giver is a co-commissioner).
 */
export function handOffBodyHTML(h = {}, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'handOffBodyHTML');
  const league = leagueLabel(h.leagueName);
  if (h.phase === 'handed') {
    const err = h.error ? `<div class="ls-sheet-actions">${lcBannerHTML('err', h.error, { escHtml, icon })}</div>` : '';
    return `<div class="ls-sheet-body" data-ls-sheet="handed">
        <div class="ls-handed" role="status"><span class="ls-handed-ic" aria-hidden="true">${icon('check')}</span><span class="ls-handed-text">${escHtml(AX.handedLine(h.handedName, league))}</span></div>
        ${err}
        <div class="ls-sheet-actions">
          <button type="button" class="lc-btn ls-btn-danger" data-ls-action="leave-after-handoff">${escHtml(LS_COPY.leaveRow)}</button>
          <button type="button" class="lc-btn lc-btn-text" data-ls-action="stay">${escHtml(LSV_COPY.stayInLeague)}</button>
        </div>
      </div>`;
  }
  const notice = h.notice ? lcBannerHTML('info', h.notice, { escHtml, icon }) : '';
  const pilot = h.pilot === true ? `<p class="ls-sheet-pilot">${escHtml(AX.AX_COPY.pilotNote)}</p>` : '';
  const picker = h.axState ? AX.pickerHTML(h.axState, { escHtml, icon }) : '';
  return `<div class="ls-sheet-body" data-ls-sheet="pick">
      <div class="ls-sheet-intro"><h3 class="ls-sheet-lead">${escHtml(`You're the only commissioner of ${league}.`)}</h3><p class="ls-sheet-lede">${escHtml(LSV_COPY.handoffLead)}</p>${notice}${pilot}</div>
      <div class="ls-sheet-picker" id="ls-sheet-picker">${picker}</div>
      <p class="ls-sheet-foot">${escHtml(LSV_COPY.handoffFoot)}</p>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 8. SMALL FACTS THE WIRING NEEDS (pure)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Q-W (a) — THE ONE NAMED PREDICATE (Drew's confirmation is pending; the default in force is (a)). Leaving is blocked while a week the person has picks in is locked or live, and this is the
 * ONLY place the client decides it: the Leave row's dimming, its footer sentence and the "in progress" weeks all read this list (leaguesettingsuitest pins that app.js never calls the core
 * predicate directly). Their OWN picks only (the blind rule). To flip the ruling to (b), set `Q_W_LEAVE_BLOCKS_MID_WEEK` to false (the client then never blocks) AND strike the server's
 * `week_in_progress` refusal in a new migration; the leave sheet's picks sentence changes with it. `enforce` is injectable so the flip itself is testable.
 */
export const Q_W_LEAVE_BLOCKS_MID_WEEK = true;
export function leaveBlockedWeekIds({ weeks = [], picks = [], games = null, memberId = '', now = new Date(), enforce = Q_W_LEAVE_BLOCKS_MID_WEEK } = {}) {
  if (enforce !== true) return [];
  // G-6: the seven-day bound is anchored on the week's FIRST KICKOFF (or its lock time, whichever is later), and the app's week objects carry neither a `firstKickoff` nor a `picksLockAt`, so the
  // games must come through here or every locked/live week reads "no anchor", which the server's coalesce reads as lapsed, and the Leave row would never dim (integration MC-1, 2026-10-01).
  return weeksInProgressForMember({ weeks, picks, games, memberId, now });
}

/**
 * DI-460's count of the leaver's UNSETTLED obligations: non-voided, the person is payer or recipient, status unpaid or pending (an absent status reads as unpaid, CONVENTIONS #10). The
 * CALLER hands in the current-season list (demo weeks already excluded) plus, for the pilot, the 2K25 carryover rows (they are real debts). A number that can be zero: it is compared and
 * rendered through `num`, never `escHtml`.
 */
export function openObligationCount(obligations, playerId) {
  if (!playerId || !Array.isArray(obligations)) return 0;
  let n = 0;
  for (const ob of obligations) {
    if (!ob || ob.voided === true) continue;
    if (ob.payerPlayerId !== playerId && ob.recipientPlayerId !== playerId) continue;
    const status = ob.status == null || ob.status === '' ? 'unpaid' : ob.status;
    if (status === 'unpaid' || status === 'pending') n += 1;
  }
  return n;
}

/**
 * SC-L13 — whether the Comm Obligations card shows `Waive` on a row. The bound is a UI bound and is stated as one (the server lets a commissioner set any status): the actor is a commissioner,
 * the debt is open (unpaid or pending), a party has LEFT (`payerActive` / `recipientActive` === false), and the actor is NOT the payer (a commissioner does not forgive their own debt from
 * this card; a commissioner who is the RECIPIENT may). A non-commissioner never gets one.
 */
export function canShowWaive({ isCommissioner = false, status = 'unpaid', payerActive = true, recipientActive = true, actingPlayerId = '', payerId = '' } = {}) {
  if (isCommissioner !== true) return false;
  if (status !== 'unpaid' && status !== 'pending') return false;
  if (payerActive !== false && recipientActive !== false) return false;
  if (actingPlayerId && payerId && actingPlayerId === payerId) return false;
  return true;
}

/**
 * The sibling controls the Comm Obligations card adds BESIDE the shared `obligationActionsHTML` output (which stays byte-identical, SP-56's golden): `Waive` (ghost) when `showWaive`; on a
 * waived row, a ghost `Undo` for a commissioner. A player gets nothing. `obId` is an id (escaped); the two actions ride `data-ob-action`.
 */
// NOTE `obId` deliberately has NO default: xsstest's classifier reads a destructured default (`obId = ''`) as an assignment of a string literal and so calls an UNWRAPPED `${obId}` safe — a
// default here would let the escape on `data-ob-id` be removed with every suite green (security C-U2). escHtml(undefined) is '' either way.
export function waiveControlsHTML({ obId, status = 'unpaid', showWaive = false, isCommissioner = false } = {}, { escHtml } = {}) {
  requireEscHtml(escHtml, 'waiveControlsHTML');
  if (showWaive === true) {
    return `<button type="button" class="btn btn-ghost btn-sm ml-sm ob-waive-btn" data-ob-id="${escHtml(obId)}" data-ob-action="waive">${escHtml(LSV_COPY.waiveButton)}</button>`;
  }
  if (status === 'waived' && isCommissioner === true) {
    return `<button type="button" class="btn btn-ghost btn-sm ml-sm ob-waive-btn" data-ob-id="${escHtml(obId)}" data-ob-action="reopen">${escHtml(LSV_COPY.reopenButton)}</button>`;
  }
  return '';
}

/**
 * Which page-level failure banner a wrapper outcome owes, as `{ kind, text, cta }` — or null when the outcome is a success or a calm note. `copy` is one of the core mappers' results
 * (`renameOutcomeCopy` / `leaveOutcomeCopy` / `acceptingOutcomeCopy`): persistent errors become the red banner, a Reload outcome carries the Reload action.
 */
export function bannerSpecFor(copy) {
  if (!copy || copy.tone !== 'error') return null;
  return { kind: 'err', text: copy.text, cta: copy.reload ? { id: 'ls-banner-reload', label: LS_COPY.reload } : null };
}
