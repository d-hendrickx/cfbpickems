/**
 * CFB Pickems — game-arrange.js (Deployment 1, Lane B, DI-581 / PF-445 rev 3, PBD-B5, 2026-10-08)
 * ===============================================================================================
 * HOLD-AND-DRAG for the Dashboard's Custom arrangement: while the member is ARRANGING (js/game-sort.js, the "Arrange games" button under Custom), each game row carries a grip and Move up / Move down arrows (the
 * assistive path, on both platforms). This module is the finger / mouse path. It is the SECTION DRAG's engine (js/section-drag.js) pointed at game rows instead of section titles — nothing of its behaviour is
 * re-invented and nothing of it is edited: every DECISION below is one of its pure functions (`dragStep`, `dragView`, `autoScrollStep`, `liftTransform`, `shiftTransform`, `SECTION_LONG_PRESS_MS` …), and this file is the thin
 * DOM binder that feeds them events (the handle selector is injected by markup: the grip, or the row body).
 *
 *   touch   press the GRIP and move 6 pt, or HOLD the row body 500 ms (a still hold; moving more than 8 pt first is a scroll and cancels it) — a medium haptic on lift (native), the touch is CLAIMED so the week swipe,
 *           the drawer swipe and pull-to-refresh stand down and a live repaint waits; edge auto-scroll; ONE write at the drop, none if it did not move; a still hold that never lifts does nothing
 *   mouse   press the grip or the row and move 6 pt (web: mouse drag plus arrows, PBD-B5)
 *   keys    the arrows are real buttons (44 x 44 pt, `aria-label` names the game): they are the path for VoiceOver, Switch Control and the keyboard
 *
 * What it never does: write storage, repaint the page, show a toast or know what a week is (every effect arrives as a callback in `opts`); read a pick (it never reads one at all, so the blind rule has no surface here).
 * Reduce Motion: no lift scale, no glide; the auto-scroll is half speed (it is function, not flourish). Imports only nav-gestures.js, haptics.js and section-drag.js.
 */
import * as NG from './nav-gestures.js';
import { haptic as realHaptic } from './haptics.js';
import {
  dragStep, dragView, initialDragState, liftTransform, shiftTransform, autoScrollStep, autoScrollEdges, autoScrollOptions, scrollWindow, shouldBlockTouchMove,
  SECTION_LONG_PRESS_MS, SECTION_PRESS_SLOP_PX, SECTION_EDIT_DRAG_SLOP_PX, SETTLE_MS, SECTION_DRAG_TOUCH_OWNER,
} from './section-drag.js';

export const ARRANGE_ROW_SELECTOR = '[data-arrange-row]';
export const ARRANGE_GRIP_SELECTOR = '[data-arrange-grip]';
/** A control inside a row keeps its tap and never starts a press (the arrows, a link). */
export const ARRANGE_EXCLUDE_SELECTOR = 'a, button, input, select, textarea, label, summary, [role="button"], [data-no-press]';

/** The pure result of a drop: the ids with `from` moved to `to` (a NEW array; never mutates), or the same order when nothing moved. */
export function applyOutcome(ids, outcome) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  if (!outcome || !outcome.moved || !Number.isInteger(outcome.from) || !Number.isInteger(outcome.to)) return list;
  if (outcome.from < 0 || outcome.from >= list.length || outcome.to < 0 || outcome.to >= list.length) return list;
  const [id] = list.splice(outcome.from, 1);
  list.splice(outcome.to, 0, id);
  return list;
}

/**
 * @param {Element} container   the page host (#page-dashboard); listeners are delegated, so a repaint of its content needs no rebinding
 * @param {{
 *   getIds:()=>string[], idOf?:(row:Element)=>string, onMove:(newIds:string[], info:{id:string,from:number,to:number})=>void, labelOf?:(id:string)=>string, announce?:(msg:string)=>void,
 *   edges?:()=>{top:number,bottom:number}, reducedMotion?:()=>boolean, haptic?:(kind:string)=>void, win?:Window, now?:()=>number,
 *   claim?:(owner:string)=>boolean, release?:(owner:string)=>void, releaseAndFlush?:(owner:string)=>void, announceMoved?:(o:{label:string,n:number,m:number})=>string }} opts
 */
