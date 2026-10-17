/**
 * CFB Pickems — pushed-screen.js (Deployment 1, Lane B, DI-571 / PF-451 / PF-442 / PF-452 / PF-453 / PF-456, 2026-10-07)
 * ====================================================================================================================
 * The ONE pushed-screen shell: a full-screen level that slides in over the app, keeps the level beneath it exactly as it was, and comes back out one
 * level at a time. Card details use it now; GameDay, the comparison and the week detail use it next. It is the THIRD copy of the League Page overlay
 * recipe (`#league-page-overlay`, `#leagues-home-overlay`) written once instead of pasted again — the two existing overlays are NOT refactored in this
 * release (recorded as deferred consolidation).
 *
 *   API        pushScreen({ id, title, backLabel, render, restoreKey, onClick, onClose, right, patch }) · popScreen() · closeAllScreens(reason)
 *              topScreenId() · isScreenOpen() · screenDepth() · invalidateScreens() (data changed: repaint the top level, mark the rest stale)
 *   Structure  ONE fixed root `#pushed-root` (z-index 150, the League overlay's band: above the header and nav at 100, below `.modal-overlay` at 200),
 *              `data-hold-teardown`. Each level is a retained <section>; a covered level stays in the DOM (`inert`, `aria-hidden`) so its scroll and state
 *              survive, and repaints only when it is uncovered. Level anatomy: a sticky navigation bar (Back to {previous screen's name}, centred title,
 *              optional right slot) over a body that scrolls natively with safe-area padding.
 *   Motion     push = the new level slides in from the right (--motion-nav, --ease-native); pop = the reverse. iOS: an edge drag follows the finger
 *              (`bindSwipeToDismiss`, axis x — the shipped recipe, 40% of the distance or a 0.3 px/ms flick settles it); web: the Back button and Esc.
 *              Reduce Motion: no slide at all (the level appears / goes at once). >= 600 px: a centred column, a cross-fade instead of a slide (CSS).
 *   Gestures   while a level is open `.main-content`, `.app-header` and `.bottom-nav` are inert and the root is registered with nav-gestures'
 *              `gesturesSuspended()` and app.js's other-surface-on-top lists, so no week swipe / drawer swipe / pull-to-refresh arms underneath.
 *   Live data  only the TOP level repaints on a data change, debounced to 1 s, parked while a touch is dragging; a covered level is marked stale and
 *              repaints on uncover. A repaint whose markup is identical writes nothing. DI-572(a): a level may pass `patch(el, { html, prevHtml, part })` —
 *              given the markup it drew last time and the markup it would draw now, it brings the nodes up to date IN PLACE and returns true (so its logos,
 *              its focus and its scroll offset are untouched); false (or a throw) and the shell writes the markup whole, as before. `part` is 'body' or 'right'.
 *   Identity   closeAllScreens('identity') on an identity / league change, swept by the hold teardown, and a push is refused while content is withheld.
 *
 * EVERY app effect arrives as a callback (the section-drag.js discipline): `configurePushedScreens({ escHtml, isContentWithheld, setPageInert, getBlocked,
 * onMount, onFocusReturn })` is called once by js/app.js. This module imports only nav-gestures.js, icons.js (and never app.js).
 *
 * `render(ctx)` returns the BODY markup as a string, `{ html, right }`, or null (= still loading → a skeleton, never a spinner or a blank page).
 * It owns what an empty / unavailable state looks like; the shell only guarantees the Back button always works and that a throwing render becomes a
 * calm one-line state, never a blank screen.
 */
import { bindSwipeToDismiss, prefersReducedMotion } from './nav-gestures.js';
import { icon } from './icons.js';

export const PUSHED_ROOT_ID = 'pushed-root';
/** Repaints are coalesced to one per second (Std-7: a score tick never floods a screen reader or the main thread). */
export const REPAINT_DEBOUNCE_MS = 1000;
/** Comfortably past --motion-nav (260 ms): the transitionend fallback, as the League overlay's. */
export const EXIT_FALLBACK_MS = 420;

const stack = [];                  // levels, bottom -> top
let cfg = null;
let seq = 0;
let rootEl = null;
let unbindSwipe = null;
let escBound = false;
let repaintTimer = null;
let dragging = false;

