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
 *   `haptic()`               — js/haptics.js
 *   `prefersReducedMotion()`, `AXIS_DEAD_ZONE_PX`, `isInDrawerOpenZone()`
 *                            — js/nav-gestures.js (NOT `gesturesSuspended` —
 *                              see finding 3 above). `isInDrawerOpenZone()`
 *                              replaces the original `WEEK_SWIPE_EDGE_EXCLUDE_PX`
 *                              import per DI-419 (2026-09-28) — see note 1,
 *                              amended, below.
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
 *     gameRequestHTML,     // renderGameRequestCardHTML() verbatim — DI-422:
 *                           // now embedded under the row label "Request a
 *                           // game" (was "Game settings"), unchanged body
 *     releaseNotesHTML,    // renderReleaseNotesCardHTML() verbatim
 *     almaMaterOptionsHTML, // DI-423 AMENDMENT (2026-09-28) — the Profile
 *                           // pane's alma-mater field's <option> list, built
 *                           // by app.js's buildAlmaMaterOptions(player.almaMater,
 *                           // cachedEspnTeamsList()||ALMA_MATERS) — the EXACT
 *                           // same call chat-ui.js's registerAlmaMaterOptionsProvider()
 *                           // wires for the chat-prefs picker, and the same
 *                           // builder the Comm -> Players -> Edit modal calls.
 *                           // One implementation, three call sites — never a
 *                           // second dropdown.
 *   },
 *   timeZones = TIME_ZONES, currentTimeZone = DEFAULT_TZ,   // DI-303 row
 *   themes = THEMES, currentTheme = 'neutral',               // DI-307 gap-fill row
 *   logoView = false,                                        // DI-331c row
 *   callbacks: {
 *     onSignOut,                                              // DI-302, now in Profile (DI-421)
 *     onOpenLeaguesHome,      // DI-418 (amends DI-302's "Switch League" row) —
 *                              // Profile's "Your Leagues" row; PUSHES the new
 *                              // Leagues Home overlay, replacing the old
 *                              // onSwitchLeague/showLeagueSelectorSheet() action
 *     onOpenLeaguePage,           // SECURITY GATE FINDING 3 (2026-09-25) — the identity header's league-name tap
 *     onOpenLeagueSettings,       // SP-53 / DI-457 (2026-10-01) — the "League" group's League Settings row (renderLeagueGroup())
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
 * DI-419 (2026-09-28) — `options.getTab()` (optional, defaults to `() =>
 * null`) is threaded straight through to `bindControlCenterEdgeSwipe()`'s
 * own `opts.getTab`, so the drawer's edge-swipe arm check can read the
 * CURRENT tab (`document.body.dataset.tab`, js/app.js) fresh on every touch.
 *
 * ── NAMED DEVIATIONS / GAPS, per this thread's own "flag, don't silently
 *    resolve" discipline (matching the DI's own §14/§15 sections; fix-round-1
 *    corrections are marked as such where they supersede a fix-round-0 note) ──
 *
 * 1. DI-301's own text proposes a 24px left-edge zone, "tunable." By the time
 *    this pass builds, `js/nav-gestures.js` already shipped
 *    `WEEK_SWIPE_EDGE_EXCLUDE_PX = 28` with the comment "left-edge zone
 *    reserved for T-13's drawer." This module reused that constant
 *    (`DRAWER_EDGE_ZONE_PX = WEEK_SWIPE_EDGE_EXCLUDE_PX`) rather than
 *    re-declaring 24, per the coordinator's own task instruction.
 *    AMENDED by DI-419 (2026-09-28, Drew ruling A): both the fixed pixel
 *    zone AND `DRAWER_EDGE_ZONE_PX` itself are RETIRED — the drawer's own
 *    arm check now calls the ONE shared `isInDrawerOpenZone()`
 *    (js/nav-gestures.js) directly, a 25%-of-viewport fraction on Picks/
 *    Dashboard and "anywhere" on every other tab, per Drew's own ruling.
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
 *    Time zone, Notifications, SCRIBE settings, Chat settings, Request a game,
 *    Team logos, Theme, Appearance, Commissioner/Admin/Super Admin panel rows,
 *    Help Center, Feedback, Rules, Version history — each an owed Phase-2
 *    glyph. **DI-422 (2026-09-28):** Notifications no longer renders `bell` —
 *    "no other button has an icon" (Drew) — so `bell` is currently unused by
 *    any row; kept in `KNOWN_ICONS` for whichever future row earns it back,
 *    not removed from the icon family. `almaMater` is used by the Profile
 *    pane's alma-mater field. `chevronRight` is reused for every
 *    disclosure/expand chevron.
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
 *
 * 8. **UX Revamp v0.27.2 batch (2026-09-28) — DI-418/DI-421/DI-422/DI-423.**
 *    Four changes folded in this pass, each at its own render function:
 *      - DI-418: the drawer's "Switch League" row is GONE from the identity
 *        header. Its replacement, "Your Leagues", now lives in the Profile
 *        pane (DI-421) and pushes app.js's new Leagues Home overlay via
 *        `onOpenLeaguesHome` — never `showLeagueSelectorSheet()`, which stays
 *        the header pill's own job (`onOpenLeaguePage`'s sibling, wired in
 *        app.js, outside this module).
 *      - DI-421: `renderIdentityHeader()` no longer renders
 *        `control-center-identity-actions` AT ALL — Sign Out and Your Leagues
 *        moved into `renderProfileScreen()`, gated on the SAME
 *        `ctx.accountRows === true` flag (Supabase auth mode only — a
 *        local-PIN device has no Supabase session to leave and no
 *        multi-league concept). REVIEWER ROUND 2 minor finding (RG-298,
 *        2026-09-28) — the now-dead `.control-center-identity-actions` CSS
 *        rule is DELETED (`css/styles.css`), including the
 *        `hotfix/cc-alma-admin` alignment edit to that same rule — nothing
 *        renders the class on either side of that merge.
 *      - REVIEWER ROUND 2 D1 (RG-298, 2026-09-28) — Profile's row order is
 *        now Your Leagues (WITH the same drill-in chevron Password/Rules
 *        carry) -> Password -> Sign Out -> Delete Account LAST in the danger
 *        zone. A drill-in (Your Leagues, Password) never sits below a
 *        destructive, divider-fenced action — Sign Out moved out of its own
 *        trailing block (which used to render AFTER Password/Delete Account)
 *        to sit between Password and the danger zone instead.
 *      - DI-422: `renderSettingsAccordion()` now emits a LABELED "My
 *        Preferences" group (Time zone -> Notifications -> Chat settings ->
 *        Team logos -> Theme -> Appearance, Drew's own order) followed by an
 *        UNLABELED group holding SCRIBE settings alone (omitted from "My
 *        Preferences" — Drew's six-item list doesn't name it, and it is pilot
 *        training-data plumbing, not an everyday preference). Team logos is
 *        reshaped from a bespoke always-visible toggle row into the SAME
 *        `accordionRow()` shape every other row uses — tap to expand, body
 *        holds the switch AND the helper caption (previously always
 *        visible). Notifications drops `iconName:'bell'`. Appearance's
 *        school-theme caption moves from the row's collapsed label line into
 *        its body, above the `<select>`. `renderFeedbackRulesGroup()` gains
 *        its own "Help & Feedback" label and now ALSO holds "Request a game"
 *        (renamed from "Game settings", moved out of the Preferences group)
 *        and "Help Center" (pulled up from `renderHelpFooter()`, which now
 *        renders only the Privacy Policy footer link) — all five rows
 *        (Request a game, Feedback, Rules, Version history, Help Center)
 *        share ONE single-open-per-group state (`feedbackGroupOpenRow`),
 *        unchanged mechanism, wider membership.
 *      - DI-423 (Rules page): out of this file's scope — `js/app.js`'s
 *        `renderRulesPage()` drops its Alma Maters section entirely, and its
 *        dated AMENDMENT (RG-290 finding) turns the Profile pane's
 *        alma-mater field from a free-text `<input>` into the SAME ESPN
 *        `<select>` the chat-prefs picker and Comm -> Players -> Edit use —
 *        see `renderProfileScreen()`'s own comment and `ctx.bodies.almaMaterOptionsHTML`
 *        in the ctx contract above.
 */

