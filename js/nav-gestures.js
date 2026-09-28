/**
 * js/nav-gestures.js — the shared scroll-gesture module (DI-322/323/324/325/
 * 326/327's shared-architecture section, UX Revamp group A2, 2026-09-24).
 *
 * ZERO dependencies beyond DOM APIs, `isNativeShell()` from js/platform.js,
 * and `haptic()` from js/haptics.js (itself zero-dependency beyond
 * platform.js). ZERO top-level side effects — same discipline as
 * platform.js/supabase-backend.js: nothing runs on import, every gesture is
 * armed only when its own `bind*` function is called from app.js's boot
 * sequence (or, for the week-swipe binder, whenever B-02 lands and the
 * coordinator wires it).
 *
 * Every gesture below shares ONE gating function (`gesturesSuspended()`)
 * and ONE pair of axis-lock constants (`AXIS_DEAD_ZONE_PX` / `SWIPE_COMMIT_PX`,
 * duplicated — not imported — from `js/chat-ui.js`'s `LONG_PRESS_THRESHOLD_PX`
 * (8) / `SWIPE_THRESHOLD_PX` (40); the DI left the export-vs-duplicate choice
 * to feature-builder and this file takes the duplicate path so this module
 * stays a true leaf with no dependency on chat-ui.js — the VALUES match
 * exactly, checked by navgesturestest.mjs).
 *
 * Every DOM binder here is a small, testable shell around a PURE state
 * machine (`step*` functions, each also exported as a `_*StateMachine(events)`
 * batch-runner for navgesturestest.mjs) — mirroring the shape already proven
 * by chat-ui.js's `bindMessageSwipe`/`bindMessageActionsLongPress`
 * (`touchstart`/`touchmove`/`touchend`, `{ passive: true }`, dead-zone-then-
 * axis-lock). This is "Familiar > Novel" applied to this file's OWN code, not
 * just to what it asks callers to do.
 *
 * WIRING NOTE for whoever wires this into app.js/chat-ui.js/index.html/
 * styles.css (the coordinator, per this pass's scope — see the handoff
 * checklist): every binder below only touches the DOM nodes it is
 * explicitly given (a scroll element, a target element) or a CSS class it
 * toggles (`nav-hidden` on `.bottom-nav`, `data-keyboard-up` on `body`). It
 * never reaches into app.js's `state` object and never calls an app.js
 * render function directly — every "do the actual navigation/refresh" step
 * is a caller-supplied callback, per the DI's own "do NOT wire it" / "it
 * CALLS a supplied refresh function, never reloads" instructions.
 */
import { isNativeShell } from './platform.js';
import { haptic } from './haptics.js';

// ─────────────────────────────────────────────────────────────────────────
// Shared constants — every timing/threshold value here is named against the
// Interaction Principles' §Motion System ranges or the DI's own worked
// numbers, never an ad-hoc literal.
// ─────────────────────────────────────────────────────────────────────────

/** Reused from chat-ui.js's LONG_PRESS_THRESHOLD_PX — see file header. */
export const AXIS_DEAD_ZONE_PX = 8;
/** Reused from chat-ui.js's SWIPE_THRESHOLD_PX — see file header. */
export const SWIPE_COMMIT_PX = 40;

// DI-322 (T-24 NAV-HIDE-ON-SCROLL)
export const NAV_HIDE_DOWN_PX = 24;      // cumulative downward scroll to hide
export const NAV_SHOW_UP_PX = 4;         // any upward tick past this shows
export const NAV_ALWAYS_VISIBLE_NEAR_TOP_PX = 120; // 2 * --nav-height (60px, css/styles.css:25)
export const NAV_HIDE_SHOW_MS = 240;     // Motion System Navigation range 220-300ms

// DI-323 (T-25 NAV-KEYBOARD-AVOID)
export const KEYBOARD_VIEWPORT_DELTA_PX = 100; // visualViewport height drop treated as "keyboard up"

// DI-324 (T-26 PULL-TO-REFRESH)
export const PULL_TO_REFRESH_ARM_PX = 64; // 8x8, the Philosophy's own 8-pt grid
export const PULL_TO_REFRESH_SUCCESS_FADE_MS = 200;

// DI-325 (T-27 WEEK-SWIPE)
export const WEEK_SWIPE_EDGE_EXCLUDE_PX = 28; // left-edge zone reserved for T-13's drawer
export const WEEK_SWIPE_BOUNCE_MAX_PX = 12;   // edge-of-list rubber-band bounce-back
export const WEEK_SWIPE_BOUNCE_MS = 150;

// DI-327 (T-29 SCROLL-BOUNCE)
export const RUBBER_BAND_CAP_PX = 24;
export const RUBBER_BAND_SPRING_MS = 200; // release snap, Navigation range rounded down

// ─────────────────────────────────────────────────────────────────────────
// gesturesSuspended() — the ONE gating flag every gesture below checks.
// ─────────────────────────────────────────────────────────────────────────

/**
 * True when ANY of: the sign-in gate is up, a modal is open, or the per-game
 * chat sheet is open. A future control-center drawer (T-13) adds itself to
 * this list when it ships — one function, one source of truth, so that
 * surface only has to flip one flag instead of teaching every gesture
 * handler about itself individually (per the DI's own instruction).
 *
 * AMENDED (reviewer BLOCK, fix round 1, item 2 — DESIGN_INPUTS_A2 §DI-322 is
 * now amended): the on-screen keyboard is NOT a suspension. `gesturesSuspended()`
 * forces the nav VISIBLE, which is the wrong direction for a keyboard —
 * `body[data-keyboard-up]` is instead fed directly into T-24's own reducer
 * as an always-HIDDEN input (see `isKeyboardUp()` and the `'keyboard'` event
 * branch of `stepNavShowHide()` below), never through this function.
 */