const SKELETON_HTML = '<div class="ps-skeleton" aria-hidden="true"><div class="feed-skel-line feed-skel-line--narrow"></div><div class="feed-skel-line feed-skel-line--full"></div><div class="feed-skel-line feed-skel-line--wide"></div></div><p class="sr-only" role="status">Loading</p>';
const FAILED_HTML = '<div class="ps-empty"><p class="ps-empty-title">This screen couldn\'t load.</p><p class="ps-empty-body">Tap Back and try again.</p></div>';

/** Escapes a value for a double-quoted CSS attribute selector (keys contain ':' and '.'; only '"' and '\' need care). */
const attrSel = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const isFn = (f) => typeof f === 'function';

export function configurePushedScreens(c) {
  const d = (c && typeof c === 'object') ? c : {};
  if (!isFn(d.escHtml)) throw new TypeError('configurePushedScreens() requires an injected escHtml function (CONVENTIONS #12) — it is never defaulted');
  if (!isFn(d.isContentWithheld)) throw new TypeError('configurePushedScreens() requires an injected isContentWithheld function (Std-12: a pushed screen is never opened over a withheld app)');
  cfg = {
    escHtml: d.escHtml,
    isContentWithheld: d.isContentWithheld,
    setPageInert: isFn(d.setPageInert) ? d.setPageInert : () => {},
    getBlocked: isFn(d.getBlocked) ? d.getBlocked : () => false,
    onMount: isFn(d.onMount) ? d.onMount : () => {},
    setTimer: isFn(d.setTimer) ? d.setTimer : (fn, ms) => setTimeout(fn, ms),
    clearTimer: isFn(d.clearTimer) ? d.clearTimer : (t) => clearTimeout(t),
  };
}

function withheld() { try { return !cfg || cfg.isContentWithheld() !== false; } catch { return true; } }
function top() { return stack[stack.length - 1] || null; }
function doc() { return typeof document !== 'undefined' ? document : null; }

function resolveBody(level) {
  let out;
  try { out = level.render({ id: level.id, depth: stack.indexOf(level), pop: () => popScreen(), close: (r) => closeAllScreens(r || 'screen') }); }
  catch (e) { try { console.error('[pushed-screen] render failed', e); } catch {} return { html: FAILED_HTML, right: '' }; }
  if (out === null || out === undefined) return { html: SKELETON_HTML, right: level.rightHtml || '' };
  if (typeof out === 'string') return { html: out, right: level.rightHtml || '' };
  if (typeof out === 'object') return { html: typeof out.html === 'string' ? out.html : FAILED_HTML, right: typeof out.right === 'string' ? out.right : (level.rightHtml || '') };
  return { html: FAILED_HTML, right: '' };
}

function levelHTML(level, { body, right }) {
  const e = cfg.escHtml;
  const back = `<button type="button" class="ps-back" data-ps-back aria-label="Back to ${e(level.backLabel)}"><span class="ps-back-glyph" aria-hidden="true">${icon('chevronLeft')}</span><span class="ps-back-label">${e(level.backLabel)}</span></button>`;
  return `<header class="ps-nav">${back}<h2 class="ps-title" id="ps-title-${level.seq}" tabindex="-1">${e(level.title)}</h2><div class="ps-right" data-ps-right>${right}</div></header><div class="ps-body" data-ps-body>${body}</div>`;
}

function ensureRoot() {
  const d = doc();
  if (!d) return null;
  if (rootEl && rootEl.isConnected !== false && d.getElementById(PUSHED_ROOT_ID) === rootEl) return rootEl;
  rootEl = d.createElement('div');
  rootEl.id = PUSHED_ROOT_ID;
  rootEl.setAttribute('data-hold-teardown', '');            // swept by tearDownRenderedContentForHold() and the identity chokepoint (Std-12)
  d.body.appendChild(rootEl);
  try { cfg.onMount(rootEl); } catch (e) { try { console.warn('[pushed-screen] onMount failed', e); } catch {} }
  rootEl.addEventListener('click', onRootClick);
  try { unbindSwipe?.(); } catch {}
  unbindSwipe = bindSwipeToDismiss(rootEl, {                // a no-op on web (native-only)
    axis: 'x',
    getBlocked: () => { try { return cfg.getBlocked() === true; } catch { return true; } },
    getDistancePx: () => (top() && top().el && top().el.getBoundingClientRect ? top().el.getBoundingClientRect().width : 0) || (typeof window !== 'undefined' && window.innerWidth) || 1,
    onProgress: (p) => { const t = top(); if (!t || !t.el) return; dragging = true; t.el.setAttribute('data-dragging', 'true'); t.el.style.setProperty('--pushed-drag-x', String(p)); },
    onSettle: (r) => settleDrag(r || {}),
  });
  if (!escBound && d.addEventListener) { d.addEventListener('keydown', onKeydown); escBound = true; }
  return rootEl;
}

