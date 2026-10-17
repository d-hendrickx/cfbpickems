/**
 * CFB Pickems — pick-status.js ("Who's in", UN-412 / DI-500 / DI-501 / DI-502, Social Platform, 2026-10-01)
 * =========================================================================================================
 * Who has submitted their picks, shown while a week is still blind (open or locked) — NAMES and TWO INTEGERS,
 * never what anyone picked. PURE: no DOM of its own, no storage, no network, no `Date.now()` that a caller cannot
 * hand in. Every reader is injected, so every state here is proved with a fake (pickstatustest.mjs) and the same
 * module paints every placement (Picks, Dashboard, both gates, and Home's Now card at the Home wiring window).
 *
 * ── ONE DEFINITION OF "IN" (DI-500a) ────────────────────────────────────────────────────────────────────────
 * "In" is the app's one existing definition and this file adds no second one: a member is IN when his answer from the
 * injected `read.state(weekId, playerId)` is 'yes' — in app.js that is `submissionStateFor`, i.e. a FULL slate
 * (`pickCount >= gameCount`, the comparison the server's `week_submission_status` count supports and the one
 * `hasPlayerSubmitted` makes from the rows a device holds). The tiebreaker and the Extra Point guess are not part of it.
 * Three answers, not two (DI-T4.11, "absent is not zero"): 'yes' -> in, 'no' -> notyet, anything else -> unknown.
 *
 * ── WHAT MAY BE RENDERED, LOGGED OR PLACED IN AN ATTRIBUTE (DI-500d) ───────────────────────────────────────────
 * A member's display name and initials, his `state`, the two integers, and the player id the patcher keys tiles on.
 * Never a pick count, a guess flag, a timestamp of anyone's activity, or a selection. This module is not even GIVEN those
 * values: `read.state` returns one of three words and `read.asOf` returns the stamp of the ANSWER (when the whole map was
 * last read), not of anyone's activity.
 *
 * ── WHICH WEEKS (DI-500e) ───────────────────────────────────────────────────────────────────────────────────
 * 'open' and 'locked' only, and only while picks are not public (`read.isPublic`). Draft, live and final: no strip.
 * A demo week: the commissioner only (UN-71). No viewer, a viewer who is not an active member, fewer than two active
 * members, or a week with no games: no strip. Signed-out visitors never reach this (no viewer).
 *
 * ── THE STATES ARE NEVER LOUD (DI-501) ──────────────────────────────────────────────────────────────────────
 * "Not yet" is a neutral ring — never red, never a cross. After the lock the missing tile reads "No picks", still
 * neutral (UN-46: naming a miss after the deadline must not become a pile-on). A failed READ is the calm `unknown` state
 * with one sentence, not a banner: the loud-fail banner is reserved for picks not reaching the league.
 *
 * ── FRESHNESS (DI-502e) ─────────────────────────────────────────────────────────────────────────────────────
 * `createPickStatusRefresher` is the throttle: at most one refresh per 20 s, never two in flight, ONE trailing refresh when
 * a request lands inside the window (so a room line that arrives 5 s after a refresh is still answered), and a client-side
 * ceiling so a hung request ends in the calm `unknown` state instead of an endless skeleton. `patchPickStatus` updates
 * the nodes that are already on screen — attributes and text only, so the 150 ms crossfade the CSS declares actually runs —
 * and rebuilds ONLY the strip itself when the roster changed shape. The page is never rebuilt and the scroll is never touched.
 *
 * ── CHAT ARRIVAL (DI-506c) ──────────────────────────────────────────────────────────────────────────────────
 * `newPicksInArrival` is the pure half of the hook: a row counts only when it is a system row authored by 'system' with
 * `meta.kind === 'picksIn'` and a server sequence number. A player-authored lookalike (its `author` is a member id) is
 * ignored, and so is an optimistic local row (no sequence yet).
 *
 * Reads stay synchronous (CONVENTIONS #9). Markup goes through the injected escHtml AT THE SINK (CONVENTIONS #12) — never
 * defaulted. No localStorage, no Math.random, iOS 15 safe (no Object.hasOwn, no .at()).
 */

