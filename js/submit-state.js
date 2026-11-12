/**
 * js/submit-state.js — ONE submission-state language for every form (D2 lane 1, UN-531 / PF-531, DI-781..788; Drew's FB-040).
 * ==========================================================================================================================
 * The need: a player must know when an action ACTUALLY saved, so they stop tapping twice and stop trusting a "saved" that was never true. Before this module each form invented its own words
 * (an `aria-busy` "Saving…" on the SCRIBE review rows, a spinner on account deletion, a toast on others) and none said "Saved" as a resting state.
 *
 * WHAT IT IS (DI-781):
 *   1. a pure state machine, `createSubmitMachine()`:  idle -> pending -> saved | failed | unconfirmed  (a fake clock and a fake acknowledgment drive it in submitstatetest.mjs);
 *   2. the pure outcome mapping `stateFromOutcome()` and the pure view model `viewFor()` (the exact copy, DI-784);
 *   3. a thin DOM binder, `attachSubmit()`, that paints a button (and/or an inline status line) from the machine and takes the one synchronous lock (DI-785).
 *
 * "SAVED" MEANS THE SERVER SAID SO (DI-782). A seam-backed save asks `confirmSeamKey(key)` (the adapter's `flushAndConfirm`, PF-467, returns 'saved' | 'refused' | 'pending'); 'saved' -> Saved,
 * 'refused' -> Failed, 'pending' (offline, a retry held, the adapter not serving) -> UNCONFIRMED ("Saved on this device. Waiting to reach the server."), never Saved. An RPC-backed save hands the
 * binder a task that resolves (saved) or rejects (failed). An UNKNOWN answer (undefined, a stray string) is Failed: a state that cannot say what happened never says "Saved".
 * Without a registered confirmer (no adapter wired) `confirmSeamKey` answers 'pending': the module never claims a server acknowledgment nobody gave. app.js registers the real one at module
 * evaluation (supabase mode: sb.flushAndConfirm; local-only mode: the local write IS the write, so 'saved').
 *
 * ADOPTION IS AN ALLOW-LIST (DI-783, P-11): submitstatetest.mjs pins exactly which files import this module and which surfaces call it; a pinned surface that hand-writes its own
 * `disabled = true` / `textContent = 'Saving…'` pair fails the guard, and so does an import from anywhere not listed. Picks submission, the week wizard and game requests keep their own
 * already-specified states (deferred, DI section 2a).
 *
 * Zero top-level side effects (it does nothing on import). Depends on icons.js (check, warning, clock) and haptics.js (native-only; a no-op on the web) and nothing else.
 */
import { icon } from './icons.js';
import { haptic } from './haptics.js';

/** DI-781: a fast save still registers - the pending state is shown for at least this long (the League Status precedent). */
export const SUBMIT_MIN_PENDING_MS = 350;
/** DI-781: a sheet that closes on success shows Saved this long, then dismisses. */
export const SUBMIT_SAVED_DISMISS_MS = 600;
export const SUBMIT_STATES = Object.freeze(['idle', 'pending', 'saved', 'failed', 'unconfirmed']);

/** DI-784 - the exact words. Nothing here is user data. */
export const SUBMIT_COPY = Object.freeze({
  pending: 'Saving…',
  saved: 'Saved',
  retry: 'Try Again',
  failed: "Couldn't save. Check your connection and try again.",
  unconfirmed: 'Saved on this device. Waiting to reach the server.',
  announcePending: 'Saving',
  announceSaved: 'Saved',
});

// ═══ 1. OUTCOME MAPPING ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * What a task's answer means. The adapter's three words and the RPC shapes; ANYTHING else is a failure, so an answer nobody can read can never become "Saved".
 *   'saved' | true | { ok: true }        -> 'saved'
 *   'pending'                            -> 'unconfirmed'   (the device has it; the server has not acknowledged it)
 *   'unconfirmed'                        -> 'unconfirmed'
 *   'unchanged'                          -> 'idle'          (the save had nothing to write: no state is claimed, no haptic fires)
 *   'refused' | 'failed' | false | { ok: false } | a thrown error | undefined | anything else -> 'failed'
 */
export function stateFromOutcome(outcome) {
  if (outcome === 'saved' || outcome === true) return 'saved';
  if (outcome === 'unchanged') return 'idle';          // nothing was written (not permitted, already gone): nothing saved, nothing failed
  if (outcome === 'pending' || outcome === 'unconfirmed') return 'unconfirmed';
  if (outcome && typeof outcome === 'object' && outcome.ok === true) return 'saved';
  return 'failed';
}

