/**
 * chat.js — v0.17.0 league chat engine (REVISED spec: one room + gameTag)
 * =======================================================================
 * ONE chronological message log. Every message may carry an optional gameTag
 * (a gameId). "Game threads" are filtered views of the one room — there is no
 * room you can fail to check.
 *
 *  - Append-only events: message / edit / delete / react / gamereact /
 *    unreact / system / pin / unpin / feedback
 *  - `feedback` (UN-159/UN-160, SCRIBE pilot instrumentation) is a mutation
 *    on an existing target (react/pin's shape, not message's) — no new KV
 *    key, rides this same append-only Messages sheet via chatTransport.js.
 *    See js/scribeFeedback.js for the read/write surface.
 *  - Client fold is ORDER-INDEPENDENT + IDEMPOTENT (AD-10). Events referencing
 *    unknown targets buffer until the target arrives. react/unreact resolve
 *    latest-wins per (emoji, author) — the naive toggle was RG-06.
 *  - Tag resolution (the cross-talk rule): reply inherits the parent's tag
 *    (even null); otherwise the current view's tag; otherwise null.
 *  - Notification classes: every event carries notify. Messages/replies/
 *    mention-responses notify; reactions, gamereacts, system events, and
 *    unprompted SCRIBE are ambient (render, never badge).
 *  - Transport lives ENTIRELY in chatTransport.js (AD-16). This module never
 *    sees a URL. Polling cadence is supplied to the transport via roomMode().
 *  - Outbox: optimistic send, 750ms coalescing window, retries with backoff,
 *    FAILED state after 3 attempts (never silently dropped), survives reload.
 *  - Loud-fail: transport reports offline after 3 consecutive failures; a
 *    stale-deployment error (the v0.16 outage root cause) is surfaced
 *    distinctly so the fix is actionable from the banner itself.
 */

import {
  appendEvents, subscribe, fetchBefore, fetchHead, StaleDeploymentError,
} from './chatTransport.js';
import { isBackendConfigured } from './backend.js';
// v0.17.3 — chat retention (UN-88) reads settings.chatRetentionDays through
// the storage seam. Safe: storage.js imports only data-model.js + backend.js,
// neither of which imports chat.js, so this cannot cycle.
// UN-112 — the epoch clear writes settings.chatEpochSeq/chatEpochSetAt through
// the same seam, via saveSetting. Same import, same safety argument.
import { getSettings, saveSetting } from './storage.js';

// ── Device-local persistence keys (AD-12) ─────────────────────────────────────
const K_LASTSEEN = 'cfbp_chat_lastseen2';   // { seq, byTag: { gameId: seq } }
const K_OUTBOX   = 'cfbp_chat_outbox2';
const K_EPOCH_APPLIED = 'cfbp_chat_epoch_applied';   // UN-112 — device-local watermark, see initChat()
// DI-169b — SAME precedent as the three keys above: a bare, guarded
// localStorage key, module-level constant, read/written via try{}catch{}.
// NEVER registered in storage.js's KEYS object and NEVER added to
// DEVICE_LOCAL_KEYS — this key never goes through the load()/save() seam
// (AD-02) at all, so it cannot be routed through it either way. useSheets()
// only ever runs for keys read through load()/save(); a bare
// localStorage.getItem/setItem call never enters that function, so it can
// never reach backend.js's push queue or hydrate, and exportAllDataRaw()
// (which walks Object.values(KEYS)) is structurally blind to it too.
const K_EVENTS_CACHE = 'cfbp_chat_events_cache';   // { epoch, head, events[] } — see DI-169

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  items: new Map(),          // id -> folded item
  buffered: new Map(),       // targetId -> [events waiting for target]
  head: 0,
  outbox: [],                // [{ev, attempts}]
  failed: new Map(),         // id -> ev
  flushTimer: null,
  offline: false,
  staleDeployment: false,
  lastError: '',
  viewOpen: false,
  selfId: null,
  unsub: null,
  forceTick: null,           // DI-168 — set alongside S.unsub by _subscribeNow(); see forceRefresh()
  subs: new Set(),
  backfillLow: null,
  // BUG-C (2026-09-11) — has the transport reached the server's TRUE head at
  // least once this session? Until it has, everything arriving is history,
  // however many pages it takes (chatTransport drainSince pages a cold boot).
  // This is SESSION state, which is why it lives here and not in the transport
  // (which knows one delivery at a time) or in notifications.js (which cannot
  // see the transport at all — AD-16).
  caughtUp: false,
};

function notify(kind, detail) { S.subs.forEach(fn => { try { fn(kind, detail); } catch {} }); }
export function onChat(fn) { S.subs.add(fn); return () => S.subs.delete(fn); }
export function chatStatus() {
  return { head: S.head, offline: S.offline, staleDeployment: S.staleDeployment,
           lastError: S.lastError, outbox: S.outbox.length, failed: S.failed.size,
           mode: roomMode(), caughtUp: S.caughtUp };
}

// ── Commissioner chat on/off toggle (batch 3+4 item A) ────────────────────────
// A synced setting (settings.chatEnabled, storage seam, AD-02) — NOT
// device-local, because every player must see the same on/off state. Default
// TRUE: chat is on today, and a missing value (every settings blob written
// before this field existed) must never silently disable it. `!== false`
// rather than a truthy check so any non-boolean garbage in an old blob still
// reads as enabled, not disabled (CONVENTIONS #7 — defensive coercion at a
// data boundary).
export function isChatEnabled() {
  return getSettings().chatEnabled !== false;
}

// ── F4-interim (UN-164/F1) — inline pasted-image-URL preview, off-by-default ──
// `settings.chatImagePreviewEnabled` is in DEFAULT_SETTINGS (data-model.js,
// ~line 416). Explicit `=== true` (not `isChatEnabled()`'s `!== false`
// pattern) is deliberate: this is a NEW opt-in flag, so a missing value
// (every settings blob, including ones written before this shipped) must
// read OFF — the opposite default direction, same reasoning as
// `randomizePicksEnabled` (data-model.js DEFAULT_SETTINGS) — a passive
// external-image-load IP-disclosure vector (F1's design input) should never
// turn itself on for an existing league by default.
export function isChatImagePreviewEnabled() {
  return getSettings().chatImagePreviewEnabled === true;
}

// ── Chat retention (UN-88) — CLIENT-SIDE HIDE ONLY ────────────────────────────
// Drew's call, not the destructive variant: the backend (backend/Code.gs)
// exposes only chatAppend/chatSince/chatBefore/chatHead/chatMetrics — no
// row-removal endpoint — so a real "delete" would need a new endpoint and a
// redeploy (RG-09's exact failure mechanism) for a cosmetic gain at 6-player
// scale. Instead: messages older than the window stop RENDERING. Rows stay in
// the Sheet forever; flipping the setting back off restores the full history
// with zero data loss. A synced setting (goes through the storage seam via
// getSettings/saveSetting, AD-02) so every player sees the same window —
// never a device-local key. Default-when-missing: 0/absent = OFF.
export function getRetentionDays() {
  return Number(getSettings().chatRetentionDays) || 0;
}

/** Pinned (Hall of Records) messages are ALWAYS visible regardless of age —
 *  that is the entire point of pinning something. Never hidden by retention. */
export function isHiddenByRetention(m) {
  return _hiddenBy(retentionCutoff(), m);
}

/**
 * Resolve the retention cutoff ONCE, for callers that then test many messages.
 *
 * v0.17.2 perf: getRetentionDays() reads getSettings(), which spreads
 * DEFAULT_SETTINGS over a load() — and in local mode that is a JSON.parse per
 * call. isUnreadFor() runs per message, unreadCount() runs per pill (up to 11),
 * and updateChatBadges() runs on the poll loop, so calling it per-message cost
 * ~1.9ms per 800 messages even with retention OFF. Hoist it.
 *
 * Returns 0 when retention is disabled — callers treat 0 as "hide nothing".
 */
export function retentionCutoff() {
  const days = getRetentionDays();
  return days > 0 ? Date.now() - days * 86400000 : 0;
}

/** Pure predicate against a pre-resolved cutoff. Pinned is always visible. */
function _hiddenBy(cutoff, m) {
  if (!cutoff) return false;
  if (m?.pinned) return false;
  return (m?.ts || 0) < cutoff;
}

/** Commissioner Data-tab card stats: how many messages the current window
 *  WOULD hide/protect, and the date range they span. Purely informational —
 *  computing this never mutates anything. */
