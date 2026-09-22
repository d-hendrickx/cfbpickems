/**
 * js/auth-native.js — native (Capacitor/iOS) Google sign-in, PATH A (DI-208e,
 * security condition 3: PATH A is REQUIRED). NEW, EXCLUSIVE file — the
 * Supabase thread's js/auth.js is never edited by this module; every session
 * write goes through auth.js's own client and its own onAuthStateChange
 * chain, exactly as the web PKCE flow already does.
 *
 * Loaded ONLY on native, via a dynamic `import()` behind `getAuthPath()===
 * 'native'` in js/app.js's showGoogleSignInGate() — never imported anywhere
 * in the statically-analyzable web module graph, so it is never fetched or
 * precached by service-worker.js's STATIC_ASSETS list (which is off-limits
 * to this pass) and never requested on a plain web boot (proved by
 * authnativetest.mjs's loader-based test).
 *
 * Mechanism (Supabase `signInWithOAuth({skipBrowserRedirect:true})` → the
 * SYSTEM browser sheet via the Browser plugin → a custom-scheme redirect
 * caught by the App plugin's `appUrlOpen` listener →
 * `exchangeCodeForSession(code)` on the SAME client auth.js already owns).
 * Reached ONLY off the runtime global `window.Capacitor.Plugins.<Name>` —
 * DI-208a's spike proved this is enough; no import of the npm-published
 * Capacitor core package (js/platform.js's own header comment uses this
 * same phrasing) exists anywhere in `cfb-pickems/`, and this file adds none
 * (grep-proved by authnativetest.mjs).
 *
 * THE CALLBACK SCHEME is a constant, defined exactly once, independent of
 * the still-undecided bundle id:
 */
import { getSupabaseClient } from './auth.js';

const CALLBACK_SCHEME = 'munera';
const CALLBACK_HOST = 'auth';
const CALLBACK_PATH = '/callback';
/** The literal redirect URL passed to signInWithOAuth() — exported for
 *  tests/Drew's runbook so nobody has to reconstruct it from the three
 *  pieces above and risk a typo diverging from what's actually sent. */
export const NATIVE_CALLBACK_URL = `${CALLBACK_SCHEME}://${CALLBACK_HOST}${CALLBACK_PATH}`;

// Two minutes is generous for a real human to complete a Google sign-in in
// the system browser sheet, but still bounded — security condition 5's "no
// retry loop" pairs with "no infinite wait" here: a flow that never gets a
// deep link back (crashed browser, killed app, a redirect that silently
// failed) must eventually return the gate to idle rather than leaving the
// button disabled with "Connecting to Google…" forever.
const DEFAULT_FLOW_TIMEOUT_MS = 120000;
let _flowTimeoutMs = DEFAULT_FLOW_TIMEOUT_MS;

// ── Module-scoped flow state — ONE in-flight sign-in at a time ─────────────
let _listenersRegistered = false;
let _pendingActive = false;   // a signInWithGoogleNative() call is awaiting its deep link
let _exchanged = false;       // exchangeCodeForSession() has already been called for THIS flow
let _pendingResolve = null;
let _pendingReject = null;
let _timeoutId = null;

/**
 * Accepts ONLY a URL whose scheme+host+path exactly match
 * `munera://auth/callback` — no `startsWith`, no partial match. Rejects
 * look-alikes (`munera://auth/callback.evil`, `munera://evil/auth/callback`,
 * any `https://` URL, anything with a different path) by construction:
 * every one of the three pieces must match exactly, and `URL` parsing itself
 * rejects a malformed string outright (caught, treated as no-match).
 * Exported for direct unit testing (authnativetest.mjs) — this predicate is
 * the whole security boundary the deep-link listener trusts.
 */
export function _matchesNativeCallback(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr) return false;
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  return u.protocol === `${CALLBACK_SCHEME}:`
    && u.hostname === CALLBACK_HOST
    && u.pathname === CALLBACK_PATH;
}

function _capacitorPlugins() {
  return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins) || null;
}

function _closeBrowser() {
  try { _capacitorPlugins()?.Browser?.close?.(); } catch { /* best-effort — never block on this */ }
}

/** Settles the ONE in-flight promise (resolve or reject) and clears every
 *  piece of per-flow state together, so a stray SECOND event after settling
 *  finds `_pendingActive === false` and is dropped by the caller's own guard
 *  rather than by this function silently no-op'ing twice. */
function _settle(kind, value) {
  const resolve = _pendingResolve;
  const reject = _pendingReject;
  _pendingActive = false;
  _pendingResolve = null;
  _pendingReject = null;
  if (_timeoutId !== null) { clearTimeout(_timeoutId); _timeoutId = null; }
  if (kind === 'resolve') resolve && resolve(value);
  else reject && reject(value);
}

/**
 * Registers the ONE `appUrlOpen` listener (security condition 5 / DI-208e's
 * brief: "register ONE Capacitor.Plugins.App.addListener"), once for the
 * life of the page — never re-registered on a retried sign-in. Also listens
 * for `browserFinished` (the system browser sheet being dismissed, which
 * covers both an explicit user cancel and a timeout the OS enforces on its
 * own), which restores the gate to idle via the SAME "cancelled" shape
 * app.js's existing catch already renders for the web flow
 * (`/cancel|closed|popup/i` in the caught error's message).
 */
