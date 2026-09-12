/**
 * chatTransport.js — v0.17.0
 * ============================
 * THE ONLY module that talks to the chat backend. (AD-16: transport isolation.)
 * Exposes exactly the interface from the revised chat spec:
 *
 *   appendEvents(events)   -> { assigned:[{id,seq,ts}], head }
 *   fetchSince(seq, limit) -> { events, head }
 *   fetchBefore(seq,limit) -> { events }
 *   fetchHead()            -> { head }
 *   subscribe(onEvents)    -> unsubscribe()          (polling impl today; websocket later)
 *
 * No other module may reference Apps Script URLs, sheet names, or polling
 * mechanics. Swapping this file for a Supabase implementation is the entire
 * client-side migration.
 *
 * DI-168 (2026-09-11) — subscribe()'s return value gained a second capability,
 * a player-triggered forced poll. It is STILL directly callable as a bare
 * unsubscribe function (every existing caller, incl. boottest.mjs, does
 * exactly that) — it also carries `.unsubscribe` (itself) and `.forceTick()`
 * as properties, so a caller that wants the second capability can destructure
 * `{ unsubscribe, forceTick } = subscribe(...)` instead. See the DI-168f
 * comment on subscribe() itself for why both shapes coexist on one function.
 *
 * v0.17.2 — presence removed (AD-19 amended). The `heartbeat()` method is gone
 * from this interface; the server's `presence` endpoint stays deployed but is
 * never called. Do not re-add a heartbeat without re-opening AD-19.
 *
 * Transport details (Apps Script implementation):
 *  - Reads (head/since/before/metrics) go over GET with query params —
 *    simple requests, no CORS preflight, and they hit the server-side
 *    CacheService fast paths.
 *  - Writes (append) go over POST with Content-Type text/plain — the same
 *    preflight-free pattern the picks sync has used in production since v0.15.
 *  - STALE-DEPLOYMENT DETECTION (the v0.16 chat-outage root cause): if the
 *    deployed Apps Script predates the chat endpoints, every call returns
 *    `Unknown action: …`. We classify that specific failure so the UI can say
 *    "redeploy Code.gs" instead of a generic offline banner.
 */

import { getBackendConfig, isBackendConfigured, requestWithMisrouteGuard } from './backend.js';

/**
 * BUG-A (2026-09-11) — this module has its OWN fetch calls (get/post below), so
 * js/backend.js's `call()` guard does not cover it. A deployed Apps Script that
 * answers a non-ping action with its ping payload (`{ok:true, service:
 * 'cfbp-backend'}`) would have made `appendEvents()` report a message as
 * appended when it never reached the log, and `fetchSince()` report head 0 —
 * i.e. silent chat loss wearing the same "chat is offline" costume RG-09 wore.
 *
 * The detection rule is IMPORTED rather than re-implemented: two copies of a
 * transport invariant is how they drift. `requestWithMisrouteGuard` is a pure
 * retry wrapper around a caller-supplied fetch — AD-16 still holds, this file
 * remains the only module that knows the chat URLs, actions and polling.
 */

export class StaleDeploymentError extends Error {
  constructor(action) {
    super(`Backend deployment is out of date (no '${action}' endpoint). ` +
          `Open Apps Script → Deploy → Manage deployments → Edit → New version.`);
    this.name = 'StaleDeploymentError';
    this.stale = true;
  }
}

function classify(action, err) {
  if (/unknown action/i.test(String(err?.message || err))) return new StaleDeploymentError(action);
  return err;
}

async function get(action, params = {}) {
  const c = getBackendConfig();
  if (!c || !c.url) throw new Error('Backend not configured');
  const u = new URL(c.url);
  u.searchParams.set('action', action);
  u.searchParams.set('token', c.token || '');
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, String(v)); });
  const data = await requestWithMisrouteGuard(action, async () => {
    const res = await fetch(u.toString(), { method: 'GET', redirect: 'follow' });
    // BUG-E — carry the status on the error so requestWithMisrouteGuard can tell
    // a transient (retryable) status from a permanent one without parsing prose.
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.json();
  });
  if (!data.ok) throw classify(action, new Error(data.error || 'Backend error'));
  return data;
}

