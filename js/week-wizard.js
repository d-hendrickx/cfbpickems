/**
 * js/week-wizard.js — DI-341 (UX Revamp group C, WEEK-SETUP-WIZARD, UN-295).
 * ============================================================================
 * The stepped-sheet's DECISION logic: which screen/step a commissioner sees
 * for a given week (§2.5's table), the step-6 gating checklist that must
 * never enable "Open for Picks" with a check unmet (§2.3), and the narrowed
 * "Manage" status-control set (§2.6, closing the ledger §6 row 0011 named).
 *
 * WHY THIS IS PURE LOGIC, NOT DOM/TEMPLATE CODE. §2.3/§2.4's own text is
 * explicit that the wizard REUSES existing markup rather than reimplementing
 * it: step 1 "renders this modal's existing form markup inside the sheet
 * body instead of a separate .modal-overlay.centered", step 3 reuses
 * `showGameModal()`, and the sheet shell reuses `.chat-sheet` CSS. Doing that
 * for real means editing `js/app.js`'s `showCreateWeekModal()` /
 * `showGameModal()` call sites and `index.html`/`css/styles.css` for the
 * `#week-wizard-sheet` shell — all three are OUT OF SCOPE for this pass
 * (claimed by groups A/B on `app.js`/`styles.css` this same session; see the
 * DI's §7 serialization note). So this module owns exactly what CAN be
 * built and tested without touching those three files: the step-selection
 * state machine, the gating rule, the narrowed status-button set, and the
 * orchestration wrappers that sequence EXISTING app.js functions for step
 * 2's "combine two buttons into one" (§2.3). The DOM shell and the actual
 * wiring of these functions into `renderCommPage()` is the coordinator's
 * next pass — see the wiring checklist in this batch's handoff.
 *
 * DEPENDENCY INJECTION, NOT AN app.js IMPORT (task instruction, explicit):
 * every orchestration function below takes its collaborators BY NAME in a
 * `deps` object, so this module never imports `js/app.js` and is fully
 * testable under plain Node. The coordinator's eventual wiring is ONE call:
 * `createWeekWizard({ createWeek, saveWeek, setActiveWeekId,
 * applyWeekStatusChange, showGameModal, buildSuggestedSlate,
 * scoreCandidateGames, fetchByDateRange, saveAvailableGames,
 * clearAvailableGames, getAvailableGames, getGames, saveGame, createGame,
 * claimedAlmaMaters, saveFetchProof, isSuggestionRejected, showToast,
 * nativeHapticImpact, isNativeShell })`.
 *
 * `saveFetchProof` and `isSuggestionRejected` are OPTIONAL-BY-GUARD in the
 * body (`if (... && saveFetchProof)` / `isSuggestionRejected ? ... : ...`,
 * see step 2's own note below) — which means omitting them is silent, not
 * an error: the quality report is dropped and previously-rejected
 * suggestions come back. They are listed here deliberately so the eventual
 * wiring knows to PASS them (reviewer note, fix round 2, 2026-09-25). The
 * guards stay, so the module remains testable without them.
 */

// ── Step metadata (§2.3's ASCII diagram) ────────────────────────────────────
export const WIZARD_STEPS = Object.freeze([
  { step: 1, id: 'create', title: 'Create' },
  { step: 2, id: 'populate', title: 'Populate games' },
  { step: 3, id: 'confirm', title: 'Confirm slate + spreads' },
  { step: 4, id: 'timing', title: 'Timing & auto-transitions' },
  { step: 5, id: 'announce', title: 'Announce (optional)' },
  { step: 6, id: 'open', title: 'Open for picks' },
]);
export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

