/**
 * CFB Pickems - commpagertest.mjs
 * ================================
 * W-70 (Deployment 1, batch D, 2026-10-14; DI-W70.1 .. DI-W70.6) - NATIVE NAVIGATION IN COMM, the node half: swipe down to close the week wizard (asking first when there are unsaved
 * edits), swipe left/right between the wizard's steps, swipe left/right between the Comm tabs. The browser half (real touches, real layout, computed style) is commnavbrowsertest.mjs.
 *
 *   [A] ZONE AND YIELD   the one drawer-zone set (picks, dashboard, commissioner), the Comm tab strip standing down, the pager-side yield predicate, the suspension lists.
 *   [B] bindWeekSwipe    the new options, each with its default proven byte-identical: isSuspended, yieldToDrawer, shouldYield, canCommit/onRefused, layers:'pane', decorateOutgoing,
 *                        navigateRepaints; the drawer and the pager arbitrated through the REAL drawer binder on the same touches; P-3 on a refused swipe's spring-back.
 *   [C] bindSwipeToDismiss allowWeb, canStart, claimForwardOnly - and the legacy path untouched.
 *   [D] js/wizard-nav.js  the pure decisions: the step table (every cell), the Next gate, the sheet drag's start rule, the unsaved-edits comparison.
 *   [E] SOURCE           static guards: the pager's selectors in the stylesheet, one door for every close path, no gesture sets the bottom tab, the three suspension lists, the drawer's
 *                        sideways-scroller selector untouched, the autosave controls marked.
 *   [F] THE REAL APP     js/app.js driven through minidom (the wizardfinalizetest precedent): the Comm pager armed by the page's own navigateTo(), the tab tap and the swipe through ONE
 *                        function, the wizard's unsaved-edits ask on every close path, the in-flight refusal, the step pager (every gesture through real events at the pager's root), the
 *                        parked repaint and a new touch during the hold (P-2 / P-3).
 *
 * Every gesture here is a sequence of touch events delivered to the element the page bound; nothing calls a binder to arm what the page arms for itself.
 *
 * Run: node commpagertest.mjs
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); }
};
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');

const NG = await import('./js/nav-gestures.js');
const WN = await import('./js/wizard-nav.js');
const CC = await import('./js/control-center.js');
const {
  bindWeekSwipe, bindSwipeToDismiss, isInDrawerOpenZone, isPagerYieldTarget, canScrollHorizontally, DRAWER_ZONE_TABS, DRAWER_ZONE_FRACTION,
  gesturesSuspended, deferRenderWhileWeekSwiping, touchClaimedBy,
} = NG;

// -- shared fakes ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function fakeEl(extra = {}) {
  const handlers = {}; const props = {};
  return {
    dataset: {}, style: { setProperty: (k, v) => { props[k] = v; } }, _props: props,
    addEventListener(t, fn) { (handlers[t] ||= []).push(fn); }, removeEventListener(t, fn) { handlers[t] = (handlers[t] || []).filter((h) => h !== fn); },
    _fire(t, ev) { (handlers[t] || []).slice().forEach((fn) => fn(ev)); }, _count(t) { return (handlers[t] || []).length; },
    ...extra,
  };
}
const ts = (el, x, y, target) => el._fire('touchstart', { touches: [{ clientX: x, clientY: y }], target });
const tm = (el, x, y) => el._fire('touchmove', { touches: [{ clientX: x, clientY: y }] });
const te = (el) => el._fire('touchend', {});
const withWindow = (w, fn) => { const prev = globalThis.window; globalThis.window = w; try { return fn(); } finally { globalThis.window = prev; } };
const NATIVE = () => ({ Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact() {} } } }, innerWidth: 400, innerHeight: 800 });
const WEBWIN = () => ({ innerWidth: 400, innerHeight: 800 });
const WEEKS = ['t1', 't2', 't3', 't4'];

// ==============================================================================================================================================================================================
_log('\n[A] The drawer zone set, the Comm tab strip, the pager-side yield, the suspension lists…');
// ==============================================================================================================================================================================================
{
  assert(DRAWER_ZONE_TABS.length === 3 && ['picks', 'dashboard', 'commissioner'].every((t) => DRAWER_ZONE_TABS.includes(t)) && Object.isFrozen(DRAWER_ZONE_TABS),
    `A-1: ONE exported, frozen set of zone tabs - picks, dashboard, commissioner (got ${JSON.stringify(DRAWER_ZONE_TABS)}) - read by the drawer's arm check and by every pager (DI-W70.4)`);
  const z = (tab, clientX, extra = {}) => isInDrawerOpenZone({ tab, clientX, viewportWidthPx: 400, ...extra });
  assert(z('commissioner', 0) && z('commissioner', 99) && !z('commissioner', 100) && !z('commissioner', 399) && !z('commissioner', -1),
    'A-2: Comm - the LEFT QUARTER opens the Control Center (x 0 and 99 of 400), the rest does not (100 is the boundary, strict <)');
  assert(isInDrawerOpenZone({ tab: 'commissioner', clientX: 10 }) === false && isInDrawerOpenZone({ tab: 'commissioner', clientX: 10, viewportWidthPx: 0 }) === false,
    'A-3: Comm - with no viewport width to measure against the zone fails CLOSED (the pager keeps its own tab), exactly as on Picks');
  assert(['picks', 'dashboard'].every((t) => z(t, 99) && !z(t, 100)), 'A-4: Picks and Dashboard are unchanged (99 in, 100 out)');
  assert(['leaderboard', 'chat', 'admin', 'rules', 'home'].every((t) => z(t, 399) === true),
    'A-5: every OTHER tab keeps DI-419 ruling A’s "from anywhere" (Standings, Chat, Admin, Rules, Home) - the Admin panel’s tabs gain no swipe');
  const mkTarget = (matchesSel, scrollLeft = 0) => ({ scrollLeft, closest(sel) { return matchesSel(String(sel)) ? this : null; } });
  const strip = mkTarget((sel) => sel.includes('.comm-tabbar'), 0);
  assert(z('commissioner', 10, { target: strip }) === false, 'A-6: Comm - a touch that starts ON the tab strip never opens the drawer, even in the left quarter and even with the strip at rest (scrollLeft 0): the strip keeps its touch');
  assert(z('admin', 399, { target: strip }) === true && z('picks', 10, { target: strip }) === true,
    'A-7: …a rule for Comm only: the same strip target at rest changes nothing on Admin or Picks (the strip is not on them; their answers are as before)');
  const input = mkTarget((sel) => sel.includes('input'));
  assert(z('commissioner', 10, { target: input }) === false, 'A-8: a text field in the left quarter keeps its touch on Comm too (the existing yield, on the new tab)');

  // the pager-side yield
  const t = (...sels) => mkTarget((sel) => sels.some((s) => sel.includes(s)));
  assert(isPagerYieldTarget(t('input')) && isPagerYieldTarget(t('textarea')) && isPagerYieldTarget(t('select')) && isPagerYieldTarget(t('[contenteditable]')),
    'A-9: the pager stands down for a text field, a textarea, a select and a contenteditable');
  assert(isPagerYieldTarget(t('[data-no-pane-swipe]')), 'A-10: …and for anything marked data-no-pane-swipe');
  assert(isPagerYieldTarget(t('.comm-tabbar')) && isPagerYieldTarget(t('.chat-pills-scroll')) && isPagerYieldTarget(t('.dashboard-scroll')) && isPagerYieldTarget(t('.batch-grid-scroll')),
    'A-11: …and for the Comm tab strip and the drawer’s own horizontal-scroller selector (one list, two readers)');
  assert(isPagerYieldTarget({ closest: () => null }) === false && isPagerYieldTarget(null) === false && isPagerYieldTarget({}) === false,
    'A-12: an ordinary page element (and nothing, and a non-element) is not a yield target');
  // the generic sideways-scroller check
  const prevGCS = globalThis.getComputedStyle;
  const mkNode = (over, parent = null) => ({ nodeType: 1, parentElement: parent, scrollWidth: 300, clientWidth: 300, closest: () => null, _ox: 'visible', ...over });
  globalThis.getComputedStyle = (el) => ({ overflowX: el._ox, overflowY: el._oy || 'visible' });
  const page = mkNode({ _ox: 'visible' });
  const scroller = mkNode({ _ox: 'auto', scrollWidth: 900, clientWidth: 300 }, page);
  const child = mkNode({}, scroller);
  assert(canScrollHorizontally(child, page) === true && isPagerYieldTarget(child, page) === true, 'A-13: GENERIC - a touch inside any element that really scrolls sideways (overflow-x auto, overflow to scroll) belongs to it, with no selector entry for it');
  const noOverflow = mkNode({ _ox: 'auto', scrollWidth: 300, clientWidth: 300 }, page);
  assert(canScrollHorizontally(mkNode({}, noOverflow), page) === false, 'A-14: …but an overflow-x:auto box with nothing to scroll is not a scroller');
  const hidden = mkNode({ _ox: 'hidden', scrollWidth: 900, clientWidth: 300 }, page);
  assert(canScrollHorizontally(mkNode({}, hidden), page) === false, 'A-15: …nor is overflow-x:hidden');
  const above = mkNode({ _ox: 'auto', scrollWidth: 900, clientWidth: 300 });
  const root = mkNode({ _ox: 'visible' }, above);
  assert(canScrollHorizontally(mkNode({}, root), root) === false, 'A-16: a scroller ABOVE the pager’s own root is not the control’s (the walk stops at the root)');
  globalThis.getComputedStyle = undefined;
  assert(canScrollHorizontally(child, page) === false, 'A-17: no getComputedStyle at all (a bare environment) reads as "no", never throws');
  globalThis.getComputedStyle = prevGCS;

  // gesturesSuspended() names the swap picker sheet
  const mkDoc = (ids) => ({ getElementById: (id) => (ids.includes(id) ? {} : null), querySelector: () => null });
  const prevDoc = globalThis.document;
  globalThis.document = mkDoc([]);
  assert(gesturesSuspended() === false, 'A-18: (fixture) nothing on top - gestures are not suspended');
  globalThis.document = mkDoc(['swap-picker-sheet-wrap']);
  assert(gesturesSuspended() === true, 'A-19: the swap picker sheet (#swap-picker-sheet-wrap) suspends every shared gesture while it is up (DI-W70.4)');
  globalThis.document = mkDoc(['week-wizard-sheet-wrap']);
  assert(gesturesSuspended() === true, 'A-20: …and the wizard sheet still does (the reason the wizard’s own pager passes its own gate)');
  globalThis.document = prevDoc;
}

// ==============================================================================================================================================================================================
_log('\n[B] bindWeekSwipe - the new options, each with its default untouched…');
// ==============================================================================================================================================================================================
{
  const savedWindow = globalThis.window, savedDocument = globalThis.document;
  function makeCloneEl() {
    const attrs = {}; const cls = new Set();
    return { style: {}, setAttribute(k, v) { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null, _attrs: attrs, classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) }, _cls: cls,
      set innerHTML(v) { this._innerHTML = v; }, get innerHTML() { return this._innerHTML; }, parentNode: null, addEventListener() {}, removeEventListener() {}, appendChild(n) { this._kids = [...(this._kids || []), n]; n.parentNode = this; } };
  }
  globalThis.document = { createElement: () => makeCloneEl() };
  function makeRoot({ hostRect = { top: 100, left: 20, width: 390, height: 500 }, rect = { top: 140, left: 20, width: 390, height: 460 } } = {}) {
    const children = [];
    const parent = { insertBefore(node) { node.parentNode = parent; children.push(node); }, removeChild(node) { const i = children.indexOf(node); if (i !== -1) children.splice(i, 1); node.parentNode = null; },
      getBoundingClientRect: () => hostRect, clientLeft: 0, clientTop: 0 };
    const root = fakeEl({ innerHTML: '<div>OLD</div>', parentNode: parent, nextSibling: null, getBoundingClientRect: () => rect, appendChild(n) { (this._kids ||= []).push(n); } });
    return { root, children };
  }
  const ST = (extra = {}) => ({ weekIds: WEEKS, currentWeekId: 't2', tab: 'picks', ...extra });

  // B-1: defaults - a viewport-fixed exit layer, the shared gate, today's zone yield
  withWindow(NATIVE(), () => {
    const { root, children } = makeRoot();
    let nav = null;
    bindWeekSwipe(root, () => ST(), (id) => { nav = id; root.innerHTML = '<div>NEW</div>'; });
    ts(root, 260, 300); tm(root, 160, 300); te(root);
    assert(nav === 't3' && children.length === 1 && children[0].style.position === 'fixed' && children[0].style.top === '140px' && children[0].style.left === '20px',
      `B-1: with no new option the engine is as it was: a release commits, and the exit layer is VIEWPORT-FIXED at the page’s own rect (position "${children[0]?.style.position}", top "${children[0]?.style.top}", left "${children[0]?.style.left}")`);
    root._fire('transitionend', { target: root });
  });

  // B-2: isSuspended
  {
    const prev = globalThis.document;
    globalThis.document = { ...prev, getElementById: (id) => (id === 'week-wizard-sheet-wrap' ? {} : null), querySelector: () => null };
    withWindow(NATIVE(), () => {
      const a = makeRoot().root; bindWeekSwipe(a, () => ST(), () => {});
      ts(a, 260, 300); tm(a, 200, 300);
      assert(a._props['--week-swipe-x'] === undefined, 'B-2a: DEFAULT - a surface that is itself one of the shared gate’s blockers (the wizard sheet) never arms its own pager: nothing follows the finger');
      te(a);
      const b = makeRoot().root; let nav = null;
      bindWeekSwipe(b, () => ST(), (id) => { nav = id; b.innerHTML = '<div>x</div>'; }, { isSuspended: () => false });
      ts(b, 260, 300); tm(b, 200, 300);
      assert(b._props['--week-swipe-x'] === '-60px', `B-2b: opts.isSuspended replaces the gate - "is ANOTHER surface on top of me" - and the pager follows the finger (got ${b._props['--week-swipe-x']})`);
      te(b);
      const c = makeRoot().root;
      bindWeekSwipe(c, () => ST(), () => {}, { isSuspended: () => true });
      ts(c, 260, 300); tm(c, 200, 300);
      assert(c._props['--week-swipe-x'] === undefined, 'B-2c: …and a suspension it reports stands the pager down');
    });
    globalThis.document = prev;
    globalThis.document = { createElement: () => makeCloneEl() };
  }

  // B-3: yieldToDrawer
  withWindow(NATIVE(), () => {
    const a = makeRoot().root; let navA = null;
    bindWeekSwipe(a, () => ST(), (id) => { navA = id; a.innerHTML = '<div>x</div>'; });
    ts(a, 10, 300); tm(a, 120, 300); te(a);
    assert(navA === null && (a._props['--week-swipe-x'] ?? '0px') === '0px' && a.dataset.weekSwipeAnimating === undefined, 'B-3a: DEFAULT - a left-to-right drag from the left quarter on Picks yields to the drawer: no tracking, no commit, no bounce');
    const b = makeRoot().root; let navB = null;
    bindWeekSwipe(b, () => ST(), (id) => { navB = id; b.innerHTML = '<div>x</div>'; }, { yieldToDrawer: false });
    ts(b, 10, 300); tm(b, 120, 300); te(b);
    assert(navB === 't1', `B-3b: opts.yieldToDrawer:false (a surface the drawer can never arm under) - the SAME drag pages back (got ${navB})`);
  });

  // B-4: shouldYield
  withWindow(NATIVE(), () => {
    const seen = [];
    const a = makeRoot().root; let nav = null;
    bindWeekSwipe(a, () => ST(), (id) => { nav = id; }, { shouldYield: (target, dx) => { seen.push([target, dx]); return target === 'FIELD'; } });
    ts(a, 260, 300, 'FIELD'); tm(a, 200, 300); tm(a, 120, 300); te(a);
    assert(seen.length === 1 && seen[0][0] === 'FIELD' && seen[0][1] === -60, `B-4a: shouldYield is asked ONCE per touch, at the axis lock, with the touchstart target and the signed dx (got ${JSON.stringify(seen)})`);
    assert(nav === null && (a._props['--week-swipe-x'] ?? '0px') === '0px' && a.dataset.weekSwipeDragging === undefined && a.dataset.weekSwipeAnimating === undefined && touchClaimedBy() === null,
      `B-4b: a yielded touch is never claimed: no tracking, no drag lock, no bounce, no spring-back, no claim (x ${a._props['--week-swipe-x']}, lock ${a.dataset.weekSwipeDragging}, animating ${a.dataset.weekSwipeAnimating}, owner ${touchClaimedBy()})`);
    ts(a, 260, 300, 'PAGE'); tm(a, 200, 300); tm(a, 120, 300); te(a);
    assert(nav === 't3', `B-4c: the same binder pages normally when the touch starts elsewhere (got ${nav})`);
    a._fire('transitionend', { target: a });
    const b = makeRoot().root; let navB = null;
    bindWeekSwipe(b, () => ST(), (id) => { navB = id; b.innerHTML = '<div>x</div>'; }, { shouldYield: () => { throw new Error('boom'); } });
    ts(b, 260, 300); tm(b, 200, 300); tm(b, 120, 300); te(b);
    assert(navB === 't3', 'B-4d: a throwing predicate is "no yield" - the gesture still works (a bug in a predicate must not kill paging)');
  });

  // B-5: canCommit / onRefused
  withWindow(NATIVE(), () => {
    const asked = [], refused = [];
    const { root, children } = makeRoot(); let nav = null;
    const calls = []; globalThis.window.Capacitor.Plugins.Haptics.impact = (o) => calls.push(o);
    bindWeekSwipe(root, () => ST(), (id) => { nav = id; }, { canCommit: (id, dir) => { asked.push([id, dir]); return false; }, onRefused: (dir) => refused.push(dir) });
    ts(root, 260, 300); tm(root, 160, 300);
    assert(asked.length === 0, 'B-5a: canCommit is not asked while the finger is down');
    te(root);
    assert(JSON.stringify(asked) === '[["t3",-1]]' && JSON.stringify(refused) === '[-1]', `B-5b: at RELEASE it is asked once with the target and the direction, and a "no" calls onRefused(direction) once (asked ${JSON.stringify(asked)}, refused ${JSON.stringify(refused)})`);
    assert(nav === null && children.length === 0 && calls.length === 0 && root.dataset.weekSwipeAnimating === 'bounce' && root._props['--week-swipe-x'] === '0px',
      `B-5c: a refused change plays NO slide: no navigation, no exit layer, no haptic - the page springs back (animating "${root.dataset.weekSwipeAnimating}", clones ${children.length}, haptics ${calls.length})`);
    // a short drag the release would not commit anyway never asks
    const r2 = makeRoot().root; let asked2 = 0;
    bindWeekSwipe(r2, () => ST(), () => {}, { canCommit: () => { asked2++; return true; }, onRefused: () => { asked2 += 100; } });
    ts(r2, 260, 300); tm(r2, 250, 300); te(r2);
    assert(asked2 === 0, 'B-5d: a drag that would not commit anyway (10 px) asks nothing and refuses nothing');
    // a bound is not a refusal
    const r3 = makeRoot().root; let asked3 = 0;
    bindWeekSwipe(r3, () => ({ weekIds: ['only'], currentWeekId: 'only', tab: 'x' }), () => {}, { canCommit: () => { asked3++; return true; }, onRefused: () => { asked3 += 100; } });
    ts(r3, 260, 300); tm(r3, 160, 300); te(r3);
    assert(asked3 === 0 && r3._props['--week-swipe-x'] === '0px', 'B-5e: dragging past a bound just rubber-bands: canCommit and onRefused are not involved');
    // yes commits as before
    const r4 = makeRoot(); let nav4 = null;
    bindWeekSwipe(r4.root, () => ST(), (id) => { nav4 = id; r4.root.innerHTML = '<div>n</div>'; }, { canCommit: () => true, onRefused: () => { nav4 = 'REFUSED'; } });
    ts(r4.root, 260, 300); tm(r4.root, 160, 300); te(r4.root);
    assert(nav4 === 't3' && r4.children.length === 1, 'B-5f: canCommit true - the release commits and slides exactly as without it');
    // a throwing canCommit is a refusal
    const r5 = makeRoot(); let nav5 = null, ref5 = 0;
    bindWeekSwipe(r5.root, () => ST(), (id) => { nav5 = id; }, { canCommit: () => { throw new Error('boom'); }, onRefused: () => { ref5++; } });
    ts(r5.root, 260, 300); tm(r5.root, 160, 300); te(r5.root);
    assert(nav5 === null && ref5 === 1 && r5.children.length === 0, 'B-5g: a throwing canCommit is a refusal (fail closed): nothing navigates, nothing slides');
  });

  // B-6: layers:'pane'
  withWindow(NATIVE(), () => {
    const { root, children } = makeRoot({ hostRect: { top: 100, left: 20, width: 390, height: 500 }, rect: { top: 140, left: 20, width: 390, height: 460 } });
    let nav = null;
    bindWeekSwipe(root, () => ST({ tab: 'week-wizard' }), (id) => { nav = id; root.innerHTML = '<div>NEW</div>'; }, { layers: 'pane', renderPreview: () => { const e = makeCloneEl(); e.innerHTML = 'NEXT'; return e; }, isSuspended: () => false, yieldToDrawer: false });
    ts(root, 260, 300); tm(root, 200, 300);
    const layer = root._kids && root._kids[0];
    assert(!!layer, 'B-6a: PANE mode - the incoming layer is laid into the pane as a child');
    assert(layer && layer.style.position === 'absolute' && layer.style.top === '0px' && layer.style.left === '100%' && layer.style.width === '100%' && layer.style.height === '460px',
      `B-6b: …absolute, from the pane’s own top, flush at +100%, the pane’s own height (no document-scroll arithmetic): ${JSON.stringify(layer?.style)}`);
    tm(root, 150, 300); te(root);
    const clone = children[0];
    assert(nav === 't3' && clone && clone.style.position === 'absolute', `B-6c: PANE mode - the exit layer is ABSOLUTE inside the pane’s parent, not viewport-fixed (a fixed layer inside a transformed sheet is placed relative to the sheet) - got "${clone?.style.position}"`);
    assert(clone && clone.style.top === '40px' && clone.style.left === '0px' && clone.style.width === '390px' && clone.style.height === '460px',
      `B-6d: …at the pane’s live rect in the PARENT’s coordinates (140-100 = 40, 20-20 = 0): top ${clone?.style.top}, left ${clone?.style.left}`);
    assert(clone && clone.style.overflowY === 'hidden', 'B-6e: …clipped (overflow hidden), not scrollable');
    root._fire('transitionend', { target: root });
  });

  // B-7: decorateOutgoing
  withWindow(NATIVE(), () => {
    const order = [];
    const { root, children } = makeRoot();
    bindWeekSwipe(root, () => ST(), () => { order.push('navigate'); }, { decorateOutgoing: (clone, r) => { order.push('decorate'); clone.setAttribute('data-x', '1'); assertSame(r, root); } });
    function assertSame(a, b) { if (a !== b) order.push('WRONG-ROOT'); }
    ts(root, 260, 300); tm(root, 160, 300); te(root);
    assert(JSON.stringify(order) === '["decorate","navigate"]' && children[0]._attrs['data-x'] === '1', `B-7a: decorateOutgoing(clone, root) runs BEFORE onNavigate, on the exit layer (order ${JSON.stringify(order)})`);
    root._fire('transitionend', { target: root });
    const r2 = makeRoot(); let nav = null;
    bindWeekSwipe(r2.root, () => ST(), (id) => { nav = id; }, { decorateOutgoing: () => { throw new Error('boom'); } });
    ts(r2.root, 260, 300); tm(r2.root, 160, 300); te(r2.root);
    assert(nav === 't3', 'B-7b: a throwing decorateOutgoing does not stop the commit');
  });

  // B-8: navigateRepaints
  withWindow(NATIVE(), () => {
    for (const [opt, expectRun] of [[undefined, false], [false, true]]) {
      const { root } = makeRoot(); let ran = 0;
      bindWeekSwipe(root, () => ST({ tab: 'pagekey' }), () => { root.innerHTML = '<div>n</div>'; }, opt === undefined ? {} : { navigateRepaints: opt });
      ts(root, 260, 300); tm(root, 200, 300);
      const parked = deferRenderWhileWeekSwiping('pagekey', () => { ran++; });
      tm(root, 160, 300);
      te(root);
      assert(parked === true && (ran === 1) === expectRun,
        `B-8${opt === undefined ? 'a' : 'b'}: ${opt === undefined ? 'DEFAULT - onNavigate repaints the swiped page itself, so its parked repaint is redundant and is skipped' : 'navigateRepaints:false (Comm: a tab switch re-renders nothing) - the parked repaint RUNS at the commit'} (parked ${parked}, ran ${ran})`);
      root._fire('transitionend', { target: root });
    }
  });

  // B-10: N-7 (review 2026-10-14) - onSettled fires ONCE, when a COMMITTED swipe's slide has finished; never for a spring-back or a refusal
  withWindow(NATIVE(), () => {
    const { root } = makeRoot(); let settled = 0, nav = null, order = [];
    bindWeekSwipe(root, () => ST(), (id) => { nav = id; order.push('navigate'); root.innerHTML = '<div>n</div>'; }, { onSettled: () => { settled++; order.push('settled'); } });
    ts(root, 260, 300); tm(root, 160, 300); te(root);
    assert(nav === 't3' && settled === 0, `B-10a: the commit has navigated but the slide is still going: onSettled has NOT fired yet (settled ${settled})`);
    root._fire('transitionend', { target: root });
    assert(settled === 1 && JSON.stringify(order) === '["navigate","settled"]', `B-10b: when the slide ends onSettled fires once, after onNavigate (${JSON.stringify(order)})`);
    root._fire('transitionend', { target: root });
    assert(settled === 1, 'B-10c: …and a stray second transitionend does not fire it again');
    const r2 = makeRoot(); let s2 = 0;
    bindWeekSwipe(r2.root, () => ST(), () => {}, { onSettled: () => { s2++; }, canCommit: () => false, onRefused: () => {} });
    ts(r2.root, 260, 300); tm(r2.root, 160, 300); te(r2.root); r2.root._fire('transitionend', { target: r2.root });
    assert(s2 === 0, 'B-10d: a REFUSED swipe (spring-back) does not fire onSettled');
    const r3 = makeRoot(); let s3 = 0, n3 = null;
    bindWeekSwipe(r3.root, () => ST(), (id) => { n3 = id; r3.root.innerHTML = '<div>n</div>'; }, { onSettled: () => { s3++; throw new Error('boom'); } });
    ts(r3.root, 260, 300); tm(r3.root, 160, 300); te(r3.root); r3.root._fire('transitionend', { target: r3.root });
    assert(n3 === 't3' && s3 === 1, 'B-10e: a throwing onSettled is contained (the swipe is already done)');
  });

  // B-9: P-3 - a new touch during a REFUSED swipe's spring-back
  withWindow(NATIVE(), () => {
    const { root } = makeRoot(); let nav = null, refusing = true;
    bindWeekSwipe(root, () => ST({ tab: 'commissioner' }), (id) => { nav = id; root.innerHTML = '<div>n</div>'; }, { canCommit: () => !refusing, onRefused: () => {} });
    ts(root, 260, 300); tm(root, 160, 300);
    let ran = 0; deferRenderWhileWeekSwiping('commissioner', () => { ran++; });
    te(root);
    assert(root.dataset.weekSwipeAnimating === 'bounce' && ran === 0, 'B-9a: (fixture) the refused swipe’s spring-back is sliding and the repaint parked under it is held until it ends');
    refusing = false;
    ts(root, 260, 300);                                   // a NEW touch lands while the spring is still going
    assert(root.dataset.weekSwipeAnimating === undefined && root._props['--week-swipe-x'] === '0px', 'B-9b: P-3 - the new touch ends the spring at once: the page is at rest, no stale animating state');
    tm(root, 160, 300); te(root);
    assert(nav === 't3', `B-9c: P-3 - and that new swipe works (got ${nav})`);
    root._fire('transitionend', { target: root });
  });

  globalThis.window = savedWindow; globalThis.document = savedDocument;
}

// ==============================================================================================================================================================================================
_log('\n[B2] The drawer and the Comm pager on the SAME touches, through the REAL drawer binder…');
// ==============================================================================================================================================================================================
{
  const savedWindow = globalThis.window;
  function runGesture(tab, startFrac, endFrac, { target = undefined, shouldYield = null, noCapacitor = false } = {}) {
    const handlers = {};
    const win = { innerWidth: 400, innerHeight: 800, ...(noCapacitor ? {} : { Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact() {} } } } }),
      addEventListener(t, fn) { (handlers[t] ||= []).push(fn); }, removeEventListener() {}, _fire(t, ev) { (handlers[t] || []).slice().forEach((fn) => fn(ev)); } };
    globalThis.window = win;
    let drawerStarted = false, navigated = null;
    const unbindDrawer = CC.bindControlCenterEdgeSwipe((a) => { if (a.type === 'drag-start') drawerStarted = true; }, () => ({ phase: 'closed', dragProgress: 0 }), { getWidthPx: () => 340, getTab: () => tab });
    const root = fakeEl({ dataset: {}, style: { setProperty() {} } });
    const unbindPager = bindWeekSwipe(root, () => ({ weekIds: ['week', 'games', 'players', 'rules', 'scribe'], currentWeekId: 'games', tab }), (id) => { navigated = id; }, shouldYield ? { shouldYield } : {});
    const sx = startFrac * 400, ex = endFrac * 400;
    const seq = [['touchstart', { touches: [{ clientX: sx, clientY: 300 }], target }], ['touchmove', { touches: [{ clientX: sx + (ex - sx) / 2, clientY: 300 }] }], ['touchmove', { touches: [{ clientX: ex, clientY: 300 }] }]];
    for (const [type, ev] of seq) { win._fire(type, ev); root._fire(type, ev); }
    root._fire('transitionend', { target: root });
    win._fire('touchend', {}); root._fire('touchend', {});
    unbindDrawer(); unbindPager();
    return { drawerStarted, navigated };
  }
  let r = runGesture('commissioner', 0.20, 0.50);
  assert(r.drawerStarted === true && r.navigated === null, `B2-1: Comm, a rightward swipe starting at 20% of the width (the left quarter): the Control Center takes it and the pager does NOT change tab (drawer ${r.drawerStarted}, tab ${r.navigated})`);
  r = runGesture('commissioner', 0.30, 0.60);
  assert(r.drawerStarted === false && r.navigated === 'week', `B2-2: …starting at 30% it is the PAGER’s: previous tab (Games → Week), no drawer (drawer ${r.drawerStarted}, tab ${r.navigated})`);
  r = runGesture('commissioner', 0.10, 0.10 - 60 / 400);
  assert(r.navigated === 'players', `B2-3: a LEFTWARD swipe starting deep inside the left quarter (10%) still moves to the NEXT tab - the drawer’s zone never strands the pager (got ${r.navigated})`);
  r = runGesture('commissioner', 0.30, 0.60, { noCapacitor: true });
  assert(r.drawerStarted === false && r.navigated === 'week', `B2-4: the same on the WEB app (no Capacitor): the rule is not native-only (drawer ${r.drawerStarted}, tab ${r.navigated})`);
  const field = { closest: (sel) => (String(sel).includes('input') ? field : null), scrollLeft: 0 };
  r = runGesture('commissioner', 0.50, 0.20, { target: field, shouldYield: (t) => isPagerYieldTarget(t) });
  assert(r.navigated === null, `B2-5: a swipe that starts on a text field changes no tab (got ${r.navigated}) - the field keeps its touch`);
  const strip = { closest: (sel) => (String(sel).includes('.comm-tabbar') ? strip : null), scrollLeft: 0 };
  r = runGesture('commissioner', 0.50, 0.20, { target: strip, shouldYield: (t) => isPagerYieldTarget(t) });
  assert(r.navigated === null, `B2-6: a swipe that starts on the tab strip changes no tab either (got ${r.navigated})`);
  r = runGesture('commissioner', 0.10, 0.50, { target: strip, shouldYield: (t) => isPagerYieldTarget(t) });
  assert(r.drawerStarted === false && r.navigated === null, `B2-7: …and a rightward left-quarter swipe that starts ON the strip opens neither (drawer ${r.drawerStarted}, tab ${r.navigated}): the pager and the drawer both stand down for it`);
  r = runGesture('picks', 0.10, 0.50);
  assert(r.drawerStarted === true, 'B2-8: Picks is unchanged: the left quarter still opens the Control Center');
  globalThis.window = savedWindow;
}

// ==============================================================================================================================================================================================
_log('\n[C] bindSwipeToDismiss - allowWeb, canStart, claimForwardOnly…');
// ==============================================================================================================================================================================================
{
  const savedWindow = globalThis.window;
  const mk = () => fakeEl({ dataset: {}, style: { setProperty() {} } });
  // The binder times the drag with Date.now(); a fake clock (100 ms per move) keeps the flick rule (0.3 px/ms) out of the distance cases.
  let clock = 1000; const realNow = Date.now; Date.now = () => clock;
  const drive = (el, pts, target) => { ts(el, pts[0][0], pts[0][1], target); for (const [x, y] of pts.slice(1)) { clock += 100; tm(el, x, y); } te(el); };
  // C-1: web
  withWindow(WEBWIN(), () => {
    const a = mk(); bindSwipeToDismiss(a, { axis: 'y', getDistancePx: () => 500 });
    assert(a._count('touchstart') === 0, 'C-1a: DEFAULT - on the web app (no Capacitor) the binder attaches nothing: native-only, as every other caller');
    const b = mk(); bindSwipeToDismiss(b, { axis: 'y', getDistancePx: () => 500, allowWeb: true });
    assert(b._count('touchstart') === 1 && b._count('touchmove') === 1 && b._count('touchend') === 1 && b._count('touchcancel') === 1, 'C-1b: opts.allowWeb attaches the four touch listeners on the web app (touch only: a mouse sends none of these events)');
    const settles = []; const c = mk();
    bindSwipeToDismiss(c, { axis: 'y', getDistancePx: () => 500, allowWeb: true, onSettle: (r) => settles.push(r.dismissed) });
    drive(c, [[100, 100], [100, 140], [100, 400]]);
    assert(settles.length === 1 && settles[0] === true, 'C-1c: …and a drag past 40% on the web app dismisses');
  });
  // C-2: canStart
  withWindow(NATIVE(), () => {
    const prog = []; const e = mk();
    bindSwipeToDismiss(e, { axis: 'y', getDistancePx: () => 500, canStart: () => false, onProgress: (p) => prog.push(p), onSettle: () => prog.push('settle') });
    drive(e, [[100, 100], [100, 140], [100, 400]]);
    assert(prog.length === 0, 'C-2a: canStart false - the touch is not the gesture’s: no progress, no settle');
    const seen = []; const f = mk();
    bindSwipeToDismiss(f, { axis: 'y', getDistancePx: () => 500, canStart: (ev) => { seen.push(ev.target); return ev.target === 'HEADER'; }, onProgress: (p) => prog.push(p), onSettle: () => {} });
    drive(f, [[100, 100], [100, 140]], 'BODY');
    assert(seen[0] === 'BODY' && prog.length === 0, 'C-2b: canStart receives the touchstart event (its target)');
    drive(f, [[100, 100], [100, 140]], 'HEADER');
    assert(prog.length > 0, 'C-2c: …and a yes arms the gesture');
  });
  // C-3: claimForwardOnly
  withWindow(NATIVE(), () => {
    const prog = []; const settles = []; const e = mk();
    bindSwipeToDismiss(e, { axis: 'y', getDistancePx: () => 500, canStart: () => true, claimForwardOnly: true, onProgress: (p) => prog.push(p), onSettle: (r) => settles.push(r.dismissed) });
    drive(e, [[100, 400], [100, 380], [100, 300], [100, 600]]);
    assert(prog.length === 0 && settles.length === 0, `C-3a: a drag whose first decisive movement goes UP is a scroll: never claimed, even if the finger later reverses and goes down (progress calls ${prog.length})`);
    drive(e, [[100, 100], [100, 140], [100, 160]]);
    assert(prog.length === 2 && settles.length === 1 && settles[0] === false, `C-3b: a drag that goes DOWN first is claimed and follows the finger (progress ${JSON.stringify(prog)}); a short release springs back (dismissed ${settles[0]})`);
    prog.length = 0; settles.length = 0;
    drive(e, [[100, 100], [100, 130], [100, 400]]);
    assert(settles.length === 1 && settles[0] === true, 'C-3c: past 40% it dismisses');
    // a claimed drag that comes back above its start stays claimed at progress 0 (native feel)
    prog.length = 0;
    ts(e, 100, 300); clock += 100; tm(e, 100, 330); clock += 100; tm(e, 100, 200);
    assert(prog.length === 2 && prog[1] === 0, `C-3d: once claimed, a finger that comes back above where it began holds the sheet at 0 (not a new gesture): ${JSON.stringify(prog)}`);
    te(e);
  });
  // C-4: legacy path untouched
  withWindow(NATIVE(), () => {
    const prog = []; const e = mk();
    bindSwipeToDismiss(e, { axis: 'y', getDistancePx: () => 500, onProgress: (p) => prog.push(p), onSettle: () => {} });
    drive(e, [[100, 400], [100, 380], [100, 300]]);
    assert(prog.length >= 1 && prog.every((p) => p === 0), `C-4: with neither option the legacy claim is exactly as before - an upward-first drag still reports progress 0 (${JSON.stringify(prog)})`);
  });
  Date.now = realNow;
  globalThis.window = savedWindow;
}

// ==============================================================================================================================================================================================
_log('\n[D] js/wizard-nav.js - the pure decisions…');
// ==============================================================================================================================================================================================
{
  const { wizardCreateStepPlan: plan, wizardCanAdvance: can, wizardStepButtonId: btn } = WN;
  const P = (step, hasGames = false, blurbValid = false) => JSON.stringify(plan({ step, hasGames, blurbValid }).weekIds);
  assert(P(1) === '["1"]' && P(1, true, true) === '["1"]', 'D-1: Step 1 - no neighbour either way: Create Week writes the week, only the button does it, and there is nothing before it');
  assert(P(2, false) === '["1","2"]' && P(2, true) === '["1","2","3"]', 'D-2: Step 2 - back to 1; forward to 3 only with a game on the slate (the button’s own rule)');
  assert(P(3) === '["2","3","4"]', 'D-3: Step 3 - both ways');
  assert(P(4, true, false) === '["3","4","5"]' && P(4, true, true) === '["3","4","6"]', 'D-4: Step 4 - back to 3; forward to 5, or straight to 6 when the week already holds a valid blurb, exactly as the Next button does');
  assert(P(5) === '["4","5","6"]', 'D-5: Step 5 - both ways');
  assert(P(6) === '["5","6"]', 'D-6: Step 6 - back to 5 only: Open for picks, Schedule Open and Keep as draft are explicit buttons, never a swipe');
  assert(plan({ step: 3 }).currentWeekId === '3' && plan({ step: 99 }).weekIds.length === 1, 'D-7: the current id is the step as a string; an unknown step has no neighbours');
  assert(can({ step: 2, hasGames: true }) && !can({ step: 2, hasGames: false }), 'D-8: Step 2 forward needs a game');
  assert(can({ step: 3 }) === true, 'D-9: Step 3 forward always passes');
  assert(can({ step: 4, blurbMissing: true, openAtTyped: true }) === false && can({ step: 4, blurbMissing: true, openAtTyped: false }) === true && can({ step: 4, blurbMissing: false, openAtTyped: true }) === true,
    'D-10: Step 4 forward is refused only when an Auto-Open time is typed and the week has no valid blurb (the button’s inline guard)');
  assert(can({ step: 5, blurbRequired: true, blurbTypedOk: false }) === false && can({ step: 5, blurbRequired: true, blurbTypedOk: true }) === true && can({ step: 5, blurbRequired: false, blurbTypedOk: false }) === true,
    'D-11: Step 5 forward needs a valid blurb when the week must carry one (a demo week is exempt)');
  assert(can({ step: 1 }) === false && can({ step: 6 }) === false && can({ step: 7 }) === false, 'D-12: Steps 1 and 6 never advance by swipe');
  assert(btn(3, -1) === 'wiz-step3-next' && btn(3, 1) === 'wiz-step3-back' && btn(6, 1) === 'wiz-step6-back', 'D-13: a swipe stands for the footer button: left = Next, right = Back');

  // the sheet drag's start rule
  const mkTarget = (over = {}) => ({ nodeType: 1, parentElement: null, closest: () => null, scrollTop: 0, scrollWidth: 300, clientWidth: 300, ...over });
  const body = mkTarget({ contains: (n) => n.__in === true || n === body, scrollTop: 0 });
  const inBody = (over = {}) => mkTarget({ __in: true, parentElement: body, ...over });
  const prevGCS = globalThis.getComputedStyle; globalThis.getComputedStyle = (el) => ({ overflowX: el._ox || 'visible', overflowY: el._oy || 'visible' });
  const can2 = (target, vw = 390, b = body) => WN.canStartWizardSheetDrag({ target, bodyEl: b, viewportWidthPx: vw });
  assert(can2(mkTarget()) === true, 'D-14: a touch on the header, the grabber or the step tracker (outside the body) always starts the swipe-down');
  assert(can2(inBody()) === true, 'D-15: …and a touch on the body at scroll-top does too');
  body.scrollTop = 40; assert(can2(inBody()) === false, 'D-16: a body scrolled down scrolls instead (only a drag that starts at scroll-top dismisses)'); body.scrollTop = 0;
  assert(can2(inBody({ closest: (s) => (String(s).includes('textarea') ? {} : null) })) === false, 'D-17: a touch on a text field or select never starts it (the field keeps its touch)');
  assert(can2(inBody({ _oy: 'auto', scrollTop: 120 })) === false, 'D-18: a nested list that is itself scrolled down scrolls back first');
  assert(can2(inBody({ _ox: 'auto', scrollWidth: 900, clientWidth: 300 })) === false, 'D-19: an element that scrolls sideways keeps its touch');
  assert(can2(mkTarget(), 700) === false && can2(mkTarget(), 1200) === false && can2(mkTarget(), 699) === true, 'D-20: only a bottom sheet (< 700 px): the side panel at 700 px and up has no swipe-down');
  assert(can2(mkTarget(), 0) === false && can2(null) === false && can2({ nodeType: 3 }) === false, 'D-21: no viewport width, no target, or a text node: not armed');
  globalThis.getComputedStyle = prevGCS;

  // unsaved edits
  const control = (tag, over = {}) => ({ nodeType: 1, tagName: tag, id: '', value: '', checked: false, type: '', getAttribute(k) { return this._attrs?.[k] ?? null; }, hasAttribute(k) { return !!(this._attrs && k in this._attrs); }, closest(sel) { return this._autosaveParent && String(sel).includes('data-wiz-autosave') ? {} : null; }, ...over });
  const mkBody = (controls) => ({ querySelectorAll: () => controls });
  const a = control('INPUT', { id: 'a', value: 'x', type: 'text' }), tx = control('TEXTAREA', { id: 'b', value: 'hello' });
  const sel = control('SELECT', { id: 'c', value: '1' }), sw = control('BUTTON', { id: 'd', _attrs: { role: 'switch', 'aria-checked': 'false' } });
  const cb = control('INPUT', { id: 'e', type: 'checkbox', checked: false });
  const auto = control('SELECT', { id: 'f', value: 'p', _attrs: { 'data-wiz-autosave': '' } });
  const wrapAuto = control('INPUT', { id: 'g', type: 'text', value: '1', _autosaveParent: true });
  const hid = control('INPUT', { id: 'h', type: 'hidden', value: 'k' }), btnIn = control('INPUT', { id: 'i', type: 'submit', value: 'Go' });
  const all = [a, tx, sel, sw, cb, auto, wrapAuto, hid, btnIn];
  const snap = WN.snapshotWizardControls(mkBody(all));
  assert(snap.length === 5 && !snap.some(([k]) => /#f|#g|#h|#i/.test(k)) , `D-22: the snapshot tracks inputs, textareas, selects, switches and checkboxes - not hidden/submit inputs and not autosave controls (${snap.length} tracked)`);
  assert(WN.wizardControlsDirty(snap, mkBody(all)) === false, 'D-23: nothing changed - clean');
  a.value = 'xy'; assert(WN.wizardControlsDirty(snap, mkBody(all)) === true, 'D-24: a typed value - dirty'); a.value = 'x';
  tx.value = 'hello!'; assert(WN.wizardControlsDirty(snap, mkBody(all)) === true, 'D-25: a textarea - dirty'); tx.value = 'hello';
  sel.value = '2'; assert(WN.wizardControlsDirty(snap, mkBody(all)) === true, 'D-26: a select - dirty'); sel.value = '1';
  sw._attrs['aria-checked'] = 'true'; assert(WN.wizardControlsDirty(snap, mkBody(all)) === true, 'D-27: a switch row’s aria-checked - dirty'); sw._attrs['aria-checked'] = 'false';
  cb.checked = true; assert(WN.wizardControlsDirty(snap, mkBody(all)) === true, 'D-28: a checkbox - dirty'); cb.checked = false;
  auto.value = 'q'; wrapAuto.value = '2'; assert(WN.wizardControlsDirty(snap, mkBody(all)) === false, 'D-29: controls that SAVE ON CHANGE (marked, or inside a marked node) are never an unsaved edit');
  const extra = control('INPUT', { id: 'z', type: 'text', value: 'new' });
  assert(WN.wizardControlsDirty(snap, mkBody([a, tx, sel, sw, cb, extra])) === false, 'D-30: a control the baseline never saw (a step added it without a repaint) is not an edit');
  assert(WN.wizardControlsDirty(null, mkBody(all)) === false && WN.wizardControlsDirty([], mkBody(all)) === false, 'D-31: no baseline (nothing painted yet) is clean: it can never ask to discard what nobody typed');
  assert(WN.wizardControlsDirty(snap, null) === false, 'D-32: no body is clean');
  assert(WN.WIZ_NAV_COPY.DISCARD_TITLE === 'Discard changes?' && WN.WIZ_NAV_COPY.DISCARD_MESSAGE === "You have changes on this step that haven't been saved." && WN.WIZ_NAV_COPY.DISCARD === 'Discard Changes'
    && WN.WIZ_NAV_COPY.KEEP_EDITING === 'Keep Editing' && WN.WIZ_NAV_COPY.FINALIZING === 'Finalizing — you can close this when it finishes.', 'D-33: the five new strings are exactly the DI’s (section 5.4)');
}

// ==============================================================================================================================================================================================
_log('\n[E] Source guards…');
// ==============================================================================================================================================================================================
const APP = read('./js/app.js'), CSS = read('./css/styles.css'), NGSRC = read('./js/nav-gestures.js'), CCSRC = read('./js/control-center.js');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const between = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); return i < 0 || j < 0 ? '' : src.slice(i, j); };
{
  // E-1: the stylesheet - every week-swipe rule that names Picks names Comm (DI-W70.3)
  const rules = [...stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const swipeRules = rules.filter((r) => r.sel.includes('#page-picks') && (/week-swipe/.test(r.sel + r.body) || /touch-action/.test(r.body)));
  assert(swipeRules.length >= 8, `E-1a: (fixture) the week-swipe block has its rules (found ${swipeRules.length} that name #page-picks)`);
  const missing = swipeRules.filter((r) => !r.sel.includes('#page-commissioner'));
  assert(missing.length === 0, `E-1b: EVERY week-swipe selector list that names #page-picks also names #page-commissioner (a list that forgot it would leave Comm half-wired: a tab swipe that never moves, or never animates) - missing in: ${missing.map((r) => r.sel.slice(0, 70)).join(' | ')}`);
  const pagerRules = swipeRules.filter((r) => /transform:translateX|touch-action|data-week-swipe-animating/.test(r.sel + r.body) && !/html:has/.test(r.sel));
  const noPager = pagerRules.filter((r) => !r.sel.includes('#week-wizard-pager'));
  assert(noPager.length === 0, `E-1c: …and the transform / touch-action / animating rules name the wizard’s pane (#week-wizard-pager) too (missing: ${noPager.map((r) => r.sel.slice(0, 60)).join(' | ')})`);
  assert(/\.week-swipe-exit-layer\.comm-pane\[data-comm-pane\] \.admin-section\[data-comm-tab\]/.test(CSS) && /#page-commissioner \.comm-pane\[data-comm-pane\] \.admin-section\[data-comm-tab\]/.test(CSS),
    'E-1d: a Comm layer shows ITS tab by its own rule (inside the panel and outside it), not by the live panel’s flag');
  // E-1e: no sideways scroller on Comm that the drawer's selector does not know
  const hs = [...stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*overflow-x\s*:\s*(?:auto|scroll)[^{}]*)\}/g)].map((m) => m[1].trim());
  const known = ['.chat-pills-scroll', '.dashboard-scroll', '.comm-tabbar', '.batch-grid-scroll'];
  const commScoped = hs.flatMap((s) => s.split(',').map((x) => x.trim())).filter((s) => /#page-commissioner|\.comm-|\.admin-section|\[data-comm-tab/.test(s));
  const unknown = commScoped.filter((s) => !known.some((k) => s.includes(k)));
  assert(unknown.length === 0, `E-1e: no stylesheet rule scopes a sideways scroller to the Comm page that DRAWER_HSCROLL_SELECTOR does not name - a new one adds itself to that list first (offenders: ${unknown.join(' | ') || 'none'})`);
  assert(/#week-wizard-sheet\[data-dragging="true"\] #week-wizard-body\{overflow-y:hidden/.test(CSS), 'E-1f: while a body drag is claimed the wizard body is not scrollable (the outcome the DI pins)');

  // E-2: one door
  const mount = between(APP, 'function mountWeekWizardSheetShell()', 'let _unbindWizardPager = null;');
  assert(/onBackdrop:\s*requestCloseWeekWizardSheet/.test(mount) && !/onBackdrop:\s*closeWeekWizardSheet/.test(mount) && /closeId:\s*'week-wizard-close'/.test(mount) && !/onClose:/.test(mount),
    'E-2a: the backdrop and the ✕ go through requestCloseWeekWizardSheet (the ✕ has no separate onClose)');
  const settle = between(APP, 'function settleWizardSheetDrag(', 'export const _openWeekWizardSheetForTest');
  assert(/requestCloseWeekWizardSheet\(\)/.test(settle) && /_finalizeInFlight \|\| wizardHasUnsavedEdits\(\)/.test(settle), 'E-2b: a dismissing swipe asks the same door before it slides (it springs back first when it must be asked)');
  const closers = [...stripComments(APP).matchAll(/closeWeekWizardSheet\(\)/g)].length;
  assert(closers >= 4, `E-2c: (fixture) closeWeekWizardSheet() is still the unconditional closer the flows call when they are DONE (${closers} calls)`);

  // E-3: no gesture sets the bottom tab
  const blocks = [
    ['setCommTab', between(APP, 'export function setCommTab(', 'function renderCommPanePreview(')],
    ['Comm pane helpers', between(APP, 'function renderCommPanePreview(', '// ═══════════════════════════════════════════════════════════════════════\n// PAUSED-LEAGUE BANNER')],
    ['Comm pager binder', between(APP, "} else if (tab === 'commissioner') {", '} catch (e) { console.warn(\'[nav-gestures] per-tab gesture rebind failed\'')],
    ['wizard native navigation', between(APP, 'W-70 (2026-10-14) - NATIVE NAVIGATION IN THE WIZARD', 'export const _wizardPagerForTest')],
  ];
  for (const [name, src] of blocks) {
    const code = stripComments(src);
    assert(src.length > 200 && !/state\.currentTab\s*=[^=]/.test(code) && !/dataset\.tab\s*=[^=]/.test(code), `E-3: ${name} - never assigns state.currentTab or the body’s tab (T-27 / DI-W70.5)`);
    const navs = [...code.matchAll(/navigateTo\(([^)]*)\)/g)].map((m) => m[1].trim());
    assert(navs.every((n) => n === "'commissioner'"), `E-3b: ${name} - navigateTo is only ever called for the Comm page itself (${JSON.stringify(navs)})`);
  }
  // E-4: the swap picker in all three lists
  const f1 = between(NGSRC, 'export function gesturesSuspended(', 'export function isKeyboardUp()');
  const f2 = between(CCSRC, 'function isBlockedByOtherSurface()', 'export function bindControlCenterEdgeSwipe(');
  const f3 = between(APP, 'function _dismissBlockingSurfaceUp(', 'export const _dismissBlockingSurfaceUpForTest');
  assert([f1, f2, f3].every((f) => f.includes("'swap-picker-sheet-wrap'")), 'E-4: #swap-picker-sheet-wrap joins gesturesSuspended(), the drawer’s isBlockedByOtherSurface() and _dismissBlockingSurfaceUp() (DI-W70.4)');
  // E-5: the drawer's scroller selector is the one the Game Day branch edits: this batch adds no entry (.comm-tabbar is already in it) and the list only GROWS - the four entries that existed
  // before Game Day (and the Comm strip among them) must all still be there, whatever else a later branch added.
  const hscroll = /DRAWER_HSCROLL_SELECTOR = '([^']*)'/.exec(NGSRC);
  const entries = hscroll ? hscroll[1].split(',').map((x) => x.trim()) : [];
  assert(entries.length >= 4 && ['.chat-pills-scroll', '.dashboard-scroll', '.comm-tabbar', '.batch-grid-scroll'].every((e) => entries.includes(e)) && entries.filter((e) => e === '.comm-tabbar').length === 1,
    `E-5: DRAWER_HSCROLL_SELECTOR still holds the original four entries, the Comm strip (.comm-tabbar) once among them - this batch added none; later branches may add theirs (${entries.length} entries)`);
  // E-6: autosave controls marked
  for (const id of ['wiz-tb-game', 'wiz-ep-enabled', 'wiz-tb-question', 'wiz-reminder-cadence', 'wiz-reminder-cooldown']) {
    const i = APP.indexOf(id === 'wiz-ep-enabled' ? "id: 'wiz-ep-enabled'" : `id="${id}"`);
    const near = APP.slice(Math.max(0, i - 120), i + 200);
    assert(i > 0 && near.includes('data-wiz-autosave'), `E-6: #${id} saves on change and carries data-wiz-autosave (so it can never read as an unsaved edit)`);
  }
  // E-7: the Comm binder is wired inside the per-tab gesture rebind next to Picks / Dashboard
  const rebind = between(APP, "if (tab === 'picks') {\n      bindWeekSwipe(document.getElementById('page-picks')", '} catch (e) { console.warn(\'[nav-gestures] per-tab gesture rebind failed\'');
  assert(rebind.includes("tab === 'dashboard'") && rebind.includes("tab === 'commissioner'") && rebind.includes('isPagerYieldTarget') && rebind.includes('navigateRepaints: false') && rebind.includes('decorateOutgoing'),
    'E-7: the Comm pager is bound in the same per-page rebind as Picks and Dashboard, with the pager-side yield, no own-page repaint skip and the exit-layer trim');
}


// ==============================================================================================================================================================================================
_log('\n[F] THE REAL APP - js/app.js through minidom: the Comm pager, the tab tap and swipe, the wizard’s ask, the step pager…');
// ==============================================================================================================================================================================================
const { MiniDocument, MiniElement, MiniText } = await import('./minidom.mjs');
if (typeof MiniElement.prototype.cloneNode !== 'function') {
  MiniElement.prototype.cloneNode = function cloneNode(deep) {
    const c = this.ownerDocument.createElement(this.localName);
    for (const [k, v] of this._attrs) c._attrs.set(k, v);
    if (deep) for (const k of this._children) c.appendChild(k.nodeType === 3 ? new MiniText(k.data) : k.cloneNode(true));
    return c;
  };
}
// minidom's dataset proxy has no deleteProperty trap, so `delete el.dataset.x` (which the gesture engine uses to clear its animating state) silently does nothing there; supplied here, the
// insertAdjacentHTML / cloneNode precedent (minidom.mjs itself is not edited).
{
  const kebab = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  Object.defineProperty(MiniElement.prototype, 'dataset', { configurable: true, get() {
    const el = this;
    return new Proxy({}, {
      get: (_, k) => (typeof k === 'string' && el._attrs.has('data-' + kebab(k)) ? el._attrs.get('data-' + kebab(k)) : undefined),
      set: (_, k, v) => { el._attrs.set('data-' + kebab(k), String(v)); return true; },
      has: (_, k) => el._attrs.has('data-' + kebab(String(k))),
      deleteProperty: (_, k) => { el._attrs.delete('data-' + kebab(String(k))); return true; },
      ownKeys: () => [...el._attrs.keys()].filter((k) => k.startsWith('data-')).map((k) => camel(k.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (el._attrs.has('data-' + kebab(String(k))) ? { enumerable: true, configurable: true, value: el._attrs.get('data-' + kebab(String(k))) } : undefined),
    });
  } });
}
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
globalThis.matchMedia = () => ({ matches: false });
globalThis.innerWidth = 390; globalThis.innerHeight = 800; globalThis.scrollY = 0; globalThis.scrollX = 0;
const scrolls = [];
globalThis.scrollTo = (...a) => { scrolls.push(a[0]); };
globalThis.fetch = async () => { throw new Error('network disabled in commpagertest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
console.warn = () => {}; console.info = () => {};
const INDEX = readFileSync(here('./index.html'), 'utf8');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const d = new MiniDocument(); d.body.innerHTML = bodyHtmlOf(INDEX); return d; };
globalThis.document = freshDoc();
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');

const WK = 'wk_cp';
function seedDraft({ games = 3, blurb = '' } = {}) {
  store.clear(); globalThis.document = freshDoc();
  storage.setSession(null, true, false);
  const wk = { ...dm.createWeek('2026', 5, '2026-10-17', '2026-10-18'), weekId: WK, status: 'draft', blurb };
  storage.saveWeek(wk); storage.setActiveWeekId(WK);
  const base = new Date(Date.now() + 3 * 86400000).toISOString();
  for (let i = 0; i < games; i++) storage.saveGame({ ...dm.createGame(WK, { homeTeam: 'Home ' + i, awayTeam: 'Away ' + i, kickoff: base, spread: null, kickoffConfirmed: true }), gameId: 'g' + i });
}
const q = (sel) => document.querySelector(sel);
const body = () => document.getElementById('week-wizard-body');
const wiz = () => document.getElementById('week-wizard-sheet-wrap');
const stepNow = () => { const m = /Step (\d+) of/.exec(norm(document.getElementById('week-wizard-step-tracker')?.textContent)); return m ? Number(m[1]) : null; };
const toasts = () => [...document.querySelectorAll('#toast-container .toast')].map((t) => norm(t.textContent));
const layerUp = () => document.getElementById('ls-action-layer');
const layerTitle = () => norm(layerUp()?.querySelector('.lc-as-ttl')?.textContent);
const fire = (el, type, x = 0, y = 0, target = null) => el.dispatchEvent({ type, touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }], target: target || el });
const finish = (el) => { el.dispatchEvent({ type: 'transitionend', target: el, bubbles: false }); };
/** A horizontal swipe delivered to `root` (the element the page bound), starting on `target`. Returns after the engine's slide is finished. */
const swipe = (root, dx, target = null, { y = 300, x0 = 200, hold = false, noFinish = false } = {}) => {
  fire(root, 'touchstart', x0, y, target);
  fire(root, 'touchmove', x0 + dx / 2, y, target); fire(root, 'touchmove', x0 + dx, y, target);
  if (hold) return;
  fire(root, 'touchend', x0 + dx, y, target);
  if (!noFinish) finish(root);
};
const openWizardDraft = () => { app._openWeekWizardSheetForTest(); return body(); };
const click = (sel) => { const el = body()?.querySelector(sel); if (el) el.click(); return !!el; };
const setVal = (sel, v) => { const el = body()?.querySelector(sel); if (el) el.value = String(v); return !!el; };
const closeAll = () => { document.getElementById('week-wizard-close')?.click(); layerUp()?.querySelector('[data-ls-action="discard"]')?.click(); };

