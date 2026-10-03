/**
 * CFB Pickems — leaguesettingstest.mjs
 * ====================================
 * SP-53 — "League Settings" (rename, the accepting-members switch, leave a league, the sole commissioner's hand-off, the "(left)" label), thread "Social Platform", 2026-09-30.
 * A focused standalone suite beside loadtest.mjs (the accountexittest.mjs / leaguecreatetest.mjs precedent): the PURE half — js/league-settings.js — proven here without booting the
 * app: the copy (DI-458/459/460/461/462, Amendment 1 SC-L3, SC-L9, SC-L15, Q-W (a)), the error classifier, the three wrappers against a fake client (the SEQUENCE of calls is the
 * thing under test), the outcome-to-copy mappers, the Q-W predicate mirrored against the server's own text, the "(left)" derivation, the rename rules and the source tripwires.
 *
 * Run:  node leaguesettingstest.mjs
 *
 * NOT covered here (say so plainly): the page, its two entry points, the action sheets, the hand-off sheet, gestures, haptics, the keyboard, scroll physics, VoiceOver, Dynamic Type and
 * Reduce Motion — the UI wiring is a later, serialized pass and the device-only properties are Drew's on-device checklist. The server half (migration 0037) is pinned by
 * supabase/tests/static.check.mjs and rolestest.mjs; what the real server answers is proven only by rls.test.mjs group leagueSettings, which Drew runs. A green offline suite says nothing
 * about the real server.
 */

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, extra ? `\n     ${extra}` : ''); }
};

const LS = await import('./js/league-settings.js');
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = read('./js/league-settings.js');
const stripComments = (raw) => raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const CODE = stripComments(SRC);
const U = (cp) => String.fromCodePoint(cp);
const steps = (log) => log.map((x) => x[0]).join('>');

// A fake client. `rpcImpl(fn, args)` returns { data, error } or throws; `refreshImpl()` may throw; `memberships` is an array or a function. `drop`: true | false (null dep) | 'throw'.
const mkDeps = ({ rpcImpl, refreshImpl = null, memberships = [], drop = true, readAccepting } = {}) => {
  const log = [];
  const deps = {
    rpc: async (fn, args) => { log.push(['rpc', fn, args]); return rpcImpl(fn, args); },
    refreshMemberships: async () => { log.push(['refresh']); if (refreshImpl) return refreshImpl(); return undefined; },
    getMemberships: () => { log.push(['get']); return typeof memberships === 'function' ? memberships() : memberships; },
    dropMirror: drop ? (reason) => { log.push(['drop', reason]); if (drop === 'throw') throw new Error('boom'); } : null,
  };
  if (readAccepting) deps.readAccepting = async (id) => { log.push(['read', id]); return readAccepting(id); };
  return { deps, log };
};
const named = (message, code = 'P0001') => ({ data: null, error: { message, code } });
const netFail = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
const MEM = (id, name, role = 'player') => ({ leagueId: id, leagueName: name, role });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The copy — the design input\'s words, verbatim, in one frozen table…');
{
  const C = LS.LS_COPY;
  assert(Object.isFrozen(C), '[1a] LS_COPY is frozen — the design input\'s words are asserted once, here, and cannot drift at a call site');
  assert(C.sessionExpired === 'Your session expired. Sign in again to continue.', '[1b] the session-expired sentence is the ordinary one');
  assert(C.renamed === 'League renamed.' && C.renameFailed === "Couldn't rename the league. Nothing was changed. Check your connection and try again."
    && C.renameAppliedRefreshFailed === "League renamed, but this page couldn't refresh. Reload to see it everywhere."
    && C.renameNotCommissioner === 'Only a commissioner can rename the league.' && C.renameBadName === "That name can't be used. Try a different one."
    && C.renamePaused === "The name can't be changed while the league is paused.", '[1c] DI-458: every rename state\'s sentence, verbatim');
  assert(C.acceptingOpened === 'Open to new members.' && C.acceptingClosed === 'Closed to new members.'
    && C.acceptingFailed === "Couldn't change this. Nothing was changed. Check your connection and try again." && C.acceptingPaused === 'Unavailable while the league is paused.',
    '[1d] DI-459: the toasts, the failure note and the paused footer, verbatim');
  assert(C.weekWaitOne === 'You can leave after this week is final.' && C.weekWaitMany === 'You can leave after these weeks are final.'
    && LS.leaveBlockedSentence(1) === C.weekWaitOne && LS.leaveBlockedSentence(2) === C.weekWaitMany && LS.leaveBlockedSentence(5) === C.weekWaitMany && LS.leaveBlockedSentence(0) === C.weekWaitOne,
    '[1e] Q-W (a): the singular and the plural sentence (the plural when more than one week), exactly as the coordinator gave them');
  assert(LS.leaveFailed('Saturday Crew') === "Couldn't leave Saturday Crew. You're still a member. Check your connection and try again."
    && LS.leaveAppliedRefreshFailed('Saturday Crew') === "You left Saturday Crew, but this page couldn't refresh. Reload to continue."
    && LS.leaveUnconfirmed('Saturday Crew') === "We couldn't confirm whether you left Saturday Crew. Reload to check."
    && LS.leaveNotAMember('Saturday Crew') === "You're no longer in Saturday Crew."
    && LS.preflightFailed('Saturday Crew') === "Couldn't check Saturday Crew. Nothing was changed. Check your connection and try again.",
    '[1f] DI-460 / SC-L15: the failure, applied-but-refresh-failed, unconfirmed, no-longer-a-member and preflight-failed sentences, verbatim');
  assert(LS.leaveHeadless('Saturday Crew') === "You can't leave Saturday Crew right now because it has no commissioner. Send us feedback from the menu and we'll fix it.",
    '[1g] SC-L3: the headless sentence, verbatim');
  assert(LS.leaveToast('Saturday Crew') === 'You left Saturday Crew.' && LS.leaveToast('Saturday Crew', true) === 'You left Saturday Crew. It was archived.',
    '[1h] the success toasts: left, and left-and-archived (DI-461)');
  assert(LS.leaveSheetTitle('Saturday Crew') === 'Leave Saturday Crew?' && LS.leaveArchiveSheetTitle('Saturday Crew') === 'Leave and archive Saturday Crew?',
    '[1i] the sheet titles');
  assert(LS.leagueLabel('') === 'this league' && LS.leagueLabel('   ') === 'this league' && LS.leagueLabel(null) === 'this league' && LS.leagueLabel(undefined) === 'this league'
    && LS.leagueLabel('  IRB  ') === 'IRB', '[1j] a name that has not loaded reads "this league" (never an empty gap or the word undefined), a name is trimmed');
  assert(C.staleHandOff === 'Your league changed while you were here. Choose who should take over.' && C.staleArchive === 'Your league changed while you were here.',
    '[1k] DI-461 / SC-L9: the two "your league changed" notices');
  // Reviewer D3 (2026-10-01): the archive consent sentence appears in TWO places on purpose — account-exit.js (AX_COPY, the delete-account hand-off) and here (LS_COPY, the leave-a-league
  // sheet) — because this module imports nothing (tripwire [11a]), so it cannot borrow the other's table. Two copies that must read the same are held together by THIS pin, read off
  // the two SOURCE files: if either side is reworded alone, this goes red.
  const archiveLiteral = (src) => { const all = [...src.matchAll(/\barchiveMessage:\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g)].map((m) => m[1]); return all.length === 1 ? all[0] : null; };
  const literalValue = (lit) => (lit && lit[0] === '"' ? JSON.parse(lit) : lit ? lit.slice(1, -1).replace(/\\(.)/g, '$1') : null);
  const lsLit = archiveLiteral(SRC);
  const axLit = archiveLiteral(read('./js/account-exit.js'));
  assert(!!lsLit && !!axLit && literalValue(lsLit) === literalValue(axLit) && literalValue(lsLit).length > 40 && literalValue(lsLit) === C.archiveMessage,
    '[1l] D3: the SC-L9 archive sentence in js/league-settings.js (LS_COPY.archiveMessage) is IDENTICAL to the one in js/account-exit.js (AX_COPY.archiveMessage), each read off its own source file exactly once, and it is what LS_COPY actually exports',
    JSON.stringify({ ls: lsLit, ax: axLit }));
  assert(literalValue(archiveLiteral(`  archiveMessage: ${axLit.replace('kept', 'Kept')},`)) !== literalValue(lsLit)
    && archiveLiteral(`  archiveMessage: ${axLit},\n  archiveMessage: ${axLit},`) === null && archiveLiteral('  nothing: 1') === null,
    '[1m] D3 teeth: the comparison is not vacuous — one reworded letter reads as a difference, and a source with the key twice or not at all reads as "not found" (so a failed extraction cannot pass as two equal nulls)');
}

