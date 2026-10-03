/**
 * js/league-settings.js — LEAGUE SETTINGS, THE PURE HALF (SP-53, UN-345…349, DI-457…464 as amended by Amendment 1, 2026-09-30)
 * ============================================================================
 * The need: a commissioner can rename the league and open or close it to new members, a member can leave a league from its own settings without asking anyone and without erasing
 * history, and a sole commissioner hands the league over (or archives a league of one) as part of leaving. The SERVER decides every one of those (migration 0037: rename_league,
 * set_accepting_members, leave_league and the lock in admin_set_member_role); this module is what the client does with the server's answers.
 *
 * THIS MODULE IS PURE. Data in, plain values out. It touches no DOM, no storage, no clock (a `now` is injected) and imports NOTHING — not auth.js, not app.js, not supabase-backend.js
 * (the same shape as js/account-exit.js and js/league-create.js: testable in `leaguesettingstest.mjs` without booting the app). The three wrappers take their collaborators as an
 * injected `deps` object, so auth.js can bind them to its own client with one small adapter and nothing here knows which client that is:
 *
 *   deps = {
 *     rpc:                async (fn, args) => ({ data, error }),          // supabase-js's client.rpc shape (a THROWN network error is treated as { error })
 *     refreshMemberships: async () => void,                              // auth.js refreshMembershipsAndSession(); may throw
 *     getMemberships:     () => [{ leagueId, leagueName, role, ... }],   // auth.js getCachedMemberships() — read AFTER a refresh
 *     dropMirror:         ((reason) => void) | null,                     // supabase-backend.js dropMirror(), only in supabase data mode; null otherwise
 *     readAccepting:      async (leagueId) => boolean,                   // OPTIONAL: re-reads leagues.accepting_members to settle an unknown outcome
 *     isExpired:          (err) => boolean,                              // OPTIONAL: auth.js isSessionExpiredError — an expired session reads as `expired`, whatever the message
 *   }
 *
 * WHAT LIVES HERE
 *   1. the copy for every outcome the three wrappers can produce, in one frozen table (so the design input's words are asserted once). EVERY STRING IS PLAIN TEXT: a renderer must
 *      escape a league name or a display name when it interpolates one into HTML (SC-L14: double-quoted attributes or a text node only; escHtml does not escape the single quote).
 *   2. the error classifier — how a failed call reads: a NAMED refusal (the server said no and wrote nothing) or an UNKNOWN outcome (a transport failure: the call may or may not have landed);
 *   3. the three wrappers — `renameLeague`, `leaveLeague`, `setAcceptingMembers` — each returning ONE discriminated outcome object, never throwing for an expected failure;
 *   4. the outcome-to-copy mappers (`renameOutcomeCopy`, `leaveOutcomeCopy`, `acceptingOutcomeCopy`);
 *   5. the small pure facts the screens need: the leave sheet and footer text, the Q-W "you can leave after this week is final" rule and its server-mirroring predicate, the "(left)" label
 *      derivation, the rename enable and dirty rules, and which landing a leave produces.
 *
 * THE RULE LIVES ON THE SERVER. Nothing below re-derives who may lead a league: no role counting, no pilot test, no "am I the only member". `last_commissioner` is classified by the
 * caller's CACHED role only to choose between two honest messages (the caller really is the sole commissioner and the league changed; or the caller is a player and the league has no
 * commissioner at all) — and the preflight (`account_exit_leagues()`, through auth.js) remains the one place the hand-off decision is asked.
 *
 * HONESTY AFTER A FAILURE (SC-L15). A transport failure with no named refusal does NOT mean "it didn't happen". The wrappers refresh the memberships FIRST and decide from what the server
 * says now: the league is gone from the list -> the leave happened (success); still listed -> the failure copy; the refresh also fails -> a third, honest state ("We couldn't confirm…").
 * The same principle settles a rename (the refreshed name equals the draft -> success) and, where `readAccepting` is supplied, the switch.
 *
 * THE LEAVE SEQUENCE IS AN INVARIANT (F4, authtest pins the wiring): rpc('leave_league') -> dropMirror('leave-league') -> refreshMemberships(). The mirror is dropped BEFORE the refresh so a
 * refresh that FAILS still leaves no left-league data on screen (fail-closed); on the success path the refresh's own owner-reconcile drops it again, which is idempotent.
 */

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. COPY — plain text, one frozen table, plus the few sentences that carry a name or a count
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const LS_COPY = Object.freeze({
  sessionExpired: 'Your session expired. Sign in again to continue.',
  reload: 'Reload',
  // ── rename (DI-458)
  renamed: 'League renamed.',
  renameFailed: "Couldn't rename the league. Nothing was changed. Check your connection and try again.",
  renameAppliedRefreshFailed: "League renamed, but this page couldn't refresh. Reload to see it everywhere.",
  renameUnconfirmed: "We couldn't confirm whether the name changed. Reload to check.",
  renameNotCommissioner: 'Only a commissioner can rename the league.',
  renameBadName: "That name can't be used. Try a different one.",
  renamePaused: "The name can't be changed while the league is paused.",
  // ── accepting new members (DI-459)
  acceptingOpened: 'Open to new members.',
  acceptingClosed: 'Closed to new members.',
  acceptingFailed: "Couldn't change this. Nothing was changed. Check your connection and try again.",
  acceptingNotCommissioner: 'Only a commissioner can change who can join.',
  acceptingPaused: 'Unavailable while the league is paused.',
  // ── leave (DI-460, DI-461, Q-W (a))
  leaveRow: 'Leave League',
  leaving: 'Leaving…',
  leaveDanger: 'Leave League',
  leaveArchiveDanger: 'Leave and Archive',
  cancel: 'Cancel',
  weekWaitOne: 'You can leave after this week is final.',
  weekWaitMany: 'You can leave after these weeks are final.',
  leaveMessageBase: "You'll lose access right away. Your picks and results stay in the league's history.",
  leaveOpenWeekPicks: " Picks you've made for the current week won't be scored.",
  archiveLead: "You're the only member.",
  archiveMessage: "Nobody in it will be able to make picks or send messages. Its history is kept. You can't undo this yourself.",
  deleteAccountPointer: 'Want your account gone instead? Profile, then Delete Account.',
  staleHandOff: 'Your league changed while you were here. Choose who should take over.',
  staleArchive: 'Your league changed while you were here.',
});