function settleDrag({ dismissed, reducedMotion }) {
  const t = top();
  dragging = false;
  if (!t || !t.el) return;
  t.el.removeAttribute('data-dragging');
  if (!dismissed) { t.el.style.setProperty('--pushed-drag-x', '0'); return; }       // spring back; the CSS transition animates it
  // A completed swipe plays out the rest of the slide, then pops with NO second animation.
  slideOut(t.el, { reducedMotion: !!reducedMotion, apply: () => t.el.style.setProperty('--pushed-drag-x', '1'), done: () => popScreen({ instant: true }) });
}

/** Runs `apply()` (which starts the transition), then `done()` once on transitionend — at once under Reduce Motion, with a bounded fallback if the event never comes. */
function slideOut(el, { apply, done, reducedMotion }) {
  if (reducedMotion) { apply(); done(); return; }
  let finished = false, timer = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { el.removeEventListener('transitionend', onEnd); } catch {}
    if (timer !== null) { try { cfg.clearTimer(timer); } catch {} }
    done();
  };
  const onEnd = (e) => { if (!e || !e.target || e.target === el) finish(); };
  try { el.addEventListener('transitionend', onEnd); } catch {}
  timer = cfg.setTimer(finish, EXIT_FALLBACK_MS);
  apply();
}

function onKeydown(e) {
  if (!e || e.key !== 'Escape' || !stack.length) return;
  let blocked = true;
  try { blocked = cfg.getBlocked() === true; } catch { blocked = true; }
  if (blocked) return;                                       // another surface (a sheet, a modal) is on top and gets Esc first
  popScreen();
}

function onRootClick(e) {
  const target = e && e.target;
  if (!target || !isFn(target.closest)) return;
  if (target.closest('[data-ps-back]')) { popScreen(); return; }
  const t = top();
  const levelEl = target.closest('.ps-level');
  if (!t || !levelEl || levelEl !== t.el || !isFn(t.onClick)) return;      // a covered level is inert; only the top level's controls act
  try { t.onClick(e, { pop: () => popScreen(), close: (r) => closeAllScreens(r || 'screen'), repaint: () => repaintTopNow() }); }
  catch (err) { try { console.error('[pushed-screen] onClick failed', err); } catch {} }
}

/**
 * Writes `html` into `el` (a level's body or its right slot): IN PLACE through the level's `patch` hook when it has one and it says it managed (DI-572(a)); otherwise the markup whole.
 * @returns {boolean} true when the hook patched in place
 */
function writePart(level, el, html, prevHtml, part) {
  if (level.patch && typeof prevHtml === 'string' && prevHtml !== '') {
    let ok = false;
    try { ok = level.patch(el, { html, prevHtml, part }) === true; } catch (e) { ok = false; try { console.error('[pushed-screen] patch failed', e); } catch {} }
    if (ok) return true;
  }
  el.innerHTML = html;
  return false;
}

function paintLevel(level) {
  const { html, right } = resolveBody(level);
  level.lastHtml = html; level.rightHtml = right;
  return { body: html, right };
}

