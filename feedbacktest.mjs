/**
 * CFB Pickems — feedbacktest.mjs (UN-159/UN-160/UN-164/UN-165/UN-166, v0.18.x)
 * ==============================================================================
 * Unit/behavioral tests for Build 1 (feedback capture + chat depth), per
 * `weekly bug fixes and feedback/Chat SCRIBE updates 090526/
 * DESIGN_INPUTS_BATCH1_091026.md` (Document 2) — the precedent is
 * `grouptest.mjs` (UN-118, 2026-08-13): a separate file, run alongside
 * `loadtest.mjs`, not folded into its chat-fold suite.
 *
 * Run:  node feedbacktest.mjs      (sweep BOTH TZ=UTC and
 *       TZ=America/Los_Angeles per CLAUDE.md §5's timezone lesson — RG-38)
 *
 * Covers, in order:
 *   1. E2 — 'feedback' folds via applyTo() exactly like react/pin: shuffle
 *      ×10 byte-identical, buffered-before-target, duplicate-id idempotent.
 *   2. E1/E2 — replace-not-stack (second rating on the same target+player
 *      replaces, never stacks) and rating/rewrite distinctness (disjoint
 *      categories never collide; clearing one never clears the other).
 *   3. E1 — rewrite resubmission replaces the prior text, never appends a
 *      second copy.
 *   4. E1 — instrumentation-off (`scribeFeedbackEnabled: false`) renders zero
 *      ⭐/🚩/data-fb-open trace on ANY message, any author.
 *   5. E1 — no player-attribution leak: messageHTML() for player B never
 *      contains player A's rating value anywhere in the emitted HTML.
 *   6. E2 — getFeedbackFor()/getAllFeedbackSince() return POINTERS
 *      (targetId), never a copy of the target message's body.
 *   7. E2 — structural: no new KV key was added to storage.js's KEYS for
 *      this feature; scribeFeedback.js never imports save()/load().
 *   8. F1 — adversarial linkify: <script> inert + URL still linkified; a URL
 *      containing '@' round-trips without corrupting the mention regex or
 *      the href; trailing sentence punctuation excluded from the href.
 *   9. F4-interim — settings-gated <img> rendering, off by default.
 *  10. F2 — search respects retention + epoch, case-insensitive literal (not
 *      fuzzy), mutation-checked ordering (retention before textContains).
 *  11. F3 — hidden-parent quote has no data-jump; deleted-parent quote keeps
 *      data-jump + gains the muted class; live parent unchanged.
 *  12. Part 0b correction #6 (binding) — getAllFeedbackSince() pages through
 *      chatTransport.js's fetchSince(), NEVER the client fold (proven by
 *      returning feedback events the LOCAL fold never ingested at all).
 *  13. Part 0b correction #7 (binding) — "Weigh in" accepts an optional
 *      rewrite-shaped text value, not just a bare boolean flag.
 *  14. E2 — meta.triggerMessageId / meta.scribeVersion round-trip on a
 *      SCRIBE-authored message; meta.activeLearningSnapshot stays unset.
 *
 * ── Remediation Build 1 (2026-09-10, reviewer BLOCK) ─────────────────────
 *  15. Finding #1 (BLOCKING) — showToast('Rewrite saved.', {force:true})
 *      enqueues/renders even from a simulated chat-page context, verified
 *      through the real _showToastForTest/_toastQueueDepth seams.
 *  16. Finding #2 (BLOCKING, CSS) — .feedback-picker-wrap resets
 *      .reaction-picker's inherited grid layout; single-column fallback
 *      widened to ≤360px; stale scratch-file header comment removed.
 *  17. Finding #2 (BLOCKING, JS) — the feedback popover survives the
 *      document-level reveal-closer (chat-ui.js ~1903).
 *  18. Finding #3 (BLOCKING) — prototype-pollution guard: a feedback event
 *      with author/category "__proto__"/"constructor"/"prototype" is
 *      dropped, never pollutes Object.prototype; same hardening on the
 *      pre-existing react/unreact branch; non-file mutation proof.
 *  19. Finding #4 (BLOCKING) — _feedbackPopoverHTMLForTest: all six controls
 *      render with exact labels/data-fb-* attributes; D6 equal styling
 *      (no distinct emphasis class); .active reflects the rater's own state.
 *  20. Finding #4 (BLOCKING) — _searchResultsHTMLForTest honors retention/
 *      epoch through the render function itself, not just getMessages().
 *  21. Finding #5 — an explicit weigh_in clear (value:null) removes the
 *      prior text/flag (the modal's new "Remove" action writes this shape).
 *  22. Finding #7 — search-result preview is plain escaped text, never a
 *      nested <a>/<img> inside the result <button>.
 *  23. Finding #8 — the search clear/close controls are distinguishable
 *      (source-scan: "Clear" text + distinct aria-labels).
 *  24. Finding #9 — recordFeedback() clamps value length to 1000 chars.
 *  25. Finding #11 — the search "Load older messages" handler wraps its
 *      await in try/catch.
 *
 * ── Test-only pass (2026-09-10, E/F re-review closure) ──────────────────
 *  (a) [26] Structural — the REAL rewrite-submit call site (chat-ui.js
 *      ~line 1016) is scanned for showToast(..., {force:true}) on its own
 *      source text, not just the seam §15 already exercises directly.
 *      §15 proved the MECHANISM works when called with force:true baked
 *      into the test fixture; it never actually read the production call
 *      site's own text, which is exactly how the reviewer's dropped
 *      {force:true} regression stayed green before. Non-file, in-memory
 *      mutation proof (RG-27: a guard that cannot fail is not a guard).
 *  (b) [18]/[19] — §19 extended so `.active` is asserted for EVERY
 *      own-state control (data-fb-rating hit/mid/too_much, data-fb-remember,
 *      data-fb-rewrite, data-fb-weighin), not just too_much/remember.
 *      data-fb-rewrite's new assertion is mutation-proven against a REAL
 *      tmpdir copy of chat-ui.js (never real source — CLAUDE.md
 *      prohibited-moves; precedent: almatest.mjs's importMutant()).
 *  (c) [18] — the poisoned-react-emoji ingest() (the one call in this file
 *      capable of THROWING `next[em].push is not a function` if the
 *      react-branch guard ever regresses, per chat.js:349's own comment on
 *      why `obj['__proto__']` has no .push) is now wrapped in try/catch, so
 *      a regressed guard is recorded as a failure and the remaining ~20
 *      sections still run and report, instead of crashing the process with
 *      no final pass/fail total. Proven against a REAL tmpdir copy of
 *      chat.js with the guard line removed — the mutant genuinely throws,
 *      and the wrap genuinely converts that throw into a recorded failure.
 *
 * ── Remediation Item 3 (2026-09-10, reviewer BLOCK on the persistent ⭐) ──
 *  [28c] Finding #1 (BLOCKING) + finding #2 — toggleFeedbackPicker() hosts
 *      the popover on a positioned ROW container ('.chat-actions,
 *      .chat-reactions'), never on the right-aligned trigger <button>.
 *      Structural: the popover is a SIBLING of the ⭐ inside .chat-reactions
 *      and has no <button> ancestor (so a mis-tap on its padding cannot
 *      bubble to the trigger); the .chat-actions path is provably unchanged;
 *      toggle-off and cross-popover single-open-at-a-time still hold; and a
 *      geometry check recomputes the reviewer's own numbers (column left 62,
 *      column width 304, popover 320, ⭐ at 326, button-anchored overflow
 *      exactly 256px at a 390px viewport) from values PARSED OUT OF
 *      styles.css, not hardcoded.
 *  [28d] Mutation proof for [28c] — the anchor reverted to
 *      '.chat-actions'-only against a REAL tmpdir copy of chat-ui.js puts the
 *      popover back inside the <button> (RG-27: the assertions can fail).
 */

import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── DOM / browser stubs — IDENTICAL shape to loadtest.mjs's ──────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const nullEl = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (p === 'style') return {};
    if (p === 'dataset') return {};
    if (['addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'insertAdjacentHTML', 'remove', 'focus', 'scrollTo'].includes(p)) return () => {};
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector' || p === 'closest') return () => null;
    if (p === 'innerHTML' || p === 'textContent' || p === 'value') return '';
    return undefined;
  },
  set: () => true,
});
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...({}), set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in feedbacktest (unless a section installs its own stub)'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const storage = await import('./js/storage.js');
const backend = await import('./js/backend.js');
const chatTransport = await import('./js/chatTransport.js');
const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const scribeFeedback = await import('./js/scribeFeedback.js');
const scribeLines = await import('./js/scribeLines.js');

const {
  ingest, getMessage, getMessages, _resetForTest, _foldedSnapshot, sendEvent,
} = chat;
const { recordFeedback, getFeedbackFor, getAllFeedbackSince, isScribeFeedbackEnabled } = scribeFeedback;
const { _messageHTMLForTest, _quoteHTMLForTest } = chatUi;
const { scribeTrigger, scribeInspectMessage, SCRIBE_VERSION } = scribeLines;

console.log('[feedbacktest] modules imported —', Object.keys(scribeFeedback).length, 'scribeFeedback exports');

storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true });
storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true });
storage.addPlayer({ playerId: 'p3', displayName: 'Kevin', active: true });

function ev(o) { return { gameTag: '', type: 'message', author: 'p1', body: '', notify: o.type === 'message' || o.type === undefined, ...o }; }

// ── Generic mutant importer (test-only pass, 2026-09-10) ────────────────────
// Copies the ENTIRE js/ directory into a fresh tmpdir per call — never
// touches real source under cfb-pickems/js/ — applies the caller's mutation
// to ONE file within that copy, then dynamically imports that file so its
// sibling relative imports (./chat.js, ./storage.js, ./data-model.js, etc.)
// resolve against the OTHER copies sitting beside it in the SAME tmpdir, not
// the real tree. Precedent: almatest.mjs's importMutant() (hand-curated
// 2-file scope); widened here to a full-directory copy because chat-ui.js's
// dependency graph (chat.js → chatTransport.js/storage.js/scribeLines.js →
// …) is too deep to hand-curate safely. This is the CLAUDE.md-safe shape of
// mutation testing — "mutate against a file copy in scratch and restore
// from that copy" — taken further: the mutation never lands on the real
// file at all, so there is nothing to restore and nothing an interrupted
// run could leave behind (ranktest.mjs's 2026-09-03 note on exactly this
// hazard, re: writing a gutted mutant to real source and restoring in a
// `finally`).
// Split into two steps (not one importMutantFile-does-everything helper) —
// dependent modules (chat-ui.js, scribeFeedback.js) both `import ... from
// './chat.js'` with NO cache-busting query of their own, so a SEPARATE
// module that wants to observe/drive the SAME chat.js singleton those two
// use internally must import it via the identical bare path Node resolves
// their relative import to (`file://<dir>/chat.js`, no query) — not a
// re-querystring'd copy, which would silently be a THIRD, disconnected
// instance. Each mutant gets its own fresh mkdtemp() dir, so the absolute
// path is already unique per mutant — no cache-busting query is needed (or
// wanted) on any file living inside it.
const jsDirUrl = new URL('./js/', import.meta.url);
const mutantTmpDirs = [];
async function createMutantDir(relFile, mutate) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'feedbacktest-mutant-'));
  mutantTmpDirs.push(dir);
  await cp(fileURLToPath(jsDirUrl), dir, { recursive: true });
  const targetPath = path.join(dir, relFile);
  const original = await readFile(targetPath, 'utf8');
  const mutated = mutate(original);
  if (mutated === original) throw new Error(`mutation of ${relFile} was a no-op — fixture text not found in the copy`);
  await writeFile(targetPath, mutated, 'utf8');
  return dir;
}
function importFromMutantDir(dir, relFile) {
  return import(`file://${path.join(dir, relFile)}`);
}
// Baselines captured BEFORE any mutation in this file runs — the final
// cleanup section (item a, bottom of file) diffs against these, not a
// read taken partway through, so the byte-identity proof actually covers
// the WHOLE run.
const REAL_CHAT_JS_AT_START = await readFile(new URL('./js/chat.js', import.meta.url), 'utf8');
const REAL_CHAT_UI_JS_AT_START = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');

// ═════════════════════════════════════════════════════════════════════════
// 1. E2 — 'feedback' folds like react/pin: shuffle, buffer, idempotent
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] E2 — feedback fold correctness…');

const LOG_FB = [
  ev({ id: 'scribe_x', seq: 1, ts: 1000, author: 'scribe', body: 'SCRIBE NOTE: filed.' }),
  ev({ id: 'h1', seq: 2, ts: 2000, author: 'p2', body: 'hello' }),
  // feedback arriving BEFORE its target — must buffer, same shape as react/pin
  { id: 'fb0', seq: 3, ts: 3000, type: 'feedback', targetId: 'scribe_x2', author: 'p1', meta: { category: 'rating', value: 'mid' }, notify: false },
  ev({ id: 'scribe_x2', seq: 4, ts: 4000, author: 'scribe', body: 'SCRIBE NOTE: another.' }),
  { id: 'fb1', seq: 5, ts: 5000, type: 'feedback', targetId: 'scribe_x', author: 'p1', meta: { category: 'rating', value: 'mid' }, notify: false },
  { id: 'fb2', seq: 6, ts: 6000, type: 'feedback', targetId: 'scribe_x', author: 'p1', meta: { category: 'rating', value: 'hit' }, notify: false },  // REPLACES fb1
  { id: 'fb3', seq: 7, ts: 7000, type: 'feedback', targetId: 'scribe_x', author: 'p1', meta: { category: 'rewrite', value: 'a better line' }, notify: false },
  { id: 'fb4', seq: 8, ts: 8000, type: 'feedback', targetId: 'h1', author: 'p3', meta: { category: 'remember_this', value: true }, notify: false },
  { id: 'fb1', seq: 5, ts: 5000, type: 'feedback', targetId: 'scribe_x', author: 'p1', meta: { category: 'rating', value: 'mid' }, notify: false },  // duplicate id — idempotency
];

_resetForTest(); ingest(LOG_FB);
assert(getMessage('scribe_x2').feedback.p1.rating === 'mid', 'feedback arriving BEFORE its target buffers, then applies once the target arrives');
assert(getMessage('scribe_x').feedback.p1.rating === 'hit', 'a second rating on the same (target, player) REPLACES the first (mid → hit), never stacks');
assert(getMessage('scribe_x').feedback.p1.rewrite === 'a better line', 'rewrite category survives independently alongside the replaced rating');
assert(getMessage('h1').feedback.p3.remember_this === true, 'remember_this folds onto a HUMAN message target');

const fbBaseline = _foldedSnapshot();
let fbOrderOk = true;
for (let i = 0; i < 10; i++) {
  const shuffled = [...LOG_FB];
  for (let j = shuffled.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
  }
  _resetForTest();
  ingest(shuffled);
  if (_foldedSnapshot() !== fbBaseline) fbOrderOk = false;
}
assert(fbOrderOk, 'feedback fold is order-independent across 10 shuffles (byte-identical, same proof shape as reactions)');

_resetForTest(); ingest(LOG_FB); ingest(LOG_FB);
assert(_foldedSnapshot() === fbBaseline, 'feedback fold is idempotent (double ingest identical)');

