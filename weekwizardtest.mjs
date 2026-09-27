/**
 * weekwizardtest.mjs — DI-341 (UX Revamp group C, WEEK-SETUP-WIZARD).
 * =====================================================================
 * Unit tests for js/week-wizard.js's DECISIONS (the step-selection table,
 * §2.5; the step-6 gating checklist, §2.3; the narrowed status-button set,
 * §2.6) — never the DOM, per this file's own module header: no `document`,
 * no sheet markup, nothing that needs loadtest.mjs's DOM stubs to import.
 *
 * Run:  node weekwizardtest.mjs
 *
 * Precedent: grouptest.mjs (UN-118, 2026-08-13) — a decision-logic proof
 * reads start to finish, not buried among chat-fold assertions.
 *
 * NOT ADDED TO loadtest.mjs's spawn list by this pass (out of scope — see
 * the handoff's wiring checklist); the coordinator adds it there.
 */

import * as wizard from './js/week-wizard.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log('\n[1] selectWizardEntry — §2.5\'s state table…');
{
  assert(wizard.selectWizardEntry({ week: null }).mode === 'steps'
    && wizard.selectWizardEntry({ week: null }).step === 1,
    '1-1: no week exists yet ⇒ step 1');

  const draftNoGames = { weekId: 'w1', status: 'draft' };
  assert(wizard.selectWizardEntry({ week: draftNoGames, games: [] }).step === 1,
    '1-2: draft, no games ⇒ step 1 (prefilled, not blanked — the caller\'s job to prefill)');

  const draftWithGamesNoSpreads = { weekId: 'w2', status: 'draft' };
  const gamesNoSpread = [{ homeTeam: 'A', awayTeam: 'B', spread: null }, { homeTeam: 'C', awayTeam: 'D', spread: undefined }];
  assert(wizard.selectWizardEntry({ week: draftWithGamesNoSpreads, games: gamesNoSpread }).step === 3,
    '1-3: draft, has games, no spreads set ⇒ step 3');

  const gamesPartialSpread = [{ homeTeam: 'A', awayTeam: 'B', spread: -3.5 }, { homeTeam: 'C', awayTeam: 'D', spread: null }];
  assert(wizard.selectWizardEntry({ week: draftWithGamesNoSpreads, games: gamesPartialSpread }).step === 3,
    '1-4: draft, PARTIALLY spread ⇒ still step 3 (missing > 0)');

  const gamesFullSpread = [{ homeTeam: 'A', awayTeam: 'B', spread: -3.5 }, { homeTeam: 'C', awayTeam: 'D', spread: 0 }];
  const entry6 = wizard.selectWizardEntry({ week: draftWithGamesNoSpreads, games: gamesFullSpread });
  assert(entry6.mode === 'steps' && entry6.step === 6,
    '1-5: draft, fully configured (spreads all set, including a real PK=0) ⇒ step 6');

  for (const status of ['open', 'locked', 'live', 'final']) {
    const week = { weekId: 'wX', status };
    assert(wizard.selectWizardEntry({ week, games: gamesFullSpread }).mode === 'manage',
      `1-6 (${status}): a week past draft ⇒ the Manage screen, never steps 1-5`);
  }
}

console.log('\n[2] countMissingSpreads — the PK=0 case is a SET spread, not a missing one…');
{
  assert(wizard.countMissingSpreads([{ spread: 0 }]) === 0, '2-1: spread:0 (PK) counts as set');
  assert(wizard.countMissingSpreads([{ spread: null }]) === 1, '2-2: spread:null counts as missing');
  assert(wizard.countMissingSpreads([{ spread: undefined }]) === 1, '2-3: spread:undefined counts as missing');
  assert(wizard.countMissingSpreads([{ spread: -7 }, { spread: 3.5 }, { spread: null }]) === 1,
    '2-4: mixed slate counts only the missing one');
  assert(wizard.countMissingSpreads([]) === 0, '2-5: an empty slate has zero missing (not NaN, not a throw)');
  assert(wizard.countMissingSpreads(null) === 0, '2-6: null games array is treated as empty, defensively');
}