export function retentionStats() {
  const days = getRetentionDays();
  if (days <= 0) return { enabled: false, days: 0, hiddenCount: 0, protectedCount: 0, oldestTs: null, newestTs: null };
  const cutoff = Date.now() - days * 86400000;
  let hiddenCount = 0, protectedCount = 0, oldestTs = null, newestTs = null;
  S.items.forEach(m => {
    if (m.type !== 'message' || m.deleted) return;
    if ((m.ts || 0) >= cutoff) return;                 // not old enough to be affected either way
    if (m.pinned) { protectedCount++; return; }
    hiddenCount++;
    if (oldestTs === null || m.ts < oldestTs) oldestTs = m.ts;
    if (newestTs === null || m.ts > newestTs) newestTs = m.ts;
  });
  return { enabled: true, days, hiddenCount, protectedCount, oldestTs, newestTs };
}

// ── Chat epoch clear (UN-112) — LAUNCH BLOCKER ────────────────────────────────
// Drew: factory reset kept historical chat from testing. resetToDemo() clears
// 17 seam keys but the chat log lives in a separate Messages sheet reachable
// only through chatTransport.js (AD-16) — the seam has no path to it, and a
// real backend purge needs a new Code.gs endpoint + redeploy (RG-09's exact
// failure mechanism) for a one-time action, at the highest-stakes moment.
// Drew already declined that tradeoff once for UN-88 (retention); same call,
// same reason. So: a WATERMARK, exactly like retention, hides rather than
// deletes — reversible, no redeploy, no new endpoint.
export function getChatEpochSeq() {
  return Number(getSettings().chatEpochSeq) || 0;
}
export function getChatEpochSetAt() {
  return getSettings().chatEpochSetAt || null;
}

/**
 * Pure predicate: is this message at or below the epoch watermark?
 *
 * DELIBERATE DIVERGENCE FROM RETENTION (`isHiddenByRetention`, above) — NO
 * pinned exemption. A message pinned during pre-launch testing is still
 * test content; the entire point of this feature is to erase that testing
 * from view before the six players ever see the room. Do not "fix" this by
 * copying the retention pattern and exempting pins — that would defeat the
 * feature. Asserted explicitly in loadtest so nobody does.
 */
export function isHiddenByEpoch(m) {
  const epochSeq = getChatEpochSeq();
  if (!epochSeq) return false;
  return typeof m?.seq === 'number' && m.seq <= epochSeq;
}

/**
 * UN-112 — unlike retention (a rolling window that keeps sliding), the epoch
 * is a FIXED point in the sequence. "Load earlier" should keep working past
 * a retention cutoff (there is real history further back mid-season), but
 * stop once backfilling further could only ever surface epoch-hidden test
 * messages — i.e. once the oldest message already loaded is at or before the
 * epoch. Exported because chat-ui.js's "load earlier" control needs this and
 * S.backfillLow is private module state — no other module reaches into it
 * directly.
 */
export function backfillBlockedByEpoch() {
  const epochSeq = getChatEpochSeq();
  return epochSeq > 0 && S.backfillLow !== null && S.backfillLow <= epochSeq;
}

/** Commissioner Data-tab card: how many currently-loaded messages the active
 *  epoch is hiding. Purely informational, same shape as retentionStats()
 *  above — computing this never mutates anything. Counts only what this
 *  device has ingested so far (S.items), same caveat retentionStats() already
 *  carries. */
export function epochStats() {
  const epochSeq = getChatEpochSeq();
  if (!epochSeq) return { enabled: false, epochSeq: 0, setAt: null, hiddenCount: 0 };
  let hiddenCount = 0;
  S.items.forEach(m => {
    if (m.type !== 'message' || m.deleted) return;
    if (isHiddenByEpoch(m)) hiddenCount++;
  });
  return { enabled: true, epochSeq, setAt: getChatEpochSetAt(), hiddenCount };
}

function localEpochApplied() {
  try { return Number(localStorage.getItem(K_EPOCH_APPLIED)) || 0; } catch { return 0; }
}

/**
 * DI-112b — the device-local self-heal. The epoch watermark alone only hides
 * old messages from RENDERING; it does nothing to stop a device with a stale
 * queued message from re-sending it into the freshly-cleared room, because
 * flushOutbox() fires unconditionally in initChat() on every boot. This is
 * what actually reaches all six phones:
 *  - empties the outbox/failed queue and persists the empty outbox, so
 *    nothing stale can flush;
 *  - fast-forwards K_LASTSEEN to the epoch seq — without this a device with
 *    a high old read-cursor would silently UNDER-count real new messages
 *    (isUnreadFor() requires seq > afterSeq);
 *  - notifies so other modules can clear keys THEY own (chat.js owns
 *    outbox/lastseen only — module layering, no new imports here).
 * Called from initChat() (gated by the watermark comparison, so it runs
 * exactly once per epoch bump) AND directly from startFreshChat() so the
 * commissioner's own device empties immediately as built-in verification.
 */
function _applyEpochLocally(epochSeq) {
  // BUG-D — the queued events are about to be DISCARDED, so anything waiting
  // on one of them will never be acknowledged. Reject now instead of letting
  // the caller burn its full bound waiting for a send that no longer exists:
  // an @scribe mention in flight when the commissioner hits "Clear Chat
  // History" degrades at once rather than 45s later, under the same id.
  S.outbox.forEach(o => settleAppend(o.ev.id, new Error(`Chat history was cleared before ${o.ev.id} could be sent`)));
  S.outbox = [];
  S.failed.clear();
  persistOutbox();
  putLastSeen({ seq: epochSeq, byTag: {} });
  try { localStorage.setItem(K_EPOCH_APPLIED, String(epochSeq)); } catch {}
  notify('epochApplied', { epochSeq });
}

/**
 * Commissioner action — "🧹 Clear Chat History Before Launch" / "Clear Chat
 * Again". LOUD-FAIL: fetches the LIVE head from the server and NEVER guesses.
 * A guessed or partial epoch either hides real messages forever (set too
 * high) or fails to hide test ones (set too low) — so if fetchHead() throws,
 * this throws too, before touching settings at all. The caller (app.js) is
 * responsible for the disabled/loading UI state and the error toast; Apps
 * Script cold starts run 10-20s.
 */
export async function startFreshChat() {
  const { head } = await fetchHead();          // LIVE head — the whole point
  saveSetting('chatEpochSeq', head);
  saveSetting('chatEpochSetAt', new Date().toISOString());
  _applyEpochLocally(head);                     // this device empties immediately — doubles as verification
  return head;
}

// ── Fold ──────────────────────────────────────────────────────────────────────
function newItem(ev) {
  return { id: ev.id, seq: ev.seq ?? null, ts: ev.ts ?? ev._localTs ?? null,
           author: ev.author, gameTag: ev.gameTag || '', body: ev.body || '',
           replyTo: ev.replyTo || '', notify: !!ev.notify, meta: ev.meta || null,
           type: ev.type, edited: false, deleted: false, pinned: false,
           reactions: {}, local: !!ev.local,
           // UN-159/UN-160 (E1/E2, SCRIBE pilot feedback) — `feedback` is a
           // DERIVED plain object, same shape/precedent as `reactions` above:
           // { [playerId]: { rating, rewrite, remember_this, weigh_in } },
           // rebuilt from `_feedbackOps` on every 'feedback' mutation. Every
           // item gets this field (not only ones that ever receive feedback)
           // so a reader can always do `m.feedback[self]` without an extra
           // existence check.
           feedback: {},
           _editTs: 0, _reactOps: new Map(), _pinOps: new Map(), _feedbackOps: new Map() };
}

/**
 * AD-10 — (ts, seq) is an ordered PAIR and has to be compared as one.
 *
 * It used to be packed into a single double as `ts * 1e7 + seq`. At a real
 * epoch (~1.79e12) that product is ~1.79e19, where a double's ulp is 2048 — so
 * every realistic `seq` was rounded clean away and every event sharing a `ts`
 * collapsed onto one identical key. Ordering then fell through to whatever
 * arrival order that particular device happened to see, which is exactly the
 * order-independence guarantee this module is built on.
 *
 * It mattered because bursts are real: finalizeWeek() emits the week-final
 * post, one game-final post per game, and the Extra Point reveal in a single
 * synchronous tick, all stamped with one Date.now().
 *
 * Comparing the components instead has no precision to lose, and only changes
 * the result where the packed key was ambiguous anyway.
 */
function cmpOrder(a, b) {
  return ((a?.ts || 0) - (b?.ts || 0)) || ((a?.seq || 0) - (b?.seq || 0));
}

// ── Prototype-pollution guard (reviewer BLOCK, remediation build 1) ──────────
// `ev.author`/`meta.category`/`meta.emoji` flow into PLAIN OBJECT keys below
// (`nextFeedback[op.author][op.category]`, `next[em]`). A remote event is
// attacker-controlled data (any device holding the shared token can send an
// arbitrary event through chatTransport.js) — if one of those three strings
// is `__proto__`, bracket-assignment on a plain object does NOT create an own
// property named "__proto__"; `Object.prototype.__proto__` is an ACCESSOR,
// so `obj['__proto__']` reads back the real, already-truthy prototype object,
// which means `obj['__proto__'] = obj['__proto__'] || {}` never creates a
// fresh object — it silently re-resolves to `Object.prototype` itself, and
// the following `[...] = value` write lands ON Object.prototype, corrupting
// every plain object in the process (`({}).polluted` would then read back
// whatever was written). `constructor`/`prototype` are the same family of
// footgun for other prototype-chain traversals. Reject all three AT THE
// DOOR — a poisoned event never enters `_feedbackOps`/`_reactOps`, so it can
// never resurface via the rebuild loops below either.
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function isUnsafeKey(k) { return UNSAFE_OBJECT_KEYS.has(k); }