// ── Copy strings, quoted verbatim from the DI so the eventual DOM wiring
//    does not re-derive or re-word them (§2.3's exact text). ────────────────
export const WIZARD_COPY = Object.freeze({
  FETCH_LOADING: "Fetching this week's games from ESPN…",
  FETCH_SUCCESS: (n) => `${n} games added to your slate.`,
  FETCH_PARTIAL: (n) => `Only ${n} games available — add the rest manually after this wizard, or adjust the week's dates.`,
  FETCH_FAILED: "Couldn't reach ESPN — check your connection and try again.",
  FETCH_ZERO: "No games found for these dates. Check the week's start/end dates in Step 1, or add games manually from the Games tab after this wizard.",
  MISSING_SPREADS: (n) => `${n} game${n === 1 ? '' : 's'} still need${n === 1 ? 's' : ''} a spread before you can open for picks.`,
  ANNOUNCE_SKIP_CONFIRM: 'You can send an announcement anytime from the Week tab — skip for now?',
  OPEN_SUCCESS: (weekNumber) => `Week ${weekNumber} is open — picks unlock now.`,
  EVERYONE_PICKED: "Everyone's picked — nothing to nudge.",
});

/**
 * §2.3 step 6's summary checklist. Never enables "Open for Picks" with any
 * of the three checks unmet — the DI's own explicit anti-failure clause
 * ("What would make it fail: if feature-builder implements the sheet as...")
 * doesn't name this directly, but §2.3's table is unambiguous: `(disabled
 * until ✓ x3)`.
 *
 *   gamesCount        the slate's current game count.
 *   missingSpreadCount games on the slate with no spread set (favorite+margin
 *                      never entered) — AD-03's Favorite+Margin pattern,
 *                      unchanged; this only COUNTS, never derives a sign.
 *   timingConfigured   true when an effective lock time can be derived
 *                      (`effectiveLockAtMs()`/`computeEffectiveLockAt()` —
 *                      the SAME function scoring.js and reminder-rules.js
 *                      already use, non-null).
 */
export function gatingChecklist({ gamesCount = 0, missingSpreadCount = 0, timingConfigured = false } = {}) {
  const gamesOk = gamesCount > 0;
  const spreadsOk = gamesOk && missingSpreadCount === 0;
  const timingOk = !!timingConfigured;
  return {
    gamesOk,
    gamesLabel: gamesOk ? `${gamesCount} games on slate` : 'No games on slate yet',
    spreadsOk,
    spreadsLabel: spreadsOk ? 'All spreads set' : WIZARD_COPY.MISSING_SPREADS(missingSpreadCount || gamesCount),
    timingOk,
    timingLabel: timingOk ? 'Timing configured' : 'Timing not yet configured',
    // The SINGLE gate §2.3's diagram names: `(disabled until ✓ x3)`.
    canOpen: gamesOk && spreadsOk && timingOk,
  };
}

/** Count of games on the slate with no spread recorded — a game "has a
 *  spread" once `spread` is a finite number (0 = PK is a real, set spread,
 *  not a missing one — CONVENTIONS #18's PK case). */
export function countMissingSpreads(games) {
  return (games || []).filter((g) => g && !(typeof g.spread === 'number' && Number.isFinite(g.spread))).length;
}

/**
 * §2.5's state-selection table. Returns either
 *   { mode: 'steps', step: 1..6 }   — the create-flow sheet, opened at STEP
 *   { mode: 'manage' }              — the post-draft "Manage this week" screen
 *   { mode: 'none' }                — no week at all AND no week context was
 *                                      passed (defensive default; the DI's
 *                                      own table has no row for this because
 *                                      the entry BUTTON itself decides
 *                                      "Set Up Week" vs nothing — see §2.5's
 *                                      "No week exists yet" row, which IS
 *                                      `{mode:'steps', step:1}`, distinct
 *                                      from this)
 *
 * `week` is the data-model week object (or null/undefined — "No week exists
 * yet"). `games` is that week's slate. `timingConfigured` is the same
 * boolean `gatingChecklist` takes — passed in rather than re-derived here so
 * this function stays free of any scoring.js/reminder-rules.js dependency
 * (CONVENTIONS #9's spirit: a decision function should not need to know HOW
 * a fact was computed, only what it is).
 */