// -- F-1 .. F-6: the Comm pager and the one tab switch ------------------------------------------------------------------------------------------------------------------------------------------
{
  seedDraft();
  const commRoot = document.getElementById('page-commissioner');
  assert(commRoot.listenerCount('touchstart') === 0, 'F-1a: (fixture) before anything navigates there, the Comm page has no touch listeners');
  globalThis.navigateTo('commissioner');
  assert(commRoot.listenerCount('touchstart') === 1 && commRoot.listenerCount('touchmove') === 1 && commRoot.listenerCount('touchend') === 1 && commRoot.listenerCount('touchcancel') === 1,
    'F-1b: P-2 - the tab pager is armed by the page’s OWN navigateTo(\'commissioner\'), not by a test calling the binder (touchstart/move/end/cancel on #page-commissioner)');
  globalThis.navigateTo('commissioner');
  assert(commRoot.listenerCount('touchstart') === 1, 'F-1c: …and a second visit does not bind a second set (the engine’s per-root guard): one swipe moves ONE tab');
  const tabs = () => [...commRoot.querySelectorAll('.comm-tab')];
  assert(tabs().length === 5 && commRoot.getAttribute('data-comm-active') === 'week', `F-1d: (fixture) five tabs, Week active (${tabs().length})`);
  const mark = document.createElement('i'); mark.id = 'mk'; commRoot.querySelector('[data-comm-tab="week"]').appendChild(mark);
  const activeBtn = () => tabs().find((b) => b.classList.contains('active'))?.dataset.commTabBtn;
  const inner = commRoot.querySelector('.admin-section-title') || commRoot.querySelector('.admin-section');   // ordinary page body (NOT the tab strip)
  swipe(commRoot, -160, inner, { noFinish: true });
  assert(commRoot.getAttribute('data-comm-active') === 'games' && activeBtn() === 'games' && commRoot.getAttribute('data-comm-instant') === 'true',
    `F-2a: a left swipe goes Week → Games through the real binder: flag "${commRoot.getAttribute('data-comm-active')}", strip "${activeBtn()}", instant-switch flag "${commRoot.getAttribute('data-comm-instant')}"`);
  finish(commRoot);
  assert(commRoot.getAttribute('data-comm-instant') === null, `F-2e: N-7 - the instant-switch flag lives for the slide only: when the slide ends the engine clears it (instant "${commRoot.getAttribute('data-comm-instant')}")`);
  assert(document.body.dataset.tab !== 'chat' && document.body.dataset.tab !== 'home' && (document.body.dataset.tab === 'commissioner' || document.body.dataset.tab === undefined),
    `F-2b: the BOTTOM tab did not move (body tab "${document.body.dataset.tab}") - T-27`);
  assert(mark.isConnected && commRoot.querySelector('#mk') === mark, 'F-2c: nothing re-rendered: the node we planted is the same node');
  assert(scrolls.at(-1) && scrolls.at(-1).behavior === 'instant' && scrolls.at(-1).top === 0, `F-2d: a swipe scrolls to the top INSTANTLY (nothing may glide vertically under the sideways slide): ${JSON.stringify(scrolls.at(-1))}`);
  const rulesBtn = tabs().find((b) => b.dataset.commTabBtn === 'rules');
  rulesBtn.click();
  assert(commRoot.getAttribute('data-comm-active') === 'rules' && activeBtn() === 'rules' && commRoot.getAttribute('data-comm-instant') === null,
    `F-3a: a TAP goes through the same function: tab, strip, and the instant-switch flag is CLEARED (the tap keeps its fade-in): flag "${commRoot.getAttribute('data-comm-active')}", instant "${commRoot.getAttribute('data-comm-instant')}"`);
  assert(scrolls.at(-1) && scrolls.at(-1).behavior === 'smooth' && scrolls.at(-1).top === 0, `F-3b: …and scrolls to the top smoothly, as it always did: ${JSON.stringify(scrolls.at(-1))}`);
  assert(app.setCommTab('nope', { source: 'swipe' }) === false && commRoot.getAttribute('data-comm-active') === 'rules', 'F-3c: an unknown key changes nothing');
  // bounds
  swipe(commRoot, -160, inner); swipe(commRoot, -160, inner);       // rules -> scribe -> (bound)
  assert(commRoot.getAttribute('data-comm-active') === 'scribe', 'F-4a: rules → scribe');
  swipe(commRoot, -160, inner, { noFinish: true });
  assert(commRoot.getAttribute('data-comm-active') === 'scribe' && commRoot.dataset.weekSwipeAnimating === 'bounce', 'F-4b: a left swipe at SCRIBE (the last tab) rubber-bands: no change, a spring-back');
  finish(commRoot);
  swipe(commRoot, 160, inner, { x0: 150 });
  assert(commRoot.getAttribute('data-comm-active') === 'rules', 'F-4c: a rightward swipe from x 150 (outside the left quarter of 390) goes to the previous tab');
  // the drawer rule: the left quarter yields
  swipe(commRoot, 160, inner, { x0: 40 }); finish(commRoot);
  assert(commRoot.getAttribute('data-comm-active') === 'rules', 'F-4d: a rightward swipe that STARTS in the left quarter (x 40 of 390) changes no tab - it is the Control Center’s');
  // a field keeps its touch
  const field = document.createElement('input'); field.type = 'text'; commRoot.querySelector('[data-comm-tab="rules"]').appendChild(field);
  swipe(commRoot, -160, field);
  assert(commRoot.getAttribute('data-comm-active') === 'rules' && commRoot.dataset.weekSwipeAnimating === undefined, `F-4e: a swipe that starts on a text field changes no tab and bounces nothing (tab "${commRoot.getAttribute('data-comm-active')}", animating "${commRoot.dataset.weekSwipeAnimating}")`);
  swipe(commRoot, -160, commRoot.querySelector('.comm-tabbar'));
  assert(commRoot.getAttribute('data-comm-active') === 'rules', 'F-4f: …nor one that starts on the tab strip');

  // the preview and the exit layer (the engine's, through the page's own preview function)
  fire(commRoot, 'touchstart', 300, 300, inner); fire(commRoot, 'touchmove', 240, 300, inner); fire(commRoot, 'touchmove', 160, 300, inner);
  const layer = commRoot.querySelector('.week-swipe-incoming-layer');
  const pane = layer && layer.querySelector('.comm-pane');
  assert(!!layer && !!pane && pane.getAttribute('data-comm-pane') === 'scribe' && layer.hasAttribute('inert'), `F-5a: mid-drag the NEXT tab (SCRIBE) is drawn in an inert layer (pane "${pane?.getAttribute('data-comm-pane')}")`);
  const secs = pane ? [...pane.querySelectorAll('.admin-section[data-comm-tab]')].map((e) => e.getAttribute('data-comm-tab')) : [];
  assert(secs.length > 0 && secs.every((t) => t === 'scribe'), `F-5b: …holding ONLY that tab’s sections (${JSON.stringify([...new Set(secs)])}), plus the heading and the strip (${!!pane?.querySelector('.comm-tabbar')})`);
  assert(pane && pane.querySelectorAll('[id]').length === 0 && pane.querySelectorAll('[name]').length === 0, 'F-5c: …with no ids and no radio names in the copy');
  assert(pane && [...pane.querySelectorAll('.comm-tab')].filter((b) => b.classList.contains('active')).map((b) => b.dataset.commTabBtn).join() === 'scribe', 'F-5d: …and SCRIBE marked active in its copy of the strip');
  // P-2: a repaint arriving mid-drag is parked; it runs when the touch ends
  globalThis.navigateTo('commissioner');
  fire(commRoot, 'touchend', 160, 300, inner); finish(commRoot);
  assert(commRoot.getAttribute('data-comm-active') === 'scribe' && commRoot.dataset.weekSwipeAnimating === undefined, `F-5e: released: the swipe commits to SCRIBE and settles (tab "${commRoot.getAttribute('data-comm-active')}", animating "${commRoot.dataset.weekSwipeAnimating}")`);
  // exit layer: trimmed to the tab that was showing
  seedDraft(); globalThis.navigateTo('commissioner');
  const root2 = document.getElementById('page-commissioner');
  root2.querySelector('[data-comm-tab-btn="week"]').click();
  fire(root2, 'touchstart', 300, 300, root2.querySelector('.admin-section-title') || root2.querySelector('.admin-section')); fire(root2, 'touchmove', 240, 300); fire(root2, 'touchmove', 160, 300);
  let exitSeen = null;
  const origInsert = root2.parentNode.insertBefore.bind(root2.parentNode);
  root2.parentNode.insertBefore = (node, ref) => { if (String(node.className).includes('week-swipe-exit-layer')) exitSeen = { pane: node.getAttribute('data-comm-pane'), cls: node.className, secs: [...new Set([...node.querySelectorAll('.admin-section[data-comm-tab]')].map((e) => e.getAttribute('data-comm-tab')))], all: node.querySelectorAll('.admin-section[data-comm-tab]').length }; return origInsert(node, ref); };
  fire(root2, 'touchend', 160, 300); finish(root2);
  root2.parentNode.insertBefore = origInsert;
  assert(exitSeen && exitSeen.pane === 'week' && exitSeen.secs.length === 1 && exitSeen.secs[0] === 'week' && exitSeen.all > 0, `F-5f: the OUTGOING layer is trimmed to the tab that was showing (Week): ${JSON.stringify(exitSeen)}`);
}