import { haptic } from './haptics.js';
import { prefersReducedMotion, AXIS_DEAD_ZONE_PX, isInDrawerOpenZone, touchClaimedBy, clearStaleTouchClaim, claimTouch, releaseTouchAndFlush, DRAWER_TOUCH_OWNER } from './nav-gestures.js';
import { comingSoonCopy } from './leagues-home.js';
import { getShellBrandName } from './brand.js';
import { TIME_ZONES, DEFAULT_TZ, THEMES, THEME_GROUP_LABELS } from './data-model.js';
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
// N1 (DI-432 §7, 2026-09-30) — the pilot-only registry's one predicate (renderIdentityHeader()'s league-name fallback).
import { isPilotOnlyAllowed } from './pilot-only.js';
// === SOCIAL PLATFORM NEWS (SP-07, DI-379, 2026-10-01) -- BEGIN (one of the banner-delimited News edits in this file: the third pane, its row, its taps) ===
// The News pane's markup, its nav row and the tap -> preference-PATCH reducer live in js/newsSettings.js (pure; it escapes every team name with its OWN
// quote-complete esc(), so this file's `ctx.escHtml` never touches one). This file only dispatches, paints and wires.
import { renderNewsNavRow, renderNewsSettingsPane, newsPatchFor } from './newsSettings.js';
// === SOCIAL PLATFORM NEWS -- END ===

// ═════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════

/** DI-301 native layout: 85vw, capped at 340px (guards iPad-class widths). */
export const DRAWER_WIDTH_VW = 85;
export const DRAWER_MAX_WIDTH_PX = 340;

