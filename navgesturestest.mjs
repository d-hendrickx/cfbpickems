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
  WEEK_SWIPE_EDGE_EXCLUDE_PX, WEEK_SWIPE_BOUNCE_MAX_PX,
  RUBBER_BAND_CAP_PX,
  _navShowHideStateMachine, _keyboardLayoutStateMachine,
  _pullToRefreshStateMachine, _pullToRefreshEligible,
  _weekSwipeResolve, _rubberBandOffset, _bottomBounceEligible,
  gesturesSuspended, prefersReducedMotion, isKeyboardUp,
  bindScrollDirection, bindPullToRefresh, bindBottomBounce,
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
  assert(WEEK_SWIPE_EDGE_EXCLUDE_PX === 28, '1f: week-swipe left-edge exclusion is 28px (reserved for T-13 drawer)');
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
      'export { isDismissGestureBlockedByOtherSurface, isWizardDismissGestureBlocked };',
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
    const opener = appSrc.slice(appSrc.indexOf('_unbindWizardSheetDismiss = (sheetEl && headerEl)'), appSrc.indexOf('_unbindWizardSheetDismiss = (sheetEl && headerEl)') + 900)
      .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    assert(/getBlocked:\s*isWizardDismissGestureBlocked\b/.test(opener) && !/getBlocked:\s*isDismissGestureBlockedByOtherSurface\b/.test(opener),
      '11n-real-6: the wizard sheet opener binds getBlocked: isWizardDismissGestureBlocked (not the shared predicate)');
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
console.log(`\n[nav-gestures] ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