console.log('\n[2] The leave sheet and footer — every sentence, conditionals only when true…');
{
  const base = "You'll lose access right away. Your picks and results stay in the league's history.";
  const s0 = LS.leaveSheetCopy({ leagueName: 'Saturday Crew' });
  assert(s0.title === 'Leave Saturday Crew?' && s0.message === base && s0.danger === 'Leave League' && s0.cancel === 'Cancel', '[2a] the plain sheet with nothing conditional: only the base sentence');
  const s1 = LS.leaveSheetCopy({ leagueName: 'Saturday Crew', obligationCount: 1 });
  assert(s1.message === `${base} You have 1 unsettled obligation here. They stay on the league's record for your commissioner to settle or waive.`, '[2b] one unsettled obligation: singular, then the verbatim tail');
  const s3 = LS.leaveSheetCopy({ leagueName: 'Saturday Crew', obligationCount: 3 });
  assert(/You have 3 unsettled obligations here\./.test(s3.message), '[2c] three: plural');
  const s0n = LS.leaveSheetCopy({ leagueName: 'Saturday Crew', obligationCount: 0 });
  assert(s0n.message === base && !/unsettled/.test(s0n.message), '[2d] ZERO obligations adds NO sentence (a count that can be zero is compared, never rendered through a falsy template)');
  assert(LS.leaveSheetCopy({ obligationCount: -2 }).message === base && LS.leaveSheetCopy({ obligationCount: 'x' }).message === base && LS.leaveSheetCopy({ obligationCount: 2.9 }).message.includes('You have 2 unsettled'),
    '[2e] a negative or non-numeric count adds nothing; a fraction floors');
  const sp = LS.leaveSheetCopy({ leagueName: 'Saturday Crew', openWeekPicks: true });
  assert(sp.message === `${base} Picks you've made for the current week won't be scored.`, '[2f] Q-W (a): the "won\'t be scored" sentence appears only for picks in a week that is still OPEN');
  assert(LS.leaveSheetCopy({ openWeekPicks: 'yes' }).message === base && LS.leaveSheetCopy({ openWeekPicks: false }).message === base, '[2g] …and only for exactly true');
  const both = LS.leaveSheetCopy({ leagueName: 'Saturday Crew', obligationCount: 2, openWeekPicks: true });
  assert(both.message === `${base} You have 2 unsettled obligations here. They stay on the league's record for your commissioner to settle or waive. Picks you've made for the current week won't be scored.`,
    '[2h] both conditionals: the obligations sentence, then the picks sentence, in that order');
  const ar = LS.leaveSheetCopy({ leagueName: 'Saturday Crew', archive: true, obligationCount: 4, openWeekPicks: true });
  assert(ar.title === 'Leave and archive Saturday Crew?' && ar.message === "You're the only member. Nobody in it will be able to make picks or send messages. Its history is kept. You can't undo this yourself."
    && ar.danger === 'Leave and Archive' && ar.cancel === 'Cancel', '[2i] DI-461: the league-of-one sheet is its own copy and carries NO obligation or picks sentence');
  const f = LS.leaveFooterCopy({ leagueName: 'Saturday Crew', isCommissioner: false });
  assert(f.everyone === "Your picks, results and messages stay in Saturday Crew's history. You'll stop appearing in standings and won't get its notifications. If you rejoin with the join code you start fresh; your commissioner can restore your old spot."
    && f.commissionerExtra === '' && f.muted === 'Want your account gone instead? Profile, then Delete Account.', '[2j] the footer for a player: the shared sentence, nothing commissioner-only, the muted pointer');
  const fc = LS.leaveFooterCopy({ leagueName: 'Saturday Crew', isCommissioner: true });
  assert(fc.commissionerExtra === "If you're the only commissioner, you'll choose who takes over before you leave. If you're the only member, leaving archives Saturday Crew.", '[2k] …and for a commissioner the conditional sentence (the client never derives "sole commissioner" or "only member")');
  assert(LS.leaveFooterCopy({ leagueName: 'X', isCommissioner: 'yes' }).commissionerExtra === '', '[2l] the commissioner sentence needs exactly `true`');
  const XSS = '<img src=x onerror=alert(1)>';
  assert(LS.leaveSheetCopy({ leagueName: XSS }).title === `Leave ${XSS}?` && LS.leaveFooterCopy({ leagueName: XSS }).everyone.includes(XSS),
    '[2m] SC-L14: a hostile league name passes through UNTOUCHED as plain text — this module never builds HTML, so the renderer owns the escaping (and tests its own)');
}