export function attachGameArrange(container, opts = {}) {
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  const doc = (container && container.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  const claim = opts.claim || NG.claimTouch;
  const release = opts.release || NG.releaseTouch;
  const releaseAndFlush = opts.releaseAndFlush || (typeof NG.releaseTouchAndFlush === 'function' ? NG.releaseTouchAndFlush : NG.releaseTouch);
  const haptic = opts.haptic || realHaptic;
  const now = opts.now || (() => Date.now());
  const reduced = () => { try { return opts.reducedMotion ? opts.reducedMotion() === true : NG.prefersReducedMotion(); } catch { return false; } };
  const idOf = opts.idOf || ((row) => row.getAttribute('data-game-id') || '');
  let sess = null;                                    // the press / lift in flight
  let busy = false;                                   // true from lift to the end of the settle: the page must not repaint under it
  let raf = null;

  const rowsOf = () => Array.from(container.querySelectorAll(ARRANGE_ROW_SELECTOR));
  const scrollY = () => (win ? Number(win.scrollY) || 0 : 0);
  const docH = () => (doc && doc.documentElement ? doc.documentElement.scrollHeight : 0);
  const maxScroll = () => Math.max(0, docH() - (win ? Number(win.innerHeight) || 0 : 0));

  function clearTimer() { if (sess && sess.timer !== null) { clearTimeout(sess.timer); sess.timer = null; } }
  function endSession({ flush = true } = {}) {
    clearTimer();
    if (raf !== null && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(raf); raf = null; }
    const held = sess && sess.claimed;
    sess = null; busy = false;
    if (held) { if (flush) releaseAndFlush(SECTION_DRAG_TOUCH_OWNER); else release(SECTION_DRAG_TOUCH_OWNER); }
  }

  function paint() {
    if (!sess || !sess.state) return;
    const v = dragView(sess.state);
    if (!v) return;
    const rows = sess.rows;
    rows.forEach((el, i) => {
      const t = i === v.dragged.index ? liftTransform(v.dragged.dy, v.dragged.scale) : shiftTransform(v.shifts[i]);
      el.style.transform = t;
    });
  }

  function lift(clientY) {
    const rows = rowsOf();
    const i0 = rows.indexOf(sess.row);
    if (rows.length < 2 || i0 < 0) { endSession({ flush: false }); return false; }
    const sy = scrollY();
    const geo = rows.map(r => { const b = r.getBoundingClientRect(); return { top: b.top + sy, h: b.height }; });
    const st = dragStep(initialDragState(), { type: 'lift', id: idOf(sess.row), i0, geo, clientY, scrollY: sy, scrollHeight: docH(), reduceMotion: reduced(), mode: sess.src === 'touch' ? 'hold' : 'edit' });
    if (st.outcome) { endSession({ flush: false }); return false; }
    sess.state = st; sess.rows = rows; sess.lifted = true; sess.clientY = clientY; busy = true;
    if (!sess.claimed) { if (!claim(SECTION_DRAG_TOUCH_OWNER)) { endSession({ flush: false }); return false; } sess.claimed = true; }
    rows.forEach(r => { r.style.willChange = 'transform'; r.style.transition = reduced() ? 'none' : 'transform var(--motion-fast) var(--ease-native)'; });
    sess.row.setAttribute('data-lifted', 'true');
    sess.row.style.transition = 'none';
    try { haptic('medium'); } catch { /* a dropped haptic is invisible */ }
    paint();
    sess.last = now();
    const loop = () => {
      if (!sess || !sess.lifted || sess.state.phase !== 'lifted') { raf = null; return; }
      const t = now(); const dt = t - (sess.last || t); sess.last = t;
      const e = (opts.edges ? opts.edges() : autoScrollEdges({ headerBottom: 0, navTop: null, viewportH: win ? win.innerHeight : 0 }));
      const step = autoScrollStep({ pointerY: sess.clientY, topEdge: e.top, bottomEdge: e.bottom, dtMs: dt, scrollY: scrollY(), maxScrollY: maxScroll(), reduceMotion: reduced(), carry: sess.carry || 0 });
      sess.carry = step.carry;
      if (step.dy !== 0) {
        scrollWindow(win, autoScrollOptions(step.dy));
        sess.state = dragStep(sess.state, { type: 'scroll', scrollY: scrollY(), scrollHeight: docH() });
        afterState();
      }
      raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(loop) : null;
    };
    raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(loop) : null;
    return true;
  }

  function afterState() {
    if (sess.state.changedSlot) { try { haptic('selection'); } catch { /* invisible */ } }
    paint();
  }

  function move(clientY) {
    if (!sess || !sess.lifted) return;
    sess.clientY = clientY;
    sess.state = dragStep(sess.state, { type: 'move', clientY });
    afterState();
  }

  function drop(commit) {
    if (!sess || !sess.lifted) { endSession({ flush: false }); return; }
    const s = sess;
    s.state = dragStep(s.state, commit ? { type: 'release', commit: true } : { type: 'cancel', reason: 'cancel' });
    const outcome = s.state.outcome;
    const v = dragView(s.state);
    if (v) s.rows.forEach((el, i) => { el.style.transition = reduced() ? 'none' : `transform ${SETTLE_MS}ms var(--ease-native)`; el.style.transform = i === v.dragged.index ? liftTransform(v.dragged.dy, 1) : shiftTransform(v.shifts[i]); });
    const finish = () => {
      if (sess !== s) return;
      s.rows.forEach(el => { el.style.transform = ''; el.style.transition = ''; el.style.willChange = ''; el.removeAttribute('data-lifted'); });
      const ids = opts.getIds ? opts.getIds() : [];
      const moved = !!(outcome && outcome.moved && !outcome.cancelled);
      sess.state = dragStep(sess.state, { type: 'settled' });
      endSession({ flush: !moved });                  // the touch claim is given back BEFORE the app repaints (a repaint under a held claim would park); a cancelled drop lets the parked repaint run
      if (moved) {
        const newIds = applyOutcome(ids, outcome);
        try { opts.onMove && opts.onMove(newIds, { id: outcome.id, from: outcome.from, to: outcome.to }); } catch (e) { try { console.error('[arrange] onMove failed', e); } catch { /* */ } }
      }
    };
    if (reduced()) finish(); else setTimeout(finish, SETTLE_MS + 20);
  }

  // ── pointer path: the grip (touch or mouse) and the row body (mouse) ──────────────────────────────────────────────────────────────────────────────────────────────────
  function onPointerDown(e) {
    if (sess || !e || (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse')) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const row = t.closest(ARRANGE_ROW_SELECTOR);
    if (!row || !container.contains(row)) return;
    const onGrip = !!t.closest(ARRANGE_GRIP_SELECTOR);
    if (!onGrip && (e.pointerType === 'touch' || t.closest(ARRANGE_EXCLUDE_SELECTOR))) return;     // a touch on the row body is the long-press path below; a control keeps its tap
    sess = { src: 'pointer', row, x0: e.clientX, y0: e.clientY, lifted: false, timer: null, pointerId: e.pointerId, claimed: false, state: null };
    try { if (onGrip && typeof t.setPointerCapture === 'function' && e.pointerId !== undefined) t.setPointerCapture(e.pointerId); } catch { /* capture is a courtesy */ }
  }
  function onPointerMove(e) {
    if (!sess || sess.src !== 'pointer' || e.pointerId !== sess.pointerId) return;
    if (!sess.lifted) {
      if (Math.abs(e.clientX - sess.x0) + Math.abs(e.clientY - sess.y0) > SECTION_EDIT_DRAG_SLOP_PX) lift(e.clientY);
      return;
    }
    if (typeof e.preventDefault === 'function' && e.cancelable) e.preventDefault();
    move(e.clientY);
  }
  function onPointerEnd(e) {
    if (!sess || sess.src !== 'pointer' || (e && e.pointerId !== undefined && e.pointerId !== sess.pointerId)) return;
    if (!sess.lifted) { endSession({ flush: false }); return; }
    drop(!(e && e.type === 'pointercancel'));
  }

  // ── touch path: a still hold on the row body ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function onTouchStart(e) {
    if (sess || !e || !e.touches || e.touches.length !== 1) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function' || t.closest(ARRANGE_GRIP_SELECTOR) || t.closest(ARRANGE_EXCLUDE_SELECTOR)) return;
    const row = t.closest(ARRANGE_ROW_SELECTOR);
    if (!row || !container.contains(row)) return;
    const p = e.touches[0];
    sess = { src: 'touch', row, x0: p.clientX, y0: p.clientY, y: p.clientY, scrollY0: scrollY(), lifted: false, timer: null, claimed: false, state: null };
    sess.timer = setTimeout(() => {
      if (!sess || sess.lifted) return;
      sess.timer = null;
      if (Math.abs(scrollY() - sess.scrollY0) > 2) { endSession({ flush: false }); return; }       // the page scrolled under the finger: that was a scroll, not a hold
      lift(sess.y);
    }, SECTION_LONG_PRESS_MS);
  }
  function onTouchMove(e) {
    if (!sess || sess.src !== 'touch') return;
    const p = e.touches && e.touches[0];
    if (!p) return;
    if (!sess.lifted) {
      sess.y = p.clientY;
      if (Math.abs(p.clientX - sess.x0) + Math.abs(p.clientY - sess.y0) > SECTION_PRESS_SLOP_PX) endSession({ flush: false });   // moved before the hold fired: a scroll
      return;
    }
    move(p.clientY);                                    // (the page's scroll under a lifted row is cancelled by the row's own blocker, below: this listener stays PASSIVE like every one on the scroll chain)
  }
  /** The rows' blocking touchmove — the section drag's own idiom (js/section-drag.js bindBlockers): PERMANENT on each row while arranging (WebKit decides at touchstart whether a touch may scroll, from the
   *  listeners that exist then), inert unless THIS engine holds the touch claim and a row is lifted. It is the only non-passive touch listener here; the container's stay passive. Idempotent: the Dashboard
   *  paint replaces its rows, so the app calls bind() after every paint; with no row on the page (not arranging) there is no non-passive listener at all. */
  function bind() {
    for (const row of rowsOf()) {
      if (row._gameArrangeBlock) continue;
      const block = (ev) => { if (sess && sess.lifted && shouldBlockTouchMove(NG.touchClaimedBy()) && ev.cancelable !== false) ev.preventDefault(); };
      row._gameArrangeBlock = block;
      row.addEventListener('touchmove', block, { passive: false });
    }
  }
  function onTouchEnd(e) {
    if (!sess || sess.src !== 'touch') return;
    if (!sess.lifted) { endSession({ flush: false }); return; }
    drop(!(e && e.type === 'touchcancel'));
  }
  function onKey(e) { if (sess && sess.lifted && e && e.key === 'Escape') drop(false); }
  function onClickCapture(e) { if (busy && e && typeof e.stopPropagation === 'function') { e.stopPropagation(); if (typeof e.preventDefault === 'function') e.preventDefault(); } }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerEnd);
  container.addEventListener('pointercancel', onPointerEnd);
  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: true });
  container.addEventListener('touchend', onTouchEnd, { passive: true });
  container.addEventListener('touchcancel', onTouchEnd, { passive: true });
  container.addEventListener('click', onClickCapture, true);
  if (doc) doc.addEventListener('keydown', onKey);
  bind();
  return {
    bind,
    isBusy: () => busy || !!(sess && sess.lifted),
    cancel: () => { if (sess && sess.lifted) drop(false); else endSession({ flush: false }); },
    detach: () => {
      if (sess && sess.lifted) { try { drop(false); } catch { /* */ } }
      endSession({ flush: false });
      container.removeEventListener('pointerdown', onPointerDown); container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerEnd); container.removeEventListener('pointercancel', onPointerEnd);
      container.removeEventListener('touchstart', onTouchStart); container.removeEventListener('touchmove', onTouchMove);
      for (const row of rowsOf()) { if (row._gameArrangeBlock) { row.removeEventListener('touchmove', row._gameArrangeBlock, { passive: false }); row._gameArrangeBlock = null; } }
      container.removeEventListener('touchend', onTouchEnd); container.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('click', onClickCapture, true);
      if (doc) doc.removeEventListener('keydown', onKey);
    },
  };
}
