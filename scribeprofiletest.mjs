#!/usr/bin/env node
/**
 * scribeprofiletest.mjs — D1 Lane C: THE SCRIBE PROFILE PANE (FB-006 / UN-468 / PF-468; DI-644…648, DI-681, DI-682, D-51).
 * ============================================================================================================================
 * Run:  cd cfb-pickems && node scribeprofiletest.mjs        (registered: tests/suites/scribeprofiletest.json)
 *
 * WHAT IS HERE. The CLIENT half of the pane, end to end where it can be:
 *   [1] the shared text rules      js/scribe-profile-rules.js   (validators, the fixed-field shapers, the history mapper — boundary text never leaves)
 *   [2] the pure markup            js/scribe-profile-view.js    (escaping at every sink, the three row states, 44 pt controls, the Replace label, the sheets)
 *   [3] the one network call       js/scribe-profile-client.js  (no identity in the body, every failure mapped to one code, requestId minted once)
 *   [4] the written standards      js/scribe-standards.js       (v3.2 parity with the persona, the nine rules, the deadline-step ceilings, frozen)
 *   [5] THE PANE ITSELF            js/app.js                    (a fake DOM + the REAL adapter + a fake `scribe-profile` server: open -> skeleton -> view; a decision moves a
 *                                                                row only after the SERVER confirms it; a refused save leaves it Pending and says so; Replace pulls the
 *                                                                retirement into the mirror; Add / Correct / facts / lore send exactly the fields they should; Esc and close
 *                                                                restore the page; the Trainer card gives its lists to the pane only where the pane is offered)
 *   [6] source and stylesheet scans (gesture-suspension lists, precache, every class styled, 44 pt, no hardcoded colour, Reduce Motion, entry-card position)
 *
 * WHAT IS NOT HERE. What only a device shows: the edge swipe-back and the sheet's drag-down, haptics, momentum scroll, the push transition. They are bound behind
 * isNativeShell() and listed "implemented per spec, unverified on device" in the handoff. The server's rules (who may call, the guard trigger's human-approval stamp, the
 * policy hash pins) are asserted in supabase/tests/functions/scribeProfile.twin.mjs and supabase/tests/static.check.mjs ("0052 /").
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── DOM / browser stubs (the learntest shape) plus a small fake DOM for section [5] ───────────────────────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };

// A fake element tree, just deep enough for the pane: elements the app appends to <body> are findable by id; an id that appears inside an appended element's innerHTML
// resolves to a lazily created CHILD element (so `#sp-scroll`, `#scribe-profile-sheet-body`, `#sp-submit` exist exactly as long as the markup that carries them).
const fakeDom = (() => {
  const all = [], classLog = [];
  const roots = new Set();
  const keydown = new Set();
  const persistent = new Map();            // id -> element for ids a test registers by hand (the toast container, the page chrome)
  const mk = (tag = 'div') => {
    const el = {
      tagName: String(tag).toUpperCase(), _id: '', attrs: new Map(), listeners: {}, _html: '', children: [], virtual: new Map(), scrollTop: 0, textContent: '',
      style: { cssText: '', setProperty(k, v) { (this.props = this.props || {})[k] = v; }, removeProperty() {} },
      classList: { _s: new Set(), add(c) { this._s.add(c); classLog.push(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      get id() { return this._id; }, set id(v) { this._id = String(v); },
      get className() { return [...this.classList._s].join(' '); }, set className(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.virtual = new Map(); },
      setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this._id = String(v); },
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      removeAttribute(k) { this.attrs.delete(k); },
      hasAttribute(k) { return this.attrs.has(k); },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
      appendChild(c) { this.children.push(c); return c; },
      insertAdjacentHTML(_where, html) { this._html += String(html); },
      remove() { roots.delete(this); },
      focus() { fakeDom.focused = this; },
      getBoundingClientRect() { return { width: 375, height: 700 }; },
      querySelector(sel) {
        const m = /^#([\w-]+)$/.exec(sel);
        if (m) return findIn(this, m[1]);
        const a = /^\[([\w-]+)\]$/.exec(sel);                                           // [data-x] — a lazily created child for an attribute the markup carries
        if (a && new RegExp(`\\s${a[1]}(\\s|>|=)`).test(this._html)) {
          const k = `attr:${a[1]}`;
          if (!this.virtual.has(k)) { const c = mk('div'); c.setAttribute(a[1], ''); this.virtual.set(k, c); }
          return this.virtual.get(k);
        }
        return null;
      },
      querySelectorAll(sel) {
        if (sel !== '[data-sp-id]') return [];
        const out = [];
        for (const m of this._html.matchAll(/data-sp-list="([^"]*)" data-sp-id="([^"]*)"/g)) {
          const k = `row:${m[1]}|${m[2]}`;
          if (!this.virtual.has(k)) { const c = mk('div'); c.setAttribute('data-sp-list', m[1]); c.setAttribute('data-sp-id', m[2]); c.offsetHeight = 64; this.virtual.set(k, c); }
          out.push(this.virtual.get(k));
        }
        return out;
      },
      closest() { return null; },
      dispatch(type, evt) { for (const f of this.listeners[type] || []) f(evt); },
    };
    all.push(el);
    return el;
  };
  const findIn = (el, id) => {
    if (el._html.includes(`id="${id}"`)) {
      if (!el.virtual.has(id)) { const c = mk('div'); c._id = id; el.virtual.set(id, c); }
      return el.virtual.get(id);
    }
    for (const v of el.virtual.values()) { const hit = findIn(v, id); if (hit) return hit; }
    return null;
  };
  const byId = (id) => {
    if (persistent.has(id)) return persistent.get(id);
    for (const r of roots) { if (r.id === id) return r; const v = findIn(r, id); if (v) return v; }
    return null;
  };
  const chrome = ['.main-content', '.bottom-nav', '.app-header'].map((sel) => { const e = mk('div'); e.sel = sel; return e; });
  const doc = {
    addEventListener(t, f) { if (t === 'keydown') keydown.add(f); }, removeEventListener(t, f) { if (t === 'keydown') keydown.delete(f); },
    getElementById: (id) => byId(id),
    querySelector: () => null,
    querySelectorAll: (sel) => chrome.filter((e) => e.sel === sel),
    createElement: (t) => mk(t),
    body: { classList: Object.assign([], { add() {}, remove() {}, contains() { return false; } }), dataset: {}, style: {}, setAttribute() {}, removeAttribute() {}, appendChild(el) { roots.add(el); return el; }, innerHTML: '' },
    documentElement: mk('html'),
    hidden: false,
  };
  // The browser ends a CSS transition on its own; the fake does not. `pump()` dispatches `transitionend` to every element that is waiting for one, so a closing sheet and a collapsing row finish
  // without the test sleeping out the 300-420 ms fallback timers (the fallback paths are asserted separately).
  const pump = () => { for (const el of all) { const fs = el.listeners.transitionend; if (fs && fs.length) { el.listeners.transitionend = []; for (const f of fs) f({ type: 'transitionend', target: el }); } } };
  return { doc, roots, keydown, chrome, register: (id, el) => persistent.set(id, el), mk, byId, focused: null, all, classLog, pump };
})();
globalThis.document = fakeDom.doc;
globalThis.window = globalThis;
globalThis.location = { search: '', hash: '', href: 'https://irbfootball.com/', protocol: 'https:', pathname: '/', origin: 'https://irbfootball.com', host: 'irbfootball.com', hostname: 'irbfootball.com' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.fetch = async () => { throw new Error('network disabled in scribeprofiletest'); };
globalThis.matchMedia = () => ({ matches: false });
let confirmCalls = [];
let confirmAnswer = true;
const setConfirm = (a) => { confirmAnswer = a; confirmCalls = []; return confirmCalls; };
const getConfirmCalls = () => confirmCalls;
globalThis.confirm = (msg) => { confirmCalls.push(String(msg)); return confirmAnswer; };
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const quiet = async (fn) => {
  const rl = console.log, rw = console.warn, re = console.error, ri = console.info;
  console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.log = rl; console.warn = rw; console.error = re; console.info = ri; }
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

const rules = await import('./js/scribe-profile-rules.js');
const view = await import('./js/scribe-profile-view.js');
const client = await import('./js/scribe-profile-client.js');
const standardsMod = await import('./js/scribe-standards.js');
const trainerRules = await import('./js/scribe-trainer-rules.js');
const persona = await import('./supabase/functions/_shared/scribe-persona.mjs');
const { escHtml } = await import('./js/chat.js').catch(() => ({}));

// the same escaper the app injects (js/app.js `escHtml`): the pure view takes it as a dependency
const esc = (s) => (!s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));   // EXACTLY js/app.js escHtml
const icon = (name) => `<svg data-icon="${name}"></svg>`;
const deps = { escHtml: esc, icon };
void escHtml;

const EVIL = '<img src=x onerror=alert(1)>"\'&';

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] scribe-profile-rules — the validators and the fixed-field shapers…');
{
  const { validateInstruction, validateFact, validateLore, isRequestId, shapeLearningRow, shapeCanonRow, summarizePlayers, shapeLore, mapHistoryRow, isLearningLive,
    INSTRUCTION_CATEGORIES, TEXT_MAX, KEY_MAX, UNSAFE_CHARS_RE, clampDisplay } = rules;
  const bidi = String.fromCharCode(0x202E);
  const zw = String.fromCharCode(0x200B);
  assert(INSTRUCTION_CATEGORIES.length === 8 && !INSTRUCTION_CATEGORIES.some((c) => c.value === 'factual'),
    '1-1: a person may write under EIGHT categories, and `factual` (the Trainer-only one) is not among them');
  assert(validateInstruction({ category: 'brevity', text: '  keep it short  ' }).text === 'keep it short', '1-2: an instruction is trimmed');
  assert(validateInstruction({ category: 'factual', text: 'x' }).error === 'bad_category' && validateInstruction({ category: 'brevity', text: '' }).error === 'bad_text',
    '1-3: an unknown category and an empty text are refused with the codes the sheet words');
  assert(validateInstruction({ category: 'brevity', text: 'x'.repeat(TEXT_MAX) }).ok && validateInstruction({ category: 'brevity', text: 'x'.repeat(TEXT_MAX + 1) }).error === 'bad_text',
    `1-4: the text limit is exactly ${TEXT_MAX} (the boundary passes, one more fails)`);
  assert(validateInstruction({ category: 'brevity', text: `a${bidi}b` }).error === 'bad_text' && validateInstruction({ category: 'brevity', text: `a${zw}b` }).error === 'bad_text'
    && validateInstruction({ category: 'brevity', text: 'a\nb' }).error === 'bad_text',
    '1-5: a bidi override, a zero-width space and a newline are all refused (the class migration 0052 checks too)');
  assert(validateFact({ key: 'Pick style', value: 'Takes underdogs.' }).ok && validateFact({ key: 'é', value: 'x' }).error === 'bad_key' && validateFact({ key: 'k'.repeat(KEY_MAX + 1), value: 'x' }).error === 'bad_key',
    `1-6: a fact's topic is printable ASCII up to ${KEY_MAX} (it is the upsert key); a non-ASCII or over-long topic is refused`);
  assert(validateLore({ key: 'CFP 2K25', text: 'Kihoon won.' }).ok && validateLore({ key: '', text: 'x' }).error === 'bad_key' && validateLore({ key: 'k', text: '' }).error === 'bad_text',
    '1-7: lore has the same shape as a fact');
  assert(isRequestId('r1234abcd') && !isRequestId('short') && !isRequestId('has space here') && !isRequestId(42),
    '1-8: a request id is 8 to 64 of [A-Za-z0-9_-]');
  assert(UNSAFE_CHARS_RE.test(bidi) && !UNSAFE_CHARS_RE.test('plain text') && clampDisplay(`a${bidi}b\n\nc`) === 'a b c',
    '1-9: display clamping replaces the unsafe class with a space and collapses whitespace');

  const NOW = Date.parse('2026-10-07T12:00:00Z');
  const row = (over = {}) => ({ id: 'lrn_1', kind: 'learning', status: 'approved', origin: 'trainer', created_at: '2026-10-07T10:00:00Z',
    payload: { kind: 'learning', category: 'brevity', instruction: 'Keep it short.', confidence: 0.95, createdAt: '2026-10-07T10:00:00Z', ...(over.payload || {}) }, ...over, ...(over.payload ? { payload: { kind: 'learning', category: 'brevity', instruction: 'Keep it short.', confidence: 0.95, createdAt: '2026-10-07T10:00:00Z', ...over.payload } } : {}) });
  const auto = shapeLearningRow(row(), { nowMs: NOW });
  assert(auto.autoApplied === true && auto.undoable === true && auto.humanApproved === false && auto.live === true,
    '1-10: an auto-applied (confidence >= 0.9) Trainer learning under a day old is Undo-able and live, and no human approved it');
  const old = shapeLearningRow(row({ created_at: '2026-10-05T10:00:00Z', payload: { createdAt: '2026-10-05T10:00:00Z' } }), { nowMs: NOW });
  assert(old.undoable === false && old.autoApplied === true, '1-11: past 24 hours it is a plain "Turn off", not an Undo');
  const human = shapeLearningRow(row({ origin: 'human', payload: { approvedBy: 'm1', approvedAt: '2026-10-07T11:00:00Z', confidence: 1 } }), { nowMs: NOW });
  assert(human.humanApproved === true && human.undoable === false && human.autoApplied === false && human.approvedAt === '2026-10-07T11:00:00.000Z',
    '1-12: a human-approved row is stamped, never Undo-able and never "auto-applied", even at confidence 1');
  const lowHuman = shapeLearningRow(row({ payload: { confidence: 0.4, approvedBy: 'm1', approvedAt: '2026-10-07T11:00:00Z' } }), { nowMs: NOW });
  const lowAuto = shapeLearningRow(row({ payload: { confidence: 0.4 } }), { nowMs: NOW });
  assert(lowHuman.live === true && lowAuto.live === false, '1-13: DI-681 — a human-approved row is live whatever its confidence; an unapproved one under the 0.75 floor is not');
  assert(isLearningLive({ confidence: 0.9, provisional: true, expiresAt: '2026-10-01T00:00:00Z' }, 'approved', NOW) === false
    && isLearningLive({ confidence: 0.9, provisional: true, expiresAt: '2026-10-01T00:00:00Z', approvedBy: 'm1', approvedAt: '2026-10-01T00:00:00Z' }, 'approved', NOW) === true,
    '1-14: an expired provisional learning is not live, but a human-approved one never expires');
  const replacing = shapeLearningRow(row({ id: 'lrn_new', status: 'pending', payload: { replaces: 'lrn_old', confidence: 0.8 } }),
    { nowMs: NOW, rowsById: { lrn_old: { kind: 'learning', status: 'approved', payload: { kind: 'learning', instruction: 'The old rule.' } } } });
  assert(replacing.replaces === 'lrn_old' && replacing.replacesText === 'The old rule.' && replacing.replacesActive === true, '1-15: a replacement carries the id, the text and the liveness of the rule it would retire');
  const names = { p9: 'Brayden' };
  const withQuote = shapeLearningRow(row({ payload: { source: { quote: `be shorter${bidi}`, playerId: 'p9' } } }), { nowMs: NOW, names });
  assert(withQuote.source.quote === 'be shorter' && withQuote.source.authorName === 'Brayden', '1-16: the player\'s own words are clamped for display and attributed by roster name');
  const canon = shapeCanonRow({ id: 'c1', kind: 'canon', approval_status: 'approved', payload: { contextSummary: 'ctx', preferredResponse: 'reply', confidence: 0.8 } });
  assert(canon.list === 'canon' && canon.live === true && canon.text.includes('ctx') && canon.humanApproved === false, '1-17: an approved canon example is shown with its text and is live above the floor');

  const members = [{ id: 'm1', display_name: 'Drew' }, { id: 'm2', display_name: 'Kevin' }];
  const players = summarizePlayers(members, [
    { subject_member_id: 'm1', kind: 'fact', key: 'Pick style', value: 'Underdogs.', provenance: 'commissioner-set', created_at: '2026-10-01T00:00:00Z' },
    { subject_member_id: 'm1', kind: 'hardline', key: 'h', value: 'MY DIVORCE' },
    { subject_member_id: 'm1', kind: 'roastTolerance', key: 'roastTolerance', value: 'light' },
    { subject_member_id: 'ghost', kind: 'fact', key: 'x', value: 'not on the roster' },
  ]);
  assert(players.length === 2 && players[0].factCount === 1 && players[0].boundaryCount === 1 && players[0].tolerance === 'light' && !JSON.stringify(players).includes('DIVORCE'),
    '1-18: the roster summary COUNTS a boundary and never returns its text; a row for someone off the roster is dropped');
  const CS = 'commissioner-set';
  assert(shapeLore([{ kind: 'lore', key: 'A', value: 'old', provenance: CS, refreshed_at: '2026-10-01T00:00:00Z' }, { kind: 'lore', key: 'B', value: 'new', provenance: CS, refreshed_at: '2026-10-05T00:00:00Z' }, { kind: 'fact', key: 'F', value: 'no', provenance: CS }])
    .map((x) => x.key).join() === 'B,A', '1-19: lore is newest first and nothing but lore rows');
  assert(shapeLore([{ id: 'l1', kind: 'lore', key: 'Good', value: 'v', provenance: CS }, { id: 'l2', kind: 'lore', key: 'Forged', value: 'v', provenance: 'player-stated' }, { id: 'l3', kind: 'lore', key: 'None', value: 'v' }]).map((x) => x.key).join() === 'Good',
    '1-19b: F1 — a lore-shaped row of ANY other provenance (player-stated, or none) is not league history');
  const attributed = shapeLore([{ id: 'l1', kind: 'lore', key: 'Mine', value: 'v', provenance: CS }, { id: 'l2', kind: 'lore', key: 'His', value: 'v', provenance: CS }, { id: 'l3', kind: 'lore', key: 'Unknown', value: 'v', provenance: CS }],
    { callerMemberId: 'm1', names: { m2: 'Kevin' }, actors: { l1: 'm1', l2: 'm2' } });
  assert(attributed.find((x) => x.key === 'Mine').addedBy === 'you' && attributed.find((x) => x.key === 'His').addedBy.name === 'Kevin' && attributed.find((x) => x.key === 'Unknown').addedBy === '',
    '1-19c: N6 — who added a lore entry is attributed PER VIEWER: "you" for the caller, the name for another commissioner, nothing guessed when the trail does not say');
  const ctxMod = await import('./supabase/functions/_shared/scribe-context.mjs');
  assert(rules.RULE_CAP === trainerRules.ACTIVE_LEARNING_CAP && rules.RULE_CAP === 15 && rules.LOADER_ROW_WINDOW === ctxMod.CONTEXT_ROW_LIMIT && rules.LIVE_CONFIDENCE_FLOOR === 0.75,
    '1-19e: B3 — the pane\'s constants ARE the prompt loader\'s and the Trainer\'s: the 15-rule cap, the 50-row window and the 0.75 floor (the SQL twins are pinned in static.check against the same numbers)');
  const sel = rules.selectReadByScribe(Array.from({ length: 20 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, kind: 'learning', status: 'approved', created_at: new Date(Date.parse('2026-10-07T12:00:00Z') - i * 3600e3).toISOString(), payload: { instruction: `I${i}`, confidence: 0.9 } })), { nowMs: Date.parse('2026-10-07T12:00:00Z') });
  assert(sel.size === 15 && sel.has('r00') && sel.has('r14') && !sel.has('r15'), '1-19d: B3 — the rows SCRIBE reads are the newest 15 live ones (the prompt loader\'s window and cap)');

  const aud = (over) => ({ at: '2026-10-07T10:00:00Z', row_id: 'r1', actor_member_id: null, table_name: 'scribe_learnings', action: 'INSERT', before: null, after: null, ...over });
  const h1 = mapHistoryRow(aud({ after: { kind: 'learning', status: 'pending', origin: 'trainer', payload: { instruction: 'Do X.' } } }));
  assert(h1 && h1.verb === 'proposed' && h1.actor === 'trainer' && h1.text === 'Do X.', '1-20: a Trainer insert reads "Trainer proposed"');
  const h2 = mapHistoryRow(aud({ action: 'UPDATE', actor_member_id: 'm1', before: { kind: 'learning', status: 'pending', payload: { instruction: 'Do X.' } }, after: { kind: 'learning', status: 'approved', payload: { instruction: 'Do X.' } } }), { callerMemberId: 'm1' });
  assert(h2 && h2.actor === 'you' && h2.verb === 'approved', '1-21: the caller\'s own approval reads "You approved"');
  assert(mapHistoryRow(aud({ action: 'UPDATE', before: { kind: 'learning', status: 'approved', payload: { instruction: 'a' } }, after: { kind: 'learning', status: 'approved', payload: { instruction: 'a', memoryAppliedAt: 'x' } } })) === null,
    '1-22: a bookkeeping update (no status change) records nothing a commissioner would read');
  const hb = mapHistoryRow(aud({ table_name: 'scribe_memory', action: 'INSERT', actor_member_id: 'm2', after: { kind: 'hardline', key: 'h', value: 'MY DIVORCE', subject_member_id: 'm2' } }), { callerMemberId: 'm1', names: { m2: 'Kevin' } });
  assert(hb && hb.verb === 'changed a boundary' && hb.text === '' && !JSON.stringify(hb).includes('DIVORCE') && hb.actor.name === 'Kevin',
    '1-23: a boundary change shows WHO and WHEN and never WHAT');
  assert(mapHistoryRow(aud({ table_name: 'scribe_memory', action: 'UPDATE', after: { kind: 'fact', key: 'k', value: 'v', provenance: 'computed' }, before: { kind: 'fact', key: 'k', value: 'v0', provenance: 'computed' } })) === null
    && mapHistoryRow(aud({ table_name: 'chat_messages', after: { body: 'secret' } })) === null,
    '1-24: a system-kept ("computed") fact refresh and a row of another table map to nothing');
  // F3: a commissioner's own add is written by the SERVICE role (a null audit actor); the author rides in payload.source.playerId
  const addByMe = mapHistoryRow(aud({ action: 'INSERT', after: { status: 'approved', kind: 'learning', origin: 'human', payload: { category: 'humor', instruction: 'Mine.', origin: 'human', source: { playerId: 'm1' } } } }), { callerMemberId: 'm1', names: { m1: 'Drew', m2: 'Kevin' } });
  const addByHim = mapHistoryRow(aud({ action: 'INSERT', after: { status: 'approved', kind: 'learning', origin: 'human', payload: { category: 'humor', instruction: 'His.', origin: 'human', source: { playerId: 'm2' } } } }), { callerMemberId: 'm1', names: { m1: 'Drew', m2: 'Kevin' } });
  assert(addByMe.actor === 'you' && addByMe.verb === 'added' && addByHim.actor.name === 'Kevin' && mapHistoryRow(aud({ action: 'INSERT', after: { status: 'pending', kind: 'learning', origin: 'trainer', payload: { instruction: 'T.' } } })).actor === 'trainer',
    '1-25: F3 — a human-origin row with a null audit actor is attributed to payload.source.playerId ("you" for the caller); a Trainer row stays "trainer"');
  const T = '2026-10-07T10:00:00Z';
  const fold = rules.foldHistory([
    { at: T, actor: 'you', verb: 'added', kind: 'learning', category: 'humor', rowId: 'new', text: 'NEW', corrects: 'old' },
    { at: T, actor: 'trainer', verb: 'turned off', kind: 'learning', category: 'humor', rowId: 'old', text: 'OLD' },
    { at: '2026-10-07T09:00:00Z', actor: 'you', verb: 'turned off', kind: 'learning', category: 'humor', rowId: 'old', text: 'EARLIER' },
    { at: T, actor: 'you', verb: 'approved', kind: 'learning', category: 'brevity', rowId: 'n2', text: 'REPL', replaces: 'o2' },
    { at: T, actor: 'you', verb: 'turned off', kind: 'learning', category: 'brevity', rowId: 'o2', text: 'GONE' },
  ]);
  assert(fold.length === 3 && fold[0].verb === 'corrected' && !('corrects' in fold[0]) && fold[1].text === 'EARLIER' && fold[2].verb === 'replaced' && !fold.some((x) => x.text === 'OLD' || x.text === 'GONE'),
    '1-26: N1 — a correction and an approved Replace each fold into ONE entry; the retired rule\'s "turned off" line (same row, same moment) is dropped, and a turn off at another moment stays');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] scribe-profile-view — the pure markup…');
{
  const V = view;
  const pendingRow = (over = {}) => ({ id: 'lrn_p', list: 'learnings', kind: 'learning', category: 'brevity', text: 'Lead with the number.', status: 'pending', origin: 'trainer', humanApproved: false,
    live: false, provisional: false, autoApplied: false, undoable: false, confidence: 0.82, flaggedHostile: false, createdAt: '2026-10-05T10:00:00Z', source: { quote: '', authorName: '' }, ui: {}, ...over });
  const activeRow = (over = {}) => pendingRow({ id: 'lrn_a', status: 'approved', live: true, ...over });

  // escaping: EVERY user-data sink in every renderer
  const hostile = pendingRow({ text: EVIL, category: EVIL, source: { quote: EVIL, authorName: EVIL }, replaces: 'x', replacesText: EVIL, playerName: EVIL });
  const pendingHTML = V.pendingRowHTML(hostile, deps);
  assert(!pendingHTML.includes('<img') && pendingHTML.includes('&lt;img') && !/onerror=alert/.test(pendingHTML.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')),
    '2-1: a pending row escapes the rule text, the player\'s quote, the author and the text it would replace');
  const activeHTML = V.activeRowHTML(activeRow({ text: EVIL, source: { quote: EVIL, authorName: EVIL } }), deps);
  assert(!activeHTML.includes('<img') && activeHTML.includes('&lt;img') && !activeHTML.includes('onerror=alert(1)>'), '2-2: an active row escapes the same fields (and its aria-label)');
  const idAttack = V.pendingRowHTML(pendingRow({ id: '"><script>alert(1)</script>' }), deps);
  assert(!idAttack.includes('<script>') && idAttack.includes('data-sp-id="&quot;&gt;&lt;script&gt;'), '2-3: a row id is escaped in the data attribute that routes the click');
  const players = V.playersSegmentHTML({ players: [{ memberId: '"><b>', name: EVIL, factCount: 2, boundaryCount: 1, tolerance: EVIL }] }, deps);
  assert(!players.includes('<img') && !players.includes('<b>') && players.includes('2 notes') && players.includes('1 boundary'), '2-4: the Players list escapes name, id and the roast-limit word, and pluralises');
  const hist = V.historySegmentHTML({ status: 'ready', entries: [{ at: '2026-10-07T10:00:00Z', actor: { name: EVIL }, verb: 'added', kind: 'fact', subject: EVIL, text: EVIL }], more: false }, deps);
  assert(!hist.includes('<img') && hist.includes('&lt;img'), '2-5: History escapes the actor, subject and text of an entry');
  const sheetEvil = V.addSheetBodyHTML({ tab: 'instruction', category: 'brevity', text: EVIL, key: EVIL, value: EVIL, loreKey: EVIL, loreText: EVIL, playerId: EVIL, busy: false, error: EVIL, invalid: false }, deps, { players: [{ memberId: EVIL, name: EVIL }] });
  assert(!sheetEvil.includes('<img') && !sheetEvil.includes('onerror=alert(1)>'), '2-6: the Add sheet escapes what was typed (textarea, inputs, the option list, the error line)');
  for (const tab of ['fact', 'lore']) {
    const h = V.addSheetBodyHTML({ tab, category: 'brevity', text: '', key: EVIL, value: EVIL, loreKey: EVIL, loreText: EVIL, playerId: EVIL, busy: false, error: '', invalid: false }, deps, { players: [{ memberId: EVIL, name: EVIL }] });
    assert(!h.includes('<img') && h.includes('&lt;img'), `2-6b: the ${tab} tab escapes what was typed`);
  }
  const lore = V.loreDetailSheetBodyHTML({ key: EVIL, text: EVIL, updatedAt: '2026-10-07T10:00:00Z' }, deps, { error: EVIL });
  const player = V.playerSheetBodyHTML({ memberId: 'm', name: EVIL, tolerance: EVIL, boundaryCount: 0, facts: [{ key: EVIL, text: EVIL, provenance: 'commissioner-set', at: '2026-10-01T00:00:00Z' }] }, deps, { error: EVIL });
  const rule = V.ruleDetailSheetBodyHTML(activeRow({ text: EVIL }), [{ sentence: EVIL, when: EVIL }], deps, {});
  assert(![lore, player, rule].some((h) => h.includes('<img')), '2-7: the lore, player and rule detail sheets escape every field');
  let threw = false; try { V.pendingRowHTML(pendingRow(), {}); } catch { threw = true; }
  assert(threw, '2-8: a renderer called without an escHtml throws (user data must never render unescaped by omission)');

  // the three states of a Pending row
  const idle = V.pendingRowHTML(pendingRow(), deps);
  const saving = V.pendingRowHTML(pendingRow({ ui: { phase: 'saving', approving: true } }), deps);
  const failed = V.pendingRowHTML(pendingRow({ ui: { phase: 'failed', approving: true } }), deps);
  assert(/>Approve</.test(idle) && />Reject</.test(idle) && !/disabled/.test(idle) && !/role="alert"/.test(idle), '2-9: idle — Approve and Reject, both enabled, no error');
  assert(/>Saving…</.test(saving) && /aria-busy="true"/.test(saving) && (saving.match(/disabled/g) || []).length === 2 && !/Approved/.test(saving),
    '2-10: saving — the tapped button reads "Saving…" (aria-busy), BOTH are disabled, and nothing reads "Approved"');
  assert(/role="alert"/.test(failed) && /Couldn't save\. This one is still waiting for review\./.test(failed) && />Retry</.test(failed) && !/disabled/.test(failed),
    '2-11: failed — an inline alert says it is still waiting, the tapped button reads Retry and is enabled');
  const rejectSaving = V.pendingRowHTML(pendingRow({ ui: { phase: 'saving', approving: false } }), deps);
  assert(/sp-approve"[^>]*disabled[^>]*>Approve</.test(rejectSaving) && /sp-reject"[^>]*aria-busy="true"[^>]*>Saving…</.test(rejectSaving), '2-12: while a REJECT is in flight the Reject button is the one reading "Saving…"');
  const replace = V.pendingRowHTML(pendingRow({ replaces: 'lrn_old', replacesText: 'Old rule text' }), deps);
  assert(/>Replace</.test(replace) && !/>Approve</.test(replace) && replace.includes('Proposed replacement for: Old rule text'), '2-13: DI-681 — a proposal that replaces an approved rule says Replace, and shows what it would replace');
  assert(V.pendingRowHTML(pendingRow({ replaces: 'lrn_old', replacesText: '' }), deps).includes('a rule that is no longer shown'), '2-14: …and says so when the old rule\'s text is not available');
  const held = V.pendingRowHTML(pendingRow({ flaggedHostile: true }), deps);
  assert(held.includes('held for review') && held.includes('Approving is still your call'), '2-15: a flagged proposal wears the held badge and says why');

  // Active rows
  const aTrainer = V.activeRowHTML(activeRow({ autoApplied: true }), deps);
  const aUndo = V.activeRowHTML(activeRow({ autoApplied: true, undoable: true }), deps);
  const aHuman = V.activeRowHTML(activeRow({ humanApproved: true, origin: 'human', approvedAt: '2026-10-06T10:00:00Z' }), deps);
  assert(!/sp-toggle|>Turn off<|>Correct<|>Keep</.test(aTrainer) && !/sp-toggle/.test(aHuman) && />Undo</.test(aUndo) && /You added this/.test(aHuman) && /Auto-applied \(Trainer\)/.test(aTrainer),
    '2-16: B1 — an Active row carries NO Turn off / Correct / Keep (they live in its detail sheet); the ONLY control on it is Undo, and only for an unapproved auto-apply under 24 hours; the source line names who made it');
  const aSaving = V.activeRowHTML(activeRow({ undoable: true, autoApplied: true, ui: { phase: 'saving' } }), deps);
  const aFailed = V.activeRowHTML(activeRow({ undoable: true, autoApplied: true, ui: { phase: 'failed' } }), deps);
  assert(/>Saving…</.test(aSaving) && /disabled/.test(aSaving) && /Couldn't save\. Nothing changed\./.test(aFailed) && />Retry</.test(aFailed), '2-17: the Undo has the saving and failed states');
  const aSheetSave = V.activeRowHTML(activeRow({ ui: { phase: 'saving' } }), deps);
  assert(/role="status">Saving…/.test(aSheetSave) && !/<button[^>]*sp-toggle/.test(aSheetSave), '2-17b: a switch started from the detail sheet still shows "Saving…" on its (button-less) row');
  assert(!V.activeRowHTML(activeRow({ undoable: true, canToggle: false }), deps).includes('sp-toggle'), '2-18: a read-only caller gets no Undo');
  const notLive = V.activeRowHTML(activeRow({ live: false, humanApproved: false }), deps);
  assert(notLive.includes('Not in use yet') && notLive.includes('below SCRIBE'), '2-19: an approved row under the confidence floor says it is not in use, and how to fix that');

  // segments, states, counts
  const pane = (state) => V.paneHTML({ seg: 'active', status: 'ready', view: { counts: { active: 3, pending: 2 }, active: [], pending: [], examples: [], lore: [], players: [], canEdit: true, pilot: true, standards: { version: '3.2' } }, history: { status: 'idle', entries: [] }, ...state }, deps);
  const p1 = pane({});
  assert(/Pending 2/.test(p1) && /aria-selected="true"[^>]*data-sp-seg="active"|data-sp-seg="active"/.test(p1) && /data-sp-act="add"/.test(p1) && p1.includes('SCRIBE v3.2'), '2-20: the nav shows the Pending count, the add control and the standards version');
  assert(!/data-sp-act="add"/.test(pane({ view: { counts: {}, active: [], pending: [], examples: [], lore: [], players: [], canEdit: false, pilot: true } })), '2-21: no add control for a caller who cannot edit');
  assert(/sp-skel/.test(pane({ status: 'loading', view: null })) && /Pending 4/.test(pane({ status: 'loading', view: null, cached: { pending: 4 } })), '2-22: loading is a skeleton, with the cached pending count already on the tab');
  assert(/data-sp-act="retry"/.test(pane({ status: 'error' })) && /Only the commissioner/.test(pane({ status: 'denied' })) && /paused/.test(pane({ status: 'paused' })), '2-23: error offers Retry; denied and paused say so in words');
  assert(/SCRIBE is running on its written standards alone/.test(pane({})) && /Nothing waiting/.test(pane({ seg: 'pending' })) && /No player notes yet/.test(pane({ seg: 'players' })) && /No changes yet/.test(pane({ seg: 'history' })),
    '2-24: every segment has a worded empty state');
  const withLore = V.activeSegmentHTML({ active: [], examples: [], lore: [{ key: 'CFP 2K25', text: 'Kihoon won.', updatedAt: '2026-10-01T00:00:00Z' }], canEdit: true, pilot: true, counts: { active: 1 } }, deps);
  const loreNonPilot = V.activeSegmentHTML({ active: [activeRow()], examples: [], lore: [{ key: 'K', text: 'T' }], canEdit: true, pilot: false, counts: { active: 1 } }, deps);
  assert(withLore.includes('League lore') && withLore.includes('CFP 2K25') && !loreNonPilot.includes('League lore'), '2-25: the lore section shows for the pilot league and not otherwise');
  const standards = V.standardsSheetBodyHTML(standardsMod.SCRIBE_STANDARDS, { heat: 'Dry', participation: 'Balanced', learning: 'Normal' }, deps);
  assert(standards.includes('Version 3.2') && standards.includes('Never fabricates stats.') && standards.includes('Quiet 0') && standards.includes('Heat: <strong>Dry</strong>') && !/<textarea|<input/.test(standards),
    '2-26: the Standards sheet is read-only text — the version, the hard rules, the dials in this league, no field');
  const addCorr = V.addSheetBodyHTML({ tab: 'instruction', category: 'brevity', text: 'x', correcting: { kind: 'instruction', id: 'a' }, invalid: false }, deps, { players: [] });
  assert(!/data-sp-tab=/.test(addCorr) && /disabled/.test(addCorr) && />Save correction</.test(addCorr), '2-27: correcting hides the type tabs, locks the category and says "Save correction"');
  const addInvalid = V.addSheetBodyHTML({ tab: 'instruction', category: 'brevity', text: '', invalid: true }, deps, { players: [] });
  const addBusy = V.addSheetBodyHTML({ tab: 'instruction', category: 'brevity', text: 'x', busy: true, invalid: false }, deps, { players: [] });
  assert(/id="sp-submit"[^>]*disabled/.test(addInvalid) && /aria-busy="true"/.test(addBusy) && /Adding…/.test(addBusy) && (addBusy.match(/disabled/g) || []).length >= 4, '2-28: Add is disabled while invalid; busy disables every field and reads "Adding…"');
  const addNoLore = V.addSheetBodyHTML({ tab: 'instruction', category: 'brevity', text: 'x', invalid: false }, deps, { players: [], pilot: false });
  assert(!/data-sp-tab="lore"/.test(addNoLore) && /data-sp-tab="fact"/.test(addNoLore), '2-29: a non-pilot caller is not offered the lore tab');
  const entry = V.entryCardHTML({ active: 12, pending: 3 }, deps);
  assert(entry.includes('data-comm-tab="scribe"') && entry.includes('12 active') && entry.includes('3 waiting for review') && entry.includes('sp-pill-count') && entry.includes('id="scribe-profile-open"'),
    '2-30: the entry card lives in the SCRIBE tab (RG-10), shows both counts and a count pill when anything is pending');
  assert(!V.entryCardHTML({ active: 0, pending: 0 }, deps).includes('sp-pill-count'), '2-31: …and no pill when nothing is pending');
  assert(/&lt;|&amp;/.test(V.pendingRowHTML(pendingRow({ text: 'a & b < c' }), deps)) && V.SP_COPY.errors.held_for_review.length > 20, '2-32: ordinary punctuation is escaped, and the closed error set carries the held-for-review sentence');
  const srcView = stripComments(read('js/scribe-profile-view.js'));
  assert(!/\son(click|error|load)\s*=/.test(srcView) && !/javascript:/.test(srcView) && !/innerHTML\s*=/.test(srcView) && !/style="[^"]*#[0-9a-fA-F]{3,6}/.test(srcView),
    '2-33: the markup module has no inline handler, no javascript: URL, no innerHTML write and no hardcoded colour');
  assert(/min-height:44px/.test(read('css/styles.css').match(/^\.sp-btn\{[^}]*\}/m)?.[0] || '') && /min-height:44px/.test(read('css/styles.css').match(/^\.sp-seg-btn\{[^}]*\}/m)?.[0] || ''),
    '2-34: the stylesheet gives Approve / Reject / Retry (.sp-btn) and the segments a 44 pt minimum');

  // ── B1: the detail sheet's actions come from the row's own flags ──
  const sheetAuto = V.ruleDetailSheetBodyHTML(activeRow({ autoApplied: true, keepable: true, correctable: true }), [], deps, { canEdit: true });
  const sheetHuman = V.ruleDetailSheetBodyHTML(activeRow({ humanApproved: true, origin: 'human', keepable: false, correctable: true }), [], deps, { canEdit: true });
  const sheetFactual = V.ruleDetailSheetBodyHTML(activeRow({ category: 'factual', keepable: true, correctable: false }), [], deps, { canEdit: true });
  assert(/data-sp-act="detail-keep"/.test(sheetAuto) && /data-sp-act="detail-correct"/.test(sheetAuto) && /data-sp-act="detail-toggle"[^>]*>Turn off</.test(sheetAuto) && sheetAuto.includes('Keep it and it stays until you turn it off'),
    '2-35: B1 — an auto-applied rule\'s detail sheet offers Keep, Correct and Turn off, and says what Keep does');
  assert(!/detail-keep/.test(sheetHuman) && /detail-correct/.test(sheetHuman) && /detail-toggle/.test(sheetHuman), '2-36: …a rule a person already approved has no Keep');
  assert(/detail-keep/.test(sheetFactual) && !/detail-correct/.test(sheetFactual), '2-37: N4 — Correct is HIDDEN for a rule with no writable category (the Trainer\'s `factual`): no dead end');
  const keeping = V.ruleDetailSheetBodyHTML(activeRow({ keepable: true }), [], deps, { canEdit: true, keep: { phase: 'saving' } });
  const keepFailed = V.ruleDetailSheetBodyHTML(activeRow({ keepable: true }), [], deps, { canEdit: true, keep: { phase: 'failed', message: 'KEEP_REFUSED' } });
  assert(/detail-keep"[^>]*disabled[^>]*aria-busy="true"[^>]*>Keeping…</.test(keeping) && /role="alert">KEEP_REFUSED/.test(keepFailed) && /detail-keep"[^>]*>Retry</.test(keepFailed), '2-38: Keep has its own busy and failed states');
  assert(!/detail-/.test(V.ruleDetailSheetBodyHTML(activeRow({ keepable: true, correctable: true }), [], deps, { canEdit: false })), '2-39: a read-only caller\'s detail sheet has no action');
  const notLiveSheet = V.ruleDetailSheetBodyHTML(activeRow({ live: false, keepable: true, capBlocked: true }), [], deps, { canEdit: true });
  assert(/detail-keep"[^>]*disabled/.test(notLiveSheet) && notLiveSheet.includes('SCRIBE follows up to 15 rules. Turn one off first.'), '2-40: B3 — at the cap, Keep on a rule that is NOT in use is disabled and says why');
  assert(V.activeRowHTML(activeRow({ live: false, humanApproved: false }), deps).includes('tap Keep to keep it for good'), '2-41: the "not in use" line names the real action: "tap Keep to keep it for good"');

  // ── B1: the collapsed "Turned off" group and Turn on ──
  const offRow = (over = {}) => pendingRow({ id: 'lrn_off', status: 'superseded', text: 'OFF_RULE', origin: 'trainer', ...over });
  const segOff = (showOff, rows = [offRow()]) => V.activeSegmentHTML({ active: [activeRow()], turnedOff: rows, examples: [], lore: [], canEdit: true, pilot: true, counts: { active: 1 } }, deps, { showOff });
  const closed = segOff(false), open = segOff(true);
  assert(/Turned off \(1\)/.test(closed) && /aria-expanded="false"/.test(closed) && !closed.includes('OFF_RULE') && !/turn-on/.test(closed) && /id="sp-off-list" hidden/.test(closed),
    '2-42: B1 — "Turned off (n)" is COLLAPSED by default: the count shows, no rule and no Turn on');
  assert(/aria-expanded="true"/.test(open) && open.includes('OFF_RULE') && /data-sp-act="turn-on"[^>]*>Turn on</.test(open) && /Turned off · /.test(open),
    '2-43: …open, each rule shows its text, where it came from and a Turn on button');
  assert(!/Turned off/.test(V.activeSegmentHTML({ active: [activeRow()], turnedOff: [], examples: [], lore: [], canEdit: true, pilot: true, counts: { active: 1 } }, deps)), '2-44: no group when nothing is turned off');
  const offCap = V.turnedOffRowHTML(offRow({ capBlocked: true }), deps);
  assert(/turn-on"[^>]*disabled/.test(offCap) && offCap.includes('SCRIBE follows up to 15 rules. Turn one off first.'), '2-45: B3 — at the cap Turn on is disabled with the sentence');
  const offSaving = V.turnedOffRowHTML(offRow({ ui: { phase: 'saving' } }), deps), offFailed = V.turnedOffRowHTML(offRow({ ui: { phase: 'failed' } }), deps);
  assert(/turn-on"[^>]*disabled[^>]*aria-busy="true"[^>]*>Saving…</.test(offSaving) && /role="alert"/.test(offFailed) && /turn-on"[^>]*>Retry</.test(offFailed), '2-46: Turn on has the saving and failed states');

  // ── B3 / S2: a Pending row at the cap, and one with nothing left to replace ──
  const capped = V.pendingRowHTML(pendingRow({ capBlocked: true }), deps);
  const cappedReplace = V.pendingRowHTML(pendingRow({ capBlocked: true, replaces: 'x', replacesText: 'Old', replacesActive: true }), deps);
  assert(/sp-approve"[^>]*disabled/.test(capped) && capped.includes('SCRIBE follows up to 15 rules. Turn one off first.') && /sp-reject"(?![^>]*disabled)/.test(capped), '2-47: B3 — at the cap a plain proposal\'s Approve is disabled with the sentence, and Reject stays available');
  assert(!/sp-approve"[^>]*disabled/.test(cappedReplace) && !cappedReplace.includes('SCRIBE follows up to 15 rules'), '2-48: …a REPLACE is net zero and is never cap-blocked');
  const orphan = V.pendingRowHTML(pendingRow({ replaces: 'gone', replacesText: 'Old text', replacesActive: false }), deps);
  assert(!/sp-approve|>Replace<|>Approve</.test(orphan) && /sp-reject/.test(orphan) && orphan.includes('nothing left to replace'), '2-49: S2 — a proposal whose replace target is no longer approved offers REJECT ONLY, with the sentence (no Replace that always fails)');
  const addCap = V.addSheetBodyHTML({ tab: 'instruction', category: 'brevity', text: 'x', invalid: false }, deps, { players: [], atCap: true });
  const addCapCorr = V.addSheetBodyHTML({ tab: 'instruction', category: 'brevity', text: 'x', invalid: false, correcting: { kind: 'instruction', id: 'a' } }, deps, { players: [], atCap: true });
  const addCapFact = V.addSheetBodyHTML({ tab: 'fact', playerId: 'p', key: 'k', value: 'v', invalid: false }, deps, { players: [{ memberId: 'p', name: 'P' }], atCap: true });
  assert(/id="sp-submit"[^>]*disabled/.test(addCap) && addCap.includes('Turn one off first.') && !/id="sp-submit"[^>]*disabled/.test(addCapCorr) && !/id="sp-submit"[^>]*disabled/.test(addCapFact),
    '2-50: B3 — a NEW instruction at the cap cannot be sent and says why; a correction (net zero) and a fact (not a rule) are unaffected');

  // ── S1 / N6 / N2 ──
  const loreSeg = V.activeSegmentHTML({ active: [], turnedOff: [], examples: [], pilot: true, canEdit: true, counts: {}, lore: [{ key: 'K', text: 'T', updatedAt: '2026-10-01T00:00:00Z', addedBy: 'you' }, { key: 'K2', text: 'T2', updatedAt: '2026-10-01T00:00:00Z', addedBy: { name: 'Kevin' } }, { key: 'K3', text: 'T3', updatedAt: '2026-10-01T00:00:00Z', addedBy: '' }] }, deps);
  assert(loreSeg.includes('visible to the whole league') && /Added by you ·/.test(loreSeg) && /Added by Kevin ·/.test(loreSeg) && /sp-meta">Added · /.test(loreSeg),
    '2-51: S1 + N6 — the lore section says it is visible to the whole league, and each entry says who added it per viewer ("Added by you", "Added by Kevin", plain "Added" when the trail does not say)');
  assert(V.addSheetBodyHTML({ tab: 'lore', loreKey: '', loreText: '', invalid: true }, deps, { players: [] }).includes('Every member of the league can read lore.') && !V.activeSegmentHTML({ active: [], turnedOff: [], examples: [], lore: [], pilot: false, canEdit: true, counts: {} }, deps).includes('visible to the whole league'),
    '2-52: S1 — the lore Add help says every member can read it; a non-pilot league (no lore) shows no such line');
  const ruleSrc = read('js/scribe-profile-rules.js'), appRaw = read('js/app.js'), viewRaw = read('js/scribe-profile-view.js');
  assert((ruleSrc.match(/touches safety, a hard line/g) || []).length === 1 && !/touches safety, a hard line/.test(stripComments(viewRaw)) && !/touches safety, a hard line/.test(stripComments(appRaw)),
    '2-53: N2 — the held-for-review words exist in ONE place (js/scribe-profile-rules.js); the view and the app only import them');
  assert(/HOLD_BADGE_LABEL/.test(stripComments(viewRaw)) && !/\u26A0\uFE0F?\s*held for review/.test(stripComments(viewRaw)) && /SCRIBE_HOLD_BADGE_LABEL = HOLD_BADGE_LABEL/.test(appRaw) && /SCRIBE_HOLD_BADGE_REASON = HOLD_BADGE_REASON/.test(appRaw) && /confirm\(HOLD_CONFIRM\)/.test(stripComments(appRaw)),
    '2-53b: N2 — the view imports the badge label (no literal ⚠ held for review badge in the markup module) and the app\'s exported badge constants ARE the shared ones');
  assert(V.SP_COPY.held === rules.HOLD_BADGE_LABEL && V.SP_COPY.heldWhy.includes(rules.HOLD_BADGE_REASON) && V.SP_COPY.toast.addedHeld.includes(rules.HOLD_BADGE_REASON) && V.SP_COPY.errors.held_for_review.includes(rules.HOLD_BADGE_REASON) && rules.HOLD_CONFIRM.includes(rules.HOLD_BADGE_REASON),
    '2-54: …and the badge, its reason, the held toast, the refusal sentence and the approve confirmation are all built from those constants');
  assert(rules.RULE_CAP_MESSAGE === 'SCRIBE follows up to 15 rules. Turn one off first.' && V.SP_COPY.errors.rule_cap_reached === rules.RULE_CAP_MESSAGE && V.SP_COPY.capNote === rules.RULE_CAP_MESSAGE,
    '2-55: B3 — the cap sentence is one string, in the rules module, and the pane\'s note, its error vocabulary and the server\'s code all say it');
  assert(V.SP_COPY.ruleChanged === 'That rule changed somewhere else. The list is up to date.' && !/try again/i.test(V.SP_COPY.ruleChanged) && /showToast\(SPV\.SP_COPY\.ruleChanged, 'error'\)/.test(appRaw),
    '2-55b: reviewer ruling (batch 3b) — a rule decided or changed elsewhere says so and that the list is current, with no "try again" (there is nothing to retry); the pane toasts exactly this sentence');
  assert(V.historySentence({ actor: 'you', verb: 'corrected', kind: 'learning', text: 'NEW' }) === 'You corrected: NEW' && V.historySentence({ actor: 'you', verb: 'replaced', kind: 'learning', text: 'NEW' }) === 'You replaced a rule with: NEW',
    '2-56: N1 — a folded entry reads as one sentence');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] scribe-profile-client — the one call, no identity in it…');
{
  const auth = await import('./js/auth.js');
  const storage = await import('./js/storage.js');
  void storage;
  const invokes = [];
  let behavior = null;
  const fakeClient = { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } }, functions: { invoke: async (name, opts) => { invokes.push({ name, opts }); return behavior(name, opts); } } };
  globalThis.supabase = { createClient: () => fakeClient };
  auth._resetAuthForTest?.();
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
  auth._setMembershipsForTest([{ leagueId: 'L-CLIENT', memberId: 'p1', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB', pilot: true }]);
  await quiet(() => auth.setActiveLeagueId('L-CLIENT'));
  const { callScribeProfile, describeProfileError, newRequestId } = client;
  behavior = async () => ({ data: { ok: true, counts: { active: 1 } }, error: null });
  const ok = await callScribeProfile('add_instruction', { requestId: 'r1', category: 'brevity', text: 'Short.' });
  assert(ok.ok === true && ok.data.counts.active === 1 && invokes[0].name === 'scribe-profile', '3-1: a 200 resolves { ok:true, data } through functions.invoke("scribe-profile")');
  const body = invokes[0].opts.body;
  assert(body.action === 'add_instruction' && body.league_id === 'L-CLIENT' && body.requestId === 'r1' && body.text === 'Short.', '3-2: the body carries the action, the league id (a claim, not an identity) and the action\'s own fields');
  const forbidden = ['memberId', 'member_id', 'role', 'isAdmin', 'userId', 'user_id', 'actor', 'p_member', 'callerMemberId'];
  assert(!forbidden.some((k) => k in body), '3-3: NO identity, role or permission is sent — the function reads none of them off the body');
  const srcClient = stripComments(read('js/scribe-profile-client.js'));
  assert(!forbidden.some((k) => srcClient.includes(k)) && !/access_token|Authorization|getSession/.test(srcClient), '3-4: the client module never names an identity field and never touches a token (supabase-js attaches the session itself)');
  const httpErr = (status, json) => ({ data: null, error: { context: { status, json: async () => json } } });
  behavior = async () => httpErr(400, { ok: false, error: 'held_for_review' });
  const r1 = await callScribeProfile('add_instruction', {});
  assert(r1.ok === false && r1.error === 'held_for_review' && r1.status === 400, '3-5: a non-2xx is read off the function\'s own JSON body (the named refusal, with its status)');
  behavior = async () => ({ data: null, error: { context: { status: 500, json: async () => { throw new Error('not json'); } } } });
  assert((await callScribeProfile('view')).error === 'network', '3-6: an unreadable error body is "network"');
  behavior = async () => { throw new Error('boom'); };
  assert((await callScribeProfile('view')).error === 'network', '3-7: a thrown call is "network"');
  behavior = async () => ({ data: null, error: null });
  assert((await callScribeProfile('view')).error === 'network', '3-8: an empty answer is "network", never a silent success');
  behavior = async () => ({ data: { ok: false, error: 'not_commissioner' }, error: null });
  assert((await callScribeProfile('view')).error === 'not_commissioner', '3-9: a 200 whose envelope says ok:false is a failure with the envelope\'s code');
  behavior = async () => ({ data: { ok: true, skipped: 'league_paused' }, error: null });
  const sk = await callScribeProfile('view');
  assert(sk.ok === false && sk.skipped === 'league_paused', '3-10: a paused league resolves as a skip the pane can word');
  auth._resetAuthForTest?.();
  const none = await callScribeProfile('view');
  assert(none.ok === false && none.error === 'network', '3-11: with no client or no active league there is no request at all');
  const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
  assert(ids.size === 50 && [...ids].every((i) => rules.isRequestId(i)), '3-12: request ids are unique and always pass the function\'s own id check');
  assert(describeProfileError('held_for_review', 'x') === view.SP_COPY.errors.held_for_review && describeProfileError('weird', 'fallback') === 'fallback' && describeProfileError('constructor', 'fb') === 'fb',
    '3-13: a known code has its sentence; an unknown one (including an Object.prototype name) gets the surface\'s own fallback');
  delete globalThis.supabase;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] scribe-standards — the written standards digest…');
{
  const S = standardsMod.SCRIBE_STANDARDS;
  assert(S.version === persona.SCRIBE_VERSION && S.version === '3.2',
    `4-1: DI-647 — the digest is of the SAME version as the persona (digest ${S.version}, persona ${persona.SCRIBE_VERSION}); when SCRIBE.md moves, this goes red until the digest is revisited`);
  assert(S.hardRules.length === 9 && S.hardRules.every((r, i) => r.n === i + 1 && r.headline && r.detail), '4-2: all nine "never" rules, numbered, each with a headline and detail');
  const r6 = S.hardRules[5];
  assert(/live score/i.test(r6.detail) && /never one from memory/i.test(r6.detail) && /never carries a pick that is not yet public/i.test(r6.detail), '4-3: rule 6 carries the v3.2 live-score permission with its limits');
  assert(JSON.stringify(S.dials.participation.deadlineCalloutsPerLock) === JSON.stringify({ quiet: 0, reserved: 1, balanced: 1, active: 2, unhinged: 2 }), '4-4: the deadline-step ceilings are Quiet 0, Reserved 1, Balanced 1, Active 2, Unhinged 2');
  assert(S.triggers.some((t) => /Deadline step/.test(t) && /Quiet 0, Reserved 1, Balanced 1, Active 2, Unhinged 2/.test(t)) && S.triggers.some((t) => /Non-participation/.test(t) && /never from message text/i.test(t)) && S.triggers.some((t) => /timer alone is never a trigger/i.test(t)),
    '4-5: the deadline-step trigger, the non-participation trigger (collected data only) and "a timer alone is never a trigger" are all stated');
  assert(JSON.stringify(S.dials.heat.levels) === JSON.stringify(['Polite', 'Dry', 'Spicy', 'Savage', 'No Mercy']) && JSON.stringify(S.dials.participation.levels) === JSON.stringify(['Quiet', 'Reserved', 'Balanced', 'Active', 'Unhinged']),
    '4-6: the heat and participation levels are the ones the dials show');
  let changed = false;
  try { 'use strict'; S.version = '9'; S.hardRules[0].headline = 'x'; S.hardRules.push({}); } catch { changed = true; }
  assert(changed || (S.version === '3.2' && S.hardRules.length === 9), '4-7: the digest is deeply frozen — an editable standard would be the opposite of what the sheet says');
  assert(Object.isFrozen(S) && Object.isFrozen(S.hardRules) && Object.isFrozen(S.hardRules[0]) && Object.isFrozen(S.dials.participation.deadlineCalloutsPerLock), '4-8: frozen at every depth');
  const docs = (() => { try { return readFileSync(join(__dirname, '..', 'docs', 'SCRIBE.md'), 'utf8'); } catch { return ''; } })();
  assert(!docs || (/Quiet 0, Reserved 1, Balanced 1, Active 2, Unhinged 2/.test(docs) && /Never comments on picks while the slate is open/.test(docs)), '4-9: the digest\'s ceilings and rule 9 still appear in docs/SCRIBE.md (skipped if the doc is not beside the app)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] THE PANE — a fake DOM, the REAL adapter, and a fake `scribe-profile` server (Supabase data mode, the pilot league, a commissioner)…');
{
  const auth = await import('./js/auth.js');
  const sb = await import('./js/supabase-backend.js');
  const storage = await import('./js/storage.js');
  const app = await import('./js/app.js');
  const L = 'L-PANE';
  const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const H = 3600 * 1000;
  const lrow = (ord, id, kind, status, payload, origin = 'trainer', createdAt = at(30 * H)) => ({ league_id: L, id, ord, run_id: 'r5', kind, status, origin, created_at: createdAt,
    payload: { kind, runId: 'r5', status, origin, createdAt, confidence: 0.9, ...payload } });
  const srv = {
    scribe_learnings: [
      lrow(0, 'lrn_act_trainer', 'learning', 'approved', { learningId: 'lrn_act_trainer', category: 'brevity', instruction: 'ACTIVE_TRAINER_RULE', confidence: 0.95 }, 'trainer', at(2 * H)),
      lrow(1, 'lrn_act_old', 'learning', 'approved', { learningId: 'lrn_act_old', category: 'humor', instruction: 'ACTIVE_OLD_RULE', confidence: 0.95 }),
      lrow(2, 'lrn_act_human', 'learning', 'approved', { learningId: 'lrn_act_human', category: 'callbacks', instruction: 'ACTIVE_HUMAN_RULE', confidence: 1, approvedBy: 'p1', approvedAt: at(5 * H) }, 'human'),
      lrow(3, 'lrn_pend', 'learning', 'pending', { learningId: 'lrn_pend', category: 'frequency', instruction: 'PENDING_ONE', confidence: 0.8 }),
      lrow(4, 'lrn_pend_hostile', 'learning', 'pending', { learningId: 'lrn_pend_hostile', category: 'roast_intensity', instruction: 'PENDING_HOSTILE', confidence: 0.8, flaggedHostile: true }),
      lrow(5, 'lrn_repl_new', 'learning', 'pending', { learningId: 'lrn_repl_new', category: 'humor', instruction: 'REPLACEMENT_RULE', confidence: 0.8, replaces: 'lrn_act_old' }),
      lrow(6, 'sl_exp', 'experiment', 'pending', { experiment: 'AN_EXPERIMENT', reason: 'because' }),
      lrow(7, 'lrn_keep_me', 'learning', 'approved', { learningId: 'lrn_keep_me', category: 'target_selection', instruction: 'KEEP_ME_RULE', confidence: 0.95, provisional: true, expiresAt: new Date(Date.now() + 6 * 24 * H).toISOString() }),
      lrow(8, 'lrn_keep_cap', 'learning', 'approved', { learningId: 'lrn_keep_cap', category: 'animation', instruction: 'KEEP_CAP_RULE', confidence: 0.95 }),
    ],
    scribe_canon: [
      { league_id: L, id: 'canon_pend', ord: 0, run_id: 'r7', kind: 'canon', origin: 'trainer', approval_status: 'pending', created_at: at(30 * H),
        payload: { canonId: 'canon_pend', kind: 'canon', contextSummary: 'CANON_CTX', preferredResponse: 'CANON_REPLY', confidence: 0.8, approvalStatus: 'pending', origin: 'trainer', createdAt: at(30 * H) } },
      { league_id: L, id: 'canon_ok', ord: 1, run_id: 'r7', kind: 'canon', origin: 'trainer', approval_status: 'approved', created_at: at(40 * H),
        payload: { canonId: 'canon_ok', kind: 'canon', contextSummary: 'OK_CTX', preferredResponse: 'OK_REPLY', confidence: 0.9, approvalStatus: 'approved', origin: 'trainer', createdAt: at(40 * H) } },
    ],
  };
  const mem = [
    { subject_member_id: 'p1', kind: 'fact', key: 'Pick style', value: 'Takes underdogs.', provenance: 'commissioner-set', created_at: at(80 * H) },
    { subject_member_id: 'p1', kind: 'hardline', key: 'h1', value: 'PRIVATE_BOUNDARY_TEXT' },
    { subject_member_id: 'p2', kind: 'fact', key: 'Team', value: 'Purdue.', provenance: 'computed', created_at: at(80 * H) },
    { id: 'mem_lore_1', subject_member_id: null, kind: 'lore', key: 'CFP 2K25', value: 'Kihoon won.', provenance: 'commissioner-set', refreshed_at: at(70 * H) },
  ];
  const members = [{ id: 'p1', display_name: 'Drew' }, { id: 'p2', display_name: 'Kevin' }];
  const names = { p1: 'Drew', p2: 'Kevin' };

  // ── the fake adapter server (the learntest [23] builder, plus: it records every select, and it mimics 0052's guard — approving a replacement retires the old row)
  const log = [];
  const selects = { scribe_learnings: 0, scribe_canon: 0 };
  let gate = null;
  let failUpdates = null;
  const builder = (table) => {
    const b = { _op: 'select', _eq: [], _count: false, _payload: null };
    b.select = (cols, opts) => { if (opts && opts.count) b._count = true; return b; };
    b.eq = (c, v) => { b._eq.push([c, v]); return b; };
    for (const m of ['order', 'limit', 'gt', 'gte', 'lt', 'lte', 'range', 'in', 'is', 'neq']) b[m] = () => b;
    b.update = (patch) => { b._op = 'update'; b._payload = patch; return b; };
    b.insert = () => { b._op = 'insert'; return b; };
    const run = async () => {
      const rows = (srv[table] || []).filter((r) => b._eq.every(([c, v]) => r[c] === v));
      if (b._op === 'select') { if (table in selects) selects[table] += 1; return { data: rows.map((r) => JSON.parse(JSON.stringify(r))), error: null, count: b._count ? rows.length : null }; }
      if (b._op === 'insert') return { data: null, error: { code: '42501', message: `permission denied for table ${table}` } };
      if (gate) await gate;
      if (failUpdates) return { data: null, error: failUpdates };
      for (const r of rows) {
        const wasStatus = r.status;
        // THE GUARD (migration 0052), emulated: a transition to approved under the commissioner's JWT stamps human approval, a Replace retires its target and renames replaces -> replacedId,
        // and the 16th live rule is refused (rule_cap_reached) with the row untouched.
        if (table === 'scribe_learnings' && b._payload.status === 'approved' && wasStatus !== 'approved') {
          const others = srv.scribe_learnings.filter((x) => x.id !== r.id && x.id !== r.payload.replaces && x.kind === 'learning' && x.status === 'approved' && rules.isLearningLive(x.payload, 'approved'));
          if (r.kind === 'learning' && others.length >= 15) return { data: null, error: { code: '23514', message: 'rule_cap_reached' } };
          // …and a Replace whose target is no longer an approved learning is refused too (0052: replaces_invalid, 22023), the row untouched.
          if (r.payload.replaces) {
            const target = srv.scribe_learnings.find((x) => x.id === r.payload.replaces);
            if (!target || target.kind !== 'learning' || target.status !== 'approved') return { data: null, error: { code: '22023', message: 'replaces_invalid' } };
          }
        }
        Object.assign(r, b._payload);
        r.payload = { ...r.payload, ...(table === 'scribe_learnings' ? { status: r.status } : { approvalStatus: r.approval_status }) };
        log.push({ op: 'update', table, id: r.id, to: b._payload.status || b._payload.approval_status });
        if (table === 'scribe_learnings' && b._payload.status === 'approved' && wasStatus !== 'approved') {
          r.payload = { ...r.payload, approvedBy: 'p1', approvedAt: new Date().toISOString(), provisional: false };
          if (r.payload.replaces) {
            const old = srv.scribe_learnings.find((x) => x.id === r.payload.replaces);
            if (old && old.status === 'approved') { old.status = 'superseded'; old.payload = { ...old.payload, status: 'superseded' }; log.push({ op: 'guard-retire', id: old.id }); }
            const { replaces, ...rest } = r.payload; r.payload = { ...rest, replacedId: replaces };
          }
        }
      }
      return { data: rows.map((r) => JSON.parse(JSON.stringify(r))), error: null };
    };
    b.then = (res, rej) => run().then(res, rej);
    return b;
  };

  // ── the fake `scribe-profile` function: builds its answers from the SAME server state with the SAME shapers the real function uses
  const fnCalls = [];
  let fnGate = null;
  let fnFail = null;                  // action -> { status, error } to refuse
  const seenRequests = new Map();
  const fnHandlers = {
    view: () => ({ standards: { version: persona.SCRIBE_VERSION }, lastChangeAt: null, canEdit: true, pilot: true,
      ...rules.buildProfileView({ learningRows: srv.scribe_learnings, canonRows: srv.scribe_canon, memory: mem, members, names, pilot: true, callerMemberId: 'p1', actors: { mem_lore_1: 'p1' } }) }),
    history: () => ({ entries: [{ at: at(2 * H), actor: 'trainer', verb: 'auto-applied', kind: 'learning', category: 'brevity', rowId: 'lrn_act_trainer', text: 'ACTIVE_TRAINER_RULE' }], cursor: null, more: false }),
    add_instruction: (b) => {
      if (seenRequests.has(b.requestId)) return { ...seenRequests.get(b.requestId), replayed: true };
      const flagged = /DIVORCE/.test(b.text);
      const id = `lrn_h_${b.requestId}`;
      srv.scribe_learnings.push(lrow(srv.scribe_learnings.length, id, 'learning', flagged ? 'pending' : 'approved',
        { learningId: id, category: b.category, instruction: b.text, confidence: 1, flaggedHostile: flagged, ...(flagged ? {} : { approvedBy: 'p1', approvedAt: at(0) }) }, 'human', at(0)));
      const out = { id, status: flagged ? 'pending' : 'approved', replayed: false, flagged };
      seenRequests.set(b.requestId, out);
      return out;
    },
    correct_instruction: (b) => fnHandlers.add_instruction(b),
    add_fact: (b) => { mem.push({ subject_member_id: b.playerId, kind: 'fact', key: b.key, value: b.value, provenance: 'commissioner-set', created_at: at(0) }); return { playerId: b.playerId, key: b.key, replaced: false }; },
    remove_fact: (b) => { const i = mem.findIndex((m) => m.subject_member_id === b.playerId && m.kind === 'fact' && m.key === b.key); if (i >= 0) mem.splice(i, 1); return { playerId: b.playerId, key: b.key, removed: i >= 0 ? 1 : 0 }; },
    add_lore: (b) => { mem.push({ id: `mem_${b.key}`, subject_member_id: null, kind: 'lore', key: b.key, value: b.text, provenance: 'commissioner-set', refreshed_at: at(0) }); return { key: b.key }; },
    keep: (b) => {
      const r = srv.scribe_learnings.find((x) => x.id === b.id);
      if (!r || r.status !== 'approved') return { __http: true, status: 404, error: 'not_keepable' };
      if (rules.isLearningLive(r.payload, 'approved') ? false : srv.scribe_learnings.filter((x) => x.id !== r.id && x.kind === 'learning' && x.status === 'approved' && rules.isLearningLive(x.payload, 'approved')).length >= 15) return { __http: true, status: 409, error: 'rule_cap_reached' };
      if (!trainerRules.isHumanApproved(r.payload)) r.payload = { ...r.payload, approvedBy: 'p1', approvedAt: new Date().toISOString(), provisional: false };
      return { id: b.id, kept: true, already: false };
    },
    correct_lore: (b) => { const m = mem.find((x) => x.kind === 'lore' && x.key === b.key); if (m) m.value = b.text; return { key: b.key }; },
    remove_lore: (b) => { const i = mem.findIndex((x) => x.kind === 'lore' && x.key === b.key); if (i >= 0) mem.splice(i, 1); return { key: b.key, removed: i >= 0 ? 1 : 0 }; },
  };
  const fakeClient = {
    from: (t) => builder(t), rpc: async () => ({ data: [], error: null }),
    auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
    functions: {
      invoke: async (name, { body }) => {
        fnCalls.push({ name, body: JSON.parse(JSON.stringify(body)) });
        if (fnGate) await fnGate;
        const refuse = fnFail && fnFail[body.action];
        if (refuse) return { data: null, error: { context: { status: refuse.status || 400, json: async () => ({ ok: false, error: refuse.error }) } } };
        if (fnFail && fnFail.__skip) return { data: { ok: true, skipped: fnFail.__skip }, error: null };
        const h = fnHandlers[body.action];
        if (!h) return { data: null, error: { context: { status: 400, json: async () => ({ ok: false, error: 'bad_action' }) } } };
        const out = h(body);
        if (out && out.__http) return { data: null, error: { context: { status: out.status, json: async () => ({ ok: false, error: out.error }) } } };
        return { data: { ok: true, ...out }, error: null };
      },
    },
  };
  globalThis.supabase = { createClient: () => fakeClient };
  const srvRow = (id) => srv.scribe_learnings.find((r) => r.id === id) || srv.scribe_canon.find((r) => r.id === id);
  const holdOpen = () => { let release; const g = new Promise((r) => { release = r; }); return { g, release }; };
  const until = async (pred, label, ms = 2500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await tick(); } console.error('   (timed out waiting for:', label, ')'); return false; };

  // ── DOM helpers
  const toasts = [];
  const toastBox = fakeDom.mk('div'); toastBox.id = 'toast-container';
  toastBox.appendChild = (t) => { toasts.push({ cls: t.className, html: t.innerHTML, el: t }); return t; };
  fakeDom.register('toast-container', toastBox);
  const ov = () => fakeDom.byId('scribe-profile-overlay');
  const wrap = () => fakeDom.byId('scribe-profile-sheet-wrap');
  const sheetBody = () => (fakeDom.byId('scribe-profile-sheet-body') || {}).innerHTML || '';
  const panel = () => (ov() ? ov().innerHTML : '');
  const node = (attrs, closestMap = {}) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: (sel) => closestMap[sel] || null });
  const evtPane = ({ seg, act, row, member }) => {
    const rowNode = row ? node({ 'data-sp-id': row.id, 'data-sp-list': row.list || 'learnings' }) : null;
    const actNode = act ? node({ 'data-sp-act': act, 'data-sp-member': member || null }, { '[data-sp-id]': rowNode }) : null;
    const segNode = seg ? node({ 'data-sp-seg': seg }) : null;
    return { target: { closest: (sel) => (sel === '[data-sp-seg]' ? segNode : sel === '[data-sp-act]' ? actNode : null) } };
  };
  const clickPane = (spec) => ov().dispatch('click', evtPane(spec));
  const evtSheet = ({ act, tab, key, lore }) => {
    const loreNode = lore ? node({ 'data-sp-lore': lore }) : null;
    const actNode = act ? node({ 'data-sp-act': act, 'data-sp-key': key || null }, { '[data-sp-lore]': loreNode }) : null;
    const tabNode = tab ? node({ 'data-sp-tab': tab }) : null;
    return { target: { closest: (sel) => (sel === '[data-sp-tab]' ? tabNode : sel === '[data-sp-act]' ? actNode : null) } };
  };
  const clickSheet = (spec) => wrap().dispatch('click', evtSheet(spec));
  const typeInto = (field, value) => wrap().dispatch('input', { target: { getAttribute: (k) => (k === 'data-sp-field' ? field : null), value } });
  const seg = async (name) => { clickPane({ seg: name }); await settle(); };
  const rowChunk = (html, needle) => (html.split('<div class="sp-item"').find((p) => p.includes(needle)) || '');
  const reloadFromServer = async () => { await quiet(() => sb.hydrate(L, { epoch: auth.getIdentityEpoch() })); };

  const pumper = setInterval(() => fakeDom.pump(), 3);
  try {
    localStorage.clear();
    auth._resetAuthForTest?.();
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
    auth._setMembershipsForTest([{ leagueId: L, memberId: 'p1', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB', pilot: true }]);
    await quiet(() => auth.setActiveLeagueId(L));
    auth._setAccountUserIdForTest('u-pane');
    auth._setStoredSessionForTest?.({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    auth._setHasSupabaseDataBackendForTest(true);
    sb._resetForTest();
    sb.init({
      register: auth.registerSupabaseDataBackend, getClient: () => fakeClient, getActiveLeagueId: () => L,
      getIdentityEpoch: auth.getIdentityEpoch, getAccountUserId: auth.getAccountUserId,
      getDeviceDataOwnerTuple: auth.getDeviceDataOwnerTuple, getDeviceDataOwner: auth.getDeviceDataOwner,
      getLeagueName: auth._switchBannerLeagueName, getLeagueNameById: auth._leagueNameById,
      getSession: storage.getSession, hasValidSupabaseSession: auth.hasValidSupabaseSession,
      isPrivilegeHeld: auth.isPrivilegeHeld, hasSheetMirror: auth.hasSheetMirrorOnDevice, isSiteUnlocked: storage.isSiteUnlocked,
    });
    await quiet(() => sb.hydrate(L, { epoch: auth.getIdentityEpoch() }));
    storage.setBackendMode('supabase');
    assert(sb.getState() === 'ACTIVE' && storage.getScribeLearnings().length === 9 && storage.getScribeCanon().length === 2,
      `5-0: fixture — a commissioner over an ACTIVE hydrated adapter holding 9 learnings and 2 canon rows (state ${sb.getState()}, ${storage.getScribeLearnings().length}/${storage.getScribeCanon().length})`);
    assert(JSON.stringify(sb.mirrorRowIds('cfbp_scribe_learnings')) === JSON.stringify(srv.scribe_learnings.map((r) => r.id)),
      '5-0b: mirrorRowIds() returns the SERVER id at every mirror position (the bridge the pane keys decisions by)');

    // ── (1) WHERE THE PANE IS OFFERED ──
    assert(app.scribeProfileAvailable() === true && app.scribeProfileEntryCardHTML().includes('data-comm-card="scribe-profile"'),
      '5-1: Supabase data mode + the pilot league -> the entry card exists');
    const counts = app.scribeProfileCachedCounts();
    assert(counts.pending === 5 && counts.active === 6,
      `5-2: the entry card's counts come from the MIRROR, synchronously: 5 waiting (4 learning-side + 1 canon) and 6 active (5 live rules + 1 example; lore is not counted) (got ${JSON.stringify(counts)})`);
    const trainerOffered = app.renderScribeTrainerAdminSectionHTML();
    assert(trainerOffered.includes('id="scribe-profile-open-from-trainer"') && /<strong>5 waiting for review<\/strong>/.test(trainerOffered)
      && !trainerOffered.includes('Pending review') && !trainerOffered.includes('What SCRIBE has learned') && trainerOffered.includes('scribe-run-trainer-btn') && trainerOffered.includes('scribe-export-learnings-btn') && trainerOffered.includes('scribe-reset-learnings-btn'),
      '5-3: DI-648 — where the pane is offered the Trainer card keeps Run / Export / Reset and gives its two lists to ONE row into the pane');
    auth._setMembershipsForTest([{ leagueId: L, memberId: 'p1', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB', pilot: false }]);
    const trainerLegacy = app.renderScribeTrainerAdminSectionHTML();
    assert(app.scribeProfileAvailable() === false && app.scribeProfileEntryCardHTML() === '' && trainerLegacy.includes('Pending review') && trainerLegacy.includes('What SCRIBE has learned') && !trainerLegacy.includes('scribe-profile-open-from-trainer'),
      '5-4: a non-pilot league gets no entry card and keeps the Trainer card\'s own lists (so there is still a way to approve)');
    auth._setMembershipsForTest([{ leagueId: L, memberId: 'p1', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB', pilot: true }]);

    // ── (2) OPEN: skeleton first (cached count on the tab), then the server's view ──
    let g = holdOpen(); fnGate = g.g;
    const opened = app.openScribeProfilePane();
    await settle(2);
    assert(opened === true && ov() && ov().getAttribute('role') === 'dialog' && ov().getAttribute('aria-modal') === 'true' && ov().hasAttribute('data-hold-teardown'),
      '5-5: opening appends the overlay as a modal dialog, marked for hold teardown');
    assert(fakeDom.chrome.every((e) => e.hasAttribute('inert') && e.getAttribute('aria-hidden') === 'true'), '5-6: the page behind (.main-content, .bottom-nav, .app-header) is inert while the pane is up');
    assert(/sp-skel/.test(panel()) && /Pending 5/.test(panel()) && !/ACTIVE_TRAINER_RULE/.test(panel()),
      '5-7: while the function answers, the pane shows a SKELETON (not a spinner, not the mirror\'s rows) with the cached pending count already on the tab');
    g.release(); fnGate = null;
    await until(() => /ACTIVE_TRAINER_RULE/.test(panel()), 'view painted');
    const firstView = fnCalls.filter((c) => c.body.action === 'view');
    assert(firstView.length === 1 && firstView[0].name === 'scribe-profile' && firstView[0].body.league_id === L && Object.keys(firstView[0].body).sort().join() === 'action,league_id',
      '5-8: exactly ONE view request, carrying only { action, league_id }');
    assert(/ACTIVE_TRAINER_RULE/.test(panel()) && /ACTIVE_OLD_RULE/.test(panel()) && /ACTIVE_HUMAN_RULE/.test(panel()) && /OK_REPLY|OK_CTX/.test(panel()) && /CFP 2K25/.test(panel()) && !/PENDING_ONE/.test(panel()),
      '5-9: Active shows the three live rules, the approved example and the lore entry — and no pending row');
    assert(/You added this/.test(rowChunk(panel(), 'ACTIVE_HUMAN_RULE')) && />Undo</.test(rowChunk(panel(), 'ACTIVE_TRAINER_RULE')) && !/<button[^>]*sp-toggle/.test(rowChunk(panel(), 'ACTIVE_OLD_RULE')) && !/<button[^>]*sp-toggle/.test(rowChunk(panel(), 'ACTIVE_HUMAN_RULE')),
      '5-10: the source line says who made each rule; ONLY the fresh auto-apply has a control on its row (Undo) — an older one and a human\'s have none (B1)');
    assert(/Added by you · /.test(panel()) && /Kihoon won\./.test(panel()) && /visible to the whole league/.test(panel()), '5-10b: N6 + S1 — the lore entry reads "Added by you" (the audit trail names the caller) and the section says it is visible to the whole league');

    // ── (3) THE PENDING SEGMENT ──
    await seg('pending');
    assert(/PENDING_ONE/.test(panel()) && /PENDING_HOSTILE/.test(panel()) && /REPLACEMENT_RULE/.test(panel()) && /AN_EXPERIMENT/.test(panel()) && /CANON_CTX/.test(panel()),
      '5-11: Pending lists the four learning-side proposals and the canon proposal');
    assert(/>Replace</.test(rowChunk(panel(), 'REPLACEMENT_RULE')) && rowChunk(panel(), 'REPLACEMENT_RULE').includes('ACTIVE_OLD_RULE') && /held for review/.test(rowChunk(panel(), 'PENDING_HOSTILE')),
      '5-12: a replacement says Replace and quotes the rule it retires; the flagged one wears the held badge');

    // ── (4) APPROVE: nothing is shown as approved until the SERVER has it ──
    const before = { updates: log.length, views: fnCalls.filter((c) => c.body.action === 'view').length };
    g = holdOpen(); gate = g.g;
    clickPane({ act: 'approve', row: { id: 'lrn_pend' } });
    await settle(4);
    const midRow = rowChunk(panel(), 'PENDING_ONE');
    assert(midRow.includes('Saving…') && /aria-busy="true"/.test(midRow) && (midRow.match(/disabled/g) || []).length >= 2 && srvRow('lrn_pend').status === 'pending'
      && app._scribeProfileStateForTest().view.pending.some((r) => r.id === 'lrn_pend') && !app._scribeProfileStateForTest().view.active.some((r) => r.id === 'lrn_pend'),
      '5-13: PF — mid-save the row is STILL in Pending reading "Saving…" (both buttons disabled) — in the pane\'s state as well as on screen — and the server row is still pending');
    assert(!toasts.some((t) => /Approved/.test(t.html)), '5-14: …and no "Approved" toast has fired');
    g.release(); gate = null;
    await until(() => srvRow('lrn_pend').status === 'approved' && !/PENDING_ONE/.test(panel()), 'row left Pending');
    assert(srvRow('lrn_pend').status === 'approved' && log.length === before.updates + 1 && !/PENDING_ONE/.test(panel()) && toasts.some((t) => /Approved\. SCRIBE follows it/.test(t.html)),
      '5-15: once the server confirms: one write, the row leaves Pending, and only now does the success toast fire');
    await until(() => fnCalls.filter((c) => c.body.action === 'view').length > before.views + 1, 'silent reload');
    await settle(3);
    assert(fnCalls.filter((c) => c.body.action === 'view').length === before.views + 2, '5-16: …the Approve read the view once BEFORE sending (round 3, the freshness check) and reloaded it exactly once silently AFTER (the display\'s truth)');
    await seg('active');
    assert(rowChunk(panel(), 'PENDING_ONE') !== '' && !/sp-toggle/.test(rowChunk(panel(), 'PENDING_ONE')), '5-17: the approved rule now appears under Active (a person approved it: no Undo, no button on the row)');
    assert(/Pending 4/.test(panel()), '5-18: the Pending tab\'s count fell by one');

    // ── (5) A REFUSED SAVE: it stays Pending, says so, and Retry decides again ──
    await seg('pending');
    failUpdates = { code: '42501', message: 'permission denied for table scribe_learnings' };
    const nUpd = log.length;
    clickPane({ act: 'approve', row: { id: 'sl_exp' } });
    await until(() => /Couldn&#39;t save|Couldn't save/.test(rowChunk(panel(), 'AN_EXPERIMENT')), 'failure shown');
    const failedChunk = rowChunk(panel(), 'AN_EXPERIMENT');
    assert(/AN_EXPERIMENT/.test(failedChunk) && /role="alert"/.test(failedChunk) && />Retry</.test(failedChunk) && srvRow('sl_exp').status === 'pending' && log.length === nUpd,
      '5-19: a refused approval leaves the row in Pending with an inline alert and a Retry, the server untouched');
    assert(!toasts.some((t) => /Approved/.test(t.html) && /experiment/i.test(t.html)) && storage.getScribeLearnings()[6].status === 'pending',
      '5-20: …and this device no longer holds it approved either');
    failUpdates = null;
    clickPane({ act: 'approve', row: { id: 'sl_exp' } });                   // what the Retry button does: the same handler
    await until(() => srvRow('sl_exp').status === 'approved', 'retry saved');
    assert(srvRow('sl_exp').status === 'approved', '5-21: Retry makes the same decision and the server confirms it');

    // ── (6) REJECT ──
    clickPane({ act: 'reject', row: { id: 'canon_pend', list: 'canon' } });
    await until(() => srvRow('canon_pend').approval_status === 'rejected', 'canon rejected');
    await settle(3);
    assert(srvRow('canon_pend').approval_status === 'rejected' && !/CANON_CTX/.test(panel()) && toasts.some((t) => /Rejected\. It stays in History/.test(t.html)),
      '5-22: Reject on a canon proposal goes through the same path (id-keyed to the canon list), leaves Pending only after the server has it');

    // ── (7) A FLAGGED PROPOSAL ASKS FIRST ──
    const cNo = setConfirm(false);
    const n2 = log.length;
    clickPane({ act: 'approve', row: { id: 'lrn_pend_hostile' } });
    await settle(3);
    assert(cNo.length === 1 && /safety, a hard line, or a player's real life/.test(cNo[0]) && log.length === n2 && srvRow('lrn_pend_hostile').status === 'pending',
      '5-23: approving a held proposal asks for confirmation, in words; Cancel writes nothing');
    setConfirm(true);
    clickPane({ act: 'approve', row: { id: 'lrn_pend_hostile' } });
    await until(() => srvRow('lrn_pend_hostile').status === 'approved', 'hostile approved');
    assert(srvRow('lrn_pend_hostile').status === 'approved' && getConfirmCalls().length === 1, '5-24: …and OK approves it');

    // ── (8) REPLACE: the new rule goes live and the old one leaves — and the mirror learns it ──
    const selBefore = selects.scribe_learnings;
    clickPane({ act: 'approve', row: { id: 'lrn_repl_new' } });
    await until(() => srvRow('lrn_repl_new').status === 'approved', 'replacement approved');
    await until(() => selects.scribe_learnings > selBefore, 'mirror re-hydrated');
    await settle(4);
    const oldIdx = sb.mirrorRowIds('cfbp_scribe_learnings').indexOf('lrn_act_old');
    assert(srvRow('lrn_act_old').status === 'superseded' && toasts.some((t) => /Replaced\. SCRIBE follows the new one/.test(t.html)),
      '5-25: approving a Replace puts the new rule live, the server retires the old one (guard trigger), and the toast says "Replaced"');
    assert(selects.scribe_learnings > selBefore && storage.getScribeLearnings()[oldIdx].status === 'superseded',
      '5-26: DI-681 — the mirror was re-hydrated after a Replace, so the OLD rule\'s mirror position now reads superseded (a later decision cannot act on a stale "approved")');
    await seg('active');
    assert(/REPLACEMENT_RULE/.test(panel()) && !/ACTIVE_OLD_RULE/.test(panel()), '5-27: Active shows the replacement and no longer shows the rule it retired');

    // ── (9) TURN OFF — from the DETAIL SHEET now (B1), with an Undo in the toast; Undo on the row itself for a fresh auto-apply ──
    g = holdOpen(); gate = g.g;
    clickPane({ act: 'detail', row: { id: 'lrn_act_human' } });
    await settle(3);
    assert(wrap() && /ACTIVE_HUMAN_RULE/.test(sheetBody()) && /data-sp-act="detail-toggle"[^>]*>Turn off</.test(sheetBody()) && /detail-correct/.test(sheetBody()) && !/detail-keep/.test(sheetBody()),
      '5-27b: B1 — the detail sheet of a rule a person approved offers Correct and Turn off, and no Keep');
    clickSheet({ act: 'detail-toggle' });
    await settle(4);
    const offMid = rowChunk(panel(), 'ACTIVE_HUMAN_RULE');
    assert(/Saving…/.test(offMid) && srvRow('lrn_act_human').status === 'approved' && /Saving…/.test(sheetBody()) && /detail-toggle"[^>]*disabled/.test(sheetBody()),
      '5-28: Turn off — mid-save the rule is still listed (row and sheet both read "Saving…", the sheet button disabled) and the server still has it ON');
    g.release(); gate = null;
    await until(() => srvRow('lrn_act_human').status === 'superseded' && !/ACTIVE_HUMAN_RULE/.test(rowChunk(panel(), 'ACTIVE_HUMAN_RULE')), 'turned off');
    const undoToast = toasts.find((t) => /Off\. SCRIBE stops using this/.test(t.html));
    assert(srvRow('lrn_act_human').status === 'superseded' && !/ACTIVE_HUMAN_RULE/.test(panel()) && undoToast && /sp-toast-undo/.test(undoToast.html) && />Undo</.test(undoToast.html),
      '5-29: once the server confirms, the rule leaves Active and the toast says Off AND carries an Undo');
    await until(() => !wrap(), 'sheet closed after turn off');
    assert(/Turned off \(1\)/.test(panel()) && !/ACTIVE_HUMAN_RULE/.test(panel()), '5-29b: B1 — the rule now sits in "Turned off (1)", COLLAPSED (its text is not on screen)');
    // the toast's Undo is a Turn on: the rule comes back, and the database stamps it again
    undoToast.el.querySelector('[data-sp-toast-undo]').dispatch('click', {});
    await until(() => srvRow('lrn_act_human').status === 'approved', 'undo from toast');
    await until(() => /ACTIVE_HUMAN_RULE/.test(panel()), 'rule back in Active');
    assert(srvRow('lrn_act_human').status === 'approved' && srvRow('lrn_act_human').payload.approvedBy === 'p1' && /ACTIVE_HUMAN_RULE/.test(panel()) && !/Turned off \(/.test(panel()),
      '5-29c: the toast\'s Undo turns it back on (the server confirms and stamps it), and the group is gone again');
    clickPane({ act: 'toggle', row: { id: 'lrn_act_trainer' } });
    await until(() => srvRow('lrn_act_trainer').status === 'superseded', 'undo saved');
    assert(srvRow('lrn_act_trainer').status === 'superseded' && !toasts.slice(-1)[0].html.includes('sp-toast-undo'), '5-30: the row\'s own Undo is the same switch (a fresh auto-apply goes off) and its toast carries no second Undo');

    // ── (9b) THE TURNED OFF GROUP: collapsed until opened; Turn on is a human approval ──
    await settle(3);
    assert(/Turned off \(1\)/.test(panel()) && !/ACTIVE_TRAINER_RULE/.test(panel()) && /aria-expanded="false"/.test(panel()), '5-31b: the switched-off rule is counted in the collapsed group');
    clickPane({ act: 'toggle-off-group' });
    await settle(1);
    assert(/aria-expanded="true"/.test(panel()) && /ACTIVE_TRAINER_RULE/.test(panel()) && /data-sp-act="turn-on"/.test(panel()) && /Turned off · /.test(panel()), '5-31c: opening the group lists the rule with where it came from and a Turn on');
    clickPane({ act: 'turn-on', row: { id: 'lrn_act_trainer' } });
    await until(() => srvRow('lrn_act_trainer').status === 'approved', 'turn on');
    await until(() => !/Turned off \(/.test(panel()), 'group emptied');
    const trainerBack = srvRow('lrn_act_trainer');
    assert(trainerBack.status === 'approved' && trainerBack.payload.approvedBy === 'p1' && /ACTIVE_TRAINER_RULE/.test(panel()) && !/data-sp-act="toggle"/.test(rowChunk(panel(), 'ACTIVE_TRAINER_RULE')),
      '5-31d: Turn on goes through the same id-keyed switch, the DATABASE stamps it human-approved, and the rule is back in Active without an Undo (a person approved it)');

    // ── (9c) KEEP: an auto-applied rule that is not yet kept; the stamp is the database's ──
    clickPane({ act: 'detail', row: { id: 'lrn_keep_me' } });
    await settle(3);
    assert(wrap() && /KEEP_ME_RULE/.test(sheetBody()) && /data-sp-act="detail-keep"/.test(sheetBody()) && sheetBody().includes('Keep it and it stays until you turn it off'), '5-31e: B1 — the detail sheet of an auto-applied rule offers Keep and says what it does');
    g = holdOpen(); fnGate = g.g;
    clickSheet({ act: 'detail-keep' });
    await settle(3);
    assert(/detail-keep"[^>]*disabled[^>]*aria-busy="true"[^>]*>Keeping…</.test(sheetBody()) && !trainerRules.isHumanApproved(srvRow('lrn_keep_me').payload), '5-31f: mid-save Keep reads "Keeping…" and the rule is not yet kept on the server');
    g.release(); fnGate = null;
    await until(() => trainerRules.isHumanApproved(srvRow('lrn_keep_me').payload), 'kept');
    await settle(3);
    const keepCall = fnCalls.filter((c) => c.body.action === 'keep');
    assert(keepCall.length === 1 && JSON.stringify(Object.keys(keepCall[0].body).sort()) === JSON.stringify(['action', 'id', 'league_id']) && keepCall[0].body.id === 'lrn_keep_me',
      `5-31g: Keep sends exactly { action, league_id, id } — never a stamp, a member id or a time (got ${JSON.stringify(keepCall[0] && keepCall[0].body)})`);
    assert(toasts.some((t) => /Kept\. SCRIBE follows it until you turn it off/.test(t.html)) && !/detail-keep/.test(sheetBody()) && /You approved this|You added this/.test(rowChunk(panel(), 'KEEP_ME_RULE')),
      '5-31h: once the server confirms: a toast, the sheet no longer offers Keep, and the row reads as approved by you');
    fnFail = { keep: { status: 409, error: 'rule_cap_reached' } };
    clickSheet({ act: 'sheet-cancel' });
    await until(() => !wrap(), 'sheet closed');
    clickPane({ act: 'detail', row: { id: 'lrn_keep_cap' } });
    await settle(3);
    clickSheet({ act: 'detail-keep' });
    await until(() => /SCRIBE follows up to 15 rules\. Turn one off first\./.test(sheetBody()), 'keep refused');
    assert(/role="alert">SCRIBE follows up to 15 rules/.test(sheetBody()) && /detail-keep"[^>]*>Retry</.test(sheetBody()) && !trainerRules.isHumanApproved(srvRow('lrn_keep_cap').payload),
      '5-31i: a refused Keep says why in the closed vocabulary, offers Retry, and nothing is stamped');
    fnFail = null;
    clickSheet({ act: 'sheet-cancel' });
    await until(() => !wrap(), 'sheet closed 2');

    // ── (9d) S3: a sheet slides out on Cancel — it is not removed on the spot ──
    clickPane({ act: 'add' });
    await settle(2);
    clickSheet({ act: 'sheet-cancel' });
    assert(wrap() && wrap().getAttribute('data-closing') === 'slide' && app._scribeProfileStateForTest().sheet === null, '5-31j: S3 — Cancel starts the EXIT (data-closing="slide"): the node stays for the slide and the pane\'s sheet state is already clear');
    await until(() => !wrap(), 'sheet exit finished');
    assert(!wrap(), '5-31k: …and the node is removed when the slide ends');
    {
      const was = globalThis.matchMedia;
      globalThis.matchMedia = () => ({ matches: true });
      clickPane({ act: 'add' });
      await settle(2);
      clickSheet({ act: 'sheet-cancel' });
      assert(wrap() && wrap().getAttribute('data-closing') === 'fade', '5-31l: …with Reduce Motion it is the crossfade, not the slide');
      await until(() => !wrap(), 'sheet fade finished');
      globalThis.matchMedia = was;
    }
    clickPane({ act: 'standards' });
    await settle(2);
    clickSheet({ act: 'sheet-cancel' });
    assert(wrap() && wrap().getAttribute('data-closing') === 'slide', '5-31m: Done on the Standards sheet takes the same exit');
    await until(() => !wrap(), 'standards exit');
    clickPane({ act: 'standards' });
    await settle(2);
    wrap().querySelector('.chat-sheet-backdrop');
    {
      const closeBtn = fakeDom.byId('scribe-profile-sheet-close');
      assert(closeBtn !== null, '5-31n: the sheet carries its ✕');
    }
    [...fakeDom.keydown].filter((f) => f.toString().includes('SP_OVERLAY_ID')).pop()({ key: 'Escape' });
    assert(wrap() && wrap().getAttribute('data-closing') === 'slide', '5-31o: Esc takes the same exit');
    await until(() => !wrap(), 'esc exit');

    // ── (10) A ROW THE MIRROR HAS NOT SEEN: no write, a worded refusal, and a refresh ──
    srv.scribe_learnings.push(lrow(srv.scribe_learnings.length, 'lrn_ghost', 'learning', 'pending', { learningId: 'lrn_ghost', category: 'brevity', instruction: 'GHOST_ROW', confidence: 0.8 }));
    clickPane({ act: 'retry' });
    await settle(4);
    await seg('pending');
    const nGhost = log.length;
    const mirrorHasGhost = () => (sb.mirrorRowIds('cfbp_scribe_learnings') || []).includes('lrn_ghost');
    // the refresh above hydrated the mirror, so the ghost is KNOWN now; make the mirror forget it to model "the server moved first"
    const pre = mirrorHasGhost();
    assert(pre === true, '5-31: the Retry control reloads the list (hydrates the mirror, then asks the function), so a row added elsewhere becomes decidable');
    srv.scribe_learnings.push(lrow(srv.scribe_learnings.length, 'lrn_ghost2', 'learning', 'pending', { learningId: 'lrn_ghost2', category: 'brevity', instruction: 'GHOST_TWO', confidence: 0.8 }));
    await quiet(() => app._scribeProfileReloadViewForTest());            // the function sees it; the mirror has not
    await settle(2);
    assert(/GHOST_TWO/.test(panel()) && !(sb.mirrorRowIds('cfbp_scribe_learnings') || []).includes('lrn_ghost2'), '5-32: fixture — the function lists a row the mirror has not seen');
    clickPane({ act: 'approve', row: { id: 'lrn_ghost2' } });
    await settle(2);
    assert(log.length === nGhost && toasts.some((t) => /out of date/.test(t.html)) && srvRow('lrn_ghost2').status === 'pending',
      '5-33: deciding on it writes NOTHING (the pane will not guess a mirror position) and says the list is out of date');
    await until(() => (sb.mirrorRowIds('cfbp_scribe_learnings') || []).includes('lrn_ghost2'), 'refresh after stale');
    assert((sb.mirrorRowIds('cfbp_scribe_learnings') || []).includes('lrn_ghost2'), '5-34: …and it refreshed itself, so the next tap works');

    // ── (11) HISTORY ──
    const hBefore = fnCalls.filter((c) => c.body.action === 'history').length;
    await seg('history');
    await until(() => /ACTIVE_TRAINER_RULE/.test(panel()) && /Trainer auto-applied/.test(panel()), 'history painted');
    const hAfterFirst = fnCalls.filter((c) => c.body.action === 'history').length;
    assert(hAfterFirst - hBefore <= 1 && /Trainer auto-applied: ACTIVE_TRAINER_RULE/.test(panel()), `5-35: History is asked for at most ONCE on the visit (a detail sheet earlier in the same open may already have asked) and reads as sentences (${hAfterFirst - hBefore} new)`);
    await seg('active'); await seg('history');
    assert(fnCalls.filter((c) => c.body.action === 'history').length === hAfterFirst, '5-36: switching back to a loaded History does not re-ask');

    // ── (12) PLAYERS: facts, and a boundary that is a count ──
    await seg('players');
    assert(/Drew/.test(panel()) && /Kevin/.test(panel()) && /1 boundary/.test(panel()) && !/PRIVATE_BOUNDARY_TEXT/.test(panel()), '5-37: Players lists the roster, counts a boundary, and the boundary\'s text is nowhere in the pane');
    clickPane({ act: 'player', member: 'p1' });
    await settle(2);
    assert(wrap() && /Takes underdogs/.test(sheetBody()) && /Added by you/.test(sheetBody()) && /Roast limit/.test(sheetBody()) && !/PRIVATE_BOUNDARY_TEXT/.test(sheetBody()),
      '5-38: the player sheet shows the facts SCRIBE holds with their source, the roast limit, and still no boundary text');
    clickSheet({ act: 'fact-add' });
    await settle(2);
    typeInto('key', 'Rivalry'); typeInto('value', 'Hates Michigan.');
    clickSheet({ act: 'sheet-submit' });
    await until(() => fnCalls.some((c) => c.body.action === 'add_fact'), 'add_fact sent');
    const af = fnCalls.find((c) => c.body.action === 'add_fact').body;
    assert(JSON.stringify(Object.keys(af).sort()) === JSON.stringify(['action', 'key', 'league_id', 'playerId', 'value']) && af.playerId === 'p1' && af.key === 'Rivalry' && af.value === 'Hates Michigan.',
      '5-39: adding a fact sends exactly { action, league_id, playerId, key, value } — the player is the one whose sheet was open');
    await until(() => !wrap(), 'sheet closed after add');
    assert(!wrap() && toasts.some((t) => /SCRIBE will know it/.test(t.html)), '5-40: on success the sheet closes and the toast says what happens next');
    clickPane({ act: 'player', member: 'p1' });
    await settle(2);
    clickSheet({ act: 'fact-remove', key: 'Rivalry' });
    await until(() => fnCalls.some((c) => c.body.action === 'remove_fact'), 'remove_fact sent');
    assert(JSON.stringify(fnCalls.find((c) => c.body.action === 'remove_fact').body) === JSON.stringify({ playerId: 'p1', key: 'Rivalry', action: 'remove_fact', league_id: L }), '5-41: removing a fact sends { playerId, key } and nothing else');
    await until(() => !/Rivalry/.test(sheetBody()), 'fact gone from sheet');
    assert(!/Rivalry/.test(sheetBody()) && /Takes underdogs/.test(sheetBody()), '5-42: …and only that fact leaves the sheet');
    clickSheet({ act: 'sheet-cancel' });

    // ── (13) ADD AN INSTRUCTION: validation, a held answer, a retry that does not duplicate, then success ──
    await seg('active');
    clickPane({ act: 'add' });
    await settle(2);
    assert(wrap() && /id="sp-submit"/.test(sheetBody()) && /disabled/.test(sheetBody().match(/<button[^>]*id="sp-submit"[^>]*>/)[0]), '5-43: the Add sheet opens with Add disabled while the text is empty');
    const nCalls = fnCalls.length;
    clickSheet({ act: 'sheet-submit' });
    await settle(2);
    assert(fnCalls.length === nCalls, '5-44: submitting an invalid form sends nothing');
    typeInto('text', 'x'.repeat(250));
    assert((fakeDom.byId('sp-submit') || {}).disabled === true, '5-45: over-long text keeps Add disabled (the live counter and the validator agree)');
    typeInto('category', 'humor'); typeInto('text', 'Never mention the DIVORCE thing.');
    assert((fakeDom.byId('sp-submit') || {}).disabled === false, '5-46: valid text enables Add');
    fnFail = { add_instruction: { status: 400, error: 'held_for_review' } };
    clickSheet({ act: 'sheet-submit' });
    await until(() => /touches safety/.test(sheetBody()), 'held answer shown');
    const first = fnCalls.filter((c) => c.body.action === 'add_instruction');
    assert(first.length === 1 && /touches safety, a hard line/.test(sheetBody()) && wrap(), '5-47: a refusal keeps the sheet open and says why, in the closed error vocabulary');
    fnFail = null;
    typeInto('text', 'Never mention the DIVORCE thing, ever.');
    clickSheet({ act: 'sheet-submit' });
    await until(() => !wrap(), 'sheet closed after held add');
    const second = fnCalls.filter((c) => c.body.action === 'add_instruction');
    assert(second.length === 2 && second[0].body.requestId === second[1].body.requestId && rules.isRequestId(second[0].body.requestId),
      '5-48: a retry from the SAME sheet reuses the request id minted when it opened (a double tap or a retry cannot duplicate)');
    assert(JSON.stringify(Object.keys(second[1].body).sort()) === JSON.stringify(['action', 'category', 'league_id', 'requestId', 'text']) && second[1].body.category === 'humor',
      '5-49: the body is exactly { action, league_id, requestId, category, text } — no member id, no role, no `supersedes` on a plain add');
    assert(toasts.some((t) => /Held for review/.test(t.html) && /warning/.test(t.cls)), '5-50: a flagged add is held (the server wrote it PENDING): a warning toast says so');
    await settle(3);
    assert(app._scribeProfileStateForTest().seg === 'pending', '5-51: …and the pane moves to Pending, where the commissioner decides');
    assert(/Never mention the DIVORCE thing, ever\./.test(panel()), '5-52: the held instruction is listed there after the reload');
    await seg('active');
    clickPane({ act: 'add' });
    await settle(2);
    typeInto('text', 'Keep Saturday posts to one line.');
    clickSheet({ act: 'sheet-submit' });
    await until(() => !wrap(), 'plain add closed');
    await until(() => /Keep Saturday posts to one line\./.test(panel()), 'plain add listed');
    assert(/Keep Saturday posts to one line\./.test(rowChunk(panel(), 'Keep Saturday')) && /You added this/.test(rowChunk(panel(), 'Keep Saturday')) && toasts.some((t) => /Added\. SCRIBE will use it from its next post/.test(t.html)),
      '5-53: a plain add is live at once ("You added this"), via a reload from the server');
    const newId = srv.scribe_learnings.find((r) => (r.payload.instruction || '').startsWith('Keep Saturday')).id;
    assert(sb.mirrorRowIds('cfbp_scribe_learnings').includes(newId), '5-54: the added row reached the mirror (hydrated after the add), so Turn off on it can key by position');

    // ── (14) CORRECT: from a rule's detail sheet; the category is locked and `supersedes` names the old row ──
    clickPane({ act: 'detail', row: { id: 'lrn_h_x' } });                       // an id that is not listed: nothing opens
    await settle(1);
    assert(!wrap(), '5-55: tapping a row the pane does not list opens nothing');
    clickPane({ act: 'detail', row: { id: newId } });
    await settle(3);
    assert(wrap() && /Keep Saturday posts to one line\./.test(sheetBody()) && />Correct</.test(sheetBody()) && />Turn off</.test(sheetBody()), '5-56: a rule\'s detail sheet shows its full text with Correct and Turn off');
    clickSheet({ act: 'detail-correct' });
    await settle(2);
    assert(/Save correction/.test(sheetBody()) && !/data-sp-tab=/.test(sheetBody()) && /Keep Saturday posts to one line\./.test(sheetBody()), '5-57: Correct opens the form pre-filled, with the type tabs gone');
    typeInto('text', 'Keep Saturday posts to one short line.');
    clickSheet({ act: 'sheet-submit' });
    await until(() => fnCalls.some((c) => c.body.action === 'correct_instruction'), 'correct sent');
    const cb = fnCalls.find((c) => c.body.action === 'correct_instruction').body;
    assert(cb.supersedes === newId && cb.category === srvRow(newId).payload.category && cb.text === 'Keep Saturday posts to one short line.' && rules.isRequestId(cb.requestId),
      '5-58: a correction sends `supersedes` = the row being corrected, the locked category and the new text');
    await until(() => !wrap(), 'correct closed');
    assert(toasts.some((t) => /Corrected\. The old version stays in History/.test(t.html)), '5-59: …and the toast says the old version stays in History');

    // ── (15) LORE ──
    clickPane({ act: 'add' });
    await settle(2);
    clickSheet({ tab: 'lore' });
    await settle(1);
    typeInto('loreKey', 'Bowl Bet'); typeInto('loreText', 'Brayden owes Kevin a steak.');
    clickSheet({ act: 'sheet-submit' });
    await until(() => fnCalls.some((c) => c.body.action === 'add_lore'), 'add_lore');
    assert(JSON.stringify(fnCalls.find((c) => c.body.action === 'add_lore').body) === JSON.stringify({ key: 'Bowl Bet', text: 'Brayden owes Kevin a steak.', action: 'add_lore', league_id: L }), '5-60: adding lore sends { key, text } only');
    await until(() => /Bowl Bet/.test(panel()), 'lore listed');
    // open the lore detail through the pane's lore row (the click target carries data-sp-lore)
    {
      const loreNode = node({ 'data-sp-lore': 'Bowl Bet' });
      const actNode = node({ 'data-sp-act': 'lore-detail' }, { '[data-sp-lore]': loreNode });
      ov().dispatch('click', { target: { closest: (sel) => (sel === '[data-sp-act]' ? actNode : null) } });
    }
    await settle(2);
    assert(wrap() && /Brayden owes Kevin a steak\./.test(sheetBody()) && />Remove</.test(sheetBody()) && />Correct</.test(sheetBody()), '5-61: the lore detail sheet shows the entry with Correct and Remove');
    clickSheet({ act: 'lore-correct' });
    await settle(2);
    typeInto('loreText', 'Brayden owes Kevin two steaks.');
    clickSheet({ act: 'sheet-submit' });
    await until(() => fnCalls.some((c) => c.body.action === 'correct_lore'), 'correct_lore');
    assert(JSON.stringify(fnCalls.find((c) => c.body.action === 'correct_lore').body) === JSON.stringify({ key: 'Bowl Bet', text: 'Brayden owes Kevin two steaks.', action: 'correct_lore', league_id: L }), '5-62: correcting lore sends { key, text } — the key is locked');
    await until(() => !wrap(), 'lore correct closed');
    {
      const loreNode = node({ 'data-sp-lore': 'Bowl Bet' });
      const actNode = node({ 'data-sp-act': 'lore-detail' }, { '[data-sp-lore]': loreNode });
      ov().dispatch('click', { target: { closest: (sel) => (sel === '[data-sp-act]' ? actNode : null) } });
    }
    await settle(2);
    const nRm = fnCalls.length;
    clickSheet({ act: 'lore-remove' });
    await settle(1);
    assert(/Remove this entry\?/.test(sheetBody()) && fnCalls.length === nRm, '5-63: Remove asks first, and sends nothing yet');
    clickSheet({ act: 'lore-remove-confirm' });
    await until(() => fnCalls.some((c) => c.body.action === 'remove_lore'), 'remove_lore');
    assert(JSON.stringify(fnCalls.find((c) => c.body.action === 'remove_lore').body) === JSON.stringify({ key: 'Bowl Bet', action: 'remove_lore', league_id: L }), '5-64: confirming sends { key } only');
    await until(() => !wrap() && !/Bowl Bet/.test(panel()), 'lore removed');
    assert(!/Bowl Bet/.test(panel()), '5-65: the entry leaves the pane');

    // ── (16) THE STANDARDS SHEET ──
    clickPane({ act: 'standards' });
    await settle(2);
    assert(wrap() && /Never fabricates stats\./.test(sheetBody()) && /Heat: <strong>/.test(sheetBody()) && !/<textarea|<input/.test(sheetBody()), '5-66: Standards opens a read-only sheet with this league\'s dial settings');

    // ── (16b) N3: the entry card and the pane agree — the pane's counts are the card's (lore counted by neither) ──
    {
      const view = app._scribeProfileStateForTest().view;
      const cachedNow = app.scribeProfileCachedCounts();
      assert(view && cachedNow.pending === view.counts.pending && cachedNow.active === view.counts.active && view.lore.length >= 1,
        `5-83: N3 — the entry card's counts (from the mirror) equal the pane's (from the server) with lore present: active ${cachedNow.active}/${view && view.counts.active}, pending ${cachedNow.pending}/${view && view.counts.pending}`);
    }

    // ── (16c) B3 — THE 15-RULE CAP AT 15 + 1, end to end: the pane pre-checks, the database refuses, a Replace is net zero, a freed slot unblocks ──
    {
      const live = () => srv.scribe_learnings.filter((r) => r.kind === 'learning' && r.status === 'approved' && rules.isLearningLive(r.payload, 'approved')).length;
      let o = 5000;
      while (live() < 15) { o += 1; srv.scribe_learnings.push(lrow(o, `fill_${o}`, 'learning', 'approved', { learningId: `fill_${o}`, category: 'humor', instruction: `FILL_${o}`, confidence: 1, approvedBy: 'p1', approvedAt: at(H) }, 'human')); }
      const fillId = srv.scribe_learnings.find((r) => r.id.startsWith('fill_')).id;
      const add = (id, status, category, extra = {}) => { o += 1; srv.scribe_learnings.push(lrow(o, id, 'learning', status, { learningId: id, category, instruction: id.toUpperCase(), confidence: 0.8, ...extra })); };
      add('cap_pend', 'pending', 'frequency');
      add('cap_repl', 'pending', 'humor', { replaces: fillId });
      add('cap_gone', 'superseded', 'profanity');
      add('cap_orph', 'pending', 'profanity', { replaces: 'cap_gone' });
      add('cap_off', 'superseded', 'callbacks');
      add('cap_weak', 'approved', 'roast_intensity', { confidence: 0.4 });          // approved but under the floor: NOT in use, not counted
      clickPane({ act: 'retry' });
      await until(() => app._scribeProfileStateForTest().view && app._scribeProfileStateForTest().view.capacity.rules === 15 && (app._scribeProfileStateForTest().view.pending || []).some((r) => r.id === 'cap_pend'), 'cap fixture loaded');
      const cv = app._scribeProfileStateForTest().view;
      assert(live() === 15 && cv.capacity.rules === 15 && cv.capacity.cap === 15 && cv.counts.active === cv.active.filter((r) => r.live).length + cv.examples.filter((r) => r.live).length && !cv.active.find((r) => r.id === 'cap_weak').live,
        `5-84: B3 — fixture: exactly 15 live rules; the pane's counts and live flags are what SCRIBE reads (capacity ${JSON.stringify(cv.capacity)}, counts ${JSON.stringify(cv.counts)}); the below-floor rule is not live`);
      await seg('pending');
      const cp = rowChunk(panel(), 'CAP_PEND'), cr = rowChunk(panel(), 'CAP_REPL'), co = rowChunk(panel(), 'CAP_ORPH');
      assert(/sp-approve"[^>]*disabled/.test(cp) && cp.includes('SCRIBE follows up to 15 rules. Turn one off first.') && !/sp-approve"[^>]*disabled/.test(cr) && />Replace</.test(cr) && !/sp-approve|>Approve<|>Replace</.test(co) && /nothing left to replace/.test(co),
        '5-85: at 15, a plain proposal\'s Approve is disabled with the sentence; a Replace is enabled; a proposal whose target is gone offers Reject only');
      const upd0 = log.length;
      clickPane({ act: 'approve', row: { id: 'cap_pend' } });
      await settle(3);
      assert(log.length === upd0 && srvRow('cap_pend').status === 'pending' && toasts.slice(-1)[0].html.includes('Turn one off first.'),
        '5-86: forcing Approve at the cap SENDS NOTHING (the pane pre-checks) and says the sentence');
      clickPane({ act: 'approve', row: { id: 'cap_orph' } });
      await settle(3);
      assert(log.length === upd0 && toasts.slice(-1)[0].html.includes('nothing left to replace'), '5-87: S2 — forcing an approve of a proposal with nothing to replace also sends nothing');
      // the DATABASE refuses regardless of the pane: drive batch O's own function directly at the 16th
      {
        const idx = sb.mirrorRowIds('cfbp_scribe_learnings').indexOf('cap_pend');
        const direct = app.applyScribeLearningDecision(idx, true);
        const done = await quiet(() => direct.saved);
        assert(done.state === 'failed' && srvRow('cap_pend').status === 'pending' && storage.getScribeLearnings()[idx].status === 'pending',
          `5-88: 15 + 1 — even around the pane, the server refuses the 16th rule (rule_cap_reached): the decision resolves "failed" and the row is still pending, here and on the server (got ${done.state})`);
      }
      await seg('active');
      assert(/Turned off \(\d+\)/.test(panel()), '5-89: the turned-off rules are in the group');
      if (!/aria-expanded="true"/.test(panel())) { clickPane({ act: 'toggle-off-group' }); await settle(1); }
      const offChunk = rowChunk(panel(), 'CAP_OFF');
      assert(/turn-on"[^>]*disabled/.test(offChunk) && offChunk.includes('Turn one off first.'), '5-90: at the cap, Turn on is disabled with the sentence');
      clickPane({ act: 'turn-on', row: { id: 'cap_off' } });
      await settle(3);
      assert(log.length === upd0 && srvRow('cap_off').status === 'superseded' && toasts.slice(-1)[0].html.includes('Turn one off first.'), '5-91: …and forcing it sends nothing');
      clickPane({ act: 'toggle-off-group' });
      clickPane({ act: 'detail', row: { id: 'cap_weak' } });
      await settle(3);
      const kcalls = fnCalls.filter((c) => c.body.action === 'keep').length;
      assert(/detail-keep"[^>]*disabled/.test(sheetBody()) && sheetBody().includes('Turn one off first.'), '5-92: Keep on a rule that is NOT in use is disabled at the cap (it would be the 16th)');
      clickSheet({ act: 'detail-keep' });
      await settle(2);
      assert(fnCalls.filter((c) => c.body.action === 'keep').length === kcalls, '5-93: …and forcing it sends no request');
      clickSheet({ act: 'sheet-cancel' });
      await until(() => !wrap(), 'cap_weak sheet closed');
      // adding an instruction at the cap
      const addsBefore = fnCalls.filter((c) => c.body.action === 'add_instruction').length;
      clickPane({ act: 'add' });
      await settle(2);
      typeInto('text', 'A sixteenth rule.');
      assert(/id="sp-submit"[^>]*disabled/.test(sheetBody()) && sheetBody().includes('Turn one off first.'), '5-94: B3 — the Add sheet at the cap says the sentence and disables Add');
      clickSheet({ act: 'sheet-submit' });
      await settle(2);
      assert(fnCalls.filter((c) => c.body.action === 'add_instruction').length === addsBefore && /Turn one off first\./.test(sheetBody()), '5-95: …and forcing Add sends nothing');
      clickSheet({ act: 'sheet-cancel' });
      await until(() => !wrap(), 'add sheet closed');
      // a REPLACE at the cap is net zero
      await seg('pending');
      clickPane({ act: 'approve', row: { id: 'cap_repl' } });
      await until(() => srvRow('cap_repl').status === 'approved', 'replace at the cap');
      assert(srvRow('cap_repl').status === 'approved' && srvRow(fillId).status === 'superseded' && srvRow('cap_repl').payload.replacedId === fillId && !('replaces' in srvRow('cap_repl').payload) && live() === 15,
        '5-96: a Replace at the cap is net zero: the replacement is approved, the old rule retired, replaces renamed replacedId, still exactly 15 live');
      // free a slot: the same Approve now goes through
      await settle(4);
      await seg('active');
      const spare = srv.scribe_learnings.find((r) => r.id.startsWith('fill_') && r.status === 'approved').id;
      clickPane({ act: 'detail', row: { id: spare } });
      await settle(3);
      clickSheet({ act: 'detail-toggle' });
      await until(() => srvRow(spare).status === 'superseded', 'slot freed');
      await settle(4);
      await seg('pending');
      assert(!/sp-approve"[^>]*disabled/.test(rowChunk(panel(), 'CAP_PEND')), '5-97: with a slot free the pane enables the same Approve');
      clickPane({ act: 'approve', row: { id: 'cap_pend' } });
      await until(() => srvRow('cap_pend').status === 'approved', 'approve after freeing a slot');
      assert(srvRow('cap_pend').status === 'approved' && live() === 15, '5-98: …and the server accepts it (15 again)');
    }

    // ── (16c-2) ROUND 3 (reviewer note 1) — A STALE VIEW NEVER GETS TO BE REFUSED BY THE DATABASE: the decision is checked against a view read right before it is sent ──
    // The adapter's write path latches a refused key and raises the red sync banner; "the list moved under you" is not a sync failure. So when the server has changed behind the pane's back
    // (a 15th rule appeared; a replace target was retired) the tap sends NOTHING, the row says why, and the view is already the fresh one. Every scenario below FAILS on the pre-fix pane
    // (the mutation kit removes the check and each goes red: the fake server refuses, the key latches, the row reads "Couldn't save").
    {
      const live = () => srv.scribe_learnings.filter((r) => r.kind === 'learning' && r.status === 'approved' && rules.isLearningLive(r.payload, 'approved')).length;
      const views = () => fnCalls.filter((c) => c.body.action === 'view').length;
      // "Latched" means the adapter latched a key or raised an error status AT ANY MOMENT since the last reset (a refused write is released again by the re-read that follows it, so a look
      // taken only afterwards would miss the red banner that flashed in between: this listens for it).
      const seen = [];
      const offSeen = sb.onStatus((status, d) => seen.push({ status, refused: (d && d.refusedKeys) || [] }));
      const latched = () => sb.getStatus().refusedKeys.length + seen.filter((e) => e.status === 'error' || e.refused.length > 0).length;
      let o = 9000;
      const mk = (id, status, category, extra = {}) => { o += 1; srv.scribe_learnings.push(lrow(o, id, 'learning', status, { learningId: id, category, instruction: id.toUpperCase(), confidence: 0.8, ...extra })); };
      const supersede = (id) => { const r = srvRow(id); r.status = 'superseded'; r.payload = { ...r.payload, status: 'superseded' }; };
      const fillTo = (n) => { while (live() < n) { o += 1; srv.scribe_learnings.push(lrow(o, `st_fill_${o}`, 'learning', 'approved', { learningId: `st_fill_${o}`, category: 'humor', instruction: `ST_FILL_${o}`, confidence: 1, approvedBy: 'p1', approvedAt: at(H) }, 'human')); } };
      const freeTo = (n) => { for (const r of srv.scribe_learnings.filter((x) => x.id.startsWith('fill_') || x.id.startsWith('st_fill_'))) { if (live() <= n) break; if (r.status === 'approved') supersede(r.id); } };
      const refreshPane = async (label) => { clickPane({ act: 'retry' }); await settle(4); await until(() => !/Loading/.test(panel()), label); await settle(2); };
      assert(latched() === 0, `5-R3-1: baseline — nothing is latched in the adapter before the stale-view scenarios (${JSON.stringify(sb.getStatus().refusedKeys)})`);

      // A — a stale Approve: the pane thinks there is room (12 live); behind its back the server fills to 15.
      freeTo(12);
      mk('sa_pend', 'pending', 'frequency');
      await refreshPane('stale scenario A');
      await seg('pending');
      assert(live() === 12 && app._scribeProfileStateForTest().view.capacity.rules === 12 && !/sp-approve"[^>]*disabled/.test(rowChunk(panel(), 'SA_PEND')),
        `5-R3-2: A — fixture: the pane shows 12 of 15 and an enabled Approve for SA_PEND (server live ${live()})`);
      fillTo(15);
      assert(live() === 15 && app._scribeProfileStateForTest().view.capacity.rules === 12, '5-R3-3: …then the server reaches 15 behind the pane\'s back (the pane still says 12)');
      {
        const u = log.length, v = views(), t0 = toasts.length;
        seen.length = 0;
        clickPane({ act: 'approve', row: { id: 'sa_pend' } });
        await until(() => rowChunk(panel(), 'SA_PEND').includes('Turn one off first.') && /sp-approve"[^>]*disabled/.test(rowChunk(panel(), 'SA_PEND')), 'A refused on the row');
        await settle(3);
        const chunk = rowChunk(panel(), 'SA_PEND');
        assert(log.length === u && srvRow('sa_pend').status === 'pending' && storage.getScribeLearnings()[sb.mirrorRowIds('cfbp_scribe_learnings').indexOf('sa_pend')].status === 'pending',
          '5-R3-4: A — NOTHING was sent: no write reached the server, the row is still pending there and in this device\'s mirror');
        assert(latched() === 0 && sb.getState() === 'ACTIVE',
          `5-R3-5: A — no key was latched and the adapter is still ACTIVE, so no red sync banner (refused keys ${JSON.stringify(sb.getStatus().refusedKeys)}, state ${sb.getState()})`);
        assert((chunk.match(/Turn one off first\./g) || []).length === 1 && /role="alert"/.test(chunk) && !/Couldn&#39;t save|Couldn't save/.test(chunk),
          '5-R3-6: A — the ROW says the cap sentence once (an alert line, not "Couldn\'t save")');
        assert(views() === v + 1 && app._scribeProfileStateForTest().view.capacity.rules === 15 && !toasts.slice(t0).some((x) => /Approved/.test(x.html)),
          '5-R3-7: A — the view was reloaded (one read, now showing 15 of 15) and no success toast fired');
      }

      // B — a stale Replace: the pane shows a Replace for a live rule; behind its back that rule is retired.
      freeTo(13);
      const tgt = srv.scribe_learnings.find((r) => (r.id.startsWith('fill_') || r.id.startsWith('st_fill_')) && r.status === 'approved').id;
      mk('sb_repl', 'pending', 'humor', { replaces: tgt });
      await refreshPane('stale scenario B');
      await seg('pending');
      assert(/>Replace</.test(rowChunk(panel(), 'SB_REPL')) && !/sp-approve"[^>]*disabled/.test(rowChunk(panel(), 'SB_REPL')),
        '5-R3-8: B — fixture: the pane offers an enabled Replace for SB_REPL');
      supersede(tgt);
      {
        const u = log.length, v = views();
        seen.length = 0;
        clickPane({ act: 'approve', row: { id: 'sb_repl' } });
        await until(() => /nothing left to replace/.test(rowChunk(panel(), 'SB_REPL')), 'B orphaned on the row');
        await settle(3);
        const chunk = rowChunk(panel(), 'SB_REPL');
        assert(log.length === u && srvRow('sb_repl').status === 'pending' && latched() === 0 && sb.getState() === 'ACTIVE',
          `5-R3-9: B — NOTHING was sent for the Replace whose target is gone, nothing is latched, the adapter is ACTIVE (refused keys ${JSON.stringify(sb.getStatus().refusedKeys)})`);
        assert(!/>Replace<|>Approve</.test(chunk) && />Reject</.test(chunk) && views() === v + 1,
          '5-R3-10: B — the reloaded row offers Reject only (S2), after exactly one read');
      }

      // D — the check itself cannot run: nothing is sent, and the row says so; then the same tap works.
      mk('sd_pend', 'pending', 'callbacks');
      await refreshPane('stale scenario D');
      await seg('pending');
      {
        const u = log.length;
        seen.length = 0;
        fnFail = { view: { status: 500, error: 'network' } };
        clickPane({ act: 'approve', row: { id: 'sd_pend' } });
        await until(() => /Couldn(&#39;|')t check the latest rules\./.test(rowChunk(panel(), 'SD_PEND')), 'D check failed on the row');
        const chunk = rowChunk(panel(), 'SD_PEND');
        assert(log.length === u && srvRow('sd_pend').status === 'pending' && latched() === 0 && /role="alert">Couldn(&#39;|')t check the latest rules\./.test(chunk) && !/sp-approve"[^>]*disabled/.test(chunk),
          '5-R3-11: D — when the freshness read fails nothing is sent, nothing is latched, the row says it could not check, and Approve is available again');
        fnFail = null;
        clickPane({ act: 'approve', row: { id: 'sd_pend' } });
        await until(() => srvRow('sd_pend').status === 'approved', 'D retried');
        await settle(3);
        assert(srvRow('sd_pend').status === 'approved' && !/SD_PEND/.test(panel()) && latched() === 0, '5-R3-12: D — the same tap, with the read working, goes through, and the old message is gone');
      }

      // C — a stale Turn on: the pane shows room; behind its back the server fills to 15.
      freeTo(13);
      mk('sc_off', 'superseded', 'callbacks');
      await refreshPane('stale scenario C');
      await seg('active');
      if (!/aria-expanded="true"/.test(panel())) { clickPane({ act: 'toggle-off-group' }); await settle(1); }
      assert(/turn-on"/.test(rowChunk(panel(), 'SC_OFF')) && !/turn-on"[^>]*disabled/.test(rowChunk(panel(), 'SC_OFF')), '5-R3-13: C — fixture: the pane offers an enabled Turn on for SC_OFF');
      fillTo(15);
      {
        const u = log.length, v = views();
        seen.length = 0;
        clickPane({ act: 'turn-on', row: { id: 'sc_off' } });
        await until(() => rowChunk(panel(), 'SC_OFF').includes('Turn one off first.'), 'C refused on the row');
        await settle(3);
        const chunk = rowChunk(panel(), 'SC_OFF');
        assert(log.length === u && srvRow('sc_off').status === 'superseded' && latched() === 0 && sb.getState() === 'ACTIVE' && (chunk.match(/Turn one off first\./g) || []).length === 1 && /turn-on"[^>]*disabled/.test(chunk) && views() === v + 1,
          `5-R3-14: C — a stale Turn on sends NOTHING, latches nothing, says the cap sentence once on the row, and reloads the view once (refused keys ${JSON.stringify(sb.getStatus().refusedKeys)})`);
      }
      // the message belongs to the moment: it is gone after the next change of tab
      await seg('pending');
      await seg('active');
      assert(!/role="alert"/.test(rowChunk(panel(), 'SC_OFF')), '5-R3-15: a row message does not outlive the tab it was shown on (the permanent cap note remains)');
      offSeen();
    }

    // ── (16d) N5: the segment crossfade and the row collapse happened, and in the right order (the collapse only after the server) ──
    assert(fakeDom.classLog.includes('sp-fade-in'), '5-99: N5 — a segment change crossfades its panel in (sp-fade-in was applied)');
    assert(fakeDom.classLog.includes('sp-item-leaving'), '5-100: N5 — a row that left a list collapsed first (sp-item-leaving was applied)');

    // ── (16e) N3: closing the pane updates the entry card IN PLACE — its wrapper (and the collapse listener on its title) is never replaced ──
    {
      const line = { innerHTML: 'old' };
      const openBtn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
      let pillRemoved = false, outerWrites = 0;
      const pill = { textContent: '9', remove() { pillRemoved = true; } };
      const title = { appended: [], appendChild(e) { this.appended.push(e); } };
      const card = { querySelector: (sel) => ({ '.sp-entry-line': line, '#scribe-profile-open': openBtn, '.admin-section-title': title, '.sp-pill-count': pill })[sel] || null };
      Object.defineProperty(card, 'outerHTML', { set() { outerWrites += 1; }, get() { return ''; } });
      const trainerStrong = { textContent: 'old' };
      fakeDom.register('scribe-profile-open-from-trainer', { querySelector: (sel) => (sel === 'strong' ? trainerStrong : null), getAttribute: () => null, setAttribute() {}, addEventListener() {} });
      const realQS = fakeDom.doc.querySelector;
      fakeDom.doc.querySelector = (sel) => (sel === '[data-comm-card="scribe-profile"]' ? card : null);
      // the server holds one more pending proposal than this device's mirror has seen, so the SERVER's count and the MIRROR's differ: the card must show the server's
      srv.scribe_learnings.push(lrow(9000, 'srv_only_pending', 'learning', 'pending', { learningId: 'srv_only_pending', category: 'profanity', instruction: 'SRV_ONLY', confidence: 0.8 }));
      const mirrorPending = app.scribeProfileCachedCounts().pending;
      app.openScribeProfilePane();
      await until(() => app._scribeProfileStateForTest() && app._scribeProfileStateForTest().view, 'view for the card refresh');
      const counts = { ...app._scribeProfileStateForTest().view.counts };
      assert(counts.pending === mirrorPending + 1, `5-101a: fixture — the server counts one more pending proposal than the mirror (${counts.pending} vs ${mirrorPending})`);
      clickPane({ act: 'back' });
      await settle(1);
      fakeDom.doc.querySelector = realQS;
      assert(outerWrites === 0 && line.innerHTML === `<strong>${counts.active} active</strong> · <strong>${counts.pending} waiting for review</strong>` && openBtn.attrs['aria-label'] === `SCRIBE profile. ${counts.active} active, ${counts.pending} waiting for review.`
        && (counts.pending > 0 ? pill.textContent === String(counts.pending) : pillRemoved) && trainerStrong.textContent === `${counts.pending} waiting for review`,
        `5-101: N3 — on close the card\\'s count line, aria-label and pill are updated IN PLACE with the SERVER's numbers (${JSON.stringify(counts)}) and the wrapper is never replaced (outerHTML writes: ${outerWrites}), so the Comm panel's collapse listener survives`);
      fakeDom.register('scribe-profile-open-from-trainer', null);
      app.openScribeProfilePane();                                      // the sections below (Esc, close, failure states) drive an open pane
      await until(() => app._scribeProfileStateForTest() && app._scribeProfileStateForTest().view, 'pane reopened');
      clickPane({ act: 'standards' });                                  // …and the Esc section below expects a sheet to be up
      await settle(2);
    }

    // ── (17) ESC AND CLOSE ──
    const mineKeys = () => [...fakeDom.keydown].filter((f) => f.toString().includes('SP_OVERLAY_ID'));      // the app registers other Esc listeners of its own
    const mineKey = () => mineKeys().pop();
    assert(mineKeys().length === 1, '5-67: while the pane is open exactly one Esc listener of its own exists');
    mineKey()({ key: 'Escape' });
    await until(() => !wrap(), 'sheet exit after Esc');
    assert(!wrap() && ov(), '5-68: Esc with a sheet up closes the SHEET (through its exit animation) and leaves the pane');
    mineKey()({ key: 'Escape' });
    await settle(1);
    assert(!ov() && mineKeys().length === 0 && app._scribeProfileStateForTest() === null, '5-69: a second Esc closes the pane, removes the listener and clears its state');
    assert(fakeDom.chrome.every((e) => !e.hasAttribute('inert') && !e.hasAttribute('aria-hidden')), '5-70: the page behind is interactive again');
    app.openScribeProfilePane();
    await settle(3);
    clickPane({ act: 'back' });
    await settle(1);
    assert(!ov() && mineKeys().length === 0, '5-71: the visible SCRIBE back button closes it too');

    // ── (18) FAILURE STATES OF THE PANE ITSELF ──
    fnFail = { view: { status: 500, error: 'profile_unreadable' } };
    app.openScribeProfilePane();
    await until(() => /Couldn&#39;t load|Couldn't load/.test(panel()), 'load error');
    assert(/data-sp-act="retry"/.test(panel()), '5-72: a failed load says so and offers Retry (not a blank pane)');
    fnFail = null;
    clickPane({ act: 'retry' });
    await until(() => /ACTIVE_OLD_RULE|REPLACEMENT_RULE/.test(panel()), 'retry loaded');
    assert(/Rules SCRIBE follows/.test(panel()), '5-73: Retry loads it');
    clickPane({ act: 'back' });
    fnFail = { view: { status: 403, error: 'not_commissioner' } };
    app.openScribeProfilePane();
    await until(() => /Only the commissioner/.test(panel()), 'denied');
    assert(/Only the commissioner can open this/.test(panel()), '5-74: a caller who is not the commissioner is told so in words');
    clickPane({ act: 'back' });
    fnFail = { __skip: 'league_paused' };
    app.openScribeProfilePane();
    await until(() => /paused/.test(panel()), 'paused');
    assert(/SCRIBE is paused while this league is paused/.test(panel()), '5-75: a paused league says so');
    clickPane({ act: 'back' });
    fnFail = null;

    // ── (19) MEMBERS READ LORE, READ-ONLY (D-51) ──
    const memberBlock = app.scribeMemberLoreBlockHTML([{ kind: 'lore', key: 'CFP 2K25', value: 'Kihoon won.' }, { kind: 'lore', key: EVIL, value: EVIL }, { kind: 'fact', key: 'F', value: 'not lore' }, { kind: 'lore', key: '', value: 'no key' }]);
    assert(/League lore/.test(memberBlock) && /CFP 2K25/.test(memberBlock) && !/<img/.test(memberBlock) && /&lt;img/.test(memberBlock) && !/not lore|no key/.test(memberBlock) && !/<button|<input|<textarea|data-sp-act/.test(memberBlock) && /Only the commissioner can change it/.test(memberBlock),
      '5-76: the member block lists lore only, escapes every field, and contains no control of any kind');
    assert(app.scribeMemberLoreBlockHTML([]) === '' && app.scribeMemberLoreBlockHTML(null) === '', '5-77: no lore, no block');
    const listCalls = [];
    app._wireScribeMemoryTransportForTest({ list: async (a) => { listCalls.push(a); return { ok: true, records: [{ kind: 'lore', key: 'CFP 2K25', value: 'Kihoon won.' }, { kind: 'wager', key: 'w', value: 'x' }] }; } });
    const loreRows = await app.refreshScribeLoreForMember();
    assert(listCalls.length === 1 && JSON.stringify(listCalls[0].kinds) === JSON.stringify(['lore']) && loreRows.length === 1 && loreRows[0].key === 'CFP 2K25', '5-78: a pilot-league member reads lore with one request for kind "lore", and nothing else is kept');
    const body = app.renderScribeFileBodyHTML({ profile: null, lore: loreRows });
    assert(/sp-member-lore/.test(body) && /CFP 2K25/.test(body) && !/sp-member-lore/.test(app.renderScribeFileBodyHTML({ profile: null })), '5-79: My SCRIBE File shows the block when there is lore and is byte-identical to before when there is none');
    auth._setMembershipsForTest([{ leagueId: L, memberId: 'p2', role: 'player', displayName: 'Kevin', leagueName: 'IRB', pilot: false }]);
    listCalls.length = 0;
    const none = await app.refreshScribeLoreForMember();
    assert(listCalls.length === 0 && none.length === 0, '5-80: a non-pilot league makes NO lore request at all');
    app._wireScribeMemoryTransportForTest({ list: async () => { throw new Error('boom'); } });
    auth._setMembershipsForTest([{ leagueId: L, memberId: 'p2', role: 'player', displayName: 'Kevin', leagueName: 'IRB', pilot: true }]);
    const failedRead = await quiet(() => app.refreshScribeLoreForMember());
    assert(Array.isArray(failedRead) && failedRead.length === 0, '5-81: a failed lore read shows no block (it fails quiet; lore is auxiliary on that surface)');
    app._wireScribeMemoryTransportForTest({});
  } catch (e) {
    assert(false, `5-x: the pane section threw — ${e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e}`);
  } finally {
    clearInterval(pumper);
    delete globalThis.supabase;
  }

  // ── LOCAL (PIN-ERA) MODE: the pane is not offered, and the Trainer card keeps its own lists ──
  try {
    auth._resetAuthForTest?.();
    auth.configureAuth({ authMode: 'pins', dataMode: 'local', authModeKnown: true });
    storage.setBackendMode('local');
    assert(app.scribeProfileAvailable() === false && app.scribeProfileEntryCardHTML() === '' && app.openScribeProfilePane() === false && !ov(),
      '5-82: in local mode the pane is not offered, the entry card is empty and opening it is refused');
  } catch (e) {
    assert(false, `5-82z: the local-mode case threw — ${e && e.message}`);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] source and stylesheet scans — the wiring a unit run cannot see…');
{
  const appSrc = stripComments(read('js/app.js'));
  const css = read('css/styles.css');
  const blockStart = css.indexOf('/* ═══ D1 LANE C — THE SCRIBE PROFILE PANE');
  const blockEnd = css.indexOf('/* ═══ END D1 LANE C — SCRIBE PROFILE PANE');
  const block = blockStart >= 0 && blockEnd > blockStart ? css.slice(blockStart, blockEnd) : '';
  const paneStart = appSrc.indexOf("const SP_OVERLAY_ID = 'scribe-profile-overlay';");
  const paneEnd = appSrc.indexOf('window.navigateTo=navigateTo;');
  const pane = paneStart >= 0 && paneEnd > paneStart ? appSrc.slice(paneStart, paneEnd) : '';
  assert(block.length > 2000 && pane.length > 5000, `6-0: fixture — the stylesheet block (${block.length} chars) and the pane section of app.js (${pane.length} chars) were both found`);

  // surfaces that must stand down while the pane is up (one owner per touch)
  const ng = stripComments(read('js/nav-gestures.js')), cc = stripComments(read('js/control-center.js'));
  const fnBody = (src, name) => { const i = src.indexOf(`function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)); };
  const lists = { 'nav-gestures gesturesSuspended': fnBody(ng, 'gesturesSuspended'), 'control-center isBlockedByOtherSurface': fnBody(cc, 'isBlockedByOtherSurface'), 'app _dismissBlockingSurfaceUp': fnBody(appSrc, '_dismissBlockingSurfaceUp') };
  for (const [name, body] of Object.entries(lists)) {
    assert(body.includes('scribe-profile-overlay') && body.includes('scribe-profile-sheet-wrap'), `6-1: ${name} lists BOTH the pane and its sheet wrap (a week-swipe / pull-to-refresh / drawer edge swipe must not arm underneath them)`);
  }
  assert(/excludeSpOverlay/.test(lists['app _dismissBlockingSurfaceUp']) && /excludeSpSheet/.test(lists['app _dismissBlockingSurfaceUp'])
    && /_dismissBlockingSurfaceUp\(\{\s*excludeSpOverlay:\s*true\s*\}\)/.test(pane) && /excludeSpSheet:\s*true,\s*excludeSpOverlay:\s*true/.test(pane),
    '6-2: the pane\'s own swipe-back and its sheet\'s drag each use the "OTHER surface" carve-out, so the gesture can arm without self-blocking');
  assert(/bindSwipeToDismiss\(el,\s*\{\s*axis:\s*'x'/.test(pane) && /--sp-drag-x/.test(pane) && /--sp-drag-x/.test(block) && /--sp-sheet-drag-y/.test(pane) && /--sp-sheet-drag-y/.test(block),
    '6-3: the edge swipe-back and the sheet\'s drag are wired (native-only inside bindSwipeToDismiss) and the stylesheet reads the same custom properties');

  // precache + module list
  const sw = read('service-worker.js'), lt = read('loadtest.mjs');
  for (const m of ['scribe-profile-rules', 'scribe-profile-view', 'scribe-profile-client', 'scribe-standards']) {
    assert(sw.includes(`'./js/${m}.js'`), `6-4: service-worker.js precaches js/${m}.js (a shell cache one module short serves a graph that cannot resolve)`);
    assert(lt.includes(`'${m}'`), `6-5: loadtest.mjs [1] imports js/${m}.js (RG-03: node --check cannot see a broken cross-module import)`);
  }

  // every class the markup uses is styled
  const used = new Set();
  for (const f of ['js/scribe-profile-view.js']) for (const m of read(f).matchAll(/class="([^"$]*)/g)) for (const c of m[1].split(/\s+/)) if (/^sp-/.test(c)) used.add(c);
  for (const m of appSrc.matchAll(/class="([^"$]*sp-[^"$]*)/g)) for (const c of m[1].split(/\s+/)) if (/^sp-/.test(c)) used.add(c);
  const HOOKS = ['sp-approve', 'sp-reject', 'sp-toggle', 'sp-turnon'];            // selector hooks the DOM and the tests bind to; they carry no style of their own
  const unstyled = [...used].filter((c) => !HOOKS.includes(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(block));
  assert(used.size > 30 && unstyled.length === 0, `6-6: every .sp- class the markup uses is styled in the pane's block (${used.size} used; unstyled: ${unstyled.join(', ') || 'none'})`);

  // tokens, tap targets, Reduce Motion
  const colorLeaks = (block.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []);
  assert(colorLeaks.length === 0, `6-7: the pane's stylesheet block has no hardcoded colour (${colorLeaks.length} found) — tokens only`);
  const ruleOf = (sel) => { const m = block.match(new RegExp(`(^|\\n)${sel.replace(/[.#]/g, (c) => '\\' + c)}\\{[^}]*\\}`)); return m ? m[0] : ''; };
  const tappable = ['.sp-btn', '.sp-seg-btn', '.sp-nav-btn', '.sp-entry,.sp-standards-row', '.sp-trainer-row', '.sp-item-tap,.sp-player'];
  const short = tappable.filter((sel) => !/min-height:44px/.test(ruleOf(sel)) && !new RegExp(`${sel.split(',')[0].replace(/[.]/g, '\\.')}[^{]*\\{[^}]*min-height:44px`).test(block));
  assert(short.length === 0, `6-8: every tappable class carries a 44 pt minimum (missing: ${short.join(' | ') || 'none'})`);
  const reduce = (block.match(/@media \(prefers-reduced-motion:reduce\)\{[^@]*\}/g) || []).join(' ');
  assert(/#scribe-profile-overlay/.test(reduce) && /\.sp-seg-btn/.test(reduce) && /#scribe-profile-sheet/.test(reduce) && /\.sp-skel/.test(reduce), '6-9: Reduce Motion switches off the push, the segment transition, the sheet drag and the skeleton shimmer');
  const literalMs = (block.replace(/\/\*[\s\S]*?\*\//g, '').match(/\b\d{3,4}ms\b/g) || []).filter((m) => !['120ms', '200ms', '150ms', '1400ms'].includes(m));      // 1400ms is the skeleton shimmer's own fallback (the shared --skeleton-shimmer token)
  assert(/transform:scale\(\.97\)/.test(block) && /var\(--motion-nav\)/.test(block) && /var\(--motion-fast\)/.test(block) && literalMs.length === 0
    && /\.sp-item-leaving\{[^}]*height 200ms[^}]*\}/.test(block) && /\.sp-fade-in\{animation:sp-fade var\(--motion-fast\)/.test(block),
    `6-10: touch feedback is the shared 97% compress; motion reads the --motion-* tokens; the only literal durations are the 120 ms press and N5's 200 ms row collapse (other literals: ${literalMs.join(',') || 'none'})`);
  assert(/z-index:150/.test(ruleOf('#scribe-profile-overlay')) && /z-index:8000/.test(block) && /overflow:hidden/.test(block), '6-11: the pane sits at the League Page\'s layer (150) and its sheets at the sheet layer (8000), and the page behind does not scroll');

  assert(/#scribe-run-trainer-btn,#scribe-export-learnings-btn,#scribe-reset-learnings-btn\{[^}]*min-height:44px/.test(block) && /id="scribe-export-learnings-btn"/.test(appSrc) && /flex-wrap:wrap;justify-content:center">\s*<button class="btn btn-secondary btn-sm" id="scribe-export-learnings-btn"/.test(read('js/app.js')),
    '6-8b: touched-screen audit — the Trainer card\'s Run / Export / Reset are 44 pt and the Export / Reset group is centered');

  // placement and the one approval path
  const commStart = appSrc.indexOf('scribeProfileEntryCardHTML()');
  const chatCard = appSrc.indexOf('id="comm-chat-card"');
  assert(commStart > 0 && chatCard > commStart && /insertAdjacentHTML\('beforeend',\s*scribeProfileEntryCardHTML\(\)\)/.test(appSrc), '6-12: DI-648 — the entry card is inserted into the SCRIBE tab BEFORE the Chat & S.C.R.I.B.E. card (it is the first card)');
  assert(/applyScribeLearningDecision\(/.test(pane) && /applyScribeCanonDecision\(/.test(pane) && /toggleScribeLearningStatus\(/.test(pane), '6-13: Approve / Reject / Turn off / Undo go through batch O\'s three functions');
  assert(!/setScribeLearnings\(|setScribeCanon\(|\bsave\(|localStorage|sb\.set\(/.test(pane), '6-14: the pane writes NOTHING to the mirror or storage itself — the only writes are the batch O functions\' and the function\'s');
  const bodyOf = (name) => { const i = pane.indexOf(`function ${name}(`); return pane.slice(i, pane.indexOf('\n}\n', i)); };
  const localBodies = bodyOf('spApplyDecisionLocally') + bodyOf('spApplyToggleLocally');
  assert((pane.match(/status:\s*'approved'/g) || []).length === (localBodies.match(/status:\s*'approved'/g) || []).length && /status:\s*'approved'/.test(localBodies),
    '6-15: the only places the pane writes the word "approved" onto a row are spApplyDecisionLocally() and spApplyToggleLocally() (display-only, run after the save is confirmed) — never into storage');
  const decideBody = (() => { const i = pane.indexOf('async function spDecide('); return pane.slice(i, pane.indexOf('\n}\n', i)); })();
  assert(decideBody.indexOf('await r.saved') > 0 && decideBody.indexOf('spApplyDecisionLocally(') > decideBody.indexOf('await r.saved') && decideBody.indexOf("state === 'saved'") < decideBody.indexOf('spApplyDecisionLocally('),
    '6-16: in spDecide the row is moved only AFTER `await r.saved` and only inside the `state === \'saved\'` branch');
  assert(/mirrorRowIds/.test(pane) && /includes|indexOf/.test(pane.slice(pane.indexOf('function spMirrorRef('), pane.indexOf('function spMirrorRef(') + 500)),
    '6-17: a row is mapped to its mirror position by the server id through mirrorRowIds() — never by array index from the view');
  assert(!/\.innerHTML\s*=\s*[^;]*\+/.test(pane) && !/document\.write|eval\(|new Function/.test(pane), '6-18: no string-concatenated innerHTML, no eval in the pane');
  assert(!/\.then\(/.test(pane), '6-19: house style — async/await, no .then() chains in the pane');

  const layout = await import('./js/comm-panel-layout.js');
  assert(layout.commTabFor('scribe-profile') === 'scribe' && /data-comm-card="scribe-profile"/.test(read('js/scribe-profile-view.js')),
    '6-22: DI-648 — COMM_CARD_TAB[\'scribe-profile\'] = \'scribe\' and the card carries that id, so it can never be an unmapped Comm card (RG-10)');

  // N5 / S3 — the motion is wired the way the Principles ask
  const toggleBody = (() => { const i = pane.indexOf('async function spToggle('); return pane.slice(i, pane.indexOf('\n}\n', i)); })();
  assert(decideBody.indexOf('await spCollapseRow(row)') > decideBody.indexOf('await r.saved') && toggleBody.indexOf('await spCollapseRow(row)') > toggleBody.indexOf('await r.saved')
    && decideBody.indexOf('await spCollapseRow(row)') < decideBody.indexOf('spApplyDecisionLocally(row, approving)') && toggleBody.indexOf('await spCollapseRow(row)') < toggleBody.indexOf('spApplyToggleLocally('),
    '6-23: N5 — a row collapses (200 ms) only AFTER the server confirmed, and BEFORE the list repaints without it, in both the decision and the switch');
  const closeBody = (() => { const i = pane.indexOf('function spCloseSheet('); return pane.slice(i, pane.indexOf('\n}\n', i)); })();
  assert(/playDeleteSheetExit\(wrap, [\s\S]*?\{ sheetId: 'scribe-profile-sheet', dragVar: '--sp-sheet-drag-y' \}\)/.test(closeBody) && /if \(immediate\) \{ wrap\.remove\(\); return; \}/.test(closeBody)
    && /#scribe-profile-sheet-wrap\[data-closing\]\{pointer-events:none\}/.test(block) && /#scribe-profile-sheet-wrap\[data-closing="fade"\]\{opacity:0;transition:opacity var\(--motion-fast\) linear\}/.test(block),
    '6-24: S3 — every sheet close but the pane\'s own teardown goes through the delete-account sheet\'s exit (generalized, not forked), with the matching data-closing CSS');
  assert(/function playDeleteSheetExit\(wrap, done, \{ sheetId = AX_SHEET_ID, dragVar = '--ax-drag-y' \} = \{\}\)/.test(appSrc) && /closeDeleteAccountSheet[\s\S]{0,400}playDeleteSheetExit\(wrap, \(\) =>/.test(appSrc),
    '6-25: …and the delete-account sheet still calls it with its own defaults (nothing forked)');
  assert(/spRefreshEntryPoints\(learned\)/.test(pane) && !/outerHTML\s*=/.test(pane) && /line\.innerHTML = SPV\.entryLineHTML\(c\)/.test(pane),
    '6-26: N3 — the entry card is refreshed IN PLACE (no outerHTML write anywhere in the pane), with the server\'s counts when the view loaded');

  // boot path
  const bootSrc = appSrc.slice(appSrc.indexOf('async function boot('), appSrc.indexOf('async function boot(') + 60000);
  assert(!/openScribeProfilePane|callScribeProfile|scribeProfile/.test(bootSrc), '6-20: nothing about the pane runs in boot() — it is opened by a tap, after the app is serving (RG-12 / boot-order rule)');
  assert(!/service_role|apikey|\banon\b|anon_?key|supabaseAnonKey/i.test(stripComments(read('js/scribe-profile-client.js')) + stripComments(read('js/scribe-profile-view.js')) + pane), '6-21: no key of any kind appears in the pane\'s client code');
}

console.log('\n─────────────────────────────────────────────────────────────────────────────────');
console.log(fail === 0 ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
console.log('─────────────────────────────────────────────────────────────────────────────────');
process.exit(fail === 0 ? 0 : 1);
