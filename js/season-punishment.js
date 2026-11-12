/**
 * js/season-punishment.js — THE SEASON-ENDER PUNISHMENT, THE PURE HALF (D2 lane 1 batch 3, UN-542 / PF-542; DI-1022..1030; mockup d2-obligations.html frames 3 to 5; migration 0072)
 * ==========================================================================================================================================
 * The commissioner proposes a punishment for last place; every member votes yes or no in SECRET; a strict majority of ALL eligible members (6 need 4, silence counts as no) locks the text for the season;
 * Standings names the last-place member only when the commissioner confirms "Season ended". This module is the words, the arithmetic and the markup; it builds no state and reads no storage, no clock (a
 * caller passes `now`), no network. `escHtml` is a REQUIRED injected dependency (CONVENTIONS #12): the punishment text is user text that every member of the league reads.
 *
 *   - `validateText(raw)`   the twin of 0072's season_punishment_text_ok(): 3 to 140 characters, one line, NFC, no control or bidirectional characters, no link, no e-mail address, no < or >. A refusal hands the
 *                           normalized text back (the field keeps what was typed).
 *   - `needed(eligible)` / `decide(...)`  the majority arithmetic, the twin of the server's evaluator (strictly more than half of the eligible members say yes).
 *   - `lastPlaceIds(rows)`  the season ranking's bottom: the last row AND every row tied with it on the season tiebreak keys (no scoring edit: it only reads calculateSeasonStandings' own rows).
 *   - `standingsSnapshot()` / `standingsHash()`  the canonical string of the rows last place was named from and its SHA-256 (recorded server side with who asserted it; the card says "named by the commissioner").
 *   - `cardModel()` / `cardHTML()` / `proposeSheetHTML()` / `confirmSheetHTML()`  the Season stakes card in every state, the propose sheet and the two confirmations.
 * NO yes/no split exists anywhere in the model: the server never sends one, and the markup has nowhere to print one.
 */
import { actionSheetHTML } from './league-create.js';

export const SP_TEXT_MIN = 3;
export const SP_TEXT_MAX = 140;
export const SP_MAX_TRIES = 3;
export const SP_MIN_MEMBERS = 3;
export const SP_WINDOWS = Object.freeze([{ hours: 24, label: '24 hours' }, { hours: 72, label: '3 days' }, { hours: 168, label: '7 days' }]);
export const SP_DEFAULT_WINDOW = 72;

