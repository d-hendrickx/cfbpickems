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
    if (!res.ok) throw new Error('HTTP ' + res.status);
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
    if (!res.ok) throw new Error('HTTP ' + res.status);
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

async function drainSince(fromSeq, onEvents) {
  let cursor = fromSeq;
  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    const { events, head } = await fetchSince(cursor, PAGE_LIMIT);
    let maxSeq = cursor;
    for (const ev of events || []) {
      if (typeof ev?.seq === 'number' && ev.seq > maxSeq) maxSeq = ev.seq;
    }
    const caughtUp = maxSeq >= head;
    // Empty page, or a page that failed to advance the cursor (a server we
    // cannot make progress against): deliver whatever came back, but never
    // advance the reported head past what we hold, and stop — no spin.
    if (!(events || []).length || maxSeq <= cursor) {
      onEvents(events || [], caughtUp ? head : cursor, { caughtUp });
      return cursor;
    }
    cursor = maxSeq;
    onEvents(events, caughtUp ? head : maxSeq, { caughtUp });
    if (caughtUp) return cursor;
  }
  return cursor;                 // bound hit; the next tick resumes from here
}

export function subscribe(onEvents, opts = {}) {
  let timer = null, stopped = false, fails = 0, backoff = 0;

  const jitter = ms => Math.round(ms * (0.8 + Math.random() * 0.4));
  const delay = () => backoff || jitter(INTERVALS[opts.getMode?.() || 'idle'] || 45000);

  async function tick() {
    if (stopped) return;
    if (!isBackendConfigured() || (typeof document !== 'undefined' && document.hidden)) return schedule();
    try {
      const known = opts.getKnownHead?.() || 0;
      // Nothing known yet (cold boot, or a reload — the fold is rebuilt from
      // the transport on every boot, nothing is cached device-locally): the
      // head probe cannot tell us anything we would act on. Any head > 0 means
      // "fetch everything from 0", and head === 0 means the room is empty,
      // which fetchSince(0) reports just as well. So the probe buys nothing
      // and costs a full Apps Script cold start (10-20s, ledger §5) in front
      // of the first message the player sees — the "it starts off blank" half
      // of Drew's report. Skip straight to the fetch.
      //
      // Every tick WITH something known keeps the two-phase head-then-since
      // behaviour, which is what keeps the steady-state poll cheap.
      if (known === 0) {
        await drainSince(0, onEvents);
      } else {
        const { head } = await fetchHead();
        if (head > known) await drainSince(known, onEvents);
      }
      if (fails >= 3) opts.onStatus?.('online');
      fails = 0; backoff = 0;
    } catch (err) {
      fails++;
      backoff = Math.min(60000, [0, 2000, 5000, 15000][fails] || 60000);
      if (fails === 3 || err?.stale) opts.onStatus?.('offline', { error: String(err?.message || err), stale: !!err?.stale });
    }
    schedule();
  }

  function schedule() { if (!stopped) timer = setTimeout(tick, delay()); }

  const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) { clearTimeout(timer); tick(); } };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
  };
}
