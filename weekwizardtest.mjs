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
import { getAutoFinalizeEnabled } from './js/data-model.js';

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
  // DI-404 (UN-388) — a draft now needs a valid weekly blurb before it opens,
  // so this fixture carries one; the blurb refusals themselves are [18].
  const week = { weekId: 'w1', weekNumber: 5, status: 'draft', blurb: 'Rivalry week — bring your A game.' };
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

console.log('\n[10] DI-353 — createWeekFromWizard() defaults dataSourceMode to \'espn_live\' now that the field is leaving the form…');
{
  const deps = {
    createWeek: (season, weekNumber, startDate, endDate) => ({ weekId: 'w_di353', season, weekNumber, startDate, endDate, status: 'draft' }),
    saveWeek: () => {}, setActiveWeekId: () => {},
  };
  const noMode = wizard.createWeekFromWizard({ fields: { season: '2026', weekNumber: 3 }, deps });
  assert(noMode.dataSourceMode === 'espn_live',
    `10-1: omitting dataSourceMode from fields defaults to 'espn_live', not 'manual' (got ${noMode.dataSourceMode})`);
  const explicitMode = wizard.createWeekFromWizard({ fields: { season: '2026', weekNumber: 3, dataSourceMode: 'demo' }, deps });
  assert(explicitMode.dataSourceMode === 'demo',
    '10-2: a caller that DOES pass dataSourceMode is still honored — the default only fills a gap, never overrides');

  // coordinator fix, item 2, REQUIRED — an EXISTING week's own dataSourceMode
  // must never be silently overwritten by the 'espn_live' default once the
  // field leaves the commissioner-facing form (so `fields` never carries it
  // for a re-save). The exact scenario named: an existing DEMO week,
  // re-saved (e.g. re-entering Step 1 to edit the round label) without the
  // field present in `fields` at all.
  const existingDemoWeek = { weekId: 'w_demo', season: '2026', weekNumber: 4, status: 'draft', dataSourceMode: 'demo', roundLabel: 'old' };
  const reSavedNoField = wizard.createWeekFromWizard({
    fields: { season: '2026', weekNumber: 4, roundLabel: 'Bowl Week' }, // no dataSourceMode key at all
    deps, existingWeek: existingDemoWeek,
  });
  assert(reSavedNoField.dataSourceMode === 'demo',
    `10-3 (REQUIRED, mutation guard): re-saving an existing DEMO week without dataSourceMode in fields must KEEP 'demo', never silently flip to 'espn_live' (got ${reSavedNoField.dataSourceMode})`);
  assert(reSavedNoField.roundLabel === 'Bowl Week',
    '10-4: …and the field that WAS actually edited (roundLabel) still applies — this is a real save, not a no-op');

  // The same check for a MANUAL existing week, and confirmation that an
  // explicit fields.dataSourceMode still wins over BOTH the existing week's
  // mode and the default (three-tier precedence, exhaustively).
  const existingManualWeek = { weekId: 'w_manual', season: '2026', weekNumber: 5, status: 'draft', dataSourceMode: 'manual' };
  const reSavedManual = wizard.createWeekFromWizard({ fields: { season: '2026', weekNumber: 5 }, deps, existingWeek: existingManualWeek });
  assert(reSavedManual.dataSourceMode === 'manual',
    `10-5 (mutation guard): an existing MANUAL week's mode is preserved the same way (got ${reSavedManual.dataSourceMode})`);
  const explicitOverridesExisting = wizard.createWeekFromWizard({
    fields: { season: '2026', weekNumber: 5, dataSourceMode: 'espn_historical' },
    deps, existingWeek: existingManualWeek,
  });
  assert(explicitOverridesExisting.dataSourceMode === 'espn_historical',
    `10-6: an EXPLICIT fields.dataSourceMode still wins over the existing week's own mode — the caller's deliberate choice, not silently ignored (got ${explicitOverridesExisting.dataSourceMode})`);
}

console.log('\n[11] DI-354 — stepBackTarget() / shouldConfirmAnnouncementDiscard(), shared by both step machines…');
{
  assert(wizard.stepBackTarget(1) === null, '11-1: step 1 has no Back target');
  for (let s = 2; s <= 6; s++) {
    assert(wizard.stepBackTarget(s) === s - 1, `11-2: step ${s} of the create-flow backs to step ${s - 1} (got ${wizard.stepBackTarget(s)})`);
  }
  // The exact gap DI-354 names: Step 5 (Announce) previously had no Back at
  // all — proving the primitive covers step 5 specifically closes that gap.
  assert(wizard.stepBackTarget(5) === 4, '11-3: step 5 (Announce) — the actual named gap — now resolves a Back target of 4');
  // Same primitive, reused for the Finalize flow's 4 steps (DI-359) — proof
  // this is genuinely ONE shared function, not a per-flow copy.
  for (let s = 2; s <= 4; s++) {
    assert(wizard.stepBackTarget(s) === s - 1, `11-4: Finalize-flow step ${s} backs to step ${s - 1} — same function, second flow`);
  }

  assert(wizard.shouldConfirmAnnouncementDiscard('Week 5 kicks off Saturday!') === true,
    '11-5: real drafted text ⇒ confirm before discarding');
  assert(wizard.shouldConfirmAnnouncementDiscard('') === false, '11-6: empty string ⇒ no confirm needed');
  assert(wizard.shouldConfirmAnnouncementDiscard('   ') === false, '11-7: whitespace-only ⇒ no confirm needed (not real content)');
  assert(wizard.shouldConfirmAnnouncementDiscard(undefined) === false, '11-8: undefined (never typed anything) ⇒ no confirm needed, never a throw');
  assert(wizard.shouldConfirmAnnouncementDiscard(null) === false, '11-9: null ⇒ no confirm needed, never a throw');
}

console.log('\n[12] DI-357 — tiebreakerWizardStepSummary() / applyTiebreakerQuestion() — visible + editable, NEVER a gate…');
{
  const blank = wizard.tiebreakerWizardStepSummary({ weekId: 'w1' });
  assert(blank.question === '' && blank.hasQuestion === false,
    '12-1: no question on the week ⇒ blank, hasQuestion false — a real, valid state, not an error');
  assert(blank.calculationMode === 'selectedSlateOnly' && blank.calculationModeCaption.includes('slate'),
    `12-2: defaults to selectedSlateOnly with a human caption (got ${JSON.stringify(blank)})`);

  const withQuestion = wizard.tiebreakerWizardStepSummary({ tiebreakerQuestion: 'Total points in the Alabama game?', tiebreakerCalculationMode: 'selectedSlateOnly' });
  assert(withQuestion.hasQuestion === true && withQuestion.question === 'Total points in the Alabama game?',
    '12-3: an existing question is surfaced verbatim');

  const whitespaceOnly = wizard.tiebreakerWizardStepSummary({ tiebreakerQuestion: '   ' });
  assert(whitespaceOnly.hasQuestion === false, '12-4: whitespace-only question counts as blank, not "has a question"');

  const unknownMode = wizard.tiebreakerWizardStepSummary({ tiebreakerCalculationMode: 'somethingNew' });
  assert(unknownMode.calculationModeCaption === wizard.TIEBREAKER_CALC_MODE_CAPTIONS.selectedSlateOnly,
    '12-5: an unrecognised calc mode falls back to the selectedSlateOnly caption rather than showing nothing');

  // data-model.js's TIEBREAKER_CALC_MODE enum actually has THREE values
  // (selectedSlateOnly/allAlmaMaterGames/manual), not the "only one mode"
  // the DI's own text assumed — both non-selectedSlateOnly modes get their
  // OWN caption, distinct from selectedSlateOnly's.
  //
  // coordinator fix (review round on ddf9e4f) — the ORIGINAL caption text
  // ("not just the slate") was factually wrong: `calculateAlmaMaterTotal()`
  // NEVER leaves the slate in any mode (its `games` argument is always this
  // week's slate only). What the modes actually distinguish is the
  // `isAlmaMaterGame` FLAG — a commissioner-curated subset of the slate
  // (`selectedSlateOnly`) vs. every slate game that merely involves a
  // claimed alma mater (`allAlmaMaterGames`/`manual`).
  assert(wizard.TIEBREAKER_CALC_MODE_CAPTIONS.selectedSlateOnly === 'Based on: the alma mater games you flagged on this slate',
    `12-5a: selectedSlateOnly's exact caption (got "${wizard.TIEBREAKER_CALC_MODE_CAPTIONS.selectedSlateOnly}")`);
  const allGamesMode = wizard.tiebreakerWizardStepSummary({ tiebreakerCalculationMode: 'allAlmaMaterGames' });
  assert(allGamesMode.calculationModeCaption === 'Based on: every game on this slate involving an alma mater',
    `12-5b: allAlmaMaterGames mode gets its OWN, factually-correct caption (got "${allGamesMode.calculationModeCaption}")`);
  assert(!allGamesMode.calculationModeCaption.toLowerCase().includes('not just the slate'),
    '12-5b2 (mutation guard): the retired, factually-wrong "not just the slate" phrasing must never reappear');
  assert(allGamesMode.calculationModeCaption !== wizard.TIEBREAKER_CALC_MODE_CAPTIONS.selectedSlateOnly,
    '12-5c (mutation guard): confirms this is a REAL second caption, not the fallback silently reused');
  const manualMode = wizard.tiebreakerWizardStepSummary({ tiebreakerCalculationMode: 'manual' });
  assert(manualMode.calculationModeCaption === allGamesMode.calculationModeCaption,
    '12-5d: manual mode shares allAlmaMaterGames\' caption — calculateAlmaMaterTotal() treats them identically, no invented three-way distinction');

  const updated = wizard.applyTiebreakerQuestion({ weekId: 'w1', tiebreakerQuestion: 'old' }, 'new question');
  assert(updated.tiebreakerQuestion === 'new question' && updated.weekId === 'w1',
    '12-6: applyTiebreakerQuestion() layers the new question onto the SAME week object, nothing else touched');

  // Ruling 4, mutation-proven: gatingChecklist() itself must remain
  // COMPLETELY blind to the tiebreaker question — a blank question must
  // never flip canOpen to false. This directly guards against the exact
  // regression the DI itself named as a live risk (touching the existing
  // gatingChecklist() contract other tests pin).
  const gateWithNoTiebreakerContext = wizard.gatingChecklist({ gamesCount: 10, missingSpreadCount: 0, timingConfigured: true });
  assert(gateWithNoTiebreakerContext.canOpen === true,
    '12-7 (ruling 4 mutation guard): gatingChecklist() has no tiebreaker parameter at all — a blank question cannot block Open because there is no code path for it to block through');
  assert(Object.keys(gateWithNoTiebreakerContext).every((k) => !/tiebreak/i.test(k)),
    '12-8: gatingChecklist()\'s return shape carries no tiebreaker-named field whatsoever — confirms this DI added a SECOND surface, never touched the first');
}

