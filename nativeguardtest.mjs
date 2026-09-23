/**
 * CFB Pickems — nativeguardtest.mjs (DI-208g / S-C14, iOS Munera PASS 1b, 2026-09-20)
 * =====================================================================================
 * Unit tests for the ORIGIN-POSITIVE refusal guards added to js/backend.js's
 * call() and js/chatTransport.js's get()/post() — AD-67: the native iOS shell
 * never speaks Google Sheets/Apps Script, for ANY action, independent of
 * `_dataMode` (security-reviewer AMENDMENT 1, finding F2: a dataMode-keyed
 * guard fails OPEN on an offline cold boot before a config read has set the
 * mode). Coordinator correction (2026-09-20): these assertions were
 * originally slated for authtest.mjs, which is EXCLUSIVE to the Supabase
 * thread right now — this is a NEW, separate file instead, spawned from
 * loadtest.mjs the house way (grouptest.mjs/authtest.mjs precedent), so
 * nothing here ever touches js/auth.js or authtest.mjs.
 *
 * Run:  node nativeguardtest.mjs
 *
 * ── WHAT THIS FILE BECAME (2026-09-23, the Sheets retirement) ───────────────
 * It was the RUNTIME proof of AD-67's two origin-positive guards. Both guards,
 * and both transports they fronted, are deleted — so the decision is now
 * satisfied by an ABSENCE, and this file is where that absence is asserted.
 * The sections' own headers carry the full history of what they used to drive.
 *
 * Covers:
 *   [1]–[7] THE ABSENCE, over the WHOLE js/ tree rather than the two files
 *       that used to carry the guards, because "can anything here reach Apps
 *       Script" is a property of the tree: no Apps Script origin, no
 *       /macros/s/ deployment path, no backendUrl/backendToken read, no
 *       `call('<action>')` dispatcher, no Cloud Sync URL/token inputs, and a
 *       config.json that ships neither the URL nor the token — plus the one
 *       fetch left in js/backend.js, named, because it reads config.json.
 *       `isNativeOrigin()` itself survives (js/auth.js and js/push-onesignal.js
 *       still have native branches) and nothing re-implements it.
 *   [8] WEB INERTNESS OF js/app.js's IMPORT SURFACE, in a child process with
 *       NOTHING else running (RG-192): importing app.js with no Capacitor
 *       schedules no timer, no interval, no fetch and no rAF, and
 *       ensureSupabaseSdkLoaded()'s deadline still settles on its own.
 */

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── Minimal DOM/localStorage/fetch stubs — enough for backend.js/
//    chatTransport.js to import and run cleanly. fetch() is a canary: if any
//    of these calls ever reach it, the refusal did not fire early enough. ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error('fetch must never be reached in these scenarios'); };

const backend = await import('./js/backend.js');
const chatTransport = await import('./js/chatTransport.js');

function setOrigin({ native, scheme }) {
  if (native) globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  else delete globalThis.window;
  globalThis.location = { protocol: scheme };
}

