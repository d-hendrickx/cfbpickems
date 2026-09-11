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
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
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

  // What app.js puts in FRONT of that, today: the chat subscription is not
  // started until `await hydrateBackend()` resolves (js/app.js:294 -> :319).
  // Reported to Drew, not fixed here — app.js is outside this agent's files.
  const { readFileSync } = await import('node:fs');
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const hydrateAt = appSrc.indexOf('await hydrateBackend()');
  const initChatAt = appSrc.indexOf('initChatUI()');
  note(`js/app.js boot order today: hydrate at char ${hydrateAt}, initChatUI at char ${initChatAt}` +
       ` — chat starts ${initChatAt > hydrateAt ? 'AFTER' : 'BEFORE'} the getAll completes`);
  note('  so the first chatSince is issued only after getAll returns: + one full Apps Script');
  note('  cold start (modelled 8s; 3 misroute attempts would make it ~26s) before anything above starts.');
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

// ── Summary ──────────────────────────────────────────────────────────────────
restoreClock();
console.log('\n' + '─'.repeat(70));
console.log(`${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
console.log('─'.repeat(70));
process.exit(fail === 0 ? 0 : 1);