const plural = (n, one, many) => (n === 1 ? one : many);
/** The league's name for a sentence: trimmed, never empty (a name that has not loaded reads "this league"). */
export const leagueLabel = (name) => String(name == null ? '' : name).trim() || 'this league';

export const leaveFailed = (league) => `Couldn't leave ${leagueLabel(league)}. You're still a member. Check your connection and try again.`;
export const leaveAppliedRefreshFailed = (league) => `You left ${leagueLabel(league)}, but this page couldn't refresh. Reload to continue.`;
export const leaveUnconfirmed = (league) => `We couldn't confirm whether you left ${leagueLabel(league)}. Reload to check.`;
export const leaveNotAMember = (league) => `You're no longer in ${leagueLabel(league)}.`;
/** SC-L3: a PLAYER's leave answered `last_commissioner` means the league has no active commissioner; a retry cannot help, so the copy offers none. */
export const leaveHeadless = (league) => `You can't leave ${leagueLabel(league)} right now because it has no commissioner. Send us feedback from the menu and we'll fix it.`;
export const leaveToast = (league, archived = false) => (archived ? `You left ${leagueLabel(league)}. It was archived.` : `You left ${leagueLabel(league)}.`);
export const preflightFailed = (league) => `Couldn't check ${leagueLabel(league)}. Nothing was changed. Check your connection and try again.`;
export const leaveSheetTitle = (league) => `Leave ${leagueLabel(league)}?`;
export const leaveArchiveSheetTitle = (league) => `Leave and archive ${leagueLabel(league)}?`;
/** Q-W (a): the sentence under a dimmed Leave row (and the copy of a server `week_in_progress`). `n` is how many of the person's own weeks are in progress. */
export const leaveBlockedSentence = (n = 1) => (Number(n) > 1 ? LS_COPY.weekWaitMany : LS_COPY.weekWaitOne);

