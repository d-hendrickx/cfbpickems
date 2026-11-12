/**
 * js/invite-join.js — Invite and join (D2 lane 1, UN-506 / PF-506, DI-724..731; Drew's T-29).
 * ==========================================================================================================================
 * The need: a friend must know WHICH league they are joining before they join it, and a commissioner must have ONE place that shows the code, shares it, says whether the league is open to new
 * people, and gets a fresh code. This module is the pure half: the exact words, the states, and the markup of the three sheets. js/app.js owns the layer, the RPCs and the routing.
 *
 *   1. THE JOIN CONFIRMATION (DI-725, 726, 728, 731) — what an invitee sees AFTER the preview and BEFORE anything is written: the league's name and sports (the only things `invite_preview`
 *      returns, migration 0065), the code, one sentence, and Join League (the ONLY way in: one visible tap, never automatic) / Not Now. Its states: loading (a skeleton name line), valid, already a
 *      member, invalid (one sentence for an unknown, a replaced and a closed code: nothing says which), throttled, offline.
 *   2. THE MEMBERSHIP CONFIRMATION (DI-727) — a compact sheet, not a toast: a check, "You're in {league}", "Your commissioner is {name}.", Set Up My Profile (primary) and Go to {league}.
 *   3. THE COMMISSIONER'S INVITE SHEET (DI-729) — the league name, the code (copy), Share Invite, the Accepting new members switch (the League Settings row, `acceptingRowHTML`, NOT a copy), a
 *      "joined so far" count, and Get a new code (an action sheet that says what it costs).
 *   4. THE WORDS every state uses, and the share message (DI-730, built by league-create.js's `inviteMessage`, the one place that knows the link).
 *
 * Every sheet rides the shared action-sheet shell (`.lc-scrim` + `.lc-actionsheet`, the ONE builder's CSS) and every control carries `data-ls-action`, so app.js's one action-sheet layer routes them.
 * Each builder comes in two halves: `…InnerHTML` (the sheet's groups: what app.js PATCHES in place when a state changes, so the sheet never replays its entrance) and the wrapper.
 * League names, sports and commissioner names are USER DATA: every one passes the injected `escHtml`. Nothing here touches the network, the storage seam or the document.
 * Imports: league-create.js (the code helpers and the action-sheet builder), league-settings-view.js (the switch row), submit-state.js (the shared submission control) and icons.js.
 */
import { normalizeInviteCode, formatInviteCode, actionSheetHTML } from './league-create.js';
import { acceptingRowHTML } from './league-settings-view.js';
import { submitControlHTML } from './submit-state.js';
import { icon as svgIcon } from './icons.js';

/** The exact words (DI-725..731). Nothing here is user data. */
export const IJ_COPY = Object.freeze({
  // the join confirmation
  sentence: "You'll be a player in this league. Your picks, chat and standings here stay separate from anything else you're in.",
  join: 'Join League',
  notNow: 'Not Now',
  close: 'Close',
  cancel: 'Cancel',
  tryAgain: 'Try Again',
  codeLabel: 'Code',
  checking: 'Checking the code…',
  unnamed: 'Join this league?',
  unnamedLine: "We couldn't look up this league's name right now. You can still join it.",   // F-2: a throttled preview never takes the Join control away (join_league is the real gate)
  invalid: "That code doesn't match an open league. Check it with whoever invited you. They can get a fresh one from Invite Friends.",
  throttled: 'Too many tries. Wait a few minutes and try again.',
  offline: "No connection. Try again when you're back online.",
  joinFailed: "Couldn't join. Nothing was changed. Try again.",
  linkExpired: 'That invite link has expired. Ask whoever invited you to send it again.',
  // the membership confirmation
  inTitle: (name) => `You're in ${name}`,
  commissionerLine: (name) => `Your commissioner is ${name}.`,
  setUp: 'Set Up My Profile',
  goTo: (name) => `Go to ${name}`,
  // the commissioner's Invite sheet
  inviteTitle: 'Invite Friends',
  leagueCode: 'League code',
  codeLoading: 'Loading the code',
  copyCode: 'Copy Code',
  codeCopied: 'Code copied',
  share: 'Share Invite',
  linkCopied: 'Invite link copied',
  closedLine: "New members can't join right now.",
  joinedSoFar: 'Joined so far',
  joinedCount: (n) => `${n} ${n === 1 ? 'player' : 'players'}`,
  inviteHelper: 'Anyone with this code or link can join while this is on. Turn it off to stop new members.',
  codeReady: 'New code ready',
  navJoin: 'Join League',
  navJoined: 'Joined',
  done: 'Done',
  reassure: "Ask your commissioner for this \u2014 it's how they add you, not a password.",
  codeRule: 'Codes use letters and the numbers 2 to 9. A 0 or 1 is read as O or I.',
  codeFieldLabel: 'Invite code',
  continue: 'Continue',
  joinSaved: 'Joined',
  joinTitle: (name) => `Join ${name}?`,
  getNew: 'Get a new code',
  rotateTitle: 'Get a new code?',
  rotateMessage: 'The old code and link stop working right away. People already in the league stay.',
  rotateConfirm: 'Get New Code',
  rotateFailed: "Couldn't get a new code. Your old code still works. Try again.",
  codeLoadFailed: "Couldn't load the code.",
  // the code field
  paste: 'Paste',
  pasteFailed: "Couldn't read the clipboard. Paste the code into the field.",
});

