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

// RG-233 (2026-09-23, Drew's iPhone 16 Pro) — the 120s budget above only ever
// covered the part of the flow AFTER `signInWithOAuth()` resolved, because that
// is where it was armed. The await on `signInWithOAuth()` itself was unbounded,
// so a hang inside the SDK (its own storage/lock plumbing) left the gate stuck
// on "Connecting to Google…" forever with no sheet and no message — which is
// exactly what Drew hit. This is the bound for getting the Google URL: no
// network round trip we ask for should take 20s, and if it does, the player
// gets a button back and a reason.
const DEFAULT_OAUTH_URL_TIMEOUT_MS = 20000;
let _oauthUrlTimeoutMs = DEFAULT_OAUTH_URL_TIMEOUT_MS;
/** The exact copy the gate shows when that bound is hit. Carried on the thrown
 *  error as `userMessage` so app.js surfaces THIS sentence rather than its
 *  generic "couldn't complete" fallback — the two failures are different and a
 *  player retrying deserves to know which one they got. */
export const OAUTH_URL_TIMEOUT_MESSAGE = "Couldn't reach Google — try again.";

// RG-234 (2026-09-23, Drew's iPhone, bug B-e part 3) — `Browser.open()` was the
// OTHER unbounded await in this function, and the one RG-233's bound could not
// reach. It sits BELOW the 120s flow timer's arming, so a wedged plugin bridge
// call there left the gate frozen on "Connecting to Google…" forever: the 120s
// timer does fire, but it rejects `flow`, which nothing is awaiting yet (we are
// still parked on this await), so its rejection reaches no UI at all. Opening a
// system sheet is a local, sub-second operation — 10s is already generous.
const DEFAULT_SHEET_OPEN_TIMEOUT_MS = 10000;
let _sheetOpenTimeoutMs = DEFAULT_SHEET_OPEN_TIMEOUT_MS;
/** The copy the gate shows when the sheet itself never presents. Distinct from
 *  OAUTH_URL_TIMEOUT_MESSAGE on purpose: "we never got the URL from Google" and
 *  "we got the URL but this phone never showed you the page" are different
 *  failures, and a player deciding whether to retry benefits from knowing which.
 */
export const OAUTH_SHEET_TIMEOUT_MESSAGE = "Couldn't open the Google sign-in page — try again.";

/** RG-234 — every rejection out of signInWithGoogleNative() carries a
 *  player-facing `userMessage`, so app.js's gate never has to fall back to its
 *  generic "couldn't complete" sentence for a failure this module already
 *  understands. Cancel-shaped errors are deliberately left WITHOUT one: app.js
 *  classifies those by message first (`/cancel|closed|popup/i`) and renders them
 *  as a neutral notice, which is the correct treatment and must not change. */
function _failure(message, userMessage) {
  const e = new Error(message);
  e.userMessage = userMessage;
  return e;
}
/** Attaches `userMessage` to an error we did not construct (an SDK error, a
 *  Google error_description) without clobbering one it already carries. Wrapped
 *  because a frozen/exotic error object must never turn a real failure into a
 *  TypeError on the way to the player. */
function _withUserMessage(err, userMessage) {
  try {
    if (err && typeof err === 'object' && typeof err.userMessage !== 'string') err.userMessage = userMessage;
  } catch { /* non-extensible error — the gate's generic fallback still covers it */ }
  return err;
}

/** RG-234 (d) — stage breadcrumbs. NAMES ONLY: never a URL, never a code, never
 *  a token, never an OSStatus. With Safari's Web Inspector attached to the
 *  device, the last breadcrumb printed localises a hang to one await instead of
 *  one file. console.warn (not log/info) so it survives at the default filter
 *  level a device inspector session opens with. */
function _stage(name) {
  try { console.warn('[auth-native][stage] ' + name); } catch { /* never let logging break a sign-in */ }
}

/** Races `promise` against `ms`. Rejects with an Error carrying `userMessage`
 *  when the bound wins. A late settle from `promise` after that is pinned with
 *  a no-op handler by the caller (CONVENTIONS #4) — it can no longer reach the
 *  UI either way, because this function's caller has already thrown. */