export const SP_COPY = Object.freeze({
  cardLabel: (sport) => `Season stakes${sport ? ` · ${sport}` : ''}`,
  propose: 'Propose a season punishment',
  proposeAnother: 'Propose another',
  tooFew: 'A vote needs at least 3 members.',
  tryLimit: "You've used all three tries this season.",
  sheetTitle: 'Season Punishment',
  cancel: 'Cancel',
  fieldLabel: 'Punishment for last place',
  placeholder: "e.g. Wears the rival's jersey to the draft",
  windowLabel: 'Voting open for',
  sheetHelper: (n) => `Every member votes yes or no, in secret. It passes when more than half of the league votes yes (${needed(n)} of ${n}). If it passes, the text is locked for the season. Everyone in the league will see this text.`,
  send: 'Send to a Vote',
  yes: 'Yes',
  no: 'No',
  private: 'Your vote is private. You can change it until voting closes.',
  joinedAfter: 'You joined after this vote opened.',
  withdraw: 'Withdraw',
  withdrawTitle: 'Withdraw this proposal?',
  withdrawConfirm: 'Withdraw Proposal',
  locked: 'Locked for the season. Passed.',
  notPassed: "Didn't pass.",
  withdrawn: 'Withdrawn.',
  endSeason: 'Season ended',
  endTitle: (names) => `Confirm that the season has ended? ${names ? `${names} will be named as finishing last. ` : ''}This can't be undone.`,
  endConfirm: 'Season Ended',
  notFinal: "The season can't end until every week of this sport is Final.",
  endedLabel: 'Season ended',
  namedByCommissioner: (name) => `Named by the commissioner${name ? `, ${name}` : ''}.`,
  correct: 'Correct last place',
  correctionClosed: 'The correction window has closed.',
  correctTitle: (names) => `Name last place again from the current standings? ${names ? `${names} would be named. ` : ''}You can do this once, within 24 hours of confirming the season ended.`,
  correctConfirm: 'Name Again',
  correctedNote: 'Corrected by the commissioner.',
  finishedLast: (names) => `${names} finished last.`,
  punishmentIs: (text) => `Punishment: ${text}`,
  markCarried: 'Mark Carried Out',
  carriedOut: 'Carried out.',
  proposedBy: (name) => `Proposed by ${name}`,
  voted: (voted, eligible) => `${voted} of ${eligible} have voted`,
  needs: (n) => `needs ${n} yes`,
  closes: (when) => `closes ${when}`,
  failedVote: "Couldn't save your vote. Try again.",
  failedAction: "Couldn't save. Nothing was changed. Try again.",
  notOpen: 'Voting has closed.',
  textCount: (n) => `${n} / ${SP_TEXT_MAX}`,
  errors: Object.freeze({
    too_short: 'Use at least 3 characters.',
    too_long: 'That is over 140 characters. Shorten it and try again.',
    link: "Links aren't allowed here. Take the link out and try again.",
    contact: "Email addresses aren't allowed here.",
    markup: "Plain text only: take out any < or >.",
    control: 'Use plain text on one line.',
  }),
});

/** Strictly more than half of the eligible members: 3 need 2, 4 need 3, 6 need 4, 7 need 4. */
export const needed = (eligible) => Math.floor(Math.max(0, Math.floor(Number(eligible) || 0)) / 2) + 1;

/**
 * The evaluator's decision, twin of public._season_punishment_eval(): `'locked'` (yes is strictly more than half of the eligible), `'not_passed'` or `'voting'`. Silence counts as no.
 * THE SHIPPED RULE (Drew's ruling on M-87, 2026-10-21: "close at the deadline or when everyone has voted"): nothing is decided until the window has closed or every eligible member has voted. `early: true` is the
 * twin of the switch set FALSE (the documented rollback): decided the moment the outcome is certain (yes already above half, or the votes still to come, `eligible - voted`, cannot get it there).
 */
export function decide({ eligible = 0, voted = 0, yes = 0, closed = false, early = false } = {}) {
  const e = Math.max(0, Math.floor(Number(eligible) || 0)), v = Math.max(0, Math.floor(Number(voted) || 0)), y = Math.max(0, Math.floor(Number(yes) || 0));
  if (!early && !closed && v < e) return 'voting';
  if (y * 2 > e) return 'locked';
  if ((y + (e - v)) * 2 <= e) return 'not_passed';
  if (closed) return 'not_passed';
  return 'voting';
}

const CONTROL_RE = /[\u0001-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029]/g;
const INVISIBLE_RE = /[\u00AD\u061C\u200B-\u200D\u2060\uFEFF]/g;   // F-1 (0072 and profile-questions.js): invisible characters are REMOVED, so a hidden link is seen (and refused)
const LINK_RE = /(?:\:\/\/|www\.|[a-z0-9-]\.(?:com|net|org|edu|gov|io|co|us|app|dev|info|biz|ly|tv|gg|xyz)(?:$|[^a-z]))/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const len = (s) => Array.from(String(s)).length;

/** NFC, invisible characters removed, control and bidirectional characters (and line breaks) become spaces, runs of spaces collapse, trimmed. */
export function normalizeText(raw) {
  return String(raw == null ? '' : raw).normalize('NFC').replace(INVISIBLE_RE, '').replace(CONTROL_RE, ' ').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
}

