/**
 * js/control-center.js — UX Revamp, Group A1, Build Wave 1 (T-13/T-14).
 * Implements DI-301…306 of `weekly bug fixes and feedback/UX Revamp 092426/
 * DESIGN_INPUTS_A1_NAV_SHELL_092426.md` (APPROVED INLINE 2026-09-24, three
 * amendments; AMENDMENT 2026-09-25 T-30 rulings are BINDING and applied
 * throughout this file). **Fix round 1** (reviewer BLOCK, same date) is
 * folded in below — every finding is named at its fix site, not just here.
 *
 * THIS PASS builds ONLY this file and `controlcentertest.mjs` — no edits to
 * `app.js`/`index.html`/`chat-ui.js`/`styles.css`/`loadtest.mjs`/
 * `service-worker.js`. Every existing app.js renderer this DI calls for
 * ("embed, don't redesign") is INJECTED via `ctx.bodies`, never imported —
 * this module cannot import app.js (app.js will import THIS module once the
 * coordinator wires it, and the reverse edge would be a cycle, the same
 * reasoning `js/leagues-home.js`'s own header already gives for its own
 * app.js-free design).
 *
 * ── DISCIPLINE, matching js/leagues-home.js / js/nav-gestures.js / js/roles.js ──
 * ZERO top-level DOM/localStorage access, ZERO top-level side effects — every
 * exported function does nothing until called. Pure render functions take
 * data in, return an HTML string; the one stateful piece (the drawer/pane/
 * accordion machine) is a pure reducer, batch-tested via
 * `_controlCenterStateMachine()`, exactly like `nav-gestures.js`'s
 * `_navShowHideStateMachine()`. The only DOM-touching code lives inside
 * `bindControlCenterEdgeSwipe()` and `mountControlCenter()`.
 *
 * ── FIX ROUND 1, FINDING 1 — THE ROOT NODE MUST BE STABLE ───────────────────
 * The first pass's `mountControlCenter()` called `rootEl.innerHTML =
 * renderControlCenter(ctx, state)` on EVERY dispatch. `innerHTML =` destroys
 * every descendant and builds fresh ones — so `#control-center` was a BRAND
 * NEW node on every repaint, already painted in its end state. A freshly
 * created node has no "before" style to transition FROM within the same
 * paint, so the CSS transition this whole phase machine depends on
 * (`opening`→`transitionend`→`open`) could never actually fire in a real
 * browser: the phase machine got permanently stuck in `opening`/`closing`,
 * `push-profile` (gated on `phase === 'open'`) became unreachable, and a
 * close never reached `'closed'`, so the page stayed `inert` forever.
 *
 * THE FIX: `mountControlCenter()` now builds the DOM ONCE (`rootEl.innerHTML
 * = renderControlCenter(...)`, the one time a full-string assignment is
 * correct — there is no prior DOM to preserve yet), captures references to
 * the STABLE nodes (`backdropEl`, `drawerEl`, the two pane wrappers, the two
 * `.control-center-pane-content` containers, `closeBtnEl`), and NEVER touches
 * `rootEl.innerHTML` again. Every later update is one of two kinds:
 *   - **Attribute-only** (`applyAttributes()`) — `data-open`/`data-phase`/
 *     `data-pane`/`data-dragging`, the `--cc-drag-progress` custom property,
 *     `inert`, and each pane wrapper's own `data-active` — direct property/
 *     attribute writes on the ALREADY-EXISTING nodes, so a REAL CSS
 *     transition now has a real "before" state to animate from.
 *   - **Content repaint** (`paintMainContent()`/`paintProfileContent()`) —
 *     `.innerHTML` on ONE pane's CONTENT container only (never the pane
 *     wrapper, never the drawer root), for the handful of events that
 *     actually change what's rendered (an accordion row opening/closing, or
 *     an explicit `update(nextCtx)` call) — wrapped in `js/field-preserve.js`
 *     capture/restore (fix round 1, finding 9 — see there).
 *
 * A `setTimeout(DRAWER_MOTION_MS + 40)` fallback (armed on every `open`/
 * `close`/`drag-end` dispatch, cleared by a real `transitionend` OR the next
 * phase-changing dispatch) still dispatches `transition-end` if the real
 * event never arrives — a hidden tab, a duration mismatch, or a browser that
 * drops the event under load must not leave the drawer stuck. Reduced motion
 * is unaffected: it already resolves `open`/`close` synchronously, with no
 * transient phase and therefore nothing to time out.
 *
 * ── FIX ROUND 1, FINDING 3 — THE EDGE-SWIPE BINDER MUST NOT SUSPEND ITSELF ──
 * `bindControlCenterEdgeSwipe()`'s first pass gated on the SHARED
 * `gesturesSuspended()` from `js/nav-gestures.js`. Once that shared function
 * is amended (per the wiring checklist) to ALSO return true whenever
 * `#control-center[data-open="true"]` exists — i.e., whenever THIS drawer is
 * open — calling it from this binder would be self-defeating: the moment the
 * drawer opens, its OWN edge-swipe-to-close binder would refuse to arm,
 * because the shared function now (correctly, for every OTHER gesture) says
 * "something is suspending gestures" — that something being this drawer
 * itself. `gesturesSuspended()` is deliberately NOT imported/used for this
 * binder's own gating. A small LOCAL function, `isBlockedByOtherSurface()`,
 * duplicates ONLY the checks that exist independently of this drawer
 * (`#site-gate-overlay`, `.modal-overlay`, `#chat-sheet-wrap`) — the exact
 * same "duplicate a few constants/checks rather than create a cross-file
 * self-reference" precedent `nav-gestures.js`'s own file header already sets
 * for `AXIS_DEAD_ZONE_PX`/`SWIPE_COMMIT_PX`. A real gate/modal/chat-sheet
 * still blocks the drawer's own gesture; the drawer being open never blocks
 * itself.
 *
 * ── ZERO-DEPENDENCY LEAF IMPORTS (safe — these modules import nothing that
 *    could cycle back here, and none of them are this pass's claimed files) ──
 *   `isNativeShell()`        — js/platform.js
 *   `haptic()`               — js/haptics.js
 *   `prefersReducedMotion()`, `AXIS_DEAD_ZONE_PX`, `WEEK_SWIPE_EDGE_EXCLUDE_PX`
 *                            — js/nav-gestures.js (NOT `gesturesSuspended` —
 *                              see finding 3 above)
 *   `comingSoonCopy()`       — js/leagues-home.js (DI-313's shared "not
 *                              released yet" stub pattern)
 *   `getShellBrandName()`    — js/brand.js (NOT the iOS-thread-exclusive
 *                              `getShellWordmark()`/`getShellTagline()`)
 *   `TIME_ZONES`, `DEFAULT_TZ`, `THEMES` — js/data-model.js (imports
 *                              nothing itself — the one module every leaf
 *                              here can safely read from without a cycle)
 *   `captureDirtyFields()`, `restoreDirtyFields()`, `stampFieldOwner()` —
 *                              js/field-preserve.js (RG-176 — see finding 9)
 *
 * ── THE `ctx` CONTRACT ──────────────────────────────────────────────────────
 * {
 *   session: { player: { id, displayName, initials, almaMater,
 *                        preferences: { timeZone, theme, logoView } },
 *              isAdmin },
 *   memberships: [],                         // DI-302's future multi-league
 *                                             // card slot — accepted, unused
 *   league: { id, name, pilot },
 *   escHtml: fn(string) -> string,           // REQUIRED (CONVENTIONS #12)
 *   icon: fn(name, {label}?) -> string,      // REQUIRED (js/icons.js's icon())
 *   isNativeShell: fn() -> boolean,          // injected per the task's ctx
 *                                             // shape; this module ALSO
 *                                             // imports the real one directly
 *                                             // for its own gesture binder.
 *   flags: { isCommissioner, isPlatformAdmin, isSuperAdmin, isPilotLeague },
 *   version: { APP_VERSION, APP_VERSION_DATE },
 *   bodies: {
 *     notifSettingsHTML,   // renderNotifSettingsBodyHTML()'s RESOLVED string
 *                           // — that function is ASYNC, signature
 *                           // `(playerId, pushState, device)`. See the
 *                           // WIRING_CHECKLIST for the cached->skeleton->
 *                           // loaded flow via `update()`.
 *     chatPrefsHTML,       // chat-ui.js's prefs-panel body verbatim
 *     scribeFileHTML,      // "My SCRIBE File" body verbatim
 *     feedbackCardHTML,    // renderRulesPage()'s feedback-card markup,
 *                           // verbatim — NOW EMBEDDED (VERDICT amendment 3,
 *                           // applied fix round 1 finding 4 — see below)
 *     gameRequestHTML,     // renderGameRequestCardHTML() verbatim
 *     releaseNotesHTML,    // renderReleaseNotesCardHTML() verbatim
 *   },
 *   timeZones = TIME_ZONES, currentTimeZone = DEFAULT_TZ,   // DI-303 row
 *   themes = THEMES, currentTheme = 'neutral',               // DI-307 gap-fill row
 *   logoView = false,                                        // DI-331c row
 *   callbacks: {
 *     onSignOut, onSwitchLeague,                              // DI-302
 *     onOpenLeaguePage,           // SECURITY GATE FINDING 3 (2026-09-25) — the identity header's league-name tap
 *     onOpenPasswordChange, onOpenDeleteAccount,              // DI-335/DI-340
 *     onSaveDisplayName, onSaveInitials, onSaveAlmaMater,      // Profile pane
 *     onSetTimeZone, onSetTheme, onSetLogoView,                // DI-303/307/331
 *     onNavigate(target),   // 'rules' | 'commissioner' | 'admin' | 'super-admin'
 *     onDrawerVisibilityChange(isOpen), // for app.js to toggle `inert`
 *                                        // on the rest of the page (DI-301)
 *   },
 * }
 *
 * `mountControlCenter(rootEl, ctx, options)` additionally takes
 * `options.onAfterPaint(rootEl, state)` (fix round 1, finding 2) — called
 * after EVERY visible update (attribute-only or content repaint), so the
 * coordinator can (re)bind listeners inside freshly-inserted content —
 * `bindGameRequestCard()`, a notifications-toggle binder, `bindTzToggle()`-
 * equivalent, etc. — without this module needing to know any of their names.
 * The returned API also gains `update(nextCtx)` — re-renders both panes'
 * content against a NEW `ctx` while preserving the current phase/pane/open-
 * row state, for exactly this purpose (an async body resolving, a toggle
 * flipping, a fresh `getSession()` read).
 *
 * ── NAMED DEVIATIONS / GAPS, per this thread's own "flag, don't silently
 *    resolve" discipline (matching the DI's own §14/§15 sections; fix-round-1
 *    corrections are marked as such where they supersede a fix-round-0 note) ──
 *
 * 1. DI-301's own text proposes a 24px left-edge zone, "tunable." By the time
 *    this pass builds, `js/nav-gestures.js` already shipped
 *    `WEEK_SWIPE_EDGE_EXCLUDE_PX = 28` with the comment "left-edge zone
 *    reserved for T-13's drawer." This module reuses that constant
 *    (`DRAWER_EDGE_ZONE_PX = WEEK_SWIPE_EDGE_EXCLUDE_PX`) rather than
 *    re-declaring 24, per the coordinator's own task instruction.
 *
 * 2. DI-302's original text says tapping the identity block opens
 *    `showAccountSheet()`. The 2026-09-25 AMENDMENT overrides this: tapping
 *    the name/avatar PUSHES a Profile pane; Sign out/Switch league become
 *    plain rows under the header instead.
 *
 * 3. REMOVED, fix round 1 finding 5. Fix-round-0 built an OPTIONAL "View
 *    League As" row (gated on a supplied callback + `isPlatformAdmin`),
 *    named in that round's own notes as "not in the approved DI text."
 *    Reviewer confirmed it: not in the DI, not in the amendment — DI-320's
 *    admin league selector is its home, not this drawer. Deleted entirely,
 *    including its test coverage. This numbered slot is left as a tombstone,
 *    not renumbered, so the historical reasoning stays traceable (this
 *    codebase's own convention — see MEMORY's "don't delete list entries
 *    that match no player without asking").
 *
 * 4. DI-303's ORIGINAL row list included "Profile" as an accordion row.
 *    Research found no existing standalone self-service profile-edit body
 *    to embed — only the commissioner's per-OTHER-player "Edit Player" modal,
 *    and chat-ui.js's prefs panel (embedded here as `bodies.chatPrefsHTML`)
 *    which carries its OWN alma-mater dropdown. `renderProfileScreen()`
 *    below renders NEW, minimal fields wired to injected save callbacks.
 *    Flagged for the coordinator/Group F (T-02) to confirm this doesn't
 *    duplicate/diverge from the chat-prefs alma-mater control before ship.
 *
 * 5. SUPERSEDED, fix round 1 finding 4 (coordinator ruling). Fix round 0
 *    read DI-304 §5's own later "correction" (Feedback as a deep link) over
 *    the DI's own VERDICT header, amendment (3): *"the feedback card
 *    physically moves into the drawer's Feedback section (DI-303 accordion
 *    pattern) rather than deep-linking to Rules; Drew's line was 'I want the
 *    feedback button here.'"* That was the wrong read — the VERDICT's own
 *    amendments are binding over a DI body's later self-correction. Fixed:
 *    **Feedback is now an accordion row** (same single-open-per-group
 *    mechanic as Version history, sharing the `feedbackGroupOpenRow` state),
 *    embedding `ctx.bodies.feedbackCardHTML` verbatim when open. The
 *    deep-link action (`cc-feedback`, `onOpenFeedback`) is removed.
 *
 * 6. DI-305's own literal copy predates `js/leagues-home.js`'s DI-313/DI-316
 *    SHARED stub pattern (`comingSoonCopy()`, the `[data-action="coming-
 *    soon"]` contract), which shipped this same wave. Per the coordinator's
 *    explicit instruction, the Help Center row uses `comingSoonCopy('The
 *    Help Center')`. **Correction (fix round 1 checklist note):** no
 *    document-level delegated handler for `[data-action="coming-soon"]`
 *    exists in `app.js` yet — fix round 0 wrongly assumed one did. The
 *    WIRING_CHECKLIST now says CREATE it, not "confirm it reaches this
 *    subtree."
 *
 * 7. Icons that exist today (js/icons.js Phase 1): `bell`, `almaMater`,
 *    `settings`, `chevronRight`, `chevronLeft`, `sportFootball`. Rows with no
 *    matching icon render TEXT LABELS ONLY (never an emoji substitute):
 *    Time zone, SCRIBE settings, Chat settings, Game settings, Team logos,
 *    Theme, Commissioner/Admin/Super Admin panel rows, Help Center, Feedback,
 *    Rules, Version history — each an owed Phase-2 glyph. `bell` is reused
 *    for Notifications, `almaMater` for the Profile pane's alma-mater field.
 *    `chevronRight` is reused for every disclosure/expand chevron.
 *    **Fix round 1, finding 7:** the Profile pane's back affordance now uses
 *    `icon('chevronLeft')` (already exists — fix round 0 used a literal '‹'
 *    despite the real icon being available, an oversight, now fixed). The
 *    close control (✕) had NO Phase-1 icon and was an owed glyph (PAID
 *    2026-09-26, full-app review Step 6: `icon('close')`; the literal ✕ is
 *    now only the fallback when no icon family is injected) — the
 *    literal `✕` character is a plain monochrome symbol-font glyph (not an
 *    OS-drawn emoji pictograph), matching the identical precedent already
 *    shipped in `showAccountSheet()`'s modal-close button, but it is still
 *    explicitly OWED to Group E's icon inventory for full D-1 compliance.
 */

