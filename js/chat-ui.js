/**
 * chat-ui.js — v0.17.0 (REVISED chat spec: one room + gameTag)
 * =============================================================
 * Renders every chat surface from the chat.js engine:
 *   A. Main chat page — single stream, filter pills (Room / 🏛 Records /
 *      @ Mentions / per-game views with unread + LIVE pulse), date separators,
 *      NEW divider, jump-to-latest, ambient gamereact coalescing
 *   B. Composer — removable game-tag chip (the cross-talk rule made visible),
 *      @mention autocomplete, quick emoji, 1000-char counter
 *   C. Game-card bubble + pre-tagged bottom sheet (+ first-use helper text)
 *   D. Dashboard sticky bar — unread, preview, inline quick-reply
 *   E. In-app notifications (TRIAL, no push): toast queue, title badge,
 *      navigator.setAppBadge, mention inbox, optional per-player sound
 *   F. Identity: per-player nickname + accent color (prefs popover)
 *   G. System emitters — pick reveal ritual, kickoff, game final (+ one-tap
 *      callout + SCRIBE unprompted callout), Extra Point, week final (+ Hall
 *      of Records auto-promotion), all with the pre-lock no-leak HARD RULE
 *   H. SCRIBE — an active member of the league, not a summonable bot: it
 *      documents on its own schedule, is always on duty, and answers when
 *      addressed. Live-game observations ride the existing score poll.
 *
 * v0.17.2 — player presence ("N here now") and read receipts ("seen by k") were
 * removed; see the note in chat.js and the amended AD-19.
 *
 * v0.17.4 (batch 2) — UN-101 marks Chat BETA; UN-102 tightens notifications
 * (dashboard-tab toast suppression, self-post never resurfaces the teaser, a
 * "stays for" duration pref, a manual ✕ dismiss); UN-103 removes the composer
 * emoji row (players use their own keyboard) in favor of a Slack-style + react
 * on each message, with the rest of `.chat-actions` hidden until a long-press
 * on touch; UN-104 compacts the chat header into one line, sticks it + the
 * pills + the per-game view header as ONE unit beneath `.app-header`, and
 * pins the composer above the bottom nav. The header subtitle that used to
 * carry SCRIBE's "on duty" framing (UN-67) is gone — that framing survives in
 * the empty-room state (guarded at §[7a]) and the Rules FAQ in app.js
 * (guarded at §[23h]).
 *
 * UN-120/UN-121 (2026-08-12) — the desktop `:hover` reveal for `.chat-actions`
 * is DELETED (Drew: mousing toward the menu brushed every message on the way
 * and reacted to each one) and replaced by a deliberate right-click
 * (contextmenu). Touch keeps its long-press (UN-103, unchanged) and gains an
 * axis-locked swipe for the two most common actions (reply / react). UN-121
 * folds `.chat-reaction-names` (previously always-visible, duplicating the
 * pill row directly above it) into this SAME reveal state, one gesture for
 * both, per RG-21's lesson about two changes to one component composing
 * badly when verified only in isolation.
 *
 * DI-125 (2026-08-13, same day) — closes the gap UN-120/121 left in the
 * per-game bottom sheet (`#chat-sheet-scroll`, `openGameChatSheet()`):
 * `renderSheetMessages()` shares `messageHTML()` with the main feed, so it
 * always rendered `.chat-actions`/`.chat-reaction-names` markup, but never
 * wired the gestures OR five of the six action buttons — only `[data-react]`
 * (tap-to-vote) and `[data-retry]` worked there. Drew's decision: wire the
 * SAME gestures/handlers into the sheet rather than special-case it. The
 * reveal state (`_revealedMsgId`) is a SINGLE module-level value shared by
 * both surfaces, so `revealMessageActions()`/`dismissRevealedActions()` are
 * now scoped by container id (`_revealedRootId`) — required because a
 * message can legitimately render in BOTH `#chat-scroll` and
 * `#chat-sheet-scroll` at once (the main chat page is never torn down on
 * navigation, only hidden — see the handoff report). `bindMessageSwipe`/
 * `bindMessageActionsLongPress`/`bindMessageActionsContextMenu` all keep
 * their exact `(root)` signature; they derive the container id from `root.id`
 * internally, so no caller needed to change shape. `openReplyFor()` and
 * `openReactPickerFor()` gain a `surface` ('main'|'sheet') parameter for the
 * one thing that's genuinely different per surface — which composer/render
 * function reacts — reusing every other line of logic. Reply in the sheet
 * gets its OWN `U.sheetReplyTo` (not `U.replyTo`) so a reply started in one
 * surface can never leak into the other's composer.
 *
 * All state lives in chat.js; this module renders and forwards intents.
 */

import {
  initChat, startChatTransport, onChat, chatStatus, getMessages, getMessage, resolveTag,
  sendMessage, sendEvent, editMessage, deleteMessage, toggleReact, pinMessage,
  sendGameReact, retryFailed, isFailed, isPending,
  // `latestNotifying` and `latestUnreadNotifying` were imported here until
  // 2026-09-24: the first fed the in-app preview toast, the second fed the
  // dashboard teaser. Both surfaces are retired (Option A), so this module no
  // longer picks "the one message worth announcing" at all. chat.js still
  // exports both — they are the unread engine's own vocabulary and are still
  // exercised directly by loadtest §69, unreadtest and pushtest [14].
  unreadCountOrUnknown, unreadAuthors, mentionUnreadCount, markSeen, getLastSeen,
  readThroughSeq,
  backfill, chatDigest as _digest, setViewOpen,
  getRetentionDays, isChatEnabled,
  backfillBlockedByEpoch,
  isHiddenByRetention, isHiddenByEpoch,
  isChatImagePreviewEnabled,
  forceRefresh,
  isPrivateSelfTest,
} from './chat.js';
import {
  scribeInspectMessage, scribeTrigger, resetScribeMemory,
  REASON_CHIP_COPY, REASON_CHIP_SECTION_COPY,
} from './scribeLines.js';
import {
  recordFeedback, recordFeedbackReasons, getFeedbackFor, isScribeFeedbackEnabled,
} from './scribeFeedback.js';
import {
  getSession, getPlayers, getPlayer, getCurrentWeek, getGames, getWeeks,
  getPicks, getEffectiveWeekStatus, arePicksPublic,
  getAccent, setAccent, getAccentFor, getChatNick, setChatNick, getChatNickFor,
  getNotifPrefs, setNotifPrefs,
  getPushActive,
} from './storage.js';
import {
  formatSpread, formatWeekLabel, GAME_STATUS, buildAbbrMap, REACTION_PALETTE, CHAT_ACCENTS,
  SCRIBE_FEEDBACK_REASON_CHIPS, SCRIBE_FEEDBACK_CHIP_FAMILY,
} from './data-model.js';
import { calculateAtsWinner } from './scoring.js';
// RG-176 — the generic repaint-survival mechanism. app.js wires it at
// navigateTo(), but renderChatPage() is ALSO reached from four places that
// never pass through navigateTo() (an inbound chat event, the ⚙ toggle, a
// transport flip, the read-marker tick), so this module drives the same pair
// itself for its own page. See js/field-preserve.js for the four rules.
import { captureDirtyFields, restoreDirtyFields, stampFieldOwner, isComposing } from './field-preserve.js';

export const chatDigest = _digest;

// v0.17.4 (UN-103): QUICK_EMOJI is RETIRED. The composer no longer inserts
// emoji at all (players use their own keyboard) and the message-level
// always-visible 3-button quick-react row is replaced by a single + that
// opens the full REACTION_PALETTE (data-model.js, AD-20's one shared source)
// anchored to the message. There is no more "always-visible subset" concept
// left for QUICK_EMOJI to describe — do not reintroduce it.
const EDIT_WINDOW_MS = 5 * 60 * 1000;
// XSS-HARDEN round 2, C2 (2026-09-12) — the palette moved to data-model.js so
// storage.js's setAccent() can validate against the SAME list without importing
// this module (chat-ui imports storage; the reverse would be a cycle). The
// swatch row below, the write seam and the two render sites now agree by
// construction rather than by three hand-kept copies.
const ACCENTS = CHAT_ACCENTS;

const U = {
  filter: 'all',            // 'all' | 'records' | 'mentions' | <gameId>
  replyTo: null,
  composerTag: '',          // resolved tag chip (removable)
  tagStripped: false,       // user explicitly removed the chip this compose
  sheetGameId: null,
  sheetReplyTo: null,       // DI-125b — the sheet's OWN reply target; deliberately
                            // separate from U.replyTo (the main feed's) so a reply
                            // started in one surface can never leak into the other's
                            // composer (see the module docstring's DI-125 note).
  markTimer: null,
  toastQueue: [],
  toastShowing: false,
  prefsOpen: false,
  searchOpen: false,        // F2 (UN-165) — replaces the pills row in place
  searchQuery: '',
  returnToChat: false,      // set when a signed-out reader taps "Log in" in chat
  returnFilter: null,       // the filter they were reading, restored after login
  returnAt: 0,              // when it was set — the intent expires (see RETURN_WINDOW_MS)
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── UN-110 / AD-06 — chat's own sync badge ────────────────────────────────────
// .app-header (and its #sync-badge) is display:none on the chat tab, so the
// loud-fail signal needs a second, chat-local home. app.js's updateSyncBadge()
// is the single writer of truth and calls this on every status change; kept
// here (not derived from anything DOM-visible) so a FRESH renderChatPage() —
// which replaces #page-chat's entire innerHTML — can render the current
// status immediately instead of waiting for the next onBackendStatus event.
let _lastSyncStatus = null;
export function setChatSyncStatus(status) { _lastSyncStatus = status; }
// Exported (test-only, underscore-prefixed per this file's convention — see
// _syncChatStickyMetrics, _toastWouldSuppress) so loadtest can exercise the
// real conditional instead of only regex-matching the template source.
export function _chatSyncBadgeHTML() {
  // Only 'error' renders — keeps chat chrome minimal in the normal case
  // while still satisfying the hard loud-fail rule (AD-06).
  const isError = _lastSyncStatus === 'error';
  return `<span id="chat-sync-badge" class="sync-badge${isError ? ' sync-error' : ''}">${isError ? '⚠️ Sync error' : ''}</span>`;
}

// ── DI-168 — manual chat refresh ──────────────────────────────────────────────
// Deliberately its OWN local UI state, NOT the global backend sync badge
// above (_lastSyncStatus/_chatSyncBadgeHTML). That pipe is owned by app.js's
// GLOBAL backend push/pull status (updateSyncBadge(), driven by
// onBackendStatus) — writing a manual-refresh "checking…" state through the
// same variable would let a local, chat-specific poll state stomp the real
// backend sync/error indicator, and vice versa. Same typography as
// .sync-badge (small-caps Oswald), separate class (.chat-refresh-status,
// styles.css), separate state.
const REFRESH_STATUS_TEXT = {
  idle: '',
  checking: 'Checking…',
  updated: 'Updated just now',
  failed: "Couldn't refresh — tap to retry",
};
const REFRESH_ARIA_LABEL = {
  idle: 'Refresh chat',
  checking: 'Checking for new messages…',
  updated: 'Refresh chat',
  failed: 'Refresh failed. Tap to retry.',
};
let _refreshStatus = 'idle';        // 'idle' | 'checking' | 'updated' | 'failed'
let _refreshUpdatedTimer = null;

/** Two buttons (main header + game-thread sheet header), one shared status —
 *  DI-168a: "Two buttons, one handler — both call the same forced-tick
 *  path." `idPrefix` is 'chat-refresh' (main) or 'chat-sheet-refresh' (sheet),
 *  matching styles.css's `#chat-refresh-btn,#chat-sheet-refresh-btn` 44px
 *  override selector exactly. No `title` attribute anywhere (DI-168d —
 *  tooltips do not fire on touch); every state is carried by the visible
 *  status text and `aria-label`. */
function refreshControlHTML(idPrefix) {
  const status = _refreshStatus;
  const checking = status === 'checking';
  return `<button type="button" class="btn btn-ghost btn-sm" id="${esc(idPrefix)}-btn"
      ${checking ? 'disabled aria-disabled="true"' : ''}
      aria-label="${REFRESH_ARIA_LABEL[status]}">🔄</button>
    <span class="chat-refresh-status" id="${esc(idPrefix)}-status" aria-live="polite">${REFRESH_STATUS_TEXT[status]}</span>`;
}

/** Patches BOTH refresh controls' DOM state directly rather than forcing a
 *  full renderChatPage()/renderSheetMessages() re-render for a status change
 *  — either surface's button may not be in the DOM right now (only one of
 *  the main page / the sheet is ever open at a time), which getElementById
 *  returning null already handles safely. */
function setRefreshStatus(status) {
  _refreshStatus = status;
  ['chat-refresh', 'chat-sheet-refresh'].forEach(idPrefix => {
    const btn = document.getElementById(`${idPrefix}-btn`);
    if (btn) {
      if (status === 'checking') { btn.setAttribute('disabled', ''); btn.setAttribute('aria-disabled', 'true'); }
      else { btn.removeAttribute('disabled'); btn.removeAttribute('aria-disabled'); }
      btn.setAttribute('aria-label', REFRESH_ARIA_LABEL[status]);
    }
    const statusEl = document.getElementById(`${idPrefix}-status`);
    if (statusEl) statusEl.textContent = REFRESH_STATUS_TEXT[status];
  });
}

/**
 * DI-168f — tap (or Enter/Space via keyboard on the focused native <button>,
 * DI-168g) calls chat.js's forceRefresh(), which reuses the transport's real
 * tick()/drainSince() path. The UI-level "already checking" guard here is
 * belt-and-suspenders alongside the transport's own `inFlight` coalescing
 * (chatTransport.js) — DI-168f item 3: under normal use THIS guard is what
 * actually stops a double-tap from doing anything twice, since the button is
 * disabled the instant the first tap registers.
 *
 * DI-168f item 6 (Drew's decision, recorded in the approved design input):
 * no roomMode() hot-bump on a manual refresh — deliberately just the one
 * forced check, nothing else changes.
 */
async function onChatRefreshTap() {
  if (_refreshStatus === 'checking') return;
  clearTimeout(_refreshUpdatedTimer);
  setRefreshStatus('checking');
  try {
    await forceRefresh();
    setRefreshStatus('updated');
    _refreshUpdatedTimer = setTimeout(() => setRefreshStatus('idle'), 10000);
  } catch {
    setRefreshStatus('failed');
  }
}
// Test-only seams (same convention as `_chatSyncBadgeHTML`/`_toastWouldSuppress`
// above) — cachetest.mjs drives the REAL markup/state machine/tap handler,
// never a re-implementation of any of the three.
export const _refreshControlHTMLForTest = refreshControlHTML;
export const _setRefreshStatusForTest = setRefreshStatus;
export const _onChatRefreshTapForTest = onChatRefreshTap;
export function _refreshStatusForTest() { return _refreshStatus; }

/**
 * Guarded localStorage. These are device-local UI hints (AD-12) — never seam
 * keys — so failure is always safe to swallow.
 *
 * v0.17.2 (iOS fix): iOS Safari in Private Browsing throws on localStorage
 * access. chat.js already wrapped its calls; chat-ui.js did not. The unguarded
 * getItem on the game-sheet open path meant tapping a dashboard chat bubble
 * threw before the sheet rendered — the reported "nothing happens on mobile".
 */
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private browsing */ } }
function lsRemove(k) { try { localStorage.removeItem(k); } catch { /* private browsing */ } }
function me() { const s = getSession(); return (s?.playerId && s?.playerVerified) ? s.playerId : null; }
function nameOf(id) {
  if (id === 'scribe') return 'S.C.R.I.B.E.';
  if (id === 'system') return 'League';
  return getChatNickFor(id) || getPlayer(id)?.displayName || id;
}
function initialsOf(id) {
  if (id === 'scribe') return '📋';
  if (id === 'system') return '⚙';
  const n = nameOf(id);
  return (getPlayer(id)?.initials || n.slice(0, 2)).toUpperCase();
}
function accentOf(id) {
  if (id === 'scribe' || id === 'system') return '';
  return getAccentFor(id) || '';
}
function relTime(ts) {
  if (!ts) return 'sending…';
  const d = Date.now() - ts;
  if (d < 60e3) return 'now';
  if (d < 3600e3) return Math.floor(d / 60e3) + 'm';
  if (d < 86400e3) return Math.floor(d / 3600e3) + 'h';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function gameById(id) {
  for (const w of getWeeks()) {
    const g = getGames(w.weekId).find(x => x.gameId === id);
    if (g) return { game: g, week: w };
  }
  return null;
}
/**
 * Per-render memo of slate → abbreviation map, keyed by weekId.
 *
 * buildAbbrMap walks the whole slate and runs a dedup pass, so it is far too
 * expensive to call once per rendered row. gameShort() is invoked from four
 * render-loop sites and renderChatPage() re-runs on every inbound chat event,
 * so the uncached version re-derived the same map dozens of times per pass.
 *
 * Cleared at the top of ALL THREE render entry points that can reach gameShort:
 * renderChatPage(), renderPillsOnly(), and renderSheetMessages(). The map is only
 * ever a within-pass cache, so a mid-session slate edit can never be served
 * stale. If you add a fourth render path, clear it there too — loadtest section
 * [8g] asserts the count is exactly 3 and will fail until you update it.
 */
const _abbrMemo = new Map();
function abbrMapFor(weekId, fallbackGames) {
  if (weekId && _abbrMemo.has(weekId)) return _abbrMemo.get(weekId);
  const slate = weekId ? getGames(weekId) : [];
  // Only a real slate gets memoized. A map built from the single-game fallback
  // describes that game, not the week, so caching it under the weekId would
  // hand the wrong map to the next game in the same week.
  if (!slate.length) return buildAbbrMap(fallbackGames || []);
  const map = buildAbbrMap(slate);
  _abbrMemo.set(weekId, map);
  return map;
}

/**
 * Away/Home shorthand for a game, using the SAME abbreviation source as the
 * compact dashboard (data-model.js). Built from the game's own week so the
 * dedup pass matches what the dashboard renders for that slate.
 *
 * v0.17.2: replaced a local `name.split(' ').pop()` heuristic that produced
 * wrong shorthand for multi-word schools — "Southern California" rendered as
 * "California", "Arkansas State" as "State". Never reintroduce a second
 * mapping here; import from data-model.js.
 */
function gameShort(g, week) {
  if (!g) return '';
  const map = abbrMapFor(week?.weekId, [g]);
  const abbr = t => map.get(t) || t || '';
  return `${abbr(g.awayTeam)}/${abbr(g.homeTeam)}`;
}
function chatPageActive() {
  return typeof document !== 'undefined' && !!document.querySelector('#page-chat.active');
}
function dashboardPageActive() {
  return typeof document !== 'undefined' && !!document.querySelector('#page-dashboard.active');
}

// ── Pick indicator (Drew: visual context in game threads) ─────────────────────
// BLIND RULE: only shown once the week's picks are public — never leaks a
// selection while they can still be edited. UN-116 moved this from locked to
// live/final along with every other surface; arePicksPublic() is the single
// rule, so this chip cannot drift away from the dashboard again.
function pickChip(authorId, gameTag) {
  if (!gameTag || authorId === 'scribe' || authorId === 'system') return '';
  const found = gameById(gameTag);
  if (!found) return '';
  if (!arePicksPublic(found.week)) return '';
  const pick = getPicks(found.week.weekId, authorId).find(p => p.gameId === gameTag);
  if (!pick) return '';
  let cls = 'pick-chip';
  if (found.game.status === GAME_STATUS.FINAL) {
    const ats = found.game.atsWinner ?? calculateAtsWinner(found.game);
    if (ats && ats !== 'no_decision') cls += pick.selectedTeam === ats ? ' pick-chip-win' : ' pick-chip-loss';
  }
  // Shorthand comes from the shared slate map — never a local heuristic. The
  // full school name stays in the title attribute, so the chip is short and
  // the hover is unambiguous.
  const short = abbrMapFor(found.week?.weekId, [found.game]).get(pick.selectedTeam) || pick.selectedTeam;
  return `<span class="${cls}" title="${esc(nameOf(authorId))} picked ${esc(pick.selectedTeam)}">⚡ ${esc(short)}</span>`;
}

// ── Game thread header colors (item F) ─────────────────────────────────────
/**
 * The four dashboard-mirrored states, computed from the CURRENT VIEWER's own
 * pick — blind-rule-safe by construction, since a player's own pick is
 * always visible to themselves regardless of lock status (only OTHER
 * players' picks are lock-gated, UN-57). No pick, or a game that hasn't
 * gone live/final yet, returns '' (no color, structural header only).
 *
 * Reuses the dashboard's OWN color logic rather than reimplementing it:
 * `livePickStatus(pick, game)` lives in app.js (private, not exported — and
 * app.js already imports chat-ui.js, so chat-ui.js importing app.js back
 * would be a cycle). app.js exposes it on `window.livePickStatus`, the same
 * bridge pattern already used for window.navigateTo/window.showToast. If the
 * bridge isn't up yet (defensive only — by the time a user can tap into a
 * game thread, app.js's module-level code has long since run), this
 * degrades to no color rather than throwing.
 *
 * HARD REQUIREMENT: static only, no pulse. The dashboard's live states
 * deliberately animate; that reads as noisy in a chat header, so these are
 * dedicated `.chat-thread-*` classes with no `animation` property at all —
 * NOT the pulsing `.pick-live-covering` / `.dc-chip-live-covering` classes.
 */
function gameThreadHeaderClass(pick, g) {
  if (!pick || !g) return '';
  if (g.status === GAME_STATUS.LIVE) {
    const fn = (typeof window !== 'undefined') ? window.livePickStatus : null;
    const ls = typeof fn === 'function' ? fn(pick, g) : null;
    if (ls === 'covering') return ' chat-thread-covering';
    if (ls === 'trailing') return ' chat-thread-trailing';
    if (ls === 'even') return ' chat-thread-even';
    return '';
  }
  if (g.status === GAME_STATUS.FINAL) {
    const ats = g.atsWinner ?? calculateAtsWinner(g);
    if (!ats || ats === 'no_decision') return '';
    return pick.selectedTeam === ats ? ' chat-thread-won' : ' chat-thread-lost';
  }
  return '';
}

// ── Notifications (TRIAL — no push) ───────────────────────────────────────────
/**
 * PRODUCTION-UNREACHABLE SINCE 2026-09-24 (Option A, Drew) — its only caller
 * was the in-app preview raise in handleChatEvent(), removed with the toast.
 * Body left byte-identical for the same reason showToast()'s is: pushtest
 * [10] and [15] drive the shipped function through `_playBlipForTest` and
 * would redden. Delete it with that suite's pins, in one pass.
 */
function playBlip() {
  try {
    // N1 follow-up (f), 2026-09-12 — R10 COVERS THE SOUND TOO. showToast()
    // stands down on a push-active device; this did not, so the phone buzzed
    // AND the app chirped for the same message. Drew's words were "all in app
    // notifications should be that" — a notification the player HEARS is one of
    // them. Same predicate, same device-local flag, read the same synchronous
    // way (storage.getPushActive()); nothing overrides it, exactly as in
    // showToast(). A push-INACTIVE device is untouched (UN-N3).
    if (getPushActive()) return;
    if (!getNotifPrefs().sound) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 740; o.type = 'sine';
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.2);
  } catch {}
}

/**
 * DI-102(a)'s DASHBOARD TERM IS VESTIGIAL AS OF 2026-09-24. Its stated reason
 * was redundancy: "while the Dashboard is on screen, the ambient teaser card
 * already conveys new activity persistently, so the floating toast is a second
 * copy of the same information" (Drew: "the message appears in too many
 * places"). The teaser is retired, so that reason is gone. The term is kept
 * rather than deleted only because this whole predicate is now
 * production-unreachable (see showToast() below) — removing it would churn
 * four suites' assertions about a function nothing calls. It carries no live
 * rationale; do not cite it as one.
 *
 * `chatPageActive()` is DIFFERENT and is NOT vestigial — "you are already
 * looking at the room" is a live, independent reason that survives the
 * teaser's retirement. DI-T1 item 6 says so explicitly. Leave it alone.
 *
 * `force` bypasses both, unchanged.
 *
 * Exported test-only (see chat.js's `_resetForTest` convention) so the
 * predicate itself — not a re-implementation of it — gets exercised.
 */
export function _toastWouldSuppress(force = false) {
  // N1 / DI-N3 — the R10 gate is deliberately NOT folded in here. This
  // predicate answers "is the same information already on screen?", which is a
  // question about the CURRENT PAGE and which `force` may legitimately
  // override. R10 answers "is this device already being told by its phone?",
  // which nothing overrides. Two different questions, both enforced in
  // showToast(); pushtest.mjs drives the real showToast() for exactly that
  // reason rather than asserting against this seam.
  return !force && (chatPageActive() || dashboardPageActive());
}

/**
 * N1 / DI-N3 (UN-204, Drew's R10, 2026-09-12) — "if push notifications are set
 * up then all in app notifications should be that."
 *
 * READ IT IN ORDER, BECAUSE THE ORDER IS THE RULING. The push-active check runs
 * FIRST, ahead of the `force` escape hatch, because Drew's words were "ALL in
 * app notifications" and because the thing he actually saw — a banner in the
 * app announcing that the picks were in — WAS a forced toast
 * (emitPickRevealEvent below), not an OneSignal banner. Leaving `force` above
 * this line would have left the one toast he complained about untouched while
 * silencing the ones he never mentioned.
 *
 * THE PREDICATE IS PER DEVICE AND IS READ SYNCHRONOUSLY. `getPushActive()` is
 * a device-local boolean (storage.js KEYS.PUSH_ACTIVE) written by app.js's
 * refreshPushActiveFlag() at boot and after any permission/master-toggle
 * change. It is a cache on purpose: the real predicate needs
 * subscriptionState() and OneSignal's opted-in report, both async, and this
 * path cannot await (CONVENTIONS #9 — wrap async, never expose it).
 *
 * WHAT SURVIVES ON A PUSH-ACTIVE DEVICE: the OS banner (that IS the delivery),
 * wireForegroundSuppression()'s existing "you're already on that tab" rule, the
 * chat unread badge and the room itself. Drew, verbatim: "We can keep the
 * badges on the chat icon for unread messages."
 *
 * AMENDED 2026-09-24 (Option A, Drew) — this sentence used to name "the
 * dashboard teaser" in that list. It is retired, and so is the in-app toast
 * this docstring is attached to. The list above is now the whole of it, and it
 * is the same on a push-INACTIVE device: the paragraph below describing what
 * such a device keeps is history, not current behaviour.
 *
 * WHAT IS UNCHANGED ON A PUSH-INACTIVE DEVICE: everything below this line —
 * getNotifPrefs().toasts, the duration preference, the ✕, the blip, RG-25's
 * shared acknowledgement watermark and RG-26's chat-page clear. UN-N3: not
 * having push must never be the same as going blind, so a device that cannot
 * receive a push keeps today's behaviour exactly.
 *
 * ACCEPTED RESIDUAL (coordinator ruling O5): whether an INSTALLED iOS PWA
 * renders a foreground push banner is unverified. If it does not, a push-active
 * iPhone with the app open shows nothing on screen for a moment — the chat
 * badge and the room still carry the notice. The visibilityState fallback was
 * considered and deliberately NOT built; Drew verifies on his phone.
 */
/**
 * ══ PRODUCTION-UNREACHABLE SINCE 2026-09-24 (Option A, Drew) ════════════════
 *
 * NOTHING IN THE SHIPPED APP CALLS THIS ANY MORE. Both raise sites are gone:
 * the incoming-message preview (handleChatEvent) and the pick-reveal
 * announcement (emitPickRevealEvent). `#chat-toast` can no longer appear on
 * any screen, on any device, push or no push.
 *
 * THE BODY BELOW IS DELIBERATELY UNCHANGED, INCLUDING THE getPushActive()
 * GATE. The gate is inert now — an unreachable function cannot be reached by
 * a push-active device either — but four suites drive this function through
 * `_showToastForTest` and assert its real behaviour: feedbacktest §15 (the
 * `{force:true}` receipt mechanism), xsstest (escaping of the rendered node),
 * cachetest (mount counting), brandtest (the .chat-toast z-order rung), plus
 * pushtest [9]/[10]/[15]'s R10 coverage. Gutting the body to match the dead
 * call graph would redden all of them — including feedbacktest, which is under
 * another thread's review — for no behavioural gain.
 *
 * TO FINISH THE JOB: delete this function, drainToast(), playBlip(),
 * _toastWouldSuppress(), every `_*ForTest` toast seam, and the `.chat-toast*`
 * CSS, IN THE SAME PASS as those five suites' pins. Not before — a half
 * deletion is what leaves a suite asserting a mechanism that no longer exists.
 */
function showToast(msg, { force = false } = {}) {
  if (getPushActive()) return;
  if (!force && !getNotifPrefs().toasts) return;
  if (_toastWouldSuppress(force)) return;
  // RG-25 — the player already acknowledged this message on the OTHER surface
  // (dashboard teaser ✕, or by opening the room). One acknowledgement, both
  // surfaces. Forced system announcements carry no seq and are never gated.
  // The watermark is TAG-AWARE: a message posted in a game thread is
  // acknowledged by reading THAT thread as well as by reading the room, which
  // is the same two-level rule the unread badge uses (chat.js readCursorFor).
  if (!force && typeof msg?.seq === 'number' && msg.seq <= notifAckThroughSeq(msg.gameTag)) return;
  U.toastQueue.push(msg);
  if (!U.toastShowing) drainToast();
}