// -- F-6: P-2 / P-3 on the Comm repaint hold ------------------------------------------------------------------------------------------------------------------------------------------------------
{
  seedDraft(); globalThis.navigateTo('commissioner');
  const root = document.getElementById('page-commissioner');
  root.querySelector('[data-comm-tab-btn="week"]').click();                // the app's tab state outlives a reseed: start on Week
  const mk = document.createElement('i'); mk.id = 'hold-mk'; root.querySelector('[data-comm-tab="week"]').appendChild(mk);
  const tgt = root.querySelector('.admin-section-title') || root.querySelector('.admin-section');
  swipe(root, -160, tgt, { hold: true });                                 // the pager has claimed the touch: the finger is DOWN
  assert(touchClaimedBy() === 'week-swipe', `F-6a: (fixture) a real swipe has claimed the touch (owner ${touchClaimedBy()})`);
  globalThis.navigateTo('commissioner');                                  // the page’s own repaint path
  assert(mk.isConnected && root.querySelector('#hold-mk') === mk, 'F-6b: P-2 - a repaint requested under the finger is PARKED: the node under it is untouched');
  fire(root, 'touchend', 40, 300, tgt); finish(root);
  assert(!root.querySelector('#hold-mk') && root.getAttribute('data-comm-active') === 'games', `F-6c: …and runs when the touch ends - the page is repainted ONCE, on the tab the swipe committed to ("${root.getAttribute('data-comm-active')}")`);
  // P-3: a refused-style hold - a NEW touch right after still works
  swipe(root, -160, tgt);
  assert(root.getAttribute('data-comm-active') === 'players', `F-6d: P-3 - the very next swipe after a hold is accepted (Games → ${root.getAttribute('data-comm-active')})`);
  // P-3: a repaint parked, then a NEW touch lands before the old release-flush ran its course
  swipe(root, -160, tgt, { hold: true });
  globalThis.navigateTo('commissioner');
  fire(root, 'touchstart', 300, 300, tgt);       // a stale claim is cleared by the next touch
  fire(root, 'touchmove', 200, 300); fire(root, 'touchmove', 100, 300);
  fire(root, 'touchend', 100, 300); finish(root);
  assert(['rules', 'scribe'].includes(root.getAttribute('data-comm-active')), `F-6e: P-3 - a new touch that lands while a repaint is parked under a lost release still pages (tab "${root.getAttribute('data-comm-active')}")`);
}