import { isNativeShell } from './platform.js';
import { haptic } from './haptics.js';
import { prefersReducedMotion, AXIS_DEAD_ZONE_PX, WEEK_SWIPE_EDGE_EXCLUDE_PX } from './nav-gestures.js';
import { comingSoonCopy } from './leagues-home.js';
import { getShellBrandName } from './brand.js';
import { TIME_ZONES, DEFAULT_TZ, THEMES } from './data-model.js';
import { captureDirtyFields, restoreDirtyFields, stampFieldOwner } from './field-preserve.js';
// Security fix round (2026-09-25), NOTE 1 — call js/roles.js's own
// predicates rather than inlining a second `=== true` copy of the same
// check. `isSuperAdmin(session)`/`isPlatformAdmin(session)` read
// `session.isSuperAdmin`/`session.isPlatformAdmin` off whatever bag is
// handed in — this module's `flags` bag carries those SAME field names
// (buildControlCenterCtx(), js/app.js), so passing `flags` straight through
// satisfies roles.js's contract without reshaping it into a `viewer`/
// `session` bag first. "Shape mismatch" here was nominal (the PARAMETER
// name roles.js's JSDoc uses), not structural.
import { isSuperAdmin, isPlatformAdmin } from './roles.js';

// ═════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════

/** DI-301 native layout: 85vw, capped at 340px (guards iPad-class widths). */
export const DRAWER_WIDTH_VW = 85;
export const DRAWER_MAX_WIDTH_PX = 340;