console.log('\n[3] gatingChecklist — the step-6 gate, never enabled with a check unmet…');
{
  const allGood = wizard.gatingChecklist({ gamesCount: 10, missingSpreadCount: 0, timingConfigured: true });
  assert(allGood.canOpen === true, '3-1: all three ✓ ⇒ canOpen true');

  const noGames = wizard.gatingChecklist({ gamesCount: 0, missingSpreadCount: 0, timingConfigured: true });
  assert(noGames.canOpen === false && noGames.gamesOk === false,
    '3-2: zero games ⇒ canOpen false, named as "No games on slate yet"');
  assert(noGames.gamesLabel === 'No games on slate yet', '3-2b: …the exact label');

  const missingSpreads = wizard.gatingChecklist({ gamesCount: 10, missingSpreadCount: 3, timingConfigured: true });
  assert(missingSpreads.canOpen === false && missingSpreads.spreadsOk === false,
    '3-3: missing spreads ⇒ canOpen false');
  assert(missingSpreads.spreadsLabel === '3 games still need a spread before you can open for picks.',
    `3-3b: …the exact named-gap copy (got "${missingSpreads.spreadsLabel}")`);

  const oneMissing = wizard.gatingChecklist({ gamesCount: 10, missingSpreadCount: 1, timingConfigured: true });
  assert(oneMissing.spreadsLabel === '1 game still needs a spread before you can open for picks.',
    `3-3c: singular grammar for exactly one (got "${oneMissing.spreadsLabel}")`);

  const noTiming = wizard.gatingChecklist({ gamesCount: 10, missingSpreadCount: 0, timingConfigured: false });
  assert(noTiming.canOpen === false && noTiming.timingOk === false,
    '3-4: timing unresolved ⇒ canOpen false');

  // The three-way AND, exhaustively — no single failing check is masked by
  // another passing one, and no combination of two passes with one fails.
  const combos = [
    [true, true, true, true], [false, true, true, false], [true, false, true, false],
    [true, true, false, false], [false, false, true, false], [false, true, false, false],
    [true, false, false, false], [false, false, false, false],
  ];
  for (const [gamesOk, spreadsOk, timingOk, expected] of combos) {
    const r = wizard.gatingChecklist({
      gamesCount: gamesOk ? 5 : 0, missingSpreadCount: spreadsOk ? 0 : 2, timingConfigured: timingOk,
    });
    assert(r.canOpen === expected,
      `3-5: games=${gamesOk} spreads=${spreadsOk} timing=${timingOk} ⇒ canOpen=${expected} (got ${r.canOpen})`);
  }
}