// ──────────────────────────────────────────────────────────────────────────────
// [1]–[7] — AD-67 IS SATISFIED BY AN ABSENCE NOW (2026-09-23)
//
// WHAT THEY PROVED. AD-67: the native iOS shell never speaks Google
// Sheets/Apps Script, for ANY action, INDEPENDENT of `_dataMode` — because
// security-reviewer AMENDMENT 1 finding F2 was that a dataMode-keyed guard
// fails OPEN on an offline cold boot, before a config read has set the mode.
// The guards were ORIGIN-POSITIVE (S-C1/S-C8's shape): `isNativeOrigin()` in
// js/platform.js answers true only for the genuine `capacitor:` scheme, so a
// spoofed `window.Capacitor` on a real https: origin could never use it to
// downgrade a web session. These sections drove both halves — the refusal on a
// genuine native origin, with fetch NEVER reached, and the spoof-on-https
// proof that a web session is unaffected — against js/backend.js's `call()` and
// js/chatTransport.js's `get()`/`post()`, plus the source-level rule that
// neither file re-implements the origin check, plus §[7]: the Cloud Sync card,
// whose live URL/token inputs were a UI path a shell could POST through even
// with the runtime refusal in place (AMENDMENT 1 finding F1).
//
// ALL FOUR OF THOSE THINGS ARE DELETED. `call()`, `get()`, `post()` and the
// Cloud Sync card went with the Apps Script transport. AD-67 asked that the
// shell never reach Apps Script; no code in this app can reach it, from any
// origin, which is the strongest form the decision can take — an absence rather
// than a guard, and a guard is one edit away from a gap.
//
// WHAT IS ASSERTED INSTEAD is exactly that absence, over the WHOLE js/ tree
// rather than over the two files that used to carry the guards — because the
// question "can anything here reach Apps Script" is a property of the tree.
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n[1]–[7] AD-67 — no module in js/ can reach Apps Script from ANY origin (the guards are retired with what they guarded)…');
{
  const { readdirSync } = await import('node:fs');
  const jsDir = new URL('./js/', import.meta.url);
  const files = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
  assert(files.length >= 25, `fixture: the scan enumerated js/ (${files.length} modules) — an empty readdir would make every rule below vacuous`);

  const offenders = [];
  for (const f of files) {
    const src = await readFile(new URL(f, jsDir), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (/script\.google\.com/.test(code)) offenders.push(f + ':script.google.com');
    if (/macros\/s\//.test(code)) offenders.push(f + ':/macros/s/ path');
    if (/backendToken|backendUrl/.test(code)) offenders.push(f + ':backendUrl/backendToken');
  }
  assert(offenders.length === 0,
    `[1] NO module in js/ names an Apps Script URL, a /macros/s/ deployment path, or the backendUrl/backendToken config keys in executable code (found: ${JSON.stringify(offenders)})`);

  const backendSrc = await readFile('./js/backend.js', 'utf8');
  const transportSrc = await readFile('./js/chatTransport.js', 'utf8');
  const strip = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/async function call\s*\(/.test(strip(backendSrc)),
    '[2] js/backend.js has no call() — the function AD-67\'s first guard was the first line of');
  assert(!/async function (get|post)\s*\(action/.test(strip(transportSrc)),
    '[3] js/chatTransport.js has no get()/post() — the two functions AD-67\'s second guard fronted');
  // THE ONE FETCH LEFT IN EITHER FILE, named rather than implied.
  const beFetches = [...strip(backendSrc).matchAll(/fetch\(([^)]*)/g)].map((m) => m[1].slice(0, 40));
  assert(beFetches.length === 1 && /config\.json/.test(beFetches[0]),
    `[4] the only fetch() left in js/backend.js reads config.json — a same-origin static file beside index.html, which the shell serves from its own bundle (got ${JSON.stringify(beFetches)})`);

  const appSrc = await readFile('./js/app.js', 'utf8');
  assert(!/id="be-url"/.test(appSrc) && !/id="be-token"/.test(appSrc),
    '[5] js/app.js renders no Web App URL or Access Token input anywhere — AMENDMENT 1 finding F1\'s UI path is gone, not merely hidden behind isNativeShell()');
  assert(!/be-test-btn|be-save-btn|be-seed-btn|be-snapshot-btn/.test(appSrc),
    '[6] …and none of the Cloud Sync buttons is rendered or bound on ANY platform');

  // `isNativeOrigin()` itself is untouched and STILL USED — by js/auth.js and
  // js/push-onesignal.js, which have their own native branches. This rule is
  // what keeps AD-68's single-source-of-truth claim honest now that the two
  // biggest consumers are gone.
  const platformSrc = await readFile('./js/platform.js', 'utf8');
  assert(/export function isNativeOrigin/.test(platformSrc),
    '[7] js/platform.js still exports isNativeOrigin() — the predicate survives its two biggest consumers, and nothing re-implements it');

  // ── THE THREE REMAINING SHAPES OF "CAN ANYTHING STILL REACH APPS SCRIPT" ───
  // Named separately from the URL scan above because each is a DIFFERENT door
  // and a tree can be clean of one while carrying another.
  //
  // (i) THE DISPATCHER. Every Apps Script request in this app's history went
  //     through one function — `call(action, payload)` in js/backend.js — or
  //     through chatTransport's own `get()`/`post()`. A surviving `call('…')`
  //     anywhere in js/ would mean a second one had been written.
  const callers = [];
  for (const f of files) {
    const code = strip(await readFile(new URL(f, jsDir), 'utf8'));
    for (const m of code.matchAll(/(?:^|[^.\w])call\(\s*['"]([a-zA-Z]+)['"]/g)) callers.push(f + ":call('" + m[1] + "')");
  }
  assert(callers.length === 0,
    `[7] no module in js/ calls a named Apps Script action — the \`call('<action>')\` dispatcher shape appears nowhere (found: ${JSON.stringify(callers)})`);

  // (ii) THE CREDENTIAL. A URL with no token is inert, and a token with no URL
  //      is a secret nobody needs shipped. Both are gone from the deployed
  //      config, which is what Drew's rotation ceremony rests on: there is
  //      nothing left in the repo for a rotation to have to chase.
  const cfgRaw = await readFile('./config.json', 'utf8');
  const cfg = JSON.parse(cfgRaw);
  assert(!('backendUrl' in cfg) && !('backendToken' in cfg),
    `[7] config.json carries NO backendUrl and NO backendToken (keys present: ${JSON.stringify(Object.keys(cfg))}) — the Apps Script credential does not ship with the site any more`);
  assert(!/script\.google\.com/.test(cfgRaw),
    '[7] …and the /exec URL appears nowhere in it, not even in a comment key — a URL left behind reads as a live endpoint to the next person');
  assert(cfg.authMode === 'supabase' && cfg.dataMode === 'supabase' && typeof cfg.supabaseAnonKey === 'string' && cfg.supabaseAnonKey.length > 20,
    'fixture: …and the keys that DO matter are intact — this is a removal, not a blanked config (CLAUDE.md: never commit config.json with real values missing)');

  // (iii) THE SERVICE WORKER. STATIC_ASSETS is what a device actually
  //       downloads; a stale entry there is a file the shell keeps serving
  //       after the tree stops shipping it.
  const swSrc = await readFile('./service-worker.js', 'utf8');
  assert(/\.\/js\/backend\.js/.test(swSrc),
    '[7] service-worker.js still precaches ./js/backend.js — the module SURVIVES the retirement (config read, dataMode, the Sheets-era mirror wipe), so dropping it from STATIC_ASSETS would break the shell cache');
  assert(!/script\.google\.com/.test(swSrc),
    '[7] …and names no Apps Script origin of its own');
  const reimplementers = [];
  for (const f of files) {
    if (f === 'platform.js') continue;
    const code = strip(await readFile(new URL(f, jsDir), 'utf8'));
    if (/location\.protocol\s*===?\s*['"]capacitor:/.test(code)) reimplementers.push(f);
  }
  assert(reimplementers.length === 0,
    `[7] …and no module re-implements the origin check inline (found: ${JSON.stringify(reimplementers)})`);
}


// ─────────────────────────────────────────────────────────────────────────────
// [8] RG-192 — WEB INERTNESS, PROVED IN AN EMPTY PROCESS.
//
// The defect this pins: `node authtest.mjs` on this branch printed ~811 passes
// and then exited 13 with "unsettled top-level await" at its
// `await app.ensureSupabaseSdkLoaded({ timeoutMs: 1 })`, with ZERO failed
// assertions. Nothing in authtest.mjs changed; nothing native ran. The chain
// was: ensureSupabaseSdkLoaded()'s deadline timer — the ONLY thing that can
// settle that promise when the injected <script> fires neither `load` nor
// `error`, which is exactly what a DOM stub does — was `.unref()`'d, so it
// could not hold Node's event loop open. It therefore only ever fired while
// some UNRELATED ref'd handle happened to be alive. In authtest that handle
// was chat.js's 750ms outbox-flush timer, armed by the boot-time "What's New"
// chat post. This branch bumped APP_VERSION to v0.22.8 and deliberately
// shipped no matching WHATS_NEW_RELEASES entry (reviewer #4, item E), so the
// post stopped happening, the loop went empty, and the await never settled.
//
// A suite must never depend on an accidental keepalive from a module it is not
// testing — authtest.mjs's own comment at its `sdkLatchedFalse` fixture says
// so in as many words, and that fixture owns a keepalive for this reason; the
// sibling fixture 900 lines later did not. The fix was in production code
// (drop the `.unref()`), and THIS is the guard: a child process with an empty
// event loop, where a droppable deadline cannot hide behind anything.
//
// It doubles as the inertness guard for the whole PASS 1b web path: the same
// child reports what importing app.js actually SCHEDULES on a Capacitor-free
// global. The expected answer is the one main gives — zero timers, zero
// intervals, zero fetches, zero rAF, and the single pre-existing
// document.addEventListener('DOMContentLoaded') boot hook. A native hook that
// ever starts running on web (a stray listener, a background fetch, a timer)
// shows up here as a count that is no longer zero.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] js/app.js import surface + SDK-load deadline, in a child process with an EMPTY event loop…');
{
  const appUrl = new URL('./js/app.js', import.meta.url).href;
  // Written as concatenation, not template literals, so this source survives
  // being embedded in one.
  const child = [
    "const counts = { timers: 0, intervals: 0, fetches: 0, listeners: 0, raf: 0, types: [] };",
    "const realST = globalThis.setTimeout, realSI = globalThis.setInterval;",
    "globalThis.setTimeout = (fn, ms, ...r) => { counts.timers++; return realST(fn, ms, ...r); };",
    "globalThis.setInterval = (fn, ms, ...r) => { counts.intervals++; return realSI(fn, ms, ...r); };",
    "const store = new Map();",
    "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
    "globalThis.document = {",
    "  addEventListener(t) { counts.listeners++; counts.types.push('doc:' + t); }, removeEventListener() {},",
    "  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],",
    "  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),",
    "  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' }, hidden: false,",
    "};",
    "globalThis.window = globalThis;",
    "const realAEL = globalThis.addEventListener ? globalThis.addEventListener.bind(globalThis) : null;",
    "globalThis.addEventListener = (...a) => { counts.listeners++; counts.types.push('win:' + a[0]); return realAEL ? realAEL(...a) : undefined; };",
    "globalThis.requestAnimationFrame = fn => { counts.raf++; fn(); };",
    "globalThis.fetch = async () => { counts.fetches++; throw new Error('network disabled in the inertness child'); };",
    "globalThis.matchMedia = () => ({ matches: false });",
    "globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};",
    "if (!globalThis.crypto || !globalThis.crypto.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_inert' };",
    "const app = await import(process.env.APP_URL);",
    "console.log('GUARD8-IMPORT timers=' + counts.timers + ' intervals=' + counts.intervals + ' fetches=' + counts.fetches + ' raf=' + counts.raf + ' listeners=' + counts.types.join(','));",
    // No Capacitor anywhere: this is the plain-web case, and the loop is empty
    // apart from the deadline this call is about to arm.
    "globalThis.window.supabase = undefined;",
    "const t0 = Date.now();",
    "const answer = await app.ensureSupabaseSdkLoaded({ timeoutMs: 40 });",
    "console.log('GUARD8-DEADLINE resolved=' + String(answer) + ' elapsed=' + (Date.now() - t0));",
  ].join('\n');
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, APP_URL: appUrl },
  });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  const imp = /GUARD8-IMPORT timers=(\d+) intervals=(\d+) fetches=(\d+) raf=(\d+) listeners=(.*)/.exec(out);
  const dl = /GUARD8-DEADLINE resolved=(\w+) elapsed=(\d+)/.exec(out);
  assert(!!imp, `[8a] fixture: the child imported js/app.js and reported its import surface (a missing line would make 8b vacuous)${imp ? '' : '\n' + out.slice(-900)}`);
  if (imp) {
    assert(imp[1] === '0' && imp[2] === '0' && imp[3] === '0' && imp[4] === '0',
      `[8b] importing js/app.js with NO Capacitor schedules nothing: 0 timers, 0 intervals, 0 fetches, 0 rAF (got timers=${imp[1]} intervals=${imp[2]} fetches=${imp[3]} raf=${imp[4]})`);
    assert(imp[5].trim() === 'doc:DOMContentLoaded',
      `[8c] …and registers exactly the one pre-existing boot hook, no native listener beside it (got "${imp[5].trim()}")`);
  }
  assert(run.status === 0,
    `[8d] RG-192 — the child EXITS 0. Exit 13 here is "unsettled top-level await": ensureSupabaseSdkLoaded()'s deadline could not settle its own promise without an unrelated ref'd handle alive (got ${run.status}${run.error ? ' — ' + run.error.message : ''})${run.status === 0 ? '' : '\n' + out.slice(-900)}`);
  assert(!!dl && dl[1] === 'false',
    `[8e] RG-192 — …because the deadline resolved FALSE on its own, in an empty event loop, with nothing else keeping the process alive (got ${dl ? dl[1] : 'no GUARD8-DEADLINE line at all'})`);
  assert(!!dl && Number(dl[2]) >= 40 && Number(dl[2]) < 5000,
    `[8f] …at the deadline it was given, not at the 10-second production one (got ${dl ? dl[2] + 'ms' : 'no timing'})`);
  assert(!/unsettled top-level await/i.test(out),
    '[8g] …and Node printed no unsettled-top-level-await warning — the shape this defect reported as, with zero failed assertions anywhere');
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