/** Reused from nav-gestures.js, NOT re-declared — see file-header note 1. */
export const DRAWER_EDGE_ZONE_PX = WEEK_SWIPE_EDGE_EXCLUDE_PX;

/** DI-301: "settles open/closed based on velocity + a 40%-of-width threshold." */
export const DRAWER_OPEN_SETTLE_RATIO = 0.4;
/** A deliberate flick (px/ms) overrides the distance threshold either direction. */
export const DRAWER_FLICK_VELOCITY_PX_MS = 0.3;

/**
 * Drawer open/close motion duration. Fix round 1 checklist note: the
 * coordinator's CSS transition for `#control-center`'s transform MUST use
 * the shared `--motion-nav` token (`css/styles.css:92`, already landed by
 * Group E's T-08 at 260ms) rather than a bespoke value — this constant is
 * kept in sync with that token (260, not the fix-round-0 value of 280) so
 * the JS fallback-timer math (`DRAWER_MOTION_MS + 40`) times out AFTER the
 * real CSS transition would have finished, never before it.
 */
export const DRAWER_MOTION_MS = 260;
/** DI-303: row expand/collapse, 200-250ms band, erring toward the fast end.
 *  No dedicated shared token names this narrower band; CSS uses this literal. */
export const ACCORDION_ROW_MOTION_MS = 220;

// ═════════════════════════════════════════════════════════════════════════
// SMALL SHARED HELPERS
// ═════════════════════════════════════════════════════════════════════════