/**
 * DI-419 (2026-09-28, Drew ruling A) amends file-header note 1: the fixed
 * 28px `DRAWER_EDGE_ZONE_PX` pixel zone is RETIRED. The drawer's own arm
 * check now calls `isInDrawerOpenZone()` (imported above) directly, at
 * `bindControlCenterEdgeSwipe()`'s own call site — the ONE shared predicate
 * DI-419 establishes, not a second, independently-tuned pixel constant.
 */

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
const KNOWN_ICONS = new Set(['bell', 'almaMater', 'chevronRight', 'chevronLeft', 'sportFootball', 'settings', 'close', 'sun', 'moon']);
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
    // RG-278 (live v0.27.0 web, 2026-09-28) — `dragProgress` is not only the
    // drag's value: css/styles.css positions #control-center ONLY through
    // `--cc-drag-progress` (fully open = 1, fully closed = 0), so every
    // open/close must SETTLE it too. The tap path used to change `phase`
    // alone: data-open="true" faded the scrim in while the panel stayed at
    // translateX(-100%) — "grays out the screen but no control center pops
    // up" — and a swipe-opened drawer closed by ✕ stayed on screen, inert.
    // (drag-end settles its own 1/0 and then re-enters here; same value.)
    case 'open': {
      if (state.phase === 'open' || state.phase === 'opening') return state;
      return { ...state, phase: event.reducedMotion ? 'open' : 'opening', dragProgress: 1 };
    }
    case 'close': {
      // SB-15 (2026-10-01) — a close ALWAYS ends a drag. A drag whose
      // touchend never reached the binder (a repaint replaced the node under
      // the finger) left `dragging` true at phase 'closed' — and the guard
      // just below made ✕, the scrim and every app-side close a no-op, while
      // SB-05's data-dragging lock froze the page. Exactly what releasing
      // that drag toward "closed" does (drag-end → settle 0 → close).
      if (state.dragging) {
        return stepControlCenter(state, { type: 'drag-end', settleOpen: false, reducedMotion: event.reducedMotion });
      }
      if (state.phase === 'closed' || state.phase === 'closing') return state;
      const reducedMotion = !!event.reducedMotion;
      return {
        ...state,
        phase: reducedMotion ? 'closed' : 'closing',
        pane: reducedMotion ? 'main' : state.pane,
        dragProgress: 0,
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
    // === SOCIAL PLATFORM NEWS -- BEGIN === the third pushed pane, mirroring push-profile / pop-profile (only main -> news, only news -> main).
    case 'push-news':
      if (state.phase !== 'open') return state;
      if (state.pane !== 'main') return state;
      return { ...state, pane: 'news' };
    case 'pop-news':
      if (state.pane !== 'news') return state;
      return { ...state, pane: 'main' };
    // === SOCIAL PLATFORM NEWS -- END ===
    case 'drag-start':
      if (state.dragging) return state;
      // v0.27.1 round 2 (reviewer finding 7) — keep the SETTLED progress
      // (1 once open/opening, 0 once closed/closing, since RG-278) rather than
      // deriving it from `phase === 'open'`, which snapped a drag caught
      // during the 260 ms "opening" slide back to 0 for a frame.
      return { ...state, dragging: true, dragProgress: clamp01(state.dragProgress || 0) };
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
      dragProgress: state.dragProgress,
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

/**
 * v0.27.1 round 2 (reviewer condition 1) — the SCRIM's own predicate, which
 * deliberately differs from isDrawerVisuallyOpen() in exactly one phase:
 * 'closing'. The drawer must still count as present while it slides out (so
 * no other gesture arms mid-slide), but the scrim has to START fading the
 * moment the close starts, alongside the panel — driving it from
 * isDrawerVisuallyOpen() held it fully dark for the whole 260 ms slide and
 * only then faded it (a dark screen with no panel on it: RG-278 in reverse).
 */
export function isScrimShown(state) {
  if (!state) return false;
  if (state.phase === 'open' || state.phase === 'opening') return true;
  return !!state.dragging && state.dragProgress > 0;
}

// ═════════════════════════════════════════════════════════════════════════
// PURE GESTURE MATH — DI-301's native edge-swipe / drag-to-close.
//
// DI-419 (2026-09-28, Drew ruling A) — the fixed-28px `_isWithinEdgeZone()`
// predicate that used to live here is RETIRED: `bindControlCenterEdgeSwipe()`
// below now calls the ONE shared `isInDrawerOpenZone()` (js/nav-gestures.js)
// directly at its own touchstart handler, rather than a second,
// independently-tuned local pixel check.
// ═════════════════════════════════════════════════════════════════════════

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
  // DI-418 (2026-09-28) — the Leagues Home overlay (`showLeaguesHomeOverlay()`,
  // js/app.js) is a THIRD full-screen surface with its own native swipe-back
  // (mirrors showLeaguePageOverlay() byte-for-byte), same reasoning as the
  // League Page/wizard entries just above.
  if (document.getElementById?.('leagues-home-overlay')) return true;
  // UN-389 / DI-446 (2026-09-30) — the Delete Account sheet left `.modal-overlay` for the shared sheet shell; the drawer's edge swipe must not arm under it (one owner per touch).
  if (document.getElementById?.('pwacct-delete-overlay')) return true;
  return false;
}

/**
 * DOM binder — gesture-DETECTION layer only. `dispatch` (REQUIRED) is the
 * only side effect; `getState` (REQUIRED) must return the CURRENT state
 * synchronously. `opts.getWidthPx` reads the drawer's live rendered width.
 * `opts.getTab` (DI-419, 2026-09-28) returns the CURRENT active tab —
 * `isInDrawerOpenZone()`'s own contract, re-read fresh on every touchstart
 * (same "re-derive fresh state on every touch" discipline `getState`/
 * `getWidthPx` already follow); a missing/omitted `getTab` reads as `null`,
 * which `isInDrawerOpenZone()` treats as "not picks/dashboard" — i.e.
 * "anywhere" — preserving today's exact behavior for any caller that hasn't
 * wired it yet.
 *
 * REVIEWER ROUND 2 (B3 BLOCK, coordinator ruling, 2026-09-28) — AMENDS
 * DI-301's own native-only carve-out ("web gets tap-only, no edge-swipe"),
 * dated here. Drew tests on the home-screen WEB app and asked for "swipe
 * from left to right" there too; with DI-419's yield NOT itself gated on
 * `isNativeShell()` (js/nav-gestures.js's `bindWeekSwipe()` never was —
 * see that function's own header), a native-only drawer binder left the
 * entire left 25% of Picks/Dashboard on web a dead zone: week-swipe
 * yielded to a drawer gesture that would never arm to claim it. The
 * drawer's own open/close CSS transition and tap-to-open trigger
 * (`#control-center-trigger`) already exist identically on web — this
 * binder is the ONLY piece that was native-gated, and no longer is. Same
 * predicate/zone on both platforms; the standalone-PWA note: Safari's own
 * system back-swipe lives at the physical bezel, this zone starts just
 * inside it, so the two do not compete for the same first few pixels.
 */
export function bindControlCenterEdgeSwipe(dispatch, getState, opts = {}) {
  if (typeof dispatch !== 'function' || typeof getState !== 'function') return () => {};
  const getWidthPx = typeof opts.getWidthPx === 'function' ? opts.getWidthPx : () => DRAWER_MAX_WIDTH_PX;
  const getTab = typeof opts.getTab === 'function' ? opts.getTab : () => null;

  let start = null, axis = null, dragActive = false, progressAtStart = 0;
  let lastX = 0, lastT = 0, velocityPxPerMs = 0;

  function viewportWidthPx() {
    return (typeof window !== 'undefined' && typeof window.innerWidth === 'number') ? window.innerWidth : 0;
  }

  /** SB-15 (2026-10-01) — a drag whose END never reached this binder. A fresh
   *  ONE-finger touchstart begins a new gesture (a live drag would still have
   *  its finger down: touches.length ≥ 2), so a drawer still `dragging` here
   *  lost its release — the node under the finger was replaced by a repaint
   *  outside the deferral door, or the app was backgrounded. Cancel it the
   *  native way (a cancelled pan returns to where it began: an opening drag
   *  closes, a closing drag reopens), with no haptic — nothing was released.
   *  Before this, a touch in the edge zone reset `dragActive` WITHOUT ending
   *  the drag, so the drawer stayed stranded for good, and one outside the
   *  zone settled it at ITS end with the lost drag's velocity. */
  function cancelStrandedDrag() {
    const state = getState();
    if (state.dragging) {
      dispatch({ type: 'drag-end', settleOpen: state.phase === 'open' || state.phase === 'opening', reducedMotion: prefersReducedMotion() });
    }
    start = null; axis = null; dragActive = false; velocityPxPerMs = 0;
  }

  function onTouchStart(e) {
    clearStaleTouchClaim(e);   // RG-TBD-A2 — see nav-gestures.js
    if ((e?.touches?.length ?? 0) === 1) cancelStrandedDrag();   // SB-15
    if (isBlockedByOtherSurface()) { start = null; return; }
    const t = e.touches?.[0];
    if (!t) return;
    const state = getState();
    const phaseOpen = state.phase === 'open';
    // DI-419 §Arbitration — "bindControlCenterEdgeSwipe()'s touchstart-time
    // arm check (!phaseOpen && !isInDrawerOpenZone(...)) is unchanged in
    // shape — the drawer only ever arms for a touch starting in-zone, as
    // today." Arm from the shared zone when closed (opening drag); arm
    // ANYWHERE on the open drawer when open (DI-301: "dragging the open
    // drawer left closes it the same way" — and per finding 3, the drawer
    // being open never blocks its OWN gesture from arming).
    // REVIEWER ROUND 2 (B1/B2) — `target: e.target` lets the SAME arm
    // check refuse when the touch starts on a chat message (bindMessageSwipe()'s
    // reply swipe wins outright — B1: a fast L→R drag on a bubble used to
    // arm BOTH gestures) or a horizontal scroller/text field with
    // somewhere to scroll back to (B2). Only consulted here in the CLOSED
    // branch — an open drawer still closes from anywhere, unaffected,
    // exactly as the comment above already promises.
    if (!phaseOpen && !isInDrawerOpenZone({ tab: getTab(), clientX: t.clientX, viewportWidthPx: viewportWidthPx(), target: e.target })) { start = null; return; }
    start = { x: t.clientX, y: t.clientY };
    axis = null;
    dragActive = false;
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
      // RG-TBD-A2 — another recognizer already owns this touch (the compact
      // Dashboard's long-press reorder, or a week swipe that locked first):
      // the drawer never starts a drag on it. A reorder drag from a chip in
      // the left quarter used to open the drawer.
      // SB-15 (2026-10-01) — and when nobody does, the drawer now CLAIMS it
      // (the week swipe's model): one owner per touch, and while it is the
      // drawer's, renderPicksPage()/renderDashboard() park their repaint
      // (nav-gestures.js deferRenderWhileWeekSwiping()) instead of replacing
      // the node under the finger — which is what lost this drag's touchend.
      // Only a drag that can MOVE the drawer commits to it: a leftward drag
      // on a closed drawer clamps to 0 (DI-419's R→L carve-out belongs to the
      // week swipe), so it claims nothing and keeps the old stand-down rule.
      if (axis === 'x') {
        const canMove = dx > 0 || clamp01(getState().dragProgress || 0) > 0;
        if (canMove ? !claimTouch(DRAWER_TOUCH_OWNER) : touchClaimedBy() !== null) { start = null; return; }
      }
      if (axis === 'x') {
        dragActive = true; dispatch({ type: 'drag-start' });
        // Round 2 (finding 7) — continue from where the panel IS (drag-start
        // keeps the settled progress): 0 closed, 1 open, 1 mid-"opening".
        progressAtStart = clamp01(getState().dragProgress || 0);
      }
    }
    if (axis !== 'x' || !dragActive) return;
    const widthPx = Math.max(1, getWidthPx() || DRAWER_MAX_WIDTH_PX);
    const progress = clamp01(progressAtStart + dx / widthPx);
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
    // SB-15 — the touch is over: hand it back and run any repaint parked
    // under the drag (after the drawer has settled). No-op if not ours.
    releaseTouchAndFlush(DRAWER_TOUCH_OWNER);
  }

  // SB-15 — the week swipe's c7f8bee safety net, for the same reason: if the
  // app is backgrounded mid-drag iOS may never deliver the touch's end. On
  // the way back (hidden → visible) and on pagehide, cancel the stranded drag
  // and run any repaint parked under it — no finger is on the glass then.
  function recoverAbandonedDrag() {
    cancelStrandedDrag();
    releaseTouchAndFlush(DRAWER_TOUCH_OWNER);
  }
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') recoverAbandonedDrag();
  };
  const canDoc = typeof document !== 'undefined' && typeof document.addEventListener === 'function';

  const target = typeof window !== 'undefined' ? window : null;
  if (!target) return () => {};
  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: true });
  target.addEventListener('touchend', settle, { passive: true });
  target.addEventListener('touchcancel', settle, { passive: true });
  target.addEventListener('pagehide', recoverAbandonedDrag);
  if (canDoc) document.addEventListener('visibilitychange', onVisibility);

  return () => {
    target.removeEventListener('touchstart', onTouchStart);
    target.removeEventListener('touchmove', onTouchMove);
    target.removeEventListener('touchend', settle);
    target.removeEventListener('touchcancel', settle);
    target.removeEventListener('pagehide', recoverAbandonedDrag);
    if (canDoc) document.removeEventListener('visibilitychange', onVisibility);
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

/** DI-302 — identity block (avatar/name/league/chips/version). Fix round 1,
 *  finding 5: the "View league as" row (fix round 0's own optional addition)
 *  is REMOVED entirely — not in the DI, not in the amendment; see
 *  file-header note 3. **DI-421 (2026-09-28):** the Sign out / Switch league
 *  action rows that used to sit directly under this block are GONE — they
 *  now live in the pushed Profile pane (`renderProfileScreen()`, below), one
 *  deliberate tap deeper, per file-header note 8. */
export function renderIdentityHeader(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderIdentityHeader');
  const player = ctx.session?.player || {};
  const name = ctx.escHtml(player.displayName || '');
  // N1 (DI-432 §7) — the fallback league name is the pilot league's own name ONLY for the pilot; any other league whose name has not loaded reads a neutral "Your league".
  const leagueName = ctx.escHtml(ctx.league?.name || (isPilotOnlyAllowed('irbCopy', ctx.league) ? "IRB Pick'Ems" : 'Your league'));
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
 *  session cannot say. The rows render only in Supabase auth mode.
 *
 *  DI-423 AMENDMENT (2026-09-28, RG-290 finding) — the alma-mater field is
 *  now the SAME ESPN `<select>` (with the "— None —" option) the chat-prefs
 *  picker (`js/chat-ui.js`'s `prefsPanelHTML()`) and the Comm -> Players ->
 *  Edit modal (`showEditPlayerModal()`) use — `ctx.bodies.almaMaterOptionsHTML`,
 *  built by app.js's ONE `buildAlmaMaterOptions()` implementation, injected
 *  the same way every other `ctx.bodies.*` string is (never re-implemented
 *  here). A free-text `<input>` here regressed Drew's 2026-09-04 "Do the
 *  dropdown" ruling (UN-133) — a typed name that doesn't match ESPN's exact
 *  spelling matched nothing anywhere claimedAlmaMaters() is read. Saving is
 *  UNCHANGED — `cc-save-profile` reads `[data-field="alma-mater"]`'s `.value`
 *  exactly as it did for the `<input>`, which a `<select>` also carries; the
 *  value still reaches `onSaveAlmaMater` -> app.js's `patchPlayer()`.
 *
 *  DI-421 (2026-09-28), REORDERED by reviewer BLOCK D1 (RG-298, 2026-09-28) —
 *  "Your Leagues" (`profileAccountActionsHTML()`, below) now renders FIRST,
 *  ABOVE `accountRowsHTML()`'s Password/Sign Out/Delete Account sequence —
 *  see D1's own reasoning at `accountRowsHTML()`'s doc comment. Both share
 *  the SAME `ctx.accountRows` gate — see file-header note 8. */
/**
 * RG-TBD-B3 (bug batch B, 2026-09-29) — the ONE copy source for the caption
 * under the control-center alma-mater pickers (Profile's #cc-field-alma-note,
 * Chat settings' #pref-alma-note); js/app.js picks the status. Every string is
 * ONE line at the drawer's width (shellrendertest [F] measures it), so the
 * reserved line box never grows. "Reopen to retry" is literal: a failed or
 * partial load retries the next time the picker is opened (app.js
 * bindControlCenterBodies()), which stays true when iOS merely backgrounds
 * the app. Plain concatenation, no markup — callers escape or set textContent.
 */
export function almaCatalogNoteText(status, { count = 0, got = 0 } = {}) {
  switch (status) {
    case 'loaded': return 'All ' + Number(count) + ' schools, from ESPN.';
    case 'partial': return 'Only ' + Number(got) + ' of ' + Number(count) + ' schools loaded. Reopen to retry.';
    case 'failed': return 'Couldn’t reach ESPN — short list. Reopen to retry.';
    default: return 'Loading every school…';
  }
}

export function renderProfileScreen(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderProfileScreen');
  const player = ctx.session?.player || {};
  const almaIcon = iconOrNothing(ctx, 'almaMater');
  const backIcon = iconOrNothing(ctx, 'chevronLeft');
  // RG-TBD-B3 (2026-09-29) — the picker's one-line caption (almaCatalogNoteText()
  // below, chosen by app.js; patched in place when the fetch settles). Its
  // line box is RESERVED (.alma-catalog-note, css/styles.css) so the Save
  // button never moves when the caption arrives or changes.
  const almaNote = ctx.bodies?.almaMaterNoteText || '';
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
        <select class="form-input" id="cc-field-alma-mater" data-field="alma-mater">${ctx.bodies?.almaMaterOptionsHTML || ''}</select>
        <p class="text-muted text-xs mt-sm alma-catalog-note" id="cc-field-alma-note" role="status">${ctx.escHtml(almaNote)}</p>
      </div>
      <button type="button" class="btn btn-primary btn-block" data-action="cc-save-profile">Save</button>
      <!-- UX Revamp Group F (DI-335/DI-340, 2026-09-25) — account-identity
           rows, below the Save button, per DI-335's own placement note.
           See this function's own JSDoc header for the "Password" label's
           reasoning (a JS comment, not an HTML one — this whole function
           body is one template literal, and a stray backtick in an inline
           HTML comment here previously broke the module's own parse). -->
      ${ctx.accountRows === true && ctx.membershipsResolved !== false ? profileAccountActionsHTML(ctx) : ''}
      ${ctx.accountRows === true ? accountRowsHTML(ctx) : ''}
    </div>`;
}

/**
 * DI-421 (2026-09-28) — "Your Leagues" (DI-418's renamed/repointed "Switch
 * League" row), relocated out of the drawer's identity header
 * (`renderIdentityHeader()`, above) into the Profile pane. REVIEWER BLOCK D1
 * (RG-298, 2026-09-28) — now carries the SAME drill-in chevron every other
 * navigating row in this pane has (`accountRowsHTML()`'s Password row,
 * `renderFeedbackRulesGroup()`'s Rules row) — a row that pushes to a whole
 * new screen (Leagues Home) is a drill-in, same shape as those, not a plain
 * action like Sign Out. Gated on the SAME `ctx.accountRows === true` flag
 * `accountRowsHTML()` checks — no new flag for THAT half: in local-PIN mode
 * there is no multi-league concept to switch between. The CALLER
 * (`renderProfileScreen()`) additionally gates this row on
 * `ctx.membershipsResolved !== false` (DI-418's own "hide Your Leagues
 * while memberships unresolved" record item, implemented — reviewer round
 * 2, RG-298) — the same "hold the slot empty rather than guess" rule
 * DI-184c's header-pill gate already applies, so a not-yet-loaded
 * membership list never shows a Leagues Home destination that would open
 * to nothing.
 */
function profileAccountActionsHTML(ctx) {
  const chevron = iconOrNothing(ctx, 'chevronRight');
  return `<button type="button" class="control-center-row control-center-row--action" data-action="cc-open-leagues-home">
        <span class="cc-row-label">Your Leagues</span>
        <span class="cc-row-chevron" aria-hidden="true">${chevron}</span>
      </button>`;
}

/**
 * STEP B(7) / N4 (3c fix window, third pass) — the Password / Sign Out /
 * Delete Account rows. Rendered ONLY when `ctx.accountRows === true`
 * (Supabase auth mode): Password/Delete Account act on a Supabase account
 * and could only fail anywhere else ("a control that cannot do what it says
 * is worse than no control", DI-335); Sign Out has no session to leave.
 * Missing flag = hidden. The Password row is a drill-in, so it carries the
 * same chevron every other drill-in row does; its label follows DI-335
 * ("Change Password" / "Set Password"), neutral "Password" when the session
 * cannot tell (`ctx.hasPasswordIdentity` null/absent).
 *
 * REVIEWER BLOCK D1 (RG-298, 2026-09-28) — Sign Out moved from a separate
 * `profileAccountActionsHTML()` block (below "Your Leagues", after Password)
 * to HERE, between Password and the danger zone: Password → Sign Out →
 * Delete Account. Delete Account is now unambiguously LAST — a drill-in
 * (Password) never sat below a destructive, divider-fenced action to begin
 * with, but Sign Out used to (it rendered in a SEPARATE block after this
 * one, i.e. visually below Delete Account) — reordered so the danger zone
 * is the true end of the pane, matching iOS Settings.app's own convention
 * that destructive actions anchor the bottom.
 */
function accountRowsHTML(ctx) {
  const chevron = iconOrNothing(ctx, 'chevronRight');
  const label = ctx.hasPasswordIdentity === true ? 'Change Password'
    : ctx.hasPasswordIdentity === false ? 'Set Password' : 'Password';
  return `<button type="button" class="control-center-row control-center-row--action" data-action="cc-open-password-change">
        <span class="cc-row-label">${ctx.escHtml(label)}</span>
        <span class="cc-row-chevron" aria-hidden="true">${chevron}</span>
      </button>
      <button type="button" class="control-center-row control-center-row--action" data-action="cc-signout">
        <span class="cc-row-label">Sign Out</span>
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

/**
 * `secondary` (carry-over, app-shell part 3A review, 2026-09-27) — an
 * OPTIONAL short explanatory line under the row's own label, rendered as
 * `<span class="cc-row-secondary">` (the CSS pass owns that class's styling —
 * not added here, same "markup now, styling in the CSS pass" split DI-391's
 * own label/secondary debt already uses). `undefined`/`''` renders nothing,
 * so every existing accordionRow() call site is unaffected. It had one
 * consumer, the Appearance row's school-theme note, retired by SP-52 (DI-447,
 * 2026-10-01: every theme has both sides, so there is nothing to explain);
 * the parameter stays for a future row, with no caller today.
 */
function accordionRow(ctx, state, { group, rowId, label, iconName, bodyHTML, openRowValue, secondary }) {
  requireFn(ctx.escHtml, 'escHtml', 'accordionRow');
  const open = openRowValue === rowId;
  const iconHTML = iconOrNothing(ctx, iconName);
  return `<div class="control-center-row-wrap" data-row="${rowId}">
      <button type="button" class="control-center-row" data-action="cc-toggle-row" data-group="${group}" data-row="${rowId}" aria-expanded="${open}">
        ${iconHTML ? `<span class="cc-row-icon">${iconHTML}</span>` : ''}
        <span class="cc-row-label">${ctx.escHtml(label)}${secondary ? `<span class="cc-row-secondary">${ctx.escHtml(secondary)}</span>` : ''}</span>
        <span class="cc-row-chevron" data-expanded="${open}" aria-hidden="true">${iconOrNothing(ctx, 'chevronRight')}</span>
      </button>
      ${open ? `<div class="control-center-row-body" id="cc-body-${rowId}"><div class="control-center-row-body-inner">${bodyHTML}</div></div>` : ''}
    </div>`;
}

/**
 * SP-52 (DI-447, 2026-10-01) — an option list whose entries carry a `group`
 * (the Theme list: THEMES[].group) renders as native <optgroup>s, in order of
 * first appearance, so iOS shows the wheel with `Munera / Neutral / School
 * colors` as non-selectable headers (the native control, no custom picker). An
 * option list without `group` (the time zone list) renders exactly as before.
 * Every label — option and group — goes through ctx.escHtml.
 */
function selectBody(ctx, { field, options, current, disabled }) {
  const opt = (o) => `<option value="${ctx.escHtml(o.key ?? o.value)}"${(o.key ?? o.value) === current ? ' selected' : ''}>${ctx.escHtml(o.label)}</option>`;
  const list = options || [];
  const inner = list.some((o) => o.group)
    ? [...new Set(list.map((o) => o.group))].map((g) => `<optgroup label="${ctx.escHtml(THEME_GROUP_LABELS[g] || g)}">${list.filter((o) => o.group === g).map(opt).join('')}</optgroup>`).join('')
    : list.map(opt).join('');
  return `<select class="form-input" data-field="${field}"${disabled ? ' disabled' : ''}>${inner}</select>`;
}

/** DI-422 finding 12 — Team logos, reshaped INTO `accordionRow()`'s own
 *  body slot (was a bespoke always-visible toggle row with its helper caption
 *  rendered unconditionally beneath the label). The row now behaves like
 *  every other settings row: tap the header to expand, and BOTH the switch
 *  control and the helper text live in the body, hidden while collapsed.
 *  Markup is otherwise byte-identical to the old `logoViewToggleRow()` —
 *  this is a relocation into a collapsible body, not a new control. */
function teamLogosBodyHTML(ctx) {
  const on = ctx.logoView === true;
  return `<button type="button" class="control-center-row control-center-row--toggle" data-action="cc-toggle-logo-view" role="switch" aria-checked="${on}">
      <span class="cc-row-label">Team logos</span>
      <span class="cc-row-switch" data-on="${on}" aria-hidden="true"></span>
    </button>
    <div class="cc-row-helper text-muted">Show team logos instead of names on Picks and the compact dashboard.</div>`;
}

/** SP-52 (DI-447, 2026-10-01) — the Appearance row is ONE live
 *  `<select data-field="colorScheme">` (System / Light / Dark) under EVERY
 *  Theme. It used to be disabled under a school theme with the caption "Night
 *  mode is available with the Munera theme" (DI-422 finding 12 moved that
 *  caption into this body; DI-360 / finding 6 had disabled it, because night
 *  mode's CSS was scoped to `body.theme-neutral` only). Every school theme has
 *  a Dark side now (DI-451), so neither the disabled state nor the caption has
 *  a reason to exist. Theme and Appearance are independent axes: changing
 *  Theme never writes `colorScheme`, changing Appearance never writes `theme`.
 *  `accordionRow()`'s `secondary` parameter stays (no caller today). */
function appearanceBodyHTML(ctx) {
  return selectBody(ctx, {
    field: 'colorScheme',
    options: [{ key: 'system', label: 'System' }, { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }],
    current: ctx.currentColorScheme || 'system',
  });
}

/**
 * DI-422 (UN-377, 2026-09-28) — "Time zone, notifications, chat settings,
 * team logos, theme and appearance should be listed under the header 'My
 * Preferences'" (Drew, verbatim, that exact order). Notifications drops its
 * `bell` icon ("no other button has an icon" — Drew). SCRIBE settings is
 * DELIBERATELY OMITTED from this group — Drew's six-item list doesn't name
 * it, and it is pilot-league training-data plumbing, not an everyday
 * preference — but it is NOT deleted: it renders in its own unlabeled group
 * directly below "My Preferences", exactly where it already was, still
 * gated by its own pilot-only visibility (DI-365).
 */
export function renderSettingsAccordion(ctx, state) {
  requireFn(ctx.escHtml, 'escHtml', 'renderSettingsAccordion');
  const timeZones = ctx.timeZones || TIME_ZONES;
  const currentTimeZone = ctx.currentTimeZone || DEFAULT_TZ;
  const themes = ctx.themes || THEMES;
  const currentTheme = ctx.currentTheme || 'neutral';
  const openRow = state.settingsOpenRow;

  const preferenceRows = [
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'timezone', label: 'Time zone', openRowValue: openRow,
      bodyHTML: selectBody(ctx, { field: 'timezone', options: timeZones, current: currentTimeZone }),
    }),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'notifications', label: 'Notifications', openRowValue: openRow,
      bodyHTML: ctx.bodies?.notifSettingsHTML || '',
    }),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'chat', label: 'Chat settings', openRowValue: openRow,
      bodyHTML: ctx.bodies?.chatPrefsHTML || '',
    }),
    // === SOCIAL PLATFORM NEWS -- BEGIN === a NAV row (label + chevron) that pushes the News pane, not an accordion row; absent when ctx.news is absent (the feature is off app-wide).
    ...(ctx.news ? [renderNewsNavRow()] : []),
    // === SOCIAL PLATFORM NEWS -- END ===
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'logo-view', label: 'Team logos', openRowValue: openRow,
      bodyHTML: teamLogosBodyHTML(ctx),
    }),
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'theme', label: 'Theme', openRowValue: openRow,
      bodyHTML: selectBody(ctx, { field: 'theme', options: themes, current: currentTheme }),
    }),
    // DI-360 (2026-09-27) — Munera night mode, Phase 1: System/Light/Dark,
    // same accordion-row/selectBody() shape as Theme just above (reuse, not
    // a new control pattern). `ctx.currentColorScheme` defaults to 'system'
    // — matching getColorScheme()'s own default-when-missing.
    //
    // SP-52 (DI-447, 2026-10-01) — LIVE UNDER EVERY THEME. The Finding-6
    // reasoning that used to stand here (night mode scoped to the Munera
    // theme, so the control was disabled and explained under a school theme)
    // is superseded: Munera, Paper, Ink, Graphite and all six schools have a
    // Dark side. The quick Light/Dark toggle at the top of the drawer
    // (DI-452) is the one-tap path; this row stays the full three-way control.
    accordionRow(ctx, state, {
      group: 'settings', rowId: 'appearance', label: 'Appearance', openRowValue: openRow,
      bodyHTML: appearanceBodyHTML(ctx),
    }),
  ];

  // SCRIBE settings — deliberately OUTSIDE "My Preferences" (see this
  // function's own doc comment) but still part of the SAME single-open
  // 'settings' group/state, so opening it still closes whichever Preferences
  // row was open, matching every other row's single-open-per-group behavior.
  const scribeRow = accordionRow(ctx, state, {
    group: 'settings', rowId: 'scribe', label: 'SCRIBE settings', openRowValue: openRow,
    bodyHTML: ctx.bodies?.scribeFileHTML || '',
  });

  return `<div class="control-center-group">
      <div class="control-center-group-label">My Preferences</div>
      ${preferenceRows.join('')}
    </div>
    <div class="control-center-group">${scribeRow}</div>`;
}

