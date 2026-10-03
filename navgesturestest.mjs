/**
 * CFB Pickems — navgesturestest.mjs
 * ==================================
 * UX Revamp, group A2 (DI-322…327) — js/nav-gestures.js + js/haptics.js.
 *
 * jsdom-free, per the invocation: every state machine under test is a PURE
 * function (events in, state out) with no DOM involved, matching
 * drafttest.mjs/layouttest.mjs's discipline of never asserting against a
 * hand-simulated re-implementation — these ARE the real reducers the DOM
 * binders in nav-gestures.js call, exported for direct batch-testing, not a
 * parallel model of them.
 *
 * Run: node navgesturestest.mjs
 *
 * SECTIONS
 *   1   Shared constants — match chat-ui.js's axis-lock numbers exactly, and
 *       the DI's own worked values (--nav-height, 64px arm, etc).
 *   2   DI-322 T-24 nav hide/show — down-hides, up-shows, near-top always
 *       shown, suspended forces visible, asymmetric thresholds hold,
 *       keyboard-up as an always-hidden input (2g/2h, fix round 1 item 2).
 *   2i  DI-322 T-24 bindScrollDirection() BINDER-level test — resume-after-
 *       suspend, driven through the real binder + fake DOM (fix round 1
 *       item 1: the latched-suspended-forever regression).
 *   3   DI-323 T-25 keyboard layout state — focus/resize/blur transitions,
 *       plus focus-while-already-up (3e, fix round 1 item 6).
 *   4   DI-324 T-26 pull-to-refresh — idle->pulling->armed->refreshing->
 *       success|failed->idle, non-top-of-scroll never arms, loud-fail never
 *       silently returns to idle, scrollTop<=1 tolerance (fix round 1 item 5).
 *   4g  DI-324 T-26 bindPullToRefresh() BINDER-level tests — onFail required
 *       (fix round 1 item 4), WeakMap double-bind idempotency (item 7).
 *   5   DI-325 T-27 week-swipe resolve — index math, ends return null,
 *       sub-threshold dx returns null.
 *   5j  v0.27.0 — one direction table on Picks AND Dashboard, driven through
 *       the REAL bindWeekSwipe() + the real app.js list builders.
 *   5k  DI-409 (UN-364, 2026-09-28) — week-swipe VISUAL layer, BINDER-level:
 *       drag-follow (1:1 px tracking, no transition), cancel spring-back
 *       (mutation-proof: a version that skips it), commit slide (haptic
 *       'light' at the commit instant, onNavigate() gated on the exit
 *       transition, enter half lands back at 0), edge rubber-band (never
 *       navigates/haptics at a list boundary), reduced motion (mutation-
 *       proof: a version that ignores it — no live tracking, instant
 *       navigate, transition attribute never appears), vertical-drag safety
 *       (mutation-proof: a version that lets a vertical drag translate —
 *       axis-locked 'y' never touches the transform), plus the pure
 *       `_weekSwipeAtBound()`/`_weekSwipeRubberBand()` helpers directly.
 *   6   DI-327 T-29 rubber-band curve — monotonic, capped, zero at zero.
 *   6b  DI-327 T-29 bindBottomBounce() BOUNDED-ELEMENT test — a bounded
 *       scroller (Chat) reads ITS OWN scrollTop/clientHeight/scrollHeight,
 *       never window/document's (fix round 1 item 3), plus double-bind
 *       idempotency (item 7).
 *   7   CONFLICT TABLE — gesture ownership per edge/axis (DI-327's coexistence
 *       section): pull-to-refresh owns the top edge exclusively, bottom
 *       bounce owns the bottom edge exclusively, neither engages at the
 *       other's edge.
 *   8   js/haptics.js — no-op off native, never throws, correct plugin calls
 *       when native + plugin are both present (a minimal fake Capacitor).
 *   9   gesturesSuspended()/prefersReducedMotion()/isKeyboardUp() — safe with
 *       no DOM at all.
 *   12  v0.27.x bugfix — chat composer tap jumped the thread to its OLDEST
 *       messages (iOS home-screen app): 12a static guard on the unitless
 *       `--nav-height:0` that made #page-chat.active's height calc() invalid,
 *       12b the real bindKeyboardAvoid() + bindBottomAnchor() keeping the
 *       thread pinned across keyboard up/down, 12c renderChatPage() wiring,
 *       12d the "↓ latest" button and the anchor share BOTTOM_ANCHOR_PX.
 */

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log('\n[nav-gestures] UX Revamp group A2 — DI-322…327\n');

const NG = await import('./js/nav-gestures.js');
const {
  AXIS_DEAD_ZONE_PX, SWIPE_COMMIT_PX,
  NAV_HIDE_DOWN_PX, NAV_SHOW_UP_PX, NAV_ALWAYS_VISIBLE_NEAR_TOP_PX,
  KEYBOARD_VIEWPORT_DELTA_PX,
  PULL_TO_REFRESH_ARM_PX, PULL_TO_REFRESH_SUCCESS_FADE_MS,
  WEEK_SWIPE_EDGE_EXCLUDE_PX, WEEK_SWIPE_BOUNCE_MAX_PX, WEEK_SWIPE_BOUNCE_MS, WEEK_SWIPE_COMMIT_MS,
  RUBBER_BAND_CAP_PX, DRAWER_ZONE_FRACTION, isInDrawerOpenZone, _isDrawerYieldTarget,
  _navShowHideStateMachine, _keyboardLayoutStateMachine,
  _pullToRefreshStateMachine, _pullToRefreshEligible,
  _weekSwipeResolve, _rubberBandOffset, _bottomBounceEligible,
  _weekSwipeAtBound, _weekSwipeRubberBand, bindWeekSwipe,
  gesturesSuspended, prefersReducedMotion, isKeyboardUp,
  bindScrollDirection, bindPullToRefresh, bindBottomBounce, bindBottomPullToRefresh,
  DISMISS_SETTLE_RATIO, DISMISS_FLICK_VELOCITY_PX_MS,
  _resolveDismissSettle, bindSwipeToDismiss,
} = NG;
// Step 2(b) (2026-09-26) — cross-file constant parity check: DISMISS_*
// above are DUPLICATED (not imported) from control-center.js's own
// DRAWER_OPEN_SETTLE_RATIO/DRAWER_FLICK_VELOCITY_PX_MS, same "one animation
// language" reasoning as AXIS_DEAD_ZONE_PX/SWIPE_COMMIT_PX vs chat-ui.js
// above — this import makes that claim a real, live-checked assertion
// rather than a comment nobody re-verifies.
const CC = await import('./js/control-center.js');

// ═════════════════════════════════════════════════════════════════════════
console.log('[1] SHARED CONSTANTS…');
// ═════════════════════════════════════════════════════════════════════════
{
  assert(AXIS_DEAD_ZONE_PX === 8, '1a: AXIS_DEAD_ZONE_PX matches chat-ui.js LONG_PRESS_THRESHOLD_PX (8)');
  assert(SWIPE_COMMIT_PX === 40, '1b: SWIPE_COMMIT_PX matches chat-ui.js SWIPE_THRESHOLD_PX (40)');
  assert(NAV_ALWAYS_VISIBLE_NEAR_TOP_PX === 120, '1c: near-top-always-shown = 2 * --nav-height (60px, css/styles.css:25)');
  assert(PULL_TO_REFRESH_ARM_PX === 64, '1d: pull-to-refresh arm threshold is 64px (8x8, 8-pt grid)');
  assert(NAV_HIDE_DOWN_PX === 24 && NAV_SHOW_UP_PX === 4, '1e: nav-hide asymmetric thresholds — 24px down, 4px up');
  // N3 (reviewer round 2, 2026-09-28) — this constant no longer GATES any
  // arm/yield decision (DI-419 retired that role — see nav-gestures.js's
  // own file-header note on WEEK_SWIPE_EDGE_EXCLUDE_PX); the assertion
  // below only proves the historical value is unchanged, not that anything
  // still "reserves" it.
  assert(WEEK_SWIPE_EDGE_EXCLUDE_PX === 28, '1f: WEEK_SWIPE_EDGE_EXCLUDE_PX is still 28 — a historical fact a few comments/tests reference, not an operational zone (superseded by isInDrawerOpenZone()/DRAWER_ZONE_FRACTION, DI-419)');
  assert(RUBBER_BAND_CAP_PX === 24, '1g: rubber-band cap is 24px');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] DI-322 T-24 — nav hide/show state machine…');
// ═════════════════════════════════════════════════════════════════════════
{
  // 2a: sustained downward scroll past the dead zone hides the nav.
  const down = _navShowHideStateMachine([
    { type: 'scroll', dy: 10, scrollY: 200 },
    { type: 'scroll', dy: 10, scrollY: 210 },
    { type: 'scroll', dy: 10, scrollY: 220 }, // cumulative 30 >= 24
  ]);
  assert(down[0] === false && down[1] === false, '2a-1: below the 24px dead zone, nav stays shown');
  assert(down[2] === true, '2a-2: cumulative downward scroll past 24px hides the nav');

  // 2b: any up-tick past 4px shows it again immediately.
  const upAfterHide = _navShowHideStateMachine([
    { type: 'scroll', dy: 30, scrollY: 300 },   // hidden
    { type: 'scroll', dy: -5, scrollY: 295 },   // 5px up > 4px threshold
  ]);
  assert(upAfterHide[0] === true, '2b-0: fixture check — nav is hidden after the down scroll');
  assert(upAfterHide[1] === false, '2b-1: a 5px upward tick (past the 4px threshold) shows the nav again');

  // 2c: near scrollY===0 (within 120px), nav is ALWAYS shown regardless of direction.
  const nearTop = _navShowHideStateMachine([
    { type: 'scroll', dy: 30, scrollY: 300 },  // hidden, far from top
    { type: 'scroll', dy: -180, scrollY: 100 }, // now within 120px of top
  ]);
  assert(nearTop[1] === false, '2c: scrolling back within 120px of the top forces the nav shown, regardless of direction');

  // 2d: suspended (gate/modal/chat-sheet) forces visible, no matter the
  // direction. Keyboard is deliberately NOT part of this — see §2g below,
  // fix round 1 item 2.
  const suspended = _navShowHideStateMachine([
    { type: 'scroll', dy: 30, scrollY: 300 },
    { type: 'suspend' },
    { type: 'scroll', dy: 30, scrollY: 330 }, // would normally stay hidden/keep hiding
  ]);
  assert(suspended[1] === false && suspended[2] === false, '2d: gesturesSuspended() forces the nav visible and keeps it visible through further down-scroll');

  // 2e: resuming after suspend does not resurrect the old hidden state.
  const resumed = _navShowHideStateMachine([
    { type: 'scroll', dy: 30, scrollY: 300 }, // hidden
    { type: 'suspend' },
    { type: 'resume' },
  ]);
  assert(resumed[2] === false, '2e: on resume, the nav starts from shown, not the pre-suspend hidden state');

  // 2f: a page with no scroll (content height <= viewport) never receives a
  // qualifying event, so the state machine simply never transitions.
  const noScroll = _navShowHideStateMachine([]);
  assert(noScroll.length === 0, '2f: no scroll events -> no transitions asserted (falls out of "no dead-zone crossing", no special-case code needed)');

  // 2g — FIX ROUND 1, ITEM 2 (reviewer BLOCK): keyboard-up is an
  // ALWAYS-HIDDEN reducer input, never a suspension. It must hide an
  // otherwise-shown nav, and it must NOT be reversible by an upward scroll
  // while the keyboard is still up (that would defeat "always hidden").
  const keyboardForcesHidden = _navShowHideStateMachine([
    { type: 'scroll', dy: -5, scrollY: 300 }, // shown (up-scroll)
    { type: 'keyboard', up: true },
  ]);
  assert(keyboardForcesHidden[0] === false, '2g-0: fixture check — nav starts shown after an up-scroll');
  assert(keyboardForcesHidden[1] === true, '2g-1: keyboard up FORCES the nav hidden, even though the last scroll direction was up');

  const keyboardResistsUpScroll = _navShowHideStateMachine([
    { type: 'keyboard', up: true },
    { type: 'scroll', dy: -10, scrollY: 300 }, // a big up-scroll, WHILE the keyboard is still up
  ]);
  assert(keyboardResistsUpScroll[1] === true, '2g-2: keyboard up wins over an up-scroll — the nav does not peek out from under the keyboard');

  const keyboardDownRestoresScrollState = _navShowHideStateMachine([
    { type: 'scroll', dy: 30, scrollY: 300 }, // scroll-hidden
    { type: 'keyboard', up: true },
    { type: 'keyboard', up: false },
  ]);
  assert(keyboardDownRestoresScrollState[2] === true,
    '2g-3: keyboard coming back down restores the underlying scroll-driven state (still hidden, because the user was still scrolled-down) rather than forcing a show it did not earn');

  // 2h: gesturesSuspended() (gate/modal/chat-sheet) still wins over
  // keyboard-up too — a genuine suspension is a stronger visibility
  // guarantee than the keyboard's hidden-forcing.
  const suspendBeatsKeyboard = _navShowHideStateMachine([
    { type: 'keyboard', up: true },
    { type: 'suspend' },
  ]);
  assert(suspendBeatsKeyboard[1] === false, '2h: a genuine suspension still forces the nav visible even while the keyboard-up flag is set');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2i] DI-322 T-24 — bindScrollDirection() BINDER-level test (fix round 1, item 1)…');
