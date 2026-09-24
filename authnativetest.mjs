/**
 * CFB Pickems — authnativetest.mjs (DI-208e, iOS Munera native sign-in, 2026-09-21)
 * =====================================================================================
 * Unit + behavioral tests for `js/platform.js`'s `getAuthPath()` and the NEW,
 * EXCLUSIVE `js/auth-native.js` (native Google sign-in, PATH A). Precedent
 * for a focused standalone suite spawned from `loadtest.mjs` the house way:
 * `grouptest.mjs`/`platformtest.mjs`/`nativeguardtest.mjs`. This file is
 * deliberately SEPARATE from `authtest.mjs` (exclusive to the Supabase
 * thread right now) and never touches it or `js/auth.js`.
 *
 * Run:  node authnativetest.mjs
 *
 * Covers:
 *   [1] getAuthPath() truth table, incl. the spoof-on-https case (security
 *       condition 8) — 'web-pkce' unless isNativeOrigin() truly holds.
 *   [2] _matchesNativeCallback() — exact scheme+host+path match only;
 *       look-alikes rejected (mutation target (a)).
 *   [3] signInWithGoogleNative() success path — Browser.open called with the
 *       right URL, exchangeCodeForSession called with the right code.
 *   [4] exchange called EXACTLY ONCE even if the deep link fires twice
 *       (mutation target (c)).
 *   [5] a deep link with no in-flight flow is DROPPED — no exchange call,
 *       no throw, no surfaced error.
 *   [6] cancel path (browserFinished) restores idle, rejects with a
 *       cancel-shaped message matching app.js's EXISTING
 *       /cancel|closed|popup/i classification.
 *   [7] timeout path — same cancel-shaped rejection, on an injectable clock.
 *   [8] every failure surfaces a message classifiable by app.js's existing
 *       regex (cancel-shaped vs. generic-error-shaped), for every failure
 *       mode named in the design input.
 *   [9] source-level — no `@capacitor` import anywhere in
 *       js/auth-native.js; it imports ONLY getSupabaseClient from
 *       js/auth.js (never a second export beyond what the coordinator
 *       named); zero top-level side effects on import.
 *   [10] js/app.js's showGoogleSignInGate() click handler — via a
 *       loader-instrumented child process running the REAL extracted
 *       handler body: on WEB (getAuthPath()==='web-pkce') the dynamic
 *       import of ./auth-native.js is NEVER evaluated and signInWithGoogle()
 *       IS called (mutation target (b), paired with [1]); on NATIVE it IS
 *       evaluated and signInWithGoogleNative() IS called.
 *   [11] service-worker.js's STATIC_ASSETS never lists auth-native.js.
 *   [12] grep-proof: zero "@capacitor" hits anywhere under cfb-pickems/, and
 *       zero "munera-ios" hits anywhere under cfb-pickems/.
 */

import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const root = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// [1] getAuthPath() truth table
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] getAuthPath() — origin-positive, every case (security condition 8)…');
{
  const savedWindow = 'window' in globalThis ? globalThis.window : undefined;
  const hadWindow = 'window' in globalThis;
  const savedLocation = 'location' in globalThis ? globalThis.location : undefined;
  const hadLocation = 'location' in globalThis;

  const { getAuthPath } = await import('./js/platform.js');

  delete globalThis.window;
  globalThis.location = { protocol: 'https:' };
  assert(getAuthPath() === 'web-pkce', '[1a] plain web (no Capacitor) on https: → "web-pkce"');

  globalThis.location = { protocol: 'http:' };
  assert(getAuthPath() === 'web-pkce', '[1b] plain web on http: (dev) → "web-pkce"');

  // THE SPOOF security condition 8 exists to stop: a native-shaped
  // window.Capacitor sitting on a real https: origin.
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  globalThis.location = { protocol: 'https:' };
  assert(getAuthPath() === 'web-pkce',
    '[1c] SPOOFED window.Capacitor.isNativePlatform()===true on https: → still "web-pkce" — the whole point of origin-positive');

  // The ONLY 'native' case.
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  globalThis.location = { protocol: 'capacitor:' };
  assert(getAuthPath() === 'native', '[1d] window.Capacitor native + location.protocol==="capacitor:" → "native", the only case');

  // capacitor: scheme alone, no real Capacitor bridge, is not enough.
  delete globalThis.window;
  globalThis.location = { protocol: 'capacitor:' };
  assert(getAuthPath() === 'web-pkce', '[1e] capacitor: origin with no window.Capacitor at all → "web-pkce" (both halves load-bearing)');

  if (hadWindow) globalThis.window = savedWindow; else delete globalThis.window;
  if (hadLocation) globalThis.location = savedLocation; else delete globalThis.location;
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] _matchesNativeCallback() — exact match only
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] _matchesNativeCallback() — exact scheme+host+path, look-alikes rejected…');
{
  const { _matchesNativeCallback, NATIVE_CALLBACK_URL } = await import('./js/auth-native.js');
  assert(NATIVE_CALLBACK_URL === 'munera://auth/callback', `[2-pre] the literal callback URL is exactly "munera://auth/callback" (got ${NATIVE_CALLBACK_URL})`);
  assert(_matchesNativeCallback('munera://auth/callback') === true, '[2a] the exact URL matches');
  assert(_matchesNativeCallback('munera://auth/callback?code=abc') === true, '[2b] the exact URL with a query string still matches (path/host/scheme are what matter)');
  assert(_matchesNativeCallback('munera://auth/callback.evil') === false, '[2c] a path suffix look-alike is rejected');
  assert(_matchesNativeCallback('munera://evil/auth/callback') === false, '[2d] a wrong host (evil) is rejected even though "auth/callback" appears later in the string');
  assert(_matchesNativeCallback('https://auth/callback') === false, '[2e] a wrong scheme (https) is rejected');
  assert(_matchesNativeCallback('munera://auth/callback/extra') === false, '[2f] an extra path segment is rejected');
  assert(_matchesNativeCallback('') === false, '[2h] empty string is rejected, not a throw');
  assert(_matchesNativeCallback(null) === false, '[2i] null is rejected, not a throw');
  assert(_matchesNativeCallback('not a url at all') === false, '[2j] unparseable garbage is rejected, not a throw');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture — a fake Capacitor bridge (Browser/App) + a fake Supabase
// client, same shape/spirit as authtest.mjs's makeFakeClient() but
// standalone in THIS file (authtest.mjs is never imported or edited).
// ─────────────────────────────────────────────────────────────────────────────
function makeFakeBridge() {
  const appListeners = {};
  const browserOpenCalls = [];
  let browserCloseCalls = 0;
  return {
    browserOpenCalls,
    get browserCloseCalls() { return browserCloseCalls; },
    fireAppUrlOpen(url) { (appListeners.appUrlOpen || []).forEach(fn => fn({ url })); },
    fireBrowserFinished() { (appListeners.browserFinished || []).forEach(fn => fn({})); },
    listenerCount(type) { return (appListeners[type] || []).length; },
    install() {
      globalThis.window = globalThis.window || {};
      globalThis.window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          Browser: {
            async open(opts) { browserOpenCalls.push(opts); },
            async close() { browserCloseCalls++; },
          },
          App: {
            addListener(type, fn) { (appListeners[type] = appListeners[type] || []).push(fn); },
          },
        },
      };
    },
  };
}

function makeFakeClient({ signInWithOAuth, exchangeCodeForSession } = {}) {
  const exchangeCalls = [];
  return {
    exchangeCalls,
    client: {
      auth: {
        // auth.js's own ensureClient() wires this unconditionally on client
        // creation (real SDK behavior) — a no-op here just keeps that wiring
        // from logging a console.warn in every scenario below; it is not
        // itself under test in this file (authtest.mjs already covers it).
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOAuth: signInWithOAuth || (async () => ({ data: { url: 'https://accounts.google.com/fake' }, error: null })),
        exchangeCodeForSession: exchangeCodeForSession || (async (code) => { exchangeCalls.push(code); return { data: {}, error: null }; }),
      },
    },
  };
}