/**
 * Test-only seams (same convention as `_toastWouldSuppress` / `_ackNotif`).
 *
 * RG-25 and RG-26 must be driven through the REAL toast — its ✕ handler, its
 * auto-dismiss timer, and the chat-page clear — never a re-implementation.
 * Verified 2026-08-12: the previous assertions matched `acknowledge()` by NAME
 * in the source, so replacing its body with a bare `advance()` (the shared
 * watermark never written — exactly the bug Drew reported) passed a full green
 * 552/552 suite. Both of these exist so that mutation goes red instead.
 */
export function _showToastForTest(msg, opts) { return showToast(msg, opts); }
/** N1 follow-up (f) — the blip's R10 gate is asserted on the SHIPPED function
 *  (pushtest.mjs [10]), never on a copy of the predicate. */
export const _playBlipForTest = playBlip;

/**
 * N1 follow-up (c), 2026-09-12 — OWN-ACTION RECEIPTS DO NOT GO THROUGH
 * showToast().
 *
 * R10 (DI-N3) silences chat-ui's showToast() on a push-active device because
 * "the push IS the delivery." That is true of a NOTICE about something that
 * happened elsewhere. It is not true of a RECEIPT for the thing the viewer just
 * did — no push will ever carry "Rewrite saved.", so on a push-active phone the
 * submit button simply did nothing visible.
 *
 * The fix is not a hole in the gate (a `{receipt:true}` bypass would put two
 * different jobs behind one predicate and invite the next forced toast to call
 * itself a receipt). Receipts belong where every other "saved" confirmation in
 * this app already lives: app.js's own showToast(), reached over the existing
 * window.* bridge (the redirectChatDisabled() precedent, same reason — no
 * circular import). That toast was never a notification surface and was never
 * gated, so a receipt renders on every device, push or no push.
 *
 * THE ENUMERATION (pushtest.mjs [10-6] pins it): chat-ui.js raises exactly
 * three toasts. "Rewrite saved." is the only receipt; the pick-reveal
 * announcement and the incoming-message toast are both notices about something
 * elsewhere and stay gated.
 */
function showReceipt(text) {
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(text, 'success');
}
export const _showReceiptForTest = showReceipt;
export function _toastQueueDepth() { return U.toastQueue.length; }
/**
 * Reset the toast machinery WITHOUT writing the acknowledgement watermark.
 * Deliberately separate from `_clearToastsForChatPage()`: a fixture that reset
 * state by calling the function under test would be partly self-referential,
 * and a mutation to that function would crash the fixture instead of failing
 * the assertion that names the actual defect.
 */
export function _resetToastsForTest() { U.toastQueue.length = 0; U.toastShowing = false; }

/**
 * RG-26 — showToast() evaluates its chat-page suppression exactly ONCE, when
 * the toast is created. Nothing re-evaluated it on navigation, so a toast
 * raised on Standings/Rules/Picks/Comm survived navigateTo('chat') and sat at
 * top:14px over the chat feed — and with the shipped "Until dismissed"
 * duration pref (0, no auto-remove timer) it stayed there for good. Opening
 * the room IS reading the message, so the on-screen toast AND everything
 * queued behind it are cleared and acknowledged in one go.
 *
 * Idempotent — renderChatPage() also runs on every poll while chat is open,
 * where there is nothing queued (showToast suppresses on this page) and this
 * is a no-op.
 */
export function _clearToastsForChatPage() {
  const seqs = U.toastQueue.map(m => m?.seq).filter(s => typeof s === 'number');
  const el = typeof document !== 'undefined' ? document.getElementById('chat-toast') : null;
  if (el) {
    const s = Number(el.dataset?.seq);
    if (Number.isFinite(s) && s > 0) seqs.push(s);
    el.remove();
  }
  U.toastQueue.length = 0;
  U.toastShowing = false;
  if (seqs.length) setChatAckSeq(Math.max(...seqs));
}
/**
 * UN-102c: "stays for" duration is player-configurable (3s / 6s default /
 * 10s / Until dismissed = 0, no auto-remove timer) via getNotifPrefs(). A
 * manual ✕ is ALWAYS present regardless of duration — Drew: "needs to be
 * able to be dismissed" — iMessage banners are always manually dismissible
 * even when they also time out. The ✕ stops propagation so it dismisses
 * WITHOUT navigating; tapping anywhere else on the toast keeps the existing
 * dismiss-and-navigate behavior (item d, unchanged).
 */
