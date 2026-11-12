/**
 * js/school-picker.js — ONE searchable school picker for every alma-mater / team field (D2 lane 1, UN-530 / PF-530, DI-779; Drew's FB-039 "type to filter the alma mater").
 * ===========================================================================================================================================================================
 * Before this, every school field was a native <select> of ~760 options: no search, a wheel to spin, and a different caption machinery on each screen. Now a field is a ROW (the current
 * school, a chevron) that pushes ONE shared sheet, "Choose school": a nav title, Cancel, a search field at the top (focused with the keyboard up on arrival), a list of 48 pt rows with
 * None first and the current school checked. Tapping a row sets the field, closes the sheet and the form shows its own save state (DI-781).
 *
 * THE FIELD KEEPS ITS CONTRACT. A field is a hidden input (the value, carrying the form's own `id` / `data-field`) beside the row button, so every existing reader of `.value`, every `change`
 * listener and the save paths work unchanged: picking a school writes the hidden input and dispatches a bubbling `change` on it. The value is the ESPN `location` string, the same text games
 * store as homeTeam / awayTeam (the alma-mater convention), so Alma Mater Watch's exact-equality match applies to whatever is picked.
 *
 * MATCHING (DI-779): case and accents ignored; matches the school name, the nickname and the abbreviation ("OSU", "Ohio St", "Miami (OH)"); ranked prefix, then word start, then anywhere; at most
 * 50 rows rendered; the list updates IN PLACE (the search input is never rebuilt, so the keyboard stays up and the layout does not jump).
 *
 * STATES (DI-779): loading (skeleton rows, the search field usable), empty search ("No school matches “q”" / "Check the spelling, or clear the search to see every school." / Clear search),
 * the catalog could not load ("Couldn't load schools." / Try Again; the saved value is untouched, and a short fallback list, when the app has one, stays choosable).
 *
 * Every app effect is INJECTED (the section-drag / pushed-screen discipline): `configureSchoolPicker({ escHtml, getCatalog, retryCatalog, abbr })`, called once by js/app.js. This module imports
 * only icons.js, nav-gestures.js (the native swipe-back) and platform.js; it never imports app.js. Zero top-level side effects.
 */
import { icon } from './icons.js';
import { bindSwipeToDismiss, prefersReducedMotion } from './nav-gestures.js';

export const SCHOOL_ROW_LIMIT = 50;
export const SCHOOL_PICKER_ID = 'school-picker';

export const SCHOOL_PICKER_COPY = Object.freeze({
  title: 'Choose school',
  cancel: 'Cancel',
  placeholder: 'Search schools',
  searchLabel: 'Search schools',
  clearSearch: 'Clear search',
  none: 'None',
  current: '(current)',
  emptyTitle: (q) => `No school matches “${q}”`,
  emptyBody: 'Check the spelling, or clear the search to see every school.',
  failedTitle: "Couldn't load schools.",
  failedBody: 'Check your connection. Your saved school is unchanged.',
  partialNote: (got, count) => `Only ${got} of ${count} schools loaded.`,
  shortNote: 'Showing a short list.',
  tryAgain: 'Try Again',
  more: (shown, total) => `Showing ${shown} of ${total}. Type to narrow the list.`,
  count: (n) => `${n} ${n === 1 ? 'school' : 'schools'}`,
  fieldNone: 'None',
  fieldChoose: 'Choose',
});