export function selectWizardEntry({ week, games, timingConfigured = true } = {}) {
  if (!week) return { mode: 'steps', step: 1 };
  if (week.status !== 'draft') return { mode: 'manage' };
  const list = games || [];
  if (!list.length) return { mode: 'steps', step: 1 };
  const missing = countMissingSpreads(list);
  if (missing > 0) return { mode: 'steps', step: 3 };
  // Games + spreads both done. §2.5's table sends this straight to step 6
  // regardless of `timingConfigured` — defaults (`getAutoLockOffsetMinutes`
  // etc.) mean timing is resolvable the moment games exist in the ordinary
  // case; an exotic no-kickoff slate still lands here and step 6's own
  // checklist (not this selector) is what names the remaining gap.
  return { mode: 'steps', step: 6 };
}

// ══════════════════════════════════════════════════════════════════════════
// §2.6 — STATUS-CONTROL NARROWING (traces to coverage-matrix item C7).
// ══════════════════════════════════════════════════════════════════════════
//
// The full table below is app.js's existing `renderWeekStatusButtons()`
// (`app.js:13824`), copied here VERBATIM (same labels, same classes, same
// `to` targets) and then filtered. Not re-derived from the server allow-list
// directly, on purpose: if a future edit changes a label or a class in
// `renderWeekStatusButtons()` without mirroring it here, a reviewer diffing
// the two literal tables catches the drift immediately, which a
// re-derivation from a different source of truth would not.
// STEP B(14) (3c fix window, third pass) — each entry also carries `icon` (a
// js/icons.js glyph name) and `text`; the WIZARD renders icon + text (D-1:
// chrome icons come from the one Munera SVG family, not emoji).
// 2026-09-26 (full-app review, Step 6) — the emoji `label` field is GONE: no
// renderer read it once app.js's own table moved to {to, icon, text, cls},
// and weekwizardtest [4-7] now compares {to, cls, icon, text} against that
// table directly (parsed out of app.js), so drift is caught mechanically.
const FULL_STATUS_BUTTONS = Object.freeze({
  draft: [{ to: 'open', cls: 'btn-primary', icon: 'megaphone', text: 'Open for Picks' }],
  open: [
    { to: 'locked', cls: 'btn-secondary', icon: 'lock', text: 'Lock Week' },
    { to: 'draft', cls: 'btn-ghost', icon: 'undo', text: 'Back to Draft' },
  ],
  locked: [
    { to: 'live', cls: 'btn-secondary', icon: 'play', text: 'Go Live' },
    { to: 'open', cls: 'btn-ghost', icon: 'unlock', text: 'Re-open Picks' },
    { to: 'draft', cls: 'btn-ghost', icon: 'undo', text: 'Back to Draft' },
  ],
  live: [
    { to: 'final', cls: 'btn-primary', icon: 'check', text: 'Finalize' },
    { to: 'locked', cls: 'btn-secondary', icon: 'pause', text: 'Pause (Re-lock)' },
    { to: 'open', cls: 'btn-ghost', icon: 'unlock', text: 'Re-open Picks' },
  ],
  final: [
    { to: 'live', cls: 'btn-ghost', icon: 'undo', text: 'Reopen to Live' },
    { to: 'open', cls: 'btn-ghost', icon: 'undo', text: 'Reopen to Open' },
  ],
});

/**
 * §2.6 — the THREE reversals the server's `transition_week()` allow-list
 * already refuses (`0003_functions.sql:282-306`), dropped: `locked→draft`,
 * `live→open`, `final→open`. Everything else in `FULL_STATUS_BUTTONS`
 * survives unchanged — this is a strict subtraction, never a re-labeling.
 */
//
// SEC-4 (2026-09-26) — and `live→locked` ("Pause (Re-lock)"), which the server can never make
// either: `transition_week()` raises use_lock_week for ANY p_to='locked' before it consults its
// allow-list (0003_functions.sql:289, 0027:130 — the ('live','locked') entry there is
// unreachable), and `lock_week()` requires the week to be OPEN. Offered, it was always refused and
// left the mirror at LOCKED over a server at LIVE. The Commissioner panel's LOCAL-mode table keeps it.
const NARROWED_REVERSALS = Object.freeze(new Set(['locked:draft', 'live:open', 'final:open', 'live:locked']));