// -- F-7 .. : the wizard's ask on every close path ----------------------------------------------------------------------------------------------------------------------------------------
{
  seedDraft();
  openWizardDraft();
  assert(!!wiz() && !!body() && stepNow() !== null, `F-7a: (fixture) the wizard opens on a draft week (Step ${stepNow()})`);
  assert(!!document.getElementById('week-wizard-pager') && document.getElementById('week-wizard-pager').parentNode.className.includes('wiz-pager-clip') && document.getElementById('week-wizard-pager').contains(body()),
    'F-7b: the body sits in a pane inside a clip (the structure the pager needs); the sheet’s other children are unchanged');
  assert(app._wizardHasUnsavedEditsForTest() === false, 'F-7c: freshly painted - no unsaved edits');
  // clean: the ✕, the backdrop and a dismissing swipe all close without a question
  document.getElementById('week-wizard-close').click();
  assert(!wiz() && !layerUp(), 'F-7d: with nothing unsaved the ✕ closes at once, no question');
  openWizardDraft(); wiz().querySelector('.chat-sheet-backdrop').click();
  assert(!wiz() && !layerUp(), 'F-7e: …and so does the backdrop');
  // get to Step 4 (timing fields) and type
  openWizardDraft();
  let guard = 0; while (stepNow() !== 4 && guard++ < 6) { if (stepNow() < 4) click(`#wiz-step${stepNow()}-next`); else click(`#wiz-step${stepNow()}-back`); }
  assert(stepNow() === 4, `F-8a: (fixture) at Step 4 (${stepNow()})`);
  const field = body().querySelector('#wiz-auto-lock-offset');
  field.focus();
  field.dispatchEvent({ type: 'focusin', target: field });
  field.value = '45';
  assert(app._wizardHasUnsavedEditsForTest() === true, 'F-8b: a typed Lock offset is an unsaved edit');
  document.getElementById('week-wizard-close').click();
  assert(!!wiz() && !!layerUp() && layerTitle() === 'Discard changes?', `F-8c: the ✕ with an edit does NOT close: it raises the app’s own "Discard changes?" sheet (sheet up ${!!wiz()}, title "${layerTitle()}")`);
  assert(norm(layerUp().querySelector('.lc-as-msg')?.textContent) === "You have changes on this step that haven't been saved." && norm(layerUp().querySelector('.lc-as-danger')?.textContent) === 'Discard Changes' && norm(layerUp().querySelector('.lc-as-bold')?.textContent) === 'Keep Editing',
    'F-8d: …with the DI’s message, a destructive "Discard Changes" and a bold "Keep Editing"');
  layerUp().querySelector('[data-ls-action="keep-editing"]').click();
  assert(!layerUp() && !!wiz() && document.activeElement === field && field.value === '45', `F-8e: Keep Editing closes the question, keeps the sheet and the typed value, and hands focus back to the field (focus on ${document.activeElement?.id})`);
  wiz().querySelector('.chat-sheet-backdrop').click();
  assert(!!wiz() && !!layerUp(), 'F-8f: the backdrop asks too');
  layerUp().querySelector('.lc-scrim').click();
  assert(!layerUp() && !!wiz(), 'F-8g: a tap on the question’s own scrim is Keep Editing (the safe choice)');
  document.getElementById('week-wizard-close').click();
  layerUp().querySelector('[data-ls-action="discard"]').click();
  assert(!wiz() && !layerUp(), 'F-8h: Discard Changes closes the sheet');
  // an autosave control never counts
  openWizardDraft();
  guard = 0; while (stepNow() !== 6 && guard++ < 10) { if (stepNow() === 5) { setVal('#wiz-blurb-body', 'A fine blurb for the week.'); } click(`#wiz-step${stepNow()}-next`); }
  const tb = body()?.querySelector('#wiz-tb-question');
  if (tb) { tb.value = 'Total points in the late game?'; }
  assert(!!tb && app._wizardHasUnsavedEditsForTest() === false, `F-9: Step 6’s tiebreaker question saves on change, so editing it is NOT an unsaved edit (Step ${stepNow()})`);
  closeAll();
}

