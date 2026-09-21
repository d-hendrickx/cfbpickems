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
 * Covers:
 *   [1] js/backend.js — pingBackend() refuses loudly on a genuine native
 *       origin (isNativeShell() true AND location.protocol==='capacitor:'),
 *       and never reaches fetch().
 *   [2] js/backend.js — the SAME spoof S-C1/S-C8 exist to stop (a fully
 *       native-shaped window.Capacitor on a real https: origin) does NOT
 *       trigger the refusal — proceeds to the ordinary "not configured"
 *       error exactly as web always has.
 *   [3] js/backend.js — plain web (no window.Capacitor at all) is
 *       byte-unaffected: same "not configured" error, same shape.
 *   [4] js/chatTransport.js — appendEvents()/fetchSince() refuse loudly on a
 *       genuine native origin, and never reach fetch().
 *   [5] js/chatTransport.js — the same spoof-on-https proof, mirrored.
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

// ─────────────────────────────────────────────────────────────────────────────
// [1] backend.js — genuine native origin refuses loudly, never reaches fetch
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] js/backend.js call() (via pingBackend()) — genuine native origin refuses…');
{
  backend.setBackendConfig('https://script.google.com/macros/s/FAKE/exec', 'tok');
  setOrigin({ native: true, scheme: 'capacitor:' });
  fetchCalls = 0;
  const res = await backend.pingBackend();
  assert(res.ok === false, '[1a] pingBackend() resolves ok:false on a genuine native origin');
  assert(/AD-67|native app/i.test(res.error || ''), `[1b] the error names the native refusal, not a generic backend failure (got "${res.error}")`);
  assert(fetchCalls === 0, '[1c] …and fetch() was NEVER called — the refusal is the first line of call(), before even the allow-list guard');
  backend.clearBackendConfig();
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] backend.js — SPOOF PROOF: native-shaped window.Capacitor on https: does
//     NOT trigger the refusal (origin-positive, mirrors S-C1/S-C8)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] js/backend.js call() — SPOOFED window.Capacitor on a real https: origin must NOT refuse…');
{
  backend.clearBackendConfig();   // no config → the ORDINARY "not configured" path
  setOrigin({ native: true, scheme: 'https:' });   // the spoof: native-shaped, real web origin
  fetchCalls = 0;
  const res = await backend.pingBackend();
  assert(res.ok === false, '[2a] still resolves ok:false (no config set) — same failure shape as always');
  assert(!/AD-67|native app/i.test(res.error || ''), `[2b] the error is the ORDINARY "not configured" message, NOT the native refusal (got "${res.error}") — a spoof on https: cannot masquerade as native`);
  assert(/not configured/i.test(res.error || ''), `[2c] specifically the pre-existing "Backend not configured" error (got "${res.error}")`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] backend.js — plain web (no window.Capacitor at all) is byte-unaffected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] js/backend.js call() — plain web, no Capacitor anywhere, unaffected…');
{
  backend.clearBackendConfig();
  setOrigin({ native: false, scheme: 'https:' });
  fetchCalls = 0;
  const res = await backend.pingBackend();
  assert(res.ok === false && /not configured/i.test(res.error || ''),
    `[3a] identical "not configured" failure on plain web (got "${res.error}")`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] chatTransport.js — genuine native origin refuses loudly, never fetches
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] js/chatTransport.js get()/post() (via fetchSince()/appendEvents()) — genuine native origin refuses…');
{
  backend.setBackendConfig('https://script.google.com/macros/s/FAKE/exec', 'tok');
  setOrigin({ native: true, scheme: 'capacitor:' });
  fetchCalls = 0;

  let getErr = null;
  try { await chatTransport.fetchSince(0, 10); } catch (e) { getErr = e; }
  assert(getErr && /AD-67|native app/i.test(String(getErr.message || getErr)),
    `[4a] fetchSince() (get()) throws the native refusal (got ${getErr ? getErr.message : 'no throw'})`);
  assert(fetchCalls === 0, '[4b] …and fetch() was never called (get())');

  let postErr = null;
  try { await chatTransport.appendEvents([{ id: 'e1', seq: 1 }]); } catch (e) { postErr = e; }
  assert(postErr && /AD-67|native app/i.test(String(postErr.message || postErr)),
    `[4c] appendEvents() (post()) throws the native refusal (got ${postErr ? postErr.message : 'no throw'})`);
  assert(fetchCalls === 0, '[4d] …and fetch() was never called (post())');

  backend.clearBackendConfig();
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] chatTransport.js — SPOOF PROOF, mirrored
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] js/chatTransport.js get()/post() — SPOOFED window.Capacitor on a real https: origin must NOT refuse…');
{
  backend.clearBackendConfig();
  setOrigin({ native: true, scheme: 'https:' });
  fetchCalls = 0;

  let getErr = null;
  try { await chatTransport.fetchSince(0, 10); } catch (e) { getErr = e; }
  assert(getErr && !/AD-67|native app/i.test(String(getErr.message || getErr)),
    `[5a] fetchSince() does NOT throw the native refusal on a spoofed-but-https origin (got ${getErr ? getErr.message : 'no throw'})`);
  assert(getErr && /not configured/i.test(String(getErr.message || getErr)),
    `[5b] …it throws the ORDINARY "not configured" error instead (got ${getErr ? getErr.message : 'no throw'})`);
}