function requireFn(fn, name, caller) {
  if (typeof fn !== 'function') {
    throw new TypeError(`${caller}() requires an injected \`${name}\` function`);
  }
  return fn;
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Renders `ctx.icon(name)` only for names known to exist today (file-header
 *  note 7) — every other row renders text-only, never an emoji fallback. */
const KNOWN_ICONS = new Set(['bell', 'almaMater', 'chevronRight', 'chevronLeft', 'sportFootball', 'settings', 'close']);
function iconOrNothing(ctx, name) {
  if (!name || !KNOWN_ICONS.has(name)) return '';
  return ctx.icon(name) || '';
}

// ═════════════════════════════════════════════════════════════════════════
// PURE STATE MACHINE — DI-301 (drawer phase + drag), DI-302 (pane push/pop),
// DI-303/304 (accordion single-open-per-group, unified under one 'toggle-row'
// event keyed by `group`).
// ═════════════════════════════════════════════════════════════════════════

/**
 * `phase`: 'closed' | 'opening' | 'open' | 'closing'.
 * `pane`: 'main' | 'profile' — DI-302's pushed Profile screen (amendment).
 * `dragging`/`dragProgress` (0..1): native edge-swipe/drag-to-close tracking.
 * `settingsOpenRow`: DI-303's row group's single open row id, or null.
 * `feedbackGroupOpenRow`: DI-304's group ('feedback' | 'version-history' |
 *   null) — its own independent single-open state, per the DI's "each
 *   labeled group manages its own single-open state independently." Feedback
 *   joined this group fix round 1 (finding 4/5) — it used to be a deep link.
 */
export function initialControlCenterState() {
  return {
    phase: 'closed',
    pane: 'main',
    dragging: false,
    dragProgress: 0,
    settingsOpenRow: null,
    feedbackGroupOpenRow: null,
  };
}

function stepControlCenter(state, event) {
  switch (event.type) {
    case 'open': {
      if (state.phase === 'open' || state.phase === 'opening') return state;
      return { ...state, phase: event.reducedMotion ? 'open' : 'opening' };
    }
    case 'close': {
      if (state.phase === 'closed' || state.phase === 'closing') return state;
      const reducedMotion = !!event.reducedMotion;
      return {
        ...state,
        phase: reducedMotion ? 'closed' : 'closing',
        pane: reducedMotion ? 'main' : state.pane,
      };
    }
    case 'transition-end': {
      if (state.phase === 'opening') return { ...state, phase: 'open' };
      if (state.phase === 'closing') return { ...state, phase: 'closed', pane: 'main' };
      return state;
    }
    case 'push-profile':
      if (state.phase !== 'open') return state;
      if (state.pane === 'profile') return state;
      return { ...state, pane: 'profile' };
    case 'pop-profile':
      if (state.pane === 'main') return state;
      return { ...state, pane: 'main' };
    case 'drag-start':
      if (state.dragging) return state;
      return { ...state, dragging: true, dragProgress: state.phase === 'open' ? 1 : 0 };
    case 'drag-move':
      if (!state.dragging) return state;
      return { ...state, dragProgress: clamp01(event.progress) };
    case 'drag-end': {
      if (!state.dragging) return state;
      const settled = { ...state, dragging: false, dragProgress: event.settleOpen ? 1 : 0 };
      return stepControlCenter(settled, {
        type: event.settleOpen ? 'open' : 'close',
        reducedMotion: event.reducedMotion,
      });
    }
    case 'toggle-row': {
      if (event.group === 'settings') {
        return { ...state, settingsOpenRow: _toggleAccordionRow(state.settingsOpenRow, event.rowId) };
      }
      if (event.group === 'feedback') {
        return { ...state, feedbackGroupOpenRow: _toggleAccordionRow(state.feedbackGroupOpenRow, event.rowId) };
      }
      return state;
    }
    default:
      return state;
  }
}

/** Batch-runner for controlcentertest.mjs — events in, snapshot out, one per
 *  step. Mirrors nav-gestures.js's `_navShowHideStateMachine()` shape. */
export function _controlCenterStateMachine(events) {
  let state = initialControlCenterState();
  const out = [];
  for (const ev of events) {
    state = stepControlCenter(state, ev);
    out.push({
      phase: state.phase, pane: state.pane,
      settingsOpenRow: state.settingsOpenRow,
      feedbackGroupOpenRow: state.feedbackGroupOpenRow,
    });
  }
  return out;
}

/** Single-open-per-group toggle — opening one row closes any other open row
 *  in the SAME group; re-tapping the open row closes it. */
export function _toggleAccordionRow(currentOpenId, rowId) {
  return currentOpenId === rowId ? null : rowId;
}

/**
 * The "gesturesSuspended() hook" — true whenever the drawer is visually
 * present: fully open, mid open/close transition, OR mid-drag with any
 * progress. `renderControlCenter()`'s root node carries this exact value as
 * `data-open` — nav-gestures.js's own future amendment reads
 * `document.querySelector('#control-center[data-open="true"]')` against it
 * (see the WIRING_CHECKLIST). NOT consulted by this file's OWN edge-swipe
 * binder — see finding 3 in the file header.
 */
export function isDrawerVisuallyOpen(state) {
  if (!state) return false;
  if (state.phase === 'open' || state.phase === 'opening' || state.phase === 'closing') return true;
  return !!state.dragging && state.dragProgress > 0;
}

// ═════════════════════════════════════════════════════════════════════════
// PURE GESTURE MATH — DI-301's native edge-swipe / drag-to-close.
// ═════════════════════════════════════════════════════════════════════════

/** True only inside the reserved left-edge band (file-header note 1). */
export function _isWithinEdgeZone(clientX) {
  return typeof clientX === 'number' && clientX >= 0 && clientX < DRAWER_EDGE_ZONE_PX;
}

/**
 * DI-301: "settles open/closed based on velocity + a 40%-of-width threshold."
 */
export function _resolveDrawerSettle({ progress, velocityPxPerMs = 0 }) {
  if (velocityPxPerMs >= DRAWER_FLICK_VELOCITY_PX_MS) return true;
  if (velocityPxPerMs <= -DRAWER_FLICK_VELOCITY_PX_MS) return false;
  return clamp01(progress) >= DRAWER_OPEN_SETTLE_RATIO;
}

/**
 * Fix round 1, finding 3. Duplicates ONLY the checks that exist independently
 * of this drawer's own open/closed state — deliberately NOT
 * `gesturesSuspended()` (see the file header). If a future surface adds a
 * fourth suspending overlay to `nav-gestures.js`'s shared function, it should
 * be added here too — a short, occasionally-duplicated list, not a cycle.
 */
function isBlockedByOtherSurface() {
  if (typeof document === 'undefined') return false;
  if (document.getElementById?.('site-gate-overlay')) return true;
  if (document.querySelector?.('.modal-overlay')) return true;
  if (document.getElementById?.('chat-sheet-wrap')) return true;
  // Reviewer B4 (3c fix window, third pass) — the two full-screen surfaces that
  // shipped with their OWN native drag gestures (the League Page's left-edge
  // swipe-back, the wizard sheet's drag-to-dismiss). Without them here, a
  // swipe starting in the 28 px edge band while the League Page was up armed
  // BOTH this drawer and the League Page's back-swipe — two gestures fighting
  // over one finger. One owner per touch.
  if (document.getElementById?.('league-page-overlay')) return true;
  if (document.getElementById?.('week-wizard-sheet-wrap')) return true;
  return false;
}

/**
 * DOM binder — gesture-DETECTION layer only. `dispatch` (REQUIRED) is the
 * only side effect; `getState` (REQUIRED) must return the CURRENT state
 * synchronously. `opts.getWidthPx` reads the drawer's live rendered width.
 *
 * Native-only (DI-301 PARITY-BY-DESIGN: web gets tap-only, no edge-swipe).
 */
export function bindControlCenterEdgeSwipe(dispatch, getState, opts = {}) {
  if (!isNativeShell()) return () => {};
  if (typeof dispatch !== 'function' || typeof getState !== 'function') return () => {};
  const getWidthPx = typeof opts.getWidthPx === 'function' ? opts.getWidthPx : () => DRAWER_MAX_WIDTH_PX;

  let start = null, axis = null, dragActive = false, wasOpenAtStart = false;
  let lastX = 0, lastT = 0, velocityPxPerMs = 0;

  function onTouchStart(e) {
    if (isBlockedByOtherSurface()) { start = null; return; }
    const t = e.touches?.[0];
    if (!t) return;
    const state = getState();
    const phaseOpen = state.phase === 'open';
    // Arm from the edge zone when closed (opening drag); arm ANYWHERE on the
    // open drawer when open (DI-301: "dragging the open drawer left closes
    // it the same way" — and per finding 3, the drawer being open never
    // blocks its OWN gesture from arming).
    if (!phaseOpen && !_isWithinEdgeZone(t.clientX)) { start = null; return; }
    start = { x: t.clientX, y: t.clientY };
    axis = null;
    dragActive = false;
    wasOpenAtStart = phaseOpen;
    lastX = t.clientX; lastT = Date.now(); velocityPxPerMs = 0;
  }

  function onTouchMove(e) {
    if (!start) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (axis === null && (Math.abs(dx) > AXIS_DEAD_ZONE_PX || Math.abs(dy) > AXIS_DEAD_ZONE_PX)) {
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x') { dragActive = true; dispatch({ type: 'drag-start' }); }
    }
    if (axis !== 'x' || !dragActive) return;
    const widthPx = Math.max(1, getWidthPx() || DRAWER_MAX_WIDTH_PX);
    const progress = wasOpenAtStart ? clamp01(1 + dx / widthPx) : clamp01(dx / widthPx);
    dispatch({ type: 'drag-move', progress });
    const now = Date.now();
    const dt = Math.max(1, now - lastT);
    velocityPxPerMs = (t.clientX - lastX) / dt;
    lastX = t.clientX; lastT = now;
  }

  function settle() {
    if (dragActive) {
      const state = getState();
      const settleOpen = _resolveDrawerSettle({ progress: state.dragProgress, velocityPxPerMs });
      // DI-301: "light/selection haptic on open... No haptic on close."
      if (settleOpen) haptic('light');
      dispatch({ type: 'drag-end', settleOpen, reducedMotion: prefersReducedMotion() });
    }
    start = null; axis = null; dragActive = false; velocityPxPerMs = 0;
  }

  const target = typeof window !== 'undefined' ? window : null;
  if (!target) return () => {};
  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: true });
  target.addEventListener('touchend', settle, { passive: true });
  target.addEventListener('touchcancel', settle, { passive: true });

  return () => {
    target.removeEventListener('touchstart', onTouchStart);
    target.removeEventListener('touchmove', onTouchMove);
    target.removeEventListener('touchend', settle);
    target.removeEventListener('touchcancel', settle);
  };
}

// ═════════════════════════════════════════════════════════════════════════
// DI-306 — STARRED PANELS. Deny-by-default: no flag, no entry. Order per the
// 2026-09-25 amendment: Super Admin -> Admin -> Commissioner. Fix round 1,
// finding 6: rendered as TWO labeled groups ("Admin", "Commissioner"), with
// Super Admin nested under the "Admin" group label, matching the mockup and
// DI-306 exactly (fix round 0 rendered one flat, unlabeled list).
// ═════════════════════════════════════════════════════════════════════════

/**
 * @param {{isCommissioner?, isPlatformAdmin?, isSuperAdmin?}} flags
 * @returns {Array<{id:string, label:string, target:string, group:'admin'|'commissioner'}>}
 */