// -- F-9b: unsaved edits are found on EVERY step's controls (DI-W70.1), with no per-step list ----------------------------------------------------------------------------------------
{
  // Step 1 (a fresh league: no week yet, the create form)
  store.clear(); globalThis.document = freshDoc(); storage.setSession(null, true, false);
  openWizardDraft();
  assert(stepNow() === 1 && app._wizardHasUnsavedEditsForTest() === false, 'F-9b-1: (fixture) no week yet: the wizard opens on Step 1 and the freshly painted form is clean');
  const num = body().querySelector('#wiz-cw-num'); num.value = '9';
  assert(app._wizardHasUnsavedEditsForTest() === true, 'F-9b-2: Step 1 - a typed week number is an unsaved edit');
  closeAll();
  // Step 6's scheduled-open time
  seedDraft({ blurb: 'Week 5 is here, bring your A game.' });
  openWizardDraft();
  let g = 0; while (stepNow() !== 6 && g++ < 10) click(stepNow() === 1 ? '#wiz-step1-create' : `#wiz-step${stepNow()}-next`);
  click('[data-open-mode="scheduled"]');
  assert(stepNow() === 6 && app._wizardHasUnsavedEditsForTest() === false, 'F-9b-3: Step 6 with the scheduled mode chosen (that repaints) is clean again');
  const at = body().querySelector('#wiz-schedule-at'); if (at) at.value = '2030-01-01T10:00';
  assert(!!at && app._wizardHasUnsavedEditsForTest() === true, 'F-9b-4: Step 6 - a typed scheduled-open time is an unsaved edit');
  closeAll();
  // the Manage screen's announcement (an OPEN week)
  seedDraft({ blurb: 'Week 5 is here, bring your A game.' });
  storage.saveWeek({ ...storage.getWeek(WK), status: 'open' });
  openWizardDraft();
  const ann = body().querySelector('#wiz-announce-body');
  assert(!!ann && app._wizardHasUnsavedEditsForTest() === false, 'F-9b-5: (fixture) the Manage screen of an open week, its announcement box empty and clean');
  if (ann) ann.value = 'Kickoff moved to 7.';
  assert(app._wizardHasUnsavedEditsForTest() === true, 'F-9b-6: Manage - a typed announcement is an unsaved edit');
  closeAll();
}