export function gesturesSuspended() {
  if (typeof document === 'undefined') return false;
  if (document.getElementById?.('site-gate-overlay')) return true;
  if (document.querySelector?.('.modal-overlay')) return true;
  if (document.getElementById?.('chat-sheet-wrap')) return true;
  // Touched-screen-audit finding (2026-09-25, UX Revamp wiring pass 3c) —
  // two more body-appended full-screen overlays that did not exist when
  // this list was written: League Page (`#league-page-overlay`, DI-314)
  // and the week-setup wizard sheet (`#week-wizard-sheet-wrap`, DI-C1).
  // Neither was in this list, so a week-swipe / pull-to-refresh / other
  // gesture on the page underneath could still fire while either sat on
  // top of it — the same class of bug the chat-sheet/modal/gate entries
  // above already exist to prevent. Named explicitly rather than silently
  // left as a gap discovered while touching this file's own neighbors
  // (`#week-wizard-sheet-wrap` shares this module's `bindWeekSwipe()`
  // suspension contract, DI-C1's sheet reuses `.chat-sheet` markup).
  if (document.getElementById?.('league-page-overlay')) return true;
  if (document.getElementById?.('week-wizard-sheet-wrap')) return true;
  // T-13 (control-center drawer), wired this window. `#control-center`'s own
  // `data-open` attribute is driven by js/control-center.js's
  // `isDrawerVisuallyOpen(state)` — true for 'open'/'opening'/'closing', and
  // mid-drag with any progress — exactly the contract that module's own
  // header promises. The drawer's OWN edge-swipe-to-close binder does NOT
  // consult this function (js/control-center.js's file-header note on why —
  // it would be self-defeating), so this addition never blocks the drawer
  // from closing itself.
  if (document.querySelector?.('#control-center[data-open="true"]')) return true;
  return false;
}

/**
 * DI-323's `body[data-keyboard-up]` flag, read directly — the T-24 nav-hide
 * reducer's always-hidden keyboard input (see `stepNavShowHide()`'s
 * `'keyboard'` event). Kept as its own small exported predicate, the same
 * "poll a DOM flag" idiom as `gesturesSuspended()`/`prefersReducedMotion()`,
 * rather than a push/subscribe wire-up between `bindKeyboardAvoid()` and
 * `bindScrollDirection()` — one more source of truth, checked the same way
 * everything else in this module is checked.
 */
export function isKeyboardUp() {
  if (typeof document === 'undefined' || !document.body?.dataset) return false;
  return 'keyboardUp' in document.body.dataset;
}

/** `prefers-reduced-motion: reduce` — feature-detected, never assumed. */
export function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function getScrollElFrom(getScrollEl) {
  return typeof getScrollEl === 'function' ? getScrollEl() : getScrollEl;
}

function readScrollPos(scrollEl) {
  if (!scrollEl) return 0;
  if (typeof window !== 'undefined' && scrollEl === window) return window.scrollY ?? 0;
  return scrollEl.scrollTop ?? 0;
}

// ═════════════════════════════════════════════════════════════════════════
// DI-322 — T-24 NAV-HIDE-ON-SCROLL
// ═════════════════════════════════════════════════════════════════════════

/**
 * `hidden` is DERIVED, not stored independently, so the three inputs
 * (suspended / keyboard / scroll-direction) can never drift out of priority
 * order: a genuine suspension (gate/modal/chat-sheet) always wins and forces
 * the nav VISIBLE; failing that, the on-screen keyboard being up always wins
 * and forces the nav HIDDEN (fix round 1, item 2 — the DI-322 amendment);
 * failing both, the plain scroll-direction state (`scrollHidden`) applies.
 * `scrollHidden` is tracked SEPARATELY from the exposed `hidden` so that the
 * keyboard coming back down restores whatever the scroll state actually was,
 * rather than forcing a show it didn't earn.
 */
function deriveHidden(state) {
  if (state.suspended) return false;
  if (state.keyboardUp) return true;
  return state.scrollHidden;
}

/**
 * Pure reducer. `state = { hidden, scrollHidden, dir, cumulative, suspended, keyboardUp }`.
 * Events:
 *   { type:'scroll', dy, scrollY }  — direction-driven scroll input.
 *   { type:'suspend' } / { type:'resume' } — gate/modal/chat-sheet.
 *   { type:'keyboard', up }         — DI-323's always-hidden input (fix round 1, item 2).
 */
function stepNavShowHide(state, event) {
  if (event.type === 'suspend') {
    const next = { ...state, suspended: true, dir: null, cumulative: 0 };
    return { ...next, hidden: deriveHidden(next) };
  }
  if (event.type === 'resume') {
    // `scrollHidden` is ALSO reset here, not just `dir`/`cumulative` — a
    // resume starts the nav fresh (shown), requiring NEW scroll evidence to
    // hide it again, rather than instantly resurrecting whatever the
    // scroll-direction state happened to be when the suspension began. This
    // is what the binder's own baseline reset (fix round 1, item 1) assumes.
    const next = { ...state, suspended: false, dir: null, cumulative: 0, scrollHidden: false };
    return { ...next, hidden: deriveHidden(next) };
  }
  if (event.type === 'keyboard') {
    const next = { ...state, keyboardUp: !!event.up };
    return { ...next, hidden: deriveHidden(next) };
  }
  if (event.type !== 'scroll') return state;
  if (state.suspended) return { ...state, hidden: deriveHidden(state) };

  const { scrollY, dy } = event;
  let { scrollHidden, dir, cumulative } = state;
  if (typeof scrollY === 'number' && scrollY <= NAV_ALWAYS_VISIBLE_NEAR_TOP_PX) {
    scrollHidden = false; dir = null; cumulative = 0;
  } else if (dy) {
    if (dy > 0) {
      // Scrolling down.
      cumulative = dir === 'down' ? cumulative + dy : dy;
      dir = 'down';
      if (cumulative >= NAV_HIDE_DOWN_PX) scrollHidden = true;
    } else {
      // Scrolling up.
      cumulative = dir === 'up' ? cumulative + Math.abs(dy) : Math.abs(dy);
      dir = 'up';
      if (cumulative >= NAV_SHOW_UP_PX) scrollHidden = false;
    }
  }
  const next = { ...state, scrollHidden, dir, cumulative };
  return { ...next, hidden: deriveHidden(next) };
}

const initialNavShowHideState = () => ({
  hidden: false, scrollHidden: false, dir: null, cumulative: 0,
  suspended: false, keyboardUp: false,
});

/**
 * Batch-runner for navgesturestest.mjs — feed `{type:'scroll',dy,scrollY}` /
 * `{type:'suspend'}` / `{type:'resume'}` / `{type:'keyboard',up}` ticks, get
 * back the `nav-hidden` boolean at each step.
 */