export function starredPanels(flags = {}) {
  const panels = [];
  // T-35 Super Admin (DI-344/345) is now WIRED — the Admin panel's sixth tab
  // and this row both read the same isSuperAdmin(session) predicate, fed by
  // js/auth.js's refreshPlatformAdminFlags() (security fix round, 2026-09-25,
  // NOTE 2 — the prior "can never be true in production today… PLACEHOLDER"
  // comment is corrected; this route is real).
  if (isSuperAdmin(flags)) {
    panels.push({ id: 'super-admin', label: 'Super Admin Panel', target: 'super-admin', group: 'admin' });
  }
  if (isPlatformAdmin(flags)) {
    panels.push({ id: 'admin', label: 'Admin Panel', target: 'admin', group: 'admin' });
  }
  if (flags && flags.isCommissioner === true) {
    panels.push({ id: 'commissioner', label: 'Commissioner Panel', target: 'commissioner', group: 'commissioner' });
  }
  return panels;
}

const STARRED_GROUP_ORDER = [
  { key: 'admin', label: 'Admin' },
  { key: 'commissioner', label: 'Commissioner' },
];

// ═════════════════════════════════════════════════════════════════════════
// RENDER — DI-302 identity header + Profile pane
// ═════════════════════════════════════════════════════════════════════════

function roleChipsHTML(ctx) {
  // `.badge-open` is REUSED, temporarily — the WIRING_CHECKLIST flags a
  // dedicated `.cc-role-chip` visual treatment as still owed; `.badge-open`
  // is a correct-but-borrowed placeholder, not a permanent choice.
  const chips = [];
  if (ctx.flags?.isCommissioner) chips.push('<span class="badge badge-open cc-role-chip">Commissioner</span>');
  if (isPlatformAdmin(ctx.flags)) chips.push('<span class="badge badge-open cc-role-chip">Admin</span>');
  if (ctx.flags?.isPilotLeague) chips.push('<span class="badge badge-pilot cc-role-chip">Pilot</span>');
  return chips.join('');
}