// Restore a clean global state (defensive — this file exits right after).
delete globalThis.window;
delete globalThis.location;

// ─────────────────────────────────────────────────────────────────────────────
// [6] Source-level guard: js/backend.js and js/chatTransport.js each import
//     isNativeOrigin() from js/platform.js — never re-implement the predicate
//     (AD-68's single-source-of-truth rule extends to the security branches).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] Source-level — both files import isNativeOrigin() from js/platform.js, not a second implementation…');
{
  const backendSrc = await readFile('./js/backend.js', 'utf8');
  const transportSrc = await readFile('./js/chatTransport.js', 'utf8');
  assert(/import\s*\{\s*isNativeOrigin\s*\}\s*from\s*['"]\.\/platform\.js['"]/.test(backendSrc),
    '[6a] js/backend.js imports isNativeOrigin from ./platform.js');
  assert(/import\s*\{\s*isNativeOrigin\s*\}\s*from\s*['"]\.\/platform\.js['"]/.test(transportSrc),
    '[6b] js/chatTransport.js imports isNativeOrigin from ./platform.js');
  assert(!/location\.protocol\s*===?\s*['"]capacitor:/.test(backendSrc),
    '[6c] js/backend.js never re-implements the origin check inline (no second location.protocol literal)');
  assert(!/location\.protocol\s*===?\s*['"]capacitor:/.test(transportSrc),
    '[6d] js/chatTransport.js never re-implements the origin check inline');
}

// ─────────────────────────────────────────────────────────────────────────────
// [7] Source-level — the Cloud Sync card is not rendered inside the shell
//     (DI-208g/S-C14's other half: hiding the UI path a spoofed shell could
//     otherwise POST through, alongside the runtime refusal proved above).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] Source-level — js/app.js does not render the Cloud Sync card inside the native shell…');
{
  const appSrc = await readFile('./js/app.js', 'utf8');
  assert(/if \(!isNativeShell\(\)\) sections\.push\(`\s*\n\s*<div class="admin-section" data-comm-tab="data">\s*\n\s*<div class="admin-section-title">☁️ Cloud Sync/.test(appSrc),
    '[7a] the Cloud Sync admin-section push is gated on !isNativeShell() — on native, the section (and its be-* inputs) is never added to the panel HTML at all');
  // No separate guard is needed at the be-* handler-binding block: those
  // handlers all use `document.getElementById('be-...')?.addEventListener`,
  // and an element that was never rendered is `null` there too — the
  // optional-chain no-ops automatically once the card above stops rendering.
  assert(/document\.getElementById\('be-test-btn'\)\?\.addEventListener/.test(appSrc),
    '[7b] the be-* handler bindings still use optional chaining (no separate native guard needed there — a missing element already no-ops)');
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