console.log('\n[13] DI-358 — finishWeekSetupFromWizard(): Now / Scheduled / Draft, one function, three modes…');
{
  // DI-404 (UN-388) — carries a valid blurb so the Now/Scheduled cases below
  // still test what they always tested; the blurb gate is proven in [18].
  const week = { weekId: 'w1', weekNumber: 5, status: 'draft', blurb: 'Rivalry week — bring your A game.' };
  const goodArgs = { week, gamesCount: 10, missingSpreadCount: 0, timingConfigured: true };

  // ── NOW — delegates to openForPicksFromWizard(), unchanged behavior ──
  {
    let statusChangeCalls = 0, toastCalls = 0;
    const deps = {
      applyWeekStatusChange: (w, to) => { statusChangeCalls++; return { ...w, status: to }; },
      showToast: () => { toastCalls++; },
      isNativeShell: () => false, nativeHapticImpact: () => {},
    };
    const result = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: wizard.OPEN_MODES.NOW, deps });
    assert(result.ok === true && result.mode === 'now' && result.week.status === 'open',
      `13-1: NOW opens immediately (got ${JSON.stringify(result)})`);
    assert(statusChangeCalls === 1 && toastCalls === 1, '13-2: NOW calls applyWeekStatusChange + toast exactly once each');

    const blockedGate = wizard.finishWeekSetupFromWizard({ week, gamesCount: 0, missingSpreadCount: 0, timingConfigured: true, mode: wizard.OPEN_MODES.NOW, deps });
    assert(blockedGate.ok === false && blockedGate.gate.canOpen === false,
      '13-3 (mutation guard): NOW with an unmet checklist item is refused, exactly like the direct openForPicks() gate');
  }

  // ── SCHEDULED — saves picksOpenAt, week STAYS draft, never calls applyWeekStatusChange ──
  {
    let statusChangeCalls = 0, savedWeek = null, toastCalls = 0;
    const deps = {
      applyWeekStatusChange: () => { statusChangeCalls++; },
      saveWeek: (w) => { savedWeek = w; },
      showToast: () => { toastCalls++; },
    };
    const future = new Date(Date.now() + 86400000).toISOString();
    const result = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, deps });
    assert(result.ok === true && result.week.status === 'draft' && result.week.picksOpenAt === new Date(future).toISOString(),
      `13-4: SCHEDULED saves picksOpenAt and leaves status at draft (got ${JSON.stringify(result)})`);
    assert(statusChangeCalls === 0, '13-5 (mutation guard): SCHEDULED never calls applyWeekStatusChange — the tick, not this function, flips status later');
    assert(savedWeek && savedWeek.picksOpenAt, '13-6: saveWeek() was actually called with the scheduled timestamp');
    assert(toastCalls === 1, '13-7: a success toast fires once');

    const noDatetime = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: '', deps });
    assert(noDatetime.ok === false && noDatetime.reason === 'missing_scheduled_at',
      '13-8: SCHEDULED with no datetime refuses cleanly, never saves');

    const badDatetime = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: 'not-a-date', deps });
    assert(badDatetime.ok === false && badDatetime.reason === 'invalid_scheduled_at',
      '13-9: SCHEDULED with an unparseable datetime refuses cleanly, never saves garbage');

    const blockedGate = wizard.finishWeekSetupFromWizard({ week, gamesCount: 10, missingSpreadCount: 2, timingConfigured: true, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, deps });
    assert(blockedGate.ok === false && blockedGate.gate.canOpen === false,
      '13-10 (mutation guard): SCHEDULED is gated by the SAME three-item checklist as an immediate open — missing spreads refuses it too');

    // coordinator fix, item 7 — SCHEDULED requires week.status === 'draft'.
    const notDraftWeek = { ...week, status: 'open' };
    const notDraftResult = wizard.finishWeekSetupFromWizard({ ...goodArgs, week: notDraftWeek, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, deps });
    assert(notDraftResult.ok === false && notDraftResult.reason === 'week_not_draft',
      `13-14 (mutation guard): SCHEDULED on a non-draft (already OPEN) week refuses cleanly, before even looking at the datetime (got ${JSON.stringify(notDraftResult)})`);
    const noWeekResult = wizard.finishWeekSetupFromWizard({ ...goodArgs, week: null, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, deps });
    assert(noWeekResult.ok === false && noWeekResult.reason === 'week_not_draft', '13-14b: no week at all ⇒ same refusal, never a throw');

    // coordinator fix, item 7 — SCHEDULED rejects a datetime that has already passed.
    const pastAt = new Date(Date.now() - 60000).toISOString();
    const pastResult = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: pastAt, deps });
    assert(pastResult.ok === false && pastResult.reason === 'past_scheduled_at',
      `13-15: a scheduled time already in the past refuses cleanly, distinct reason from "invalid" (got ${JSON.stringify(pastResult)})`);
    assert(wizard.WIZARD_COPY.SCHEDULE_PAST_DATETIME === 'That time has passed. Choose Open now or a later time.',
      '13-15b: the exact inline copy for this refusal');

    // The boundary, deterministically, via the explicit `now` param — a
    // scheduled time exactly AT "now" counts as passed (<=, not <): waiting
    // for the real clock to catch up would make this test flaky, and a
    // `<` mutation would let an already-arrived moment silently "schedule."
    const fixedNow = Date.now();
    const exactlyNow = new Date(fixedNow).toISOString();
    const exactResult = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: exactlyNow, now: fixedNow, deps });
    assert(exactResult.ok === false && exactResult.reason === 'past_scheduled_at',
      '13-16 (mutation guard): a scheduled time exactly equal to "now" counts as already passed');
    const oneSecondFutureResult = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: new Date(fixedNow + 1000).toISOString(), now: fixedNow, deps });
    assert(oneSecondFutureResult.ok === true,
      '13-17: one second later than the same "now" succeeds — confirms this is a real boundary check, not an always-refuse regression');
  }

  // ── DRAFT — no gate check, no status change, no write of any kind ──
  {
    let anyDepCalled = false;
    const deps = {
      applyWeekStatusChange: () => { anyDepCalled = true; },
      saveWeek: () => { anyDepCalled = true; },
      showToast: () => { anyDepCalled = true; },
    };
    // Deliberately pass a FAILING gate (0 games) — DRAFT must succeed anyway,
    // proving it truly never consults the checklist.
    const result = wizard.finishWeekSetupFromWizard({ week, gamesCount: 0, missingSpreadCount: 0, timingConfigured: false, mode: wizard.OPEN_MODES.DRAFT, deps });
    assert(result.ok === true && result.week === week,
      `13-11: DRAFT always succeeds, gate or no gate (got ${JSON.stringify(result)})`);
    assert(anyDepCalled === false, '13-12 (mutation guard): DRAFT calls NOTHING in deps — no status change, no save, no toast');
  }

  const unknown = wizard.finishWeekSetupFromWizard({ ...goodArgs, mode: 'bogus', deps: {} });
  assert(unknown.ok === false && unknown.reason === 'unknown_mode', '13-13: an unrecognised mode refuses cleanly, never a throw');
}