export function _navShowHideStateMachine(events) {
  let state = initialNavShowHideState();
  const out = [];
  for (const ev of events) {
    state = stepNavShowHide(state, ev);
    out.push(state.hidden);
  }
  return out;
}

const navHideStates = new WeakMap();

/**
 * DOM binder — T-24. `getScrollEl` returns either `window` or the live
 * `#chat-scroll` node; called fresh whenever the caller re-binds (e.g.
 * app.js's `navigateTo()` on every tab change, per the DI). Idempotent per
 * element (a WeakMap-keyed wire flag, not a monkey-patched DOM property).
 *
 * Toggles a `nav-hidden` class on `.bottom-nav` — the actual
 * `transform:translateY(100%)` / transition timing (NAV_HIDE_SHOW_MS) is a
 * CSS rule the coordinator adds to styles.css (see the handoff checklist);
 * this module never writes inline transform/transition styles for chrome
 * that a stylesheet already owns.
 */
export function bindScrollDirection(getScrollEl) {
  const scrollEl = getScrollElFrom(getScrollEl);
  if (!scrollEl || typeof scrollEl.addEventListener !== 'function') return () => {};
  if (navHideStates.has(scrollEl)) return navHideStates.get(scrollEl).tick;

  const entry = { state: initialNavShowHideState(), lastY: null };

  function applyHidden(hidden) {
    const nav = document.querySelector?.('.bottom-nav');
    nav?.classList?.toggle('nav-hidden', hidden);
  }

  function tick() {
    const scrollY = readScrollPos(scrollEl);
    const suspended = gesturesSuspended() || prefersReducedMotion();

    if (suspended) {
      entry.state = stepNavShowHide(entry.state, { type: 'suspend' });
      entry.lastY = scrollY;
      applyHidden(entry.state.hidden);
      return;
    }
    if (entry.state.suspended) {
      // FIX ROUND 1, ITEM 1 (reviewer BLOCK) — the binder MUST emit an
      // explicit 'resume' on the first unsuspended tick. Without it,
      // `state.suspended` (set by the 'suspend' branch above) never clears
      // — the reducer's own 'scroll' branch only forces `hidden: false`
      // while `suspended` is true, it never resets the flag itself — so
      // hide-on-scroll would stay latched shown forever after any
      // modal/gate/sheet closes. Reset the scroll baseline here too, since
      // scrollY may have drifted while suspended (a modal's own scroll, or
      // simply time passing) — the NEXT tick computes a fresh delta, same
      // as the very first tick ever taken on this element.
      entry.state = stepNavShowHide(entry.state, { type: 'resume' });
      entry.lastY = scrollY;
      applyHidden(entry.state.hidden);
      return;
    }
    if (entry.lastY === null) { entry.lastY = scrollY; return; }

    const keyboardUp = isKeyboardUp();
    if (entry.state.keyboardUp !== keyboardUp) {
      entry.state = stepNavShowHide(entry.state, { type: 'keyboard', up: keyboardUp });
    }

    const dy = scrollY - entry.lastY;
    entry.lastY = scrollY;
    entry.state = stepNavShowHide(entry.state, { type: 'scroll', dy, scrollY });
    applyHidden(entry.state.hidden);
  }

  entry.tick = tick;
  navHideStates.set(scrollEl, entry);
  scrollEl.addEventListener('scroll', tick, { passive: true });
  return tick;
}

// ═════════════════════════════════════════════════════════════════════════
// DI-323 — T-25 NAV-KEYBOARD-AVOID (feature half)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Pure reducer for the keyboard-up/down layout state.
 * state = { keyboardUp, baselineHeight, focused }.
 * Events: { type:'focus', height } | { type:'blur' } | { type:'resize', height }.
 */
function stepKeyboardLayout(state, event) {
  if (event.type === 'focus') {
    // FIX ROUND 1, ITEM 6 (reviewer BLOCK) — while the keyboard is already
    // up (e.g. tabbing from one field to another without the keyboard ever
    // dismissing), a second focus event must NOT re-capture the baseline:
    // `event.height` at that moment is the ALREADY-SHRUNKEN viewport, and
    // re-baselining against it would make the real keyboard height
    // invisible to every subsequent resize comparison.
    if (state.keyboardUp) return { ...state, focused: true };
    return { ...state, focused: true, baselineHeight: event.height ?? state.baselineHeight };
  }
  if (event.type === 'blur') {
    return { ...state, focused: false, keyboardUp: false };
  }
  if (event.type === 'resize') {
    if (!state.focused || state.baselineHeight == null) return state;
    const drop = state.baselineHeight - event.height;
    if (drop > KEYBOARD_VIEWPORT_DELTA_PX) return { ...state, keyboardUp: true };
    // Grow-back close to baseline (within the same delta) clears it.
    if (drop <= KEYBOARD_VIEWPORT_DELTA_PX) return { ...state, keyboardUp: false };
  }
  return state;
}

/** Batch-runner for navgesturestest.mjs. Returns `keyboardUp` per step. */
export function _keyboardLayoutStateMachine(events) {
  let state = { keyboardUp: false, baselineHeight: null, focused: false };
  const out = [];
  for (const ev of events) {
    state = stepKeyboardLayout(state, ev);
    out.push(state.keyboardUp);
  }
  return out;
}

