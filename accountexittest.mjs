/**
 * CFB Pickems — accountexittest.mjs
 * ==================================
 * UN-389 / DI-446 — "A sole commissioner can delete their own account" (the Delete Account sheet, client half), thread "091926-MULTISPORT", 2026-09-30.
 * A focused standalone suite beside loadtest.mjs (the leaguecreatetest.mjs / grouptest.mjs precedent): the PURE half of the sheet — js/account-exit.js, plus the action-sheet
 * builder it shares with the New League discard prompt (js/league-create.js) — proven here without booting the app. The half that needs app.js's DOM wiring (the sheet driven
 * through its real handlers against the fake client, in the order the final tap runs them) is authtest.mjs [115], which owns the fake-DOM harness those need.
 *
 * Run:  node accountexittest.mjs
 *
 * NOT covered here (say so plainly): gestures, haptics, scroll physics, the on-screen keyboard, VoiceOver, Dynamic Type and Reduce Motion are properties of a real device and
 * are outside every automated test. The server half (DI-445, migration 0035: the rule, the atomic deletion, the named refusals) is proven by supabase/tests (Drew runs the live
 * ones); a green offline suite says nothing about the real server. This file proves the copy, the state machine, the row kinds, the delete-enablement truth table, the
 * server-wins rule, every renderer (escaped, and refusing to run without escHtml), the shared action sheet, `discardSheetHTML`'s byte identity and the source tripwires.
 */

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, extra ? `\n     ${extra}` : ''); }
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
};
globalThis.window = globalThis;

const AX = await import('./js/account-exit.js');
const LC = await import('./js/league-create.js');
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const stripComments = (raw) => raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
// A faithful escHtml (the app's own shape plus the apostrophe): & < > " '
const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const icon = (name) => `<svg data-icon="${name}"></svg>`;
const deps = { escHtml, icon };