// ═════════════════════════════════════════════════════════════════════════
{
  // Real reviewer BLOCK: "the nav-hide latches `suspended` forever because
  // the binder never emits `resume`". Driven through the REAL binder against
  // a fake scroll element and a fake `document`/`.bottom-nav`/gate — not the
  // pure reducer alone — so this proves the FULL wiring, not just the
  // reducer's own correctness (which §2 already covers).
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  const savedMatchMedia = globalThis.matchMedia;

  function makeFakeNav() {
    return { classList: { _hidden: false, toggle(cls, val) { if (cls === 'nav-hidden') this._hidden = !!val; } } };
  }
  function makeFakeDocument(navEl) {
    return {
      _gateUp: false,
      getElementById(id) { return (id === 'site-gate-overlay' && this._gateUp) ? {} : null; },
      querySelector(sel) { return sel === '.bottom-nav' ? navEl : (sel === '.modal-overlay' ? null : null); },
      body: { dataset: {} },
    };
  }
  function makeFakeScrollEl() {
    const handlers = [];
    return {
      scrollTop: 0,
      addEventListener(type, fn) { if (type === 'scroll') handlers.push(fn); },
      removeEventListener() {},
      _fire() { handlers.forEach(fn => fn()); },
    };
  }

  const navEl = makeFakeNav();
  const fakeDoc = makeFakeDocument(navEl);
  globalThis.document = fakeDoc;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.window = undefined; // ensure our fake scroll element is never `=== window`
  const scrollEl = makeFakeScrollEl();

  bindScrollDirection(() => scrollEl);

  // Prime (first tick only records the baseline scrollY, per the module's
  // own "first tick never transitions" contract).
  scrollEl.scrollTop = 200; scrollEl._fire();
  assert(navEl.classList._hidden === false, '2i-0: fixture check — nav starts shown');

  // Gate opens (suspended) — a big downward scroll must NOT hide it.
  fakeDoc._gateUp = true;
  scrollEl.scrollTop = 260; scrollEl._fire(); // +60 down, but gate is up
  assert(navEl.classList._hidden === false, '2i-1: gate up -> nav stays visible despite a big downward scroll');

  // Gate closes — THIS is the regression fix round 1 item 1 closes: without
  // an explicit 'resume', `suspended` stays latched true forever and the nav
  // can never hide again, no matter how much the user scrolls down.
  fakeDoc._gateUp = false;
  scrollEl.scrollTop = 260; scrollEl._fire(); // resume tick (baseline reset, no scroll delta applied yet)
  scrollEl.scrollTop = 300; scrollEl._fire(); // +40 down, past the 24px dead zone
  assert(navEl.classList._hidden === true,
    '2i-2: after the gate closes (resume), a SUBSEQUENT down-scroll hides the nav again — fails under the old code, which never emitted resume and left suspended latched true');

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
  globalThis.matchMedia = savedMatchMedia;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-323 T-25 — keyboard layout state machine…');
// ═════════════════════════════════════════════════════════════════════════
{
  // 3a: focus + a big viewport height drop -> keyboard up.
  const up = _keyboardLayoutStateMachine([
    { type: 'focus', height: 800 },
    { type: 'resize', height: 500 }, // drop of 300 > 100px threshold
  ]);
  assert(up[0] === false, '3a-0: focusing alone does not set keyboard-up (no resize yet)');
  assert(up[1] === true, '3a-1: a >100px viewport height drop while focused sets keyboard-up');

  // 3b: growing back clears it.
  const down = _keyboardLayoutStateMachine([
    { type: 'focus', height: 800 },
    { type: 'resize', height: 500 },
    { type: 'resize', height: 795 }, // grew back near baseline
  ]);
  assert(down[2] === false, '3b: the viewport growing back near baseline clears keyboard-up');

  // 3c: blur clears it even without a matching resize event (some Android
  // WebViews dismiss via the hardware "done" button with no resize) — the
  // DI's "dual-clear" correctness.
  const blurred = _keyboardLayoutStateMachine([
    { type: 'focus', height: 800 },
    { type: 'resize', height: 500 },
    { type: 'blur' },
  ]);
  assert(blurred[2] === false, '3c: blur clears keyboard-up independently of a resize event');

  // 3d: a resize with nothing focused is a no-op (no editable element in play).
  const unfocused = _keyboardLayoutStateMachine([
    { type: 'resize', height: 400 },
  ]);
  assert(unfocused[0] === false, '3d: an unfocused resize never sets keyboard-up');

  // 3e — FIX ROUND 1, ITEM 6 (reviewer BLOCK): a SECOND focus event while the
  // keyboard is ALREADY up (tabbing between two fields with no dismiss in
  // between) must NOT re-capture the baseline against the already-shrunken
  // height — doing so would make the real keyboard height invisible to every
  // later resize comparison. Differentiated with a value that ONLY reads
  // correctly against the TRUE (800) baseline, not the wrongly-re-captured
  // (500) one:
  const focusWhileUp = _keyboardLayoutStateMachine([
    { type: 'focus', height: 800 },   // true baseline = 800
    { type: 'resize', height: 500 },  // drop of 300 (>100) -> keyboard up
    { type: 'focus', height: 500 },   // tab to a second field — height IS the shrunken 500; must NOT re-baseline
    { type: 'resize', height: 600 },  // drop from the TRUE baseline (800) is 200 (>100) -> still up.
                                       // BUG (unguarded) case: drop from a wrongly-recaptured
                                       // baseline of 500 would be 500-600=-100 (<=100) -> would
                                       // read as "grew back", clearing keyboard-up incorrectly
                                       // while the viewport is still only 600 of a true 800.
  ]);
  assert(focusWhileUp[1] === true, '3e-0: fixture check — keyboard is up after the first resize');
  assert(focusWhileUp[2] === true, '3e-1: a second focus while the keyboard is already up does not clear keyboard-up');
  assert(focusWhileUp[3] === true,
    '3e-2: …and does not re-baseline either — a resize to 600 still reads as keyboard-up ONLY if the baseline stayed 800; against a wrongly-recaptured baseline of 500 this would have (incorrectly) cleared keyboard-up');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] DI-324 T-26 — pull-to-refresh state machine…');
// ═════════════════════════════════════════════════════════════════════════
{
  // FIX ROUND 1, ITEM 5 (reviewer BLOCK): a 1px tolerance, not strict === 0
  // — some engines report scrollTop/scrollY as 1 at rest.
  assert(_pullToRefreshEligible(0) === true && _pullToRefreshEligible(1) === true && _pullToRefreshEligible(2) === false,
    '4a: eligibility tolerates scrollTop <= 1 (sub-pixel rest) but not 2 — top-of-scroll gate');

  // 4b: full happy path — idle -> pulling -> armed -> refreshing -> success -> idle.
  const happy = _pullToRefreshStateMachine([
    { type: 'touchstart', scrollTop: 0 },
    { type: 'touchmove', dy: 20 },
    { type: 'touchmove', dy: 64 },
    { type: 'touchend' },
    { type: 'refresh-success' },
    { type: 'settle' },
  ]);
  assert(happy[1] === 'pulling', '4b-1: below the 64px arm threshold, phase is "pulling"');
  assert(happy[2] === 'armed', '4b-2: crossing 64px arms the refresh');
  assert(happy[3] === 'refreshing', '4b-3: touchend while armed triggers "refreshing"');
  assert(happy[4] === 'success', '4b-4: refresh-success moves to "success"');
  assert(happy[5] === 'idle', '4b-5: settle returns to idle');

  // 4c: releasing below the arm threshold does nothing (recedes to idle,
  // never triggers a refresh).
  const belowThreshold = _pullToRefreshStateMachine([
    { type: 'touchstart', scrollTop: 0 },
    { type: 'touchmove', dy: 30 },
    { type: 'touchend' },
  ]);
  assert(belowThreshold[1] === 'pulling' && belowThreshold[2] === 'idle',
    '4c: releasing below 64px never reaches "refreshing" — recedes straight to idle');

  // 4d: NOT at scroll-top — the gesture never arms at all, regardless of
  // pull distance.
  const notAtTop = _pullToRefreshStateMachine([
    { type: 'touchstart', scrollTop: 40 },
    { type: 'touchmove', dy: 100 },
    { type: 'touchend' },
  ]);
  assert(!notAtTop.includes('armed') && !notAtTop.includes('refreshing'),
    '4d: not-at-scroll-top never arms or refreshes, no matter how far the finger travels');

  // 4e: loud-fail — a failed refresh is a DISTINCT observable phase, never a
  // silent return to idle. It only reaches idle via an explicit 'settle'.
  const failed = _pullToRefreshStateMachine([
    { type: 'touchstart', scrollTop: 0 },
    { type: 'touchmove', dy: 64 },
    { type: 'touchend' },
    { type: 'refresh-fail' },
  ]);
  assert(failed[failed.length - 1] === 'failed',
    '4e-1: a failed refresh reports "failed", not "idle" — no silent stop (AD-06 loud-fail)');
  const failedThenSettle = _pullToRefreshStateMachine([
    { type: 'touchstart', scrollTop: 0 },
    { type: 'touchmove', dy: 64 },
    { type: 'touchend' },
    { type: 'refresh-fail' },
    { type: 'settle' },
  ]);
  assert(failedThenSettle[failedThenSettle.length - 1] === 'idle',
    '4e-2: …and only an EXPLICIT settle event (the caller having surfaced the failure) returns it to idle');

  // 4f: suspended (modal/gate/chat-sheet open) — refuses to arm even at
  // scroll-top with a big pull.
  const suspendedPull = _pullToRefreshStateMachine([
    { type: 'suspend' },
    { type: 'touchstart', scrollTop: 0 },
    { type: 'touchmove', dy: 100 },
    { type: 'touchend' },
  ]);
  assert(!suspendedPull.includes('armed') && !suspendedPull.includes('refreshing'),
    '4f: gesturesSuspended() (gate/modal/chat-sheet) refuses the gesture entirely, even at true scroll-top');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4g] DI-324 T-26 — bindPullToRefresh() BINDER-level tests (fix round 1, items 4 & 7)…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;

  function makeFakeWindowScrollEl() {
    const handlers = {};
    const el = {
      scrollY: 0,
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
      _handlerCount(type) { return (handlers[type] || []).length; },
    };
    return el;
  }

  globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: {} } };
  const fakeWin = makeFakeWindowScrollEl();
  globalThis.window = fakeWin;

  // 4g-1 — FIX ROUND 1, ITEM 4: onFail is REQUIRED, exactly like refreshFn.
  // Omitting it must return the same inert no-op binder as omitting
  // refreshFn — loud-fail must not be an optional option.
  let called = false;
  const unbindNoFail = bindPullToRefresh(() => fakeWin, async () => { called = true; }, {});
  assert(typeof unbindNoFail === 'function', '4g-1a: bindPullToRefresh() without onFail still returns a function (the no-op contract)');
  assert(fakeWin._handlerCount('touchstart') === 0, '4g-1b: …and it attached ZERO listeners — no onFail means no gesture, not a gesture that might silently fail');
  unbindNoFail(); // harmless on the no-op binder

  // 4g-2 — the SAME call, but WITH onFail, actually binds (listener count > 0).
  const fails = [];
  const unbind1 = bindPullToRefresh(() => fakeWin, async () => { called = true; }, { onFail: (e) => fails.push(e) });
  assert(fakeWin._handlerCount('touchstart') === 1, '4g-2: with a real onFail supplied, the binder actually attaches its listener');

  // 4g-3 — FIX ROUND 1, ITEM 7: WeakMap idempotency guard, same shape as
  // bindScrollDirection's. A second bind call for the SAME scroll element
  // must attach ONCE, not twice.
  const unbind2 = bindPullToRefresh(() => fakeWin, async () => { called = true; }, { onFail: (e) => fails.push(e) });
  assert(fakeWin._handlerCount('touchstart') === 1, '4g-3: a second bind() for the same scroll element does not attach a second listener (still 1)');
  assert(unbind1 === unbind2, '4g-3b: …and returns the SAME unbind function both times');

  unbind1();
  assert(fakeWin._handlerCount('touchstart') === 0, '4g-4: the shared unbind function actually detaches the listener');

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4h] RG-281 (reviewer round 2, 2026-09-28) — bindPullToRefresh() "the top-binder twin"…');
// ═════════════════════════════════════════════════════════════════════════
{
  // js/app.js's OWN current call sites only ever pass `() => window`
  // (stable — the Picks/Dashboard else-branch), so THIS regression is not
  // reachable through app.js today. It WAS reachable in v0.26/v0.27, when
  // Chat's own top-edge bind used `() => document.getElementById(
  // 'chat-scroll')` — the same unstable-identity hazard DI-399(b-ii)
  // removed by giving Chat its own bottom-edge binder instead (see [6c]).
  // This section proves the FUNCTION ITSELF carries the same RG-281 fix
  // bindBottomPullToRefresh() does — defense in depth for any future
  // caller, not a claim that today's app.js still feeds it an unstable
  // element.
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;

  function makeFakeWindowScrollEl() {
    const handlers = {};
    return {
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
    };
  }
  globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: {} } };

  {
    // 4h-1 — bind against a bounded, unstable-identity scroller; the
    // CALLER then replaces it with a fresh node that is NOT at scroll-top
    // (a real page, scrolled down) — the drag must read that fresh node,
    // never the bind-time one.
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let current = { scrollTop: 0, addEventListener() {}, removeEventListener() {} }; // bind-time: at top, eligible
    let refreshed = 0;
    bindPullToRefresh(() => current, async () => { refreshed++; }, { onFail: () => {} });
    current = { scrollTop: 400, addEventListener() {}, removeEventListener() {} }; // replaced — scrolled well down
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '4h-1: bind -> caller replaces the scroll element with a NOT-at-top node -> drag -> 0 refreshes');
  }
  {
    // 4h-2 — the replacement is DETACHED (a torn-down node reports 0 for
    // every metric, which _pullToRefreshEligible(0) reads as "eligible" —
    // exactly RG-281's "hide the page" case, the top-edge shape).
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let current = { scrollTop: 0, addEventListener() {}, removeEventListener() {} };
    let refreshed = 0;
    bindPullToRefresh(() => current, async () => { refreshed++; }, { onFail: () => {} });
    current = { scrollTop: 0, isConnected: false, addEventListener() {}, removeEventListener() {} }; // detached
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '4h-2: the replacement node is DETACHED (isConnected:false) — even though its own scrollTop still reads 0 ("eligible"), isScrollElLive() refuses it');
  }
  {
    // 4h-3 — `window` itself is never falsely refused: isScrollElLive()
    // must answer true for the ordinary, ever-connected case.
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let refreshed = 0;
    bindPullToRefresh(() => fakeWin, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 1, '4h-3: `window` (Picks/Dashboard\'s real scroller) is never false-flagged by the liveness guard — the ordinary case still refreshes');
  }
  {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./js/nav-gestures.js', import.meta.url), 'utf8');
    const fnStart = src.indexOf('export function bindPullToRefresh');
    const fnBody = src.slice(fnStart, fnStart + 5200); // widened for RG-285's opts.isActive block, added inside this same function
    assert(fnStart > 0, '4h-4 fixture: bindPullToRefresh() is a real export');
    assert(/getScrollElFrom\(getScrollEl\)/.test(fnBody) && /isScrollElLive\(/.test(fnBody),
      '4h-4: onTouchStart re-resolves getScrollEl() FRESH and checks isScrollElLive() — the SAME RG-281 guard bindBottomPullToRefresh() carries');
    assert(/eligible: false/.test(fnBody) && !/MAX_SAFE_INTEGER/.test(fnBody),
      '4h-5: the not-live case passes an explicit `eligible: false`, not a fabricated scrollTop sentinel');
  }

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4i] RG-285 (reviewer round 3, 2026-09-28) — bindPullToRefresh()\'s opts.isActive: the window binder never fires while Chat is the active tab…');
// ═════════════════════════════════════════════════════════════════════════
{
  // Picks/Dashboard's own bindPullToRefresh(() => window, …) is bound once
  // and never unbound (window is a STABLE identity — RG-281's own fresh-
  // resolve fix does not help here, since the SAME window object really is
  // still "live"). Chat never scrolls `window` at all (its own thread
  // scrolls #chat-scroll internally), so window.scrollY stays 0 —
  // _pullToRefreshEligible(0) reads that as "eligible" on every touch in
  // chat history, and a downward drag ≥64px armed and released this
  // binder while the reader was just scrolling messages. Driven through
  // the REAL binder, same discipline as [4g]/[4h].
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;

  function makeFakeWindowScrollEl() {
    const handlers = {};
    return {
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
    };
  }
  function setActiveTab(tab) {
    globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: { tab } } };
  }

  {
    // Red on 8a0510a first (confirmed by hand before this fix landed): bind
    // the window binder the SAME way Picks/Dashboard's own call site does,
    // then simulate the tab having moved to Chat — a downward drag must
    // fire ZERO refreshes.
    setActiveTab('chat');
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let refreshed = 0;
    bindPullToRefresh(() => fakeWin, async () => { refreshed++; }, {
      onFail: () => {},
      isActive: () => document.body.dataset.tab !== 'chat',
    });
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] }); // downward drag, well past the arm point
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, `4i-1: data-tab="chat" — a downward drag anywhere in chat history never arms or refreshes the window binder (got ${refreshed})`);
  }
  {
    // The SAME binder, the SAME kind of drag, on the tab it actually means
    // something on — confirms this is a real predicate, not one that
    // happens to always refuse (anti-vacuity).
    setActiveTab('picks');
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let refreshed = 0;
    bindPullToRefresh(() => fakeWin, async () => { refreshed++; }, {
      onFail: () => {},
      isActive: () => document.body.dataset.tab !== 'chat',
    });
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 1, `4i-2: data-tab="picks" — the SAME drag arms and refreshes exactly once (got ${refreshed})`);
  }
  {
    // dashboard is the OTHER active tab, same contract.
    setActiveTab('dashboard');
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let refreshed = 0;
    bindPullToRefresh(() => fakeWin, async () => { refreshed++; }, {
      onFail: () => {},
      isActive: () => document.body.dataset.tab !== 'chat',
    });
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 1, `4i-3: data-tab="dashboard" — also arms and refreshes exactly once (got ${refreshed})`);
  }
  for (const tab of ['leaderboard', 'commissioner', 'rules', 'admin']) {
    // Reviewer round 4 (2026-09-28): the RG-285 predicate must be a DENYLIST —
    // an allowlist of picks/dashboard silently removed pull-to-refresh from
    // Standings, Comm, Rules and Admin (DI-324: every page except the gate
    // and sheets/modals). Each of these must still refresh exactly once.
    setActiveTab(tab);
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let refreshed = 0;
    bindPullToRefresh(() => fakeWin, async () => { refreshed++; }, { onFail: () => {}, isActive: () => document.body.dataset.tab !== 'chat' });
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 1, `4i-3-${tab}: data-tab="${tab}" keeps pull-to-refresh (got ${refreshed}) — only Chat is denied`);
  }
  {
    // No isActive supplied at all — backward-compatible default (always
    // active), so a caller that never needed this guard is unaffected.
    setActiveTab('chat'); // even on chat — proves the DEFAULT truly is "always active", not silently borrowing the real predicate
    const fakeWin = makeFakeWindowScrollEl(); globalThis.window = fakeWin;
    let refreshed = 0;
    bindPullToRefresh(() => fakeWin, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 100 + PULL_TO_REFRESH_ARM_PX + 4 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 1, `4i-4: with NO isActive option supplied, the binder defaults to always-active (backward compatible) — got ${refreshed}`);
  }
  {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./js/nav-gestures.js', import.meta.url), 'utf8');
    const fnStart = src.indexOf('export function bindPullToRefresh');
    const fnBody = src.slice(fnStart, fnStart + 4500);
    assert(/isActive/.test(fnBody), '4i-5 fixture: bindPullToRefresh() itself references isActive');
    assert(/onTouchStart[\s\S]*?typeof isActive === 'function' && !isActive\(\)/.test(fnBody),
      '4i-6: the isActive() check runs inside onTouchStart, before any scroll-position read');
  }

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4j] RG-289 (live v0.27.0, Drew 2026-09-28) — no window-level bounce binder acts on Chat; the Chat pull-up lifts nothing…');
// ═════════════════════════════════════════════════════════════════════════
{
  // bindBottomBounce(() => window, .page-wrapper) is bound ONCE, on the first
  // non-Chat tab, and its window touch listeners stay live on Chat. Chat never
  // scrolls `window`, so the window "true bottom" test (0 + innerHeight >=
  // scrollHeight - 1) passed on every touch: every upward drag anywhere on
  // Chat lifted the page. Driven through the REAL binder with a fake window
  // whose document fits exactly (Chat's measured shape, chatpagetest [A-2]).
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  function makeFakeWin() {
    const handlers = {};
    return {
      scrollY: 0, innerHeight: 844,
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
    };
  }
  function setTab(tab) {
    globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: { tab } }, documentElement: { scrollHeight: 844 } };
  }
  const deny = () => document.body.dataset.tab !== 'chat';
  /** Bind the way navigateTo() does, drag up 120px, return the largest lift written. */
  function dragUp(tab, opts) {
    setTab(tab);
    const fakeWin = makeFakeWin(); globalThis.window = fakeWin;
    const writes = [];
    // A real element has addEventListener — bindBottomBounce() refuses a target without one.
    const target = { style: {}, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(target.style, 'transform', { set(v) { writes.push(v); }, get() { return writes[writes.length - 1] || ''; } });
    bindBottomBounce(() => fakeWin, target, opts);
    fakeWin._fire('touchstart', { touches: [{ clientY: 600 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 480 }] });
    const lift = Math.max(0, ...writes.map(w => { const m = /translateY\(-([\d.]+)px\)/.exec(w || ''); return m ? +m[1] : 0; }));
    fakeWin._fire('touchend', {});
    return lift;
  }
  assert(dragUp('chat', { isActive: deny }) === 0,
    '4j-1: data-tab="chat" — the window bottom-bounce binder, bound with the Chat denylist, writes NO lift on an upward drag (v0.27.1 tree: ~20px on every drag)');
  assert(dragUp('picks', { isActive: deny }) > 5,
    `4j-2: data-tab="picks" — the SAME binder, SAME drag, still bounces (anti-vacuity: the gate is a real predicate)`);
  for (const tab of ['dashboard', 'leaderboard', 'commissioner', 'rules', 'admin']) {
    assert(dragUp(tab, { isActive: deny }) > 5, `4j-2-${tab}: data-tab="${tab}" keeps its T-29 bottom bounce — only Chat is denied`);
  }
  assert(dragUp('chat') > 5, '4j-3: with NO isActive supplied the binder is always-active (backward compatible) — which is exactly the leak on Chat');
  // bindScrollDirection(window) is also bound once and stays attached on Chat.
  // It listens to window 'scroll' only, and on Chat the root cannot scroll
  // (css RG-289 block; chatpagetest [A-4]/[A-12]…[A-17] measure scrollY 0
  // throughout), so it receives nothing there — pinned statically below.

  const { readFileSync } = await import('node:fs');
  const ng = readFileSync(new URL('./js/nav-gestures.js', import.meta.url), 'utf8');
  const bb = ng.slice(ng.indexOf('export function bindBottomBounce'), ng.indexOf('export function bindBottomBounce') + 2600);
  assert(/export function bindBottomBounce\(getScrollEl, target, opts = \{\}\)/.test(bb) &&
    /function onTouchStart[\s\S]*?typeof isActive === 'function' && !isActive\(\)[\s\S]*?readScrollPos\(/.test(bb),
    '4j-4: bindBottomBounce() takes opts.isActive and checks it inside onTouchStart BEFORE any scroll-position read (RG-285\'s placement)');
  const app = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const nav = app.slice(app.indexOf('const getScrollEl = tab === \'chat\''), app.indexOf('// T-27 (DI-325) — B-02'));
  assert(nav.length > 500, '4j-5 fixture: found navigateTo()\'s per-tab gesture wiring in js/app.js');
  const chatBranch = nav.slice(nav.indexOf("if (tab === 'chat') {"), nav.indexOf('} else {'));
  const otherBranch = nav.slice(nav.indexOf('} else {'));
  assert(!/bindBottomBounce\(|bindPullToRefresh\(/.test(chatBranch),
    '4j-6: the Chat branch binds NO window pull-to-refresh and NO bottom bounce of its own');
  assert(/bindBottomBounce\(getScrollEl,[^;]*isActive:\s*\(\)\s*=>\s*document\.body\.dataset\.tab !== 'chat'/.test(otherBranch),
    '4j-7: the window bindBottomBounce() call passes the Chat DENYLIST (tab !== \'chat\') — mutation: deleting the option goes red here and in chatpagetest [A-7]/[A-8]/[A-10]');
  assert(/bindBottomPullToRefresh\(getScrollEl, null,/.test(chatBranch),
    '4j-8: Chat\'s pull-up is bound with NO rubber-band target — arming it at the newest message no longer lifts header, thread and composer together (chatpagetest [A-20])');

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5] DI-325 T-27 — week-swipe resolve (pure index math)…');
// ═════════════════════════════════════════════════════════════════════════
{
  const weeks = ['w1', 'w2', 'w3', 'w4'];

  assert(_weekSwipeResolve(weeks, 'w2', 50) === 'w1',
    '5a: left-to-right (positive dx) past commit -> PREVIOUS week (matches the ‹ arrow semantics)');
  assert(_weekSwipeResolve(weeks, 'w2', -50) === 'w3',
    '5b: right-to-left (negative dx) past commit -> NEXT week');
  assert(_weekSwipeResolve(weeks, 'w2', 20) === null,
    '5c: below SWIPE_COMMIT_PX (40) -> no resolution, null');
  assert(_weekSwipeResolve(weeks, 'w1', 50) === null,
    '5d: at the FIRST week, a left-to-right swipe (asking for "previous") returns null — no week beyond the ends');
  assert(_weekSwipeResolve(weeks, 'w4', -50) === null,
    '5e: at the LAST week, a right-to-left swipe (asking for "next") returns null');
  assert(_weekSwipeResolve(weeks, 'w4', 50) === 'w3',
    '5f: at the last week, swiping the OTHER direction still resolves normally');
  assert(_weekSwipeResolve([], 'w1', 50) === null, '5g: an empty week list never resolves');
  assert(_weekSwipeResolve(weeks, 'nope', 50) === null, '5h: an unknown current id never resolves');
  assert(_weekSwipeResolve(weeks, 'w2', -SWIPE_COMMIT_PX) === 'w3',
    '5i: exactly at the commit threshold still resolves (>= not >)');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5j] v0.27.0 — ONE direction table on Picks AND Dashboard (Drew, 2026-09-27: "The right left swipe on the dashboard is backwards")…');
// ═════════════════════════════════════════════════════════════════════════
// ROOT CAUSE: _weekSwipeResolve()'s index math assumes an OLDEST→NEWEST list
// (dx<0 → idx+1 = next week). picksNavWeeks() sorts ascending, so Picks was
// right; selectableDashboardWeeks() sorts NEWEST FIRST (it feeds the week
// <select>), and the Dashboard binder handed that list straight in — so on the
// Dashboard swipe-left walked BACK a week. [5] above only ever tested an
// already-ascending list; nothing asked what the two binders actually pass.
//
// This drives the REAL binder state getters out of js/app.js (extracted, the
// [11n-real] technique — this file does not import app.js) with the REAL list
// builders, through the REAL bindWeekSwipe() and synthetic touches.
{
  const { readFileSync } = await import('node:fs');
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const fnSrc = (sig) => {
    const at = appSrc.indexOf(sig);
    if (at < 0) return null;
    const end = appSrc.indexOf('\n}\n', at);
    return appSrc.slice(at, end + 2);
  };
  const getterSrc = (pageId) => {
    const at = appSrc.indexOf(`bindWeekSwipe(document.getElementById('${pageId}'), `);
    if (at < 0) return null;
    const from = at + `bindWeekSwipe(document.getElementById('${pageId}'), `.length;
    const to = appSrc.indexOf(', (targetId) =>', from);
    return to > from ? appSrc.slice(from, to) : null;
  };
  const picksNavSrc = fnSrc('function picksNavWeeks() {');
  // REVIEWER ROUND 3 (B4 residual) — the Picks getter now resolves its
  // starting week through picksShowingWeek(), the resolver renderPicksPage()
  // shares; extracted alongside the list builders.
  const picksShowingSrc = fnSrc('function picksShowingWeek() {');
  const dashSelSrc = fnSrc('export function selectableDashboardWeeks(').replace(/^export /, '');
  const picksGetter = getterSrc('page-picks');
  const dashGetter = getterSrc('page-dashboard');
  assert(!!picksNavSrc && !!picksShowingSrc && !!dashSelSrc && !!picksGetter && !!dashGetter,
    '5j-pre: fixture — picksNavWeeks(), selectableDashboardWeeks() and both bindWeekSwipe() state getters were extracted from js/app.js');

  // A season whose store order is deliberately scrambled — neither builder
  // may lean on insertion order.
  const WEEKS = [
    { weekId: 'w3', season: 2026, weekNumber: 3, status: 'final' },
    { weekId: 'w1', season: 2026, weekNumber: 1, status: 'final' },
    { weekId: 'w4', season: 2026, weekNumber: 4, status: 'open' },
    { weekId: 'w2', season: 2026, weekNumber: 2, status: 'final' },
  ];
  const WEEK_STATUS = { DRAFT: 'draft' };
  const build = (getterBody, state) => new Function(
    'getWeeks', 'getSession', 'getCurrentWeek', 'WEEK_STATUS', 'state', 'chronologicalWeekIds', 'getWeek',
    `${picksNavSrc}\n${picksShowingSrc}\n${dashSelSrc}\nreturn (${getterBody});`
  )(() => WEEKS.slice(), () => ({ isAdmin: false }), () => WEEKS.find(w => w.weekId === 'w4'),
    WEEK_STATUS, state, NG.chronologicalWeekIds, (id) => WEEKS.find(w => w.weekId === id) || null);

  const swipe = (getState, fromX, toX) => {
    const handlers = {};
    // DI-409 — bindWeekSwipe() writes a CSS custom property + a dataset
    // flag; this fixture's fake root grew `style`/`dataset` accordingly.
    // REVIEWER ROUND 2 (N3, B5) — onNavigate() now fires SYNCHRONOUSLY at
    // commit (no longer deferred behind an exit transitionend, per B5's
    // rebuilt commitSlide()), so the synthetic `transitionend` fired below
    // is no longer load-bearing for `navigated` to resolve — it is kept
    // only to settle the (single) commit transition's own fallback/cleanup
    // cleanly, harmlessly. This helper is testing DIRECTION correctness,
    // not the animation timing (5k/5o above own that).
    const root = {
      style: { setProperty() {} },
      dataset: {},
      addEventListener: (t, fn) => { handlers[t] = fn; },
      removeEventListener() {},
    };
    let navigated = null;
    const unbind = NG.bindWeekSwipe(root, getState, (id) => { navigated = id; });
    handlers.touchstart({ touches: [{ clientX: fromX, clientY: 300 }] });
    handlers.touchmove({ touches: [{ clientX: fromX + (toX - fromX) / 2, clientY: 300 }] });
    handlers.touchmove({ touches: [{ clientX: toX, clientY: 300 }] });
    handlers.transitionend?.({ target: root }); // completes the commit-exit half, if one started
    handlers.touchend({});
    unbind();
    return navigated;
  };
  const LEFT = [260, 160];   // finger moves right→left
  const RIGHT = [160, 260];  // finger moves left→right

  // DI-426 (2026-09-28) — state.picksWeekId/state.dashboardWeekId unified
  // into ONE shared state.viewingWeekId; the extracted getter source (below)
  // now literally reads that shared field.
  let picksGet = null, dashGet = null;
  try { picksGet = build(picksGetter, { viewingWeekId: 'w2' }); } catch (e) { /* reported below */ }
  try { dashGet = build(dashGetter, { viewingWeekId: 'w2' }); } catch (e) { /* reported below */ }
  assert(typeof picksGet === 'function' && typeof dashGet === 'function',
    '5j-pre2: fixture — both extracted state getters compile against the real list builders');
  assert(/tab:\s*'picks'/.test(picksGetter || '') && /tab:\s*'dashboard'/.test(dashGetter || ''),
    "5j-pre3: [structural, DI-419] BOTH app.js binders' getState() returns now carry their own `tab` literal — the drawer/week-swipe arbitration's own per-call read");

  const pl = picksGet && swipe(picksGet, ...LEFT), pr = picksGet && swipe(picksGet, ...RIGHT);
  const dl = dashGet && swipe(dashGet, ...LEFT), dr = dashGet && swipe(dashGet, ...RIGHT);
  assert(pl === 'w3', `5j-a: PICKS, viewing week 2, swipe LEFT → NEXT week (w3) (got ${pl})`);
  assert(pr === 'w1', `5j-b: PICKS, viewing week 2, swipe RIGHT → PREVIOUS week (w1) (got ${pr})`);
  assert(dl === 'w3', `5j-c: DASHBOARD, viewing week 2, swipe LEFT → NEXT week (w3) — the reported defect walked BACK to w1 (got ${dl})`);
  assert(dr === 'w1', `5j-d: DASHBOARD, viewing week 2, swipe RIGHT → PREVIOUS week (w1) (got ${dr})`);
  assert(pl === dl && pr === dr, '5j-e: the two tabs resolve the SAME gesture to the SAME week — one direction table');

  // The shared normalizer itself: order-independent, season-aware.
  const ids = NG.chronologicalWeekIds?.([
    { weekId: 'b2', season: 2027, weekNumber: 2 }, { weekId: 'a9', season: 2026, weekNumber: 9 },
    { weekId: 'b1', season: 2027, weekNumber: 1 },
  ]);
  assert(JSON.stringify(ids) === JSON.stringify(['a9', 'b1', 'b2']),
    `5j-f: chronologicalWeekIds() orders OLDEST→NEWEST by season then weekNumber, whatever order it is handed (got ${JSON.stringify(ids)})`);
  assert(/weekIds:\s*chronologicalWeekIds\(/.test(picksGetter || '') && /weekIds:\s*chronologicalWeekIds\(/.test(dashGetter || ''),
    '5j-g: [structural] BOTH app.js binders hand bindWeekSwipe() their ids through chronologicalWeekIds() — neither passes its own list order raw');

  // 5j-h: REVIEWER ROUND 2 (N2, 2026-09-28) — the Dashboard swipe's OWN
  // onNavigate() callback must null-normalize a target that resolves to
  // the CURRENT week, exactly like the arrows (bindDashboardWeekNav()) and
  // the Picks swipe callback already do — so every writer of the shared
  // state.viewingWeekId agrees on what "current" looks like.
  const dashOnNavStart = appSrc.indexOf(', (targetId) =>', appSrc.indexOf(`bindWeekSwipe(document.getElementById('page-dashboard'), `));
  const dashOnNavBody = appSrc.slice(dashOnNavStart, appSrc.indexOf('});', dashOnNavStart));
  assert(dashOnNavStart > 0 && dashOnNavBody.length > 0, '5j-h-pre: fixture — the Dashboard swipe\'s onNavigate() callback body was located');
  assert(/state\.viewingWeekId\s*=\s*\(targetId === cur\?\.weekId\)\s*\?\s*null\s*:\s*targetId;/.test(dashOnNavBody),
    `5j-h: [structural] the Dashboard swipe's onNavigate() null-normalizes a target equal to the current week, same shape as the Picks swipe/arrows (body: ${JSON.stringify(dashOnNavBody.slice(0, 200))})`);
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5k] DI-409 (UN-364) — week-swipe VISUAL layer, BINDER-level…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow = globalThis.window;

  function makeFakeWeekSwipeRoot() {
    const handlers = {};
    const props = {};
    return {
      dataset: {},
      style: { setProperty: (k, v) => { props[k] = v; } },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _props: props,
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
    };
  }
  const ts5k = (root, x, y) => root._fire('touchstart', { touches: [{ clientX: x, clientY: y }] });
  const tm5k = (root, x, y) => root._fire('touchmove', { touches: [{ clientX: x, clientY: y }] });
  const te5k = (root) => root._fire('touchend', {});
  const WEEKS5K = ['w1', 'w2', 'w3', 'w4'];
  // DI-419 (2026-09-28) — `tab: 'picks'` (the realistic case; bindWeekSwipe()
  // is only ever used for Picks/Dashboard in production, never Chat) so this
  // section's own visual-layer assertions (drag-follow/commit/cancel — all
  // pre-dating DI-419) are unaffected by the drawer-zone yield check; no
  // `window.innerWidth` is set in this file's default environment, so
  // isInDrawerOpenZone() fails CLOSED here regardless (width<=0) — [5m],
  // below, is the dedicated zone-arbitration section.
  const getState5k = () => ({ weekIds: WEEKS5K, currentWeekId: 'w2', tab: 'picks' });

  // 5k-a: dragging, below commit threshold — raw 1:1 px tracking, transition OFF.
  {
    const root = makeFakeWeekSwipeRoot();
    bindWeekSwipe(root, getState5k, () => {});
    ts5k(root, 200, 300);
    tm5k(root, 220, 300); // dx=20 — past AXIS_DEAD_ZONE(8), below SWIPE_COMMIT_PX(40)
    assert(root._props['--week-swipe-x'] === '20px',
      `5k-a1: mid-drag, below commit threshold — raw 1:1 px tracking (got ${root._props['--week-swipe-x']})`);
    assert(root.dataset.weekSwipeAnimating === undefined,
      '5k-a2: no [data-week-swipe-animating] during raw drag-follow — the transition stays OFF (no easing; "a transition here would read as latency, not polish")');
    te5k(root);
  }

  // 5k-b: cancelling (release below threshold) — springs back WITH the
  // transition, no haptic. MUTATION-PROOF for "a version that skips the
  // cancel spring": a mutant that removed springBack()'s two calls would
  // leave --week-swipe-x at its last dragged value ("15px") and/or never
  // set the animating attribute — either assertion below goes red on it.
  {
    globalThis.window = {}; // no Capacitor — haptic() is a documented no-op regardless
    const root = makeFakeWeekSwipeRoot();
    bindWeekSwipe(root, getState5k, () => {});
    ts5k(root, 200, 300);
    tm5k(root, 215, 300); // dx=15 — past dead-zone, below commit
    assert(root._props['--week-swipe-x'] === '15px', '5k-b0: fixture — mid-drag before release');
    te5k(root);
    assert(root._props['--week-swipe-x'] === '0px',
      '5k-b1: cancelling springs the transform back to translateX(0) — MUTATION: a version that skips the cancel spring leaves this at "15px"');
    assert(root.dataset.weekSwipeAnimating === 'bounce',
      '5k-b2: [DI-420] cancelling turns the transition ON with the "bounce" kind (Small-feedback bucket, --motion-fast/150ms) — MUTATION: skipping the spring leaves this attribute unset (an instant, untransitioned snap); a version that used "commit"\'s Navigation-bucket duration here instead would also be wrong (an aborted drag is feedback, not a navigation)');
  }

  // 5k-c: REVIEWER ROUND 2 (B5 BLOCK, coordinator ruling, 2026-09-28) —
  // REBUILT. Round 1's two-phase design (exit transition -> transitionend
  // -> onNavigate() -> enter transition, ~520ms total) is gone. Now:
  // committing fires haptic('light') AND calls onNavigate() SYNCHRONOUSLY
  // (no clone is possible against this bare fixture — no parentNode/
  // getBoundingClientRect — so the "clone the outgoing content" step no-ops
  // and root's real content is swapped immediately; [5o], below, exercises
  // the clone path with a fixture that supports it), then a SINGLE
  // --motion-nav (260ms) transition carries root from the opposite edge to
  // 0. With no requestAnimationFrame in this test environment, that single
  // transition's OWN "start" write and its own scheduling both run
  // synchronously too, so by the time this touchmove call returns,
  // --week-swipe-x already reads its FINAL '0px' (this file's own
  // established idiom, e.g. 5k-c/j/k below) — the fallback timer / real
  // transitionend is what clears the animating attribute and releases
  // `busy`, ONCE, not twice.
  {
    const calls = [];
    globalThis.window = {
      Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => calls.push(o) } } },
    };
    const root = makeFakeWeekSwipeRoot();
    let navigated = null;
    bindWeekSwipe(root, getState5k, (id) => { navigated = id; });
    ts5k(root, 260, 300);
    tm5k(root, 160, 300); // dx=-100 — negative = "next week" = w3, well past commit
    // RG-TBD-A1 (2026-09-29) — nothing commits while the finger is down: the
    // page is still following it, 60 px past the old mid-drag commit point.
    assert(navigated === null && root._props['--week-swipe-x'] === '-100px' && calls.length === 0,
      `5k-c0: [RG-TBD-A1] 100 px into the drag, the finger is still down — NO navigation, NO haptic, the page follows it 1:1 (navigated ${navigated}, x ${root._props['--week-swipe-x']}, haptics ${calls.length}); v0.27.2 committed here, at the 40 px crossing`);
    te5k(root);           // release — past SWIPE_COMMIT_PX: commits NOW
    assert(navigated === 'w3',
      `5k-c1: [B5 + RG-TBD-A1] onNavigate() fires SYNCHRONOUSLY at RELEASE — no more waiting on a separate exit transition (got ${navigated})`);
    assert(calls.length === 1 && calls[0].style === 'LIGHT',
      `5k-c2: haptic('light') fires at the commit instant, not the drifted 'selection' (got ${JSON.stringify(calls)})`);
    assert(root._props['--week-swipe-x'] === '0px',
      `5k-c3: with no requestAnimationFrame in this test environment, the ONE simultaneous-slide transition resolves synchronously straight to translateX(0) (got ${root._props['--week-swipe-x']})`);
    assert(root.dataset.weekSwipeAnimating === 'commit',
      '5k-c4: [DI-420] the (single) commit transition animates with the "commit" kind (Navigation bucket, --motion-nav/260ms), still playing');
    root._fire('transitionend', { target: root }); // the ONE transition completes
    assert(root.dataset.weekSwipeAnimating === undefined,
      '5k-c5: transitionend clears the animating attribute — ONE window, not two');
    // busy released — a fresh drag right after the ONE transition completes
    // is accepted, not silently dropped by a busy guard latched across a
    // second phase that no longer exists.
    ts5k(root, 260, 300);
    tm5k(root, 240, 300); // dx=-20 — a plain sub-commit drag
    assert(root._props['--week-swipe-x'] === '-20px',
      `5k-c6: MUTATION PROOF (B5): a fresh drag right after the ONE transition completes is accepted (busy released) (got ${root._props['--week-swipe-x']})`);
    te5k(root);
  }

  // 5k-d: at an end of the list — the boundary check switches 1:1 tracking
  // to the rubber-band curve DURING the drag (before any commit threshold),
  // and NEVER commits there, however far past SWIPE_COMMIT_PX the drag goes
  // — no navigation, no haptic (an edge is not a success), no early spring.
  // REVIEWER BLOCK B2 (round 2, 2026-09-28) — this used to encode the WRONG
  // behaviour: crossing 40px at a bound sprang back IMMEDIATELY, mid-drag,
  // while the finger was still down (the page snapped back UNDER it), and
  // the offset never approached WEEK_SWIPE_BOUNCE_MAX_PX's own asymptote
  // because it was captured the instant the 40px threshold crossed (~23px).
  // The DI is explicit that spring-back happens ON RELEASE — rewritten to
  // prove exactly that: the rubber-band keeps growing past the old
  // (wrong) commit point, and only touchend/clear() springs it back.
  {
    const calls = [];
    globalThis.window = {
      Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => calls.push(o) } } },
    };
    const root = makeFakeWeekSwipeRoot();
    let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5K, currentWeekId: 'w1', tab: 'picks' }), (id) => { navigated = id; });
    ts5k(root, 100, 300);
    tm5k(root, 130, 300); // dx=30 ("previous" direction) — w1 is already the first week
    const rb1 = root._props['--week-swipe-x'];
    assert(typeof rb1 === 'string' && rb1.endsWith('px') && parseFloat(rb1) > 0 && parseFloat(rb1) < 30,
      `5k-d1: at the list's first week, dragging "previous" further is RESISTED (rubber-band offset < raw dx) (got ${rb1})`);
    tm5k(root, 200, 300); // dx=100 — well past SWIPE_COMMIT_PX, still at the bound
    assert(navigated === null, '5k-d2: crossing SWIPE_COMMIT_PX while still at the bound does NOT navigate');
    assert(calls.length === 0, '5k-d3: …and never fires a haptic either — an edge is not a success');
    const rb2 = root._props['--week-swipe-x'];
    assert(typeof rb2 === 'string' && rb2.endsWith('px') && rb2 !== '0px',
      `5k-d4: MUTATION PROOF (B2): crossing the commit threshold at a bound does NOT spring back immediately either — a version with the old early-spring bug would show "0px" here already (got ${rb2})`);
    assert(parseFloat(rb2) > parseFloat(rb1),
      `5k-d5: …the rubber-band keeps growing the further the (still-down) finger drags, never capped at the old early-commit point (got ${rb2} vs ${rb1})`);
    tm5k(root, 260, 300); // dx=160 — dragging further still, well past the old 40px trigger
    const rb3 = parseFloat(root._props['--week-swipe-x']);
    assert(rb3 > parseFloat(rb2) && rb3 < WEEK_SWIPE_BOUNCE_MAX_PX,
      `5k-d6: …and keeps approaching WEEK_SWIPE_BOUNCE_MAX_PX (48px) rather than being stuck at the ~23px the old early-commit bug capped it at (got ${rb3})`);
    te5k(root); // release — ONLY NOW does it spring back (clear()'s springBack(), per the DI)
    assert(root._props['--week-swipe-x'] === '0px',
      '5k-d7: …and releasing at the bound springs back to 0 — the DI\'s "spring back happens ON RELEASE," now true here');
    assert(navigated === null, '5k-d8: …still never navigated, through the whole sequence');
  }

  // 5k-e: Reduce Motion — RG-TBD-A1 under the coordinator-approved rule
  // (2026-09-29, the same one the chat reply swipe follows): the content
  // ALWAYS tracks the finger during the drag; the RELEASE never animates
  // movement — a commit cross-fades, a cancel settles immediately. The OFF
  // path is 5k-a/5k-b/5k-c above (tracking, "bounce" spring, "commit"
  // slide); this block is the ON path, and 5k-e5..7 run the SAME gestures
  // both ways side by side.
  {
    const savedMatchMedia = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: true });
    globalThis.window = {}; // no Capacitor
    const root = makeFakeWeekSwipeRoot();
    let navigated = null;
    bindWeekSwipe(root, getState5k, (id) => { navigated = id; });
    ts5k(root, 260, 300); // C2's touchstart reset writes '0px' here — expected baseline, not "no write at all"
    assert(root._props['--week-swipe-x'] === '0px', '5k-e0: fixture — touchstart\'s own C2 reset baseline');
    tm5k(root, 240, 300); // dx=-20 — past dead-zone, below commit
    assert(root._props['--week-swipe-x'] === '-20px',
      `5k-e1: [Reduce Motion rule] prefers-reduced-motion STILL tracks the finger 1:1 during the drag — MUTATION: the DI-409 version that switched tracking off under reduced motion leaves this at "0px" (the "it just jumps" Drew reported) (got ${root._props['--week-swipe-x']})`);
    tm5k(root, 160, 300); // dx=-100 (from start) — past commit, finger still down
    assert(navigated === null && root._props['--week-swipe-x'] === '-100px',
      `5k-e2-pre: [RG-TBD-A1] …no navigation while the finger is down, and the week is still under it (navigated ${navigated}, x ${root._props['--week-swipe-x']})`);
    te5k(root);           // release — commits
    assert(navigated === 'w3',
      `5k-e2: …and release navigates (got ${navigated})`);
    assert(root.dataset.weekSwipeAnimating === 'fade' && root._props['--week-swipe-x'] === '0px',
      `5k-e3: [RG-TBD-A1, amends DI-409's instant swap] under reduced motion the commit CROSS-FADES ("fade" kind, opacity only — root is placed straight back at 0, never a "commit" slide) — MUTATION: a version that ignores reduced motion shows "commit" here (got ${root.dataset.weekSwipeAnimating}, x ${root._props['--week-swipe-x']})`);
    root._fire('animationend', { target: root });
    assert(root.dataset.weekSwipeAnimating === undefined, '5k-e4: …and the fade clears itself on its own animationend');
    globalThis.matchMedia = savedMatchMedia;
  }
  // 5k-e5..7: the SAME short drag and release, Reduce Motion OFF vs ON.
  {
    const savedMatchMedia = globalThis.matchMedia;
    const run = (reduce) => {
      globalThis.matchMedia = () => ({ matches: reduce });
      globalThis.window = {};
      const root = makeFakeWeekSwipeRoot();
      let navigated = null;
      bindWeekSwipe(root, getState5k, (id) => { navigated = id; });
      ts5k(root, 260, 300); tm5k(root, 245, 300); tm5k(root, 230, 300);   // dx=-30, short of the 40 px threshold
      const during = root._props['--week-swipe-x'];
      te5k(root);
      const out = { during, after: root._props['--week-swipe-x'], kind: root.dataset.weekSwipeAnimating, navigated };
      root._fire('transitionend', { target: root });
      return out;
    };
    const off = run(false), on = run(true);
    globalThis.matchMedia = savedMatchMedia;
    assert(off.during === '-30px' && on.during === '-30px',
      `5k-e5: the drag tracks the finger identically with Reduce Motion OFF and ON (${off.during} / ${on.during})`);
    assert(off.after === '0px' && off.kind === 'bounce' && off.navigated === null,
      `5k-e6: OFF — a short release SPRINGS back ("bounce", --motion-fast) and stays on the week (kind ${off.kind})`);
    assert(on.after === '0px' && on.kind === undefined && on.navigated === null,
      `5k-e7: ON — the same release SETTLES immediately: back at 0 with no spring animation at all (kind ${on.kind}) — MUTATION: a spring under Reduce Motion shows "bounce"`);
  }

  // 5k-f: a vertical-locked drag never touches the transform. MUTATION-PROOF
  // for "a version that lets a vertical drag translate": axis locks to 'y'
  // on the first move past the dead zone (dy dominates dx) and stays locked
  // for the rest of the gesture, however far it later drifts horizontally.
  {
    globalThis.window = {};
    const root = makeFakeWeekSwipeRoot();
    let navigated = null;
    bindWeekSwipe(root, getState5k, (id) => { navigated = id; });
    ts5k(root, 200, 300); // C2's touchstart reset writes '0px' here — expected baseline
    tm5k(root, 205, 340); // dx=5, dy=40 -> locks to 'y'
    tm5k(root, 260, 340); // a big dx too, now — but axis is already locked to 'y'
    assert(root._props['--week-swipe-x'] === '0px',
      `5k-f1: a vertical-locked drag never MOVES --week-swipe-x past touchstart's own baseline — MUTATION: a version that lets a vertical drag translate would set this once dx grows large (got ${root._props['--week-swipe-x']})`);
    assert(navigated === null, '5k-f2: …and never navigates either — week-swipe only ever engages on the x axis');
    te5k(root);
    assert(root.dataset.weekSwipeAnimating === undefined,
      '5k-f3: releasing a vertical-locked drag does not spring anything back either — nothing was ever dragged on this axis');
  }

  // 5k-g: the pure helpers, directly.
  assert(_weekSwipeAtBound(WEEKS5K, 'w1', 50) === true, '5k-g1: _weekSwipeAtBound() — at the first week, the "previous" direction is at-bound');
  assert(_weekSwipeAtBound(WEEKS5K, 'w1', -50) === false, '5k-g2: …but the "next" direction is not');
  assert(_weekSwipeAtBound(WEEKS5K, 'w4', -50) === true, '5k-g3: …and at the last week, the "next" direction is at-bound');
  assert(_weekSwipeAtBound(WEEKS5K, 'w2', 50) === false, '5k-g4: …a middle week is never at-bound in either direction');
  assert(_weekSwipeAtBound(WEEKS5K, 'w2', -50) === false, '5k-g5: (other direction, same middle week)');
  assert(_weekSwipeRubberBand(0) === 0, '5k-g6: _weekSwipeRubberBand(0) === 0 — same "zero at zero" contract as _rubberBandOffset()');
  const rbBig = _weekSwipeRubberBand(50000);
  assert(rbBig > 0 && WEEK_SWIPE_BOUNCE_MAX_PX - rbBig < 0.1,
    `5k-g7: _weekSwipeRubberBand() asymptotically approaches WEEK_SWIPE_BOUNCE_MAX_PX, never RUBBER_BAND_CAP_PX — the same curve, reused at a different cap (got ${rbBig})`);
  assert(WEEK_SWIPE_BOUNCE_MS === 150, "5k-g8: WEEK_SWIPE_BOUNCE_MS matches css/styles.css's --motion-fast (150ms) — one animation language");

  // 5k-h: C1 (reviewer round 2, DI-409) — an exception inside onNavigate (a
  // render function throwing) must not strand the page with the busy guard
  // latched forever. REVIEWER ROUND 2 (B5) — onNavigate() now runs
  // SYNCHRONOUSLY inside the touchmove handler itself (no more waiting on
  // an exit transitionend), so a throw now propagates straight OUT of the
  // touchmove call, not out of a later `root._fire('transitionend', ...)`.
  {
    globalThis.window = {};
    const root = makeFakeWeekSwipeRoot();
    bindWeekSwipe(root, getState5k, () => { throw new Error('render exploded'); });
    ts5k(root, 260, 300);
    let threw = false;
    try {
      tm5k(root, 160, 300); // dx=-100 — past commit; RG-TBD-A1: nothing commits until release
      te5k(root);           // release commits; onNavigate throws SYNCHRONOUSLY (B5)
    } catch (e) {
      threw = true;
    }
    assert(threw, '5k-h1: a throwing onNavigate propagates — the binder does not silently swallow the caller\'s error');
    assert(root._props['--week-swipe-x'] === '0px',
      `5k-h2: …but the transform is still reset to translateX(0) rather than stranded off-screen (got ${root._props['--week-swipe-x']})`);
    assert(root.dataset.weekSwipeAnimating === undefined, '5k-h3: …the animating attribute is cleared too');
    // busy released — a fresh drag right after the throw is accepted, not
    // silently dropped by the busy guard staying latched forever.
    ts5k(root, 260, 300);
    tm5k(root, 240, 300); // dx=-20 — below commit, a plain sub-drag to prove touchstart was accepted
    assert(root._props['--week-swipe-x'] === '-20px',
      `5k-h4: MUTATION PROOF (C1): a fresh drag right after the throw is accepted (busy released) — a version that skips the catch-block reset would still show "0px"/never move here (got ${root._props['--week-swipe-x']})`);
    te5k(root);
  }

  // 5k-i: C2 (reviewer round 2) — a fresh touchstart always resets any
  // stale live-drag value first, protecting against a background re-render
  // mid-drag replacing the touched node before its own touchend/
  // touchcancel ever arrives (the old node simply goes away, mid-gesture).
  {
    globalThis.window = {};
    const root = makeFakeWeekSwipeRoot();
    bindWeekSwipe(root, getState5k, () => {});
    ts5k(root, 200, 300);
    tm5k(root, 230, 300); // dx=30 — mid-drag, never released (simulating a detached node)
    assert(root._props['--week-swipe-x'] === '30px', '5k-i0: fixture — mid-drag, no touchend ever delivered');
    ts5k(root, 200, 300); // a fresh touchstart, as if a NEW gesture just began
    assert(root._props['--week-swipe-x'] === '0px',
      `5k-i1: MUTATION PROOF (C2): a fresh touchstart resets any stale live-drag value first — a version that skips this reset would still show "30px" here (got ${root._props['--week-swipe-x']})`);
  }

  // 5k-j: B1 (reviewer round 2) — the enter half's opposite-edge starting
  // position must be FLUSHED (a forced reflow) before the transition is
  // turned back on, or the browser can collapse the two writes into one
  // and animate from the WRONG edge (proven on the fallback-timer path;
  // likely on the normal path on iOS too, since WebKit can dispatch a
  // requestAnimationFrame callback before flushing an intervening style
  // write within the same frame). Driven with an instrumented root that
  // logs every style/dataset write and every `offsetWidth` READ, in order.
  {
    globalThis.window = {};
    const log = [];
    const styleProps = {};
    const datasetTarget = {};
    const dataset = new Proxy(datasetTarget, {
      set(target, prop, value) { log.push({ op: 'animating-set', value }); target[prop] = value; return true; },
      deleteProperty(target, prop) { log.push({ op: 'animating-delete' }); delete target[prop]; return true; },
      get(target, prop) { return target[prop]; },
    });
    const handlers = {};
    const root = {
      dataset,
      style: { setProperty: (k, v) => { log.push({ op: 'setX', value: v }); styleProps[k] = v; } },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
      _props: styleProps,
    };
    Object.defineProperty(root, 'offsetWidth', { get() { log.push({ op: 'reflow-read' }); return 300; } });

    let navigated = null;
    bindWeekSwipe(root, getState5k, (id) => { navigated = id; });
    ts5k(root, 260, 300);
    // REVIEWER ROUND 2 (B5) — the whole sequence (off-screen position write,
    // forced reflow, transition re-enabled) now runs in ONE synchronous
    // pass inside the touchmove handler itself (no rAF in Node, and no
    // longer gated behind an exit transitionend at all) — the ORDERING
    // GUARANTEE B1 established is unchanged, only WHEN it happens moved
    // earlier.
    tm5k(root, 160, 300); // dx=-100 — the page follows the finger to -100px
    te5k(root);           // RG-TBD-A1 — release commits
    assert(navigated === 'w3', `5k-j0: fixture — the commit completed synchronously (got ${navigated})`);

    // RG-TBD-A1 — the commit now starts from where the finger let go
    // (-100px painted), so the opposite-edge write is "100%" less that live
    // offset (N-a's flush start): calc(100% - 100px).
    const oppositeEdgeIdx = log.findIndex(e => e.op === 'setX' && (e.value === '100%' || e.value === 'calc(100% - 100px)')); // -exitPct% (exitPct=-100)
    const reflowIdx = log.findIndex((e, i) => e.op === 'reflow-read' && i > oppositeEdgeIdx);
    const finalAnimatingIdx = log.findIndex((e, i) => e.op === 'animating-set' && e.value === 'commit' && i > (reflowIdx === -1 ? oppositeEdgeIdx : reflowIdx));
    assert(oppositeEdgeIdx !== -1, `5k-j1: fixture — the opposite-edge position write ("100%") happened (log: ${JSON.stringify(log)})`);
    assert(reflowIdx !== -1,
      `5k-j2: MUTATION PROOF (B1): a layout read (offsetWidth) happens after the opposite-edge write — a version that removes the forced reflow shows NO 'reflow-read' entry at all (log: ${JSON.stringify(log)})`);
    assert(reflowIdx > oppositeEdgeIdx,
      `5k-j3: …specifically AFTER the opposite-edge write, not before it (got reflow at ${reflowIdx}, opposite-edge write at ${oppositeEdgeIdx})`);
    assert(finalAnimatingIdx !== -1 && reflowIdx < finalAnimatingIdx,
      `5k-j4: …and BEFORE the transition re-enables (the "commit" kind lands) — the exact ordering that guarantees the off-screen start is resolved before the transition turns back on (reflow at ${reflowIdx}, animating-on at ${finalAnimatingIdx})`);
  }

  // 5k-k: DI-420 (2026-09-28, amends DI-409) — the split-duration constants,
  // and the "commit"/"bounce" kind is what actually drives the fallback
  // timer's OWN duration (not a shared literal): a commit-exit whose
  // transitionend never arrives falls back at WEEK_SWIPE_COMMIT_MS+60, NOT
  // WEEK_SWIPE_BOUNCE_MS+60 — proven by NEVER firing transitionend and
  // waiting real time.
  assert(WEEK_SWIPE_COMMIT_MS === 260, "5k-k1: WEEK_SWIPE_COMMIT_MS matches css/styles.css's --motion-nav (260ms) and #league-page-overlay's own commit-slide duration — the SAME navigation bucket Drew is citing");
  assert(WEEK_SWIPE_BOUNCE_MS === 150, '5k-k2: WEEK_SWIPE_BOUNCE_MS is UNCHANGED by DI-420 — the cancel/edge spring-back stays Small-feedback');
  {
    globalThis.window = {};
    const root = makeFakeWeekSwipeRoot();
    bindWeekSwipe(root, getState5k, () => {});
    ts5k(root, 200, 300);
    tm5k(root, 215, 300); // dx=15 — below commit; release cancels (the "bounce" kind)
    te5k(root);
    assert(root.dataset.weekSwipeAnimating === 'bounce', '5k-k3: fixture — a cancel is animating with the "bounce" kind');
    // MUTATION PROOF: the fallback timer for "bounce" fires at
    // WEEK_SWIPE_BOUNCE_MS+60 (210ms) — well before a "commit"-length
    // (260+60=320ms) timer would. Never fire transitionend; wait exactly
    // long enough for the BOUNCE fallback but well short of the COMMIT one.
    await new Promise(resolve => setTimeout(resolve, WEEK_SWIPE_BOUNCE_MS + 80));
    assert(root.dataset.weekSwipeAnimating === undefined,
      `5k-k4: MUTATION PROOF (DI-420): the "bounce" fallback timer cleared [data-week-swipe-animating] at its OWN (150+60ms) duration, not the longer "commit" one — a version that used WEEK_SWIPE_COMMIT_MS's fallback duration here regardless of kind would still show "bounce" at this point (got ${root.dataset.weekSwipeAnimating})`);
  }
  // REVIEWER ROUND 2 (B5) — REBUILT. There is now only ONE commit
  // transition (not an exit half + a separate enter half, each with their
  // own fallback timer) — onNavigate() already fired synchronously at
  // commit (5k-c), so the ONE fallback timer's only remaining job is
  // clearing [data-week-swipe-animating] and releasing `busy`.
  {
    globalThis.window = {};
    const root = makeFakeWeekSwipeRoot();
    let navigated = null;
    bindWeekSwipe(root, getState5k, (id) => { navigated = id; });
    ts5k(root, 260, 300);
    tm5k(root, 160, 300); // dx=-100
    te5k(root);           // RG-TBD-A1 — release commits (the "commit" kind)
    assert(navigated === 'w3', '5k-k5: [B5] onNavigate() already fired synchronously at commit — never gated behind the fallback timer');
    assert(root.dataset.weekSwipeAnimating === 'commit', '5k-k6: fixture — the (single) commit transition is animating with the "commit" kind');
    // Wait past the BOUNCE fallback duration (150+60=210ms) but well short
    // of the COMMIT one (260+60=320ms) — never fire transitionend.
    await new Promise(resolve => setTimeout(resolve, WEEK_SWIPE_BOUNCE_MS + 80));
    assert(root.dataset.weekSwipeAnimating === 'commit',
      `5k-k7: MUTATION PROOF (DI-420): the commit's OWN fallback timer has NOT fired yet at the bounce-length wait — a version that (wrongly) used WEEK_SWIPE_BOUNCE_MS's fallback duration for a commit would already show this cleared (got ${root.dataset.weekSwipeAnimating})`);
    // Now wait past the COMMIT fallback duration too — the ONE transition's
    // own fallback fires.
    await new Promise(resolve => setTimeout(resolve, (WEEK_SWIPE_COMMIT_MS - WEEK_SWIPE_BOUNCE_MS) + 80));
    assert(root.dataset.weekSwipeAnimating === undefined,
      `5k-k8: …and IS cleared by a full WEEK_SWIPE_COMMIT_MS+60 wait (got ${root.dataset.weekSwipeAnimating})`);
  }
  // 5k-k9 — STRUCTURAL: exactly ONE `afterTransition(..., WEEK_SWIPE_COMMIT_MS)`
  // call inside commitSlide() now (round 1 had two — an exit half and a
  // separate enter half) — the "one transition, not two" shape, proven
  // directly against the source rather than timing alone.
  {
    const { readFileSync } = await import('node:fs');
    const src5k = readFileSync(new URL('./js/nav-gestures.js', import.meta.url), 'utf8');
    const fnStart = src5k.indexOf('function commitSlide(dxAtCommit, targetWeekId) {');
    const fnBody = src5k.slice(fnStart, src5k.indexOf('\n  }\n', fnStart));
    assert(fnStart > 0 && fnBody.length > 0, '5k-k9-pre: fixture — commitSlide()\'s own function body was located');
    const commitCalls = (fnBody.match(/,\s*WEEK_SWIPE_COMMIT_MS\)/g) || []).length;
    assert(commitCalls === 1,
      `5k-k9: [structural, B5] exactly ONE afterTransition(...,WEEK_SWIPE_COMMIT_MS) call exists inside commitSlide() — a version with a second (an "enter half") would show 2 here (got ${commitCalls})`);
  }

  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5m] DI-419 (UN-374, Drew ruling A) — isInDrawerOpenZone(), the ONE shared drawer/week-swipe/reply-swipe arbitration predicate…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow5m = globalThis.window;

  // Pure predicate, directly — no DOM.
  assert(DRAWER_ZONE_FRACTION === 0.25, '5m-h: DRAWER_ZONE_FRACTION is 25% of the viewport, per Drew\'s own ruling ("a fraction of the viewport width (25%), not a pixel count")');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: 79, viewportWidthPx: 400 }) === true, '5m-a: Picks, 79px of 400 (19.75%) — inside the 25% zone');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: 100, viewportWidthPx: 400 }) === false, '5m-b: Picks, exactly 100px of 400 (the 25.0% boundary itself) is OUTSIDE — strict <, not <=');
  assert(isInDrawerOpenZone({ tab: 'dashboard', clientX: 50, viewportWidthPx: 400 }) === true, '5m-c: Dashboard uses the SAME 25% zone as Picks');
  assert(isInDrawerOpenZone({ tab: 'dashboard', clientX: 300, viewportWidthPx: 400 }) === false, '5m-d: …well outside it on Dashboard too');
  assert(isInDrawerOpenZone({ tab: 'chat', clientX: 399, viewportWidthPx: 400 }) === true, "5m-e: every OTHER tab — \"anywhere\" opens the drawer, per Drew's own ruling");
  assert(isInDrawerOpenZone({ tab: null, clientX: 0, viewportWidthPx: 400 }) === true, '5m-f: an unset/unknown tab reads as "not Picks/Dashboard" too — anywhere, never silently refusing the drawer everywhere');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: 50, viewportWidthPx: 0 }) === false, '5m-g: no viewport width to measure against fails CLOSED on Picks/Dashboard (week-swipe keeps ownership, never a surprise drawer-open)');

  // Drew's OWN named test, quoted in DI-419: "a synthetic touchstart at 20%
  // opens the drawer, at 30% navigates the week, both directions of
  // dispute." Driven through the REAL bindControlCenterEdgeSwipe()
  // (js/control-center.js) AND the REAL bindWeekSwipe() (this file) — two
  // independently-bound listeners (one on `window`, one on the page root)
  // fed the identical synthetic touch sequence, exactly as they would both
  // receive the same real DOM event in production (neither calls
  // stopPropagation — see chat-ui.js's own DI-427 note on this point).
  function makeFakeEventTarget5m(extra = {}) {
    const handlers = {};
    return {
      ...extra,
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
    };
  }
  const WEEKS5M = ['w1', 'w2', 'w3', 'w4'];
  function runGesture5m(startXFraction, endXFraction, opts = {}) {
    const width = 400;
    const startX = width * startXFraction, endX = width * endXFraction;
    // REVIEWER ROUND 2 (B3 BLOCK) — `opts.noCapacitor` drives the WEB case:
    // no Capacitor bridge at all, proving the drawer binder no longer needs
    // one (DI-301's native-only carve-out is amended).
    globalThis.window = makeFakeEventTarget5m(
      opts.noCapacitor ? { innerWidth: width } : { Capacitor: { isNativePlatform: () => true }, innerWidth: width },
    );

    let drawerDragStarted = false;
    const unbindDrawer = CC.bindControlCenterEdgeSwipe(
      (action) => { if (action.type === 'drag-start') drawerDragStarted = true; },
      () => ({ phase: 'closed', dragProgress: 0 }),
      { getWidthPx: () => 340, getTab: () => 'picks' },
    );
    let navigated = null;
    const weekRoot = makeFakeEventTarget5m({ dataset: {}, style: { setProperty() {} } });
    const unbindWeek = bindWeekSwipe(weekRoot, () => ({ weekIds: WEEKS5M, currentWeekId: 'w2', tab: 'picks' }), (id) => { navigated = id; });

    const seq = [
      ['touchstart', { touches: [{ clientX: startX, clientY: 300 }] }],
      ['touchmove', { touches: [{ clientX: startX + (endX - startX) / 2, clientY: 300 }] }],
      ['touchmove', { touches: [{ clientX: endX, clientY: 300 }] }],
    ];
    for (const [type, ev] of seq) { window._fire(type, ev); weekRoot._fire(type, ev); }
    weekRoot._fire('transitionend', { target: weekRoot }); // resolve a commit synchronously, if one started
    window._fire('touchend', {});
    weekRoot._fire('touchend', {});
    unbindDrawer(); unbindWeek();
    return { drawerDragStarted, navigated };
  }

  const r20 = runGesture5m(0.20, 0.50); // starts at 20% — inside the zone
  assert(r20.drawerDragStarted === true, "5m-i: Drew's own named test — a touchstart at 20% of the viewport is claimed by the drawer's own gesture (dispatch('drag-start') fires)");
  assert(r20.navigated === null, '5m-j: …and week-swipe never navigates for that SAME gesture — it yielded (no rubber-band, no commit)');

  const r30 = runGesture5m(0.30, 0.60); // starts at 30% — outside the zone
  assert(r30.drawerDragStarted === false, "5m-k: Drew's own named test — a touchstart at 30% is OUTSIDE the zone, so the drawer's touchstart-time arm check refuses it outright");
  assert(r30.navigated === 'w1', `5m-l: …and week-swipe DOES navigate for that SAME gesture (dx>0 = previous week) (got ${r30.navigated})`);

  // R→L regression — DI-419's own named carve-out: starting well inside the
  // drawer's zone (10%) but dragging RIGHT-TO-LEFT (next week) must never
  // strand week-swipe. (The drawer's OWN direction-agnostic axis-lock still
  // dispatches 'drag-start' for any horizontal drag starting in-zone,
  // R→L included — pre-existing, unrelated to this DI, and harmless: its
  // `progress` clamps to 0 for a negative dx, so it never visually opens.
  // The DI-419 claim under test is specifically that week-swipe is NEVER
  // stranded here, which is the one thing this DI actually changed.)
  const rLeft = runGesture5m(0.10, 0.10 - 60 / 400);
  assert(rLeft.navigated === 'w3', `5m-m: R→L carve-out — week-swipe still navigates to the NEXT week for a right-to-left drag starting deep inside the drawer's own zone (got ${rLeft.navigated})`);

  // REVIEWER ROUND 2 (B3 BLOCK, coordinator ruling, 2026-09-28) — the
  // IDENTICAL named test, on the WEB case specifically (no Capacitor bridge
  // at all): "L→R at 15% on Picks opens the drawer; at 30% goes to the
  // previous week." DI-301's native-only carve-out is amended — this must
  // now pass without any native bridge present.
  const web15 = runGesture5m(0.15, 0.45, { noCapacitor: true });
  assert(web15.drawerDragStarted === true, "5m-n: [B3] WEB (no Capacitor) — a touchstart at 15% of the viewport is claimed by the drawer's own gesture");
  assert(web15.navigated === null, '5m-o: …and week-swipe never navigates for that SAME web gesture — it yielded');

  const web30 = runGesture5m(0.30, 0.60, { noCapacitor: true });
  assert(web30.drawerDragStarted === false, '5m-p: [B3] WEB — a touchstart at 30% is OUTSIDE the zone, so the drawer refuses it outright, same as native');
  assert(web30.navigated === 'w1', `5m-q: …and week-swipe DOES navigate to the previous week for that SAME web gesture (got ${web30.navigated})`);

  globalThis.window = savedWindow5m;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5n] REVIEWER ROUND 2 (B2 BLOCK, coordinator ruling, 2026-09-28) — _isDrawerYieldTarget(): horizontal scrollers (with room to scroll back) and text fields also back off the drawer/week-swipe…');
