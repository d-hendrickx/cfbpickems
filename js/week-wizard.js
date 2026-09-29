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
 *
 * ── v0.27.0 additions (UX Revamp post-deploy pass, DI-353/354/357/358/359,
 * 2026-09-27) ──────────────────────────────────────────────────────────────
 * Same rule as the block above: this file stays DOM-free and import-free
 * (no `js/app.js` import, ever), so every new dep the app.js wiring pass
 * needs is named again below, at each function that needs it, and collected
 * in this batch's handoff report. Five DIs, one file:
 *   DI-353 — the Data Source field is being removed from the commissioner-
 *     facing form entirely (app.js's job); this module's own share of that
 *     is `createWeekFromWizard()`'s default `dataSourceMode`, changed below
 *     from `'manual'` to `'espn_live'` so a week created with the field gone
 *     from `fields` still gets a sane, non-blank value.
 *   DI-354 — `stepBackTarget()` and `shouldConfirmAnnouncementDiscard()`,
 *     shared by every Back button in BOTH step machines this file now
 *     describes (the create-flow's 6 steps and the new Finalize flow's 4).
 *   DI-357 — `tiebreakerWizardStepSummary()` / `applyTiebreakerQuestion()`,
 *     Step 6's tiebreaker-question display+save. Per the coordinator's
 *     Part-5 ruling 4 (2026-09-27): a blank question is a real, if rare,
 *     commissioner choice and never blocks Open — `gatingChecklist()` itself
 *     is UNTOUCHED by this addition, on purpose.
 *   DI-358 — `OPEN_MODES`, `finishWeekSetupFromWizard()` (Now/Scheduled/
 *     Draft at Step 6) and `dueForScheduledOpen()` (the pure predicate the
 *     app.js-owned `tickAutoTransition()` needs for the draft→open leg the
 *     coordinator's Part-5 ruling 5 says belongs there — verified ABSENT
 *     from `tickAutoTransition()` as of this pass; see the handoff report,
 *     since `js/app.js` is out of this file's ownership and cannot be
 *     edited here).
 *   DI-359 — `FINALIZE_STEPS`/`FINALIZE_STEP_COUNT` and one orchestration
 *     function per guided-flow step (`finalizeApproveScores`,
 *     `finalizeAutoCalcTiebreaker`/`confirmFinalizeTiebreaker`,
 *     `finalizeExtraPointSummary`/`confirmFinalizeExtraPoint`,
 *     `unresolvedTieWarning`/`confirmFinalizeWeek`) — every one a thin
 *     sequence of calls this codebase already has (AD-33 unchanged: neither
 *     the tiebreaker nor the Extra Point ever becomes a standings input).
 *
 * ── reviewer-fix pass (commit ddf9e4f review round, same day) ──────────────
 * Seven items, all in this file, all covered by red-first tests + a
 * mutation-proof round-trip (see the handoff report for counts):
 *   1. REQUIRED — `finalizeApproveScores()` (Step 1) no longer calls
 *      `finalizeWeek()` at all. That function publishes permanent chat
 *      posts and raises the weekly obligation off `actualTiebreakerValue`,
 *      which is still null this early in the flow. ATS grading only; the
 *      one and only `finalizeWeek()` call is at Step 4.
 *   2. `createWeekFromWizard()`'s `dataSourceMode` precedence is now
 *      `fields.dataSourceMode ?? existingWeek?.dataSourceMode ?? 'espn_live'`
 *      — an existing week's own mode is never silently overwritten by the
 *      default once the field leaves the form.
 *   3. `confirmFinalizeTiebreaker`/`confirmFinalizeExtraPoint`/
 *      `confirmFinalizeWeek` all now re-read `deps.getWeek(week.weekId) ||
 *      week` before spreading (RG-256 class, matching every real app.js
 *      handler) — `getWeek` is a new REQUIRED factory dep.
 *   4. The tiebreaker calc-mode captions were factually wrong (see
 *      `TIEBREAKER_CALC_MODE_CAPTIONS`'s own comment) — corrected to what
 *      the mode actually distinguishes (a flagged subset of the slate vs.
 *      every alma-mater game on it), never "leaves the slate."
 *   5. `confirmFinalizeExtraPoint`/`confirmFinalizeTiebreaker` refuse a
 *      non-finite `actualValue` (NaN/Infinity/a string); `null` stays legal
 *      for the tiebreaker only (extraPointActual must always be finite,
 *      matching `ep-save-btn`'s own guard).
 *   6. `dueForScheduledOpen()` now returns `{ due, blocked, gate }` instead
 *      of a bare boolean, so the tick leg can name WHY a past-due week
 *      still hasn't opened.
 *   7. `finishWeekSetupFromWizard()`'s SCHEDULED mode requires
 *      `week.status === 'draft'` and rejects a past datetime
 *      (`WIZARD_COPY.SCHEDULE_PAST_DATETIME`).
 *
 * ── DI-424 (UN-379, coordinator addendum to the UX Revamp v0.27.2 batch,
 * 2026-09-28) ────────────────────────────────────────────────────────────
 * `WIZARD_STEPS[4]` (id `'announce'`, title "Announce (optional)") becomes
 * id `'blurb'`, title "Weekly Blurb (optional)" — the DOM/save wiring for
 * this is entirely in `js/app.js` (this file stays DOM-free, per this
 * file's own rule above), which reuses the standalone Week-tab blurb
 * card's exact `saveWeek()` call. `WIZARD_COPY.ANNOUNCE_SKIP_CONFIRM` is
 * retired (see its own former call site's comment); `shouldConfirmAnnouncementDiscard()`
 * is left in place — see its own updated header comment for why.
 */

// ── Step metadata (§2.3's ASCII diagram) ────────────────────────────────────
export const WIZARD_STEPS = Object.freeze([
  { step: 1, id: 'create', title: 'Create' },
  { step: 2, id: 'populate', title: 'Populate games' },
  { step: 3, id: 'confirm', title: 'Confirm slate + spreads' },
  { step: 4, id: 'timing', title: 'Timing & auto-transitions' },
  // DI-424 (UN-379, coordinator addendum, 2026-09-28) — Step 5 was "Announce
  // (optional)" (a one-time push via postCommissionerAnnouncement()); it is
  // now "Weekly Blurb (optional)", bound to week.blurb (the persistent
  // Picks-page banner) via the SAME saveWeek() call the standalone Week-tab
  // card already uses. The standalone "🎙 Commissioner Announcement" card
  // (Comm→Week) is UNCHANGED — a one-time announcement is still reachable
  // from there, just no longer duplicated inside the wizard.
  { step: 5, id: 'blurb', title: 'Weekly Blurb (optional)' },
  { step: 6, id: 'open', title: 'Open for picks' },
]);
export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

// ── Copy strings, quoted verbatim from the DI so the eventual DOM wiring
//    does not re-derive or re-word them (§2.3's exact text). ────────────────
export const WIZARD_COPY = Object.freeze({
  // DI-411 (UN-366, 2026-09-28) — "Fetch ESPN…" verbiage removed from every
  // wizard-facing string (wizard-scoped only; the Admin panel's diagnostic
  // "Fetch ESPN Data" card, DI-352, is untouched).
  FETCH_LOADING: "Fetching this week's games…",
  FETCH_SUCCESS: (n) => `${n} games added to your slate.`,
  FETCH_PARTIAL: (n) => `Only ${n} games available — add the rest manually after this wizard, or adjust the week's dates.`,
  FETCH_FAILED: "Couldn't fetch games — check your connection and try again.",
  FETCH_ZERO: "No games found for these dates. Check the week's start/end dates in Step 1, or add games manually from the Games tab after this wizard.",
  MISSING_SPREADS: (n) => `${n} game${n === 1 ? '' : 's'} still need${n === 1 ? 's' : ''} a spread before you can open for picks.`,
  // DI-424 — ANNOUNCE_SKIP_CONFIRM is RETIRED: Step 5 is no longer an
  // announcement draft with something to lose on Back/Skip, it is a plain
  // textarea bound to week.blurb — a blank field is not a confirm-guarded
  // action the way an unsent announcement draft was. (Was: 'You can send an
  // announcement anytime from the Week tab — skip for now?')
  OPEN_SUCCESS: (weekNumber) => `Week ${weekNumber} is open — picks unlock now.`,
  EVERYONE_PICKED: "Everyone's picked — nothing to nudge.",
  // DI-358 — the three-way open-mode control at Step 6.
  SCHEDULE_MISSING_DATETIME: 'Pick a date and time, or choose Open now.',
  SCHEDULE_PAST_DATETIME: 'That time has passed. Choose Open now or a later time.',
  SCHEDULE_SUCCESS: (weekNumber) => `Week ${weekNumber} will open automatically at the scheduled time.`,
  // DI-359 — the guided Finalize Week flow's inline tie warning, replacing
  // the manual status button's browser confirm() (`weekHasUnresolvedTie`'s
  // own text, reworded for this flow's step names rather than "Cancel/OK" —
  // flagged in the handoff report as reworded copy, not Drew's own words).
  // Carry-over fix (app-shell part 3A review, 2026-09-27) — the leading ⚠️
  // written-text emoji is REMOVED: D-1's chrome-icon rule (CLAUDE.md) means
  // every .warning-box in the wizard renders the box's own icon('warning')
  // glyph (js/icons.js, fill="none" stroke="currentColor"), not an emoji
  // baked into the copy string. The render site (renderFinalizeStep4HTML(),
  // js/app.js) prefixes icon('warning') now — see that function's own note.
  UNRESOLVED_TIE_WARNING: 'This week has a tie in correct picks and no tiebreaker entered — the winner/loser will be decided arbitrarily until you enter one. Enter it in Confirm Tiebreaker, then continue to Finalize.',
});

// DI-357 — the tiebreaker Auto-Calc's calculation-basis caption, keyed by
// `week.tiebreakerCalculationMode`. Corrected against `js/data-model.js`'s
// actual `TIEBREAKER_CALC_MODE` enum while building this (THREE values exist
// — `selectedSlateOnly`/`allAlmaMaterGames`/`manual` — not the "only one
// mode exists today" the DI text assumed).
//
// coordinator fix (review round on ddf9e4f) — the FIRST version of this
// caption was wrong about what the modes actually distinguish: it read
// `calculateAlmaMaterTotal()`'s (scoring.js) `games` PARAMETER as "the
// slate" and assumed the non-`selectedSlateOnly` modes look OUTSIDE it
// ("not just the slate"). They never do — `games` is always the caller's
// `getGames(week.weekId)`, this week's slate only, in every mode; that
// function never fetches or is handed any other week's games. What the
// binary branch (`calcMode==='selectedSlateOnly' ? g.isAlmaMaterGame&&isAlma
// : isAlma`) actually distinguishes is the `isAlmaMaterGame` FLAG — a
// commissioner-curated subset of the slate — vs. every slate game that
// merely involves a claimed alma mater, flag or not. Two real captions, not
// three, because `manual` and `allAlmaMaterGames` are functionally
// identical in that function today (no separate `manual` branch exists
// there either).
export const TIEBREAKER_CALC_MODE_CAPTIONS = Object.freeze({
  selectedSlateOnly: 'Based on: the alma mater games you flagged on this slate',
  allAlmaMaterGames: 'Based on: every game on this slate involving an alma mater',
  manual: 'Based on: every game on this slate involving an alma mater',
});
export function tiebreakerCalcModeCaption(mode) {
  return TIEBREAKER_CALC_MODE_CAPTIONS[mode] || TIEBREAKER_CALC_MODE_CAPTIONS.selectedSlateOnly;
}

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
 * DI-416 (UN-371, 2026-09-28) — Step 6's non-blocking notice trigger. True
 * when some OTHER week (not `weekId`) is already open/locked/live —
 * `getCurrentWeek()`'s own (js/storage.js) `weeks.find(w =>
 * ['open','locked','live'].includes(w.status))` resolves the FIRST such
 * match silently if more than one qualifies; this surfaces that ambiguity to
 * the commissioner instead, as a warning, never a block. A pure function of
 * the week list, so it is directly testable.
 */
export function anotherWeekAlreadyOpen(weeks, weekId) {
  return (weeks || []).find((w) => w && w.weekId !== weekId && ['open', 'locked', 'live'].includes(w.status)) || null;
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
  // DI-353 (2026-09-27) — the Data Source control is being removed from the
  // commissioner-facing form entirely (Admin → Week's `data-source-mode`
  // card is the one surviving control); a week created here with no
  // `dataSourceMode` in `fields` now defaults to `'espn_live'`, matching the
  // form's OWN prior default (`weekCreateFormFieldsHTML()`'s `mode =
  // defaults.dataSourceMode || 'espn_live'`), not the more conservative
  // `'manual'` this function used to fall back to when the field was still
  // present and could be left at its own blank/default option.
  //
  // coordinator fix (review round on ddf9e4f) — that default was wired as a
  // destructuring default on `fields.dataSourceMode`, which ALWAYS produces
  // a value (falling to 'espn_live' the instant `fields` omits the key) and
  // then unconditionally overwrote `existingWeek.dataSourceMode` with it —
  // so re-entering Step 1 on an existing DEMO or MANUAL week (now that the
  // field is gone from the form and never appears in `fields` at all) would
  // silently flip that week to espn_live on every re-save. The precedence is
  // now explicit and three-tiered: an EXPLICITLY passed `fields.dataSourceMode`
  // always wins (a caller that does pass it is still honored, unchanged);
  // otherwise an existing week KEEPS its own mode (nothing to fix, nothing
  // was asked to change); only a brand-new week with no `existingWeek` and
  // no `fields.dataSourceMode` falls all the way to the 'espn_live' default.
  const { season, weekNumber, roundLabel = '', startDate = '', endDate = '', dataSourceMode: fieldsDataSourceMode } = fields;
  const dataSourceMode = fieldsDataSourceMode ?? existingWeek?.dataSourceMode ?? 'espn_live';
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

// ══════════════════════════════════════════════════════════════════════════
// DI-354 — STEP NAVIGATION, shared by every "Back" button in BOTH step
// machines this file describes: the create-flow sheet (§2.3's 6 steps,
// `WIZARD_STEPS` above) and the Finalize sheet (DI-359's 4 steps,
// `FINALIZE_STEPS` below). One function, so a future step added to either
// flow inherits correct Back behavior instead of a third hand-copied
// `_stepVar = N - 1` literal.
// ══════════════════════════════════════════════════════════════════════════

/**
 * The step immediately before `step`, or `null` at step 1 (no Back button
 * renders there in either flow — confirmed for the create-flow by DI-354's
 * own audit: "Step 1 correctly has none, it's the first step"). Works for
 * ANY step-numbered flow (no step-count ceiling needed — Back only ever
 * looks backward), which is why this is not `WIZARD_`- or `FINALIZE_`-
 * prefixed: it is the one shared primitive, not a copy per flow.
 */
export function stepBackTarget(step) {
  return step > 1 ? step - 1 : null;
}

/**
 * ORPHANED FROM THE CREATE-FLOW'S STEP 5 by DI-424 (2026-09-28) — that step
 * is now "Weekly Blurb", which has nothing to confirm-discard (a blank
 * blurb is not a lost draft the way an unsent announcement was;
 * `WIZARD_COPY.ANNOUNCE_SKIP_CONFIRM` is retired, above). Left in place,
 * exported and tested exactly as before — it was never actually wired into
 * app.js's create-flow Step 5 handler in the first place (that handler
 * inlined its own equivalent check).
 *
 * SOFTENED, reviewer round 2 N3 (2026-09-28): the Manage screen's own
 * separate "Announce" section (`renderWeekWizardManageHTML()`/
 * `bindWeekWizardManage()`, unaffected by DI-424) does NOT call this
 * function today and has no discard-confirm of its own at all — its Send
 * handler just posts whatever text is present, unconditionally. This is an
 * orphaned pure utility, exported and covered by its own tests, not a
 * function with a live caller anywhere in the app right now.
 */
export function shouldConfirmAnnouncementDiscard(announceText) {
  return !!(announceText && announceText.trim().length > 0);
}

// ══════════════════════════════════════════════════════════════════════════
// DI-357 — Step 6 shows/confirms the tiebreaker question before "Open for
// Picks" is offered. Ruling 4 (coordinator, 2026-09-27): a blank question is
// a real, if rare, commissioner choice and is VISIBLE + EDITABLE, never a
// gate — `gatingChecklist()` above is intentionally untouched by this DI.
// ══════════════════════════════════════════════════════════════════════════

/**
 * What Step 6 shows for the tiebreaker: the question as it stands today
 * (blank is a valid, real state — not an error) and a caption naming what
 * the Auto-Calc will sum, so the commissioner sees rather than guesses.
 */
export function tiebreakerWizardStepSummary(week) {
  const question = (week && week.tiebreakerQuestion) || '';
  const calculationMode = (week && week.tiebreakerCalculationMode) || 'selectedSlateOnly';
  return {
    question,
    hasQuestion: question.trim().length > 0,
    calculationMode,
    calculationModeCaption: tiebreakerCalcModeCaption(calculationMode),
  };
}

/**
 * A pure updater, not a save — the wizard's Step 6 write path is the exact
 * same `saveWeek({...week, tiebreakerQuestion})` call the standalone
 * Commissioner → Week Tiebreaker card's own `tb-question` input already
 * uses (`app.js:14572`'s equivalent); this only builds the object to hand
 * that call, so the two surfaces can never independently decide what
 * "saving the question" means.
 */
export function applyTiebreakerQuestion(week, question) {
  return { ...week, tiebreakerQuestion: question };
}

// ══════════════════════════════════════════════════════════════════════════
// DI-358 — Step 6's explicit open-mode choice: Open now / Open at a
// scheduled time / Keep as draft. No new server concept — `picksOpenAt` and
// `gatingChecklist()` both already exist and are reused as-is; "Open now"
// reuses `openForPicksFromWizard()` above verbatim rather than duplicating
// its gate-then-status-change sequence.
// ══════════════════════════════════════════════════════════════════════════

export const OPEN_MODES = Object.freeze({ NOW: 'now', SCHEDULED: 'scheduled', DRAFT: 'draft' });

/**
 * The Step 6 "Finish setup" action, one function for all three modes so the
 * DOM only ever calls one thing regardless of which radio is selected.
 *   NOW       → delegates to `openForPicksFromWizard()`, unchanged.
 *   SCHEDULED → requires `week.status === 'draft'` (scheduling only makes
 *               sense before the week has ever opened — coordinator fix,
 *               review round on ddf9e4f); rejects a datetime that has
 *               already passed (`WIZARD_COPY.SCHEDULE_PAST_DATETIME` —
 *               "Choose Open now" is the correct action there, not a
 *               schedule that will never fire); still gated by the SAME
 *               three-item checklist (you should not be able to schedule an
 *               open with missing spreads any more than you can open
 *               immediately with them) — saves `picksOpenAt` on the
 *               still-draft week; the actual flip to `open` at that
 *               timestamp is `tickAutoTransition()`'s job in app.js
 *               (`dueForScheduledOpen()` below is that leg's pure predicate
 *               — this function never flips status itself).
 *   DRAFT     → no status change, no gate check (nothing is being opened);
 *               closing the sheet is the caller's (app.js's) job, same as
 *               today's unlabeled "don't click Open for Picks" exit.
 *
 * `now` defaults to `Date.now()` (real time) and exists as an explicit
 * parameter purely so the past-datetime check is deterministically testable
 * — same pattern `dueForScheduledOpen()` already uses.
 */
export function finishWeekSetupFromWizard({ week, mode, scheduledAt, now = Date.now(), gamesCount, missingSpreadCount, timingConfigured, deps }) {
  if (mode === OPEN_MODES.DRAFT) {
    return { ok: true, mode, week };
  }
  if (mode === OPEN_MODES.NOW) {
    const result = openForPicksFromWizard({ week, gamesCount, missingSpreadCount, timingConfigured, deps });
    return { ...result, mode };
  }
  if (mode === OPEN_MODES.SCHEDULED) {
    if (!week || week.status !== 'draft') return { ok: false, mode, reason: 'week_not_draft' };
    if (!scheduledAt) return { ok: false, mode, reason: 'missing_scheduled_at' };
    const at = new Date(scheduledAt);
    if (Number.isNaN(at.getTime())) return { ok: false, mode, reason: 'invalid_scheduled_at' };
    if (at.getTime() <= now) return { ok: false, mode, reason: 'past_scheduled_at' };
    const gate = gatingChecklist({ gamesCount, missingSpreadCount, timingConfigured });
    if (!gate.canOpen) return { ok: false, mode, gate };
    const { saveWeek, showToast } = deps;
    const updated = { ...week, picksOpenAt: at.toISOString() };
    saveWeek(updated);
    if (showToast) showToast(WIZARD_COPY.SCHEDULE_SUCCESS(week.weekNumber), 'success');
    return { ok: true, mode, week: updated, gate };
  }
  return { ok: false, mode, reason: 'unknown_mode' };
}

/**
 * The pure predicate `tickAutoTransition()` (js/app.js, out of this file's
 * ownership) needs for the DRAFT→OPEN leg the coordinator's Part-5 ruling 5
 * assigns to the commissioner-device tick (RG-251's one-leg-per-tick rule:
 * the server cron only ever handles locked→live). Verified ABSENT from
 * `tickAutoTransition()` as of this pass — it has branches for OPEN→LOCKED,
 * LOCKED→LIVE and LIVE→pendingFinalization only. See this batch's handoff
 * report for the exact call the app.js pass adds; this function is only the
 * DECISION half — it never calls `applyWeekStatusChange` itself, so a tick
 * that merely IMPORTS this stays free of any side effect until its caller
 * chooses to act on `true`.
 *
 * coordinator fix (review round on ddf9e4f) — a plain boolean silently
 * conflated two very different situations: "not due yet" (the scheduled
 * time hasn't arrived — nothing wrong, just wait) and "due, but can't open"
 * (the time arrived and the week is STILL missing games/spreads/timing — a
 * real problem nobody would otherwise be told about, since the tick would
 * just keep returning `false` forever with no distinguishing signal). Now
 * returns `{ due, blocked, gate }`:
 *   `due`     — true only when the time has passed AND the checklist clears;
 *               this is the ONLY case the tick should actually flip status.
 *   `blocked` — true when the time has passed but the checklist does NOT
 *               clear — the tick's cue to raise a commissioner notice
 *               instead of silently never opening. Named per `gate`'s own
 *               fields (`gate.gamesLabel`/`spreadsLabel`/`timingLabel`), not
 *               re-derived.
 *   `gate`    — the full `gatingChecklist()` result once the time has
 *               passed; `null` while still waiting (nothing to check yet).
 * `due` and `blocked` are mutually exclusive and both `false` before the
 * scheduled time arrives.
 */
export function dueForScheduledOpen({ week, now = Date.now(), gamesCount, missingSpreadCount, timingConfigured }) {
  if (!week || week.status !== 'draft' || !week.picksOpenAt) return { due: false, blocked: false, gate: null };
  const at = new Date(week.picksOpenAt).getTime();
  if (!Number.isFinite(at) || now < at) return { due: false, blocked: false, gate: null };
  const gate = gatingChecklist({ gamesCount, missingSpreadCount, timingConfigured });
  return { due: gate.canOpen, blocked: !gate.canOpen, gate };
}

// ══════════════════════════════════════════════════════════════════════════
// DI-359 — FINALIZE WEEK, a guided flow sequencing three already-built
// actions behind one sheet. NO NEW MATH anywhere below: every function here
// is a thin wrapper calling exactly the function today's three separate
// cards already call, in the same order, through the same save paths.
// AD-33 is unchanged by this DI — neither the tiebreaker nor the Extra
// Point ever becomes a `calculateWeeklyResults()` standings input; this
// flow only makes SETTING them, before finalize, harder to skip by accident.
// ══════════════════════════════════════════════════════════════════════════

export const FINALIZE_STEPS = Object.freeze([
  { step: 1, id: 'approve-scores', title: 'Approve Scores' },
  { step: 2, id: 'confirm-tiebreaker', title: 'Confirm Tiebreaker' },
  { step: 3, id: 'confirm-extra-point', title: 'Confirm Extra Point' },
  { step: 4, id: 'finalize', title: 'Finalize' },
]);
export const FINALIZE_STEP_COUNT = FINALIZE_STEPS.length;

// ── Step 1 — Approve Scores ─────────────────────────────────────────────

/**
 * A pure readiness check over the slate — no write. A game "blocks" this
 * step the same way the manual `finalize-scoring-btn` handler already
 * implicitly requires (`g.status===GAME_STATUS.FINAL && g.lockedSpread!==null`
 * before it will grade a game at all): not yet final, or final with no
 * locked spread to grade against.
 */
export function finalizeApproveScoresSummary(games) {
  const list = games || [];
  const notFinal = list.filter((g) => g && g.status !== 'final');
  const missingLockedSpread = list.filter((g) => g && (g.lockedSpread === null || g.lockedSpread === undefined));
  return {
    gamesCount: list.length,
    notFinalCount: notFinal.length,
    missingLockedSpreadCount: missingLockedSpread.length,
    blocked: list.length === 0 || notFinal.length > 0 || missingLockedSpread.length > 0,
  };
}

/**
 * The step's Next action — grades ATS for every final+locked-spread game
 * (the `saveGame({...g, atsWinner: calculateAtsWinner(g)})` half of
 * `finalize-scoring-btn`'s sequence, `app.js:14014-14024`), and NOTHING
 * ELSE. Refuses to run at all while
 * `finalizeApproveScoresSummary(games).blocked` is true — this is the
 * step's own confirm gate.
 *
 * coordinator fix, REQUIRED (review round on ddf9e4f) — this function MUST
 * NOT call `finalizeWeek()`. The original version reused
 * `finalize-scoring-btn`'s full sequence including its own `finalizeWeek(week)`
 * call, reasoning (wrongly) that the button's own chat emitters were
 * deterministic-id/server-deduped so an extra call was harmless. That
 * missed what `finalizeWeek()` actually does at Step 1 of a flow that has
 * not reached Step 4 yet: it PUBLISHES PERMANENT CHAT POSTS
 * (`sys_weekfinal_<weekId>`, the results notice, SCRIBE week signals) and
 * raises the weekly obligation — using `week.actualTiebreakerValue`, which
 * is still `null` at this point in the guided flow (Step 2 hasn't run yet).
 * A commissioner who only got as far as reviewing scores would have already
 * posted a public "week final" announcement and an obligation computed
 * against a missing tiebreaker. `finalizeWeek()` runs EXACTLY ONCE, at Step
 * 4 (`confirmFinalizeWeek()`, below) — it re-grades ATS itself, so nothing
 * here is lost by not calling it.
 */
export function finalizeApproveScores({ week, games, deps }) {
  const summary = finalizeApproveScoresSummary(games);
  if (summary.blocked) return { ok: false, summary };
  const { calculateAtsWinner, saveGame } = deps;
  let graded = 0;
  for (const g of (games || [])) {
    if (g.status === 'final' && g.lockedSpread !== null && g.lockedSpread !== undefined) {
      saveGame({ ...g, atsWinner: calculateAtsWinner(g) });
      graded += 1;
    }
  }
  return { ok: true, summary, graded };
}

// ── Step 2 — Confirm Tiebreaker ─────────────────────────────────────────

/**
 * What Step 2 shows: the question (read-only reference — DI-357 owns
 * editing it, back in Step 6, before the week was ever locked), whether an
 * actual value is already on file, and the value to PREFILL the "Actual
 * Value" input with (the existing value if the commissioner already set one
 * via the standalone card, otherwise the freshly-run Auto-Calc). Per DI-359:
 * "if tiebreaker/Extra Point actual values are already set... pre-fill from
 * the existing values rather than forcing re-entry."
 */
export function tiebreakerConfirmSummary({ week, autoCalcValue = null } = {}) {
  const question = (week && week.tiebreakerQuestion) || '';
  const existing = week && week.actualTiebreakerValue != null ? week.actualTiebreakerValue : null;
  return {
    question,
    hasQuestion: question.trim().length > 0,
    autoCalcValue,
    alreadySet: existing != null,
    prefillValue: existing != null ? existing : autoCalcValue,
  };
}

/**
 * Runs the SAME Auto-Calc the standalone card's `auto-calc-tb-btn` handler
 * runs (`app.js:14608-14623`, unchanged): `calculateAlmaMaterTotal()` over
 * `almaMatersForAutoCalc(week)` (the lock-frozen roster once the week is
 * past OPEN — see that function's own docstring) and the week's own
 * `tiebreakerCalculationMode`. Returns `{ok:false}` (never a value of
 * `null`) when there are no final alma-mater scores yet to sum, matching
 * that handler's own "⚠️ No final alma mater scores yet." branch.
 */
export function finalizeAutoCalcTiebreaker({ week, deps }) {
  const { calculateAlmaMaterTotal, almaMatersForAutoCalc, getGames } = deps;
  const roster = almaMatersForAutoCalc ? almaMatersForAutoCalc(week) : [];
  const games = getGames ? getGames(week.weekId) : [];
  const total = calculateAlmaMaterTotal(games, roster, week.tiebreakerCalculationMode || 'selectedSlateOnly');
  return { ok: total !== null, value: total };
}

/**
 * The step's Confirm action — writes through the EXACT save path the
 * standalone Tiebreaker card's "Save Tiebreaker" button already uses
 * (`app.js:14572`'s equivalent: `actualTiebreakerValue`/`tiebreakerFinalized`
 * together, one `saveWeek`), including that handler's own conditional
 * recompute (`finalizeWeek(upd)` ONLY when the week is already `'final'` —
 * during THIS guided flow the week is still `live`/pending, so that branch
 * does not fire here; the real recompute happens once, at Step 4).
 *
 * coordinator fix, REQUIRED (review round on ddf9e4f), RG-256 class — this
 * spreads `deps.getWeek(week.weekId) || week`, NEVER the raw `week` the
 * caller passed in, before building `updated`. Same invariant every real
 * handler in app.js documents at length (`save-tb-btn`, `ep-save-btn`,
 * `confirm-finalize-btn` all re-read the mirror first): if the wizard's
 * caller is holding a STALE week object — e.g. Step 2 already saved onto
 * the mirror and the caller re-renders Step 3 from a closure that still
 * points at the pre-Step-2 object — spreading that stale object here would
 * silently NULL OUT whatever Step 2 (or any other device) already wrote.
 * `getWeek` must be added to the factory's dep bag by the app.js wiring
 * pass — every REAL call always has it, matching every actual app.js
 * handler, which never guards it either. It IS guarded here
 * (`getWeek && getWeek(...)`, falling back to the passed `week`), the same
 * defensive-optional pattern this module already uses for
 * `saveFetchProof`/`isSuggestionRejected` (see this file's own header) —
 * so a caller/test that omits it degrades to the OLD (pre-fix) behavior
 * rather than throwing, but the fallback is a safety net, not the intended
 * path once wired.
 *
 * Also refuses a non-finite, non-null `actualValue` (NaN, Infinity, a
 * string) rather than writing garbage — `null` STAYS LEGAL (an explicit
 * "no tiebreaker value yet," `tiebreakerFinalized` correctly stays false).
 */
export function confirmFinalizeTiebreaker({ week, actualValue, deps }) {
  const invalidValue = actualValue !== null && actualValue !== undefined && !Number.isFinite(actualValue);
  if (invalidValue) return { ok: false, reason: 'invalid_value' };
  const { saveWeek, finalizeWeek, getWeek } = deps;
  const cur = (getWeek && getWeek(week.weekId)) || week;
  const updated = { ...cur, actualTiebreakerValue: actualValue, tiebreakerFinalized: actualValue != null };
  saveWeek(updated);
  if (updated.status === 'final' && finalizeWeek) finalizeWeek(updated);
  return { ok: true, week: updated };
}

// ── Step 3 — Confirm Extra Point ────────────────────────────────────────

/**
 * What Step 3 shows: the actual value on file (if any) and, when one is
 * set, the SAME grading `gradeWeekExtraPoint()` already computes for the
 * standalone Extra Point card (`js/extra-point.js`, unchanged) — this is a
 * read, never a second grading implementation. `players` is the caller's
 * already-filtered active-player list (same shape every other
 * `gradeWeekExtraPoint()` call site in app.js already passes).
 */
export function finalizeExtraPointSummary({ week, players, deps }) {
  const { gradeWeekExtraPoint } = deps;
  const actualValue = week && week.extraPointActual != null ? week.extraPointActual : null;
  return {
    actualValue,
    hasActual: actualValue != null,
    graded: actualValue != null && gradeWeekExtraPoint ? gradeWeekExtraPoint(week, players || []) : null,
  };
}

/**
 * The step's Confirm action — the SAME save the standalone card's
 * `ep-save-btn` handler already makes (`app.js:19752-19758`'s equivalent:
 * `saveWeek({...week, extraPointActual})`), unchanged. Grading itself is
 * derived at read time (`gradeWeekExtraPoint`, above) — there is nothing
 * else to write.
 *
 * coordinator fix, REQUIRED (review round on ddf9e4f), RG-256 class — same
 * fix, same guard shape, as `confirmFinalizeTiebreaker()`: spreads
 * `deps.getWeek(week.weekId) || week`, never the raw (possibly stale)
 * `week` argument. `getWeek` must be added to the factory's dep bag.
 *
 * Also refuses a non-finite `actualValue` (NaN, Infinity, a string,
 * `null`/`undefined`) — matching `ep-save-btn`'s own guard exactly
 * (`if (!Number.isFinite(v)) { showToast('Enter the actual longest FG
 * first', 'error'); return; }`, `app.js:19752-19754`): that button never
 * accepts a blank/null value either, so this doesn't loosen anything the
 * real handler already enforces.
 */
export function confirmFinalizeExtraPoint({ week, actualValue, deps }) {
  if (!Number.isFinite(actualValue)) return { ok: false, reason: 'invalid_value' };
  const { saveWeek, getWeek } = deps;
  const cur = (getWeek && getWeek(week.weekId)) || week;
  const updated = { ...cur, extraPointActual: actualValue };
  saveWeek(updated);
  return { ok: true, week: updated };
}

// ── Step 4 — Finalize ────────────────────────────────────────────────────

/**
 * The inline warning DI-359 asks to replace today's browser `confirm()`
 * with (the manual `.week-status-btn` "Finalize" path's own dialog,
 * `app.js:13627-13629`) — same trigger condition
 * (`weekHasUnresolvedTie(week, players, picks, games)`, unexported today;
 * see the handoff report), rendered as a warning box the commissioner can
 * read and still choose to proceed past, never a gate (matching today's
 * "finalize anyway and fix it later" behavior exactly — entering the
 * tiebreaker afterward already recalculates automatically, DI-D).
 */
export function unresolvedTieWarning({ week, players, picks, games, deps }) {
  const { weekHasUnresolvedTie } = deps;
  const show = !!(weekHasUnresolvedTie && weekHasUnresolvedTie(week, players, picks, games));
  return { show, text: show ? WIZARD_COPY.UNRESOLVED_TIE_WARNING : '' };
}

/**
 * The step's Finalize action — the EXACT sequence `confirm-finalize-btn`'s
 * handler already runs (`app.js:13745-13762`, unchanged): save the status
 * transition first (`status:'final', finalizedAt, pendingFinalization:
 * false`), THEN hand `finalizeWeek()` the PERSISTED object, never the
 * pre-save snapshot (the same ordering invariant that handler's own comment
 * documents — storage and the caller's object must agree before a
 * downstream guard reads either one).
 *
 * coordinator fix, REQUIRED (review round on ddf9e4f), RG-256 class — same
 * fix as the two functions above: spreads `deps.getWeek(week.weekId) ||
 * week` FIRST, so this step's own base is the mirror's current row (which
 * by now carries Steps 1-3's writes: graded ATS, `actualTiebreakerValue`,
 * `extraPointActual`) rather than whatever `week` snapshot the Finalize
 * step's caller happened to be holding. `getWeek` must be added to the
 * factory's dep bag, same guard shape as the two functions above.
 */
export function confirmFinalizeWeek({ week, deps }) {
  const { saveWeek, finalizeWeek, getWeek } = deps;
  const cur = (getWeek && getWeek(week.weekId)) || week;
  const updated = { ...cur, status: 'final', finalizedAt: new Date().toISOString(), pendingFinalization: false };
  saveWeek(updated);
  if (finalizeWeek) finalizeWeek(updated);
  return { ok: true, week: updated };
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
    // DI-354 — shared step-navigation, both flows.
    stepBackTarget: (step) => stepBackTarget(step),
    shouldConfirmAnnouncementDiscard: (text) => shouldConfirmAnnouncementDiscard(text),
    // DI-357 — Step 6's tiebreaker confirmation.
    tiebreakerStepSummary: (week) => tiebreakerWizardStepSummary(week),
    applyTiebreakerQuestion: (week, question) => applyTiebreakerQuestion(week, question),
    // DI-358 — the three-way open-mode choice + the scheduled-open tick predicate.
    finishWeekSetup: (args) => finishWeekSetupFromWizard({ ...args, deps }),
    dueForScheduledOpen: (args) => dueForScheduledOpen(args),
    // DI-359 — the guided Finalize Week flow, one function per step.
    finalizeApproveScores: (args) => finalizeApproveScores({ ...args, deps }),
    finalizeAutoCalcTiebreaker: (week) => finalizeAutoCalcTiebreaker({ week, deps }),
    confirmFinalizeTiebreaker: (args) => confirmFinalizeTiebreaker({ ...args, deps }),
    finalizeExtraPointSummary: (args) => finalizeExtraPointSummary({ ...args, deps }),
    confirmFinalizeExtraPoint: (args) => confirmFinalizeExtraPoint({ ...args, deps }),
    unresolvedTieWarning: (args) => unresolvedTieWarning({ ...args, deps }),
    confirmFinalizeWeek: (week) => confirmFinalizeWeek({ week, deps }),
  };
}