console.log('\n[4] narrowedWeekStatusButtons — §2.6\'s three refused reversals, and nothing else…');
{
  const draft = wizard.narrowedWeekStatusButtons('draft');
  assert(draft.length === 1 && draft[0].to === 'open', '4-1: draft ⇒ only "Open for Picks"');

  const open = wizard.narrowedWeekStatusButtons('open');
  assert(open.length === 2 && open.some((b) => b.to === 'locked') && open.some((b) => b.to === 'draft'),
    '4-2: open ⇒ Lock Week + Back to Draft (both legal per the server allow-list: open->locked via lock_week, open->draft directly)');

  const locked = wizard.narrowedWeekStatusButtons('locked');
  assert(locked.length === 2 && locked.some((b) => b.to === 'live') && locked.some((b) => b.to === 'open'),
    '4-3: locked ⇒ Go Live + Re-open Picks — "Back to Draft" (locked->draft) is REMOVED, the server refuses it');
  assert(!locked.some((b) => b.to === 'draft'), '4-3b: …confirmed: locked->draft is gone');

  const live = wizard.narrowedWeekStatusButtons('live');
  assert(live.length === 1 && live[0].to === 'final',
    '4-4: live ⇒ Finalize only — "Re-open Picks" (live->open) is REMOVED, and so is "Pause (Re-lock)" (live->locked, SEC-4 2026-09-26: transition_week raises use_lock_week for any p_to=locked and lock_week requires open, so the server can never make it)');
  assert(!live.some((b) => b.to === 'locked'), '4-4c: …confirmed: live->locked is gone (SEC-4)');
  assert(!live.some((b) => b.to === 'open'), '4-4b: …confirmed: live->open is gone');

  const final = wizard.narrowedWeekStatusButtons('final');
  assert(final.length === 1 && final[0].to === 'live',
    '4-5: final ⇒ only "Reopen to Live" — "Reopen to Open" (final->open) is REMOVED');
  assert(!final.some((b) => b.to === 'open'), '4-5b: …confirmed: final->open is gone');

  assert(wizard.narrowedWeekStatusButtons('bogus').length === 0, '4-6: an unrecognised status yields no buttons, not a throw');

  // DRIFT CHECK (rewritten 2026-09-26, full-app review Step 6) — every
  // surviving wizard button is {to, cls, icon, text}-identical to app.js's
  // renderWeekStatusButtons() table, PARSED OUT OF app.js (not a hand copy),
  // and the only entries the wizard drops are the three server-refused
  // reversals. Replaces the old emoji-`label` spot checks (the field is gone).
  {
    const { readFileSync } = await import('node:fs');
    const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const fnAt = appSrc.indexOf('function renderWeekStatusButtons(week) {');
    const tStart = appSrc.indexOf('const t={', fnAt);
    const tEnd = appSrc.indexOf('};', tStart);
    let appTable = null;
    try { appTable = fnAt > -1 && tStart > -1 ? new Function(`return ${appSrc.slice(tStart + 'const t='.length, tEnd + 1)};`)() : null; } catch { appTable = null; }
    assert(!!appTable && Object.keys(appTable).length === 5, '4-7 fixture: app.js\'s renderWeekStatusButtons() table was located and parsed (5 statuses)');
    const REFUSED = new Set(['locked:draft', 'live:open', 'final:open', 'live:locked']);
    const pick = (b) => JSON.stringify({ to: b.to, cls: b.cls, icon: b.icon, text: b.text });
    const drift = [];
    for (const st of Object.keys(appTable || {})) {
      const expected = appTable[st].filter((b) => !REFUSED.has(`${st}:${b.to}`)).map(pick);
      const got = wizard.narrowedWeekStatusButtons(st).map(pick);
      if (JSON.stringify(expected) !== JSON.stringify(got)) drift.push({ st, expected, got });
    }
    assert(drift.length === 0,
      `4-7: every surviving wizard button is {to, cls, icon, text}-identical to app.js's table, in order, and only the server-refused legs are dropped (the three reversals + live->locked, SEC-4) (drift: ${JSON.stringify(drift)})`);
    assert(['draft', 'open', 'locked', 'live', 'final'].every((st) => wizard.narrowedWeekStatusButtons(st).every((b) => !('label' in b))),
      '4-8: the dead emoji `label` field is gone from every wizard button');
  }
}

console.log('\n[5] createWeekFromWizard — the Step 1 wrapper, same calls showCreateWeekModal() makes…');
{
  const calls = [];
  const deps = {
    createWeek: (season, weekNumber, startDate, endDate) => {
      calls.push(['createWeek', season, weekNumber, startDate, endDate]);
      return { weekId: 'w_new', season, weekNumber, startDate, endDate, status: 'draft' };
    },
    saveWeek: (w) => calls.push(['saveWeek', w.weekId]),
    setActiveWeekId: (id) => calls.push(['setActiveWeekId', id]),
  };
  const week = wizard.createWeekFromWizard({
    fields: { season: '2026', weekNumber: 5, roundLabel: 'Part 2', startDate: '2026-10-01', endDate: '2026-10-02', dataSourceMode: 'espn_live' },
    deps,
  });
  assert(week.weekId === 'w_new' && week.roundLabel === 'Part 2' && week.dataSourceMode === 'espn_live',
    `5-1: the created week carries roundLabel/dataSourceMode, layered onto createWeek()'s own return (got ${JSON.stringify(week)})`);
  assert(calls[0][0] === 'createWeek' && calls[1][0] === 'saveWeek' && calls[2][0] === 'setActiveWeekId',
    `5-2: the call ORDER matches showCreateWeekModal()'s own handler — create, save, activate (got ${JSON.stringify(calls.map((c) => c[0]))})`);
}