function applyTo(target, ev) {
  // Same pair, same reason as cmpOrder() above — these last-writer-wins races
  // used the identical packed scalar, so two devices could disagree about
  // whether a message was edited, pinned or reacted to. `_editTs` starts as the
  // falsy sentinel 0, which cmpOrder() reads as {ts:0, seq:0}.
  const stamp = { ts: ev.ts || 0, seq: ev.seq || 0 };
  if (ev.type === 'edit') {
    if (cmpOrder(stamp, target._editTs) >= 0) { target.body = ev.body || ''; target.edited = true; target._editTs = stamp; }
  } else if (ev.type === 'delete') {
    target.deleted = true;
  } else if (ev.type === 'pin' || ev.type === 'unpin') {
    const cur = target._pinOps.get('pin');
    if (!cur || cmpOrder(stamp, cur.stamp) >= 0) { target._pinOps.set('pin', { stamp }); target.pinned = ev.type === 'pin'; }
  } else if (ev.type === 'react' || ev.type === 'unreact') {
    // Latest-wins per (emoji, author) — order-independent (RG-06 guard).
    const emoji = ev.meta?.emoji; if (!emoji) return;
    // Prototype-pollution guard (same reasoning as the 'feedback' branch,
    // below) — `emoji` becomes an object key in the rebuild loop
    // (`next[em] = next[em] || []`) a few lines down.
    if (isUnsafeKey(emoji)) return;
    const key = `${emoji}|${ev.author}`;
    const cur = target._reactOps.get(key);
    if (cur && cur.id === ev.id) return;
    if (cur && cmpOrder(cur.stamp, stamp) >= 0) return;
    target._reactOps.set(key, { stamp, on: ev.type === 'react', id: ev.id });
    const next = {};
    target._reactOps.forEach((op, k) => {
      if (!op.on) return;
      const [em, author] = k.split('|');
      (next[em] = next[em] || []).push(author);
    });
    target.reactions = next;
  } else if (ev.type === 'feedback') {
    // UN-159/UN-160 (E1/E2, DESIGN_INPUTS_BATCH1_091026.md Document 2) — a
    // 'feedback' event is a MUTATION on an EXISTING target (a SCRIBE
    // response's chat event, or a human message's), applied here exactly
    // like react/unreact/pin/edit above — NOT a new S.items entry, NO new KV
    // key (chatTransport.js's already-incremental Messages sheet only,
    // AD-16). ev.targetId is already how `target` was looked up (ingest()),
    // so scoping this map to (author, category) — rather than repeating
    // targetId a second time inside the key — is the SAME composite key the
    // design's record shape describes (`${targetId}|${playerId}|${category}`),
    // just without the redundant prefix a per-target Map already provides.
    //
    // Latest-wins per (author, category) — same RG-06 shuffle-order guard as
    // react/unreact. A SECOND rating value on the SAME category REPLACES the
    // first (never stacks — "changed my mind" in E1's state table); a
    // rewrite and a rating are DISJOINT categories and never collide (E1/E2's
    // "rewrite stored distinctly from rating" requirement — structural, not
    // just labeled, because they can never share a key).
    const category = ev.meta?.category; if (!category) return;
    // Prototype-pollution guard — see UNSAFE_OBJECT_KEYS' comment above.
    // `ev.author` and `category` both become object keys two lines below
    // (`nextFeedback[op.author][op.category]`); reject both here so a
    // poisoned event never even enters `_feedbackOps`.
    if (isUnsafeKey(ev.author) || isUnsafeKey(category)) return;
    const key = `${ev.author}|${category}`;
    const cur = target._feedbackOps.get(key);
    if (cur && cur.id === ev.id) return;
    if (cur && cmpOrder(cur.stamp, stamp) >= 0) return;
    target._feedbackOps.set(key, { stamp, id: ev.id, author: ev.author, category, value: ev.meta?.value ?? null });
    // Object.create(null) — belt-and-suspenders alongside the reject-at-the-
    // door guard above: even if some future caller ever pushed an op into
    // `_feedbackOps` without going through the guard above, a null-prototype
    // object has no `__proto__`/`constructor`/`prototype` ACCESSOR to
    // collide with, so `nextFeedback[op.author] = nextFeedback[op.author] ||
    // Object.create(null)` always creates a genuine fresh object instead of
    // silently resolving to a shared prototype.
    const nextFeedback = Object.create(null);
    target._feedbackOps.forEach(op => {
      if (!nextFeedback[op.author]) nextFeedback[op.author] = Object.create(null);
      nextFeedback[op.author][op.category] = op.value;
    });
    target.feedback = nextFeedback;
  }
}

/**
 * Ingest raw events from any source (poll, backfill, optimistic local).
 *
 * BUG-C (2026-09-11) — `delivery` is the transport's delivery kind,
 * `{ caughtUp }` (chatTransport drainSince). It is NOT used by the fold, which
 * stays order-independent and idempotent (AD-09/AD-10); it is forwarded, with
 * the session's PRIOR state, on the 'events' notification so a subscriber can
 * tell history from news without guessing from call ordering:
 *
 *   caughtUp    — this delivery reaches the server's true head
 *   wasCaughtUp — the room was ALREADY complete before this delivery landed,
 *                 i.e. anything new in it is genuinely new
 *
 * A caller that passes no `delivery` is asserting a COMPLETE delivery
 * (`caughtUp: true`): that is true of the optimistic local send, the outbox
 * reconcile and "load earlier", which are the only in-module callers, and they
 * pass `{ caughtUp: S.caughtUp }` explicitly so they stay liveness-NEUTRAL —
 * a local send says nothing about whether the transport has finished draining,
 * and a "load earlier" page is older history by definition.
 */
export function ingest(events, head, delivery) {
  // Default fails OPEN (no delivery arg → treated as caught up) — the inverse
  // of notifications.js, which fails CLOSED on a detail-less notification.
  // Safe only because every caller passes it explicitly; keep it that way.
  const caughtUp = delivery ? delivery.caughtUp === true : true;
  const wasCaughtUp = S.caughtUp;
  if (caughtUp) S.caughtUp = true;
  if (typeof head === 'number' && head > S.head) S.head = head;
  let n = 0;
  for (const ev of events || []) {
    if (!ev || !ev.id) continue;
    if (typeof ev.seq === 'number' && ev.seq > S.head) S.head = ev.seq;
    if (typeof ev.seq === 'number') {
      S.backfillLow = S.backfillLow === null ? ev.seq : Math.min(S.backfillLow, ev.seq);
    }

    if (['message', 'system', 'gamereact'].includes(ev.type)) {
      const existing = S.items.get(ev.id);
      if (existing) {
        // Reconcile optimistic → server-assigned
        if (existing.seq === null && typeof ev.seq === 'number') {
          existing.seq = ev.seq; existing.ts = ev.ts ?? existing.ts; existing.local = false;
          settleAppend(ev.id, null, ev.seq);   // BUG-D — the append's own reply can be lost; this is the other acknowledgement
        }
      } else {
        const item = newItem(ev);
        S.items.set(ev.id, item);
        const waiting = S.buffered.get(ev.id);
        if (waiting) { waiting.forEach(w => applyTo(item, w)); S.buffered.delete(ev.id); }
        n++;
      }
    } else if (['edit', 'delete', 'react', 'unreact', 'pin', 'unpin', 'feedback'].includes(ev.type)) {
      const target = S.items.get(ev.targetId);
      if (target) applyTo(target, ev);
      else {
        if (!S.buffered.has(ev.targetId)) S.buffered.set(ev.targetId, []);
        // buffer idempotently by event id
        const buf = S.buffered.get(ev.targetId);
        if (!buf.some(b => b.id === ev.id)) buf.push(ev);
      }
    }
  }
  // DI-169d — additive only: ingest()'s fold above is UNCHANGED, only what it
  // forwards on the notification gains a field. `fromCache` is true only for
  // a device-local cache replay (readAndPrimeEventsCache(), below) — a real
  // poll or backfill delivery never sets it, so `!!delivery?.fromCache` reads
  // false for every existing caller without them passing anything new.
  if (n || (events && events.length)) notify('events', { added: n, caughtUp, wasCaughtUp, fromCache: !!delivery?.fromCache });
  return n;
}