function drainToast() {
  const msg = U.toastQueue.shift();
  if (!msg) { U.toastShowing = false; return; }
  U.toastShowing = true;
  document.getElementById('chat-toast')?.remove();
  const el = document.createElement('div');
  el.id = 'chat-toast';
  el.className = 'chat-toast';
  el.innerHTML = `<span class="chat-toast-avatar" style="${accentOf(msg.author) ? `background:${esc(accentOf(msg.author))};color:#fff` : ''}">${esc(initialsOf(msg.author))}</span>
    <span class="chat-toast-body"><strong>${esc(nameOf(msg.author))}</strong> ${esc((msg.body || '').slice(0, 80))}</span>
    <button type="button" class="chat-toast-dismiss" aria-label="Dismiss">✕</button>`;
  // RG-26 — carried on the node so _clearToastsForChatPage() can acknowledge
  // the message that is currently on screen, not just the ones still queued.
  if (typeof msg?.seq === 'number') el.dataset.seq = String(msg.seq);
  let autoTimer = null;
  const advance = () => { clearTimeout(autoTimer); el.remove(); U.toastShowing = false; setTimeout(drainToast, 250); };
  // RG-25 — an EXPLICIT dismissal (✕, or tapping through to the room) records
  // the shared acknowledgement so the dashboard teaser does not re-announce
  // the same message on the next tab. A toast that merely TIMES OUT calls
  // advance() only: the ambient teaser exists precisely to catch what you
  // missed (UN-93), so an unseen timeout must not silence it.
  const acknowledge = () => { if (typeof msg?.seq === 'number') setChatAckSeq(msg.seq); advance(); };
  el.querySelector?.('.chat-toast-dismiss')?.addEventListener('click', e => { e.stopPropagation(); acknowledge(); });
  el.addEventListener('click', () => { acknowledge(); navToChat(); });
  document.body.appendChild(el);
  const prefMs = getNotifPrefs().toastDuration;
  const ms = Number.isFinite(prefMs) ? prefMs : 6000;
  if (ms > 0) autoTimer = setTimeout(advance, ms);   // 0 = "Until dismissed" — no timer, ✕ or tap only
}
function navToChat() {
  document.querySelector('.nav-item[data-tab="chat"]')?.click();
}

/**
 * Item A — chat OFF must never leave a player stranded on a dead chat page.
 * Bounces to Dashboard with a toast. Uses the same window.* bridge pattern
 * already established for crossing the app.js/chat-ui.js boundary without a
 * circular import (see bindLoginPrompt's window.navigateTo usage) — app.js
 * exposes both window.navigateTo and window.showToast for exactly this.
 */
function redirectChatDisabled() {
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
    window.showToast('Chat has been turned off by the commissioner.', 'warning');
  }
  if (typeof window !== 'undefined' && typeof window.navigateTo === 'function') window.navigateTo('dashboard');
  else document.querySelector('.nav-item[data-tab="dashboard"]')?.click();
}

/**
 * ══ SECURITY A-1 (2026-09-21, RG-196) — "WHO IS ASKING?" IS THE FIRST QUESTION ══
 *
 * Every surface below speaks about a league's private room: a member's name, 64
 * characters of what they wrote, how many messages are waiting. None of it may
 * be produced for a viewer this device cannot name.
 *
 * WHAT WENT WRONG. On a Supabase boot the chat engine replays its device cache
 * before the config read (BUG-G, deliberate), so these surfaces run while `me()`
 * is still null — and `isUnreadFor(m, null, …)` compares `m.author !== null`,
 * which is TRUE for every message ever written. A viewer who is NOBODY was, by
 * construction, the viewer with the most unread mail. Until RG-194 a PIN overlay
 * happened to cover that; without it, a signed-out phone showed a member's name
 * and 64 characters of what they wrote.
 *
 * WHY THE PREDICATE IS INJECTED RATHER THAN `!me()`. "No player is logged in" is
 * NOT the same question as "this device may not see this league", and PIN mode
 * is the proof: there the site PIN is the credential, an anonymous viewer is a
 * legitimate state, and the dashboard (teaser included) has always rendered for
 * one. `!me()` would have quietly changed that too. The question that actually
 * matters is app.js's `isContentWithheld()` — no identity proven on this page, a
 * hold gate up, or an adapter that is not serving this league — and app.js owns
 * it. It is handed DOWN at boot (app.js imports this module; the reverse edge
 * would be a cycle) — which is also what keeps boottest [15]'s rule true: this
 * file still names the auth-mode accessor nowhere, because the mode is not the
 * question it asks. Unregistered the probe answers false, i.e. exactly today's
 * behaviour, so every suite that loads chat-ui.js on its own is unaffected.
 *
 * THE DIRECTION OF "UNKNOWN" IS THE WHOLE FIX. The old code did not crash or
 * throw — it silently substituted a cursor of zero for an unknown one, and zero
 * reads as "this person has seen nothing", i.e. everything is news. An unknown
 * viewer must produce NO statement at all, never a maximal one.
 */
let _contentWithheldProbe = null;
export function registerContentWithheldProbe(fn) {
  _contentWithheldProbe = typeof fn === 'function' ? fn : null;
}
function chatViewerUnresolved() {
  try { return _contentWithheldProbe ? !!_contentWithheldProbe() : false; }
  catch { return false; }   // a throwing host predicate must not take chat off every device
}
export const _chatViewerUnresolvedForTest = chatViewerUnresolved;

/**
 * ══ RG-196 RECONCILIATION (v0.23.3) — ONE DOOR BETWEEN THE CURSOR AND A PIXEL ══
 *
 * Two independent fixes landed on two branches for the same defect and met
 * here. They are complementary, not redundant, and this function is the seam
 * that makes them one contract instead of two habits:
 *
 *   • js/chat.js gained `unreadCountOrUnknown(selfId, tag) -> {known, count}`.
 *     "Caught up" and "identity not resolved" are BOTH the number 0; the flag
 *     is the entire difference between them.
 *   • this file gained `chatViewerUnresolved()` — app.js's `isContentWithheld()`
 *     handed down, i.e. "this device may not speak about this league yet",
 *     which is a strictly wider question than "no player id".
 *
 * Neither guard alone covers the other's case, so EVERY count this module
 * paints comes through here and arrives already carrying its own answerability.
 * A caller that wants a number must first ask whether there is one.
 *
 * THE RAW `unreadCount()` IS DELIBERATELY NOT IMPORTED INTO THIS FILE. That is
 * the enforcement, not a style choice: a future surface reaching for a bare
 * number gets a ReferenceError at load rather than a plausible-looking zero,
 * and unreadtest §[13] pins the absence so the import cannot quietly come back.
 */
function unreadForRender(self, tag = 'all') {
  if (chatViewerUnresolved()) return { known: false, count: 0 };
  return unreadCountOrUnknown(self, tag);
}
export const _unreadForRenderForTest = unreadForRender;

/**
 * The badge TEXT for one {known,count}, or '' when there is nothing to say.
 *
 * Defined once so the three badge surfaces cannot drift on either rule: the
 * "99+" ceiling, and — the one that matters — that an UNANSWERABLE count and a
 * count of zero produce the same empty string, by the same line of code. Also
 * the single point where the count becomes a String, which is what keeps
 * xsstest's classifier able to prove these sites cannot carry markup.
 */
function unreadBadgeText(u) {
  return (u && u.known && u.count > 0) ? (u.count > 99 ? '99+' : String(Number(u.count))) : '';
}

export function updateChatBadges() {
  // A-1: EMIT NOTHING — not "emit zero". The three surfaces below are shared
  // with the operating system (the tab title and the installed-app icon badge
  // both outlive this page), so writing a zero into them while the viewer is
  // unknown would destroy a true count rather than withhold a false one. This
  // is also the end of the "84 then 0" flash: there is no first, wrong number.
  if (chatViewerUnresolved()) return;
  const self = me();
  // v0.17.3 (caught in review): this was the FIFTH surface item A missed. With
  // chat off league-wide it still wrote the document title "(7) IRB Pick 'Ems"
  // and called navigator.setAppBadge(7) — which PERSISTS on the installed PWA
  // home-screen icon. A player taps in to clear a "7" and finds no Chat nav
  // entry, no bubbles, nothing to clear. n = 0 already drives the correct
  // clear on all three sub-surfaces below.
  // RECONCILIATION: the number can only come from a {known:true} read. An
  // unknown one yields 0, which drives the CLEAR below and never a digit —
  // clearing is not "rendering a count", and a deliberate sign-out in PIN mode
  // (a legitimate anonymous viewer, so `chatViewerUnresolved()` is false) must
  // still take the old badge down rather than leave a stale number on the
  // installed icon.
  const u = unreadForRender(self, 'all');
  const n = (u.known && isChatEnabled()) ? u.count : 0;
  // nav badge
  document.querySelectorAll('.nav-item[data-tab="chat"]').forEach(btn => {
    let b = btn.querySelector('.nav-unread');
    if (n > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'nav-unread'; btn.appendChild(b); }
      b.textContent = n > 99 ? '99+' : String(n);
    } else b?.remove();
  });
  // title badge
  try {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base;
  } catch {}
  // installed-PWA icon badge (not push — no permissions, degrades silently)
  // v0.17.2: these return Promises. A rejection escapes try/catch and lands as
  // an unhandled rejection (CONVENTIONS #4), which is exactly the class of
  // silent iOS breakage we were hunting. Catch the promise, not just the throw.
  try {
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      const p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch {}
}

// ── Filter pills ──────────────────────────────────────────────────────────────
function activeGameTags() {
  // Games worth a pill: any tagged traffic, or live games on the current slate.
  const tags = new Map();   // gameId -> lastTs
  // respectRetention: a game whose entire thread is hidden must not get a pill
  // that opens to an empty room.
  getMessages({ tag: 'all', respectRetention: true }).forEach(m => {
    if (m.gameTag) tags.set(m.gameTag, Math.max(tags.get(m.gameTag) || 0, m.ts || 0));
  });
  const wk = getCurrentWeek();
  if (wk) getGames(wk.weekId).forEach(g => {
    if (g.status === GAME_STATUS.LIVE && !tags.has(g.gameId)) tags.set(g.gameId, Date.now());
  });
  return [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 10);
}

function pillsHTML() {
  const self = me();
  const mainUnread = unreadForRender(self, 'all');
  // Takes the {known,count} shape, not a number: an unanswerable count paints
  // no dot at all, which is the same markup "caught up" produces and a
  // different reason for producing it.
  const dot = u => { const t = unreadBadgeText(u); return t ? `<span class="chat-unread-dot">${t}</span>` : ''; };
  // v0.17.1: mention inbox removed per commissioner. @mentions still highlight
  // and still count as notifying events for unread purposes — there's just no
  // separate filter view for them. The "Locker Room" pill covers all messages.
  let html = `
    <button class="chat-pill${U.filter === 'all' ? ' active' : ''}" data-chat-filter="all">Locker Room ${dot(mainUnread)}</button>
    <button class="chat-pill${U.filter === 'records' ? ' active' : ''}" data-chat-filter="records" title="Hall of Records">🏛 Records</button>`;
  activeGameTags().forEach(tag => {
    const found = gameById(tag);
    if (!found) return;
    const live = found.game.status === GAME_STATUS.LIVE;
    const n = unreadForRender(self, tag);
    html += `<button class="chat-pill${U.filter === tag ? ' active' : ''}${live ? ' chat-pill-live' : ''}" data-chat-filter="${esc(tag)}">
      ${live ? '<span class="live-pulse"></span>' : ''}${esc(gameShort(found.game, found.week))} ${dot(n)}</button>`;
  });
  return `<div class="chat-pills-scroll">${html}</div>`;
}
export const _pillsHTMLForTest = pillsHTML;

/**
 * Player-visible retention notice (UN-88). A player who scrolls back and hits
 * a wall deserves a calm factual explanation, not a mystery — shown to
 * everyone when the commissioner's retention window is ON, absent entirely
 * when it's OFF. Static copy, no user data, nothing to escape.
 */
/**
 * v0.17.2: with retention on, "↑ load earlier" is a dead control — it fires a
 * real Apps Script round-trip and then renders nothing, because everything it
 * backfills is older than the cutoff. Worse, it sits directly under a notice
 * saying "Showing the last 7 days", so the UI contradicts itself. Hide it.
 */
function retentionOn() {
  try { return getRetentionDays() > 0; } catch { return false; }
}

// UN-112: unlike retention (a rolling window that keeps sliding forward),
// the epoch is a FIXED point in the sequence — real history can still exist
// between "3 days ago" and a mid-season epoch, so this can't reuse
// retentionOn()'s always-hide-the-button logic. backfillBlockedByEpoch()
// (chat.js) only reports true once backfilling further could ONLY surface
// epoch-hidden messages — see the "load earlier" render site below.

function retentionNoticeHTML() {
  const days = getRetentionDays();
  if (days <= 0) return '';
  return `<div class="chat-retention-notice text-muted text-xs">Showing the last ${days} days. 🏛 Pinned messages are always kept.</div>`;
}

// ── F2 (UN-165) — in-chat search ──────────────────────────────────────────────
/**
 * Replaces `.chat-pills-scroll`'s row content IN PLACE when search is open —
 * zero additional steady-state vertical space (design-input requirement),
 * reusing a row height the layout already budgets for. See renderChatPage()
 * for the toggle between this and pillsHTML().
 */
function searchBarHTML() {
  // Non-blocking finding #8 — the clear (✕) and close (✕) buttons used to be
  // visually identical glyphs side by side. Clear now reads "Clear" (text,
  // only rendered when a query exists) and close keeps the ✕ glyph with an
  // explicit aria-label, so the two are distinguishable both visually and to
  // assistive tech.
  return `<div class="chat-search-row">
    <input type="text" id="chat-search-input" class="form-input chat-search-input"
      placeholder="Search this chat…" value="${esc(U.searchQuery)}" />
    ${U.searchQuery ? `<button class="btn btn-ghost btn-sm" id="chat-search-clear" title="Clear search" aria-label="Clear search">Clear</button>` : ''}
    <button class="btn btn-ghost btn-sm" id="chat-search-close" title="Close search" aria-label="Close search">✕</button>
  </div>`;
}

/**
 * Search is over the WHOLE room, not scoped to the current pill filter
 * (design input, verbatim: "a player searching for 'backdoor' shouldn't have
 * to remember which game thread it was in"). `respectRetention: true` — same
 * call the main feed already makes — so a retention/epoch-hidden message can
 * never surface as a result a player then can't actually jump to
 * (feedbacktest.mjs proves this against both hides independently).
 *
 * "Load older messages" (Part 0b correction #8, binding) — the fold only
 * holds this device's backfilled window; shown whenever backfilling further
 * could still surface more real history (the SAME condition the main feed's
 * own "↑ load earlier" button already uses — retention makes it pointless
 * (older messages would just be filtered right back out), the epoch makes it
 * impossible (nothing further back is anything but pre-launch test chatter)).
 */
function searchResultsHTML(query) {
  const results = getMessages({ tag: 'all', respectRetention: true, textContains: query })
    .filter(m => m.type === 'message' && !m.deleted);
  const canLoadOlder = !retentionOn() && !backfillBlockedByEpoch();
  const loadOlderHTML = canLoadOlder ? `<button class="chat-load-older" id="chat-search-load-older">Load older messages</button>` : '';
  if (!results.length) return `<div class="chat-empty">No messages match.</div>${loadOlderHTML}`;
  // Non-blocking finding #7 — bodyHTML(m) can emit <a>/<img> tags (F1/F4-
  // interim); nesting those inside a <button> is an invalid content model,
  // and a tap on a nested link would follow the link instead of jumping to
  // the message (a <button> doesn't natively navigate, but nested
  // interactive content inside interactive content is undefined/broken
  // behavior across browsers). Preferred fix per the design input: plain
  // escaped text preview, since a search result is a FINDER (jump-to), not a
  // place to actually interact with links/images.
  // The private self-test row is findable by search like any other row in the
  // reader's own room, so it carries the SAME chip here — a result that omitted
  // it would be the one place the marker is missing, which is exactly the
  // inconsistency CONVENTIONS #21 is about.
  const rows = results.map(m => `
    <button type="button" class="chat-search-result${isPrivateSelfTest(m) ? ' chat-msg-private' : ''}" data-search-jump="${esc(m.id)}">
      <span class="chat-search-result-meta"><strong>${esc(nameOf(m.author))}</strong> · ${relTime(m.ts)}${privateRowChipHTML(m)}</span>
      <span class="chat-search-result-body">${esc(m.body).replace(/\n/g, ' ')}</span>
    </button>`).join('');
  return `<div class="chat-search-results">${rows}</div>${loadOlderHTML}`;
}
// Test-only seam (same convention as `_quoteHTMLForTest`/`_messageHTMLForTest`)
// — reviewer BLOCK finding #4: direct coverage of the search RENDER function
// (not just getMessages() itself), so a regression that applies textContains
// without respectRetention inside THIS function specifically goes red.
export const _searchResultsHTMLForTest = searchResultsHTML;

// ── Message rendering ─────────────────────────────────────────────────────────
// F1 (UN-164) — a single tokenizing pass over the ALREADY-ESCAPED body: split
// on URL matches first, run mention-detection only on the leftover non-URL
// segments. This is the requirement DESIGN_INPUTS_BATCH1_091026.md Document 2
// names explicitly — two independent blind `.replace()` calls (URL pass then
// mention pass, or vice versa) can corrupt each other (a URL containing '@',
// e.g. `https://x.com/@drew`, matched by the mention pass AFTER linkify would
// inject a `<span>` INSIDE an href attribute value). Splitting first makes
// the two passes operate on disjoint text by construction, not by ordering
// discipline — feedbacktest.mjs proves this against the adversarial case.
//
// URL_RE has exactly ONE capturing group, so `String.split(URL_RE)` on the
// escaped body interleaves [text, urlMatch, text, urlMatch, ...] — odd
// indices are URL tokens, even indices are plain text. No protocol-relative
// (`//…`) matches — ambiguous with plain text, not worth the false-positive
// risk in a 6-person room (explicit design-input bound).
const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
// Trailing-punctuation trim — "check this out (https://example.com)." must
// not swallow the sentence's own closing punctuation into the href. Only the
// characters that can actually survive esc() as literal trailing chars in
// practice (`)`, `]`, `,`, `.`) — deliberately NOT `;` (an HTML entity like
// `&amp;` ends in `;`; trimming it would corrupt the entity, not the URL).
const URL_TRAILING_PUNCT_RE = /[)\],.]+$/;
const MENTION_RE = /@([A-Za-z][\w.']*)/g;
// F4-interim (Drew's decision: build now, off-by-default) — case-insensitive
// image-extension allow-list, query/hash-aware.
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)(?:[?#]|$)/i;

function linkifySegment(text) {
  // Mentions only — every URL substring has ALREADY been split out into its
  // own token before this ever runs (see bodyHTML() below), so this can
  // never fire on text the URL pass produced.
  return text.replace(MENTION_RE, '<span class="chat-mention">@$1</span>');
}

/**
 * `raw` is a slice of the ALREADY-ESCAPED body — esc() has already turned
 * every `<`/`>`/`&`/`"`/`'` in the player's original text into inert
 * entities, so `raw` can contain no raw `<`/`>` by construction. The only
 * markup this function's OWN output introduces is the `<a>` (and, gated,
 * `<img>`) wrapper it writes itself — it cannot be used to prematurely close
 * or inject into that tag.
 */
function renderUrlToken(raw, imgPreview) {
  let url = raw;
  let trail = '';
  const tm = URL_TRAILING_PUNCT_RE.exec(url);
  if (tm) { trail = tm[0]; url = url.slice(0, url.length - trail.length); }
  if (!url) return raw;   // degenerate: the whole token was punctuation — bail out unlinked
  const href = /^www\./i.test(url) ? `https://${url}` : url;
  // XSS-HARDEN round 2, C6 (2026-09-12) — DEFENCE IN DEPTH. Today the only
  // caller is bodyHTML(), whose URL_RE matches http(s):// and www. and nothing
  // else, so `javascript:`/`data:` cannot reach here through chat. This
  // function nevertheless writes an <a href> (and, gated, an <img src>) out of
  // its argument and used to trust whatever it was handed — so it now checks
  // its own precondition. A non-http(s) token renders as the plain text it
  // already is: `raw` arrives ALREADY ESCAPED from bodyHTML() (see this
  // function's contract above), so it is returned unchanged rather than run
  // through esc() a second time, which would print `&amp;amp;` for the `&` in
  // any ordinary query string.
  if (!/^https?:\/\//i.test(href)) return raw;
  const link = `<a href="${href}" rel="noopener noreferrer" target="_blank">${url}</a>`;
  // F4-interim — gated behind settings.chatImagePreviewEnabled (off by
  // default, D7/Drew's decision). `loading="lazy" referrerpolicy="no-referrer"`
  // per the design input; the passive-IP-disclosure caveat it also names is
  // why this stays a flag rather than F1's unconditional default.
  const img = (imgPreview && IMAGE_EXT_RE.test(href.split(/[?#]/)[0]))
    ? `<br><img src="${href}" loading="lazy" referrerpolicy="no-referrer" class="chat-img-preview" alt="">` : '';
  return `${link}${img}${trail}`;
}

// Test-only seams (same convention as `_quoteHTMLForTest`/`_messageHTMLForTest`).
// renderUrlToken() writes an <a href> out of its argument, so xsstest [11]
// drives it DIRECTLY with hostile schemes rather than only through bodyHTML().
export const _renderUrlTokenForTest = renderUrlToken;
export const _escForTest = esc;

function bodyHTML(m) {
  const escaped = esc(m.body);
  const imgPreview = isChatImagePreviewEnabled();
  const parts = escaped.split(URL_RE);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    out += (i % 2 === 1) ? renderUrlToken(parts[i], imgPreview) : linkifySegment(parts[i] || '');
  }
  return out;
}

/**
 * The static quote visual — author + truncated body — extracted so the FEAT-5
 * wager modal (app.js) renders the SAME markup rather than a second copy of it
 * (CONVENTIONS #21). Byte-identical output to what quoteHTML() emitted inline
 * before the extraction for the 120-char callout case.
 */
export function staticQuoteHTML(author, body, max = 120) {
  return `<div class="chat-reply-quote chat-quote-static">↩ <strong>${esc(nameOf(author))}</strong>: ${esc(String(body || '').slice(0, max))}</div>`;
}

function quoteHTML(m) {
  const q = m.meta?.quote;
  if (q) {
    return staticQuoteHTML(q.author, q.body, 120);
  }
  if (!m.replyTo) return '';
  const parent = getMessage(m.replyTo);
  if (!parent) return '';
  // F3 (UN-166) — getMessage() reads the fold's S.items map DIRECTLY,
  // unfiltered by retention/epoch (those are render-time filters applied
  // only inside getMessages()). A parent that has aged past the retention
  // window, or predates the epoch cutoff, still exists in the fold — so
  // without this check, this would render a live-looking, TAPPABLE quote
  // whose data-jump target will never exist in the current DOM: a silent
  // dead tap. This is the one real gap this DI closes (everything else about
  // quote-reply rendering already worked) — non-interactive, no data-jump,
  // not a <button>, when the parent is hidden either way.
  if (isHiddenByRetention(parent) || isHiddenByEpoch(parent)) {
    return `<div class="chat-reply-quote chat-quote-hidden">↩ replying to an earlier message (not shown)</div>`;
  }
  // Deleted parent (pre-existing behavior, UNCHANGED functionally) — still
  // tappable (jumping to the tombstone is real context: "a reply to
  // something withdrawn"), now visually muted so it reads at a glance as
  // distinct from a normal live quote (the other gap this DI closes).
  const muted = parent.deleted ? ' chat-quote-muted' : '';
  return `<button class="chat-reply-quote${muted}" data-jump="${esc(parent.id)}">↩ <strong>${esc(nameOf(parent.author))}</strong>: ${esc((parent.deleted ? 'message withdrawn' : parent.body).slice(0, 90))}</button>`;
}
// Test-only seam (same convention as `_reactionsHTML`/`_messageHTMLForTest`)
// — F3 (UN-166)'s one real functional gap (retention/epoch-hidden parent)
// needs direct coverage, not just an indirect read through messageHTML().
export const _quoteHTMLForTest = quoteHTML;

/**
 * `trailing` (2026-09-10, E1 follow-up) — extra content pinned to the RIGHT
 * end of this same row. Today its only caller passes persistentStarHTML().
 * It exists so the persistent ⭐ REUSES the existing reactions row instead of
 * adding a second footer row (explicit design input: "reuse that row, do not
 * add a new row; keep compact density per RG-20/34"). When `trailing` is ''
 * — every non-SCRIBE message, and every message with instrumentation off —
 * this function's output is byte-for-byte what it was before, including the
 * empty-string early return.
 */
function reactionsHTML(m, self, trailing = '') {
  const entries = Object.entries(m.reactions || {});
  if (!entries.length && !trailing) return '';
  if (!entries.length) return `<div class="chat-reactions">${trailing}</div>`;
  // UN-114: attribution moved off `title` (removed below) and onto an
  // always-visible line — tooltips don't fire on touch, the exact
  // anti-pattern already named three times in this codebase (see
  // reactionNamesHTML). The pill's own tap-to-toggle ([data-react] handler)
  // is unchanged.
  const pills = entries.map(([emoji, who]) =>
    `<button class="chat-react-pill${who.includes(self) ? ' me' : ''}" data-react="${esc(emoji)}" data-target="${esc(m.id)}">${esc(emoji)} ${who.length}</button>`).join('');
  return `<div class="chat-reactions">${pills}${trailing}</div>${reactionNamesHTML(entries)}`;
}

/**
 * UN-114 — "who reacted with what," always-visible plain text beneath the
 * pill row. NOT a tooltip/`title` (doesn't fire on touch) and NOT a gesture
 * (would collide with the pill's existing tap-to-toggle-my-own-reaction
 * behavior). Format: "🔥 Drew, Kevin · 👍 Kihoon" — groups joined by " · ",
 * names within a group by ", ", via the existing nickname-aware nameOf().
 * No truncation/"+2 more" logic — a six-player room (plus SCRIBE) never
 * produces a list long enough to need one, per design input.
 */
function reactionNamesHTML(entries) {
  if (!entries.length) return '';
  const groups = entries.map(([emoji, who]) =>
    `${esc(emoji)} ${who.map(id => esc(nameOf(id))).join(', ')}`).join(' · ');
  return `<div class="chat-reaction-names">${groups}</div>`;
}

// Exported test-only (see _chatSyncBadgeHTML's convention above) so loadtest
// can exercise the REAL reaction-attribution rendering, not just regex-match
// template source.
export const _reactionsHTML = reactionsHTML;

function tagChipHTML(m) {
  if (!m.gameTag || U.filter === m.gameTag) return '';
  const found = gameById(m.gameTag);
  if (!found) return '';
  // v0.17.2: spread removed from message chips — it's redundant with the game
  // thread header card and the dashboard. Chips show matchup shorthand only.
  return `<button class="chat-game-chip" data-chat-filter="${esc(m.gameTag)}">${esc(gameShort(found.game, found.week))}</button>`;
}

function calloutEligible(m) {
  // One-tap callout: tagged message, game final, posted pre-kick, author lost it ATS
  if (!m.gameTag || m.type !== 'message' || m.deleted) return false;
  const found = gameById(m.gameTag);
  if (!found || found.game.status !== GAME_STATUS.FINAL) return false;
  // RG-46 — found by the structural scan in loadtest [64], not by a bug report.
  // This gated on the GAME being final and never on the WEEK, so on a week left
  // OPEN with picksLockAt in the future (the same reachable window as RG-45)
  // the 📎 rendered across the room. Its PRESENCE is the disclosure: the button
  // only appears when the author's pick LOST ATS, and in a two-outcome game
  // "not the covering team" identifies the pick exactly. messageHTML() renders
  // it for every viewer, so this was the whole league reading each other's
  // picks off finished games while still able to submit their own.
  if (!arePicksPublic(found.week)) return false;
  const ats = found.game.atsWinner ?? calculateAtsWinner(found.game);
  if (!ats || ats === 'no_decision') return false;
  const pick = getPicks(found.week.weekId, m.author).find(p => p.gameId === m.gameTag);
  if (!pick || pick.selectedTeam === ats) return false;
  return found.game.kickoff && (m.ts || 0) < new Date(found.game.kickoff).getTime();
}

// ── E1 (UN-159) — SCRIBE feedback controls ────────────────────────────────────
/**
 * One new icon in `.chat-actions`, context-sensitive by author, FIRST
 * position (highest-priority — "the entire point of the pilot
 * instrumentation, it should not be buried after reply/pin/edit" — design
 * input, verbatim). `.chat-actions` is already a confirmed density hazard
 * (RG-13/16/17/20/34 lineage) — this is the "+1 icon net regardless of
 * message type" solution: one entry point, a small anchored popover, never
 * six new inline icons.
 *
 * Reads via getFeedbackFor(), scoped to `self` — the CURRENT viewer's own
 * state ONLY. Every device's fold actually holds every player's feedback
 * (the poll ingests every event type, same as reactions/pins), but this
 * function never reads any entry but `[self]` — that's what makes the
 * attribution-privacy boundary a UI-level guarantee, not a lookup gap
 * (Attribution section, Part 0b correction #10 — explicitly UI-level only,
 * not stronger than KEYS.FEEDBACK's existing precedent).
 */
/**
 * THE one reader of "what did *I* say about this message" — shared verbatim by
 * both feedback entry points (the long-press `.chat-actions` ⭐ and the
 * persistent ⭐ below), so the two can never drift into showing different
 * states for the same message. Scoped to `self` only; see feedbackButtonHTML's
 * attribution-privacy note.
 */
function myFeedbackState(m, self) {
  const mine = self ? (getFeedbackFor(m.id)[self] || {}) : {};
  const rating = mine.rating || null;
  const hasRewrite = typeof mine.rewrite === 'string' && mine.rewrite.length > 0;
  return { rating, hasRewrite, rated: !!rating || hasRewrite };
}

function feedbackButtonHTML(m, self) {
  // FEAT-3 / DI-200i — SUPPRESSION 1 OF 2. A changelog is not a SCRIBE line to
  // be rated: Hit/Mid/Too-much on it would feed the Trainer's learning loop with
  // noise about copy nobody wrote in SCRIBE's voice. The second suppression is
  // in persistentStarHTML() below — they are different functions and honouring
  // only one is the exact failure shape the retention filter had (the stream
  // obeyed it, the count didn't).
  if (m.meta?.kind === 'whatsNew') return '';
  // FEAT-5 / DI-202f — SUPPRESSION 1 OF 2, same trap, same two functions. A
  // wager receipt or callback is a SCRIBE-authored MECHANISM, not a SCRIBE
  // LINE: most of its text is a player's own words read back. Rating it
  // Hit/Mid/Too-much would feed the Trainer noise about copy nobody wrote in
  // SCRIBE's voice. The second suppression is in persistentStarHTML() below.
  if (m.meta?.kind === 'wagerLogged' || m.meta?.kind === 'wagerDue') return '';
  if (m.author === 'scribe') {
    const { rating } = myFeedbackState(m, self);
    const label = { hit: '⭐ Hit', mid: '⭐ Mid', too_much: '⭐ Too much' }[rating] || '⭐ Rate';
    return `<button class="chat-act chat-act-feedback" data-fb-open="${esc(m.id)}" title="Rate this SCRIBE line">${label}</button>`;
  }
  if (m.author === 'system') return '';
  return `<button class="chat-act chat-act-feedback" data-fb-open="${esc(m.id)}" title="Flag this message">🚩 Flag</button>`;
}

/**
 * E1 follow-up (2026-09-10, Drew approved recommendation (b)) — ALWAYS-VISIBLE
 * ⭐ in the bubble footer, SCRIBE messages ONLY.
 *
 * WHY: rating a SCRIBE line was a three-gesture path — long-press (or
 * right-click) to reveal `.chat-actions`, tap ⭐, tap a rating. The pilot's
 * whole value is how many ratings actually get collected, and the affordance
 * was invisible until you already knew it was there. This is the one-gesture
 * entry point: tap → popover → rate.
 *
 * IT IS NOT A SECOND CODE PATH. It renders the same `data-fb-open` attribute
 * the `.chat-actions` ⭐ does, so bindMessageActionButtons()'s single
 * `[data-fb-open]` handler wires it, and it opens the SAME popover via the
 * SAME toggleFeedbackPicker() — no duplicated rating logic anywhere.
 * (toggleFeedbackPicker anchors to `anchorEl.closest('.chat-actions,
 * .chat-reactions') || anchorEl`. This button's row container,
 * `.chat-reactions`, is position:relative in styles.css, so the popover
 * hangs off the ROW's left edge — the same containing block the
 * `.chat-actions` entry point gets, rather than off this right-aligned
 * button, which pushed the popover off-screen. Corrected 2026-09-10,
 * reviewer BLOCK finding #1; `position:relative` on `.chat-fb-star` itself
 * remains, but now only for its ::after tap-target overlay.)
 *
 * ABSENT ENTIRELY (not hidden, zero trace in the HTML) when: the author is
 * not SCRIBE, the master switch is off, or the message is deleted/withdrawn.
 * Human messages are untouched — 🚩 Flag stays behind the long-press.
 *
 * STATE: hollow/muted ⭐ when I have not rated it; my own value's glyph when I
 * have. `myFeedbackState()` is the single shared reader, so this and the
 * `.chat-actions` ⭐ always agree about what I said. The glyphs here are the
 * popover's own (🔥/😐/🚫/✏️, feedbackPopoverHTML below) rather than
 * `.chat-actions`'s word labels — a compact always-on control has no room for
 * "⭐ Too much", and matching the popover's glyphs is what makes the state
 * legible at a glance. A rating outranks a rewrite when a player has both:
 * the rating is the value this control primarily collects.
 */
function persistentStarHTML(m, self) {
  // FEAT-3 / DI-200i — SUPPRESSION 2 OF 2 (see feedbackButtonHTML above).
  if (m.meta?.kind === 'whatsNew') return '';
  // FEAT-5 / DI-202f — SUPPRESSION 2 OF 2 for the wager posts. Fixing one of
  // these two functions and not the other is the exact failure shape the
  // retention filter had (the stream obeyed it, the count didn't).
  if (m.meta?.kind === 'wagerLogged' || m.meta?.kind === 'wagerDue') return '';
  if (m.author !== 'scribe' || m.deleted || !self || !isScribeFeedbackEnabled()) return ''; // !self: a signed-out reader gets no dead control (reviewer 2026-09-10)
  const { rating, hasRewrite, rated } = myFeedbackState(m, self);
  const glyph = { hit: '🔥', mid: '😐', too_much: '🚫' }[rating] || (hasRewrite ? '✏️' : '⭐');
  const title = rated ? 'Your rating — tap to change' : 'Rate this SCRIBE line';
  return `<button class="chat-fb-star ${rated ? 'is-rated' : 'is-unrated'}" data-fb-open="${esc(m.id)}" title="${esc(title)}" aria-label="${esc(title)}">${glyph}</button>`;
}
// Test-only seam (same convention as `_feedbackPopoverHTMLForTest`) — direct
// coverage of the SCRIBE-only gate and the state glyph, so a regression goes
// red on its own assertion rather than only inside messageHTML()'s composite.
export const _persistentStarHTMLForTest = persistentStarHTML;

// ── DI-268/DI-269 (UN-245/UN-246) — reason chips + the optional "why" ────────
/**
 * SUPPRESSION 3 OF 3 (see feedbackButtonHTML and persistentStarHTML above).
 *
 * A changelog post and a wager receipt are SCRIBE-authored MECHANISMS, not
 * SCRIBE LINES — both already refuse the ⭐ entirely, so neither can normally
 * reach this popover at all. The guard is repeated here anyway because the
 * failure shape those two functions' comments describe is EXACTLY this one:
 * honouring the rule in some of the places that render the feature and not in
 * the others. If a future entry point ever opens the popover on one of these,
 * it gets a rating and stops there — no chips, no note, nothing that would feed
 * the Trainer opinions about copy nobody wrote in SCRIBE's voice.
 *
 * Unlike its two siblings this one is a named predicate rather than an inline
 * `if`: the two above are pinned verbatim by feedbacktest's mutation fixtures,
 * and rewriting them to share this helper would change source text those tests
 * read. The list of kinds is the same list, deliberately spelled out so a grep
 * for `wagerLogged` still finds every site.
 */
const FEEDBACK_EXTRAS_SUPPRESSED_KINDS = ['whatsNew', 'wagerLogged', 'wagerDue'];
function feedbackExtrasSuppressed(m) {
  return FEEDBACK_EXTRAS_SUPPRESSED_KINDS.includes(m?.meta?.kind);
}

/** The rater's own chip set, defended at the READ boundary as well as the
 *  write one: the fold stores whatever a 'reason' event carried, and this is a
 *  render path, so a malformed value must produce an empty row rather than a
 *  thrown template. */
function reasonChipsOf(mine) {
  const raw = mine?.reason;
  return Array.isArray(raw) ? raw.filter(c => SCRIBE_FEEDBACK_REASON_CHIPS.includes(c)) : [];
}

/** Chips of one family, in the closed set's own order (DI-268: the order IS
 *  the render order, so a chip added to the taxonomy appears here without a
 *  second list to update). */
function chipsInFamily(family) {
  return SCRIBE_FEEDBACK_REASON_CHIPS.filter(c => SCRIBE_FEEDBACK_CHIP_FAMILY[c] === family);
}

function reasonChipHTML(chip, selected) {
  const label = REASON_CHIP_COPY[chip] || chip;
  return `<button type="button" class="feedback-chip${selected.includes(chip) ? ' active' : ''}" `
       + `data-fb-chip="${esc(chip)}" aria-pressed="${selected.includes(chip) ? 'true' : 'false'}">${esc(label)}</button>`;
}

/**
 * The second row of the SAME popover — revealed by the rating itself, never by
 * a second open/close cycle (DI-268's explicit requirement).
 *
 * WHAT RENDERS WHEN:
 *   no rating yet   → nothing. The 2×2 grid stays exactly what it has always
 *                     been, so a player who only wants to rate still spends one
 *                     tap and is done. The chip step is OPTIONAL — dismissing
 *                     with zero chips leaves just the rating, which is the
 *                     "one extra tap floor" the design input protects.
 *   mid / too_much  → "What kind of miss?", then the ANNOYING family, then the
 *                     MEAN family, then the four shared diagnostics. The two
 *                     families are visually separate because they argue for
 *                     opposite corrections (talk less vs. hit softer) and
 *                     Drew's ruling 7 turns on never confusing the two.
 *   hit             → the single positive chip, alone, no cluster headings —
 *                     there is nothing to disambiguate when the line landed.
 * In all three rated states the optional free-text "why" (DI-269) sits last.
 */
function reasonSectionHTML(m, self, mine, rating, working) {
  if (!rating || feedbackExtrasSuppressed(m)) return '';
  // R-6 — `working` (this popover's own in-flight state) still outranks
  // everything; below it, what this device last SENT outranks the lagging fold.
  // See chipsOnFileFor()/noteOnFileFor() for why that override is bounded.
  const selected = working && Array.isArray(working.chips) ? working.chips : chipsOnFileFor(m.id, self, mine);
  const note = working && typeof working.note === 'string' ? working.note : noteOnFileFor(m.id, self, mine);
  const C = REASON_CHIP_SECTION_COPY;
  const row = chips => `<div class="feedback-chip-row">${chips.map(c => reasonChipHTML(c, selected)).join('')}</div>`;
  const group = (label, family) => `<div class="feedback-chip-group">${esc(label)}</div>${row(chipsInFamily(family))}`;
  const body = rating === 'hit'
    ? `<div class="feedback-reason-prompt">${esc(C.hitPrompt)}</div>${row(chipsInFamily('positive'))}`
    : `<div class="feedback-reason-prompt">${esc(C.missPrompt)}</div>`
      + group(C.annoyingGroup, 'annoying')
      + group(C.meanGroup, 'mean')
      + group(C.sharedGroup, 'shared');
  // maxlength AND the boundary clamp in recordFeedback() (DI-269) — the input
  // stops a human at 280; the clamp stops everything else.
  return `<div class="feedback-reason">${body}
    <input type="text" class="feedback-note-input" data-fb-note="1" maxlength="280"
      value="${esc(note)}" placeholder="${esc(C.notePlaceholder)}" aria-label="${esc(C.noteLabel)}">
  </div>`;
}

/**
 * Popover contents. SCRIBE messages: 2×2 grid, 🔥 Hit · 😐 Mid · 🚫 Too much ·
 * ✏️ Rewrite — word label + emoji (not emoji-only; four single-character
 * glyphs are not distinct enough at speed, per design input). `🚫 Too much`
 * is deliberately rendered with EQUAL visual weight to the other three
 * (Drew's decision, D6) — not larger, not a different color, despite the
 * briefing calling it "the most important button" (that claim is about the
 * DATA it produces, not required UI emphasis — flagged explicitly in the
 * design-input review, not silently resolved either way).
 *
 * Human messages: 📌 Remember this · 👁 Weigh in, stacked.
 *
 * Every option shows a "filled/checked" `.active` state when the RATER's own
 * current value is set — the design input names this explicitly only for
 * ✏️ Rewrite ("shows a filled/checked state... so the rater can tell they
 * already wrote one"); applied here uniformly across all six options as the
 * same mechanism, same reasoning, not a new one per option.
 */
function feedbackPopoverHTML(m, self, working = null) {
  const mine = self ? (getFeedbackFor(m.id)[self] || {}) : {};
  if (m.author === 'scribe') {
    // `working` is the popover's own in-flight state and OUTRANKS the fold
    // while it is open — see mountFeedbackPicker()'s comment on why the fold
    // cannot be the source of truth between a tap and its server echo.
    const rating = working && 'rating' in working ? working.rating : (mine.rating || null);
    const opt = (val, emoji, label) =>
      `<button type="button" class="feedback-pick-option${rating === val ? ' active' : ''}" data-fb-rating="${esc(val)}">${esc(emoji)} ${esc(label)}</button>`;
    return `<div class="feedback-picker feedback-picker-grid">
      ${opt('hit', '🔥', 'Hit')}
      ${opt('mid', '😐', 'Mid')}
      ${opt('too_much', '🚫', 'Too much')}
      <button type="button" class="feedback-pick-option${mine.rewrite ? ' active' : ''}" data-fb-rewrite="1">✏️ Rewrite</button>
    </div>${reasonSectionHTML(m, self, mine, rating, working)}`;
  }
  return `<div class="feedback-picker feedback-picker-stack">
    <button type="button" class="feedback-pick-option${mine.remember_this ? ' active' : ''}" data-fb-remember="1">📌 Remember this</button>
    <button type="button" class="feedback-pick-option${mine.weigh_in ? ' active' : ''}" data-fb-weighin="1">👁 Weigh in</button>
  </div>`;
}
// Test-only seam (same convention as `_quoteHTMLForTest`/`_messageHTMLForTest`)
// — reviewer BLOCK finding #4: direct coverage of the popover's own render
// function, so a regression to any of the six controls' labels/data-fb-*
// attributes, or to D6's "equal styling, no distinct emphasis class" rule,
// goes red instead of being invisible behind messageHTML()'s composite output.
export const _feedbackPopoverHTMLForTest = feedbackPopoverHTML;

/**
 * Reuses toggleMessageReactPicker()'s exact anchoring mechanism VERBATIM
 * (design-input requirement): `position:absolute`, anchored to a positioned
 * ROW CONTAINER (same containing block), single-open-at-a-time (closes the
 * reaction picker too, if open — and vice versa, see toggleMessageReactPicker
 * below), dismissed by outside-click/Escape/scroll via the SAME closer
 * pattern `#chat-react-picker` already uses.
 *
 * The host selector is `.chat-actions, .chat-reactions` — BOTH row
 * containers, never the trigger button itself (reviewer BLOCK, 2026-09-10,
 * findings #1 and #2). The persistent ⭐ (persistentStarHTML) lives in
 * `.chat-reactions` and is `margin-left:auto` right-aligned, so hosting the
 * popover on the BUTTON anchored `.reaction-picker{left:0}` to the button's
 * own left edge (x≈326 on a 390px viewport) and pushed a ~320px popover
 * ~256px past the viewport — `.chat-scroll`'s computed `overflow-x:auto`
 * then showed a horizontal sliver and scrollbar. Hosting on the ROW instead
 * puts `left:0` at the bubble column's left edge (x≈62), which is exactly
 * where the `.chat-actions` path already opened it and which fits a 320px
 * popover inside a 390px viewport with room to spare.
 *
 * Hosting on the row also fixes finding #2: appending an absolutely
 * positioned <div> full of <button>s INSIDE a <button> is invalid nested
 * interactive content, and a mis-tap on the popover's own padding bubbled
 * back up to the ⭐ and closed the thing the player was aiming at. As a
 * SIBLING of the ⭐ there is no nesting and no bubbling-to-trigger.
 *
 * `.chat-reactions` and `.chat-actions` are never ancestors of one another
 * (siblings inside `.chat-bubble-col`), so `closest()` on either trigger is
 * unambiguous: the long-press ⭐ resolves to `.chat-actions`, the persistent
 * ⭐ to `.chat-reactions`. Both are descendants of `.chat-msg[data-mid=…]`,
 * so the reveal-closer's "click inside the revealed message" check still
 * treats a click in the popover as inside (see [17] in feedbacktest.mjs).
 */
function toggleFeedbackPicker(anchorEl, mid, renderFn = renderChatPage, surface = 'main') {
  const existing = document.getElementById('chat-feedback-picker');
  const reopening = existing?.dataset?.mid === mid;
  existing?.remove();
  document.getElementById('chat-react-picker')?.remove();   // single-open-at-a-time across BOTH popovers
  // R-4 (2026-09-23) — RE-TAPPING THE ⭐ IS A DISMISSAL, AND A DISMISSAL SAVES.
  // This path used to be the one exit that wrote nothing: a player who typed a
  // "why" and then tapped the star again to put the popover away lost the
  // sentence, silently. Disarm first (a write repaints, and an armed marker
  // would re-mount the popover being dismissed), then flush.
  if (reopening) { pendingFeedbackPicker = null; flushOpenFeedbackPicker(); return; }
  const self = me(); if (!self) return;
  const m = getMessage(mid); if (!m) return;
  // R-4/F-3 — a popover for a DIFFERENT message was just discarded by the
  // `existing?.remove()` above, and it may hold a typed note or a chip set still
  // inside its debounce window. Its flush is taken NOW (the mount below is about
  // to overwrite the module-level slot) but RUN AFTER the new popover mounts:
  // the write repaints the room, and the repaint re-mounts whatever the marker
  // names — doing it first would strand this mount on a detached row.
  const discarded = existing ? takeFeedbackPickerFlush() : null;
  // Row container, never the trigger button — see the block comment above.
  const host = anchorEl.closest?.('.chat-actions, .chat-reactions') || anchorEl;
  mountFeedbackPicker({ host, m, self, mid, surface, renderFn, working: null });
  if (existing) flushFeedbackPickerWork(discarded);
}

/**
 * DI-268 — THE POPOVER HAS TO OUTLIVE ITS OWN WRITES, AND THAT IS THE WHOLE
 * REASON THIS FUNCTION EXISTS SEPARATELY FROM THE TOGGLE ABOVE.
 *
 * Revealing the reason chips "in the SAME popover, no extra open/close cycle"
 * runs straight into two facts about this codebase:
 *
 *  1. EVERY WRITE REPAINTS THE ROOM. `recordFeedback()` → `sendEvent()` →
 *     `ingest()` notifies `handleChatEvent`, which calls `renderChatPage()`
 *     synchronously — and that rebuilds `#page-chat`'s innerHTML, destroying
 *     this node. The old code sidestepped it by closing the popover on every
 *     tap; a popover that stays open cannot.
 *  2. A LOCAL WRITE IS STAMPED {ts:0, seq:0} until the server echoes it back,
 *     and `applyTo()` drops a same-key event that does not beat the current
 *     stamp. So the SECOND tap on the same `(author, 'reason')` key does not
 *     change the fold at all until the echo lands — a pre-existing property
 *     shared with reactions and ratings, harmless when the control closes on
 *     the first tap, fatal for a multi-select row that has to show its own
 *     state back.
 *
 * Both are answered by the same two pieces: `working` — the popover's in-flight
 * truth, which outranks the fold while it is open — and `pendingFeedbackPicker`
 * — a module-level marker saying "a popover for this message, on this surface,
 * in this state, was open when the repaint started." `bindMessageActionButtons()`
 * re-mounts from that marker on the surface that owns it, which is the same
 * function that re-binds every other per-message control after a repaint, so
 * the popover is restored by the mechanism that destroyed it rather than by a
 * second timer racing it.
 *
 * The marker is cleared on every dismissal path (outside click, re-tapping the
 * trigger, opening the reaction picker, a rating cleared back to untouched, any
 * modal that takes over). A click anywhere in the document that is not in the
 * popover closes it, so it cannot survive the player leaving the page.
 */
let pendingFeedbackPicker = null;   // { mid, surface, author, working } while one is open

/**
 * F-3(a) — CHIP TAPS COALESCE BEHIND A TRAILING DEBOUNCE (2026-09-23).
 *
 * A player picking three chips wrote three rows into the append-only log, two
 * of which were obsolete the instant the next tap landed. Coalescing is only
 * safe because `recordFeedbackReasons()` writes a SET, NOT A DIFF: the last row
 * written IS the whole answer, so dropping the intermediate ones loses nothing
 * a reader could have used. (A diff-based event could not be debounced at all —
 * that is the same property AD-09/AD-10's order-independence rests on.)
 *
 * MODULE-LEVEL, NOT IN THE MOUNT'S CLOSURE, for the reason everything else
 * about this popover is: every write repaints the room and the repaint
 * re-mounts the popover, so closure state is destroyed and rebuilt several
 * times inside one debounce window. The timer, the pending set and the record
 * of what was last SENT all have to outlive the node.
 *
 * `lastSentChips`/`lastSentNote` are what THIS DEVICE actually put on the wire.
 * They are not the same as the fold: a local event is stamped {ts:0, seq:0}
 * until the server echoes it, and applyTo() drops a second write to a key that
 * already holds a same-stamped op — so right after an edit the fold still reads
 * the PREVIOUS value. Comparing against the fold is what made Enter-then-blur
 * write the same note twice (F-3(b)), and it is what would make the R-1 cascade
 * fire redundantly.
 */
const CHIP_WRITE_DEBOUNCE_MS = 400;
let chipWriteTimer = null;
let pendingChipWrite = null;   // { mid, author, chips } — tapped, not yet sent
let lastSentChips = null;      // { mid, author, chips } — the last set this device SENT
let lastSentNote = null;       // { mid, author, text }  — the last note this device SENT
// The live popover's "write what I have in flight" closure, taken by the
// dismissal paths that live outside mountFeedbackPicker() (R-4).
let openPickerFlush = null;

const lastSentFor = (rec, mid, author) => (rec && rec.mid === mid && rec.author === author ? rec : null);
function cancelChipWriteTimer() { if (chipWriteTimer) { clearTimeout(chipWriteTimer); chipWriteTimer = null; } }

/** The ONE place a chip set goes on the wire, so `lastSentChips` can never
 *  disagree with what was actually written. `foldAtSend` is the fold's value
 *  immediately BEFORE the send — see the R-6 readers below for what it decides. */
function sendChips({ mid, author, chips }) {
  const foldAtSend = JSON.stringify(reasonChipsOf(getFeedbackFor(mid)[author]));
  const ok = typeof recordFeedbackReasons({ targetId: mid, chips, author }) === 'string';
  if (ok) lastSentChips = { mid, author, chips, foldAtSend };
  return ok;
}

/**
 * R-6 (2026-09-23) — WHAT THIS DEVICE LAST SENT OUTRANKS THE FOLD IN THE
 * RATER'S OWN ROW, BUT ONLY UNTIL THE LOG MOVES.
 *
 * `mine.reason` / `mine.reason_note` lag by one server echo: a local event is
 * stamped {ts:0, seq:0} and applyTo() drops a second write to a key that
 * already holds one. A player who edited their "why" and reopened the popover
 * inside that window was therefore shown the PREVIOUS sentence back — which is
 * exactly how somebody concludes their edit did not save and types it again.
 *
 * THE OVERRIDE IS BOUNDED BY `foldAtSend`, and that bound is the whole reason
 * this is safe: the record only wins while the fold still reads what it read
 * when we sent. The moment the fold changes — our own echo arriving, or a
 * LATER write from the player's other device — the log is authoritative again
 * and the record is dropped. Without that, a stale local record would shadow
 * another device's newer value for the rest of the session.
 *
 * Only ever the reader's OWN row (`lastSentFor` matches on author), so this
 * cannot show one player anything about another. Chips get the identical
 * treatment for the identical reason: the two values are computed three lines
 * apart in `reasonSectionHTML()` from the same lagging source, and fixing one
 * and not the other is the failure shape this file's suppression comments
 * warn about three times over.
 */
function chipsOnFileFor(mid, self, mine) {
  const fold = reasonChipsOf(mine);
  const sent = lastSentFor(lastSentChips, mid, self);
  if (!sent) return fold;
  if (JSON.stringify(fold) !== sent.foldAtSend) { lastSentChips = null; return fold; }
  // Filtered even coming from our own record: the read boundary is a rule about
  // EVERY reader, not only untrusted ones (scribeFeedback.js's F-2 note).
  return sent.chips.filter(c => SCRIBE_FEEDBACK_REASON_CHIPS.includes(c));
}
function noteOnFileFor(mid, self, mine) {
  const fold = typeof mine?.reason_note === 'string' ? mine.reason_note : '';
  const sent = lastSentFor(lastSentNote, mid, self);
  if (!sent) return fold;
  if (fold !== sent.foldAtSend) { lastSentNote = null; return fold; }
  return sent.text;
}
function scheduleChipWrite(next) {
  // A pending set for a DIFFERENT message/player is a different answer, not an
  // earlier draft of this one — it goes out rather than being replaced.
  if (pendingChipWrite && (pendingChipWrite.mid !== next.mid || pendingChipWrite.author !== next.author)) flushPendingChipWrite();
  pendingChipWrite = next;
  cancelChipWriteTimer();
  chipWriteTimer = setTimeout(() => { chipWriteTimer = null; flushPendingChipWrite(); }, CHIP_WRITE_DEBOUNCE_MS);
}
/** Write an in-flight set NOW. Every dismissal path calls this: a set tapped
 *  399ms before the popover closes must not be lost to the closing. */
function flushPendingChipWrite() {
  cancelChipWriteTimer();
  const p = pendingChipWrite;
  pendingChipWrite = null;
  return p ? sendChips(p) : false;
}
/** Drop an in-flight set for THIS target without writing it — used only where
 *  the very next line supersedes it (R-1's cascade), never to discard a tap. */
function dropPendingChipWrite(mid, author) {
  if (!pendingChipWrite) return;
  if (pendingChipWrite.mid !== mid || pendingChipWrite.author !== author) { flushPendingChipWrite(); return; }
  cancelChipWriteTimer();
  pendingChipWrite = null;
}

function takeFeedbackPickerFlush() { const f = openPickerFlush; openPickerFlush = null; return f; }
function flushFeedbackPickerWork(flushNote) { flushPendingChipWrite(); if (flushNote) flushNote(); }
/** Everything the open popover has typed or tapped but not yet sent. */
function flushOpenFeedbackPicker() { flushFeedbackPickerWork(takeFeedbackPickerFlush()); }
/** …and the opposite: forget it all WITHOUT writing it. Only for F-1's owner
 *  mismatch, where the in-flight work belongs to a player who is no longer the
 *  one at the keyboard. */
function dropFeedbackPickerWork() {
  pendingFeedbackPicker = null;
  openPickerFlush = null;
  cancelChipWriteTimer();
  pendingChipWrite = null;
}

/**
 * R-1 — the chips a given rating can actually SHOW. "Hit" renders the single
 * positive chip; the two miss ratings render the ten miss chips. Filtering on a
 * flip is what stops a selected chip the player can no longer see (and
 * therefore can no longer un-tap) from sitting in the log arguing a correction
 * the rating contradicts. mid ↔ too_much both render the same ten, so this
 * drops nothing there — DI-268's two miss ratings ask the same question.
 */
const chipsForRating = (rating, chips) =>
  chips.filter(c => (SCRIBE_FEEDBACK_CHIP_FAMILY[c] === 'positive') === (rating === 'hit'));

function mountFeedbackPicker({ host, m, self, mid, surface, renderFn, working }) {
  document.getElementById('chat-feedback-picker')?.remove();
  const picker = document.createElement('div');
  picker.className = 'reaction-picker feedback-picker-wrap';
  picker.id = 'chat-feedback-picker';
  picker.dataset.mid = mid;
  picker.innerHTML = feedbackPopoverHTML(m, self, working);
  host.appendChild(picker);

  const myState = () => getFeedbackFor(mid)[self] || {};
  const curRating = () => (working && 'rating' in working ? working.rating : (myState().rating || null));
  // Both fall through to the SAME readers the render uses (R-6), so what the
  // popover shows and what the handlers believe is on file can never disagree.
  const chipsOnFile = () => chipsOnFileFor(mid, self, myState());
  const noteOnFile = () => noteOnFileFor(mid, self, myState());
  const curChips = () => (working && Array.isArray(working.chips) ? working.chips : chipsOnFile());
  const noteEl = picker.querySelector('[data-fb-note]');
  // The LIVE input wins when it exists — a chip tapped after typing must not
  // write the note back to its pre-typing value when it re-renders the row.
  const curNote = () => (noteEl ? String(noteEl.value ?? '').slice(0, 280)
    : (working && typeof working.note === 'string' ? working.note : noteOnFile()));
  const snapshot = over => ({ rating: curRating(), chips: curChips(), note: curNote(), ...over });

  // F-1 (2026-09-23) — THE MARKER CARRIES ITS OWNER. It holds chips and a note
  // typed by the player who armed it, and `remountOpenFeedbackPicker()` puts
  // that state back into a live popover whose writes go out under whoever
  // `me()` is at the time. On a same-device account switch that does not
  // repaint on its way through, the next player's first repaint would have
  // re-mounted the previous player's in-flight text and written it under the
  // new id. The re-mount now refuses a marker it does not own.
  const arm = next => (pendingFeedbackPicker = { mid, surface, author: self, working: next });
  // F-3 — closing flushes an in-flight chip set (a tap 399ms before the
  // dismissal is still a tap), and releases the out-of-closure flush hook so a
  // later dismissal path cannot fire a stale one. Disarm BEFORE the write, for
  // the reason the outside-click closer documents at length.
  const close = () => { pendingFeedbackPicker = null; openPickerFlush = null; picker.remove(); flushPendingChipWrite(); };
  arm(working);

  // The ONE place a note goes on the wire, so `lastSentNote` can never disagree
  // with what was actually written (sendChips' twin, same `foldAtSend` rule).
  const sendNote = text => {
    const foldAtSend = typeof myState().reason_note === 'string' ? myState().reason_note : '';
    const ok = typeof recordFeedback({ targetId: mid, category: 'reason_note', value: text, author: self }) === 'string';
    if (ok) lastSentNote = { mid, author: self, text, foldAtSend };
    return ok;
  };
  /** Bring the RECORDED chip set into line with `next`, writing only when the
   *  log would actually change — set-not-diff means one row is the whole
   *  answer, and a row that says what the last row already said is noise. */
  const syncChips = next => {
    dropPendingChipWrite(mid, self);
    if (JSON.stringify(chipsOnFile()) !== JSON.stringify(next)) sendChips({ mid, author: self, chips: next });
  };

  /**
   * Write, then make sure exactly one repaint happens and the popover survives
   * it. `token` identity is how we tell "nobody repainted us" from "a repaint
   * already consumed the marker and re-mounted us" — after the latter, the
   * marker is a DIFFERENT object (the re-mount re-armed it), so calling
   * renderFn() again would repaint with no marker and close the popover.
   */
  const writeAndStayOpen = (next, write) => {
    const token = arm(next);
    if (!write()) { close(); renderFn(); return; }
    if (pendingFeedbackPicker === token) renderFn();
  };

  picker.querySelectorAll('[data-fb-rating]').forEach(opt => opt.addEventListener('click', ev => {
    ev.stopPropagation();
    // Re-tapping the CURRENTLY selected rating clears it back to untouched
    // (same toggle-off semantics toggleReact() already has) — an EXPLICIT
    // clear event (value: null), not silence, so the clear itself round-trips
    // through the record the same way the rating did.
    const value = curRating() === opt.dataset.fbRating ? null : opt.dataset.fbRating;
    if (!value || feedbackExtrasSuppressed(m)) {
      // A cleared rating has nothing to explain, and a suppressed post takes no
      // chips at all — both close on the tap, exactly as this control always has.
      //
      // R-1 (2026-09-23) — AND A CLEAR CASCADES. The rating is what REVEALS the
      // chips and the note, so `reason:['too_mean']` sitting under no rating at
      // all is an orphan: no screen can show it, no tap can clear it, and
      // Package C's Trainer would still read it as a live complaint about a
      // line the player took their objection back on. The retraction goes out
      // as explicit events in the order the state collapses — rating, chips,
      // note — and each one only if there is something on file to retract.
      const clearing = !value;
      if (clearing) dropPendingChipWrite(mid, self);   // an in-flight set the empty set is about to supersede
      close();
      recordFeedback({ targetId: mid, category: 'rating', value, author: self });
      if (clearing) {
        if (chipsOnFile().length) sendChips({ mid, author: self, chips: [] });
        if (noteOnFile()) sendNote('');
      }
      renderFn();
      return;
    }
    // R-1 — FLIPPING a rating keeps only the chips the new rating can show (see
    // chipsForRating). Written inside the same tap so the log never holds a
    // combination the popover cannot render back.
    const keep = chipsForRating(value, curChips());
    writeAndStayOpen(snapshot({ rating: value, chips: keep }), () => {
      const ok = typeof recordFeedback({ targetId: mid, category: 'rating', value, author: self }) === 'string';
      if (ok) syncChips(keep);
      return ok;
    });
  }));

  // DI-268 — a chip toggles in/out of the CURRENT set. No Save button: the
  // design input's floor is one extra tap, and a confirm step would make it two
  // for every chip.
  //
  // F-3(a) (2026-09-23) — THE TAP NO LONGER WRITES; it arms the trailing
  // debounce above, so a burst of taps becomes ONE full-set row. What the
  // player sees is unchanged: `working` is the popover's in-flight truth and it
  // is armed before the repaint, exactly as it was when the write was
  // immediate. Every dismissal path flushes, so the set cannot be lost.
  picker.querySelectorAll('[data-fb-chip]').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation();
    const chip = btn.dataset.fbChip;
    const cur = curChips();
    const next = cur.includes(chip) ? cur.filter(c => c !== chip) : [...cur, chip];
    const token = arm(snapshot({ chips: next }));
    scheduleChipWrite({ mid, author: self, chips: next });
    // Same token check writeAndStayOpen() makes, for the same reason:
    // scheduleChipWrite() can flush an older set for another target, and that
    // write repaints — after which the marker is a different object and this
    // popover has already been re-mounted in its new state.
    if (pendingFeedbackPicker === token) renderFn();
  }));

  // DI-269 — the optional "why". Written on Enter, on blur-with-a-change, and
  // on dismissal (the closer below), never on every keystroke: each write is an
  // event in an append-only log, and a per-character log is how a season's
  // worth of chat rows becomes a season's worth of typing.
  //
  // F-3(b) (2026-09-23) — COMPARED AGAINST THE LAST TEXT THIS DEVICE SENT, not
  // against the fold. A local write is stamped {ts:0, seq:0} until the server
  // echoes it and applyTo() drops a second write to the same
  // (author,'reason_note') key, so immediately after an edit the fold still
  // reads the PREVIOUS note — which made Enter-then-blur on unchanged text look
  // like a change and write the same sentence twice, one row each.
  const noteChanged = () => !!noteEl && curNote() !== noteOnFile();
  const writeNote = () => sendNote(curNote());
  if (noteEl) {
    // Text typed but not yet written still has to survive a repaint caused by
    // somebody ELSE's message landing mid-sentence, so it rides the marker.
    noteEl.addEventListener('input', () => { if (pendingFeedbackPicker) pendingFeedbackPicker.working = snapshot(); });
    noteEl.addEventListener('change', () => { if (noteChanged()) writeAndStayOpen(snapshot(), writeNote); });
    noteEl.addEventListener('keydown', kev => {
      if (kev.key !== 'Enter') return;
      kev.stopPropagation();
      if (noteChanged()) writeAndStayOpen(snapshot(), writeNote);
    });
  }
  // R-4 — the dismissal paths that live OUTSIDE this closure (re-tapping the ⭐
  // in toggleFeedbackPicker, and the reaction picker evicting this popover in
  // toggleMessageReactPicker) need a way to write what is in flight. They take
  // this, and taking it clears it, so it can only ever fire for the live mount.
  openPickerFlush = () => { if (noteChanged()) writeNote(); };

  picker.querySelector('[data-fb-rewrite]')?.addEventListener('click', ev => {
    ev.stopPropagation();
    // R-5 (2026-09-23) — A MODAL TAKING OVER IS A DISMISSAL TOO. close() already
    // flushes the in-flight chip set; the note has to be said explicitly, and it
    // is said AFTER close() so the disarmed marker cannot re-mount the popover
    // this tap is replacing (the detached input still holds the text — the node
    // is removed, not destroyed, so reading .value here is correct). "Type a
    // why, then decide to write the line properly" is the most likely next tap
    // a player mid-complaint makes, and it used to drop the sentence.
    close();
    if (noteChanged()) writeNote();
    const mineNow = getFeedbackFor(mid)[self] || {};
    openFeedbackTextModal({
      targetId: mid, category: 'rewrite', renderFn,
      title: 'What should SCRIBE have said?',
      placeholder: 'Write the line. Even a rough half-sentence helps.',
      submitLabel: 'Save rewrite', requireText: true,
      prefill: typeof mineNow.rewrite === 'string' ? mineNow.rewrite : '',
    });
  });
  picker.querySelector('[data-fb-remember]')?.addEventListener('click', ev => {
    ev.stopPropagation();
    const mineNow = getFeedbackFor(mid)[self] || {};
    // Toggle-style boolean presence — same idiom as a reaction: instant,
    // reversible, no toast (E1 copy strings: "Rating success: no toast").
    //
    // CLOSED BEFORE THE WRITE, not after: the write repaints the room, and a
    // still-armed marker would have the repaint re-mount the popover this tap
    // is dismissing. The human-message popover has no second state to reveal.
    close();
    recordFeedback({ targetId: mid, category: 'remember_this', value: !mineNow.remember_this, author: self });
    renderFn();
  });
  picker.querySelector('[data-fb-weighin]')?.addEventListener('click', ev => {
    ev.stopPropagation();
    close();
    const mineNow = getFeedbackFor(mid)[self] || {};
    // Part 0b correction #7 (binding) — "Weigh in" ALWAYS routes through the
    // rewrite modal with an OPTIONAL text field, rather than an instant
    // boolean tap: "a bare flag drops the highest-value data the briefing
    // names." Submitting with text stores that text as the value; submitting
    // blank stores the boolean flag `true` — one category, one record,
    // either shape (see openFeedbackTextModal()'s submit handler).
    openFeedbackTextModal({
      targetId: mid, category: 'weigh_in', renderFn,
      title: 'What should SCRIBE have said here?',
      placeholder: 'Optional — what should SCRIBE have said?',
      submitLabel: 'Save', requireText: false,
      prefill: typeof mineNow.weigh_in === 'string' ? mineNow.weigh_in : '',
      // Non-blocking finding #5 — weigh_in could never be cleared once set: a
      // blank resubmit stores the bare `true` flag (correction #7's own
      // fallback), not a clear, so a mis-tap was permanent. `hasExisting` is
      // computed from the truthy VALUE (covers both the string-rewrite shape
      // and the bare-boolean-flag shape), not from `prefill` alone — prefill
      // is '' for the bare-flag case, which would otherwise hide Remove
      // exactly when it's most needed (an accidental bare tap).
      allowRemove: !!mineNow.weigh_in,
    });
  });

  setTimeout(() => {
    const closer = ev => {
      // A repaint already replaced this node with a fresh mount (which bound
      // its own closer) — this one has nothing left to close.
      if (document.getElementById('chat-feedback-picker') !== picker) {
        document.removeEventListener('click', closer);
        return;
      }
      if (!picker.contains(ev.target) && !ev.target.closest?.('[data-fb-open]')) {
        // DISARM FIRST. Flushing below is a write, and a write repaints — an
        // armed marker would re-mount the popover being closed.
        pendingFeedbackPicker = null;
        openPickerFlush = null;
        // F-3 — the chip set first (an in-flight set is older than anything
        // typed after it, and the log should read in the order it happened),
        // then the note.
        flushPendingChipWrite();
        if (noteChanged()) writeNote();
        picker.remove();
        document.removeEventListener('click', closer);
      }
    };
    document.addEventListener('click', closer);
  }, 0);
}

/**
 * Put back a popover a repaint took away (DI-268 — see mountFeedbackPicker's
 * block comment for why one exists to put back).
 *
 * Called from `bindMessageActionButtons()`, i.e. once per surface per repaint,
 * with that surface's own triggers and render function — which is what keeps
 * the main feed and the game sheet from stealing each other's open popover
 * when both are on screen. It takes the trigger LIST the binder already
 * collected rather than re-querying: one selector, one place.
 *
 * A marker whose message this surface does not render is LEFT ALONE rather than
 * cleared: the sheet re-binds after the main feed on the same repaint, and
 * clearing here would mean whichever surface bound first destroyed the other's
 * popover. Every dismissal path clears it explicitly; this function only ever
 * consumes a marker it can actually satisfy.
 *
 * F-1 (2026-09-23) — EXCEPT WHEN THE MARKER IS NOT THIS PLAYER'S. The marker
 * carries in-flight chips and note text typed by whoever armed it, and the
 * popover it re-mounts writes under `me()` AT THE TIME OF THE TAP. A same-device
 * account switch that does not repaint on its way through (a PIN sheet, a
 * handover) therefore had one repaint's worth of window in which the next
 * player could re-mount the previous player's unsent words and put them in the
 * append-only log under their own id. Checked BEFORE the surface test, not
 * after: a marker owned by somebody else is invalid on EVERY surface, so there
 * is nothing to leave behind for the other surface's bind to pick up. The
 * in-flight work is DROPPED rather than flushed — the player who typed it is
 * gone from this device, and a handover deliberately discards unsent work
 * (chat.js's own outbox handover does the same).
 */
function remountOpenFeedbackPicker(triggers, renderFn, surface) {
  const pending = pendingFeedbackPicker;
  if (!pending) return;
  const self = me();
  if (!self || pending.author !== self) { dropFeedbackPickerWork(); return; }
  if (pending.surface !== surface) return;
  const m = getMessage(pending.mid); if (!m) { pendingFeedbackPicker = null; return; }
  const candidates = (triggers || []).filter(b => b.dataset?.fbOpen === pending.mid);
  if (!candidates.length) return;
  // Prefer the ALWAYS-VISIBLE persistent ⭐ row: `.chat-actions` is revealed by
  // long-press and a fresh repaint has no reveal state, so hosting there would
  // put the popover inside a hidden row.
  const anchor = candidates.find(b => String(b.className || '').includes('chat-fb-star')) || candidates[0];
  const row = anchor.closest?.('.chat-actions, .chat-reactions') || anchor;
  mountFeedbackPicker({ host: row, m, self, mid: pending.mid, surface, renderFn, working: pending.working });
}
// Test-only seam. The re-mount itself is exercised through the REAL binder
// (`_bindMessageActionButtons`) rather than a seam of its own — WHERE the
// popover comes back and WHO puts it there is the whole property, and a direct
// call would prove neither. This exposes only the marker, so a suite can assert
// that a dismissal really disarmed it (a stale marker is the one failure mode
// that resurrects a popover nobody opened).
export function _openFeedbackPickerStateForTest() { return pendingFeedbackPicker; }
// Test-only seam (same convention as `_persistentStarHTMLForTest` /
// `_feedbackPopoverHTMLForTest` / `_revealMessageActions`). Reviewer BLOCK
// finding #1/#2, 2026-09-10: WHERE the popover lands in the DOM is the whole
// defect, and that is only observable by running the function against a real
// element tree — a source scan can pin the selector string but cannot prove
// the popover ends up a SIBLING of the ⭐ rather than a child of it.
// NB: this line deliberately references the function WITHOUT a trailing `(`
// so feedbacktest [28](f)'s "exactly two `toggleFeedbackPicker(` code lines"
// one-code-path assertion still counts definition + single call site only.
export const _toggleFeedbackPickerForTest = toggleFeedbackPicker;

/**
 * ✏️ Rewrite (SCRIBE messages) and 👁 Weigh in (human messages, correction
 * #7) share this ONE modal — reuses `.modal-overlay.centered .modal`
 * VERBATIM (the game modal / edit-player modal / reset-PIN modal precedent,
 * `js/app.js`), not a new modal component. `requireText` is the only real
 * difference: Rewrite requires non-empty text (Submit disabled until
 * non-empty); Weigh-in's text is optional (Submit always enabled — a bare
 * flag is still a valid, if lower-value, submission).
 */
function openFeedbackTextModal({ targetId, category, title, placeholder, submitLabel, requireText, prefill = '', allowRemove = false, renderFn = renderChatPage }) {
  const self = me(); if (!self) return;
  document.getElementById('feedback-text-modal')?.remove();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay centered';
  ov.id = 'feedback-text-modal';
  ov.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>${esc(title)}</h3><button class="modal-close" id="fb-modal-close">✕</button></div>
    <div class="form-group">
      <textarea class="form-textarea" id="fb-modal-text" maxlength="1000" rows="4" placeholder="${esc(placeholder)}">${esc(prefill)}</textarea>
      <span class="chat-char-count" id="fb-modal-count" style="display:none"></span>
    </div>
    <button class="btn btn-primary btn-block" id="fb-modal-submit"${requireText ? ' disabled' : ''}>${esc(submitLabel)}</button>
    ${allowRemove ? `<button class="btn btn-ghost btn-block" id="fb-modal-remove">Remove</button>` : ''}
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('#fb-modal-close')?.addEventListener('click', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  const textEl = ov.querySelector('#fb-modal-text');
  const countEl = ov.querySelector('#fb-modal-count');
  const submitBtn = ov.querySelector('#fb-modal-submit');
  const sync = () => {
    // Same near-limit threshold/format as the composer's own #chat-count
    // (E1's explicit reuse requirement — not a second counter convention).
    const len = textEl.value.length;
    if (countEl) { countEl.style.display = len >= 900 ? 'inline' : 'none'; countEl.textContent = `${len}/1000`; }
    if (requireText && submitBtn) submitBtn.disabled = !textEl.value.trim();
  };
  textEl?.addEventListener('input', sync);
  sync();
  // Non-blocking finding #5 — an explicit clear (value: null), the same
  // "explicit clear event, not silence" shape E1 already uses for re-tapping
  // a selected rating (chat.js's applyTo() 'feedback' branch treats `null` as
  // a real, replace-worthy value — never a no-op).
  ov.querySelector('#fb-modal-remove')?.addEventListener('click', () => {
    recordFeedback({ targetId, category, value: null, author: self });
    close();
    renderFn();
  });
  submitBtn?.addEventListener('click', () => {
    const text = (textEl.value || '').trim();
    if (requireText && !text) return;
    // weigh_in: text if supplied, else the boolean flag — see correction #7's
    // note above. rewrite: always text (requireText guarantees non-empty).
    recordFeedback({ targetId, category, value: text || true, author: self });
    close();
    // Reviewer BLOCK finding #1: _toastWouldSuppress() suppresses on BOTH the
    // chat page AND the dashboard — i.e. every page a rewrite can actually be
    // submitted from (the modal only opens from a message rendered in chat).
    // Without `force:true` this toast was unconditionally a silent no-op.
    // `force` bypasses that suppression exactly like the pick-reveal system
    // announcement already does (line ~2326, `showToast({author:'system',
    // body:...}, {force:true})`) — and this MUST follow the same
    // message-shaped-object precedent, not a bare string: drainToast() reads
    // `msg.author`/`msg.body` and pipes `msg.author` through initialsOf(),
    // which does `nameOf(id).slice(0,2)` for any non-scribe/system author —
    // a bare string has no `.author`, so `nameOf(undefined)` returns
    // `undefined` and `.slice()` on it throws. `author:'system'` is the exact
    // short-circuit initialsOf()/nameOf() already have for this case (⚙ /
    // "League"), so this renders safely, not just "doesn't crash."
    //
    // N1 follow-up (c), 2026-09-12 — RESOLVED, the other way round. The note
    // that used to sit here flagged this toast as the one RECEIPT among
    // chat-ui's notices and left it literal pending a ruling. The ruling:
    // receipts are not notifications, so they do not belong on the gated
    // notification toast at all. This now goes to the app-level toast every
    // other "saved" confirmation in the app uses — see showReceipt() above for
    // why that is the right layer rather than a bypass flag in showToast().
    // The whole {force:true} / message-shaped-object dance goes with it: the
    // app toast takes a plain string, so there is no initialsOf()/nameOf()
    // hazard to guard against here any more.
    if (category === 'rewrite') showReceipt('Rewrite saved.');
    renderFn();
  });
}

/**
 * FEAT-3 / DI-200f — "It can include a button to route to the full what's new
 * description of the version update." (Drew.) Rendered on the release post only.
 *
 * The label is VISIBLE TEXT and the aria-label mirrors it with the version. No
 * `title` carrying meaning: tooltips do not fire on touch, which is the only
 * input this app has. Tap target is raised to 44px by a scoped override in
 * styles.css (the #notif-priming-btn precedent), not by touching .btn-sm, whose
 * 34px base is shared by every compact row in the app.
 *
 * Destination is Rules → Release notes, not the Picks card (coordinator Q1):
 * the Picks card shows only the current release, and a player tapping this three
 * weeks later wants the release the post is about.
 */
function whatsNewLinkHTML(m) {
  if (m.meta?.kind !== 'whatsNew') return '';
  const v = String(m.meta?.version || '');
  return `<div class="chat-whatsnew-row"><button class="btn btn-ghost btn-sm chat-whatsnew-link" data-whatsnew="${esc(v)}" aria-label="${esc(`See everything that changed in ${v}`)}">📋 See everything that changed</button></div>`;
}

// ── FEAT-5 (UN-202 / DI-202a, DI-202f) — wager memory, chat surface ─────────
/**
 * 🤝 on the per-message action row, between 📎 (callout) and 🏛 (pin) — among
 * the "do something durable with this message" controls rather than among
 * reply/react.
 *
 * ANYONE SIGNED IN MAY TAP IT (coordinator ruling Q9), including the person
 * taking the other side: Drew's own worked example is Brayden making the claim
 * and SOMEBODY ELSE deciding it should be held against him. That is also why a
 * `/bet` prefix and an `@scribe remember this` command were both rejected —
 * neither can express a bet recognised after the fact by a third party.
 *
 * ABSENT ENTIRELY (not hidden) on a SCRIBE/system/deleted message, on anything
 * that is not a plain message, and for a signed-out reader — who gets no dead
 * control, the persistentStarHTML precedent.
 *
 * No `title` attribute: tooltips do not fire on touch, which is the only input
 * this app has. The emoji IS the label; aria-label carries the meaning.
 */
function wagerActionHTML(m, self) {
  if (!self) return '';
  if (m.type !== 'message' || m.deleted) return '';
  if (m.author === 'system' || m.author === 'scribe') return '';
  return `<button class="chat-act" data-wager="${esc(m.id)}" aria-label="Log this as a wager">🤝</button>`;
}
export const _wagerActionHTMLForTest = wagerActionHTML;

/**
 * The accept/decline controls on SCRIBE's wager acknowledgment post
 * (`meta.kind === 'wagerLogged'`), per DI-202f's viewer table. Exact copy.
 *
 * The ANSWER STATE lives in app.js's `scribeMemoryCache.wagers`, which this
 * module cannot import (app.js imports chat-ui.js; the reverse would be a
 * cycle), so it comes over the same `window.*` bridge window.deepLinkTo and
 * window.showToast already establish. An ABSENT bridge reads as "no answer
 * yet" — the honest default: the buttons render, and a second tap upserts the
 * identical row on the server rather than creating a second one.
 *
 * ONE ACTION, ONE MESSAGE: answering posts nothing to the room. It writes the
 * counterparty's OWN `wagerack:` row and replaces these buttons in place.
 *
 * TWO DELIBERATE READINGS of DI-202f's table, both stated rather than assumed:
 *   - The PROPOSER never gets buttons, even on a wager left open to the room.
 *     Row 2 of the table ("anyone signed in, when counterpartyId is empty")
 *     and row 4 ("the proposer, on his own wager — no buttons") overlap there;
 *     the more specific rule wins, because a man cannot take his own bet.
 *   - Once an answer EXISTS, a viewer who is not the answerer gets NO line at
 *     all rather than the stale "Waiting on …". The table does not cover that
 *     state; the alternative was inventing copy or leaving a small lie on
 *     screen. The status is stated, in full, by the callback post at the due
 *     week — which is what UN-203 actually asks for.
 */
function wagerAckHTML(m, self) {
  if (m.meta?.kind !== 'wagerLogged' || m.deleted) return '';
  if (!self) return '';                                  // signed out: no dead control, no waiting line
  const wagerId = String(m.meta?.wagerId || '');
  if (!wagerId) return '';
  const proposerId = String(m.meta?.proposerId || '');
  const counterpartyId = String(m.meta?.counterpartyId || '');
  const state = (typeof window !== 'undefined' && typeof window.scribeWagerAnswer === 'function')
    ? (window.scribeWagerAnswer(wagerId) || null) : null;
  const answeredBy = String(state?.playerId || '');
  const reply = String(state?.reply || '');
  const note = txt => `<div class="chat-wager-row"><span class="text-muted text-xs chat-wager-note">${esc(txt)}</span></div>`;

  if (answeredBy && answeredBy === self) return note(reply === 'declined' ? 'You passed.' : "You're in.");
  if (answeredBy) return '';                             // someone else answered — the callback states it
  if (self === proposerId) {
    return note(counterpartyId ? `Waiting on ${nameOf(counterpartyId)}.` : 'Open to the room.');
  }
  if (counterpartyId && counterpartyId !== self) return note(`Waiting on ${nameOf(counterpartyId)}.`);
  // The named counterparty with no answer yet, or anyone signed in on a wager
  // left open to the room.
  return `<div class="chat-wager-row">
    <button class="btn btn-ghost btn-sm chat-wager-ack" data-wager-ack="accepted" data-wager-id="${esc(wagerId)}" aria-label="Take this wager">🤝 I'm in</button>
    <button class="btn btn-ghost btn-sm chat-wager-ack" data-wager-ack="declined" data-wager-id="${esc(wagerId)}" aria-label="Pass on this wager">🙅 I'm not</button>
  </div>`;
}
export const _wagerAckHTMLForTest = wagerAckHTML;

/**
 * Drew's residual 3, verbatim: "should have a special label or opacity
 * indicating it is private."
 *
 * The push self-test row (js/chat.js's `isPrivateSelfTest()`) is the only row
 * in the Locker Room that ONE person can see. It looks like ordinary traffic
 * to the commissioner reading it, and the sentence it carries reads like an
 * announcement — so without this it is perfectly reasonable to think the whole
 * league just got a "this is a test push" message from nowhere.
 *
 * BOTH halves, deliberately: the CHIP is the fact, at full contrast, and the
 * dim is the at-a-glance signal. The dim is on the bubble alone and is the
 * .chat-quote-static value already shipped in this file's stylesheet (.85),
 * chosen because it stays comfortably above 4.5:1 in all seven themes — a
 * treatment that makes the explanation itself hard to read would be the wrong
 * trade. Themed vars only; no colour of its own.
 */
function privateRowChipHTML(m) {
  return isPrivateSelfTest(m) ? '<span class="chat-private-chip">🔒 Only you can see this</span>' : '';
}
export const _privateRowChipHTMLForTest = privateRowChipHTML;

function messageHTML(m, self, showNewDivider) {
  if (m.type === 'system') {
    const reveal = m.meta?.kind === 'reveal';
    // Build 2, Group C — the scribeAskAck placeholder (C-5). Same RG-09
    // pending visual language as an outbound message's 🕐 (no new vocabulary),
    // full-opacity text (this is a real, already-broadcast event, not a
    // client-side optimistic guess).
    const scribeAck = m.meta?.kind === 'scribeAsk';
    return `${showNewDivider ? '<div class="chat-new-divider"><span>NEW</span></div>' : ''}
      <div class="chat-msg chat-system${reveal ? ' chat-reveal' : ''}${scribeAck ? ' chat-scribe-ack' : ''}" data-mid="${esc(m.id)}">
        <div class="chat-system-body">${reveal ? `<div class="chat-reveal-title">🔓 ${esc(m.meta?.title || 'Picks are in')}</div>` : ''}${scribeAck ? '🕐 ' : ''}${bodyHTML(m).replace(/\n/g, '<br>')}</div>
        <span class="chat-time">${relTime(m.ts)}</span>
      </div>`;
  }
  if (m.type === 'gamereact') return '';   // rendered via coalescing pass

  const mine = m.author === self;
  const scribe = m.author === 'scribe';
  const failed = isFailed(m.id);
  const pending = isPending(m.id);
  const canEdit = mine && !m.deleted && Date.now() - (m.ts || 0) < EDIT_WINDOW_MS;
  const accent = accentOf(m.author);
  const privateChip = privateRowChipHTML(m);

  return `${showNewDivider ? '<div class="chat-new-divider"><span>NEW</span></div>' : ''}
  <div class="chat-msg${mine ? ' chat-mine' : ''}${scribe ? ' chat-scribe' : ''}${privateChip ? ' chat-msg-private' : ''}${pending ? ' is-pending' : ''}${failed ? ' is-failed' : ''}" data-mid="${esc(m.id)}">
    <div class="chat-avatar${scribe ? ' chat-avatar-scribe' : ''}${mine ? ' chat-avatar-mine' : ''}" ${accent ? `style="background:${esc(accent)};color:#fff"` : ''}>${esc(initialsOf(m.author))}</div>
    <div class="chat-bubble-col">
      <div class="chat-meta">
        <span class="chat-author">${esc(nameOf(m.author))}</span>
        ${privateChip}
        ${pickChip(m.author, m.gameTag)}
        ${tagChipHTML(m)}
        <span class="chat-time">${relTime(m.ts)}</span>
        ${m.edited ? '<span class="chat-edited">edited</span>' : ''}
        ${m.pinned ? '<span class="chat-pinned">📌</span>' : ''}
        ${pending ? '<span class="chat-pending">🕐</span>' : ''}
        ${failed ? `<span class="chat-failed">FAILED</span><button class="chat-retry" data-retry="${esc(m.id)}">retry</button>` : ''}
      </div>
      ${quoteHTML(m)}
      <div class="chat-bubble">${m.deleted ? '<span class="chat-tombstone">🪦 message withdrawn</span>' : bodyHTML(m).replace(/\n/g, '<br>')}</div>
      ${reactionsHTML(m, self, persistentStarHTML(m, self))}
      ${m.deleted ? '' : whatsNewLinkHTML(m)}
      ${m.deleted ? '' : wagerAckHTML(m, self)}
      ${m.deleted ? '' : `<div class="chat-actions">
        ${isScribeFeedbackEnabled() ? feedbackButtonHTML(m, self) : ''}
        <button class="chat-act chat-act-react" data-react-open="${esc(m.id)}" title="React">➕</button>
        <button class="chat-act" data-reply="${esc(m.id)}" title="Reply">↩</button>
        ${calloutEligible(m) ? `<button class="chat-act" data-callout="${esc(m.id)}" title="Quote this next to the result">📎</button>` : ''}
        ${wagerActionHTML(m, self)}
        <button class="chat-act" data-pin="${esc(m.id)}" title="${m.pinned ? 'Unpin from' : 'Pin to'} the Hall of Records">${m.pinned ? '📌' : '🏛'}</button>
        ${canEdit ? `<button class="chat-act" data-edit="${esc(m.id)}" title="Edit (5 min)">✏️</button>` : ''}
        ${mine ? `<button class="chat-act" data-del="${esc(m.id)}" title="Withdraw">🗑</button>` : ''}
      </div>`}
    </div>
  </div>`;
}

/**
 * Test-only seam (same convention as `_reactionsHTML` / `_showToastForTest`).
 *
 * WHY THIS EXPORT EXISTS: `pickChip()` — the ⚡ chip beside every chat author's
 * name — is module-private and reachable only from here. It carries the BLIND
 * RULE for the surface the six players read most: every message in the room
 * would otherwise advertise its author's selection while the week is still
 * open and editable. Verified 2026-08-12 (reviewer BLOCK): deleting pickChip's
 * `arePicksPublic()` guard left the whole suite green at 670/670, because
 * nothing in the harness rendered a message at all. Exercising the REAL
 * `messageHTML()` — rather than pickChip in isolation or a regex over this
 * file — is what makes that mutation go red, and it also covers the wiring
 * (a chip that stopped being called would be just as invisible a leak).
 */
export const _messageHTMLForTest = messageHTML;

/** Ambient coalescing: consecutive gamereacts by one author within 5 min render
 *  as a single attributed line (attribution is the whole point in a 6-man room). */
function coalesceStream(list) {
  const out = [];
  let run = null;
  const flush = () => { if (run) { out.push(run); run = null; } };
  for (const m of list) {
    if (m.type === 'gamereact') {
      if (run && run.author === m.author && (m.ts - run.lastTs) < 5 * 60000) {
        run.items.push(m); run.lastTs = m.ts;
      } else {
        flush();
        run = { kind: 'gamereact-run', author: m.author, ts: m.ts, lastTs: m.ts, items: [m] };
      }
    } else { flush(); out.push(m); }
  }
  flush();
  return out;
}

function gamereactRunHTML(run) {
  const parts = run.items.map(m => {
    const found = gameById(m.gameTag);
    return `${esc(m.meta?.emoji || '👀')} ${found ? esc(gameShort(found.game, found.week)) : ''}`;
  }).join(' · ');
  return `<div class="chat-msg chat-system chat-gamereact" data-ts="${esc(run.ts)}">
    <div class="chat-system-body">${esc(nameOf(run.author))} reacted &nbsp;${parts}</div>
    <span class="chat-time">${relTime(run.ts)}</span>
  </div>`;
}

// ── UN-110 (batch 4): composer-height measurement only ───────────────────────
/**
 * REVERSES UN-104's header-offset half of this mechanism. `.app-header` is
 * now `display:none` on the chat tab entirely (`body[data-tab="chat"]
 * .app-header`, styles.css) — measuring it would return a height of 0 and
 * publish a permanently-stale `--chat-sticky-top`. That variable and the
 * calc()-based `.chat-scroll` max-height that read it are BOTH gone; the
 * header row + pills + view header now dock as an ordinary `flex:0 0 auto`
 * item at the top of `#page-chat.active`'s real flex column (styles.css) —
 * flex order does the stacking, no offset math needed at all.
 *
 * The composer's own height is still measured — a DIFFERENT, un-asked-for-
 * but-foreseeable reason survives from UN-104's handoff: "jump to latest"
 * (`.chat-jump-latest`, styles.css) clears the composer using this same
 * measured height.
 */
let _chatComposerRO = null;
export function _syncChatStickyMetrics() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root?.style?.setProperty) return;
  const composer = document.querySelector('#page-chat .chat-composer');
  if (composer?.getBoundingClientRect) {
    const h = Math.ceil(composer.getBoundingClientRect().height);
    if (h > 0) root.style.setProperty('--chat-composer-h', `${h}px`);
  }
}
function watchChatStickyMetrics() {
  _syncChatStickyMetrics();
  if (typeof window === 'undefined' || typeof ResizeObserver !== 'function') return;
  // .chat-composer is re-created on every renderChatPage() — reattach each time.
  _chatComposerRO?.disconnect();
  const composer = document.querySelector('#page-chat .chat-composer');
  if (composer) { _chatComposerRO = new ResizeObserver(() => _syncChatStickyMetrics()); _chatComposerRO.observe(composer); }
  if (!window._chatStickyResizeWired) {
    window._chatStickyResizeWired = true;
    window.addEventListener('resize', _syncChatStickyMetrics);
    window.addEventListener('orientationchange', _syncChatStickyMetrics);
  }
}

// ── Main chat page ────────────────────────────────────────────────────────────
export function renderChatPage() {
  const c = document.getElementById('page-chat'); if (!c) return;
  // Item A — chat OFF hides this surface entirely. Guard here (not just at
  // the nav level) so ANY caller of renderChatPage() — navigateTo(), a stray
  // onChat re-render, resumeChatAfterLogin() — bounces rather than rendering
  // a page whose polling has already been stopped.
  if (!isChatEnabled()) { redirectChatDisabled(); return; }
  // RG-26 — a toast raised on another tab survives navigation; the room is now
  // on screen, so it is redundant ("you can already see the chat feed", Drew).
  // AFTER the disabled-bounce above: a redirect away from chat must never
  // swallow a notification the player has not actually seen.
  _clearToastsForChatPage();
  _abbrMemo.clear();                                 // per-pass cache only (see abbrMapFor)
  const self = me();
  const st = chatStatus();
  setViewOpen(true);

  // respectRetention: true — the rendered stream honors the commissioner's
  // window (UN-88). Harmless to pass on the 'records' filter too: pinned
  // messages are exempt from retention by construction (isHiddenByRetention),
  // so Hall of Records is unaffected either way — passing it everywhere keeps
  // the intent uniform instead of relying on that exemption silently.
  let list;
  if (U.filter === 'records') list = getMessages({ tag: 'all', pinned: true, respectRetention: true });
  else if (U.filter === 'mentions') {
    // v0.17.1 — mention inbox removed. If a device has stale state pointing at
    // 'mentions', treat it as 'all' and fix the filter forward.
    U.filter = 'all';
    list = getMessages({ tag: 'all', respectRetention: true });
  }
  else if (U.filter === 'all') list = getMessages({ tag: 'all', respectRetention: true });
  else list = getMessages({ tag: U.filter, respectRetention: true });
  list = filterSupersededScribeAcks(list);

  const showSys = getNotifPrefs().systemEvents;
  if (!showSys) list = list.filter(m => m.type !== 'system');

  const ls = getLastSeen();
  const boundary = U.filter === 'all' ? ls.seq : (ls.byTag[U.filter] ?? ls.seq);
  let dividerPlaced = false;

  const stream = coalesceStream(list);
  let lastDay = '';
  let msgsHTML = '';
  for (const item of stream) {
    const ts = item.ts || Date.now();
    const day = new Date(ts).toDateString();
    if (day !== lastDay) { msgsHTML += `<div class="chat-day-sep">${esc(day)}</div>`; lastDay = day; }
    if (item.kind === 'gamereact-run') { msgsHTML += gamereactRunHTML(item); continue; }
    const isNew = !dividerPlaced && self && item.type === 'message' && item.notify &&
                  typeof item.seq === 'number' && item.seq > boundary && item.author !== self;
    if (isNew) dividerPlaced = true;
    msgsHTML += messageHTML(item, self, isNew);
  }
  if (!stream.length) {
    msgsHTML = `<div class="chat-empty">${U.filter === 'records'
      ? 'The Hall of Records awaits its first entry. Pin a message with 🏛.'
      : 'The Locker Room is open. SCRIBE is on duty.'}</div>`;
  }

  // Header context for game views — item F: mirrors the dashboard's static
  // covering/trailing/won/lost colors for the CURRENT viewer's own pick
  // (blind-rule-safe: your own pick is always visible to you).
  let viewHeader = '';
  if (!['all', 'records'].includes(U.filter)) {
    const found = gameById(U.filter);
    if (found) {
      const g = found.game;
      const score = g.homeScore != null ? `${esc(g.awayScore)}–${esc(g.homeScore)}` : '';
      const myViewPick = self ? getPicks(found.week.weekId, self).find(p => p.gameId === g.gameId) : null;
      const headerCls = gameThreadHeaderClass(myViewPick, g);
      viewHeader = `<div class="chat-view-header${headerCls}">
        <div><strong>${esc(g.awayTeam)} @ ${esc(g.homeTeam)}</strong>
          <span class="text-muted text-xs">${esc(formatSpread(g.lockedSpread ?? g.spread, g.favorite, g) || '')}</span></div>
        <div>${g.status === GAME_STATUS.LIVE ? `<span class="live-pulse"></span> LIVE ${score}` : score}</div>
      </div>`;
    }
  }

  // ONE ARM NOW (2026-09-23). The other said "the backend deployment is out of
  // date. Commissioner: open Apps Script → Deploy → Manage deployments…", which
  // is an instruction nobody can follow any more and, worse, an instruction
  // that would send the commissioner to a project that no longer serves this
  // app while his real problem went undiagnosed. It was driven by
  // `st.staleDeployment`, retired with the Apps Script chat transport.
  const banner = st.offline
    ? `<div class="chat-offline-banner">⚠️ CHAT OFFLINE — messages are not syncing. Retrying… <span class="text-xs">(${esc(st.lastError || '')})</span></div>`
    : '';

  // UN-104: the two-line header ("Chat" + a "📋 SCRIBE on duty" subtitle) is
  // gone — Drew asked whether the header needs to be there at all given
  // limited space; the answer was keep it, but make it unobtrusive. The
  // SCRIBE "on duty" member-framing requirement (UN-67) survives elsewhere —
  // the empty-room state above ("SCRIBE is on duty.") and the Rules FAQ — so
  // dropping it here is a de-duplication, not a loss (loadtest guards both
  // surviving instances). What replaces it: ONE compact row (Chat + the
  // UN-101 BETA badge + the gear) wrapped with the pills and the per-game
  // view header in a single sticky unit docked beneath .app-header, so
  // there's no per-element `top` math for siblings whose own height also
  // varies. The offline banner and retention notice stay in NORMAL flow
  // above that sticky unit, pushing it down rather than floating separately.
  // F2 (UN-165) — a non-empty query REPLACES the message-list area with
  // search results; an OPEN-but-empty query leaves the normal feed rendered
  // unchanged (States table: "Empty query... message list unchanged").
  // RG-174 — read the in-progress draft off the LIVE composer before the
  // innerHTML write below destroys it. See captureComposerDraft().
  const draft = captureComposerDraft();
  // RG-176 — and the SAME hazard for every other text field on this page: the
  // ⚙ prefs panel's #pref-nick / #pref-initials. Those are DURABLE synced
  // state, not a scratch draft, so the rule is stricter than the composer's:
  // only a DIRTY field (value ≠ the value the markup rendered) is carried, or
  // a display-name change made on another device would be clobbered by the
  // stale copy this device happened to render. bindPrefsPanel() listens on
  // 'change', which fires on BLUR — so a repaint mid-edit loses the edit
  // outright, not merely the caret.
  //
  // `chat-input` is EXCLUDED: captureComposerDraft() above already owns it, and
  // a restored draft also needs syncComposerChrome() (its grown height and
  // character count), which the generic pair knows nothing about. Two owners
  // for one field is how a restore ends up racing itself.
  const prefsFields = captureDirtyFields(c, me(), { skipIds: ['chat-input'] });

  const searchQuery = U.searchQuery.trim();
  const scrollBodyHTML = (U.searchOpen && searchQuery)
    ? searchResultsHTML(searchQuery)
    : `${(retentionOn() || backfillBlockedByEpoch()) ? '' : '<button class="chat-load-older" id="chat-load-older">↑ load earlier</button>'}${msgsHTML}`;

  c.innerHTML = `
    ${banner}
    ${retentionNoticeHTML()}
    <div class="chat-sticky-stack">
      <div class="chat-header-row">
        <h2>Chat <span class="badge badge-beta" title="Still being tested — tell us if something looks wrong">BETA</span> ${_chatSyncBadgeHTML()}</h2>
        <div class="chat-header-actions">
          <button class="btn btn-ghost btn-sm" id="chat-search-btn" title="Search chat">🔍</button>
          <button class="btn btn-ghost btn-sm" id="chat-prefs-btn" title="Chat preferences">⚙️</button>
          ${refreshControlHTML('chat-refresh')}
        </div>
      </div>
      ${U.searchOpen ? searchBarHTML() : pillsHTML()}
      ${viewHeader}
    </div>
    ${U.prefsOpen ? prefsPanelHTML() : ''}
    <div class="chat-scroll" id="chat-scroll">
      ${scrollBodyHTML}
    </div>
    <button class="chat-jump-latest" id="chat-jump" style="display:none">↓ latest</button>
    ${self ? composerHTML() : loginPromptHTML()}
  `;

  bindChatPage();
  // RG-174 — put the draft back onto the FRESH composer, after bindChatPage()
  // so the restored text lands on a node whose listeners are already live.
  restoreComposerDraft(draft);
  // RG-176 — and the prefs fields, for the same reason and at the same moment.
  // The owner key is re-read HERE rather than reused from the capture: the
  // identity guard has to be checked on BOTH sides, or a session change that
  // happened between the two halves would slip through.
  restoreDirtyFields(prefsFields, c, me());
  // RG-176 — stamp WHOSE data this markup was rendered from, for exactly the
  // reason `_composerOwner` below exists: the next render may happen after a
  // session change made on another page, and the text left in these nodes would
  // otherwise be carried into the new player's fields.
  stampFieldOwner(c, me());
  _composerOwner = me();
  watchChatStickyMetrics();
  if (U.searchOpen) {
    // Focus (and restore caret position) rather than scroll-to-bottom — this
    // page re-renders on every keystroke (same pattern as every other U.*
    // state change in this module), and a text input that loses focus on
    // every keystroke would be unusable.
    const si = document.getElementById('chat-search-input');
    if (si) { si.focus(); const p = si.value.length; si.setSelectionRange?.(p, p); }
  } else {
    const scroll = document.getElementById('chat-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  // Mark read after the view has been visibly open for 1s (spec)
  clearTimeout(U.markTimer);
  U.markTimer = setTimeout(() => {
    if (!chatPageActive()) return;
    markSeen(U.filter === 'all' || U.filter === 'records' || U.filter === 'mentions' ? 'all' : U.filter);
    updateChatBadges();
    renderPillsOnly();
  }, 1000);
}

function renderPillsOnly() {
  _abbrMemo.clear();                                 // per-pass cache only (see abbrMapFor)
  // F2 (UN-165) — while search is open, `.chat-pills-scroll` isn't in the DOM
  // at all (searchBarHTML() occupies that slot instead — see
  // renderChatPage()), so `host` is null and this periodic refresh correctly
  // no-ops rather than clobbering the search input mid-edit.
  const host = document.querySelector('#page-chat .chat-pills-scroll');
  if (host) host.outerHTML = pillsHTML();
  bindFilterButtons(document.getElementById('page-chat'));
}

// ── Signed-out composer replacement ───────────────────────────────────────────
/**
 * v0.17.2: reading the Locker Room is open to anyone who cleared the site PIN;
 * posting requires a verified player. Previously this was a dead line of text.
 * Now it mirrors the dashboard's "Go to Picks" pattern — a real button that
 * routes to the login screen and comes back here once the player is verified.
 */
function loginPromptHTML() {
  return `
  <div class="chat-login-prompt">
    <div class="chat-login-prompt-text">
      <strong>Log in to post.</strong>
      <span class="text-muted text-xs">Reading is open to the league — posting needs your PIN.</span>
    </div>
    <button class="btn btn-primary btn-sm" id="chat-login-btn">Log in →</button>
  </div>`;
}

function bindLoginPrompt(root) {
  root?.querySelector('#chat-login-btn')?.addEventListener('click', () => {
    // Remember where they were so login can bounce them back (doc 1.2).
    U.returnToChat = true;
    U.returnFilter = U.filter;
    U.returnAt = Date.now();
    if (typeof window !== 'undefined' && typeof window.navigateTo === 'function') window.navigateTo('picks');
    else document.querySelector('.nav-item[data-tab="picks"]')?.click();
  });
}

/**
 * Called after a successful login. If the player was sent to the login screen
 * from chat, put them back in the same filter they were reading.
 *
 * The intent EXPIRES. It used to be cleared only on a successful player-PIN
 * login, so a reader who tapped "Log in →" and then wandered off left the flag
 * set for the rest of the session — and their next login, possibly days later,
 * silently yanked them out of the picks page into chat. "Bounce me back" only
 * means anything within a few minutes of the tap; after that it is stale intent
 * and the login should land wherever it normally lands.
 *
 * The flag is consumed unconditionally, so it can never go sticky again.
 */
const RETURN_WINDOW_MS = 5 * 60 * 1000;

export function resumeChatAfterLogin() {
  if (!U.returnToChat) return false;
  const fresh = Date.now() - U.returnAt < RETURN_WINDOW_MS;
  const filter = U.returnFilter;
  U.returnToChat = false; U.returnFilter = null; U.returnAt = 0;
  if (!fresh) return false;
  if (filter) U.filter = filter;
  navToChat();
  return true;
}

// ── Composer ──────────────────────────────────────────────────────────────────
/**
 * UN-103 — Drew: "a user can use their own emojis in their keyboard," so the
 * composer no longer offers an emoji row at all (neither the six quick-insert
 * buttons nor the "more emoji" picker). What used to be composer-level emoji
 * selection is now a per-MESSAGE react (the + in messageHTML's .chat-actions,
 * opening the same picker anchored to the message instead of the composer).
 * Composer shape is now: reply chip → tag chip → textarea + send → char count.
 */
function composerHTML() {
  const replyMsg = U.replyTo ? getMessage(U.replyTo) : null;
  const tag = currentComposerTag();
  const found = tag ? gameById(tag) : null;
  return `
  <div class="chat-composer">
    ${replyMsg ? `<div class="chat-replying">↩ replying to <strong>${esc(nameOf(replyMsg.author))}</strong>: ${esc(replyMsg.body.slice(0, 60))}
      <button id="chat-cancel-reply">✕</button></div>` : ''}
    ${found ? `<div class="chat-tag-chip-row"><span class="chat-tag-chip">🏈 ${esc(gameShort(found.game, found.week))}
      <button id="chat-strip-tag" title="Remove game tag — post to the main room only">✕</button></span>
      <span class="text-muted text-xs">tagged — shows in this game's thread and the Locker Room</span></div>` : ''}
    <div class="chat-composer-row">
      <textarea class="chat-input" id="chat-input" rows="1" maxlength="1000"
        placeholder="Message the league…"></textarea>
      <button class="chat-send-btn" id="chat-send">➤</button>
    </div>
    <div class="chat-composer-foot">
      <span class="chat-char-count" id="chat-count" style="display:none"></span>
    </div>
    <div class="chat-mention-menu" id="chat-mention-menu" style="display:none"></div>
  </div>`;
}

// ── RG-174 — THE IN-PROGRESS DRAFT SURVIVES A RE-RENDER ──────────────────────
/**
 * Drew, 2026-09-19: "the chat will delete my message halfway through me
 * typing it."
 *
 * renderChatPage() rebuilds `#page-chat` with ONE innerHTML assignment, and
 * composerHTML() emits an empty `#chat-input` textarea element. (Written that
 * way deliberately: a literal opening textarea TAG in a comment is read as a
 * real one by xsstest [7c]'s source sweep, which then treats everything up to
 * the next close tag as an unescaped textarea body.) So every
 * re-render hands the player a brand-new, blank composer — the node they were
 * typing into no longer exists. That has been true since the composer shipped;
 * what changed at the Supabase cutover is the FREQUENCY. renderChatPage() now
 * runs on every inbound chat event, every Realtime table event
 * (app.js `onRealtimeEvent` -> `_repaintForSupabaseData` -> navigateTo), every
 * rehydrate tick, every auth/membership refresh and every pg_cron week flip —
 * i.e. every few seconds during live games, instead of every few minutes under
 * Sheets. A latent defect became a constant one.
 *
 * FIXED HERE, at the render seam, rather than at any of those triggers: the
 * triggers are all legitimate (the feed genuinely must repaint when a message
 * arrives), there are five of them in two modules, and chat-ui.js cannot see
 * four of them. One capture/restore pair around the single innerHTML write
 * covers every caller of renderChatPage() that exists now or later.
 *
 * The precedent is eleven lines above it in the same function: `U.searchQuery`
 * + the focus/setSelectionRange restore renderChatPage() already performs for
 * the SEARCH input, for exactly this reason ("a text input that loses focus on
 * every keystroke would be unusable"). Nothing is persisted to storage — a
 * draft is not durable state and there is no draft key to write it to.
 *
 * DELIBERATELY SCOPED to a NON-EMPTY draft. An empty composer has nothing to
 * lose, and re-focusing one on every repaint would pop the on-screen keyboard
 * open every few seconds on a phone — a new bug in the same place. Focus is
 * likewise only RESTORED, never granted: a composer the player wasn't in stays
 * unfocused (drafttest §7).
 */
// WHOSE draft is in the box. Stamped by renderChatPage() after every render with the session
// player it rendered FOR. The textarea outlives a session change made on ANOTHER page (Picks →
// Log Out / Switch Player never re-renders chat), so without this the next player's first visit
// to Chat would capture the previous player's text and restore it into THEIR composer — and a
// tap on Send would post A's words under B's name into the permanent log (RG-51 class; reviewer
// BLOCK on v0.22.5, 2026-09-19). A draft is only ever carried across a re-render for the SAME
// verified player; on any mismatch it is dropped, never restored.
let _composerOwner = null;

// RG-176 — THE BRAND. captureComposerDraft() is the SOLE producer for
// restoreComposerDraft(), and that is now asserted rather than assumed
// (reviewer follow-up on RG-174). The producer is where all three guards live —
// the `_composerOwner` identity check, the non-empty rule, and the IME check
// below — so a caller that hand-rolled its own snapshot object would bypass all
// three at once while looking exactly like the supported path.
const COMPOSER_DRAFT_BRAND = 'chat-ui/composerDraft/v1';

function captureComposerDraft() {
  if (typeof document === 'undefined') return null;
  if (!me() || me() !== _composerOwner) return null;
  // RG-176 — the IME guard (reviewer follow-up on RG-174). Between
  // compositionstart and compositionend the browser holds a preedit buffer that
  // is NOT yet part of `value`; snapshotting mid-composition captures half a
  // word and restoring it races the IME's own commit. js/field-preserve.js owns
  // the one composition watch for the whole app.
  if (isComposing()) return null;
  const input = document.getElementById('chat-input');
  const value = input?.value || '';
  if (!value) return null;
  // RG-191 — a draft a send has already taken is not a draft. See
  // consumeComposerDraft() below for why the statement order in doSend() is not
  // enough on its own.
  if (_consumedDraft !== null && value === _consumedDraft) return null;
  const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : value.length;
  return {
    __src: COMPOSER_DRAFT_BRAND,
    value,
    start: typeof input.selectionStart === 'number' ? input.selectionStart : end,
    end,
    focused: document.activeElement === input,
  };
}

function restoreComposerDraft(snap) {
  if (!snap) return;
  if (snap.__src !== COMPOSER_DRAFT_BRAND) {
    console.error('[chat-ui] restoreComposerDraft() was handed a snapshot captureComposerDraft() did not produce — refusing');
    return;
  }
  if (isComposing()) return;          // RG-176 — never write over a live composition
  const input = document.getElementById('chat-input');
  if (!input) return;                 // signed out, chat disabled, or search open — nothing to restore onto
  if (input.value) return;            // defensive: never clobber text the fresh markup put there itself
  input.value = snap.value;
  input.setSelectionRange?.(snap.start, snap.end);
  syncComposerChrome(input);          // a multi-line draft must come back at its grown height, with its char count
  if (snap.focused) input.focus();
}

// ── RG-191 — A SENT DRAFT IS CONSUMED BEFORE ANYTHING CAN RE-RENDER ──────────
/**
 * Drew, 2026-09-19, on v0.22.5: "it is remembering my message in the chat, but
 * is still there after I hit send." A second tap would have double-posted it.
 *
 * WHY: doSend() read `#chat-input` once at the top and cleared THAT reference
 * after the send. But `sendMessage()` is not quiet — chat.js's sendEvent()
 * ingests the event optimistically and ingest() calls notify('events')
 * SYNCHRONOUSLY, which runs this module's own handleChatEvent() ->
 * `if (chatPageActive()) renderChatPage()` from inside the send call. That
 * repaint captured a draft that was still full (the clear hadn't run yet),
 * replaced the textarea, and restored the sent text onto the NEW node. The
 * clear then emptied the OLD, detached one, which nobody can see. RG-174's
 * draft preservation didn't cause this; it made an already-stale reference
 * visible, and on a phone it happened on every single send.
 *
 * THE SIGNAL, not the ordering. The composer is cleared through a FRESH
 * lookup, before anything can repaint, and the text that was taken is recorded
 * so captureComposerDraft() refuses it for the duration of the send. Order
 * alone would fix today's call graph and break again the first time a line
 * moves or a new repaint trigger lands between two statements — which is
 * exactly the shape of the defect being fixed.
 *
 * ONE-SHOT, on purpose. The token is released the moment doSend() finishes
 * (in a `finally`, so a throw in the repaint cannot strand it). A token that
 * outlived its send would refuse a player's next draft whenever they re-typed
 * the same words — RG-174, handed back, for "lol".
 */
let _consumedDraft = null;

/** Takes the composer's text and empties it. Re-queries by id: doSend() must
 *  never clear a node it looked up before the send. Returns the text taken. */
function consumeComposerDraft() {
  const live = (typeof document !== 'undefined') ? document.getElementById('chat-input') : null;
  const text = live?.value || '';
  _consumedDraft = text;
  if (live) {
    live.value = '';
    live.setSelectionRange?.(0, 0);
    syncComposerChrome(live);        // shrink the box back and drop the char count
  }
  return text;
}

/** The send didn't take — give the player their sentence back. Releases the
 *  token too: from here on this is an ordinary in-progress draft. */
function restoreConsumedDraft() {
  const text = _consumedDraft;
  _consumedDraft = null;
  if (text == null || text === '') return;
  const live = (typeof document !== 'undefined') ? document.getElementById('chat-input') : null;
  if (!live || live.value) return;   // never clobber anything typed since
  live.value = text;
  live.setSelectionRange?.(text.length, text.length);
  syncComposerChrome(live);
}

/** Test-only seams (the `_prefsPanelHTMLForTest` convention, and RG-27's rule
 *  that an assertion runs against the SHIPPED function rather than a copy).
 *  drafttest §14 uses them to prove the brand check refuses a forged snapshot
 *  while the genuine pair still works. Production never calls these. */
export const _captureComposerDraftForTest = () => captureComposerDraft();
export const _restoreComposerDraftForTest = (snap) => restoreComposerDraft(snap);

/**
 * The composer's height + character count, kept in one place because the
 * 'input' listener (bindChatPage) and the draft restore above both have to
 * produce the same chrome for the same text. Deliberately does NOT touch the
 * mention menu: the listener still calls maybeMentionMenu() itself, because
 * re-opening an @-menu the player never re-typed is not "preserving" anything.
 */
function syncComposerChrome(input) {
  if (!input) return;
  if (input.style) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight || 0, 120) + 'px';
  }
  const count = document.getElementById('chat-count');
  if (count) {
    const len = (input.value || '').length;
    count.style.display = len >= 900 ? 'inline' : 'none';
    count.textContent = `${len}/1000`;
  }
}

function currentComposerTag() {
  // The cross-talk rule, made visible: reply inherits parent tag; else the view.
  if (U.tagStripped) return '';
  const viewTag = ['all', 'records', 'mentions'].includes(U.filter) ? '' : U.filter;
  return resolveTag({ replyTo: U.replyTo, viewTag });
}

/**
 * Build 2, Group C (2026-09-10, C-5 — Drew's broadcast-ack ruling) —
 * supersession for the `scribeAskAck` placeholder. The server appends a
 * `type:'system'`, `meta.kind:'scribeAsk'` event the moment it wins the
 * dedup lock for a mention (id `scribe_ack_<triggerMessageId>`, `targetId`
 * = the triggering message's id) so EVERY device sees "SCRIBE is looking
 * into it…" on the next ordinary poll. Neither event is ever mutated or
 * deleted (append-only log, AD-10) — this is a RENDER-time fold, the same
 * hide-not-destroy shape chat retention/the epoch clear already use: once
 * the real reply (or the client's degraded fallback — same deterministic id,
 * `scribe_llm_<triggerMessageId>`, by construction) exists in the fold, the
 * ack is filtered out of what's displayed. `getMessage()` is an O(1) Map
 * lookup, so this costs nothing per render pass.
 */
// B3c remediation (2026-09-10, round 1) — render-time staleness bound. Without
// this, an ack that never gets superseded (the server crashed before posting
// a reply AND the asker's own tab was closed/backgrounded before the client
// degrade fallback ever ran) pinned "SCRIBE is looking into it…" on screen
// FOREVER, on every device, for that trigger. Device-local, no write: the
// underlying ack event is untouched in the fold (AD-10 hide-not-destroy) —
// this only affects what THIS render pass shows.
const SCRIBE_ACK_STALE_MS = 5 * 60 * 1000;

function filterSupersededScribeAcks(list) {
  return list.filter(m => {
    if (m.type !== 'system' || m.meta?.kind !== 'scribeAsk') return true;
    // NOTE: read triggerMessageId from `meta`, not `m.targetId` — chat.js's
    // fold (`newItem()`) never copies `targetId` onto a rendered item (it's
    // consumed transiently, only by mutation-style events like react/edit/
    // delete/pin, to find their target). `meta` is preserved verbatim, so
    // that's the durable field to key supersession on — Code.gs's
    // `scribePostAck_` sets both `targetId` (server-side bookkeeping) and
    // `meta.triggerMessageId` (client-visible) for exactly this reason.
    if (getMessage(`scribe_llm_${m.meta?.triggerMessageId}`)) return false;   // superseded by the real (or degraded) reply
    if (Date.now() - (m.ts || 0) > SCRIBE_ACK_STALE_MS) return false;         // B3c — stop showing it after 5 minutes with no reply
    return true;
  });
}
/** Test-only (same convention as `_renderSheetMessagesForTest` above) — lets
 *  scribetest.mjs exercise the REAL supersession fold without also driving
 *  full page rendering. */
export function _filterSupersededScribeAcksForTest(list) { return filterSupersededScribeAcks(list); }

function mentionCandidates(prefix) {
  const names = [...getPlayers().filter(p => p.active).map(p => ({ id: p.playerId, name: nameOf(p.playerId) })),
                 { id: 'scribe', name: 'SCRIBE' }];
  const low = prefix.toLowerCase();
  return names.filter(n => n.name.toLowerCase().startsWith(low)).slice(0, 6);
}

function extractMentions(body) {
  const ids = new Set();
  const names = [...getPlayers().map(p => ({ id: p.playerId, name: nameOf(p.playerId) })), { id: 'scribe', name: 'scribe' }];
  (body.match(/@([\w.']+)/g) || []).forEach(tok => {
    const t = tok.slice(1).toLowerCase();
    const hit = names.find(n => n.name.toLowerCase().startsWith(t));
    if (hit) ids.add(hit.id);
  });
  return [...ids];
}

function doSend() {
  const input = document.getElementById('chat-input');
  const body = (input?.value || '').trim();
  if (!body) return;
  const self = me(); if (!self) return;
  const gameTag = currentComposerTag();
  const mentions = extractMentions(body);
  // RG-191 — empty the LIVE composer BEFORE the send, and mark the text as
  // consumed. sendMessage() repaints this page synchronously (see
  // consumeComposerDraft()), so a clear that runs afterwards clears a node that
  // no longer exists and the player watches their sent message sit in the box.
  consumeComposerDraft();
  let sentId;
  try {
    sentId = sendMessage({ body, gameTag, replyTo: U.replyTo || '', author: self, mentions });
  } catch (err) {
    // Nothing was queued, so nothing was sent — give the words back rather than
    // making the player retype them. (The ordinary transport failure is NOT
    // this path: that message is queued, shown pending, and retryable in the
    // feed. This is a refusal before the queue.)
    console.error('[chat-ui] send refused before the message was queued — the draft has been put back', err);
    restoreConsumedDraft();
    return;
  }
  // SCRIBE participates as a member — it reads the Locker Room, it isn't summoned.
  // UN-160 (E2) — triggerMessageId threads the just-sent human message's own
  // id into any resulting SCRIBE response's meta, so a rating/rewrite against
  // that response can be traced back to what actually caused it.
  try {
    scribeInspectMessage({ author: self, authorName: nameOf(self), body, gameTag, standings: standingsCtx(), triggerMessageId: sentId });
  } catch {}
  U.replyTo = null; U.tagStripped = false;
  // The token stays armed across this repaint — it is the last one that could
  // put the sent text back — and is released in `finally` so a throw in the
  // render can never strand it (see _consumedDraft).
  try { renderChatPage(); } finally { _consumedDraft = null; }
}

function standingsCtx() {
  try {
    const players = getPlayers().filter(p => p.active);
    // light context: derive first/last from stored season results if available
    return null;   // full standings ctx wired in app layer when needed
  } catch { return null; }
}

// ── Bindings ──────────────────────────────────────────────────────────────────
function bindFilterButtons(root) {
  root?.querySelectorAll('[data-chat-filter]').forEach(b => b.addEventListener('click', () => {
    U.filter = b.dataset.chatFilter;
    U.replyTo = null; U.tagStripped = false;
    renderChatPage();
  }));
}

/**
 * DI-125b — the per-message action buttons ([data-reply], [data-react-
 * open], [data-pin], [data-edit], [data-del], [data-callout], and — UN-159,
 * E1 — [data-fb-open]), wired ONCE here and reused by BOTH the main feed
 * (bindChatPage, `host = #page-chat`) and the sheet (renderSheetMessages,
 * `host = #chat-sheet-scroll`) — not forked into two near-identical copies.
 * `renderFn` is the surface's own refresh (renderChatPage vs
 * renderSheetMessages); `surface` ('main'|'sheet') is threaded only into the
 * two handlers whose TARGET depends on which composer should react
 * (openReplyFor, toggleMessageReactPicker's post-pick refresh via
 * openReactPickerFor). Every handler body below is otherwise byte-identical
 * to what shipped in bindChatPage() before this batch — moved, not rewritten.
 *
 * [data-react] (tap-to-vote) and [data-retry] are DELIBERATELY excluded —
 * DI-125c requires the reaction pill's plain tap stay untouched, and retry
 * was already correctly wired in both surfaces before this batch existed.
 */
function bindMessageActionButtons(host, renderFn, surface) {
  host?.querySelectorAll('[data-reply]').forEach(b => b.addEventListener('click', () => openReplyFor(b.dataset.reply, surface)));
  // ONE query, reused twice below — the wiring and the DI-268 re-mount both
  // want the same set of triggers, and a second `querySelectorAll` would be a
  // second place to keep the selector correct (feedbacktest [28](f) pins that
  // there is exactly one).
  const fbTriggers = [...(host?.querySelectorAll('[data-fb-open]') || [])];
  fbTriggers.forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    if (!me()) return;
    toggleFeedbackPicker(b, b.dataset.fbOpen, renderFn, surface);
  }));
  // DI-268 — an open feedback popover is restored HERE, by the same function
  // that re-binds every other per-message control after a repaint. See
  // remountOpenFeedbackPicker() for why it has to be re-mounted at all.
  remountOpenFeedbackPicker(fbTriggers, renderFn, surface);
  host?.querySelectorAll('[data-react-open]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    if (!me()) return;
    toggleMessageReactPicker(b, b.dataset.reactOpen, renderFn);
  }));
  host?.querySelectorAll('[data-pin]').forEach(b => b.addEventListener('click', () => {
    const self = me(); if (!self) return;
    const msg = getMessage(b.dataset.pin);
    pinMessage(b.dataset.pin, self, !msg?.pinned);
    renderFn();
  }));
  host?.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const self = me(); if (!self) return;
    const msg = getMessage(b.dataset.edit); if (!msg) return;
    const next = prompt('Edit message (5-minute window):', msg.body);
    if (next !== null && next.trim() && next !== msg.body) { editMessage(msg.id, next.trim(), self); renderFn(); }
  }));
  host?.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const self = me(); if (!self) return;
    if (confirm('Withdraw this message? A tombstone will remain. SCRIBE keeps the receipts.')) {
      deleteMessage(b.dataset.del, self); renderFn();
    }
  }));
  // FEAT-3 / DI-200f — routes through the SAME deepLinkTo() the notification
  // deep link and "↩ Jump to the message" already use. chat-ui.js cannot import
  // app.js (app.js imports this module; the reverse would be a cycle), so it
  // goes over the established window.* bridge, exactly like window.navigateTo
  // and window.showToast above.
  host?.querySelectorAll('[data-whatsnew]').forEach(b => b.addEventListener('click', () => {
    const fn = (typeof window !== 'undefined') ? window.deepLinkTo : null;
    if (typeof fn === 'function') fn({ tab: 'rules', params: { whatsNew: b.dataset.whatsnew } });
    else if (typeof window !== 'undefined' && typeof window.navigateTo === 'function') window.navigateTo('rules');
  }));
  // FEAT-5 / DI-202a — 🤝 opens app.js's logging modal. Same window.* bridge,
  // same reason, as [data-whatsnew] above: chat-ui.js cannot import app.js.
  host?.querySelectorAll('[data-wager]').forEach(b => b.addEventListener('click', () => {
    const self = me(); if (!self) return;
    const fn = (typeof window !== 'undefined') ? window.openWagerModal : null;
    if (typeof fn === 'function') fn(b.dataset.wager);
  }));
  // FEAT-5 / DI-202f — 🤝 I'm in / 🙅 I'm not. The SAVING and SAVE-FAILED states
  // are owned here because they are properties of THIS control, not of the
  // stored record: both buttons in the row disable, the tapped one's label
  // becomes "Saving…", and a failure re-enables them and says so underneath.
  host?.querySelectorAll('[data-wager-ack]').forEach(b => b.addEventListener('click', async () => {
    const self = me(); if (!self) return;
    const row = b.closest?.('.chat-wager-row') || null;
    const siblings = row?.querySelectorAll?.('[data-wager-ack]') || [b];
    const label = b.textContent;
    siblings.forEach?.(x => { x.disabled = true; });
    b.textContent = 'Saving…';
    const fn = (typeof window !== 'undefined') ? window.answerWager : null;
    let res = null;
    try { res = (typeof fn === 'function') ? await fn({ wagerId: b.dataset.wagerId, reply: b.dataset.wagerAck }) : null; }
    catch { res = null; }
    if (res && res.ok) { renderFn(); return; }
    siblings.forEach?.(x => { x.disabled = false; });
    b.textContent = label;
    if (row && typeof row.insertAdjacentHTML === 'function' && !row.querySelector?.('.chat-wager-note')) {
      row.insertAdjacentHTML('beforeend', '<span class="text-muted text-xs chat-wager-note">Didn\'t save — tap again.</span>');
    }
  }));
  host?.querySelectorAll('[data-callout]').forEach(b => b.addEventListener('click', () => {
    const self = me(); if (!self) return;
    const msg = getMessage(b.dataset.callout); if (!msg) return;
    sendEvent({
      type: 'message', author: self, gameTag: msg.gameTag, notify: true,
      body: 'Prior statement, for the record:',
      meta: { mentions: [msg.author], quote: { id: msg.id, author: msg.author, body: msg.body.slice(0, 160) } },
    });
    renderFn();
  }));
}
// Test-only alias (see chat.js's `_resetForTest` convention) — exercises the
// REAL shared wiring both surfaces use, not a re-implementation.
export const _bindMessageActionButtons = bindMessageActionButtons;

