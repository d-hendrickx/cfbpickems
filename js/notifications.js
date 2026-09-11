/**
 * CFB Pickems — Notifications Module (Phase III PREP — NOT YET ACTIVE)
 *
 * Purpose: give a stable seam for SMS/email "All Picks by Game" status updates
 * without building the delivery pipeline yet. Nothing here sends anything today;
 * every send funnels through a single `dispatch()` that currently no-ops (logs
 * in dev). When you wire a real provider (Twilio for SMS, Resend/SES/Postmark
 * for email — or a Google Apps Script proxy once the Sheets backend exists),
 * you implement ONE function (`registerProvider`) and the rest works.
 *
 * Design intent:
 *  - Pure functions that BUILD messages are separated from the IMPULSE to send.
 *    This keeps message formatting unit-testable with no network.
 *  - Channels (sms/email) and events (picksOpen, picksReminder, gameFinal,
 *    weeklyRecap) are enumerated so opt-in prefs on the player object line up 1:1.
 *  - An outbox queue is kept in memory (and can later be persisted) so retries
 *    and "what would have been sent" auditing are possible.
 *
 * IMPORTANT: This module is imported lazily by app code behind a feature flag
 * (settings.notificationsEnabled). Today that flag is false, so none of this runs.
 */

export const NOTIFY_CHANNELS = { SMS: 'sms', EMAIL: 'email' };

export const NOTIFY_EVENTS = {
  PICKS_OPEN:      'picksOpen',      // week opened for picks
  PICKS_REMINDER:  'picksReminder',  // X hours before lock, player hasn't submitted
  GAME_FINAL:      'gameFinal',      // a game on the slate went final
  WEEKLY_RECAP:    'weeklyRecap',    // week finalized — standings + winner/loser
};

// ── Provider registration ─────────────────────────────────────────────────────
// A provider implements: async send({ channel, to, subject, body, meta }) -> {ok, id?, error?}
// Until one is registered, dispatch() no-ops (dev: console.log).
let _provider = null;
export function registerProvider(providerImpl) { _provider = providerImpl; }
export function hasProvider() { return !!_provider; }

// ── In-memory outbox (later: persist to storage or push to backend) ────────────
const _outbox = [];
export function getOutbox() { return [..._outbox]; }
export function clearOutbox() { _outbox.length = 0; }

// ── Message builders (PURE — safe to unit test, no side effects) ───────────────

/** Build the per-player "all picks by game" status text for a week. */
export function buildPicksStatusMessage({ playerName, weekLabel, rows }) {
  // rows: [{ matchup, pick, status }] where status in win|loss|live|pending|no_decision
  const icon = { win:'✓', loss:'✗', no_decision:'—', live:'•', pending:'·' };
  const lines = (rows || []).map(r => `${icon[r.status] || '·'} ${r.matchup}: ${r.pick}`);
  const body = `${playerName} — ${weekLabel}\n${lines.join('\n')}`;
  return { subject: `Your picks — ${weekLabel}`, body };
}

/** Build a "picks are open" nudge. */
export function buildPicksOpenMessage({ playerName, weekLabel, lockTimeStr }) {
  return {
    subject: `Picks open — ${weekLabel}`,
    body: `${playerName}, picks for ${weekLabel} are open. Lock${lockTimeStr ? `s ${lockTimeStr}` : 's soon'}. Get 'em in.`,
  };
}

/** Build a weekly recap. */
export function buildWeeklyRecapMessage({ weekLabel, winnerName, loserName, leaderName }) {
  const parts = [`${weekLabel} is final.`];
  if (winnerName) parts.push(`🏆 ${winnerName} took the week.`);
  if (loserName)  parts.push(`💀 ${loserName} is on the hook.`);
  if (leaderName) parts.push(`👑 Season leader: ${leaderName}.`);
  return { subject: `${weekLabel} recap`, body: parts.join(' ') };
}

// ── Eligibility — who should receive a given event on a given channel ──────────

/** Returns true if the player has opted into (channel, event) and is reachable. */
export function isEligible(player, channel, event) {
  if (!player || !player.active) return false;
  const prefs = player.notifyPrefs?.[channel];
  if (!prefs?.enabled || !prefs?.[event]) return false;
  if (channel === NOTIFY_CHANNELS.SMS)   return !!player.phone && !!player.phoneVerified;
  if (channel === NOTIFY_CHANNELS.EMAIL) return !!player.email;
  return false;
}

/** Resolve the destination address for a channel. */
function addressFor(player, channel) {
  return channel === NOTIFY_CHANNELS.SMS ? player.phone : player.email;
}

// ── Dispatch — the ONE place anything is "sent" ────────────────────────────────
// Today: queues to outbox and no-ops (or logs in dev). Later: calls _provider.send.

export async function dispatch({ channel, event, player, message, meta = {} }) {
  const entry = {
    queuedAt: new Date().toISOString(),
    channel, event,
    to: addressFor(player, channel),
    playerId: player?.playerId,
    subject: message?.subject,
    body: message?.body,
    meta,
    status: 'queued',
  };
  _outbox.push(entry);

  if (!_provider) {
    // Phase III not wired yet — record intent only.
    if (typeof console !== 'undefined') console.debug('[notifications] (no provider) would send:', entry);
    entry.status = 'noop';
    return { ok: false, noop: true };
  }

  try {
    const res = await _provider.send({ channel, to: entry.to, subject: entry.subject, body: entry.body, meta });
    entry.status = res?.ok ? 'sent' : 'failed';
    entry.providerId = res?.id || null;
    entry.error = res?.error || null;
    return res;
  } catch (err) {
    entry.status = 'failed';
    entry.error = String(err?.message || err);
    return { ok: false, error: entry.error };
  }
}

/**
 * Fan out one event to all eligible players across all channels.
 * `buildFor(player, channel)` returns the {subject, body} message for that player.
 * Returns a summary { attempted, eligible, results: [...] }.
 */