/** Chronological list. filter: {tag:'all'|''|gameId, pinned, mentionsOf, types,
 *  respectRetention, textContains}. `respectRetention` is opt-in and defaults
 *  to false so existing non-display callers (the weekly digest, SCRIBE's
 *  pre-kick lookup) keep reading the full history unless they explicitly ask
 *  to be filtered — retention is a rendering preference, not a
 *  data-availability change. Chat page render paths pass
 *  `respectRetention: true`.
 *
 *  `textContains` (F2, UN-165) — optional, case-insensitive substring match
 *  against `m.body`, additive-only, read-only (no fold/ordering/mutation
 *  change). Deliberately placed AFTER the epoch/retention checks below, not
 *  before: a message search must never surface a message the main feed
 *  itself would hide, or a tap on a result would land on nothing (the exact
 *  "filter/search surface disagrees with what the underlying view honors"
 *  class named in the design input). feedbacktest.mjs mutation-checks this
 *  ordering directly. */
export function getMessages(filter = {}) {
  const tag = filter.tag ?? 'all';
  const needle = filter.textContains ? String(filter.textContains).toLowerCase() : '';
  const out = [];
  S.items.forEach(m => {
    if (filter.types && !filter.types.includes(m.type)) return;
    if (tag !== 'all' && (m.gameTag || '') !== tag) return;
    if (filter.pinned && !m.pinned) return;
    // UN-112 — UNCONDITIONAL, unlike respectRetention's opt-in above. No
    // reader (or any other caller of this one choke point) should ever see
    // pre-launch test chatter again. Composed here, not per-surface — see
    // the epoch section's comments for why per-surface checks half-shipped
    // retention before this.
    if (isHiddenByEpoch(m)) return;
    if (filter.respectRetention && isHiddenByRetention(m)) return;
    if (needle && !(m.body || '').toLowerCase().includes(needle)) return;
    if (filter.mentionsOf) {
      const mentioned = (m.meta?.mentions || []).includes(filter.mentionsOf);
      const replyToMe = m.replyTo && S.items.get(m.replyTo)?.author === filter.mentionsOf;
      if (!(mentioned || replyToMe) || m.author === filter.mentionsOf) return;
    }
    out.push(m);
  });
  return out.sort(cmpOrder);          // AD-10 — ordered pair, see cmpOrder()
}

export function getMessage(id) { return S.items.get(id) || null; }

// ── The cross-talk rule ───────────────────────────────────────────────────────
/** resolveTag({replyTo, viewTag}) — reply inherits parent tag (even null);
 *  else the current view's tag; else null. */
export function resolveTag({ replyTo = null, viewTag = '' } = {}) {
  if (replyTo) {
    const parent = S.items.get(replyTo);
    if (parent) return parent.gameTag || '';
  }
  return viewTag || '';
}

// ── Sending ───────────────────────────────────────────────────────────────────
function uuid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
    : 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Generic event send. Deterministic ids (AD-11) make system/SCRIBE events
 *  exactly-once across six clients — the server dedupes on id. */
export function sendEvent(ev) {
  const full = {
    id: ev.id || uuid(), type: ev.type || 'message', author: ev.author || 'unknown',
    gameTag: ev.gameTag || '', body: (ev.body || '').slice(0, 1000),
    targetId: ev.targetId || '', replyTo: ev.replyTo || '',
    notify: !!ev.notify, meta: ev.meta || null,
    local: true, _localTs: Date.now(),
  };
  ingest([full], undefined, { caughtUp: S.caughtUp });   // optimistic — liveness-neutral (BUG-C)
  S.outbox.push({ ev: full, attempts: 0 });
  persistOutbox();
  scheduleFlush();
  return full.id;
}

export function sendMessage({ body, gameTag = '', replyTo = '', author, mentions = [], scribeReply = false }) {
  return sendEvent({
    type: 'message', body, gameTag, replyTo, author,
    notify: true,
    meta: mentions.length || scribeReply ? { mentions, ...(scribeReply ? { scribeReply: true } : {}) } : (null),
  });
}

export function editMessage(id, body, author) {
  const t = S.items.get(id); if (!t || t.author !== author) return null;
  return sendEvent({ type: 'edit', targetId: id, body, author, notify: false });
}
export function deleteMessage(id, author) {
  const t = S.items.get(id); if (!t || t.author !== author) return null;
  return sendEvent({ type: 'delete', targetId: id, author, notify: false });
}
export function toggleReact(targetId, emoji, author) {
  const t = S.items.get(targetId); if (!t) return null;
  const on = (t.reactions[emoji] || []).includes(author);
  return sendEvent({ type: on ? 'unreact' : 'react', targetId, author, notify: false, meta: { emoji } });
}
export function pinMessage(targetId, author, on = true) {
  return sendEvent({ type: on ? 'pin' : 'unpin', targetId, author, notify: false });
}
/** Ambient game-card emoji reaction, mirrored into the room (coalesced at render). */
export function sendGameReact(gameId, emoji, author) {
  return sendEvent({ type: 'gamereact', gameTag: gameId, author, notify: false, meta: { emoji } });
}

// ── Outbox ────────────────────────────────────────────────────────────────────
const FLUSH_COALESCE_MS = 750;
const MAX_ATTEMPTS = 3;

function persistOutbox() {
  try { localStorage.setItem(K_OUTBOX, JSON.stringify(S.outbox.map(o => o.ev))); } catch {}
}
function loadOutbox() {
  try {
    const arr = JSON.parse(localStorage.getItem(K_OUTBOX) || '[]');
    S.outbox = arr.map(ev => ({ ev, attempts: 0 }));
    ingest(arr.map(ev => ({ ...ev, local: true })), undefined, { caughtUp: S.caughtUp });
  } catch { S.outbox = []; }
}
function scheduleFlush() {
  if (S.flushTimer) return;                       // coalescing window (spec §load 4)
  S.flushTimer = setTimeout(() => { S.flushTimer = null; flushOutbox(); }, FLUSH_COALESCE_MS);
}

export async function flushOutbox() {
  // "Off" means zero network activity, not just zero reads — a queued send
  // (e.g. a SCRIBE post staged from the commissioner panel while chat is
  // hidden) waits in the outbox, persisted, and flushes automatically the
  // moment chat is re-enabled. Nothing is lost (item A: "data is preserved").
  if (!S.outbox.length || !isBackendConfigured() || !isChatEnabled()) return;
  const batch = S.outbox.splice(0, S.outbox.length);
  try {
    // RG-95 — the response's `head` is DELIBERATELY IGNORED. `chatAppend`
    // answers with the TRUE sheet head (Code.gs `msgHead(s)`), not a head this
    // device has received events up to, and S.head is the poll cursor: the
    // transport asks `getKnownHead()` and only fetches when the server's head
    // is AHEAD of it. Adopting the append's head therefore claims every event
    // between here and the true head as already seen. One dropped read — an
    // Apps Script cold start, the ordinary case §[71] exists for — plus one
    // successful send, and the room stays empty except the sender's own
    // message for the rest of the session. `initChat()` flushes a persisted
    // outbox on every boot, so it does not even take a player typing.
    //
    // Same invariant BUG-B established in the transport (chatTransport.js
    // drainSince): the cursor is only ever advanced by events actually
    // received. The sender loses nothing — their message gets its assigned seq
    // on the ITEM just below, and the next tick re-reads it from the log like
    // any other event, deduped by id server-side and in the fold (AD-09/AD-10).
    // Guarded by loadtest §[74].
    const { assigned } = await appendEvents(batch.map(o => o.ev));
    const byId = new Map(assigned.map(a => [a.id, a]));
    batch.forEach(o => {
      const a = byId.get(o.ev.id);
      const item = S.items.get(o.ev.id);
      if (a && item) { item.seq = a.seq; if (a.ts) item.ts = a.ts; item.local = false; }
      if (a) settleAppend(o.ev.id, null, a.seq);   // BUG-D
    });
    persistOutbox();
    notify('sent', { count: batch.length });
  } catch (err) {
    handleTransportError(err);
    batch.forEach(o => {
      o.attempts++;
      if (o.attempts >= MAX_ATTEMPTS) {
        S.failed.set(o.ev.id, o.ev);
        settleAppend(o.ev.id, new Error(`Append failed for ${o.ev.id}`));   // BUG-D
        notify('failed', { id: o.ev.id });
      } else {
        S.outbox.push(o);
      }
    });
    persistOutbox();
    if (S.outbox.length) setTimeout(flushOutbox, 2000 * Math.max(1, batch[0]?.attempts || 1));
  }
}