const ORDINALS = ['', 'a second', 'a third', 'a fourth', 'a fifth', 'a sixth', 'a seventh', 'an eighth', 'a ninth', 'a tenth'];
/** "You're in 1 league already. This adds a second." / "You're in 2 leagues already. This adds a third." — the sentence is only there when there is at least one. */
export function alreadyInLine(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  if (k < 1) return '';
  return `You're in ${k} ${k === 1 ? 'league' : 'leagues'} already. This adds ${ORDINALS[k] || 'one more'}. Home shows all of them together; picks, chat and standings stay separate.`;
}
export const alreadyMemberLine = (name) => `You're already in ${name}.`;

/** The commissioner's display name from a roster read, or '' when none can be named (a roster that could not be read leaves the line out). The first active commissioner with a name. */
export function commissionerNameOf(members) {
  const list = Array.isArray(members) ? members : [];
  const c = list.find((m) => m && m.role === 'commissioner' && m.active !== false && typeof m.displayName === 'string' && m.displayName.trim());
  return c ? c.displayName.trim() : '';
}

/** The sports as one line ("College Football · NFL"). `labelOf` turns a sport code into its member-facing label; an unknown code is shown as given, never dropped. */
export function sportsLine(sports, labelOf) {
  const list = Array.isArray(sports) ? sports.filter((s) => typeof s === 'string' && s) : [];
  const f = typeof labelOf === 'function' ? labelOf : (s) => s;
  return list.map((s) => { try { return String(f(s) || s); } catch { return s; } }).join(' · ');
}

/** The inline sentence under the code FIELD for a typed or link code (the field keeps its value and its focus; the confirmation sheet only opens for a code that is real). '' when there is none. */
export function fieldErrorCopy(kind) {
  if (kind === 'invalid') return IJ_COPY.invalid;
  if (kind === 'throttled') return IJ_COPY.throttled;
  if (kind === 'offline') return IJ_COPY.offline;
  return '';
}

