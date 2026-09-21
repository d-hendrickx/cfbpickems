/**
 * CFB Pickems — Service Worker v16
 * Caches core app shell for offline / fast load.
 *
 * v10 strategy: NETWORK-FIRST for app shell.
 *   - Old cache-first behaviour caused stale JS/CSS to be served after updates,
 *     forcing two reloads to pick up changes. Network-first guarantees fresh
 *     content when online, with cache fallback when offline.
 *   - Guard against caching chrome-extension://, moz-extension://, devtools://
 *     and other unsupported schemes (silences the "Request scheme … unsupported"
 *     console error from extension-injected fetches).
 *   - Bumped CACHE_NAME → cfb-pickems-v15-3 to invalidate any v9 cached files.
 *
 * GROUPS A/B PUSH (2026-09-10) — OneSignal Web SDK MERGE, not a second
 * service worker. Per DESIGN_INPUTS_BATCH1_091026.md Part 0b correction #1:
 * the OneSignal SDK requires ITS worker in the loop; the supported pattern
 * for an app with an existing custom worker (this one) is to `importScripts`
 * OneSignal's worker script INTO this file, rather than registering a second
 * root-scope worker or hand-authoring push/notificationclick handling the SDK
 * already owns. js/push-onesignal.js's `OneSignal.init()` call points the SDK
 * at THIS file (`serviceWorkerPath: 'service-worker.js'`), so there is still
 * only ONE registration (index.html's existing `navigator.serviceWorker
 * .register('service-worker.js?v=...')` call, unchanged).
 *
 * `importScripts` must run at TOP LEVEL, before this file does anything else,
 * per the API's own contract. It is a genuine no-op when OneSignal's SDK has
 * never been configured (no App ID yet, js/push-onesignal.js's `isPushConfigured()`
 * is false) — the imported script still installs its own install/activate/push/
 * notificationclick listeners, but OneSignal's client-side SDK never subscribes
 * a device or requests permission until `OneSignal.init({appId})` actually runs
 * with a real App ID, so those listeners simply never fire in production today.
 *
 * VERIFIED 2026-09-10 (the caveat that used to sit here is resolved):
 *   • https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js → HTTP 200,
 *     39,725 bytes. The URL below is current.
 *   • OneSignal's own "OneSignal service worker" doc states the combine
 *     pattern verbatim: "To combine, add the OneSignal importScripts line to
 *     your existing service worker file… After combining, update the OneSignal
 *     configuration to point to your existing service worker file", and "You
 *     can rename the file if needed." So this merge IS the supported setup —
 *     NOT a workaround, and NOT a second registration.
 *   • The other half of it lives in js/push-onesignal.js's init(): the SDK
 *     only honours our worker filename when init passes `path` AND
 *     `serviceWorkerOverrideForTypical: true` (a "Typical Site" dashboard
 *     otherwise overrides it back to the default OneSignalSDKWorker.js, which
 *     this site does not host — that URL 404s in production). notifytest.mjs
 *     [24g] holds the two files to the same filename; do not rename this file
 *     without reading that assertion.
 *
 * Any change to this file requires the usual cache-bust (CACHE_NAME + all
 * three `?v=` references in index.html) — per this batch's task instructions,
 * that bump is the coordinator's job at deploy time, NOT done in this pass.
 *
 * F3 remediation (2026-09-10) — a top-level importScripts() that throws
 * (404, network hiccup, URL moved) used to fail the WHOLE service-worker
 * install, taking the app shell's offline cache down with it over an SDK
 * script that is otherwise irrelevant until Drew sets a real OneSignal App
 * ID. Wrapped so a failure here degrades to "no push" only — everything
 * below (install/activate/fetch, the cache-shell) is completely unaffected
 * either way. // VERIFY ON DEVICE — confirm a real install still succeeds
 * with this wrapped, both when the OneSignal URL resolves and when it 404s.
 */
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch (err) {
  console.warn('[service-worker] OneSignal SDK import failed — push unavailable, cache-shell unaffected:', err);
}