// ═════════════════════════════════════════════════════════════════════════
// RENDER — DI-304 Feedback / Rules / Version history, DI-422 "Help & Feedback"
// ═════════════════════════════════════════════════════════════════════════

/**
 * Fix round 1, finding 4/5 (coordinator ruling, VERDICT amendment 3):
 * Feedback is an ACCORDION ROW embedding `ctx.bodies.feedbackCardHTML` — same
 * single-open-per-group mechanic as Version history, sharing
 * `feedbackGroupOpenRow`. Rules stays a plain nav link (unchanged).
 *
 * DI-422 (UN-377, 2026-09-28) — this group now carries its OWN header, "Help
 * & Feedback" (Drew asked for "a header for this grouping" without naming
 * one; recommended per the coordinator's own reasoning in the DI — every row
 * is either asking-for-something or giving-feedback, Rules is the one loose
 * fit but Drew explicitly sequenced it here). Two rows join the group,
 * sharing the SAME `feedbackGroupOpenRow` single-open state as
 * Feedback/Version history:
 *   - "Request a game" (renamed from "Game settings", `rowId` kept as
 *     `game-settings` — same `ctx.bodies.gameRequestHTML`, unchanged body —
 *     moved out of "My Preferences", ABOVE Feedback per Drew's own sequence:
 *     "request a game and place it above feedback, rules, and version
 *     history").
 *   - "Help Center" (pulled UP from `renderHelpFooter()`, which now renders
 *     only the Privacy Policy footer link — see that function, below).
 */