async function withFakeAuthModule(client, fn) {
  // js/auth-native.js imports getSupabaseClient from js/auth.js STATICALLY,
  // so to control what it returns without editing/mocking js/auth.js's
  // internals, we point js/auth.js at a fake window.supabase.createClient()
  // the same way authtest.mjs's own installFakeSupabase() does, then use
  // auth.js's OWN real configureAuth()/ensureClient() path — this exercises
  // the REAL getSupabaseClient(), not a stand-in for it.
  const auth = await import('./js/auth.js');
  const store = new Map();
  globalThis.localStorage = globalThis.localStorage || {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
  globalThis.window = globalThis.window || {};
  globalThis.window.supabase = { createClient: () => client };
  auth._resetAuthForTest();
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  try {
    return await fn();
  } finally {
    auth._resetAuthForTest();
    globalThis.window.supabase = undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] signInWithGoogleNative() — success path
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] signInWithGoogleNative() — success path: Browser.open + exchangeCodeForSession…');
{
  const authNative = await import('./js/auth-native.js');
  authNative._resetNativeAuthForTest();
  const bridge = makeFakeBridge();
  bridge.install();
  const { client, exchangeCalls } = makeFakeClient();

  await withFakeAuthModule(client, async () => {
    const flow = authNative.signInWithGoogleNative();
    // Let the microtask queue drain up to the Browser.open() await.
    await new Promise(r => setTimeout(r, 10));
    assert(bridge.browserOpenCalls.length === 1, '[3a] Browser.open() called exactly once');
    assert(bridge.browserOpenCalls[0].url === 'https://accounts.google.com/fake', '[3b] …with the URL signInWithOAuth() returned');
    assert(bridge.browserOpenCalls[0].presentationStyle === 'popover', '[3c] …with presentationStyle:"popover" (system sheet, not an in-webview navigation)');
    assert(authNative._isPendingForTest() === true, '[3d] a flow is now pending');

    bridge.fireAppUrlOpen('munera://auth/callback?code=real-code-123');
    await flow;
    assert(exchangeCalls.length === 1 && exchangeCalls[0] === 'real-code-123', `[3e] exchangeCodeForSession() called once with the code from the URL (got ${JSON.stringify(exchangeCalls)})`);
    assert(bridge.browserCloseCalls >= 1, '[3f] Browser.close() called after a matching callback arrives');
    assert(authNative._isPendingForTest() === false, '[3g] the flow is no longer pending once settled');
  });
  authNative._resetNativeAuthForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [3z] Listener count stays ONE across repeated gate renders / sign-out→
//      sign-in retries — WITHOUT _resetNativeAuthForTest() between cycles,
//      because that reset is a TEST-ONLY seam production code never calls
//      (see its own doc comment); real repeated calls to
//      signInWithGoogleNative() on the same page load must not accumulate a
//      second appUrlOpen/browserFinished listener each time the gate
//      re-renders or the player retries after a cancel.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3z] Listener count — exactly ONE appUrlOpen/browserFinished listener across repeated calls…');
{
  const authNative = await import('./js/auth-native.js');
  authNative._resetNativeAuthForTest(); // once, at the START of this scenario only
  const bridge = makeFakeBridge();
  bridge.install();
  const { client, exchangeCalls } = makeFakeClient();

  await withFakeAuthModule(client, async () => {
    // Cycle 1 — succeeds.
    let flow = authNative.signInWithGoogleNative();
    await new Promise(r => setTimeout(r, 10));
    bridge.fireAppUrlOpen('munera://auth/callback?code=cycle-1');
    await flow;
    assert(bridge.listenerCount('appUrlOpen') === 1, '[3z-a] after cycle 1 (success): exactly one appUrlOpen listener');
    assert(bridge.listenerCount('browserFinished') === 1, '[3z-a2] …and exactly one browserFinished listener');

    // Cycle 2 — cancelled (browserFinished), simulating a retry after "Sign-in cancelled."
    flow = authNative.signInWithGoogleNative();
    await new Promise(r => setTimeout(r, 10));
    bridge.fireBrowserFinished();
    let caught2 = null;
    try { await flow; } catch (e) { caught2 = e; }
    assert(!!caught2, '[3z-b-pre] fixture: cycle 2 actually rejected (cancel)');
    assert(bridge.listenerCount('appUrlOpen') === 1, '[3z-b] after cycle 2 (cancelled retry): STILL exactly one appUrlOpen listener — no accumulation');
    assert(bridge.listenerCount('browserFinished') === 1, '[3z-b2] …and still exactly one browserFinished listener');

    // Cycle 3 — succeeds again, simulating sign-out then a fresh sign-in.
    flow = authNative.signInWithGoogleNative();
    await new Promise(r => setTimeout(r, 10));
    bridge.fireAppUrlOpen('munera://auth/callback?code=cycle-3');
    await flow;
    assert(exchangeCalls.length === 2 && exchangeCalls[1] === 'cycle-3', `[3z-c-pre] fixture: cycle 3's exchange actually happened (got ${JSON.stringify(exchangeCalls)})`);
    assert(bridge.listenerCount('appUrlOpen') === 1, '[3z-c] after cycle 3 (a third real attempt): STILL exactly one appUrlOpen listener — three real sign-in attempts, one listener throughout');
  });
  authNative._resetNativeAuthForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] Exchange called EXACTLY ONCE even if the deep link fires twice
//     (mutation target (c))
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Deep link fires TWICE — exchangeCodeForSession() still called exactly once…');
{
  const authNative = await import('./js/auth-native.js');
  authNative._resetNativeAuthForTest();
  const bridge = makeFakeBridge();
  bridge.install();
  const { client, exchangeCalls } = makeFakeClient();

  await withFakeAuthModule(client, async () => {
    const flow = authNative.signInWithGoogleNative();
    await new Promise(r => setTimeout(r, 10));
    bridge.fireAppUrlOpen('munera://auth/callback?code=dup-code');
    bridge.fireAppUrlOpen('munera://auth/callback?code=dup-code'); // fires again, same tick family
    await flow;
    await new Promise(r => setTimeout(r, 10)); // let any stray second handler settle
    assert(exchangeCalls.length === 1, `[4a] exactly one exchangeCodeForSession() call despite two appUrlOpen events (got ${exchangeCalls.length})`);
  });
  authNative._resetNativeAuthForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [4z] Code-extraction edge cases — duplicate `?code=` params, fragment-style
//      `#code=`.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4z] Code-extraction edge cases…');
{
  const authNative = await import('./js/auth-native.js');

  // Duplicate query params — URLSearchParams.get() is spec-defined to return
  // the FIRST occurrence, so this is well-defined, not ambiguous.
  authNative._resetNativeAuthForTest();
  {
    const bridge = makeFakeBridge();
    bridge.install();
    const { client, exchangeCalls } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      const flow = authNative.signInWithGoogleNative();
      await new Promise(r => setTimeout(r, 10));
      bridge.fireAppUrlOpen('munera://auth/callback?code=a&code=b');
      await flow;
      assert(exchangeCalls.length === 1 && exchangeCalls[0] === 'a',
        `[4z-a] duplicate ?code=a&code=b uses the FIRST value ("a"), per URLSearchParams spec (got ${JSON.stringify(exchangeCalls)})`);
    });
  }

  // Fragment-style #code= (implicit-flow shape) — our matcher/extraction
  // only ever reads the QUERY string, never the fragment, so this must
  // SAFELY FAIL LOUD (the existing "no authorization code" rejection), never
  // silently succeed with an undefined code and never crash.
  authNative._resetNativeAuthForTest();
  {
    const bridge = makeFakeBridge();
    bridge.install();
    const { client, exchangeCalls } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      const flow = authNative.signInWithGoogleNative();
      await new Promise(r => setTimeout(r, 10));
      let threw = false;
      try {
        bridge.fireAppUrlOpen('munera://auth/callback#code=fragment-code');
      } catch { threw = true; }
      assert(threw === false, '[4z-b] a fragment-style #code= deep link never throws synchronously from the listener');
      let caught = null;
      try { await flow; } catch (e) { caught = e; }
      assert(!!caught && /authorization code/i.test(String(caught.message || '')),
        `[4z-c] …and the flow rejects with the SAME "no authorization code" message as a query-less callback (got "${caught && caught.message}") — safe, loud failure, never a silent accept`);
      assert(exchangeCalls.length === 0, '[4z-d] …and exchangeCodeForSession() was never called with an undefined code');
    });
  }
  authNative._resetNativeAuthForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] A deep link with NO in-flight flow is DROPPED
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] Deep link with no in-flight sign-in — dropped, no exchange, no throw…');
{
  const authNative = await import('./js/auth-native.js');
  authNative._resetNativeAuthForTest();
  const bridge = makeFakeBridge();
  bridge.install();
  const { client, exchangeCalls } = makeFakeClient();

  await withFakeAuthModule(client, async () => {
    // No signInWithGoogleNative() call at all yet — register the listener by
    // making one call and letting it be superseded is NOT what we want here;
    // instead prove the listener exists but is inert with nothing pending by
    // running a flow to completion first, THEN firing a stray link.
    const flow = authNative.signInWithGoogleNative();
    await new Promise(r => setTimeout(r, 10));
    bridge.fireAppUrlOpen('munera://auth/callback?code=first');
    await flow;
    exchangeCalls.length = 0; // clear the legitimate first exchange from the tally

    let threw = false;
    try {
      bridge.fireAppUrlOpen('munera://auth/callback?code=stray-cold-open');
      await new Promise(r => setTimeout(r, 10));
    } catch { threw = true; }
    assert(threw === false, '[5a] a stray deep link with no in-flight flow never throws');
    assert(exchangeCalls.length === 0, `[5b] …and never calls exchangeCodeForSession() (got ${exchangeCalls.length} calls)`);
  });
  authNative._resetNativeAuthForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [6] Cancel path (browserFinished) restores idle with a cancel-shaped error
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] browserFinished (user cancel) — rejects cancel-shaped, restores idle…');
{
  const authNative = await import('./js/auth-native.js');
  authNative._resetNativeAuthForTest();
  const bridge = makeFakeBridge();
  bridge.install();
  const { client, exchangeCalls } = makeFakeClient();

  await withFakeAuthModule(client, async () => {
    const flow = authNative.signInWithGoogleNative();
    await new Promise(r => setTimeout(r, 10));
    bridge.fireBrowserFinished();
    let caught = null;
    try { await flow; } catch (e) { caught = e; }
    assert(!!caught, '[6a] the promise rejects');
    assert(caught && /cancel|closed|popup/i.test(String(caught.message || caught)),
      `[6b] …with a message app.js's EXISTING classification regex treats as "cancelled" (got "${caught && caught.message}")`);
    assert(authNative._isPendingForTest() === false, '[6c] the flow is idle again — a retry is possible');
    assert(exchangeCalls.length === 0, '[6d] exchangeCodeForSession() was never called');
  });
  authNative._resetNativeAuthForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [7] Timeout path — same cancel-shaped rejection, injectable clock
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] Timeout (no deep link ever arrives) — same cancel-shaped rejection…');
{
  const authNative = await import('./js/auth-native.js');
  authNative._resetNativeAuthForTest({ flowTimeoutMs: 30 });
  const bridge = makeFakeBridge();
  bridge.install();
  const { client, exchangeCalls } = makeFakeClient();

  await withFakeAuthModule(client, async () => {
    const flow = authNative.signInWithGoogleNative();
    let caught = null;
    try { await flow; } catch (e) { caught = e; }
    assert(!!caught, '[7a] the promise eventually rejects on its own, nothing else fires');
    assert(caught && /cancel|closed|popup/i.test(String(caught.message || caught)),
      `[7b] …with a cancel-shaped message (got "${caught && caught.message}")`);
    assert(authNative._isPendingForTest() === false, '[7c] idle again after the timeout');
    assert(exchangeCalls.length === 0, '[7d] exchangeCodeForSession() never called');
  });
  authNative._resetNativeAuthForTest();
}

// ─────────────────────────────────────────────────────────────────────────────
// [8] Every failure mode surfaces a classifiable message
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] Every named failure mode surfaces a message app.js\'s existing catch can classify…');
{
  const authNative = await import('./js/auth-native.js');

  // 8a — no Capacitor bridge at all (Browser/App plugins missing).
  authNative._resetNativeAuthForTest();
  delete globalThis.window;
  {
    const { client } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      let caught = null;
      try { await authNative.signInWithGoogleNative(); } catch (e) { caught = e; }
      assert(!!caught && /native sign-in/i.test(String(caught.message || '')),
        `[8a] no bridge → a clear, non-blank error naming native sign-in (got "${caught && caught.message}")`);
    });
  }

  // 8b — OAuth error from signInWithOAuth() itself.
  authNative._resetNativeAuthForTest();
  {
    const bridge = makeFakeBridge();
    bridge.install();
    const { client } = makeFakeClient({ signInWithOAuth: async () => ({ data: null, error: new Error('network down') }) });
    await withFakeAuthModule(client, async () => {
      let caught = null;
      try { await authNative.signInWithGoogleNative(); } catch (e) { caught = e; }
      assert(!!caught && /network down/.test(String(caught.message || '')), `[8b] signInWithOAuth() error propagates verbatim (got "${caught && caught.message}")`);
    });
  }

  // 8c — Google/Supabase returns an error param on the callback.
  authNative._resetNativeAuthForTest();
  {
    const bridge = makeFakeBridge();
    bridge.install();
    const { client, exchangeCalls } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      const flow = authNative.signInWithGoogleNative();
      await new Promise(r => setTimeout(r, 10));
      bridge.fireAppUrlOpen('munera://auth/callback?error=access_denied&error_description=User%20denied%20access');
      let caught = null;
      try { await flow; } catch (e) { caught = e; }
      assert(!!caught && /denied/i.test(String(caught.message || '')), `[8c] an error/error_description on the callback surfaces (got "${caught && caught.message}")`);
      assert(exchangeCalls.length === 0, '[8c-2] exchangeCodeForSession() never called when the callback itself carries an error');
    });
  }

  // 8d — callback with no code and no error (malformed).
  authNative._resetNativeAuthForTest();
  {
    const bridge = makeFakeBridge();
    bridge.install();
    const { client, exchangeCalls } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      const flow = authNative.signInWithGoogleNative();
      await new Promise(r => setTimeout(r, 10));
      bridge.fireAppUrlOpen('munera://auth/callback');
      let caught = null;
      try { await flow; } catch (e) { caught = e; }
      assert(!!caught && /authorization code/i.test(String(caught.message || '')), `[8d] missing code surfaces its own message (got "${caught && caught.message}")`);
      assert(exchangeCalls.length === 0, '[8d-2] exchangeCodeForSession() never called with no code');
    });
  }

  // 8e — exchangeCodeForSession() itself fails.
  authNative._resetNativeAuthForTest();
  {
    const bridge = makeFakeBridge();
    bridge.install();
    const { client } = makeFakeClient({ exchangeCodeForSession: async () => ({ data: null, error: new Error('invalid_grant') }) });
    await withFakeAuthModule(client, async () => {
      const flow = authNative.signInWithGoogleNative();
      await new Promise(r => setTimeout(r, 10));
      bridge.fireAppUrlOpen('munera://auth/callback?code=bad-code');
      let caught = null;
      try { await flow; } catch (e) { caught = e; }
      assert(!!caught && /invalid_grant/.test(String(caught.message || '')), `[8e] exchangeCodeForSession() error propagates verbatim (got "${caught && caught.message}")`);
    });
  }

  authNative._resetNativeAuthForTest();
  delete globalThis.window;
}

