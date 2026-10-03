/**
 * CFB Pickems — sectiondragtest.mjs
 * ==================================
 * SP-57 (Social Platform, 2026-09-30) — js/section-drag.js, the long-press SECTION DRAG ENGINE.
 * DI-475 / DI-476 / DI-385 / DI-386, acceptance tests AT1-AT21 AS FAR AS THE ENGINE CAN PROVE THEM HEADLESSLY.
 *
 * WHAT THIS SUITE IS, AND IS NOT. Node only: no browser, no CDP, no app.js. Every DECISION in the engine is a pure
 * function and is tested to exhaustion here (the press gate, the eligibility predicate, the drop-target math, the
 * auto-scroll curve, the focus rule). The DOM binder is driven through a fake DOM + fake clock with the REAL
 * nav-gestures claim model underneath (claimTouch / releaseTouch / touchClaimedBy are not stubbed), so the one-owner-
 * per-touch contract is exercised for real. The engine-measured half of AT1-AT21 (real `Input.dispatchTouchEvent`
 * against the real app.js, the real stylesheet and WebKit-shaped scroll) cannot exist until app.js is wired; it is the
 * wiring step's sectiondragtest section [E] (named, not written here). Nothing in this file is a claim about iOS.
 *
 * Run: node sectiondragtest.mjs        (run under TZ=UTC and TZ=America/Los_Angeles: nothing here reads the clock's zone)
 *
 * SECTIONS
 *   1  constants, copy, the 350-vs-500 pin (AT5, source-level half)
 *   2  isSectionHandle: the ten title rows, controls, draggable pills, thirteen body kinds (AT2/AT3/AT4 predicate)
 *   3  pressStep: every arm / cancel / fire rule (AT2, AT6 reducer half)
 *   4  drop-target logic: slotLayout / nearestSlot / slotShifts, tall sections, hysteresis, ties, properties (AT10)
 *   5  dragStep + dragView: lift / move / scroll / remeasure / release / cancel / settled
 *   6  auto-scroll: the ramp, the cap, the accumulator, the ends, the options (AT8, AT20 engine half)
 *   7  the assistive path's logic and the live region (DI-386; AT13-AT15 logic half)
 *   8  the binder through a fake DOM: lift order, pills, body holds, cancels, claims, mouse, drag, drop, deferral,
 *      Done / Reset / Escape, edit-mode drags, settle interruption, geometry re-measure, listener confinement,
 *      detach, Reduce Motion, error safety (AT1-AT3, AT5-AT12, AT17-AT20 engine halves)
 *   9  structure: the module's imports and top-level purity, the blind rule's surface
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('\n[section-drag] SP-57 — the long-press section drag engine (DI-475 / 476 / 385 / 386)\n');

const NG = await import('./js/nav-gestures.js');
const SD = await import('./js/section-drag.js');
const {
  SECTION_LONG_PRESS_MS, SECTION_DRAG_TOUCH_OWNER, SECTION_PRESS_SLOP_PX, SECTION_EDIT_DRAG_SLOP_PX, PRESS_TINT_DELAY_MS, SCROLL_QUIET_MS,
  SCROLL_DRIFT_PX, SYNTHETIC_MOUSE_WINDOW_MS, SLOT_HYSTERESIS_PX, EDGE_ZONE_PX, AUTOSCROLL_MAX_PPS, AUTOSCROLL_MAX_PPS_REDUCED,
  AUTOSCROLL_DT_CAP_MS, LIFT_MS, SETTLE_MS, LIFT_SCALE, EDIT_BAR_H, LIVE_ANNOUNCE_DELAY_MS, CLICK_SWALLOW_MS,
  SCROLL_INTO_VIEW_TOP_PAD_PX, SCROLL_INTO_VIEW_ALIGN_PX,
  SECTION_DRAG_CONSTANTS, SECTION_DRAG_COPY, movedAnnouncement,
  isSectionHandle, shouldBlockTouchMove, initialPressState, pressStep,
  inferGap, slotLayout, clampTitleTop, nearestSlot, slotShifts, untransformedGeometry,
  initialDragState, dragStep, dragView, liftTransform, shiftTransform,
  autoScrollEdges, autoScrollSpeed, autoScrollStep, autoScrollOptions, scrollIntoViewPlan, visibleHeaderBottom, safeTopOf, scrollWindow,
  moveButtonStates, chooseFocusDirection, ensureLayoutLive, announceLayout, focusLayoutTarget, syncGrips, scrollSectionIntoView,
  createSectionDragController,
} = SD;

// ═════════════════════════════════════════════════════════════════════════
// A tiny fake DOM, a fake clock and a fake window (compound selectors only: that is all the engine uses)
// ═════════════════════════════════════════════════════════════════════════

function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [] };
  let rest = s.trim();
  const tag = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tag) { c.tag = tag[0].toUpperCase(); rest = rest.slice(tag[0].length); }
  while (rest.length) {
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) c.id = m[1];
    else if ((m = /^\.([\w-]+)/.exec(rest))) c.classes.push(m[1]);
    else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) c.attrs.push({ name: m[1], value: m[2] ?? null });
    else throw new Error('fake selector engine cannot parse: ' + s);
    rest = rest.slice(m[0].length);
  }
  return c;
}
function matchesSel(el, sel) {
  if (!el || !el.attrs) return false;
  return sel.split(',').some((part) => {
    const c = parseCompound(part);
    if (c.tag && el.tagName !== c.tag) return false;
    if (c.id && el.getAttribute('id') !== c.id) return false;
    if (!c.classes.every((k) => el.classList.contains(k))) return false;
    return c.attrs.every((a) => (a.value === null ? el.hasAttribute(a.name) : el.getAttribute(a.name) === a.value));
  });
}
function parseTransform(t) {
  const m = /translate3d\(0px, (-?[\d.]+)px, 0px\)/.exec(t || '');
  const s = /scale\(([\d.]+)\)/.exec(t || '');
  return { dy: m ? Number(m[1]) : 0, scale: s ? Number(s[1]) : 1 };
}

class FEl {
  constructor(tag, attrs = {}, doc = null) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    this.children = [];
    this.parentNode = null;
    this.listeners = [];
    this.style = {};
    this.layout = { top: 0, height: 0, fixed: false };
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = attrs.disabled === true;
    this.ownerDocument = doc;
    this.focusCalls = [];
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const self = this;
    const toks = () => (self.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    return {
      add: (k) => { const t = toks(); if (!t.includes(k)) { t.push(k); self.setAttribute('class', t.join(' ')); } },
      remove: (k) => self.setAttribute('class', toks().filter((x) => x !== k).join(' ')),
      contains: (k) => toks().includes(k),
    };
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  hasAttribute(n) { return this.attrs.has(n); }
  appendChild(c) { c.parentNode = this; this.children.push(c); const adopt = (n) => { n.ownerDocument = this.ownerDocument; n.children.forEach(adopt); }; adopt(c); return c; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; } }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; }
  matches(sel) { return matchesSel(this, sel); }
  closest(sel) { for (let n = this; n && n.attrs; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(type, fn, options) {
    const o = typeof options === 'boolean' ? { capture: options } : (options || {});
    this.listeners.push({ type, fn, capture: !!o.capture, passive: !!o.passive });
  }
  removeEventListener(type, fn, options) {
    const o = typeof options === 'boolean' ? { capture: options } : (options || {});
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === !!o.capture);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  focus(...args) { this.focusCalls.push(args); if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  getBoundingClientRect() {
    let dy = 0;
    for (let n = this; n && n.attrs; n = n.parentNode) dy += parseTransform(n.style.transform).dy;
    const scale = parseTransform(this.style.transform).scale;
    const top = this.layout.top + dy - (this.layout.fixed ? 0 : this.ownerDocument.win.scrollY);
    const height = this.layout.height * scale;
    return { top, bottom: top + height, height, left: 0, right: 375, width: 375 };
  }
  get offsetHeight() { return this.layout.height; }
}

class FDoc extends FEl {
  constructor() {
    super('#document');
    this.ownerDocument = this;
    this.root = new FEl('html', {}, this);
    this.root.scrollHeight = 2200;
    this.documentElement = this.root;
    this.appendChild(this.root);
    this.body = new FEl('body', {}, this);
    this.root.appendChild(this.body);
    this.hidden = false;
    this.visibilityState = 'visible';
    this.activeElement = null;
  }
  get isConnected() { return true; }
  createElement(tag) { return new FEl(tag, {}, this); }
  getElementById(id) { return this.root.querySelectorAll('#' + id)[0] || null; }
}
function makeWin(doc) {
  const win = {
    scrollY: 0, innerHeight: 700, innerWidth: 375, listeners: [], scrollCalls: [], scrollToCalls: [], selectionCleared: 0,
    addEventListener(type, fn, options) { const o = typeof options === 'boolean' ? { capture: options } : (options || {}); this.listeners.push({ type, fn, capture: !!o.capture, passive: !!o.passive }); },
    removeEventListener(type, fn) { const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) this.listeners.splice(i, 1); },
    scrollBy(o) { this.scrollCalls.push({ ...o, at: this.clock ? this.clock.now() : 0 }); this.scrollY = Math.min(Math.max(0, this.scrollY + o.top), Math.max(0, doc.root.scrollHeight - this.innerHeight)); },
    scrollTo(o) { this.scrollToCalls.push(o); this.scrollY = o.top; },
    getSelection() { return { removeAllRanges: () => { this.selectionCleared++; } }; },
  };
  doc.win = win;
  return win;
}
/** Dispatch with capture then bubble, honouring `passive` (a passive listener's preventDefault is a no-op, as in a browser). */
function fire(doc, target, type, init = {}) {
  const ev = {
    type, target, cancelable: init.cancelable !== false, defaultPrevented: false, _stop: false, _passive: false,
    preventDefault() { if (this.cancelable && !this._passive) this.defaultPrevented = true; },
    stopPropagation() { this._stop = true; }, stopImmediatePropagation() { this._stop = true; this._imm = true; },
    ...init,
  };
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  const run = (node, capture) => {
    for (const l of [...node.listeners]) {
      if (l.type !== type || l.capture !== capture) continue;
      ev._passive = l.passive; ev.currentTarget = node;
      l.fn.call(node, ev);
      ev._passive = false;
      if (ev._imm) return;
    }
  };
  for (let i = path.length - 1; i >= 0 && !ev._stop; i--) run(path[i], true);
  for (let i = 0; i < path.length && !ev._stop; i++) run(path[i], false);
  return ev;
}
function fireWin(win, type) { for (const l of [...win.listeners]) if (l.type === type) l.fn({ type }); }

const FRAME_MS = 1000 / 60;
function makeClock() {
  let t = 5000;
  let nid = 0;
  const timers = new Map();
  const api = {
    now: () => t,
    setTimeout: (fn, ms) => { const i = ++nid; timers.set(i, { at: t + Math.max(0, ms), fn, i }); return i; },
    clearTimeout: (i) => { timers.delete(i); },
    raf: (fn) => { const i = ++nid; timers.set(i, { at: t + FRAME_MS, fn: () => fn(t), i }); return i; },
    caf: (i) => { timers.delete(i); },
    advance(ms) {
      const target = t + ms;
      for (;;) {
        let next = null;
        for (const x of timers.values()) if (x.at <= target && (!next || x.at < next.at || (x.at === next.at && x.i < next.i))) next = x;
        if (!next) break;
        timers.delete(next.i); t = next.at; next.fn();
      }
      t = target;
    },
    pending: () => timers.size,
  };
  return api;
}

// ── the world: a Dashboard-shaped container of sections, a controller wired to fakes, the REAL claim model ──
const TEN = [
  ['dash-picks', 'All Picks by Game'], ['dash-alma', 'Alma Mater Watch'], ['dash-summary', 'This Week Score Summary'], ['dash-tiebreaker', 'Tiebreaker'],
  ['stand-season', 'Season Summary'], ['stand-extrapoint', 'Extra Point Ledger'], ['stand-alma', 'Alma Mater Rankings'], ['stand-history', 'Weekly History'],
  ['stand-2025-open', '2K25 Outstanding'], ['stand-2025-record', '2K25 Historical Record'],
];
const LABELS = Object.fromEntries(TEN);

function resetClaim() { NG.clearStaleTouchClaim({ touches: [{}] }); }

function makeWorld({ ids = ['dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker'], heights = [200, 180, 240, 96], gap = 16, top0 = 100, scrollHeight = 2200, rm = false, withDefer = true, ctlOver = {} } = {}) {
  resetClaim();
  const doc = new FDoc();
  const win = makeWin(doc);
  const clock = makeClock();
  win.clock = clock;
  doc.root.scrollHeight = scrollHeight;
  const header = new FEl('div', { class: 'app-header' }, doc); header.layout = { top: 0, height: 60, fixed: true }; doc.body.appendChild(header);
  const nav = new FEl('nav', { class: 'bottom-nav' }, doc); nav.layout = { top: 640, height: 60, fixed: true }; doc.body.appendChild(nav);
  const container = new FEl('div', { id: 'page-dashboard' }, doc);
  doc.body.appendChild(container);
  const w = {
    doc, win, clock, container, ids: ids.slice(), editing: null, suspended: false, rm, repaints: 0, parked: new Map(), log: [], haptics: [], reorders: [], done: [], resets: 0, setEditingCalls: [],
    sections: [], headers: [], bodies: [],
  };
  let top = top0;
  ids.forEach((id, i) => {
    const sec = new FEl('section', { class: 'layout-section', 'data-section-id': id }, doc);
    sec.layout = { top, height: heights[i], fixed: false };
    const hdr = new FEl('div', { class: 'card-header', 'data-section-header': '' }, doc);
    hdr.layout = { top, height: 44, fixed: false };
    const title = new FEl('span', { class: 'title' }, doc);
    hdr.appendChild(title);
    const body = new FEl('div', { class: 'card-body' }, doc);
    body.layout = { top: top + 44, height: heights[i] - 44, fixed: false };
    sec.appendChild(hdr); sec.appendChild(body);
    container.appendChild(sec);
    w.sections.push(sec); w.headers.push(hdr); w.bodies.push(body);
    top += heights[i] + gap;
  });
  w.rerender = () => { w.repaints++; };
  w.liveTick = () => { if (!deferRender('dashboard', w.liveTick)) w.repaints++; };
  function deferRender(key, fn) {
    if (!withDefer) return false;
    const owner = NG.touchClaimedBy();
    if (owner !== 'section-drag' && owner !== 'week-swipe') return false;
    w.parked.set(key, fn);
    return true;
  }
  const flush = () => { const run = [...w.parked.values()]; w.parked.clear(); run.forEach((fn) => fn()); };
  const over = {
    doc, win, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, raf: clock.raf, caf: clock.caf,
    haptic: (k) => { w.haptics.push(k); w.log.push('haptic:' + k); },
    claimTouch: (o) => { w.log.push('claim:' + o); return NG.claimTouch(o); },
    suspended: () => w.suspended,
    prefersReducedMotion: () => w.rm,
    deferRender,
    releaseAndFlush: (owner) => { w.log.push('release:' + owner); NG.releaseTouch(owner); flush(); },
    gripHTML: () => '<svg class="grip"/>',
    ...ctlOver,
  };
  w.ctl = createSectionDragController(over);
  w.opts = {
    pageKey: 'dashboard', tabKey: 'dashboard', visible: () => w.ids,
    getEditing: () => w.editing === 'dashboard',
    setEditing: (p) => { w.setEditingCalls.push(p); w.editing = p; w.log.push('setEditing:' + p); },
    onReorder: (id, to) => { w.reorders.push([id, to]); w.log.push('reorder:' + id + '>' + to); },
    onReset: () => { w.resets++; },
    onDone: (moved, id, reason) => { w.done.push([moved, id, reason]); w.editing = null; },
    rerender: w.rerender,
    labelOf: (id) => LABELS[id] || id,
  };
  w.attach = () => w.ctl.attach(container, w.opts);
  w.attach();
  w.fingerId = 0;
  w.touchStart = (el, x, y, extra = []) => fire(doc, el, 'touchstart', { touches: [{ identifier: 0, clientX: x, clientY: y }, ...extra], changedTouches: [{ identifier: 0, clientX: x, clientY: y }] });
  w.touchMove = (el, x, y) => fire(doc, el, 'touchmove', { touches: [{ identifier: 0, clientX: x, clientY: y }], changedTouches: [{ identifier: 0, clientX: x, clientY: y }] });
  w.touchEnd = (el) => fire(doc, el, 'touchend', { touches: [], changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }] });
  w.touchCancel = (el) => fire(doc, el, 'touchcancel', { touches: [], changedTouches: [{ identifier: 0 }] });
  w.mouseDown = (el, x, y, button = 0) => fire(doc, el, 'mousedown', { button, clientX: x, clientY: y });
  w.mouseMove = (el, x, y) => fire(doc, el, 'mousemove', { clientX: x, clientY: y });
  w.mouseUp = (el) => fire(doc, el, 'mouseup', { clientX: 0, clientY: 0 });
  w.lifted = () => w.ctl.isLifted();
  w.titleTouch = (i) => w.headers[i].children[0];                 // the title span inside the i-th header
  w.rowY = (i) => w.headers[i].layout.top - w.win.scrollY + 22;   // viewport y of the middle of a header
  w.release = () => { NG.releaseTouch('section-drag'); };
  w.finish = () => { w.clock.advance(SETTLE_MS + 40); };           // let a settle complete
  w.destroy = () => { w.ctl.destroy(); resetClaim(); };
  return w;
}
const quietConsole = (fn) => { const orig = console.error; console.error = () => {}; try { return fn(); } finally { console.error = orig; } };

// A few body/control fixtures shared by the predicate tests.
function tree(spec, doc = new FDoc()) {
  const make = (s) => { const el = new FEl(s.tag || 'div', s.attrs || {}, doc); (s.kids || []).forEach((k) => el.appendChild(make(k))); return el; };
  return make(spec);
}
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// ═════════════════════════════════════════════════════════════════════════
// [1] constants, copy, the 350-vs-500 pin
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] constants, copy, and the 350 / 500 pin…');
{
  assert(SECTION_LONG_PRESS_MS === 500, '[1a] SECTION_LONG_PRESS_MS is 500 (Drew, "the 500s")');
  assert(SECTION_LONG_PRESS_MS !== 350, '[1b] …and is NOT the 350 ms pill / column / chat hold (AT5)');
  assert(SECTION_DRAG_TOUCH_OWNER === 'section-drag', '[1c] the repaint-deferral / claim token is "section-drag"');
  assert(SECTION_PRESS_SLOP_PX === 8 && SECTION_EDIT_DRAG_SLOP_PX === 6 && PRESS_TINT_DELAY_MS === 120 && SCROLL_QUIET_MS === 120 && SCROLL_DRIFT_PX === 2 && SYNTHETIC_MOUSE_WINDOW_MS === 600,
    '[1d] press constants: 8 px sum slop, 6 px edit-mode drag, 120 ms tint, 120 ms scroll-quiet, 2 px scroll drift, 600 ms synthetic-mouse window');
  assert(SLOT_HYSTERESIS_PX === 4 && EDGE_ZONE_PX === 72 && AUTOSCROLL_MAX_PPS === 720 && AUTOSCROLL_MAX_PPS_REDUCED === 360 && AUTOSCROLL_DT_CAP_MS === 50,
    '[1e] drag constants: 4 px hysteresis, 72 pt zones, 720 pt/s (360 under Reduce Motion), 50 ms dt cap');
  assert(LIFT_MS === 150 && SETTLE_MS === 260 && LIFT_SCALE === 1.02 && EDIT_BAR_H === 52 && LIVE_ANNOUNCE_DELAY_MS === 30 && CLICK_SWALLOW_MS === 350,
    '[1f] motion and chrome: 150 / 260 ms (inside the Principles\' 120-180 / 220-300), scale 1.02, 52 pt bar, 30 ms live delay, 350 ms swallow window');
  assert(Object.isFrozen(SECTION_DRAG_CONSTANTS) && SECTION_DRAG_CONSTANTS.SECTION_LONG_PRESS_MS === 500 && Object.keys(SECTION_DRAG_CONSTANTS).length >= 18,
    '[1g] the constants table is one frozen object carrying every value');
  assert(Object.isFrozen(SECTION_DRAG_COPY) && SECTION_DRAG_COPY.rearranging === 'Rearranging. Drag a section by its title.' && SECTION_DRAG_COPY.cancelled === 'Move cancelled.'
    && SECTION_DRAG_COPY.reset === 'Layout reset to the default.' && SECTION_DRAG_COPY.saved === 'Layout saved.', '[1h] the four spoken strings are exactly the approved copy');
  assert(movedAnnouncement({ label: 'Alma Mater Watch', n: 1, m: 4 }) === 'Alma Mater Watch moved to position 1 of 4.', '[1i] the move announcement is exactly "{Label} moved to position {n} of {m}."');
  const strings = [...Object.values(SECTION_DRAG_COPY), movedAnnouncement({ label: 'Tiebreaker', n: 2, m: 4 })];
  assert(strings.every((s) => !/\border/i.test(s)), '[1j] no spoken string contains the word "order" (UN-77 / loadtest [8d])');
  // AT5, source-level half: the three copies of the 350 group, read from the shipped files (the export lands with the wiring step).
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const lp = (text) => [...text.matchAll(/const LONG_PRESS_MS = (\d+);/g)].map((m) => Number(m[1]));
  assert(lp('const LONG_PRESS_MS = 350;').length === 1, '[1k] canary: the LONG_PRESS_MS literal scan finds a literal when one is there (the scan is not vacuous)');
  const appLp = lp(src('./js/app.js'));
  const chatLp = lp(src('./js/chat-ui.js'));
  assert(appLp.length === 1 && appLp[0] === 350, `[1l] app.js declares exactly one LONG_PRESS_MS and it is 350 (got ${JSON.stringify(appLp)}): the pill hold is untouched`);
  assert(chatLp.length === 1 && chatLp[0] === 350, `[1m] chat-ui.js declares exactly one LONG_PRESS_MS and it is 350 (got ${JSON.stringify(chatLp)})`);
  assert(appLp[0] === chatLp[0] && SECTION_LONG_PRESS_MS !== appLp[0], '[1n] the two 350s agree, and the section hold is pinned apart from them');
  // The JS durations mirror the CSS motion tokens the inline transitions name (var(--motion-nav) / var(--motion-fast)): they must not drift.
  const css = src('./css/styles.css');
  const tok = (name) => { const m = new RegExp(`${name}:\\s*(\\d+)ms`).exec(css); return m ? Number(m[1]) : null; };
  assert(tok('--motion-fast') === 150 && tok('--motion-nav') === 260, `[1o] the stylesheet's motion tokens are 150 / 260 ms (got ${tok('--motion-fast')} / ${tok('--motion-nav')})`);
  assert(LIFT_MS === tok('--motion-fast') && SETTLE_MS === tok('--motion-nav'), '[1p] LIFT_MS and SETTLE_MS equal --motion-fast and --motion-nav: the JS settle timer and the CSS glide cannot drift apart');
  assert(LIFT_MS >= 120 && LIFT_MS <= 180 && SETTLE_MS >= 220 && SETTLE_MS <= 300, '[1q] both sit inside the Interaction Principles\' ranges (small feedback 120-180 ms, navigation 220-300 ms)');
  assert(SECTION_LONG_PRESS_MS === NG.SECTION_LONG_PRESS_MS && SECTION_DRAG_TOUCH_OWNER === NG.SECTION_DRAG_TOUCH_OWNER && NG.LONG_PRESS_MS === 350,
    '[1s] SP-57 wiring: the hold length and the claim name are ONE source — nav-gestures.js owns them (its repaint-deferral set names the owner, and a leaf module cannot be imported back) and this module re-exports them; the exported 350 copy is the pill group\'s');
  assert(EDGE_ZONE_PX % 8 === 0 && SECTION_PRESS_SLOP_PX % 2 === 0 && SCROLL_INTO_VIEW_TOP_PAD_PX === 8 && SCROLL_INTO_VIEW_ALIGN_PX === 16, '[1r] the geometry constants sit on the 8 pt grid (Breathing Room: 8 pt in a group, 16 pt from an edge)');
}

// ═════════════════════════════════════════════════════════════════════════
// [2] isSectionHandle — "title rows only" (DI-475)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] isSectionHandle — the one place "title rows only" lives…');
{
  // The ten title rows, each as its real shape: an optional icon + text, and for dash-picks the Standard / Compact toggle.
  const doc = new FDoc();
  const rows = TEN.map(([id]) => {
    const hdr = new FEl('div', { 'data-section-header': '' }, doc);
    const icon = new FEl('svg', {}, doc);
    const text = new FEl('span', {}, doc);
    hdr.appendChild(icon); hdr.appendChild(text);
    const sec = new FEl('section', { class: 'layout-section', 'data-section-id': id }, doc);
    sec.appendChild(hdr);
    return { id, hdr, icon, text };
  });
  assert(rows.every((r) => isSectionHandle(r.hdr) && isSectionHandle(r.text) && isSectionHandle(r.icon)),
    '[2a] all ten title rows are handles, from the row itself, its text and its icon');
  assert(rows.length === 10, '[2b] fixture: ten title rows');
  // Controls and draggable pills inside a header are excluded (C5).
  const exclusions = [['a', {}], ['button', {}], ['input', {}], ['select', {}], ['textarea', {}], ['label', {}], ['summary', {}],
    ['span', { role: 'button' }], ['span', { draggable: 'true' }], ['span', { 'data-no-press': '' }]];
  for (const [tag, attrs] of exclusions) {
    const hdr = new FEl('div', { 'data-section-header': '' }, doc);
    const ctl = new FEl(tag, attrs, doc);
    const inner = new FEl('b', {}, doc);
    ctl.appendChild(inner); hdr.appendChild(ctl);
    assert(!isSectionHandle(ctl) && !isSectionHandle(inner), `[2c] <${tag}${Object.keys(attrs).map((k) => ` ${k}`).join('')}> inside a title row (and its child) is NOT a handle`);
  }
  // Thirteen kinds of body content: none is a handle, however long they are held (AT3's predicate half).
  const bodyKinds = [
    ['game row text', 'div', { class: 'game-row' }], ['a score', 'span', { class: 'score' }], ['a team logo', 'img', { class: 'team-logo' }],
    ['td.pick-cell', 'td', { class: 'pick-cell' }], ['the compact chip gap', 'div', { class: 'dc-chip-row' }], ['a reaction chip', 'button', { class: 'reaction-chip' }],
    ['a comment bubble', 'button', { class: 'comment-bubble' }], ['th.player-col', 'th', { class: 'player-col', draggable: 'true', 'data-player-id': 'p1' }],
    ['an alma row', 'div', { class: 'alma-row' }], ['a summary cell', 'td', { class: 'sum-cell' }], ['the tiebreaker hint', 'div', { class: 'tiebreaker-hint' }],
    ['a Standings table cell', 'td', { class: 'stand-cell' }], ['a <summary>', 'summary', {}], ['a name pill', 'div', { class: 'dc-chip', draggable: 'true', 'data-player-id': 'p2' }],
    ['a payment button', 'button', { class: 'ob-action-btn' }],
  ];
  const sec = new FEl('section', { class: 'layout-section', 'data-section-id': 'dash-picks' }, doc);
  const hdr0 = new FEl('div', { 'data-section-header': '' }, doc);
  const body = new FEl('div', { class: 'card-body' }, doc);
  sec.appendChild(hdr0); sec.appendChild(body);
  for (const [label, tag, attrs] of bodyKinds) {
    const el = new FEl(tag, attrs, doc); body.appendChild(el);
    const child = new FEl('i', {}, doc); el.appendChild(child);
    assert(!isSectionHandle(el) && !isSectionHandle(child), `[2d] body content (${label}) is never a handle`);
  }
  assert(!isSectionHandle(sec) && !isSectionHandle(body), '[2e] the section wrapper and its body are not handles: there is no "plain content" fallback');
  assert(!isSectionHandle(null) && !isSectionHandle({}) && !isSectionHandle(undefined) && !isSectionHandle({ closest: 'nope' }), '[2f] null / non-element targets are never handles');
  // A draggable pill placed INSIDE a header (a future header row that carries one) is still excluded: the claim is the second line, this is the first.
  const hdr1 = new FEl('div', { 'data-section-header': '' }, doc);
  const pill = new FEl('div', { class: 'dc-chip', draggable: 'true' }, doc);
  const pillText = new FEl('span', {}, doc);
  pill.appendChild(pillText); hdr1.appendChild(pill);
  assert(!isSectionHandle(pillText), '[2g] a [draggable="true"] pill inside a header is excluded (AT4\'s second mutation target)');
  assert(shouldBlockTouchMove('section-drag') === true && shouldBlockTouchMove(null) === false && shouldBlockTouchMove('week-swipe') === false && shouldBlockTouchMove('column-reorder') === false,
    '[2h] the title-row touchmove blocker cancels scroll ONLY while this module holds the claim');
}