/** Pushes one level. Returns false (nothing happens) while content is withheld or the shell is not configured. */
export function pushScreen({ id, title = '', backLabel = 'Back', render, restoreKey = null, onClick = null, onClose = null, right = '', meta = null, instant = false, scrollTop = 0, patch = null } = {}) {
  if (!cfg || withheld() || typeof id !== 'string' || id === '' || !isFn(render)) return false;
  const existing = stack.findIndex(l => l.id === id);
  if (existing >= 0) {                                       // the same screen again: come back to it, never stack a duplicate
    while (stack.length - 1 > existing) popScreen({ instant: true });
    return true;
  }
  // A root that was swept away from under a non-empty stack (a hold teardown that did not call us) is a dead stack: drop it, then start clean.
  if (stack.length && (!rootEl || rootEl.isConnected === false || (doc() && doc().getElementById(PUSHED_ROOT_ID) !== rootEl))) closeAllScreens('swept');
  const root = ensureRoot();
  if (!root) return false;
  const level = { id, title, backLabel, render, restoreKey, onClick, onClose, patch: isFn(patch) ? patch : null, seq: ++seq, el: null, scrollTop: 0, lastHtml: '', rightHtml: String(right || ''), stale: false, meta: meta && typeof meta === 'object' ? { ...meta } : null };
  const below = top();
  if (below) {                                               // cover the level beneath: remember its scroll, make it inert
    const b = below.el && below.el.querySelector ? below.el.querySelector('[data-ps-body]') : null;
    below.scrollTop = b ? (b.scrollTop || 0) : 0;
    below.el.setAttribute('inert', ''); below.el.setAttribute('aria-hidden', 'true');
  } else {
    try { cfg.setPageInert(true); } catch {}
  }
  const d = doc();
  const el = d.createElement('section');
  el.className = 'ps-level';
  el.setAttribute('data-ps-id', id);
  el.setAttribute('aria-labelledby', `ps-title-${level.seq}`);
  level.el = el;
  const painted = paintLevel(level);
  el.innerHTML = levelHTML(level, painted);
  stack.push(level);
  const reduced = prefersReducedMotion() || instant === true;   // DI-588: a RESTORE of a recorded chain is instant — it is not a navigation, it is putting the reader back
  if (!reduced) el.classList.add('ps-level--entering');      // starts off-screen to the right…
  root.appendChild(el);
  if (Number(scrollTop) > 0) { const b = el.querySelector ? el.querySelector('[data-ps-body]') : null; if (b) b.scrollTop = Number(scrollTop); }
  if (!reduced) {
    const go = () => { try { el.classList.remove('ps-level--entering'); } catch {} };   // …and slides in on the next frame
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(go)); else go();
  }
  try { const t = el.querySelector('.ps-title'); t && t.focus && t.focus({ preventScroll: true }); } catch {}
  return true;
}

function removeRootIfEmpty() {
  if (stack.length) return;
  try { unbindSwipe?.(); } catch {}
  unbindSwipe = null;
  const d = doc();
  if (escBound && d && d.removeEventListener) { try { d.removeEventListener('keydown', onKeydown); } catch {} escBound = false; }
  if (repaintTimer !== null) { try { cfg && cfg.clearTimer(repaintTimer); } catch {} repaintTimer = null; }
  try { rootEl && rootEl.remove(); } catch {}
  rootEl = null; dragging = false;
  try { cfg && cfg.setPageInert(false); } catch {}
}

/** Focus returns to the control that opened the level just closed (VoiceOver lands where the reader was). True when it found one. */
function restoreFocusTo(key) {
  const d = doc();
  if (!d || !key) return false;
  let el = null;
  try { el = d.querySelector(`[data-restore-key="${attrSel(key)}"]`) || d.querySelector(`[data-card-key="${attrSel(key)}"]`); } catch { el = null; }
  if (!el) return false;
  try {
    const f = (el.matches && el.matches('button, a, [tabindex], [role="button"]')) ? el : (el.querySelector ? el.querySelector('[data-card-open], button, a, [tabindex], [role="button"]') : null);
    const target = f || el;
    if (target.focus) { target.focus({ preventScroll: true }); return true; }
  } catch {}
  return false;
}

/** Pops the top level (the Back button, Esc, a completed swipe). `instant` skips the exit transition. No-op on an empty stack. */
export function popScreen({ instant = false, reason = 'back' } = {}) {
  const level = stack.pop();
  if (!level) return false;
  const finish = () => {
    try { level.el && level.el.remove(); } catch {}
    const now = top();
    if (now && now.el) {                                     // uncover the level beneath: restore it exactly as it was
      now.el.removeAttribute('inert'); now.el.removeAttribute('aria-hidden');
      if (now.stale) {
        const wasBody = now.lastHtml, wasRight = now.rightHtml;
        const p = paintLevel(now);
        const b = now.el.querySelector('[data-ps-body]'); if (b && p.body !== wasBody) writePart(now, b, p.body, wasBody, 'body');
        const r = now.el.querySelector('[data-ps-right]'); if (r && p.right !== wasRight) writePart(now, r, p.right, wasRight, 'right');
        now.stale = false;
      }
      const b = now.el.querySelector ? now.el.querySelector('[data-ps-body]') : null;
      if (b) b.scrollTop = now.scrollTop || 0;               // instant: an element's scrollTop assignment is never smoothed
    }
    removeRootIfEmpty();
    // Focus goes back to the control that opened the level just closed; if that control is gone (the feed changed), to the title of the level beneath.
    if (!restoreFocusTo(level.restoreKey) && now) { try { const t = now.el.querySelector('.ps-title'); t && t.focus && t.focus({ preventScroll: true }); } catch {} }
    try { isFn(level.onClose) && level.onClose({ reason }); } catch (e) { try { console.error('[pushed-screen] onClose failed', e); } catch {} }
  };
  if (instant || !level.el || prefersReducedMotion()) { finish(); return true; }
  level.el.setAttribute('inert', '');
  slideOut(level.el, { reducedMotion: false, apply: () => { level.el.classList.add('ps-level--leaving'); }, done: finish });
  return true;
}