function bindChatPage() {
  const c = document.getElementById('page-chat'); if (!c) return;
  bindFilterButtons(c);
  bindLoginPrompt(c);

  document.getElementById('chat-prefs-btn')?.addEventListener('click', () => {
    U.prefsOpen = !U.prefsOpen; renderChatPage();
  });
  bindPrefsPanel();
  document.getElementById('chat-refresh-btn')?.addEventListener('click', onChatRefreshTap);

  document.getElementById('chat-load-older')?.addEventListener('click', async e => {
    e.target.textContent = '…';
    await backfill(100);
    renderChatPage();
  });

  // F2 (UN-165) — search. 🔍 toggles open/closed (closing resets the query,
  // restoring the pills row per the design input's "tapping 🔍 again...
  // restores the pills row"). Escape and the ✕ clear button are the OTHER
  // two named ways to close, per the same sentence; emptying the input via
  // backspace alone stays OPEN at the "empty query" state (States table:
  // "Cleared → returns to the empty-query state, not a no-results flash") —
  // deliberately NOT a third full-close trigger, so backspacing doesn't
  // unexpectedly snap the search UI shut mid-edit.
  document.getElementById('chat-search-btn')?.addEventListener('click', () => {
    U.searchOpen = !U.searchOpen;
    if (!U.searchOpen) U.searchQuery = '';
    renderChatPage();
  });
  document.getElementById('chat-search-close')?.addEventListener('click', () => {
    U.searchOpen = false; U.searchQuery = '';
    renderChatPage();
  });
  document.getElementById('chat-search-clear')?.addEventListener('click', () => {
    U.searchQuery = '';
    renderChatPage();
  });
  const searchInput = document.getElementById('chat-search-input');
  searchInput?.addEventListener('input', () => {
    U.searchQuery = searchInput.value;
    renderChatPage();
  });
  searchInput?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { U.searchOpen = false; U.searchQuery = ''; renderChatPage(); }
  });
  document.getElementById('chat-search-load-older')?.addEventListener('click', async e => {
    e.target.textContent = '…';
    // Non-blocking finding #11 (CONVENTIONS #4) — backfill() itself always
    // resolves (its own try/catch never rethrows), so this can't reject
    // today, but an unguarded await on a network-backed call is exactly the
    // shape that silently breaks sync if that ever changes. Belt-and-
    // suspenders, matching the wrap-every-await-in-try/catch house rule.
    try { await backfill(100); } catch { /* backfill() never rejects; defensive only */ }
    renderChatPage();
  });
  // Tapping a result: exit search back to the normal feed, THEN jump — the
  // SAME scrollIntoView + .chat-flash mechanism as F3's [data-jump] handler
  // just below (kept as a separate wiring, not literally the same attribute,
  // because a search-result tap must ALSO close search first; the generic
  // [data-jump] handler only ever jumps, never changes view state).
  c.querySelectorAll('[data-search-jump]').forEach(b => b.addEventListener('click', () => {
    const mid = b.dataset.searchJump;
    U.searchOpen = false; U.searchQuery = '';
    renderChatPage();
    const target = document.querySelector(`#chat-scroll [data-mid="${mid}"]`);
    if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('chat-flash'); setTimeout(() => target.classList.remove('chat-flash'), 1200); }
  }));

  const scroll = document.getElementById('chat-scroll');
  const jump = document.getElementById('chat-jump');
  scroll?.addEventListener('scroll', () => onChatScrollEvent(scroll, jump));
  jump?.addEventListener('click', () => { if (scroll) scroll.scrollTop = scroll.scrollHeight; });

  c.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    const el = c.querySelector(`[data-mid="${b.dataset.jump}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('chat-flash'); setTimeout(() => el.classList.remove('chat-flash'), 1200); }
  }));

  c.querySelectorAll('[data-react]').forEach(b => b.addEventListener('click', () => {
    const self = me(); if (!self) return;
    toggleReact(b.dataset.target, b.dataset.react, self);
    renderChatPage();
  }));
  // UN-120: long-press (touch, UNCHANGED) + right-click (desktop, replaces
  // hover) + axis-locked swipe (touch, supplements long-press) — all three
  // delegated on the same scroll container so they survive every re-render.
  // DI-125a: the SAME three binders are also delegated on #chat-sheet-scroll
  // — see renderSheetMessages(), below.
  bindMessageActionsLongPress(document.getElementById('chat-scroll'));
  bindMessageActionsContextMenu(document.getElementById('chat-scroll'));
  bindMessageSwipe(document.getElementById('chat-scroll'));
  // DI-125b: [data-reply]/[data-react-open]/[data-pin]/[data-edit]/[data-del]/
  // [data-callout] are wired by the ONE shared helper both surfaces use — see
  // bindMessageActionButtons(), below. [data-react] (above) and [data-retry]
  // (below) stay separate: DI-125c requires the reaction pill's tap-to-vote
  // untouched, and [data-retry] was already correctly wired in both surfaces
  // before this batch, so neither needed to move.
  bindMessageActionButtons(c, renderChatPage, 'main');
  c.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => { retryFailed(b.dataset.retry); renderChatPage(); }));

  // composer
  const input = document.getElementById('chat-input');
  input?.addEventListener('input', () => {
    // RG-174 — the autosize + char count moved into syncComposerChrome() so the
    // draft restore produces identical chrome for identical text. Behaviour of
    // this listener is otherwise unchanged.
    syncComposerChrome(input);
    maybeMentionMenu(input);
  });
  input?.addEventListener('keydown', e => {
    const desktop = matchMedia('(min-width: 700px)').matches;
    if (e.key === 'Enter' && !e.shiftKey && desktop) { e.preventDefault(); doSend(); }
  });
  document.getElementById('chat-send')?.addEventListener('click', doSend);
  document.getElementById('chat-cancel-reply')?.addEventListener('click', () => { U.replyTo = null; renderChatPage(); });
  document.getElementById('chat-strip-tag')?.addEventListener('click', () => { U.tagStripped = true; renderChatPage(); });
}

/**
 * UN-103 — per-message react (the + in messageHTML's .chat-actions), Slack-
 * style rather than composer-level emoji insertion. Reuses `.reaction-picker`
 * / `.reaction-pick-option` VERBATIM (same CSS grid app.js's dashboard
 * reaction picker and the old composer picker both used: 5×3 desktop / 7×3
 * mobile, 42-44px targets) rather than inventing a second layout — the
 * v0.15.1 picker shipped at ~22×22px and had to be rebuilt once already.
 * Anchored to the MESSAGE (`.chat-actions`, position:absolute in CSS as of
 * UN-120 — still a valid containing block for this nested absolute child),
 * not the composer foot — this is a react on that message, not text
 * insertion.
 * On select, calls the SAME `toggleReact()` the always-visible quick-react
 * buttons used, then closes.
 *
 * `renderFn` (DI-125b) — which surface refreshes after a pick: defaults to
 * `renderChatPage` (the main feed's own click handler never passes a third
 * arg, so it is unchanged); the sheet passes `renderSheetMessages` so its own
 * message list — not the main feed's — updates.
 */
function toggleMessageReactPicker(anchorEl, mid, renderFn = renderChatPage) {
  const existing = document.getElementById('chat-react-picker');
  const reopening = existing?.dataset?.mid === mid;
  existing?.remove();
  document.getElementById('chat-feedback-picker')?.remove();   // single-open-at-a-time across BOTH popovers (E1)
  pendingFeedbackPicker = null;   // …and it stays closed: disarm the re-mount marker (DI-268)
  // R-4 (2026-09-23) — …but what the player had IN FLIGHT in it is still their
  // work. This eviction was the second dismissal path that wrote nothing: the
  // [data-react-open] handler calls stopPropagation(), so the feedback
  // popover's own outside-click closer never runs for this tap, and an unwritten
  // "why" plus an undebounced chip set went in the bin. Disarmed first, then
  // flushed, for the usual reason (a write repaints; an armed marker would
  // re-mount the popover this tap is evicting).
  //
  // KNOWN COST, accepted deliberately: if there really was something to write,
  // the repaint it causes rebuilds the feed and `anchorEl` below is stale, so
  // this one reaction picker may open detached and need a second tap. The
  // reaction picker has no re-mount marker to restore it with, and a lost
  // sentence is worse than a repeated tap.
  flushOpenFeedbackPicker();
  if (reopening) return;
  const self = me(); if (!self) return;
  const host = anchorEl.closest?.('.chat-actions') || anchorEl;
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.id = 'chat-react-picker';
  picker.dataset.mid = mid;
  picker.innerHTML = REACTION_PALETTE.map(em => `<button type="button" class="reaction-pick-option" data-emoji="${esc(em)}">${em}</button>`).join('');
  host.appendChild(picker);
  picker.querySelectorAll('[data-emoji]').forEach(opt => opt.addEventListener('click', ev => {
    ev.stopPropagation();
    toggleReact(mid, opt.dataset.emoji, self);
    picker.remove();
    renderFn();
  }));
  setTimeout(() => {
    const closer = ev => {
      if (!picker.contains(ev.target) && !ev.target.closest?.('[data-react-open]')) {
        picker.remove();
        document.removeEventListener('click', closer);
      }
    };
    document.addEventListener('click', closer);
  }, 0);
}

// ── UN-120: ONE reveal mechanism, TWO desktop/touch gestures ─────────────────
/**
 * Desktop right-click (contextmenu) and touch long-press both reveal the
 * SAME thing on the SAME message: `.chat-actions` AND, since UN-121 folds
 * into this same state, `.chat-reaction-names` — governed by one class,
 * `.chat-actions-revealed` on `.chat-msg` (styles.css). Only one message may
 * be revealed at a time; revealing a second dismisses the first (enforced by
 * revealMessageActions() below, shared by every gesture that reveals).
 *
 * REPLACES hover entirely — not tuned with a hover-intent delay, which was
 * proposed and REJECTED by Drew: "The hover feature is what makes the text
 * appear jumpy... Just hovering with a cursor doesn't work. It should be
 * right click." Desktop: bindMessageActionsContextMenu, below. Touch:
 * bindMessageActionsLongPress (UN-103, UNCHANGED — it covers up to 6
 * actions, more than a 2-direction swipe can address), SUPPLEMENTED, not
 * replaced, by bindMessageSwipe (DI-120b) for the two most common actions.
 *
 * Long-press reuses the TIMER + THRESHOLD + cancel-on-move SHAPE proven in
 * app.js's `bindColumnReorderHandlers` (350ms / 8px — the exact numbers
 * already separating "long-press intent" from "scroll intent" elsewhere in
 * this app). Its pending-timer state now lives at MODULE scope (it was the
 * function's own closure pre-UN-120) so bindMessageSwipe can cancel a
 * pending long-press the instant a gesture commits to a swipe — the two must
 * never both fire for one touch. All three binders are delegated on the
 * scroll container so they survive every re-render without rebinding — same
 * reasoning as `bindFilterButtons`.
 */
const LONG_PRESS_MS = 350;
const LONG_PRESS_THRESHOLD_PX = 8;
const SWIPE_THRESHOLD_PX = 40;
let _revealedMsgId = null;
// DI-125a — WHICH container the revealed message lives in ('chat-scroll' or
// 'chat-sheet-scroll'). #page-chat is never torn down on navigation (only
// hidden via the .active class), so a message tagged to a game can be
// rendered in it AND, independently, in that game's bottom sheet at the same
// time. Scoping by container id — not just by mid — is what keeps "only one
// message revealed, app-wide" correct in that case: revealing the SAME mid in
// a DIFFERENT container still dismisses the previous one, and the DOM lookup
// itself is scoped so it can never touch the wrong copy. See loadtest §[47]
// for the specific cross-container regression this guards.
let _revealedRootId = null;
let _lpTimer = null, _lpStart = null, _lpTargetMid = null;

function revealMessageActions(mid, rootId = 'chat-scroll') {
  if (_revealedMsgId && (_revealedMsgId !== mid || _revealedRootId !== rootId)) {
    document.querySelector(`#${_revealedRootId} .chat-msg[data-mid="${_revealedMsgId}"]`)?.classList.remove('chat-actions-revealed');
  }
  _revealedMsgId = mid;
  _revealedRootId = rootId;
  document.querySelector(`#${rootId} .chat-msg[data-mid="${mid}"]`)?.classList.add('chat-actions-revealed');
}
function dismissRevealedActions() {
  if (!_revealedMsgId) return;
  document.querySelector(`#${_revealedRootId} .chat-msg[data-mid="${_revealedMsgId}"]`)?.classList.remove('chat-actions-revealed');
  _revealedMsgId = null;
  _revealedRootId = null;
}
// Test-only (see `_resetForTest` convention) — direct behavioral coverage of
// "only one message revealed at a time" and of the Escape/click-elsewhere/
// scroll closers, without re-simulating a full gesture for every case.
export const _revealMessageActions = revealMessageActions;
export const _dismissRevealedActions = dismissRevealedActions;
export function _revealedRootIdForTest() { return _revealedRootId; }
export function _revealedMsgIdForTest() { return _revealedMsgId; }

