/**
 * js/section-drag.js — SP-57 (Social Platform, 2026-09-30): the long-press SECTION DRAG engine.
 * DI-475 (entry), DI-476 (one owner per touch), DI-385 (lift / drag / drop), DI-386 (the assistive path's logic).
 *
 * WHAT THIS IS. A leaf module (imports only nav-gestures.js, haptics.js, icons.js; NEVER app.js — every app-side
 * effect arrives as a callback in `opts`). It is the whole mechanism behind "hold a section's title for half a
 * second, drag it, drop it" on the Dashboard and Standings, written so that every DECISION is a pure function a
 * Node test can drive without a browser, and the DOM binder is a thin layer that feeds those functions events and
 * applies what they return.
 *
 *   PURE (no DOM, no clock, no globals; tested to exhaustion in sectiondragtest.mjs)
 *     isSectionHandle(target)          the ONE place "title rows only" lives (DI-475)
 *     pressStep(state, event)          the press gate: arms, cancels and fires the 500 ms hold (DI-475, B1-B3)
 *     slotLayout / nearestSlot /       B8, the drop-target logic for sections taller than the screen: the slot is
 *       slotShifts / dragStep /        where the dragged TITLE is, with 4 px hysteresis against chatter
 *       dragView
 *     autoScrollSpeed / autoScrollStep B9, the edge auto-scroll: v = 720 * ((zone - d) / zone)^2 pt/s, 72 pt zones
 *     scrollIntoViewPlan               B12, the moved section stays in view after Done
 *     moveButtonStates / chooseFocusDirection / movedAnnouncement
 *                                      DI-386, the assistive path's decisions (disabled ends, focus kept)
 *
 *   DOM-LIGHT (one `document`/`window` touch each, all injectable)
 *     ensureLayoutLive / announceLayout / focusLayoutTarget / syncGrips / scrollSectionIntoView
 *     createSectionDragController(deps)  the binder: listeners, timers, rAF loop, inline transforms, claim use
 *     attachSectionDrag / detachSectionDrag / requestDone / requestReset / cancelSectionDrag
 *                                      the default controller app.js calls (DI-385's `attachSectionDrag(container, opts)`)
 *
 * ZERO top-level side effects: importing this module touches no listener, timer or element (the harness imports it
 * under Node with no DOM, and the iOS shell bundles it unchanged).
 *
 * THE CONTRACT WITH app.js (`opts`, read fresh from the container on every paint so a closure never goes stale):
 *   pageKey       'dashboard' | 'standings'
 *   tabKey        the repaint-deferral key: 'dashboard' | 'leaderboard'
 *   visible       the visible section ids in DOM order (array, or a function returning one)
 *   getEditing()  truthy while state.layoutEditing === pageKey
 *   setEditing(pageKey)  set the state AND mount the bar (syncLayoutEditBar); it MUST NOT repaint, because a repaint
 *                 would detach the very node under the finger (DI-385 B5)
 *   onReorder(id, toVisibleIndex)  ONE write per drop (never called when the slot did not change)
 *   onReset()     clearSectionOrder(pageKey) + the existing toast + one repaint
 *   onDone(moved, movedId)  setEditing(null), unmount the bar, ONE repaint, the save toast when `moved`
 *   rerender()    the page's own repaint (parked while the touch is claimed, run once at the drop)
 *   labelOf(id)   the spoken label for announcements (SECTION_LABELS[id])
 *   [additive to DI-385's list: `tabKey`, `labelOf`, and `onDone`'s second argument]
 *
 * THE DOM CONTRACT the stylesheet and markup steps must honour (attributes and classes this module sets/reads):
 *   reads   `[data-section-header]` on each title row; `.layout-section[data-section-id]` on each wrapper;
 *           `.app-header`, `.bottom-nav` (edge measurement); `.layout-section` ids/labels
 *   sets    `data-lifted` on the lifted section (scroll lock + shadow), `data-settling` during the 260 ms settle,
 *           `.section-pressing` on a title row 120 ms into a still hold, `.layout-editing` on the page container,
 *           `.layout-grip` (aria-hidden) at the end of each title row in edit mode, and INLINE `transform`,
 *           `transition`, `transform-origin`, `will-change` on the sections while a lift is live (all cleared at the drop)
 *   creates the persistent `#layout-live` polite live region on <body> (DI-386, C12)
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: write storage, repaint a page, mount the bar, show a toast, or know
 * what a week is. It never reads another player's pick (it never reads a pick at all), so the blind rule has no
 * surface here.
 */
import * as NG from './nav-gestures.js';
import { haptic as realHaptic } from './haptics.js';
import { icon, ICONS } from './icons.js';

// ─────────────────────────────────────────────────────────────────────────
// 1. Constants — ONE place, named (DI-385's table)
// ─────────────────────────────────────────────────────────────────────────

/** The title-row hold. Drew, 2026-09-30 ("the 500s"). Deliberately NOT the 350 ms pill / column / chat hold
 *  (`LONG_PRESS_MS`, app.js and chat-ui.js, left exactly as they are). WIRED (2026-10-01): the one source is
 *  nav-gestures.js (DI-476), which must own it because its repaint-deferral set names the owner and a leaf module
 *  cannot be imported back; this is a re-export, so the two can never drift. */
export const SECTION_LONG_PRESS_MS = NG.SECTION_LONG_PRESS_MS;
/** The claim name in nav-gestures.js's one-owner-per-touch model, and one of the owners the repaint deferral honours
 *  (`deferRenderWhileWeekSwiping`'s owner set, DI-476). Re-exported from nav-gestures.js, as above. */
export const SECTION_DRAG_TOUCH_OWNER = NG.SECTION_DRAG_TOUCH_OWNER;
/** `abs(dx) + abs(dy)` tolerated before a pending hold is a scroll: the same rule as the pill's SCROLL_THRESHOLD. */
export const SECTION_PRESS_SLOP_PX = 8;
/** Edit mode: a title row drags after this much movement, no hold (B11). */
export const SECTION_EDIT_DRAG_SLOP_PX = 6;
/** A still hold tints its title row this long after touchdown (B4). */
export const PRESS_TINT_DELAY_MS = 120;
/** A touch that lands within this long of a scroll event is not armed at all: momentum scrolling (B2). */
export const SCROLL_QUIET_MS = 120;
/** `window.scrollY` may differ from its value at touchstart by at most this at fire time (B2). */
export const SCROLL_DRIFT_PX = 2;
/** iOS (and Android) synthesize mouse events after a tap; mouse input within this long of a touch is ignored. */
export const SYNTHETIC_MOUSE_WINDOW_MS = 600;
/** Switch slot only if the new slot is nearer by MORE than this (stops haptic chatter at a midpoint). */
export const SLOT_HYSTERESIS_PX = 4;
/** Each edge's auto-scroll zone (9 x the 8 pt grid). */
export const EDGE_ZONE_PX = 72;
/** Auto-scroll top speed, pt/s; the ramp is quadratic. Reduce Motion halves it: it is function, not flourish. */
export const AUTOSCROLL_MAX_PPS = 720;
export const AUTOSCROLL_MAX_PPS_REDUCED = 360;
/** rAF delta-time cap, so a stalled frame cannot lurch the page. */
export const AUTOSCROLL_DT_CAP_MS = 50;
/** `--motion-fast` / `--motion-nav`, inside the Principles' 120-180 / 220-300 ms ranges. */
export const LIFT_MS = 150;
export const SETTLE_MS = 260;
/** The lifted section's scale, origin top centre. Reduce Motion: 1. */
export const LIFT_SCALE = 1.02;
/** The fixed "Rearranging" bar, pt. The auto-scroll's top edge is the bar's bottom. */
export const EDIT_BAR_H = 52;
/** A live region is cleared, then written this long after, so a repeated identical string still announces. */
export const LIVE_ANNOUNCE_DELAY_MS = 30;
/** The one-shot click swallow after a lift is armed at TOUCH END and expires after this (never armed at settle). */
export const CLICK_SWALLOW_MS = 350;
/** B12 scroll-into-view: the title is "out of view" above header+8 or within 80 of the nav; it lands 16 below the header. */
export const SCROLL_INTO_VIEW_TOP_PAD_PX = 8;
export const SCROLL_INTO_VIEW_BOTTOM_PAD_PX = 80;
export const SCROLL_INTO_VIEW_ALIGN_PX = 16;

/** The table as one frozen object (the test pins every value; `Object.isFrozen` guards a runtime edit). */
export const SECTION_DRAG_CONSTANTS = Object.freeze({
  SECTION_LONG_PRESS_MS, SECTION_PRESS_SLOP_PX, SECTION_EDIT_DRAG_SLOP_PX, PRESS_TINT_DELAY_MS, SCROLL_QUIET_MS,
  SCROLL_DRIFT_PX, SYNTHETIC_MOUSE_WINDOW_MS, SLOT_HYSTERESIS_PX, EDGE_ZONE_PX, AUTOSCROLL_MAX_PPS,
  AUTOSCROLL_MAX_PPS_REDUCED, AUTOSCROLL_DT_CAP_MS, LIFT_MS, SETTLE_MS, LIFT_SCALE, EDIT_BAR_H,
  LIVE_ANNOUNCE_DELAY_MS, CLICK_SWALLOW_MS,
});