export function narrowedWeekStatusButtons(status) {
  const all = FULL_STATUS_BUTTONS[status] || [];
  return all.filter((b) => !NARROWED_REVERSALS.has(`${status}:${b.to}`));
}

// ══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION — §2.3/§2.4's "combine two buttons into one" and the other
// step actions, sequencing EXISTING functions via injected `deps`. No new
// business logic (§2.4's own reuse call): every one of these is a thin
// sequence of calls this codebase already has, in the same order today's
// two-click (or more) flow already makes them.
// ══════════════════════════════════════════════════════════════════════════

/**
 * §2.3 Step 1 — thin wrapper around `createWeek`/`saveWeek`/
 * `setActiveWeekId`, mirroring `showCreateWeekModal()`'s own save handler
 * (`app.js:13867-13877`) exactly, so the wizard's step-1 "Create Week"
 * button does precisely what today's modal does. `fields` is the same shape
 * that modal's five inputs produce.
 */
/**
 * REVIEWER BLOCK item 2 (916bdb7 review, 2026-09-25) — `existingWeek` is
 * NEW. Before this fix, every call here unconditionally minted a fresh week
 * via `createWeek()` (a new `w_${Date.now()}` id), even when the caller was
 * re-entering Step 1 on a DRAFT week this same wizard session already
 * created (Set Up Week -> Create Week -> Back -> Save & Continue). That
 * left two weeks with the same number in storage — the first orphaned,
 * unreachable from the wizard, invisible until someone went looking for
 * duplicates in the commissioner panel. When `existingWeek` is passed, this
 * SAVES onto that same week (same `weekId`, same `status` — Step 1 is only
 * ever reached on a `draft` week, per this module's own step-selection
 * table) rather than minting a second one.
 */
export function createWeekFromWizard({ fields, deps, existingWeek = null }) {
  const { createWeek, saveWeek, setActiveWeekId } = deps;
  const { season, weekNumber, roundLabel = '', startDate = '', endDate = '', dataSourceMode = 'manual' } = fields;
  const week = existingWeek
    ? { ...existingWeek, season, weekNumber, roundLabel, startDate, endDate, dataSourceMode }
    : { ...createWeek(season, weekNumber, startDate, endDate), dataSourceMode, roundLabel };
  saveWeek(week);
  setActiveWeekId(week.weekId);
  return week;
}

/**
 * §2.3 Step 2 — the one-button combo. Runs the SAME sequence today's two
 * separate buttons run (`#fetch-espn-btn` then `#apply-suggested-btn`,
 * `app.js:11859-11903`): fetch ESPN games into the available pool, then
 * score + build the suggested 10 and add every one not already on the slate.
 * `deps.fetchByDateRange` returns `{games, error, qualityReport}` exactly as
 * today's `fetchByDateRange()` does.
 *
 * reviewer BLOCK, fix round 1 (2026-09-25) — TWO STEPS THIS FUNCTION WAS
 * MISSING, both present in `renderCommPage()`'s own candidate-pool build
 * (`app.js:10390-10393`) and in the fetch handler (`app.js:12007`):
 *   1. `saveFetchProof(result.qualityReport)` when a quality report comes
 *      back — the ESPN Data Fetch card's own diagnostic, dropped silently
 *      by the earlier version of this function.
 *   2. The candidate pool is filtered through `isSuggestionRejected()`
 *      BEFORE scoring — "a dismissed game shouldn't be reconsidered for ANY
 *      tier" (app.js's own comment on this exact filter) — so a
 *      commissioner who dismissed a suggestion earlier in the session does
 *      not see it forced back onto the wizard's one-tap slate. The pool
 *      scored is `getAvailableGames(week.weekId)` READ BACK after saving
 *      (not `result.games` directly), matching `renderCommPage()`'s own
 *      read-after-write shape exactly, so any suggestion rejected before
 *      this call (not just during it) is honoured too.
 */