import { getPlayerInitials } from './data-model.js';
import { icon } from './icons.js';

// ═══ constants ══════════════════════════════════════════════════════════════════════════════════════════════

/** At most one refresh per window (DI-502e). */
export const PICK_STATUS_THROTTLE_MS = 20000;
/** The 60 s tick refreshes only when the answer on the device is at least this old (DI-502e). */
export const PICK_STATUS_TICK_MIN_AGE_MS = 60000;
/** A screen entry that lands within this long of the last read (a hydrate's own, usually) asks for nothing: that read IS the refresh. */
export const PICK_STATUS_ENTER_FRESH_MS = 5000;
/** An answer older than this wears a quiet "Last checked" line (DI-502e item 4). */
export const PICK_STATUS_STALE_NOTE_MS = 5 * 60 * 1000;
/** A refresh that has not answered by now is treated as failed, so a hung request cannot hold a skeleton on screen. */
export const PICK_STATUS_TIMEOUT_MS = 8000;

/** The member states a tile can wear. 'loading' is the skeleton: the answer has been asked for and is not here yet. */
export const PICK_STATUS_STATES = Object.freeze(['in', 'notyet', 'unknown', 'loading']);

export const PICK_STATUS_COPY = Object.freeze({
  title: "Who's in",
  everyoneIn: "Everyone's in",
  everyoneLockedIn: "Everyone's locked in",
  noOneLockedIn: 'No one locked in',
  noPicks: 'No picks',
  you: 'You',
  unknown: "Who else is in isn't available right now. Nobody is being shown as missing.",
  loading: 'Loading who has picked',
});

// ═══ small helpers ══════════════════════════════════════════════════════════════════════════════════════════

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const asArray = (v) => (Array.isArray(v) ? v : []);