/** Cancels a pending long-press (if any) without revealing anything —
 *  called by bindMessageSwipe the instant a gesture commits to a swipe, so a
 *  swipe can never ALSO reveal via long-press for the same touch. */
function cancelPendingLongPress() {
  if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  _lpStart = null;
}

function bindMessageActionsLongPress(root) {
  if (!root || root._longPressWired) return;
  root._longPressWired = true;
  // DI-125a — derived from the CONTAINER itself (a real #chat-scroll or
  // #chat-sheet-scroll node always carries its own id), not a second
  // parameter every caller would have to remember to pass. Falls back to
  // 'chat-scroll' for the pre-existing test fixtures that pass an id-less
  // fake root — preserving their exact prior behavior.
  const rootId = root.id || 'chat-scroll';
  root.addEventListener('touchstart', e => {
    if (e.touches?.length !== 1) return;
    const msgEl = e.target.closest?.('.chat-msg');
    if (!msgEl) return;
    const t = e.touches[0];
    _lpStart = { x: t.clientX, y: t.clientY };
    _lpTargetMid = msgEl.dataset.mid;
    _lpTimer = setTimeout(() => {
      _lpTimer = null;
      if (_lpTargetMid) {
        revealMessageActions(_lpTargetMid, rootId);
        if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
      }
    }, LONG_PRESS_MS);
  }, { passive: true });
  root.addEventListener('touchmove', e => {
    // No timer pending (already fired, cancelled by a swipe, or never
    // started here) — nothing to cancel.
    if (!_lpTimer || !_lpStart) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - _lpStart.x);
    const dy = Math.abs(t.clientY - _lpStart.y);
    // A finger swiping to SCROLL (or starting a swipe — see bindMessageSwipe
    // below) crosses this threshold well before 350ms; a finger holding
    // still to summon actions never does. Cancel the timer so scrolling — or
    // the start of a swipe — over a message never also reveals its actions.
    if (dx + dy > LONG_PRESS_THRESHOLD_PX) cancelPendingLongPress();
  }, { passive: true });
  const clearPress = () => cancelPendingLongPress();
  root.addEventListener('touchend', clearPress);
  root.addEventListener('touchcancel', clearPress);
}
// Test-only alias (see chat.js's `_resetForTest` convention) — exercises the
// REAL bind function's real closures/timing rather than a re-implementation.
export const _bindMessageActionsLongPress = bindMessageActionsLongPress;