const CACHE_NAME = 'cfb-pickems-v23-2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/sw-register.js',
  './js/data-model.js',
  './js/storage.js',
  './js/data-provider.js',
  './js/scoring.js',
  './js/notifications.js',
  './js/notify-copy.js',
  './js/push-onesignal.js',
  './js/backend.js',
  './js/chat.js',
  './js/chatTransport.js',
  './js/history-2025.js',
  './js/chat-ui.js',
  './js/scribeLines.js',
  './js/scribeAgent.js',     // statically imported by app.js/chat-ui.js — boot-critical (reviewer N1, 2026-09-10)
  './js/scribeFeedback.js',  // same — omitted from the shell cache after the Build 1 merge
  './js/extra-point.js',
  './js/recap.js',
  // Phase III Step 3a (reviewer N3 / SEC F6). js/auth.js is statically imported
  // by app.js AND by storage.js, so it is boot-critical exactly as
  // scribeAgent.js/scribeFeedback.js are — a shell cache without it serves a
  // module graph that cannot resolve. The vendored SDK is NOT statically
  // imported (app.js injects it only in authMode:'supabase'), but it is
  // precached anyway so that a supabase-mode device is not one flaky request
  // away from an unusable front door, and so the cached copy is the sha-pinned
  // one. Cost, named: ~one SDK's worth of install-time bytes for every device,
  // including the 'pins' devices that will never execute it — install-time and
  // once per CACHE_NAME, not per boot.
  './js/auth.js',
  // Phase III Step 4 Part B (2026-09-18). BOTH are STATIC imports — js/storage.js
  // imports supabase-backend.js as a namespace (DI §1.2 row 1) and
  // supabase-backend.js imports supabase-projection.js (its own header,
  // constraint 2) — so they are boot-critical on EVERY device, flag on or off,
  // for the same reason auth.js is: a shell cache without them serves a module
  // graph that cannot resolve, which is RG-03's blank app arriving through the
  // cache instead of through a typo. They cost a flag-off boot nothing at run
  // time (neither has a top-level side effect, boottest [22](d)); this is about
  // the bytes being present, not about them executing.
  './js/supabase-backend.js',
  './js/supabase-projection.js',
  // RG-176 (2026-09-19). Statically imported by BOTH app.js and chat-ui.js, so
  // it is boot-critical for the same reason auth.js is — a shell cache one
  // module short serves a graph that cannot resolve (RG-03's blank app,
  // arriving through the cache instead of through a typo). notifytest [25e] is
  // the guard that caught this omission before it shipped.
  './js/field-preserve.js',
  // iOS Munera PASS 1b (2026-09-20). Both statically imported by app.js
  // (platform.js also by push-onesignal.js/sw-register.js/backend.js/
  // chatTransport.js) — boot-critical for the same reason auth.js is: a
  // shell cache one module short serves a graph that cannot resolve
  // (RG-03's blank app, arriving through the cache instead of through a
  // typo). notifytest [25e] is the guard that catches this omission before
  // it ships.
  './js/platform.js',
  './js/brand.js',
  // DI-204/205/206/218 (the combined release, 2026-09-20). Statically imported by app.js for the
  // Background-jobs card's push self-test sub-section — boot-critical for exactly the same reason
  // field-preserve.js and platform.js are: a shell cache one module short serves a graph that
  // CANNOT RESOLVE, and the symptom is RG-03's blank app arriving through the cache rather than
  // through a typo.
  //
  // CAUGHT BY notifytest [25e], which is the third time that rule has earned its place (RG-176,
  // the iOS pair, now this one). `loadtest.mjs` did not spawn `notifytest.mjs` when this was found;
  // it does as of the v0.23.0 release cut (spawn [93], ratcheted floor), so this list is now covered
  // by the mandatory sweep.
  './js/push-selftest.js',
  './vendor/supabase-js-2.116.0.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