/** `{ ok, value, error, message }`; a refusal still carries the normalized `value` so the field keeps what was typed. */
export function validateText(raw) {
  const original = String(raw == null ? '' : raw);
  const value = normalizeText(original);
  const E = SP_COPY.errors;
  if (len(value) < SP_TEXT_MIN) return { ok: false, value, error: 'too_short', message: E.too_short };
  if (len(value) > SP_TEXT_MAX) return { ok: false, value, error: 'too_long', message: E.too_long };
  if (/[<>]/.test(value)) return { ok: false, value, error: 'markup', message: E.markup };
  if (LINK_RE.test(value)) return { ok: false, value, error: 'link', message: E.link };
  if (EMAIL_RE.test(value)) return { ok: false, value, error: 'contact', message: E.contact };
  return { ok: true, value, error: '', message: '' };
}

/**
 * The bottom of the season ranking, from calculateSeasonStandings' own rows (best first). The last row and EVERY row tied with it on the ranking's own keys (total correct, net weekly wins minus losses,
 * win percentage) are named: a tie at the bottom names all of them (DI-1025). Fewer than two rows: nobody (a league of one has no last place).
 */
export function lastPlaceIds(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.playerId != null) : [];
  if (list.length < 2) return [];
  const key = (r) => [Number(r.totalCorrect) || 0, (Number(r.weeklyWins) || 0) - (Number(r.weeklyLosses) || 0), Number(r.winPct) || 0].join('|');
  const last = key(list[list.length - 1]);
  return list.filter((r) => key(r) === last).map((r) => String(r.playerId));
}

/**
 * The standings snapshot the commissioner's client names last place from, in a canonical string, and its SHA-256 (the server records the hash, never the rows, so a dispute can be settled by recomputing
 * the standings and hashing them the same way). Rows are in the rank order calculateSeasonStandings returned; numbers are fixed to 4 decimals; the sport-season is part of the string.
 */