// ─────────────────────────────────────────────────────────────────────────────
// [9] Source-level — no @capacitor import, only the named auth.js export,
//     zero top-level side effects
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] Source-level guards on js/auth-native.js…');
{
  const src = await readFile(path.join(root, 'js', 'auth-native.js'), 'utf8');
  // Narrow, import-shaped pattern — not a blanket substring — because this
  // file's own header PROSE legitimately explains "no @capacitor/* import
  // exists" (documenting the absence), matching DI-208a criterion 6's own
  // "outside comments" carve-out. What must be zero is an actual import/
  // require of the npm package, not any mention of the string.
  assert(!/from\s*['"]@capacitor|require\(\s*['"]@capacitor|import\(\s*['"]@capacitor/.test(src),
    '[9a] no actual "@capacitor..." import/require anywhere in js/auth-native.js (prose mentions in comments are fine — DI-208a criterion 6)');
  assert(/window\.Capacitor\.Plugins|window\.Capacitor\?\.Plugins/.test(src) || /Capacitor.*Plugins/.test(src),
    '[9b] reaches native plugins off the window.Capacitor.Plugins runtime global (fixture check)');
  const importMatches = [...src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'\.\/auth\.js';/gm)];
  assert(importMatches.length === 1, `[9c] exactly one static import from ./auth.js (got ${importMatches.length})`);
  if (importMatches.length === 1) {
    const names = importMatches[0][1].split(',').map(s => s.trim()).filter(Boolean);
    assert(names.length === 1 && names[0] === 'getSupabaseClient',
      `[9d] that import brings in ONLY getSupabaseClient — nothing else from js/auth.js (got ${JSON.stringify(names)})`);
  }
  assert(!/from\s*['"]\.\.?\/(?!auth\.js)[^'"]*\.js['"]/.test(src.replace(/import \{ getSupabaseClient \} from '\.\/auth\.js';\n?/, '')),
    '[9e] no OTHER relative module import beyond ./auth.js');

  // Zero top-level side effects OF THIS FILE'S OWN CODE — importing it must
  // not throw. It DOES statically import js/auth.js (per [9c]/[9d]/the
  // coordinator's instruction to use auth.js's EXISTING exports), and
  // auth.js's own top-level code independently reads `window.setTimeout` —
  // not this file's doing, not this file's to fix. So the real claim is
  // comparative: importing auth-native.js touches NO window property beyond
  // the set auth.js ALONE already touches on its own — i.e. auth-native.js
  // itself adds nothing at module scope.
  function trackerChild(url) {
    return [
      "const seen = new Set(); const written = new Set();",
      "const handler = { get(t, k) { seen.add(String(k)); return t[k]; }, set(t, k, v) { seen.add(String(k)); written.add(String(k)); t[k]=v; return true; } };",
      "globalThis.window = new Proxy({}, handler);",
      `await import(${JSON.stringify(url)});`,
      "console.log('TOUCHED-KEYS:' + JSON.stringify([...seen].sort()));",
      "console.log('WRITTEN-KEYS:' + JSON.stringify([...written].sort()));",
    ].join('\n');
  }
  const authUrl = new URL('./js/auth.js', import.meta.url).href;
  const authNativeUrl = new URL('./js/auth-native.js', import.meta.url).href;
  const baselineRun = spawnSync(process.execPath, ['--input-type=module', '--eval', trackerChild(authUrl)], { encoding: 'utf8', timeout: 15000 });
  const nativeRun = spawnSync(process.execPath, ['--input-type=module', '--eval', trackerChild(authNativeUrl)], { encoding: 'utf8', timeout: 15000 });
  const baselineOut = `${baselineRun.stdout || ''}${baselineRun.stderr || ''}`;
  const nativeOut = `${nativeRun.stdout || ''}${nativeRun.stderr || ''}`;
  assert(nativeRun.status === 0, `[9f] fixture: the child imports js/auth-native.js cleanly with no window.supabase at all (exit ${nativeRun.status})${nativeRun.status === 0 ? '' : '\n' + nativeOut.slice(-500)}`);
  const baselineMatch = /TOUCHED-KEYS:(.*)/.exec(baselineOut);
  const nativeMatch = /TOUCHED-KEYS:(.*)/.exec(nativeOut);
  assert(!!baselineMatch && !!nativeMatch, `[9g-pre] fixture: both children reported their touched-key sets (baseline: ${!!baselineMatch}, native: ${!!nativeMatch})`);
  if (baselineMatch && nativeMatch) {
    const baselineKeys = new Set(JSON.parse(baselineMatch[1]));
    const nativeKeys = new Set(JSON.parse(nativeMatch[1]));
    const extra = [...nativeKeys].filter(k => !baselineKeys.has(k));
    // RG-233 (d), 2026-09-23 — auth-native.js now has EXACTLY ONE module-load
    // side effect by design: ensureNativeSignInListeners(), which READS
    // window.Capacitor to find the bridge (and registers the two deep-link
    // listeners if it's up, so a cold-start `appUrlOpen` is never delivered to
    // nobody). `Capacitor` is therefore an expected extra READ — and nothing
    // else is, which is what [9g2] pins: importing this module still WRITES no
    // window property at all.
    assert(extra.length === 0 || (extra.length === 1 && extra[0] === 'Capacitor'),
      `[9g] importing js/auth-native.js touches NO window property beyond what importing js/auth.js ALONE already touches, except the one deliberate window.Capacitor READ (baseline=${JSON.stringify([...baselineKeys])}, native=${JSON.stringify([...nativeKeys])}, extra=${JSON.stringify(extra)})`);
    const baselineWritten = new Set(JSON.parse((/WRITTEN-KEYS:(.*)/.exec(baselineOut) || [, '[]'])[1]));
    const nativeWritten = new Set(JSON.parse((/WRITTEN-KEYS:(.*)/.exec(nativeOut) || [, '[]'])[1]));
    const extraWritten = [...nativeWritten].filter(k => !baselineWritten.has(k));
    assert(extraWritten.length === 0,
      `[9g2] …and importing it ASSIGNS to no window property that importing js/auth.js alone doesn't already assign — the load-time listener registration is a read plus a plugin call, never a global (extraWritten=${JSON.stringify(extraWritten)})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [10] js/app.js's click handler — real extracted source, loader-instrumented
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] showGoogleSignInGate() click handler — real source, native imports/calls auth-native.js, web never does…');
{
  async function extractClickHandlerBody(appSrc) {
    const anchor = "btn?.addEventListener('click', async () => {";
    const start = appSrc.indexOf(anchor);
    if (start === -1) return null;
    let idx = start + anchor.length;
    let depth = 1;
    while (depth > 0 && idx < appSrc.length) {
      const ch = appSrc[idx];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      idx++;
    }
    return appSrc.slice(start + anchor.length, idx - 1);
  }

  const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  const body = await extractClickHandlerBody(appSrc);
  assert(!!body, '[10-pre] fixture: the click handler body was found in js/app.js (a miss would make everything below vacuous)');
  assert(!body || body.includes("getAuthPath() === 'native'"), '[10-pre2] fixture: the extracted body actually contains the DI-208e branch');

  if (body) {
    // F5 (reviewer, 2026-09-21) — NO REAL FILE is ever written under
    // cfb-pickems/js/ for this harness. A prior draft wrote+unlinked a real
    // file there; a hard kill (SIGKILL) between those two steps would skip
    // the `finally` cleanup entirely and leave test-harness clutter sitting
    // in the SHIPPED tree — deploy.sh's rsync has no exclude for it, so it
    // would ship to production on the next deploy. Instead: a `file://`
    // URL that LOOKS like it lives in cfb-pickems/js/ (so a relative
    // `import('./auth-native.js')` inside the extracted body resolves
    // against the REAL cfb-pickems/js/ directory) but is never written to
    // disk — the loader's own `load` hook supplies its source from memory.
    // There is nothing on disk to leak, ever, regardless of how the process
    // dies.
    const virtualHarnessUrl = new URL('./js/__authnativetest_click_harness__.mjs', import.meta.url).href;
    // RG-233 — the handler body references TWO bindings from its enclosing
    // scope inside showGoogleSignInGate(): `liveEl` (re-resolve a node that a
    // mid-flow gate repaint detached) and `clickSeq` (which tap owns the UI).
    // Both are EXTRACTED from the real js/app.js source rather than
    // hand-written here, so a change to either goes through this harness.
    const liveElLine = (appSrc.match(/^\s*const liveEl = .*$/m) || [null])[0];
    const clickSeqLine = (appSrc.match(/^\s*let clickSeq = 0;.*$/m) || [null])[0];
    // showMessage() comes from the REAL source too — [10i]/[10j] below prove a
    // message still reaches the player after a mid-flow gate repaint, which is
    // only a real proof if the function under test is app.js's own.
    const showMessageSrc = (() => {
      const anchor = 'const showMessage = (text, tone) => {';
      const at = appSrc.indexOf(anchor);
      if (at === -1) return null;
      let depth = 1, i = appSrc.indexOf('{', at) + 1;
      while (depth > 0 && i < appSrc.length) {
        if (appSrc[i] === '{') depth++;
        else if (appSrc[i] === '}') depth--;
        i++;
      }
      return appSrc.slice(at, i) + ';';
    })();
    assert(!!liveElLine, '[10-pre3] fixture: showGoogleSignInGate()\'s `liveEl` helper was found in js/app.js (the handler body needs it in scope)');
    assert(!!clickSeqLine, '[10-pre4] fixture: showGoogleSignInGate()\'s `clickSeq` counter was found in js/app.js');
    assert(!!showMessageSrc, '[10-pre5] fixture: showGoogleSignInGate()\'s `showMessage` helper was extracted from js/app.js');
    // RG-234 (2026-09-23) — the handler body gained three more enclosing-scope
    // dependencies (the watchdog's constant/override/getter, its player-facing
    // sentence, and the `nativeAuthMod` the watchdog cancels a stalled flow off).
    // EXTRACTED from the real js/app.js like liveEl/clickSeq above, never
    // hand-written here, so a change to any of them goes through this harness
    // instead of silently making it diverge from what ships.
    const wdConstLine = (appSrc.match(/^\s*const NATIVE_SIGNIN_WATCHDOG_MS = .*$/m) || [null])[0];
    const wdOverrideLine = (appSrc.match(/^\s*let _nativeSignInWatchdogMsOverride = .*$/m) || [null])[0];
    const wdGetterLine = (appSrc.match(/^\s*function _getNativeSignInWatchdogMs\(\) .*$/m) || [null])[0];
    const wdMsgLine = (appSrc.match(/^\s*export const NATIVE_SIGNIN_WATCHDOG_MESSAGE = .*$/m) || [null])[0];
    const nativeModLine = (appSrc.match(/^\s*let nativeAuthMod = null;.*$/m) || [null])[0];
    assert(!!wdConstLine && !!wdOverrideLine && !!wdGetterLine && !!wdMsgLine && !!nativeModLine,
      '[10-pre6] fixture: RG-234\'s watchdog bindings and `nativeAuthMod` were all found in js/app.js');
    const harnessSrc = [
      "import { getAuthPath } from './platform.js';",
      "import { signInWithGoogle } from './auth.js';",
      "let btn = null, label = null, msgEl = null;",
      "export function installNodes(b, l, m) { btn = b; label = l; msgEl = m; }",
      wdConstLine || 'const NATIVE_SIGNIN_WATCHDOG_MS = 25000;',
      wdOverrideLine || 'let _nativeSignInWatchdogMsOverride = null;',
      wdGetterLine || 'function _getNativeSignInWatchdogMs() { return NATIVE_SIGNIN_WATCHDOG_MS; }',
      (wdMsgLine || "export const NATIVE_SIGNIN_WATCHDOG_MESSAGE = '';").replace(/^\s*export /, ''),
      nativeModLine || 'let nativeAuthMod = null;',
      clickSeqLine || 'let clickSeq = 0;',
      liveElLine || 'const liveEl = (c) => c;',
      showMessageSrc || 'const showMessage = () => {};',
      "export async function runClickHandler() {",
      body,
      "}",
    ].join('\n');

    async function runScenario({ native, detach = false }) {
      // The `resolve` hook proves the auth-native.js specifier was ever
      // asked for at all (the [10b]/[10e] proof). The `load` hook goes one
      // step further and proves INVOCATION, not just import: it splices one
      // marker statement into auth-native.js's SOURCE, in memory, only
      // inside this child process — never touching the real checked-in
      // file — at the top of signInWithGoogleNative()'s own body, so the
      // marker can only flip if that exact function actually starts
      // executing. The SAME load hook also serves the virtual harness
      // module's own source (F5) — no file for either ever touches disk.
      const loaderSrc = [
        "export async function resolve(specifier, context, nextResolve) {",
        "  if (specifier === " + JSON.stringify(virtualHarnessUrl) + ") { return { url: specifier, shortCircuit: true }; }",
        "  if (specifier.endsWith('auth-native.js')) { console.error('LOADER-SAW-AUTH-NATIVE'); }",
        "  return nextResolve(specifier, context);",
        "}",
        "export async function load(url, context, nextLoad) {",
        "  if (url === " + JSON.stringify(virtualHarnessUrl) + ") { return { format: 'module', source: " + JSON.stringify(harnessSrc) + ", shortCircuit: true }; }",
        "  const result = await nextLoad(url, context);",
        "  if (url.endsWith('auth-native.js') && result.source != null) {",
        "    const text = result.source.toString('utf8');",
        // RG-234 — anchored on the DECLARATION, parameter list and all, rather
        // than on one literal signature: signInWithGoogleNative() gained an
        // options argument ({ onSheetOpened }) and a literal-string splice
        // silently stopped matching, which turned [10f] green-by-vacuity for
        // exactly as long as it took to notice. A regex keeps the marker attached
        // to the function, not to its 2026-09-21 signature.
        "    result.source = text.replace(",
        "      /export async function signInWithGoogleNative\\(([^)]*)\\) \\{/,",
        "      (whole) => whole + ' globalThis.__CALLED_NATIVE__ = true;'",
        "    );",
        "  }",
        "  return result;",
        "}",
      ].join('\n');
      const child = [
        "import { register } from 'node:module';",
        `register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(loaderSrc)}), import.meta.url);`,
        "const store = new Map();",
        "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
        native
          ? "globalThis.window = { Capacitor: { isNativePlatform: () => true } }; globalThis.location = { protocol: 'capacitor:' };"
          : "globalThis.window = {}; globalThis.location = { protocol: 'https:' };",
        "const harness = await import(process.env.HARNESS_URL);",
        // A minimal DOM: three nodes reachable by id, each with `isConnected`,
        // so app.js's liveEl() can be exercised for real. DETACH=1 models the
        // gate repainting mid-flow (fireSignInGateDeadline() calling
        // showGoogleSignInGate() again): the captured nodes go isConnected:false
        // and document.getElementById() starts answering with replacements.
        "const nodes = {};",
        "const origBtn = { disabled: false, isConnected: true };",
        "const origLabel = { isConnected: true, textContent: '' };",
        "const origMsg = { isConnected: true, style: { display: 'none' }, className: '', textContent: '' };",
        "const newBtn = { disabled: true, isConnected: true };",
        "const newLabel = { isConnected: true, textContent: 'Connecting to Google…' };",
        "const newMsg = { isConnected: true, style: { display: 'none' }, className: '', textContent: '' };",
        "nodes['google-gate-submit'] = origBtn; nodes['google-gate-btn-label'] = origLabel; nodes['google-gate-message'] = origMsg;",
        "globalThis.document = { getElementById: id => nodes[id] || null };",
        "harness.installNodes(origBtn, origLabel, origMsg);",
        "const started = harness.runClickHandler();",
        "if (process.env.DETACH === '1') {",
        "  origBtn.isConnected = false; origLabel.isConnected = false; origMsg.isConnected = false;",
        "  nodes['google-gate-submit'] = newBtn; nodes['google-gate-btn-label'] = newLabel; nodes['google-gate-message'] = newMsg;",
        "}",
        "let caught = null;",
        "try { await started; } catch (e) { caught = e; }",
        "console.log('SCENARIO-DONE:' + JSON.stringify({ origMsgText: origMsg.textContent, newMsgText: newMsg.textContent, origMsgShown: origMsg.style.display, newMsgShown: newMsg.style.display, origBtnDisabled: origBtn.disabled, newBtnDisabled: newBtn.disabled, newLabelText: newLabel.textContent, caughtInBody: caught ? String(caught.message || caught) : null, calledNative: globalThis.__CALLED_NATIVE__ === true }));",
      ].join('\n');
      const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 15000,
        env: { ...process.env, HARNESS_URL: virtualHarnessUrl, DETACH: detach ? '1' : '0' },
      });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      let parsed = null;
      const m = /SCENARIO-DONE:(\{.*\})/.exec(out);
      if (m) { try { parsed = JSON.parse(m[1]); } catch { /* reported by the assertions that need it */ } }
      return { out, parsed, status: run.status, sawAuthNative: /LOADER-SAW-AUTH-NATIVE/.test(out), calledNative: /"calledNative":true/.test(out) };
    }

    const webRun = await runScenario({ native: false });
    assert(webRun.status === 0, `[10a] fixture: web scenario child exits 0 (got ${webRun.status})${webRun.status === 0 ? '' : '\n' + webRun.out.slice(-600)}`);
    assert(webRun.sawAuthNative === false, '[10b] WEB: the dynamic import of ./auth-native.js is NEVER evaluated');
    assert(webRun.calledNative === false, '[10b2] WEB: signInWithGoogleNative() is NEVER invoked (the load-hook marker never flips)');
    assert(/Google sign-in couldn.t complete/.test(webRun.out),
      `[10c] WEB: the click handler's catch actually ran — the generic error notice was shown, proving signInWithGoogle() (the unchanged web function) threw and was caught, exactly as it does today with no Supabase configured (got: ${webRun.out.slice(-400)})`);

    const nativeRun = await runScenario({ native: true });
    assert(nativeRun.status === 0, `[10d] fixture: native scenario child exits 0 (got ${nativeRun.status})${nativeRun.status === 0 ? '' : '\n' + nativeRun.out.slice(-600)}`);
    assert(nativeRun.sawAuthNative === true, '[10e] NATIVE: the dynamic import of ./auth-native.js IS evaluated');
    assert(nativeRun.calledNative === true, '[10f] NATIVE: signInWithGoogleNative() is ACTUALLY INVOKED — not just imported and left uncalled (the load-hook marker, spliced into signInWithGoogleNative()\'s own body in this child process\'s memory only, flips to true)');
    // RG-234 (2026-09-23) — this scenario's failure is "Supabase client is not
    // configured", which auth-native.js now tags with its OWN player-facing
    // sentence, so the gate correctly shows that instead of the generic
    // fallback. The assertion's INTENT is unchanged (the catch ran end to end
    // and a message reached the player); only the expected copy moved, because
    // [14u] now requires every failure mode to carry its own sentence.
    assert(/Sign-in isn.t ready yet/.test(nativeRun.out),
      `[10g] NATIVE: the click handler's catch actually ran too — the failure's own notice was shown, proving the whole try/catch executed end to end on this branch as well (got: ${nativeRun.out.slice(-400)})`);

    // ── RG-233 (a) — the button ALWAYS comes back, on both paths.
    assert(webRun.parsed && webRun.parsed.origBtnDisabled === false,
      `[10i] WEB: after the rejection, the button is ENABLED again (got ${JSON.stringify(webRun.parsed && webRun.parsed.origBtnDisabled)})`);
    assert(nativeRun.parsed && nativeRun.parsed.origBtnDisabled === false,
      `[10i2] NATIVE: same — the button is ENABLED again after the rejection (got ${JSON.stringify(nativeRun.parsed && nativeRun.parsed.origBtnDisabled)})`);

    // ── RG-233 (H3) — the gate repaints MID-FLOW (fireSignInGateDeadline()),
    //    replacing the nodes the handler captured. Before the fix the handler
    //    wrote to the detached originals: the REPLACEMENT button stayed disabled
    //    on "Connecting to Google…" and no message was ever shown — a second,
    //    independent route to Drew's exact frozen-button symptom.
    const detachedRun = await runScenario({ native: true, detach: true });
    assert(detachedRun.status === 0, `[10j-fixture] the mid-flow-repaint scenario child exits 0 (got ${detachedRun.status})${detachedRun.status === 0 ? '' : '\n' + detachedRun.out.slice(-600)}`);
    assert(detachedRun.parsed && detachedRun.parsed.newBtnDisabled === false,
      `[10j] mid-flow repaint: the REPLACEMENT button (the one actually on screen) is re-enabled, not the detached one the handler captured (got ${JSON.stringify(detachedRun.parsed && detachedRun.parsed.newBtnDisabled)})`);
    assert(detachedRun.parsed && detachedRun.parsed.newLabelText === 'Continue with Google',
      `[10k] …and the visible label says "Continue with Google" again, not a stuck "Connecting to Google…" (got ${JSON.stringify(detachedRun.parsed && detachedRun.parsed.newLabelText)})`);
    // RG-234 — same copy note as [10g]: the sentence is now the failure's own.
    assert(detachedRun.parsed && /Sign-in isn.t ready yet/.test(String(detachedRun.parsed.newMsgText || '')) && detachedRun.parsed.newMsgShown === 'block',
      `[10l] …and the failure message lands in the VISIBLE message slot (got ${JSON.stringify(detachedRun.parsed && detachedRun.parsed.newMsgText)}, display=${JSON.stringify(detachedRun.parsed && detachedRun.parsed.newMsgShown)})`);

    // ── RG-233 (b) — the handler clears a stale, never-settled flow before
    //    starting, so a second tap can never be swallowed by "already in
    //    progress". Structural: the live behavior is covered at module level in
    //    [13] below, where the bridge and client can be faked.
    assert(/cancelPendingNativeSignIn/.test(body),
      '[10m] the click handler calls cancelPendingNativeSignIn() on the native branch before starting a flow');

    // F5 anti-vacuity — confirm the virtual module genuinely never touched
    // disk at any point during either scenario above (not just "we didn't
    // write it on purpose" — prove nothing appeared there by accident).
    const strayPath = path.join(root, 'js', '__authnativetest_click_harness__.mjs');
    assert(!existsSync(strayPath), '[10h] F5 — no stray __authnativetest_click_harness__.mjs file exists anywhere under cfb-pickems/js/ (the virtual module never touches disk)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [11] service-worker.js STATIC_ASSETS never lists auth-native.js
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] service-worker.js — STATIC_ASSETS never references auth-native.js…');
{
  const swSrc = await readFile(path.join(root, 'service-worker.js'), 'utf8');
  assert(!/auth-native\.js/.test(swSrc), '[11a] "auth-native.js" does not appear anywhere in service-worker.js (STATIC_ASSETS stays off-limits, untouched)');
}