function requireEscHtml(fn, who) {
  if (typeof fn !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12 — the sink escapes, and there is no default)`);
}

function normalizeRead(read) {
  const r = (read && typeof read === 'object') ? read : {};
  for (const name of ['state', 'asOf', 'isPublic']) {
    if (typeof r[name] !== 'function') throw new TypeError(`pickStatusFor() requires read.${name} (a missing reader is a wiring bug, and a strip must never guess what it was not given)`);
  }
  return { state: r.state, asOf: r.asOf, isPublic: r.isPublic, pending: typeof r.pending === 'function' ? r.pending : () => false };
}

function emptyModel(weekId = null) {
  return { weekId, phase: 'hidden', total: 0, inCount: 0, members: [], known: true, loading: false, asOf: '', stale: false };
}

// ═══ the model (DI-500) ═════════════════════════════════════════════════════════════════════════════════════

/**
 * @param {object} p
 * @param {object}  p.week            the week record ({ weekId, status, dataSourceMode }) — status 'open' or 'locked' to show
 * @param {object[]} p.games          the week's games (only their number matters: a week with none has nothing to be "in" for)
 * @param {object[]} p.players        the roster, in roster order (inactive players are dropped here)
 * @param {string}  p.viewerId        the verified signed-in member, or '' / null (no viewer: no strip)
 * @param {boolean} p.isCommissioner  demo weeks show only to him (UN-71)
 * @param {object}  p.read            { state(weekId, playerId) -> 'yes'|'no'|'unknown', asOf() -> ISO|'' , isPublic(week) -> boolean, pending?() -> boolean }
 * @param {number}  p.now             injected clock
 * @returns {{weekId, phase:'open'|'locked'|'hidden', total, inCount, members:{playerId,name,initials,state,isViewer}[], known, loading, asOf, stale}}
 */
export function pickStatusFor({ week, games, players, viewerId, isCommissioner = false, read, now = Date.now() } = {}) {
  const r = normalizeRead(read);
  const weekId = week && isNonEmptyString(week.weekId) ? week.weekId : null;
  if (!weekId) return emptyModel();
  if (!isNonEmptyString(viewerId)) return emptyModel(weekId);
  if (week.dataSourceMode === 'demo' && isCommissioner !== true) return emptyModel(weekId);

  // Fail CLOSED on the reveal question: a throw reads as "picks are public" (so: no strip) — the strip never outlives the blind period.
  let isPublic = true;
  try { isPublic = r.isPublic(week) !== false; } catch { isPublic = true; }
  if (isPublic) return emptyModel(weekId);
  const status = String(week.status || '');
  if (status !== 'open' && status !== 'locked') return emptyModel(weekId);

  const gameCount = asArray(games).filter(g => g && (g.weekId === undefined || g.weekId === weekId)).length;
  if (gameCount === 0) return emptyModel(weekId);

  const seen = new Set();
  const roster = [];
  for (const p of asArray(players)) {
    if (!p || !p.active || !isNonEmptyString(p.playerId) || seen.has(p.playerId)) continue;
    seen.add(p.playerId);
    roster.push(p);
  }
  if (roster.length < 2) return emptyModel(weekId);
  if (!seen.has(viewerId)) return emptyModel(weekId);          // a deactivated viewer is shown nothing new

  const members = roster.map((p) => {
    let answer = 'unknown';
    try { answer = r.state(weekId, p.playerId); } catch { answer = 'unknown'; }
    const state = answer === 'yes' ? 'in' : (answer === 'no' ? 'notyet' : 'unknown');
    const initials = String(getPlayerInitials(p) || '?').slice(0, 3);
    return { playerId: p.playerId, name: isNonEmptyString(p.displayName) ? p.displayName.trim() : 'Player', initials, state, isViewer: p.playerId === viewerId };
  });

  const others = members.filter(m => !m.isViewer);
  let pending = false;
  try { pending = r.pending() === true; } catch { pending = false; }
  // The skeleton is for ONE situation: the answer was asked for and nothing is on the device yet. Anything else with an
  // unknown in it is the calm "isn't available" state, never a skeleton that could sit there forever.
  const loading = pending && others.length > 0 && others.every(m => m.state === 'unknown');
  if (loading) members.forEach((m) => { m.state = 'loading'; });

  const known = !loading && members.every(m => m.state !== 'unknown');
  const inCount = members.filter(m => m.state === 'in').length;
  let asOf = '';
  try { asOf = String(r.asOf() || ''); } catch { asOf = ''; }
  const asOfMs = asOf ? Date.parse(asOf) : NaN;
  const stale = known && !loading && Number.isFinite(asOfMs) && (now - asOfMs) > PICK_STATUS_STALE_NOTE_MS;

  return { weekId, phase: status, total: members.length, inCount, members, known, loading, asOf, stale };
}

// ═══ the words (DI-501 strings, final) ══════════════════════════════════════════════════════════════════════

const joinNames = (names) => names.join(', ');

function timeText(formatTime, iso) {
  if (!iso || typeof formatTime !== 'function') return '';
  try { return String(formatTime(iso) || ''); } catch { return ''; }
}

/**
 * Every string the strip shows, in one place: the count, the group label VoiceOver reads once, the note, and each tile's
 * label and sub-label. Plain text — escaping happens where it is interpolated.
 */
export function pickStatusCopy(model, { formatTime } = {}) {
  const C = PICK_STATUS_COPY;
  const m = (model && typeof model === 'object') ? model : emptyModel();
  const locked = m.phase === 'locked';
  const total = m.total;
  const n = m.inCount;
  const label = (x) => (x.isViewer ? C.you : x.name);
  const lowerName = (x) => (x.isViewer ? 'you' : x.name);

  let count = '';
  if (m.known && !m.loading && total > 0) {
    if (locked) count = n === total ? C.everyoneLockedIn : (n === 0 ? C.noOneLockedIn : `${n} of ${total} locked in`);
    else count = n === total ? C.everyoneIn : `${n} of ${total}`;
  }

  let note = '';
  const when = timeText(formatTime, m.asOf);
  if (m.loading) note = '';
  else if (!m.known) note = `${C.unknown}${when ? ` Last checked ${when}.` : ''}`;
  else if (m.stale && when) note = `Last checked ${when}.`;

  const inNames = m.members.filter(x => x.state === 'in').map(lowerName);
  const outNames = m.members.filter(x => x.state === 'notyet').map(lowerName);
  let groupLabel;
  if (m.loading) groupLabel = C.loading;
  else {
    const parts = [];
    if (!m.known) {
      parts.push(C.unknown);
      if (inNames.length) parts.push(`${locked ? 'Locked in' : 'In'}: ${joinNames(inNames)}.`);
      if (outNames.length) parts.push(`${locked ? 'No picks' : 'Not yet'}: ${joinNames(outNames)}.`);
    } else {
      // The visible count reads "4 of 6"; the spoken sentence says what the number counts ("4 of 6 in") — DI-501's group label.
      parts.push(`${locked || count === C.everyoneIn ? count : `${n} of ${total} in`}.`);
      if (inNames.length) parts.push(`${locked ? 'Locked in' : 'In'}: ${joinNames(inNames)}.`);
      if (outNames.length) parts.push(`${locked ? 'No picks' : 'Not yet'}: ${joinNames(outNames)}.`);
    }
    groupLabel = parts.join(' ');
  }

  const tiles = m.members.map((x) => ({
    playerId: x.playerId,
    state: x.state,
    initials: m.loading ? '' : x.initials,
    label: m.loading ? '' : label(x),
    // The sub-label exists only after the lock, only for a member shown as not in, and never on the viewer's own tile
    // (the group label says "No picks: you").
    sub: (!m.loading && locked && x.state === 'notyet' && !x.isViewer) ? C.noPicks : '',
    isViewer: x.isViewer,
  }));

  return { title: C.title, count, groupLabel, note, tiles };
}

/** The patcher's change detector: every value a patch would write, and nothing it would not. */
export function pickStatusSignature(model, opts = {}) {
  const c = pickStatusCopy(model, opts);
  return JSON.stringify([model.phase, model.loading ? 1 : 0, c.count, c.groupLabel, c.note, c.tiles.map(t => [t.playerId, t.state, t.initials, t.label, t.sub, t.isViewer ? 1 : 0])]);
}

// ═══ markup (DI-501) ════════════════════════════════════════════════════════════════════════════════════════

// One template literal each, not a concatenation: xsstest's classifier follows a SINGLE template across modules, and every `${}` below is
// a literal, a ternary of literals, or an escHtml() call (this module is in the sweep at zero — [9c-1f]).
function tileHTML(t, escHtml) {
  return `<li class="ps-m${t.isViewer ? ' you' : ''}" data-ps-player="${escHtml(t.playerId)}" data-state="${escHtml(t.state)}"><span class="ps-av"><span class="ps-ini">${escHtml(t.initials)}</span><span class="ps-badge">${icon('check')}</span></span><span class="ps-name">${escHtml(t.label)}</span><span class="ps-sub">${escHtml(t.sub)}</span></li>`;
}

/**
 * The strip. '' when the week shows none. One component for every placement; `tone: 'dark'` is Home's Now card (a gradient
 * surface) and only adds a class. The tiles are `aria-hidden` and the group's label carries the whole answer, so VoiceOver
 * reads it once.
 */
export function renderPickStatusHTML(model, { escHtml, formatTime, tone = 'light' } = {}) {
  requireEscHtml(escHtml, 'renderPickStatusHTML');
  if (!model || model.phase === 'hidden') return '';
  const copy = pickStatusCopy(model, { formatTime });
  const toneKey = tone === 'dark' ? 'dark' : 'light';
  const sig = pickStatusSignature(model, { formatTime });
  const tiles = copy.tiles.map(t => tileHTML(t, escHtml)).join('');
  return `<div class="pick-status${toneKey === 'dark' ? ' ps-on-dark' : ''}${model.loading ? ' ps-loading' : ''}" data-pick-status="${escHtml(model.weekId)}" data-ps-phase="${escHtml(model.phase)}" data-ps-tone="${toneKey}" data-ps-sig="${escHtml(sig)}" role="group" aria-label="${escHtml(copy.groupLabel)}"><div class="ps-head"><span class="ps-title">${escHtml(copy.title)}</span><span class="ps-count">${escHtml(copy.count)}</span></div><ul class="ps-list" aria-hidden="true">${tiles}</ul><p class="ps-note" aria-hidden="true"${copy.note ? '' : ' hidden'}>${escHtml(copy.note)}</p></div>`;
}

// ═══ patching in place (DI-502e item 3) ═════════════════════════════════════════════════════════════════════

const attrOf = (el, name) => { try { return el.getAttribute(name); } catch { return null; } };

/**
 * Brings ONE strip already on screen up to date. Returns 'unchanged' | 'patched' | 'replaced' | 'hidden' | 'missing'.
 *   - unchanged: the signature matches — nothing is written (no flash, no style recalculation).
 *   - patched:   same roster in the same order — attributes and text only, so the tile's CSS transition runs (150 ms).
 *   - replaced:  the roster changed shape — this strip's own markup is rebuilt, nothing else.
 *   - hidden:    the model says no strip any more (the week went live, the league shrank) — the CALLER removes the node.
 * It never touches anything outside `host`, never assigns innerHTML to a container, and never reads or sets a scroll position.
 */
export function patchPickStatus(host, model, { escHtml, formatTime } = {}) {
  if (!host) return 'missing';
  if (!model || model.phase === 'hidden') return 'hidden';
  const sig = pickStatusSignature(model, { formatTime });
  if (attrOf(host, 'data-ps-sig') === sig) return 'unchanged';

  const tiles = Array.from(host.querySelectorAll('[data-ps-player]'));
  const sameShape = tiles.length === model.members.length && model.members.every((m, i) => attrOf(tiles[i], 'data-ps-player') === m.playerId);
  if (!sameShape) {
    requireEscHtml(escHtml, 'patchPickStatus');
    host.outerHTML = renderPickStatusHTML(model, { escHtml, formatTime, tone: attrOf(host, 'data-ps-tone') === 'dark' ? 'dark' : 'light' });
    return 'replaced';
  }

  const copy = pickStatusCopy(model, { formatTime });
  // Only a CHANGED value is written: setting an attribute or text to what it already holds is still a DOM mutation (a style recalculation, a
  // mutation-observer wake-up), and the whole point of patching in place is that a refresh touches exactly what moved.
  const setAttr = (el, name, value) => { if (attrOf(el, name) !== String(value)) el.setAttribute(name, value); };
  const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };
  setAttr(host, 'aria-label', copy.groupLabel);
  setAttr(host, 'data-ps-phase', model.phase);
  setAttr(host, 'data-ps-sig', sig);
  if (host.classList) { if (model.loading) host.classList.add('ps-loading'); else host.classList.remove('ps-loading'); }
  setText(host.querySelector('.ps-count'), copy.count);
  copy.tiles.forEach((t, i) => {
    const el = tiles[i];
    setAttr(el, 'data-state', t.state);
    setText(el.querySelector('.ps-ini'), t.initials);
    setText(el.querySelector('.ps-name'), t.label);
    setText(el.querySelector('.ps-sub'), t.sub);
  });
  const note = host.querySelector('.ps-note');
  if (note) {
    setText(note, copy.note);
    if (copy.note) { if (attrOf(note, 'hidden') !== null) note.removeAttribute('hidden'); }
    else if (attrOf(note, 'hidden') === null) note.setAttribute('hidden', '');
  }
  return 'patched';
}

// ═══ the throttle (DI-502e) ═════════════════════════════════════════════════════════════════════════════════

/**
 * One refresh at a time, at most one per `minGapMs`. A request inside the window is not dropped: it becomes ONE trailing
 * refresh at the end of the window (so a room line arriving seconds after a refresh is still answered); a request while
 * one is in flight marks a follow-up for when it settles. `refresh` is async and resolves truthy on success; it may reject
 * or hang — a rejection is a failed refresh, and a hang is cut off at `timeoutMs` (a late answer is ignored, never
 * applied twice). `onStart` / `onSettled` are the UI's repaint hooks; the controller itself touches nothing.
 *
 * request(reason) -> 'started' | 'trailing' | 'in-flight' | 'off'
 */
export function createPickStatusRefresher({
  refresh, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
  minGapMs = PICK_STATUS_THROTTLE_MS, timeoutMs = PICK_STATUS_TIMEOUT_MS, onStart = () => {}, onSettled = () => {},
} = {}) {
  if (typeof refresh !== 'function') throw new TypeError('createPickStatusRefresher() requires a refresh function');
  let inFlight = false;
  let lastStartAt = -Infinity;
  let trailing = null;
  let followUp = false;
  let calls = 0;
  let requests = 0;
  let gen = 0;

  const safe = (fn, arg) => { try { fn(arg); } catch (e) { console.warn('[pick-status] hook failed', e && e.message); } };

  function clearTrailing() {
    if (trailing !== null) { try { clearTimer(trailing); } catch { /* ignore */ } trailing = null; }
  }

  function start(reason) {
    clearTrailing();
    followUp = false;
    inFlight = true;
    lastStartAt = now();
    calls++;
    const myGen = gen;
    safe(onStart, { reason });
    let done = false;
    let watchdog = null;
    const settle = (ok) => {
      if (done) return;
      done = true;
      if (myGen !== gen) return;               // a reset() happened while this was in flight: it settles into nothing
      inFlight = false;
      if (watchdog !== null) { try { clearTimer(watchdog); } catch { /* ignore */ } watchdog = null; }
      safe(onSettled, { reason, ok });
      if (followUp) { followUp = false; request('follow-up'); }
    };
    try { watchdog = setTimer(() => settle(false), timeoutMs); } catch { watchdog = null; }
    let p;
    try { p = Promise.resolve(refresh({ reason })); } catch (e) { p = Promise.reject(e); }
    p.then((r) => settle(!!r), () => settle(false));
    return 'started';
  }

  function request(reason = '') {
    requests++;
    if (inFlight) { followUp = true; return 'in-flight'; }
    const wait = minGapMs - (now() - lastStartAt);
    if (wait > 0) {
      if (trailing === null) {
        try { trailing = setTimer(() => { trailing = null; request('trailing'); }, wait); } catch { trailing = null; }
      }
      return 'trailing';
    }
    return start(reason);
  }

  return {
    request,
    pending: () => inFlight,
    cancel: () => { clearTrailing(); followUp = false; },
    /** Back to the initial state (a new session / a test): no window, nothing in flight, no timer — and an in-flight answer that arrives later is ignored. */
    reset: () => { clearTrailing(); followUp = false; inFlight = false; lastStartAt = -Infinity; gen++; },
    stats: () => ({ inFlight, lastStartAt, trailing: trailing !== null, calls, requests }),
  };
}

// ═══ chat arrival (DI-506c) ═════════════════════════════════════════════════════════════════════════════════

/** A "<Name> is in for Week N" line written by the database: a system row, authored 'system', kind 'picksIn', server-sequenced. */
export function isPicksInRow(m) {
  return !!m && typeof m === 'object' && m.type === 'system' && m.author === 'system'
    && !!m.meta && typeof m.meta === 'object' && m.meta.kind === 'picksIn' && typeof m.seq === 'number';
}

/** @returns {{arrived:boolean, watermark:number}} — `arrived` is true when a picksIn row newer than `watermark` is in `items`. */
export function newPicksInArrival(items, watermark = -1) {
  let max = Number.isFinite(watermark) ? watermark : -1;
  let arrived = false;
  const base = max;
  for (const m of asArray(items)) {
    if (!isPicksInRow(m)) continue;
    if (m.seq > base) arrived = true;
    if (m.seq > max) max = m.seq;
  }
  return { arrived, watermark: max };
}