// ═════════════════════════════════════════════════════════════════════════
// [3] pressStep — the press gate (pure)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] pressStep — arm, cancel and fire rules…');
{
  const doc = new FDoc();
  const hdr = new FEl('div', { 'data-section-header': '' }, doc);
  const text = new FEl('span', {}, doc);
  hdr.appendChild(text);
  const bodyEl = new FEl('div', { class: 'card-body' }, doc);
  const btn = new FEl('button', {}, doc); hdr.appendChild(btn);
  const T0 = 10000;
  const startEv = (over = {}) => ({ type: 'start', target: text, t: T0, x: 100, y: 200, scrollY: 50, touches: 1, source: 'touch', suspended: false, lastScrollT: null, lastTouchT: null, ...over });
  const armed = (over) => pressStep(initialPressState(), startEv(over));
  const fireEv = (s, over = {}) => pressStep(s, { type: 'fire', t: T0 + 500, scrollY: 50, connected: true, suspended: false, touches: 1, ...over });
  const claim = (s, ok) => pressStep(s, { type: 'claim', ok });

  const idle = initialPressState();
  assert(idle.phase === 'idle' && Object.isFrozen(idle), '[3a] the initial state is idle and frozen');
  const s0 = armed();
  assert(s0.phase === 'pending' && s0.mode === 'hold' && s0.t0 === T0 && s0.scrollY0 === 50, '[3b] a still touch on a title row arms (pending, hold mode, remembers t0 and scrollY)');
  // Not armed at all
  assert(armed({ target: bodyEl }).phase === 'dead' && armed({ target: bodyEl }).reason === 'not-handle', '[3c] a touch that starts in a body never arms (reason not-handle)');
  assert(armed({ target: btn }).reason === 'not-handle', '[3d] a control inside the title row never arms');
  assert(armed({ suspended: true }).reason === 'suspended', '[3e] a suspended gate (overlay up) never arms');
  assert(armed({ touches: 2 }).reason === 'second-finger', '[3f] a two-finger start never arms');
  assert(armed({ lastScrollT: T0 - 119 }).reason === 'scroll-settle', '[3g] a touch landing 119 ms after a scroll event is not armed (momentum)');
  assert(armed({ lastScrollT: T0 - 120 }).phase === 'pending', '[3h] …a touch 120 ms after a scroll event is armed');
  assert(armed({ source: 'mouse', button: 2 }).reason === 'button', '[3i] a right / middle mouse button never arms');
  assert(armed({ source: 'mouse', button: 0, lastTouchT: T0 - 599 }).reason === 'synthetic-mouse', '[3j] a mouse press 599 ms after a touch is the OS\'s synthesized one: ignored');
  assert(armed({ source: 'mouse', button: 0, lastTouchT: T0 - 600 }).phase === 'pending', '[3k] …a mouse press 600 ms after a touch is real');
  assert(armed({ source: 'mouse', lastTouchT: null }).phase === 'pending' && armed({ source: 'mouse' }).source === 'mouse', '[3l] mouse parity: a left press on a title row arms through the same gate');
  assert(armed({ source: 'touch', lastTouchT: T0 - 10 }).phase === 'pending', '[3m] the synthetic-mouse window applies to MOUSE input only');

  // Timing: AT2's engine half
  const early = fireEv(s0, { t: T0 + 450 });
  assert(early.phase === 'pending' && near(early.waitMs, 50), '[3n] a fire event at 450 ms lifts nothing and says to wait the remaining 50 ms');
  assert(fireEv(s0, { t: T0 + 499 }).phase === 'pending', '[3o] 499 ms: still pending');
  assert(fireEv(s0, { t: T0 + 500 }).phase === 'claiming', '[3p] 500 ms: every gate passed, now claiming');
  assert(fireEv(s0, { t: T0 + 2000 }).phase === 'claiming', '[3q] a late timer (2 s) still fires; nothing about a long hold is special');
  assert(fireEv(pressStep(s0, { type: 'move', x: 100, y: 200 }), { t: T0 + 350 }).phase === 'pending', '[3r] 350 ms (the PILL hold) never fires the section hold');
  // The 8 px sum rule
  const mv = (dx, dy) => pressStep(s0, { type: 'move', x: 100 + dx, y: 200 + dy });
  assert(mv(8, 0).phase === 'pending' && mv(0, 8).phase === 'pending' && mv(4, 4).phase === 'pending', '[3s] movement of exactly 8 (8,0 / 0,8 / 4,4) is still a hold');
  assert(mv(9, 0).phase === 'dead' && mv(0, 9).phase === 'dead' && mv(5, 4).phase === 'dead' && mv(-5, -4).reason === 'moved', '[3t] abs(dx)+abs(dy) of 9 (9,0 / 0,9 / 5,4 / -5,-4) is a scroll');
  const wandered = pressStep(mv(20, 0), { type: 'move', x: 100, y: 200 });
  assert(wandered.phase === 'dead' && fireEv(wandered).phase === 'dead', '[3u] a touch that moved can NEVER become a press, even if it later rests back at its start');
  assert(fireEv(pressStep(s0, { type: 'move', x: 104, y: 204 })).phase === 'claiming', '[3v] sub-threshold jitter (4,4) still fires at 500');
  // The scroll rules
  assert(pressStep(s0, { type: 'scroll' }).reason === 'scroll', '[3w] a scroll event kills a pending hold');
  assert(fireEv(s0, { scrollY: 53 }).reason === 'scroll', '[3x] scrollY drifted 3 px by fire time: dead');
  assert(fireEv(s0, { scrollY: 52 }).phase === 'claiming' && fireEv(s0, { scrollY: 48 }).phase === 'claiming', '[3y] drift of exactly 2 px (either way) is tolerated');
  // Every other cancel reason
  for (const [type, reason] of [['second-finger', 'second-finger'], ['touchcancel', 'touchcancel'], ['hidden', 'hidden'], ['resize', 'resize'], ['detached', 'detached']]) {
    const d = pressStep(s0, { type });
    assert(d.phase === 'dead' && d.reason === reason && fireEv(d).phase === 'dead', `[3z] ${type} kills the pending press permanently`);
  }
  assert(fireEv(s0, { connected: false }).reason === 'detached' && fireEv(s0, { connected: undefined }).reason === 'detached', '[3aa] a touched node no longer in the DOM at fire: dead (and an unknown connection state fails CLOSED)');
  assert(fireEv(s0, { suspended: true }).reason === 'suspended', '[3ab] an overlay that opened during the hold: dead at fire');
  assert(fireEv(s0, { touches: 2 }).reason === 'second-finger', '[3ac] a second finger at fire: dead');
  // The claim is the LAST gate
  const c = fireEv(s0);
  assert(c.phase === 'claiming', '[3ad] after every other rule passes the state is "claiming" (the binder must ask)');
  assert(claim(c, true).phase === 'fired', '[3ae] a granted claim fires');
  assert(claim(c, false).phase === 'dead' && claim(c, false).reason === 'claim-refused', '[3af] a refused claim (a pill drag or a week swipe owns the touch) is dead, nothing fires');
  assert(claim(c, undefined).phase === 'dead' && claim(c, 'yes').phase === 'dead', '[3ag] only a literal `true` grants (a truthy non-boolean does not)');
  assert(claim(s0, true).phase === 'pending', '[3ah] a claim event outside "claiming" is ignored');
  for (const bad of [{ connected: false }, { suspended: true }, { scrollY: 99 }, { touches: 2 }]) {
    assert(fireEv(s0, bad).phase !== 'claiming', `[3ai] the claim is never reached when another gate fails (${JSON.stringify(bad)})`);
  }
  // Tint
  assert(pressStep(s0, { type: 'tint', t: T0 + 119 }).tint === false && pressStep(s0, { type: 'tint', t: T0 + 120 }).tint === true, '[3aj] the pressed tint appears at 120 ms and not before');
  assert(pressStep(pressStep(s0, { type: 'tint', t: T0 + 130 }), { type: 'scroll' }).tint === false, '[3ak] a cancelled press loses its tint');
  assert(pressStep(pressStep(s0, { type: 'move', x: 120, y: 200 }), { type: 'tint', t: T0 + 130 }).tint === false, '[3al] a dead press never tints');
  // End
  assert(pressStep(s0, { type: 'end' }).phase === 'dead' && pressStep(s0, { type: 'end' }).reason === 'released', '[3am] a release before 500 ms is a tap: nothing lifts');
  // Edit mode: no hold, a title row drags after 6 pt
  const e0 = armed({ mode: 'edit' });
  assert(e0.phase === 'pending' && e0.mode === 'edit', '[3an] edit mode: a title-row touch arms without a hold');
  assert(pressStep(e0, { type: 'move', x: 106, y: 200 }).phase === 'pending' && pressStep(e0, { type: 'move', x: 100, y: 206 }).phase === 'pending', '[3ao] 6 pt of movement is still inside the slop');
  assert(pressStep(e0, { type: 'move', x: 107, y: 200 }).phase === 'claiming' && pressStep(e0, { type: 'move', x: 104, y: 203 }).phase === 'claiming', '[3ap] more than 6 pt starts the drag (claiming)');
  assert(pressStep(e0, { type: 'scroll' }).phase === 'pending', '[3aq] a scroll event does not cancel an edit-mode press (there is no hold to protect)');
  assert(fireEv(e0).phase === 'pending', '[3ar] edit mode has no 500 ms fire');
  assert(armed({ mode: 'edit', target: bodyEl }).phase === 'dead', '[3as] edit mode: a body touch still never drags');
  assert(armed({ mode: 'edit', lastScrollT: T0 - 5 }).phase === 'pending', '[3at] edit mode ignores the scroll-quiet rule (no hold, and title rows cannot scroll the page)');
  assert(pressStep(e0, { type: 'second-finger' }).phase === 'dead', '[3au] a second finger still cancels an edit-mode press');
  // Purity: frozen inputs, no mutation, no globals
  const fs = deepFreeze({ ...s0 });
  let threw = false;
  try { pressStep(fs, deepFreeze({ type: 'move', x: 1, y: 1 })); pressStep(fs, deepFreeze({ type: 'fire', t: T0 + 600, scrollY: 50, connected: true, touches: 1 })); } catch { threw = true; }
  assert(!threw, '[3av] pressStep never mutates its (frozen) inputs');
  assert(pressStep(undefined, { type: 'noop' }).phase === 'idle' && pressStep(s0, null) === s0 && pressStep(s0, { type: 'zzz' }) === s0, '[3aw] unknown events and a missing state are inert');
  assert(pressStep(s0, { type: 'move', x: 'abc', y: null }).phase === 'dead' || pressStep(s0, { type: 'move', x: 'abc', y: null }).phase === 'pending', '[3ax] garbage coordinates are coerced, never thrown on');
}

// ═════════════════════════════════════════════════════════════════════════
// [4] drop-target logic (pure) — AT10
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] drop-target logic — slotLayout / nearestSlot / slotShifts…');
{
  // Heights 900 / 200 / 330 / 96, gap 16, list top 100: the AT10 fixture (a tall section next to short ones).
  const heights = [900, 200, 330, 96];
  const mkGeo = (hs, gap = 16, top0 = 100) => { let t = top0; return hs.map((h) => { const g = { top: t, h }; t += h + gap; return g; }); };
  const geo = mkGeo(heights);
  assert(geo[1].top === 1016 && geo[2].top === 1232 && geo[3].top === 1578, '[4a] fixture: tops 100 / 1016 / 1232 / 1578');
  assert(inferGap(geo) === 16 && inferGap([]) === 0 && inferGap([{ top: 0, h: 5 }]) === 0 && inferGap([{ top: 0, h: 10 }, { top: 4, h: 5 }]) === 0, '[4b] inferGap reads the first gap and never goes negative');
  const L0 = slotLayout(geo, 0, 16);
  assert(JSON.stringify(L0.others) === '[1,2,3]' && JSON.stringify(L0.cum) === '[100,316,662,774]', '[4c] dragging the 900 pt section: slot title positions 100 / 316 / 662 / 774 (others\' heights + gaps)');
  const L2 = slotLayout(geo, 2, 16);
  assert(JSON.stringify(L2.others) === '[0,1,3]' && JSON.stringify(L2.cum) === '[100,1016,1232,1344]', '[4d] dragging the 330 pt section: 100 / 1016 / 1232 / 1344 (the 900 pt neighbour makes a long first step)');
  assert(L0.cum.length === geo.length && L2.cum.length === geo.length, '[4e] there is exactly one slot per section');
  // Clamp
  assert(clampTitleTop(L0.cum, -500) === 100 && clampTitleTop(L0.cum, 99999) === 774 && clampTitleTop(L0.cum, 400) === 400, '[4f] the dragged title is clamped to the first and last slot');
  // Nearest slot, no memory: boundaries are midpoints
  assert(nearestSlot(L0.cum, 100) === 0 && nearestSlot(L0.cum, 316) === 1 && nearestSlot(L0.cum, 774) === 3, '[4g] on a slot, that slot');
  assert(nearestSlot(L0.cum, 207.9) === 0 && nearestSlot(L0.cum, 208.1) === 1, '[4h] the switch happens at the midpoint of the neighbour being crossed (208 between 100 and 316)');
  assert(nearestSlot(L0.cum, 208) === 0, '[4i] an exact equal-distance tie goes to the LOWER slot (deterministic)');
  assert(nearestSlot(L0.cum, 489) === 1 && nearestSlot(L0.cum, 489.1) === 2 && nearestSlot(L0.cum, 718.1) === 3, '[4j] later midpoints: 489 (316..662) and 718 (662..774)');
  // Hysteresis: leave the current slot only if the new one is nearer by MORE than 4 px
  assert(nearestSlot(L0.cum, 210, 0) === 0, '[4k] from slot 0 at 210 (nearer to 1 by exactly 4): stays');
  assert(nearestSlot(L0.cum, 210.5, 0) === 1, '[4l] from slot 0 at 210.5 (nearer by 5): switches');
  assert(nearestSlot(L0.cum, 206, 1) === 1 && nearestSlot(L0.cum, 205.5, 1) === 0, '[4m] from slot 1 the same band applies in the other direction');
  assert(nearestSlot(L0.cum, 208, 0) === 0 && nearestSlot(L0.cum, 208, 1) === 1, '[4n] at an exact tie the CURRENT slot wins (no flip at the midpoint)');
  // A ±1 px tremor at a midpoint produces no extra slot change with hysteresis, and does without it (non-vacuous)
  let cur = 0; let changes = 0; let curNo = 0; let changesNo = 0;
  for (let i = 0; i < 40; i++) {
    const y = i % 2 ? 209 : 207;
    const n = nearestSlot(L0.cum, y, cur); if (n !== cur) changes++; cur = n;
    const m = nearestSlot(L0.cum, y, curNo, 0); if (m !== curNo) changesNo++; curNo = m;
  }
  assert(changes === 0, '[4o] a ±1 px finger tremor at a midpoint causes ZERO slot changes (no haptic chatter)');
  assert(changesNo >= 30, `[4p] …and the same tremor with hysteresis OFF flips every step (${changesNo}), so the test above is not vacuous`);
  // Hysteresis can never trap a drag in a slot it cannot leave (tiny sections)
  const tiny = [100, 102, 104, 106];
  assert(nearestSlot(tiny, 106, 0) === 3 && nearestSlot([100, 100.0], 100, 0) === 0, '[4q] with slots 2 px apart the margin shrinks to half the spacing: the drag can still leave');
  // Shifts
  const sh = slotShifts({ geo, i0: 0, j: 2, gap: 16 });   // the 900 dragged into slot 2
  assert(JSON.stringify(sh) === '[0,-916,-916,0]', `[4r] 900 dragged to slot 2: the 200 and 330 sections each rise by 916 (its height + gap), the 96 stays (got ${JSON.stringify(sh)})`);
  assert(JSON.stringify(slotShifts({ geo, i0: 0, j: 0, gap: 16 })) === '[0,0,0,0]', '[4s] a section left in its own slot moves nothing');
  assert(JSON.stringify(slotShifts({ geo, i0: 3, j: 0, gap: 16 })) === '[112,112,112,0]', `[4t] the 96 dragged to the top pushes each of the others down by its height + the gap, 96 + 16 = 112 (got ${JSON.stringify(slotShifts({ geo, i0: 3, j: 0, gap: 16 }))})`);
  // Property: for every dragged section and every slot, the final layout tiles (contiguous, no overlap, no gap loss)
  let tiled = true; let cases = 0;
  for (let i0 = 0; i0 < 4; i0++) for (let j = 0; j < 4; j++) {
    const { others, cum } = slotLayout(geo, i0, 16);
    const shifts = slotShifts({ geo, i0, j, gap: 16 });
    const finalTop = geo.map((g, k) => (k === i0 ? cum[j] : g.top + shifts[k]));
    const order = geo.map((_, k) => k).sort((a, b) => finalTop[a] - finalTop[b]);
    let y = geo[0].top;
    for (const k of order) { if (!near(finalTop[k], y)) tiled = false; y += geo[k].h + 16; }
    const expectIdx = order.indexOf(i0);
    if (expectIdx !== j) tiled = false;
    cases++;
  }
  assert(tiled && cases === 16, `[4u] every (dragged, slot) pair (16) produces a contiguous stack with the dragged section at exactly slot j`);
  // Property: a tall section lands where it is held (settle glide <= half the crossed neighbour + the gap) — seeded sweep
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  let worst = 0; let monotone = true; let n = 0;
  for (let trial = 0; trial < 300; trial++) {
    const count = 3 + Math.floor(rnd() * 5);
    const hs = Array.from({ length: count }, () => 60 + Math.floor(rnd() * 900));
    const gp = Math.floor(rnd() * 24);
    const g2 = mkGeo(hs, gp, 100);
    const i0 = Math.floor(rnd() * count);
    const { cum } = slotLayout(g2, i0, gp);
    let prevSlot = -1;
    const maxSpacing = Math.max(...cum.slice(1).map((c, k) => c - cum[k]));
    for (let s = 0; s <= 40; s++) {
      const y = cum[0] - 30 + (cum[cum.length - 1] - cum[0] + 60) * (s / 40);
      const top = clampTitleTop(cum, y);
      const j = nearestSlot(cum, top);
      worst = Math.max(worst, Math.abs(cum[j] - top) - maxSpacing / 2);
      if (j < prevSlot) monotone = false;
      prevSlot = j; n++;
    }
  }
  assert(worst <= 1e-9, `[4v] over ${n} random drops the settle glide never exceeds half the crossed neighbour + gap (worst excess ${worst})`);
  assert(monotone, '[4w] moving the finger down never moves the slot up (slots are monotone in titleTop)');
  // Untransformed geometry (a re-measure mid-lift stays exact)
  const rect = { top: 400 - 200 + 0, height: 306 };                 // top 200 (viewport), height 300 * 1.02
  const u = untransformedGeometry({ rect, scrollY: 100, applied: { dy: 60, scale: 1.02 } });
  assert(near(u.top, 240) && near(u.h, 300), `[4x] untransformedGeometry subtracts the translate and divides out the scale (got ${JSON.stringify(u)})`);
  assert(untransformedGeometry({ rect: { top: 10, height: 50 }, scrollY: 5 }).top === 15 && untransformedGeometry({ rect: { top: 10, height: 50 }, scrollY: 5 }).h === 50, '[4y] with no applied transform it is just rect + scrollY');
}

// ═════════════════════════════════════════════════════════════════════════
// [5] dragStep + dragView (pure)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5] dragStep / dragView — lift, move, scroll, remeasure, release, cancel, settled…');
{
  const geo = [{ top: 100, h: 200 }, { top: 316, h: 180 }, { top: 512, h: 240 }, { top: 768, h: 96 }];   // cum for i0=0: 100 / 296 / 552 / 664
  const lift = (over = {}) => dragStep(initialDragState(), { type: 'lift', id: 'A', i0: 0, geo, clientY: 122, scrollY: 0, scrollHeight: 2200, reduceMotion: false, mode: 'hold', ...over });
  const d0 = lift();
  assert(d0.phase === 'lifted' && d0.i0 === 0 && d0.j === 0 && d0.n === 4 && d0.offset === 22 && d0.gap === 16 && d0.h0 === 200 && Object.isFrozen(d0), '[5a] lift: lifted, slot = origin, finger offset below the title = 22, gap inferred = 16');
  assert(d0.changedSlot === false && d0.titleTop === 100 && d0.outcome === null, '[5b] the grab itself is not a slot change');
  assert(dragStep(initialDragState(), { type: 'lift', i0: 0, geo: [{ top: 0, h: 10 }], clientY: 0, scrollY: 0 }).phase === 'idle', '[5c] a lift with fewer than two sections is refused (idle, reason invalid-lift)');
  assert(dragStep(initialDragState(), { type: 'lift', i0: 9, geo, clientY: 0, scrollY: 0 }).outcome.reason === 'invalid-lift' && dragStep(initialDragState(), { type: 'lift', i0: 'x', geo }).phase === 'idle', '[5d] …and so is an out-of-range / non-integer index');
  // Move to slot 1: titleTop 296 needs clientY 296 + 22 = 318
  const d1 = dragStep(d0, { type: 'move', clientY: 318 });
  assert(d1.j === 1 && d1.changedSlot === true && near(d1.titleTop, 296), '[5e] moving the title onto slot 1\'s position changes the slot, once');
  const d1b = dragStep(d1, { type: 'move', clientY: 320 });
  assert(d1b.j === 1 && d1b.changedSlot === false, '[5f] a further move inside the same slot is NOT a slot change (one haptic per NEW slot)');
  const dEnd = dragStep(d0, { type: 'move', clientY: 99999 });
  assert(dEnd.j === 3 && near(dEnd.titleTop, 664), '[5g] a finger far below clamps the title to the last slot');
  const dTop = dragStep(dEnd, { type: 'move', clientY: -99999 });
  assert(dTop.j === 0 && dTop.titleTop === 100, '[5h] a finger far above clamps to the first slot');
  // The finger stays put; the page scrolls under it
  const dS = dragStep(d0, { type: 'scroll', scrollY: 196, scrollHeight: 2200 });
  assert(dS.j === 1 && near(dS.titleTop, 296) && dS.needsRemeasure === false, '[5i] a still finger with the page scrolled 196 px is now over slot 1 (the content moved under it)');
  assert(dragStep(d0, { type: 'scroll', scrollY: 10, scrollHeight: 2300 }).needsRemeasure === true, '[5j] a changed scrollHeight asks for a re-measure');
  // Remeasure keeps the drag going and keeps the finger-to-title offset
  const geoShift = geo.map((g) => ({ ...g, top: g.top + 40 }));
  const dR = dragStep(d1, { type: 'remeasure', geo: geoShift, scrollHeight: 2240 });
  assert(dR.phase === 'lifted' && dR.geo[0].top === 140 && dR.offset === d1.offset && dR.scrollHeight === 2240 && dR.needsRemeasure === false, '[5k] a re-measure swaps the geometry, keeps the drag, and clears the flag');
  assert(dragStep(d1, { type: 'remeasure', geo: geo.slice(0, 3), scrollHeight: 1 }).phase === 'settling' && dragStep(d1, { type: 'remeasure', geo: geo.slice(0, 3) }).outcome.moved === false, '[5l] a section count that changed mid-lift cancels (no write)');
  // Release / cancel
  const r1 = dragStep(d1, { type: 'release', commit: true });
  assert(r1.phase === 'settling' && r1.outcome.moved === true && r1.outcome.from === 0 && r1.outcome.to === 1 && r1.outcome.cancelled === false && r1.outcome.reason === 'drop' && r1.outcome.id === 'A', '[5m] release in slot 1 commits a move 0 -> 1');
  const r0 = dragStep(d0, { type: 'release', commit: true });
  assert(r0.outcome.moved === false && r0.outcome.cancelled === false, '[5n] release in the origin slot is not a move (no write) and is not a cancel');
  const c1 = dragStep(d1, { type: 'cancel', reason: 'escape' });
  assert(c1.outcome.moved === false && c1.outcome.cancelled === true && c1.outcome.to === 0 && c1.outcome.reason === 'escape', '[5o] cancel returns to the origin with no move, whatever slot the finger was over');
  assert(dragStep(d1, { type: 'release', commit: false }).outcome.cancelled === true, '[5p] release with commit:false is a cancel');
  assert(dragStep(r1, { type: 'move', clientY: 500 }) === r1 && dragStep(r1, { type: 'release' }) === r1 && dragStep(initialDragState(), { type: 'move', clientY: 5 }).phase === 'idle', '[5q] nothing moves a settling or idle state except `settled`');
  const done = dragStep(r1, { type: 'settled' });
  assert(done.phase === 'idle' && done.outcome.moved === true, '[5r] settled returns to idle and keeps the outcome for the binder');
  assert(dragStep(d1, { type: 'settled' }) === d1, '[5s] `settled` while still lifted is ignored');
  // dragView
  const v1 = dragView(d1);
  assert(v1.slot === 1 && v1.animate === true && v1.dragged.scale === LIFT_SCALE && near(v1.dragged.dy, 296 - 100) && v1.shifts[1] === -216 && v1.shifts[0] === 0, `[5t] view while lifted in slot 1: the dragged follows 1:1 (dy ${v1.dragged.dy}), the 180 pt neighbour glides up 216`);
  const vs = dragView(r1);
  assert(vs.dragged.scale === 1 && near(vs.dragged.dy, 296 - 100) && vs.shifts[1] === -216, '[5u] view while settling a committed move: the dragged lands on the slot, neighbours stay where they went');
  const vc = dragView(c1);
  assert(vc.dragged.dy === 0 && vc.shifts.every((s) => s === 0), '[5v] view while settling a cancel: everything returns to zero');
  const vrm = dragView(lift({ reduceMotion: true }));
  assert(vrm.dragged.scale === 1 && vrm.animate === false, '[5w] Reduce Motion: no scale, no animation');
  assert(dragView(initialDragState()) === null && dragView(done) === null, '[5x] idle states have no view');
  assert(liftTransform(12.345, 1.02) === 'translate3d(0px, 12.35px, 0px) scale(1.02)' && shiftTransform(0) === '' && shiftTransform(-216) === 'translate3d(0px, -216px, 0px)', '[5y] transform strings');
  // Purity
  let threw = false;
  try { dragStep(deepFreeze({ ...d1 }), deepFreeze({ type: 'move', clientY: 400 })); dragStep(deepFreeze({ ...d1 }), deepFreeze({ type: 'release' })); } catch { threw = true; }
  assert(!threw, '[5z] dragStep never mutates its (frozen) inputs');
  // One slot-change haptic per slot along a full drag: count changedSlot flags across a sweep down then up
  let s = d0; let flags = 0;
  for (let y = 122; y <= 700; y += 3) { s = dragStep(s, { type: 'move', clientY: y }); if (s.changedSlot) flags++; }
  for (let y = 700; y >= 100; y -= 3) { s = dragStep(s, { type: 'move', clientY: y }); if (s.changedSlot) flags++; }
  assert(flags === 6, `[5aa] a full sweep down then back up changes slot exactly 6 times (3 down, 3 up), once per slot (got ${flags})`);
}

// ═════════════════════════════════════════════════════════════════════════
// [6] auto-scroll (pure) — AT8, AT20 engine half
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6] auto-scroll — the ramp, the cap, the accumulator, the ends…');
{
  const top = 112; const bottom = 640;       // header 60 + bar 52; nav top 640
  assert(JSON.stringify(autoScrollEdges({ headerBottom: 60, navTop: 640, viewportH: 700 })) === `{"top":${top},"bottom":${bottom}}`, '[6a] edges: the top is the BAR\'s bottom (header + 52), the bottom is the nav\'s top');
  assert(autoScrollEdges({ headerBottom: 60, navTop: null, viewportH: 700 }).bottom === 700 && autoScrollEdges({ headerBottom: 60, viewportH: 700 }).bottom === 700 && autoScrollEdges({ headerBottom: 60, navTop: 900, viewportH: 700 }).bottom === 700,
    '[6b] no nav (or one below the viewport) falls back to the viewport bottom');
  const sp = (y, rm = false) => autoScrollSpeed({ pointerY: y, topEdge: top, bottomEdge: bottom, reduceMotion: rm });
  assert(sp(400) === 0 && sp(top + EDGE_ZONE_PX) === 0 && sp(bottom - EDGE_ZONE_PX) === 0, '[6c] outside the 72 pt zones (and exactly on a zone boundary) the speed is 0: no velocity step on entry');
  assert(near(sp(top), -720) && near(sp(bottom), 720), '[6d] AT the edge line: full 720 pt/s (up is negative)');
  assert(near(sp(top - 30), -720) && near(sp(bottom + 30), 720) && near(sp(-1000), -720), '[6e] a finger PAST the edge is full speed, not more');
  assert(near(sp(top + 36), -180) && near(sp(bottom - 36), 180), '[6f] halfway into the zone is a quarter speed (quadratic ramp: 720 x 0.5^2 = 180)');
  assert(near(sp(top + 18), -720 * (54 / 72) ** 2) && near(sp(bottom - 54), 720 * (18 / 72) ** 2), '[6g] the formula v = 720 x ((zone - d) / zone)^2 holds at other depths');
  let mono = true; let prev = 0;
  for (let y = top + EDGE_ZONE_PX - 1; y >= top; y -= 1) { const v = sp(y); if (v > prev) mono = false; prev = v; }
  assert(mono, '[6h] the ramp is monotone: deeper into the zone is never slower');
  assert(near(sp(top, true), -360) && near(sp(bottom, true), 360) && near(sp(top + 36, true), -90), '[6i] Reduce Motion halves it: 360 pt/s at the edge');
  let maxAbs = 0;
  for (let y = -50; y <= 800; y += 1) maxAbs = Math.max(maxAbs, Math.abs(sp(y)));
  let maxAbsRm = 0;
  for (let y = -50; y <= 800; y += 1) maxAbsRm = Math.max(maxAbsRm, Math.abs(sp(y, true)));
  assert(maxAbs <= 720 && maxAbsRm <= 360, '[6j] across every finger position the speed never exceeds 720 (360 under Reduce Motion): AT8\'s bound');
  assert(autoScrollSpeed({ pointerY: 150, topEdge: 100, bottomEdge: 180 }) !== 0 && autoScrollSpeed({ pointerY: 120, topEdge: 100, bottomEdge: 180 }) < 0 && autoScrollSpeed({ pointerY: 160, topEdge: 100, bottomEdge: 180 }) > 0,
    '[6k] overlapping zones (a very short viewport): the NEARER edge wins');
  // Stepping
  const step = (o) => autoScrollStep({ pointerY: bottom, topEdge: top, bottomEdge: bottom, dtMs: FRAME_MS, scrollY: 0, maxScrollY: 1500, carry: 0, ...o });
  let y = 0; let carry = 0; let total = 0; let maxFrame = 0;
  for (let f = 0; f < 60; f++) { const r = step({ scrollY: y, carry }); carry = r.carry; y += r.dy; total += r.dy; maxFrame = Math.max(maxFrame, r.dy); }
  assert(total >= 719 && total <= 721, `[6l] 60 frames (1 s) at the bottom edge scroll 720 pt (+/- 1): the measured rate is the nominal rate (got ${total})`);
  assert(maxFrame <= 12 + 1, `[6m] no single 60 Hz frame scrolls more than 12 pt (got ${maxFrame})`);
  let y2 = 0; let carry2 = 0; let total2 = 0;
  const slowY = bottom - EDGE_ZONE_PX + 6;                         // d = 66 into the zone from the edge: ~5 pt/s
  for (let f = 0; f < 60; f++) { const r = step({ pointerY: slowY, scrollY: y2, carry: carry2 }); carry2 = r.carry; y2 += r.dy; total2 += r.dy; }
  assert(total2 >= 4 && total2 <= 5, `[6n] the fractional-pixel ACCUMULATOR: the slow end of the ramp (~5 pt/s, 0.08 pt per frame) still moves ${total2} pt in a second instead of rounding to nothing`);
  let nocarry = 0;
  for (let f = 0; f < 60; f++) nocarry += step({ pointerY: slowY, carry: 0 }).dy;
  assert(nocarry === 0, '[6o] …and without feeding the carry back it would have moved 0 (the accumulator is doing the work)');
  assert(step({ dtMs: 500 }).dy === 36, '[6p] the dt cap: a 500 ms stalled frame moves at most 50 ms worth (36 pt)');
  assert(step({ dtMs: 0 }).dy === 0 && step({ dtMs: -20 }).dy === 0, '[6q] a zero or negative dt moves nothing');
  assert(step({ pointerY: 400 }).stopped === 'out-of-zone' && step({ pointerY: 400 }).dy === 0, '[6r] leaving the zone stops it');
  assert(step({ pointerY: top, scrollY: 0 }).stopped === 'top' && step({ pointerY: top, scrollY: 0 }).dy === 0, '[6s] at the page top, the top zone does nothing');
  assert(step({ scrollY: 1500 }).stopped === 'end' && step({ scrollY: 1500 }).dy === 0, '[6t] at the page end, the bottom zone does nothing');
  assert(step({ maxScrollY: 0 }).stopped === 'no-scroll' && step({ maxScrollY: -40 }).dy === 0, '[6u] a page not taller than the viewport never scrolls');
  assert(step({ scrollY: 1495, dtMs: 50 }).dy === 5 && step({ pointerY: top, scrollY: 3, dtMs: 50 }).dy === -3, '[6v] a step is clamped to the room left (never past either end)');
  assert(step({ pointerY: top, scrollY: 600 }).dy < 0 && step({ pointerY: top, scrollY: 600 }).speed < 0, '[6w] the top zone scrolls up');
  const opt = autoScrollOptions(12);
  assert(opt.top === 12 && opt.left === 0 && opt.behavior === 'instant', '[6x] the scroll options: behavior is "instant" (html{scroll-behavior:smooth} would otherwise smooth every frame: AT20)');
  // B12 scroll-into-view plan
  assert(scrollIntoViewPlan({ titleTop: 200, headerBottom: 60, navTop: 640 }) === null, '[6y] a moved section already in view: the scroll position is untouched');
  const p1 = scrollIntoViewPlan({ titleTop: 20, headerBottom: 60, navTop: 640 });
  assert(p1 && near(p1.deltaY, 20 - 76) && p1.behavior === 'smooth', '[6z] a title above the header lands 16 pt below it, smoothly');
  const p2 = scrollIntoViewPlan({ titleTop: 600, headerBottom: 60, navTop: 640 });
  assert(p2 && near(p2.deltaY, 600 - 76), '[6aa] a title within 80 pt of the nav is scrolled up into view');
  assert(scrollIntoViewPlan({ titleTop: 68, headerBottom: 60, navTop: 640 }) === null && scrollIntoViewPlan({ titleTop: 67.9, headerBottom: 60, navTop: 640 }) !== null, '[6ab] the top threshold is header + 8');
  assert(scrollIntoViewPlan({ titleTop: 560, headerBottom: 60, navTop: 640 }) === null && scrollIntoViewPlan({ titleTop: 560.1, headerBottom: 60, navTop: 640 }) !== null, '[6ac] the bottom threshold is nav - 80');
  assert(scrollIntoViewPlan({ titleTop: 10, headerBottom: 60, navTop: 640, reduceMotion: true }).behavior === 'instant', '[6ad] Reduce Motion: instant');
}