console.log('\n[14] DI-358 — dueForScheduledOpen(): {due, blocked, gate} for the tickAutoTransition() draft→open leg…');
{
  const now = Date.now();
  const past = new Date(now - 60000).toISOString();
  const future = new Date(now + 60000).toISOString();
  const okArgs = { gamesCount: 10, missingSpreadCount: 0, timingConfigured: true };

  // coordinator fix, item 6 — a bare boolean conflated "not due yet" with
  // "due, but the week can't actually open," leaving the tick with no way
  // to raise a notice for the second case. Now {due, blocked, gate}.
  // DI-404 AMENDED (coordinator override, 2026-09-30) — a due week ALSO needs a
  // valid blurb now, so the "due" fixtures below carry one; blank/short/demo is [18].
  const blurbOk14 = 'Rivalry week — bring your A game.';
  const dueResult = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: past, blurb: blurbOk14 }, now, ...okArgs });
  assert(dueResult.due === true && dueResult.blocked === false && !!dueResult.gate && dueResult.gate.canOpen === true,
    `14-1: draft, scheduled time in the past, checklist clear ⇒ due:true, blocked:false, gate present and canOpen (got ${JSON.stringify(dueResult)})`);

  const futureResult = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: future }, now, ...okArgs });
  assert(futureResult.due === false && futureResult.blocked === false && futureResult.gate === null,
    `14-2 (mutation guard): scheduled time still in the FUTURE ⇒ due:false, blocked:false, gate:null — nothing to check yet (catches a flipped >= / < comparison) (got ${JSON.stringify(futureResult)})`);

  const openWeekResult = wizard.dueForScheduledOpen({ week: { status: 'open', picksOpenAt: past }, now, ...okArgs });
  assert(openWeekResult.due === false && openWeekResult.blocked === false && openWeekResult.gate === null,
    '14-3 (mutation guard): week is already OPEN (not draft) ⇒ never due, never blocked — this predicate is draft→open ONLY');

  const noScheduleResult = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: null }, now, ...okArgs });
  assert(noScheduleResult.due === false && noScheduleResult.blocked === false,
    '14-4: no picksOpenAt at all ⇒ due:false, blocked:false (nothing was scheduled)');

  const noWeekResult = wizard.dueForScheduledOpen({ week: null, now, ...okArgs });
  assert(noWeekResult.due === false && noWeekResult.blocked === false,
    '14-5: no week ⇒ due:false, blocked:false, never a throw');

  const badDateResult = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: 'not-a-date' }, now, ...okArgs });
  assert(badDateResult.due === false && badDateResult.blocked === false,
    '14-6: an unparseable picksOpenAt ⇒ due:false, blocked:false, never a throw or a false positive');

  // THE case this fix exists for: the scheduled time has passed but the
  // checklist doesn't clear — the tick's cue to raise a commissioner
  // notice instead of silently never opening.
  const blockedResult = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: past }, now, gamesCount: 0, missingSpreadCount: 0, timingConfigured: true });
  assert(blockedResult.due === false && blockedResult.blocked === true && !!blockedResult.gate && blockedResult.gate.canOpen === false,
    `14-7 (REQUIRED mutation guard): scheduled time has passed but the checklist is UNMET (no games) ⇒ due:false, BLOCKED:true, gate present and NOT canOpen (got ${JSON.stringify(blockedResult)})`);
  assert(blockedResult.gate.gamesLabel === 'No games on slate yet',
    '14-8: the returned gate names EXACTLY which check failed, verbatim from gatingChecklist(), for a real commissioner-facing notice');

  const missingSpreadsBlocked = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: past }, now, gamesCount: 10, missingSpreadCount: 3, timingConfigured: true });
  assert(missingSpreadsBlocked.due === false && missingSpreadsBlocked.blocked === true,
    '14-9: past due + missing spreads specifically ⇒ also blocked, not silently treated as due');

  // due and blocked are mutually exclusive, exhaustively, once the time has passed.
  for (const [gamesOk, spreadsOk, timingOk, expectDue] of [
    [true, true, true, true], [false, true, true, false], [true, false, true, false], [true, true, false, false],
  ]) {
    const r = wizard.dueForScheduledOpen({
      week: { status: 'draft', picksOpenAt: past, blurb: blurbOk14 }, now,
      gamesCount: gamesOk ? 5 : 0, missingSpreadCount: spreadsOk ? 0 : 2, timingConfigured: timingOk,
    });
    assert(r.due === expectDue && r.blocked === !expectDue,
      `14-10: games=${gamesOk} spreads=${spreadsOk} timing=${timingOk} ⇒ due=${expectDue}, blocked=${!expectDue} (got due=${r.due} blocked=${r.blocked})`);
  }
}

