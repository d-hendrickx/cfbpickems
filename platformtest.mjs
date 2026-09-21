/**
 * CFB Pickems — platformtest.mjs (DI-208c/DI-208f, iOS Munera thread, 2026-09-19)
 * ===============================================================================
 * Unit tests for js/platform.js's `isNativeShell()` — the ONE platform-
 * detection predicate every native-vs-web branch in the app must call
 * (AD-68) — plus the two DI-210e guard clauses in js/push-onesignal.js and
 * js/sw-register.js that consume it. Precedent for a focused standalone
 * suite beside loadtest.mjs: grouptest.mjs (UN-118), authtest.mjs.
 *
 * Run:  node platformtest.mjs
 *
 * Covers:
 *   [1] isNativeShell() core predicate — false with no window, false with a
 *       window but no window.Capacitor, false when isNativePlatform() is not
 *       a function, false when it returns false, TRUE only when it returns
 *       true.
 *   [2] Grep-proof (DI-208c "provably inert on the web") — no shipped source
 *       file (js/*.js excluding this and every other *.mjs test harness,
 *       index.html, service-worker.js) ever assigns `window.Capacitor`.
 *       Test harnesses legitimately STUB the global to exercise the true
 *       branch, so they are excluded from the scan by construction, not by
 *       exemption — this proves the SHIPPED app never sets it, not that no
 *       file anywhere mentions the string.
 *   [3] DI-210e guard — js/push-onesignal.js's ensureOneSignalInit() never
 *       touches config.json (fetch) or injects a <script> when the native
 *       stub says isNativeShell()===true, and resolves the SAME inert shape
 *       the module already uses for a browser it refuses outright
 *       ({ok:false, reason:'unsupported-browser'}). With no native stub,
 *       the pre-existing web behaviour is unchanged — it DOES reach fetch().
 *   [4] DI-210e guard — js/sw-register.js's setupServiceWorker() never calls
 *       navigator.serviceWorker.register()/getRegistration() under the
 *       native stub, resolving the same {action:'unsupported',
 *       registration:null} shape the module already uses when there's no
 *       navigator.serviceWorker at all. With no native stub, registration
 *       proceeds exactly as before.
 *   [5] isNativeOrigin() — the ORIGIN-POSITIVE gate (S-C1/S-C8/S-C14, PASS
 *       1b, 2026-09-20). False on plain web (no Capacitor), false on a
 *       SPOOFED window.Capacitor sitting on an https: origin (the exact
 *       downgrade attack S-C1/S-C8 name), TRUE only when isNativeShell() is
 *       true AND location.protocol is the native scheme.
 *
 * NOT covered here: a real Capacitor runtime injecting window.Capacitor —
 * that is DI-208a's spike, on real hardware, once Drew's Xcode install
 * lands. This file proves the SEAM's logic, not the native bridge itself.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] isNativeShell() core predicate
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] isNativeShell() — the one predicate, every case…');
{
  const savedWindow = 'window' in globalThis ? globalThis.window : undefined;
  const hadWindow = 'window' in globalThis;

  // No window at all (delete it entirely — the real Node/loadtest case).
  // Imported ONCE, here — isNativeShell() reads globalThis.window at CALL
  // time (zero top-level side effects means no per-scenario re-import is
  // needed; the module caches nothing).
  const { isNativeShell } = await import('./js/platform.js');
  delete globalThis.window;
  assert(isNativeShell() === false, '[1a] no window defined at all → false');

  // Window exists, no Capacitor property.
  globalThis.window = {};
  assert(isNativeShell() === false, '[1b] window defined, no window.Capacitor → false');

  // Capacitor exists but isNativePlatform is not a function.
  globalThis.window = { Capacitor: { isNativePlatform: 'not-a-function' } };
  assert(isNativeShell() === false, '[1c] window.Capacitor.isNativePlatform is not a function → false');

  globalThis.window = { Capacitor: {} };
  assert(isNativeShell() === false, '[1c\'] window.Capacitor present with no isNativePlatform key at all → false');

  // isNativePlatform() is a function, returns false.
  globalThis.window = { Capacitor: { isNativePlatform: () => false } };
  assert(isNativeShell() === false, '[1d] window.Capacitor.isNativePlatform() returns false → false');

  // isNativePlatform() is a function, returns a truthy-but-not-strictly-true value.
  globalThis.window = { Capacitor: { isNativePlatform: () => 1 } };
  assert(isNativeShell() === false, '[1e] isNativePlatform() returns a truthy non-boolean (1) → false (=== true, not truthy)');

  // The ONLY true case.
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  assert(isNativeShell() === true, '[1f] window.Capacitor.isNativePlatform() returns true → TRUE, the only true case');

  // Restore.
  if (hadWindow) globalThis.window = savedWindow; else delete globalThis.window;
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] Grep-proof — nothing SHIPPED ever assigns window.Capacitor
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Grep-proof — no shipped source file assigns window.Capacitor…');
{
  const root = path.dirname(fileURLToPath(import.meta.url));
  const ASSIGN_RE = /window\.Capacitor\s*=(?!=)/;
  const offenders = [];
  const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'supabase']);

  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      // Test harnesses (*.mjs at the repo root) legitimately STUB the global
      // to exercise the true branch — excluded from this scan by
      // construction (DI-208c is a claim about the SHIPPED app, not about
      // whether any file anywhere mentions the string).
      if (e.name.endsWith('.mjs')) continue;
      if (!(e.name.endsWith('.js') || e.name === 'index.html' || e.name === 'service-worker.js')) continue;
      const src = await readFile(full, 'utf8');
      if (ASSIGN_RE.test(src)) offenders.push(full);
    }
  }
  await walk(root);
  assert(offenders.length === 0,
    `[2a] zero window.Capacitor assignments across shipped *.js/index.html/service-worker.js (found: ${offenders.join(', ') || 'none'})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] DI-210e guard — js/push-onesignal.js never loads/inits inside the shell
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] push-onesignal.js — the guard actually blocks the SDK, and web is unaffected…');
{
  // Minimal DOM/localStorage stubs — enough for push-onesignal.js to import
  // and run cleanly, same shape as notifytest.mjs's rig.
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };

  let fetchCalls = 0, createElementCalls = 0;
  const installStubs = ({ native }) => {
    fetchCalls = 0; createElementCalls = 0;
    globalThis.window = native
      ? { Capacitor: { isNativePlatform: () => true } }
      : {};
    globalThis.document = {
      head: { appendChild(s) { createElementCalls++; setTimeout(() => s.onerror?.(), 0); } },
      createElement: () => { createElementCalls++; return { src: '', defer: false, onload: null, onerror: null }; },
      body: { dataset: {} },
    };
    // Node 21+ ships a getter-only global `navigator` — same workaround
    // notifytest.mjs's own rig uses.
    const navValue = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/127', vendor: 'Google Inc.', maxTouchPoints: 1, standalone: false };
    try { globalThis.navigator = navValue; }
    catch { Object.defineProperty(globalThis, 'navigator', { value: navValue, configurable: true, writable: true }); }
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.Notification = { permission: 'default', requestPermission: async () => 'default' };
    globalThis.PushSubscriptionOptions = function () {};
    globalThis.PushSubscriptionOptions.prototype.applicationServerKey = null;
    globalThis.fetch = async () => {
      fetchCalls++;
      return { ok: true, json: async () => ({ oneSignalAppId: 'abad65e9-0000-0000-0000-000000000000' }) };
    };
  };

  const push = await import('./js/push-onesignal.js');

  // NATIVE — the guard must fire before any config read or script injection.
  installStubs({ native: true });
  push._resetForTest({ sdkReadyMs: 60, promptMs: 60 });
  const nativeRes = await push.ensureOneSignalInit();
  assert(nativeRes && nativeRes.ok === false && nativeRes.reason === 'unsupported-browser',
    `[3a] isNativeShell()===true → ensureOneSignalInit() resolves the SAME inert shape as an unsupported browser (got ${JSON.stringify(nativeRes)})`);
  assert(fetchCalls === 0, '[3b] …and never fetched config.json (the guard fires before loadAppId())');
  assert(createElementCalls === 0, '[3c] …and never touched the DOM to inject the SDK <script> (loadSdkScript()\'s own guard, defense-in-depth)');

  // WEB — pre-existing behaviour unchanged: the same call DOES reach fetch().
  installStubs({ native: false });
  push._resetForTest({ sdkReadyMs: 60, promptMs: 60 });
  const webRes = await push.ensureOneSignalInit();
  assert(fetchCalls > 0, '[3d] isNativeShell()===false (real web case) → ensureOneSignalInit() still reads config.json exactly as before the guard existed');
  assert(webRes && typeof webRes.ok === 'boolean', `[3e] …and resolves a normal diagnostic result, not the native short-circuit (got ${JSON.stringify(webRes)})`);

  // DI-210e item 2 (PASS 1b) — subscriptionState()'s SIXTH state,
  // 'native-unavailable', checked BEFORE any async config read (fetchCalls
  // stays 0). This is what feeds app.js's honest priming-card copy without
  // either of its two consumers needing a native branch of their own.
  installStubs({ native: true });
  fetchCalls = 0;
  const nativeState = await push.subscriptionState();
  assert(nativeState === 'native-unavailable', `[3f] isNativeShell()===true → subscriptionState()==='native-unavailable' (got "${nativeState}")`);
  assert(fetchCalls === 0, '[3g] …and never fetched config.json to get there — checked first, before isPushConfigured()');

  // WEB — pre-existing behaviour unchanged: the state machine still runs.
  installStubs({ native: false });
  const webState = await push.subscriptionState();
  assert(webState !== 'native-unavailable', `[3h] isNativeShell()===false (real web case) → subscriptionState() never resolves 'native-unavailable' (got "${webState}")`);

  push._resetForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] DI-210e guard — js/sw-register.js never registers inside the shell
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] sw-register.js — the guard blocks registration, web is unaffected…');
{
  const { setupServiceWorker } = await import('./js/sw-register.js');

  let registerCalls = 0, getRegCalls = 0;
  const makeNav = () => ({
    serviceWorker: {
      controller: null,
      async getRegistration() { getRegCalls++; return null; },
      async register(url, opts) { registerCalls++; return { scope: opts?.scope, active: null, waiting: null, installing: null, addEventListener() {} }; },
      addEventListener() {},
    },
  });

  // GENUINE NATIVE (isNativeShell() true AND the native scheme) — must never
  // touch navigator.serviceWorker at all. S-C1 (security-reviewer, round 1
  // gate): the guard is isNativeOrigin(), which needs BOTH halves — set
  // location.protocol to the native scheme, not just the Capacitor stub.
  registerCalls = 0; getRegCalls = 0;
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  globalThis.location = { protocol: 'capacitor:' };
  const nativeNav = makeNav();
  const nativeRes = await setupServiceWorker({ nav: nativeNav, scriptUrl: 'service-worker.js?v=20-0', log: () => {}, warn: () => {} });
  assert(nativeRes && nativeRes.action === 'unsupported' && nativeRes.registration === null,
    `[4a] isNativeOrigin()===true → setupServiceWorker() resolves the SAME inert shape as "no navigator.serviceWorker" (got ${JSON.stringify(nativeRes)})`);
  assert(registerCalls === 0 && getRegCalls === 0, '[4b] …and never called register()/getRegistration() on the injected navigator');

  // SPOOF PROOF (S-C1) — a persistent spoof of window.Capacitor on the REAL
  // https: origin must NOT suppress registration. isNativeShell() alone
  // would have wrongly skipped here (the exact downgrade-persistence S-C1
  // exists to stop: a compromised page pinning a stale worker and blocking
  // every future update check). isNativeOrigin() requires the native scheme
  // too, which an https: page can never fake, so registration proceeds.
  registerCalls = 0; getRegCalls = 0;
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  globalThis.location = { protocol: 'https:' };
  const spoofNav = makeNav();
  const spoofRes = await setupServiceWorker({ nav: spoofNav, scriptUrl: 'service-worker.js?v=20-0', log: () => {}, warn: () => {} });
  assert(spoofRes && spoofRes.action === 'registered',
    `[4e] SPOOFED window.Capacitor on an https: origin → setupServiceWorker() still registers normally, not suppressed (got ${JSON.stringify(spoofRes)})`);
  assert(registerCalls === 1, '[4f] …and register() was actually called — the spoof cannot pin a stale worker by suppressing future update checks');

  // WEB — pre-existing behaviour unchanged: registration proceeds.
  registerCalls = 0; getRegCalls = 0;
  globalThis.window = {};
  globalThis.location = { protocol: 'https:' };
  const webNav = makeNav();
  const webRes = await setupServiceWorker({ nav: webNav, scriptUrl: 'service-worker.js?v=20-0', log: () => {}, warn: () => {} });
  assert(webRes && webRes.action === 'registered', `[4c] isNativeShell()===false (real web case) → registration proceeds exactly as before (got ${JSON.stringify(webRes)})`);
  assert(registerCalls === 1, '[4d] …and register() was actually called once');
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] isNativeOrigin() — origin-positive, spoof-resistant
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] isNativeOrigin() — the origin-positive gate every SECURITY branch must use…');
{
  const savedWindow = 'window' in globalThis ? globalThis.window : undefined;
  const hadWindow = 'window' in globalThis;
  const savedLocation = 'location' in globalThis ? globalThis.location : undefined;
  const hadLocation = 'location' in globalThis;

  const { isNativeOrigin } = await import('./js/platform.js');

  // Plain web: no Capacitor at all, real https origin.
  delete globalThis.window;
  globalThis.location = { protocol: 'https:' };
  assert(isNativeOrigin() === false, '[5a] plain web (no window.Capacitor) on https: → false');

  // THE SPOOF S-C1/S-C8/S-C14 exist to stop: window.Capacitor is fully
  // present and reports native — on an https: origin, which a page's own
  // script can NEVER actually change (the browser sets location.protocol).
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  globalThis.location = { protocol: 'https:' };
  assert(isNativeOrigin() === false,
    '[5b] SPOOFED window.Capacitor.isNativePlatform()===true on an https: origin → still false — this is the whole point of "origin-positive"');

  // No location global at all (some older Node/test contexts) — must not
  // throw, must not accidentally read as native.
  delete globalThis.location;
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  assert(isNativeOrigin() === false, '[5c] window.Capacitor native + no location global at all → false, not a throw');

  // The ONLY true case: isNativeShell() true AND the native scheme.
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  globalThis.location = { protocol: 'capacitor:' };
  assert(isNativeOrigin() === true, '[5d] window.Capacitor native + location.protocol==="capacitor:" → TRUE, the only true case');

  // Capacitor scheme alone, without a native window.Capacitor, is not enough
  // either — both halves of the AND are load-bearing.
  delete globalThis.window;
  globalThis.location = { protocol: 'capacitor:' };
  assert(isNativeOrigin() === false, '[5e] capacitor: origin with no window.Capacitor at all → false (both halves of the AND are load-bearing)');

  // Restore.
  if (hadWindow) globalThis.window = savedWindow; else delete globalThis.window;
  if (hadLocation) globalThis.location = savedLocation; else delete globalThis.location;
}

// ── Result ───────────────────────────────────────────────────────────────────
// Write-then-exit-in-the-callback + unref'd backstop timer (grouptest.mjs/
// authtest.mjs precedent, reviewer F-3/security F-6) — a dropped summary line
// or a hang-forever child under loadtest.mjs's spawnSync() are both worse
// than a slightly delayed exit.
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