// ═══ 2. THE SEAM CONFIRMER (DI-782) ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

let _seamConfirmer = null;
/** app.js registers the one real implementation: `(key) => Promise<'saved'|'refused'|'pending'>`. */
export function registerSeamConfirmer(fn) { _seamConfirmer = typeof fn === 'function' ? fn : null; }

/**
 * Has the SERVER acknowledged every edit to `key`? 'saved' | 'refused' | 'pending'. No confirmer registered, or one that throws or answers something else, is 'pending': never a claim nobody made.
 */
export async function confirmSeamKey(key) {
  if (!_seamConfirmer) return 'pending';
  try {
    const r = await _seamConfirmer(key);
    return r === 'saved' || r === 'refused' ? r : 'pending';
  } catch { return 'pending'; }
}

// ═══ 3. THE STATE MACHINE (DI-781, DI-785) ════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `createSubmitMachine({ now, setTimer, clearTimer, minPendingMs, dismissMs, onChange, onDismiss })`.
 *   submit(task)  start a save. `task()` resolves an outcome (see stateFromOutcome) or throws. THE LOCK IS TAKEN IN THE SAME TICK as the call (the state is `pending` before this returns), so a second
 *                 tap, the Return key and a blur-save that arrive together cannot start a second save: they get the first save's promise back and nothing else happens (DI-785).
 *   retry()       the last task again, from failed or unconfirmed only (the "Try Again" button).
 *   dirty()       a field changed: Saved (or a failure note about the previous content) goes back to idle (DI-781); an edit made while a save is in flight means the save does NOT leave the form looking clean (it ends idle, not Saved).
 *   reset()       back to idle, any pending result discarded.
 * The pending state is held for `minPendingMs` (350) even if the answer is instant. After Saved, `onDismiss` fires once `dismissMs` (600) later when the machine is still Saved (a sheet that closes).
 */
