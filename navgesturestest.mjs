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
  const dashSelSrc = fnSrc('export function selectableDashboardWeeks(').replace(/^export /, '');
  const picksGetter = getterSrc('page-picks');
  const dashGetter = getterSrc('page-dashboard');
  assert(!!picksNavSrc && !!dashSelSrc && !!picksGetter && !!dashGetter,
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
    'getWeeks', 'getSession', 'getCurrentWeek', 'WEEK_STATUS', 'state', 'chronologicalWeekIds',
    `${picksNavSrc}\n${dashSelSrc}\nreturn (${getterBody});`
  )(() => WEEKS.slice(), () => ({ isAdmin: false }), () => WEEKS.find(w => w.weekId === 'w4'),
    WEEK_STATUS, state, NG.chronologicalWeekIds);

  const swipe = (getState, fromX, toX) => {
    const handlers = {};
    const root = { addEventListener: (t, fn) => { handlers[t] = fn; }, removeEventListener() {} };
    let navigated = null;
    const unbind = NG.bindWeekSwipe(root, getState, (id) => { navigated = id; });
    handlers.touchstart({ touches: [{ clientX: fromX, clientY: 300 }] });
    handlers.touchmove({ touches: [{ clientX: fromX + (toX - fromX) / 2, clientY: 300 }] });
    handlers.touchmove({ touches: [{ clientX: toX, clientY: 300 }] });
    handlers.touchend({});
    unbind();
    return navigated;
  };
  const LEFT = [260, 160];   // finger moves right→left
  const RIGHT = [160, 260];  // finger moves left→right

  let picksGet = null, dashGet = null;
  try { picksGet = build(picksGetter, { picksWeekId: 'w2' }); } catch (e) { /* reported below */ }
  try { dashGet = build(dashGetter, { dashboardWeekId: 'w2' }); } catch (e) { /* reported below */ }
  assert(typeof picksGet === 'function' && typeof dashGet === 'function',
    '5j-pre2: fixture — both extracted state getters compile against the real list builders');

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
  assert(/--nav-bar-clearance:\s*calc\(var\(--nav-pill-h\)\s*\+\s*var\(--nav-pill-gap\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)/.test(rootBody),
    '12a-5: --nav-bar-clearance = pill height + bottom gap + the safe-area inset, computed once');

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
    [/\.submit-bar\{[^}]*bottom:\s*calc\(var\(--nav-bar-clearance\)\s*\+\s*8px\)/, '.submit-bar bottom'],
    [/#auth-banner-stack\{[^}]*bottom:\s*var\(--nav-bar-clearance\)/, '#auth-banner-stack bottom'],
    [/\.update-available-banner\{[^}]*bottom:\s*var\(--nav-bar-clearance\)/, '.update-available-banner bottom'],
    [/#page-chat\.active\{[^}]*height:\s*calc\(100dvh - var\(--nav-bar-clearance\)\)/, '#page-chat.active height (100dvh)'],
    [/@supports not \(height:100dvh\)\{#page-chat\.active\{height:calc\(100vh - var\(--nav-bar-clearance\)\)\}\}/, '#page-chat.active height (100vh fallback)'],
    [/#page-chat \.chat-jump-latest\{bottom:calc\(var\(--nav-bar-clearance\)\s*\+\s*var\(--chat-composer-h,90px\)\s*\+\s*10px\)/, '.chat-jump-latest bottom'],
  ];
  for (const [re, label] of consumerChecks) {
    assert(re.test(css), `12c: ${label} reads var(--nav-bar-clearance)`);
  }

  // [13d] the keyboard-up reset zeroes the COMPOUND token directly, as a
  // <length> (0px), not a unitless 0 — the exact defect class (a bare `0`
  // substituted into calc() is a <number>, not a <length>, so the whole
  // calc() goes invalid at computed-value time) the 2026-09-27 coordinator
  // fix closed under the OLD token name; this must never regress under the
  // new one either.
  assert(/body\[data-keyboard-up\] #page-chat\.active\{--nav-bar-clearance:0px\}/.test(css),
    '12d: body[data-keyboard-up] #page-chat.active zeroes --nav-bar-clearance (0px, a <length>, not unitless 0)');

  // [13e] the pill itself — inset OUTSIDE the box (position, not padding),
  // fully rounded, 48px content-only height.
  const pillMatch = css.match(/\.bottom-nav\{([^}]*)\}/);
  assert(!!pillMatch, '12e-0: found the base .bottom-nav{...} rule');
  const pillBody = pillMatch ? pillMatch[1] : '';
  assert(/left:\s*var\(--nav-pill-inset\)/.test(pillBody) && /right:\s*var\(--nav-pill-inset\)/.test(pillBody),
    '12e-1: .bottom-nav is inset var(--nav-pill-inset) from BOTH edges — a floating pill, not full-bleed');
  assert(/bottom:\s*calc\(var\(--nav-pill-gap\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)/.test(pillBody),
    '12e-2: .bottom-nav\'s bottom offset lives in its POSITION (gap + safe-area), not padded into its own box height');
  assert(/height:\s*var\(--nav-pill-h\)/.test(pillBody), '12e-3: .bottom-nav height is var(--nav-pill-h) — content-only, no more padding-plus-height double count');
  assert(/border-radius:\s*var\(--nav-pill-radius\)/.test(pillBody), '12e-4: .bottom-nav border-radius is var(--nav-pill-radius) — a true capsule');
  assert(/border:\s*1px solid var\(--border\)/.test(pillBody), '12e-5: .bottom-nav carries a hairline border from tokens (var(--border)), not a hardcoded color');

  // [13f] the material — a resolvable, SCANNABLE solid base (contrastscan.mjs
  // can only assert on a rule with a resolvable background; an rgba()
  // literal is skipped by design, per its own doc comment) with the
  // translucent/backdrop-filter enhancement layered on TOP via a POSITIVE
  // @supports feature query, never baked into the base — this is what makes
  // "contrastscan stays green... material fallback included" true by
  // construction, rather than an untested claim.
  assert(/background:\s*var\(--bg-card\)/.test(pillBody),
    '12f-1: .bottom-nav base background is var(--bg-card) — solid, resolvable, and the exact pairing that already cleared this selector\'s contrast check before this DI');
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
  const mediaDarkMatch = css.match(/@media \(prefers-color-scheme:\s*dark\)\s*\{\s*body\.theme-neutral:not\(\[data-color-scheme="light"\]\)\s*\{([^}]*)\}/);
  const manualDarkMatch = css.match(/body\.theme-neutral\[data-color-scheme="dark"\]\s*\{([^}]*)\}/);
  assert(!!mediaDarkMatch && /--nav-material:\s*rgba\(31,27,23,\.72\)/.test(mediaDarkMatch[1]),
    '12i-2: the prefers-color-scheme:dark block sets --nav-material to rgba(31,27,23,.72) (--bg-card\'s own dark hex at the same .72 alpha)');
  assert(!!manualDarkMatch && /--nav-material:\s*rgba\(31,27,23,\.72\)/.test(manualDarkMatch[1]),
    '12i-3: the manual [data-color-scheme="dark"] override carries the BYTE-IDENTICAL value — the two dark blocks cannot drift apart');

  // [13j] Reviewer BLOCK (round 2, 2026-09-27) — a system "reduce
  // transparency" preference drops the glass material back to the same
  // solid, already-proven `--bg-card` the base rule already ships as its
  // no-backdrop-filter fallback — one fallback shape, not two.
  const reduceTranspMatch = css.match(/@media \(prefers-reduced-transparency:reduce\)\{\s*\.bottom-nav\{([^}]*)\}/);
  assert(!!reduceTranspMatch, '12j-1: found @media(prefers-reduced-transparency:reduce){.bottom-nav{...}}');
  assert(!!reduceTranspMatch && /background:\s*var\(--bg-card\)/.test(reduceTranspMatch[1]) && /backdrop-filter:\s*none/.test(reduceTranspMatch[1]) && /-webkit-backdrop-filter:\s*none/.test(reduceTranspMatch[1]),
    `12j-2: prefers-reduced-transparency:reduce sets background:var(--bg-card);backdrop-filter:none;-webkit-backdrop-filter:none (got "${reduceTranspMatch?.[1]}")`);

  // [13g] hide/show — the SAME binary slide (T-24, 240ms), but the translate
  // distance now clears the pill's OWN bottom offset too. MUTATION-PROVEN:
  // a regression back to the bare `translateY(100%)` this DI's own task
  // brief named as the exact bug (a --nav-pill-gap-tall sliver left on
  // screen) must turn this red, not silently keep matching a loose pattern.
  const hiddenMatch = css.match(/\.bottom-nav\.nav-hidden\{([^}]*)\}/);
  const fullOffsetTransform = /transform:\s*translateY\(calc\(100%\s*\+\s*var\(--nav-pill-gap\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)\)/;
  assert(!!hiddenMatch && fullOffsetTransform.test(hiddenMatch[1]),
    '12g-1: .bottom-nav.nav-hidden translates the FULL offset (100% + gap + safe-area) — fully off-screen, no sliver left showing');
  const mutatedHidden = '.bottom-nav.nav-hidden{transform:translateY(100%);transition:transform 240ms ease-in}';
  assert(!fullOffsetTransform.test(mutatedHidden),
    '12g-2 mutation proof: the SAME regex correctly goes RED against the old bare translateY(100%) — the exact sliver-leaving bug this DI closes, not a pattern loose enough to still match it');
  const kbHiddenMatch = css.match(/body\[data-keyboard-up\] \.bottom-nav\{([^}]*)\}/);
  assert(!!kbHiddenMatch && fullOffsetTransform.test(kbHiddenMatch[1]),
    '12g-3: the keyboard-up hide uses the SAME full-offset transform, not the old bare 100%');

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
  assert(!!activeDotMatch && /background:\s*var\(--maroon-text\)/.test(activeDotMatch[1]),
    '12l-3: the dot reads var(--maroon-text) — the SAME token the colour cue already uses, not a new one-off value');
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
console.log(`\n[nav-gestures] ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