export function standingsSnapshot(rows, { competitionId = '', season = '' } = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.playerId != null) : [];
  const n = (v) => (Math.round((Number(v) || 0) * 10000) / 10000).toFixed(4);
  return JSON.stringify({ v: 1, competition: String(competitionId || ''), season: String(season || ''), rows: list.map((r) => [String(r.playerId), n(r.totalCorrect), n(r.weeklyWins), n(r.weeklyLosses), n(r.winPct)]) });
}
export async function standingsHash(rows, ctx) {
  const bytes = new TextEncoder().encode(standingsSnapshot(rows, ctx));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The server's error sentinels to a kind the client words. Unknown strings are 'failed' (never a reassuring line). */
export function errorKind(err) {
  const m = String((err && (err.message || err.code)) || err || '');
  for (const k of ['not_open', 'not_eligible', 'bad_text', 'bad_window', 'already_active', 'try_limit', 'too_few_members', 'obligations_off', 'league_paused', 'not_commissioner', 'not_member', 'not_found', 'not_voting', 'not_locked', 'not_ended', 'already_ended', 'already_corrected', 'correction_closed', 'bad_hash', 'season_not_final', 'bad_last_place', 'bad_competition']) {
    if (m.includes(k)) return k;
  }
  if (/PGRST202|42883|could not find the function/i.test(m)) return 'unavailable';
  return 'failed';
}

/**
 * The Season stakes card's model from the server's state (`season_punishment_state()`), or null when there is nothing to show (obligations off, a member with no proposal, an unavailable server).
 * `kind`: 'propose' | 'blocked' | 'voting' | 'not_passed' | 'withdrawn' | 'locked' | 'ended'. `settled` is whether the client reads every week of the sport as Final (it only decides whether the Season ended
 * button is offered; the server re-checks). `closesText` is a finished string from the caller's own formatter.
 */
export function cardModel({ state, sport = '', settled = false, closesText = '', phase = 'idle' } = {}) {
  if (!state || typeof state !== 'object' || state.obligationsOn === false) return null;
  const p = state.punishment && typeof state.punishment === 'object' ? state.punishment : null;
  const comm = state.isCommissioner === true;
  const base = { label: SP_COPY.cardLabel(sport), phase, isCommissioner: comm };
  if (!p) {
    if (!comm) return null;
    if (state.canPropose === true) return { ...base, kind: 'propose', eligible: Number(state.eligibleNow) || 0 };
    const block = state.proposeBlock === 'too_few_members' ? SP_COPY.tooFew : state.proposeBlock === 'try_limit' ? SP_COPY.tryLimit : '';
    return block ? { ...base, kind: 'blocked', note: block } : null;
  }
  const common = { ...base, id: String(p.id || ''), text: String(p.text || ''), proposedBy: String(p.proposedByName || ''), eligible: Number(p.eligibleCount) || 0, voted: Number(p.votedCount) || 0 };
  const pst = String(p.status || '');   // the PROPOSAL's own status (not a week's): voting / locked / carried_out / not_passed / withdrawn
  if (pst === 'voting') {
    return { ...common, kind: 'voting', needs: needed(common.eligible), closesText: String(closesText || ''), amEligible: state.amEligible === true, myVote: state.myVote === true ? 'yes' : state.myVote === false ? 'no' : '' };
  }
  if (pst === 'not_passed') return { ...common, kind: 'not_passed', canProposeAgain: comm && state.canPropose === true };
  if (pst === 'withdrawn') return { ...common, kind: 'withdrawn', canProposeAgain: comm && state.canPropose === true };
  const lastPlace = Array.isArray(p.lastPlace) ? p.lastPlace.map((x) => ({ memberId: String(x.memberId || ''), name: String(x.displayName || '') })) : [];
  if ((pst === 'locked' || pst === 'carried_out') && !p.seasonEndedAt) return { ...common, kind: 'locked', canEnd: comm && settled === true && pst === 'locked' };
  if (pst === 'locked' || pst === 'carried_out') return { ...common, kind: 'ended', lastPlace, carriedOut: pst === 'carried_out', canMarkCarried: comm && pst === 'locked', namedBy: String(p.namedBy || ''), canCorrect: comm && p.canCorrect === true };
  return null;
}

const requireEscHtml = (escHtml, who) => { if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an escHtml function: a punishment's text is user text every member reads`); };
/** "A", "A and B", "A, B and C": the names of the members named as last place, as a sentence part. Strings in, a string out ('' for none). */
export const namesList = (names) => { const n = (Array.isArray(names) ? names : []).map((x) => String(x == null ? '' : x)).filter(Boolean); return n.length <= 1 ? (n[0] || '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };
const joinNames = (list) => namesList(list.map((x) => x.name));
const act = (escHtml, action, label, cls, extra = '') => `<button type="button" class="${cls}" data-stk-action="${escHtml(action)}"${extra}>${escHtml(label)}</button>`;

/** The card (or two cards: the second is "Season ended"). `''` for a null model. `icon` draws the lock glyph; `failed` is the inline failure sentence of the last action. */
export function cardHTML(model, { escHtml, icon = () => '', failed = '' } = {}) {
  requireEscHtml(escHtml, 'cardHTML');
  if (!model) return '';
  const busy = model.phase === 'saving';
  const fail = failed ? `<p class="stk-fail" role="alert">${escHtml(failed)}</p>` : '';
  const wrap = (inner, extraAttr = '') => `<section class="card stk-card" data-stk-card="${escHtml(model.kind)}"${extraAttr} aria-label="${escHtml(model.label)}">${inner}</section>`;
  const lab = (lock = false) => `<div class="stk-lab">${escHtml(model.label)}${lock ? `<span class="stk-lock" aria-hidden="true">${icon('lock')}</span>` : ''}</div>`;
  if (model.kind === 'propose') return wrap(`${lab()}<div class="stk-actions">${act(escHtml, 'stk-propose', SP_COPY.propose, 'btn btn-primary stk-btn')}</div>${fail}`);
  if (model.kind === 'blocked') return wrap(`${lab()}<p class="stk-note">${escHtml(model.note)}</p>`);
  if (model.kind === 'voting') {
    const meta = `${model.proposedBy ? `${SP_COPY.proposedBy(model.proposedBy)} · ` : ''}${SP_COPY.voted(model.voted, model.eligible)} · ${SP_COPY.needs(model.needs)}${model.closesText ? ` · ${SP_COPY.closes(model.closesText)}` : ''}`;
    const btn = (v, label, primary) => `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'} stk-btn" data-stk-action="stk-${v}" aria-pressed="${model.myVote === v ? 'true' : 'false'}"${busy ? ' disabled aria-busy="true"' : ''}>${escHtml(label)}</button>`;
    const body = model.amEligible
      ? `<div class="stk-actions stk-actions-row">${btn('yes', SP_COPY.yes, true)}${btn('no', SP_COPY.no, false)}</div><p class="stk-note">${escHtml(SP_COPY.private)}</p>`
      : `<p class="stk-note">${escHtml(SP_COPY.joinedAfter)}</p>`;
    const wd = model.isCommissioner ? `<div class="stk-actions">${act(escHtml, 'stk-withdraw', SP_COPY.withdraw, 'btn btn-ghost stk-btn', busy ? ' disabled' : '')}</div>` : '';
    return wrap(`${lab()}<div class="stk-text">${escHtml(model.text)}</div><div class="stk-meta">${escHtml(meta)}</div>${body}${wd}${fail}`);
  }
  if (model.kind === 'not_passed' || model.kind === 'withdrawn') {
    const again = model.canProposeAgain ? `<div class="stk-actions">${act(escHtml, 'stk-propose', SP_COPY.proposeAnother, 'btn btn-primary stk-btn')}</div>` : '';
    return wrap(`${lab()}<div class="stk-text">${escHtml(model.text)}</div><p class="stk-note">${escHtml(model.kind === 'withdrawn' ? SP_COPY.withdrawn : SP_COPY.notPassed)}</p>${again}${fail}`);
  }
  if (model.kind === 'locked') {
    const end = model.canEnd ? `<div class="stk-actions">${act(escHtml, 'stk-end', SP_COPY.endSeason, 'btn btn-secondary stk-btn', busy ? ' disabled' : '')}</div>` : '';
    return wrap(`${lab(true)}<div class="stk-text">${escHtml(model.text)}</div><p class="stk-note">${escHtml(SP_COPY.locked)}</p>${end}${fail}`);
  }
  if (model.kind === 'ended') {
    const names = joinNames(model.lastPlace);
    const first = wrap(`${lab(true)}<div class="stk-text">${escHtml(model.text)}</div><p class="stk-note">${escHtml(SP_COPY.locked)}</p>`, ' data-stk-part="locked"');
    const carried = model.carriedOut ? `<p class="stk-note">${escHtml(SP_COPY.carriedOut)}</p>` : (model.canMarkCarried ? `<div class="stk-actions">${act(escHtml, 'stk-carried', SP_COPY.markCarried, 'btn btn-secondary stk-btn', busy ? ' disabled' : '')}</div>` : '');
    const fix = model.canCorrect ? `<div class="stk-actions">${act(escHtml, 'stk-correct', SP_COPY.correct, 'btn btn-ghost stk-btn', busy ? ' disabled' : '')}</div>` : '';
    const second = `<section class="card stk-card" data-stk-card="ended" data-stk-part="ended" aria-label="${escHtml(SP_COPY.endedLabel)}"><div class="stk-lab">${escHtml(SP_COPY.endedLabel)}</div><div class="stk-text">${escHtml(names ? SP_COPY.finishedLast(names) : '')}</div><p class="stk-note">${escHtml(SP_COPY.punishmentIs(model.text))}</p><p class="stk-note stk-named" data-stk-named>${escHtml(SP_COPY.namedByCommissioner(model.namedBy))}</p>${carried}${fix}${fail}</section>`;
    return first + second;
  }
  return '';
}

/** The propose sheet (mockup frame 3): the grab handle, a nav bar (Cancel, the title), the field with its counter, the three windows, the helper and the one primary. `submitHTML` is the shared submission control. */
export function proposeSheetHTML({ eligible = 0, text = '', hours = SP_DEFAULT_WINDOW, error = '', submitHTML = '', icon = () => '', escHtml } = {}) {
  requireEscHtml(escHtml, 'proposeSheetHTML');
  const rows = SP_WINDOWS.map((w) => `<button type="button" class="ls-row stk-window" role="radio" aria-checked="${w.hours === hours ? 'true' : 'false'}" data-stk-action="stk-window" data-hours="${escHtml(String(w.hours))}"><span class="ls-row-label">${w.hours === hours ? `<strong>${escHtml(w.label)}</strong>` : escHtml(w.label)}</span>${w.hours === hours ? `<span class="stk-ck" aria-hidden="true">${icon('check')}</span>` : ''}</button>`).join('');
  return `<div class="lc-scrim" data-ls-action="cancel"></div>
    <div class="lc-actionsheet ij-sheet stk-sheet" role="dialog" aria-modal="true" aria-labelledby="stk-title" data-stk-sheet="propose">
      <div class="ij-grab" aria-hidden="true"></div>
      <div class="ij-nav"><span class="ij-nav-l"><button type="button" class="ij-nav-btn" data-stk-action="stk-cancel">${escHtml(SP_COPY.cancel)}</button></span><div class="ij-nav-t" id="stk-title" tabindex="-1">${escHtml(SP_COPY.sheetTitle)}</div><span class="ij-nav-r"></span></div>
      <div class="ij-body stk-body">
        <div class="stk-field"><label class="form-label" for="stk-text">${escHtml(SP_COPY.fieldLabel)}</label>
          <input type="text" class="form-input" id="stk-text" data-stk-field="text" value="${escHtml(text)}" placeholder="${escHtml(SP_COPY.placeholder)}" maxlength="${SP_TEXT_MAX}" autocapitalize="sentences" enterkeyhint="done" aria-describedby="stk-count stk-err" />
          <div class="stk-meta-row"><span class="stk-err" id="stk-err" role="alert" aria-live="assertive"${error ? '' : ' hidden'}>${error ? escHtml(error) : ''}</span><span class="stk-count" id="stk-count" aria-hidden="true">${escHtml(SP_COPY.textCount(len(text)))}</span></div></div>
        <div class="stk-field"><div class="form-label" id="stk-win-l">${escHtml(SP_COPY.windowLabel)}</div><div class="card ls-card" role="radiogroup" aria-labelledby="stk-win-l">${rows}</div></div>
        <p class="stk-note">${escHtml(SP_COPY.sheetHelper(eligible))}</p>
      </div>
      <div class="ij-footer">${submitHTML}</div>
    </div>`;
}

/** The two confirmations on the shell's action sheet: 'withdraw' and 'end' (the destructive one is `stk-confirm`). */
export function confirmSheetHTML({ kind, names = '', escHtml } = {}) {
  requireEscHtml(escHtml, 'confirmSheetHTML');
  const end = kind === 'end', fix = kind === 'correct';
  return actionSheetHTML({ escHtml, titleId: 'stk-confirm-title', title: end ? SP_COPY.endTitle(names) : fix ? SP_COPY.correctTitle(names) : SP_COPY.withdrawTitle, danger: { label: end ? SP_COPY.endConfirm : fix ? SP_COPY.correctConfirm : SP_COPY.withdrawConfirm, action: end ? 'stk-end-confirm' : fix ? 'stk-correct-confirm' : 'stk-withdraw-confirm' },
    cancel: { label: SP_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: 'data-ls-action' });
}