export function renderFeedbackRulesGroup(ctx, state) {
  requireFn(ctx.escHtml, 'escHtml', 'renderFeedbackRulesGroup');
  const openRow = state.feedbackGroupOpenRow;
  const chevron = iconOrNothing(ctx, 'chevronRight');
  // Named `copy`, matching renderHelpFooter()'s own former local — this row
  // MOVED from that function (DI-422), same variable name, same XSS-sweep
  // pin (xsstest.mjs's NEW_SWEPT_BACKLOG "ctx.escHtml(copy)" entry) rather
  // than a renamed one requiring a second, independently-reviewed pin.
  const copy = comingSoonCopy('The Help Center');
  return `<div class="control-center-group">
      <div class="control-center-group-label">Help &amp; Feedback</div>
      ${accordionRow(ctx, state, {
        group: 'feedback', rowId: 'game-settings', label: 'Request a game', openRowValue: openRow,
        bodyHTML: ctx.bodies?.gameRequestHTML || '',
      })}
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
      <button type="button" class="control-center-row control-center-row--nav" data-action="coming-soon" data-coming-soon-copy="${ctx.escHtml(copy)}">
        <span class="cc-row-label">Help Center</span>
        <span class="cc-row-chevron" aria-hidden="true">${chevron}</span>
      </button>
    </div>`;
}

