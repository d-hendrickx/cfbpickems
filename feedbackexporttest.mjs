/**
 * CFB Pickems — feedbackexporttest.mjs
 * =====================================
 * Item 10 (DI-B1) — per-row "exclude from CSV export" checkbox on the
 * commissioner Data-tab feedback list. Unit/behavioral coverage for:
 *
 *   (a) toggling excludes/includes an id, and it PERSISTS across a
 *       save→load round-trip through the storage seam (not an in-memory
 *       flag that forgets on reload).
 *   (b) buildFeedbackCsvRows() omits excluded ids and includes the rest.
 *   (c) a NEW feedback id, never added to the excluded set, defaults to
 *       INCLUDED even while OTHER ids sit excluded (CONVENTIONS #10 —
 *       absence from the set is the only thing that means "included";
 *       nothing auto-adds a fresh id to the excluded set).
 *   (d) all-excluded triggers the WARN path inside exportFeedbackCSV()
 *       rather than downloading a header-only CSV. exportFeedbackCSV()
 *       itself is module-private (not exported, same as downloadFile()/
 *       showToast() it calls) — verified two ways, the established
 *       precedent in this repo for unexported UI glue (loadtest.mjs
 *       suites 43c/43e do the same source-text check for this exact
 *       function's neighbors): (1) BEHAVIORALLY, that the all-excluded
 *       condition really does collapse buildFeedbackCsvRows() to a
 *       header-only result — proving the guard is not defending against
 *       a case that can't happen — and (2) STRUCTURALLY, that
 *       exportFeedbackCSV()'s source contains the guard, in order, before
 *       the download call, so the guard cannot be dead code sitting after
 *       the return it's supposed to prevent.
 *   (e) the on-screen render (renderFeedbackAdmin) reflects the checkbox
 *       state — checked for included, unchecked for excluded — for BOTH
 *       states on the same call, so this isn't "everything defaults
 *       checked and the assertion never actually distinguishes."
 *
 * Follows the seam throughout: every read/write goes through storage.js's
 * exported get/set helpers (getExcludedFeedbackIds/isFeedbackExcluded/
 * setFeedbackExcluded), never globalThis.localStorage directly.
 *
 * Run:  node feedbackexporttest.mjs
 * Also: TZ=UTC node feedbackexporttest.mjs && TZ=America/Los_Angeles node feedbackexporttest.mjs
 */

import { readFile } from 'node:fs/promises';

// ── Minimal DOM / localStorage stubs — identical shape to loadtest.mjs's,
// enough for storage.js AND app.js (full top-level execution) to import
// cleanly. ───────────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
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
globalThis.fetch = async () => { throw new Error('network disabled in feedbackexporttest'); };
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
const app = await import('./js/app.js');
const appJsSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');

const {
  getExcludedFeedbackIds, isFeedbackExcluded, setFeedbackExcluded,
  getFeedback, appendFeedback, clearFeedback,
} = storage;
const { renderFeedbackAdmin, buildFeedbackCsvRows } = app;

console.log('[feedbackexporttest] modules imported —', Object.keys(storage).length, 'storage exports,', Object.keys(app).length, 'app exports');
console.log('  new storage exports present:',
  typeof getExcludedFeedbackIds === 'function', typeof isFeedbackExcluded === 'function', typeof setFeedbackExcluded === 'function');