/**
 * The leave confirmation sheet's words. `obligationCount` is the number of the leaver's unsettled obligations (a number that can be ZERO: it is compared, never rendered through a
 * template that drops a falsy value); `openWeekPicks` is true only when the leaver has picks in a week that is still OPEN (leaving before lock): Q-W (a) refuses a locked or live
 * week outright, so "won't be scored" now applies to an open week only. `archive` selects the league-of-one sheet, which carries NO obligation or picks sentence.
 */
export function leaveSheetCopy({ leagueName = '', obligationCount = 0, openWeekPicks = false, archive = false } = {}) {
  if (archive) {
    return { title: leaveArchiveSheetTitle(leagueName), message: `${LS_COPY.archiveLead} ${LS_COPY.archiveMessage}`, danger: LS_COPY.leaveArchiveDanger, cancel: LS_COPY.cancel };
  }
  const n = Number(obligationCount) > 0 ? Math.floor(Number(obligationCount)) : 0;
  let message = LS_COPY.leaveMessageBase;
  if (n > 0) message += ` You have ${n} unsettled ${plural(n, 'obligation', 'obligations')} here. They stay on the league's record for your commissioner to settle or waive.`;
  if (openWeekPicks === true) message += LS_COPY.leaveOpenWeekPicks;
  return { title: leaveSheetTitle(leagueName), message, danger: LS_COPY.leaveDanger, cancel: LS_COPY.cancel };
}