// ─────────────────────────────────────────────────────────────────────────────
// [12] Grep-proof — zero @capacitor, zero munera-ios, under cfb-pickems/
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] Grep-proof — no "@capacitor" and no "munera-ios" anywhere under cfb-pickems/…');
{
  const { readdir } = await import('node:fs/promises');
  const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'supabase']);
  const capacitorOffenders = [];
  const muneraIosOffenders = [];
  const CAPACITOR_IMPORT_RE = /from\s*['"]@capacitor|require\(\s*['"]@capacitor|import\(\s*['"]@capacitor/;
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      // Test harnesses (*.mjs at the repo root) legitimately DISCUSS these
      // strings in comments/labels to test for their absence elsewhere —
      // platformtest.mjs [2]'s own precedent excludes them the same way.
      // This scan is a claim about the SHIPPED app (*.js/index.html/
      // service-worker.js), not about whether any file anywhere mentions
      // the string.
      if (e.name.endsWith('.mjs')) continue;
      if (!(e.name.endsWith('.js') || e.name === 'index.html' || e.name === 'service-worker.js')) continue;
      let src;
      try { src = await readFile(full, 'utf8'); } catch { continue; }
      if (CAPACITOR_IMPORT_RE.test(src)) capacitorOffenders.push(full);
      if (/munera-ios/.test(src)) muneraIosOffenders.push(full);
    }
  }
  await walk(root);
  assert(capacitorOffenders.length === 0, `[12a] zero actual "@capacitor..." imports/requires in shipped *.js/index.html/service-worker.js (found: ${capacitorOffenders.join(', ') || 'none'})`);
  assert(muneraIosOffenders.length === 0, `[12b] zero "munera-ios" hits in shipped *.js/index.html/service-worker.js (found: ${muneraIosOffenders.join(', ') || 'none'})`);
}

