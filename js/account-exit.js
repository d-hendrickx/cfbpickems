/**
 * js/account-exit.js — THE DELETE ACCOUNT SHEET'S PURE HALF (UN-389, DI-446, 2026-09-30)
 * ============================================================================
 * The need: a person who runs a league on their own must be able to delete their account from inside the app (Apple 5.1.1(v); the privacy right) and, as part of it, leave each
 * league they run alone in a safe state — handed to another member, or archived — without stranding the friends they invited or leaving a live league nobody can run.
 *
 * The design input is DI-446 in `docs/DESIGN_INPUTS_ACCOUNT_DELETE_SOLE_COMMISSIONER.md` (section 5); its server half is DI-445 (migration 0035). This module is PURE: data in, HTML
 * strings or plain decision objects out. It touches no DOM, no network and no storage, and it imports nothing from app.js or auth.js (the same shape as js/league-create.js,
 * js/leagues-home.js and js/brand.js — testable in `accountexittest.mjs` without booting the app). `escHtml` is a REQUIRED injected dependency (CONVENTIONS #12): a league name and a
 * member's display name are user data, so a caller that forgets it fails LOUDLY instead of rendering `<img onerror>` unescaped.
 *
 * WHAT LIVES HERE
 *   1. the copy — every sentence the sheet shows, in one frozen table plus a few small builders (so the design input's words are asserted once);
 *   2. the sheet's STATE and its reducer — the preflight snapshot the server answered, what this session handed over or archived, what is QUEUED, the picker step, what is in flight;
 *   3. the derived truth — each league's row kind, how many are unresolved, whether Delete is allowed, the caption under it;
 *   4. the renderers — the header, the rows region, the picker, the body (list pane + picker pane + the typed-confirm form), and the action sheet (through the ONE shared builder in
 *      js/league-create.js, `actionSheetHTML()`);
 *   5. the error classifier that turns the server's named refusals into "your leagues changed" rather than "check your connection".
 *
 * THE RULE LIVES ON THE SERVER. Which leagues block, which auto-archive and who the candidates are is decided ONLY by `account_exit_leagues()` (DI-445, through auth.js
 * `getAccountExitLeagues()`). Nothing below re-derives eligibility: it renders the rows it is handed. The one "derivation" it owns is SERVER TRUTH WINS — a league the latest, fresh
 * preflight still lists as `blocks` is Blocked whatever this session's own record says; the local record of a hand-off or an archive is believed only until the next fresh answer.
 *
 * THE IRREVERSIBLE STEP WAITS FOR THE LAST TAP (D-5). A hand-off runs at once (the giver is still a commissioner and can undo it from Comm -> Players). Archiving is only QUEUED here
 * (`state.queued`); app.js runs the queue on the final Delete tap, and abandoning the sheet abandons the queue.
 */

import { actionSheetHTML } from './league-create.js';

function requireEscHtml(escHtml, who) {
  if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an escHtml function — a league name or a member's name must never render unescaped`);
}
const noIcon = () => '';

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. COPY — one frozen table, plus the few sentences that carry a name or a count
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The typed confirmation, exactly as it has shipped since DI-340 (a named deviation, kept). */
export const CONFIRM_WORD = 'DELETE';

export const AX_COPY = Object.freeze({
  title: 'Delete your account?',
  // The two paragraphs are today's, verbatim, except "your commissioner" -> "league commissioners" (true for a sole commissioner).
  lede: "This removes your sign-in and profile. Your name, picks, and results stay part of your leagues' history — they won't be deleted, just no longer linked to your account. This can't be undone.",
  note: "A record of this change is kept in your league's audit history, visible only to league commissioners.",
  section: 'Before you delete',
  confirmLabel: 'Type DELETE to confirm',
  confirmPlaceholder: 'Type DELETE',
  deleteBtn: 'Delete My Account',
  deleting: 'Deleting…',
  archiving: 'Archiving…',
  close: 'Close',
  back: 'Back',
  backAria: 'Back to Delete your account',
  // the rows
  chooseNew: 'Choose a New Commissioner',
  archiveLeague: 'Archive League',
  cancel: 'Cancel',
  willArchive: 'Will archive',
  undo: 'Undo',
  pilotNote: "This league can't be archived. Choose a new commissioner to continue.",
  // the picker
  pickerTitle: 'New Commissioner',
  pickerCaption: 'Tap a name to make them commissioner.',
  // the failure / notice states
  preflightFailed: "Couldn't check your leagues. Check your connection and try again.",
  tryAgain: 'Try Again',
  retrying: 'Trying…',
  stale: 'Your leagues changed while you were here. Review them below.',
  sessionExpired: 'Your session expired. Sign in again to continue.',
  // "Couldn't delete" is the prefix authtest [57f] pins; the old tail "or tell your commissioner" is dropped (wrong for a person who IS the commissioner).
  deleteFailed: "Couldn't delete your account. Check your connection and try again.",
  archiveMessage: "Nobody in it will be able to make picks or send messages. Its history is kept. You can't undo this yourself.",
});