function isEditableElement(el) {
  if (!el) return false;
  const tag = el.tagName ? String(el.tagName).toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

/**
 * DOM binder — T-25 feature half. Sets/clears `body[data-keyboard-up]`,
 * which `isKeyboardUp()` reads and which T-24's nav-hide binder polls every
 * tick as an always-HIDDEN reducer input (fix round 1, item 2 — NOT a
 * `gesturesSuspended()` input, which would force the nav the wrong
 * direction) — this adds exactly one more input to that state machine,
 * never a parallel one.
 *
 * Mechanism, per the DI: the Capacitor Keyboard plugin is NOT installed yet
 * (confirmed absent from the iOS shell's package manifest) —
 * feature-detected here, never assumed. Until it lands, BOTH platforms use
 * `visualViewport`, which WKWebView also fires on keyboard show/hide, so
 * this degrades gracefully.
 */
export function bindKeyboardAvoid() {
  if (typeof document === 'undefined') return () => {};
  let state = { keyboardUp: false, baselineHeight: null, focused: false };

  function apply() {
    if (!document.body) return;
    if (state.keyboardUp) document.body.dataset.keyboardUp = '';
    else delete document.body.dataset.keyboardUp;
  }

  function onFocusIn(e) {
    if (!isEditableElement(e.target)) return;
    const height = typeof window !== 'undefined' ? window.visualViewport?.height ?? window.innerHeight : undefined;
    state = stepKeyboardLayout(state, { type: 'focus', height });
    apply();
  }
  function onFocusOut(e) {
    if (!isEditableElement(e.target)) return;
    state = stepKeyboardLayout(state, { type: 'blur' });
    apply();
  }
  function onViewportResize() {
    const height = window.visualViewport?.height ?? window.innerHeight;
    state = stepKeyboardLayout(state, { type: 'resize', height });
    apply();
  }

  // Native Keyboard plugin, once the iOS thread adds it — feature-detected,
  // preferred over visualViewport when present (real pre-animation event,
  // exact keyboardHeight). Never assumed to exist today.
  const KeyboardPlugin = isNativeShell() ? window.Capacitor?.Plugins?.Keyboard : null;
  if (KeyboardPlugin && typeof KeyboardPlugin.addListener === 'function') {
    KeyboardPlugin.addListener('keyboardWillShow', () => {
      state = { ...state, keyboardUp: true };
      apply();
    });
    KeyboardPlugin.addListener('keyboardWillHide', () => {
      state = { ...state, keyboardUp: false };
      apply();
    });
  } else if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize, { passive: true });
  }

  document.addEventListener('focusin', onFocusIn, { passive: true });
  document.addEventListener('focusout', onFocusOut, { passive: true });

  return () => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    window.visualViewport?.removeEventListener?.('resize', onViewportResize);
  };
}

// ═════════════════════════════════════════════════════════════════════════
// v0.27.x bugfix (Drew, 2026-09-27) — T-25 companion: STICK-TO-BOTTOM for a
// bounded message thread across the keyboard layout change.
// ═════════════════════════════════════════════════════════════════════════

/**
 * "At the latest" band — ONE constant shared with the chat page's own
 * "↓ latest" button (js/chat-ui.js imports it for onChatScrollEvent()'s
 * `nearBottom`; navgesturestest [12d] pins both to it). Inside it, the thread follows the
 * bottom edge when its viewport resizes; outside it (a deliberate scroll-up
 * to read history) the position is left exactly where the player put it.
 */
export const BOTTOM_ANCHOR_PX = 120;

const bottomAnchors = new WeakMap();

/**
 * Keeps a bounded scroller pinned to its bottom when ITS OWN height changes,
 * if (and only if) the reader was within BOTTOM_ANCHOR_PX of the bottom just
 * before the change.
 *
 * Why this exists: T-25's `body[data-keyboard-up]` grows #page-chat by
 * --nav-height while the keyboard is up and shrinks it back on dismiss. On
 * the grow the browser clamps scrollTop, so a bottom-pinned thread stays
 * pinned; on the shrink scrollTop is simply kept and the newest
 * --nav-height px of the thread end up hidden under the composer. Blink
 * papers over that with CSS scroll anchoring; WebKit — the iOS home-screen
 * app and the WKWebView shell — has none, so the thread must do it itself.
 *
 * The "was at the bottom" answer is recorded on every 'scroll' event (the
 * browser's own clamp fires one too), never re-measured inside the
 * ResizeObserver callback — by then the new size has already moved the
 * bottom edge, and a shrink larger than the band would read as a
 * deliberate scroll-up. Idempotent per element (WeakMap,
 * same shape as bindBottomBounce()/bindWeekSwipe()); a safe no-op without
 * ResizeObserver.
 */
