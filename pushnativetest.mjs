/**
 * CFB Pickems — pushnativetest.mjs (DI-217/239/240/241/243, native push, 2026-09-23)
 * =====================================================================================
 * Unit tests for js/push-native.js — the native (Capacitor/iOS) push client, loaded
 * ONLY by dynamic import on native (never statically, never on web). Precedent for a
 * focused standalone suite beside loadtest.mjs: platformtest.mjs, notifytest.mjs.
 *
 * Run:  node pushnativetest.mjs
 *
 * Covers:
 *   [1]  Web/no-plugin inertness — every export resolves a safe default and never
 *        throws, and never touches `fetch`/the plugin, with no `window.Capacitor` at all.
 *   [2]  NativePushAdapter.send() — the documented AD-67 no-op contract.
 *   [3]  initNativePush() — not-configured / plugin-unavailable / success, and that
 *        `initialize()` is called AT MOST ONCE across repeated calls (memoized).
 *   [4]  Identity ordering (security F-3's shape, mirrored not copied) — a slow login
 *        landing after a logout must not win; calls land in call order.
 *   [5]  logoutNativePush() never touches the plugin when init was never attempted.
 *   [6]  fetchIdentityToken() (DI-254) is wired — called before every login attempt —
 *        and a FAILED mint never blocks the login call (Identity Verification is off).
 *   [7]  nativePushState() — the full OSNotificationPermission enum mapping.
 *   [8]  requestNativePushPermission() — inits first, calls requestPermission with
 *        fallbackToSettings:false, and logs in on grant.
 *   [9]  openNativeSettings() — sets the app-settings: scheme, guarded off-native.
 *   [10] Foreground wiring — onForegroundPush fires, proceedWithWillDisplay is called
 *        even if the hook throws, and is NEVER called without a notificationId.
 *   [11] Click routing / security condition C2 — the SIX-tab allow-list: a valid route
 *        navigates, an unrecognized or markup/URL-shaped route is IGNORED (no
 *        navigation), a missing route falls back to destinationFor(event, ctx), and
 *        params are passed through as a plain object only — never interpolated,
 *        never a URL.
 *   [12] Cold-start ready-gate — a click that fires before markNativeBootReady() is
 *        queued and replayed once boot marks itself ready.
 *   [13] Structural — app.js's two `import('./push-native.js')` call sites are gated
 *        (isNativeShell() for the adapter/wiring site, isNativeOrigin() for the
 *        identity site), with a RED-proof that the scan actually discriminates.
 *   [14] MUTATION-PROVE — proceedWithWillDisplay omitted from the foreground listener
 *        ⇒ RED (real scratch-copy mutation, restored byte-for-byte, never git
 *        checkout/restore/stash — notifytest.mjs [9]'s established pattern).
 *   [15] Boundary — zero `@onesignal`/`@capacitor` import specifiers anywhere under
 *        cfb-pickems/ (this file's own module list included), extending
 *        munera-ios/scripts/boundarytest.mjs's existing guard from this side too.
 */

import { readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── DOM/browser stubs — same shape as notifytest.mjs's, so this harness exercises
//    the real module under the same conditions. ────────────────────────────────
globalThis.window = globalThis;
globalThis.document = { body: {}, getElementById: () => null };
globalThis.location = { protocol: 'https:' };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A fresh module instance per section that needs isolated module state (the
// file has page-lifetime module-level memoization, same as push-onesignal.js —
// cache-busted dynamic imports are the established way around that, e.g.
// notifytest.mjs's `?mutant=`/`?restored=` query strings).
let seq = 0;
async function freshPushNative() {
  return import(`./js/push-native.js?t=${Date.now()}_${seq++}`);
}

/** Builds a fake OneSignalCapacitor plugin with call-tracking. Every method a
 *  real Capacitor plugin call resolves a Promise; this mirrors that. */
function fakePlugin({ initThrows = false, loginThrows = false, permission = 2 } = {}) {
  const calls = [];
  const listeners = {};
  return {
    calls,
    listeners,
    async initialize(opts) {
      calls.push(['initialize', opts]);
      if (initThrows) throw new Error('initialize failed');
    },
    async login(opts) {
      calls.push(['login', opts]);
      if (loginThrows) throw new Error('login failed');
    },
    async logout() { calls.push(['logout']); },
    async permissionNative() { calls.push(['permissionNative']); return { permission }; },
    async requestPermission(opts) { calls.push(['requestPermission', opts]); return { permission: true }; },
    async proceedWithWillDisplay(opts) { calls.push(['proceedWithWillDisplay', opts]); },
    addListener(event, cb) { listeners[event] = cb; calls.push(['addListener', event]); return { remove() {} }; },
  };
}
function installPlugin(plugin) {
  globalThis.window.Capacitor = { isNativePlatform: () => true, Plugins: { OneSignalCapacitor: plugin } };
}
function installNativeNoPlugin() {
  globalThis.window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
}
function uninstallCapacitor() { delete globalThis.window.Capacitor; }

/** A fake Capacitor Preferences plugin, backed by a plain Map — the SAME
 *  raw-call shape js/auth-storage-native.js already uses
 *  (`window.Capacitor.Plugins.Preferences`). Passing the SAME `store` Map
 *  across two `installPlugin*()` calls simulates the flag surviving a
 *  process restart (N-4) — the OneSignal plugin's own `calls` reset (a new
 *  `fakePlugin()`), but Preferences' backing store does not, exactly
 *  mirroring what actually persists across a real app relaunch. */
function fakePreferences(store = new Map()) {
  return {
    store,
    async get({ key }) { return { value: store.has(key) ? store.get(key) : null }; },
    async set({ key, value }) { store.set(key, value); },
    async remove({ key }) { store.delete(key); },
  };
}
function installPluginWithPrefs(plugin, prefs) {
  globalThis.window.Capacitor = { isNativePlatform: () => true, Plugins: { OneSignalCapacitor: plugin, Preferences: prefs } };
}

function withFetchOk(appId = 'test-app-id') {
  let called = 0;
  globalThis.fetch = async () => { called++; return { ok: true, json: async () => ({ oneSignalAppId: appId }) }; };
  return () => called;
}
function withFetchThrows(label = 'no fetch expected') {
  globalThis.fetch = async () => { throw new Error(label); };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Web/no-plugin inertness — no window.Capacitor at all…');
{
  uninstallCapacitor();
  withFetchThrows('[1] fetch must never be called with no native shell');
  const native = await freshPushNative();

  const initRes = await native.initNativePush();
  assert(initRes.ok === false && initRes.reason === 'not-native', '[1a] initNativePush() resolves not-native, never throws');

  await assertNoThrow(() => native.loginNativePush('p1'), '[1b] loginNativePush() never throws off-native');
  await assertNoThrow(() => native.logoutNativePush(), '[1c] logoutNativePush() never throws off-native');

  const state = await native.nativePushState();
  assert(state === 'unsupported', `[1d] nativePushState() === 'unsupported' off-native (got ${state})`);

  const permRes = await native.requestNativePushPermission('p1');
  assert(permRes.ok === false && permRes.reason === 'not-native', '[1e] requestNativePushPermission() resolves not-native, never throws');

  assert(native.openNativeSettings() === false, '[1f] openNativeSettings() returns false off-native, never throws');

  let navigated = false;
  native.wireNativeForeground(() => {});
  native.wireNativeNotificationClicks(() => { navigated = true; });
  assert(navigated === false, '[1g] wiring off-native is a no-op (nothing to attach to)');

  const adapter = new native.NativePushAdapter();
  const sendRes = await adapter.send({});
  assert(sendRes.ok === false && sendRes.skipped === true, '[1h] NativePushAdapter.send() is the documented no-op even off-native');
}

async function assertNoThrow(fn, label) {
  try { await fn(); pass++; console.log('  ✅', label); }
  catch (e) { fail++; console.error('  ❌', label, '—', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] NativePushAdapter.send() — AD-67 documented no-op…');
{
  const native = await freshPushNative();
  const adapter = new native.NativePushAdapter();
  const res = await adapter.send({ playerId: 'p1', event: 'CHAT_MESSAGE_CREATED' });
  assert(res.ok === false, '[2a] send() never claims ok:true — native never originates a send');
  assert(res.skipped === true, '[2b] send() marks itself skipped');
  assert(res.reason === 'native-adapter-never-sends', '[2c] send() names WHY, honestly, not silently');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] initNativePush() — not-configured / plugin-unavailable / success + memoized…');
{
  // (a) native shell, but config.json has no oneSignalAppId.
  installPlugin(fakePlugin());
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  let native = await freshPushNative();
  let res = await native.initNativePush();
  assert(res.ok === false && res.reason === 'not-configured', `[3a] empty oneSignalAppId ⇒ not-configured (got ${JSON.stringify(res)})`);

  // (b) native shell, app id present, but the plugin itself never registered.
  installNativeNoPlugin();
  withFetchOk();
  native = await freshPushNative();
  res = await native.initNativePush();
  assert(res.ok === false && res.reason === 'plugin-unavailable', `[3b] plugin missing ⇒ plugin-unavailable (got ${JSON.stringify(res)})`);

  // (c) success + memoization — TWO calls, ONE plugin.initialize().
  const plugin = fakePlugin();
  installPlugin(plugin);
  withFetchOk();
  native = await freshPushNative();
  const [r1, r2] = await Promise.all([native.initNativePush(), native.initNativePush()]);
  assert(r1.ok === true && r2.ok === true, '[3c] initNativePush() succeeds when plugin + app id are both present');
  const initCalls = plugin.calls.filter(c => c[0] === 'initialize');
  assert(initCalls.length === 1, `[3d] plugin.initialize() called EXACTLY ONCE across two concurrent initNativePush() calls (memoized) (got ${initCalls.length})`);
  const r3 = await native.initNativePush();
  assert(r3.ok === true, '[3e] a THIRD, later call also resolves ok without re-calling the plugin');
  assert(plugin.calls.filter(c => c[0] === 'initialize').length === 1, '[3f] …and still exactly one initialize() call');

  // (g)-(k) Reviewer Finding 2 (2026-09-23) — a FAILED first attempt must
  // NOT stay memoized, or the bounded retry ladder is dead code. Three
  // reasons, each independently proven: a plugin that throws on its first
  // call and succeeds on its second (init-failed), a config fetch that
  // fails once then succeeds (not-configured, via a transient network read),
  // and a plugin that is missing on the first call and present on the
  // second (plugin-unavailable — simulating the bridge registering late).
  {
    const failOncePlugin = fakePlugin();
    let initCallCount = 0;
    const realInit = failOncePlugin.initialize.bind(failOncePlugin);
    failOncePlugin.initialize = async (opts) => {
      initCallCount++;
      if (initCallCount === 1) { failOncePlugin.calls.push(['initialize', opts]); throw new Error('first attempt fails'); }
      return realInit(opts);
    };
    installPlugin(failOncePlugin);
    withFetchOk();
    native = await freshPushNative();
    const first = await native.initNativePush();
    assert(first.ok === false && first.reason === 'init-failed', `[3g] first attempt fails as expected (got ${JSON.stringify(first)})`);
    const second = await native.initNativePush();
    assert(second.ok === true, `[3h] a SECOND, later call RE-ATTEMPTS (not a cached failure) and succeeds (got ${JSON.stringify(second)})`);
    assert(initCallCount === 2, `[3i] the plugin's initialize() was actually called TWICE — the retry is real, not a cache hit that happens to read ok (got ${initCallCount})`);
  }
  {
    // A config read that fails once (transient) then succeeds — _loadAppId()
    // itself already doesn't memoize a transient failure (see its own
    // header); this proves initNativePush()'s OWN cache doesn't re-introduce
    // the bug one layer up.
    let fetchCallCount = 0;
    globalThis.fetch = async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) throw new Error('transient network blip');
      return { ok: true, json: async () => ({ oneSignalAppId: 'late-app-id' }) };
    };
    installPlugin(fakePlugin());
    native = await freshPushNative();
    const first = await native.initNativePush();
    assert(first.ok === false, `[3j] first attempt fails on a transient config-fetch error (got ${JSON.stringify(first)})`);
    const second = await native.initNativePush();
    assert(second.ok === true, `[3k] a SECOND call re-attempts the config read and succeeds (got ${JSON.stringify(second)})`);
  }

  // MUTATION-PROVE — drop the `if (!res.ok) _initPromise = null;` reset ⇒ RED.
  {
    const target = path.join(__dirname, 'js', 'push-native.js');
    const scratchDir = process.env.TMPDIR || '/tmp';
    const scratchCopy = `${scratchDir}/push-native.pre-mutation.${Date.now()}.js`;
    await copyFile(target, scratchCopy);
    const original = await readFile(target, 'utf8');

    const NEEDLE = 'if (!res.ok) _initPromise = null;';
    assert(original.includes(NEEDLE), '[3 fixture] the exact Finding-2 reset line was located (a missing needle would make the mutation vacuous)');
    const mutated = original.replace(NEEDLE, '/* MUTATION: Finding-2 reset dropped for pushnativetest.mjs [3] */ void 0;');
    assert(mutated !== original, '[3l] the mutation actually changed the source (non-vacuous)');
    await writeFile(target, mutated, 'utf8');

    let mutantSecondOk = false;
    try {
      const mutantMod = await import(`./js/push-native.js?mutant=${Date.now()}`);
      const failOncePlugin = fakePlugin();
      let n = 0;
      const realInit = failOncePlugin.initialize.bind(failOncePlugin);
      failOncePlugin.initialize = async (opts) => { n++; if (n === 1) throw new Error('fails'); return realInit(opts); };
      installPlugin(failOncePlugin);
      withFetchOk();
      await mutantMod.initNativePush();      // fails, would normally reset the memo
      const second = await mutantMod.initNativePush();
      mutantSecondOk = second.ok === true;
    } finally {
      await copyFile(scratchCopy, target);
      await rm(scratchCopy, { force: true });
    }
    assert(mutantSecondOk === false, '[3m] MUTATION CONFIRMED: with the reset dropped, a second call after a failed first still reads the CACHED failure and never re-attempts — this suite would be RED on this specific assertion');

    const restored = await readFile(target, 'utf8');
    assert(restored === original, '[3n] source restored byte-for-byte from the scratch copy — never via git checkout/restore/stash');

    const freshMod = await import(`./js/push-native.js?restored=${Date.now()}`);
    const failOncePlugin2 = fakePlugin();
    let n2 = 0;
    const realInit2 = failOncePlugin2.initialize.bind(failOncePlugin2);
    failOncePlugin2.initialize = async (opts) => { n2++; if (n2 === 1) throw new Error('fails'); return realInit2(opts); };
    installPlugin(failOncePlugin2);
    withFetchOk();
    await freshMod.initNativePush();
    const secondRestored = await freshMod.initNativePush();
    assert(secondRestored.ok === true, '[3o] GREEN again after restore — the real (non-mutant) code re-attempts after a failure');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Identity ordering — a slow login must not win over a later logout (mirrors security F-3)…');
{
  const calls = [];
  const plugin = fakePlugin();
  // Delay ONLY the first login() call, so it resolves AFTER the logout queued
  // right behind it — the exact race security F-3 exists to prevent on web.
  let firstLogin = true;
  const realLogin = plugin.login.bind(plugin);
  plugin.login = async (opts) => {
    calls.push(['login-start', opts.externalId]);
    if (firstLogin) { firstLogin = false; await new Promise(r => setTimeout(r, 30)); }
    await realLogin(opts);
    calls.push(['login-done', opts.externalId]);
  };
  const realLogout = plugin.logout.bind(plugin);
  plugin.logout = async () => { calls.push(['logout']); await realLogout(); };
  installPlugin(plugin);
  withFetchOk();
  const native = await freshPushNative();

  native.loginNativePush('memberA');           // slow — resolves last
  await native.logoutNativePush();              // fast — must land in ORDER, not by speed
  await new Promise(r => setTimeout(r, 60));     // let the slow login's retry/settle window pass

  const loginCallCount = plugin.calls.filter(c => c[0] === 'login').length;
  const logoutCallCount = plugin.calls.filter(c => c[0] === 'logout').length;
  assert(loginCallCount === 1, `[4a] exactly one login() attempt reached the plugin (got ${loginCallCount})`);
  assert(logoutCallCount === 1, `[4b] exactly one logout() attempt reached the plugin (got ${logoutCallCount})`);
  // The chain guarantees CALL order (login queued before logout), not
  // completion order — this proves the queue is doing its job: logout's own
  // call did not start until login's link had settled.
  const startIdx = calls.findIndex(c => c[0] === 'login-start');
  const logoutIdx = calls.findIndex(c => c[0] === 'logout');
  assert(startIdx !== -1 && logoutIdx !== -1 && startIdx < logoutIdx,
    `[4c] login was QUEUED before logout, in call order (calls: ${JSON.stringify(calls)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] logoutNativePush() — never touches the plugin when init was never attempted…');
{
  const plugin = fakePlugin();
  installPlugin(plugin);
  withFetchOk();
  const native = await freshPushNative();
  await native.logoutNativePush();
  const logoutCalls = plugin.calls.filter(c => c[0] === 'logout');
  assert(logoutCalls.length === 0, `[5a] a device that never initialized has nothing to log out of — plugin.logout() NOT called (got ${logoutCalls.length} calls)`);

  // Now the SAME device DOES init (via a login) — a subsequent logout SHOULD
  // reach the plugin.
  await native.loginNativePush('p1');
  await native.logoutNativePush();
  assert(plugin.calls.filter(c => c[0] === 'logout').length === 1, '[5b] once init has happened, a real logout() DOES reach the plugin (correction #2\'s native counterpart)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] fetchIdentityToken() (DI-254) — wired, called before login, failure never blocks it…');
{
  const plugin = fakePlugin();
  installPlugin(plugin);
  withFetchOk();
  let native = await freshPushNative();
  let mintCalled = false;
  native._setIdentityMinterForTest(async () => { mintCalled = true; return { ok: false, reason: 'no-session' }; });
  await native.loginNativePush('p1');
  assert(mintCalled === true, '[6a] the identity token mint is attempted before login');
  assert(plugin.calls.some(c => c[0] === 'login'), '[6b] a FAILED mint never blocks login() — the plugin call still happens (Identity Verification is off)');

  // A minter that THROWS must be equally non-blocking.
  native = await freshPushNative();
  const plugin2 = fakePlugin();
  installPlugin(plugin2);
  native._setIdentityMinterForTest(async () => { throw new Error('mint exploded'); });
  await native.loginNativePush('p2');
  assert(plugin2.calls.some(c => c[0] === 'login'), '[6c] a THROWING mint also never blocks login()');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] nativePushState() — the full OSNotificationPermission enum…');
{
  const cases = [
    [0, 'not-asked'], [1, 'denied'], [2, 'granted'], [3, 'granted'], [4, 'granted'],
  ];
  for (const [enumVal, expected] of cases) {
    const plugin = fakePlugin({ permission: enumVal });
    installPlugin(plugin);
    withFetchOk();
    const native = await freshPushNative();
    const got = await native.nativePushState();
    assert(got === expected, `[7-${enumVal}] permissionNative()===${enumVal} → nativePushState()==='${expected}' (got '${got}')`);
  }
  // An unrecognized/garbage enum value must fail to 'unsupported', never invent a verdict.
  const plugin = fakePlugin({ permission: 99 });
  installPlugin(plugin);
  const native = await freshPushNative();
  assert((await native.nativePushState()) === 'unsupported', '[7-garbage] an unrecognized enum value resolves unsupported, not a guess');
  // A plugin present but missing permissionNative() entirely.
  installNativeNoPlugin();
  globalThis.window.Capacitor.Plugins.OneSignalCapacitor = {};
  const native2 = await freshPushNative();
  assert((await native2.nativePushState()) === 'unsupported', '[7-missing-method] plugin present without permissionNative() resolves unsupported');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] requestNativePushPermission() — inits first, requests with fallbackToSettings:false, logs in on grant…');
{
  const plugin = fakePlugin();
  installPlugin(plugin);
  withFetchOk();
  const native = await freshPushNative();
  const res = await native.requestNativePushPermission('memberX');
  assert(res.ok === true && res.reason === 'granted', `[8a] resolves ok:true, reason:'granted' on a granted response (got ${JSON.stringify(res)})`);
  assert(plugin.calls.some(c => c[0] === 'initialize'), '[8b] initNativePush() ran first (init IS reached from this button, unlike a cold boot)');
  const reqCall = plugin.calls.find(c => c[0] === 'requestPermission');
  assert(!!reqCall && reqCall[1].fallbackToSettings === false, `[8c] requestPermission({fallbackToSettings:false}) — the app's own copy owns the Settings recovery path, not the plugin's redirect (got ${JSON.stringify(reqCall)})`);
  assert(plugin.calls.some(c => c[0] === 'login' && c[1].externalId === 'memberX'), '[8d] a grant logs the device in for the member id that was passed');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] openNativeSettings() — app-settings: scheme, guarded off-native…');
{
  installPlugin(fakePlugin());
  const native = await freshPushNative();
  const loc = { href: '' };
  globalThis.window.location = loc;
  const ok = native.openNativeSettings();
  assert(ok === true, '[9a] returns true on native');
  assert(loc.href === 'app-settings:', `[9b] sets window.location.href to the app-settings: scheme (got ${JSON.stringify(loc.href)})`);
  globalThis.window.location = globalThis.location; // restore
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] Foreground wiring — onForegroundPush, proceedWithWillDisplay, throw-safety…');
{
  // (a) normal case.
  let plugin = fakePlugin();
  installPlugin(plugin);
  withFetchOk();
  let native = await freshPushNative();
  let fired = null;
  native.wireNativeForeground((event) => { fired = event; });
  await plugin.listeners.notificationForegroundWillDisplay({ notificationId: 'n1', additionalData: { event: 'CHAT_MESSAGE_CREATED' } });
  assert(fired === 'CHAT_MESSAGE_CREATED', `[10a] onForegroundPush fires with additionalData.event (got ${JSON.stringify(fired)})`);
  assert(plugin.calls.some(c => c[0] === 'proceedWithWillDisplay' && c[1].notificationId === 'n1'), '[10b] proceedWithWillDisplay({notificationId}) is called — Finding 4, or the banner stops showing forever');

  // (b) the hook THROWS — proceedWithWillDisplay must STILL run (finally).
  plugin = fakePlugin();
  installPlugin(plugin);
  native = await freshPushNative();
  native.wireNativeForeground(() => { throw new Error('boom'); });
  await plugin.listeners.notificationForegroundWillDisplay({ notificationId: 'n2', additionalData: {} });
  assert(plugin.calls.some(c => c[0] === 'proceedWithWillDisplay' && c[1].notificationId === 'n2'), '[10c] proceedWithWillDisplay runs even when onForegroundPush THROWS (try/finally, not try/then)');

  // (c) no notificationId at all — must not call proceedWithWillDisplay with a bad id.
  plugin = fakePlugin();
  installPlugin(plugin);
  native = await freshPushNative();
  native.wireNativeForeground(() => {});
  await plugin.listeners.notificationForegroundWillDisplay({ additionalData: {} });
  assert(!plugin.calls.some(c => c[0] === 'proceedWithWillDisplay'), '[10d] no notificationId ⇒ proceedWithWillDisplay is not called with garbage');

  // (d) idempotent wiring — a second wireNativeForeground() call does not attach twice.
  plugin = fakePlugin();
  installPlugin(plugin);
  native = await freshPushNative();
  native.wireNativeForeground(() => {});
  native.wireNativeForeground(() => {});
  assert(plugin.calls.filter(c => c[0] === 'addListener' && c[1] === 'notificationForegroundWillDisplay').length === 1,
    '[10e] wireNativeForeground() is idempotent — addListener attached exactly once');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] Click routing — security condition C2, the six-tab allow-list…');
{
  function clickPayload(additionalData) { return { notification: { additionalData } }; }

  // (a) a valid, real tab navigates.
  let plugin = fakePlugin();
  installPlugin(plugin);
  withFetchOk();
  let native = await freshPushNative();
  let navigatedTo = null;
  native.wireNativeNotificationClicks((dest) => { navigatedTo = dest; });
  native.markNativeBootReady();
  plugin.listeners.notificationClick(clickPayload({ event: 'CHAT_MESSAGE_CREATED', route: 'chat', params: { messageId: 'm1' } }));
  assert(navigatedTo && navigatedTo.tab === 'chat' && navigatedTo.params.messageId === 'm1',
    `[11a] a real route (chat) with params navigates there (got ${JSON.stringify(navigatedTo)})`);

  // (b) an unrecognized route is IGNORED — no navigation at all.
  plugin = fakePlugin(); installPlugin(plugin);
  native = await freshPushNative();
  navigatedTo = 'UNSET';
  native.wireNativeNotificationClicks((dest) => { navigatedTo = dest; });
  native.markNativeBootReady();
  plugin.listeners.notificationClick(clickPayload({ event: 'CHAT_MESSAGE_CREATED', route: 'settings' }));
  assert(navigatedTo === 'UNSET', `[11b] an unrecognized tab id ("settings") ⇒ NO navigation at all (got ${JSON.stringify(navigatedTo)})`);

  // (c) a route containing markup/URL is IGNORED — allow-list rejects it outright.
  plugin = fakePlugin(); installPlugin(plugin);
  native = await freshPushNative();
  navigatedTo = 'UNSET';
  native.wireNativeNotificationClicks((dest) => { navigatedTo = dest; });
  native.markNativeBootReady();
  plugin.listeners.notificationClick(clickPayload({ route: '<img src=x onerror=alert(1)>' }));
  assert(navigatedTo === 'UNSET', '[11c] a markup-shaped route is ignored — no navigation');
  navigatedTo = 'UNSET';
  plugin.listeners.notificationClick(clickPayload({ route: 'https://evil.example.com' }));
  assert(navigatedTo === 'UNSET', '[11d] a URL-shaped route is ignored — no navigation');

  // (d) `url`/`launchURL` are NEVER read for navigation, even if present.
  navigatedTo = 'UNSET';
  plugin.listeners.notificationClick(clickPayload({ url: 'https://evil.example.com', launchURL: 'https://evil.example.com', event: null }));
  assert(navigatedTo && navigatedTo.tab === 'dashboard', `[11e] url/launchURL are ignored; with no route/event this falls back to destinationFor(null,...) → the safe dashboard default (got ${JSON.stringify(navigatedTo)})`);

  // (e) no route at all — falls back to destinationFor(event, ctx), the app's
  //     ONE trusted resolver (already proven safe by notifytest.mjs [5]).
  plugin = fakePlugin(); installPlugin(plugin);
  native = await freshPushNative();
  navigatedTo = null;
  native.wireNativeNotificationClicks((dest) => { navigatedTo = dest; });
  native.markNativeBootReady();
  plugin.listeners.notificationClick(clickPayload({ event: 'RESULTS_FINALIZED' }));
  assert(navigatedTo && navigatedTo.tab === 'dashboard', `[11f] missing route ⇒ falls back to destinationFor(event) (got ${JSON.stringify(navigatedTo)})`);

  // (f) params is never anything but a safe plain object — an array or a
  //     string is coerced to {}, never passed through.
  plugin = fakePlugin(); installPlugin(plugin);
  native = await freshPushNative();
  navigatedTo = null;
  native.wireNativeNotificationClicks((dest) => { navigatedTo = dest; });
  native.markNativeBootReady();
  plugin.listeners.notificationClick(clickPayload({ route: 'picks', params: ['<script>', 'x'] }));
  assert(navigatedTo && navigatedTo.tab === 'picks' && JSON.stringify(navigatedTo.params) === '{}',
    `[11g] a non-object (array) params value is discarded, never passed through as data (got ${JSON.stringify(navigatedTo)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] Cold-start ready-gate — a click before markNativeBootReady() is queued and replayed…');
{
  const plugin = fakePlugin();
  installPlugin(plugin);
  withFetchOk();
  const native = await freshPushNative();
  let navigatedTo = null;
  native.wireNativeNotificationClicks((dest) => { navigatedTo = dest; });
  // Fire the click BEFORE the app has marked itself ready.
  plugin.listeners.notificationClick({ notification: { additionalData: { route: 'picks' } } });
  assert(navigatedTo === null, '[12a] a click before markNativeBootReady() does NOT navigate immediately');
  native.markNativeBootReady();
  assert(navigatedTo && navigatedTo.tab === 'picks', `[12b] …and IS replayed once boot marks itself ready (got ${JSON.stringify(navigatedTo)})`);

  // A SECOND click, arriving after boot is already marked ready, runs immediately.
  navigatedTo = null;
  plugin.listeners.notificationClick({ notification: { additionalData: { route: 'chat' } } });
  assert(navigatedTo && navigatedTo.tab === 'chat', '[12c] a click after boot-ready runs immediately, no queueing');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] Structural — app.js\'s two dynamic-import call sites are correctly gated…');
{
  const appSrc = await readFile(path.join(__dirname, 'js', 'app.js'), 'utf8');

  // Every `import('./push-native.js')` call site in app.js must appear
  // textually inside an `if (isNativeShell())` or `if (isNativeOrigin())`
  // block — never a bare/unconditional dynamic import. A RED-proof (below)
  // confirms this regex actually discriminates rather than being vacuous.
  const GATED_IMPORT_RE = /if\s*\(\s*isNative(?:Shell|Origin)\s*\(\s*\)\s*\)\s*\{[^}]*import\(['"]\.\/push-native\.js['"]\)/gs;
  const importSites = [...appSrc.matchAll(/import\(['"]\.\/push-native\.js['"]\)/g)];
  // Five call sites, all real code: boot-tail adapter registration +
  // foreground/click wiring, the session-chokepoint identity call, the
  // priming-card button's click handler, refreshNotifSettingsBody()'s status
  // read, and — added by the native push-active flag fix (2026-09-24; RG number assigned at the ledger) — refreshPushActiveFlag()'s own.
  // That fifth one is the fix: the push-ACTIVE flag used to resolve through
  // js/push-onesignal.js's subscriptionState(), which answers
  // 'native-unavailable' inside the shell, so a native handset with
  // notifications AUTHORIZED was permanently classified as "push is not
  // reaching this device" and kept showing the in-app chat preview alongside
  // every push. It now reads nativePushState() here, exactly as
  // refreshNotifSettingsBody() already did — the same fact, no longer read two
  // different ways. pushtest.mjs §[15] owns the behaviour; this count is the
  // structural half, and it stays EXACT so a sixth site has to be justified.
  assert(importSites.length === 5, `[13a] app.js dynamic-imports push-native.js at exactly the five expected call sites (got ${importSites.length})`);
  const gatedSites = [...appSrc.matchAll(GATED_IMPORT_RE)];
  assert(gatedSites.length === importSites.length,
    `[13b] EVERY import('./push-native.js') call site is textually inside an isNativeShell()/isNativeOrigin() guard (found ${gatedSites.length} of ${importSites.length})`);

  // RED-PROOF — the same regex must fail to match an UNGUARDED import, so a
  // future edit that drops the guard is actually caught by [13b], not
  // silently passed by a vacuous pattern.
  const unguarded = "function boot() {\n  import('./push-native.js').then(() => {});\n}";
  const redHits = [...unguarded.matchAll(GATED_IMPORT_RE)];
  assert(redHits.length === 0, '[13c] RED-proof: an UNGUARDED import(\'./push-native.js\') is NOT matched by the gated-import pattern (mutation-prove: "adapter registered on web" would be caught)');

  // Never a STATIC top-level import — this module must only ever be reached
  // by dynamic import, so web never evaluates it at all.
  assert(!/^\s*import[^(].*push-native\.js/m.test(appSrc), '[13d] no STATIC `import ... from \'./push-native.js\'` anywhere in app.js');

  // The identity call site (loginNativePush/logoutNativePush) must sit beside
  // the EXISTING loginOneSignal/logoutOneSignal chokepoint call, not a
  // second, independent location — same chokepoint, same discipline.
  const chokepointIdx = appSrc.indexOf('if (sess?.playerId) loginOneSignal(sess.playerId, getAccountUserId()); else logoutOneSignal();');
  const nativeIdentityIdx = appSrc.indexOf("native.loginNativePush(sess.playerId, getAccountUserId()); else native.logoutNativePush();");
  assert(chokepointIdx > -1 && nativeIdentityIdx > -1 && nativeIdentityIdx - chokepointIdx < 1200,
    `[13e] the native identity call sits immediately beside the existing OneSignal chokepoint call, not a separately-invented location (distance ${nativeIdentityIdx - chokepointIdx} chars)`);

  // ── [13f] RG-243 (2026-09-24) — THE SUBSCRIPTION REPAIR'S NATIVE INERTNESS.
  //
  // RG-243 added a fourth re-arm to this same session chokepoint:
  // `maybeAutoOptInPush()`, RG-192's prompt-free "permission granted, no
  // subscription" repair. It is the only one of the four that is NOT wrapped in
  // an isNativeShell()/isNativeOrigin() gate — deliberately, because it is
  // shared code whose inertness on native is TRANSITIVE: it reaches the web SDK
  // only through `ensureOneSignalInit()`, and js/push-onesignal.js returns
  // `{ok:false, reason:'unsupported-browser'}` from that function's first line
  // inside the shell (DI-210e).
  //
  // "Transitive" is exactly the kind of guarantee that quietly stops being true,
  // and the reviewer's note on f2c3297 was that `maybeAutoOptInPush` appeared
  // NOWHERE in this file. So it is pinned here on both halves, in the shape
  // The web-inertness pin established by the native push-active flag fix (2026-09-24; RG number assigned at the ledger): the structure that makes it true,
  // and the behaviour that proves the structure means what it says.
  const optInBody = (() => {
    const start = appSrc.indexOf('export async function maybeAutoOptInPush(');
    return start === -1 ? '' : appSrc.slice(start, appSrc.indexOf('\n}', start));
  })();
  assert(optInBody.length > 0, '[13f] fixture check — maybeAutoOptInPush() was located in app.js, so the clauses below are not scanning an empty string');

  const rearmIdx = appSrc.indexOf('Promise.resolve(maybeAutoOptInPush(sess.playerId))');
  assert(rearmIdx > -1 && rearmIdx > nativeIdentityIdx && rearmIdx - nativeIdentityIdx < 2500,
    `[13g] the subscription repair is re-armed at the SAME session chokepoint, textually BELOW the native identity call — never between the two identity calls, which [13e] pins adjacent (distance ${rearmIdx - nativeIdentityIdx} chars)`);

  // The SDK gate must come FIRST. Every call that could reach the OneSignal web
  // SDK — the device read, the subscribe, the identity bind — must sit after
  // the `ensureOneSignalInit()` whose answer is what makes native a no-op.
  const initIdx = optInBody.indexOf('await ensureOneSignalInit()');
  const sdkCalls = ['pushDeviceStatus(', 'ensurePushSubscription(', 'loginOneSignal(', 'refreshPushActiveFlag('];
  const early = sdkCalls.filter((c) => { const i = optInBody.indexOf(c); return i > -1 && i < initIdx; });
  assert(initIdx > -1 && early.length === 0,
    `[13h] inside maybeAutoOptInPush(), EVERY web-SDK call sits after \`await ensureOneSignalInit()\` — that one call is the whole of its native inertness, so nothing may reach the SDK ahead of it (early: ${JSON.stringify(early)})`);
  assert(!/import\(['"]\.\/push-native\.js['"]\)/.test(optInBody),
    '[13i] …and it imports push-native.js not at all: it is the WEB repair, and [13a]\'s exact five-site count is what would otherwise have to grow');
}
{
  // ── [13j] …AND THE TRANSITIVE GUARANTEE ITSELF, EXERCISED RATHER THAN READ.
  //    js/push-onesignal.js is imported fresh under a native `window.Capacitor`
  //    and asked the one question maybeAutoOptInPush() asks it.
  const savedCapacitor = window.Capacitor;
  const savedDocument = globalThis.document;
  const savedFetch = globalThis.fetch;
  const touched = [];
  try {
    window.Capacitor = { isNativePlatform: () => true };
    globalThis.document = {
      body: { appendChild: (n) => touched.push(['appendChild', n]) },
      head: { appendChild: (n) => touched.push(['appendChild', n]) },
      getElementById: () => null,
      createElement: (t) => { touched.push(['createElement', t]); return {}; },
    };
    globalThis.fetch = async (...a) => { touched.push(['fetch', String(a[0])]); throw new Error('network refused by the test'); };

    const os = await import(`./js/push-onesignal.js?native13j=${Date.now()}`);
    const nativeAnswer = await os.ensureOneSignalInit();
    assert(nativeAnswer && nativeAnswer.ok === false && nativeAnswer.reason === 'unsupported-browser',
      `[13j] inside the shell, ensureOneSignalInit() answers the inert shape — so the repair's \`if (!init.ok) return false\` fires and nothing below it ever runs (got ${JSON.stringify(nativeAnswer)})`);
    assert(touched.length === 0,
      `[13k] …having touched NOTHING on the way there: no script element created, no node appended, not one fetch. The web SDK is never loaded inside the shell, which is what makes an ungated shared call site safe (touched ${JSON.stringify(touched.map((t) => t[0]))})`);
    assert(typeof window.OneSignal === 'undefined',
      '[13l] …and no `window.OneSignal` global exists afterwards — DI-210e suppresses the SDK, it does not merely ignore its answer');

    // NON-VACUITY. Without the Capacitor bridge the SAME call must NOT answer
    // 'unsupported-browser', or [13j] would pass on a function that simply
    // always refuses and would prove nothing about the native branch.
    delete window.Capacitor;
    touched.length = 0;
    const web = await import(`./js/push-onesignal.js?web13m=${Date.now()}`);
    const webAnswer = await web.ensureOneSignalInit();
    assert(webAnswer && webAnswer.reason !== 'unsupported-browser',
      `[13m] NON-VACUITY: with no Capacitor bridge the same call takes a different path entirely — [13j] is reading the native branch, not a function that refuses everything (got ${JSON.stringify(webAnswer)})`);
  } finally {
    if (savedCapacitor === undefined) delete window.Capacitor; else window.Capacitor = savedCapacitor;
    globalThis.document = savedDocument;
    if (savedFetch === undefined) delete globalThis.fetch; else globalThis.fetch = savedFetch;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] MUTATION-PROVE — proceedWithWillDisplay omitted ⇒ RED (real scratch-copy mutation, restored byte-for-byte)…');
{
  const target = path.join(__dirname, 'js', 'push-native.js');
  const scratchDir = process.env.TMPDIR || '/tmp';
  const scratchCopy = `${scratchDir}/push-native.pre-mutation.${Date.now()}.js`;
  await copyFile(target, scratchCopy);
  const original = await readFile(target, 'utf8');

  const NEEDLE = 'await plugin.proceedWithWillDisplay({ notificationId });';
  assert(original.includes(NEEDLE), '[14 fixture] the exact proceedWithWillDisplay call site was located (a missing needle would make the mutation vacuous)');
  const mutated = original.replace(NEEDLE, '/* MUTATION: proceedWithWillDisplay call removed for pushnativetest.mjs [14] */ void 0;');
  assert(mutated !== original, '[14a] the mutation actually changed the source (non-vacuous)');
  await writeFile(target, mutated, 'utf8');

  let mutantCalledProceed = true;
  try {
    const mutantMod = await import(`./js/push-native.js?mutant=${Date.now()}`);
    const plugin = fakePlugin();
    installPlugin(plugin);
    withFetchOk();
    mutantMod.wireNativeForeground(() => {});
    await plugin.listeners.notificationForegroundWillDisplay({ notificationId: 'n_mut', additionalData: {} });
    mutantCalledProceed = plugin.calls.some(c => c[0] === 'proceedWithWillDisplay');
  } finally {
    // restore immediately, before any assertion, so a crash mid-check can
    // never leave the mutated file live in the working tree.
    await copyFile(scratchCopy, target);
    // authstoragenativetest.mjs's discipline, not notifytest.mjs's [9] (which
    // leaves its /tmp scratch copies behind) — a leaked scratch file per run
    // is exactly the kind of thing that could otherwise get accidentally
    // committed, and loadtest.mjs's [96b] hygiene check holds this to zero.
    await rm(scratchCopy, { force: true });
  }
  assert(mutantCalledProceed === false, '[14b] MUTATION CONFIRMED: with the call removed, proceedWithWillDisplay is never invoked — the banner would silently stop showing forever (Finding 4) — this suite would be RED on this specific assertion');

  const restored = await readFile(target, 'utf8');
  assert(restored === original, '[14c] source restored byte-for-byte from the scratch copy — never via git checkout/restore/stash');

  const freshMod = await import(`./js/push-native.js?restored=${Date.now()}`);
  const plugin2 = fakePlugin();
  installPlugin(plugin2);
  withFetchOk();
  freshMod.wireNativeForeground(() => {});
  await plugin2.listeners.notificationForegroundWillDisplay({ notificationId: 'n_ok', additionalData: {} });
  assert(plugin2.calls.some(c => c[0] === 'proceedWithWillDisplay'), '[14d] GREEN again after restore — the real (non-mutant) code calls proceedWithWillDisplay');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15] Boundary — zero @onesignal/@capacitor import specifiers under cfb-pickems/js/…');
{
  const jsDir = path.join(__dirname, 'js');
  const files = (await readdir(jsDir)).filter(f => f.endsWith('.js'));
  const DEP_RE = /(?:from\s*['"]@onesignal\/)|(?:require\(\s*['"]@onesignal\/)|(?:import\(\s*['"]@onesignal\/)|(?:from\s*['"]@capacitor\/)|(?:require\(\s*['"]@capacitor\/)|(?:import\(\s*['"]@capacitor\/)/;
  const hits = [];
  for (const f of files) {
    const src = await readFile(path.join(jsDir, f), 'utf8');
    if (DEP_RE.test(src)) hits.push(f);
  }
  assert(hits.length === 0, `[15a] zero cfb-pickems/js/*.js files import "@onesignal/" or "@capacitor/" (AD-65) (hits: ${hits.join(', ') || 'none'})`);
  assert(files.includes('push-native.js'), '[15 fixture] push-native.js was actually included in the scanned set (a missing file would make [15a] vacuous)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[16] N-4 — the persisted identity flag survives process death, both orders…');
{
  // ── ORDER A: login (session 1) -> "process restart" -> a SIGNED-OUT boot
  //    (session 2, no login this launch) must still detach the binding. ──
  {
    const sharedStore = new Map();
    const prefs1 = fakePreferences(sharedStore);
    const plugin1 = fakePlugin();
    installPluginWithPrefs(plugin1, prefs1);
    withFetchOk();
    const native1 = await freshPushNative();
    await native1.loginNativePush('memberA');
    // UN-315 / DI-436.1 — the flag is a MARKER now. The device is bound to the account's private alias and
    // the flag lives in the on-disk Preferences store, so it must identify nobody: neither the alias nor a
    // member id. (An older build's flag — a member id — still reads as "set"; see [16m].)
    assert(sharedStore.get('cfbp_native_push_identity') === '1',
      `[16a] a successful login() persists the identity flag as a MARKER, '1' (got ${JSON.stringify(sharedStore.get('cfbp_native_push_identity'))})`);
    assert(sharedStore.get('cfbp_native_push_identity') !== 'memberA',
      '[16a2] …and NOT the member id — nothing identifying is written to the on-disk store');

    // "Process restart" — a FRESH module instance (fresh in-memory state,
    // _initAttempted() reads false) and a FRESH OneSignal plugin (native's
    // own `initialized` is per-process too), but the SAME Preferences store
    // — exactly what actually persists across a real relaunch.
    const plugin2 = fakePlugin();
    const prefs2 = fakePreferences(sharedStore);
    installPluginWithPrefs(plugin2, prefs2);
    const native2 = await freshPushNative();
    await native2.logoutNativePush();   // the ONLY call this "session" makes — never logged in
    assert(plugin2.calls.some(c => c[0] === 'initialize'),
      '[16b] the reconcile brings the SDK up (initialize()) even though nothing logged in THIS launch');
    assert(plugin2.calls.some(c => c[0] === 'logout'),
      '[16c] …and actually calls logout() — the cross-launch binding is detached, not silently left standing');
    assert(!sharedStore.has('cfbp_native_push_identity'),
      '[16d] …and the persisted flag is cleared afterward');
  }

  // ── ORDER B (regression guard, DI-240): a device that NEVER attached an
  //    identity (fresh Preferences store) boots signed out — must NOT
  //    initialize() at all, or every anonymous cold boot would re-earn the
  //    OS auto-prompt risk this whole module exists to avoid. ──
  {
    const freshStore = new Map();
    const plugin = fakePlugin();
    installPluginWithPrefs(plugin, fakePreferences(freshStore));
    withFetchOk();
    const native = await freshPushNative();
    await native.logoutNativePush();
    assert(!plugin.calls.some(c => c[0] === 'initialize'),
      '[16e] a never-attached device\'s signed-out boot does NOT call initialize() — DI-240 untouched');
    assert(!plugin.calls.some(c => c[0] === 'logout'),
      '[16f] …and does not call logout() either — nothing to undo');
  }

  // ── ORDER C: login THEN logout in the SAME launch still clears the flag
  //    (the ordinary, non-crash path must not regress). ──
  {
    const store = new Map();
    const plugin = fakePlugin();
    installPluginWithPrefs(plugin, fakePreferences(store));
    withFetchOk();
    const native = await freshPushNative();
    await native.loginNativePush('memberB');
    assert(store.get('cfbp_native_push_identity') === '1', '[16g] fixture: login persisted the flag (the marker)');
    await native.logoutNativePush();
    assert(!store.has('cfbp_native_push_identity'), '[16h] an ordinary same-launch logout still clears the flag');
  }

  // ── MUTATION-PROVE — drop the persisted-flag check from the logout branch
  //    (revert to `if (!_initAttempted()) return;` alone) ⇒ RED. ──
  {
    const target = path.join(__dirname, 'js', 'push-native.js');
    const scratchDir = process.env.TMPDIR || '/tmp';
    const scratchCopy = `${scratchDir}/push-native.pre-mutation.${Date.now()}.js`;
    await copyFile(target, scratchCopy);
    const original = await readFile(target, 'utf8');

    const NEEDLE = 'if (!_initAttempted() && !attachedBefore) return;   // nothing was ever attached; DI-240 untouched';
    assert(original.includes(NEEDLE), '[16 fixture] the exact N-4 reconcile-guard line was located (a missing needle would make the mutation vacuous)');
    const mutated = original.replace(NEEDLE, 'if (!_initAttempted()) return;   // MUTATION: N-4 persisted-flag check dropped for pushnativetest.mjs [16]');
    assert(mutated !== original, '[16i] the mutation actually changed the source (non-vacuous)');
    await writeFile(target, mutated, 'utf8');

    let mutantReconciled = true;
    try {
      // TWO separate dynamic-import instances (cache-busted query strings),
      // exactly like [16]'s own native1/native2 — a SINGLE module instance
      // would keep `_initAttempted()` true across both calls (no real
      // process restart), which would make this proof pass for the WRONG
      // reason regardless of the mutation.
      const mutantSession1 = await import(`./js/push-native.js?mutant1=${Date.now()}`);
      const sharedStore = new Map();
      installPluginWithPrefs(fakePlugin(), fakePreferences(sharedStore));
      await mutantSession1.loginNativePush('memberA');   // session 1: attach + persist
      const mutantSession2 = await import(`./js/push-native.js?mutant2=${Date.now()}`);
      const plugin2 = fakePlugin();
      installPluginWithPrefs(plugin2, fakePreferences(sharedStore));   // "restart", same store
      await mutantSession2.logoutNativePush();            // session 2: signed-out boot
      mutantReconciled = plugin2.calls.some(c => c[0] === 'logout');
    } finally {
      await copyFile(scratchCopy, target);
      await rm(scratchCopy, { force: true });
    }
    assert(mutantReconciled === false, '[16j] MUTATION CONFIRMED: with the persisted-flag check dropped, a cross-launch signed-out boot never calls logout() — the previous member keeps receiving push on a handed-off phone — this suite would be RED on this specific assertion');

    const restored = await readFile(target, 'utf8');
    assert(restored === original, '[16k] source restored byte-for-byte from the scratch copy — never via git checkout/restore/stash');

    const restoredSession1 = await import(`./js/push-native.js?restored2a=${Date.now()}`);
    const store2 = new Map();
    installPluginWithPrefs(fakePlugin(), fakePreferences(store2));
    await restoredSession1.loginNativePush('memberC');
    const restoredSession2 = await import(`./js/push-native.js?restored2b=${Date.now()}`);
    const pluginRestored = fakePlugin();
    installPluginWithPrefs(pluginRestored, fakePreferences(store2));
    await restoredSession2.logoutNativePush();
    assert(pluginRestored.calls.some(c => c[0] === 'logout'), '[16l] GREEN again after restore — the real (non-mutant) code reconciles across the simulated restart (two separate module instances, a genuine restart simulation)');
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════
// [17] UN-315 / DI-436 (2026-09-29) — THE NATIVE DEVICE FOLLOWS THE ACCOUNT, NOT THE LEAGUE
//
// Same contract as pushtest.mjs [17] for the web, on the plugin's flat calls: the identity bound is the
// ACCOUNT's private alias (from `push-identity-token` {scope:'user'}); a LEAGUE SWITCH makes ZERO plugin calls;
// the persisted flag is a MARKER; `dual` falls back to the member id when the mint fails and retries (bounded);
// `alias` mode has no fallback; `legacy` binds the member id; a tap names its league (validated) and a push
// from another league never wakes this league's chat — while its banner ALWAYS shows on native (DI-241).
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[17] UN-315 — the native device follows the ACCOUNT: alias identity, a league switch is a no-op, a marker flag, league-aware taps…');
{
  const ALIAS_A = 'a1a1a1a1-1111-4111-8111-111111111111';
  const ALIAS_B = 'b2b2b2b2-2222-4222-8222-222222222222';
  const LEAGUE_A = 'c3c3c3c3-3333-4333-8333-333333333333';
  const keep = async (p) => { const ka = setInterval(() => {}, 5); try { return await p; } finally { clearInterval(ka); } };
  const wait = (ms = 60) => keep(new Promise((r) => setTimeout(r, ms)));
  const MINE = new Set(['u17x', 'u17y', 'u17z', 'u17q', ALIAS_A, ALIAS_B]);
  // Only logins for THIS section's ids: modules created by earlier sections may still have a retry timer armed,
  // and it reaches whichever plugin is installed NOW (they read `window.Capacitor` at fire time).
  const loginsOf = (plugin) => plugin.calls.filter((c) => c[0] === 'login' && MINE.has(c[1].externalId)).map((c) => c[1].externalId);
  const created = [];
  /** Retire every module a previous scenario created: `_resetForTest()` zeroes its generation, so any retry
   *  timer it still has armed sees a stale generation and does nothing. */
  const retireAll = () => { for (const n of created.splice(0)) { try { n._resetForTest(); } catch { /* ignore */ } } };

  /** A fresh native module + plugin + prefs, with `minter(scope)` answering the mint. */
  async function world({ minter, store = new Map() } = {}) {
    retireAll();
    const plugin = fakePlugin();
    installPluginWithPrefs(plugin, fakePreferences(store));
    withFetchOk();
    const native = await freshPushNative();
    created.push(native);
    const mints = [];
    native._setIdentityMinterForTest(async (req) => { mints.push(req && req.scope); return minter(); });
    return { plugin, native, mints, store };
  }
  const aliasAnswer = (alias = ALIAS_A, mode = 'dual') => async () => ({ ok: true, externalId: alias, mode });

  // ── (a) THE TARGET IS THE ALIAS.
  {
    const { plugin, native, mints, store } = await world({ minter: aliasAnswer() });
    await keep(native.loginNativePush('u17x', 'acctA'));
    assert(JSON.stringify(loginsOf(plugin)) === JSON.stringify([ALIAS_A]),
      `[17a] the native login binds the ACCOUNT'S ALIAS, never the member id (got ${JSON.stringify(loginsOf(plugin))})`);
    assert(JSON.stringify(mints) === JSON.stringify(['user']), `[17b] …after exactly ONE user-scoped mint (got ${JSON.stringify(mints)})`);
    assert(store.get('cfbp_native_push_identity') === '1' && !JSON.stringify([...store]).includes(ALIAS_A) && !JSON.stringify([...store]).includes('u17x'),
      `[17c] the persisted flag is a MARKER ('1') — neither the alias nor the member id ever reaches the on-disk Preferences store (got ${JSON.stringify([...store])})`);

    // ── (b) A LEAGUE SWITCH IS A NO-OP — zero plugin calls, zero mints.
    const callsBefore = plugin.calls.length, mintsBefore = mints.length;
    await keep(native.loginNativePush('u17y', 'acctA'));
    await wait();
    assert(plugin.calls.length === callsBefore && mints.length === mintsBefore,
      `[17d] a league switch (a different member id, the SAME account) makes ZERO plugin calls and ZERO mints (extra calls ${JSON.stringify(plugin.calls.slice(callsBefore))})`);
    assert(!plugin.calls.some((c) => c[0] === 'logout'), '[17e] …and no logout — that is for sign-out and account changes only');

    // ── (c) A DIFFERENT ACCOUNT re-asserts.
    await keep(native.loginNativePush('u17z', 'acctB'));
    assert(loginsOf(plugin).length === 2 && mints.length === 2,
      `[17f] a DIFFERENT account is not an early return — it re-binds with a fresh mint (logins ${JSON.stringify(loginsOf(plugin))}, mints ${mints.length})`);

    // ── (d) sign-out then sign-in: logout lifts the no-op.
    await keep(native.logoutNativePush());
    assert(plugin.calls.filter((c) => c[0] === 'logout').length === 1 && !store.has('cfbp_native_push_identity'),
      '[17g] sign-out: one logout, and the marker flag is cleared');
    await keep(native.loginNativePush('u17x', 'acctB'));
    assert(loginsOf(plugin).length === 3, '[17h] …and the next sign-in of the same account is a real login again');

    // ── (e) force — the Turn On repair.
    await keep(native.loginNativePush('u17x', 'acctB', { force: true }));
    assert(loginsOf(plugin).length === 4, '[17i] { force:true } re-asserts even though a binding is recorded (the explicit Turn On / Reconnect repair)');
  }

  // ── (f) dual + a failed mint: the member id, then a bounded retry of the alias.
  {
    let ok = false;
    const { plugin, native, mints } = await world({ minter: async () => (ok ? { ok: true, externalId: ALIAS_A, mode: 'dual' } : { ok: false, reason: 'unreachable' }) });
    await keep(native.loginNativePush('u17x', 'acctA'));
    assert(JSON.stringify(loginsOf(plugin)) === JSON.stringify(['u17x']),
      `[17j] dual + a FAILED alias mint falls back to the MEMBER id (lossless: the server addresses both in dual) — a failed mint never blocks the login (got ${JSON.stringify(loginsOf(plugin))})`);
    ok = true;
    await wait(700);
    assert(JSON.stringify(loginsOf(plugin)) === JSON.stringify(['u17x', ALIAS_A]),
      `[17k] …and the alias is retried on the SAME bounded ladder and the device UPGRADES to it (got ${JSON.stringify(loginsOf(plugin))})`);
    const callsBefore = plugin.calls.length;
    await keep(native.loginNativePush('u17q', 'acctA'));
    assert(plugin.calls.length === callsBefore, '[17l] …and once on the alias, a league switch is a no-op again');
  }
  {
    const { plugin, native, mints } = await world({ minter: async () => ({ ok: false, reason: 'unreachable' }) });
    await keep(native.loginNativePush('u17x', 'acctA'));
    await wait(4800);
    assert(mints.length <= 3, `[17m] the alias retry is BOUNDED — at most three attempts, never a timer on every phone forever (mints ${mints.length})`);
    assert(loginsOf(plugin).every((id) => id === 'u17x'), `[17n] …and the device stays on its member id throughout (got ${JSON.stringify(loginsOf(plugin))})`);
  }

  // ── (g) alias mode: NO fallback.
  {
    let userOk = true;
    const { plugin, native } = await world({ minter: async () => (userOk ? { ok: true, externalId: ALIAS_A, mode: 'alias' } : { ok: false, reason: 'unreachable' }) });
    await keep(native.loginNativePush('u17x', 'acctA'));
    await keep(native.logoutNativePush());
    userOk = false;
    await keep(native.loginNativePush('u17x', 'acctA'));
    await wait(800);
    assert(JSON.stringify(loginsOf(plugin)) === JSON.stringify([ALIAS_A]),
      `[17o] in ALIAS mode a failed mint asserts NOTHING — no member-id fallback; the member id is no longer addressed (got ${JSON.stringify(loginsOf(plugin))})`);
  }

  // ── (g2) THE LADDER IS SPENT → THE "IN FLIGHT" CLAIM ENDS (security finding 2, 2026-09-30). Same defect and same
  //    failing sequence as pushtest 17-16a..c on the plugin's flat calls: alias mode (no fallback) cannot mint three
  //    times running, then the network returns and the app asks again — which used to return early forever.
  {
    let userOk = true;
    const { plugin, native, mints } = await world({ minter: async () => (userOk ? { ok: true, externalId: ALIAS_A, mode: 'alias' } : { ok: false, reason: 'unreachable' }) });
    await keep(native.loginNativePush('u17x', 'acctA'));               // learns that the server is in alias mode
    await keep(native.logoutNativePush());
    userOk = false;
    await keep(native.loginNativePush('u17x', 'acctA'));               // attempt 1 of 3 fails; the ladder is armed
    const mintsMid = mints.length;
    await keep(native.loginNativePush('u17y', 'acctA'));               // a league switch while the ladder is running
    await wait(50);
    assert(mints.length === mintsMid, `[17o2] WHILE the ladder is still running the claim holds — a league switch does not mint again (mints ${mintsMid} -> ${mints.length})`);
    await wait(4900);
    const loginsBefore = loginsOf(plugin).length;
    userOk = true;
    await keep(native.loginNativePush('u17x', 'acctA'));
    await wait(100);
    assert(loginsOf(plugin).length === loginsBefore + 1 && loginsOf(plugin).at(-1) === ALIAS_A,
      `[17o3] AFTER the ladder is spent the SAME call is honoured again — it mints and binds the alias (logins ${loginsBefore} -> ${loginsOf(plugin).length}); before the fix it returned early forever`);
  }

  // ── (h) legacy (the operator's rollback) and a pre-DI-434 answer both bind the member id.
  {
    const { plugin, native } = await world({ minter: async () => ({ ok: true, mode: 'legacy' }) });
    await keep(native.loginNativePush('u17x', 'acctA'));
    await keep(native.loginNativePush('u17y', 'acctA'));
    assert(JSON.stringify(loginsOf(plugin)) === JSON.stringify(['u17x', 'u17y']),
      `[17p] mode:'legacy' binds the MEMBER id, and there a league switch re-binds (the device follows the league again — the no-op belongs to the alias) (got ${JSON.stringify(loginsOf(plugin))})`);
  }
  {
    const { plugin, native, mints } = await world({ minter: async () => ({ ok: true }) });
    await keep(native.loginNativePush('u17x', 'acctA'));
    assert(JSON.stringify(loginsOf(plugin)) === JSON.stringify(['u17x']) && mints.length === 1,
      `[17q] a server that predates DI-434 (ok, no alias, no mode) binds the member id from that ONE answer (got ${JSON.stringify(loginsOf(plugin))}, mints ${mints.length})`);
  }

  // ── (i) the Turn On grant path re-attaches the identity (force).
  {
    const { plugin, native } = await world({ minter: aliasAnswer() });
    await keep(native.loginNativePush('u17x', 'acctA'));
    const before = loginsOf(plugin).length;
    const res = await keep(native.requestNativePushPermission('u17x'));
    assert(res.ok === true && loginsOf(plugin).length === before + 1,
      `[17r] a grant via the Turn On button re-asserts the identity (force) even though the device is bound (logins ${before} → ${loginsOf(plugin).length})`);
  }

  // ── (j) THE LEGACY FLAG (an older build stored the member id) still reads as "an identity was attached".
  {
    const store = new Map([['cfbp_native_push_identity', 'memberA']]);
    const { plugin, native } = await world({ minter: aliasAnswer(), store });
    await keep(native.logoutNativePush());
    assert(plugin.calls.some((c) => c[0] === 'logout') && !store.has('cfbp_native_push_identity'),
      '[17s] an OLDER build\'s flag (a member id) still triggers the signed-out reconcile — the marker change did not orphan a device that was bound before the update');
  }

  // ── (k) THE CLICK RESOLVER — a league id is a uuid, or the tap is declined.
  {
    const native = await freshPushNative();
    const r = (extra) => native._resolveClickDestinationForTest({ event: 'CHAT_MESSAGE_CREATED', route: 'chat', params: { messageId: 'm1' }, ...extra });
    const withLeague = r({ league_id: LEAGUE_A });
    assert(withLeague && withLeague.tab === 'chat' && withLeague.params.messageId === 'm1' && withLeague.leagueId === LEAGUE_A,
      `[17t] a tap carrying a well-formed league_id resolves {tab, params, leagueId} (got ${JSON.stringify(withLeague)})`);
    assert(r({ league_id: LEAGUE_A.toUpperCase() }).leagueId === LEAGUE_A, '[17u] …normalised to lower case');
    const none = r({});
    assert(none && !('leagueId' in none) && none.tab === 'chat', `[17v] a tap with NO league_id is exactly what it always was — no leagueId key at all (got ${JSON.stringify(none)})`);
    for (const bad of ['not-a-uuid', `${LEAGUE_A}x`, ` ${LEAGUE_A}`, '', 42, true, {}, [], '<img src=x>', 'https://evil.example/', "1' or '1'='1"]) {
      assert(r({ league_id: bad }) === null,
        `[17w] a league_id that is PRESENT but not a uuid (${JSON.stringify(bad)}) declines the tap — malformed is not "missing", and guessing a destination is not safer than declining`);
    }
    assert(native._resolveClickDestinationForTest({ event: 'CHAT_MESSAGE_CREATED', route: 'settings', league_id: LEAGUE_A }) === null,
      '[17x] …and a bad ROUTE still declines regardless of a good league id — the league id never launders a route');
  }

  // ── (l) FOREGROUND: native NEVER suppresses (DI-241), but another league's push does not wake THIS league's chat.
  {
    const plugin = fakePlugin();
    installPlugin(plugin);
    withFetchOk();
    const native = await freshPushNative();
    const woke = [];
    native.wireNativeForeground((event) => woke.push(event), () => 'league-ACTIVE');
    const fire = async (leagueId, id) => {
      const before = woke.length;
      await plugin.listeners.notificationForegroundWillDisplay({
        notificationId: id, additionalData: { event: 'CHAT_MESSAGE_CREATED', ...(leagueId === undefined ? {} : { league_id: leagueId }) },
      });
      return { woke: woke.length - before, banner: plugin.calls.filter((c) => c[0] === 'proceedWithWillDisplay' && c[1].notificationId === id).length };
    };
    const same = await fire('league-ACTIVE', 'n-same');
    const other = await fire('league-OTHER', 'n-other');
    const none = await fire(undefined, 'n-none');
    assert(same.woke === 1 && same.banner === 1, `[17y] a push from the ACTIVE league wakes its chat and shows its banner (got ${JSON.stringify(same)})`);
    assert(other.woke === 0 && other.banner === 1,
      `[17z] a push from ANOTHER league shows its banner (native never suppresses — proceedWithWillDisplay ran) but does NOT wake this league's chat (got ${JSON.stringify(other)})`);
    assert(none.woke === 1 && none.banner === 1, `[17aa] a push with no league_id behaves as before (got ${JSON.stringify(none)})`);
  }

  // ── (m) STRUCTURAL: nothing identifying reaches the on-disk store, and the mint never surfaces a reason.
  {
    const src = await readFile(new URL('./js/push-native.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    assert(/async function _writePersistedIdentityFlag\(\)/.test(code) && !/_writePersistedIdentityFlag\([^)]/.test(code),
      '[17ab] the flag writer takes NO argument — there is no way for a later edit to hand it an id [structural]');
    assert(/NATIVE_PUSH_IDENTITY_MARKER = '1'/.test(code) && /value: NATIVE_PUSH_IDENTITY_MARKER/.test(code),
      '[17ac] …and what it writes is the constant marker [structural]');
    // String LITERALS are blanked first: a log MESSAGE may say the word "alias"; what must never happen is an
    // argument EXPRESSION that reads an id (`identity.externalId`, `minted.externalId`, a bare `alias`).
    const noLiterals = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    retireAll();
    assert(!/console\.(log|info|warn|error)\([^)]*\b(externalId|alias)\b/i.test(noLiterals),
      '[17ad] …and no console call passes the alias or the external id as an ARGUMENT [structural]');
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