// ═══ 1. PURE: folding and ranking ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Lower-case, accents removed, every run of non-letters/digits becomes ONE space ("Texas A&M" -> "texas a m", "Miami (OH)" -> "miami oh", "San José" -> "san jose"). */
export function foldSchool(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The matching tier of one team for a folded query, or -1 for no match. `q` is the folded query; `qTight` the same without spaces (for abbreviations: "o s u"/"osu").
 *   0  the name or the location STARTS with the query, or the abbreviation EQUALS it
 *   1  every query word is the start of some word in the name (word start: "ohio st" -> "Ohio State"), or the abbreviation starts with the query
 *   2  the folded name CONTAINS the query anywhere
 */
function tierOf(q, qTight, name, loc, abbr) {
  if (!q) return 0;
  if (name.startsWith(q) || loc.startsWith(q) || (abbr && abbr === qTight)) return 0;
  const words = name.split(' ');
  const qWords = q.split(' ');
  if (qWords.every((qw) => words.some((w) => w.startsWith(qw)))) return 1;
  if (abbr && abbr.startsWith(qTight) && qTight.length >= 2) return 1;
  if (name.includes(q) || loc.includes(q)) return 2;
  return -1;
}

/**
 * Rank `teams` ([{ location, displayName }]) for `query`. Returns `{ rows, total }`: `rows` at most `limit`, each `{ location, label, tier }`; `total` is every match (so the sheet can say it is
 * showing N of M). An empty query matches everything, alphabetical by label. `abbr(location)` is the app's one team shorthand (AD-20); absent, no abbreviation matching. `exclude` is a list of
 * locations never offered (the News picker leaves out the teams already followed).
 */
export function rankSchools(query, teams, { abbr = null, limit = SCHOOL_ROW_LIMIT, exclude = [] } = {}) {
  const q = foldSchool(query);
  const qTight = q.replace(/ /g, '');
  const skip = new Set((Array.isArray(exclude) ? exclude : []).map((x) => String(x).toLowerCase()));
  const out = [];
  for (const t of Array.isArray(teams) ? teams : []) {
    if (!t || typeof t.location !== 'string' || !t.location) continue;
    if (skip.has(t.location.toLowerCase())) continue;
    const label = (typeof t.displayName === 'string' && t.displayName) || t.location;
    let ab = '';
    if (typeof abbr === 'function') { try { ab = foldSchool(abbr(t.location)).replace(/ /g, ''); } catch { ab = ''; } }
    const tier = tierOf(q, qTight, foldSchool(label), foldSchool(t.location), ab);
    if (tier < 0) continue;
    out.push({ location: t.location, label, tier });
  }
  out.sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label));
  return { rows: out.slice(0, Math.max(1, limit | 0)), total: out.length };
}

/**
 * The whole list's model for the sheet. `catalog` = { status: 'loaded' | 'loading' | 'failed' | 'partial', teams, fallback, got, expected }.
 *   kind 'loading'  no teams yet and still fetching      -> skeleton rows
 *   kind 'failed'   no teams and no fallback and it failed -> the failed state (Try Again)
 *   kind 'empty'    a query that matches nothing          -> the empty state (Clear search)
 *   kind 'rows'     everything else; `note` carries the partial / short-list sentence (with Try Again)
 * The CURRENT value is checked, and when it is in no list (a legacy free-text claim, or the catalog is still the short one) it is offered anyway as "<value> (current)" so opening the
 * picker and cancelling can never lose it.
 */
export function schoolPickerModel({ query = '', value = '', catalog = {}, exclude = [], abbr = null, limit = SCHOOL_ROW_LIMIT } = {}) {
  const c = catalog && typeof catalog === 'object' ? catalog : {};
  const teams = Array.isArray(c.teams) ? c.teams : [];
  const fallback = Array.isArray(c.fallback) ? c.fallback : [];
  const status = c.status || (teams.length ? 'loaded' : 'loading');
  const q = String(query == null ? '' : query);
  const cur = String(value == null ? '' : value).trim();
  const usingFallback = !teams.length && fallback.length > 0 && (status === 'failed' || status === 'partial');
  const source = teams.length ? teams : (usingFallback ? fallback : []);
  if (!source.length && status === 'loading') return { kind: 'loading', rows: [], total: 0, query: q, value: cur };
  if (!source.length && status === 'failed') return { kind: 'failed', rows: [], total: 0, query: q, value: cur };
  const { rows, total } = rankSchools(q, source, { abbr, limit, exclude });
  const marked = rows.map((r) => ({ ...r, selected: !!cur && r.location.toLowerCase() === cur.toLowerCase(), current: false }));
  if (cur && !q.trim() && !marked.some((r) => r.selected) && !source.some((t) => t && typeof t.location === 'string' && t.location.toLowerCase() === cur.toLowerCase())) {
    marked.unshift({ location: cur, label: cur, tier: 0, selected: true, current: true });
  }
  if (q.trim() && total === 0) return { kind: 'empty', rows: [], total: 0, query: q, value: cur };
  let note = '';
  if (status === 'partial' && c.expected) note = SCHOOL_PICKER_COPY.partialNote(Number(c.got) || teams.length, Number(c.expected));
  else if (usingFallback) note = SCHOOL_PICKER_COPY.shortNote;
  else if (status === 'failed') note = SCHOOL_PICKER_COPY.shortNote;
  return { kind: 'rows', rows: marked, total, shown: rows.length, note, noteRetry: !!note, query: q, value: cur };
}