function initialsOf(ctx) {
  const player = ctx.session?.player || {};
  if (player.initials) return String(player.initials).slice(0, 3);
  const name = String(player.displayName || '').trim();
  if (!name) return '';
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** DI-302 — identity block (avatar/name/league/chips/version) + the
 *  2026-09-25-amended Sign out / Switch league rows. Fix round 1, finding 5:
 *  the "View league as" row (fix round 0's own optional addition) is REMOVED
 *  entirely — not in the DI, not in the amendment; see file-header note 3. */
export function renderIdentityHeader(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderIdentityHeader');
  const player = ctx.session?.player || {};
  const name = ctx.escHtml(player.displayName || '');
  const leagueName = ctx.escHtml(ctx.league?.name || "IRB Pick'Ems");
  const initials = ctx.escHtml(initialsOf(ctx));
  const versionLine = ctx.escHtml(`${getShellBrandName()} ${ctx.version?.APP_VERSION || ''} · ${ctx.version?.APP_VERSION_DATE || ''}`.trim());

  // SECURITY GATE FINDING 3 (916bdb7 review, 2026-09-25) — the league name
  // is now its OWN tap target, separate from the name/avatar tap above it
  // (which stays Profile, per Drew's ruling). Before this fix `#league-page-
  // overlay` had exactly one reachable entry, `showAccountSheet()`'s "View
  // League" row — and `showAccountSheet()` itself had zero reachable
  // triggers (`#header-identity`, its only click binding, was removed
  // entirely in the header declutter, wiring pass 3a-bis) — so League Page,
  // League Standings and the sport cards were completely unreachable in the
  // shipped UI. `<button>` cannot nest, so this is a sibling row beneath the
  // profile-tap button, not a click target buried inside it.
  return `<div class="control-center-identity">
      <button type="button" class="control-center-identity-tap" data-action="cc-push-profile" aria-label="Open profile settings">
        <span class="cc-avatar" aria-hidden="true">${initials}</span>
        <span class="cc-identity-text">
          <span class="cc-identity-name">${name}${roleChipsHTML(ctx)}</span>
        </span>
      </button>
      <button type="button" class="cc-identity-league-tap text-muted" data-action="cc-open-league-page" aria-label="Open League Page">${leagueName}</button>
      <div class="cc-version-stamp text-muted">${versionLine}</div>
      <div class="control-center-identity-actions">
        <button type="button" class="control-center-row control-center-row--action" data-action="cc-signout">
          <span class="cc-row-label">Sign Out</span>
        </button>
        <button type="button" class="control-center-row control-center-row--action" data-action="cc-switch-league">
          <span class="cc-row-label">Switch League</span>
        </button>
      </div>
    </div>`;
}

/** DI-302 (amended) + DI-303's Profile fields, pushed. Fix round 1, finding
 *  7: back affordance now uses `icon('chevronLeft')` (already exists in
 *  Phase 1) instead of a literal '‹'.
 *
 *  UX Revamp Group F (DI-335/DI-340, 2026-09-25) — this pane also renders
 *  the "Password" and "Delete Account" rows, below Save. DI-335's own row
 *  label distinguishes "Change Password" (an account with a password
 *  identity already) from "Set Password" (Google-only, adding one). N4
 *  (third pass): auth.js's getAccountHasPasswordIdentity() now reads the
 *  session's own provider list, so the row (accountRowsHTML(), below) uses
 *  the DI's labels, falling back to a neutral "Password" only when the
 *  session cannot say. The rows render only in Supabase auth mode. */
export function renderProfileScreen(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderProfileScreen');
  const player = ctx.session?.player || {};
  const almaIcon = iconOrNothing(ctx, 'almaMater');
  const backIcon = iconOrNothing(ctx, 'chevronLeft');
  return `<div class="control-center-profile">
      <button type="button" class="control-center-back" data-action="cc-pop-profile">
        <span class="cc-row-icon" aria-hidden="true">${backIcon}</span> Control Center
      </button>
      <div class="admin-section-title">Profile</div>
      <div class="form-group">
        <label class="form-label" for="cc-field-display-name">Display name</label>
        <input class="form-input" id="cc-field-display-name" data-field="display-name"
          value="${ctx.escHtml(player.displayName || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="cc-field-initials">Initials</label>
        <input class="form-input" id="cc-field-initials" data-field="initials" maxlength="3"
          value="${ctx.escHtml(player.initials || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="cc-field-alma-mater">${almaIcon ? `<span class="cc-row-icon">${almaIcon}</span>` : ''}Alma mater &amp; home teams</label>
        <input class="form-input" id="cc-field-alma-mater" data-field="alma-mater"
          value="${ctx.escHtml(player.almaMater || '')}" />
      </div>
      <button type="button" class="btn btn-primary btn-block" data-action="cc-save-profile">Save</button>
      <!-- UX Revamp Group F (DI-335/DI-340, 2026-09-25) — account-identity
           rows, below the Save button, per DI-335's own placement note.
           See this function's own JSDoc header for the "Password" label's
           reasoning (a JS comment, not an HTML one — this whole function
           body is one template literal, and a stray backtick in an inline
           HTML comment here previously broke the module's own parse). -->
      ${ctx.accountRows === true ? accountRowsHTML(ctx) : ''}
    </div>`;
}

/** STEP B(7) / N4 (3c fix window, third pass) — the Password / Delete Account
 *  rows. Rendered ONLY when `ctx.accountRows === true` (Supabase auth mode):
 *  both act on a Supabase account and could only fail anywhere else ("a
 *  control that cannot do what it says is worse than no control", DI-335).
 *  Missing flag = hidden. The Password row is a drill-in, so it carries the
 *  same chevron every other drill-in row does; its label follows DI-335
 *  ("Change Password" / "Set Password"), neutral "Password" when the session
 *  cannot tell (`ctx.hasPasswordIdentity` null/absent). */
function accountRowsHTML(ctx) {
  const chevron = iconOrNothing(ctx, 'chevronRight');
  const label = ctx.hasPasswordIdentity === true ? 'Change Password'
    : ctx.hasPasswordIdentity === false ? 'Set Password' : 'Password';
  return `<button type="button" class="control-center-row control-center-row--action" data-action="cc-open-password-change">
        <span class="cc-row-label">${ctx.escHtml(label)}</span>
        <span class="cc-row-chevron" aria-hidden="true">${chevron}</span>
      </button>
      <div class="control-center-danger-zone">
        <button type="button" class="control-center-row control-center-row--action control-center-row--danger" data-action="cc-open-delete-account">
          <span class="cc-row-label">Delete Account</span>
        </button>
      </div>`;
}

// ═════════════════════════════════════════════════════════════════════════
// RENDER — DI-306 starred panels (fix round 1, finding 6: two labeled groups)
// ═════════════════════════════════════════════════════════════════════════

export function renderStarredPanels(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderStarredPanels');
  const panels = starredPanels(ctx.flags);
  if (panels.length === 0) return '';
  const chevron = iconOrNothing(ctx, 'chevronRight');
  return STARRED_GROUP_ORDER.map(g => {
    const rows = panels.filter(p => p.group === g.key);
    if (rows.length === 0) return '';
    const rowsHTML = rows.map(p => `<button type="button" class="control-center-row control-center-row--nav" data-action="cc-navigate" data-target="${ctx.escHtml(p.target)}">
        <span class="cc-row-label">${ctx.escHtml(p.label)}</span>
        <span class="cc-row-chevron" aria-hidden="true">${chevron}</span>
      </button>`).join('');
    return `<div class="control-center-group control-center-group--starred">
      <div class="control-center-group-label control-center-group-label--gold">${ctx.escHtml(g.label)}</div>
      ${rowsHTML}
    </div>`;
  }).join('');
}

// ═════════════════════════════════════════════════════════════════════════
// RENDER — DI-303 settings accordion (Profile excluded — see note 2/amendment)
// ═════════════════════════════════════════════════════════════════════════

function accordionRow(ctx, state, { group, rowId, label, iconName, bodyHTML, openRowValue }) {
  requireFn(ctx.escHtml, 'escHtml', 'accordionRow');
  const open = openRowValue === rowId;
  const iconHTML = iconOrNothing(ctx, iconName);
  return `<div class="control-center-row-wrap" data-row="${rowId}">
      <button type="button" class="control-center-row" data-action="cc-toggle-row" data-group="${group}" data-row="${rowId}" aria-expanded="${open}">
        ${iconHTML ? `<span class="cc-row-icon">${iconHTML}</span>` : ''}
        <span class="cc-row-label">${ctx.escHtml(label)}</span>
        <span class="cc-row-chevron" data-expanded="${open}" aria-hidden="true">${iconOrNothing(ctx, 'chevronRight')}</span>
      </button>
      ${open ? `<div class="control-center-row-body" id="cc-body-${rowId}"><div class="control-center-row-body-inner">${bodyHTML}</div></div>` : ''}
    </div>`;
}

function selectBody(ctx, { field, options, current }) {
  const opts = (options || []).map(o => `<option value="${ctx.escHtml(o.key ?? o.value)}"${(o.key ?? o.value) === current ? ' selected' : ''}>${ctx.escHtml(o.label)}</option>`).join('');
  return `<select class="form-input" data-field="${field}">${opts}</select>`;
}

function logoViewToggleRow(ctx) {
  const on = ctx.logoView === true;
  return `<div class="control-center-row-wrap" data-row="logo-view">
      <button type="button" class="control-center-row control-center-row--toggle" data-action="cc-toggle-logo-view" role="switch" aria-checked="${on}">
        <span class="cc-row-label">Team logos</span>
        <span class="cc-row-switch" data-on="${on}" aria-hidden="true"></span>
      </button>
      <div class="cc-row-helper text-muted">Show team logos instead of names on Picks and the compact dashboard.</div>
    </div>`;
}

/** DI-303 (six settings rows, Profile excluded per amendment) + DI-307's
 *  Theme gap-fill row + DI-331's Team-logo-view row: Time zone, Notifications,
 *  SCRIBE settings, Chat settings, Game settings, Team logos, Theme. */
export function renderSettingsAccordion(ctx, state) {
  requireFn(ctx.escHtml, 'escHtml', 'renderSettingsAccordion');
  const timeZones = ctx.timeZones || TIME_ZONES;
  const currentTimeZone = ctx.currentTimeZone || DEFAULT_TZ;
  const themes = ctx.themes || THEMES;
  const currentTheme = ctx.currentTheme || 'neutral';
  const openRow = state.settingsOpenRow;

  const rows = [
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'timezone', label: 'Time zone', openRowValue: openRow,
      bodyHTML: selectBody(ctx, { field: 'timezone', options: timeZones, current: currentTimeZone }),
    }),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'notifications', label: 'Notifications', iconName: 'bell', openRowValue: openRow,
      bodyHTML: ctx.bodies?.notifSettingsHTML || '',
    }),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'scribe', label: 'SCRIBE settings', openRowValue: openRow,
      bodyHTML: ctx.bodies?.scribeFileHTML || '',
    }),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'chat', label: 'Chat settings', openRowValue: openRow,
      bodyHTML: ctx.bodies?.chatPrefsHTML || '',
    }),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'game-settings', label: 'Game settings', openRowValue: openRow,
      bodyHTML: ctx.bodies?.gameRequestHTML || '',
    }),
    logoViewToggleRow(ctx),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'theme', label: 'Theme', openRowValue: openRow,
      bodyHTML: selectBody(ctx, { field: 'theme', options: themes, current: currentTheme }),
    }),
  ];
  return `<div class="control-center-group">${rows.join('')}</div>`;
}

// ═════════════════════════════════════════════════════════════════════════
// RENDER — DI-304 Feedback / Rules / Version history + DI-305 Help/footer
// ═════════════════════════════════════════════════════════════════════════

/** Fix round 1, finding 4/5 (coordinator ruling, VERDICT amendment 3):
 *  Feedback is now an ACCORDION ROW embedding `ctx.bodies.feedbackCardHTML`
 *  — same single-open-per-group mechanic as Version history, sharing
 *  `feedbackGroupOpenRow`. Rules stays a plain nav link (unchanged). */
export function renderFeedbackRulesGroup(ctx, state) {
  requireFn(ctx.escHtml, 'escHtml', 'renderFeedbackRulesGroup');
  const openRow = state.feedbackGroupOpenRow;
  const chevron = iconOrNothing(ctx, 'chevronRight');
  return `<div class="control-center-group">
      ${accordionRow(ctx, state, {
        group: 'feedback', rowId: 'feedback', label: 'Feedback', openRowValue: openRow,
        bodyHTML: ctx.bodies?.feedbackCardHTML || '',
      })}
      <button type="button" class="control-center-row control-center-row--nav" data-action="cc-navigate" data-target="rules">
        <span class="cc-row-label">Rules</span>
        <span class="cc-row-chevron" aria-hidden="true">${chevron}</span>
      </button>
      ${accordionRow(ctx, state, {
        group: 'feedback', rowId: 'version-history', label: 'Version history', openRowValue: openRow,
        bodyHTML: ctx.bodies?.releaseNotesHTML || '',
      })}
    </div>`;
}

/** DI-305 — Help Center stub (shared coming-soon pattern) + the
 *  Privacy/legal footer (Terms/Licenses reserved, not invented — DI text). */
