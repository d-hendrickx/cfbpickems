/**
 * CFB Pickems — shellstatetest.mjs (DI-210b, S-C17 / reviewer #2/#3, round 1 gate, 2026-09-20)
 * ================================================================================================
 * Unit tests for js/app.js's restoreNativeShellUiState()/bootDefaultTab() —
 * the native shell's tab/scroll restore across a WKWebView reload. Own
 * process: mutates globalThis.window/document repeatedly across scenarios,
 * which would leak into every suite after it if run inline (same reasoning
 * platformtest.mjs/nativeguardtest.mjs already state for themselves).
 *
 * Run:  node shellstatetest.mjs
 *
 * Covers:
 *   [1] S-C17 — a saved tab that is one of the six AND has a real #page-<tab>
 *       element IS restored (state.currentTab flips, the restored flag is
 *       true).
 *   [2] S-C17 — a bogus/unknown tab name is REJECTED — normal default boot,
 *       never a blank shell, restored flag stays false.
 *   [3] S-C17 — a syntactically valid tab name whose #page-<tab> element does
 *       NOT exist in this build's DOM is also REJECTED (a stale save from a
 *       future build that renamed/removed a tab).
 *   [4] Web (isNativeShell()===false) never restores, regardless of what is
 *       stored.
 *   [5] reviewer #3 — bootDefaultTab() only returns the restored tab when
 *       BOTH isNativeShell() and the restored flag are true; otherwise
 *       'dashboard', unconditionally (web byte-identical).
 */