export function bindBottomAnchor(scrollEl) {
  if (!scrollEl || typeof scrollEl.addEventListener !== 'function') return () => {};
  if (bottomAnchors.has(scrollEl)) return bottomAnchors.get(scrollEl);
  if (typeof ResizeObserver !== 'function') return () => {};

  const nearBottom = () => (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) < BOTTOM_ANCHOR_PX;
  let anchored = nearBottom();
  const onScroll = () => { anchored = nearBottom(); };
  const ro = new ResizeObserver(() => {
    if (anchored) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  ro.observe(scrollEl);

  const unbind = () => {
    scrollEl.removeEventListener('scroll', onScroll);
    ro.disconnect();
    bottomAnchors.delete(scrollEl);
  };
  bottomAnchors.set(scrollEl, unbind);
  return unbind;
}

// ═════════════════════════════════════════════════════════════════════════
// DI-324 — T-26 PULL-TO-REFRESH
// ═════════════════════════════════════════════════════════════════════════

/**
 * Top-edge eligibility — pull-to-refresh only ever arms at true scroll-top.
 * FIX ROUND 1, ITEM 5 (reviewer BLOCK): a 1px tolerance, not strict `=== 0`
 * — some browsers/engines report `scrollTop`/`scrollY` as 1 at rest due to
 * sub-pixel rounding or a momentum-scroll settle, which would otherwise make
 * the gesture never arm at the top of a real device.
 */
export function _pullToRefreshEligible(scrollTop) {
  return scrollTop <= 1;
}

/**
 * Pure reducer. state = { phase, suspended, eligible }.
 * phase in idle|pulling|armed|refreshing|success|failed.
 * Events: suspend|resume|touchstart{scrollTop}|touchmove{dy}|touchend|
 *         refresh-success|refresh-fail|settle.
 */
function stepPullToRefresh(state, event) {
  switch (event.type) {
    case 'suspend':
      return { ...state, suspended: true };
    case 'resume':
      return { ...state, suspended: false };
    case 'touchstart': {
      if (state.suspended) return { ...state, eligible: false, axis: null };
      const eligible = _pullToRefreshEligible(event.scrollTop);
      return { ...state, eligible, phase: 'idle', axis: null };
    }
    case 'touchmove': {
      if (state.suspended || !state.eligible) return state;
      const dy = event.dy || 0;
      const dx = event.dx || 0;
      // AXIS LOCK (full-app review Step 6, 2026-09-26) — the same 8px dead
      // zone every other gesture here uses (AXIS_DEAD_ZONE_PX). A drag that
      // commits HORIZONTAL (a week swipe, a chat reply swipe) is not a pull,
      // however far it later drifts down; once locked it stays locked for
      // the touch. Before the lock, nothing is shown.
      let axis = state.axis ?? null;
      if (axis === null) {
        if (Math.abs(dx) <= AXIS_DEAD_ZONE_PX && Math.abs(dy) <= AXIS_DEAD_ZONE_PX) return state;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (axis === 'x') return { ...state, axis, eligible: false, phase: 'idle' };
      if (dy <= 0) return { ...state, axis };
      return { ...state, axis, phase: dy >= PULL_TO_REFRESH_ARM_PX ? 'armed' : 'pulling' };
    }
    case 'touchend': {
      if (state.suspended) return state;
      if (state.phase === 'armed') return { ...state, phase: 'refreshing' };
      return { ...state, phase: 'idle', eligible: false };
    }
    case 'refresh-success':
      return { ...state, phase: 'success' };
    case 'refresh-fail':
      // Loud-fail (T-26/AD-06): the state machine NEVER returns silently to
      // 'idle' on failure — 'failed' is a distinct phase a caller must
      // observe (and surface, e.g. showBackendErrorBanner()) before the next
      // 'settle' event is fed.
      return { ...state, phase: 'failed' };
    case 'settle':
      return { ...state, phase: 'idle', eligible: false };
    default:
      return state;
  }
}

/** Batch-runner for navgesturestest.mjs. Returns the `phase` per step. */
export function _pullToRefreshStateMachine(events) {
  let state = { phase: 'idle', suspended: false, eligible: false };
  const out = [];
  for (const ev of events) {
    state = stepPullToRefresh(state, ev);
    out.push(state.phase);
  }
  return out;
}

/**
 * DOM binder — T-26. `refreshFn` is REQUIRED and is the only thing this
 * binder ever calls to actually refresh data — never `location.reload()`,
 * never a second sync path (per the DI: "never a page reload... reuses the
 * app's one real sync path"). `refreshFn()` must return a Promise; its
 * rejection drives the loud-fail `onFail` callback, never a silent stop.
 *
 * `opts.onPhaseChange(phase)` lets the caller drive its own spinner UI
 * (markup/CSS/positioning is the coordinator's job in index.html/styles.css
 * — this binder only detects and orchestrates the gesture).
 *
 * NOTE on native vs. web mechanism (flagged, not silently diverged from):
 * the DI describes native as reading "the WebView's own rubber-band
 * overscroll offset" via a scroll/touchmove listener, contrasted with web's
 * touch-delta computation. No standard web/WebView API exposes that native
 * overscroll offset to JS (WebKit's bounce is a compositor-level effect;
 * `window.scrollY` does not go negative during it) — this binder therefore
 * uses the SAME touch-delta state machine on both platforms, which still
 * satisfies the DI's own stated PARITY-BY-DESIGN outcome ("same resulting
 * spinner behavior and same 64px arm point on both"). Flagged here and in
 * the handoff rather than silently building a different mechanism than
 * described without saying so.
 *
 * FIX ROUND 1, ITEM 4 (reviewer BLOCK) — `opts.onFail` is now REQUIRED,
 * exactly like `refreshFn`: loud-fail (AD-06) must not be an optional
 * option. A caller that omits it gets the same inert no-op binder as a
 * missing `refreshFn` — this gesture refuses to exist rather than exist
 * silently-non-loud.
 *
 * FIX ROUND 1, ITEM 7 — WeakMap idempotency guard, same shape as
 * `bindScrollDirection`'s: a second bind call for the same `scrollEl`
 * returns the already-bound unbind function rather than attaching a second
 * set of listeners.
 */
const pullToRefreshStates = new WeakMap();

export function bindPullToRefresh(getScrollEl, refreshFn, opts = {}) {
  const { onPhaseChange, onFail } = opts;
  if (typeof refreshFn !== 'function' || typeof onFail !== 'function') return () => {};
  const scrollEl = getScrollElFrom(getScrollEl);
  if (!scrollEl || typeof scrollEl.addEventListener !== 'function') return () => {};
  if (pullToRefreshStates.has(scrollEl)) return pullToRefreshStates.get(scrollEl).unbind;

  let state = { phase: 'idle', suspended: false, eligible: false };
  let startY = null, startX = null;

  function setState(next) {
    if (next.phase !== state.phase && typeof onPhaseChange === 'function') onPhaseChange(next.phase);
    state = next;
  }

  async function runRefresh() {
    try {
      await refreshFn();
      setState(stepPullToRefresh(state, { type: 'refresh-success' }));
      haptic('light'); // Design Philosophy: "Soft impact — Pull-to-refresh completes"
      // FIX ROUND 1, ITEM 8 — PULL_TO_REFRESH_SUCCESS_FADE_MS is honored
      // here: 'settle' (which clears the phase back to 'idle', the signal a
      // spinner UI would tear down on) is deliberately delayed by the fade
      // duration so a caller's spinner has time to actually fade before the
      // state says there's nothing left to show. The failure path settles
      // immediately below — the red banner is the visible signal there, a
      // fade would just be a second, contradictory animation on top of it.
      await new Promise(resolve => setTimeout(resolve, PULL_TO_REFRESH_SUCCESS_FADE_MS));
    } catch (err) {
      setState(stepPullToRefresh(state, { type: 'refresh-fail' }));
      onFail(err);
    } finally {
      setState(stepPullToRefresh(state, { type: 'settle' }));
    }
  }

  function onTouchStart(e) {
    const suspended = gesturesSuspended();
    setState(stepPullToRefresh(state, suspended ? { type: 'suspend' } : { type: 'resume' }));
    if (suspended) return;
    const t = e.touches?.[0];
    if (!t) return;
    startY = t.clientY;
    startX = t.clientX;
    setState(stepPullToRefresh(state, { type: 'touchstart', scrollTop: readScrollPos(scrollEl) }));
  }
  function onTouchMove(e) {
    if (startY === null) return;
    const t = e.touches?.[0];
    if (!t) return;
    setState(stepPullToRefresh(state, { type: 'touchmove', dy: t.clientY - startY, dx: typeof startX === 'number' ? t.clientX - startX : 0 }));
  }
  function onTouchEnd() {
    if (startY === null) return;
    startY = null;
    const prevPhase = state.phase;
    setState(stepPullToRefresh(state, { type: 'touchend' }));
    if (prevPhase === 'armed') runRefresh();
  }

  const target = typeof window !== 'undefined' ? window : scrollEl;
  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: true });
  target.addEventListener('touchend', onTouchEnd, { passive: true });
  target.addEventListener('touchcancel', onTouchEnd, { passive: true });

  const unbind = () => {
    target.removeEventListener('touchstart', onTouchStart);
    target.removeEventListener('touchmove', onTouchMove);
    target.removeEventListener('touchend', onTouchEnd);
    target.removeEventListener('touchcancel', onTouchEnd);
  };
  pullToRefreshStates.set(scrollEl, { unbind });
  return unbind;
}

// ═════════════════════════════════════════════════════════════════════════
// DI-325 — T-27 WEEK-SWIPE (in-tab half). BLOCKED ON B-02 — see file header
// and the handoff checklist. This module only exports the gesture-detection
// layer; the DOM binder below takes an `onNavigate` callback supplied by the
// CALLER and never touches app.js state or app.js render functions itself.
// ═════════════════════════════════════════════════════════════════════════

/**
 * Pure index math. `weekIds` is an ORDERED array of week ids (the same
 * ordered list `picksNavWeeks()`/`selectableDashboardWeeks()` already
 * produce — the coordinator maps that list to plain ids before calling, see
 * the handoff checklist). `dx` is the signed horizontal delta at commit
 * (positive = left-to-right = "back in time" = previous week; negative =
 * right-to-left = next week, matching the existing `‹`/`›` semantics).
 * Returns the target week id, or `null` if `dx` hasn't reached
 * SWIPE_COMMIT_PX or the target would go beyond either end of the list.
 */
export function _weekSwipeResolve(weekIds, currentId, dx) {
  if (!Array.isArray(weekIds) || weekIds.length === 0) return null;
  if (Math.abs(dx) < SWIPE_COMMIT_PX) return null;
  const idx = weekIds.indexOf(currentId);
  if (idx === -1) return null;
  const targetIdx = dx > 0 ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= weekIds.length) return null;
  return weekIds[targetIdx];
}

