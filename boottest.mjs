/**
 * CFB Pickems — boottest.mjs
 * ==========================
 * BUG-F (2026-09-11) — "sometimes the chat still stays blank for a minute
 * before all of the previous messages populate again." Installed iOS PWA,
 * v0.20.1, fresh open. Chat head ~234 events — ONE page. A cold Apps Script
 * start is 5-10s, so the server does not explain a minute.
 *
 * Run:  node boottest.mjs
 *
 * A SEPARATE FILE, for backendtest.mjs's reason plus one of its own: these
 * suites replace the global CLOCK. Every assertion here is about WHEN
 * something happens, not what it contains, so setTimeout/clearTimeout/
 * Math.random are stubbed for whole sections. Doing that inside loadtest.mjs
 * would make every suite after it non-deterministic.
 *
 * WHAT THE MEASUREMENTS SHOWED (numbers printed by §1 below)
 * ----------------------------------------------------------
 * The transport's poll interval is chosen by ROOM ACTIVITY (INTERVALS in
 * chatTransport.js: hot 5s / warm 15s / idle 45s / closed 60s). On a fresh
 * open the player lands on the DASHBOARD, so chat.js's roomMode() returns
 * 'closed' — 60s, ±20% jitter.
 *
 * That interval is the right clock for "nothing has changed since we last
 * looked." It is the WRONG clock for "we have never managed to look." Before
 * this fix, EVERY way the first tick could fail to produce the room deferred
 * the next attempt by a full room interval:
 *
 *   a) the first chatSince answers with head 0 / no events (a cold-start read
 *      of a sheet whose getLastRow() has not warmed up). drainSince() computes
 *      caughtUp = (0 >= 0) = TRUE, tick() counts it a success, resets the
 *      backoff — and the empty room is scheduled to be re-checked in 48-72s;
 *   b) the first chatSince answers with an empty page while reporting an
 *      honest head (caughtUp false) — the walk stops, correctly, but the next
 *      attempt is again a full room interval away;
 *   c) document.hidden is true at the first tick (iOS standalone launches the
 *      webview behind the splash screen) and the visibilitychange that would
 *      have woken us never arrives — 48-72s;
 *   d) isBackendConfigured() is false at the first tick because config.json
 *      has not landed yet. NOTHING fires when it does — 48-72s;
 *   e) the tick throws. The error ladder [2s, 5s, 15s, 60s] is fine in the
 *      steady state but costs 22s across three failures at boot — and each
 *      failing attempt may itself have burned 3 round trips plus 1.6s of
 *      misroute backoff first.
 *
 * All five are the same root cause wearing five costumes: the poll interval is
 * derived from room activity even when the transport has never once seen the
 * room. The fix is one scheduling rule — a bounded BOOT ladder that governs
 * until a caught-up delivery with a real head has landed, plus a short
 * catch-up delay whenever a drain ends short of the head. The steady state,
 * which is what protects the Apps Script quota, is unchanged (§7 pins that).
 *
 * §8 covers BUG-E, the same boot window from the other side: a transient HTTP
 * 404 (Google's redirect leg, observed by Drew the same day) or 5xx was not
 * retried at all — one flake at boot became a red banner, or a failed first
 * chat tick.
 *
 * NOT COVERED HERE — stated so it is never mistaken for covered:
 *   • whether iOS standalone actually fires visibilitychange on a fresh open.
 *     §5 proves the transport RECOVERS if it does not; only a device can say
 *     whether it does.
 *   • the real Apps Script cold-start latency. Modelled, never measured here.
 *   • app.js's boot ORDER (initChatUI() runs after `await hydrateBackend()`),
 *     which is measured in §1 and reported to Drew — the fix for it is not in
 *     this agent's files.
 */

// ── DOM / browser stubs ──────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const listeners = new Map();
globalThis.document = {
  hidden: false,
  addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
  removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
};
function fireVisibilityChange() { (listeners.get('visibilitychange') || new Set()).forEach(fn => { try { fn(); } catch {} }); }
globalThis.window = globalThis;
// BUG-12 (2026-09-12) — the transport also wakes on a window `focus` event now
// (§11: an iOS standalone resume from a notification tap does not reliably
// fire visibilitychange), so the window half of the stub has to hold and fire
// listeners too. Node's globalThis has no addEventListener of its own, which
// is exactly why the production code guards the registration.
const winListeners = new Map();
globalThis.addEventListener = (type, fn) => { if (!winListeners.has(type)) winListeners.set(type, new Set()); winListeners.get(type).add(fn); };
globalThis.removeEventListener = (type, fn) => { winListeners.get(type)?.delete(fn); };
function fireFocus() { (winListeners.get('focus') || new Set()).forEach(fn => { try { fn(); } catch {} }); }
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
// HARNESS HARDENING (2026-09-17): bound to the REAL console at import time.
// Several sections stub console.error/console.warn to capture what the app
// logs, and a failure inside one of those windows used to be COUNTED but never
// PRINTED — "1 failed" with nothing shown is the same unfalsifiable shape
// RG-41b is about, and it cost this pass twenty minutes in authtest.
const _realLog = console.log.bind(console);
const _realErr = console.error.bind(console);
function assert(cond, label) {
  if (cond) { pass++; _realLog('  ✅', label); }
  else { fail++; _realErr('  ❌', label); }
}
function note(...a) { console.log('     ·', ...a); }

// ── Fake clock ───────────────────────────────────────────────────────────────
// Virtual time in ms. `NOW` is the only clock the code under test can see for
// scheduling; every measurement below is read off it, so a "60 second" result
// is 60 virtual seconds and the suite still finishes instantly.
const _realSetTimeout = globalThis.setTimeout;
const _realClearTimeout = globalThis.clearTimeout;
const _realRandom = Math.random;
let NOW = 0;
let timers = new Map();
let tid = 0;

function installFakeClock() {
  NOW = 0; timers = new Map(); tid = 0;
  globalThis.setTimeout = (fn, ms) => {
    const id = ++tid;
    timers.set(id, { at: NOW + Math.max(0, Number(ms) || 0), fn });
    return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  Math.random = () => 0.5;          // jitter(x) === x, so every delay is exact
}
function restoreClock() {
  globalThis.setTimeout = _realSetTimeout;
  globalThis.clearTimeout = _realClearTimeout;
  Math.random = _realRandom;
}
const micro = () => new Promise(r => _realSetTimeout(r, 0));
async function settle(n = 30) { for (let i = 0; i < n; i++) await micro(); }

/** Advance virtual time by `ms`, firing every timer due in that window in order. */
async function advance(ms) {
  const deadline = NOW + ms;
  await settle();
  for (;;) {
    let pick = null;
    for (const [id, t] of timers) if (!pick || t.at < pick.t.at) pick = { id, t };
    if (!pick || pick.t.at > deadline) break;
    timers.delete(pick.id);
    NOW = pick.t.at;
    try { pick.t.fn(); } catch { /* the code under test guards its own ticks */ }
    await settle();
  }
  NOW = deadline;
}
/** A fake-clock sleep, so the fetch stub can model server latency. */
const sleep = ms => new Promise(r => globalThis.setTimeout(r, ms));

// ── Server mock ──────────────────────────────────────────────────────────────
const N = 234;                      // Drew's real chat head on 2026-09-11: one page
const MAX_FAST_CATCHUPS_EXPECTED = 5;   // mirrors chatTransport.js's MAX_FAST_CATCHUPS
const COLD_MS = 8000;               // modelled Apps Script cold start
const WARM_MS = 900;                // modelled warm round trip

const mkEv = seq => ({ id: 'b' + seq, seq, ts: 1_700_000_000_000 + seq, type: 'message',
                       author: 'p1', body: 'msg ' + seq, notify: false });
const PING = () => ({ ok: true, time: 'now', service: 'cfbp-backend', version: 2 });

function honestSince(afterSeq, limit) {
  const cap = Math.max(1, Math.min(limit || 500, 1000));
  if (N <= afterSeq) return { ok: true, events: [], head: N };
  const count = Math.min(cap, N - afterSeq);
  const events = [];
  for (let s = afterSeq + 1; s <= afterSeq + count; s++) events.push(mkEv(s));
  return { ok: true, events, head: N };
}

/**
 * Installs a fetch stub driven by a per-call SCRIPT of shapes.
 *   'ok'       — an honest chatSince/chatHead answer
 *   'head0'    — {events: [], head: 0}: the cold-start read that reports an
 *                empty room while the sheet holds 234 rows
 *   'empty'    — {events: [], head: 234}: an empty page, honest head
 *   'misroute' — the ping payload (BUG-A's shape)
 *   404 | 503  — res.ok === false with that status
 *   'boom'     — the fetch itself rejects (radio asleep)
 * A script entry is consumed per HTTP REQUEST, so one 'misroute' costs one
 * request and the misroute guard's own retry consumes the next entry.
 */
function installFetch({ script = [], latency = () => WARM_MS } = {}) {
  const calls = [];
  const queue = script.slice();
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url), 'https://example.invalid/');
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch { body = null; } }
    const action = u.searchParams.get('action') || body?.action || '';
    const seq = Number(u.searchParams.get('seq') || 0);
    const limit = Number(u.searchParams.get('limit') || 0);
    const i = calls.length;
    calls.push({ action, seq, limit, at: NOW });
    await sleep(latency(i));
    const shape = queue.length ? queue.shift() : 'ok';
    if (shape === 'boom') throw new Error('Load failed');
    if (typeof shape === 'number') return { ok: false, status: shape, json: async () => ({}) };
    if (shape === 'misroute') return { ok: true, status: 200, json: async () => PING() };
    if (shape === 'head0') return { ok: true, status: 200, json: async () => ({ ok: true, events: [], head: 0 }) };
    if (shape === 'empty') return { ok: true, status: 200, json: async () => ({ ok: true, events: [], head: N }) };
    if (action === 'chatHead') return { ok: true, status: 200, json: async () => ({ ok: true, head: N }) };
    if (action === 'chatSince') { const r = honestSince(seq, limit); return { ok: true, status: 200, json: async () => r }; }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return calls;
}

const backend = await import('./js/backend.js');
const transport = await import('./js/chatTransport.js');
const URL_FAKE = 'https://script.google.com/macros/s/FAKE/exec';

/**
 * Drive the REAL transport.subscribe() through a cold boot and report WHEN the
 * room first became complete on screen.
 *
 * The fold is a stand-in for chat.js's (deliberately — chat.js is being edited
 * by another agent this session, and the question here is purely "when does
 * the transport deliver", not "how does the fold merge"). It applies the same
 * contract chat.js does: ingest events, adopt the reported head as the cursor.
 */
async function coldBoot({
  script = [],
  latency = i => (i === 0 ? COLD_MS : WARM_MS),
  mode = 'closed',                  // fresh open lands on the dashboard
  hidden = false,
  configured = true,
  budgetMs = 180000,
  beforeTicks = null,               // (ctx) => void, called before time advances
} = {}) {
  installFakeClock();
  const calls = installFetch({ script, latency });
  document.hidden = hidden;
  if (configured) backend.setBackendConfig(URL_FAKE, 'tok'); else backend.clearBackendConfig();

  const folded = new Map();
  let head = 0;
  let completeAt = null;
  const deliveries = [];
  const unsub = transport.subscribe((events, h, delivery) => {
    (events || []).forEach(e => folded.set(e.id, e));
    if (typeof h === 'number' && h > head) head = h;
    deliveries.push({ n: (events || []).length, head: h, caughtUp: delivery?.caughtUp, at: NOW });
    if (completeAt === null && folded.size >= N) completeAt = NOW;
  }, { getMode: () => mode, getKnownHead: () => head });

  const ctx = { calls, deliveries, setHidden: v => { document.hidden = v; },
                fireVisibilityChange, configure: () => backend.setBackendConfig(URL_FAKE, 'tok') };
  if (beforeTicks) beforeTicks(ctx);

  const STEP = 250;
  for (let t = 0; t < budgetMs && completeAt === null; t += STEP) await advance(STEP);

  // The delay the transport has scheduled for its NEXT attempt, as of now.
  let nextIn = null;
  for (const [, tm] of timers) { const d = tm.at - NOW; if (nextIn === null || d < nextIn) nextIn = d; }

  unsub();
  restoreClock();
  document.hidden = false;
  return { completeAt, calls, deliveries, folded, nextIn, endedAt: NOW };
}

const fmt = ms => (ms === null ? 'NEVER (inside the budget)' : (ms / 1000).toFixed(2) + 's');