/** DI-305, amended by DI-422 (2026-09-28) — the Help Center row MOVED into
 *  `renderFeedbackRulesGroup()`'s "Help & Feedback" group, above. This
 *  function now renders only the Privacy/legal footer (Terms/Licenses
 *  reserved, not invented — DI text). */
export function renderHelpFooter(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderHelpFooter');
  return `<div class="control-center-footer text-muted">
      <a href="privacy.html">Privacy Policy</a>
      <!-- Terms / Licenses reserved for roadmap Phase 7 (App Store submission checklist) — not linked until real content exists (DI-305). -->
    </div>`;
}

// ═════════════════════════════════════════════════════════════════════════
// SP-53 / DI-457 (2026-10-01) — THE "LEAGUE" GROUP. One row, between the starred panels (Commissioner Panel, Admin) and My Preferences: "League Settings", its secondary line the ACTIVE
// league's name so a multi-league player knows which one it opens. It opens the SAME page the League Page's last row opens, for the active league only (DI-312: to change another league,
// switch first). Rendered only when the account rows are (Supabase auth mode: local PIN mode has no leagues), memberships have resolved (`!== false`, the Profile rows' gate) and an active
// league is resolved (`ctx.league`): it is ABSENT, not disabled, otherwise. The league name is user data and goes through ctx.escHtml in a text node and a double-quoted attribute only.
// ═════════════════════════════════════════════════════════════════════════
export function renderLeagueGroup(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderLeagueGroup');
  if (ctx.accountRows !== true || ctx.membershipsResolved === false || !ctx.league || !ctx.league.id) return '';
  const chevron = iconOrNothing(ctx, 'chevronRight');
  const name = String(ctx.league.name || '').trim();
  return `<div class="control-center-group" data-cc-group="league">
      <div class="control-center-group-label">League</div>
      <button type="button" class="control-center-row control-center-row--nav cc-league-row" data-action="cc-open-league-settings" aria-label="Open League Settings for ${ctx.escHtml(name || 'your league')}">
        <span class="cc-row-label">League Settings${name ? `<span class="cc-row-secondary">${ctx.escHtml(name)}</span>` : ''}</span>
        <span class="cc-row-chevron" aria-hidden="true">${chevron}</span>
      </button>
    </div>`;
}

// ═════════════════════════════════════════════════════════════════════════
// RENDER — SP-52 / DI-452 — the QUICK LIGHT/DARK TOGGLE
// ═════════════════════════════════════════════════════════════════════════
//
// A TWO-STATE control over a THREE-STATE preference (the shipped System / Light / Dark `colorScheme`). Two segments, never three:
// "System" is the caption plus a "Match my phone" link back. Pinned directly under the identity block so it is above the fold on
// open, on web and on the iOS shell alike. Apple's HIG advises following the system appearance and not adding an app-specific
// control; Drew ruled for one (2026-09-30, recorded deviation), mitigated by the System default, the honest caption and the
// one-tap return. The Appearance row in My Preferences stays as the full three-way control.
//
// Tapping a segment ALWAYS leaves System, including when it equals what the phone already shows (that is how someone pins "always
// Dark"). The only routes back are "Match my phone" and Appearance -> System. Rejected, recorded so they are not re-proposed:
// auto-heal to System when a pin equals the phone's appearance (an app that flips at sunset with no tap is unpredictable), and iOS
// Control Center's "until the next automatic change" (a per-player stored value conditional on a per-device event is a hidden state).

/** Pure: what the quick row shows for a stored preference and the phone's own appearance. */
export function quickAppearanceModel({ scheme = 'system', systemIsDark = false } = {}) {
  const pinned = scheme === 'light' || scheme === 'dark';
  const checked = pinned ? scheme : (systemIsDark ? 'dark' : 'light');
  return {
    pinned,
    checked,
    showReturn: pinned,
    caption: pinned ? (scheme === 'dark' ? 'Set to Dark' : 'Set to Light')
                    : `Matches your phone \u00b7 ${checked === 'dark' ? 'Dark' : 'Light'} right now`,
  };
}

/** Signed out: not rendered, no device write (UN-127 kept; a shared handset must not let any one of six people repaint it). All
 *  strings are fixed (nothing user-supplied) and still go through ctx.escHtml. */
export function renderQuickAppearance(ctx) {
  requireFn(ctx.escHtml, 'escHtml', 'renderQuickAppearance');
  if (!ctx.session?.player) return '';
  const m = quickAppearanceModel({ scheme: ctx.currentColorScheme || 'system', systemIsDark: !!ctx.systemIsDark });
  const seg = (v, label, iconName) => `<button type="button" role="radio" class="cc-quick-seg" data-action="cc-quick-scheme" data-scheme="${ctx.escHtml(v)}" aria-checked="${m.checked === v}" tabindex="${m.checked === v ? 0 : -1}"${m.checked === v ? ' aria-describedby="cc-quick-cap"' : ''}>${iconOrNothing(ctx, iconName)}<span>${ctx.escHtml(label)}</span></button>`;
  return `<div class="cc-quick" id="cc-quick-appearance">
      <div class="cc-quick-track" role="radiogroup" aria-label="Appearance">${seg('light', 'Light', 'sun')}${seg('dark', 'Dark', 'moon')}</div>
      <div class="cc-quick-cap"><span id="cc-quick-cap" aria-live="polite">${ctx.escHtml(m.caption)}</span><button type="button" class="cc-quick-return" data-action="cc-quick-scheme" data-scheme="system" aria-label="Match my phone's appearance"${m.showReturn ? '' : ' hidden'}>Match my phone</button></div>
    </div>`;
}