/**
 * v0.27.0 fix (Drew, 2026-09-27: "The right left swipe on the dashboard is
 * backwards") — the ONE place a week list is put into the order
 * `_weekSwipeResolve()` requires: OLDEST→NEWEST, by season then weekNumber
 * (the same comparator `picksNavWeeks()` sorts with). Every bindWeekSwipe()
 * state getter hands its ids through this, so no binder's own display order
 * (the Dashboard's newest-first <select> list was the defect) can ever
 * reach the direction table again. Pure; returns a new array of ids.
 */
export function chronologicalWeekIds(weeks) {
  return (Array.isArray(weeks) ? weeks.slice() : [])
    .sort((a, b) => String(a?.season).localeCompare(String(b?.season)) || (a?.weekNumber - b?.weekNumber))
    .map(w => w?.weekId);
}

/**
 * DOM binder — gesture-detection layer ONLY, per the DI ("feature-builder
 * may build and test the gesture-detection layer... but must not wire the
 * DOM binder to the real week-change call until B-02's fix is in the same
 * branch"). `getState()` returns `{ weekIds, currentWeekId }` fresh on every
 * touchstart (so a live re-render between gestures is always respected).
 * `onNavigate(targetId)` is the ONLY side effect this binder ever causes —
 * it is the caller's job to actually change the displayed week; this binder
 * never does it directly, so it cannot silently be wired to a broken path.
 *
 * Reviewer BLOCK (2026-09-25), F3 — this binder had NO WeakMap idempotency
 * guard while its three siblings (`bindScrollDirection`/`bindPullToRefresh`/
 * `bindBottomBounce`) all do. `app.js`'s `navigateTo()` calls this on EVERY
 * navigation to Picks/Dashboard (`document.getElementById('page-picks')`/
 * `'page-dashboard')` — the SAME static node every time, index.html never
 * replaces it — so N visits attached N listener sets, and one swipe fired
 * onNavigate() N times, walking N weeks per gesture. Guarded below, same
 * shape as `navHideStates`/`pullToRefreshStates`/`bottomBounceStates`.
 */
const weekSwipeStates = new WeakMap();

export function bindWeekSwipe(root, getState, onNavigate, opts = {}) {
  if (!root || typeof root.addEventListener !== 'function') return () => {};
  if (weekSwipeStates.has(root)) return weekSwipeStates.get(root);
  const edgeExcludePx = opts.leftEdgeExcludePx ?? WEEK_SWIPE_EDGE_EXCLUDE_PX;
  let start = null, axis = null, committed = false;

  function onTouchStart(e) {
    if (gesturesSuspended()) { start = null; return; }
    const t = e.touches?.[0];
    if (!t) return;
    if (t.clientX < edgeExcludePx) { start = null; return; } // reserved for T-13's drawer
    start = { x: t.clientX, y: t.clientY };
    axis = null;
    committed = false;
  }
  function onTouchMove(e) {
    if (!start || committed) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (axis === null && (Math.abs(dx) > AXIS_DEAD_ZONE_PX || Math.abs(dy) > AXIS_DEAD_ZONE_PX)) {
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis === 'x' && Math.abs(dx) >= SWIPE_COMMIT_PX) {
      committed = true;
      const { weekIds, currentWeekId } = typeof getState === 'function' ? getState() : { weekIds: [], currentWeekId: null };
      const target = _weekSwipeResolve(weekIds, currentWeekId, dx);
      if (target != null) {
        haptic('selection');
        if (typeof onNavigate === 'function') onNavigate(target);
      }
      // target === null (at either end): a small rubber-band bounce-back,
      // no navigation, no haptic (an edge isn't a success) — visual-only,
      // left to the caller's render layer per this pass's scope.
    }
  }
  function clear() { start = null; axis = null; committed = false; }

  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: true });
  root.addEventListener('touchend', clear, { passive: true });
  root.addEventListener('touchcancel', clear, { passive: true });

  const unbind = () => {
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('touchend', clear);
    root.removeEventListener('touchcancel', clear);
    weekSwipeStates.delete(root);
  };
  weekSwipeStates.set(root, unbind);
  return unbind;
}