// ── (a) toggle persists across a save→load round-trip through the seam ──────
console.log('\n[a] setFeedbackExcluded() persists through the storage seam…');
{
  clearFeedback();
  localStorage.removeItem('cfbp_feedback_excluded_ids');

  assert(isFeedbackExcluded('fb_a1') === false, 'a fresh id, never touched, is included (isFeedbackExcluded === false)');
  setFeedbackExcluded('fb_a1', true);
  assert(isFeedbackExcluded('fb_a1') === true, 'after excluding, isFeedbackExcluded() reports true immediately');
  assert(getExcludedFeedbackIds().includes('fb_a1'), 'the id is actually IN the persisted set, not just an in-memory flag');

  // Round-trip: read the raw seam key back out, independent of the accessor,
  // so this cannot pass on a helper that quietly kept its own in-memory copy.
  const raw = JSON.parse(localStorage.getItem('cfbp_feedback_excluded_ids'));
  assert(Array.isArray(raw) && raw.includes('fb_a1'), 'save() actually wrote the id to the cfbp_feedback_excluded_ids seam key');

  // Re-including removes it, also verified against the raw key.
  setFeedbackExcluded('fb_a1', false);
  assert(isFeedbackExcluded('fb_a1') === false, 're-checking (excluded:false) flips it back to included');
  const raw2 = JSON.parse(localStorage.getItem('cfbp_feedback_excluded_ids'));
  assert(Array.isArray(raw2) && !raw2.includes('fb_a1'), 're-inclusion actually removes the id from the persisted set, not just masks it');
}

// ── (b) CSV export omits excluded ids and includes the rest ─────────────────
console.log('\n[b] buildFeedbackCsvRows() omits excluded ids, includes the rest…');
{
  const entries = [
    { id: 'fb_b1', name: 'Drew', kind: 'bug', body: 'keep me' },
    { id: 'fb_b2', name: 'Kevin', kind: 'feature', body: 'exclude me' },
    { id: 'fb_b3', name: 'Koby', kind: 'bug', body: 'keep me too' },
  ];
  const rows = buildFeedbackCsvRows(entries, null, ['fb_b2']);
  const idsOut = rows.slice(1).map(r => r[0]);
  assert(idsOut.length === 2, `exactly 2 of 3 rows survive the exclusion (got ${idsOut.length})`);
  assert(idsOut.includes('fb_b1') && idsOut.includes('fb_b3'), 'the two NON-excluded ids are both present');
  assert(!idsOut.includes('fb_b2'), 'the excluded id fb_b2 is absent from the export rows');

  // Default (no explicit excludedIds arg) reads the LIVE seam — proves the
  // real call site (exportFeedbackCSV(), which passes no 3rd argument) gets
  // real filtering, not just the explicit-array test shape above.
  clearFeedback();
  localStorage.removeItem('cfbp_feedback_excluded_ids');
  entries.forEach(appendFeedback);
  setFeedbackExcluded('fb_b2', true);
  const liveRows = buildFeedbackCsvRows(getFeedback());
  const liveIds = liveRows.slice(1).map(r => r[0]);
  assert(!liveIds.includes('fb_b2') && liveIds.includes('fb_b1') && liveIds.includes('fb_b3'),
    'with NO excludedIds argument, buildFeedbackCsvRows() filters against the live persisted set — the real production call shape');
}

// ── (c) a brand-new id defaults to included even while others are excluded ──
console.log('\n[c] a NEW id defaults to included even after other ids are excluded…');
{
  clearFeedback();
  localStorage.removeItem('cfbp_feedback_excluded_ids');
  setFeedbackExcluded('fb_old1', true);
  setFeedbackExcluded('fb_old2', true);
  assert(isFeedbackExcluded('fb_brand_new') === false,
    'a feedback id that has NEVER been touched is included, regardless of how many other ids are already excluded');
  const rows = buildFeedbackCsvRows(
    [{ id: 'fb_old1', body: 'old excluded' }, { id: 'fb_brand_new', body: 'just arrived' }],
  );
  const ids = rows.slice(1).map(r => r[0]);
  assert(!ids.includes('fb_old1') && ids.includes('fb_brand_new'),
    'the brand-new report survives the export even though a prior id sits excluded — nothing auto-adds a fresh id to the excluded set');
}