// ═══ 2. MARKUP ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

let cfg = null;
const requireCfg = () => { if (!cfg) throw new TypeError('school-picker: configureSchoolPicker() was not called'); return cfg; };
const esc = (s) => requireCfg().escHtml(s);
const iconSvg = (name) => icon(name);

/** The listbox body for a model: None first, then the rows; or the skeleton / empty / failed states. Every user value passes escHtml. */
export function schoolListHTML(model) {
  const m = model || { kind: 'loading', rows: [] };
  if (m.kind === 'loading') {
    return `<div class="sp-skel" aria-hidden="true">${'<div class="sp-skel-row"><span class="feed-skel-line feed-skel-line--full"></span></div>'.repeat(6)}</div>`;
  }
  if (m.kind === 'failed') {
    return `<div class="sp-empty" role="alert"><div class="sp-empty-ic" aria-hidden="true">${iconSvg('warning')}</div><h3>${esc(SCHOOL_PICKER_COPY.failedTitle)}</h3><p>${esc(SCHOOL_PICKER_COPY.failedBody)}</p>`
      + `<button type="button" class="btn btn-secondary sp-retry" data-sp-act="retry">${esc(SCHOOL_PICKER_COPY.tryAgain)}</button></div>`;
  }
  if (m.kind === 'empty') {
    return `<div class="sp-empty"><div class="sp-empty-ic" aria-hidden="true">${iconSvg('search')}</div><h3>${esc(SCHOOL_PICKER_COPY.emptyTitle(m.query))}</h3><p>${esc(SCHOOL_PICKER_COPY.emptyBody)}</p>`
      + `<button type="button" class="btn btn-secondary sp-clear-search" data-sp-act="clear">${esc(SCHOOL_PICKER_COPY.clearSearch)}</button></div>`;
  }
  const check = `<span class="sp-ck" aria-hidden="true">${iconSvg('check')}</span>`;
  const row = (r) => `<button type="button" class="sp-row${r.selected ? ' is-selected' : ''}" role="option" aria-selected="${r.selected ? 'true' : 'false'}" data-school="${esc(r.location)}">`
    + `<span class="sp-row-label">${esc(r.label)}${r.current ? ` <span class="sp-row-current">${esc(SCHOOL_PICKER_COPY.current)}</span>` : ''}</span>${r.selected ? check : ''}</button>`;
  const none = `<button type="button" class="sp-row${m.value ? '' : ' is-selected'}" role="option" aria-selected="${m.value ? 'false' : 'true'}" data-school=""><span class="sp-row-label">${esc(SCHOOL_PICKER_COPY.none)}</span>${m.value ? '' : check}</button>`;
  const note = m.note ? `<div class="sp-note" role="status"><span>${esc(m.note)}</span><button type="button" class="sp-retry-link" data-sp-act="retry">${esc(SCHOOL_PICKER_COPY.tryAgain)}</button></div>` : '';
  const more = m.total > m.shown ? `<div class="sp-more" role="note">${esc(SCHOOL_PICKER_COPY.more(m.shown, m.total))}</div>` : '';
  return `${note}${none}${m.rows.map(row).join('')}${more}`;
}

/**
 * A school FIELD: the hidden input (the value, carrying the form's `id` and optional `data-field`) beside the row that opens the picker. `label` names the field for assistive tech
 * ("Alma mater, Texas A&M, choose"). `exclude` (locations) is read by the picker when it opens. `disabled` renders the row inert (the Locked / Live guard).
 */