// SP-57 wiring: `.app-header` is position:relative in this app (it scrolls away), so its rect bottom goes negative; every edge derived from it must clamp.
{
  assert(visibleHeaderBottom(60) === 60 && visibleHeaderBottom(0) === 0 && visibleHeaderBottom(-940) === 0 && visibleHeaderBottom(undefined) === 0 && visibleHeaderBottom('x') === 0,
    '[6ha] visibleHeaderBottom: the part of the header still on screen — a header scrolled off (negative rect bottom) counts as 0, never negative, and garbage is 0');
  assert(autoScrollEdges({ headerBottom: visibleHeaderBottom(-940), navTop: 640, viewportH: 700 }).top === 52,
    '[6hb] …so the top auto-scroll edge is the bar\'s bottom at the viewport top (0 + 52) even when the header is a thousand points up the page');
  assert(autoScrollEdges({ headerBottom: -940, navTop: 640, viewportH: 700 }).top === -888,
    '[6hc] anti-vacuity: WITHOUT the clamp the edge would be −888 and the top zone would never be reachable — which is the defect the clamp fixes');
}
// SP-57 wiring: the TOP SAFE AREA (the notch / Dynamic Island band on the Munera shell and an installed PWA). The header's own padding-top is the inset; once the header
// has scrolled away the page scrolls under the status bar and nothing the module places or measures may go above that line.
{
  assert(visibleHeaderBottom(-940, 59) === 59 && visibleHeaderBottom(126, 59) === 126 && visibleHeaderBottom(30, 59) === 59 && visibleHeaderBottom(-5) === 0,
    '[6hd] visibleHeaderBottom floors at the safe-area inset: a header scrolled away still leaves the status-bar band (59), a taller visible header wins, no inset = the old clamp at 0');
  assert(autoScrollEdges({ headerBottom: 59, navTop: 640, viewportH: 700 }).top === 111 && autoScrollEdges({ headerBottom: 59, navTop: 640, viewportH: 700, barBottom: 140 }).top === 140
    && autoScrollEdges({ headerBottom: 59, navTop: 640, viewportH: 700, barBottom: null }).top === 111,
    "[6he] the top auto-scroll edge is the MOUNTED BAR's measured bottom when there is one (it sits under the header or the inset, whichever is lower), else visible header bottom + 52");
  const cs = (v) => ({ getComputedStyle: () => ({ paddingTop: v }) });
  assert(safeTopOf({}, cs('59px')) === 59 && safeTopOf({}, cs('0px')) === 0 && safeTopOf({}, cs('abc')) === 0 && safeTopOf(null, cs('59px')) === 0 && safeTopOf({}, {}) === 0
    && safeTopOf({}, { getComputedStyle() { throw new Error('x'); } }) === 0,
    "[6hf] safeTopOf reads the header's padding-top (= env(safe-area-inset-top)); no header, no getComputedStyle, a throw or garbage is 0");
}