// ═══════════════════════════════════════════════════════════════════════════
// [1] THE BOOT TIMELINE, MEASURED. Diagnostic — no assertion pins a broken
// number, because a test that pins today's behaviour can never go red for it.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] Boot timeline — every wait between "app opens" and "the room is on screen"…');
{
  const healthy = await coldBoot({});
  note(`healthy cold open, first request served in ${COLD_MS / 1000}s: room complete at ${fmt(healthy.completeAt)}`);
  note(`  requests: [${healthy.calls.map(c => c.action + ':' + c.seq).join(', ')}]`);
  assert(healthy.completeAt !== null && healthy.completeAt <= COLD_MS + 500,
    `a healthy cold boot is one request and one fold — ${fmt(healthy.completeAt)}`);
  assert(healthy.calls.filter(c => c.action === 'chatHead').length === 0,
    'and it still skips the head probe entirely on a cold boot (RG-91) — one Apps Script cold start, not two');

  // What app.js used to put in FRONT of that: the chat subscription was not
  // started until `await hydrateBackend()` resolved (js/app.js:294 -> :319).
  // That was BUG-G, reported from here on 2026-09-11 and fixed on 2026-09-11
  // — §10 below is its reproduction and its guard. This note stays as the
  // measurement that found it; the char positions it prints now show the
  // early call AHEAD of the hydrate.
  const { readFileSync } = await import('node:fs');
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  // Semicolon deliberate — see §10E's note on the same match: app.js's own
  // BUG-G comment quotes `await hydrateBackend()` above the real call.
  const hydrateAt = appSrc.indexOf('await hydrateBackend();');
  // The LATE phase specifically (`initChatUI(); updateChatBadges()`), not a
  // bare 'initChatUI()' — which since BUG-G also matches this file's own
  // prose about it a few lines earlier in app.js.
  const initChatAt = appSrc.indexOf('initChatUI(); updateChatBadges()');
  note(`js/app.js boot order today: hydrate at char ${hydrateAt}, initChatUI at char ${initChatAt}` +
       ` — chat starts ${initChatAt > hydrateAt ? 'AFTER' : 'BEFORE'} the getAll completes`);
  const earlyAt1 = appSrc.indexOf("initChatUI({ phase: 'early' })");
  note(`  and the EARLY phase (BUG-G, §10) is at char ${earlyAt1} — ${earlyAt1 > -1 && earlyAt1 < hydrateAt ? 'ahead of the getAll, so the first chatSince no longer waits on it' : 'MISSING or after the getAll'}.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [2] THE REPORTED BUG, COSTUME (a): a first read that reports an empty room.
// ═══════════════════════════════════════════════════════════════════════════
// chatSince(0) -> {events: [], head: 0} while the sheet holds 234 rows.
// drainSince(): maxSeq (0) >= head (0) -> caughtUp TRUE -> tick() calls it a
// success, clears the backoff, and schedules the next look at the ROOM
// interval. The room is 'closed' on a fresh open (the player is on the
// dashboard), so that is 60s ± jitter. The player sees a blank chat for a
// minute and then "all of the previous messages populate again" — verbatim.
console.log('\n[2] A first read that reports an empty room must not cost a full poll interval…');
{
  const r = await coldBoot({ script: ['head0'] });
  note(`room complete at ${fmt(r.completeAt)} (deliveries: ${JSON.stringify(r.deliveries.map(d => [d.n, d.head, d.caughtUp]))})`);
  assert(r.completeAt !== null && r.completeAt <= 20000,
    `a cold-start read that reports head 0 is retried promptly, not a minute later — ${fmt(r.completeAt)}`);
  assert(r.folded.size === N, `and all ${N} events land once it is (got ${r.folded.size})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [3] COSTUME (b): an empty page with an HONEST head — we know we are behind.
// ═══════════════════════════════════════════════════════════════════════════
// drainSince() stops the walk (correct — [72]F proves a server that cannot
// advance the cursor must never spin the loop), but "the walk stopped short of
// the head" is precisely the state that should be re-tried SOON, not at the
// idle-room cadence. Same for the MAX_PAGES_PER_TICK bound.
console.log('\n[3] A drain that ends SHORT of the head retries soon, not at the room interval…');
{
  const r = await coldBoot({ script: ['empty'] });
  note(`room complete at ${fmt(r.completeAt)}`);
  assert(r.completeAt !== null && r.completeAt <= 20000,
    `an empty page with an honest head is a known-behind state and retries fast — ${fmt(r.completeAt)}`);
  assert(r.deliveries[0]?.caughtUp === false,
    'the first delivery is correctly marked not-caught-up (BUG-C contract unchanged)');
}

// ═══════════════════════════════════════════════════════════════════════════
// [4] COSTUME (e): the first ticks THROW. The error ladder is a steady-state
// ladder; at boot it is far too slow.
// ═══════════════════════════════════════════════════════════════════════════
// Three consecutive misrouted ticks (BUG-A's live shape, seen by Drew the same
// day). Each tick burns 3 requests + 1.6s of misroute backoff before throwing,
// and the OLD tick ladder then waited 2s, 5s, 15s between them.
console.log('\n[4] Repeated failures at boot retry on a boot ladder, not the 2/5/15/60s steady-state one…');
{
  const script = [];
  for (let i = 0; i < 9; i++) script.push('misroute');    // three ticks' worth
  const r = await coldBoot({ script, latency: i => (i === 0 ? COLD_MS : 300) });
  note(`room complete at ${fmt(r.completeAt)} after ${r.calls.length} requests`);
  assert(r.completeAt !== null && r.completeAt <= 30000,
    `three failed boot ticks do not push the room past half a minute — ${fmt(r.completeAt)}`);
  assert(r.folded.size === N, `and the room is complete when it lands (got ${r.folded.size} of ${N})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [5] COSTUME (c): hidden at the first tick, and visibilitychange never fires.
// ═══════════════════════════════════════════════════════════════════════════
// iOS standalone launches the webview behind the splash screen. The transport
// correctly refuses to FETCH while document.hidden — that is the mechanism
// RG-96's burst cap leans on and it is untouched here. What it must not do is
// schedule the retry at the room interval: nothing else will wake it if the
// visibilitychange the resume relies on does not arrive.
console.log('\n[5] Hidden at the first tick + no visibilitychange: the room still arrives promptly…');
{
  const r = await coldBoot({
    hidden: true,
    beforeTicks: ctx => { globalThis.setTimeout(() => ctx.setHidden(false), 3000); },   // visible at t=3s, NO event fired
  });
  note(`room complete at ${fmt(r.completeAt)}`);
  assert(r.completeAt !== null && r.completeAt <= 20000,
    `a missed visibilitychange costs seconds, not a minute — ${fmt(r.completeAt)}`);
  const fetchedWhileHidden = r.calls.filter(c => c.at < 3000).length;
  assert(fetchedWhileHidden === 0,
    `and NOTHING is fetched while hidden — the RG-96 burst bound is untouched (got ${fetchedWhileHidden} requests before t=3s)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [6] COSTUME (d): not configured at the first tick. Nothing fires when it is.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] Backend config lands a moment after the first tick (no event to wake the poller)…');
{
  const r = await coldBoot({
    configured: false,
    beforeTicks: ctx => { globalThis.setTimeout(() => ctx.configure(), 2000); },
  });
  note(`room complete at ${fmt(r.completeAt)}`);
  assert(r.completeAt !== null && r.completeAt <= 20000,
    `a late config.json costs seconds, not a minute — ${fmt(r.completeAt)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [7] THE STEADY STATE IS UNCHANGED. This is the guard on the guard: a boot
// ladder that never ends is a quota bug wearing a fix's clothes.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] Once the room has been seen, the poll cadence is the room interval again…');
{
  const r = await coldBoot({ mode: 'idle' });
  assert(r.completeAt !== null, 'the room completed (fixture check — the cadence assertions below need it)');
  assert(r.nextIn === 45000,
    `after a caught-up delivery the next poll is the 'idle' room interval, 45s — got ${r.nextIn}ms`);

  const rc = await coldBoot({ mode: 'closed' });
  assert(rc.nextIn === 60000,
    `and 60s with the room 'closed' — the quota-protecting cadence is untouched — got ${rc.nextIn}ms`);

  // A server that is simply DOWN must not be polled forever on the fast ladder.
  // A 400 is permanent, so the misroute/transient guard does NOT retry it and
  // one request is exactly one tick — which makes the gaps here the TICK
  // cadence rather than a mix of tick cadence and in-request retry backoff.
  const down = await coldBoot({ script: Array.from({ length: 400 }, () => 400), latency: () => 300, budgetMs: 120000 });
  assert(down.completeAt === null, 'fixture: a permanently failing server never completes the room');
  const gaps = down.calls.slice(1).map((c, i) => c.at - down.calls[i].at);
  const lastGap = gaps.length ? gaps[gaps.length - 1] : 0;
  assert(lastGap >= 45000,
    `an unreachable backend settles back to a slow cadence instead of hammering — last tick gap ${lastGap}ms (all: [${gaps.join(', ')}])`);
  note(`  ${down.calls.length} ticks in ${fmt(down.endedAt)} against a dead server`);
  assert(down.calls.length <= 10,
    `and the boot ladder is BOUNDED — a dead backend costs a handful of extra probes, not a permanent fast poll (got ${down.calls.length} ticks in 120s)`);

  // The fast catch-up path is bounded too. A server that keeps reporting a head
  // the walk cannot reach (MAX_PAGES_PER_TICK hit every tick) must not be polled
  // at 20 pages per SECOND forever — that would be 20× the traffic the old 45s
  // cadence allowed, a quota regression hiding inside a latency fix.
  {
    const HUGE = 1_000_000;
    installFakeClock();
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = new URL(String(url), 'https://example.invalid/');
      const seq = Number(u.searchParams.get('seq') || 0);
      calls.push({ action: u.searchParams.get('action'), seq, at: NOW });
      await sleep(10);
      const events = [];
      for (let s = seq + 1; s <= seq + 50; s++) events.push(mkEv(s));   // honest, but slow
      return { ok: true, status: 200, json: async () => ({ ok: true, events, head: HUGE }) };
    };
    backend.setBackendConfig(URL_FAKE, 'tok');
    let known = 0;
    const unsub = transport.subscribe((events, h) => { if (typeof h === 'number' && h > known) known = h; },
      { getMode: () => 'idle', getKnownHead: () => known });
    for (let t = 0; t < 120000; t += 250) await advance(250);
    unsub(); restoreClock(); backend.clearBackendConfig();

    // A tick is a burst of pages; pages inside one tick are ~10ms apart.
    const tickGaps = [];
    for (let i = 1; i < calls.length; i++) { const g = calls[i].at - calls[i - 1].at; if (g > 500) tickGaps.push(g); }
    note(`  never-ending backlog: ${calls.length} requests over ${tickGaps.length + 1} ticks in 120s, tick gaps [${tickGaps.join(', ')}]`);
    // Both bounded mechanisms apply here, in sequence, because this server never
    // lets the room be SEEN: five accelerated catch-up rounds at 1s, then the
    // boot ladder (whose own first rung is also 1s), then the room interval. So
    // the bound to assert is MAX_FAST_CATCHUPS + 1, and the tail is what proves
    // neither mechanism runs forever.
    const fastRounds = tickGaps.filter(g => g <= 1500).length;
    assert(fastRounds <= MAX_FAST_CATCHUPS_EXPECTED + 1,
      `the 1s catch-up path is bounded — ${MAX_FAST_CATCHUPS_EXPECTED} rounds plus the boot ladder's first rung (got ${fastRounds})`);
    assert(tickGaps.slice(-1)[0] >= 45000,
      'and it ends at the room interval — a server we can never catch up with is a broken server, not a backlog');
    assert(calls.length <= 300,
      `total traffic against a never-ending backlog stays bounded (got ${calls.length} requests in 120s)`);
  }

  // Same 120s against a TRANSIENT (retried) failure: the in-request retries
  // multiply each tick by up to 3, so the worst-case boot-window traffic is
  // stated here as a number rather than left to be discovered on the quota page.
  const down5 = await coldBoot({ script: Array.from({ length: 400 }, () => 503), latency: () => 300, budgetMs: 120000 });
  note(`  ${down5.calls.length} requests in ${fmt(down5.endedAt)} against a 503 server (ticks × up to 3 attempts)`);
  assert(down5.calls.length <= 30,
    `worst-case boot traffic against a flapping backend stays bounded (got ${down5.calls.length} requests in 120s)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [8] BUG-E — transient HTTP is retried; spend actions never are.
// ═══════════════════════════════════════════════════════════════════════════
// Drew saw a 404 on 2026-09-11 from Google's redirect leg on a request that
// had already completed server-side. requestWithMisrouteGuard() retried
// MISROUTES only; `if (!res.ok) throw` went straight out to the caller. One
// flake at boot = a red sync banner, or a dead first chat tick.
console.log('\n[8] Transient HTTP 404/5xx are retried on the same schedule; scribeAsk/runTrainer never are…');
{
  installFakeClock();
  const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
  const GETALL_OK = () => ({ ok: true, data: {
    cfbp_players: NAMES.map((n, i) => ({ playerId: `p${i}`, displayName: n, active: true })),
    cfbp_weeks: [{ weekId: 'w2026_1', status: 'OPEN' }],
    cfbp_picks: [{ pickId: 'pk1', playerId: 'p0', weekId: 'w2026_1' }],
  } });
  backend.setBackendConfig(URL_FAKE, 'tok');

  let calls = [], replies = [];
  globalThis.fetch = async (url, opts = {}) => {
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch { body = null; } }
    const u = new URL(String(url), 'https://example.invalid/');
    calls.push({ action: u.searchParams.get('action') || body?.action || '', at: NOW });
    if (!replies.length) throw new Error('fetch stub exhausted — more requests than the test queued');
    const next = replies.shift();
    if (typeof next === 'number') return { ok: false, status: next, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => next };
  };
  const arm = (...seq) => { calls = []; replies = seq.slice(); };
  const rejects = async p => { try { await p; return null; } catch (e) { return e; } };
  /** Run a promise to settlement while the fake clock keeps moving. */
  async function withClock(p) {
    let out = { done: false, val: null, err: null };
    p.then(v => { out = { done: true, val: v, err: null }; }, e => { out = { done: true, val: null, err: e }; });
    for (let i = 0; i < 40 && !out.done; i++) await advance(500);
    return out;
  }

  arm(404, GETALL_OK());
  let res = await withClock(backend.hydrate());
  assert(res.done && !res.err, `a single 404 on the redirect leg no longer fails the boot (got: ${res.err && res.err.message})`);
  assert(calls.length === 2, `it retried exactly once and the retry landed (got ${calls.length} requests)`);

  arm(503, 500, GETALL_OK());
  res = await withClock(backend.hydrate());
  assert(res.done && !res.err, `two transient 5xx in a row are both ridden out (got: ${res.err && res.err.message})`);
  assert(calls.length === 3, `three attempts total, matching the misroute schedule (got ${calls.length})`);

  arm(503, 503, 503);
  res = await withClock(backend.hydrate());
  assert(!!res.err, 'a PERSISTENT 503 still fails LOUD — AD-06, no silent fallback');
  assert(!!res.err && /503/.test(res.err.message), `and the error still names the status (got: ${res.err && res.err.message})`);
  assert(!!res.err && !/Sync refused/i.test(res.err.message),
    'and does not masquerade as the RG-12 data-loss guard');
  assert(calls.length === 3, `it gave up after three attempts (got ${calls.length})`);

  arm(400, GETALL_OK());
  res = await withClock(backend.hydrate());
  assert(!!res.err, 'a 400 (a real, permanent client error) is NOT retried — it fails immediately');
  assert(calls.length === 1, `exactly one request for a non-transient status (got ${calls.length})`);

  arm(503, 503, 503);
  res = await withClock(backend.runTrainerRemote({ adminPasswordHash: 'x' }));
  assert(!!res.err, 'runTrainer still throws on a transient failure');
  assert(calls.length === 1, `and sends EXACTLY ONE request — retrying a paid call could double-charge (got ${calls.length})`);

  arm(503, 503, 503);
  res = await withClock(backend.scribeAskRemote({ triggerMessageId: 'm1', playerId: 'p0' }));
  assert(!!res.err, 'scribeAsk still throws on a transient failure');
  assert(calls.length === 1, `and sends exactly one request (got ${calls.length})`);

  // chatTransport has its OWN fetch path (AD-16) — it must get the identical
  // treatment, or the two drift. This is CONVENTIONS #42's rule applied.
  arm(404, { ok: true, head: 234 });
  res = await withClock(transport.fetchHead());
  assert(res.done && !res.err && res.val?.head === 234,
    `chatTransport's GET path rides out a 404 too (got: ${res.err ? res.err.message : JSON.stringify(res.val)})`);
  assert(calls.length === 2, `two requests: the flake and the retry (got ${calls.length})`);

  arm(502, { ok: true, assigned: [{ id: 'e1', seq: 235 }], head: 235 });
  res = await withClock(transport.appendEvents([{ id: 'e1', body: 'hi' }]));
  assert(res.done && !res.err && res.val?.assigned?.length === 1,
    'chatTransport\'s POST path rides out a 502 — chatAppend is id-deduped server-side, so a resend is a no-op');

  arm(503, 503, 503);
  res = await withClock(transport.fetchSince(0, 500));
  assert(!!res.err && /503/.test(res.err.message),
    `and a persistent transient status is still thrown, clearly (got: ${res.err && res.err.message})`);

  restoreClock();
  backend.clearBackendConfig();
}

// ═══════════════════════════════════════════════════════════════════════════
// [9] SERVICE-WORKER CONVERGENCE AT BOOT — RULED OUT, not fixed.
// ═══════════════════════════════════════════════════════════════════════════
// Suspect 3 in the brief: could a fresh open of the installed PWA do a
// register -> reload -> re-boot cycle that doubles the boot (and discards the
// first chat drain)? These assertions passed BEFORE any change in this pass —
// they are recorded as a negative result, so the next person does not re-audit
// the same path. They are still worth keeping: they pin the property.
console.log('\n[9] A fresh open of the installed PWA does not reload itself (suspect ruled out)…');
{
  const sw = await import('./js/sw-register.js');
  const mkNav = ({ scriptURL, cacheName }) => {
    const handlers = new Map();
    const reg = {
      active: { scriptURL, postMessage() {}, addEventListener() {} },
      update: async () => { reg.updated = (reg.updated || 0) + 1; },
      addEventListener() {},
      updated: 0,
    };
    return {
      nav: {
        serviceWorker: {
          controller: { scriptURL, postMessage() {}, addEventListener() {} },
          getRegistration: async () => reg,
          register: async () => { nav.registered = (nav.registered || 0) + 1; return reg; },
          addEventListener: (t, fn) => handlers.set(t, fn),
        },
      },
      reg, handlers, cacheName,
    };
  };

  // Fresh open, app shell unchanged (no deploy since the last open).
  const a = mkNav({ scriptURL: 'https://irbfootball.com/service-worker.js?v=20-1', cacheName: 'cfb-pickems-v20-1' });
  const nav = a.nav; let registered = 0, reloads = 0;
  nav.serviceWorker.register = async () => { registered++; return a.reg; };
  await sw.setupServiceWorker({
    nav, scriptUrl: 'service-worker.js?v=20-1',
    reload: () => { reloads++; },
    readVersion: async () => a.cacheName,
    log: () => {}, warn: () => {},
  });
  const onChange = a.handlers.get('controllerchange');
  await onChange?.();
  assert(registered === 0 && a.reg.updated === 1,
    'an already-registered worker (same basename) is update()d, never re-registered — no install churn on a fresh open');
  assert(reloads === 0,
    'and a controllerchange with an IDENTICAL CACHE_NAME does not reload — a fresh open cannot double-boot itself');

  // A genuine release: exactly one reload, which is the intended behaviour.
  const b = mkNav({ scriptURL: 'https://irbfootball.com/service-worker.js?v=20-1', cacheName: 'cfb-pickems-v20-1' });
  let reloads2 = 0, versions = ['cfb-pickems-v20-1', 'cfb-pickems-v20-2', 'cfb-pickems-v20-2'];
  await sw.setupServiceWorker({
    nav: b.nav, scriptUrl: 'service-worker.js?v=20-2',
    reload: () => { reloads2++; },
    readVersion: async () => versions.shift() || 'cfb-pickems-v20-2',
    log: () => {}, warn: () => {},
  });
  const onChange2 = b.handlers.get('controllerchange');
  await onChange2?.();
  await onChange2?.();
  assert(reloads2 === 1, `a real CACHE_NAME change reloads exactly once (got ${reloads2})`);
}

// ── §8b — RG-99 F3/F4 (reviewer, 2026-09-11): the transient predicate itself ─
// F4: `transientHttpStatus` is exported; this is its caller. F3: 429 is a quota
// answer and must NOT classify as transient; 400/401/403 never do; the 5xx
// family and the redirect-leg 404 do. Also proves the message-text fallback.
{
  const { transientHttpStatus } = await import('./js/backend.js');
  const mk = (status, msg) => Object.assign(new Error(msg || ('HTTP ' + status)), status ? { status } : {});
  for (const st of [404, 408, 425, 500, 502, 503, 504]) assert(transientHttpStatus(mk(st)) === st, `§8b ${st} classifies as transient`);
  for (const st of [400, 401, 403, 429]) assert(transientHttpStatus(mk(st)) === 0, `§8b ${st} is NOT transient (F3: 429 must fail loud, not retry fast)`);
  assert(transientHttpStatus(new Error('HTTP 503')) === 503, '§8b message-text fallback classifies HTTP 503 without err.status');
  assert(transientHttpStatus(new Error('Unauthorized')) === 0, '§8b a non-HTTP error is not transient');
  assert(transientHttpStatus(null) === 0, '§8b null-safe');
}

// ═══════════════════════════════════════════════════════════════════════════
// [10] BUG-G — THE HYDRATE GATE. The other half of "chat stays blank."
// ═══════════════════════════════════════════════════════════════════════════
// §1 above MEASURED the defect and reported it (js/app.js started the chat
// engine only after `await hydrateBackend()` resolved) but could not fail on
// it, because it was outside that session's editable files. This section is
// the reproduction, made permanent.
//
// The model, and it is deliberately the PESSIMISTIC one: Apps Script serves
// this deployment from ONE instance, so a cold start is paid by whatever
// request is in flight when it happens — not per request. `latency()` below
// therefore resolves EVERY request issued before t=COLD_MS at t=COLD_MS, and
// charges WARM_MS after that. The fix gets no credit at all for overlapping
// the chat round trip with the getAll; what it gets credit for is
//   (a) the cached room rendering at t=0 instead of t=(cold start), and
//   (b) the first chat request being ISSUED at t=0, so it completes one cold
//       start after boot instead of one cold start after the getAll.
//
// BROWSER-ONLY: the real cold-start latency, and whether the two requests
// truly share one instance. Both are modelled here, never measured.
console.log('\n[10] BUG-G — the chat engine must not wait on the hydrate getAll…');
{
  const chat = await import('./js/chat.js');
  const storage = await import('./js/storage.js');
  const K_EVENTS_CACHE = 'cfbp_chat_events_cache';

  // Checked, not assumed: without this the whole section throws a TypeError on
  // the pre-fix code and prints nothing, which is a crash rather than a
  // measurement. With it, the "after" arm below simply behaves like the
  // "before" arm and every delta assertion reports the real numbers it failed
  // on — which is what makes this section a reproduction rather than a smoke
  // alarm.
  const hasEarly = typeof chat.startChatTransport === 'function';
  assert(hasEarly, 'chat.js exposes startChatTransport() — the pre-hydrate half of boot, which reads the seam but never writes it');

  const CACHED = 12;                 // events already on the device from last session
  const SERVER_HEAD = CACHED + 3;    // 3 arrived while the app was closed
  const cachedEvents = Array.from({ length: CACHED }, (_, i) => mkEv(i + 1));

  /**
   * Runs the REAL chat.js + chatTransport.js + backend.hydrate() through
   * app.js's boot shape, in either order, on the fake clock.
   *   early:false — v0.20.3: hydrate, THEN initChat()
   *   early:true  — BUG-G:   startChatTransport(), hydrate, THEN initChat()
   * Everything measured is read off the virtual clock.
   */
  async function bootSim({ early, getAllMs = COLD_MS, seedCache = true, hydrateThrows = false, primedMirror = false }) {
    installFakeClock();
    chat._resetForTest();
    store.clear();
    storage.setBackendMode('local');
    if (seedCache) store.set(K_EVENTS_CACHE, JSON.stringify({ epoch: 0, head: CACHED, events: cachedEvents }));

    const warmAt = getAllMs;                       // the shared instance is warm from here on
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = new URL(String(url), 'https://example.invalid/');
      let body = null;
      if (opts.body) { try { body = JSON.parse(opts.body); } catch {} }
      const action = u.searchParams.get('action') || body?.action || '';
      const seq = Number(u.searchParams.get('seq') || 0);
      calls.push({ action, seq, at: NOW });
      await sleep(action === 'getAll' ? getAllMs : Math.max(WARM_MS, warmAt - NOW));
      if (action === 'getAll') {
        if (hydrateThrows) return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { cfbp_settings: { chatEnabled: true } } }) };
      }
      if (action === 'chatHead') return { ok: true, status: 200, json: async () => ({ ok: true, head: SERVER_HEAD }) };
      if (action === 'chatSince') {
        const cap = Math.max(0, SERVER_HEAD - seq);
        const events = [];
        for (let s = seq + 1; s <= seq + cap; s++) events.push(mkEv(s));
        return { ok: true, status: 200, json: async () => ({ ok: true, events, head: SERVER_HEAD }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    backend.setBackendConfig(URL_FAKE, 'tok');

    const t = { firstRender: null, roomComplete: null, hydrateAt: null, bannerAt: null };
    // The UI subscriber is attached WHEN app.js attaches it, not at t=0 — that
    // is the whole difference the primed-mirror arm turns on. In v0.20.3 the
    // only onChat() registration is inside initChatUI(), which runs after
    // hydrate; a delivery landing before it fires notify() into an EMPTY
    // subscriber set and renders nothing, however full the fold already is.
    // So "first render" is the first moment a subscriber exists AND the fold
    // is non-empty — hence attachUi() marks on attachment as well as on every
    // later delivery (initChatUI()/navigateTo() both paint from whatever is
    // already folded at that instant).
    let off = () => {};
    const mark = () => {
      const n = chat.getMessages({ tag: 'all' }).length;
      if (t.firstRender === null && n > 0) t.firstRender = NOW;
      if (t.roomComplete === null && n >= SERVER_HEAD) t.roomComplete = NOW;
    };
    const attachUi = () => {
      off = chat.onChat(kind => { if (kind === 'events') mark(); });
      mark();
    };

    // ── app.js boot(), from primeFromMirror() onward ──
    // BUG-G order:   early phase -> navigateTo('dashboard') -> hydrate -> late
    // v0.20.3 order:                navigateTo('dashboard') -> hydrate -> late
    if (early && hasEarly) { attachUi(); chat.startChatTransport('p1'); }
    // app.js `if (primedKeys > 0) { navigateTo('dashboard'); }` — navigateTo()
    // ends with refreshChatEnabled(), which SUBSCRIBES. On a returning
    // player's device THIS, not initChat(), is what actually started the poll
    // loop in v0.20.3: at S.head 0, with no cache and no subscriber attached.
    if (primedMirror) chat.refreshChatEnabled();
    let done = false;
    const tail = (async () => {
      try {
        await backend.hydrate();
        t.hydrateAt = NOW;
        storage.setBackendMode('googleSheets');
      } catch (e) { t.hydrateAt = NOW; t.bannerAt = NOW; }       // AD-06: app.js shows the red banner here
      if (!(early && hasEarly)) attachUi();   // initChatUI()'s onChat() registration, at its v0.20.3 position
      chat.initChat('p1');
      done = true;
    })();

    for (let i = 0; i < 600 && !(done && t.roomComplete !== null); i++) await advance(250);
    await tail;
    const firstChat = calls.find(c => c.action === 'chatHead' || c.action === 'chatSince') || null;
    off();
    chat._resetForTest();
    backend.clearBackendConfig();
    storage.setBackendMode('local');
    restoreClock();
    return { ...t, calls, firstChatAt: firstChat ? firstChat.at : null, endedAt: NOW };
  }

  // ── A. The before/after timeline, same fixture, only the order changed ──
  const before = await bootSim({ early: false });
  const after  = await bootSim({ early: true });
  note(`BEFORE (v0.20.3 order): first chat request at ${fmt(before.firstChatAt)}, room on screen at ${fmt(before.firstRender)}, complete at ${fmt(before.roomComplete)}`);
  note(`AFTER  (BUG-G order):   first chat request at ${fmt(after.firstChatAt)}, room on screen at ${fmt(after.firstRender)}, complete at ${fmt(after.roomComplete)}`);

  assert(before.firstChatAt !== null && before.firstChatAt >= COLD_MS,
    `fixture/control: with the old order the first chat request cannot leave before the getAll returns — ${fmt(before.firstChatAt)} (this arm is the bug, and it still behaves like the bug)`);
  assert(after.firstChatAt === 0,
    `the first chat request is issued at t=0, before the getAll has even been sent — got ${fmt(after.firstChatAt)}`);
  assert(after.firstRender === 0,
    `and the CACHED room is on screen at t=0, synchronously, with no network at all — got ${fmt(after.firstRender)} (before: ${fmt(before.firstRender)})`);
  // The COMPLETE room gains exactly one warm round trip, not a whole cold
  // start — and that is the honest number under this section's pessimistic
  // one-shared-instance model: the early chatHead is issued at t=0 but still
  // cannot be ANSWERED until the instance is warm, so the fix buys the
  // chatSince that follows it, not the cold start itself. The cold start is
  // what the CACHED render (asserted above, 8.00s -> 0.00s) removes from the
  // player's experience. Both are stated rather than one standing in for the
  // other.
  assert(after.roomComplete !== null && after.roomComplete < before.roomComplete,
    `the complete, live room lands earlier — ${fmt(after.roomComplete)} vs ${fmt(before.roomComplete)}`);
  assert(after.roomComplete <= COLD_MS + WARM_MS,
    `and it lands one warm round trip after the instance warms (<= ${fmt(COLD_MS + WARM_MS)}), instead of queueing behind the getAll — got ${fmt(after.roomComplete)}`);
  assert(after.calls[0]?.action === 'chatHead' && after.calls.some(c => c.action === 'getAll'),
    `and chat goes FIRST: request order is [${after.calls.map(c => c.action).join(', ')}]`);

  // ── B. The misroute-retry case Drew actually hit (~26s of getAll) ──
  const slowBefore = await bootSim({ early: false, getAllMs: 26000 });
  const slowAfter  = await bootSim({ early: true,  getAllMs: 26000 });
  note(`26s getAll (3 misroute attempts): blank until ${fmt(slowBefore.firstRender)} before, ${fmt(slowAfter.firstRender)} after`);
  assert(slowAfter.firstRender === 0 && slowBefore.firstRender >= 26000,
    `a slow getAll no longer holds the room hostage — ${fmt(slowBefore.firstRender)} -> ${fmt(slowAfter.firstRender)}`);

  // ── C. A device with NO cache still wins, just later: nothing to replay,
  //    but the first chat round trip still overlaps the getAll instead of
  //    queueing behind it. ──
  const coldNoCache = await bootSim({ early: true, seedCache: false });
  const oldNoCache  = await bootSim({ early: false, seedCache: false });
  note(`no device cache: room on screen at ${fmt(oldNoCache.firstRender)} before, ${fmt(coldNoCache.firstRender)} after`);
  assert(coldNoCache.firstRender !== null && coldNoCache.firstRender < oldNoCache.firstRender,
    `a first-ever device (empty cache) still sees the room sooner — ${fmt(oldNoCache.firstRender)} -> ${fmt(coldNoCache.firstRender)}`);
  assert(coldNoCache.firstRender <= COLD_MS,
    `and it sees it as soon as the instance answers AT ALL (<= ${fmt(COLD_MS)}), because its chatSince was issued at t=0 alongside the getAll rather than after it — got ${fmt(coldNoCache.firstRender)}`);
  const slowNoCache = await bootSim({ early: true, seedCache: false, getAllMs: 26000 });
  const slowNoCacheOld = await bootSim({ early: false, seedCache: false, getAllMs: 26000 });
  assert(slowNoCache.firstRender < slowNoCacheOld.firstRender,
    `and the slower the getAll, the bigger that gap gets rather than smaller — ${fmt(slowNoCacheOld.firstRender)} -> ${fmt(slowNoCache.firstRender)} at a 26s getAll`);

  // ── D. A FAILED hydrate is still loud, and chat starting early neither
  //    masks it nor is masked by it (AD-06). ──
  const failed = await bootSim({ early: true, hydrateThrows: true });
  assert(failed.bannerAt !== null,
    'a failing hydrate still throws to app.js\'s catch — the red banner path is untouched by the early chat start (AD-06)');
  assert(failed.firstRender === 0 && failed.roomComplete !== null,
    `and chat still works through it: cached room at ${fmt(failed.firstRender)}, live room at ${fmt(failed.roomComplete)} — a dead getAll no longer means a dead chat`);

  // ── F. THE BOOT SHAPE DREW ACTUALLY HAS (reviewer, 2026-09-11) ──────────
  // Everything above models primedKeys === 0: a first-ever open, or one after
  // a storage clear. Every RETURNING player boots with a primed mirror, and
  // that path runs navigateTo('dashboard') — whose tail, refreshChatEnabled(),
  // subscribes on its own. Measuring only the unprimed shape is how the first
  // version of this fix passed its own tests while doing nothing at all for
  // the majority case (chat.js's `if (S.unsub) return true` fired before the
  // cache was primed). The numbers below are the ones that describe Drew's
  // phone.
  const pBefore = await bootSim({ early: false, primedMirror: true });
  const pAfter  = await bootSim({ early: true,  primedMirror: true });
  note(`PRIMED MIRROR, BEFORE: first request ${pBefore.calls[0]?.action}:${pBefore.calls[0]?.seq} at ${fmt(pBefore.calls[0]?.at)}, room on screen at ${fmt(pBefore.firstRender)}`);
  note(`PRIMED MIRROR, AFTER:  first request ${pAfter.calls[0]?.action}:${pAfter.calls[0]?.seq} at ${fmt(pAfter.calls[0]?.at)}, room on screen at ${fmt(pAfter.firstRender)}`);

  assert(pBefore.calls[0]?.action === 'chatSince' && pBefore.calls[0]?.seq === 0,
    `fixture/control: on v0.20.3 a returning player's FIRST request is already at t=0 — but it is navigateTo()'s accidental chatSince(0), a full cold read with no cursor — got ${pBefore.calls[0]?.action}:${pBefore.calls[0]?.seq}`);
  assert(pBefore.firstRender !== null && pBefore.firstRender >= COLD_MS,
    `and the room is STILL blank until hydrate, because the answer to it is delivered into an empty subscriber set — ${fmt(pBefore.firstRender)} (this is the symptom Drew reported, on the device he reported it from)`);

  assert(pAfter.firstRender === 0,
    `with BUG-G the cached room is on screen at t=0 on that same device — got ${fmt(pAfter.firstRender)} (a subscriber now exists before anything can deliver, and the cache is replayed into it)`);
  assert(pAfter.calls[0]?.action === 'chatHead',
    `and the first request is the CHEAP head probe, not a 500-row cold read — got ${pAfter.calls[0]?.action} (this one is bought by the early phase running ABOVE navigateTo, not by startChatTransport() alone)`);
  const pSince = pAfter.calls.filter(c => c.action === 'chatSince');
  assert(pSince.length > 0 && pSince[0].seq === CACHED && !pSince.some(c => c.seq === 0),
    `and every chatSince is incremental from the cached cursor ${CACHED} — seqs [${pSince.map(c => c.seq).join(', ')}], never RG-91's chatSince(0)`);
  // THE ONE THING THIS FIX MAKES (slightly) SLOWER, stated rather than hidden.
  // v0.20.3's accidental chatSince(0, 500) fetches the whole room in ONE round
  // trip. The cache-primed boot takes the pre-existing two-phase path instead
  // (cheap chatHead probe, then an incremental chatSince(cachedHead)) — two
  // trips, so full reconciliation lands one warm round trip later in this
  // model. That model is deliberately pessimistic about it: it charges the
  // tiny head probe the same cold start as a 500-row read, which on a real
  // instance it would not pay. And the player's actual experience is the
  // opposite of a regression — the cached room is on screen at 0.00s instead
  // of 8.00s of blank. Bounded here so the trade can never silently grow.
  assert(pAfter.roomComplete !== null && pAfter.roomComplete <= pBefore.roomComplete + WARM_MS,
    `while full live reconciliation costs at most ONE extra warm round trip for the incremental read — ${fmt(pAfter.roomComplete)} vs ${fmt(pBefore.roomComplete)} (bounded trade, see comment)`);
  note(`  trade: reconciliation ${fmt(pBefore.roomComplete)} -> ${fmt(pAfter.roomComplete)} (+1 round trip, incremental instead of a 500-row cold read), room ON SCREEN ${fmt(pBefore.firstRender)} -> ${fmt(pAfter.firstRender)}`);

  // And the same device with a slow (misrouted) getAll: the gap is the whole
  // cold start, not a warm round trip.
  const pSlowBefore = await bootSim({ early: false, primedMirror: true, getAllMs: 26000 });
  const pSlowAfter  = await bootSim({ early: true,  primedMirror: true, getAllMs: 26000 });
  assert(pSlowAfter.firstRender === 0 && pSlowBefore.firstRender >= 26000,
    `primed mirror + 26s getAll: ${fmt(pSlowBefore.firstRender)} -> ${fmt(pSlowAfter.firstRender)}`);

  // ── E. The boot ORDER is in app.js, not just in this simulation. ──
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const earlyAt   = src.indexOf("initChatUI({ phase: 'early' })");
  // The SEMICOLON matters: this file's own BUG-G comment block quotes
  // "await hydrateBackend()" a few lines above the real call, and indexOf
  // would otherwise match the prose and invert the comparison below.
  const hydrateAt = src.indexOf('await hydrateBackend();');
  const lateAt    = src.indexOf('initChatUI(); updateChatBadges()');
  const refreshAt = src.indexOf('try { refreshChatEnabled(); } catch {}', hydrateAt);
  assert(earlyAt > -1 && earlyAt < hydrateAt,
    `js/app.js starts the chat engine BEFORE \`await hydrateBackend()\` (early at char ${earlyAt}, hydrate at ${hydrateAt})`);
  assert(lateAt > hydrateAt,
    'and the LATE phase (epoch heal + outbox flush + UI wiring) still runs after it — the seam-hazard half never moved');
  assert(refreshAt > hydrateAt && refreshAt < lateAt,
    'and refreshChatEnabled() runs the moment hydrate lands, so a stale local chatEnabled cannot outlive the hydrate window');
  // F1b (reviewer BLOCK) — the early phase must also be above the ONE other
  // thing in boot() that subscribes: navigateTo('dashboard'), whose tail is
  // refreshChatEnabled(). Position, not just presence.
  const navAt = src.indexOf("if (primedKeys > 0) { navigateTo('dashboard')");
  assert(navAt > -1 && earlyAt < navAt,
    `and it runs ABOVE navigateTo('dashboard') (early at char ${earlyAt}, navigateTo at ${navAt}) — navigateTo()'s own refreshChatEnabled() subscribes, and a subscription that starts before the cache is primed spends its first tick on RG-91's chatSince(0, 500) and delivers into an empty subscriber set`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [11] BUG-12 (Drew, 2026-09-12) — "When I receive a push notification it
// doesn't show up in the chat for at least 30 seconds after the notification.
// When I click the push, I should be able to see the message in the chat."
//
// The poll cadence is chosen by ROOM ACTIVITY (INTERVALS above): a player who
// is not sitting in the room is 'idle' (45s) or 'closed' (60s). That is the
// right clock for "nothing has told us anything changed" — and a push is
// precisely something telling us that. Nothing in the push-tap, the
// foreground-push or the app-resume path forced a fetch, so the message the
// banner announced sat unrequested until the next scheduled poll, and the
// notification deep link ran its scroll against a room that did not hold the
// message yet ("no-op if outside the loaded window", fired prematurely).
//
// The fix is ONE mechanism in the layer that owns cadence: a wake() fast path
// on the subscription, BOUNDED to one forced fetch per WAKE_MIN_GAP_MS. A wake
// inside the window is DEFERRED to the end of it, never dropped — a dropped
// wake is this bug again, one flap later.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[11] BUG-12 — a push tap / foreground push / resume forces one immediate fetch…');
{
  const WAKE_GAP_EXPECTED = 5000;   // mirrors chatTransport.js's WAKE_MIN_GAP_MS

  /** A subscription that has ALREADY seen the room, so the boot ladder is spent
   *  and the next scheduled poll is a full room interval away — the steady
   *  state Drew was actually in when the push landed. */
  async function liveRoom({ mode = 'closed' } = {}) {
    installFakeClock();
    let head = 20;
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = new URL(String(url), 'https://example.invalid/');
      const action = u.searchParams.get('action');
      const seq = Number(u.searchParams.get('seq') || 0);
      calls.push({ action, seq, at: NOW });
      await sleep(WARM_MS);
      if (action === 'chatHead') return { ok: true, status: 200, json: async () => ({ ok: true, head }) };
      const events = [];
      for (let s = seq + 1; s <= head; s++) events.push(mkEv(s));
      return { ok: true, status: 200, json: async () => ({ ok: true, events, head }) };
    };
    backend.setBackendConfig(URL_FAKE, 'tok');
    const folded = new Map();
    let known = 0;
    const sub = transport.subscribe((events, h) => {
      (events || []).forEach(e => folded.set(e.id, e));
      if (typeof h === 'number' && h > known) known = h;
    }, { getMode: () => mode, getKnownHead: () => known });
    await advance(5000);                     // the boot tick lands; the room is SEEN
    return {
      sub, calls, folded,
      post: (n = 1) => { head += n; return head; },
      wake: () => (typeof sub.wake === 'function' ? sub.wake() : Promise.resolve(false)),
      since: t => calls.filter(c => c.at >= t).length,
      stop: () => { try { sub.unsubscribe(); } finally { restoreClock(); backend.clearBackendConfig(); document.hidden = false; } },
    };
  }

  // ── A. The interface: cadence is a transport concern, so the fast path lives
  //      here, next to the interval and the visibilitychange hook it reuses. ──
  {
    const room = await liveRoom();
    assert(typeof room.sub.wake === 'function',
      'the subscription exposes wake() — the event-driven forced fetch (push tap, foreground push, resume) lives in the transport, beside the interval it overrides');
    room.stop();
  }

  // ── B. THE REPRODUCTION. A message is posted, a push is tapped, and the
  //      fetch must be issued NOW rather than at the next scheduled poll. ──
  {
    const room = await liveRoom({ mode: 'closed' });
    room.post();                                   // the message the push is about
    const t0 = NOW;
    const before = room.calls.length;
    const p = room.wake();                         // ← the push tap
    await advance(1500);
    const issued = room.calls.length - before;
    assert(issued >= 1,
      `a push tap issues a chat fetch within 1.5s — got ${issued} request(s) in that window (before the fix the room was not asked again until the next ${(60000 / 1000).toFixed(0)}s poll, which is Drew's "at least 30 seconds")`);
    await advance(3000);      // let the round trip (head probe + page) finish on the fake clock
    await p;
    assert(room.folded.has('b21'),
      'and the message is IN THE FOLD by the time wake() resolves — which is what lets the deep link wait for the fetch instead of scrolling to an element that does not exist yet');
    note(`  tap at ${fmt(t0)}; next SCHEDULED poll would have been a ${fmt(60000)} room interval away`);
    room.stop();
  }

  // ── C. The old behaviour, stated as a number: with no wake, the message
  //      waits for the room interval. (Drives the same live room, but never
  //      calls wake() — this is the "do nothing" control.) ──
  {
    const room = await liveRoom({ mode: 'closed' });
    room.post();
    const before = room.calls.length;
    await advance(30000);
    assert(room.calls.length === before,
      `CONTROL: with nothing forcing a fetch, 30 SECONDS pass with zero requests — the defect measured, not asserted away (got ${room.calls.length - before})`);
    room.stop();
  }

  // ── D. BOUNDED. A flapping tab (iOS fires visibility pairs while the app
  //      switcher is scrubbed) must not hammer the transport. ──
  {
    const room = await liveRoom({ mode: 'closed' });
    const t0 = NOW;
    for (let i = 0; i < 10; i++) {
      document.hidden = true;  fireVisibilityChange();
      await advance(200);
      document.hidden = false; fireVisibilityChange();
      await advance(800);
    }
    const forced = room.since(t0);
    assert(forced >= 1,
      `a resume still forces a fetch — the visibility fast path is not lost to the bound (got ${forced})`);
    assert(forced <= 3,
      `…and 10 visibility flaps in 10s cost at most one forced fetch per ${WAKE_GAP_EXPECTED / 1000}s — got ${forced} requests, i.e. ${forced > 3 ? 'one per flap' : 'bounded'}`);
    note(`  10 flaps / 10s -> ${forced} forced fetch(es)`);
    room.stop();
  }

  // ── E. Bounded, NOT dropped. A wake that lands inside the window is the
  //      only signal we have that a message exists; losing it re-creates the
  //      bug. It is deferred to the end of the window and still resolves. ──
  {
    const room = await liveRoom({ mode: 'closed' });
    // NB: every await of a wake()/forceTick() promise has to be sandwiched by
    // advance() — the fake clock only fires the stubbed round trip's timers
    // when time is moved by hand, so awaiting one bare would deadlock.
    const w0 = room.wake(); await advance(1500); await w0;   // opens the window
    room.post();                               // a second push arrives INSIDE it
    const before = room.calls.length;
    let settled = false;
    const p = room.wake().then(() => { settled = true; });
    await advance(WAKE_GAP_EXPECTED + 2000);
    await p;
    assert(room.calls.length > before,
      `a wake inside the cooldown window is DEFERRED to the end of it, not dropped — got ${room.calls.length - before} request(s) after the window`);
    assert(settled && room.folded.has('b21'),
      'and the deferred wake still resolves with the message in hand, so a deep link that awaits it lands on the message');
    room.stop();
  }

  // ── F. Focus, not just visibilitychange. §5 above already notes that iOS
  //      standalone may never fire visibilitychange on a resume; `focus` is
  //      the second signal, and costs nothing when both arrive (the bound
  //      collapses them into one fetch). ──
  {
    const room = await liveRoom({ mode: 'closed' });
    await advance(WAKE_GAP_EXPECTED + 500);    // outside any window left by boot
    room.post();
    const before = room.calls.length;
    fireFocus();
    await advance(1500);
    assert(room.calls.length > before,
      `a window 'focus' event forces a fetch too — got ${room.calls.length - before} request(s)`);
    room.stop();
  }

  // ── G. The MANUAL refresh (DI-168's 🔄 button) is a player action, not an
  //      event, and stays unthrottled. A bound on the button would make it
  //      look broken — the exact complaint DI-168 was built to answer. ──
  {
    const room = await liveRoom({ mode: 'closed' });
    const w1 = room.wake(); await advance(1500); await w1;   // window is now open
    const before = room.calls.length;
    const t1 = room.sub.forceTick(); await advance(1500); const r1 = await t1;
    const t2 = room.sub.forceTick(); await advance(1500); const r2 = await t2;
    assert(r1 === true && r2 === true && room.calls.length - before >= 2,
      `two taps of the manual refresh button inside the wake window still make two round trips (DI-168 unchanged) — got ${room.calls.length - before}`);
    room.stop();
  }
}

// The DOMContentLoaded handler js/app.js registers at import time, captured in
// the block below and reused by the second remediation pass's own boot
// scenarios further down (it IS boot(); every scenario swaps the document and
// localStorage underneath it, which is what makes those runs real boots).
let sharedBootHandler = null;

// ── Phase III Step 3a (DI-180j) — authMode absent/'pins' byte-identical proof ──
// Everything above this point never imports js/app.js — this is that file's
// FIRST import in this suite, so the fuller DOM stub below is scoped to run
// LAST, after every earlier section (and its own globalThis.document/
// setTimeout stand-ins) has already finished. Real timers first — app.js's
// own setTimeout(() => input?.focus(), 100) inside showSitePinGate() must
// not be caught by a fake clock nobody is driving forward.
{
  restoreClock();
  const store2 = new Map();
  globalThis.localStorage = {
    getItem: k => (store2.has(k) ? store2.get(k) : null),
    setItem: (k, v) => store2.set(k, String(v)),
    removeItem: k => store2.delete(k),
    clear: () => store2.clear(),
  };
  const registry = new Map();
  class FakeEl {
    constructor(tag) { this.tagName = tag || 'div'; this.id = ''; this.hidden = false; this.attrs = {}; this._html = ''; this._listeners = {}; this.style = {}; }
    set innerHTML(v) { this._html = v; }
    get innerHTML() { return this._html; }
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') { this.id = v; registry.set(v, this); } }
    getAttribute(k) { return this.attrs[k] || null; }
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
    removeEventListener() {}
    appendChild(child) { if (child.id) registry.set(child.id, child); return child; }
    remove() { if (this.id) registry.delete(this.id); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() {}
    get classList() { return { add(){}, remove(){}, toggle(){}, contains(){ return false; } }; }
  }
  // applyTheme() does `[...body.classList]`, and navigateTo() writes
  // body.dataset.tab — both are on boot()'s path, which this section now runs
  // for real (see the ordering proof below), so the stub has to support them.
  const bootMarks = [];
  const fakeClassList = () => {
    const set = new Set();
    return { add: c => set.add(c), remove: c => { if (c === 'cfbp-booting') bootMarks.push('reveal'); set.delete(c); },
             toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: c => set.has(c),
             [Symbol.iterator]: () => set[Symbol.iterator]() };
  };
  const createdScripts = [];
  let domReadyHandler = null;
  globalThis.document = {
    hidden: false,
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') domReadyHandler = fn; },
    removeEventListener(){},
    getElementById(id) { return registry.get(id) || null; },
    createElement(tag) { const el = new FakeEl(tag); if (String(tag).toLowerCase() === 'script') createdScripts.push(el); return el; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    body: { appendChild(el) { if (el.id) registry.set(el.id, el); }, classList: fakeClassList(), dataset: {} },
    head: { appendChild(el) { return el; } },
    title: '',
  };
  globalThis.window = globalThis;
  globalThis.location = { origin: 'http://localhost' };
  try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
  catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
  globalThis.requestAnimationFrame = fn => fn();
  globalThis.fetch = async () => { throw new Error('network disabled in boottest'); };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.confirm = () => true;
  globalThis.prompt = () => null;
  globalThis.alert = () => {};
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

  const appMod = await import('./js/app.js');
  const storageMod = await import('./js/storage.js');

  appMod.showSitePinGate();
  const gate = registry.get('site-gate-overlay');
  assert(!!gate, 'DI-180j — showSitePinGate() still appends #site-gate-overlay when authMode is absent');

  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const s = storageMod.getSettings();
  const titleTop  = s.welcomeTitleTop  || 'welcome to';
  const titleMain = s.welcomeTitleMain || (s.welcomeTitle ? s.welcomeTitle.replace(/^welcome to\s*/i, '') : "irb pick 'ems");
  const subtitle  = s.welcomeSubtitle || 'enter access pin';
  // The exact template js/app.js's showSitePinGate() has used since v0.16.0,
  // untouched by Step 3a (only an `export` keyword was added to the function
  // signature) — this is the "pre-change fixture" DI-180j calls for.
  const golden = `
    <div class="site-gate">
      <div class="site-gate-inner">
        <div class="site-gate-title-top">${esc(titleTop)}</div>
        <div class="site-gate-title">${esc(titleMain)}</div>
        <div class="site-gate-subtitle">${esc(subtitle)}</div>
        <input class="site-gate-input" id="site-pin-input" type="password" inputmode="numeric"
          maxlength="8" placeholder="_ _ _ _" autocomplete="off" />
        <div class="site-gate-error" id="site-gate-error" style="display:none">incorrect pin</div>
        <button class="site-gate-btn" id="site-gate-submit">enter</button>
      </div>
    </div>`;
  assert(gate?.innerHTML === golden, 'DI-180j — the PIN gate overlay HTML is byte-identical to the pre-Step-3a fixture when authMode is absent/\'pins\'');
  assert(!registry.has('google-gate-submit'), 'DI-180j — no Google sign-in DOM ever appears when authMode is absent (showGoogleSignInGate() never called on this path)');

  // ── REVIEWER B2 — THE FLAG-OFF PATH PAYS NOTHING ─────────────────────────
  // Two costs, both real, both on the only path anyone is actually on:
  //
  //   (1) TIME. Step 3a's first pass hoisted `await loadDeployedConfig()` ABOVE
  //       revealApp(), so every boot on every device waited on a network round
  //       trip before the visibility lock came off. The PIN gate never did
  //       that (AD-08: prime, paint, gate as an overlay, hydrate behind it).
  //   (2) BYTES. index.html carried a static <script> tag for the whole
  //       vendored Supabase SDK, downloaded and parsed by every visitor in a
  //       mode that never touches it.
  //
  // Both are asserted here against a REAL boot() — driven through the
  // DOMContentLoaded handler app.js registers at import time, not by calling an
  // exported helper that only resembles it.
  assert(typeof domReadyHandler === 'function',
    'fixture: app.js registered its DOMContentLoaded boot handler (without this the ordering proof below is vacuous)');
  sharedBootHandler = domReadyHandler;
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) {
        bootMarks.push('config-fetch');
        // No backendUrl/backendToken: loadDeployedConfig() returns
        // {ok:false, reason:'empty', authMode:'pins'} and boot() takes its
        // local-only branch. authMode is ABSENT, which is the case under test.
        return { ok: true, json: async () => ({ _comment: 'no backend, no authMode' }) };
      }
      throw new Error('network disabled in boottest');
    };
    bootMarks.length = 0;
    createdScripts.length = 0;
    domReadyHandler();
    // Drain the microtask/timer queue so every await inside boot() has settled.
    for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0));
    globalThis.fetch = realFetch;

    const revealAt = bootMarks.indexOf('reveal');
    const configAt = bootMarks.indexOf('config-fetch');
    assert(revealAt > -1, `fixture: boot() reached revealApp() (marks: ${JSON.stringify(bootMarks)})`);
    assert(configAt > -1, `fixture: boot() read config.json (marks: ${JSON.stringify(bootMarks)})`);
    assert(revealAt < configAt,
      `DI-180f/B2 — revealApp() runs BEFORE the config.json await, not after it (marks: ${JSON.stringify(bootMarks)}). The paint must never wait on a feature flag that is off.`);

    const supaScripts = createdScripts.filter(el => /supabase/i.test(String(el.src || '')));
    // REVIEWER N-c — the `createdScripts.length === 0 ||` disjunct that used to
    // lead this line made it pass whenever NO script of any kind was created,
    // which is the common case: an assertion that cannot fail is not one.
    assert(supaScripts.length === 0,
      `DI-180f/B2 — with authMode absent, boot() injects NO Supabase SDK script element (found ${supaScripts.length}: ${JSON.stringify(supaScripts.map(e => e.src))})`);
    const { readFileSync } = await import('node:fs');
    const htmlSrc = readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert(!/vendor\/supabase-js/.test(htmlSrc),
      'DI-180f/B2 — and index.html carries no static tag for it either, so a \'pins\' boot downloads zero SDK bytes');
    assert(!registry.has('google-gate-submit'),
      'DI-180f — a real boot() with authMode absent still never renders the Google gate');
    assert(!registry.has('auth-banner-stack') && !registry.has('auth-config-error-banner'),
      'DI-180f — …and never raises an auth banner: the whole Phase III surface stays inert when the flag is off');
  }
}

// ── Phase III Step 3a, second remediation pass — SEC F1-R1 + SEC F5 ──────────
// BEHAVIORAL, through the real DOMContentLoaded handler js/app.js registers at
// import time. Everything in this block drives boot() itself and reads what the
// app actually did: which scripts were injected, which URLs were fetched, which
// overlays and banners are on screen, and what getSession() resolves to.
//
// Why behavioral and not a source regex: SEC F5's whole finding is that the
// boot interlock was pinned ONLY by a source regex in authtest, so boottest
// stayed 101/0 with the interlock disabled. A rule that cannot notice the
// feature being removed is not a guard.
{
  const { readFileSync } = await import('node:fs');
  const appMod = await import('./js/app.js');
  const authMod = await import('./js/auth.js');
  const storageMod = await import('./js/storage.js');
  const backendMod = await import('./js/backend.js');
  // Reviewer F4 (fifth gate) — the resumed-from-hold device has to get boot()'s
  // WHOLE tail, and the push adapter's registration is the observable proof that
  // the notifications block inside it ran.
  const notifyMod = await import('./js/notifications.js');

  const BACKEND_URL = 'https://script.google.test/exec';
  const BACKEND_TOKEN = 'tok';

  // The registry of the boot currently under test. Elements register
  // themselves on appendChild and de-register on remove(), wherever in the tree
  // they land — banners go into #auth-banner-stack, not straight onto <body>,
  // and an assertion that could not see them would have been unfalsifiable.
  let currentReg = null;
  /**
   * FIFTH GATE — CLASS SELECTORS ARE ANSWERED NOW, not stubbed to [].
   *
   * A6's teardown and security 7/8 are all expressed through class selectors
   * (`.page-section`, `.nav-unread`, `.modal-overlay`, `.main-content`,
   * `.bottom-nav`). A stub that answers "nothing matched" makes every one of
   * them look successful precisely when it has nothing to act on. Exact
   * selector -> elements, filled in by the scenario; no selector engine.
   */
  let currentByClass = new Map();

  class BEl {
    constructor(tag) { this.tagName = tag || 'div'; this.id = ''; this.hidden = false; this.className = ''; this.attrs = {}; this.dataset = {}; this._html = ''; this._listeners = {}; this.style = {}; }
    set innerHTML(v) { this._html = v; }
    get innerHTML() { return this._html; }
    get textContent() { return this._html.replace(/<[^>]*>/g, ''); }
    set textContent(v) { this._html = v; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter(f => f !== fn); }
    dispatch(t, e = {}) { (this._listeners[t] || []).forEach(fn => fn(e)); }
    appendChild(c) { if (c?.id && currentReg) currentReg.set(c.id, c); return c; }
    remove() { this._removed = true; if (this.id && currentReg) currentReg.delete(this.id); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    insertAdjacentHTML(pos, html) { this._html = pos === 'afterbegin' ? html + this._html : this._html + html; }
    focus() {}
    // A REAL class set, because A6 now removes `.active` from every page section
    // (chat-ui.js keys its own repaints on that class, and app.js cannot reach
    // its subscriber) — a no-op classList would make that assertion vacuous.
    get classList() {
      this._classes = this._classes || new Set(String(this.className || '').split(/\s+/).filter(Boolean));
      const set = this._classes;
      return { add: c => set.add(c), remove: c => set.delete(c), toggle: (c, on) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (on ? set.add(c) : set.delete(c))), contains: c => set.has(c), [Symbol.iterator]: () => set[Symbol.iterator]() };
    }
  }

  /**
   * One boot, in a world built to order.
   *
   * `config` is what config.json's fetch does: a function returning a Response-
   * ish object, or throwing. `seed` is this device's localStorage before the app
   * opens. `sdk` decides what the injected vendored SDK turns out to be when (if)
   * boot injects it — a real fake client, wired so that a boot which gets past
   * the interlock really does resolve a COMMISSIONER membership. That is what
   * makes "isAdmin stays false" a falsifiable claim rather than a tautology.
   */
  async function runBoot({ config, seed = {}, withSdk = true, beforeBoot = null, localStorageOverrides = null, paintPages = false }) {
    const store = new Map(Object.entries(seed));
    const sessionKeyReads = [];
    globalThis.localStorage = {
      getItem(k) { if (k === 'cfbp_session') sessionKeyReads.push(k); return store.has(k) ? store.get(k) : null; },
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: i => [...store.keys()][i] ?? null,
    };
    // SEC S-2 — lets a scenario make the device UNABLE TO PERSIST (iOS private
    // browsing, a full quota) by overriding one method. Applied OVER the working
    // stub rather than replacing it, and handed the live `store`, so everything
    // else about the boot stays normal.
    if (localStorageOverrides) Object.assign(globalThis.localStorage, localStorageOverrides(store));

    const reg = new Map();
    currentReg = reg;
    const scripts = [];
    const fetches = [];
    const backendActions = [];   // sixth gate — see the fetch stub below
    let sdkInstalled = false;
    // Reads of the PIN-mode session key that happen AFTER the mode decision.
    // Reads BEFORE it are the paint-first design (boot paints the header and
    // resolves the theme from the local session before config.json has even
    // been requested) and are identical in every mode — counting those would
    // measure v0.16.0's boot order, not this finding.
    let readsAtConfigFetch = null;

    const installSdk = () => {
      sdkInstalled = true;
      globalThis.window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
              getSession: async () => ({ data: { session: { user: { id: 'u-stranger', email: 'stranger@example.com' } } } }),
              signInWithOAuth: async () => ({ data: {}, error: null }),
              signOut: async () => ({ error: null }),
            },
            from() {
              const b = { select(){ return b; }, eq(){ return b; },
                then(res, rej) { return Promise.resolve({ data: [{ league_id: 'L-STRANGER', id: 'm-stranger', role: 'commissioner', display_name: 'Stranger', active: true, leagues: { name: 'Stranger League' } }], error: null }).then(res, rej); } };
              return b;
            },
            rpc: async () => ({ data: null, error: null }),
          };
        },
      };
    };

    // [27] — THE ORDER OF THE PAINTS, not just the state at the end. A gate that
    // is appended and then removed a moment later leaves NO trace in `reg`,
    // which is exactly the defect RG-194 is about ("it flashes the login
    // screen"). Every append is logged with the markup it carried at that
    // instant (all three gate renderers set innerHTML BEFORE appendChild), so a
    // scenario can ask WHICH gate appeared and WHEN relative to the config read.
    const appendLog = [];
    // [29] — see the body stub below.
    const bodyClasses = new Set();
    const themeOrder = [];
    const bodyClassList = {
      add: c => { bodyClasses.add(c); if (String(c).startsWith('theme-')) themeOrder.push(c); },
      remove: c => bodyClasses.delete(c),
      toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)),
      contains: c => bodyClasses.has(c),
      [Symbol.iterator]: () => bodyClasses[Symbol.iterator](),
    };
    const appendAnywhere = el => {
      if (el?.id) { appendLog.push({ id: el.id, html: String(el.innerHTML || '') }); reg.set(el.id, el); }
      if (String(el?.src || '').includes('supabase')) {
        // A faithful stand-in for the browser: the tag lands, the file arrives,
        // window.supabase appears, and the element's own 'load' fires.
        if (withSdk) { installSdk(); Promise.resolve().then(() => el.dispatch('load', {})); }
        else Promise.resolve().then(() => el.dispatch('error', {}));
      }
      return el;
    };

    globalThis.document = {
      hidden: false,
      addEventListener() {}, removeEventListener() {},
      getElementById: id => reg.get(id) || null,
      createElement(tag) { const el = new BEl(tag); if (String(tag).toLowerCase() === 'script') scripts.push(el); return el; },
      // [28] — `#id.class` is answered FAITHFULLY (element + live class check)
      // rather than from the static selector map. js/chat-ui.js's
      // dashboardPageActive() asks exactly that (`#page-dashboard.active`), and
      // a stub that answered null could not see the teaser insertion this suite
      // is about; one that answered unconditionally would keep answering after
      // A6's teardown has removed `.active`.
      querySelector(sel) {
        const m = /^#([\w-]+)\.([\w-]+)$/.exec(String(sel));
        if (m) { const el = reg.get(m[1]); return el && el.classList?.contains(m[2]) ? el : null; }
        return (currentByClass.get(sel) || [])[0] || null;
      },
      querySelectorAll(sel) { return currentByClass.get(sel) || []; },
      // [29] — A REAL CLASS SET ON <body>, and a LOG of every theme-* applied in
      // order. applyTheme() spreads body.classList to find the class it is
      // replacing, so an inert stub made the whole palette question
      // unobservable — and the question RG-198 asks is specifically WHICH
      // palette is painted FIRST, before any await.
      body: { appendChild: appendAnywhere, classList: bodyClassList, dataset: {} },
      head: { appendChild: appendAnywhere },
      title: '',
    };

    globalThis.window.supabase = undefined;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      fetches.push(u);
      // SIXTH GATE — RECORD THE ACTION, NOT JUST THE URL. Every backend call is
      // a POST to the SAME url with the action in the BODY, so counting URLs
      // cannot tell a HYDRATE from chat's background poll. An assertion that
      // "the hydrate ran" was passing on chat traffic (found by a mutation that
      // removed the hydrate and stayed green on that assertion). One line here
      // makes the two distinguishable everywhere.
      if (opts?.body) { try { const a = JSON.parse(opts.body)?.action; if (a) backendActions.push(String(a)); } catch {} }
      if (u.includes('config.json')) { readsAtConfigFetch = sessionKeyReads.length; appendLog.push({ id: '#config-fetch', html: '' }); return config(); }
      throw new Error('network disabled in boottest');
    };

    // Fresh module state for every scenario — a latched SDK promise or a cached
    // backend config carried over from the previous boot would make the next
    // one measure the wrong thing.
    authMod._resetAuthForTest();
    appMod._resetAuthUIWiringForTest();
    appMod._resetSupabaseSdkLoaderForTest();
    // DI-180l — the hold gate owns a 20s re-check timer, a visibilitychange
    // listener and a one-shot resume latch. A timer surviving into the next
    // scenario would re-run the whole auth decision (another config fetch)
    // underneath it, and a surviving `_authHoldReason` would make A7's
    // "never take a hold gate down" rule fire in a boot that has no hold.
    appMod._resetAuthHoldForTest();
    backendMod.clearBackendConfig();
    for (const [k, v] of Object.entries(seed)) store.set(k, String(v));
    // A3/A6 (DI-180l) — THE DEVICE THAT SECURITY S-1 WAS ABOUT. Its page
    // containers are already PAINTED with league data from its own local
    // mirror, because AD-08's paint-first boot primes and paints before
    // config.json has even been requested. Pre-painting them here (rather than
    // hoping the minimal DOM stub survives a full navigateTo()) is what makes
    // "no mirror-derived markup is left in the DOM" a falsifiable claim: there
    // demonstrably WAS markup to tear down.
    const paintedPages = {};
    currentByClass = new Map();
    const chrome = {};
    if (paintPages) {
      for (const id of appMod._APP_PAGE_CONTAINER_IDS_FOR_TEST) {
        const el = new BEl(); el.id = id; el.className = 'page-section active';
        el.innerHTML = `<div class="card">Kihoon 4-2 &middot; Drew 3-3 &middot; tiebreaker 47</div>`;
        reg.set(id, el); paintedPages[id] = el;
      }
      const wk = new BEl(); wk.id = 'header-meta-week'; wk.innerHTML = '<strong>Week 4</strong>'; reg.set('header-meta-week', wk); paintedPages['header-meta-week'] = wk;
      const pl = new BEl(); pl.id = 'league-pill'; pl.innerHTML = "IRB Pick 'Ems"; pl.setAttribute('aria-label', "Active league: IRB Pick 'Ems"); reg.set('league-pill', pl); paintedPages['league-pill'] = pl;
      const hi = new BEl(); hi.id = 'header-identity'; hi.innerHTML = 'Drew'; reg.set('header-identity', hi); paintedPages['header-identity'] = hi;
      // The chrome A6's teardown now also acts on (security 7/8): the two
      // containers that get `inert`, an unread pill, an open modal and the
      // toast host. Registered by SELECTOR, which the stub now answers.
      chrome.main = new BEl(); chrome.main.className = 'main-content';
      chrome.nav = new BEl(); chrome.nav.className = 'bottom-nav';
      chrome.unread = new BEl(); chrome.unread.className = 'nav-unread'; chrome.unread.innerHTML = '3';
      chrome.modal = new BEl(); chrome.modal.id = 'an-open-modal'; chrome.modal.className = 'modal-overlay';
      chrome.toasts = new BEl(); chrome.toasts.id = 'toast-container'; chrome.toasts.innerHTML = '<div class="toast">Kevin picked Ohio State</div>';
      reg.set('an-open-modal', chrome.modal);
      reg.set('toast-container', chrome.toasts);
      currentByClass.set('.page-section', Object.values(paintedPages).filter(el => String(el.className).includes('page-section')));
      currentByClass.set('.main-content', [chrome.main]);
      currentByClass.set('.bottom-nav', [chrome.nav]);
      currentByClass.set('.nav-unread', [chrome.unread]);
      currentByClass.set('.modal-overlay', [chrome.modal]);
      globalThis.document.title = "(3) IRB Pick 'Ems";
    }

    // SEC S-5 / FINDING 4 — the one window in which a scenario can put auth.js
    // into a state the boot then has to REFUSE. It has to be here: the reset
    // above wipes auth.js's world, and sharedBootHandler() below is the boot.
    if (beforeBoot) beforeBoot({ authMod, appMod, store });

    sharedBootHandler();
    for (let i = 0; i < 60; i++) await new Promise(r => setTimeout(r, 0));

    return {
      reg, scripts, fetches, backendActions, store, sdkInstalled, sessionKeyReads, paintedPages, chrome, installSdk, appendLog,
      bodyClasses, themeOrder,
      sessionReadsAfterModeDecision: readsAtConfigFetch === null ? sessionKeyReads.length : sessionKeyReads.length - readsAtConfigFetch,
      supaScripts: scripts.filter(el => String(el.src || '').includes('supabase')),
      hydrateCalls: fetches.filter(u => u.includes(BACKEND_URL)),
      has: id => !!reg.get(id),
    };
  }

  const okConfig = extra => () => ({ ok: true, json: async () => ({ backendUrl: BACKEND_URL, backendToken: BACKEND_TOKEN, ...extra }) });
  const STALE_ADMIN_SESSION = JSON.stringify({ playerId: 'p_drew', isAdmin: true, playerVerified: true, setAt: '2026-08-01T00:00:00.000Z' });
  const BACKEND_CFG = JSON.stringify({ url: BACKEND_URL, token: BACKEND_TOKEN });

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[12] SEC F5 — the boot interlock, proven by BEHAVIOR (config really says supabase)…');
  {
    /**
     * REVIEWER FINDING 4 / SEC S-5 — WHY THIS FIXTURE SEEDS A COMMISSIONER.
     *
     * "No commissioner is derived" used to be VACUOUS here, and the reviewer
     * proved it: deleting forceSignedOutSession() from boot()'s interlock branch
     * left this file at 163/0, because the branch returns before the SDK is ever
     * injected — so no membership could resolve, _membershipsCache stayed null,
     * and _recomputeSynthesizedSession() answered "signed out" for a reason that
     * had nothing to do with the latch. Only an authtest REGEX noticed, which is
     * the same "a rule that cannot see the feature being removed is not a guard"
     * finding SEC F5 raised about the interlock in the first place.
     *
     * So the hazard is now REAL before boot starts: auth.js is handed a resolved
     * COMMISSIONER membership and an active league pointer, exactly the state a
     * stranger's league would produce, and getSession() would answer
     * {playerId:'m-stranger', isAdmin:true} if nothing stopped it. The latch is
     * the only thing that stops it. Proven RED on a scratch copy by deleting
     * forceSignedOutSession() from the interlock branch.
     */
    const seedStrangerCommissioner = ({ authMod: a }) => {
      a._setMembershipsForTest([{ leagueId: 'L-STRANGER', memberId: 'm-stranger', role: 'commissioner', displayName: 'Stranger', leagueName: 'Stranger League' }]);
      a.setActiveLeagueId('L-STRANGER');
      a._setAccountUserIdForTest('u-stranger');
      // The fixture is only worth anything if it really does produce a
      // commissioner BEFORE the boot runs. Read off auth.js directly:
      // storage.getSession() only delegates here once configureAuth() has been
      // told the mode, and that happens INSIDE the boot we are about to start.
      const pre = a.getSupabaseSession();
      assert(pre.isAdmin === true && pre.playerId === 'm-stranger',
        `fixture: before boot, auth.js really does derive a COMMISSIONER (${JSON.stringify(pre)}) — so "isAdmin stays false" below is a claim about the latch, not about an empty cache`);
    };
    const r = await runBoot({
      beforeBoot: seedStrangerCommissioner,
      config: okConfig({ authMode: 'supabase', supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' }),
      seed: {
        cfbp_session: STALE_ADMIN_SESSION,
        cfbp_backend_config: BACKEND_CFG,
        // A VALID Supabase token on the device, so that a boot which gets past
        // the interlock really does go and resolve memberships. Without it the
        // gate short-circuits before the membership read and the "isAdmin stays
        // false" assertion below would pass for the wrong reason.
        cfbp_supabase_session: JSON.stringify({ access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      },
    });
    // THE HAZARD: hasSupabaseDataBackend() is false in this build, so a
    // supabase-mode boot would derive isAdmin from a league_members row in a
    // project any Google account can create a league in, and hand it to an app
    // whose every write lands in the six-player league's Sheet. The fake SDK
    // above is wired to resolve exactly that: a COMMISSIONER row. Every
    // assertion here flips if the interlock branch is removed.
    assert(r.supaScripts.length === 0,
      `SEC F5 — the interlock injects NO Supabase SDK script (found ${r.supaScripts.length})`);
    assert(r.sdkInstalled === false, '…so the vendored SDK never becomes available at all');
    assert(r.hydrateCalls.length === 0,
      `SEC F5 — and no hydrate runs: zero requests to the configured backend (found ${r.hydrateCalls.length})`);
    assert(r.has('site-gate-overlay'),
      'SEC F5 — a gate overlay is STILL UP: a misconfiguration never removes the app\'s only lock');
    // ── DI-180l (approved 2026-09-17) — WHAT THIS PAIR USED TO ASSERT ────────
    // It used to be "it is still the PIN gate, unreplaced" plus "the
    // config-error BANNER is on screen". Both described the pre-amendment
    // behaviour, and the amendment replaces it: the interlock now stands the
    // fail-closed HOLD GATE up in place of the banner. That is a strictly
    // stronger lock than the PIN gate it replaces (no PIN field, no Google
    // button, no control that could look like it succeeded), and DI-180l's
    // whole point is that a device with no proven identity must see nothing
    // else.
    {
      const html = r.reg.get('site-gate-overlay')?.innerHTML || '';
      assert(/data-hold-reason="interlock"/.test(html),
        'DI-180l — the overlay is the HOLD GATE, interlock variant (data-hold-reason="interlock")');
      assert(/We'll be right back/.test(html),
        "…with A1's heading: an interlock does not clear by itself, so it does not promise to");
      assert(/Let the commissioner know if this doesn't clear up/.test(html),
        '…and the player-facing copy, carrying no jargon about what is broken');
      assert(!/id="site-pin-input"/.test(html) && !/Continue with Google/.test(html) && !/google-g-mark/.test(html),
        'DI-180l — no PIN field, no Google button, no logo: nothing on this screen can look like a working sign-in or a signed-in success');
      assert(/id="auth-hold-retry"/.test(html),
        '…one control only, the Retry button (harmless: it re-checks, and costs the player nothing to tap)');
      assert(!r.has('auth-config-error-banner'),
        'DI-180l — the banner-only call is REPLACED, not supplemented ("in place of, not in addition to")');
    }
    const sess = storageMod.getSession();
    assert(sess.isAdmin === false && sess.playerId === null,
      `SEC F5 — getSession() resolves signed out (${JSON.stringify(sess)}) — no commissioner is derived from a project strangers can join`);
    assert(authMod.getAuthMode() === 'supabase', 'fixture: the mode really was supabase for this boot (an interlock that never engaged would also pass the assertions above)');

    // SEC F1-R1, the other half of a SUCCESSFUL supabase boot.
    assert(r.store.get('cfbp_auth_mode_last_known') === 'supabase',
      'a successful config read RECORDS the mode — this is the value a later failed read falls back to');
    assert(r.store.get('cfbp_session') === undefined,
      'and the PIN-mode session record is removed once, so a later rollback has no stale {isAdmin:true} to resurrect');
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[13] SEC F1-R1 — a failed config read may not demote a cut-over device to PINs…');
  {
    // THE HAZARD: loadDeployedConfig()'s failure branches used to answer
    // `authMode:'pins'` with full confidence. After cutover, an offline boot /
    // Pages 5xx / SW 503 would therefore select PIN mode — and PIN mode makes
    // storage.getSession() read `cfbp_session` again, which on a pre-cutover
    // device still says isAdmin:true, on a device where cfbp_site_unlocked is
    // already '1'. Full commissioner panel, no gate, and the only banner on
    // screen talking about sync.
    const failures = [
      ['the fetch rejects (offline)', () => { throw new TypeError('Failed to fetch'); }],
      ['the server answers 503 (Pages / service worker)', () => ({ ok: false, status: 503, json: async () => ({}) })],
      ['the body is not JSON', () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } })],
    ];
    // ── REVIEWER F3 (fourth gate) — THIS BRANCH'S forceSignedOutSession() HAD
    //    NO BEHAVIORAL GUARD ─────────────────────────────────────────────────
    // Deleting it from the config-unreadable hold branch left boottest fully
    // green: the branch returns before the SDK is injected, so no membership
    // could resolve, _membershipsCache stayed null, and the synthesized session
    // answered "signed out" for a reason that had nothing to do with the latch.
    // The same class of unfalsifiable proof §12 already fixed for the interlock
    // — and the same fixture shape fixes it here: hand auth.js a resolved
    // COMMISSIONER membership BEFORE the boot runs, so that "isAdmin stays
    // false" is a claim about the latch. Proven RED on a scratch copy by
    // deleting forceSignedOutSession() from this branch.
    const seedHoldCommissioner = ({ authMod: a }) => {
      a._setMembershipsForTest([{ leagueId: 'L-HELD', memberId: 'm-held', role: 'commissioner', displayName: 'Drew', leagueName: 'Held League' }]);
      a.setActiveLeagueId('L-HELD');
      a._setAccountUserIdForTest('u-held');
      const pre = a.getSupabaseSession();
      assert(pre.isAdmin === true && pre.playerId === 'm-held',
        `fixture: before the hold boot, auth.js really does derive a COMMISSIONER (${JSON.stringify(pre)}) — so the assertions below are about forceSignedOutSession(), not about an empty cache`);
    };
    for (const [label, config] of failures) {
      const r = await runBoot({
        config,
        beforeBoot: seedHoldCommissioner,
        seed: {
          cfbp_auth_mode_last_known: 'supabase',
          cfbp_session: STALE_ADMIN_SESSION,
          cfbp_site_unlocked: '1',
          cfbp_backend_config: BACKEND_CFG,
        },
      });
      const sess = storageMod.getSession();
      assert(sess.isAdmin === false, `${label}: getSession().isAdmin is FALSE — the stale commissioner record is not resurrected, and neither is the resolved Supabase one the fixture seeded`);
      assert(sess.playerId === null, `${label}: …and no playerId is derived from it either (got ${JSON.stringify(sess.playerId)})`);
      assert(authMod.isSessionForcedOut() === true,
        `${label}: …because the branch LATCHED the session signed out (reviewer F3 — this is the assertion whose absence made forceSignedOutSession() deletable)`);
      assert(r.sessionReadsAfterModeDecision === 0,
        `${label}: cfbp_session is never READ once the mode has been decided (${r.sessionReadsAfterModeDecision} read(s)) — the mode never became 'pins'`);
      assert(authMod.getAuthMode() === 'supabase', `${label}: the effective mode stayed 'supabase' — the last-known-good value, not the failure's guess`);
      // ── DI-180l — THE BANNER IS NOW A GATE ─────────────────────────────────
      // This used to assert `auth-unavailable-banner`, i.e. one line of text at
      // the bottom of a fully painted dashboard on a device that had already
      // satisfied the site PIN (`cfbp_site_unlocked:'1'` is seeded above —
      // that is the exact device security S-1 was about). A6's teardown proof
      // for all three triggers lives in §20.
      {
        const html = r.reg.get('site-gate-overlay')?.innerHTML || '';
        assert(r.has('site-gate-overlay') && /data-hold-reason="config-unreadable"/.test(html),
          `${label}: the auth channel says so out loud AS A FULL-VIEWPORT HOLD GATE, rendered unconditionally — not behind isSiteUnlocked()`);
        assert(/We couldn't confirm you're signed in/.test(html) && /nothing has changed/.test(html),
          `${label}: …with DI-180l's exact copy, which leads with the thing the player needs to know`);
        assert(!/id="site-pin-input"/.test(html) && !/Continue with Google/.test(html),
          `${label}: …and no PIN field and no Google button anywhere in it`);
        assert(!r.has('auth-unavailable-banner'),
          `${label}: the banner-only call is REPLACED at this site, not supplemented`);
      }
      assert(r.hydrateCalls.length === 0, `${label}: and boot HOLDS — no hydrate against a data layer it cannot vouch for`);
      assert(r.store.get('cfbp_session') === STALE_ADMIN_SESSION,
        `${label}: the PIN session is left INTACT, not deleted — a transient network failure must not cost a player their rollback path`);
      assert(r.store.get('cfbp_auth_mode_last_known') === 'supabase',
        `${label}: and the last-known value is not overwritten by a read that failed`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[14] SEC F1-R1 — with NO last-known mode, a failed read is byte-identical to today…');
  {
    // The flag-off world must not change. A device that has never completed a
    // successful config read has never been a supabase device, so there is
    // nothing to fail closed about: it gets exactly the v0.21.2 behavior — the
    // PIN gate, a readable local session, and the existing red sync banner.
    const r = await runBoot({
      config: () => { throw new TypeError('Failed to fetch'); },
      seed: { cfbp_session: STALE_ADMIN_SESSION },
    });
    assert(authMod.getAuthMode() === 'pins', "no last-known mode + a failed read -> 'pins', exactly as before");
    assert(r.has('site-gate-overlay'), 'the PIN gate is up (the device had not satisfied the site PIN)');
    const gateHtml = r.reg.get('site-gate-overlay')?.innerHTML || '';
    assert(/id="site-pin-input"/.test(gateHtml) && /id="site-gate-submit"/.test(gateHtml),
      '…and it is the PIN gate, with its PIN field and submit button — not a Google gate');
    assert(!/Continue with Google/.test(gateHtml), '…with no Google sign-in anywhere in it');
    const sess = storageMod.getSession();
    assert(sess.playerId === 'p_drew' && sess.isAdmin === true,
      `getSession() reads the local session normally (${JSON.stringify(sess)}) — this is today's behavior and it is deliberately unchanged`);
    assert(r.sessionReadsAfterModeDecision > 0,
      `…proven by the fact that cfbp_session really was read AFTER the mode decision (${r.sessionReadsAfterModeDecision} read(s)) — the same counter that must read zero in [13]`);
    assert(!r.has('auth-unavailable-banner') && !r.has('auth-config-error-banner') && !r.has('auth-banner-stack'),
      'no Phase III banner of any kind — the whole surface stays inert');
    assert(r.supaScripts.length === 0, 'and no Supabase SDK is fetched');
    assert(r.has('backend-error-banner'),
      'the EXISTING red sync banner still fires for the unreadable config — the failure is still loud, on the channel it has always used (AD-06)');
    assert(r.store.get('cfbp_auth_mode_last_known') === undefined,
      'and a failed read still writes no last-known value — only a successful read may establish one');
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[15] SEC F1-R1 — a successful read is the only thing that moves the last-known value…');
  {
    // Rollback has to work in both directions, and it has to work on the first
    // boot after the flag flips — not one boot later.
    const r = await runBoot({
      config: okConfig({}),                       // no authMode key at all = 'pins'
      seed: { cfbp_auth_mode_last_known: 'supabase', cfbp_session: STALE_ADMIN_SESSION },
    });
    assert(authMod.getAuthMode() === 'pins',
      "a config that LOADS and says nothing about authMode selects 'pins' immediately, even on a device whose last-known was 'supabase' (CONVENTIONS #10)");
    assert(r.store.get('cfbp_auth_mode_last_known') === 'pins',
      '…and the last-known value is corrected to match, so the next failed read falls back to the right thing');
    assert(storageMod.getSession().playerId === 'p_drew',
      "…and the player's PIN session still works — rollback is non-destructive (DI-183g)");
    assert(!r.has('auth-config-error-banner') && !r.has('auth-unavailable-banner'), 'no Phase III banner on a pins boot');
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[16] The two decision functions say in code what they do when the read fails…');
  {
    // The class lesson, pinned. Three times in this arc a failure path silently
    // chose the permissive default. These two are the ones this pass fixed, and
    // the assertions below are structural precisely so that deleting the
    // reasoning is as loud as deleting the code.
    const backendSrc = readFileSync(new URL('./js/backend.js', import.meta.url), 'utf8');
    const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const fn = (backendSrc.match(/export async function loadDeployedConfig\(\)[\s\S]*?\n\}/) || [''])[0];
    assert(!!fn, 'fixture: loadDeployedConfig() was located in js/backend.js');
    assert(!/authMode: 'pins'/.test(fn), "no branch hardcodes authMode:'pins' any more");
    // ── SEC S-3 — STRUCTURAL, NOT BRANCH-BY-BRANCH ───────────────────────────
    // This used to name the two failure branches by their `reason:` string, so
    // it could only ever police the branches that existed the day it was
    // written; a THIRD return added later (or one of these two rewritten)
    // would ship with no flag at all and this rule would stay green — and an
    // absent flag is exactly what Finding 2 was about, because app.js used to
    // read "absent" as "the read succeeded". The requirement is a property of
    // EVERY return, so it is checked that way.
    {
      const returns = [...fn.matchAll(/\breturn\s*\{[\s\S]*?\};/g)].map(m => m[0]);
      assert(returns.length >= 4, `fixture: loadDeployedConfig() has ${returns.length} object returns to check (a matcher that found none would make the rule below vacuous)`);
      const missing = returns.filter(r => !/authModeKnown:\s*(?:true|false)\b/.test(r));
      assert(missing.length === 0,
        `EVERY return in loadDeployedConfig() carries an explicit authModeKnown:true/false${missing.length ? ' — these do not: ' + JSON.stringify(missing) : ''}`);
      // Negative self-test: the rule must go red for a return that omits it.
      const mutated = fn.replace(/authModeKnown: false/, 'reasonUnknown: false');
      const mutatedMissing = [...mutated.matchAll(/\breturn\s*\{[\s\S]*?\};/g)].map(m => m[0]).filter(r => !/authModeKnown:\s*(?:true|false)\b/.test(r));
      assert(mutatedMissing.length > 0, 'negative self-test — the rule REPORTS a return that drops the flag');
      assert(returns.some(r => /authModeKnown: false/.test(r)) && returns.some(r => /authModeKnown: true/.test(r)),
        '…and both answers are actually used: a failure says "we could not ask", a success says "we did"');
    }
    // The decision function itself, called directly — a source regex proves the
    // shape, this proves the answer.
    {
      const s = new Map();
      globalThis.localStorage = {
        getItem: k => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)),
        removeItem: k => s.delete(k), clear: () => s.clear(),
        get length() { return s.size; }, key: i => [...s.keys()][i] ?? null,
      };
      const r = appMod._resolveEffectiveAuthModeForTest;
      assert(r({ authModeKnown: false }) === 'pins', 'no last-known + a failed read -> pins');
      assert(s.get('cfbp_auth_mode_last_known') === undefined, '…and a failed read wrote nothing');
      assert(r({ authModeKnown: true, authMode: 'supabase' }) === 'supabase', 'a successful read that says supabase -> supabase');
      assert(s.get('cfbp_auth_mode_last_known') === 'supabase', '…and it is recorded');
      assert(r({ authModeKnown: false }) === 'supabase', 'a LATER failed read now returns the last-known supabase, not pins — the finding, in one line');
      assert(r({ authModeKnown: true }) === 'pins', 'a successful read with no authMode key -> pins (CONVENTIONS #10)');
      assert(s.get('cfbp_auth_mode_last_known') === 'pins', '…and that overwrites the last-known value, so rollback takes effect on the first boot, not the second');
      assert(r({ authModeKnown: false }) === 'pins', '…after which a failed read is pins again');

      // ── SEC S-3 (FINDING 2) — AN UNKNOWN SHAPE IS NOT A SUCCESSFUL READ ────
      // `authModeKnown !== false` treated `{}`, `undefined` and `null` as reads
      // that succeeded: they SELECTED 'pins' and, worse, WROTE it over a
      // genuine 'supabase' memory. One stray `resolve({})` anywhere in the
      // config path was enough to demote a cut-over device permanently.
      s.clear();
      s.set('cfbp_auth_mode_last_known', 'supabase');
      for (const [label, shape] of [['{}', {}], ['undefined', undefined], ['null', null], ['a shape with no flag at all', { authMode: 'pins', ok: true }]]) {
        assert(r(shape) === 'supabase',
          `${label} with last-known 'supabase' -> the device HOLDS on supabase (an unknown shape may not select a mode)`);
        assert(s.get('cfbp_auth_mode_last_known') === 'supabase',
          `${label}: …and the last-known memory is untouched — an unknown shape may not overwrite what a real read established`);
      }
      s.clear();
      for (const [label, shape] of [['{}', {}], ['undefined', undefined], ['null', null]]) {
        assert(r(shape) === 'pins', `${label} with NO last-known value -> 'pins', byte-identical to today's flag-off world`);
        assert(s.get('cfbp_auth_mode_last_known') === undefined, `${label}: …and still nothing is written`);
      }
    }
    const resolver = (appSrc.match(/function resolveEffectiveAuthMode\(deployed\)[\s\S]*?\n\}/) || [''])[0];
    assert(/authModeKnown === true/.test(resolver) && !/authModeKnown !== false/.test(resolver),
      'resolveEffectiveAuthMode() gates on an explicit === true — only a read that demonstrably happened may select a mode or record one');
    assert(/setLastKnownAuthMode\(mode\)/.test(resolver),
      '…and that is the only branch that records it');
    assert(/getLastKnownAuthMode\(\) \|\| 'pins'/.test(resolver),
      "…and a failed read keeps the last-known mode, falling back to 'pins' only when there has never been one");
    // The boot branch has to agree with the resolver about what "known" means,
    // or an unknown shape gets its mode from memory (right) and then sails past
    // the hold branch as though config.json had vouched for it (wrong).
    assert(/if \(deployed\.authModeKnown !== true && authMode === 'supabase'\)/.test(appSrc),
      "boot()'s hold branch uses the SAME === true test — the two cannot drift apart");
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[17] SEC S-2 — a device that cannot PERSIST its mode fails loudly, never open…');
  {
    // THE HAZARD: setLastKnownAuthMode() was `try { setItem } catch {}`. On a
    // device that cannot write (iOS private browsing, a full quota, an in-app
    // browser with partitioned storage) the cut-over mode was never recorded,
    // so getLastKnownAuthMode() kept answering '' and the FIRST config read
    // that failed downgraded that device to PINs — SEC F1-R1's escalation,
    // reintroduced through a swallowed exception.
    //
    // SCOPE, stated rather than implied: the override below refuses THIS key
    // only. A device on which NOTHING can be written is a broader pre-existing
    // condition — js/backend.js's setBackendConfig() wrote localStorage
    // unguarded and threw straight out of boot() — which this pass reported as
    // an open finding rather than silently widening into. That finding (SEC
    // F-1) was fixed on 2026-09-17 with Drew's approval for backend.js; §19
    // below is its behavioral guard, and it is the section to read for the
    // "nothing at all is writable" case.
    const refuseKey = key => store => ({
      setItem(k, v) { if (k === key) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
    });
    const errs = [];
    const realErr = console.error;
    console.error = (...a) => errs.push(a.map(String).join(' '));
    try {
      const r = await runBoot({
        config: okConfig({ authMode: 'supabase', supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' }),
        seed: { cfbp_backend_config: BACKEND_CFG },
        localStorageOverrides: refuseKey('cfbp_auth_mode_last_known'),
      });
      assert(authMod.getAuthMode() === 'supabase',
        'a supabase config read on an unwritable device still boots supabase THIS session — the config answered the question, so nothing is degraded');
      assert(r.store.get('cfbp_auth_mode_last_known') === undefined,
        'fixture: …and the value really did fail to persist (nothing was written)');
      assert(errs.some(e => /could not record that on the device/i.test(e)),
        'the failure is LOUD — console.error names it, rather than a swallowed catch hiding a future downgrade');
      assert(authMod.getLastKnownAuthMode() === 'supabase',
        "…and the in-memory copy still answers 'supabase' for the life of this page, so nothing later in the SAME boot re-reads it as 'never established'");
    } finally { console.error = realErr; }

    // THE FLAG-OFF WORLD, unchanged: a failed write of 'pins' changes nothing,
    // throws nothing, and says nothing.
    const errs2 = [];
    console.error = (...a) => errs2.push(a.map(String).join(' '));
    try {
      const r = await runBoot({
        config: okConfig({}),
        seed: { cfbp_session: STALE_ADMIN_SESSION, cfbp_backend_config: BACKEND_CFG },
        localStorageOverrides: refuseKey('cfbp_auth_mode_last_known'),
      });
      assert(authMod.getAuthMode() === 'pins', "a pins boot on an unwritable device is still a pins boot");
      assert(storageMod.getSession().playerId === 'p_drew', '…and the local PIN session still resolves normally — boot did not throw out of the write');
      assert(!errs2.some(e => /could not record that on the device/i.test(e)),
        "…and nothing is logged: 'pins' is the default anyway, so failing to record it costs nothing and must not cry wolf");
      assert(!r.has('auth-config-error-banner') && !r.has('auth-unavailable-banner'), '…and no Phase III banner appears');
    } finally { console.error = realErr; }

    // The write is VERIFIED, not assumed: setLastKnownAuthMode() reads back.
    {
      const s = new Map();
      globalThis.localStorage = {
        getItem: k => (s.has(k) ? s.get(k) : null),
        setItem: (k, v) => s.set(k, String(v)),
        removeItem: k => s.delete(k), clear: () => s.clear(),
        get length() { return s.size; }, key: i => [...s.keys()][i] ?? null,
      };
      assert(authMod.setLastKnownAuthMode('supabase') === true, 'setLastKnownAuthMode() reports TRUE when the value really is on the device');
      globalThis.localStorage.setItem = () => {};   // a setItem that silently does nothing — the shape a catch{} cannot see
      assert(authMod.setLastKnownAuthMode('pins') === false,
        '…and FALSE for a setItem() that neither throws nor stores — proven by reading the value back, which is the only way to know');
      assert(authMod.getLastKnownAuthMode() === 'supabase',
        '…and storage still holds the value it really has (the read prefers the device, not the wish)');
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[18] SEC S-6 — config.json is never written to the service-worker cache…');
  {
    // THE HAZARD: loadDeployedConfig() cache-busts with `config.json?t=<epoch>`,
    // and Cache Storage keys on the FULL url. Every boot therefore created a new,
    // permanently unreadable cache entry holding `backendToken` in plain text —
    // unbounded growth plus a needless multiplication of the secret, both
    // surviving until CACHE_NAME next changes.
    //
    // Executed, not just grepped: the real file is evaluated with a stub `self`
    // so the REAL fetch handler answers real requests. A source regex could not
    // tell "excluded from caching" from "excluded from the app shell list".
    const swSrc = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
    const listeners = {};
    const cacheStore = new Map();
    const fakeCache = {
      put: async (req, res) => { cacheStore.set(String(req.url || req), res); },
      addAll: async () => {},
      match: async () => undefined,
    };
    const fakeCaches = {
      open: async () => fakeCache,
      match: async req => cacheStore.get(String(req.url || req)),
      keys: async () => [...new Set([...cacheStore.keys()].map(() => 'x'))],
      delete: async () => true,
    };
    let networkUp = true;
    const swFetch = async req => {
      if (!networkUp) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, type: 'basic', url: String(req.url || req), clone() { return this; } };
    };
    const selfStub = {
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      skipWaiting: () => {}, clients: { claim: async () => {} },
    };
    new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', 'importScripts', 'console', swSrc)(
      selfStub, fakeCaches, swFetch,
      class { constructor(body, init) { this.body = body; this.status = init?.status; this.synthetic = true; } },
      class { constructor(u) { this.url = String(u); } },
      URL, () => { throw new Error('no network in boottest'); }, { warn() {}, error() {}, log() {} },
    );
    assert((listeners.fetch || []).length === 1, 'fixture: the real service-worker.js registered exactly one fetch handler, which every assertion below drives');

    /** Drive the REAL handler and report what the page would receive. */
    const swRequest = async url => {
      let responded = null;
      await (listeners.fetch[0]({ request: { url, method: 'GET' }, respondWith: p => { responded = p; } }), null);
      return responded ? await responded : 'NOT_HANDLED';
    };

    cacheStore.clear();
    const cfg1 = await swRequest('https://irbfootball.com/config.json?t=1000');
    const cfg2 = await swRequest('https://irbfootball.com/config.json?t=2000');
    assert(cfg1.status === 200 && cfg2.status === 200 && !cfg1.synthetic,
      'ONLINE: the page still receives the live network response for config.json, unchanged');
    assert(cacheStore.size === 0,
      `…and NOTHING was written to the cache (found ${cacheStore.size} entr(ies): ${JSON.stringify([...cacheStore.keys()])}) — two boots, two timestamps, zero permanent copies of backendToken`);

    const shell = await swRequest('https://irbfootball.com/js/app.js');
    assert(shell.status === 200 && cacheStore.size === 1 && [...cacheStore.keys()][0].includes('app.js'),
      'FALSIFIABILITY: an app-shell request IS still cached — the exclusion is scoped to config.json, not a blanket "stop caching"');

    networkUp = false;
    const offlineCfg = await swRequest('https://irbfootball.com/config.json?t=3000');
    assert(offlineCfg.synthetic === true && offlineCfg.status === 503,
      'OFFLINE: config.json gets the SAME synthetic 503 it always did — the failure stays honest, and loadDeployedConfig() still reports authModeKnown:false');
    const offlineShell = await swRequest('https://irbfootball.com/js/app.js');
    assert(offlineShell.status === 200 && !offlineShell.synthetic,
      '…while the app shell still falls back to its cached copy, so offline boot is unaffected');
    networkUp = true;

    // The warning that must not be removed. `ignoreSearch` would serve a STALE
    // cached config as a 200, which loadDeployedConfig() reports as a SUCCESSFUL
    // read — re-opening SEC F1-R1's downgrade from the device's own disk.
    // Checked against the CODE, with comments blanked — the warning comment at
    // the site necessarily contains the word, and a rule that could not tell a
    // warning from a use would have to be deleted the moment it was written.
    const swCode = swSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    assert(!/ignoreSearch/.test(swCode),
      'service-worker.js CODE contains NO ignoreSearch anywhere — a stale config.json served as a 200 would read as a successful config read and re-open the pins downgrade');
    // REVIEWER F6 (fourth gate) — THE FIXTURE LINE THAT USED TO SIT HERE WAS A
    // TAUTOLOGY: `/ignoreSearch/.test(swCode + ' ignoreSearch')` appends the
    // needle to the haystack and then looks for it, so it is true for every
    // possible input, including an empty file. Deleted. What it was reaching
    // for — "the blanker hides the warning comment but not a real use" — is
    // already covered exactly, and falsifiably, by the two lines around it:
    // the word IS in the file, the CODE is clean, and the mutation below proves
    // the rule still fires on a genuine use.
    assert(/ignoreSearch/.test(swSrc),
      'fixture: the word IS in the file (in the warning comment), so the clean-code rule above is about the blanker working, not about an absent word');
    assert(/ignoreSearch/.test(swCode.replace('caches.match(request)', 'caches.match(request, { ignoreSearch: true })')),
      'negative self-test — the rule REPORTS an ignoreSearch actually added to the cache lookup');
    assert(/DO NOT ADD .ignoreSearch/i.test(swSrc),
      '…and the reason is written at the site, so the next person to "fix" offline config reads meets the argument first');

    // ── REVIEWER F6 — THE ACTIVATE PURGE, DRIVEN RATHER THAN GREPPED ─────────
    // This used to be a regex for the literal text of the filter expression,
    // which proves the characters are present and nothing about what happens.
    // The real handler is already registered on `selfStub` above, so it can be
    // driven: give `caches` TWO names — the current CACHE_NAME and a stale one
    // from before this change, which is precisely the cache holding the old
    // `config.json?t=…` entries with backendToken in them — and read which one
    // survives.
    {
      assert((listeners.activate || []).length === 1,
        'fixture: the real service-worker.js registered exactly one activate handler, which the assertion below drives');
      const CACHE_NAME_NOW = (swSrc.match(/const CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1];
      assert(!!CACHE_NAME_NOW, 'fixture: CACHE_NAME was read out of the real service-worker.js');
      let names = [CACHE_NAME_NOW, 'cfbp-v20-9-stale'];
      const deleted = [];
      const purgeCaches = {
        open: async () => fakeCache,
        match: async () => undefined,
        keys: async () => names.slice(),
        delete: async k => { deleted.push(k); names = names.filter(n => n !== k); return true; },
      };
      // The handler closes over the module-scope `caches` the evaluator was
      // given, so re-evaluate the real source against this one rather than
      // pretending to swap it underneath the old closure.
      const purgeListeners = {};
      new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', 'importScripts', 'console', swSrc)(
        { addEventListener: (t, fn) => { (purgeListeners[t] = purgeListeners[t] || []).push(fn); }, skipWaiting: () => {}, clients: { claim: async () => {} } },
        purgeCaches, swFetch,
        class { constructor(body, init) { this.body = body; this.status = init?.status; this.synthetic = true; } },
        class { constructor(u) { this.url = String(u); } },
        URL, () => { throw new Error('no network in boottest'); }, { warn() {}, error() {}, log() {} },
      );
      let waited = null;
      purgeListeners.activate[0]({ waitUntil: p => { waited = p; } });
      if (waited) await waited;
      assert(deleted.includes('cfbp-v20-9-stale'),
        `the activate handler really DELETES a cache whose name is not the current CACHE_NAME (deleted: ${JSON.stringify(deleted)}) — so the config.json entries already on devices are purged at the next version bump, with no extra step`);
      assert(!deleted.includes(CACHE_NAME_NOW),
        `FALSIFIABILITY: …and it does NOT delete the current one (${CACHE_NAME_NOW}), so this is a purge and not a "delete everything" that would wipe the app shell on every activate`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[19] SEC F-1 — a device that cannot write ANY key still boots…');
  {
    // THE HAZARD (pre-existing since the v0.17.1 baseline, reported as an open
    // finding by §17's scope note and fixed here with Drew's approval
    // 2026-09-17): js/backend.js's setBackendConfig() assigned the in-memory
    // _config and then called localStorage.setItem() UNGUARDED, and boot()
    // calls it at js/app.js:700 with no enclosing try — BEFORE
    // resolveEffectiveAuthMode() and every fail-closed auth branch below it.
    //
    // On a device whose storage rejects writes (quota exhausted; private mode
    // on some browsers) boot() therefore REJECTED at that line and nothing
    // after it ran:
    //   • flag off  — a dead boot with no banner of any kind, which is an
    //                 AD-06 loud-fail violation by omission;
    //   • after cut-over — the app left in the default 'pins' mode with a
    //                 possibly stale PIN-era session and no gate, i.e. the
    //                 whole fail-closed architecture bypassed by an exception.
    // clearBackendConfig()'s removeItem() was unguarded the same way.
    //
    // SIBLING of §17's refuseKey(): that one refuses ONE key, because SEC S-2
    // was about one key. This refuses EVERY write, which is the actual device
    // condition — and note that it makes runBoot()'s own reset line
    // (backendMod.clearBackendConfig()) part of the test surface, which is
    // correct: that is the second unguarded write.
    const refuseAllWrites = () => ({
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('QuotaExceededError'); },
      clear() { throw new Error('QuotaExceededError'); },
    });

    // ── FLAG OFF, nothing writable: boot completes, unchanged on screen ──────
    {
      const warns = [];
      const realWarn = console.warn;
      const rejections = [];
      const onRej = e => rejections.push(String(e?.message || e));
      process.on('unhandledRejection', onRej);
      console.warn = (...a) => warns.push(a.map(String).join(' '));
      let bootThrew = null, r = null;
      try {
        r = await runBoot({
          config: okConfig({}),                       // a real config: setBackendConfig() IS called
          seed: { cfbp_session: STALE_ADMIN_SESSION }, // no cfbp_backend_config on the device
          localStorageOverrides: refuseAllWrites,
        });
      } catch (e) { bootThrew = e; } finally {
        console.warn = realWarn;
        process.off('unhandledRejection', onRej);
      }
      const R = r || { store: new Map(), fetches: [], reg: new Map(), has: () => false, sessionReadsAfterModeDecision: 0, supaScripts: [] };
      assert(!bootThrew,
        `the boot path does not THROW on a device where no key can be written (threw: ${bootThrew && (bootThrew.message || bootThrew)})`);
      assert(rejections.length === 0,
        `…and boot() does not REJECT either (unhandled: ${JSON.stringify(rejections)}) — an exception here kills every fail-closed branch below it`);
      assert(R.store.get('cfbp_backend_config') === undefined,
        'fixture: …and the device write really did fail (nothing was persisted), so the assertions above are not passing by accident');
      assert(backendMod.getBackendConfig()?.token === BACKEND_TOKEN && backendMod.getBackendConfig()?.url === BACKEND_URL,
        'the IN-MEMORY config is set anyway — this page is fully configured for the life of the session');
      assert(R.fetches.some(u => u.startsWith(BACKEND_URL)),
        `…and hydrate really ran from it (${JSON.stringify(R.fetches)}) — an unwritable device still syncs normally this session, which is why this is a console warning and NOT a red banner`);
      assert(authMod.getAuthMode() === 'pins',
        'boot reached the mode decision and selected pins — the flag-off world is unchanged');
      assert(R.has('site-gate-overlay') && /id="site-pin-input"/.test(R.reg.get('site-gate-overlay')?.innerHTML || ''),
        '…the PIN gate renders exactly as it does on a normal device');
      assert(R.sessionReadsAfterModeDecision > 0,
        `…and cfbp_session is still read after the mode decision (${R.sessionReadsAfterModeDecision}), so the player is logged in as normal`);
      assert(!R.has('auth-unavailable-banner') && !R.has('auth-config-error-banner') && !R.has('auth-banner-stack'),
        '…and no Phase III banner appears: an unwritable device is not an auth failure');
      const cfgWarns = warns.filter(w => /backend config could not be saved/i.test(w));
      assert(cfgWarns.length === 1,
        `the failure is reported ONCE on the console, not swallowed (${cfgWarns.length} matching warning(s) of ${warns.length})`);
      assert(!cfgWarns.some(w => w.includes(BACKEND_TOKEN) || w.includes(BACKEND_URL)),
        '…and the message names NO secret — neither the token nor the backend URL appears in it');
    }

    // ── THE PARTIAL CASE the security reviewer named ─────────────────────────
    // Storage READABLE (so a last-known 'supabase' can exist on this device),
    // writes throw, and the config read fails. The hold branch is the whole
    // point of SEC F1-R1 and it must still hold — it sits BELOW the line that
    // used to throw, so before this fix it was unreachable on such a device.
    {
      const realWarn = console.warn, realErr = console.error;
      console.warn = () => {}; console.error = () => {};
      let bootThrew = null, r = null;
      try {
        r = await runBoot({
          config: () => { throw new TypeError('Failed to fetch'); },
          seed: { cfbp_auth_mode_last_known: 'supabase', cfbp_session: STALE_ADMIN_SESSION },
          localStorageOverrides: refuseAllWrites,
        });
      } catch (e) { bootThrew = e; } finally { console.warn = realWarn; console.error = realErr; }
      const R = r || { store: new Map(), fetches: [], reg: new Map(), has: () => false, hydrateCalls: [] };
      assert(!bootThrew, `the same device with an unreadable config also boots without throwing (threw: ${bootThrew && (bootThrew.message || bootThrew)})`);
      assert(authMod.getAuthMode() === 'supabase',
        "…and it keeps its last-known 'supabase' mode rather than being downgraded to PINs by an exception");
      // DI-180l — the same branch, now proven by the GATE it stands up rather
      // than by the banner it used to raise.
      assert(R.has('site-gate-overlay') && /data-hold-reason="config-unreadable"/.test(R.reg.get('site-gate-overlay')?.innerHTML || ''),
        '…and it reaches the config-unreadable HOLD branch — the branch that lives below the line that used to throw');
      assert(storageMod.getSession().isAdmin === false,
        `…with NO admin derived (${JSON.stringify(storageMod.getSession())}) — held signed out, never degraded`);
      assert(R.hydrateCalls.length === 0,
        `…and no hydrate ran (${R.hydrateCalls.length} call(s)) — the hold is a real hold`);
    }

    // ── The two writes, directly: guarded, and they SAY whether they landed ──
    {
      const realWarn = console.warn;
      const warns = [];
      console.warn = (...a) => warns.push(a.map(String).join(' '));
      const store = new Map();
      globalThis.localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
        clear: () => store.clear(),
        get length() { return store.size; }, key: i => [...store.keys()][i] ?? null,
      };
      try {
        assert(backendMod.setBackendConfig(BACKEND_URL, BACKEND_TOKEN).persisted === true,
          'setBackendConfig() reports persisted:true on a normal device, and the byte written is unchanged');
        assert(store.get('cfbp_backend_config') === JSON.stringify({ url: BACKEND_URL, token: BACKEND_TOKEN }),
          '…with exactly the same two-key payload as before this fix — no `persisted` key leaks into the stored config');
        assert(backendMod.clearBackendConfig() === true, 'clearBackendConfig() reports true when the key really is gone');
        globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        globalThis.localStorage.removeItem = () => { throw new Error('QuotaExceededError'); };
        const res = backendMod.setBackendConfig(BACKEND_URL, BACKEND_TOKEN);
        assert(res.persisted === false && res.url === BACKEND_URL && res.token === BACKEND_TOKEN,
          '…and persisted:false with the live config still in hand when the device refuses the write — a flag the caller can act on, instead of an exception it cannot');
        assert(backendMod.isBackendConfigured() === true,
          '…isBackendConfigured() is still true, which is what keeps hydrate running this session');
        assert(backendMod.clearBackendConfig() === false && backendMod.getBackendConfig() === null,
          '…and clearBackendConfig() reports false but STILL clears memory: disconnect must work on an unwritable device too');
      } finally { console.warn = realWarn; }
      assert(warns.filter(w => /backend config could not be/i.test(w)).length === 2,
        `each refused write warns exactly once (${warns.length} warning(s) captured)`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[20] DI-180l / A3 + A6 — the hold gate, on a REAL boot(), on a device that already satisfied the site PIN…');
  {
    // ── WHY THIS SECTION EXISTS, in the reviewer's own terms ────────────────
    // "That is the assertion whose absence let S-1 through a 163/0 suite."
    //
    // Security S-1: three fail-closed states rendered as a BANNER over a fully
    // painted dashboard. On a device whose `cfbp_site_unlocked` was already
    // set, boot()'s only gate call (`if (!isSiteUnlocked()) showSitePinGate()`)
    // does nothing, and both hold branches only ever took an overlay DOWN —
    // never stood one UP. So a device with NO proven identity sat looking at
    // its league's picks and standings, painted from its own local mirror,
    // under one line of text.
    //
    // A6 sharpens it: an overlay is not a data boundary. Even with a gate up,
    // the league data is still IN the document for anyone who opens dev tools.
    // So the branch tears the page content down BEFORE it paints, and that —
    // not "an overlay exists" — is what is asserted here.
    const MIRROR = JSON.stringify({
      at: new Date().toISOString(),
      data: {
        cfbp_players: [{ id: 'p_drew', displayName: 'Drew', pin: '1111' }, { id: 'p_kihoon', displayName: 'Kihoon', pin: '2222' }],
        cfbp_weeks: [{ weekId: 'w4', name: 'Week 4', status: 'open', startDate: '2026-09-19', endDate: '2026-09-20' }],
        cfbp_settings: { chatEnabled: false },
      },
    });
    const TRIGGERS = [
      ['config-unreadable',
        () => { throw new TypeError('Failed to fetch'); },
        { cfbp_auth_mode_last_known: 'supabase' },
        false],
      ['interlock',
        okConfig({ authMode: 'supabase', supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' }),
        {},
        false],
      ['sdk-unavailable',
        okConfig({ authMode: 'supabase', supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' }),
        {},
        true],
    ];
    for (const [reason, config, extraSeed, needsDataBackend] of TRIGGERS) {
      const realErr = console.error, realWarn = console.warn;
      console.error = () => {}; console.warn = () => {};
      let r = null, threw = null;
      try {
        r = await runBoot({
          config,
          paintPages: true,
          // The sdk-unavailable trigger sits BELOW the interlock, so it is only
          // reachable with the Step-4 data backend pretended live — which is
          // exactly why it is unreachable in production today, and is said so
          // in the report rather than left implied.
          beforeBoot: needsDataBackend ? ({ authMod: a }) => a._setHasSupabaseDataBackendForTest(true) : null,
          seed: {
            cfbp_site_unlocked: '1',          // THE DEVICE UNDER TEST
            cfbp_sheet_mirror: MIRROR,        // …with a primed local mirror
            cfbp_backend_config: BACKEND_CFG,
            ...extraSeed,
          },
          // sdk-unavailable: the injected <script> fires 'error', so
          // ensureSupabaseSdkLoaded() resolves false with no saved session.
          withSdk: !needsDataBackend,
        });
      } catch (e) { threw = e; } finally { console.error = realErr; console.warn = realWarn; }
      assert(!threw, `${reason}: the real boot() completed without throwing (${threw && (threw.message || threw)})`);
      assert(storageMod.isSiteUnlocked() === true,
        `${reason}: fixture — this device HAD already satisfied the site PIN, so boot() painted no PIN gate of its own; that is the device S-1 was about`);
      const ov = r.reg.get('site-gate-overlay');
      assert(!!ov, `${reason}: a full-viewport gate IS up — rendered unconditionally, not behind isSiteUnlocked()`);
      const html = ov?.innerHTML || '';
      assert(new RegExp(`data-hold-reason="${reason}"`).test(html),
        `${reason}: …and it is the hold gate for THIS trigger (got ${JSON.stringify((html.match(/data-hold-reason="([^"]+)"/) || [])[1])})`);
      assert(!/id="site-pin-input"/.test(html) && !/Continue with Google/.test(html),
        `${reason}: with no PIN field and no Google button in it`);

      // ── A6, the assertion the reviewer asked for by name ────────────────
      const leftover = Object.entries(r.paintedPages).filter(([, el]) => String(el.innerHTML || '') !== '');
      assert(leftover.length === 0,
        `${reason}: A6 — NO mirror-derived markup is reachable in the DOM (${leftover.length} container(s) still painted: ${JSON.stringify(leftover.map(([id]) => id))}). Not "an overlay exists" — the page content itself is gone.`);
      assert(Object.keys(r.paintedPages).length === 9,
        `${reason}: fixture — nine containers were painted before the boot (six page sections + week block + league pill + identity chip), so the assertion above is about a real teardown`);
      assert(r.paintedPages['league-pill'].getAttribute('aria-label') === null,
        `${reason}: DI-184j — …including the league pill's accessible name, through the same _clearLeaguePill()`);
      assert(r.hydrateCalls.length === 0,
        `${reason}: and no hydrate runs behind the hold (${r.hydrateCalls.length} call(s)) — the hold is a real hold`);
      assert(storageMod.getSession().isAdmin === false,
        `${reason}: …with no admin derived (${JSON.stringify(storageMod.getSession())})`);
      // ── SECURITY 7/8 (fifth gate) — WHAT ELSE THE TEARDOWN NOW TAKES ──────
      assert(r.chrome.main.getAttribute('inert') === '' && r.chrome.main.getAttribute('aria-hidden') === 'true'
             && r.chrome.nav.getAttribute('inert') === '' && r.chrome.nav.getAttribute('aria-hidden') === 'true',
        `${reason}: security 7 — .main-content and .bottom-nav are inert + aria-hidden, so the withheld page is unreachable by keyboard, screen reader and scripted click rather than merely covered by an opaque div`);
      assert(!r.has('an-open-modal') && r.chrome.toasts.innerHTML === '',
        `${reason}: security 8 — an open modal overlay is REMOVED and the toast container emptied: both render IN FRONT of the gate's z-index, not behind it`);
      assert(Object.values(r.paintedPages).every(el => !el.classList.contains('active')),
        `${reason}: security 8 — the \`.active\` marker is off every page section, which is what chat-ui.js's own subscriber keys its repaints on (it owns #page-chat and the dashboard teaser, and cannot import app.js to be told to stop)`);
      assert(!/^\(3\)/.test(String(globalThis.document.title)),
        `${reason}: …and the unread count is off the tab title`);
      appMod._resetAuthHoldForTest();
    }

    // ── AND THE FLAG-OFF WORLD IS UNTOUCHED BY ALL OF IT ───────────────────
    {
      const r = await runBoot({
        config: okConfig({}),                 // no authMode key at all = 'pins'
        paintPages: true,
        seed: { cfbp_site_unlocked: '1', cfbp_sheet_mirror: MIRROR, cfbp_session: STALE_ADMIN_SESSION, cfbp_backend_config: BACKEND_CFG },
      });
      assert(authMod.getAuthMode() === 'pins', 'fixture: a pins boot');
      assert(appMod.currentAuthHoldReason() === '', 'pins mode: no hold state');
      const ov = r.reg.get('site-gate-overlay');
      assert(!ov || !/data-hold-reason/.test(ov.innerHTML || ''),
        'pins mode: NO hold-gate DOM anywhere — the flag-off world never reaches any of this');
      assert(!r.has('auth-hold-retry'), '…no Retry button');
      assert(!r.has('auth-banner-stack') && !r.has('auth-unavailable-banner') && !r.has('auth-config-error-banner'),
        '…and no Phase III banner either: the whole surface stays inert');
      // Scoped to the six PAGE containers on purpose. The league pill and the
      // identity chip are cleared in pins mode by their OWN render functions
      // (renderLeaguePill()/renderHeaderIdentity() — "inert in 'pins'", which
      // predates this amendment), and the header week block is rewritten by
      // refreshHeader(). Those are the app working normally; A6's teardown is
      // about PAGE CONTENT, so that is what is measured.
      const emptied = appMod._APP_PAGE_CONTAINER_IDS_FOR_TEST
        .filter(id => String(r.paintedPages[id]?.innerHTML || '') === '');
      assert(emptied.length === 0,
        `…and no page container was torn down (emptied: ${JSON.stringify(emptied)}) — A6's teardown is reachable only from a hold branch, so a pins boot keeps painting normally`);
      assert(storageMod.getSession().playerId === 'p_drew',
        `…and the player is logged in exactly as before (${JSON.stringify(storageMod.getSession())})`);
      assert(r.chrome.main.getAttribute('inert') === null && r.chrome.main.getAttribute('aria-hidden') === null,
        'pins mode: nothing is made inert — the PIN gate keeps exactly the paint-first behaviour it shipped with (AD-08)');
      assert(r.has('an-open-modal') && r.chrome.toasts.innerHTML !== '',
        '…and no modal/toast teardown runs either: A6 is reachable only from a hold branch');
    }
    appMod._resetAuthHoldForTest();
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[21] SECURITY S-1/S-2 (fifth gate) — the teardown is DURABLE, and clearing a hold never leaves NO gate…');
  {
    // ── WHY THIS SECTION EXISTS ────────────────────────────────────────────
    // §20 proves the teardown HAPPENS. Both fifth-gate reviews found the same
    // thing one layer down: nothing proved it STAYS. Two live paths repainted
    // the whole mirror-derived page behind the overlay —
    //   S-2: setupAutoRefresh() is armed at boot ABOVE the gate decision, so
    //        runAutoRefreshTick() -> renderDashboard() fired ~60 seconds later;
    //        and refreshAuthUI() ends in navigateTo(), so any session event did
    //        the same immediately;
    //   S-1: runAuthHoldCheck() paints the resolved gate and THEN called
    //        hideAuthHoldGate(), which removed #site-gate-overlay
    //        unconditionally — deleting the gate just painted — after which
    //        resumeAfterHoldCleared() repainted the league's dashboard with no
    //        identity at all. Reached by the 20-second timer, unattended.
    //
    // So this section DRIVES THE PAGE FORWARD after the gate is up (R1) and
    // then drives every RECOVERY (R2): hold variant x {saved valid session,
    // none}, asserting what gate is up afterwards and whether anything was
    // repainted. The fixture carries GAMES and chatEnabled:true so there is
    // real content available to be repainted by mistake.
    const MIRROR_LIVE = JSON.stringify({
      at: new Date().toISOString(),
      data: {
        cfbp_players: [{ id: 'p_drew', displayName: 'Drew', pin: '1111', active: true },
                       { id: 'p_kihoon', displayName: 'Kihoon', pin: '2222', active: true }],
        cfbp_weeks: [{ weekId: 'w4', weekNumber: 4, name: 'Week 4', status: 'open',
                       startDate: '2026-09-19', endDate: '2026-09-20', isCurrent: true }],
        cfbp_games: [{ gameId: 'g1', weekId: 'w4', homeTeam: 'Texas A&M', awayTeam: 'LSU',
                       homeScore: null, awayScore: null, spread: -3.5, lockedSpread: null,
                       status: 'scheduled', kickoff: '2026-09-19T23:00:00.000Z', multiplier: 1 }],
        cfbp_picks: [],
        cfbp_settings: { chatEnabled: true, autoRefreshInterval: 60 },
      },
    });
    const VALID_SUPA_SESSION = () => JSON.stringify({ access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    const SUPA_CFG = { authMode: 'supabase', supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' };

    /**
     * One boot into a hold, then the world HEALS and the background re-check
     * runs. `cfg` is mutable: the first read fails/interlocks, the second
     * answers whatever `cfg.after` says.
     */
    async function holdThenRecover({ variant, validSession, after, dataBackendAfter = true }) {
      const cfg = { phase: 'before' };
      const config = () => {
        if (cfg.phase === 'before') {
          if (variant === 'config-unreadable') throw new TypeError('Failed to fetch');
          return { ok: true, json: async () => ({ backendUrl: BACKEND_URL, backendToken: BACKEND_TOKEN, ...SUPA_CFG }) };
        }
        return { ok: true, json: async () => ({ backendUrl: BACKEND_URL, backendToken: BACKEND_TOKEN, ...after }) };
      };
      const realErr = console.error, realWarn = console.warn;
      console.error = () => {}; console.warn = () => {};
      let r = null;
      try {
        r = await runBoot({
          config,
          paintPages: true,
          // sdk-unavailable sits BELOW the interlock, so reaching it at all
          // requires the Step-4 data backend pretended live (same note as §20).
          withSdk: variant !== 'sdk-unavailable',
          beforeBoot: variant === 'sdk-unavailable' ? ({ authMod: a }) => a._setHasSupabaseDataBackendForTest(true) : null,
          seed: {
            cfbp_site_unlocked: '1',
            cfbp_sheet_mirror: MIRROR_LIVE,
            cfbp_backend_config: BACKEND_CFG,
            ...(variant === 'config-unreadable' ? { cfbp_auth_mode_last_known: 'supabase' } : {}),
            ...(validSession ? { cfbp_supabase_session: VALID_SUPA_SESSION() } : {}),
          },
        });
      } finally { console.error = realErr; console.warn = realWarn; }
      return { r, heal: () => { cfg.phase = 'after'; authMod._setHasSupabaseDataBackendForTest(dataBackendAfter); } };
    }

    const painted = pages => Object.entries(pages)
      .filter(([id, el]) => appMod._APP_PAGE_CONTAINER_IDS_FOR_TEST.includes(id) && String(el.innerHTML || '') !== '')
      .map(([id]) => id);

    // ── R1 — THE PAGE IS DRIVEN FORWARD WHILE THE HOLD IS UP ───────────────
    {
      const { r } = await holdThenRecover({ variant: 'config-unreadable', validSession: false, after: {} });
      assert(appMod.currentAuthHoldReason() === 'config-unreadable', 'fixture: the hold is up on a device with a live mirror (games, an open week, chat enabled)');
      assert(painted(r.paintedPages).length === 0, 'fixture: …and the teardown emptied every page container');
      const realErr = console.error, realWarn = console.warn;
      console.error = () => {}; console.warn = () => {};
      try {
        // 1) the 60-second score/render tick — the path that repainted the
        //    dashboard behind the overlay about a minute after the gate went up.
        await appMod.runAutoRefreshTick();
        assert(painted(r.paintedPages).length === 0,
          `R1 — after ONE runAutoRefreshTick() the containers are STILL empty (repainted: ${JSON.stringify(painted(r.paintedPages))})`);
        // NOT "zero fetches": the chat transport starts BEFORE the gate decision
        // by design (BUG-G), so a held boot legitimately has backend traffic of
        // its own. What the TICK must not do is fetch scores — doRefreshScores()
        // is the only ESPN caller in the app, and tickAutoTransition() writing a
        // week status change would ride that same tick.
        assert(r.fetches.filter(u => /espn/i.test(u)).length === 0,
          `R1 — …and the tick fetched NO scores: a device with no proven identity does not talk to ESPN, and does not write an automatic week transition on the league's behalf (espn calls: ${r.fetches.filter(u => /espn/i.test(u)).length})`);
        // 2) one auth/session event through the REAL listener chain.
        appMod.wireAuthUIEvents();
        authMod._fireAuthEventForTest('INITIAL_SESSION', null);
        for (let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0));
        assert(painted(r.paintedPages).length === 0,
          `R1 — …and after one real session event (refreshAuthUI ends in navigateTo, which is how the second path undid it) (repainted: ${JSON.stringify(painted(r.paintedPages))})`);
        // 3) the two window bridges chat-ui.js and the notification tap use.
        const fetchesBefore = r.fetches.length;
        globalThis.window.navigateTo('dashboard');
        globalThis.window.deepLinkTo({ tab: 'dashboard' });
        globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'm1' } });
        for (let i = 0; i < 10; i++) await new Promise(res => setTimeout(res, 0));
        assert(r.fetches.length === fetchesBefore,
          `R1 — a deep link into CHAT forces a room fetch (wakeChat), so the guard has to stop the whole path and not just the render: no request was made (${r.fetches.length - fetchesBefore} new)`);
        assert(painted(r.paintedPages).length === 0,
          `R1 — …and after window.navigateTo() + two window.deepLinkTo() calls (repainted: ${JSON.stringify(painted(r.paintedPages))})`);
        assert(appMod.currentAuthHoldReason() === 'config-unreadable' && appMod.isContentWithheld() === true,
          'R2 — the lock is still held through all of it: nothing above releases it as a side effect');
      } finally { console.error = realErr; console.warn = realWarn; appMod._resetAuthHoldForTest(); }
    }

    // ── R2 — EVERY RECOVERY, AND WHAT IS ON SCREEN AFTERWARDS ──────────────
    // The matrix the reviewer asked for by name: each hold variant x {a saved
    // valid session, none}. "Recovered" must never mean "no gate and no
    // identity", and it must never mean "the page stays blank forever" either.
    for (const variant of ['config-unreadable', 'sdk-unavailable']) {
      // (i) NO saved session -> the Google gate, and NOTHING repainted.
      {
        const { r, heal } = await holdThenRecover({ variant, validSession: false, after: SUPA_CFG });
        assert(appMod.currentAuthHoldReason() === variant, `${variant}/no-session: fixture — the hold is up`);
        // The resume does far more than repaint: it hydrates the league mirror,
        // seeds, and runs boot()'s whole tail (OneSignal login with a playerId,
        // the wager fetch, the chat notification wiring). None of that may run
        // for a device with no identity, so the push adapter's registration is
        // read as the observable "did the resume run at all".
        notifyMod._clearPushAdapterForTest();
        heal();
        const realErr = console.error, realWarn = console.warn;
        console.error = () => {}; console.warn = () => {};
        try {
          // The world heals: on the sdk-unavailable variant that means the
          // vendored script finally arrives (installSdk() is exactly what the
          // <script> tag's own load does in this harness), which is the case A2
          // promises resolves by itself.
          r.installSdk();
          await appMod.runAuthHoldCheck({ manual: false });
          for (let i = 0; i < 30; i++) await new Promise(res => setTimeout(res, 0));
        } finally { console.error = realErr; console.warn = realWarn; }
        const ov = r.reg.get('site-gate-overlay');
        assert(!!ov,
          `${variant}/no-session: S-1 — AN OVERLAY IS STILL ON SCREEN after the hold cleared. hideAuthHoldGate() used to delete the gate applyAuthModeDecision() had just painted, leaving a device with no identity and no lock`);
        assert(ov.getAttribute('data-gate-state') !== 'hold',
          `${variant}/no-session: …and it is no longer the hold variant — the hold really did clear rather than being re-raised`);
        assert(/Continue with Google/.test(ov.innerHTML || ''),
          `${variant}/no-session: …it is the Google sign-in gate, which is the correct gate for "no session on this device"`);
        assert(painted(r.paintedPages).length === 0,
          `${variant}/no-session: and NO page container was repainted (${JSON.stringify(painted(r.paintedPages))}) — resumeAfterHoldCleared() refuses while no identity is proven`);
        assert(appMod.isContentWithheld() === true, `${variant}/no-session: …because the one predicate still says content is withheld`);
        assert(notifyMod.hasPushAdapter() === false,
          `${variant}/no-session: and the RESUME ITSELF never ran — no hydrate, no seed, no boot tail, no OneSignal login for a device with no identity (the push adapter is still unregistered). resumeAfterHoldCleared() does much more than paint, so refusing it is not the same as refusing navigateTo()`);
        appMod._resetAuthHoldForTest();
      }
      // (ii) A SAVED VALID SESSION -> no gate at all, and the page DOES come
      //      back. This is the non-vacuity half of every "still empty" above:
      //      the same drive paints normally the moment an identity exists.
      {
        const { r, heal } = await holdThenRecover({ variant, validSession: true, after: SUPA_CFG });
        // sdk-unavailable is unreachable WITH a saved session (DI-180m routes
        // that device to the banner instead), so only the config-unreadable
        // variant can be driven here — said out loud rather than skipped.
        if (variant === 'sdk-unavailable') {
          assert(appMod.currentAuthHoldReason() === '',
            'sdk-unavailable/with-session: by design there is NO hold — a device that has already proven who it is gets DI-180m\'s banner, not a re-block (A8)');
          assert(r.has('auth-unavailable-banner'),
            '…and that banner is what is on screen, with its Sign In action');
          appMod._resetAuthHoldForTest();
          continue;
        }
        assert(appMod.currentAuthHoldReason() === variant, `${variant}/with-session: fixture — the hold is up`);
        assert(painted(r.paintedPages).length === 0, `${variant}/with-session: fixture — the page is torn down`);
        heal();
        const realErr = console.error, realWarn = console.warn;
        console.error = () => {}; console.warn = () => {};
        try {
          await appMod.runAuthHoldCheck({ manual: false });
          for (let i = 0; i < 40; i++) await new Promise(res => setTimeout(res, 0));
        } finally { console.error = realErr; console.warn = realWarn; }
        assert(appMod.currentAuthHoldReason() === '', `${variant}/with-session: the hold cleared`);
        const ov = r.reg.get('site-gate-overlay');
        assert(!ov, `${variant}/with-session: NO gate is up — this device has a valid session, so a gate would be a lock on the wrong person`);
        assert(appMod.isContentWithheld() === false, `${variant}/with-session: …and the predicate agrees content may be painted`);
        assert(painted(r.paintedPages).length > 0,
          `${variant}/with-session: and the page CAME BACK (${JSON.stringify(painted(r.paintedPages))}) — which is what makes every "still empty" assertion above non-vacuous: the same repaint paths work the moment an identity exists`);
        assert(r.chrome.main.getAttribute('inert') === null && r.chrome.main.getAttribute('aria-hidden') === null,
          `${variant}/with-session: …and the inert/aria-hidden pair is RESTORED, so the page is operable again`);
        appMod._resetAuthHoldForTest();
      }
    }

    // ── REVIEWER F4 — THE RESUMED DEVICE GETS boot()'s WHOLE TAIL ──────────
    // resumeAfterHoldCleared() used to run `initChatUI(); updateChatBadges();`
    // and stop, so a recovered device had no push adapter, no chat-notification
    // wiring, no bell, no OneSignal login, no wager cache and no ?ntab handling
    // for the rest of its session. Asserted through the same observable effect
    // boot's own wiring has: the push adapter being registered.
    {
      notifyMod._clearPushAdapterForTest();
      assert(notifyMod.hasPushAdapter() === false, 'fixture: no push adapter is registered before the resume');
      const { r, heal } = await holdThenRecover({ variant: 'config-unreadable', validSession: true, after: SUPA_CFG });
      assert(notifyMod.hasPushAdapter() === false,
        'fixture: …and the boot that ended in a hold never reached the tail, so it registered none either (the hold is a real hold)');
      heal();
      const realErr = console.error, realWarn = console.warn;
      console.error = () => {}; console.warn = () => {};
      try {
        await appMod.runAuthHoldCheck({ manual: false });
        for (let i = 0; i < 40; i++) await new Promise(res => setTimeout(res, 0));
      } finally { console.error = realErr; console.warn = realWarn; }
      assert(notifyMod.hasPushAdapter() === true,
        'F4 — a cleared hold runs the SAME post-hydrate tail boot() runs: the push adapter is registered, which is the observable proof that the notifications block ran at all');
      // REVIEWER F6 (sixth gate) — a line reading
      //   assert(r.has('notif-bell-btn') === r.has('notif-bell-btn'), …)
      // stood here. `x === x` is true for every x; it asserted nothing, cost a
      // pass in the count, and its label claimed a guarantee ("boot-inert when
      // the element is absent") that no code path was being checked for.
      // Deleted rather than repaired: the claim it gestured at — the tail ran —
      // is the assertion immediately above it, made through a real observable.
      appMod._resetAuthHoldForTest();
    }

    // ── REVIEWER F1 + F2 + SECURITY F-2 (SIXTH gate) — THE NEXT STEP ───────
    // R2(i) above stops at "the hold cleared into the Google gate and NOTHING
    // was repainted", which is correct and was the whole of what the fifth gate
    // asked for. The sixth gate's question is what happens on the step AFTER
    // that — the player taps Continue with Google and comes back signed in —
    // and the answer was: the page is painted and DEAD.
    //
    //   • `_setAppContentInert(false)` had three call sites and the sign-in path
    //     was not one of them, so .main-content and .bottom-nav stayed `inert` +
    //     aria-hidden: every tap swallowed, the nav unreachable by keyboard and
    //     invisible to VoiceOver, on a page that looked completely normal.
    //   • resumeAfterHoldCleared() had already refused (correctly) while no
    //     identity existed, and NOTHING re-triggered it when one arrived.
    //   • boot() had returned at the hold, so hydrate / ensureSeedData /
    //     runPostHydrateTail() never ran — and never would.
    //   • _parkTimersForHold() had cleared the score interval and the
    //     chat-enabled watch, and nothing re-armed them.
    //   • `_sessionForcedOut` had no production release at all, so even once the
    //     page came back it came back as NOBODY (reviewer F2) — which is why the
    //     last assertion here is about WHO, not just about whether.
    {
      const realSI = globalThis.setInterval, realCI = globalThis.clearInterval;
      const live = new Set();
      globalThis.setInterval = (fn, ms) => { const id = { ms }; live.add(id); return id; };
      globalThis.clearInterval = id => { live.delete(id); };
      notifyMod._clearPushAdapterForTest();
      const realErr = console.error, realWarn = console.warn, realInfo = console.info;
      try {
        const { r, heal } = await holdThenRecover({ variant: 'config-unreadable', validSession: false, after: SUPA_CFG });
        // The HYDRATE specifically — `getAll`, not "any POST to the backend
        // url". Chat's transport starts above the gate decision by design
        // (BUG-G), so a held boot legitimately has backend traffic of its own,
        // and counting URLs made "the hydrate ran" pass on chat polling. Caught
        // by the mutation that removed _bootStoppedAtHold and stayed green here.
        const hydrates = () => r.backendActions.filter(a => a === 'getAll').length;
        assert(appMod.currentAuthHoldReason() === 'config-unreadable', 'fixture: the boot ended in a hold');
        assert(r.chrome.main.getAttribute('inert') === '' && r.chrome.nav.getAttribute('inert') === '',
          'fixture: …with the page inert');
        assert(live.size === 0, `fixture: …and its timers parked (${live.size} interval(s) live)`);
        assert(hydrates() === 0 && notifyMod.hasPushAdapter() === false,
          'fixture: …and boot() returned before its hydrate and before its tail');

        heal();
        console.error = () => {}; console.warn = () => {}; console.info = () => {};
        await appMod.runAuthHoldCheck({ manual: false });
        for (let i = 0; i < 30; i++) await new Promise(res => setTimeout(res, 0));

        // STEP 1 — the hold cleared, but no identity exists yet. Everything
        // stays withheld. (Re-asserted here rather than assumed from R2(i), so
        // the step that follows is measured against a known starting state.)
        const ov1 = r.reg.get('site-gate-overlay');
        assert(!!ov1 && /Continue with Google/.test(ov1.innerHTML || ''),
          'step 1: the Google sign-in gate is what is on screen');
        assert(appMod.isContentWithheld() === true && r.chrome.main.getAttribute('inert') === '',
          'step 1: …content is still withheld and the page is still inert — the lock changed shape, it did not lift');
        assert(hydrates() === 0 && notifyMod.hasPushAdapter() === false && live.size === 0,
          'step 1: …and nothing has hydrated, no tail has run, no timer has been re-armed');

        // STEP 2 — THE PLAYER SIGNS IN. A valid session lands on the device and
        // the SDK reports it, through the REAL listener chain auth.js wires.
        r.store.set('cfbp_supabase_session', VALID_SUPA_SESSION());
        authMod._fireAuthEventForTest('SIGNED_IN', { access_token: 'tok', user: { id: 'u-stranger', email: 'stranger@example.com' } });
        for (let i = 0; i < 40; i++) await new Promise(res => setTimeout(res, 0));
        const hydratesAfter = hydrates();

        assert(appMod.isContentWithheld() === false, 'step 2: an identity is proven, so nothing is withheld any more');
        assert(r.chrome.main.getAttribute('inert') === null && r.chrome.main.getAttribute('aria-hidden') === null
               && r.chrome.nav.getAttribute('inert') === null && r.chrome.nav.getAttribute('aria-hidden') === null,
          'F1/F-2 — NO inert, NO aria-hidden: the page the player signed back into is operable by touch, keyboard and screen reader. This is the assertion that was red — un-withholding is a TRANSITION now, not an obligation on a list of call sites.');
        assert(live.size >= 1,
          `F1 — …and at least one interval is armed again (${live.size}): the score/auto-transition tick and the chat-enabled watch were parked by the hold and nothing used to re-arm them`);
        assert(hydratesAfter === 1,
          `F1 — …and the hydrate boot() skipped at its gate has now run, EXACTLY once (${hydratesAfter} getAll call(s)) — a recovered device was otherwise serving its local mirror forever`);
        assert(notifyMod.hasPushAdapter() === true,
          'F1 — …and boot()\'s one post-hydrate tail ran, so the push adapter, the chat-notification wiring, the bell and the OneSignal login all exist');
        assert(painted(r.paintedPages).length > 0,
          `F1 — …and the page content is actually back (${JSON.stringify(painted(r.paintedPages))})`);
        assert(!r.reg.get('site-gate-overlay'), '…with the sign-in gate taken down, because the player really is signed in');

        // REVIEWER F2 — WHO did the page come back as? Before the sixth gate
        // `_sessionForcedOut` (set by the config-unreadable hold) had no
        // production release, so _recomputeSynthesizedSession() short-circuited
        // forever and this device painted its league as nobody.
        const sess = storageMod.getSession();
        assert(sess.playerVerified === true,
          `R2(ii) — the recovered page is a VERIFIED session (${JSON.stringify(sess)}), not an anonymous one wearing the league's data`);
        assert(sess.playerId === 'm-stranger',
          `…and it is the right person: the member id the memberships read actually resolved (${JSON.stringify(sess.playerId)})`);
        assert(authMod.isSessionForcedOut() === false,
          '…because the forced-sign-out latch was RELEASED by applyAuthModeDecision() once it was past every hold branch');

        // R1 — DRIVE IT FORWARD AND RE-ASSERT. A second identity event must not
        // re-hydrate or re-run the tail: the transition is once per page.
        authMod._fireAuthEventForTest('TOKEN_REFRESHED', { access_token: 'tok2', user: { id: 'u-stranger', email: 'stranger@example.com' } });
        for (let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0));
        assert(hydrates() === hydratesAfter,
          `R1 — a second session event does NOT hydrate again (${hydrates()} vs ${hydratesAfter}): the transition is latched, so the ordinary hourly token refresh costs nothing`);
        assert(r.chrome.main.getAttribute('inert') === null && appMod.isContentWithheld() === false,
          'R1 — …and the page is still operable after it');
      } finally {
        console.error = realErr; console.warn = realWarn; console.info = realInfo;
        globalThis.setInterval = realSI; globalThis.clearInterval = realCI;
        appMod._resetAuthHoldForTest();
      }
    }

    // ── REVIEWER F1 (SEVENTH gate) — A THROW INSIDE THE TRANSITION MAY NOT
    //    LATCH THE PAGE SHUT ──────────────────────────────────────────────────
    // THE DEFECT. `releaseWithholdIfResolved()` sets `_withholdReleased = true`
    // ABOVE the work it guards (correctly — it is the re-entrancy guard, and two
    // concurrent session events must not both hydrate), but the repaint under it
    // was UNWRAPPED and `await runPostHydrateTail()` had no catch at all. So one
    // throw anywhere in there left the latch set with no production path that
    // ever resets it: section (1) had already lifted `inert` and re-armed the
    // timers, so the page was painted and operable — and permanently
    // un-hydrated and un-tailed. That is the sixth gate's BLOCK-1 end state,
    // reached one statement later. Both call sites were `void`/bare, so it was
    // also an unhandled promise rejection with no context attached.
    //
    // THE FAULT INJECTION is the real DOM, not a hook: `#tz-toggle` is
    // registered with an innerHTML setter that throws ONCE. renderTzToggle() is
    // the second statement of the transition's expensive half and is called from
    // nowhere else on this path (resyncPlayerPreferences() calls it later, by
    // which time the one-shot is spent), so the throw lands exactly where the
    // finding says and the rest of the page behaves normally.
    {
      const realSI = globalThis.setInterval, realCI = globalThis.clearInterval;
      const live = new Set();
      globalThis.setInterval = (fn, ms) => { const id = { ms }; live.add(id); return id; };
      globalThis.clearInterval = id => { live.delete(id); };
      notifyMod._clearPushAdapterForTest();
      const realErr = console.error, realWarn = console.warn, realInfo = console.info;
      let unhandled = null;
      const onUnhandled = e => { unhandled = e; };
      process.on('unhandledRejection', onUnhandled);
      try {
        const { r, heal } = await holdThenRecover({ variant: 'config-unreadable', validSession: false, after: SUPA_CFG });
        const hydrates = () => r.backendActions.filter(a => a === 'getAll').length;
        assert(appMod.currentAuthHoldReason() === 'config-unreadable' && hydrates() === 0,
          'fixture: the boot ended in a hold, before its hydrate and before its tail');

        heal();
        console.error = () => {}; console.warn = () => {}; console.info = () => {};
        await appMod.runAuthHoldCheck({ manual: false });
        for (let i = 0; i < 30; i++) await new Promise(res => setTimeout(res, 0));

        // ARM THE ONE-SHOT FAULT, then sign in.
        let faultsFired = 0;
        r.reg.set('tz-toggle', {
          id: 'tz-toggle',
          get innerHTML() { return ''; },
          set innerHTML(_v) { if (faultsFired++ === 0) throw new TypeError('R1 fault injection — the repaint threw'); },
          querySelectorAll: () => [],
          classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
          setAttribute() {}, getAttribute: () => null, addEventListener() {},
        });
        r.store.set('cfbp_supabase_session', VALID_SUPA_SESSION());
        authMod._fireAuthEventForTest('SIGNED_IN', { access_token: 'tok', user: { id: 'u-stranger', email: 'stranger@example.com' } });
        for (let i = 0; i < 40; i++) await new Promise(res => setTimeout(res, 0));

        assert(faultsFired >= 1,
          `fixture: the injected fault really did fire inside the transition (${faultsFired} write(s) to #tz-toggle)`);
        assert(hydrates() === 0 && notifyMod.hasPushAdapter() === false,
          `F1 — the throw stopped the expensive half, as it must (${hydrates()} hydrate(s), adapter ${notifyMod.hasPushAdapter()}): nothing half-ran`);
        assert(unhandled === null,
          `F1 — and it is NOT an unhandled rejection (${unhandled ? String(unhandled) : 'none'}): the transition catches its own failure and both fire-and-forget call sites have a .catch()`);
        assert(r.chrome.main.getAttribute('inert') === null,
          'F1 — the DOM half still ran, which is exactly why the latch mattered: the page is painted and operable, so nothing on screen would tell a player the hydrate never happened');

        // THE ASSERTION THAT WAS RED. A later session event — a sign-in retry,
        // or the ordinary hourly token refresh — must complete the work.
        authMod._fireAuthEventForTest('TOKEN_REFRESHED', { access_token: 'tok2', user: { id: 'u-stranger', email: 'stranger@example.com' } });
        for (let i = 0; i < 40; i++) await new Promise(res => setTimeout(res, 0));
        assert(hydrates() === 1,
          `F1 — a LATER session event completes the hydrate, exactly once (${hydrates()} getAll call(s)). Before this fix \`_withholdReleased\` was still true, so this event returned early and the device served its stale local mirror for the rest of the session.`);
        assert(notifyMod.hasPushAdapter() === true,
          '…and boot()\'s one post-hydrate tail ran with it (push adapter, chat wiring, bell, OneSignal login, wager cache)');
        assert(live.size >= 1,
          `…and the parked timers are armed (${live.size}) — they were re-armed by the FIRST, failing pass, because section (1) is deliberately outside the latch`);
        assert(storageMod.getSession().playerVerified === true && storageMod.getSession().playerId === 'm-stranger',
          `…as the right person (${JSON.stringify(storageMod.getSession())})`);

        // …and it is still ONCE PER PAGE: a third event does nothing.
        const after = hydrates();
        authMod._fireAuthEventForTest('TOKEN_REFRESHED', { access_token: 'tok3', user: { id: 'u-stranger', email: 'stranger@example.com' } });
        for (let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0));
        assert(hydrates() === after,
          `F1 — and the latch is re-set by the SUCCESSFUL pass, so a third event hydrates nothing (${hydrates()} vs ${after}): the reset is on failure only, not a removal of the guard`);
      } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        console.error = realErr; console.warn = realWarn; console.info = realInfo;
        globalThis.setInterval = realSI; globalThis.clearInterval = realCI;
        appMod._resetAuthHoldForTest();
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════

  console.log('\n[14] STEP 3b / DI-183a-ii \u2014 the pre-link banner\'s tap routes to the HOLD GATE\u2026');
  {
    // DI-180l's A3 precedent asks for this claim twice: authtest proves the
    // routing against ensureSupabaseSdkLoaded()'s real DEADLINE in isolation,
    // and this proves it inside boottest's own harness \u2014 a real injected
    // <script> that really fails, the real hold-gate render, the real DOM.
    //
    // WHY THE BANNER IS THE CALLER THAT MATTERS. boot() deliberately does NOT
    // load the Supabase SDK before cutover (reviewer-B2: zero extra bytes for a
    // mode that is not using it), so the SDK's FIRST load attempt happens inside
    // this tap handler. If it fails, the player is holding a button that can
    // only ever fail \u2014 exactly what A4 forbids \u2014 and the honest answer is the
    // sdk-unavailable hold gate itself, never a second error surface living on
    // the banner beside the hold-gate family.
    //
    // `withSdk: false` makes the harness dispatch a real 'error' on the injected
    // tag, which is how a phone on a captive-portal wifi actually fails.
    appMod._resetAuthHoldForTest();
    appMod._resetSupabaseSdkLoaderForTest();
    const realErr14 = console.error, realWarn14 = console.warn;
    console.error = () => {}; console.warn = () => {};
    let r14 = null;
    try {
      r14 = await runBoot({
        config: okConfig({ authMode: 'supabase', supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' }),
        withSdk: false,
        paintPages: true,
        seed: { cfbp_site_unlocked: '1', cfbp_backend_config: BACKEND_CFG },
      });
      appMod._resetAuthHoldForTest();
      appMod._resetSupabaseSdkLoaderForTest();

      const html14 = appMod.prelinkBannerHTML();
      // The banner only renders pre-cutover. In this harness the boot resolved
      // 'supabase', so the STRING is empty \u2014 which is itself DI-180f's flag
      // contract and worth asserting rather than working around.
      assert(html14 === '',
        `[14] the pre-link banner renders NOTHING once authMode has resolved past the shadow period (got ${JSON.stringify(html14.slice(0, 60))}) \u2014 DI-183e's "entire DI inert" row, and the reason a founder never sees it twice`);

      // Now the mode it IS for. Same handler, same routing, real SDK failure.
      authMod.configureAuth({ authMode: 'prelink', supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
      const banner = appMod.prelinkBannerHTML();
      assert(/prelink-banner-btn/.test(banner) && /Link My Account Now/.test(banner),
        `[14] fixture: \u2026and it DOES render in the pre-cutover mode it exists for (got ${JSON.stringify(banner.slice(0, 80))})`);

      const host14 = document.getElementById('page-dashboard');
      assert(!!host14, '[14] fixture: the harness has a #page-dashboard to mount it in');
      host14.innerHTML = banner;
      // boottest's BEl does not parse ids out of an assigned innerHTML (unlike
      // authtest's FakeEl), so the button is stood up explicitly and handed to
      // the binder through the host's own querySelector \u2014 which is the exact
      // lookup bindPrelinkBanner() performs. The element is a stand-in; the
      // HANDLER, the SDK load, the hold-gate render and the DOM it paints into
      // are all real.
      const btn14 = {
        disabled: false, textContent: '', _listeners: {},
        addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
        dispatch(t, e = {}) { (this._listeners[t] || []).forEach(fn => fn(e)); },
      };
      const realQS14 = host14.querySelector?.bind(host14);
      host14.querySelector = (sel) => (sel === '#prelink-banner-btn' ? btn14 : (realQS14 ? realQS14(sel) : null));
      appMod.bindPrelinkBanner(host14);
      assert((btn14._listeners.click || []).length === 1,
        `[14] fixture: exactly one click listener is bound, so the tap below is the handler under test (got ${(btn14._listeners.click || []).length})`);

      btn14.dispatch('click', {});
      await advance(200);
      await settle(40);

      assert(appMod.currentAuthHoldReason() === 'sdk-unavailable',
        `[14] an SDK that fails to load routes the TAP to the sdk-unavailable HOLD GATE (got ${JSON.stringify(appMod.currentAuthHoldReason())}) \u2014 DI-180l/A4: no button that will only fail when tapped, and ONE hold-gate family rather than a bespoke banner-local error`);
      const ov14 = r14.reg.get('site-gate-overlay');
      assert(!!ov14 && /data-hold-reason="sdk-unavailable"/.test(ov14.innerHTML || ''),
        '[14] \u2026and it is the REAL hold gate on screen, the same overlay every other hold variant paints \u2014 asserted on the rendered markup, not on a variable');
      assert(!/couldn't|try again|failed/i.test(host14.innerHTML),
        '[14] \u2026and the banner grew NO error message of its own');
    } finally {
      console.error = realErr14; console.warn = realWarn14;
      appMod._resetAuthHoldForTest();
      appMod._resetSupabaseSdkLoaderForTest();
    }

  // ══════════════════════════════════════════════════════════════════════════════════
  console.log('\n[15] STEP 3b / DI-182a — the prefs rows are LIVE IN PINS MODE, deliberately…');
  {
    // ══ REVIEWER F6 / SECURITY F-2 (audit #10) — "DORMANT" IS OVERSTATED, AND
    //    THIS IS THE ONE PLACE IT IS NOT TRUE ═══════════════════════════════════
    //
    // Every other piece of Step 3b is behind `getAuthMode() === 'supabase'`: the
    // League Members card, the link-status card, the permission-denied card, the
    // link screens, the pre-link banner. On a deploy with the flag off, none of
    // them renders and the 3a+3b build really is inert.
    //
    // chat-ui.js's TWO PREFS ROWS ARE NOT. `prefsPanelHTML()` has no authMode
    // guard at all, so Initials and Alma mater go live for all six players the
    // moment this ships — in PIN mode, writing through the ordinary storage seam,
    // with no Supabase anything involved.
    //
    // THE RULING (coordinator, 2026-09-18): DO NOT GATE THEM. DI-182a was
    // approved as a player self-service surface, not as a Supabase feature; the
    // seam it writes through is the same one the commissioner's Edit Player modal
    // has always used; and `player.initials` has existed on the data model with
    // NO editable UI anywhere, for anyone, until now. Gating it would be
    // withholding an approved improvement for the sake of a tidy sentence in a
    // deploy note.
    //
    // SO THIS ASSERTION IS NOT A GUARD — IT IS A RECORD. It exists so the next
    // person reading "3b is dormant" in a commit message finds, in a test, the
    // one part that is not, and knows it was decided rather than missed. If it
    // ever goes red, the rows have been gated and the deploy note needs changing
    // with it.
    const chatUiMod = await import('./js/chat-ui.js');
    const storageMod15 = await import('./js/storage.js');
    const authMod15 = await import('./js/auth.js');

    authMod15.configureAuth({ authMode: 'pins', supabaseUrl: '', supabaseAnonKey: '' });
    assert(authMod15.getAuthMode() === 'pins',
      '[15] fixture: the device is in PIN mode — the mode a 3a+3b deploy lands in with the flag off');
    storageMod15.savePlayer({ playerId: 'p_live15', displayName: 'Drew', active: true, initials: 'DH', almaMater: 'Purdue' });
    storageMod15.setSession('p_live15', false, true);
    const panel15 = chatUiMod._prefsPanelHTMLForTest();
    storageMod15.setSession(null, false, false);

    assert(/<label>Initials<\/label>/.test(panel15),
      `[15] REV F6 — the Initials row RENDERS in 'pins' mode (got ${JSON.stringify((panel15.match(/<label>[^<]*<\/label>/g) || []).slice(0, 8))}). NOT DORMANT, and deliberately so — DI-182a as approved.`);
    assert(/<label>Alma mater<\/label>/.test(panel15),
      '[15] — and so does the Alma mater row');
    assert(/value="DH"/.test(panel15) && /Purdue/.test(panel15),
      '[15] — both prefilled from the player record, through the ordinary storage seam, with no Supabase anything involved');
    assert(!/pin|PIN/.test(panel15),
      '[15] — and still no PIN control in the panel, in the mode that actually HAS PINs (the rows are identity fields, not auth ones)');
    // The negative that makes the ruling checkable: there is no authMode branch
    // anywhere near these rows. If someone adds one, this goes red and the
    // deploy note has to change with it.
    const chatUiSrc15 = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
    assert(!/getAuthMode\(\)/.test(chatUiSrc15),
      '[15] — js/chat-ui.js consults getAuthMode() NOWHERE, which is why the rows are live in every mode. Stated as a property of the file so the deploy note and the code cannot drift.');
  }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[27] RG-194 — a returning SIGNED-IN player is never shown the sign-in screen on a cold open…');
  // ═════════════════════════════════════════════════════════════════════════
  //
  // DREW, 2026-09-21, iPhone home-screen PWA, signed in with Google, Supabase
  // mode: "When I open the closed app it flashes the IRB pickems login screen,
  // then the neutral page while loading then quickly flashes back to my saved
  // color scheme, this is a very jarring sequence as it happens so fast."
  //
  // THIS SECTION OWNS THE FIRST OF THOSE THREE PAINTS — the login screen. Two
  // independent mechanisms produce it, and BOTH are the same mistake: a gate
  // painted from a synchronous read that answers "signed out" when the honest
  // answer is "not resolved yet".
  //
  //   (1) boot()'s `if (!isSiteUnlocked()) showSitePinGate()` runs ABOVE the
  //       config read, in every mode. `cfbp_site_unlocked` is the PIN-era flag,
  //       and the adapter's first-boot wipe (supabase-backend.js
  //       _runFirstBootWipe) deliberately removes it and nothing in supabase
  //       mode ever sets it again — so on EVERY cold open of a cut-over device
  //       that line paints the PIN gate, and applyAuthModeDecision() removes it
  //       again the moment config.json lands. The whole flash is the width of
  //       that fetch.
  //
  //   (2) the gate decision itself asked hasValidSupabaseSession(), which is
  //       false whenever the ACCESS token has expired — about an hour after the
  //       last use, i.e. on essentially every cold open of a home-screen PWA —
  //       even though the refresh token beside it is good. So the Google gate
  //       went up, the SDK refreshed in the background, and refreshAuthUI()
  //       took it straight back down.
  //
  // THE RULE THIS SECTION PINS: a sign-in gate (PIN or Google) may be painted
  // only once the auth layer has POSITIVELY determined there is no session. The
  // fail-closed HOLD gates are untouched and are explicitly allowed here — a
  // hold is a lock, not a login screen, and SEC F1-R1's config-unreadable path
  // must keep working exactly as [13]/[20] pin it.
  //
  // Ordering, not end state: a gate that is appended and removed 300ms later
  // leaves no trace in `reg`, which is why runBoot() now logs every append with
  // the markup it carried (see `appendLog`).
  {
    const SUPA_CFG27 = { authMode: 'supabase', dataMode: 'supabase',
      supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' };
    const supaConfig27 = okConfig(SUPA_CFG27);
    const USER27 = { id: 'u-drew', email: 'drew@example.com' };
    const freshSession27 = () => JSON.stringify({ access_token: 'tok-fresh', refresh_token: 'r-drew',
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER27 });
    // The overnight PWA: the access token died hours ago, the refresh token did
    // not. This is the state Drew's phone is in every single morning.
    const staleSession27 = () => JSON.stringify({ access_token: 'tok-stale', refresh_token: 'r-drew',
      expires_at: Math.floor(Date.now() / 1000) - 7200, user: USER27 });
    // DREW'S DEVICE, exactly: cut over to Supabase, and with NO
    // `cfbp_site_unlocked` — the adapter's first-boot wipe took it and supabase
    // mode never writes it back.
    const DEVICE27 = { cfbp_auth_mode_last_known: 'supabase', cfbp_backend_config: BACKEND_CFG };

    const gateKind = (e) => {
      if (e.id !== 'site-gate-overlay') return null;
      if (/data-gate-state="hold"/.test(e.html)) return 'hold';
      if (/id="site-pin-input"/.test(e.html)) return 'pin';
      if (/Continue with Google/.test(e.html)) return 'google';
      return 'unknown';
    };
    const gateSeq = r => r.appendLog.map(gateKind).filter(Boolean);
    const signInGates = r => gateSeq(r).filter(k => k === 'pin' || k === 'google');
    const quiet = async (fn) => {
      const e = console.error, w = console.warn, i = console.info;
      console.error = () => {}; console.warn = () => {}; console.info = () => {};
      try { return await fn(); } finally { console.error = e; console.warn = w; console.info = i; }
    };
    const settle27 = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

    // ── (a) THE REPORT — a live access token, and still a login screen ───────
    {
      const r = await quiet(() => runBoot({
        config: supaConfig27,
        seed: { ...DEVICE27, cfbp_supabase_session: freshSession27() },
      }));
      assert(storageMod.isSiteUnlocked() === false,
        '[27] fixture: this device has NO site-unlock flag — the Supabase first-boot wipe removed it and nothing in this mode writes it back. Without this the whole section is about a device that does not exist');
      assert(signInGates(r).length === 0,
        `[27] RG-194 — a player whose session is live on this device is shown NO sign-in screen at any point in the boot (gates painted, in order: ${JSON.stringify(gateSeq(r))}). The PIN gate above the config read is paint 1 of Drew's three`);
      appMod._resetAuthHoldForTest();
    }

    // ── (b) THE MORNING OPEN — expired access token, good refresh token ──────
    {
      const r = await quiet(() => runBoot({
        config: supaConfig27,
        seed: { ...DEVICE27, cfbp_supabase_session: staleSession27() },
      }));
      assert(authMod.hasValidSupabaseSession() === false && authMod.hasPersistedSupabaseSession() === true,
        '[27] fixture: the device holds a session whose ACCESS token is expired and whose REFRESH token is good — "not resolved yet", which is neither of the two answers the old decision could give');
      assert(signInGates(r).length === 0,
        `[27] RG-194 — …and it is still not a login screen: the app holds its neutral boot state until the auth layer answers, instead of asserting a signed-out answer it does not have (gates: ${JSON.stringify(gateSeq(r))})`);
      // …and when the SDK's refresh lands, nothing new paints either.
      r.store.set('cfbp_supabase_session', freshSession27());
      await quiet(async () => {
        authMod._fireAuthEventForTest('INITIAL_SESSION', { access_token: 'tok-fresh', user: USER27 });
        await settle27(20);
      });
      assert(signInGates(r).length === 0,
        `[27] …and none appears when the refreshed session arrives either — the player goes straight from the neutral hold to their app (gates: ${JSON.stringify(gateSeq(r))})`);
      appMod._resetAuthHoldForTest();
    }

    // ── (c) NON-VACUITY — a device with no session DOES get the gate ─────────
    // The blind rule and DI-180h depend on this half: deferring the paint must
    // never become "no gate at all". And the gate it gets is the GOOGLE one —
    // the PIN gate is not this mode's front door and never was.
    {
      const r = await quiet(() => runBoot({ config: supaConfig27, seed: { ...DEVICE27 } }));
      assert(signInGates(r).includes('google'),
        `[27] a supabase device with NO persisted session is gated immediately — the deferral is scoped to "a token is on the device", not to "supabase mode" (gates: ${JSON.stringify(gateSeq(r))})`);
      assert(!signInGates(r).includes('pin'),
        `[27] …and it is the Google gate, only: a cut-over device never paints the PIN gate, not even for an instant (gates: ${JSON.stringify(gateSeq(r))})`);
      const ov = r.reg.get('site-gate-overlay');
      assert(!!ov && /Continue with Google/.test(ov.innerHTML || ''),
        '[27] …and that gate is still up when the boot settles');
      appMod._resetAuthHoldForTest();
    }

    // ── (d) THE REFRESH THAT FAILS — the gate arrives, just later ────────────
    // A revoked/expired refresh token is answered by the SDK with a null-session
    // event, and refreshAuthUI()'s existing signed-out branch paints the gate.
    // The deferral changes WHEN, never WHETHER.
    {
      const r = await quiet(() => runBoot({
        config: supaConfig27,
        seed: { ...DEVICE27, cfbp_supabase_session: staleSession27() },
      }));
      assert(signInGates(r).length === 0, '[27] fixture: nothing is gated while the answer is outstanding');
      await quiet(async () => {
        r.store.delete('cfbp_supabase_session');
        authMod._fireAuthEventForTest('INITIAL_SESSION', null);
        await settle27(20);
      });
      const ov = r.reg.get('site-gate-overlay');
      assert(!!ov && /Continue with Google/.test(ov.innerHTML || ''),
        `[27] a session that cannot be refreshed lands on the Google gate the moment the auth layer says so (gates: ${JSON.stringify(gateSeq(r))}) — the deferral moves the paint, it never removes it`);
      appMod._resetAuthHoldForTest();
    }

    // ── (e) FAIL-CLOSED — the auth layer that never answers ──────────────────
    // Offline, SDK blocked, a client that never fires: the page may not sit
    // ungated forever on an unresolved identity. The deadline is armed by the
    // deferral and is driven here through the REAL handler.
    {
      const r = await quiet(() => runBoot({
        config: supaConfig27,
        seed: { ...DEVICE27, cfbp_supabase_session: staleSession27() },
      }));
      assert(signInGates(r).length === 0, '[27] fixture: the gate is deferred');
      assert(typeof appMod._fireSignInGateDeadlineForTest === 'function',
        '[27] fixture: app.js exports the deadline handler, so this drives the REAL fail-closed path rather than a lookalike');
      await quiet(async () => { appMod._fireSignInGateDeadlineForTest?.(); await settle27(10); });
      const ov = r.reg.get('site-gate-overlay');
      assert(!!ov && /Continue with Google/.test(ov.innerHTML || ''),
        '[27] …and if nothing ever answers, the deadline gates the page anyway — an unresolved identity fails CLOSED');
      const appSrc27 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
      assert(/const SIGN_IN_GATE_DEADLINE_MS = \d+;/.test(appSrc27),
        '[27] …and that deadline is a bounded constant, not an open-ended wait [structural]');
      appMod._resetAuthHoldForTest();
    }

    // ── (f) THE PINS WORLD IS BYTE-IDENTICAL, INCLUDING THE PAINT ORDER ──────
    // AD-08/reviewer B2: a device that is not on supabase still paints its gate
    // BEFORE the config.json round trip. The fix may not buy paint 1 back by
    // making every other device wait on the network.
    {
      const r = await quiet(() => runBoot({ config: okConfig({}), seed: { cfbp_backend_config: BACKEND_CFG } }));
      const pinAt = r.appendLog.findIndex(e => gateKind(e) === 'pin');
      const cfgAt = r.appendLog.findIndex(e => e.id === '#config-fetch');
      assert(pinAt > -1 && cfgAt > -1 && pinAt < cfgAt,
        `[27] a device that is NOT on supabase still paints the PIN gate before the config read (pin at ${pinAt}, config fetch at ${cfgAt}) — AD-08's paint-first boot is untouched`);
      appMod._resetAuthHoldForTest();
    }

    // ── (g) ROLLBACK — the PIN gate the deferral owes back ───────────────────
    // A device whose last known mode was supabase, booting a build that has
    // rolled back to pins. Deferring the PIN gate must not mean forgetting it:
    // config.json is the authority, and it says this device is locked.
    {
      const r = await quiet(() => runBoot({
        config: okConfig({}),
        seed: { cfbp_auth_mode_last_known: 'supabase', cfbp_backend_config: BACKEND_CFG },
      }));
      assert(authMod.getAuthMode() === 'pins', '[27] fixture: config.json rolled this device back to pins');
      const ov = r.reg.get('site-gate-overlay');
      assert(!!ov && /id="site-pin-input"/.test(ov.innerHTML || ''),
        `[27] …and the PIN gate IS up when the decision lands (gates: ${JSON.stringify(gateSeq(r))}) — a locked device is still locked, just gated by the answer instead of by the guess`);
      appMod._resetAuthHoldForTest();
    }

    // ── (h) SEC F1-R1 IS UNTOUCHED — config unreadable still HOLDS ───────────
    {
      const r = await quiet(() => runBoot({
        config: () => { throw new TypeError('Failed to fetch'); },
        paintPages: true,
        seed: { ...DEVICE27, cfbp_supabase_session: freshSession27() },
      }));
      assert(appMod.currentAuthHoldReason() === 'config-unreadable',
        '[27] SEC F1-R1: a config read that fails on a cut-over device still HOLDS signed out');
      const ov = r.reg.get('site-gate-overlay');
      assert(!!ov && /data-hold-reason="config-unreadable"/.test(ov.innerHTML || ''),
        '[27] …behind the hold gate, exactly as [13] and [20] pin it');
      assert(signInGates(r).length === 0,
        `[27] …and NO sign-in gate flashed under it on the way there (gates: ${JSON.stringify(gateSeq(r))}) — a hold is a lock, a login screen is a lie about who this device is`);
      appMod._resetAuthHoldForTest();
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n[28] SECURITY A-1 — a cached chat room is NOT readable before this device knows who it is…');
    // ═══════════════════════════════════════════════════════════════════════
    //
    // THE FINDING (security gate, HIGH, on [27]'s own branch). [27] stopped the
    // app painting a login screen at a signed-in player. What it did not notice
    // is WHAT THE GATE HAD BEEN COVERING. boot() starts chat BEFORE the config
    // read — `initChatUI({phase:'early'})`, BUG-G, deliberately — and that
    // replays `cfbp_chat_events_cache`. `#page-dashboard` is statically
    // `.active` in index.html, so js/chat-ui.js's handleChatEvent('events')
    // finds dashboardPageActive() true and inserts #dash-chat-teaser:
    // `<strong>author</strong>: body.slice(0,64)`.
    //
    // And it renders for a viewer with NO IDENTITY, because
    // `isUnreadFor(m, null, …)` (js/chat.js) compares `m.author !== selfId`
    // against null — every message is unread to nobody. On main the PIN overlay
    // happened to cover that window; [27] removed the overlay, which is correct,
    // and thereby uncovered a league member's name and 64 characters of what
    // they wrote, to anyone holding the handset, with no credential, for the
    // width of the config fetch (or up to the sign-in gate's 6s deadline).
    // DI-180h: no league-scoped data before sign-in.
    //
    // TWO HALVES, MUTATION-PROVEN INDEPENDENTLY:
    //   (i)  the app content is INERT from before revealApp() until this device
    //        positively knows who it is;
    //   (ii) the chat surfaces themselves refuse to speak to an unresolved
    //        viewer — the fix at the source, which also ends the "84 then 0"
    //        badge flash (an unknown cursor must read as "unknown, say nothing",
    //        never as "zero seen, so everything is unread").
    {
      const chatUi28 = await import('./js/chat-ui.js');
      const chatMod28 = await import('./js/chat.js');
      // One notifying message from a real-looking member — the exact shape the
      // device cache holds after a normal session.
      const CACHE28 = () => JSON.stringify({ epoch: 0, head: 7, events: [{
        id: 'm7', seq: 7, ts: Date.now() - 60000, type: 'message', author: 'm-kihoon',
        body: 'taking the Aggies -7 and the over, easy money', notify: true,
      }] });
      const VALID28 = () => JSON.stringify({ access_token: 'tok', refresh_token: 'r',
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-drew', email: 'd@x.test' } });
      const EXPIRED28 = () => JSON.stringify({ access_token: 'tok', refresh_token: 'r',
        expires_at: Math.floor(Date.now() / 1000) - 7200, user: { id: 'u-drew', email: 'd@x.test' } });
      const SUPA28 = { authMode: 'supabase', dataMode: 'supabase',
        supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' };
      // `navigator` was installed with defineProperty above and is read-only on
      // this object, so a scenario swaps it the same way rather than assigning.
      const setNavigator28 = (value) => {
        try { globalThis.navigator = value; }
        catch { Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true }); }
        return globalThis.navigator;
      };
      const quiet28 = async (fn) => {
        const e = console.error, w = console.warn, i = console.info, l = console.log;
        console.error = () => {}; console.warn = () => {}; console.info = () => {}; console.log = () => {};
        try { return await fn(); } finally { console.error = e; console.warn = w; console.info = i; console.log = l; }
      };

      // ── (A) THREE UNRESOLVED STATES, ONE ANSWER: NOTHING ────────────────
      //
      // HOW THE ROOM IS DELIVERED, and why it is not the cache read. chat.js
      // primes `cfbp_chat_events_cache` ONCE PER PAGE, and this suite is one
      // process — earlier sections already consumed that latch, so a seeded
      // cache here would deliver nothing and every assertion below would pass
      // for the wrong reason (it did, on the first run of this section; the
      // fixture check caught it). The cache IS seeded, because that is the state
      // the device is in, and the replay is then driven through `ingest()` —
      // the very call readAndPrimeEventsCache() makes with the parsed events
      // (js/chat.js, `ingest(parsed.events, parsed.head, {fromCache: true})`),
      // into that boot's own DOM. Same function, same notification, same
      // handleChatEvent('events') path that inserts the teaser.
      const EV28 = () => ({ id: 'm7', seq: 7, ts: Date.now() - 60000, type: 'message',
        author: 'm-kihoon', body: 'taking the Aggies -7 and the over, easy money', notify: true });
      const STATES28 = [
        ['no session at all',           null],
        ['a GARBAGE persisted session', '{not json'],
        ['an EXPIRED session',          EXPIRED28()],
      ];
      for (const [label, session] of STATES28) {
        const badgeCalls = [];
        const realNav = globalThis.navigator;
        setNavigator28({ setAppBadge: n => { badgeCalls.push(`set:${n}`); return Promise.resolve(); },
                         clearAppBadge: () => { badgeCalls.push('clear'); return Promise.resolve(); } });
        let r = null;
        try {
          r = await quiet28(() => runBoot({
            config: okConfig(SUPA28),
            paintPages: true,
            seed: {
              cfbp_auth_mode_last_known: 'supabase',
              cfbp_backend_config: BACKEND_CFG,
              cfbp_chat_events_cache: CACHE28(),
              ...(session ? { cfbp_supabase_session: session } : {}),
            },
          }));
          // ── (i) THE COVER, read BEFORE anything else touches the page ────
          assert(r.chrome.main.getAttribute('inert') === '' && r.chrome.main.getAttribute('aria-hidden') === 'true',
            `[28] ${label}: A-1(i) — .main-content is inert + aria-hidden while the answer is outstanding, from before revealApp()`);
          assert(r.chrome.nav.getAttribute('inert') === '',
            `[28] ${label}: …and so is .bottom-nav`);

          // THE ROOM ARRIVES, for real.
          globalThis.document.title = "IRB Pick 'Ems";
          badgeCalls.length = 0;
          await quiet28(async () => { chatMod28.ingest([EV28()]); });
          assert(chatMod28.getMessages({ tag: 'all' }).some(m => m.id === 'm7'),
            `[28] ${label}: fixture — the cached message really IS in the chat engine after the delivery (without this every assertion below is vacuous)`);
          assert(chatMod28.isChatEnabled() === true,
            `[28] ${label}: fixture — chat is ENABLED, so nothing below is silent merely because the room is switched off`);
          assert(storageMod.getSession()?.playerId == null,
            `[28] ${label}: fixture — and this device still has NO resolved identity (${JSON.stringify(storageMod.getSession())})`);
        } finally { setNavigator28(realNav); }

        const dash = r.reg.get('page-dashboard');
        assert(!!dash && dash.classList.contains('active'),
          `[28] ${label}: fixture — #page-dashboard exists and is ACTIVE, exactly as index.html ships it (the teaser inserts into it, and js/chat-ui.js's dashboardPageActive() asks for exactly this selector)`);
        const dashHTML = String(dash?.innerHTML || '');
        assert(!/dash-chat-teaser/.test(dashHTML),
          `[28] ${label}: NO chat teaser is in the DOM — no member's name, no message text, before this device knows who it is (got ${JSON.stringify(dashHTML.slice(0, 160))})`);
        assert(!/Aggies -7/.test(dashHTML) && !/m-kihoon/.test(dashHTML),
          `[28] ${label}: …and none of the cached message's words reached the page by any other route`);
        assert(!/^\(\d/.test(String(globalThis.document.title || '')),
          `[28] ${label}: …and the tab title carries no unread count (got ${JSON.stringify(globalThis.document.title)})`);
        assert(badgeCalls.length === 0,
          `[28] ${label}: …and the PWA icon badge was neither SET nor CLEARED — an unresolved identity means "unknown, say nothing", not "zero seen, so everything is unread" (calls: ${JSON.stringify(badgeCalls)})`);
        appMod._resetAuthHoldForTest();
      }

      // ── (B) NON-VACUITY + NO LOCKOUT — the identity RESOLVES ─────────────
      // The fourth state A-2 names: a VALID session, on a boot that goes all the
      // way through (this harness's SDK resolves a membership during it). Same
      // page, same room, same three surfaces — and every one of them speaks.
      // That is what makes the three silences above a GUARD rather than a dead
      // function, and the released cover is what makes it a WAIT rather than the
      // "painted, and dead to touch" lockout reviewer F1 found at the sixth gate.
      {
        const badgeCalls = [];
        const realNav = globalThis.navigator;
        setNavigator28({ setAppBadge: n => { badgeCalls.push(`set:${n}`); return Promise.resolve(); },
                         clearAppBadge: () => { badgeCalls.push('clear'); return Promise.resolve(); } });
        let r = null;
        try {
          r = await quiet28(() => runBoot({
            config: okConfig(SUPA28),
            paintPages: true,
            seed: {
              cfbp_auth_mode_last_known: 'supabase',
              cfbp_backend_config: BACKEND_CFG,
              cfbp_chat_events_cache: CACHE28(),
              cfbp_supabase_session: VALID28(),
            },
          }));
          const resolved = storageMod.getSession();
          assert(!!resolved?.playerId && resolved?.playerVerified === true,
            `[28] B fixture: this boot ended with a RESOLVED identity (${JSON.stringify(resolved)}) — without that the three assertions below would be measuring the wrong device`);
          assert(r.chrome.main.getAttribute('inert') === null && r.chrome.main.getAttribute('aria-hidden') === null
                 && r.chrome.nav.getAttribute('inert') === null,
            '[28] B — the page is OPERABLE: the cover is a wait for the answer, never a lockout');
          globalThis.document.title = "IRB Pick 'Ems";
          badgeCalls.length = 0;
          await quiet28(async () => { chatMod28.ingest([EV28()]); });
          const dash = r.reg.get('page-dashboard');
          assert(/dash-chat-teaser/.test(String(dash?.innerHTML || '')) && /Aggies -7/.test(String(dash?.innerHTML || '')),
            `[28] B — and the SAME room renders in full for the resolved member: the guard is "who is asking", not "hide the teaser" (got ${JSON.stringify(String(dash?.innerHTML || '').slice(0, 120))})`);
          assert(/^\(\d/.test(String(globalThis.document.title || '')),
            `[28] B — …the tab title carries the count again (got ${JSON.stringify(globalThis.document.title)})`);
          assert(badgeCalls.some(c => c.startsWith('set:')),
            `[28] B — …and the PWA badge is SET again (calls: ${JSON.stringify(badgeCalls)})`);
        } finally {
          setNavigator28(realNav);
          globalThis.document.title = "IRB Pick 'Ems";
          appMod._resetAuthHoldForTest();
          // B is the only scenario in this file that drives the adapter all the
          // way to SERVING, on a fake client that answers every table with the
          // same membership row. Left in place, storage.js keeps routing to that
          // mirror — so the PINS boot below would read a "week" with no status
          // and throw inside refreshHeader(). Torn down here rather than in (C),
          // beside the scenario that created it.
          await quiet28(async () => {
            const sb28 = await import('./js/supabase-backend.js');
            sb28._resetForTest();
            appMod._resetSupabaseDataForTest();
            storageMod.setBackendMode('local');
            authMod._resetAuthForTest();
          });
        }
      }

      // ── (C) THE PINS WORLD NEVER GETS A COVER ───────────────────────────
      {
        const r = await quiet28(() => runBoot({
          config: okConfig({}), paintPages: true,
          seed: { cfbp_site_unlocked: '1', cfbp_backend_config: BACKEND_CFG, cfbp_chat_events_cache: CACHE28() },
        }));
        assert(r.chrome.main.getAttribute('inert') === null,
          '[28] C — a pins device is never made inert by any of this: the cover is scoped to the mode whose identity resolves asynchronously');
        appMod._resetAuthHoldForTest();
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n[29] RG-198 — the app paints YOUR colours on the first frame, not neutral then yours…');
    // ═══════════════════════════════════════════════════════════════════════
    //
    // DREW (paints 2 and 3 of the RG-194 report): "then the neutral page while
    // loading then quickly flashes back to my saved color scheme."
    //
    // WHY IT WAS ALWAYS NEUTRAL FIRST. The theme lives on the PLAYER record
    // (`player.preferences.theme`, CLAUDE.md bullet 4), and on a Supabase device
    // that record does not exist locally until the adapter is serving: the
    // Sheets mirror prime is deliberately skipped (§1.5 item 1), so boot()'s one
    // `applyTheme(getTheme())` reads an empty store and can only answer
    // 'neutral' — boottest [25] proves exactly that. The real palette arrives
    // with _repaintForSupabaseData(), i.e. after the config fetch, the SDK load,
    // the membership read and the snapshot prime. Two paints, every open.
    //
    // THE FIX IS A DEVICE-LOCAL HINT, not a second source of truth. The player
    // record stays authoritative; `cfbp_theme_hint` only remembers what this
    // HANDSET last painted, so the first frame can be right. Drew approved the
    // storage.js addition on 2026-09-21 ("Yes: the app paints your colours
    // immediately on open"): a KEYS entry, a DEVICE_LOCAL_KEYS entry, and the
    // accessor pair — nothing else.
    //
    // Under the `cfbp_` prefix ON PURPOSE: auth.js's F-1 handover/sign-out sweep
    // then clears it with no new list entry (the same argument
    // `cfbp_supabase_mirror` makes), so player B can never boot in player A's
    // colours. (D) proves that rather than assuming it.
    {
      const SUPA29 = { authMode: 'supabase', dataMode: 'supabase',
        supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' };
      const quiet29 = async (fn) => {
        const e = console.error, w = console.warn, i = console.info, l = console.log;
        console.error = () => {}; console.warn = () => {}; console.info = () => {}; console.log = () => {};
        try { return await fn(); } finally { console.error = e; console.warn = w; console.info = i; console.log = l; }
      };
      const bootWithHint = (hint) => quiet29(() => runBoot({
        config: okConfig(SUPA29),
        seed: {
          cfbp_auth_mode_last_known: 'supabase',
          cfbp_backend_config: BACKEND_CFG,
          ...(hint === undefined ? {} : { cfbp_theme_hint: JSON.stringify(hint) }),
        },
      }));

      // ── (A) THE FIRST FRAME IS THE PLAYER'S PALETTE ─────────────────────
      {
        const r = await bootWithHint('boilermaker');
        assert(r.themeOrder[0] === 'theme-boilermaker',
          `[29] the FIRST theme this boot applies is the device's last-painted palette, not the league default (order: ${JSON.stringify(r.themeOrder)})`);
        const cfgAt = r.appendLog.findIndex(e => e.id === '#config-fetch');
        assert(cfgAt > -1,
          '[29] fixture: this boot really did read config.json (so "before the network" below is a claim about something)');
        assert(r.themeOrder.length > 0 && !r.themeOrder.includes('theme-neutral'),
          `[29] …and 'neutral' is never painted on the way there: there is no first, wrong palette to flash away from (order: ${JSON.stringify(r.themeOrder)})`);
        appMod._resetAuthHoldForTest();
      }

      // ── (B) NO HINT — today's behaviour, byte for byte ──────────────────
      {
        const r = await bootWithHint(undefined);
        assert(r.themeOrder[0] === 'theme-neutral',
          `[29] a device that has never painted a palette still starts neutral — the hint is an optimisation, not a new default (order: ${JSON.stringify(r.themeOrder)})`);
        appMod._resetAuthHoldForTest();
      }

      // ── (C) GARBAGE IS NOT A THEME, AND IS NEVER A CLASS NAME ───────────
      // The value is read from the device and spliced into a class name; the
      // only safe rule is an allow-list of the seven real keys.
      for (const junk of ['bogus', '"><script>alert(1)</script>', 'theme-aggie', '', 42]) {
        const r = await bootWithHint(junk);
        assert(r.themeOrder[0] === 'theme-neutral',
          `[29] an unknown/garbage hint (${JSON.stringify(junk)}) falls back to the league default (order: ${JSON.stringify(r.themeOrder)})`);
        assert(![...r.bodyClasses].some(c => /[<>"'\s]/.test(String(c))),
          `[29] …and nothing off the device is ever spliced into a class name (classes: ${JSON.stringify([...r.bodyClasses])})`);
        appMod._resetAuthHoldForTest();
      }

      // ── (D) PLAYER B NEVER BOOTS IN PLAYER A's COLOURS ──────────────────
      // Not asserted by reading the sweep's keep-list — driven through the real
      // routine, which is what a handover actually calls.
      {
        const store29 = new Map([['cfbp_theme_hint', JSON.stringify('boilermaker')],
                                 ['cfbp_site_unlocked', '1']]);
        const saved = globalThis.localStorage;
        globalThis.localStorage = {
          getItem: k => (store29.has(k) ? store29.get(k) : null),
          setItem: (k, v) => store29.set(k, String(v)),
          removeItem: k => store29.delete(k),
          clear: () => store29.clear(),
          get length() { return store29.size; },
          key: i => [...store29.keys()][i] ?? null,
        };
        try {
          await quiet29(async () => { authMod.clearDeviceLocalSessionData('handover'); });
          assert(store29.get('cfbp_theme_hint') === undefined,
            `[29] a handover clears the palette hint with every other cfbp_ key — player B never boots in player A's colours (left: ${JSON.stringify([...store29.keys()])})`);
          assert(store29.get('cfbp_site_unlocked') === '1',
            '[29] fixture: …and the sweep is the REAL one, which keeps the site-unlock flag by name (so the assertion above is about the sweep, not about an empty store)');
        } finally { globalThis.localStorage = saved; }
      }

      // ── (E) index.html's INLINE BOOTSTRAP READS THE SAME KEY ────────────
      // The <script> in index.html cannot import, so it re-implements the read.
      // That block has now gone out of sync with storage.js TWICE (its own
      // comment says so). It is EXECUTED here, against the same values, rather
      // than pattern-matched.
      {
        const { readFileSync } = await import('node:fs');
        const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
        const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        const themeBlock = blocks.find(b => b.includes('cfbp_theme_hint'));
        assert(!!themeBlock,
          '[29] index.html\'s inline theme bootstrap reads cfbp_theme_hint — the first paint of all happens before any module loads');
        const runInline = (raw) => {
          const classes = [];
          const store = new Map();
          if (raw !== undefined) store.set('cfbp_theme_hint', raw);
          const sandboxLs = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: () => {}, removeItem: () => {} };
          const sandboxDoc = { body: { classList: { add: c => classes.push(c) } } };
          // eslint-disable-next-line no-new-func
          new Function('localStorage', 'document', themeBlock || '')(sandboxLs, sandboxDoc);
          return classes;
        };
        assert(JSON.stringify(runInline(JSON.stringify('boilermaker'))) === JSON.stringify(['theme-boilermaker']),
          `[29] …and it paints that palette (got ${JSON.stringify(runInline(JSON.stringify('boilermaker')))})`);
        assert(JSON.stringify(runInline(JSON.stringify('bogus'))) === JSON.stringify(['theme-neutral']),
          '[29] …validates against the seven real keys, so an unknown value is the default');
        assert(JSON.stringify(runInline('not json at all')) === JSON.stringify(['theme-neutral']),
          '[29] …survives a corrupt value');
        assert(JSON.stringify(runInline(undefined)) === JSON.stringify(['theme-neutral']),
          '[29] …and an absent value is exactly today\'s behaviour');
      }

      // ── TEARDOWN ────────────────────────────────────────────────────────
      // This section's last boot leaves auth in 'supabase' mode, and §24 below
      // writes a SETTING — which SEC F1's interlock refuses in that mode while
      // no adapter is serving. Put the world back the way the sections after
      // this one expect to find it (the same teardown [25] ends with).
      await quiet29(async () => {
        const sb29 = await import('./js/supabase-backend.js');
        sb29._resetForTest();
        appMod._resetSupabaseDataForTest();
        appMod._resetAuthHoldForTest();
        authMod._resetAuthForTest();
        authMod.configureAuth({});
        storageMod.setBackendMode('local');
      });
    }

  // ═══════════════════════════════════════════════════════════════════════
  // [30] SECURITY A-1-R + REVIEWER F1 — THE COVER, MEASURED DURING THE BOOT
  // ═══════════════════════════════════════════════════════════════════════
  //
  // WHY §[28] DID NOT CATCH THIS. It drives `ingest()` AFTER `runBoot()` has
  // returned — i.e. after config.json has resolved and `configureAuth()` has
  // run. The window the finding is about is entirely BEFORE that:
  //
  //   boot()  →  initChatUI({phase:'early'})   ← replays cfbp_chat_events_cache,
  //                                              inserts #dash-chat-teaser,
  //                                              writes document.title "(n)",
  //                                              calls navigator.setAppBadge(n)
  //          →  armBootIdentityCover()          ← used to be HERE, too late
  //          →  revealApp()
  //          →  await applyAuthModeDecision()   ← configureAuth() finally runs
  //
  // and during it `_cfg.authMode` is still js/auth.js's default `'pins'`, so
  // `isContentWithheld()` took the non-supabase arm and answered FALSE. Every
  // downstream guard is keyed on that one predicate, so all of them said yes.
  //
  // SO THIS SECTION PARKS THE CONFIG FETCH. `config()` returns a promise that
  // does not settle until the assertions have run, which freezes the boot
  // exactly inside the window and lets the state be read rather than inferred.
  // The badge spy, the title and the teaser host are all observed from before
  // `sharedBootHandler()` is called.
  //
  // `inert` IS NOT ENOUGH ON ITS OWN and that is the other half of the finding:
  // it removes an element from hit-testing and the a11y tree, it does not stop
  // paint. The CSS belt (`.main-content[inert]{visibility:hidden}`) is asserted
  // in the stylesheet, since a DOM stub cannot compute style.
  console.log('\n[30] A-1-R — nothing leaks in the window BEFORE config.json lands…');
  {
    const chatMod30 = await import('./js/chat.js');
    const CACHE30 = () => JSON.stringify({ epoch: 0, head: 9, events: [{
      id: 'm9', seq: 9, ts: Date.now() - 60000, type: 'message', author: 'm-kihoon',
      body: 'taking the Aggies -7 and the over, easy money', notify: true, gameTag: '',
    }] });
    const SUPA30 = { authMode: 'supabase', dataMode: 'supabase',
      supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' };
    const PINS30 = { authMode: 'pins' };
    const sess30 = (offsetSec) => JSON.stringify({ access_token: 'tok', refresh_token: 'r',
      expires_at: Math.floor(Date.now() / 1000) + offsetSec, user: { id: 'u-drew', email: 'd@x.test' } });
    const setNav30 = (value) => {
      try { globalThis.navigator = value; }
      catch { Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true }); }
    };
    const quiet30 = async (fn) => {
      const e = console.error, w = console.warn, i = console.info, l = console.log;
      console.error = () => {}; console.warn = () => {}; console.info = () => {}; console.log = () => {};
      try { return await fn(); } finally { console.error = e; console.warn = w; console.info = i; console.log = l; }
    };

    /**
     * One boot, PARKED at the config fetch. Returns everything observable in
     * that window plus a `release(cfgExtra)` that lets the boot finish, so the
     * same scenario can then assert about the terminal outcome (F1).
     */
    async function bootParked({ seed, cfgExtra }) {
      const badgeCalls = [];
      const realNav = globalThis.navigator;
      setNav30({ setAppBadge: n => { badgeCalls.push(`set:${n}`); return Promise.resolve(); },
                 clearAppBadge: () => { badgeCalls.push('clear'); return Promise.resolve(); } });
      let releaseFn = null;
      const parked = new Promise(r => { releaseFn = r; });
      // The chat engine's once-per-page cache-prime latch is module state; the
      // early phase must actually replay, or every assertion below is vacuous.
      chatMod30._resetForTest();
      // Put the world back to a cold device before each boot. A previous
      // scenario's RELEASED boot leaves the adapter mid-state and the storage
      // mirror on 'supabase', and boot()'s own refreshHeader() then reads a
      // half-hydrated week out of it — a fixture failure that looks like a
      // finding. Same teardown every other section in this file ends with.
      await quiet30(async () => {
        const sb = await import('./js/supabase-backend.js');
        sb._resetForTest();
        appMod._resetSupabaseDataForTest();
        appMod._resetAuthHoldForTest();
        storageMod.setBackendMode('local');
      });
      const bootPromise = quiet30(() => runBoot({
        config: () => parked.then(() => ({ ok: true,
          json: async () => ({ backendUrl: BACKEND_URL, backendToken: BACKEND_TOKEN, ...cfgExtra }) })),
        paintPages: true,
        seed: { cfbp_backend_config: BACKEND_CFG, cfbp_chat_events_cache: CACHE30(), ...seed },
      }));
      // runBoot drains 60 macrotask ticks and returns with boot() still parked
      // on `await applyAuthModeDecision()` — which is the window.
      const r = await bootPromise;
      return {
        r, badgeCalls,
        title: () => String(globalThis.document.title || ''),
        dashHTML: () => String(r.reg.get('page-dashboard')?.innerHTML || ''),
        release: async () => { releaseFn(); await quiet30(async () => { for (let i = 0; i < 80; i++) await new Promise(res => setTimeout(res, 0)); }); },
        restoreNav: () => setNav30(realNav),
      };
    }

    // ── (A) THE FOUR SESSION SHAPES, IN THE PRE-CONFIG WINDOW ─────────────
    const SESSIONS30 = [
      ['no session at all',      null,          true],
      ['a GARBAGE session',      '{not json',   true],
      ['an EXPIRED session',     sess30(-7200), true],
      // A VALID unexpired token in THIS device's own storage is the credential
      // (the same pair armBootIdentityCover()/releaseBootIdentityCover() ask).
      // Asserted rather than skipped so the decision is pinned and visible.
      ['a VALID unresolved session', sess30(3600), false],
    ];
    for (const [label, session, mustWithhold] of SESSIONS30) {
      const b = await bootParked({
        seed: { cfbp_auth_mode_last_known: 'supabase', ...(session ? { cfbp_supabase_session: session } : {}) },
        cfgExtra: SUPA30,
      });
      try {
        assert(b.r.fetches.some(u => String(u).includes('config.json')),
          `[30] ${label}: fixture — the boot really did reach the config fetch and park there`);
        assert(chatMod30.getMessages({ tag: 'all' }).some(m => m.id === 'm9'),
          `[30] ${label}: fixture — the EARLY phase really replayed the device cache (without this every assertion below is vacuous)`);
        if (mustWithhold) {
          assert(appMod.isContentWithheld() === true,
            `[30] ${label}: A-1-R(1) — isContentWithheld() is TRUE before the config read lands, on a last-known-supabase device. It used to take the 'pins' arm here and answer false.`);
          assert(b.r.chrome.main.getAttribute('inert') === '' && b.r.chrome.main.getAttribute('aria-hidden') === 'true',
            `[30] ${label}: the cover IS on during the window (inert + aria-hidden on .main-content)`);
          assert(!/dash-chat-teaser/.test(b.dashHTML()) && !/Aggies -7/.test(b.dashHTML()),
            `[30] ${label}: no teaser, no member name, no 64 characters of what they wrote (got ${JSON.stringify(b.dashHTML().slice(0, 120))})`);
          // THE TITLE IS ASSERTED UNCHANGED, not count-free. `paintPages`
          // seeds "(3)" — a PREVIOUS session's true badge — and A-1's rule has
          // two directions: an unknown viewer must not WRITE a number, and must
          // not DESTROY a true one either (writing 0 would). The replayed cache
          // holds one unread, so the leak would be "(1)"; a regression that
          // blanked it to "IRB Pick 'Ems" is the other half and also fails here.
          assert(b.title() === "(3) IRB Pick 'Ems",
            `[30] ${label}: the tab title is EXACTLY as the previous session left it — no count derived from the replayed cache was written over it, and the real one was not destroyed (got ${JSON.stringify(b.title())})`);
          assert(b.badgeCalls.length === 0,
            `[30] ${label}: navigator.setAppBadge() is never called — that badge PERSISTS on the installed icon (got ${JSON.stringify(b.badgeCalls)})`);
          assert(chatMod30.latestUnreadNotifying(null, 0) === null,
            `[30] ${label}: A-1-R(3) — latestUnreadNotifying() answers null for an unresolved identity, the one unread surface that had no identityKnown() guard`);
          assert(chatMod30.latestNotifying(null) === null,
            `[30] ${label}: A-1-R(3) — …and latestNotifying() too, so no cached-message toast can fire pre-identity`);
        } else {
          assert(appMod.isContentWithheld() === false,
            `[30] ${label}: STATED DECISION — an unexpired token in this device's own storage IS the credential, so content is not withheld. Pinned so the decision is visible rather than assumed.`);
        }
      } finally { await b.release(); b.restoreNav(); }
    }

    // ── (B) A PIN-MODE DEVICE IS BYTE-IDENTICAL ──────────────────────────
    {
      const b = await bootParked({ seed: {}, cfgExtra: PINS30 });
      try {
        assert(appMod.isContentWithheld() === false,
          '[30] PIN-mode device (last-known mode is not supabase): content is NOT withheld in the pre-config window — the fail-closed arm is scoped to the devices that owe a cover, and the pins boot is unchanged');
        assert(b.r.chrome.main.getAttribute('inert') === null,
          '[30] …and no cover is armed on it at all');
      } finally { await b.release(); b.restoreNav(); }
    }

    // ── (C) REVIEWER F1 — EVERY TERMINAL OUTCOME ─────────────────────────
    //
    // THE RULE, stated once: when the boot stops, EITHER the cover is off, OR
    // there is a gate on screen the player can act on. Never a covered app with
    // nothing on top of it — which with the CSS belt in place is an INVISIBLE
    // dead app, not merely an unresponsive one.
    //
    //   outcome                         | expected
    //   --------------------------------|---------------------------------
    //   rollback to pins (case D)       | cover OFF (pins never owed one)
    //   supabase, no session            | cover ON + sign-in gate on screen
    //   config unreadable               | cover ON + hold gate on screen
    //   SDK load failure                | cover ON + a gate on screen
    const GATE_IDS30 = ['site-gate-overlay', 'auth-hold-gate'];
    const gateOnScreen = (reg) => GATE_IDS30.some(id => {
      const el = reg.get(id);
      return !!el && el._removed !== true;
    });

    // (D) THE REVIEWER'S OWN REPRODUCTION — last-known supabase, config says pins.
    {
      const b = await bootParked({ seed: { cfbp_auth_mode_last_known: 'supabase' }, cfgExtra: PINS30 });
      await b.release();
      try {
        assert(b.r.chrome.main.getAttribute('inert') === null
            && b.r.chrome.nav.getAttribute('inert') === null,
          `[30] F1 CASE D — on the ROLLBACK lever (last-known supabase, config.json rolled back to pins) the cover is RELEASED. Every release site used to be gated on mode === 'supabase', so this device painted a PIN gate over a permanently inert app: six dead phones on the one control that exists to save them. (main inert=${JSON.stringify(b.r.chrome.main.getAttribute('inert'))})`);
        assert(b.r.chrome.main.getAttribute('aria-hidden') === null,
          '[30] F1 CASE D — …and aria-hidden with it, so the app is back in the accessibility tree');
        assert(gateOnScreen(b.r.reg),
          '[30] F1 CASE D — fixture: the PIN gate this device owes IS on screen (the release must not be achieved by skipping the gate)');
      } finally { b.restoreNav(); }
    }

    // The other three terminal outcomes.
    const TERMINALS30 = [
      ['supabase, no session',  { cfbp_auth_mode_last_known: 'supabase' }, SUPA30],
      ['supabase, expired session', { cfbp_auth_mode_last_known: 'supabase', cfbp_supabase_session: sess30(-7200) }, SUPA30],
    ];
    for (const [label, seed, cfg] of TERMINALS30) {
      const b = await bootParked({ seed, cfgExtra: cfg });
      await b.release();
      try {
        // The sign-in gate's own deadline is what ends the "persisted session
        // the SDK has not resolved" wait, and it is a real 6-second timer. Fire
        // it here rather than sleeping: boottest [27] uses the same seam, and
        // what this section is asserting is the TERMINAL state, not the clock.
        await quiet30(async () => { appMod._fireSignInGateDeadlineForTest?.(); for (let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0)); });
        const covered = b.r.chrome.main.getAttribute('inert') === '';
        assert(!covered || gateOnScreen(b.r.reg),
          `[30] F1 FAIL-SAFE — ${label}: the boot ended either with the cover off or with a gate on screen, never a covered app with nothing on top (covered=${covered}, gate=${gateOnScreen(b.r.reg)})`);
        assert(covered || b.r.chrome.main.getAttribute('aria-hidden') === null,
          `[30] F1 FAIL-SAFE — ${label}: …and a released cover releases BOTH attributes, so a lifted app is also back in the accessibility tree`);
      } finally { b.restoreNav(); }
    }

    // ── (D2) A-1-R(2) — THE ORDER OF THE STATEMENTS, READ OFF THE SOURCE ──
    //
    // The §[22] precedent: an ORDERING claim about boot() is asserted against
    // the file, because what cannot be faked is the order of the statements in
    // it. The runtime assertions above cannot separate this layer from layer
    // (1) — with (1) in place nothing leaks whatever the order is, which is the
    // whole point of defence in depth and also the reason each layer needs an
    // assertion that only IT can satisfy.
    {
      const { readFileSync } = await import('node:fs');
      const src30 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
      const code30 = src30
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, (m, p1) => p1 + ' '.repeat(m.length - p1.length))).join('\n');
      assert(code30.length === src30.length,
        '[30] fixture: the comment blanker preserves length, so the indices below point at real code');
      const bootAt30 = code30.indexOf('async function boot() {');
      const armAt = code30.indexOf('armBootIdentityCover();', bootAt30);
      const earlyChatAt = code30.indexOf("initChatUI({ phase: 'early' })", bootAt30);
      const revealAt = code30.indexOf('revealApp();', bootAt30);
      assert(bootAt30 > 0 && armAt > 0 && earlyChatAt > 0 && revealAt > 0,
        `[30] fixture: boot(), armBootIdentityCover(), the early chat phase and revealApp() were all located (${bootAt30}/${armAt}/${earlyChatAt}/${revealAt})`);
      assert(armAt < earlyChatAt,
        '[30] A-1-R(2) — armBootIdentityCover() is called BEFORE initChatUI({phase:\'early\'}), not after it. The early phase is what replays the device cache and inserts the teaser; a cover armed afterwards is a cover armed after the leak.');
      assert(armAt < revealAt,
        '[30] A-1-R(2) — …and still before revealApp(), so the cover is never applied to an already-visible page');
    }

    // ── (E) THE CSS BELT — a DOM stub cannot compute style, so assert the rule
    {
      const { readFileSync } = await import('node:fs');
      const css30 = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
      assert(/\.main-content\[inert\][^{]*,[^{]*\.bottom-nav\[inert\]\s*\{[^}]*visibility:\s*hidden/.test(css30.replace(/\s*\n\s*/g, ' ')),
        '[30] A-1-R(4) — the CSS belt exists: `inert` blocks interaction, NOT paint, so the covered content is also made invisible. visibility (not display) keeps layout, so nothing shifts under it.');
      const belt = css30.slice(css30.indexOf('.main-content[inert]'), css30.indexOf('.main-content[inert]') + 240);
      assert(!/native-shell/.test(belt),
        '[30] A-1-R(4) — …and the belt does not branch on body.native-shell: a security cover that skipped the installed app would be a hole, and visibility:hidden touches none of the native shell\'s own splash/safe-area rules');
    }

    // ── TEARDOWN ────────────────────────────────────────────────────────
    await quiet30(async () => {
      const sb30 = await import('./js/supabase-backend.js');
      sb30._resetForTest();
      chatMod30._resetForTest();
      appMod._resetSupabaseDataForTest();
      appMod._resetAuthHoldForTest();
      authMod._resetAuthForTest();
      authMod.configureAuth({});
      storageMod.setBackendMode('local');
    });
  }

  }
}

// ═══════════════════════════════════════════════════════════════════════════
// [22] PHASE III STEP 4 PART B — THE BOOT ORDER THE INTERLOCK DEPENDS ON
//      (DI-T4.12, §7.3, §1.2, §5.1)
//
// Three claims, and all three are ORDERING or ABSENCE claims, which is why they
// are read off the source rather than driven: boot() is a DOMContentLoaded
// handler that fetches config.json, injects a vendored SDK and paints six
// pages, and a suite that drove it end-to-end would be asserting about its own
// stubs. What cannot be faked is the order of the statements in the file.
//
//   (a) chatTransport's dataMode predicate is installed BEFORE anything can
//       subscribe. chatTransport.js is the only module that talks to the chat
//       backend (AD-16) and that backend is the SIX PLAYERS' production Sheet.
//       Chat starts early in boot() on purpose (BUG-G), and navigateTo()
//       subscribes through refreshChatEnabled() — so a predicate installed
//       after either of those leaves a window in which a Supabase-scoped league
//       appends to the wrong league's log. That is the cross-league bleed §7.3
//       exists to prevent, and a window is not smaller than a hole.
//
//   (b) the install is NOT wrapped in a try/catch. setSupabaseDataModePredicate()
//       THROWS on a non-function, deliberately: the earlier version silently
//       reverted to "chat is available", so one typo disabled the interlock for
//       a whole session with no error and no log line. Catching it here would
//       rebuild exactly that failure one layer up.
//
//   (c) with `dataMode` absent from config.json, the adapter path is DEAD.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[22] Step 4 Part B — the predicate is installed first, the install can fail loudly, and the flag-off path is dead…');
{
  const { readFileSync } = await import('node:fs');
  const appSrc16 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  // Comments stripped for every ORDER assertion: this file's prose names the
  // very calls being ordered, and a rule that matches prose passes over the
  // code it is describing (RG-49's shape). Length is preserved so the indices
  // below are indices into something real.
  const code16 = appSrc16
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, (m, p1) => p1 + ' '.repeat(m.length - p1.length))).join('\n');
  assert(code16.length === appSrc16.length,
    '[22] fixture: the comment blanker preserves length, so every index below points at the real file');

  const bootAt = code16.indexOf('async function boot() {');
  assert(bootAt > 0, '[22] fixture: boot() was located');
  const bootEnd = code16.indexOf('\n}', code16.indexOf('await runPostHydrateTail();', bootAt));
  const bootBody = code16.slice(bootAt, bootEnd > bootAt ? bootEnd : bootAt + 9000);

  // ── (a) ORDER ────────────────────────────────────────────────────────────
  const installAt = bootBody.indexOf('setSupabaseDataModePredicate(');
  const chatAt = bootBody.indexOf("initChatUI({ phase: 'early' })");
  const navAt16 = bootBody.indexOf("navigateTo('dashboard')");
  const revealAt = bootBody.indexOf('revealApp()');
  assert(installAt > -1, '[22] boot() installs the chatTransport dataMode predicate at all');
  assert(chatAt > -1 && navAt16 > -1 && revealAt > -1,
    '[22] fixture: boot()’s early chat start, its first navigateTo() and revealApp() were all located');
  assert(installAt < chatAt,
    `[22] …and it is installed BEFORE initChatUI({phase:'early'}) — the early chat start subscribes, and a Supabase-scoped league must never append to the production Sheet (install@${installAt}, chat@${chatAt})`);
  assert(installAt < navAt16,
    `[22] …and before the first navigateTo(), whose refreshChatEnabled() subscribes on its own (install@${installAt}, nav@${navAt16})`);
  assert(installAt < revealAt,
    `[22] …and before revealApp(), so a throwing install leaves the boot-time visibility lock ON: a SEEN boot failure, not a silent one (install@${installAt}, reveal@${revealAt})`);
  const afterBrace = bootBody.indexOf('{') + 1;
  assert(bootBody.slice(afterBrace, installAt).trim().length === 0,
    `[22] …and it is literally the FIRST statement in boot(), so no future insertion can quietly get in front of it (found ${JSON.stringify(bootBody.slice(afterBrace, installAt).trim().slice(0, 120))} before it)`);
  assert(bootBody.indexOf('wireSupabaseAdapter()') > installAt,
    '[22] the adapter is wired after the predicate, not before — one ordering, stated once');
  // ── …AND *BEFORE* THE AUTH-MODE DECISION (cutover, 2026-09-18) ───────────
  // The interlock now asks a CONFIGURATION question, and one of its two terms is
  // "has the adapter registered its probe?" (js/auth.js). wireSupabaseAdapter()
  // is what registers it. So a boot that ran applyAuthModeDecision() FIRST would
  // read an unregistered probe, conclude this build has no Supabase data layer,
  // and hold every device behind the 'interlock' gate — the exact symptom of the
  // cutover defect, reintroduced by ordering alone with the predicate itself
  // still correct. authtest [45] proves the predicate; this proves the order it
  // depends on.
  const wireAt22 = bootBody.indexOf('wireSupabaseAdapter()');
  const decideAt22 = bootBody.indexOf('await applyAuthModeDecision()');
  assert(decideAt22 > -1, '[22] fixture: boot()\'s awaited applyAuthModeDecision() was located');
  assert(wireAt22 < decideAt22,
    `[22] the adapter is wired BEFORE boot() awaits applyAuthModeDecision() (wire@${wireAt22}, decide@${decideAt22}) — the interlock's configuration test reads the registered probe, so the reverse order holds every device at the gate`);
  {
    // MUTANT, on a STRING (never the file): move the wiring below the decision
    // and the rule must go red.
    const mutant22 = bootBody
      .replace('wireSupabaseAdapter();', '/*moved*/')
      .replace('await applyAuthModeDecision()', 'await applyAuthModeDecision(); wireSupabaseAdapter()');
    assert(!(mutant22.indexOf('wireSupabaseAdapter()') < mutant22.indexOf('await applyAuthModeDecision()')),
      '[22] MUTANT: wiring the adapter at the decision instead of at the top of boot() turns that rule RED');
  }

  // MUTANT PROOF for (a): reordering the two must turn the rule red. Applied to
  // a STRING, never to the file (CLAUDE.md: never git checkout to undo a test
  // mutation; the safest mutation is one that never touches the disk).
  {
    const mutant = bootBody
      .replace('setSupabaseDataModePredicate(isSupabaseDataMode);', '/*moved*/')
      .replace("initChatUI({ phase: 'early' })", "setSupabaseDataModePredicate(isSupabaseDataMode); initChatUI({ phase: 'early' })");
    const mInstall = mutant.indexOf('setSupabaseDataModePredicate(');
    const mChat = mutant.indexOf("initChatUI({ phase: 'early' })");
    assert(!(mInstall < mChat && mutant.slice(mutant.indexOf('{') + 1, mInstall).trim().length === 0),
      '[22] MUTANT: moving the install down to the chat start turns the ordering rule RED — so the rule is about the order, not about the text existing');
  }

  // ── (b) THE INSTALL IS NOT SWALLOWED ─────────────────────────────────────
  {
    const line = bootBody.slice(installAt, bootBody.indexOf('\n', installAt));
    assert(/^setSupabaseDataModePredicate\(isSupabaseDataMode\);\s*$/.test(line.trim()),
      `[22] the install is a BARE statement — no try, no catch, no ?. and no ||-fallback around it (got: ${JSON.stringify(line.trim())})`);
    const before = bootBody.slice(0, installAt);
    assert(!/try\s*\{[^}]*$/.test(before),
      '[22] …and there is no open try block above it: a swallowed TypeError here would silently disable the cross-league interlock for the whole session, which is the exact defect DI-T4.12 closed');
    // MUTANT: wrap it, and the bare-statement rule must go red.
    const wrapped = 'try { setSupabaseDataModePredicate(isSupabaseDataMode); } catch {}';
    assert(!/^setSupabaseDataModePredicate\(isSupabaseDataMode\);\s*$/.test(wrapped.trim()),
      '[22] MUTANT: wrapping the install in try/catch turns that rule RED');
  }
  // …and the throw is real, driven against the actual module.
  {
    transport._resetSupabaseDataModePredicateForTest();
    let threw = null;
    try { transport.setSupabaseDataModePredicate(undefined); } catch (e) { threw = e; }
    assert(threw && threw.name === 'TypeError',
      `[22] setSupabaseDataModePredicate(undefined) really THROWS (got ${threw && threw.name}) — the boot-visible failure the bare statement above lets through`);
    assert(threw && /requires a function/.test(threw.message),
      '[22] …with a message that names the programming error rather than a symptom');
    // R2 — the release: a REAL predicate installs cleanly and answers.
    let answered = null;
    transport.setSupabaseDataModePredicate(() => { answered = true; return false; });
    assert(answered === null, '[22] R2: installing a real predicate does not CALL it — installation is not evaluation');
    transport._resetSupabaseDataModePredicateForTest();
  }

  // ── (c) FLAG-OFF IS DEAD, AND config.json STILL HAS NO dataMode KEY ───────
  {
    const cfgRaw = readFileSync(new URL('./config.json', import.meta.url), 'utf8');
    const cfg = JSON.parse(cfgRaw);
    // CUTOVER 2026-09-19 (v0.22.1): the invariant is DI §8.1 step 3 — the two flags move TOGETHER,
    // never one alone. Before cutover both were absent; from cutover both read 'supabase'; a
    // rollback removes both in one commit. Either pair is legal; a split pair is the defect.
    const bothAbsent = !('dataMode' in cfg) && !('authMode' in cfg);
    const bothOn = cfg.dataMode === 'supabase' && cfg.authMode === 'supabase';
    assert(bothAbsent || bothOn,
      `[22] config.json's authMode/dataMode move TOGETHER — both absent (pre-cutover / rollback) or both 'supabase' (cutover); got authMode=${JSON.stringify(cfg.authMode)} dataMode=${JSON.stringify(cfg.dataMode)}`);

    // BYTE-IDENTITY OF BEHAVIOUR, asked of the two functions that decide it.
    // Absent and 'sheets' must produce the same answer, and 'supabase' must be
    // the only string that does not.
    const modeOf = (raw) => {
      const be = backend;
      be.setDataMode(raw);
      return be.getDataMode();
    };
    const wasMode = backend.getDataMode();
    assert(modeOf(undefined) === 'sheets' && modeOf('sheets') === 'sheets' && modeOf(null) === 'sheets'
      && modeOf('') === 'sheets' && modeOf('Supabase') === 'sheets' && modeOf(true) === 'sheets',
      '[22] absent / null / \'\' / \'sheets\' / a mis-cased value all normalize to \'sheets\' — identical behaviour, not merely a similar default');
    assert(modeOf('supabase') === 'supabase',
      '[22] …and exactly one string turns it on');
    backend.setDataMode(wasMode);

    // And loadDeployedConfig() carries it on the SUCCESS branches only — the
    // same SEC F1-R1 shape authMode has: a read that could not happen must not
    // ANSWER. Read off the source, because driving it needs a fetch stub this
    // section does not own.
    const beSrc16 = readFileSync(new URL('./js/backend.js', import.meta.url), 'utf8');
    const fn16 = beSrc16.slice(beSrc16.indexOf('export async function loadDeployedConfig'),
      beSrc16.indexOf('export function getBackendConfig'));
    assert(/const dataMode = _normalizeDataMode\(data\?\.dataMode\);/.test(fn16),
      '[22] loadDeployedConfig() reads dataMode from the parsed config');
    const failBranches = fn16.match(/return \{ ok: false,[^}]*authModeKnown: false[^}]*\}/g) || [];
    assert(failBranches.length === 2 && failBranches.every(b => !/dataMode/.test(b)),
      `[22] …and neither failure branch carries one (found ${failBranches.length}) — a config read that did not happen must not answer, which is what keeps a captive portal from downgrading a cutover device`);
  }

  // ── (d) THE ADAPTER HAS NO TOP-LEVEL SIDE EFFECTS ────────────────────────
  // js/storage.js imports js/supabase-backend.js STATICALLY (DI §1.2 row 1), so
  // it is evaluated on EVERY boot, including every flag-off one. That is only
  // free if the module really does nothing at import time.
  {
    const sbSrc16 = readFileSync(new URL('./js/supabase-backend.js', import.meta.url), 'utf8');
    const top16 = sbSrc16
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
      .split('\n').filter(l => /^\S/.test(l) && l.trim());
    const suspicious = top16.filter(l => /^(localStorage|document|window|setTimeout|setInterval|fetch|await)\b/.test(l.trim()));
    assert(suspicious.length === 0,
      `[22] js/supabase-backend.js touches no storage, no DOM, no timer and no network at module scope (found: ${JSON.stringify(suspicious)})`);
    const stSrc16 = readFileSync(new URL('./js/storage.js', import.meta.url), 'utf8');
    assert(/import \* as sb from '\.\/supabase-backend\.js';/.test(stSrc16),
      '[22] …and js/storage.js imports it as a namespace, exactly as DI §1.2 row 1 specifies');
    assert(/_backendMode = \(mode === 'googleSheets' \|\| mode === 'supabase'\) \? mode : 'local'/.test(stSrc16),
      '[22] setBackendMode() accepts the third mode and still coerces anything unrecognised to \'local\' — the mode that cannot lose data to a typo');
  }

  // ── (e) THE THREE setBackendMode('local') ARMS ARE UNREACHABLE (§5.1) ─────
  // They call initStorage(), which seeds demo data into raw localStorage. Doing
  // that under a proven identity's league is the failure §0.3 item 3 forbids, so
  // the supabase branch must return ABOVE all three.
  {
    const tryAt = code16.indexOf('if (isSupabaseDataMode()) {', bootAt);
    const arms = [...bootBody.matchAll(/setBackendMode\('local'\); initStorage\(\)/g)].map(m => m.index);
    assert(arms.length === 3, `[22] fixture: boot() still has exactly three setBackendMode('local') arms (got ${arms.length})`);
    const branchAt = bootBody.indexOf('if (isSupabaseDataMode()) {');
    assert(tryAt > -1 && branchAt > -1, '[22] fixture: the supabase branch inside boot()’s hydrate block was located');
    assert(arms.every(a => a > branchAt),
      `[22] all three arms are BELOW the supabase branch (branch@${branchAt}, arms@${JSON.stringify(arms)})`);
    const branchBody = bootBody.slice(branchAt, branchAt + 700);
    assert(/await ensureSupabaseDataHydrated\('boot'\);/.test(branchBody) && /\n\s*return;/.test(branchBody),
      '[22] …and the branch RETURNS after the adapter hydrate, so no Sheets arm below it can run');
  }
}

console.log('\n[23] DI-T6.1 — the notify-fanout client gate is a SCAN-TIME read, never a boot-time one…');
{
  // Step 6's rollback is "flip one boolean; it takes effect on the next
  // invocation, with no deploy." On the server that is `isJobEnabled()`'s one
  // uncached select per invocation. On the CLIENT the equivalent hazard is a
  // boot-time decision: read the switch once at boot — or, worse, decline to
  // wire the relay at all when it is on — and a flip does nothing until every
  // player closes and reopens the app. On an installed iOS PWA that can be days.
  //
  // notifytest [28] owns the behaviour in both states. THIS section owns the
  // boot-time property, which no behavioural test taken inside one session can
  // see: the wiring is unconditional and the read happens at scan time.
  const { readFileSync } = await import('node:fs');
  const notifSrc23 = readFileSync(new URL('./js/notifications.js', import.meta.url), 'utf8');
  const appSrc23 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const storage23 = await import('./js/storage.js');
  const notif23 = await import('./js/notifications.js');

  // ── (a) THE WIRING IS UNCONDITIONAL. ────────────────────────────────────
  assert(/wireChatNotifications\(\)/.test(appSrc23),
    '[23] fixture: boot() still calls wireChatNotifications()');
  {
    // The 400 characters before the call — no serverJobs term may appear in
    // them. A `if (!isServerJobEnabled('notifyFanout')) wireChatNotifications()`
    // would pass every behavioural test written inside one session and still be
    // the defect: the watermark would never be seeded, so a flip back would
    // meet the whole intervening week as a backlog.
    const at = appSrc23.indexOf('wireChatNotifications()');
    const before = appSrc23.slice(Math.max(0, at - 400), at);
    assert(!/serverJobs|isServerJobEnabled|notifyFanout/.test(before),
      '[23] boot() wires the chat relay UNCONDITIONALLY — the switch is not consulted anywhere near the wiring, so a mid-season flip needs no app restart on six phones');
  }

  // ── (b) THE GATE LIVES INSIDE THE SCAN. ─────────────────────────────────
  {
    const scanAt = notifSrc23.indexOf('function _scanNewChatMessages()');
    const gateAt = notifSrc23.indexOf("if (isServerJobEnabled('notifyFanout')) return;");
    const wireAt = notifSrc23.indexOf('export function wireChatNotifications(');
    assert(scanAt > -1 && gateAt > -1, '[23] fixture: both _scanNewChatMessages() and the gate line were located');
    assert(gateAt > scanAt && (wireAt === -1 || gateAt < wireAt || scanAt < wireAt),
      `[23] the gate is INSIDE _scanNewChatMessages (scan@${scanAt}, gate@${gateAt}) — one read per scan, which is the same "no cache longer than the invocation" rule _shared/jobs.js holds itself to`);
    const watermarkAt = notifSrc23.indexOf('_chatWatermarkSeq = Math.max(_chatWatermarkSeq');
    assert(watermarkAt > -1 && watermarkAt < gateAt,
      `[23] …and it sits AFTER the watermark advance (watermark@${watermarkAt}, gate@${gateAt}). Gating first would freeze the watermark for as long as the switch is on, and the flip back would arrive as a burst-cap trip instead of a resumed relay`);
  }

  // ── (c) NO MODULE-LEVEL CACHE. ──────────────────────────────────────────
  {
    const fnAt = notifSrc23.indexOf('export function isServerJobEnabled(');
    const body = notifSrc23.slice(fnAt, notifSrc23.indexOf('\n}', fnAt) + 2);
    assert(/getSettings\(\)/.test(body),
      '[23] isServerJobEnabled() reads the seam on every call — getSettings() is synchronous, so there is nothing to gain by caching and a cached switch is a rollback that does not roll back');
    assert(!/let\s+_serverJobs|const\s+_serverJobsCache|_cachedServerJobs/.test(notifSrc23),
      '[23] …and no module-scope cache of the switch exists anywhere in the module');
  }

  // ── (d) EACH WAY, LIVE, WITHIN ONE SESSION. ─────────────────────────────
  {
    const before23 = storage23.getSettings();
    storage23.saveSetting('serverJobs', { notifyFanout: true });
    const on = notif23.isServerJobEnabled('notifyFanout');
    storage23.saveSetting('serverJobs', { notifyFanout: false });
    const off = notif23.isServerJobEnabled('notifyFanout');
    storage23.saveSetting('serverJobs', undefined);
    const absent = notif23.isServerJobEnabled('notifyFanout');
    assert(on === true && off === false && absent === false,
      `[23] the same module answers true, then false, then false-when-absent WITHOUT a reload (got ${on}/${off}/${absent}) — which is what makes the rollback a flip`);
    assert(notif23.isServerJobEnabled('notAJob') === false,
      '[23] …and a job name outside the eight reads as OFF, the same direction as an absent one');
    storage23.saveSettings(before23);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// [24] RG-177 — "we need to now remove the in app notification banner now that
//      we have onesignal."  (Drew, live on Supabase, 2026-09-19)
// ═══════════════════════════════════════════════════════════════════════════
//
// WHAT WAS ALREADY BUILT, AND WHY THE REPORT IS STILL TRUE. The in-app toast is
// ALREADY supposed to stand down on a device where push is carrying the notice:
// chat-ui.js's showToast() opens with `if (getPushActive()) return;` (N1/DI-N3,
// R10), and playBlip() carries the same gate. It is deliberately KEPT on a
// device where push is NOT active, because being silenced on both surfaces at
// once is UN-N3's failure. So the report is not "the gate was never built" —
// it is "the gate reads a flag that, after the Supabase cutover, can no longer
// be written."
//
// THE ROOT CAUSE, one mechanism, two halves:
//
//   (1) js/storage.js's save() begins with SEC F1's write interlock —
//       `if (isSupabaseWriteWithheld()) throw` — and that throw happens ABOVE
//       the `useBackend(key)` routing check. So it refuses DEVICE-LOCAL keys
//       too, including KEYS.PUSH_ACTIVE, whenever the Supabase adapter is not
//       SERVING (IDLE / HYDRATING / SWITCHING / HELD / OFFLINE-READONLY).
//       refreshPushActiveFlag() wrote through `try { … } catch {}`, so the
//       refusal was swallowed in silence.
//
//   (2) …and nothing ever retried it. boot()'s supabase branch runs
//       `await ensureSupabaseDataHydrated('boot')` — which RETURNS FALSE
//       IMMEDIATELY when the active league is not resolved yet, because
//       applyAuthModeDecision()'s membership refresh is deliberately not
//       awaited — and then runs `await runPostHydrateTail()` UNCONDITIONALLY.
//       The tail is latched (`_postHydrateTailDone`), and it is the only
//       unconditional caller of refreshPushActiveFlag(). So on a normal boot
//       the one computation happens while every write is refused, and the
//       `if (!_sbTailRan) runPostHydrateTail()` that fires when the league
//       finally lands hits the latch and returns immediately.
//
// The net effect on Drew's phone: push works, `cfbp_push_active` stays false
// forever, and every event push delivers ALSO pops the in-app banner.
//
// DI-N3 named three moments the answer can change (boot-after-init, a
// permission grant, a master-toggle flip). Supabase added a FOURTH that nobody
// added — the moment the answer can be WRITTEN AT ALL.
console.log('\n[24] RG-177 — the push-active flag survives a boot where the adapter is not serving yet…');
{
  const { readFileSync } = await import('node:fs');
  const appMod24     = await import('./js/app.js');
  const storage24    = await import('./js/storage.js');
  const auth24       = await import('./js/auth.js');
  const push24       = await import('./js/push-onesignal.js');
  const appSrc24     = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const chatUiSrc24  = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  const storageSrc24 = readFileSync(new URL('./js/storage.js', import.meta.url), 'utf8');

  const saved24 = {
    document: globalThis.document, navigator: globalThis.navigator, fetch: globalThis.fetch,
    matchMedia: globalThis.matchMedia, Notification: globalThis.Notification,
    PushSubscriptionOptions: globalThis.PushSubscriptionOptions,
    OneSignalDeferred: globalThis.OneSignalDeferred,
  };
  const setNav24 = (v) => { try { globalThis.navigator = v; }
    catch { Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true }); } };

  // A device on which push genuinely IS carrying the notices: configured App
  // ID, a browser the SDK supports, permission granted, OneSignal reporting a
  // live subscription. All three of DI-N3's terms true.
  const installPushActiveDevice = () => {
    push24._resetForTest({});
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'abad65e9-e9d8-4b69-b342-c43947a7189a' }) });
    setNav24({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/127', vendor: 'Google Inc.', maxTouchPoints: 1, serviceWorker: {} });
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
    globalThis.PushSubscriptionOptions = function () {};
    globalThis.PushSubscriptionOptions.prototype.applicationServerKey = null;
    globalThis.OneSignalDeferred = { push: (fn) => { fn({ User: { PushSubscription: { optedIn: true } } }); } };
  };

  // ── (a) THE MECHANISM: a DEVICE-LOCAL write is refused too ───────────────
  {
    auth24.configureAuth({ authMode: 'supabase', dataMode: 'supabase',
      supabaseUrl: 'https://tbmkhnsigeoxqpttciuy.supabase.co', supabaseAnonKey: 'anon' });
    auth24._setHasSupabaseDataBackendForTest(false);              // the adapter is not serving
    assert(/KEYS\.PUSH_ACTIVE,/.test(storageSrc24.slice(storageSrc24.indexOf('const DEVICE_LOCAL_KEYS'), storageSrc24.indexOf('const DEVICE_LOCAL_KEYS') + 1400)),
      '[24] fixture: KEYS.PUSH_ACTIVE really is in DEVICE_LOCAL_KEYS — it never goes near a backend');
    let threw = null;
    try { storage24.setPushActive(true); } catch (e) { threw = e; }
    assert(threw && threw.name === 'AuthModeMismatchError',
      `[24] SEC F1's write interlock refuses a DEVICE-LOCAL key too, because it runs ABOVE save()'s useBackend() routing check (got ${threw && threw.name})`);
    assert(storage24.getPushActive() === false,
      '[24] …and the READ still works (load() routes device-local keys straight to localStorage), so the refusal is invisible to every caller');
  }

  // ── (b) THE DEFECT, END TO END, IN THE ORDER A REAL BOOT PRODUCES IT ─────
  // Drew's boot, step by step: the tail runs before the league resolves (so
  // every write is refused), it computes the one push-active answer it will
  // ever compute, and THEN the membership lands and the adapter starts serving.
  // Pre-fix the answer was lost in the gap and the flag stayed false for the
  // life of the page — so every event push delivers ALSO popped the in-app
  // banner, on a phone where push demonstrably works.
  {
    installPushActiveDevice();
    auth24._setHasSupabaseDataBackendForTest(false);              // boot: the league is not resolved yet
    const computed = await appMod24.refreshPushActiveFlag();      // the boot tail's one call
    assert(computed === true,
      `[24] fixture: all three of DI-N3's terms are true on this device, so the predicate COMPUTES push-active (got ${computed}) — without this every assertion below is vacuous`);
    assert(storage24.getPushActive() === false,
      '[24] …and DURING the non-serving window the flag still reads false, which is right: the interlock is a security control and is not weakened for one key. Content is withheld in that window anyway, and false is the fail-closed direction (UN-N3 — show the toast rather than silence the player)');

    auth24._setHasSupabaseDataBackendForTest(true);               // the league lands; the adapter SERVES
    assert(typeof appMod24.flushPendingPushActiveFlag === 'function',
      '[24] app.js exposes the flush that the adapter-serving transition calls');
    if (typeof appMod24.flushPendingPushActiveFlag === 'function') appMod24.flushPendingPushActiveFlag('test');
    assert(storage24.getPushActive() === true,
      '[24] THE BUG: once the adapter is serving, a device where push genuinely carries the notices READS as push-active. False here means the computed answer was thrown away by a swallowed write and nothing ever retried it — the in-app banner keeps firing alongside every push, forever');
  }

  // ── (c) THE RETRY IS A RE-APPLY, NOT A RECOMPUTE ─────────────────────────
  // Deliberate: a second refreshPushActiveFlag() at the serving transition
  // would race the boot tail's own call (which starts earlier but resolves
  // later — it waits on the SDK), and isPushOptedIn() resolves FALSE on a 3s
  // timeout, so the losing race writes "not push-active" over a correct "yes"
  // and hands the bug back intermittently. Proven by taking the device's push
  // support AWAY before the flush: a recompute would now answer false.
  {
    installPushActiveDevice();
    auth24._setHasSupabaseDataBackendForTest(false);
    await appMod24.refreshPushActiveFlag();
    globalThis.Notification = { permission: 'denied', requestPermission: async () => 'denied' };
    auth24._setHasSupabaseDataBackendForTest(true);
    appMod24.flushPendingPushActiveFlag('test');
    assert(storage24.getPushActive() === true,
      '[24] the flush WRITES the value the last completed computation produced; it does not ask the SDK again (a second async read at this moment is a race with the boot tail\'s, and the loser silences a working device)');
    assert(appMod24.flushPendingPushActiveFlag('test') === false,
      '[24] …and it owes nothing on a second call — one deferred write, written once');
  }

  // ── (d) FAIL-CLOSED IS DURABLE TOO (UN-N3) ───────────────────────────────
  // The opposite bug, and it is the one that silences a player: a handset whose
  // permission was revoked between sessions boots reading LAST session's true.
  // boot() clears the flag for exactly that reason — and that clear was being
  // refused by the same interlock, leaving the stale `true` in place and
  // swallowing every in-app notice on a device receiving nothing.
  {
    auth24._setHasSupabaseDataBackendForTest(false);
    globalThis.Notification = { permission: 'denied', requestPermission: async () => 'denied' };
    const computed = await appMod24.refreshPushActiveFlag();
    assert(computed === false, `[24] fixture: permission revoked, so the predicate computes push-INACTIVE (got ${computed})`);
    auth24._setHasSupabaseDataBackendForTest(true);
    if (typeof appMod24.flushPendingPushActiveFlag === 'function') appMod24.flushPendingPushActiveFlag('test');
    assert(storage24.getPushActive() === false,
      '[24] …and the fail-closed CLEAR is just as durable — a device that can no longer receive a push must go back to showing the in-app notice, or it is silenced on both surfaces at once (UN-N3)');
  }

  // ── (e) THE BOOT ORDER THAT MAKES (b) THE NORMAL CASE [structural] ───────
  {
    const bootBody24 = appSrc24.slice(appSrc24.indexOf('async function boot() {'), appSrc24.indexOf('async function runPostHydrateTail'));
    assert(/if \(isSupabaseDataMode\(\)\) \{\s*\n\s*await ensureSupabaseDataHydrated\('boot'\);\s*\n\s*await runPostHydrateTail\(\);/.test(bootBody24),
      '[24] boot() runs the post-hydrate tail UNCONDITIONALLY after the adapter hydrate [structural]');
    const ensureBody24 = appSrc24.slice(appSrc24.indexOf('async function ensureSupabaseDataHydrated('), appSrc24.indexOf('/** The landing half'));
    assert(/const leagueId = getActiveLeagueId\(\);\s*\n\s*if \(!leagueId\) return false;/.test(ensureBody24),
      '[24] …and that hydrate returns FALSE immediately when the league is not resolved yet — so the tail routinely runs while every write is refused [structural]');
    assert(/let _postHydrateTailDone = false;/.test(appSrc24) && /if \(_postHydrateTailDone\) return;/.test(appSrc24),
      '[24] …and the tail is LATCHED, so the `if (!_sbTailRan) runPostHydrateTail()` that fires when the league lands cannot re-run refreshPushActiveFlag() [structural]');

    const afterBody24 = appSrc24.slice(appSrc24.indexOf('async function afterSupabaseHydrate('), appSrc24.indexOf('function _repaintForSupabaseData('));
    assert((afterBody24.match(/flushPendingPushActiveFlag\(/g) || []).length >= 2,
      '[24] afterSupabaseHydrate() flushes the refused write on BOTH serving transitions (ACTIVE and ACTIVE-STALE) — the one place the adapter starts serving [structural]');
    // Comment lines stripped — this file's own docstring QUOTES the old line
    // verbatim to explain the defect, and a grep that cannot tell code from
    // prose would fail on the explanation of the fix.
    const code24 = appSrc24.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    assert(!/try \{ setPushActive\([^)]*\); \} catch \{\}/.test(code24),
      '[24] no call site writes the flag through a bare swallowing try/catch any more — that swallow is what made a refused write indistinguishable from a successful one [structural]');
    assert(/setPushActiveDurable\(false\);/.test(code24) && /setPushActiveDurable\(active\);/.test(code24),
      '[24] …both writers (boot\'s fail-closed clear and refreshPushActiveFlag\'s answer) go through the durable writer [structural]');
  }

  // ── (f) THE GATE ITSELF IS UNTOUCHED, IN BOTH DIRECTIONS ────────────────
  // Drew's request was to stop the banner on a device that HAS push. It was not
  // to remove the fallback for a device that does not — that stays until he
  // rules otherwise (UN-N3 fails closed, and the decision is his).
  {
    const toastFn24 = (chatUiSrc24.match(/function showToast\(msg, \{ force = false \} = \{\}\) \{[\s\S]*?\n\}/) || [''])[0];
    assert(toastFn24.length > 0, '[24] fixture: chat-ui.js showToast() body located');
    assert(/^function showToast\(msg, \{ force = false \} = \{\}\) \{\n  if \(getPushActive\(\)\) return;/.test(toastFn24),
      '[24] the push-active gate is still the FIRST statement in showToast(), ahead of the `force` escape hatch — the banner Drew actually saw ("Picks are in") is a FORCED toast, so a gate below `force` would leave exactly that one untouched');
    assert(/if \(getPushActive\(\)\) return;/.test(chatUiSrc24.slice(chatUiSrc24.indexOf('function playBlip('), chatUiSrc24.indexOf('function playBlip(') + 1200)),
      '[24] …and playBlip() still carries it too — a notification the player HEARS is one of them');
    assert(!/getPushActive/.test(appSrc24.slice(appSrc24.indexOf('function showBackendErrorBanner'), appSrc24.indexOf('function showBackendErrorBanner') + 1200)),
      '[24] the red loud-fail banner is NOT gated on push and never becomes one (AD-06) — it is not a notification surface');
  }

  // ── restore ──────────────────────────────────────────────────────────────
  auth24._setHasSupabaseDataBackendForTest(null);
  auth24.configureAuth({});
  push24._resetForTest({});
  globalThis.document = saved24.document; setNav24(saved24.navigator); globalThis.fetch = saved24.fetch;
  globalThis.matchMedia = saved24.matchMedia; globalThis.Notification = saved24.Notification;
  globalThis.PushSubscriptionOptions = saved24.PushSubscriptionOptions;
  globalThis.OneSignalDeferred = saved24.OneSignalDeferred;
}

// ═══════════════════════════════════════════════════════════════════════════
// [25] RG-179 — "it's not saving my color scheme preference when I close the
//      app."  (Drew, commissioner, live v0.22.4 on Supabase, 2026-09-19)
// ═══════════════════════════════════════════════════════════════════════════
//
// IT IS SAVING. The write lands: `setTheme()` -> `_setPlayerPref()`
// (storage.js:606-616) -> `save(cfbp_players, …)` -> the adapter's diff emits
// exactly one `league_members.preferences` patch, the server takes it, and the
// next hydrate reads it straight back (adaptertest [A-PREF] pins that half).
// Nothing about the projection, the NOT NULL rule or the RLS guard is involved.
//
// WHAT ACTUALLY FAILS IS THE RE-APPLY, and it is a boot-order cascade:
//
//   1. `applyTheme()` has exactly THREE call sites (app.js): boot()'s one-liner,
//      `resyncPlayerPreferences()`, and the dropdown's own change handler.
//   2. boot()'s call runs at app.js:1460 — long before any hydrate, and on a
//      Supabase device the Sheets snapshot prime one line above it is SKIPPED
//      on purpose (`supabaseDevice ? 0 : primeFromMirror()`, §1.5 item 1). So
//      `getTheme()` there reads an EMPTY store and can only ever answer
//      'neutral'. Same for the two toggle renders beside it, and same again on
//      the hold-recovery path, which renders both toggles BEFORE its awaited
//      `ensureSupabaseDataHydrated('hold-recovery')`.
//   3. `resyncPlayerPreferences()` — the one function whose whole job is
//      "re-apply the player's theme + timezone" — is called ONLY from the
//      PIN-era login/logout handlers and the session-expiry reconcile. None of
//      them runs on a normal Supabase boot.
//   4. So the moment the player RECORD finally arrives (afterSupabaseHydrate ->
//      _repaintForSupabaseData) nothing re-reads the preference. `refreshHeader()`
//      does not; `navigateTo()` does not.
//
// Net effect on Drew's phone: the palette he picked is sitting in
// `league_members.preferences.theme` and the app paints 'neutral' on every
// open, with the dropdown agreeing — which is indistinguishable from "it didn't
// save." The same cascade hits the timezone PILL (the times themselves recover,
// because every formatter re-reads getTimezone() at paint time — the pill is
// rendered once and never again). Dashboard column order and the chat prefs are
// NOT affected, and that is asserted below rather than assumed: both are read at
// render time, so the post-hydrate repaint already heals them.
//
// RG-177's class exactly, one layer over: a correct value, and no moment at
// which the thing that consumes it is asked again.
console.log('\n[25] RG-179 — the player\'s saved theme/timezone are re-applied when the adapter starts serving…');
{
  restoreClock();
  const { readFileSync } = await import('node:fs');
  const appMod25   = await import('./js/app.js');
  const auth25     = await import('./js/auth.js');
  const storage25  = await import('./js/storage.js');
  const sb25       = await import('./js/supabase-backend.js');
  const appSrc25   = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');

  const saved25 = { document: globalThis.document, fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const LEAGUE25 = 'L-irb';
  const ME25 = 'm-drew';

  // ── the DOM the three preference surfaces actually touch, and nothing else ──
  const store25 = new Map();
  globalThis.localStorage = {
    getItem: k => (store25.has(k) ? store25.get(k) : null),
    setItem: (k, v) => store25.set(k, String(v)),
    removeItem: k => store25.delete(k),
    clear: () => store25.clear(),
  };
  const reg25 = new Map();
  /**
   * RG-180 — THE STUB MODELS THE TWO CONTROLS, not just the markup string.
   *
   * The reviewer's note on 17b9db9 is that `renderThemeToggle()` now runs on every Realtime
   * repaint and replaced the `<select>` wholesale, closing an OPEN dropdown mid-choice. A guard
   * against that has to compare the control's LIVE `value` — which is what the player's selection
   * moves — and NOT the markup, because the `selected` attribute never moves with it and a browser
   * re-serialises innerHTML anyway. A stub that answered `querySelector() -> null` could not tell
   * a guard that works from one that never fires, so it is taught to parse what was rendered and
   * hand back stable element objects whose IDENTITY is the assertion: same object, same dropdown.
   */
  const parseControls = (html) => {
    const out = [];
    if (/<select id="theme-select"/.test(html)) {
      const options = [...html.matchAll(/<option value="([^"]+)"([^>]*)>/g)]
        .map(m => ({ value: m[1], _selected: /\bselected\b/.test(m[2] || '') }));
      const chosen = options.find(o => o._selected) || options[0];
      out.push({
        _sel: ['#theme-select', 'select'], id: 'theme-select', options,
        value: chosen ? chosen.value : '',
        addEventListener() {}, removeEventListener() {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        dataset: {},
      });
    }
    for (const m of html.matchAll(/<button class="tz-btn([^"]*)" data-tz="([^"]+)"/g)) {
      const classes = new Set(['tz-btn', ...String(m[1] || '').trim().split(/\s+/).filter(Boolean)]);
      out.push({
        _sel: ['.tz-btn', 'button'], dataset: { tz: m[2] },
        addEventListener() {}, removeEventListener() {},
        classList: {
          add: c => classes.add(c), remove: c => classes.delete(c),
          toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
          contains: c => classes.has(c),
        },
      });
    }
    return out;
  };
  const mkEl = (id) => {
    const el = {
      id, _html: '', _kids: [], hidden: false, attrs: {}, style: {},
      set innerHTML(v) { this._html = String(v); this._kids = parseControls(this._html); },
      get innerHTML() { return this._html; },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; },
      addEventListener() {}, removeEventListener() {},
      querySelector(sel) { return this._kids.find(k => k._sel.includes(sel)) || null; },
      querySelectorAll(sel) { return this._kids.filter(k => k._sel.includes(sel)); },
      appendChild(c) { return c; }, remove() { reg25.delete(id); },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    };
    reg25.set(id, el);
    return el;
  };
  const themeToggle25 = mkEl('theme-toggle');
  const tzToggle25 = mkEl('tz-toggle');
  const bodyClasses25 = new Set();
  globalThis.document = {
    hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById: id => reg25.get(id) || null,
    createElement: () => mkEl(''),
    querySelector() { return null; }, querySelectorAll() { return []; },
    // applyTheme() spreads body.classList and swaps the one `theme-*` entry, so
    // this stub has to be a real iterable set — reading it back IS the assertion.
    body: {
      appendChild(el) { return el; }, dataset: {},
      classList: {
        add: c => bodyClasses25.add(c), remove: c => bodyClasses25.delete(c),
        toggle: (c, on) => (on ? bodyClasses25.add(c) : bodyClasses25.delete(c)),
        contains: c => bodyClasses25.has(c),
        [Symbol.iterator]: () => bodyClasses25[Symbol.iterator](),
      },
    },
    head: { appendChild: el => el }, title: '',
  };
  globalThis.fetch = async () => { throw new Error('network disabled in boottest [25]'); };
  // The post-hydrate tail runs for real on this path; chat-ui's init wants one.
  if (typeof globalThis.MutationObserver !== 'function') {
    globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  }

  // ── the league, as the server holds it: Drew picked Purdue and Eastern ─────
  const MEMBER_ROW = {
    league_id: LEAGUE25, id: ME25, user_id: 'u-drew', role: 'commissioner', legacy_player_id: ME25,
    display_name: 'Drew', initials: 'DH', alma_mater: 'Iowa State', active: true,
    notify_prefs: {}, preferences: { theme: 'boilermaker', tz: 'ET', sectionOrder: { dashboard: ['standings', 'slate'] }, accent: '#7c3aed' },
    linked_at: null, extra: {}, created_at: null, updated_at: null,
  };
  const TABLES25 = ['league_kv', 'league_members', 'weeks', 'games', 'picks', 'results', 'obligations',
    'tiebreaker_guesses', 'extra_point_guesses', 'reactions', 'feedback', 'comments',
    'notifications', 'scribe_learnings', 'scribe_canon', 'scribe_reports', 'game_requests'];
  const ST25 = {};
  for (const t of TABLES25) ST25[t] = [];
  ST25.league_members = [MEMBER_ROW];
  ST25.weeks = [{ league_id: LEAGUE25, id: 'w1', sport: 'cfb', season: '2026', week_number: 1, label: 'Week 1', status: 'open', extra: {} }];

  /** A PostgREST-shaped read-only fake. Reads only: [25] never writes. */
  const CLIENT25 = {
    from(table) {
      const q = { table, filters: [] };
      const api = {
        select() { return api; },
        eq(c, v) { q.filters.push([c, v]); return api; },
        then(res, rej) {
          const rows = (ST25[q.table] || []).filter(r => q.filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return api;
    },
    rpc(name, args) {
      if (name === 'get_member_contacts') {
        return Promise.resolve({ data: ST25.league_members.filter(m => m.league_id === args.p_league)
          .map(m => ({ member_id: m.id, email: null, phone: '', phone_verified: false })), error: null });
      }
      if (name === 'week_submission_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: { code: 'P0001', message: `no rpc ${name}` } });
    },
  };

  // ── identity: signed in, memberships resolved, league pointed at ──────────
  auth25._resetAuthForTest();
  appMod25._resetSupabaseDataForTest();
  appMod25._resetAuthHoldForTest();
  sb25._resetForTest();
  auth25.configureAuth({ authMode: 'supabase', dataMode: 'supabase',
    supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
  auth25._setMembershipsForTest([{ leagueId: LEAGUE25, memberId: ME25, role: 'commissioner', displayName: 'Drew', leagueName: 'IRB Pick ’Ems' }]);
  auth25.setActiveLeagueId(LEAGUE25);
  auth25._setAccountUserIdForTest('u-drew');
  assert(auth25.getSupabaseSession()?.playerId === ME25,
    'fixture: auth.js derives the signed-in member, so getTheme()/setTheme() resolve a player record at all');

  // The adapter, wired exactly as app.js wires it except for the one client.
  sb25.init({
    register: auth25.registerSupabaseDataBackend,
    getClient: () => CLIENT25,
    getActiveLeagueId: auth25.getActiveLeagueId,
    getIdentityEpoch: auth25.getIdentityEpoch,
    getAccountUserId: auth25.getAccountUserId,
    getDeviceDataOwnerTuple: auth25.getDeviceDataOwnerTuple,
    getDeviceDataOwner: auth25.getDeviceDataOwner,
    getLeagueName: () => 'IRB Pick ’Ems',
    getLeagueNameById: () => 'IRB Pick ’Ems',
    getSession: auth25.getSupabaseSession,
    hasValidSupabaseSession: auth25.hasValidSupabaseSession,
    isPrivilegeHeld: auth25.isPrivilegeHeld,
    clearMirror: () => {}, setSiteUnlocked: () => {},
    hasSheetMirror: () => false, isSiteUnlocked: () => true,
  });
  storage25.setBackendMode('supabase');

  // ── (a) THE BOOT MOMENT — an empty store can only answer 'neutral' ────────
  {
    assert(storage25.getTheme() === 'neutral' && storage25.getTimezone() === 'PT',
      `[25] before the hydrate the seam answers the league defaults (${storage25.getTheme()}/${storage25.getTimezone()}) — which is all boot()'s one applyTheme() can ever read on a Supabase device`);
    const bootBody25 = appSrc25.slice(appSrc25.indexOf('async function boot() {'), appSrc25.indexOf('async function runPostHydrateTail'));
    assert(/const primedKeys = supabaseDevice \? 0 : primeFromMirror\(\);/.test(bootBody25),
      '[25] …and that is by design: a Supabase device deliberately primes NO Sheets snapshot before that line (§1.5 item 1) [structural]');
    // RG-198 (2026-09-21) — this read `applyTheme(getTheme())` until the device
    // hint landed. The POSITION is what this fixture is about and it has not
    // moved; the SOURCE has, because getTheme() at this point can only ever
    // answer 'neutral' on a Supabase device — which is the assertion two lines
    // above, and now also the reason bootThemeKey() exists.
    assert(/applyTheme\(bootThemeKey\(\)\); setupAutoRefresh\(\);/.test(bootBody25),
      '[25] fixture: boot() really does apply the theme at that point [structural]');
    assert(/const fromPlayer = getTheme\(\);/.test(appSrc25),
      '[25] …and bootThemeKey() still prefers the PLAYER record: the hint is a first-frame stand-in, never a second source of truth [structural]');
  }

  // ── (b) THE BOOT-TIME PAINT — what the player is actually left looking at ──
  // The mirror is EMPTY here, which is the whole point: this is the state
  // app.js:1460 and the hold-recovery path both produce on a Supabase device.
  {
    bodyClasses25.clear();
    bodyClasses25.add('theme-neutral');    // boot()'s applyTheme(getTheme()), which can only read 'neutral'
    appMod25.renderThemeToggle();
    appMod25.renderTzToggle();
    assert(/value="neutral" selected/.test(themeToggle25.innerHTML),
      '[25] fixture: the boot-time toggle render selects the DEFAULT theme, because there is no player record on the device yet');
    assert(/class="tz-btn active" data-tz="PT"/.test(tzToggle25.innerHTML),
      '[25] fixture: …and the timezone pill lights the DEFAULT zone for the same reason');
  }

  // ── (c) THE DEFECT, END TO END, THROUGH THE REAL LANDING PATH ────────────
  {
    let landed = null;
    try { landed = await appMod25._ensureSupabaseDataHydratedForTest('boot'); }
    catch (e) { landed = `threw: ${e && e.message}`; }
    assert(landed === true,
      `[25] fixture: the REAL landing path ran to the serving branch (got ${JSON.stringify(landed)}) — without this every assertion below is vacuous`);
    assert(sb25.getState() === 'ACTIVE', `fixture: the adapter is serving (state ${sb25.getState()})`);

    // THE VALUE IS SAVED, and this is the proof: it came back off the member row.
    const me = storage25.getPlayer(ME25);
    assert(me?.preferences?.theme === 'boilermaker' && me?.preferences?.tz === 'ET',
      `[25] the preference round-trips: the member row's theme and tz arrive intact on the player record (${JSON.stringify(me?.preferences || null)}) — so "it isn't saving" is a claim about the RE-APPLY, not about the write`);
    assert(storage25.getTheme() === 'boilermaker' && storage25.getTimezone() === 'ET',
      `[25] …and the seam answers them (${storage25.getTheme()}/${storage25.getTimezone()}): every ingredient of the right paint is on the device`);

    // RG-198 — AND THE DEVICE REMEMBERS IT, so the NEXT cold open paints this
    // palette on its first frame instead of neutral-then-this. Written by
    // applyTheme() itself (one place, the moment the paint actually happens),
    // which is why this lands on the adapter-serving repaint with no new call
    // site anywhere.
    assert(storage25.getThemeHint() === 'boilermaker',
      `[25] the device records the palette it just painted (hint: ${JSON.stringify(storage25.getThemeHint())}) — that recording is what makes the NEXT open's first frame right`);
    assert(bodyClasses25.has('theme-boilermaker') && !bodyClasses25.has('theme-neutral'),
      `[25] THE BUG: once the player record is serving, the page wears the player's OWN theme (body has ${JSON.stringify([...bodyClasses25])}). Leaving 'theme-neutral' on is what Drew sees on every open, and it is indistinguishable from the preference never having been saved`);
    assert(/value="boilermaker" selected/.test(themeToggle25.innerHTML),
      '[25] …and the dropdown agrees with the page. A toggle still selecting the default is the same report wearing a second costume — and a page that repainted while the control did not would be worse, not better');
    assert(/class="tz-btn active" data-tz="ET"/.test(tzToggle25.innerHTML),
      `[25] …and the timezone PILL too — same cascade, same fix. The times themselves recover on their own (every formatter re-reads getTimezone() at paint time); the pill is rendered once and never again (got ${tzToggle25.innerHTML.slice(0, 160)})`);
  }

  // ── (d) THE TWO THAT ARE *NOT* AFFECTED, stated so the row cannot overclaim ─
  {
    assert(JSON.stringify(storage25.getSectionOrder('dashboard')) === JSON.stringify(['standings', 'slate']),
      '[25] dashboard column order needs no re-apply: it is read at RENDER time, so the post-hydrate navigateTo() already heals it');
    assert(storage25.getAccent() === '#7c3aed',
      '[25] …and the chat accent likewise — read at render time by chat-ui, which initialises in the post-hydrate tail');
  }

  // ── (f) RG-180 — THE REPAINT MUST NOT REBUILD A CONTROL THE PLAYER IS USING ─
  //
  // The cost of the RG-179 fix, found at review: these two renders now run on EVERY Realtime
  // repaint (a pick, a score, anyone's edit), and both replaced their container's innerHTML
  // unconditionally. Replacing the `<select>` closes a dropdown the player has OPEN, mid-choice,
  // on a phone, for a reason they cannot see — a repaint they did not ask for eating an
  // interaction they did. Nothing may repaint unless the rendered control disagrees with the
  // value or the options.
  {
    const selBefore = themeToggle25.querySelector('#theme-select');
    const pillsBefore = tzToggle25.querySelectorAll('.tz-btn');
    assert(!!selBefore && selBefore.value === 'boilermaker' && pillsBefore.length === 4,
      `[25] fixture: the stub is modelling a live <select> (${selBefore && selBefore.value}) and ${pillsBefore.length} tz pills`);
    appMod25.renderThemeToggle();
    appMod25.renderTzToggle();
    assert(themeToggle25.querySelector('#theme-select') === selBefore,
      '[25] a repaint with nothing changed leaves the SAME <select> in the DOM — an open dropdown is not closed under the player’s finger');
    assert(tzToggle25.querySelectorAll('.tz-btn')[0] === pillsBefore[0],
      '[25] …and the same tz pills, listeners and all');

    // …and it still repaints when the value really moves, which is the whole of RG-179. Seeded
    // through the adapter's test seeder rather than setTheme(), so this asserts about the RENDER
    // and not about a write path adaptertest [A-PREF] already owns.
    const players = sb25.get('cfbp_players').map(p => (p.playerId === ME25
      ? { ...p, preferences: { ...p.preferences, theme: 'razorback', tz: 'CT' } } : p));
    sb25._seedMirrorForTest('cfbp_players', players);
    appMod25.renderThemeToggle();
    appMod25.renderTzToggle();
    const selAfter = themeToggle25.querySelector('#theme-select');
    assert(selAfter !== selBefore && selAfter.value === 'razorback',
      `[25] …but a theme that actually CHANGED still re-renders the control (${selAfter && selAfter.value})`);
    assert(tzToggle25.querySelectorAll('.tz-btn').find(b => b.classList.contains('active')).dataset.tz === 'CT',
      '[25] …and the tz pill follows the value too — the guard is "already correct", never "already rendered"');
  }

  // ── (e) THE STRUCTURE THAT KEEPS IT FIXED ───────────────────────────────
  {
    const repaintBody25 = appSrc25.slice(appSrc25.indexOf('function _repaintForSupabaseData(reason) {'),
      appSrc25.indexOf('export function _resetSupabaseDataForTest'));
    assert(/applyTheme\(getTheme\(\)\)/.test(repaintBody25),
      '[25] the adapter-serving repaint re-applies the theme — this is the ONE place on a Supabase boot where the player record is known to exist [structural]');
    assert(/renderThemeToggle\(\)/.test(repaintBody25) && /renderTzToggle\(\)/.test(repaintBody25),
      '[25] …and re-renders both preference controls with it, so the page and the control can never disagree [structural]');
    const ensureBody25 = appSrc25.slice(appSrc25.indexOf('async function ensureSupabaseDataHydrated('), appSrc25.indexOf('/** The landing half'));
    assert(/_repaintForSupabaseData\('snapshot'\)/.test(ensureBody25),
      '[25] …and the device-snapshot prime goes through the same function, so a warm open paints the right palette on the FIRST frame rather than after the network [structural]');
    const code25 = appSrc25.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    const applyCalls25 = (code25.match(/(?<!function )\bapplyTheme\(/g) || []).length;
    assert(applyCalls25 === 4,
      `[25] applyTheme() has exactly four CALL sites — boot, resyncPlayerPreferences, the dropdown, and the adapter repaint (found ${applyCalls25}). A fifth means somebody added a second re-apply path instead of using this one [structural]`);
    assert(!/resyncPlayerPreferences\(\);\s*$/m.test(repaintBody25),
      '[25] …and the repaint does NOT call resyncPlayerPreferences(): that function also nulls state.layoutEditing and re-runs the OneSignal login, and a visibilitychange re-hydrate would then cancel an in-progress layout edit [structural]');
  }

  // ── restore ─────────────────────────────────────────────────────────────
  sb25._resetForTest();
  storage25.setBackendMode('local');
  auth25.configureAuth({});
  auth25._resetAuthForTest();
  appMod25._resetSupabaseDataForTest();
  globalThis.document = saved25.document;
  globalThis.fetch = saved25.fetch;
  globalThis.localStorage = saved25.localStorage;
}

// ═══════════════════════════════════════════════════════════════════════════
// [26] REVIEWER N1 — a HELD-OFFLINE write had a banner written for it and no
//      renderer to put it on screen (RG-180 follow-up, 2026-09-19)
// ═══════════════════════════════════════════════════════════════════════════
//
// The adapter does the honest half. When a write never reaches the server it emits
// `'offline'` with `heldOffline` (the keys that did not go), `pendingWrites`, and a
// `banner` reading "Couldn't reach the server. N changes still to save — they'll go
// out when you're back on the network." (supabase-backend.js, the `heldOffline.size`
// branch of `_runFlush()`; adaptertest [A-FLUSH4] asserts that shape against the real
// adapter, which is what stops this section testing a message nobody sends).
//
// `onSupabaseDataStatus()` threw it away. `status === 'offline'` arrives with
// `state: 'ACTIVE'` — the league is loaded and readable; it is the WRITE that is
// stuck — so the OFFLINE-READONLY branch did not match, and the very next line
// called `hideSupabaseOfflineBanner()` and fell through to the end of the function.
// Net effect on a phone in a stadium: the badge flips to 📴 and nothing else
// happens. The pick is in a queue, `_persistSnapshot()` refuses to write the
// snapshot while anything is dirty, and if iOS reaps the PWA the pick is gone with
// no record that it ever existed and no moment at which the player was told.
//
// The banner is AMBER (DI-180c's weight classes): nothing was refused and sync is
// not broken — the device is off the network holding work it still means to send.
// Red stays reserved for a refusal and for sync being off.
console.log('\n[26] RG-180 follow-up — a write held offline puts the adapter\'s own words on screen…');
{
  restoreClock();
  const appMod26 = await import('./js/app.js');
  const saved26 = { document: globalThis.document };

  // A DOM stub small enough to read: a registry keyed by id, so `getElementById`
  // can find a node `createElement` made and `appendChild` attached — which is the
  // exact sequence both banner helpers use.
  const reg26 = new Map();
  const mkEl26 = () => {
    const el = {
      _id: '', className: '', _html: '', style: {}, textContent: '', _kids: [],
      get id() { return this._id; },
      set id(v) { this._id = String(v); if (this._id) reg26.set(this._id, this); },
      set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
      setAttribute() {}, getAttribute() { return null; },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { this._kids.push(c); if (c && c._id) reg26.set(c._id, c); return c; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      remove() { if (this._id) reg26.delete(this._id); },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    };
    return el;
  };
  globalThis.document = {
    hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById: id => reg26.get(id) || null,
    createElement: () => mkEl26(),
    querySelector() { return null; }, querySelectorAll() { return []; },
    body: { appendChild(el) { if (el && el._id) reg26.set(el._id, el); return el; }, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
    head: { appendChild: el => el }, title: '',
  };

  const offline26 = () => reg26.get('supabase-offline-banner') || null;
  const red26 = () => reg26.get('backend-error-banner') || null;
  // The detail the adapter really emits (adaptertest [A-FLUSH4] pins these field names).
  const HELD_TEXT = 'Couldn’t reach the server. 2 changes still to save — they’ll go out when you’re back on the network.';
  const HELD_DETAIL = {
    state: 'ACTIVE', error: HELD_TEXT, heldOffline: ['cfbp_picks', 'cfbp_tiebreaker_guesses'],
    pendingWrites: 2, banner: HELD_TEXT,
  };

  appMod26._onSupabaseDataStatusForTest('offline', HELD_DETAIL);
  const banner26 = offline26();
  assert(!!banner26, '[26] a held-offline write puts a banner on screen at all — the defect was that it did not');
  assert(!!banner26 && banner26.innerHTML.includes('still to save'),
    `[26] …carrying the ADAPTER's own words, including how many changes are queued (${banner26 ? banner26.innerHTML : 'no banner'})`);
  assert(!!banner26 && /auth-banner-offline/.test(banner26.className),
    `[26] …in the AMBER weight class, not the red one (class "${banner26 ? banner26.className : ''}")`);
  assert(!red26(), '[26] …and the red AD-06 sync banner stays down: nothing was refused and sync is not broken');

  // IT COMES DOWN WHEN THE HELD WRITES LAND. 'synced' is what the adapter emits once the queue
  // drains, and the banner must not outlive the condition it describes.
  appMod26._onSupabaseDataStatusForTest('synced', { state: 'ACTIVE', pushed: 2, pendingWrites: 0 });
  assert(!offline26(), '[26] …and it is cleared the moment the held writes go out');

  // ══ RG-202 gate, reviewer note 3 (2026-09-20) — 'syncing' MUST NOT CLEAR THE AMBER BANNER ══
  //
  // This assertion used to read `!offline26()` — "a retry attempt takes it down while the attempt
  // is in flight". That was defensible while 'syncing' meant only "a flush has just started".
  // RG-202's bounded write retry emits 'syncing' AGAIN for every backoff attempt, so the amber
  // held-offline banner went down and stayed down for the whole schedule while the player's picks
  // were still queued — the banner disappearing is indistinguishable, on screen, from the queue
  // having drained. Only evidence that the queue is EMPTY may take it down, and the only status
  // that carries that evidence is 'synced' (asserted above) or a 'syncing' that says so.
  appMod26._onSupabaseDataStatusForTest('offline', HELD_DETAIL);
  assert(!!offline26(), '[26] fixture — the amber banner is up before the retry attempt');
  appMod26._onSupabaseDataStatusForTest('syncing', { state: 'ACTIVE', pendingWrites: 2 });
  assert(!!offline26(),
    `[26] a retry attempt does NOT take the amber banner down while its keys are still queued (${offline26() ? 'up' : 'gone'})`);
  appMod26._onSupabaseDataStatusForTest('syncing',
    { state: 'ACTIVE', retrying: ['cfbp_picks'], attempt: 2, maxAttempts: 3, pendingWrites: 1 });
  assert(!!offline26(),
    `[26] …and neither does the RG-202 retry status, which names what it is still holding (${offline26() ? 'up' : 'gone'})`);
  // …but a 'syncing' that reports an EMPTY queue may: that is a hydrate starting on a device with
  // nothing pending, and leaving the banner up would be the opposite error.
  appMod26._onSupabaseDataStatusForTest('syncing', { state: 'ACTIVE', pendingWrites: 0 });
  assert(!offline26(), '[26] …while a syncing status reporting an EMPTY queue does take it down');

  // A RETRY THAT FAILS AGAIN RE-RAISES IT, with the new count — the adapter re-emits on every
  // failed flush, and a renderer that only showed it once would go quiet on the second failure.
  appMod26._onSupabaseDataStatusForTest('offline', { ...HELD_DETAIL, heldOffline: ['cfbp_picks'], pendingWrites: 1,
    banner: 'Couldn’t reach the server. 1 change still to save — they’ll go out when you’re back on the network.' });
  assert(!!offline26() && /1 change still to save/.test(offline26().innerHTML),
    `[26] …and comes back with the new count when it fails again (${offline26() ? offline26().innerHTML : 'no banner'})`);

  // NO REGRESSION ON §5.3. OFFLINE-READONLY is a different state with different copy — the league
  // itself is being served from the device snapshot — and it must still get its own wording.
  appMod26._onSupabaseDataStatusForTest('offline', { state: 'OFFLINE-READONLY', heldOffline: [], pendingWrites: 0 });
  assert(!!offline26() && /Showing your league/.test(offline26().innerHTML),
    `[26] the §5.3 read-only banner still says what IT says (${offline26() ? offline26().innerHTML : 'no banner'})`);

  // AND A REFUSAL IS STILL RED. The two paths share a status channel and must not share a voice.
  appMod26._onSupabaseDataStatusForTest('refused', { state: 'ACTIVE', keys: ['cfbp_picks'],
    banner: 'The server refused to save cfbp_picks: permission denied. Nothing was saved.' });
  assert(!!red26() && /Nothing was saved/.test(red26().innerHTML),
    '[26] a REFUSAL is still the red banner, in the server’s own words (AD-06 stays loud)');

  globalThis.document = saved26.document;
}

// ═══════════════════════════════════════════════════════════════════════════
// [31] RG-199 / RG-200 — THE POST-v0.23.3 DESKTOP LOCKOUT, AND THE THIRD PAINT
//      (2026-09-21, minutes after v0.23.3 went live)
// ═══════════════════════════════════════════════════════════════════════════
//
// Drew, on the laptop: "One moment / Couldn't load your league. Nothing has
// changed — retry in a moment." Steady state. Survives a hard reload. Retry does
// nothing. The SAME account on the iPhone is fine. And on both: "it still loads
// through the blue neutral colors" before the right palette arrives.
//
// ── (A) RG-199 — A REJECTED TOKEN WEARING A DATA PROBLEM'S COSTUME ──────────
//
// THE CHAIN, and note that every link is v0.23.3's:
//
//  1. RG-194 gave "not resolved yet" its own arm: `hasPersistedSupabaseSession()`
//     -> armSignInGateDeadline() instead of showGoogleSignInGate() (app.js:1072).
//     That predicate only asks whether a session record with a refresh_token
//     STRING is on the device. It cannot ask whether the token still WORKS —
//     only the server can, which is the comment's own caveat.
//  2. So a device holding a DEAD refresh token (the laptop: signed out and in
//     repeatedly that day, rotating the saved one into uselessness) paints no
//     gate at all and — because the membership refresh below it is guarded on
//     `hasValidSupabaseSession()` — kicks off no session work either.
//  3. boot() walks straight into `await ensureSupabaseDataHydrated('boot')`.
//     Its only entry guard is `if (!leagueId) return false`, and
//     getActiveLeagueId() is a PERSISTED localStorage read (auth.js:1576) — so
//     on every returning device the league IS known and the hydrate RUNS,
//     against a token the server is going to reject.
//  4. The adapter does its half correctly: PGRST301/401 classifies as 'session',
//     it goes HELD, and it emits `error` with `sessionSuspect: true`
//     (supabase-backend.js:1198, :1245, :1253).
//  5. app.js drops that flag on the floor. onSupabaseDataStatus() consumes its
//     TWIN, `membershipSuspect` (app.js:1404), and nothing anywhere reads
//     `sessionSuspect`. So afterSupabaseHydrate()'s fallback finds no reason set
//     and stamps the GENERIC one: showAuthHoldGate('data-hold') (app.js:1583).
//  6. And 'data-hold' then latches out every remedy the player has:
//        • fireSignInGateDeadline()  — `if (currentAuthHoldReason()) return;`
//        • the SIGNED_OUT paint      — `&& !currentAuthHoldReason()`
//        • Retry                     — AUTH_HOLD_RECOVERY['data-hold'] is
//          'adapter-hydrate', which re-hydrates with the same dead token and
//          never reaches applyAuthModeDecision(), i.e. never paints a gate.
//     A dead end, on the one screen whose entire job is to offer a way out.
//
// 'session-expired' was always the right label — it is the hold that carries the
// Sign In affordance (DI-180d/A8), and refreshAuthUI() already raises exactly
// that pair on MEMBERSHIPS_FAILED{expired}. The bug is not that the gate exists;
// it is that a rejected identity was reported as a missing league.
//
// ── (B) RG-200 — "maroon then blue then maroon" ─────────────────────────────
//
// RG-198 added the device palette hint and taught TWO readers about it:
// index.html's inline bootstrap and bootThemeKey(). It did NOT teach the third.
// _repaintForSupabaseData() — which runs on the snapshot prime, on every
// hydrate landing and on every Realtime repaint — still calls
// `applyTheme(getTheme())` (app.js:1626, the RG-179 line). getTheme() reads the
// PLAYER record, and on any repaint that lands before the member row is
// readable it can only answer the league default. So the correct first frame
// gets neutral stamped over it, and the next repaint puts the palette back.
// Three paints, in exactly the order Drew reported.
console.log('\n[31] RG-199/RG-200 — a rejected token is not a missing league, and a repaint must not un-paint the hint…');
{
  restoreClock();
  const { readFileSync: rf31 } = await import('node:fs');
  const appSrc31 = rf31(new URL('./js/app.js', import.meta.url), 'utf8');
  const appMod31 = await import('./js/app.js');
  const auth31 = await import('./js/auth.js');
  const sb31 = await import('./js/supabase-backend.js');
  const storage31 = await import('./js/storage.js');
  const saved31 = { document: globalThis.document, fetch: globalThis.fetch };

  const reg31 = new Map();
  const bodyClasses31 = new Set();
  const mkEl31 = (id = '') => {
    const el = {
      _id: id, className: '', _html: '', style: {}, textContent: '', disabled: false,
      get id() { return this._id; },
      set id(v) { this._id = String(v); if (this._id) reg31.set(this._id, this); },
      set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      addEventListener() {}, removeEventListener() {}, focus() {},
      appendChild(c) { if (c && c._id) reg31.set(c._id, c); return c; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      remove() { if (this._id) reg31.delete(this._id); },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    };
    if (id) reg31.set(id, el);
    return el;
  };
  globalThis.document = {
    hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById: id => reg31.get(id) || null,
    createElement: () => mkEl31(''),
    querySelector() { return null; }, querySelectorAll() { return []; },
    body: {
      appendChild(el) { if (el && el._id) reg31.set(el._id, el); return el; }, dataset: {},
      setAttribute() {}, removeAttribute() {},
      classList: {
        add: c => bodyClasses31.add(c), remove: c => bodyClasses31.delete(c),
        toggle: (c, on) => (on ? bodyClasses31.add(c) : bodyClasses31.delete(c)),
        contains: c => bodyClasses31.has(c),
        [Symbol.iterator]: () => bodyClasses31[Symbol.iterator](),
      },
    },
    head: { appendChild: el => el }, title: '',
  };
  globalThis.fetch = async () => { throw new Error('network disabled in boottest [31]'); };

  const LEAGUE31 = 'lg-irb';
  const ME31 = 'p-drew';

  // ── (A) THE LOCKOUT ──────────────────────────────────────────────────────
  //
  // A PostgREST client that answers every read the way a server answers a
  // rejected token. This is the ONLY thing different about Drew's laptop.
  const CLIENT31 = {
    from() {
      const api = {
        select() { return api; }, eq() { return api; },
        then(res, rej) {
          return Promise.resolve({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } })
            .then(res, rej);
        },
      };
      return api;
    },
    rpc() { return Promise.resolve({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }); },
  };

  auth31._resetAuthForTest();
  appMod31._resetSupabaseDataForTest();
  appMod31._resetAuthHoldForTest();
  sb31._resetForTest();
  sb31.init({
    register: auth31.registerSupabaseDataBackend,
    getClient: () => CLIENT31,
    getActiveLeagueId: auth31.getActiveLeagueId,
    getIdentityEpoch: auth31.getIdentityEpoch,
    getAccountUserId: auth31.getAccountUserId,
    getDeviceDataOwnerTuple: auth31.getDeviceDataOwnerTuple,
    getDeviceDataOwner: auth31.getDeviceDataOwner,
    getLeagueName: () => 'IRB Pick ’Ems',
    getLeagueNameById: () => 'IRB Pick ’Ems',
    getSession: auth31.getSupabaseSession,
    hasValidSupabaseSession: auth31.hasValidSupabaseSession,
    isPrivilegeHeld: auth31.isPrivilegeHeld,
    clearMirror: () => {}, setSiteUnlocked: () => {},
    hasSheetMirror: () => false, isSiteUnlocked: () => true,
  });
  auth31.configureAuth({ authMode: 'supabase', dataMode: 'supabase',
    supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon', authModeKnown: true });
  // THE LAPTOP, EXACTLY: memberships cached from a previous session and the
  // league pointer persisted (both device-local), but NOTHING has proven an
  // identity on this page — the access token is gone and no auth event has
  // landed yet. This is the state RG-194's new arm leaves boot() in.
  auth31._setMembershipsForTest([{ leagueId: LEAGUE31, memberId: ME31, role: 'commissioner',
    displayName: 'Drew', leagueName: 'IRB Pick ’Ems' }]);
  auth31.setActiveLeagueId(LEAGUE31);
  auth31._setAccountUserIdForTest('');
  storage31.setBackendMode('supabase');

  assert(auth31.hasValidSupabaseSession() === false && !auth31.getAccountUserId(),
    '[31] fixture: no identity has been proven on this page — the access token is not fresh and no auth event has landed');
  assert(auth31.getActiveLeagueId() === LEAGUE31,
    '[31] fixture: …but the league pointer IS on the device, which is why the leagueId guard lets the hydrate through');

  // (A1) THE GUARD. A hydrate under an identity nobody has proven can only
  // fail, and its failure is the thing that latches the lockout. It must not be
  // attempted — symmetrically with the `!leagueId` return one line above it,
  // and for the same reason: the event that makes us ready calls back
  // (refreshAuthUI's MEMBERSHIPS_REFRESHED/SIGNED_IN/SESSION_REVERIFIED arm).
  {
    let landed = null;
    try { landed = await appMod31._ensureSupabaseDataHydratedForTest('boot'); }
    catch (e) { landed = `threw: ${e && e.message}`; }
    assert(landed === false,
      `[31-A1] the boot hydrate does not report success while no identity is proven (got ${JSON.stringify(landed)})`);
    // THE ASSERTION THAT MATTERS: it was never ATTEMPTED. `false` alone is what
    // the defect already returns — after asking the server, being refused, and
    // going HELD. IDLE is the difference between deferring and failing.
    assert(sb31.getState() === 'IDLE',
      `[31-A1] …because it was never ATTEMPTED (adapter state ${sb31.getState()}, expected IDLE). A hydrate under an unproven identity can only be refused, and being refused is what raises the gate`);
    assert(appMod31.currentAuthHoldReason() !== 'data-hold',
      `[31-A1] …so the player is NOT told their league is missing (hold reason ${JSON.stringify(appMod31.currentAuthHoldReason())}). 'data-hold' here is the lockout: fireSignInGateDeadline(), the SIGNED_OUT paint and Retry all refuse over a hold, so there is no way back to Sign In`);
  }

  // (A1b) DREW'S LAPTOP, EXACTLY AS THE DUMP FOUND IT. No session record at
  // ALL — no access token, no refresh token — and a PERSISTED active league.
  // applyAuthModeDecision() paints the Google gate immediately on that state
  // (hasPersistedSupabaseSession() is false), and the defect was that boot()
  // then hydrated on the league pointer's strength and painted 'data-hold'
  // straight over it. showAuthHoldGate() only REUSES an overlay that is already
  // a hold, so the sign-in gate is replaced rather than kept — after which the
  // deadline, the SIGNED_OUT paint and Retry all refuse over the hold.
  //
  // Driven at the RAISE SITE, because the tick and Retry reach it too: even if
  // something does hydrate, the label must not be 'data-hold' when nobody is
  // proven.
  {
    appMod31._resetAuthHoldForTest();
    sb31._resetForTest();
    reg31.clear();
    appMod31.showGoogleSignInGate();          // what the auth decision paints on this state
    assert(!!reg31.get('site-gate-overlay'),
      '[31-A1b] fixture: the sign-in gate is up, which is what a device with no session record gets');
    // The hold the failed hydrate used to raise, through the real gate function.
    appMod31.showAuthHoldGate('data-hold');
    assert(appMod31.currentAuthHoldReason() === 'data-hold',
      '[31-A1b] fixture: …and a data hold really does take it over (this is the replacement that locked the laptop)');
    // THE INVARIANT: the hydrate landing must not be able to leave that in place.
    let landed31b = null;
    try { landed31b = await appMod31._ensureSupabaseDataHydratedForTest('tick'); }
    catch (e) { landed31b = `threw: ${e && e.message}`; }
    assert(landed31b === false, `[31-A1b] fixture: the hydrate did not serve (got ${JSON.stringify(landed31b)})`);
    // NOTE WHAT THIS DOES *NOT* ASSERT, because the distinction is the finding.
    // The deferral means the landing path is never reached, so nothing on this
    // route CLEARS a hold that is already up. That is correct and sufficient in
    // production — `_authHoldReason` is page-lifetime, so a reload starts clean,
    // and the 20-second re-check now escapes it (A1c). The raise-site guard
    // below is defence in depth for the one case the deferral cannot cover: the
    // session being destroyed DURING an awaited hydrate that started legitimately.
    // That race cannot be driven from this fixture, so it is asserted where it
    // lives rather than pretended to be exercised.
    const landingBody31 = appSrc31.slice(appSrc31.indexOf('async function afterSupabaseHydrate('),
      appSrc31.indexOf('function _repaintForSupabaseData('));
    assert(/fallbackReason === 'data-hold' && noIdentityEverProven\(\)/.test(landingBody31),
      '[31-A1b] a data hold is REFUSED at the raise site when nobody is proven — the label claims "the player IS proven, the league is missing", which is false here and dead-ends the one control on the screen [structural]');
    assert(/if \(!document\.getElementById\('site-gate-overlay'\)\) showGoogleSignInGate\(\);/.test(landingBody31),
      '[31-A1b] …and what goes up instead is the sign-in gate — without replacing one somebody else already painted (S-1) [structural]');
  }

  // (A1c) RETRY MUST BE ABLE TO ESCAPE. AUTH_HOLD_RECOVERY routes a data hold
  // to the adapter, which re-asks the server with whatever credentials exist
  // and never reaches applyAuthModeDecision() — so with the identity gone, the
  // Retry button was structurally incapable of painting the gate that fixes it.
  {
    const holdBody31 = appSrc31.slice(appSrc31.indexOf('export async function runAuthHoldCheck('),
      appSrc31.indexOf('let ok = false;'));
    assert(/AUTH_HOLD_RECOVERY\[_authHoldReason\] === 'adapter-hydrate' && !noIdentityEverProven\(\)/.test(holdBody31),
      '[31-A1c] Retry only re-hydrates while an identity IS proven; with the identity gone it falls through to the AUTH decision, which is the only path that can paint a sign-in gate [structural]');
  }

  // (A2) THE LABEL. Whatever the ordering, if the adapter ever DOES come back
  // having had its token rejected, the flag it emits must reach the gate. The
  // adapter's own half is pinned by adaptertest; this is the app-side half that
  // was missing, driven through the real status handler.
  {
    appMod31._resetAuthHoldForTest();
    appMod31._onSupabaseDataStatusForTest('error', {
      state: 'HELD', error: 'Couldn’t load your league. Nothing has changed — retry in a moment.',
      sessionSuspect: true, membershipSuspect: false,
      banner: 'Couldn’t load your league. Nothing has changed — retry in a moment.',
    });
    assert(appMod31.currentAuthHoldReason() === 'session-expired',
      `[31-A2] a rejected TOKEN raises the hold that offers Sign In, not the generic data hold (got ${JSON.stringify(appMod31.currentAuthHoldReason())}) — 'session-expired' is the only one of the two the player can act on`);
  }

  // (A3) …and the precedence chain then PRESERVES it. afterSupabaseHydrate()'s
  // fallback is `currentAuthHoldReason() || _sbHoldRetryReason || 'data-hold'`
  // (reviewer F-B's three-term order). Feeding it the fact it was missing is
  // the whole fix; this asserts the order it depends on is still there.
  {
    const afterBody31 = appSrc31.slice(appSrc31.indexOf('async function afterSupabaseHydrate('),
      appSrc31.indexOf('function _repaintForSupabaseData('));
    assert(/currentAuthHoldReason\(\) \|\| _sbHoldRetryReason \|\| 'data-hold'/.test(afterBody31),
      '[31-A3] the fallback still asks for a more specific reason FIRST, so a session hold raised during the hydrate survives (reviewer F-B\'s three-term order) [structural]');
    assert(/if \(detail\.sessionSuspect\)/.test(appSrc31),
      '[31-A3] …and the adapter\'s sessionSuspect flag is actually consumed somewhere, not emitted into nothing [structural]');
  }

  // ── (B) THE THIRD PAINT ──────────────────────────────────────────────────
  {
    appMod31._resetAuthHoldForTest();
    sb31._resetForTest();                 // back to IDLE: the mirror answers nothing
    storage31.setBackendMode('supabase');
    // The hint is what a PREVIOUS session recorded, when the adapter was
    // serving. It is placed on the device directly rather than through
    // setThemeHint() because SEC F1's write interlock refuses EVERY write —
    // device-local keys included — while the adapter is not serving, which is
    // precisely why applyTheme()'s own hint write is wrapped in a catch. The
    // subject of this fixture is the READ path, so the recording is a given.
    // KEYS.THEME_HINT is device-local, so this is the same byte the seam reads.
    localStorage.setItem('cfbp_theme_hint', JSON.stringify('razorback')); // MAROON

    assert(storage31.getThemeHint() === 'razorback',
      '[31-B] fixture: the device remembers the palette it last painted (RG-198\'s hint, device-local so it is readable with no adapter)');
    assert(storage31.getTheme() === 'neutral',
      `[31-B] fixture: …while getTheme() — the PLAYER record — can only answer the league default here (${storage31.getTheme()}), because the member row is not readable until the adapter serves`);
    assert(appMod31._bootThemeKeyForTest() === 'razorback',
      `[31-B] fixture: bootThemeKey() is the reader that knows the difference (got ${appMod31._bootThemeKeyForTest()}) — the player record when there is one, the hint when there is not`);

    // THE BUG, as a source fact: the repaint reaches for the accessor that
    // cannot answer yet, so it repaints NEUTRAL over a correct first frame.
    const repaintBody31 = appSrc31.slice(appSrc31.indexOf('function _repaintForSupabaseData(reason) {'),
      appSrc31.indexOf('function _resetSupabaseDataForTest'));
    assert(repaintBody31.length > 0, '[31-B] fixture: _repaintForSupabaseData() was located in the source [structural]');
    assert(/applyTheme\(bootThemeKey\(\)\)/.test(repaintBody31),
      '[31-B] THE BUG: the post-hydrate repaint applies bootThemeKey(), not the raw getTheme(). Every repaint that lands before the member row is readable — the snapshot prime, an ACTIVE-STALE landing, a Realtime tick — otherwise stamps \'theme-neutral\' over the hint\'s correct first frame, which is Drew\'s "maroon then blue then maroon" [structural]');
    assert(!/applyTheme\(getTheme\(\)\); renderThemeToggle\(\)/.test(repaintBody31),
      '[31-B] …and the RG-179 line that could only ever answer the league default is gone from that path [structural]');
  }

  // ── (C) RG-201 — THE HINT MUST ONLY RECORD A *PLAYER-DERIVED* PALETTE ────
  //
  // Drew's laptop dump read `cfbp_theme_hint: "neutral"`, and the hint's whole
  // job is to make the NEXT cold open's first frame right. 'neutral' is the
  // league default — the answer getTheme() gives when NOBODY IS SIGNED IN
  // (js/storage.js: `_playerPref('theme') || 'neutral'`, and _playerPref()
  // returns undefined with no session). So a recorded 'neutral' is not a
  // preference; it is the absence of one, written down as though it were.
  //
  // THE WRITE PATH, which the first pass of this fix looked for and missed:
  //   resyncPlayerPreferences()  ->  applyTheme(getTheme())
  // resync is the app's ONE chokepoint on every session change and it runs on
  // every logout AND on every session expiry (the reconcile's call). At that
  // instant getTheme() answers 'neutral', applyTheme() records it, and the
  // device's memory of its own palette is destroyed — so the next cold open
  // paints neutral on its first frame no matter how correct the READER is.
  // That is why RG-200 alone did not stop Drew booting blue.
  //
  // WHY THE FIRST ATTEMPT AT THIS TEST WAS VACUOUS, recorded because it is the
  // more useful half: it drove applyTheme() with the adapter IDLE, where
  // save() throws AuthModeMismatchError and applyTheme()'s own catch swallows
  // it — the hint survived with or without a guard, and the mutation proof
  // caught the false green. `isSupabaseWriteWithheld()` is
  // `authMode === 'supabase' && !hasSupabaseDataBackend()`, so the write lands
  // whenever the adapter IS serving, which is exactly the state a live session
  // expires in. The mechanism is mode-independent, so it is driven here in the
  // simplest mode that has no interlock at all — pins/local, where the write
  // always lands and the defect is therefore unmistakable.
  {
    appMod31._resetAuthHoldForTest();
    auth31._resetAuthForTest();
    auth31.configureAuth({ authMode: 'pins', dataMode: 'sheets', authModeKnown: true });
    storage31.setBackendMode('local');
    localStorage.setItem('cfbp_players', JSON.stringify([
      { playerId: 'p-drew', name: 'Drew', preferences: { theme: 'razorback' } },
    ]));
    localStorage.removeItem('cfbp_theme_hint');
    storage31.setSession('p-drew', true, true);

    // (i) SIGNED IN: the palette IS player-derived, so it is recorded. Without
    //     this the assertion below could pass on a hint that was never written.
    assert(storage31.getTheme() === 'razorback',
      `[31-C] fixture: signed in, the player record supplies the palette (${storage31.getTheme()})`);
    appMod31._applyThemeForTest(storage31.getTheme());
    assert(storage31.getThemeHint() === 'razorback',
      `[31-C] fixture: …and THAT is recorded as the device's hint (${JSON.stringify(storage31.getThemeHint())}) — the write still works, which is what makes the next step a real test`);

    // (ii) THE SESSION ENDS — a logout, or the expiry reconcile. resync's exact
    //      call, with the value getTheme() actually returns at that moment.
    storage31.clearSession();
    assert(storage31.getTheme() === 'neutral',
      '[31-C] fixture: signed out, getTheme() is the league default BY DESIGN (UN-127) — it is not a palette anybody chose');
    appMod31._applyThemeForTest(storage31.getTheme());

    assert(storage31.getThemeHint() === 'razorback',
      `[31-C] THE BUG: a session ending must NOT overwrite the device's palette memory with the signed-out default (hint is ${JSON.stringify(storage31.getThemeHint())}, expected "razorback"). Recording the absence of a preference as though it were one is what makes the NEXT cold open boot blue — the reader fix in (B) cannot help a hint that is already poisoned.`);
    assert(bodyClasses31.has('theme-neutral'),
      '[31-C] …and it still PAINTS neutral, correctly: signed out IS neutral. The guard is on the RECORDING, never on the pixel');

    // (iii) STRUCTURAL — the call site this is about really is what resync does.
    const resyncBody31 = appSrc31.slice(appSrc31.indexOf('function resyncPlayerPreferences('),
      appSrc31.indexOf('export function renderThemeToggle'));
    assert(resyncBody31.length > 0 && /applyTheme\(getTheme\(\)\)/.test(resyncBody31),
      '[31-C] fixture: resyncPlayerPreferences() really does re-apply getTheme() — the value that is \'neutral\' for every signed-out caller [structural]');
  }

  globalThis.document = saved31.document;
  globalThis.fetch = saved31.fetch;
}

// ── Summary ──────────────────────────────────────────────────────────────────
restoreClock();
// REVIEWER F8 (sixth gate) — write-then-exit-in-the-callback. `console.log()`
// followed by `process.exit()` is a race whenever stdout is a pipe (loadtest's
// spawnSync, any `| grep`): the buffered write is asynchronous and exit does not
// flush it, so the one line the parent suite parses can be dropped. See
// authtest.mjs's fuller note at the same place.
process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.exit(fail === 0 ? 0 : 1));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ──────────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