// ═════════════════════════════════════════════════════════════════════════
// [13] RG-233 — bug B-e part 2: the frozen "Connecting to Google…".
//
// Drew, iPhone 16 Pro, 2026-09-23 (A2, immediately after RG-232 sent him to the
// sign-in gate with a perfectly good session in the Keychain): tapping
// "Continue with Google" showed "Connecting to Google…" and then NOTHING — no
// browser sheet, no error, >1 minute. The sheet is opened AFTER
// signInWithOAuth() resolves, so "no sheet" localises the hang to that one
// await — which had no bound at all, and which the 120s flow timeout could not
// cover because that timer is armed further down, after it resolves.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[13] RG-233 — unbounded signInWithOAuth(), stale pending flows, load-time listeners…');
{
  const authNative = await import('./js/auth-native.js');

  // ── (c) the bound. A signInWithOAuth() that never settles — exactly Drew's
  //    symptom — now rejects with the player-facing sentence instead of hanging.
  {
    authNative._resetNativeAuthForTest({ oauthUrlTimeoutMs: 60 });
    const bridge = makeFakeBridge();
    bridge.install();
    const { client } = makeFakeClient({ signInWithOAuth: () => new Promise(() => {}) }); // never settles, ever
    await withFakeAuthModule(client, async () => {
      const started = Date.now();
      let caught = null;
      try {
        await Promise.race([
          authNative.signInWithGoogleNative(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TEST-WATCHDOG: still hanging after 3s')), 3000)),
        ]);
      } catch (e) { caught = e; }
      assert(!!caught && !/TEST-WATCHDOG/.test(String(caught.message)),
        `[13a] a signInWithOAuth() that NEVER settles now rejects within the bound instead of hanging forever — Drew's exact freeze (got ${caught ? caught.message : 'no rejection at all'})`);
      assert(!!caught && caught.userMessage === "Couldn't reach Google — try again.",
        `[13b] …carrying the player-facing sentence the gate shows verbatim (got ${JSON.stringify(caught && caught.userMessage)})`);
      assert(Date.now() - started < 2000, `[13c] …and it settles promptly, on the injectable bound, not on some other timer (took ${Date.now() - started}ms)`);
      assert(bridge.browserOpenCalls.length === 0, '[13d] …and no browser sheet was opened, matching what Drew saw (nothing appeared)');
      assert(authNative._isPendingForTest() === false, '[13e] …and no pending flow is left behind to poison the next tap');
    });
    authNative._resetNativeAuthForTest();
  }

  // ── (b) a stale, never-settled flow is recoverable: the next tap starts a
  //    FRESH flow instead of throwing "already in progress" forever.
  {
    authNative._resetNativeAuthForTest();
    const bridge = makeFakeBridge();
    bridge.install();
    const { client, exchangeCalls } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      // The device state: a flow that never settled (its deep link was missed
      // on a cold start, before listeners were registered at load).
      authNative._setPendingForTest(true);
      let blocked = null;
      try { await authNative.signInWithGoogleNative(); } catch (e) { blocked = e; }
      assert(!!blocked && /already in progress/i.test(String(blocked.message)),
        `[13f-fixture] with stale pending state, signInWithGoogleNative() alone still refuses (this is the state the gate got stuck in) — got ${blocked ? blocked.message : 'no throw'}`);

      const cancelled = authNative.cancelPendingNativeSignIn();
      assert(cancelled === true, '[13g] cancelPendingNativeSignIn() reports that it actually cleared a stale flow');
      assert(authNative._isPendingForTest() === false, '[13h] …and no flow is pending afterward');

      const flow = authNative.signInWithGoogleNative();
      await new Promise(r => setTimeout(r, 10));
      assert(bridge.browserOpenCalls.length === 1, `[13i] the NEXT tap starts a real, fresh flow — the browser sheet opens (got ${bridge.browserOpenCalls.length} opens)`);
      bridge.fireAppUrlOpen('munera://auth/callback?code=after-stale');
      await flow;
      assert(exchangeCalls.length === 1 && exchangeCalls[0] === 'after-stale',
        `[13j] …and it completes end to end through the same exchange path (got ${JSON.stringify(exchangeCalls)})`);
    });
    authNative._resetNativeAuthForTest();
  }

  // ── (b) the superseded flow REJECTS (never dangles), and says so in a way the
  //    gate can recognise and stay quiet about.
  {
    authNative._resetNativeAuthForTest();
    const bridge = makeFakeBridge();
    bridge.install();
    const { client } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      const first = authNative.signInWithGoogleNative();
      await new Promise(r => setTimeout(r, 10));
      let caught = null;
      first.catch(e => { caught = e; });
      authNative.cancelPendingNativeSignIn();
      await new Promise(r => setTimeout(r, 10));
      assert(!!caught, '[13k] cancelling settles the superseded flow with a REJECTION — the old caller\'s catch runs, nothing is left dangling');
      assert(!!caught && caught.supersededNativeFlow === true,
        '[13l] …flagged `supersededNativeFlow`, so the replaced tap\'s handler stays silent instead of painting over the new attempt');
    });
    authNative._resetNativeAuthForTest();
  }

  // ── (d) listeners at MODULE LOAD, in a fresh child process — the only honest
  //    way to test a load-time side effect. And security condition 5 still
  //    holds there: a deep link with no pending flow is DROPPED.
  {
    const child = [
      "const store = new Map();",
      "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
      "const listeners = {};",
      "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {",
      "  Browser: { async open() {}, async close() {} },",
      "  App: { addListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); } },",
      "} } };",
      "globalThis.location = { protocol: 'capacitor:' };",
      "await import(process.env.MOD_URL);", // no call to signInWithGoogleNative()
      "const counts = { appUrlOpen: (listeners.appUrlOpen || []).length, browserFinished: (listeners.browserFinished || []).length };",
      // Fire a callback with NOTHING in flight — must be dropped silently.
      "let threw = null;",
      "try { for (const fn of (listeners.appUrlOpen || [])) await fn({ url: 'munera://auth/callback?code=stray' }); } catch (e) { threw = String(e && e.message); }",
      "console.log('LOAD-LISTENERS:' + JSON.stringify({ counts, threw }));",
    ].join('\n');
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, MOD_URL: new URL('./js/auth-native.js', import.meta.url).href },
    });
    const out = `${run.stdout || ''}${run.stderr || ''}`;
    const m = /LOAD-LISTENERS:(\{.*\})/.exec(out);
    const parsed = m ? JSON.parse(m[1]) : null;
    assert(!!parsed && parsed.counts.appUrlOpen === 1,
      `[13m] importing js/auth-native.js registers the appUrlOpen listener at LOAD — before any tap, so a cold-start deep link is never delivered to nobody (got ${m ? m[1] : out.slice(-400)})`);
    assert(!!parsed && parsed.counts.browserFinished === 1,
      '[13n] …and exactly one browserFinished listener, still no accumulation');
    assert(!!parsed && parsed.threw === null && !/exchangeCodeForSession/.test(out),
      `[13o] …and a matching deep link with NO in-flight flow is still DROPPED there — no exchange, no throw (security condition 5 unchanged by the earlier registration) (got ${m ? m[1] : out.slice(-400)})`);
  }

  // ── Source-level: the load-time call is a real top-level statement, and the
  //    bound is applied to signInWithOAuth() specifically.
  {
    const src = await readFile(path.join(root, 'js', 'auth-native.js'), 'utf8');
    assert(/\n\s*ensureNativeSignInListeners\(\);\s*\n/.test(src),
      '[13p] ensureNativeSignInListeners() is called at module top level (not only from inside signInWithGoogleNative())');
    assert(/_withTimeout\(oauthPromise, _oauthUrlTimeoutMs, OAUTH_URL_TIMEOUT_MESSAGE\)/.test(src),
      '[13q] the signInWithOAuth() await goes through the bound, not a bare await');
  }

  // ── Mutation proofs for (a) and (b) — SCRATCH COPIES ONLY, per CLAUDE.md; no
  //    git checkout/restore/stash anywhere.
  {
    const scratchDir = await mkdtemp(path.join(tmpdir(), 'cfbp-authnative-rg233-'));
    const rewrite = src => src.replace(/(from\s+')(\.\/[^']+)(')/g, (whole, pre, rel, post) =>
      pre + new URL(`./js/${rel.slice(2)}`, import.meta.url).href + post);
    try {
      const realSrc = await readFile(path.join(root, 'js', 'auth-native.js'), 'utf8');

      // (c)/(a) mutation: remove the bound -> the hang comes straight back.
      {
        const mutated = realSrc.replace(
          'const res = await _withTimeout(oauthPromise, _oauthUrlTimeoutMs, OAUTH_URL_TIMEOUT_MESSAGE);',
          'const res = await oauthPromise; // MUTATION: bound removed'
        );
        assert(mutated !== realSrc, '[13r-fixture] the bound-removal mutation actually changed the source');
        const scratch = path.join(scratchDir, '__mutation_scratch_auth_native_nobound.js');
        await writeFile(scratch, rewrite(mutated), 'utf8');
        const child = [
          "const store = new Map();",
          "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
          "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Browser: { async open() { console.log('SHEET-OPENED'); }, async close() {} }, App: { addListener() {} } } }, supabase: { createClient: () => ({ auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } }, signInWithOAuth: () => new Promise(() => {}), exchangeCodeForSession: async () => ({ data: {}, error: null }) } }) } };",
          "globalThis.location = { protocol: 'capacitor:' };",
          "const auth = await import(process.env.AUTH_URL);",
          "auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });",
          "const mod = await import(process.env.MOD_URL);",
          "let settled = 'NO';",
          "mod.signInWithGoogleNative().then(() => { settled = 'RESOLVED'; }, () => { settled = 'REJECTED'; });",
          "await new Promise(r => setTimeout(r, 400));",
          "console.log('MUTATION13 settled=' + settled);",
        ].join('\n');
        const envBase = { ...process.env, AUTH_URL: new URL('./js/auth.js', import.meta.url).href };
        const runMut = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
          encoding: 'utf8', timeout: 15000,
          env: { ...envBase, MOD_URL: new URL(`file://${scratch}`).href },
        });
        const outMut = `${runMut.stdout || ''}${runMut.stderr || ''}`;
        assert(/MUTATION13 settled=NO/.test(outMut),
          `[13r] RED-proof: with the bound removed, the flow NEVER settles — the button would stay on "Connecting to Google…" indefinitely, which is exactly what Drew reported (got ${/MUTATION13 settled=(\w+)/.exec(outMut)?.[1] || outMut.slice(-400)})`);

        const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child.replace('setTimeout(r, 400)', 'setTimeout(r, 400)')], {
          encoding: 'utf8', timeout: 20000,
          env: { ...envBase, MOD_URL: new URL('./js/auth-native.js', import.meta.url).href, },
        });
        const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
        // The real bound is 20s, far longer than this 400ms probe — so assert
        // the real module is the one WITH the bound (structurally pinned in
        // [13q]) and that it behaves identically up to that point: no sheet.
        assert(!/SHEET-OPENED/.test(outReal),
          '[13s-control] fixture: the real module opens no sheet in that scenario either (the hang is upstream of Browser.open, which is why Drew saw nothing) — the difference is only that it eventually settles, proved live in [13a]');
      }

      // (b) mutation: drop cancelPendingNativeSignIn()'s effect -> a stale flow
      // is permanently unrecoverable again.
      {
        const mutated = realSrc.replace(
          /export function cancelPendingNativeSignIn\(\) \{[\s\S]*?\n\}/,
          'export function cancelPendingNativeSignIn() { return false; /* MUTATION: no-op */ }'
        );
        assert(mutated !== realSrc, '[13t-fixture] the cancel-no-op mutation actually changed the source');
        const scratch = path.join(scratchDir, '__mutation_scratch_auth_native_nocancel.js');
        await writeFile(scratch, rewrite(mutated), 'utf8');
        const child = [
          "const store = new Map();",
          "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
          "let opens = 0;",
          "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Browser: { async open() { opens++; }, async close() {} }, App: { addListener() {} } } }, supabase: { createClient: () => ({ auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } }, signInWithOAuth: async () => ({ data: { url: 'https://accounts.google.com/fake' }, error: null }), exchangeCodeForSession: async () => ({ data: {}, error: null }) } }) } };",
          "globalThis.location = { protocol: 'capacitor:' };",
          "const auth = await import(process.env.AUTH_URL);",
          "auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });",
          "const mod = await import(process.env.MOD_URL);",
          "mod._setPendingForTest(true);",           // the stale state
          "mod.cancelPendingNativeSignIn();",        // what the gate now does first
          // NOT awaited to completion: a healthy flow stays pending until its
          // deep link arrives (that's the point), so the observable is "did a
          // sheet open and was there an error", sampled after a tick.
          "let err = null;",
          "const started = mod.signInWithGoogleNative();",
          "started.catch(e => { err = String(e && e.message); });",
          "await new Promise(r => setTimeout(r, 50));",
          "console.log('MUTATION13B ' + JSON.stringify({ opens, err }));",
          "process.exit(0);",
        ].join('\n');
        const envBase = { ...process.env, AUTH_URL: new URL('./js/auth.js', import.meta.url).href };
        const runMut = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
          encoding: 'utf8', timeout: 15000,
          env: { ...envBase, MOD_URL: new URL(`file://${scratch}`).href },
        });
        const outMut = `${runMut.stdout || ''}${runMut.stderr || ''}`;
        assert(/MUTATION13B .*"opens":0/.test(outMut) && /already in progress/i.test(outMut),
          `[13t] RED-proof: with cancelPendingNativeSignIn() neutered, a stale pending flow makes every later tap throw "already in progress" and open no sheet — the dead end the fix removes (got ${/MUTATION13B (\{.*\})/.exec(outMut)?.[1] || outMut.slice(-400)})`);
        const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
          encoding: 'utf8', timeout: 15000,
          env: { ...envBase, MOD_URL: new URL('./js/auth-native.js', import.meta.url).href },
        });
        const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
        assert(/MUTATION13B .*"opens":1/.test(outReal) && /"err":null/.test(outReal),
          `[13u-control] fixture: the REAL module recovers — one sheet opened, no error (got ${/MUTATION13B (\{.*\})/.exec(outReal)?.[1] || outReal.slice(-400)})`);
      }

      const afterSrc = await readFile(path.join(root, 'js', 'auth-native.js'), 'utf8');
      assert(afterSrc === realSrc, '[13v] the TRACKED js/auth-native.js is byte-identical after both mutation proofs (scratch copies only)');
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════
// [14] RG-234 — bug B-e part 3: the freeze RG-233's bound did not cover.
//
// Drew, real iPhone, 2026-09-23, with RG-232 + RG-233 merged (main 5a7e302):
// tapping "Continue with Google" STILL froze on "Connecting to Google…" — no
// sheet, and critically NO MESSAGE well past 20s. RG-233's bound is 20s and
// covers `signInWithOAuth()` only, so whatever wedged was NOT inside it.
//
// Two windows in the same flow had no timer over them at all:
//   (1) `await import('./auth-native.js')` in app.js's click handler — on native
//       that resolves through the capacitor:// scheme handler; a stalled or
//       silently-404'd module request never settles AND never throws.
//   (2) `await BrowserPlugin.open(...)` in auth-native.js — below the 120s flow
//       timer's arming, and that timer rejects `flow`, which nothing is awaiting
//       while we are parked on the open() call. Its rejection reaches no UI.
//
// Both leave exactly what Drew saw. This section proves each one now produces a
// message and a usable button, that the watchdog stands DOWN once the sheet is up
// (so a real human-paced sign-in is never interrupted), and that a late settle
// after expiry cannot repaint over the watchdog's UI.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[14] RG-234 — the unbounded import + unbounded Browser.open windows…');
{
  const appSrc14 = await readFile(path.join(root, 'js', 'app.js'), 'utf8');

  // ── The gate handler, run for real in a child process, with ./auth-native.js
  //    replaced by a per-scenario stub module served from the loader's memory
  //    (nothing is ever written under cfb-pickems/js/ — F5's rule).
  const extractBody = src => {
    const anchor = "btn?.addEventListener('click', async () => {";
    const start = src.indexOf(anchor);
    if (start === -1) return null;
    let idx = start + anchor.length, depth = 1;
    while (depth > 0 && idx < src.length) {
      const ch = src[idx];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      idx++;
    }
    return src.slice(start + anchor.length, idx - 1);
  };
  const line = re => (appSrc14.match(re) || [null])[0];
  const body14 = extractBody(appSrc14);
  const liveElLine14 = line(/^\s*const liveEl = .*$/m);
  const clickSeqLine14 = line(/^\s*let clickSeq = 0;.*$/m);
  const nativeModLine14 = line(/^\s*let nativeAuthMod = null;.*$/m);
  const wdMsgLine14 = line(/^\s*export const NATIVE_SIGNIN_WATCHDOG_MESSAGE = .*$/m);
  const wdConstLine14 = line(/^\s*const NATIVE_SIGNIN_WATCHDOG_MS = .*$/m);
  const wdOverrideLine14 = line(/^\s*let _nativeSignInWatchdogMsOverride = .*$/m);
  const wdGetterLine14 = line(/^\s*function _getNativeSignInWatchdogMs\(\) .*$/m);
  const showMessageSrc14 = (() => {
    const anchor = 'const showMessage = (text, tone) => {';
    const at = appSrc14.indexOf(anchor);
    if (at === -1) return null;
    let depth = 1, i = appSrc14.indexOf('{', at) + 1;
    while (depth > 0 && i < appSrc14.length) {
      if (appSrc14[i] === '{') depth++;
      else if (appSrc14[i] === '}') depth--;
      i++;
    }
    return appSrc14.slice(at, i) + ';';
  })();
  assert(!!body14, '[14-pre1] fixture: the click handler body was extracted from js/app.js');
  assert(!!nativeModLine14, '[14-pre2] fixture: showGoogleSignInGate()\'s `nativeAuthMod` binding was found (the watchdog cancels a stalled flow off it, never via a fresh import)');
  assert(!!wdMsgLine14 && !!wdConstLine14 && !!wdOverrideLine14 && !!wdGetterLine14,
    '[14-pre3] fixture: the watchdog constant, override, getter and player-facing sentence were all extracted from js/app.js');
  assert(!!liveElLine14 && !!clickSeqLine14 && !!showMessageSrc14, '[14-pre4] fixture: liveEl/clickSeq/showMessage extracted');

  const buildHarnessSrc = (bodySrc) => [
    "import { getAuthPath } from './platform.js';",
    "import { signInWithGoogle } from './auth.js';",
    "let btn = null, label = null, msgEl = null;",
    "export function installNodes(b, l, m) { btn = b; label = l; msgEl = m; }",
    (wdConstLine14 || 'const NATIVE_SIGNIN_WATCHDOG_MS = 25000;'),
    (wdOverrideLine14 || 'let _nativeSignInWatchdogMsOverride = null;'),
    (wdGetterLine14 || 'function _getNativeSignInWatchdogMs() { return NATIVE_SIGNIN_WATCHDOG_MS; }'),
    (wdMsgLine14 || "export const NATIVE_SIGNIN_WATCHDOG_MESSAGE = 'Sign-in is taking too long — try again.';").replace(/^\s*export /, ''),
    // Test-only glue (installNodes()'s own precedent) so a RED/GREEN proof does
    // not have to wait the real 25s.
    "export function __setWatchdogMsForTest(ms) { _nativeSignInWatchdogMsOverride = ms; }",
    (nativeModLine14 || 'let nativeAuthMod = null;'),
    clickSeqLine14,
    liveElLine14,
    showMessageSrc14,
    "export async function runClickHandler() {",
    bodySrc,
    "}",
  ].join('\n');

  const STUB_HANG_IMPORT = 'await new Promise(() => {}); // never finishes evaluating: the import never settles';
  const STUB_HANG_BEFORE_SHEET = [
    "export function cancelPendingNativeSignIn() { return false; }",
    "export function ensureNativeSignInListeners() { return true; }",
    // Never opens a sheet, never settles — a wedged Browser.open() as app.js sees it.
    "export async function signInWithGoogleNative() { return new Promise(() => {}); }",
  ].join('\n');
  const STUB_HANG_AFTER_SHEET = [
    "export function cancelPendingNativeSignIn() { return false; }",
    "export function ensureNativeSignInListeners() { return true; }",
    // The sheet DID present — the player is now reading a Google page, which is
    // bounded by auth-native.js's own 120s flow timeout, not by the gate.
    "export async function signInWithGoogleNative(opts) { opts && opts.onSheetOpened && opts.onSheetOpened(); return new Promise(() => {}); }",
  ].join('\n');
  const STUB_LATE_REJECT = [
    "export function cancelPendingNativeSignIn() { return false; }",
    "export function ensureNativeSignInListeners() { return true; }",
    "export async function signInWithGoogleNative() {",
    "  await new Promise(r => setTimeout(r, 250));",
    "  const e = new Error('late failure'); e.userMessage = 'LATE-MESSAGE-MUST-NOT-APPEAR'; throw e;",
    "}",
  ].join('\n');

  async function runGateScenario({ harnessSrc, stubSrc, watchdogMs = 80, waitMs = 500 }) {
    const virtualHarnessUrl = new URL('./js/__authnativetest_rg234_harness__.mjs', import.meta.url).href;
    const loaderSrc = [
      "export async function resolve(specifier, context, nextResolve) {",
      "  if (specifier === " + JSON.stringify(virtualHarnessUrl) + ") return { url: specifier, shortCircuit: true };",
      "  return nextResolve(specifier, context);",
      "}",
      "export async function load(url, context, nextLoad) {",
      "  if (url === " + JSON.stringify(virtualHarnessUrl) + ") return { format: 'module', source: " + JSON.stringify(harnessSrc) + ", shortCircuit: true };",
      "  if (url.endsWith('auth-native.js')) return { format: 'module', source: " + JSON.stringify(stubSrc) + ", shortCircuit: true };",
      "  return nextLoad(url, context);",
      "}",
    ].join('\n');
    const child = [
      "import { register } from 'node:module';",
      `register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(loaderSrc)}), import.meta.url);`,
      "const store = new Map();",
      "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
      "globalThis.window = { Capacitor: { isNativePlatform: () => true } }; globalThis.location = { protocol: 'capacitor:' };",
      "const harness = await import(process.env.HARNESS_URL);",
      "harness.__setWatchdogMsForTest(Number(process.env.WATCHDOG_MS));",
      "const b = { disabled: false, isConnected: true };",
      "const l = { isConnected: true, textContent: 'Continue with Google' };",
      "const m = { isConnected: true, style: { display: 'none' }, className: '', textContent: '' };",
      "const nodes = { 'google-gate-submit': b, 'google-gate-btn-label': l, 'google-gate-message': m };",
      "globalThis.document = { getElementById: id => nodes[id] || null };",
      "harness.installNodes(b, l, m);",
      // NOT awaited: several scenarios deliberately never settle (that is the
      // whole point). Sample the DOM after a fixed wait instead.
      "const started = harness.runClickHandler(); started.then(() => {}, () => {});",
      "await new Promise(r => setTimeout(r, Number(process.env.WAIT_MS)));",
      "console.log('RG234-DONE:' + JSON.stringify({ msgText: m.textContent, msgShown: m.style.display, btnDisabled: b.disabled, labelText: l.textContent }));",
      "process.exit(0);",
    ].join('\n');
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, HARNESS_URL: virtualHarnessUrl, WATCHDOG_MS: String(watchdogMs), WAIT_MS: String(waitMs) },
    });
    const out = `${run.stdout || ''}${run.stderr || ''}`;
    const mm = /RG234-DONE:(\{.*\})/.exec(out);
    let parsed = null;
    if (mm) { try { parsed = JSON.parse(mm[1]); } catch { /* the assertions report it */ } }
    return { out, parsed, status: run.status };
  }

  const realHarness = buildHarnessSrc(body14 || '');
  const WATCHDOG_COPY = 'Sign-in is taking too long — try again.';

  // ── (1) THE HUNG DYNAMIC IMPORT — Drew's window #1.
  {
    const r = await runGateScenario({ harnessSrc: realHarness, stubSrc: STUB_HANG_IMPORT });
    assert(r.status === 0 && !!r.parsed, `[14a-fixture] the hung-import scenario child exits cleanly (status ${r.status})${r.parsed ? '' : '\n' + r.out.slice(-700)}`);
    assert(!!r.parsed && r.parsed.msgText === WATCHDOG_COPY && r.parsed.msgShown === 'block',
      `[14a] a dynamic import of ./auth-native.js that NEVER settles now produces the player-facing "${WATCHDOG_COPY}" in the visible message slot (got ${JSON.stringify(r.parsed && r.parsed.msgText)}, display=${JSON.stringify(r.parsed && r.parsed.msgShown)})`);
    assert(!!r.parsed && r.parsed.btnDisabled === false, `[14b] …and the button is usable again (got disabled=${JSON.stringify(r.parsed && r.parsed.btnDisabled)})`);
    assert(!!r.parsed && r.parsed.labelText === 'Continue with Google',
      `[14c] …and the label is no longer stuck on "Connecting to Google…" (got ${JSON.stringify(r.parsed && r.parsed.labelText)})`);
  }

  // ── (2) A WEDGE PAST THE IMPORT, BEFORE THE SHEET — Drew's window #2 as the
  //    gate sees it (auth-native.js's own Browser.open bound is proved live below).
  {
    const r = await runGateScenario({ harnessSrc: realHarness, stubSrc: STUB_HANG_BEFORE_SHEET });
    assert(!!r.parsed && r.parsed.msgText === WATCHDOG_COPY && r.parsed.btnDisabled === false,
      `[14d] a signInWithGoogleNative() that never settles and never opens a sheet also reaches the watchdog message with a usable button (got ${JSON.stringify(r.parsed)})`);
  }

  // ── The watchdog STANDS DOWN once the sheet is up: a human-paced sign-in must
  //    never be interrupted by it.
  {
    const r = await runGateScenario({ harnessSrc: realHarness, stubSrc: STUB_HANG_AFTER_SHEET });
    assert(!!r.parsed && r.parsed.msgText === '' && r.parsed.msgShown === 'none',
      `[14e] once onSheetOpened() fires, the watchdog is disarmed — NO message appears even though the flow is still pending long past the bound (got ${JSON.stringify(r.parsed && r.parsed.msgText)})`);
    assert(!!r.parsed && r.parsed.btnDisabled === true && r.parsed.labelText === 'Connecting to Google…',
      `[14f] …and the gate correctly stays in its connecting state behind the sheet (got disabled=${JSON.stringify(r.parsed && r.parsed.btnDisabled)}, label=${JSON.stringify(r.parsed && r.parsed.labelText)})`);
  }

  // ── A LATE settle after expiry is IGNORED.
  {
    const r = await runGateScenario({ harnessSrc: realHarness, stubSrc: STUB_LATE_REJECT, watchdogMs: 60, waitMs: 600 });
    assert(!!r.parsed && r.parsed.msgText === WATCHDOG_COPY,
      `[14g] a rejection that arrives AFTER the watchdog expired does not repaint over it — the watchdog's sentence still stands (got ${JSON.stringify(r.parsed && r.parsed.msgText)})`);
    assert(!!r.parsed && !/LATE-MESSAGE-MUST-NOT-APPEAR/.test(String(r.parsed.msgText || '')),
      '[14h] …and the late failure\'s own userMessage never reaches the player');
  }

  // ── RED PROOF, in memory only: the same hung import with the watchdog ARMING
  //    removed from the extracted body reproduces Drew's report exactly. The
  //    tracked js/app.js is never touched (the mutation is a string in this
  //    process; CLAUDE.md's no-checkout/no-restore rule is not even in play).
  {
    const mutatedBody = (body14 || '').replace(
      /if \(nativePath\) \{\n\s*watchdogTimer = setTimeout\(\(\) => \{[\s\S]*?\}, _getNativeSignInWatchdogMs\(\)\);\n\s*\}/,
      '/* MUTATION: watchdog arming removed */'
    );
    assert(mutatedBody !== body14, '[14i-fixture] the watchdog-removal mutation actually changed the extracted handler body (a no-op replace would make this RED-proof vacuous)');
    const r = await runGateScenario({ harnessSrc: buildHarnessSrc(mutatedBody), stubSrc: STUB_HANG_IMPORT });
    assert(!!r.parsed && r.parsed.msgShown === 'none' && r.parsed.btnDisabled === true && r.parsed.labelText === 'Connecting to Google…',
      `[14i] RED-proof: without the watchdog, a hung import leaves the button DISABLED on "Connecting to Google…" with NO message — Drew's report, verbatim (got ${JSON.stringify(r.parsed)})`);
  }

  // ── Structural pins on js/app.js.
  assert(/onSheetOpened: disarmWatchdog/.test(appSrc14),
    '[14j] the gate passes `onSheetOpened: disarmWatchdog` into signInWithGoogleNative() — the ONE signal that ends the watchdog window');
  assert(/if \(watchdogFired\) return;/.test(appSrc14),
    '[14k] a settle after expiry is explicitly ignored rather than allowed to repaint');
  assert(appSrc14.indexOf('watchdogTimer = setTimeout') < appSrc14.indexOf("const nativeAuth = await import('./auth-native.js')"),
    '[14l] the watchdog is armed BEFORE the dynamic import, so the import itself is inside the covered window');

  // ── auth-native.js: Browser.open() is bounded, live.
  {
    const authNative = await import('./js/auth-native.js');
    authNative._resetNativeAuthForTest({ sheetOpenTimeoutMs: 60 });
    const appListeners = {};
    globalThis.window = globalThis.window || {};
    globalThis.window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Browser: { open() { return new Promise(() => {}); }, async close() {} }, // never presents, never returns
        App: { addListener(type, fn) { (appListeners[type] = appListeners[type] || []).push(fn); } },
      },
    };
    const { client } = makeFakeClient();
    await withFakeAuthModule(client, async () => {
      const t0 = Date.now();
      let caught = null;
      try {
        await Promise.race([
          authNative.signInWithGoogleNative(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TEST-WATCHDOG: still hanging after 3s')), 3000)),
        ]);
      } catch (e) { caught = e; }
      assert(!!caught && !/TEST-WATCHDOG/.test(String(caught.message)),
        `[14m] a Browser.open() that never returns now rejects on its own bound instead of parking forever (got ${caught ? caught.message : 'no rejection at all'})`);
      assert(!!caught && caught.userMessage === "Couldn't open the Google sign-in page — try again.",
        `[14n] …carrying its own player-facing sentence, distinct from the signInWithOAuth one (got ${JSON.stringify(caught && caught.userMessage)})`);
      assert(Date.now() - t0 < 2000, `[14o] …on the injectable bound, promptly (took ${Date.now() - t0}ms)`);
      assert(authNative._isPendingForTest() === false, '[14p] …and no pending flow is left behind to poison the next tap');
    });
    authNative._resetNativeAuthForTest();
  }

  // ── onSheetOpened fires exactly once, after the sheet is actually up; and the
  //    (d) breadcrumbs are emitted at every stage boundary, NAMES ONLY.
  {
    const authNative = await import('./js/auth-native.js');
    authNative._resetNativeAuthForTest();
    const bridge = makeFakeBridge();
    bridge.install();
    const { client } = makeFakeClient();
    const warned = [];
    const realWarn = console.warn;
    console.warn = (...a) => { warned.push(a.join(' ')); };
    try {
      await withFakeAuthModule(client, async () => {
        let sheetOpenedCalls = 0;
        const flow = authNative.signInWithGoogleNative({ onSheetOpened: () => { sheetOpenedCalls++; } });
        await new Promise(r => setTimeout(r, 10));
        assert(sheetOpenedCalls === 1, `[14q] onSheetOpened fired exactly once, after Browser.open() resolved (got ${sheetOpenedCalls})`);
        bridge.fireAppUrlOpen('munera://auth/callback?code=rg234-code');
        await flow;
        assert(sheetOpenedCalls === 1, `[14r] …and not again for the rest of the flow (got ${sheetOpenedCalls})`);
      });
    } finally { console.warn = realWarn; }
    const joined = warned.join('\n');
    for (const stage of ['oauth-url-requested', 'oauth-url-built', 'sheet-opened', 'deep-link-received', 'code-exchanged']) {
      assert(joined.includes('[auth-native][stage] ' + stage), `[14s:${stage}] breadcrumb "${stage}" is emitted at its stage boundary`);
    }
    assert(!/accounts\.google\.com/.test(joined) && !/rg234-code/.test(joined),
      `[14t] no breadcrumb carries a URL, a code or any other value — names only (breadcrumbs seen: ${joined.replace(/\n/g, ' | ').slice(0, 300)})`);
    authNative._resetNativeAuthForTest();
  }

  // ── Every failure mode is classifiable by the gate: cancel-shaped, or carrying
  //    its own userMessage. Never "reject with nothing the player can read."
  {
    const authNative = await import('./js/auth-native.js');
    const classify = err => {
      const msg = String(err?.message || err || '');
      if (/cancel|closed|popup/i.test(msg)) return 'cancel';
      if (err && typeof err.userMessage === 'string' && err.userMessage) return 'userMessage';
      return 'generic-fallback';
    };
    const cases = [];

    // no bridge at all
    authNative._resetNativeAuthForTest();
    globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };
    {
      const { client } = makeFakeClient();
      await withFakeAuthModule(client, async () => {
        try { await authNative.signInWithGoogleNative(); } catch (e) { cases.push(['no-bridge', classify(e)]); }
      });
    }
    // signInWithOAuth returns no URL
    authNative._resetNativeAuthForTest();
    {
      const bridge = makeFakeBridge(); bridge.install();
      const { client } = makeFakeClient({ signInWithOAuth: async () => ({ data: {}, error: null }) });
      await withFakeAuthModule(client, async () => {
        try { await authNative.signInWithGoogleNative(); } catch (e) { cases.push(['no-url', classify(e)]); }
      });
    }
    // signInWithOAuth returns an error
    authNative._resetNativeAuthForTest();
    {
      const bridge = makeFakeBridge(); bridge.install();
      const { client } = makeFakeClient({ signInWithOAuth: async () => ({ data: null, error: new Error('network down') }) });
      await withFakeAuthModule(client, async () => {
        try { await authNative.signInWithGoogleNative(); } catch (e) { cases.push(['oauth-error', classify(e)]); }
      });
    }
    // the callback link carries ?error=
    authNative._resetNativeAuthForTest();
    {
      const bridge = makeFakeBridge(); bridge.install();
      const { client } = makeFakeClient();
      await withFakeAuthModule(client, async () => {
        const flow = authNative.signInWithGoogleNative();
        await new Promise(r => setTimeout(r, 10));
        bridge.fireAppUrlOpen('munera://auth/callback?error=access_denied&error_description=Google%20said%20no');
        try { await flow; } catch (e) { cases.push(['callback-error', classify(e)]); }
      });
    }
    // the callback link carries no code
    authNative._resetNativeAuthForTest();
    {
      const bridge = makeFakeBridge(); bridge.install();
      const { client } = makeFakeClient();
      await withFakeAuthModule(client, async () => {
        const flow = authNative.signInWithGoogleNative();
        await new Promise(r => setTimeout(r, 10));
        bridge.fireAppUrlOpen('munera://auth/callback');
        try { await flow; } catch (e) { cases.push(['callback-no-code', classify(e)]); }
      });
    }
    // exchangeCodeForSession fails
    authNative._resetNativeAuthForTest();
    {
      const bridge = makeFakeBridge(); bridge.install();
      const { client } = makeFakeClient({ exchangeCodeForSession: async () => ({ data: null, error: new Error('bad grant') }) });
      await withFakeAuthModule(client, async () => {
        const flow = authNative.signInWithGoogleNative();
        await new Promise(r => setTimeout(r, 10));
        bridge.fireAppUrlOpen('munera://auth/callback?code=will-fail');
        try { await flow; } catch (e) { cases.push(['exchange-error', classify(e)]); }
      });
    }
    // the player dismissed the sheet
    authNative._resetNativeAuthForTest();
    {
      const bridge = makeFakeBridge(); bridge.install();
      const { client } = makeFakeClient();
      await withFakeAuthModule(client, async () => {
        const flow = authNative.signInWithGoogleNative();
        await new Promise(r => setTimeout(r, 10));
        bridge.fireBrowserFinished();
        try { await flow; } catch (e) { cases.push(['cancelled', classify(e)]); }
      });
    }
    authNative._resetNativeAuthForTest();

    assert(cases.length === 7, `[14u-fixture] all seven failure modes actually rejected and were classified (got ${cases.length}: ${JSON.stringify(cases)})`);
    const unreadable = cases.filter(([, kind]) => kind === 'generic-fallback');
    assert(unreadable.length === 0,
      `[14u] every failure mode reaches the player as either a cancel notice or its OWN sentence — none falls through to the generic "couldn't complete" (offenders: ${JSON.stringify(unreadable)}; all: ${JSON.stringify(cases)})`);
    assert(cases.find(([n]) => n === 'cancelled')?.[1] === 'cancel',
      '[14v] …and a dismissed sheet is still classified as CANCEL (a neutral notice), never dressed up as an error');
  }

  // ── Structural + mutation proof for the Browser.open bound.
  {
    const nativeSrc = await readFile(path.join(root, 'js', 'auth-native.js'), 'utf8');
    assert(/_withTimeout\(openPromise, _sheetOpenTimeoutMs, OAUTH_SHEET_TIMEOUT_MESSAGE\)/.test(nativeSrc),
      '[14w] the Browser.open() await goes through the bound, not a bare await');

    const scratchDir14 = await mkdtemp(path.join(tmpdir(), 'cfbp-authnative-rg234-'));
    const rewrite = src => src.replace(/(from\s+')(\.\/[^']+)(')/g, (whole, pre, rel, post) =>
      pre + new URL(`./js/${rel.slice(2)}`, import.meta.url).href + post);
    try {
      const mutated = nativeSrc.replace(
        'await _withTimeout(openPromise, _sheetOpenTimeoutMs, OAUTH_SHEET_TIMEOUT_MESSAGE);',
        'await openPromise; // MUTATION: Browser.open bound removed'
      );
      assert(mutated !== nativeSrc, '[14x-fixture] the bound-removal mutation actually changed the source');
      const scratch = path.join(scratchDir14, '__mutation_scratch_auth_native_nosheetbound.js');
      await writeFile(scratch, rewrite(mutated), 'utf8');
      const child = [
        "const store = new Map();",
        "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
        // Browser.open() never returns — the device shape this bound exists for.
        "globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Browser: { open() { return new Promise(() => {}); }, async close() {} }, App: { addListener() {} } } }, supabase: { createClient: () => ({ auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } }, signInWithOAuth: async () => ({ data: { url: 'https://accounts.google.com/fake' }, error: null }), exchangeCodeForSession: async () => ({ data: {}, error: null }) } }) } };",
        "globalThis.location = { protocol: 'capacitor:' };",
        "const auth = await import(process.env.AUTH_URL);",
        "auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });",
        "const mod = await import(process.env.MOD_URL);",
        "mod._resetNativeAuthForTest({ sheetOpenTimeoutMs: 80 });",
        "let settled = 'NO';",
        "mod.signInWithGoogleNative().then(() => { settled = 'RESOLVED'; }, () => { settled = 'REJECTED'; });",
        "await new Promise(r => setTimeout(r, 500));",
        "console.log('MUTATION14 settled=' + settled);",
        "process.exit(0);",
      ].join('\n');
      const envBase = { ...process.env, AUTH_URL: new URL('./js/auth.js', import.meta.url).href };
      const runMut = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 20000, env: { ...envBase, MOD_URL: new URL(`file://${scratch}`).href },
      });
      const outMut = `${runMut.stdout || ''}${runMut.stderr || ''}`;
      assert(/MUTATION14 settled=NO/.test(outMut),
        `[14x] RED-proof: with the Browser.open bound removed, a wedged open() never settles — the gate would sit on "Connecting to Google…" forever with no sheet and no message (got ${/MUTATION14 settled=(\w+)/.exec(outMut)?.[1] || outMut.slice(-400)})`);

      const runReal = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 20000, env: { ...envBase, MOD_URL: new URL('./js/auth-native.js', import.meta.url).href },
      });
      const outReal = `${runReal.stdout || ''}${runReal.stderr || ''}`;
      assert(/MUTATION14 settled=REJECTED/.test(outReal),
        `[14y-control] the REAL module rejects the same wedged open() on its bound (got ${/MUTATION14 settled=(\w+)/.exec(outReal)?.[1] || outReal.slice(-400)})`);

      const afterSrc = await readFile(path.join(root, 'js', 'auth-native.js'), 'utf8');
      assert(afterSrc === nativeSrc, '[14z] the TRACKED js/auth-native.js is byte-identical after the mutation proof (scratch copy only)');
      const afterApp = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
      assert(afterApp === appSrc14, '[14z2] the TRACKED js/app.js is byte-identical too — its RED-proof mutated a string in memory, never a file');
    } finally {
      await rm(scratchDir14, { recursive: true, force: true });
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════
// [15] RG-234 — THE GATE THAT NEVER CAME DOWN (app.js's session-event decision).
//
// Drew's device console showed the native sign-in COMPLETING in full — deep link,
// exchange, Keychain write, "[auth] identity changed (event:SIGNED_IN)",
// MEMBERSHIPS_REFRESHED, hydrate — with the gate still on screen saying
// "Connecting to Google…". app.js's handler decided `signedIn` from the
// localStorage MIRROR (hasValidSupabaseSession()), which on native is a marker
// written elsewhere, so at the instant the handler ran the answer was "nobody".
// The else branch then found the overlay already present and deliberately left it
// (it must not wipe a "Sign-in cancelled." message), and no later event retried —
// MEMBERSHIPS_REFRESHED is not in AUTH_SESSION_EVENTS.
//
// The primary fix is in the adapter (authstoragenativetest [21]: the marker now
// lands inside the setItem the SDK awaits BEFORE notifying anyone). This section
// covers the SECOND, independent guard: the event's own payload IS the session, so
// a native event carrying a FRESH one takes the gate down even if the mirror lags.
// The real predicate is extracted from js/app.js and evaluated here — no
// hand-written copy of it, so a change to the shipped line changes this test.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[15] RG-234 — a completed native sign-in always takes the gate down…');
{
  const appSrc15 = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  const predSrc = (appSrc15.match(/const payloadSessionFresh = [\s\S]*?const signedIn = .*;/) || [null])[0];
  assert(!!predSrc, '[15-pre1] fixture: the real `signedIn` decision was extracted from js/app.js');
  assert(!!predSrc && /hasValidSupabaseSession\(\)/.test(predSrc) && /isNativeOrigin\(\)/.test(predSrc),
    '[15-pre2] fixture: it still reads the mirror AND is origin-positive (isNativeOrigin(), never isNativeShell())');

  async function evalPredicate(src, { payload, native, markerValid }) {
    const mod = [
      "let _payload = null, _native = false, _marker = false;",
      "export function setup(p, n, m) { _payload = p; _native = n; _marker = m; }",
      "function hasValidSupabaseSession() { return _marker; }",
      "function isNativeOrigin() { return _native; }",
      "export function decide() {",
      "  const payload = _payload;",
      src,
      "  return signedIn;",
      "}",
    ].join('\n');
    const m = await import('data:text/javascript,' + encodeURIComponent(mod));
    m.setup(payload, native, markerValid);
    return m.decide();
  }

  const fresh = { access_token: 'a.real.jwt', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const expired = { access_token: 'a.real.jwt', expires_at: Math.floor(Date.now() / 1000) - 60 };
  const noToken = { expires_at: Math.floor(Date.now() / 1000) + 3600 };

  // THE CASE DREW HIT.
  assert(await evalPredicate(predSrc, { payload: fresh, native: true, markerValid: false }) === true,
    '[15a] NATIVE, a SIGNED_IN carrying a FRESH session, mirror not yet written → signedIn TRUE, so the gate comes down (Drew\'s exact case)');
  // The RED control: the pre-fix predicate on the very same inputs.
  assert(await evalPredicate('const signedIn = !!payload && hasValidSupabaseSession();', { payload: fresh, native: true, markerValid: false }) === false,
    '[15b] RED-proof: the PRE-FIX predicate answered FALSE on those same inputs — the gate stayed up on a completed sign-in, which is exactly what Drew reported');

  // Nothing looser than "a fresh session" is ever accepted.
  assert(await evalPredicate(predSrc, { payload: expired, native: true, markerValid: false }) === false,
    '[15c] NATIVE, an EXPIRED session in the payload (an INITIAL_SESSION off old storage) → still FALSE: the same freshness test the mirror gets, never "a payload exists"');
  assert(await evalPredicate(predSrc, { payload: noToken, native: true, markerValid: false }) === false,
    '[15d] NATIVE, a payload with no access_token → FALSE');
  assert(await evalPredicate(predSrc, { payload: null, native: true, markerValid: true }) === false,
    '[15e] no payload at all → FALSE, unchanged (a null-session event must never take the gate down — the bug that predates this one)');

  // WEB IS UNTOUCHED: the new term is native-scoped, so web behavior is exactly
  // `!!payload && hasValidSupabaseSession()` on every input.
  for (const [name, payload, markerValid] of [
    ['fresh payload, mirror not written', fresh, false],
    ['fresh payload, mirror written', fresh, true],
    ['expired payload, mirror written', expired, true],
    ['no payload', null, true],
  ]) {
    const now = await evalPredicate(predSrc, { payload, native: false, markerValid });
    const before = await evalPredicate('const signedIn = !!payload && hasValidSupabaseSession();', { payload, native: false, markerValid });
    assert(now === before, `[15f:${name}] WEB: the decision is IDENTICAL to the pre-fix predicate (now=${now}, before=${before})`);
  }

  // Structural: the gate removal still happens inside this decision, and the
  // hold-gate rule (A7) is untouched.
  assert(/if \(signedIn\) \{[\s\S]*?if \(!currentAuthHoldReason\(\)\) document\.getElementById\('site-gate-overlay'\)\?\.remove\(\);/.test(appSrc15),
    '[15g] the overlay removal still sits inside `if (signedIn)` and still refuses to take a HOLD gate down (A7 unchanged)');
  assert(/if \(nativePath\) restoreIdle\(\);/.test(appSrc15),
    '[15h] a successful NATIVE sign-in also restores the button to "Continue with Google" — the flow resolves in-page there, so nothing else would ever repaint it');
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