// -- F-9c: the Finalize flow pages BACK only, and asks first with edits ---------------------------------------------------------------------------------------------------------------------
{
  store.clear(); globalThis.document = freshDoc(); storage.setSession(null, true, false);
  const FW = 'wk_fp';
  storage.savePlayer({ ...dm.createPlayer('Drew'), playerId: 'p1', almaMater: 'Texas' });
  storage.savePlayer({ ...dm.createPlayer('Kevin'), playerId: 'p2', almaMater: 'Iowa' });
  storage.saveWeek({ ...dm.createWeek('2026', 6, '2026-10-03', '2026-10-04'), weekId: FW, status: 'live', pendingFinalization: false, tiebreakerQuestion: 'Total points?', tiebreakerCalculationMode: 'allAlmaMaterGames',
    lockedAlmaMaters: ['Texas', 'Iowa'], actualTiebreakerValue: null, extraPointEnabled: false, blurb: 'Rivalry week, everybody.' });
  storage.setActiveWeekId(FW);
  storage.saveGame({ ...dm.createGame(FW, { homeTeam: 'Texas', awayTeam: 'Oklahoma', spread: -3.5 }), gameId: 'fg1', status: 'final', homeScore: 31, awayScore: 24, lockedSpread: -3.5 });
  storage.saveAllPicks([{ ...dm.createPick(FW, 'fg1', 'p1', 'Texas'), pickId: 'fpk1' }, { ...dm.createPick(FW, 'fg1', 'p2', 'Texas'), pickId: 'fpk2' }]);
  storage.setTiebreakerGuess(FW, 'p1', 70); storage.setTiebreakerGuess(FW, 'p2', 80);
  app._openWeekWizardSheetForTest();
  click('#wiz-open-finalize-btn');
  const pager = document.getElementById('week-wizard-pager');
  const title = () => norm(body()?.querySelector('.admin-section-title')?.textContent);
  assert(title() === 'Approve Scores', `F-9c-1: (fixture) Finalize Step 1 (${title()})`);
  const tg = () => body().querySelector('.admin-section-title');
  swipe(pager, 200, tg());
  swipe(pager, -200, tg());
  assert(title() === 'Approve Scores' && !document.querySelector('.week-swipe-exit-layer'), 'F-9c-2: Step 1 has no Back (its button is Cancel): a swipe either way changes nothing');
  click('#wiz-fin-next');
  assert(title() !== 'Approve Scores', `F-9c-3: (fixture) Finalize Step 2 (${title()})`);
  const st = app._wizardPagerForTest.getState();
  assert(st.weekIds.length === 2 && st.weekIds[1] === '2' && st.weekIds[0] === '1', `F-9c-4: Step 2 can page BACK to 1 and nowhere forward (${JSON.stringify(st.weekIds)}) - forward steps apply scores and finalize`);
  swipe(pager, -200, tg());
  assert(title() !== 'Approve Scores' && !document.querySelector('.week-swipe-exit-layer'), 'F-9c-5: a swipe LEFT on a Finalize step never moves it');
  setVal('#wiz-fin-tb-value', '99');
  swipe(pager, 200, tg());
  assert(layerTitle() === 'Discard changes?' && title() !== 'Approve Scores', `F-9c-6: with the tiebreaker value typed, a Back swipe springs back and asks (question "${layerTitle()}")`);
  layerUp().querySelector('[data-ls-action="discard"]').click(); finish(pager);
  assert(title() === 'Approve Scores', `F-9c-7: Discard Changes steps back to Step 1 (${title()})`);
  closeAll();
}