// ═════════════════════════════════════════════════════════════════════════
{
  function makeScrollerTarget(selectorMatch, scrollLeft) {
    return { scrollLeft, closest(sel) { return String(sel).includes(selectorMatch) ? this : null; } };
  }
  function makeFieldTarget(tag) {
    return { closest(sel) { return String(sel).includes(tag) ? this : null; } };
  }

  // Each of the four named horizontal scrollers (B2's own list), WITH room
  // to scroll back (scrollLeft>0) — yields; AT REST (scrollLeft 0, nowhere
  // further to scroll back) — does not, per the coordinator's own rule.
  for (const sel of ['.chat-pills-scroll', '.dashboard-scroll', '.comm-tabbar', '.batch-grid-scroll']) {
    assert(_isDrawerYieldTarget(makeScrollerTarget(sel, 40)) === true,
      `5n-${sel}: ${sel} with scrollLeft>0 (room to scroll back) yields to the scroller`);
    assert(_isDrawerYieldTarget(makeScrollerTarget(sel, 0)) === false,
      `5n-${sel}-at-rest: ${sel} already at scrollLeft===0 does NOT yield — unambiguous for the drawer/week-swipe`);
  }

  // Text fields — unconditional, no scrollLeft involved.
  assert(_isDrawerYieldTarget(makeFieldTarget('input')) === true, '5n-input: an <input> target yields');
  assert(_isDrawerYieldTarget(makeFieldTarget('textarea')) === true, '5n-textarea: a <textarea> target yields');
  assert(_isDrawerYieldTarget(makeFieldTarget('[contenteditable]')) === true, '5n-contenteditable: a [contenteditable] target yields');

  // Chat messages (B1) — same predicate; combined-binder coverage lives at
  // chatscrolltest.mjs [8], direct coverage here too.
  assert(_isDrawerYieldTarget({ closest: (sel) => (String(sel).includes('.chat-msg') ? {} : null) }) === true,
    '5n-chat-msg: a .chat-msg target yields (B1)');

  // Non-yield-target — ordinary content, and the defensive no-crash cases.
  assert(_isDrawerYieldTarget({ closest: () => null }) === false, '5n-plain: an ordinary element (matches none of the yield selectors) does not yield');
  assert(_isDrawerYieldTarget(null) === false, '5n-null: a null/undefined target is safely "no yield," never throws');
  assert(_isDrawerYieldTarget({}) === false, '5n-no-closest: a target with no .closest() method is safely "no yield" (not every fixture/native node has one)');

  // Integration — isInDrawerOpenZone()'s own target param, at the DRAWER's
  // call shape (B1's fix site): refuses regardless of an in-zone clientX
  // when the target is a yield-target; agrees at rest.
  assert(isInDrawerOpenZone({ tab: 'dashboard', clientX: 10, viewportWidthPx: 400, target: makeScrollerTarget('.dashboard-scroll', 20) }) === false,
    '5n-integration-drawer: isInDrawerOpenZone() refuses a scroller-with-room target even well INSIDE the 25% zone');
  assert(isInDrawerOpenZone({ tab: 'dashboard', clientX: 10, viewportWidthPx: 400, target: makeScrollerTarget('.dashboard-scroll', 0) }) === true,
    '5n-integration-drawer2: …but a scroller already at rest (scrollLeft 0) does NOT refuse — the zone geometry alone decides');

  // Integration — bindWeekSwipe()'s OWN yield decision, via the REAL
  // binder, OUTSIDE the 25% zone too. B2's own scope is not limited to the
  // zone — "the matrix inside the zone" is the reported case, but the
  // general rule ("a horizontal scroller with room to scroll back always
  // wins") applies wherever the touch starts, matching the coordinator's
  // own "test each surface" instruction.
  function makeFakeWeekSwipeRoot5n() {
    const props = {}; const handlers = {};
    return {
      dataset: {}, style: { setProperty: (k, v) => { props[k] = v; } },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _props: props, _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
    };
  }
  const WEEKS5N = ['w1', 'w2', 'w3', 'w4'];
  {
    globalThis.window = {}; // no innerWidth — the zone geometry alone would fail closed either way
    const root = makeFakeWeekSwipeRoot5n();
    let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5N, currentWeekId: 'w2', tab: 'dashboard' }), (id) => { navigated = id; });
    const scrollerTarget = makeScrollerTarget('.dashboard-scroll', 50);
    root._fire('touchstart', { touches: [{ clientX: 300, clientY: 300 }], target: scrollerTarget }); // WELL outside any 25% zone
    root._fire('touchmove', { touches: [{ clientX: 360, clientY: 300 }], target: scrollerTarget }); // dx=60, L->R, well past commit
    root._fire('touchend', {}); // RG-TBD-A1 — release is where a commit would happen now
    assert(navigated === null,
      `5n-weekswipe-scroller: MUTATION PROOF (B2): week-swipe yields to a horizontal scroller with room to scroll back, even starting WELL OUTSIDE the drawer's own 25% zone (got navigated=${navigated})`);
  }
  {
    globalThis.window = {};
    const root = makeFakeWeekSwipeRoot5n();
    let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5N, currentWeekId: 'w2', tab: 'dashboard' }), (id) => { navigated = id; });
    const scrollerAtRest = makeScrollerTarget('.dashboard-scroll', 0); // nowhere further to scroll back
    root._fire('touchstart', { touches: [{ clientX: 300, clientY: 300 }], target: scrollerAtRest });
    root._fire('touchmove', { touches: [{ clientX: 360, clientY: 300 }], target: scrollerAtRest });
    root._fire('touchend', {}); // RG-TBD-A1 — release commits
    assert(navigated === 'w1',
      `5n-weekswipe-scroller-rest: …but a scroller already at rest does NOT yield — week-swipe navigates normally (got ${navigated})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5o] REVIEWER ROUND 2 (B5 BLOCK, coordinator ruling, 2026-09-28) — commitSlide() rebuilt: a TRUE simultaneous slide (a cloned outgoing layer + the real element move together, inside ONE --motion-nav transition)…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow5o = globalThis.window;
  const savedDocument5o = globalThis.document;
  globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact() {} } } } };

  // A minimal fake `document.createElement()` — nothing else is exercised
  // by commitSlide()'s clone path.
  function makeFakeCloneEl() {
    const attrs = {};
    return {
      style: {},
      setAttribute(k, v) { attrs[k] = v; },
      _attrs: attrs,
      set innerHTML(v) { this._innerHTML = v; }, get innerHTML() { return this._innerHTML; },
      parentNode: null,
      addEventListener() {}, removeEventListener() {},
    };
  }
  globalThis.document = { createElement: () => makeFakeCloneEl() };

  /** A root fixture that CAN be cloned: getBoundingClientRect() + a real
   *  parentNode.insertBefore()/removeChild() pair, tracking inserted
   *  siblings in `children` for the test to inspect. */
  function makeCloneableRoot() {
    const handlers = {};
    const props = {};
    const children = [];
    const parent = {
      insertBefore(node) { node.parentNode = parent; children.push(node); },
      removeChild(node) {
        const i = children.indexOf(node);
        if (i !== -1) children.splice(i, 1);
        node.parentNode = null;
      },
    };
    const root = {
      dataset: {},
      style: { setProperty: (k, v) => { props[k] = v; } },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
      _props: props,
      innerHTML: '<div>OLD WEEK CONTENT</div>',
      parentNode: parent,
      nextSibling: null,
      getBoundingClientRect: () => ({ top: 60, left: 0, width: 390, height: 700 }),
    };
    return { root, children };
  }

  const WEEKS5O = ['w1', 'w2', 'w3', 'w4'];
  {
    const { root, children } = makeCloneableRoot();
    let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5O, currentWeekId: 'w2', tab: 'picks' }), (id) => {
      navigated = id;
      root.innerHTML = `<div>NEW WEEK ${id}</div>`; // the REAL element's content really does get replaced
    });
    root._fire('touchstart', { touches: [{ clientX: 260, clientY: 300 }] });
    root._fire('touchmove', { touches: [{ clientX: 160, clientY: 300 }] }); // dx=-100, R→L
    root._fire('touchend', {}); // RG-TBD-A1 — release commits to w3
    assert(navigated === 'w3', '5o-a: fixture — the commit completed');
    assert(children.length === 1,
      `5o-b: MUTATION PROOF (B5): a clone layer was created and inserted as a SIBLING of root (got ${children.length})`);
    const clone = children[0];
    assert(clone.innerHTML === '<div>OLD WEEK CONTENT</div>',
      '5o-c: the clone holds a SNAPSHOT of the OUTGOING content, captured before onNavigate() replaced root\'s own innerHTML');
    assert(root.innerHTML === '<div>NEW WEEK w3</div>', '5o-d: …while root\'s own content really is the NEW week now');
    assert(clone._attrs['aria-hidden'] === 'true', '5o-e: the clone is aria-hidden (decorative, per the DI)');
    assert(clone.style.pointerEvents === 'none', '5o-f: …and pointer-events:none (never reachable)');
    assert(clone.style.position === 'fixed',
      '5o-g: position:fixed — a SIBLING escaping root\'s own always-on CSS transform (which would otherwise compound with the clone\'s own motion), matching root\'s current on-screen rect');
    assert(clone.style.top === '60px' && clone.style.left === '0px' && clone.style.width === '390px' && clone.style.height === '700px',
      `5o-h: …sized/positioned to root's OWN getBoundingClientRect() at the commit instant (got top:${clone.style.top} left:${clone.style.left} width:${clone.style.width} height:${clone.style.height})`);
    assert(root._props['--week-swipe-x'] === '0px', '5o-i: root itself lands at 0 (fully in) in the same synchronous pass');
    // RG-TBD-A1 — released at a live -100px offset, so the clone's exit is
    // "-100%" less the distance the finger already carried it (N-a).
    assert(clone.style.transform === 'translateX(calc(-100% + 100px))',
      `5o-j: [NO FRAME WHERE NEITHER LAYER IS ON SCREEN] the clone's OWN transform is set to its exit position (matching the drag direction, less the live offset it was released at) in the SAME synchronous animate() call that moves root to 0 — both writes happen together, never one before the other across a frame boundary (got "${clone.style.transform}")`);
    assert(clone.style.transition.includes('260'),
      `5o-k: the clone's own transition duration matches WEEK_SWIPE_COMMIT_MS (260ms) — the SAME single bucket root's own [data-week-swipe-animating="commit"] CSS rule uses, not a second, independent one (got "${clone.style.transition}")`);
    root._fire('transitionend', { target: root }); // the ONE transition completes
    assert(children.length === 0, '5o-l: the clone is removed once the (single) transition completes');
  }

  // 5o-m: RG-TBD-A1 (2026-09-29, amends DI-409's instant swap) — reduced
  // motion CROSS-FADES: the same outgoing clone, but it fades out IN PLACE
  // (opacity transition, never a transform) while root fades in ("fade"),
  // and both are cleaned up on root's own animationend.
  {
    const savedMatchMedia5o = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: true });
    const { root, children } = makeCloneableRoot();
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5O, currentWeekId: 'w2', tab: 'picks' }), () => { root.innerHTML = '<div>NEW</div>'; });
    root._fire('touchstart', { touches: [{ clientX: 260, clientY: 300 }] });
    root._fire('touchmove', { touches: [{ clientX: 160, clientY: 300 }] });
    assert(children.length === 0, `5o-m0: prefers-reduced-motion — nothing is cloned while the finger is still down (got ${children.length})`);
    root._fire('touchend', {});
    const clone = children[0];
    assert(children.length === 1 && clone.innerHTML === '<div>OLD WEEK CONTENT</div>' && root.innerHTML === '<div>NEW</div>',
      `5o-m: prefers-reduced-motion — release cross-fades: an outgoing layer holding the OLD week sits over root, which already holds the NEW one (clones ${children.length})`);
    assert(clone && clone.style.transform === 'translateX(0px)' && /opacity/.test(clone.style.transition || '') && clone.style.opacity === '0',
      `5o-m2: …the outgoing layer FADES (opacity transition to 0) and never moves (transform "${clone?.style.transform}", transition "${clone?.style.transition}", opacity "${clone?.style.opacity}")`);
    assert(root.dataset.weekSwipeAnimating === 'fade' && root._props['--week-swipe-x'] === '0px',
      `5o-m3: …while root fades in ("fade"), never translated (animating ${root.dataset.weekSwipeAnimating}, x ${root._props['--week-swipe-x']})`);
    root._fire('animationend', { target: root });
    assert(children.length === 0 && root.dataset.weekSwipeAnimating === undefined,
      `5o-m4: …and root's own animationend removes the outgoing layer and clears the fade (clones ${children.length})`);
    globalThis.matchMedia = savedMatchMedia5o;
  }

  // 5o-n: a throwing onNavigate still removes the clone (no leaked overlay).
  {
    const { root, children } = makeCloneableRoot();
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5O, currentWeekId: 'w2', tab: 'picks' }), () => { throw new Error('render exploded'); });
    root._fire('touchstart', { touches: [{ clientX: 260, clientY: 300 }] });
    try {
      root._fire('touchmove', { touches: [{ clientX: 160, clientY: 300 }] });
      root._fire('touchend', {});
    } catch { /* expected, see [5k-h] — RG-TBD-A1: release commits */ }
    assert(children.length === 0, `5o-n: MUTATION PROOF: a throwing onNavigate still removes the clone rather than leaking a permanent overlay (got ${children.length})`);
  }

  // 5o-p..s: REVIEWER ROUND 3 (N-a) — the incoming layer starts FLUSH
  // against the clone. Real drags reach the 40px commit over several moves,
  // so root is already painted at a live offset (the reviewer measured 32px)
  // when the commit fires; the clone's rect carries that offset, and a bare
  // -exitPct% start left a strip exactly that wide between the layers.
  // Evaluated numerically at W=390: edges must touch at the START and the END
  // of the one shared transition (same duration, same easing ⇒ touching
  // throughout).
  const evalX = (v, W) => {   // '12px' | '-100%' | 'calc(100% - 20px)' | 'translateX(…)'
    const inner = String(v).replace(/^translateX\((.*)\)$/, '$1');
    const m = /^calc\((-?[\d.]+)% ([+-]) ([\d.]+)px\)$/.exec(inner);
    if (m) return (+m[1] / 100) * W + (m[2] === '+' ? 1 : -1) * +m[3];
    if (/%$/.test(inner)) return (parseFloat(inner) / 100) * W;
    return parseFloat(inner);
  };
  for (const [label, moves, exitDir] of [
    ['R→L', [240, 210], -1],   // dx -20, then dx -50 painted; release commits → NEXT week, exits left
    ['L→R', [280, 310], 1],    // dx +20, then dx +50 painted; release commits → PREVIOUS week, exits right
  ]) {
    const W = 390;
    const handlers = {};
    const log = [];
    const children = [];
    const parent = { insertBefore(node) { node.parentNode = parent; children.push(node); }, removeChild(node) { children.splice(children.indexOf(node), 1); node.parentNode = null; } };
    let paintedX = 0;
    const root = {
      dataset: {},
      style: { setProperty: (k, v) => { log.push(v); if (/px$/.test(v)) paintedX = parseFloat(v); } },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
      innerHTML: '<div>OLD</div>', parentNode: parent, nextSibling: null,
      // The rect carries the live drag transform, exactly as the engine's does.
      getBoundingClientRect: () => ({ top: 60, left: paintedX, width: W, height: 700 }),
    };
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5O, currentWeekId: 'w2', tab: 'picks' }), () => { root.innerHTML = '<div>NEW</div>'; });
    root._fire('touchstart', { touches: [{ clientX: 260, clientY: 300 }] });
    root._fire('touchmove', { touches: [{ clientX: moves[0], clientY: 300 }] });
    root._fire('touchmove', { touches: [{ clientX: moves[1], clientY: 300 }] });
    // RG-TBD-A1 — the commit fires on RELEASE, from wherever the finger
    // carried the page (50 px here), not at the 40 px crossing.
    const off = paintedX;
    root._fire('touchend', {});
    const clone = children[0];
    const incomingStart = log[log.length - 2];   // the opposite-edge write, before the final '0px'
    const cloneLeft0 = parseFloat(clone.style.left);                 // clone's own start (fixed, at the painted rect)
    const cloneEnd = cloneLeft0 + evalX(clone.style.transform, W);   // clone's left edge when the slide ends
    const inStart = evalX(incomingStart, W), inEnd = evalX(log[log.length - 1], W);
    const gapStart = exitDir < 0 ? inStart - (cloneLeft0 + W) : cloneLeft0 - (inStart + W);
    const gapEnd = exitDir < 0 ? inEnd - (cloneEnd + W) : cloneEnd - (inEnd + W);
    assert(Math.abs(off) === 50, `5o-p-${label}: fixture — root was painted at a live ${off}px drag offset when the finger let go`);
    assert(Math.abs(gapStart) < 0.5,
      `5o-q-${label}: [N-a] the incoming page STARTS flush against the clone (gap ${gapStart.toFixed(1)}px; round 2: ${Math.abs(off)}px strip) — incoming start "${incomingStart}", clone left ${cloneLeft0}px`);
    assert(Math.abs(gapEnd) < 0.5 && inEnd === 0,
      `5o-r-${label}: [N-a] …and ENDS flush (gap ${gapEnd.toFixed(1)}px), root at 0 — both layers travel the same ${(W - Math.abs(off))}px, so one duration + one easing keeps them touching throughout (clone "${clone.style.transform}")`);
    root._fire('transitionend', { target: root });
  }

  // 5o-s/t: REVIEWER ROUND 3 (N-b) — the clone is `inert` (its copied
  // buttons unfocusable), and a sideways-scrolled horizontal scroller keeps
  // its scrollLeft in the outgoing layer (innerHTML carries no scroll state).
  {
    const srcNodes = [
      { tagName: 'DIV', className: 'card', scrollLeft: 0 },
      { tagName: 'DIV', className: 'dashboard-scroll', scrollLeft: 137 },
      { tagName: 'TABLE', className: 'matrix', scrollLeft: 0 },
    ];
    const dstNodes = srcNodes.map(n => ({ tagName: n.tagName, className: n.className, scrollLeft: 0 }));
    const savedCreate = globalThis.document.createElement;
    globalThis.document.createElement = () => ({ ...makeFakeCloneEl(), querySelectorAll: () => dstNodes });
    const { root, children } = makeCloneableRoot();
    root.querySelectorAll = () => srcNodes;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5O, currentWeekId: 'w2', tab: 'dashboard' }), () => {});
    root._fire('touchstart', { touches: [{ clientX: 260, clientY: 300 }] });
    root._fire('touchmove', { touches: [{ clientX: 160, clientY: 300 }] });
    root._fire('touchend', {}); // RG-TBD-A1 — release commits
    const clone = children[0];
    assert(clone && clone._attrs.inert === '' && clone._attrs['aria-hidden'] === 'true',
      `5o-s: [N-b] the clone is inert as well as aria-hidden — its copied buttons can never take focus during the slide (attrs ${JSON.stringify(clone?._attrs)})`);
    assert(dstNodes[1].scrollLeft === 137 && dstNodes[0].scrollLeft === 0 && dstNodes[2].scrollLeft === 0,
      `5o-t: [N-b] a sideways-scrolled scroller keeps its scrollLeft in the outgoing layer (137 → ${dstNodes[1].scrollLeft}); unscrolled nodes are untouched`);
    root._fire('transitionend', { target: root });
    globalThis.document.createElement = savedCreate;
  }

  globalThis.window = savedWindow5o;
  globalThis.document = savedDocument5o;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5p] RG-TBD-A1/A2 (Drew, 2026-09-29) — release decides the week; one owner per touch (week swipe vs. the compact Dashboard reorder vs. the drawer)…');