console.log('\n[15] DI-359 — Finalize Week guided flow: FINALIZE_STEPS shape, and every step\'s action…');
{
  assert(wizard.FINALIZE_STEPS.length === 4 && wizard.FINALIZE_STEP_COUNT === 4,
    '15-1: four steps — Approve Scores, Confirm Tiebreaker, Confirm Extra Point, Finalize');
  assert(wizard.FINALIZE_STEPS.every((s, i) => s.step === i + 1),
    '15-2: numbered 1..4 in order');
  assert(wizard.FINALIZE_STEPS.map((s) => s.id).join(',') === 'approve-scores,confirm-tiebreaker,confirm-extra-point,finalize',
    '15-3: step ids match the DI\'s own sequence exactly');

  console.log('  -- Step 1: Approve Scores --');
  {
    const readyGames = [{ status: 'final', lockedSpread: -3.5 }, { status: 'final', lockedSpread: 0 }];
    const readySummary = wizard.finalizeApproveScoresSummary(readyGames);
    assert(readySummary.blocked === false, '15-4: all games final + locked-spread ⇒ not blocked');

    const notFinalGames = [{ status: 'live', lockedSpread: -3.5 }];
    assert(wizard.finalizeApproveScoresSummary(notFinalGames).blocked === true,
      '15-5 (mutation guard): a non-final game ⇒ blocked');
    const missingLockGames = [{ status: 'final', lockedSpread: null }];
    assert(wizard.finalizeApproveScoresSummary(missingLockGames).blocked === true,
      '15-6 (mutation guard): a final game with no locked spread ⇒ blocked');
    assert(wizard.finalizeApproveScoresSummary([]).blocked === true,
      '15-7: an empty slate ⇒ blocked (nothing to approve)');
    // PK=0 must not be confused with "missing" (=== null/undefined check, not truthiness).
    const pkGame = [{ status: 'final', lockedSpread: 0 }];
    assert(wizard.finalizeApproveScoresSummary(pkGame).blocked === false,
      '15-8 (mutation guard): lockedSpread:0 (a real PK) is NOT "missing" — a falsy-check regression would wrongly block this');

    // coordinator fix, item 1, REQUIRED (review round on ddf9e4f) —
    // finalizeApproveScores() must NEVER call finalizeWeek(): that function
    // publishes permanent chat posts and raises the obligation off
    // actualTiebreakerValue, which is still null this early in the flow.
    // `finalizeWeek` is deliberately still PRESENT in `deps` below (proving
    // the guard is "never call it," not "the dep happens to be absent").
    let gradedCalls = 0, finalizeWeekCalls = 0;
    const deps = {
      calculateAtsWinner: (g) => 'home',
      saveGame: () => { gradedCalls++; },
      finalizeWeek: () => { finalizeWeekCalls++; },
    };
    const blockedResult = wizard.finalizeApproveScores({ week: { weekId: 'w1' }, games: notFinalGames, deps });
    assert(blockedResult.ok === false && gradedCalls === 0 && finalizeWeekCalls === 0,
      '15-9 (mutation guard/confirm gate): a BLOCKED slate refuses to grade at all — this is the step\'s own confirm gate');

    const okResult = wizard.finalizeApproveScores({ week: { weekId: 'w1' }, games: readyGames, deps });
    assert(okResult.ok === true && gradedCalls === 2,
      `15-10: a ready slate grades every eligible game once (got graded=${gradedCalls})`);
    assert(finalizeWeekCalls === 0,
      `15-10b (REQUIRED, mutation guard): finalizeApproveScores() NEVER calls finalizeWeek(), even on a fully-ready, successfully-graded slate — finalizeWeek() posts permanent chat and computes the obligation, and runs exactly once, at Step 4 only (got finalizeWeekCalls=${finalizeWeekCalls})`);
  }

  console.log('  -- Step 2: Confirm Tiebreaker --');
  {
    const noExisting = wizard.tiebreakerConfirmSummary({ week: { tiebreakerQuestion: 'Total points?' }, autoCalcValue: 47 });
    assert(noExisting.prefillValue === 47 && noExisting.alreadySet === false,
      '15-11: no actualTiebreakerValue on file ⇒ prefill is the Auto-Calc value');
    const existing = wizard.tiebreakerConfirmSummary({ week: { actualTiebreakerValue: 52 }, autoCalcValue: 47 });
    assert(existing.prefillValue === 52 && existing.alreadySet === true,
      '15-12 (mutation guard): an EXISTING actual value takes priority over the fresh Auto-Calc — never force re-entry');

    let autoCalcArgsUsed = null;
    const autoCalcDeps = {
      calculateAlmaMaterTotal: (games, roster, mode) => { autoCalcArgsUsed = { games, roster, mode }; return 55; },
      almaMatersForAutoCalc: (week) => ['Alabama', 'Georgia'],
      getGames: (weekId) => [{ weekId, homeTeam: 'Alabama' }],
    };
    const autoCalc = wizard.finalizeAutoCalcTiebreaker({ week: { weekId: 'w1', tiebreakerCalculationMode: 'selectedSlateOnly' }, deps: autoCalcDeps });
    assert(autoCalc.ok === true && autoCalc.value === 55, '15-13: Auto-Calc runs and returns the total');
    assert(autoCalcArgsUsed.roster.length === 2 && autoCalcArgsUsed.mode === 'selectedSlateOnly',
      '15-14: Auto-Calc is called with the FROZEN roster (almaMatersForAutoCalc) and the week\'s own calc mode, not re-derived');

    const noScoresYet = wizard.finalizeAutoCalcTiebreaker({
      week: { weekId: 'w1' },
      deps: { calculateAlmaMaterTotal: () => null, almaMatersForAutoCalc: () => [], getGames: () => [] },
    });
    assert(noScoresYet.ok === false && noScoresYet.value === null,
      '15-15 (mutation guard): calculateAlmaMaterTotal() returning null (no final alma-mater scores yet) surfaces as ok:false, never a fake 0');

    // coordinator fix, item 3, REQUIRED (RG-256 class) — confirmFinalizeTiebreaker()
    // must re-read deps.getWeek(week.weekId) || week before spreading;
    // `getWeek` is now a required dep, backed by a real store so the
    // re-read is meaningfully exercised, not just a pass-through no-op.
    const store15 = new Map();
    let finalizeWeekCalls = 0;
    const confirmDeps = {
      saveWeek: (w) => store15.set(w.weekId, w),
      finalizeWeek: () => { finalizeWeekCalls++; },
      getWeek: (weekId) => store15.get(weekId) || null,
    };
    store15.set('w1', { weekId: 'w1', status: 'live' });
    const liveWeekResult = wizard.confirmFinalizeTiebreaker({ week: store15.get('w1'), actualValue: 55, deps: confirmDeps });
    assert(liveWeekResult.week.actualTiebreakerValue === 55 && liveWeekResult.week.tiebreakerFinalized === true,
      '15-16: actualTiebreakerValue + tiebreakerFinalized are written together, one save');
    assert(finalizeWeekCalls === 0,
      '15-17 (mutation guard): a LIVE (not-yet-final) week does NOT trigger a finalizeWeek() recompute here — that happens once, at Step 4');

    store15.set('w1', { ...store15.get('w1'), status: 'final' });
    const finalWeekResult = wizard.confirmFinalizeTiebreaker({ week: store15.get('w1'), actualValue: 60, deps: confirmDeps });
    assert(finalizeWeekCalls === 1,
      '15-18 (mutation guard): editing the tiebreaker on an ALREADY-FINAL week DOES trigger the recompute, matching the standalone card\'s own conditional exactly');
    assert(finalWeekResult.week.weekId === 'w1', '15-19: saveWeek was actually called');

    // RG-256 mutation guard — a STALE `week` argument (the caller never
    // re-fetched after some OTHER write already landed on the mirror) must
    // not roll that write back when this function spreads its own base.
    const staleStore = new Map();
    staleStore.set('w2', { weekId: 'w2', status: 'live', extraPointActual: 41 }); // some earlier step already wrote this
    const staleDeps = {
      saveWeek: (w) => staleStore.set(w.weekId, w),
      finalizeWeek: () => {},
      getWeek: (weekId) => staleStore.get(weekId) || null,
    };
    const staleOriginalWeek = { weekId: 'w2', status: 'live' }; // the caller's OWN, pre-write snapshot
    const staleResult = wizard.confirmFinalizeTiebreaker({ week: staleOriginalWeek, actualValue: 55, deps: staleDeps });
    assert(staleResult.week.extraPointActual === 41,
      `15-19b (REQUIRED, RG-256 mutation guard): called with a STALE week object, this must not lose a field the mirror already has (extraPointActual) — got ${JSON.stringify(staleResult.week)}`);
    assert(staleResult.week.actualTiebreakerValue === 55,
      '15-19c: …and still applies its OWN write correctly on top of the fresh base');

    // coordinator fix, item 5 — refuses NaN/Infinity; null STAYS LEGAL.
    const nanResult = wizard.confirmFinalizeTiebreaker({ week: { weekId: 'w3' }, actualValue: NaN, deps: confirmDeps });
    assert(nanResult.ok === false, '15-19d (mutation guard): NaN actualValue is refused, never written');
    const infResult = wizard.confirmFinalizeTiebreaker({ week: { weekId: 'w3' }, actualValue: Infinity, deps: confirmDeps });
    assert(infResult.ok === false, '15-19e: Infinity is refused too');
    const strResult = wizard.confirmFinalizeTiebreaker({ week: { weekId: 'w3' }, actualValue: 'fifty-five', deps: confirmDeps });
    assert(strResult.ok === false, '15-19f: a non-numeric string is refused too');
    const nullDeps = { ...confirmDeps, getWeek: () => null };
    const nullResult = wizard.confirmFinalizeTiebreaker({ week: { weekId: 'w4', status: 'live' }, actualValue: null, deps: nullDeps });
    assert(nullResult.ok === true && nullResult.week.actualTiebreakerValue === null && nullResult.week.tiebreakerFinalized === false,
      `15-19g: null STAYS LEGAL for the tiebreaker — a real "no value yet" state, never refused (got ${JSON.stringify(nullResult)})`);
  }

  console.log('  -- Step 3: Confirm Extra Point --');
  {
    const noActual = wizard.finalizeExtraPointSummary({ week: { weekId: 'w1' }, players: [], deps: { gradeWeekExtraPoint: () => { throw new Error('should not be called'); } } });
    assert(noActual.hasActual === false && noActual.graded === null,
      '15-20 (mutation guard): no extraPointActual on file ⇒ never calls gradeWeekExtraPoint at all');

    let gradeArgsUsed = null;
    const withActual = wizard.finalizeExtraPointSummary({
      week: { weekId: 'w1', extraPointActual: 42 }, players: [{ playerId: 'p1' }],
      deps: { gradeWeekExtraPoint: (w, players) => { gradeArgsUsed = { w, players }; return { actual: 42, rows: [] }; } },
    });
    assert(withActual.hasActual === true && withActual.actualValue === 42 && withActual.graded.actual === 42,
      '15-21: an existing actual value is graded via the injected gradeWeekExtraPoint(), unchanged');
    assert(gradeArgsUsed.players.length === 1, '15-22: the caller\'s player list is passed through untouched');

    // coordinator fix, item 3, REQUIRED (RG-256 class) — confirmFinalizeExtraPoint()
    // must re-read deps.getWeek(week.weekId) || week before spreading.
    const store3 = new Map();
    store3.set('w1', { weekId: 'w1', status: 'live' });
    const confirmEpDeps = { saveWeek: (w) => store3.set(w.weekId, w), getWeek: (weekId) => store3.get(weekId) || null };
    const confirmed = wizard.confirmFinalizeExtraPoint({ week: store3.get('w1'), actualValue: 38, deps: confirmEpDeps });
    assert(confirmed.ok === true && confirmed.week.extraPointActual === 38 && store3.get('w1').extraPointActual === 38,
      '15-23: confirming writes extraPointActual via saveWeek(), the same field the standalone card writes');

    // coordinator fix, item 5 — refuses non-finite (including null/undefined
    // — unlike the tiebreaker, ep-save-btn NEVER accepts a blank value).
    assert(wizard.confirmFinalizeExtraPoint({ week: { weekId: 'w1' }, actualValue: NaN, deps: confirmEpDeps }).ok === false,
      '15-23b (mutation guard): NaN is refused, matching ep-save-btn\'s own Number.isFinite guard (app.js:19752-19754)');
    assert(wizard.confirmFinalizeExtraPoint({ week: { weekId: 'w1' }, actualValue: Infinity, deps: confirmEpDeps }).ok === false,
      '15-23c: Infinity is refused too');
    assert(wizard.confirmFinalizeExtraPoint({ week: { weekId: 'w1' }, actualValue: null, deps: confirmEpDeps }).ok === false,
      '15-23d (mutation guard): null is ALSO refused for Extra Point — unlike the tiebreaker, this button never has a legal blank state');
    assert(wizard.confirmFinalizeExtraPoint({ week: { weekId: 'w1' }, actualValue: undefined, deps: confirmEpDeps }).ok === false,
      '15-23e: undefined is refused too');

    // THE EXACT SEQUENCE the coordinator specified (review round on ddf9e4f,
    // item 3): Step 2 (Confirm Tiebreaker) saves onto the mirror; Step 3
    // (Confirm Extra Point) is then called with the ORIGINAL, pre-Step-2
    // week object (the shape a stale render closure could hold) — this
    // must NOT null out the tiebreaker Step 2 already wrote.
    const seqStore = new Map();
    const originalWeek = { weekId: 'w5', status: 'live' };
    seqStore.set('w5', originalWeek);
    const seqDeps = {
      saveWeek: (w) => seqStore.set(w.weekId, w),
      getWeek: (weekId) => seqStore.get(weekId) || null,
      finalizeWeek: () => {},
    };
    wizard.confirmFinalizeTiebreaker({ week: originalWeek, actualValue: 55, deps: seqDeps }); // "Step 2 saves"
    assert(seqStore.get('w5').actualTiebreakerValue === 55,
      '15-23f fixture check: Step 2 really did write the tiebreaker onto the mirror');
    const step3Result = wizard.confirmFinalizeExtraPoint({ week: originalWeek, actualValue: 40, deps: seqDeps }); // "Step 3 called with the ORIGINAL object"
    assert(step3Result.week.actualTiebreakerValue === 55,
      `15-23g (REQUIRED, RG-256 mutation guard): Step 3 called with the ORIGINAL (pre-Step-2) week object must NOT null the tiebreaker Step 2 already saved (got ${JSON.stringify(step3Result.week)})`);
    assert(step3Result.week.extraPointActual === 40,
      '15-23h: …and still applies Step 3\'s own write correctly on top of the fresh base');
  }

  console.log('  -- Step 4: Finalize --');
  {
    const tieShown = wizard.unresolvedTieWarning({
      week: { weekId: 'w1' }, players: [], picks: [], games: [],
      deps: { weekHasUnresolvedTie: () => true },
    });
    assert(tieShown.show === true && tieShown.text === wizard.WIZARD_COPY.UNRESOLVED_TIE_WARNING,
      '15-24: an unresolved tie shows the inline warning, exact copy — never a browser confirm()');

    const noTie = wizard.unresolvedTieWarning({
      week: { weekId: 'w1' }, players: [], picks: [], games: [],
      deps: { weekHasUnresolvedTie: () => false },
    });
    assert(noTie.show === false && noTie.text === '', '15-25 (mutation guard): no tie ⇒ show:false and empty text, not a truthy leftover');

    const noDepAtAll = wizard.unresolvedTieWarning({ week: { weekId: 'w1' }, players: [], picks: [], games: [], deps: {} });
    assert(noDepAtAll.show === false, '15-26: missing the weekHasUnresolvedTie dep entirely ⇒ defaults to false, never a throw');

    // SP-54 / DI-469 — the dynamic notice dependency (js/tie-context.js, injected by app.js; this module keeps ZERO imports).
    {
      let seen = null, legacyCalls = 0;
      const wk = { weekId: 'w1' }, pl = [{ playerId: 'p' }], pk = [{ gameId: 'g' }], gm = [{ gameId: 'g' }];
      const dyn = wizard.unresolvedTieWarning({ week: wk, players: pl, picks: pk, games: gm,
        deps: { weekHasUnresolvedTie: () => { legacyCalls++; return true; }, finalizeTieNotice: (...a) => { seen = a; return { show: true, kind: 'ep-missing', text: 'DYNAMIC TEXT' }; } } });
      assert(dyn.show === true && dyn.text === 'DYNAMIC TEXT', '15-26b (SP-54): with a finalizeTieNotice dependency the warning IS its text and show');
      assert(seen && seen[0] === wk && seen[1] === pl && seen[2] === pk && seen[3] === gm && seen[4] === 'wizard', '15-26c (SP-54): …called with (week, players, picks, games) UNCHANGED and the \'wizard\' variant');
      assert(legacyCalls === 0, '15-26d (SP-54): …and the legacy weekHasUnresolvedTie dependency is NOT consulted when the dynamic one is present');
      const quiet = wizard.unresolvedTieWarning({ week: wk, players: pl, picks: pk, games: gm, deps: { weekHasUnresolvedTie: () => true, finalizeTieNotice: () => ({ show: false, kind: null, text: '' }) } });
      assert(quiet.show === false && quiet.text === '', '15-26e (SP-54): a silent notice (a true dead heat, no tie) shows nothing, even when the legacy trigger would have');
      const malformed = wizard.unresolvedTieWarning({ week: wk, players: pl, picks: pk, games: gm, deps: { finalizeTieNotice: () => null } });
      assert(malformed.show === false && malformed.text === '', '15-26f (SP-54): a dependency that returns nothing is a silent warning, never a throw');
      const legacy = wizard.WIZARD_COPY.UNRESOLVED_TIE_WARNING;
      assert(/alma mater against the spread, then the Extra Point/.test(legacy) && /Confirm Tiebreaker/.test(legacy) && !/arbitrar/i.test(legacy) && !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(legacy),
        `15-26g (SP-54): the LEGACY body is reworded to name what decides the tie (no "arbitrarily") and carries no written-text emoji (D-1): "${legacy}"`);
    }

    // coordinator fix, item 3, REQUIRED (RG-256 class) — confirmFinalizeWeek()
    // must re-read deps.getWeek(week.weekId) || week before spreading, so
    // this step's base carries whatever Steps 1-3 already wrote onto the
    // mirror (graded ATS, actualTiebreakerValue, extraPointActual) even if
    // the caller's own `week` reference is stale.
    const store4 = new Map();
    store4.set('w1', { weekId: 'w1', status: 'live', pendingFinalization: true, actualTiebreakerValue: 55, extraPointActual: 40 });
    let finalizeWeekCalls = 0, finalizeWeekArg = null;
    const deps = {
      saveWeek: (w) => store4.set(w.weekId, w),
      getWeek: (weekId) => store4.get(weekId) || null,
      finalizeWeek: (w) => { finalizeWeekCalls++; finalizeWeekArg = w; },
    };
    const result = wizard.confirmFinalizeWeek({ week: store4.get('w1'), deps });
    assert(result.week.status === 'final' && result.week.pendingFinalization === false && result.week.finalizedAt,
      `15-27: status flips to final, pendingFinalization clears, finalizedAt is stamped (got ${JSON.stringify(result.week)})`);
    assert(result.week.actualTiebreakerValue === 55 && result.week.extraPointActual === 40,
      '15-27b: the finalized week still carries everything Steps 2/3 wrote — nothing lost by re-reading the mirror first');
    assert(finalizeWeekCalls === 1, '15-28: finalizeWeek() is called exactly once');
    assert(finalizeWeekArg.status === 'final' && finalizeWeekArg === store4.get('w1'),
      '15-29 (mutation guard): finalizeWeek() receives the PERSISTED (post-save) object, never the pre-transition snapshot — same invariant confirm-finalize-btn\'s own handler documents');
    {
      let secondArg = null;
      const s5 = new Map([['w9', { weekId: 'w9', status: 'live', pendingFinalization: true }]]);
      wizard.confirmFinalizeWeek({ week: s5.get('w9'), deps: { saveWeek: (w) => s5.set(w.weekId, w), getWeek: (id) => s5.get(id) || null, finalizeWeek: (w, o) => { secondArg = o; } } });
      assert(secondArg && secondArg.settling === true, '15-29c (SP-54 / N-3): the wizard\'s Finalize IS the live-to-final transition, so finalizeWeek() is called with { settling: true }');
    }

    // RG-256 mutation guard, stale-object variant for this step too.
    const staleStore4 = new Map();
    staleStore4.set('w6', { weekId: 'w6', status: 'live', pendingFinalization: true, actualTiebreakerValue: 70 });
    const staleOriginal4 = { weekId: 'w6', status: 'live', pendingFinalization: true }; // caller's stale snapshot
    const staleDeps4 = {
      saveWeek: (w) => staleStore4.set(w.weekId, w),
      getWeek: (weekId) => staleStore4.get(weekId) || null,
      finalizeWeek: () => {},
    };
    const staleFinalizeResult = wizard.confirmFinalizeWeek({ week: staleOriginal4, deps: staleDeps4 });
    assert(staleFinalizeResult.week.actualTiebreakerValue === 70,
      `15-29b (REQUIRED, RG-256 mutation guard): Finalize called with a stale week object must not lose the tiebreaker already on the mirror (got ${JSON.stringify(staleFinalizeResult.week)})`);
  }
}