export async function notifyAll({ players, event, buildFor, meta = {} }) {
  const channels = [NOTIFY_CHANNELS.SMS, NOTIFY_CHANNELS.EMAIL];
  const results = [];
  let eligible = 0;
  for (const player of players || []) {
    for (const channel of channels) {
      if (!isEligible(player, channel, event)) continue;
      eligible++;
      const message = buildFor(player, channel);
      results.push(await dispatch({ channel, event, player, message, meta }));
    }
  }
  return { attempted: results.length, eligible, results };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GROUPS A/B — IN-APP + PUSH NOTIFICATION POLICY LAYER (UN-139…UN-148)
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything above this line is the pre-existing SMS/EMAIL Phase-III prep
 * stub (UN-36, v0.11) — untouched, still inert. Everything below is new:
 * DESIGN_INPUTS_BATCH1_091026.md, Document 1, §§2–7. This is the ONE place
 * recipient/preference/suppression/dedup/intent logic lives (DI-A1) — every
 * call site below routes through here rather than re-implementing any piece
 * of this pipeline locally (grep for a second implementation is a fail, per
 * DI-A1's own verification note).
 *
 * Reused, not duplicated (§0's grounded-reuse table):
 *   - player.preferences.notifyCategories.* / notifyPushMaster — storage.js
 *   - onChat() subscription — chat.js:62 (chat.js itself is UNCHANGED)
 *   - WEEK_STATUS vocabulary — data-model.js:231
 *   - the SCRIBE fact-substitution contract — js/notify-copy.js (a NEW,
 *     separately-owned module; see that file's header for why it isn't
 *     js/scribeLines.js in this build)
 */

import { onChat, getMessages, chatStatus } from './chat.js';
import {
  getPlayers, getPlayer, getWeek, getNotifications, setNotifications,
  getNotifyPushMasterFor, getNotifyCategoryPrefsFor,
} from './storage.js';
import { notifyPushRelay, notifyLogFetch } from './backend.js';
import { buildCopy, assertMetaIsBlindSafe } from './notify-copy.js';

// ── §2 event vocabulary (extends NOTIFY_EVENTS above — distinct string
//    values, so there is no collision with the inert SMS/EMAIL vocabulary) ──
export const LIFECYCLE_EVENTS = Object.freeze({
  PICKS_OPENED:               'PICKS_OPENED',
  PICKS_REMINDER:             'PICKS_REMINDER',
  PICKS_LOCKING_SOON:         'PICKS_LOCKING_SOON',
  PICKS_LOCKED:                'PICKS_LOCKED',
  RESULTS_FINALIZED:           'RESULTS_FINALIZED',
  OBLIGATION_CREATED:          'OBLIGATION_CREATED',
  OBLIGATION_SETTLED:          'OBLIGATION_SETTLED',
  CHAT_MESSAGE_CREATED:        'CHAT_MESSAGE_CREATED',
  COMMISSIONER_ANNOUNCEMENT:   'COMMISSIONER_ANNOUNCEMENT',
});

// ── §7/DI-A4 — category each event is gated by. `null` = never
//    category-gated (D3: commissioner announcements are not silenceable). ──
export const CATEGORY_OF_EVENT = Object.freeze({
  CHAT_MESSAGE_CREATED:        'chat',
  PICKS_OPENED:                'leagueUpdates',
  PICKS_REMINDER:              'pickReminders',
  PICKS_LOCKING_SOON:          'leagueUpdates',
  PICKS_LOCKED:                'leagueUpdates',
  RESULTS_FINALIZED:           'results',
  OBLIGATION_CREATED:          'obligations',
  OBLIGATION_SETTLED:          'obligations',
  COMMISSIONER_ANNOUNCEMENT:   null,
});

// ── DI-A5 — exact destination table. Every entry maps to an EXISTING
//    navigateTo() tab; no new routes invented. app.js's deep-link handler
//    (wired at boot) is the only caller that turns this into navigation. ──
const DEEP_LINK_TABLE = Object.freeze({
  CHAT_MESSAGE_CREATED:        { tab: 'chat',       params: (ctx) => ({ messageId: ctx.messageId || null }) },
  PICKS_OPENED:                { tab: 'picks',       params: () => ({}) },
  PICKS_REMINDER:              { tab: 'picks',       params: () => ({}) },
  PICKS_LOCKING_SOON:          { tab: 'picks',       params: () => ({}) },
  PICKS_LOCKED:                { tab: 'picks',       params: () => ({ view: 'submitted' }) },
  RESULTS_FINALIZED:           { tab: 'dashboard',   params: () => ({ section: 'results' }) },
  OBLIGATION_CREATED:          { tab: 'leaderboard', params: (ctx) => ({ section: 'obligations', playerId: ctx.playerId || null }) },
  OBLIGATION_SETTLED:          { tab: 'leaderboard', params: (ctx) => ({ section: 'obligations', playerId: ctx.playerId || null }) },
  COMMISSIONER_ANNOUNCEMENT:   { tab: 'dashboard',   params: () => ({}) },
});

/** DI-A5's exact destination table, resolved for one event. Every entry
 *  resolves to a valid, reachable app.js navigateTo() tab — no destination
 *  string that doesn't correspond to a real route (see §8 test). */
export function destinationFor(event, ctx = {}) {
  const entry = DEEP_LINK_TABLE[event];
  if (!entry) return { tab: 'dashboard', params: {} };
  return { tab: entry.tab, params: entry.params(ctx) };
}
export function _deepLinkTableForTest() { return DEEP_LINK_TABLE; }

// ── §4 — dedup key. `${event}|${weekId||''}|${threshold||''}|${playerId}` —
//    deterministic, so a retried Apps Script trigger or six simultaneously-
//    detecting clients collapse to one send. Modeled directly on
//    scribeLines.js's scribe_<trigger>_<subject>_<timeBucket> id pattern. ──
export function makeDedupKey({ event, weekId = '', threshold = '', playerId }) {
  return `${event}|${weekId || ''}|${threshold || ''}|${playerId}`;
}

/**
 * ── REMEDIATION (2026-09-10) — reviewer-recommended resolution, REPLACES
 * correction #4's earlier "category off = off for both intents" reading.
 *
 * ONE explicit master × category → {inApp, push} truth table, resolved here
 * and ONLY here:
 *
 *   category OFF (any master)      -> { inApp:true,  push:false }
 *   category ON,  master ON        -> { inApp:true,  push:true  }
 *   category ON,  master OFF       -> { inApp:true,  push:false }
 *   category === null (COMMISSIONER_ANNOUNCEMENT, D3: never silenceable)
 *                                   -> { inApp:true,  push: !!master }
 *
 * In every case the in-app record writes — a category or master toggle
 * controls PUSH ONLY, never the Notification Center's own history. This is
 * DI-A4's own stated intent verbatim ("turning off Push Notifications does
 * not empty the Center"; "category off... produces in-app records only, no
 * push"). The PRIOR revision of this function instead dropped BOTH intents
 * on category-off, following §3's literal pipeline-ordering text and an §8
 * test line that directly contradicted DI-A4's own states table — reviewer
 * BLOCK flagged the contradiction and this remediation resolves it in
 * DI-A4's favor, since DI-A4's states table is the more specific, more
 * deliberately-authored source for this exact question. notifytest.mjs [1]
 * and [7] are updated to assert THIS table, not the retired one.
 *
 * The only way a recipient gets ZERO record at all for an event is a
 * STRUCTURAL writeInApp:false at the event level (CHAT_MESSAGE_CREATED,
 * PICKS_REMINDER, PICKS_LOCKING_SOON — see _fireOne's writeInApp param) —
 * never a preference combination resolved here.
 */
export function resolveIntent({ playerId, category }) {
  const master = getNotifyPushMasterFor(playerId);
  if (!category) return { inApp: true, push: !!master };   // D3 — never category-gated
  const prefs = getNotifyCategoryPrefsFor(playerId);
  const categoryOn = !!prefs[category];
  return { inApp: true, push: categoryOn && !!master };
}

// ── §4 — PushAdapter interface + the OneSignal relay adapter. `send()` never
//    talks to OneSignal directly from the browser — it calls OUR OWN backend
//    relay (notifyPushRelay, js/backend.js), which is what actually holds the
//    REST key server-side (Code.gs). Swapping providers later means writing a
//    new adapter behind this same two-method interface; nothing above this
//    layer changes. ──
let _pushAdapter = null;
export function registerPushAdapter(adapter) { _pushAdapter = adapter; }
export function hasPushAdapter() { return !!_pushAdapter; }
export function _clearPushAdapterForTest() { _pushAdapter = null; }

export class OneSignalRelayAdapter {
  isConfigured() { return true; } // real gating (REST key presence, per-recipient subscription) is server-side / per-device; unknowable from here ahead of the call.
  async send(record) {
    const res = await notifyPushRelay({
      dedupKey: record.dedupKey,
      playerIds: [record.playerId],
      title: record.title,
      body: record.body,
      destination: record.destination,
      event: record.event,
    });
    return { ok: !!res?.ok, id: res?.id, error: res?.error };
  }
}

/** Provider isolation (§8): `deliverPush` failing or being absent must NEVER
 *  block `createInAppNotification`. Always resolves — never throws. */
export async function deliverPush(record) {
  if (!_pushAdapter) { record.deliveryState.push = 'skipped'; return { ok: false, skipped: true }; }
  try {
    const res = await _pushAdapter.send(record);
    record.deliveryState.push = res?.ok ? 'sent' : 'failed';
    return res;
  } catch (err) {
    record.deliveryState.push = 'failed';
    return { ok: false, error: String(err?.message || err) };
  }
}

// ── §2 — provider-independent record + §1.3 retention (30 days / 200 most
//    recent per player, client-pruned — mirrors chat's retentionCutoff()
//    pattern, not a new retention concept). ──
const RETENTION_DAYS = 30;
const RETENTION_CAP_PER_PLAYER = 200;

function pruneNotificationList(list) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const byPlayer = new Map();
  for (const n of list) {
    if (!byPlayer.has(n.playerId)) byPlayer.set(n.playerId, []);
    byPlayer.get(n.playerId).push(n);
  }
  const out = [];
  for (const arr of byPlayer.values()) {
    const sorted = [...arr].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    out.push(...sorted.filter(n => new Date(n.createdAt).getTime() >= cutoff).slice(0, RETENTION_CAP_PER_PLAYER));
  }
  return out;
}

/**
 * Writes ONE record via the storage seam. §2's rule: chat messages are NEVER
 * written here (see `_fireOne`'s `writeInApp` gate below and the dedicated
 * §8 test — "no cfbp_notifications row is ever created for a
 * CHAT_MESSAGE_CREATED event").
 *
 * NON-BLOCKING #4/#5 remediation (2026-09-10, Build 1 design call, confirm
 * with Drew) — REPLACES the old prune-and-rewrite-the-whole-list write. This
 * now APPENDS ONLY; retention (pruneNotificationList) is applied exclusively
 * at READ time, in getNotificationsForPlayer() below. Reasoning: `cfbp_notifications`
 * is registered in js/backend.js's `_APPEND_ONLY_ID` union map (RG-49 — six
 * devices' writes union by id rather than clobber). A write path that
 * PHYSICALLY DELETES old rows on every call is not actually append-only —
 * a device that goes stale mid-session holds a local snapshot from before a
 * later prune ran elsewhere, and RG-49's own union (`_unionById`) would
 * happily resurrect whatever that stale snapshot still had, the same
 * "well-formed, populated, obsolete" shape RG-49's header describes for
 * `cfbp_feedback`. Read-time pruning is immune to that: even if a stale
 * write's union resurrects an old row into the raw stored array, the read
 * surface still hides anything past the retention window, so a resurrection
 * is invisible rather than merely rare. Known, accepted tradeoff, flagged
 * rather than hidden: the shared key itself can now grow larger over a
 * season than the 200-per-player cap implies (nothing trims it at write
 * time) — for a six-player league at this event volume (PICKS_OPENED/
 * LOCKED/RESULTS_FINALIZED/OBLIGATION_* — reminders and chat never write
 * this key at all) that is a modest, bounded amount of JSON, not a Sheets
 * cell-cap risk (RG-55/RG-56 neighborhood) — but it is a real, deliberate
 * departure from "the write path also enforces the cap," and Drew should
 * confirm this is the right call before it ships.
 */
export function createInAppNotification(record) {
  const list = getNotifications();
  setNotifications([...list, record]);
}

// ── F2 (2026-09-10 remediation) — server-fired notifyLog fold ──────────────
// PICKS_REMINDER/PICKS_LOCKING_SOON are fired ENTIRELY server-side
// (backend/Code.gs's scanReminders 15-min trigger) — the browser never runs
// for that, so there is no client call to createInAppNotification() for
// them, and they were push-only (silently invisible to anyone without push
// granted, or who simply had the app closed when the push arrived).
//
// Closing that gap WITHOUT writing server rows into the shared
// cfbp_notifications KV key (RG-49 clobber class — never write that key from
// the server) means: read the server's OWN append-only log
// (CFBP_NOTIFY_LOG, via backend.js's notifyLogFetch/Code.gs's `notifyLog`
// action) into a SEPARATE, device-local cache.
//
// NON-BLOCKING #4/#5 remediation (2026-09-10, Build 1 design call, confirm
// with Drew) — read position (readAt) is now tracked device-locally for
// BOTH server-origin AND client-origin (cfbp_notifications) rows, in ONE
// unified store, K_NOTIF_READSTATE — AD-12's exact precedent (chat.js's
// K_LASTSEEN: a per-device concern whose loss costs nothing but re-seeing an
// already-read notification once, and whose sync would write-amplify the
// Sheet for no shared benefit). Previously ONLY server-origin rows used a
// device-local read tracker (K_NOTIFY_LOG_READ, retired by this rename);
// client-origin rows had their `readAt` field mutated directly in the SHARED
// cfbp_notifications list by markNotificationRead() below, which is exactly
// the kind of six-writer read/modify/write RG-49 exists to close — two
// players opening the Center within the same debounce window could each
// overwrite the other's read-state edit on that key. The shared list's own
// `readAt` field is kept in the record SHAPE for provider-independence (a
// future server-authored provider can still populate it), but is never
// mutated by this app again; it is treated as permanently `null` and
// overridden by the device-local overlay in getNotificationsForPlayer()
// below, exactly as it already was for server-origin rows.
const K_NOTIFY_LOG_CACHE = 'cfbp_notify_log_cache';   // { byPlayer: { [playerId]: { cursorSeq, records:[...] } } }
const K_NOTIF_READSTATE  = 'cfbp_notif_readstate';    // { [notificationId]: ISOString } — AD-12 device-local read position, ALL origins
const NOTIFY_LOG_POLL_MS = 60000;   // "≤ once per 60s" — F2's stated cadence

function _readLogCache() {
  try { return JSON.parse(localStorage.getItem(K_NOTIFY_LOG_CACHE) || '{}') || {}; }
  catch { return {}; }
}
function _writeLogCache(v) { try { localStorage.setItem(K_NOTIFY_LOG_CACHE, JSON.stringify(v)); } catch {} }
function _readNotifReadState() {
  try { return JSON.parse(localStorage.getItem(K_NOTIF_READSTATE) || '{}') || {}; }
  catch { return {}; }
}
function _writeNotifReadState(v) { try { localStorage.setItem(K_NOTIF_READSTATE, JSON.stringify(v)); } catch {} }
function _markNotifReadDeviceLocal(id) {
  const state = _readNotifReadState();
  state[id] = new Date().toISOString();
  _writeNotifReadState(state);
}

let _lastLogPollAt = 0;

/**
 * Poll + fold CFBP_NOTIFY_LOG for `playerId`. Throttled to at most once per
 * NOTIFY_LOG_POLL_MS and skipped when the tab is hidden (F2) — safe to call
 * from every hydrate/auto-refresh tick; `force:true` bypasses both guards
 * (boot, and tests). Never throws — a poll miss just retries next tick,
 * matching the existing loud-fail-is-the-sync-banner's-job posture (a missed
 * notifyLog poll is not itself a sync failure).
 *
 * F7 remediation (2026-09-10) — `_lastLogPollAt` now advances ONLY after a
 * fetch actually SUCCEEDS. It used to be set before the network call, so a
 * failed boot poll (backend not yet configured, cold start, offline) burned
 * the entire 60s window and the NEXT genuinely-due poll — up to a minute
 * after boot — would also see itself as "too soon" and skip, compounding a
 * single miss into a much longer blackout than NOTIFY_LOG_POLL_MS implies.
 *
 * Item 3 remediation (2026-09-10) — the folded cache is pruned by the SAME
 * retention rule (pruneNotificationList — 30 days / 200-per-player) on every
 * successful write, not just at read time in getNotificationsForPlayer()
 * below. Read-time pruning alone would still let the device-local
 * localStorage cache itself grow unbounded across a season; pruning here
 * keeps the thing actually persisted small too.
 */
export async function pollNotifyLog(playerId, { force = false } = {}) {
  if (!playerId) return;
  if (!force && typeof document !== 'undefined' && document.hidden) return;
  const now = Date.now();
  if (!force && now - _lastLogPollAt < NOTIFY_LOG_POLL_MS) return;
  const cache = _readLogCache();
  const entry = (cache.byPlayer && cache.byPlayer[playerId]) || { cursorSeq: 0, records: [] };
  let fetched;
  try { fetched = await notifyLogFetch(playerId, entry.cursorSeq); }
  catch { return; }   // failed fetch — do NOT burn the throttle window; the next call may retry immediately
  _lastLogPollAt = now;   // only advance the throttle on a SUCCESSFUL fetch
  if (!fetched.records.length && fetched.head === entry.cursorSeq) return;
  cache.byPlayer = cache.byPlayer || {};
  cache.byPlayer[playerId] = {
    cursorSeq: fetched.head,
    records: pruneNotificationList([...entry.records, ...fetched.records]),
  };
  _writeLogCache(cache);
}

/** Server-log rows for `playerId`, shaped to match cfbp_notifications rows
 *  (readAt resolved from the device-local read-state store — never the
 *  shared key, see header note above and the NON-BLOCKING #4/#5 remediation
 *  note on _readNotifReadState below). Internal — getNotificationsForPlayer()
 *  below is the actual read surface; exported for the app.js Center render
 *  path's own tests and for markNotificationRead()'s server-row branch. */
export function getServerNotifyLogForPlayer(playerId) {
  const cache = _readLogCache();
  const entry = cache.byPlayer && cache.byPlayer[playerId];
  if (!entry) return [];
  const readState = _readNotifReadState();
  return entry.records.map(r => ({ ...r, readAt: readState[r.id] || null, _serverOrigin: true }));
}

export function _resetNotifyLogCacheForTest() {
  try { localStorage.removeItem(K_NOTIFY_LOG_CACHE); } catch {}
  try { localStorage.removeItem(K_NOTIF_READSTATE); } catch {}
  _lastLogPollAt = 0;
}

/**
 * Read surface for the Notification Center (DI-A3) — pruned + sorted,
 * most-recent-first, filtered to one player. Merges the client-authored
 * cfbp_notifications rows with the server-origin notifyLog cache (F2),
 * deduped by dedupKey so a race between a client-side fire and the
 * server-side scan for the same event/threshold/player never double-counts
 * (both paths use the identical makeDedupKey() format).
 *
 * NON-BLOCKING #3/#4/#5 remediation (2026-09-10) —
 *   #3: retention (pruneNotificationList) is applied to the MERGED list, not
 *       just the local half BEFORE merging. A local list under the cap that
 *       gets padded past 200/30-days once server-origin rows join it used to
 *       ship every server row unpruned; now the combined set is the thing
 *       measured against the cap, so "≤200 shown, ≤30 days old" is a real
 *       property of what the Center displays, not just of each half alone.
 *   #4/#5: local rows' `readAt` is resolved from the SAME device-local
 *       read-state store server rows already used, overriding whatever the
 *       shared list's own (permanently-null-going-forward) `readAt` field
 *       says — see createInAppNotification()'s header note.
 */
export function getNotificationsForPlayer(playerId) {
  const readState = _readNotifReadState();
  const local = getNotifications()
    .filter(n => n.playerId === playerId)
    .map(n => ({ ...n, readAt: readState[n.id] || null }));
  const localDedupKeys = new Set(local.map(n => n.dedupKey));
  const serverOnly = getServerNotifyLogForPlayer(playerId).filter(r => !localDedupKeys.has(r.dedupKey));
  const merged = pruneNotificationList([...local, ...serverOnly]);
  return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Bell badge count (Q4 default) — lifecycle records ONLY, never the chat
 *  pill's number. The two counters read from two disjoint data sources by
 *  construction, so there is nothing to double-count. */
export function unreadLifecycleCount(playerId) {
  return getNotificationsForPlayer(playerId).filter(n => !n.readAt).length;
}

/**
 * NON-BLOCKING #4/#5 remediation (2026-09-10, Build 1 design call, confirm
 * with Drew) — REPLACES the old client-row branch that mutated the SHARED
 * `cfbp_notifications` list in place (`setNotifications(list)` with one
 * record's `readAt` rewritten). That was a six-writer read/modify/write on a
 * key now registered append-only in js/backend.js's `_APPEND_ONLY_ID` — the
 * exact RG-49 clobber shape (two players opening the Center inside the same
 * debounce window could each drop the other's read-state edit on that key).
 * Read position is now device-local for BOTH origins, uniformly: this
 * function never calls setNotifications() at all — the shared list is never
 * touched by marking something read, on either branch.
 */
export function markNotificationRead(id, playerId) {
  const inLocal = getNotifications().some(n => n.id === id && n.playerId === playerId);
  if (inLocal) { _markNotifReadDeviceLocal(id); return true; }
  const inServer = getServerNotifyLogForPlayer(playerId).some(r => r.id === id);
  if (inServer) { _markNotifReadDeviceLocal(id); return true; }
  return false;
}

// ── low-level "fire to one recipient" — every per-event function below
//    routes through this, per DI-A1's "one place" requirement. ──
// F10 remediation (2026-09-10) — bounded (FIFO-evicted), not an unbounded
// Set. This is an in-memory-only guard for events that never persist (chat —
// see writeInApp:false below); a session left open for days would otherwise
// accumulate one entry per chat message ever notified about, for the life
// of the tab, with nothing ever removed.
const SESSION_FIRED_DEDUP_CAP = 5000;
const _sessionFiredDedupKeys = new Set();
const _sessionFiredDedupOrder = [];   // insertion-order queue mirroring the Set, so the oldest entries can be evicted once the cap is hit

function _rememberSessionFiredDedupKey(key) {
  if (_sessionFiredDedupKeys.has(key)) return;
  _sessionFiredDedupKeys.add(key);
  _sessionFiredDedupOrder.push(key);
  while (_sessionFiredDedupOrder.length > SESSION_FIRED_DEDUP_CAP) {
    _sessionFiredDedupKeys.delete(_sessionFiredDedupOrder.shift());
  }
}

export function _sessionFiredDedupSizeForTest() { return _sessionFiredDedupKeys.size; }
export function _sessionFiredDedupCapForTest() { return SESSION_FIRED_DEDUP_CAP; }

function _newId() {
  return 'ntf_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
}

/**
 * @param {object}  opts
 * @param {string}  opts.event        one of LIFECYCLE_EVENTS
 * @param {object}  opts.actor        { kind:'scribe'|'commissioner'|'system', playerId:string|null }
 * @param {string}  opts.playerId     the recipient
 * @param {string|null} opts.weekId
 * @param {string}  [opts.threshold]  dedup axis for scheduled events (24h/1h/15m/lock)
 * @param {object}  [opts.meta]       facts — MUST already exclude forbidden keys (asserted below regardless)
 * @param {object}  [opts.copyOverride] { title, body } — bypasses SCRIBE (CHAT_MESSAGE_CREATED, COMMISSIONER_ANNOUNCEMENT)
 * @param {boolean} [opts.writeInApp=true] false for CHAT_MESSAGE_CREATED (§2 — no stored record, ever)
 */
function _fireOne({ event, actor, playerId, weekId = null, threshold = '', meta = {}, copyOverride = null, writeInApp = true }) {
  assertMetaIsBlindSafe(meta);
  const dedupKey = makeDedupKey({ event, weekId, threshold, playerId });

  if (writeInApp) {
    const existing = getNotifications();
    if (existing.some(n => n.dedupKey === dedupKey && n.playerId === playerId)) {
      return { fired: false, reason: 'dedup' };
    }
  } else {
    // Never-persisted events (chat) have no stored record to dedup against —
    // guard redundant SAME-SESSION relay calls only; cross-device/duplicate
    // delivery is the SERVER's job (CFBP_NOTIFY_SENT, §5), exactly the
    // existing AD-11 pattern (six clients detect one trigger; server collapses).
    if (_sessionFiredDedupKeys.has(dedupKey)) return { fired: false, reason: 'dedup-session' };
    _rememberSessionFiredDedupKey(dedupKey);
  }

  const category = CATEGORY_OF_EVENT[event];
  const intent = resolveIntent({ playerId, category });
  if (!intent.inApp && !intent.push) return { fired: false, reason: 'preferences' };

  const copy = copyOverride || buildCopy(event, meta, dedupKey);
  const destination = destinationFor(event, { playerId, weekId, ...meta });

  const record = {
    id: _newId(),
    playerId,
    event,
    actor,
    title: copy.title,
    body: copy.body,
    destination,
    createdAt: new Date().toISOString(),
    readAt: null,
    dedupKey,
    deliveryState: { inApp: 'suppressed', push: 'skipped' },
    weekId: weekId ?? null,
    meta,
  };

  if (writeInApp && intent.inApp) {
    record.deliveryState.inApp = 'delivered';
    createInAppNotification(record);
  }
  if (intent.push) {
    // Fire-and-forget from the caller's perspective; deliverPush() never
    // throws (failure isolation, §8) so this can never block the caller.
    deliverPush(record).catch(() => {});
  }
  return { fired: true, record };
}

// ═══ Per-event orchestration (DI-B1…B5) ══════════════════════════════════════
// Each function resolves recipients for ITS event and calls _fireOne per
// recipient. Demo weeks NEVER fire (DI-B2) — every week-scoped function below
// guards `week.dataSourceMode !== 'demo'` at the call site AND here, belt and
// suspenders, matching this codebase's existing demo-week discipline
// (finalizeWeek/reconcileWeeklyObligation, js/app.js).

function _activePlayers(players) { return (players || getPlayers()).filter(p => p.active); }

/** DI-B2 — DRAFT→OPEN. Everyone. SCRIBE-voiced (§1 Q9 — SCRIBE owns this by default). */
export function notifyPicksOpened(week, players) {
  if (!week || week.dataSourceMode === 'demo') return [];
  const meta = { weekN: week.weekNumber };
  return _activePlayers(players).map(p =>
    _fireOne({ event: LIFECYCLE_EVENTS.PICKS_OPENED, actor: { kind: 'scribe', playerId: null }, playerId: p.playerId, weekId: week.weekId, meta }));
}

/**
 * DI-B2 — personalized, ONE recipient, own status only. `threshold` is one of
 * '24h'|'1h'|'15m' (dedup axis — three independent fires per player per week).
 * Server-scan-fired in production (see backend/Code.gs `scanReminders`) —
 * push-only (writeInApp:false) because the scan cannot write cfbp_notifications
 * from Apps Script; see this file's header note in the handoff report. Kept
 * here as the reference implementation Code.gs's port is tested against.
 */
export function notifyPicksReminder(week, player, remainingPicks, threshold, timeUntilLock = '') {
  if (!week || week.dataSourceMode === 'demo' || !player || remainingPicks <= 0) return null;
  const meta = { weekN: week.weekNumber, remainingPicks, timeUntilLock };
  return _fireOne({
    event: LIFECYCLE_EVENTS.PICKS_REMINDER, actor: { kind: 'scribe', playerId: null },
    playerId: player.playerId, weekId: week.weekId, threshold, meta, writeInApp: false,
  });
}

/**
 * DI-B2 — broadcast, named-laggard default (Drew's 2026-09-10 ruling; the
 * one place this workstream is MORE permissive than UN-46's count-only chat
 * precedent — flagged prominently, not silently built). `nonSubmitterNames`
 * is an array of DISPLAY NAMES only — never pick content (the blind-rule
 * exception is scoped to exactly this event). Server-scan-fired in
 * production, same push-only reasoning as notifyPicksReminder above.
 *
 * NAMING IS GOVERNED SERVER-SIDE (2026-09-10). Whether laggards are named or
 * only counted is the `NOTIFY_NAME_NON_SUBMITTERS` Script Property, read by
 * the scan in backend/Code.gs — not by anything here. This client function
 * has NO production caller (the scan fires the real thing) and cannot read a
 * Script Property, so it always takes the naming branch when handed names.
 * If it is ever wired to a caller, MIRROR THE FLAG: gate `nonSubmitterNames`
 * at the call site so an operator flipping the property off actually turns
 * naming off everywhere, rather than leaving this path quietly naming people.
 */
export function notifyPicksLockingSoon(week, players, nonSubmitterNames, submittedCount, totalPlayers, timeUntilLock = '') {
  if (!week || week.dataSourceMode === 'demo') return [];
  const allIn = !nonSubmitterNames || nonSubmitterNames.length === 0;
  const event = LIFECYCLE_EVENTS.PICKS_LOCKING_SOON;
  const meta = allIn
    ? { weekN: week.weekNumber, totalPlayers }
    : { weekN: week.weekNumber, timeUntilLock, namedNonSubmitters: nonSubmitterNames.join(', '), submittedCount, totalPlayers };
  return _activePlayers(players).map(p => _fireOne({
    event, actor: { kind: 'scribe', playerId: null }, playerId: p.playerId,
    weekId: week.weekId, threshold: 'locking-soon',
    // allIn uses the disjoint ALL_IN copy pool (js/notify-copy.js) — the
    // dedupKey/event stays PICKS_LOCKING_SOON either way (one event, one
    // audience, per DI-B2), only the copy source differs.
    meta, copyOverride: buildCopy(allIn ? 'PICKS_LOCKING_SOON_ALL_IN' : event, meta, makeDedupKey({ event, weekId: week.weekId, threshold: 'locking-soon', playerId: p.playerId })),
    writeInApp: false,
  }));
}

/** DI-B2 — LOCKED, once, broadcast, count-only (never named — "the moment has
 *  passed," matches UN-46). CLIENT-triggered (applyWeekStatusChange), so this
 *  one DOES get an in-app record. */
export function notifyPicksLocked(week, players, submittedCount, totalPlayers) {
  if (!week || week.dataSourceMode === 'demo') return [];
  const meta = { weekN: week.weekNumber, submittedCount, totalPlayers };
  return _activePlayers(players).map(p =>
    _fireOne({ event: LIFECYCLE_EVENTS.PICKS_LOCKED, actor: { kind: 'scribe', playerId: null }, playerId: p.playerId, weekId: week.weekId, meta }));
}

/**
 * DI-B3 — once per week, at FINAL. `weekWinnerName`/`weekLoserName` MUST come
 * from calculateWeeklyResults()'s own return value (SCRIBE.md §9.1 boundary) —
 * this function only reads what its caller (js/app.js finalizeWeek()) passes
 * in; it never independently re-derives a winner.
 */
export function notifyResultsFinalized(week, weekWinnerName, weekLoserName, players) {
  if (!week || week.dataSourceMode === 'demo') return [];
  return _activePlayers(players).map(p => {
    const won = !!(weekWinnerName && p.displayName === weekWinnerName);
    const event = LIFECYCLE_EVENTS.RESULTS_FINALIZED;
    // BLOCKING #2 remediation (2026-09-10) — REPLACES the `|| null` coercion.
    // An absent winner/loser name must resolve to `undefined`, never `null`:
    // notify-copy.js's buildCopy() treats undefined as "fact not supplied"
    // and correctly drops any template needing it, falling back to the
    // deterministic non-SCRIBE string. `null` used to sail through that same
    // check (its OWN presence test was `!== undefined`, so `null` counted as
    // "present") and get substituted verbatim, rendering "null took it."
    // notify-copy.js's presence test is now ALSO hardened to reject null/''
    // directly (belt and suspenders — this fixes the one known caller, that
    // fixes every future one).
    const meta = { weekN: week.weekNumber, weekWinnerName: weekWinnerName || undefined, weekLoserName: weekLoserName || undefined };
    const dedupKey = makeDedupKey({ event, weekId: week.weekId, playerId: p.playerId });
    const copy = won
      ? buildCopy('RESULTS_FINALIZED_YOU_WON', { weekN: week.weekNumber }, dedupKey)
      : buildCopy(event, meta, dedupKey);
    return _fireOne({ event, actor: { kind: 'scribe', playerId: null }, playerId: p.playerId, weekId: week.weekId, meta, copyOverride: copy });
  });
}

/** DI-B4 — "created" only. Debtor only (per verification: "confirm ONE
 *  notification to the debtor"). Obligations can be manual (weekId:null, e.g.
 *  the commissioner's "1 drink" flow) — meta stays weekN-less for those;
 *  notify-copy.js's own fallback handles an absent weekN cleanly. */
export function notifyObligationCreated(ob) {
  if (!ob || !ob.payerPlayerId) return null;
  const week = ob.weekId ? getWeek(ob.weekId) : null;
  const meta = week ? { weekN: week.weekNumber } : {};
  return _fireOne({
    event: LIFECYCLE_EVENTS.OBLIGATION_CREATED, actor: { kind: 'system', playerId: null },
    playerId: ob.payerPlayerId, weekId: ob.weekId || null, meta,
  });
}

/** DI-B4 — "settled" only. Both parties. `meta.weekN` (F7, 2026-09-10
 *  remediation) — the refreshed SCRIBE copy pool for this event now has a
 *  {weekN} line, same weekId-optional pattern as notifyObligationCreated
 *  above (a manual obligation can carry weekId:null; notify-copy.js's own
 *  fallback handles the weekN-less case cleanly). */
export function notifyObligationSettled(ob) {
  if (!ob) return [];
  const week = ob.weekId ? getWeek(ob.weekId) : null;
  const meta = week ? { weekN: week.weekNumber } : {};
  const recipients = [ob.payerPlayerId, ob.recipientPlayerId].filter(Boolean);
  return recipients.map(playerId => _fireOne({
    event: LIFECYCLE_EVENTS.OBLIGATION_SETTLED, actor: { kind: 'system', playerId: null },
    playerId, weekId: ob.weekId || null, meta,
  }));
}

/**
 * DI-B5 — commissioner-authored, VERBATIM, never SCRIBE-attributed. This is
 * the hard structural rule: `actor.kind` is ALWAYS 'commissioner' for this
 * event, and copy is supplied by the caller (copyOverride), never built from
 * a template pool — there is no POOLS.COMMISSIONER_ANNOUNCEMENT entry in
 * js/notify-copy.js at all, so this can never accidentally render SCRIBE-voiced.
 */
export function notifyCommissionerAnnouncement(body, commissionerPlayerId, players) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return [];
  return _activePlayers(players).map(p => _fireOne({
    event: LIFECYCLE_EVENTS.COMMISSIONER_ANNOUNCEMENT,
    actor: { kind: 'commissioner', playerId: commissionerPlayerId || null },
    playerId: p.playerId, weekId: null, meta: {},
    copyOverride: { title: 'Commissioner', body: trimmed },
  }));
}

// ── DI-B1 — chat message notifications. chat.js is UNCHANGED (§0) — this
//    subscribes to its EXISTING onChat() pub/sub from outside. §2: chat
//    NEVER gets an in-app cfbp_notifications record (writeInApp:false) —
//    push only, direct excerpt, no SCRIBE voice. ──
let _chatWatermarkSeq = 0;
let _chatWired = false;
// F1 (2026-09-10 remediation) — true once the watermark reflects a COMPLETE
// fold, i.e. the transport has reached the server's true head at least once.
// Before that, _scanNewChatMessages() must never run: the reviewer measured
// 1,000 relay sends after a 200-message backfill because the watermark
// started at 0 and the initial backfill ingest was treated as 200 brand-new
// messages. BUG-C (2026-09-11) — "complete" is now decided by the transport's
// delivery kind, not by which notification arrived first; see
// wireChatNotifications() below for why that distinction cost 3,685 sends.
let _watermarkSeeded = false;

function _currentChatHead() {
  try { return chatStatus().head || 0; } catch { return 0; }
}

/** True once the transport has reached the server's TRUE head at least once
 *  this session (chat.js S.caughtUp, set from chatTransport's delivery kind).
 *  Before that, a non-zero fold head means "the walk got this far," NOT "this
 *  is the whole room" — which is exactly the distinction BUG-C turned on. */
function _chatIsCaughtUp() {
  try { return chatStatus().caughtUp === true; } catch { return false; }
}

/** Advance the watermark to whatever the fold now holds WITHOUT relaying.
 *  Every history path funnels through here so "history advances the watermark"
 *  is one statement in one place, not a rule repeated at three call sites. */
function _advanceChatWatermarkSilently() {
  _chatWatermarkSeq = Math.max(_chatWatermarkSeq, _currentChatHead());
}

// BUG-C (2026-09-11) — SECOND LAYER, deliberately redundant with the
// classification above. F1 (2026-09-10) and BUG-C (2026-09-11) are the same
// failure — a pile of history scanned as new — arriving through two different
// mechanisms one day apart, and the second one came through a door F1 could not
// have known about (BUG-B's paging). So the scan itself refuses an implausible
// burst rather than trusting that the classification is airtight forever: a
// single batch that would produce more than CHAT_RELAY_BURST_CAP relay sends
// advances the watermark, records the refusal, warns, and relays NOTHING.
//
// 100 sends is 20 messages in a six-player league. NOTE (reviewer, 2026-09-11):
// a batch is NOT bounded by one poll interval — chatTransport returns early
// while document.hidden and ticks immediately on resume, so one batch spans
// the whole hidden window (a phone in a pocket through a Saturday game). That
// is the COMMON trip, and it is intended: relaying 25 hour-old messages as
// 125 catch-up pushes is worse than relaying none. The messages are already in
// the fold and still badge as unread; a "N new messages" digest push is an
// open user-experience item. The cap is two orders of magnitude below the
// 3,685 BUG-C actually produced; the cost of no cap is a five-device storm.
const CHAT_RELAY_BURST_CAP = 100;
const _chatRelayBurstTrips = [];

export function _chatWatermarkForTest() { return _chatWatermarkSeq; }
export function _chatRelayBurstTripsForTest() { return _chatRelayBurstTrips.map(t => ({ ...t })); }
export function _resetChatRelayBurstTripsForTest() { _chatRelayBurstTrips.length = 0; }

function _scanNewChatMessages() {
  // F1's invariant, enforced at the dangerous action rather than only at the
  // call site: never scan against a watermark that does not reflect a COMPLETE
  // fold. wireChatNotifications() already guarantees this on every path that
  // reaches here today (it sets the flag from the transport's own caught-up
  // report before calling), so this is belt-and-braces for the next caller.
  if (!_watermarkSeeded) return;
  let all;
  try { all = getMessages({}); } catch { return; }
  const fresh = all.filter(m => m.type === 'message' && !m.deleted && typeof m.seq === 'number' && m.seq > _chatWatermarkSeq);
  if (!fresh.length) return;
  _chatWatermarkSeq = Math.max(_chatWatermarkSeq, ...fresh.map(m => m.seq));
  // Foreground suppression (§3 step 3) happens on the RECEIVING device inside
  // the OneSignal SDK's foregroundWillDisplay hook (push-onesignal.js), not
  // here — this function's job is only "who is a candidate recipient," which
  // is symmetric across devices; the open-chat-tab check would otherwise
  // suppress the SENDER's own notify-scan for messages OTHER players sent
  // while THIS device happens to be on the chat tab, which is wrong (this
  // device isn't the recipient in that case anyway — sender exclusion below
  // handles it).
  const players = _activePlayers();
  const projected = fresh.length * Math.max(0, players.length - 1);
  if (projected > CHAT_RELAY_BURST_CAP) {
    // The watermark was advanced above, BEFORE this guard, on purpose: a
    // refused burst must never be re-scanned into a second storm.
    const trip = { messages: fresh.length, recipients: Math.max(0, players.length - 1), projected,
                   watermark: _chatWatermarkSeq, at: new Date().toISOString() };
    _chatRelayBurstTrips.push(trip);
    if (typeof console !== 'undefined') {
      console.warn('[notifications] chat relay burst cap TRIPPED — ' +
        `${trip.messages} new messages × ${trip.recipients} recipients = ${trip.projected} relay sends ` +
        `exceeds the cap of ${CHAT_RELAY_BURST_CAP}. Nothing was relayed; the watermark advanced to ` +
        `${trip.watermark}. Either a delivery that should have been classified as HISTORY reached the scan ` +
        '(the BUG-C shape — check notifications.js wireChatNotifications() and the transport\'s caught-up ' +
        'reporting), or the room genuinely produced more traffic in one poll interval than a push fan-out ' +
        'should ever carry. Both are worth looking at; neither is worth five phones buzzing this many times.');
    }
    return;
  }
  for (const m of fresh) {
    const senderId = m.author;
    const preview = (m.body || '').slice(0, 60);
    for (const p of players) {
      if (p.playerId === senderId) continue;   // sender never notifies self (mirrors isUnreadFor's m.author !== selfId rule)
      const senderName = getPlayer(senderId)?.displayName || senderId;
      _fireOne({
        event: LIFECYCLE_EVENTS.CHAT_MESSAGE_CREATED,
        actor: { kind: senderId === 'scribe' ? 'scribe' : 'system', playerId: senderId === 'scribe' ? null : senderId },
        playerId: p.playerId,
        // weekId slot is repurposed to carry the MESSAGE id — chat has no
        // week concept, and dedup MUST be per-message (§4's format bakes in
        // one axis beyond event+playerId; without this, a second chat
        // message to the same recipient in the same session would collide
        // on the identical dedupKey and silently never fire).
        weekId: m.id,
        meta: { messageId: m.id },   // -> destinationFor's ctx.messageId (DI-A5)
        copyOverride: { title: senderName, body: `${senderName}: ${preview}` },
        writeInApp: false,
      });
    }
  }
}

/**
 * Call once at boot (js/app.js). Idempotent.
 *
 * F1 (2026-09-10) established the rule: never relay a backfill. BUG-C
 * (2026-09-11) replaced the WAY it is decided, because F1's version — "the
 * first post-wire 'events' notification IS the backfill" — stopped being true
 * the day BUG-B taught the transport to page. A cold boot against a
 * mid-season log now arrives as three notifications, not one, and F1 skipped
 * only the first: the reviewer measured 3,685 relay calls (737 already-read
 * messages × 5 recipients) on a 1,237-event log. Wiring that landed BETWEEN
 * two pages had the same hole through the other branch — a real, non-zero
 * head that was nonetheless only a third of the room.
 *
 * The rule now, in one sentence, keyed off FACTS the transport reports rather
 * than the ORDER notifications happen to arrive in:
 *
 *   A batch is LIVE only if the room was already complete before it arrived
 *   (detail.wasCaughtUp) AND this delivery itself reaches the true head
 *   (detail.caughtUp). Everything else is history: advance the watermark,
 *   relay nothing.
 *
 * That covers all four shapes without a timing assumption anywhere:
 *   1. wired AFTER the drain finished (chatStatus().caughtUp) — seed from the
 *      fold head, which is now known to be the WHOLE room, and scan normally.
 *   2. wired BEFORE any page lands — every page classifies as history; the
 *      page that reaches the head seeds us; the next batch is live.
 *   3. wired BETWEEN pages — identical, because a partial head no longer
 *      reads as a complete one. This is the CASE 1 hole BUG-C found.
 *   4. a >1-page burst arriving while ALREADY live — the mid-walk pages
 *      advance the watermark silently instead of relaying 500 pushes; only a
 *      caught-up delivery relays. (Missing pushes for a 500-message burst is
 *      the right trade against a five-device storm; the burst cap in
 *      _scanNewChatMessages() is the backstop if one ever slips through.)
 *
 * Guarded by notifytest.mjs [12] (F1's original cases), [12b] (BUG-C, driven
 * through the real transport) and [12c] (the burst cap).
 */
export function wireChatNotifications() {
  if (_chatWired) return;
  _chatWired = true;
  // Case 1 — the room is only a trustworthy baseline once the transport says
  // the walk actually reached the server's head. A non-zero head on its own
  // means "the walk got this far," which is what BUG-C mistook for "complete."
  _chatWatermarkSeq = _currentChatHead();
  _watermarkSeeded = _chatIsCaughtUp();
  onChat((kind, detail) => {
    if (kind !== 'events') return;
    const caughtUp = detail?.caughtUp === true;
    const wasCaughtUp = detail?.wasCaughtUp === true;
    if (!wasCaughtUp) {
      // The room was NOT complete before this batch — history, every page of
      // it, however many there are. A detail-less notification lands here too,
      // which is the safe side to fail to.
      _advanceChatWatermarkSilently();
      if (caughtUp) _watermarkSeeded = true;   // this page reached the head: the room is complete from here on
      return;
    }
    _watermarkSeeded = true;
    if (!caughtUp) { _advanceChatWatermarkSilently(); return; }   // mid-walk page of a live burst (shape 4)
    _scanNewChatMessages();
  });
}

export function _resetChatWatermarkForTest() {
  _chatWatermarkSeq = 0;
  _chatWired = false;
  _watermarkSeeded = false;
  _chatRelayBurstTrips.length = 0;
}