export function schoolFieldHTML({ id, field = '', value = '', label = 'School', title = '', exclude = [], disabled = false, placeholder = '', catalog = '' } = {}) {
  const v = String(value == null ? '' : value).trim();
  const shown = v ? `<span class="school-field-v">${esc(v)}</span>` : `<span class="school-field-ph">${esc(placeholder || SCHOOL_PICKER_COPY.fieldNone)}</span>`;
  const aria = `${label}, ${v || SCHOOL_PICKER_COPY.fieldNone}, ${SCHOOL_PICKER_COPY.fieldChoose.toLowerCase()}`;
  const ex = Array.isArray(exclude) && exclude.length ? ` data-school-exclude="${esc(JSON.stringify(exclude.map(String)))}"` : '';
  const cat = catalog ? ` data-school-catalog="${esc(catalog)}"` : '';   // D2 lane 1 (onboarding): a sport's own team list (NFL); empty = the one college list
  return `<div class="school-field"><input type="hidden" id="${esc(id)}"${field ? ` data-field="${esc(field)}"` : ''} value="${esc(v)}">`
    + `<button type="button" class="school-field-btn" data-action="school-pick" data-school-for="${esc(id)}" data-school-label="${esc(label)}"${title ? ` data-school-title="${esc(title)}"` : ''}${ex}${cat}`
    + ` aria-haspopup="dialog" aria-label="${esc(aria)}"${disabled ? ' disabled aria-disabled="true"' : ''}>${shown}<span class="school-field-chev" aria-hidden="true">${iconSvg('chevronRight')}</span></button></div>`;
}

// ═══ 3. THE SHEET (DOM) ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** `configureSchoolPicker({ escHtml, getCatalog, retryCatalog, abbr, setTimer, clearTimer })` - called once by js/app.js. escHtml and getCatalog are required. `getCatalog(key)` and `retryCatalog(key)` receive the field's `data-school-catalog` ('' = the college list). */
export function configureSchoolPicker(c) {
  const d = c && typeof c === 'object' ? c : {};
  if (typeof d.escHtml !== 'function') throw new TypeError('configureSchoolPicker() requires an injected escHtml function (CONVENTIONS #12)');
  if (typeof d.getCatalog !== 'function') throw new TypeError('configureSchoolPicker() requires an injected getCatalog function');
  cfg = {
    escHtml: d.escHtml, getCatalog: d.getCatalog,
    retryCatalog: typeof d.retryCatalog === 'function' ? d.retryCatalog : () => {},
    onOpen: typeof d.onOpen === 'function' ? d.onOpen : () => {},
    abbr: typeof d.abbr === 'function' ? d.abbr : null,
    setTimer: typeof d.setTimer === 'function' ? d.setTimer : (fn, ms) => setTimeout(fn, ms),
    clearTimer: typeof d.clearTimer === 'function' ? d.clearTimer : (h) => clearTimeout(h),
  };
}

let current = null;   // the one open sheet: { el, input, list, count, state, onPick, restore }

function doc() { return typeof document !== 'undefined' ? document : null; }
export const isSchoolPickerOpen = () => !!current;
export function _resetSchoolPickerForTest() { try { current && current.el && current.el.remove && current.el.remove(); } catch { /* gone */ } current = null; }

function modelNow() {
  const c = requireCfg();
  let catalog = {};
  try { catalog = c.getCatalog(current.catalog || '') || {}; } catch { catalog = { status: 'failed', teams: [], fallback: [] }; }
  return schoolPickerModel({ query: current.query, value: current.value, catalog, exclude: current.exclude, abbr: c.abbr });
}

/** Repaint the LIST only (the search input is never rebuilt: the keyboard stays up, nothing jumps). Called on every keystroke and when the catalog lands. */
export function refreshOpenSchoolPicker() {
  if (!current) return false;
  const m = modelNow();
  const html = schoolListHTML(m);
  if (current.lastHtml !== html) { current.list.innerHTML = html; current.lastHtml = html; }
  if (current.clearBtn) current.clearBtn.hidden = !String(current.query).length;
  if (current.count) current.count.textContent = m.kind === 'rows' ? SCHOOL_PICKER_COPY.count(m.total) : '';
  return true;
}