export function createSubmitMachine({
  now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
  minPendingMs = SUBMIT_MIN_PENDING_MS, dismissMs = SUBMIT_SAVED_DISMISS_MS, onChange = null, onDismiss = null,
} = {}) {
  let state = 'idle';
  let lastTask = null;
  let inflight = null;
  let gen = 0;
  let dirtyDuring = false;
  let dismissHandle = null;
  const subs = new Set();
  if (typeof onChange === 'function') subs.add(onChange);

  const emit = () => { for (const fn of [...subs]) { try { fn(state); } catch { /* a painter that throws must not wedge the machine */ } } };
  const clearDismiss = () => { if (dismissHandle != null) { clearTimer(dismissHandle); dismissHandle = null; } };

  function start(task) {
    clearDismiss();
    state = 'pending';                       // THE LOCK: synchronous, before any await
    dirtyDuring = false;
    const myGen = ++gen;
    const t0 = now();
    emit();
    inflight = (async () => {
      let outcome;
      try { outcome = await task(); } catch { outcome = false; }
      let next = stateFromOutcome(outcome);
      const wait = minPendingMs - (now() - t0);
      if (wait > 0) await new Promise((resolve) => { setTimer(resolve, wait); });
      if (myGen !== gen) return state;       // reset() while in flight: the answer is stale
      if (next === 'saved' && dirtyDuring) next = 'idle';
      state = next;
      inflight = null;
      emit();
      if (next === 'saved' && typeof onDismiss === 'function' && dismissMs > 0) {
        dismissHandle = setTimer(() => { dismissHandle = null; if (state === 'saved' && myGen === gen) onDismiss(); }, dismissMs);
      }
      return state;
    })();
    return inflight;
  }

  return {
    get state() { return state; },
    get locked() { return state === 'pending'; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    submit(task) {
      if (state === 'pending') return inflight;
      if (typeof task !== 'function') return Promise.resolve(state);
      lastTask = task;
      return start(task);
    },
    retry() {
      if ((state === 'failed' || state === 'unconfirmed') && lastTask) return start(lastTask);
      return Promise.resolve(state);
    },
    dirty() {
      if (state === 'pending') { dirtyDuring = true; return; }
      // Saved, or a failure / unconfirmed note about the PREVIOUS content: the person is changing it, so the control is the ordinary Save again (its next press reads the new content).
      if (state === 'saved' || state === 'failed' || state === 'unconfirmed') { clearDismiss(); state = 'idle'; emit(); }
    },
    reset() { clearDismiss(); gen += 1; inflight = null; if (state !== 'idle') { state = 'idle'; emit(); } },
  };
}

// ═══ 4. THE VIEW MODEL (DI-784, DI-786) ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Everything a painter needs, as plain values.
 *   idle         the control's own label; enabled.
 *   pending      a spinner + "Saving…"; disabled; aria-busy.
 *   saved        a check + "Saved"; disabled (reduced emphasis) until a field changes.
 *   failed       the control re-enabled as "Try Again"; the failure sentence under it (a warning icon: never colour alone); role=alert.
 *   unconfirmed  "Try Again" + the on-this-device sentence (a clock icon); role=status. NEVER the word Saved on its own.
 * `ariaLabel` carries the state in the control's name ("Save, saving").
 */
export function viewFor(state, { idleLabel = 'Save', failedText = '', savedText = '' } = {}) {
  const idle = String(idleLabel == null ? 'Save' : idleLabel);
  const base = { state, label: idle, disabled: false, busy: false, spinner: false, iconName: '', retry: false, message: '', messageIcon: '', messageRole: '', announce: '', ariaLabel: idle };
  switch (state) {
    case 'pending': return { ...base, label: SUBMIT_COPY.pending, disabled: true, busy: true, spinner: true, announce: SUBMIT_COPY.announcePending, ariaLabel: `${idle}, saving` };
    case 'saved': { const sv = (typeof savedText === 'string' && savedText) ? savedText : ''; return { ...base, label: sv || SUBMIT_COPY.saved, disabled: true, iconName: 'check', announce: sv || SUBMIT_COPY.announceSaved, ariaLabel: `${idle}, ${sv ? sv.toLowerCase() : 'saved'}` }; }
    case 'failed': return { ...base, label: SUBMIT_COPY.retry, retry: true, message: (typeof failedText === 'string' && failedText) ? failedText : SUBMIT_COPY.failed, messageIcon: 'warning', messageRole: 'alert', ariaLabel: `${idle}, couldn't save, try again` };
    case 'unconfirmed': return { ...base, label: SUBMIT_COPY.retry, retry: true, message: SUBMIT_COPY.unconfirmed, messageIcon: 'clock', messageRole: 'status', ariaLabel: `${idle}, waiting to reach the server, try again` };
    default: return { ...base, state: 'idle' };
  }
}

// A control that is not a full DOM element (a minimal test double with no attribute API) still takes the paint: the attribute calls are guarded, the property writes are not.
const setAttr = (el, name, value) => { if (el && typeof el.setAttribute === 'function') el.setAttribute(name, value); };
const rmAttr = (el, name) => { if (el && typeof el.removeAttribute === 'function') el.removeAttribute(name); };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** The inside of the control: a spinner or a check, then the label. Every piece is a literal or escaped. */
export function controlInnerHTML(view) {
  const lead = view.spinner ? '<span class="ss-spin" aria-hidden="true"></span>' : view.iconName ? `<span class="ss-ic" aria-hidden="true">${icon(view.iconName)}</span>` : '';
  return `${lead}<span class="ss-label">${esc(view.label)}</span>`;
}
/** The line under the control for failed / unconfirmed: an icon (never colour alone) and the sentence. Empty otherwise. */
export function messageInnerHTML(view) {
  return view.message ? `<span class="ss-msg-ic" aria-hidden="true">${icon(view.messageIcon)}</span><span class="ss-msg-text">${esc(view.message)}</span>` : '';
}

/** An inline field's own indicator (no button): the spinner or check, then "Saving…" / "Saved". */
export function inlineIndicatorHTML(view) {
  const lead = view.spinner ? '<span class="ss-spin" aria-hidden="true"></span>' : view.iconName ? `<span class="ss-ic" aria-hidden="true">${icon(view.iconName)}</span>` : '';
  return `${lead}<span class="ss-msg-text">${esc(view.label)}</span>`;
}

// ═══ 5. THE DOM BINDER (DI-784, DI-785, DI-786) ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Paint a control for a state WITHOUT a machine of its own: a surface whose save is already tracked elsewhere (the 2K25 balances' in-flight map) puts the one language on its button instead of
 * hand-writing "Saving…". Same attributes as the binder: the label, the spinner or check, `aria-busy`, `disabled`, and the state in the accessible name.
 */
export function paintSubmitControl(button, state, idleLabel = 'Save') {
  if (!button) return;
  const view = viewFor(state, { idleLabel });
  button.innerHTML = controlInnerHTML(view);
  setAttr(button, 'data-ss-state', view.state);
  setAttr(button, 'aria-label', view.ariaLabel);
  if (view.busy) setAttr(button, 'aria-busy', 'true'); else rmAttr(button, 'aria-busy');
  if (view.disabled) { setAttr(button, 'disabled', ''); button.disabled = true; } else { rmAttr(button, 'disabled'); button.disabled = false; }
}

/** Is a save under this id still going, or showing a result? A repaint asks before it re-binds a fresh control to the live machine. */
export function hasActiveSubmit(id) {
  const m = id ? _machines.get(id) : null;
  return !!m && m.state !== 'idle';
}

/** A machine per surface id survives a repaint that replaces the button (the Standings page re-renders on a payment tap): the new button re-binds to the live machine instead of starting idle. */
const _machines = new Map();
export function _machineForTest(id) { return _machines.get(id) || null; }
export function _resetSubmitRegistryForTest() { _machines.clear(); }

/**
 * `attachSubmit({ button, statusEl, idleLabel, run, id, dismissOnSaved, onDismiss, onState, listen, announceHaptics })`.
 *   button       the control (optional: an inline field that saves on blur has only a status line).
 *   statusEl     where the failed / unconfirmed sentence and the live announcement go (created after the button when absent and the button has a parent).
 *   rowEl        optional wrapper of an inline status line: hidden while idle so a field with nothing to say takes no space.
 *   idleLabel    the control's own label ("Save", "Send", "Mark Paid").
 *   savedText    optional: a surface whose success is not a "save" (Join League says "Joined") passes its own word for the saved state's label and announcement. Plain text.
 *   failedText   optional: a surface whose design input names its own failure sentence (the profile photo: "Couldn't upload your photo. Nothing was changed. Try again.") passes it; every other
 *                state keeps the shared words. Plain text (escaped where it is painted).
 *   run          `async () => outcome` - the save itself. For a seam-backed save: write locally, then `return confirmSeamKey(key)`.
 *   id           optional: share one machine across repaints.
 *   machine      optional: a machine the surface owns (a status line that outlives any one popover).
 *   dismissOnSaved / onDismiss   a sheet that closes: Saved shows 600 ms, then onDismiss().
 *   listen       true: the binder adds the button's click handler itself (default true). Surfaces with a delegated dispatcher pass false and call `.press()`.
 * Returns { machine, press, dirty, render, destroy }. Never throws.
 */
export function attachSubmit({
  button = null, statusEl = null, rowEl = null, idleLabel = 'Save', run, id = '', dismissOnSaved = false, onDismiss = null, onState = null, listen = true, failedText = '', savedText = '',
  clock = null, machine: externalMachine = null, doc = (typeof document !== 'undefined' ? document : null),
} = {}) {
  let machine = externalMachine || (id ? _machines.get(id) : null);
  // A registered machine is only worth re-binding while it holds something (a save in flight, a result on screen). An idle one carries the closures of an earlier bind, so a fresh bind builds its own.
  if (machine && !externalMachine && machine.state === 'idle') { machine = null; if (id) _machines.delete(id); }
  const reused = !!machine;
  if (!machine) {
    // A dismissing surface (a sheet that closes, a row that repaints) is DONE with its machine once the dismissal fires: it is reset and released, so the next use of the same id starts idle.
    const finish = () => { try { if (typeof onDismiss === 'function') onDismiss(); } finally { machine.reset(); if (id) _machines.delete(id); } };
    machine = createSubmitMachine({ ...(clock || {}), onDismiss: dismissOnSaved ? finish : null });
    if (id) _machines.set(id, machine);
  }
  let status = statusEl;
  let live = null;
  let msg = null;
  let last = null;

  const ensureStatus = () => {
    // The markup may already carry the status line right after the button (submitControlHTML): use it rather than adding a second.
    if (!status && button) { const sib = button.nextElementSibling; if (sib && typeof sib.className === 'string' && /(^|\s)ss-status(\s|$)/.test(sib.className)) status = sib; }
    if (status || !button || !doc || !button.parentNode || typeof doc.createElement !== 'function' || typeof button.parentNode.insertBefore !== 'function') return;
    status = doc.createElement('div');
    status.className = 'ss-status';
    button.parentNode.insertBefore(status, button.nextSibling);
  };
  const ensureParts = () => {
    ensureStatus();
    if (!status) return;
    if (!live || live.parentNode !== status) {
      live = doc.createElement('span');
      live.className = 'sr-only';
      setAttr(live, 'aria-live', 'polite');
      status.appendChild(live);
    }
    if (!msg || msg.parentNode !== status) {
      msg = doc.createElement('div');
      msg.className = 'ss-msg';
      status.appendChild(msg);
    }
  };

  function render(state = machine.state) {
    const view = viewFor(state, { idleLabel, failedText, savedText });
    if (button) {
      button.innerHTML = controlInnerHTML(view);
      setAttr(button, 'data-ss-state', view.state);
      setAttr(button, 'aria-label', view.ariaLabel);
      if (view.busy) setAttr(button, 'aria-busy', 'true'); else rmAttr(button, 'aria-busy');
      if (view.disabled) { setAttr(button, 'disabled', ''); button.disabled = true; } else { rmAttr(button, 'disabled'); button.disabled = false; }
    }
    try {
      ensureParts();
      if (rowEl) rowEl.hidden = view.state === 'idle';
      if (status) {
        setAttr(status, 'data-ss-state', view.state);
        if (msg) {
          // An inline field (no button) shows the working and saved states itself; a button shows them on its own face.
          msg.innerHTML = !button && (view.state === 'pending' || view.state === 'saved') ? inlineIndicatorHTML(view) : messageInnerHTML(view);
          setAttr(msg, 'data-ss-state', view.state);
          if (view.messageRole) setAttr(msg, 'role', view.messageRole); else rmAttr(msg, 'role');
          if (view.messageRole === 'alert') setAttr(msg, 'aria-live', 'assertive'); else rmAttr(msg, 'aria-live');
          // An inline field has no button, so the retry lives in the line itself.
          if (!button && view.retry) {
            const b = doc.createElement('button');
            setAttr(b, 'type', 'button'); b.className = 'ss-retry'; setAttr(b, 'data-ss-retry', '1');
            b.textContent = SUBMIT_COPY.retry;
            msg.appendChild(b);
            b.addEventListener('click', () => { machine.retry(); });
          }
        }
        if (live && view.announce && state !== last) live.textContent = view.announce;
      }
    } catch { /* the status line is decoration for the state the control itself already shows: it never breaks the control */ }
    last = state;
  }

  const unsub = machine.subscribe((s) => {
    const prev = last;
    render(s);
    // Haptics only on a REAL completion: pending -> saved, pending -> failed. Native-only (haptic() is a no-op on the web).
    if (prev === 'pending') { if (s === 'saved') haptic('success'); else if (s === 'failed') haptic('error'); }
    if (typeof onState === 'function') { try { onState(s); } catch { /* a listener never wedges the control */ } }
  });

  const press = () => {
    if (machine.locked) return machine.submit(null);                 // a second tap while pending does nothing, shows nothing
    if (machine.state === 'failed' || machine.state === 'unconfirmed') return machine.retry();
    if (machine.state === 'saved') return Promise.resolve('saved');    // disabled until a field changes
    return machine.submit(run);
  };
  const onClick = () => { press(); };
  if (button && listen) button.addEventListener('click', onClick);

  if (reused) { last = null; render(machine.state); } else { last = 'idle'; render('idle'); }

  return {
    machine,
    press,
    /** Inline field: submit directly (the blur-save / change path). Goes through the same lock. */
    submit: (task = run) => machine.submit(task),
    dirty: () => machine.dirty(),
    render: () => render(),
    /** Unbind this painter. The machine stays registered under its id (a repaint re-binds a new control to it); `release()` forgets it. */
    destroy: () => { unsub(); if (button && listen) button.removeEventListener('click', onClick); },
    release: () => { unsub(); if (button && listen) button.removeEventListener('click', onClick); machine.reset(); if (id) _machines.delete(id); },
  };
}

/**
 * The markup a surface drops in when it wants the control and its status line together. Every argument is escaped.
 */
export function submitControlHTML({ id = '', idleLabel = 'Save', extraClass = 'btn-primary btn-block', action = '' } = {}) {
  const view = viewFor('idle', { idleLabel });
  return `<button type="button" class="btn ${esc(extraClass)} ss-btn"${id ? ` id="${esc(id)}"` : ''}${action ? ` data-action="${esc(action)}"` : ''} data-ss-state="idle">${controlInnerHTML(view)}</button>`
    + `<div class="ss-status" data-ss-state="idle"></div>`;
}