async function post(action, payload = {}) {
  const c = getBackendConfig();
  if (!c || !c.url) throw new Error('Backend not configured');
  const data = await requestWithMisrouteGuard(action, async () => {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: c.token, ...payload }),
      redirect: 'follow',
    });
    // BUG-E — carry the status on the error so requestWithMisrouteGuard can tell
    // a transient (retryable) status from a permanent one without parsing prose.
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.json();
  });
  if (!data.ok) throw classify(action, new Error(data.error || 'Backend error'));
  return data;
}

// ── Interface ────────────────────────────────────────────────────────────────

export async function appendEvents(events) {
  const r = await post('chatAppend', { events });
  // `head` here is the server's TRUE sheet head, NOT a head this device has
  // received events up to. RG-95: chat.js deliberately ignores it, and no
  // other caller may adopt it as a poll cursor — doing so claims every event
  // between here and the true head as already seen. It stays on the return
  // only as a transport-level diagnostic (backendtest.mjs asserts on it to
  // prove an append survived a misroute, BUG-A); treat it as read-only.
  return { assigned: r.assigned || [], head: r.head ?? 0 };
}

export async function fetchSince(seq, limit = 300) {
  const r = await get('chatSince', { seq, limit });
  return { events: r.events || [], head: r.head ?? 0 };
}

export async function fetchBefore(seq, limit = 100) {
  const r = await get('chatBefore', { seq, limit });
  return { events: r.events || [] };
}

export async function fetchHead() {
  const r = await get('chatHead');
  return { head: r.head ?? 0 };
}

export async function fetchMetrics(days = 7) {
  const r = await get('chatMetrics', { days });
  return { rows: r.rows || [] };
}

/**
 * subscribe(onEvents, opts) — polling implementation of a push interface.
 * Two-phase: polls the cheap cached head; only calls fetchSince when the head
 * has actually advanced. The ONE exception is a tick with nothing known yet
 * (getKnownHead() === 0), which fetches directly — see tick() below.
 * Whenever it does fetch, it PAGES forward to the head (drainSince) — the
 * server caps a page at 500 rows while still reporting the true head, so one
 * call is not one complete answer on a long log (BUG-B).
 * Adaptive interval + ±20% jitter + hidden-pause live HERE (transport
 * concern), so a websocket swap deletes them wholesale.
 *
 * onEvents(events, head, { caughtUp }) — the third argument marks the delivery
 * as a mid-walk page (false) or one that reaches the server's true head (true).
 * BUG-C: consumers must not infer that from call ordering.
 *
 * opts.getMode()      -> 'hot' | 'warm' | 'idle' | 'closed'   (room activity, supplied by chat.js)
 * opts.getKnownHead() -> highest seq already ingested
 * opts.onStatus(s, detail) -> 'online' | 'offline' | 'error'
 */
const INTERVALS = { hot: 5000, warm: 15000, idle: 45000, closed: 60000 };

// ── Paging (BUG-B) ───────────────────────────────────────────────────────────
// The server's chatSince(seq, limit) caps the page it RETURNS at 500 rows but
// still reports the TRUE head (Code.gs `chatSince`). One call is therefore NOT
// one complete answer once the log passes 500 events: the response says
// "here are 500 events, and by the way the head is 1237". Handing that head
// upstream as if the page had reached it made chat.js set S.head = 1237, which
// made every later tick's `head > known` false — the newest 737 events were
// never requested again for the life of the session, and backfill() could not
// recover them (it walks backward from the OLDEST seq seen, not from a gap).
//
// So: walk forward a page at a time until the events in hand actually reach
// the head. Each page is handed up as it arrives (the room fills progressively
// instead of blocking on the whole backlog), but the TRUE head is only
// reported on the page that genuinely reaches it — every other page reports
// the highest seq it really delivered, which keeps getKnownHead() an honest
// cursor and lets the next tick resume exactly where this one stopped.
// BUG-C (2026-09-11) — paging also changed what a delivery MEANS, and the
// third argument says so out loud. Downstream of the fold, js/notifications.js
// had to answer "is this batch history or news?" and was answering it by
// counting notifications ("the first one is the backfill"), which paging turned
// into "the first PAGE is the backfill" — it then relayed a push for all 737
// messages on pages 2 and 3 of a mid-season cold boot. The transport is the
// only layer that actually KNOWS, because `caughtUp` is computed right here, so
// it reports it rather than leaving consumers to infer it from timing:
//
//   onEvents(events, head, { caughtUp })
//
//     caughtUp === false -> a page of a walk still short of the server's head.
//                           More is coming; nothing in it is news.
//     caughtUp === true  -> the events in hand reach the true head. The room is
//                           complete as of this delivery.
//
// `caughtUp` is a fact about THIS delivery, not about the session — the
// "was the room already complete before this batch?" question that decides
// live-vs-history lives in chat.js, which is the layer that holds session
// state. See chat.js ingest() and notifications.js wireChatNotifications().
//
// 500 is a CHOICE, not a ceiling: Code.gs chatSince clamps to
// Math.min(limit || 500, 1000), so 1000 would be honored (the comment here used
// to claim otherwise — review finding 6, 2026-09-11). Kept conservative so each
// round trip stays small: one page is one Apps Script read, one JSON parse and
// one fold, and a smaller page puts the first messages on screen sooner and
// costs less if the request dies mid-flight. The walk below makes page size a
// latency knob rather than a correctness one.
const PAGE_LIMIT = 500;
const MAX_PAGES_PER_TICK = 20;   // hard bound — a broken server can never spin this loop