// -- F-9d: the other surfaces on top stand the pagers down ----------------------------------------------------------------------------------------------------------------------------
{
  seedDraft(); globalThis.navigateTo('commissioner');
  const root = document.getElementById('page-commissioner');
  root.querySelector('[data-comm-tab-btn="week"]').click();
  const tgt = root.querySelector('.admin-section-title') || root.querySelector('.admin-section');
  openWizardDraft();
  swipe(root, -160, tgt);
  assert(root.getAttribute('data-comm-active') === 'week', 'F-9d-1: with the wizard sheet open the Comm tab pager does not arm (the wizard has its own pager; DI-W70.4 row 5)');
  closeAll();
  document.body.appendChild(Object.assign(document.createElement('div'), { id: 'swap-picker-sheet-wrap' }));
  swipe(root, -160, tgt);
  assert(root.getAttribute('data-comm-active') === 'week', 'F-9d-2: …nor with the swap picker sheet up');
  document.getElementById('swap-picker-sheet-wrap').remove();
  swipe(root, -160, tgt);
  assert(root.getAttribute('data-comm-active') === 'games', 'F-9d-3: …and it arms again the moment those are gone');
}

// -- F-10: a finalize in flight refuses every close path ----------------------------------------------------------------------------------------------------------------------------------------
{
  store.clear(); globalThis.document = freshDoc();
  storage.setSession(null, true, false);
  const FW = 'wk_fin';
  storage.savePlayer({ ...dm.createPlayer('Drew'), playerId: 'p1', almaMater: 'Texas' });
  storage.savePlayer({ ...dm.createPlayer('Kevin'), playerId: 'p2', almaMater: 'Iowa' });
  storage.saveWeek({ ...dm.createWeek('2026', 6, '2026-10-03', '2026-10-04'), weekId: FW, status: 'live', pendingFinalization: false, tiebreakerQuestion: 'Total points?', tiebreakerCalculationMode: 'allAlmaMaterGames',
    lockedAlmaMaters: ['Texas', 'Iowa'], actualTiebreakerValue: null, extraPointEnabled: false, blurb: 'Rivalry week, everybody.' });
  storage.setActiveWeekId(FW);
  storage.saveGame({ ...dm.createGame(FW, { homeTeam: 'Texas', awayTeam: 'Oklahoma', spread: -3.5 }), gameId: 'fg1', status: 'final', homeScore: 31, awayScore: 24, lockedSpread: -3.5 });
  storage.saveAllPicks([{ ...dm.createPick(FW, 'fg1', 'p1', 'Texas'), pickId: 'fpk1' }, { ...dm.createPick(FW, 'fg1', 'p2', 'Texas'), pickId: 'fpk2' }]);
  storage.setTiebreakerGuess(FW, 'p1', 70); storage.setTiebreakerGuess(FW, 'p2', 80);
  app._openWeekWizardSheetForTest();
  click('#wiz-open-finalize-btn'); click('#wiz-fin-next');
  setVal('#wiz-fin-tb-value', 75); click('#wiz-fin-next');
  if (body()?.querySelector('#wiz-fin-ep-value')) click('#wiz-fin-next');
  let release = null;
  app._setFinalizeConfirmForTest(() => new Promise((r) => { release = r; }));
  click('#wiz-fin-confirm');
  assert(body()?.querySelector('#wiz-fin-confirm')?.disabled === true, 'F-10a: (fixture) the Finalize press is in flight (the button reads Finalizing… and is disabled)');
  document.getElementById('week-wizard-close').click();
  assert(!!wiz() && !layerUp() && toasts().includes('Finalizing — you can close this when it finishes.'), `F-10b: the ✕ during a finalize in flight does NOT close, raises no question, and says why in a calm toast (${JSON.stringify(toasts())})`);
  wiz().querySelector('.chat-sheet-backdrop').click();
  assert(!!wiz() && !layerUp(), 'F-10c: …nor does the backdrop');
  // the dismissing swipe: through the sheet’s own binder (touch events on the sheet)
  const sheet = document.getElementById('week-wizard-sheet');
  const header = sheet.querySelector('.chat-sheet-header');
  const dragDown = (target, y0 = 100, y1 = 500) => { fire(sheet, 'touchstart', 200, y0, target); fire(sheet, 'touchmove', 200, y0 + 40, target); fire(sheet, 'touchmove', 200, y1, target); fire(sheet, 'touchend', 200, y1, target); };
  dragDown(header);
  assert(!!wiz() && document.getElementById('week-wizard-sheet-wrap').style.getPropertyValue?.('--wizard-drag-y') !== '1' && wiz().style['--wizard-drag-y'] === '0', `F-10d: a dismissing swipe is sprung back, not slid away, and nothing closes (--wizard-drag-y "${wiz()?.style['--wizard-drag-y']}")`);
  if (release) release('saved'); await tick();
  app._setFinalizeConfirmForTest(null);
  assert(!wiz(), 'F-10e: when the finalize completes the sheet closes by itself (the flow’s own unconditional close is untouched)');
}

