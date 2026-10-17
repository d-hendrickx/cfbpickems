/**
 * js/wizard-nav.js - W-70 (Deployment 1, batch D, 2026-10-14): the PURE half of native navigation in the week wizard (DI-W70.1, DI-W70.2).
 *
 * No network, no storage, no module-level state, and no import beyond one DOM predicate from the gesture leaf. js/app.js owns the sheet, its steps and the discard sheet; this file
 * owns the decisions the gestures depend on, so each one can be proven by itself:
 *
 *   - which touches may start a swipe-down on the sheet (the header and the grabber always; the body only at scroll-top, off a text field and off a sideways scroller);
 *   - what "unsaved edits" means (a control's value now against its value right after the last paint, with the controls that save on change left out);
 *   - which step a swipe could reach from each step, and whether the button it stands for would let it through.
 *
 * Every gesture here has a button twin and the swipe commits by CLICKING that button (js/app.js), so a swipe and a tap cannot diverge: this file only answers "may it", never "do it".
 */
import { canScrollHorizontally } from './nav-gestures.js';

/** The copy W-70 adds (DESIGN_D1_D section 5.4). Nothing else on screen is new: every gesture has an existing button. */
export const WIZ_NAV_COPY = Object.freeze({
  DISCARD_TITLE: 'Discard changes?',
  DISCARD_MESSAGE: "You have changes on this step that haven't been saved.",
  DISCARD: 'Discard Changes',
  KEEP_EDITING: 'Keep Editing',
  FINALIZING: 'Finalizing — you can close this when it finishes.',
});

/** A control that saves on change carries this (or sits inside a node that does): it is never an "unsaved edit". */
export const WIZ_AUTOSAVE_ATTR = 'data-wiz-autosave';

/** The shell turns into a side panel at this width (css/styles.css `.chat-sheet` at min-width:700px); the swipe-down is a bottom-sheet gesture only. */
export const WIZARD_SHEET_FORM_MAX_PX = 700;
export function isWizardSheetForm(viewportWidthPx) {
  return typeof viewportWidthPx === 'number' && viewportWidthPx > 0 && viewportWidthPx < WIZARD_SHEET_FORM_MAX_PX;
}

// ── unsaved edits ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CONTROL_SELECTOR = 'input, textarea, select, [role="switch"]';
const SKIP_INPUT_TYPES = new Set(['hidden', 'button', 'submit', 'reset', 'image', 'file']);

function isAutosaveControl(el) {
  if (typeof el.hasAttribute === 'function' && el.hasAttribute(WIZ_AUTOSAVE_ATTR)) return true;
  return typeof el.closest === 'function' && !!el.closest(`[${WIZ_AUTOSAVE_ATTR}]`);
}

function controlValue(el) {
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  if (role === 'switch') return `aria:${el.getAttribute('aria-checked') === 'true'}`;
  const type = String(el.type || (typeof el.getAttribute === 'function' ? el.getAttribute('type') : '') || '').toLowerCase();
  if (type === 'checkbox' || type === 'radio') return `chk:${!!el.checked}`;
  return `val:${String(el.value ?? '')}`;
}

/** The body's tracked controls, in document order, as `[key, value]` pairs. A key is the control's id (or tag) plus its place among the tracked controls. */
export function snapshotWizardControls(bodyEl) {
  const out = [];
  if (!bodyEl || typeof bodyEl.querySelectorAll !== 'function') return out;
  let i = 0;
  for (const el of bodyEl.querySelectorAll(CONTROL_SELECTOR)) {
    const type = String(el.type || (typeof el.getAttribute === 'function' ? el.getAttribute('type') : '') || '').toLowerCase();
    if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(type)) continue;
    if (isAutosaveControl(el)) continue;
    out.push([`${el.id || el.tagName}#${i++}`, controlValue(el)]);
  }
  return out;
}

/**
 * True when any tracked control now differs from `baseline` (a snapshot taken right after the last paint). A control the baseline never saw (one a step adds without a repaint) is not an
 * edit, and a baseline of null (nothing painted yet) is clean: neither can ask the commissioner to discard something they did not type.
 */
export function wizardControlsDirty(baseline, bodyEl) {
  if (!Array.isArray(baseline) || !baseline.length) return false;
  const was = new Map(baseline);
  for (const [key, value] of snapshotWizardControls(bodyEl)) {
    if (was.has(key) && was.get(key) !== value) return true;
  }
  return false;
}