// ═════════════════════════════════════════════════════════════════════════
// [7] the assistive path's logic (DI-386) and the live region
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[7] the assistive path — disabled ends, focus kept, the persistent live region…');
{
  assert(JSON.stringify(moveButtonStates(0, 4)) === '{"upDisabled":true,"downDisabled":false}' && JSON.stringify(moveButtonStates(3, 4)) === '{"upDisabled":false,"downDisabled":true}'
    && JSON.stringify(moveButtonStates(1, 4)) === '{"upDisabled":false,"downDisabled":false}', '[7a] the first section\'s Move up and the last section\'s Move down are disabled');
  assert(moveButtonStates(0, 1).upDisabled && moveButtonStates(0, 1).downDisabled, '[7b] a single section can move neither way');
  assert(chooseFocusDirection('up', { upDisabled: false, downDisabled: false }) === 'up' && chooseFocusDirection('down', { upDisabled: false, downDisabled: false }) === 'down', '[7c] focus stays on the same-direction button');
  assert(chooseFocusDirection('up', { upDisabled: true, downDisabled: false }) === 'down' && chooseFocusDirection('down', { upDisabled: false, downDisabled: true }) === 'up', '[7d] …or the OTHER one when that direction is now disabled');
  assert(chooseFocusDirection('up', { upDisabled: true, downDisabled: true }) === null, '[7e] nothing to focus when both are disabled');
  assert(chooseFocusDirection('sideways', { upDisabled: false, downDisabled: false }) === 'up', '[7f] an unknown direction defaults to up');

  // The live region: persistent, created once, on <body>, polite
  const doc = new FDoc();
  const live1 = ensureLayoutLive(doc);
  const live2 = ensureLayoutLive(doc);
  assert(live1 === live2 && live1.id === 'layout-live' && live1.parentNode === doc.body, '[7g] #layout-live is created once on <body> (outside every repainted container) and reused');
  assert(live1.getAttribute('aria-live') === 'polite' && live1.getAttribute('aria-atomic') === 'true' && live1.classList.contains('sr-only') && live1.getAttribute('aria-hidden') === null, '[7h] polite, atomic, .sr-only, and never aria-hidden');
  assert(doc.root.querySelectorAll('#layout-live').length === 1, '[7i] exactly one live region exists');
  assert(ensureLayoutLive(null) === null && ensureLayoutLive({}) === null, '[7j] no document, no region, no throw');
  const clock = makeClock();
  const env = { doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  announceLayout('Moved.', env);
  assert(live1.textContent === '', '[7k] announcing clears the region first');
  clock.advance(LIVE_ANNOUNCE_DELAY_MS - 1);
  assert(live1.textContent === '', '[7l] …and nothing is spoken before 30 ms');
  clock.advance(1);
  assert(live1.textContent === 'Moved.', '[7m] …the text arrives at 30 ms');
  announceLayout('Moved.', env);
  assert(live1.textContent === '', '[7n] the SAME string again clears first, so it announces again');
  clock.advance(30);
  assert(live1.textContent === 'Moved.', '[7o] …and lands again');
  announceLayout('First.', env); clock.advance(10); announceLayout('Second.', env); clock.advance(100);
  assert(live1.textContent === 'Second.' && clock.pending() === 0, '[7p] a burst: the latest announcement wins, no stale timer remains');

  // focusLayoutTarget over a fake page: 3 sections x (up, down) + the page's Reset twin
  const fdoc = new FDoc();
  const root = new FEl('div', {}, fdoc); fdoc.body.appendChild(root);
  const ids = ['A', 'B', 'C'];
  ids.forEach((id, i) => {
    const sec = new FEl('section', { class: 'layout-section', 'data-section-id': id }, fdoc);
    ['up', 'down'].forEach((dir) => {
      const b = new FEl('button', { class: 'section-move-btn', 'data-move-id': id, 'data-move-dir': dir, 'data-layout-page': 'dashboard' }, fdoc);
      b.disabled = (dir === 'up' && i === 0) || (dir === 'down' && i === ids.length - 1);
      sec.appendChild(b);
    });
    root.appendChild(sec);
  });
  const resetTwin = new FEl('button', { class: 'section-move-btn layout-reset-btn', 'data-layout-page': 'dashboard' }, fdoc);
  const resetOther = new FEl('button', { class: 'layout-reset-btn', 'data-layout-page': 'standings' }, fdoc);
  root.appendChild(resetOther); root.appendChild(resetTwin);
  // NOTE: the Reset twin carries .section-move-btn only in this fixture's second class slot to prove it is chosen by .layout-reset-btn, not by name.
  const btnOf = (id, dir) => root.querySelectorAll('.section-move-btn').find((b) => b.getAttribute('data-move-id') === id && b.getAttribute('data-move-dir') === dir);
  const f1 = focusLayoutTarget(root, { id: 'B', dir: 'up' });
  assert(f1 === btnOf('B', 'up') && fdoc.activeElement === f1, '[7q] a middle section\'s Move up: focus returns to ITS Move up');
  const f2 = focusLayoutTarget(root, { id: 'A', dir: 'up' });
  assert(f2 === btnOf('A', 'down'), '[7r] the first section moved up to the top: its Move up is now disabled, focus goes to its Move down');
  const f3 = focusLayoutTarget(root, { id: 'C', dir: 'down' });
  assert(f3 === btnOf('C', 'up'), '[7s] the last section: Move down is disabled, focus goes to Move up');
  assert(btnOf('B', 'up').focusCalls.length === 1 && btnOf('B', 'up').focusCalls[0].length === 0, '[7t] focus() is called WITHOUT preventScroll (a keyboard user must be brought to it; VoiceOver follows focus)');
  const f4 = focusLayoutTarget(root, { reset: true, pageKey: 'dashboard' });
  assert(f4 === resetTwin && fdoc.activeElement === resetTwin, '[7u] after Reset, focus lands on this page\'s own Reset twin');
  assert(focusLayoutTarget(root, { reset: true, pageKey: 'standings' }) === resetOther, '[7v] …chosen by data-layout-page');
  assert(focusLayoutTarget(root, { id: 'ZZZ', dir: 'up' }) === null && focusLayoutTarget(null, { id: 'A' }) === null && focusLayoutTarget(root, null) === null, '[7w] an unknown section or missing input focuses nothing, safely');

  // syncGrips: derived from state on every paint
  const gdoc = new FDoc();
  const gc = new FEl('div', {}, gdoc); gdoc.body.appendChild(gc);
  const hs = [0, 1, 2].map(() => { const h = new FEl('div', { 'data-section-header': '' }, gdoc); gc.appendChild(h); return h; });
  syncGrips(gc, true, () => '<svg/>');
  assert(hs.every((h) => h.querySelectorAll('.layout-grip').length === 1 && h.querySelector('.layout-grip').getAttribute('aria-hidden') === 'true' && h.querySelector('.layout-grip').innerHTML === '<svg/>'), '[7x] edit mode: each title row gets one aria-hidden grip at its end');
  syncGrips(gc, true, () => '<svg/>');
  assert(hs.every((h) => h.querySelectorAll('.layout-grip').length === 1), '[7y] re-running it never doubles a grip (every paint calls it)');
  syncGrips(gc, false);
  assert(hs.every((h) => h.querySelectorAll('.layout-grip').length === 0), '[7z] leaving edit mode removes them');
}

// ═════════════════════════════════════════════════════════════════════════
// [8] the binder, through a fake DOM and a fake clock, over the REAL claim model
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[8] the binder — lift, pills, body holds, cancels, claims, mouse, drag, drop, deferral…');

// ── 8.1 the lift: order of effects, feedback, in-place edit mode (AT2, DI-385 "Fire") ──
{
  const w = makeWorld();
  const A = w.titleTouch(1);                                         // hold the SECOND section's title
  w.touchStart(A, 180, w.rowY(1));
  w.clock.advance(PRESS_TINT_DELAY_MS - 1);
  assert(!w.headers[1].classList.contains('section-pressing'), '[8a] 119 ms into a hold: no tint yet');
  w.clock.advance(1);
  assert(w.headers[1].classList.contains('section-pressing'), '[8b] 120 ms into a still hold the title row takes .section-pressing (the only idle cue that it is a handle)');
  w.clock.advance(330);
  assert(!w.lifted() && NG.touchClaimedBy() === null && w.haptics.length === 0 && w.setEditingCalls.length === 0 && !w.sections[1].hasAttribute('data-lifted'), '[8c] at 450 ms nothing has lifted: no claim, no haptic, no edit mode, no data-lifted');
  w.clock.advance(50);
  assert(w.lifted() && NG.touchClaimedBy() === SECTION_DRAG_TOUCH_OWNER, '[8d] at 500 ms the section lifts and the claim is "section-drag"');
  const firstFour = w.log.filter((l) => !l.startsWith('release')).slice(0, 3);
  assert(JSON.stringify(firstFour) === '["claim:section-drag","haptic:medium","setEditing:dashboard"]', `[8e] the effects run in the DI's order: claim, then ONE medium haptic, then edit mode (got ${JSON.stringify(firstFour)})`);
  assert(w.haptics.length === 1 && w.haptics[0] === 'medium', '[8f] exactly one haptic at the lift, medium');
  assert(w.setEditingCalls.length === 1 && w.setEditingCalls[0] === 'dashboard' && w.container.classList.contains('layout-editing'), '[8g] edit mode is entered IN PLACE: setEditing(pageKey) once, .layout-editing on the page, and no repaint');
  assert(w.repaints === 0, '[8h] the lift triggered no repaint (a repaint would detach the touched node)');
  assert(w.sections[1].hasAttribute('data-lifted') && !w.sections[0].hasAttribute('data-lifted'), '[8i] only the held section carries data-lifted');
  assert(w.headers.every((h) => h.querySelectorAll('.layout-grip').length === 1), '[8j] a grip appears in every title row');
  assert(w.sections[1].style.transform === 'translate3d(0px, 0px, 0px) scale(1.02)' && w.sections[1].style.transformOrigin === '50% 0' && w.sections[1].style.willChange === 'transform', '[8k] the lifted section is scaled 1.02 about its TOP edge, will-change only on it');
  assert(!w.headers[1].classList.contains('section-pressing'), '[8l] the pending tint is cleared at the lift');
  w.clock.advance(LIVE_ANNOUNCE_DELAY_MS);
  assert(w.doc.getElementById('layout-live').textContent === 'Rearranging. Drag a section by its title.', '[8m] the live region announces "Rearranging. Drag a section by its title."');
  assert(w.win.selectionCleared === 1, '[8n] any text selection is cleared at the lift');
  assert(w.sections[1].isConnected && w.headers[1].isConnected, '[8o] the lifted node is still attached: it was never rebuilt');
  // AT11's engine half: the title's viewport Y is unchanged by entering edit mode
  const before = w.headers[1].layout.top - w.win.scrollY;
  assert(near(w.headers[1].getBoundingClientRect().top, before), '[8p] the title row under the finger did not move when edit mode appeared (engine half of AT11: scale about the top edge, zero dy, no repaint)');
  w.touchEnd(A);
  w.finish();
  assert(NG.touchClaimedBy() === null && !w.lifted(), '[8q] after the drop the claim is released');
  assert(w.reorders.length === 0, '[8r] a hold released without a drag writes NOTHING');
  w.clock.advance(LIVE_ANNOUNCE_DELAY_MS);
  assert(w.doc.getElementById('layout-live').textContent === 'Rearranging. Drag a section by its title.', '[8s] …and announces NOTHING new for a drop in the same slot: the live region still holds the lift announcement, never "Move cancelled." (reviewer N1: a drop the player chose to make is not a cancel)');
  w.destroy();
}

// ── 8.2 AT2: each of the ten title rows (450 nothing, 500 lifts) ──
{
  const w = makeWorld({ ids: TEN.map((t) => t[0]), heights: TEN.map(() => 120) });
  for (let i = 0; i < 10; i++) {
    const t = w.titleTouch(i);
    w.editing = null;
    w.touchStart(t, 100, w.rowY(i)); w.clock.advance(450);
    const quiet = !w.lifted() && NG.touchClaimedBy() === null && !w.sections[i].hasAttribute('data-lifted');
    w.touchEnd(t);
    w.clock.advance(100);
    w.touchStart(t, 100, w.rowY(i)); w.clock.advance(500);
    const lifted = w.lifted() && w.sections[i].hasAttribute('data-lifted') && NG.touchClaimedBy() === 'section-drag';
    w.touchEnd(t); w.finish();
    assert(quiet && lifted, `[8t] ${TEN[i][0]}: a 450 ms hold lifts nothing, a 500 ms hold lifts and claims 'section-drag'`);
  }
  assert(w.reorders.length === 0, '[8u] ten holds, ten drops in place: not one write');
  w.destroy();
}

// ── 8.3 AT3: body holds (touch and mouse) never lift ──
{
  const w = makeWorld();
  const bodyKinds = [['game row text', 'div', {}], ['a score', 'span', {}], ['a team logo', 'img', {}], ['td.pick-cell', 'td', { class: 'pick-cell' }], ['the compact chip gap', 'div', { class: 'dc-chip-row' }],
    ['a reaction chip', 'button', { class: 'reaction-chip' }], ['a comment bubble', 'button', {}], ['th.player-col', 'th', { class: 'player-col', draggable: 'true' }], ['an alma row', 'div', {}],
    ['a summary cell', 'td', {}], ['the tiebreaker hint', 'div', {}], ['a Standings table cell', 'td', {}], ['a <summary>', 'summary', {}], ['a name pill', 'div', { class: 'dc-chip', draggable: 'true' }]];
  let allQuiet = true; let mouseQuiet = true;
  for (const [, tag, attrs] of bodyKinds) {
    const el = new FEl(tag, attrs, w.doc); w.bodies[0].appendChild(el);
    w.touchStart(el, 150, 300); w.clock.advance(800);
    if (w.lifted() || NG.touchClaimedBy() !== null || w.haptics.length || w.setEditingCalls.length || w.headers.some((h) => h.classList.contains('section-pressing'))) allQuiet = false;
    w.touchEnd(el); w.clock.advance(700);
    w.mouseDown(el, 150, 300); w.clock.advance(800);
    if (w.lifted() || NG.touchClaimedBy() !== null || w.haptics.length || w.setEditingCalls.length) mouseQuiet = false;
    w.mouseUp(el); w.clock.advance(100);
  }
  assert(allQuiet, `[8v] an 800 ms TOUCH hold on ${bodyKinds.length} kinds of body content (incl. a name pill and th.player-col) lifts nothing, claims nothing, tints nothing, buzzes nothing`);
  assert(mouseQuiet, `[8w] …and an 800 ms MOUSE hold on the same ${bodyKinds.length} kinds lifts nothing`);
  assert(w.reorders.length === 0 && w.sections.every((s) => !s.hasAttribute('data-lifted')), '[8x] no write, no lift anywhere');
  // A section's own wrapper and its header's controls
  w.touchStart(w.sections[0], 10, 10); w.clock.advance(800);
  assert(!w.lifted(), '[8y] a touch that lands on the section wrapper itself (not its title row) never lifts');
  w.touchEnd(w.sections[0]);
  const toggle = new FEl('button', { class: 'layout-toggle-btn' }, w.doc); w.headers[0].appendChild(toggle);
  w.touchStart(toggle, 300, w.rowY(0)); w.clock.advance(800);
  assert(!w.lifted() && NG.touchClaimedBy() === null, '[8z] the Standard / Compact toggle inside a title row keeps its tap and never arms a press');
  w.touchEnd(toggle);
  const pillInHeader = new FEl('div', { class: 'dc-chip', draggable: 'true' }, w.doc); w.headers[0].appendChild(pillInHeader);
  w.touchStart(pillInHeader, 300, w.rowY(0)); w.clock.advance(1200);
  assert(!w.lifted() && NG.touchClaimedBy() === null && w.setEditingCalls.length === 0, '[8aa] AT1: a draggable pill placed inside a title row is held for 1.2 s: the section never lifts, no edit mode');
  w.touchEnd(pillInHeader);
  w.destroy();
}

// ── 8.4 cancels and arbitration ──
{
  const hold = (fn) => { const w = makeWorld(); const t = w.titleTouch(0); w.touchStart(t, 100, w.rowY(0)); fn(w, t); return w; };
  const noLift = (w) => !w.lifted() && NG.touchClaimedBy() === null && w.haptics.length === 0 && w.setEditingCalls.length === 0;
  let w;
  w = hold((x, t) => { x.clock.advance(300); x.touchMove(t, 105, x.rowY(0) + 4); x.clock.advance(400); });
  assert(noLift(w), '[8ab] a move of 9 (5,4) before 500 ms cancels the hold'); w.destroy();
  w = hold((x, t) => { x.clock.advance(300); x.touchMove(t, 120, x.rowY(0)); x.touchMove(t, 100, x.rowY(0)); x.clock.advance(400); });
  assert(noLift(w), '[8ac] …and a finger that returns to its start afterwards is STILL cancelled for good'); w.destroy();
  w = hold((x, t) => { x.clock.advance(300); x.touchMove(t, 104, x.rowY(0) + 4); x.clock.advance(250); });
  assert(w.lifted(), '[8ad] jitter of exactly 8 (4,4) still lifts at 500'); w.destroy();
  w = hold((x) => { x.clock.advance(300); fireWin(x.win, 'scroll'); x.clock.advance(400); });
  assert(noLift(w), '[8ae] a scroll event cancels the pending hold'); w.destroy();
  w = hold((x) => { x.clock.advance(300); x.win.scrollY = 3; x.clock.advance(250); });
  assert(noLift(w), '[8af] scrollY drifted 3 px with no scroll event delivered: dead at fire'); w.destroy();
  w = hold((x) => { x.clock.advance(300); x.win.scrollY = 2; x.clock.advance(250); });
  assert(w.lifted(), '[8ag] drift of 2 px is tolerated'); w.destroy();
  w = hold((x, t) => { x.clock.advance(300); x.touchStart(x.bodies[0], 50, 50, [{ identifier: 1, clientX: 60, clientY: 60 }]); x.clock.advance(400); });
  assert(noLift(w), '[8ah] a second finger cancels the pending hold'); w.destroy();
  w = hold((x, t) => { x.clock.advance(300); x.touchCancel(t); x.clock.advance(400); });
  assert(noLift(w), '[8ai] touchcancel cancels the pending hold'); w.destroy();
  w = hold((x) => { x.clock.advance(300); x.doc.hidden = true; x.doc.visibilityState = 'hidden'; fire(x.doc, x.doc, 'visibilitychange'); x.clock.advance(400); });
  assert(noLift(w), '[8aj] the page going hidden cancels the pending hold'); w.destroy();
  w = hold((x) => { x.clock.advance(300); fireWin(x.win, 'resize'); x.clock.advance(400); });
  assert(noLift(w), '[8ak] a resize / rotation cancels the pending hold'); w.destroy();
  w = hold((x) => { x.clock.advance(300); x.sections[0].remove(); x.clock.advance(250); });
  assert(noLift(w), '[8al] the touched node leaving the DOM (a repaint in the pending window) cancels the hold: nothing under the finger is claimed'); w.destroy();
  w = hold((x) => { x.clock.advance(300); x.suspended = true; x.clock.advance(250); });
  assert(noLift(w), '[8am] a modal / sheet that opened during the hold cancels it'); w.destroy();
  w = makeWorld(); w.suspended = true; w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(600);
  assert(noLift(w) && w.clock.pending() === 0, '[8an] with the gate already suspended at touchstart nothing is even armed (no timers left behind)'); w.destroy();
  // 120 ms momentum rule
  w = makeWorld(); fireWin(w.win, 'scroll'); w.clock.advance(100); w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(700);
  assert(noLift(w), '[8ao] a touch landing 100 ms after a scroll event (momentum scrolling) is not armed'); w.destroy();
  w = makeWorld(); fireWin(w.win, 'scroll'); w.clock.advance(130); w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(500);
  assert(w.lifted(), '[8ap] …130 ms after a scroll event it is armed normally'); w.destroy();
  // released early
  w = hold((x, t) => { x.clock.advance(300); x.touchEnd(t); x.clock.advance(400); });
  assert(noLift(w) && w.clock.pending() === 0 && !w.headers[0].classList.contains('section-pressing'), '[8aq] a touch released at 300 ms (a tap) lifts nothing and leaves no tint or timer'); w.destroy();
  // 350 ms (the pill hold) never lifts a section
  w = hold((x, t) => { x.clock.advance(350); });
  assert(noLift(w), '[8ar] AT5: at the PILL hold\'s 350 ms the section has not lifted'); w.destroy();
  // claims: a pill drag or a week swipe owns the touch
  for (const owner of ['column-reorder', 'week-swipe']) {
    w = hold((x) => { x.clock.advance(300); NG.claimTouch(owner); x.clock.advance(250); });
    assert(!w.lifted() && NG.touchClaimedBy() === owner && w.haptics.length === 0 && w.setEditingCalls.length === 0 && !w.container.classList.contains('layout-editing'),
      `[8as] AT6: a hold whose touch is already claimed by '${owner}' lifts nothing, buzzes nothing, enters no edit mode, and does not steal the claim`);
    w.destroy();
  }
  // the claim is attempted only once every other gate has passed
  w = hold((x) => { x.clock.advance(300); fireWin(x.win, 'scroll'); x.clock.advance(250); });
  assert(!w.log.includes('claim:section-drag'), '[8at] a cancelled hold never even ASKS for the claim');
  w.destroy();
  // a throwing setEditing must not leak the claim
  w = makeWorld({ ctlOver: {} });
  w.opts.setEditing = () => { throw new Error('boom'); };
  quietConsole(() => { w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(500); });
  assert(NG.touchClaimedBy() === null && !w.lifted(), '[8au] a throwing app callback at the lift never leaves the touch claimed (a stale claim would silence every gesture)');
  w.destroy();
}

// ── 8.5 mouse parity ──
{
  const w = makeWorld();
  const t = w.titleTouch(2);
  w.mouseDown(t, 100, w.rowY(2));
  w.clock.advance(499);
  assert(!w.lifted(), '[8av] a mouse press at 499 ms: nothing');
  const ctx = fire(w.doc, t, 'contextmenu');
  assert(ctx.defaultPrevented === true, '[8aw] the Android / desktop context menu is suppressed on a pending title press');
  const sel = fire(w.doc, t, 'selectstart');
  assert(sel.defaultPrevented === true, '[8ax] text selection is suppressed during a mouse press');
  w.clock.advance(1);
  assert(w.lifted() && NG.touchClaimedBy() === 'section-drag' && w.haptics[0] === 'medium', '[8ay] a mouse press-and-hold lifts at 500 ms through the same code path');
  const ctx2 = fire(w.doc, w.bodies[0], 'contextmenu');
  assert(ctx2.defaultPrevented === true, '[8az] …and the context menu stays suppressed anywhere while a lift is live');
  w.mouseUp(t); w.finish();
  const ctx3 = fire(w.doc, w.bodies[0], 'contextmenu');
  assert(ctx3.defaultPrevented === false, '[8ba] after the drop the context menu is back to normal');
  assert(NG.touchClaimedBy() === null, '[8bb] the mouse drop released the claim');
  w.destroy();
  const w2 = makeWorld();
  w2.touchStart(w2.titleTouch(0), 100, w2.rowY(0)); w2.clock.advance(40); w2.touchEnd(w2.titleTouch(0));
  w2.clock.advance(300);
  w2.mouseDown(w2.titleTouch(0), 100, w2.rowY(0)); w2.clock.advance(700);
  assert(!w2.lifted(), '[8bc] a mouse press within 600 ms of a touch (the OS\'s synthesized one) is ignored');
  w2.mouseUp(w2.titleTouch(0)); w2.clock.advance(700);
  w2.mouseDown(w2.titleTouch(0), 100, w2.rowY(0)); w2.clock.advance(500);
  assert(w2.lifted(), '[8bd] a mouse press 600 ms or more after a touch is real');
  w2.mouseUp(w2.titleTouch(0)); w2.finish();
  w2.mouseDown(w2.titleTouch(0), 100, w2.rowY(0), 2); w2.clock.advance(700);
  assert(!w2.lifted(), '[8be] a right-button press never arms');
  w2.destroy();
}

// ── 8.6 the drag: slots, haptics, drop, one write, one repaint, and repaint deferral (AT9, AT10, AT17 engine halves) ──
{
  const w = makeWorld();                           // tops 100 / 316 / 512 / 768, h 200 / 180 / 240 / 96, gap 16
  const t = w.titleTouch(0);
  w.touchStart(t, 180, 122); w.clock.advance(500);
  w.haptics.length = 0;
  w.touchMove(t, 180, 212);                        // title top 190: still slot 0 (the midpoint is 198, plus 2 px of hysteresis)
  assert(w.haptics.length === 0 && w.ctl._gesture().drag.j === 0, '[8bf] a drag short of the first midpoint changes no slot and buzzes nothing');
  w.touchMove(t, 180, 318);                        // title 296 = slot 1
  assert(w.ctl._gesture().drag.j === 1 && w.haptics.join() === 'selection', '[8bg] crossing into slot 1 gives exactly ONE selection haptic');
  assert(w.sections[0].style.transform === 'translate3d(0px, 196px, 0px) scale(1.02)', `[8bh] the lifted section follows the finger 1:1 from its title (dy 196 on a 196 px drag; got ${w.sections[0].style.transform})`);
  assert(w.sections[1].style.transform === 'translate3d(0px, -216px, 0px)', '[8bi] the neighbour it passed glides up by its own slot delta (the 200 pt section\'s height + gap = 216)');
  assert(w.sections[1].style.transition === 'transform var(--motion-nav) var(--ease-native)' && w.sections[0].style.transition === 'none', '[8bj] neighbours glide on --motion-nav / --ease-native; the lifted section follows with NO transition');
  assert(w.sections[1].style.willChange === 'transform' && !w.sections[3].style.willChange && !w.sections[2].style.willChange, '[8bk] will-change only on the lifted and the moved sections');
  w.touchMove(t, 180, 320); w.touchMove(t, 180, 319);
  assert(w.haptics.length === 1, '[8bl] wiggling inside slot 1 adds no haptics');
  w.touchMove(t, 180, 574);                        // title 552 = slot 2
  w.touchMove(t, 180, 686);                        // title 664 = slot 3
  assert(w.ctl._gesture().drag.j === 3 && w.haptics.join() === 'selection,selection,selection', '[8bm] one selection haptic per new slot (1, 2, 3)');
  // a repaint mid-lift is PARKED; a burst collapses; the lifted node stays attached
  w.liveTick(); w.liveTick(); w.liveTick();
  assert(w.repaints === 0 && w.parked.size === 1 && w.sections[0].isConnected, '[8bn] AT9: three live repaints during the lift are parked as one, and the lifted node is never detached');
  w.touchMove(t, 180, 574);                        // back to slot 2
  w.touchEnd(t);
  assert(w.ctl._gesture() !== null && w.ctl._gesture().drag.phase === 'settling' && NG.touchClaimedBy() === 'section-drag', '[8bo] on release the section settles WITH THE CLAIM STILL HELD (a repaint cannot sneak in during the glide)');
  assert(w.reorders.length === 0 && w.repaints === 0, '[8bp] nothing is written and nothing repaints until the glide ends');
  assert(w.sections[0].style.transform === 'translate3d(0px, 452px, 0px) scale(1)' && w.sections[0].hasAttribute('data-settling') && !w.sections[0].hasAttribute('data-lifted'),
    `[8bq] the section glides to its slot (title 552 - 100 = dy 452, scale back to 1) wearing data-settling (got ${w.sections[0].style.transform})`);
  w.clock.advance(SETTLE_MS - 1);
  assert(w.reorders.length === 0, '[8br] 259 ms: still gliding');
  w.clock.advance(12);
  assert(w.reorders.length === 1 && w.reorders[0][0] === 'dash-picks' && w.reorders[0][1] === 2, '[8bs] at the end of the glide: ONE write, onReorder(id, toVisibleIndex = 2)');
  assert(w.repaints === 1, `[8bt] AT9/AT17 engine half: the parked live repaint and the drop's own repaint collapse to EXACTLY ONE render (got ${w.repaints})`);
  assert(NG.touchClaimedBy() === null && w.ctl.isBusy() === false, '[8bu] the claim is released and the controller idle');
  assert(w.sections.every((s) => s.style.transform === '' && s.style.transition === '' && s.style.willChange === '' && s.style.transformOrigin === '' && !s.hasAttribute('data-lifted') && !s.hasAttribute('data-settling')),
    '[8bv] every inline transform, transition, will-change and marker is cleared at the drop');
  w.clock.advance(LIVE_ANNOUNCE_DELAY_MS);
  assert(w.doc.getElementById('layout-live').textContent === 'All Picks by Game moved to position 3 of 4.', '[8bw] the live region says "All Picks by Game moved to position 3 of 4."');
  assert(w.haptics[w.haptics.length - 1] === 'light', '[8bx] the drop ends with one light haptic');
  const order = w.log.filter((l) => l.startsWith('reorder') || l.startsWith('release'));
  assert(order[0].startsWith('reorder') && order[1] === 'release:section-drag', '[8by] the write happens BEFORE the claim is released (the repaint is parked while still claimed)');
  assert(w.ctl._moved().moved === true && w.ctl._moved().movedId === 'dash-picks', '[8bz] the controller remembers that a section moved, for Done');
  w.destroy();
}

// ── 8.7 a drop in the same slot: no write, a parked live repaint still flushes once ──
{
  const w = makeWorld();
  const t = w.titleTouch(1);
  w.touchStart(t, 180, w.rowY(1)); w.clock.advance(500);
  w.touchMove(t, 180, w.rowY(1) + 20);
  w.liveTick(); w.liveTick();
  w.touchEnd(t); w.finish();
  assert(w.reorders.length === 0 && w.repaints === 1 && NG.touchClaimedBy() === null, '[8ca] released in the origin slot: no write, the parked live repaint runs exactly once, the claim is released');
  assert(w.ctl._moved().moved === false, '[8cb] nothing moved');
  w.destroy();
  // No deferral owner yet (before wiring): the drop still repaints, and still releases
  const w2 = makeWorld({ withDefer: false });
  w2.touchStart(w2.titleTouch(0), 180, 122); w2.clock.advance(500);
  w2.touchMove(w2.titleTouch(0), 180, 318); w2.touchEnd(w2.titleTouch(0)); w2.finish();
  assert(w2.reorders.length === 1 && w2.repaints === 1 && NG.touchClaimedBy() === null, '[8cc] if the deferral door does not park (not wired yet), the drop repaints itself once, directly, and still releases');
  w2.destroy();
}

// ── 8.8 cancel paths: touchcancel, hidden, Escape, rotation; a height-only resize survives ──
{
  const lift = () => { const w = makeWorld(); const t = w.titleTouch(0); w.touchStart(t, 180, 122); w.clock.advance(500); w.touchMove(t, 180, 318); return { w, t }; };
  const undone = (w) => w.reorders.length === 0 && NG.touchClaimedBy() === null && !w.ctl.isBusy() && w.sections.every((s) => s.style.transform === '');
  let { w, t } = lift();
  w.touchCancel(t); w.finish();
  assert(undone(w), '[8cd] touchcancel mid-drag: the section returns, NO write, the claim is released');
  w.clock.advance(LIVE_ANNOUNCE_DELAY_MS);
  assert(w.doc.getElementById('layout-live').textContent === 'Move cancelled.', '[8ce] …and it announces "Move cancelled."');
  assert(w.haptics.filter((h) => h === 'light').length === 0, '[8cf] a system cancel gives no drop haptic');
  w.destroy();
  ({ w, t } = lift());
  w.doc.hidden = true; w.doc.visibilityState = 'hidden'; fire(w.doc, w.doc, 'visibilitychange'); w.finish();
  assert(undone(w), '[8cg] the app going hidden mid-drag: reverts, no write, claim released'); w.destroy();
  ({ w, t } = lift());
  fire(w.doc, w.doc, 'keydown', { key: 'Escape' }); w.finish();
  assert(undone(w) && w.done.length === 0, '[8ch] Escape mid-drag cancels the DRAG only (no write, edit mode NOT ended: onDone was not called)'); w.destroy();
  ({ w, t } = lift());
  w.win.innerWidth = 812; fireWin(w.win, 'resize'); w.finish();
  assert(undone(w), '[8ci] rotation (a width change) mid-drag reverts the section: no write'); w.destroy();
  ({ w, t } = lift());
  w.win.innerHeight = 640; fireWin(w.win, 'resize');
  assert(w.lifted(), '[8cj] a height-only resize (the dynamic toolbar) does NOT end a lift'); w.touchEnd(t); w.finish(); w.destroy();
  ({ w, t } = lift());
  w.suspended = true; w.clock.advance(40); w.finish();
  assert(undone(w), '[8ck] an overlay opening mid-lift cancels it with no write (the rAF loop checks the gate)'); w.destroy();
  ({ w, t } = lift());
  NG.releaseTouch('section-drag'); w.clock.advance(40); w.finish();
  assert(undone(w) && w.ctl.isBusy() === false, '[8cl] the claim vanishing mid-lift (another recognizer cleared it) cancels with no write'); w.destroy();
}

// ── 8.9 edit mode: later drags are immediate (6 pt), bodies still never drag ──
{
  const w = makeWorld();
  w.editing = 'dashboard';
  const t = w.titleTouch(2);
  w.touchStart(t, 180, w.rowY(2));
  w.touchMove(t, 180, w.rowY(2) + 6);
  assert(!w.lifted() && NG.touchClaimedBy() === null, '[8cm] edit mode: 6 pt of movement is still inside the slop');
  w.touchMove(t, 180, w.rowY(2) + 7);
  assert(w.lifted() && NG.touchClaimedBy() === 'section-drag', '[8cn] …7 pt starts the drag with no hold at all');
  assert(w.haptics.join() === 'light', '[8co] an edit-mode pickup is ONE light haptic (the hold\'s medium is for the entry)');
  assert(w.setEditingCalls.length === 0 && w.log.indexOf('setEditing:dashboard') === -1, '[8cp] already editing: setEditing is not called again');
  w.clock.advance(LIVE_ANNOUNCE_DELAY_MS + 5);
  assert(w.doc.getElementById('layout-live') === null || w.doc.getElementById('layout-live').textContent !== SECTION_DRAG_COPY.rearranging, '[8cq] …and "Rearranging" is not re-announced');
  w.touchEnd(t); w.finish(); w.destroy();
  const v = makeWorld(); v.editing = 'dashboard';
  v.touchStart(v.bodies[1], 100, 400); v.touchMove(v.bodies[1], 100, 460);
  assert(!v.lifted(), '[8cr] edit mode: a body touch that moves scrolls as normal and never drags');
  v.touchEnd(v.bodies[1]);
  v.touchStart(v.titleTouch(0), 100, v.rowY(0)); fireWin(v.win, 'scroll'); v.touchMove(v.titleTouch(0), 100, v.rowY(0) + 12);
  assert(v.lifted(), '[8cs] edit mode: a scroll event during the press does not cancel a title-row drag');
  v.touchEnd(v.titleTouch(0)); v.finish(); v.destroy();
}

// ── 8.10 a touch during the settle finishes it at once (DI-476) ──
{
  const w = makeWorld();
  const t = w.titleTouch(0);
  w.touchStart(t, 180, 122); w.clock.advance(500); w.touchMove(t, 180, 318); w.touchEnd(t);
  assert(w.ctl._gesture().drag.phase === 'settling' && w.reorders.length === 0, '[8ct] fixture: mid-settle');
  w.clock.advance(100);
  w.touchStart(w.bodies[2], 50, 50);
  assert(w.reorders.length === 1 && NG.touchClaimedBy() === null && !w.ctl.isBusy(), '[8cu] a new touch during the 260 ms settle snaps it to the final slot at once: written, released, flushed');
  w.touchEnd(w.bodies[2]);
  w.clock.advance(1000);
  assert(w.reorders.length === 1, '[8cv] …and the abandoned settle timer never writes a second time');
  w.destroy();
}

// ── 8.11 auto-scroll through the rAF loop, with the smooth-scroll trap (AT8, AT20 engine halves) ──
{
  const w = makeWorld({ ids: ['dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker'], heights: [900, 200, 330, 96], scrollHeight: 2200 });
  const t = w.titleTouch(1);
  w.touchStart(t, 180, w.rowY(1)); w.clock.advance(500);
  w.win.scrollCalls.length = 0;
  w.touchMove(t, 180, 640);                            // the bottom edge line (nav top)
  w.clock.advance(1000);
  const calls = w.win.scrollCalls;
  const sum = calls.reduce((a, c) => a + c.top, 0);
  const rate = (sum - calls[0].top) / ((calls[calls.length - 1].at - calls[0].at) / 1000);
  assert(rate >= 700 && rate <= 725, `[8cw] AT8: held at the bottom edge the MEASURED scroll rate is ~720 pt/s and never above it (got ${rate.toFixed(1)} pt/s over ${sum} pt)`);
  assert(w.win.scrollCalls.length > 40 && w.win.scrollCalls.every((c) => c.behavior === 'instant' && c.left === 0), `[8cx] AT20: every step is scrollBy({ top, left: 0, behavior: 'instant' }) (${w.win.scrollCalls.length} calls)`);
  assert(w.win.scrollCalls.every((c) => Number.isInteger(c.top) && c.top <= 13), '[8cy] each frame moves a whole number of pixels, at most 12-13');
  const y1 = w.win.scrollY;
  const dragged = w.ctl._gesture().drag;
  assert(near(dragged.scrollY, y1) && dragged.titleTop > 1016, '[8cz] the drag state tracks the page: the title kept pace with the content moving under the still finger');
  w.touchMove(t, 180, 400); w.win.scrollCalls.length = 0;
  w.clock.advance(300);
  assert(w.win.scrollCalls.length === 0, '[8da] leaving the zone stops the scroll at once');
  // top zone starts BELOW the bar (header 60 + 52 = 112)
  w.touchMove(t, 180, 130); w.win.scrollCalls.length = 0; w.clock.advance(100);
  assert(w.win.scrollCalls.length > 0 && w.win.scrollCalls.every((c) => c.top < 0), '[8db] the top zone scrolls up');
  w.touchMove(t, 180, 112 + 40); w.win.scrollCalls.length = 0; w.clock.advance(100);
  assert(w.win.scrollCalls.length > 0 && w.win.scrollCalls.every((c) => c.top < 0), '[8dc] a finger 40 pt under the BAR (112) is inside the top zone and scrolls up: the zone starts at the bar\'s bottom, not at the header\'s (60 + 72 = 132 would not reach it)');
  w.touchMove(t, 180, 112 + EDGE_ZONE_PX + 6); w.win.scrollCalls.length = 0; w.clock.advance(100);
  assert(w.win.scrollCalls.length === 0, '[8dc2] a finger just below the 72 pt zone does not scroll');
  // release
  w.touchMove(t, 180, 640); w.clock.advance(100); w.touchEnd(t); w.win.scrollCalls.length = 0; w.finish(); w.clock.advance(CLICK_SWALLOW_MS + 50);
  assert(w.win.scrollCalls.length === 0 && w.clock.pending() === 0, '[8dd] after release no more auto-scroll frames are scheduled, and no timer of any kind is left running');
  w.destroy();
  // the page end
  const e = makeWorld({ heights: [900, 200, 330, 96], scrollHeight: 900 });   // max scroll = 200
  e.touchStart(e.titleTouch(0), 180, 122); e.clock.advance(500); e.touchMove(e.titleTouch(0), 180, 640); e.clock.advance(2000);
  assert(e.win.scrollY === 200 && e.win.scrollCalls.reduce((a, c) => a + c.top, 0) === 200, '[8de] the scroll stops AT the page end (200) and never past it');
  e.touchEnd(e.titleTouch(0)); e.finish(); e.destroy();
  // a page not taller than the viewport
  const s = makeWorld({ scrollHeight: 700 });
  s.touchStart(s.titleTouch(0), 180, 122); s.clock.advance(500); s.touchMove(s.titleTouch(0), 180, 640); s.clock.advance(500);
  assert(s.win.scrollCalls.length === 0, '[8df] a page that fits the viewport never auto-scrolls');
  s.touchEnd(s.titleTouch(0)); s.finish(); s.destroy();
  // Reduce Motion halves the speed and drops the scale
  const r = makeWorld({ heights: [900, 200, 330, 96], rm: true });
  r.touchStart(r.titleTouch(0), 180, 122); r.clock.advance(500);
  assert(r.sections[0].style.transform === 'translate3d(0px, 0px, 0px) scale(1)', '[8dg] Reduce Motion: the lifted section does NOT scale');
  assert(r.sections.every((el, k) => k === 0 || el.style.transition === 'none'), '[8dh] Reduce Motion: neighbours jump (no transition)');
  r.touchMove(r.titleTouch(0), 180, 640); r.clock.advance(1000);
  const rc = r.win.scrollCalls;
  const rrate = (rc.reduce((a, c) => a + c.top, 0) - rc[0].top) / ((rc[rc.length - 1].at - rc[0].at) / 1000);
  assert(rrate >= 340 && rrate <= 365, `[8di] Reduce Motion: the measured auto-scroll rate is half speed, ~360 pt/s (got ${rrate.toFixed(1)})`);
  r.touchMove(r.titleTouch(0), 180, 400);
  r.touchEnd(r.titleTouch(0));
  assert(r.reorders.length <= 1 && NG.touchClaimedBy() === null && !r.ctl.isBusy(), '[8dj] Reduce Motion: the settle is immediate (the claim is released synchronously with the release)');
  r.destroy();
}

// ── 8.12 geometry that changes without a repaint: re-measured, the drag continues (AT19 engine half) ──
{
  const w = makeWorld();
  const t = w.titleTouch(0);
  w.touchStart(t, 180, 122); w.clock.advance(500); w.touchMove(t, 180, 318);       // slot 1, transforms applied
  w.sections.forEach((s) => { s.layout.top += 40; }); w.headers.forEach((h) => { h.layout.top += 40; });
  w.doc.root.scrollHeight += 40;                                                  // a maintenance banner arrived above
  w.clock.advance(50);
  const d = w.ctl._gesture().drag;
  assert(d.phase === 'lifted' && d.geo[0].top === 140 && d.geo[1].top === 356 && d.scrollHeight === w.doc.root.scrollHeight, `[8dk] the page's height changed: geometry is re-measured WITHOUT the transforms leaking into it (tops ${d.geo.map((g) => g.top)}), the drag continues`);
  assert(d.geo[0].h === 200 && d.geo[1].h === 180, '[8dl] …and the lifted section\'s scale is divided back out of its height');
  w.touchEnd(t); w.finish();
  assert(w.reorders.length === 1 && NG.touchClaimedBy() === null, '[8dm] the drag then completes normally');
  w.destroy();
}

// ── 8.13 Done, Reset, Escape (B12, B13) ──
{
  const w = makeWorld();
  const t = w.titleTouch(0);
  w.touchStart(t, 180, 122); w.clock.advance(500); w.touchMove(t, 180, 318); w.touchEnd(t); w.finish();
  w.win.scrollY = 600;                                                             // the moved section's title is now far above the header
  w.headers[0].layout.top = 150; w.sections[0].layout.top = 150;
  assert(w.ctl.requestDone('done') === true, '[8dn] requestDone is available once a controller is attached');
  assert(w.done.length === 1 && w.done[0][0] === true && w.done[0][1] === 'dash-picks' && w.done[0][2] === 'done', '[8do] Done calls onDone(moved = true, movedId) exactly once');
  w.clock.advance(LIVE_ANNOUNCE_DELAY_MS);
  assert(w.doc.getElementById('layout-live').textContent === 'Layout saved.', '[8dp] Done announces "Layout saved."');
  assert(w.win.scrollCalls.length === 1 && w.win.scrollCalls[0].behavior === 'smooth' && w.win.scrollCalls[0].top === (150 - 600) - (60 + 16), `[8dq] the moved section is scrolled into view smoothly (got ${JSON.stringify(w.win.scrollCalls)})`);
  assert(w.ctl._moved().moved === false && w.ctl._moved().movedId === null, '[8dr] Done resets the moved flag');
  w.destroy();
  // Reduce Motion: instant
  const r = makeWorld({ rm: true });
  r.touchStart(r.titleTouch(0), 180, 122); r.clock.advance(500); r.touchMove(r.titleTouch(0), 180, 318); r.touchEnd(r.titleTouch(0));
  r.win.scrollY = 600; r.headers[0].layout.top = 150; r.sections[0].layout.top = 150; r.win.scrollCalls.length = 0;
  r.ctl.requestDone('done');
  assert(r.win.scrollCalls[0].behavior === 'instant', '[8ds] Reduce Motion: the scroll-into-view is instant');
  r.destroy();
  // In view already / nothing moved: the scroll position is untouched
  const v = makeWorld();
  v.touchStart(v.titleTouch(0), 180, 122); v.clock.advance(500); v.touchMove(v.titleTouch(0), 180, 318); v.touchEnd(v.titleTouch(0)); v.finish();
  v.headers[0].layout.top = 300; v.sections[0].layout.top = 300; v.win.scrollCalls.length = 0;
  v.ctl.requestDone('done');
  assert(v.win.scrollCalls.length === 0, '[8dt] a moved section whose title is already in view: the scroll position is not touched');
  v.destroy();
  const n = makeWorld(); n.editing = 'dashboard';
  n.ctl.requestDone('done');
  assert(n.done.length === 1 && n.done[0][0] === false && n.done[0][1] === null && n.win.scrollCalls.length === 0, '[8du] Done with nothing moved: onDone(false, null), no scroll, (the app shows no save toast)');
  n.destroy();
  // Escape (web): ends edit mode when idle; ignored under an overlay; cancels only the drag when lifted
  const e = makeWorld(); e.editing = 'dashboard';
  fire(e.doc, e.doc, 'keydown', { key: 'Enter' });
  assert(e.done.length === 0, '[8dv] only Escape ends edit mode: other keys do nothing (no custom arrow-key handler: native Tab + Enter/Space)');
  e.suspended = true; fire(e.doc, e.doc, 'keydown', { key: 'Escape' });
  assert(e.done.length === 0, '[8dw] Escape while a modal / sheet is up belongs to that overlay');
  e.suspended = false; fire(e.doc, e.doc, 'keydown', { key: 'Escape' });
  assert(e.done.length === 1 && e.done[0][2] === 'escape', '[8dx] Escape in edit mode ends it through onDone');
  e.destroy();
  const ne = makeWorld();
  fire(ne.doc, ne.doc, 'keydown', { key: 'Escape' });
  assert(ne.done.length === 0, '[8dy] Escape when not in edit mode does nothing');
  ne.destroy();
  // Reset
  const rs = makeWorld(); rs.win.scrollY = 300;
  const onReset = rs.opts.onReset; rs.opts.onReset = () => { onReset(); rs.win.scrollY = 0; };   // a repaint that lost the scroll
  assert(rs.ctl.requestReset() === true, '[8dz] requestReset is the one function the bar\'s Reset and the hidden twin both call');
  assert(rs.resets === 1 && rs.haptics.join() === 'light', '[8ea] Reset: onReset once, one light haptic');
  rs.clock.advance(LIVE_ANNOUNCE_DELAY_MS);
  assert(rs.doc.getElementById('layout-live').textContent === 'Layout reset to the default.', '[8eb] Reset announces "Layout reset to the default."');
  assert(rs.win.scrollToCalls.length === 1 && rs.win.scrollToCalls[0].top === 300 && rs.win.scrollToCalls[0].behavior === 'instant', '[8ec] Reset keeps the scroll position (instant restore if the repaint moved it)');
  rs.destroy();
  const un = createSectionDragController({});
  assert(un.requestDone() === false && un.requestReset() === false, '[8ed] with nothing attached, Done and Reset are inert (no throw)');
  un.destroy();
}

// ── 8.13b two pages, one controller: Done / Reset / Escape act on the RIGHT page ──
{
  const w = makeWorld();                                           // the Dashboard (attached first)
  const standContainer = new FEl('div', { id: 'page-leaderboard' }, w.doc); w.doc.body.appendChild(standContainer);
  ['stand-season', 'stand-alma'].forEach((id, i) => {
    const sec = new FEl('section', { class: 'layout-section', 'data-section-id': id }, w.doc);
    sec.layout = { top: 100 + i * 300, height: 284, fixed: false };
    const hdr = new FEl('div', { 'data-section-header': '' }, w.doc); hdr.layout = { top: 100 + i * 300, height: 44, fixed: false };
    sec.appendChild(hdr); standContainer.appendChild(sec);
  });
  const standCalls = { done: [], reset: 0 };
  const standOpts = { pageKey: 'standings', tabKey: 'leaderboard', visible: () => ['stand-season', 'stand-alma'], getEditing: () => w.editing === 'standings',
    setEditing: (p) => { w.editing = p; }, onReorder: () => {}, onReset: () => { standCalls.reset++; }, onDone: (m, id) => { standCalls.done.push([m, id]); w.editing = null; }, rerender: () => {}, labelOf: (id) => id };
  w.ctl.attach(standContainer, standOpts);                         // Standings attached LAST
  w.editing = 'dashboard';
  w.ctl.requestDone('done');
  assert(w.done.length === 1 && standCalls.done.length === 0, '[8fn] with the Dashboard in edit mode, Done acts on the Dashboard even though Standings was attached last');
  w.editing = 'standings';
  w.ctl.requestDone('done');
  assert(standCalls.done.length === 1 && w.done.length === 1, '[8fo] with Standings in edit mode, Done acts on Standings');
  w.editing = null;
  w.ctl.requestReset('standings');
  assert(standCalls.reset === 1 && w.resets === 0, '[8fp] the hidden Reset twin names its page: it works with edit mode OFF and clears only that page');
  w.ctl.requestReset('dashboard');
  assert(w.resets === 1 && standCalls.reset === 1, '[8fq] …and the Dashboard\'s twin clears only the Dashboard');
  w.editing = 'standings';
  fire(w.doc, w.doc, 'keydown', { key: 'Escape' });
  assert(standCalls.done.length === 2, '[8fr] Escape ends edit mode on the page that is in it');
  w.ctl.detach(standContainer);
  w.editing = null; w.ctl.requestDone('done');
  assert(w.done.length === 2, '[8fs] a detached page is no longer a target (the remaining one is)');
  w.destroy();
}

// ── 8.14 AT7: listener confinement and the blocking touchmove ──
{
  const w = makeWorld({ ids: TEN.map((t) => t[0]), heights: TEN.map(() => 120) });
  const all = [w.win, w.doc, w.doc.root, w.doc.body, w.container, ...w.sections, ...w.headers, ...w.bodies];
  const nonPassiveMoves = [];
  for (const node of all) for (const l of node.listeners) if (l.type === 'touchmove' && !l.passive) nonPassiveMoves.push(node);
  assert(nonPassiveMoves.length === 10 && nonPassiveMoves.every((n) => w.headers.includes(n)), `[8ee] the ONLY non-passive touchmove listeners are on the ten [data-section-header] rows (found ${nonPassiveMoves.length}, none on window / document / html / body / container / any section or body)`);
  const containerTypes = w.container.listeners.map((l) => `${l.type}:${l.passive ? 'passive' : 'blocking'}`).sort();
  assert(containerTypes.every((s) => s.endsWith(':passive')) && containerTypes.includes('touchstart:passive') && containerTypes.includes('mousedown:passive') && !containerTypes.some((s) => s.startsWith('touchmove')),
    `[8ef] the container carries only PASSIVE listeners (touchstart, touchend, touchcancel, mousedown) and no touchmove: ${containerTypes.join(' ')}`);
  assert(w.win.listeners.every((l) => l.passive) && w.win.listeners.map((l) => l.type).join() === 'scroll', '[8eg] window carries one passive scroll listener');
  const docTouch = w.doc.listeners.filter((l) => l.type.startsWith('touch') && !l.passive);
  assert(docTouch.length === 0, '[8eh] document carries no blocking touch listener (the scroll chain stays passive)');
  // Behavioral: defaultPrevented false while pending, true while lifted, false again after release
  const t = w.titleTouch(0);
  w.touchStart(t, 100, w.rowY(0));
  const pendingMove = w.touchMove(t, 103, w.rowY(0) + 1);
  assert(pendingMove.defaultPrevented === false, '[8ei] a touchmove during the PENDING hold is never defaultPrevented (a scroll that starts on a title row scrolls natively)');
  w.clock.advance(500);
  const liftedMove = w.touchMove(t, 103, w.rowY(0) + 30);
  assert(w.lifted() && liftedMove.defaultPrevented === true, '[8ej] a touchmove during a LIFT is defaultPrevented (the page does not move under the finger)');
  w.touchEnd(t); w.finish();
  const after = w.touchMove(t, 103, w.rowY(0) + 60);
  assert(after.defaultPrevented === false, '[8ek] after the release it is false again');
  w.editing = null;                                               // (edit mode drags at 6 pt BY DESIGN: a plain swipe is only plain outside it)
  const swipe = (() => { w.touchStart(t, 100, 300); const m = w.touchMove(t, 100, 360); w.touchEnd(t); return m; })();
  assert(swipe.defaultPrevented === false, '[8el] a plain swipe that starts on a title row has defaultPrevented === false on every touchmove');
  w.destroy();
  // A pill drag holding the claim ('column-reorder') must not be blocked by the title-row listener
  const p = makeWorld();
  NG.claimTouch('column-reorder');
  const pm = fire(p.doc, p.titleTouch(0), 'touchmove', { touches: [{ identifier: 0, clientX: 1, clientY: 1 }] });
  assert(pm.defaultPrevented === false, '[8em] while ANOTHER owner holds the touch the title-row listener does not cancel anything');
  p.destroy();
  // non-cancelable events are not preventDefault-ed (no console noise)
  const q = makeWorld(); q.touchStart(q.titleTouch(0), 100, q.rowY(0)); q.clock.advance(500);
  const nc = fire(q.doc, q.titleTouch(0), 'touchmove', { cancelable: false, touches: [{ identifier: 0, clientX: 100, clientY: q.rowY(0) + 5 }] });
  assert(nc.defaultPrevented === false, '[8en] a non-cancelable touchmove is left alone');
  q.touchEnd(q.titleTouch(0)); q.finish(); q.destroy();
}

// ── 8.14b the one-shot click swallow: armed at TOUCH END, never at settle, never against a prompt tap ──
{
  const lifted = () => { const w = makeWorld(); const t = w.titleTouch(0); w.touchStart(t, 180, 122); w.clock.advance(500); w.touchMove(t, 180, 318); return { w, t }; };
  let hit = 0;
  const probe = (w) => { const b = new FEl('button', {}, w.doc); w.doc.body.appendChild(b); hit = 0; b.addEventListener('click', () => { hit++; }); return b; };
  let { w, t } = lifted(); let done = probe(w);
  w.touchEnd(t); w.clock.advance(10);
  const c1 = fire(w.doc, done, 'click');
  assert(c1.defaultPrevented === true && hit === 0, '[8fg] the click the ENDING touch synthesizes (10 ms after touchend) is swallowed: nothing under the finger activates');
  const c2 = fire(w.doc, done, 'click');
  assert(c2.defaultPrevented === false && hit === 1, '[8fh] it is ONE-SHOT: the next click goes through');
  w.finish(); w.destroy();
  ({ w, t } = lifted()); done = probe(w);
  w.touchEnd(t); w.clock.advance(60);
  w.touchStart(done, 100, 50);                                                  // the user taps Done 60 ms after letting go
  const c3 = fire(w.doc, done, 'click');
  assert(c3.defaultPrevented === false && hit === 1, '[8fi] a NEW touch disarms the swallow, so a prompt tap on Done (inside the settle, inside 350 ms) is NOT swallowed');
  w.finish(); w.destroy();
  ({ w, t } = lifted()); done = probe(w);
  w.touchEnd(t); w.clock.advance(CLICK_SWALLOW_MS + 1);
  const c4 = fire(w.doc, done, 'click');
  assert(c4.defaultPrevented === false && hit === 1 && w.doc.listeners.filter((l) => l.type === 'click').length === 0, '[8fj] after 350 ms with no click the swallow expires and removes itself');
  w.finish(); w.destroy();
  ({ w, t } = lifted()); done = probe(w);
  w.touchEnd(t);
  w.clock.advance(SETTLE_MS + 5);
  const c5 = fire(w.doc, done, 'click');
  assert(c5.defaultPrevented === true && hit === 0, '[8fk] armed at touch end, so it is still live when the settle ends (the swallow is not re-armed there, it is the same one)');
  w.destroy();
  ({ w, t } = lifted()); done = probe(w);
  w.touchCancel(t); w.clock.advance(10);
  const c6 = fire(w.doc, done, 'click');
  assert(c6.defaultPrevented === false && hit === 1, '[8fl] a SYSTEM touchcancel synthesizes no click, so nothing is swallowed');
  w.finish(); w.destroy();
  // a plain tap (no lift) arms nothing
  const p = makeWorld(); done = probe(p);
  p.touchStart(p.titleTouch(0), 100, p.rowY(0)); p.clock.advance(100); p.touchEnd(p.titleTouch(0)); p.clock.advance(10);
  const c7 = fire(p.doc, done, 'click');
  assert(c7.defaultPrevented === false && hit === 1, '[8fm] a tap on a title row (no lift) swallows nothing: its own tap target still works');
  p.destroy();
}

// ── 8.14c a stale `visible` list never arms (a wrong index would be a wrong write) ──
{
  const w = makeWorld();
  const warns = []; const origWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  w.opts.visible = () => ['dash-alma', 'dash-picks', 'dash-summary', 'dash-tiebreaker'];       // order differs from the DOM
  w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(800);
  assert(!w.lifted() && NG.touchClaimedBy() === null && w.setEditingCalls.length === 0 && w.haptics.length === 0, '[8ft] opts.visible that disagrees with the DOM order never arms: no claim, no haptic, no edit mode');
  assert(warns.length === 1 && /do not match/.test(warns[0]), '[8fu] …and says so, once, loudly (a wiring bug must not be silent)');
  w.touchEnd(w.titleTouch(0));
  w.opts.visible = () => ['dash-picks', 'dash-alma', 'dash-summary'];                           // a hidden section the DOM still has
  w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(800);
  assert(!w.lifted(), '[8fv] opts.visible with a different COUNT than the DOM never arms either');
  console.warn = origWarn;
  w.touchEnd(w.titleTouch(0)); w.destroy();
}

// ── 8.15 attach idempotency, repaint rebinding, detach (AT12: anonymous = zero press listeners) ──
{
  const w = makeWorld();
  const n0 = w.container.listeners.length;
  const blockers0 = w.headers.reduce((a, h) => a + h.listeners.length, 0);
  for (let i = 0; i < 5; i++) w.attach();
  assert(w.container.listeners.length === n0 && w.headers.reduce((a, h) => a + h.listeners.length, 0) === blockers0, '[8eo] attach on every paint binds the container ONCE and each title row ONCE');
  assert(w.win.listeners.length === 1 && w.doc.listeners.filter((l) => l.type === 'keydown').length === 1, '[8ep] the global scroll and keydown listeners are bound once, however many paints');
  // a repaint replaces the rows: the new rows get their blocker, the old ones are garbage
  const fresh = new FEl('div', { 'data-section-header': '' }, w.doc); w.sections[0].appendChild(fresh);
  w.attach();
  assert(fresh.listeners.filter((l) => l.type === 'touchmove' && !l.passive).length === 1, '[8eq] a freshly painted title row gets its blocker on the next attach');
  assert(w.container._sectionDragWired && w.container._sectionDragOpts === w.opts, '[8er] the container remembers its wiring and the LATEST opts (a stale closure is never read)');
  const newOpts = { ...w.opts, visible: () => w.ids };
  w.ctl.attach(w.container, newOpts);
  assert(w.container._sectionDragOpts === newOpts, '[8es] each paint replaces the opts');
  // detach: signed out / blind-gate screen / fewer than two sections => ZERO press listeners
  w.ctl.detach(w.container);
  assert(w.container.listeners.length === 0, '[8et] AT12: after detach the container has ZERO listeners');
  assert(w.headers.every((h) => h.listeners.length === 0), '[8eu] …and no title row carries a blocker');
  w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(800);
  assert(!w.lifted() && NG.touchClaimedBy() === null, '[8ev] a detached container never lifts');
  w.touchEnd(w.titleTouch(0));
  assert(w.ctl.attach(w.container, { ...w.opts, visible: () => ['only-one'] }) === false && w.container.listeners.length === 0, '[8ew] fewer than two visible sections: attach refuses and leaves no listener');
  assert(w.ctl.attach(w.container, null) === false && w.ctl.attach(null, w.opts) === false, '[8ex] missing arguments are refused, not thrown on');
  w.ctl.attach(w.container, w.opts);
  w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(500);
  assert(w.lifted(), '[8ey] re-attaching revives the binder');
  w.touchEnd(w.titleTouch(0)); w.finish();
  w.destroy();
  assert(w.win.listeners.length === 0 && w.doc.listeners.length === 0, '[8ez] destroy() removes the global listeners too (nothing leaks between sessions)');
}

// ── 8.16 error safety: a throwing write never leaks the claim or the inline styles ──
{
  const w = makeWorld();
  w.opts.onReorder = () => { throw new Error('write failed'); };
  const t = w.titleTouch(0);
  w.touchStart(t, 180, 122); w.clock.advance(500); w.touchMove(t, 180, 318); w.touchEnd(t);
  quietConsole(() => w.finish());
  assert(NG.touchClaimedBy() === null && !w.ctl.isBusy(), '[8fa] a throwing onReorder: the claim is released and the controller idle (no stale claim silencing the swipes)');
  assert(w.sections.every((s) => s.style.transform === '' && !s.hasAttribute('data-lifted') && !s.hasAttribute('data-settling')), '[8fb] …and the inline transforms and markers are cleared');
  assert(w.ctl._moved().moved === false, '[8fc] …and a failed write is not remembered as a move');
  w.destroy();
}

// ── 8.17 the effects of the DEFAULT dependency resolution ──
{
  const calls = [];
  const fakeNav = {
    claimTouch: () => true, releaseTouch: () => {}, touchClaimedBy: () => 'section-drag', prefersReducedMotion: () => false, deferRenderWhileWeekSwiping: () => false,
    gesturesSuspended: (o) => { calls.push(o); return false; },
  };
  const w = makeWorld({ ctlOver: { nav: fakeNav, suspended: undefined, claimTouch: undefined, releaseTouch: undefined, touchClaimedBy: undefined, prefersReducedMotion: undefined, releaseAndFlush: undefined, deferRender: undefined } });
  w.touchStart(w.titleTouch(0), 100, w.rowY(0)); w.clock.advance(500);
  assert(calls.length >= 1 && calls.every((o) => o && o.ignoreLayoutBar === true), '[8fd] the default gate asks gesturesSuspended({ ignoreLayoutBar: true }): the lift/drag is never frozen by this feature\'s own bar (DI-476)');
  assert(w.lifted(), '[8fe] a controller built from an injected nav module lifts through that nav module\'s claim functions');
  w.touchEnd(w.titleTouch(0)); w.finish(); w.destroy();
  const calls2 = [];
  const nav2 = { ...fakeNav, claimTouch: () => true, releaseTouch: (o) => calls2.push('release:' + o), releaseTouchAndFlush: (o) => calls2.push('flush:' + o), touchClaimedBy: () => 'section-drag' };
  const w2 = makeWorld({ ctlOver: { nav: nav2, suspended: undefined, claimTouch: undefined, releaseTouch: undefined, touchClaimedBy: undefined, prefersReducedMotion: undefined, releaseAndFlush: undefined, deferRender: undefined } });
  w2.touchStart(w2.titleTouch(0), 100, w2.rowY(0)); w2.clock.advance(500); w2.touchEnd(w2.titleTouch(0)); w2.finish();
  assert(calls2.includes('flush:section-drag'), '[8ff] when nav-gestures exports releaseTouchAndFlush (DI-476) the drop uses it');
  w2.destroy();
}

// ── 8.18 the header scrolls AWAY with the page (SP-57 wiring, 2026-10-01: `.app-header{position:relative}`, the design input assumed sticky) ──
{
  const w = makeWorld({ ids: ['dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker'], heights: [900, 200, 330, 96], scrollHeight: 2200 });
  const hdr = w.doc.root.querySelector('.app-header');
  hdr.layout.fixed = false;                                  // the header lives in the page: at scrollY 1000 its bottom is 60 − 1000 = −940
  w.win.scrollY = 1000;
  const t = w.titleTouch(1);                                 // Alma Mater's title: document y 1016, so viewport y 16 (rowY = 38)
  w.touchStart(t, 180, w.rowY(1)); w.clock.advance(500);
  assert(w.lifted(), '[8ha] fixture — lifted with the header scrolled a thousand points off');
  w.win.scrollCalls.length = 0;
  w.touchMove(t, 180, 60);                                   // 8 pt inside the top zone (edge 52 = visible header 0 + the 52 pt bar)
  w.clock.advance(200);
  assert(w.win.scrollCalls.length > 0 && w.win.scrollCalls.every((c) => c.top < 0),
    '[8hb] with the header scrolled away the top auto-scroll zone is still reachable: the edge is the bar\'s bottom at the viewport top (52), not the header\'s negative rect bottom — a finger 8 pt into the zone scrolls UP');
  w.touchMove(t, 180, 52 + EDGE_ZONE_PX + 8); w.win.scrollCalls.length = 0; w.clock.advance(100);
  assert(w.win.scrollCalls.length === 0, '[8hc] …and a finger just below that zone does not');
  w.touchEnd(t); w.finish(); w.destroy();
  // Done: a moved section whose title is ABOVE the viewport is scrolled back to 16 pt under the visible top, not left off-screen.
  const d = makeWorld({ scrollHeight: 2200 });
  d.doc.root.querySelector('.app-header').layout.fixed = false;
  const dt = d.titleTouch(0);
  d.touchStart(dt, 180, 122); d.clock.advance(500); d.touchMove(dt, 180, 318); d.touchEnd(dt); d.finish();
  d.win.scrollY = 900; d.headers[0].layout.top = 700; d.sections[0].layout.top = 700; d.win.scrollCalls.length = 0;   // the title is now at viewport y −200
  d.ctl.requestDone('done');
  assert(d.win.scrollCalls.length === 1 && d.win.scrollCalls[0].top === -200 - 16,
    `[8hd] Done scrolls a moved section whose title is above the viewport back into view even though the (non-sticky) header is long gone (got ${JSON.stringify(d.win.scrollCalls)})`);
  d.destroy();
}

// ── 8.18b the safe area through the binder (SP-57 wiring): the top zone starts at the BAR's bottom, which sits under max(visible header, inset) ──
{
  const w = makeWorld({ ids: ['dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker'], heights: [900, 200, 330, 96], scrollHeight: 2200 });
  const hdr = w.doc.root.querySelector('.app-header');
  hdr.layout.fixed = false;
  w.win.getComputedStyle = (el) => ({ paddingTop: el === hdr ? '59px' : '0px' });       // the header's padding-top IS env(safe-area-inset-top)
  w.win.scrollY = 1000;
  const t = w.titleTouch(1);
  w.touchStart(t, 180, w.rowY(1)); w.clock.advance(500);
  assert(w.lifted(), '[8hia] fixture — lifted with the header scrolled away and a 59 pt inset');
  w.win.scrollCalls.length = 0;
  w.touchMove(t, 180, 59 + 52 + 6); w.clock.advance(150);
  assert(w.win.scrollCalls.length > 0 && w.win.scrollCalls.every((c) => c.top < 0), '[8hib] the top zone starts at the inset plus the bar (59 + 52 = 111): a finger 6 pt under it scrolls UP');
  w.touchMove(t, 180, 59 + 52 + EDGE_ZONE_PX + 8); w.win.scrollCalls.length = 0; w.clock.advance(100);
  assert(w.win.scrollCalls.length === 0, '[8hic] …and one just below that zone (y 191) does not: the zone is 111-183, not the 52-124 it would be without the inset');
  w.touchMove(t, 180, 150); w.win.scrollCalls.length = 0; w.clock.advance(100);
  assert(w.win.scrollCalls.length > 0 && w.win.scrollCalls.every((c) => c.top < 0), '[8hid] a finger at 150 is OUTSIDE the zone a bar at the viewport top would have (52-124) but INSIDE the real one (111-183): it scrolls up');
  w.touchEnd(t); w.finish(); w.destroy();
  // With the bar MOUNTED the engine measures the bar itself.
  const b = makeWorld({ ids: ['dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker'], heights: [900, 200, 330, 96], scrollHeight: 2200 });
  const bar = new FEl('div', { id: 'layout-edit-bar' }, b.doc); bar.layout = { top: 80, height: 52, fixed: true }; b.doc.body.appendChild(bar);          // bottom = 132
  const bt = b.titleTouch(1);
  b.win.scrollY = 1000;
  b.touchStart(bt, 180, b.rowY(1)); b.clock.advance(500);
  b.win.scrollCalls.length = 0; b.touchMove(bt, 180, 132 + 6); b.clock.advance(150);
  assert(b.win.scrollCalls.length > 0 && b.win.scrollCalls.every((c) => c.top < 0), '[8hie] with #layout-edit-bar mounted the top edge is ITS measured bottom (132): a finger 6 pt under it scrolls up');
  b.touchMove(bt, 180, 132 + EDGE_ZONE_PX + 8); b.win.scrollCalls.length = 0; b.clock.advance(100);
  assert(b.win.scrollCalls.length === 0, '[8hif] …and one just below that zone does not');
  b.touchEnd(bt); b.finish(); b.destroy();
  // Done: the moved section is scrolled to 16 pt under the INSET, not under y = 0.
  const d = makeWorld({ scrollHeight: 2200 });
  const dh = d.doc.root.querySelector('.app-header'); dh.layout.fixed = false;
  d.win.getComputedStyle = (el) => ({ paddingTop: el === dh ? '59px' : '0px' });
  const dt = d.titleTouch(0);
  d.touchStart(dt, 180, 122); d.clock.advance(500); d.touchMove(dt, 180, 318); d.touchEnd(dt); d.finish();
  d.win.scrollY = 700; d.headers[0].layout.top = 740; d.sections[0].layout.top = 740; d.win.scrollCalls.length = 0;      // the title is at viewport y 40: inside the status-bar band
  d.ctl.requestDone('done');
  assert(d.win.scrollCalls.length === 1 && d.win.scrollCalls[0].top === 40 - (59 + 16), `[8hig] a moved section whose title is inside the status-bar band (y 40 < inset 59 + 8) is scrolled to 16 pt under the INSET (got ${JSON.stringify(d.win.scrollCalls)})`);
  d.destroy();
}

// ── 8.19 the iOS 15.0 target: an engine that REJECTS behavior:'instant' must not abort a drag or a drop (SP-57 wiring) ──
{
  const old = makeWorld({ ids: ['dash-picks', 'dash-alma', 'dash-summary', 'dash-tiebreaker'], heights: [900, 200, 330, 96], scrollHeight: 2200 });
  const rejected = [];
  old.win.scrollBy = function scrollBy(a, b) {                // the old numeric-only form; the options form throws, as an unknown enum value does
    if (typeof a === 'object') { rejected.push(a.behavior); throw new TypeError("The provided value 'instant' is not a valid enum value of type ScrollBehavior."); }
    this.scrollY = Math.min(Math.max(0, this.scrollY + b), Math.max(0, old.doc.root.scrollHeight - this.innerHeight));
    this.numericCalls = (this.numericCalls || 0) + 1;
  };
  old.win.scrollTo = function scrollTo(a, b) {
    if (typeof a === 'object') throw new TypeError('invalid behavior');
    this.scrollY = b;
  };
  const t = old.titleTouch(1);
  old.touchStart(t, 180, old.rowY(1)); old.clock.advance(500);
  old.touchMove(t, 180, 640);                                  // the bottom edge
  old.clock.advance(600);
  assert(old.lifted() && rejected.length > 0 && old.win.numericCalls > 20 && old.win.scrollY > 300,
    `[8ia] a window that throws on scrollBy({ behavior:'instant' }) falls back to the numeric form: the drag is NOT aborted and the page still auto-scrolls (${rejected.length} rejected option calls, ${old.win.numericCalls} numeric calls, scrollY ${old.win.scrollY})`);
  old.touchMove(t, 180, 400); old.clock.advance(100);
  old.touchEnd(t);
  old.finish();
  assert(!old.ctl.isBusy() && NG.touchClaimedBy() === null, '[8ib] …and the drop completes and gives the touch back even though scrollTo({ behavior }) throws');
  assert(scrollWindow({}, { top: 5, left: 0 }) === false && scrollWindow(null, { top: 5 }) === false && scrollWindow({ scrollBy() { throw new Error('x'); } }, { top: 5, left: 0 }) === false,
    '[8ic] scrollWindow never throws: no window, no scroll API, or a window whose every form throws is a quiet false');
  old.destroy();
}

// ── 8.20 the persistent live region is in the document BEFORE the first announcement (VoiceOver does not reliably speak a region created and filled in one task) ──
{
  const w = makeWorld();
  assert(!!w.doc.getElementById('layout-live') && w.doc.getElementById('layout-live').getAttribute('aria-live') === 'polite' && w.doc.getElementById('layout-live').textContent === '',
    '[8ja] attach() creates #layout-live (polite, empty) on the first paint that has anything to rearrange, before any announcement is made');
  w.ctl.attach(w.container, w.opts); w.ctl.attach(w.container, w.opts);
  assert(w.doc.root.querySelectorAll('#layout-live').length === 1, '[8jb] …and re-attaching on every repaint never creates a second one (idempotent)');
  const bad = { body: {}, getElementById: () => null, createElement: () => ({}) };            // a stub whose "element" has no setAttribute (layouttest's DOM)
  assert(ensureLayoutLive(bad) === null && announceLayout('x', { doc: bad }) === false, '[8jc] a document that cannot make a real element means "no live region", never a throw (announcing is best effort)');
  w.destroy();
}

// ═════════════════════════════════════════════════════════════════════════
// [9] structure: imports, purity, the blind rule's surface
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[9] structure — a leaf module, no top-level side effects, no pick data…');
{
  const code = readFileSync(new URL('./js/section-drag.js', import.meta.url), 'utf8');
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const imports = [...stripped.matchAll(/^import\s[^;]*from\s+'([^']+)';/gm)].map((m) => m[1]).sort();
  assert(JSON.stringify(imports) === JSON.stringify(['./haptics.js', './icons.js', './nav-gestures.js']), `[9a] a LEAF module: it imports only nav-gestures.js, haptics.js and icons.js (got ${JSON.stringify(imports)}), never app.js or storage.js`);
  assert(!/localStorage|sessionStorage|getPicks|getPlayers|getWeek|import\(/.test(stripped), '[9b] STRUCTURE ONLY (this is a source scan, not a blind-rule test): the module has no storage access, no pick / player / week accessor and no dynamic import, so it has nothing to leak; the blind rule itself is exercised where picks render');
  assert(!/\.then\(|\bvar\s/.test(stripped), '[9c] house style: no .then() chains, no var');
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(stripped), '[9d] no hard-coded hex colour in the module');
  assert(/behavior: 'instant'/.test(stripped) && /passive: false/.test(stripped), '[9e] canary: the two load-bearing literals the mutation proofs target are present');
  // top-level purity: importing the module (already done above) registered nothing on a fresh fake global
  assert(typeof globalThis.document === 'undefined' && typeof globalThis.window === 'undefined', '[9f] fixture: the import ran with no DOM at all (the harness imports it under bare Node)');
  const exportsList = Object.keys(SD);
  assert(['attachSectionDrag', 'detachSectionDrag', 'requestDone', 'requestReset', 'cancelSectionDrag', 'pressStep', 'isSectionHandle', 'nearestSlot', 'autoScrollSpeed', 'SECTION_DRAG_TOUCH_OWNER', 'SECTION_LONG_PRESS_MS'].every((k) => exportsList.includes(k)),
    '[9g] the DI-385 contract surface is exported');
  // The default controller is lazy and resettable
  SD._resetSectionDragForTest();
  assert(SD.isSectionDragActive() === false, '[9h] the default controller is lazy: nothing is active before anything is attached');
  SD._resetSectionDragForTest();
}

// ═════════════════════════════════════════════════════════════════════════
// [E] the REAL app in a real browser — AT1-AT21's engine-measured half (wiring step, 2026-10-01)
// ═════════════════════════════════════════════════════════════════════════
//
// WHAT THIS HALF IS. The real index.html, css/styles.css and js/app.js booted in headless Chromium (the
// weekswipetest.mjs recipe: local mode, this suite's own localhost server answering /config.json with {} and 404ing the
// service worker, ALL other network blocked), six players and four final weeks seeded through the app's OWN
// js/storage.js + js/data-model.js, the Dashboard and Standings opened through the real window.navigateTo(), and every
// gesture a REAL touch (CDP Input.dispatchTouchEvent) or mouse (Input.dispatchMouseEvent) sequence hit-tested by the
// engine. Nothing here is a fixture of the page, the binders, the stylesheet or the section markup. A missing
// browser is a FAILURE (never a skip), exactly as in weekswipetest.mjs.
//
// WHAT IT CANNOT PROVE. Blink is not WebKit: the feel of the haptic, the WKWebView scroll and bounce, the iOS callout and
// magnifier, how iOS treats the one non-passive touchmove on the title rows, VoiceOver / Switch Control / Voice Control.
// Those are Drew's on-device checklist (DI-389). Every row below is "engine-verified", never "device-verified".
//
// Override the browser: SDT_ENGINE=/path/to/Chromium. Mutation runs: SDT_ROOT=/path/to/a/COPY/of/cfb-pickems serves that
// tree instead of this one — mutate the copy, never this checkout.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

console.log('\n[E0] engine — the real app, real touches…');
const E_HERE = fileURLToPath(new URL('.', import.meta.url));
const E_ROOT = process.env.SDT_ROOT || E_HERE;
const E_ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const E_OVERRIDE = process.env.SDT_ENGINE || process.env.WEEKSWIPE_ENGINE || process.env.WIZTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const E_BIN = E_OVERRIDE || E_ENGINES.find((p) => existsSync(p));
assert(!!E_BIN && existsSync(E_BIN), !E_BIN
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: SDT_ENGINE=/path/to/Chromium node sectiondragtest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${E_ENGINES.join(', ')}`
  : `[E0a] engine to measure in: ${E_BIN}${E_OVERRIDE ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', '[E0b] this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
if (E_ROOT !== E_HERE) console.log(`  (SDT_ROOT — serving ${E_ROOT})`);

const E_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const eServer = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; }
  if (p === '/service-worker.js') { res.writeHead(404); res.end(); return; }
  // App files only: no dot-segments, no dotfiles (.env*, .git…), nothing under /supabase/ (tests/.env* live there).
  if (p.split('/').some((seg) => seg.startsWith('.')) || p.startsWith('/supabase/') || p === '/supabase') { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(E_ROOT, p));
    res.writeHead(200, { 'content-type': E_TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => eServer.listen(0, '127.0.0.1', r));
const E_ORIGIN = `http://127.0.0.1:${eServer.address().port}`;
const eTmp = mkdtempSync(join(tmpdir(), 'cfbp-sdt-'));
const eSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function eLaunch() {
  const proc = spawn(E_BIN, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(eTmp, 'profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps',
    '--disable-extensions', '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', (d) => { buf += d.toString(); const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(t); res({ proc, ws: m[0] }); } });
    proc.on('error', (e) => { clearTimeout(t); rej(e); });
  });
}
async function eAttach(browserWs) {
  const list = await (await fetch('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true }); });
  let id = 0; const pending = new Map(); const waiters = []; const events = [];
  sock.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) { events.push(msg); waiters.filter((w) => w.method === msg.method).forEach((w) => w.res(msg)); }
  });
  // A DevTools call that never answers must FAIL the suite, not hang the harness (a hung browser held loadtest for its whole timeout once).
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    const timer = setTimeout(() => { pending.delete(myId); rej(new Error(method + ' → no answer within 30 s')); }, 30000);
    pending.set(myId, (m) => { clearTimeout(timer); return m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result); });
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once, events };
}