export function retryFailed(id) {
  const ev = S.failed.get(id);
  if (!ev) return;
  S.failed.delete(id);
  S.outbox.push({ ev, attempts: 0 });
  persistOutbox();
  scheduleFlush();
  // A UI refresh ping, not a delivery: no events changed hands, so it carries
  // the CURRENT liveness unchanged rather than an empty detail, which a
  // subscriber would have to classify blind (BUG-C).
  notify('events', { added: 0, caughtUp: S.caughtUp, wasCaughtUp: S.caughtUp });
}
export function isFailed(id) { return S.failed.has(id); }
export function isPending(id) {
  const m = S.items.get(id);
  return !!m && m.local && !S.failed.has(id);
}

// ── Append acknowledgement (BUG-D, 2026-09-11) ────────────────────────────────
// `sendEvent()` returns an id the instant the event is QUEUED — the event is
// still ~750ms of coalescing window away from the wire, and further away than
// that from a server-assigned seq. Anything that needs the SERVER to be able
// to see a message it just sent (today: the @scribe mention, whose whole
// request is "re-read message <id> out of CFBP_MESSAGES and answer it") must
// wait for that acknowledgement, not for the id.
//
// It lived here rather than in the caller because the outbox is the only place
// that knows the three outcomes: assigned (flushOutbox reconcile, or a poll
// that ingests our own event back), FAILED (MAX_ATTEMPTS exhausted — never
// silently dropped), or still in flight. Callers get a promise; the transport
// stays behind chatTransport.js (AD-16) and reads stay synchronous (AD-02) —
// nothing here changes how anything is READ.
const APPEND_ACK_TIMEOUT_MS = 20000;
const appendWaiters = new Map();   // id -> [{ resolve, reject, timer }]

function settleAppend(id, err, seq) {
  const list = appendWaiters.get(id);
  if (!list) return;
  appendWaiters.delete(id);
  list.forEach(w => { clearTimeout(w.timer); if (err) w.reject(err); else w.resolve(seq); });
}

/**
 * Resolves with the server-assigned seq once `id` has been acknowledged.
 * Rejects if the append FAILS, if it cannot be sent at all right now, or if
 * the bound elapses. Resolves immediately (with null) for an id this module
 * is not carrying — "nothing of ours to wait on" is not a failure, and the
 * caller's own server-side error handling stays the backstop for that case.
 */
export function whenAppended(id, { timeoutMs = APPEND_ACK_TIMEOUT_MS } = {}) {
  if (!id) return Promise.resolve(null);
  if (S.failed.has(id)) return Promise.reject(new Error(`Append failed for ${id}`));
  const item = S.items.get(id);
  if (item && !item.local) return Promise.resolve(item.seq);   // already acknowledged
  const queued = S.outbox.some(o => o.ev.id === id);
  if (!item && !queued) return Promise.resolve(null);          // not ours — see above
  // Nothing will flush while either of these is false (flushOutbox returns
  // early), so waiting the full bound would only delay an outcome we already
  // know. The event stays queued and persisted either way — this rejects the
  // WAIT, it never drops the message.
  if (!isBackendConfigured() || !isChatEnabled()) {
    return Promise.reject(new Error(`Append cannot be sent right now for ${id}`));
  }
  return new Promise((resolve, reject) => {
    const w = { resolve, reject, timer: null };
    w.timer = setTimeout(() => {
      const list = appendWaiters.get(id) || [];
      const i = list.indexOf(w);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) appendWaiters.delete(id);
      reject(new Error(`Append not acknowledged within ${timeoutMs}ms for ${id}`));
    }, timeoutMs);
    if (!appendWaiters.has(id)) appendWaiters.set(id, []);
    appendWaiters.get(id).push(w);
  });
}

function handleTransportError(err) {
  S.lastError = String(err?.message || err);
  if (err instanceof StaleDeploymentError || err?.stale) {
    S.staleDeployment = true;
    if (!S.offline) { S.offline = true; notify('offline', { error: S.lastError, stale: true }); }
  }
}

// ── Subscription (adaptive polling lives in the transport) ────────────────────
export function roomMode() {
  if (!S.viewOpen) return 'closed';
  let latest = 0;
  S.items.forEach(m => { if (m.type !== 'system' && (m.ts || 0) > latest) latest = m.ts || 0; });
  const age = Date.now() - latest;
  if (age < 2 * 60000) return 'hot';
  if (age < 15 * 60000) return 'warm';
  return 'idle';
}

export function setViewOpen(open) { S.viewOpen = !!open; }
/** Back-compat shim for app.js ('active' when the chat tab is showing). */
export function setPollMode(mode) { setViewOpen(mode === 'active'); }

// ── DI-169 — device-local raw-events cache (instant render on boot) ──────────
// What is cached: the RAW EVENT LIST exactly as chatTransport.js delivers it
// to ingest() (id/seq/ts/author/gameTag/body/replyTo/notify/meta/type/
// targetId) — NOT S.items (the folded state, whose values hold
// non-serializable Map fields: _reactOps/_pinOps/_feedbackOps) and NOT
// rendered HTML. Replaying through the same ingest()/applyTo() fold live data
// already uses means there is no second fold implementation to drift from the
// real one (AD-10/RG-06's reasoning).
const EVENTS_CACHE_MAX = 500;              // reuses chatTransport.js's PAGE_LIMIT — a CHOICE, not a fresh guess (DI-169c)
const EVENTS_CACHE_MAX_BYTES = 300 * 1024; // DI-169c — hard fallback bound in case a pathological meta/mentions payload inflates a small event count

// In-memory accumulation buffer for the CURRENT session's raw wire events —
// separate from S.items for the reason above. Seeded at boot from a valid
// cache read (readAndPrimeEventsCache(), below) so the write path merges onto
// real prior history instead of truncating it away on the very first live
// delivery of a fresh session.
let _eventsCacheBuf = [];

/** (ts, seq) order, oldest-trimmed-first — same pair comparison as cmpOrder()
 *  (AD-10), inlined here rather than imported since cmpOrder() reads folded
 *  item shape (`.ts`/`.seq` on an object) and this sorts raw wire events,
 *  which happen to share those two field names but are not the same shape. */
function _trimEventsCacheBuf() {
  _eventsCacheBuf.sort((a, b) => (a?.ts || 0) - (b?.ts || 0) || (a?.seq || 0) - (b?.seq || 0));
  if (_eventsCacheBuf.length > EVENTS_CACHE_MAX) {
    _eventsCacheBuf = _eventsCacheBuf.slice(_eventsCacheBuf.length - EVENTS_CACHE_MAX);
  }
  // Trim from the oldest end until back under the byte budget, costed with a
  // RUNNING total rather than re-stringifying the whole buffer once per
  // dropped element (reviewer note, 2026-09-11 — that was O(n²) on the exact
  // input that reaches it, a buffer big enough to be over budget). The
  // accounting is exact, not an estimate: JSON.stringify(array) is
  // '[' + parts.join(',') + ']', so its length is sum(part lengths) +
  // (n - 1) commas + 2 brackets — i.e. sum(len + 1) + 1.
  if (_eventsCacheBuf.length > 1) {
    const sizes = _eventsCacheBuf.map(e => JSON.stringify(e).length + 1);
    let total = sizes.reduce((a, b) => a + b, 0) + 1;
    let drop = 0;
    while (_eventsCacheBuf.length - drop > 1 && total > EVENTS_CACHE_MAX_BYTES) { total -= sizes[drop]; drop++; }
    if (drop) _eventsCacheBuf = _eventsCacheBuf.slice(drop);
  }
}

/**
 * DI-169c — write policy. Called ONLY from the transport subscription
 * callback (_subscribeNow(), below), and only when `delivery.caughtUp` is
 * true — never a mid-walk page, which would cache a `head` the events don't
 * actually reach (BUG-B's exact shape in a new location). Not hooked into
 * ingest() generically: ingest() is also called by sendEvent() (local
 * optimistic sends) and backfill() (older history), and hooking the
 * transport callback specifically is what structurally excludes outbox/
 * FAILED items and backfilled history from ever entering the cache, rather
 * than relying on a separate check to keep them out.
 *
 * No separate debounce timer (unlike persistOutbox()'s 750ms coalescing
 * window) — a caught-up delivery already only fires once per poll interval
 * (5-60s depending on roomMode), so writing synchronously here is not a hot
 * loop.
 */
function writeEventsCache(head) {
  try {
    localStorage.setItem(K_EVENTS_CACHE, JSON.stringify({
      epoch: getChatEpochSeq(), head: Number(head) || 0, events: _eventsCacheBuf,
    }));
  } catch { /* quota / private browsing — never blocks a real message send, DI-169e */ }
}

/**
 * DI-169d/e — read policy + invalidation. Called once, from initChat(),
 * BEFORE _subscribeNow()/flushOutbox() reach the network. Epoch mismatch (a
 * commissioner "Clear Chat History" on another device since this cache was
 * written) drops the whole cache — boots with nothing until live data
 * arrives, same as today's behaviour, never a stale or partial replay.
 * Corrupt JSON: ignore, warn, boot as if no cache existed (same shape
 * loadOutbox() already uses for its own guarded parse).
 */
