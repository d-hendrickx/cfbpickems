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
 *
 * ── DI-404 (UN-388, N16 — the mandatory weekly blurb, 2026-09-29) ──────────
 * Drew: "when the commissioner is making the week it should be mandatory to
 * make the weekly blurb." "Making the week" means PUBLISHING it (Step 6 Open
 * now / Schedule Open); a draft is invisible to players, so Keep as draft
 * stays exempt. This file owns the DOM-free half:
 *   - `blurbCheck(text)` — the ONE definition of "filled": whitespace
 *     collapsed, trimmed, at least `BLURB_MIN_LENGTH` (10) characters. Both
 *     app.js surfaces (the wizard's Step 5 and the Week-tab blurb card) call
 *     it, so the two can never disagree about what counts.
 *   - `blurbGate(week)` / `blurbRequiredForOpen(week)` — who is gated: only a
 *     draft, non-demo week. An open/locked/live/final week is never re-checked
 *     (grandfathering), and a demo week (commissioner-only) is exempt.
 *   - `openForPicksFromWizard()` and `finishWeekSetupFromWizard()` (NOW and
 *     SCHEDULED) refuse with `reason: 'blurb_required'` after the three-item
 *     checklist passes. DRAFT is untouched.
 * `gatingChecklist()` is UNTOUCHED on purpose (its three items and shape are
 * pinned). AMENDED (coordinator override, 2026-09-30): `dueForScheduledOpen()`
 * now ALSO asks for the blurb. The DI first left the scheduled-open tick blind
 * to it (so a week scheduled before N16 shipped would still open), which let a
 * blank-blurb week open through Step 4's Auto-Open At — against Drew's rule
 * that the blurb is mandatory when the commissioner makes the week. A due week
 * with no valid blurb is now BLOCKED (the tick raises the commissioner alert,
 * and the week opens on the first tick after a blurb exists); demo weeks stay
 * exempt.
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
  // DI-404 (UN-388, 2026-09-29) — "(optional)" is gone: the blurb is required
  // before a week can be opened (Step 6), never before a draft is saved.
  { step: 5, id: 'blurb', title: 'Weekly Blurb' },
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
  // D1 (DI-533): `sport` ('NFL') prefixes the line in a multi-sport league; '' (every one-sport league) is today's exact string.
  OPEN_SUCCESS: (weekNumber, sport = '') => `${sport ? sport + ' ' : ''}Week ${weekNumber} is open — picks unlock now.`,
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
  // DI-404 (UN-388) — the mandatory weekly blurb. Quoted verbatim from the DI;
  // shown INLINE (never a toast or alert) under the textarea on Step 5 and on
  // the Week-tab blurb card, and beside the disabled Open button on Step 6.
  BLURB_EMPTY: "Add a note for your players — it's the first thing they see on the Picks page.",
  BLURB_SHORT: 'A little longer, please — at least 10 characters.',
  BLURB_REQUIRED_AT_OPEN: 'Write the weekly blurb before opening this week.',
  BLURB_ROW_MISSING: 'Weekly blurb not written yet',
  BLURB_ROW_DONE: 'Weekly blurb written',
  BLURB_WRITE_IT: 'Write it',
  // SP-54 / DI-469 (2026-10-01) — REWORDED: the old text said the winner/loser "will be decided" by row order, which stopped being true when the weekly tie-break
  // shipped. This is the LEGACY body, used only when the caller supplies no `finalizeTieNotice` dependency (weekwizardtest's no-dependency case); the app supplies
  // the dynamic notice (js/tie-context.js, via app.js), which names the stage the preview actually reaches.
  UNRESOLVED_TIE_WARNING: "This week has a tie in correct picks and no tiebreaker entered. If you finalize now, it is settled by each tied player's alma mater against the spread, then the Extra Point. Enter it in Confirm Tiebreaker, then continue to Finalize.",
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

// ══════════════════════════════════════════════════════════════════════════
// DI-404 (UN-388) — THE MANDATORY WEEKLY BLURB. Pure, DOM-free, sport-blind:
// the predicate reads no sport, so it holds for every week of every sport.
// ══════════════════════════════════════════════════════════════════════════

/** A blurb must hold at least this many characters once whitespace is
 *  collapsed and trimmed (DI-404 item 3). */
export const BLURB_MIN_LENGTH = 10;

/**
 * The ONE definition of a filled blurb. Collapses every run of whitespace
 * (newlines and tabs included) to one space, trims, then counts CHARACTERS as
 * a person reads them — code points, so an emoji is one character, not two.
 * `null`/`undefined`/non-strings read as empty. Returns
 *   { ok, reason: null | 'empty' | 'short', length, text }
 * where `text` is the collapsed form (used only for the count; callers save
 * what the commissioner actually typed, never this normalised copy).
 */
export function blurbCheck(text) {
  const collapsed = (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
  const length = Array.from(collapsed).length;
  if (length === 0) return { ok: false, reason: 'empty', length: 0, text: '' };
  if (length < BLURB_MIN_LENGTH) return { ok: false, reason: 'short', length, text: collapsed };
  return { ok: true, reason: null, length, text: collapsed };
}

/** The inline message for a failed `blurbCheck()` reason ('' when it passed). */
export function blurbErrorCopy(reason) {
  if (reason === 'empty') return WIZARD_COPY.BLURB_EMPTY;
  if (reason === 'short') return WIZARD_COPY.BLURB_SHORT;
  // Step 4's Auto-Open At: a time is set/confirmed while the blurb is missing.
  if (reason === 'required_at_open') return WIZARD_COPY.BLURB_REQUIRED_AT_OPEN;
  return '';
}

const NON_DRAFT_STATUSES = Object.freeze(['open', 'locked', 'live', 'final']);

/**
 * Is `week` subject to the publish gate? Only a DRAFT (draft -> open is the one
 * gated transition). Exempt: a week that is already open/locked/live/final
 * (grandfathered — never re-checked) and a demo week (`dataSourceMode ===
 * 'demo'`, commissioner-only). A missing status counts as a draft, so a
 * malformed row errs toward asking for the blurb, never toward skipping it.
 * `Keep as draft` is exempt by mode, not by this predicate (see
 * `finishWeekSetupFromWizard`).
 */
export function blurbRequiredForOpen(week) {
  if (!week) return false;
  if (week.dataSourceMode === 'demo') return false;
  return !NON_DRAFT_STATUSES.includes(week.status);
}

/**
 * The gate, as one value: `required` (does the rule apply to this week),
 * `check` (`blurbCheck(week.blurb)`), `satisfied` (the blurb is valid — what
 * the Step 6 checklist row's tick shows) and `ok` (NOT blocked: not required,
 * or satisfied — what enables Open / Schedule Open and lets Step 4 skip
 * forward).
 */
export function blurbGate(week) {
  const required = blurbRequiredForOpen(week);
  const check = blurbCheck(week ? week.blurb : '');
  return { required, check, satisfied: check.ok, ok: !required || check.ok };
}

/** `null` when the week may open, else the refusal both open paths return. */
function blurbRefusalFor(week) {
  const gate = blurbGate(week);
  return gate.ok ? null : { ok: false, reason: 'blurb_required', blurb: gate.check };
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
  const { season, weekNumber, roundLabel = '', startDate = '', endDate = '', dataSourceMode: fieldsDataSourceMode, competitionId = null, profile = null } = fields;
  const dataSourceMode = fieldsDataSourceMode ?? existingWeek?.dataSourceMode ?? 'espn_live';
  // D1 (DI-533 #2): `competitionId` (null for the league's default competition) and the sport `profile` go to createWeek() ONLY for a brand-new week; re-saving Step 1 on an
  // existing draft keeps the competition it was created in. With neither (every one-sport league), createWeek() is called exactly as before.
  const week = existingWeek
    ? { ...existingWeek, season, weekNumber, roundLabel, startDate, endDate, dataSourceMode }
    : { ...createWeek(season, weekNumber, startDate, endDate, ...(competitionId || profile ? [{ competitionId, profile }] : [])), dataSourceMode, roundLabel };
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
    profileForWeek, suggestSlateFor, slateTargetFor,
  } = deps;
  if (!week || !week.startDate) {
    return { ok: false, reason: 'no_start_date', added: 0 };
  }
  const endDate = week.endDate || week.startDate;
  // D1 (DI-533 #3/#4): a week of a sport OTHER than college football fetches ITS scoreboard (`sport`), flags no alma-mater games (the NFL has no affinity rule, D-31), and builds its
  // slate by kickoff on the profile's days with the profile's own size. A college week - and every call with no `profileForWeek` dep - runs exactly the code below it always did.
  const profile = profileForWeek ? profileForWeek(week) : null;
  const otherSport = !!profile && profile.key !== 'cfb';
  const result = await fetchByDateRange({
    startDate: week.startDate, endDate, season: week.season,
    almaMaters: otherSport && !profile.affinity ? [] : (claimedAlmaMaters ? claimedAlmaMaters() : []),
    ...(otherSport ? { sport: profile.key } : {}),
  });
  if (result.qualityReport && saveFetchProof) saveFetchProof(result.qualityReport);
  if (result.error || !result.games || !result.games.length) {
    return { ok: false, reason: result.error || 'no_games', added: 0 };
  }
  clearAvailableGames(week.weekId);
  saveAvailableGames(week.weekId, result.games);
  const pool = getAvailableGames ? getAvailableGames(week.weekId) : result.games;
  const candidatePool = isSuggestionRejected ? pool.filter((g) => !isSuggestionRejected(week.weekId, g)) : pool;
  const byKickoff = otherSport && !profile.affinity && typeof suggestSlateFor === 'function';
  const scored = !byKickoff && candidatePool.length ? scoreCandidateGames(candidatePool, week.weekId) : [];
  const built = byKickoff ? suggestSlateFor({ profile, candidates: candidatePool }) : buildSuggestedSlate(scored, 10);
  // D1 (W-68, DI-W68.6, R-3): the bulk add stops at the sport's slate size instead of silently growing the slate past it. With no `slateTargetFor` dep there is no limit and this loop is exactly
  // what it was. The limit is the sport's size OR the suggestion engine's own length when it widened the slate for alma-mater games ("ALL is absolute", Drew's standing ruling), so an empty slate
  // always takes the whole suggestion, as before.
  const targetRaw = typeof slateTargetFor === 'function' ? Number(slateTargetFor(week)) : NaN;
  const limit = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.max(Math.floor(targetRaw), built.slate.length) : Infinity;
  let added = 0, held = 0;
  for (const game of built.slate) {
    const already = getGames(week.weekId).some((g) => g.homeTeam === game.homeTeam && g.awayTeam === game.awayTeam);
    if (already) continue;
    if (getGames(week.weekId).length >= limit) { held += 1; continue; }
    saveGame(createGame(week.weekId, { ...game, weekId: week.weekId })); added += 1;
  }
  return {
    ok: true, added, held, target: Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : null, fetched: result.games.length, suggested: built.slate.length,
    partial: result.games.length < (byKickoff && profile.slate && profile.slate.minSize ? profile.slate.minSize : 10),
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
  // DI-404 (UN-388) — the weekly blurb is the fourth requirement, kept OUT of
  // gatingChecklist() on purpose (that function's three items and shape are
  // pinned; dueForScheduledOpen() adds the blurb beside it). Same refusal shape
  // on both open paths.
  const blurbRefusal = blurbRefusalFor(week);
  if (blurbRefusal) return { ...blurbRefusal, gate };
  const { applyWeekStatusChange, showToast, nativeHapticImpact, isNativeShell, sportLabelFor } = deps;
  const updated = applyWeekStatusChange(week, 'open');
  if (showToast) showToast(WIZARD_COPY.OPEN_SUCCESS(week.weekNumber, sportLabelFor ? sportLabelFor(week) : ''), 'success');
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
 *   (DI-404, UN-388) NOW and SCHEDULED both also refuse with
 *   `reason: 'blurb_required'` (after the checklist passes) until the week's
 *   blurb holds `blurbCheck().ok` — see `blurbGate()`. DRAFT never asks.
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
    // DI-404 (UN-388) — scheduling an open is publishing; same blurb gate as
    // Open now. (dueForScheduledOpen() asks again at open time, so a week that
    // was scheduled before this shipped, or whose blurb was cleared since, is
    // held by the tick rather than opened — coordinator override, 2026-09-30.)
    const blurbRefusal = blurbRefusalFor(week);
    if (blurbRefusal) return { ...blurbRefusal, mode, gate };
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
  if (!week || week.status !== 'draft' || !week.picksOpenAt) return { due: false, blocked: false, gate: null, blurb: null };
  const at = new Date(week.picksOpenAt).getTime();
  if (!Number.isFinite(at) || now < at) return { due: false, blocked: false, gate: null, blurb: null };
  const gate = gatingChecklist({ gamesCount, missingSpreadCount, timingConfigured });
  // DI-404 AMENDED (coordinator override, 2026-09-30) — the weekly blurb is the
  // fourth requirement here too. The DI first left this leg blind to the blurb (so
  // a week scheduled before N16 shipped would still open); that let a blank-blurb
  // week open through Step 4's Auto-Open At, which Drew's rule ("mandatory when
  // the commissioner makes the week") cannot allow. A due week with no valid blurb
  // is now BLOCKED, not opened: the tick raises the commissioner alert and the
  // week opens on the first tick after a blurb exists. gatingChecklist() itself
  // stays untouched (its three items and its return shape are pinned). Demo weeks
  // are exempt (blurbGate); `blurb` is the gate so the tick can name WHY.
  const blurb = blurbGate(week);
  const ok = gate.canOpen && blurb.ok;
  return { due: ok, blocked: !ok, gate, blurb };
}

// ══════════════════════════════════════════════════════════════════════════
// PF-1 / UN-410, UN-411 / DI Amendment 1 (A1.1, 2026-10-01) — LATE ENTRY: "Re-open Picks" on a week whose lock instant has PASSED.
//
// Drew: "No we do not use it after lock time to let someone enter late, but theoretically the commissioner should have that power." From migration 0043 the server closes a week
// at its lock instant and re-locks a re-opened one within a minute, so a bare "Re-open Picks" after the instant would be a lock with no door. The door is a NEW lock time: the
// commissioner picks one (now + 30 min by default, later than now, no later than the week's last kickoff), the app writes weeks.picks_lock_at while the week is still locked and
// THEN re-opens it through the existing transition; the guard and the job honour an explicit picks_lock_at exactly, so the server neither refuses writes nor re-locks until then.
// Before the instant, Re-open Picks behaves exactly as it always did. Pure and import-free like the rest of this file: the caller passes the effective lock time and the games.
// ══════════════════════════════════════════════════════════════════════════

export const LATE_ENTRY_COPY = Object.freeze({
  TITLE: 'Re-open picks',
  FIELD_LABEL: 'New lock time',
  /** The sentence the sheet shows BEFORE the commissioner confirms — what the action does, in the league's own terms. `timeText` is already formatted (and is escaped by the caller). */
  consequence: (timeText) => `Picks and guesses reopen for everyone until ${timeText}.`,
  CONFIRM: 'Re-open Picks',
  CANCEL: 'Cancel',
  ERR_INVALID: 'Enter a date and time.',
  ERR_PAST: 'Pick a time after now.',
  ERR_AFTER_LAST_KICKOFF: "Pick a time no later than the week's last kickoff.",
  ERR_NO_WINDOW: 'Every game has already kicked off, so there is no time left to re-open picks for.',
  /** N3 (reviewer BLOCK #1, 2026-10-01): appended to the consequence line when the chosen time is AFTER the week's first kickoff — guesses (and any game that has not kicked off) reopen while others are underway. */
  WARN_STARTED: 'Some games will already have started.',
  SAVE_FAILED: "Couldn't set the new lock time. The week was not re-opened. Check your connection and try again.",
  /** Reason `not_locked`: the week left LOCKED while the sheet was open (it went live at first kickoff, or another device moved it). Only a locked, unrevealed week can be re-opened, so nothing was written. */
  NOT_LOCKED: "This week is no longer locked, so it can't be re-opened.",
  OPENED: (timeText) => `Picks re-opened until ${timeText}.`,
});
export const LATE_ENTRY_DEFAULT_MS = 30 * 60 * 1000;

/** Does "Re-open Picks" need a new lock time? True only when the week has a lock instant (`lockAtMs`, the effective one: picksLockAt, else first kickoff minus the offset) and it has passed. */
export function lateEntryApplies({ lockAtMs = null, now = Date.now() } = {}) {
  return typeof lockAtMs === 'number' && Number.isFinite(lockAtMs) && now >= lockAtMs;
}
/** The week's LAST kickoff in ms (the bound the new lock time may not pass), ignoring games with no usable kickoff — the same filter as scoring.js computeLastKickoff. `null` when there is none. */
export function lateEntryLastKickoffMs(games) {
  const times = (games || []).map((g) => (g && g.kickoff ? new Date(g.kickoff).getTime() : null)).filter((t) => typeof t === 'number' && !Number.isNaN(t));
  return times.length ? Math.max(...times) : null;
}
/** The week's FIRST kickoff in ms, ignoring games with no usable kickoff (the same filter as scoring.js computeFirstKickoff). `null` when there is none. */
export function lateEntryFirstKickoffMs(games) {
  const times = (games || []).map((g) => (g && g.kickoff ? new Date(g.kickoff).getTime() : null)).filter((t) => typeof t === 'number' && !Number.isNaN(t));
  return times.length ? Math.min(...times) : null;
}
/** N3: the clause the consequence line gains when the chosen lock time is AFTER the week's first kickoff (strictly: a lock exactly at kickoff closes as the first game starts). `''` otherwise, and when no kickoff is known. */
export function lateEntryStartedWarning({ atMs, firstKickoffMs = null } = {}) {
  return typeof atMs === 'number' && Number.isFinite(atMs) && typeof firstKickoffMs === 'number' && Number.isFinite(firstKickoffMs) && atMs > firstKickoffMs ? LATE_ENTRY_COPY.WARN_STARTED : '';
}
/**
 * N1 (reviewer BLOCK #1, 2026-10-01): did the picks_lock_at write REACH the server? The adapter's flush() result has a dozen shapes and only some of them mean "sent": `{held:true}` (stale
 * mirror), `{skipped:true}` (no client), `{refused:[..]}`, `{heldOffline:[..]}`, `{retrying:[..]}` (a retryable failure: the batch STOPS at the failing operation, so a week write queued after it never
 * went either), `{refusedStale:[..]}` (dropped), `{stillRefused:[..]}` (latched), `{abandoned:true}`, and a thrown error (null here). A result that merely does not NAME `cfbp_weeks` is therefore NOT
 * evidence it was sent; `pending` is the evidence the result cannot give — it answers "is the lock-time patch for this week still waiting to be written?" (app.js asks the adapter's own planner).
 * Counting any of those as success let the planner send `transition_week(open)` BEFORE the picks_lock_at patch (the weeks key plans its status leg ahead of its row patches), which is the two-step
 * ordering this write exists to protect. Pure; `pending` is a boolean the caller computed AFTER the flush settled.
 */
export function lateEntryLockWriteLanded(res, { pending = false } = {}) {
  if (!res || typeof res !== 'object') return false;
  if (res.abandoned === true || res.held === true || res.skipped === true) return false;
  for (const k of ['refused', 'heldOffline', 'retrying', 'refusedStale', 'stillRefused']) {
    if (Array.isArray(res[k]) && res[k].includes('cfbp_weeks')) return false;
  }
  return pending !== true;
}
/** The default new lock time: now + 30 minutes, clamped to the last kickoff when that comes sooner; `null` when no time is left (every game has kicked off). */
export function lateEntryDefaultMs({ now = Date.now(), lastKickoffMs = null } = {}) {
  if (lastKickoffMs !== null && lastKickoffMs <= now) return null;
  const d = now + LATE_ENTRY_DEFAULT_MS;
  return lastKickoffMs !== null && d > lastKickoffMs ? lastKickoffMs : d;
}
/**
 * Is a typed new lock time acceptable? `atMs` is NaN for a blank or garbled field. Order of the checks is the order the commissioner would fix them in: nothing left to choose
 * (`no_window`), then unreadable (`invalid`), then not after now (`past`), then past the last kickoff (`after_last_kickoff`). With no dated game there is no upper bound.
 */
export function validateLateEntryAt({ atMs, now = Date.now(), lastKickoffMs = null } = {}) {
  if (lastKickoffMs !== null && lastKickoffMs <= now) return { ok: false, reason: 'no_window' };
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return { ok: false, reason: 'invalid' };
  if (atMs <= now) return { ok: false, reason: 'past' };
  if (lastKickoffMs !== null && atMs > lastKickoffMs) return { ok: false, reason: 'after_last_kickoff' };
  return { ok: true, reason: null };
}
/** The sheet's inline message for a refusal reason from validateLateEntryAt (`''` for none). */
export function lateEntryErrorCopy(reason) {
  switch (reason) {
    case 'invalid': return LATE_ENTRY_COPY.ERR_INVALID;
    case 'past': return LATE_ENTRY_COPY.ERR_PAST;
    case 'after_last_kickoff': return LATE_ENTRY_COPY.ERR_AFTER_LAST_KICKOFF;
    case 'no_window': return LATE_ENTRY_COPY.ERR_NO_WINDOW;
    default: return '';
  }
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
  // FB-027 / DI-519 (2026-10-07) — Step 3's title is the DI's copy. The id is unchanged (weekwizardtest [15-1] pins the ids), and the step is shown only
  // when the week runs the contest (finalizeStepsFor(), below).
  { step: 3, id: 'confirm-extra-point', title: 'Longest field goal (Extra Point)' },
  { step: 4, id: 'finalize', title: 'Finalize' },
]);
export const FINALIZE_STEP_COUNT = FINALIZE_STEPS.length;

// ── FB-027 / UN-417 / PF-417 (bug batch W, 2026-10-07) — DI-518 / DI-519 ──────────────────────────────────────────────────
// The defect: the guided flow below was reachable only when `week.pendingFinalization` was set (a flag the background tick raises), and the status-row
// "Finalize" applied `final` directly — so a commissioner finalized without the tiebreaker or the longest field goal. These are the DOM-free decisions the
// fix needs; js/app.js renders them. Copy quoted from DESIGN_D1_A §4.3.
export const FINALIZE_COPY = Object.freeze({
  ENTRY_FINALIZE: 'Finalize Week',
  ENTRY_REVIEW: 'Review & finalize',
  ALL_FINAL_LEAD: 'All games are final.',
  ALL_FINAL_ASK: 'Ready to close this week and lock standings?',
  NOT_YET: 'Not yet',
  TB_REQUIRED: "Enter the final value to finalize. The tiebreaker can't be skipped once players have guessed.",
  CHIP_CALCULATED: 'Calculated',
  CHIP_MANUAL: 'Commissioner-set',
  MISSING: 'Missing',
  NOT_USED: 'Not used this week',
  EP_LABEL: 'Actual longest field goal (yards)',
  // R3 (review round 1) — Step 3's Detect, the Comm card's ep-detect-btn reached from inside the wizard.
  EP_DETECT: 'Detect',
  EP_DETECTING: 'Fetching scoring plays…',
  EP_DETECT_NONE: 'No made field goals found yet.',
  EP_DETECT_FAILED: "Couldn't fetch scoring plays. Check your connection and try again.",
  // B1 (review round 1; DI-519 amended inline by the coordinator, 2026-10-07) — what the sheet says while and after it waits for the server.
  // "Nothing was saved" is never said: a PENDING finalize is queued on this device (which already shows the week final) and the adapter sends it
  // by itself; only a REFUSAL is final.
  // PF-416 / FB-026 follow-up, item 2 (thread 100726-D1, 2026-10-07; copy for the coordinator's inline approval) — the refused row is TRUTHFUL and
  // TERMINAL. It said "Reload and try again." and its Reload was a re-sync, which a refused week write survives by the adapter's design: the next
  // press re-sent the same refused finalize and was refused again, as often as the commissioner tried. It now says what is true and offers the one
  // real next step: reloading the app, which ends the refused write this device was still holding, so the week reads here as it does for everyone.
  FINALIZING: 'Finalizing…',
  NOT_SENT: "Not sent yet. It will finish when you're back online.",
  REFUSED: "Couldn't finalize. The server didn't accept it, so the week is still live for everyone.",
  RETRY: 'Retry',
  RELOAD: 'Reload app',
  SUCCESS: (weekNumber) => `Week ${weekNumber} is final.`,
  // PF-416 review follow-up (coordinator decision, 2026-10-08) — the success that reloads the app (the adapter still holds a refused week write)
  // says so, so the reload does not look like a crash. Every other success keeps SUCCESS.
  SUCCESS_REFRESHING: (weekNumber) => `Week ${weekNumber} is final. Refreshing…`,
});

/**
 * B1 (review round 1) — what a press of Finalize Week (or Retry) DOES, decided before anything is written:
 *   'confirmed'  the SERVER already holds the week final (an earlier press landed, or another device finalized it): success, and never a second
 *                finalize — re-running it would re-stamp finalizedAt and re-write results the server now refuses outside finalize_week();
 *   'reask'      THIS DEVICE already shows the week final (an earlier press is queued or still in flight): only ask the server again;
 *   'blocked'    the review card is missing a required value: nothing is written;
 *   'finalize'   the one first-time finalize.
 */
export function finalizePressAction({ serverFinal = false, deviceStatus = null, blocked = false } = {}) {
  if (serverFinal) return 'confirmed';
  if (deviceStatus === 'final') return 'reask';
  if (blocked) return 'blocked';
  return 'finalize';
}

/** B1 — the server's answer, as the sheet shows it: 'saved' succeeds; 'pending' is "Not sent yet" with Retry (re-ask only); anything else (refused,
 *  an error) is the terminal refused row (PF-416 follow-up, item 2): "Couldn't finalize. The server didn't accept it, so the week is still live for
 *  everyone." with Reload app — never a Retry, since a refused write cannot succeed by being sent again. */
export function finalizeOutcomeView(state) {
  if (state === 'saved') return { kind: 'success', text: '', action: null, actionLabel: '' };
  if (state === 'pending') return { kind: 'not-sent', text: FINALIZE_COPY.NOT_SENT, action: 'retry', actionLabel: FINALIZE_COPY.RETRY };
  return { kind: 'refused', text: FINALIZE_COPY.REFUSED, action: 'reload', actionLabel: FINALIZE_COPY.RELOAD };
}

/**
 * PF-416 / FB-026 follow-up, item 3 (thread 100726-D1, 2026-10-07) — where a Finalize entry opens. `committed`: this device already shows the week
 * final and the server does not hold it final yet (a press is queued, or refused). Such a finalize re-enters at Step 4 with the server's last answer:
 * 'refused' when the week write is latched refused, otherwise 'pending' ("Not sent yet" + Retry, a re-ask). Never Step 1: walking Steps 1-3 again
 * would offer a tiebreaker and a longest field goal that the queued finalize never carries. Otherwise Step 1, as always.
 */
export function finalizeEntryState({ committed = false, refused = false } = {}) {
  if (!committed) return { step: FINALIZE_STEPS[0].step, outcome: null };
  return { step: FINALIZE_STEPS[FINALIZE_STEPS.length - 1].step, outcome: refused ? 'refused' : 'pending' };
}

/**
 * DI-518 — the Manage screen's Finalize entry. Offered only while the week is LIVE (the caller passes the SERVER-confirmed status, RG-251, the same one
 * the status row is built from). Every game final ⇒ "Finalize Week" plus the all-final banner; otherwise "Review & finalize" (Step 1 names what blocks).
 * In a multi-sport league the label names the sport and week ("Finalize NFL Week 6"). Never keyed to `pendingFinalization`.
 */
export function finalizeEntry({ status, games, sportCode = null, weekNumber = null, multiSport = false } = {}) {
  const list = games || [];
  const show = status === 'live';
  const allFinal = show && list.length > 0 && list.every((g) => g && g.status === 'final');
  const named = multiSport && sportCode && weekNumber != null ? ` ${sportCode} Week ${weekNumber}` : '';
  const label = allFinal
    ? (named ? `Finalize${named}` : FINALIZE_COPY.ENTRY_FINALIZE)
    : `${FINALIZE_COPY.ENTRY_REVIEW}${named}`;
  return { show, allFinal, label };
}

/**
 * DI-518 AMENDMENT (coordinator, inline, 2026-10-07: "PF-417 means finalize from the Week Wizard, and a hidden entry fails it"). When the wizard opens
 * on a next-week DRAFT, the live week's Manage screen — the only home of its Finalize entry — is unreachable (openWeekWizardSheet() routes to the lone
 * continuable draft). This names the week that is hiding: a LIVE week of the SAME sport as the draft, other than the draft itself; the lowest-numbered
 * when there are several. Any live week qualifies, not only an earlier-numbered one: a draft numbered below a live week hides Finalize the same way.
 * `statusOf` is the caller's status reader (app.js passes the SERVER-confirmed one, RG-251, as the Manage screen does); `sameSport(a, b)` is the
 * caller's competition comparison (app.js: competitionForWeek()). Pure; `null` when nothing is hiding.
 */
export function liveWeekBehindDraft({ draft, weeks, statusOf = (w) => w && w.status, sameSport = () => true } = {}) {
  if (!draft || draft.status !== 'draft') return null;
  const hits = (weeks || []).filter((w) => w && w.weekId !== draft.weekId && statusOf(w) === 'live' && sameSport(w, draft));
  hits.sort((a, b) => (Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0));
  return hits[0] || null;
}
/** DI-518 amendment — the draft view's row: "Week N is live" and its button, "Finalize Week N" ("Finalize NFL Week N" in a multi-sport league). */
export function liveWeekRowCopy({ weekNumber, sportCode = null, multiSport = false } = {}) {
  return { text: `Week ${weekNumber} is live`, button: `Finalize ${multiSport && sportCode ? `${sportCode} ` : ''}Week ${weekNumber}` };
}

/** DI-518 — the visible steps: Step 3 only when the week runs the longest-field-goal contest (`extraPointEnabled`, opt-out: `!== false`, extra-point.js). */
export function finalizeStepsFor(week) {
  const epOn = !(week && week.extraPointEnabled === false);
  return FINALIZE_STEPS.filter((s) => s.id !== 'confirm-extra-point' || epOn);
}
/** The visible step after / before `step` (`null` at either end), and `step`'s 1-based place among the visible steps (for the tracker). A step that is
 *  no longer visible (the contest was switched off mid-flow) normalizes to the next visible one. */
export function finalizeNextStep(step, week) {
  const steps = finalizeStepsFor(week).map((s) => s.step);
  return steps.find((n) => n > step) ?? null;
}
export function finalizePrevStep(step, week) {
  const steps = finalizeStepsFor(week).map((s) => s.step);
  return [...steps].reverse().find((n) => n < step) ?? null;
}
export function finalizeNormalizeStep(step, week) {
  const steps = finalizeStepsFor(week).map((s) => s.step);
  return steps.includes(step) ? step : (steps.find((n) => n > step) ?? steps[steps.length - 1]);
}
export function finalizeStepPosition(step, week) {
  const steps = finalizeStepsFor(week).map((s) => s.step);
  return { index: steps.indexOf(finalizeNormalizeStep(step, week)) + 1, count: steps.length };
}

/** DI-519 — is the tiebreaker REQUIRED to finalize? Only when the week asks a question AND at least one entrant guessed; otherwise a blank value stays
 *  legal (the existing path). `guessCount` is the caller's count of entrants with a guess on file (blind-gated in app.js). */
export function tiebreakerRequirement({ week, guessCount = 0 } = {}) {
  const hasQuestion = !!(week && typeof week.tiebreakerQuestion === 'string' && week.tiebreakerQuestion.trim());
  return { hasQuestion, guessCount, required: hasQuestion && guessCount > 0 };
}

/**
 * DI-519 + DI-516 (D1 integration, 2026-10-07) — the tiebreaker value's source chip, from DI-516's ONE answer (`effectiveTiebreakerActual()`,
 * js/live-tiebreak.js, passed in by the caller: this module keeps zero imports). FB-027 first shipped its own comparison here ("the value equals the
 * Auto-Calc total"); its own comment said DI-516 supersedes it, so the integration keeps DI-516's `matchesCalculated` (a stored value equal to a
 * COMPLETE calculated total) and the guided flow, the review card and the Comm card share one rule:
 *   no value                                          ⇒ ''                  (no chip)
 *   a stored value that is not the complete total      ⇒ 'Commissioner-set'
 *   a stored value equal to the complete total, or the live calculated total itself ⇒ 'Calculated'
 */
export function tiebreakerSourceChip(effective) {
  const e = effective || {};
  if (e.value === null || e.value === undefined || e.value === '' || !Number.isFinite(Number(e.value)) || e.source === 'none') return '';
  return e.source === 'manual' && !e.matchesCalculated ? FINALIZE_COPY.CHIP_MANUAL : FINALIZE_COPY.CHIP_CALCULATED;
}

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
    finalCount: list.length - notFinal.length,   // FB-027 / DI-519 — Step 1's count line and the review's Scores row
    notFinalCount: notFinal.length,
    missingLockedSpreadCount: missingLockedSpread.length,
    blocked: list.length === 0 || notFinal.length > 0 || missingLockedSpread.length > 0,
  };
}