let eEngine = null;
// Whole-half watchdog: if anything wedges, kill the browser and fail loudly well inside loadtest's 300 s spawn timeout.
const eWatchdog = setTimeout(() => { console.error('  ❌ [E] watchdog — the engine-measured half did not finish within 500 s'); try { eEngine?.proc.kill(); } catch { /* gone */ } process.exit(1); }, 500000);
try {
  if (!E_BIN) throw new Error('no engine binary');
  eEngine = await eLaunch();
  const pg = await eAttach(eEngine.ws);
  await pg.send('Page.enable');
  await pg.send('Runtime.enable');
  const pageErrors = [];
  pg.events.push = ((orig) => function push(...a) {
    for (const m of a) {
      if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('console.error: ' + m.params.args.map((x) => x.value ?? x.description).join(' '));
    }
    return orig.apply(this, a);
  })(pg.events.push);
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) { if (await evaluate(`!!(${expression})`)) return true; await eSleep(100); }
    return false;
  };
  const navigate = async () => { const loaded = pg.once('Page.loadEventFired'); await pg.send('Page.navigate', { url: E_ORIGIN + '/index.html' }); await loaded; };
  const viewport = async (w, h) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (let t = 0; t < 3000; t += 50) { if ((await evaluate('innerWidth')) === w) break; await eSleep(50); }
    await eSleep(150);
  };
  const reducedMotion = async (on) => {
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
    await eSleep(50);
  };
  // Real touches, hit-tested by the engine. `touch` keeps the finger's last point so a caller can move and release in steps.
  const touch = {
    async down(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); },
    // Chrome delivers touchmove aligned to the next frame, so wait one frame before anything reads what the move did.
    async move(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await eSleep(16); await evaluate('new Promise(r => requestAnimationFrame(() => r(true)))'); },
    async up() { await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
    async cancel() { await pg.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); },
    // A second finger: both points are sent, the first stays where it was.
    async second(x, y) { await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: this.x, y: this.y, id: 0 }, { x, y, id: 1 }] }); },
  };
  const mouse = {
    async down(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); },
    async move(x, y) { this.x = x; this.y = y; await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await eSleep(16); },
    async up() { await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: this.x, y: this.y, button: 'left', buttons: 0, clickCount: 1 }); },
  };
  // ── what the page is showing: the layout state read off the DOM and the (shared, unversioned) nav-gestures module ──
  const LAYOUT = (page) => `(async () => {
    const nav = await import('./js/nav-gestures.js');
    const host = document.getElementById('${page}');
    const secs = [...host.querySelectorAll('.layout-section')];
    const bar = document.getElementById('layout-edit-bar');
    return {
      claim: nav.touchClaimedBy(), editing: host.classList.contains('layout-editing'), bar: !!bar,
      lifted: secs.filter((s) => s.hasAttribute('data-lifted')).map((s) => s.dataset.sectionId),
      pressing: [...host.querySelectorAll('.section-pressing')].length,
      order: secs.map((s) => s.dataset.sectionId), sy: Math.round(scrollY),
      grips: host.querySelectorAll('.layout-grip').length,
    };
  })()`;
  const DASH = 'page-dashboard';
  const STAND = 'page-leaderboard';
  const layout = (page) => evaluate(LAYOUT(page));
  /** Viewport rect of a section's title row (the press target) and of the section. */
  const rectOf = (page, id, what = 'header') => evaluate(`(() => {
    const s = document.querySelector('#${page} .layout-section[data-section-id="${id}"]');
    const el = ${what === 'header' ? `s.querySelector('[data-section-header]')` : 's'};
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
  })()`);
  /** The point to press on a title row: the title's own text (a wrapped web header has the density toggle on a second line, and the
   *  toggle is a control that never arms a press), or the row itself when it has no .card-title. */
  const titlePoint = (page, id) => evaluate(`(() => {
    const s = document.querySelector('#${page} .layout-section[data-section-id="${id}"]');
    const h = s.querySelector('[data-section-header]');
    const t = h.querySelector('.card-title') || h;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(24, r.width / 2)), y: Math.round(r.top + r.height / 2) };
  })()`);
  /** Scroll so the section's title row sits `at` px below the viewport top, instantly (the page has html{scroll-behavior:smooth}). */
  const scrollHeaderTo = async (page, id, at = 220) => {
    const r = await rectOf(page, id);
    await evaluate(`window.scrollTo({ top: ${Math.round(await evaluate('scrollY') + r.top - at)}, left: 0, behavior: 'instant' })`);
    // The engine refuses to arm a press for a touch that lands within 120 ms of a scroll event (momentum scrolling, B2): a
    // programmatic scroll here is not a finger's, but it fires the same event, so wait it out with real slack.
    await eSleep(320);
    return rectOf(page, id);
  };
  const goto = async (tab, page) => {
    await evaluate(`window.navigateTo('${tab}')`);
    await waitFor(`document.querySelector('#${page}.active .layout-section')`);
    await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
    await eSleep(150);
  };
  /** Back to a clean slate between cases: end any mode, release any touch, no saved order. */
  const resetLayoutWorld = async () => {
    try { await touch.cancel(); } catch { /* nothing down */ }
    await evaluate(`(async () => {
      const st = await import('./js/storage.js');
      st.clearSectionOrder('dashboard'); st.clearSectionOrder('standings');
      const nav = await import('./js/nav-gestures.js');
      nav.releaseTouch('section-drag'); nav.releaseTouch('column-reorder'); nav.releaseTouch('week-swipe');
      document.getElementById('layout-edit-bar')?.querySelector('.layout-bar-done')?.click();
      return true;
    })()`);
    await eSleep(350);
  };
  /** Hold the title row of `id` for `ms` with a still finger and report the state at that moment (then optionally lift the finger). */
  const holdTitle = async (page, id, ms, { release = true, dx = 0, dy = 0, at = 220 } = {}) => {
    const r = await scrollHeaderTo(page, id, at);
    const tp = await titlePoint(page, id);
    const x = tp.x + dx, y = tp.y + dy;
    await touch.down(x, y);
    await eSleep(ms);
    const st = await layout(page);
    if (release) { await touch.up(); await eSleep(380); }   // clear of the engine's 260 ms settle
    return { st, x, y, rect: r };
  };

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E1] Boot the REAL app (local mode), seed six players and four final weeks with picks and a tiebreaker…');
  // ═════════════════════════════════════════════════════════════════════
  await viewport(390, 844);
  await navigate();
  assert(await waitFor(`document.getElementById('site-gate-overlay') || document.querySelector('.page-wrapper')`), '[E1a] fixture — the real index.html + js/app.js booted in the engine');
  const seeded = await evaluate(`(async () => {
    localStorage.setItem('cfbp_site_unlocked', '1');
    const st = await import('./js/storage.js'); const dm = await import('./js/data-model.js');
    const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
    const players = NAMES.map((n) => ({ ...dm.createPlayer(n, '', '1234', '', n.slice(0, 2).toUpperCase()), playerId: 'pl_' + n.toLowerCase() }));
    players.forEach((p) => st.savePlayer(p));
    const picks = [];
    for (let wn = 1; wn <= 4; wn++) {
      const wk = { ...dm.createWeek(2026, wn), weekId: 'wk_' + wn, status: 'final', tiebreakerQuestion: 'Total points in the night game?' };
      st.saveWeek(wk);
      for (let gi = 0; gi < 8; gi++) {
        const g = dm.createGame(wk.weekId, { gameId: 'g_' + wn + '_' + gi, homeTeam: 'Home ' + wn + '-' + gi, awayTeam: 'Away ' + wn + '-' + gi,
          kickoff: new Date(Date.UTC(2026, 8, wn * 7, 17 + (gi % 4))).toISOString(), kickoffConfirmed: true,
          spread: -3.5, lockedSpread: -3.5, homeScore: 24 + gi, awayScore: 17, status: 'final' });
        st.saveGame(g);
        players.forEach((p, pi) => picks.push({ ...dm.createPick(wk.weekId, g.gameId, p.playerId, (gi + pi) % 2 ? g.homeTeam : g.awayTeam),
          pickId: 'pk_' + wn + '_' + gi + '_' + pi, submittedAt: '2026-09-01T00:00:00Z' }));
      }
    }
    st.saveAllPicks(picks);
    st.setActiveWeekId('wk_2');
    st.setSession('pl_drew', false, true);
    await new Promise((r) => setTimeout(r, 1200));
    return { players: st.getPlayers().filter((p) => p.playerId.startsWith('pl_')).length, weeks: st.getWeeks().filter((w) => w.weekId.startsWith('wk_')).length };
  })()`);
  assert(seeded.players === 6 && seeded.weeks === 4, `[E1b] fixture — 6 players and 4 final weeks seeded through the app's own storage.js (got ${JSON.stringify(seeded)})`);
  await navigate();
  assert(await waitFor(`!document.getElementById('site-gate-overlay') && window.navigateTo`), '[E1c] fixture — after reload the app is past the site gate with a verified player session');
  // Toasts live 3.5 s, so a count of the DOM is a race; log every toast the app raises instead.
  await evaluate(`(() => { window.__toastLog = []; new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toastLog.push(n.textContent.trim()); })
    .observe(document.getElementById('toast-container'), { childList: true }); return true; })()`);
  await goto('dashboard', DASH);
  const boot = await evaluate(`({ ids: [...document.querySelectorAll('#page-dashboard .layout-section')].map((s) => s.dataset.sectionId),
    chips: document.querySelectorAll('#page-dashboard .dc-chip[draggable="true"]').length, vw: innerWidth,
    smooth: getComputedStyle(document.documentElement).scrollBehavior, coarse: matchMedia('(hover:none) and (pointer:coarse)').matches })`);
  assert(boot.ids.join() === 'dash-picks,dash-alma,dash-summary,dash-tiebreaker' && boot.chips >= 12,
    `[E1d] fixture — the Dashboard shows its four sections in default order in the COMPACT layout with draggable chips (${boot.chips}); got ${boot.ids.join()}`);
  assert(boot.smooth === 'smooth' && boot.coarse === true,
    `[E1e] fixture — the REAL stylesheet's html{scroll-behavior:smooth} is in effect (AT20's trap is live), and the emulation matches (hover:none) and (pointer:coarse) (got ${boot.smooth} / ${boot.coarse})`);
  await goto('leaderboard', STAND);
  const standBoot = await evaluate(`[...document.querySelectorAll('#page-leaderboard .layout-section')].map((s) => s.dataset.sectionId)`);
  assert(standBoot.join() === 'stand-season,stand-extrapoint,stand-alma,stand-history,stand-2025-open,stand-2025-record',
    `[E1f] fixture — Standings shows all SIX sections in default order (the pilot league's two 2K25 sections included), so all TEN title rows exist; got ${standBoot.join()}`);
  await goto('dashboard', DASH);

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E2] AT13 / AT16 — the hidden path is PERMANENT (edit mode OFF), and the Edit layout button is gone…');
  // ═════════════════════════════════════════════════════════════════════
  const HIDDEN = (page) => `(() => {
    const host = document.getElementById('${page}');
    const secs = [...host.querySelectorAll('.layout-section')];
    const per = secs.map((s) => { const bar = s.firstElementChild; const isBar = !!bar && bar.classList.contains('section-move-bar'); const btns = isBar ? [...bar.querySelectorAll('button')] : [];
      return { id: s.dataset.sectionId, first: isBar, names: btns.map((b) => b.getAttribute('aria-label')),
        text: btns.map((b) => b.textContent.trim()), dis: btns.map((b) => b.disabled), dir: btns.map((b) => b.dataset.moveDir) }; });
    const reset = [...host.querySelectorAll('.layout-reset-btn')];
    const bars = [...host.querySelectorAll('.section-move-bar')];
    const cs = bars.map((b) => { const c = getComputedStyle(b); const r = b.getBoundingClientRect(); return { display: c.display, vis: c.visibility, w: r.width, h: r.height, pos: c.position }; });
    const btnCs = [...host.querySelectorAll('.section-move-btn')].map((b) => { const c = getComputedStyle(b); return { display: c.display, vis: c.visibility }; });
    return { per, resetN: reset.length, resetName: reset[0]?.getAttribute('aria-label'), resetText: reset[0]?.textContent.trim(), resetPage: reset[0]?.dataset.layoutPage, cs, btnCs,
      ariaHidden: !!host.querySelector('.section-move-bar[aria-hidden], .section-move-bar [aria-hidden]'),
      editing: host.classList.contains('layout-editing'), live: !!document.getElementById('layout-live'), bar: !!document.getElementById('layout-edit-bar'),
      headBtn: !!host.querySelector('.section-header button'), headText: host.querySelector('.section-header')?.textContent.trim() };
  })()`;
  for (const [tab, page, label] of [['dashboard', DASH, 'Dashboard'], ['leaderboard', STAND, 'Standings']]) {
    await resetLayoutWorld();
    await goto(tab, page);
    const h = await evaluate(HIDDEN(page));
    const n = h.per.length;
    const names = h.per.flatMap((p) => p.names);
    assert(h.editing === false && h.bar === false, `[E2-${label}-0] fixture — edit mode is OFF and no bar is mounted`);
    assert(h.per.every((p) => p.first && p.names.length === 2 && p.dir.join() === 'up,down'), `AT13 (${label}): EVERY one of the ${n} wrappers carries the Move up / Move down pair as its first child, with edit mode OFF`);
    assert(new Set(names).size === names.length && names.every((m) => /^Move .+ (up|down)$/.test(m)), `AT13 (${label}): the ${names.length} accessible names are all unique ("Move <Section> up|down")`);
    assert(h.per.every((p) => p.text.join('|') === p.names.join('|')), `AT13 (${label}): …and each visible text IS its accessible name (Label in Name: Voice Control and Switch Control select by name)`);
    assert(h.per[0].dis.join() === 'true,false' && h.per[n - 1].dis.join() === 'false,true' && h.per.slice(1, n - 1).every((p) => p.dis.join() === 'false,false'),
      `AT13 (${label}): the first section's Up and the last section's Down are disabled — disabled, never hidden — and every other button is enabled`);
    assert(h.cs.every((c) => c.display !== 'none' && c.vis !== 'hidden') && h.btnCs.every((c) => c.display !== 'none' && c.vis !== 'hidden') && h.ariaHidden === false,
      `AT13 (${label}): computed style of every hidden bar and button is never display:none / visibility:hidden, and nothing inside carries aria-hidden — they stay in the accessibility tree`);
    assert(h.cs.every((c) => c.w <= 1.01 && c.h <= 1.01 && c.pos === 'absolute'), `AT13 (${label}): …they are the .sr-only 1 px clipped box (a screen-reader-only presence, nothing painted)`);
    assert(h.resetN === 1 && h.resetPage === (tab === 'dashboard' ? 'dashboard' : 'standings') && h.resetName === `Reset ${label} layout to default` && h.resetText === h.resetName,
      `AT13 (${label}): exactly ONE hidden Reset twin, named for its page ("${h.resetName}")`);
    assert(h.headBtn === false && !/Edit layout/i.test(h.headText || '') && /^(Dashboard|Standings)/.test(h.headText || ''),
      `AT16 (${label}): the heading carries NO button and no "Edit layout" text — it is the plain .section-header ("${(h.headText || '').slice(0, 40)}")`);
  }
  // Anonymous: no press binder (zero listeners the engine registered), no hidden buttons, no live region, the default order.
  {
    await resetLayoutWorld();
    await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession(null, false, false); return true; })()`);
    await goto('dashboard', DASH);
    const anon = await evaluate(HIDDEN(DASH));
    assert(anon.per.every((p) => p.names.length === 0) && anon.resetN === 0 && anon.headBtn === false && anon.bar === false,
      'AT13/AT12: a SIGNED-OUT viewer gets NO hidden Move buttons, no Reset twin and no button anywhere in the heading (DI-179g: the one canCustomizeLayout() gate)');
    const anonLift = await holdTitle(DASH, 'dash-alma', 700);
    assert(anonLift.st.lifted.length === 0 && anonLift.st.claim === null && !anonLift.st.editing && !anonLift.st.bar,
      'AT12: …and a 700 ms hold on a title row lifts NOTHING while signed out (no press binder is attached)');
    await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSession('pl_drew', false, true); return true; })()`);
    await goto('dashboard', DASH);
    const back = await evaluate(HIDDEN(DASH));
    assert(back.per.every((p) => p.names.length === 2) && back.resetN === 1, 'AT13: …and signing back in brings the whole hidden path back on the next paint');
  }
  // AT16 negative control: a CLICK on a heading or a title row never enters edit mode; only a fired hold does.
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    const click = async (x, y) => {
      await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await eSleep(150);
    };
    const head = await evaluate(`(() => { const r = document.querySelector('#page-dashboard .section-header').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
    await click(head.x, head.y);
    let st = await layout(DASH);
    assert(!st.editing && !st.bar && st.lifted.length === 0, 'AT16: a quick click on the page heading never sets edit mode (negative control for the hold)');
    const tr = await scrollHeaderTo(DASH, 'dash-alma', 220);
    await click(tr.left + 24, tr.top + tr.height / 2);
    st = await layout(DASH);
    assert(!st.editing && !st.bar && st.lifted.length === 0, 'AT16: …nor does a quick click on a section title row');
    const held = await holdTitle(DASH, 'dash-alma', 700);
    assert(held.st.editing && held.st.bar && held.st.lifted.join() === 'dash-alma', 'AT16: …whereas a fired 700 ms hold DOES enter edit mode, mount the bar and lift the section (positive control)');
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E3] AT21 — the title rows are 44 pt targets within the +20 pt budget, at 375 and 430…');
  // ═════════════════════════════════════════════════════════════════════
  const ORIG_MB = { 'card-header': 12, 'admin-section-title': 10, 'tiebreaker-label': 6 };
  const BLOCKS = (page) => `(() => {
    const out = [];
    for (const h of document.querySelectorAll('#${page} [data-section-header]')) {
      const cls = h.classList.contains('admin-section-title') ? 'admin-section-title' : h.classList.contains('tiebreaker-label') ? 'tiebreaker-label' : 'card-header';
      const id = h.closest('.layout-section').dataset.sectionId;
      const cs = getComputedStyle(h);
      const real = h.getBoundingClientRect().height;
      const style = document.createElement('style'); style.textContent = '[data-section-header]{min-height:0!important;margin-top:0!important}';
      document.head.appendChild(style);
      const natural = h.getBoundingClientRect().height;
      style.remove();
      out.push({ id, cls, real, natural, mt: parseFloat(cs.marginTop), mb: parseFloat(cs.marginBottom) });
    }
    return out;
  })()`;
  const budgetReport = {};
  for (const vw of [375, 430]) {
    await viewport(vw, 844);
    for (const [tab, page] of [['dashboard', DASH], ['leaderboard', STAND]]) {
      await resetLayoutWorld();
      await goto(tab, page);
      const rows = await evaluate(BLOCKS(page));
      assert(rows.length === (tab === 'dashboard' ? 4 : 6), `[E3-${vw}-${tab}] fixture — ${rows.length} title rows on the page`);
      assert(rows.every((r) => r.real >= 43.99), `AT21 @${vw} (${tab}): every [data-section-header] is at least 44 px tall (${rows.map((r) => r.id + ':' + r.real.toFixed(1)).join(', ')})`);
      const growth = rows.map((r) => ({ id: r.id, d: (r.real + r.mb + r.mt) - (r.natural + ORIG_MB[r.cls]) }));
      budgetReport[`${vw}/${tab}`] = growth.map((g) => `${g.id} ${g.d >= 0 ? '+' : ''}${g.d.toFixed(1)}`).join(', ');
      assert(growth.every((g) => g.d <= 20.01), `AT21 @${vw} (${tab}): each title row's block (its height + margins) grew by at most 20 pt over its natural size (${budgetReport[`${vw}/${tab}`]})`);
      assert(rows.every((r) => r.mb >= 8 - 0.01 || r.cls === 'tiebreaker-label'), `AT21 @${vw} (${tab}): no row's own margin-bottom was cut below 8 pt (the tiebreaker label keeps its original 6 pt, which was already below it)`);
      const headBlock = await evaluate(`(() => { const h = document.querySelector('#${page} .section-header'); const r = h.getBoundingClientRect(); return { h: r.height, btn: !!h.querySelector('button') }; })()`);
      assert(headBlock.btn === false, `AT21 @${vw} (${tab}): the page heading row has no button (it lost its 44 pt button row; its own height is ${headBlock.h.toFixed(1)} pt)`);
    }
  }
  console.log('    (AT21 per-row growth over natural, pt, reported not committed: ' + Object.entries(budgetReport).map(([k, v]) => `${k}: ${v}`).join(' | ') + ')');
  await viewport(390, 844);

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E4] AT2 / AT11 — a still 500 ms hold on EACH of the ten title rows lifts it; 450 ms does not; nothing shifts under the finger…');
  // ═════════════════════════════════════════════════════════════════════
  const TEN_ROWS = [
    ['dashboard', DASH, 'dash-picks'], ['dashboard', DASH, 'dash-alma'], ['dashboard', DASH, 'dash-summary'], ['dashboard', DASH, 'dash-tiebreaker'],
    ['leaderboard', STAND, 'stand-season'], ['leaderboard', STAND, 'stand-extrapoint'], ['leaderboard', STAND, 'stand-alma'],
    ['leaderboard', STAND, 'stand-history'], ['leaderboard', STAND, 'stand-2025-open'], ['leaderboard', STAND, 'stand-2025-record'],
  ];
  const quiet = (st) => st.lifted.length === 0 && st.claim === null && !st.editing && !st.bar;
  // AT11 measures a title's viewport Y across the moment edit mode begins. Blink's scroll anchoring would silently re-scroll by any height change ABOVE the
  // viewport (the density toggle collapsing, a grip wrapping a header onto a second line) and hide it; WebKit, the iOS engine, has no scroll anchoring, so
  // the fixture turns it off to measure what the phone would show. (Mutation M16: toggle display:none turns this red only with the anchoring off.)
  await evaluate(`document.documentElement.style.overflowAnchor = 'none'`);
  for (const [tab, page, id] of TEN_ROWS) {
    await resetLayoutWorld();
    await goto(tab, page);
    const short = await holdTitle(page, id, 300);        // read at ~300 ms: 200 ms of slack under the 500 ms gate (a loaded Mac's CDP round trip is not instant)
    assert(quiet(short.st) && short.st.pressing === 1, `AT2 ${id}: a still hold read before the 500 ms mark lifts NOTHING — no claim, no edit mode, no bar — and shows only the pending tint (.section-pressing: ${short.st.pressing})`);
    const moved = await holdTitle(page, id, 150, { release: false });
    await touch.move(moved.x + 8, moved.y + 24);          // far past 8 px (and past Chrome's own ~15 px touchmove slop): a scroll, not a press
    await eSleep(420);                                    // read at ~590 ms after the touch began: past the 500 ms mark, where a live press would have lifted
    const afterMove = await layout(page);
    await touch.up(); await eSleep(80);
    assert(quiet(afterMove) && afterMove.pressing === 0, `AT2 ${id}: a finger that moves past 8 px before 500 ms is a scroll — it never becomes a press, even when it later rests, and the tint is withdrawn`);
    const lift = await holdTitle(page, id, 640, { release: false });
    const after = await rectOf(page, id);
    assert(lift.st.lifted.join() === id && lift.st.claim === 'section-drag' && lift.st.editing && lift.st.bar && lift.st.grips > 0 && lift.st.pressing === 0,
      `AT2 ${id}: a still 640 ms hold LIFTS it — data-lifted, claim "section-drag", edit mode on, the bar mounted, ${lift.st.grips} grips, tint withdrawn (${JSON.stringify(lift.st)})`);
    assert(Math.abs(after.top - lift.rect.top) <= 1,
      `AT11 ${id}: the lifted title's viewport Y is the same before and after edit mode begins (${lift.rect.top.toFixed(1)} → ${after.top.toFixed(1)}) — nothing shifts under the finger`);
    await touch.up(); await eSleep(400);
    const rel = await layout(page);
    assert(rel.claim === null && rel.lifted.length === 0 && rel.editing && rel.bar && rel.order.join() === lift.st.order.join(),
      `AT2 ${id}: released in place: the claim is given back, nothing is lifted, the mode stays on (Done ends it), the order is unchanged`);
  }
  await resetLayoutWorld();
  await evaluate(`document.documentElement.style.overflowAnchor = ''`);

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E4b] AT11 at EVERY iPhone width (375, 390, 414, 430, 440), web AND native shell, a long tiebreaker question included — the grip never changes a title row\'s line count (A1.4)…');
  // ═════════════════════════════════════════════════════════════════════
  // Reviewer BLOCK B1 (2026-10-01): E4 ran at one width (390), where the web Dashboard's header row has ALREADY wrapped at rest, so a 44 pt grip that
  // wrapped it at 414-440 pt (44 -> 61 pt, everything below jumped ~16 pt) was never exercised. The grip is OUT OF FLOW now; this section measures that
  // for every title row on both pages at every width, comparing each row's DOCUMENT position, own height, section height and text line count with edit mode
  // OFF versus a section lifted (edit mode ON). Native has no density toggle, so its Dashboard header is a different row: it is measured too.
  const AT11_WIDTHS = [375, 390, 414, 430, 440];
  const ROWS = (page) => `(() => {
    const out = [];
    for (const s of document.querySelectorAll('#${page} .layout-section')) {
      const h = s.querySelector('[data-section-header]');
      if (!h) continue;
      const r = h.getBoundingClientRect();
      const grip = h.querySelector('.layout-grip');
      const gr = grip && grip.getBoundingClientRect();
      let right = 0; const tops = new Set();
      const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        // The density toggle's own labels are not the TITLE: it is visibility:hidden while editing (and keeps its space), so its text is left out of the line count and the overlap test.
        if (!n.textContent.trim() || n.parentElement.closest('.layout-toggle') || getComputedStyle(n.parentElement).visibility === 'hidden') continue;
        const g = document.createRange(); g.selectNodeContents(n);
        for (const q of g.getClientRects()) { right = Math.max(right, q.right); tops.add(Math.round(q.top / 4)); }
      }
      out.push({ id: s.dataset.sectionId, y: r.top + scrollY, rowH: h.offsetHeight, secH: s.offsetHeight, lines: tops.size, textRight: right,
        gripLeft: gr ? gr.left : null, gripPos: grip ? getComputedStyle(grip).position : null, lifted: s.hasAttribute('data-lifted'),
        toggleBtn: h.querySelector('.layout-toggle-btn') ? getComputedStyle(h.querySelector('.layout-toggle-btn')).visibility : null });
    }
    return out;
  })()`;
  await evaluate(`document.documentElement.style.overflowAnchor = 'none'`);      // WebKit has no scroll anchoring: measure what the phone would show
  /** One lift on `liftId`: rows measured before (mode OFF) and after (mode ON), then compared row by row. */
  const at11Page = async (tab, page, liftId, w, label) => {
    await resetLayoutWorld();
    await goto(tab, page);
    await scrollHeaderTo(page, liftId, 140);
    const rest = await evaluate(ROWS(page));
    const tp = await titlePoint(page, liftId);
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    const st = await layout(page);
    const edit = await evaluate(ROWS(page));
    await touch.up();
    await eSleep(420);
    const live = await evaluate(`document.getElementById('layout-live') ? document.getElementById('layout-live').textContent : null`);
    const diffs = [];
    for (const a of rest) {
      const b = edit.find((x) => x.id === a.id);
      if (!b) { diffs.push(`${a.id}: row vanished`); continue; }
      if (Math.abs(b.y - a.y) > 1) diffs.push(`${a.id} title Y ${a.y.toFixed(1)} -> ${b.y.toFixed(1)}`);
      if (Math.abs(b.rowH - a.rowH) > 0.5) diffs.push(`${a.id} row height ${a.rowH} -> ${b.rowH}`);
      if (Math.abs(b.secH - a.secH) > 0.5) diffs.push(`${a.id} section height ${a.secH} -> ${b.secH}`);
      if (!b.lifted && b.lines !== a.lines) diffs.push(`${a.id} line count ${a.lines} -> ${b.lines}`);
    }
    const under = edit.filter((b) => !b.lifted && b.gripLeft !== null && b.textRight > b.gripLeft + 0.5).map((b) => `${b.id} text reaches ${b.textRight.toFixed(1)} past the grip at ${b.gripLeft.toFixed(1)}`);
    assert(st.lifted.join() === liftId && st.editing && edit.length === rest.length && edit.every((b) => b.gripLeft !== null && b.gripPos === 'absolute') && edit.every((b) => b.toggleBtn === null || b.toggleBtn === 'hidden'),
      `AT11 ${label} @${w}: fixture — ${liftId} lifted, edit mode on, ${edit.length} rows each carrying an ABSOLUTELY positioned grip, and the density toggle's BUTTONS (not just the toggle) already computed hidden 140 ms into the mode — the grip never sits over a visible control (${JSON.stringify(st.lifted)}, ${edit.map((b) => b.gripPos).join()}, buttons ${edit.map((b) => b.toggleBtn).join()})`);
    assert(diffs.length === 0,
      `AT11 ${label} @${w}: entering edit mode changes NOTHING about any title row — document Y, row height, section height and text line count are identical for all ${rest.length} rows${diffs.length ? ' — ' + diffs.join('; ') : ''}`);
    assert(under.length === 0, `AT11 ${label} @${w}: no title text runs under the grip${under.length ? ' — ' + under.join('; ') : ''}`);
    return { rest, edit, live };
  };
  let firstLive = null;
  for (const w of AT11_WIDTHS) {
    await viewport(w, 900);
    const d = await at11Page('dashboard', DASH, 'dash-picks', w, 'web Dashboard');
    if (firstLive === null) firstLive = d.live;
    await at11Page('leaderboard', STAND, 'stand-season', w, 'web Standings');
  }
  assert(firstLive === 'Rearranging. Drag a section by its title.',
    `N1: a hold RELEASED IN PLACE announces nothing new — the live region still holds the lift announcement, never "Move cancelled." (${JSON.stringify(firstLive)})`);
  // The player's own words: a LONG tiebreaker question is the one title whose width the data decides.
  const LONG_TB = 'Total combined points scored by both teams in the Alabama at Georgia game, including any overtime periods';
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const wk = st.getWeeks().find((x) => x.weekId === 'wk_2'); st.saveWeek({ ...wk, tiebreakerQuestion: ${JSON.stringify(LONG_TB)} }); return true; })()`);
  for (const w of [375, 440]) {
    await viewport(w, 900);
    const d = await at11Page('dashboard', DASH, 'dash-tiebreaker', w, 'web Dashboard, LONG tiebreaker question');
    const tb = d.rest.find((r) => r.id === 'dash-tiebreaker');
    assert(tb.lines >= 3, `AT11 long tiebreaker @${w}: anti-vacuity — the long question really wraps over ${tb.lines} lines at rest`);
  }
  // Native shell: no density toggle, so the Dashboard's first header is a plain title row.
  await evaluate(`window.Capacitor = { isNativePlatform: () => true }`);
  for (const w of AT11_WIDTHS) {
    await viewport(w, 900);
    const d = await at11Page('dashboard', DASH, 'dash-picks', w, 'NATIVE Dashboard');
    if (w === 375) assert(await evaluate(`!document.querySelector('#${DASH} .layout-toggle')`), 'AT11 native: anti-vacuity — the native Dashboard has no density toggle (isNativeShell() is true in the page)');
  }
  const nativeLong = await at11Page('dashboard', DASH, 'dash-tiebreaker', 375, 'NATIVE Dashboard, LONG tiebreaker question');
  assert(nativeLong.rest.find((r) => r.id === 'dash-tiebreaker').lines >= 3, 'AT11 native long tiebreaker @375: anti-vacuity — the long question wraps over three or more lines at rest');
  await evaluate(`delete window.Capacitor`);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); const wk = st.getWeeks().find((x) => x.weekId === 'wk_2'); st.saveWeek({ ...wk, tiebreakerQuestion: 'Total points in the night game?' }); return true; })()`);
  await viewport(390, 844);
  await resetLayoutWorld();
  await evaluate(`document.documentElement.style.overflowAnchor = ''`);
  await goto('dashboard', DASH);

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E5] AT3 — an 800 ms hold on a section BODY never lifts anything: thirteen-plus kinds of content, touch and mouse…');
  // ═════════════════════════════════════════════════════════════════════
  /** A point inside the first element matching `sel` (in `page`), scrolled to mid-viewport. */
  const pointOf = async (page, sel, { gap = false } = {}) => evaluate(`(() => {
    const el = document.querySelector('#${page} ${sel}');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    if (${gap}) {
      // The empty strip at the end of the first chip line. (Chrome's touch hit-test is a fat finger: a touch in the 6 px gap BETWEEN two
      // pills lands on a pill, which is the pill hold's business, AT1's; iOS hit-tests the exact point. The strip is wide enough for both.)
      const chips = [...el.querySelectorAll('.dc-chip')].map((c) => c.getBoundingClientRect());
      const line = chips.filter((c) => Math.abs(c.top - chips[0].top) < 4);
      const lastRight = Math.max(...line.map((c) => c.right));
      if (el.getBoundingClientRect().right - lastRight < 36) return null;
      return { x: lastRight + (el.getBoundingClientRect().right - lastRight) / 2, y: chips[0].top + chips[0].height / 2 };
    }
    return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 };
  })()`);
  const BODY_KINDS = [
    ['Dashboard game-row text', DASH, '.dc-matchup'], ['Dashboard score / status', DASH, '.dc-status.dc-final'], ['Dashboard spread badge', DASH, '.spread-badge-sm'],
    ['Dashboard compact chip row (empty strip beside the pills)', DASH, '.dc-chips', { gap: true }], ['Dashboard comment / reaction control', DASH, '.dc-meta button, .dc-meta [role="button"], .dc-meta span:last-child'],
    ['Dashboard Alma Mater row', DASH, '.alma-watch-row'], ['Dashboard summary cell', DASH, '.leaderboard-table tbody td'], ['Dashboard summary header cell', DASH, '.leaderboard-table thead th'],
    ['Dashboard tiebreaker answer line', DASH, '.tb-actual, .tiebreaker-card .text-muted'],
    ['Standings Season Summary cell', STAND, '.stand-table-season tbody td'], ['Standings Season Summary header', STAND, '.stand-table-season thead th'],
    ['Standings Weekly History cell', STAND, '.stand-table-history td'], ['Standings footnote', STAND, '.stand-foot'],
    ['Standings Extra Point row', STAND, '[data-section-id="stand-extrapoint"] .card p'], ['Standings Alma Mater Rankings text', STAND, '[data-section-id="stand-alma"] .card p'],
    ['Standings 2K25 Outstanding body', STAND, '[data-section-id="stand-2025-open"] .card p'], ['Standings 2K25 <summary>', STAND, '[data-section-id="stand-2025-record"] summary'],
  ];
  let kindsRun = 0;
  const quietBody = (st) => st.lifted.length === 0 && st.claim === null && !st.editing && !st.bar && st.pressing === 0;
  for (const [label, page, sel, opt] of BODY_KINDS) {
    await resetLayoutWorld();
    await goto(page === DASH ? 'dashboard' : 'leaderboard', page);
    const pt = await pointOf(page, sel, opt || {});
    if (!pt) { console.log(`    (skipped, not present in this fixture: ${label})`); continue; }
    kindsRun++;
    await mouse.down(Math.round(pt.x), Math.round(pt.y));      // the mouse first: the engine ignores mouse events within 600 ms of a TOUCH, never the reverse
    await eSleep(800);
    const m = await layout(page);
    await mouse.up(); await eSleep(100);
    await touch.down(Math.round(pt.x), Math.round(pt.y));
    await eSleep(800);
    const t = await layout(page);
    await touch.up(); await eSleep(100);
    assert(quietBody(t) && quietBody(m), `AT3: an 800 ms hold on ${label} lifts nothing — touch ${quietBody(t) ? 'quiet' : JSON.stringify(t)}, mouse ${quietBody(m) ? 'quiet' : JSON.stringify(m)}`);
  }
  assert(kindsRun >= 13, `AT3: anti-vacuity — at least thirteen kinds of body content were actually found and held (${kindsRun})`);
  // Standard layout: the matrix (td.pick-cell, th.player-col) needs the wide layout.
  await viewport(1100, 800);
  await resetLayoutWorld();
  await goto('dashboard', DASH);
  const wide = await evaluate(`({ cells: document.querySelectorAll('#page-dashboard td.pick-cell').length, heads: document.querySelectorAll('#page-dashboard th.player-col').length })`);
  assert(wide.cells > 0 && wide.heads > 0, `[E5-wide] fixture — at 1100 px the Dashboard is the STANDARD matrix (${wide.cells} pick cells, ${wide.heads} player-column headers)`);
  for (const [label, sel] of [['a matrix pick cell (td.pick-cell)', 'td.pick-cell'], ['a matrix player-column header (th.player-col)', 'th.player-col']]) {
    const pt = await pointOf(DASH, sel);
    await touch.down(Math.round(pt.x), Math.round(pt.y));
    await eSleep(800);
    const st = await layout(DASH);
    assert(st.lifted.length === 0 && !st.editing && !st.bar, `AT3: an 800 ms touch hold on ${label} never lifts a section (the pill's own hold is AT1's)`);
    await touch.up(); await eSleep(150);
    await resetLayoutWorld();
  }
  await viewport(390, 844);
  await goto('dashboard', DASH);

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E6] AT1 / AT5 — a PILL hold never lifts a section (with its positive control), and fires at ~350 ms, not 500…');
  // ═════════════════════════════════════════════════════════════════════
  const pillState = () => evaluate(`(async () => { const nav = await import('./js/nav-gestures.js');
    return { dragging: [...document.querySelectorAll('.col-dragging')].length, claim: nav.touchClaimedBy(),
      lifted: document.querySelectorAll('[data-lifted]').length, editing: !!document.querySelector('.layout-editing'), bar: !!document.getElementById('layout-edit-bar'), pressing: document.querySelectorAll('.section-pressing').length }; })()`);
  const chipRow = () => evaluate(`(() => { const row = document.querySelector('#page-dashboard .dc-chips'); row.scrollIntoView({ block: 'center', behavior: 'instant' });
    const cs = [...row.querySelectorAll('.dc-chip')].map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.playerId, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    return cs; })()`);
  const chipOrder = () => evaluate(`[...document.querySelector('#page-dashboard .dc-chips').querySelectorAll('.dc-chip')].map((c) => c.dataset.playerId)`);
  for (const mode of ['compact chip (.dc-chip)', 'matrix header (th.player-col)']) {
    const wideMode = mode.startsWith('matrix');
    await viewport(wideMode ? 1100 : 390, wideMode ? 800 : 844);
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    const pts = wideMode
      ? await evaluate(`(() => { const th = [...document.querySelectorAll('#page-dashboard th.player-col')]; th[0].scrollIntoView({ block: 'center', behavior: 'instant' });
          return th.slice(0, 5).map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.playerId, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); })()`)
      : await chipRow();
    const orderBefore = wideMode ? await evaluate(`[...document.querySelectorAll('#page-dashboard th.player-col')].map((c) => c.dataset.playerId)`) : await chipOrder();
    const [src, , dst] = pts.length >= 3 ? [pts[1], pts[2], pts[3] || pts[2]] : pts;
    await touch.down(Math.round(src.x), Math.round(src.y));
    const t0 = Date.now();
    // Poll for the PILL's own drag (the positive control) — it must arrive near 350 ms, never at the section hold's 500.
    let firedAt = null;
    for (let i = 0; i < 40 && firedAt === null; i++) { const s = await pillState(); if (s.dragging > 0) firedAt = Date.now() - t0; else await eSleep(15); }
    const atFire = await pillState();
    assert(firedAt !== null && firedAt >= 300 && firedAt < 490, `AT5/AT1 (${mode}): THE POSITIVE CONTROL — the pill's own drag fires at ~350 ms (measured ${firedAt} ms, incl. ~15 ms polling), not at the section hold's 500`);
    assert(atFire.claim === 'column-reorder' && atFire.lifted === 0, `AT1 (${mode}): …with claim "column-reorder", and no section lifted`);
    await eSleep(Math.max(0, 1250 - (Date.now() - t0)));
    const late = await pillState();
    assert(late.lifted === 0 && !late.editing && !late.bar && late.pressing === 0 && late.claim === 'column-reorder',
      `AT1 (${mode}): held to ~1.25 s the pill keeps its own drag — no data-lifted, no edit mode, no bar, no pressing tint, claim still "column-reorder", NEVER "section-drag"`);
    await touch.move(Math.round(dst.x), Math.round(dst.y));
    const over = await evaluate(`document.querySelectorAll('.col-drop-target').length`);
    await touch.up(); await eSleep(400);
    const orderAfter = wideMode ? await evaluate(`[...document.querySelectorAll('#page-dashboard th.player-col')].map((c) => c.dataset.playerId)`) : await chipOrder();
    const secWrites = await evaluate(`(async () => (await import('./js/storage.js')).getSectionOrder('dashboard').length)()`);
    assert(over >= 1 && orderAfter.join() !== orderBefore.join(), `AT1 (${mode}): dragging the pill onto another reorders the COLUMNS (${orderBefore.slice(0, 4).join(',')} → ${orderAfter.slice(0, 4).join(',')})`);
    assert(secWrites === 0, `AT1 (${mode}): …and the SECTION order is untouched — no section write happened (saved sectionOrder length ${secWrites})`);
  }
  await viewport(390, 844);
  await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setDashboardColumnOrder?.([]); return true; })()`);

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E7] AT6 / AT7 — one owner per touch: no week change, no drawer, no refresh, no bounce; and the blocking listener is confined to the title rows…');
  // ═════════════════════════════════════════════════════════════════════
  const WEEKLABEL = `document.querySelector('#page-dashboard .picks-week-nav-label')?.textContent`;
  for (const [fromX, dx, label] of [[40, 60, 'from the LEFT quarter (the drawer\'s own zone), dragged right 60 px'], [300, -60, 'from the right, dragged left 60 px']]) {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    const wk0 = await evaluate(WEEKLABEL);
    const r = await scrollHeaderTo(DASH, 'dash-alma', 220);
    const tp = await titlePoint(DASH, 'dash-alma');
    await touch.down(fromX, tp.y);
    await eSleep(640);
    const lifted = await layout(DASH);
    for (let i = 1; i <= 5; i++) await touch.move(fromX + Math.round((dx * i) / 5), tp.y);
    const mid = await evaluate(`({ drawer: !!document.querySelector('#control-center[data-open="true"], #control-center[data-dragging="true"]'), swipeX: getComputedStyle(document.getElementById('page-dashboard')).getPropertyValue('--week-swipe-x').trim() || '0px', week: ${WEEKLABEL} })`);
    await touch.up(); await eSleep(450);
    const end = await evaluate(`({ drawer: !!document.querySelector('#control-center[data-open="true"], #control-center[data-dragging="true"]'), week: ${WEEKLABEL} })`);
    assert(lifted.lifted.join() === 'dash-alma' && lifted.claim === 'section-drag', `AT6 (${label}): fixture — the section is lifted (claim "section-drag")`);
    assert(!mid.drawer && !end.drawer && mid.week === wk0 && end.week === wk0 && /^(0px|0)$/.test(mid.swipeX),
      `AT6 (${label}): the control center stays CLOSED and the week does not change (${wk0} → ${end.week}); the page is not pushed sideways (--week-swipe-x ${mid.swipeX})`);
  }
  // Pull-to-refresh and the bottom bounce. The detector: a node of the Dashboard that a refresh REPLACES (renderDashboard() runs at its end).
  const MARK = `(() => { window.__mark = document.querySelector('#page-dashboard .refresh-bar'); return !!window.__mark; })()`;
  const MARKGONE = `(() => !document.contains(window.__mark))()`;
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    assert(await evaluate(MARK), '[E7-ptr-0] fixture — the refresh-bar node is marked');
    const head = await evaluate(`(() => { const r = document.querySelector('#page-dashboard .section-header').getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) }; })()`);
    await touch.down(head.x, head.y);
    for (let i = 1; i <= 10; i++) await touch.move(head.x, head.y + i * 12);
    await touch.up(); await eSleep(900);
    assert(await evaluate(MARKGONE), 'AT6 (positive control): a plain 120 px pull-down at the very top of the page DOES refresh it (the page is repainted) — so the detector can see a refresh');
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await evaluate(MARK);
    const tp = await titlePoint(DASH, 'dash-picks');
    const hx = tp.x, hy = tp.y;
    await touch.down(hx, hy);
    await eSleep(640);
    const lifted = await layout(DASH);
    for (let i = 1; i <= 10; i++) await touch.move(hx, hy + i * 12);       // 120 px down, well past the 64 px arm point
    const mid = await evaluate(`({ sy: Math.round(scrollY), pw: document.querySelector('.page-wrapper').style.transform })`);
    await touch.up(); await eSleep(900);
    assert(lifted.lifted.join() === 'dash-picks' && lifted.sy === 0, `[E7-ptr-1] fixture — the top section is lifted at scrollY 0 (${lifted.lifted.join()}, scrollY ${lifted.sy})`);
    assert(!(await evaluate(MARKGONE)) && mid.sy === 0, `AT6: a lifted title dragged DOWN 120 px at scrollY 0 and released does NOT refresh the page (and the page did not scroll: scrollY ${mid.sy})`);
  }
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    const maxY = await evaluate(`Math.max(0, document.documentElement.scrollHeight - innerHeight)`);
    // Positive control: an upward drag from a BODY point at the true bottom lifts the page wrapper (the T-29 rubber band).
    await evaluate(`window.scrollTo({ top: ${maxY}, left: 0, behavior: 'instant' })`);
    await eSleep(200);
    await touch.down(250, 560);
    let maxLift = 0;
    for (let i = 1; i <= 8; i++) { await touch.move(250, 560 - i * 14); const t = await evaluate(`document.querySelector('.page-wrapper').style.transform`); const m = /translateY\(-([\d.]+)px\)/.exec(t || ''); if (m) maxLift = Math.max(maxLift, Number(m[1])); }
    await touch.up(); await eSleep(500);
    assert(maxLift > 3, `AT6 (positive control): an upward drag at the bottom of the page rubber-bands the wrapper (${maxLift.toFixed(1)} px) — so the detector can see a bounce`);
    await evaluate(`window.scrollTo({ top: ${maxY}, left: 0, behavior: 'instant' })`);
    await eSleep(200);
    const tp = await titlePoint(DASH, 'dash-tiebreaker');
    const hx = tp.x, hy = tp.y;
    await touch.down(hx, hy);
    await eSleep(640);
    const lifted = await layout(DASH);
    let lift2 = 0;
    for (let i = 1; i <= 8; i++) { await touch.move(hx, hy - i * 14); const t = await evaluate(`document.querySelector('.page-wrapper').style.transform`); const m = /translateY\(-([\d.]+)px\)/.exec(t || ''); if (m) lift2 = Math.max(lift2, Number(m[1])); }
    await touch.up(); await eSleep(600);
    assert(lifted.lifted.join() === 'dash-tiebreaker', `[E7-bounce-1] fixture — the last section is lifted at the page bottom (${lifted.lifted.join()})`);
    assert(lift2 === 0, `AT6: a lifted section dragged UP at the very bottom of the page does NOT rubber-band the page under it (max wrapper lift ${lift2} px)`);
  }

  // AT7 — the ONE blocking touchmove lives on the title rows only.
  {
    await resetLayoutWorld();
    for (const [tab, page] of [['dashboard', DASH], ['leaderboard', STAND]]) {
      await goto(tab, page);
      const nodes = { window: 'window', document: 'document', html: 'document.documentElement', body: 'document.body', '.page-wrapper': `document.querySelector('.page-wrapper')`, [`#${page}`]: `document.getElementById('${page}')` };
      const chain = [];
      let inspected = 0;
      for (const [name, expr] of Object.entries(nodes)) {
        const r = await pg.send('Runtime.evaluate', { expression: expr });
        const { listeners } = await pg.send('DOMDebugger.getEventListeners', { objectId: r.result.objectId, depth: 1 });
        for (const l of listeners.filter((x) => /^(touchstart|touchmove|wheel)$/.test(x.type))) { inspected++; if (!l.passive) chain.push(`${name}:${l.type}`); }
      }
      assert(inspected >= 6 && chain.length === 0, `AT7 (${tab}): every touchstart/touchmove/wheel listener on the scroll chain (window, document, html, body, .page-wrapper, #${page}) is PASSIVE (${inspected} inspected; non-passive: ${chain.join(', ') || 'none'})`);
      // The whole subtree: every NON-passive touch/wheel listener is on a title row, a draggable pill, or a column header.
      const root = await pg.send('Runtime.evaluate', { expression: `document.getElementById('${page}')` });
      const { listeners: sub } = await pg.send('DOMDebugger.getEventListeners', { objectId: root.result.objectId, depth: -1 });
      const nonPassive = sub.filter((l) => /^(touchstart|touchmove|wheel)$/.test(l.type) && !l.passive);
      const kinds = {};
      for (const l of nonPassive) {
        const d = await pg.send('DOM.describeNode', { backendNodeId: l.backendNodeId });
        const attrs = Object.fromEntries((d.node.attributes || []).reduce((a, v, i, arr) => (i % 2 === 0 ? [...a, [v, arr[i + 1]]] : a), []));
        const kind = 'data-section-header' in attrs ? 'title-row' : attrs.draggable === 'true' ? 'draggable-pill' : `OTHER:${d.node.localName}.${attrs.class || ''}`;
        kinds[`${l.type}/${kind}`] = (kinds[`${l.type}/${kind}`] || 0) + 1;
      }
      const others = Object.keys(kinds).filter((k) => k.includes('OTHER'));
      assert(Object.keys(kinds).some((k) => k.endsWith('/title-row')) && others.length === 0,
        `AT7 (${tab}): in the page's whole subtree the ONLY non-passive touch listeners are on title rows${tab === 'dashboard' ? ' and the draggable pills' : ''} (${JSON.stringify(kinds)}; others: ${others.join(', ') || 'none'})`);
      const rows = await evaluate(`document.querySelectorAll('#${page} [data-section-header]').length`);
      assert((kinds['touchmove/title-row'] || 0) === rows, `AT7 (${tab}): …exactly ONE non-passive touchmove per title row (${kinds['touchmove/title-row'] || 0} listeners on ${rows} rows), registered permanently — WebKit decides at touchstart whether a touch may scroll`);
    }
    await goto('dashboard', DASH);
    await evaluate(`(() => { window.__tm = []; window.addEventListener('touchmove', (e) => window.__tm.push({ p: e.defaultPrevented, c: e.cancelable }), { passive: true }); return true; })()`);
    // (1) a scroll that STARTS on a title row, no hold: never prevented, and the page actually scrolls.
    const r1 = await scrollHeaderTo(DASH, 'dash-alma', 400);
    const sy0 = await evaluate('Math.round(scrollY)');
    await evaluate('window.__tm = []');
    await pg.send('Input.synthesizeScrollGesture', { x: Math.round(r1.left + 24), y: Math.round(r1.top + r1.height / 2), yDistance: -260, gestureSourceType: 'touch', speed: 900 });
    await eSleep(500);
    const scrolled1 = (await evaluate('Math.round(scrollY)')) - sy0;
    const tm1 = await evaluate('window.__tm');
    assert(tm1.length >= 2 && tm1.every((m) => m.p === false) && scrolled1 > 100,
      `AT7: a fling that STARTS on a title row (no hold) scrolls the page like any other (${scrolled1} px) and no touchmove is ever preventDefault()ed (${tm1.length} moves, ${tm1.filter((m) => m.p).length} prevented) — the blocking listener is inert unless a section is lifted`);
    // (2) during a lift: prevented (the page must not move under the finger).
    const r2 = await scrollHeaderTo(DASH, 'dash-alma', 260);
    const hy2 = Math.round(r2.top + r2.height / 2);
    await evaluate('window.__tm = []');
    await touch.down(Math.round(r2.left + 24), hy2);
    await eSleep(640);
    const sy1 = await evaluate('Math.round(scrollY)');
    for (let i = 1; i <= 6; i++) await touch.move(Math.round(r2.left + 24), hy2 + i * 10);
    const tm2 = await evaluate('window.__tm');
    const sy2 = await evaluate('Math.round(scrollY)');
    assert(tm2.filter((m) => m.c).length >= 4 && tm2.filter((m) => m.c).every((m) => m.p === true),
      `AT7: DURING a lift every cancelable touchmove IS preventDefault()ed (${tm2.filter((m) => m.c && m.p).length} of ${tm2.filter((m) => m.c).length}) — the page does not scroll under the finger (scrollY ${sy1} → ${sy2})`);
    assert(sy2 === sy1, 'AT7/AT8: …and scrollY did not move at all while the finger was in the middle of the screen (no auto-scroll, no native scroll)');
    await touch.up(); await eSleep(500);
    // (3) after the release the listener is inert again.
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    const r3 = await scrollHeaderTo(DASH, 'dash-alma', 400);
    const sy3 = await evaluate('Math.round(scrollY)');
    await evaluate('window.__tm = []');
    await pg.send('Input.synthesizeScrollGesture', { x: Math.round(r3.left + 24), y: Math.round(r3.top + r3.height / 2), yDistance: -260, gestureSourceType: 'touch', speed: 900 });
    await eSleep(500);
    const tm3 = await evaluate('window.__tm');
    assert(tm3.length >= 2 && tm3.every((m) => m.p === false) && (await evaluate('Math.round(scrollY)')) - sy3 > 100, 'AT7: …and after the release the next fling from a title row is native again (nothing prevented, the page scrolls)');
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E8] AT8 / AT10 / AT12 / AT20 — drag across a 1500 pt neighbour with edge auto-scroll, drop: ONE write, ONE repaint, nothing else touched…');
  // ═════════════════════════════════════════════════════════════════════
  const SAMPLE = (ms) => `new Promise((res) => { const s = []; const t0 = performance.now(); (function f() { s.push([performance.now(), scrollY]); if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else res(s); })(); })`;
  const speedOf = (s) => ((s[s.length - 1][1] - s[0][1]) / ((s[s.length - 1][0] - s[0][0]) / 1000));
  const navTopOf = () => evaluate(`Math.round(document.querySelector('.bottom-nav').getBoundingClientRect().top)`);
  const headerBottomOf = () => evaluate(`Math.max(0, Math.round(document.querySelector('.app-header').getBoundingClientRect().bottom))`);
  const INSTRUMENT = `(() => {
    if (window.__instr) return true;
    window.__instr = { writes: [], repaints: 0 };
    const o = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { window.__instr.writes.push(k); return o.call(this, k, v); };
    new MutationObserver((recs) => { for (const r of recs) if (r.removedNodes.length && (r.target.id === 'page-dashboard' || r.target.id === 'page-leaderboard')) window.__instr.repaints++; })
      .observe(document.getElementById('page-dashboard').parentElement, { childList: true, subtree: true });
    return true;
  })()`;
  const instrReset = () => evaluate(`(() => { window.__instr.writes = []; window.__instr.repaints = 0; return true; })()`);
  const instrRead = () => evaluate(`({ writes: window.__instr.writes.filter((k) => /player/i.test(k)).length, all: window.__instr.writes.slice(), repaints: window.__instr.repaints })`);
  await evaluate(INSTRUMENT);

  // The speeds: finger held at the bottom edge of the viewport zone, Reduce Motion OFF and ON, page-end stop, leave-the-zone stop, release stop.
  {
    await resetLayoutWorld();
    await reducedMotion(false);
    await goto('dashboard', DASH);
    const tp = await titlePoint(DASH, 'dash-picks');      // the page is at scrollY 0 and 2000+ pt of runway lie below it
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    assert((await layout(DASH)).lifted.join() === 'dash-picks', '[E8-0] fixture — All Picks by Game is lifted at the top of the page');
    await eSleep(320);                                    // the nav may be mid hide/show transition from the previous case; edit mode pins it visible
    const navTop = await navTopOf();
    // Finger at the bottom edge itself (d = 0): the top speed, 720 pt/s.
    await touch.move(tp.x, navTop + 2);
    await eSleep(120);
    const fast = await evaluate(SAMPLE(700));
    const vFast = speedOf(fast);
    assert(vFast > 600 && vFast <= 720 * 1.05, `AT8/AT20: with the finger on the bottom edge the page auto-scrolls at the top speed — measured ${vFast.toFixed(0)} pt/s over ${fast.length} frames (≤ 720 within a 5% allowance for integer-pixel steps and frame jitter over a 700 ms window, and ≥ 600: html{scroll-behavior:smooth} is live, so a plain scrollBy() would crawl or lag — behavior:'instant' is what keeps it on the model)`);
    // Mid-zone: d = 36 (half the zone) -> v = 720 * 0.25 = 180 pt/s.
    await touch.move(tp.x, navTop - 36);
    await eSleep(120);
    const mid = await evaluate(SAMPLE(700));
    const vMid = speedOf(mid);
    assert(vMid > 130 && vMid < 240, `AT8: half-way into the zone the ramp gives about 180 pt/s (quadratic, no velocity step on entry) — measured ${vMid.toFixed(0)} pt/s`);
    // Leaving the zone stops it.
    await touch.move(tp.x, 420);
    await eSleep(150);
    const out = await evaluate(SAMPLE(400));
    assert(Math.abs(speedOf(out)) < 5, `AT8: leaving the zone STOPS the scroll (${speedOf(out).toFixed(1)} pt/s)`);
    // Back into the zone, then release: the scroll stops on release.
    await touch.move(tp.x, navTop + 2);
    await eSleep(150);
    await touch.up();
    await eSleep(80);
    const afterUp = await evaluate(SAMPLE(400));
    assert(Math.abs(speedOf(afterUp)) < 5, `AT8: RELEASE stops the scroll at once (${speedOf(afterUp).toFixed(1)} pt/s after the finger lifted)`);
    await eSleep(400);
    await resetLayoutWorld();
    // Reduce Motion halves it: function, not flourish.
    await reducedMotion(true);
    await goto('dashboard', DASH);
    const tpr = await titlePoint(DASH, 'dash-picks');
    await touch.down(tpr.x, tpr.y);
    await eSleep(640);
    await touch.move(tpr.x, navTop + 2);
    await eSleep(150);
    const slow = await evaluate(SAMPLE(700));
    const vSlow = speedOf(slow);
    const rmLift = await evaluate(`(() => { const el = document.querySelector('[data-lifted]'); return el ? el.style.transform : null; })()`);
    await touch.up();
    assert(vSlow > 300 && vSlow <= 360 * 1.05, `AT8: under emulated Reduce Motion the top speed is HALVED to 360 pt/s (measured ${vSlow.toFixed(0)} pt/s)`);
    assert(rmLift !== null && !/scale\(1\.02\)/.test(rmLift) && /scale\(1\)/.test(rmLift), `AT8: …and the lifted section is NOT scaled under Reduce Motion (transform: ${rmLift}) — the shadow only, no slide, no scale`);
    await eSleep(400);
    await reducedMotion(false);
    await resetLayoutWorld();
    // The page END stops it: hold the bottom edge from near the end.
    await goto('dashboard', DASH);
    const maxY = await evaluate(`Math.max(0, document.documentElement.scrollHeight - innerHeight)`);
    await evaluate(`window.scrollTo({ top: ${maxY - 400}, left: 0, behavior: 'instant' })`);
    await eSleep(400);
    const tpe = await titlePoint(DASH, 'dash-summary');
    await touch.down(tpe.x, tpe.y);
    await eSleep(640);
    await touch.move(tpe.x, navTop + 2);
    await eSleep(1200);
    const endState = await evaluate(`({ sy: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) })`);
    const endSample = await evaluate(SAMPLE(300));
    await touch.up(); await eSleep(400);
    assert(Math.abs(endState.sy - endState.max) <= 1 && Math.abs(speedOf(endSample)) < 5, `AT8: the scroll STOPS at the end of the page (scrollY ${endState.sy} of ${endState.max}) and does not run past it`);
    await resetLayoutWorld();
  }

  // The top zone starts BELOW the bar, and the long drop: Alma Mater (270 pt) dragged above the 1500 pt All Picks card, by auto-scroll alone.
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await instrReset();
    const hb = await headerBottomOf();
    await scrollHeaderTo(DASH, 'dash-alma', 260);
    const tp = await titlePoint(DASH, 'dash-alma');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    const sy0 = await evaluate('Math.round(scrollY)');
    const barBottom = await evaluate(`Math.round(document.getElementById('layout-edit-bar').getBoundingClientRect().bottom)`);
    assert(barBottom === 52, `AT8: the page is scrolled past the header, so the fixed bar sits at the very top of the viewport and its bottom edge (the top auto-scroll edge) is ${barBottom} = 52 (the visible header bottom, clamped at 0, plus the 52 pt bar)`);
    // Just BELOW the zone (edge 52 + 72 = 124; y = 150): nothing happens. Inside it (y = 90): up.
    await touch.move(tp.x, 150);
    await eSleep(150);
    const below = await evaluate(SAMPLE(350));
    assert(Math.abs(speedOf(below)) < 5, `AT8: a finger BELOW the top zone (y 150; the zone is the 72 pt under the bar, 52-124) does not scroll (${speedOf(below).toFixed(1)} pt/s)`);
    await touch.move(tp.x, 56);
    await eSleep(150);
    const up = await evaluate(SAMPLE(500));
    assert(speedOf(up) < -400 && speedOf(up) >= -720 * 1.05, `AT8: in the top zone the page scrolls UP, at up to 720 pt/s (measured ${speedOf(up).toFixed(0)} pt/s)`);
    // Keep holding at the top edge until the page is at its top (about 2 s), the section follows the finger across the 1500 pt neighbour.
    for (let i = 0; i < 40; i++) { if ((await evaluate('Math.round(scrollY)')) <= 0) break; await eSleep(100); }
    const atTop = await evaluate(`({ sy: Math.round(scrollY), alma: Math.round(document.querySelector('[data-lifted]').getBoundingClientRect().top) })`);
    assert(atTop.sy === 0 && sy0 > 1000, `AT8/AT10: the auto-scroll carried the held section ~${sy0} pt up the page and stopped at the top of the page (scrollY ${atTop.sy})`);
    await touch.move(tp.x, 300);              // bring the finger away from the edge; the title sits near the top of the first card
    await eSleep(200);
    const lays = await layout(DASH);
    await touch.up();
    await eSleep(700);
    const st = await layout(DASH);
    const ins = await instrRead();
    const saved = await evaluate(`(async () => (await import('./js/storage.js')).getSectionOrder('dashboard'))()`);
    assert(lays.lifted.join() === 'dash-alma', '[E8-1] fixture — still lifted when the finger came off the edge');
    assert(st.order.join() === 'dash-alma,dash-picks,dash-summary,dash-tiebreaker' && saved.join() === 'dash-alma,dash-picks,dash-summary,dash-tiebreaker',
      `AT10: the section LANDS WHERE IT WAS HELD — it crossed the 1500 pt All Picks card and is now FIRST, in the DOM (${st.order.join()}) and in the saved record (${saved.join()}); the title anchors the slot, so a huge neighbour costs no extra travel`);
    assert(ins.writes === 1, `AT12: ONE write for the whole drop — the player record was written ${ins.writes} time(s) (all keys: ${ins.all.join(',')})`);
    assert(ins.repaints === 1, `AT12/AT9: ONE repaint for the whole drop (${ins.repaints} replacement(s) of the page) — from the saved order, after the settle`);
    const heldAfter = await evaluate(`document.querySelectorAll('[data-lifted],[data-settling]').length + [...document.querySelectorAll('.layout-section')].filter((s) => s.style.transform || s.style.transition || s.style.willChange).length`);
    assert(heldAfter === 0, 'AT10: …and not one inline transform, transition, will-change or marker is left on any section after the drop (the repaint rebuilt them from the saved order)');
    await resetLayoutWorld();
  }

  // A second player's record is unchanged by a drop; Reset clears only its page.
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    const others0 = await evaluate(`(async () => { const st = await import('./js/storage.js'); return JSON.stringify(st.getPlayers().filter((p) => p.playerId !== 'pl_drew')); })()`);
    await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSectionOrder('standings', ['stand-history','stand-season','stand-extrapoint','stand-alma','stand-2025-open','stand-2025-record']); return true; })()`);
    await scrollHeaderTo(DASH, 'dash-summary', 300);
    const tp = await titlePoint(DASH, 'dash-summary');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    await touch.move(tp.x, tp.y - 40);
    for (let i = 1; i <= 8; i++) await touch.move(tp.x, tp.y - 40 - i * 30);   // up past Alma Mater's title (it is 280 pt above)
    await touch.up();
    await eSleep(700);
    const o1 = await layout(DASH);
    const others1 = await evaluate(`(async () => { const st = await import('./js/storage.js'); return JSON.stringify(st.getPlayers().filter((p) => p.playerId !== 'pl_drew')); })()`);
    const stand1 = await evaluate(`(async () => (await import('./js/storage.js')).getSectionOrder('standings').join())()`);
    assert(o1.order[0] !== 'dash-picks' || o1.order.join() !== 'dash-picks,dash-alma,dash-summary,dash-tiebreaker', `[E8-2] fixture — the Summary section moved (${o1.order.join()})`);
    assert(others0 === others1, 'AT12: the five OTHER players\' records are byte-identical after the drop — the layout is per-player, on the player record, never on the league-shared settings');
    assert(stand1 === 'stand-history,stand-season,stand-extrapoint,stand-alma,stand-2025-open,stand-2025-record', `AT12: …and a drop on the Dashboard leaves the Standings page\'s own saved layout alone (got "${stand1}")`);
    // Reset (the bar's) clears the Dashboard only and keeps the scroll position.
    const syBefore = await evaluate('Math.round(scrollY)');
    await evaluate(`document.getElementById('layout-edit-bar').querySelector('.layout-bar-reset').click()`);
    await eSleep(500);
    const o2 = await layout(DASH);
    const stand2 = await evaluate(`(async () => (await import('./js/storage.js')).getSectionOrder('standings').join())()`);
    const dashSaved = await evaluate(`(async () => (await import('./js/storage.js')).getSectionOrder('dashboard').length)()`);
    assert(o2.order.join() === 'dash-picks,dash-alma,dash-summary,dash-tiebreaker' && dashSaved === 0 && stand2 === stand1,
      `AT12 (B13): the bar's Reset to default restores the Dashboard's default (${o2.order.join()}) and clears only that page — Standings keeps its saved layout`);
    assert(o2.editing && o2.bar && Math.abs(o2.sy - syBefore) <= 2, `AT12: …the mode stays on and the scroll position is kept (${syBefore} → ${o2.sy})`);
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E9] AT9 / AT17 / AT19 — a live repaint DURING a lift is parked and runs exactly once after the drop; the lifted node is never detached; geometry changes re-measure…');
  // ═════════════════════════════════════════════════════════════════════
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await instrReset();
    await scrollHeaderTo(DASH, 'dash-alma', 260);
    const tp = await titlePoint(DASH, 'dash-alma');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    await evaluate(`(window.__lifted = document.querySelector('[data-lifted]'), true)`);
    // A "live score tick": the data changes in the mirror, then every real repaint door opens (a same-tab navigateTo is what a Realtime tick and the 60 s refresh call).
    await evaluate(`(async () => { const st = await import('./js/storage.js'); const g = st.getGames('wk_2')[0]; st.saveGame({ ...g, awayScore: 99 }); return true; })()`);
    await evaluate(`(() => { window.navigateTo('dashboard'); window.navigateTo('dashboard'); window.navigateTo('dashboard'); return true; })()`);
    await eSleep(300);
    const mid = await evaluate(`({ same: window.__lifted === document.querySelector('[data-lifted]'), attached: window.__lifted.isConnected, shows99: document.getElementById('page-dashboard').textContent.includes('99–') })`);
    const midI = await instrRead();
    assert(mid.same && mid.attached && midI.repaints === 0, `AT9: a burst of THREE same-tab repaints during the lift replaces NOTHING — the lifted node is the same node and still attached (${midI.repaints} page replacement(s))`);
    assert(mid.shows99 === false, 'AT9: …and nothing was shown stale-then-fresh: the new score is not on the page until the drop (the mirror has it; the repaint is parked)');
    await touch.move(tp.x, tp.y + 8);
    await touch.up();
    await eSleep(700);
    const endI = await instrRead();
    const end = await evaluate(`({ shows99: document.getElementById('page-dashboard').textContent.includes('99–') })`);
    assert(endI.repaints === 1 && end.shows99, `AT9: after the drop the parked repaints run EXACTLY ONCE (${endI.repaints}) and the live-score fixture is visible (FINAL 99–…)`);
    assert((await layout(DASH)).claim === null, 'AT9: …and the claim is given back');
    await resetLayoutWorld();
    // A drop that MOVES while a repaint is parked: the parked tick and the drop's own repaint collapse to ONE.
    await goto('dashboard', DASH);
    await instrReset();
    await scrollHeaderTo(DASH, 'dash-summary', 300);
    const ts = await titlePoint(DASH, 'dash-summary');
    await touch.down(ts.x, ts.y);
    await eSleep(640);
    await evaluate(`window.navigateTo('dashboard')`);
    for (let i = 1; i <= 8; i++) await touch.move(ts.x, ts.y - i * 45);
    await touch.up();
    await eSleep(800);
    const col = await instrRead();
    const ord = await layout(DASH);
    assert(ord.order.indexOf('dash-summary') < ord.order.indexOf('dash-alma') && col.repaints === 1 && col.writes === 1,
      `AT9/AT12: a drop that moves a section while a live repaint was parked collapses to ONE repaint and ONE write (${col.repaints} repaint(s), ${col.writes} write(s), order ${ord.order.join()})`);
    await resetLayoutWorld();
  }
  {
    // AT17 — the Standings half (renderLeaderboard() has its own guard: a Realtime repaint reaches it through navigateTo()).
    await resetLayoutWorld();
    await goto('leaderboard', STAND);
    await instrReset();
    await scrollHeaderTo(STAND, 'stand-alma', 260);
    const tp = await titlePoint(STAND, 'stand-alma');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    await evaluate(`(window.__lifted = document.querySelector('[data-lifted]'), true)`);
    await evaluate(`(() => { window.navigateTo('leaderboard'); window.navigateTo('leaderboard'); return true; })()`);
    await eSleep(300);
    const mid = await evaluate(`({ same: window.__lifted === document.querySelector('[data-lifted]'), attached: window.__lifted.isConnected })`);
    const midI = await instrRead();
    assert(mid.same && mid.attached && midI.repaints === 0, `AT17: on STANDINGS, repaints during a lift park too (renderLeaderboard()'s guard): nothing replaced, the lifted node is the same node (${midI.repaints} replacement(s))`);
    await touch.move(tp.x, tp.y + 6);
    await touch.up();
    await eSleep(700);
    const endI = await instrRead();
    assert(endI.repaints === 1, `AT17: …and they run EXACTLY ONCE after the drop (${endI.repaints})`);
    await resetLayoutWorld();
  }
  {
    // AT19 — the geometry changes mid-lift (a banner arrives above the sections): the slots are re-measured, the drag continues, never aborts.
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await scrollHeaderTo(DASH, 'dash-alma', 300);
    const tp = await titlePoint(DASH, 'dash-alma');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    await touch.move(tp.x, tp.y + 20);
    const before = await evaluate(`Math.round(document.querySelector('[data-lifted] [data-section-header]').getBoundingClientRect().top)`);
    // Blink's scroll anchoring would silently re-scroll by the inserted height (WebKit, the iOS engine, has no scroll anchoring), so the fixture turns it
    // off to measure the engine's own re-measure, which is what runs on the phone.
    await evaluate(`(() => { document.documentElement.style.overflowAnchor = 'none'; document.getElementById('page-dashboard').insertAdjacentHTML('afterbegin', '<div id="sdt-banner" style="height:120px;background:#eee">banner</div>'); return true; })()`);
    await eSleep(260);
    const afterB = await evaluate(`({ top: Math.round(document.querySelector('[data-lifted] [data-section-header]').getBoundingClientRect().top), lifted: document.querySelectorAll('[data-lifted]').length })`);
    const stL = await layout(DASH);
    assert(stL.claim === 'section-drag' && afterB.lifted === 1 && Math.abs(afterB.top - before) <= 3,
      `AT19: a 120 pt banner arriving above the sections mid-lift does NOT abort the drag (claim ${stL.claim}) and the lifted title stays under the finger (viewport Y ${before} → ${afterB.top}) — the geometry was re-measured`);
    await touch.up();
    await eSleep(700);
    await evaluate(`document.documentElement.style.overflowAnchor = ''`);
    const stE = await layout(DASH);
    assert(stE.claim === null && stE.order.join() === 'dash-picks,dash-alma,dash-summary,dash-tiebreaker', `AT19: …and it settles cleanly into its slot afterwards (order ${stE.order.join()})`);
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E10] AT14 / AT15 — the hidden Move and Reset buttons, driven by the KEYBOARD: one order write, announced, no toast, focus kept…');
  // ═════════════════════════════════════════════════════════════════════
  const pressEnter = async () => {
    await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
    await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  };
  // Escape is dispatched as a keydown on the document, not through CDP's Input.dispatchKeyEvent: with touch emulation on, a real CDP Escape wedges
  // the NEXT Input.dispatchTouchEvent in this Chromium (it is never acknowledged; reproduced with no app code involved in the touch). The app's own
  // listener is document-level and reads only `e.key`, so the code path under test is the same.
  const pressEscape = async () => {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
  };
  const ACTIVE = `(() => { const a = document.activeElement; return a ? { cls: a.className, id: a.dataset?.moveId || null, dir: a.dataset?.moveDir || null, page: a.dataset?.layoutPage || null, name: a.getAttribute('aria-label') } : null; })()`;
  const LIVE = `document.getElementById('layout-live')?.textContent || ''`;
  const TOASTS = `window.__toastLog.length`;
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await instrReset();
    const toasts0 = await evaluate(TOASTS);
    // Focus the 2nd section's Move down and press Enter, like a keyboard / Switch Control / VoiceOver activation.
    const target = await evaluate(`(() => { const s = document.querySelectorAll('#page-dashboard .layout-section')[1]; const b = s.querySelector('.section-move-btn[data-move-dir="down"]'); b.focus(); return { id: b.dataset.moveId }; })()`);
    const reveal = await evaluate(`(() => { const bar = document.activeElement.parentElement; const c = getComputedStyle(bar); const r = bar.getBoundingClientRect(); return { pos: c.position, w: Math.round(r.width), h: Math.round(r.height), disp: c.display, ov: c.overflow }; })()`);
    assert(reveal.pos === 'static' && reveal.w > 100 && reveal.h >= 40 && reveal.ov === 'visible',
      `AT14: focusing a hidden button REVEALS its group in flow (keyboard users see what has focus): position ${reveal.pos}, ${reveal.w} x ${reveal.h} px — the .sr-only reveal rule wins over the !important utility`);
    await pressEnter();
    await eSleep(450);
    const after = await layout(DASH);
    const act = await evaluate(ACTIVE);
    const live = await evaluate(LIVE);
    const ins = await instrRead();
    const lbl = { 'dash-picks': 'All Picks by Game', 'dash-alma': 'Alma Mater Watch', 'dash-summary': 'This Week Score Summary', 'dash-tiebreaker': 'Tiebreaker' }[target.id];
    assert(after.order.join() === 'dash-picks,dash-summary,dash-alma,dash-tiebreaker' && ins.writes === 1, `AT14: Enter on Move ${lbl} down moved it ONE place, through one order write (order ${after.order.join()}, ${ins.writes} write(s))`);
    assert(live === `${lbl} moved to position 3 of 4.`, `AT14: the persistent live region announces it: "${live}"`);
    assert((await evaluate(TOASTS)) === toasts0, 'AT14: …with NO toast (four moves would be four toasts; the repaint is the feedback)');
    assert(act && act.id === target.id && act.dir === 'down', `AT14: FOCUS SURVIVED THE REPAINT — it is on the same section's same-direction button again (${JSON.stringify(act)}), not at the top of the page`);
    assert(!after.editing && !after.bar, 'AT14: …and no edit mode was entered or needed');
    // The move that makes it LAST: its Down is now disabled, so focus falls to its Up.
    await evaluate(`(() => { const s = [...document.querySelectorAll('#page-dashboard .layout-section')].find((x) => x.dataset.sectionId === 'dash-alma'); s.querySelector('.section-move-btn[data-move-dir="down"]').focus(); return true; })()`);
    await pressEnter();
    await eSleep(450);
    const act2 = await evaluate(ACTIVE);
    const o2 = await layout(DASH);
    assert(o2.order.join() === 'dash-picks,dash-summary,dash-tiebreaker,dash-alma' && act2 && act2.id === 'dash-alma' && act2.dir === 'up',
      `AT14: when the move makes the section LAST its Down is disabled, so focus goes to the OTHER button of the same section (${JSON.stringify(act2)})`);
    // Reset (AT15): the hidden twin, with a saved Standings layout that must survive it.
    await evaluate(`(async () => { const st = await import('./js/storage.js'); st.setSectionOrder('standings', ['stand-history','stand-season','stand-extrapoint','stand-alma','stand-2025-open','stand-2025-record']); return true; })()`);
    await goto('dashboard', DASH);
    const toasts1 = await evaluate(TOASTS);
    await evaluate(`document.querySelector('#page-dashboard .layout-reset-btn').focus()`);
    await pressEnter();
    await eSleep(450);
    const o3 = await layout(DASH);
    const act3 = await evaluate(ACTIVE);
    const stand = await evaluate(`(async () => (await import('./js/storage.js')).getSectionOrder('standings').join())()`);
    const live3 = await evaluate(LIVE);
    assert(o3.order.join() === 'dash-picks,dash-alma,dash-summary,dash-tiebreaker', 'AT15: the hidden Reset restores the Dashboard\'s default layout, with edit mode OFF');
    assert(stand === 'stand-history,stand-season,stand-extrapoint,stand-alma,stand-2025-open,stand-2025-record', 'AT15: …and clears ONLY its own page — Standings keeps its saved layout');
    assert(live3 === 'Layout reset to the default.', `AT15: …announced: "${live3}"`);
    assert(act3 && /layout-reset-btn/.test(act3.cls) && act3.page === 'dashboard', `AT15: …and focus stays on the Reset twin after the repaint (${JSON.stringify(act3)})`);
    assert((await evaluate(TOASTS)) === toasts1 + 1, 'AT15: …with the one existing reset toast ("↺ Layout reset to the default")');
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E11] AT18 — the mode\'s lifecycle: the hold enters it, a same-tab repaint keeps it, a tab change, Done and Escape end it, an overlay covers it without ending it…');
  // ═════════════════════════════════════════════════════════════════════
  const BAR = `(() => { const b = document.getElementById('layout-edit-bar'); if (!b) return null; const r = b.getBoundingClientRect(); const c = getComputedStyle(b);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), z: c.zIndex, pos: c.position, role: b.getAttribute('role'), label: b.getAttribute('aria-label'),
      title: b.querySelector('.layout-edit-bar-title')?.textContent, hint: b.querySelector('.layout-edit-bar-hint')?.textContent,
      btns: [...b.querySelectorAll('button')].map((x) => x.textContent.trim()), headerBottom: Math.round(document.querySelector('.app-header').getBoundingClientRect().bottom) }; })()`;
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    // The bar at the top of the page sits flush under the header; it follows the header off the screen as the page scrolls; it is under every overlay.
    const entered = await holdTitle(DASH, 'dash-alma', 640, { release: true, at: 300 });
    assert(entered.st.editing && entered.st.bar, 'AT18: the 500 ms hold sets edit mode and mounts #layout-edit-bar');
    let bar = await evaluate(BAR);
    assert(bar && bar.role === 'region' && bar.label === 'Rearranging layout' && bar.title === 'Rearranging' && bar.hint === 'Drag a section by its title.' && bar.btns.join('|') === 'Reset to default|Done',
      `AT18/DI-385: the bar is the "Rearranging layout" region with the exact copy — "${bar?.title}" over "${bar?.hint}", buttons ${JSON.stringify(bar?.btns)}`);
    assert(bar.pos === 'fixed' && bar.h === 52 && bar.z === '99', `AT18: …fixed, 52 pt tall, z-index 99 — under the header (100) and under every overlay (modals 200, the control center 500/501, sheets 8000) — (${bar.pos}, ${bar.h}, z ${bar.z})`);
    await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
    await eSleep(200);
    bar = await evaluate(BAR);
    assert(bar.top === Math.max(0, bar.headerBottom) && bar.top > 0, `AT18 (C6): at the top of the page the bar sits FLUSH under the app header (bar top ${bar.top} = header bottom ${bar.headerBottom}) — measured, not assumed`);
    await evaluate(`window.scrollTo({ top: 600, left: 0, behavior: 'instant' })`);
    await eSleep(250);
    bar = await evaluate(BAR);
    assert(bar.top === 0, `AT18: …and once the page scrolls the header away (it is position:relative here, not sticky) the bar follows it up to the top of the viewport (bar top ${bar.top}) instead of hanging below an empty strip`);
    await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
    await eSleep(200);
    // Same-tab repaint (what a Realtime tick calls): the mode and the bar survive it.
    await evaluate(`window.navigateTo('dashboard')`);
    await eSleep(300);
    let st = await layout(DASH);
    assert(st.editing && st.bar && st.grips === 4, `AT18: a SAME-TAB navigateTo() keeps the mode, the bar and the grips (they are derived from state on every paint: editing ${st.editing}, bar ${st.bar}, ${st.grips} grips)`);
    // An overlay covers the bar and does NOT end the mode; and it stops a hold from starting under it.
    await evaluate(`(() => { const o = document.createElement('div'); o.className = 'modal-overlay'; o.id = 'sdt-overlay'; o.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.3)'; document.body.appendChild(o); return true; })()`);
    await eSleep(150);
    const withOverlay = await layout(DASH);
    assert(withOverlay.editing && withOverlay.bar, 'AT18 (C2): a modal over the page COVERS the bar and does not end the mode');
    await evaluate(`document.getElementById('sdt-overlay').remove()`);
    // A tab change ends it.
    await evaluate(`window.navigateTo('leaderboard')`);
    await waitFor(`document.querySelector('#page-leaderboard.active .layout-section')`);
    await eSleep(250);
    const onStand = await evaluate(`({ bar: !!document.getElementById('layout-edit-bar'), dashEditing: document.getElementById('page-dashboard').classList.contains('layout-editing'), standEditing: document.getElementById('page-leaderboard').classList.contains('layout-editing') })`);
    assert(!onStand.bar && !onStand.dashEditing && !onStand.standEditing, 'AT18: a REAL tab change ends the mode — the bar is unmounted and no page carries .layout-editing');
    await evaluate(`window.navigateTo('dashboard')`);
    await waitFor(`document.querySelector('#page-dashboard.active .layout-section')`);
    await eSleep(250);
    st = await layout(DASH);
    assert(!st.editing && !st.bar, 'AT18: …and coming back to the Dashboard it is NOT still in edit mode');
    // Escape ends it (web); Done ends it; neither adds a toast when nothing moved.
    const entered2 = await holdTitle(DASH, 'dash-alma', 640, { at: 300 });
    assert(entered2.st.editing, '[E11-a] fixture — in edit mode again');
    const toastsA = await evaluate(TOASTS);
    await pressEscape();
    await eSleep(400);
    st = await layout(DASH);
    assert(!st.editing && !st.bar && (await evaluate(TOASTS)) === toastsA, 'AT18: Escape ends the mode (web) — the bar goes away, no toast when nothing moved');
    await holdTitle(DASH, 'dash-alma', 640, { at: 300 });
    await evaluate(`document.querySelector('#layout-edit-bar .layout-bar-done').click()`);
    await eSleep(400);
    st = await layout(DASH);
    assert(!st.editing && !st.bar && (await evaluate(TOASTS)) === toastsA, 'AT18: Done ends the mode too — no toast when nothing moved');
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E12] Done after a move: the toast, the moved section stays in view; Escape / touchcancel / an overlay cancel a lift with NO write; a second finger and a scroll cancel a pending hold…');
  // ═════════════════════════════════════════════════════════════════════
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await instrReset();
    // Move Summary above Alma by a real drag, then press Done.
    await scrollHeaderTo(DASH, 'dash-summary', 300);
    const tp = await titlePoint(DASH, 'dash-summary');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    for (let i = 1; i <= 8; i++) await touch.move(tp.x, tp.y - i * 45);
    await touch.up();
    await eSleep(800);
    const toasts0 = await evaluate(TOASTS);
    // Scroll far from it so the "keep it in view" rule has work to do.
    await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
    await eSleep(250);
    await evaluate(`document.querySelector('#layout-edit-bar .layout-bar-done').click()`);
    await eSleep(900);
    const toastText = await evaluate(`window.__toastLog[window.__toastLog.length - 1] || ''`);
    const inView = await evaluate(`(() => { const s = [...document.querySelectorAll('#page-dashboard .layout-section')].find((x) => x.dataset.sectionId === 'dash-summary'); const t = s.querySelector('[data-section-header]').getBoundingClientRect().top; const nav = document.querySelector('.bottom-nav').getBoundingClientRect().top; const hb = Math.max(0, document.querySelector('.app-header').getBoundingClientRect().bottom); return { t: Math.round(t), nav: Math.round(nav), hb: Math.round(hb) }; })()`);
    const st = await layout(DASH);
    assert(!st.editing && !st.bar && /^Layout saved to your account\.?$/.test(toastText) && (await evaluate(TOASTS)) === toasts0 + 1,
      `AT18 (B12/C10): Done after a move ends the mode, unmounts the bar and raises ONE toast — "${toastText}"`);
    assert(inView.t >= inView.hb + 8 && inView.t <= inView.nav - 80, `AT18 (B12): …and the section you moved STAYS IN VIEW — its title is at viewport Y ${inView.t}, between the header (${inView.hb}) + 8 and the nav (${inView.nav}) − 80: closing the 2026-09-12 "no scroll-into-view after a move" residual`);
    const live = await evaluate(LIVE);
    assert(live === 'Layout saved.', `AT18: …announced: "${live}"`);
    await resetLayoutWorld();
  }
  {
    // Escape mid-drag, touchcancel mid-drag, and an overlay mid-drag each return the section with NO write.
    for (const how of ['Escape', 'touchcancel', 'an overlay appearing']) {
      await resetLayoutWorld();
      await goto('dashboard', DASH);
      await instrReset();
      await scrollHeaderTo(DASH, 'dash-summary', 300);
      const tp = await titlePoint(DASH, 'dash-summary');
      await touch.down(tp.x, tp.y);
      await eSleep(640);
      for (let i = 1; i <= 6; i++) await touch.move(tp.x, tp.y - i * 45);
      const lifted = await layout(DASH);
      if (how === 'Escape') await pressEscape();
      else if (how === 'touchcancel') await touch.cancel();
      else await evaluate(`(() => { const o = document.createElement('div'); o.className = 'modal-overlay'; o.id = 'sdt-overlay'; document.body.appendChild(o); return true; })()`);
      await eSleep(700);
      const after = await layout(DASH);
      const ins = await instrRead();
      const noWrite = ins.writes === 0;
      try { await touch.up(); } catch { /* already gone */ }
      await evaluate(`document.getElementById('sdt-overlay')?.remove()`);
      await eSleep(200);
      const live = await evaluate(LIVE);
      assert(lifted.lifted.join() === 'dash-summary' && after.claim === null && after.lifted.length === 0 && after.order.join() === 'dash-picks,dash-alma,dash-summary,dash-tiebreaker' && noWrite,
        `AT18/B10 (${how}): a lift cancelled by ${how} returns the section to its slot with NO write and gives the touch back (claim ${after.claim}, order ${after.order.join()}, ${ins.writes} player write(s))${live ? `; announced "${live}"` : ''}`);
    }
    await resetLayoutWorld();
  }
  {
    // A SECOND FINGER cancels a pending hold; a SCROLL cancels it; a touch landing right after a scroll never arms (momentum scrolling).
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await scrollHeaderTo(DASH, 'dash-alma', 300);
    let tp = await titlePoint(DASH, 'dash-alma');
    await touch.down(tp.x, tp.y);
    await eSleep(200);
    await touch.second(tp.x + 120, tp.y + 80);
    await eSleep(500);
    let st = await layout(DASH);
    assert(st.lifted.length === 0 && st.claim === null && !st.editing, 'AT2 (B2): a SECOND FINGER landing during the 500 ms wait cancels the press — two fingers are a pinch, never a hold');
    await touch.up(); await eSleep(300);
    await resetLayoutWorld();
    await scrollHeaderTo(DASH, 'dash-alma', 300);
    tp = await titlePoint(DASH, 'dash-alma');
    await touch.down(tp.x, tp.y);
    await eSleep(200);
    await evaluate(`window.scrollBy({ top: 30, left: 0, behavior: 'instant' })`);
    await eSleep(520);
    st = await layout(DASH);
    assert(st.lifted.length === 0 && st.claim === null && !st.editing, 'AT2 (B2): ANY scroll during the 500 ms wait cancels the press (the page moved under the finger: it is a scroll, not a hold)');
    await touch.up(); await eSleep(300);
    await resetLayoutWorld();
    await scrollHeaderTo(DASH, 'dash-alma', 300);
    tp = await titlePoint(DASH, 'dash-alma');
    await evaluate(`window.scrollBy({ top: 30, left: 0, behavior: 'instant' })`);
    await eSleep(40);
    const tp2 = await titlePoint(DASH, 'dash-alma');
    await touch.down(tp2.x, tp2.y);
    await eSleep(700);
    st = await layout(DASH);
    assert(st.lifted.length === 0 && st.claim === null && !st.editing, 'AT2 (B2): a touch that lands within 120 ms of a scroll event is never armed (momentum scrolling can end under a resting thumb)');
    await touch.up(); await eSleep(300);
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E13] The mouse (web parity): a press-and-hold on a title row lifts it through the same code path and a drag reorders; the second drag in edit mode needs no hold…');
  // ═════════════════════════════════════════════════════════════════════
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    await eSleep(700);                                       // clear of the 600 ms "mouse after a touch" window
    await instrReset();
    await scrollHeaderTo(DASH, 'dash-summary', 300);
    const tp = await titlePoint(DASH, 'dash-summary');
    await mouse.down(tp.x, tp.y);
    await eSleep(300);
    const early = await layout(DASH);
    await eSleep(380);
    const lifted = await layout(DASH);
    assert(early.lifted.length === 0 && early.pressing === 1 && lifted.lifted.join() === 'dash-summary' && lifted.claim === 'section-drag' && lifted.editing && lifted.bar,
      `AT2/B3 (mouse): a left-button press held ~500 ms lifts the section through the same code path (at 300 ms: tint ${early.pressing}, lifted ${early.lifted.length}; at ~680 ms: ${lifted.lifted.join()}, claim ${lifted.claim})`);
    for (let i = 1; i <= 8; i++) await mouse.move(tp.x, tp.y - i * 45);
    await mouse.up();
    await eSleep(800);
    const ord = await layout(DASH);
    const ins = await instrRead();
    assert(ord.order.indexOf('dash-summary') < ord.order.indexOf('dash-alma') && ins.writes === 1, `AT2 (mouse): dragging with the mouse reorders (${ord.order.join()}) with one write`);
    // B11 — now in edit mode: a title row drags after 6 px of movement, NO hold (and light haptic on native).
    await scrollHeaderTo(DASH, 'dash-tiebreaker', 300);
    const tb = await titlePoint(DASH, 'dash-tiebreaker');
    await instrReset();
    await touch.down(tb.x, tb.y);
    await touch.move(tb.x, tb.y - 4);
    const slop = await layout(DASH);
    await touch.move(tb.x, tb.y - 24);                    // (Chrome itself holds back touchmoves inside a ~15 px slop; iOS does not — the engine's own is 6 pt)
    const dragging = await layout(DASH);
    for (let i = 1; i <= 10; i++) await touch.move(tb.x, tb.y - 24 - i * 40);
    await touch.up();
    await eSleep(800);
    const ord2 = await layout(DASH);
    assert(slop.lifted.length === 0 && dragging.lifted.join() === 'dash-tiebreaker' && ord2.order.indexOf('dash-tiebreaker') < 3,
      `AT2 (B11): in edit mode a title row drags after ~6 pt of movement with NO hold (4 px: lifted ${slop.lifted.length}; 24 px: ${dragging.lifted.join()}) and the tiebreaker moved up (${ord2.order.join()})`);
    const bodyDrag = await evaluate(`(async () => ({ editing: document.getElementById('page-dashboard').classList.contains('layout-editing') }))()`);
    assert(bodyDrag.editing, '[E13-a] fixture — still in edit mode');
    // A body touch in edit mode SCROLLS and never drags.
    const rb = await evaluate(`(() => { const e = document.querySelector('#page-dashboard .alma-watch-row'); e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) }; })()`);
    await eSleep(400);
    const sy0 = await evaluate('Math.round(scrollY)');
    const maxY2 = await evaluate('Math.max(0, document.documentElement.scrollHeight - innerHeight)');
    await pg.send('Input.synthesizeScrollGesture', { x: rb.x, y: rb.y, yDistance: sy0 > maxY2 - 300 ? 200 : -200, gestureSourceType: 'touch', speed: 900 });
    await eSleep(500);
    const sy1 = await evaluate('Math.round(scrollY)');
    const afterBody = await layout(DASH);
    assert(afterBody.lifted.length === 0 && Math.abs(sy1 - sy0) > 80, `AT2 (B6): a touch that starts in a section BODY while editing scrolls the page (${sy0} → ${sy1}) and never drags a section (lifted ${afterBody.lifted.length})`);
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E14] A lifted section on STANDINGS (all six sections, the two 2K25 ones included) drags and drops through the same engine…');
  // ═════════════════════════════════════════════════════════════════════
  {
    await resetLayoutWorld();
    await goto('leaderboard', STAND);
    await instrReset();
    await scrollHeaderTo(STAND, 'stand-history', 300);
    const tp = await titlePoint(STAND, 'stand-history');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    for (let i = 1; i <= 9; i++) await touch.move(tp.x, tp.y - i * 40);
    await touch.up();
    await eSleep(800);
    const ord = await layout(STAND);
    const saved = await evaluate(`(async () => (await import('./js/storage.js')).getSectionOrder('standings').join())()`);
    assert(ord.order.indexOf('stand-history') < ord.order.indexOf('stand-alma') && saved === ord.order.join(), `SP-56 (the new Standings sections): Weekly History dragged up above Alma Mater Rankings and saved (${ord.order.join()}); the saved record equals the DOM`);
    assert(await evaluate(`!!document.getElementById('obligations-section') && document.getElementById('obligations-section').closest('.layout-section').dataset.sectionId === 'stand-history'`),
      'AT2: …and the #obligations-section deep-link target travelled WITH the section (the OBLIGATION_CREATED notification still lands on it)');
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E15] Design + polish measurements the stylesheet owns: the lock, the lifted look, the neighbours\' glide, the grips, the title row\'s touch rules…');
  // ═════════════════════════════════════════════════════════════════════
  {
    await resetLayoutWorld();
    await goto('dashboard', DASH);
    const idle = await evaluate(`(() => { const h = document.querySelector('#page-dashboard [data-section-id="dash-alma"] [data-section-header]'); const c = getComputedStyle(h);
      return { touchAction: c.touchAction, userSelect: c.userSelect, minH: c.minHeight, htmlOverflow: getComputedStyle(document.documentElement).overflow, token: getComputedStyle(document.documentElement).getPropertyValue('--shadow-lift').trim() }; })()`);
    assert(idle.touchAction === 'auto' && idle.userSelect === 'none' && idle.minH === '44px' && idle.token.length > 20,
      `Design: at rest a title row has touch-action:auto (it scrolls like anything else), user-select:none, min-height 44px; --shadow-lift is defined (${idle.touchAction}, ${idle.userSelect}, ${idle.minH})`);
    await scrollHeaderTo(DASH, 'dash-alma', 280);
    const tp = await titlePoint(DASH, 'dash-alma');
    await touch.down(tp.x, tp.y);
    await eSleep(640);
    const lifted = await evaluate(`(() => { const s = document.querySelector('[data-lifted]'); const h = s.querySelector('[data-section-header]'); const c = getComputedStyle(s); const hc = getComputedStyle(h);
      const g = s.querySelector('.layout-grip'); const gs = g.querySelector('svg').getBoundingClientRect(); const all = [...document.querySelectorAll('#page-dashboard .layout-section')];
      return { overflow: getComputedStyle(document.documentElement).overflow, overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY, transform: s.style.transform, origin: s.style.transformOrigin, z: c.zIndex, pos: c.position,
        shadow: c.boxShadow, outline: c.outlineStyle, outlineColor: c.outlineColor, touchAction: hc.touchAction, gripW: Math.round(gs.width), gripH: Math.round(gs.height), gripColor: getComputedStyle(g).color, willChange: s.style.willChange,
        shadowTransition: c.transitionProperty + '|' + c.transitionDuration, others: all.filter((x) => x !== s).map((x) => x.style.transition) }; })()`);
    assert(lifted.overflow === 'hidden' && lifted.overscroll === 'none', `Design/AT7: while a section is lifted the page is locked for touch — html overflow ${lifted.overflow}, overscroll-behavior ${lifted.overscroll} (SB-05's drawer idiom) — so nothing scrolls under the finger except the deliberate auto-scroll`);
    assert(/translate3d\(0px, [-\d.]+px, 0px\) scale\(1\.02\)/.test(lifted.transform) && /50% 0/.test(lifted.origin) && lifted.willChange === 'transform',
      `Design/B7: the lifted section is translate3d + scale(1.02) about its TOP centre (${lifted.transform}; origin ${lifted.origin}), will-change only on the moved section (${lifted.willChange})`);
    assert(lifted.z === '6' && lifted.pos === 'relative' && /rgba?\(/.test(lifted.shadow) && lifted.shadow !== 'none', `Design/B7: …raised above its neighbours (z-index ${lifted.z}) with the lift shadow (${lifted.shadow.slice(0, 60)}…)`);
    assert(lifted.touchAction === 'none' && lifted.gripW === 22 && lifted.gripH === 22 && lifted.outline === 'dashed',
      `Design/B6: in edit mode the title row is touch-action:none, the grip is the 22 px Munera icon (${lifted.gripW} x ${lifted.gripH} — the .admin-section-title svg 14 px rule is beaten by specificity) and the sections wear the dashed outline (${lifted.outline})`);
    // Slide the finger past the next slot: the neighbours glide aside by an exact delta over 260 ms (the transition is set inline, --motion-nav).
    for (let i = 1; i <= 6; i++) await touch.move(tp.x, tp.y + i * 60);
    await eSleep(100);
    const glide = await evaluate(`[...document.querySelectorAll('#page-dashboard .layout-section')].filter((s) => !s.hasAttribute('data-lifted')).map((s) => ({ id: s.dataset.sectionId, t: s.style.transform, tr: s.style.transition }))`);
    assert(glide.some((g) => /translate3d\(0px, [-\d.]+px, 0px\)/.test(g.t) && /260ms|0\.26s|var\(--motion-nav\)/.test(g.tr)), `Design/B8: when the held title passes into the next slot the displaced neighbour glides aside by an exact translate over --motion-nav (${JSON.stringify(glide.find((g) => g.t))})`);
    await touch.up();
    await eSleep(700);
    const after = await evaluate(`({ overflow: getComputedStyle(document.documentElement).overflow, overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY })`);
    assert(after.overflow === 'visible' && after.overscroll === 'auto', `Design: after the drop the lock lifts the same instant — html overflow ${after.overflow}, overscroll-behavior ${after.overscroll} (DI-327's native bounce is back)`);
    await resetLayoutWorld();
    // Reduce Motion: no transitions on the title rows or the lifted section.
    await reducedMotion(true);
    await goto('dashboard', DASH);
    const rm = await evaluate(`getComputedStyle(document.querySelector('#page-dashboard [data-section-header]')).transitionDuration`);
    assert(/^0s(, 0s)*$/.test(rm), `Polish: under Reduce Motion the title rows' tint transition is dropped entirely (${rm}) — the tint appears instantly`);
    await reducedMotion(false);
    // Dark mode: --shadow-lift remaps darker and the bar / grips use tokens.
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await eSleep(150);
    const dark = await evaluate(`getComputedStyle(document.body).getPropertyValue('--shadow-lift').trim()`);    // the dark blocks are scoped to body.theme-neutral, not :root
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await eSleep(100);
    assert(/rgba\(0,\s*0,\s*0,\s*\.5\)/.test(dark) && !/rgba\(20,\s*17,\s*14/.test(dark), `Design: in dark mode --shadow-lift is the darker remap (${dark})`);
    await resetLayoutWorld();
  }

  // ═════════════════════════════════════════════════════════════════════
  console.log('\n[E16] The TOP SAFE AREA (the notch / Dynamic Island band on the Munera shell and an installed PWA): the bar and the top auto-scroll edge never go above the inset…');
  // ═════════════════════════════════════════════════════════════════════
  {
    let emulated = true;
    try { await pg.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } }); } catch { emulated = false; }
    assert(emulated, '[E16-0] fixture — this Chromium can emulate a 59 pt top / 34 pt bottom safe-area inset (Emulation.setSafeAreaInsetsOverride): the iPhone shell\'s geometry is measured, not assumed');
    if (emulated) {
      await eSleep(300);
      await resetLayoutWorld();
      await goto('dashboard', DASH);
      const hdrPad = await evaluate(`getComputedStyle(document.querySelector('.app-header')).paddingTop`);
      assert(hdrPad === '59px', `[E16-1] fixture — the header's own padding-top IS the inset (${hdrPad}), which is where the engine reads it from`);
      const BARX = `(() => { const b = document.getElementById('layout-edit-bar'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), headerBottom: Math.round(document.querySelector('.app-header').getBoundingClientRect().bottom), cssTop: b.style.top }; })()`;
      await scrollHeaderTo(DASH, 'dash-alma', 300);
      const tp = await titlePoint(DASH, 'dash-alma');
      await touch.down(tp.x, tp.y);
      await eSleep(640);
      const lifted = await layout(DASH);
      const bar = await evaluate(BARX);
      assert(lifted.lifted.join() === 'dash-alma' && bar && bar.headerBottom < 0, `[E16-2] fixture — Alma Mater is lifted with the header scrolled away (header bottom ${bar && bar.headerBottom})`);
      assert(bar.top === 59 && bar.bottom === 111, `Safe area: with the header scrolled away the bar sits UNDER THE INSET — top ${bar.top} (not 0: it would be behind the clock and the island), bottom ${bar.bottom} = 59 + 52 (style.top: ${bar.cssTop})`);
      // The top auto-scroll zone is measured from the BAR, so it starts at 111, not 52.
      const SAMPLE2 = (ms) => `new Promise((res) => { const s = []; const t0 = performance.now(); (function f() { s.push([performance.now(), scrollY]); if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else res(s); })(); })`;
      const speed2 = (s) => ((s[s.length - 1][1] - s[0][1]) / ((s[s.length - 1][0] - s[0][0]) / 1000));
      await touch.move(tp.x, 111 + 72 + 8);                       // just BELOW the zone (111-183)
      await eSleep(150);
      const below = await evaluate(SAMPLE2(350));
      assert(Math.abs(speed2(below)) < 5, `Safe area: a finger just below the real zone (y ${111 + 72 + 8}; the zone is the 72 pt under the bar, 111-183) does not scroll (${speed2(below).toFixed(1)} pt/s)`);
      await touch.move(tp.x, 150);                                // outside the zone a bar at the top would have (52-124), inside the real one
      await eSleep(150);
      const inside = await evaluate(SAMPLE2(400));
      assert(speed2(inside) < -100, `Safe area: a finger at y 150 — OUTSIDE the 52-124 zone a bar at the viewport top would have, INSIDE the real 111-183 one — scrolls the page UP (${speed2(inside).toFixed(0)} pt/s)`);
      await touch.up();
      await eSleep(700);
      // At the top of the page the bar sits flush under the (taller, inset-padded) header.
      await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
      await holdTitle(DASH, 'dash-alma', 640, { at: 300 });
      await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
      await eSleep(250);
      const top0 = await evaluate(BARX);
      assert(top0 && top0.top === top0.headerBottom && top0.top > 59, `Safe area: at the top of the page the bar sits flush under the header, whose bottom (${top0 && top0.headerBottom}) already includes the inset`);
      // Done after a move: the moved section is scrolled into view UNDER THE INSET, not under y = 0 (where the clock and the island are).
      await resetLayoutWorld();
      await goto('dashboard', DASH);
      await scrollHeaderTo(DASH, 'dash-summary', 300);
      const ts = await titlePoint(DASH, 'dash-summary');
      await touch.down(ts.x, ts.y);
      await eSleep(640);
      for (let i = 1; i <= 8; i++) await touch.move(ts.x, ts.y - i * 45);
      await touch.up();
      await eSleep(800);
      await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);          // the moved section's title is now far below the viewport
      await eSleep(300);
      await evaluate(`document.querySelector('#layout-edit-bar .layout-bar-done').click()`);
      await eSleep(900);
      const landed = await evaluate(`(() => { const s = [...document.querySelectorAll('#page-dashboard .layout-section')].find((x) => x.dataset.sectionId === 'dash-summary'); return { t: Math.round(s.querySelector('[data-section-header]').getBoundingClientRect().top), sy: Math.round(scrollY) }; })()`);
      // (The plan measures the header where it is when Done is pressed — at scrollY 0 its bottom is 126 — so the title lands 16 pt under THAT line, 142; once the header has scrolled away
      // the visible top is the inset, 59. Either way it is in view and never under the status bar, which is the property.)
      assert(landed.sy > 500 && landed.t >= 59 + 8 && landed.t <= 126 + 16 + 4, `Safe area: Done brings the moved section's title into view BELOW the inset, never under the status bar (viewport Y ${landed.t}, inset 59, scrollY ${landed.sy})`);
      await resetLayoutWorld();
    }
    await pg.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } }).catch(() => {});
    await eSleep(200);
  }

  assert(pageErrors.length === 0, `[E-end] the page raised no uncaught exception and no console.error through the whole run (got ${JSON.stringify(pageErrors.slice(0, 3))})`);
} catch (err) {
  fail++;
  console.error('  ❌ [E] the engine-measured half did not complete:', (err && err.stack) || err);
} finally {
  clearTimeout(eWatchdog);
  try { eEngine?.proc.kill(); } catch { /* already gone */ }
  eServer.close();
  try { rmSync(eTmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.exit(fail === 0 ? 0 : 1));