const XSS = '<img src=x onerror=alert(1)>';
const cand = (memberId, displayName) => ({ memberId, displayName });
const SAM = cand('M1', 'Sam Rivera');
const KAI = cand('M2', 'Kai Ortiz');
const row = (o = {}) => ({ leagueId: 'L1', leagueName: 'Saturday Crew', pilot: false, blocks: true, autoArchive: false, candidates: [SAM, KAI], ...o });
const live = (leagues = [{ leagueId: 'L1', leagueName: 'Saturday Crew' }]) => AX.createInitialState({ commissionerLeagues: leagues });
const ok = (st, rows) => AX.reduce(st, { type: 'preflight-ok', rows });
const typed = (st, value = 'DELETE') => AX.reduce(st, { type: 'typed', value });
const kinds = (st) => AX.listRows(st).map((r) => `${r.leagueId}:${r.kind}`).join(',');

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The copy — DI-446\'s words, verbatim, in one frozen table…');
{
  const C = AX.AX_COPY;
  assert(Object.isFrozen(C), '[1a] AX_COPY is frozen — the design input\'s words are asserted once, here, and cannot drift at a call site');
  assert(AX.CONFIRM_WORD === 'DELETE', '[1b] the typed confirmation is DELETE, exactly (DI-340\'s named deviation, kept)');
  assert(C.title === 'Delete your account?' && C.deleteBtn === 'Delete My Account' && C.deleting === 'Deleting…' && C.archiving === 'Archiving…', '[1c] the title, the button and the two sequence labels');
  assert(C.lede === "This removes your sign-in and profile. Your name, picks, and results stay part of your leagues' history — they won't be deleted, just no longer linked to your account. This can't be undone.",
    '[1d] the first paragraph is today\'s, byte for byte');
  assert(C.note === "A record of this change is kept in your league's audit history, visible only to league commissioners." && !/your commissioner\b/.test(C.note),
    '[1e] the second paragraph says "league commissioners" (true for a sole commissioner), not "your commissioner"');
  assert(C.section === 'Before you delete' && C.confirmLabel === 'Type DELETE to confirm' && C.confirmPlaceholder === 'Type DELETE', '[1f] the section heading and the typed-field label');
  assert(C.chooseNew === 'Choose a New Commissioner' && C.archiveLeague === 'Archive League' && C.cancel === 'Cancel' && C.willArchive === 'Will archive' && C.undo === 'Undo',
    '[1g] the row actions, the Cancel and the queued pill');
  assert(C.pilotNote === "This league can't be archived. Choose a new commissioner to continue.", '[1h] the pilot league\'s one-line reason');
  assert(C.pickerTitle === 'New Commissioner' && C.pickerCaption === 'Tap a name to make them commissioner.', '[1i] the picker\'s title bar and caption');
  assert(C.preflightFailed === "Couldn't check your leagues. Check your connection and try again." && C.tryAgain === 'Try Again', '[1j] the preflight-failed banner and its Try Again');
  assert(C.stale === 'Your leagues changed while you were here. Review them below.' && C.sessionExpired === 'Your session expired. Sign in again to continue.', '[1k] the stale-state and session-expired sentences');
  assert(C.deleteFailed === "Couldn't delete your account. Check your connection and try again." && C.deleteFailed.startsWith("Couldn't delete") && !/tell your commissioner/.test(C.deleteFailed),
    '[1l] the delete-failed copy keeps the "Couldn\'t delete" prefix authtest [57f] pins and drops the wrong-for-a-commissioner tail');
  assert(C.archiveMessage === "Nobody in it will be able to make picks or send messages. Its history is kept. You can't undo this yourself.", '[1m] the archive action sheet\'s message');
  assert(AX.onlyCommissionerLine(1) === "You're the only commissioner. 1 other member." && AX.onlyCommissionerLine(4) === "You're the only commissioner. 4 other members.", '[1n] the blocked row\'s line, singular and plural');
  assert(AX.onlyCommissionerLine(0) === "You're the only commissioner. No other members.", '[1o] …and the pilot league with nobody else in it');
  assert(AX.makeCommissionerLabel('Sam Rivera') === 'Make Sam Rivera Commissioner' && AX.makeCommissionerAria('Sam Rivera', 'Saturday Crew') === 'Make Sam Rivera commissioner of Saturday Crew', '[1p] the one-tap button\'s label and its full-sentence VoiceOver label');
  assert(AX.handedLine('Sam Rivera', 'Saturday Crew') === 'Sam Rivera is now commissioner of Saturday Crew.', '[1q] the handed-over row');
  assert(AX.queuedLine('Saturday Crew') === 'Saturday Crew will be archived when you delete your account.', '[1r] the queued row');
  assert(AX.autoLine('Solo Test') === 'Solo Test has no other members. It will be archived when you delete your account.', '[1s] the auto-archive row');
  assert(AX.pickerHeading('Saturday Crew') === 'Who should run Saturday Crew?' && AX.pickerEmpty('Saturday Crew') === "There's no one to hand Saturday Crew to right now.", '[1t] the picker heading and its empty state');
  assert(AX.archiveTitle('Saturday Crew') === 'Archive Saturday Crew?', '[1u] the action sheet\'s title');
  assert(AX.captionUnresolved(['Saturday Crew']) === 'Choose what happens to Saturday Crew first.' && AX.captionUnresolved(['A', 'B']) === 'Choose what happens to 2 leagues first.', '[1v] the caption under Delete, one league and several');
  assert(AX.handoffFailed('Sam Rivera') === "Couldn't make Sam Rivera commissioner. Nothing was changed. Check your connection and try again.", '[1w] the hand-off failure banner');
  assert(AX.archiveFailed('Saturday Crew') === "Couldn't archive Saturday Crew. Your account hasn't been deleted. Check your connection and try again.", '[1x] the archive failure names the league and says the account is untouched');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] The preflight gate — does the sheet ask the server at all?…');
{
  const plain = [{ leagueId: 'A', leagueName: 'A', role: 'player' }, { leagueId: 'B', leagueName: 'B', role: 'player' }];
  assert(AX.cachedCommissionerLeagues(plain).length === 0 && AX.createInitialState({ commissionerLeagues: AX.cachedCommissionerLeagues(plain) }).mode === 'skipped',
    '[2a] a plain player (no commissioner seat cached) renders today\'s sheet and makes NO preflight call (mode skipped)');
  assert(AX.cachedCommissionerLeagues([]).length === 0 && AX.cachedCommissionerLeagues(null).length === 0 && AX.cachedCommissionerLeagues(undefined).length === 0 && AX.cachedCommissionerLeagues('x').length === 0,
    '[2b] zero memberships, null, undefined and a non-array are all "no commissioner seat" — never a throw on the deletion path');
  const mixed = [{ leagueId: 'A', leagueName: 'A', role: 'player' }, { leagueId: 'B', leagueName: 'B League', role: 'commissioner' }, null, { role: 'commissioner' }, { leagueId: 7, role: 'commissioner' }];
  assert(JSON.stringify(AX.cachedCommissionerLeagues(mixed)) === '[{"leagueId":"B","leagueName":"B League"}]', '[2c] only a well-formed commissioner entry counts; malformed cache entries are skipped');
  const st = AX.createInitialState({ commissionerLeagues: AX.cachedCommissionerLeagues(mixed) });
  assert(st.mode === 'live' && st.checking === true && st.snapshot === null && st.fresh === false && st.cached.length === 1, '[2d] a cached commissioner seat opens the sheet LIVE: already checking, no snapshot yet, Delete not yet allowed');
  assert(AX.awaitingServer(st) === true && AX.canDelete(typed(st)) === false, '[2e] …and typing DELETE cannot enable Delete before the preflight has answered');
  const skipped = AX.createInitialState({});
  assert(AX.awaitingServer(skipped) === false && AX.canDelete(typed(skipped)) === true && AX.canDelete(skipped) === false, '[2f] skipped mode: Delete is enabled by the typed word alone (today\'s behaviour, unchanged)');
  assert(AX.rowsRegionHTML(skipped, deps) === '' && AX.listRows(skipped).length === 0 && AX.captionText(skipped) === '', '[2g] skipped mode renders no rows region, no row and no caption');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Row kinds — what each league shows, and when…');
{
  let s = ok(live([{ leagueId: 'L1', leagueName: 'Saturday Crew' }]), [row()]);
  assert(kinds(s) === 'L1:blocked', '[3a] a blocking, non-pilot league is Blocked (open)');
  s = ok(live(), [row({ pilot: true, leagueName: 'IRB' })]);
  assert(kinds(s) === 'L1:blockedPilot', '[3b] a blocking PILOT league is Blocked (pilot): hand-off only');
  s = ok(live(), [row({ blocks: false, autoArchive: true, candidates: [] })]);
  assert(kinds(s) === 'L1:auto', '[3c] an auto_archive league is the info row, never a blocker');
  s = ok(live(), [row({ blocks: false, autoArchive: false, candidates: [] })]);
  assert(kinds(s) === '' && AX.rowsRegionHTML(s, deps) === '' && AX.unresolvedRows(s).length === 0, '[3d] a league with neither flag (already paused, or the person is a co-commissioner) never appears — today\'s sheet, unchanged');
  s = ok(live(), []);
  assert(kinds(s) === '' && AX.rowsRegionHTML(s, deps) === '' && AX.canDelete(typed(s)) === true, '[3e] an EMPTY fresh answer means "nothing to resolve": today\'s sheet, and Delete is allowed');
  const two = ok(live([{ leagueId: 'L1', leagueName: 'Saturday Crew' }, { leagueId: 'L2', leagueName: 'Solo Test' }]),
    [row(), row({ leagueId: 'L2', leagueName: 'Solo Test', blocks: false, autoArchive: true, candidates: [] })]);
  assert(kinds(two) === 'L1:blocked,L2:auto', '[3f] several leagues: one row each, in the order they were first seen');
  // queue
  let q = AX.reduce(two, { type: 'ask-archive', leagueId: 'L1' });
  assert(q.confirmArchive === 'L1', '[3g] Archive League asks first (the action sheet is up)');
  q = AX.reduce(q, { type: 'queue-archive' });
  assert(kinds(q) === 'L1:queued,L2:auto' && q.queued.join() === 'L1' && q.confirmArchive === null, '[3h] confirming the action sheet only QUEUES the archive: the row reads Queued and nothing else has happened');
  assert(AX.unresolvedRows(q).length === 0, '[3i] a queued league counts as resolved');
  q = AX.reduce(q, { type: 'undo-archive', leagueId: 'L1' });
  assert(kinds(q) === 'L1:blocked,L2:auto' && q.queued.length === 0, '[3j] Undo puts it back to Blocked');
  const pilot = ok(live(), [row({ pilot: true })]);
  assert(AX.reduce(pilot, { type: 'ask-archive', leagueId: 'L1' }) === pilot, '[3k] the pilot league can NEVER be asked to archive (the reducer refuses, not just the markup)');
  assert(AX.reduce(two, { type: 'ask-archive', leagueId: 'L2' }) === two, '[3l] an auto-archive league cannot be asked either (it has no action)');
  assert(AX.reduce(two, { type: 'ask-archive', leagueId: 'NOPE' }) === two, '[3m] an unknown league cannot be asked');
  assert(AX.reduce(q, { type: 'queue-archive' }) === q, '[3n] queue-archive with no action sheet up does nothing');
  // hand-off
  let h = AX.reduce(ok(live(), [row()]), { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' });
  assert(h.pending && h.pending.leagueId === 'L1' && h.pending.memberId === 'M1', '[3o] a hand-off in flight is recorded');
  h = AX.reduce(h, { type: 'handoff-ok', leagueId: 'L1', leagueName: 'Saturday Crew', name: 'Sam Rivera' });
  assert(kinds(h) === 'L1:handed' && h.pending === null && h.fresh === false && AX.listRows(h)[0].handedName === 'Sam Rivera', '[3p] after a successful hand-off the row reads Handed over at once (the local record is believed until a fresh answer)');
  assert(AX.unresolvedRows(h).length === 0, '[3q] …and counts as resolved');
  assert(AX.canDelete(typed(h)) === false && AX.awaitingServer(h) === true, '[3r] …but Delete stays disabled until the re-asked preflight lands (the snapshot is no longer current)');
  h = ok(h, []);
  assert(kinds(h) === 'L1:handed' && AX.canDelete(typed(h)) === true, '[3s] a fresh answer that no longer lists the league keeps the Handed row and enables Delete');
  const inPicker = AX.reduce(AX.reduce(ok(live(), [row()]), { type: 'open-picker', leagueId: 'L1' }), { type: 'handoff-fail', text: 'nope' });
  assert(inPicker.pending === null && inPicker.pickerError === 'nope' && inPicker.notice === null, '[3t] a hand-off that fails FROM THE PICKER clears the in-flight mark and says so in the picker\'s own inline banner');
  const fromList = AX.reduce(AX.reduce(ok(live(), [row({ candidates: [SAM] })]), { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }), { type: 'handoff-fail', text: 'nope' });
  assert(fromList.pending === null && fromList.pickerError === '' && fromList.notice && fromList.notice.kind === 'err' && fromList.notice.text === 'nope',
    '[3t2] a hand-off that fails FROM THE LIST (the one-tap button never opens the picker) is said in the rows region\'s red notice — a failure is never recorded where the person cannot see it');
  assert(/role="alert"/.test(AX.rowsRegionHTML(fromList, deps)) && AX.rowsRegionHTML(fromList, deps).includes('nope'), '[3t3] …and that notice renders as a red alert banner above the cards');
  assert(AX.reduce(fromList, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }).notice === null, '[3t4] the next attempt clears the stale red notice');
  const info = AX.reduce(ok(live(), [row({ candidates: [SAM] })]), { type: 'set-notice', notice: { kind: 'info', text: AX.AX_COPY.stale } });
  assert(AX.reduce(info, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }).notice.kind === 'info', '[3t5] …but a calm "your leagues changed" info notice is not cleared by starting a hand-off');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] SERVER TRUTH WINS — a fresh answer beats this session\'s own record…');
{
  // the reviewer-shaped sequence: hand-off "succeeds", the re-asked preflight STILL lists the league as blocking (e.g. the target was an unlinked seat)
  let s = ok(live(), [row()]);
  s = AX.reduce(s, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' });
  s = AX.reduce(s, { type: 'handoff-ok', leagueId: 'L1', leagueName: 'Saturday Crew', name: 'Sam Rivera' });
  assert(kinds(s) === 'L1:handed', '[4a] fixture: locally handed over');
  s = ok(s, [row()]);
  assert(kinds(s) === 'L1:blocked' && AX.unresolvedRows(s).length === 1, '[4b] the fresh answer still lists it as blocking: it is BLOCKED again, whatever the local record says');
  assert(AX.canDelete(typed(s)) === false && AX.captionText(s) === 'Choose what happens to Saturday Crew first.', '[4c] …Delete stays disabled and the caption names the league');
  // a queued archive the server no longer lists as blocking is dropped from the queue
  let q = ok(live(), [row()]);
  q = AX.reduce(AX.reduce(q, { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' });
  assert(q.queued.join() === 'L1', '[4d] fixture: queued');
  q = ok(q, [row({ blocks: false, autoArchive: true, candidates: [] })]);
  assert(q.queued.length === 0 && kinds(q) === 'L1:auto', '[4e] a queued archive whose league the server now lists as auto-archive is dropped from the queue (the server will archive it with the deletion)');
  q = ok(AX.reduce(AX.reduce(ok(live(), [row()]), { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' }), [row({ pilot: true })]);
  assert(q.queued.length === 0 && kinds(q) === 'L1:blockedPilot', '[4f] …and one the server now says is the pilot is dropped too (the pilot is never archived here)');
  q = ok(AX.reduce(AX.reduce(ok(live(), [row()]), { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' }), []);
  assert(q.queued.length === 0 && kinds(q) === '', '[4g] …and one the server no longer lists at all');
  // an open action sheet for a league that stopped blocking closes
  let a = AX.reduce(ok(live(), [row()]), { type: 'ask-archive', leagueId: 'L1' });
  a = ok(a, []);
  assert(a.confirmArchive === null, '[4h] an action sheet whose league no longer blocks is closed by the fresh answer');
  // the picker pops if its league stops blocking
  let p = AX.reduce(ok(live(), [row()]), { type: 'open-picker', leagueId: 'L1' });
  assert(p.step === 'picker' && p.pickerLeagueId === 'L1', '[4i] fixture: the picker is open');
  p = ok(p, []);
  assert(p.step === 'list' && p.pickerLeagueId === null, '[4j] the picker pops back to the list when the server stops listing its league as blocking');
  // an archive that landed mid-run shows as archived, then the fresh answer (paused league: no flags) keeps that row
  let r = ok(live(), [row()]);
  r = AX.reduce(AX.reduce(r, { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' });
  r = AX.reduce(r, { type: 'archive-ok', leagueId: 'L1' });
  assert(kinds(r) === 'L1:archived' && r.queued.length === 0, '[4k] an archive that landed shows as archived at once');
  r = ok(r, [row({ blocks: false, autoArchive: false, candidates: [] })]);
  assert(kinds(r) === 'L1:archived', '[4l] …and the fresh answer (the league is now paused, no flags) keeps it shown as archived');
  assert(AX.changedLeagueIds(ok(live(), [row()]), AX.reduce(ok(live(), [row()]), { type: 'open-picker', leagueId: 'L1' })).length === 0, '[4m] a step change alone changes no league\'s row (no crossfade)');
  const before = ok(live(), [row()]);
  const after = AX.reduce(AX.reduce(before, { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' });
  assert(AX.changedLeagueIds(before, after).join() === 'L1' && AX.changedLeagueIds(before, before).length === 0, '[4n] the 150ms crossfade is owed to exactly the leagues whose row kind changed');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] The delete-enablement truth table — every axis, one at a time…');
{
  const clean = typed(ok(live(), []));
  assert(AX.canDelete(clean) === true, '[5a] baseline: typed DELETE, answer fresh, nothing unresolved -> enabled');
  assert(AX.canDelete(typed(ok(live(), []), 'delete')) === false && AX.canDelete(typed(ok(live(), []), 'DELETE ')) === false && AX.canDelete(typed(ok(live(), []), ' DELETE')) === false && AX.canDelete(typed(ok(live(), []), '')) === false,
    '[5b] the word must be DELETE EXACTLY (case, spaces, empty)');
  assert(AX.canDelete(typed(ok(live(), [row()]))) === false, '[5c] a Blocked league disables Delete');
  assert(AX.canDelete(typed(ok(live(), [row({ pilot: true })]))) === false, '[5d] a Blocked PILOT league disables Delete');
  assert(AX.canDelete(typed(ok(live(), [row({ blocks: false, autoArchive: true, candidates: [] })]))) === true, '[5e] an auto-archive league never blocks');
  const queued = AX.reduce(AX.reduce(ok(live(), [row()]), { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' });
  assert(AX.canDelete(typed(queued)) === true, '[5f] a queued archive resolves the league: Delete is enabled');
  assert(AX.canDelete(typed(AX.reduce(clean, { type: 'preflight-start' }))) === false, '[5g] a preflight in flight disables Delete');
  assert(AX.canDelete(typed(AX.reduce(ok(live(), []), { type: 'preflight-fail' }))) === false, '[5h] a FAILED preflight disables Delete (fail-closed)');
  assert(AX.canDelete(typed(live())) === false, '[5i] no answer yet disables Delete');
  const pending = AX.reduce(typed(ok(live(), [row()])), { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' });
  assert(pending.pending && AX.canDelete(pending) === false, '[5k] a hand-off in flight disables Delete');
  const running = AX.reduce(clean, { type: 'run-start', stage: 'archiving' });
  assert(running.running === 'archiving' && AX.canDelete(running) === false, '[5l] the final sequence running disables Delete (no double-tap)');
  assert(AX.canDelete(AX.reduce(AX.reduce(clean, { type: 'run-start', stage: 'deleting' }), { type: 'run-fail', text: 'x', stale: false })) === true, '[5m] after a failed delete with nothing archived, Delete is enabled again (the answer is still current)');
  assert(AX.canDelete(AX.reduce(AX.reduce(clean, { type: 'run-start', stage: 'archiving' }), { type: 'run-fail', text: 'x', stale: true })) === false, '[5n] after a failed ARCHIVE the answer is stale: Delete stays disabled until the re-asked preflight lands');
  assert(AX.canDelete(ok(AX.reduce(AX.reduce(clean, { type: 'run-start', stage: 'archiving' }), { type: 'run-fail', text: 'x', stale: true }), [])) === true, '[5o] …and the re-asked answer re-enables it');
  assert(AX.deleteLabel(clean) === 'Delete My Account' && AX.deleteLabel(running) === 'Archiving…' && AX.deleteLabel(AX.reduce(clean, { type: 'run-start', stage: 'deleting' })) === 'Deleting…', '[5p] the button\'s label follows the sequence');
  assert(AX.captionText(ok(live(), [row()])) === 'Choose what happens to Saturday Crew first.', '[5q] the caption names the one unresolved league');
  assert(AX.captionText(ok(live([{ leagueId: 'L1', leagueName: 'A' }, { leagueId: 'L2', leagueName: 'B' }]), [row({ leagueName: 'A' }), row({ leagueId: 'L2', leagueName: 'B' })])) === 'Choose what happens to 2 leagues first.', '[5r] …and counts when there are several');
  assert(AX.captionText(clean) === '' && AX.captionText(queued) === '', '[5s] no caption once nothing is unresolved');
  assert(AX.captionText(running) === '', '[5t] no caption while the sequence runs');
  assert(AX.dismissBlocked(running) === true && AX.dismissBlocked(clean) === false && AX.dismissBlocked(pending) === false, '[5u] dismissal is blocked while the final sequence runs — and only then (a hand-off is one short call, never a lock)');
  assert(AX.queuedInOrder(AX.reduce(AX.reduce(AX.reduce(AX.reduce(ok(live([{ leagueId: 'L1', leagueName: 'A' }, { leagueId: 'L2', leagueName: 'B' }]), [row({ leagueName: 'A' }), row({ leagueId: 'L2', leagueName: 'B' })]),
    { type: 'ask-archive', leagueId: 'L2' }), { type: 'queue-archive' }), { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' })).join() === 'L1,L2',
    '[5v] the queued archives run in LIST order (the order the rows appear), not the order they were chosen');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The renderers — every name escaped, refusing to run without escHtml…');
{
  for (const [name, fn] of [['navHTML', () => AX.navHTML(live(), {})], ['rowsRegionHTML', () => AX.rowsRegionHTML(live(), {})], ['pickerHTML', () => AX.pickerHTML(live(), {})],
    ['bodyHTML', () => AX.bodyHTML(live(), {})], ['archiveSheetHTML', () => AX.archiveSheetHTML(live(), {})]]) {
    let e = null; try { fn(); } catch (x) { e = x; }
    assert(e instanceof TypeError && /escHtml/.test(e.message), `[6a] ${name}() throws without escHtml — a league name must never render unescaped`);
  }
  const hostile = ok(live([{ leagueId: 'L1', leagueName: XSS }]), [row({ leagueName: XSS, candidates: [cand('M1', XSS), cand('M2', 'Kai')] })]);
  const listHtml = AX.rowsRegionHTML(hostile, deps);
  assert(!listHtml.includes('<img') && listHtml.includes('&lt;img src=x onerror=alert(1)&gt;'), '[6b] a league named <img onerror> is escaped in the blocked row');
  const oneHostile = ok(live([{ leagueId: 'L1', leagueName: 'Crew' }]), [row({ leagueName: 'Crew', candidates: [cand('M1', XSS)] })]);
  const oneHtml = AX.rowsRegionHTML(oneHostile, deps);
  assert(!oneHtml.includes('<img') && oneHtml.includes('Make &lt;img src=x onerror=alert(1)&gt; Commissioner') && /aria-label="Make &lt;img/.test(oneHtml), '[6c] a member named <img onerror> is escaped in the one-tap label AND its aria-label');
  const pk = AX.pickerHTML(AX.reduce(hostile, { type: 'open-picker', leagueId: 'L1' }), deps);
  assert(!pk.includes('<img') && (pk.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 3, '[6d] the picker escapes the heading, the row names and the aria-labels');
  const hostileIds = ok(live([{ leagueId: 'L"1', leagueName: 'X' }]), [row({ leagueId: 'L"1', candidates: [cand('M"1', 'Sam')] })]);
  assert(!/data-ax-league="L"1"/.test(AX.rowsRegionHTML(hostileIds, deps)) && AX.rowsRegionHTML(hostileIds, deps).includes('data-ax-league="L&quot;1"'), '[6e] ids ride in attributes through escHtml too (a quote cannot break out)');
  const arch = AX.archiveSheetHTML(AX.reduce(hostile, { type: 'ask-archive', leagueId: 'L1' }), deps);
  assert(!arch.includes('<img') && arch.includes('Archive &lt;img src=x onerror=alert(1)&gt;?'), '[6f] the action sheet\'s title escapes the league name');
  const queuedHostile = AX.reduce(AX.reduce(hostile, { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' });
  assert(!AX.rowsRegionHTML(queuedHostile, deps).includes('<img'), '[6g] the queued row escapes it');
  const handedHostile = AX.reduce(AX.reduce(hostile, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }), { type: 'handoff-ok', leagueId: 'L1', leagueName: XSS, name: XSS });
  assert(!AX.rowsRegionHTML(handedHostile, deps).includes('<img'), '[6h] the handed-over row escapes both names');
  const skel = AX.rowsRegionHTML(live([{ leagueId: 'L1', leagueName: XSS }]), deps);
  assert(!skel.includes('<img') && /ax-skel/.test(skel), '[6i] the skeleton escapes the CACHED name too');
  const pilotFallback = AX.rowsRegionHTML(ok(live([{ leagueId: 'L1', leagueName: '' }]), [row({ leagueName: '' })]), deps);
  assert(/this league/.test(pilotFallback), '[6j] a league with no name reads "this league", never an empty heading');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] The blocked / pilot / queued / auto / handed cards and the skeleton — structure…');
{
  const two = ok(live(), [row()]);
  const html2 = AX.rowsRegionHTML(two, deps);
  assert(/data-ax-state="blocked"/.test(html2) && html2.includes('Saturday Crew') && html2.includes(escHtml("You're the only commissioner. 2 other members.")), '[7a] a blocked card: the name and "only commissioner, 2 other members"');
  assert(/data-ax-action="choose"[^>]*aria-label="Choose a new commissioner for Saturday Crew"/.test(html2) && html2.includes('Choose a New Commissioner') && !/data-ax-action="handoff-one"/.test(html2),
    '[7b] TWO candidates -> "Choose a New Commissioner" (the picker), no one-tap');
  assert(/data-ax-action="ask-archive"[^>]*aria-label="Archive Saturday Crew"/.test(html2) && /ax-destructive/.test(html2), '[7c] the blocked card carries the text-destructive Archive League');
  const one = ok(live(), [row({ candidates: [SAM] })]);
  const html1 = AX.rowsRegionHTML(one, deps);
  assert(/data-ax-action="handoff-one" data-ax-league="L1" data-ax-member="M1"/.test(html1) && html1.includes('Make Sam Rivera Commissioner') && !/data-ax-action="choose"/.test(html1),
    '[7d] exactly ONE candidate -> a true one-tap "Make Sam Rivera Commissioner" carrying the league and member ids');
  const pilot = ok(live(), [row({ pilot: true, leagueName: 'IRB', candidates: [SAM, KAI] })]);
  const htmlP = AX.rowsRegionHTML(pilot, deps);
  assert(/data-ax-state="blockedPilot"/.test(htmlP) && !/ask-archive|Archive League/.test(htmlP) && htmlP.includes(escHtml("This league can't be archived. Choose a new commissioner to continue.")) && /data-ax-action="choose"/.test(htmlP),
    '[7e] the PILOT card has NO Archive control in the markup at all — hand-off only, with the reason');
  const pilotOne = AX.rowsRegionHTML(ok(live(), [row({ pilot: true, candidates: [SAM] })]), deps);
  assert(/data-ax-action="handoff-one"/.test(pilotOne) && !/Archive League/.test(pilotOne), '[7f] a pilot league with one candidate is the one-tap hand-off, still no Archive');
  const auto = AX.rowsRegionHTML(ok(live(), [row({ blocks: false, autoArchive: true, candidates: [], leagueName: 'Solo Test' })]), deps);
  assert(/data-ax-state="auto"/.test(auto) && auto.includes('Solo Test has no other members. It will be archived when you delete your account.') && !/<button/.test(auto), '[7g] the auto-archive row is an info line with NO control');
  const queued = AX.reduce(AX.reduce(two, { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' });
  const htmlQ = AX.rowsRegionHTML(queued, deps);
  assert(/ax-pill">Will archive</.test(htmlQ) && htmlQ.includes('Saturday Crew will be archived when you delete your account.') && /data-ax-action="undo-archive"[^>]*aria-label="Undo archiving Saturday Crew">Undo</.test(htmlQ), '[7h] the queued row: the gold "Will archive" pill, the sentence, an Undo with a full-sentence label');
  const handed = AX.reduce(AX.reduce(two, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }), { type: 'handoff-ok', leagueId: 'L1', leagueName: 'Saturday Crew', name: 'Sam Rivera' });
  const htmlH = AX.rowsRegionHTML(handed, deps);
  assert(/data-icon="check"/.test(htmlH) && htmlH.includes('Sam Rivera is now commissioner of Saturday Crew.') && !/<button/.test(htmlH), '[7i] the handed-over row: the check icon and the sentence, no control (state is never colour alone)');
  const busy = AX.reduce(two, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' });
  const htmlB = AX.rowsRegionHTML(busy, deps);
  assert((htmlB.match(/ disabled aria-disabled="true"/g) || []).length >= 2, '[7j] while a hand-off is in flight every control on the card is disabled');
  const busyOne = AX.rowsRegionHTML(AX.reduce(one, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }), deps);
  assert(/lc-btn-busy/.test(busyOne) && /class="lc-spin"/.test(busyOne), '[7k] …and the tapped one-tap button shows its own spinner (a spinner only inside the control whose call is running)');
  const skel = AX.rowsRegionHTML(live([{ leagueId: 'L1', leagueName: 'Saturday Crew' }, { leagueId: 'L2', leagueName: 'Second' }]), deps);
  assert((skel.match(/ax-skel"/g) || []).length === 2 && skel.includes('Saturday Crew') && skel.includes('Second') && !/<button/.test(skel), '[7l] the first ask: one skeleton card per CACHED commissioner league, names from the cache, no controls');
  assert(AX.rowsBusy(live()) === true && AX.rowsBusy(ok(live(), [])) === false && AX.rowsBusy(AX.createInitialState({})) === false, '[7m] the rows region is aria-busy exactly while a preflight is out');
  const failed = AX.reduce(live(), { type: 'preflight-fail' });
  const htmlF = AX.rowsRegionHTML(failed, deps);
  assert(/role="alert"/.test(htmlF) && htmlF.includes(escHtml("Couldn't check your leagues. Check your connection and try again.")) && /data-ax-action="retry">Try Again</.test(htmlF) && !/ax-skel/.test(htmlF), '[7n] preflight failed: a red alert banner with Try Again — LOUD, never an empty list');
  const expired = AX.reduce(live(), { type: 'preflight-fail', expired: true });
  assert(AX.rowsRegionHTML(expired, deps).includes('Your session expired. Sign in again to continue.') && !/data-ax-action="retry"/.test(AX.rowsRegionHTML(expired, deps)), '[7o] an expired session says so and does not offer a retry that cannot work');
  const noticed = AX.reduce(ok(live(), []), { type: 'set-notice', notice: { kind: 'info', text: AX.AX_COPY.stale } });
  assert(/role="status"/.test(AX.rowsRegionHTML(noticed, deps)) && AX.rowsRegionHTML(noticed, deps).includes('Your leagues changed while you were here. Review them below.'), '[7p] the stale notice renders as a calm info banner');
  const animated = AX.rowsRegionHTML(two, deps, { animate: new Set(['L1']) });
  assert(/ax-card-in/.test(animated) && !/ax-card-in/.test(AX.rowsRegionHTML(two, deps)), '[7q] only a card whose kind just changed carries the 150ms crossfade class');
  assert(/<h2[^>]*id="pwacct-delete-picker-title"[^>]*tabindex="-1"/.test(AX.pickerHTML(AX.reduce(two, { type: 'open-picker', leagueId: 'L1' }), deps)), '[7r] the picker heading is focusable (focus moves to it on push)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] The picker, the nav and the body…');
{
  const two = ok(live(), [row()]);
  const p = AX.reduce(two, { type: 'open-picker', leagueId: 'L1' });
  const pk = AX.pickerHTML(p, deps);
  assert(pk.includes('Who should run Saturday Crew?') && pk.includes('Tap a name to make them commissioner.') && (pk.match(/data-ax-action="pick"/g) || []).length === 2, '[8a] the picker: heading, caption and one row per candidate');
  assert(/data-ax-action="pick" data-ax-league="L1" data-ax-member="M1" aria-label="Make Sam Rivera commissioner of Saturday Crew"/.test(pk), '[8b] each row carries its ids and a full-sentence VoiceOver label');
  assert(AX.pickerHTML(two, deps) === '' && AX.pickerHTML(AX.reduce(p, { type: 'close-picker' }), deps) === '', '[8c] no picker markup outside the picker step');
  const busy = AX.pickerHTML(AX.reduce(p, { type: 'handoff-start', leagueId: 'L1', memberId: 'M2' }), deps);
  assert((busy.match(/disabled aria-disabled="true"/g) || []).length === 2 && /ax-pick-busy/.test(busy) && (busy.match(/class="lc-spin"/g) || []).length === 1, '[8d] a tap: every row disabled, an in-row spinner on the tapped one only');
  const err = AX.pickerHTML(AX.reduce(AX.reduce(p, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }), { type: 'handoff-fail', text: AX.handoffFailed('Sam Rivera') }), deps);
  assert(/role="alert"/.test(err) && err.includes("Couldn&#39;t make Sam Rivera commissioner. Nothing was changed.") && !/disabled aria-disabled/.test(err), '[8e] a failed hand-off: the inline red banner in the picker, rows enabled again');
  const empty = AX.pickerHTML(AX.reduce(ok(live(), [row({ candidates: [] })]), { type: 'open-picker', leagueId: 'L1' }), deps);
  assert(empty.includes("There&#39;s no one to hand Saturday Crew to right now.") && /data-ax-action="ask-archive"/.test(empty), '[8f] the empty picker (a race) says so and offers Archive League');
  const emptyPilot = AX.pickerHTML(AX.reduce(ok(live(), [row({ candidates: [], pilot: true })]), { type: 'open-picker', leagueId: 'L1' }), deps);
  assert(emptyPilot.includes('no one to hand') && !/ask-archive|Archive League/.test(emptyPilot), '[8g] …and for the PILOT league offers no Archive');
  assert(AX.reduce(two, { type: 'open-picker', leagueId: 'NOPE' }) === two, '[8h] an unknown league cannot open the picker');
  assert(AX.reduce(AX.reduce(two, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }), { type: 'open-picker', leagueId: 'L1' }).step === 'list', '[8j] the picker cannot open while a hand-off is in flight');
  assert(AX.reduce(AX.reduce(p, { type: 'handoff-start', leagueId: 'L1', memberId: 'M1' }), { type: 'close-picker' }).step === 'picker', '[8k] Back is inert while a hand-off is in flight');
  assert(AX.reduce(AX.reduce(p, { type: 'ask-archive', leagueId: 'L1' }), { type: 'queue-archive' }).step === 'list', '[8l] queueing an archive from inside the picker pops back to the list');
  const nav1 = AX.navHTML(two, deps);
  assert(/id="pwacct-delete-title"[^>]*>Delete your account\?</.test(nav1) && /id="pwacct-delete-close"[^>]*data-ax-action="close"[^>]*aria-label="Close"/.test(nav1) && /data-icon="close"/.test(nav1) && !/✕/.test(nav1),
    '[8m] the list header: the title and the close button (id byte-stable, the SVG close icon — the text glyph is gone)');
  const nav2 = AX.navHTML(p, deps);
  assert(/data-ax-action="back"[^>]*aria-label="Back to Delete your account"/.test(nav2) && /data-icon="chevronLeft"/.test(nav2) && nav2.includes('>New Commissioner<') && !/pwacct-delete-close/.test(nav2),
    '[8n] the picker header: a back chevron and the "New Commissioner" title (the close id belongs to the list header)');
  const body = AX.bodyHTML(two, deps);
  for (const id of ['pwacct-delete-confirm', 'pwacct-delete-submit', 'pwacct-delete-message', 'pwacct-delete-rows', 'pwacct-delete-caption', 'pwacct-delete-list', 'pwacct-delete-picker']) {
    assert(new RegExp(`id="${id}"`).test(body), `[8o] the body carries #${id}`);
  }
  assert(/id="pwacct-delete-submit"[^>]*disabled>Delete My Account</.test(body) && /class="btn btn-danger btn-block ax-delete"/.test(body), '[8p] Delete starts disabled, the danger button, the 50px class');
  assert(/id="pwacct-delete-confirm"[^>]*autocomplete="off"[^>]*autocapitalize="characters"[^>]*autocorrect="off"[^>]*spellcheck="false"[^>]*enterkeyhint="done"/.test(body), '[8q] the typed field carries the keyboard hints (characters, no autocorrect, no spellcheck, Done)');
  assert(/id="pwacct-delete-message"[^>]*role="alert"[^>]*style="display:none"/.test(body), '[8r] the message line starts hidden and is an alert region');
  assert(/id="pwacct-delete-rows" aria-live="polite" aria-busy="true"/.test(AX.bodyHTML(live(), deps)) && /id="pwacct-delete-rows" aria-live="polite" aria-busy="false"/.test(body) && /id="pwacct-delete-picker" hidden/.test(body), '[8s] the rows region is a polite live region (busy while asking); the picker pane starts hidden');
  assert(body.includes(escHtml(AX.AX_COPY.lede)) && body.includes(escHtml(AX.AX_COPY.note)), '[8t] both paragraphs are in the body');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[9] The shared action sheet — one builder, discardSheetHTML byte-identical…');
{
  // The golden: what discardSheetHTML() returned BEFORE it became a thin caller of actionSheetHTML() (captured 2026-09-30 from the N1 tree at 85cad03, sha256 fa9a5905…47e1).
  const GOLDEN = "<div class=\"lc-scrim\" data-lc-action=\"keep-editing\"></div>\n    <div class=\"lc-actionsheet\" role=\"alertdialog\" aria-modal=\"true\" aria-labelledby=\"lc-discard-title\">\n      <div class=\"lc-as-grp\"><div class=\"lc-as-ttl\" id=\"lc-discard-title\">Discard new league?</div>\n        <button type=\"button\" class=\"lc-as-act lc-as-danger\" data-lc-action=\"discard\">Discard</button></div>\n      <div class=\"lc-as-grp\"><button type=\"button\" class=\"lc-as-act lc-as-bold\" data-lc-action=\"keep-editing\">Keep Editing</button></div>\n    </div>";
  assert(LC.discardSheetHTML({ escHtml }) === GOLDEN, '[9a] discardSheetHTML() is BYTE-IDENTICAL to its pre-generalization output (the N1 frame 11 markup)');
  const { createHash } = await import('node:crypto');
  assert(createHash('sha256').update(LC.discardSheetHTML({ escHtml })).digest('hex') === 'fa9a590503cbb3adbeadb2a5ac5333c4d2fbe6dc326e4cfc4d821329e73547e1', '[9b] …and its sha256 matches the one recorded from the N1 tree');
  let e = null; try { LC.discardSheetHTML({}); } catch (x) { e = x; }
  assert(e instanceof TypeError && /discardSheetHTML\(\) requires an escHtml/.test(e.message), '[9c] discardSheetHTML() still refuses to run without escHtml, naming itself');
  e = null; try { LC.actionSheetHTML({}); } catch (x) { e = x; }
  assert(e instanceof TypeError && /actionSheetHTML\(\) requires an escHtml/.test(e.message), '[9d] actionSheetHTML() refuses too');
  const generic = LC.actionSheetHTML({ escHtml, titleId: 't', title: 'T?', scrimAction: 's', danger: { label: 'Do', action: 'do' }, cancel: { label: 'Stop', action: 'stop' } });
  assert(/class="lc-scrim" data-lc-action="s"/.test(generic) && /role="alertdialog" aria-modal="true" aria-labelledby="t"/.test(generic) && /class="lc-as-ttl" id="t">T\?</.test(generic) && !/lc-as-msg/.test(generic), '[9e] the generic builder with no message: the discard prompt\'s shape');
  const withMsg = LC.actionSheetHTML({ escHtml, titleId: 't', title: 'T?', message: 'Because.', scrimAction: 's', danger: { label: 'Do', action: 'do' }, cancel: { label: 'Stop', action: 'stop' }, actionAttr: 'data-ax-action' });
  assert(/lc-as-ttl lc-as-ttl-has-msg" id="t"/.test(withMsg) && /<div class="lc-as-msg">Because\.<\/div>/.test(withMsg) && /data-ax-action="do"/.test(withMsg) && /data-ax-action="stop"/.test(withMsg) && !/data-lc-action/.test(withMsg), '[9f] a message adds the muted line; the action attribute name is the caller\'s');
  const xss = LC.actionSheetHTML({ escHtml, titleId: 'a"b', title: XSS, message: XSS, scrimAction: 'x"y', danger: { label: XSS, action: 'd"d' }, cancel: { label: XSS, action: 'c"c' } });
  assert(!xss.includes('<img') && !/a"b|x"y|d"d|c"c/.test(xss) && xss.includes('a&quot;b') && xss.includes('x&quot;y') && xss.includes('d&quot;d') && xss.includes('c&quot;c'), '[9g] every interpolated value — the title, the message, both labels, every id and action — is escaped');
  const state = AX.reduce(ok(live(), [row()]), { type: 'ask-archive', leagueId: 'L1' });
  const arch = AX.archiveSheetHTML(state, deps);
  assert(/class="lc-scrim" data-ax-action="cancel-archive"/.test(arch), '[9h] the archive sheet\'s scrim is CANCEL (a tap outside never confirms)');
  assert(arch.includes('Archive Saturday Crew?') && arch.includes("Nobody in it will be able to make picks or send messages. Its history is kept. You can&#39;t undo this yourself."), '[9i] title "Archive {League}?" and the message');
  assert(/lc-as-danger" data-ax-action="confirm-archive">Archive League</.test(arch) && /lc-as-bold" data-ax-action="cancel-archive">Cancel</.test(arch), '[9j] destructive Archive League, bold Cancel');
  assert(AX.archiveSheetHTML(ok(live(), [row()]), deps) === '' && AX.archiveSheetHTML(AX.reduce(ok(live(), [row({ pilot: true })]), { type: 'ask-archive', leagueId: 'L1' }), deps) === '', '[9k] no sheet unless a league is being asked about (and the pilot never is)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[10] The error classifier — a refusal is "your leagues changed", never "check your connection"…');
{
  const C = AX.classifyExitError;
  assert(C({ message: 'not_last_commissioner', code: 'P0001' }) === 'stale' && C({ message: 'pilot_league_protected' }) === 'stale', '[10a] the two named archive refusals are STALE (re-ask)');
  assert(C({ message: 'not_authenticated', code: '28000' }) === 'expired' && C({ message: 'x' }, { isExpired: true }) === 'expired', '[10b] not_authenticated, or auth.js\'s own expiry verdict, is EXPIRED');
  assert(C(new Error('network down')) === 'failed' && C(null) === 'failed' && C({}) === 'failed' && C(new TypeError('Failed to fetch')) === 'failed', '[10c] transport and unnamed failures are plain FAILED');
  assert(C({ message: 'not_last_commissioner' }) !== 'expired' && C({ message: 'some not_authenticated_thing' }) === 'failed', '[10d] tokens are matched whole (not_last_commissioner is not last_commissioner; a longer word does not match)');
  assert(C({ details: 'pilot_league_protected' }) === 'stale', '[10e] the PostgREST `details` field is read too');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[11] Source tripwires — the wiring honours the design input…');
{
  const app = stripComments(src('./js/app.js'));
  const ax = stripComments(src('./js/account-exit.js'));
  const auth = stripComments(src('./js/auth.js'));
  assert(!/from '\.\/app\.js'|from '\.\/auth\.js'|from '\.\/storage\.js'/.test(ax) && !/\blocalStorage\b|\bfetch\(|document\./.test(ax), '[11a] account-exit.js is PURE: it imports nothing from app.js / auth.js / storage.js and touches no DOM, network or storage');
  assert(/import \{ actionSheetHTML \} from '\.\/league-create\.js'/.test(ax), '[11b] …its one import is the shared action-sheet builder');
  assert(/import \* as AX from '\.\/account-exit\.js'/.test(app), '[11c] app.js imports the pure half');
  const start = app.indexOf('const AX_WRAP_ID');
  const end = app.indexOf('function settleDeleteAccountDrag');
  const region = app.slice(start, end + 900);
  assert(start > 0 && end > start, '[11d] fixture: the Delete Account section is where the tripwires expect it');
  assert(!/\.blocks\b|\.autoArchive\b|role\s*===\s*'commissioner'/.test(region), '[11e] app.js NEVER re-derives eligibility: no `.blocks`, `.autoArchive` or commissioner-role test in the sheet\'s wiring (the rule is the server\'s; the pure module renders it)');
  const calls = region.match(/archiveLeagueOnExit\(/g) || [];
  assert(calls.length === 1, `[11f] archiveLeagueOnExit() is called from exactly ONE place (got ${calls.length})`);
  const runFn = (region.match(/async function runDeleteAccount\(\)[\s\S]*?\n\}\n/) || [''])[0];
  assert(runFn.length > 500 && runFn.indexOf('archiveLeagueOnExit(') > -1 && runFn.indexOf('archiveLeagueOnExit(') < runFn.indexOf('deleteOwnAccount()'), '[11g] …and it is in the FINAL-TAP function, strictly before deleteOwnAccount() (D-5: the irreversible step waits for the last tap)');
  const clickFn = (region.match(/function onDeleteSheetClick\(e\)[\s\S]*?\n\}\n/) || [''])[0];
  assert(/case 'confirm-archive': axDispatch\(\{ type: 'queue-archive' \}\)/.test(clickFn) && !/archiveLeagueOnExit|deleteOwnAccount|setMemberRole/.test(clickFn), '[11h] confirming the action sheet only QUEUES; no click handler calls the archive, the hand-off or the deletion itself');
  assert(/setMemberRole\(leagueId, memberId, 'commissioner'\)/.test(region), '[11i] the hand-off is the existing setMemberRole() (admin_set_member_role), never a new writer');
  assert(/getAccountExitLeagues\(\)/.test(region) && /if \(st\.mode === 'live'\) runAccountExitPreflight\(\)/.test(region), '[11j] the preflight runs only in live mode (a cached commissioner seat)');
  assert(/mountSheetShell\(\{[\s\S]*wrapId: AX_WRAP_ID/.test(region) && /AX_WRAP_ID = 'pwacct-delete-overlay'/.test(region), '[11k] the sheet is mounted through the shared mountSheetShell() under the byte-stable wrap id');
  for (const id of ['pwacct-delete-confirm', 'pwacct-delete-submit', 'pwacct-delete-message']) {
    assert(region.includes(`'${id}'`), `[11l] app.js still addresses #${id} by that exact id`);
  }
  assert(/if \(isContentWithheld\(\)\) return;/.test(region), '[11m] the sheet refuses to open while content is withheld (the guard every body-appended surface carries)');
  assert(/\bhaptic\('selection'\)/.test(region) && /\bhaptic\('warning'\)/.test(region) && /\bhaptic\('light'\)/.test(region) && /\bhaptic\('medium'\)/.test(region) && /\bhaptic\('success'\)/.test(region) && /\bhaptic\('error'\)/.test(region),
    '[11n] the six haptic kinds DI-446 names are all used, through haptic() (native only; it no-ops on web)');
  assert(!/navigator\.vibrate/.test(region), '[11o] no web haptic equivalent (haptics are native only)');
  assert(/excludeDelete/.test(app) && /getElementById\('pwacct-delete-overlay'\)/.test(app), '[11p] the dismiss-blocking-surface list knows the sheet, with its own carve-out');
  assert(/getElementById\?\.\('pwacct-delete-overlay'\)/.test(stripComments(src('./js/nav-gestures.js'))), '[11q] gesturesSuspended() knows the sheet (a week swipe / pull-to-refresh must not arm underneath)');
  assert(/getElementById\?\.\('pwacct-delete-overlay'\)/.test(stripComments(src('./js/control-center.js'))), '[11r] the drawer\'s own blocking list knows the sheet');
  assert(/export async function getAccountExitLeagues\(\)/.test(auth) && /client\.rpc\('account_exit_leagues'\)/.test(auth) && /export async function archiveLeagueOnExit\(leagueId\)/.test(auth) && /client\.rpc\('archive_league_on_exit', \{ p_league: leagueId \}\)/.test(auth),
    '[11s] auth.js: the two wrappers call the two RPCs by the names and argument the DI-445 contract freezes');
  const getFn = (auth.match(/export async function getAccountExitLeagues\(\)[\s\S]*?\n\}\n/) || [''])[0];
  assert(/if \(error\) throw error;/.test(getFn) && /if \(!Array\.isArray\(data\)\) throw/.test(getFn), '[11t] the preflight wrapper THROWS on an RPC error and on a non-list reply (never an empty list read as "nothing to resolve")');
  const archFn = (auth.match(/export async function archiveLeagueOnExit\(leagueId\)[\s\S]*?\n\}\n/) || [''])[0];
  assert(archFn.indexOf("rpc('archive_league_on_exit'") < archFn.indexOf('refreshMembershipsAndSession()'), '[11u] the archive wrapper calls the RPC, THEN refreshes the memberships');
  assert(/Choose a new commissioner or archive it first\./.test(src('./js/auth.js')) && /You're the only commissioner of a league that still has members\./.test(src('./js/auth.js')) && !/Hand it to another commissioner before deleting/.test(src('./js/auth.js')),
    '[11v] AccountDeleteRefusedError\'s default sentence is the approved one (the dead-end "hand it to another commissioner" is gone)');
  const sw = src('./service-worker.js');
  assert(sw.includes("'./js/account-exit.js'"), '[11w] service-worker.js STATIC_ASSETS precaches ./js/account-exit.js (RG-236\'s class: a shell one module short serves a graph that cannot resolve)');
  const lt = src('./loadtest.mjs');
  assert(/\n  'account-exit',\n\]\) \{/.test(lt), '[11x] loadtest.mjs section [1] imports js/account-exit.js (added to the existing list, the harness not regenerated)');
  const priv = src('./privacy.html');
  assert(priv.includes('<li>You can delete your account yourself in the app, under Profile → Delete Account.</li>') && priv.includes('ask the administrator to delete your account and personal details. Email the address below.'), '[11y] privacy.html names the in-app path AND keeps the email option');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[12] CSS — token-only, the sheet\'s shell, motion tokens, ≥600px modal, Reduce Motion…');
{
  const css = src('./css/styles.css');
  const i = css.indexOf('UN-389 / DI-446 (2026-09-30) — THE DELETE ACCOUNT SHEET');
  assert(i > -1, '[12a] fixture: the Delete Account CSS block is present');
  // SP-56 (2026-09-30) — BOUNDED, not sliced to EOF (the layouttest A10k precedent, PASS 1b 2026-09-20). This slice used to run to the literal end of styles.css, which
  // was harmless only until a later thread appended its own block below: DI-473's append-only `.stand-*` block carries the one white-on-maroon `color:#fff`
  // (the same declaration `.dashboard-table th` makes) and [12b] answered for it as if the Delete Account sheet had regressed. The block ends where the next
  // banner-style comment ("/* ── …") begins — the convention an appended block opens with; nothing inside the Delete Account block uses it.
  const nextBanner = css.indexOf('\n/* ── ', i + 1);
  const block = css.slice(i, nextBanner > i ? nextBanner : undefined);
  assert(block.length > 800, '[12a2] fixture: the bounded Delete Account CSS block is non-trivial (a bound that cut it to nothing would make [12b]/[12c] vacuous)');
  const noComments = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert((noComments.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length === 0, '[12b] no hardcoded hex colour in the block');
  assert((noComments.match(/rgba?\([^)]*\)/g) || []).length === 0, '[12c] no literal colour at all (the block uses tokens only)');
  assert(/#pwacct-delete-overlay\{position:fixed;inset:0;z-index:8000\}/.test(noComments) && /#pwacct-delete-overlay ~ \.modal-overlay\{z-index:8100\}/.test(noComments) && /html:has\(#pwacct-delete-overlay\)\{overflow:hidden\}/.test(noComments),
    '[12d] the wrap is a fixed full-screen shell at the sheet tier (8000); a modal raised over it paints above (8100); the page behind does not scroll');
  assert(/animation-duration:var\(--motion-modal\)/.test(noComments) && /transition:transform var\(--motion-modal\) var\(--ease-native\)/.test(noComments), '[12e] the sheet uses the modal motion token (300ms) and the native curve, not literals');
  assert(/lc-fade var\(--motion-fast\)/.test(noComments) && /var\(--motion-nav\)/.test(noComments), '[12f] the state crossfade = the fast token; the backdrop = the nav token');
  assert(!/transition:\s*all/.test(noComments), '[12g] no `transition: all` (named properties only)');
  const presses = noComments.match(/:active[^{]*\{[^}]*\}/g) || [];
  assert(presses.length >= 1 && presses.every((p) => /scale\(\.97\)/.test(p)), '[12h] the new pressable controls compress to 97%');
  assert(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?#pwacct-delete-sheet\{transition:none;animation:lc-fade var\(--motion-fast\) ease-out\}/.test(noComments), '[12i] Reduce Motion: the sheet takes no slide (transition off) and arrives on the 150ms crossfade instead');
  assert(/@media \(min-width:600px\) and \(prefers-reduced-motion:reduce\)\{\s*#pwacct-delete-sheet\{animation:lc-fade var\(--motion-fast\) ease-out\}/.test(noComments), '[12i2] …including the centred modal at ≥600px (the later ≥600 rule would otherwise bring the slide back)');
  assert(/@media \(min-width:600px\)\{[\s\S]*?#pwacct-delete-sheet\{[^}]*width:480px/.test(noComments), '[12j] ≥600px: a 480px centred modal (PARITY-BY-DESIGN)');
  assert(/\.ax-field\{[^}]*font-size:1\.06rem/.test(noComments), '[12k] the typed field is ≥16px (WKWebView never zooms the page on focus)');
  assert(/\.ax-delete\{min-height:50px;transition:transform 120ms ease-out/.test(noComments) && /\.ax-nav-btn\{[^}]*min-height:44px/.test(noComments), '[12l] targets: Delete 50px (pressing over 120ms), nav buttons 44px');
  assert(/\.ax-caption\{min-height:24px/.test(noComments), '[12m] the caption reserves its line (no layout jump when it appears)');
  assert(/#pwacct-delete-overlay\[data-closing="fade"\]\{opacity:0;transition:opacity var\(--motion-fast\) linear\}/.test(noComments), '[12n] the exit under Reduce Motion is a 150ms crossfade');
  assert(/body\.native-shell #pwacct-delete-sheet \.chat-sheet-header\{position:relative;padding-top:14px;touch-action:none\}/.test(noComments), '[12o] native: the header owns its vertical touches (the swipe-down handle) and carries the grabber');
  const ladderAt = css.indexOf('/* ═══ Z-INDEX LADDER');
  assert(/#pwacct-delete-overlay/.test(css.slice(ladderAt, ladderAt + 2500)), '[12p] the z-index ladder comment names the sheet');
  assert(/\.ax-skel-line\{[^}]*skeleton-shimmer/.test(noComments), '[12q] the skeleton uses the shipped shimmer keyframes');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