// ═════════════════════════════════════════════════════════════════════════
// The engine-measured proof of both bugs — real app, real touches, real
// chips — is weekswipetest.mjs [A]/[B]. This section pins the binder-level
// contract those rest on, against the same fakes as [5k].
{
  const savedWindow5p = globalThis.window;
  const { claimTouch, releaseTouch, touchClaimedBy, clearStaleTouchClaim, WEEK_SWIPE_FADE_MS } = NG;
  const WEEKS5P = ['w1', 'w2', 'w3', 'w4'];
  const makeRoot5p = () => {
    const handlers = {}; const props = {};
    return {
      dataset: {}, style: { setProperty: (k, v) => { props[k] = v; } }, _props: props,
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
    };
  };
  const one = (x, y = 300) => ({ touches: [{ clientX: x, clientY: y }] });
  globalThis.window = {};

  // 5p-a: the claim primitive itself.
  clearStaleTouchClaim(one(0));
  assert(touchClaimedBy() === null && claimTouch('a') === true && touchClaimedBy() === 'a',
    '5p-a1: an unowned touch can be claimed, and reports its owner');
  assert(claimTouch('a') === true && claimTouch('b') === false && touchClaimedBy() === 'a',
    '5p-a2: re-claiming by the SAME owner is fine; a DIFFERENT owner is refused while it is held');
  releaseTouch('b');
  assert(touchClaimedBy() === 'a', '5p-a3: only the owner can release — a stranger\'s release is a no-op');
  releaseTouch('a');
  assert(touchClaimedBy() === null, '5p-a4: the owner\'s release frees it');
  claimTouch('a');
  clearStaleTouchClaim({ touches: [{}, {}] });
  assert(touchClaimedBy() === 'a', '5p-a5: a SECOND finger landing never clears a live claim');
  clearStaleTouchClaim(one(0));
  assert(touchClaimedBy() === null, '5p-a6: a fresh ONE-finger touchstart clears a claim left over from a touch whose end never arrived');
  assert(WEEK_SWIPE_FADE_MS === 150, "5p-a7: WEEK_SWIPE_FADE_MS (the Reduce Motion cross-fade) matches css/styles.css's --motion-fast (150ms)");

  // 5p-b: release decides — a drag carried past the threshold and brought
  // BACK inside it springs back ("changed my mind"), never navigates.
  {
    const root = makeRoot5p(); let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5P, currentWeekId: 'w2', tab: 'picks' }), (id) => { navigated = id; });
    root._fire('touchstart', one(300));
    root._fire('touchmove', one(260)); root._fire('touchmove', one(150)); root._fire('touchmove', one(280));
    assert(root._props['--week-swipe-x'] === '-20px' && navigated === null,
      `5p-b1: [RG-TBD-A1] dragged to -150 px and back to -20 px, the page is at -20 px and nothing has navigated (x ${root._props['--week-swipe-x']})`);
    root._fire('touchend', {});
    assert(navigated === null && root._props['--week-swipe-x'] === '0px' && root.dataset.weekSwipeAnimating === 'bounce',
      `5p-b2: …release INSIDE the threshold springs back ("bounce") and stays on w2 — v0.27.2 had already navigated at -40 px (navigated ${navigated})`);
    root._fire('transitionend', { target: root });
  }
  // 5p-c: touchcancel carries the same decision as touchend (the binder has
  // always handled both with one function).
  {
    const root = makeRoot5p(); let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5P, currentWeekId: 'w2', tab: 'picks' }), (id) => { navigated = id; });
    root._fire('touchstart', one(300)); root._fire('touchmove', one(250)); root._fire('touchmove', one(200));
    root._fire('touchcancel', {});
    assert(navigated === 'w3', `5p-c: a touchcancel past the threshold resolves exactly like a release (got ${navigated})`);
    root._fire('transitionend', { target: root });
  }

  // 5p-d: [RG-TBD-A2] the reorder's long-press claimed the touch FIRST (as
  // js/app.js's timer does at 350 ms): the week swipe never moves the page,
  // never navigates, and leaves the claim with its owner.
  {
    const root = makeRoot5p(); let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5P, currentWeekId: 'w2', tab: 'dashboard' }), (id) => { navigated = id; });
    root._fire('touchstart', one(300));
    assert(claimTouch('column-reorder') === true, '5p-d0: fixture — the reorder claims the still-unlocked touch (its long-press fired)');
    for (const x of [290, 270, 240, 200, 150]) root._fire('touchmove', one(x));
    assert(root._props['--week-swipe-x'] === '0px', `5p-d1: [RG-TBD-A2] a 150 px reorder drag never moves the week (x ${root._props['--week-swipe-x']}) — MUTATION: a binder that ignores the claim tracks to -150px`);
    root._fire('touchend', {});
    assert(navigated === null, `5p-d2: …and release never changes the week (got ${navigated})`);
    assert(touchClaimedBy() === 'column-reorder', '5p-d3: …and the week swipe never takes or drops the reorder\'s claim');
    releaseTouch('column-reorder');
  }
  // 5p-e: the claim lands MID-drag, after the week had started following
  // the finger (cannot happen through the real reorder, whose timer is
  // cancelled by 8 px of movement — pinned anyway): the week springs back.
  {
    const root = makeRoot5p(); let navigated = null;
    bindWeekSwipe(root, () => ({ weekIds: WEEKS5P, currentWeekId: 'w2', tab: 'dashboard' }), (id) => { navigated = id; });
    root._fire('touchstart', one(300)); root._fire('touchmove', one(270));
    assert(touchClaimedBy() === 'week-swipe', `5p-e0: a drag that locks horizontal CLAIMS the touch for the week swipe (owner ${touchClaimedBy()})`);
    assert(claimTouch('column-reorder') === false, '5p-e1: [RG-TBD-A2] …so the reorder\'s long-press is REFUSED on it — once a week swipe has locked, reorder cannot start');
    root._fire('touchend', {});
    assert(touchClaimedBy() === null, '5p-e2: release hands the touch back');
    root._fire('transitionend', { target: root });
  }
  // 5p-f: the control-center edge swipe stands down under a foreign claim
  // too — a reorder drag from a chip in the left quarter used to open it.
  {
    const winHandlers = {};
    globalThis.window = { innerWidth: 400, addEventListener(t, fn) { (winHandlers[t] ||= []).push(fn); }, removeEventListener() {} };
    const fire = (t, ev) => (winHandlers[t] || []).forEach(fn => fn(ev));
    const run = (claimed) => {
      let started = false;
      const unbind = CC.bindControlCenterEdgeSwipe((a) => { if (a.type === 'drag-start') started = true; }, () => ({ phase: 'closed', dragProgress: 0 }), { getWidthPx: () => 340, getTab: () => 'dashboard' });
      fire('touchstart', one(40));                           // 10% — inside the drawer's zone
      if (claimed) claimTouch('column-reorder');
      fire('touchmove', one(70)); fire('touchmove', one(140));
      fire('touchend', {});
      releaseTouch('column-reorder');
      unbind();
      return started;
    };
    assert(run(false) === true, '5p-f0: fixture — unclaimed, an L→R drag from 10% opens the drawer as always (DI-419)');
    assert(run(true) === false, '5p-f1: [RG-TBD-A2] claimed by the reorder, the SAME drag never starts the drawer — MUTATION: a drawer that ignores the claim reports drag-start');
  }
  globalThis.window = savedWindow5p;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5q] Reviewer notes on RG-TBD-A1 (2026-09-29) — velocity commit, and no repaint under an active week swipe…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow5q = globalThis.window;
  globalThis.window = {};
  const { _weekSwipeShouldCommit, WEEK_SWIPE_VELOCITY_WINDOW_MS, WEEK_SWIPE_BACKTRACK_PX_MS, deferRenderWhileWeekSwiping,
    _deferredRenderCount, touchClaimedBy, claimTouch, releaseTouch, clearStaleTouchClaim } = NG;
  assert(WEEK_SWIPE_VELOCITY_WINDOW_MS === 80 && WEEK_SWIPE_BACKTRACK_PX_MS === 0.05 && DISMISS_FLICK_VELOCITY_PX_MS === 0.3,
    '5q-0: the release reads the last 80 ms; the flick threshold is the SAME 0.3 px/ms the sheet/drawer flicks use');
  // Pure decision, explicit timestamps (ms).
  const trail = (pts) => pts.map(([t, dx]) => ({ t, dx }));
  const fast30 = trail([[0, -10], [16, -20], [32, -30]]);
  assert(_weekSwipeShouldCommit(-30, fast30, 40) === true,
    '5q-a: a FAST 30 px flick (0.75 px/ms outward) commits, short of the 40 px distance threshold');
  assert(_weekSwipeShouldCommit(-30, fast30, 400) === false,
    '5q-b: the SAME 30 px drag held still before lifting (no motion in the last 80 ms) springs back — distance decides at rest');
  const outAndBack = trail([[0, -50], [40, -100], [80, -150], [300, -120], [340, -90], [380, -60], [420, -50], [460, -45]]);
  assert(_weekSwipeShouldCommit(-45, outAndBack, 470) === false,
    '5q-c: out to 150 px, then SLOWLY back to 45 px and released while still moving back → CANCEL (it follows the final direction; ~0.1 px/ms back)');
  assert(_weekSwipeShouldCommit(-45, outAndBack, 700) === true,
    '5q-d: …the same drag held still at 45 px before lifting → COMMIT (≥ 40 px and nothing says otherwise — position decides at rest)');
  assert(_weekSwipeShouldCommit(-120, trail([[0, -150], [40, -140], [80, -120]]), 90) === false,
    '5q-e: heading back fast enough is a cancel however far out the finger still is (120 px out, moving back at 0.3 px/ms)');
  assert(_weekSwipeShouldCommit(-120, trail([[0, -100], [40, -110], [80, -120]]), 90) === true,
    '5q-f: 120 px out and still heading outward → commit');
  assert(_weekSwipeShouldCommit(-30, trail([[null, -10], [null, -30]]), null) === false && _weekSwipeShouldCommit(-60, trail([[null, -10], [null, -60]]), null) === true,
    '5q-g: events with no timestamps (synthetic sequences) fall back to distance alone — no velocity is guessed from them');
  assert(_weekSwipeShouldCommit(0, fast30, 40) === false, '5q-h: zero offset never commits');

  // Through the real binder, timed events.
  const makeRoot = () => { const h = {}; const props = {}; return { dataset: {}, style: { setProperty: (k, v) => { props[k] = v; } }, _props: props,
    addEventListener(t, fn) { (h[t] ||= []).push(fn); }, removeEventListener(t, fn) { h[t] = (h[t] || []).filter(x => x !== fn); },
    _fire(t, ev) { (h[t] || []).slice().forEach(fn => fn(ev)); } }; };
  const at = (x, t) => ({ touches: [{ clientX: x, clientY: 300 }], timeStamp: t });
  {
    const root = makeRoot(); let nav = null;
    bindWeekSwipe(root, () => ({ weekIds: ['w1', 'w2', 'w3'], currentWeekId: 'w2', tab: 'picks' }), (id) => { nav = id; });
    root._fire('touchstart', at(300, 1000)); root._fire('touchmove', at(290, 1016)); root._fire('touchmove', at(280, 1032)); root._fire('touchmove', at(270, 1048));
    root._fire('touchend', { touches: [], timeStamp: 1056 });
    assert(nav === 'w3', `5q-i: [binder] a fast 30 px flick on Picks commits to the NEXT week (got ${nav})`);
    root._fire('transitionend', { target: root });
  }
  {
    const root = makeRoot(); let nav = null;
    bindWeekSwipe(root, () => ({ weekIds: ['w1', 'w2', 'w3'], currentWeekId: 'w2', tab: 'picks' }), (id) => { nav = id; });
    root._fire('touchstart', at(300, 2000));
    let t = 2000;
    for (let x = 290; x >= 150; x -= 10) root._fire('touchmove', at(x, t += 16));    // out to -150
    for (let x = 155; x <= 255; x += 5) root._fire('touchmove', at(x, t += 30));     // slowly back to -45
    root._fire('touchend', { touches: [], timeStamp: t + 8 });
    assert(nav === null && root.dataset.weekSwipeAnimating === 'bounce',
      `5q-j: [binder] out to 150 px then slowly back to 45 px and released moving back → springs back, no navigation (got ${nav}, ${root.dataset.weekSwipeAnimating})`);
    root._fire('transitionend', { target: root });
  }
  {
    const root = makeRoot(); let nav = null;
    bindWeekSwipe(root, () => ({ weekIds: ['w1', 'w2'], currentWeekId: 'w2', tab: 'picks' }), (id) => { nav = id; });
    root._fire('touchstart', at(300, 3000)); root._fire('touchmove', at(290, 3016)); root._fire('touchmove', at(270, 3032));
    root._fire('touchend', { touches: [], timeStamp: 3040 });
    assert(nav === null, `5q-k: [binder] a fast flick toward a week that does not exist (the last week) still never navigates (got ${nav})`);
    root._fire('transitionend', { target: root });
  }

  // Deferred repaint — the "stranding during re-render" note.
  {
    clearStaleTouchClaim({ touches: [{}] });
    let painted = 0;
    const paint = () => { painted++; };
    assert(deferRenderWhileWeekSwiping('dashboard', paint) === false && _deferredRenderCount() === 0,
      '5q-l: with no week swipe in progress a repaint is NOT deferred (renders now)');
    const root = makeRoot(); let nav = null;
    bindWeekSwipe(root, () => ({ weekIds: ['w1', 'w2', 'w3'], currentWeekId: 'w2', tab: 'dashboard' }), (id) => { nav = id; });
    root._fire('touchstart', at(300, 5000)); root._fire('touchmove', at(270, 5016));
    assert(touchClaimedBy() === 'week-swipe', '5q-m0: fixture — the drag locked horizontal and owns the touch');
    assert(deferRenderWhileWeekSwiping('dashboard', paint) === true && deferRenderWhileWeekSwiping('dashboard', paint) === true && _deferredRenderCount() === 1,
      '5q-m: a live-score repaint mid-drag is PARKED, and a burst of them collapses to one per page');
    root._fire('touchmove', at(280, 5200));   // hold near 20 px
    root._fire('touchend', { touches: [], timeStamp: 5400 });
    assert(nav === null && painted === 1 && _deferredRenderCount() === 0,
      `5q-n: a release that springs back runs the parked repaint ONCE (painted ${painted}, parked ${_deferredRenderCount()})`);
    root._fire('transitionend', { target: root });
  }
  {
    let dashPaints = 0, picksPaints = 0;
    const root = makeRoot(); let nav = null;
    bindWeekSwipe(root, () => ({ weekIds: ['w1', 'w2', 'w3'], currentWeekId: 'w2', tab: 'dashboard' }), (id) => { nav = id; });
    root._fire('touchstart', at(300, 6000)); root._fire('touchmove', at(250, 6016)); root._fire('touchmove', at(180, 6032));
    deferRenderWhileWeekSwiping('dashboard', () => { dashPaints++; });
    deferRenderWhileWeekSwiping('picks', () => { picksPaints++; });
    root._fire('touchend', { touches: [], timeStamp: 6040 });
    assert(nav === 'w3' && dashPaints === 0 && picksPaints === 1 && _deferredRenderCount() === 0,
      `5q-o: a release that COMMITS drops the swiped page's parked repaint (onNavigate() repaints it from current data) and still runs the other page's (dashboard ${dashPaints}, picks ${picksPaints}, nav ${nav})`);
    root._fire('transitionend', { target: root });
  }
  {
    let painted = 0;
    claimTouch('week-swipe');
    deferRenderWhileWeekSwiping('picks', () => { painted++; });
    clearStaleTouchClaim({ touches: [{}] });   // the touchend never arrived; a new touch begins
    assert(painted === 1 && touchClaimedBy() === null,
      '5q-p: a week-swipe claim left stale by a lost touchend still runs its parked repaint when the next touch clears it — nothing is dropped');
    releaseTouch('week-swipe');
  }
  globalThis.window = savedWindow5q;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5r] Reviewer notes on c7f8bee (2026-09-29) — the safety net: visibility/pagehide recovery, and a stale-claim flush that waits for the new touch to end…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow5r = globalThis.window, savedDocument5r = globalThis.document;
  const { deferRenderWhileWeekSwiping, _deferredRenderCount, touchClaimedBy, claimTouch, releaseTouch } = NG;
  const makeTarget = (extra = {}) => { const h = {}; return { ...extra,
    addEventListener(t, fn) { (h[t] ||= []).push(fn); }, removeEventListener(t, fn) { h[t] = (h[t] || []).filter(x => x !== fn); },
    _fire(t, ev) { (h[t] || []).slice().forEach(fn => fn(ev)); } }; };
  const makeRoot = () => { const props = {}; return makeTarget({ dataset: {}, style: { setProperty: (k, v) => { props[k] = v; } }, _props: props }); };
  const one = (x, y = 300) => ({ touches: [{ clientX: x, clientY: y }] });
  const tick = () => new Promise(r => setTimeout(r, 5));

  // 5r-a..d: backgrounded mid-drag, the touch's end never arrives.
  for (const how of ['visibilitychange', 'pagehide']) {
    const doc = makeTarget({ visibilityState: 'visible' });
    const win = makeTarget({});
    globalThis.document = doc; globalThis.window = win;
    const root = makeRoot(); let nav = null, painted = 0;
    const unbind = bindWeekSwipe(root, () => ({ weekIds: ['w1', 'w2', 'w3'], currentWeekId: 'w2', tab: 'dashboard' }), (id) => { nav = id; });
    root._fire('touchstart', one(300)); root._fire('touchmove', one(240));
    deferRenderWhileWeekSwiping('dashboard', () => { painted++; });
    assert(root._props['--week-swipe-x'] === '-60px' && touchClaimedBy() === 'week-swipe' && _deferredRenderCount() === 1,
      `5r-${how}-0: fixture — mid-drag at -60 px, the touch claimed, a live repaint parked`);
    if (how === 'visibilitychange') {
      doc.visibilityState = 'hidden'; doc._fire('visibilitychange', {});
      doc.visibilityState = 'visible'; doc._fire('visibilitychange', {});
    } else {
      win._fire('pagehide', {});
    }
    assert(painted === 1 && _deferredRenderCount() === 0,
      `5r-${how}-1: ${how === 'visibilitychange' ? 'coming back (hidden → visible)' : 'pagehide'} runs the parked repaint (painted ${painted})`);
    assert(root._props['--week-swipe-x'] === '0px' && touchClaimedBy() === null,
      `5r-${how}-2: …puts the week back at rest and gives the touch back (x ${root._props['--week-swipe-x']}, claim ${touchClaimedBy()}) — never left parked at the finger's offset`);
    root._fire('touchend', {});
    assert(nav === null, `5r-${how}-3: …and a late touchend for the abandoned drag changes nothing (nav ${nav})`);
    unbind();
  }

  // 5r-e..h: a claim left stale by a lost touchend, and a NEW touch begins.
  {
    const win = makeTarget({});
    globalThis.window = win; globalThis.document = makeTarget({ visibilityState: 'visible' });
    const root = makeRoot(); let nav = null, painted = 0;
    const unbind = bindWeekSwipe(root, () => ({ weekIds: ['w1', 'w2', 'w3'], currentWeekId: 'w2', tab: 'dashboard' }), (id) => { nav = id; });
    claimTouch('week-swipe');                                  // the stale claim
    deferRenderWhileWeekSwiping('dashboard', () => { painted++; });
    win._fire('touchstart', one(300)); root._fire('touchstart', one(300));
    await tick();
    assert(painted === 0 && touchClaimedBy() === null,
      `5r-e: a new touch clears the stale claim but does NOT repaint under the new finger — not synchronously, not a tick later (painted ${painted})`);
    root._fire('touchmove', one(280));
    assert(root._props['--week-swipe-x'] === '-20px' && painted === 0,
      `5r-f: …so the new swipe proceeds, following the finger (x ${root._props['--week-swipe-x']}), with the repaint still waiting`);
    win._fire('touchend', {}); root._fire('touchend', {});
    await tick();
    assert(painted === 1 && _deferredRenderCount() === 0 && nav === null,
      `5r-g: …and the parked repaint lands AFTER that touch ends, exactly once (painted ${painted})`);
    root._fire('transitionend', { target: root });
    // Same, but the new touch is a vertical scroll that never becomes a swipe.
    painted = 0;
    claimTouch('week-swipe');
    deferRenderWhileWeekSwiping('dashboard', () => { painted++; });
    win._fire('touchstart', one(200)); root._fire('touchstart', one(200));
    root._fire('touchmove', one(202, 260));
    win._fire('touchend', {}); root._fire('touchend', {});
    assert(painted === 0, '5r-h0: fixture — nothing ran synchronously at a vertical touch\'s end');
    await tick();
    assert(painted === 1, `5r-h: …and when the new touch is a plain vertical scroll the parked repaint still lands once it ends (painted ${painted})`);
    releaseTouch('week-swipe');
    unbind();
  }
  globalThis.window = savedWindow5r; globalThis.document = savedDocument5r;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6] DI-327 T-29 — rubber-band resistance curve…');