export function renderHelpFooter(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderHelpFooter');
  const copy = comingSoonCopy('The Help Center');
  return `<div class="control-center-group">
      <button type="button" class="control-center-row control-center-row--nav" data-action="coming-soon" data-coming-soon-copy="${ctx.escHtml(copy)}">
        <span class="cc-row-label">Help Center</span>
      </button>
    </div>
    <div class="control-center-footer text-muted">
      <a href="privacy.html">Privacy Policy</a>
      <!-- Terms / Licenses reserved for roadmap Phase 7 (App Store submission checklist) — not linked until real content exists (DI-305). -->
    </div>`;
}

function renderMainPaneInnerHTML(ctx, state) {
  return `${renderIdentityHeader(ctx)}${renderStarredPanels(ctx)}${renderSettingsAccordion(ctx, state)}${renderFeedbackRulesGroup(ctx, state)}${renderHelpFooter(ctx)}`;
}

// ═════════════════════════════════════════════════════════════════════════
// TOP-LEVEL RENDER — DI-301 drawer shell. Used by `mountControlCenter()` for
// its ONE full-string build at mount time only (fix round 1, finding 1) —
// never again after that; see the file header.
// ═════════════════════════════════════════════════════════════════════════

export function renderControlCenter(ctx, state) {
  requireFn(ctx.escHtml, 'escHtml', 'renderControlCenter');
  requireFn(ctx.icon, 'icon', 'renderControlCenter');
  const open = isDrawerVisuallyOpen(state);
  const closed = state.phase === 'closed';
  const dragProgress = clamp01(state.dragProgress || 0);

  return `<div id="control-center-backdrop" class="control-center-backdrop" data-action="cc-backdrop" data-open="${open}" aria-hidden="${!open}"></div>
    <div id="control-center" class="control-center" role="dialog" aria-modal="true" aria-label="Control center"
      data-open="${open}" data-pane="${state.pane}" data-phase="${state.phase}" data-dragging="${!!state.dragging}"
      style="--cc-drag-progress:${dragProgress}"
      ${closed ? 'inert' : ''}>
      <div class="control-center-pane" data-pane="main" data-active="${state.pane === 'main'}">
        <button type="button" class="control-center-close" data-action="cc-close" aria-label="Close">${iconOrNothing(ctx, 'close') || '✕'}</button>
        <div class="control-center-pane-content" data-pane-content="main">${renderMainPaneInnerHTML(ctx, state)}</div>
      </div>
      <div class="control-center-pane" data-pane="profile" data-active="${state.pane === 'profile'}">
        <div class="control-center-pane-content" data-pane-content="profile">${renderProfileScreen(ctx)}</div>
      </div>
    </div>`;
}

// ═════════════════════════════════════════════════════════════════════════
// mountControlCenter() — the one DOM-owning integration point.
// ═════════════════════════════════════════════════════════════════════════