// ═════════════════════════════════════════════════════════════════════════
// 2. E1/E2 — replace-not-stack, rating/rewrite distinctness
// ═════════════════════════════════════════════════════════════════════════
// NOTE ON METHOD: sendEvent()'s optimistic local path (chat.js) stamps a
// freshly-sent, not-yet-server-confirmed event at {ts:0, seq:0} — real
// stamps are only assigned once the SAME id round-trips back through a poll,
// which this offline harness (network disabled) never completes. Calling
// recordFeedback() TWICE in a row for the SAME (target, author, category)
// key would therefore tie at {0,0} and the second call would be silently
// rejected by applyTo()'s own cmpOrder guard — a real, pre-existing
// characteristic shared identically by toggleReact()/react/unreact (verified
// by direct probe against chat.js, not assumed), NOT something this build
// introduced or is in scope to change. So: exactly like section [1]'s LOG_FB
// and every existing reaction-fold test in loadtest.mjs, a SECOND write to
// the SAME key is proven via directly-ingested raw events carrying explicit,
// increasing (seq, ts) — never via two chained recordFeedback() calls.
// recordFeedback() itself IS exercised directly wherever only ONE write to
// a given key is needed (no `cur` to tie against).
console.log('\n[2] E1/E2 — replace-not-stack, category distinctness…');

_resetForTest();
ingest([ev({ id: 'sx', seq: 1, ts: 1000, author: 'scribe', body: 'note' })]);
recordFeedback({ targetId: 'sx', category: 'rating', value: 'hit', author: 'p1' });
assert(getFeedbackFor('sx').p1.rating === 'hit', 'recordFeedback() → getFeedbackFor() round-trips a rating');

const fbev = (o, seq, ts) => ({ id: `fbk_${seq}`, type: 'feedback', targetId: 'sx', author: 'p1', notify: false, seq, ts, meta: o });
ingest([fbev({ category: 'rating', value: 'too_much' }, 2, 2000)]);
assert(getFeedbackFor('sx').p1.rating === 'too_much', 'a changed-mind rating replaces the prior value (hit → too_much)');
ingest([fbev({ category: 'rating', value: null }, 3, 3000)]);
assert(getFeedbackFor('sx').p1.rating === null, 're-tapping the currently selected rating clears it back to untouched (explicit clear, not silence)');

ingest([fbev({ category: 'rewrite', value: 'should have said this' }, 4, 4000)]);
assert(getFeedbackFor('sx').p1.rewrite === 'should have said this', 'a player can hold a rewrite independently of their (cleared) rating');
ingest([fbev({ category: 'rating', value: 'mid' }, 5, 5000)]);
assert(getFeedbackFor('sx').p1.rewrite === 'should have said this' && getFeedbackFor('sx').p1.rating === 'mid',
  'setting a NEW rating never clears the existing rewrite — disjoint categories, structurally distinct keys');

// Multiple players, one target — independent, same shuffle-fold shape _reactOps proves for reactions.
// Each of these is a FIRST write for its own (author, category) key, so the
// real recordFeedback() API is exercised directly (no {0,0}-tie risk).
recordFeedback({ targetId: 'sx', category: 'rating', value: 'hit', author: 'p2' });
recordFeedback({ targetId: 'sx', category: 'rating', value: 'too_much', author: 'p3' });
assert(getFeedbackFor('sx').p1.rating === 'mid' && getFeedbackFor('sx').p2.rating === 'hit' && getFeedbackFor('sx').p3.rating === 'too_much',
  "six players' ratings on one SCRIBE line coexist without collision (${targetId}|${playerId}|${category} composite key)");

// ═════════════════════════════════════════════════════════════════════════
// 3. E1 — rewrite resubmission replaces, never appends a second copy
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] E1 — rewrite resubmission replaces…');
// Same {0,0}-tie reasoning as section [2] — two writes to the SAME key need
// explicit increasing (seq, ts) via direct ingest, not two chained
// recordFeedback() calls.
ingest([fbev({ category: 'rewrite', value: 'first draft' }, 6, 6000)]);
ingest([fbev({ category: 'rewrite', value: 'second, better draft' }, 7, 7000)]);
assert(getFeedbackFor('sx').p1.rewrite === 'second, better draft', 're-submitting a rewrite REPLACES the stored text for that (response, player) pair');
assert(!String(getFeedbackFor('sx').p1.rewrite).includes('first draft'), 'the fold never retains two rewrite versions for the same (target, player)');

// ═════════════════════════════════════════════════════════════════════════
// 4. E1 — instrumentation-off renders zero trace
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] E1 — instrumentation-off (scribeFeedbackEnabled: false)…');

_resetForTest();
ingest([
  ev({ id: 'off_s', seq: 1, ts: 1000, author: 'scribe', body: 'a scribe line' }),
  ev({ id: 'off_h', seq: 2, ts: 2000, author: 'p2', body: 'a human line' }),
]);
storage.setSession('p1', false, true);

storage.saveSetting('scribeFeedbackEnabled', false);
assert(isScribeFeedbackEnabled() === false, 'fixture check: the master switch reads OFF once explicitly set');
const htmlOffS = _messageHTMLForTest(getMessage('off_s'), 'p1', false);
const htmlOffH = _messageHTMLForTest(getMessage('off_h'), 'p1', false);
assert(!/⭐/.test(htmlOffS) && !/data-fb-open/.test(htmlOffS), 'instrumentation OFF: SCRIBE message renders no ⭐/data-fb-open trace');
assert(!/🚩/.test(htmlOffH) && !/data-fb-open/.test(htmlOffH), 'instrumentation OFF: human message renders no 🚩/data-fb-open trace');

storage.saveSetting('scribeFeedbackEnabled', true);
assert(isScribeFeedbackEnabled() === true, 'fixture check: the master switch reads ON once explicitly set');
const htmlOnS = _messageHTMLForTest(getMessage('off_s'), 'p1', false);
const htmlOnH = _messageHTMLForTest(getMessage('off_h'), 'p1', false);
assert(/data-fb-open="off_s"/.test(htmlOnS), 'fixture check: instrumentation ON actually renders the SCRIBE trigger (proves [4]\'s OFF assertions are non-vacuous)');
assert(/data-fb-open="off_h"/.test(htmlOnH), 'fixture check: instrumentation ON actually renders the human-message trigger');

storage.saveSetting('scribeFeedbackEnabled', undefined);
assert(isScribeFeedbackEnabled() === true, 'default-when-missing: an absent settings.scribeFeedbackEnabled reads TRUE (pilot default, CONVENTIONS #10)');
storage.saveSetting('scribeFeedbackEnabled', true);

// ═════════════════════════════════════════════════════════════════════════
// 5. E1 — no player-attribution leak
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5] E1 — no player-attribution leak…');

_resetForTest();
ingest([ev({ id: 'leak_s', seq: 1, ts: 1000, author: 'scribe', body: 'rate me' })]);
recordFeedback({ targetId: 'leak_s', category: 'rating', value: 'too_much', author: 'p1' });  // player A
recordFeedback({ targetId: 'leak_s', category: 'rating', value: 'hit', author: 'p2' });        // player B

const htmlForB = _messageHTMLForTest(getMessage('leak_s'), 'p2', false);
assert(/⭐ Hit/.test(htmlForB), "player B's own rendering reflects B's OWN state (⭐ Hit)");
assert(!/⭐ Too much/.test(htmlForB), "player B's rendering never contains player A's rating value (⭐ Too much) anywhere in the emitted HTML");

const htmlForA = _messageHTMLForTest(getMessage('leak_s'), 'p1', false);
assert(/⭐ Too much/.test(htmlForA), "player A's own rendering reflects A's OWN state (⭐ Too much)");
assert(!/⭐ Hit/.test(htmlForA), "player A's rendering never contains player B's rating value (⭐ Hit)");

const htmlAnon = _messageHTMLForTest(getMessage('leak_s'), null, false);
assert(/⭐ Rate/.test(htmlAnon) && !/⭐ Hit/.test(htmlAnon) && !/⭐ Too much/.test(htmlAnon),
  'a signed-out/unknown viewer (self=null) sees the plain, untouched ⭐ Rate trigger — no rating leak at all');

// ═════════════════════════════════════════════════════════════════════════
// 6. E2 — pointer, not copy
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6] E2 — pointer-not-copy proof…');

const feedbackForLeak = getFeedbackFor('leak_s');
assert(JSON.stringify(feedbackForLeak).indexOf('rate me') === -1,
  'getFeedbackFor() never carries a copy of the target message\'s body — targetId is the pointer, the body lives only on the message itself');

// ═════════════════════════════════════════════════════════════════════════
// 7. E2 — structural: no new KV key; scribeFeedback.js never touches the seam
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[7] E2 — structural: no new KV key for this feature…');

const storageSrc = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
const keysBlockMatch = storageSrc.match(/const KEYS = \{[\s\S]*?\n\};/);
assert(!!keysBlockMatch, 'fixture check: storage.js\'s KEYS object literal was located');
const keysBlock = keysBlockMatch ? keysBlockMatch[0] : '';
assert(!/SCRIBE_FEEDBACK|SCRIBE_RATINGS|FEEDBACK2|'cfbp_scribe_feedback'|'cfbp_ratings'/i.test(keysBlock),
  'storage.js\'s KEYS object carries no new scribe-feedback-shaped key (RG-55/RG-56 cap-trajectory avoidance, honored by construction)');

const scribeFeedbackSrc = await readFile(new URL('./js/scribeFeedback.js', import.meta.url), 'utf8');
assert(!/from '\.\/storage\.js'[\s\S]{0,80}?\b(save|load)\b/.test(scribeFeedbackSrc.replace(/\n/g, ' ')) &&
  !/import\s*\{\s*[^}]*\b(save|load)\b[^}]*\}\s*from\s*'\.\/storage\.js'/.test(scribeFeedbackSrc),
  'scribeFeedback.js imports getSettings() only from storage.js — never save()/load() — it cannot write a new seam key even by accident');
assert(/import\s*\{[^}]*sendEvent[^}]*\}\s*from\s*'\.\/chat\.js'/.test(scribeFeedbackSrc),
  'fixture check: recordFeedback() really does route through chat.js\'s sendEvent() (the append-only transport), confirming the prior assertion isn\'t vacuous');

// Canary — prove the scan WOULD catch a real offender (RG-27: a guard that
// cannot fail is not a guard).
const canaryKeysBlock = "const KEYS = {\n  SCRIBE_FEEDBACK: 'cfbp_scribe_feedback',\n};";
assert(/SCRIBE_FEEDBACK|'cfbp_scribe_feedback'/i.test(canaryKeysBlock), 'canary: the KEYS-scan regex DOES fire against a reintroduced KV key (not vacuous)');

// ═════════════════════════════════════════════════════════════════════════
// 8. F1 — adversarial linkify
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[8] F1 — adversarial linkify…');

_resetForTest();
storage.saveSetting('chatImagePreviewEnabled', false);

ingest([ev({ id: 'f1_xss', seq: 1, ts: 1000, author: 'p1', body: '<script>alert(1)</script> check https://evil.com/@drew' })]);
const xssHtml = _messageHTMLForTest(getMessage('f1_xss'), 'p1', false);
assert(!/<script>/.test(xssHtml), 'a raw <script> tag never reaches the DOM as a live tag — esc() ran first');
assert(/&lt;script&gt;/.test(xssHtml), 'the script tag renders as inert literal text (&lt;script&gt;)');
assert(/<a href="https:\/\/evil\.com\/@drew" rel="noopener noreferrer" target="_blank">https:\/\/evil\.com\/@drew<\/a>/.test(xssHtml),
  'the URL is STILL linkified alongside the inert script tag — escape-then-linkify ordering holds under adversarial input');

_resetForTest();
ingest([ev({ id: 'f1_at', seq: 1, ts: 1000, author: 'p1', body: 'profile: https://x.com/@drew nice' })]);
const atHtml = _messageHTMLForTest(getMessage('f1_at'), 'p1', false);
assert(/<a href="https:\/\/x\.com\/@drew"/.test(atHtml), "a URL containing '@' produces an uncorrupted href");
assert(!/<span class="chat-mention">@drew<\/span><\/a>/.test(atHtml) && !/href="https:\/\/x\.com\/<span/.test(atHtml),
  "the '@' inside the URL is never mention-ified — no <span> nested inside the href, no corrupted/mis-nested tag");

_resetForTest();
ingest([ev({ id: 'f1_punct', seq: 1, ts: 1000, author: 'p1', body: 'check this out (https://example.com).' })]);
const punctHtml = _messageHTMLForTest(getMessage('f1_punct'), 'p1', false);
assert(/<a href="https:\/\/example\.com"/.test(punctHtml), 'trailing ")." is excluded from the href — matches the exact design-input example');
assert(/<\/a>\)\./.test(punctHtml), 'the trimmed trailing punctuation still renders as ordinary text after the closing </a>');

_resetForTest();
ingest([ev({ id: 'f1_www', seq: 1, ts: 1000, author: 'p1', body: 'see www.example.com now' })]);
const wwwHtml = _messageHTMLForTest(getMessage('f1_www'), 'p1', false);
assert(/<a href="https:\/\/www\.example\.com"/.test(wwwHtml), 'a bare "www." prefix resolves to an https:// href (case-insensitive)');

// ═════════════════════════════════════════════════════════════════════════
// 9. F4-interim — settings-gated <img>, off by default
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[9] F4-interim — settings-gated inline image preview…');

_resetForTest();
ingest([ev({ id: 'f4_img', seq: 1, ts: 1000, author: 'p1', body: 'https://cdn.example.com/photo.jpg' })]);

storage.saveSetting('chatImagePreviewEnabled', false);
const imgOffHtml = _messageHTMLForTest(getMessage('f4_img'), 'p1', false);
assert(!/<img/.test(imgOffHtml), 'F4-interim OFF (default): no <img> rendered for a pasted image URL');
assert(/<a href="https:\/\/cdn\.example\.com\/photo\.jpg"/.test(imgOffHtml), 'the URL is still a plain linkified <a> with the flag off');

storage.saveSetting('chatImagePreviewEnabled', true);
const imgOnHtml = _messageHTMLForTest(getMessage('f4_img'), 'p1', false);
assert(/<img src="https:\/\/cdn\.example\.com\/photo\.jpg" loading="lazy" referrerpolicy="no-referrer" class="chat-img-preview"/.test(imgOnHtml),
  'F4-interim ON: an <img> renders with loading="lazy" and referrerpolicy="no-referrer" (design-input requirement)');

storage.saveSetting('chatImagePreviewEnabled', false);
const imgOffAgainHtml = _messageHTMLForTest(getMessage('f4_img'), 'p1', false);
assert(!/<img/.test(imgOffAgainHtml), 'toggling the flag back off removes ALL <img> rendering immediately (same structural on/off proof shape as E1)');

// non-image URL never renders an <img> even with the flag on
_resetForTest();
ingest([ev({ id: 'f4_nonimg', seq: 1, ts: 1000, author: 'p1', body: 'https://example.com/report.pdf' })]);
storage.saveSetting('chatImagePreviewEnabled', true);
assert(!/<img/.test(_messageHTMLForTest(getMessage('f4_nonimg'), 'p1', false)), 'a non-image-extension URL never renders an <img>, even with the flag on');
storage.saveSetting('chatImagePreviewEnabled', false);

// ═════════════════════════════════════════════════════════════════════════
// 10. F2 — search respects retention + epoch, case-insensitive literal
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[10] F2 — search respects retention/epoch, case-insensitive literal…');