// ═════════════════════════════════════════════════════════════════════════
{
  assert(_rubberBandOffset(0) === 0, '6a: zero overscroll -> zero offset');
  assert(_rubberBandOffset(-10) === 0, '6b: negative input (defensive) -> zero offset, never negative-of-negative');
  const at10 = _rubberBandOffset(10), at50 = _rubberBandOffset(50), at500 = _rubberBandOffset(500), at50000 = _rubberBandOffset(50000);
  assert(at10 > 0 && at10 < RUBBER_BAND_CAP_PX, '6c: a small drag produces a small, capped offset');
  assert(at50 > at10, '6d: more drag produces more offset (monotonic)…');
  assert(at500 < RUBBER_BAND_CAP_PX, '6e: …but NEVER reaches or exceeds the 24px cap, however far the drag goes ("never overshoot excessively")');
  assert(RUBBER_BAND_CAP_PX - at50000 < 0.1, '6f: an extreme drag asymptotically approaches the cap (diminishing returns, not a hard clamp jump)');
  // Diminishing returns: the marginal gain from 10->50px of drag is bigger
  // than the marginal gain from 450->500px.
  const gainEarly = _rubberBandOffset(50) - _rubberBandOffset(10);
  const gainLate = _rubberBandOffset(500) - _rubberBandOffset(450);
  assert(gainEarly > gainLate, '6g: diminishing returns — equal-sized drag increments produce shrinking additional offset as the drag grows');

  // 6h — reviewer round 2 (2026-09-28) — a 1px tolerance, mirroring
  // _pullToRefreshEligible()'s own FIX ROUND 1 ITEM 5 (some engines report
  // scroll metrics off by a sub-pixel at rest, which would otherwise make
  // this gesture never arm on a real device).
  const ih = 800, sh = 2000;
  assert(_bottomBounceEligible(sh - ih, ih, sh) === true, '6h-1: exactly at the true bottom is still eligible (unchanged)');
  assert(_bottomBounceEligible(sh - ih - 1, ih, sh) === true, '6h-2: 1px short of the true bottom tolerates the sub-pixel rest — eligible');
  assert(_bottomBounceEligible(sh - ih - 2, ih, sh) === false, '6h-3: 2px short is genuinely not at the bottom — not eligible (the tolerance is 1px, not open-ended)');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6b] DI-327 T-29 — bindBottomBounce() BOUNDED-ELEMENT test (fix round 1, items 3 & 7)…');
// ═════════════════════════════════════════════════════════════════════════
{
  // Real reviewer BLOCK: "bindBottomBounce must read scrollEl.scrollTop/
  // clientHeight/scrollHeight when scrollEl !== window (Chat is a bounded
  // scroller; today it is eligible at the TOP of Chat, colliding with
  // pull-to-refresh)." Driven through the REAL binder, not the pure
  // `_bottomBounceEligible()` alone — this proves the wiring picks the
  // right METRICS SOURCE, which is exactly what was broken.
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;

  function makeFakeWindow(innerHeight) {
    const handlers = {};
    return {
      innerHeight,
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
    };
  }
  // Real DOM elements all have addEventListener — bindBottomBounce()'s own
  // guard checks for it on `target` (belt-and-suspenders: it's a DOM-shaped
  // object, even though only `.style.transform` is ever written to it). A
  // fake target missing this would trip the guard and silently no-op the
  // whole binder, making the test pass vacuously rather than for real.
  function makeFakeTarget() { return { style: {}, addEventListener() {}, removeEventListener() {} }; }

  // The PAGE (window/document) looks like it's ALWAYS "at the bottom" —
  // exactly the metrics the OLD (buggy) code would have read for a bounded
  // scroller too. If the fix works, these must be IGNORED for a bounded
  // `scrollEl`.
  globalThis.document = {
    getElementById: () => null, querySelector: () => null,
    body: { dataset: {} },
    documentElement: { scrollHeight: 800 },
  };
  const fakeWin = makeFakeWindow(800);
  globalThis.window = fakeWin;

  // The BOUNDED scroller (Chat's own #chat-scroll): scrolled to ITS OWN
  // top, with plenty more content below — genuinely NOT at its own bottom.
  const chatAtTop = { scrollTop: 0, clientHeight: 400, scrollHeight: 1200, addEventListener() {}, removeEventListener() {} };
  const targetAtTop = makeFakeTarget();
  bindBottomBounce(() => chatAtTop, targetAtTop);

  fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
  fakeWin._fire('touchmove', { touches: [{ clientY: 60 }] }); // dragging up 40px

  assert(targetAtTop.style.transform === '' || targetAtTop.style.transform === undefined,
    '6b-1: at the TOP of a bounded scroller (Chat), bottom-bounce does NOT engage — the page\'s own (misleadingly "at bottom") metrics would have wrongly fired it under the old code (fix round 1, item 3)');

  // The SAME kind of container, but genuinely at ITS OWN bottom.
  const chatAtBottom = { scrollTop: 800, clientHeight: 400, scrollHeight: 1200, addEventListener() {}, removeEventListener() {} };
  const targetAtBottom = makeFakeTarget();
  bindBottomBounce(() => chatAtBottom, targetAtBottom);

  fakeWin._fire('touchstart', { touches: [{ clientY: 100 }] });
  fakeWin._fire('touchmove', { touches: [{ clientY: 60 }] }); // dragging up 40px past the bottom

  assert(typeof targetAtBottom.style.transform === 'string' && targetAtBottom.style.transform.includes('translateY('),
    '6b-2: …and at the BOUNDED scroller\'s own real bottom, the bounce DOES engage, reading THAT element\'s own scrollTop/clientHeight/scrollHeight');

  // FIX ROUND 1, ITEM 7 — WeakMap idempotency: a second bind for the same
  // scroll element attaches once (same unbind function both times).
  const unbindA = bindBottomBounce(() => chatAtBottom, targetAtBottom);
  const unbindB = bindBottomBounce(() => chatAtBottom, targetAtBottom);
  assert(unbindA === unbindB, '6b-3: a second bind() for the same scroll element returns the SAME unbind function (attaches once)');

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6d] SB-05 (2026-09-30) — bindBottomBounce() AXIS LOCK: a horizontal drag (the control-center swipe) never lifts the page…');
// ═════════════════════════════════════════════════════════════════════════
{
  // Drew (Munera iOS): "when I swipe open the control center I can still
  // scroll up and down on the page underneath and it makes it look choppy."
  // One of the movers: bindBottomBounce(window, .page-wrapper) decided
  // eligibility at touchstart and then lifted the page on every upward finger
  // movement — including the thumb's drift during the drawer's own swipe, with
  // the page at its bottom (ccscrolltest.mjs [B-8] measured ~18px in the real
  // app). Driven through the REAL binder AND the REAL drawer binder on ONE
  // fake window, so "the drawer claimed it" and "the bounce yielded" are
  // proven to be the same decision, not two tunings that happen to agree.
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  const handlers = {};
  const fakeWin = {
    scrollY: 0, innerHeight: 844, innerWidth: 390,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
  };
  const fire = (type, ev) => (handlers[type] || []).forEach(fn => fn(ev));
  // A document that fits the viewport — the window is "at its bottom" on every touch.
  globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: { tab: 'leaderboard' } }, documentElement: { scrollHeight: 844 } };
  globalThis.window = fakeWin;
  const writes = [];
  const target = { style: {}, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(target.style, 'transform', { set(v) { writes.push(v); }, get() { return writes[writes.length - 1] || ''; } });
  const liftOf = () => Math.max(0, ...writes.map(w => { const m = /translateY\(-([\d.]+)px\)/.exec(w || ''); return m ? +m[1] : 0; }));
  bindBottomBounce(() => fakeWin, target);
  const ccEvents = [];
  const ccState = { phase: 'closed', dragProgress: 0 };
  const unbindCC = CC.bindControlCenterEdgeSwipe((ev) => ccEvents.push(ev.type), () => ccState, { getWidthPx: () => 331 });
  /** touchstart at (x0,y0), `steps` moves to (x0+dx, y0+dy), touchend. */
  function gesture(x0, y0, dx, dy, steps = 12, withX = true) {
    writes.length = 0; ccEvents.length = 0;
    const pt = (x, y) => (withX ? { clientX: x, clientY: y } : { clientY: y });
    fire('touchstart', { touches: [pt(x0, y0)], target: null });
    for (let i = 1; i <= steps; i++) fire('touchmove', { touches: [pt(x0 + dx * i / steps, y0 + dy * i / steps)] });
    const lift = liftOf();
    fire('touchend', {});
    return { lift, claimed: ccEvents.includes('drag-start'), spring: writes.length };
  }
  let g = gesture(20, 600, 180, -150);                     // Drew's gesture: right, drifting up
  assert(g.claimed, '6d-0: fixture — the REAL drawer binder claims this drag (drag-start dispatched)');
  assert(g.lift === 0 && g.spring === 0,
    `6d-1: THE BUG — the same drag writes NO lift to the page and no spring-back (largest lift ${g.lift}px, ${g.spring} transform writes; before SB-05: ~18.6px, 13 writes)`);
  g = gesture(20, 600, 60, -55);                            // barely-horizontal diagonal
  assert(g.claimed && g.lift === 0, `6d-2: a barely-horizontal diagonal (60 → 55) — drawer claims, bounce yields (lift ${g.lift}px)`);
  g = gesture(200, 600, -160, -120);                        // right-to-left, drifting up
  assert(g.lift === 0, `6d-3: a right-to-left horizontal drag (week-swipe shape) does not lift the page either (lift ${g.lift}px)`);
  g = gesture(200, 600, 5, -140);                           // plain vertical pull up at the bottom
  assert(!g.claimed && g.lift > 5, `6d-4: control — a plain VERTICAL drag up at the bottom still gets the T-29 rubber band (lift ${g.lift.toFixed(1)}px), and the drawer does not claim it`);
  g = gesture(200, 600, 55, -60);                           // barely-vertical diagonal
  assert(!g.claimed && g.lift > 5, `6d-5: a barely-vertical diagonal (55 → 60) — drawer does not claim, bounce keeps it (lift ${g.lift.toFixed(1)}px): the two decisions are exact complements`);
  g = gesture(200, 600, 3, -7, 4);                          // inside the dead zone
  assert(g.lift === 0 && !g.claimed, `6d-6: inside the ${AXIS_DEAD_ZONE_PX}px dead zone nothing is shown yet — the same "before the lock, nothing is shown" rule as pull-to-refresh (lift ${g.lift}px)`);
  g = gesture(200, 600, 0, -140, 12, false);                // legacy touch shape with no clientX
  assert(g.lift > 5, `6d-7: a touch point with no clientX reads as vertical (dx 0) — every older fixture's shape keeps bouncing (lift ${g.lift.toFixed(1)}px)`);
  unbindCC();
  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6c] DI-399(b-ii) — bindBottomPullToRefresh() (UN-359, 2026-09-28) — Chat\'s mirrored bottom-edge pull-to-refresh…');