const need = (escHtml, who) => { if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12)`); return escHtml; };
const ACT = 'data-ls-action';
/** The sheet shell every builder here fills: the dimmed scrim (a tap is the safe choice) and the sheet (a grab handle, a nav bar, a body: the approved mockup's sheet, d2-invite-join.html). */
function wrap(inner, { phase, scrim = 'cancel', cls = '', escHtml }) {
  return `<div class="lc-scrim" ${ACT}="${escHtml(scrim)}"></div>
    <div class="lc-actionsheet ij-sheet${cls ? ` ${cls}` : ''}" role="dialog" aria-modal="true" aria-labelledby="ij-title" data-ij-phase="${escHtml(phase)}">${inner}</div>`;
}
const icn = (name) => `<span class="ij-ic" aria-hidden="true">${svgIcon(name)}</span>`;
/** The grab handle and the nav bar: an optional text button left and right, the title centred. `titleId` marks the node that is the dialog's label and first focus when the title itself is the heading. */
const chrome = (escHtml, { left = '', title, right = '', titleId = '' }) => `<div class="ij-grab" aria-hidden="true"></div>
      <div class="ij-nav"><span class="ij-nav-l">${left}</span><div class="ij-nav-t"${titleId ? ` id="${titleId}" tabindex="-1"` : ''}>${escHtml(title)}</div><span class="ij-nav-r">${right}</span></div>`;
const navBtn = (escHtml, label, right = false) => `<button type="button" class="ij-nav-btn${right ? ' ij-nav-btn--r' : ''}" ${ACT}="cancel">${escHtml(label)}</button>`;
const body = (html, cls = '') => `<div class="ij-body${cls ? ` ${cls}` : ''}">${html}</div>`;
const hero = (escHtml, { icon = 'playersGroup', tone = 'gold', titleHTML, sub = '' }) => `<div class="ij-hero"><div class="ij-seal ij-seal--${tone}" aria-hidden="true">${svgIcon(icon)}</div>${titleHTML}${sub ? `<p class="ij-hero-s">${escHtml(sub)}</p>` : ''}</div>`;
const heroTitle = (escHtml, text, extra = '') => `<h2 class="ij-hero-t" id="ij-title" tabindex="-1"${extra}>${escHtml(text)}</h2>`;
const card = (html, cls = '') => `<div class="ij-card${cls ? ` ${cls}` : ''}">${html}</div>`;
const row = (escHtml, label, valueHTML, rest = '') => `<div class="ij-row"><span class="ij-row-n">${escHtml(label)}</span><span class="ij-row-v"${rest}>${valueHTML}</span></div>`;
const banner = (escHtml, tone, text, { id = '', role = '', icon = tone === 'err' ? 'warning' : 'info' } = {}) => `<div class="ij-banner ij-banner--${tone}"${id ? ` id="${id}" tabindex="-1"` : ''}${role ? ` role="${role}"${role === 'alert' ? ' aria-live="assertive"' : ''}` : ''}>${icn(icon)}<span>${escHtml(text)}</span></div>`;
const helper = (escHtml, text, extra = '') => `<p class="ij-helper"${extra}>${escHtml(text)}</p>`;
const footer = (html) => `<div class="ij-footer">${html}</div>`;
const textBtn = (escHtml, label, action, cls = '') => `<button type="button" class="btn btn-ghost btn-block ij-text${cls ? ` ${cls}` : ''}" ${ACT}="${action}">${escHtml(label)}</button>`;

// ═══ 1. THE JOIN CONFIRMATION ════════════════════════════════════════════════════════════

/** The phase a join confirmation shows, from what the preview said. `r` is `{ ok, error, ... }` from the preview call or null for "could not ask". */
export function joinPhaseOf(r) {
  if (!r) return 'offline';
  if (r.ok === true) return r.alreadyMember === true ? 'already' : 'valid';
  if (r.error === 'invite_throttled') return 'throttled';
  return 'invalid';
}

/**
 * The sheet's inside (frames 3 and 4 of d2-invite-join.html). `m`: `phase` ('loading' | 'valid' | 'already' | 'invalid' | 'throttled' | 'offline'), `code` (the normalized 8 characters), `leagueName`, `sports`
 * (codes), `memberships` (how many leagues the person is already in: with one or more the banner of frame 4 replaces the code row and the sentence), `note` (a one-off refusal at Join time), `unnamed` (a throttled
 * lookup: the name is not known, and the sheet says so in one line and keeps the Join control).
 * The heading is the hero's "Join {league}?" (the sheet's first focus); the nav bar's title is the fixed "Join League". League names, sports and commissioner names are user data: every one is escaped.
 */
export function joinConfirmInnerHTML(m = {}, { escHtml, labelOf = null } = {}) {
  need(escHtml, 'joinConfirmInnerHTML');
  const code = normalizeInviteCode(m.code);
  const name = String(m.leagueName || '');
  const nav = chrome(escHtml, { title: IJ_COPY.navJoin });
  const codeRow = code ? card(row(escHtml, IJ_COPY.codeLabel, `<span class="ij-code-v" aria-label="${escHtml(IJ_COPY.codeLabel)} ${escHtml(code.split('').join(' '))}">${escHtml(formatInviteCode(code))}</span>`)) : '';
  switch (m.phase) {
    case 'loading':
      return nav + body(`<div class="ij-hero"><div class="ij-seal ij-seal--gold" aria-hidden="true">${svgIcon('playersGroup')}</div><h2 class="ij-hero-t" id="ij-title" tabindex="-1" aria-busy="true"><span class="ij-skel feed-skel-line feed-skel-line--wide" aria-hidden="true"></span><span class="sr-only">${escHtml(IJ_COPY.checking)}</span></h2></div>${codeRow}`)
        + footer(textBtn(escHtml, IJ_COPY.notNow, 'cancel'));
    case 'valid': {
      const sports = sportsLine(m.sports, labelOf);
      const already = alreadyInLine(m.memberships);
      return nav + body(`${hero(escHtml, { titleHTML: heroTitle(escHtml, name ? IJ_COPY.joinTitle(name) : IJ_COPY.unnamed), sub: sports })}${m.unnamed ? helper(escHtml, IJ_COPY.unnamedLine) : ''}
        ${already ? banner(escHtml, 'info', already) : `${codeRow}${helper(escHtml, IJ_COPY.sentence, ' style="text-align:center"')}`}${m.note ? banner(escHtml, 'err', m.note, { role: 'alert' }) : ''}`)
        + footer(`${submitControlHTML({ idleLabel: IJ_COPY.join, action: 'ij-join', extraClass: 'btn-primary btn-block' })}${textBtn(escHtml, IJ_COPY.notNow, 'cancel')}`);
    }
    case 'already':
      return nav + body(hero(escHtml, { titleHTML: heroTitle(escHtml, alreadyMemberLine(name)) }) + codeRow)
        + footer(`<button type="button" class="btn btn-primary btn-block ij-go" ${ACT}="ij-go">${escHtml(IJ_COPY.goTo(name))}</button>${textBtn(escHtml, IJ_COPY.close, 'cancel')}`);
    case 'throttled':
      return nav + body(banner(escHtml, 'err', IJ_COPY.throttled, { id: 'ij-title', role: 'alert' }) + codeRow) + footer(textBtn(escHtml, IJ_COPY.close, 'cancel'));
    case 'offline':
      return nav + body(banner(escHtml, 'err', IJ_COPY.offline, { id: 'ij-title', role: 'alert' }) + codeRow)
        + footer(`<button type="button" class="btn btn-primary btn-block ij-retry" ${ACT}="ij-retry">${escHtml(IJ_COPY.tryAgain)}</button>${textBtn(escHtml, IJ_COPY.close, 'cancel')}`);
    default:   // 'invalid': one sentence for an unknown, a replaced and a closed code
      return nav + body(banner(escHtml, 'err', IJ_COPY.invalid, { id: 'ij-title', role: 'alert' })) + footer(textBtn(escHtml, IJ_COPY.close, 'cancel'));
  }
}
export function joinConfirmHTML(m = {}, deps = {}) {
  const escHtml = need(deps.escHtml, 'joinConfirmHTML');
  const phase = ['loading', 'valid', 'already', 'throttled', 'offline'].includes(m.phase) ? m.phase : 'invalid';
  return wrap(joinConfirmInnerHTML({ ...m, phase }, deps), { phase, escHtml });
}

/**
 * The code FORM as a sheet (frame 5): a grab handle, "Cancel | Join League", then the form app.js built (the field with its Paste button, the error banner, the rule line, Continue). `formHTML` and `noteHTML`
 * are finished, escaped fragments from app.js (the form is one markup in two hosts); this only frames them.
 */
export function formSheetHTML({ formHTML = '', noteHTML = '' } = {}, { escHtml } = {}) {
  need(escHtml, 'formSheetHTML');
  return `<div class="lc-scrim" data-ij-close></div>
    <div class="lc-actionsheet ij-sheet ij-sheet--form" role="dialog" aria-modal="true" aria-labelledby="ij-title" id="league-join-sheet">
      <div class="ij-grab" aria-hidden="true"></div>
      <div class="ij-nav"><span class="ij-nav-l"><button type="button" class="ij-nav-btn" id="league-join-sheet-close">${escHtml(IJ_COPY.cancel)}</button></span><div class="ij-nav-t" id="ij-title">${escHtml(IJ_COPY.navJoin)}</div><span class="ij-nav-r"></span></div>
      <div class="ij-body">${noteHTML}${formHTML}</div>
    </div>`;
}

// ═══ 2. THE MEMBERSHIP CONFIRMATION ═════════════════════════════════════════════════════════════════

/**
 * "You're in {league}" (DI-727, frame 6): a check, the heading, the commissioner's line when it is known, Set Up My Profile (primary) and Go to {league} (secondary). `commissionerName` '' leaves the line out
 * (a failed roster read never blocks the confirmation). A tap on the scrim only closes: it never moves the person to another league.
 */
export function membershipInnerHTML({ leagueName = '', commissionerName = '' } = {}, { escHtml } = {}) {
  need(escHtml, 'membershipInnerHTML');
  const name = String(leagueName || '') || 'your new league';
  const who = String(commissionerName || '').trim();
  return chrome(escHtml, { title: IJ_COPY.navJoined })
    + body(`<div class="ij-hero"><div class="ij-seal ij-seal--win" aria-hidden="true">${svgIcon('check')}</div>${heroTitle(escHtml, IJ_COPY.inTitle(name))}<p class="ij-hero-s" id="ij-commissioner"${who ? '' : ' hidden'}>${who ? escHtml(IJ_COPY.commissionerLine(who)) : ''}</p></div>`)
    + footer(`<button type="button" class="btn btn-primary btn-block ij-setup" ${ACT}="ij-setup">${escHtml(IJ_COPY.setUp)}</button><button type="button" class="btn btn-secondary btn-block ij-go" ${ACT}="ij-go">${escHtml(IJ_COPY.goTo(name))}</button>`);
}
export function membershipSheetHTML(m = {}, deps = {}) {
  const escHtml = need(deps.escHtml, 'membershipSheetHTML');
  return wrap(membershipInnerHTML(m, deps), { phase: 'joined', escHtml });
}

// ═══ 3. THE COMMISSIONER'S INVITE SHEET ═══════════════════════════════════════════════════════════════════

/**
 * The sheet's inside (frames 1 and 2). `m`: `leagueName`, `code` ('' while it loads), `codePhase` ('loading' | 'ready' | 'failed'), `accepting` ({ phase, value }: the League Settings row's own state), `joined` (a count,
 * or null while unknown), `rotatePhase` ('idle' | 'working'), `rotateError` (true after a failed rotate: the old code still works), `ready` (true right after a successful rotate: "New code ready"). The switch is
 * `acceptingRowHTML`: the League Settings row itself, one component in two hosts. Share Invite is the filled button inside the code card, Copy Code beside it; Done closes.
 */
export function inviteInnerHTML(m = {}, { escHtml } = {}) {
  need(escHtml, 'inviteInnerHTML');
  const code = normalizeInviteCode(m.code);
  const phase = m.codePhase === 'failed' ? 'failed' : (code ? 'ready' : 'loading');
  const codeBlock = phase === 'ready'
    ? `<div class="ij-code ij-invite-code" id="ij-invite-code" aria-label="${escHtml(IJ_COPY.codeFieldLabel)} ${escHtml(code.split('').join(' '))}">${escHtml(formatInviteCode(code))}</div>`
    : phase === 'failed'
      ? `<p class="ij-helper" id="ij-invite-code" role="alert">${escHtml(IJ_COPY.codeLoadFailed)}</p><button type="button" class="btn btn-secondary btn-sm" ${ACT}="ij-reload-code">${escHtml(IJ_COPY.tryAgain)}</button>`
      : `<div class="ij-code ij-invite-code" id="ij-invite-code" aria-busy="true"><span class="ij-skel feed-skel-line feed-skel-line--wide" aria-hidden="true"></span><span class="sr-only">${escHtml(IJ_COPY.codeLoading)}</span></div>`;
  const acc = m.accepting && typeof m.accepting === 'object' ? m.accepting : { phase: 'loading', value: null };
  const off = acc.value === false;
  const working = m.rotatePhase === 'working';
  const dis = phase === 'ready' ? '' : ' disabled';
  return chrome(escHtml, { title: IJ_COPY.inviteTitle, titleId: 'ij-title', right: navBtn(escHtml, IJ_COPY.done, true) })
    + body(`${card(`<div class="ij-code-lab">${escHtml(IJ_COPY.codeFieldLabel)}</div>${codeBlock}
          <div class="ij-codebtns"><button type="button" class="btn btn-secondary ij-copy" ${ACT}="ij-copy"${dis}>${icn('copy')}${escHtml(IJ_COPY.copyCode)}</button><button type="button" class="btn btn-primary ij-share" ${ACT}="ij-share"${dis}>${icn('share')}${escHtml(IJ_COPY.share)}</button></div>`, 'ij-codecard')}
        ${card(`<div class="ij-accept" id="ij-accept">${acceptingRowHTML(acc, { escHtml })}</div>${row(escHtml, IJ_COPY.joinedSoFar, Number.isFinite(m.joined) && m.joined >= 0 ? escHtml(IJ_COPY.joinedCount(m.joined)) : '', ' id="ij-joined"')}`)}
        <p class="ij-helper" id="ij-closed" role="status">${escHtml(off ? IJ_COPY.closedLine : IJ_COPY.inviteHelper)}</p>
        ${card(`<button type="button" class="ij-row ij-rotate-row ij-rotate" ${ACT}="ij-rotate"${phase === 'ready' && !working ? '' : ' disabled'}>${escHtml(IJ_COPY.getNew)}</button>`)}
        <p class="ij-ready" id="ij-ready" role="status"${m.ready ? '' : ' hidden'}>${m.ready ? escHtml(IJ_COPY.codeReady) : ''}</p>
        <p class="ij-helper ij-error" id="ij-rotate-error" role="alert" aria-live="assertive"${m.rotateError ? '' : ' hidden'}>${m.rotateError ? escHtml(IJ_COPY.rotateFailed) : ''}</p>`);
}
export function inviteSheetHTML(m = {}, deps = {}) {
  const escHtml = need(deps.escHtml, 'inviteSheetHTML');
  return wrap(inviteInnerHTML(m, deps), { phase: 'invite', cls: 'ij-invite', escHtml });
}

/** The "Get a new code?" action sheet (DI-729, frame 2): what it costs, then one destructive action and Cancel. Rides the ONE action-sheet builder; app.js lays it OVER the Invite sheet (the code card stays dimmed behind it). */
export function rotateSheetHTML({ escHtml } = {}) {
  need(escHtml, 'rotateSheetHTML');
  return actionSheetHTML({ escHtml, titleId: 'ij-rotate-title', title: IJ_COPY.rotateTitle, message: IJ_COPY.rotateMessage, danger: { label: IJ_COPY.rotateConfirm, action: 'ij-rotate-confirm' },
    cancel: { label: IJ_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: ACT });
}

/**
 * The code FORM itself (frame 5), ONE markup in the app's two hosts (the Join sheet and the zero-league landing's card): the labelled field with its Paste button INSIDE it (or, for an invite LINK, the code as
 * read-only text with the field hidden), the red error banner under it (empty and hidden until app.js fills it), the rule line, and Continue (it only looks the code up). `shown` is the code formatted 4+4;
 * `linked` true = the code came from a `?join=` link; `disabled` true = signups are closed; `reassure` true = the zero-league landing's card adds DI-181d's line that the code is not a password. `closedNoticeHTML` is a finished, escaped fragment from app.js.
 */
export function codeFormHTML({ shown = '', linked = false, disabled = false, closedNoticeHTML = '', reassure = false } = {}, { escHtml } = {}) {
  need(escHtml, 'codeFormHTML');
  const dis = disabled ? 'disabled' : '';
  const field = linked
    ? `<input type="hidden" id="league-join-code" value="${escHtml(shown)}" />
          <p class="ij-linkcode"><span class="ij-code-lab">${escHtml(IJ_COPY.codeLabel)}</span> <span class="ij-code-v">${escHtml(shown)}</span></p>`
    : `<div class="ij-input"><input type="text" class="ij-input-el" id="league-join-code" placeholder="e.g. K7QX 9M2P" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="16" ${dis} />
            <button type="button" class="ij-paste" id="league-join-paste" ${dis}>${escHtml(IJ_COPY.paste)}</button></div>`;
  return `${closedNoticeHTML}
        <div class="ij-field">
          <label class="ij-field-l" for="league-join-code">${escHtml(linked ? 'Invitation' : IJ_COPY.codeFieldLabel)}</label>
          ${field}
        </div>
        <div class="ij-banner ij-banner--err" id="league-join-error-box" style="display:none"><span class="ij-ic" aria-hidden="true">${svgIcon('warning')}</span><span id="league-join-error" role="alert" aria-live="assertive"></span></div>
        <p class="ij-helper">${escHtml(IJ_COPY.codeRule)}</p>${reassure ? `<p class="ij-helper">${escHtml(IJ_COPY.reassure)}</p>` : ''}
        <div class="ij-footer"><button type="button" class="btn btn-primary btn-block" id="league-join-btn" ${dis}>${escHtml(IJ_COPY.continue)}</button></div>`;
}