/** The footer under the Leave group. The commissioner-only sentence is CONDITIONAL on the cached role (the client never derives "sole commissioner" or "only member"). */
export function leaveFooterCopy({ leagueName = '', isCommissioner = false } = {}) {
  const league = leagueLabel(leagueName);
  return {
    everyone: `Your picks, results and messages stay in ${league}'s history. You'll stop appearing in standings and won't get its notifications. If you rejoin with the join code you start fresh; your commissioner can restore your old spot.`,
    commissionerExtra: isCommissioner === true ? `If you're the only commissioner, you'll choose who takes over before you leave. If you're the only member, leaving archives ${league}.` : '',
    muted: LS_COPY.deleteAccountPointer,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. THE ERROR CLASSIFIER
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The kinds a failed call can read as. The first nine are NAMED refusals (the server answered, wrote nothing); `unknown` is a transport failure (it may or may not have landed). */
export const REFUSAL_KINDS = Object.freeze(['expired', 'not_a_member', 'not_commissioner', 'league_paused', 'bad_name', 'bad_open', 'week_in_progress', 'headless', 'stale', 'archive_stale']);

const NAMED = [
  ['not_authenticated', 'expired'], ['not_a_member', 'not_a_member'], ['not_commissioner', 'not_commissioner'], ['league_paused', 'league_paused'],
  ['bad_name', 'bad_name'], ['bad_open', 'bad_open'], ['week_in_progress', 'week_in_progress'],
];

/**
 * How a failed call reads. `role` is the caller's CACHED role in that league (`'commissioner'` or anything else): it only chooses between the two meanings of `last_commissioner`.
 * `isExpired` is auth.js's `isSessionExpiredError(err)`, passed in because this module imports nothing. Returns `{ kind, named }`: `named` is true for every kind but `unknown` — a
 * named refusal means NOTHING WAS WRITTEN, and an unknown outcome means the caller must refresh and look.
 */
export function classifyLeagueSettingsError(err, { role = null, isExpired = false } = {}) {
  const raw = `${(err && err.message) || ''} ${(err && err.code) || ''} ${(err && err.details) || ''}`;
  if (isExpired === true) return { kind: 'expired', named: true };
  for (const [token, kind] of NAMED) if (new RegExp(`\\b${token}\\b`).test(raw)) return { kind, named: true };
  if (/\blast_commissioner\b/.test(raw)) return { kind: role === 'commissioner' ? 'stale' : 'headless', named: true };
  if (/\barchive_confirm_required\b/.test(raw)) return { kind: 'archive_stale', named: true };
  return { kind: 'unknown', named: false };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. THE WRAPPERS — one outcome object each, never a throw for an expected failure
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

function requireDeps(deps, who, needed) {
  if (!deps || typeof deps !== 'object') throw new TypeError(`${who}() requires a deps object`);
  for (const k of needed) if (typeof deps[k] !== 'function') throw new TypeError(`${who}() requires deps.${k} to be a function`);
}
async function callRpc(deps, fn, args) {
  try {
    const res = await deps.rpc(fn, args);
    return { data: res ? res.data : null, error: res ? res.error || null : { message: 'no response' } };
  } catch (e) {
    return { data: null, error: e || { message: 'request failed' } };
  }
}
/** Whether THIS error is an expired session: the explicit flag, or the injected predicate (auth.js's isSessionExpiredError) applied to the error that actually came back. */
function expiredOf(deps, err, flag) {
  if (flag === true) return true;
  if (typeof deps.isExpired !== 'function') return false;
  try { return deps.isExpired(err) === true; } catch { return false; }
}
/** The refresh, as a boolean: a throw is "the refresh failed", never an exception out of a wrapper. */
async function refreshed(deps) {
  try { await deps.refreshMemberships(); return true; } catch { return false; }
}
/** The cached memberships after a refresh, or `null` when they cannot be READ (a throw, or something that is not a list): "cannot read" is never read as "the league is gone". */
function readList(deps) {
  try { const list = deps.getMemberships(); return Array.isArray(list) ? list : null; } catch { return null; }
}
const findLeague = (list, leagueId) => list.find((m) => m && m.leagueId === leagueId) || null;
function dropMirrorSafely(deps, reason) {
  if (typeof deps.dropMirror !== 'function') return false;
  try { deps.dropMirror(reason); return true; } catch { return false; }
}

/** The name the person typed, as the server will see it. The server trims again (only the space character) and validates; the client trim is a courtesy. */
export const trimmedName = (draft) => String(draft == null ? '' : draft).trim();
/** DI-458 enable rule: Save is enabled when the trimmed draft is non-empty and differs from the stored name. */
export const canSaveName = (draft, stored) => trimmedName(draft) !== '' && trimmedName(draft) !== String(stored == null ? '' : stored);
/** DI-458 dirty rule (the discard prompt): the raw draft differs from the stored name. */
export const isNameDirty = (draft, stored) => String(draft == null ? '' : draft) !== String(stored == null ? '' : stored);

/**
 * Rename the league (commissioner only; the server refuses everyone else). Outcomes:
 *   { status: 'done', name, inferred }          applied and the memberships refreshed (`inferred` true when a transport failure was settled by the refresh)
 *   { status: 'done_refresh_failed', name }     applied (the RPC answered) but the refresh failed
 *   { status: 'refused', kind, refreshed }      a named refusal; `not_commissioner` also refreshes (the cached role was stale)
 *   { status: 'failed' }                        a transport failure and the refresh shows the name is NOT the draft
 *   { status: 'unconfirmed' }                   a transport failure and the refresh also failed: neither outcome may be claimed
 */
export async function renameLeague(deps, { leagueId, name, role = null, isExpired = false } = {}) {
  requireDeps(deps, 'renameLeague', ['rpc', 'refreshMemberships', 'getMemberships']);
  const draft = trimmedName(name);
  const { data, error } = await callRpc(deps, 'rename_league', { p_league: leagueId, p_name: draft });
  if (!error && typeof data === 'string') {
    const ok = await refreshed(deps);
    return ok ? { status: 'done', name: data, inferred: false } : { status: 'done_refresh_failed', name: data };
  }
  const c = classifyLeagueSettingsError(error || { message: 'unexpected rename_league answer' }, { role, isExpired: expiredOf(deps, error, isExpired) });
  if (c.named) {
    const didRefresh = c.kind === 'not_commissioner' ? await refreshed(deps) : false;
    return { status: 'refused', kind: c.kind, refreshed: didRefresh };
  }
  // UNKNOWN OUTCOME (SC-L15): refresh, then decide from what the server says now.
  if (!(await refreshed(deps))) return { status: 'unconfirmed' };
  const list = readList(deps);
  if (list === null) return { status: 'unconfirmed' };
  const m = findLeague(list, leagueId);
  if (m && trimmedName(m.leagueName) === draft && draft !== '') return { status: 'done', name: draft, inferred: true };
  return { status: 'failed' };
}

/**
 * Leave a league. `confirmArchive` is sent as `p_confirm_archive` and is TRUE ONLY when it is exactly `true` (SC-L9: only the "Leave and archive" sheet passes it; a plain leave never
 * does, and never retries with true on its own). `role` is the caller's cached role in this league. Outcomes:
 *   { status: 'done', result: 'left'|'archived', inferred }   the leave landed (inferred: a transport failure settled by the refresh showing the league gone — the result is then
 *                                                             recorded as 'left': whether it also archived is unknowable and is never claimed)
 *   { status: 'done_refresh_failed', result }                 the RPC answered but the refresh failed (the mirror was dropped first: fail-closed)
 *   { status: 'refused', kind, refreshed }                    a named refusal (kinds: expired, not_a_member (also refreshes), week_in_progress, headless, stale, archive_stale)
 *   { status: 'failed' }                                      a transport failure and the refresh shows the league is STILL listed
 *   { status: 'unconfirmed' }                                 a transport failure and the refresh also failed
 */
export async function leaveLeague(deps, { leagueId, confirmArchive = false, role = null, isExpired = false } = {}) {
  requireDeps(deps, 'leaveLeague', ['rpc', 'refreshMemberships', 'getMemberships']);
  const { data, error } = await callRpc(deps, 'leave_league', { p_league: leagueId, p_confirm_archive: confirmArchive === true });
  if (!error && (data === 'left' || data === 'archived')) {
    dropMirrorSafely(deps, 'leave-league');          // BEFORE the refresh, on purpose
    const ok = await refreshed(deps);
    return ok ? { status: 'done', result: data, inferred: false } : { status: 'done_refresh_failed', result: data };
  }
  const c = classifyLeagueSettingsError(error || { message: 'unexpected leave_league answer' }, { role, isExpired: expiredOf(deps, error, isExpired) });
  if (c.named) {
    const didRefresh = c.kind === 'not_a_member' ? await refreshed(deps) : false;
    return { status: 'refused', kind: c.kind, refreshed: didRefresh };
  }
  // UNKNOWN OUTCOME (SC-L15): refresh FIRST, then choose the copy.
  if (!(await refreshed(deps))) return { status: 'unconfirmed' };
  const list = readList(deps);
  if (list === null) return { status: 'unconfirmed' };
  if (!findLeague(list, leagueId)) {
    dropMirrorSafely(deps, 'leave-league');          // the leave happened: nothing of the left league may stay on screen
    return { status: 'done', result: 'left', inferred: true };
  }
  return { status: 'failed' };
}

/**
 * Open or close the league to new members (commissioner only). `open` MUST be a boolean: a non-boolean is a programming error and throws before anything is sent (the server also
 * refuses NULL as `bad_open`). Outcomes: { status: 'done', open, inferred } | { status: 'refused', kind, refreshed } | { status: 'failed' } | { status: 'unconfirmed' }.
 * With `deps.readAccepting`, an unknown outcome is settled by re-reading the value (equal to the request -> done, inferred; different -> failed; the read fails -> unconfirmed).
 */
export async function setAcceptingMembers(deps, { leagueId, open, role = null, isExpired = false } = {}) {
  requireDeps(deps, 'setAcceptingMembers', ['rpc']);
  if (typeof open !== 'boolean') throw new TypeError('setAcceptingMembers() requires `open` to be a boolean');
  const { data, error } = await callRpc(deps, 'set_accepting_members', { p_league: leagueId, p_open: open });
  if (!error && typeof data === 'boolean') return { status: 'done', open: data, inferred: false };
  const c = classifyLeagueSettingsError(error || { message: 'unexpected set_accepting_members answer' }, { role, isExpired: expiredOf(deps, error, isExpired) });
  if (c.named) {
    let didRefresh = false;
    if (c.kind === 'not_commissioner' && typeof deps.refreshMemberships === 'function') didRefresh = await refreshed(deps);
    return { status: 'refused', kind: c.kind, refreshed: didRefresh };
  }
  if (typeof deps.readAccepting === 'function') {
    let now;
    try { now = await deps.readAccepting(leagueId); } catch { return { status: 'unconfirmed' }; }
    return now === open ? { status: 'done', open, inferred: true } : { status: 'failed' };
  }
  return { status: 'failed' };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. OUTCOME -> COPY (the refusal-to-copy mapping)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Every mapper returns { text, tone, haptic, persistent, retry, reload, action }:
//   tone        'success' | 'error' | 'note'    (success is a toast, error a persistent .lc-banner-err, note a calm line)
//   haptic      'success' | 'error' | null      (native only, behind isNativeShell(), by the caller)
//   persistent  true for every error (a banner that stays until dismissed or resolved; never a reassuring toast). A note is a calm static line, a success a toast.
//   retry       the control is live again and trying again can help
//   reload      the banner carries a Reload button
//   action      what the screen must do next: null | 'rerun-preflight' | 'rerun-preflight-archive'

const mk = (text, { tone = 'error', haptic = 'error', retry = false, reload = false, action = null } = {}) => ({ text, tone, haptic, persistent: tone === 'error', retry, reload, action });

export function renameOutcomeCopy(outcome) {
  const o = outcome || {};
  if (o.status === 'done') return mk(LS_COPY.renamed, { tone: 'success', haptic: 'success' });
  if (o.status === 'done_refresh_failed') return mk(LS_COPY.renameAppliedRefreshFailed, { reload: true });
  if (o.status === 'unconfirmed') return mk(LS_COPY.renameUnconfirmed, { reload: true });
  if (o.status === 'refused') {
    switch (o.kind) {
      case 'expired': return mk(LS_COPY.sessionExpired, { retry: true });
      case 'not_commissioner': return mk(LS_COPY.renameNotCommissioner, { retry: true });
      case 'league_paused': return mk(LS_COPY.renamePaused, { tone: 'note', haptic: null });
      case 'bad_name': return mk(LS_COPY.renameBadName, { retry: true });
      default: return mk(LS_COPY.renameFailed, { retry: true });
    }
  }
  return mk(LS_COPY.renameFailed, { retry: true });
}

export function acceptingOutcomeCopy(outcome) {
  const o = outcome || {};
  if (o.status === 'done') return mk(o.open ? LS_COPY.acceptingOpened : LS_COPY.acceptingClosed, { tone: 'success', haptic: null });
  if (o.status === 'refused') {
    switch (o.kind) {
      case 'expired': return mk(LS_COPY.sessionExpired, { retry: true });
      case 'not_commissioner': return mk(LS_COPY.acceptingNotCommissioner, { retry: true });
      case 'league_paused': return mk(LS_COPY.acceptingPaused, { tone: 'note', haptic: null });
      default: return mk(LS_COPY.acceptingFailed, { retry: true });
    }
  }
  return mk(LS_COPY.acceptingFailed, { retry: true });
}

/**
 * `ctx.leagueName` names the league in the sentence; `ctx.weekCount` (the number of the person's own weeks in progress, from the client's own data) picks the singular or plural
 * Q-W sentence for a server `week_in_progress`.
 */
export function leaveOutcomeCopy(outcome, { leagueName = '', weekCount = 1 } = {}) {
  const o = outcome || {};
  if (o.status === 'done') return mk(leaveToast(leagueName, o.result === 'archived'), { tone: 'success', haptic: 'success' });
  if (o.status === 'done_refresh_failed') return mk(leaveAppliedRefreshFailed(leagueName), { reload: true });
  if (o.status === 'unconfirmed') return mk(leaveUnconfirmed(leagueName), { reload: true });
  if (o.status === 'refused') {
    switch (o.kind) {
      case 'expired': return mk(LS_COPY.sessionExpired, { retry: true });
      case 'not_a_member': return mk(leaveNotAMember(leagueName), { tone: 'note', haptic: null });
      case 'week_in_progress': return mk(leaveBlockedSentence(weekCount), { tone: 'note', haptic: null });
      case 'headless': return mk(leaveHeadless(leagueName), { retry: false });
      case 'stale': return mk(LS_COPY.staleHandOff, { tone: 'note', haptic: null, action: 'rerun-preflight' });
      case 'archive_stale': return mk(LS_COPY.staleArchive, { tone: 'note', haptic: null, action: 'rerun-preflight-archive' });
      default: return mk(leaveFailed(leagueName), { retry: true });
    }
  }
  return mk(leaveFailed(leagueName), { retry: true });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. SMALL PURE FACTS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * G-6 (migration 0042, the Q-W time bound) — the block LAPSES this long after max(first kickoff, picks_lock_at). It is the `interval '7 days'` literal in leave_league's own week-in-progress
 * check; leaguesettingstest.mjs PARSES that literal out of the migration and compares it with this constant, so the two cannot drift. A week nobody finalizes can no longer hold a member forever.
 */
export const LEAVE_BLOCK_LAPSE_MS = 7 * 24 * 60 * 60 * 1000;

const msOrNull = (v) => {
  if (v == null || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * The G-6 anchor, in ms: the LATER of the week's first kickoff (`week.firstKickoff`, an ISO string or ms — see `firstKickoffByWeek`) and its lock time (`week.picksLockAt`), exactly as the SQL's
 * `greatest()` does it: a missing or unreadable term is SKIPPED (a NULL), and when neither exists there is NO anchor (null).
 */
export function leaveBlockAnchorMs(week) {
  if (!week) return null;
  const terms = [msOrNull(week.firstKickoff), msOrNull(week.picksLockAt)].filter((x) => x !== null);
  return terms.length ? Math.max(...terms) : null;
}

/**
 * Q-W (a) + G-6, MIRRORING THE SERVER EXACTLY. leave_league refuses `week_in_progress` when the caller has a pick in a week with `w.status in ('open','locked','live') and not
 * pick_window_open(...)` AND `coalesce(now() < greatest(first kickoff, picks_lock_at) + interval '7 days', false)`, and pick_window_open is `status = 'open' and (picks_lock_at is null or now() < picks_lock_at)`.
 * So a week is in progress when its STORED status is open, locked or live, EXCEPT an open week whose lock time has not passed (or that has none) — and only until the bound passes: seven days after the LATER
 * of its first kickoff and its lock time, the block lapses even though the week is still locked. A week with NEITHER a kickoff nor a lock time has no anchor, and the server's coalesce reads that as lapsed
 * (leave allowed) ON PURPOSE; so does this. This reads the stored `status`, `picksLockAt` and `firstKickoff` — NOT getEffectiveWeekStatus(), which returns 'open' for a stored-locked week that has a past
 * picksOpenAt and no lock time and so would disagree with the server on that corner.
 *
 * `week.firstKickoff` is the earliest kickoff among the week's games (`firstKickoffByWeek(games)` computes it; `weeksInProgressForMember` takes `games` and does it for the caller). A caller that cannot
 * supply it still gets the right answer for every week that has a lock time except for the last half hour or so of the seventh day (the lock time is normally set a configurable offset BEFORE the first kickoff,
 * so the server's anchor is later than the client's): the server stays the authority and answers `week_in_progress` with the same sentence, which the leave wrapper already shows.
 *
 * KNOWN GAP (PF-1, Drew deciding; reviewer note 2026-10-01): a week stored `open` with a NULL `picksLockAt` reads as NOT in progress here, and on the server, even after its first
 * kickoff, because today only the commissioner's own device moves a week from open to locked. The two sides agree, so the refusal is consistent; it is just later than it should be.
 * PF-1 (a server-side lock at first kickoff) would close it. Nothing here depends on PF-1 and nothing here should be bent to work around it. (PF-1 redefines pick_window_open; the G-6 bound does not read it.)
 */
export function isWeekInProgressForLeave(week, now = new Date()) {
  if (!week || typeof week.status !== 'string') return false;
  if (week.status !== 'open' && week.status !== 'locked' && week.status !== 'live') return false;
  const nowMs = now.getTime();
  if (week.status === 'open') {
    if (!week.picksLockAt) return false;
    const lock = new Date(week.picksLockAt).getTime();
    if (Number.isNaN(lock)) return false;
    if (nowMs < lock) return false;
  }
  const anchor = leaveBlockAnchorMs(week);
  if (anchor === null) return false;
  return nowMs < anchor + LEAVE_BLOCK_LAPSE_MS;
}

/**
 * The earliest kickoff (ms) of each week's games, as `{ [weekId]: ms }` — the client's `min(g.kickoff)` of the G-6 bound. `games` are game objects ({ weekId, kickoff }); a game without a week id or
 * with a missing or unreadable kickoff contributes nothing (the SQL's `min` skips NULLs). Pure; reads no storage.
 */
export function firstKickoffByWeek(games) {
  const out = Object.create(null);
  if (!Array.isArray(games)) return out;
  for (const g of games) {
    if (!g || g.weekId == null) continue;
    const t = msOrNull(g.kickoff);
    if (t === null) continue;
    if (!(g.weekId in out) || t < out[g.weekId]) out[g.weekId] = t;
  }
  return out;
}

/**
 * The ids of the weeks in progress that THE LEAVER has picks in — their own picks ONLY (the blind rule: no other player's pick is read, and nothing here returns a pick, a team or a
 * count of anyone else's). `weeks` are week objects ({ weekId, status, picksLockAt, firstKickoff? }); `picks` are pick objects ({ weekId, playerId }); `games` (optional, G-6) are game objects
 * ({ weekId, kickoff }) from which a week's `firstKickoff` is derived when the week object does not carry one. A non-empty result means the Leave row is dimmed and shows
 * `leaveBlockedSentence(result.length)`.
 */
export function weeksInProgressForMember({ weeks = [], picks = [], games = null, memberId = '', now = new Date() } = {}) {
  if (!memberId || !Array.isArray(weeks) || !Array.isArray(picks)) return [];
  const own = new Set();
  for (const p of picks) if (p && p.playerId === memberId && p.weekId != null) own.add(p.weekId);
  const first = Array.isArray(games) ? firstKickoffByWeek(games) : null;
  const out = [];
  for (const w of weeks) {
    if (!w || !own.has(w.weekId) || out.includes(w.weekId)) continue;
    const wk = first && w.firstKickoff == null && w.weekId in first ? { ...w, firstKickoff: first[w.weekId] } : w;
    if (isWeekInProgressForLeave(wk, now)) out.push(w.weekId);
  }
  return out;
}

/**
 * DI-462 section A: the roster's label for a person no longer in the league. A seat that WAS linked (`linkedAt` is kept by leave_league) and is now unlinked and inactive is
 * `(left)` — a leaver, or a deleted account; any other inactive seat is `(removed)` (a commissioner removed it, or it never linked); an active seat has no label. `active` defaults to
 * true when absent (the same `!== false` reading listLeagueMembers uses). `linked` is the boolean listLeagueMembers collapses `user_id` to; `linkedAt` passes through as the server sent it.
 */
export function departedLabel({ active, linked, linkedAt } = {}) {
  if (active !== false) return '';
  return linked !== true && !!linkedAt ? '(left)' : '(removed)';
}
/** DI-462 section A, the LEDGER surfaces (obligations, weekly history): the mirror's player carries only `active`, so any inactive seat reads "(left)" — "no longer in the league". */
export const ledgerDepartedLabel = (active) => (active === false ? '(left)' : '');

/**
 * Where a successful leave lands, from the memberships the refresh left behind (informational: the existing machinery does the moving). 'none' -> the no-league landing; 'single' -> the
 * one remaining league is auto-activated and hydrated as at boot; 'many' -> Leagues Home.
 */
export function landingAfterLeave(memberships) {
  const n = Array.isArray(memberships) ? memberships.filter((m) => m && m.leagueId).length : 0;
  return n === 0 ? 'none' : n === 1 ? 'single' : 'many';
}