/**
 * Returns `{ cursor, caughtUp, head }`.
 *
 * BUG-F (2026-09-11) — the return grew from a bare cursor to this triple so
 * tick() can tell the two endings apart. Reaching the head and giving up short
 * of it used to be indistinguishable to the caller, and the caller is the half
 * that decides WHEN to look again. `head` is the server's true head as last
 * reported (NOT the per-delivery head handed to onEvents, which is deliberately
 * capped at what the page actually delivered — RG-94; nothing here changes what
 * the fold is told).
 */
async function drainSince(fromSeq, onEvents) {
  let cursor = fromSeq;
  let lastHead = 0;
  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    const { events, head } = await fetchSince(cursor, PAGE_LIMIT);
    lastHead = head;
    let maxSeq = cursor;
    for (const ev of events || []) {
      if (typeof ev?.seq === 'number' && ev.seq > maxSeq) maxSeq = ev.seq;
    }
    // RG-100 F2 (reviewer finding, 2026-09-11) — a cold-start chatSince(0) can
    // answer {events:[], head:0}: a real Apps Script artifact of a sheet
    // whose getLastRow() has not warmed up yet, reporting a room that LOOKS
    // empty even though it holds real messages (the boot-ladder's costume
    // (a), documented above on BOOT_RETRY_DELAYS). Before this fix,
    // `maxSeq >= head` read that as (0 >= 0) = TRUE — "caught up" — so
    // chat.js's ingest() (the ONLY place S.caughtUp is set) latched
    // S.caughtUp=true off a delivery that reached no real head at all. One
    // tick later, when the sheet actually warms up and the REAL backfill
    // arrives already-caughtUp too, chat.js computed wasCaughtUp=true off
    // that stale latch — notifications.js's wireChatNotifications() then
    // classifies the WHOLE backfill as LIVE (its rule is exactly
    // "wasCaughtUp && caughtUp = live"), relaying a push for every message in
    // it. Measured: 90 relay sends on an 18-message room (CHAT_RELAY_BURST_CAP
    // only saves rooms bigger than ~20 messages). Consistent with the SAME
    // head>0 requirement `seenRoom` already applies a few lines down in
    // subscribe() (search "seenRoom = true" — that check was already right;
    // this one was the gap): a delivery that reports a head of 0 has not
    // actually reached anything, honest or not, and must never count as
    // "the room is complete." Accepted trade, same as seenRoom's: the very
    // first message ever posted in a brand-new, genuinely empty league
    // classifies as history on the tick that reveals it — no push for that
    // one message — which is the correct, conservative side to fail to.
    const caughtUp = head > 0 && maxSeq >= head;
    // Empty page, or a page that failed to advance the cursor (a server we
    // cannot make progress against): deliver whatever came back, but never
    // advance the reported head past what we hold, and stop — no spin.
    if (!(events || []).length || maxSeq <= cursor) {
      onEvents(events || [], caughtUp ? head : cursor, { caughtUp });
      return { cursor, caughtUp, head };
    }
    cursor = maxSeq;
    onEvents(events, caughtUp ? head : maxSeq, { caughtUp });
    if (caughtUp) return { cursor, caughtUp, head };
  }
  // Bound hit; the next tick resumes from here — and, per the schedule below,
  // it does so in a second rather than at the room's idle cadence.
  return { cursor, caughtUp: false, head: lastHead };
}