console.log('\n[3] Every string is PLAIN TEXT — no markup, no emoji, no colour…');
{
  const strings = [...Object.values(LS.LS_COPY),
    LS.leaveFailed('A'), LS.leaveAppliedRefreshFailed('A'), LS.leaveUnconfirmed('A'), LS.leaveNotAMember('A'), LS.leaveHeadless('A'), LS.leaveToast('A'), LS.leaveToast('A', true), LS.preflightFailed('A'),
    LS.leaveSheetTitle('A'), LS.leaveArchiveSheetTitle('A'), ...Object.values(LS.leaveSheetCopy({ leagueName: 'A', obligationCount: 2, openWeekPicks: true })), ...Object.values(LS.leaveSheetCopy({ leagueName: 'A', archive: true })),
    ...Object.values(LS.leaveFooterCopy({ leagueName: 'A', isCommissioner: true }))];
  assert(strings.length > 40 && strings.every((s) => typeof s === 'string'), `[3a] the scan reached every string (${strings.length})`);
  assert(strings.every((s) => !/[<>&`]/.test(s) && !/\$\{/.test(s)), '[3b] no markup characters, no backticks, no template remnants in any string');
  assert(strings.every((s) => !/\p{Extended_Pictographic}/u.test(s)), '[3c] no emoji in any string (written text in chrome is plain; icons come from the one icon family)');
  assert(strings.every((s) => !/#[0-9a-fA-F]{3,8}\b/.test(s)), '[3d] no hex colour in any string');
  assert(strings.every((s) => !/\bundefined\b|\bnull\b|\[object/.test(s)), '[3e] no undefined / null / [object] leaked into a sentence');
}

console.log('\n[3f] Every outcome of every mapper, swept: a sentence, a tone, and the flags in their place…');
{
  const outcomes = [];
  for (const kind of LS.REFUSAL_KINDS) outcomes.push({ status: 'refused', kind });
  for (const status of ['done', 'done_refresh_failed', 'unconfirmed', 'failed']) outcomes.push({ status, result: 'left', open: true, name: 'X' });
  outcomes.push({ status: 'done', result: 'archived' }, { status: 'done', open: false }, { status: 'weird' }, {}, null, undefined);
  const mappers = [['leave', (o) => LS.leaveOutcomeCopy(o, { leagueName: 'Saturday Crew', weekCount: 2 })], ['rename', LS.renameOutcomeCopy], ['accepting', LS.acceptingOutcomeCopy]];
  const bad = [];
  let n = 0;
  for (const [label, fn] of mappers) {
    for (const o of outcomes) {
      n++;
      const c = fn(o);
      const okShape = c && typeof c.text === 'string' && c.text.length > 8 && ['success', 'error', 'note'].includes(c.tone) && [null, 'success', 'error'].includes(c.haptic)
        && typeof c.persistent === 'boolean' && typeof c.retry === 'boolean' && typeof c.reload === 'boolean' && [null, 'rerun-preflight', 'rerun-preflight-archive'].includes(c.action)
        && c.persistent === (c.tone === 'error') && !/[<>&`]|\$\{|\bundefined\b|\bnull\b|\[object/.test(c.text) && (c.tone !== 'success' || c.haptic === 'success' || label === 'accepting') && !(c.reload && c.retry);
      if (!okShape) bad.push(`${label}:${JSON.stringify(o)}`);
    }
  }
  assert(bad.length === 0 && n === mappers.length * outcomes.length, `[3f] ${n} (mapper x outcome) combinations all map to a well-formed copy object (a sentence, a tone, the haptic, and persistent only for an error; never retry AND reload together; unknown outcomes fall back to the failure copy)`, bad.join(' | '));
  assert(LS.leaveOutcomeCopy(null, { leagueName: 'A' }).text === LS.leaveFailed('A') && LS.renameOutcomeCopy(undefined).text === LS.LS_COPY.renameFailed && LS.acceptingOutcomeCopy({}).text === LS.LS_COPY.acceptingFailed,
    '[3g] a missing or malformed outcome maps to the plain failure copy of its own mapper, never to a throw or to a success');
}

console.log('\n[4] The error classifier — named refusals versus an unknown outcome…');
{
  const k = (m, o = {}) => LS.classifyLeagueSettingsError({ message: m }, o);
  for (const [msg, kind] of [['not_authenticated', 'expired'], ['not_a_member', 'not_a_member'], ['not_commissioner', 'not_commissioner'], ['league_paused', 'league_paused'], ['bad_name', 'bad_name'], ['bad_open', 'bad_open'], ['week_in_progress', 'week_in_progress']]) {
    const c = k(msg);
    assert(c.kind === kind && c.named === true, `[4a] ${msg} -> ${kind}, a NAMED refusal (nothing was written)`);
  }
  assert(k('last_commissioner', { role: 'commissioner' }).kind === 'stale' && k('last_commissioner', { role: 'commissioner' }).named === true,
    '[4b] SC-L3: last_commissioner for a CACHED COMMISSIONER = stale (the league changed under them: re-ask the preflight)');
  assert(k('last_commissioner', { role: 'player' }).kind === 'headless' && k('last_commissioner').kind === 'headless' && k('last_commissioner', { role: null }).kind === 'headless',
    '[4c] SC-L3: last_commissioner for a player (or an unknown role) = headless — the league has no commissioner; the hand-off flow does not apply');
  assert(k('archive_confirm_required').kind === 'archive_stale' && k('archive_confirm_required').named === true, '[4d] SC-L9: archive_confirm_required is a stale kind of its own (re-run the preflight, show the archive sheet; never retry with true)');
  assert(k('not_last_commissioner').kind === 'unknown', '[4e] `not_last_commissioner` (archive_league_on_exit\'s refusal) does NOT read as last_commissioner: the word boundary holds');
  for (const m of ['TypeError: Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'FetchError: timeout', '']) {
    const c = k(m);
    assert(c.kind === 'unknown' && c.named === false, `[4f] ${JSON.stringify(m)} -> unknown: a transport failure may or may not have landed`);
  }
  assert(LS.classifyLeagueSettingsError(null).kind === 'unknown' && LS.classifyLeagueSettingsError(undefined).kind === 'unknown' && LS.classifyLeagueSettingsError({}).kind === 'unknown',
    '[4g] null / undefined / an empty object never throw and read as unknown');
  assert(LS.classifyLeagueSettingsError({ message: 'JWT expired', code: 'PGRST301' }, { isExpired: true }).kind === 'expired', '[4h] auth.js\'s isSessionExpiredError verdict (passed in) wins');
  assert(LS.classifyLeagueSettingsError({ message: 'permission denied for function leave_league', code: '42501' }).kind === 'unknown', '[4i] an unnamed 42501 is not mistaken for any named refusal');
  assert(LS.classifyLeagueSettingsError({ message: 'x', code: 'not_a_member' }).kind === 'not_a_member' && LS.classifyLeagueSettingsError({ message: 'x', details: 'week_in_progress' }).kind === 'week_in_progress',
    '[4j] the name is found in `code` and `details` too (PostgREST can carry it there)');
  assert(Object.isFrozen(LS.REFUSAL_KINDS) && LS.REFUSAL_KINDS.includes('headless') && LS.REFUSAL_KINDS.includes('stale') && LS.REFUSAL_KINDS.includes('archive_stale'), '[4k] the kinds table is frozen and lists the SC-L3 / SC-L9 kinds');
}

console.log('\n[5] leaveLeague — the SEQUENCE of calls is the thing under test (rpc -> dropMirror -> refresh)…');
{
  // success, in order
  {
    const { deps, log } = mkDeps({ rpcImpl: () => ({ data: 'left', error: null }) });
    const out = await LS.leaveLeague(deps, { leagueId: 'L1' });
    assert(out.status === 'done' && out.result === 'left' && out.inferred === false, '[5a] a leave that lands reads `done / left`');
    assert(steps(log) === 'rpc>drop>refresh' && log[1][1] === 'leave-league', '[5b] F4: the order is rpc, THEN dropMirror(\'leave-league\'), THEN the refresh — the mirror is dropped before the refresh so a failing refresh still leaves no left-league data');
    assert(log[0][1] === 'leave_league' && JSON.stringify(log[0][2]) === JSON.stringify({ p_league: 'L1', p_confirm_archive: false }), '[5c] the call is leave_league(p_league, p_confirm_archive = false) by default');
  }
  // SC-L9: only an exact true sends true
  for (const [v, want] of [[true, true], [false, false], [undefined, false], [null, false], ['true', false], [1, false], [{}, false]]) {
    const { deps, log } = mkDeps({ rpcImpl: () => ({ data: 'left', error: null }) });
    await LS.leaveLeague(deps, { leagueId: 'L1', confirmArchive: v });
    assert(log[0][2].p_confirm_archive === want && typeof log[0][2].p_confirm_archive === 'boolean', `[5d] SC-L9: confirmArchive ${JSON.stringify(v)} sends p_confirm_archive = ${want} (a boolean, and true ONLY for exactly true)`);
  }
  {
    const { deps } = mkDeps({ rpcImpl: () => ({ data: 'archived', error: null }) });
    const out = await LS.leaveLeague(deps, { leagueId: 'L1', confirmArchive: true });
    const copy = LS.leaveOutcomeCopy(out, { leagueName: 'Saturday Crew' });
    assert(out.status === 'done' && out.result === 'archived' && copy.text === 'You left Saturday Crew. It was archived.' && copy.tone === 'success' && copy.haptic === 'success' && copy.persistent === false,
      '[5e] an archived result reads `done / archived` and its toast says so (a success toast, a success haptic, not persistent)');
  }
  // applied but the refresh failed: the mirror is already dropped
  {
    const { deps, log } = mkDeps({ rpcImpl: () => ({ data: 'left', error: null }), refreshImpl: () => { throw new Error('refresh down'); } });
    const out = await LS.leaveLeague(deps, { leagueId: 'L1' });
    const copy = LS.leaveOutcomeCopy(out, { leagueName: 'Saturday Crew' });
    assert(out.status === 'done_refresh_failed' && out.result === 'left' && steps(log) === 'rpc>drop>refresh', '[5f] the RPC answered but the refresh threw: `done_refresh_failed`, and the mirror was ALREADY dropped (fail-closed)');
    assert(copy.text === "You left Saturday Crew, but this page couldn't refresh. Reload to continue." && copy.reload === true && copy.tone === 'error' && copy.persistent === true && !/Couldn't leave/.test(copy.text),
      '[5g] its copy names the truth (you DID leave), carries a Reload, is persistent, and never says "Couldn\'t leave"');
  }
  // a throwing dropMirror must not stop the refresh; a null dropMirror is fine
  {
    const { deps, log } = mkDeps({ rpcImpl: () => ({ data: 'left', error: null }), drop: 'throw' });
    let out;
    try { out = await LS.leaveLeague(deps, { leagueId: 'L1' }); } catch (e) { out = { status: `threw: ${e.message}` }; }
    assert(out.status === 'done' && steps(log) === 'rpc>drop>refresh', '[5h] a dropMirror that throws is swallowed and the refresh still runs', out.status);
    const n = mkDeps({ rpcImpl: () => ({ data: 'left', error: null }), drop: false });
    const o2 = await LS.leaveLeague(n.deps, { leagueId: 'L1' });
    assert(o2.status === 'done' && steps(n.log) === 'rpc>refresh', '[5i] with no dropMirror (not supabase data mode) the sequence is rpc, refresh');
  }
  // named refusals: nothing written, no drop; only not_a_member refreshes
  for (const [msg, role, kind, refreshes] of [['week_in_progress', 'player', 'week_in_progress', false], ['last_commissioner', 'commissioner', 'stale', false], ['last_commissioner', 'player', 'headless', false],
    ['archive_confirm_required', 'commissioner', 'archive_stale', false], ['not_authenticated', 'player', 'expired', false], ['not_a_member', 'player', 'not_a_member', true]]) {
    const { deps, log } = mkDeps({ rpcImpl: () => named(msg) });
    const out = await LS.leaveLeague(deps, { leagueId: 'L1', role });
    assert(out.status === 'refused' && out.kind === kind && out.refreshed === refreshes && !steps(log).includes('drop') && steps(log) === (refreshes ? 'rpc>refresh' : 'rpc'),
      `[5j] ${msg} as ${role} -> refused / ${kind}: no mirror drop, ${refreshes ? 'one refresh (the cached membership was stale)' : 'no refresh (a named refusal is not a transport failure)'}`, steps(log));
  }
  {
    const { deps } = mkDeps({ rpcImpl: () => named('last_commissioner') });
    const player = await LS.leaveLeague(deps, { leagueId: 'L1', role: 'player' });
    const cp = LS.leaveOutcomeCopy(player, { leagueName: 'Saturday Crew' });
    assert(cp.text === "You can't leave Saturday Crew right now because it has no commissioner. Send us feedback from the menu and we'll fix it." && cp.retry === false && cp.action === null && cp.persistent === true,
      '[5k] SC-L3: the headless copy is persistent, offers NO retry and starts NO hand-off (a player has none)');
    const { deps: d2 } = mkDeps({ rpcImpl: () => named('last_commissioner') });
    const comm = await LS.leaveLeague(d2, { leagueId: 'L1', role: 'commissioner' });
    const cc = LS.leaveOutcomeCopy(comm, { leagueName: 'Saturday Crew' });
    assert(cc.text === 'Your league changed while you were here. Choose who should take over.' && cc.action === 'rerun-preflight' && !/no commissioner/.test(cc.text),
      '[5l] …and the SAME refusal for a commissioner is the stale copy with the re-ask-the-preflight action, never the headless copy');
    const arch = LS.leaveOutcomeCopy({ status: 'refused', kind: 'archive_stale' }, { leagueName: 'Saturday Crew' });
    assert(arch.text === 'Your league changed while you were here.' && arch.action === 'rerun-preflight-archive', '[5m] SC-L9: archive_confirm_required -> the notice and the "re-run the preflight, show the archive sheet" action');
    const wk = LS.leaveOutcomeCopy({ status: 'refused', kind: 'week_in_progress' }, { leagueName: 'X', weekCount: 2 });
    assert(wk.text === 'You can leave after these weeks are final.' && LS.leaveOutcomeCopy({ status: 'refused', kind: 'week_in_progress' }, {}).text === 'You can leave after this week is final.' && wk.tone === 'note',
      '[5n] Q-W (a): a server week_in_progress shows the same sentence as the dimmed row, plural by the client\'s own week count');
    const gone = LS.leaveOutcomeCopy({ status: 'refused', kind: 'not_a_member' }, { leagueName: 'Saturday Crew' });
    assert(gone.text === "You're no longer in Saturday Crew." && gone.tone === 'note' && gone.haptic === null, '[5o] not_a_member answers calmly (a note, no error haptic)');
  }
  // UNKNOWN OUTCOME: refresh first, decide from the list (SC-L15)
  {
    const gone = mkDeps({ rpcImpl: () => netFail(), memberships: [MEM('L2', 'Other')] });
    const out = await LS.leaveLeague(gone.deps, { leagueId: 'L1', role: 'player' });
    assert(out.status === 'done' && out.result === 'left' && out.inferred === true && steps(gone.log) === 'rpc>refresh>get>drop',
      '[5p] SC-L15: a network failure, then the refresh shows the league GONE -> the success path (inferred), the mirror dropped after the refresh', steps(gone.log));
    const copy = LS.leaveOutcomeCopy(out, { leagueName: 'Saturday Crew' });
    assert(copy.text === 'You left Saturday Crew.' && !/archived/.test(copy.text), '[5q] an inferred success never claims the league was archived (that is unknowable and is not claimed)');
    const still = mkDeps({ rpcImpl: () => netFail(), memberships: [MEM('L1', 'Saturday Crew'), MEM('L2', 'Other')] });
    const o2 = await LS.leaveLeague(still.deps, { leagueId: 'L1' });
    assert(o2.status === 'failed' && steps(still.log) === 'rpc>refresh>get', '[5r] SC-L15: a network failure, then the refresh shows the league STILL listed -> the failure copy, no mirror drop');
    const c2 = LS.leaveOutcomeCopy(o2, { leagueName: 'Saturday Crew' });
    assert(c2.text === "Couldn't leave Saturday Crew. You're still a member. Check your connection and try again." && c2.retry === true && c2.persistent === true && c2.haptic === 'error', '[5s] …whose copy says you are still a member, is persistent and lets the person try again');
    const dead = mkDeps({ rpcImpl: () => netFail(), refreshImpl: () => { throw new Error('offline'); } });
    const o3 = await LS.leaveLeague(dead.deps, { leagueId: 'L1' });
    const c3 = LS.leaveOutcomeCopy(o3, { leagueName: 'Saturday Crew' });
    assert(o3.status === 'unconfirmed' && steps(dead.log) === 'rpc>refresh' && c3.text === "We couldn't confirm whether you left Saturday Crew. Reload to check." && c3.reload === true,
      '[5t] SC-L15: the refresh ALSO fails -> the third honest state with a Reload, no mirror drop, no claim either way');
    assert(!/You left|Couldn't leave|still a member/.test(c3.text), '[5u] the unconfirmed copy claims NEITHER outcome');
    const thrown = mkDeps({ rpcImpl: () => { throw new TypeError('Failed to fetch'); }, memberships: [MEM('L1', 'Saturday Crew')] });
    const o4 = await LS.leaveLeague(thrown.deps, { leagueId: 'L1' });
    assert(o4.status === 'failed' && steps(thrown.log) === 'rpc>refresh>get', '[5v] an rpc that THROWS (not a returned error) is treated exactly like a returned transport error');
    const weird = mkDeps({ rpcImpl: () => ({ data: 'maybe', error: null }), memberships: [MEM('L1', 'Saturday Crew')] });
    const o5 = await LS.leaveLeague(weird.deps, { leagueId: 'L1' });
    assert(o5.status === 'failed' && steps(weird.log) === 'rpc>refresh>get', '[5w] an answer that is neither `left` nor `archived` is NOT believed: it is settled by the refresh like a transport failure');
    const empty = mkDeps({ rpcImpl: () => undefined, memberships: [] });
    const o6 = await LS.leaveLeague(empty.deps, { leagueId: 'L1' });
    assert(o6.status === 'done' && o6.inferred === true, '[5x] no response at all, then a refresh showing the league gone -> inferred success (and nothing throws)');
    const noList = mkDeps({ rpcImpl: () => netFail(), memberships: () => { throw new Error('cache read failed'); } });
    const o7 = await LS.leaveLeague(noList.deps, { leagueId: 'L1' });
    assert(o7.status === 'unconfirmed' && !steps(noList.log).includes('drop'), '[5y] a membership list that cannot be READ after a successful refresh is never read as "the league is gone": unconfirmed, and no mirror drop');
    const notList = mkDeps({ rpcImpl: () => netFail(), memberships: () => null });
    assert((await LS.leaveLeague(notList.deps, { leagueId: 'L1' })).status === 'unconfirmed', '[5y2] …nor is something that is not a list');
  }
  assert(Object.keys(await LS.leaveLeague(mkDeps({ rpcImpl: () => ({ data: 'left', error: null }) }).deps, { leagueId: 'L1' })).sort().join() === 'inferred,result,status', '[5z] the outcome carries only status, result and inferred — no pick, no member list, no personal data');
  let threw = false;
  try { await LS.leaveLeague({ rpc: () => {} }, { leagueId: 'L1' }); } catch (e) { threw = e instanceof TypeError; }
  assert(threw, '[5aa] a deps object missing refreshMemberships / getMemberships is a loud TypeError, never a silent no-op');
}

console.log('\n[5b] An expired session reads as `expired` through the injected predicate, in all three wrappers…');
{
  const expiredErr = { message: 'JWT expired', code: 'PGRST301' };
  for (const [label, run] of [
    ['leaveLeague', (deps) => LS.leaveLeague(deps, { leagueId: 'L1' })],
    ['renameLeague', (deps) => LS.renameLeague(deps, { leagueId: 'L1', name: 'X' })],
    ['setAcceptingMembers', (deps) => LS.setAcceptingMembers(deps, { leagueId: 'L1', open: true })],
  ]) {
    const { deps, log } = mkDeps({ rpcImpl: () => ({ data: null, error: expiredErr }) });
    deps.isExpired = (err) => err === expiredErr;
    const out = await run(deps);
    assert(out.status === 'refused' && out.kind === 'expired' && !steps(log).includes('drop') && !steps(log).includes('refresh'), `[5b] ${label}: auth.js's isSessionExpiredError verdict on the ACTUAL error -> refused / expired (no refresh, no mirror drop)`, JSON.stringify(out));
    const { deps: d2 } = mkDeps({ rpcImpl: () => ({ data: null, error: expiredErr }) });
    const o2 = await run(d2);
    assert(o2.kind !== 'expired', `[5b2] ${label}: without the predicate the same error is NOT assumed expired (it reads as an unknown outcome and is settled by the refresh)`);
    const { deps: d3 } = mkDeps({ rpcImpl: () => ({ data: null, error: expiredErr }) });
    d3.isExpired = () => { throw new Error('predicate bug'); };
    const o3 = await run(d3);
    assert(o3.kind !== 'expired' && typeof o3.status === 'string', `[5b3] ${label}: a predicate that throws never takes the wrapper down`);
  }
  assert(LS.leaveOutcomeCopy({ status: 'refused', kind: 'expired' }).text === 'Your session expired. Sign in again to continue.', '[5b4] the expired copy is the ordinary session-expired sentence');
}

console.log('\n[6] renameLeague — trimmed, refreshed, honest after a failure…');
{
  {
    const { deps, log } = mkDeps({ rpcImpl: (fn, a) => ({ data: a.p_name, error: null }) });
    const out = await LS.renameLeague(deps, { leagueId: 'L1', name: '   Saturday Crew   ' });
    assert(out.status === 'done' && out.name === 'Saturday Crew' && out.inferred === false && steps(log) === 'rpc>refresh', '[6a] rename: the TRIMMED name is sent, the stored value returned, then the refresh (it repaints every consumer)');
    assert(log[0][1] === 'rename_league' && JSON.stringify(log[0][2]) === JSON.stringify({ p_league: 'L1', p_name: 'Saturday Crew' }), '[6b] the call is rename_league(p_league, p_name = trimmed)');
    const copy = LS.renameOutcomeCopy(out);
    assert(copy.text === 'League renamed.' && copy.tone === 'success' && copy.haptic === 'success' && copy.persistent === false, '[6c] the toast and the success haptic');
  }
  {
    const { deps } = mkDeps({ rpcImpl: (fn, a) => ({ data: a.p_name, error: null }), refreshImpl: () => { throw new Error('x'); } });
    const out = await LS.renameLeague(deps, { leagueId: 'L1', name: 'New Name' });
    const copy = LS.renameOutcomeCopy(out);
    assert(out.status === 'done_refresh_failed' && out.name === 'New Name' && copy.text === "League renamed, but this page couldn't refresh. Reload to see it everywhere." && copy.reload === true && !/Couldn't rename/.test(copy.text),
      '[6d] applied but the refresh failed: "League renamed, but…" with a Reload — never "Couldn\'t rename"');
  }
  for (const [msg, kind, refreshes, text] of [['not_commissioner', 'not_commissioner', true, 'Only a commissioner can rename the league.'], ['league_paused', 'league_paused', false, "The name can't be changed while the league is paused."],
    ['bad_name', 'bad_name', false, "That name can't be used. Try a different one."], ['not_authenticated', 'expired', false, 'Your session expired. Sign in again to continue.']]) {
    const { deps, log } = mkDeps({ rpcImpl: () => named(msg) });
    const out = await LS.renameLeague(deps, { leagueId: 'L1', name: 'Anything' });
    const copy = LS.renameOutcomeCopy(out);
    assert(out.status === 'refused' && out.kind === kind && out.refreshed === refreshes && steps(log) === (refreshes ? 'rpc>refresh' : 'rpc') && copy.text === text,
      `[6e] ${msg} -> ${kind}: "${text}" (${refreshes ? 'then a membership refresh: the role the client held was stale' : 'no refresh'})`, steps(log));
  }
  {
    const same = mkDeps({ rpcImpl: () => netFail(), memberships: [MEM('L1', 'Saturday Crew')] });
    const out = await LS.renameLeague(same.deps, { leagueId: 'L1', name: '  Saturday Crew ' });
    assert(out.status === 'done' && out.inferred === true && out.name === 'Saturday Crew' && steps(same.log) === 'rpc>refresh>get', '[6f] SC-L15: a network failure, then the refresh shows the stored name EQUALS the draft -> the success state (inferred)');
    const diff = mkDeps({ rpcImpl: () => netFail(), memberships: [MEM('L1', 'Old Name')] });
    const o2 = await LS.renameLeague(diff.deps, { leagueId: 'L1', name: 'New Name' });
    const c2 = LS.renameOutcomeCopy(o2);
    assert(o2.status === 'failed' && c2.text === "Couldn't rename the league. Nothing was changed. Check your connection and try again." && c2.retry === true && c2.persistent === true && c2.haptic === 'error',
      '[6g] …and when the stored name is NOT the draft -> the failure copy, persistent, error haptic, the control live');
    const dead = mkDeps({ rpcImpl: () => netFail(), refreshImpl: () => { throw new Error('offline'); } });
    const o3 = await LS.renameLeague(dead.deps, { leagueId: 'L1', name: 'New Name' });
    assert(o3.status === 'unconfirmed' && LS.renameOutcomeCopy(o3).text === "We couldn't confirm whether the name changed. Reload to check." && LS.renameOutcomeCopy(o3).reload === true,
      '[6h] the refresh also failed -> unconfirmed: neither outcome is claimed');
    const blank = mkDeps({ rpcImpl: () => netFail(), memberships: [MEM('L1', '')] });
    const o4 = await LS.renameLeague(blank.deps, { leagueId: 'L1', name: '   ' });
    assert(o4.status === 'failed', '[6i] a blank draft is never "equal" to a blank stored name: an empty-equals-empty can never read as success');
  }
  assert(LS.renameOutcomeCopy({ status: 'refused', kind: 'league_paused' }).tone === 'note' && LS.renameOutcomeCopy({ status: 'refused', kind: 'league_paused' }).haptic === null, '[6j] the paused refusal is the calm field note, not an error banner');
}

console.log('\n[7] setAcceptingMembers — a boolean, never a NULL…');
{
  for (const bad of [null, undefined, 'true', 1, 0, {}, []]) {
    const { deps, log } = mkDeps({ rpcImpl: () => ({ data: true, error: null }) });
    let threw = false;
    try { await LS.setAcceptingMembers(deps, { leagueId: 'L1', open: bad }); } catch (e) { threw = e instanceof TypeError; }
    assert(threw && log.length === 0, `[7a] open = ${JSON.stringify(bad)} throws a TypeError BEFORE anything is sent (the server also refuses NULL as bad_open)`);
  }
  {
    const on = mkDeps({ rpcImpl: () => ({ data: true, error: null }) });
    const out = await LS.setAcceptingMembers(on.deps, { leagueId: 'L1', open: true });
    assert(out.status === 'done' && out.open === true && steps(on.log) === 'rpc' && on.log[0][1] === 'set_accepting_members' && JSON.stringify(on.log[0][2]) === JSON.stringify({ p_league: 'L1', p_open: true }),
      '[7b] set_accepting_members(p_league, p_open) -> done; the cache update is the caller\'s (no refresh here)');
    assert(LS.acceptingOutcomeCopy(out).text === 'Open to new members.' && LS.acceptingOutcomeCopy({ status: 'done', open: false }).text === 'Closed to new members.', '[7c] the two toasts');
  }
  for (const [msg, kind, text, refreshes] of [['not_commissioner', 'not_commissioner', 'Only a commissioner can change who can join.', true], ['league_paused', 'league_paused', 'Unavailable while the league is paused.', false],
    ['bad_open', 'bad_open', "Couldn't change this. Nothing was changed. Check your connection and try again.", false], ['not_authenticated', 'expired', 'Your session expired. Sign in again to continue.', false]]) {
    const { deps, log } = mkDeps({ rpcImpl: () => named(msg) });
    const out = await LS.setAcceptingMembers(deps, { leagueId: 'L1', open: true });
    assert(out.status === 'refused' && out.kind === kind && LS.acceptingOutcomeCopy(out).text === text && steps(log) === (refreshes ? 'rpc>refresh' : 'rpc'), `[7d] ${msg} -> ${kind}: "${text}"`, steps(log));
  }
  {
    const fail = mkDeps({ rpcImpl: () => netFail() });
    const out = await LS.setAcceptingMembers(fail.deps, { leagueId: 'L1', open: false });
    assert(out.status === 'failed' && LS.acceptingOutcomeCopy(out).text === "Couldn't change this. Nothing was changed. Check your connection and try again." && LS.acceptingOutcomeCopy(out).persistent === true,
      '[7e] a transport failure with no read-back is the persistent failure note');
    const settled = mkDeps({ rpcImpl: () => netFail(), readAccepting: () => false });
    const o2 = await LS.setAcceptingMembers(settled.deps, { leagueId: 'L1', open: false });
    assert(o2.status === 'done' && o2.open === false && o2.inferred === true && steps(settled.log) === 'rpc>read', '[7f] with a read-back, a transport failure whose re-read EQUALS the request is a success (inferred)');
    const notSettled = mkDeps({ rpcImpl: () => netFail(), readAccepting: () => true });
    assert((await LS.setAcceptingMembers(notSettled.deps, { leagueId: 'L1', open: false })).status === 'failed', '[7g] …and a re-read that differs is the failure');
    const noRead = mkDeps({ rpcImpl: () => netFail(), readAccepting: () => { throw new Error('offline'); } });
    assert((await LS.setAcceptingMembers(noRead.deps, { leagueId: 'L1', open: false })).status === 'unconfirmed', '[7h] …and a re-read that also fails is unconfirmed');
  }
}

console.log('\n[8] Q-W (a) + G-6 — the "in progress" predicate MIRRORS THE SERVER, boundary and seven-day bound included…');
{
  // The LATEST leave_league is 0042's (0037's body + the G-6 bound); the SQL is parsed from THERE, so a change to it moves this test.
  const mig = read('./supabase/migrations/0042_sp53_release_gates.sql');
  const rls = read('./supabase/migrations/0002_rls.sql');
  const fnText = /^create or replace function public\.leave_league\([\s\S]*?end \$\$;/m.exec(mig);
  const code = (fnText ? fnText[0] : '').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').replace(/\s+/g, ' ');
  const inList = /w\.status in \(([^)]*)\) and not public\.pick_window_open\(w\.league_id, w\.id\)/.exec(code);
  const statuses = inList ? [...inList[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
  const pwo = /function public\.pick_window_open\([\s\S]*?\$\$;/.exec(rls);
  const pwoText = pwo ? pwo[0].replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ') : '';
  const openStatus = (/w\.status = '(\w+)'/.exec(pwoText) || [])[1];
  assert(statuses.join() === 'open,locked,live' && openStatus === 'open' && /\(w\.picks_lock_at is null or now\(\) < w\.picks_lock_at\)/.test(pwoText),
    '[8a] the SQL it mirrors is what it is said to be: leave_league\'s predicate (0042) is status in (open, locked, live) and NOT pick_window_open, and pick_window_open is "open and (no lock time or now before it)"', JSON.stringify({ statuses, openStatus }));
  // G-6: the bound, PARSED from the SQL — `coalesce(now() < greatest((select min(g.kickoff) …), w.picks_lock_at) + interval 'N days', false)`
  const boundM = /coalesce\(now\(\) < greatest\(\(select min\(g\.kickoff\) from public\.games g where g\.league_id = w\.league_id and g\.week_id = w\.id\), w\.picks_lock_at\) \+ interval '(\d+) days', false\)/.exec(code);
  const DAY = 24 * 60 * 60 * 1000;
  const sqlDays = boundM ? Number(boundM[1]) : NaN;
  assert(!!boundM && sqlDays === 7 && LS.LEAVE_BLOCK_LAPSE_MS === sqlDays * DAY,
    `[8a2] G-6: the bound is parsed out of leave_league's own SQL (greatest of the first kickoff and picks_lock_at, plus ${sqlDays} days, coalesced to false) and the client constant LEAVE_BLOCK_LAPSE_MS is exactly that many days in ms`, JSON.stringify({ sqlDays, ms: LS.LEAVE_BLOCK_LAPSE_MS }));
  // the server model, DERIVED FROM THE PARSED SQL (so a change to the SQL moves this test): greatest() skips a NULL term; neither term reads as lapsed (the coalesce)
  const NOW = new Date('2026-10-04T18:00:00Z');
  const past = '2026-10-04T17:00:00Z', future = '2026-10-04T19:00:00Z';
  const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
  const ms = (v) => (v == null || v === '' ? null : new Date(v).getTime());
  const server = (status, lockAt, kickoffAt) => {
    if (!statuses.includes(status)) return false;
    if (status === openStatus && (lockAt == null || NOW.getTime() < ms(lockAt))) return false;                       // pick_window_open is true
    const terms = [ms(kickoffAt), ms(lockAt)].filter((x) => x !== null);
    if (!terms.length) return false;                                                                                 // no anchor: coalesce(NULL, false)
    return NOW.getTime() < Math.max(...terms) + sqlDays * DAY;
  };
  const rows = [];
  const locks = [null, past, future, '', NOW.toISOString(), ago(6), ago(8)];
  const kicks = [null, ago(6), ago(8), future];
  for (const status of ['draft', 'open', 'locked', 'live', 'final']) for (const lockAt of locks) for (const kickoff of kicks) rows.push([status, lockAt, kickoff]);
  const misses = rows.filter(([status, lockAt, kickoff]) => LS.isWeekInProgressForLeave({ weekId: 'w', status, picksLockAt: lockAt, firstKickoff: kickoff }, NOW) !== server(status, lockAt || null, kickoff));
  assert(rows.length === 140 && misses.length === 0, `[8b] the client predicate equals the server model over every (stored status x lock time x first kickoff) combination (${rows.length} cases, incl. missing, equal-to-now, 6 and 8 days old, and future times)`, JSON.stringify(misses.slice(0, 5)));
  const f = (status, lockAt, kickoff) => LS.isWeekInProgressForLeave({ status, picksLockAt: lockAt, firstKickoff: kickoff }, NOW);
  assert(f('open', null) === false && f('open', future) === false && f('open', past) === true && f('open', NOW.toISOString()) === true,
    '[8c] THE BOUNDARY: a stored-OPEN week is in progress only once its lock time has PASSED (equal counts as passed, as `now() < picks_lock_at` is false)');
  assert(f('locked', past) === true && f('live', past) === true && f('locked', future) === true && f('draft', past) === false && f('final', past) === false,
    '[8d] locked and live are in progress while the bound stands (the lock time is the anchor here); draft and final never are');
  assert(f('open', 'not a date') === false && LS.isWeekInProgressForLeave(null, NOW) === false && LS.isWeekInProgressForLeave({}, NOW) === false && LS.isWeekInProgressForLeave({ status: 7 }, NOW) === false,
    '[8e] a garbled lock time or a malformed week is never "in progress" (never a throw)');
  // the corner getEffectiveWeekStatus() would get wrong: stored locked, no lock time, an open time in the past — the kickoff is the anchor
  assert(f('locked', null, ago(1)) === true && f('locked', null, null) === false,
    '[8f] a stored-LOCKED week with no lock time is in progress through its FIRST KICKOFF (getEffectiveWeekStatus() would call it "open" when a past picksOpenAt exists — this predicate reads the stored status, as the server does), and with NO anchor at all it has lapsed');
  // G-6 — the bound itself, the explicit boundary table (the same rows static.check's model runs, here through the real client predicate)
  const NOWMS = NOW.getTime();
  const iso = (n) => (n === null ? null : new Date(n).toISOString());
  const TABLE = [
    ['locked', NOWMS - 6 * DAY, NOWMS - 6 * DAY, true], ['locked', NOWMS - 8 * DAY, NOWMS - 8 * DAY, false], ['locked', NOWMS - 10 * DAY, NOWMS - 6 * DAY, true], ['locked', NOWMS - 6 * DAY, NOWMS - 10 * DAY, true],
    ['locked', NOWMS - 20 * DAY, NOWMS - 8 * DAY, false], ['locked', null, NOWMS - 8 * DAY, false], ['locked', NOWMS - 8 * DAY, null, false], ['locked', null, null, false], ['live', NOWMS - DAY, NOWMS - DAY, true],
    ['locked', NOWMS - 7 * DAY, NOWMS - 7 * DAY, false], ['locked', NOWMS - 7 * DAY + 1, NOWMS - 7 * DAY + 1, true], ['locked', NOWMS - 7 * DAY - 1, NOWMS - 7 * DAY - 1, false],
    ['open', NOWMS + 3600000, NOWMS + 3600000, false], ['open', NOWMS - DAY, NOWMS - DAY, true], ['open', null, NOWMS - DAY, false], ['final', NOWMS - DAY, NOWMS - DAY, false], ['draft', NOWMS - DAY, NOWMS - DAY, false],
  ];
  const tmiss = TABLE.filter(([status, lock, kick, want]) => f(status, iso(lock), iso(kick)) !== want);
  assert(TABLE.length === 17 && tmiss.length === 0,
    '[8k] G-6, the boundary table through the client predicate: both anchors 6 days old blocks and 8 days old lapses; the LATER anchor holds the block (lock 10 days / kickoff 6, and the reverse); a week with one anchor uses it; with none it has lapsed; EXACTLY seven days lapses and one millisecond earlier still blocks; an open week before its lock time never blocks',
    JSON.stringify(tmiss));
  assert(LS.leaveBlockAnchorMs({ firstKickoff: ago(2), picksLockAt: ago(3) }) === ms(ago(2)) && LS.leaveBlockAnchorMs({ firstKickoff: ago(3), picksLockAt: ago(2) }) === ms(ago(2))
    && LS.leaveBlockAnchorMs({ picksLockAt: ago(2) }) === ms(ago(2)) && LS.leaveBlockAnchorMs({ firstKickoff: ago(2) }) === ms(ago(2)) && LS.leaveBlockAnchorMs({}) === null && LS.leaveBlockAnchorMs(null) === null
    && LS.leaveBlockAnchorMs({ firstKickoff: 'junk', picksLockAt: ago(2) }) === ms(ago(2)) && LS.leaveBlockAnchorMs({ firstKickoff: ms(ago(1)), picksLockAt: '' }) === ms(ago(1)),
    '[8k2] the anchor is the LATER of the two terms (greatest), a missing or unreadable term is SKIPPED (a NULL), neither is null, and a number of ms is accepted as well as an ISO string');
  // firstKickoffByWeek — the client's min(g.kickoff)
  {
    const games = [{ weekId: 'w1', kickoff: ago(2) }, { weekId: 'w1', kickoff: ago(5) }, { weekId: 'w1', kickoff: null }, { weekId: 'w1', kickoff: 'junk' }, { weekId: 'w2', kickoff: ago(1) }, { weekId: 'w3' }, { kickoff: ago(9) }, null, { weekId: '__proto__', kickoff: ago(4) }];
    const fk = LS.firstKickoffByWeek(games);
    assert(fk.w1 === ms(ago(5)) && fk.w2 === ms(ago(1)) && !('w3' in fk) && Object.keys(fk).sort().join() === '__proto__,w1,w2' && fk.__proto__ === ms(ago(4)) && Object.getPrototypeOf(fk) === null
      && Object.keys(LS.firstKickoffByWeek(null)).length === 0 && Object.keys(LS.firstKickoffByWeek('x')).length === 0,
      '[8k3] firstKickoffByWeek is the earliest kickoff per week (min), skips a game with no week id or a missing or unreadable kickoff, never throws, and cannot be poisoned by a week id like __proto__ (a null-prototype map)');
  }
  // the games a caller hands in are enough: weeksInProgressForMember derives each week's firstKickoff from them when the week does not carry one
  const wk = [{ weekId: 'w1', status: 'locked' }, { weekId: 'w2', status: 'locked' }, { weekId: 'w3', status: 'locked', firstKickoff: ago(8) }];
  const pk = [{ weekId: 'w1', playerId: 'me' }, { weekId: 'w2', playerId: 'me' }, { weekId: 'w3', playerId: 'me' }];
  const gm = [{ weekId: 'w1', kickoff: ago(2) }, { weekId: 'w2', kickoff: ago(9) }, { weekId: 'w3', kickoff: ago(1) }];
  assert(JSON.stringify(LS.weeksInProgressForMember({ weeks: wk, picks: pk, games: gm, memberId: 'me', now: NOW })) === JSON.stringify(['w1'])
    && JSON.stringify(LS.weeksInProgressForMember({ weeks: wk, picks: pk, memberId: 'me', now: NOW })) === JSON.stringify([]),
    '[8k4] with `games` the weeks\' first kickoffs are derived (w1: 2 days ago blocks; w2: 9 days ago has lapsed; w3 carries its OWN firstKickoff, 8 days, which wins over the games\' 1 day) — and without games or any anchor a locked week has lapsed (the server stays the authority)');
  const weeks = [{ weekId: 'w1', status: 'locked', picksLockAt: past }, { weekId: 'w2', status: 'live', picksLockAt: past }, { weekId: 'w3', status: 'open', picksLockAt: future }, { weekId: 'w4', status: 'final' }, { weekId: 'w5', status: 'open', picksLockAt: past }, { weekId: 'w6', status: 'draft' }];
  const picks = [{ weekId: 'w1', playerId: 'me' }, { weekId: 'w1', playerId: 'me' }, { weekId: 'w2', playerId: 'other' }, { weekId: 'w3', playerId: 'me' }, { weekId: 'w4', playerId: 'me' }, { weekId: 'w5', playerId: 'me' }, { weekId: 'w6', playerId: 'me' }];
  assert(JSON.stringify(LS.weeksInProgressForMember({ weeks, picks, memberId: 'me', now: NOW })) === JSON.stringify(['w1', 'w5']),
    '[8g] the leaver\'s weeks in progress: locked (w1) and open-past-lock (w5) — NOT live w2 (the pick there is another player\'s), NOT open-before-lock w3, NOT final or draft; each week once');
  assert(JSON.stringify(LS.weeksInProgressForMember({ weeks: [{ weekId: 'w1', status: 'locked', picksLockAt: past }, { weekId: 'w1', status: 'locked', picksLockAt: past }], picks, memberId: 'me', now: NOW })) === JSON.stringify(['w1']),
    '[8g2] a week that appears twice in the list is returned once (the sentence counts weeks, not rows)');
  assert(LS.weeksInProgressForMember({ weeks, picks, memberId: 'other', now: NOW }).join() === 'w2' && LS.weeksInProgressForMember({ weeks, picks, memberId: 'nobody', now: NOW }).length === 0
    && LS.weeksInProgressForMember({ weeks, picks, memberId: '', now: NOW }).length === 0 && LS.weeksInProgressForMember({}).length === 0 && LS.weeksInProgressForMember({ weeks: 'x', picks: 1, memberId: 'me' }).length === 0,
    '[8h] the blind rule: only the CALLER\'s own picks decide it (another player\'s pick in a week never marks it for me), a person with no pick gets none, and bad input is an empty list');
  const out = LS.weeksInProgressForMember({ weeks, picks, memberId: 'me', now: NOW });
  assert(Array.isArray(out) && out.every((x) => typeof x === 'string'), '[8i] the result is week ids and nothing else — no pick, no team, no count of anyone else\'s picks');
  assert(LS.leaveBlockedSentence(out.length) === 'You can leave after these weeks are final.' && LS.leaveBlockedSentence(1) === 'You can leave after this week is final.', '[8j] the dimmed row\'s sentence follows the count: one week, this week; several, these weeks');
  // the source stays pure: the G-6 additions read no storage, no clock (a `now` is injected) and import nothing
  const src = read('./js/league-settings.js');
  const g6 = src.slice(src.indexOf('export const LEAVE_BLOCK_LAPSE_MS'), src.indexOf("/**\n * DI-462 section A: the roster's label"));
  assert(g6.length > 500 && !/\bimport\b|localStorage|\bload\(|\bsave\(|Date\.now\(\)/.test(g6.replace(/\/\*[\s\S]*?\*\//g, '')),
    '[8l] the G-6 additions are PURE: no import, no storage, no clock read (Date.now) — the `now` is injected, as everywhere in this module');
}

console.log('\n[9] "(left)" — the roster derivation and the ledger label…');
{
  const d = LS.departedLabel;
  assert(d({ active: false, linked: false, linkedAt: '2026-09-01T00:00:00Z' }) === '(left)', '[9a] inactive + unlinked + was linked (linked_at kept by leave_league) -> (left)');
  assert(d({ active: false, linked: false, linkedAt: null }) === '(removed)', '[9b] inactive + never linked (a placeholder a commissioner removed) -> (removed), NOT (left): the finding that made linked_at load-bearing (F2)');
  assert(d({ active: false, linked: true, linkedAt: '2026-09-01T00:00:00Z' }) === '(removed)', '[9c] inactive but still linked (a commissioner removed the seat; user_id stays) -> (removed)');
  assert(d({ active: false, linked: false, linkedAt: '' }) === '(removed)' && d({ active: false }) === '(removed)' && d({ active: false, linkedAt: '2026-09-01T00:00:00Z' }) === '(left)', '[9d] an empty linkedAt is "never linked"; an absent `linked` reads as unlinked');
  assert(d({ active: true, linked: false, linkedAt: '2026-09-01T00:00:00Z' }) === '' && d({ active: true, linked: true }) === '', '[9e] an ACTIVE seat has no label (a Restored seat is active, unlinked and stamped by no one: it reads as a normal "Not linked yet" row)');
  assert(d({}) === '' && d() === '' && d({ active: undefined }) === '' && d({ active: null }) === '', '[9f] `active` defaults to true when absent (the `!== false` reading listLeagueMembers uses): no label, never a throw');
  assert(d({ active: false, linked: false, linkedAt: new Date('2026-09-01T00:00:00Z') }) === '(left)', '[9g] linkedAt may be a Date: any truthy value counts');
  assert(LS.ledgerDepartedLabel(false) === '(left)' && LS.ledgerDepartedLabel(true) === '' && LS.ledgerDepartedLabel(undefined) === '' && LS.ledgerDepartedLabel(null) === '',
    '[9h] the ledger surfaces use the neutral "(left)" for any seat with active === false (the mirror carries only `active`), and nothing for an absent value');
  assert(LS.landingAfterLeave([]) === 'none' && LS.landingAfterLeave([MEM('L1', 'A')]) === 'single' && LS.landingAfterLeave([MEM('L1', 'A'), MEM('L2', 'B')]) === 'many' && LS.landingAfterLeave(null) === 'none' && LS.landingAfterLeave([null, {}]) === 'none',
    '[9i] the landing after a leave: none -> the no-league screen, one -> auto-activate, many -> Leagues Home (malformed entries do not count)');
}

console.log('\n[10] The rename rules — enable, dirty, trim…');
{
  assert(LS.trimmedName('  A  ') === 'A' && LS.trimmedName(null) === '' && LS.trimmedName(undefined) === '' && LS.trimmedName(5) === '5', '[10a] trimmedName');
  assert(LS.canSaveName('New', 'Old') === true && LS.canSaveName('Old', 'Old') === false && LS.canSaveName('  Old  ', 'Old') === false && LS.canSaveName('', 'Old') === false && LS.canSaveName('   ', 'Old') === false,
    '[10b] the enable rule: Save is on when the trimmed draft is non-empty AND differs from the stored name (pristine, spaces-only and empty all stay dimmed)');
  assert(LS.isNameDirty('Old ', 'Old') === true && LS.isNameDirty('Old', 'Old') === false && LS.isNameDirty('', 'Old') === true && LS.isNameDirty('Old', undefined) === true,
    '[10c] the dirty rule (the discard prompt) compares the RAW draft with the stored name: a trailing space is a change worth confirming');
  assert(LS.canSaveName('x', undefined) === true && LS.canSaveName(undefined, undefined) === false, '[10d] a stored name that has not loaded does not break the rules');
}

console.log('\n[11] Source tripwires — the module stays pure and renders nothing…');
{
  assert(!/^\s*import\s/m.test(CODE), '[11a] the module imports NOTHING (not auth.js, not app.js, not supabase-backend.js): it is testable without booting the app and cannot create an import cycle');
  assert(!/\b(document|window|localStorage|sessionStorage|navigator|fetch|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame)\b/.test(CODE) && !/\bDate\.now\(|new Date\(\)/.test(CODE.replace(/now = new Date\(\)/g, '')),
    '[11b] no DOM, storage, network or timer global, and no reading of the clock except the injected default (`now = new Date()` as a parameter default)');
  assert(!/escHtml|innerHTML|insertAdjacentHTML|outerHTML|createElement/.test(CODE) && !/<[a-zA-Z/][^>]*>/.test(CODE.replace(/=>/g, '').replace(/<(\d|-)/g, '')),
    '[11c] SC-L14: the module builds no HTML at all — it returns plain text, so no league name or display name is ever interpolated into markup here (and no single-quoted attribute can exist)');
  assert(!/\.filter\([\s\S]{0,80}?role[\s\S]{0,80}?\.length|\bcount\(|\bpilot\b|\bleague_active\b|isSoleCommissioner|onlyMember|commissionerCount/i.test(CODE),
    '[11d] DI-461 acceptance 1: NO eligibility logic — no role counting, no pilot test, no "sole commissioner" derivation: the exit rule lives ONLY in account_exit_leagues() (the one `role === \'commissioner\'` comparison picks between two honest messages and decides nothing)');
  assert((CODE.match(/'commissioner'/g) || []).length === 1 && (CODE.match(/\brole\b/g) || []).length >= 1, '[11e] …and that single comparison is the ONLY use of the word \'commissioner\' in the module');
  assert(!/selectedTeam|tiebreaker|extraPoint|spread|lockedSpread|favorite/i.test(CODE), '[11f] the blind rule: the module never names a selection, a tiebreaker, an Extra Point guess or a spread — only `weekId` and `playerId` of a pick, to count the caller\'s own weeks');
  assert(!/console\.|debugger/.test(CODE), '[11g] no console or debugger statement');
  const bad = [];
  for (const ch of SRC) { const cp = ch.codePointAt(0); if ((cp < 32 && cp !== 10 && cp !== 9) || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff) bad.push(cp.toString(16)); }
  assert(bad.length === 0, '[11h] no invisible, control or bidirectional code point in the source (Trojan Source)', bad.join());
  assert(!/#[0-9a-fA-F]{6}\b|\brgba?\(/.test(CODE), '[11i] no hex colour or rgb() in the module');
  // the leave sequence, read off the source of leaveLeague itself
  const fn = SRC.slice(SRC.indexOf('export async function leaveLeague('), SRC.indexOf('export async function setAcceptingMembers('));
  const iRpc = fn.indexOf("callRpc(deps, 'leave_league'");
  const iDrop = fn.indexOf("dropMirrorSafely(deps, 'leave-league')");
  const iRefresh = fn.indexOf('await refreshed(deps)');
  assert(iRpc > -1 && iDrop > iRpc && iRefresh > iDrop, '[11j] F4 in the SOURCE: in leaveLeague the success path runs the rpc, THEN dropMirrorSafely(\'leave-league\'), THEN the refresh');
  assert(/p_confirm_archive: confirmArchive === true/.test(fn), '[11k] SC-L9 in the SOURCE: p_confirm_archive is `confirmArchive === true`, never a truthiness test');
  assert((SRC.match(/dropMirrorSafely\(deps, 'leave-league'\)/g) || []).length === 2, '[11l] the mirror is dropped on exactly two paths: the RPC answered, and an unknown outcome the refresh proved landed');
}

console.log('\n[12] The exports the follow-on wiring names…');
{
  const names = ['LS_COPY', 'REFUSAL_KINDS', 'leagueLabel', 'leaveFailed', 'leaveAppliedRefreshFailed', 'leaveUnconfirmed', 'leaveNotAMember', 'leaveHeadless', 'leaveToast', 'preflightFailed', 'leaveSheetTitle',
    'leaveArchiveSheetTitle', 'leaveBlockedSentence', 'leaveSheetCopy', 'leaveFooterCopy', 'classifyLeagueSettingsError', 'trimmedName', 'canSaveName', 'isNameDirty', 'renameLeague', 'leaveLeague',
    'setAcceptingMembers', 'renameOutcomeCopy', 'acceptingOutcomeCopy', 'leaveOutcomeCopy', 'isWeekInProgressForLeave', 'weeksInProgressForMember', 'LEAVE_BLOCK_LAPSE_MS', 'leaveBlockAnchorMs', 'firstKickoffByWeek', 'departedLabel', 'ledgerDepartedLabel', 'landingAfterLeave'];
  const missing = names.filter((n) => !(n in LS));
  assert(missing.length === 0 && Object.keys(LS).length === names.length, `[12a] exactly the ${names.length} documented exports (no stray export)`, JSON.stringify({ missing, extra: Object.keys(LS).filter((k) => !names.includes(k)) }));
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