export function mountControlCenter(rootEl, ctx, options = {}) {
  if (!rootEl || typeof rootEl.querySelector !== 'function') {
    return { open() {}, close() {}, destroy() {}, update() {}, getState: () => initialControlCenterState() };
  }
  const onAfterPaint = typeof options.onAfterPaint === 'function' ? options.onAfterPaint : null;

  let state = initialControlCenterState();
  let prevVisible = false;
  let fallbackTimer = null;

  // ── ONE-TIME BUILD (fix round 1, finding 1) — never repeated. ────────────
  rootEl.innerHTML = renderControlCenter(ctx, state);
  const backdropEl = rootEl.querySelector('#control-center-backdrop');
  const drawerEl = rootEl.querySelector('#control-center');
  const closeBtnEl = drawerEl?.querySelector('[data-action="cc-close"]') || null;
  const mainPaneWrapEl = drawerEl?.querySelector('[data-pane="main"]') || null;
  const profilePaneWrapEl = drawerEl?.querySelector('[data-pane="profile"]') || null;
  const mainContentEl = drawerEl?.querySelector('[data-pane-content="main"]') || null;
  const profileContentEl = drawerEl?.querySelector('[data-pane-content="profile"]') || null;

  function ownerKey() { return ctx.session?.player?.id ?? null; }

  // Stamp the initial content's owner immediately (fix round 1, finding 9)
  // — there is nothing to CAPTURE yet on this very first build (it came from
  // a fresh render, not a destroyed prior one), but every LATER repaint's own
  // capture step needs a baseline stamp to compare against, per
  // field-preserve.js's rule 2 (an unstamped root always fails the owner
  // check and drops the capture, which would otherwise make the FIRST
  // update()/toggle-row after mount silently unable to preserve anything).
  {
    const key = ownerKey();
    if (key) { stampFieldOwner(mainContentEl, key); stampFieldOwner(profileContentEl, key); }
  }

  function paintMainContent() {
    if (!mainContentEl) return;
    const key = ownerKey();
    const snap = key ? captureDirtyFields(mainContentEl, key) : null;
    mainContentEl.innerHTML = renderMainPaneInnerHTML(ctx, state);
    if (key) { restoreDirtyFields(snap, mainContentEl, key); stampFieldOwner(mainContentEl, key); }
  }
  function paintProfileContent() {
    if (!profileContentEl) return;
    const key = ownerKey();
    const snap = key ? captureDirtyFields(profileContentEl, key) : null;
    profileContentEl.innerHTML = renderProfileScreen(ctx);
    if (key) { restoreDirtyFields(snap, profileContentEl, key); stampFieldOwner(profileContentEl, key); }
  }

  // Fix round 1, finding 8: attribute-only — NEVER touches innerHTML, safe to
  // call on every dispatch including drag-move (1:1 finger tracking via the
  // `--cc-drag-progress` custom property).
  function applyAttributes(next) {
    const open = isDrawerVisuallyOpen(next);
    const dragProgress = clamp01(next.dragProgress || 0);
    backdropEl?.setAttribute('data-open', String(open));
    backdropEl?.setAttribute('aria-hidden', String(!open));
    if (drawerEl) {
      drawerEl.setAttribute('data-open', String(open));
      drawerEl.setAttribute('data-phase', next.phase);
      drawerEl.setAttribute('data-pane', next.pane);
      drawerEl.setAttribute('data-dragging', String(!!next.dragging));
      drawerEl.style.setProperty('--cc-drag-progress', String(dragProgress));
      if (next.phase === 'closed') drawerEl.setAttribute('inert', ''); else drawerEl.removeAttribute('inert');
    }
    mainPaneWrapEl?.setAttribute('data-active', String(next.pane === 'main'));
    profilePaneWrapEl?.setAttribute('data-active', String(next.pane === 'profile'));
  }

  function clearFallback() { if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; } }
  function armFallbackIfNeeded(next) {
    clearFallback();
    if (next.phase === 'opening' || next.phase === 'closing') {
      // Fix round 1, finding 1's own fallback: if the real `transitionend`
      // never arrives (hidden tab, dropped event, no property actually
      // transitioning), the phase machine still advances instead of sticking
      // forever. Reduced motion never reaches this branch (open/close
      // resolve synchronously, no transient phase to time out).
      fallbackTimer = setTimeout(() => { fallbackTimer = null; dispatch({ type: 'transition-end' }); }, DRAWER_MOTION_MS + 40);
    }
  }

  function maybeFocusOnOpen(prev, next) {
    // Fix round 1, finding 8: focus the ✕ ONLY on the closed->open
    // transition, never on every paint (fix round 0 refocused on every
    // paint while any visible phase held, which would steal focus back from
    // a field the player had since tapped inside the drawer).
    if (prev.phase === 'closed' && (next.phase === 'opening' || next.phase === 'open')) {
      closeBtnEl?.focus?.();
    }
  }

  function maybeNotifyVisibility(next) {
    const visible = isDrawerVisuallyOpen(next);
    if (visible !== prevVisible) {
      prevVisible = visible;
      ctx.callbacks?.onDrawerVisibilityChange?.(visible);
    }
  }

  function firePaintHook() {
    if (onAfterPaint) { try { onAfterPaint(rootEl, state); } catch (e) { console.warn('[control-center] onAfterPaint threw', e); } }
  }

  function dispatch(event) {
    const prev = state;
    const next = stepControlCenter(prev, event);
    if (next === prev) return; // true no-op — nothing to paint
    state = next;

    applyAttributes(state);
    maybeFocusOnOpen(prev, state);
    maybeNotifyVisibility(state);

    // Content repaint ONLY for events that actually change what's rendered
    // (fix round 1, finding 8: never on drag-move — attribute-only above).
    if (event.type === 'toggle-row' && (event.group === 'settings' || event.group === 'feedback')) {
      paintMainContent();
    }

    if (event.type === 'open' || event.type === 'close' || event.type === 'transition-end' || event.type === 'drag-end') {
      armFallbackIfNeeded(state);
    }

    firePaintHook();
  }

  function onClick(e) {
    const el = e.target.closest?.('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const rm = () => prefersReducedMotion();
    switch (action) {
      case 'cc-close':
        dispatch({ type: 'close', reducedMotion: rm() });
        break;
      case 'cc-backdrop':
        if (e.target === el) dispatch({ type: 'close', reducedMotion: rm() });
        break;
      case 'cc-push-profile':
        dispatch({ type: 'push-profile' });
        haptic('selection');
        break;
      case 'cc-pop-profile':
        dispatch({ type: 'pop-profile' });
        haptic('selection');
        break;
      case 'cc-toggle-row':
        dispatch({ type: 'toggle-row', group: el.dataset.group, rowId: el.dataset.row });
        haptic('selection');
        break;
      case 'cc-navigate': {
        const target = el.dataset.target;
        dispatch({ type: 'close', reducedMotion: rm() });
        haptic('light');
        ctx.callbacks?.onNavigate?.(target);
        break;
      }
      // S2-3 (full-app review, 2026-09-26) — Sign Out used to leave the
      // drawer OPEN under the sign-in gate: not inert, and back on screen
      // after the next sign-in. Closed first, instantly (the gate paints over
      // it, so there is no slide to watch). app.js also closes it at the
      // identity chokepoint and in the hold sweep, for every other sign-out.
      case 'cc-signout':
        dispatch({ type: 'close', reducedMotion: true });
        ctx.callbacks?.onSignOut?.();
        break;
      // S2-2 (full-app review, 2026-09-26) — the league sheet (z 200) opened
      // UNDER the drawer (z 501). Close the drawer first, the same shape as
      // 'cc-navigate' / 'cc-open-league-page'.
      case 'cc-switch-league':
        dispatch({ type: 'close', reducedMotion: rm() });
        haptic('selection');
        ctx.callbacks?.onSwitchLeague?.();
        break;
      // SECURITY GATE FINDING 3 (2026-09-25) — the identity header's league
      // name tap. Closes the drawer first (same shape as 'cc-navigate' just
      // above) — League Page is a full-screen overlay, and leaving the
      // drawer open behind it would stack two dismissable surfaces.
      case 'cc-open-league-page':
        dispatch({ type: 'close', reducedMotion: rm() });
        haptic('selection');
        ctx.callbacks?.onOpenLeaguePage?.();
        break;
      // DI-335/DI-340 (2026-09-25) — both open a full modal sheet in app.js
      // (the identical `.modal-overlay.centered`/`.modal` idiom
      // `showAccountSheet()` already uses), not a drawer pane — closing the
      // drawer first matches the 'cc-navigate'/'cc-open-league-page' shape.
      case 'cc-open-password-change':
        dispatch({ type: 'close', reducedMotion: rm() });
        haptic('selection');
        ctx.callbacks?.onOpenPasswordChange?.();
        break;
      case 'cc-open-delete-account':
        dispatch({ type: 'close', reducedMotion: rm() });
        haptic('selection');
        ctx.callbacks?.onOpenDeleteAccount?.();
        break;
      case 'cc-toggle-logo-view':
        ctx.callbacks?.onSetLogoView?.(!(ctx.logoView === true));
        haptic('selection');
        break;
      case 'cc-save-profile': {
        const val = (field) => profileContentEl?.querySelector(`[data-field="${field}"]`)?.value ?? '';
        ctx.callbacks?.onSaveDisplayName?.(val('display-name'));
        ctx.callbacks?.onSaveInitials?.(val('initials'));
        ctx.callbacks?.onSaveAlmaMater?.(val('alma-mater'));
        haptic('success');
        break;
      }
      // 'coming-soon' is intentionally NOT handled here — app.js must CREATE
      // one shared document-level delegated handler for every
      // `[data-action="coming-soon"]` stub in the app (WIRING_CHECKLIST —
      // fix round 1 correction: none exists yet, fix round 0 wrongly assumed
      // one did).
      default:
        break;
    }
  }

  function onChange(e) {
    const el = e.target.closest?.('[data-field]');
    if (!el) return;
    if (el.dataset.field === 'timezone') ctx.callbacks?.onSetTimeZone?.(el.value);
    else if (el.dataset.field === 'theme') ctx.callbacks?.onSetTheme?.(el.value);
  }

  function focusableEls(container) {
    return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled);
  }

  function onKeydown(e) {
    if (!(state.phase === 'open' || state.phase === 'opening')) return;
    if (e.key === 'Escape') {
      dispatch({ type: 'close', reducedMotion: prefersReducedMotion() });
      return;
    }
    if (e.key === 'Tab') {
      const pane = state.pane === 'profile' ? profilePaneWrapEl : mainPaneWrapEl;
      if (!pane) return;
      const els = focusableEls(pane);
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function onTransitionEnd(e) {
    if (e.target === drawerEl && e.propertyName === 'transform') {
      clearFallback();
      dispatch({ type: 'transition-end' });
    }
  }

  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('transitionend', onTransitionEnd);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeydown);

  const unbindSwipe = bindControlCenterEdgeSwipe(
    dispatch,
    () => state,
    { getWidthPx: () => drawerEl?.getBoundingClientRect?.().width || DRAWER_MAX_WIDTH_PX },
  );

  // Initial paint hook — the coordinator's bind functions need a first call
  // too, not only after a later dispatch.
  firePaintHook();

  return {
    open: () => { haptic('light'); dispatch({ type: 'open', reducedMotion: prefersReducedMotion() }); },
    // `{ immediate: true }` (S2-3, 2026-09-26) — teardown callers (sign-out,
    // the hold sweep) close without the slide: a gate is painting over it.
    close: ({ immediate = false } = {}) => dispatch({ type: 'close', reducedMotion: immediate || prefersReducedMotion() }),
    /** Fix round 1, finding 2. Re-render both panes' CONTENT against a fresh
     *  `ctx` (an async body resolving, a toggle flipping, a new session
     *  read) — the phase/pane/open-row state is untouched. */
    update: (nextCtx) => {
      ctx = nextCtx;
      paintMainContent();
      paintProfileContent();
      firePaintHook();
    },
    destroy: () => {
      clearFallback();
      rootEl.removeEventListener('click', onClick);
      rootEl.removeEventListener('change', onChange);
      rootEl.removeEventListener('transitionend', onTransitionEnd);
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown);
      unbindSwipe();
    },
    getState: () => ({ ...state }),
  };
}