// Delete ALL old caches (any cache name not matching CACHE_NAME), then claim
// every open client so the new SW takes over immediately on the current tab.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── MESSAGE: page → worker control channel ───────────────────────────────────
//   SKIP_WAITING — allow the page to trigger immediate SW takeover.
//   GET_VERSION  — report CACHE_NAME so the page can tell a REAL app-shell
//                  update from a controller flip that changed nothing (F1,
//                  2026-09-10). The OneSignal SDK re-registers THIS SAME FILE
//                  under its own query string; that fires `controllerchange`
//                  with an identical shell, and the page used to reload on it
//                  unconditionally — see js/sw-register.js. Answered on the
//                  MessagePort the page supplies; a worker deployed before
//                  this change simply never answers, and the page treats
//                  "no answer" as unknown and reloads, so the genuine update
//                  path survives the transition.
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'GET_VERSION') {
    try { event.ports && event.ports[0] && event.ports[0].postMessage({ type: 'VERSION', cacheName: CACHE_NAME }); }
    catch (err) { /* port closed — the page gave up and reloaded already */ }
  }
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-http(s) schemes entirely — cannot put these in Cache Storage.
  // This silences chrome-extension://, moz-extension://, devtools://, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Skip non-GET — Cache Storage rejects POST/PUT/etc.
  if (event.request.method !== 'GET') return;

  // ESPN API and CORS proxies: always go to network; fall back to cache if offline.
  if (url.hostname.includes('espn') || url.hostname.includes('corsproxy') || url.hostname.includes('allorigins') || url.hostname.includes('codetabs')) {
    event.respondWith(networkFirst(event.request, false));
    return;
  }

  // ── SEC S-6 — config.json IS NEVER CACHED ───────────────────────────────────
  // js/backend.js's loadDeployedConfig() cache-busts with `config.json?t=` +
  // Date.now(), so every boot requested a URL that had never been seen before.
  // Cache Storage keys on the FULL url, so each of those became its own entry:
  // a permanent, monotonically growing pile of config snapshots that nothing can
  // ever read back (the next boot's timestamp never matches a stored one), each
  // one holding `backendToken` in plain text, and all of them surviving until
  // CACHE_NAME next changes. Unbounded growth AND a needless multiplication of
  // the secret.
  //
  // The fix is to stop CACHING it, not to start matching it:
  //   ⚠️ DO NOT ADD `ignoreSearch` HERE, OR ANYWHERE IN THIS FILE. ⚠️
  // With ignoreSearch, an offline boot would be served a STALE cached
  // config.json as a 200 — which loadDeployedConfig() reports as a SUCCESSFUL
  // read (`authModeKnown: true`). That re-opens the exact privilege downgrade
  // SEC F1-R1 closed: a cut-over device reading a pre-cutover config off its own
  // disk would select 'pins' with full confidence and hand back a stale
  // `cfbp_session` that may still say isAdmin:true. A config read must fail
  // honestly when it cannot reach the network. boottest [17] asserts that no
  // `ignoreSearch` appears in this file.
  //
  // RESPONSES ARE UNCHANGED, both ways: online, networkFirst returns the network
  // response exactly as before (the only thing skipped is the cache.put); offline
  // it returns the same synthetic 503, because a `?t=<now>` URL never matched a
  // cached entry in the first place.
  if (url.pathname === '/config.json' || url.pathname.endsWith('/config.json')) {
    event.respondWith(networkFirst(event.request, false));
    return;
  }

  // App shell + everything else: network-first with cache fallback.
  // This guarantees code updates (new app.js, data-model.js, etc.) are picked
  // up on the next page load instead of requiring a second hard refresh.
  event.respondWith(networkFirst(event.request, true));
});

async function networkFirst(request, cacheOnSuccess) {
  try {
    const response = await fetch(request);
    if (cacheOnSuccess && response && response.ok && response.type === 'basic') {
      // Only cache same-origin successful responses; never cache opaque
      // (cross-origin no-cors) or error responses.
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch (_) { /* swallow — scheme/quota/etc. */ }
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline — content not cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