const plural = (n, one, many) => (n === 1 ? one : many);
const leagueLabel = (name) => String(name || '').trim() || 'this league';
const memberLabel = (name) => String(name || '').trim() || 'this member';

export const onlyCommissionerLine = (n) => (n > 0 ? `You're the only commissioner. ${n} other ${plural(n, 'member', 'members')}.` : "You're the only commissioner. No other members.");
export const makeCommissionerLabel = (name) => `Make ${memberLabel(name)} Commissioner`;
export const makeCommissionerAria = (name, league) => `Make ${memberLabel(name)} commissioner of ${leagueLabel(league)}`;
export const chooseNewAria = (league) => `Choose a new commissioner for ${leagueLabel(league)}`;
export const archiveAria = (league) => `Archive ${leagueLabel(league)}`;
export const undoAria = (league) => `Undo archiving ${leagueLabel(league)}`;
export const handedLine = (name, league) => `${memberLabel(name)} is now commissioner of ${leagueLabel(league)}.`;
export const queuedLine = (league) => `${leagueLabel(league)} will be archived when you delete your account.`;
export const autoLine = (league) => `${leagueLabel(league)} has no other members. It will be archived when you delete your account.`;
export const archivedLine = (league) => `${leagueLabel(league)} has been archived.`;
export const pickerHeading = (league) => `Who should run ${leagueLabel(league)}?`;
export const pickerEmpty = (league) => `There's no one to hand ${leagueLabel(league)} to right now.`;
export const archiveTitle = (league) => `Archive ${leagueLabel(league)}?`;
export const captionUnresolved = (names) => (names.length === 1 ? `Choose what happens to ${leagueLabel(names[0])} first.` : `Choose what happens to ${names.length} leagues first.`);
export const handoffFailed = (name) => `Couldn't make ${memberLabel(name)} commissioner. Nothing was changed. Check your connection and try again.`;
export const archiveFailed = (league) => `Couldn't archive ${leagueLabel(league)}. Your account hasn't been deleted. Check your connection and try again.`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. THE PREFLIGHT GATE — does this sheet ask the server at all?
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The cached memberships (`getCachedMemberships()`: an active-seats-only read) that hold a COMMISSIONER seat, as `[{ leagueId, leagueName }]`. Empty means the sheet renders today's
 * content at once and makes NO preflight call (zero regression for a plain player, and no dependency on migration 0035). Anything that is not an array, or an entry that is not an object
 * with a string `leagueId`, is skipped — never a throw (a malformed cache must not break the deletion path).
 */
export function cachedCommissionerLeagues(memberships) {
  if (!Array.isArray(memberships)) return [];
  const out = [];
  for (const m of memberships) {
    if (m && m.role === 'commissioner' && typeof m.leagueId === 'string' && m.leagueId) out.push({ leagueId: m.leagueId, leagueName: typeof m.leagueName === 'string' ? m.leagueName : '' });
  }
  return out;
}

/** Only the two flags the server decides a row is worth SHOWING for. A paused league, or one where the person is a co-commissioner, comes back with neither (or not at all) and never renders. */
export const isLiveRow = (row) => !!row && (row.blocks === true || row.autoArchive === true);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. STATE + REDUCER
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The state the sheet opens in. `commissionerLeagues` is `cachedCommissionerLeagues()`'s output: none -> mode `skipped` (today's sheet, no call); some -> mode `live`, already
 * `checking` (the preflight is fired as the sheet mounts), with the cached names kept for the skeleton.
 */