// ═════════════════════════════════════════════════════════════════════════
// DI-327 — T-29 SCROLL-BOUNCE (non-WebKit web fallback, bottom-edge only)
// ═════════════════════════════════════════════════════════════════════════

/** Bottom-edge eligibility — the JS fallback only ever engages at true scroll-bottom. */
export function _bottomBounceEligible(scrollY, innerHeight, scrollHeight) {
  return scrollY + innerHeight >= scrollHeight;
}

/**
 * Pure resistance curve. Diminishing returns, asymptotically approaches
 * RUBBER_BAND_CAP_PX (24) and never exceeds it — "never overshoot
 * excessively" (Motion Rules). `overscrollPx` is the raw upward drag
 * distance past the bottom edge.
 */
export function _rubberBandOffset(overscrollPx) {
  const p = Math.max(0, overscrollPx || 0);
  const cap = RUBBER_BAND_CAP_PX;
  const resistance = 0.55;
  return cap * (1 - 1 / ((p * resistance) / cap + 1));
}

/**
 * DOM binder — T-29 web (non-WebKit) fallback. Applies the resistance curve
 * as a `transform: translateY(-Npx)` to `target` (never `body` — RG-209's
 * `body.native-shell::before` is a `fixed` element and provably unaffected
 * by a transform on a normal-flow descendant regardless, but this binder
 * still targets the descendant by construction, not by accident). Springs
 * back over RUBBER_BAND_SPRING_MS on release, or snaps instantly under
 * `prefers-reduced-motion`.
 *
 * Native and WebKit web get the real engine bounce for free — this binder
 * is only needed where `overscroll-behavior` isn't the gap (see the file's
 * verification note in the handoff: no `overscroll-behavior:none|contain`
 * was found anywhere in styles.css, and no `bounces:false` override was
 * found anywhere in the iOS shell's project — both confirmed by grep, not
 * assumed). Detecting "am I on a WebKit engine with native bounce already"
 * from pure JS is not reliable, so this binder is opt-in: the coordinator
 * calls it only where it's actually needed (see the handoff checklist), not
 * unconditionally on every platform.
 *
 * FIX ROUND 1, ITEM 3 (reviewer BLOCK) — `scrollEl` may be a BOUNDED
 * scroller (Chat's `#chat-scroll`), not `window`. The eligibility check
 * MUST read that element's own `scrollTop`/`clientHeight`/`scrollHeight`,
 * never `window.innerHeight`/`document.documentElement.scrollHeight` in
 * that case — reading the page's metrics for a bounded container made the
 * TOP of Chat wrongly eligible for a BOTTOM-edge gesture (colliding with
 * pull-to-refresh, which owns the top), because the page itself may not be
 * scrolled to its own bottom while Chat's inner list is.
 *
 * FIX ROUND 1, ITEM 7 — WeakMap idempotency guard, same shape as
 * `bindScrollDirection`'s/`bindPullToRefresh`'s.
 */
const bottomBounceStates = new WeakMap();

export function bindBottomBounce(getScrollEl, target) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const scrollEl = getScrollElFrom(getScrollEl);
  if (!scrollEl) return () => {};
  if (bottomBounceStates.has(scrollEl)) return bottomBounceStates.get(scrollEl).unbind;

  let startY = null, eligible = false;

  function apply(offsetPx) {
    target.style.transform = offsetPx > 0 ? `translateY(-${offsetPx}px)` : '';
  }

  function isWindowScroller() {
    return typeof window !== 'undefined' && scrollEl === window;
  }

  function onTouchStart(e) {
    if (gesturesSuspended()) { eligible = false; return; }
    const t = e.touches?.[0];
    if (!t) return;
    const scrollY = readScrollPos(scrollEl);
    // FIX ROUND 1, ITEM 3 — read the BOUND element's own box metrics for a
    // bounded scroller; only fall back to window/document for the real
    // page-level (window) scroll case.
    const innerHeight = isWindowScroller()
      ? (typeof window !== 'undefined' ? window.innerHeight : 0)
      : (scrollEl.clientHeight ?? 0);
    const scrollHeight = isWindowScroller()
      ? (typeof document !== 'undefined' ? document.documentElement?.scrollHeight ?? 0 : 0)
      : (scrollEl.scrollHeight ?? 0);
    eligible = _bottomBounceEligible(scrollY, innerHeight, scrollHeight);
    startY = eligible ? t.clientY : null;
  }
  function onTouchMove(e) {
    if (!eligible || startY === null) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dragUp = startY - t.clientY; // positive = dragging up past the bottom
    if (dragUp <= 0) { apply(0); return; }
    apply(_rubberBandOffset(dragUp));
  }
  function onTouchEnd() {
    if (!eligible) return;
    eligible = false;
    startY = null;
    if (prefersReducedMotion()) {
      apply(0);
      return;
    }
    target.style.transition = `transform ${RUBBER_BAND_SPRING_MS}ms ease-out`;
    apply(0);
    setTimeout(() => { target.style.transition = ''; }, RUBBER_BAND_SPRING_MS);
  }

  // Listen target unchanged from before this fix round (always `window`,
  // same as `bindPullToRefresh`) — touch events bubble to `window`
  // regardless of which scroll container the touch started inside, so this
  // was never the bug. The bug (item 3) was the ELIGIBILITY METRICS above
  // reading window/document unconditionally for a bounded scroller.
  const listenTarget = typeof window !== 'undefined' ? window : scrollEl;
  listenTarget.addEventListener('touchstart', onTouchStart, { passive: true });
  listenTarget.addEventListener('touchmove', onTouchMove, { passive: true });
  listenTarget.addEventListener('touchend', onTouchEnd, { passive: true });
  listenTarget.addEventListener('touchcancel', onTouchEnd, { passive: true });

  const unbind = () => {
    listenTarget.removeEventListener('touchstart', onTouchStart);
    listenTarget.removeEventListener('touchmove', onTouchMove);
    listenTarget.removeEventListener('touchend', onTouchEnd);
    listenTarget.removeEventListener('touchcancel', onTouchEnd);
  };
  bottomBounceStates.set(scrollEl, { unbind });
  return unbind;
}