/**
 * BUG-F (2026-09-11) — THE BOOT LADDER. Drew, installed iOS PWA, v0.20.1:
 * "sometimes the chat still stays blank for a minute before all of the previous
 * messages populate again… from a fresh open of the installed app." The log was
 * 234 events — ONE page — so neither paging (RG-94) nor the server explains a
 * minute. Measured in boottest.mjs: 68.9 SECONDS.
 *
 * The interval above is chosen by ROOM ACTIVITY, and on a fresh open the player
 * lands on the dashboard, so chat.js's roomMode() says 'closed' → 60s ±20%.
 * That is the right clock for "nothing has changed since we last looked." It is
 * the WRONG clock for "we have never once managed to look" — and before this
 * fix EVERY way the first tick could fail to produce the room fell through to
 * it. Five costumes, one cause (boottest.mjs §2-§6 measures each):
 *
 *   a) chatSince(0) answers {events: [], head: 0} — a cold-start read of a
 *      sheet whose getLastRow() has not warmed up. caughtUp is (0 >= 0) = TRUE,
 *      so tick() scored it a SUCCESS, reset the backoff, and booked the next
 *      look 60s out. The blank minute, exactly.                        68.9s
 *   b) an empty page with an honest head: the walk stops (correctly — a server
 *      that cannot advance the cursor must never spin the loop), but we KNOW
 *      we are behind and still waited a full interval.                 68.9s
 *   c) document.hidden at the first tick (iOS launches the webview behind the
 *      splash screen) and the visibilitychange that would wake us never
 *      arrives.                                                        68.0s
 *   d) isBackendConfigured() false at the first tick because config.json has
 *      not landed. NOTHING fires when it does.                         68.0s
 *   e) the tick throws. [2s, 5s, 15s, 60s] is sane in the steady state and
 *      costs 22s across three failures at boot — on top of each attempt's own
 *      3 round trips and 1.6s of misroute backoff.                     37.5s
 *
 * So: until a delivery has actually reached a real head, reschedule on a short
 * bounded ladder instead of the room interval, whatever the reason the last
 * attempt came up empty. Bounded is load-bearing — an unbounded fast poll is a
 * quota bug wearing a fix's clothes. After BOOT_RETRY_DELAYS is exhausted the
 * normal rules resume, so a genuinely dead backend settles back to 60s
 * (boottest.mjs §7 pins both halves).
 *
 * This does NOT change what is fetched, when a fetch is ALLOWED (the
 * document.hidden early-return still blocks the request itself, which is the
 * mechanism RG-96's CHAT_RELAY_BURST_CAP leans on), or what onEvents is told.
 * It changes only the delay to the next attempt.
 */
const BOOT_RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];
// A drain that stopped short of the head is a KNOWN-behind state at any point
// in the session, not just at boot — including the MAX_PAGES_PER_TICK bound.
// Resume promptly rather than at the room's idle cadence.
//
// BOUNDED for the same reason the boot ladder is. Unbounded, this accelerates
// the MAX_PAGES_PER_TICK walk to 20 pages per SECOND against a server that
// keeps reporting a head we cannot reach — 20× the traffic the old 45s cadence
// allowed, which is a quota regression hiding inside a latency fix. Five
// consecutive fast rounds carry 5 × 20 × 500 = 50,000 events, orders of
// magnitude past any real backlog (the live log is 234); past that it is a
// misbehaving server, not a backlog, and the room interval is the right answer.
const CATCHUP_DELAY = 1000;
const MAX_FAST_CATCHUPS = 5;

/**
 * BUG-12 (2026-09-12) — Drew, verbatim: "When I receive a push notification it
 * doesn't show up in the chat for at least 30 seconds after the notification.
 * When I click the push, I should be able to see the message in the chat."
 *
 * The interval above is chosen by ROOM ACTIVITY, and a player who is not
 * sitting in the room is 'idle' (45s) or 'closed' (60s). That is the right
 * clock for "nothing has told us anything changed" — and a push is exactly
 * something telling us that. Nothing in the push-tap, foreground-push or
 * app-resume paths asked this transport to look, so the message the banner had
 * already announced sat unrequested until the next scheduled poll.
 *
 * wake() below is that ask — the SAME tick()/drainSince() path the interval,
 * the visibilitychange fast path and DI-168's manual refresh all use, never a
 * second fetch path (AD-16: this module stays the only one that talks to the
 * chat backend, and it now owns one more reason to poll rather than exporting
 * the machinery to do it elsewhere).
 *
 * BOUNDED, for the reason every other accelerated path here is bounded: iOS
 * fires visibility pairs while the app switcher is scrubbed, and an unbounded
 * wake is one flap away from a quota bug. One forced fetch per gap.
 *
 * NOT DROPPED, though — and that half is load-bearing. A wake is the only
 * signal we have that a message exists; discarding one because another arrived
 * four seconds ago re-creates this exact bug one flap later. A wake inside the
 * window is DEFERRED to the end of it and still resolves to its caller, which
 * is what lets the notification deep link await the fetch instead of scrolling
 * to an element that does not exist yet.
 *
 * 5s = INTERVALS.hot: the fastest cadence this app already considers
 * acceptable for a room someone is actively watching. A push tap is at least
 * that interesting, and never more expensive.
 */