console.log('\n[5b] REVIEWER BLOCK item 2 (916bdb7 review, 2026-09-25) — re-entering Step 1 on an existing draft SAVES onto it, never mints a second week…');
{
  // 5b-i — the ORIGINAL bug, proven: with no `existingWeek`, every call
  // mints a fresh week (createWeek() called every time) — the shape that
  // orphaned the first draft when Step 1 was re-entered.
  const storeNoExisting = new Map();
  const depsNoExisting = {
    createWeek: (season, weekNumber, startDate, endDate) => {
      const w = { weekId: `w_${storeNoExisting.size + 1}`, season, weekNumber, startDate, endDate, status: 'draft' };
      return w;
    },
    saveWeek: (w) => storeNoExisting.set(w.weekId, w),
    setActiveWeekId: () => {},
  };
  wizard.createWeekFromWizard({ fields: { season: '2026', weekNumber: 9 }, deps: depsNoExisting });
  wizard.createWeekFromWizard({ fields: { season: '2026', weekNumber: 9 }, deps: depsNoExisting });
  assert(storeNoExisting.size === 2,
    '5b-i fixture check: WITHOUT existingWeek, two calls really do mint two separate weeks (confirms the test would have caught the original bug)');

  // 5b-ii — the FIX: passing the same `existingWeek` on both calls (as
  // app.js's bindWeekWizardStep1(bodyEl, week) now does — `week` is the
  // CURRENT draft, read once per render of Step 1) produces exactly ONE
  // week, updated in place, same weekId both times.
  const storeExisting = new Map();
  const depsExisting = {
    createWeek: (season, weekNumber, startDate, endDate) => {
      const w = { weekId: 'w_should_never_mint_twice', season, weekNumber, startDate, endDate, status: 'draft' };
      return w;
    },
    saveWeek: (w) => storeExisting.set(w.weekId, w),
    setActiveWeekId: () => {},
  };
  const first = wizard.createWeekFromWizard({ fields: { season: '2026', weekNumber: 9, startDate: '2026-10-01', endDate: '2026-10-02' }, deps: depsExisting });
  assert(storeExisting.size === 1 && first.weekId === 'w_should_never_mint_twice',
    '5b-ii fixture check: the FIRST call (no existingWeek yet — this IS the create) mints the week normally');
  // Re-entering Step 1: the caller now has `first` as the current week and
  // passes it as `existingWeek` on the SECOND call (editing the same draft).
  const second = wizard.createWeekFromWizard({
    fields: { season: '2026', weekNumber: 9, roundLabel: 'Edited', startDate: '2026-10-03', endDate: '2026-10-04', dataSourceMode: 'manual' },
    deps: depsExisting,
    existingWeek: first,
  });
  assert(storeExisting.size === 1,
    `5b-ii: re-entering Step 1 on an existing draft still leaves exactly ONE week in storage — got ${storeExisting.size}`);
  assert(second.weekId === first.weekId,
    '5b-ii: …and it is the SAME weekId — the draft was updated, not orphaned behind a new one');
  assert(second.roundLabel === 'Edited' && second.startDate === '2026-10-03' && second.dataSourceMode === 'manual',
    '5b-ii: …and the form\'s new field values actually applied — this is a real save, not a no-op');
  assert(second.status === 'draft',
    '5b-ii: status is carried over from the existing week untouched (Step 1 never changes status)');
}