export async function fetchAndApplySuggestedSlate({ week, deps }) {
  const {
    fetchByDateRange, saveAvailableGames, clearAvailableGames, getAvailableGames,
    isSuggestionRejected, saveFetchProof, scoreCandidateGames,
    buildSuggestedSlate, getGames, saveGame, createGame, claimedAlmaMaters,
  } = deps;
  if (!week || !week.startDate) {
    return { ok: false, reason: 'no_start_date', added: 0 };
  }
  const endDate = week.endDate || week.startDate;
  const result = await fetchByDateRange({
    startDate: week.startDate, endDate, season: week.season,
    almaMaters: claimedAlmaMaters ? claimedAlmaMaters() : [],
  });
  if (result.qualityReport && saveFetchProof) saveFetchProof(result.qualityReport);
  if (result.error || !result.games || !result.games.length) {
    return { ok: false, reason: result.error || 'no_games', added: 0 };
  }
  clearAvailableGames(week.weekId);
  saveAvailableGames(week.weekId, result.games);
  const pool = getAvailableGames ? getAvailableGames(week.weekId) : result.games;
  const candidatePool = isSuggestionRejected ? pool.filter((g) => !isSuggestionRejected(week.weekId, g)) : pool;
  const scored = candidatePool.length ? scoreCandidateGames(candidatePool, week.weekId) : [];
  const built = buildSuggestedSlate(scored, 10);
  let added = 0;
  for (const game of built.slate) {
    const already = getGames(week.weekId).some((g) => g.homeTeam === game.homeTeam && g.awayTeam === game.awayTeam);
    if (!already) { saveGame(createGame(week.weekId, { ...game, weekId: week.weekId })); added += 1; }
  }
  return {
    ok: true, added, fetched: result.games.length, suggested: built.slate.length,
    partial: result.games.length < 10,
  };
}

/**
 * §2.3 Step 6 — the gated "Open for Picks" action. Refuses to call
 * `applyWeekStatusChange` at all unless `gatingChecklist(...).canOpen` is
 * true (the client-side courtesy; the server's own `transition_week()`
 * allow-list is still the real boundary, unchanged by this DI). Fires the
 * existing LIGHT haptic (`nativeHapticImpact`, native only, behind
 * `isNativeShell()`) on success, matching §2.3's own line.
 */
export function openForPicksFromWizard({ week, gamesCount, missingSpreadCount, timingConfigured, deps }) {
  const gate = gatingChecklist({ gamesCount, missingSpreadCount, timingConfigured });
  if (!gate.canOpen) return { ok: false, gate };
  const { applyWeekStatusChange, showToast, nativeHapticImpact, isNativeShell } = deps;
  const updated = applyWeekStatusChange(week, 'open');
  if (showToast) showToast(WIZARD_COPY.OPEN_SUCCESS(week.weekNumber), 'success');
  if (isNativeShell && isNativeShell() && nativeHapticImpact) nativeHapticImpact('LIGHT');
  return { ok: true, week: updated, gate };
}

/**
 * Factory — the "one call" wiring the DI's own §6 asks for. Returns the
 * pure decision functions above, bound to nothing (they take their own
 * arguments), plus the two async orchestration wrappers pre-bound to
 * `deps` so a caller in `app.js` does not have to thread `deps` through
 * every call site by hand. The actual DOM (sheet shell, step tracker,
 * event binding) is NOT built here — see this module's own header.
 */
export function createWeekWizard(deps = {}) {
  return {
    selectEntry: (args) => selectWizardEntry(args),
    gatingChecklist: (args) => gatingChecklist(args),
    narrowedStatusButtons: (status) => narrowedWeekStatusButtons(status),
    // REVIEWER BLOCK item 2 — `existingWeek` is threaded through from the
    // caller (app.js's bindWeekWizardStep1(), which HAS the current draft
    // week in scope) so re-entering Step 1 saves onto it instead of
    // minting a second week.
    createWeek: (fields, existingWeek) => createWeekFromWizard({ fields, deps, existingWeek }),
    fetchAndApplySuggestedSlate: (week) => fetchAndApplySuggestedSlate({ week, deps }),
    openForPicks: (args) => openForPicksFromWizard({ ...args, deps }),
  };
}