function readAndPrimeEventsCache() {
  let parsed;
  try {
    const raw = localStorage.getItem(K_EVENTS_CACHE);
    if (!raw) return;
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('[chat] corrupt events cache, ignoring', e);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.events)) return;
  if (parsed.epoch !== getChatEpochSeq()) {
    // DI-169e — epoch mismatch, drop. REMOVE it as well as ignoring it
    // (reviewer note, 2026-09-11): a superseded cache is dead weight that can
    // never be read again, and leaving it in place holds its bytes against
    // the localStorage quota that the NEXT (valid) write needs — a quota
    // failure there is silent by design (writeEventsCache()'s catch), so it
    // would show up as "the cache just stopped working," not as an error.
    try { localStorage.removeItem(K_EVENTS_CACHE); } catch {}
    return;
  }
  _eventsCacheBuf = parsed.events.slice();          // seed so the next real write merges onto real history
  // DI-169d — caughtUp: false, UNCONDITIONALLY: a cached replay is never a
  // live delivery reaching today's true head, regardless of what the cache
  // itself recorded at write time. fromCache: true threads through ingest()'s
  // notify detail so chat-ui.js can suppress the toast/blip/push-relay path
  // for THIS delivery without suppressing badge/render (instant render from
  // the cache is the entire point) — see DI-169d's required guard.
  //
  // The cached head IS adopted as the poll cursor here (ingest() sets S.head
  // from the `head` argument below) — this is the design's second win, not a
  // side effect: chatTransport.js's subscribe() reads getKnownHead() on its
  // very first tick, which now returns this non-zero cached head instead of
  // 0, so that first tick takes the known>0 branch (a cheap chatHead probe,
  // then an INCREMENTAL chatSince(cachedHead) only if something changed)
  // rather than RG-91's known===0 branch (a full chatSince(0, 500) cold
  // read). No chatTransport.js change was needed for this — it falls out of
  // existing branching once S.head is non-zero before subscribe() is called.
  ingest(parsed.events, parsed.head, { caughtUp: false, fromCache: true });
}

/** Force-(re)subscribes regardless of current subscription state — used by
 *  initChat() (selfId may have changed on re-login) and by the enabled-toggle
 *  when going from OFF to ON. Unconditional: callers gate on isChatEnabled(). */
function _subscribeNow() {
  if (S.unsub) S.unsub();
  const sub = subscribe(
    (events, head, delivery) => {
      ingest(events, head, delivery);
      // DI-169c — accumulate every raw wire event this session sees
      // (including a mid-walk page of a big drain — it is real, legitimate
      // history that arrived through the transport), but only TRIM + WRITE
      // to localStorage once a delivery actually reaches the head. Writing
      // mid-walk would persist a head the buffered events don't reach yet.
      // RG-101 / BUG-H — the write is gated on the delivery actually
      // CARRYING events, not on caughtUp alone. As of the transport's
      // RG-101 fix an idle poll (nothing new since last tick) now reports an
      // empty caught-up delivery on EVERY interval; without this gate each
      // one would re-stringify and re-write the entire buffer (up to
      // EVENTS_CACHE_MAX_BYTES = 300KB) to localStorage for no change at
      // all. Nothing is lost by skipping it: _eventsCacheBuf only ever grows
      // on the line above, so an empty delivery leaves it byte-identical to
      // what the last write already persisted.
      if (events && events.length) {
        _eventsCacheBuf.push(...events);
        if (delivery?.caughtUp === true) { _trimEventsCacheBuf(); writeEventsCache(head); }
      }
    },
    {
      getMode: roomMode,
      getKnownHead: () => S.head,
      onStatus: (s, detail) => {
        if (s === 'online') { S.offline = false; S.staleDeployment = false; notify('online'); }
        if (s === 'offline') {
          S.offline = true;
          if (detail?.stale) S.staleDeployment = true;
          S.lastError = detail?.error || '';
          notify('offline', detail);
        }
      },
    }
  );
  // DI-168f — subscribe() now returns a function that is BOTH directly
  // callable (unsubscribe) and carries `.unsubscribe`/`.forceTick` as
  // properties (see chatTransport.js's own comment on this for why both
  // shapes coexist). S.unsub keeps its existing bare-callable contract
  // (_resetForTest(), refreshChatEnabled(), the OFF branch below all already
  // call it as `S.unsub()`); S.forceTick is new, DI-168's addition.
  S.unsub = sub.unsubscribe;
  S.forceTick = sub.forceTick;
}

/**
 * DI-168 — manual chat refresh. Reuses the EXACT tick()/drainSince() path the
 * transport's own visibilitychange fast path and interval poll already use —
 * no new fetch path, no new Apps Script action (DI-168h). Returns a promise
 * that RESOLVES when the forced check succeeds and REJECTS when it fails, so
 * chat-ui.js's button can drive Checking -> Updated/Failed off promise
 * settlement alone (DI-168f item 5), rather than a new pub/sub channel.
 *
 * A coalesced call (another check — the background poll, onVis, or another
 * forceRefresh() — already in flight in the transport) resolves WITHOUT
 * throwing: the transport's own `inFlight` guard already ensured exactly one
 * network round trip is in progress, and this particular call did no work of
 * its own to report success or failure on. Under real UI use this is
 * unreachable (chat-ui.js's button disables itself while checking, DI-168f
 * item 3's belt-and-suspenders UI guard) — it only matters to a caller that
 * bypasses that guard, e.g. cachetest.mjs's double-tap assertion.
 */
export async function forceRefresh() {
  if (!S.forceTick) return;             // not subscribed (chat off, or not yet booted) — nothing to force
  const ok = await S.forceTick();
  if (ok === null) return;              // coalesced no-op — see doc comment above
  if (!ok) throw new Error('Chat refresh failed');
}

export function initChat(selfId) {
  S.selfId = selfId || S.selfId;
  // UN-112 (DI-112b) — device-local self-heal, MUST run before loadOutbox()/
  // flushOutbox(). flushOutbox() fires unconditionally below on every boot;
  // without this check-first, a device with a stale queued message would
  // re-send test chatter into the freshly-cleared room the moment it next
  // opens the app. Gated on a device-local watermark (not just "epoch > 0")
  // so this runs exactly once per epoch bump, not on every boot.
  const epochSeq = getChatEpochSeq();
  if (epochSeq > localEpochApplied()) _applyEpochLocally(epochSeq);
  loadOutbox();
  // v0.17.2 — presence was removed; drop its orphaned device-local key so it
  // doesn't linger as a mystery on already-deployed devices.
  try { localStorage.removeItem('cfbp_chat_seenmap'); } catch {}
  // Batch 3+4 item A — chat OFF must mean ZERO network activity, not a slower
  // poll. roomMode()==='closed' still ticks every 60s forever (INTERVALS in
  // chatTransport.js) — that is NOT "stopped", it is "throttled", and it keeps
  // burning Apps Script quota indefinitely. Only NOT subscribing at all (no
  // timer scheduled) satisfies "stop chat polling entirely."
  if (isChatEnabled()) {
    // DI-169d — instant render from the device-local cache, BEFORE
    // _subscribeNow()/flushOutbox() reach the network (priming S.head here is
    // also what makes the subscription's first tick an INCREMENTAL read).
    // INSIDE the isChatEnabled() gate (reviewer note, 2026-09-11): chat OFF
    // must mean no chat, not just no polling — replaying a cache into the
    // fold with chat disabled would repopulate badges and message lists for a
    // player who turned it off. Runs after the epoch heal above, so a cache
    // written under a just-superseded epoch is compared against the CURRENT
    // settings.chatEpochSeq and correctly dropped; its position relative to
    // loadOutbox() is a readability choice, not a correctness one (ingest()
    // is order-independent, AD-10).
    readAndPrimeEventsCache();
    _subscribeNow();
    flushOutbox();
  }
  else if (S.unsub) { S.unsub(); S.unsub = null; S.forceTick = null; }
}

/**
 * Starts or stops the poll loop to match the current settings.chatEnabled
 * value. Idempotent — safe to call on every navigation and on a periodic
 * timer without thrashing an already-correct subscription (unlike initChat(),
 * which always force-resubscribes). This is the function the commissioner's
 * Settings toggle calls for an immediate same-device effect, and the one a
 * periodic UI-sync tick calls to catch a value that changed via hydrate.
 */
export function refreshChatEnabled() {
  const enabled = isChatEnabled();
  if (enabled && !S.unsub) { _subscribeNow(); flushOutbox(); }
  else if (!enabled && S.unsub) { S.unsub(); S.unsub = null; S.forceTick = null; }
}