function closeSheet({ restoreFocus = true, instant = false } = {}) {
  const cur = current;
  if (!cur) return;
  current = null;
  const d = doc();
  try { d && d.removeEventListener && d.removeEventListener('keydown', cur.onKey, true); } catch { /* gone */ }
  try { cur.unbindSwipe && cur.unbindSwipe(); } catch { /* gone */ }
  const done = () => { try { cur.el.remove(); } catch { /* gone */ } };
  const reduced = instant || !!prefersReducedMotion();
  if (reduced || !cur.el.classList) done();
  else { cur.el.classList.add('is-leaving'); requireCfg().setTimer(done, 300); }
  try { if (restoreFocus && cur.restore && typeof cur.restore.focus === 'function') cur.restore.focus({ preventScroll: true }); } catch { /* courtesy */ }
}
export function closeSchoolPicker(opts) { closeSheet(opts); }

/**
 * Open the sheet. `value` is the field's current school, `exclude` locations never offered, `onPick(location)` receives '' for None. `restore` is the control focus returns to.
 * Returns false when it cannot open (no document, not configured).
 */
export function openSchoolPicker({ value = '', exclude = [], title = '', onPick = () => {}, restore = null, catalog = '' } = {}) {
  const d = doc();
  if (!d || !cfg) return false;
  if (current) closeSheet({ restoreFocus: false, instant: true });
  const c = requireCfg();
  try { c.onOpen(); } catch { /* the sheet shows its own loading state */ }
  const el = d.createElement('div');
  el.id = SCHOOL_PICKER_ID;
  el.className = 'school-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'sp-title');
  el.innerHTML = `<div class="sp-panel"><div class="sp-nav"><button type="button" class="sp-cancel" data-sp-act="cancel">${esc(SCHOOL_PICKER_COPY.cancel)}</button>`
    + `<h2 class="sp-title" id="sp-title">${esc(title || SCHOOL_PICKER_COPY.title)}</h2><span class="sp-nav-r" aria-hidden="true"></span></div>`
    + `<div class="sp-search"><span class="sp-search-ic" aria-hidden="true">${iconSvg('search')}</span>`
    + `<input type="search" class="sp-input" id="sp-q" placeholder="${esc(SCHOOL_PICKER_COPY.placeholder)}" aria-label="${esc(SCHOOL_PICKER_COPY.searchLabel)}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search">`
    + `<button type="button" class="sp-clear" data-sp-act="clear" aria-label="${esc(SCHOOL_PICKER_COPY.clearSearch)}" hidden>${iconSvg('clear')}</button></div>`
    + `<div class="sr-only" role="status" aria-live="polite" id="sp-count"></div>`
    + `<div class="sp-list" id="sp-list" role="listbox" aria-label="${esc(SCHOOL_PICKER_COPY.title)}"></div></div>`;
  d.body.appendChild(el);
  const input = el.querySelector('#sp-q');
  const state = {
    el, input, list: el.querySelector('#sp-list'), count: el.querySelector('#sp-count'), clearBtn: el.querySelector('.sp-clear'),
    query: '', value: String(value || '').trim(), exclude: Array.isArray(exclude) ? exclude : [], onPick, restore, catalog: String(catalog || ''), lastHtml: null, unbindSwipe: null,
    // Capture phase + stopImmediatePropagation: Escape closes THIS sheet and never the Control Center drawer (or a modal) underneath it, whose own Escape handler sits on the document too.
    onKey: (e) => { if (e && e.key === 'Escape') { try { e.stopImmediatePropagation && e.stopImmediatePropagation(); e.preventDefault && e.preventDefault(); } catch { /* courtesy */ } closeSheet(); } },
  };
  current = state;
  refreshOpenSchoolPicker();
  d.addEventListener('keydown', state.onKey, true);
  input.addEventListener('input', () => { state.query = String(input.value || ''); refreshOpenSchoolPicker(); });
  input.addEventListener('keydown', (e) => { if (e && e.key === 'Enter') { try { input.blur && input.blur(); } catch { /* courtesy */ } } });   // Return dismisses the keyboard; the list is already filtered
  el.addEventListener('click', (e) => {
    const t = e && e.target;
    const act = t && t.closest ? t.closest('[data-sp-act]') : null;
    if (act) {
      const a = act.getAttribute('data-sp-act');
      if (a === 'cancel') { closeSheet(); return; }
      if (a === 'clear') { input.value = ''; state.query = ''; refreshOpenSchoolPicker(); try { input.focus(); } catch { /* courtesy */ } return; }
      if (a === 'retry') { try { c.retryCatalog(state.catalog); } catch { /* the sheet keeps its state */ } refreshOpenSchoolPicker(); return; }
    }
    const row = t && t.closest ? t.closest('[data-school]') : null;
    if (!row) return;
    const picked = row.getAttribute('data-school') || '';
    const cb = state.onPick;
    closeSheet();
    try { cb(picked); } catch (err) { try { console.warn('[school-picker] onPick threw', err); } catch { /* courtesy */ } }
  });
  // Native swipe-back: a left-to-right drag follows the finger (the League Page's recipe); 40% or a flick dismisses. Web: Cancel and Esc.
  try {
    state.unbindSwipe = bindSwipeToDismiss(el, {
      axis: 'x', getBlocked: () => false, getDistancePx: () => (el.getBoundingClientRect ? el.getBoundingClientRect().width : 1) || 1,
      onProgress: (p) => { try { el.style.setProperty('--sp-drag', String(p)); } catch { /* decoration */ } },
      onSettle: ({ dismissed }) => { try { el.style.setProperty('--sp-drag', '0'); } catch { /* decoration */ } if (dismissed) closeSheet(); },
    });
  } catch { /* the Cancel button always works */ }
  if (!prefersReducedMotion() && el.classList) {
    el.classList.add('is-entering');
    const go = () => { try { el.classList.remove('is-entering'); } catch { /* gone */ } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(go)); else go();
  }
  try { input.focus(); } catch { /* the field is usable either way */ }
  return true;
}