/** DI-519 — Step 1's count line: `{F} of {N} games final · spreads locked` (or how many spreads are not locked). */
export function finalizeScoresCountLabel(summary) {
  const s = summary || {};
  const head = `${s.finalCount || 0} of ${s.gamesCount || 0} games final`;
  const m = s.missingLockedSpreadCount || 0;
  return m ? `${head} · ${m} spread${m === 1 ? '' : 's'} not locked` : `${head} · spreads locked`;
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
  const { calculateAlmaMaterTotal, almaMatersForAutoCalc, getGames, effectiveTiebreakerActual } = deps;
  const games = getGames ? getGames(week.weekId) : [];
  // D1 / DI-516 (FB-002) — the suggestion comes from the SAME live module every ranking surface uses (js/live-tiebreak.js, via the app's effectiveTiebreakerActualForWeek), so a week
  // whose tiebreaker is not the alma-mater total (the NFL's designated game) is suggested correctly instead of summing no schools and answering null. `finalValue` is the FINAL-games-only
  // total, i.e. exactly calculateAlmaMaterTotal's number (livetiebreaktest proves the parity), and it is read even when a stored override exists: the step suggests the CALCULATED value.
  if (typeof effectiveTiebreakerActual === 'function') {
    const calc = (effectiveTiebreakerActual(week, games) || {}).calculated;
    const value = calc && calc.finalValue !== undefined ? calc.finalValue : null;
    return { ok: value !== null, value };
  }
  const roster = almaMatersForAutoCalc ? almaMatersForAutoCalc(week) : [];
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
/*
 * FB-027 / DI-519 (2026-10-07) — `required` (from tiebreakerRequirement(): the week asks a question and an entrant guessed) refuses a missing value with
 * reason `'required'`, and so does `provisional` (a value that is not final yet — DI-516's live total). Neither is passed by a caller that has no such
 * rule, so the old "null stays legal" contract (weekwizardtest [15-19g]) holds exactly where the DI keeps it: no question, or nobody guessed.
 */
export function confirmFinalizeTiebreaker({ week, actualValue, required = false, provisional = false, deps }) {
  const invalidValue = actualValue !== null && actualValue !== undefined && !Number.isFinite(actualValue);
  if (invalidValue) return { ok: false, reason: 'invalid_value' };
  if (required && (actualValue === null || actualValue === undefined || provisional)) return { ok: false, reason: 'required' };
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
  const { weekHasUnresolvedTie, finalizeTieNotice } = deps;
  // SP-54 / DI-469 — prefer the dynamic notice (it names the stage the preview actually reaches and covers the Extra Point-missing case). It arrives by
  // INJECTION: this module keeps zero imports. A caller with no such dependency gets today's body exactly (weekwizardtest [15-26], [16-12]).
  // FB-027 / DI-518 (2026-10-07) — no variant argument any more: this inline box is the notice's one surface (the browser-dialog variant is retired).
  if (typeof finalizeTieNotice === 'function') {
    const n = finalizeTieNotice(week, players, picks, games);
    return { show: !!(n && n.show), text: n && n.show ? String(n.text || '') : '' };
  }
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
  // N-3 (SP-54 / DESIGN A.9): this IS the live-to-final transition, so the weekly tie rule is in force for the week being settled whatever this device's clock
  // says (`settling`); every later read goes by the stamp. A finalizeWeek dependency that ignores the second argument behaves exactly as before.
  if (finalizeWeek) finalizeWeek(updated, { settling: true });
  return { ok: true, week: updated };
}

/**
 * FB-027 / DI-519 — the review card (Step 4): one row per required value, in the DI's order, and whether anything required is missing. Pure: every input
 * is a value the caller already read (the slate, the count of entrants who guessed — blind-gated in app.js — DI-516's answer for the week (`effective`,
 * effectiveTiebreakerActual(): it names the chip), the Extra Point grading from gradeWeekExtraPoint(), the entrant and member counts). A missing value
 * reads `Missing`, never 0 (a null actual is never coerced). The chip describes the value SHOWN: an `effective` for some other value (or none) reads
 * "Commissioner-set", the conservative label.
 *   rows[i] = { id, label, parts: string[], ok }   (rendered `label · part · part`)
 *   blocked = some row is not ok  →  Finalize Week stays disabled.
 */
export function finalizeReview({ week, games, guessCount = 0, effective = null, provisional = false, epGraded = null, entrants = 0, members = 0 } = {}) {
  const w = week || {};
  const finite = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const scores = finalizeApproveScoresSummary(games);
  const rows = [{ id: 'scores', label: 'Scores', parts: [`${scores.finalCount} of ${scores.gamesCount} final`], ok: !scores.blocked }];

  const tb = tiebreakerRequirement({ week: w, guessCount });
  if (!tb.hasQuestion) {
    rows.push({ id: 'tiebreaker', label: 'Tiebreaker', parts: [FINALIZE_COPY.NOT_USED], ok: true });
  } else {
    const missing = !finite(w.actualTiebreakerValue) || provisional;
    const value = missing ? null : Number(w.actualTiebreakerValue);
    const chip = missing ? '' : tiebreakerSourceChip(effective && Number(effective.value) === value ? effective : { value, source: 'manual', matchesCalculated: false });
    rows.push({
      id: 'tiebreaker', label: 'Tiebreaker',
      parts: [w.tiebreakerQuestion.trim(), ...(missing ? [FINALIZE_COPY.MISSING] : [String(value), ...(chip ? [chip] : [])])],
      ok: !(tb.required && missing),
    });
  }

  if (w.extraPointEnabled === false) {
    rows.push({ id: 'extra-point', label: 'Longest field goal', parts: [FINALIZE_COPY.NOT_USED], ok: true });
  } else if (!finite(w.extraPointActual)) {
    rows.push({ id: 'extra-point', label: 'Longest field goal', parts: [FINALIZE_COPY.MISSING], ok: false });
  } else {
    // `epGraded` null = the grading is not visible (the caller's blind gate): the row says the yards and nothing about who was closest.
    const graded = epGraded && Array.isArray(epGraded.winners) && Array.isArray(epGraded.rows);
    const names = graded ? epGraded.winners.map((id) => (epGraded.rows.find((r) => r.playerId === id) || {}).displayName).filter(Boolean) : [];
    rows.push({
      id: 'extra-point', label: 'Longest field goal',
      parts: [`${Number(w.extraPointActual)} yd`, ...(graded ? [`closest without going over: ${names.length ? names.join(', ') : 'no one'}`] : [])],
      ok: true,
    });
  }

  rows.push({ id: 'players', label: 'Players counted', parts: [`${entrants} of ${members}`], ok: true });
  return { rows, blocked: rows.some((r) => !r.ok), missing: rows.filter((r) => !r.ok).map((r) => r.id) };
}

/**
 * FB-027 / DI-519 — the Finalize Week action with the server's answer awaited. Runs confirmFinalizeWeek() (the EXACT sequence it always ran), then asks
 * `deps.confirmSaved(week)` whether the server has it: `'saved'` is the only success; `'refused'`, `'pending'` (still queued, offline) or a throw is
 * shown by the caller through finalizeOutcomeView() — never a success toast. A caller with no `confirmSaved` (local mode) succeeds at once. A blocked
 * review is refused before anything is written. This is the FIRST-TIME finalize only: a week this device already shows final is never handed here
 * again (finalizePressAction() → 'reask' / 'confirmed'; review round 1, B1).
 */
export async function finalizeWeekFromWizard({ week, blocked = false, deps }) {
  if (blocked) return { ok: false, state: 'blocked', week };
  const { week: updated } = confirmFinalizeWeek({ week, deps });
  let state = 'saved';
  if (typeof deps.confirmSaved === 'function') {
    try { state = await deps.confirmSaved(updated); } catch (e) { state = 'pending'; }
  }
  return { ok: state === 'saved', state, week: updated };
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
    // DI-404 (UN-388) — the mandatory weekly blurb (pure; needs no deps).
    blurbCheck: (text) => blurbCheck(text),
    blurbGate: (week) => blurbGate(week),
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
    // FB-027 / DI-519 — Step 4 with the server's answer awaited (deps.confirmSaved).
    finalizeWeekFromWizard: (args) => finalizeWeekFromWizard({ ...args, deps }),
  };
}