console.log('\n[16] createWeekWizard() factory — every DI-353/354/357/358/359 function is exposed and behaves identically bound…');
{
  const factoryStore = new Map();
  factoryStore.set('w1', { weekId: 'w1', status: 'live' });
  const w = wizard.createWeekWizard({
    applyWeekStatusChange: (wk, to) => ({ ...wk, status: to }),
    showToast: () => {}, saveWeek: (wk) => factoryStore.set(wk.weekId, wk),
    // coordinator fix, item 3 — getWeek is now part of the factory dep bag.
    getWeek: (weekId) => factoryStore.get(weekId) || null,
    isNativeShell: () => false, nativeHapticImpact: () => {},
    calculateAtsWinner: () => 'home', saveGame: () => {}, finalizeWeek: () => {},
    calculateAlmaMaterTotal: () => 50, almaMatersForAutoCalc: () => [], getGames: () => [],
    gradeWeekExtraPoint: () => null, weekHasUnresolvedTie: () => false,
  });
  assert(typeof w.stepBackTarget === 'function' && w.stepBackTarget(3) === 2,
    '16-1: stepBackTarget exposed and bound correctly');
  assert(typeof w.shouldConfirmAnnouncementDiscard === 'function' && w.shouldConfirmAnnouncementDiscard('x') === true,
    '16-2: shouldConfirmAnnouncementDiscard exposed');
  assert(typeof w.tiebreakerStepSummary === 'function' && w.tiebreakerStepSummary({}).hasQuestion === false,
    '16-3: tiebreakerStepSummary exposed');
  assert(typeof w.applyTiebreakerQuestion === 'function' && w.applyTiebreakerQuestion({}, 'q').tiebreakerQuestion === 'q',
    '16-4: applyTiebreakerQuestion exposed');
  assert(typeof w.finishWeekSetup === 'function'
    && w.finishWeekSetup({ week: { weekId: 'w1', status: 'draft' }, mode: 'draft', gamesCount: 0, missingSpreadCount: 0, timingConfigured: false }).ok === true,
    '16-5: finishWeekSetup exposed and bound to deps');
  // coordinator fix, item 6 — dueForScheduledOpen() now returns an object.
  const dueResult16 = w.dueForScheduledOpen({ week: null });
  assert(typeof w.dueForScheduledOpen === 'function' && dueResult16.due === false && dueResult16.blocked === false,
    `16-6: dueForScheduledOpen exposed, returns {due, blocked, gate} (got ${JSON.stringify(dueResult16)})`);
  assert(typeof w.finalizeApproveScores === 'function'
    && w.finalizeApproveScores({ week: { weekId: 'w1' }, games: [{ status: 'final', lockedSpread: 0 }] }).ok === true,
    '16-7: finalizeApproveScores exposed and bound to deps');
  assert(typeof w.finalizeAutoCalcTiebreaker === 'function' && w.finalizeAutoCalcTiebreaker({ weekId: 'w1' }).value === 50,
    '16-8: finalizeAutoCalcTiebreaker exposed and bound to deps');
  assert(typeof w.confirmFinalizeTiebreaker === 'function'
    && w.confirmFinalizeTiebreaker({ week: factoryStore.get('w1'), actualValue: 10 }).ok === true,
    '16-9: confirmFinalizeTiebreaker exposed and bound to deps (incl. the new getWeek dep)');
  assert(typeof w.finalizeExtraPointSummary === 'function'
    && w.finalizeExtraPointSummary({ week: { weekId: 'w1' }, players: [] }).hasActual === false,
    '16-10: finalizeExtraPointSummary exposed and bound to deps');
  assert(typeof w.confirmFinalizeExtraPoint === 'function'
    && w.confirmFinalizeExtraPoint({ week: factoryStore.get('w1'), actualValue: 5 }).ok === true,
    '16-11: confirmFinalizeExtraPoint exposed and bound to deps (incl. the new getWeek dep)');
  assert(typeof w.unresolvedTieWarning === 'function'
    && w.unresolvedTieWarning({ week: {}, players: [], picks: [], games: [] }).show === false,
    '16-12: unresolvedTieWarning exposed and bound to deps');
  assert(typeof w.confirmFinalizeWeek === 'function'
    && w.confirmFinalizeWeek(factoryStore.get('w1')).week.status === 'final',
    '16-13: confirmFinalizeWeek exposed and bound to deps (incl. the new getWeek dep)');
}

