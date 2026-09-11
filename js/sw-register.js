/**
 * js/sw-register.js — service-worker registration + update-reload policy.
 *
 * Extracted verbatim-in-behaviour from index.html's inline <script> (2026-09-10,
 * reviewer BLOCK F1) for one reason: the logic had no seam a test could reach.
 * It lives in a module now so notifytest.mjs [25] can drive it against a fake
 * `navigator.serviceWorker` and prove the two registrars converge.
 *
 * ── THE BUG THIS CLOSES (F1) ────────────────────────────────────────────────
 * Latent today, live the moment the OneSignal dashboard is configured. Two
 * registrars aim at the SAME file at the SAME scope with DIFFERENT query
 * strings, and each one's "is it already mine?" test compares the FULL URL:
 *
 *   ours  (old index.html:217)  navigator.serviceWorker.register('service-worker.js?v=20-0')
 *   SDK   (OneSignalSDK.page.es6.js?v=160610)
 *         ma():  registered scriptURL === `${origin}/service-worker.js?appId=<id>&sdkVersion=160610` ?
 *         Sa():  if not → navigator.serviceWorker.register(<that url>, {scope:'/'})
 *
 * Neither string can ever equal the other, so on EVERY page load both sides
 * re-register. A new scriptURL at the same scope installs a new worker; our
 * worker calls skipWaiting() in install and clients.claim() in activate, which
 * fires `controllerchange`, which the page turned into location.reload(), which
 * loads a page that re-registers `?v=20-0`… The old `let reloaded = false` is
 * per-page-load, so it capped reloads at one per load and did not break the
 * cycle. Modelled in Node before the fix: 8/8 page loads reloaded, 16 register()
 * calls, 0 update() calls, no convergence.
 *
 * ── THE FIX, BOTH HALVES ────────────────────────────────────────────────────
 * (A) CONVERGENCE — registerServiceWorker() below. If a registration at our
 *     scope already points at a script whose BASENAME is ours (any query), we
 *     do not re-register a differently-queried URL; we call reg.update(). One
 *     page load after the SDK first registers its URL, both sides agree and
 *     neither re-registers again. This is the half that stops the churn.
 *
 * (B) CONDITIONAL RELOAD — wireControllerChangeReload() below. A
 *     `controllerchange` only earns a reload when the app shell ACTUALLY
 *     changed, i.e. the new controller reports a different CACHE_NAME than the
 *     one this page booted under. This is the half that stops the reload, and
 *     it holds even for controller flips we never anticipated.
 *
 * Both, deliberately: (A) alone still costs one reload while converging; (B)
 * alone stops the reload but leaves two registrars re-installing a worker on
 * every page load forever.
 *
 * ── RG-04 / CACHE-BUSTING STILL HOLDS (read this before changing it) ────────
 * The `?v=20-0` on the registration URL was never what invalidated caches, and
 * skipping it on subsequent loads changes nothing about releases:
 *   • `reg.update()` re-fetches service-worker.js from the NETWORK (the browser
 *     bypasses the HTTP cache for the top-level worker script; `updateViaCache`
 *     defaults to 'imports'). A byte-diff — and a CACHE_NAME bump is a
 *     byte-diff — installs the new worker.
 *   • What actually invalidates the app shell is `CACHE_NAME` INSIDE
 *     service-worker.js: install re-fetches STATIC_ASSETS with `cache:'reload'`,
 *     activate deletes every cache whose key !== CACHE_NAME.
 *   • The new worker then reports its new CACHE_NAME to (B), which reloads
 *     exactly once. The genuine update path is preserved end to end.
 * The deploy checklist (bump the three `?v=` strings AND CACHE_NAME together)
 * is unchanged; CACHE_NAME is simply the load-bearing half of it.
 */

/** Filename of a worker URL, query and hash stripped. `''` for anything unparseable. */
export function swScriptBasename(url) {
  if (!url) return '';
  try {
    return String(url).split('#')[0].split('?')[0].split('/').filter(Boolean).pop() || '';
  } catch { return ''; }
}

/** The worker object that currently represents a registration, in the same
 *  precedence active → waiting → installing. (The OneSignal SDK's `Ns()` reads
 *  active → installing → waiting; the two only differ when a worker is mid-install,
 *  and both resolve to the same script file here, so ownership is unaffected.) */
function registrationWorker(reg) {
  if (!reg) return null;
  return reg.active || reg.waiting || reg.installing || null;
}

/** Default MessageChannel factory — injectable so tests need no real one. */
function defaultChannel() {
  const mc = new MessageChannel();
  return { port1: mc.port1, port2: mc.port2 };
}

/**
 * Ask a worker for the CACHE_NAME it was built with.
 * Resolves the string, or `null` if the worker does not answer in time —
 * which is the case for any worker deployed BEFORE this change, so `null`
 * must always be treated as "unknown", never as "unchanged" (see
 * wireControllerChangeReload: unknown reloads, only a confirmed match does not).
 */