_resetForTest();
storage.saveSetting('chatRetentionDays', 7);
storage.saveSetting('chatEpochSeq', 0);
const now = Date.now();
const OLD = now - 30 * 86400000;   // 30 days old — outside a 7-day retention window
ingest([
  ev({ id: 'srch_old', seq: 1, ts: OLD, author: 'p1', body: 'a backdoor cover happened here' }),
  ev({ id: 'srch_new', seq: 2, ts: now, author: 'p1', body: 'Backdoor Bust incoming' }),
]);
const retentionResults = getMessages({ tag: 'all', respectRetention: true, textContains: 'backdoor' });
assert(retentionResults.length === 1 && retentionResults[0].id === 'srch_new',
  'a retention-hidden message is NEVER returned by search, even on an exact text match');

storage.saveSetting('chatRetentionDays', 0);
storage.saveSetting('chatEpochSeq', 2);   // hides seq<=2 — both fixture messages
const epochResults = getMessages({ tag: 'all', respectRetention: true, textContains: 'backdoor' });
assert(epochResults.length === 0, 'an epoch-hidden message is never returned by search either (same reasoning, same choke point)');
storage.saveSetting('chatEpochSeq', 0);

const caseResults = getMessages({ tag: 'all', respectRetention: true, textContains: 'BUST' });
assert(caseResults.length === 1 && caseResults[0].id === 'srch_new', 'search is case-insensitive substring (BUST matches "Bust")');
const fuzzyResults = getMessages({ tag: 'all', respectRetention: true, textContains: 'backdorr' });
assert(fuzzyResults.length === 0, 'a near-miss typo returns NO results — literal substring, not fuzzy, matches the documented scope');

const clearedResults = getMessages({ tag: 'all', respectRetention: true, textContains: '' });
assert(clearedResults.length === 2, 'clearing the query (empty textContains) returns the full feed with no residual filtering');

// Mutation check (Testing Protocol step 16/RG-27): reproduce "textContains
// applied before retention/epoch filtering instead of after" LITERALLY — a
// text match short-circuits straight to inclusion, before the retention/
// epoch guards ever run for that item (the realistic implementation shape
// of that mistake: a bolt-on textContains check that returns/continues
// early, on a match, ahead of the existing retention/epoch `if...return`
// guards) — and confirm it goes RED (surfaces the retention-hidden message).
{
  const mutatedGetMessages = (filter = {}) => {
    const needle = filter.textContains ? String(filter.textContains).toLowerCase() : '';
    const out = [];
    for (const m of getMessages({ tag: 'all' })) {
      // MUTATION: a text match is included IMMEDIATELY — "before" the
      // retention/epoch checks below, which a matching item never reaches.
      if (needle && (m.body || '').toLowerCase().includes(needle)) { out.push(m); continue; }
      if (filter.respectRetention && chat.isHiddenByRetention(m)) continue;
      out.push(m);
    }
    return out;
  };
  storage.saveSetting('chatRetentionDays', 7);
  const mutantResults = mutatedGetMessages({ tag: 'all', respectRetention: true, textContains: 'backdoor' });
  assert(mutantResults.some(m => m.id === 'srch_old'),
    'MUTATION PROOF: a text match that short-circuits to inclusion BEFORE the retention/epoch guards run DOES surface a retention-hidden message — confirms the real getMessages() (retention/epoch checked BEFORE textContains) is load-bearing, not incidental');
  storage.saveSetting('chatRetentionDays', 0);
}

// ═════════════════════════════════════════════════════════════════════════
// 11. F3 — hidden-parent quote has no data-jump
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[11] F3 — quote-reply hidden/deleted-parent states…');

_resetForTest();
storage.saveSetting('chatRetentionDays', 0);
storage.saveSetting('chatEpochSeq', 0);
const nowF3 = Date.now();
ingest([
  ev({ id: 'f3_live', seq: 1, ts: nowF3, author: 'p1', body: 'a live parent' }),
  ev({ id: 'f3_reply_live', seq: 2, ts: nowF3 + 1000, author: 'p2', body: 'replying', replyTo: 'f3_live' }),
]);
const liveQuote = _quoteHTMLForTest(getMessage('f3_reply_live'));
assert(/data-jump="f3_live"/.test(liveQuote), 'a reply to a still-visible parent behaves exactly as today (regression guard)');
assert(!/chat-quote-hidden/.test(liveQuote) && !/chat-quote-muted/.test(liveQuote), 'a live parent gets neither the hidden nor the muted treatment');

// Retention-hidden parent
_resetForTest();
storage.saveSetting('chatRetentionDays', 7);
const OLD_F3 = Date.now() - 30 * 86400000;
ingest([
  ev({ id: 'f3_ret_parent', seq: 1, ts: OLD_F3, author: 'p1', body: 'an old parent' }),
  ev({ id: 'f3_ret_reply', seq: 2, ts: Date.now(), author: 'p2', body: 'replying', replyTo: 'f3_ret_parent' }),
]);
const retQuote = _quoteHTMLForTest(getMessage('f3_ret_reply'));
assert(!/data-jump/.test(retQuote), 'a reply to a retention-hidden parent renders NO data-jump attribute — not a dead button');
assert(/replying to an earlier message \(not shown\)/.test(retQuote), 'retention-hidden parent gets the exact copy the design input specifies');
assert(!/<button/.test(retQuote), 'retention-hidden parent quote is non-interactive — not a <button> at all');
storage.saveSetting('chatRetentionDays', 0);

// Epoch-hidden parent
_resetForTest();
ingest([
  ev({ id: 'f3_ep_parent', seq: 1, ts: Date.now(), author: 'p1', body: 'pre-launch test chatter' }),
  ev({ id: 'f3_ep_reply', seq: 2, ts: Date.now() + 1000, author: 'p2', body: 'replying', replyTo: 'f3_ep_parent' }),
]);
storage.saveSetting('chatEpochSeq', 1);
const epQuote = _quoteHTMLForTest(getMessage('f3_ep_reply'));
assert(!/data-jump/.test(epQuote), 'a reply to an epoch-hidden parent gets the SAME non-interactive treatment (same predicate, same copy)');
assert(/replying to an earlier message \(not shown\)/.test(epQuote), 'epoch-hidden parent gets the identical copy as retention-hidden');
storage.saveSetting('chatEpochSeq', 0);

// Deleted parent
_resetForTest();
ingest([
  ev({ id: 'f3_del_parent', seq: 1, ts: Date.now(), author: 'p1', body: 'will be withdrawn' }),
  { id: 'f3_del_ev', seq: 2, ts: Date.now() + 500, type: 'delete', targetId: 'f3_del_parent', author: 'p1', notify: false },
  ev({ id: 'f3_del_reply', seq: 3, ts: Date.now() + 1000, author: 'p2', body: 'replying', replyTo: 'f3_del_parent' }),
]);
const delQuote = _quoteHTMLForTest(getMessage('f3_del_reply'));
assert(/data-jump="f3_del_parent"/.test(delQuote), 'a reply to a DELETED parent still jumps correctly to the tombstone row');
assert(/chat-quote-muted/.test(delQuote), 'the deleted-parent quote gains the new muted styling class');
assert(/message withdrawn/.test(delQuote), 'deleted-parent copy is unchanged ("message withdrawn")');

// ═════════════════════════════════════════════════════════════════════════
// 12. Part 0b correction #6 (binding) — full-range transport read, not the fold
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[12] Correction #6 — getAllFeedbackSince() reads the TRANSPORT, never the client fold…');

_resetForTest();   // the local fold is now COMPLETELY EMPTY — no feedback events ingested at all

backend.setDataMode('supabase');

// A large remote log — 2500 feedback events + 5 interspersed plain messages
// — served ONLY via the fetch stub below — the local fold (S.items, above)
// never sees any of these events. If getAllFeedbackSince() were fold-based
// (Document 2's own FIRST draft, superseded by correction #6), it would
// return an empty array here regardless of what the stub serves — that's
// exactly the failure mode this section proves is NOT what shipped.
//
// Sized deliberately past backend/Code.gs's own hard cap — `chatSince()`
// clamps `limit = Math.max(1, Math.min(limit||500, 1000))` regardless of
// what's requested, so ANY season-scale read is a multi-page read in
// production. The stub below reproduces that EXACT clamp formula (not an
// arbitrary smaller page size) so this is a faithful rehearsal of the real
// constraint, not a contrived one.
const REMOTE_LOG = [];
for (let i = 1; i <= 2505; i++) {
  if (i % 501 === 0) {
    REMOTE_LOG.push({ id: `rm${i}`, seq: i, ts: 1000 + i, type: 'message', author: 'p2', body: 'not feedback', gameTag: '', notify: true, replyTo: '', targetId: '' });
  } else {
    REMOTE_LOG.push({ id: `rf${i}`, seq: i, ts: 1000 + i, type: 'feedback', targetId: 'remote_s1', author: i % 2 ? 'p1' : 'p2', meta: { category: 'rating', value: i % 3 === 0 ? 'hit' : 'mid' } });
  }
}
// Overwrite the very last event with a distinctive, individually-asserted
// rewrite — proves the LAST page (not just the first) really comes back.
REMOTE_LOG[REMOTE_LOG.length - 1] = { id: 'rf_last', seq: 2505, ts: 999999, type: 'feedback', targetId: 'remote_s1', author: 'p1', meta: { category: 'rewrite', value: 'a much better line' } };
const REMOTE_HEAD = REMOTE_LOG.length;
const EXPECTED_FEEDBACK_COUNT = REMOTE_LOG.filter(e => e.type === 'feedback').length;
// PORTED 2026-09-23. This stub used to parse an Apps Script URL, because
// `js/chatTransport.js` had its own `get()`/`post()`. Those are deleted; a
// serveable transport is now a Supabase chat context. The CLAMP IS UNCHANGED —
// it is still a faithful rehearsal of a real server-side page cap, and the
// server that caps it now is PostgREST's `.limit()` rather than Code.gs's
// `Math.max(1, Math.min(limit||500, 1000))`.
const { installFakeChat } = await import('./testchatfake.mjs');
const projectionFB = await import('./js/supabase-projection.js');
const transportFB = await import('./js/chatTransport.js');
const fakeFB = installFakeChat(transportFB, projectionFB, {
  head: () => REMOTE_HEAD,
  since: (seq, requested) => {
    const limit = Math.max(1, Math.min(Number(requested) || 500, 1000));
    return { events: REMOTE_LOG.filter(e => e.seq > seq).slice(0, limit) };
  },
});

let allFeedback;
try {
  allFeedback = await getAllFeedbackSince(0);
} finally {
  fakeFB.uninstall();
}
const fetchCallCount = fakeFB.calls.filter(c => c.action === 'chatSince').length;

assert(fetchCallCount >= 3, `fixture check: 2505 remote events past a 1000-event server cap forced multiple round trips (got ${fetchCallCount} calls) — proves this is really paginating, not one lucky call`);
assert(allFeedback.length === EXPECTED_FEEDBACK_COUNT,
  `getAllFeedbackSince() returns all ${EXPECTED_FEEDBACK_COUNT} remote feedback events across multiple pages (got ${allFeedback.length})`);
assert(allFeedback.every(e => e.type === 'feedback'), 'only type:"feedback" events are returned — the 5 interspersed plain-message events are filtered out');
assert(allFeedback.some(e => e.id === 'rf1') && allFeedback.some(e => e.id === 'rf_last'),
  'both the FIRST page\'s and the LAST page\'s feedback events are present — confirms full pagination, not just the first page');
assert(getFeedbackFor('remote_s1').p1 === undefined,
  'THE POINT: this device\'s own fold (getFeedbackFor, section [6]\'s mechanism) has NO knowledge of remote_s1 at all — getAllFeedbackSince() reached data the client fold structurally cannot see, proving it is transport-based, not fold-based (Part 0b correction #6)');
assert(allFeedback.find(e => e.id === 'rf_last')?.meta.value === 'a much better line',
  'fixture check: the LAST page\'s rewrite text is returned exactly, not mangled by the pagination loop');

backend.setDataMode('sheets');

// ═════════════════════════════════════════════════════════════════════════
// 13. Part 0b correction #7 (binding) — "Weigh in" accepts a rewrite
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[13] Correction #7 — Weigh in accepts an optional rewrite-shaped text…');

_resetForTest();
ingest([ev({ id: 'wi_human', seq: 1, ts: 1000, author: 'p2', body: 'SCRIBE missed this one' })]);

// Bare flag (blank text submitted) — value is the boolean true. A single
// FIRST write to this key, so the real recordFeedback() API is used directly.
recordFeedback({ targetId: 'wi_human', category: 'weigh_in', value: true, author: 'p1' });
assert(getFeedbackFor('wi_human').p1.weigh_in === true, 'Weigh in with no text stores the bare boolean flag');

// WITH text, as a SECOND write to the SAME key — this is the "missed-moment
// rewrite" correction #7 requires; the highest-value data (per the briefing)
// rides the SAME category, not a silently-dropped bare flag. Same {0,0}-tie
// reasoning as section [2]: a second write to one key needs an explicit,
// later (seq, ts) via direct ingest.
ingest([{ id: 'wi_ev2', type: 'feedback', targetId: 'wi_human', author: 'p1', notify: false, seq: 2, ts: 2000,
  meta: { category: 'weigh_in', value: 'SCRIBE should have called that a bust' } }]);
assert(getFeedbackFor('wi_human').p1.weigh_in === 'SCRIBE should have called that a bust',
  'Weigh in WITH text stores the suggested line itself, not just a flag — correction #7\'s explicit requirement ("a bare flag drops the highest-value data")');
assert(typeof getFeedbackFor('wi_human').p1.weigh_in === 'string', 'the weigh_in value is genuinely the text (a string), not a truncated/boolean-coerced placeholder');

// ═════════════════════════════════════════════════════════════════════════
// 14. E2 — meta.triggerMessageId / meta.scribeVersion round-trip
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[14] E2 — meta.triggerMessageId / meta.scribeVersion on SCRIBE posts…');

_resetForTest();
// Build 2, Group C (2026-09-10) — the mention branch now calls the
// interactive (LLM-backed) runtime first and only falls back to the tier-0
// canned pool afterward, so `scribeInspectMessage()`'s mention path is now
// genuinely async (it always was a network call in production; the OLD
// synchronous canned-line-only contract was the thing that couldn't survive
// this feature existing). The backend isn't configured in this test
// environment, so `scribeAskRemote()` rejects immediately and this resolves
// via the SAME degraded-fallback path exercised in scribetest.mjs.
const mentionOk = await scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: '@scribe how am I doing', gameTag: '', triggerMessageId: 'human_msg_42' });
assert(mentionOk === true, 'fixture check: the @scribe mention trigger actually fired (not rate-limited/pool-exhausted)');
const scribeReply = getMessages({ tag: 'all', types: ['message'] }).find(m => m.author === 'scribe');
assert(!!scribeReply, 'fixture check: a SCRIBE reply was actually folded');
assert(scribeReply.meta?.triggerMessageId === 'human_msg_42', 'meta.triggerMessageId threads the calling human message\'s id through scribeInspectMessage() → scribeTrigger() → the folded event');
assert(scribeReply.meta?.scribeVersion === SCRIBE_VERSION, 'meta.scribeVersion round-trips exactly like meta.source/meta.trigger already do');
// ── DI-267 (SCRIBE v3, Package A, 2026-09-23) — THE TWO HEAT FIELDS RIDE THE
//    SAME META, ON THE SAME POST. `heatLeague` is the dial the commissioner
//    set; `heatEffective` is what the line that actually went out was. On the
//    TIER-0 path the second is ALWAYS 'dry', and that is a fact rather than a
//    default: the canned pools are written in one register and are not tagged
//    by level (js/scribeLines.js's own SCRIBE v3 block gives the three reasons).
//    Stamping BOTH is what lets a Trainer report tell "the league was at No
//    Mercy and this landed flat" apart from "this ran at No Mercy and landed
//    flat" — on this path only the first is ever true, because tier-0 fires
//    precisely when the model was unreachable, throttled, over budget or off.
assert(typeof scribeReply.meta?.heatLeague === 'string' && scribeReply.meta.heatLeague.length > 0,
  `DI-267: a tier-0 SCRIBE post carries meta.heatLeague — the dial as it stood when the line was written (got ${JSON.stringify(scribeReply.meta?.heatLeague)})`);