// ═════════════════════════════════════════════════════════════════════════
// SWIPE-TO-DISMISS (UX Revamp Step 2 deferrals, 2026-09-26) — a shared
// native-only "follow the finger, settle by distance-or-flick" primitive so
// the League Page overlay's swipe-back (axis:'x') and the week wizard
// sheet's drag-to-dismiss (axis:'y') don't each reinvent the same physics —
// the Interaction Principles' Sheets section is explicit: "Do not create
// custom sheet physics." This reuses the EXACT settle numbers the
// control-center drawer already established (DI-301's 40%-of-distance
// threshold, 0.3px/ms flick velocity) — one animation language, not a
// second recipe.
// ═════════════════════════════════════════════════════════════════════════

/** Matches control-center.js's DRAWER_OPEN_SETTLE_RATIO exactly. */
export const DISMISS_SETTLE_RATIO = 0.4;
/** Matches control-center.js's DRAWER_FLICK_VELOCITY_PX_MS exactly. */
export const DISMISS_FLICK_VELOCITY_PX_MS = 0.3;

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/**
 * Pure settle math — identical shape to control-center's
 * `_resolveDrawerSettle()` (distance threshold OR flick velocity in the
 * dismiss direction), reused rather than re-derived.
 */
export function _resolveDismissSettle({ progress, velocityPxPerMs = 0 }) {
  if (velocityPxPerMs >= DISMISS_FLICK_VELOCITY_PX_MS) return true;
  // Reviewer R3 (3c fix window, third pass) — the drawer's backward-flick
  // cancel (control-center.js _resolveDrawerSettle()), which this "same
  // animation language" copy had dropped: a player who drags past the
  // threshold and then flicks BACK is saying "no" — honour it.
  if (velocityPxPerMs <= -DISMISS_FLICK_VELOCITY_PX_MS) return false;
  return clamp01(progress) >= DISMISS_SETTLE_RATIO;
}

const swipeToDismissStates = new WeakMap();

/**
 * Generic native-only drag-to-dismiss binder. `axis: 'x'` follows a
 * left-to-right drag (League Page's swipe-back); `axis: 'y'` follows a
 * downward drag (the wizard sheet). Gesture-DETECTION layer only, same
 * discipline as every other binder in this file and in control-center.js:
 * `onProgress(0..1)` is called on every move so the caller can drive a live
 * CSS custom property; `onSettle({ dismissed, reducedMotion })` fires once,
 * on release, and the caller owns what happens next (actually closing/going
 * back, or animating the progress var back to 0) — this binder never
 * touches app state or a transform itself.
 *
 * `opts.getBlocked()` (REQUIRED) is the caller's own "is something else
 * stacked on top of me" check — deliberately NOT `gesturesSuspended()`: this
 * surface's own presence is one of that function's suspending conditions,
 * so consulting it here would self-block on touchstart (same reasoning
 * control-center.js's `isBlockedByOtherSurface()` gives for its own
 * edge-swipe).
 * `opts.getDistancePx()` (REQUIRED) returns the live drag distance that
 * counts as 100% progress (the element's own width for `x`, height for
 * `y`) — read fresh per gesture, never cached, so a rotation/resize between
 * drags is never stale.
 * Backward drag (the wrong direction) clamps progress at 0 — no
 * rubber-band, matching the drawer's own "closed drawer dragged the wrong
 * way stays at 0" discipline.
 */
export function bindSwipeToDismiss(el, opts = {}) {
  if (!el || typeof el.addEventListener !== 'function') return () => {};
  if (!isNativeShell()) return () => {};
  if (swipeToDismissStates.has(el)) return swipeToDismissStates.get(el);
  const axis = opts.axis === 'y' ? 'y' : 'x';
  const getBlocked = typeof opts.getBlocked === 'function' ? opts.getBlocked : () => false;
  const getDistancePx = typeof opts.getDistancePx === 'function' ? opts.getDistancePx : () => 1;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const onSettle = typeof opts.onSettle === 'function' ? opts.onSettle : () => {};

  let start = null, lockedAxis = null, dragActive = false, dragProgress = 0;
  let lastPos = 0, lastT = 0, velocityPxPerMs = 0;

  function onTouchStart(e) {
    if (getBlocked()) { start = null; return; }
    const t = e.touches?.[0];
    if (!t) return;
    start = { x: t.clientX, y: t.clientY };
    lockedAxis = null;
    dragActive = false;
    dragProgress = 0;
    lastPos = axis === 'x' ? t.clientX : t.clientY;
    lastT = Date.now();
    velocityPxPerMs = 0;
  }
  function onTouchMove(e) {
    if (!start) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (lockedAxis === null && (Math.abs(dx) > AXIS_DEAD_ZONE_PX || Math.abs(dy) > AXIS_DEAD_ZONE_PX)) {
      lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (lockedAxis === axis) dragActive = true;
    }
    if (lockedAxis !== axis || !dragActive) return;
    const raw = axis === 'x' ? dx : dy;
    dragProgress = clamp01(raw / Math.max(1, getDistancePx()));
    onProgress(dragProgress);
    const pos = axis === 'x' ? t.clientX : t.clientY;
    const now = Date.now();
    const dt = Math.max(1, now - lastT);
    velocityPxPerMs = (pos - lastPos) / dt;
    lastPos = pos; lastT = now;
  }
  function settle() {
    if (dragActive) {
      // Security gate F2 hardening (third pass) — a surface that came up
      // MID-drag (a gate, a modal) cancels rather than dismisses underneath it.
      const dismissed = !getBlocked() && _resolveDismissSettle({ progress: dragProgress, velocityPxPerMs });
      onSettle({ dismissed, reducedMotion: prefersReducedMotion() });
    }
    start = null; lockedAxis = null; dragActive = false; dragProgress = 0; velocityPxPerMs = 0;
  }

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', settle, { passive: true });
  el.addEventListener('touchcancel', settle, { passive: true });

  const unbind = () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', settle);
    el.removeEventListener('touchcancel', settle);
    swipeToDismissStates.delete(el);
  };
  swipeToDismissStates.set(el, unbind);
  return unbind;
}