console.log('\n[17] DI-411…416 (UN-366…371, 2026-09-28) — WIZARD_SLATE batch, pure-logic pieces…');
{
  // ── DI-411 — "Fetch ESPN…" verbiage removed from the wizard's own copy.
  assert(!/ESPN/i.test(wizard.WIZARD_COPY.FETCH_LOADING), '17-1: FETCH_LOADING no longer names ESPN');
  assert(!/ESPN/i.test(wizard.WIZARD_COPY.FETCH_FAILED), '17-2: FETCH_FAILED no longer names ESPN');
  assert(wizard.WIZARD_COPY.FETCH_LOADING === "Fetching this week's games…", '17-3: FETCH_LOADING exact copy pin');
  assert(wizard.WIZARD_COPY.FETCH_FAILED === "Couldn't fetch games — check your connection and try again.", '17-4: FETCH_FAILED exact copy pin');
  // FETCH_ZERO/FETCH_PARTIAL never named ESPN and are explicitly UNCHANGED —
  // pinned so a future edit can't silently add "ESPN" back into them.
  assert(!/ESPN/i.test(wizard.WIZARD_COPY.FETCH_ZERO), '17-5: FETCH_ZERO still does not name ESPN (unchanged by this DI)');
  assert(!/ESPN/i.test(wizard.WIZARD_COPY.FETCH_PARTIAL(3)), '17-6: FETCH_PARTIAL still does not name ESPN (unchanged by this DI)');

  // ── DI-414 — getAutoFinalizeEnabled() always true, regardless of what's
  //    stored (a pre-existing week explicitly saved with `false` keeps that
  //    value in storage — it just stops being read).
  assert(getAutoFinalizeEnabled({ autoFinalizeEnabled: false }) === true,
    '17-7: getAutoFinalizeEnabled() ignores a stored false — always true');
  assert(getAutoFinalizeEnabled({ autoFinalizeEnabled: true }) === true, '17-8: …and a stored true');
  assert(getAutoFinalizeEnabled(undefined) === true, '17-9: …and no week at all');
  assert(getAutoFinalizeEnabled() === true, '17-10: …and no argument');

  // ── DI-416 — the Step 6 "another week already open" trigger predicate.
  const weeks416 = [
    { weekId: 'w1', weekNumber: 1, status: 'final' },
    { weekId: 'w2', weekNumber: 2, status: 'open' },
  ];
  assert(wizard.anotherWeekAlreadyOpen(weeks416, 'w3')?.weekId === 'w2',
    '17-11: a genuinely different, currently-open week is flagged (w3 is the one being set up)');
  assert(wizard.anotherWeekAlreadyOpen(weeks416, 'w2') === null,
    '17-12: the week being set up itself is excluded, even though its own status is open');
  assert(wizard.anotherWeekAlreadyOpen([{ weekId: 'w1', status: 'final' }], 'w2') === null,
    '17-13: no other week open/locked/live ⇒ null (no notice)');
  for (const status of ['open', 'locked', 'live']) {
    assert(wizard.anotherWeekAlreadyOpen([{ weekId: 'w1', status }], 'w2')?.status === status,
      `17-14 (${status}): each of the three flaggable statuses is caught`);
  }
  for (const status of ['draft', 'final']) {
    assert(wizard.anotherWeekAlreadyOpen([{ weekId: 'w1', status }], 'w2') === null,
      `17-15 (${status}): draft/final never trigger the notice`);
  }
  assert(wizard.anotherWeekAlreadyOpen([], 'w1') === null, '17-16: an empty week list ⇒ null, not a throw');
  assert(wizard.anotherWeekAlreadyOpen(null, 'w1') === null, '17-17: a null week list ⇒ null, not a throw');
}