assert(scribeReply.meta?.heatEffective === 'dry',
  `DI-267: …and meta.heatEffective is 'dry' on this path ALWAYS — a canned line IS a Dry line whatever the dial says. A tier-0 post stamped with the league's hot level would be evidence about a heat this line never ran at (got ${JSON.stringify(scribeReply.meta?.heatEffective)})`);
assert(scribeReply.meta?.source === 'tier0' && !!scribeReply.meta?.trigger, 'fixture check: the pre-existing meta.source/meta.trigger fields are unaffected by this addition');
assert(!('activeLearningSnapshot' in (scribeReply.meta || {})), 'meta.activeLearningSnapshot stays UNSET (reserved for E3/E4, never fielded with a placeholder)');

// An event-driven trigger (no human message caused it) correctly omits triggerMessageId.
_resetForTest();
scribeTrigger('anniversary', { subject: 'anniv_x', vars: { name: 'the chart' } });
const annivMsg = getMessages({ tag: 'all', types: ['message'] }).find(m => m.author === 'scribe');
assert(!!annivMsg && annivMsg.meta?.scribeVersion === SCRIBE_VERSION, 'an event-driven trigger still carries scribeVersion');
assert(!('triggerMessageId' in (annivMsg.meta || {})), 'an event-driven trigger correctly has NO triggerMessageId — there is no single human message that caused it');