export async function backfill(limit = 100) {
  // Reachable only from the "load earlier" control, which is hidden while
  // chat is off — guarded anyway so a stray call can never cause traffic.
  if (!isBackendConfigured() || !isChatEnabled() || S.backfillLow === null || S.backfillLow <= 1) return 0;
  try {
    const { events } = await fetchBefore(S.backfillLow, limit);
    // "Load earlier" is older history by construction — never a live delivery,
    // and never a reason to declare the forward walk caught up (BUG-C).
    return ingest(events, undefined, { caughtUp: S.caughtUp });
  } catch (err) { handleTransportError(err); return 0; }
}

// ── Presence + read receipts: REMOVED in v0.17.2 (AD-19 amended) ─────────────
// "N here now" and "seen by k" both rode a 90s CacheService heartbeat, so the
// indicator could be wrong by up to 90 seconds — someone who closed the app a
// minute ago still read as present. Spec §4.5: a wrong presence indicator is
// worse than none, and reliable "actively viewing" detection is not achievable
// on a polling transport. Do not re-add without re-opening AD-19.
//
// `lastSeenSeq` / getLastSeen / markSeen / unreadCount below are a SEPARATE
// feature (device-local unread counts, AD-12). Presence merely piggybacked on
// lastSeenSeq; unread tracking never depended on presence and still works.

// ── Unread (notifying events only — ambient never badges) ─────────────────────
export function getLastSeen() {
  try { return { seq: 0, byTag: {}, ...(JSON.parse(localStorage.getItem(K_LASTSEEN) || '{}')) }; }
  catch { return { seq: 0, byTag: {} }; }
}
function putLastSeen(v) { try { localStorage.setItem(K_LASTSEEN, JSON.stringify(v)); } catch {} }

/**
 * Advance the read position. MONOTONIC — a cursor never moves backward.
 *
 * v0.17.3 (caught in review, pre-deploy): this used to assign S.head
 * unconditionally. S.head is 0 until the first poll returns, and Apps Script
 * cold starts run 10-20s (ledger §5) while the chat mark timer fires at 1s.
 * A player who opened the app, tapped Chat during the cold start, and backed
 * out had their cursor reset to 0 — so every message they had already read
 * counted as unread again, and every game bubble lit up claiming unread they
 * cleared yesterday. Nothing in this app ever legitimately rewinds a cursor.
 *
 * Guarded by loadtest §[17b].
 */
export function markSeen(tag = 'all') {
  const ls = getLastSeen();
  const fwd = (cur) => Math.max(Number(cur) || 0, S.head);
  if (tag === 'all') {
    ls.seq = fwd(ls.seq);
    Object.keys(ls.byTag).forEach(t => { ls.byTag[t] = fwd(ls.byTag[t]); });
  } else {
    ls.byTag[tag] = fwd(ls.byTag[tag]);
  }
  putLastSeen(ls);
  notify('seen', { tag });
}

/**
 * THE read cursor that applies to a message carrying `tag`.
 *
 * Read state is TWO-LEVEL (AD-12): markSeen('all') advances the room cursor
 * `.seq` (and every tag it already knows about), while markSeen(gameId) —
 * what openGameChatSheet() calls — advances ONLY `byTag[gameId]`. Opening one
 * game thread is not reading the room, and reading the room is reading every
 * thread. A message is "read" when it sits at or below the cursor for ITS OWN
 * tag, which falls back to the room cursor for a tag never opened.
 *
 * Defined ONCE, deliberately: unreadCount(), unreadAuthors(),
 * latestUnreadNotifying() and chat-ui's notifAckThroughSeq() all route
 * through it. A second copy of this expression is exactly how the dashboard
 * teaser came to disagree with the unread badge about what "read" means.
 */
function readCursorFor(ls, tag) {
  return (tag && tag !== 'all') ? (ls.byTag[tag] ?? ls.seq) : ls.seq;
}

/** Public accessor for the same cursor — chat-ui's toast gate needs the
 *  tag-aware "read through seq N" number without re-deriving it. */
export function readThroughSeq(tag = 'all') {
  return Number(readCursorFor(getLastSeen(), tag)) || 0;
}

function isUnreadFor(m, selfId, afterSeq, cutoff = retentionCutoff()) {
  // A message hidden by retention can never count toward unread — a player
  // who can't scroll to it should never see a badge promising it's there.
  if (_hiddenBy(cutoff, m)) return false;
  // UN-112 — the second (and last) choke point. Feeds unreadCount /
  // unreadAuthors / mentionUnreadCount, which in turn feed the title badge,
  // the PWA badge, per-game bubbles, and filter pills. Fixed once here.
  if (isHiddenByEpoch(m)) return false;
  return m.type === 'message' && !m.deleted && m.notify &&
         typeof m.seq === 'number' && m.seq > afterSeq && m.author !== selfId;
}

export function unreadCount(selfId, tag = 'all') {
  const ls = getLastSeen();
  const after = readCursorFor(ls, tag);
  const cutoff = retentionCutoff();          // resolved once, not per message
  let n = 0;
  S.items.forEach(m => {
    if (tag !== 'all' && (m.gameTag || '') !== tag) return;
    if (isUnreadFor(m, selfId, after, cutoff)) n++;
  });
  return n;
}

/**
 * Distinct author ids behind a tag's UNREAD count, in first-seen order —
 * same predicate as unreadCount(), just collecting authors instead of a
 * tally. Feeds the game-card bubble's attribution (item B): "who is this
 * unread FROM" rather than just "how many".
 */
export function unreadAuthors(selfId, tag = 'all') {
  const ls = getLastSeen();
  const after = readCursorFor(ls, tag);
  const cutoff = retentionCutoff();
  const seen = new Set();
  const out = [];
  S.items.forEach(m => {
    if (tag !== 'all' && (m.gameTag || '') !== tag) return;
    if (!isUnreadFor(m, selfId, after, cutoff)) return;
    if (!seen.has(m.author)) { seen.add(m.author); out.push(m.author); }
  });
  return out;
}

export function mentionUnreadCount(selfId) {
  const ls = getLastSeen();
  return getMessages({ tag: 'all', mentionsOf: selfId }).filter(m => isUnreadFor(m, selfId, ls.seq)).length;
}

/**
 * v0.17.4 (UN-102b, batch 2): excludes the viewer's OWN messages, using the
 * exact `m.author !== selfId` expression `isUnreadFor()` (above) already
 * applies for the same reason — a message can never notify its own author.
 * Both callers (the toast in chat-ui.js and the dashboard teaser) want "the
 * latest thing notifying ME", not "the latest thing, period" — the toast path
 * already re-derived this filter manually after the call; folding it in here
 * removes the need for a second, easy-to-forget copy at each call site. Bug
 * this fixes: the dashboard teaser called this with no author filter, so
 * sending your own message could resurrect your own dismissed teaser showing
 * your own text back at you.
 */
export function latestNotifying(selfId) {
  let best = null;
  S.items.forEach(m => {
    if (m.type !== 'message' || m.deleted || !m.notify) return;
    if (m.author === selfId) return;                    // never surface the viewer's own post
    if (isHiddenByRetention(m)) return;                // don't preview a message the reader can't open
    // UN-112 (beyond DI-112a's two named choke points — flagged in the
    // handoff): this function reads S.items directly rather than going
    // through getMessages(), exactly like retentionStats()/chatDigest() —
    // but unlike those two, it feeds READER-FACING preview text (the
    // dashboard teaser body, chat-ui.js). It already carries its own
    // isHiddenByRetention() check immediately above for that reason. Mirrors
    // that existing pattern rather than inventing a new one — without this,
    // a pre-epoch test message could still surface as the dashboard's chat
    // preview even though every other surface has forgotten it.
    if (isHiddenByEpoch(m)) return;
    if (!best || cmpOrder(m, best) > 0) best = m;   // AD-10 — ordered pair, see cmpOrder()
  });
  return best;
}

/**
 * The newest notifying message that is still UNREAD for `selfId`, or null.
 *
 * Same fold, same ordering (AD-10) and the same own-author / retention /
 * epoch exclusions as latestNotifying() above — all of them already live
 * inside isUnreadFor(), which is reused here rather than re-listed, so the
 * two surfaces can never drift apart on what counts as "notifying me". The
 * addition is the fall-through: a message the reader has already read — in
 * the room OR inside its own game thread (readCursorFor) — is skipped and
 * the search continues to the next one down.
 *
 * `floorSeq` is the caller's acknowledgement watermark (chat-ui's ✕
 * dismissal); messages at or below it are skipped too. That key belongs to
 * chat-ui, so it is passed in rather than read here.
 *
 * Why this exists: the dashboard teaser gated on the ROOM cursor alone, so
 * reading a message inside its game thread left unreadCount(tag) at 0 while
 * the teaser kept announcing that exact message. A per-tag read still must
 * NOT silence an unrelated unread room message — hence "fall through to the
 * next one", not "suppress the card".
 */