/**
 * UN-120 (DI-120a) — desktop reveal. Replaces `.chat-msg:hover .chat-actions`
 * outright (styles.css) rather than tuning it — Drew explicitly rejected a
 * hover-intent delay; hovering itself, not its timing, was the jumpiness.
 * preventDefault() stops the native browser context menu from also opening.
 * Right-clicking an already-revealed message closes it (a second gesture on
 * the same target toggles rather than being a no-op); right-clicking a
 * DIFFERENT message hides the first — enforced by revealMessageActions()
 * itself, the same single-`_revealedMsgId` state the touch long-press
 * already used, so "only one message revealed at a time" cannot drift
 * between the two gestures.
 */
function bindMessageActionsContextMenu(root) {
  if (!root || root._ctxMenuWired) return;
  root._ctxMenuWired = true;
  const rootId = root.id || 'chat-scroll';   // DI-125a — see bindMessageActionsLongPress
  root.addEventListener('contextmenu', e => {
    const msgEl = e.target.closest?.('.chat-msg');
    if (!msgEl) return;
    e.preventDefault?.();
    const mid = msgEl.dataset.mid;
    // DI-125a: the toggle-closes-itself case must also match on CONTAINER,
    // not just mid — otherwise right-clicking a message in the sheet that
    // happens to share an id with an ALREADY-revealed copy in the (hidden)
    // main feed would silently dismiss the wrong one instead of revealing
    // the one actually under the cursor.
    if (_revealedMsgId === mid && _revealedRootId === rootId) dismissRevealedActions();
    else revealMessageActions(mid, rootId);
  });
}
export const _bindMessageActionsContextMenu = bindMessageActionsContextMenu;