console.log('\n[18] DI-404 (UN-388, N16, 2026-09-29) — the mandatory weekly blurb: blurbCheck(), who is gated, and the two open paths…');
{
  const GOOD = 'Rivalry week — bring your A game.';

  // ── blurbCheck(): the ONE definition of "filled" ────────────────────────
  assert(wizard.BLURB_MIN_LENGTH === 10, '18-1: the minimum is ten characters');
  for (const [label, input] of [['empty string', ''], ['null', null], ['undefined', undefined], ['a number', 12345678901], ['spaces only', '          '], ['whitespace mix', ' \n\t \n  \t ']]) {
    const c = wizard.blurbCheck(input);
    assert(c.ok === false && c.reason === 'empty' && c.length === 0, `18-2 (${label}): reads as EMPTY, not short and not a throw (got ${JSON.stringify(c)})`);
  }
  const nine = wizard.blurbCheck('abcdefghi');
  const ten = wizard.blurbCheck('abcdefghij');
  assert(nine.ok === false && nine.reason === 'short' && nine.length === 9, `18-3: NINE characters is SHORT (got ${JSON.stringify(nine)})`);
  assert(ten.ok === true && ten.reason === null && ten.length === 10, `18-4: TEN characters is the first that passes (got ${JSON.stringify(ten)})`);
  assert(wizard.blurbCheck('abcde          fg').reason === 'short',
    '18-5: whitespace COLLAPSES before counting — 2 words padded with 10 spaces are 8 characters, not 17');
  assert(wizard.blurbCheck('abcd\n\n\n\nefgh').reason === 'short',
    '18-6: newlines collapse too — "abcd" + blank lines + "efgh" is 9, not 12');
  assert(wizard.blurbCheck('    abcdefghi    ').reason === 'short' && wizard.blurbCheck('    abcdefghij    ').ok === true,
    '18-7: leading/trailing padding is trimmed before the count (9 stays short, 10 passes)');
  assert(wizard.blurbCheck('  abcde   fghi  ').ok === true && wizard.blurbCheck('  abcde   fghi  ').text === 'abcde fghi',
    '18-8: "abcde fghi" is exactly ten once collapsed and trimmed — the boundary is on the COLLAPSED text');
  assert(wizard.blurbCheck('🔥🔥🔥🔥🔥🔥🔥🔥🔥').reason === 'short' && wizard.blurbCheck('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥').ok === true,
    '18-9: characters are counted as a person reads them — an emoji is ONE, so nine 🔥 is short and ten passes');
  assert(wizard.blurbCheck(GOOD).ok === true, '18-10: a real blurb passes');

  // ── the exact inline copy (DI-404 item 4) ────────────────────────────────
  assert(wizard.WIZARD_COPY.BLURB_EMPTY === "Add a note for your players — it's the first thing they see on the Picks page.", '18-11: empty copy, verbatim');
  assert(wizard.WIZARD_COPY.BLURB_SHORT === 'A little longer, please — at least 10 characters.', '18-12: short copy, verbatim');
  assert(wizard.WIZARD_COPY.BLURB_REQUIRED_AT_OPEN === 'Write the weekly blurb before opening this week.', '18-13: Step 6 copy, verbatim');
  assert(wizard.blurbErrorCopy('empty') === wizard.WIZARD_COPY.BLURB_EMPTY && wizard.blurbErrorCopy('short') === wizard.WIZARD_COPY.BLURB_SHORT
    && wizard.blurbErrorCopy(null) === '' && wizard.blurbErrorCopy('nonsense') === '',
    '18-14: blurbErrorCopy maps each failure to its copy and everything else to nothing');
  assert(wizard.WIZARD_STEPS[4].id === 'blurb' && wizard.WIZARD_STEPS[4].title === 'Weekly Blurb' && !/optional/i.test(wizard.WIZARD_STEPS[4].title),
    '18-15: Step 5 is retitled "Weekly Blurb" — "(optional)" is gone');

  // ── who is gated ─────────────────────────────────────────────────────────
  assert(wizard.blurbRequiredForOpen({ status: 'draft' }) === true, '18-16: a draft is gated');
  assert(wizard.blurbRequiredForOpen({}) === true, '18-17: a row with NO status counts as a draft — errs toward asking, never toward skipping');
  for (const status of ['open', 'locked', 'live', 'final']) {
    assert(wizard.blurbRequiredForOpen({ status, blurb: '' }) === false, `18-18 (${status}): an existing ${status} week is never re-checked (grandfathered)`);
  }
  assert(wizard.blurbRequiredForOpen({ status: 'draft', dataSourceMode: 'demo' }) === false, '18-19: a demo week is exempt');
  assert(wizard.blurbRequiredForOpen({ status: 'draft', dataSourceMode: 'manual' }) === true
    && wizard.blurbRequiredForOpen({ status: 'draft', dataSourceMode: 'espn_live' }) === true, '18-20: manual and ESPN-live drafts are gated — only demo is exempt');
  assert(wizard.blurbRequiredForOpen(null) === false && wizard.blurbRequiredForOpen(undefined) === false, '18-21: no week ⇒ nothing to gate, never a throw');
  for (const sport of ['cfb', 'nfl', 'nhl', 'wjc', undefined]) {
    assert(wizard.blurbRequiredForOpen({ status: 'draft', sport }) === true && wizard.blurbGate({ status: 'draft', sport, blurb: '' }).ok === false,
      `18-22 (sport=${sport}): the predicate reads no sport — every week of every sport is gated the same`);
  }
  const gBlank = wizard.blurbGate({ status: 'draft', blurb: '' });
  const gShort = wizard.blurbGate({ status: 'draft', blurb: 'TBD' });
  const gGood = wizard.blurbGate({ status: 'draft', blurb: GOOD });
  const gDemoBlank = wizard.blurbGate({ status: 'draft', dataSourceMode: 'demo', blurb: '' });
  assert(gBlank.required && !gBlank.satisfied && !gBlank.ok && gBlank.check.reason === 'empty', '18-23: blank draft ⇒ required, not satisfied, BLOCKED');
  assert(gShort.required && !gShort.satisfied && !gShort.ok && gShort.check.reason === 'short', '18-24: a too-short blurb on a draft is blocked as short');
  assert(gGood.required && gGood.satisfied && gGood.ok, '18-25: a valid blurb ⇒ satisfied, not blocked');
  assert(!gDemoBlank.required && !gDemoBlank.satisfied && gDemoBlank.ok, '18-26: a blank DEMO draft is not blocked (exempt) — and honestly not "satisfied" either');

  // ── gatingChecklist() / dueForScheduledOpen() are UNTOUCHED ──────────────
  const gl = wizard.gatingChecklist({ gamesCount: 3, missingSpreadCount: 0, timingConfigured: true });
  assert(JSON.stringify(Object.keys(gl)) === JSON.stringify(['gamesOk', 'gamesLabel', 'spreadsOk', 'spreadsLabel', 'timingOk', 'timingLabel', 'canOpen']) && gl.canOpen === true,
    `18-27: gatingChecklist() itself is untouched — its three items and shape stay pinned; dueForScheduledOpen() asks for the blurb BESIDE it (got keys ${Object.keys(gl)})`);
  const okArgs = { gamesCount: 10, missingSpreadCount: 0, timingConfigured: true };
  const pastAt = new Date(Date.now() - 60000).toISOString();
  // COORDINATOR OVERRIDE (2026-09-30) — [18-28/29] used to pin the opposite (the tick
  // never checks the blurb, so an already-scheduled blank draft still opens). That let
  // a blank-blurb week open through Step 4's Auto-Open At, so the leg now HOLDS a due
  // week that has no valid blurb — and releases it on the first tick after one exists.
  const dueBlank = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: pastAt, blurb: '' }, now: Date.now(), ...okArgs });
  assert(dueBlank.due === false && dueBlank.blocked === true && dueBlank.gate.canOpen === true && dueBlank.blurb.ok === false && dueBlank.blurb.check.reason === 'empty',
    `18-28: a BLANK scheduled draft whose time has arrived is NOT due — it is BLOCKED, with the checklist itself clear so the reason is the blurb alone (got ${JSON.stringify(dueBlank)})`);
  const dueNoBlurbField = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: pastAt }, now: Date.now(), ...okArgs });
  assert(dueNoBlurbField.due === false && dueNoBlurbField.blocked === true,
    '18-29: …and a legacy week with no blurb field at all is held the same way (grandfathered weeks are not exempt from the tick)');
  const dueShort = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: pastAt, blurb: 'abcdefghi' }, now: Date.now(), ...okArgs });
  assert(dueShort.due === false && dueShort.blocked === true && dueShort.blurb.check.reason === 'short',
    '18-29b: nine characters is held too — the tick uses the same blurbCheck as every other surface');
  const dueWritten = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: pastAt, blurb: 'abcdefghij' }, now: Date.now(), ...okArgs });
  assert(dueWritten.due === true && dueWritten.blocked === false && dueWritten.blurb.ok === true,
    '18-29c: the SAME week is due the moment a valid blurb exists — i.e. it opens on the very next tick once written');
  const dueDemo = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: pastAt, blurb: '', dataSourceMode: 'demo' }, now: Date.now(), ...okArgs });
  assert(dueDemo.due === true && dueDemo.blocked === false, '18-29d: a blank DEMO week stays exempt — it is due');
  const dueBoth = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: pastAt, blurb: '' }, now: Date.now(), gamesCount: 0, missingSpreadCount: 0, timingConfigured: true });
  assert(dueBoth.due === false && dueBoth.blocked === true && dueBoth.gate.canOpen === false && dueBoth.blurb.ok === false,
    '18-29e: checklist AND blurb unmet ⇒ blocked, and BOTH facts are returned so the alert can name each');
  const notYet = wizard.dueForScheduledOpen({ week: { status: 'draft', picksOpenAt: new Date(Date.now() + 60000).toISOString(), blurb: '' }, now: Date.now(), ...okArgs });
  assert(notYet.due === false && notYet.blocked === false && notYet.blurb === null,
    '18-29f: before the scheduled time nothing is blocked and nothing is checked — the reminder only fires AT open time');
  assert(wizard.blurbErrorCopy('required_at_open') === wizard.WIZARD_COPY.BLURB_REQUIRED_AT_OPEN,
    '18-29g: Step 4\'s Auto-Open refusal reuses Step 6\'s exact copy');

  // ── the two open paths ───────────────────────────────────────────────────
  const gateOk = { gamesCount: 10, missingSpreadCount: 0, timingConfigured: true };
  const future = new Date(Date.now() + 86400000).toISOString();
  function mkDeps() {
    const calls = { status: 0, save: 0, toast: 0, haptic: 0 };
    return {
      calls,
      deps: {
        applyWeekStatusChange: (w, to) => { calls.status++; return { ...w, status: to }; },
        saveWeek: () => { calls.save++; },
        showToast: () => { calls.toast++; },
        nativeHapticImpact: () => { calls.haptic++; },
        isNativeShell: () => true,
      },
    };
  }
  const draftBlank = { weekId: 'w18', weekNumber: 5, status: 'draft', blurb: '' };

  // Open now — through finishWeekSetupFromWizard AND the direct openForPicks
  {
    const { calls, deps } = mkDeps();
    const viaFinish = wizard.finishWeekSetupFromWizard({ week: draftBlank, mode: wizard.OPEN_MODES.NOW, ...gateOk, deps });
    assert(viaFinish.ok === false && viaFinish.reason === 'blurb_required' && viaFinish.mode === 'now' && viaFinish.blurb.reason === 'empty',
      `18-30: Open now on a blank draft is REFUSED with blurb_required (got ${JSON.stringify(viaFinish)})`);
    assert(calls.status === 0 && calls.toast === 0 && calls.haptic === 0, '18-31: …the status is NEVER changed, no success toast, no haptic — the week stays a draft');
    const viaDirect = wizard.openForPicksFromWizard({ week: draftBlank, ...gateOk, deps });
    assert(viaDirect.ok === false && viaDirect.reason === 'blurb_required' && calls.status === 0,
      '18-32: the direct openForPicks() path refuses too — no second door around the gate');
    const shortRes = wizard.finishWeekSetupFromWizard({ week: { ...draftBlank, blurb: 'abcdefghi' }, mode: wizard.OPEN_MODES.NOW, ...gateOk, deps });
    assert(shortRes.ok === false && shortRes.reason === 'blurb_required' && shortRes.blurb.reason === 'short' && calls.status === 0,
      '18-33: NINE characters is refused on Open now (the boundary, through the real open path)');
    const spaces = wizard.finishWeekSetupFromWizard({ week: { ...draftBlank, blurb: '            ' }, mode: wizard.OPEN_MODES.NOW, ...gateOk, deps });
    assert(spaces.ok === false && spaces.reason === 'blurb_required' && calls.status === 0, '18-34: a spaces-only blurb is refused — whitespace is not a note');
    const valid = wizard.finishWeekSetupFromWizard({ week: { ...draftBlank, blurb: 'abcdefghij' }, mode: wizard.OPEN_MODES.NOW, ...gateOk, deps });
    assert(valid.ok === true && valid.week.status === 'open' && calls.status === 1 && calls.toast === 1 && calls.haptic === 1,
      `18-35: TEN characters opens — exactly one status change, one toast, one native haptic (got ${JSON.stringify(valid)})`);
  }
  // Schedule Open
  {
    const { calls, deps } = mkDeps();
    const res = wizard.finishWeekSetupFromWizard({ week: draftBlank, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, ...gateOk, deps });
    assert(res.ok === false && res.reason === 'blurb_required' && res.mode === 'scheduled',
      `18-36: Schedule Open on a blank draft is REFUSED with blurb_required (got ${JSON.stringify(res)})`);
    assert(calls.save === 0 && calls.status === 0 && calls.toast === 0, '18-37: …nothing is written — picksOpenAt is never saved, no status change, no toast');
    const short = wizard.finishWeekSetupFromWizard({ week: { ...draftBlank, blurb: 'abcdefghi' }, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, ...gateOk, deps });
    assert(short.ok === false && short.reason === 'blurb_required' && calls.save === 0, '18-38: nine characters is refused on Schedule Open too');
    const good = wizard.finishWeekSetupFromWizard({ week: { ...draftBlank, blurb: GOOD }, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, ...gateOk, deps });
    assert(good.ok === true && good.week.status === 'draft' && !!good.week.picksOpenAt && calls.save === 1 && calls.status === 0,
      '18-39: a valid blurb schedules (one save, status stays draft — the tick flips it later)');
  }
  // Keep as draft — exempt, touches nothing
  {
    const { calls, deps } = mkDeps();
    const res = wizard.finishWeekSetupFromWizard({ week: draftBlank, mode: wizard.OPEN_MODES.DRAFT, gamesCount: 0, missingSpreadCount: 0, timingConfigured: false, deps });
    assert(res.ok === true && res.week === draftBlank && calls.status + calls.save + calls.toast + calls.haptic === 0,
      '18-40: Keep as draft with a BLANK blurb succeeds and calls nothing in deps — a draft is invisible to players, so it is exempt');
  }
  // Demo weeks and existing weeks — exempt
  {
    const { calls, deps } = mkDeps();
    const demo = wizard.finishWeekSetupFromWizard({ week: { ...draftBlank, dataSourceMode: 'demo' }, mode: wizard.OPEN_MODES.NOW, ...gateOk, deps });
    assert(demo.ok === true && demo.week.status === 'open' && calls.status === 1, '18-41: a blank DEMO week opens (exempt)');
    const demoSched = wizard.finishWeekSetupFromWizard({ week: { ...draftBlank, dataSourceMode: 'demo' }, mode: wizard.OPEN_MODES.SCHEDULED, scheduledAt: future, ...gateOk, deps });
    assert(demoSched.ok === true && calls.save === 1, '18-42: …and schedules');
    const existing = wizard.openForPicksFromWizard({ week: { ...draftBlank, status: 'locked' }, ...gateOk, deps });
    assert(existing.ok === true, '18-43: an existing (non-draft) week is never re-checked, blank blurb or not');
  }
  // Order — the three-item checklist speaks first; the blurb is the fourth requirement
  {
    const { calls, deps } = mkDeps();
    const both = wizard.finishWeekSetupFromWizard({ week: draftBlank, mode: wizard.OPEN_MODES.NOW, gamesCount: 0, missingSpreadCount: 0, timingConfigured: true, deps });
    assert(both.ok === false && both.gate?.canOpen === false && both.reason === undefined && calls.status === 0,
      '18-44: with the checklist AND the blurb both unmet, the checklist refusal comes back (so the handler names the games/spreads gap first)');
  }
  // Factory
  {
    const { calls, deps } = mkDeps();
    const w = wizard.createWeekWizard(deps);
    assert(w.blurbCheck('abcdefghi').reason === 'short' && w.blurbCheck('abcdefghij').ok === true && w.blurbGate(draftBlank).ok === false,
      '18-45: the factory exposes blurbCheck/blurbGate, identical to the standalone exports');
    const res = w.finishWeekSetup({ week: draftBlank, mode: 'now', ...gateOk });
    assert(res.ok === false && res.reason === 'blurb_required' && calls.status === 0, '18-46: the deps-bound finishWeekSetup refuses a blank draft the same way');
  }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