console.log('\n[6] fetchAndApplySuggestedSlate — Step 2\'s one-button combo…');
{
  const week = { weekId: 'w1', startDate: '2026-10-01', endDate: '2026-10-02', season: '2026' };
  const savedGames = [];
  const deps = {
    fetchByDateRange: async () => ({ games: [{ homeTeam: 'A', awayTeam: 'B' }, { homeTeam: 'C', awayTeam: 'D' }] }),
    saveAvailableGames: () => {}, clearAvailableGames: () => {},
    scoreCandidateGames: (games) => games,
    buildSuggestedSlate: (scored) => ({ slate: scored, shortlist: [] }),
    getGames: () => savedGames,
    saveGame: (g) => savedGames.push(g),
    createGame: (weekId, fields) => ({ weekId, ...fields }),
    claimedAlmaMaters: () => [],
  };
  const result = await wizard.fetchAndApplySuggestedSlate({ week, deps });
  assert(result.ok === true && result.added === 2,
    `6-1: both fetched games are added when none already exist (got ${JSON.stringify(result)})`);

  // A second call with one game already on the slate does not duplicate it.
  const deps2 = { ...deps, getGames: () => [{ homeTeam: 'A', awayTeam: 'B' }] };
  const result2 = await wizard.fetchAndApplySuggestedSlate({ week, deps: deps2 });
  assert(result2.added === 1, `6-2: an already-present game is skipped, only the new one is added (got ${result2.added})`);

  const noStartDate = await wizard.fetchAndApplySuggestedSlate({ week: { weekId: 'w2' }, deps });
  assert(noStartDate.ok === false && noStartDate.reason === 'no_start_date',
    '6-3: no start date ⇒ refuses cleanly, never calls fetchByDateRange');

  const failDeps = { ...deps, fetchByDateRange: async () => ({ error: 'network down' }) };
  const failResult = await wizard.fetchAndApplySuggestedSlate({ week, deps: failDeps });
  assert(failResult.ok === false && failResult.reason === 'network down',
    '6-4: a fetch error is surfaced, not swallowed');

  const zeroDeps = { ...deps, fetchByDateRange: async () => ({ games: [] }) };
  const zeroResult = await wizard.fetchAndApplySuggestedSlate({ week, deps: zeroDeps });
  assert(zeroResult.ok === false && zeroResult.reason === 'no_games',
    '6-5: zero games returned ⇒ refuses cleanly (never a 0-games "success")');

  // reviewer BLOCK fix round 1 — saveFetchProof() is called with the
  // quality report, matching app.js:12007's `if(result.qualityReport)
  // saveFetchProof(result.qualityReport);` exactly.
  let savedProof = null;
  const proofDeps = {
    ...deps,
    fetchByDateRange: async () => ({ games: [{ homeTeam: 'A', awayTeam: 'B' }], qualityReport: { confirmed: 1, partial: 0 } }),
    saveFetchProof: (report) => { savedProof = report; },
  };
  await wizard.fetchAndApplySuggestedSlate({ week, deps: proofDeps });
  assert(savedProof && savedProof.confirmed === 1,
    `6-6: saveFetchProof() is called with the fetch's own qualityReport (got ${JSON.stringify(savedProof)})`);

  let proofCalls = 0;
  const noReportDeps = {
    ...deps,
    fetchByDateRange: async () => ({ games: [{ homeTeam: 'A', awayTeam: 'B' }] }),
    saveFetchProof: () => { proofCalls++; },
  };
  await wizard.fetchAndApplySuggestedSlate({ week, deps: noReportDeps });
  assert(proofCalls === 0, '6-7: no qualityReport on the response ⇒ saveFetchProof() is never called');

  // reviewer BLOCK fix round 1 — a rejected suggestion is filtered out
  // BEFORE scoring, matching app.js:10393's candidatePool filter exactly:
  // "a dismissed game shouldn't be reconsidered for ANY tier."
  const rejectedDeps = {
    ...deps,
    fetchByDateRange: async () => ({ games: [{ homeTeam: 'A', awayTeam: 'B' }, { homeTeam: 'E', awayTeam: 'F' }] }),
    getAvailableGames: () => [{ homeTeam: 'A', awayTeam: 'B' }, { homeTeam: 'E', awayTeam: 'F' }],
    isSuggestionRejected: (weekId, g) => g.homeTeam === 'A',
    scoreCandidateGames: (games) => { assert(games.every((g) => g.homeTeam !== 'A'), '6-8: the rejected game never reaches scoreCandidateGames() at all'); return games; },
  };
  const rejectedResult = await wizard.fetchAndApplySuggestedSlate({ week, deps: rejectedDeps });
  assert(rejectedResult.added === 1 && rejectedResult.suggested === 1,
    `6-9: only the non-rejected game is scored/suggested/added (got ${JSON.stringify(rejectedResult)})`);
}