/**
 * UN-120 (DI-120b) — axis-locked swipe, SUPPLEMENTING long-press (which
 * stays exactly as it is, above — it covers up to 6 actions; a 2-direction
 * swipe can only cover 2). Reuses the long-press's own dead zone
 * (LONG_PRESS_THRESHOLD_PX, 8px) to pick an axis, then commits once the
 * horizontal delta reaches SWIPE_THRESHOLD_PX (~40px). A swipe is only ever
 * detected WHILE a long-press for the same touch could still fire: crossing
 * the 8px dead zone already cancels the pending long-press via its own
 * touchmove handler (registered first, so it always runs first on a shared
 * touchmove event) well before 40px is reached; committing here also
 * explicitly cancels it, so cancellation holds regardless of listener
 * registration order.
 *   Left → Right = open reply (openReplyFor — the SAME function the ↩
 *     button's click handler calls).
 *   Right → Left = open the reaction picker (openReactPickerFor — reveals
 *     .chat-actions, then calls the SAME toggleMessageReactPicker() the +
 *     button's click handler calls).
 * The dead zone before an axis commits is what keeps this from stealing
 * vertical scroll — a vertical drag is classified 'y' at 8px, and the 'x'
 * branch below never runs for it.
 */
function bindMessageSwipe(root) {
  if (!root || root._swipeWired) return;
  root._swipeWired = true;
  const surface = surfaceForRoot(root);   // DI-125a — see surfaceForRoot()
  let start = null, targetMid = null, axis = null, committed = false;
  root.addEventListener('touchstart', e => {
    if (e.touches?.length !== 1) return;
    const msgEl = e.target.closest?.('.chat-msg');
    if (!msgEl) return;
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    targetMid = msgEl.dataset.mid;
    axis = null;
    committed = false;
  }, { passive: true });
  root.addEventListener('touchmove', e => {
    if (!start || committed || !targetMid) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (axis === null && (Math.abs(dx) > LONG_PRESS_THRESHOLD_PX || Math.abs(dy) > LONG_PRESS_THRESHOLD_PX)) {
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis === 'x' && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      committed = true;
      cancelPendingLongPress();
      if (dx > 0) openReplyFor(targetMid, surface); else openReactPickerFor(targetMid, surface);
    }
  }, { passive: true });
  const clear = () => { start = null; targetMid = null; axis = null; committed = false; };
  root.addEventListener('touchend', clear);
  root.addEventListener('touchcancel', clear);
}
export const _bindMessageSwipe = bindMessageSwipe;

/**
 * DI-125a — the ONE thing that legitimately differs between the main feed and
 * the sheet: which composer/render function a gesture or button should drive.
 * Derived from the bound container's own id (a real `#chat-scroll` or
 * `#chat-sheet-scroll` node), not a second parameter every binder call site
 * would have to remember to thread through. Unset/unknown ids (incl. the
 * pre-existing test fixtures, which pass id-less fake roots) fall through to
 * 'main' — the exact prior behavior.
 */
function surfaceForRoot(root) {
  return root?.id === 'chat-sheet-scroll' ? 'sheet' : 'main';
}

/** Shared by the ↩ button's click handler AND the left-to-right swipe, in
 *  BOTH surfaces (DI-120b / DI-125b: "reuse the existing data-reply handler
 *  path"). `surface` picks which reply state/composer/render function reacts
 *  — U.replyTo/#chat-input/renderChatPage() for the main feed, U.sheetReplyTo/
 *  #chat-sheet-input/renderSheetComposer() for the sheet — deliberately
 *  SEPARATE reply-target fields (see the module docstring's DI-125 note) so a
 *  reply started in one surface can never leak into the other's composer. */
function openReplyFor(mid, surface = 'main') {
  if (surface === 'sheet') {
    U.sheetReplyTo = mid;
    renderSheetComposer();
    document.getElementById('chat-sheet-input')?.focus();
    return;
  }
  U.replyTo = mid; U.tagStripped = false;
  renderChatPage();
  document.getElementById('chat-input')?.focus();
}
export function _replyTarget() { return U.replyTo; }
export function _sheetReplyTarget() { return U.sheetReplyTo; }

/** Shared by the + button's click handler AND the right-to-left swipe, in
 *  BOTH surfaces (DI-120b / DI-125b: "reuse the existing data-react-open /
 *  toggleMessageReactPicker path"). Reveals .chat-actions first, SCOPED to
 *  the right container (DI-125a) — the picker is appended as ITS child and
 *  anchors to it (styles.css), which requires it to be display:flex, not
 *  display:none, to render/position at all. */
function openReactPickerFor(mid, surface = 'main') {
  if (!me()) return;
  const rootId = surface === 'sheet' ? 'chat-sheet-scroll' : 'chat-scroll';
  revealMessageActions(mid, rootId);
  const btn = document.querySelector(`#${rootId} .chat-msg[data-mid="${mid}"] [data-react-open]`);
  if (btn) toggleMessageReactPicker(btn, mid, surface === 'sheet' ? renderSheetMessages : renderChatPage);
}

// Dismiss on tap-elsewhere, Escape, or scrolling — the three closer paths
// DI-120a names for the new right-click reveal ("clicking elsewhere,
// pressing Escape, or scrolling dismisses it"). Click/Escape are wired once
// on `document` (never replaced by a re-render, unlike #chat-scroll itself);
// scrolling is wired per-render inside bindChatPageEvents via
// onChatScrollEvent, below, because #chat-scroll IS replaced on every
// re-render and a listener bound to a detached node would go stale.
let _revealCloserWired = false;
function wireRevealCloser() {
  if (_revealCloserWired || typeof document === 'undefined') return;
  _revealCloserWired = true;
  document.addEventListener('click', e => {
    if (!_revealedMsgId) return;
    if (e.target.closest?.(`.chat-msg[data-mid="${_revealedMsgId}"]`)) return;
    dismissRevealedActions();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') dismissRevealedActions();
  });
}
export const _wireRevealCloser = wireRevealCloser;

/** Pure: what the .chat-scroll 'scroll' listener does, minus the DOM lookup
 *  for the container itself — factored out so it is testable without a live
 *  scroll container (DI-120a: scrolling is one of the three named ways to
 *  dismiss a revealed message's actions). */
function onChatScrollEvent(scrollEl, jumpEl) {
  if (_revealedMsgId) dismissRevealedActions();
  if (!jumpEl || !scrollEl) return;
  const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
  jumpEl.style.display = nearBottom ? 'none' : 'block';
}
export const _onChatScrollEvent = onChatScrollEvent;

function maybeMentionMenu(input) {
  const menu = document.getElementById('chat-mention-menu');
  if (!menu) return;
  const m = /@([\w.']*)$/.exec(input.value.slice(0, input.selectionStart ?? input.value.length));
  if (!m) { menu.style.display = 'none'; return; }
  const cands = mentionCandidates(m[1]);
  if (!cands.length) { menu.style.display = 'none'; return; }
  menu.innerHTML = cands.map(cd => `<button class="chat-mention-opt" data-mention="${esc(cd.name)}">@${esc(cd.name)}</button>`).join('');
  menu.style.display = 'flex';
  menu.querySelectorAll('[data-mention]').forEach(b => b.addEventListener('click', () => {
    input.value = input.value.replace(/@[\w.']*$/, '@' + b.dataset.mention + ' ');
    menu.style.display = 'none';
    input.focus();
  }));
}

// ── Prefs panel (identity + notifications) ────────────────────────────────────
//
// Build 3, Group D (2026-09-11, DI-D4) — this panel is the player-settings
// surface DI-D4 names as the entry point for "My SCRIBE File": it is where
// `chatNick` and `accent` are edited. It already early-returns '' for an
// anonymous viewer (`if (!self) return ''`, one line down), so the new button
// is hidden while signed out with no second gate needed — the same
// `_playerPref` no-op-without-session pattern the DI cites.
//
// The button's CLICK is wired in js/app.js, delegated on `document`, for two
// reasons: this panel is re-rendered on every prefs change (a directly-bound
// listener would go stale), and importing app.js here would make chat-ui.js
// depend on the module that already imports it.
/**
 * ══ DI-182a/f (STEP 3b) — THE ALMA-MATER DROPDOWN IS *ONE* IMPLEMENTATION ════
 *
 * DI-182f is explicit: the player's self-edit row and the commissioner's
 * `showEditPlayerModal()` must be "the SAME function call — one dropdown
 * implementation, two call sites." That function is `buildAlmaMaterOptions()`,
 * and it lives in js/app.js because it reads `cachedEspnTeamsList()`, which is
 * app.js MODULE STATE (the ESPN team catalog, fetched and cached there).
 *
 * chat-ui.js CANNOT IMPORT IT. app.js already imports chat-ui.js, so the reverse
 * edge would close a cycle — the same reason the "My SCRIBE File" button a few
 * lines below has its click wired in app.js by delegation rather than here.
 * Copying the builder into this file would satisfy the letter of DI-182a and
 * break DI-182f outright: two implementations that drift the first time the
 * catalog's shape changes.
 *
 * SO app.js REGISTERS ITS OWN BUILDER, ONCE, AT INIT. Dependency injection in
 * one direction only: chat-ui.js declares what it needs, app.js supplies it, and
 * there is still exactly one `buildAlmaMaterOptions()` in the codebase with two
 * callers. Unregistered (a suite importing chat-ui.js on its own), the row falls
 * back to the player's current value as the only option — which renders
 * correctly and saves correctly, it just cannot offer the catalog.
 */
let _almaOptionsProvider = null;
export function registerAlmaMaterOptionsProvider(fn) { _almaOptionsProvider = typeof fn === 'function' ? fn : null; }
/**
 * SECURITY F-3 / DI-T7.6 (audit #10) — THE SELF-EDIT WRITER, ALSO INJECTED.
 *
 * The prefs rows used to write `savePlayer({ ...player, ...patch })`, where
 * `player` was read when the panel rendered. savePlayer() REPLACES the row, so
 * that write carried every field of a possibly-stale copy — including
 * `email`/`phone`/`phoneVerified`, which after migration 0007 project as ABSENT
 * for anyone but the commissioner. DI-T7.6's rule is that a write must never
 * carry a contact field it did not read; editing your initials has not read one.
 *
 * `patchPlayer(playerId, fields)` (js/app.js) re-reads the row at write time and
 * carries only the named keys. It is injected for the same reason the dropdown
 * builder above is: app.js imports this module, so importing app.js here would
 * close a cycle. Unregistered — a suite importing chat-ui.js on its own — the
 * rows simply do not write, which is the fail-closed direction: a self-edit that
 * silently did nothing is recoverable; one that blanked a phone number is not.
 */
let _playerPatchWriter = null;
export function registerPlayerPatchWriter(fn) { _playerPatchWriter = typeof fn === 'function' ? fn : null; }
export function _playerPatchWriterForTest() { return _playerPatchWriter; }
export function _almaOptionsProviderForTest() { return _almaOptionsProvider; }
function almaOptionsHTML(current) {
  if (_almaOptionsProvider) {
    try { return _almaOptionsProvider(current); }
    catch (e) { console.warn('[chat-ui] the alma-mater options provider failed', e); }
  }
  const cur = (current || '').trim();
  return `<option value="">— None —</option>${cur ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''}`;
}

function prefsPanelHTML() {
  const self = me();
  if (!self) return '';
  const prefs = getNotifPrefs();
  const accent = getAccent();
  const player = getPlayer(self);
  return `
  <div class="card mb-md chat-prefs">
    <div class="chat-prefs-row"><label>Display name</label>
      <input class="form-input" id="pref-nick" maxlength="16" value="${esc(getChatNick() || '')}" placeholder="${esc(getPlayer(self)?.displayName || '')}" /></div>
    <!-- ── DI-182a (Step 3b) — the two league-identity rows ──────────────────
         NAMED LIMITATION, carried over from the DI verbatim rather than quietly
         dropped: housing a LEAGUE-IDENTITY edit inside a panel titled around
         chat preferences is not ideal information architecture. It is the
         correct choice for THIS build because it is the only self-service
         surface that exists; a proper "My Profile" page is the natural
         follow-up once League Home has a settings destination of its own.
         Note that player.initials has existed on the data model (data-model.js's
         getPlayerInitials()) with NO editable UI anywhere — commissioner or
         player — until now.
         NO BACKTICKS IN HERE: this markup lives inside a template literal, and
         a backtick closes it. The SCRIBE-file comment below carries the same
         warning; the first draft of this block ignored it and every module that
         imports chat-ui.js failed to parse. -->
    <div class="chat-prefs-row"><label>Initials</label>
      <input class="form-input" id="pref-initials" maxlength="3" autocapitalize="characters" spellcheck="false"
             value="${esc(player?.initials || '')}" placeholder="${esc((player?.displayName || '').charAt(0).toUpperCase())}" /></div>
    <div class="chat-prefs-row"><label>Alma mater</label>
      <select class="form-input" id="pref-alma">${almaOptionsHTML(player?.almaMater || '')}</select></div>
    <div class="chat-prefs-row"><span class="text-muted" style="font-size:.75rem">Your commissioner can also set this for you.</span></div>
    <div class="chat-prefs-row"><label>Accent</label>
      <div class="chat-accent-row">${ACCENTS.map(a =>
        `<button class="chat-accent-swatch${a === accent ? ' active' : ''}" data-accent="${a}" style="background:${a}"></button>`).join('')}
        <button class="chat-accent-swatch chat-accent-none${!accent ? ' active' : ''}" data-accent="" title="Default">∅</button></div></div>
    <!-- ── THREE ROWS HIDDEN 2026-09-24 (Option A, Drew) ─────────────────────
         "Toasts" (pref-toasts), "Stays for" (pref-toast-duration, 3s/6s/10s/
         Until dismissed) and "Sound" (pref-sound) all governed the in-app
         chat toast and its chirp. Both are production-unreachable as of this
         pass, so all three controls became switches that do nothing — which
         is worse than an absent control: the player flips one, nothing
         changes, and concludes the app is broken.
         HIDDEN, NOT DELETED, and the STORAGE DEFAULTS ARE UNTOUCHED
         (storage.js getNotifPrefs(): sound/toasts/systemEvents/toastDuration
         all still default and round-trip — CONVENTIONS #10, old player
         records must not change behaviour, and systemEvents below is still
         live and reads from the same blob).
         WHOSE CALL THE REMOVAL IS: user-experience owns whether these rows
         come back in some form, disappear for good, or are replaced by a push
         preference. This pass only stops them lying. Do not delete the
         storage keys without that input.
         NO BACKTICKS IN HERE — this markup is inside a template literal. -->
    <div class="chat-prefs-row"><label>League events</label><input type="checkbox" id="pref-sys" ${prefs.systemEvents ? 'checked' : ''}></div>
    <!-- Build 3, Group D (2026-09-11, DI-D4) — the entry point to "My SCRIBE
         File." Rationale in the JS comment above this function; note that
         this markup lives inside a template literal, so no backticks. -->
    <div class="chat-prefs-row"><label>SCRIBE</label>
      <button class="btn btn-secondary btn-sm" id="scribe-file-btn" data-scribe-file="1">📁 My SCRIBE File</button></div>
  </div>`;
}
// Test-only seam (same convention as `_quoteHTMLForTest`/`_messageHTMLForTest`)
// — DI-D4's "signed out hides the entry point entirely" is a claim about
// what this function RENDERS, and groupdtest.mjs asserts it against the real
// output rather than against a grep of the source (RG-27).
export const _prefsPanelHTMLForTest = prefsPanelHTML;

/** Test-only seam, the same convention `_prefsPanelHTMLForTest` uses and for the
 *  same reason (RG-27): DI-182a's self-edit rows are asserted against the REAL
 *  binding rather than by calling the writer the binding happens to use. Without
 *  it, a mutation that put the whole-row spread BACK at the call site inside
 *  saveSelfField() left authtest green — the suite was exercising patchPlayer()
 *  and not the one line that decides what patchPlayer() is handed. Production
 *  reaches bindPrefsPanel() through renderChatPage() and nothing else. */
export const _bindPrefsPanelForTest = () => bindPrefsPanel();

function bindPrefsPanel() {
  document.getElementById('pref-nick')?.addEventListener('change', e => { setChatNick(e.target.value); renderChatPage(); });
  // ── DI-182a (Step 3b) — the two league-identity rows ──────────────────────
  // Both write the SAME fields the commissioner's Edit Player modal writes,
  // through the SAME injected field patch (js/app.js's patchPlayer(), security
  // F-3 / DI-T7.6 — NOT a whole-row savePlayer()). DI-182a's own ruling on
  // conflicts, stated so nobody builds more than was asked for: "whichever saves
  // last wins, identically to how two people editing the same Sheet row behave
  // today. No new conflict-resolution logic is being built for this."
  const saveSelfField = (patch) => {
    const self = me();
    if (!self) return;                       // anonymous viewers never reach this panel anyway
    // A FIELD PATCH, not a whole-row write. `patch` here is always exactly one
    // key — `initials` or `almaMater` — so the contact fields are provably not
    // in it, and patchPlayer() re-reads the row at write time rather than
    // trusting the copy this panel rendered from. See registerPlayerPatchWriter
    // above for why it arrives by injection instead of by import.
    if (!_playerPatchWriter) {
      console.warn('[chat-ui] no player-patch writer is registered; the self-edit was NOT saved (fail-closed: a write that did nothing is recoverable, one that blanked a contact field is not)');
      return;
    }
    _playerPatchWriter(self, patch);
  };
  document.getElementById('pref-initials')?.addEventListener('change', e => {
    // Trimmed + uppercased to match getPlayerInitials()'s own fallback, which
    // uppercases the first letter of the display name — otherwise a player who
    // types "dh" gets a lowercase avatar next to five uppercase ones.
    saveSelfField({ initials: String(e.target.value || '').trim().toUpperCase().slice(0, 3) });
    renderChatPage();
  });
  document.getElementById('pref-alma')?.addEventListener('change', e => {
    // The VALUE is `location`, the same field parseAndReport() stores as
    // game.homeTeam/awayTeam — so Alma Mater Watch's exact-equality match
    // applies to whatever is saved here, exactly as it does to the
    // commissioner's override. Same field, same shape, same function.
    saveSelfField({ almaMater: String(e.target.value || '') });
    renderChatPage();
  });
  document.querySelectorAll('[data-accent]').forEach(b => b.addEventListener('click', () => { setAccent(b.dataset.accent || null); renderChatPage(); }));
  // The pref-toasts / pref-toast-duration / pref-sound handlers were removed
  // with their rows (2026-09-24, Option A) — see prefsPanelHTML(). The `?.`
  // would have made them harmless no-ops, but a listener bound to an id that
  // this file no longer renders is a false lead for the next reader.
  document.getElementById('pref-sys')?.addEventListener('change', e => { setNotifPrefs({ systemEvents: e.target.checked }); renderChatPage(); });
}

// ── Game-card bubble + bottom sheet ───────────────────────────────────────────
/**
 * Item B — three visually distinct states (not just a boolean "has
 * unread"), and the bubble shows UNREAD count, not the thread's total
 * message count (the old render used `n`, the total — it lied the moment you
 * had read even one message).
 *
 * Attribution (who the unread is FROM) mirrors the emoji-reaction pattern
 * (`.reaction-chip`'s `title`) — chosen, deliberately, as OPTION 2 of the
 * spec's three acceptable answers, not option 1. That pattern IS a bare
 * `title` attribute, and tooltips do not fire on touch — we hit this exact
 * gap with the Records pill in batch 2. Reusing it verbatim would ship a
 * desktop-only affordance while implying it works on a phone. So: `title`
 * for desktop hover, PLUS the same names in `aria-label` so the information
 * is available on every device via assistive tech (VoiceOver/TalkBack read
 * aria-label on focus/tap). Known, documented gap: a SIGHTED touch-only user
 * still has no *visual* peek at who without opening the thread — tapping the
 * bubble already does that (its primary action), so the practical cost is
 * low, but it is real and is not silently papered over here.
 */
export function gameChatBubbleHTML(gameId) {
  if (!isChatEnabled()) return '';
  const self = me();
  const n = getMessages({ tag: gameId, types: ['message'], respectRetention: true }).filter(m => !m.deleted).length;
  const u = unreadForRender(self, gameId);
  const unread = u.known ? Number(u.count) : 0;
  const state = unread > 0 ? 'unread' : (n > 0 ? 'read' : 'empty');
  const badge = unreadBadgeText(u);
  const countHTML = badge ? ` <span class="chat-bubble-count">${badge}</span>` : '';
  let text;
  if (unread > 0) {
    const names = self ? unreadAuthors(self, gameId).map(nameOf) : [];
    text = names.length
      ? `${unread} unread from ${names.join(', ')}`
      : `${unread} unread`;
  } else if (n > 0) {
    text = 'Game thread — all caught up';
  } else {
    text = 'Game thread — no messages yet';
  }
  return `<button type="button" class="chat-bubble-btn chat-bubble-${state}" data-chat-game="${esc(gameId)}"
    title="${esc(text)}" aria-label="${esc(text)}">💬${countHTML}</button>`;
}

/**
 * DI-125b — the sheet's own reply banner + composer, same shape as the main
 * feed's (`.chat-replying`, reused verbatim from styles.css) but reading
 * `U.sheetReplyTo` instead of `U.replyTo`. A separate function (not inlined
 * into `openGameChatSheet()`'s one-time template) because it needs to
 * re-render on its own — starting/cancelling a reply must update the
 * composer WITHOUT re-fetching and redrawing the whole message list.
 */
function sheetComposerHTML() {
  if (!me()) return '';
  const replyMsg = U.sheetReplyTo ? getMessage(U.sheetReplyTo) : null;
  return `<div class="chat-composer" id="chat-sheet-composer">
    ${replyMsg ? `<div class="chat-replying">↩ replying to <strong>${esc(nameOf(replyMsg.author))}</strong>: ${esc(replyMsg.body.slice(0, 60))}
      <button id="chat-sheet-cancel-reply">✕</button></div>` : ''}
    <div class="chat-composer-row">
      <textarea class="chat-input" id="chat-sheet-input" rows="1" maxlength="1000" placeholder="Message this game's thread…"></textarea>
      <button class="chat-send-btn" id="chat-sheet-send">➤</button>
    </div>
  </div>`;
}

function sendSheetMessage() {
  const gameId = U.sheetGameId;
  if (!gameId) return;
  const inp = document.getElementById('chat-sheet-input');
  const body = (inp?.value || '').trim();
  const self = me();
  if (!body || !self) return;
  const sentId = sendMessage({ body, gameTag: gameId, replyTo: U.sheetReplyTo || '', author: self, mentions: extractMentions(body) });
  try { scribeInspectMessage({ author: self, authorName: nameOf(self), body, gameTag: gameId, triggerMessageId: sentId }); } catch {}
  if (inp) inp.value = '';
  U.sheetReplyTo = null;
  renderSheetComposer();
  renderSheetMessages();
}

function bindSheetComposer() {
  document.getElementById('chat-sheet-send')?.addEventListener('click', sendSheetMessage);
  document.getElementById('chat-sheet-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width:700px)').matches) { e.preventDefault(); sendSheetMessage(); }
  });
  document.getElementById('chat-sheet-cancel-reply')?.addEventListener('click', () => { U.sheetReplyTo = null; renderSheetComposer(); });
}

/** Composer-only refresh (DI-125b) — same outerHTML-swap-then-rebind shape as
 *  renderPillsOnly() uses for the pills row, chosen for the same reason:
 *  starting/cancelling a reply shouldn't re-fetch or redraw the message list. */
function renderSheetComposer() {
  const host = document.getElementById('chat-sheet-composer');
  if (!host) return;
  host.outerHTML = sheetComposerHTML();
  bindSheetComposer();
}

export function openGameChatSheet(gameId) {
  if (!isChatEnabled()) { redirectChatDisabled(); return; }
  U.sheetGameId = gameId;
  U.sheetReplyTo = null;
  document.getElementById('chat-sheet-wrap')?.remove();
  const found = gameById(gameId);
  const wrap = document.createElement('div');
  wrap.id = 'chat-sheet-wrap';
  const g = found?.game;
  const score = g && g.homeScore != null ? `${esc(g.awayScore)}–${esc(g.homeScore)}` : '';
  const firstUse = !lsGet('cfbp_chat_sheet_hint');
  const selfForHeader = me();
  const myHeaderPick = (selfForHeader && found) ? getPicks(found.week.weekId, selfForHeader).find(p => p.gameId === gameId) : null;
  const headerCls = gameThreadHeaderClass(myHeaderPick, g);
  wrap.innerHTML = `
    <div class="chat-sheet-backdrop"></div>
    <div class="chat-sheet">
      <div class="chat-sheet-header${headerCls}">
        <div><div class="chat-sheet-title">${g ? esc(g.awayTeam) + ' @ ' + esc(g.homeTeam) : 'Game thread'}</div>
          <div class="chat-sheet-sub">${g ? esc(formatSpread(g.lockedSpread ?? g.spread, g.favorite, g) || '') : ''}
            ${g?.status === GAME_STATUS.LIVE ? ` · <span class="live-pulse"></span> LIVE ${score}` : score ? ' · ' + score : ''}</div></div>
        <div class="chat-sheet-header-actions">
          <button class="btn btn-ghost btn-sm" id="chat-sheet-open-main">Open in chat</button>
          ${refreshControlHTML('chat-sheet-refresh')}
          <button class="chat-sheet-close" id="chat-sheet-close">✕</button>
        </div>
      </div>
      ${firstUse ? '<div class="chat-sheet-hint" id="chat-sheet-hint">Posts here also appear in the main room, tagged to this game. <button id="chat-sheet-hint-ok">Got it</button></div>' : ''}
      <div class="chat-scroll chat-sheet-scroll" id="chat-sheet-scroll"></div>
      ${sheetComposerHTML()}
    </div>`;
  document.body.appendChild(wrap);
  renderSheetMessages();
  bindSheetComposer();
  wrap.querySelector('.chat-sheet-backdrop')?.addEventListener('click', closeSheet);
  document.getElementById('chat-sheet-close')?.addEventListener('click', closeSheet);
  document.getElementById('chat-sheet-hint-ok')?.addEventListener('click', () => {
    lsSet('cfbp_chat_sheet_hint', '1');
    document.getElementById('chat-sheet-hint')?.remove();
  });
  document.getElementById('chat-sheet-open-main')?.addEventListener('click', () => { closeSheet(); U.filter = gameId; navToChat(); });
  document.getElementById('chat-sheet-refresh-btn')?.addEventListener('click', onChatRefreshTap);
  markSeen(gameId);
  updateChatBadges();
}
function closeSheet() {
  // DI-125a: the message currently revealed (if any) is about to have its DOM
  // removed if it belongs to THIS sheet — dismiss it explicitly rather than
  // leaving `_revealedRootId` pointed at a container that no longer exists.
  if (_revealedRootId === 'chat-sheet-scroll') dismissRevealedActions();
  U.sheetGameId = null;
  U.sheetReplyTo = null;
  document.getElementById('chat-sheet-wrap')?.remove();
}

/**
 * DI-125a — scrolling the sheet dismisses a revealed message, same as
 * onChatScrollEvent already does for #chat-scroll (bindChatPage, above). This
 * needs its OWN idempotent guard, unlike #chat-scroll's inline listener: DOM
 * `scroll` events do not bubble, so the listener must be bound directly to
 * the scrolling element, and — unlike #chat-scroll, which is a fresh node on
 * every renderChatPage() — #chat-sheet-scroll is the SAME node across every
 * renderSheetMessages() call (only its innerHTML is replaced), so binding
 * without a guard would stack a new listener on every poll. There is no
 * "jump to latest" button in the sheet; onChatScrollEvent already no-ops
 * that half when passed `null`.
 */
function bindSheetScrollDismiss(root) {
  if (!root || root._scrollDismissWired) return;
  root._scrollDismissWired = true;
  root.addEventListener('scroll', () => onChatScrollEvent(root, null));
}

function renderSheetMessages() {
  _abbrMemo.clear();                                 // per-pass cache only (see abbrMapFor)
  const host = document.getElementById('chat-sheet-scroll');
  if (!host || !U.sheetGameId) return;
  const self = me();
  // Retention applies here too — otherwise a player could dodge the window by
  // opening a game's bottom sheet instead of the main room (UN-88).
  const list = coalesceStream(filterSupersededScribeAcks(getMessages({ tag: U.sheetGameId, respectRetention: true })));
  host.innerHTML = list.length
    ? list.map(item => item.kind === 'gamereact-run' ? gamereactRunHTML(item) : messageHTML(item, self, false)).join('')
    : '<div class="chat-empty">No entries for this game yet.</div>';
  host.scrollTop = host.scrollHeight;
  host.querySelectorAll('[data-react]').forEach(b => b.addEventListener('click', () => {
    if (!self) return; toggleReact(b.dataset.target, b.dataset.react, self); renderSheetMessages();
  }));
  host.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => { retryFailed(b.dataset.retry); renderSheetMessages(); }));
  // DI-125a/b — the SAME reveal gestures and the SAME action-button wiring
  // the main feed uses, delegated on THIS container. `host` persists across
  // repeat renderSheetMessages() calls, so the three gesture binders' own
  // `_xWired` guards (and bindSheetScrollDismiss's matching one) make every
  // call after the first a no-op; the per-message action buttons are
  // re-bound every call because those specific elements ARE destroyed and
  // recreated by the innerHTML swap above (same reason [data-react]/
  // [data-retry], just above, were already re-bound every call before this
  // batch).
  bindMessageActionsLongPress(host);
  bindMessageActionsContextMenu(host);
  bindMessageSwipe(host);
  bindSheetScrollDismiss(host);
  bindMessageActionButtons(host, renderSheetMessages, 'sheet');
}
/**
 * Test-only (same convention as `_messageHTMLForTest`/`_showToastForTest` —
 * thin setup + delegate to the REAL function) — so loadtest can drive the
 * ACTUAL `renderSheetMessages()`, including its DI-125 wiring, without also
 * having to simulate `openGameChatSheet()`'s unrelated chrome (header,
 * backdrop, first-use hint) just to reach it.
 */