// ── which touches may start a swipe-down ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function isTextTarget(target) {
  return typeof target.closest === 'function' && !!target.closest('input, textarea, select, [contenteditable]');
}

/** Is `target` inside something between it and `stopAt` that is already scrolled down (a nested vertical list)? A drag down there scrolls it back; it must not dismiss the sheet. */
function insideScrolledAncestor(target, stopAt) {
  if (typeof getComputedStyle !== 'function') return false;
  for (let el = target; el && el !== stopAt && el.nodeType === 1; el = el.parentElement) {
    let cs = null;
    try { cs = getComputedStyle(el); } catch { cs = null; }
    const oy = cs && cs.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && (el.scrollTop || 0) > 0) return true;
  }
  return false;
}

/**
 * DI-W70.1 - may a touch that begins on `target` start the sheet's swipe-down? The WHOLE sheet is the gesture's scope, so this decides which parts of it count:
 *   - only a bottom sheet (under 700 px wide: past that the shell is a side panel with no swipe-down);
 *   - the header, the grabber and the step tracker always;
 *   - the body only at scroll-top (a body scrolled down scrolls first), off a text field or select, off a nested list that is itself scrolled, and off a sideways scroller.
 */
export function canStartWizardSheetDrag({ target, bodyEl, viewportWidthPx } = {}) {
  if (!isWizardSheetForm(viewportWidthPx)) return false;
  if (!target || target.nodeType !== 1) return false;
  if (!bodyEl || typeof bodyEl.contains !== 'function' || !bodyEl.contains(target)) return true;
  if ((bodyEl.scrollTop || 0) > 0) return false;
  if (isTextTarget(target)) return false;
  if (insideScrolledAncestor(target, bodyEl)) return false;
  if (canScrollHorizontally(target, bodyEl)) return false;
  return true;
}

// ── the step pager ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * DI-W70.2 - the create flow's (Steps 1-6) swipe table, as the list the pager engine navigates: `[previous?, current, next?]` of step ids (strings), holding only the neighbours a swipe
 * may reach. A direction with no neighbour is "the end of the list", which the engine rubber-bands. Step 1 has none forward (Create Week writes the week; only the button does it), nor
 * has Step 6 (Open for picks, Schedule Open and Keep as draft are explicit buttons). Step 4's Next lands on 6 when the week already holds a valid blurb, exactly as the button does.
 */
export function wizardCreateStepPlan({ step, hasGames = false, blurbValid = false } = {}) {
  const n = Number(step);
  const plan = { 1: [null, null], 2: ['1', hasGames ? '3' : null], 3: ['2', '4'], 4: ['3', blurbValid ? '6' : '5'], 5: ['4', '6'], 6: ['5', null] }[n];
  if (!plan) return { currentWeekId: String(step), weekIds: [String(step)] };
  return { currentWeekId: String(n), weekIds: [plan[0], String(n), plan[1]].filter((x) => x !== null) };
}

/**
 * DI-W70.2 - would the BUTTON this swipe stands for let it through? Asked at release (the engine's canCommit), so a refused change never plays a slide.
 *   Step 2  Next needs a game on the slate (the button's own rule).
 *   Step 3  Next always advances (it saves the tiebreaker choice first).
 *   Step 4  Next is refused when an Auto-Open time is typed and the week has no valid blurb (the inline guard).
 *   Step 5  Next is refused when the week must carry a blurb and the typed one fails blurbCheck.
 * Steps 1 and 6 have no forward swipe at all (the plan holds no neighbour); anything else is false.
 */
export function wizardCanAdvance({ step, hasGames = false, blurbMissing = false, openAtTyped = false, blurbRequired = false, blurbTypedOk = false } = {}) {
  switch (Number(step)) {
    case 2: return !!hasGames;
    case 3: return true;
    case 4: return !(blurbMissing && openAtTyped);
    case 5: return !blurbRequired || !!blurbTypedOk;
    default: return false;
  }
}

/** The id of the button a swipe in `direction` stands for on `step` (the create flow): forward (dx < 0) is Next, back (dx > 0) is Back. */
export function wizardStepButtonId(step, direction) {
  return `wiz-step${Number(step)}-${direction > 0 ? 'back' : 'next'}`;
}