export function createInitialState({ commissionerLeagues = [] } = {}) {
  const live = Array.isArray(commissionerLeagues) && commissionerLeagues.length > 0;
  const names = {};
  for (const l of (live ? commissionerLeagues : [])) names[l.leagueId] = l.leagueName || '';
  return {
    mode: live ? 'live' : 'skipped',
    cached: live ? commissionerLeagues.map((l) => ({ leagueId: l.leagueId, leagueName: l.leagueName || '' })) : [],
    names,
    snapshot: null,        // the server's rows from the last SUCCESSFUL preflight, or null before the first
    fresh: false,          // true only when `snapshot` reflects every change this session has made (a fresh answer)
    checking: live,        // a preflight is in flight
    failed: false,         // the last preflight failed (loud: Try Again, Delete disabled)
    failedKind: 'generic', // 'generic' | 'expired'
    order: [],             // league ids in the order the rows are shown (first seen, then appended) so a row never jumps
    done: {},              // leagueId -> { kind: 'handed', name } | { kind: 'archived' }: this session's own record, believed only until a fresh answer
    queued: [],            // league ids whose archive is QUEUED for the final tap, in the order they were chosen
    step: 'list',          // 'list' | 'picker'
    pickerLeagueId: null,
    pickerError: '',       // the picker's inline banner (a failed hand-off)
    confirmArchive: null,  // the league id whose action sheet is up
    pending: null,         // { kind: 'handoff', leagueId, memberId } while a hand-off call is out
    running: null,         // null | 'archiving' | 'deleting' — the final tap's sequence
    typed: '',
    notice: null,          // { kind: 'err' | 'info', text } — the rows region's banner ("Your leagues changed…")
    message: '',           // the text under the Delete button (archive / delete failures) — `#pwacct-delete-message`
  };
}

const uniq = (arr) => arr.filter((x, i) => arr.indexOf(x) === i);
const rowOf = (state, id) => (state.snapshot || []).find((r) => r.leagueId === id) || null;