const WAKE_MIN_GAP_MS = 5000;

export function subscribe(onEvents, opts = {}) {
  let timer = null, stopped = false, fails = 0, backoff = 0;
  let seenRoom = false;      // a caught-up delivery reporting a real head has landed
  let bootAttempts = 0;      // reschedules taken before that happened
  let behind = false;        // the last drain ended short of the server's head
  let catchups = 0;          // consecutive accelerated catch-up rounds
  // DI-168f (2026-09-11) — true while a tick's network round trip is actually
  // running. Lets a concurrent trigger (the visibilitychange fast path, or the
  // new forceTick() below) COALESCE into a no-op instead of doubling the poll.
  // Closes a pre-existing latent gap at the same time: before this, a
  // visibilitychange firing mid-tick could already double-call tick() — fixing
  // it here fixes it for both triggers, since both now go through the same
  // guard on the same function.
  let inFlight = false;
  // BUG-12 (2026-09-12) — the wake bound. `wakeTimer` non-null IS the open
  // window; `wakePending` records a wake that landed inside it (deferred, never
  // dropped); `wakeWaiters` are the callers awaiting that deferred fetch. See
  // WAKE_MIN_GAP_MS above for why bounded and why not dropped.
  let wakeTimer = null;
  let wakePending = false;
  let wakeWaiters = [];
  // RG-98 F1 (reviewer finding, 2026-09-11) — true only for a tick that
  // actually reached the network (past the isBackendConfigured()/hidden
  // early-return, below). delay() must not spend a BOOT_RETRY_DELAYS rung on
  // a tick that COULDN'T attempt anything — see the comment on delay() for
  // what that cost before this fix.
  let attempted = false;

  const jitter = ms => Math.round(ms * (0.8 + Math.random() * 0.4));
  const delay = () => {
    if (!behind) catchups = 0;
    else if (catchups < MAX_FAST_CATCHUPS) { catchups++; return jitter(CATCHUP_DELAY); }
    if (!seenRoom && bootAttempts < BOOT_RETRY_DELAYS.length) {
      // RG-98 F1 — a tick that returned early (config not loaded yet, or the
      // iOS webview still hidden behind the splash screen) consumed a rung
      // here unconditionally before this fix, EVEN THOUGH IT NEVER ISSUED A
      // REQUEST. A tab hidden for the ladder's whole ~30s cumulative span (1+
      // 2+4+8+15s) could exhaust all five rungs without a single attempt ever
      // having been made — so the FIRST real attempt, whenever visibility
      // finally returned, landed with the ladder already spent, falling
      // through to the room-interval branch below for what should have been
      // rung one. Measured: a tab hidden ≥31s with no visibilitychange event
      // pushed room-complete to 90.9s vs. the ~68s baseline. Fix: only
      // ADVANCE bootAttempts on a tick that actually attempted a request; a
      // tick that couldn't retries at the SAME (still-unconsumed) rung,
      // holding the ladder's fast cadence open until a real attempt is
      // finally possible.
      const rung = BOOT_RETRY_DELAYS[bootAttempts];
      if (attempted) bootAttempts++;
      return jitter(rung);
    }
    return backoff || jitter(INTERVALS[opts.getMode?.() || 'idle'] || 45000);
  };

  /**
   * Returns `true` on a successful round trip, `false` on a thrown one — new
   * with DI-168, and additive: every existing caller (the scheduled timer,
   * onVis) ignores the return value exactly as before. `forceTick()` (below)
   * is the one caller that reads it, so a manual refresh can resolve/reject
   * off the REAL outcome of the tick it triggered rather than a second,
   * separately-tracked status.
   */
  async function tick() {
    if (stopped) return false;
    if (!isBackendConfigured() || (typeof document !== 'undefined' && document.hidden)) {
      attempted = false;   // RG-98 F1 — this tick could not reach the network; delay() must not spend a boot rung on it
      schedule();
      return false;
    }
    attempted = true;      // RG-98 F1 — past this point a real request WILL be issued
    inFlight = true;
    let ok = true;
    try {
      const known = opts.getKnownHead?.() || 0;
      // Nothing known yet (cold boot, or a reload with no device-local cache
      // to prime S.head — DI-169 gives chat.js one now, which is exactly why
      // a cache-primed boot's FIRST tick lands in the ELSE branch below
      // instead of here): the head probe cannot tell us anything we would
      // act on. Any head > 0 means "fetch everything from 0", and head === 0
      // means the room is empty, which fetchSince(0) reports just as well. So
      // the probe buys nothing and costs a full Apps Script cold start
      // (10-20s, ledger §5) in front of the first message the player sees —
      // the "it starts off blank" half of Drew's report. Skip straight to
      // the fetch.
      //
      // Every tick WITH something known keeps the two-phase head-then-since
      // behaviour, which is what keeps the steady-state poll cheap — and, as
      // of DI-169, is also what turns a cache-primed cold boot into a single
      // cheap chatHead probe followed by an INCREMENTAL chatSince(cachedHead)
      // instead of RG-91's full chatSince(0, 500) — chat.js's initChat() sets
      // S.head from the device-local cache before this subscription's first
      // tick ever runs, so getKnownHead() is already non-zero here on attempt
      // #1. No change needed in this function for that to be true — it falls
      // out of the existing known>0 branch below.
      if (known === 0) {
        const r = await drainSince(0, onEvents);
        behind = !r.caughtUp;
        if (r.caughtUp && r.head > 0) seenRoom = true;
      } else {
        const { head } = await fetchHead();
        if (head > known) {
          const r = await drainSince(known, onEvents);
          behind = !r.caughtUp;
          if (r.caughtUp && r.head > 0) seenRoom = true;
        } else {
          // Nothing new, and the cheap probe agrees with our cursor: this
          // device has the room. (head === 0 here means a genuinely empty
          // room — see the boot-ladder note on why that alone is not enough
          // to call the room SEEN.)
          behind = false;
          // RG-101 / BUG-H (reviewer BLOCK on the v0.20.3 candidate,
          // 2026-09-11) — REPORT the empty-but-complete delivery. Until
          // DI-169 this branch was only ever reached mid-session, after some
          // earlier delivery had already told chat.js the room was complete,
          // so calling onEvents() with nothing to deliver looked like pure
          // cost. DI-169 changed who gets here FIRST: a cache-primed boot
          // hands getKnownHead() a non-zero cursor on tick #1, so the
          // ordinary "nothing happened while the app was closed" boot lands
          // here having delivered NOTHING all session. S.caughtUp lives in
          // chat.js and is set ONLY by ingest(), which only runs when
          // onEvents() is called — so it never latched, and the next
          // genuinely new message arrived with wasCaughtUp === false.
          // notifications.js's rule (live == wasCaughtUp && caughtUp)
          // correctly classified that message as HISTORY: zero pushes for
          // the first real message of the session, on every device, plus the
          // sender's own post (sendEvent() passes {caughtUp: S.caughtUp}).
          // An empty delivery IS a delivery: it is this transport saying
          // "the server's head is X and you already hold it," which is
          // exactly the fact the caughtUp flag records. `head > 0` is the
          // SAME requirement seenRoom applies on the line below — a head of
          // 0 has not reached anything real (RG-100) — and it is one
          // condition with one meaning, not two. Costs nothing downstream:
          // chat.js's ingest() fires no notification for an empty event
          // array, so no toast, no badge, no scan; only the latch moves.
          if (head > 0) { seenRoom = true; onEvents([], head, { caughtUp: true }); }
        }
      }
      if (fails >= 3) opts.onStatus?.('online');
      fails = 0; backoff = 0;
    } catch (err) {
      ok = false;
      fails++;
      // A thrown tick tells us nothing about how far behind we are; drop the
      // catch-up claim so the error ladder (or the boot ladder, while the room
      // is still unseen) governs rather than a 1s retry loop against a server
      // that is failing.
      behind = false;
      backoff = Math.min(60000, [0, 2000, 5000, 15000][fails] || 60000);
      if (fails === 3 || err?.stale) opts.onStatus?.('offline', { error: String(err?.message || err), stale: !!err?.stale });
    } finally {
      inFlight = false;
    }
    schedule();
    return ok;
  }

  function schedule() { if (!stopped) timer = setTimeout(tick, delay()); }

  /**
   * BUG-12 — the event-driven forced fetch. Returns a promise that settles when
   * the fetch this wake is answerable for has actually completed (immediately
   * for the wake that runs now; at the end of the window for one that was
   * deferred into it), so a caller that must not act until the room is current
   * — the notification deep link — can await it.
   */
  function wake() {
    if (stopped) { settleWakeWaiters(false); return Promise.resolve(false); }
    // Inside the window, or a round trip is already running: fold into the one
    // fetch at the end of the window rather than adding a second.
    if (wakeTimer !== null || inFlight) {
      wakePending = true;
      openWakeWindow();
      return new Promise(res => wakeWaiters.push(res));
    }
    openWakeWindow();
    clearTimeout(timer);
    const p = tick();
    p.then(ok => settleWakeWaiters(ok), () => settleWakeWaiters(false));
    return p;
  }
  function openWakeWindow() {
    if (wakeTimer !== null) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      if (wakePending) { wakePending = false; wake(); }
    }, WAKE_MIN_GAP_MS);
    wakeTimer?.unref?.();   // never hold a Node test harness open (push-onesignal.js precedent)
  }
  function settleWakeWaiters(v) {
    const waiting = wakeWaiters;
    wakeWaiters = [];
    for (const res of waiting) { try { res(v); } catch { /* a waiter's own failure is not this transport's problem */ } }
  }

  // BUG-12 — the resume half. visibilitychange was already here (and already
  // forced a tick); it now goes through wake() so it inherits the bound, and
  // `focus` joins it because an iOS standalone resume does not reliably fire
  // visibilitychange at all (boottest.mjs §5's stated unknown). Both arriving
  // costs one fetch, not two — that is what the bound is for.
  const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) wake(); };
  const onFocus = () => { if (typeof document === 'undefined' || !document.hidden) wake(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus);
  tick();

  /**
   * DI-168f — a player-triggered fast path, same mechanism the
   * visibilitychange fast path already uses (clear the pending timer, tick
   * now). Coalesces with any trigger already in flight rather than doubling
   * the network round trip: if `inFlight`, this is a no-op and resolves to
   * `null` — under real UI use this is unreachable (chat-ui.js's own button
   * disables itself while checking, DI-168f item 3's belt-and-suspenders UI
   * guard), so it only matters to a caller that bypasses that guard, e.g. a
   * test firing two forceRefresh() calls back to back.
   */
  async function forceTick() {
    if (stopped) return false;
    if (inFlight) return null;
    clearTimeout(timer);
    return tick();
  }

  // BUG-F (2026-09-11) reconciliation — the DI's literal interface is
  // `{ unsubscribe, forceTick }`, written when chat.js's _subscribeNow() was
  // believed to be subscribe()'s only caller. boottest.mjs (BUG-F, same
  // session) calls subscribe() directly and invokes the return value AS A
  // FUNCTION (`const unsub = transport.subscribe(...); …; unsub();`) — a file
  // this build does not touch and whose §7 steady-state timing assertions
  // must not be disturbed. Reconciled by making the return value BOTH: a bare
  // callable (unsubscribe — every existing caller, including boottest.mjs)
  // AND an object carrying `.unsubscribe` (a self-reference) and
  // `.forceTick`, so chat.js's _subscribeNow() can destructure
  // `{ unsubscribe, forceTick }` exactly as the DI specifies. One function,
  // two calling conventions, never two implementations.
  const unsubscribe = () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(wakeTimer); wakeTimer = null; wakePending = false;
    settleWakeWaiters(false);   // BUG-12 — a deferred wake on a torn-down subscription answers, rather than leaving its caller hanging
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus);
  };
  unsubscribe.unsubscribe = unsubscribe;
  unsubscribe.forceTick = forceTick;
  unsubscribe.wake = wake;      // BUG-12 — chat.js hands this to the push-tap / foreground-push paths via wakeChat()
  return unsubscribe;
}