function _ensureListeners() {
  if (_listenersRegistered) return;
  const plugins = _capacitorPlugins();
  if (!plugins?.App?.addListener) return; // no bridge — signInWithGoogleNative() itself reports this
  _listenersRegistered = true;

  plugins.App.addListener('appUrlOpen', async (data) => {
    const url = (data && data.url) || '';
    // Not our callback at all — some other deep link entirely. Not our
    // concern; ignore silently, no error surfaced.
    if (!_matchesNativeCallback(url)) return;
    // Security condition 5 — DROPPED, no retry loop, if there is no in-flight
    // sign-in (a stray replay, a cold-launch openurl with nothing waiting) OR
    // this flow's code has already been exchanged once (the fires-twice
    // case: exchangeCodeForSession() must never run a second time for the
    // same flow).
    if (!_pendingActive || _exchanged) return;
    _exchanged = true;
    _closeBrowser();

    let parsed = null;
    try { parsed = new URL(url); } catch { /* already validated by the matcher above */ }
    const code = parsed ? parsed.searchParams.get('code') : null;
    const errParam = parsed ? parsed.searchParams.get('error') : null;
    const errDesc = parsed ? parsed.searchParams.get('error_description') : null;

    if (errParam) { _settle('reject', new Error(errDesc || errParam)); return; }
    if (!code) { _settle('reject', new Error('Native sign-in: the callback link had no authorization code.')); return; }

    const client = getSupabaseClient();
    if (!client) { _settle('reject', new Error('Native sign-in: Supabase client is not configured.')); return; }

    try {
      // The SAME client auth.js already owns — its own onAuthStateChange
      // wiring (ensureClient()) fires SIGNED_IN on a successful exchange,
      // which is what drives app.js's existing refreshAuthUI() chain. We do
      // not set any session state ourselves.
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      _settle('resolve', undefined);
    } catch (e) {
      _settle('reject', e);
    }
  });

  plugins.App.addListener('browserFinished', () => {
    // Only meaningful if we're still waiting on a code — once a flow has
    // already been settled (success OR a captured error), a browserFinished
    // that fires afterward (the sheet closing itself post-redirect) must not
    // clobber that outcome.
    if (_pendingActive && !_exchanged) {
      _settle('reject', new Error('Sign-in cancelled.'));
    }
  });
}

/**
 * `signInWithGoogleNative()` — the export `js/app.js`'s
 * `showGoogleSignInGate()` click handler calls when `getAuthPath()===
 * 'native'`. Resolves when the deep-link round trip completes and the
 * session has been established; rejects (with a message app.js's EXISTING
 * `/cancel|closed|popup/i` classification already handles) on cancel,
 * timeout, or any OAuth/network failure. Never touches `js/auth.js` beyond
 * the exports named in this file's header — `getSupabaseClient()` is the
 * ONE call in, and `exchangeCodeForSession()` on THAT SAME client is the
 * only place a session is ever written.
 */
export async function signInWithGoogleNative() {
  if (_pendingActive) throw new Error('A sign-in is already in progress.');

  const client = getSupabaseClient();
  if (!client) throw new Error('Native sign-in: Supabase client is not configured.');

  const plugins = _capacitorPlugins();
  const BrowserPlugin = plugins?.Browser;
  const AppPlugin = plugins?.App;
  if (!BrowserPlugin?.open || !AppPlugin?.addListener) {
    throw new Error("Native sign-in isn't available on this device.");
  }
  _ensureListeners();

  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_CALLBACK_URL, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data || !data.url) throw new Error('Native sign-in: Google did not return a sign-in URL.');

  _exchanged = false;
  _pendingActive = true;
  const flow = new Promise((resolve, reject) => {
    _pendingResolve = resolve;
    _pendingReject = reject;
  });
  _timeoutId = setTimeout(() => {
    if (_pendingActive) _settle('reject', new Error('Sign-in cancelled.'));
  }, _flowTimeoutMs);

  try {
    // System browser sheet — Google permits this (it does not permit an
    // in-webview navigation for OAuth); never SFSafariViewController-as-
    // in-app-webview, the actual system tab.
    await BrowserPlugin.open({ url: data.url, presentationStyle: 'popover' });
  } catch (e) {
    // _settle() rejects `flow` via `_pendingReject`, but `flow` itself is
    // thrown away below (we throw `e` directly instead of returning it) —
    // so without this, the rejected `flow` promise has no handler attached
    // anywhere and becomes an unhandled-rejection warning (CONVENTIONS #4).
    // The no-op catch here is purely to pin that orphaned promise; it does
    // not change what the caller sees, which is the synchronous `throw e`
    // immediately below.
    flow.catch(() => {});
    _settle('reject', e);
    throw e;
  }

  return flow;
}

// ── Test hooks (production code never calls these — mirrors js/auth.js's
//    own `_resetAuthForTest()` / `_setStoredSessionForTest()` convention, and
//    js/push-onesignal.js's `_resetForTest({sdkReadyMs, promptMs})` shape for
//    an injectable timing knob) ─────────────────────────────────────────────
export function _resetNativeAuthForTest({ flowTimeoutMs = DEFAULT_FLOW_TIMEOUT_MS } = {}) {
  _listenersRegistered = false;
  _pendingActive = false;
  _exchanged = false;
  if (_timeoutId !== null) { clearTimeout(_timeoutId); _timeoutId = null; }
  _pendingResolve = null;
  _pendingReject = null;
  _flowTimeoutMs = flowTimeoutMs;
}
export function _isPendingForTest() { return _pendingActive; }
export const _DEFAULT_FLOW_TIMEOUT_MS_FOR_TEST = DEFAULT_FLOW_TIMEOUT_MS;