// ═════════════════════════════════════════════════════════════════════════
// REMEDIATION BUILD 1 (2026-09-10, reviewer BLOCK) — findings 1-11
// ═════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════
// 15. Finding #1 (BLOCKING) — "Rewrite saved." toast bypasses suppression
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[15] Finding #1 — showToast(..., {force:true}) enqueues/renders from a simulated chat-page context…');
{
  const realDoc = globalThis.document;
  const created = {};
  const fakeDoc = {
    addEventListener() {}, removeEventListener() {},
    getElementById: id => created[id] || null,
    // Simulates: the chat page IS the active page — the EXACT context the
    // rewrite/weigh-in modal's Submit button fires from (the modal only
    // opens from a message rendered inside the chat feed).
    querySelector: sel => (sel === '#page-chat.active' ? {} : null),
    querySelectorAll: () => [],
    createElement: () => ({
      _html: '', id: '', className: '', dataset: {},
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
      appendChild() {}, remove() { delete created[this.id]; },
      addEventListener() {}, removeEventListener() {},
      classList: { add() {}, remove() {} }, style: {},
      querySelector: () => null,
    }),
    body: { classList: { add() {}, remove() {} }, appendChild(el) { if (el?.id) created[el.id] = el; }, innerHTML: '' },
    hidden: false,
  };
  globalThis.document = fakeDoc;
  try {
    chatUi._resetToastsForTest();
    assert(chatUi._toastWouldSuppress(false) === true,
      'fixture check: without force, the simulated chat-page context suppresses this toast (reproduces the reported bug)');

    // The OLD (pre-fix) call shape — showToast('Rewrite saved.') with no
    // force — never reaches the DOM at all on this page.
    chatUi._showToastForTest({ author: 'system', body: 'Rewrite saved.' });
    assert(!created['chat-toast'],
      'fixture check: showToast() WITHOUT force is suppressed on the chat page — no toast node created (reproduces the pre-fix bug)');

    // The ACTUAL fix (chat-ui.js's rewrite/weigh-in submit handler) —
    // force:true bypasses suppression and the toast really renders.
    chatUi._resetToastsForTest();
    chatUi._showToastForTest({ author: 'system', body: 'Rewrite saved.' }, { force: true });
    assert(!!created['chat-toast'] && /Rewrite saved\./.test(created['chat-toast']._html),
      'finding #1: showToast({author:"system",body:"Rewrite saved."}, {force:true}) enqueues AND renders even from the chat-page context');
  } finally {
    globalThis.document = realDoc;
    chatUi._resetToastsForTest();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// 16. Finding #2 (BLOCKING, CSS) — .feedback-picker-wrap grid reset
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[16] Finding #2 (CSS) — .feedback-picker-wrap resets the inherited .reaction-picker grid…');
const cssSrc = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
assert(/\.feedback-picker-wrap\{display:block !important;grid-template-columns:none !important/.test(cssSrc),
  '.feedback-picker-wrap resets .reaction-picker\'s inherited display:grid/grid-template-columns back to a plain flow container');
assert(/@media \(max-width:384px\)\{\s*\.feedback-picker-grid\{grid-template-columns:1fr/.test(cssSrc),
  'the single-column fallback breakpoint is now ≤384px (widened from ≤360px on 2026-09-10 — the 320px two-column popover overflows a 375px iPhone by 7px, reviewer geometry)');
assert(!/@media \(max-width:320px\)\{\s*\.feedback-picker-grid/.test(cssSrc),
  'the old ≤320px breakpoint for .feedback-picker-grid is gone, not just duplicated alongside the new one');
assert(!/Coordinator: merge these rules/.test(cssSrc),
  'finding #10: the stale scratch-file header comment (implying this still needed manual merging) is removed from the E/F CSS block');

// ═════════════════════════════════════════════════════════════════════════
// 17. Finding #2 (BLOCKING, JS) — feedback popover survives the reveal-closer
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[17] Finding #2 — the feedback popover survives the document-level reveal-closer (chat-ui.js ~1903)…');
{
  const realDoc = globalThis.document;
  const targets = {};
  const capturedDoc = {};
  function fakeMsgFb(mid) {
    const classes = new Set();
    const el = { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
    targets[mid] = el;
    return el;
  }
  const fakeDoc = {
    addEventListener: (type, fn) => { (capturedDoc[type] ||= []).push(fn); },
    removeEventListener() {},
    getElementById: () => null,
    querySelector: sel => {
      const m = /^(?:#[\w-]+ )?\.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
      return m ? (targets[m[1]] || null) : null;
    },
    querySelectorAll: () => [],
    createElement: () => ({ appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, dataset: {}, set innerHTML(v) {}, get innerHTML() { return ''; } }),
    body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
    hidden: false,
  };
  globalThis.document = fakeDoc;
  try {
    chatUi._wireRevealCloser();
    assert(Array.isArray(capturedDoc.click) && capturedDoc.click.length > 0, 'fixture check: wireRevealCloser() registered a document click handler');

    const msgFb = fakeMsgFb('fb_reveal_msg');
    chatUi._revealMessageActions('fb_reveal_msg');
    // toggleFeedbackPicker() appends the popover as a child of
    // `.chat-actions` (host = anchorEl.closest('.chat-actions') || anchorEl),
    // and `.chat-actions` is ALWAYS rendered as a descendant of
    // `.chat-msg[data-mid=...]` in messageHTML()'s own template — so a click
    // anywhere inside the popover satisfies the SAME `.closest('.chat-msg
    // [data-mid=...]')` check the reveal-closer uses to decide "inside the
    // revealed message, do not dismiss."
    capturedDoc.click[0]({ target: { closest: sel => (sel === '.chat-msg[data-mid="fb_reveal_msg"]' ? {} : null) } });
    assert(msgFb._classes.has('chat-actions-revealed'),
      'finding #2: a click inside the feedback popover does NOT trigger the reveal-closer\'s dismiss — the popover survives document-level click dismissal');

    // Contrast check — a click genuinely outside the message still dismisses,
    // proving the closer itself is live (not merely disabled/never firing).
    capturedDoc.click[0]({ target: { closest: () => null } });
    assert(!msgFb._classes.has('chat-actions-revealed'),
      'fixture check: a click genuinely outside the revealed message still dismisses it — the closer is live, not disabled');
  } finally {
    globalThis.document = realDoc;
    chatUi._dismissRevealedActions();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// 18. Finding #3 (BLOCKING) — prototype-pollution guard
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[18] Finding #3 — prototype-pollution guard (feedback fold + react/unreact)…');

_resetForTest();
ingest([ev({ id: 'poison_target', seq: 1, ts: 1000, author: 'p1', body: 'target' })]);

ingest([{ id: 'poison_author_ev', seq: 2, ts: 2000, type: 'feedback', targetId: 'poison_target', author: '__proto__', meta: { category: 'polluted', value: 'PWNED' } }]);
assert(({}).polluted === undefined, 'a feedback event with author="__proto__" never pollutes Object.prototype — ({}).polluted stays undefined');
assert(Object.keys(getMessage('poison_target').feedback).length === 0,
  'the poisoned (author="__proto__") event is dropped entirely — target.feedback gains no entry for it');

ingest([{ id: 'poison_cat_ev', seq: 3, ts: 3000, type: 'feedback', targetId: 'poison_target', author: 'p1', meta: { category: '__proto__', value: 'PWNED2' } }]);
assert(({}).PWNED2 === undefined, 'a feedback event with category="__proto__" never pollutes Object.prototype either');
assert(!getMessage('poison_target').feedback.p1, 'a category-poisoned event is dropped — no p1 entry is created at all');

ingest([{ id: 'poison_ctor_ev', seq: 4, ts: 4000, type: 'feedback', targetId: 'poison_target', author: 'constructor', meta: { category: 'rating', value: 'hit' } }]);
ingest([{ id: 'poison_proto_ev', seq: 5, ts: 5000, type: 'feedback', targetId: 'poison_target', author: 'p2', meta: { category: 'prototype', value: 'hit' } }]);
// hasOwnProperty, not a truthy `.constructor` check — target.feedback started
// life as a plain `{}` (newItem()'s initial value, before any accepted
// mutation ever replaces it with the guarded Object.create(null) rebuild),
// so `.constructor` is ALWAYS truthy on it via the ordinary Object.prototype
// inheritance every plain object has — that inherited built-in is not the
// vulnerability and a naive truthy check would false-positive on it.
const ptFeedback = getMessage('poison_target').feedback;
assert(!Object.prototype.hasOwnProperty.call(ptFeedback, 'constructor'),
  '"constructor" as an author is rejected — no OWN "constructor" entry is ever added to target.feedback');
assert(!Object.prototype.hasOwnProperty.call(ptFeedback, 'p2'),
  '"prototype" as a category rejects the WHOLE event — no OWN "p2" entry either (author alone isn\'t enough to accept it)');

assert(Object.keys(Object.prototype).length === 0,
  'Object.prototype has no enumerable own properties after every poisoned event above — the real guard held throughout');

// react/unreact branch — same object-key shape, hardened identically per the
// review instruction ("check the pre-existing react branch... if cheap").
_resetForTest();
ingest([ev({ id: 'poison_react_target', seq: 1, ts: 1000, author: 'p1', body: 'react target' })]);
// Harness robustness (test-only pass, item c) — chat.js:349's own comment
// spells out WHY this exact call is dangerous if its guard ever regresses:
// `obj['__proto__']` reads back the real Object.prototype (an accessor, not
// an own property), so `next[em] = next[em] || []` never assigns a fresh
// array, and the following `.push(author)` throws `next[em].push is not a
// function` — a genuine uncaught exception, not a silent mis-pollution like
// the 'feedback'-branch pokes above. An uncaught throw HERE would crash this
// entire 25+-section file with no final pass/fail total (Testing Protocol:
// "a crashing suite reports nothing"). try/catch converts a regressed guard
// into ONE recorded failure and lets every later section still run. Proven
// for real below (not just asserted) — see the mutant-chat.js block right
// after this one.
try {
  ingest([{ id: 'poison_react_ev', seq: 2, ts: 2000, type: 'react', targetId: 'poison_react_target', author: 'p1', notify: false, meta: { emoji: '__proto__' } }]);
  assert(Object.keys(getMessage('poison_react_target').reactions).length === 0,
    'a react event with meta.emoji="__proto__" is dropped — no reaction entry created, and ingest() does not crash or pollute');
} catch (e) {
  assert(false, `the react-branch prototype-pollution guard is ABSENT or broken — ingest() threw instead of dropping the poisoned event (${e.message}) — recorded as a failure, not a crash`);
}

// Mutation proof (non-file, inline, cleaned up immediately in a try/finally)
// — reproduces the EXACT pre-fix shape from applyTo()'s 'feedback' branch to
// prove the assertions above are load-bearing, not vacuous (RG-27).
{
  const before = Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted');
  try {
    const nextFeedback = {};
    const opAuthor = '__proto__', opCategory = 'polluted', opValue = 'PWNED';
    // The UNGUARDED pre-fix line, verbatim:
    (nextFeedback[opAuthor] = nextFeedback[opAuthor] || {})[opCategory] = opValue;
    assert(({}).polluted === 'PWNED',
      'MUTATION PROOF: the pre-fix shape (no key guard) DOES pollute Object.prototype when author="__proto__" — confirms the real applyTo()/react guards above are load-bearing, not incidental');
  } finally {
    delete Object.prototype.polluted;   // always clean up, even if the assertion above throws
    assert(!before, 'fixture check: Object.prototype.polluted did not pre-exist before this mutation probe');
  }
}
assert(({}).polluted === undefined, 'fixture check: the mutation-proof cleanup fully restored Object.prototype — no leakage into later assertions');

// ── Harness robustness proof (test-only pass, item c) — a REAL tmpdir copy
// of chat.js with the react-branch guard line removed, never real source.
// Proves two things the try/catch above only asserts on faith: (i) the
// mutant genuinely throws `next[em].push is not a function` — this is a
// real crash risk, not a hypothetical — and (ii) the SAME try/catch shape
// used above genuinely converts that throw into a recorded failure and lets
// execution continue past it, instead of the process dying uncaught.
{
  // XSS-HARDEN round 3 (F3-1, 2026-09-12): the react branch now has TWO
  // guards, not one. The palette allow-list added directly beneath
  // isUnsafeKey() also rejects '__proto__' (it is not one of the 18
  // REACTION_PALETTE emoji), so stripping only the isUnsafeKey line no longer
  // reaches the crash — the mutant silently survived and this block went red
  // while chat.js was in fact SAFER than before. Both guards are stripped so
  // the mutation still demonstrates the real underlying crash. Neither guard
  // is redundant in production: isUnsafeKey() states the prototype-pollution
  // intent at the object-key boundary, the palette allow-list is the XSS
  // boundary, and each is the other's backstop.
  const GUARD_LINE = '    if (isUnsafeKey(emoji)) return;';
  const PALETTE_GUARD_LINE = '    if (!REACTION_PALETTE.includes(emoji)) return;';
  const realChatSrc = await readFile(new URL('./js/chat.js', import.meta.url), 'utf8');
  assert(realChatSrc.includes(GUARD_LINE), 'fixture check: the exact react-branch guard line is present in real chat.js (an unindented/reworded line would silently no-op this mutation)');
  assert(realChatSrc.split(GUARD_LINE).length - 1 === 1, 'fixture check: the guard line is UNIQUE in chat.js — not accidentally stripping a second occurrence');
  assert(realChatSrc.includes(PALETTE_GUARD_LINE), 'fixture check: the emoji ALLOW-LIST guard line is present in real chat.js (XSS-HARDEN round 3) — it is the second guard this mutation must remove');
  assert(realChatSrc.split(PALETTE_GUARD_LINE).length - 1 === 1, 'fixture check: the allow-list guard line is UNIQUE in chat.js');

  const gDir = await createMutantDir('chat.js', src => src.replace(GUARD_LINE, '').replace(PALETTE_GUARD_LINE, ''));
  const gMod = await importFromMutantDir(gDir, 'chat.js');
  gMod._resetForTest();
  gMod.ingest([{ gameTag: '', type: 'message', author: 'p1', body: 'react target', notify: true, id: 'g_react_target', seq: 1, ts: 1000 }]);

  let mutantThrew = false, mutantErrMsg = '';
  try {
    gMod.ingest([{ id: 'g_react_ev', seq: 2, ts: 2000, type: 'react', targetId: 'g_react_target', author: 'p1', notify: false, meta: { emoji: '__proto__' } }]);
  } catch (e) { mutantThrew = true; mutantErrMsg = e.message; }
  assert(mutantThrew === true && /push is not a function/.test(mutantErrMsg),
    `MUTATION CONFIRMED: with the react-branch guard removed, ingest() genuinely throws "${mutantErrMsg}" — the crash risk try/catch above guards against is real, not hypothetical`);

  // Same try/catch SHAPE as the real §18 block above, against the SAME
  // mutant — records ONE failure (never a process-killing crash) and this
  // very line, right after it, is proof execution kept going.
  try {
    gMod.ingest([{ id: 'g_react_ev2', seq: 3, ts: 3000, type: 'react', targetId: 'g_react_target', author: 'p1', notify: false, meta: { emoji: '__proto__' } }]);
    assert(false, 'unreachable under the mutant — ingest() is expected to throw here');
  } catch (e) {
    assert(true, `the wrap pattern recorded ONE failure instead of crashing (${e.message}) — and execution reaches this line, proving item (c)'s property: the suite does not die here`);
  }

  await rm(gDir, { recursive: true, force: true }).catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════
// 19. Finding #4 (BLOCKING) — feedback popover render-layer coverage
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[19] Finding #4 — _feedbackPopoverHTMLForTest: all six controls, D6 equal styling, .active reflects rater\'s own state…');

_resetForTest();
ingest([
  ev({ id: 'pop_scribe', seq: 1, ts: 1000, author: 'scribe', body: 'a scribe line' }),
  ev({ id: 'pop_human', seq: 2, ts: 2000, author: 'p2', body: 'a human line' }),
]);

const scribePopHtml = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_scribe'), 'p1');
assert(/🔥 Hit/.test(scribePopHtml) && /data-fb-rating="hit"/.test(scribePopHtml), 'SCRIBE popover: 🔥 Hit control + data-fb-rating="hit"');
assert(/😐 Mid/.test(scribePopHtml) && /data-fb-rating="mid"/.test(scribePopHtml), 'SCRIBE popover: 😐 Mid control + data-fb-rating="mid"');
assert(/🚫 Too much/.test(scribePopHtml) && /data-fb-rating="too_much"/.test(scribePopHtml), 'SCRIBE popover: 🚫 Too much control + data-fb-rating="too_much"');
assert(/✏️ Rewrite/.test(scribePopHtml) && /data-fb-rewrite="1"/.test(scribePopHtml), 'SCRIBE popover: ✏️ Rewrite control + data-fb-rewrite="1"');

const humanPopHtml = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_human'), 'p1');
assert(/📌 Remember this/.test(humanPopHtml) && /data-fb-remember="1"/.test(humanPopHtml), 'human popover: 📌 Remember this control + data-fb-remember="1"');
assert(/👁 Weigh in/.test(humanPopHtml) && /data-fb-weighin="1"/.test(humanPopHtml), 'human popover: 👁 Weigh in control + data-fb-weighin="1"');

// D6 — equal visual weight: no option carries a distinct emphasis class.
const allOptionClasses = [...scribePopHtml.matchAll(/class="([^"]*feedback-pick-option[^"]*)"/g)].map(m => m[1]);
assert(allOptionClasses.length === 4, 'fixture check: exactly 4 options rendered in the SCRIBE popover');
assert(allOptionClasses.every(c => c.replace('feedback-pick-option', '').trim() === '' || c.replace('feedback-pick-option', '').trim() === 'active'),
  'D6: every SCRIBE-popover option carries ONLY "feedback-pick-option" (+"active" if it is the rater\'s own value) — no distinct emphasis class on 🚫 Too much or any other option');

// ── Extended (test-only pass, item b) — .active for EVERY own-state
// control, not just too_much/remember. Same target message, same "latest
// replaces" semantics chat.js already guarantees for the 'rating' category
// (§2) — each step proves the NEW control goes active AND the PREVIOUS one
// stops being active, not stacked.
//
// Direct ingest() with EXPLICIT increasing (seq, ts), not chained
// recordFeedback() calls — same {0,0}-tie reasoning as section [2]/[13]'s
// own comments: sendEvent() (what recordFeedback() calls) never sets
// ts/seq, so every recordFeedback()-originated event stamps as {ts:0,
// seq:0}; a SECOND write to the SAME (author,category) key ties
// cmpOrder(cur.stamp, stamp) >= 0 and is silently dropped, not replaced.
// hit → mid → too_much are three writes to the one 'rating' key, so all
// three need explicit, distinct, increasing stamps.
const fbevPop = (targetId, meta, seq, ts) => ({ id: `fbk_${targetId}_${seq}`, type: 'feedback', targetId, author: 'p1', notify: false, seq, ts, meta });

ingest([fbevPop('pop_scribe', { category: 'rating', value: 'hit' }, 101, 101000)]);
const scribePopActiveHit = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_scribe'), 'p1');
assert(/class="feedback-pick-option active" data-fb-rating="hit"/.test(scribePopActiveHit),
  '.feedback-pick-option.active reflects the RATER\'S OWN current rating (hit)');
assert(!/class="feedback-pick-option active" data-fb-rating="mid"/.test(scribePopActiveHit) &&
  !/class="feedback-pick-option active" data-fb-rating="too_much"/.test(scribePopActiveHit),
  'only the hit control carries .active — mid/too_much do not');

ingest([fbevPop('pop_scribe', { category: 'rating', value: 'mid' }, 102, 102000)]);
const scribePopActiveMid = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_scribe'), 'p1');
assert(/class="feedback-pick-option active" data-fb-rating="mid"/.test(scribePopActiveMid),
  '.feedback-pick-option.active reflects the RATER\'S OWN current rating (mid)');
assert(!/class="feedback-pick-option active" data-fb-rating="hit"/.test(scribePopActiveMid),
  're-rating REPLACES, not stacks — hit is no longer active once mid is recorded');

// .active reflects the RATER'S OWN value — mutation proof (a): delete 📌
// from the popover below proves this suite actually exercises the real
// template; see the manual mutation-test log in the handoff report.
ingest([fbevPop('pop_scribe', { category: 'rating', value: 'too_much' }, 103, 103000)]);
const scribePopActiveMine = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_scribe'), 'p1');
assert(/class="feedback-pick-option active" data-fb-rating="too_much"/.test(scribePopActiveMine),
  '.feedback-pick-option.active reflects the RATER\'S OWN current rating (too_much)');
const scribePopActiveOther = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_scribe'), 'p2');
assert(!/class="feedback-pick-option active" data-fb-rating="too_much"/.test(scribePopActiveOther),
  'a DIFFERENT viewer (p2, no rating yet) does not see too_much marked active — active reflects the CALLER\'s own state');

// data-fb-rewrite — the DI names this "filled/checked" state explicitly
// (chat-ui.js's own docstring on feedbackPopoverHTML(), quoted verbatim:
// "shows a filled/checked state... so the rater can tell they already wrote
// one"). 'rewrite' and 'rating' are disjoint categories (chat.js comment,
// §2) so this coexists with the too_much rating just recorded above.
recordFeedback({ targetId: 'pop_scribe', category: 'rewrite', value: 'a rewritten line', author: 'p1' });
const scribePopActiveRewrite = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_scribe'), 'p1');
assert(/class="feedback-pick-option active" data-fb-rewrite="1"/.test(scribePopActiveRewrite),
  '.feedback-pick-option.active reflects the rater\'s own rewrite state — the DI\'s explicit "filled/checked" requirement');

recordFeedback({ targetId: 'pop_human', category: 'remember_this', value: true, author: 'p1' });
const humanPopActive = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_human'), 'p1');
assert(/class="feedback-pick-option active" data-fb-remember="1"/.test(humanPopActive),
  '.feedback-pick-option.active reflects the rater\'s own remember_this state on the human-message popover too');

// data-fb-weighin — same mechanism, human-message popover.
recordFeedback({ targetId: 'pop_human', category: 'weigh_in', value: true, author: 'p1' });
const humanPopActiveWeighin = chatUi._feedbackPopoverHTMLForTest(getMessage('pop_human'), 'p1');
assert(/class="feedback-pick-option active" data-fb-weighin="1"/.test(humanPopActiveWeighin),
  '.feedback-pick-option.active reflects the rater\'s own weigh_in state');

// ── data-fb-rewrite mutation proof (test-only pass, item b) — a REAL
// tmpdir copy of chat-ui.js with the `${mine.rewrite ? ' active' : ''}`
// ternary removed from feedbackPopoverHTML(), never real source. chat-ui.js,
// scribeFeedback.js and chat.js are all imported from the SAME mutant dir
// so they share one singleton graph (see createMutantDir/importFromMutantDir
// above) — recordFeedback() really does route the rewrite through the
// mutant's own chat.js fold, exactly like production.
{
  const chatUiSrc19 = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  const REWRITE_LINE = '      <button type="button" class="feedback-pick-option${mine.rewrite ? \' active\' : \'\'}" data-fb-rewrite="1">✏️ Rewrite</button>';
  const REWRITE_LINE_MUTATED = '      <button type="button" class="feedback-pick-option" data-fb-rewrite="1">✏️ Rewrite</button>';
  assert(chatUiSrc19.includes(REWRITE_LINE), 'fixture check: the exact ✏️ Rewrite control line is present in real chat-ui.js (an unindented/reworded line would silently no-op this mutation)');
  assert(chatUiSrc19.split(REWRITE_LINE).length - 1 === 1, 'fixture check: the line is UNIQUE in chat-ui.js');

  const rDir = await createMutantDir('chat-ui.js', src => src.replace(REWRITE_LINE, REWRITE_LINE_MUTATED));
  const rChatMod = await importFromMutantDir(rDir, 'chat.js');
  const rScribeFeedbackMod = await importFromMutantDir(rDir, 'scribeFeedback.js');
  const rChatUiMod = await importFromMutantDir(rDir, 'chat-ui.js');

  rChatMod._resetForTest();
  rChatMod.ingest([{ gameTag: '', type: 'message', author: 'scribe', body: 'a scribe line', notify: true, id: 'r_pop_scribe', seq: 1, ts: 1000 }]);
  rScribeFeedbackMod.recordFeedback({ targetId: 'r_pop_scribe', category: 'rewrite', value: 'a rewritten line', author: 'p1' });
  const mutantRewritePopHtml = rChatUiMod._feedbackPopoverHTMLForTest(rChatMod.getMessage('r_pop_scribe'), 'p1');
  assert(!/class="feedback-pick-option active" data-fb-rewrite="1"/.test(mutantRewritePopHtml) && /data-fb-rewrite="1"/.test(mutantRewritePopHtml),
    'MUTATION CONFIRMED: with the ternary removed, data-fb-rewrite is still rendered but NEVER carries .active, even with a rewrite on file — the real assertion above is load-bearing, not vacuous (RG-27)');

  await rm(rDir, { recursive: true, force: true }).catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════
// 20. Finding #4 (BLOCKING) — search results honor retention/epoch THROUGH
//     the render function itself (not just getMessages())
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[20] Finding #4 — _searchResultsHTMLForTest honors retention/epoch through the render function…');

_resetForTest();
storage.saveSetting('chatRetentionDays', 7);
storage.saveSetting('chatEpochSeq', 0);
const nowSR = Date.now();
const OLD_SR = nowSR - 30 * 86400000;
ingest([
  ev({ id: 'sr_old', seq: 1, ts: OLD_SR, author: 'p1', body: 'a retention-hidden backdoor mention' }),
  ev({ id: 'sr_new', seq: 2, ts: nowSR, author: 'p1', body: 'a visible backdoor mention' }),
]);
const srRetHtml = chatUi._searchResultsHTMLForTest('backdoor');
assert(!/sr_old/.test(srRetHtml) && /sr_new/.test(srRetHtml),
  'searchResultsHTML() (the actual render function, not just getMessages()) never includes a retention-hidden matching message');

storage.saveSetting('chatRetentionDays', 0);
storage.saveSetting('chatEpochSeq', 2);   // hides seq<=2 — both fixtures
const srEpHtml = chatUi._searchResultsHTMLForTest('backdoor');
assert(!/sr_old/.test(srEpHtml) && !/sr_new/.test(srEpHtml),
  'searchResultsHTML() never includes an epoch-hidden matching message either');
storage.saveSetting('chatEpochSeq', 0);
storage.saveSetting('chatRetentionDays', 0);

// ═════════════════════════════════════════════════════════════════════════
// 21. Finding #5 — weigh_in can be explicitly cleared
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[21] Finding #5 — an explicit weigh_in clear (value:null) removes the prior text/flag…');

_resetForTest();
ingest([ev({ id: 'wi_clear_target', seq: 1, ts: 1000, author: 'p2', body: 'SCRIBE missed this one' })]);
ingest([{ id: 'wi_clear_ev1', type: 'feedback', targetId: 'wi_clear_target', author: 'p1', notify: false, seq: 2, ts: 2000,
  meta: { category: 'weigh_in', value: 'SCRIBE should have called that a bust' } }]);
assert(getFeedbackFor('wi_clear_target').p1.weigh_in === 'SCRIBE should have called that a bust', 'fixture check: weigh_in text is set before the clear');
// The modal's new "Remove" action writes this exact shape: value:null.
ingest([{ id: 'wi_clear_ev2', type: 'feedback', targetId: 'wi_clear_target', author: 'p1', notify: false, seq: 3, ts: 3000,
  meta: { category: 'weigh_in', value: null } }]);
assert(getFeedbackFor('wi_clear_target').p1.weigh_in === null,
  'finding #5: an explicit weigh_in clear (value:null) removes the prior text/flag — a mis-tap is now correctable');

// ═════════════════════════════════════════════════════════════════════════
// 22. Finding #7 — search-result preview is plain escaped text
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[22] Finding #7 — search-result preview never nests <a>/<img> inside the result <button>…');

_resetForTest();
storage.saveSetting('chatImagePreviewEnabled', false);
ingest([ev({ id: 'sr_link', seq: 1, ts: 1000, author: 'p1', body: 'check https://example.com/report now' })]);
const srLinkHtml = chatUi._searchResultsHTMLForTest('report');
assert(/data-search-jump="sr_link"/.test(srLinkHtml), 'fixture check: the message is actually returned as a result');
assert(!/<a /.test(srLinkHtml) && !/<img/.test(srLinkHtml),
  'finding #7: the search-result preview never nests an <a>/<img> inside the <button> — plain escaped text only');
assert(/https:\/\/example\.com\/report/.test(srLinkHtml),
  'the URL text itself still appears in the preview, just not as a live/tappable link');

// ═════════════════════════════════════════════════════════════════════════
// 23. Finding #8 — search clear/close controls are distinguishable
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[23] Finding #8 — search clear/close controls are visually + programmatically distinguishable…');

const chatUiSrc = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
const searchBarBlock = (chatUiSrc.match(/function searchBarHTML\(\)[\s\S]*?\n}/) || [''])[0];
assert(searchBarBlock.length > 0, 'fixture check: searchBarHTML() was located in chat-ui.js');
assert(/id="chat-search-clear"[^>]*>Clear</.test(searchBarBlock), 'the clear button reads "Clear" (text), not a second identical ✕ glyph');
assert(/id="chat-search-clear"[^>]*aria-label="Clear search"/.test(searchBarBlock), 'the clear button carries its own distinct aria-label ("Clear search")');
assert(/id="chat-search-close"[^>]*aria-label="Close search"/.test(searchBarBlock), 'the close button carries a distinct aria-label ("Close search")');

// ═════════════════════════════════════════════════════════════════════════
// 24. Finding #9 — recordFeedback() clamps value length to 1000 chars
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[24] Finding #9 — recordFeedback() clamps a string value to 1000 chars at the boundary…');

_resetForTest();
ingest([ev({ id: 'clamp_target', seq: 1, ts: 1000, author: 'scribe', body: 'note' })]);
const longValue = 'x'.repeat(5000);
recordFeedback({ targetId: 'clamp_target', category: 'rewrite', value: longValue, author: 'p1' });
assert(getFeedbackFor('clamp_target').p1.rewrite.length === 1000,
  `finding #9: a 5000-char value is clamped to 1000 chars at the recordFeedback() boundary (got length ${getFeedbackFor('clamp_target').p1.rewrite.length})`);

// ═════════════════════════════════════════════════════════════════════════
// 25. Finding #11 — chat-search-load-older wraps backfill() in try/catch
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[25] Finding #11 — the search "Load older messages" handler wraps its await in try/catch (CONVENTIONS #4)…');

// Two occurrences of the string exist (the HTML template's id="..." AND the
// click handler below it) — anchor specifically on the addEventListener
// call, not the first substring match, or this silently scans the wrong one.
const loadOlderBlock = (chatUiSrc.match(/getElementById\('chat-search-load-older'\)[\s\S]{0,700}?\}\);/) || [''])[0];
assert(loadOlderBlock.length > 0, 'fixture check: the chat-search-load-older click handler was located');
assert(/try\s*\{\s*await backfill\(100\)/.test(loadOlderBlock), 'the handler wraps its await backfill(100) call in try/catch');

// ═════════════════════════════════════════════════════════════════════════
// 26. Test-only pass, item (a) — the REAL rewrite-submit branch calls
//     showToast() with {force:true} — structural, on the call site's own
//     source text
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[26] Structural — the real rewrite-submit branch raises its receipt on the UNGATED app toast…');
{
  // §15 above proves the MECHANISM: _showToastForTest(msg, {force:true})
  // really bypasses chat-page suppression. It never reads the PRODUCTION
  // call site's own text — force:true was baked into §15's test fixture,
  // not extracted from chat-ui.js. That is exactly how the reviewer's
  // finding happened: {force:true} was dropped from the real branch and
  // every existing assertion, including §15, stayed green.
  //
  // N1 follow-up (c), 2026-09-12 — THE FINDING IS UNCHANGED; ITS ANSWER MOVED.
  // The reviewer's finding was that a RECEIPT for the player's own action was
  // being raised through a path that silently suppressed it. `{force:true}`
  // answered that against chat-ui's two page-suppression gates. Then R10
  // (DI-N3) added a gate that force does NOT bypass — deliberately, it runs
  // first — so on a push-active device the same receipt became a silent no-op
  // again, by a different route. The ruling: a receipt is not a notification,
  // so it does not belong on the notification toast at all. It now goes to
  // app.js's own showToast() over chat-ui's window.* bridge (showReceipt()),
  // which has never been gated by anything. This section pins THAT, and keeps
  // the same shape of proof — including the mutation.
  const REWRITE_SUBMIT_LINE = `    if (category === 'rewrite') showReceipt('Rewrite saved.');`;
  assert(chatUiSrc.includes(REWRITE_SUBMIT_LINE),
    'fixture check: the exact rewrite-submit branch text is present in chat-ui.js (an unindented/reworded line would silently no-op this scan)');
  assert(chatUiSrc.split(REWRITE_SUBMIT_LINE).length - 1 === 1,
    'fixture check: the branch text is UNIQUE in chat-ui.js — not accidentally matching a second call site');

  const scanRewriteCall = src => {
    const m = src.match(/if\s*\(category === 'rewrite'\)\s*([A-Za-z_$][\w$]*)\(/);
    return m ? m[1] : null;
  };
  const realCallee = scanRewriteCall(chatUiSrc);
  assert(realCallee !== null, 'fixture check: the scan regex actually located the rewrite-submit call (not vacuous)');
  assert(realCallee === 'showReceipt',
    `STRUCTURAL: the real rewrite-submit branch raises its confirmation through showReceipt(), not the gated showToast() — got ${realCallee}(). A receipt that renders on some devices and not others is the reviewer's original finding wearing R10's clothes`);

  // …and showReceipt() itself has to reach the APP toast. If it were ever
  // pointed back at chat-ui's own showToast(), every assertion above would
  // still pass while the receipt went silent on exactly the devices this
  // change was about.
  const receiptSrc26 = (chatUiSrc.match(/function showReceipt\(text\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(/window\.showToast\(/.test(receiptSrc26) && !/[^.\w]showToast\(\{/.test(receiptSrc26),
    `STRUCTURAL: showReceipt() delivers through the window.showToast bridge (app.js's ungated toast), not chat-ui's own gated showToast — got: ${receiptSrc26.replace(/\s+/g, ' ').slice(0, 160)}`);

  // Mutation proof — an in-memory scratch copy with the branch reverted to the
  // OLD gated call (the exact regression this section now guards against),
  // never written to any file.
  const mutatedLine = `    if (category === 'rewrite') showToast({ author: 'system', body: 'Rewrite saved.' }, { force: true });`;
  assert(mutatedLine !== REWRITE_SUBMIT_LINE, 'fixture check: the scratch mutation actually changed the text');
  const mutatedSrc = chatUiSrc.replace(REWRITE_SUBMIT_LINE, mutatedLine);
  assert(scanRewriteCall(mutatedSrc) === 'showToast',
    'MUTATION CONFIRMED: against a scratch copy reverted to showToast({…},{force:true}), this same scan sees the gated call — the guard is capable of failing, not vacuous (RG-27)');
}

// ═════════════════════════════════════════════════════════════════════════
// 27. Reviewer note (approved) — recordFeedback() honors the MASTER SWITCH
// ═════════════════════════════════════════════════════════════════════════
// The switch was previously enforced only at RENDER time (messageHTML omits
// every ⭐/🚩 affordance when it is off — section [4]). That left a real hole:
// a player with the feedback popover ALREADY OPEN when the commissioner flips
// the switch off still has a live click handler bound to a button sitting in
// the DOM, and tapping it wrote a real event into the append-only chat log.
// The switch has to mean "no new instrumentation is captured," not "no new
// instrumentation is offered" — so the gate belongs at the write seam every
// entry point funnels through.
console.log('\n[27] Reviewer note — recordFeedback() no-ops when the master switch is OFF…');
{
  _resetForTest();
  ingest([ev({ id: 'sw_s', seq: 1, ts: 1000, author: 'scribe', body: 'rate me if you can' })]);
  storage.setSession('p1', false, true);

  // ── switch ON (the default) — the normal path still works, unchanged.
  storage.saveSetting('scribeFeedbackEnabled', true);
  const onResult = recordFeedback({ targetId: 'sw_s', category: 'rating', value: 'hit', author: 'p1' });
  assert(onResult !== null && !(onResult && onResult.ok === false),
    'switch ON: recordFeedback() returns a real send result, not the disabled marker');
  assert(getFeedbackFor('sw_s').p1?.rating === 'hit', 'switch ON: the rating is actually ingested (proves the OFF assertions below are non-vacuous)');

  // ── switch OFF — the write must not happen AT ALL.
  _resetForTest();
  ingest([ev({ id: 'sw_off', seq: 1, ts: 1000, author: 'scribe', body: 'you cannot rate me now' })]);
  storage.saveSetting('scribeFeedbackEnabled', false);
  assert(isScribeFeedbackEnabled() === false, 'fixture check: the master switch reads OFF');

  const foldBeforeOff = _foldedSnapshot();
  const offResult = recordFeedback({ targetId: 'sw_off', category: 'rating', value: 'too_much', author: 'p1' });
  assert(offResult && offResult.ok === false && offResult.reason === 'disabled',
    `switch OFF: recordFeedback() returns the shaped no-op marker {ok:false, reason:'disabled'} (got ${JSON.stringify(offResult)})`);
  assert(Object.keys(getFeedbackFor('sw_off')).length === 0,
    'switch OFF: NO feedback state is folded onto the target — the write never happened');
  assert(_foldedSnapshot() === foldBeforeOff,
    'switch OFF: the ENTIRE chat fold is byte-identical before/after the blocked call — nothing was ingested, sent, or buffered anywhere');

  // Every category, not just rating — the gate is at the seam, so it covers
  // rewrite/remember_this/weigh_in with no per-category re-implementation.
  ['rewrite', 'remember_this', 'weigh_in'].forEach(cat => {
    const r = recordFeedback({ targetId: 'sw_off', category: cat, value: 'x', author: 'p1' });
    assert(r && r.ok === false && r.reason === 'disabled', `switch OFF: category '${cat}' is blocked at the same seam`);
  });
  assert(_foldedSnapshot() === foldBeforeOff, 'switch OFF: still byte-identical after all four categories were attempted');

  // ── switch back ON — the block is not sticky.
  storage.saveSetting('scribeFeedbackEnabled', true);
  const backOn = recordFeedback({ targetId: 'sw_off', category: 'rating', value: 'mid', author: 'p1' });
  assert(!(backOn && backOn.ok === false), 'switch flipped back ON: recordFeedback() works again — the block is a live read, not a latched state');
  assert(getFeedbackFor('sw_off').p1?.rating === 'mid', 'switch flipped back ON: the rating ingests normally');

  // ── default-when-missing stays TRUE (CONVENTIONS #10) — an old settings
  //    blob written before this field existed must not turn the pilot off.
  _resetForTest();
  ingest([ev({ id: 'sw_missing', seq: 1, ts: 1000, author: 'scribe', body: 'default path' })]);
  storage.saveSetting('scribeFeedbackEnabled', undefined);
  const missingResult = recordFeedback({ targetId: 'sw_missing', category: 'rating', value: 'hit', author: 'p1' });
  assert(!(missingResult && missingResult.ok === false), 'switch MISSING: recordFeedback() writes normally (default-when-missing is ON)');
  assert(getFeedbackFor('sw_missing').p1?.rating === 'hit', 'switch MISSING: the rating ingests — an absent setting never silently disables the pilot');
  storage.saveSetting('scribeFeedbackEnabled', true);
}

// ═════════════════════════════════════════════════════════════════════════
// 27b. Mutation proof for [27] — remove the guard in a tmpdir COPY
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[27b] Mutation — with the master-switch guard removed (tmpdir copy), the blocked write LANDS…');
{
  const dir = await createMutantDir('scribeFeedback.js', src => src.replace(
    "  if (!isScribeFeedbackEnabled()) return { ok: false, reason: 'disabled' };\n", ''));
  // Import the mutant scribeFeedback.js AND the chat.js sitting beside it in
  // the SAME tmpdir — that is the chat.js instance the mutant writes through,
  // so it is the only one that can observe the write (see createMutantDir's
  // note on why a re-querystring'd import would be a third, disconnected copy).
  const mutantFb = await importFromMutantDir(dir, 'scribeFeedback.js');
  const mutantChat = await importFromMutantDir(dir, 'chat.js');
  const mutantStorage = await importFromMutantDir(dir, 'storage.js');
  mutantStorage.initStorage?.();
  mutantStorage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true });
  mutantChat._resetForTest();
  mutantChat.ingest([{ id: 'mut_s', seq: 1, ts: 1000, type: 'message', author: 'scribe', body: 'mutant target', gameTag: '', notify: false }]);
  mutantStorage.setSession('p1', false, true);
  mutantStorage.saveSetting('scribeFeedbackEnabled', false);
  assert(mutantFb.isScribeFeedbackEnabled() === false, '[27b] fixture check: the mutant reads the switch as OFF too (the mutation removed the GUARD, not the reader)');

  const mutantResult = mutantFb.recordFeedback({ targetId: 'mut_s', category: 'rating', value: 'too_much', author: 'p1' });
  assert(!(mutantResult && mutantResult.ok === false),
    '[27b] MUTATION CONFIRMED (a): without the guard, recordFeedback() no longer returns the disabled marker');
  assert(mutantChat.getMessage('mut_s')?.feedback?.p1?.rating === 'too_much',
    '[27b] MUTATION CONFIRMED (b): without the guard, the write LANDS while the switch is off — exactly the hole the reviewer named, and exactly what [27] goes red on (RG-27: the guard is capable of failing)');
}

// ═════════════════════════════════════════════════════════════════════════
// 28. Item 3 — persistent ⭐ on SCRIBE messages (Drew approved rec. (b))
// ═════════════════════════════════════════════════════════════════════════
// Rating a SCRIBE line was a THREE-gesture path: long-press/right-click to
// reveal .chat-actions, tap ⭐, tap a rating. The persistent ⭐ makes it one
// gesture. It must render on SCRIBE messages ONLY, must vanish completely
// when the master switch is off, must reflect MY OWN state, and must open the
// SAME popover through the SAME function — not a second rating code path.
console.log('\n[28] Item 3 — persistent ⭐ renders on SCRIBE messages only, one code path…');
{
  const { _persistentStarHTMLForTest } = chatUi;
  assert(typeof _persistentStarHTMLForTest === 'function', 'fixture check: the persistent-star render function is exported for direct coverage');

  _resetForTest();
  ingest([
    ev({ id: 'ps_s', seq: 1, ts: 1000, author: 'scribe', body: 'a scribe line' }),
    ev({ id: 'ps_h', seq: 2, ts: 2000, author: 'p2', body: 'a human line' }),
    ev({ id: 'ps_del', seq: 3, ts: 3000, author: 'scribe', body: 'to be withdrawn' }),
    { id: 'ps_delev', seq: 4, ts: 4000, type: 'delete', targetId: 'ps_del', author: 'scribe', notify: false },
  ]);
  storage.setSession('p1', false, true);
  storage.saveSetting('scribeFeedbackEnabled', true);

  // ── (a) SCRIBE only.
  assert(_persistentStarHTMLForTest(getMessage('ps_s'), 'p1') !== '', '(a) renders on a SCRIBE message');
  assert(_persistentStarHTMLForTest(getMessage('ps_h'), 'p1') === '', '(a) renders NOTHING on a human message — 🚩 stays behind the long-press, unchanged');
  assert(getMessage('ps_del')?.deleted === true, '(a) fixture check: the withdrawn message really is folded as deleted');
  assert(_persistentStarHTMLForTest(getMessage('ps_del'), 'p1') === '', '(a) renders NOTHING on a deleted/withdrawn message');

  const htmlS = _messageHTMLForTest(getMessage('ps_s'), 'p1', false);
  const htmlH = _messageHTMLForTest(getMessage('ps_h'), 'p1', false);
  assert(/class="chat-fb-star /.test(htmlS), '(a) the star reaches the rendered SCRIBE message HTML');
  assert(!/chat-fb-star/.test(htmlH), '(a) the star never appears in a rendered human message');

  // ── (b) It lives in the EXISTING reactions row — no new footer row.
  assert(/<div class="chat-reactions">[^<]*<button class="chat-fb-star /.test(htmlS),
    '(b) the star sits INSIDE the existing .chat-reactions row (no second footer row added — RG-20/34 density constraint)');
  assert((htmlS.match(/class="chat-reactions"/g) || []).length === 1, '(b) exactly one .chat-reactions row is emitted');
  // …and with reactions present it shares that row rather than replacing them.
  ingest([{ id: 'ps_rx', seq: 5, ts: 5000, type: 'react', targetId: 'ps_s', author: 'p2', meta: { emoji: '🔥' }, notify: false }]);
  const htmlWithRx = _messageHTMLForTest(getMessage('ps_s'), 'p1', false);
  assert(/chat-react-pill/.test(htmlWithRx) && /chat-fb-star/.test(htmlWithRx), '(b) with reactions present, pills AND the star share the one row');
  assert((htmlWithRx.match(/class="chat-reactions"/g) || []).length === 1, '(b) still exactly one .chat-reactions row once pills exist');

  // ── (c) Instrumentation OFF -> absent entirely, zero trace.
  storage.saveSetting('scribeFeedbackEnabled', false);
  const htmlOffStar = _messageHTMLForTest(getMessage('ps_s'), 'p1', false);
  assert(!/chat-fb-star/.test(htmlOffStar), '(c) switch OFF: no .chat-fb-star in the HTML at all');
  assert(!/data-fb-open/.test(htmlOffStar), '(c) switch OFF: no data-fb-open trace from EITHER entry point');
  assert(_persistentStarHTMLForTest(getMessage('ps_s'), 'p1') === '', '(c) switch OFF: the render function itself returns an empty string');
  storage.saveSetting('scribeFeedbackEnabled', true);
  assert(/chat-fb-star/.test(_messageHTMLForTest(getMessage('ps_s'), 'p1', false)), '(c) fixture check: switch back ON restores it (proves (c) is non-vacuous)');

  // ── (d) Reflects MY OWN state, and only mine.
  _resetForTest();
  ingest([ev({ id: 'ps_state', seq: 1, ts: 1000, author: 'scribe', body: 'state test' })]);
  const starFor = (self) => _persistentStarHTMLForTest(getMessage('ps_state'), self);
  assert(/is-unrated/.test(starFor('p1')) && /⭐/.test(starFor('p1')), '(d) unrated: hollow/muted ⭐, is-unrated state class');
  assert(/title="Rate this SCRIBE line"/.test(starFor('p1')), '(d) unrated: title is "Rate this SCRIBE line"');

  const fbst = (o, seq, ts, author) => ({ id: `pss_${seq}`, type: 'feedback', targetId: 'ps_state', author, notify: false, seq, ts, meta: o });
  ingest([fbst({ category: 'rating', value: 'hit' }, 2, 2000, 'p1')]);
  ingest([fbst({ category: 'rating', value: 'too_much' }, 3, 3000, 'p2')]);
  assert(/🔥/.test(starFor('p1')) && /is-rated/.test(starFor('p1')), "(d) my 'hit' renders 🔥 in the rated state");
  assert(!/🚫/.test(starFor('p1')), "(d) player A's star never shows player B's 🚫 — no attribution leak through the new control");
  assert(/🚫/.test(starFor('p2')) && !/🔥/.test(starFor('p2')), "(d) player B sees B's own 🚫, never A's 🔥");
  assert(starFor(null) === '', '(d) a signed-out viewer (self=null) gets NO persistent star at all — a control that cannot act is not rendered (reviewer 2026-09-10)');

  ingest([fbst({ category: 'rating', value: 'mid' }, 4, 4000, 'p1')]);
  assert(/😐/.test(starFor('p1')), "(d) a changed-mind 'mid' renders 😐");
  ingest([fbst({ category: 'rating', value: null }, 5, 5000, 'p1')]);
  ingest([fbst({ category: 'rewrite', value: 'what it should have said' }, 6, 6000, 'p1')]);
  assert(/✏️/.test(starFor('p1')) && /is-rated/.test(starFor('p1')),
    '(d) rating cleared but a rewrite on file renders ✏️ in the rated state — a rewrite is still feedback I gave');
  ingest([fbst({ category: 'rating', value: 'hit' }, 7, 7000, 'p1')]);
  assert(/🔥/.test(starFor('p1')) && !/✏️/.test(starFor('p1')),
    '(d) with BOTH a rating and a rewrite, the RATING glyph wins — the rating is the value this control primarily collects');

  // ── (e) The two entry points agree, because they share one state reader.
  const htmlBoth = _messageHTMLForTest(getMessage('ps_state'), 'p1', false);
  assert(/⭐ Hit/.test(htmlBoth), '(e) the long-press .chat-actions ⭐ still renders its word label — NO regression to the existing entry point');
  assert(/chat-fb-star[^>]*>🔥</.test(htmlBoth), '(e) the persistent star shows the matching glyph for the same state, in the same render');
  assert((htmlBoth.match(/data-fb-open="ps_state"/g) || []).length === 2,
    '(e) exactly TWO entry points exist on a SCRIBE message (long-press ⭐ + persistent ⭐) — both carrying the same data-fb-open target id');

  // ── (f) ONE popover code path — structural, on chat-ui.js's own source.
  assert((chatUiSrc.match(/querySelectorAll\('\[data-fb-open\]'\)/g) || []).length === 1,
    '(f) chat-ui.js binds [data-fb-open] in exactly ONE place — both entry points are wired by the same handler');
  // Count CODE lines only — doc comments legitimately name the function too
  // (the same trap [23f] in notifytest.mjs hit), so a raw textual count would
  // be counting prose. A line whose first non-space character is `*` or `//`
  // is a comment line; nothing else in this file wraps a call that way.
  const codeLinesWith = (src, needle) => src.split('\n')
    .filter(l => l.includes(needle) && !/^\s*(\*|\/\/)/.test(l)).length;
  assert(codeLinesWith(chatUiSrc, 'toggleFeedbackPicker(') === 2,
    '(f) toggleFeedbackPicker appears on exactly TWO code lines — its definition and its ONE call site — so the persistent star did not introduce a second rating path');
  // The 4th argument (`surface`) arrived with DI-268 (2026-09-23): a popover
  // that now survives a repaint has to be re-mounted on the surface it was
  // opened from, and 'main'/'sheet' is the only thing the mount needs that the
  // trigger element cannot tell it. The assertion's subject is unchanged —
  // there is still exactly ONE call site and it is still the shared handler.
  assert(/toggleFeedbackPicker\(b, b\.dataset\.fbOpen, renderFn, surface\)/.test(chatUiSrc),
    '(f) that single call site is the shared [data-fb-open] handler');
  const starFnSrc = (chatUiSrc.match(/function persistentStarHTML\(m, self\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(starFnSrc.length > 0, '(f) fixture check: persistentStarHTML was located in chat-ui.js');
  assert(!/recordFeedback\(/.test(starFnSrc), '(f) persistentStarHTML never writes feedback itself — it only renders the trigger');
  assert(/data-fb-open=/.test(starFnSrc), '(f) it opens the popover by emitting the SAME data-fb-open attribute, not a new attribute of its own');

  // ── (g) Tap target ≥40px, in the real stylesheet.
  const cssSrc = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
  const starRule = (cssSrc.match(/\n\.chat-fb-star\{[\s\S]*?\}/) || [''])[0];
  assert(starRule.length > 0, '(g) fixture check: the .chat-fb-star rule was located in styles.css');
  assert(/min-width:\s*40px/.test(starRule), '(g) .chat-fb-star declares min-width:40px (CONVENTIONS #17 floor)');
  // 2026-09-10: position:relative here is load-bearing for the ::after tap
  // overlay ONLY. It used to ALSO anchor the popover — that was reviewer
  // BLOCK finding #1, and the popover now anchors to the .chat-reactions ROW
  // instead (see [28c]). The declaration stays; only its rationale narrowed.
  assert(/position:\s*relative/.test(starRule), '(g) .chat-fb-star is position:relative — load-bearing for the ::after tap-target overlay (the popover now anchors to the .chat-reactions row, see [28c])');
  assert(/margin-left:\s*auto/.test(starRule), '(g) .chat-fb-star is right-aligned in its row, including when it sits alone');
  const starAfterRule = (cssSrc.match(/\.chat-fb-star::after\{[\s\S]*?\}/) || [''])[0];
  assert(/height:\s*40px/.test(starAfterRule),
    '(g) the ::after overlay gives a 40px VERTICAL tap target without growing the row — the exact pattern .chat-react-pill uses after v0.17.5 found a literal min-height:40px cost ~23px of density');
  assert(!/#[0-9a-fA-F]{3,6}/.test(starRule + starAfterRule), '(g) no hardcoded colors in the new rules (CONVENTIONS #13)');
}

// ═════════════════════════════════════════════════════════════════════════
// 28b. Mutation proof for [28] — the switch-off absence
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[28b] Mutation — with the persistent star\'s switch gate removed (tmpdir copy), it renders while the switch is OFF…');
{
  const dir = await createMutantDir('chat-ui.js', src => src.replace(
    "  if (m.author !== 'scribe' || m.deleted || !self || !isScribeFeedbackEnabled()) return ''; // !self: a signed-out reader gets no dead control (reviewer 2026-09-10)",
    "  if (m.author !== 'scribe' || m.deleted || !self) return '';   // CANARY: switch gate removed"));
  const mutantUi = await importFromMutantDir(dir, 'chat-ui.js');
  const mutantChat = await importFromMutantDir(dir, 'chat.js');
  const mutantStorage = await importFromMutantDir(dir, 'storage.js');
  mutantStorage.initStorage?.();
  mutantStorage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true });
  mutantChat._resetForTest();
  mutantChat.ingest([{ id: 'mut_star', seq: 1, ts: 1000, type: 'message', author: 'scribe', body: 'mutant star target', gameTag: '', notify: false }]);
  mutantStorage.setSession('p1', false, true);
  mutantStorage.saveSetting('scribeFeedbackEnabled', false);

  const mutantHtml = mutantUi._persistentStarHTMLForTest(mutantChat.getMessage('mut_star'), 'p1');
  assert(mutantHtml !== '' && /chat-fb-star/.test(mutantHtml),
    '[28b] MUTATION CONFIRMED: without the isScribeFeedbackEnabled() gate, the star renders while the switch is OFF — [28](c)\'s absence assertions are capable of failing, not vacuous (RG-27)');

  // Control: the same mutant WITH the switch on still renders (proves the
  // mutation didn't just break the function into always-returning markup for
  // an unrelated reason).
  mutantStorage.saveSetting('scribeFeedbackEnabled', true);
  assert(/chat-fb-star/.test(mutantUi._persistentStarHTMLForTest(mutantChat.getMessage('mut_star'), 'p1')),
    '[28b] control: the mutant still renders normally with the switch ON');
}

// ═════════════════════════════════════════════════════════════════════════
// 28c. Reviewer BLOCK finding #1/#2 — the persistent ⭐'s popover anchors to
//      the ROW (.chat-reactions), not to the right-aligned button
// ═════════════════════════════════════════════════════════════════════════
// The defect: persistentStarHTML()'s ⭐ is `margin-left:auto` (right-aligned)
// inside .chat-reactions, and toggleFeedbackPicker() hosted the popover on
// `anchorEl.closest('.chat-actions') || anchorEl`. There is no .chat-actions
// ancestor on that path, so the host fell through to the BUTTON — and
// `.reaction-picker{position:absolute;left:0}` then measured from the
// button's own left edge (x≈326 on a 390px viewport), pushing a ~320px
// popover ~256px past the right edge; .chat-scroll's computed overflow-x
// showed a sliver plus a horizontal scrollbar. It also nested a <div> of
// <button>s INSIDE a <button> (invalid interactive content), so a mis-tap on
// the popover's padding bubbled to the ⭐ and closed the thing being aimed at.
//
// The fix widens the host selector to '.chat-actions, .chat-reactions' and
// makes .chat-reactions position:relative, so BOTH entry points resolve to a
// positioned ROW container and open from the bubble column's left edge.
//
// These assertions are STRUCTURAL (what closest() resolves to, where the node
// actually lands in a real element tree) rather than a source regex, because
// WHERE the popover lands is the entire defect and a regex cannot see it.
console.log('\n[28c] Finding #1/#2 — feedback popover hosts on the ROW container, never on the trigger <button>…');
{
  // ── A tiny element tree. Only what toggleFeedbackPicker() actually touches:
  // className/id/dataset/innerHTML, appendChild/remove/contains, closest(),
  // and no-op querySelector(All)/addEventListener. Deliberately NOT a DOM
  // library — the assertions below are about parentage, which this models
  // exactly, and a dependency would violate the no-build-step rule.
  const byId = new Map();
  function mkEl(tag, className = '', data = {}) {
    let _id = '', _html = '';
    const el = {
      tagName: String(tag).toUpperCase(),
      className,
      dataset: { ...data },
      style: {},
      children: [],
      parentNode: null,
      classList: {
        add(c) { if (!el.className.split(/\s+/).includes(c)) el.className = `${el.className} ${c}`.trim(); },
        remove(c) { el.className = el.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
        contains(c) { return el.className.split(/\s+/).includes(c); },
      },
      get id() { return _id; },
      set id(v) { if (_id) byId.delete(_id); _id = v; if (v) byId.set(v, el); },
      get innerHTML() { return _html; },
      set innerHTML(v) { _html = String(v); },
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      remove() {
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(x => x !== el);
        el.parentNode = null;
        if (_id) byId.delete(_id);
      },
      contains(n) { for (let c = n; c; c = c.parentNode) if (c === el) return true; return false; },
      closest(sel) {
        const toks = String(sel).split(',').map(s => s.trim()).filter(Boolean);
        for (let n = el; n; n = n.parentNode) if (toks.some(t => matchesSel(n, t))) return n;
        return null;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {}, removeEventListener() {},
    };
    return el;
  }
  // Supports `.cls`, `tag`, and `.cls[data-x="v"]` — every shape chat-ui.js
  // passes to closest() on these paths.
  function matchesSel(node, tok) {
    const attr = /\[data-([\w-]+)="([^"]*)"\]/.exec(tok);
    if (attr) {
      const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (node.dataset?.[key] !== attr[2]) return false;
      tok = tok.slice(0, attr.index);
    }
    if (!tok) return true;
    if (tok.startsWith('.')) return String(node.className || '').split(/\s+/).includes(tok.slice(1));
    return node.tagName === tok.toUpperCase();
  }

  // messageHTML()'s real shape: .chat-msg > .chat-bubble-col > (.chat-reactions,
  // .chat-actions) — the two rows are SIBLINGS, never nested in one another,
  // which is what makes the widened closest() selector unambiguous.
  function buildTree(mid) {
    const msg = mkEl('div', 'chat-msg', { mid });
    const col = msg.appendChild(mkEl('div', 'chat-bubble-col'));
    const reactions = col.appendChild(mkEl('div', 'chat-reactions'));
    const star = reactions.appendChild(mkEl('button', 'chat-fb-star is-unrated', { fbOpen: mid }));
    const actions = col.appendChild(mkEl('div', 'chat-actions'));
    const actStar = actions.appendChild(mkEl('button', 'chat-act chat-act-feedback', { fbOpen: mid }));
    return { msg, col, reactions, star, actions, actStar };
  }
  const pickerIn = row => row.children.find(c => String(c.className).includes('feedback-picker-wrap')) || null;
  const ancestorTags = node => { const out = []; for (let n = node.parentNode; n; n = n.parentNode) out.push(n.tagName); return out; };

  const fakeDoc = {
    addEventListener() {}, removeEventListener() {},
    getElementById: id => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: tag => mkEl(tag),
    body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
    hidden: false,
  };

  _resetForTest();
  ingest([ev({ id: 'anch_s', seq: 1, ts: 1000, author: 'scribe', body: 'anchor target' })]);
  storage.setSession('p1', false, true);
  storage.saveSetting('scribeFeedbackEnabled', true);

  const { _toggleFeedbackPickerForTest } = chatUi;
  assert(typeof _toggleFeedbackPickerForTest === 'function',
    '[28c] fixture check: toggleFeedbackPicker is exported as a test seam — WHERE the popover lands is only observable by running it');

  const realDoc = globalThis.document;
  globalThis.document = fakeDoc;
  try {
    // ── (a) Persistent-⭐ path: popover is a SIBLING of the star, inside the row.
    const t = buildTree('anch_s');
    _toggleFeedbackPickerForTest(t.star, 'anch_s', () => {});
    const p = pickerIn(t.reactions);
    assert(p !== null, '(a) the popover is appended into .chat-reactions — the ROW container, exactly like the .chat-actions path');
    assert(p && p.parentNode === t.reactions, '(a) its parent IS .chat-reactions (a sibling of the ⭐), not the ⭐ itself');
    assert(t.star.children.length === 0,
      '(a) the ⭐ <button> has ZERO children — finding #2: the popover is no longer nested interactive content inside a button');
    assert(p && !ancestorTags(p).includes('BUTTON'),
      '(a) no ancestor of the popover is a <button> at all — a mis-tap on its padding cannot bubble to the trigger and close it');
    assert(p && p.closest('.chat-reactions') === t.reactions,
      '(a) closest() from the popover resolves to the same .chat-reactions row — the containing block for left:0');
    assert(p && p.closest('.chat-msg[data-mid="anch_s"]') === t.msg,
      '(a) the popover is still inside .chat-msg[data-mid=…] — the reveal-closer ([17]) keeps treating clicks in it as "inside the message"');
    assert(p && String(p.className).includes('reaction-picker') && String(p.className).includes('feedback-picker-wrap'),
      '(a) it still carries BOTH classes — the .reaction-picker anchoring/chrome is reused verbatim, not re-declared');
    assert(p && p.id === 'chat-feedback-picker' && p.dataset.mid === 'anch_s',
      '(a) id/dataset are unchanged — the single-open-at-a-time and toggle-off bookkeeping still keys off the same values');

    // ── (b) Toggle-off and cross-popover single-open-at-a-time still hold.
    _toggleFeedbackPickerForTest(t.star, 'anch_s', () => {});
    assert(pickerIn(t.reactions) === null, '(b) re-tapping the SAME ⭐ closes the popover (toggle-off preserved)');
    const t2 = buildTree('anch_s');
    const rxPicker = t2.actions.appendChild(mkEl('div', 'reaction-picker'));
    rxPicker.id = 'chat-react-picker';
    _toggleFeedbackPickerForTest(t2.star, 'anch_s', () => {});
    assert(rxPicker.parentNode === null && byId.get('chat-react-picker') === undefined,
      '(b) opening the feedback popover still removes an open reaction picker — single-open-at-a-time across BOTH popovers survives the re-anchor');
    assert(pickerIn(t2.reactions) !== null, '(b) …and the feedback popover itself opened, in the row');
    pickerIn(t2.reactions).remove();

    // ── (c) The long-press .chat-actions ⭐ path is UNCHANGED by the widening.
    const t3 = buildTree('anch_s');
    _toggleFeedbackPickerForTest(t3.actStar, 'anch_s', () => {});
    const p3 = pickerIn(t3.actions);
    assert(p3 !== null && p3.parentNode === t3.actions,
      '(c) the long-press ⭐ still hosts on .chat-actions — the widened selector did not steal it (the two rows are siblings, so closest() is unambiguous)');
    assert(pickerIn(t3.reactions) === null, '(c) …and nothing was appended to .chat-reactions on that path');
    assert(t3.actStar.children.length === 0, '(c) that button has no children either — neither entry point nests the popover in a <button>');
    p3.remove();
  } finally {
    globalThis.document = realDoc;
  }

  // ── (d) The anchor selector itself, pinned structurally in real source.
  const hostLine = (chatUiSrc.match(/function toggleFeedbackPicker\([\s\S]*?const host = [^\n]*/) || [''])[0].split('\n').pop();
  assert(/closest\?\.\('\.chat-actions, \.chat-reactions'\)/.test(hostLine),
    "(d) toggleFeedbackPicker's host is anchorEl.closest('.chat-actions, .chat-reactions') — both ROW containers, pinned so a revert to .chat-actions-only goes red here too");
  assert(/\|\| anchorEl/.test(hostLine),
    '(d) the `|| anchorEl` last-resort fallback is retained — a trigger in neither row still opens something rather than throwing');

  // ── (e) Geometry sanity, from the REAL numbers in styles.css (390px phone).
  // Every value below is parsed out of the stylesheet, not hardcoded here, so
  // a CSS change that reopens the overflow makes this arithmetic go red.
  const num = (re, label) => { const m = re.exec(cssSrc); assert(m !== null, `(e) fixture check: ${label} found in styles.css`); return m ? Number(m[1]) : NaN; };
  const pagePad    = num(/@media \(max-width: 480px\) \{\s*\n\s*:root \{ --page-pad: (\d+)px; \}/, '--page-pad at ≤480px');
  const scrollPad  = num(/\.chat-scroll\{[^}]*?padding:(\d+)px/, '.chat-scroll padding');
  const avatarW    = num(/\.chat-avatar\{flex:0 0 (\d+)px/, '.chat-avatar width');
  const msgGap     = num(/\.chat-msg\{display:flex;gap:(\d+)px/, '.chat-msg gap');
  const starMinW   = num(/\.chat-fb-star\{[\s\S]*?min-width:(\d+)px/, '.chat-fb-star min-width');
  const gridCol    = num(/\.feedback-picker-grid\{display:grid;grid-template-columns:repeat\(2,(\d+)px\)/, '.feedback-picker-grid column width');
  const gridGap    = num(/\.feedback-picker-grid\{[\s\S]*?gap:(\d+)px/, '.feedback-picker-grid gap');
  const wrapPad    = num(/\.feedback-picker-wrap\{[^}]*?padding:(\d+)px\}/, '.feedback-picker-wrap padding');
  const pickBorder = num(/\.reaction-picker\{[\s\S]*?border:(\d+)px solid/, '.reaction-picker border width');

  const VIEWPORT = 390;                                                   // iPhone 14/15 logical width
  const colLeft  = pagePad + scrollPad + avatarW + msgGap;                // left edge of .chat-bubble-col
  const colWidth = VIEWPORT - colLeft - scrollPad - pagePad;              // it is flex:1 in the remaining space
  const popoverW = gridCol * 2 + gridGap + wrapPad * 2 + pickBorder * 2;  // .feedback-picker-wrap's border box
  const starLeft = colLeft + colWidth - starMinW;                         // margin-left:auto pins it to the right edge

  assert(colLeft === 62, `(e) bubble-column left edge computes to 62px at 390px (got ${colLeft}) — matches the reviewer's measurement`);
  assert(colWidth === 304, `(e) bubble-column width computes to 304px (got ${colWidth}) — matches the reviewer's measurement`);
  assert(popoverW === 320, `(e) the popover is 320px wide (got ${popoverW}) — matches the reviewer's measurement`);
  assert(starLeft === 326, `(e) the right-aligned ⭐ sits at x≈326 (got ${starLeft}) — matches the reviewer's measurement`);
  assert(colLeft + popoverW <= VIEWPORT,
    `(e) ROW-anchored: 62 + 320 = ${colLeft + popoverW} ≤ ${VIEWPORT} — the popover fits inside the viewport with ${VIEWPORT - colLeft - popoverW}px to spare`);
  assert(starLeft + popoverW - VIEWPORT === 256,
    `(e) BUTTON-anchored (the defect) would have overflowed by exactly 256px (got ${starLeft + popoverW - VIEWPORT}) — the number the reviewer reported, reproduced from the stylesheet`);

  // ── (f) The CSS mechanism that makes (e) true: left:0 against a positioned
  // ROW, and nothing pushing the picker rightward.
  const reactionsRule = (cssSrc.match(/\n\.chat-reactions\{[^}]*\}/) || [''])[0];
  assert(/position:relative/.test(reactionsRule),
    '(f) .chat-reactions is position:relative — it is the containing block for the popover, so left:0 measures from the COLUMN, not the button');
  const pickerRule = (cssSrc.match(/\n\.reaction-picker\{[^}]*\}/) || [''])[0];
  assert(/position:absolute/.test(pickerRule) && /left:0/.test(pickerRule),
    '(f) .reaction-picker is position:absolute;left:0 — unchanged, still reused verbatim by the feedback popover');
  const actionsRule = (cssSrc.match(/\n\.chat-actions\{[^}]*\}/) || [''])[0];
  assert(/position:absolute/.test(actionsRule),
    '(f) .chat-actions is position:absolute — already its own containing block, which is why that path never overflowed');
  // No rule anywhere may push the PICKER to the right (that is what
  // .chat-fb-star's own margin-left:auto does, and it must not reach the
  // popover now that the popover is its sibling in the same flex row).
  const pickerRules = (cssSrc.match(/(^|\n)[^\n{}]*\.(reaction-picker|feedback-picker-wrap)[^\n{}]*\{[^}]*\}/g) || []);
  assert(pickerRules.length >= 3, `(f) fixture check: located the .reaction-picker/.feedback-picker-wrap rule blocks (${pickerRules.length})`);
  assert(pickerRules.every(r => !/margin-left:\s*auto/.test(r)),
    '(f) NO rule gives the popover margin-left:auto — it is out of flow, but this pins that a future tweak cannot right-align it the way the ⭐ is');
  assert(pickerRules.every(r => !/(^|[;{\s])right:/.test(r)),
    '(f) NO rule gives the popover a right offset either — left:0 against the row is the one and only horizontal anchor');
}

// ═════════════════════════════════════════════════════════════════════════
// 28d. Mutation proof for [28c] — revert the anchor to .chat-actions-only
// ═════════════════════════════════════════════════════════════════════════
// Against a REAL tmpdir copy of chat-ui.js (never real source, never git —
// CLAUDE.md prohibited-moves). With the pre-fix selector restored, the star
// path falls through to `|| anchorEl` and the popover lands INSIDE the
// <button> again — which is precisely what [28c](a) asserts cannot happen.
console.log('\n[28d] Mutation — anchor reverted to \'.chat-actions\'-only (tmpdir copy): the popover lands inside the <button> again…');
{
  const dir = await createMutantDir('chat-ui.js', src => src.replace(
    "  const host = anchorEl.closest?.('.chat-actions, .chat-reactions') || anchorEl;",
    "  const host = anchorEl.closest?.('.chat-actions') || anchorEl;   // CANARY: pre-fix anchor"));
  const mutantUi = await importFromMutantDir(dir, 'chat-ui.js');
  const mutantChat = await importFromMutantDir(dir, 'chat.js');
  const mutantStorage = await importFromMutantDir(dir, 'storage.js');
  mutantStorage.initStorage?.();
  mutantStorage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true });
  mutantChat._resetForTest();
  mutantChat.ingest([{ id: 'mut_anch', seq: 1, ts: 1000, type: 'message', author: 'scribe', body: 'mutant anchor target', gameTag: '', notify: false }]);
  mutantStorage.setSession('p1', false, true);
  mutantStorage.saveSetting('scribeFeedbackEnabled', true);

  assert(typeof mutantUi._toggleFeedbackPickerForTest === 'function', '[28d] fixture check: the mutant exposes the same seam');

  // Same minimal tree shape as [28c], rebuilt locally so the two sections
  // share no mutable state.
  const byId = new Map();
  function mkEl(tag, className = '', data = {}) {
    let _id = '', _html = '';
    const el = {
      tagName: String(tag).toUpperCase(), className, dataset: { ...data }, style: {},
      children: [], parentNode: null,
      classList: { add() {}, remove() {}, contains: () => false },
      get id() { return _id; },
      set id(v) { if (_id) byId.delete(_id); _id = v; if (v) byId.set(v, el); },
      get innerHTML() { return _html; },
      set innerHTML(v) { _html = String(v); },
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      remove() { if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(x => x !== el); el.parentNode = null; if (_id) byId.delete(_id); },
      contains(n) { for (let c = n; c; c = c.parentNode) if (c === el) return true; return false; },
      closest(sel) {
        const toks = String(sel).split(',').map(s => s.trim()).filter(Boolean);
        for (let n = el; n; n = n.parentNode) {
          if (toks.some(t => t.startsWith('.') && String(n.className || '').split(/\s+/).includes(t.slice(1)))) return n;
        }
        return null;
      },
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
    };
    return el;
  }
  const msg = mkEl('div', 'chat-msg', { mid: 'mut_anch' });
  const col = msg.appendChild(mkEl('div', 'chat-bubble-col'));
  const reactions = col.appendChild(mkEl('div', 'chat-reactions'));
  const star = reactions.appendChild(mkEl('button', 'chat-fb-star is-unrated', { fbOpen: 'mut_anch' }));

  const realDoc = globalThis.document;
  globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: id => byId.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: tag => mkEl(tag),
    body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
    hidden: false,
  };
  try {
    mutantUi._toggleFeedbackPickerForTest(star, 'mut_anch', () => {});
    assert(star.children.length === 1 && String(star.children[0].className).includes('feedback-picker-wrap'),
      '[28d] MUTATION CONFIRMED (a): with the pre-fix anchor the popover is appended INSIDE the ⭐ <button> — finding #2\'s invalid nesting, reproduced');
    assert(reactions.children.every(c => !String(c.className).includes('feedback-picker-wrap')),
      '[28d] MUTATION CONFIRMED (b): nothing lands in .chat-reactions, so left:0 measures from the right-aligned button — finding #1\'s overflow, reproduced');
    assert(star.children[0].closest('.chat-reactions') === reactions,
      '[28d] control: the mutant tree is wired correctly (the nested popover still resolves upward to the row) — the mutation moved the HOST, it did not break the fixture');
  } finally {
    globalThis.document = realDoc;
  }
}

// ── Final cleanup — every mutant tmpdir this file created is removed, and
// real source under cfb-pickems/js/ is confirmed byte-identical to what was
// read at the top of the run. Every mutation in this file ran against a
// tmpdir copy only (CLAUDE.md prohibited-moves: never mutate real source as
// part of a routine, repeatable run).
await Promise.all(mutantTmpDirs.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
{
  const chatSrcNow = await readFile(new URL('./js/chat.js', import.meta.url), 'utf8');
  const chatUiSrcNow = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  assert(chatSrcNow === REAL_CHAT_JS_AT_START, 'real js/chat.js is byte-identical after the whole run — every mutation ran against a tmpdir copy only');
  assert(chatUiSrcNow === REAL_CHAT_UI_JS_AT_START, 'real js/chat-ui.js is byte-identical after the whole run — every mutation ran against a tmpdir copy only');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
else console.log(`❌ FAILURES — ${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