/** Update the quick row IN PLACE (F4): rewrites only aria-checked / tabindex / aria-describedby on the two segment nodes, the
 *  caption's textContent, the return button's `hidden`, and (when the Appearance row is open) the three-way <select>'s value. It
 *  never assigns innerHTML — the existing onSetColorScheme ends in a pane repaint that replaces the tapped segment and drops
 *  VoiceOver focus, so the quick row uses its own path. If the return button holds focus when it hides, focus moves to the
 *  checked segment FIRST, so VoiceOver announces "Dark, radio button, selected, 1 of 2" instead of losing its place. Returns
 *  true when the quick row was found. */
export function patchQuickAppearance(rootEl, ctx, { activeEl } = {}) {
  const wrap = rootEl?.querySelector?.('#cc-quick-appearance');
  if (!wrap) return false;
  const m = quickAppearanceModel({ scheme: ctx.currentColorScheme || 'system', systemIsDark: !!ctx.systemIsDark });
  const segs = [...(wrap.querySelectorAll?.('.cc-quick-seg') || [])];
  let checkedSeg = null;
  segs.forEach((seg) => {
    const on = seg.dataset?.scheme === m.checked;
    seg.setAttribute('aria-checked', String(on));
    seg.setAttribute('tabindex', on ? '0' : '-1');
    if (on) { seg.setAttribute('aria-describedby', 'cc-quick-cap'); checkedSeg = seg; }
    else seg.removeAttribute('aria-describedby');
  });
  const cap = wrap.querySelector('#cc-quick-cap');
  if (cap) cap.textContent = m.caption;
  const ret = wrap.querySelector('.cc-quick-return');
  if (ret) {
    const active = activeEl !== undefined ? activeEl : (typeof document !== 'undefined' ? document.activeElement : null);
    if (!m.showReturn && active === ret) checkedSeg?.focus?.();
    if (m.showReturn) ret.removeAttribute('hidden'); else ret.setAttribute('hidden', '');
  }
  const sel = rootEl.querySelector('select[data-field="colorScheme"]');
  if (sel) sel.value = ctx.currentColorScheme || 'system';
  return true;
}

// v0.29.0 batch-5b integration (2026-10-01): SP-52's quick row sits directly under the identity block (DI-452) and SP-53's League group between the
// starred panels and My Preferences (DI-457) — both placements hold.

// === SOCIAL PLATFORM NEWS -- BEGIN === DI-379's `renderNewsSettingsScreen(ctx)`: the pushed pane's content, '' when ctx.news is absent.
export function renderNewsSettingsScreen(ctx) {
  if (!ctx || !ctx.news) return '';
  return renderNewsSettingsPane({ ...ctx.news, catalogNote: ctx.bodies?.almaMaterNoteText || '' });
}
// === SOCIAL PLATFORM NEWS -- END ===