/** Removes every level at once (no animation): an identity / league change, a hold, withheld content, a deep navigation. Each level's onClose hears the reason. */
export function closeAllScreens(reason = 'close') {
  if (!stack.length) { removeRootIfEmpty(); return false; }
  const levels = stack.splice(0, stack.length);
  for (const l of levels) { try { l.el && l.el.remove(); } catch {} }
  removeRootIfEmpty();
  for (const l of levels.reverse()) { try { isFn(l.onClose) && l.onClose({ reason }); } catch (e) { try { console.error('[pushed-screen] onClose failed', e); } catch {} } }
  return true;
}

export const topScreenId = () => (top() ? top().id : null);
/** DI-588: the levels, bottom to top, as the Back chip records them: { id, title, backLabel, meta, scrollTop } — the TOP level's scroll is read live (a covered level's was stored when it was covered). */
export function stackSnapshot() {
  return stack.map((l, i) => {
    const b = i === stack.length - 1 && l.el && l.el.querySelector ? l.el.querySelector('[data-ps-body]') : null;
    return { id: l.id, title: l.title, backLabel: l.backLabel, meta: l.meta ? { ...l.meta } : null, scrollTop: b ? (b.scrollTop || 0) : (l.scrollTop || 0) };
  });
}
export const isScreenOpen = () => stack.length > 0;
export const screenDepth = () => stack.length;

function repaintTopNow() {
  const t = top();
  if (!t || !t.el) return false;
  if (withheld()) { closeAllScreens('withheld'); return false; }                        // the gate is re-checked on EVERY repaint
  if (dragging) { scheduleRepaint(); return false; }                                    // never replace the node under a finger
  const body = t.el.querySelector('[data-ps-body]');
  if (!body) return false;
  const { html, right } = resolveBody(t);
  const rightEl = t.el.querySelector('[data-ps-right]');
  if (rightEl && right !== t.rightHtml) { writePart(t, rightEl, right, t.rightHtml, 'right'); t.rightHtml = right; }
  if (html === t.lastHtml) return false;                                                // identical markup: no write, no flash, scroll untouched
  const keep = body.scrollTop || 0;
  const patched = writePart(t, body, html, t.lastHtml, 'body');                         // DI-572(a): in place when the level can; whole otherwise
  t.lastHtml = html;
  if (!patched) body.scrollTop = keep;                                                  // (a patch never moved it)
  return true;
}

function scheduleRepaint() {
  if (repaintTimer !== null || !cfg) return;
  repaintTimer = cfg.setTimer(() => { repaintTimer = null; repaintTopNow(); }, REPAINT_DEBOUNCE_MS);
}

/** Data changed: covered levels are marked stale (they repaint on uncover) and the top level repaints once, debounced. */
export function invalidateScreens() {
  if (!stack.length) return;
  for (let i = 0; i < stack.length - 1; i++) stack[i].stale = true;
  scheduleRepaint();
}

/** Test seams. */
export function _flushRepaintForTest() { if (repaintTimer !== null) { try { cfg.clearTimer(repaintTimer); } catch {} repaintTimer = null; } return repaintTopNow(); }
export function _resetForTest() {
  stack.splice(0, stack.length);
  try { unbindSwipe?.(); } catch {}
  unbindSwipe = null; escBound = false; repaintTimer = null; dragging = false; rootEl = null; cfg = null; seq = 0;
}
export const _stackForTest = () => stack.map(l => ({ id: l.id, stale: l.stale, scrollTop: l.scrollTop }));