// ═════════════════════════════════════════════════════════════════════════
{
  // Driven through the REAL binder — same discipline as [4g]/[6b]: this
  // proves the WIRING (which reducer, which eligibility formula, which
  // suspension checks) rather than a hand-rolled model of it. No separate
  // pure `_bottomPullToRefreshStateMachine` exists to batch-test — the DI's
  // own instruction is REUSE stepPullToRefresh, not a parallel reducer, and
  // that reducer is already exhaustively proven pure in [4] above; what's
  // new here is the binder wiring around it (bottom eligibility, dragUp
  // sign, keyboard suspension, the rubber-band visual).
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;

  function makeFakeWindow() {
    const handlers = {};
    return {
      innerHeight: 800,
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
      _handlerCount(type) { return (handlers[type] || []).length; },
    };
  }
  function makeFakeTarget() { return { style: {}, addEventListener() {}, removeEventListener() {} }; }
  // The bounded scroller (Chat's own #chat-scroll), genuinely at its own
  // bottom — scrollTop + clientHeight === scrollHeight, the SAME
  // `_bottomBounceEligible` formula [6b] already exercises.
  function makeChatAtBottom() { return { scrollTop: 800, clientHeight: 400, scrollHeight: 1200, addEventListener() {}, removeEventListener() {} }; }
  function makeChatNotAtBottom() { return { scrollTop: 0, clientHeight: 400, scrollHeight: 1200, addEventListener() {}, removeEventListener() {} }; }

  // `activeTab` defaults to 'chat' — every case in this section models
  // Chat actually being the visible tab (the real precondition
  // bindBottomPullToRefresh() is bound under); [6c-11] below flips it to
  // prove the NEW body[data-tab] gate (reviewer round 2, finding 1) is
  // load-bearing on its own, independent of app.js's own unbind-before-
  // rebind discipline (which this file cannot see — that half is proven in
  // headermetatest.mjs against the real app.js).
  function freshDocEnv({ keyboardUp = false, activeTab = 'chat' } = {}) {
    const dataset = {};
    if (keyboardUp) dataset.keyboardUp = '';
    if (activeTab) dataset.tab = activeTab;
    globalThis.document = {
      getElementById: (id) => (id === 'chat-sheet-wrap' || id === 'site-gate-overlay' || id === 'league-page-overlay' || id === 'week-wizard-sheet-wrap') ? null : null,
      querySelector: () => null,
      body: { dataset },
    };
  }

  // 6c-1 — eligibility mirrors _bottomBounceEligible, at the bottom edge:
  // dragging up while genuinely NOT at the scroller's own bottom never arms
  // or refreshes, however far the finger travels.
  {
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatNotAtBottom(); const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => chat, target, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - 100 }] }); // dragUp 100px, well past ARM_PX
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '6c-1: NOT at the scroller\'s own bottom — dragging up never arms or refreshes, however far (mirrors [4d]\'s top-edge case)');
    assert(target.style.transform === '' || target.style.transform === undefined, '6c-1b: …and no rubber-band visual applies either, ineligible from touchstart');
  }

  // 6c-2 — at the true bottom, dragging UP past PULL_TO_REFRESH_ARM_PX
  // arms, and releasing calls refreshFn — the SAME 64px threshold
  // stepPullToRefresh already enforces for the top-edge binder, reused
  // unmodified.
  {
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => chat, target, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - (PULL_TO_REFRESH_ARM_PX + 4) }] }); // past the arm point
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 1, `6c-2: at the true bottom, dragging up ${PULL_TO_REFRESH_ARM_PX + 4}px (past PULL_TO_REFRESH_ARM_PX=${PULL_TO_REFRESH_ARM_PX}) arms and release calls refreshFn exactly once`);
  }

  // 6c-3 — dragging DOWN (into older history) is the opposite sign and
  // never arms, however far — this is the exact case Drew's own testing
  // named (matrix row 2c): the reader must be able to scroll up through
  // history freely.
  {
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => chat, target, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 + 100 }] }); // dragging DOWN — dragUp negative
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '6c-3: dragging DOWN from the bottom (into history) never arms — only drag-UP-past-the-bottom is this gesture\'s positive axis');
  }

  // 6c-4 — axis lock: a horizontally-dominant drag never arms, mirroring
  // AXIS_DEAD_ZONE_PX exactly as the top-edge binder's own [4]/stepPullToRefresh
  // touchmove branch already enforces (reused unmodified, not re-derived).
  {
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => chat, target, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400, clientX: 200 }] });
    // The axis commits on the FIRST move past the dead zone (state.axis is
    // sticky thereafter) — |dx|=90 clearly dominates |dy|=10 here, so this
    // locks 'x', unlike an equal-magnitude first move (which the reducer's
    // own `>` comparison — not `>=` — would resolve to 'y', a tie-break
    // that is itself proven, not assumed, by this fixture's clear margin).
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - 10, clientX: 200 - 90 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - 90, clientX: 200 - 95 }] }); // axis stays 'x' regardless of this later vertical distance
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '6c-4: a horizontally-committed drag (a reply-swipe on the last message) never arms the refresh, whatever its vertical distance');
  }

  // 6c-5 — gesturesSuspended() (a modal/gate/sheet open) refuses entirely.
  {
    globalThis.document = {
      getElementById: (id) => id === 'chat-sheet-wrap' ? {} : null,
      querySelector: () => null,
      body: { dataset: {} },
    };
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => chat, target, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - 100 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '6c-5: gesturesSuspended() (chat-sheet/modal/gate open) refuses the gesture entirely, same as every other binder in this file');
  }

  // 6c-6 — isKeyboardUp() ALSO suspends this binder specifically (a
  // deliberate difference from the top-edge binder, named in the handoff):
  // the composer sits at exactly this gesture's edge, so a drag while
  // typing must resolve to normal text interaction, never an armed refresh.
  {
    freshDocEnv({ keyboardUp: true });
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => chat, target, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - 100 }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '6c-6: with the keyboard up (composer focused), the gesture is suspended too — isKeyboardUp(), checked IN ADDITION to gesturesSuspended() (which does not itself cover the keyboard, by its own header\'s amendment)');
  }

  // 6c-7 — onFail is REQUIRED, exactly like the top-edge binder ([4g-1]):
  // omitting it returns the same inert no-op binder, never a gesture that
  // might silently fail.
  {
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    const unbindNoFail = bindBottomPullToRefresh(() => chat, target, async () => {}, {});
    assert(typeof unbindNoFail === 'function', '6c-7a: bindBottomPullToRefresh() without onFail still returns a function (the no-op contract)');
    assert(fakeWin._handlerCount('touchstart') === 0, '6c-7b: …and attached ZERO listeners — no onFail means no gesture');
  }

  // 6c-8 — WeakMap idempotency, same shape as every other binder here.
  {
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    const unbindA = bindBottomPullToRefresh(() => chat, target, async () => {}, { onFail: () => {} });
    const unbindB = bindBottomPullToRefresh(() => chat, target, async () => {}, { onFail: () => {} });
    assert(unbindA === unbindB, '6c-8: a second bind() for the same scroll element returns the SAME unbind function (attaches once)');
  }

  // 6c-9 — the rubber-band visual (Precedence over bindBottomBounce on
  // Chat's own scroller): dragging up past the bottom applies
  // _rubberBandOffset() to `target.style.transform` DURING the drag (the
  // SAME resistance curve/target shape bindBottomBounce uses, so the
  // reader never sees a bare unstyled overscroll followed by a themed
  // one), and release clears it.
  {
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    bindBottomPullToRefresh(() => chat, target, async () => {}, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - 20 }] }); // below the arm point — still "pulling"
    assert(typeof target.style.transform === 'string' && target.style.transform.includes('translateY('),
      '6c-9a: mid-drag (below the arm point), the rubber-band resistance curve is already visible — the reader is never shown a bare unstyled overscroll');
    fakeWin._fire('touchend', {});
    assert(target.style.transform === '', '6c-9b: release clears the visual (settles back to no offset)');
  }

  // 6c-10 — structural: the success path calls the SAME completion haptic
  // the top-edge binder fires (js/nav-gestures.js's own runRefresh(),
  // haptic('light')), and the source calls stepPullToRefresh/
  // _bottomBounceEligible/_rubberBandOffset — reuse, not reimplementation,
  // checked against the SHIPPED file rather than assumed.
  {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./js/nav-gestures.js', import.meta.url), 'utf8');
    const fnStart = src.indexOf('export function bindBottomPullToRefresh');
    const fnBody = src.slice(fnStart, fnStart + 6000);
    assert(fnStart > 0, '6c-10 fixture: bindBottomPullToRefresh() is a real export in js/nav-gestures.js');
    assert(/stepPullToRefresh\(state, \{ type: 'touchmove'/.test(fnBody), '6c-10a: touchmove is fed through the SAME stepPullToRefresh() reducer [4] already proves — not a parallel one');
    assert(/_bottomBounceEligible\(/.test(fnBody), '6c-10b: eligibility reuses _bottomBounceEligible() — the SAME "true bottom" formula bindBottomBounce() uses, not a second formula');
    assert(/_rubberBandOffset\(/.test(fnBody), '6c-10c: the drag visual reuses _rubberBandOffset() — the SAME resistance curve, not a bespoke one');
    assert(/haptic\('light'\)/.test(fnBody), "6c-10d: success fires haptic('light') — the SAME completion haptic the top-edge binder fires");
    assert(/isKeyboardUp\(\)/.test(fnBody) && /gesturesSuspended\(\)/.test(fnBody), '6c-10e: suspension checks BOTH gesturesSuspended() and isKeyboardUp() — named, not silently only one');
    // Reviewer round 2 (2026-09-28) — the explicit `eligible` field, not the
    // MAX_SAFE_INTEGER sentinel an earlier version faked through
    // _pullToRefreshEligible().
    assert(/stepPullToRefresh\(state, \{ type: 'touchstart', eligible:/.test(fnBody),
      '6c-10f: touchstart passes an explicit `eligible` boolean into stepPullToRefresh() — not a fabricated scrollTop sentinel');
    assert(!/MAX_SAFE_INTEGER/.test(fnBody), '6c-10g: the MAX_SAFE_INTEGER sentinel is gone from this binder entirely');
    assert(/getScrollElFrom\(getScrollEl\)/.test(fnBody) && /isScrollElLive\(/.test(fnBody) && /isChatTabActive\(\)/.test(fnBody),
      '6c-10h: RG-281 — onTouchStart re-resolves getScrollEl() FRESH and checks isScrollElLive()/isChatTabActive() before trusting it, never the bind-time `scrollEl` alone');
  }

  // ── RG-281 (reviewer round 2, 2026-09-28) — the regressions named in the
  //    BLOCK, reproduced against the REAL binder. Red on e2af0fc first
  //    (confirmed by hand before the fix landed): a bind-time-only
  //    `scrollEl` plus a WeakMap keyed on that SAME resolved node meant a
  //    replaced/detached/off-tab node still answered "eligible" via
  //    `_bottomBounceEligible(0,0,0)` — a stale binder that should be dead
  //    fired a refresh on a real drag anyway. ──────────────────────────────
  console.log('   [6c-11..13] RG-281 — a replaced, detached, or off-tab scroll element never fires a stale refresh…');
  {
    // 6c-11 — bind, then the CALLER replaces the node getScrollEl()
    // resolves to (exactly what renderChatPage()'s c.innerHTML= does on
    // every repaint) — the FRESH node is a real, connected, but NOT-at-
    // bottom chat-scroll (a newly-opened room, say), so the drag must read
    // ITS metrics, not whatever was true of the OLD node at bind time.
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    let current = makeChatAtBottom();           // bind-time node: eligible
    const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => current, target, async () => { refreshed++; }, { onFail: () => {} });
    current = makeChatNotAtBottom();             // renderChatPage() swapped it — no longer at bottom
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - (PULL_TO_REFRESH_ARM_PX + 4) }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '6c-11: bind -> caller replaces the scroll element with a NOT-at-bottom node -> drag -> 0 refreshes (eligibility is read from the CURRENT node, never a bind-time snapshot)');
  }
  {
    // 6c-12 — the replacement node is detached/collapsed (isConnected:false
    // or clientHeight 0 — the shape of a node `renderChatPage()` has thrown
    // away, or the page being hidden). A detached element reports 0 for
    // every scroll metric, which _bottomBounceEligible(0,0,0) reads as
    // "eligible" — isScrollElLive() is the ONLY thing standing between that
    // and a false-positive refresh.
    freshDocEnv();
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    let current = makeChatAtBottom();
    const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => current, target, async () => { refreshed++; }, { onFail: () => {} });
    current = { ...makeChatAtBottom(), isConnected: false }; // detached — still reports "at bottom" metrics
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - (PULL_TO_REFRESH_ARM_PX + 4) }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, '6c-12: the replacement node is DETACHED (isConnected:false) — even though its scrollTop/clientHeight/scrollHeight still read "at the bottom", isScrollElLive() refuses it, so no false-positive refresh');
  }
  {
    // 6c-13 — the belt-and-suspenders gate: Chat is not even the active
    // tab (body[data-tab] !== 'chat') — a stray still-bound instance (the
    // one app.js's own unbind-before-rebind discipline is the STRONG fix
    // for) must not fire on another tab's drag.
    freshDocEnv({ activeTab: 'picks' });
    const fakeWin = makeFakeWindow(); globalThis.window = fakeWin;
    const chat = makeChatAtBottom(); const target = makeFakeTarget();
    let refreshed = 0;
    bindBottomPullToRefresh(() => chat, target, async () => { refreshed++; }, { onFail: () => {} });
    fakeWin._fire('touchstart', { touches: [{ clientY: 400 }] });
    fakeWin._fire('touchmove', { touches: [{ clientY: 400 - (PULL_TO_REFRESH_ARM_PX + 4) }] });
    fakeWin._fire('touchend', {});
    await new Promise(r => setTimeout(r, 0));
    assert(refreshed === 0, "6c-13: body[data-tab] is 'picks', not 'chat' — a live-but-stray binder does not fire on another tab's drag");
  }

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[7] CONFLICT TABLE — gesture ownership per edge/axis (DI-327 coexistence)…');
// ═════════════════════════════════════════════════════════════════════════
{
  // 7a: pull-to-refresh (top) and bottom-bounce (bottom) can never BOTH be
  // eligible for the same scroll position on a page that has any scrollable
  // height — they read opposite edges.
  const innerHeight = 800, scrollHeight = 2000;
  const atTop = { scrollY: 0 };
  const atBottom = { scrollY: scrollHeight - innerHeight };
  assert(_pullToRefreshEligible(atTop.scrollY) === true,
    '7a-1: at true scroll-top, pull-to-refresh is eligible');
  assert(_bottomBounceEligible(atTop.scrollY, innerHeight, scrollHeight) === false,
    '7a-2: …and bottom-bounce is NOT eligible there — T-26 owns the top edge exclusively');
  assert(_pullToRefreshEligible(atBottom.scrollY) === false,
    '7a-3: at true scroll-bottom, pull-to-refresh is NOT eligible');
  assert(_bottomBounceEligible(atBottom.scrollY, innerHeight, scrollHeight) === true,
    '7a-4: …and bottom-bounce IS eligible there — T-29\'s JS fallback owns the bottom edge exclusively');

  // 7b: mid-scroll, NEITHER is eligible — no gesture fires at all, which is
  // exactly "no competing gestures" for the vertical axis away from either
  // edge.
  const mid = { scrollY: 900 };
  assert(_pullToRefreshEligible(mid.scrollY) === false && _bottomBounceEligible(mid.scrollY, innerHeight, scrollHeight) === false,
    '7b: mid-scroll, neither top nor bottom gesture is eligible — no competing gestures away from either edge');

  // 7c: T-24 (nav-hide) is direction-driven, not edge-driven, and orthogonal
  // to both T-26/T-29 — a down-scroll that reaches the bottom edge still
  // resolves nav-hide independently of the bottom-bounce eligibility.
  const navAtBottom = _navShowHideStateMachine([{ type: 'scroll', dy: 30, scrollY: atBottom.scrollY }]);
  assert(navAtBottom[0] === true,
    '7c: nav-hide reacts to scroll DIRECTION near the bottom edge same as anywhere else — independent axis, no special-casing needed against T-29');

  // 7d: T-27 (week-swipe) is horizontal; T-24/26/29 are vertical. The
  // left-edge exclusion (28px) is strictly smaller than nothing here fires
  // on a vertical delta — confirmed structurally: _weekSwipeResolve() only
  // ever takes a horizontal dx, never a scrollY/scrollTop input, so it
  // cannot be triggered by a vertical gesture regardless of DOM wiring.
  assert(_weekSwipeResolve.length === 3 && !_weekSwipeResolve.toString().includes('scrollY'),
    '7d: _weekSwipeResolve() has no vertical-scroll input at all — axis separation from T-24/26/29 is structural, not just conventional');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[8] js/haptics.js — native-only, no-op off native, never throws…');
// ═════════════════════════════════════════════════════════════════════════
{
  const { haptic } = await import('./js/haptics.js');

  // 8a: off-native (no window.Capacitor at all, the real irbfootball.com
  // case today) — every kind is a silent no-op, never throws.
  delete globalThis.window;
  let threw = false;
  try { haptic('medium'); haptic('light'); haptic('selection'); haptic('success'); haptic('nonsense'); }
  catch { threw = true; }
  assert(!threw, '8a: haptic() never throws when `window` does not exist at all');

  // 8b: web (window exists, no Capacitor) — still a no-op, never throws.
  globalThis.window = {};
  threw = false;
  try { haptic('medium'); } catch { threw = true; }
  assert(!threw, '8b: haptic() never throws on a plain web window with no Capacitor bridge');

  // 8c: window.Capacitor exists but isNativePlatform() is false (a spoofed
  // or partial object on a real web origin) — still must not fire.
  let calls = [];
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => false,
      Plugins: { Haptics: { impact: (o) => calls.push(['impact', o]) } },
    },
  };
  haptic('medium');
  assert(calls.length === 0, '8c: isNativeShell() === false (isNativePlatform() false) -> no Haptics call, even with a Plugins.Haptics object present');

  // 8d: genuine native (isNativePlatform() true) + Haptics present — the
  // real plugin calls fire, mapped exactly as specified.
  calls = [];
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        Haptics: {
          impact: (o) => calls.push(['impact', o]),
          // iOS shell parity check (2026-09-26) — the installed
          // @capacitor/haptics iOS plugin compares style/type strings
          // CASE-SENSITIVELY against 'MEDIUM'/'LIGHT'/'HEAVY' and defaults
          // to HEAVY on anything else ('Medium'/'Light' fired heavy on
          // every call); and selectionChanged() only fires a real haptic
          // if a generator exists from a PRIOR selectionStart() — the fake
          // now exposes both so the start -> changed -> end sequence is
          // observable, not just the middle call.
          selectionStart: () => calls.push(['selectionStart']),
          selectionChanged: () => calls.push(['selectionChanged']),
          selectionEnd: () => calls.push(['selectionEnd']),
          notification: (o) => calls.push(['notification', o]),
        },
      },
    },
  };
  haptic('medium');
  haptic('light');
  haptic('selection');
  haptic('success');
  haptic('unknown-kind');
  assert(calls.length === 6, `8d-0: exactly six plugin calls fired for four recognized kinds ('selection' fires three: start/changed/end), the unknown kind is a silent no-op (got ${calls.length})`);
  assert(calls[0][0] === 'impact' && calls[0][1].style === 'MEDIUM', "8d-1: 'medium' -> Haptics.impact({style:'MEDIUM'}) — UPPER-CASE, the iOS plugin's case-sensitive comparison (2026-09-26 parity fix)");
  assert(calls[1][0] === 'impact' && calls[1][1].style === 'LIGHT', "8d-2: 'light' -> Haptics.impact({style:'LIGHT'}) — UPPER-CASE, same fix");
  assert(calls[2][0] === 'selectionStart' && calls[3][0] === 'selectionChanged' && calls[4][0] === 'selectionEnd',
    `8d-3: 'selection' -> the documented selectionStart() -> selectionChanged() -> selectionEnd() sequence, in order (got ${JSON.stringify(calls.slice(2, 5).map(c => c[0]))}) — selectionChanged() alone never fired a real haptic without a prior selectionStart() (2026-09-26 parity fix)`);
  assert(calls[5][0] === 'notification' && calls[5][1].type === 'SUCCESS', "8d-4: 'success' -> Haptics.notification({type:'SUCCESS'}) when the plugin exposes it");

  // 8e: native + Haptics present, but selectionChanged/notification are NOT
  // exposed by this plugin version — documented fallback to a LIGHT impact
  // (UPPER-CASE, 2026-09-26 parity fix).
  calls = [];
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { Haptics: { impact: (o) => calls.push(['impact', o]) } },
    },
  };
  haptic('selection');
  haptic('success');
  assert(calls.length === 2 && calls.every(c => c[0] === 'impact' && c[1].style === 'LIGHT'),
    "8e: 'selection'/'success' fall back to a LIGHT impact when selectionChanged()/notification() are not exposed");

  // 8f: even a THROWING plugin call must not escape haptic() — a broken
  // native bridge must never break the gesture it is decorating.
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { Haptics: { impact: () => { throw new Error('bridge exploded'); } } },
    },
  };
  threw = false;
  try { haptic('medium'); } catch { threw = true; }
  assert(!threw, '8f: haptic() swallows a throwing native plugin call rather than propagating it');

  // 8g (N1, DI-430, 2026-09-30): the New League flow's two extra kinds — an error notification and a warning notification, each with a documented impact
  // fallback, both silent no-ops off native.
  calls = [];
  globalThis.window = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => calls.push(['impact', o]), notification: (o) => calls.push(['notification', o]) } } },
  };
  haptic('error');
  haptic('warning');
  assert(calls.length === 2 && calls[0][0] === 'notification' && calls[0][1].type === 'ERROR' && calls[1][0] === 'notification' && calls[1][1].type === 'WARNING',
    "8g-1: 'error' -> Haptics.notification({type:'ERROR'}) and 'warning' -> Haptics.notification({type:'WARNING'}), UPPER-CASE like every other type string");
  calls = [];
  globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => calls.push(['impact', o]) } } } };
  haptic('error');
  haptic('warning');
  assert(calls.length === 2 && calls[0][1].style === 'MEDIUM' && calls[1][1].style === 'LIGHT',
    "8g-2: without notification() 'error' falls back to a MEDIUM impact and 'warning' to a LIGHT one");
  calls = [];
  globalThis.window = { Capacitor: { isNativePlatform: () => false, Plugins: { Haptics: { impact: (o) => calls.push(['impact', o]), notification: (o) => calls.push(['notification', o]) } } } };
  haptic('error'); haptic('warning');
  assert(calls.length === 0, "8g-3: off native both new kinds are silent no-ops");

  delete globalThis.window;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[9] gesturesSuspended()/prefersReducedMotion() — safe without a real DOM…');