export function latestUnreadNotifying(selfId, floorSeq = 0) {
  const ls = getLastSeen();
  const cutoff = retentionCutoff();
  const floor = Number(floorSeq) || 0;
  let best = null;
  S.items.forEach(m => {
    if (typeof m.seq !== 'number' || m.seq <= floor) return;   // at/below the ✕ dismissal
    if (!isUnreadFor(m, selfId, readCursorFor(ls, m.gameTag || 'all'), cutoff)) return;
    if (!best || cmpOrder(m, best) > 0) best = m;   // AD-10 — ordered pair, see cmpOrder()
  });
  return best;
}

// ── Weekly digest (client-side — AD-13) ───────────────────────────────────────
export function chatDigest(startMs, endMs, ctx = {}) {
  const players = ctx.players || [];
  const nameOf = pid => players.find(p => p.playerId === pid)?.displayName || pid;
  const inRange = m => (m.ts || 0) >= startMs && (m.ts || 0) <= endMs;
  const msgs = getMessages({ tag: 'all', types: ['message'] }).filter(m => inRange(m) && !m.deleted);
  const human = msgs.filter(m => m.author !== 'system' && m.author !== 'scribe');

  const byPlayer = {};
  human.forEach(m => { byPlayer[m.author] = (byPlayer[m.author] || 0) + 1; });

  // Peak hour + longest silence
  const hours = {};
  human.forEach(m => {
    const h = new Date(m.ts).toISOString().slice(0, 13) + ':00Z';
    hours[h] = (hours[h] || 0) + 1;
  });
  const peakHour = Object.entries(hours).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  let longestSilenceHours = null;
  if (human.length > 1) {
    let max = 0;
    for (let i = 1; i < human.length; i++) max = Math.max(max, human[i].ts - human[i - 1].ts);
    longestSilenceHours = Math.round(max / 3600000 * 10) / 10;
  }

  const reactionCount = m => Object.values(m.reactions || {}).reduce((a, v) => a + v.length, 0);
  const topReacted = [...human].map(m => ({ id: m.id, author: m.author, body: m.body.slice(0, 200), reactionCount: reactionCount(m) }))
    .filter(m => m.reactionCount > 0).sort((a, b) => b.reactionCount - a.reactionCount).slice(0, 10);

  const mentions = {};
  human.forEach(m => (m.meta?.mentions || []).forEach(pid => { mentions[pid] = (mentions[pid] || 0) + 1; }));

  // preBustBoast: tagged (or team-named) message pre-kick by a player who lost that game ATS
  const games = ctx.games || [];
  const losses = ctx.atsLossesByPlayer || {};
  const preBustBoast = [];
  human.forEach(m => {
    const lostGames = losses[m.author] || [];
    let g = m.gameTag ? games.find(x => x.gameId === m.gameTag) : null;
    if (!g) {
      g = games.find(x => (losses[m.author] || []).includes(x.gameId) &&
        (m.body.toLowerCase().includes((x.homeTeam || '').toLowerCase()) ||
         m.body.toLowerCase().includes((x.awayTeam || '').toLowerCase())));
    }
    if (g && lostGames.includes(g.gameId) && g.kickoff && m.ts < new Date(g.kickoff).getTime()) {
      preBustBoast.push({ author: m.author, body: m.body.slice(0, 200), gameId: g.gameId, ts: m.ts, id: m.id,
        note: `posted pre-kick on ${g.awayTeam} @ ${g.homeTeam}; lost that game ATS` });
    }
  });

  // beefs: two players naming each other within 5 minutes
  const beefs = [];
  for (let i = 0; i < human.length; i++) {
    for (let j = i + 1; j < human.length && human[j].ts - human[i].ts < 5 * 60000; j++) {
      const a = human[i], b = human[j];
      if (a.author === b.author) continue;
      const aName = nameOf(a.author).toLowerCase(), bName = nameOf(b.author).toLowerCase();
      if (a.body.toLowerCase().includes(bName) && b.body.toLowerCase().includes(aName)) {
        beefs.push({ players: [a.author, b.author], messageIds: [a.id, b.id] });
      }
    }
  }

  // Engagement instrumentation (spec: decides whether push gets pulled forward)
  const days = {};
  human.forEach(m => { const d = new Date(m.ts).toISOString().slice(0, 10); (days[d] = days[d] || new Set()).add(m.author); });
  const dau = Object.entries(days).map(([date, set]) => ({ date, players: set.size }));
  const reacted = human.filter(m => reactionCount(m) > 0).length;
  const replyGaps = [];
  human.forEach(m => {
    if (!m.replyTo) return;
    const parent = S.items.get(m.replyTo);
    if (parent?.ts) replyGaps.push((m.ts - parent.ts) / 60000);
  });
  replyGaps.sort((a, b) => a - b);
  const medianReplyMinutes = replyGaps.length ? Math.round(replyGaps[Math.floor(replyGaps.length / 2)]) : null;

  return {
    week: ctx.week ?? null,
    volume: { byPlayer, peakHour, longestSilenceHours, total: human.length },
    topReacted, mentions, preBustBoast, beefs,
    quotables: topReacted.slice(0, 10).map(t => ({ author: t.author, body: t.body, id: t.id })),
    engagement: {
      dau,
      reactionRate: human.length ? Math.round(reacted / human.length * 100) / 100 : 0,
      medianReplyMinutes,
    },
  };
}

// ── Test hooks ────────────────────────────────────────────────────────────────
export function _resetForTest() {
  if (S.unsub) { S.unsub(); S.unsub = null; }             // no dangling timers across test sections
  S.forceTick = null;                                     // DI-168 — same lifecycle as S.unsub, above
  S.items.clear(); S.buffered.clear(); S.head = 0; S.outbox = []; S.failed.clear();
  S.offline = false; S.staleDeployment = false;
  S.backfillLow = null; S.viewOpen = false; S.caughtUp = false;
  _eventsCacheBuf = [];                                   // DI-169 — no leaking raw events into the next test section's writes
  // DI-169 — UNLIKE K_LASTSEEN/K_OUTBOX/K_EPOCH_APPLIED above (whose
  // persistence across _resetForTest() is harmless — they're read on demand
  // by specific functions, not unconditionally on every initChat()), a stale
  // K_EVENTS_CACHE left in localStorage feeds DIRECTLY into S.head/
  // getKnownHead() the moment the NEXT test section calls initChat(), via
  // readAndPrimeEventsCache() — silently priming a poll cursor from a
  // PRIOR, unrelated test's writes. Cleared here so "no dangling state
  // across test sections" (this function's whole purpose) actually holds for
  // it too. Production code never calls _resetForTest() — this changes no
  // real-device behavior.
  try { localStorage.removeItem(K_EVENTS_CACHE); } catch {}
  appendWaiters.forEach((list, id) => list.forEach(w => { clearTimeout(w.timer); w.reject(new Error(`Chat reset while waiting on ${id}`)); }));
  appendWaiters.clear();                                  // BUG-D — no dangling timers across test sections
}
/** Item A (batch 3+4) — the only way to observe from OUTSIDE this module
 *  whether the poll loop is actually running (S.unsub is intentionally
 *  private). Answers the literal hazard: "prove polling stops." */
export function _isPollingActiveForTest() { return !!S.unsub; }
/**
 * UN-159/UN-160 — `_feedbackOps` folds via a Map, so `target.feedback`'s own
 * key order (playerId, and category within each playerId) reflects EVENT
 * ARRIVAL order, not anything semantic. A shuffle-fold-identical proof must
 * sort both levels before serializing, or two folds holding the exact same
 * feedback VALUES could still produce two different JSON strings purely from
 * insertion-order — a false failure, not a real divergence.
 */
function sortedFeedback(fb) {
  // Prototype-pollution guard, same reasoning/shape as applyTo()'s 'feedback'
  // branch above — hardened identically per reviewer finding #3, even though
  // applyTo() already rejects a poisoned author/category at the door (this is
  // the SAME test-serialization path _foldedSnapshot() uses, and a future
  // caller could hand this function an object built some other way).
  const out = {};
  Object.keys(fb).sort().forEach(pid => {
    if (isUnsafeKey(pid)) return;
    const cats = {};
    Object.keys(fb[pid]).sort().forEach(c => { if (!isUnsafeKey(c)) cats[c] = fb[pid][c]; });
    out[pid] = cats;
  });
  return out;
}
export function _foldedSnapshot() {
  const list = getMessages({ tag: 'all' }).map(m => ({
    id: m.id, seq: m.seq, ts: m.ts, author: m.author, tag: m.gameTag, body: m.body,
    edited: m.edited, deleted: m.deleted, pinned: m.pinned, notify: m.notify,
    reactions: Object.fromEntries(Object.entries(m.reactions).map(([e, who]) => [e, [...who].sort()])),
    feedback: sortedFeedback(m.feedback || {}),
  }));
  return JSON.stringify(list);
}