// ═══ 4. THE DELEGATE (one document-level click handler for every school field) ═════════════════════════════════════════════════════════════════════

let delegateBound = false;
export function _resetSchoolDelegateForTest() { delegateBound = false; }

function dispatchChange(input) {
  let ev;
  const real = typeof HTMLElement !== 'undefined' && input instanceof HTMLElement && typeof Event === 'function';
  if (real) ev = new Event('change', { bubbles: true });
  else ev = { type: 'change', bubbles: true };
  try { input.dispatchEvent(ev); } catch { /* a field with no dispatcher already holds the value */ }
}

/** Set a field's value from the sheet: the hidden input, the row's visible text and accessible name, then ONE bubbling `change`. */
export function setSchoolFieldValue(btn, input, picked) {
  const v = String(picked || '').trim();
  const changed = String(input.value || '') !== v;
  input.value = v;
  try { input.setAttribute && input.setAttribute('value', v); } catch { /* property is enough */ }
  const label = btn.getAttribute('data-school-label') || 'School';
  try {
    const shown = btn.querySelector('.school-field-v, .school-field-ph');
    if (shown) { shown.className = v ? 'school-field-v' : 'school-field-ph'; shown.textContent = v || SCHOOL_PICKER_COPY.fieldNone; }
    btn.setAttribute('aria-label', `${label}, ${v || SCHOOL_PICKER_COPY.fieldNone}, ${SCHOOL_PICKER_COPY.fieldChoose.toLowerCase()}`);
  } catch { /* decoration */ }
  if (changed) dispatchChange(input);
}

export function bindSchoolPickerDelegate(d = doc()) {
  if (!d || delegateBound || typeof d.addEventListener !== 'function') return false;
  delegateBound = true;
  d.addEventListener('click', (e) => {
    const btn = e && e.target && e.target.closest ? e.target.closest('[data-action="school-pick"]') : null;
    if (!btn || btn.disabled) return;
    const id = btn.getAttribute('data-school-for');
    const input = id ? d.getElementById(id) : null;
    if (!input) return;
    let exclude = [];
    try { const raw = btn.getAttribute('data-school-exclude'); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) exclude = a; } } catch { exclude = []; }
    openSchoolPicker({
      value: input.value, exclude, title: btn.getAttribute('data-school-title') || '', restore: btn, catalog: btn.getAttribute('data-school-catalog') || '',
      onPick: (picked) => setSchoolFieldValue(btn, input, picked),
    });
  });
  return true;
}