// ── (d) all-excluded triggers the warn path, not a header-only export ───────
console.log('\n[d] all-excluded warns instead of exporting a header-only CSV…');
{
  // (d-1) BEHAVIORAL — prove the collapse this guard exists to prevent is
  // real: with every entry excluded, buildFeedbackCsvRows() alone (no guard)
  // really does fall to header-only.
  const allExcludedEntries = [{ id: 'fb_d1', body: 'x' }, { id: 'fb_d2', body: 'y' }];
  const collapsedRows = buildFeedbackCsvRows(allExcludedEntries, null, ['fb_d1', 'fb_d2']);
  assert(collapsedRows.length === 1,
    'fixture check: buildFeedbackCsvRows() with EVERY id excluded really does collapse to header-only — the guard is not defending against an impossible case');

  // (d-2) STRUCTURAL — exportFeedbackCSV() itself contains the guard, and the
  // guard's early return sits BEFORE the download call, not after (dead-code
  // canary: a guard written after `downloadFile(...)` would never fire).
  const fnMatch = appJsSrc.match(/function exportFeedbackCSV\(\) \{[\s\S]*?\n\}/);
  assert(!!fnMatch, 'exportFeedbackCSV() located in js/app.js');
  const fnSrc = fnMatch ? fnMatch[0] : '';
  const everyIdx = fnSrc.indexOf('.every(');
  const showToastIdx = fnSrc.indexOf('showToast(');
  const returnIdx = fnSrc.indexOf('return;');
  const downloadIdx = fnSrc.indexOf('downloadFile(');
  assert(everyIdx > -1, 'exportFeedbackCSV() computes an "every entry excluded" condition');
  assert(showToastIdx > -1 && showToastIdx < downloadIdx,
    'the warn toast fires BEFORE the download call, not after (order proven in source)');
  assert(returnIdx > -1 && returnIdx < downloadIdx,
    'the early `return;` sits before downloadFile(...) — the guard actually short-circuits the export, it is not dead code after it');
  assert(/nothing to export/i.test(fnSrc),
    'the warn message names the actual condition (nothing to export), not a generic error');
  // Not vacuous: prove the checks above WOULD fail against a version of the
  // function with the guard's early return removed (the exact defect this
  // test exists to catch — a guard that computes allExcluded but never
  // returns before the download).
  const noGuardFnSrc = fnSrc.replace('      return;\n', '');
  const noGuardReturnIdx = noGuardFnSrc.indexOf('return;');
  const noGuardDownloadIdx = noGuardFnSrc.indexOf('downloadFile(');
  assert(!(noGuardReturnIdx > -1 && noGuardReturnIdx < noGuardDownloadIdx),
    'canary: with the early return stripped out, the "return before download" check above would correctly fail — proving it is not vacuously true');
}

// ── (e) on-screen render reflects checkbox state, for BOTH states at once ───
console.log('\n[e] renderFeedbackAdmin() on-screen checkbox reflects exclusion state…');
{
  localStorage.removeItem('cfbp_feedback_excluded_ids');
  setFeedbackExcluded('fb_e_excluded', true);
  const html = renderFeedbackAdmin([
    { id: 'fb_e_included', name: 'Jacob', kind: 'bug', body: 'still in' },
    { id: 'fb_e_excluded', name: 'Brayden', kind: 'feature', body: 'left out' },
  ]);
  const includedTag = (html.match(/<input type="checkbox" class="fb-excl-check" data-fb-id="fb_e_included"[^>]*\/>/) || [''])[0];
  const excludedTag = (html.match(/<input type="checkbox" class="fb-excl-check" data-fb-id="fb_e_excluded"[^>]*\/>/) || [''])[0];
  assert(includedTag.length > 0 && excludedTag.length > 0, 'fixture check: both checkbox input tags were actually found in the rendered HTML');
  assert(/checked/.test(includedTag), 'the INCLUDED entry renders its checkbox checked');
  assert(!/checked/.test(excludedTag), 'the EXCLUDED entry renders its checkbox NOT checked — the two states are genuinely distinguished, not both defaulting the same way');
  assert(html.includes("Uncheck an item to leave it out of the next CSV export. Your selection is remembered."),
    'the exact approved copy is present on screen');
}

console.log('\n' + '═'.repeat(50));
if (fail === 0) { console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`); process.exit(0); }
else { console.log(`❌ FAILURES — ${pass} passed, ${fail} failed`); process.exit(1); }