export function _renderSheetMessagesForTest(gameId) {
  U.sheetGameId = gameId;
  renderSheetMessages();
}

// ── The device's chat acknowledgement cursor ─────────────────────────────────
/**
 * RENAMED 2026-09-24 (Option A, Drew) — this family used to be called
 * `TEASER_DISMISS_KEY` / `teaserDismissedSeq()` / `setTeaserDismissedSeq()`,
 * after the dashboard teaser that was retired in the same pass. The names were
 * already wrong before that: RG-25 made this the SHARED "acknowledged through
 * seq N" cursor, and notifAckThroughSeq() below has consulted it ever since. (CORRECTED at the
 * 840406d review, 2026-09-24: the unread math does NOT read it — its one caller
 * is showToast(), now production-unreachable — so the whole family is dormant.
 * It is kept because six live devices hold a cursor under the key and because
 * it is the write target if a preview surface ever returns.) A reader arriving after the
 * teaser's deletion would have seen "teaser" in three identifiers with no
 * teaser left in the file and deleted them as residue, silently breaking
 * general unread counting. Renamed to say what they are.
 *
 * THE STORED KEY STRING IS DELIBERATELY UNCHANGED. Every device in the league
 * already has a cursor under `cfbp_chat_teaser_dismiss_seq`; renaming the
 * string would reset all six to "never acknowledged" and re-announce mail
 * those players have already read. The identifier is cosmetic, the string is
 * data (CONVENTIONS #10 — old records must not change behavior).
 *
 * Device-local (AD-12, widened v0.17.2 — a per-screen UI hint whose loss costs
 * nothing but a repeat, and whose sync would write-amplify for no shared
 * benefit). Stores the SEQ, not a boolean, so "genuinely new activity since
 * acknowledgement" is a plain number comparison that survives reloads.
 */
const CHAT_ACK_SEQ_KEY = 'cfbp_chat_teaser_dismiss_seq';   // string frozen — see above
function chatAckSeq() {
  const n = Number(lsGet(CHAT_ACK_SEQ_KEY));
  return Number.isFinite(n) ? n : -1;   // -1 = never acknowledged
}
/**
 * RG-25 — this watermark is the ONE "I have acknowledged notifications through
 * seq N" state for this device. It was introduced because the two surfaces
 * that announced a new message — the floating toast and the dashboard teaser —
 * kept two independent dismissal states for one concept (the toast's was a DOM
 * node that vanished with the tab; the teaser's was this key), so dismissing
 * the toast on Standings left the very same message announced again by the
 * teaser on Dashboard. Same shape as AD-20 — two representations of one
 * concept drift — applied to a UI state instead of a lookup table.
 *
 * BOTH OF THOSE SURFACES ARE RETIRED (Option A, Drew 2026-09-24) AND THIS
 * CURSOR IS NOT. It outlived them because it was never really theirs:
 * notifAckThroughSeq() below is DORMANT (its only caller is the production-
 * unreachable showToast(); the unread math never reads it — verified at review
 * 2026-09-24). The only writers are the unreachable toast's ✕ and the now-no-op
 * _clearToastsForChatPage(). Kept for the six live device cursors under the
 * unchanged key string, and as the write target if a preview returns. Do not delete it as teaser
 * residue — that is the defect this rename exists to prevent.
 *
 * MONOTONIC. Nothing in this app legitimately rewinds a cursor (RG-14); with
 * two writers instead of one, an out-of-order write could otherwise
 * un-dismiss something the player already dealt with.
 */
function setChatAckSeq(seq) {
  lsSet(CHAT_ACK_SEQ_KEY, String(Math.max(Number(seq) || 0, chatAckSeq())));
}
/**
 * The ONE "this device has acknowledged notifications through seq N" value,
 * read by both announcing surfaces. TWO things acknowledge a message, and
 * only one of them was ever consulted here:
 *
 *  1. an explicit ✕ on the toast or the teaser  -> chatAckSeq()
 *  2. READING THE ROOM                          -> getLastSeen().seq
 *
 * Drew, live v0.19.0 (2026-09-10): "the chat function keeps popping up the
 * most recent message at the top of the dashboard regardless of how many
 * times I click into it … it starts off blank, and then will populate all of
 * the messages and I will re-get the current in-app notification." Opening the
 * room is the most complete form of reading a message there is, and it left
 * (1) untouched — so every return to the Dashboard, and every post-reload
 * backfill (the fold is rebuilt from the transport on every boot, so the
 * re-announcement rides in with the messages), re-announced something already
 * read. The floating toast never had this bug because initChatUI()'s
 * subscriber already gates it on `latest.seq > getLastSeen().seq`; the teaser
 * was the one surface that consulted only half the state.
 *
 * Derived, not a third stored watermark — a stored copy is exactly the
 * two-representations-of-one-concept drift AD-20/RG-25 warn about. MONOTONIC
 * by construction (RG-14): both inputs are monotonic and max() of two
 * monotonic values is monotonic, so neither half can un-acknowledge what the
 * other already acknowledged.
 *
 * The read half is TAG-AWARE, and that is the whole of the follow-up fix.
 * Read state is two-level: markSeen('all') advances the room cursor,
 * markSeen(gameId) — what openGameChatSheet() calls — advances `byTag` only.
 * Consulting `.seq` alone meant a message read inside its own game thread
 * still counted as unacknowledged here, so the teaser re-announced the exact
 * message the unread badge had already zeroed. `readThroughSeq(tag)` is
 * chat.js's single definition of that cursor — not a copy of the expression.
 *
 * Note what this deliberately does NOT do: reading game thread g1 raises the
 * watermark for messages tagged g1 and nothing else, so an unrelated unread
 * room message is still announced (it just falls through to that message
 * instead of re-announcing the one that was read).
 */
function notifAckThroughSeq(tag = 'all') {
  return Math.max(chatAckSeq(), readThroughSeq(tag));
}
// Test-only accessors (underscore-prefixed per this file's convention — see
// _toastWouldSuppress, _reactionsHTML) so loadtest drives the real shared
// state rather than a re-implementation of it. `_notifAckSeq` is deliberately
// the DISMISSAL watermark alone — RG-25's assertions are about what an
// explicit ✕ writes — while `_notifAckThroughSeq` is the derived gate the
// surfaces actually read.
export function _notifAckSeq() { return chatAckSeq(); }
export function _notifAckThroughSeq(tag = 'all') { return notifAckThroughSeq(tag); }
export function _ackNotif(seq) { setChatAckSeq(seq); }

/**
 * ══ RETIRED 2026-09-24 — THE DASHBOARD CHAT TEASER (DI-93 / UN-93) ══════════
 *
 * `dashboardChatTeaserHTML()` and `bindDashboardTeaser()` lived here. They
 * rendered `#dash-chat-teaser`: a dashboard card carrying another member's
 * name and the first 64 characters of what they wrote.
 *
 * WHY IT IS GONE, AND WHY THAT IS NOT A REVERSAL OF DI-93. The card was built
 * in v0.17.3 (2026-08-07) precisely because there was no other channel to tell
 * a signed-in player that something had happened while they were out of the
 * room. Push did not exist yet. It does now, on both platforms, as of
 * 2026-09-23 (DI-217/239/240/241). A surface built to fill a gap outlives its
 * reason when the gap closes. Drew, 2026-09-24: "retire chat card now", chat
 * notifications "should all be through onesignal or native via ios", "we can
 * keep the badges on the chat icon for unread messages."
 *
 * WHAT CARRIES THE NOTICE NOW: the OS push banner, and — on a device without
 * push — the chat nav pill's unread badge (updateChatBadges(), untouched and
 * independent of everything deleted here). That badge is a COUNT, not text:
 * no message content is previewed anywhere outside the Locker Room.
 *
 * DO NOT REBUILD IT WITHOUT A NEW DESIGN INPUT. If a push-less device is later
 * judged to need more than a count, that is a `user-experience` question about
 * what to show, not a revert of this deletion.
 *
 * The acknowledgement cursor this used to share (chatAckSeq(), above) SURVIVES
 * — see its rename note for why deleting it alongside this would have broken
 * unread counting generally.
 */

// ── Legacy alias (app.js compatibility) ───────────────────────────────────────
export function setChatChannel(ch) {
  if (!ch || ch === 'general' || ch === 'all') U.filter = 'all';
  else if (ch.startsWith('game:')) U.filter = ch.slice(5);
  else U.filter = ch;
}

// ── System event emitters (deterministic ids — AD-11) ─────────────────────────
// HARD RULE: nothing may reveal a player's selections before that week locks.

export function emitPicksLockedEvent(weekId, playerId, count, total) {
  sendEvent({
    id: `sys_lock_${weekId}_${playerId}`, type: 'system', author: 'system', notify: false,
    body: `${nameOf(playerId)} locked ${count}/${total}`,
    meta: { kind: 'picksLocked', weekId, playerId },
  });
}

/** THE PICK REVEAL RITUAL — at lock, one system event posts everyone's full
 *  picks simultaneously. The one guaranteed weekly all-hands moment. */
export function emitPickRevealEvent(week) {
  if (!week) return;
  // UN-116 — was 'never pre-lock'; now never before the picks are public at
  // all. Drew chose to move the ritual to kickoff rather than loosen the
  // dashboard to lock, so the room never publishes what the dashboard hides.
  if (!arePicksPublic(week)) return;
  const games = getGames(week.weekId).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  if (!games.length) return;
  const players = getPlayers().filter(p => p.active);
  // Shorthand for the reveal grid comes from the shared table, built over THIS
  // slate so the dedup pass guarantees no two teams in the grid collapse to the
  // same cell. This event is written once under a deterministic id into an
  // append-only log — whatever text it carries is permanent, so an ambiguous
  // abbreviation here could never be corrected. The retired
  // `selectedTeam.split(' ').pop()` heuristic rendered both "Arkansas State"
  // and "Ohio State" as "State", making the row unreadable.
  const revealAbbr = buildAbbrMap(games);
  const lines = players.map(p => {
    const picks = getPicks(week.weekId, p.playerId);
    if (!picks.length) return `${nameOf(p.playerId)} — no picks on file`;
    const parts = games.map(g => {
      const pk = picks.find(x => x.gameId === g.gameId);
      return pk ? (revealAbbr.get(pk.selectedTeam) || pk.selectedTeam) : '—';
    });
    return `${nameOf(p.playerId)}: ${parts.join(' · ')}`;
  });
  sendEvent({
    id: `sys_reveal_${week.weekId}`, type: 'system', author: 'system', notify: true,
    body: lines.join('\n'),
    meta: { kind: 'reveal', weekId: week.weekId, title: `${formatWeekLabel(week)} — the picks are in` },
  });
  // ── RAISE SITE REMOVED 2026-09-24 (Option A, Drew) ────────────────────────
  // This line called showToast({author:'system', body:'🔓 … picks revealed'}).
  //
  // It is the exact banner Drew reported in R10 ("League just sent a
  // notification that the picks are in, and it popped up as a banner in the
  // app"). DI-N3 answered that by removing its `{force:true}` and putting it
  // behind the push-active gate; Option A finishes the job — the in-app toast
  // surface is retired outright, so a system announcement has no more claim on
  // it than a message preview does.
  //
  // NOTHING IS LOST FROM THE RECORD. sendEvent() above posts the reveal into
  // the Locker Room as a `notify: true` system event, so it still drives the
  // chat unread badge and is still there to read. What disappears is only the
  // floating copy of it.
}

export function emitKickoffEvent(game) {
  sendEvent({
    id: `sys_kick_${game.gameId}`, type: 'system', author: 'system', notify: false,
    gameTag: game.gameId,
    body: `🏈 Kickoff — ${game.awayTeam} @ ${game.homeTeam} ${formatSpread(game.lockedSpread ?? game.spread, game.favorite, game) || ''}`,
    meta: { kind: 'kickoff', gameId: game.gameId },
  });
}

export function emitGameFinalEvent(game, atsWinner, winnerIds = [], loserIds = []) {
  // RG-45 — the THIRD sibling in this block, and the only one that asked
  // nothing. This posts full per-game pick attribution BY NAME ("— right:
  // Brayden, Kevin; wrong: Koby, Jacob") into the public room, while
  // emitPickRevealEvent and emitExtraPointEvent above/below both gate on
  // arePicksPublic().
  //
  // Reachable without anyone doing anything unusual: a week left OPEN with
  // picksLockAt still in the future while ESPN marks its games final.
  // canPlayerSubmitPicks() returns allowed on exactly that state, and
  // doRefreshScores() — the 60-second auto-refresh loop, no human in the
  // loop — fires this on the scheduled→final transition.
  //
  // Gates the WHOLE event, not just the `who` half, and that is deliberate.
  // The id is deterministic (sys_final_<gameId>) into an append-only log
  // (AD-26): a redacted post would consume the id, and finalizeWeek()'s later
  // re-emit of the complete event would dedupe away — losing the right/wrong
  // roster permanently. Blocking the post leaves the id unconsumed, so the
  // full event still arrives the moment the week is public. The SCRIBE callout
  // below is covered by the same return, correctly — it quotes a player who
  // lost this game ATS, which discloses that player's pick.
  if (!arePicksPublic(getWeeks().find(w => w.weekId === game?.weekId))) return;
  const cover = atsWinner === 'no_decision' ? 'Push — no decision'
    : `${atsWinner} covers ✅`;
  const who = atsWinner === 'no_decision' ? ''
    : ` — right: ${winnerIds.length ? winnerIds.map(nameOf).join(', ') : 'nobody'}; wrong: ${loserIds.length ? loserIds.map(nameOf).join(', ') : 'nobody'}`;
  sendEvent({
    id: `sys_final_${game.gameId}`, type: 'system', author: 'system', notify: false,
    gameTag: game.gameId,
    body: `FINAL: ${game.awayTeam} ${game.awayScore}–${game.homeScore} ${game.homeTeam}. ${cover}${who}`,
    meta: { kind: 'gameFinal', gameId: game.gameId },
  });
  // SCRIBE's unprompted callout: one pre-kick statement from a player who lost
  // this game ATS, quoted next to the result. Rate limits apply.
  try {
    const kicked = game.kickoff ? new Date(game.kickoff).getTime() : 0;
    const candidates = getMessages({ tag: game.gameId, types: ['message'] })
      .filter(m => !m.deleted && loserIds.includes(m.author) && kicked && (m.ts || 0) < kicked);
    if (candidates.length) {
      const pick = candidates.sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0))[0];
      scribeTrigger('callout', {
        gameTag: game.gameId, subject: game.gameId,
        quote: { id: pick.id, author: pick.author, body: pick.body.slice(0, 160) },
      });
    }
  } catch {}
}

export function emitExtraPointEvent(weekId, graded) {
  // DI-116e — this posts every player's Extra Point guess into the public room.
  // Nothing stopped a commissioner firing it while the slate was still open,
  // which would have published the whole field's guesses to players who could
  // still change their own. Same rule as every other reveal surface.
  if (!arePicksPublic(getWeeks().find(w => w.weekId === weekId))) return;
  const lines = graded.rows.map(r => {
    const label = { blackjack: '🂡 BLACKJACK', win: '✅ win', 'push-win': '✅ shared win', bust: '💥 bust', alive: 'under', 'no-entry': '—' }[r.outcome] || r.outcome;
    return `${r.displayName}: ${r.guess == null ? 'no entry' : r.guess + ' yd'} ${label}`;
  });
  sendEvent({
    id: `sys_ep_${weekId}`, type: 'system', author: 'system', notify: false,
    body: `🎯 Extra Point — actual ${graded.actual} yd\n${lines.join('\n')}${graded.allBusted ? '\nEveryone over. The house wins.' : ''}`,
    meta: { kind: 'extraPoint', weekId },
  });
  try {
    const bust = graded.rows.find(r => r.outcome === 'bust');
    const win = graded.rows.find(r => r.outcome === 'blackjack' || r.outcome === 'win' || r.outcome === 'push-win');
    if (graded.allBusted) scribeTrigger('extraPointBust', { subject: weekId, vars: { name: 'the entire cohort' } });
    else if (win) scribeTrigger('extraPointWin', { subject: weekId, vars: { name: win.displayName } });
    else if (bust) scribeTrigger('extraPointBust', { subject: weekId, vars: { name: bust.displayName } });
  } catch {}
}

export function emitWeekFinalEvent(week, rankedResults) {
  if (!rankedResults?.length) return;
  const lines = rankedResults.map(r => `${r.rank}. ${nameOf(r.playerId)} — ${r.correctPicks}`);
  sendEvent({
    id: `sys_weekfinal_${week.weekId}`, type: 'system', author: 'system', notify: false,
    body: `📊 ${formatWeekLabel(week)} final\n${lines.join('\n')}`,
    meta: { kind: 'weekFinal', weekId: week.weekId },
  });
  // Hall of Records auto-promotion: the week's top-reacted message becomes canon.
  try {
    const start = week.startDate ? new Date(week.startDate + 'T00:00:00').getTime() - 4 * 86400000 : 0;
    const end = Date.now();
    const top = getMessages({ tag: 'all', types: ['message'] })
      .filter(m => !m.deleted && m.author !== 'system' && (m.ts || 0) >= start && (m.ts || 0) <= end)
      .map(m => ({ m, n: Object.values(m.reactions || {}).reduce((a, v) => a + v.length, 0) }))
      .sort((a, b) => b.n - a.n)[0];
    if (top && top.n >= 2 && !top.m.pinned) {
      sendEvent({ id: `pin_wk_${week.weekId}`, type: 'pin', targetId: top.m.id, author: 'scribe', notify: false });
    }
  } catch {}
}

// ── SCRIBE live-game observation (rides the existing score poll) ──────────────
/** Called per game on each score refresh with the pre-update copy. */
export function scribeLiveGameCheck(prevGame, nextGame) {
  try {
    if (!nextGame || nextGame.status !== GAME_STATUS.LIVE) return;
    const found = gameById(nextGame.gameId);
    const week = found?.week || getCurrentWeek();
    const nPicks = week ? getPicks(week.weekId).filter(p => p.gameId === nextGame.gameId).length : 0;
    if (nPicks < 3) return;   // only hotly-contested, widely-picked games
    const spread = nextGame.lockedSpread ?? nextGame.spread;
    if (spread == null || nextGame.homeScore == null || prevGame?.homeScore == null) return;
    const margin = g => (g.homeScore + spread) - g.awayScore;   // >0 home covering
    const before = margin(prevGame), after = margin(nextGame);
    if (Math.sign(before) !== Math.sign(after) && before !== 0 && after !== 0) {
      scribeTrigger('coverageFlip', { gameTag: nextGame.gameId, subject: nextGame.gameId, bucketMin: 30 });
      return;
    }
    // Upset watch: the underdog leading outright by 9+
    const homeIsFav = nextGame.favorite === nextGame.homeTeam;
    const dogLead = homeIsFav ? nextGame.awayScore - nextGame.homeScore : nextGame.homeScore - nextGame.awayScore;
    if (dogLead >= 9) {
      const dog = homeIsFav ? nextGame.awayTeam : nextGame.homeTeam;
      scribeTrigger('upsetWatch', { gameTag: nextGame.gameId, subject: nextGame.gameId, bucketMin: 60, vars: { TEAM: dog } });
    }
  } catch {}
}

// ── "One year ago today" (dormant until CFP 2K27 — data exists from day one) ──
function maybeAnniversary() {
  try {
    const key = 'cfbp_scribe_anniv';
    const today = new Date().toISOString().slice(0, 10);
    if (lsGet(key) === today) return;
    const target = Date.now() - 365 * 86400000;
    const hit = getMessages({ tag: 'all', types: ['message'] })
      .filter(m => !m.deleted && m.author !== 'system' && Math.abs((m.ts || 0) - target) < 12 * 3600000)
      .sort((a, b) => Object.values(b.reactions || {}).flat().length - Object.values(a.reactions || {}).flat().length)[0];
    lsSet(key, today);
    if (hit) scribeTrigger('anniversary', {
      subject: hit.id, quote: { id: hit.id, author: hit.author, body: hit.body.slice(0, 160) },
    });
  } catch {}
}

/**
 * The onChat() subscriber wired by initChatUI(), below. Factored into a
 * named, test-exported function (same convention as
 * `_bindMessageActionButtons`/`_chatSyncBadgeHTML`) so cachetest.mjs can
 * drive DI-169d's `fromCache` guard through the REAL handler — not a
 * re-implementation of it. Behavior is otherwise unchanged from the inline
 * arrow this replaces.
 */
function handleChatEvent(kind, detail) {
  if (kind === 'events') {
    updateChatBadges();
    // ── BOTH IN-APP ANNOUNCEMENT PATHS REMOVED 2026-09-24 (Option A, Drew) ──
    //
    // What stood here:
    //
    //   1. The preview raise. Guarded by `!detail?.fromCache` (DI-169d, so a
    //      cache-primed boot never toasted a player's own backlog), it found
    //      the newest notifying message from somebody else, above the read
    //      cursor, and off the Chat tab did `showToast(latest); playBlip();`
    //      — author + 80 characters floated over whatever tab you were on,
    //      plus a chirp. This is the surface Drew reported on v0.25.1: "it's
    //      the 'Chat' notification that is showing a preview of the chat
    //      messages."
    //
    //   2. The dashboard teaser's live sync — insert/update/remove
    //      `#dash-chat-teaser` on every chat event while the Dashboard was on
    //      screen. The card it maintained is retired; see the block comment
    //      where it used to be defined.
    //
    // Push is the channel for both now. A device WITHOUT push keeps the chat
    // nav pill's unread badge — updateChatBadges(), one line above, untouched
    // — and nothing else. Drew: "we can keep the badges on the chat icon."
    //
    // DI-169d's `fromCache` distinction died with the thing it protected:
    // nothing on this path is announcement any more, and the render below has
    // always run unconditionally because instant render IS the point of the
    // cache. cachetest's DI-169d assertions now hold trivially rather than
    // conditionally, which is noted there.
    if (chatPageActive()) renderChatPage();
    if (U.sheetGameId) renderSheetMessages();
  }
  if (kind === 'offline' || kind === 'online') {
    if (chatPageActive()) renderChatPage();
  }
  // UN-112 (DI-112b) — chat.js owns the outbox/lastseen keys and clears
  // them itself before firing this; module layering means every OTHER
  // module clears only the keys IT owns, via this notification, rather
  // than chat.js reaching into them directly.
  if (kind === 'epochApplied') {
    lsRemove(CHAT_ACK_SEQ_KEY);   // same stale-cursor risk as lastseen — a dismissal from before the clear must not suppress genuinely new activity
    lsRemove('cfbp_chat_sheet_hint');   // cosmetic — let the first-use helper reappear in the freshly-cleared room
    resetScribeMemory();
    if (chatPageActive()) renderChatPage();
  }
}
export const _handleChatEventForTest = handleChatEvent;

// ── Init ──────────────────────────────────────────────────────────────────────
/**
 * Delegated chat clicks — registered by BOTH boot phases, exactly once.
 *
 * BUG-G F-2 (reviewer, 2026-09-11). This listener used to be registered only
 * in the late phase, i.e. after `await hydrateBackend()`. That was invisible
 * until BUG-G, because nothing chat-related was on screen before then. It is
 * not invisible now: #page-dashboard is statically `.active` in index.html, so
 * dashboardPageActive() is true at t=0, so the early phase's cache replay
 * inserts the dashboard teaser — carrying `data-open-chat` — during the first
 * paint. Without this, that preview sat there looking tappable and did nothing
 * for the entire hydrate window (8-26s, or forever on a failed hydrate). A
 * control that is visible but dead is worse than one that is absent: the
 * player taps it, nothing happens, and concludes chat is broken — the exact
 * report BUG-G exists to close.
 *
 * A module latch rather than an `if` at each call site: document-level
 * listeners do not de-duplicate, so a second registration would fire
 * navToChat() twice per tap (and openGameChatSheet() twice per game bubble).
 * Idempotent by construction, not by caller discipline.
 */
let _delegatedChatClicksWired = false;
function wireDelegatedChatClicks() {
  if (_delegatedChatClicksWired) return;
  _delegatedChatClicksWired = true;
  document.addEventListener('click', e => {
    const gameBtn = e.target.closest?.('[data-chat-game]');
    if (gameBtn) { e.preventDefault(); openGameChatSheet(gameBtn.dataset.chatGame); return; }
    const openChat = e.target.closest?.('[data-open-chat]');
    if (openChat) { e.preventDefault(); navToChat(); }
  });
}

/** Test hook (F-2): how many times the delegated click listener was actually
 *  registered on `document`. The latch is module-private and the listener is
 *  anonymous, so this is the only way to assert "exactly once across both
 *  phases" from outside — same precedent as chat.js's
 *  _isPollingActiveForTest() for its private S.unsub. */
export function _delegatedChatClicksWiredForTest() { return _delegatedChatClicksWired; }

/**
 * BUG-G (2026-09-11) — TWO-PHASE. app.js calls this twice per boot:
 *
 *   initChatUI({ phase: 'early' })  BEFORE `await hydrateBackend()`
 *   initChatUI()                    after it, exactly as before
 *
 * The early phase registers the UI subscriber and starts the transport +
 * device-local cache replay (chat.js's startChatTransport(), which is reads-
 * only through the storage seam). It deliberately does NOT run the rest of
 * this function: maybeAnniversary() can fire a SCRIBE trigger, i.e. a chat
 * SEND, and the outbox/epoch half of boot has to wait for the hydrated
 * settings blob. Everything below stays where it was.
 *
 * Both phases call onChat(handleChatEvent) with the same module-level
 * function reference and S.subs is a Set, so the second registration is a
 * no-op — the subscriber cannot end up wired twice.
 */
export function initChatUI(opts = {}) {
  if (opts.phase === 'early') {
    // Register BEFORE starting the engine, for the same reason the full path
    // does below: the cache replay notifies synchronously, into whatever
    // subscriber set exists at that instant.
    onChat(handleChatEvent);
    // F-2 — BEFORE the replay that renders the teaser, so the tap target is
    // live from the instant it exists rather than from the end of hydrate.
    wireDelegatedChatClicks();
    startChatTransport(me());
    updateChatBadges();
    return;
  }
  // v0.17.5 (caught in review): initChat() was called FIRST, but it synchronously
  // fires notify('epochApplied') via _applyEpochLocally() — into an empty
  // subscriber set. And because that call also stamps cfbp_chat_epoch_applied,
  // it is idempotent and can NEVER fire again for that epoch. Drew's own device
  // looked fine (startFreshChat calls the heal post-boot, when the subscriber
  // exists), so he would have verified it working while it silently did nothing
  // on the other five phones — permanently, for every future mid-season clear.
  // Register first, then boot.
  wireRevealCloser();

  onChat(handleChatEvent);

  // Boot the engine LAST — everything above is now listening.
  initChat(me());

  // Delegated clicks — already wired by the early phase on a normal boot; the
  // latch makes this a no-op there and a real registration on any path that
  // never ran an early phase (F-2).
  wireDelegatedChatClicks();

  // A MutationObserver stood here to rebind the dashboard teaser's ✕ after
  // every renderDashboard() (which replaces #page-dashboard's innerHTML
  // wholesale and wiped the listener). Removed 2026-09-24 with the card it
  // served — a document-wide childList+subtree observer is not something to
  // leave running for a control that no longer exists.

  maybeAnniversary();
  updateChatBadges();
}