function renderMainPaneInnerHTML(ctx, state) {
  return `${renderIdentityHeader(ctx)}${renderQuickAppearance(ctx)}${renderStarredPanels(ctx)}${renderLeagueGroup(ctx)}${renderSettingsAccordion(ctx, state)}${renderFeedbackRulesGroup(ctx, state)}${renderHelpFooter(ctx)}`;
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
  const scrim = isScrimShown(state);
  const closed = state.phase === 'closed';
  const dragProgress = clamp01(state.dragProgress || 0);

  return `<div id="control-center-backdrop" class="control-center-backdrop" data-action="cc-backdrop" data-open="${scrim}" aria-hidden="${!scrim}"></div>
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
      <div class="control-center-pane" data-pane="news" data-active="${state.pane === 'news'}">
        <div class="control-center-pane-content" data-pane-content="news">${renderNewsSettingsScreen(ctx)}</div>
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
  // DI-419 (2026-09-28) — threaded straight through to bindControlCenterEdgeSwipe()'s
  // own `opts.getTab`, below, so the drawer's touchstart-time arm check can
  // read the CURRENT tab fresh on every touch (js/app.js supplies this via
  // `document.body.dataset.tab`, the same source navigateTo() itself writes).
  const getTab = typeof options.getTab === 'function' ? options.getTab : () => null;

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
  // === SOCIAL PLATFORM NEWS -- BEGIN === the third pane's stable nodes, built exactly like the profile pane's.
  const newsPaneWrapEl = drawerEl?.querySelector('[data-pane="news"]') || null;
  const newsContentEl = drawerEl?.querySelector('[data-pane-content="news"]') || null;
  // === SOCIAL PLATFORM NEWS -- END ===

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
    if (key) { stampFieldOwner(mainContentEl, key); stampFieldOwner(profileContentEl, key); stampFieldOwner(newsContentEl, key); }
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
  // === SOCIAL PLATFORM NEWS -- BEGIN ===
  function paintNewsContent() {
    if (!newsContentEl) return;
    const key = ownerKey();
    const snap = key ? captureDirtyFields(newsContentEl, key) : null;
    newsContentEl.innerHTML = renderNewsSettingsScreen(ctx);
    if (key) { restoreDirtyFields(snap, newsContentEl, key); stampFieldOwner(newsContentEl, key); }
  }
  /**
   * Reviewer F1 (2026-10-01). ESPN's full school list lands IN PLACE (app.js patches the picker's <option>s and writes its caption as text), so the live DOM is AHEAD of this
   * closure's ctx, which was built from the short fallback list and "Loading every school…". A chip add / remove repaints the pane from that ctx, and without this the picker
   * dropped back to the short list and the caption lied. Before any such repaint the live picker's options and its caption are ABSORBED into ctx: options not already in the
   * catalog are added to it (the followed teams were excluded from the live list on purpose, so `alsoKnown` re-adds a team that is being removed and must be offered again),
   * and the live caption becomes the note — unless it is the "most teams" message, which is a state of the pane and not a catalog note. An `update()` from the host replaces ctx
   * wholesale and needs none of this.
   */
  function absorbLiveNewsPicker(alsoKnown) {
    if (!newsContentEl || !ctx.news) return;
    const catalog = Array.isArray(ctx.news.catalog) ? ctx.news.catalog.slice() : [];
    const have = new Set(catalog.map((c) => String(c.location).toLowerCase()));
    const sel = newsContentEl.querySelector('#cc-news-team-add');
    const found = [];
    if (sel) {
      for (const o of Array.from(sel.querySelectorAll('option'))) {
        // Named optValue, not `v`: xsstest's classifier resolves an identifier file-wide by name, and SP-52's quick-appearance seg(v, ...) parameter is `v` (merge finding, 2026-10-01).
        const optValue = o.getAttribute('value');
        if (optValue) found.push({ location: optValue, displayName: (typeof o.textContent === 'string' && o.textContent) || optValue });
      }
    }
    if (alsoKnown && alsoKnown.location) found.push(alsoKnown);
    let grew = false;
    for (const c of found) {
      const k = String(c.location).toLowerCase();
      if (have.has(k)) continue;
      have.add(k); catalog.push(c); grew = true;
    }
    if (grew) ctx = { ...ctx, news: { ...ctx.news, catalog } };
    const note = newsContentEl.querySelector('#cc-news-team-note');
    const max = Number.isInteger(ctx.news.maxTeams) && ctx.news.maxTeams > 0 ? ctx.news.maxTeams : 20;
    const full = Array.isArray(ctx.news.teams) && ctx.news.teams.length >= max;
    if (note && !full && typeof note.textContent === 'string' && note.textContent) ctx = { ...ctx, bodies: { ...(ctx.bodies || {}), almaMaterNoteText: note.textContent } };
  }
  /** Reviewer F5: after a chip is removed (or one is added) the node the player was on is gone — put keyboard and VoiceOver focus back on something real: the chip that took its
   *  place, else the last chip, else the picker. */
  function refocusNewsPane(index) {
    if (!newsContentEl) return;
    const chips = Array.from(newsContentEl.querySelectorAll('[data-action="cc-news-remove-team"]'));
    const target = (index >= 0 && (chips[index] || chips[chips.length - 1])) || newsContentEl.querySelector('#cc-news-team-add');
    if (target && typeof target.focus === 'function') target.focus();
  }
  // === SOCIAL PLATFORM NEWS -- END ===

  // Fix round 1, finding 8: attribute-only — NEVER touches innerHTML, safe to
  // call on every dispatch including drag-move (1:1 finger tracking via the
  // `--cc-drag-progress` custom property).
  function applyAttributes(next) {
    const open = isDrawerVisuallyOpen(next);
    const scrim = isScrimShown(next);
    const dragProgress = clamp01(next.dragProgress || 0);
    backdropEl?.setAttribute('data-open', String(scrim));
    backdropEl?.setAttribute('aria-hidden', String(!scrim));
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
    newsPaneWrapEl?.setAttribute('data-active', String(next.pane === 'news'));    // SOCIAL PLATFORM NEWS
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
      // === SOCIAL PLATFORM NEWS -- BEGIN === the News pane. Push / pop mirror Profile's (selection haptic). A SWITCH flips in place (aria-checked + data-on, so the
      // shipped 150 ms switch transition plays -- a repaint would replace the node and snap it), the local ctx.news follows, and the write is the callback's;
      // only a TEAM change is structural and repaints the pane. The reducer (newsPatchFor) returns null for anything it does not own, so a stray event writes nothing.
      case 'cc-push-news':
        dispatch({ type: 'push-news' });
        haptic('selection');
        ctx.callbacks?.onOpenNews?.();
        break;
      case 'cc-pop-news':
        dispatch({ type: 'pop-news' });
        haptic('selection');
        break;
      case 'cc-news-toggle-on':
      case 'cc-news-toggle-sport': {
        const patch = newsPatchFor(action, ctx.news, { sport: el.dataset.sport });
        if (!patch) break;
        const nowOn = action === 'cc-news-toggle-on' ? patch.on === true : patch.sports.indexOf(el.dataset.sport) >= 0;   // from the patch, never from the DOM
        el.setAttribute('aria-checked', String(nowOn));
        el.querySelector('.cc-row-switch')?.setAttribute('data-on', String(nowOn));
        ctx = { ...ctx, news: { ...ctx.news, ...patch } };
        haptic('selection');
        ctx.callbacks?.onSetNewsPrefs?.(patch);
        break;
      }
      case 'cc-news-remove-team': {
        const team = el.dataset.team;
        const patch = newsPatchFor(action, ctx.news, { team });
        if (!patch) break;
        const index = newsContentEl ? Array.from(newsContentEl.querySelectorAll('[data-action="cc-news-remove-team"]')).indexOf(el) : -1;
        const labelEl = el.querySelector('.news-chip__label');
        absorbLiveNewsPicker({ location: team, displayName: (labelEl && typeof labelEl.textContent === 'string' && labelEl.textContent) || team });
        ctx = { ...ctx, news: { ...ctx.news, ...patch } };
        paintNewsContent();
        refocusNewsPane(index);
        haptic('light');
        ctx.callbacks?.onSetNewsPrefs?.(patch);
        break;
      }
      // === SOCIAL PLATFORM NEWS -- END ===
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
      // DI-418/DI-421 (2026-09-28) — "Your Leagues" (Profile pane), replacing
      // the retired 'cc-switch-league' row/action. Pushes app.js's new full-
      // screen Leagues Home overlay — same "close the drawer first" shape as
      // 'cc-navigate'/'cc-open-league-page' (S2-2's own reasoning: a
      // full-screen surface must never open UNDER the still-open drawer).
      case 'cc-open-leagues-home':
        dispatch({ type: 'close', reducedMotion: rm() });
        haptic('selection');
        ctx.callbacks?.onOpenLeaguesHome?.();
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
      // SP-53 / DI-457 (2026-10-01) — the "League" group's League Settings row: the SAME close-the-drawer-first shape as the league-name tap above (a full-screen surface must never
      // open UNDER the still-open drawer); the selection haptic is the page-entry haptic (DI-457), fired here and not again by the page.
      case 'cc-open-league-settings':
        dispatch({ type: 'close', reducedMotion: rm() });
        haptic('selection');
        ctx.callbacks?.onOpenLeagueSettings?.();
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
      // ══ SP-52 / DI-452 (2026-10-01) — THE QUICK LIGHT/DARK TOGGLE ═══════════════════════════════════════════
      // One write path (the callback -> applyColorSchemeChoice), then an IN-PLACE patch: no innerHTML, no pane
      // repaint (so the tapped node and VoiceOver focus survive). A selection haptic on every state CHANGE
      // (including pinning and Match my phone; native only — haptic() is the guard), none on a no-op tap.
      case 'cc-quick-scheme': {
        const want = el.dataset.scheme;
        if (want !== 'light' && want !== 'dark' && want !== 'system') break;
        const r = ctx.callbacks?.onQuickColorScheme?.(want);
        if (r?.changed) haptic('selection');
        if (r) { ctx = { ...ctx, currentColorScheme: r.scheme }; patchQuickAppearance(mainContentEl, ctx); }
        break;
      }
      // ══ end SP-52 / DI-452 ═══════════════════════════════════════════════════════════════════════════════
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
    else if (el.dataset.field === 'colorScheme') ctx.callbacks?.onSetColorScheme?.(el.value);
    // === SOCIAL PLATFORM NEWS -- BEGIN === the team picker: a chosen school becomes a chip (structural, so the pane repaints and the select returns to its placeholder).
    else if (el.dataset.field === 'news-add-team') {
      const patch = newsPatchFor('cc-news-add-team', ctx.news, { value: el.value });
      if (!patch) { el.value = ''; return; }
      absorbLiveNewsPicker();
      ctx = { ...ctx, news: { ...ctx.news, ...patch } };
      paintNewsContent();
      refocusNewsPane(-1);
      haptic('selection');
      ctx.callbacks?.onSetNewsPrefs?.(patch);
    }
    // === SOCIAL PLATFORM NEWS -- END ===
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
      const pane = state.pane === 'profile' ? profilePaneWrapEl : state.pane === 'news' ? newsPaneWrapEl : mainPaneWrapEl;   // SOCIAL PLATFORM NEWS: the third pane
      if (!pane) return;
      const els = focusableEls(pane);
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  // SP-52 / DI-452 — radio-group keyboard behaviour on the quick row: Arrow keys move AND commit (the next segment is focused,
  // then clicked, so the one onClick path handles it); Space/Enter activate the focused <button> natively. Roving tabindex means
  // the checked segment is the tab stop.
  function onQuickKeydown(e) {
    const track = e.target?.closest?.('.cc-quick-track');
    if (!track) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const segs = [...track.querySelectorAll('.cc-quick-seg')];
    const here = e.target.closest('.cc-quick-seg');
    const i = segs.indexOf(here);
    if (i < 0 || segs.length < 2) return;
    e.preventDefault();
    const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
    const next = segs[(i + dir + segs.length) % segs.length];
    next.focus?.();
    next.click?.();
  }

  function onTransitionEnd(e) {
    if (e.target === drawerEl && e.propertyName === 'transform') {
      clearFallback();
      dispatch({ type: 'transition-end' });
    }
  }

  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('keydown', onQuickKeydown);
  rootEl.addEventListener('transitionend', onTransitionEnd);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeydown);

  const unbindSwipe = bindControlCenterEdgeSwipe(
    dispatch,
    () => state,
    { getWidthPx: () => drawerEl?.getBoundingClientRect?.().width || DRAWER_MAX_WIDTH_PX, getTab },
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
      paintNewsContent();                                                       // SOCIAL PLATFORM NEWS
      firePaintHook();
    },
    destroy: () => {
      clearFallback();
      rootEl.removeEventListener('click', onClick);
      rootEl.removeEventListener('change', onChange);
      rootEl.removeEventListener('keydown', onQuickKeydown);
      rootEl.removeEventListener('transitionend', onTransitionEnd);
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown);
      unbindSwipe();
    },
    getState: () => ({ ...state }),
    /** SP-52 / DI-452 — the phone-initiated case: the phone's own appearance changed while the drawer is open
     *  (`{ systemIsDark }`), so the highlight and caption must stay true. Same in-place patch, no repaint. */
    setQuickAppearance: (partial = {}) => { ctx = { ...ctx, ...partial }; patchQuickAppearance(mainContentEl, ctx); },
  };
}