// -- F-11: the sheet’s swipe-down - what may start it, and what it does ---------------------------------------------------------------------------------------------------------------------------
{
  seedDraft();
  openWizardDraft();
  const sheet = document.getElementById('week-wizard-sheet');
  const header = sheet.querySelector('.chat-sheet-header');
  // The binder times the drag with Date.now(); a fake clock (a second per move) keeps the flick rule (0.3 px/ms) out of the distance cases.
  let clock = 5000; const realNow = Date.now; Date.now = () => clock;
  const dragDown = (target, y0 = 100, y1 = 500, extra = {}) => { fire(sheet, 'touchstart', 200, y0, target); clock += 1000; fire(sheet, 'touchmove', 200, y0 + 40, target); clock += 1000; fire(sheet, 'touchmove', 200, y1, target); if (!extra.hold) fire(sheet, 'touchend', 200, y1, target); };
  assert(sheet.listenerCount('touchstart') === 1 && header.listenerCount('touchstart') === 0, 'F-11a: P-2 - the swipe-down is armed by the page’s own open, on the WHOLE sheet (not the header alone), on the web app (no native shell)');
  const rowTarget = body().querySelector('button') || body().firstElementChild;
  // body at scroll-top: claimed
  body().scrollTop = 0;
  dragDown(rowTarget, 100, 220, { hold: true });
  assert(sheet.getAttribute('data-dragging') === 'true' && Number(wiz().style['--wizard-drag-y']) > 0, `F-11b: a drag that starts on the BODY at scroll-top follows the finger (data-dragging ${sheet.getAttribute('data-dragging')}, drag-y ${wiz().style['--wizard-drag-y']}) - and the stylesheet’s body lock keys on that attribute`);
  fire(sheet, 'touchend', 200, 220, rowTarget);
  assert(!!wiz() && wiz().style['--wizard-drag-y'] === '0' && !sheet.hasAttribute('data-dragging'), `F-11c: a short release springs back and clears the attribute (wiz ${!!wiz()}, drag-y "${wiz()?.style['--wizard-drag-y']}", dragging ${sheet.hasAttribute('data-dragging')})`);
  // body scrolled down: not ours
  body().scrollTop = 120;
  const before = wiz().style['--wizard-drag-y'];
  dragDown(rowTarget, 100, 500);
  assert(!!wiz() && wiz().style['--wizard-drag-y'] === before, `F-11d: a body scrolled down scrolls instead: the same drag does not move the sheet (drag-y ${wiz()?.style['--wizard-drag-y']})`);
  body().scrollTop = 0;
  // a text field keeps its touch
  const inputEl = document.createElement('input'); inputEl.type = 'text'; body().appendChild(inputEl);
  dragDown(inputEl, 100, 500);
  assert(!!wiz() && wiz().style['--wizard-drag-y'] === '0', 'F-11e: a drag that starts on a text field never dismisses');
  // upward first: a scroll
  fire(sheet, 'touchstart', 200, 400, rowTarget); fire(sheet, 'touchmove', 200, 360, rowTarget); fire(sheet, 'touchmove', 200, 500, rowTarget); fire(sheet, 'touchend', 200, 500, rowTarget);
  assert(!!wiz() && !sheet.hasAttribute('data-dragging'), 'F-11f: a drag whose first movement goes UP is a scroll: nothing is claimed, even if the finger comes back down');
  // side panel
  globalThis.innerWidth = 800;
  dragDown(header, 100, 600);
  globalThis.innerWidth = 390;
  assert(!!wiz() && wiz().style['--wizard-drag-y'] === '0', 'F-11g: at 800 px wide (the side panel) the swipe-down is not armed');
  // header, clean: dismisses (slides away, then closes)
  dragDown(header, 100, 600);
  await new Promise((r) => setTimeout(r, 460));            // finishSlideThenRemove’s bounded fallback (no transitionend in minidom)
  assert(!wiz(), 'F-11h: a clean sheet dismissed from the header slides away and closes');
  // dirty: springs back and asks
  Date.now = realNow;
  openWizardDraft();
  let g2 = 0; while (stepNow() !== 4 && g2++ < 6) { if (stepNow() < 4) click(`#wiz-step${stepNow()}-next`); else click(`#wiz-step${stepNow()}-back`); }
  setVal('#wiz-auto-lock-offset', '99');
  const sheet2 = document.getElementById('week-wizard-sheet');
  const h2 = sheet2.querySelector('.chat-sheet-header');
  fire(sheet2, 'touchstart', 200, 100, h2); fire(sheet2, 'touchmove', 200, 140, h2); fire(sheet2, 'touchmove', 200, 600, h2); fire(sheet2, 'touchend', 200, 600, h2);
  assert(!!wiz() && wiz().style['--wizard-drag-y'] === '0' && layerTitle() === 'Discard changes?', `F-11i: a dirty sheet dismissed by swipe SPRINGS BACK first and asks (drag-y ${wiz()?.style['--wizard-drag-y']}, question "${layerTitle()}")`);
  layerUp()?.querySelector('[data-ls-action="discard"]')?.click();
  assert(!wiz(), 'F-11j: Discard Changes then closes it');
}

// -- F-12: the step pager through real events at the pager’s root -------------------------------------------------------------------------------------------------------------------------
{
  seedDraft();
  openWizardDraft();
  const pager = () => document.getElementById('week-wizard-pager');
  assert(pager().listenerCount('touchstart') === 1, 'F-12a: P-2 - the step pager is armed by the page’s own open of the sheet (one listener set on #week-wizard-pager)');
  const toStep = (n) => { let g = 0; while (stepNow() !== n && g++ < 8) { if (stepNow() < n) { if (stepNow() === 5) setVal('#wiz-blurb-body', 'A fine blurb for the week.'); click(stepNow() === 1 ? '#wiz-step1-create' : `#wiz-step${stepNow()}-next`); } else click(`#wiz-step${stepNow()}-back`); } return stepNow() === n; };
  const tgt = () => body().querySelector('.admin-section-title') || body().firstElementChild;
  const sw = (dx, opts = {}) => swipe(pager(), dx, opts.target || tgt(), opts);
  // the table
  const st = () => app._wizardPagerForTest.getState();
  assert(toStep(1) && JSON.stringify(st().weekIds) === '["1"]', 'F-12b: Step 1 - no neighbour either way');
  sw(-200); sw(200);
  assert(stepNow() === 1, 'F-12c: Step 1 - a swipe either way changes nothing (Create Week is the button’s)');
  assert(toStep(2) && JSON.stringify(st().weekIds) === '["1","2","3"]', 'F-12d: Step 2 with games - 1 and 3');
  sw(200); assert(stepNow() === 1, 'F-12e: Step 2 - swipe RIGHT goes back to Step 1 (the Back button’s path)');
  assert(toStep(2), 'F-12e2: (fixture) back to Step 2');
  sw(-200); assert(stepNow() === 3, 'F-12f: Step 2 - swipe LEFT goes to Step 3 (the Next button’s path)');
  sw(-200); assert(stepNow() === 4, 'F-12g: Step 3 - swipe LEFT goes to Step 4 (after Next’s own save)');
  assert(JSON.stringify(st().weekIds) === '["3","4","5"]', `F-12h: Step 4 with no blurb - back 3, forward 5 (${JSON.stringify(st().weekIds)})`);
  sw(-200); assert(stepNow() === 5, 'F-12i: Step 4 - swipe LEFT lands on 5 (no blurb yet), as the Next button does');
  // refused: an empty blurb
  const pagerEl = pager();
  sw(-200, { noFinish: true });
  assert(stepNow() === 5, 'F-13a: Step 5 with an EMPTY blurb - the swipe does not advance');
  assert(!!norm(body().querySelector('#wiz-blurb-error')?.textContent), `F-13b: …and the Next button’s own inline error appears ("${norm(body().querySelector('#wiz-blurb-error')?.textContent)}"): the refused swipe CLICKED the button, one path with the tap`);
  assert(!document.querySelector('.week-swipe-exit-layer') && pagerEl.dataset.weekSwipeAnimating === 'bounce', `F-13c: …and no slide ever played (no exit layer; the pane springs back: "${pagerEl.dataset.weekSwipeAnimating}")`);
  finish(pagerEl);
  setVal('#wiz-blurb-body', 'A fine blurb for the week.');
  sw(-200); assert(stepNow() === 6, 'F-13d: with a valid blurb the same swipe advances to Step 6');
  assert(JSON.stringify(st().weekIds) === '["5","6"]', 'F-13e: Step 6 - back only');
  sw(-200); assert(stepNow() === 6, 'F-13f: Step 6 - a swipe LEFT never opens the week (Open now, Schedule Open and Keep as draft are buttons)');
  sw(200); assert(stepNow() === 5, 'F-13g: Step 6 - swipe RIGHT goes back to Step 5');
  // a swipe from Step 4 to a week that already has a blurb lands on 6
  assert(toStep(4), 'F-13h: (fixture) at Step 4 with a saved blurb');
  assert(JSON.stringify(st().weekIds) === '["3","4","6"]', `F-13i: Step 4 with a valid blurb on the week - forward is 6, as the Next button’s ${JSON.stringify(st().weekIds)}`);
  sw(-200); assert(stepNow() === 6, 'F-13j: …and the swipe lands on 6');
  // Step 4 refusal: an Auto-Open time with no blurb
  closeAll();
  seedDraft({ blurb: '' }); openWizardDraft();
  assert(toStep(4), 'F-14a: (fixture) Step 4 on a week with no blurb');
  setVal('#wiz-picks-open-at', '2030-01-01T10:00');
  closeAll();
  openWizardDraft(); toStep(4);
  setVal('#wiz-picks-open-at', '2030-01-01T10:00');
  const canFwd4 = app._wizardPagerForTest.canCommit('5', -1);
  assert(canFwd4 === false, 'F-14b: Step 4 with an Auto-Open time typed and no blurb - the pager would be refused (the button’s inline guard)');
  sw(-200);
  assert(stepNow() === 4, 'F-14c: …and the swipe does not advance; the guard the button raises is shown');
  finish(pager());
  // Back with edits asks first
  const t2 = body().querySelector('#wiz-auto-lock-offset'); t2.value = '12';
  sw(200);
  assert(stepNow() === 4 && layerTitle() === 'Discard changes?', `F-15a: a Back swipe on a step with unsaved edits springs back and raises the SAME "Discard changes?" sheet (Step ${stepNow()}, "${layerTitle()}")`);
  layerUp().querySelector('[data-ls-action="keep-editing"]').click(); finish(pager());
  assert(stepNow() === 4 && !layerUp(), 'F-15b: Keep Editing: still Step 4');
  sw(200); layerUp()?.querySelector('[data-ls-action="discard"]')?.click(); finish(pager());
  assert(stepNow() === 3, `F-15c: Discard Changes then steps back (Step ${stepNow()}) - the Back button’s own path`);
  // a field keeps its touch; the tracker is not a field
  toStep(5);
  sw(-200, { target: body().querySelector('#wiz-blurb-body') });
  assert(stepNow() === 5 && !pager().dataset.weekSwipeAnimating, 'F-16a: a swipe that starts on the blurb field pages nothing (the field keeps its touch)');
  // the pager stands down under another surface
  document.body.appendChild(Object.assign(document.createElement('div'), { id: 'swap-picker-sheet-wrap' }));
  setVal('#wiz-blurb-body', 'A fine blurb for the week.');
  sw(-200);
  assert(stepNow() === 5, 'F-16b: with the swap picker sheet up the step pager does not arm (DI-W70.4)');
  document.getElementById('swap-picker-sheet-wrap').remove();
  // a repaint requested under the pager's hold is parked; a new touch after it works
  toStep(5);
  setVal('#wiz-blurb-body', 'A fine blurb for the week.');
  const mk = document.createElement('i'); mk.id = 'wmk'; body().appendChild(mk);
  sw(-200, { hold: true });
  assert(touchClaimedBy() === 'week-swipe', 'F-17a: (fixture) the step pager owns the touch');
  app._wizardPagerForTest.repaint();
  assert(mk.isConnected && body().contains(mk) && stepNow() === 5, 'F-17b: P-2 - a repaint requested under the finger is PARKED: the node under it is untouched, the step has not changed');
  fire(pager(), 'touchend', 0, 300); finish(pager());
  assert(stepNow() === 6 && !body().contains(mk), `F-17c: …the release commits (Step ${stepNow()}), and the sheet is painted once, consistently (the parked repaint is redundant: the step change repainted it)`);
  sw(200);
  assert(stepNow() === 5, `F-17d: P-3 - the very next swipe after the hold is accepted (Step ${stepNow()})`);
  // P-3: a refused swipe's spring-back, then a new touch
  setVal('#wiz-blurb-body', '');
  sw(-200, { noFinish: true });
  assert(stepNow() === 5 && pager().dataset.weekSwipeAnimating === 'bounce', 'F-17e: (fixture) a refused swipe is springing back');
  setVal('#wiz-blurb-body', 'A fine blurb for the week.');
  sw(-200);
  assert(stepNow() === 6, `F-17f: P-3 - a NEW swipe landing during that spring-back ends it and works (Step ${stepNow()})`);
  closeAll();
}


_log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