/** The pure transition function. Unknown actions return the same object (so a caller can `===` to skip a repaint). */
export function reduce(state, action) {
  const s = state;
  switch (action && action.type) {
    case 'preflight-start':
      return { ...s, checking: true, failed: false };
    case 'preflight-ok': {
      const rows = Array.isArray(action.rows) ? action.rows : [];
      const names = { ...s.names };
      for (const r of rows) names[r.leagueId] = r.leagueName || names[r.leagueId] || '';
      const order = uniq([...s.order, ...rows.filter(isLiveRow).map((r) => r.leagueId)]);
      // SERVER TRUTH WINS: a queued archive stays queued only while the server still lists the league as a blocking, non-pilot league.
      const blockingNonPilot = (id) => rows.some((r) => r.leagueId === id && r.blocks === true && r.pilot !== true);
      const queued = s.queued.filter(blockingNonPilot);
      const pickerGone = s.step === 'picker' && !rows.some((r) => r.leagueId === s.pickerLeagueId && r.blocks === true);
      return {
        ...s, snapshot: rows, fresh: true, checking: false, failed: false, names, order, queued,
        step: pickerGone ? 'list' : s.step, pickerLeagueId: pickerGone ? null : s.pickerLeagueId, pickerError: pickerGone ? '' : s.pickerError,
        confirmArchive: s.confirmArchive && blockingNonPilot(s.confirmArchive) ? s.confirmArchive : null,
      };
    }
    case 'preflight-fail':
      return { ...s, checking: false, failed: true, failedKind: action.expired ? 'expired' : 'generic', fresh: false };
    case 'open-picker': {
      const row = rowOf(s, action.leagueId);
      if (s.step !== 'list' || s.pending || s.running || !row || row.blocks !== true) return s;
      return { ...s, step: 'picker', pickerLeagueId: action.leagueId, pickerError: '' };
    }
    case 'close-picker':
      if (s.step !== 'picker' || s.pending) return s;
      return { ...s, step: 'list', pickerLeagueId: null, pickerError: '' };
    case 'ask-archive': {
      const row = rowOf(s, action.leagueId);
      if (s.pending || s.running || !row || row.blocks !== true || row.pilot === true || s.queued.includes(action.leagueId)) return s;
      return { ...s, confirmArchive: action.leagueId };
    }
    case 'cancel-archive':
      return s.confirmArchive ? { ...s, confirmArchive: null } : s;
    case 'queue-archive': {
      const id = s.confirmArchive;
      if (!id) return s;
      const leavePicker = s.step === 'picker' && s.pickerLeagueId === id;
      return { ...s, queued: uniq([...s.queued, id]), confirmArchive: null, step: leavePicker ? 'list' : s.step, pickerLeagueId: leavePicker ? null : s.pickerLeagueId, pickerError: leavePicker ? '' : s.pickerError };
    }
    case 'undo-archive':
      if (s.running || !s.queued.includes(action.leagueId)) return s;
      return { ...s, queued: s.queued.filter((x) => x !== action.leagueId) };
    case 'handoff-start':
      if (s.pending || s.running) return s;
      // A red notice left by a PREVIOUS failed hand-off is cleared by the next attempt (a calm info notice — "your leagues changed" — is not).
      return { ...s, pending: { kind: 'handoff', leagueId: action.leagueId, memberId: action.memberId }, pickerError: '', notice: s.notice && s.notice.kind === 'err' ? null : s.notice };
    case 'handoff-ok':
      return {
        ...s, pending: null, step: 'list', pickerLeagueId: null, pickerError: '', fresh: false, notice: null,
        done: { ...s.done, [action.leagueId]: { kind: 'handed', name: action.name || '' } },
        queued: s.queued.filter((x) => x !== action.leagueId),
        names: { ...s.names, [action.leagueId]: action.leagueName || s.names[action.leagueId] || '' },
      };
    case 'handoff-fail': {
      // Where the failure is SAID depends on where the tap happened: from the picker it is the picker's own inline banner; from the list (the one-tap "Make {Name} Commissioner"
      // button, which never opens the picker) it is the rows region's red notice — a failure must never be recorded somewhere the person cannot see.
      const text = String(action.text || '');
      return s.step === 'picker' ? { ...s, pending: null, pickerError: text } : { ...s, pending: null, notice: { kind: 'err', text } };
    }
    case 'typed':
      return s.typed === String(action.value == null ? '' : action.value) ? s : { ...s, typed: String(action.value == null ? '' : action.value) };
    case 'run-start':
      return { ...s, running: action.stage === 'deleting' ? 'deleting' : 'archiving', message: '', confirmArchive: null };
    case 'archive-ok':
      return { ...s, fresh: false, done: { ...s.done, [action.leagueId]: { kind: 'archived' } }, queued: s.queued.filter((x) => x !== action.leagueId) };
    case 'run-fail':
      return { ...s, running: null, message: String(action.text || ''), fresh: action.stale ? false : s.fresh };
    case 'set-notice':
      return { ...s, notice: action.notice || null };
    case 'set-message':
      return { ...s, message: String(action.text || '') };
    default:
      return s;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. DERIVED TRUTH
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The kind of one league's row, or null when it should not be shown.
 *   blocked | blockedPilot   the server lists it as `blocks` (the person must choose) — `blockedPilot` has no Archive;
 *   queued                   the person confirmed the archive action sheet (resolved; runs at the final tap);
 *   auto                     the server lists it `auto_archive` (no other members; the server archives it with the deletion);
 *   handed | archived        this session's own record of a hand-off / an archive.
 * SERVER TRUTH WINS: once the snapshot is FRESH (the preflight succeeded after the last change this session made) a league it still lists as `blocks` is Blocked whatever the local
 * record says. Until then (a change is in, the re-ask has not landed) the local record is believed, so the row reads "is now commissioner" the instant the hand-off succeeds.
 */
export function rowKind(state, leagueId) {
  const row = rowOf(state, leagueId);
  const rec = state.done[leagueId] || null;
  if (rec && !state.fresh) return rec.kind === 'handed' ? 'handed' : 'archived';
  if (row && row.autoArchive === true) return 'auto';
  if (row && row.blocks === true) {
    if (row.pilot !== true && state.queued.includes(leagueId)) return 'queued';
    return row.pilot === true ? 'blockedPilot' : 'blocked';
  }
  if (rec) return rec.kind === 'handed' ? 'handed' : 'archived';
  return null;
}

/** The rows to show, in a stable order, each `{ leagueId, leagueName, kind, pilot, candidates, handedName }`. Empty in `skipped` mode. */
export function listRows(state) {
  if (state.mode !== 'live') return [];
  const out = [];
  for (const id of state.order) {
    const kind = rowKind(state, id);
    if (!kind) continue;
    const row = rowOf(state, id);
    const rec = state.done[id] || null;
    out.push({
      leagueId: id, leagueName: (row && row.leagueName) || state.names[id] || '', kind,
      pilot: !!(row && row.pilot), candidates: (row && Array.isArray(row.candidates)) ? row.candidates : [],
      handedName: rec && rec.kind === 'handed' ? rec.name : '',
    });
  }
  return out;
}

/** The leagues still waiting on a choice (Blocked, either flavour). */
export const unresolvedRows = (state) => listRows(state).filter((r) => r.kind === 'blocked' || r.kind === 'blockedPilot');

/** True while the sheet has no authoritative answer yet and the person must not be able to delete (loading, failed, or a change the re-ask has not confirmed). */
export function awaitingServer(state) {
  if (state.mode !== 'live') return false;
  return state.checking || state.failed || !state.fresh || !state.snapshot;
}

/** Delete is enabled ONLY when: the field equals DELETE exactly, nothing is unresolved, the preflight succeeded (or was skipped) and is current, and nothing is in flight. */
export function canDelete(state) {
  if (state.typed !== CONFIRM_WORD) return false;
  if (state.running || state.pending) return false;
  if (awaitingServer(state)) return false;
  return unresolvedRows(state).length === 0;
}

/** The Delete button's label: the sequence's own words while it runs. */
export function deleteLabel(state) {
  if (state.running === 'deleting') return AX_COPY.deleting;
  if (state.running === 'archiving') return AX_COPY.archiving;
  return AX_COPY.deleteBtn;
}

/** The caption under Delete while a league still needs a choice; '' otherwise. */
export function captionText(state) {
  if (state.mode !== 'live' || state.running) return '';
  const un = unresolvedRows(state);
  return un.length ? captionUnresolved(un.map((r) => r.leagueName)) : '';
}

/** The queued archives, in the order the final tap will run them (the order they are LISTED, which is the order the rows appear). */
export function queuedInOrder(state) {
  return state.order.filter((id) => state.queued.includes(id) && rowKind(state, id) === 'queued');
}

/** Dismissal (the close button, the backdrop, Esc, swipe-down) is blocked while the final sequence — the queued archives, then the deletion — runs (DI-446). A hand-off in flight does NOT block it: it is one short call whose result persists, and a sheet that cannot be closed on a slow network is a lock. */
export const dismissBlocked = (state) => !!state.running;

/** Which league ids' rows changed kind between two states — the repaint plays the 150ms crossfade on these and nowhere else. */
export function changedLeagueIds(prev, next) {
  const ids = uniq([...(prev ? prev.order : []), ...next.order]);
  return ids.filter((id) => (prev ? rowKind(prev, id) : null) !== rowKind(next, id));
}

/**
 * How a failed call reads: 'expired' (the session ended: the ordinary session-expired copy), 'stale' (the server refused by NAME because the league is no longer in the state the
 * sheet showed — `not_last_commissioner`, `pilot_league_protected`: re-ask, never "check your connection"), or 'failed' (transport or anything unnamed). `isExpired` is auth.js's
 * `isSessionExpiredError(err)`, passed in because this module imports nothing from it.
 */
export function classifyExitError(err, { isExpired = false } = {}) {
  const raw = `${(err && err.message) || ''} ${(err && err.code) || ''} ${(err && err.details) || ''}`;
  if (isExpired || /\bnot_authenticated\b/.test(raw)) return 'expired';
  if (/\bnot_last_commissioner\b/.test(raw) || /\bpilot_league_protected\b/.test(raw)) return 'stale';
  return 'failed';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The header's nav bar: the list step's title + close (`#pwacct-delete-close`, id byte-stable), the picker step's back chevron + centred title. */
export function navHTML(state, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'navHTML');
  if (state.step === 'picker') {
    return `<div class="ax-nav ax-nav-push"><button type="button" class="ax-nav-btn" data-ax-action="back" aria-label="${escHtml(AX_COPY.backAria)}"><span class="ax-nav-ic" aria-hidden="true">${icon('chevronLeft')}</span><span>${escHtml(AX_COPY.back)}</span></button>`
      + `<div class="ax-nav-title" id="pwacct-delete-title" tabindex="-1">${escHtml(AX_COPY.pickerTitle)}</div><span class="ax-nav-spacer" aria-hidden="true"></span></div>`;
  }
  return `<div class="ax-nav"><div class="ax-nav-title" id="pwacct-delete-title" tabindex="-1">${escHtml(AX_COPY.title)}</div>`
    + `<button type="button" class="ax-nav-btn ax-nav-close" id="pwacct-delete-close" data-ax-action="close" aria-label="${escHtml(AX_COPY.close)}"><span class="ax-nav-ic" aria-hidden="true">${icon('close')}</span></button></div>`;
}

/** A banner in the New League sheet's own family (`.lc-banner`), with an optional Try Again. `role="alert"` on the red one so VoiceOver reads it when it appears. */
function bannerHTML(kind, text, { escHtml, icon = noIcon, retry = null } = {}) {
  const isErr = kind === 'err';
  const act = retry ? `<button type="button" class="lc-btn lc-btn-secondary lc-btn-sm ax-retry" data-ax-action="retry"${retry.busy ? ' disabled aria-disabled="true"' : ''}>${escHtml(retry.busy ? AX_COPY.retrying : AX_COPY.tryAgain)}</button>` : '';
  return `<div class="lc-banner ax-banner ${isErr ? 'lc-banner-err' : 'lc-banner-info'}" role="${isErr ? 'alert' : 'status'}" data-ax-banner="${isErr ? 'err' : 'info'}">`
    + `<span class="lc-banner-ic" aria-hidden="true">${icon(isErr ? 'warning' : 'lock')}</span><span class="ax-banner-text">${escHtml(text)}</span>${act}</div>`;
}

function spinnerBtnLabel(busy, label, escHtml) {
  return busy ? `<span class="lc-spin" aria-hidden="true"></span><span>${escHtml(label)}</span>` : `<span>${escHtml(label)}</span>`;
}

function cardHTML(row, state, { escHtml, icon }, animate) {
  const id = escHtml(row.leagueId);
  const enter = animate.has(row.leagueId) ? ' ax-card-in' : '';
  const open = `<div class="card ax-card${enter}" data-ax-card="${id}" data-ax-state="${escHtml(row.kind)}">`;
  const pending = state.pending;
  const busyAll = !!(pending || state.running);
  if (row.kind === 'handed') {
    return `${open}<div class="ax-done"><span class="ax-done-ic" aria-hidden="true">${icon('check')}</span><span class="ax-card-line">${escHtml(handedLine(row.handedName, row.leagueName))}</span></div></div>`;
  }
  if (row.kind === 'archived') {
    return `${open}<div class="ax-done"><span class="ax-done-ic" aria-hidden="true">${icon('check')}</span><span class="ax-card-line">${escHtml(archivedLine(row.leagueName))}</span></div></div>`;
  }
  if (row.kind === 'auto') {
    return `${open}<div class="ax-card-line">${escHtml(autoLine(row.leagueName))}</div></div>`;
  }
  if (row.kind === 'queued') {
    return `${open}<div class="ax-queued"><span class="ax-pill">${escHtml(AX_COPY.willArchive)}</span><span class="ax-card-line">${escHtml(queuedLine(row.leagueName))}</span></div>`
      + `<button type="button" class="lc-btn lc-btn-text ax-undo" data-ax-action="undo-archive" data-ax-league="${id}" aria-label="${escHtml(undoAria(row.leagueName))}"${busyAll ? ' disabled aria-disabled="true"' : ''}>${escHtml(AX_COPY.undo)}</button></div>`;
  }
  // blocked / blockedPilot
  const cands = row.candidates;
  const one = cands.length === 1 ? cands[0] : null;
  const handing = !!(pending && pending.kind === 'handoff' && pending.leagueId === row.leagueId);
  const dis = busyAll ? ' disabled aria-disabled="true"' : '';
  const primary = one
    ? `<button type="button" class="lc-btn lc-btn-secondary${handing ? ' lc-btn-busy' : ''}" data-ax-action="handoff-one" data-ax-league="${id}" data-ax-member="${escHtml(one.memberId)}" aria-label="${escHtml(makeCommissionerAria(one.displayName, row.leagueName))}"${dis}>${spinnerBtnLabel(handing, makeCommissionerLabel(one.displayName), escHtml)}</button>`
    : `<button type="button" class="lc-btn lc-btn-secondary" data-ax-action="choose" data-ax-league="${id}" aria-label="${escHtml(chooseNewAria(row.leagueName))}"${dis}><span>${escHtml(AX_COPY.chooseNew)}</span><span class="lc-btn-ic ax-chev" aria-hidden="true">${icon('chevronRight')}</span></button>`;
  const archive = row.kind === 'blockedPilot' ? ''
    : `<button type="button" class="lc-btn lc-btn-text ax-destructive" data-ax-action="ask-archive" data-ax-league="${id}" aria-label="${escHtml(archiveAria(row.leagueName))}"${dis}>${escHtml(AX_COPY.archiveLeague)}</button>`;
  const pilot = row.kind === 'blockedPilot' ? `<div class="ax-card-note">${escHtml(AX_COPY.pilotNote)}</div>` : '';
  return `${open}<div class="ax-card-name">${escHtml(leagueLabel(row.leagueName))}</div><div class="ax-card-line">${escHtml(onlyCommissionerLine(cands.length))}</div>${pilot}`
    + `<div class="ax-card-actions">${primary}${archive}</div></div>`;
}

function skeletonCardHTML(league, { escHtml }) {
  return `<div class="card ax-card ax-skel" aria-hidden="true"><div class="ax-card-name">${escHtml(leagueLabel(league.leagueName))}</div><div class="ax-skel-line"></div><div class="ax-skel-btn"></div></div>`;
}

/** Whether the rows region should announce itself busy (the skeleton is showing, or a re-ask is out). */
export const rowsBusy = (state) => state.mode === 'live' && state.checking;

/**
 * The rows region's inner markup: the notice banner, the preflight-failed banner with Try Again, the "Before you delete" heading and one card per shown league — or, on the first
 * ask, the skeleton (one per cached commissioner league, names from the cache). `animate` is a Set of league ids whose card just changed kind (the 150ms crossfade class).
 * Empty string in `skipped` mode and when the fresh answer shows nothing: today's sheet, unchanged.
 */
export function rowsRegionHTML(state, { escHtml, icon = noIcon } = {}, { animate = new Set() } = {}) {
  requireEscHtml(escHtml, 'rowsRegionHTML');
  if (state.mode !== 'live') return '';
  const deps = { escHtml, icon };
  let html = '';
  if (state.notice) html += bannerHTML(state.notice.kind === 'err' ? 'err' : 'info', state.notice.text, deps);
  if (state.failed) {
    html += bannerHTML('err', state.failedKind === 'expired' ? AX_COPY.sessionExpired : AX_COPY.preflightFailed, { ...deps, retry: state.failedKind === 'expired' ? null : { busy: false } });
  }
  const rows = listRows(state);
  if (!state.snapshot && state.checking) {
    return `${html}<div class="lc-sec">${escHtml(AX_COPY.section)}</div>${state.cached.map((l) => skeletonCardHTML(l, deps)).join('')}`;
  }
  if (!rows.length) return html;
  return `${html}<div class="lc-sec">${escHtml(AX_COPY.section)}</div>${rows.map((r) => cardHTML(r, state, deps, animate)).join('')}`;
}

/** The picker pane (step 2): the heading, the caption, the inline failure banner, one 44px-minimum row per candidate — or the empty state. */
export function pickerHTML(state, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'pickerHTML');
  const row = rowOf(state, state.pickerLeagueId);
  if (state.step !== 'picker' || !row) return '';
  const league = row.leagueName || state.names[row.leagueId] || '';
  const pending = state.pending;
  const banner = state.pickerError ? bannerHTML('err', state.pickerError, { escHtml, icon }) : '';
  let rows = '';
  if (row.candidates.length) {
    rows = `<div class="lc-card ax-picker-card" role="group" aria-label="${escHtml(pickerHeading(league))}">${row.candidates.map((c) => {
      const handing = !!(pending && pending.memberId === c.memberId && pending.leagueId === row.leagueId);
      return `<button type="button" class="lc-row ax-pick${handing ? ' ax-pick-busy' : ''}" data-ax-action="pick" data-ax-league="${escHtml(row.leagueId)}" data-ax-member="${escHtml(c.memberId)}" aria-label="${escHtml(makeCommissionerAria(c.displayName, league))}"${pending ? ' disabled aria-disabled="true"' : ''}>`
        + `<span class="lc-row-name">${escHtml(memberLabel(c.displayName))}</span>${handing ? '<span class="lc-spin" aria-hidden="true"></span>' : ''}</button>`;
    }).join('')}</div>`;
  } else {
    const archive = row.pilot ? ''
      : `<button type="button" class="lc-btn lc-btn-text ax-destructive" data-ax-action="ask-archive" data-ax-league="${escHtml(row.leagueId)}" aria-label="${escHtml(archiveAria(league))}">${escHtml(AX_COPY.archiveLeague)}</button>`;
    rows = `<p class="ax-picker-empty">${escHtml(pickerEmpty(league))}</p>${archive}`;
  }
  return `<div class="ax-picker-body" data-ax-step="picker"><h2 class="ax-picker-title" id="pwacct-delete-picker-title" tabindex="-1">${escHtml(pickerHeading(league))}</h2>`
    + `<p class="ax-picker-cap">${escHtml(AX_COPY.pickerCaption)}</p>${banner}${rows}</div>`;
}

/**
 * The body, mounted ONCE: the list pane (the two paragraphs, the rows region, the typed-confirm form) and the hidden picker pane. The form's five ids are byte-stable
 * (`pwacct-delete-confirm|submit|message`, plus `-overlay` and `-close` elsewhere) so authtest [57d]-[57f] hold unchanged; the typed field is NEVER re-rendered (a repaint would
 * drop the text and the keyboard), so later updates patch the rows region, the picker pane, the button and the caption in place.
 */
export function bodyHTML(state, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'bodyHTML');
  return `<div class="ax-pane ax-pane-list" id="pwacct-delete-list" data-ax-step="list">
      <p class="ax-lede">${escHtml(AX_COPY.lede)}</p>
      <p class="ax-note">${escHtml(AX_COPY.note)}</p>
      <div class="ax-rows" id="pwacct-delete-rows" aria-live="polite" aria-busy="${rowsBusy(state) ? 'true' : 'false'}">${rowsRegionHTML(state, { escHtml, icon })}</div>
      <div class="ax-form">
        <label class="ax-label" for="pwacct-delete-confirm">${escHtml(AX_COPY.confirmLabel)}</label>
        <input class="ax-field" id="pwacct-delete-confirm" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="${escHtml(AX_COPY.confirmPlaceholder)}" />
        <button type="button" class="btn btn-danger btn-block ax-delete" id="pwacct-delete-submit" disabled>${escHtml(AX_COPY.deleteBtn)}</button>
        <div class="ax-caption" id="pwacct-delete-caption" aria-live="polite"></div>
        <div id="pwacct-delete-message" class="ax-msg" role="alert" style="display:none"></div>
      </div>
    </div>
    <div class="ax-pane ax-pane-picker" id="pwacct-delete-picker" hidden></div>`;
}

/** The archive confirmation, through the ONE shared action-sheet builder (`js/league-create.js`). Tapping the scrim is Cancel; confirming only QUEUES (D-5). */
export function archiveSheetHTML(state, { escHtml } = {}) {
  requireEscHtml(escHtml, 'archiveSheetHTML');
  const row = rowOf(state, state.confirmArchive);
  if (!state.confirmArchive || !row) return '';
  return actionSheetHTML({
    escHtml, titleId: 'pwacct-archive-title', title: archiveTitle(row.leagueName || state.names[row.leagueId] || ''), message: AX_COPY.archiveMessage,
    scrimAction: 'cancel-archive', actionAttr: 'data-ax-action',
    danger: { label: AX_COPY.archiveLeague, action: 'confirm-archive' }, cancel: { label: AX_COPY.cancel, action: 'cancel-archive' },
  });
}