/** Exact spoken copy (DI-385 / DI-386). No string here contains the word "order" (UN-77, loadtest [8d]'s rule). */
export const SECTION_DRAG_COPY = Object.freeze({
  rearranging: 'Rearranging. Drag a section by its title.',
  cancelled: 'Move cancelled.',
  reset: 'Layout reset to the default.',
  saved: 'Layout saved.',
});

/** `{Label} moved to position {n} of {m}.` — n and m over the VISIBLE list. */
export function movedAnnouncement({ label, n, m } = {}) {
  return `${label} moved to position ${n} of ${m}.`;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const freeze = Object.freeze;
const round2 = (v) => Math.round(v * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────
// 2. The eligibility predicate — "title rows only" lives HERE and nowhere else (DI-475)
// ─────────────────────────────────────────────────────────────────────────

export const SECTION_HANDLE_SELECTOR = '[data-section-header]';
/** A control inside a title row keeps its tap and never arms a press. `[draggable="true"]` is what keeps a name or
 *  pick pill (the 350 ms group) from ever being mistaken for a handle, even if one is later placed in a header (C5). */
export const SECTION_HANDLE_EXCLUDE_SELECTOR = 'a, button, input, select, textarea, label, summary, [role="button"], [draggable="true"], [data-no-press]';

/** True iff `target` is on a section title row AND not inside a control or a draggable pill. Anything in a section
 *  body (rows, scores, logos, chips, cells, tables, plain text) is never eligible: there is no "plain content" fallback. */
export function isSectionHandle(target) {
  if (!target || typeof target.closest !== 'function') return false;
  const header = target.closest(SECTION_HANDLE_SELECTOR);
  if (!header) return false;
  return !target.closest(SECTION_HANDLE_EXCLUDE_SELECTOR);
}

/** The ten title rows' touchmove blocker asks this first: it cancels the browser's scroll ONLY while a section is
 *  lifted (the claim is ours). Anything else must scroll natively (DI-476, named deviation 2). */
export function shouldBlockTouchMove(claimOwner) {
  return claimOwner === SECTION_DRAG_TOUCH_OWNER;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. The press gate — pure (DI-475, needs B1-B3)
// ─────────────────────────────────────────────────────────────────────────
//
// phases:  idle -> pending -> claiming -> fired            (a hold that went all the way)
//                  pending -> dead(reason)                 (cancelled, PERMANENTLY for this touch)
//          idle -> dead(reason)                            (never armed: not a handle, suspended, momentum, ...)
// `claiming` means "every gate passed; the binder must now ask claimTouch()". The claim is the LAST gate, so a refused
// claim is the only thing that can kill a press that otherwise would have fired, and it is fed back as a `claim` event.
// A touch that has moved can never become a press, even if the finger later rests: `dead` is sticky until a NEW touch.

export function initialPressState() {
  return freeze({ phase: 'idle', mode: null, reason: null, source: null, t0: 0, x0: 0, y0: 0, x: 0, y: 0, scrollY0: 0, tint: false, waitMs: 0 });
}

const deadPress = (s, reason) => freeze({ ...s, phase: 'dead', reason, tint: false, waitMs: 0 });

/**
 * events (all numbers coerced; nothing is read from a global):
 *   start   { target, t, x, y, scrollY, touches=1, source='touch'|'mouse', button=0, suspended, lastScrollT, lastTouchT, mode='hold'|'edit' }
 *   tint    { t }                   120 ms in: a still pending hold may take its pressed tint
 *   move    { x, y }                abs(dx)+abs(dy) > 8 kills a hold; > 6 starts an edit-mode drag
 *   scroll  {}                      any scroll event kills a pending hold
 *   second-finger | touchcancel | hidden | resize | detached   {}   each kills a pending press
 *   fire    { t, scrollY, connected, suspended, touches }          the 500 ms timer; re-checks every condition
 *   claim   { ok }                  the result of claimTouch('section-drag'), fed back
 *   end     {}                      touchend / mouseup
 */
export function pressStep(state, event) {
  const s = state || initialPressState();
  const e = event || {};
  switch (e.type) {
    case 'start': return pressStart(e);
    case 'tint':
      return (s.phase === 'pending' && s.mode === 'hold' && num(e.t) - s.t0 >= PRESS_TINT_DELAY_MS) ? freeze({ ...s, tint: true }) : s;
    case 'move': {
      if (s.phase !== 'pending') return s;
      const x = num(e.x);
      const y = num(e.y);
      const moved = Math.abs(x - s.x0) + Math.abs(y - s.y0);
      const next = { ...s, x, y };
      if (s.mode === 'edit') return moved > SECTION_EDIT_DRAG_SLOP_PX ? freeze({ ...next, phase: 'claiming' }) : freeze(next);
      return moved > SECTION_PRESS_SLOP_PX ? deadPress(next, 'moved') : freeze(next);
    }
    case 'scroll':
      // Edit mode has no hold to protect, and its touch-action:none rows cannot scroll the page from a title row.
      return (s.phase === 'pending' && s.mode === 'hold') ? deadPress(s, 'scroll') : s;
    case 'second-finger':
    case 'touchcancel':
    case 'hidden':
    case 'resize':
    case 'detached':
      return s.phase === 'pending' ? deadPress(s, e.type) : s;
    case 'fire': {
      if (s.phase !== 'pending' || s.mode !== 'hold') return s;
      const elapsed = num(e.t) - s.t0;
      // A timer that fires a hair early (clock granularity) is told to wait out the remainder, never to lift early.
      if (elapsed < SECTION_LONG_PRESS_MS) return freeze({ ...s, waitMs: SECTION_LONG_PRESS_MS - elapsed });
      if ((e.touches ?? 1) !== 1) return deadPress(s, 'second-finger');
      if (e.connected !== true) return deadPress(s, 'detached');             // fail closed: an unknown node is a gone node
      if (Math.abs(s.x - s.x0) + Math.abs(s.y - s.y0) > SECTION_PRESS_SLOP_PX) return deadPress(s, 'moved');
      if (Math.abs(num(e.scrollY) - s.scrollY0) > SCROLL_DRIFT_PX) return deadPress(s, 'scroll');
      if (e.suspended) return deadPress(s, 'suspended');
      return freeze({ ...s, phase: 'claiming', waitMs: 0 });
    }
    case 'claim':
      if (s.phase !== 'claiming') return s;
      return e.ok === true ? freeze({ ...s, phase: 'fired' }) : deadPress(s, 'claim-refused');
    case 'end':
      return s.phase === 'pending' ? deadPress(s, 'released') : s;
    default:
      return s;
  }
}

function pressStart(e) {
  const mode = e.mode === 'edit' ? 'edit' : 'hold';
  const source = e.source === 'mouse' ? 'mouse' : 'touch';
  const base = {
    ...initialPressState(), mode, source,
    t0: num(e.t), x0: num(e.x), y0: num(e.y), x: num(e.x), y: num(e.y), scrollY0: num(e.scrollY),
  };
  const kill = (reason) => deadPress(base, reason);
  if (source === 'mouse') {
    if ((e.button ?? 0) !== 0) return kill('button');
    if (e.lastTouchT != null && base.t0 - num(e.lastTouchT) < SYNTHETIC_MOUSE_WINDOW_MS) return kill('synthetic-mouse');
  }
  if ((e.touches ?? 1) !== 1) return kill('second-finger');
  if (!isSectionHandle(e.target)) return kill('not-handle');
  if (e.suspended) return kill('suspended');
  if (mode === 'hold' && e.lastScrollT != null && base.t0 - num(e.lastScrollT) < SCROLL_QUIET_MS) return kill('scroll-settle');
  return freeze({ ...base, phase: 'pending' });
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Drop-target logic — pure (B8, DI-385)
// ─────────────────────────────────────────────────────────────────────────
//
// `geo` is the UNTRANSFORMED document-space geometry of every visible section in DOM order: [{ top, h }].
// A slot j is "the dragged section's position in the final list" (0 .. n-1). `cum[j]` is where the dragged section's
// TITLE would sit in slot j (cumulative heights of the OTHER sections plus gaps). The slot is the one nearest the
// dragged title, so a 900 pt section needs no more travel than a 96 pt one, and it lands where it is held.

/** The gap between consecutive sections, read from the first pair (the stack is uniform: one CSS gap). */
export function inferGap(geo) {
  if (!Array.isArray(geo) || geo.length < 2) return 0;
  return Math.max(0, num(geo[1].top) - (num(geo[0].top) + num(geo[0].h)));
}

export function slotLayout(geo, i0, gap = 0) {
  const others = [];
  for (let k = 0; k < geo.length; k++) if (k !== i0) others.push(k);
  const cum = [];
  let y = num(geo[0].top);
  others.forEach((k, m) => { cum[m] = y; y += num(geo[k].h) + num(gap); });
  cum[others.length] = y;                       // the slot after the last other section
  return { others, cum };
}

/** Where the dragged title may be: clamped to the first and last slot (a finger past the ends does not overshoot). */
export function clampTitleTop(cum, y) {
  return Math.min(cum[cum.length - 1], Math.max(cum[0], num(y)));
}

/**
 * The slot whose title position is nearest `titleTop`, with hysteresis against `currentSlot`: leave the current slot
 * only if the new one is nearer by MORE than `hysteresis` px. Ties (equal distance) go to the lower slot, and to the
 * current slot when it is one of the tied. The margin never exceeds half the distance between the two slots, so tiny
 * sections can never trap the drag in a slot it cannot leave.
 */
export function nearestSlot(cum, titleTop, currentSlot = -1, hysteresis = SLOT_HYSTERESIS_PX) {
  const y = num(titleTop);
  let best = 0;
  let bestD = Infinity;
  for (let j = 0; j < cum.length; j++) {
    const d = Math.abs(cum[j] - y);
    if (d < bestD) { bestD = d; best = j; }
  }
  if (currentSlot >= 0 && currentSlot < cum.length && best !== currentSlot) {
    const curD = Math.abs(cum[currentSlot] - y);
    const margin = Math.min(num(hysteresis), Math.abs(cum[best] - cum[currentSlot]) / 2);
    if (curD - bestD <= margin) return currentSlot;
  }
  return best;
}

/** `dy` for every section (index = DOM index) when the dragged section sits in slot `j`; the dragged one reports 0. */
export function slotShifts({ geo, i0, j, gap = 0 } = {}) {
  const { others, cum } = slotLayout(geo, i0, gap);
  const out = geo.map(() => 0);
  others.forEach((k, m) => {
    const newTop = m < j ? cum[m] : cum[m] + num(geo[i0].h) + num(gap);
    out[k] = round2(newTop - num(geo[k].top));
  });
  return out;
}

/** A section's UNTRANSFORMED document geometry from its live rect, given the transform this module itself applied
 *  (translateY dy, scale about the TOP edge: the top edge does not scale). A re-measure mid-lift stays exact. */
export function untransformedGeometry({ rect, scrollY, applied } = {}) {
  const a = applied || { dy: 0, scale: 1 };
  return { top: num(rect.top) + num(scrollY) - num(a.dy), h: num(rect.height) / (num(a.scale) || 1) };
}

const cleanGeo = (geo) => (Array.isArray(geo) ? geo.map((g) => freeze({ top: num(g?.top), h: Math.max(0, num(g?.h)) })) : []);

// ─────────────────────────────────────────────────────────────────────────
// 5. The lift / drag / drop state — pure (DI-385 B5-B11)
// ─────────────────────────────────────────────────────────────────────────
//
// phases: idle -> lifted -> settling -> idle.   The finger's position is kept in VIEWPORT y (`clientY`) plus the page's
// `scrollY`, so an auto-scroll step moves the content under a still finger and the slot is recomputed (B9).

export function initialDragState() {
  return freeze({ phase: 'idle', mode: null, id: null, i0: -1, j: -1, n: 0, geo: freeze([]), gap: 0, h0: 0, offset: 0, clientY: 0, scrollY: 0,
    scrollHeight: 0, titleTop: 0, reduceMotion: false, changedSlot: false, needsRemeasure: false, outcome: null });
}

function recomputeDrag(s) {
  const { cum } = slotLayout(s.geo, s.i0, s.gap);
  const docY = s.clientY + s.scrollY;
  const titleTop = clampTitleTop(cum, docY - s.offset);
  const j = nearestSlot(cum, titleTop, s.j, SLOT_HYSTERESIS_PX);
  return freeze({ ...s, titleTop, j, changedSlot: j !== s.j });
}

function settleState(s, commit, reason) {
  const fin = commit ? s.j : s.i0;
  return freeze({
    ...s, phase: 'settling', changedSlot: false, needsRemeasure: false,
    outcome: freeze({ id: s.id, from: s.i0, to: fin, moved: fin !== s.i0, cancelled: !commit, reason: reason || (commit ? 'drop' : 'cancel') }),
  });
}

/**
 * events:
 *   lift       { id, i0, geo, gap?, clientY, scrollY, scrollHeight, reduceMotion, mode }
 *   move       { clientY }
 *   scroll     { scrollY, scrollHeight }    flags `needsRemeasure` when the page's height changed since the geometry was taken
 *   remeasure  { geo, gap?, scrollHeight }  new geometry; the drag CONTINUES (a count change cancels instead)
 *   release    { commit? }                  finger up: settles into the nearest slot
 *   cancel     { reason }                   touchcancel / Escape / hidden / rotation / suspension: settles back, no write
 *   settled    {}                           the 260 ms glide is over (or was skipped)
 * The terminal `outcome` { id, from, to, moved, cancelled, reason } is what the binder acts on: ONE write iff `moved`.
 */
export function dragStep(state, event) {
  const s = state || initialDragState();
  const e = event || {};
  switch (e.type) {
    case 'lift': {
      const geo = cleanGeo(e.geo);
      const i0 = Number(e.i0);
      if (geo.length < 2 || !Number.isInteger(i0) || i0 < 0 || i0 >= geo.length) {
        return freeze({ ...initialDragState(), outcome: freeze({ id: e.id ?? null, from: i0, to: i0, moved: false, cancelled: true, reason: 'invalid-lift' }) });
      }
      const clientY = num(e.clientY);
      const scrollY = num(e.scrollY);
      const lifted = {
        phase: 'lifted', mode: e.mode === 'edit' ? 'edit' : 'hold', id: e.id ?? null, i0, j: i0, n: geo.length, geo: freeze(geo),
        gap: e.gap != null ? Math.max(0, num(e.gap)) : inferGap(geo), h0: geo[i0].h,
        offset: clientY + scrollY - geo[i0].top, clientY, scrollY, scrollHeight: num(e.scrollHeight), titleTop: geo[i0].top,
        reduceMotion: e.reduceMotion === true, changedSlot: false, needsRemeasure: false, outcome: null,
      };
      // The grab itself never reads as a slot change (no haptic at lift beyond the lift's own).
      return freeze({ ...recomputeDrag(lifted), j: i0, changedSlot: false });
    }
    case 'move':
      return s.phase === 'lifted' ? recomputeDrag({ ...s, clientY: num(e.clientY) }) : s;
    case 'scroll': {
      if (s.phase !== 'lifted') return s;
      const next = { ...s, scrollY: num(e.scrollY) };
      if (e.scrollHeight != null && num(e.scrollHeight) !== s.scrollHeight) next.needsRemeasure = true;
      return recomputeDrag(next);
    }
    case 'remeasure': {
      if (s.phase !== 'lifted') return s;
      const geo = cleanGeo(e.geo);
      if (geo.length !== s.n) return settleState(s, false, 'geometry-changed');
      return recomputeDrag({
        ...s, geo: freeze(geo), gap: e.gap != null ? Math.max(0, num(e.gap)) : inferGap(geo), h0: geo[s.i0].h,
        scrollHeight: e.scrollHeight != null ? num(e.scrollHeight) : s.scrollHeight, needsRemeasure: false,
      });
    }
    case 'release': return s.phase === 'lifted' ? settleState(s, e.commit !== false, e.reason) : s;
    case 'cancel': return s.phase === 'lifted' ? settleState(s, false, e.reason || 'cancel') : s;
    case 'settled': return s.phase === 'settling' ? freeze({ ...s, phase: 'idle' }) : s;
    default: return s;
  }
}

/** What to paint for a state: the dragged section's `dy` and `scale`, every section's `dy`, and the slot. */
export function dragView(s) {
  if (!s || (s.phase !== 'lifted' && s.phase !== 'settling')) return null;
  const { cum } = slotLayout(s.geo, s.i0, s.gap);
  if (s.phase === 'lifted') {
    return {
      slot: s.j, animate: !s.reduceMotion,
      dragged: { index: s.i0, dy: round2(s.titleTop - s.geo[s.i0].top), scale: s.reduceMotion ? 1 : LIFT_SCALE },
      shifts: slotShifts({ geo: s.geo, i0: s.i0, j: s.j, gap: s.gap }),
    };
  }
  const to = s.outcome.to;
  return {
    slot: to, animate: !s.reduceMotion,
    dragged: { index: s.i0, dy: round2(cum[to] - s.geo[s.i0].top), scale: 1 },
    shifts: s.outcome.moved ? slotShifts({ geo: s.geo, i0: s.i0, j: to, gap: s.gap }) : s.geo.map(() => 0),
  };
}

export const liftTransform = (dy, scale) => `translate3d(0px, ${round2(num(dy))}px, 0px) scale(${scale})`;
export const shiftTransform = (dy) => (num(dy) ? `translate3d(0px, ${round2(num(dy))}px, 0px)` : '');

// ─────────────────────────────────────────────────────────────────────────
// 6. Edge auto-scroll — pure (B9, the one place JavaScript scrolls the page: named deviation 1)
// ─────────────────────────────────────────────────────────────────────────

/** The part of the app header that is still ON SCREEN. `.app-header` is `position:relative` in this app (css/styles.css,
 *  "a sticky that never sticks renders identically to relative"), so it scrolls away with the page and its rect bottom
 *  goes NEGATIVE; the fixed bar then sits at the viewport's top, and every edge computed from the header must too.
 *  (SP-57 wiring, 2026-10-01: the design input assumed a sticky header; measured, it is not.) */
export function visibleHeaderBottom(rectBottom, safeTop = 0) {
  return Math.max(0, num(safeTop), num(rectBottom));
}

/** The top safe-area inset in px (the notch / Dynamic Island band on the Munera shell and an installed PWA): the header's own `padding-top` IS
 *  `env(safe-area-inset-top)` (css/styles.css, `.app-header`), so it is read from there. Once the header has scrolled away the page scrolls UNDER the
 *  status bar, and nothing the module places or measures may go above this line. 0 where there is no inset, no header or no getComputedStyle. */
export function safeTopOf(header, win = globalThis.window) {
  try {
    if (!header || !win || typeof win.getComputedStyle !== 'function') return 0;
    const v = Number.parseFloat(win.getComputedStyle(header).paddingTop);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

/** Viewport-space edges: the top is the BOTTOM of the fixed bar — measured from the bar itself when it is mounted (`barBottom`: it sits under the
 *  visible header or the safe-area inset, whichever is lower), else the visible header bottom + 52 — and the bottom is the top of `.bottom-nav`
 *  (forced visible while editing), never below the viewport. */
export function autoScrollEdges({ headerBottom = 0, navTop = null, viewportH = 0, barBottom = null } = {}) {
  const vh = num(viewportH);
  const top = barBottom !== null && barBottom !== undefined && Number.isFinite(Number(barBottom)) ? num(barBottom) : num(headerBottom) + EDIT_BAR_H;
  return { top, bottom: Number.isFinite(Number(navTop)) && navTop !== null ? Math.min(num(navTop), vh) : vh };
}

/**
 * Signed pt/s: negative scrolls up, positive down, 0 outside the zones.
 * `v = vmax * ((zone - d) / zone)^2`, `d` the finger's distance from the EDGE line (0 at the edge, `zone` at the
 * zone's inner boundary, clamped: a finger PAST the edge is full speed). So the ramp is 0 at the boundary (no
 * velocity step on entry) and `vmax` at the edge. If the zones overlap (a very short viewport) the nearer edge wins.
 */
export function autoScrollSpeed({ pointerY, topEdge, bottomEdge, reduceMotion = false, zone = EDGE_ZONE_PX } = {}) {
  const vmax = reduceMotion ? AUTOSCROLL_MAX_PPS_REDUCED : AUTOSCROLL_MAX_PPS;
  const y = num(pointerY);
  const dTop = y - num(topEdge);
  const dBottom = num(bottomEdge) - y;
  const inTop = dTop < zone;
  const inBottom = dBottom < zone;
  if (!inTop && !inBottom) return 0;
  const useTop = inTop && (!inBottom || dTop <= dBottom);
  const d = Math.min(zone, Math.max(0, useTop ? dTop : dBottom));
  const v = vmax * ((zone - d) / zone) ** 2;
  return useTop ? -v : v;
}

/**
 * One frame. Returns `{ dy, carry, speed, stopped }`: `dy` is a whole number of pixels to scroll this frame, `carry`
 * the fractional remainder to feed back next frame (the fractional-pixel accumulator: without it a 60 Hz frame at
 * 5 pt/s rounds to nothing, and the ramp's slow end would not move), `stopped` why nothing moved (null when it did).
 * Delta-time driven with the dt cap; never scrolls past either end; never scrolls a page that is not taller than the viewport.
 */
export function autoScrollStep({ pointerY, topEdge, bottomEdge, dtMs, scrollY, maxScrollY, reduceMotion = false, carry = 0 } = {}) {
  const speed = autoScrollSpeed({ pointerY, topEdge, bottomEdge, reduceMotion });
  const out = { dy: 0, carry: 0, speed, stopped: null };
  if (speed === 0) { out.stopped = 'out-of-zone'; return out; }
  const max = num(maxScrollY);
  if (!(max > 0)) { out.stopped = 'no-scroll'; return out; }
  const y = num(scrollY);
  if (speed < 0 && y <= 0) { out.stopped = 'top'; return out; }
  if (speed > 0 && y >= max) { out.stopped = 'end'; return out; }
  const dt = Math.min(Math.max(num(dtMs), 0), AUTOSCROLL_DT_CAP_MS) / 1000;
  const acc = num(carry) + speed * dt;
  const whole = Math.trunc(acc);
  out.carry = acc - whole;
  out.dy = speed < 0 ? Math.max(whole, -y) : Math.min(whole, max - y);
  if (out.dy !== whole) out.carry = 0;                            // hit an end this frame: nothing left to carry
  return out;
}

/** The ONLY way the module scrolls the page during a lift. `behavior: 'instant'` is load-bearing: the stylesheet's
 *  `html { scroll-behavior: smooth }` would otherwise turn every frame's step into a smooth scroll that fights the next (C8). */
export function autoScrollOptions(dy) {
  return { top: dy, left: 0, behavior: 'instant' };
}

/** The iOS 15.0 target: an engine that rejects `behavior: 'instant'` (a TypeError on an unknown enum value) must not abort a drag or a
 *  drop. Try the options form; fall back to the numeric form (which `html { scroll-behavior: smooth }` may smooth, but which still scrolls);
 *  a window with no scroll API at all is a no-op. Never throws. */
export function scrollWindow(win, options, method = 'scrollBy') {
  if (!win || typeof win[method] !== 'function') return false;
  try { win[method](options); return true; } catch { /* the options form was rejected */ }
  try { if (method === 'scrollBy') win.scrollBy(num(options.left), num(options.top)); else win.scrollTo(num(options.left), num(options.top)); return true; } catch { return false; }
}

/** B12: after Done, a moved section whose title is above the header (+8) or within 80 pt of the nav is scrolled into
 *  view, landing 16 pt under the header; otherwise the scroll position is untouched (`null`). */
export function scrollIntoViewPlan({ titleTop, headerBottom, navTop, reduceMotion = false } = {}) {
  const t = num(titleTop);
  const hb = num(headerBottom);
  const nt = num(navTop);
  if (t >= hb + SCROLL_INTO_VIEW_TOP_PAD_PX && t <= nt - SCROLL_INTO_VIEW_BOTTOM_PAD_PX) return null;
  return { deltaY: t - (hb + SCROLL_INTO_VIEW_ALIGN_PX), behavior: reduceMotion ? 'instant' : 'smooth' };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. The permanent assistive path's logic (DI-386)
// ─────────────────────────────────────────────────────────────────────────
// The markup (`.section-move-bar.sr-only` buttons and the hidden Reset) is composeSections()'s, in app.js. What lives
// here is the part with a decision in it: which end is disabled, where focus goes after the repaint destroys the
// focused button (today nothing restores it, so VoiceOver would drop to the top of the page after every tap), and the
// persistent live region.

/** First section's Move up and last section's Move down are disabled. */
export function moveButtonStates(index, count) {
  return { upDisabled: !(index > 0), downDisabled: !(index < count - 1) };
}

/** After a move: focus the SAME section's SAME-direction button; if that direction is now disabled, the OTHER one. */
export function chooseFocusDirection(dir, states) {
  const want = dir === 'down' ? 'down' : 'up';
  const other = want === 'up' ? 'down' : 'up';
  const disabled = (d) => (d === 'up' ? states.upDisabled : states.downDisabled);
  if (!disabled(want)) return want;
  return disabled(other) ? null : other;
}

/** The one persistent polite live region (DI-386, C12): on <body>, outside every repainted container, created once. */
export function ensureLayoutLive(doc = globalThis.document) {
  if (!doc || !doc.body || typeof doc.getElementById !== 'function') return null;
  let el = doc.getElementById('layout-live');
  if (el) return el;
  el = doc.createElement('div');
  if (!el || typeof el.setAttribute !== 'function') return null;     // not a real element: announcing is best effort
  el.id = 'layout-live';
  el.className = 'sr-only';
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  doc.body.appendChild(el);
  return el;
}

/** Clear, then set after 30 ms, so repeating the same string still announces. The latest call wins. */
export function announceLayout(msg, env = {}) {
  const live = ensureLayoutLive(env.doc || globalThis.document);
  if (!live) return false;
  const st = env.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const ct = env.clearTimeout || ((id) => globalThis.clearTimeout(id));
  if (live._announceTimer != null) ct(live._announceTimer);
  live.textContent = '';
  live._announceTimer = st(() => { live._announceTimer = null; live.textContent = String(msg ?? ''); }, LIVE_ANNOUNCE_DELAY_MS);
  return true;
}

/**
 * Consume the one-shot focus target at the end of the bind pass. `target` is `{ id, dir }` (a hidden Move button) or
 * `{ reset: true, pageKey? }` (the hidden Reset). Focus is NOT `preventScroll`: the focused element must be brought
 * into view for a keyboard user, and VoiceOver follows focus. Returns the focused element, or null.
 */
export function focusLayoutTarget(root, target) {
  if (!root || !target || typeof root.querySelectorAll !== 'function') return null;
  const attr = (el, name) => el.getAttribute?.(name);
  if (target.reset) {
    const twin = [...root.querySelectorAll('.layout-reset-btn')].find((b) => !target.pageKey || attr(b, 'data-layout-page') === target.pageKey);
    if (!twin) return null;
    twin.focus();
    return twin;
  }
  const mine = [...root.querySelectorAll('.section-move-btn')].filter((b) => attr(b, 'data-move-id') === target.id);
  const byDir = (d) => mine.find((b) => attr(b, 'data-move-dir') === d);
  const states = { upDisabled: !byDir('up') || !!byDir('up').disabled, downDisabled: !byDir('down') || !!byDir('down').disabled };
  const dir = chooseFocusDirection(target.dir, states);
  const el = dir ? byDir(dir) : null;
  if (!el) return null;
  el.focus();
  return el;
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Small DOM helpers
// ─────────────────────────────────────────────────────────────────────────

const sectionsOf = (container) => [...container.querySelectorAll('.layout-section')];
const sectionIdOf = (el) => el.getAttribute?.('data-section-id') || '';
const scrollYOf = (win) => (win ? num(win.scrollY ?? win.pageYOffset ?? 0) : 0);
const scrollHeightOf = (doc) => num(doc?.documentElement?.scrollHeight ?? 0);

/** A grip at the right end of every title row while editing; removed when not. Derived from state on every paint AND
 *  inserted in place at the lift (a repaint there would detach the touched node). The icon is trusted static markup. */
export function syncGrips(container, editing, gripHTML) {
  if (!container || typeof container.querySelectorAll !== 'function') return;
  const html = typeof gripHTML === 'function' ? gripHTML : defaultGripHTML;
  for (const header of container.querySelectorAll(SECTION_HANDLE_SELECTOR)) {
    const existing = header.querySelector('.layout-grip');
    if (editing && !existing) {
      const span = header.ownerDocument.createElement('span');
      span.className = 'layout-grip';
      span.setAttribute('aria-hidden', 'true');
      span.innerHTML = html();
      header.appendChild(span);
    } else if (!editing && existing) {
      existing.remove();
    }
  }
}
// `grip` is in icons.js (SP-57 wiring); the guard keeps an injected/partial icon table from warning on every paint.
function defaultGripHTML() { return ICONS.grip ? icon('grip') : ''; }

/** B12: after Done's single repaint, keep the moved section in view. */
export function scrollSectionIntoView({ container, id, doc = globalThis.document, win = globalThis.window, reduceMotion = false } = {}) {
  if (!container || !win || typeof win.scrollBy !== 'function') return false;
  const section = sectionsOf(container).find((el) => sectionIdOf(el) === id);
  const header = section && section.querySelector(SECTION_HANDLE_SELECTOR);
  if (!header) return false;
  const appHeader = doc?.querySelector?.('.app-header');
  const nav = doc?.querySelector?.('.bottom-nav');
  const plan = scrollIntoViewPlan({
    titleTop: header.getBoundingClientRect().top,
    headerBottom: appHeader ? visibleHeaderBottom(appHeader.getBoundingClientRect().bottom, safeTopOf(appHeader, win)) : 0,
    navTop: nav ? Math.min(nav.getBoundingClientRect().top, num(win.innerHeight)) : num(win.innerHeight),
    reduceMotion,
  });
  if (!plan) return false;
  scrollWindow(win, { top: plan.deltaY, left: 0, behavior: plan.behavior });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// 9. The controller — the binder (DI-385's `attachSectionDrag`, plus Done / Reset / cancel)
// ─────────────────────────────────────────────────────────────────────────

function resolveDeps(over = {}) {
  const nav = over.nav || NG;
  return {
    doc: () => over.doc ?? globalThis.document,
    win: () => over.win ?? globalThis.window,
    now: over.now || (() => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now())),
    setTimeout: over.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms)),
    clearTimeout: over.clearTimeout || ((id) => globalThis.clearTimeout(id)),
    raf: over.raf || ((fn) => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(fn) : globalThis.setTimeout(() => fn(Date.now()), 16))),
    caf: over.caf || ((id) => (typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame(id) : globalThis.clearTimeout(id))),
    haptic: over.haptic || realHaptic,
    claim: over.claimTouch || nav.claimTouch,
    release: over.releaseTouch || nav.releaseTouch,
    claimedBy: over.touchClaimedBy || nav.touchClaimedBy,
    // Suspended by an OVERLAY (sign-in gate, modal, sheet, drawer ...), never by this feature's own bar: DI-476 adds
    // `#layout-edit-bar` to gesturesSuspended() for every OTHER gesture, and the lift/drag must not be frozen by it.
    suspended: over.suspended || (() => !!nav.gesturesSuspended({ ignoreLayoutBar: true })),
    reducedMotion: over.prefersReducedMotion || nav.prefersReducedMotion,
    deferRender: over.deferRender || nav.deferRenderWhileWeekSwiping,
    // DI-476's `releaseTouchAndFlush` (SB-15 added it to nav-gestures.js; SP-57 adds this owner to the deferral set).
    // The fallback to a plain release is kept only for an injected `nav` that lacks it (the engine suite's fakes).
    releaseAndFlush: over.releaseAndFlush || (typeof nav.releaseTouchAndFlush === 'function' ? nav.releaseTouchAndFlush : (owner) => nav.releaseTouch(owner)),
    gripHTML: over.gripHTML || defaultGripHTML,
  };
}

/** One controller owns the module-wide state (a touch is one finger and the claim is global, so one gesture at a time). */
export function createSectionDragController(over = {}) {
  const deps = resolveDeps(over);
  const OWNER = SECTION_DRAG_TOUCH_OWNER;

  let g = null;                  // the live gesture: its press state, then its drag state, then its settle
  let lastScrollT = null;
  let lastTouchT = null;
  let moved = false;             // did any drop write since edit mode began (the Done toast's "if anything moved")
  let movedId = null;
  const attached = new Set();    // every container with a live binder (Dashboard and Standings): Done / Reset / Escape pick among them
  let lastAttached = null;       // the most recently attached container, the fallback target
  let globalOff = null;
  let swallowOff = null;         // the armed click swallow's remover, if one is live

  const annEnv = () => ({ doc: deps.doc(), setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout });
  const optsList = (opts) => (typeof opts.visible === 'function' ? opts.visible() : opts.visible) || [];

  /** A thrown error inside a gesture handler must never leave the claim held (a stale claim silences every other gesture). */
  function guarded(fn) {
    return function guardedHandler(...args) {
      try { return fn.apply(this, args); } catch (err) {
        try { console.error('[section-drag]', err); } catch { /* console may be absent */ }
        abortGesture();
        return undefined;
      }
    };
  }

  // ── per-gesture plumbing ───────────────────────────────────────────────
  function on({ list, target, type, fn, options }) {
    target.addEventListener(type, fn, options);
    list.push(() => target.removeEventListener(type, fn, options));
  }
  function runOff(list) {
    for (const off of list.splice(0)) { try { off(); } catch { /* a listener already gone */ } }
  }
  function clearPressTimers(cur) {
    if (cur.timers.fire != null) deps.clearTimeout(cur.timers.fire);
    if (cur.timers.tint != null) deps.clearTimeout(cur.timers.tint);
    cur.timers.fire = null;
    cur.timers.tint = null;
  }
  function clearInlineStyles(cur) {
    if (!cur.items) return;
    const doc = deps.doc();
    for (const el of cur.items) {
      el.style.transition = 'none';
      el.style.transform = '';
      el.removeAttribute('data-lifted');
      el.removeAttribute('data-settling');
    }
    void doc?.documentElement?.offsetHeight;      // commit the un-transformed layout BEFORE the transition is restored
    for (const el of cur.items) {
      el.style.transition = '';
      el.style.transformOrigin = '';
      el.style.willChange = '';
    }
  }
  function teardown(cur) {
    clearPressTimers(cur);
    if (cur.timers.settle != null) deps.clearTimeout(cur.timers.settle);
    cur.timers.settle = null;
    if (cur.raf != null) deps.caf(cur.raf);
    cur.raf = null;
    runOff(cur.offPointer);
    runOff(cur.offMisc);
    cur.header?.classList.remove('section-pressing');
  }
  /** End a press that never became a lift (dead, released or never claimed). Nothing was changed, nothing to repaint. */
  function endPress(cur) {
    teardown(cur);
    if (g === cur) g = null;
    deps.release(OWNER);                          // a no-op unless this gesture's own claim is somehow still held
  }
  function abortGesture() {
    const cur = g;
    g = null;
    if (cur) {
      try { teardown(cur); } catch { /* best effort */ }
      try { clearInlineStyles(cur); } catch { /* best effort */ }
    }
    try { deps.releaseAndFlush(OWNER); } catch { /* best effort */ }
  }

  // ── start ──────────────────────────────────────────────────────────────
  function beginGesture({ container, opts, e, source, x, y, touchId, touches, button }) {
    const win = deps.win();
    const ids = optsList(opts);
    if (ids.length < 2) return;                   // nothing to rearrange: no press binder (DI-475)
    const editing = !!(typeof opts.getEditing === 'function' && opts.getEditing());
    const press = pressStep(initialPressState(), {
      type: 'start', mode: editing ? 'edit' : 'hold', source, target: e.target, t: deps.now(), x, y, scrollY: scrollYOf(win), touches, button,
      suspended: deps.suspended(), lastScrollT, lastTouchT,
    });
    if (press.phase !== 'pending') return;
    const header = e.target.closest(SECTION_HANDLE_SELECTOR);
    const section = header && header.closest('.layout-section');
    const sections = sectionsOf(container);
    if (!section || !sections.includes(section)) return;
    // The slot indices handed to onReorder are positions in the VISIBLE list; the DOM sections must be exactly that list,
    // in that order, or a drop would write the wrong index. A stale `opts` (a missed attach after a repaint) is a wiring
    // bug: refuse to arm, loudly, rather than risk a wrong write.
    if (sections.map(sectionIdOf).join('|') !== ids.join('|')) {
      try { console.warn('[section-drag] the visible section ids do not match the DOM sections; not arming', { dom: sections.map(sectionIdOf), visible: ids }); } catch { /* console may be absent */ }
      return;
    }
    const cur = {
      container, opts, source, target: e.target, touchId, header, section, press, drag: null, touches: 1, pointX: x, pointY: y,
      timers: { fire: null, tint: null, settle: null }, offPointer: [], offMisc: [], items: null, applied: null, raf: null, lastTs: null, carry: 0, width0: 0,
    };
    g = cur;
    const doc = deps.doc();
    if (source === 'touch') {
      // Per-gesture listeners go on the TOUCH'S OWN TARGET (as the pill binder does): a touch keeps reporting to its first
      // node even if that node is later detached, which a document-level listener would miss.
      const pointer = cur.offPointer;
      on({ list: pointer, target: e.target, type: 'touchmove', options: { passive: true },
        fn: guarded((ev) => { if (g !== cur) return; const p = touchPoint(ev, cur.touchId); if (p) pointMove(cur, p.clientX, p.clientY); }) });
      on({ list: pointer, target: e.target, type: 'touchend', options: { passive: true }, fn: guarded(() => { if (g === cur) pointEnd(cur, false); }) });
      on({ list: pointer, target: e.target, type: 'touchcancel', options: { passive: true }, fn: guarded(() => { if (g === cur) pointEnd(cur, true); }) });
      // A second finger ANYWHERE cancels a pending press (only the first touch's own target hears its own events).
      on({ list: pointer, target: doc, type: 'touchstart', options: { passive: true, capture: true }, fn: guarded((ev) => {
        if (g !== cur || cur.drag || (ev.touches?.length ?? 0) <= 1) return;
        cur.touches = ev.touches.length;
        cur.press = pressStep(cur.press, { type: 'second-finger' });
        if (cur.press.phase === 'dead') endPress(cur);
      }) });
    } else {
      on({ list: cur.offPointer, target: doc, type: 'mousemove', fn: guarded((ev) => { if (g === cur) pointMove(cur, ev.clientX, ev.clientY); }) });
      on({ list: cur.offPointer, target: doc, type: 'mouseup', fn: guarded(() => { if (g === cur) pointEnd(cur, false); }) });
    }
    // Android's long-press menu and desktop text selection would compete with the hold; both are suppressed for its life.
    const misc = cur.offMisc;
    on({ list: misc, target: doc, type: 'contextmenu',
      fn: guarded((ev) => { if (g === cur && (cur.drag || ev.target?.closest?.(SECTION_HANDLE_SELECTOR))) ev.preventDefault(); }) });
    on({ list: misc, target: doc, type: 'selectstart', fn: guarded((ev) => { if (g === cur && source === 'mouse') ev.preventDefault(); }) });
    on({ list: misc, target: doc, type: 'visibilitychange',
      fn: guarded(() => { if (g === cur && (doc.hidden === true || doc.visibilityState === 'hidden')) cancelActive('hidden'); }) });
    if (win && win.addEventListener) on({ list: misc, target: win, type: 'resize', fn: guarded(() => onResize(cur)) });
    if (press.mode === 'hold') {
      cur.timers.tint = deps.setTimeout(guarded(() => {
        if (g !== cur || cur.drag) return;
        cur.press = pressStep(cur.press, { type: 'tint', t: deps.now() });
        if (cur.press.tint) cur.header.classList.add('section-pressing');
      }), PRESS_TINT_DELAY_MS);
      cur.timers.fire = deps.setTimeout(guarded(() => onFireTimer(cur)), SECTION_LONG_PRESS_MS);
    }
  }

  function touchPoint(ev, id) {
    const list = ev.touches && ev.touches.length ? [...ev.touches] : [];
    if (id === undefined) return list[0] || null;
    return list.find((t) => t.identifier === id) || null;
  }

  function onFireTimer(cur) {
    if (g !== cur || cur.drag || cur.press.phase !== 'pending') return;
    const win = deps.win();
    cur.press = pressStep(cur.press, {
      type: 'fire', t: deps.now(), scrollY: scrollYOf(win), connected: !!(cur.section.isConnected && cur.header.isConnected), suspended: deps.suspended(), touches: cur.touches,
    });
    if (cur.press.phase === 'pending' && cur.press.waitMs > 0) {
      cur.timers.fire = deps.setTimeout(guarded(() => onFireTimer(cur)), Math.ceil(cur.press.waitMs));
      return;
    }
    if (cur.press.phase !== 'claiming') { endPress(cur); return; }
    claimAndLift(cur);
  }

  function claimAndLift(cur) {
    // The claim is attempted LAST, after every other gate passed; a refusal (a pill drag or a week swipe owns this touch)
    // is the only thing that can stop an otherwise valid hold, and it changes nothing.
    cur.press = pressStep(cur.press, { type: 'claim', ok: deps.claim(OWNER) });
    if (cur.press.phase !== 'fired') { endPress(cur); return; }
    liftFrom(cur);
  }

  function pointMove(cur, x, y) {
    cur.pointX = x;
    cur.pointY = y;
    if (cur.drag) {
      if (cur.drag.phase !== 'lifted') return;
      cur.drag = dragStep(cur.drag, { type: 'move', clientY: y });
      paint(cur);
      return;
    }
    cur.press = pressStep(cur.press, { type: 'move', x, y });
    if (cur.press.phase === 'dead') { endPress(cur); return; }
    if (cur.press.phase === 'claiming') claimAndLift(cur);          // edit mode: 6 pt of movement, no hold
  }

  // ── the lift (DI-385 "Fire", in this order) ────────────────────────────
  function liftFrom(cur) {
    const { container, opts, section } = cur;
    const win = deps.win();
    const doc = deps.doc();
    const edit = cur.press.mode === 'edit';
    clearPressTimers(cur);
    cur.header.classList.remove('section-pressing');
    // (1) the claim is already ours (claimAndLift). (2) the haptic: medium for the hold, light for an edit-mode pickup.
    deps.haptic(edit ? 'light' : 'medium');
    // (3) edit mode in place, with NO repaint (a repaint would detach the touched node).
    if (!edit) {
      if (typeof opts.setEditing === 'function') opts.setEditing(opts.pageKey);
      container.classList.add('layout-editing');
      moved = false;
      movedId = null;
    }
    syncGrips(container, true, deps.gripHTML);
    cur.items = sectionsOf(container);
    const i0 = cur.items.indexOf(section);
    cur.applied = cur.items.map(() => ({ dy: 0, scale: 1 }));
    const scrollY = scrollYOf(win);
    cur.drag = dragStep(initialDragState(), {
      type: 'lift', id: sectionIdOf(section), i0, geo: measureItems(cur), clientY: cur.pointY, scrollY, scrollHeight: scrollHeightOf(doc),
      reduceMotion: !!deps.reducedMotion(), mode: cur.press.mode,
    });
    if (cur.drag.phase !== 'lifted') { abortGesture(); return; }
    section.setAttribute('data-lifted', '');
    cur.items.forEach((el, k) => {
      el.style.transition = (k === i0 || cur.drag.reduceMotion) ? 'none' : 'transform var(--motion-nav) var(--ease-native)';
    });
    section.style.transformOrigin = '50% 0';
    section.style.willChange = 'transform';
    cur.width0 = num(win?.innerWidth);
    try { win?.getSelection?.()?.removeAllRanges?.(); } catch { /* selection API absent */ }
    paint(cur);
    cur.lastTs = null;
    cur.carry = 0;
    cur.raf = deps.raf(cur.tick = guarded((ts) => tick(cur, ts)));
    // (4) the click swallow is armed at TOUCH END (pointEnd), never here and never at settle. (5) the announcement.
    if (!edit) announceLayout(SECTION_DRAG_COPY.rearranging, annEnv());
  }

  function measureItems(cur) {
    const scrollY = scrollYOf(deps.win());
    return cur.items.map((el, k) => untransformedGeometry({ rect: el.getBoundingClientRect(), scrollY, applied: cur.applied[k] }));
  }

  /** Paint the drag state onto the sections (inline transforms only: DI-179c's string-assembly order is never touched). */
  function paint(cur) {
    const view = dragView(cur.drag);
    if (!view) return;
    cur.items.forEach((el, k) => {
      if (k === view.dragged.index) {
        el.style.transform = liftTransform(view.dragged.dy, view.dragged.scale);
        cur.applied[k] = { dy: view.dragged.dy, scale: view.dragged.scale };
      } else {
        const dy = view.shifts[k];
        if (dy) el.style.willChange = 'transform';
        el.style.transform = shiftTransform(dy);
        cur.applied[k] = { dy, scale: 1 };
      }
    });
    if (cur.drag.changedSlot) deps.haptic('selection');             // one selection tick per NEW slot, native only
  }

  // ── the rAF loop: auto-scroll, geometry re-measure, loss-of-ownership guards ─
  function tick(cur, ts) {
    if (g !== cur || !cur.drag || cur.drag.phase !== 'lifted') return;
    const win = deps.win();
    const doc = deps.doc();
    if (deps.claimedBy() !== OWNER) { cancelActive('claim-lost'); return; }
    if (deps.suspended()) { cancelActive('suspended'); return; }
    const dtMs = cur.lastTs == null ? 0 : ts - cur.lastTs;
    cur.lastTs = ts;
    const sh = scrollHeightOf(doc);
    if (sh !== cur.drag.scrollHeight) {               // a banner arrived, a logo loaded: re-measure, the drag continues
      cur.drag = dragStep(cur.drag, { type: 'remeasure', geo: measureItems(cur), scrollHeight: sh });
      if (cur.drag.phase !== 'lifted') { settleNow(cur); return; }
      paint(cur);
    }
    const appHeader = doc.querySelector?.('.app-header');
    const nav = doc.querySelector?.('.bottom-nav');
    const bar = doc.getElementById?.('layout-edit-bar');
    const edges = autoScrollEdges({
      headerBottom: appHeader ? visibleHeaderBottom(appHeader.getBoundingClientRect().bottom, safeTopOf(appHeader, win)) : 0,
      barBottom: bar && typeof bar.getBoundingClientRect === 'function' ? bar.getBoundingClientRect().bottom : null,
      navTop: nav ? nav.getBoundingClientRect().top : null, viewportH: num(win.innerHeight),
    });
    const step = autoScrollStep({
      pointerY: cur.pointY, topEdge: edges.top, bottomEdge: edges.bottom, dtMs, scrollY: scrollYOf(win),
      maxScrollY: sh - num(win.innerHeight), reduceMotion: cur.drag.reduceMotion, carry: cur.carry,
    });
    cur.carry = step.carry;
    if (step.dy) {
      scrollWindow(win, autoScrollOptions(step.dy));
      cur.drag = dragStep(cur.drag, { type: 'scroll', scrollY: scrollYOf(win), scrollHeight: sh });
      paint(cur);
    }
    cur.raf = deps.raf(cur.tick);
  }

  // ── touch end, settle, drop ────────────────────────────────────────────
  function pointEnd(cur, cancelled) {
    if (cur.drag) {
      if (cur.drag.phase !== 'lifted') return;
      runOff(cur.offPointer);
      if (!cancelled) armClickSwallow();                           // at TOUCH END, never at settle
      beginSettle(cur, cancelled ? { type: 'cancel', reason: 'touchcancel' } : { type: 'release', commit: true });
      return;
    }
    cur.press = pressStep(cur.press, { type: cancelled ? 'touchcancel' : 'end' });
    endPress(cur);
  }

  /** ONE capture-phase click swallow, armed at TOUCH END (the click the ending touch may synthesize must not activate
   *  whatever is under the finger). It disarms at the first click, after 350 ms, AND at the next touchstart / mousedown:
   *  a NEW press means that click is not coming, so a prompt tap on Done is never swallowed (the mockup's first cut,
   *  armed at settle, swallowed exactly that tap). */
  function armClickSwallow() {
    if (swallowOff) swallowOff();
    const doc = deps.doc();
    let timer = null;
    const handler = (ev) => { ev.preventDefault?.(); ev.stopPropagation?.(); ev.stopImmediatePropagation?.(); off(); };
    const newPress = () => off();
    function off() {
      doc.removeEventListener('click', handler, true);
      doc.removeEventListener('touchstart', newPress, true);
      doc.removeEventListener('mousedown', newPress, true);
      if (timer != null) deps.clearTimeout(timer);
      timer = null;
      if (swallowOff === off) swallowOff = null;
    }
    doc.addEventListener('click', handler, true);
    doc.addEventListener('touchstart', newPress, { capture: true, passive: true });
    doc.addEventListener('mousedown', newPress, { capture: true, passive: true });
    timer = deps.setTimeout(off, CLICK_SWALLOW_MS);
    swallowOff = off;
  }

  function beginSettle(cur, event) {
    if (cur.raf != null) { deps.caf(cur.raf); cur.raf = null; }
    cur.drag = dragStep(cur.drag, event);
    if (cur.drag.phase !== 'settling') { abortGesture(); return; }
    const dragged = cur.items[cur.drag.i0];
    dragged.removeAttribute('data-lifted');
    dragged.setAttribute('data-settling', '');
    dragged.style.transition = cur.drag.reduceMotion ? 'none' : 'transform var(--motion-nav) var(--ease-native)';
    paint(cur);
    if (cur.drag.reduceMotion) { finishSettle(cur); return; }       // Reduce Motion: neighbours and the settle jump
    cur.timers.settle = deps.setTimeout(guarded(() => finishSettle(cur)), SETTLE_MS + 10);
  }

  function settleNow(cur) {
    if (!cur.drag) return;
    if (cur.drag.phase === 'lifted') beginSettle(cur, { type: 'cancel', reason: 'geometry-changed' });
    else if (cur.drag.phase === 'settling') finishSettle(cur);
  }

  /** The end of the glide, in ONE synchronous task: clear the transforms, ONE write, the announcement, ONE repaint. */
  function finishSettle(cur) {
    if (g !== cur || !cur.drag || cur.drag.phase !== 'settling') return;
    const { opts } = cur;
    const win = deps.win();
    const out = cur.drag.outcome;
    const total = cur.items.length;
    cur.drag = dragStep(cur.drag, { type: 'settled' });
    teardown(cur);
    clearInlineStyles(cur);
    g = null;
    let parked = false;
    const y = scrollYOf(win);
    try {
      if (out.moved) {
        opts.onReorder(out.id, out.to);
        moved = true;
        movedId = out.id;
        announceLayout(movedAnnouncement({ label: typeof opts.labelOf === 'function' ? opts.labelOf(out.id) : out.id, n: out.to + 1, m: total }), annEnv());
        // The drop asks for its OWN repaint through the same door as a live tick, WHILE STILL CLAIMED, so a repaint that
        // was parked mid-lift and this one collapse to exactly one (latest wins, per page key).
        parked = !!deps.deferRender(opts.tabKey, opts.rerender);
      } else if (out.cancelled) {
        // A real cancel (Escape, a system touchcancel, rotation, a tab change). A hold RELEASED IN PLACE is a drop onto the same slot, not a
        // cancel: it announces nothing new (reviewer N1 — "Move cancelled." for a drop the player chose to make was inaccurate).
        announceLayout(SECTION_DRAG_COPY.cancelled, annEnv());
      }
      if (out.reason === 'drop') deps.haptic('light');
    } finally {
      deps.releaseAndFlush(OWNER);
    }
    if (out.moved) {
      if (!parked) opts.rerender();                  // the deferral door did not park (no claim owner at that moment): repaint now
      if (win && Math.abs(scrollYOf(win) - y) > 0.5) scrollWindow(win, { top: y, left: 0, behavior: 'instant' }, 'scrollTo');
    }
  }

  /** Cancel whatever is live (no write): a pending press dies, a lift settles back to its slot. */
  function cancelActive(reason) {
    const cur = g;
    if (!cur) return;
    if (cur.drag) {
      if (cur.drag.phase === 'lifted') { runOff(cur.offPointer); beginSettle(cur, { type: 'cancel', reason }); } else if (cur.drag.phase === 'settling') finishSettle(cur);
      return;
    }
    cur.press = pressStep(cur.press, { type: reason === 'hidden' ? 'hidden' : 'touchcancel' });
    endPress(cur);
  }

  function onResize(cur) {
    if (g !== cur) return;
    if (!cur.drag) { cur.press = pressStep(cur.press, { type: 'resize' }); if (cur.press.phase === 'dead') endPress(cur); return; }
    // A lift survives a height-only resize (the dynamic toolbar; geometry is re-measured each frame) and ends on rotation.
    if (num(deps.win()?.innerWidth) !== cur.width0) cancelActive('rotated');
  }

  // ── global listeners (bound once, lazily) ──────────────────────────────
  const onWindowScroll = guarded(() => {
    lastScrollT = deps.now();
    if (g && !g.drag) {
      g.press = pressStep(g.press, { type: 'scroll' });
      if (g.press.phase === 'dead') endPress(g);
    }
  });
  const onKeydown = guarded((e) => {
    if (e.key !== 'Escape') return;
    if (g && g.drag) { if (g.drag.phase === 'lifted') cancelActive('escape'); return; }
    if (!pickTarget({ editingOnly: true })) return;
    if (deps.suspended()) return;                       // an overlay owns Escape
    requestDone('escape');
  });
  function ensureGlobals() {
    if (globalOff) return;
    const win = deps.win();
    const doc = deps.doc();
    // The persistent polite live region (DI-386, C12) must be in the document BEFORE the first announcement: a live region created and
    // filled in the same task is not reliably spoken by VoiceOver. Created here, on the first paint that has anything to rearrange.
    try { ensureLayoutLive(doc); } catch { /* a document with no DOM API: announcing is best effort */ }
    const list = [];
    if (win && win.addEventListener) on({ list, target: win, type: 'scroll', fn: onWindowScroll, options: { passive: true } });
    if (doc && doc.addEventListener) on({ list, target: doc, type: 'keydown', fn: onKeydown });
    globalOff = list;
  }

  // ── the public surface ─────────────────────────────────────────────────
  function wire(container) {
    const onStart = guarded((e) => {
      lastTouchT = deps.now();
      const fingers = e.touches?.length ?? 1;
      if (g && g.drag) {
        // A second finger during a lift is ignored; the lift tracks its own touch by identifier.
        if (g.drag.phase === 'lifted') {
          if (fingers !== 1) return;
          cancelActive('lost-touch');                  // a fresh ONE-finger touch means the old touch ended without us seeing it
        }
        if (g && g.drag && g.drag.phase === 'settling') finishSettle(g);   // a touch during the settle finishes it at once
      }
      if (fingers !== 1) return;                       // a second finger is the live press's own capture listener's business
      if (g) endPress(g);                              // a stale pending press (its end was never delivered)
      const opts = container._sectionDragOpts;
      if (!opts) return;
      const t = e.touches && e.touches[0];
      beginGesture({ container, opts, e, source: 'touch', x: num(t?.clientX), y: num(t?.clientY), touchId: t?.identifier, touches: 1, button: 0 });
    });
    const onTouchEnd = () => { lastTouchT = deps.now(); };
    const onMouse = guarded((e) => {
      if (g) return;
      const opts = container._sectionDragOpts;
      if (!opts) return;
      beginGesture({ container, opts, e, source: 'mouse', x: num(e.clientX), y: num(e.clientY), touches: 1, button: e.button });
    });
    container.addEventListener('touchstart', onStart, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });
    container.addEventListener('mousedown', onMouse, { passive: true });
    container._sectionDragWired = { onStart, onTouchEnd, onMouse };
  }

  /** The ten title rows' blocking touchmove. PERMANENT on each row (not added at the claim: WebKit decides at touchstart
   *  whether a touch may scroll, from the listeners that exist then), and inert unless THIS module holds the claim.
   *  It is the only non-passive touch listener this module registers; every one on the scroll chain stays passive. */
  function bindBlockers(container) {
    for (const header of container.querySelectorAll(SECTION_HANDLE_SELECTOR)) {
      if (header._sectionDragBlock) continue;
      const block = (ev) => {
        if (!shouldBlockTouchMove(deps.claimedBy())) return;
        if (ev.cancelable !== false) ev.preventDefault();
      };
      header._sectionDragBlock = block;
      header.addEventListener('touchmove', block, { passive: false });
    }
  }

  function detach(container) {
    if (!container) return;
    const w = container._sectionDragWired;
    if (w) {
      container.removeEventListener('touchstart', w.onStart, { passive: true });
      container.removeEventListener('touchend', w.onTouchEnd, { passive: true });
      container.removeEventListener('touchcancel', w.onTouchEnd, { passive: true });
      container.removeEventListener('mousedown', w.onMouse, { passive: true });
    }
    container._sectionDragWired = null;
    container._sectionDragOpts = null;
    if (typeof container.querySelectorAll === 'function') {
      for (const header of container.querySelectorAll(SECTION_HANDLE_SELECTOR)) {
        if (header._sectionDragBlock) { header.removeEventListener('touchmove', header._sectionDragBlock, { passive: false }); header._sectionDragBlock = null; }
      }
    }
    attached.delete(container);
    if (lastAttached === container) lastAttached = null;
  }

  /** Which attached page Done / Reset / Escape act on: the one in edit mode (or the named page), else the latest. */
  function pickTarget({ pageKey = null, editingOnly = false } = {}) {
    const live = [...attached].filter((c) => c._sectionDragOpts);
    const editing = (c) => !!(typeof c._sectionDragOpts.getEditing === 'function' && c._sectionDragOpts.getEditing());
    const named = pageKey ? live.find((c) => c._sectionDragOpts.pageKey === pageKey) : null;
    const pick = named || live.find(editing) || (editingOnly ? null : (live.includes(lastAttached) ? lastAttached : live[live.length - 1])) || null;
    return pick ? { container: pick, opts: pick._sectionDragOpts } : null;
  }

  /** Called from bindLayoutEditHandlers() on every paint. Returns true when the binder is live for this container. */
  function attach(container, opts) {
    if (!container || !opts || typeof container.addEventListener !== 'function') return false;
    if (optsList(opts).length < 2) { detach(container); return false; }      // fewer than two visible sections: no binder
    ensureGlobals();
    container._sectionDragOpts = opts;
    attached.add(container);
    lastAttached = container;
    if (!container._sectionDragWired) wire(container);
    bindBlockers(container);
    syncGrips(container, !!(typeof opts.getEditing === 'function' && opts.getEditing()), deps.gripHTML);   // derived from state on every paint
    return true;
  }

  /** Done (the bar's button) and Escape (web): end edit mode. The mode itself is app.js's (`onDone`); this announces,
   *  cancels any live lift, and keeps the moved section in view after the single repaint. */
  function requestDone(reason = 'done') {
    const cur = pickTarget();
    if (!cur) return false;
    if (g) { if (g.drag) settleNowOrCancel(); else endPress(g); }
    const wasMoved = moved;
    const id = movedId;
    moved = false;
    movedId = null;
    announceLayout(SECTION_DRAG_COPY.saved, annEnv());
    cur.opts.onDone?.(wasMoved, id, reason);
    if (wasMoved && id) scrollSectionIntoView({ container: cur.container, id, doc: deps.doc(), win: deps.win(), reduceMotion: !!deps.reducedMotion() });
    return true;
  }
  function settleNowOrCancel() {
    if (!g || !g.drag) return;
    if (g.drag.phase === 'lifted') { runOff(g.offPointer); beginSettle(g, { type: 'cancel', reason: 'done' }); }
    if (g && g.drag && g.drag.phase === 'settling') finishSettle(g);
  }

  /** The bar's Reset and the hidden per-page Reset twin both call this: one function, the page's scroll position kept.
   *  `pageKey` names the page whose twin was pressed (a twin works with edit mode OFF); omitted, the page in edit mode. */
  function requestReset(pageKey = null) {
    const cur = pickTarget({ pageKey });
    if (!cur) return false;
    const win = deps.win();
    const y = scrollYOf(win);
    cur.opts.onReset?.();
    deps.haptic('light');
    announceLayout(SECTION_DRAG_COPY.reset, annEnv());
    if (win && Math.abs(scrollYOf(win) - y) > 0.5) scrollWindow(win, { top: y, left: 0, behavior: 'instant' }, 'scrollTo');
    return true;
  }

  function destroy() {
    abortGesture();
    if (swallowOff) swallowOff();
    if (globalOff) { runOff(globalOff); globalOff = null; }
    for (const c of [...attached]) detach(c);
    lastAttached = null;
    moved = false;
    movedId = null;
  }

  return {
    attach, detach, requestDone, requestReset, destroy,
    cancel: (reason = 'cancel') => cancelActive(reason),
    isLifted: () => !!(g && g.drag && g.drag.phase === 'lifted'),
    isBusy: () => !!g,
    // test hooks (the codebase's `_name` convention)
    _gesture: () => g,
    _moved: () => ({ moved, movedId }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 10. The default controller — what app.js calls
// ─────────────────────────────────────────────────────────────────────────

let defaultController = null;
const ctl = () => (defaultController = defaultController || createSectionDragController());

/** DI-385's `attachSectionDrag(container, opts)`. Call it from bindLayoutEditHandlers() on every paint. */
export function attachSectionDrag(container, opts) { return ctl().attach(container, opts); }
/** Unwire a container (signed out, the blind-gate screen, fewer than two sections): zero press listeners remain. */
export function detachSectionDrag(container) { return ctl().detach(container); }
/** The bar's Done button and Escape. */
export function requestDone(reason) { return ctl().requestDone(reason); }
/** The bar's Reset button and the hidden per-page Reset twin. */
export function requestReset(pageKey) { return ctl().requestReset(pageKey); }
/** Cancel a pending press or a live lift with no write (tab change, sign-out). */
export function cancelSectionDrag(reason) { return ctl().cancel(reason); }
export function isSectionDragActive() { return !!(defaultController && defaultController.isBusy()); }
/** Test hook: drop the default controller and its global listeners. */
export function _resetSectionDragForTest() { if (defaultController) defaultController.destroy(); defaultController = null; }