export function readWorkerVersion(worker, { timeoutMs = 1500, channel = defaultChannel } = {}) {
  return new Promise((resolve) => {
    if (!worker || typeof worker.postMessage !== 'function') return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let ch;
    try { ch = channel(); } catch { return finish(null); }
    const t = setTimeout(() => finish(null), timeoutMs);
    t?.unref?.();                  // node-only; never holds a test harness open
    ch.port1.onmessage = (e) => {
      clearTimeout(t);
      finish((e?.data && e.data.cacheName) || null);
      try { ch.port1.close?.(); } catch { /* already closed */ }
    };
    try { worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]); }
    catch { clearTimeout(t); finish(null); }
  });
}

/**
 * (A) Register our worker WITHOUT fighting another registrar for the same file.
 *
 * Returns `{ action, registration }` where action is one of:
 *   'unsupported' — no navigator.serviceWorker here
 *   'updated'     — ours (by basename) was already registered → update(), NOT register()
 *   'registered'  — nothing of ours at this scope → a real register()
 *   'failed'      — register() threw
 */
export async function registerServiceWorker({
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  scriptUrl,
  scope = '/',
  log = () => {},
  warn = () => {},
} = {}) {
  if (!nav || !nav.serviceWorker) return { action: 'unsupported', registration: null };

  const ourName = swScriptBasename(scriptUrl);
  let existing = null;
  try { existing = await nav.serviceWorker.getRegistration(scope); }
  catch { existing = null; }       // a throw here must not block first install

  const worker = registrationWorker(existing);
  // BASENAME, not full URL. The whole bug is that the SDK's URL and ours differ
  // only by query string while pointing at the same file. Remove this check and
  // notifytest [25a] goes red (mutation canary [25e]).
  if (worker && swScriptBasename(worker.scriptURL) === ourName) {
    log('[SW] already registered by another registrar (' + worker.scriptURL + ') — update() instead of re-register');
    try { await existing.update(); } catch (e) { warn('[SW] update failed', e); }
    return { action: 'updated', registration: existing };
  }

  try {
    const reg = await nav.serviceWorker.register(scriptUrl, { scope });
    log('[SW] registered:', reg?.scope);
    return { action: 'registered', registration: reg };
  } catch (e) {
    warn('[SW] failed', e);
    return { action: 'failed', registration: null };
  }
}

/** Preserved from index.html: push a waiting/installing worker straight to
 *  active so an update does not sit behind a closed tab. Unchanged behaviour. */
export function wireSkipWaiting(reg, { nav = (typeof navigator !== 'undefined' ? navigator : null) } = {}) {
  if (!reg) return;
  if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  reg.addEventListener?.('updatefound', () => {
    const newSW = reg.installing;
    if (!newSW) return;
    newSW.addEventListener?.('statechange', () => {
      if (newSW.state === 'installed' && nav?.serviceWorker?.controller) {
        newSW.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });
}

/**
 * (B) Reload on `controllerchange` ONLY when the app shell actually changed.
 *
 * `bootVersion` is the CACHE_NAME reported by the controller that was in charge
 * when this page loaded — a PROMISE, because the read is a round-trip and a
 * controller flip can beat it.
 *
 * Decision table (fail-safe direction is RELOAD; we only ever skip on a
 * CONFIRMED match, so an old worker that cannot answer still gets its update
 * through):
 *   boot known, new known, equal      → no reload, log only   ← F1
 *   boot known, new known, different  → reload exactly once   ← genuine update
 *   boot unknown (first install, or a pre-GET_VERSION worker) → reload once
 *   new unknown                       → reload once
 */
export function wireControllerChangeReload({
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  bootVersion = Promise.resolve(null),
  reload = () => { if (typeof location !== 'undefined') location.reload(); },
  readVersion = readWorkerVersion,
  log = () => {},
} = {}) {
  if (!nav || !nav.serviceWorker) return;
  let reloaded = false;
  nav.serviceWorker.addEventListener('controllerchange', async () => {
    if (reloaded) return;
    const before = await bootVersion;
    const after = await readVersion(nav.serviceWorker.controller);
    if (before && after && before === after) {
      log('[SW] controller changed but the app shell is identical (' + after + ') — not reloading');
      return;   // F1: the OneSignal SDK re-registering the SAME file lands here
    }
    if (reloaded) return;          // a second change could have won the await
    reloaded = true;
    log('[SW] app shell changed (' + (before || 'none') + ' → ' + (after || 'unknown') + ') — reloading once');
    reload();
  });
}

/**
 * Everything index.html used to do inline, in the one order that matters:
 * capture the boot version and attach the reload listener BEFORE registering,
 * because registering can flip the controller immediately.
 */
export async function setupServiceWorker({
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  scriptUrl,
  scope = '/',
  reload,
  readVersion = readWorkerVersion,
  versionTimeoutMs = 1500,
  log = (...a) => console.log(...a),
  warn = (...a) => console.warn(...a),
} = {}) {
  if (!nav || !nav.serviceWorker) return { action: 'unsupported', registration: null };

  const controller = nav.serviceWorker.controller;
  const bootVersion = controller
    ? readVersion(controller, { timeoutMs: versionTimeoutMs })
    : Promise.resolve(null);       // no controller = first install; unknown → reload once

  wireControllerChangeReload({ nav, bootVersion, reload, readVersion, log });

  const res = await registerServiceWorker({ nav, scriptUrl, scope, log, warn });
  wireSkipWaiting(res.registration, { nav });
  return res;
}
