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

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
      "const seen = new Set();",
      "const handler = { get(t, k) { seen.add(String(k)); return t[k]; }, set(t, k, v) { seen.add(String(k)); t[k]=v; return true; } };",
      "globalThis.window = new Proxy({}, handler);",
      `await import(${JSON.stringify(url)});`,
      "console.log('TOUCHED-KEYS:' + JSON.stringify([...seen].sort()));",
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
    assert(extra.length === 0,
      `[9g] importing js/auth-native.js touches NO window property beyond what importing js/auth.js ALONE already touches — auth-native.js's own top-level code adds zero side effects (baseline=${JSON.stringify([...baselineKeys])}, native=${JSON.stringify([...nativeKeys])}, extra=${JSON.stringify(extra)})`);
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
    const harnessSrc = [
      "import { getAuthPath } from './platform.js';",
      "import { signInWithGoogle } from './auth.js';",
      "export async function runClickHandler(btn, label, msgEl, showMessage) {",
      body,
      "}",
    ].join('\n');

    async function runScenario({ native }) {
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
        "    result.source = text.replace(",
        "      'export async function signInWithGoogleNative() {',",
        "      'export async function signInWithGoogleNative() { globalThis.__CALLED_NATIVE__ = true;'",
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
        "const btn = { disabled: false };",
        "const label = { _t: '', set textContent(v) { this._t = v; }, get textContent() { return this._t; } };",
        "const msgEl = { style: { display: 'none' } };",
        "const messages = [];",
        "const showMessage = (text, tone) => { messages.push({ text, tone }); };",
        "let caught = null;",
        "try { await harness.runClickHandler(btn, label, msgEl, showMessage); } catch (e) { caught = e; }",
        "console.log('SCENARIO-DONE:' + JSON.stringify({ messages, caughtInBody: caught ? String(caught.message || caught) : null, calledNative: globalThis.__CALLED_NATIVE__ === true }));",
      ].join('\n');
      const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
        encoding: 'utf8', timeout: 15000, env: { ...process.env, HARNESS_URL: virtualHarnessUrl },
      });
      const out = `${run.stdout || ''}${run.stderr || ''}`;
      return { out, status: run.status, sawAuthNative: /LOADER-SAW-AUTH-NATIVE/.test(out), calledNative: /"calledNative":true/.test(out) };
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
    assert(/Google sign-in couldn.t complete/.test(nativeRun.out),
      `[10g] NATIVE: the click handler's catch actually ran too — the same generic error notice, proving the whole try/catch executed end to end on this branch as well (got: ${nativeRun.out.slice(-400)})`);

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

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