// ═════════════════════════════════════════════════════════════════════════
{
  delete globalThis.document;
  delete globalThis.matchMedia;
  let threw = false;
  let result;
  try { result = gesturesSuspended(); } catch { threw = true; }
  assert(!threw && result === false, '9a: gesturesSuspended() is false and does not throw with no `document` at all (Node/test environment)');
  threw = false;
  try { result = prefersReducedMotion(); } catch { threw = true; }
  assert(!threw && result === false, '9b: prefersReducedMotion() is false and does not throw with no `matchMedia` at all');
  threw = false;
  try { result = isKeyboardUp(); } catch { threw = true; }
  assert(!threw && result === false, '9c: isKeyboardUp() is false and does not throw with no `document` at all');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[10] Touched-screen-audit finding (2026-09-25, UX Revamp wiring pass 3c) —');
console.log('     gesturesSuspended() ALSO suspends for #league-page-overlay and');
console.log('     #week-wizard-sheet-wrap — two full-screen overlays that shipped after');
console.log('     this list was originally written…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedDocument = globalThis.document;
  function makeFakeDocForId(idThatExists) {
    return {
      getElementById(id) { return id === idThatExists ? {} : null; },
      querySelector() { return null; },
    };
  }
  globalThis.document = makeFakeDocForId('league-page-overlay');
  assert(gesturesSuspended() === true,
    '10a: gesturesSuspended() is TRUE while #league-page-overlay exists — a week-swipe/pull-to-refresh on the page underneath must not fire through it');
  globalThis.document = makeFakeDocForId('week-wizard-sheet-wrap');
  assert(gesturesSuspended() === true,
    '10b: gesturesSuspended() is TRUE while #week-wizard-sheet-wrap exists — same reasoning, the wizard sheet sits over the Commissioner/Admin tab');
  globalThis.document = makeFakeDocForId('some-unrelated-id');
  assert(gesturesSuspended() === false,
    '10c: fixture check — an UNRELATED element existing does not itself suspend gestures (the two new checks are id-specific, not "any element present")');
  // FIX (RG-298, 2026-09-28, reviewer BLOCK B3) — a THIRD full-screen
  // body-appended overlay, #leagues-home-overlay (DI-418), was missing from
  // this list: pull-to-refresh on the window (the RG-285 defect class) could
  // still arm underneath it.
  globalThis.document = makeFakeDocForId('leagues-home-overlay');
  assert(gesturesSuspended() === true,
    '10d: gesturesSuspended() is TRUE while #leagues-home-overlay exists — same reasoning as League Page/the wizard sheet above');
  // N1 (DI-430, 2026-09-30) — a FOURTH body-appended surface, the New League sheet, built on the wizard's shell.
  globalThis.document = makeFakeDocForId('league-create-sheet-wrap');
  assert(gesturesSuspended() === true,
    '10e: gesturesSuspended() is TRUE while #league-create-sheet-wrap exists — a week-swipe or pull-to-refresh on the page beneath the New League sheet must not arm');
  globalThis.document = savedDocument;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[11] Step 2(b) (2026-09-26) — bindSwipeToDismiss() / _resolveDismissSettle() —');
console.log('     League Page swipe-back + week wizard drag-to-dismiss, shared primitive…');
// ═════════════════════════════════════════════════════════════════════════
{
  assert(DISMISS_SETTLE_RATIO === CC.DRAWER_OPEN_SETTLE_RATIO,
    `11a: DISMISS_SETTLE_RATIO (${DISMISS_SETTLE_RATIO}) matches control-center.js's DRAWER_OPEN_SETTLE_RATIO exactly — one animation language, not a second recipe`);
  assert(DISMISS_FLICK_VELOCITY_PX_MS === CC.DRAWER_FLICK_VELOCITY_PX_MS,
    `11b: DISMISS_FLICK_VELOCITY_PX_MS (${DISMISS_FLICK_VELOCITY_PX_MS}) matches control-center.js's DRAWER_FLICK_VELOCITY_PX_MS exactly`);

  // Pure settle math.
  assert(_resolveDismissSettle({ progress: 0.1, velocityPxPerMs: 0 }) === false,
    '11c: well under the 40% threshold, no flick -> NOT dismissed');
  assert(_resolveDismissSettle({ progress: 0.4, velocityPxPerMs: 0 }) === true,
    '11d: AT the 40% threshold -> dismissed');
  assert(_resolveDismissSettle({ progress: 0.39, velocityPxPerMs: 0 }) === false,
    '11e: just under 40% -> not dismissed (boundary is inclusive at 0.4, not 0.39)');
  assert(_resolveDismissSettle({ progress: 0.1, velocityPxPerMs: 0.3 }) === true,
    '11f: a fast flick (>= 0.3px/ms) dismisses even at low progress — matches the drawer\'s own flick-overrides-distance rule');
  assert(_resolveDismissSettle({ progress: 0.1, velocityPxPerMs: -0.3 }) === false,
    "11g: a flick in the WRONG (backward) direction never forces a dismiss — only forward velocity counts");
  // Reviewer R3 (third pass) — the drawer's backward-flick CANCEL: past the
  // threshold, a backward flick still says no.
  assert(_resolveDismissSettle({ progress: 0.5, velocityPxPerMs: -0.3 }) === false,
    '11g2: progress 0.5 (past 40%) with a BACKWARD flick (-0.3px/ms) settles CANCELLED — same rule as control-center.js _resolveDrawerSettle()');
  assert(CC._resolveDrawerSettle({ progress: 0.5, velocityPxPerMs: -0.3 }) === _resolveDismissSettle({ progress: 0.5, velocityPxPerMs: -0.3 }),
    '11g3: …and it agrees with the drawer on that exact input (one animation language)');
  assert(_resolveDismissSettle({ progress: 0.5, velocityPxPerMs: -0.1 }) === true,
    '11g4: a slow backward drift (under the flick floor) past 40% still dismisses — only a real flick cancels');

  // bindSwipeToDismiss() is native-only — PARITY-BY-DESIGN, no web gesture.
  const savedWindow = globalThis.window;
  delete globalThis.window;
  function makeFakeTouchEl() {
    const handlers = {};
    return {
      addEventListener(type, fn) { handlers[type] = fn; },
      removeEventListener(type) { delete handlers[type]; },
      getBoundingClientRect() { return { width: 300, height: 500 }; },
      _handlers: handlers,
      _fire(type, touch) { handlers[type]?.({ touches: touch ? [touch] : [] }); },
    };
  }
  const webEl = makeFakeTouchEl();
  const unbindWeb = bindSwipeToDismiss(webEl, { axis: 'x', getDistancePx: () => 300, onSettle: () => { throw new Error('must not fire on web'); } });
  assert(Object.keys(webEl._handlers).length === 0,
    '11h: on web (no window.Capacitor), bindSwipeToDismiss() attaches NO listeners at all');
  let unbindWebThrew = false;
  try { unbindWeb(); } catch { unbindWebThrew = true; }
  assert(!unbindWebThrew, '11i: the no-op unbind function returned on web is safe to call');

  // Native — drive the real binder through a fake touch-capable element.
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  {
    const el = makeFakeTouchEl();
    const progressLog = [];
    let settleResult = null;
    const blockedFlags = { blocked: false };
    bindSwipeToDismiss(el, {
      axis: 'x',
      getBlocked: () => blockedFlags.blocked,
      getDistancePx: () => 300,
      onProgress: (p) => progressLog.push(p),
      onSettle: (r) => { settleResult = r; },
    });
    assert(typeof el._handlers.touchstart === 'function' && typeof el._handlers.touchmove === 'function' && typeof el._handlers.touchend === 'function',
      '11j: on native, bindSwipeToDismiss() attaches touchstart/touchmove/touchend');

    // Events below are deliberately spaced with a REAL delay (`sleep`) rather
    // than fired back-to-back — firing synchronously makes dt~1ms and would
    // compute an artificially huge velocity for ANY drag, always tripping
    // the flick path regardless of distance. Spacing them out is what makes
    // these two cases actually isolate the DISTANCE-based settle rule from
    // the velocity-based one (11f/11g above already cover velocity alone).
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Drag 150px of 300 (50% — past the 40% threshold) left-to-right, then release.
    el._fire('touchstart', { clientX: 0, clientY: 0 });
    el._fire('touchmove', { clientX: 20, clientY: 0 }); // past the 8px dead zone, locks axis 'x'
    await sleep(500);
    el._fire('touchmove', { clientX: 150, clientY: 0 }); // 130px over ~500ms ≈ 0.26px/ms, under the 0.3 flick floor — this is a DISTANCE dismiss, not a flick one
    el._fire('touchend');
    assert(progressLog.length > 0 && progressLog[progressLog.length - 1] > 0.4,
      `11k: onProgress reports > 0.4 partway through a 150/300px drag (got ${JSON.stringify(progressLog)})`);
    assert(settleResult && settleResult.dismissed === true,
      '11l: releasing past the 40% distance threshold (velocity under the flick floor) settles DISMISSED — a genuine distance dismiss, not a flick');

    // Same drag, but only 50px of 300 (~16.7%, under threshold), spaced out
    // enough that velocity stays well under the 0.3px/ms flick floor
    // (30px over 300ms = 0.1px/ms) — this genuinely isolates "under distance,
    // no flick" rather than accidentally tripping the velocity path.
    settleResult = null;
    el._fire('touchstart', { clientX: 0, clientY: 0 });
    el._fire('touchmove', { clientX: 20, clientY: 0 });
    await sleep(300);
    el._fire('touchmove', { clientX: 50, clientY: 0 });
    await sleep(50);
    el._fire('touchend');
    assert(settleResult && settleResult.dismissed === false,
      '11m: releasing under the 40% threshold with velocity under the flick floor settles CANCELLED');

    // getBlocked() true at touchstart refuses to arm at all.
    settleResult = null; progressLog.length = 0;
    blockedFlags.blocked = true;
    el._fire('touchstart', { clientX: 0, clientY: 0 });
    el._fire('touchmove', { clientX: 20, clientY: 0 });
    el._fire('touchmove', { clientX: 200, clientY: 0 });
    el._fire('touchend');
    assert(progressLog.length === 0 && settleResult === null,
      '11n: getBlocked() === true at touchstart means NO progress/settle callbacks fire at all — another surface (site-gate/modal/chat-sheet/control-center) is on top');
    blockedFlags.blocked = false;

    // Axis lock — a vertical drag never drives an axis:'x' binder's progress.
    settleResult = null; progressLog.length = 0;
    el._fire('touchstart', { clientX: 0, clientY: 0 });
    el._fire('touchmove', { clientX: 0, clientY: 40 }); // vertical past the dead zone -> locks 'y'
    el._fire('touchmove', { clientX: 0, clientY: 200 });
    el._fire('touchend');
    assert(progressLog.length === 0 && (settleResult === null || settleResult.dismissed === false),
      "11o: a predominantly-vertical drag never engages an axis:'x' binder (axis-lock, same dead-zone-then-lock discipline as every other gesture in this file)");
  }

  // A 'y'-axis binder (the wizard sheet's own configuration) responds to a
  // downward drag the same way the 'x' binder responded to a rightward one.
  {
    const el = makeFakeTouchEl();
    let settleResult = null;
    bindSwipeToDismiss(el, { axis: 'y', getDistancePx: () => 500, onSettle: (r) => { settleResult = r; } });
    // Reviewer R3 — spaced like 11l so this takes the DISTANCE path, not a
    // synchronous-fire "flick" (240px over ~1000ms = 0.24px/ms, under 0.3).
    const sleepP = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    el._fire('touchstart', { clientX: 0, clientY: 0 });
    el._fire('touchmove', { clientX: 0, clientY: 20 });
    await sleepP(1000);
    el._fire('touchmove', { clientX: 0, clientY: 260 }); // 260/500 = 52%, past threshold
    el._fire('touchend');
    assert(settleResult && settleResult.dismissed === true,
      '11p: axis:\'y\' (the wizard sheet\'s configuration) dismisses on a downward drag past 40% of its own distance, same math as axis:\'x\'');
  }

  // ── 11n-real — Security gate F2 (3c fix window, third pass). 11n above
  // proves the BINDER honours getBlocked(); it used a stub, so it could not
  // see that the wizard was wired to a predicate that is ALWAYS true while the
  // wizard is open (it counted the wizard's own wrap as a blocking surface).
  // This drives the REAL predicates: their source is extracted from js/app.js
  // (loadtest [1d]'s technique — this file does not import app.js) and run
  // against a fake document, then handed to the real binder as getBlocked.
  {
    const { readFileSync } = await import('node:fs');
    const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const a = appSrc.indexOf('function _dismissBlockingSurfaceUp(');
    const bMark = 'function isWizardDismissGestureBlocked() {';
    const b = appSrc.indexOf(bMark);
    const c = b > -1 ? appSrc.indexOf('\n}\n', b) : -1;
    assert(a > -1 && b > a && c > b, '11n-real-pre: fixture — the three dismiss-blocking predicates were extracted from js/app.js');
    const mod = await import('data:text/javascript,' + encodeURIComponent([
      'let document = null; export function _setDoc(d) { document = d; }',
      appSrc.slice(a, c + 2),
      'export { _dismissBlockingSurfaceUp, isDismissGestureBlockedByOtherSurface, isWizardDismissGestureBlocked };',
    ].join('\n')));
    const docWith = (ids = [], sels = []) => ({
      getElementById: (id) => (ids.includes(id) ? { id } : null),
      querySelector: (sel) => (sels.includes(sel) ? {} : null),
    });
    mod._setDoc(docWith(['week-wizard-sheet-wrap']));
    assert(mod.isWizardDismissGestureBlocked() === false,
      '11n-real-1: with ONLY the wizard\'s own wrap present, the wizard\'s predicate is FALSE (it no longer blocks itself)');
    assert(mod.isDismissGestureBlockedByOtherSurface() === true,
      '11n-real-2: …while the League Page\'s predicate still counts the wizard as a surface on top (unchanged)');
    for (const [label, doc] of [
      ['#site-gate-overlay', docWith(['week-wizard-sheet-wrap', 'site-gate-overlay'])],
      ['.modal-overlay', docWith(['week-wizard-sheet-wrap'], ['.modal-overlay'])],
      ['#chat-sheet-wrap', docWith(['week-wizard-sheet-wrap', 'chat-sheet-wrap'])],
      ['open control center', docWith(['week-wizard-sheet-wrap'], ['#control-center[data-open="true"]'])],
    ]) {
      mod._setDoc(doc);
      assert(mod.isWizardDismissGestureBlocked() === true, `11n-real-3: the wizard's predicate still blocks for ${label}`);
    }
    // The real binder, the real predicate, only the wizard open: the drag
    // actually arms and settles (it never could before this fix).
    mod._setDoc(docWith(['week-wizard-sheet-wrap']));
    const el = makeFakeTouchEl();
    let settled = null; const prog = [];
    bindSwipeToDismiss(el, { axis: 'y', getBlocked: mod.isWizardDismissGestureBlocked, getDistancePx: () => 500,
      onProgress: (p) => prog.push(p), onSettle: (r) => { settled = r; } });
    el._fire('touchstart', { clientX: 0, clientY: 0 });
    el._fire('touchmove', { clientX: 0, clientY: 20 });
    el._fire('touchmove', { clientX: 0, clientY: 260 });
    el._fire('touchend');
    assert(prog.length > 0 && settled && settled.dismissed === true,
      '11n-real-4: the wizard\'s drag-to-dismiss, bound with its REAL predicate and only the wizard open, arms and dismisses');
    // …and with the shared predicate (the pre-fix wiring) it never arms.
    const el2 = makeFakeTouchEl();
    let settled2 = null;
    bindSwipeToDismiss(el2, { axis: 'y', getBlocked: mod.isDismissGestureBlockedByOtherSurface, getDistancePx: () => 500, onSettle: (r) => { settled2 = r; } });
    el2._fire('touchstart', { clientX: 0, clientY: 0 });
    el2._fire('touchmove', { clientX: 0, clientY: 20 });
    el2._fire('touchmove', { clientX: 0, clientY: 260 });
    el2._fire('touchend');
    assert(settled2 === null, '11n-real-5 control: bound to the shared predicate (the pre-fix wiring) the same drag never fires — the defect this closes');
    // The wizard opener really binds the wizard predicate (comment-stripped).
    // N1 (DI-430, 2026-09-30) — the wizard's opener is now a thin caller of the shared mountSheetShell(), which takes the drag hooks in a `drag:` object; the binding this
    // pins is the same (`getBlocked: isWizardDismissGestureBlocked`), only its home moved. Re-derived against mountWeekWizardSheetShell().
    const openerAt = appSrc.indexOf('function mountWeekWizardSheetShell() {');
    const opener = appSrc.slice(openerAt, openerAt + 2200)
      .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    assert(openerAt > -1 && /getBlocked:\s*isWizardDismissGestureBlocked\b/.test(opener) && !/getBlocked:\s*isDismissGestureBlockedByOtherSurface\b/.test(opener),
      '11n-real-6: the wizard sheet opener binds getBlocked: isWizardDismissGestureBlocked (not the shared predicate)');
    // …and the New League sheet's opener binds ITS OWN predicate (the same "other surface" carve-out, plus off while a create is in flight).
    const lcAt = appSrc.indexOf('function openLeagueCreateSheet(');
    const lcOpener = appSrc.slice(lcAt, lcAt + 3200).split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    assert(lcAt > -1 && /getBlocked:\s*isLeagueCreateDismissGestureBlocked\b/.test(lcOpener) && !/getBlocked:\s*isDismissGestureBlockedByOtherSurface\b/.test(lcOpener),
      '11n-real-7: the New League sheet opener binds getBlocked: isLeagueCreateDismissGestureBlocked (its own predicate — the shared one counts its own wrap and would never arm)');
    mod._setDoc(docWith(['league-create-sheet-wrap']));
    assert(mod._dismissBlockingSurfaceUp({ excludeCreate: true }) === false,
      '11n-real-8: with ONLY the New League sheet\'s own wrap present, its predicate\'s list is FALSE (it does not block itself)');
    assert(mod.isDismissGestureBlockedByOtherSurface() === true && mod.isWizardDismissGestureBlocked() === true,
      '11n-real-9: …while the League Page\'s and the wizard\'s predicates both count the New League sheet as a surface on top');
    mod._setDoc(docWith(['league-create-sheet-wrap'], ['.modal-overlay']));
    assert(mod._dismissBlockingSurfaceUp({ excludeCreate: true }) === true,
      '11n-real-10: a modal raised over the New League sheet still blocks its swipe-down');
  }

  // Idempotent double-bind — same shape as bindWeekSwipe()'s WeakMap guard.
  {
    const el = makeFakeTouchEl();
    const unbind1 = bindSwipeToDismiss(el, { axis: 'x', getDistancePx: () => 300 });
    const handlersAfterFirst = { ...el._handlers };
    const unbind2 = bindSwipeToDismiss(el, { axis: 'x', getDistancePx: () => 300 });
    assert(unbind1 === unbind2,
      '11q: binding the SAME element twice returns the SAME unbind function (WeakMap idempotency, same shape as bindWeekSwipe())');
    assert(el._handlers.touchstart === handlersAfterFirst.touchstart,
      '11r: …and does not attach a second set of listeners');
  }

  globalThis.window = savedWindow;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[12] v0.27.x bugfix (Drew, 2026-09-27, iOS home-screen app) — "When I click the chat box in the chat tab it … jumps to the top of the chat thread and not the bottom where the message box is"…');
// ═════════════════════════════════════════════════════════════════════════
{
  // ROOT CAUSE (reproduced in real Blink, headless Chrome 153, 390×844,
  // against the shipped css/styles.css — scratch repro, figures below):
  //
  //   body[data-keyboard-up] #page-chat.active{--nav-height:0}
  //
  // zeroes the token with a UNITLESS 0. #page-chat.active's height is
  // `calc(100dvh - var(--nav-height) - env(safe-area-inset-bottom,0px))`;
  // after substitution that is `calc(100dvh - 0 - …)`, and a <number> minus
  // a <length> is a TYPE ERROR in calc() (CSS Values 4 — unitless zero is
  // not a length inside calc). A var()-substituted declaration that fails to
  // parse is "invalid at computed-value time": `height` falls back to its
  // initial value, `auto`. The bounded flex column is gone, #page-chat grows
  // to its full content height, .chat-scroll stops overflowing (its
  // scrollTop is clamped to 0 — the OLDEST messages), and the composer sits
  // at the bottom of a document thousands of px tall. Measured:
  //   before      page 697px  thread sT 6096/cH 574/sH 6670  composer top 621
  //   keyboard-up page 6793px thread sT 0   /cH 6670        composer top 6717
  //   kbd-down    page 697px  thread sT 0   (stays on the oldest messages)
  // With `0px` the same run holds page 757px, thread pinned, composer 681.
  // Node has no CSS engine, so 12a guards the CSS statically and 12b drives
  // the JS half (the real keyboard binder + the real thread anchor).
  const { readFileSync } = await import('node:fs');
  const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

  // A custom property declared as a bare unitless `0` and consumed via
  // var() inside a calc() that also carries lengths is the exact defect
  // class: every such calc() goes invalid-at-computed-value-time the moment
  // the zero is in effect. Returns the offending property names.
  function unitlessZeroTokensUsedInCalc(cssText) {
    const css = stripCssComments(cssText);
    const zeroDecl = /(?:^|[{;\s])(--[A-Za-z0-9_-]+)\s*:\s*0\s*(?:!important\s*)?(?=[;}])/g;
    const zeroed = new Set();
    for (let m; (m = zeroDecl.exec(css));) zeroed.add(m[1]);
    const offenders = [];
    for (const name of zeroed) {
      const esc = name.replace(/[-]/g, '\\-');
      // any declaration value holding calc( … var(--name …
      const usedInCalc = new RegExp(`calc\\([^;{}]*var\\(\\s*${esc}\\s*[,)]`).test(css);
      if (usedInCalc) offenders.push(name);
    }
    return offenders;
  }

  // 12a-control — the checker is not vacuous: it flags the defect shape and
  // clears the fixed shape.
  assert(unitlessZeroTokensUsedInCalc('a{--x:0}b{height:calc(100dvh - var(--x) - 2px)}').join() === '--x',
    '12a-control-1: the checker FLAGS a unitless `--x:0` consumed inside calc() (the defect shape)');
  assert(unitlessZeroTokensUsedInCalc('a{--x:0px}b{height:calc(100dvh - var(--x) - 2px)}').length === 0,
    '12a-control-2: …and CLEARS `--x:0px` (the fixed shape)');
  assert(unitlessZeroTokensUsedInCalc('a{--x:0}b{opacity:var(--x)}').length === 0,
    '12a-control-3: …and does not flag a unitless 0 that is never used inside calc() (a legitimate <number> token)');

  const shippedCss = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
  const offenders = unitlessZeroTokensUsedInCalc(shippedCss);
  assert(offenders.length === 0,
    `12a-1: css/styles.css zeroes NO custom property with a unitless 0 that a calc() consumes — found [${offenders.join(', ')}]; ` +
    'the keyboard-up rule must read `body[data-keyboard-up] #page-chat.active{--nav-height:0px}` (a unitless 0 makes #page-chat.active\'s ' +
    'height calc() invalid at computed-value time → height:auto → the thread stops scrolling and shows the oldest messages)');
  const kbdRule = stripCssComments(shippedCss).match(/body\[data-keyboard-up\]\s*#page-chat\.active\s*\{([^}]*)\}/);
  assert(!!kbdRule, '12a-2: fixture check — the T-25 keyboard-up override rule for #page-chat.active still exists');
  // The token was renamed --nav-height → --nav-bar-clearance by the DI-397 pill
  // CSS pass (2026-09-27); the pin accepts either name — what matters is the
  // length UNIT on the zero (RG-275's root cause was the unitless 0).
  assert(!!kbdRule && /--nav-(?:height|bar-clearance)\s*:\s*0(?:px|rem|em|vh|dvh)\s*(?:;|$)/.test(kbdRule[1].trim()),
    `12a-3: that rule zeroes the nav clearance token WITH a length unit (got "${kbdRule ? kbdRule[1].trim() : '—'}")`);

  // ── 12b — the JS half: the thread keeps its place across the keyboard
  // layout change. Once the height is bounded again (12a), the thread's
  // viewport still changes size twice per keyboard cycle: +--nav-height when
  // the keyboard comes up (the browser clamps scrollTop, so a bottom-pinned
  // thread stays pinned), and −--nav-height when it goes down — where
  // scrollTop is simply kept, leaving the newest 60px hidden under the
  // composer. Blink hides that with CSS scroll anchoring; WebKit (the
  // home-screen app, WKWebView) has none — measured with overflow-anchor:none
  // the dismissed thread sits at sT 6036/cH 574/sH 6670, 60px short.
  // Driven through the REAL bindKeyboardAvoid() (fake visualViewport) and
  // the REAL bindBottomAnchor(); the only modelled step is layout itself
  // (thread clientHeight 574 ↔ 634 with the flag, the Chrome-measured values).
  const bindBottomAnchor = NG.bindBottomAnchor;
  assert(typeof bindBottomAnchor === 'function', '12b-0: nav-gestures.js exports bindBottomAnchor() (the thread\'s stick-to-bottom binder)');

  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  const savedRO = globalThis.ResizeObserver;

  function makeTarget() {
    const handlers = {};
    return {
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev = {}) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
      _count(type) { return (handlers[type] || []).length; },
    };
  }
  const doc = Object.assign(makeTarget(), { body: { dataset: {} }, getElementById: () => null, querySelector: () => null });
  const vv = Object.assign(makeTarget(), { height: 757 });
  const win = Object.assign(makeTarget(), { innerHeight: 757, visualViewport: vv });
  const observers = [];
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = new Set(); observers.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  }
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.ResizeObserver = FakeResizeObserver;

  // A bounded scroller with browser semantics: scrollTop clamps to
  // [0, scrollHeight − clientHeight], and any change fires 'scroll'.
  function makeThread({ scrollHeight, clientHeight }) {
    const t = makeTarget();
    let top = 0;
    const el = Object.assign(t, { scrollHeight, clientHeight });
    // defineProperty, not Object.assign — assign would flatten the accessor.
    Object.defineProperty(el, 'scrollTop', {
      get() { return top; },
      set(v) {
        const next = Math.max(0, Math.min(v, el.scrollHeight - el.clientHeight));
        if (next !== top) { top = next; el._fire('scroll'); }
      },
    });
    return el;
  }
  const pinned = (el) => Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) <= 1;
  // The layout step Node cannot run: the flag toggles the thread's height,
  // the browser re-clamps scrollTop, then ResizeObservers are notified.
  function relayout(el) {
    const want = 'keyboardUp' in doc.body.dataset ? 634 : 574;
    if (el.clientHeight === want) return;
    el.clientHeight = want;
    el.scrollTop = el.scrollTop; // clamp (fires 'scroll' only if it moved)
    for (const o of observers) if (o.targets.has(el)) o.cb([{ target: el }], o);
  }
  const composer = { tagName: 'TEXTAREA' };
  function keyboardUp(el) {
    doc._fire('focusin', { target: composer });
    vv.height = 757 - 300; vv._fire('resize');
    relayout(el);
  }
  function keyboardDown(el) {
    doc._fire('focusout', { target: composer });
    vv.height = 757; vv._fire('resize');
    relayout(el);
  }

  const unbindKbd = NG.bindKeyboardAvoid();

  // 12b-1…3 — the reported path: thread at the bottom, tap the composer,
  // keyboard up, keyboard down.
  {
    const thread = makeThread({ scrollHeight: 6670, clientHeight: 574 });
    thread.scrollTop = thread.scrollHeight;
    if (typeof bindBottomAnchor === 'function') bindBottomAnchor(thread);
    assert(pinned(thread) && thread.scrollTop === 6096, '12b-1: fixture — the thread opens pinned to the newest message (sT 6096 of 6670, cH 574)');
    keyboardUp(thread);
    assert('keyboardUp' in doc.body.dataset, '12b-2a: fixture — the REAL bindKeyboardAvoid() set body[data-keyboard-up] on focus + a 300px visualViewport drop');
    assert(pinned(thread), `12b-2: keyboard UP — the thread is still pinned to the newest message (sT ${thread.scrollTop}, cH ${thread.clientHeight}, sH ${thread.scrollHeight})`);
    keyboardDown(thread);
    assert(!('keyboardUp' in doc.body.dataset), '12b-3a: fixture — blur cleared body[data-keyboard-up] (the nav comes back)');
    assert(pinned(thread), `12b-3: keyboard DOWN — the thread is STILL pinned to the newest message, not left 60px short (sT ${thread.scrollTop}, cH ${thread.clientHeight}, sH ${thread.scrollHeight})`);
    // Several cycles in a row (type, dismiss, re-tap) never drift.
    for (let i = 0; i < 3; i++) { keyboardUp(thread); keyboardDown(thread); }
    assert(pinned(thread), '12b-4: three more keyboard up/down cycles — still pinned (no cumulative drift)');
  }

  // 12b-5 — a deliberate scroll-up is preserved: a player reading history
  // who taps the composer is not yanked to the bottom by the layout change.
  {
    const thread = makeThread({ scrollHeight: 6670, clientHeight: 574 });
    thread.scrollTop = thread.scrollHeight;
    if (typeof bindBottomAnchor === 'function') bindBottomAnchor(thread);
    thread.scrollTop = 2000;                      // the player scrolls up to read
    keyboardUp(thread);
    assert(thread.scrollTop === 2000, `12b-5a: scrolled up to read history, keyboard UP leaves the position alone (sT ${thread.scrollTop})`);
    keyboardDown(thread);
    assert(thread.scrollTop === 2000, `12b-5b: …and keyboard DOWN leaves it alone too (sT ${thread.scrollTop})`);
  }

  // 12b-6/7 — binder hygiene, same shape as bindBottomBounce()/bindWeekSwipe().
  if (typeof bindBottomAnchor === 'function') {
    const thread = makeThread({ scrollHeight: 6670, clientHeight: 574 });
    thread.scrollTop = thread.scrollHeight;
    const u1 = bindBottomAnchor(thread);
    const u2 = bindBottomAnchor(thread);
    assert(u1 === u2 && thread._count('scroll') === 1,
      '12b-6: binding the SAME thread twice returns the SAME unbind and attaches one scroll listener (WeakMap idempotency)');
    u1();
    assert(thread._count('scroll') === 0, '12b-7a: unbind removes the scroll listener');
    keyboardUp(thread); keyboardDown(thread);
    assert(!pinned(thread), '12b-7b: …and after unbind the anchor no longer acts (control: the unanchored thread IS left short — the WebKit drift this binder closes)');
    const u3 = bindBottomAnchor(thread);
    assert(u3 !== u1, '12b-7c: a fresh bind after unbind is a NEW binding (the WeakMap entry was cleared)');
    u3();
  } else {
    assert(false, '12b-6/7: binder hygiene — skipped, bindBottomAnchor() does not exist');
  }

  // 12b-8 — no ResizeObserver (very old engine): a safe no-op, never throws.
  {
    globalThis.ResizeObserver = undefined;
    let threw = false, unbind = null;
    try { unbind = typeof bindBottomAnchor === 'function' ? bindBottomAnchor(makeThread({ scrollHeight: 100, clientHeight: 50 })) : null; } catch { threw = true; }
    assert(!threw && typeof unbind === 'function', '12b-8: without ResizeObserver bindBottomAnchor() is a no-op returning an unbind, never a throw');
    globalThis.ResizeObserver = FakeResizeObserver;
  }

  unbindKbd();

  // 12c — wiring: renderChatPage() anchors the page thread it just rendered
  // (comment-stripped source, same technique as 11n-real-6).
  {
    const chatSrc = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const start = chatSrc.indexOf('export function renderChatPage(');
    const end = chatSrc.indexOf('\nfunction renderPillsOnly(', start);
    const body = start >= 0 && end > start ? chatSrc.slice(start, end) : '';
    assert(body.length > 0, '12c-0: fixture — renderChatPage() located in js/chat-ui.js');
    assert(/import\s*\{[^}]*\bbindBottomAnchor\b[^}]*\}\s*from\s*'\.\/nav-gestures\.js'/.test(chatSrc),
      '12c-1: chat-ui.js imports bindBottomAnchor from ./nav-gestures.js');
    assert(/bindBottomAnchor\(\s*scroll\s*\)/.test(body),
      '12c-2: renderChatPage() binds the anchor to the #chat-scroll it just rendered');
  }
  // 12d — ONE "at the latest" band (reviewer note on fbfab2a): the "↓ latest"
  // button (chat-ui.js onChatScrollEvent) and the stick-to-bottom anchor
  // (bindBottomAnchor) must read the SAME constant, or a reader could sit
  // where the button says "you're at the latest" but the anchor lets the
  // thread drift (or the reverse).
  {
    const CU = await import('./js/chat-ui.js');
    const band = NG.BOTTOM_ANCHOR_PX;
    assert(typeof band === 'number' && band > 0, `12d-0: fixture — nav-gestures.js exports BOTTOM_ANCHOR_PX (got ${band})`);
    // Behavioural: the real onChatScrollEvent flips the button exactly at the band edge.
    const jumpAt = (dist) => {
      const jumpEl = { style: { display: '' } };
      CU._onChatScrollEvent({ scrollHeight: 5000, clientHeight: 500, scrollTop: 5000 - 500 - dist }, jumpEl);
      return jumpEl.style.display;
    };
    assert(jumpAt(band - 1) === 'none' && jumpAt(band) === 'block',
      `12d-1: the "↓ latest" button hides at ${band - 1}px from the bottom and shows at ${band}px — the SAME edge as the anchor band (got ${jumpAt(band - 1)}/${jumpAt(band)})`);
    // Source: the band is imported, not re-typed as a literal.
    const src = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const fnStart = src.indexOf('function onChatScrollEvent(');
    const fnBody = fnStart >= 0 ? src.slice(fnStart, src.indexOf('\n}', fnStart)) : '';
    assert(/import\s*\{[^}]*\bBOTTOM_ANCHOR_PX\b[^}]*\}\s*from\s*'\.\/nav-gestures\.js'/.test(src),
      '12d-2: chat-ui.js imports BOTTOM_ANCHOR_PX from ./nav-gestures.js');
    assert(fnBody.length > 0 && /<\s*BOTTOM_ANCHOR_PX\b/.test(fnBody) && !/\b120\b/.test(fnBody),
      '12d-3: onChatScrollEvent() compares against BOTTOM_ANCHOR_PX, with no hard-coded 120 left in it');
  }

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
  globalThis.ResizeObserver = savedRO;
}