import { readFile } from 'node:fs/promises';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── Minimal stubs — enough for js/app.js to import cleanly (mirrors
//    loadtest.mjs's own rig) and for the six #page-<tab> ids to be checkable. ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const REAL_PAGE_IDS = new Set(['page-picks', 'page-dashboard', 'page-leaderboard', 'page-commissioner', 'page-rules', 'page-chat']);
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
  getElementById: (id) => (REAL_PAGE_IDS.has(id) ? nullEl : null),
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
globalThis.fetch = async () => { throw new Error('network disabled in shellstatetest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const app = await import('./js/app.js');
const { setShellUiState } = await import('./js/storage.js');
const {
  _restoreNativeShellUiStateForTest: restore,
  _nativeShellTabRestoredForTest: wasRestored,
  _bootDefaultTabForTest: bootDefaultTab,
  _resetNativeShellRestoreForTest: resetRestore,
  state,
  _readBoundedTextForTest: readBoundedText,
  _bundledVersionTagForTest: bundledVersionTag,
  SW_FETCH_BYTE_CAP_FOR_TEST: BYTE_CAP,
} = app;

function setNative(on) {
  if (on) globalThis.window.Capacitor = { isNativePlatform: () => true };
  else delete globalThis.window.Capacitor;
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] Valid tab + real #page-<tab> element → restored
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] S-C17 — a valid tab with a real #page-<tab> element is restored…');
{
  resetRestore();
  state.currentTab = 'picks';
  setShellUiState('leaderboard', 120);
  setNative(true);
  restore();
  assert(state.currentTab === 'leaderboard', `[1a] state.currentTab flips to the saved, valid tab (got "${state.currentTab}")`);
  assert(wasRestored() === true, '[1b] the restored flag is true');
  assert(bootDefaultTab() === 'leaderboard', '[1c] bootDefaultTab() now returns the restored tab, not "dashboard"');
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] Bogus tab name → rejected, normal default boot
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] S-C17 — a bogus tab name is rejected — never a blank shell…');
{
  resetRestore();
  state.currentTab = 'picks';
  setShellUiState('not-a-real-tab', 50);
  setNative(true);
  restore();
  assert(state.currentTab === 'picks', `[2a] state.currentTab is UNCHANGED — a bogus save never wins (got "${state.currentTab}")`);
  assert(wasRestored() === false, '[2b] the restored flag stays false');
  assert(bootDefaultTab() === 'dashboard', '[2c] bootDefaultTab() falls back to "dashboard" — normal boot, never a blank shell');
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] Syntactically valid tab, but its #page-<tab> element does not exist
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] S-C17 — a valid-LOOKING tab whose #page-<tab> element is missing is also rejected…');
{
  resetRestore();
  state.currentTab = 'picks';
  // 'commissioner' is in the fixed allow-list, but this scenario's DOM stub
  // pretends its section was removed — a stale save from a future build.
  const savedGetById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => (id === 'page-commissioner' ? null : savedGetById(id));
  setShellUiState('commissioner', 10);
  setNative(true);
  restore();
  assert(state.currentTab === 'picks', `[3a] state.currentTab is UNCHANGED — allow-listed name alone is not enough (got "${state.currentTab}")`);
  assert(wasRestored() === false, '[3b] the restored flag stays false');
  globalThis.document.getElementById = savedGetById;
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] Web never restores, regardless of what is stored
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Web (isNativeShell()===false) never restores…');
{
  resetRestore();
  state.currentTab = 'picks';
  setShellUiState('leaderboard', 999);
  setNative(false);
  restore();
  assert(state.currentTab === 'picks', `[4a] state.currentTab is UNCHANGED on web even with a valid saved tab present (got "${state.currentTab}")`);
  assert(wasRestored() === false, '[4b] the restored flag stays false on web');
  assert(bootDefaultTab() === 'dashboard', '[4c] bootDefaultTab() is "dashboard" on web — byte-identical to pre-DI-210b behaviour');
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] Source-level — the three named cold-boot paths use bootDefaultTab()
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] Source-level — the three named !rendered fallback paths call bootDefaultTab(), not a hardcoded literal…');
{
  const src = await readFile('./js/app.js', 'utf8');
  const hardcodedCount = (src.match(/if \(!rendered\) \{ setBackendMode\('local'\); initStorage\(\); navigateTo\('dashboard'\); rendered = true; \}/g) || []).length;
  assert(hardcodedCount === 0, `[5a] no !rendered fallback path still hardcodes navigateTo('dashboard') literally (found ${hardcodedCount})`);
  const bootDefaultCount = (src.match(/if \(!rendered\) \{ setBackendMode\('local'\); initStorage\(\); navigateTo\(bootDefaultTab\(\)\); rendered = true; \}/g) || []).length;
  assert(bootDefaultCount === 3, `[5b] all three named fallback paths call navigateTo(bootDefaultTab()) (found ${bootDefaultCount})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [6] Round 1 gate, item F — the byte cap bounds the DOWNLOAD, not just the
//     parse; _bundledVersionTag() parses v<major>.<minor>.<patch> generally.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] item F — the staleness check\'s byte cap and version parse…');
{
  // Fake a streamed Response: chunks arrive one at a time via a reader,
  // exactly like a real fetch() body would.
  function fakeStreamedRes({ contentLength, chunkSizes }) {
    let i = 0;
    return {
      headers: { get: (k) => (k === 'content-length' && contentLength != null ? String(contentLength) : null) },
      body: {
        getReader: () => ({
          read: async () => {
            if (i >= chunkSizes.length) return { done: true, value: undefined };
            const size = chunkSizes[i++];
            return { done: false, value: new Uint8Array(size).fill(65) }; // 'A' * size
          },
          cancel: async () => {},
        }),
      },
      text: async () => 'AAAA', // should never be reached when a reader exists
    };
  }

  // [6a] Content-Length lies LOW (or is simply absent) but the stream itself
  // crosses the cap — the running byte count during the read must still
  // catch it. Two 40,000-byte chunks = 80,000 > 65,536.
  const overCap = await readBoundedText(fakeStreamedRes({ contentLength: null, chunkSizes: [40000, 40000] }), BYTE_CAP);
  assert(overCap === null, '[6a] a stream that crosses the cap mid-download returns null, even with no declared Content-Length');

  // [6b] Content-Length alone, declared too large, rejects WITHOUT reading
  // a single chunk (the fast path).
  let readerBuilt = 0;
  const bigDeclared = { ...fakeStreamedRes({ contentLength: 999999, chunkSizes: [10] }) };
  const origGetReader = bigDeclared.body.getReader;
  bigDeclared.body.getReader = () => { readerBuilt++; return origGetReader(); };
  const overDeclared = await readBoundedText(bigDeclared, BYTE_CAP);
  assert(overDeclared === null, '[6b] a declared Content-Length over the cap is rejected');
  assert(readerBuilt === 0, '[6b] …WITHOUT ever calling getReader() — the fast path needs no read at all');

  // [6c] Under the cap, both ways, still decodes correctly.
  const underCap = await readBoundedText(fakeStreamedRes({ contentLength: 8, chunkSizes: [8] }), BYTE_CAP);
  assert(underCap === 'AAAAAAAA', `[6c] a response under the cap decodes correctly (got "${underCap}")`);

  // [6d]/[6e] — _bundledVersionTag() no longer dies at v1.x.
  assert(JSON.stringify(bundledVersionTag('v0.22.8')) === '[22,8]', '[6d] v0.x still parses (got ' + JSON.stringify(bundledVersionTag('v0.22.8')) + ')');
  assert(JSON.stringify(bundledVersionTag('v1.3.4')) === '[3,4]', `[6e] v1.x parses too, not silently null (got ${JSON.stringify(bundledVersionTag('v1.3.4'))})`);
  assert(bundledVersionTag('not-a-version') === null, '[6f] a genuinely unparseable string still returns null, not a throw');
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