console.log('\n[7] openForPicksFromWizard — gated, never calls applyWeekStatusChange when the gate fails…');
{
  const week = { weekId: 'w1', weekNumber: 5, status: 'draft' };
  let statusChangeCalls = 0, toastCalls = 0, hapticCalls = 0;
  const deps = {
    applyWeekStatusChange: (w, to) => { statusChangeCalls++; return { ...w, status: to }; },
    showToast: () => { toastCalls++; },
    nativeHapticImpact: () => { hapticCalls++; },
    isNativeShell: () => true,
  };
  const blocked = wizard.openForPicksFromWizard({
    week, gamesCount: 0, missingSpreadCount: 0, timingConfigured: true, deps,
  });
  assert(blocked.ok === false && statusChangeCalls === 0,
    '7-1: gate fails (no games) ⇒ applyWeekStatusChange is NEVER called');

  const allowed = wizard.openForPicksFromWizard({
    week, gamesCount: 10, missingSpreadCount: 0, timingConfigured: true, deps,
  });
  assert(allowed.ok === true && statusChangeCalls === 1 && allowed.week.status === 'open',
    '7-2: gate passes ⇒ applyWeekStatusChange(week,\'open\') is called exactly once');
  assert(toastCalls === 1, '7-3: …and the success toast fires once');
  assert(hapticCalls === 1, '7-4: …and the native LIGHT haptic fires once (native shell only)');

  // Web (non-native) never calls the haptic.
  let webHapticCalls = 0;
  const webDeps = { ...deps, isNativeShell: () => false, nativeHapticImpact: () => { webHapticCalls++; } };
  wizard.openForPicksFromWizard({ week, gamesCount: 10, missingSpreadCount: 0, timingConfigured: true, deps: webDeps });
  assert(webHapticCalls === 0, '7-5: on web (isNativeShell()===false), the haptic call is never made');
}

console.log('\n[8] createWeekWizard — the "one call" factory…');
{
  const w = wizard.createWeekWizard({});
  assert(typeof w.selectEntry === 'function' && typeof w.gatingChecklist === 'function'
    && typeof w.narrowedStatusButtons === 'function' && typeof w.createWeek === 'function'
    && typeof w.fetchAndApplySuggestedSlate === 'function' && typeof w.openForPicks === 'function',
    '8-1: every decision + orchestration function is exposed on the factory\'s return');
  assert(w.selectEntry({ week: null }).step === 1, '8-2: the bound selectEntry behaves identically to the standalone export');
}

console.log('\n[9] WIZARD_STEPS / WIZARD_COPY — structural shape…');
{
  assert(wizard.WIZARD_STEPS.length === 6 && wizard.WIZARD_STEP_COUNT === 6,
    '9-1: six steps, matching §2.3\'s diagram');
  assert(wizard.WIZARD_STEPS.every((s, i) => s.step === i + 1),
    '9-2: steps are numbered 1..6 in order');
  assert(wizard.WIZARD_COPY.FETCH_SUCCESS(10) === '10 games added to your slate.',
    '9-3: FETCH_SUCCESS copy matches the DI\'s exact text');
  assert(wizard.WIZARD_COPY.FETCH_PARTIAL(7).includes('Only 7 games available'),
    '9-4: FETCH_PARTIAL copy names the actual count');
  assert(wizard.WIZARD_COPY.OPEN_SUCCESS(5) === 'Week 5 is open — picks unlock now.',
    '9-5: OPEN_SUCCESS copy matches the DI\'s exact text');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