async function _withTimeout(promise, ms, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(message);
          e.userMessage = message;
          reject(e);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

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
  if (_listenersRegistered) return true;
  const plugins = _capacitorPlugins();
  if (!plugins?.App?.addListener) return false; // no bridge — signInWithGoogleNative() itself reports this
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
    _stage('deep-link-received'); // RG-234 (d) — name only, never the URL
    _closeBrowser();

    let parsed = null;
    try { parsed = new URL(url); } catch { /* already validated by the matcher above */ }
    const code = parsed ? parsed.searchParams.get('code') : null;
    const errParam = parsed ? parsed.searchParams.get('error') : null;
    const errDesc = parsed ? parsed.searchParams.get('error_description') : null;

    // RG-234 (b) — every one of these rejections now carries its own
    // player-facing sentence, so the gate never has to guess.
    if (errParam) { _settle('reject', _withUserMessage(new Error(errDesc || errParam), "Google couldn't sign you in — try again.")); return; }
    if (!code) { _settle('reject', _failure('Native sign-in: the callback link had no authorization code.', "Sign-in didn't complete — try again.")); return; }

    const client = getSupabaseClient();
    if (!client) { _settle('reject', _failure('Native sign-in: Supabase client is not configured.', "Sign-in isn't ready yet — try again in a moment.")); return; }

    try {
      // The SAME client auth.js already owns — its own onAuthStateChange
      // wiring (ensureClient()) fires SIGNED_IN on a successful exchange,
      // which is what drives app.js's existing refreshAuthUI() chain. We do
      // not set any session state ourselves.
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      _stage('code-exchanged');
      _settle('resolve', undefined);
    } catch (e) {
      _settle('reject', _withUserMessage(e, "Couldn't finish signing in — try again."));
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
  return true;
}

/**
 * RG-233 (d) — registered at MODULE LOAD, not lazily on the first tap.
 *
 * The listeners used to be registered inside signInWithGoogleNative(), i.e. only
 * after a tap. A cold start that already has a redirect in flight (iOS hands the
 * relaunched app the `munera://auth/callback` URL almost immediately) could
 * therefore deliver `appUrlOpen` before ANY listener existed, and the event was
 * gone. Registering at load closes that window. It does NOT weaken security
 * condition 5: the handler's own `if (!_pendingActive || _exchanged) return;`
 * still DROPS a deep link that has no in-flight sign-in waiting on it — earlier
 * registration changes only whether we are listening, never what we accept.
 *
 * Exported as well as run at load, because on a cold native boot the module can
 * be evaluated before `window.Capacitor.Plugins` exists; app.js's gate calls
 * this once more when it paints, by which time the bridge is up.
 */
export function ensureNativeSignInListeners() {
  try { return _ensureListeners(); } catch (e) {
    console.warn('[auth-native] could not register the deep-link listeners yet', e);
    return false;
  }
}

/**
 * RG-233 (b) — a stale in-flight flow is RECOVERABLE, not a dead end.
 *
 * `_pendingActive` is module state that outlives any single tap. If a flow never
 * settled (the deep link was missed on a cold start before (d) above, or
 * `browserFinished` never fired), every later tap hit the ":175" guard and threw
 * "A sign-in is already in progress." — and nothing in the app could clear that
 * state short of killing the app. The gate now calls this before starting, so a
 * second tap always means "forget the old attempt, start a fresh one."
 *
 * The superseded flow is REJECTED rather than abandoned, so the previous
 * handler's own catch runs (no promise is left dangling); it carries
 * `supersededNativeFlow` so that handler can tell "I was replaced" from "I
 * failed" and stay quiet instead of painting a message over the new attempt.
 * Returns true when there was actually something to cancel.
 */
export function cancelPendingNativeSignIn() {
  if (!_pendingActive) return false;
  _closeBrowser();
  const e = new Error('Sign-in superseded by a new attempt.');
  e.supersededNativeFlow = true;
  _exchanged = false;
  _settle('reject', e);
  return true;
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
export async function signInWithGoogleNative({ onSheetOpened } = {}) {
  if (_pendingActive) throw _failure('A sign-in is already in progress.', 'A sign-in is already running — give it a moment, then try again.');

  const client = getSupabaseClient();
  if (!client) throw _failure('Native sign-in: Supabase client is not configured.', "Sign-in isn't ready yet — try again in a moment.");

  const plugins = _capacitorPlugins();
  const BrowserPlugin = plugins?.Browser;
  const AppPlugin = plugins?.App;
  if (!BrowserPlugin?.open || !AppPlugin?.addListener) {
    throw _failure("Native sign-in isn't available on this device.", "Native sign-in isn't available on this device.");
  }
  _ensureListeners();

  // RG-233 (c) — BOUNDED. `signInWithOAuth()` is where Drew's freeze lived: the
  // browser sheet is opened further down (so "no sheet appeared" localises the
  // hang to exactly this await), and the 120s flow timeout is armed further
  // down too, so a hang here was never covered by anything.
  //
  // RG-234 — this await ALSO covers supabase-js's PKCE storage write: the SDK
  // stores `<storageKey>-code-verifier` via `auth.storage.setItem()` BEFORE it
  // builds the URL, and on native that storage is our Keychain adapter
  // (js/auth-storage-native.js). The vendored SDK awaits setItem directly
  // (`H = async (e,t,n) => { await e.setItem(t, JSON.stringify(n)) }`), so a
  // hung Keychain write hangs THIS promise and a rejected one rejects it —
  // either way the bound below is what the player sees. The adapter bounds each
  // plugin call itself too, so the rejection arrives long before this timer.
  _stage('oauth-url-requested');
  const oauthPromise = client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_CALLBACK_URL, skipBrowserRedirect: true },
  });
  // Pin a handler in case it settles AFTER our bound already rejected —
  // otherwise that late settle is an unhandled rejection (CONVENTIONS #4).
  Promise.resolve(oauthPromise).catch(() => {});
  const res = await _withTimeout(oauthPromise, _oauthUrlTimeoutMs, OAUTH_URL_TIMEOUT_MESSAGE);
  const { data, error } = res || {};
  if (error) throw _withUserMessage(error, OAUTH_URL_TIMEOUT_MESSAGE);
  if (!data || !data.url) throw _failure('Native sign-in: Google did not return a sign-in URL.', OAUTH_URL_TIMEOUT_MESSAGE);
  _stage('oauth-url-built'); // name only — never the URL itself

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
    //
    // RG-234 — BOUNDED. This await used to be bare, and it is BELOW the 120s
    // timer armed just above: a wedged bridge call here parked us forever while
    // that timer's rejection went to `flow`, which nothing was awaiting yet.
    const openPromise = BrowserPlugin.open({ url: data.url, presentationStyle: 'popover' });
    // Pin a handler in case it settles AFTER our bound rejected (CONVENTIONS #4).
    Promise.resolve(openPromise).catch(() => {});
    await _withTimeout(openPromise, _sheetOpenTimeoutMs, OAUTH_SHEET_TIMEOUT_MESSAGE);
    // RG-234 (a) — the sheet is now up, which is where the gate's overall
    // watchdog must stand down: everything past this point is a human reading a
    // Google page, bounded instead by the 120s flow timeout above.
    _stage('sheet-opened');
    try { onSheetOpened?.(); } catch (e) { console.warn('[auth-native] onSheetOpened callback threw', e); }
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
export function _resetNativeAuthForTest({
  flowTimeoutMs = DEFAULT_FLOW_TIMEOUT_MS,
  oauthUrlTimeoutMs = DEFAULT_OAUTH_URL_TIMEOUT_MS,
  sheetOpenTimeoutMs = DEFAULT_SHEET_OPEN_TIMEOUT_MS,
} = {}) {
  _listenersRegistered = false;
  _pendingActive = false;
  _exchanged = false;
  if (_timeoutId !== null) { clearTimeout(_timeoutId); _timeoutId = null; }
  _pendingResolve = null;
  _pendingReject = null;
  _flowTimeoutMs = flowTimeoutMs;
  _oauthUrlTimeoutMs = oauthUrlTimeoutMs;
  _sheetOpenTimeoutMs = sheetOpenTimeoutMs;
}
export function _isPendingForTest() { return _pendingActive; }
/** RG-233 — lets a test plant the stale state the device produced (a flow that
 *  never settled) without having to stage the whole missed-deep-link sequence. */
export function _setPendingForTest(active) { _pendingActive = !!active; }
export function _areListenersRegisteredForTest() { return _listenersRegistered; }
export const _DEFAULT_FLOW_TIMEOUT_MS_FOR_TEST = DEFAULT_FLOW_TIMEOUT_MS;
export const _DEFAULT_OAUTH_URL_TIMEOUT_MS_FOR_TEST = DEFAULT_OAUTH_URL_TIMEOUT_MS;
export const _DEFAULT_SHEET_OPEN_TIMEOUT_MS_FOR_TEST = DEFAULT_SHEET_OPEN_TIMEOUT_MS;

// ── RG-233 (d) — the ONE module-load side effect in this file: register the
//    deep-link listeners now, so a cold-start `appUrlOpen` is never delivered
//    to nobody. Inert (returns false) when the Capacitor bridge isn't up yet;
//    app.js's gate calls ensureNativeSignInListeners() again when it paints.
ensureNativeSignInListeners();