// ═══════════════════════════════════════
console.log('\n[13] PILL TAB BAR — CSS PINS (coordinator CSS pass, DI-397 pill / DI-393 header)…');
// ═════════════════════════════════════════════════════════════════════════
// DI-397 (UN-357, 2026-09-27) — `.bottom-nav` is a floating, inset pill now,
// not a full-bleed bar. Same discipline as headermetatest.mjs's own [css]/
// [css2] blocks: a text-level pin on the shipped CSS, not a rendered-layout
// assertion (the actual pixel result — backdrop-filter rendering, safe-area
// behaviour in a real PWA/Capacitor shell — is a device-verify, named in the
// handoff, not claimed here). Comments are STRIPPED before every check below
// (contrastscan.mjs's own discipline) so a historical comment that quotes
// the old `--nav-height` token by name, for context, cannot be mistaken for
// a live consumer of it.
{
  const { readFileSync } = await import('node:fs');
  const rawCss = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

  // [13a] the compound clearance token — one formula, built from the pill's
  // own three named parts, not a re-typed literal anywhere else.
  const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
  assert(!!rootMatch, '12a-0: found a base :root{...} rule');
  const rootBody = rootMatch ? rootMatch[1] : '';
  assert(/--nav-pill-h:\s*48px/.test(rootBody), '12a-1: --nav-pill-h is 48px');
  assert(/--nav-pill-gap:\s*8px/.test(rootBody), '12a-2: --nav-pill-gap is 8px (the bottom offset)');
  assert(/--nav-pill-inset:\s*12px/.test(rootBody), '12a-3: --nav-pill-inset is 12px (the side inset)');
  assert(/--nav-pill-radius:\s*24px/.test(rootBody), '12a-4: --nav-pill-radius is 24px (half the height — a true pill)');
  // RE-DERIVED (Home wiring, 2026-10-01; DESIGN_NEEDS_HOME Amendment 3 + 3.1, Drew: 56 pt disc, "I don't want pages to leave more room at the bottom"): the clearance is the pill's height plus
  // its OWN bottom offset (--nav-pill-bottom = the shipped gap + safe-area inset, floored so the disc's collar keeps 8px from the screen edge). It carries NO disc term: the disc does not
  // grow the room pages leave (DQ-2). On any device with a bottom inset >= 8 it is value for value the shipped 48 + 8 + inset (a numeric proof follows, 12a-8).
  assert(/--nav-bar-clearance:\s*calc\(var\(--nav-pill-h\)\s*\+\s*var\(--nav-pill-bottom\)\)/.test(rootBody),
    '12a-5: --nav-bar-clearance = pill height + --nav-pill-bottom (the pill\'s own bottom offset), computed once, with NO disc term');
  assert(/--nav-disc-d:\s*56px/.test(rootBody) && /--nav-disc-cut:\s*3px/.test(rootBody) && /--nav-disc-ring:\s*4px/.test(rootBody),
    '12a-6: the Home disc is ONE size token, --nav-disc-d:56px (Drew, Amendment 3.1), with a 3px cut-out and a 4px collar ring');
  assert(/--nav-disc-overhang:\s*calc\(\(var\(--nav-disc-d\)\s*-\s*var\(--nav-pill-h\)\)\s*\/\s*2\)/.test(rootBody) && /--nav-disc-reach:\s*calc\(var\(--nav-disc-overhang\)\s*\+\s*var\(--nav-disc-ring\)\)/.test(rootBody),
    '12a-7: the overhang is (disc - pill) / 2 (equal above and below, by construction) and the reach is overhang + ring: both derived from the one size token');
  assert(/--nav-pill-bottom:\s*max\(calc\(var\(--nav-pill-gap\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\),\s*calc\(var\(--nav-disc-reach\)\s*\+\s*8px\)\)/.test(rootBody),
    '12a-7b: --nav-pill-bottom = max(shipped gap + safe-area inset, reach + 8px): the floor keeps the collar 8px from the screen edge where there is no inset');
  {
    // 12a-8 numeric proof of Drew's ruling, from the SAME formulas: with a Face ID inset (34) the clearance is the shipped 90, at 21 (landscape) the shipped 77, and only at inset 0 does the
    // floor lift the pill (8 -> 16), in which case the clearance follows it so the pill never covers the chat composer or the submit bar.
    const D = 56, H = 48, GAP = 8, RING = 4, reach = (D - H) / 2 + RING;
    const bottom = (inset) => Math.max(GAP + inset, reach + 8);
    const clearance = (inset) => H + bottom(inset);
    const shipped = (inset) => H + GAP + inset;
    assert(reach === 8 && [34, 21, 8].every((i) => clearance(i) === shipped(i)),
      '12a-8: at every bottom inset >= 8 (Face ID portrait 34, landscape 21) the clearance equals the shipped 48 + 8 + inset: pages leave NO more room at the bottom (Drew, 2026-10-01)');
    assert(bottom(0) === 16 && clearance(0) === 64 && (bottom(0) - reach) >= 8,
      '12a-8b: with no inset the floor lifts the pill 8 -> 16 so the collar keeps 8px from the screen edge, and the clearance follows the pill (64), the one deviation, recorded');
  }

  // [13b] MUTATION-PROVEN completeness grep (per the reviewer's own
  // instruction — not just "present," proven to actually discriminate): the
  // old token is genuinely retired everywhere OUTSIDE prose. A regression
  // that reintroduces even ONE live `var(--nav-height)` consumer must turn
  // this red; a fixture proves the check can still see one.
  assert(!/--nav-height/.test(css),
    '12b-1: --nav-height does not appear anywhere in styles.css OUTSIDE comments — every real consumer repointed to --nav-bar-clearance, none left reading the retired token');
  const fixtureWithOldToken = css + '\n.probe{height:var(--nav-height)}';
  assert(/--nav-height/.test(fixtureWithOldToken),
    '12b-2: fixture — the same check DOES flag a reintroduced --nav-height consumer (anti-vacuity: a guard that cannot detect its own removal is not coverage, RG-27\'s own precedent)');

  // [13c] every real consumer reads the ONE new token — enumerated, not
  // assumed (CONVENTIONS #21 discipline: one token, every consumer, no drift).
  const consumerChecks = [
    [/\.main-content\{[^}]*padding:[^;}]*calc\(var\(--nav-bar-clearance\)\s*\+\s*20px\)/, '.main-content padding (shorthand, bottom value)'],
    // RE-DERIVED (Home wiring, 2026-10-01): a FIXED bar gets the disc-specific nudge Amendment 3.1 allows (page padding does NOT change): + the collar's reach, so the bar's bottom border never touches the collar.
    [/\.submit-bar\{[^}]*bottom:\s*calc\(var\(--nav-bar-clearance\)\s*\+\s*8px\s*\+\s*var\(--nav-disc-reach\)\)/, '.submit-bar bottom (+ the disc collar\'s reach)'],
    // RE-DERIVED (Home wiring review N2, 2026-10-02): the two fixed banners clear the Home disc's collar (reach + 8px), a fixed-bar nudge like the submit bar's; page padding is unchanged.
    [/#auth-banner-stack\{[^}]*bottom:\s*calc\(var\(--nav-bar-clearance\)\s*\+\s*var\(--nav-disc-reach\)\s*\+\s*8px\)/, '#auth-banner-stack bottom (+ the disc collar\'s reach + 8px)'],
    [/\.update-available-banner\{[^}]*bottom:\s*calc\(var\(--nav-bar-clearance\)\s*\+\s*var\(--nav-disc-reach\)\s*\+\s*8px\)/, '.update-available-banner bottom (+ the disc collar\'s reach + 8px)'],
    [/#page-chat\.active\{[^}]*height:\s*calc\(100dvh - var\(--nav-bar-clearance\)\)/, '#page-chat.active height (100dvh)'],
    [/@supports not \(height:100dvh\)\{#page-chat\.active\{height:calc\(100vh - var\(--nav-bar-clearance\)\)\}\}/, '#page-chat.active height (100vh fallback)'],
    // DI-442 (2026-09-29): `.chat-jump-latest` is NOT a consumer any more, on purpose.
    // #page-chat.active already subtracts the clearance from its own height, so the
    // term was a double count (it floated the button 56px above the composer with the
    // keyboard down). Its offset is now the composer + 8px, pinned in [13c-jump].
  ];
  for (const [re, label] of consumerChecks) {
    assert(re.test(css), `12c: ${label} reads var(--nav-bar-clearance)`);
  }
  // [13c-jump] DI-442 (UN-385): the ↓ latest button's sticky offset is the measured composer
  // + its 8px margin-bottom (Chromium resolves sticky insets against #page-chat's CONTENT
  // box, so the page's own padding-bottom lift is NOT added) — and carries NO
  // --nav-bar-clearance term (the clearance is already subtracted from #page-chat's height).
  assert(/#page-chat \.chat-jump-latest\{bottom:calc\(var\(--chat-composer-h,90px\)\s*\+\s*8px\);margin-bottom:8px/.test(css),
    '12c-jump: .chat-jump-latest bottom = var(--chat-composer-h,90px) + 8px, with margin-bottom:8px');
  const jumpRule = (css.match(/#page-chat \.chat-jump-latest\{[^}]*\}/) || [''])[0];
  assert(jumpRule !== '' && !/--nav-bar-clearance/.test(jumpRule),
    '12c-jump-b: the ↓ latest rule reads no --nav-bar-clearance (a second subtraction of the clearance #page-chat already took)');
  // RE-DERIVED (Home wiring, 2026-10-02, Drew M-11 Q2 "lift"): keyboard DOWN the lift is 8px + the Home disc collar's reach (the composer clears the collar by 8px); keyboard UP it is 8px again.
  const chatGapRe = /#page-chat\.active\{--chat-nav-gap:calc\(8px \+ var\(--nav-disc-reach\)\);[^}]*padding-bottom:var\(--chat-nav-gap\)/;
  assert(chatGapRe.test(css),
    '12c-gap: #page-chat.active declares --chat-nav-gap:calc(8px + var(--nav-disc-reach)) and uses it as its padding-bottom (the lift off the tab bar and the disc\'s collar, keyboard down)');
  assert(!chatGapRe.test(css.replace('--chat-nav-gap:calc(8px + var(--nav-disc-reach));', '--chat-nav-gap:8px;')),
    '12c-gap-m: MUTATION — the bare 8px lift (the composer 0px from the collar) turns 12c-gap RED');
  const kbGapRe = /body\[data-keyboard-up\] #page-chat\.active\{--nav-bar-clearance:0px;--chat-nav-gap:8px\}/;
  assert(kbGapRe.test(css) && !kbGapRe.test(css.replace(';--chat-nav-gap:8px}', '}')),
    '12c-gap-kb: with the keyboard up the gap is 8px again (the nav is hidden, there is no collar above the keyboard); MUTATION — dropping that override (a 16px gap above the keyboard) turns it RED');

  // [13d] the keyboard-up reset zeroes the COMPOUND token directly, as a
  // <length> (0px), not a unitless 0 — the exact defect class (a bare `0`
  // substituted into calc() is a <number>, not a <length>, so the whole
  // calc() goes invalid at computed-value time) the 2026-09-27 coordinator
  // fix closed under the OLD token name; this must never regress under the
  // new one either.
  assert(/body\[data-keyboard-up\] #page-chat\.active\{--nav-bar-clearance:0px;--chat-nav-gap:8px\}/.test(css),
    '12d: body[data-keyboard-up] #page-chat.active zeroes --nav-bar-clearance (0px, a <length>, not unitless 0)');

  // [13e] the pill itself — inset OUTSIDE the box (position, not padding),
  // fully rounded, 48px content-only height.
  const pillMatch = css.match(/\.bottom-nav\{([^}]*)\}/);
  assert(!!pillMatch, '12e-0: found the base .bottom-nav{...} rule');
  const pillBody = pillMatch ? pillMatch[1] : '';
  assert(/left:\s*var\(--nav-pill-inset\)/.test(pillBody) && /right:\s*var\(--nav-pill-inset\)/.test(pillBody),
    '12e-1: .bottom-nav is inset var(--nav-pill-inset) from BOTH edges — a floating pill, not full-bleed');
  assert(/bottom:\s*var\(--nav-pill-bottom\)/.test(pillBody) && !/bottom:\s*calc\(var\(--nav-pill-gap\)/.test(pillBody),
    '12e-2: .bottom-nav\'s bottom offset lives in its POSITION (var(--nav-pill-bottom) = gap + safe-area, floored for the disc), not padded into its own box height');
  assert(/height:\s*var\(--nav-pill-h\)/.test(pillBody), '12e-3: .bottom-nav height is var(--nav-pill-h) — content-only, no more padding-plus-height double count');
  assert(/border-radius:\s*var\(--nav-pill-radius\)/.test(pillBody), '12e-4: .bottom-nav border-radius is var(--nav-pill-radius) — a true capsule');
  // RE-DERIVED (SP-52 DI-454, 2026-10-01): the hairline reads the chrome token with --border as its fallback — var(--chrome-tab-border, var(--border)) — because Ink Light's
  // bar is black and the Dark surfaces' bar is a lifted brown; every other look has no --chrome-tab-border and falls back to the ordinary --border (R2). Still from tokens, never a literal.
  assert(/border:\s*1px solid var\(--chrome-tab-border,\s*var\(--border\)\)/.test(pillBody), '12e-5: .bottom-nav carries a hairline border from tokens (var(--chrome-tab-border, var(--border))), not a hardcoded color');

  // [13f] the material — a resolvable, SCANNABLE solid base (contrastscan.mjs
  // can only assert on a rule with a resolvable background; an rgba()
  // literal is skipped by design, per its own doc comment) with the
  // translucent/backdrop-filter enhancement layered on TOP via a POSITIVE
  // @supports feature query, never baked into the base — this is what makes
  // "contrastscan stays green... material fallback included" true by
  // construction, rather than an untested claim.
  // RE-DERIVED (SP-52 DI-454): the solid base is var(--chrome-tab-bg) — still a SOLID, RESOLVABLE token (contrastscan.mjs can read it), per look: white on Munera/Paper/Graphite Light,
  // Ink on Ink Light, #2B2520 on the Dark surfaces, #1C1C1E on Graphite Dark. It equals --bg-card on every look that had a white bar, so the Munera pairing is unchanged.
  assert(/background:\s*var\(--chrome-tab-bg\)/.test(pillBody),
    '12f-1: .bottom-nav base background is var(--chrome-tab-bg) — solid, resolvable, per look (it was var(--bg-card); equal on Munera Light)');
  const supportsMatch = rawCss.match(/@supports\s*\(\(backdrop-filter:blur\(1px\)\)\s*or\s*\(-webkit-backdrop-filter:blur\(1px\)\)\)\{[\s\S]*?\n\}/);
  assert(!!supportsMatch, '12f-2: found the positive @supports(backdrop-filter) enhancement block');
  const supportsBody = supportsMatch ? supportsMatch[0] : '';
  // Reviewer BLOCK (round 2, 2026-09-27) — was a HARDCODED
  // `rgba(255,255,255,.72)`, unconditionally, in BOTH color schemes: a light
  // glass on the dark app in dark mode, measured 1.9:1/1.6:1 for the icons
  // painted on it. Now a TOKEN, `var(--nav-material)`, so it can flip per
  // mode — [13i] below pins the token's own light/dark values.
  assert(/background:\s*var\(--nav-material\)/.test(supportsBody),
    '12f-3: inside @supports, .bottom-nav reads var(--nav-material) — a mode-aware token, not a hardcoded literal that was the same colour in both colour schemes');
  assert(!/background:\s*rgba\(255,255,255,\.72\)/.test(supportsBody),
    '12f-3b: the old hardcoded rgba(255,255,255,.72) literal is genuinely gone from this rule, not left as a second declaration alongside the token');
  assert(/-webkit-backdrop-filter:\s*blur\(20px\) saturate\(180%\)/.test(supportsBody) && /(?<!-webkit-)backdrop-filter:\s*blur\(20px\) saturate\(180%\)/.test(supportsBody),
    '12f-4: …with both prefixed and unprefixed backdrop-filter: blur(20px) saturate(180%)');

  // [13i] Reviewer BLOCK (round 2, 2026-09-27) — --nav-material itself: a
  // light value + BOTH dark blocks carrying the byte-identical dark value
  // (same "keep the two dark blocks in sync" discipline every other
  // dark-mode token pair in this file already follows).
  const rootMatch2 = css.match(/:root\s*\{([^}]*)\}/);
  assert(!!rootMatch2 && /--nav-material:\s*rgba\(255,255,255,\.72\)/.test(rootMatch2[1]),
    '12i-1: :root --nav-material is the light rgba(255,255,255,.72) glass');
  // RE-DERIVED (SP-52 DI-448 Table 1, 2026-10-01). The Dark glass is now the LIFTED tab-bar colour at the same .72 alpha — rgba(43,37,32,.72) (--chrome-tab-bg #2B2520; it was
  // --bg-card's old dark hex rgba(31,27,23,.72)) — and it is declared ONCE per trigger in the shared Dark-surface Block A (an enumerated selector list), not in a one-theme block.
  // Read through the REAL cascade (themeresolve.mjs) so every look and BOTH triggers are checked, plus the two per-look alphas the DI sets (J3: Paper Dark .92 and Ink Light .88,
  // the translucent bar composites over light cards there) and Graphite Dark's own #1C1C1E glass.
  const TR = await import('./themeresolve.mjs');
  const navSheet = TR.parseSheet(rawCss);
  const navMat = (key, side, trig) => TR.resolveSide(navSheet, key, side, trig).get('--nav-material');
  const blockA = (manual) => navSheet.rules.find((r) => (manual ? (r.media === null && r.selectorText.includes('[data-color-scheme="dark"]')) : (r.media === 'dark' && r.selectorText.includes(':not([data-color-scheme="light"])')))
    && (r.selectorText.match(/body\.theme-/g) || []).length === 8);
  const aMedia = blockA(false), aManual = blockA(true);
  assert(!!aMedia && aMedia.decls.some((d) => d.prop === '--nav-material' && d.value === 'rgba(43,37,32,.72)'),
    '12i-2: the prefers-color-scheme:dark Block A sets --nav-material to rgba(43,37,32,.72) (--chrome-tab-bg\'s own dark hex at the same .72 alpha)');
  assert(!!aManual && aManual.decls.some((d) => d.prop === '--nav-material' && d.value === 'rgba(43,37,32,.72)') && aMedia.decls.map((d) => d.prop + ':' + d.value).join(';') === aManual.decls.map((d) => d.prop + ':' + d.value).join(';'),
    '12i-3: the manual [data-color-scheme="dark"] Block A carries the BYTE-IDENTICAL value (and declaration set) — the two dark blocks cannot drift apart');
  assert(['neutral', 'ink', 'aggie', 'sooner', 'trojan', 'irish', 'boilermaker', 'razorback'].every((k) => navMat(k, 'D', 'system') === 'rgba(43,37,32,.72)' && navMat(k, 'D', 'pinned') === 'rgba(43,37,32,.72)'),
    '12i-4: every Munera-surface look resolves the Dark glass to rgba(43,37,32,.72) under BOTH triggers');
  assert(navMat('paper', 'D', 'system') === 'rgba(43,37,32,.92)' && navMat('paper', 'D', 'pinned') === 'rgba(43,37,32,.92)' && navMat('ink', 'L', 'system') === 'rgba(20,17,14,.88)'
    && navMat('graphite', 'D', 'system') === 'rgba(28,28,30,.72)' && navMat('graphite', 'L', 'system') === 'rgba(255,255,255,.72)' && navMat('neutral', 'L', 'system') === 'rgba(255,255,255,.72)',
    '12i-5: Paper Dark (.92) and Ink Light (.88) carry the more opaque glass the DI sets (J3); Graphite Dark its own #1C1C1E glass; Munera Light is the unchanged white .72');

  // [13j] Reviewer BLOCK (round 2, 2026-09-27) — a system "reduce
  // transparency" preference drops the glass material back to the same
  // solid, already-proven `--bg-card` the base rule already ships as its
  // no-backdrop-filter fallback — one fallback shape, not two.
  const reduceTranspMatch = css.match(/@media \(prefers-reduced-transparency:reduce\)\{\s*\.bottom-nav\{([^}]*)\}/);
  assert(!!reduceTranspMatch, '12j-1: found @media(prefers-reduced-transparency:reduce){.bottom-nav{...}}');
  // RE-DERIVED (SP-52 DI-454): the solid fallback is var(--chrome-tab-bg) — the SAME token the base rule reads (one fallback shape, now per look).
  assert(!!reduceTranspMatch && /background:\s*var\(--chrome-tab-bg\)/.test(reduceTranspMatch[1]) && /backdrop-filter:\s*none/.test(reduceTranspMatch[1]) && /-webkit-backdrop-filter:\s*none/.test(reduceTranspMatch[1]),
    `12j-2: prefers-reduced-transparency:reduce sets background:var(--chrome-tab-bg);backdrop-filter:none;-webkit-backdrop-filter:none (got "${reduceTranspMatch?.[1]}")`);

  // [13g] hide/show — the SAME binary slide (T-24, 240ms), but the translate
  // distance now clears the pill's OWN bottom offset too. MUTATION-PROVEN:
  // a regression back to the bare `translateY(100%)` this DI's own task
  // brief named as the exact bug (a --nav-pill-gap-tall sliver left on
  // screen) must turn this red, not silently keep matching a loose pattern.
  const hiddenMatch = css.match(/\.bottom-nav\.nav-hidden\{([^}]*)\}/);
  // RE-DERIVED (Home wiring, 2026-10-01): the distance is the pill's height + its bottom offset + the DISC COLLAR's reach, because the disc overhangs the pill's top edge and a distance that
  // stops at the pill leaves the collar's top 8px on screen: DI-397's own sliver bug a third time.
  const fullOffsetTransform = /transform:\s*translateY\(calc\(100%\s*\+\s*var\(--nav-pill-bottom\)\s*\+\s*var\(--nav-disc-reach\)\)\)/;
  assert(!!hiddenMatch && fullOffsetTransform.test(hiddenMatch[1]),
    '12g-1: .bottom-nav.nav-hidden translates the FULL offset (100% + --nav-pill-bottom + --nav-disc-reach) — fully off-screen, no pill and no collar sliver left showing');
  const mutatedHidden = '.bottom-nav.nav-hidden{transform:translateY(100%);transition:transform 240ms ease-in}';
  assert(!fullOffsetTransform.test(mutatedHidden),
    '12g-2 mutation proof: the SAME regex correctly goes RED against the old bare translateY(100%) — the exact sliver-leaving bug this DI closes, not a pattern loose enough to still match it');
  const mutatedShipped = '.bottom-nav.nav-hidden{transform:translateY(calc(100% + var(--nav-pill-gap) + env(safe-area-inset-bottom,0px)));transition:transform 240ms ease-in}';
  const mutatedNoReach = '.bottom-nav.nav-hidden{transform:translateY(calc(100% + var(--nav-pill-bottom)));transition:transform 240ms ease-in}';
  assert(!fullOffsetTransform.test(mutatedShipped) && !fullOffsetTransform.test(mutatedNoReach),
    '12g-2b mutation proof: the regex ALSO goes RED against the shipped (gap + safe-area) distance and against a distance that drops the disc reach: the collar sliver cannot return unseen');
  const kbHiddenMatch = css.match(/body\[data-keyboard-up\] \.bottom-nav\{([^}]*)\}/);
  assert(!!kbHiddenMatch && fullOffsetTransform.test(kbHiddenMatch[1]),
    '12g-3: the keyboard-up hide uses the SAME full-offset transform (pill offset + disc reach), not the old bare 100%');

  // [13k] Reviewer BLOCK (round 2, 2026-09-27) — .nav-unread's clip fix.
  // .bottom-nav no longer declares its own overflow at all (border-radius
  // clips the box's OWN background/border regardless of overflow; nothing
  // else in this pill needs descendant clipping — .nav-item's own
  // background is `none`) — the pill's base rule is re-matched here (same
  // pattern as [13e]) and asserted NOT to carry overflow:hidden, which used
  // to clip 2px off .nav-unread's -3px top offset.
  assert(!!pillMatch && !/overflow:\s*hidden/.test(pillBody),
    `12k: .bottom-nav no longer declares overflow:hidden — .nav-unread's -3px top offset (below) is no longer clipped by the pill's own box (got "${pillBody}")`);
  const navUnreadMatch = css.match(/\.nav-unread\{([^}]*)\}/);
  assert(!!navUnreadMatch && /top:\s*-3px/.test(navUnreadMatch[1]),
    `12k-2: .nav-unread still sits 3px proud of the pill's own top edge (top:-3px) — only safe to leave un-clipped now that [13k] holds (got "${navUnreadMatch?.[1]}")`);

  // [13l] Reviewer BLOCK (round 2, 2026-09-27) — the selected tab's
  // non-colour cue: a 4px dot under the active icon, scoped to `.active`
  // ONLY (never the shared `:active` touch-press state every tab gets on
  // tap — a dot flashing on every press regardless of selection would be a
  // worse signal than the colour-only one it replaces). Mutation-proven:
  // the selector-scoping itself is what a regression would most likely get
  // wrong (accidentally widening it to `.nav-item.active,.nav-item:active`,
  // matching the sibling colour rule immediately above it in the file).
  const activeDotMatch = css.match(/\.nav-item\.active::after\{([^}]*)\}/);
  assert(!!activeDotMatch, '12l-1: found .nav-item.active::after{...} — the active-tab dot');
  assert(!!activeDotMatch && /width:\s*4px/.test(activeDotMatch[1]) && /height:\s*4px/.test(activeDotMatch[1]) && /border-radius:\s*50%/.test(activeDotMatch[1]),
    `12l-2: the dot is 4x4px, fully rounded (got "${activeDotMatch?.[1]}")`);
  // RE-DERIVED (SP-52 DI-454): the colour cue and the dot read ONE token, --chrome-tab-icon-selected (the selected-tab colour per look: crimson on white, gold on Ink Light, a lifted
  // red on the Dark surfaces, near-white on Graphite Dark). The assertion's intent — dot and colour are the SAME token, never a one-off — is kept and now checked against the colour rule.
  const activeColourMatch = css.match(/\.nav-item\.active,\.nav-item:active\{([^}]*)\}/);
  assert(!!activeDotMatch && /background:\s*var\(--chrome-tab-icon-selected\)/.test(activeDotMatch[1]) && !!activeColourMatch && /color:\s*var\(--chrome-tab-icon-selected\)/.test(activeColourMatch[1]),
    '12l-3: the dot reads var(--chrome-tab-icon-selected) — the SAME token the colour cue (.nav-item.active) reads, not a new one-off value');
  // The selector as WRITTEN in the file must be exactly `.nav-item.active::after`
  // — not a comma-joined rule that also matches `.nav-item:active` (the
  // regression this mutation proof targets).
  const activeDotSelectorLine = (css.match(/^\.nav-item\.active::after\{[^}]*\}$/m) || [])[0];
  assert(!!activeDotSelectorLine,
    '12l-4: the dot rule\'s selector is EXACTLY .nav-item.active::after on its own — not comma-joined with .nav-item:active (a regression that would flash the dot on every tab\'s touch-press, not just the selected one)');

  // [13m] Reviewer BLOCK (round 2, 2026-09-27) — the stale
  // `.nav-item span:last-child{font-size:.58rem}` rule (used to size the
  // OLD visible label span) is genuinely removed, not left as dead CSS now
  // hitting `.sr-only` (a visually-hidden element a font-size can't affect,
  // but which reads as a maintained, meaningful rule to the next editor).
  assert(!/\.nav-item span:last-child/.test(css),
    '12m: .nav-item span:last-child{font-size:.58rem} is gone from the file — it used to size the now-.sr-only label span, a dead declaration on an invisible element');
}

// ═════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
console.log('\n[14] SP-57 (2026-10-01, DI-476) — the section drag is a third owner of the one-touch claim model: constants, the repaint-deferral door, releaseTouchAndFlush, the pull-to-refresh and bounce claim checks, and the layout bar\'s gesture suspension…');
// ══════════════════════════════════════════════════════════════════
{
  const { SECTION_LONG_PRESS_MS, LONG_PRESS_MS, SECTION_DRAG_TOUCH_OWNER, DRAWER_TOUCH_OWNER, deferRenderWhileWeekSwiping,
    releaseTouchAndFlush, claimTouch, releaseTouch, touchClaimedBy, clearStaleTouchClaim, _deferredRenderCount } = NG;
  const savedDoc14 = globalThis.document, savedWin14 = globalThis.window;
  const flushAll = () => { releaseTouch('week-swipe'); releaseTouch(DRAWER_TOUCH_OWNER); releaseTouch(SECTION_DRAG_TOUCH_OWNER); releaseTouch('column-reorder'); };

  // 14a — constants (AT5, the export half): the section hold is Drew's 500, pinned APART from the 350 group.
  assert(SECTION_LONG_PRESS_MS === 500 && LONG_PRESS_MS === 350 && SECTION_LONG_PRESS_MS !== LONG_PRESS_MS && SECTION_DRAG_TOUCH_OWNER === 'section-drag',
    '14a: SECTION_LONG_PRESS_MS is 500 ("the 500s"), the exported LONG_PRESS_MS copy is the 350 pill / column / chat hold, the two differ, and the claim name is "section-drag"');
  {
    const { readFileSync } = await import('node:fs');
    const lp = (text) => [...text.matchAll(/const LONG_PRESS_MS = (\d+);/g)].map((m) => Number(m[1]));
    const appLp = lp(readFileSync(new URL('./js/app.js', import.meta.url), 'utf8'));
    const chatLp = lp(readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8'));
    assert(appLp.length === 1 && chatLp.length === 1 && appLp[0] === LONG_PRESS_MS && chatLp[0] === LONG_PRESS_MS,
      `14a-2: AT5 — the THREE copies of the 350 group agree (app.js ${JSON.stringify(appLp)}, chat-ui.js ${JSON.stringify(chatLp)}, nav-gestures.js ${LONG_PRESS_MS}); the pill path was not edited`);
    const sd = readFileSync(new URL('./js/section-drag.js', import.meta.url), 'utf8');
    assert(/export const SECTION_LONG_PRESS_MS = NG\.SECTION_LONG_PRESS_MS;/.test(sd) && /export const SECTION_DRAG_TOUCH_OWNER = NG\.SECTION_DRAG_TOUCH_OWNER;/.test(sd),
      '14a-3: js/section-drag.js re-exports both from nav-gestures.js — one source, so the engine and the deferral set can never name different owners');
  }

  // 14b — the deferral door honours the section drag, and ONLY the three recognisers that follow the finger across a page.
  {
    flushAll();
    let painted = 0;
    const paint = () => { painted++; };
    assert(deferRenderWhileWeekSwiping('leaderboard', paint) === false && _deferredRenderCount() === 0, '14b-0: with no claim held a repaint runs now (returns false, nothing parked) — eptest / layouttest / grouptest call renderLeaderboard() directly');
    claimTouch(SECTION_DRAG_TOUCH_OWNER);
    assert(deferRenderWhileWeekSwiping('leaderboard', paint) === true && deferRenderWhileWeekSwiping('leaderboard', paint) === true && _deferredRenderCount() === 1,
      '14b: while "section-drag" owns the touch a repaint PARKS (and a burst of ticks collapses to one, latest wins, per page key) — the lifted section is never replaced under the finger');
    releaseTouchAndFlush(SECTION_DRAG_TOUCH_OWNER);
    assert(painted === 1 && _deferredRenderCount() === 0 && touchClaimedBy() === null,
      `14c: releaseTouchAndFlush("section-drag") releases the claim AND runs the parked repaint immediately, exactly once (painted ${painted})`);
    // The pill path is unchanged: 'column-reorder' still does NOT park (C4 / UN-D6: its path is byte-for-byte what it was).
    claimTouch('column-reorder');
    assert(deferRenderWhileWeekSwiping('dashboard', paint) === false && _deferredRenderCount() === 0,
      '14d: a pill drag ("column-reorder") still does NOT park a repaint — the deferral set gained exactly one owner, not "every claim"');
    releaseTouch('column-reorder');
    claimTouch('week-swipe');
    assert(deferRenderWhileWeekSwiping('dashboard', paint) === true, '14e: the week swipe (SB-15 / RG-TBD-A1) still parks — unchanged');
    releaseTouchAndFlush('week-swipe'); painted = 0;
    claimTouch(DRAWER_TOUCH_OWNER);
    assert(deferRenderWhileWeekSwiping('dashboard', paint) === true, '14f: the control-center drag (SB-15) still parks — unchanged');
    releaseTouchAndFlush(DRAWER_TOUCH_OWNER);
    assert(touchClaimedBy() === null, '14f-2: …and its release still hands the touch back');
  }

  // 14g — the LOAD-BEARING owner guard on releaseTouchAndFlush: the drawer's settle() calls it on EVERY touchend, including the
  // one that begins the section drag's 260 ms settle while section-drag still owns the touch. Unguarded it would run the section
  // drag's parked repaint mid-settle and replace the nodes it is animating.
  {
    flushAll();
    let painted = 0;
    claimTouch(SECTION_DRAG_TOUCH_OWNER);
    deferRenderWhileWeekSwiping('dashboard', () => { painted++; });
    releaseTouchAndFlush(DRAWER_TOUCH_OWNER);       // the drawer's settle() on a touchend that is not its own
    assert(painted === 0 && touchClaimedBy() === SECTION_DRAG_TOUCH_OWNER && _deferredRenderCount() === 1,
      '14g: THE OWNER GUARD — the drawer releasing "its" touch while section-drag owns it releases nothing and flushes nothing (a mid-settle repaint would replace the animating nodes)');
    releaseTouchAndFlush(SECTION_DRAG_TOUCH_OWNER);
    assert(painted === 1 && touchClaimedBy() === null, '14g-2: …and the rightful owner\'s own release then flushes once');
    // A stale section-drag claim (its touchend never arrived) never strands a parked repaint, same as the week swipe's.
    claimTouch(SECTION_DRAG_TOUCH_OWNER);
    painted = 0;
    deferRenderWhileWeekSwiping('dashboard', () => { painted++; });
    clearStaleTouchClaim({ touches: [{}] });
    assert(touchClaimedBy() === null, '14h: a fresh one-finger touch clears a stale "section-drag" claim, like every other owner (a stale claim would silence every other recognizer for good)');
    await new Promise(r => setTimeout(r, 5));
    assert(painted === 1, `14h-2: …and the repaint parked under it is not stranded — it runs once that touch has been dealt with (painted ${painted})`);
    flushAll();
  }

  // 14i — pull-to-refresh, the reducer: a 'claimed' event ends it for the rest of the touch.
  {
    const phases = _pullToRefreshStateMachine([
      { type: 'touchstart', scrollTop: 0 }, { type: 'touchmove', dy: 40 }, { type: 'claimed' }, { type: 'touchmove', dy: 200 }, { type: 'touchend' },
    ]);
    assert(phases[2] === 'idle' && !phases.includes('armed') && !phases.includes('refreshing'),
      `14i: the reducer's 'claimed' event returns to idle and the touch is ineligible from then on — a 200 px pull afterwards never arms and its touchend never refreshes (${phases.join(' > ')})`);
    const control = _pullToRefreshStateMachine([{ type: 'touchstart', scrollTop: 0 }, { type: 'touchmove', dy: 200 }, { type: 'touchend' }]);
    assert(control.includes('armed') && control[control.length - 1] === 'refreshing', '14i-2: anti-vacuity — the same pull WITHOUT the claim arms and refreshes');
  }

  // 14j — pull-to-refresh, the BINDER (AT6): a lifted section dragged down at the top of the page never refreshes; the pill path is unchanged.
  {
    const makeWin = () => {
      const handlers = {};
      return { scrollY: 0, innerHeight: 844,
        addEventListener(t, fn) { (handlers[t] ||= []).push(fn); }, removeEventListener(t, fn) { handlers[t] = (handlers[t] || []).filter(h => h !== fn); },
        _fire(t, ev) { (handlers[t] || []).slice().forEach(fn => fn(ev)); } };
    };
    globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: {} }, documentElement: { scrollHeight: 2000 } };
    async function pull(owner, claimAt) {
      flushAll();
      const win = makeWin(); globalThis.window = win;
      let refreshed = 0;
      bindPullToRefresh(() => win, async () => { refreshed++; }, { onFail: () => {} });
      win._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] });
      if (owner && claimAt === 'before') claimTouch(owner);
      win._fire('touchmove', { touches: [{ clientX: 100, clientY: 100 + 30 }] });
      if (owner && claimAt === 'mid') claimTouch(owner);
      win._fire('touchmove', { touches: [{ clientX: 100, clientY: 100 + PULL_TO_REFRESH_ARM_PX + 60 }] });
      win._fire('touchend', {});
      await new Promise(r => setTimeout(r, 0));
      flushAll();
      return refreshed;
    }
    assert(await pull(null) === 1, '14j-0: anti-vacuity — a 124 px pull at scroll-top with NO claim refreshes');
    assert(await pull(SECTION_DRAG_TOUCH_OWNER, 'before') === 0, '14j: AT6 — a touch claimed by "section-drag" (the held title at the top of the page) dragged down past 64 px does NOT refresh');
    assert(await pull(SECTION_DRAG_TOUCH_OWNER, 'mid') === 0, '14j-2: …and the same when the claim lands mid-pull (the hold fires after the finger has already moved a little, with the pull already pulling)');
    assert(await pull('column-reorder', 'before') === 1,
      '14j-3: C4 — the pill path is byte-for-byte unchanged: a pill drag ("column-reorder") at the top of the page can still arm a refresh. A recorded, deferred gap (one token: `!== null`), not an accident of this change');
  }

  // 14k — the web bottom rubber band, the BINDER (AT6).
  {
    const makeWin = () => {
      const handlers = {};
      return { scrollY: 1156, innerHeight: 844,
        addEventListener(t, fn) { (handlers[t] ||= []).push(fn); }, removeEventListener(t, fn) { handlers[t] = (handlers[t] || []).filter(h => h !== fn); },
        _fire(t, ev) { (handlers[t] || []).slice().forEach(fn => fn(ev)); } };
    };
    globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: {} }, documentElement: { scrollHeight: 2000 } };
    function pushUp(owner) {
      flushAll();
      const win = makeWin(); globalThis.window = win;
      const writes = [];
      const target = { style: {}, addEventListener() {}, removeEventListener() {} };
      Object.defineProperty(target.style, 'transform', { set(v) { writes.push(v); }, get() { return writes[writes.length - 1] || ''; } });
      bindBottomBounce(() => win, target, {});
      win._fire('touchstart', { touches: [{ clientX: 100, clientY: 600 }] });
      if (owner) claimTouch(owner);
      win._fire('touchmove', { touches: [{ clientX: 100, clientY: 480 }] });
      const lift = Math.max(0, ...writes.map(w => { const m = /translateY\(-([\d.]+)px\)/.exec(w || ''); return m ? +m[1] : 0; }));
      win._fire('touchend', {});
      flushAll();
      return lift;
    }
    assert(pushUp(null) > 5, '14k-0: anti-vacuity — an upward drag at the page bottom with no claim lifts the page (the T-29 rubber band)');
    assert(pushUp(SECTION_DRAG_TOUCH_OWNER) === 0, '14k: AT6 — a lifted section dragged up at the page bottom does NOT rubber-band the page under it');
    assert(pushUp('column-reorder') > 5, '14k-2: C4 — the pill path\'s bounce is unchanged (a pill drag at the bottom still bounces); the new check is scoped to "section-drag" only');
  }
  globalThis.document = savedDoc14; globalThis.window = savedWin14;

  // 14l — gesturesSuspended() and the layout bar: edit mode suspends every OTHER gesture; the section drag itself asks with ignoreLayoutBar.
  {
    const docWith = (...ids) => ({ getElementById: (id) => (ids.includes(id) ? {} : null), querySelector: () => null });
    globalThis.document = docWith('layout-edit-bar');
    assert(gesturesSuspended() === true, '14l: #layout-edit-bar on the page → gesturesSuspended() is TRUE — the week swipe, pull-to-refresh, nav hide and bounce are all off while a page is being rearranged');
    assert(gesturesSuspended({ ignoreLayoutBar: true }) === false, '14l-2: …and the section drag\'s own question, gesturesSuspended({ ignoreLayoutBar: true }), is FALSE — it must not be frozen by the very mode it enables (the drawer\'s own binder skips this check for the same reason)');
    globalThis.document = docWith('layout-edit-bar', 'site-gate-overlay');
    assert(gesturesSuspended({ ignoreLayoutBar: true }) === true, '14l-3: an overlay (the sign-in gate) still suspends the section drag even with the bar ignored');
    globalThis.document = { getElementById: (id) => (id === 'layout-edit-bar' ? {} : null), querySelector: (sel) => (sel === '#control-center[data-open="true"]' ? {} : null) };
    assert(gesturesSuspended({ ignoreLayoutBar: true }) === true, '14l-4: …and so does the open control center — the drawer covers the page and owns its touch, so a section hold can never start under it');
    globalThis.document = docWith();
    assert(gesturesSuspended() === false && gesturesSuspended({ ignoreLayoutBar: true }) === false, '14l-5: with nothing up neither question is TRUE (no stuck suspension)');
    globalThis.document = savedDoc14;
    assert(gesturesSuspended({ ignoreLayoutBar: true }) === false, '14l-6: no `document` at all → false, no throw (Node / test environment)');
  }
}

console.log(`\n[nav-gestures] ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
