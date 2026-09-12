/**
 * CFB Pickems — App Controller v15
 *
 * One-stop place to update the user-visible version string + release date.
 * Surfaced in the footer of the Rules tab (Priority 12).
 */
export const APP_VERSION = 'v0.21.0';
export const APP_VERSION_DATE = '2026-09-11';

/**
 * UN-124 — "What's new" card content, hand-maintained per release. NOT
 * ledger-derived (docs/ never deploys) and NOT feedback-derived (feedback
 * records incoming reports, not confirmed fixes) — update this by hand
 * alongside APP_VERSION when shipping. Rendered as the LAST card on the
 * Picks tab in EVERY render branch — see renderWhatsNewCardHTML() below and
 * both call sites in renderPicksPage(). If both lists are empty for a
 * release, the card renders nothing (never an empty shell).
 */
const WHATS_NEW = {
  version: APP_VERSION,
  added: [
    'SCRIBE can speak up on its own. When something worth a line happens — a lead change, a lone-wolf cover, a broken streak, a unanimous slate, a bold claim in the room — it can post one message about it. The commissioner sets how often under Comm → Settings → SCRIBE Participation, from Quiet to Unhinged. Direct @scribe questions are answered regardless.',
    'My SCRIBE File. Chat → prefs → 📁 My SCRIBE File shows what SCRIBE has recorded about you in plain language. Delete anything you told it, add hard-limit topics it will never bring up, and set your roast tolerance. Facts it works out from the standings refresh on their own.',
    'The Locker Room opens instantly. The room now shows what you last saw on this device the moment the app opens, before the league data even loads, then catches up.',
    'You can talk to SCRIBE. Type @scribe in the Locker Room with a real question — a standing, a matchup, a pick record, whether a starter is playing — and it answers with the actual numbers first, banter second. While it looks things up you\'ll see "SCRIBE is looking into it…"; if it\'s throttled or the budget is spent, it says so and falls back to a canned line instead of guessing. Six questions per person per hour.',
    'SCRIBE is learning from you. Every week the Trainer reads your ⭐ ratings, rewrites, 📌 flags and 👁 weigh-ins, works out what landed and what didn\'t, and posts a short out-of-character report to the room, with the full write-up under Rules → SCRIBE Training. Strong patterns adjust how SCRIBE talks; anything shaky waits for the commissioner.',
    'Commissioner: new controls under Comm → Settings (interactive SCRIBE, web search, learnings on/off) and a Trainer card under Comm → Data (run now, approve or reject what it learned, the human-messages-per-SCRIBE-line metric).',
  ],
  fixed: [
    'Talking to SCRIBE works now. Your @scribe question was being sent to SCRIBE a split second before the message itself reached the room, so it could never find what you asked and fell back to a canned line every time. It now waits for your message to land first. Questions from before this fix keep their canned reply; ask a fresh one.',
    'The Locker Room fills on open. Two fixes: a fresh open no longer waits up to a minute after a slow first connection, and the room now remembers what you last saw on this device and shows it instantly while it checks for anything new.',
    'A 🔄 button in the chat header. Tap it to check for new messages right now instead of waiting for the next automatic check.',
    'Sync and SCRIBE stopped answering the wrong question. The server could occasionally reply to a request with its health check instead of an answer; the app took that as success, which showed up as "Sync refused" on a perfectly healthy league, @scribe falling back to canned lines, and a Trainer run that never ran. Every reply is now checked against the request it belongs to, and the server refuses to answer an empty one.',
    'The Locker Room no longer opens blank and stays blank. Two ways that could happen are gone: a long season\'s log is now read in pages until the room is caught up, and sending a message from an empty room no longer convinces the app it has already seen everything.',
    'No push storm on a cold open. Reading history in pages could have pushed every old message to everyone; history is now told apart from live messages before any push goes out, with a hard cap underneath.',
    'SCRIBE\'s answers about picks respect the blind rule harder than the app itself: while a week is open it won\'t repeat anyone\'s pick in the room — including your own.',
  ],
};

/**
 * UN-124 — collapsed-by-default "what's new" card. Takes an optional data
 * object (defaults to WHATS_NEW) so it's directly unit-testable without
 * touching the module-level constant. Renders NOTHING when both lists are
 * empty. No dismiss / "seen it" flag — settings.* is one shared league-wide
 * blob, so one player dismissing it would hide it for everyone (Drew's
 * explicit call).
 */
export function renderWhatsNewCardHTML(data = WHATS_NEW) {
  const added = data?.added || [];
  const fixed = data?.fixed || [];
  if (!added.length && !fixed.length) return '';
  const group = (label, items) => !items.length ? '' : `
          <div class="text-xs text-muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:8px">${label}</div>
          <ul class="rules-list">${items.map(i=>`<li>${escHtml(i)}</li>`).join('')}</ul>`;
  return `
    <div class="card mb-md">
      <details>
        <summary style="cursor:pointer;font-weight:600;font-size:.85rem">🆕 What's new${data?.version ? ` in ${escHtml(data.version)}` : ''}</summary>
        <div>${group('New', added)}${group('Fixed', fixed)}</div>
      </details>
    </div>`;
}


import {
  WEEK_STATUS, GAME_STATUS, PICK_RESULT, TIME_WINDOW, TIME_ZONES, DEFAULT_TZ,
  ALMA_MATERS, DEFAULT_RULES, DATA_QUALITY, DATA_SOURCE_MODE,
  createPlayer, createGame, createPick, createWeek, formatWeekLabel, formatWeekLabelParts,
  formatGameTime, formatVenueDisplay, formatSpread, getPlayerInitials,
  sourceModeLabelOf, ALMA_MATER_DISPLAY, getAlmaMaterMatch,
  formatTeamName, getTeamDisplay, gameDataReadiness,
  buildAbbrMap, REACTION_PALETTE,
  THEMES,
  HISTORICAL_DEMO_WEEK, HISTORICAL_DEMO_GAMES, REAL_WEEK_1_2026,
  SITE_PIN,
  getAutoLockOffsetMinutes, getAutoLiveEnabled, getAutoFinalizeEnabled,
  obligationRole, obligationNextStatus, obligationStatusDisplay, isObligationActive,
  getEffectiveGroupId, weeksInGroup, getGroupTiebreakerWeek,
  isGroupTiebreakerAmbiguous, formatWeekGroupLabel,
} from './data-model.js';

import {
  initStorage, resetToDemo, ensureSeedData,
  getBackendMode, setBackendMode,
  getSettings, saveSetting,
  getSession, setSession, clearSession,
  getPlayers, getPlayer, savePlayer, addPlayer,
  verifyPlayerPin, hasPlayerPin, setPlayerPin, getPlayerPin,
  getCurrentWeek, getWeek, getWeeks, saveWeek, deleteWeek,
  getActiveWeekId, setActiveWeekId, getEffectiveWeekStatus, arePicksPublic,
  getGames, getGame, saveGame, deleteGame, saveAllGamesForWeek, clearSlateForWeek,
  getAvailableGames, saveAvailableGames, clearAvailableGames,
  getPicks, getPick, saveAllPicks, hasPlayerSubmitted,
  getWeeklyResults, saveAllWeeklyResults,
  getObligations, getActiveObligations, saveObligation, saveAllObligations, createObligation,
  getNickname, setNickname, getDisplayNamePlain,
  getGameLockOverrides, setGameLockOverride, clearAllLockOverrides,
  getTiebreakerGuess, setTiebreakerGuess, getTiebreakerGuesses,
  getExtraPointGuess, setExtraPointGuess, getExtraPointGuesses,
  getRejectedSuggestions, rejectSuggestion, unrejectSuggestion,
  clearRejectedSuggestions, isSuggestionRejected, suggestionKeyOf,
  getReactionsForGame, toggleReaction,
  getComments, getGameComments, addComment, deleteComment, addBotPostIfNew,
  getFeedback, appendFeedback,
  getExcludedFeedbackIds, isFeedbackExcluded, setFeedbackExcluded,
  countPicksForGame, deletePicksForGame,
  saveFetchProof, getFetchProof,
  getTimezone, setTimezone,
  getTheme, setTheme,
  isSiteUnlocked, setSiteUnlocked, verifySitePin,
  getEffectiveSitePin, setSitePin,
  resetCurrentWeekData,
  exportAllData, exportAllDataRaw,
  // Groups A/B (2026-09-10) — notification category prefs, DI-A4
  getNotifyPushMaster, setNotifyPushMaster, getNotifyCategoryPrefs, setNotifyCategoryPref,
  // Build 2b, E3-E5 (2026-09-10, UN-161…163) — SCRIBE Trainer output
  getScribeLearnings, setScribeLearnings, getScribeCanon, setScribeCanon, getScribeReports,
} from './storage.js';

import {
  buildEspnUrl,
  fetchByDateRange, fetchCurrentCFBGames,
  refreshScoresByEventIds, scoreCandidateGames, buildSuggestedSlate,
  getProviderState, getLastFetchUrl,
  getTimeWindow,
  fetchEspnTeamsList,
} from './data-provider.js';

import {
  calculateWeeklyResults, calculateSeasonStandings, calculateGroupWeeklyResults,
  evaluatePick, getPickStatusLabel, getPickStatusClass,
  calculateAtsWinner, calculateAlmaMaterTotal,
  computeEffectiveLockAt, computeEffectiveLiveAt, computeFirstKickoff, computeLastKickoff,
} from './scoring.js';

import {
  getBackendConfig, setBackendConfig, clearBackendConfig,
  isBackendConfigured, isBackendReady, pingBackend,
  hydrate as hydrateBackend, seedFromLocal, flushPush,
  refreshFromBackend, createSnapshot, listSnapshots, restoreSnapshot,
  onBackendStatus, getSyncStatus, loadDeployedConfig,
  primeFromMirror, isMirrorStale, clearMirror,
  scribeMemoryListRemote, scribeMemoryUpsertRemote, scribeMemoryDeleteRemote, scribeMemorySyncRemote,
} from './backend.js';

// ── v0.16.0 modules ──────────────────────────────────────────────────────────
import {
  initChatUI, renderChatPage, gameChatBubbleHTML, dashboardChatTeaserHTML,
  updateChatBadges, openGameChatSheet, setChatChannel,
  emitPicksLockedEvent, emitGameFinalEvent, emitExtraPointEvent, emitWeekFinalEvent,
  emitPickRevealEvent, emitKickoffEvent, scribeLiveGameCheck,
  resumeChatAfterLogin,
  chatDigest,
  setChatSyncStatus,
} from './chat-ui.js';
import { setPollMode, sendEvent as sendChatEvent, sendGameReact, getRetentionDays, retentionStats, isChatEnabled, refreshChatEnabled, startFreshChat, getChatEpochSeq, getChatEpochSetAt, epochStats, unreadCount, mentionUnreadCount, isChatImagePreviewEnabled } from './chat.js';
import { isScribeFeedbackEnabled } from './scribeFeedback.js';
import { isScribeInteractiveEnabled, isScribeWebSearchEnabled, isScribeLearningsEnabled, getActiveContext, runTrainerRemote,
  getScribeFrequency, isScribeAutonomousEnabled } from './scribeAgent.js';
// Build 3, Group D pass 2 (2026-09-11) — the approved copy tables (FREQUENCY_*
// / MEMORY_COPY, from SCRIBE_COPY_GROUP_D_091126.md) and the ONE impure
// week-signal wrapper pass 1 built for these two call sites. Imported rather
// than retyped so the dial's five level descriptions and the memory modal's
// body/empty-state strings exist in exactly one place.
import { FREQUENCY_COPY, FREQUENCY_LEVELS, FREQUENCY_DEFAULT, MEMORY_COPY, considerWeekSignals } from './scribeLines.js';
import { SEASON_2025, season2025Obligations, season2025Nets, ob2025Status } from './history-2025.js';
import { fetchMetrics as fetchChatMetrics } from './chatTransport.js';
import { renderPicksFooterHTML, renderWeekRecapCardHTML } from './recap.js';
import {
  detectLongestFieldGoal, gradeWeekExtraPoint, gradeExtraPoint,
  renderExtraPointResultsHTML, EP_OUTCOME_LABEL,
} from './extra-point.js';

// ── Groups A/B — in-app + push notifications (UN-139…UN-148, 2026-09-10) ─────
import {
  wireChatNotifications, destinationFor,
  notifyPicksOpened, notifyPicksLocked, notifyResultsFinalized,
  notifyObligationCreated, notifyObligationSettled, notifyCommissionerAnnouncement,
  getNotificationsForPlayer, unreadLifecycleCount, markNotificationRead,
  registerPushAdapter, OneSignalRelayAdapter,
  pollNotifyLog,
} from './notifications.js';
import {
  ensureOneSignalInit, loginOneSignal, logoutOneSignal, wireForegroundSuppression,
  subscriptionState, requestPushPermission,
} from './push-onesignal.js';

// ─── STATE ────────────────────────────────────────────────────────────────────

export const state = {
  currentTab: 'picks',
  draftPicks: {}, draftTiebreaker: null,
  editingPicks: false, // true while a logged-in player is updating their already-submitted picks
  dashboardWeekId: null,
  picksWeekId: null,      // v0.16.0 — non-null when viewing a previous locked/closed week on the Picks tab
  draftExtraPoint: null,  // v0.16.0 — Ischemic Extra Point guess (longest FG, yards)
  // Active tab within the Commissioner panel (week / games / players / settings / data)
  commTab: 'week',
  lastFetchResult: null,
  recalcAllResult: null, // DI-H — set by #recalc-all-weeks-btn, read by renderRecalculateFinalizedWeeksAdminSectionHTML()
  // Available-games filter (commissioner panel). Persists within a session.
  availFilter: {
    groupBy: 'date',      // 'date' | 'day' | 'conference' | 'region' | 'rank' | 'none'
    conference: '',       // exact conference name filter, '' = any
    rank: 'any',          // 'any' | 'ranked' | 'unranked'
    almaOnly: false,      // only games involving an alma mater
    nationalTV: false,    // DI-3 — only games on national TV (g.nationalTV === true)
    tightOnly: false,     // DI-3 — only tight matchups (|spread| <= 7)
    search: '',           // free-text team/school search
  },
};

/**
 * RG-51 (adjacent finding) — reset the ENTIRE pick draft. ONE function, because
 * six hand-written copies of this reset is what caused the defect.
 *
 * NUMBERING: this was labelled RG-49 until 2026-09-02, colliding with the
 * SEPARATE seam-level persistence defect that persisttest.mjs documents as
 * RG-49. Two different defects, one number, in shipped source — a verbatim
 * recurrence of the RG-40/RG-41 mislabeling the v0.17.8 ledger row already
 * records. Renumbered on reviewer's finding before the ledger row was written,
 * so the ledger does not inherit the collision. RG-49 = the persistence defect
 * (persisttest.mjs), RG-50 = score orientation (orienttest.mjs), RG-51 = this.
 *
 * `state.draftExtraPoint` arrived in v0.16.0 and was added to exactly ONE of the
 * seven teardown sites — the submit path. The other six each cleared a different
 * subset — at the pre-fix line numbers: 929 nothing, 951 picks only, 988 and
 * 1148 picks+tiebreaker, 1196 nothing, 1202 picks+tiebreaker — so on a shared
 * device player A's typed Extra Point guess
 * survived the logout and PRE-FILLED player B's input. B read a rival's number
 * while the week was still OPEN — RG-37's class — and if B submitted, A's
 * number was recorded as B's entry.
 *
 * Extra Point does NOT feed the standings (Drew, 2026-09-01: "the only thing
 * that affects the standings is the performance in the picks and the
 * tiebreaker"). The leak still matters, and the mis-attribution still matters:
 * it is a live blackjack side bet, so seeing the field lets you sit one yard
 * under the leader, and a guess recorded against the wrong player is wrong data
 * regardless of what it feeds.
 *
 * Every session change in the picks flow calls this and nothing else touches
 * the draft fields directly, so a SEVENTH draft field cannot be forgotten by
 * five of six call sites again. Asserted structurally in persisttest [7],
 * with canaries on both matchers (CONVENTIONS #21).
 */
function clearPickDraft() {
  state.draftPicks = {};
  state.draftTiebreaker = null;
  state.draftExtraPoint = null;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => { boot(); });

async function boot() {
  // ── v0.16.0 FAST BOOT ──────────────────────────────────────────────────────
  // Root cause of the old ~20s blank: boot awaited a full Google Apps Script
  // getAll (10–20s cold start) BEFORE anything rendered — even the PIN gate —
  // and the gate then window.location.reload()ed into a SECOND boot + hydrate.
  // New model (AD-08 in DEVELOPMENT_LEDGER.md):
  //   1. Prime the in-memory cache SYNCHRONOUSLY from the last successful
  //      snapshot (localStorage mirror) and paint immediately.
  //   2. The PIN gate is an OVERLAY — no body nuke, no reload, no second boot.
  //   3. hydrate() runs in the background: visible "Syncing…" badge while
  //      stale, one-shot re-render when fresh data lands, LOUD red banner on
  //      failure (unchanged), and pushes are HELD while stale so a stale
  //      mirror can never clobber fresher remote data.
  let backendErrorBanner = null;

  onBackendStatus((status, detail) => {
    updateSyncBadge(status);
    if (status === 'error' && detail?.error) showBackendErrorBanner(detail.error);
    if (status === 'synced') hideBackendErrorBanner();
  });

  const primedKeys = primeFromMirror();
  let rendered = false;

  if (primedKeys > 0) {
    setBackendMode('googleSheets');   // serve last-known data instantly
    updateSyncBadge('syncing');
  }

  setupNav(); setupHeaderIdentity(); setupHeaderFeedbackButton(); refreshHeader(); renderTzToggle(); renderThemeToggle(); applyTheme(getTheme()); setupAutoRefresh();
  // Item A — independent of the score auto-refresh interval (which the
  // commissioner can set to "Off"), so the mid-session chat-off watch always
  // runs regardless of that other setting.
  setupChatEnabledWatch();
  if (!getSettings().dashboardLayout && typeof window !== 'undefined' && window.innerWidth && window.innerWidth < 600) {
    saveSetting('dashboardLayout', 'compact');
  }

  // ── BUG-G (2026-09-11) — CHAT STARTS HERE, NOT AFTER HYDRATE ──────────────
  // Second half of Drew's "chat stays blank" report (RG-98 fixed the
  // scheduling half). The chat engine used to boot from initChatUI() below,
  // AFTER `await hydrateBackend()` — so DI-169's device-local cache could not
  // RENDER, and no onChat subscriber existed to render anything the transport
  // did deliver, until a ~100KB getAll had finished paying the Apps Script
  // cold start (8s modelled; ~26s with misroute retries; never, on a failed
  // hydrate). Chat has no data dependency on the hydrated snapshot — its log
  // lives in a separate Messages sheet reached only through chatTransport.js
  // (AD-16).
  //
  // THIS POSITION IS LOAD-BEARING, and it is above navigateTo() deliberately
  // (reviewer BLOCK, 2026-09-11). navigateTo() ends with refreshChatEnabled(),
  // which SUBSCRIBES on its own — so on any device with a primed mirror (every
  // returning player) the line below used to start the poll loop as a side
  // effect of a navigation call, with S.head === 0, no device cache replayed,
  // and no onChat subscriber registered yet. That subscription then spent an
  // Apps Script cold start on RG-91's full chatSince(0, 500) and delivered its
  // answer into an empty subscriber set. Running the early phase FIRST means
  // the cursor, the cache and the subscriber are all in place before anything
  // else can subscribe, so that first tick is the cheap chatHead probe plus an
  // incremental read. (chat.js's startChatTransport() ALSO primes before its
  // own already-subscribed early return, so neither half depends on the other
  // — belt and braces, because this ordering is exactly the kind that gets
  // quietly reshuffled later.)
  //
  // Before the awaits, not just before hydrate: the cached room renders
  // SYNCHRONOUSLY here, so it must not wait on the config.json fetch either. A
  // tick that fires before setBackendConfig() below returns early WITHOUT
  // consuming a boot-ladder rung (RG-98 F1) and retries ~1s later with the
  // config in hand — boottest §6 pins that.
  //
  // Its own try/catch, deliberately NOT inside the hydrate try below: a chat
  // failure must never be reported as — or mask — a hydrate failure (AD-06,
  // the red banner stays exactly as loud as it was).
  try { initChatUI({ phase: 'early' }); } catch (e) { console.warn('[chat] early start failed', e); }
  // Item 10 — wired in the EARLY phase as well as the late one (below). The
  // listener is latched, so the second call is a no-op; what it buys is a
  // button that works during the hydrate instead of after it.
  try { wireScribeFileEntry(); } catch (e) { console.warn('[scribe] file entry wiring failed (early)', e); }

  if (primedKeys > 0) { navigateTo('dashboard'); rendered = true; }
  // (No mirror yet: leave the built-in section skeletons up until we know
  //  whether this device is cloud-connected — never flash seeded demo data
  //  over a shared league, and never seed INTO an unhydrated backend.)

  if (!isSiteUnlocked()) showSitePinGate();
  revealApp();   // paint happens NOW — hydration overlaps PIN entry

  // ── Background connect + hydrate ──────────────────────────────────────────
  try {
    const deployed = await loadDeployedConfig();   // same-origin fetch, ~fast
    if (deployed.ok) setBackendConfig(deployed.url, deployed.token);

    if (isBackendConfigured()) {
      await hydrateBackend();          // cold start happens here, off-screen
      setBackendMode('googleSheets');
      // BUG-G — the early start above read the LAST-KNOWN settings.chatEnabled.
      // This is the first instant the real one is readable, so reconcile here
      // rather than waiting for initChatUI() a few lines down: a commissioner
      // who turned chat off while this device was closed must not have it
      // polling through the whole hydrate-to-render window. Idempotent, and
      // it subscribes on the OFF->ON direction too.
      try { refreshChatEnabled(); } catch {}
      ensureSeedData();
      refreshHeader();
      navigateTo(rendered ? (state.currentTab || 'dashboard') : 'dashboard');
      rendered = true;
    } else if (deployed.ok === false && deployed.reason === 'malformed') {
      console.error('[backend] config.json malformed:', deployed.error);
      backendErrorBanner = `config.json is invalid (${deployed.error}). Cross-device sync is OFF.`;
      if (!rendered) { setBackendMode('local'); initStorage(); navigateTo('dashboard'); rendered = true; }
    } else {
      // No config anywhere — fork-friendly local-only mode.
      if (!rendered) { setBackendMode('local'); initStorage(); navigateTo('dashboard'); rendered = true; }
    }
  } catch (err) {
    // LOUD failure (unchanged policy): players + commissioner must KNOW their
    // picks aren't syncing. Persistent red banner; app stays usable.
    const msg = String(err.message || err);
    console.error('[backend] hydrate failed:', err);
    backendErrorBanner = msg;
    if (!rendered) { setBackendMode('local'); initStorage(); navigateTo('dashboard'); rendered = true; }
  }
  if (backendErrorBanner) showBackendErrorBanner(backendErrorBanner);

  // Chat engine + badges (v0.16.0) — BUG-G: this is now the LATE phase. The
  // transport and the cached-room replay already started above, before the
  // hydrate; what still has to wait for the hydrated settings blob runs here
  // (epoch heal, outbox load + flush) plus all the UI wiring. Unchanged
  // otherwise, including for the paths that never ran an early phase at all.
  try { initChatUI(); updateChatBadges(); } catch (e) { console.warn('[chat] init failed', e); }
  // Build 3, Group D (2026-09-11, DI-D4) — one delegated document listener
  // for the "My SCRIBE File" button chat-ui.js renders in the player prefs
  // panel. Idempotent (wires once) and boot-inert: it reads nothing, writes
  // nothing and fetches nothing until a player actually taps it.
  try { wireScribeFileEntry(); } catch (e) { console.warn('[scribe] file entry wiring failed', e); }

  // ── Groups A/B — notifications boot wiring (2026-09-10) ──────────────────
  try {
    registerPushAdapter(new OneSignalRelayAdapter());   // §4 — provider isolation: absent adapter is also a valid state, never required
    wireChatNotifications();                             // DI-B1 — subscribes to chat.js's EXISTING onChat(), zero chat.js changes
    setupNotifBell();
    renderNotifBell();
    const sess0 = getSession();
    ensureOneSignalInit().then(() => {
      if (sess0?.playerId) loginOneSignal(sess0.playerId);
      wireForegroundSuppression(destinationFor);          // §3 step 3 — client-side-only foreground suppression
    });
    // F2/F4 remediation (2026-09-10) — fold the server-fired reminder/
    // locking-soon log (PICKS_REMINDER/PICKS_LOCKING_SOON are push-only from
    // the client's perspective — Code.gs's scanReminders fires them entirely
    // server-side) into the Notification Center at hydrate, then re-render
    // the bell so its count reflects them immediately rather than waiting
    // for the first auto-refresh tick.
    if (sess0?.playerId) {
      pollNotifyLog(sess0.playerId, { force: true }).then(() => renderNotifBell()).catch(() => {});
    }
  } catch (e) { console.warn('[notifications] boot wiring failed', e); }

  // DI-A5 — deep-link landing. Mirrors index.html's own "?access=scribe"
  // query-param precedent: read once, scrub the URL so a bookmarked/shared
  // link stays clean, then navigate. `ntab`/`nparams` are written by
  // backend/Code.gs's buildDestinationUrl() into the OneSignal push payload's
  // `url` field, which the SDK's own (merged) service worker opens on tap —
  // we never hand-author notificationclick handling (correction #1).
  //
  // F10 remediation (2026-09-10) — the scrub used to replace the ENTIRE
  // query string with nothing, silently dropping any OTHER param a link
  // might carry (e.g. "?access=scribe"). Strip ONLY the notification params.
  try {
    const params = new URLSearchParams(location.search);
    const ntab = params.get('ntab');
    if (ntab) {
      let nparams = {};
      try { nparams = JSON.parse(params.get('nparams') || '{}'); } catch {}
      params.delete('ntab');
      params.delete('nparams');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
      setTimeout(() => deepLinkTo({ tab: ntab, params: nparams }), 0);
    }
  } catch (e) { console.warn('[notifications] deep-link parse failed', e); }

  window.addEventListener('beforeunload', () => { try { flushPush(); } catch {} });
}

/**
 * Persistent red banner shown when the shared-data backend isn't reachable.
 * Sticks to the top of the viewport until either the connection recovers
 * (handled by the onBackendStatus 'synced' event in boot) or the user
 * dismisses it. Idempotent — calling it twice with the same message is a
 * no-op (we update the message in place rather than stacking banners).
 */
function showBackendErrorBanner(message) {
  let el = document.getElementById('backend-error-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'backend-error-banner';
    el.className = 'backend-error-banner';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="beb-inner">
      <span class="beb-icon" aria-hidden="true">⚠️</span>
      <div class="beb-text">
        <strong>Cross-device sync is OFF on this device.</strong>
        <div class="beb-detail">${escHtml(String(message))}</div>
        <div class="beb-hint">Picks made on THIS device may NOT reach other players' devices until this is fixed. Tell the commissioner.</div>
      </div>
      <button type="button" class="beb-retry" id="beb-retry-btn">Retry</button>
      <button type="button" class="beb-close" id="beb-close-btn" aria-label="Dismiss">✕</button>
    </div>`;
  el.style.display = 'block';
  document.getElementById('beb-retry-btn')?.addEventListener('click', async () => {
    if (!isBackendConfigured()) {
      showToast('No backend URL configured on this device','error');
      return;
    }
    showToast('⏳ Retrying connection…','warning');
    try {
      await hydrateBackend();
      setBackendMode('googleSheets');
      hideBackendErrorBanner();
      showToast('✅ Connection restored','success');
    } catch (err) {
      showToast(`❌ Still failing: ${err.message||err}`,'error');
      showBackendErrorBanner(String(err.message || err));
    }
  });
  document.getElementById('beb-close-btn')?.addEventListener('click', () => { el.style.display = 'none'; });
}

function hideBackendErrorBanner() {
  const el = document.getElementById('backend-error-banner');
  if (el) el.style.display = 'none';
}

/** Remove the boot-time visibility lock once the first screen has rendered.
 *  Prevents the maroon header from flashing before the PIN gate appears. */
function revealApp() {
  // Defer one tick so the DOM has actually painted the new layout first.
  requestAnimationFrame(() => document.body.classList.remove('cfbp-booting'));
}

// AD-06 (UN-110 consequence): .app-header — and with it #sync-badge — is
// display:none on the chat tab. One function, two targets, so they cannot
// drift (CONVENTIONS #21): every status update writes both. Chat's own badge
// only surfaces text for 'error' (keeps chat chrome minimal in the normal
// case) but the hard loud-fail rule still holds — sync failures are visible
// on chat too, just quieter than the persistent red page banner.
function updateSyncBadge(status) {
  const map = {
    syncing: '☁️ Syncing…',
    synced:  '☁️ Synced',
    error:   '⚠️ Sync error',
  };
  const el = document.getElementById('sync-badge');
  if (el) {
    el.textContent = map[status] || '';
    el.className = 'sync-badge sync-' + status;
  }
  // Track last-known status so a FRESH renderChatPage() — which replaces
  // #page-chat's entire innerHTML, including any live badge node — reflects
  // it immediately rather than waiting for the next onBackendStatus event.
  setChatSyncStatus(status);
  const chatEl = document.getElementById('chat-sync-badge');
  if (chatEl) {
    const isError = status === 'error';
    chatEl.textContent = isError ? map.error : '';
    chatEl.className = 'sync-badge' + (isError ? ' sync-error' : '');
  }
}

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(i => i.addEventListener('click', () => navigateTo(i.dataset.tab)));
}

/** v0.17.0 — THE PICK REVEAL RITUAL. One system event posts everyone's picks
 *  to the room simultaneously. Local ledger prevents outbox spam; the
 *  deterministic id (sys_reveal_<weekId>) makes it exactly-once across all six
 *  clients.
 *
 *  UN-116, 2026-08-12 — this used to fire at LOCK. Drew chose to keep the
 *  dashboard blind until live/final and move the reveal to match, rather than
 *  loosen the dashboard to lock. Both now ask arePicksPublic(), so the room and
 *  the dashboard cannot disagree about when picks become public.
 *
 *  This writes into an append-only log under a deterministic id, so the text is
 *  permanent once emitted — see AD-09/AD-11 and RG-13. Weeks already revealed
 *  under the old threshold keep their event; nothing is re-emitted.
 *
 *  RG (2026-08-13) — this used to consider getCurrentWeek() and nothing else,
 *  so the moment the commissioner activated week N+1, week N's reveal could
 *  never fire on any device. The ritual was lost silently, permanently, the
 *  same shape as the lost Extra Point.
 *
 *  THE SCAN IS BOUNDED, AND THE BOUND IS THE WHOLE SAFETY ARGUMENT. Looking at
 *  every public week not in this device's ledger would, on any device with a
 *  fresh ledger — a new phone, a cleared cache, a new player — backfill the
 *  room with a reveal for every historical week that never got one, permanent
 *  and un-take-back-able, in front of six real people. Two independent bounds
 *  stop that:
 *
 *    1. RECENCY. Only weeks that ENDED within REVEAL_LOOKBACK_DAYS are ever
 *       candidates. The ritual is about the week being played right now; a week
 *       that finished last month is history, not a pending announcement. A week
 *       with no endDate fails CLOSED — an undated week cannot be shown to be
 *       recent, and the cost of guessing wrong is a permanent post.
 *    2. ONE PER INVOCATION. Even if the recency test were somehow wrong, a
 *       single nav tap can post at most one message rather than a season's
 *       worth. This runs on every navigation, so a genuine backlog of two still
 *       drains within seconds.
 *
 *  Both are asserted in loadtest.mjs [49], where the acceptance gate is a store
 *  full of old public weeks with full slates plus an empty ledger emitting
 *  EXACTLY ZERO events. */
const REVEAL_LOOKBACK_DAYS = 3;

export function checkPickRevealDue() {
  const key = 'cfbp_reveal_emitted';
  let done = [];
  try { done = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
  const cutoff = Date.now() - REVEAL_LOOKBACK_DAYS * 86400000;
  const due = getWeeks().filter(w => {
    if (!w || w.dataSourceMode === 'demo') return false;
    if (done.includes(w.weekId)) return false;
    if (!arePicksPublic(w)) return false;                 // the blind rule still gates the ritual
    // Same endDate parse the SCRIBE digest uses (`week.endDate + 'T23:59:59'`).
    // A missing or unparseable date yields NaN, which fails this test — closed.
    const ends = w.endDate ? new Date(w.endDate + 'T23:59:59').getTime() : NaN;
    return Number.isFinite(ends) && ends >= cutoff;
  }).sort((a, b) => (b.weekNumber || 0) - (a.weekNumber || 0));
  if (!due.length) return;
  const week = due[0];
  emitPickRevealEvent(week);
  done.push(week.weekId);
  try { localStorage.setItem(key, JSON.stringify(done.slice(-20))); } catch {}
}

// ── Item A: commissioner chat on/off toggle — nav + live watch ───────────────
/** Shows/hides the bottom-nav Chat entry. `.nav-item` is `flex:1` in a `flex`
 *  row (css/styles.css), so `display:none` on one item redistributes the
 *  remaining five evenly — no gap, no misalignment (verified against the
 *  actual CSS rule, not assumed). */
function applyChatNavVisibility() {
  const enabled = isChatEnabled();
  document.querySelectorAll('.nav-item[data-tab="chat"]').forEach(el => { el.style.display = enabled ? '' : 'none'; });
}

/** Periodic mid-session watch (item A hazard #1's second half): a player
 *  sitting ON the chat page when the setting flips off must not be stranded.
 *  Runs independently of the score auto-refresh interval (which the
 *  commissioner can set to "Off") so this check keeps working even then. */
function checkChatEnabledLive() {
  applyChatNavVisibility();
  try { refreshChatEnabled(); } catch {}
  if (!isChatEnabled() && state.currentTab === 'chat') {
    showToast('Chat has been turned off by the commissioner.', 'warning');
    navigateTo('dashboard');
  }
}

let _chatEnabledWatchTimer = null;
function setupChatEnabledWatch() {
  if (_chatEnabledWatchTimer) clearInterval(_chatEnabledWatchTimer);
  _chatEnabledWatchTimer = setInterval(() => { try { checkChatEnabledLive(); } catch {} }, 20000);
}

function navigateTo(tab) {
  // Item A — chat OFF must never be reachable via navigation. Redirect BEFORE
  // touching any page/nav state so the chat page is never even briefly the
  // active section. (renderChatPage() carries the SAME guard as defense in
  // depth for callers that reach it some other way.)
  if (tab === 'chat' && !isChatEnabled()) {
    showToast('Chat has been turned off by the commissioner.', 'warning');
    tab = 'dashboard';
  }
  state.currentTab = tab;
  // UN-110: drives body[data-tab="..."] CSS (chat's own header-hidden layout,
  // UN-111's tz/theme visibility). MUST come after the chat-disabled redirect
  // above — otherwise a bounce to dashboard would leave the attribute reading
  // "chat" and the header would stay hidden on the wrong page.
  document.body.dataset.tab = tab;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.page-section').forEach(el => el.classList.toggle('active', el.id === `page-${tab}`));
  applyChatNavVisibility();
  ({ picks: renderPicksPage, dashboard: renderDashboard, leaderboard: renderLeaderboard, commissioner: renderCommPage, rules: renderRulesPage, chat: renderChatPage })[tab]?.();
  // Chat polls fast only while the chat tab is open
  try { setPollMode(tab === 'chat' ? 'active' : 'passive'); updateChatBadges(); } catch {}
  try { refreshChatEnabled(); } catch {}
  try { checkPickRevealDue(); } catch {}
  // F4 remediation (2026-09-10) — the bell badge used to go stale between
  // whatever call sites happened to remember it; navigation is a natural,
  // cheap chokepoint to keep it honest (mirrors updateChatBadges() above).
  try { renderNotifBell(); } catch {}
}

function refreshHeader() {
  const week = getCurrentWeek();
  // UN-127 (change 1): #header-meta-week, NOT #header-meta itself. #header-meta
  // is now the flex-row host for BOTH the week block and the feedback button
  // (setupHeaderFeedbackButton(), appended once at boot) — writing innerHTML
  // on #header-meta directly would wipe that button on every refresh.
  const el   = document.getElementById('header-meta-week');
  renderHeaderIdentity();
  if (!el) return;
  // UN-117 — name and dates each own a line; the status badge rides with the
  // name so a wrapped date range can never orphan it onto a third line.
  // DI-A2 (2026-09-09): this is the ONE caller that passes collapseYear:true —
  // the header is a tight strip where "Sep 3, 2026–Sep 7, 2026" repeats the
  // year for no reason; renderWeekBanner() and renderCommPage() below omit
  // the option on purpose and stay byte-identical (headermetatest.mjs).
  if (week) {
    const wl = formatWeekLabelParts(week, { collapseYear: true });
    el.innerHTML = `<span class="week-heading week-heading-inline">
      <span class="week-heading-name"><strong>${escHtml(wl.name)}</strong><span class="badge badge-${week.status} ml-sm">${week.status.toUpperCase()}</span></span>
      ${wl.dates ? `<span class="week-heading-dates">${escHtml(wl.dates)}</span>` : ''}
    </span>`;
  } else {
    el.innerHTML = '<strong>CFB Pickems</strong>';
  }
}

// ─── HEADER IDENTITY (UN-106) ─────────────────────────────────────────────────
// One element serves both signed-in and signed-out states: an initials avatar
// + first name when logged in, a "Sign In" pill when logged out. Renders
// identically across every week status — it depends only on session/player
// data, never on `week`. Both states tap through to the Picks tab, where
// renderLoginScreen() and the existing logout control already live (no
// duplicated auth logic in the header).
//
// getSession() is a synchronous device-local read (storage.js), so it never
// itself needs "resolving" — but the PLAYER RECORD it points at can be
// unhydrated for a moment on a fresh device (players route through the
// backend mirror, session does not). If session.playerId is set but that
// player can't be found yet, hold the slot EMPTY rather than guessing —
// flashing "Sign In" for a frame before a real login resolves is worse than
// showing nothing (batch 1 hazard). Call sites: refreshHeader() (boot, and
// every subsequent re-render) and resyncPlayerPreferences() (login/logout/
// player-switch) — the same two functions that already keep the rest of the
// header in sync with session state.
export function renderHeaderIdentity() {
  const el = document.getElementById('header-identity');
  if (!el) return;
  const sess = getSession();
  if (!sess?.playerId) {
    el.hidden = false;
    el.setAttribute('aria-label', 'Sign in');
    el.innerHTML = `<span class="header-identity-pill">Sign In</span>`;
    return;
  }
  const player = getPlayer(sess.playerId);
  if (!player) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.setAttribute('aria-label', `Signed in as ${player.displayName}`);
  el.innerHTML = `<span class="header-identity-avatar">${escHtml(getPlayerInitials(player))}</span><span class="header-identity-name">${escHtml(player.displayName)}</span>`;
}

/** One-time click binding — the header identity chip always routes to Picks,
 *  logged in or out (UN-106). Bound once at boot alongside setupNav(). */
export function setupHeaderIdentity() {
  document.getElementById('header-identity')?.addEventListener('click', () => navigateTo('picks'));
}

/**
 * UN-127 (item 4, 2026-08-27; RELOCATED same day on Drew's explicit ruling):
 * a quiet, always-reachable shortcut to the feedback form. Drew's stated
 * goal is VOLUME — "everyone submits a lot" — so this needs to work from
 * every tab, not just Rules. His original suggestion was "left side under
 * the week." A first pass put this in .header-right instead, reasoning that
 * the #header-meta slot was pinned by UN-117 to exactly two lines (name+
 * badge, then dates) and a third stacked line there would undo that
 * guarantee — but that reasoning was never put back to Drew before shipping.
 * It has been now, and his ruling is: put it under the week, as he asked.
 *
 * "Under the week" does NOT mean a third stacked line, which really would
 * break UN-117 — it means back in the #header-meta block Drew pointed at,
 * placed so the two-line guarantee survives. #header-meta is now
 * `display:flex` (row, not column): the week block (#header-meta-week,
 * refreshHeader()) and this button are ROW siblings, not stacked. A flex row
 * can only place items side by side, so this button structurally cannot
 * become a third line no matter how the week name/date text reformats. The
 * week block's own two-line internal structure is completely untouched.
 *
 * DI-A1 AMENDMENT (2026-09-09, Drew's explicit request): the button now
 * carries a visible "Feedback" text label next to the icon, and Drew asked
 * for it on its OWN LINE beneath the week date range — i.e. the exact third
 * stacked line the paragraph above spent a whole incident avoiding. UN-117's
 * "never a third stacked line" guarantee is hereby NARROWED to "unless
 * explicitly requested" — this is that explicit request, made with full
 * knowledge of the tradeoff (the header is position:sticky, so this costs
 * permanent header height on every screen, at every width, with no desktop
 * breakpoint reintroducing the row). #header-meta changed from a flex ROW to
 * a flex COLUMN (see the CSS comment on .header-meta) specifically so this
 * button becomes a real sibling line under the week block rather than
 * beside it — the row layout could not produce this by construction, which
 * is exactly why it had to change.
 *
 * Tap target: reuses .header-feedback-icon UNCHANGED — the same 26px visible
 * circle. .header-feedback-btn itself grew (icon + label, no longer a fixed
 * 40x40 square) but keeps its >=40px min-height, the same "pad the wrapper"
 * technique as .header-identity right next to it.
 *
 * Unlike tz-toggle/theme-toggle it is NEVER tab-gated (display:none per
 * tab) — reach is the whole point — so it shows on every tab where the
 * header renders at all. The one tab it can't reach is Chat, which already
 * hides the ENTIRE header (UN-110, unrelated to this change) — the bottom
 * nav is still one tap away there, same as today.
 *
 * Injected via JS rather than added to index.html: #header-meta already
 * exists as a static container and every other header control (tz, theme)
 * already fills itself in this same way, so this follows the existing
 * pattern rather than a new one.
 */
export function setupHeaderFeedbackButton() {
  const host = document.getElementById('header-meta');
  if (!host || document.getElementById('header-feedback-btn')) return;   // idempotent
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'header-feedback-btn';
  btn.className = 'header-feedback-btn';
  btn.title = 'Submit a bug or feature idea';
  btn.setAttribute('aria-label', 'Submit feedback');
  // DI-A1 (2026-09-09): visible text label, settled copy "Feedback", next to
  // the existing icon — no longer icon-only.
  btn.innerHTML = '<span class="header-feedback-icon">🗣</span><span class="header-feedback-label">Feedback</span>';
  host.appendChild(btn);
  btn.addEventListener('click', () => {
    // Don't blow away an in-progress draft if the player is already on
    // Rules and taps this out of habit — only navigate if we actually need
    // to (renderRulesPage() rebuilds the whole tab's innerHTML, which would
    // otherwise silently clear whatever they'd already typed).
    if (state.currentTab !== 'rules') navigateTo('rules');
    document.querySelector('.feedback-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('fb-body')?.focus();
  });
}

// ─── TIMEZONE TOGGLE ──────────────────────────────────────────────────────────

/**
 * UN-127 (change 2, 2026-08-27): timezone is now a SIGNED-IN-ONLY control,
 * the identical lock renderThemeToggle() already applies to theme. Signed
 * out, the container renders empty — no pills to flip. getTimezone()
 * (storage.js) already forces the league default (DEFAULT_TZ) while signed
 * out independent of this; this function only controls whether the
 * SWITCHING affordance is reachable. Signed in, unchanged: the pills still
 * write to the player's own preferences.tz (storage.js setTimezone ->
 * _setPlayerPref), so the choice still follows that player across devices.
 *
 * Exported for the same reason renderThemeToggle() is: the harness needs to
 * drive the REAL signed-in/signed-out gate, not a name-matched stand-in.
 */
export function renderTzToggle() {
  const container = document.getElementById('tz-toggle');
  if (!container) return;
  if (!getSession()?.playerId) { container.innerHTML = ''; return; }
  const current = getTimezone();
  container.innerHTML = TIME_ZONES.map(tz =>
    `<button class="tz-btn${tz.key === current ? ' active' : ''}" data-tz="${tz.key}">${tz.key}</button>`
  ).join('');
  container.querySelectorAll('.tz-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimezone(btn.dataset.tz);
      container.querySelectorAll('.tz-btn').forEach(b => b.classList.toggle('active', b === btn));
      // Re-render whichever page is visible
      navigateTo(state.currentTab);
    });
  });
}

function tz() { return getTimezone(); }
function fmtTime(iso, game=null) { return formatGameTime(iso, tz(), game); }

// ─── THEME ────────────────────────────────────────────────────────────────────
// Applies a theme by replacing the `theme-*` class on <body>. Idempotent.
function applyTheme(themeKey) {
  const key = themeKey || getTheme() || 'neutral';
  const body = document.body;
  [...body.classList].forEach(c => { if (c.startsWith('theme-')) body.classList.remove(c); });
  body.classList.add('theme-' + key);
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const c = getComputedStyle(body).getPropertyValue('--maroon').trim();
      if (c) meta.setAttribute('content', c);
    }
  } catch {}
}

/**
 * Re-apply the player's (or device-fallback) theme + timezone + re-render the
 * toggle pills in the header. Call whenever session changes (login/logout/
 * player switch) so a player's chosen color scheme and TZ follow them across
 * devices and don't get clobbered by whoever logged in last.
 */
function resyncPlayerPreferences() {
  applyTheme(getTheme());
  renderTzToggle();
  renderThemeToggle();
  renderHeaderIdentity();
  // Groups A/B, correction #2 (2026-09-10): OneSignal.login()/.logout() on
  // EVERY session change (login/logout/player switch) — the same chokepoint
  // this whole function already exists for. Without logout(), a handed-off
  // phone keeps receiving the PREVIOUS player's pushes. Both no-op cleanly
  // when push isn't configured (empty App ID) or off-browser (loadtest/node).
  const sess = getSession();
  if (sess?.playerId) loginOneSignal(sess.playerId); else logoutOneSignal();
  renderNotifBell();
}

/**
 * UN-127 (item 5, 2026-08-27): the theme picker is a SIGNED-IN-ONLY control
 * now. Signed out, the container renders empty — no dropdown, nothing to
 * flip. Drew's stated reason: a shared/anonymous device (nobody logged in)
 * would otherwise let any one of six people repaint the app for the next
 * anonymous viewer, and with multiple people passing a phone/laptop around
 * pregame that was "too much flipping." getTheme() (storage.js) already
 * forces 'neutral' while signed out independent of this — this function only
 * controls whether the SWITCHING affordance is reachable. Signed in,
 * unchanged: the dropdown still writes to the player's own preferences.theme
 * (storage.js setTheme -> _setPlayerPref), so it still follows that player
 * across devices exactly as before.
 */
export function renderThemeToggle() {
  const container = document.getElementById('theme-toggle');
  if (!container) return;
  if (!getSession()?.playerId) { container.innerHTML = ''; return; }
  const current = getTheme();
  // Compact dropdown so 7+ themes don't bloat the header.
  container.innerHTML = `
    <select id="theme-select" class="theme-select" aria-label="Theme">
      ${THEMES.map(t => `<option value="${t.key}"${t.key===current?' selected':''}>${escHtml(t.label)}</option>`).join('')}
    </select>`;
  container.querySelector('#theme-select')?.addEventListener('change', e => {
    const key = e.target.value;
    setTheme(key);
    applyTheme(key);
  });
}

// ─── GROUPS A/B — NOTIFICATION CENTER (UN-139…UN-148, DI-A2/A3/A4/A5/B5) ──────
// Reuses .modal-overlay/.modal/.modal-header/.modal-close verbatim (the game
// modal / edit-player modal precedent) and .card for rows — no new sheet
// component invented (DI-A3's own reuse note).

const NOTIF_ICON = {
  PICKS_OPENED: '🏈', PICKS_REMINDER: '⏰', PICKS_LOCKING_SOON: '⏳', PICKS_LOCKED: '🔒',
  RESULTS_FINALIZED: '🏆', OBLIGATION_CREATED: '💵', OBLIGATION_SETTLED: '✅',
  COMMISSIONER_ANNOUNCEMENT: '🎙',
};

function relTime(iso) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Bell badge: bound once at boot (idempotent). Click opens the Center. */
function setupNotifBell() {
  const btn = document.getElementById('notif-bell-btn');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => { openNotificationCenter(); });
}

/** Re-render the bell's visibility + unread count. Call on session change and
 *  whenever a notification is created/read (mirrors updateChatBadges()'s role
 *  for the chat pill — a SEPARATE counter, never merged, per Q4). */
function renderNotifBell() {
  const btn = document.getElementById('notif-bell-btn');
  const badge = document.getElementById('notif-bell-badge');
  if (!btn) return;
  // DI-A4 — signed OUT still reaches the bell (an anonymous viewer sees the
  // Center's public chat-summary row, just no push settings/priming card,
  // handled inside renderNotifCenterBodyHTML). Only the UNREAD COUNT is
  // player-specific — an anonymous viewer has no lifecycle notifications of
  // their own, so the badge simply stays empty for them.
  btn.hidden = false;
  const sess = getSession();
  if (!badge) return;
  const n = sess?.playerId ? unreadLifecycleCount(sess.playerId) : 0;
  if (n > 0) { badge.hidden = false; badge.textContent = n > 99 ? '99+' : String(n); }
  else { badge.hidden = true; badge.textContent = ''; }
}

function renderPrimingCardHTML(pushState) {
  if (pushState === 'granted' || pushState === 'unconfigured') return '';
  const copy = {
    'never-asked': { title: 'Enable push notifications', body: "Get notified for chat, pick reminders, and results — even when the app is closed.", btn: 'Turn On' },
    denied:        { title: 'Push is off', body: "You turned off notifications for this device. You'll still see everything here — to turn push back on, check your phone's notification settings for this app.", btn: null },
    // 2026-09-10 — split out of the old single 'unsupported' state. An iPhone
    // in a Safari TAB can get push, but only after Add to Home Screen, so it
    // gets instructions and NO Turn On button (a button there can only fail —
    // OneSignal's SDK refuses to load outside the installed app).
    'needs-install': { title: "Install to get push", body: "Push needs the home-screen app. Tap Share → Add to Home Screen, then open IRB Pick 'Ems from the icon and come back here.", btn: null },
    unsupported:   { title: "Push isn't available here", body: "This browser can't do push notifications. You'll still see everything in the app — try an iPhone home-screen install, or Chrome on Android.", btn: null },
  }[pushState];
  if (!copy) return '';
  return `<div class="card notif-priming-card" id="notif-priming-card">
    <div class="notif-priming-title">${escHtml(copy.title)}</div>
    <p class="text-muted text-sm">${escHtml(copy.body)}</p>
    ${copy.btn ? `<button class="btn btn-primary btn-sm" id="notif-priming-btn">${escHtml(copy.btn)}</button>` : ''}
  </div>`;
}

/** DI-A4 — master + 5 category rows. Each row is a full-width tappable
 *  <label> wrapping its checkbox (≥44px tap target) — a NEW requirement per
 *  the DI, not inherited from chat-ui.js's existing (undersized) prefs rows. */
function renderNotifPrefsCardHTML() {
  const master = getNotifyPushMaster();
  const cats = getNotifyCategoryPrefs();
  const rows = [
    ['chat', 'Chat'], ['pickReminders', 'Pick Reminders'], ['leagueUpdates', 'League Updates'],
    ['results', 'Results'], ['obligations', 'Obligations'],
  ];
  return `<div class="card notif-prefs-card">
    <label class="notif-prefs-row notif-prefs-master">
      <span>Push Notifications</span>
      <input type="checkbox" id="notif-master-toggle" ${master ? 'checked' : ''} />
    </label>
    ${rows.map(([key, label]) => `
      <label class="notif-prefs-row${master ? '' : ' notif-prefs-row-dim'}" data-cat-row="${key}">
        <span>${escHtml(label)}</span>
        <input type="checkbox" class="notif-cat-toggle" data-cat="${key}" ${cats[key] ? 'checked' : ''} />
      </label>`).join('')}
  </div>`;
}

function notifRowHTML(n) {
  const unread = !n.readAt;
  const icon = NOTIF_ICON[n.event] || '🔔';
  return `<div class="card notif-row${unread ? ' notif-row-unread' : ''}" data-notif-id="${escHtml(n.id)}">
    <span class="notif-row-icon">${icon}</span>
    <span class="notif-row-body">
      <span class="notif-row-title">${escHtml(n.title)}</span>
      <span class="notif-row-sub">${escHtml(n.body)}</span>
    </span>
    <span class="notif-row-time">${escHtml(relTime(n.createdAt))}</span>
  </div>`;
}

async function renderNotifCenterBodyHTML(playerId, pushState) {
  // DI-A4 — signed OUT (playerId null): no priming card, no prefs card
  // ("no player identity to attach a subscription to"), no lifecycle rows
  // (those are per-player records) — ONLY the public chat-summary row.
  const primingHTML = playerId ? renderPrimingCardHTML(pushState) : '';
  const prefsHTML = playerId ? renderNotifPrefsCardHTML() : '';
  const notifs = playerId ? getNotificationsForPlayer(playerId) : [];
  let chatUnread = 0;
  try { chatUnread = isChatEnabled() ? unreadCount(playerId, 'all') : 0; } catch {}
  const chatRowHTML = chatUnread > 0
    ? `<div class="card notif-row" id="notif-chat-summary-row">
         <span class="notif-row-icon">💬</span>
         <span class="notif-row-body"><span class="notif-row-title">${chatUnread} unread in the Locker Room →</span></span>
       </div>` : '';
  if (!notifs.length && !chatRowHTML) {
    return `${primingHTML}${prefsHTML}<p class="text-muted text-sm" style="text-align:center;padding:24px 0">Nothing yet. We'll let you know when something happens.</p>`;
  }
  return `${primingHTML}${prefsHTML}${chatRowHTML}${notifs.map(notifRowHTML).join('')}`;
}

/** DI-A3's error state — the red sync banner already covers backend hydrate
 *  failure app-wide (AD-06); this just names it instead of showing an empty
 *  state that could be mistaken for "nothing happened." */
function renderNotifCenterSkeletonHTML() {
  if (document.getElementById('backend-error-banner')) {
    return `<p class="text-muted text-sm" style="text-align:center;padding:24px 0">Can't load notifications right now — see the sync banner above.</p>`;
  }
  return `<div class="card" style="height:52px;opacity:.5"></div><div class="card" style="height:52px;opacity:.35"></div><div class="card" style="height:52px;opacity:.2"></div>`;
}

/** DI-A5 — resolve a stored/pushed destination into real navigation +
 *  best-effort scroll. Every entry in notifications.js's DEEP_LINK_TABLE maps
 *  to an EXISTING navigateTo() tab; a message no longer in retention (chat)
 *  or a section id not on the page (rare) just lands on the tab's default
 *  view rather than throwing. */
function deepLinkTo(destination) {
  if (!destination?.tab) { navigateTo('dashboard'); return; }
  navigateTo(destination.tab);
  const params = destination.params || {};
  setTimeout(() => {
    if (destination.tab === 'chat' && params.messageId) {
      const safeId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(params.messageId) : params.messageId;
      const el = document.querySelector(`[data-mid="${safeId}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('chat-flash'); setTimeout(() => el.classList.remove('chat-flash'), 1200); }
    } else if (destination.tab === 'leaderboard' && params.section === 'obligations') {
      document.getElementById('obligations-section')?.scrollIntoView({ block: 'start' });
    }
  }, 60);
}

/**
 * RG (2026-09-10) — "tapping Turn On shows 'Could not enable push'".
 * requestPushPermission() used to resolve a bare boolean, so FOUR unrelated
 * failures (SDK never loaded, init already spent, OneSignal worker not found,
 * prompt dismissed) produced one indistinguishable toast that named no cause
 * and suggested no action. It now resolves { ok, reason, detail } — this is
 * the only place that turns a reason into player-facing words. Anything
 * unmapped falls through to a message that still tells the player where to
 * look, and the underlying error is always on the console.
 */
function pushFailureMessage(res) {
  const reason = res?.reason || 'request-failed';
  if (res?.detail) console.warn('[push] Turn On failed:', reason, '—', res.detail);
  else console.warn('[push] Turn On failed:', reason);
  return {
    // ── the player can act on these ──
    'not-installed-ios':   "Push needs the home-screen app: Share → Add to Home Screen, then open it from the icon.",
    'denied':              "Notifications are blocked for this app — turn them back on in your phone's Settings.",
    'dismissed':           "No answer to the permission prompt. Tap Turn On again and choose Allow.",
    // ── nothing to act on; say so instead of implying a retry ──
    'unsupported-browser': "This browser can't do push notifications.",
    'no-browser':          "This browser can't do push notifications.",
    // ── transient: a retry genuinely can help ──
    'sw-not-found':        "Push service didn't install. Fully close and reopen the app, then try again.",
    'sdk-not-loaded':      "Push service didn't load — check your connection and try again.",
    'config-unreachable':  "Couldn't reach the league's settings — check your connection and try again.",
    'prompt-timeout':      "Push didn't finish setting up. Fully close and reopen the app, then tap Turn On again.",
    'init-failed':         "Push setup failed. Fully close and reopen the app, then try again.",
    'request-failed':      "Push setup failed. Fully close and reopen the app, then try again.",
    'init-already-spent':  "Push setup already ran and didn't finish. Fully close and reopen the app, then try again.",
    // ── commissioner-side setup gaps. A player retrying forever will never
    //    fix these, so the copy says whose problem it is. 'web-push-not-enabled'
    //    is the LIVE one: the league's push app has no Web Push platform
    //    configured yet, which is why every tap failed on v0.19.0. ──
    'not-configured':      "Push isn't switched on for the league yet.",
    'web-push-not-enabled':"Push isn't finished being set up for the league yet — the commissioner has to switch it on.",
    'app-id-mismatch':     "Push is misconfigured for the league — the commissioner needs to fix the setup.",
    'wrong-site-origin':   "Push is set up for a different website address — the commissioner needs to fix the setup.",
  }[reason] || "Could not enable push — see the console for details.";
}

function bindNotifCenterBody(ov, playerId) {
  ov.querySelector('#notif-priming-btn')?.addEventListener('click', async (ev) => {
    // Reviewer ruling (2026-09-10): requestPushPermission() can be in flight for
    // as long as the native sheet is on screen (up to PROMPT_TIMEOUT_MS), and
    // the button stayed live that whole time. A double-tap — the normal reaction
    // to a button that appears to do nothing — queued a SECOND
    // OneSignal.Notifications.requestPermission(), i.e. two prompts, two races
    // for one `Notification.permission`, and two toasts that can disagree.
    // Disable for exactly the duration of the await.
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const res = await requestPushPermission();
      showToast(res.ok ? '✅ Push enabled' : pushFailureMessage(res), res.ok ? 'success' : 'error');
      await refreshNotifCenterBody(ov, playerId);
    } finally {
      // refreshNotifCenterBody() re-renders the card, so this usually re-enables
      // a detached node — harmless, and it is what keeps the button usable when
      // the state did NOT change (a dismissed prompt is still 'never-asked').
      btn.disabled = false;
    }
  });
  ov.querySelector('#notif-master-toggle')?.addEventListener('change', (e) => {
    setNotifyPushMaster(e.target.checked);
    ov.querySelectorAll('[data-cat-row]').forEach(row => row.classList.toggle('notif-prefs-row-dim', !e.target.checked));
  });
  ov.querySelectorAll('.notif-cat-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => setNotifyCategoryPref(e.target.dataset.cat, e.target.checked));
  });
  ov.querySelector('#notif-chat-summary-row')?.addEventListener('click', () => { ov.remove(); navigateTo('chat'); });
  ov.querySelectorAll('[data-notif-id]').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.notifId;
      const n = getNotificationsForPlayer(playerId).find(x => x.id === id);
      markNotificationRead(id, playerId);
      renderNotifBell();
      ov.remove();
      if (n) deepLinkTo(n.destination);
    });
  });
}

async function refreshNotifCenterBody(ov, playerId) {
  const body = ov.querySelector('#notif-center-body');
  if (!body) return;
  const st = await subscriptionState();
  body.innerHTML = await renderNotifCenterBodyHTML(playerId, st);
  bindNotifCenterBody(ov, playerId);
}

async function openNotificationCenter() {
  // DI-A4 — signed OUT still opens the Center; it just renders ONLY the
  // public chat-summary row (no push settings, no lifecycle history — see
  // renderNotifCenterBodyHTML's playerId-null branch).
  const sess = getSession();
  const playerId = sess?.playerId || null;
  const ov = document.createElement('div'); ov.className = 'modal-overlay centered';
  ov.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>Notifications</h3><button class="modal-close" id="notif-close">✕</button></div>
    <div id="notif-center-body">${renderNotifCenterSkeletonHTML()}</div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#notif-close')?.addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  await refreshNotifCenterBody(ov, playerId);
}

// ═══ BUILD 3, GROUP D pass 2 (2026-09-11) — "MY SCRIBE FILE" ════════════════
//
// DI-D3 (player profile) + DI-D4 (player rights over memory), per
// `DESIGN_INPUTS_BATCH2_091026.md` Document 2 §5–§6 and Drew's D-5 ruling
// (a real confirm before a real delete — correction #7).
//
// WHERE THIS DATA LIVES, AND WHY IT IS NOT IN THE STORAGE SEAM. SCRIBE's
// memory rows live in their own `CFBP_SCRIBE_MEMORY` sheet (backend/Code.gs),
// NOT in the `cfbp_*` key/value store — DI-D2 rejects the KV store for this
// data explicitly, because a player's non-negotiable right to delete a line
// needs a TRUE physical row delete, which an append-only log or a
// last-write-wins blob cannot give. So these rows deliberately do not go
// through `load()`/`save()` (AD-02 governs the KV store; this is a different
// store with its own action set), and they are never mirrored into it. They
// are held in the module-level cache below and refreshed explicitly when the
// modal opens — the same "fetch on open, never a background sync" shape the
// Notification Center's own body fetch uses.
//
// PRIVACY, STATED HONESTLY AND NOT OVERSOLD (Drew's ruling #4): the server's
// ownership check is best-effort — a PIN-gated app with a shared token has no
// authenticated identity to check against. The footnote in the modal says so
// in plain language rather than implying a boundary the architecture does not
// provide. This module adds a SECOND, client-side filter on top (every render
// path below drops any row whose `playerId` is not the signed-in player), so
// a server bug or a mis-wired request cannot put another player's file on
// this screen. Same lesson as E1's attribution-leak test, one surface over.

/** DI-D4's delete confirm, verbatim per Drew's D-5 / correction #7. ONE
 *  confirm — the app's low-friction toggle norm is deliberately broken here
 *  because this is a physical, irreversible delete of a fact about a person. */
const SCRIBE_DELETE_CONFIRM = 'Delete this? SCRIBE will forget it.';
/** DI-D4's inline write-failure copy, verbatim. Never a silent failure. */
const SCRIBE_FILE_SAVE_ERROR = "Couldn't save — try again.";
/** The read half of the same promise. DI-D4 names only the write copy; this
 *  is the same sentence in the same register for the fetch that feeds the
 *  surface, rather than an empty state that would read as "nothing recorded"
 *  when the truth is "we could not look." */
const SCRIBE_FILE_LOAD_ERROR = "Couldn't load — try again.";
/** DI-D4: `<input maxlength="80">`. The constant is shared by the markup and
 *  by the handler, so the clamp cannot drift from the attribute. */
const SCRIBE_HARDLINE_MAX = 80;
/** DI-D4's "unconfirmed" band, as amended by the reviewer (item 5,
 *  2026-09-11): the tag appears for 0.5 ≤ confidence < 0.85 and nowhere
 *  else. A row with NO confidence at all — missing, null, empty string — is
 *  untagged, because `Number('')` is 0 and `Number(null)` is 0, so an
 *  open-ended "below 0.85" test silently labelled every unstamped row
 *  "unconfirmed" on the strength of a coercion rather than a judgement.
 *  That is why the guard below tests the RAW value before it coerces. */
const SCRIBE_CONFIDENCE_CONFIRMED = 0.85;
const SCRIBE_CONFIDENCE_FLOOR = 0.5;
/** DI-D4 §Section 3 — plain labels, not SCRIBE-voiced. Stored as a memory row
 *  of kind 'roastTolerance' (schema-present; nothing consumes it yet — DI-D4's
 *  own scope note). */
const ROAST_TOLERANCE_OPTIONS = [
  { value: 'light',     label: 'Light' },
  { value: 'standard',  label: 'Standard' },
  { value: 'no_limits', label: 'No limits' },
];
/**
 * F3 (copy amendment, coordinator 2026-09-11) — Section 1's body copy.
 *
 * The pre-amendment wording ("Delete anything — no explanation needed.")
 * became inaccurate the moment computed rows went read-only: a player CAN delete
 * anything he told SCRIBE, and cannot delete the facts it derives from the
 * standings, because those regenerate on the next sync. The amended line
 * says exactly that instead of promising something the surface does not do.
 *
 * Now imported from MEMORY_COPY.sectionBody (moved there 2026-09-11).
 */
const SCRIBE_SECTION1_BODY = MEMORY_COPY.sectionBody;   // moved into MEMORY_COPY (coordinator, 2026-09-11) — single home for approved copy

/** Load-bearing, per DI-D4's explicit instruction not to soften it. */
const SCRIBE_HARDLINE_BODY = 'Topics SCRIBE will never bring up about you. Private from other players. Visible to the commissioner until real sign-in ships — see below.';
/** Always visible, never collapsible (DI-D4). */
const SCRIBE_PRIVACY_FOOTNOTE = 'This is a UI-level boundary, not a technical one — the commissioner administers the underlying data. Real per-player privacy is planned but not built yet (see the SSO roadmap).';

// ── Transport seam ──────────────────────────────────────────────────────────
// The DEFAULT is the real js/backend.js relay set; production never rewires
// it. The seam exists so groupdtest.mjs can drive delete/add/tolerance
// end-to-end with no network — and the test additionally asserts that these
// defaults ARE the backend exports by identity, so a stubbed test can never
// quietly prove something about a stub instead of about the app.
const SCRIBE_MEMORY_TRANSPORT_DEFAULTS = {
  list: scribeMemoryListRemote,
  upsert: scribeMemoryUpsertRemote,
  remove: scribeMemoryDeleteRemote,
  sync: scribeMemorySyncRemote,
};
let scribeMemoryTransport = { ...SCRIBE_MEMORY_TRANSPORT_DEFAULTS };
/** TEST SEAM (same convention as scribeAgent.js's wireScribeRemoteTransport). */
export function _wireScribeMemoryTransportForTest(t = {}) {
  scribeMemoryTransport = { ...SCRIBE_MEMORY_TRANSPORT_DEFAULTS, ...t };
}
export function _restoreScribeMemoryTransportForTest() {
  scribeMemoryTransport = { ...SCRIBE_MEMORY_TRANSPORT_DEFAULTS };
}
export function _scribeMemoryTransportDefaultsForTest() { return SCRIBE_MEMORY_TRANSPORT_DEFAULTS; }

// ── Module-level cache (explicitly refreshed on modal open) ─────────────────
const scribeMemoryCache = { playerId: null, rows: [], loading: false, error: '' };
/** Inline write error (DI-D4's error state), SCOPED to the control that
 *  failed — `{ scope:'row'|'hardline'|'tolerance'|'file', id, message }` or
 *  null. Item 9: a delete that fails must say so ON THAT ROW, not in a
 *  banner the player may have scrolled away from. Cleared by the next
 *  successful write or refresh. */
let scribeFileRowError = null;
export function _scribeMemoryCacheForTest() { return scribeMemoryCache; }
/** The current scoped inline error, for groupdtest's item-9 assertions. */
export function _scribeFileRowErrorForTest() { return scribeFileRowError; }
export function _setScribeMemoryCacheForTest(playerId, rows = []) {
  scribeMemoryCache.playerId = playerId;
  scribeMemoryCache.rows = rows.slice();
  scribeMemoryCache.loading = false;
  scribeMemoryCache.error = '';
  scribeFileRowError = null;
}

/**
 * Explicit refresh — called when the modal opens, never on a timer and never
 * at boot (RG-12's lesson generalized: nothing in this feature runs during
 * the boot path). Always narrows to the signed-in player's own rows before
 * anything can render them.
 */
export async function refreshScribeMemory(playerId) {
  if (!playerId) { _setScribeMemoryCacheForTest(null, []); return scribeMemoryCache; }
  scribeMemoryCache.playerId = playerId;
  scribeMemoryCache.loading = true;
  scribeMemoryCache.error = '';
  scribeFileRowError = null;
  try {
    const r = await scribeMemoryTransport.list({ playerId });
    const rows = (r && r.records) || [];
    scribeMemoryCache.rows = rows.filter(row => row && String(row.playerId) === String(playerId));
  } catch (err) {
    console.warn('[scribe-memory] list failed', err);
    scribeMemoryCache.rows = [];
    scribeMemoryCache.error = SCRIBE_FILE_LOAD_ERROR;
  } finally {
    scribeMemoryCache.loading = false;
  }
  return scribeMemoryCache;
}

/**
 * DI-D3 — the season standings rows, computed EXACTLY the way the Standings
 * page computes them (CONVENTIONS #21: the same function, the same inputs,
 * never a parallel recompute). Factored out of renderLeaderboard() so the
 * profile view and the page it must agree with have one definition between
 * them; renderLeaderboard() now calls this.
 */
export function seasonStandingsRows() {
  const players = getPlayers().filter(p => p.active);
  // Unfiltered on purpose — group membership must see every week, including
  // drafts, to know a group's TRUE size (renderLeaderboard's own note).
  const allWeeksRaw = getWeeks();
  const visibleWeekIds = new Set(allWeeksRaw.filter(w => w.showInHistory !== false && w.dataSourceMode !== 'demo').map(w => w.weekId));
  const allResults = getWeeklyResults().filter(r => visibleWeekIds.has(r.weekId));
  return calculateSeasonStandings(players, allResults, allWeeksRaw);
}

/**
 * DI-D3 — `getPlayerProfile(playerId, { rows, withStats })`. A PURE
 * AGGREGATION, not a store:
 *   (a) computed stats, via seasonStandingsRows() — the Standings page's own
 *       numbers, not a second reading of them — only when `withStats:true`
 *       (item 7: the modal renders no stats, so it does not pay for them);
 *   (b) `player.preferences.*`, already stored per CLAUDE.md architecture
 *       bullet 4;
 *   (c) D2 Facts (`kind:'fact'`);
 *   (d) D2 Relations (`kind:'relation'`, `headToHead:<otherId>`).
 * Plus the two player-authored kinds D4 writes (hard-lines, roast tolerance).
 *
 * NO-FABRICATION GUARD, structural: an absent field is absent. A player with
 * zero memory rows gets a well-formed object with empty arrays and
 * `stats:null` — never an invented placeholder, never a throw. The render
 * function below prints nothing for what is not here.
 *
 * `rows` is injectable so the function is testable (and provably pure) with a
 * fixture; production passes nothing and it reads the module cache.
 * `statsIncluded` reports which of the two shapes came back, so a caller can
 * never mistake "not asked for" for "this player has no standings row."
 */
export function getPlayerProfile(playerId, { rows = null, withStats = false } = {}) {
  const id = String(playerId || '');
  const player = id ? getPlayer(id) : null;
  const source = rows || scribeMemoryCache.rows || [];
  // Defense in depth — see this section's header. Nothing about another
  // player can reach a render path from here, whatever the server returned.
  const mine = source.filter(r => r && String(r.playerId) === id);
  const facts = mine.filter(r => r.kind === 'fact');
  const relations = mine.filter(r => r.kind === 'relation');
  const hardlines = mine.filter(r => r.kind === 'hardline');
  const toleranceRow = mine.find(r => r.kind === 'roastTolerance') || null;
  return {
    playerId: id,
    displayName: player?.displayName || '',
    // Item 7 (reviewer, 2026-09-11) — LAZY, because the modal does not render
    // this. `seasonStandingsRows()` walks every player, every week and every
    // weekly-result row through calculateSeasonStandings(); doing that on
    // EVERY repaint of a surface that never displays the answer is work
    // nobody asked for. DI-D3's contract is unchanged — the profile still
    // carries the Standings page's own numbers, computed by the same
    // function — it is now computed only when a caller says it wants them.
    // `null` when not requested, never a half-populated object.
    stats: withStats ? (id ? (seasonStandingsRows().find(s => s.playerId === id) || null) : null) : null,
    statsIncluded: !!withStats,
    preferences: { ...(player?.preferences || {}) },
    facts,
    relations,
    hardlines,
    // DI-D4's "Episode pointer" — a recorded row that points back at the
    // message it came from (`sourceMessageId`, written by the Trainer from
    // the 📌 `remember_this` source set) — is not a separate collection.
    // It is a PROPERTY of a fact/relation row, and `scribeMemoryRowHTML()`
    // reads `row.sourceMessageId` directly to decide whether that row gets
    // the jump affordance. The `episodes` array this used to also return was
    // computed on every call and rendered nowhere (item 7).
    roastTolerance: toleranceRow ? String(toleranceRow.value || '') : null,
    roastToleranceRowId: toleranceRow ? toleranceRow.id : null,
    isEmpty: mine.length === 0,
  };
}

// ── Product-language labels ─────────────────────────────────────────────────
// DI-D4: rows read as "Alma mater", never as a raw field name. Unknown keys
// fall back to a de-camelCased version of the key rather than being hidden —
// a fact SCRIBE holds must always be visible and deletable, even if this
// table has not been taught its name yet.
const SCRIBE_FACT_LABELS = {
  seasonRecord: 'Season record',
  winPct: 'Win %',
  currentRank: 'Current rank',
  weeklyWins: 'Weekly wins',
  pickStyle: 'Pick style',
  currentStreak: 'Current streak',
  almaMater: 'Alma mater',
  job: 'Job',
  rival: 'Rival',
  theme: 'Theme',
};

function scribeMemoryRowLabel(row) {
  const key = String(row?.key || '');
  if (row?.kind === 'relation' && key.startsWith('headToHead')) {
    const otherId = key.split(':')[1] || '';
    const other = otherId ? (getPlayer(otherId)?.displayName || otherId) : '';
    return other ? `Head-to-head vs ${other}` : 'Head-to-head';
  }
  if (row?.kind === 'hardline') return 'Off limits';
  if (row?.kind === 'roastTolerance') return 'Roast tolerance';
  if (SCRIBE_FACT_LABELS[key]) return SCRIBE_FACT_LABELS[key];
  const base = key.split(':')[0].replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Note';
}

function scribeMemoryRowValue(row) {
  const key = String(row?.key || '');
  if (row?.kind === 'relation' && key.startsWith('headToHead')) {
    // Server shape: JSON `{pair:'a|b', gamesCompared, agreed, aRightBWrong,
    // bRightAWrong}` where `a` is the alphabetically first id. Rendered in
    // second person for whichever side the viewer is on; a row whose pair
    // cannot be parsed falls back to the raw stored string rather than
    // guessing at a number (SCRIBE.md §9's no-fabrication rule applied to the
    // render layer).
    try {
      const v = JSON.parse(String(row.value || ''));
      const first = String(v.pair || '').split('|')[0];
      const mineIsA = first === String(row.playerId || '');
      const mine = mineIsA ? v.aRightBWrong : v.bRightAWrong;
      const theirs = mineIsA ? v.bRightAWrong : v.aRightBWrong;
      if (!Number.isFinite(Number(v.gamesCompared))) return String(row.value || '');
      return `${v.gamesCompared} games compared · agreed ${v.agreed} · you right ${mine} · them right ${theirs}`;
    } catch { return String(row.value || ''); }
  }
  return String(row?.value || '');
}

function scribeMemoryIsUnconfirmed(row) {
  const raw = row?.confidence;
  if (raw === undefined || raw === null || raw === '') return false;   // before Number() — see the note above
  const c = Number(raw);
  if (!Number.isFinite(c)) return false;
  return c >= SCRIBE_CONFIDENCE_FLOOR && c < SCRIBE_CONFIDENCE_CONFIRMED;
}

/**
 * A COMPUTED row is derived, not recorded: the server recomputes it from the
 * standings on every memory sync, so deleting one would be undone by the
 * next refresh. Those rows render read-only with an "as of" stamp instead of
 * a 🗑 (coordinator amendment, 2026-09-11). Everything a person actually
 * said or a Trainer proposed about a person — 'player-stated',
 * 'commissioner-set', 'trainer-proposed' — keeps the delete, which is the
 * part of DI-D4's promise that has to hold.
 */
function scribeMemoryIsComputed(row) { return String(row?.provenance || '') === 'computed'; }

/** "as of Sep 11" for a computed row's `refreshedAt` stamp. Absent or
 *  unparseable renders nothing rather than a guessed date — the same
 *  no-fabrication instinct the rest of this surface follows. Tolerates rows
 *  written before the stamp existed (CONVENTIONS #10). */
function scribeAsOfLabel(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  try { return 'as of ' + new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

/** One "What SCRIBE knows" row. `.card` per CONVENTIONS #15; 🗑 is an emoji
 *  per CONVENTIONS #16 and carries its own ≥44px floor in CSS. */
function scribeMemoryRowHTML(row, errorHTML = '') {
  const unconfirmed = scribeMemoryIsUnconfirmed(row);
  const computed = scribeMemoryIsComputed(row);
  const asOf = computed ? scribeAsOfLabel(row.refreshedAt) : '';
  const jump = row.sourceMessageId
    ? `<button class="scribe-mem-jump" data-jump="${escHtml(row.sourceMessageId)}">↩ Jump to the message</button>`
    : '';
  return `
    <div class="card scribe-mem-row${computed ? ' scribe-mem-computed' : ''}" data-mem-id="${escHtml(row.id)}">
      <div class="scribe-mem-main">
        <div class="scribe-mem-label">${escHtml(scribeMemoryRowLabel(row))}</div>
        <div class="scribe-mem-value">${escHtml(scribeMemoryRowValue(row))}${unconfirmed ? ' <span class="scribe-mem-tag">unconfirmed</span>' : ''}</div>
        ${unconfirmed ? `<div class="text-muted text-xs scribe-mem-hint">${escHtml(MEMORY_COPY.unconfirmedTag)}</div>` : ''}
        ${asOf ? `<div class="text-muted text-xs scribe-mem-asof">${escHtml(asOf)}</div>` : ''}
        ${jump}
        ${errorHTML}
      </div>
      ${computed
        ? '<span class="scribe-mem-computed-note text-muted text-xs">Kept current<br>automatically</span>'
        : `<button class="scribe-mem-del" data-mem-del="${escHtml(row.id)}" aria-label="Delete this">🗑</button>`}
    </div>`;
}

/**
 * The whole modal body. PURE — state in, HTML out, no DOM — which is what
 * makes DI-D4's states (empty / populated / loading / error) assertable in
 * groupdtest.mjs's RENDERED OUTPUT rather than only in source (RG-27: a
 * source-grep test passes when the guard is reverted).
 */
export function renderScribeFileBodyHTML({ profile = null, loading = false, error = '', rowError = null } = {}) {
  const footnote = `<p class="text-muted text-xs scribe-file-footnote">${escHtml(SCRIBE_PRIVACY_FOOTNOTE)}</p>`;
  // Item 9 (reviewer, 2026-09-11) — A ROW-LEVEL ERROR BELONGS ON ITS ROW.
  // This used to render one banner at the top of the modal, which on a 375px
  // screen can be scrolled far away from the control that failed: the player
  // sees a row that looks unchanged and a sentence somewhere above it. The
  // error is now placed where the action was — inside the failing row, under
  // the Add control, or under the tolerance buttons. `rowError` is
  // `{ scope, id, message }`; a bare string is still accepted and treated as
  // scope 'file' so no caller can crash on the shape change.
  const errAt = (scope, id) => {
    if (!rowError) return '';
    const e = (typeof rowError === 'string') ? { scope: 'file', message: rowError } : rowError;
    if (!e.message) return '';
    if (e.scope !== scope) return '';
    if (scope === 'row' && String(e.id || '') !== String(id || '')) return '';
    return `<p class="text-muted text-xs scribe-file-rowerror" role="alert">${escHtml(e.message)}</p>`;
  };
  if (loading) {
    // DI-A3's skeleton idiom, verbatim (renderNotifCenterSkeletonHTML).
    return `<div class="scribe-file-skeleton">
      <div class="card" style="height:52px;opacity:.5"></div>
      <div class="card" style="height:52px;opacity:.35"></div>
      <div class="card" style="height:52px;opacity:.2"></div>
    </div>${footnote}`;
  }
  if (error) {
    return `<p class="text-muted text-sm scribe-file-error" role="alert">${escHtml(error)}</p>${footnote}`;
  }
  const p = profile || { facts: [], relations: [], hardlines: [], roastTolerance: null, isEmpty: true };
  const knows = [...(p.facts || []), ...(p.relations || [])];
  const knowsHTML = knows.length
    ? knows.map(row => scribeMemoryRowHTML(row, errAt('row', row.id))).join('')
    : `<p class="text-muted text-sm scribe-mem-empty">${escHtml(MEMORY_COPY.emptyState)}</p>`;
  const hardHTML = (p.hardlines || []).length
    ? (p.hardlines || []).map(row => `
      <div class="card scribe-mem-row" data-mem-id="${escHtml(row.id)}">
        <div class="scribe-mem-main"><div class="scribe-mem-value">${escHtml(String(row.value || ''))}</div>${errAt('row', row.id)}</div>
        <button class="scribe-mem-del" data-mem-del="${escHtml(row.id)}" aria-label="Delete this">🗑</button>
      </div>`).join('')
    : `<p class="text-muted text-sm scribe-mem-empty">Nothing off limits yet.</p>`;
  const tolerance = String(p.roastTolerance || '');
  const toleranceHTML = ROAST_TOLERANCE_OPTIONS.map(o =>
    `<button class="scribe-tolerance-opt${o.value === tolerance ? ' selected' : ''}" data-tolerance="${o.value}" aria-pressed="${o.value === tolerance ? 'true' : 'false'}">${escHtml(o.label)}</button>`).join('');
  return `
    ${errAt('file')}
    <div class="scribe-file-section">
      <h4 class="scribe-file-h">What SCRIBE knows</h4>
      <p class="text-muted text-xs">${escHtml(SCRIBE_SECTION1_BODY)}</p>
      <div class="scribe-file-rows">${knowsHTML}</div>
    </div>
    <div class="scribe-file-section">
      <h4 class="scribe-file-h">Hard limits</h4>
      <p class="text-muted text-xs">${escHtml(SCRIBE_HARDLINE_BODY)}</p>
      <div class="scribe-file-rows">${hardHTML}</div>
      <div class="scribe-hardline-add">
        <input class="form-input" id="scribe-hardline-input" type="text" maxlength="${SCRIBE_HARDLINE_MAX}" placeholder="Add a topic" aria-label="Add a topic" />
        <button class="btn btn-secondary btn-sm" id="scribe-hardline-add-btn">Add</button>
      </div>
      ${errAt('hardline')}
    </div>
    <div class="scribe-file-section">
      <h4 class="scribe-file-h">Roast tolerance</h4>
      <div class="scribe-tolerance-row">${toleranceHTML}</div>
      ${errAt('tolerance')}
    </div>
    ${footnote}`;
}

// ── Write handlers — exported so groupdtest.mjs drives the REAL ones ────────

/** DI-D4: tapping 🗑 asks once ("Delete this? SCRIBE will forget it.") and
 *  then physically deletes. A cancel writes nothing and calls nothing. */
export async function scribeFileDeleteRow(id) {
  const playerId = getSession()?.playerId || '';
  if (!playerId || !id) return { ok: false, skipped: 'no_session' };
  const row = (scribeMemoryCache.rows || []).find(r => r.id === id);
  if (!row || String(row.playerId) !== String(playerId)) return { ok: false, skipped: 'not_mine' };
  // Belt and suspenders with the render: a computed row has no 🗑, and if one
  // is ever reached some other way the delete would be undone by the next
  // refresh anyway — better to refuse than to promise a deletion that
  // silently comes back.
  if (scribeMemoryIsComputed(row)) return { ok: false, skipped: 'computed' };
  if (typeof confirm === 'function' && !confirm(SCRIBE_DELETE_CONFIRM)) return { ok: false, skipped: 'cancelled' };
  try {
    const r = await scribeMemoryTransport.remove({ id, playerId });
    if (r && r.ok === false) throw new Error(r.error || 'delete failed');
    scribeMemoryCache.rows = (scribeMemoryCache.rows || []).filter(x => x.id !== id);
    scribeFileRowError = null;
    return { ok: true, id };
  } catch (err) {
    console.warn('[scribe-memory] delete failed', err);
    scribeFileRowError = { scope: 'row', id, message: SCRIBE_FILE_SAVE_ERROR };
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * The upsert key is (playerId, kind, key) server-side, so each topic needs
 * its own key or five hard-lines would collapse onto one row.
 *
 * Item 6 (reviewer, 2026-09-11) — the slug ALONE is not enough. Truncating
 * to a fixed prefix means two different 60-character topics that happen to
 * start the same way produce the same key, and the second one silently
 * OVERWRITES the first: a player would add a boundary, watch the previous
 * one vanish, and have no way to know why. The key is now a bounded slug
 * (readable in the raw sheet, which is how the commissioner inspects this)
 * plus a short hash of the WHOLE topic, so distinctness depends on the full
 * text while re-adding the identical topic still lands on the same row.
 *
 * Same string-hash shape scribeLines.js's own `hashLine()` uses — a
 * 32-bit rolling hash rendered base36. Not cryptographic and does not need
 * to be: the population is a handful of rows per player.
 */
function hardlineHash(topic) {
  let h = 0;
  const s = String(topic);
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36).slice(0, 6).padStart(6, '0');
}
function hardlineKeyFor(topic) {
  const slug = String(topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  return 'topic:' + (slug || 'topic') + '-' + hardlineHash(topic);
}

function mergeIntoMemoryCache(record) {
  if (!record) return;
  const rows = (scribeMemoryCache.rows || []).slice();
  const at = rows.findIndex(r => r.id === record.id ||
    (String(r.playerId) === String(record.playerId) && r.kind === record.kind && r.key === record.key));
  if (at >= 0) rows[at] = record; else rows.push(record);
  scribeMemoryCache.rows = rows;
}

export async function scribeFileAddTopic(text) {
  const playerId = getSession()?.playerId || '';
  const topic = String(text || '').trim().slice(0, SCRIBE_HARDLINE_MAX);
  if (!playerId) return { ok: false, skipped: 'no_session' };
  if (!topic) return { ok: false, skipped: 'empty' };
  const record = {
    playerId, kind: 'hardline', key: hardlineKeyFor(topic), value: topic,
    // The server FORCES these two for a player-authored write (Code.gs
    // scribeMemoryUpsert). Sent anyway so the request is well-formed and the
    // intent is readable at the call site, never relied on.
    provenance: 'player-stated', confidence: 1,
  };
  try {
    const r = await scribeMemoryTransport.upsert(record);
    if (r && r.ok === false) throw new Error(r.error || 'save failed');
    if (r && r.record) mergeIntoMemoryCache(r.record); else await refreshScribeMemory(playerId);
    scribeFileRowError = null;
    return { ok: true, record: (r && r.record) || record };
  } catch (err) {
    console.warn('[scribe-memory] hard-line upsert failed', err);
    scribeFileRowError = { scope: 'hardline', message: SCRIBE_FILE_SAVE_ERROR };
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

export async function scribeFileSetTolerance(value) {
  const playerId = getSession()?.playerId || '';
  const v = String(value || '');
  if (!playerId) return { ok: false, skipped: 'no_session' };
  if (!ROAST_TOLERANCE_OPTIONS.some(o => o.value === v)) return { ok: false, skipped: 'unknown_value' };
  const record = { playerId, kind: 'roastTolerance', key: 'roastTolerance', value: v, provenance: 'player-stated', confidence: 1 };
  try {
    const r = await scribeMemoryTransport.upsert(record);
    if (r && r.ok === false) throw new Error(r.error || 'save failed');
    if (r && r.record) mergeIntoMemoryCache(r.record); else await refreshScribeMemory(playerId);
    scribeFileRowError = null;
    return { ok: true, record: (r && r.record) || record };
  } catch (err) {
    console.warn('[scribe-memory] roast-tolerance upsert failed', err);
    scribeFileRowError = { scope: 'tolerance', message: SCRIBE_FILE_SAVE_ERROR };
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ── The modal ───────────────────────────────────────────────────────────────

function repaintScribeFileBody(ov) {
  const body = ov?.querySelector?.('#scribe-file-body');
  if (!body) return;
  const playerId = getSession()?.playerId || '';
  body.innerHTML = renderScribeFileBodyHTML({
    profile: playerId ? getPlayerProfile(playerId) : null,
    loading: scribeMemoryCache.loading,
    error: scribeMemoryCache.error,
    rowError: scribeFileRowError,
  });
  bindScribeFileBody(ov);
}

function bindScribeFileBody(ov) {
  if (!ov?.querySelectorAll) return;
  ov.querySelectorAll('[data-mem-del]').forEach(btn => btn.addEventListener('click', async () => {
    await scribeFileDeleteRow(btn.dataset.memDel);
    repaintScribeFileBody(ov);
  }));
  // Reuses quoteHTML()'s `data-jump` attribute and the SAME scroll+flash
  // mechanism the notification deep link already owns (deepLinkTo →
  // `[data-mid]` + `.chat-flash`). No new navigation mechanism (DI-D4).
  ov.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => {
    const messageId = btn.dataset.jump;
    ov.remove();
    deepLinkTo({ tab: 'chat', params: { messageId } });
  }));
  ov.querySelector('#scribe-hardline-add-btn')?.addEventListener('click', async () => {
    const input = ov.querySelector('#scribe-hardline-input');
    const value = input?.value || '';
    if (!String(value).trim()) return;
    await scribeFileAddTopic(value);
    repaintScribeFileBody(ov);
  });
  ov.querySelectorAll('[data-tolerance]').forEach(btn => btn.addEventListener('click', async () => {
    await scribeFileSetTolerance(btn.dataset.tolerance);
    repaintScribeFileBody(ov);
  }));
}

/**
 * DI-D4's surface. `.modal-overlay.centered .modal` verbatim (the game modal
 * / Notification Center precedent) — no new sheet component.
 *
 * Signed out returns null without rendering anything: the entry point in the
 * chat prefs panel is already hidden for an anonymous viewer, and this is the
 * second lock on the same door (the `_playerPref` no-op-without-session
 * pattern DI-D4 names).
 */
export async function openScribeFileModal() {
  const playerId = getSession()?.playerId || '';
  if (!playerId) return null;
  const ov = document.createElement('div');
  ov.className = 'modal-overlay centered';
  ov.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>My SCRIBE File</h3><button class="modal-close" id="scribe-file-close">✕</button></div>
    <div id="scribe-file-body">${renderScribeFileBodyHTML({ loading: true })}</div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#scribe-file-close')?.addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  await refreshScribeMemory(playerId);
  repaintScribeFileBody(ov);
  return ov;
}

/**
 * The entry point lives in the chat prefs panel (js/chat-ui.js —
 * `prefsPanelHTML()`, where chatNick/accent are edited, which is the player
 * settings surface DI-D4 names). It is wired HERE, delegated on `document`,
 * for two reasons: chat-ui.js re-renders that panel on every prefs change, so
 * a directly-bound listener would go stale; and a direct import would make
 * chat-ui.js depend on app.js, which imports chat-ui.js — a cycle. Same
 * delegation shape `wireRevealCloser()` already uses one module over.
 */
// Item 10 — LATCHED, and called from BOTH boot phases (early and late). The
// early phase exists so a player who taps during the 10-20s hydrate gets the
// modal (with its loading skeleton, then real rows once the fetch lands)
// rather than a dead button; the latch is what makes calling it twice free.
let scribeFileEntryWired = false;
export function wireScribeFileEntry() {
  if (scribeFileEntryWired) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  scribeFileEntryWired = true;
  document.addEventListener('click', e => {
    const btn = e.target?.closest?.('[data-scribe-file]');
    if (!btn) return;
    // Item 10 (reviewer, 2026-09-11) — CATCH IT. `openScribeFileModal()` is
    // async and its result is intentionally discarded here, which without a
    // catch makes any throw inside it an unhandled rejection: no modal, no
    // message, nothing in the UI to explain it. It already handles its own
    // fetch failure (the error state renders inline); this covers the
    // genuinely unexpected, and says so out loud rather than silently.
    openScribeFileModal().catch(err => {
      console.warn('[scribe-memory] could not open My SCRIBE File', err);
      showToast("Couldn't open your SCRIBE file — try again.", 'error');
    });
  });
}

// ─── PICK PERMISSION ──────────────────────────────────────────────────────────

/**
 * Exported for the harness, the same reason `canViewOtherPicks()` below is:
 * these two predicates are the two halves of UN-116's need — you may see the
 * field only once you can no longer act on what you see — and they have to be
 * asserted together or one can silently drift away from the other.
 */
export function canPlayerSubmitPicks(week, playerId) {
  if (!week)     return { allowed:false, reason:'No active week.' };
  if (!playerId) return { allowed:false, reason:'Not logged in.' };
  const eff = getEffectiveWeekStatus(week);
  if (eff==='draft')  return { allowed:false, reason:"Commissioner hasn't opened the week yet." };
  // RG (2026-08-13) — the SECOND HALF of the defect below, identical mechanism.
  // With Auto-Open At set and Auto-Lock left blank, getEffectiveWeekStatus()
  // reports 'open' for a week the app advanced to LOCKED, so this branch never
  // fired and the commissioner's explicit lock was silently inert: picks stayed
  // submittable for the whole lock window (auto-lock → each game's kickoff),
  // with per-game isGamePickable() the only remaining brake. Not a leak —
  // arePicksPublic() is correctly false on a locked week — but the lock is the
  // commissioner's control over the slate, not advice. Same fail-closed shape:
  // consult week.status alongside eff, and only ever DENY.
  if (eff==='locked' || week.status==='locked') return { allowed:false, reason:'Week is locked — no new picks accepted.' };
  if (eff==='final')  return { allowed:false, reason:'Week is finalized.' };
  // RG (2026-08-12) — `week.status` is consulted alongside `eff` for the same
  // reason arePicksPublic() does it: getEffectiveWeekStatus() tests
  // picksOpenAt/picksLockAt BEFORE week.status and has no 'live' branch, so on
  // a week with Auto-Open At set and Auto-Lock left blank it reports 'open' for
  // a week the app itself advanced to LIVE — and the eff==='live' line below
  // could never fire. Picks stayed submittable after kickoff, and once the
  // blind-rule fix unblinded that same window a player could have read the
  // whole field and then changed a pick on a game that had not kicked off yet.
  // Fail-closed: this only ever DENIES, and only once the week is really live.
  if (eff==='live' || week.status==='live') return { allowed:false, reason:'Games are in progress — picks closed.' };
  return { allowed:true, reason:'' };
}

function isGamePickable(game) {
  const ov = getGameLockOverrides();
  if (ov[game.gameId] === 'unlocked') return true;
  if (game.status === GAME_STATUS.LIVE || game.status === GAME_STATUS.FINAL) return false;
  if (!game.kickoff) return true;
  return new Date() < new Date(game.kickoff);
}

/**
 * Whether THE CURRENT SESSION is allowed to see OTHER players' picks,
 * tiebreaker guesses and Extra Point guesses for this week. Admin always;
 * otherwise only once `arePicksPublic()` says so (live or final).
 *
 * Takes no viewer id ON PURPOSE. It used to accept a `viewerPlayerId` that the
 * body never read — every answer came from getSession() — and once this became
 * an exported function that vestigial parameter was a trap: it advertises
 * per-viewer semantics this function does not have, so a caller could pass some
 * other player's id and be handed the CURRENT user's answer without noticing.
 * Removed 2026-08-13 rather than documented, because the signature is what a
 * caller reads.
 *
 * UN-116, 2026-08-12 — the `hasPlayerSubmitted()` branch that used to be here
 * was the defect. Submitting was treated as EARNING the right to see everyone
 * else, but submitting does not end your ability to act on what you see:
 * "Player picks are editable while the slate is open" is a locked decision, and
 * the submit view ships an "Edit My Picks" button. So a player could submit,
 * read the other five players' entire slate, then quietly change their own.
 * With a weekly cash prize on the line that is not a cosmetic bug.
 *
 * Visibility must key off a state the viewer cannot undo. It now does.
 */
export function canViewOtherPicks(week) {
  if (!week) return false;
  if (arePicksPublic(week)) return true;

  // RG-37 — THE ADMIN BYPASS WAS THE LEAK, and it shipped in v0.17.7 because
  // nobody ever questioned it. Drew, 2026-08-26, seeing it live:
  //   "I shouldnt be able to see everyone elses picks while I can still submit
  //    OR edit mine. It needs to be completely blinded until the games are live."
  //
  // He is BOTH the commissioner and a player. `if (sess.isAdmin) return true`
  // handed him the entire field's picks while his own were still editable —
  // precisely the exploit UN-116 was built to close, left wide open for the one
  // person who could most easily use it.
  //
  // The bypass now requires the viewer to have NO STAKE in this week: a
  // commissioner who cannot submit or edit here still sees everything (needed
  // to verify picks landed, chase a missing entry, debug). One who CAN still
  // act is blinded like anybody else. A pure commissioner account with no
  // playerId gets `allowed:false` from canPlayerSubmitPicks and keeps the
  // bypass, so non-playing co-commissioners are unaffected.
  //
  // The invariant, asserted directly in loadtest [34g] across every status ×
  // date-field combination for BOTH roles: you may never be able to submit
  // your own picks and see someone else's at the same time.
  const sess = getSession();
  if (sess.isAdmin && !canPlayerSubmitPicks(week, sess.playerId).allowed) return true;
  return false;
}

// ─── PICKS PAGE ───────────────────────────────────────────────────────────────

function renderPicksPage() {
  // v0.16.0 dispatcher — supports viewing previous locked/closed weeks
  // (read-only) and appends the week-nav + recap footer around every branch
  // of the current-week renderer.
  const c = document.getElementById('page-picks'); if (!c) return;
  const currentWeek = getCurrentWeek();
  const viewWeek = state.picksWeekId ? getWeek(state.picksWeekId) : null;
  if (viewWeek && currentWeek && viewWeek.weekId !== currentWeek.weekId) {
    renderHistoricalPicksView(c, viewWeek, currentWeek);
    // UN-124 — last card in EVERY state, including the historical-week branch
    // (this branch returns early, so it needs its own append).
    c.insertAdjacentHTML('beforeend', renderWhatsNewCardHTML());
    return;
  }
  state.picksWeekId = null;
  renderPicksPageCurrent();
  c.insertAdjacentHTML('afterbegin', renderPicksWeekNav(currentWeek, currentWeek));
  bindPicksWeekNav();
  // Hide the permanent-record / previous-recap footer when a logged-in player
  // is actively engaged with THIS week (picking or reviewing their picks). The
  // permanent record is context for outsiders and the commissioner — a signed-in
  // player's picks tab should stay focused on the games at hand.
  const session = getSession();
  const playerActivelyInPicks = session?.playerVerified && session?.playerId && !session?.isAdmin;
  if (!playerActivelyInPicks) {
    c.insertAdjacentHTML('beforeend', renderPicksFooterHTML(currentWeek));
  }
  // UN-124 — last card on the Picks tab in EVERY state: signed-out (login
  // screen), signed-in mid-form, submitted, and locked-week. Unconditional —
  // unlike the footer above, this must reach a player who stays logged in.
  c.insertAdjacentHTML('beforeend', renderWhatsNewCardHTML());
}

/** Weeks a player may browse on the Picks tab: current week + anything locked/live/final. Demo weeks are commissioner-only. */
function picksNavWeeks() {
  const cur = getCurrentWeek();
  const session = getSession();
  const isCommissioner = !!session?.isAdmin;
  const weeks = getWeeks().filter(w => w.showInHistory !== false && w.status !== WEEK_STATUS.DRAFT &&
    // Demo weeks: commissioner sees always; non-commissioners never see (even if it's the active week).
    (w.dataSourceMode !== 'demo' || isCommissioner));
  return weeks.sort((a, b) => String(a.season).localeCompare(String(b.season)) || a.weekNumber - b.weekNumber);
}

function renderPicksWeekNav(viewWeek, currentWeek) {
  if (!viewWeek) return '';
  const weeks = picksNavWeeks();
  if (weeks.length < 2) return '';
  const idx = weeks.findIndex(w => w.weekId === viewWeek.weekId);
  const prev = idx > 0 ? weeks[idx - 1] : null;
  const next = idx >= 0 && idx < weeks.length - 1 ? weeks[idx + 1] : null;
  const isCurrent = viewWeek.weekId === currentWeek?.weekId;
  return `
    <div class="picks-week-nav">
      <button class="btn btn-ghost btn-sm" data-picks-week="${prev ? escHtml(prev.weekId) : ''}" ${prev ? '' : 'disabled'}>‹</button>
      <div class="picks-week-nav-label">${escHtml(formatWeekLabel(viewWeek))}${isCurrent ? ' <span class="picks-week-current">· current</span>' : ' <span class="picks-week-past">· past week (read-only)</span>'}</div>
      <button class="btn btn-ghost btn-sm" data-picks-week="${next ? escHtml(next.weekId) : ''}" ${next ? '' : 'disabled'}>›</button>
    </div>`;
}

function bindPicksWeekNav() {
  document.querySelectorAll('[data-picks-week]').forEach(b => b.addEventListener('click', () => {
    if (!b.dataset.picksWeek) return;
    const cur = getCurrentWeek();
    state.picksWeekId = (b.dataset.picksWeek === cur?.weekId) ? null : b.dataset.picksWeek;
    renderPicksPage();
    window.scrollTo({ top: 0 });
  }));
}

/** Read-only view of a previous locked/closed week (v0.16.0). Blind-picks rule
 *  preserved: for LOCKED weeks only the viewer's own picks show; live/final
 *  weeks are public just like the dashboard. */
function renderHistoricalPicksView(c, week, currentWeek) {
  const session = getSession();
  const isPublic = arePicksPublic(week);
  const games = getGames(week.weekId).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const myId = session.playerId && session.playerVerified ? session.playerId : null;

  let body = '';
  if (!isPublic && !myId) {
    body = `<div class="week-status-card"><div class="week-status-icon">🔒</div>
      <div class="week-status-body"><div class="week-status-title">Locked week</div>
      <div class="week-status-msg">Log in on the current week to view your own picks for this week.</div></div></div>`;
  } else {
    const myPicks = myId ? getPicks(week.weekId, myId) : [];
    const rows = games.map(g => {
      const pick = myPicks.find(p => p.gameId === g.gameId) || null;
      const ats = g.atsWinner ?? calculateAtsWinner(g);
      const showAts = isPublic && ats;
      let pickBadge = '';
      if (pick) {
        const res = evaluatePick(pick, g);
        pickBadge = `<span class="hist-pick ${getResultBadgeClass(res)}">${escHtml(pick.selectedTeam)} ${res === PICK_RESULT.WIN ? '✓' : res === PICK_RESULT.LOSS ? '✗' : ''}</span>`;
      }
      const score = (g.homeScore != null && g.awayScore != null) ? `${g.awayScore}–${g.homeScore}` : '';
      return `<div class="hist-game-row">
        <div class="hist-matchup">${escHtml(getTeamDisplay(g, 'away'))} @ ${escHtml(getTeamDisplay(g, 'home'))}
          <span class="text-muted text-xs">${escHtml(formatSpread(g.lockedSpread ?? g.spread, g.favorite, g) || '')}</span></div>
        <div class="hist-right">${score ? `<span class="hist-score">${score}</span>` : ''}
          ${showAts && ats !== 'no_decision' ? `<span class="hist-ats">ATS: ${escHtml(ats)}</span>` : showAts ? '<span class="hist-ats">Push</span>' : ''}
          ${pickBadge}</div>
      </div>`;
    }).join('');
    body = `<div class="card mb-md">${rows || '<p class="text-muted">No games recorded for this week.</p>'}</div>`;
  }

  c.innerHTML = `
    ${renderPicksWeekNav(week, currentWeek)}
    ${renderWeekBanner(week)}
    ${body}
    ${week.status === 'final' ? renderWeekRecapCardHTML(week) : ''}`;
  bindPicksWeekNav();
}

function renderPicksPageCurrent() {
  const c = document.getElementById('page-picks'); if (!c) return;
  const session = getSession();
  const week    = getCurrentWeek();

  if (!session.playerId || !session.playerVerified) {
    c.innerHTML = renderLoginScreen(week); bindLoginScreen(); return;
  }

  const player = getPlayer(session.playerId);
  if (!player) { clearSession(); clearPickDraft(); resyncPlayerPreferences(); renderPicksPage(); return; }

  const games       = week ? getGames(week.weekId).sort((a,b) => new Date(a.kickoff)-new Date(b.kickoff)) : [];
  const submitted   = week ? hasPlayerSubmitted(week.weekId, session.playerId) : false;
  const displayName = week ? getDisplayNamePlain(week.weekId, session.playerId, getPlayers()) : player.displayName;
  const { allowed, reason } = canPlayerSubmitPicks(week, session.playerId);

  if (submitted && !state.editingPicks) { renderSubmittedView(c, week, games, session, displayName); return; }

  if (!allowed) {
    const ep = week ? getPicks(week.weekId, session.playerId) : [];
    c.innerHTML = `
      ${renderWeekBanner(week)}
      <div class="week-status-card">
        <div class="week-status-icon">🔒</div>
        <div class="week-status-body">
          <div class="week-status-title">Logged in as ${escHtml(displayName)}</div>
          <div class="week-status-msg">${escHtml(reason)}</div>
          ${ep.length ? `<div class="text-muted text-xs mt-sm">${ep.length}/${games.length} picks saved.</div>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm mt-md" id="logout-btn">Log Out / Switch Player</button>`;
    document.getElementById('logout-btn')?.addEventListener('click', () => { clearSession(); clearPickDraft(); resyncPlayerPreferences(); renderPicksPage(); });
    return;
  }

  // When entering edit mode (player came back to update already-submitted
  // picks), pre-fill state.draftPicks from the saved picks so the UI shows
  // their current selections as already chosen. Same for the tiebreaker.
  if (state.editingPicks && Object.keys(state.draftPicks).length === 0) {
    const existing = getPicks(week.weekId, session.playerId);
    existing.forEach(p => { state.draftPicks[p.gameId] = p.selectedTeam; });
    const tb = getTiebreakerGuess(week.weekId, session.playerId);
    if (tb !== null && tb !== undefined) state.draftTiebreaker = tb;
    const ep = getExtraPointGuess(week.weekId, session.playerId);
    if (ep !== null && ep !== undefined) state.draftExtraPoint = ep;
  }

  c.innerHTML = `
    ${renderWeekBanner(week)}
    ${renderPicksTiming(week, games)}
    <div class="flex-between mb-md">
      <div><span class="text-maroon font-display" style="font-size:1.05rem">${escHtml(displayName)}</span>
      <span class="text-muted text-sm"> — ${state.editingPicks?'update your picks':'make your picks'}</span></div>
      <button class="btn btn-ghost btn-sm" id="logout-btn">Log Out</button>
    </div>
    ${state.editingPicks?'<div class="edit-mode-banner">✏️ You\'re updating picks you already submitted. Changes save when you click Submit again.</div>':''}
    ${getSettings().randomizePicksEnabled?`<div class="flex-between mb-sm randomize-row">
      <span class="text-muted text-xs">Need a quick start? Randomize then edit anything you want to change.</span>
      <button class="btn btn-ghost btn-sm" id="randomize-picks-btn" title="Randomly pick a team for each game">🎲 Randomize My Picks</button>
    </div>`:''}
    <div id="games-list"></div>
    ${renderTiebreakerInput(week)}
    ${renderExtraPointInput(week)}
    <div class="submit-bar">
      <div class="submit-progress"><strong id="pick-count">0</strong>/${games.length} + tiebreaker</div>
      <button class="btn btn-primary" id="submit-picks-btn" disabled>${state.editingPicks?'Update Picks':'Submit All Picks'}</button>
    </div>`;

  document.getElementById('logout-btn')?.addEventListener('click', () => { clearSession(); clearPickDraft(); resyncPlayerPreferences(); renderPicksPage(); });
  document.getElementById('tb-input')?.addEventListener('input', e => {
    state.draftTiebreaker = e.target.value !== '' ? parseFloat(e.target.value) : null;
    updateSubmitEnabled(games, week);
  });
  document.getElementById('ep-input')?.addEventListener('input', e => {
    state.draftExtraPoint = e.target.value !== '' ? parseInt(e.target.value, 10) : null;
  });
  // Priority 8: Randomize-my-picks button. Operates only on games still
  // pickable (skips locked/live/final), so it can be safely re-clicked late
  // in the week without overwriting already-decided picks the player can't
  // change anyway. Picks are written into `state.draftPicks` (not submitted)
  // so the player can still review/edit before hitting Submit.
  document.getElementById('randomize-picks-btn')?.addEventListener('click', () => {
    const pickable = games.filter(isGamePickable);
    if (!pickable.length) { showToast('No games are still open to pick','warning'); return; }
    // Math.random() is fine here — not seeded by player ID or any deterministic
    // input, so every click produces a fresh selection.
    pickable.forEach(g => {
      const pickHome = Math.random() < 0.5;
      state.draftPicks[g.gameId] = pickHome ? g.homeTeam : g.awayTeam;
    });
    renderGamesList(games, week);
    bindPickButtons(games, week);
    updateSubmitEnabled(games, week);
    showToast(`🎲 Randomized ${pickable.length} pick${pickable.length>1?'s':''} — review and submit when ready`, 'success');
  });
  renderGamesList(games, week);
  bindPickButtons(games, week);
  document.getElementById('submit-picks-btn')?.addEventListener('click', () => submitPicks(week, games));
  updateSubmitEnabled(games, week);
}

/** v0.16.0 — The Ischemic Extra Point guess input (optional side bet). */
function renderExtraPointInput(week) {
  if (!week || week.extraPointEnabled === false) return '';
  const val = state.draftExtraPoint !== null && state.draftExtraPoint !== undefined ? state.draftExtraPoint : '';
  return `
    <div class="card mb-md ep-input-card">
      <label class="form-label" for="ep-input">🎯 The Ischemic Extra Point <span class="text-muted text-xs">(blackjack rules)</span></label>
      <p class="text-muted text-xs mb-sm">Longest MADE field goal on this week's slate, in yards. Closest without going over wins. Over = bust. Exact = blackjack.</p>
      <input class="form-input" id="ep-input" type="number" inputmode="numeric" min="15" max="75" step="1"
        placeholder="e.g. 52" value="${val}" />
    </div>`;
}

function renderTiebreakerInput(week) {
  if (!week?.tiebreakerQuestion) return '';
  return `<div class="tiebreaker-card">
    <div class="tiebreaker-label">🎯 Weekly Tiebreaker (Required)</div>
    <div class="tiebreaker-question">${escHtml(week.tiebreakerQuestion)}</div>
    <input class="form-input" id="tb-input" type="number" min="0" step="1"
      placeholder="Your numeric guess…" style="margin-top:10px"
      value="${state.draftTiebreaker !== null && state.draftTiebreaker !== undefined ? state.draftTiebreaker : ''}" />
    <p class="text-muted text-xs mt-sm">Required. Closest guess wins ties.</p>
  </div>`;
}

function renderLoginScreen(week) {
  const players = getPlayers().filter(p => p.active);
  // v0.17.2: the lock deadline is the single best reason to sign in, so it sits
  // above the player grid rather than behind the PIN.
  const games = week ? getGames(week.weekId) : [];
  return `
    ${renderWeekBanner(week)}
    ${renderLockCountdownHTML(week, games)}
    <div class="card">
      <div class="card-header"><span class="card-title">👤 Who Are You?</span></div>
      <p class="text-secondary text-sm mb-md">Select your name and enter your PIN.</p>
      <div class="player-grid" id="player-grid">
        ${players.map(p => {
          const sub  = week ? hasPlayerSubmitted(week.weekId, p.playerId) : false;
          const nick = week ? getNickname(week.weekId, p.playerId) : null;
          return `<button class="player-tile${sub?' has-submitted':''}" data-player-id="${p.playerId}">
            <div class="player-avatar">${escHtml(getPlayerInitials(p))}</div>
            <div class="player-tile-name">${escHtml(p.displayName)}</div>
            ${nick ? `<div class="player-tile-nick">"${escHtml(nick)}"</div>` : ''}
            ${sub ? '<div class="player-tile-done">✓ Done</div>' : ''}
          </button>`;
        }).join('')}
      </div>
      <div id="pin-area" style="display:none;margin-top:16px">
        <div class="divider"></div>
        <p class="text-sm mb-sm">PIN for <strong id="selected-name"></strong>:</p>
        <div class="flex gap-sm">
          <input class="form-input" id="pin-input" type="password" inputmode="numeric"
            maxlength="8" placeholder="PIN…" style="flex:1;letter-spacing:.2em;font-size:1.2rem"/>
          <button class="btn btn-primary" id="pin-submit-btn">Enter →</button>
        </div>
        <button class="btn btn-ghost btn-sm mt-sm" id="cancel-player-btn">← Back</button>
      </div>
    </div>`;
}

/**
 * Copy for a rejected PIN entry.
 *
 * RG-40 — verifyPlayerPin() now fails CLOSED, so an account whose `pinHash` a
 * deploy destroyed (RG-39) rejects every PIN its owner types. Telling that
 * player "❌ Incorrect PIN" is wrong twice over: it is inaccurate — they typed
 * it correctly — and it reads as the app having eaten their identity. They will
 * try the same four digits five times and then call Drew. So the two failures
 * get two messages: one says you mistyped it, the other says there is nothing
 * to type yet and names who can fix it.
 *
 * It deliberately does NOT say "your PIN was erased." From the player's side
 * the two cases (never set, since erased) are indistinguishable and the action
 * is identical, and an app announcing that it lost their credentials is
 * alarming out of proportion to a 30-second fix.
 *
 * An unknown playerId falls through to the generic message rather than the
 * explanatory one, so this never becomes a way to enumerate which ids exist.
 *
 * Exported as its own function — rather than inlined at the one call site in
 * bindLoginScreen() — because bindLoginScreen() only exists inside a live DOM
 * and cannot be reached from the harness, and the alternative (asserting the
 * string appears somewhere in app.js) is the RG-27 anti-pattern. Asserted in
 * loadtest [56].
 */
export function loginFailureMessage(playerId) {
  if (playerId && getPlayer(playerId) && !hasPlayerPin(playerId)) {
    return '🔑 No PIN is set for this account yet — ask Drew to set one in the Commissioner panel.';
  }
  return '❌ Incorrect PIN';
}

/**
 * RG-40 — EXPORTED SO THE GATE ITSELF CAN BE TESTED, not just its parts.
 *
 * Until this export existed, `verifyPlayerPin()` had exactly one caller in the
 * whole app — the `doLogin` closure below — and that caller was unreachable
 * from the harness, so NOTHING asserted that the login screen consults the PIN
 * at all. Replacing the check with `if (true)` passed a fully green suite.
 * That is the RG-27 shape at the worst possible place: an authentication gate
 * whose only coverage is of a predicate nobody proves is called.
 *
 * loadtest [56f] now drives this function through a fixture DOM and asserts on
 * the SESSION it grants and the TOAST it shows.
 */
export function bindLoginScreen() {
  let selectedId = null;
  document.querySelectorAll('.player-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      selectedId = tile.dataset.playerId;
      const p = getPlayer(selectedId);
      document.querySelectorAll('.player-tile').forEach(t => t.classList.toggle('selected', t === tile));
      const pa = document.getElementById('pin-area'); if (pa) pa.style.display='block';
      const ne = document.getElementById('selected-name'); if (ne&&p) ne.textContent=p.displayName;
      document.getElementById('pin-input')?.focus();
    });
  });
  document.getElementById('cancel-player-btn')?.addEventListener('click', () => {
    selectedId=null;
    const pa=document.getElementById('pin-area'); if(pa)pa.style.display='none';
    document.querySelectorAll('.player-tile').forEach(t=>t.classList.remove('selected'));
  });
  const doLogin = () => {
    if (!selectedId) return;
    const pin = document.getElementById('pin-input')?.value||'';
    if (verifyPlayerPin(selectedId, pin)) {
      setSession(selectedId, false, true); clearPickDraft();
      // Per-player preferences: re-resolve theme + TZ for the newly-logged-in
      // player (they may differ from device default or previous player).
      resyncPlayerPreferences();
      showToast('✅ Logged in!','success'); renderPicksPage();
      // UN-115: tapping a player tile focuses the PIN input, which the mobile
      // browser auto-scrolls to lift above the keyboard. That scroll offset
      // survives the renderPicksPage() re-render (a much taller tree replaces
      // #page-picks) and lands the player mid-form. Must run AFTER the
      // re-render — resetting scroll on the DOM about to be replaced does
      // nothing. Instant, not smooth — same call bindPicksWeekNav() already
      // uses for the identical "landed mid-page" case.
      window.scrollTo({ top: 0 });
      // v0.17.2: if they came here from the chat composer's "Log in" button,
      // bounce them back to the thread they were reading (doc 1.2).
      try { resumeChatAfterLogin(); } catch {}
    } else {
      showToast(loginFailureMessage(selectedId),'error');
      const pi=document.getElementById('pin-input'); if(pi){pi.value='';pi.focus();}
    }
  };
  document.getElementById('pin-submit-btn')?.addEventListener('click', doLogin);
  document.getElementById('pin-input')?.addEventListener('keydown', e => { if(e.key==='Enter')doLogin(); });
}

function renderSubmittedView(c, week, games, session, displayName) {
  const picks   = getPicks(week.weekId, session.playerId);
  const tbGuess = getTiebreakerGuess(week.weekId, session.playerId);
  // Can the player still edit? Same gating as initial submission — week must
  // be open. Once locked/live/final, the edit button hides.
  const { allowed: canEdit } = canPlayerSubmitPicks(week, session.playerId);
  c.innerHTML = `
    ${renderWeekBanner(week)}
    ${renderPicksTiming(week, games)}
    <div class="flex-between mb-md">
      <div><span class="text-maroon font-display" style="font-size:1.05rem">${escHtml(displayName)}</span>
      <span class="text-muted text-sm"> — picks submitted ✓</span></div>
      <button class="btn btn-ghost btn-sm" id="logout-btn">Log Out</button>
    </div>
    ${tbGuess!==null?`<div class="tiebreaker-card tiebreaker-submitted">
      <span class="tiebreaker-label">🎯 Your Tiebreaker Guess</span>
      <span class="tiebreaker-value">${tbGuess}</span>
    </div>`:''}
    <div id="submitted-games"></div>
    <div class="card mt-md text-center" style="padding:16px">
      ${canEdit?'<button class="btn btn-secondary mr-sm" id="edit-picks-btn">✏️ Edit My Picks</button>':''}
      <button class="btn btn-primary" id="go-dash-btn">View Dashboard</button>
    </div>`;
  document.getElementById('logout-btn')?.addEventListener('click', () => { clearSession(); clearPickDraft(); resyncPlayerPreferences(); renderPicksPage(); });
  document.getElementById('go-dash-btn')?.addEventListener('click', () => navigateTo('dashboard'));
  document.getElementById('edit-picks-btn')?.addEventListener('click', () => {
    // Enter edit mode. The picks-page render will pre-fill draftPicks from
    // existing picks and show the editable UI with an explanatory banner.
    state.editingPicks = true;
    clearPickDraft();           // cleared so the prefill block sees a fresh slate
    renderPicksPage();
    window.scrollTo({ top: 0 });   // UN-115 (DI-115b): same driver as login — the form replaces the submitted view
  });
  const list = document.getElementById('submitted-games'); if (!list) return;
  list.innerHTML = games.map(game => {
    const pick = picks.find(p=>p.gameId===game.gameId);
    return renderGameCard(game, pick?.selectedTeam, pick?evaluatePick(pick,game):PICK_RESULT.PENDING, true, true);
  }).join('');
}

function renderWeekBanner(week) {
  if (!week?.blurb) return '';
  const isDemoWeek = week.dataSourceMode === 'demo';
  return `<div class="week-banner${isDemoWeek?' week-banner-demo':''} mb-md">
    <div class="week-banner-icon">${isDemoWeek?'📋':'📋'}</div>
    <div class="week-banner-body">
      <div class="week-banner-title week-heading">${escHtml(formatWeekLabelParts(week).name)}
        ${isDemoWeek?'<span class="demo-label">DEMO DATA</span>':''}${
        formatWeekLabelParts(week).dates
          ? `<span class="week-heading-dates">${escHtml(formatWeekLabelParts(week).dates)}</span>`
          : ''}</div>
      <div class="week-banner-blurb">${escHtml(week.blurb)}</div>
    </div>
  </div>`;
}

/**
 * Small timing info line shown on the picks page so players know when picks
 * auto-lock and when games go live. Uses the effective (commissioner-set OR
 * derived) times so a bespoke picksLockAt override shows up here too.
 * Hidden entirely if the week has no games yet or is already live/final.
 */
function renderPicksTiming(week, games) {
  if (!week || !games?.length) return '';
  if (week.status === WEEK_STATUS.LIVE || week.status === WEEK_STATUS.FINAL) return '';
  const lockAt = computeEffectiveLockAt(week, games);
  const liveAt = computeEffectiveLiveAt(week, games);
  if (!lockAt && !liveAt) return '';
  const tz = getTimezone();
  const fmt = (d) => d ? formatGameTime(d.toISOString(), tz) : '—';
  const isLocked = week.status === WEEK_STATUS.LOCKED;
  const now = Date.now();
  const lockPassed = lockAt && now >= lockAt.getTime();
  const livePassed = liveAt && now >= liveAt.getTime();
  return `<div class="picks-timing-info mb-md">
    <span class="pt-item ${lockPassed?'pt-passed':''}">🔒 <strong>Picks lock:</strong> ${escHtml(fmt(lockAt))}${isLocked?' <em>(locked)</em>':''}</span>
    <span class="pt-item ${livePassed?'pt-passed':''}">🏈 <strong>Games live:</strong> ${escHtml(fmt(liveAt))}</span>
  </div>`;
}

/**
 * Human "time remaining" for a deadline, e.g. "2d 4h", "3h 12m", "8m".
 * Returns '' once the deadline has passed — callers show a locked state instead.
 */
function timeUntil(target) {
  if (!target) return '';
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return '';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Prominent lock countdown, shown to EVERYONE including signed-out visitors.
 *
 * v0.17.2 (Drew): the auto-lock deadline was only reachable after login, which
 * is backwards — the deadline is the reason to log in. This renders on the
 * picks login screen and on the dashboard's "Go to Picks" prompt.
 *
 * Deliberately contains NO pick data, so it is safe on a signed-out surface
 * and cannot violate the blind rule.
 */
function renderLockCountdownHTML(week, games, { compact = false } = {}) {
  if (!week || !games?.length) return '';
  if (week.status === WEEK_STATUS.LIVE || week.status === WEEK_STATUS.FINAL) return '';
  const lockAt = computeEffectiveLockAt(week, games);
  if (!lockAt) return '';
  const tz = getTimezone();
  const when = formatGameTime(lockAt.toISOString(), tz);
  const left = timeUntil(lockAt);
  const locked = week.status === WEEK_STATUS.LOCKED || !left;

  if (locked) {
    return `<div class="lock-countdown lock-countdown-closed${compact ? ' lock-countdown-compact' : ''}">
      <span class="lock-countdown-icon">🔒</span>
      <div><div class="lock-countdown-main">Picks are locked</div>
      <div class="lock-countdown-sub">Locked ${escHtml(when)}</div></div>
    </div>`;
  }
  const urgent = lockAt.getTime() - Date.now() < 3 * 3600 * 1000;
  return `<div class="lock-countdown${urgent ? ' lock-countdown-urgent' : ''}${compact ? ' lock-countdown-compact' : ''}">
    <span class="lock-countdown-icon">⏳</span>
    <div><div class="lock-countdown-main">Picks lock in ${escHtml(left)}</div>
    <div class="lock-countdown-sub">${escHtml(when)} · ${games.length} game${games.length === 1 ? '' : 's'} on the slate</div></div>
  </div>`;
}

/**
 * The calendar day a kickoff falls on, pinned to CENTRAL — the same league
 * convention getTimeWindow() uses for hour-of-day bucketing, so a game's day
 * label and its window label can never disagree about which day it is.
 *
 * Deliberately NOT routed through dayOfWeekOf(): that helper pins no timezone
 * and inherits the browser's, which would let two players on two coasts see
 * the same slate split across different days. (dayOfWeekOf()'s missing pin is
 * a known separate defect and is untouched here.)
 *
 * The slate builder's closing anchor uses America/Los_Angeles instead, on
 * Drew's 2026-09-03 ruling. That is scoped to SELECTION of a late Saturday
 * game and must not leak here: this is DISPLAY grouping, which stays Central
 * like every other display surface.
 */
function centralDayParts(isoTime) {
  const d = new Date(isoTime);
  try {
    return {
      key:  new Intl.DateTimeFormat('en-CA', { timeZone:'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit' }).format(d),
      name: new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', weekday:'long' }).format(d),
    };
  } catch {
    return { key: String(isoTime || '').slice(0,10), name: '' };
  }
}

function renderGamesList(games, week) {
  const c = document.getElementById('games-list'); if (!c) return;
  const WINDOW_LABEL = {
    morning:'🌅 Morning', afternoon:'☀️ Afternoon',
    evening:'🌆 Evening', late:'🌙 Late Night',
  };

  // Separate games that aren't ready to be picked (no teams / no date) so players
  // never see filler data. They're surfaced as a small notice instead.
  const ready = [];
  const pending = [];
  for (const g of games) {
    (gameDataReadiness(g).level === 'incomplete' ? pending : ready).push(g);
  }

  // RG — "friday evening games are at the bottom after saturday morning games"
  // (Drew, 2026-09-03). This loop used to iterate the FOUR TIME WINDOWS on the
  // outside and filter `ready` on the inside, which made hour-of-day the
  // primary sort key and discarded the calendar day entirely: every morning
  // game on the slate rendered above every evening game, so a Friday 7:00 PM
  // kickoff sat BELOW a Saturday 11:00 AM one, and a Sunday game landed second.
  // The caller's chronological sort (renderPicksPage) was correct and was
  // simply thrown away here — the defect was never in a comparator.
  //
  // Invisible for a full season because every slate was a single Saturday, and
  // within ONE day window order IS chronological. The slate builder (3f18c2a)
  // deliberately pulls Thursday/Friday/Sunday games in, which made it visible.
  //
  // Inverted: games are emitted in kickoff order and a header is written
  // whenever the (day, window) pair changes. Order is therefore the kickoff
  // order BY CONSTRUCTION and can no longer be re-derived from the grouping.
  // A single-day slate produces byte-identical output to the old code.
  const ordered = ready.slice().sort((a,b) => new Date(a.kickoff||0) - new Date(b.kickoff||0));
  // The day name is only added once the slate actually spans more than one
  // Central day. Without it a multi-day slate would repeat a bare "🌆 Evening"
  // header three times with nothing to distinguish them; with it, a single
  // Saturday keeps exactly the labels it has always had.
  const multiDay = new Set(ordered.map(g => centralDayParts(g.kickoff).key)).size > 1;

  let html='';
  let lastKey=null;
  for (const game of ordered) {
    const day = centralDayParts(game.kickoff);
    const key = `${day.key}|${game.timeWindow}`;
    if (key !== lastKey) {
      // Label source stays the STORED game.timeWindow, not a fresh
      // getTimeWindow(game.kickoff). The two disagree on the demo fixtures
      // (authored against Eastern), so recomputing here would silently
      // relabel demo weeks — a change outside this bug. Flagged separately.
      const wl = WINDOW_LABEL[game.timeWindow] || WINDOW_LABEL.afternoon;
      html += `<div class="time-window-label">${multiDay && day.name ? `${escHtml(day.name)} · ${wl}` : wl}</div>`;
      lastKey = key;
    }
    html += renderGameCard(game,state.draftPicks[game.gameId],PICK_RESULT.PENDING,!isGamePickable(game),false);
  }

  if (pending.length) {
    html += `<div class="pending-games-notice">
      <strong>⏳ ${pending.length} game${pending.length>1?'s':''} pending confirmation</strong>
      <span class="text-muted text-xs">The Commissioner is still finalizing the date/time for ${pending.length>1?'these games':'this game'}. ${pending.length>1?'They':'It'} will appear here once confirmed.</span>
    </div>`;
  }

  c.innerHTML = html || '<p class="text-muted text-center mt-lg">No games on the slate yet.</p>';
}

// DI-7 — this is the SHARED player-facing card (Picks page + Dashboard). It
// intentionally gets NO national-TV badge — a deliberate scope boundary, not
// an oversight. Do not mirror the alma badge's footprint here.
// Item 2 Pass B — the score/status block shared by renderGameCard's initial
// render AND updatePicksLiveStatusInPlace()'s surgical DI-2 refresh below.
// Single source of markup so the two paths can never drift (mirrors the
// house rule against duplicating render logic across surfaces). FINAL games
// deliberately never look up liveStatusById — the lookup is gated on
// game.status===LIVE, so a final game's block renders exactly as before
// Item 2 (no-op, per the brief).
function renderLiveScoreBlockHTML(game) {
  if (!((game.status===GAME_STATUS.LIVE||game.status===GAME_STATUS.FINAL) && game.homeScore!==null)) return '';
  const liveEntry = game.status===GAME_STATUS.LIVE ? liveStatusById.get(game.gameId) : null;
  const liveDisp  = liveEntry ? liveStatusDisplay(liveEntry) : null;
  const noPulseCls = liveDisp && liveDisp.pulse===false ? ' score-status-no-pulse' : '';
  return `<div class="live-block">
    <div class="live-score">
      <div class="score-num${game.awayScore>game.homeScore?' score-leading':''}">${game.awayScore}</div>
      <div class="score-status${noPulseCls}">${game.status===GAME_STATUS.LIVE?'🔴 LIVE':'FINAL'}</div>
      <div class="score-num${game.homeScore>game.awayScore?' score-leading':''}">${game.homeScore}</div>
    </div>${liveDisp ? `<div class="live-status-detail text-xs text-muted text-center">${escHtml(liveDisp.text)}</div>` : ''}
  </div>`;
}

// DI-2 — after a successful runAutoRefreshTick(), the Picks tab's game cards
// (both the pre-submission draft cards and the post-submission read-only
// cards — both share renderGameCard's markup, both carry data-game-id) need
// their quarter/clock text to update without a manual refresh. Rebuilding
// the whole card via renderGameCard() would work for the read-only view, but
// the draft view's pick buttons carry click listeners bound once by
// bindPickButtons() — regenerating their markup here would silently drop
// those bindings. So this patches ONLY the .live-block region in place,
// leaving every other node (and its listeners) untouched. FINAL games are
// skipped entirely (deliberate no-op, same as the render path).
// Exported for testability (livestatustest.mjs Pass B) — same rationale as
// renderLeaderboard()/renderDashboardTable() etc. above.
export function updatePicksLiveStatusInPlace(games) {
  for (const game of games) {
    if (game.status !== GAME_STATUS.LIVE) continue;
    const cards = document.querySelectorAll(`#page-picks .game-card[data-game-id="${game.gameId}"]`);
    if (!cards.length) continue;
    const html = renderLiveScoreBlockHTML(game);
    cards.forEach(card => {
      const existing = card.querySelector('.live-block');
      if (existing) {
        if (html) existing.outerHTML = html;
        else existing.remove();
      } else if (html) {
        // Game just went live since the card was last fully rendered — the
        // block didn't exist yet. Insert it right after `.matchup`, the same
        // position renderGameCard's template puts it in.
        card.querySelector('.matchup')?.insertAdjacentHTML('afterend', html);
      }
    });
  }
}

export function renderGameCard(game, pickedTeam, result, isLocked, showResult) {
  const sv = game.lockedSpread!==null ? game.lockedSpread : game.spread;
  // For final games with no spread: show "Final" label; TBD only for future unset games.
  // The provenance ("ESPN · DraftKings" vs "Manual") was confusing players on the
  // picks page so it's been moved to the Commissioner panel only. Players now just
  // see the spread.
  const spreadDisplay = sv !== null
    ? `<span class="spread-badge">${fmtSpread(sv, game.favorite, game)}</span>`
    : game.status === GAME_STATUS.FINAL
      ? `<span class="spread-badge" style="opacity:.55">Final</span>`
      : `<span class="spread-badge" style="opacity:.55;border-style:dashed">TBD</span>`;

  const dqBadge = renderSourceBadge(game);
  const timeStr = fmtTime(game.kickoff, game);  // passes game for TBD detection
  const homeRk  = game.homeRank ? `#${game.homeRank} ` : '';
  const awayRk  = game.awayRank ? `#${game.awayRank} ` : '';
  const dis     = isLocked ? 'disabled' : '';

  // School (Mascot) display
  const homeDisplay = td(game, 'home');
  const awayDisplay = td(game, 'away');
  // Mascot subtitle (only if mascot is set/looked up)
  const homeMasc = homeDisplay !== game.homeTeam ? homeDisplay.match(/\(([^)]+)\)/)?.[1] : '';
  const awayMasc = awayDisplay !== game.awayTeam ? awayDisplay.match(/\(([^)]+)\)/)?.[1] : '';

  // Venue: prefer city/state or city/country over stadium name
  const venueStr = (() => {
    const loc = formatVenueDisplay(game);
    if (!loc) return '';
    return `<span class="game-venue text-muted text-xs">📍 ${escHtml(loc)}${game.neutralSite?' 🌍':''}</span>`;
  })();

  const liveScore = renderLiveScoreBlockHTML(game);

  let atsInfo = '';
  if (showResult && game.status===GAME_STATUS.FINAL) {
    const ats = game.atsWinner??calculateAtsWinner(game);
    const atsLabel = ats==='no_decision'?'No Decision':escHtml(ats||'—');
    atsInfo = `<div class="ats-row">
      <span class="text-xs text-muted">Winner: <strong>${escHtml(game.actualWinner||'—')}</strong></span>
      <span class="text-xs text-muted">ATS: <strong class="${ats==='no_decision'?'result-nd':'text-maroon'}">${atsLabel}</strong></span>
    </div>`;
  }

  // Live tentative ATS badge — shows covering/not covering during live game
  let liveAtsBadge = '';
  if (showResult && game.status===GAME_STATUS.LIVE && game.homeScore!==null && sv!==null && pickedTeam) {
    const adjusted    = game.homeScore + sv;
    const homeCovering = adjusted > game.awayScore;
    const pickedHome   = pickedTeam === game.homeTeam;
    const covering     = pickedHome ? homeCovering : !homeCovering;
    liveAtsBadge = covering
      ? `<span class="badge badge-live-covering">⚡ Covering</span>`
      : `<span class="badge badge-live-trailing">⚡ Trailing</span>`;
  }

  const homeCls = `pick-btn ${getBtnClass(game.homeTeam,pickedTeam,result,showResult,game)}`;
  const awayCls = `pick-btn ${getBtnClass(game.awayTeam,pickedTeam,result,showResult,game)}`;

  return `<div class="game-card${game.isAlmaMaterGame?' alma-mater':''}" data-game-id="${game.gameId}">
    <div class="game-card-header">
      <div class="flex gap-sm flex-center">
        <span class="game-time">${timeStr}</span>
        ${game.isAlmaMaterGame?'<span class="alma-mater-badge">⭐ Alma Mater</span>':''}
        ${renderGameBadges(game)}
        ${dqBadge}
      </div>
      <div class="flex gap-sm flex-center">
        ${isLocked?'<span class="badge badge-locked">🔒</span>':''}
        ${showResult&&pickedTeam&&game.status===GAME_STATUS.FINAL?`<span class="badge ${getResultBadgeClass(result)}">${getPickStatusLabel(result)}</span>`:''}
        ${liveAtsBadge}
      </div>
    </div>
    <div class="game-card-body">
      <div class="matchup">
        <div class="team away">
          ${awayRk?`<div class="team-rank">${awayRk}</div>`:''}
          <div class="team-name">${escHtml(game.awayTeam)}${awayMasc?` <span class="team-mascot">(${escHtml(awayMasc)})</span>`:''}</div>
          <div class="team-conf">${escHtml(game.awayConference||'')}</div>
        </div>
        <div class="vs-divider">@</div>
        <div class="team home">
          ${homeRk?`<div class="team-rank">${homeRk}</div>`:''}
          <div class="team-name">${escHtml(game.homeTeam)}${homeMasc?` <span class="team-mascot">(${escHtml(homeMasc)})</span>`:''}</div>
          <div class="team-conf">${escHtml(game.homeConference||'')}</div>
        </div>
      </div>
      ${liveScore}
      ${atsInfo}
      ${venueStr}
      <div class="spread-row"><span class="text-muted text-xs">Spread:</span>${spreadDisplay}</div>
      ${!showResult?`<div class="pick-buttons">
        <button class="${awayCls}" data-team="${escHtml(game.awayTeam)}" data-game-id="${game.gameId}" ${dis}>${escHtml(awayDisplay)}</button>
        <button class="${homeCls}" data-team="${escHtml(game.homeTeam)}" data-game-id="${game.gameId}" ${dis}>${escHtml(homeDisplay)}</button>
      </div>`:''}
      ${game.espnEventId?`<div class="text-muted text-xs mt-sm text-right">ESPN: ${game.espnEventId}</div>`:''}
    </div>
  </div>`;
}

function renderSourceBadge(game) {
  const ds = game.dataSource || game.dataQuality;
  return {
    espn_live:       '<span class="dq-badge dq-espn-live">📡 ESPN Live</span>',
    espn_historical: '<span class="dq-badge dq-espn-hist">📅 ESPN Hist</span>',
    demo:            '<span class="dq-badge dq-demo">📋 Demo</span>',
    proposed:        '<span class="dq-badge dq-proposed">📌 Proposed</span>',
    partial:         '<span class="dq-badge dq-partial">⚠️ Partial</span>',
  }[ds] || '';
}

function getBtnClass(team, pickedTeam, result, showResult, game=null) {
  if (!showResult || result===PICK_RESULT.PENDING) return team===pickedTeam?'selected':'';
  // Live: tentative coloring
  if (result===PICK_RESULT.LIVE && game && game.homeScore!==null) {
    const sv = game.lockedSpread!==null ? game.lockedSpread : game.spread;
    if (sv!==null && team===pickedTeam) {
      const adj = game.homeScore + sv;
      const homeCovering = adj > game.awayScore;
      const pickedHome   = team === game.homeTeam;
      const covering     = pickedHome ? homeCovering : !homeCovering;
      return covering ? 'live-covering' : 'live-trailing';
    }
    return team===pickedTeam?'selected':'';
  }
  if (result===PICK_RESULT.LIVE) return team===pickedTeam?'selected':'';
  if (team!==pickedTeam) return '';
  return { win:'locked-win', loss:'locked-loss', no_decision:'locked-nd' }[result]||'selected';
}

/**
 * Live ATS status for a player's pick in an in-progress game.
 * Returns one of: 'covering' | 'trailing' | 'even' | null.
 *  - 'covering': the picked team is currently beating the spread
 *  - 'trailing': the picked team is currently losing the spread
 *  - 'even': exactly on the number right now (tentative push)
 *  - null: not live, no score yet, no spread, or pick missing
 * Used by the dashboard matrix to show a soft, scannable live state
 * (distinct from finalized green/red ✓/✗ boxes).
 */
function livePickStatus(pick, game) {
  if (!pick || !game) return null;
  if (game.status !== GAME_STATUS.LIVE) return null;
  if (game.homeScore === null || game.awayScore === null) return null;
  const sv = game.lockedSpread !== null ? game.lockedSpread : game.spread;
  if (sv === null || sv === undefined) return null;
  const adj = game.homeScore + sv;        // home-perspective adjusted score
  const margin = adj - game.awayScore;    // >0 home covering, <0 away covering
  if (Math.abs(margin) < 0.01) return 'even';
  const homeCovering = margin > 0;
  const pickedHome = pick.selectedTeam === game.homeTeam;
  const covering = pickedHome ? homeCovering : !homeCovering;
  return covering ? 'covering' : 'trailing';
}
function getResultBadgeClass(r) { return{win:'badge-win',loss:'badge-loss',no_decision:'badge-nd',live:'badge-live'}[r]||'badge-draft'; }

function bindPickButtons(games, week) {
  document.querySelectorAll('.pick-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const gid=btn.dataset.gameId; const team=btn.dataset.team;
      state.draftPicks[gid]=team;
      document.querySelectorAll(`.pick-btn[data-game-id="${gid}"]`).forEach(b=>b.classList.toggle('selected',b.dataset.team===team));
      updateSubmitEnabled(games, week);
    });
  });
}

function updateSubmitEnabled(games, week) {
  const count = Object.keys(state.draftPicks).filter(gid=>games.some(g=>g.gameId===gid)).length;
  const el=document.getElementById('pick-count'); if(el)el.textContent=count;
  const btn=document.getElementById('submit-picks-btn'); if(!btn)return;
  const tbReq = !!(week?.tiebreakerQuestion);
  const tbOk  = !tbReq||(state.draftTiebreaker!==null&&!isNaN(state.draftTiebreaker));
  btn.disabled = count<games.length||!tbOk;
}

function submitPicks(week, games) {
  const session=getSession();
  if(!session.playerId||!session.playerVerified)return;
  const{allowed,reason}=canPlayerSubmitPicks(week,session.playerId);
  if(!allowed){showToast(`🔒 ${reason}`,'error');return;}
  // If the shared backend is configured but failing, warn loudly BEFORE
  // accepting the submit. We don't block — the player needs to be able to
  // submit even offline — but they must explicitly acknowledge their picks
  // may not reach the league until sync recovers.
  const banner = document.getElementById('backend-error-banner');
  const syncBroken = isBackendConfigured() && banner && banner.style.display !== 'none';
  if (syncBroken) {
    const ok = confirm(
      '⚠️ Cross-device sync is currently OFF.\n\n' +
      'Your picks will be saved on THIS device but may not reach other ' +
      'players or the commissioner until the connection is restored.\n\n' +
      'Submit anyway?'
    );
    if (!ok) return;
  }
  const newPicks=games.map(game=>{
    const sel=state.draftPicks[game.gameId];
    if(!sel||!isGamePickable(game))return null;
    const existing=getPick(week.weekId,game.gameId,session.playerId);
    if(existing)return{...existing,selectedTeam:sel,updatedAt:new Date().toISOString()};
    return createPick(week.weekId,game.gameId,session.playerId,sel);
  }).filter(Boolean);
  saveAllPicks(newPicks);
  if(state.draftTiebreaker!==null&&!isNaN(state.draftTiebreaker))
    setTiebreakerGuess(week.weekId,session.playerId,state.draftTiebreaker);
  if(state.draftExtraPoint!==null&&!isNaN(state.draftExtraPoint))
    setExtraPointGuess(week.weekId,session.playerId,state.draftExtraPoint);
  // v0.16.0 — system chat event. HARD RULE: count only, never the selections.
  try {
    const totalPicks = getPicks(week.weekId, session.playerId).length;
    emitPicksLockedEvent(week.weekId, session.playerId, totalPicks, games.length);
  } catch {}
  const wasEditing = state.editingPicks;
  clearPickDraft(); state.editingPicks=false;
  showToast(syncBroken
    ? '✅ Picks saved locally. ⚠️ Sync still off — picks not yet shared.'
    : (wasEditing ? '✅ Picks updated!' : '✅ Picks submitted! Good luck!'),'success');
  setTimeout(()=>{ renderPicksPage(); window.scrollTo({ top: 0 }); },300);   // UN-115 (DI-115b): submitted view replaces the form
}

// ─── ALMA MATER WATCH ─────────────────────────────────────────────────────────

/**
 * THE alma-mater roster — one derived list, not a stored/editable setting.
 * Drew's ruling, 2026-09-04, correcting the two-list build (8ae64f4/
 * 55f8908), verbatim: "the roster of alma maters (such as alma mater watch
 * and those filtered in the slate builder) should only be comprised of
 * schools claimed as alma maters by a player. If a player changes their
 * claimed alma mater, this should also change everything else related to
 * alma maters."
 *
 * The distinct, non-empty set of ACTIVE players' `player.almaMater` values,
 * deduped case-insensitively (defensive coercion, CONVENTIONS #7; the
 * player-edit field always writes whatever casing was typed, so this stays
 * defensive at the boundary). EVERY alma-mater consumer in this file reads
 * this ONE function — Alma Mater Watch, Alma Mater Rankings, the ⭐
 * `isAlmaMaterGame` flag (both parse-time via `fetchByDateRange` and the
 * manual Game Modal), the slate builder's Tier 1 guarantee, the Rules tab
 * list, and `calculateAlmaMaterTotal()`'s Auto-Calc. There is no separate
 * "configured roster" — an "unclaimed school in the roster" is not a
 * concept this model has. Two consequences, both intentional: (1) Texas
 * A&M, claimed by both Drew and Kihoon, contributes/renders once, not
 * twice. (2) A school no active player claims does not appear ANYWHERE —
 * not Watch, not Rankings, not the ⭐ flag, not Tier 1, not the Rules tab —
 * even if it's in the ALMA_MATERS catalog. An inactive player's school is
 * excluded entirely, matching every other `getPlayers().filter(p=>p.active)`
 * site in this file. Changing a player's claim (edit or activate/deactivate)
 * calls `recomputeAlmaMaterFlags(claimedAlmaMaters())` immediately after
 * `savePlayer()` at both call sites below, so the ⭐ flag on open/upcoming
 * weeks reflects the new claim without a re-import.
 */
export function claimedAlmaMaters() {
  const seen = new Set();
  const out = [];
  for (const p of getPlayers().filter(p => p.active)) {
    const alma = (p.almaMater || '').trim();
    if (!alma) continue;
    const key = alma.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alma);
  }
  return out;
}

/**
 * `game.isAlmaMaterGame` is computed once, at ESPN-parse time (or in the
 * Game Modal on manual add/edit) — a player claiming/unclaiming a school
 * does NOT retroactively touch it on its own. Called right after a
 * player-edit save or an active/inactive toggle (both change what
 * `claimedAlmaMaters()` returns) so the CURRENT/upcoming slate reflects the
 * new claim immediately rather than requiring a re-import. Scoped to
 * DRAFT/OPEN weeks ONLY — skips
 * LOCKED, LIVE, *and* FINAL (reviewer finding, 2026-09-0x: the code
 * previously skipped only FINAL, which meant it silently rewrote LOCKED and
 * LIVE weeks too, contradicting its own card copy and toasts, which have
 * always said "open/upcoming"). This matters beyond wording: players submit
 * tiebreaker guesses while a week is OPEN, against whatever alma-mater
 * slate exists at that moment; editing the roster after LOCK would silently
 * change the correct answer to a question already asked, and any FINAL
 * week's already-used Auto-Calc must never move retroactively either
 * (CONVENTIONS #25's spirit). Returns the number of games actually
 * changed, for the toast.
 *
 * F1 (2026-09-04, clearing the reviewer BLOCK) — the SLATE
 * (getGames/saveAllGamesForWeek, KEYS.GAMES) is not the only place a game's
 * ⭐ flag lives. The commissioner's Available-Games POOL
 * (getAvailableGames/saveAvailableGames, KEYS.AVAIL_GAMES) is a genuinely
 * SEPARATE storage key that the slate builder reads directly —
 * renderCommPage() builds `candidatePool` from `getAvailableGames(week.
 * weekId)`, never from the slate (js/app.js's renderCommPage, ~line 2992).
 * Before this fix, a claim change re-flagged the slate but never the pool,
 * so the suggested-slate Tier 1 guarantee — and the ⭐ "Alma mater games
 * only" filter pill / pool-row ⭐ badges, which read the SAME pool objects
 * (filterAndGroupAvailableGames(), renderAvailableGamesList()) — kept
 * scoring/showing the OLD claim until the next ESPN re-fetch replaced the
 * pool wholesale. Reproduced verbatim from the design input: fetch
 * candidates, change Kevin to Notre Dame, and the suggested slate still
 * shows Purdue. Now both keys are recomputed for the same DRAFT/OPEN weeks,
 * under the SAME status gate, folded into the ONE `changedGames` count the
 * toast already reports.
 */
export function recomputeAlmaMaterFlags(almaMaters) {
  let changedGames = 0;
  const reflag = g => {
    const isAlma = !!(getAlmaMaterMatch(g.homeTeam, almaMaters) || getAlmaMaterMatch(g.awayTeam, almaMaters));
    return isAlma === g.isAlmaMaterGame ? null : { ...g, isAlmaMaterGame: isAlma };
  };
  for (const w of getWeeks()) {
    if (w.status === WEEK_STATUS.LOCKED || w.status === WEEK_STATUS.LIVE || w.status === WEEK_STATUS.FINAL) continue;

    const games = getGames(w.weekId);
    if (games.length) {
      let weekChanged = false;
      const updated = games.map(g => {
        const r = reflag(g);
        if (!r) return g;
        weekChanged = true; changedGames++;
        return r;
      });
      if (weekChanged) saveAllGamesForWeek(w.weekId, updated);
    }

    const avail = getAvailableGames(w.weekId);
    if (avail.length) {
      let poolChanged = false;
      const updatedAvail = avail.map(g => {
        const r = reflag(g);
        if (!r) return g;
        poolChanged = true; changedGames++;
        return r;
      });
      if (poolChanged) saveAvailableGames(w.weekId, updatedAvail);
    }
  }
  return changedGames;
}

/**
 * F4 (2026-09-04, clearing the reviewer BLOCK) — which alma-mater roster the
 * tiebreaker Auto-Calc (`calculateAlmaMaterTotal()`, scoring.js) should sum
 * against. Mirrors `game.lockedSpread`'s shape one level up: a DRAFT/OPEN
 * week has nothing frozen yet, so the LIVE roster is correct (matches every
 * other alma-mater consumer today). Once a week reaches LOCKED — the same
 * instant `applyWeekStatusChange()`/`tickAutoTransition()`'s auto-lock leg
 * snapshot `week.lockedAlmaMaters` — the Auto-Calc must read THAT snapshot
 * instead, so a claim edit or player deactivation after lock cannot
 * silently move the tiebreaker's correct answer out from under picks
 * players already submitted against it (before this fix, the Auto-Calc
 * always called `claimedAlmaMaters()` live, with no week-status gate at
 * all).
 *
 * A LOCKED/LIVE/FINAL week that carries NO snapshot — any week that locked
 * before this shipped, since old Sheet rows lack the field entirely
 * (absent, not null) — falls back to the LIVE roster rather than throwing
 * or treating "no snapshot" as "zero schools claimed." This is a real,
 * accepted gap for already-locked weeks (their Auto-Calc can still drift
 * with a post-lock claim edit, exactly as before this fix), scoped
 * narrowly to weeks that predate the migration; every week locked from now
 * on is fully frozen.
 */
export function almaMatersForAutoCalc(week) {
  const isFrozenStatus = week?.status === WEEK_STATUS.LOCKED
    || week?.status === WEEK_STATUS.LIVE
    || week?.status === WEEK_STATUS.FINAL;
  if (isFrozenStatus && Array.isArray(week?.lockedAlmaMaters)) return week.lockedAlmaMaters;
  return claimedAlmaMaters();
}

export function renderAlmaMaterWatch(weekId, games) {
  const slateGames = games || getGames(weekId);
  const almaMaters = claimedAlmaMaters();
  const rows = almaMaters.map(alma => {
    const game = slateGames.find(g =>
      getAlmaMaterMatch(g.homeTeam, almaMaters) === alma || getAlmaMaterMatch(g.awayTeam, almaMaters) === alma
    );
    if (!game) {
    return `<div class="alma-watch-row">
        <span class="alma-watch-team">${escHtml(alma)}</span>
        <span class="alma-watch-bye">BYE</span>
      </div>`;
    }
    // Use precise matching to decide which side is the alma mater (avoid Arkansas/Arkansas State false positives)
    const isHome  = getAlmaMaterMatch(game.homeTeam, almaMaters) === alma;
    const opp     = isHome ? teamSchool(game,'away') : teamSchool(game,'home');
    const myRank  = isHome ? game.homeRank : game.awayRank;
    const oppRank = isHome ? game.awayRank : game.homeRank;
    const rankStr = myRank ? `#${myRank} ` : '';
    const oppStr  = oppRank ? `#${oppRank} ${opp}` : opp;
    const loc     = isHome ? 'vs' : '@';
    const timeStr = fmtTime(game.kickoff, game);

    let scoreStr = '';
    if (game.status===GAME_STATUS.FINAL&&game.homeScore!==null) {
      const myScore  = isHome?game.homeScore:game.awayScore;
      const oppScore = isHome?game.awayScore:game.homeScore;
      // STRAIGHT-UP win/loss only — the alma mater watch tracks whether your
      // school won the actual game, not whether they covered the spread.
      // (The picks dashboard handles ATS; this section is just "did my team win?")
      const won = myScore > oppScore;
      const tied = myScore === oppScore;
      const wl = tied ? 'T' : (won ? 'W' : 'L');
      const cls = tied ? 'alma-result-tie' : (won ? 'alma-result-win' : 'alma-result-loss');
      scoreStr = ` · <span class="alma-result-pill ${cls}">${wl} ${myScore}–${oppScore}</span>`;
    } else if (game.status===GAME_STATUS.LIVE&&game.homeScore!==null) {
      const myScore  = isHome?game.homeScore:game.awayScore;
      const oppScore = isHome?game.awayScore:game.homeScore;
      // Tentative live indicator — also straight-up (just who's ahead right now).
      const ahead = myScore > oppScore;
      const tied = myScore === oppScore;
      const status = tied ? 'TIED' : (ahead ? 'WINNING' : 'LOSING');
      const cls = tied ? '' : (ahead ? 'alma-live-ahead' : 'alma-live-behind');
      scoreStr = ` · <span class="alma-live-pill ${cls}"><span class="live-dot"></span>${status} ${myScore}–${oppScore}</span>`;
    }

    return `<div class="alma-watch-row">
      <span class="alma-watch-team">${rankStr}${escHtml(alma)}</span>
      <span class="alma-watch-matchup">${loc} ${escHtml(oppStr)}</span>
      <span class="alma-watch-time">${timeStr}${scoreStr}</span>
    </div>`;
  });

  return `<div class="card mb-md">
    <div class="card-header"><span class="card-title">⭐ Alma Mater Watch</span></div>
    ${rows.join('')}
  </div>`;
}

// ─── UN-105a: horizontal-scroll edge-fade cue ──────────────────────────────
// ONE shared binder for every .dashboard-scroll / .batch-grid-scroll wrapper
// in the app. Call initScrollFades(container) after ANY render that produces
// one of those wrappers — see loadtest.mjs's site-count assertion, which
// exists precisely so a future render site added without this call is caught.
/** Test-only export: recompute (not (re)bind) the fade state for one element. */
export function _updateScrollFadeState(el) {
  if (!el) return;
  const hasOverflow = el.scrollWidth > el.clientWidth + 1;
  el.classList.toggle('scroll-fade-active', hasOverflow);
  if (!hasOverflow) {
    // No real overflow — never hint at a scroll that doesn't exist.
    el.classList.remove('scroll-fade-at-end', 'scroll-fade-scrolled');
    return;
  }
  el.classList.toggle('scroll-fade-scrolled', el.scrollLeft > 1);
  el.classList.toggle('scroll-fade-at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
}

let _scrollFadeResizeBound = false;
/**
 * Bind (idempotently) the edge-fade cue to every .dashboard-scroll /
 * .batch-grid-scroll wrapper inside `root` (defaults to the whole document).
 * Safe — and necessary — to call repeatedly against the SAME DOM:
 *  - a commissioner tab switch flips display:none without rebuilding the
 *    DOM, so a wrapper that was hidden (0×0) at initial render needs a
 *    re-measure once it becomes visible;
 *  - a <details> section (the 2025 season record) starts collapsed, which is
 *    also display:none — its two wrapped tables can't be measured until the
 *    user actually opens it, so we bind a 'toggle' listener too.
 * The per-element scroll listener itself is bound only once (dataset flag)
 * so repeat calls never stack duplicate listeners on the same node.
 */
export function initScrollFades(root) {
  const scope = root || document;
  scope.querySelectorAll('.dashboard-scroll, .batch-grid-scroll').forEach(el => {
    el.classList.add('scroll-fade');
    if (!el.dataset.scrollFadeBound) {
      el.dataset.scrollFadeBound = '1';
      el.addEventListener('scroll', () => _updateScrollFadeState(el), { passive: true });
    }
    _updateScrollFadeState(el);
  });
  scope.querySelectorAll('details').forEach(d => {
    if (d.dataset.scrollFadeToggleBound) return;
    d.dataset.scrollFadeToggleBound = '1';
    d.addEventListener('toggle', () => initScrollFades(d));
  });
  if (!_scrollFadeResizeBound && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    _scrollFadeResizeBound = true;
    window.addEventListener('resize', () => initScrollFades(document));
  }
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

/**
 * RG (2026-09-05) — which weeks the dashboard "Viewing Week" toggle may offer.
 *
 * Extracted from renderDashboardInner() so the rule is unit-testable without a
 * DOM. The reported defect: the commissioner created "Week 1, Part 2", but the
 * dashboard toggle only listed the demo week and Part 1 — Part 2 never appeared.
 * A freshly created week is status:'draft' (createWeek()), and this filter used
 * to exclude ALL drafts unconditionally. Worse, createWeek's caller calls
 * setActiveWeekId() on the new week, so getCurrentWeek() returns that draft and
 * the heading renders "Week ... Part 2" — a week the dropdown could not list.
 * Heading and toggle disagreed.
 *
 * Fix at the right layer: draft weeks stay hidden from PLAYERS (an unopened week
 * is not theirs to view — the blind rule is untouched, drafts are never open),
 * but are VISIBLE to the commissioner, matching both the demo-week escape here
 * and the commissioner panel's own (unfiltered) active-week selector.
 */
export function selectableDashboardWeeks(weeks, isCommissioner) {
  return (weeks || []).filter(w =>
    (w.status !== WEEK_STATUS.DRAFT || isCommissioner) &&
    (w.dataSourceMode !== 'demo' || isCommissioner)
  ).sort((a, b) => b.weekNumber - a.weekNumber);
}

function renderDashboard() {
  renderDashboardInner();
  // v0.16.0 — chat teaser card pinned to the top of the dashboard
  const host = document.getElementById('page-dashboard');
  if (host && !document.getElementById('dash-chat-teaser')) {
    host.insertAdjacentHTML('afterbegin', dashboardChatTeaserHTML());
  }
}

function renderDashboardInner() {
  const c=document.getElementById('page-dashboard'); if(!c)return;
  const session=getSession();
  const isCommissioner = !!session?.isAdmin;
  // Demo weeks are commissioner-only; so are drafts. Filter them out of the
  // week list players see (see selectableDashboardWeeks() for the why).
  const allWeeks=selectableDashboardWeeks(getWeeks(), isCommissioner);
  const currentWeek=getCurrentWeek();
  const currentWeekVisible = currentWeek && (currentWeek.dataSourceMode !== 'demo' || isCommissioner);
  if(!currentWeekVisible && !allWeeks.length){c.innerHTML=emptyState('📊','No Weeks Yet','Commissioner needs to open a week.');return;}

  const displayWeekId=state.dashboardWeekId||(currentWeekVisible?currentWeek?.weekId:null)||allWeeks[0]?.weekId;
  const week=getWeek(displayWeekId)||(currentWeekVisible?currentWeek:null)||allWeeks[0];
  if(!week){c.innerHTML=emptyState('📊','No Week','');return;}
  // Safety: if a stale state.dashboardWeekId points at a demo week, snap back.
  if (week.dataSourceMode === 'demo' && !isCommissioner) {
    state.dashboardWeekId = allWeeks[0]?.weekId || null;
    return renderDashboardInner();
  }

  const isPublic = arePicksPublic(week);

  // Only gate on submission when the week is still open/locked (blind picks rule).
  // Live and final weeks are always visible — no login or submission required.
  if (!isPublic && session.playerId && session.playerVerified && !session.isAdmin) {
    if (!hasPlayerSubmitted(week.weekId, session.playerId)) {
      c.innerHTML=`<div class="empty-state"><div class="empty-state-icon">🔒</div>
        <h3>Submit Your Picks First</h3>
        <p class="text-secondary text-sm">Dashboard is hidden until you submit — keeps it blind.</p>
        <button class="btn btn-primary mt-md" id="go-picks-btn">Make My Picks</button></div>`;
      document.getElementById('go-picks-btn')?.addEventListener('click',()=>navigateTo('picks'));
      return;
    }
  }

  const players=getPlayers().filter(p=>p.active);
  const games=getGames(week.weekId).sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));
  const allPicks=getPicks(week.weekId);
  const actualTB=week.actualTiebreakerValue;
  const weeklyResults=calculateWeeklyResults(week.weekId,players,allPicks,games,actualTB);
  const ps=getProviderState();

  const weekSelector=allWeeks.length>1?`<div class="form-group mb-md">
    <label class="form-label">Viewing Week</label>
    <select class="form-select" id="week-selector">
      ${allWeeks.map(w=>`<option value="${w.weekId}"${w.weekId===week.weekId?' selected':''}>${escHtml(formatWeekLabel(w))} — ${w.status}</option>`).join('')}
    </select>
  </div>`:'';

  c.innerHTML=`
    <div class="section-header">
      <h2 class="week-heading">${escHtml(formatWeekLabelParts(week).name)}${
        formatWeekLabelParts(week).dates
          ? `<span class="week-heading-dates">${escHtml(formatWeekLabelParts(week).dates)}</span>`
          : ''}</h2>
      <div class="subtitle">Dashboard · <span class="badge badge-${week.status}">${week.status}</span></div>
    </div>
    ${weekSelector}
    <div class="refresh-bar">
      <span>${ps.lastScoreRefresh?`Scores: ${new Date(ps.lastScoreRefresh).toLocaleTimeString()}`:'Not refreshed'}</span>
      <button class="refresh-btn-mini" id="manual-refresh-btn">↻ Refresh</button>
    </div>

    <!-- 1. ALL PICKS BY GAME — primary section per requirements (DI-22) -->
    <div class="card mb-md">
      <div class="card-header card-header-row">
        <span class="card-title">📋 All Picks by Game</span>
        <div class="layout-toggle" role="group" aria-label="View density">
          <button class="layout-toggle-btn${(getSettings().dashboardLayout||'standard')==='standard'?' active':''}" data-layout="standard" title="Wide matrix">Standard</button>
          <button class="layout-toggle-btn${getSettings().dashboardLayout==='compact'?' active':''}" data-layout="compact" title="Mobile-friendly stacked view">Compact</button>
        </div>
      </div>
      ${/* DI-116f — players are used to seeing everyone's picks the moment they
            submitted. Without a word of explanation the new blind cells read as
            a bug, and the commissioner fields the question.
            RG-37 — this used to read `!arePicksPublic(week) && !session.isAdmin`,
            a near-copy of the blind rule rather than the rule itself. That was
            harmless while admins saw everything; the moment a commissioner who
            can still edit is blinded, it left HIM staring at ••• cells with the
            one sentence explaining them deliberately suppressed — the fix
            looking exactly like the bug it fixed. Now gated on the SAME
            predicate that draws the cells, so the note and the blinding cannot
            disagree. For a non-admin the two conditions are identical, so no
            player-facing behaviour changes. */''}
      ${!canViewOtherPicks(week)
        ? `<p class="blind-note"><span class="blind-note-icon">🙈</span><span>Other players' picks stay hidden until the games kick off — that way nobody can peek and then change their own. Check back at kickoff to compare.</span></p>`
        : ''}
      ${(getSettings().dashboardLayout==='compact')
        ? `<div class="dashboard-compact">${renderDashboardCompact(players,games,allPicks,weeklyResults,week.weekId,actualTB)}</div>`
        : `<div class="dashboard-scroll">${renderDashboardTable(players,games,allPicks,weeklyResults,week.weekId,actualTB)}</div>`}
    </div>

    <!-- 2. ALMA MATER WATCH -->
    ${renderAlmaMaterWatch(week.weekId, games)}

    <!-- 3. THIS WEEK SCORE SUMMARY (tiebreaker question card now appears below this) -->
    <div class="card mb-md">
      <div class="card-header"><span class="card-title">This Week Score Summary</span></div>
      <table class="leaderboard-table">
        <thead><tr><th>#</th><th>Player</th><th>✅</th><th>❌</th><th>Tiebreaker</th></tr></thead>
        <tbody>
          ${renderScoreSummaryRowsHTML(week, weeklyResults, players, actualTB)}
        </tbody>
      </table>
    </div>

    <!-- 4. TIEBREAKER QUESTION (moved below summary per Priority 11) -->
    ${week.tiebreakerQuestion?`<div class="tiebreaker-card tiebreaker-dashboard">
      <span class="tiebreaker-label">🎯 Tiebreaker: ${escHtml(week.tiebreakerQuestion)}</span>
      ${actualTB!==null?`<div class="tb-actual">Actual: <strong>${actualTB}</strong></div>`:'<div class="text-muted text-xs">Actual answer not entered yet.</div>'}
    </div>`:''}
`;

  document.getElementById('week-selector')?.addEventListener('change',e=>{state.dashboardWeekId=e.target.value;renderDashboard();});
  // Standard / Compact view toggle for the All-Picks-by-Game card. Persists
  // in settings.dashboardLayout so a user's mobile preference sticks across reloads.
  document.querySelectorAll('.layout-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      saveSetting('dashboardLayout', btn.dataset.layout);
      renderDashboard();
    });
  });
  // Wire up reaction chips + "+" pickers in whichever view is rendered
  bindReactionHandlers(players); bindCommentBubbleHandlers();
  // Priority 7: column reorder (drag-and-drop) for both matrix and compact.
  bindColumnReorderHandlers();
  // UN-105a — edge-fade cue for the standard-layout .dashboard-scroll wrapper
  // (a no-op when compact layout is active, since there's nothing to find).
  initScrollFades(c);
  document.getElementById('manual-refresh-btn')?.addEventListener('click',async()=>{
    showToast('🔄 Refreshing…','warning');
    await doRefreshScores(week,games); renderDashboard();
  });
}

/**
 * Priority 7: drag-to-reorder player columns / chips.
 *
 * Implementation:
 *  - Desktop: native HTML5 drag-and-drop (`dragstart` / `dragover` / `drop`).
 *    The browser's drag image gives clear feedback; touch is unaffected.
 *  - Mobile / touch: HTML5 drag doesn't fire from touch on iOS Safari. We add
 *    a LONG-PRESS gate: 350ms of holding still on a chip enters "reorder mode"
 *    (small haptic-style scale animation), then subsequent finger movement
 *    drags. A simple finger swipe to scroll never crosses the 350ms threshold
 *    and so never triggers reorder. Releasing without crossing the threshold
 *    is a no-op (the chip's normal title-tooltip still fires).
 *
 * Persisted: settings.dashboardColumnOrder = [playerId, …]. Re-renders dashboard
 * after a successful reorder so the chips/cells fall into the new positions
 * everywhere consistently.
 */
function bindColumnReorderHandlers() {
  // Use ANY draggable element with data-player-id as a reorder target. Both
  // matrix headers (.player-col) and compact chips (.dc-chip) qualify.
  const draggables = document.querySelectorAll('[data-player-id][draggable="true"]');
  if (!draggables.length) return;

  // ─ Desktop drag-and-drop ─
  let dragSourceId = null;
  draggables.forEach(el => {
    if (el._dragWired) return; el._dragWired = true;

    el.addEventListener('dragstart', (e) => {
      dragSourceId = el.dataset.playerId;
      el.classList.add('col-dragging');
      // dataTransfer is required for Firefox to start a drag
      try { e.dataTransfer.setData('text/plain', dragSourceId); e.dataTransfer.effectAllowed = 'move'; } catch {}
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('col-dragging');
      document.querySelectorAll('.col-drop-target').forEach(n => n.classList.remove('col-drop-target'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.classList.add('col-drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('col-drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('col-drop-target');
      const targetId = el.dataset.playerId;
      if (!dragSourceId || !targetId || dragSourceId === targetId) return;
      reorderPlayerColumn(dragSourceId, targetId);
    });
  });

  // ─ Touch (mobile) long-press → drag ─
  let touchSrc = null;        // playerId of long-pressed source
  let touchEl  = null;        // element being dragged
  let touchTimer = null;
  let touchStart = null;      // {x, y} screen coords of touchstart
  const LONG_PRESS_MS = 350;
  const SCROLL_THRESHOLD = 8; // pixels of pre-press movement that aborts the press

  draggables.forEach(el => {
    if (el._touchWired) return; el._touchWired = true;

    el.addEventListener('touchstart', (e) => {
      // Only respond to single-finger touches. Pinch-zoom etc. should be ignored.
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
      // Start the long-press timer. If the user moves before it fires, the
      // 'touchmove' handler cancels it — preserving normal scroll behaviour.
      touchTimer = setTimeout(() => {
        touchSrc = el.dataset.playerId;
        touchEl = el;
        el.classList.add('col-dragging');
        // Light haptic on supported devices to signal entry into reorder mode
        if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      }, LONG_PRESS_MS);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!t) return;
      // If we haven't entered reorder mode yet, treat any meaningful movement
      // as a scroll intent — cancel the long-press timer so the page scrolls
      // normally.
      if (!touchSrc) {
        if (touchStart) {
          const dx = Math.abs(t.clientX - touchStart.x);
          const dy = Math.abs(t.clientY - touchStart.y);
          if (dx + dy > SCROLL_THRESHOLD) {
            clearTimeout(touchTimer);
            touchTimer = null;
            touchStart = null;
          }
        }
        return;
      }
      // We ARE in reorder mode. Highlight whichever draggable is currently
      // under the finger, and prevent scroll while dragging.
      e.preventDefault();
      const under = document.elementFromPoint(t.clientX, t.clientY);
      document.querySelectorAll('.col-drop-target').forEach(n => n.classList.remove('col-drop-target'));
      const target = under?.closest('[data-player-id]');
      if (target && target !== touchEl) target.classList.add('col-drop-target');
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
      clearTimeout(touchTimer);
      touchTimer = null;
      if (!touchSrc) { touchStart = null; return; }
      // Find what we ended on
      const t = e.changedTouches[0];
      const under = t ? document.elementFromPoint(t.clientX, t.clientY) : null;
      const target = under?.closest('[data-player-id]');
      const targetId = target?.dataset.playerId;
      // Reset state
      touchEl?.classList.remove('col-dragging');
      document.querySelectorAll('.col-drop-target').forEach(n => n.classList.remove('col-drop-target'));
      const src = touchSrc;
      touchSrc = null; touchEl = null; touchStart = null;
      // Commit if dropped on a different player's element
      if (src && targetId && src !== targetId) reorderPlayerColumn(src, targetId);
    });

    el.addEventListener('touchcancel', () => {
      clearTimeout(touchTimer);
      touchTimer = null;
      touchEl?.classList.remove('col-dragging');
      document.querySelectorAll('.col-drop-target').forEach(n => n.classList.remove('col-drop-target'));
      touchSrc = null; touchEl = null; touchStart = null;
    });
  });
}

/** Move source player BEFORE target player in the saved column order, then re-render. */
function reorderPlayerColumn(sourceId, targetId) {
  // Build the current effective order (what the user sees) so the new order
  // matches their mental model.
  const session = getSession();
  const players = getPlayers().filter(p => p.active);
  const ordered = getOrderedPlayersForDashboard(players, session.playerId);
  const ids = ordered.map(p => p.playerId);
  const srcIdx = ids.indexOf(sourceId);
  const tgtIdx = ids.indexOf(targetId);
  if (srcIdx < 0 || tgtIdx < 0 || srcIdx === tgtIdx) return;
  ids.splice(srcIdx, 1);
  ids.splice(tgtIdx, 0, sourceId);
  // The "viewer first" rule re-asserts on next render via
  // getOrderedPlayersForDashboard, so we don't need to special-case the viewer
  // here — saving the full ordering preserves the user's intent.
  setDashboardColumnOrder(ids);
  renderDashboard();
}

/* The dashboard's "This Week Score Summary" rows.
   Exported, and extracted from renderDashboardInner()'s template, for exactly
   the reason renderDashboardTable() below is: the blind rule is only
   meaningfully tested against the markup a player is actually served, and the
   surrounding renderer needs a real DOM to drive. Pure HTML, no side effects. */
export function renderScoreSummaryRowsHTML(week, weeklyResults, players, actualTB) {
  const session = getSession();
  // Hoisted out of the row loop — it never depended on the row, and the
  // suppression below is a property of the WEEK, not of any one player.
  const canSeeOthers = canViewOtherPicks(week);
  // UN-116 (2026-08-13) — RANK IS NOT A PERSONAL STAT, IT IS THE FIELD.
  // This template blinded correctPicks / incorrectPicks / tiebreaker and
  // stopped there, so a locked week with at least one final game rendered "—"
  // in every count column while the row above still read "1 🏆" and carried a
  // winner-row tint. Relative standing IS the thing the blind rule protects:
  // a finishing position is derived entirely from how the other five did, so
  // it leaks their results whether or not the digits beside it are masked.
  // Suppressed for every row, not just the rivals' — a viewer who sees "1" on
  // their own line while the rest are blank has learned the standing anyway.
  // Their own counts and their own tiebreaker still render below; those are
  // genuinely theirs.
  // UN-118/UN-125 — a >1-member competitive-week group whose members are NOT
  // ALL final yet hasn't settled who the group's real winner is. THIS part's
  // own rank/isWinner/isLoser (computed from only its own games) is not the
  // competitive rank in that state, so it's suppressed the same way the
  // ordinary blind rule suppresses standing — but the player's OWN counts and
  // tiebreaker (governed by `blind`/`canSeeOthers` alone, below) stay visible
  // either way, since those are genuinely theirs regardless of grouping.
  const groupWeeks = weeksInGroup(getWeeks(), week);
  const groupPending = groupWeeks.length > 1 && !groupWeeks.every(w => w.status === 'final');
  const hideStanding = !canSeeOthers || groupPending;
  const groupNoteRow = groupPending
    ? `<tr><td colspan="5"><p class="blind-note"><span class="blind-note-icon">🧩</span><span>This is one part of a multi-part week — rank finalizes once every part (${escHtml(formatWeekGroupLabel(groupWeeks))}) is final.</span></p></td></tr>`
    : '';
  return groupNoteRow + (weeklyResults || []).map(r => {
    const name = getDisplayNamePlain(week.weekId, r.playerId, players);
    // UN-116 — tiebreaker guesses are a submission like any other and
    // are blinded on the same rule as the picks themselves.
    const isSelf = session.playerId === r.playerId;
    const blind = !canSeeOthers && !isSelf;
    const submitted = r.tiebreakerGuess !== null && r.tiebreakerGuess !== undefined;
    let tbDisp;
    if (blind) {
      tbDisp = '<span class="tb-hidden" title="Visible once the games kick off">***</span>';
    } else if (!submitted) {
      tbDisp = '—';                                      // hasn't submitted
    } else if (actualTB !== null) {
      tbDisp = `${r.tiebreakerGuess} (Δ${r.tiebreakerDelta})`;
    } else {
      tbDisp = String(r.tiebreakerGuess);
    }
    return `<tr class="${hideStanding ? '' : (r.isWinner?'winner-row':r.isLoser?'loser-row':'')}">
      ${hideStanding
        ? '<td class="rank-cell">—</td>'
        : `<td class="rank-cell rank-${r.rank}">${r.rank}</td>`}
      <td class="player-name-cell">${escHtml(name)}${hideStanding ? '' : (r.isWinner?' 🏆':r.isLoser?' 💀':'')}${(!hideStanding && r.wonByTiebreaker)?' <span class="text-xs text-muted">(TB)</span>':''}</td>
      <td class="result-win">${blind ? '—' : r.correctPicks}</td>
      <td class="result-loss">${blind ? '—' : r.incorrectPicks}</td>
      <td class="text-muted text-sm">${tbDisp}</td>
    </tr>`;
  }).join('');
}

/* Exported for UN-116's regression suite (same rationale as
   buildObligationsCsvRows): this returns pure HTML, and the blind rule is only
   meaningfully tested by asserting on the markup a player would actually be
   served. A predicate test alone would not have caught the original defect —
   canViewOtherPicks existed and worked; this function simply never called it. */
export function renderDashboardTable(players,games,allPicks,weeklyResults,weekId,actualTB) {
  const session = getSession();
  const week    = getWeek(weekId);
  const isPublic = arePicksPublic(week);
  // UN-116 — same two values the compact view and the score summary use, so
  // all three surfaces blind on one rule instead of three near-copies.
  const viewerId    = session.playerVerified ? session.playerId : null;
  const canSeeOthers = canViewOtherPicks(week);

  // If not public, not admin, and player hasn't submitted — show prompt not data
  if (!isPublic && !session.isAdmin) {
    // v0.17.2 (Drew): surface the lock deadline here too — this prompt is where
    // a signed-out viewer lands, so it's the highest-leverage place to show what
    // they're about to miss. Contains no pick data; blind rule is unaffected.
    const countdown = renderLockCountdownHTML(week, games, { compact: true });
    if (!session.playerVerified) {
      return `<div class="text-center" style="padding:24px">
        ${countdown}
        <p class="text-muted text-sm mb-md">Log in and submit your picks to view the pick matrix.</p>
        <button class="btn btn-primary btn-sm" onclick="navigateTo('picks')">Go to Picks</button>
      </div>`;
    }
    if (!hasPlayerSubmitted(weekId, session.playerId)) {
      return `<div class="text-center" style="padding:24px">
        ${countdown}
        <p class="text-muted text-sm mb-md">Submit your picks first — keeps it blind until you're in.</p>
        <button class="btn btn-primary btn-sm" onclick="navigateTo('picks')">Submit My Picks</button>
      </div>`;
    }
  }

  const submittedRaw = players.filter(p=>allPicks.some(pk=>pk.playerId===p.playerId));
  if(!submittedRaw.length) return'<p class="text-muted text-center" style="padding:24px">No picks submitted yet.</p>';
  // Priority 7: reorder columns per the viewer's saved layout (their own column first)
  const submitted = getOrderedPlayersForDashboard(submittedRaw, session.playerId);

  const headers=submitted.map(p=>{
    const r=weeklyResults.find(r=>r.playerId===p.playerId);
    const name=getDisplayNamePlain(weekId,p.playerId,players);
    const w=r?.correctPicks??0, l=r?.incorrectPicks??0;
    // Show an explicit win-loss record. Hidden until at least one game decided,
    // so an all-pending week doesn't render a confusing "0-0" under every name.
    const decided=(r?.correctPicks||0)+(r?.incorrectPicks||0)+(r?.noDecisions||0);
    const recordLabel=decided>0?`<span class="pts-label">${w}–${l}</span>`:'';
    // data-player-id + draggable handle for Priority 7 reorder. The header
    // itself is the drag target so users have a clear affordance (the column
    // name). Hidden visual handle (≡) on hover makes it discoverable.
    return`<th class="player-col" data-player-id="${escHtml(p.playerId)}" draggable="true">
      <span class="col-drag-handle" aria-hidden="true">≡</span>
      <span class="player-col-name">${escHtml(name)}</span>${recordLabel}
    </th>`;
  }).join('');

  const rows=games.map(game=>{
    const sv=game.lockedSpread!==null?game.lockedSpread:game.spread;
    const spreadStr=sv!==null?fmtSpread(sv,game.favorite,game):(game.status===GAME_STATUS.FINAL?'Final':'TBD');
    const ats=game.status===GAME_STATUS.FINAL?(game.atsWinner??calculateAtsWinner(game)):null;
    const atsLabel=ats==='no_decision'?'No Decision':ats||'';

    // Priority 4: always show kickoff date+time, with a small state indicator
    // (LIVE pill / FINAL pill) appended when the game has progressed. Old code
    // showed *only* the score when live/final and hid the kickoff entirely —
    // users couldn't tell at a glance when a final game had actually kicked off.
    const kickoffStr = fmtTime(game.kickoff, game);
    let stateIndicator = '';
    if (game.status === GAME_STATUS.FINAL && game.homeScore !== null) {
      stateIndicator = `<span class="status-pill status-pill-final">FINAL ${game.awayScore}–${game.homeScore}</span>`;
    } else if (game.status === GAME_STATUS.LIVE && game.homeScore !== null) {
      // Item 2 Pass B (DI-4) — append the captured quarter/clock text, verbatim,
      // right next to the existing LIVE pill. No entry -> disp is null -> the
      // pill renders exactly as before (no added text).
      const liveDisp = liveStatusDisplay(liveStatusById.get(game.gameId));
      const dotCls = liveDisp && liveDisp.pulse===false ? ' live-dot-static' : '';
      const detailText = liveDisp ? ` · ${escHtml(liveDisp.text)}` : '';
      stateIndicator = `<span class="live-pill" style="font-size:.66rem"><span class="live-dot${dotCls}"></span>LIVE ${game.awayScore}–${game.homeScore}${detailText}</span>`;
    }
    const statusInfo = `<span class="kickoff-time">${escHtml(kickoffStr)}</span>${stateIndicator}`;

    const pickCells=submitted.map(player=>{
      // UN-116 — THE LEAK. This matrix had no blind check at all: the compact
      // view hid other players' chips correctly while the standard view, the
      // default, printed every selection in full. A player only had to submit
      // (or, before the canViewOtherPicks fix, just be logged in on a live
      // dashboard) to read the whole league's slate while still able to edit
      // their own. Blind cells render for everyone but the viewer until the
      // week is public.
      if(!canSeeOthers && player.playerId!==viewerId){
        return`<td class="pick-cell pick-cell-blind" title="Hidden until the games kick off">•••</td>`;
      }
      const pick=allPicks.find(pk=>pk.gameId===game.gameId&&pk.playerId===player.playerId);
      if(!pick)return'<td class="pick-cell">—</td>';
      const result=evaluatePick(pick,game);
      // Picked team display (school only — matrix is tight, mascot adds noise here)
      const pickedSide = pick.selectedTeam === game.homeTeam ? 'home' : (pick.selectedTeam === game.awayTeam ? 'away' : null);
      const pickedDisplay = pickedSide ? teamSchool(game, pickedSide) : pick.selectedTeam;

      // LIVE: soft, pulsing covering/trailing tint — distinct from finalized boxes.
      if (result===PICK_RESULT.LIVE) {
        const ls = livePickStatus(pick, game);
        if (ls === 'covering')
          return `<td class="pick-cell pick-live pick-live-covering" title="Currently covering the spread"><span class="live-dot"></span>${escHtml(pickedDisplay)}<span class="live-arrow">▲</span></td>`;
        if (ls === 'trailing')
          return `<td class="pick-cell pick-live pick-live-trailing" title="Currently not covering the spread"><span class="live-dot"></span>${escHtml(pickedDisplay)}<span class="live-arrow">▽</span></td>`;
        if (ls === 'even')
          return `<td class="pick-cell pick-live pick-live-even" title="Exactly on the spread right now"><span class="live-dot"></span>${escHtml(pickedDisplay)}</td>`;
        // Live but no spread/score yet — neutral live tint, no direction
        return `<td class="pick-cell pick-live" title="Game in progress"><span class="live-dot"></span>${escHtml(pickedDisplay)}</td>`;
      }

      // FINALIZED / PENDING: solid boxes with ✓ / ✗ (unchanged visual language).
      const cls=getPickStatusClass(result);
      const icon={win:'✓',loss:'✗',no_decision:'—'}[result]||'';
      return`<td class="pick-cell ${cls}">${icon?`<span class="pick-icon">${icon}</span>`:''}${escHtml(pickedDisplay)}</td>`;
    }).join('');

    return`<tr>
      <td class="game-info-cell">
        <div class="game-info-matchup">${escHtml(matchupBare(game))} ${renderGameBadges(game)}</div>
        <div class="game-info-meta">
          <span class="spread-badge-sm">${spreadStr}</span>
          ${statusInfo}
          ${ats?`<span style="font-size:.68rem;color:var(--maroon)">ATS: ${escHtml(atsLabel)}</span>`:''}
          ${game.espnEventId
            ? `<a class="espn-link" href="https://www.espn.com/${game.isManual && game.espnSport ? escHtml(game.espnSport) : 'college-football'}/game/_/gameId/${encodeURIComponent(game.espnEventId)}" target="_blank" rel="noopener noreferrer" title="Open ESPN gamecast in a new tab">ESPN ↗</a>`
            : ''}
        </div>
        ${renderReactionStrip(weekId, game.gameId, players)}
        ${gameChatBubbleHTML(game.gameId)}
      </td>${pickCells}
    </tr>`;
  }).join('');

  return`<table class="dashboard-table">
    <thead><tr><th>Game / Spread</th>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ─── EMOJI REACTIONS ─────────────────────────────────────────────────────────
// Slack-style reactions on dashboard games. State lives in storage (auto-syncs
// in Sheets mode); UI is a small strip of chips per game with a "+" picker.
// Only logged-in players can react. Tapping the same emoji removes the vote.

// Reaction palette — item G (batch 3+4): moved to data-model.js as the ONE
// shared emoji source for the whole app (AD-20 extended). chat-ui.js's
// composer picker pulls from the SAME list, so the two surfaces can never
// drift apart the way TEAM_ABBR once did (RG-13). Do not reintroduce a local
// literal here — import REACTION_PALETTE from data-model.js instead.

/**
 * Render the reactions strip for one game. Returns a span with chips for each
 * emoji that has at least one vote, plus a "+" button to open the picker.
 * `players` is passed in so tooltips can name who reacted.
 */
function renderReactionStrip(weekId, gameId, players) {
  const reactions = getReactionsForGame(weekId, gameId);
  const session = getSession();
  const myPid = session?.playerId || null;
  const playerById = Object.fromEntries(players.map(p => [p.playerId, p.displayName]));

  const hasAny = Object.values(reactions).some(arr => arr?.length);

  const chips = Object.entries(reactions).map(([emoji, pids]) => {
    if (!pids?.length) return '';
    const names = pids.map(id => playerById[id] || '?').join(', ');
    const mine = myPid && pids.includes(myPid);
    return `<button type="button" class="reaction-chip${mine?' reaction-chip-mine':''}"
      data-week-id="${escHtml(weekId)}" data-game-id="${escHtml(gameId)}" data-emoji="${escHtml(emoji)}"
      title="${escHtml(names)}">
      <span class="reaction-chip-emoji">${emoji}</span>
      <span class="reaction-chip-count">${pids.length}</span>
    </button>`;
  }).join('');

  // Priority 5: when there are NO reactions on a game, the strip should not
  // take up vertical space. But a logged-in player still needs a way to start
  // one — so we render a single tiny "+" with the `reaction-strip-empty`
  // modifier (CSS shrinks it to zero margin-top and just a 16x16 button).
  // Anonymous viewers see nothing at all when empty.
  if (!hasAny) {
    if (!myPid) return ''; // truly empty for anonymous viewers
    return `<span class="reaction-strip reaction-strip-empty" data-reaction-strip="${escHtml(weekId)}::${escHtml(gameId)}">
      <button type="button" class="reaction-add-btn reaction-add-btn-mini" data-week-id="${escHtml(weekId)}" data-game-id="${escHtml(gameId)}" title="Add reaction">+</button>
    </span>`;
  }

  const addBtn = myPid
    ? `<button type="button" class="reaction-add-btn" data-week-id="${escHtml(weekId)}" data-game-id="${escHtml(gameId)}" title="Add reaction">+</button>`
    : '';

  return `<span class="reaction-strip" data-reaction-strip="${escHtml(weekId)}::${escHtml(gameId)}">${chips}${addBtn}</span>`;
}

/**
 * Re-renders just one game's reaction strip after a toggle, so we don't have
 * to redraw the whole dashboard. Looks up the strip by its data-reaction-strip
 * attribute and replaces its innerHTML.
 */
function refreshReactionStrip(weekId, gameId, players) {
  const sel = `[data-reaction-strip="${weekId}::${gameId}"]`;
  document.querySelectorAll(sel).forEach(node => {
    const fresh = renderReactionStrip(weekId, gameId, players);
    // Replace the whole element so its data-* attributes stay current.
    const tmp = document.createElement('div');
    tmp.innerHTML = fresh;
    if (tmp.firstElementChild) node.replaceWith(tmp.firstElementChild);
  });
  // Re-bind handlers for the (re-rendered) strip.
  bindReactionHandlers(players); bindCommentBubbleHandlers();
}

/**
 * Wires click handlers on every reaction chip + "+" picker on the page.
 * Idempotent — safe to call after every re-render. Picker uses a tiny inline
 * popover anchored to the "+" button.
 */
function bindReactionHandlers(players) {
  // Toggle vote on an existing emoji
  document.querySelectorAll('.reaction-chip').forEach(btn => {
    if (btn._wired) return; btn._wired = true;
    btn.addEventListener('click', () => {
      const session = getSession();
      if (!session?.playerId) { showToast('Log in as a player to react','warning'); return; }
      const { weekId, gameId, emoji } = btn.dataset;
      const after = toggleReaction(weekId, gameId, emoji, session.playerId);
      if (after.includes(session.playerId)) { try { sendGameReact(gameId, emoji, session.playerId); } catch {} }
      refreshReactionStrip(weekId, gameId, players);
    });
  });
  // Open the picker
  document.querySelectorAll('.reaction-add-btn').forEach(btn => {
    if (btn._wired) return; btn._wired = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close any other open pickers
      document.querySelectorAll('.reaction-picker').forEach(p => p.remove());
      const { weekId, gameId } = btn.dataset;
      const picker = document.createElement('div');
      picker.className = 'reaction-picker';
      picker.innerHTML = REACTION_PALETTE.map(em =>
        `<button type="button" class="reaction-pick-option" data-emoji="${em}" title="${em}">${em}</button>`
      ).join('');
      btn.parentElement.appendChild(picker);
      picker.querySelectorAll('.reaction-pick-option').forEach(opt => {
        opt.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const session = getSession();
          if (!session?.playerId) { showToast('Log in to react','warning'); picker.remove(); return; }
          const after = toggleReaction(weekId, gameId, opt.dataset.emoji, session.playerId);
          if (after.includes(session.playerId)) { try { sendGameReact(gameId, opt.dataset.emoji, session.playerId); } catch {} }
          picker.remove();
          refreshReactionStrip(weekId, gameId, players);
        });
      });
      // Click anywhere else closes the picker
      const closer = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', closer); } };
      setTimeout(() => document.addEventListener('click', closer), 0);
    });
  });
}

// ─── PER-GAME COMMENTS ────────────────────────────────────────────────────────
// A small speech-bubble icon on each game row. Empty by default (outlined
// bubble, faded); when comments exist, filled bubble + count badge. Tap opens
// a lightweight modal thread. Both matrix and compact use the same renderer.

const COMMENT_MAX_LEN = 200; // MUST match storage.js — updating here won't help save

/**
 * Small speech-bubble icon for a game row. Non-obtrusive by default so it
 * doesn't compete with the pick matrix or spread/live colors. Rendered inline
 * so it can slot into existing meta rows without wrapping.
 */
function renderCommentBubble(weekId, game) {
  const count = getGameComments(game.gameId).length;
  const hasAny = count > 0;
  return `<button type="button" class="comment-bubble${hasAny?' has-comments':''}"
    data-comment-week="${escHtml(weekId)}" data-comment-game="${escHtml(game.gameId)}"
    title="${hasAny?`${count} comment${count>1?'s':''} on this game`:'Add a comment'}">
    <span class="cb-icon" aria-hidden="true">💬</span>
    ${hasAny?`<span class="cb-count">${count}</span>`:''}
  </button>`;
}

/**
 * Open the per-game comment thread modal. Renders a lightweight list of
 * existing comments + an input at the bottom for a new comment. Reuses the
 * modal-overlay pattern already in the app for consistency.
 */
function openCommentThreadModal(weekId, gameId) {
  const game = getGame(gameId);
  if (!game) return;
  const session = getSession();
  const players = getPlayers();
  const playerLookup = Object.fromEntries(players.map(p => [p.playerId, p]));

  const ov = document.createElement('div');
  ov.className = 'modal-overlay centered comment-modal-overlay';
  ov.setAttribute('data-comment-modal', gameId);

  const renderThread = () => {
    const comments = getGameComments(gameId);
    if (!comments.length) {
      return `<p class="text-muted text-sm text-center" style="padding:24px 8px">
        No comments yet. Say something ${session?.playerId ? '👇' : '(log in as a player first)'}.
      </p>`;
    }
    return comments.map(c => {
      const isBot = c.authorKind === 'bot';
      const author = isBot ? 'PickEms Bot' : (playerLookup[c.authorId]?.displayName || 'Unknown');
      const initials = isBot ? '🤖' : escHtml(getPlayerInitials(playerLookup[c.authorId] || { displayName: author }));
      const canDelete = !isBot && (session?.isAdmin || session?.playerId === c.authorId);
      const ts = new Date(c.createdAt);
      const timeStr = ts.toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
      return `<div class="comment-item${isBot?' comment-item-bot':''}">
        <div class="comment-avatar">${initials}</div>
        <div class="comment-body">
          <div class="comment-head">
            <span class="comment-author">${escHtml(author)}${isBot?' <span class="bot-tag">BOT</span>':''}</span>
            <span class="comment-time">${escHtml(timeStr)}</span>
            ${canDelete?`<button class="comment-delete" data-comment-id="${escHtml(c.commentId)}" title="Delete">✕</button>`:''}
          </div>
          <div class="comment-text">${escHtml(c.body)}</div>
        </div>
      </div>`;
    }).join('');
  };

  ov.innerHTML = `<div class="modal comment-modal">
    <div class="modal-header">
      <h3>💬 ${escHtml(matchupBare(game))}</h3>
      <button class="modal-close" id="cm-close">✕</button>
    </div>
    <div class="comment-thread" id="cm-thread">${renderThread()}</div>
    ${session?.playerId ? `
      <div class="comment-input-row">
        <textarea class="form-input comment-input" id="cm-input" rows="2"
          maxlength="${COMMENT_MAX_LEN}"
          placeholder="Talk your talk (max ${COMMENT_MAX_LEN} chars)"></textarea>
        <button class="btn btn-primary" id="cm-post">Post</button>
      </div>
    ` : `
      <p class="text-muted text-xs text-center" style="padding:8px 0">
        Log in as a player from the Picks tab to comment.
      </p>
    `}
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#cm-close')?.addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  const refreshThread = () => {
    const t = ov.querySelector('#cm-thread');
    if (t) t.innerHTML = renderThread();
    bindThreadDeleteHandlers();
    // Also refresh the underlying bubble count on the dashboard so the caller
    // sees the new count without a full re-render.
    refreshCommentBubbles(gameId);
    // Auto-scroll to bottom
    if (t) t.scrollTop = t.scrollHeight;
  };

  const bindThreadDeleteHandlers = () => {
    ov.querySelectorAll('.comment-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this comment?')) return;
        deleteComment(btn.dataset.commentId);
        refreshThread();
      });
    });
  };
  bindThreadDeleteHandlers();
  refreshThread(); // scroll to bottom on open

  ov.querySelector('#cm-post')?.addEventListener('click', () => {
    const input = ov.querySelector('#cm-input');
    if (!input) return;
    const body = input.value;
    const entry = addComment({
      weekId, gameId, authorId: session.playerId, authorKind: 'player', body,
    });
    if (!entry) { showToast('Enter something to post','warning'); return; }
    input.value = '';
    refreshThread();
  });
  ov.querySelector('#cm-input')?.addEventListener('keydown', e => {
    // Cmd/Ctrl+Enter posts
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ov.querySelector('#cm-post')?.click();
    }
  });
}

/**
 * Re-render the bubble count for one game on every dashboard row/card without
 * touching the rest of the dashboard. Called after posting/deleting a comment.
 */
function refreshCommentBubbles(gameId) {
  const count = getGameComments(gameId).length;
  document.querySelectorAll(`.comment-bubble[data-comment-game="${gameId}"]`).forEach(el => {
    if (count > 0) {
      el.classList.add('has-comments');
      const existing = el.querySelector('.cb-count');
      if (existing) existing.textContent = count;
      else el.insertAdjacentHTML('beforeend', `<span class="cb-count">${count}</span>`);
      el.title = `${count} comment${count>1?'s':''} on this game`;
    } else {
      el.classList.remove('has-comments');
      el.querySelector('.cb-count')?.remove();
      el.title = 'Add a comment';
    }
  });
}

/** Wire click handlers on every rendered comment bubble. Idempotent. */
function bindCommentBubbleHandlers() {
  document.querySelectorAll('.comment-bubble').forEach(btn => {
    if (btn._commentWired) return; btn._commentWired = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const weekId = btn.dataset.commentWeek;
      const gameId = btn.dataset.commentGame;
      openCommentThreadModal(weekId, gameId);
    });
  });
}


/**
 * Compact alternative to the wide matrix above — optimized for narrow phone
 * screens. Each game is one stacked card; player picks are rendered as small
 * initial-chips so a 6-player league fits on one mobile row. Same data, same
 * status semantics (final win/loss boxes, pulsing live tints) — just denser.
 *
 * Decisions:
 *  - Player initials in chips (not full names) — every player fits on one row.
 *  - Game matchup is bare schools (Away @ Home), no mascot, same as matrix.
 *  - Live and final colour languages match the matrix exactly so users learn
 *    one visual system, not two.
 *  - Picked-team text under each chip uses a short form (last word of the
 *    school name) to keep the chip narrow but still readable.
 *
 * Exported for UN-119's regression suite (same rationale as
 * renderDashboardTable, above): this returns pure HTML, and "the chat bubble
 * no longer costs a full row" is only meaningfully tested by asserting on the
 * markup actually served, not on a source-text regex — a regex can't tell a
 * working relocation from one that silently reverted.
 */
export function renderDashboardCompact(players, games, allPicks, weeklyResults, weekId, actualTB) {
  const session = getSession();
  const picks = allPicks;
  const submittedRaw = players.filter(p => picks.some(pk => pk.playerId === p.playerId));
  // Priority 7: same reorder rule as the matrix — viewer's column (here a chip
  // position) is leftmost; rest follows the saved order.
  const submitted = getOrderedPlayersForDashboard(submittedRaw, session.playerId);
  if (!games.length) return '<div class="info-box">No games on the slate yet.</div>';

  // Pre-compute a unique abbreviation for every team appearing this week so
  // no two chips show identical text (Priority 6).
  const abbrMap = buildAbbrMap(games);
  const shortLabel = (name) => abbrMap.get(name) || (name || '').slice(0,4).toUpperCase();

  const sortedGames = [...games].sort((a,b) => new Date(a.kickoff||0) - new Date(b.kickoff||0));

  // Blinding rule (Priority 3): hide other players' chip contents from a viewer
  // who hasn't earned the right to see picks yet. The viewer ALWAYS sees their
  // own chip. Once the week is live/final, everything is visible to everyone.
  const week = getWeeks().find(w => w.weekId === weekId);
  const canSeeOthers = week ? canViewOtherPicks(week) : false;

  const gameCards = sortedGames.map(game => {
    const sv = game.lockedSpread !== null ? game.lockedSpread : game.spread;
    const spreadStr = sv !== null ? fmtSpread(sv, game.favorite, game) : (game.status === GAME_STATUS.FINAL ? 'Final' : 'TBD');
    // Priority 4: kickoff time + state indicator, same pattern as the matrix
    // so users see one consistent format across both views.
    const kickoffStr = fmtTime(game.kickoff, game);
    let stateIndicator = '';
    if (game.status === GAME_STATUS.FINAL && game.homeScore !== null) {
      stateIndicator = `<span class="dc-status dc-final">FINAL ${game.awayScore}–${game.homeScore}</span>`;
    } else if (game.status === GAME_STATUS.LIVE && game.homeScore !== null) {
      // Item 2 Pass B (DI-5) — a SEPARATE chip (own dc-status pill), never
      // appended inline into the score chip's text, so the ≤14-char budget
      // from liveStatusDisplayShort() can't push the score itself around.
      // No entry -> liveDisp null -> no chip added (unchanged today).
      const liveDisp = liveStatusDisplayShort(liveStatusById.get(game.gameId));
      const dotCls = liveDisp && liveDisp.pulse===false ? ' live-dot-static' : '';
      const detailChip = liveDisp ? `<span class="dc-status dc-live-detail">${escHtml(liveDisp.text)}</span>` : '';
      stateIndicator = `<span class="dc-status dc-live"><span class="live-dot${dotCls}"></span>${game.awayScore}–${game.homeScore}</span>${detailChip}`;
    }
    const statusInfo = `<span class="dc-status dc-scheduled">${escHtml(kickoffStr)}</span>${stateIndicator}`;

    const chips = submitted.map(player => {
      const pick = picks.find(pk => pk.gameId === game.gameId && pk.playerId === player.playerId);
      const initials = escHtml(getPlayerInitials(player));
      if (!pick) {
        return `<div class="dc-chip dc-chip-none" data-player-id="${escHtml(player.playerId)}" draggable="true" title="${escHtml(player.displayName)}: no pick"><span class="dc-chip-init">${initials}</span><span class="dc-chip-pick">—</span></div>`;
      }
      const isSelf = session.playerId === player.playerId;
      // Blinding: if the viewer can't see others' picks yet AND this isn't
      // their own pick, render an opaque "•••" chip. The chip still shows
      // initials so they can see WHO has submitted, just not WHAT they picked.
      if (!isSelf && !canSeeOthers) {
        return `<div class="dc-chip dc-chip-blind" data-player-id="${escHtml(player.playerId)}" draggable="true" title="${escHtml(player.displayName)}: picks hidden until the games kick off"><span class="dc-chip-init">${initials}</span><span class="dc-chip-pick">•••</span></div>`;
      }
      const result = evaluatePick(pick, game);
      const pickedSide = pick.selectedTeam === game.homeTeam ? 'home' : pick.selectedTeam === game.awayTeam ? 'away' : null;
      const pickShort = pickedSide ? shortLabel(teamSchool(game, pickedSide)) : shortLabel(pick.selectedTeam);
      let cls = 'dc-chip-pending';
      let icon = '';
      if (result === PICK_RESULT.LIVE) {
        const ls = livePickStatus(pick, game);
        if (ls === 'covering') { cls = 'dc-chip-live-covering'; icon = '▲'; }
        else if (ls === 'trailing') { cls = 'dc-chip-live-trailing'; icon = '▽'; }
        else { cls = 'dc-chip-live'; }
      } else if (result === PICK_RESULT.WIN) { cls = 'dc-chip-win'; icon = '✓'; }
      else if (result === PICK_RESULT.LOSS) { cls = 'dc-chip-loss'; icon = '✗'; }
      else if (result === PICK_RESULT.NO_DECISION) { cls = 'dc-chip-nd'; icon = '—'; }
      return `<div class="dc-chip ${cls}" data-player-id="${escHtml(player.playerId)}" draggable="true" title="${escHtml(player.displayName)} picked ${escHtml(pick.selectedTeam)}"><span class="dc-chip-init">${initials}</span><span class="dc-chip-pick">${escHtml(pickShort)}${icon?` ${icon}`:''}</span></div>`;
    }).join('');

    const espn = game.espnEventId
      ? ` · <a class="espn-link" href="https://www.espn.com/${game.isManual && game.espnSport ? escHtml(game.espnSport) : 'college-football'}/game/_/gameId/${encodeURIComponent(game.espnEventId)}" target="_blank" rel="noopener noreferrer">ESPN ↗</a>`
      : '';
    // UN-119 (DI-119a): the chat indicator and the reaction strip both move
    // OFF their own block-level rows and INLINE into .dc-meta, next to the
    // ESPN link — that pair of rows, present on every card regardless of
    // whether either had anything to show, was the measured cost driver
    // (root driver: gameChatBubbleHTML's button carries a min-height:40px
    // pill in its base CSS; the `.dc-meta .chat-bubble-btn` override below
    // strips that back to icon-only for THIS layout only). The markup these
    // two helpers return is untouched — chat-ui.js is not part of this
    // change — only where it lands. .dc-meta is display:flex;flex-wrap:wrap,
    // so the reaction strip only pushes onto its own line on the minority of
    // cards that actually have reactions; empty/icon-only content stays on
    // the first line. The standard matrix (renderDashboardTable) still calls
    // both at the bottom of the game-info cell, unchanged.
    const chatInd = gameChatBubbleHTML(game.gameId);
    const reactionInd = renderReactionStrip(weekId, game.gameId, players);
    return `<div class="dc-game">
      <div class="dc-game-head">
        <div class="dc-matchup">${escHtml(matchupBare(game))} ${renderGameBadges(game)}</div>
        <div class="dc-meta"><span class="spread-badge-sm">${escHtml(spreadStr)}</span>${statusInfo}${espn}${chatInd}${reactionInd}</div>
      </div>
      <div class="dc-chips">${chips}</div>
    </div>`;
  }).join('');

  return gameCards;
}

// ─── LEADERBOARD / STANDINGS ──────────────────────────────────────────────────

/* Exported for loadtest.mjs — UN-118/UN-125's Weekly History collapse (one
   row per competitive-week group) is only meaningfully tested against the
   markup a commissioner/player actually sees, same rationale as every other
   render function this file already exports for the harness. */
export function renderLeaderboard() {
  const c=document.getElementById('page-leaderboard'); if(!c)return;
  const players=getPlayers().filter(p=>p.active);
  // v0.17.0 — demo weeks never count toward standings, weekly history, or debts
  const allWeeksRaw=getWeeks(); // unfiltered — group membership must see every week, incl. drafts, to know a group's TRUE size
  const visibleWeekIds=new Set(allWeeksRaw.filter(w=>w.showInHistory!==false&&w.dataSourceMode!=='demo').map(w=>w.weekId));
  const allResults=getWeeklyResults().filter(r=>visibleWeekIds.has(r.weekId));
  // UN-118/UN-125 — a multi-part group must count as ONE weekly win/loss, not
  // one per scheduling record. `weeks` is optional and fails safe (see
  // scoring.js) — passing it here is what makes the fix fire for Standings.
  // Build 3 Group D (2026-09-11) — the call itself moved into
  // seasonStandingsRows() (same players/weeks/results inputs, same function,
  // byte-identical output) so DI-D3's player profile reads THE STANDINGS
  // PAGE'S numbers rather than a second, drift-prone recompute of them
  // (CONVENTIONS #21). The locals above are still used by the group rows
  // below; only this one line delegates.
  const standings=seasonStandingsRows();
  const weeks=getWeeks().filter(w=>w.status!==WEEK_STATUS.DRAFT&&w.dataSourceMode!=='demo').sort((a,b)=>a.weekNumber-b.weekNumber);
  const settings=getSettings();
  const obligations=getObligations();

  // Weekly History collapses to ONE ROW PER COMPETITIVE-WEEK GROUP, not one
  // per scheduling record — a split slate/bowl/CFP week must read as the one
  // week the league actually competed over. `memberWeeks` is resolved against
  // the FULL unfiltered week list (a not-yet-opened sibling still counts as
  // "not every member final yet"), even though only weeks in the visible
  // `weeks` list get their own row.
  const seenGroupIds=new Set();
  const groupRows=[];
  for (const w of weeks) {
    const gid=getEffectiveGroupId(w);
    if (seenGroupIds.has(gid)) continue;
    seenGroupIds.add(gid);
    const memberWeeks=weeksInGroup(allWeeksRaw, w);
    let winner=null, loser=null;
    if (memberWeeks.length<=1) {
      const wRes=allResults.filter(r=>r.weekId===w.weekId);
      winner=wRes.find(r=>r.isWinner)||null; loser=wRes.find(r=>r.isLoser)||null;
    } else if (memberWeeks.every(m=>m.status==='final')) {
      // Only once every member has independently finalized do we know the
      // group's real winner — same gate finalizeWeek() uses for the
      // obligation itself (DI-126d). Recomputed fresh from pooled picks/games
      // rather than trusted from either part's own (per-part, pre-grouping)
      // stored isWinner flag.
      const groupPicks=memberWeeks.flatMap(m=>getPicks(m.weekId));
      const groupGames=memberWeeks.flatMap(m=>getGames(m.weekId));
      const groupResults=calculateGroupWeeklyResults(memberWeeks,players,groupPicks,groupGames);
      winner=groupResults.find(r=>r.isWinner)||null; loser=groupResults.find(r=>r.isLoser)||null;
    }
    // memberWeeks.length>1 && not every member final yet → winner/loser stay
    // null — the row reads "in progress," same as any other unfinalized week.
    groupRows.push({ gid, label:formatWeekGroupLabel(memberWeeks.length>1?memberWeeks:[w]), winner, loser });
  }

  c.innerHTML=`
    <div class="section-header"><h2>Standings</h2><div class="subtitle">Season ${settings.season}</div></div>

    <div class="admin-section-title">Season Summary</div>
    <div class="dashboard-scroll mb-md">
      <table class="dashboard-table">
        <thead><tr><th>#</th><th>Player</th><th>✅ Correct</th><th>❌ Wrong</th><th>Win %</th><th>Wk W</th><th>Wk L</th></tr></thead>
        <tbody>
          ${standings.length?standings.map(s=>{
            return`<tr class="${s.isSeasonLeader?'winner-row':s.isCurrentLastPlace?'loser-row':''}">
              <td class="rank-cell rank-${s.currentRank}">${s.currentRank}</td>
              <td class="player-name-cell">${escHtml(s.displayName)}${s.isSeasonLeader?' 👑':s.isCurrentLastPlace?' 🤡':''}</td>
              <td class="result-win">${s.totalCorrect}</td>
              <td class="result-loss">${s.totalIncorrect}</td>
              <td>${s.winPct}%</td>
              <td>${s.weeklyWins}</td>
              <td>${s.weeklyLosses}</td>
            </tr>`;
          }).join('')
          :'<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted)">No finalized weeks yet.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="admin-section-title">⭐ Alma Mater Rankings</div>
    <div class="card mb-md">
      <p class="text-muted text-xs mb-sm">Rankings sourced from ESPN when available. Fetch ESPN data in the Commissioner panel to update.</p>
      ${renderAlmaMaterRankings()}
    </div>

    <!-- Groups A/B (2026-09-10, DI-A5): the obligation deep-link destination
         for OBLIGATION_CREATED/OBLIGATION_SETTLED — Weekly History IS the
         player-facing obligations view (each row carries its own
         obligationActionsHTML). No new page; this id is the scroll target. -->
    <div class="admin-section-title" id="obligations-section">Weekly History</div>
    ${groupRows.length?`<div class="dashboard-scroll mb-md">
      <table class="dashboard-table">
        <thead><tr><th>Week</th><th>🏆 Winner</th><th>💀 Loser</th><th>Status</th></tr></thead>
        <tbody>
          ${groupRows.map(({gid,label,winner,loser})=>{
            // UN-126 — presence of an obligation for this gid no longer
            // implies it's the settled answer. If more than one ACTIVE
            // (non-voided) 'weekly' obligation exists for this gid, or any
            // of them is flagged needsReview, this row is "conflicted"
            // instead of silently picking one and rendering it as if the
            // league had already agreed — the exact defect this closes (a
            // stale singleton obligation sitting next to a freshly pooled
            // winner, disagreeing with what's on screen). UN-135: the
            // computation stays exactly as-is, but the PLAYER-facing badge
            // for a conflicted row is intentionally the plain Unpaid badge
            // (no diagnostic text) — the "Needs review" wording and title
            // stay commissioner-only, in renderObligationsAdmin() and
            // renderObligationCorrectionsAdmin().
            const gobs = obligations.filter(o=>o.weekId===gid && o.type==='weekly' && isObligationActive(o));
            const conflicted = gobs.length > 1 || gobs.some(o=>o.needsReview);
            const ob = !conflicted && gobs.length === 1 ? gobs[0] : null;
            return`<tr>
              <td style="white-space:nowrap;font-size:.82rem">${escHtml(label)}</td>
              <td class="player-name-cell">${winner?escHtml(winner.displayName):'—'}${winner?.wonByTiebreaker?' (TB)':''}</td>
              <td class="player-name-cell">${loser?escHtml(loser.displayName):'—'}</td>
              <td>
                ${conflicted
                  ? '<span class="badge badge-locked">Unpaid</span>'
                  : ob ? obligationActionsHTML(ob.status, ob, getSession(), {
                      payerName: getPlayer(ob.payerPlayerId)?.displayName || '?',
                      recipientName: getPlayer(ob.recipientPlayerId)?.displayName || '?',
                      obClass: 'ob-action',
                    }) : '<span class="text-muted text-xs">—</span>'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`:'<p class="text-muted text-sm mb-md">Weekly history appears after weeks are finalized.</p>'}

    ${renderSeason2025OutstandingSection()}
    ${renderSeason2025RecordSection()}
  `;

  bindSeason2025Sections(c);
  // UN-105a — edge-fade cue for both season-summary/weekly-history
  // .dashboard-scroll wrappers above AND the two nested inside the collapsed
  // 2025 season <details> (initScrollFades binds a 'toggle' listener on the
  // <details> itself, so those get measured once actually opened).
  initScrollFades(c);
  c.querySelectorAll('.ob-action-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      handleObligationAction(btn.dataset.obId, btn.dataset.obAction);
      renderLeaderboard();
    });
  });
}

export function renderAlmaMaterRankings() {
  // Pull rankings from the most recent fetched games that include alma mater teams
  const allGames = getGames();
  const almaMaters = claimedAlmaMaters();
  const rows = almaMaters.map(alma => {
    const game = [...allGames].reverse().find(g =>
      getAlmaMaterMatch(g.homeTeam, almaMaters) === alma || getAlmaMaterMatch(g.awayTeam, almaMaters) === alma
    );
    let rank = null;
    if (game) {
      if (getAlmaMaterMatch(game.homeTeam, almaMaters) === alma) rank = game.homeRank;
      else rank = game.awayRank;
    }
    const rankStr = rank ? `<span class="rank-badge">#${rank} AP</span>` : '<span class="text-muted text-xs">Unranked</span>';
    // F5 (2026-09-04) — was `p.almaMater === alma`: case-sensitive AND not
    // filtered to active, unlike claimedAlmaMaters() (which produced `alma`
    // in the first place) and the Settings-tab card's claimantsOf(). Could
    // attribute a school to a DEACTIVATED player (a stale byline next to a
    // school someone else, or nobody, actively claims) or fail to show a
    // real claimant purely over casing. Same shape as claimantsOf() below —
    // all three now agree.
    const player  = getPlayers().find(p => p.active && (p.almaMater || '').trim().toLowerCase() === alma.toLowerCase());
    const almaDisplay = ALMA_MATER_DISPLAY[alma] || alma;
    return `<div class="alma-rank-row">
      <span class="alma-rank-school">${escHtml(almaDisplay)}</span>
      <span class="alma-rank-player text-muted text-xs">${player ? escHtml(player.displayName) : ''}</span>
      <span class="alma-rank-value">${rankStr}</span>
    </div>`;
  });
  return rows.join('');
}

/**
 * Commissioner Settings-tab card — READ-ONLY summary of the derived alma-
 * mater roster (Drew, 2026-09-04, correcting the 8ae64f4/55f8908 two-list
 * build: "the roster of alma maters... should only be comprised of schools
 * claimed as alma maters by a player. If a player changes their claimed
 * alma mater, this should also change everything else related to alma
 * maters"). There is no add/remove here anymore — `claimedAlmaMaters()` is
 * DERIVED from `player.almaMater` across active players, so this card can
 * only show it, not edit it. Each school is listed with the active
 * player(s) claiming it; to change one, the pointer text sends the
 * commissioner to Players → Edit, the one place a claim actually changes.
 * Extracted as its own exported function (2026-09-04, alongside the
 * two-list fix) so it's directly testable without invoking the whole
 * renderCommPage() dependency closure, matching renderAlmaMaterWatch()/
 * renderAlmaMaterRankings() above. `data-comm-tab="settings"` preserved
 * (RG-10 — a card missing that attribute renders on all five tabs).
 */
export function renderAlmaMaterSettingsCard() {
  const almaMaters = claimedAlmaMaters();
  const activePlayers = getPlayers().filter(p => p.active);
  const claimantsOf = am => activePlayers.filter(p => (p.almaMater || '').trim().toLowerCase() === am.toLowerCase());
  return `
      <div class="admin-section" data-comm-tab="settings">
        <div class="admin-section-title">⭐ Alma Maters</div>
        <div class="card">
          <p class="text-muted text-xs mb-md">Derived from what each active player has set as their alma mater — not a separately-editable list. Drives Alma Mater Watch, Alma Mater Rankings, the ⭐ flag, guaranteed slate inclusion, the Rules tab list, and the tiebreaker's Auto-Calc, all from the same roster below. To add, remove, or change a school, edit the claiming player under Players → Edit — the change re-checks every game already on an open/upcoming week's slate immediately (no re-import needed). Weeks that are LOCKED, LIVE, or already FINAL are left untouched, so a tiebreaker answer players already submitted against — or an already-final Auto-Calc — never quietly changes.</p>
          <div id="alma-mater-list">
            ${almaMaters.length ? almaMaters.map(am => `
            <div class="flex gap-sm mb-sm" style="align-items:center">
              <span class="font-display" style="flex:1;font-size:.9rem">${escHtml(am)}</span>
              <span class="text-muted text-xs">${escHtml(claimantsOf(am).map(p => p.displayName).join(', '))}</span>
            </div>`).join('') : '<p class="text-muted text-xs">No active player has claimed a school yet — set one under Players → Edit.</p>'}
          </div>
        </div>
      </div>`;
}

// ─── COMMISSIONER PAGE ────────────────────────────────────────────────────────

function renderCommPage() {
  const c=document.getElementById('page-commissioner'); if(!c)return;
  const session=getSession();
  if(!session.isAdmin){renderCommLogin(c);return;}

  // Build page in safe sections — any crash shows which section failed
  try {
    const week       = getCurrentWeek();
    const games      = week ? getGames(week.weekId) : [];
    // DI-E — the tie preview needs the current slate's picks. Gated on
    // arePicksPublic(week) (blind rule — loadtest.mjs [64]): both call sites
    // that use `picks` only ever render once the week has reached 'live'
    // (renderWeekStatusButtons: 'final' is reachable only from 'live'; the
    // pendingFinalization banner only appears once every game is FINAL,
    // which itself requires 'live'), so this is always true in practice —
    // made explicit and load-bearing rather than left implicit.
    const picks      = week && arePicksPublic(week) ? getPicks(week.weekId) : [];
    const availGames = week ? getAvailableGames(week.weekId) : [];
    const players    = getPlayers();
    const settings   = getSettings();
    const allWeeks   = getWeeks().sort((a,b)=>b.weekNumber-a.weekNumber);
    const proof      = getFetchProof();
    const ps         = getProviderState();
    // Drop any suggestions the Commissioner has dismissed for this week
    // BEFORE scoring/tiering — a dismissed game shouldn't be reconsidered for
    // ANY tier (including a forced alma/anchor slot), so the pool it never
    // sees is the pool it can't force its way back into.
    const candidatePool = week ? availGames.filter(g => !isSuggestionRejected(week.weekId, g)) : availGames;
    const scoredCandidates = candidatePool.length>0 ? scoreCandidateGames(candidatePool, week?.weekId||'') : [];
    const builtSlate = buildSuggestedSlate(scoredCandidates, 10);
    const suggested  = builtSlate.slate;      // primary 10, chronological (DI-1)
    const shortlist  = builtSlate.shortlist;  // next 10 by score (DI-4)
    const almaCount  = builtSlate.almaCount;
    const morningAnchorFilled = builtSlate.morningAnchorFilled;
    const closingAnchorFilled = builtSlate.closingAnchorFilled;
    const rejectedCount = week ? getRejectedSuggestions(week.weekId).length : 0;

    const sections = [];

    sections.push(`<div class="section-header"><h2>Commissioner Panel</h2></div>`);

    // Tab bar — groups the 18 admin sections into 5 buckets so the panel
    // doesn't require infinite scrolling. The active tab is held in
    // state.commTab; CSS hides any .admin-section whose data-comm-tab
    // doesn't match the body's data-comm-active attribute.
    const tabs = [
      {key:'week',     label:'Week',     icon:'📅'},
      {key:'games',    label:'Games',    icon:'🏈'},
      {key:'players',  label:'Players',  icon:'👥'},
      {key:'settings', label:'Settings', icon:'⚙️'},
      {key:'data',     label:'Data',     icon:'☁️'},
    ];
    sections.push(`
      <div class="comm-tabbar" role="tablist">
        ${tabs.map(t => `
          <button type="button" class="comm-tab${state.commTab===t.key?' active':''}"
            data-comm-tab-btn="${t.key}" role="tab" aria-selected="${state.commTab===t.key}">
            <span class="comm-tab-icon">${t.icon}</span>
            <span class="comm-tab-label">${t.label}</span>
          </button>
        `).join('')}
      </div>`);

    // Week Manager
    sections.push(`
      <div class="admin-section" data-comm-tab="week">
        <div class="admin-section-title">📅 Week Manager</div>
        <div class="card">
          <div class="form-group">
            <label class="form-label">Active Week</label>
            <select class="form-select" id="active-week-selector">
              ${allWeeks.map(w=>`<option value="${w.weekId}"${w.weekId===week?.weekId?' selected':''}>
                ${escHtml(formatWeekLabel(w))} — ${w.status}${w.dataSourceMode==='demo'?' · DEMO':''}
              </option>`).join('')}
            </select>
          </div>
          <div class="flex gap-sm flex-wrap">
            <button class="btn btn-primary btn-sm" id="create-week-btn">➕ New Week</button>
            <button class="btn btn-ghost btn-sm" id="duplicate-week-btn">📋 Duplicate</button>
            ${week?`<button class="btn btn-danger btn-sm" id="delete-week-btn">🗑 Delete</button>`:''}
          </div>
        </div>
      </div>`);

    // Groups A/B (2026-09-10, DI-B5) — Commissioner Announcements. RG-10
    // tagging (data-comm-tab="week") so this renders ONLY on Week, not all
    // five tabs. No week-status dependency — sendable any time. NEVER
    // SCRIBE-attributed (actor.kind is hardcoded 'commissioner' inside
    // notifyCommissionerAnnouncement() — a structural rule, not a UI one).
    sections.push(`
      <div class="admin-section" data-comm-tab="week">
        <div class="admin-section-title">🎙 Commissioner Announcement</div>
        <div class="card">
          <p class="text-muted text-xs mb-sm">Sent to every active player's Notification Center + push, labeled "Commissioner" — never SCRIBE. Not silenceable by players (same as any other explicit commissioner message).</p>
          <div class="form-group">
            <textarea class="form-input" id="comm-announce-body" rows="3" placeholder="Message the league…" maxlength="500"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="comm-announce-send-btn" disabled>Send to league</button>
        </div>
      </div>`);

    // Week Settings
    if (week) {
      sections.push(`
        <div class="admin-section" data-comm-tab="week">
          <div class="admin-section-title">Week Settings — ${escHtml(formatWeekLabel(week))}</div>
          <div class="card">
            ${week.dataSourceMode==='demo'?'<div class="warning-box mb-md">📋 This is the Demo Week with fictional games. Do not use for real picks.</div>':''}
            <div class="flex gap-sm flex-wrap mb-sm">${renderWeekStatusButtons(week)}</div>
            <div class="form-group">
              <label class="form-label">Data Source Mode</label>
              <select class="form-select" id="data-source-mode">
                <option value="espn_live"      ${week.dataSourceMode==='espn_live'?'selected':''}>📡 ESPN Live</option>
                <option value="espn_historical" ${week.dataSourceMode==='espn_historical'?'selected':''}>📅 ESPN Historical</option>
                <option value="manual"          ${week.dataSourceMode==='manual'?'selected':''}>✏️ Manual</option>
                <option value="demo"            ${week.dataSourceMode==='demo'?'selected':''}>📋 Demo</option>
              </select>
            </div>
            <div class="flex gap-sm flex-wrap mb-md">
              <div class="form-group" style="flex:1;min-width:120px;margin:0">
                <label class="form-label">Custom Round Label <span class="text-muted text-xs">(added after the week number, e.g. "Part 2" → "Week 1, Part 2")</span></label>
                <input class="form-input" id="week-round-label" placeholder="e.g. Part 2" value="${escHtml(week.roundLabel||'')}" />
              </div>
              <div class="form-group" style="flex:1;min-width:80px;margin:0">
                <label class="form-label">ESPN Week # <span class="text-muted text-xs">(overrides the DISPLAYED number only, e.g. "3" → "Week 3" — does not change this week's internal order)</span></label>
                <input class="form-input" id="week-espn-num" type="number" placeholder="1" value="${escHtml(String(week.espnWeekNumber||''))}" />
              </div>
            </div>
            ${(() => {
              // UN-118/UN-125 — multi-part week grouping (DI-126b). A week
              // RECORD is a scheduling unit; the group is the COMPETITIVE
              // week players actually compete over and win a prize for. Use
              // this when one real week's games can't share a lock time (a
              // split slate, bowls, CFP).
              const groupWeeksNow = weeksInGroup(allWeeks, week);
              const otherMembers = groupWeeksNow.filter(w => w.weekId !== week.weekId);
              const currentPartnerId = otherMembers[0]?.weekId || '';
              const partnerOptions = allWeeks.filter(w =>
                w.weekId !== week.weekId && w.season === week.season && w.dataSourceMode !== 'demo');
              return `
            <div class="form-group">
              <label class="form-label">Part of the Same Competitive Week As <span class="text-muted text-xs">(optional — splits/bowls/CFP)</span></label>
              <select class="form-select" id="week-group-partner">
                <option value="">— Not grouped —</option>
                ${partnerOptions.map(w=>`<option value="${w.weekId}"${w.weekId===currentPartnerId?' selected':''}>${escHtml(formatWeekLabel(w))}</option>`).join('')}
              </select>
              <p class="text-muted text-xs mt-sm">Both parts still lock and score independently — this only tells Standings, Weekly History and the weekly prize to treat them as ONE competitive week instead of two.</p>
            </div>
            ${otherMembers.length ? `
            <div class="form-group">
              <div class="text-xs text-muted mb-xs">This group: ${groupWeeksNow.map(w=>escHtml(formatWeekLabel(w))).join(' · ')}</div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="week-group-tiebreaker" ${week.isGroupTiebreaker?'checked':''} />
                <span class="form-label" style="margin:0">This part's tiebreaker breaks ties for the whole group</span>
              </label>
              ${isGroupTiebreakerAmbiguous(groupWeeksNow) ? `<p class="warning-box mt-sm">⚠️ No part of this group is marked as the tiebreaker of record — falling back to the highest week number (${escHtml(formatWeekLabel(getGroupTiebreakerWeek(groupWeeksNow)))}). Tick the box on exactly one part to make this explicit.</p>` : ''}
            </div>` : ''}`;
            })()}
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="week-show-history" ${week.showInHistory!==false?'checked':''} />
                <span class="form-label" style="margin:0">Show in Standings / Weekly History</span>
              </label>
              <p class="text-muted text-xs mt-sm">Uncheck to hide demo/test weeks from standings.</p>
            </div>
            <div class="flex gap-sm flex-wrap mb-md">
              <div class="form-group" style="flex:1;min-width:120px;margin:0">
                <label class="form-label">Start Date</label>
                <input class="form-input" type="date" id="week-start" value="${week.startDate||''}" />
              </div>
              <div class="form-group" style="flex:1;min-width:120px;margin:0">
                <label class="form-label">End Date</label>
                <input class="form-input" type="date" id="week-end" value="${week.endDate||''}" />
              </div>
            </div>
            <div class="flex gap-sm flex-wrap mb-md">
              <div class="form-group" style="flex:1;min-width:180px;margin:0">
                <label class="form-label">Auto-Open At</label>
                <input class="form-input" type="datetime-local" id="picks-open-at"
                  value="${week.picksOpenAt?new Date(week.picksOpenAt).toISOString().slice(0,16):''}" />
              </div>
              <div class="form-group" style="flex:1;min-width:180px;margin:0">
                <label class="form-label">Auto-Lock At (override)
                  <span class="text-muted text-xs">— blank = auto-derive</span>
                </label>
                <input class="form-input" type="datetime-local" id="picks-lock-at"
                  value="${week.picksLockAt?new Date(week.picksLockAt).toISOString().slice(0,16):''}" />
              </div>
            </div>
            <!-- Auto-transition config: how long before first kickoff to lock,
                 and whether to auto-transition to LIVE/pending-FINAL. -->
            <div class="auto-transition-config">
              <div class="card-title mb-sm">🔄 Auto-Transitions</div>
              <div class="flex gap-sm flex-wrap mb-sm">
                <div class="form-group" style="flex:1;min-width:180px;margin:0">
                  <label class="form-label">Lock N minutes before first kickoff
                    <span class="text-muted text-xs">— default 30</span>
                  </label>
                  <input class="form-input" type="number" min="0" max="720"
                    id="auto-lock-offset" value="${getAutoLockOffsetMinutes(week)}" />
                </div>
              </div>
              <div class="form-group">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" id="auto-live-enabled" ${getAutoLiveEnabled(week)?'checked':''} />
                  <span class="form-label" style="margin:0">Auto-transition LOCKED → LIVE at first kickoff</span>
                </label>
              </div>
              <div class="form-group">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" id="auto-final-enabled" ${getAutoFinalizeEnabled(week)?'checked':''} />
                  <span class="form-label" style="margin:0">Prompt for finalization when all games are final</span>
                </label>
                <p class="text-muted text-xs mt-sm">Auto-finalize never happens without a commissioner click — it just shows a confirm prompt.</p>
              </div>
              ${(() => {
                const games = getGames(week.weekId);
                const lockAt = computeEffectiveLockAt(week, games);
                const liveAt = computeEffectiveLiveAt(week, games);
                if (!lockAt && !liveAt) return '<p class="text-muted text-xs">Effective times will show once games are on the slate.</p>';
                const tz = getTimezone();
                const fmt = (d) => d ? formatGameTime(d.toISOString(), tz) : '—';
                return `<div class="effective-times-preview">
                  <div><strong>Effective lock:</strong> ${escHtml(fmt(lockAt))}</div>
                  <div><strong>Effective live:</strong> ${escHtml(fmt(liveAt))}</div>
                </div>`;
              })()}
            </div>
            ${week.pendingFinalization ? `
              <div class="pending-final-banner">
                <div><strong>⏰ All games are final.</strong> Ready to close this week and lock standings?</div>
                ${weekHasUnresolvedTie(week, players.filter(p=>p.active), picks, games) ? `
                  <div class="warning-box mt-sm">⚠️ This week has a tie in correct picks and no tiebreaker entered. The winner/loser will be decided arbitrarily until you enter one — do that on this tab, then Confirm Finalization.</div>
                ` : ''}
                <div class="flex gap-sm mt-sm">
                  <button class="btn btn-primary btn-sm" id="confirm-finalize-btn">✅ Confirm Finalization</button>
                  <button class="btn btn-ghost btn-sm" id="dismiss-pending-btn">Not yet</button>
                </div>
              </div>
            ` : ''}
            <button class="btn btn-primary btn-sm" id="save-week-settings-btn">Save Week Settings</button>
            <div class="form-group mt-md">
              <label class="form-label">Weekly Blurb</label>
              <textarea class="form-textarea" id="blurb-input">${escHtml(week.blurb||'')}</textarea>
              <button class="btn btn-secondary btn-sm mt-sm" id="save-blurb-btn">Save Blurb</button>
            </div>
          </div>
        </div>`);
    }

    // ESPN Fetch
    sections.push(`
      <div class="admin-section" data-comm-tab="games">
        <div class="admin-section-title">📡 ESPN Data Fetch</div>
        <div class="card">
          <p class="text-muted text-sm mb-md">Uses the Week start/end dates above. Set them first, then fetch.</p>
          <div class="api-url-box mb-md" id="api-url-box">
            <span class="api-url-label">ESPN URL:</span>
            <code class="api-url-code" id="api-url-display">Click Preview to generate</code>
            <div class="flex gap-sm mt-sm flex-wrap">
              <button class="btn btn-ghost btn-sm" id="preview-url-btn">🔍 Preview URL</button>
              <button class="btn btn-ghost btn-sm" id="copy-url-btn">📋 Copy</button>
              <button class="btn btn-ghost btn-sm" id="open-url-btn">🔗 Open in Tab</button>
            </div>
          </div>
          <div class="flex gap-sm flex-wrap">
            <button class="btn btn-primary btn-sm" id="fetch-espn-btn">📥 Fetch ESPN Data</button>
            <button class="btn btn-ghost btn-sm" id="load-hist-demo-btn">📅 Load Historical Demo Week</button>
          </div>
          ${ps.lastFetchTimestamp?`<p class="text-muted text-xs mt-sm">Last fetch: ${new Date(ps.lastFetchTimestamp).toLocaleString()} · ${ps.lastRawEventCount} events</p>`:''}
        </div>
      </div>`);

    // Data Proof
    sections.push(`
      <div class="admin-section" data-comm-tab="games">
        <div class="admin-section-title">🔍 Data Proof</div>
        <div class="card">${renderDataProofPanel(proof,ps,week,games)}</div>
      </div>`);

    // Priority 14: Weekly Summary email helper. Shows up once every game on
    // the slate is FINAL, so the Commissioner has a one-click way to wrap the
    // week. Hidden when there are no games yet, or when any game is still
    // scheduled/live (sending early would be misleading).
    if (week && games.length > 0 && games.every(g => g.status === GAME_STATUS.FINAL)) {
      const recipients = getPlayers().filter(p => p.active && p.email).length;
      const totalActive = getPlayers().filter(p => p.active).length;
      sections.push(`
        <div class="admin-section" data-comm-tab="week">
          <div class="admin-section-title">📤 Weekly Summary Email</div>
          <div class="card">
            <p class="text-secondary text-sm mb-sm">All games are final — you can send the week's recap to players.</p>
            <p class="text-muted text-xs mb-md">
              Email-on-file: <strong>${recipients}</strong> of ${totalActive} active players.
              ${recipients < totalActive ? '<br>Players without an email won\'t receive the recap — add emails in <em>Players, PINs & Contact</em>.' : ''}
            </p>
            <div class="flex gap-sm flex-wrap">
              <button class="btn btn-primary btn-sm" id="weekly-summary-preview-btn">👁 Preview</button>
              <button class="btn btn-secondary btn-sm" id="weekly-summary-send-btn" ${recipients===0?'disabled':''}>📤 Open in Mail Client</button>
            </div>
            <div id="weekly-summary-preview" class="weekly-summary-preview" style="display:none"></div>
          </div>
        </div>`);
    }

    // Available Games Pool
    if (availGames.length) {
      sections.push(`
        <div class="admin-section" data-comm-tab="games">
          <div class="admin-section-title">📋 Available Games (${availGames.length} from ESPN)</div>
          <div class="card mb-sm">
            <div class="flex gap-sm mb-md flex-wrap">
              <button class="btn btn-primary btn-sm" id="apply-suggested-btn">✅ Apply Suggested 10</button>
              <button class="btn btn-ghost btn-sm" id="clear-pool-btn">🗑 Clear Pool</button>
              ${rejectedCount>0?`<button class="btn btn-ghost btn-sm" id="restore-rejected-btn">↩ Restore ${rejectedCount} dismissed</button>`:''}
            </div>
            ${renderSuggestedSlatePreview({suggested, shortlist, almaCount, morningAnchorFilled, closingAnchorFilled}, games, week)}
            <div class="card-title mb-sm mt-md">All Available Games</div>
            ${renderAvailFilterBar(availGames)}
            <div id="avail-groups-list">${renderAvailableGroups(availGames, games, week)}</div>
          </div>
        </div>`);
    }

    // Selected Slate
    sections.push(`
      <div class="admin-section" data-comm-tab="games">
        <div class="admin-section-title">🏈 Selected Slate (${games.length}/10 games)</div>
        <div class="flex gap-sm mb-md flex-wrap">
          <button class="btn btn-ghost btn-sm" id="add-manual-game-btn">➕ Add Manually</button>
          <button class="btn btn-ghost btn-sm" id="unlock-all-btn">🔓 Unlock All</button>
          ${games.length?`
            <button class="btn btn-secondary btn-sm" id="refresh-scores-btn">🔄 Refresh Scores</button>
            <button class="btn btn-secondary btn-sm" id="finalize-scoring-btn">✅ Calculate ATS</button>
            <button class="btn btn-danger btn-sm" id="clear-slate-btn">🗑 Clear All Slate Games</button>
          `:''}
        </div>
        <div id="admin-games-list">${renderAdminGamesList(games,week,getGameLockOverrides())}</div>
      </div>`);

    // ── EXPORT (expanded — multiple formats and scopes) ──
    sections.push(`
      <div class="admin-section" data-comm-tab="data">
        <div class="admin-section-title">📤 Export Data</div>
        <div class="card">
          <p class="text-muted text-xs mb-md">CSV format opens in Excel / Google Sheets. JSON format preserves full state for backup/restore.</p>
          <div class="card-title mb-sm">Current Week (${week?escHtml(formatWeekLabel(week)):'no active week'})</div>
          <div class="flex gap-sm mb-md flex-wrap">
            <button class="btn btn-secondary btn-sm" id="export-week-picks-csv-btn" ${week?'':'disabled'}>📋 Week Picks CSV</button>
            <button class="btn btn-secondary btn-sm" id="export-week-slate-csv-btn" ${week?'':'disabled'}>🏈 Week Slate CSV</button>
            <button class="btn btn-secondary btn-sm" id="export-week-results-csv-btn" ${week?'':'disabled'}>🏆 Week Results CSV</button>
            <button class="btn btn-secondary btn-sm" id="export-week-dashboard-csv-btn" ${week?'':'disabled'}>📊 Week Dashboard Matrix CSV</button>
            <button class="btn btn-secondary btn-sm" id="export-week-bundle-btn" ${week?'':'disabled'}>📦 Week Bundle (all of above)</button>
          </div>
          <div class="divider"></div>
          <div class="card-title mb-sm">League-wide</div>
          <div class="flex gap-sm mb-md flex-wrap">
            <button class="btn btn-secondary btn-sm" id="export-players-csv-btn">👥 Players CSV</button>
            <button class="btn btn-secondary btn-sm" id="export-standings-csv-btn">🏆 Season Standings CSV</button>
            <button class="btn btn-secondary btn-sm" id="export-weekly-results-csv-btn">📅 All Weekly Results CSV</button>
            <button class="btn btn-secondary btn-sm" id="export-obligations-csv-btn">💵 Obligations CSV</button>
          </div>
          <div class="divider"></div>
          <div class="card-title mb-sm">Full Backup</div>
          <div class="flex gap-sm flex-wrap">
            <button class="btn btn-primary btn-sm" id="export-full-json-btn">💾 Full Backup (JSON)</button>
            <button class="btn btn-secondary btn-sm" id="export-full-csv-bundle-btn">📦 Full CSV Bundle (all data)</button>
          </div>
          <p class="text-muted text-xs mt-sm">Full backup preserves every week, pick, result, and player. CSV bundle exports each table as its own download.</p>
        </div>
      </div>`);

    // Feedback review + CSV (UN-122/123) — directly after Export Data, same
    // tab (RG-10). NOT part of exportFullCsvBundle — Drew was offered that
    // and did not select it.
    sections.push(renderFeedbackAdminSectionHTML());

    // SCRIBE Trainer (Build 2b, E5b, UN-163) — directly after Feedback, same
    // tab (RG-10): both are "review what players told us" surfaces.
    sections.push(renderScribeTrainerAdminSectionHTML());

    // DI-H (2026-09-02) — the one-time (though PERMANENTLY available)
    // retroactive recompute. Placed directly ABOVE Obligation Corrections so
    // anything it flags via DI-D's finalizeWeek() → reconcileWeeklyObligation()
    // path appears in the very next card.
    sections.push(renderRecalculateFinalizedWeeksAdminSectionHTML());

    // Obligation Corrections (UN-126, Part 2) — merge / void, directly after
    // Feedback, same tab (RG-10). The Players-tab Obligations card (above)
    // stays the day-to-day paid/unpaid ledger; this is the audit/correction
    // tool for duplicate or disputed records.
    sections.push(renderObligationCorrectionsAdminSectionHTML());

    // Tiebreaker
    if (week) {
      sections.push(`
        <div class="admin-section" data-comm-tab="week">
          <div class="admin-section-title">🎯 Tiebreaker</div>
          <div class="card">
            <div class="form-group"><label class="form-label">Question</label>
              <input class="form-input" id="tb-question" value="${escHtml(week.tiebreakerQuestion||'')}" /></div>
            <div class="form-group"><label class="form-label">Actual Value</label>
              <div class="flex gap-sm">
                <input class="form-input" id="tb-actual" type="number" style="flex:1"
                  value="${week.actualTiebreakerValue!==null?week.actualTiebreakerValue:''}" placeholder="Enter actual…" />
                <button class="btn btn-secondary btn-sm" id="auto-calc-tb-btn">Auto-Calc</button>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" id="save-tb-btn">Save Tiebreaker</button>
            ${renderTiebreakerGuessesAdmin(week,players,week.actualTiebreakerValue)}
          </div>
        </div>`);
    }

    // Demo Simulation
    sections.push(`
      <div class="admin-section" data-comm-tab="week">
        <div class="admin-section-title">🎮 Demo Simulation</div>
        <div class="card">
          <p class="text-secondary text-sm mb-md">Simulate scheduled → live → final without real games.</p>
          ${games.length===0?'<div class="info-box">Add games to the slate first.</div>':`
            <div class="form-group">
              <label class="form-label">Quick edit a single game</label>
              <select class="form-select" id="demo-game-select">
                <option value="">— Choose a game —</option>
                ${games.map(g=>`<option value="${g.gameId}">${escHtml(matchup(g))} [${g.status}]</option>`).join('')}
              </select>
            </div>
            <div id="demo-game-controls" style="display:none">
              <div class="flex gap-sm flex-wrap mb-md">
                <button class="btn btn-secondary btn-sm" id="demo-set-live">▶️ Set Live</button>
                <button class="btn btn-secondary btn-sm" id="demo-set-final">✅ Set Final</button>
                <button class="btn btn-ghost btn-sm" id="demo-set-scheduled">↩ Reset Scheduled</button>
              </div>
              <div class="flex gap-sm mb-md">
                <div class="form-group" style="flex:1;margin:0">
                  <label class="form-label" id="demo-home-label">Home Score</label>
                  <input class="form-input" id="demo-home-score" type="number" min="0" value="0" />
                </div>
                <div class="form-group" style="flex:1;margin:0">
                  <label class="form-label" id="demo-away-label">Away Score</label>
                  <input class="form-input" id="demo-away-score" type="number" min="0" value="0" />
                </div>
                <button class="btn btn-primary btn-sm" style="align-self:flex-end" id="demo-update-score">Update</button>
              </div>
            </div>

            <div class="divider"></div>

            <!-- BATCH GRID — edit every game's score + status at once -->
            <div class="card-title mb-sm">⚡ Batch update all games</div>
            <p class="text-muted text-xs mb-sm">Set scores and statuses for every game, then apply in one click. Useful for setting up a whole-week demo scenario fast.</p>
            ${renderDemoBatchGrid(games)}
            <div class="flex gap-sm flex-wrap mt-md">
              <button class="btn btn-primary btn-sm" id="demo-batch-apply">💾 Apply All Changes</button>
              <button class="btn btn-secondary btn-sm" id="demo-batch-randomize">🎲 Randomize Scores</button>
            </div>

            <div class="divider"></div>
            <div class="flex gap-sm flex-wrap">
              <button class="btn btn-primary btn-sm" id="demo-finalize-all">🏁 Finalize All & Calculate</button>
              <button class="btn btn-ghost btn-sm" id="demo-reset-all-scheduled">↩ Reset All Scheduled</button>
            </div>`}
        </div>
      </div>`);

    // Nicknames
    if (week) {
      sections.push(`
        <div class="admin-section" data-comm-tab="players">
          <div class="admin-section-title">Weekly Nicknames</div>
          <div class="card">
            ${players.filter(p=>p.active).map(p=>{
              const nick=getNickname(week.weekId,p.playerId)||'';
              return`<div class="flex gap-sm mb-sm" style="align-items:center">
                <span class="font-display" style="min-width:80px;font-size:.9rem">${escHtml(p.displayName)}</span>
                <input class="form-input" style="flex:1" type="text" maxlength="40"
                  id="nick-${p.playerId}" placeholder='"the best"' value="${escHtml(nick)}" />
                <button class="btn btn-secondary btn-sm save-nick-btn" data-player-id="${p.playerId}" data-week-id="${week.weekId}">Save</button>
              </div>`;
            }).join('')}
          </div>
        </div>`);
    }

    // Players
    sections.push(`
      <div class="admin-section" data-comm-tab="players">
        <div class="admin-section-title">Players, PINs &amp; Contact</div>
        <div class="card">
          <p class="text-muted text-xs mb-md">PINs are hidden by default. Toggle 🙈 to reveal. Save an email per player to share PINs and league updates. Player PINs never appear anywhere outside this panel.</p>
          ${players.map(p=>{
            const pin = getPlayerPin(p.playerId);
            return `
            <div class="player-admin-row" data-player-row="${p.playerId}">
              <div class="player-admin-info">
                <span class="player-admin-avatar${!p.active?' inactive':''}">${escHtml(getPlayerInitials(p))}</span>
                <div>
                  <div class="font-display" style="font-size:.9rem">${escHtml(p.displayName)}${!p.active?' <em class="text-muted">(inactive)</em>':''}</div>
                  <div class="text-xs text-muted">${escHtml(p.almaMater||'No alma mater set')}</div>
                </div>
              </div>
              <div class="player-admin-controls">
                <div class="player-admin-field">
                  <label class="micro-label">PIN</label>
                  <div class="pin-field">
                    <input class="form-input pin-input" type="password" data-pin="${escHtml(pin)}" value="${escHtml(pin)}" readonly autocomplete="off" />
                    <button class="btn btn-ghost btn-sm pin-toggle-btn" data-player-id="${p.playerId}" title="Show/hide PIN">🙈</button>
                  </div>
                </div>
                <div class="player-admin-field">
                  <label class="micro-label">Email</label>
                  <input class="form-input email-input" type="email" data-player-id="${p.playerId}" value="${escHtml(p.email||'')}" placeholder="player@email.com" />
                </div>
                <div class="player-admin-field player-admin-actions">
                  <button class="btn btn-secondary btn-sm save-email-btn" data-player-id="${p.playerId}" title="Save email">💾</button>
                  <button class="btn btn-secondary btn-sm share-pin-btn" data-player-id="${p.playerId}" title="Share PIN via email" ${p.email?'':'disabled'}>✉ Share PIN</button>
                  <button class="btn btn-ghost btn-sm edit-player-btn" data-player-id="${p.playerId}">Edit</button>
                  <button class="btn btn-ghost btn-sm reset-pin-btn" data-player-id="${p.playerId}" data-name="${escHtml(p.displayName)}">Reset PIN</button>
                  <button class="btn ${p.active?'btn-danger':'btn-secondary'} btn-sm toggle-player-btn" data-player-id="${p.playerId}">${p.active?'Deactivate':'Activate'}</button>
                </div>
              </div>
            </div>`;
          }).join('')}

          <div class="divider"></div>
          <div class="flex gap-sm">
            <input class="form-input" id="admin-new-player" type="text" placeholder="New player name…" style="flex:1" />
            <button class="btn btn-secondary btn-sm" id="admin-add-player-btn">Add</button>
          </div>

          <div class="divider"></div>
          <div class="card-title mb-sm">📣 Broadcast to League</div>
          <p class="text-muted text-xs mb-sm">Sends one email to every active player who has an email on file. Opens your mail client with everyone in BCC (their addresses stay private).</p>
          <div class="form-group">
            <label class="form-label">Subject</label>
            <input class="form-input" id="bcast-subject" type="text" placeholder="Week 5 picks are open" value="CFB Pickems update" />
          </div>
          <div class="form-group">
            <label class="form-label">Message</label>
            <textarea class="form-input" id="bcast-body" rows="4" placeholder="Hey all, picks for this week are open and lock Friday at 6pm. Site: …"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="bcast-send-btn">✉ Open in Mail Client</button>
        </div>
      </div>`);

    // Obligations (v0.17.0: manual add/delete + the 2K25 carryover ledger)
    sections.push(`
      <div class="admin-section" data-comm-tab="players">
        <div class="admin-section-title">Obligations</div>
        <div class="card mb-md">${renderObligationsAdmin()}
          <div class="divider"></div>
          <div class="form-group"><label class="form-label" style="font-size:.7rem">Add an obligation manually</label>
            <div class="flex gap-sm flex-wrap" style="align-items:flex-end">
              <select class="form-select" id="ob-add-payer" style="width:auto">${players.map(p=>`<option value="${p.playerId}">${escHtml(p.displayName)}</option>`).join('')}</select>
              <span class="text-muted text-xs">owes</span>
              <select class="form-select" id="ob-add-recipient" style="width:auto">${players.map(p=>`<option value="${p.playerId}">${escHtml(p.displayName)}</option>`).join('')}</select>
              <input class="form-input" id="ob-add-note" placeholder="what & why (e.g. 1 drink — side bet)" style="flex:1;min-width:160px" />
              <button class="btn btn-primary btn-sm" id="ob-add-btn">Add</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="flex" style="justify-content:space-between;align-items:baseline">
            <strong style="font-size:.85rem">🍺 2K25 carryover ledger</strong>
            <span class="text-muted text-xs">14 weekly drinks + 1 bonus, all unpaid — from the audited season report</span>
          </div>
          ${renderSeason2025ObligationsAdmin()}
        </div>
      </div>`);

    // Auto-refresh
    sections.push(`
      <div class="admin-section" data-comm-tab="settings">
        <div class="admin-section-title">⏱ Auto-Refresh</div>
        <div class="card">
          <div class="form-group">
            <label class="form-label">Score Refresh Interval</label>
            <select class="form-select" id="auto-refresh-select">
              <option value="0"   ${(settings.autoRefreshInterval||60)===0?'selected':''}>Off</option>
              <option value="30"  ${settings.autoRefreshInterval===30?'selected':''}>30 seconds</option>
              <option value="60"  ${(settings.autoRefreshInterval||60)===60?'selected':''}>60 seconds</option>
              <option value="300" ${settings.autoRefreshInterval===300?'selected':''}>5 minutes</option>
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" id="save-refresh-btn">Save</button>
        </div>
      </div>`);

    // Alma Maters — READ-ONLY summary card. See renderAlmaMaterSettingsCard()'s
    // docstring above (2026-09-04) for the model this reflects.
    sections.push(renderAlmaMaterSettingsCard());

    // Randomize Picks shortcut (UN-107) — default OFF (CONVENTIONS #10:
    // existing settings blobs lack this field and must read as false, not
    // truthy-by-accident). Same toggle-card pattern as Chat & S.C.R.I.B.E.
    // above: title, checkbox row, state-dependent copy underneath.
    sections.push(`
      <div class="admin-section" data-comm-tab="settings">
        <div class="card" id="comm-randomize-card">
          <h3 style="color:var(--maroon)">🎲 Randomize Picks Shortcut</h3>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid var(--border)">
            <input type="checkbox" id="randomize-enabled-toggle" ${settings.randomizePicksEnabled ? 'checked' : ''} />
            <span class="form-label" style="margin:0">Allow players to randomize their picks</span>
          </label>
          <p class="text-muted text-xs">${settings.randomizePicksEnabled
            ? 'Players see a 🎲 Randomize My Picks shortcut on the Picks page.'
            : 'The randomize shortcut is hidden. Players make every pick by hand.'}</p>
        </div>
      </div>`);

    // Rules
    sections.push(`
      <div class="admin-section" data-comm-tab="settings">
        <div class="admin-section-title">League Rules</div>
        <div class="card">
          <textarea class="form-textarea" id="rules-editor" style="min-height:180px;font-size:.8rem;font-family:monospace">${getRulesEditorText()}</textarea>
          <div class="flex gap-sm mt-sm">
            <button class="btn btn-primary btn-sm" id="save-rules-btn">Save Rules</button>
            <button class="btn btn-ghost btn-sm" id="reset-rules-btn">Reset Default</button>
          </div>
        </div>
      </div>`);

    // ── Cloud Sync (shared backend) ──
    const beCfg = getBackendConfig() || { url:'', token:'' };
    const beMode = getBackendMode();
    const beReady = isBackendReady();
    const syncStatus = getSyncStatus();
    // Friendly "12 seconds ago" formatter
    const syncAgo = (iso) => {
      if (!iso) return 'never';
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 5) return 'just now';
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.floor(s/60)}m ago`;
      if (s < 86400) return `${Math.floor(s/3600)}h ago`;
      return new Date(iso).toLocaleString();
    };
    sections.push(`
      <div class="admin-section" data-comm-tab="data">
        <div class="admin-section-title">☁️ Cloud Sync (Google Sheets)</div>
        <div class="card">
          <p class="text-secondary text-sm mb-sm">
            Connect a Google Sheet so all players share the same data across devices.
            Status: <strong>${beMode==='googleSheets'&&beReady?'✅ Connected':beMode==='googleSheets'?'⚠️ Configured, not connected':'⚪ Local only (this device)'}</strong>
          </p>

          ${beMode==='googleSheets'&&beReady ? `
          <div class="sync-status-panel">
            <div class="card-title mb-sm">What syncs &amp; when</div>
            <ul class="sync-explainer">
              <li><strong>Every write auto-syncs.</strong> Player pick submissions, commissioner edits to games/spreads/scores, results calculations, reset operations — all push to the Sheet automatically within ~1 second.</li>
              <li><strong>Reads</strong> use a local in-memory mirror seeded from the Sheet at startup, so the app stays fast and works briefly offline. Pull manually (below) to refresh from a teammate's recent edit.</li>
              <li><strong>Device-local</strong> (does NOT sync, by design): your login session, the site-PIN unlock state, and the Sheet URL/token on this device.</li>
              <li><strong>If a sync fails</strong> (network drop, Sheet quota hit) the change is queued in the local cache and retries on the next write. The status badge at the top shows ⚠️ when this happens.</li>
              <li><strong>Manual exports</strong> (Export Data section) still work and are recommended as periodic offline backups in addition to auto-sync.</li>
            </ul>
            <div class="sync-stats">
              <div><span class="micro-label">Last successful sync</span><strong>${syncAgo(syncStatus.lastSyncAt)}</strong></div>
              <div><span class="micro-label">Pending writes</span><strong>${syncStatus.pendingWrites}</strong></div>
              <div><span class="micro-label">Last error</span><strong>${syncStatus.lastError ? escHtml(syncStatus.lastError) : '—'}</strong></div>
            </div>
            <div class="flex gap-sm mt-sm flex-wrap">
              <button class="btn btn-ghost btn-sm" id="be-flush-now-btn">⚡ Flush pending now</button>
              <button class="btn btn-ghost btn-sm" id="be-pull-now-btn">⬇️ Pull latest from Sheet</button>
            </div>
          </div>
          ` : ''}

          <div class="form-group">
            <label class="form-label">Web App URL <span class="text-muted text-xs">(ends in /exec)</span></label>
            <input class="form-input" id="be-url" placeholder="https://script.google.com/macros/s/…/exec" value="${escHtml(beCfg.url||'')}" />
          </div>
          <div class="form-group">
            <label class="form-label">Access Token</label>
            <input class="form-input" id="be-token" type="password" placeholder="from Apps Script setup" value="${escHtml(beCfg.token||'')}" />
          </div>
          <div class="flex gap-sm flex-wrap mb-md">
            <button class="btn btn-secondary btn-sm" id="be-test-btn">🔌 Test Connection</button>
            <button class="btn btn-primary btn-sm" id="be-save-btn">💾 Save & Connect</button>
            <button class="btn btn-ghost btn-sm" id="be-disconnect-btn">Disconnect</button>
          </div>
          <div class="divider"></div>
          <p class="text-muted text-xs mb-sm">First-time setup: push THIS device's data up to seed an empty Sheet, or pull the Sheet's data down to this device.</p>
          <div class="flex gap-sm flex-wrap mb-md">
            <button class="btn btn-secondary btn-sm" id="be-seed-btn">⬆️ Push local data to Sheet (seed)</button>
            <button class="btn btn-secondary btn-sm" id="be-pull-btn">⬇️ Pull Sheet data to this device</button>
          </div>
          <div class="divider"></div>
          <p class="text-muted text-xs mb-sm">Season backups (snapshots) live in the Sheet and can be restored.</p>
          <div class="flex gap-sm flex-wrap mb-sm">
            <button class="btn btn-secondary btn-sm" id="be-snapshot-btn">📸 Create Snapshot</button>
            <button class="btn btn-ghost btn-sm" id="be-list-snapshots-btn">📜 List Snapshots</button>
          </div>
          <div id="be-snapshots-list" class="text-xs text-muted"></div>
        </div>
      </div>`);

    // ── Security & Settings (password change, site PIN) ──
    sections.push(`
      <div class="admin-section" data-comm-tab="settings">
        <div class="admin-section-title">🔐 Security &amp; Settings</div>
        <div class="card">
          <div class="card-title mb-sm">Commissioner Password</div>
          <p class="text-muted text-xs mb-sm">Used to access this Commissioner panel and authorize full resets.</p>
          <div class="form-group">
            <label class="form-label">Current password</label>
            <input class="form-input" id="sec-pw-current" type="password" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label class="form-label">New password</label>
            <input class="form-input" id="sec-pw-new" type="password" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label">Confirm new password</label>
            <input class="form-input" id="sec-pw-confirm" type="password" autocomplete="new-password" />
          </div>
          <button class="btn btn-primary btn-sm" id="sec-change-pw-btn">🔑 Change Password</button>

          <div class="divider"></div>
          <div class="card-title mb-sm">Site PIN (front-door gate)</div>
          <p class="text-muted text-xs mb-sm">The PIN required to open the app. Current: <strong class="font-display">${escHtml(getEffectiveSitePin())}</strong>. Players will need the new PIN on their next visit (existing unlocked devices stay unlocked).</p>
          <div class="form-group">
            <label class="form-label">New site PIN</label>
            <input class="form-input" id="sec-site-pin-new" type="text" inputmode="numeric" maxlength="12" placeholder="4–12 characters" />
          </div>
          <div class="form-group">
            <label class="form-label">Confirm new site PIN</label>
            <input class="form-input" id="sec-site-pin-confirm" type="text" inputmode="numeric" maxlength="12" />
          </div>
          <button class="btn btn-primary btn-sm" id="sec-change-site-pin-btn">🚪 Change Site PIN</button>

          <div class="divider"></div>
          <div class="card-title mb-sm">Welcome Screen Text</div>
          <p class="text-muted text-xs mb-sm">Shown above the PIN entry on the front gate. Title renders as two lines (small "welcome to" eyebrow + larger league name).</p>
          <div class="form-group">
            <label class="form-label">Title — top line</label>
            <input class="form-input" id="sec-welcome-title-top" type="text" maxlength="40" placeholder="welcome to" value="${escHtml(settings.welcomeTitleTop||'')}" />
          </div>
          <div class="form-group">
            <label class="form-label">Title — main line</label>
            <input class="form-input" id="sec-welcome-title-main" type="text" maxlength="60" placeholder="irb pick 'ems" value="${escHtml(settings.welcomeTitleMain||'')}" />
          </div>
          <div class="form-group">
            <label class="form-label">Welcome subtitle</label>
            <input class="form-input" id="sec-welcome-subtitle" type="text" maxlength="80" placeholder="enter access pin" value="${escHtml(settings.welcomeSubtitle||'')}" />
          </div>
          <button class="btn btn-primary btn-sm" id="sec-save-welcome-btn">💾 Save Welcome Text</button>

          <div class="divider"></div>
          <div class="card-title mb-sm">Commissioner Contact Email</div>
          <p class="text-muted text-xs mb-sm">Used by the Feedback form on the Rules tab and by the Weekly Summary helper. Leave blank to disable mailto-based features.</p>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-input" id="sec-comm-email" type="email" placeholder="commissioner@example.com" value="${escHtml(settings.commissionerEmail||'')}" />
          </div>
          <button class="btn btn-primary btn-sm" id="sec-save-comm-email-btn">💾 Save Email</button>
        </div>
      </div>`);

    // Data management
    sections.push(`
      <div class="admin-section" data-comm-tab="data">
        <div class="admin-section-title">⚙️ Data Management</div>
        <div class="card">
          <div class="form-group">
            <p class="text-muted text-xs mb-sm">Clears games, picks, and results for the selected week only.</p>
            <button class="btn btn-secondary btn-sm" id="reset-week-btn">🗑 Clear Current Week Data</button>
          </div>
          <div class="divider"></div>
          <div class="form-group">
            <p class="text-muted text-xs mb-sm">Full reset requires Commissioner password. Deletes ALL data.</p>
            <div class="flex gap-sm flex-wrap">
              <button class="btn btn-danger btn-sm" id="reset-demo-btn">⚠️ Full Factory Reset</button>
              <button class="btn btn-ghost btn-sm" id="logout-comm-btn">🚪 Logout Commissioner</button>
            </div>
          </div>
        </div>
      </div>`);

    // Chat retention (UN-88) — directly below Data Management, same tab (RG-10).
    sections.push(`
      <div class="admin-section" data-comm-tab="data">
        <div class="admin-section-title">🙈 Chat Retention</div>
        <div class="card">${renderChatRetentionAdmin()}</div>
      </div>`);

    // Chat epoch clear (UN-112, LAUNCH BLOCKER) — its own repeatable control,
    // same tab (RG-10), directly below retention. Separate from the Full
    // Factory Reset button above (which also wires this in) so a failed
    // clear has a retry path and testing chatter can be cleared again later
    // without re-wiping players/weeks.
    sections.push(`
      <div class="admin-section" data-comm-tab="data">
        <div class="admin-section-title">🧹 Chat History</div>
        <div class="card">${renderChatEpochAdmin()}</div>
      </div>`);

    c.innerHTML = sections.join('\n');
    // Tab visibility lives on the panel container as a data attribute so a
    // single CSS rule handles show/hide for all 18 sections at once.
    c.setAttribute('data-comm-active', state.commTab);
    c.querySelectorAll('.comm-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.commTab = btn.dataset.commTabBtn;
        // Don't re-render the whole panel — just flip the active flag and
        // re-flag the buttons. Cheaper and avoids losing form-field focus.
        c.setAttribute('data-comm-active', state.commTab);
        c.querySelectorAll('.comm-tab').forEach(b => {
          const active = b.dataset.commTabBtn === state.commTab;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active);
        });
        // UN-105a — the batch-grid-scroll (Demo Simulation, Week tab) was
        // display:none (0×0) if the panel opened on a different tab; a tab
        // switch doesn't rebuild the DOM, so re-measure now that it may have
        // just become visible.
        initScrollFades(c);
        // Scroll the panel to the top so users see the first section of the
        // new tab rather than a mid-scroll fragment.
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    wireCollapsibleSections(c);
    bindCommEventListeners(week, games, availGames, suggested, settings, allWeeks, shortlist);
    renderCommExtrasV16(week, games);   // v0.16.0 — Extra Point + Chat/SCRIBE admin
    initScrollFades(c);   // UN-105a — batch-grid-scroll wrapper (Demo Simulation)

  } catch(err) {
    console.error('[renderCommPage] crash:', err);
    c.innerHTML = `<div class="card" style="margin-top:20px">
      <h3 style="color:var(--loss)">⚠️ Commissioner Panel Error</h3>
      <p class="text-secondary text-sm mt-sm">${escHtml(err.message)}</p>
      <pre style="font-size:.75rem;margin-top:12px;overflow:auto">${escHtml(err.stack||'')}</pre>
      <button class="btn btn-ghost btn-sm mt-md" onclick="window.location.reload()">Reload App</button>
    </div>`;
  }
}


// ─── SLATE UI COMPONENTS ──────────────────────────────────────────────────────

function renderDemoBatchGrid(games) {
  if (!games.length) return '';
  const sorted = [...games].sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));
  const rows = sorted.map(g => {
    const hs = g.homeScore ?? '';
    const as_ = g.awayScore ?? '';
    const statusOpts = ['scheduled','live','final'].map(s =>
      `<option value="${s}"${g.status===s?' selected':''}>${s}</option>`).join('');
    return `<tr data-game-id="${g.gameId}">
      <td class="batch-matchup">${escHtml(matchup(g))}</td>
      <td><input class="form-input batch-home-score" type="number" min="0" inputmode="numeric" value="${hs}" placeholder="—" aria-label="Home score" /></td>
      <td><input class="form-input batch-away-score" type="number" min="0" inputmode="numeric" value="${as_}" placeholder="—" aria-label="Away score" /></td>
      <td><select class="form-select batch-status" aria-label="Status">${statusOpts}</select></td>
    </tr>`;
  }).join('');
  return `<div class="batch-grid-scroll">
    <table class="batch-grid">
      <thead><tr><th>Game</th><th>Home</th><th>Away</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/**
 * Renders one `.suggested-game-row`. `dismissable` distinguishes the primary
 * 10 (add-suggested-btn + reject-suggested-btn, unchanged) from the DI-4
 * shortlist (add-shortlist-btn only, NO dismiss control — these are
 * optional swap-ins, not primary suggestions the Commissioner needs to
 * actively reject). Both blocks reuse the same identity-based on-slate check
 * so a game already on the slate always shows "✓ On Slate" instead of a
 * button that would otherwise insert a duplicate slate row.
 */
function renderSuggestedGameRow(game, i, currentSlate, dismissable) {
  const onSlate = currentSlate.some(g => g.homeTeam===game.homeTeam&&g.awayTeam===game.awayTeam);
  const spreadStr = game.spread!==null ? fmtSpread(game.spread,game.favorite,game) : 'TBD';
  const sKey = suggestionKeyOf(game);
  return `<div class="suggested-game-row${onSlate?' on-slate':''}">
    <span class="suggested-num">${i+1}</span>
    <span class="suggested-matchup">${escHtml(matchup(game))}</span>
    <span class="suggested-spread text-muted text-xs">${spreadStr}</span>
    <span class="suggested-time text-muted text-xs">${fmtTime(game.kickoff,game)}</span>
    <div class="flex gap-sm flex-center">
      ${(game.suggestionReasons||[]).map(r=>`<span class="candidate-reason">${escHtml(r)}</span>`).join('')}
      ${onSlate
        ? `<span class="badge badge-open">✓ On Slate</span>`
        : `<button class="btn btn-primary btn-sm ${dismissable?'add-suggested-btn':'add-shortlist-btn'}" data-idx="${i}">+ Add</button>`}
      ${dismissable && !onSlate
        ? `<button class="btn btn-ghost btn-sm reject-suggested-btn" data-key="${escHtml(sKey)}" data-idx="${i}" title="Dismiss this suggestion">✕</button>`
        : ''}
    </div>
  </div>`;
}

export function renderSuggestedSlatePreview({suggested, shortlist, almaCount, morningAnchorFilled, closingAnchorFilled}, currentSlate, week) {
  if (!suggested.length) return '';

  // DI-6 — budget visibility, directly above the game list (placement is
  // specified as not optional; buried below the fold defeats the purpose).
  // TARGET_SLATE_SIZE is the product's fixed "10-game slate" decision — a UI
  // constant, unrelated to how many schools are in the (now commissioner-
  // configurable, incoming change) alma-mater list. almaCount can exceed it
  // once that list is edited past 10 entries; Drew's ruling is "ALL" is
  // absolute, so the slate is never truncated to force a round 10 — the
  // banner just has to say so legibly instead of reading "12 of 10".
  const TARGET_SLATE_SIZE = 10;
  const budgetBanner = almaCount >= 1
    ? (almaCount > TARGET_SLATE_SIZE
        ? `<div class="suggested-budget-banner">🔒 ${almaCount} alma mater games this week — slate expanded</div>`
        : `<div class="suggested-budget-banner">🔒 ${almaCount} of ${TARGET_SLATE_SIZE} slots reserved for alma mater games this week</div>`)
    : '';
  // An anchor with genuinely nothing to fill it (as opposed to already being
  // covered by a Tier-1 alma game) gets an explicit muted note rather than
  // silently having no game in that slot.
  const anchorNotes = [
    !morningAnchorFilled ? `<div class="text-muted text-xs suggested-anchor-note">No Saturday morning games this week — opening slot not filled automatically.</div>` : '',
    !closingAnchorFilled ? `<div class="text-muted text-xs suggested-anchor-note">No Saturday games this week — closing slot not filled automatically.</div>` : '',
  ].join('');

  return `<div class="suggested-slate-box">
    <div class="card-title mb-sm">⭐ Suggested 10-Game Slate <span class="text-muted text-xs">(✕ to dismiss a suggestion)</span></div>
    ${budgetBanner}${anchorNotes}
    ${suggested.map((game, i) => renderSuggestedGameRow(game, i, currentSlate, true)).join('')}
    ${(shortlist||[]).length ? `
    <div class="card-title mb-sm mt-md">📋 Next Best — tap + to swap in</div>
    ${shortlist.map((game, i) => renderSuggestedGameRow(game, i, currentSlate, false)).join('')}
    ` : ''}
  </div>`;
}

// ─── AVAILABLE GAMES — filtering + grouping ──────────────────────────────────
// Lets the Commissioner whittle a big ESPN-pulled list down by date, day,
// conference, region, ranking, alma-mater involvement, or free-text search,
// and group what's left into collapsible buckets.

// Conference → region (approximate; legacy + Power 5 + G5). Unknown conferences
// fall into "Other". This is good enough for "show me southern games".
const CONFERENCE_REGION = {
  'SEC':'South','ACC':'South','Sun Belt':'South','Conference USA':'South','American':'South',
  'Big 12':'Central','Big Ten':'Midwest','MAC':'Midwest',
  'Pac-12':'West','Mountain West':'West','Big Sky':'West','MWC':'West',
  'Ivy League':'Northeast','Patriot League':'Northeast','CAA':'Northeast',
};
function conferenceRegion(conf) {
  if (!conf) return 'Other';
  return CONFERENCE_REGION[conf] || 'Other';
}

function dayOfWeekOf(iso) {
  if (!iso) return 'Unknown date';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  } catch { return 'Unknown date'; }
}

function shortDateOf(iso) {
  if (!iso) return 'Date TBD';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  } catch { return 'Date TBD'; }
}

/**
 * Apply state.availFilter to a list of available games, returning a list of
 * { groupLabel, games[] } buckets (single bucket "All" when groupBy === 'none').
 */
export function filterAndGroupAvailableGames(availGames) {
  const f = state.availFilter;
  const search = (f.search || '').trim().toLowerCase();

  let list = availGames.filter(g => {
    // Conference (matches either side)
    if (f.conference && g.homeConference !== f.conference && g.awayConference !== f.conference) return false;
    // Rank
    if (f.rank === 'ranked'   && !g.homeRank && !g.awayRank) return false;
    if (f.rank === 'unranked' && (g.homeRank || g.awayRank)) return false;
    // Alma mater only
    if (f.almaOnly && !g.isAlmaMaterGame) return false;
    // DI-3 — same pattern as almaOnly, one more independent chip
    if (f.nationalTV && g.nationalTV !== true) return false;
    if (f.tightOnly && !(g.spread !== null && Math.abs(g.spread) <= 7)) return false;
    // Free-text search (school names, mascots, conferences)
    if (search) {
      const hay = [g.homeTeam, g.awayTeam, g.homeMascot, g.awayMascot, g.homeConference, g.awayConference]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Group
  const groups = new Map();
  const keyOf = (g) => {
    switch (f.groupBy) {
      case 'date':       return shortDateOf(g.kickoff);
      case 'day':        return dayOfWeekOf(g.kickoff);
      case 'conference': {
        // When the API didn't surface a conference, group those games together
        // under an honest label rather than the alarming "Unknown".
        const parts = [g.homeConference, g.awayConference].filter(Boolean);
        return parts.length ? parts.join(' / ') : 'Conference not listed';
      }
      case 'region':     return conferenceRegion(g.homeConference) || 'Other';
      case 'rank':       return (g.homeRank || g.awayRank) ? 'Ranked' : 'Unranked';
      default:           return 'All';
    }
  };
  for (const g of list) {
    const k = keyOf(g);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  // Stable sort within each group by kickoff
  for (const arr of groups.values()) {
    arr.sort((a,b) => new Date(a.kickoff||0) - new Date(b.kickoff||0));
  }
  // Sort groups: by date if grouping by date/day, else alpha with "Other"/"Unknown" last
  const entries = [...groups.entries()];
  if (f.groupBy === 'date') {
    entries.sort((a,b) => new Date(a[1][0]?.kickoff||0) - new Date(b[1][0]?.kickoff||0));
  } else {
    entries.sort((a,b) => {
      const aLast = /other|unknown/i.test(a[0]) ? 1 : 0;
      const bLast = /other|unknown/i.test(b[0]) ? 1 : 0;
      if (aLast !== bLast) return aLast - bLast;
      return a[0].localeCompare(b[0]);
    });
  }
  return { buckets: entries, total: list.length, totalUnfiltered: availGames.length };
}

export function renderAvailFilterBar(availGames) {
  const f = state.availFilter;
  // Build conference options from what's actually in the pool — sorted, deduped.
  const confs = [...new Set(
    availGames.flatMap(g => [g.homeConference, g.awayConference]).filter(Boolean)
  )].sort();

  return `<div class="avail-filter-bar">
    <div class="avail-filter-row">
      <input class="form-input avail-search" id="avail-search" type="search" placeholder="🔎 Search team, conference, mascot…" value="${escHtml(f.search)}" />
    </div>
    <div class="avail-filter-row">
      <label class="avail-filter-label">Group by
        <select class="form-select" id="avail-group">
          <option value="date"${f.groupBy==='date'?' selected':''}>Date</option>
          <option value="day"${f.groupBy==='day'?' selected':''}>Day of week</option>
          <option value="conference"${f.groupBy==='conference'?' selected':''}>Conference</option>
          <option value="region"${f.groupBy==='region'?' selected':''}>Region</option>
          <option value="rank"${f.groupBy==='rank'?' selected':''}>Ranking</option>
          <option value="none"${f.groupBy==='none'?' selected':''}>No grouping</option>
        </select>
      </label>
      <label class="avail-filter-label">Conference
        <select class="form-select" id="avail-conf">
          <option value="">Any</option>
          ${confs.map(c => `<option value="${escHtml(c)}"${f.conference===c?' selected':''}>${escHtml(c)}</option>`).join('')}
        </select>
      </label>
      <label class="avail-filter-label">Ranking
        <select class="form-select" id="avail-rank">
          <option value="any"${f.rank==='any'?' selected':''}>Any</option>
          <option value="ranked"${f.rank==='ranked'?' selected':''}>Ranked teams only</option>
          <option value="unranked"${f.rank==='unranked'?' selected':''}>Unranked only</option>
        </select>
      </label>
      <label class="avail-chip-label">
        <input type="checkbox" id="avail-alma-only" ${f.almaOnly?'checked':''} />
        ⭐ Alma mater games only
      </label>
      <label class="avail-chip-label">
        <input type="checkbox" id="avail-national-tv" ${f.nationalTV?'checked':''} />
        📺 On National TV
      </label>
      <label class="avail-chip-label">
        <input type="checkbox" id="avail-tight-only" ${f.tightOnly?'checked':''} />
        🎯 Tight matchups only (spread ≤ 7)
      </label>
      <button class="btn btn-ghost btn-sm" id="avail-reset-filters">Reset filters</button>
    </div>
  </div>`;
}

function renderAvailableGroups(availGames, currentSlate, week) {
  const { buckets, total, totalUnfiltered } = filterAndGroupAvailableGames(availGames);
  if (!buckets.length) {
    return `<div class="info-box">No games match the current filters. <button class="btn btn-ghost btn-sm" id="avail-reset-filters-inline">Reset filters</button></div>`;
  }
  const countLine = `<div class="text-muted text-xs mb-sm">Showing <strong>${total}</strong> of ${totalUnfiltered} games${total!==totalUnfiltered?' (filtered)':''}.</div>`;
  // When grouping is 'none' just render one flat list (skip the header chrome).
  if (state.availFilter.groupBy === 'none' && buckets.length === 1) {
    return countLine + renderAvailableGamesList(buckets[0][1], currentSlate, week);
  }
  return countLine + buckets.map(([label, games]) =>
    `<details class="avail-group" open>
      <summary class="avail-group-header"><span>${escHtml(label)}</span><span class="text-muted text-xs">${games.length} game${games.length>1?'s':''}</span></summary>
      <div class="avail-group-body">${renderAvailableGamesList(games, currentSlate, week)}</div>
    </details>`
  ).join('');
}

/**
 * (Re-)binds the +Add / ✕Remove buttons inside the available-games groups.
 * Called both on initial render and after any partial re-render triggered by
 * filter changes, so we don't lose handlers when innerHTML is replaced.
 */
function bindAvailGroupHandlers(week, currentSlate) {
  if (!week) return;
  document.querySelectorAll('.add-avail-game-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const data = JSON.parse(btn.dataset.game);
        saveGame(createGame(week.weekId, data));
        showToast(`✅ ${formatTeamName(data.homeTeam, data.homeMascot)} vs ${formatTeamName(data.awayTeam, data.awayMascot)} added`, 'success');
        renderCommPage();
      } catch (e) { showToast('❌ Error adding game', 'error'); }
    });
  });
  document.querySelectorAll('.avail-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const gid = btn.dataset.gameId;
      if (!gid) { showToast('Could not match slate game', 'error'); return; }
      const g = getGame(gid);
      const pickCount = countPicksForGame(gid);
      const label = g ? `${td(g,'home')} vs ${td(g,'away')}` : 'this game';
      let msg = `Remove ${label} from the slate?`;
      if (pickCount > 0) msg += `\n\n⚠️ ${pickCount} submitted pick${pickCount>1?'s':''} will be deleted.`;
      if (!confirm(msg)) return;
      deleteGame(gid);
      showToast('Removed from slate', 'warning'); renderCommPage();
    });
  });
}

export function renderAvailableGamesList(availGames, currentSlate, week) {
  return availGames.map(game => {
    const onSlate = currentSlate.some(g => g.espnEventId&&g.espnEventId===game.espnEventId || (g.homeTeam===game.homeTeam&&g.awayTeam===game.awayTeam));
    const spreadStr = game.spread!==null ? `${fmtSpread(game.spread,game.favorite,game)} ${game.spreadSource==='espn'?'(ESPN)':'(Manual)'}` : '⚠️ TBD';
    const payload = JSON.stringify({
      homeTeam:game.homeTeam, awayTeam:game.awayTeam,
      homeMascot:game.homeMascot||'', awayMascot:game.awayMascot||'',
      homeRank:game.homeRank, awayRank:game.awayRank,
      homeConference:game.homeConference, awayConference:game.awayConference,
      kickoff:game.kickoff, timeWindow:game.timeWindow,
      // Same DI-7 gap as nationalTV below: createGame() defaults these to
      // false/false, which is the "neither confirmed nor date-only" state that
      // renders as "Time TBD". Omit them and every game added from this list
      // shows Time TBD forever, however correct the parser is.
      kickoffConfirmed:game.kickoffConfirmed, kickoffDateOnly:game.kickoffDateOnly,
      spread:game.spread, favorite:game.favorite,
      spreadSource:game.spreadSource||null, oddsProvider:game.oddsProvider||null,
      espnEventId:game.espnEventId, isAlmaMaterGame:game.isAlmaMaterGame,
      // DI-7 — this hand-built payload does NOT spread the whole game object
      // (unlike "Apply Suggested 10" / "Add suggested individually", which
      // carry these fields free). Miss this and a game added from Available
      // Games silently loses its TV tag while the same game added from the
      // suggested card keeps it.
      nationalTV:game.nationalTV, broadcastNetwork:game.broadcastNetwork||null,
      homeScore:game.homeScore, awayScore:game.awayScore,
      status:game.status, actualWinner:game.actualWinner,
      dataQuality:game.dataQuality||'partial',
      dataSource:week?.dataSourceMode||'espn_historical',
      venue:game.venue||null, neutralSite:game.neutralSite||false,
      lastUpdated:new Date().toISOString(),
    });
    // If on slate, find the matching slate game so we can offer a one-click remove.
    const slateMatch = currentSlate.find(g => (g.espnEventId&&game.espnEventId&&g.espnEventId===game.espnEventId) || (g.homeTeam===game.homeTeam&&g.awayTeam===game.awayTeam));
    return `<div class="game-admin-card" style="${onSlate?'opacity:.65':''}">
      <div class="game-admin-header">
        <div class="game-admin-matchup">
          ${game.awayRank?`#${game.awayRank} `:''}${escHtml(td(game,'away'))}
          <span class="text-muted"> ${game.neutralSite?'vs':'@'} </span>
          ${game.homeRank?`#${game.homeRank} `:''}${escHtml(td(game,'home'))}${game.neutralSite?'':' <span class="home-badge">H</span>'}
          ${game.isAlmaMaterGame?'<span class="alma-mater-badge ml-sm">⭐</span>':''}
          ${game.nationalTV?`<span class="national-tv-badge ml-sm">📺 ${escHtml(game.broadcastNetwork||'')}</span>`:''}
        </div>
        ${onSlate
          ? `<div class="flex gap-sm flex-center">
               <span class="badge badge-open">✓ On Slate</span>
               <button class="btn btn-danger btn-sm avail-remove-btn" data-game-id="${slateMatch?slateMatch.gameId:''}" title="Remove from slate">✕ Remove</button>
             </div>`
          : `<button class="btn btn-primary btn-sm add-avail-game-btn" data-game='${payload.replace(/'/g,"&#39;")}'>+ Add</button>`}
      </div>
      <div class="game-admin-meta">
        <span>${fmtTime(game.kickoff, game)}</span>
        <span style="color:${game.spread!==null?'inherit':'var(--text-muted)'}">${spreadStr}</span>
        ${(() => { const loc = formatVenueDisplay(game); return loc ? `<span class="text-muted text-xs">📍 ${escHtml(loc)}${game.neutralSite?' 🌍':''}</span>` : ''; })()}
        ${game.espnEventId?`<code style="font-size:.65rem;color:var(--text-muted)">ESPN:${game.espnEventId}</code>`:''}
      </div>
    </div>`;
  }).join('');
}

export function renderAdminGamesList(games, week, overrides) {
  if (!games.length) return `<div class="info-box">No games on the slate. Fetch ESPN data and add games above, or add manually.</div>`;
  return games.sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff)).map(game => {
    const mu = overrides[game.gameId]==='unlocked';
    const sv = game.lockedSpread!==null?game.lockedSpread:game.spread;
    const spreadStr = sv!==null
      ? fmtSpread(sv,game.favorite,game)
      : (game.status===GAME_STATUS.FINAL ? 'Final' : 'TBD');
    const readiness = gameDataReadiness(game);
    const readyBanner = readiness.level==='ok' ? '' :
      `<div class="game-readiness game-readiness-${readiness.level}">
        ${readiness.level==='incomplete'?'⛔ Incomplete — hidden from players':'⚠️ Pending confirmation'}:
        ${readiness.issues.map(escHtml).join(' · ')}
      </div>`;
    return `<div class="game-admin-card${readiness.level!=='ok'?' game-admin-card-'+readiness.level:''}">
      ${readyBanner}
      <div class="game-admin-header">
        <div class="game-admin-matchup">
          ${game.awayRank?`#${game.awayRank} `:''}${escHtml(td(game,'away'))}
          <span class="text-muted"> ${game.neutralSite?'vs':'@'} </span>
          ${game.homeRank?`#${game.homeRank} `:''}${escHtml(td(game,'home'))}${game.neutralSite?'':' <span class="home-badge">H</span>'}
          ${game.isAlmaMaterGame?'<span class="alma-mater-badge">⭐</span>':''}
          ${game.nationalTV?`<span class="national-tv-badge">📺 ${escHtml(game.broadcastNetwork||'')}</span>`:''}
          ${renderSourceBadge(game)}
        </div>
        <div class="flex gap-sm">
          <button class="btn btn-ghost btn-sm edit-game-btn" data-game-id="${game.gameId}">Edit</button>
          <button class="btn btn-ghost btn-sm lock-toggle-btn" data-game-id="${game.gameId}" data-unlocked="${mu}">${mu?'🔒 Lock':'🔓 Unlock'}</button>
          <button class="btn btn-danger btn-sm remove-game-btn" data-game-id="${game.gameId}">✕</button>
        </div>
      </div>
      <div class="game-admin-meta">
        <span>${fmtTime(game.kickoff, game)}</span>
        <span>Spread: <strong style="color:${sv!==null?'inherit':'var(--text-muted)'}">${spreadStr}</strong>
          <em class="text-muted text-xs">${game.spreadSource==='espn'?'ESPN':'Manual'}</em></span>
        <span class="badge badge-${game.status}">${game.status}</span>
        ${game.status===GAME_STATUS.FINAL&&game.homeScore!==null?`<span>FINAL ${game.awayScore}–${game.homeScore}</span>`:''}
        ${game.espnEventId?`<code style="font-size:.65rem">ESPN:${game.espnEventId}</code>`:''}
        ${mu?'<span class="badge badge-open">🔓 Unlocked</span>':''}
      </div>
    </div>`;
  }).join('');
}

// ─── COLLAPSIBLE COMMISSIONER SECTIONS ───────────────────────────────────────
// Each .admin-section title becomes a click-to-collapse header; open/closed
// state persists in settings.commPanelSectionsCollapsed keyed by a stable slug
// derived from the title. A "Sections" menu pinned at top of the panel toggles
// visibility of any section (lets the commissioner hide noise entirely).

function sectionSlug(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function wireCollapsibleSections(container) {
  const sections = [...container.querySelectorAll('.admin-section')];
  if (!sections.length) return;
  const settings = getSettings();
  const collapsed = settings.commPanelSectionsCollapsed || {};
  const hidden    = settings.commPanelSectionsHidden    || {};

  // Build a compact "Sections" menu at the BOTTOM of the Commissioner panel
  // (secondary controls — primary workflow stays at the top). Collapsed by
  // default so it's out of the way until needed.
  if (!container.querySelector('.section-menu')) {
    const menuEl = document.createElement('div');
    menuEl.className = 'admin-section section-menu admin-section-collapsed';
    menuEl.dataset.section = '_section_menu';
    menuEl.dataset.sectionTitle = 'Sections';
    menuEl.innerHTML = `
      <div class="admin-section-title admin-section-title-toggle section-menu-title">📚 Sections
        <span class="section-menu-actions">
          <button class="btn btn-ghost btn-sm" id="sec-expand-all">Expand all</button>
          <button class="btn btn-ghost btn-sm" id="sec-collapse-all">Collapse all</button>
          <button class="btn btn-ghost btn-sm" id="sec-show-all">Show all</button>
        </span>
        <span class="section-chevron">▾</span>
      </div>
      <div class="section-menu-grid" id="section-menu-grid"></div>`;
    container.appendChild(menuEl);
    // Click the title (but not the buttons) to expand/collapse the menu itself
    menuEl.querySelector('.admin-section-title-toggle')?.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      menuEl.classList.toggle('admin-section-collapsed');
    });
  }

  // Wrap each section's body so we can collapse it without losing event bindings.
  sections.forEach((sec) => {
    if (sec.classList.contains('section-menu')) return;
    const titleEl = sec.querySelector('.admin-section-title');
    if (!titleEl) return;
    // Use textContent for the slug to avoid HTML/emoji noise variance.
    const title = titleEl.textContent.trim();
    const slug  = sectionSlug(title);
    sec.dataset.section = slug;
    sec.dataset.sectionTitle = title;

    // Hidden takes precedence — fully remove from view.
    if (hidden[slug]) { sec.style.display = 'none'; }

    // Collapse marker
    if (collapsed[slug]) sec.classList.add('admin-section-collapsed');
    titleEl.classList.add('admin-section-title-toggle');
    // A small chevron so it's obviously a toggle
    if (!titleEl.querySelector('.section-chevron')) {
      const chev = document.createElement('span');
      chev.className = 'section-chevron';
      chev.textContent = '▾';
      titleEl.appendChild(chev);
    }
    // Click anywhere on title to toggle collapse
    titleEl.addEventListener('click', (e) => {
      // Don't collapse when clicking the chevron-area buttons inside the menu
      if (e.target.closest('button')) return;
      sec.classList.toggle('admin-section-collapsed');
      const c = getSettings().commPanelSectionsCollapsed || {};
      c[slug] = sec.classList.contains('admin-section-collapsed');
      saveSetting('commPanelSectionsCollapsed', c);
    });
  });

  // Render the menu grid (show/hide checkboxes)
  const grid = container.querySelector('#section-menu-grid');
  if (grid) {
    grid.innerHTML = sections
      .filter(s => !s.classList.contains('section-menu'))
      .map(s => {
        const slug = s.dataset.section;
        const title = s.dataset.sectionTitle;
        const isHidden = !!hidden[slug];
        return `<label class="section-menu-item${isHidden?' is-hidden':''}">
          <input type="checkbox" class="section-toggle" data-slug="${escHtml(slug)}" ${isHidden?'':'checked'} />
          <span>${escHtml(title)}</span>
        </label>`;
      }).join('');
    grid.querySelectorAll('.section-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        const slug = cb.dataset.slug;
        const sec  = container.querySelector(`.admin-section[data-section="${slug}"]`);
        if (!sec) return;
        const h = getSettings().commPanelSectionsHidden || {};
        if (cb.checked) { sec.style.display = ''; delete h[slug]; }
        else            { sec.style.display = 'none'; h[slug] = true; }
        saveSetting('commPanelSectionsHidden', h);
        cb.parentElement.classList.toggle('is-hidden', !cb.checked);
      });
    });
  }

  // Expand / Collapse / Show-all shortcuts
  container.querySelector('#sec-expand-all')?.addEventListener('click', () => {
    sections.forEach(s => s.classList.remove('admin-section-collapsed'));
    saveSetting('commPanelSectionsCollapsed', {});
  });
  container.querySelector('#sec-collapse-all')?.addEventListener('click', () => {
    const c = {};
    sections.forEach(s => {
      if (s.classList.contains('section-menu')) return;
      s.classList.add('admin-section-collapsed');
      c[s.dataset.section] = true;
    });
    saveSetting('commPanelSectionsCollapsed', c);
  });
  container.querySelector('#sec-show-all')?.addEventListener('click', () => {
    sections.forEach(s => { s.style.display = ''; });
    saveSetting('commPanelSectionsHidden', {});
    grid?.querySelectorAll('.section-toggle').forEach(cb => { cb.checked = true; cb.parentElement.classList.remove('is-hidden'); });
  });
}

// ─── COMMISSIONER EVENT LISTENERS ─────────────────────────────────────────────

/* Exported for gradetest.mjs — the commissioner's score-entry handlers (the
   batch grid, "Set Final", "Finalize All", and the game modal's Save) are
   bound here and nowhere else, so this is the only seam from which they can be
   driven the way a browser drives them: bind, then fire the click. Same
   rationale as `finalizeWeek`'s export below. Binding is side-effect-free —
   it only attaches listeners — so importing this costs a test nothing. */
// `shortlist` is appended LAST, not inserted after `suggested`, and defaults
// to [] — gradetest.mjs and ranktest.mjs both call this with the pre-DI-4
// 6-arg shape; inserting a required positional param in the middle would
// silently misalign every arg after it in both files (settings ending up as
// allWeeks, allWeeks as undefined) without either file failing loudly.
export function bindCommEventListeners(week, games, availGames, suggested, settings, allWeeks, shortlist = []) {

  // Week manager
  document.getElementById('active-week-selector')?.addEventListener('change', e => {
    setActiveWeekId(e.target.value); refreshHeader(); renderCommPage();
  });
  document.getElementById('create-week-btn')?.addEventListener('click', ()=>showCreateWeekModal());
  // Groups A/B (2026-09-10, DI-B5) — Commissioner Announcement send control.
  // States: empty -> disabled; sending -> brief loading label; sent -> toast
  // + textarea clears (matches DI's exact states table).
  {
    const announceBody = document.getElementById('comm-announce-body');
    const announceBtn = document.getElementById('comm-announce-send-btn');
    announceBody?.addEventListener('input', () => {
      if (announceBtn) announceBtn.disabled = !announceBody.value.trim();
    });
    announceBtn?.addEventListener('click', () => {
      const text = (announceBody?.value || '').trim();
      if (!text) return;
      const original = announceBtn.textContent;
      announceBtn.disabled = true; announceBtn.textContent = 'Sending…';
      try {
        const sess = getSession();
        notifyCommissionerAnnouncement(text, sess?.playerId || null, getPlayers());
        renderNotifBell();
        showToast('✅ Announcement sent', 'success');
        if (announceBody) announceBody.value = '';
      } catch (e) {
        console.warn('[notifications] announcement send failed', e);
        showToast('Could not send announcement', 'error');
      } finally {
        announceBtn.textContent = original; announceBtn.disabled = true;
      }
    });
  }
  document.getElementById('duplicate-week-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    const newW={...week,weekId:`w_${Date.now()}`,weekNumber:week.weekNumber+1,
      label:`Week ${week.weekNumber+1}`,status:'draft',lockedAt:null,finalizedAt:null,
      actualTiebreakerValue:null,tiebreakerFinalized:false,blurb:'',recap:'',
      picksOpenAt:null,picksLockAt:null,
      // UN-118/UN-125 (DI-126b) — a duplicate is a NEW, unrelated week by
      // default. Without this, duplicating Part 1 to make a later, unrelated
      // week would silently inherit its group.
      groupId:null, isGroupTiebreaker:false,
      // DI-135 — a duplicate must not inherit the source's custom round
      // label or ESPN Week # override; those describe the SOURCE week's
      // display, not the new one's.
      roundLabel:'', espnWeekNumber:'',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    };
    saveWeek(newW); setActiveWeekId(newW.weekId);
    showToast(`✅ Week ${newW.weekNumber} created`,'success'); renderCommPage();
  });
  document.getElementById('delete-week-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    // UN-118/UN-125 (DI-126b) — deleting one part of a group does not delete
    // or ungroup the others; the confirm names them so the commissioner isn't
    // surprised later by a group that's missing a part.
    const otherGroupMembers = weeksInGroup(getWeeks(), week).filter(w=>w.weekId!==week.weekId);
    const groupNote = otherGroupMembers.length
      ? ` This week is grouped with ${otherGroupMembers.map(w=>formatWeekLabel(w)).join(', ')} as one competitive week — deleting it does not delete or ungroup them.`
      : '';
    if(!confirm(`Delete "${formatWeekLabel(week)}"?${groupNote}`))return;
    deleteWeek(week.weekId);
    const remaining=getWeeks();
    if(remaining.length)setActiveWeekId(remaining[0].weekId);
    showToast('Week deleted','warning'); refreshHeader(); renderCommPage();
  });

  // Week status buttons
  document.querySelectorAll('.week-status-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const to=btn.dataset.to; if(!week)return;
      // DI-E (2026-09-02) — the manual Finalize button (the only other path
      // that reaches 'final', alongside the auto pendingFinalization banner
      // above) had ZERO confirmation before this. Same native confirm()
      // pattern as remove-game-btn/clear-slate-btn, gated on the same
      // narrow tie condition as the auto banner. arePicksPublic(week) is
      // always true here in practice — 'final' is reachable only from
      // 'live' (renderWeekStatusButtons) — but made explicit (blind rule,
      // loadtest.mjs [64]) rather than left implicit, and it genuinely
      // short-circuits the getPicks() read below when it is not.
      if(to==='final' && arePicksPublic(week) && weekHasUnresolvedTie(week, getPlayers().filter(p=>p.active), getPicks(week.weekId), getGames(week.weekId))){
        if(!confirm("This week has a tie in correct picks and no tiebreaker value entered — the winner/loser will be assigned arbitrarily. Enter the tiebreaker first (Cancel), or finalize anyway and fix it later — entering the tiebreaker afterward recalculates automatically (OK)."))return;
      }
      const statusResult=applyWeekStatusChange(week,to);
      refreshHeader(); showToast(`Week: ${to}`,'success');
      // Item SS (runtime) — LOUD-FAIL: surface any games whose spread was
      // refused rather than frozen (sign contradicted the recorded
      // favorite). A second, separate toast so it can't be lost in/confused
      // with the ordinary "Week: locked" success toast above.
      if(statusResult?.spreadLockRefusals?.length){
        const names=statusResult.spreadLockRefusals.map(g=>`${g.awayTeam} @ ${g.homeTeam}`).join(', ');
        showToast(`⚠️ Spread NOT locked for ${statusResult.spreadLockRefusals.length} game${statusResult.spreadLockRefusals.length>1?'s':''} — sign contradicts recorded favorite: ${escHtml(names)}. Fix the spread/favorite in Games, then lock again.`,'error');
      }
      renderCommPage();
    });
  });

  // Week settings save
  document.getElementById('save-week-settings-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    const mode=document.getElementById('data-source-mode')?.value||week.dataSourceMode;
    const startDate=document.getElementById('week-start')?.value||'';
    const endDate=document.getElementById('week-end')?.value||'';
    const openRaw=document.getElementById('picks-open-at')?.value;
    const lockRaw=document.getElementById('picks-lock-at')?.value;
    const roundLabel=document.getElementById('week-round-label')?.value.trim()||'';
    const espnWeekNumber=document.getElementById('week-espn-num')?.value.trim()||'';
    const showInHistory=document.getElementById('week-show-history')?.checked!==false;
    // Auto-transition config
    const autoLockOffsetRaw = parseInt(document.getElementById('auto-lock-offset')?.value);
    const autoLockOffsetMinutes = Number.isFinite(autoLockOffsetRaw) && autoLockOffsetRaw >= 0 ? autoLockOffsetRaw : 30;
    const autoLiveEnabled = document.getElementById('auto-live-enabled')?.checked !== false;
    const autoFinalizeEnabled = document.getElementById('auto-final-enabled')?.checked !== false;

    // ── UN-118/UN-125 — multi-part week grouping (DI-126a/b) ────────────────
    const partnerId = document.getElementById('week-group-partner')?.value || '';
    const wantsTiebreaker = document.getElementById('week-group-tiebreaker')?.checked === true;
    let groupId = week.groupId || null;
    if (!partnerId) {
      // DI-126a — clearing one member's field removes only THAT member; any
      // other existing members stay grouped with each other, untouched.
      groupId = null;
    } else {
      const partnerWeek = getWeek(partnerId);
      if (!partnerWeek) {
        showToast('⚠️ Selected partner week no longer exists — grouping not saved.', 'error');
      } else {
        const partnerIsDemo = partnerWeek.dataSourceMode === 'demo';
        const currentIsDemo = mode === 'demo';
        if (partnerIsDemo !== currentIsDemo) {
          // Drew's ruling (DI-126d) — grouping a demo week with a real week
          // is rejected outright, not merged.
          showToast('⚠️ Cannot group a demo week with a real week — grouping not saved.', 'error');
        } else {
          // DI-126a canonicalization — the group's id is always an EXISTING
          // canonical id if the partner already has one (so joining a
          // 3rd+ member finds the true founder, not the immediate partner),
          // otherwise the partner's own weekId becomes the new founder.
          groupId = partnerWeek.groupId || partnerWeek.weekId;
        }
      }
    }
    const isGroupTiebreaker = !!groupId && wantsTiebreaker;

    const upd = {...week,dataSourceMode:mode,startDate,endDate,roundLabel,espnWeekNumber,showInHistory,
      picksOpenAt:openRaw?new Date(openRaw).toISOString():null,
      picksLockAt:lockRaw?new Date(lockRaw).toISOString():null,
      autoLockOffsetMinutes, autoLiveEnabled, autoFinalizeEnabled,
      groupId, isGroupTiebreaker,
    };
    saveWeek(upd);

    // Canonicalize + propagate to every OTHER current member of the
    // resulting group (DI-126a canonicalization; DI-126d — showInHistory and
    // dataSourceMode propagate to every member atomically). Runs whenever
    // this week is (still) grouped, not only at join time, so a LATER edit
    // to mode/showInHistory can't leave the group disagreeing with itself.
    if (groupId) {
      weeksInGroup(getWeeks(), upd)
        .filter(w => w.weekId !== upd.weekId)
        .forEach(w => {
          const wUpd = { ...w, groupId, dataSourceMode: mode, showInHistory };
          // Exactly one tiebreaker-of-record per group — this save flagging
          // THIS week un-flags every other current member.
          if (isGroupTiebreaker) wUpd.isGroupTiebreaker = false;
          saveWeek(wUpd);
        });
    }

    refreshHeader(); showToast('Week settings saved ✅','success'); renderCommPage();
  });

  // Pending-finalization prompt handlers (auto-transition ready → commissioner confirms)
  document.getElementById('confirm-finalize-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    const upd = { ...week, status: WEEK_STATUS.FINAL, finalizedAt: new Date().toISOString(), pendingFinalization: false };
    saveWeek(upd);
    // Hand finalizeWeek the PERSISTED week, not the pre-transition snapshot —
    // same invariant as applyWeekStatusChange(). The save already came first
    // here, so this path was never broken; passing `week` was a latent trap of
    // exactly the shape that cost the Week-tab button its Extra Point reveal.
    finalizeWeek(upd);
    refreshHeader();
    showToast('Week finalized — standings locked ✅','success');
    renderCommPage();
  });
  document.getElementById('dismiss-pending-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    saveWeek({ ...week, pendingFinalization: false });
    renderCommPage();
  });
  document.getElementById('save-blurb-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    saveWeek({...week,blurb:document.getElementById('blurb-input')?.value||''});
    showToast('Blurb saved','success');
  });

  // ESPN URL preview
  const getUrlParams = ()=>({
    dates: (week?.startDate||'').replace(/-/g,''),
    season: week?.season||new Date().getFullYear(),
  });
  const buildUrl = ()=>buildEspnUrl(getUrlParams());
  document.getElementById('preview-url-btn')?.addEventListener('click', ()=>{
    const el=document.getElementById('api-url-display'); if(el)el.textContent=buildUrl();
  });
  document.getElementById('copy-url-btn')?.addEventListener('click', ()=>{
    navigator.clipboard.writeText(buildUrl()).then(()=>showToast('URL copied!','success')).catch(()=>showToast('Copy failed','error'));
  });
  document.getElementById('open-url-btn')?.addEventListener('click', ()=>window.open(buildUrl(),'_blank'));

  // ESPN Fetch — uses week start/end date as the source of truth
  document.getElementById('fetch-espn-btn')?.addEventListener('click', async()=>{
    if(!week){showToast('Select a week first','error');return;}
    const startDate=week.startDate||document.getElementById('week-start')?.value||'';
    const endDate=week.endDate||document.getElementById('week-end')?.value||'';
    if(!startDate){showToast('Set a Start Date for the week first, then fetch','error');return;}
    const rangeLabel = endDate && endDate!==startDate ? `${startDate} to ${endDate}` : startDate;
    showToast(`⏳ Fetching ESPN games for ${rangeLabel}…`,'warning');
    // Pass season for context only — dates are source of truth
    const result=await fetchByDateRange({startDate,endDate:endDate||startDate,season:week.season,almaMaters:claimedAlmaMaters()});
    state.lastFetchResult=result;
    if(result.qualityReport)saveFetchProof(result.qualityReport);
    if(result.error||!result.games?.length){
      showToast(`❌ ${result.error||'No games for this date range'}. Adjust the date range or add games manually.`,'error');
      renderCommPage(); return;
    }
    // Clear old pool then save fresh results
    clearAvailableGames(week.weekId);
    saveAvailableGames(week.weekId, result.games);
    showToast(`✅ ${result.games.length} games for ${rangeLabel}. Review and add to slate.`,'success');
    renderCommPage();
  });

  // Load historical demo
  document.getElementById('load-hist-demo-btn')?.addEventListener('click', ()=>{
    const existing=getWeek(HISTORICAL_DEMO_WEEK.weekId);
    if(!existing){
      saveWeek(HISTORICAL_DEMO_WEEK);
      HISTORICAL_DEMO_GAMES.forEach(g=>saveGame(g));
      HISTORICAL_DEMO_GAMES.forEach(g=>setGameLockOverride(g.gameId,true));
    }
    setActiveWeekId(HISTORICAL_DEMO_WEEK.weekId);
    showToast('✅ Historical Demo Week loaded!','success');
    refreshHeader(); renderCommPage();
  });

  // Suggested slate — apply all 10 at once
  document.getElementById('apply-suggested-btn')?.addEventListener('click', ()=>{
    if(!week||!suggested.length)return;
    let added=0;
    for(const game of suggested){
      const alreadyOn=getGames(week.weekId).some(g=>g.homeTeam===game.homeTeam&&g.awayTeam===game.awayTeam);
      if(!alreadyOn){saveGame(createGame(week.weekId,{...game,weekId:week.weekId}));added++;}
    }
    showToast(`✅ ${added} suggested games added to slate`,'success'); renderCommPage();
  });

  // Add suggested game individually
  document.querySelectorAll('.add-suggested-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!week)return;
      const idx=parseInt(btn.dataset.idx);
      const game=suggested[idx]; if(!game)return;
      saveGame(createGame(week.weekId,{...game,weekId:week.weekId}));
      showToast(`✅ ${td(game,'home')} vs ${td(game,'away')} added`,'success'); renderCommPage();
    });
  });

  // DI-4 — shortlist "+ Add": identical add behaviour to add-suggested-btn,
  // sourced from `shortlist` instead of `suggested`. Adding does NOT remove
  // anything automatically — Drew bumps a game he's swapping out via the
  // existing ✕ Remove in the built slate; no new removal mechanism here.
  document.querySelectorAll('.add-shortlist-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!week)return;
      const idx=parseInt(btn.dataset.idx);
      const game=(shortlist||[])[idx]; if(!game)return;
      saveGame(createGame(week.weekId,{...game,weekId:week.weekId}));
      showToast(`✅ ${td(game,'home')} vs ${td(game,'away')} added`,'success'); renderCommPage();
    });
  });

  // Dismiss (reject) a suggested game so it stops reappearing
  document.querySelectorAll('.reject-suggested-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!week)return;
      const idx=parseInt(btn.dataset.idx);
      const game=suggested[idx]; if(!game)return;
      rejectSuggestion(week.weekId, game);
      showToast(`Suggestion dismissed — ${td(game,'home')} vs ${td(game,'away')}`,'warning'); renderCommPage();
    });
  });

  // Restore all dismissed suggestions for the week
  document.getElementById('restore-rejected-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    clearRejectedSuggestions(week.weekId);
    showToast('Dismissed suggestions restored','success'); renderCommPage();
  });

  // NOTE: bindAvailGroupHandlers(week, games) used to be called here AND
  // again below ("Wire add/remove buttons inside the initial render of the
  // groups") — an exact duplicate call with identical arguments and nothing
  // rendered in between. That double-bound every .add-avail-game-btn /
  // .avail-remove-btn element, so a single click fired its handler TWICE —
  // silently saving two duplicate slate entries per "+ Add" click from
  // Available Games. Pre-existing (present at 93e5f6c, before this batch),
  // found incidentally while verifying DI-7's add-path in slatetest.mjs
  // [11]. Removed here rather than left in, since it's a one-line duplicate
  // call directly in the code this batch already touches — flagged to
  // reviewer/design-matrix-pm as an incidental fix, not a DI-1..8 item.

  // Clear pool
  document.getElementById('clear-pool-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    clearAvailableGames(week.weekId);
    showToast('Available pool cleared','warning'); renderCommPage();
  });

  // ── Available-games filter bar (group/conf/rank/alma/search) ──
  // Re-renders only the groups container (not the whole panel) on each change
  // so the user keeps their focus / scroll position.
  const reRenderAvail = () => {
    const c = document.getElementById('avail-groups-list');
    if (c) c.innerHTML = renderAvailableGroups(getAvailableGames(week?.weekId||''), games, week);
    // Re-bind buttons inside the freshly rendered list
    bindAvailGroupHandlers(week, games);
  };
  document.getElementById('avail-group')?.addEventListener('change', e => {
    state.availFilter.groupBy = e.target.value; reRenderAvail();
  });
  document.getElementById('avail-conf')?.addEventListener('change', e => {
    state.availFilter.conference = e.target.value; reRenderAvail();
  });
  document.getElementById('avail-rank')?.addEventListener('change', e => {
    state.availFilter.rank = e.target.value; reRenderAvail();
  });
  document.getElementById('avail-alma-only')?.addEventListener('change', e => {
    state.availFilter.almaOnly = !!e.target.checked; reRenderAvail();
  });
  // DI-3 — same wiring pattern as avail-alma-only, mirrored not invented.
  document.getElementById('avail-national-tv')?.addEventListener('change', e => {
    state.availFilter.nationalTV = !!e.target.checked; reRenderAvail();
  });
  document.getElementById('avail-tight-only')?.addEventListener('change', e => {
    state.availFilter.tightOnly = !!e.target.checked; reRenderAvail();
  });
  // Debounce the search input — re-render after 200 ms of inactivity
  let searchTimer = null;
  const searchEl = document.getElementById('avail-search');
  searchEl?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    const val = e.target.value;
    searchTimer = setTimeout(() => {
      state.availFilter.search = val;
      reRenderAvail();
      // Restore focus + cursor position after the re-render
      const again = document.getElementById('avail-search');
      if (again) { again.focus(); again.setSelectionRange(val.length, val.length); }
    }, 200);
  });
  const resetFilters = () => {
    state.availFilter = { groupBy: 'date', conference: '', rank: 'any', almaOnly: false, nationalTV: false, tightOnly: false, search: '' };
    renderCommPage(); // full re-render to refresh the filter bar inputs
  };
  document.getElementById('avail-reset-filters')?.addEventListener('click', resetFilters);
  document.getElementById('avail-reset-filters-inline')?.addEventListener('click', resetFilters);
  // Wire add/remove buttons inside the initial render of the groups
  bindAvailGroupHandlers(week, games);

  // Slate controls
  document.getElementById('clear-slate-btn')?.addEventListener('click', ()=>{
    if(!week||!confirm('Remove all games from the slate? This does not affect picks already submitted.'))return;
    clearSlateForWeek(week.weekId);
    showToast('Slate cleared','warning'); renderCommPage();
  });
  document.getElementById('add-manual-game-btn')?.addEventListener('click', ()=>{
    if(week)showGameModal(null,week,data=>{saveGame(createGame(week.weekId,data));showToast('Game added','success');renderCommPage();});
  });
  document.getElementById('unlock-all-btn')?.addEventListener('click', ()=>{
    clearAllLockOverrides();
    getGames(week?.weekId).forEach(g=>setGameLockOverride(g.gameId,true));
    showToast('🔓 All games unlocked','warning'); renderCommPage();
  });
  document.getElementById('refresh-scores-btn')?.addEventListener('click', async()=>{
    if(!week)return;
    showToast('⏳ Refreshing scores…','warning');
    await doRefreshScores(week,getGames(week.weekId));
    showToast('✅ Scores updated','success'); renderCommPage();
  });
  document.getElementById('finalize-scoring-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    let count=0;
    getGames(week.weekId).forEach(g=>{
      if(g.status===GAME_STATUS.FINAL&&g.lockedSpread!==null){
        saveGame({...g,atsWinner:calculateAtsWinner(g)});count++;
      }
    });
    finalizeWeek(week);
    showToast(`✅ ATS calculated for ${count} games`,'success'); renderCommPage();
  });

  // ── Export bindings (expanded) ──
  document.getElementById('export-week-picks-csv-btn')?.addEventListener('click', ()=>exportWeekPicksCSV(week));
  document.getElementById('export-week-slate-csv-btn')?.addEventListener('click', ()=>exportWeekSlateCSV(week));
  document.getElementById('export-week-results-csv-btn')?.addEventListener('click', ()=>exportWeekResultsCSV(week));
  document.getElementById('export-week-dashboard-csv-btn')?.addEventListener('click', ()=>exportWeekDashboardCSV(week));
  document.getElementById('export-week-bundle-btn')?.addEventListener('click', ()=>exportWeekBundle(week));
  document.getElementById('export-players-csv-btn')?.addEventListener('click', exportPlayersCSV);
  document.getElementById('export-standings-csv-btn')?.addEventListener('click', exportStandingsCSV);
  document.getElementById('export-weekly-results-csv-btn')?.addEventListener('click', exportAllWeeklyResultsCSV);
  document.getElementById('export-obligations-csv-btn')?.addEventListener('click', exportObligationsCSV);
  document.getElementById('export-feedback-csv-btn')?.addEventListener('click', exportFeedbackCSV);

  // ── SCRIBE Trainer (Build 2b, E5b, 2026-09-10, UN-161…163) ──
  document.getElementById('scribe-run-trainer-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    // Reviewer SIGNIFICANT #8 — a Trainer run spends real money at Anthropic,
    // so it carries the same commissioner-password confirmation the other
    // consequential Data-tab actions do (the factory-reset flow above is the
    // precedent, same `btoa(pw)` comparison). The check is re-performed
    // SERVER-side against the stored hash; this local comparison only exists
    // to fail fast with a clear message instead of a round trip.
    const pw = prompt('Enter the Commissioner password to run the SCRIBE Trainer. This makes a paid model call.');
    if (!pw) return;
    const adminPasswordHash = btoa(pw);
    if (adminPasswordHash !== getSettings().adminPasswordHash) {
      showToast('❌ Incorrect password — Trainer run cancelled', 'error'); return;
    }
    btn.disabled = true; const original = btn.textContent; btn.textContent = 'Running…';
    try {
      const result = await runTrainerRemote({ adminPasswordHash });
      if (result && result.skipped) {
        // Not a failure — a deliberate no-op (kill switch off, hourly floor,
        // or too little rated feedback in the window to say anything).
        // 'warning' (not a new 'info' class) — styles.css defines exactly
        // success/error/warning; a skip is advisory, not a failure.
        showToast(`ℹ️ Trainer skipped: ${result.error || result.skipped}`, 'warning');
      } else if (result && result.ok) {
        await refreshFromBackend();   // server wrote directly through the seam — pull it into the mirror
        showToast('🧠 SCRIBE Training run complete', 'success');
      } else {
        showToast(`⚠️ Trainer run failed: ${result && result.error ? result.error : 'unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`⚠️ Trainer run failed: ${err && err.message ? err.message : err}`, 'error');
    } finally {
      btn.disabled = false; btn.textContent = original;
      renderCommPage();
    }
  });
  // Approve/reject — a plain status flip on the ONE flat array (learnings,
  // holding all three pending kinds) or the Canon array, through the
  // storage seam (CONVENTIONS #8) — no new backend action needed, this is
  // exactly what `set`/`setMany` already exist for.
  document.querySelectorAll('.scribe-approve-btn, .scribe-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = applyScribeLearningDecision(Number(btn.dataset.learningIdx), btn.classList.contains('scribe-approve-btn'));
      if (!r.ok) return;
      showToast(r.approved ? '✅ Approved' : '✖ Rejected', 'success');
      renderCommPage();
    });
  });
  document.querySelectorAll('.scribe-canon-approve-btn, .scribe-canon-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.canonIdx);
      const all = getScribeCanon();
      if (!all[idx]) return;
      all[idx] = { ...all[idx], approvalStatus: btn.classList.contains('scribe-canon-approve-btn') ? 'approved' : 'rejected' };
      setScribeCanon(all);
      showToast(btn.classList.contains('scribe-canon-approve-btn') ? '✅ Approved' : '✖ Rejected', 'success');
      renderCommPage();
    });
  });
  // Item 10 (DI-B1) — per-row exclude-from-export checkbox. Persists through
  // the storage seam on every toggle; the checkbox's own `checked` attribute
  // is already the on-screen reflection, so no re-render is needed here (same
  // no-rerender-needed shape as the obcorr-check bulk-select listeners above).
  document.querySelectorAll('.fb-excl-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.fbId;
      if (!id) return;
      setFeedbackExcluded(id, !cb.checked);
    });
  });
  document.getElementById('export-full-json-btn')?.addEventListener('click', exportFullBackupJSON);
  document.getElementById('export-full-csv-bundle-btn')?.addEventListener('click', exportFullCsvBundle);

  // DI-H (2026-09-02) — one-time (permanently available) retroactive
  // recompute. Loop over every already-final, non-demo week and re-run the
  // real finalizeWeek() — the exact same function DI-D calls, so a week that
  // finalized before its tiebreaker was entered self-corrects the same way.
  document.getElementById('recalc-all-weeks-btn')?.addEventListener('click', ()=>{
    if(!confirm("Recalculate every finalized week's results? This can change who's recorded as a week's winner or loser and may flag obligations for review below. Nothing is deleted — flagged records stay visible and correctable."))return;
    const finalWeeks=getWeeks().filter(w=>w.status==='final'&&w.dataSourceMode!=='demo');
    const changes=[];
    for(const w of finalWeeks){
      const before=getWeeklyResults(w.weekId);
      finalizeWeek(w);
      const after=getWeeklyResults(w.weekId);
      if(!weekOutcomeChanged(before,after))continue;
      const bw=before.find(r=>r.isWinner)?.displayName??'—', bl=before.find(r=>r.isLoser)?.displayName??'—';
      const aw=after.find(r=>r.isWinner)?.displayName??'—', al=after.find(r=>r.isLoser)?.displayName??'—';
      const parts=[];
      if(bw!==aw)parts.push(`winner changed from ${bw} to ${aw}`);
      if(bl!==al)parts.push(`loser changed from ${bl} to ${al}`);
      changes.push(`${formatWeekLabel(w)}: ${parts.join('; ')}.`);
    }
    state.recalcAllResult={changes};
    const n=finalWeeks.length;
    if(changes.length===0){
      showToast(`🔁 Recalculated ${n} week${n===1?'':'s'} — no changes.`,'success');
    } else {
      showToast(`🔁 Recalculated ${n} week${n===1?'':'s'} — ${changes.length} result${changes.length===1?'':'s'} changed.`,'warning');
    }
    renderCommPage();
  });

  // ── Demo simulation ──
  // RG — A destructive Demo-Simulation RESET must never touch a real week.
  // A misclick on "↩ Reset All Scheduled" while a real week was displayed wiped
  // every score and result off Week 1 in production (fb_1788048433261_z3aak,
  // v0.17.7). The score-ENTRY paths below (set live/final, update, finalize,
  // batch apply) are the commissioner's legitimate weekly workflow on real
  // weeks and are deliberately NOT gated — only the reset/wipe paths are. For a
  // real week the correct reset is the Data tab's "🗑 Clear Current Week Data",
  // which is confirmed, scoped, and intentional. Deny-by-default: any demo
  // reset handler must call this first, so a new one added later inherits the
  // guard rather than shipping another silent way to nuke real results.
  const demoResetAllowed = () => {
    if (week && week.dataSourceMode === 'demo') return true;
    showToast('🚫 Demo reset only works on a Demo week. This is a real week — to clear it use the Data tab → "🗑 Clear Current Week Data".', 'error');
    return false;
  };
  // The batch grid is BOTH the weekly score-entry workflow AND a place a row can
  // be reset — so unlike the pure reset buttons it can't be demo-only (a real
  // MANUAL week is hand-driven; resetting a row there is the commissioner's own
  // workflow — gradetest §1g). What must never happen is a batch-apply WIPING a
  // real ESPN-graded game: those weeks are fed from the live scoreboard, and the
  // correct reset for them is the Data tab's confirmed "🗑 Clear Current Week
  // Data", never the Demo Simulation grid. So the destructive path is refused
  // only on the FEED modes. A row is destructive when, against the game already
  // on file, it would demote a graded game back to scheduled or null a score /
  // winner / cover that currently exists. Entry (filling live/final WITH scores)
  // never trips this — it only writes values, never nulls one. `!= null` catches
  // both null and an absent key (a Sheet round-trip can drop either).
  const weekIsEspnFeed = () =>
    !!week && (week.dataSourceMode === 'espn_live' || week.dataSourceMode === 'espn_historical');
  const batchRowWipesData = (g, next) =>
    (next.status === 'scheduled' && g.status !== 'scheduled') ||
    (g.homeScore    != null && next.homeScore    == null) ||
    (g.awayScore    != null && next.awayScore    == null) ||
    (g.actualWinner != null && next.actualWinner == null) ||
    (g.atsWinner    != null && next.atsWinner    == null);
  const demoGameSel = document.getElementById('demo-game-select');
  const demoCtrls   = document.getElementById('demo-game-controls');
  demoGameSel?.addEventListener('change', ()=>{
    if(demoCtrls)demoCtrls.style.display=demoGameSel.value?'block':'none';
    const g=getGame(demoGameSel.value);
    if(g){
      const hl=document.getElementById('demo-home-label');
      const al=document.getElementById('demo-away-label');
      if(hl)hl.textContent=td(g,'home')+' Score';
      if(al)al.textContent=td(g,'away')+' Score';
      const hs=document.getElementById('demo-home-score');
      const as_=document.getElementById('demo-away-score');
      if(hs)hs.value=g.homeScore||0;
      if(as_)as_.value=g.awayScore||0;
    }
  });
  document.getElementById('demo-set-live')?.addEventListener('click',()=>{
    const gid=demoGameSel?.value; if(!gid)return;
    const g=getGame(gid); if(!g)return;
    const hs=parseInt(document.getElementById('demo-home-score')?.value)||0;
    const as_=parseInt(document.getElementById('demo-away-score')?.value)||0;
    // Mark as manual so the ESPN auto-refresh won't overwrite the simulated score.
    saveGame({...g,status:'live',homeScore:hs,awayScore:as_,dataSource:'manual',lastUpdated:new Date().toISOString()});
    showToast(`${td(g,'home')} vs ${td(g,'away')}: LIVE ${hs}–${as_}`,'success'); renderCommPage();
  });
  document.getElementById('demo-set-final')?.addEventListener('click',()=>{
    const gid=demoGameSel?.value; if(!gid)return;
    const g=getGame(gid); if(!g)return;
    const hs=parseInt(document.getElementById('demo-home-score')?.value)||0;
    const as_=parseInt(document.getElementById('demo-away-score')?.value)||0;
    let actualWinner=null;
    if(hs>as_)actualWinner=g.homeTeam;else if(as_>hs)actualWinner=g.awayTeam;
    // Build the game AS IT WILL BE SAVED, then let calculateAtsWinner() grade
    // that. The scores here came out of DOM inputs and aren't on `g` yet, which
    // is why the candidate is assembled first. Never re-derive the cover
    // locally: lockedSpread precedence, the undefined/blank/non-numeric cases,
    // non-final status, missing scores and pushes are all its job (AD-03).
    const next={...g,status:'final',homeScore:hs,awayScore:as_,actualWinner,
      dataSource:'manual',lastUpdated:new Date().toISOString()};
    next.atsWinner=calculateAtsWinner(next);
    saveGame(next);
    showToast(`FINAL: ${td(g,'home')} ${hs} – ${td(g,'away')} ${as_}`,'success'); renderCommPage();
  });
  document.getElementById('demo-set-scheduled')?.addEventListener('click',()=>{
    if(!demoResetAllowed())return;
    const gid=demoGameSel?.value; if(!gid)return;
    const g=getGame(gid); if(!g)return;
    saveGame({...g,status:'scheduled',homeScore:null,awayScore:null,actualWinner:null,atsWinner:null,dataSource:'manual'});
    showToast('Reset to scheduled','warning'); renderCommPage();
  });
  document.getElementById('demo-update-score')?.addEventListener('click',()=>{
    const gid=demoGameSel?.value; if(!gid)return;
    const g=getGame(gid); if(!g)return;
    const hs=parseInt(document.getElementById('demo-home-score')?.value)||0;
    const as_=parseInt(document.getElementById('demo-away-score')?.value)||0;
    saveGame({...g,homeScore:hs,awayScore:as_,dataSource:'manual',lastUpdated:new Date().toISOString()});
    showToast(`Score updated: ${hs}–${as_}`,'success');
  });
  document.getElementById('demo-finalize-all')?.addEventListener('click',()=>{
    if(!week)return;
    const wGames=getGames(week.weekId);
    let promoted = 0, atsComputed = 0, skipped = 0;
    wGames.forEach(g=>{
      // Promote anything that has scores but isn't final yet (live OR
      // scheduled-with-scores). A game without scores can't be finalized —
      // skip it and let the commissioner know.
      const hasScores = g.homeScore !== null && g.awayScore !== null;
      let next = { ...g };
      if (g.status !== 'final') {
        if (!hasScores) { skipped++; return; }
        next.status = 'final';
        // Compute straight-up winner from scores
        if (g.homeScore > g.awayScore)       next.actualWinner = g.homeTeam;
        else if (g.awayScore > g.homeScore)  next.actualWinner = g.awayTeam;
        else                                  next.actualWinner = null; // tie
        promoted++;
      }
      // Compute ATS from the promoted game, always. `calculateAtsWinner()`
      // returns null when nothing can decide the cover — no usable line, no
      // scores, not final — so this ALSO clears a stale answer on a game whose
      // spread was later removed, which the old local copy silently kept.
      next.atsWinner = calculateAtsWinner(next);
      if (next.atsWinner !== null) atsComputed++;
      next.dataSource = 'manual';
      next.lastUpdated = new Date().toISOString();
      saveGame(next);
    });
    finalizeWeek(week);
    const parts = [];
    if (promoted) parts.push(`${promoted} promoted to final`);
    if (atsComputed) parts.push(`${atsComputed} ATS computed`);
    if (skipped) parts.push(`${skipped} skipped (no scores)`);
    showToast(`✅ Week finalized — ${parts.join(' · ') || 'no changes needed'}`,'success');
    renderCommPage();
  });
  document.getElementById('demo-reset-all-scheduled')?.addEventListener('click',()=>{
    if(!demoResetAllowed())return;
    if(!week)return;
    getGames(week.weekId).forEach(g=>saveGame({...g,status:'scheduled',homeScore:null,awayScore:null,actualWinner:null,atsWinner:null}));
    showToast('All games reset to scheduled','warning'); renderCommPage();
  });

  // ── Batch grid: apply all rows at once ──
  document.getElementById('demo-batch-apply')?.addEventListener('click',()=>{
    if(!week)return;
    const rows=document.querySelectorAll('.batch-grid tbody tr');
    // Compute every row's would-be next state FIRST, so a destructive edit can
    // be caught before anything is persisted (Finding 1 / RG). Nothing is
    // written in this pass.
    const planned=[];
    rows.forEach(row=>{
      const gid=row.dataset.gameId;
      const g=getGame(gid); if(!g)return;
      const hsRaw=row.querySelector('.batch-home-score')?.value;
      const asRaw=row.querySelector('.batch-away-score')?.value;
      let status=row.querySelector('.batch-status')?.value||g.status;
      const hs=hsRaw!==''&&hsRaw!=null?parseInt(hsRaw):null;
      const as_=asRaw!==''&&asRaw!=null?parseInt(asRaw):null;

      // Earlier bug: if user filled in scores but left status='scheduled', the
      // scores were silently nulled by the status==='scheduled'?null:hs rule.
      // Now: if scores are present but status is still scheduled, auto-promote
      // to 'live'. The Commissioner explicitly choosing scheduled+blank scores
      // still correctly resets the game.
      if (status === 'scheduled' && (hs !== null || as_ !== null)) status = 'live';

      let actualWinner=null;
      if(status==='final'&&hs!==null&&as_!==null){
        if(hs>as_)actualWinner=g.homeTeam;else if(as_>hs)actualWinner=g.awayTeam;
      }
      // Assemble the row exactly as it will be stored — the scores were just
      // read out of the grid's inputs and aren't on `g` yet — then grade THAT
      // with the one shared implementation. calculateAtsWinner() already
      // returns null for a non-final status, so no `status==='final'?` wrapper
      // is needed and none should be added back (AD-03: one rule, one copy).
      const next={...g,
        status,
        homeScore: status==='scheduled'?null:hs,
        awayScore: status==='scheduled'?null:as_,
        actualWinner: status==='final'?actualWinner:null,
        dataSource:'manual',  // protect simulated state from ESPN auto-refresh
        lastUpdated:new Date().toISOString(),
      };
      next.atsWinner=calculateAtsWinner(next);
      planned.push({g,next});
    });
    // Deny-by-default on the feed modes: if ANY row would demote a graded game
    // or null a score/winner/cover that already exists on file, refuse the whole
    // apply and write nothing. Score ENTRY (live/final WITH scores) is never
    // destructive, so the normal weekly workflow is untouched. Demo and manual
    // weeks are hand-driven and keep the reset ability (gradetest §1g).
    if(weekIsEspnFeed() && planned.some(({g,next})=>batchRowWipesData(g,next))){
      showToast('🚫 That would wipe a real game\'s score or result on an ESPN week. Enter or correct scores here, but to clear a game use the Data tab → "🗑 Clear Current Week Data".','error');
      return;
    }
    let applied=0;
    planned.forEach(({next})=>{ saveGame(next); applied++; });
    showToast(`💾 Applied changes to ${applied} games`,'success'); renderCommPage();
  });

  // ── Batch grid: randomize plausible scores AND bump status to final ──
  // The whole point of randomize is to pressure-test the dashboard's live/final
  // states. If we left status as scheduled, the scores wouldn't visibly change
  // anything (the picks matrix only shows scores for live/final games), which
  // is exactly the "scores disappear" symptom the user reported.
  document.getElementById('demo-batch-randomize')?.addEventListener('click',()=>{
    // Randomize invents scores to pressure-test the dashboard's live/final
    // states — it has no legitimate purpose on a real week, so it is demo-only.
    // (On a real week it would only exist to overwrite real results.)
    if(!demoResetAllowed())return;
    const rows = document.querySelectorAll('.batch-grid tbody tr');
    rows.forEach(row=>{
      const rand=()=>Math.floor(Math.random()*42); // 0–41, realistic CFB range
      const h=row.querySelector('.batch-home-score');
      const a=row.querySelector('.batch-away-score');
      const s=row.querySelector('.batch-status');
      if(h) h.value=rand();
      if(a) a.value=rand();
      // Bump status to 'final' so the user sees decided wins/losses on Apply.
      // (They can pick 'live' or 'scheduled' afterwards if they want to test
      // those states.)
      if(s) s.value='final';
    });
    showToast('🎲 Randomized — set to FINAL. Click Apply to commit.','warning');
  });



  document.querySelectorAll('.lock-toggle-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const mu=btn.dataset.unlocked==='true';
      setGameLockOverride(btn.dataset.gameId,!mu);
      showToast(mu?'🔒 Locked':'🔓 Unlocked','success'); renderCommPage();
    });
  });
  document.querySelectorAll('.remove-game-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const gid=btn.dataset.gameId;
      const g=getGame(gid);
      const pickCount=countPicksForGame(gid);
      const label=g?`${td(g,'home')} vs ${td(g,'away')}`:'this game';
      let msg=`Remove ${label} from the slate?`;
      if(pickCount>0) msg+=`\n\n⚠️ ${pickCount} player pick${pickCount>1?'s have':' has'} already been submitted for this game. Removing it will permanently delete ${pickCount>1?'those picks':'that pick'} and they will no longer count toward scoring.`;
      if(!confirm(msg))return;
      deleteGame(gid); // cascades: deletes associated picks + lock override
      showToast(pickCount>0?`Removed — ${pickCount} pick${pickCount>1?'s':''} also deleted`:'Game removed','warning');
      renderCommPage();
    });
  });
  document.querySelectorAll('.edit-game-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const g=getGame(btn.dataset.gameId);
      if(g)showGameModal(g,null,data=>{saveGame({...g,...data,updatedAt:new Date().toISOString()});showToast('Updated','success');renderCommPage();});
    });
  });

  // Tiebreaker
  document.getElementById('save-tb-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    const q=document.getElementById('tb-question')?.value||'';
    const aRaw=document.getElementById('tb-actual')?.value;
    const actual=aRaw!==''&&aRaw!==undefined?parseFloat(aRaw):null;
    const upd={...week,tiebreakerQuestion:q,actualTiebreakerValue:actual,tiebreakerFinalized:actual!==null};
    saveWeek(upd);
    // DI-D (2026-09-02) — THE LOAD-BEARING INPUT. A tiebreaker entered or
    // edited AFTER the week already finalized must actually take effect
    // instead of freezing at whatever was true when the week finalized. Hand
    // finalizeWeek the PERSISTED object (`upd`, not the pre-save `week`) —
    // same invariant applyWeekStatusChange() already documents (~6758): the
    // caller's object and storage can no longer disagree once saveWeek() ran
    // first, so it no longer matters which of the two a downstream guard
    // reads. One call recomputes calculateWeeklyResults() with the fresh
    // actualTiebreakerValue and re-persists via saveAllWeeklyResults() —
    // fixing Season Summary, Weekly History, CSV, and any WEEKLY recap/
    // notification text at once, since they all read that one WEEKLY-RESULT
    // snapshot (getWeeklyResults(weekId)). NOTE what this does NOT, by
    // itself, guarantee: agreement with SCRIBE's/the mailto digest's
    // SEASON-LEVEL leader identity. recap.js and this file's own broadcast/
    // digest paths call calculateSeasonStandings() via its documented 2-arg
    // fallback (no `weeks`), which is grouping-UNaware and can name a
    // different season leader than the (grouping-aware) Standings page for a
    // multi-part week — a separate, deferred item, not something this
    // recompute touches. It also re-runs reconcileWeeklyObligation() (where
    // UN-126's needsReview fires on a mismatch), and re-emits chat events
    // (deterministic id, server deduped — no duplicate spam). If the week is
    // not final, behavior is unchanged from before this input.
    let msg='Tiebreaker saved ✅';
    if(upd.status===WEEK_STATUS.FINAL){
      const before=getWeeklyResults(upd.weekId);
      finalizeWeek(upd);
      const after=getWeeklyResults(upd.weekId);
      msg='🎯 Tiebreaker saved — week results recalculated ✅';
      if(weekOutcomeChanged(before,after)){
        msg+=' ⚠️ Recorded outcome changed — check Weekly History and Obligation Corrections.';
      }
    }
    showToast(msg,'success'); renderCommPage();
  });
  document.getElementById('auto-calc-tb-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    // Drew's ruling (2026-09-04): the auto-calc sums CLAIMED schools (an
    // active player has that alma mater) — same claimedAlmaMaters() list
    // every other alma-mater consumer in this file reads. See its docstring
    // above; there is no separate "configured roster" anymore.
    // F4 (2026-09-04) — for LOCKED/LIVE/FINAL weeks, almaMatersForAutoCalc()
    // substitutes the roster FROZEN at lock (week.lockedAlmaMaters) instead
    // of the live claimedAlmaMaters(), so a claim edit after lock can't
    // silently move this number. See its docstring for the fallback story
    // on a week locked before this shipped.
    const total=calculateAlmaMaterTotal(getGames(week.weekId),almaMatersForAutoCalc(week),week.tiebreakerCalculationMode||'selectedSlateOnly');
    if(total===null){showToast('⚠️ No final alma mater scores yet.','warning');return;}
    const inp=document.getElementById('tb-actual'); if(inp)inp.value=total;
    showToast(`Auto-calculated: ${total} pts`,'success');
  });

  // Nicknames
  document.querySelectorAll('.save-nick-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      setNickname(btn.dataset.weekId,btn.dataset.playerId,document.getElementById(`nick-${btn.dataset.playerId}`)?.value||'');
      showToast('Nickname saved','success');
    });
  });

  // Players + PIN management
  document.getElementById('admin-add-player-btn')?.addEventListener('click', ()=>{
    const n=document.getElementById('admin-new-player')?.value.trim();
    if(!n)return;
    if(getPlayers().find(p=>p.displayName.toLowerCase()===n.toLowerCase())){showToast('Already exists','warning');return;}
    addPlayer(createPlayer(n,'','0000'));
    document.getElementById('admin-new-player').value='';
    showToast(`${n} added`,'success'); renderCommPage();
  });
  document.querySelectorAll('.edit-player-btn').forEach(btn=>btn.addEventListener('click',()=>showEditPlayerModal(btn.dataset.playerId)));
  document.querySelectorAll('.toggle-player-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const p=getPlayer(btn.dataset.playerId); if(!p)return;
      savePlayer({...p,active:!p.active});
      // Activating/deactivating a player changes who counts toward
      // claimedAlmaMaters() (it filters to ACTIVE players only) — the same
      // ripple the player-edit save does, so a deactivated player's claimed
      // school stops driving the ⭐ flag on open/upcoming weeks immediately
      // rather than going stale until the next unrelated claim edit.
      const changed=recomputeAlmaMaterFlags(claimedAlmaMaters());
      showToast(`${p.displayName} ${p.active?'deactivated':'activated'}${changed?` — ${changed} game${changed===1?'':'s'} in open/upcoming weeks re-flagged`:''}`,'success');
      renderCommPage();
    });
  });
  document.querySelectorAll('.reset-pin-btn').forEach(btn=>{
    btn.addEventListener('click',()=>showResetPinModal(btn.dataset.playerId,btn.dataset.name));
  });

  // ── PIN show/hide toggle ──
  document.querySelectorAll('.pin-toggle-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const row = btn.closest('[data-player-row]');
      const input = row?.querySelector('.pin-input');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? '🙈' : '🙉';
    });
  });

  // ── Save email for a player ──
  document.querySelectorAll('.save-email-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const pid = btn.dataset.playerId;
      const row = btn.closest('[data-player-row]');
      const email = row?.querySelector('.email-input')?.value.trim() || '';
      // Light validation — empty is allowed (clears it), otherwise must look like an email.
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('That doesn\'t look like a valid email','error'); return;
      }
      const p = getPlayer(pid); if (!p) return;
      savePlayer({...p, email, updatedAt: new Date().toISOString()});
      showToast(`Email saved for ${p.displayName}`,'success');
      // Re-enable / update the share button without a full re-render
      const shareBtn = row.querySelector('.share-pin-btn');
      if (shareBtn) shareBtn.disabled = !email;
    });
  });

  // ── Share PIN via email (opens user's mail client — no server needed) ──
  document.querySelectorAll('.share-pin-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const pid = btn.dataset.playerId;
      const p = getPlayer(pid); if (!p) return;
      if (!p.email) { showToast('Save an email for this player first','error'); return; }
      const pin = getPlayerPin(pid);
      if (!pin) { showToast('No PIN set for this player — Reset PIN first','error'); return; }
      const siteUrl = window.location.origin + window.location.pathname;
      const subject = encodeURIComponent('Your CFB Pickems PIN');
      const body = encodeURIComponent(
        `Hi ${p.displayName},\n\n` +
        `Your CFB Pickems login PIN is: ${pin}\n\n` +
        `Site: ${siteUrl}\n` +
        `Site PIN (front gate): 6969\n\n` +
        `Pick your name from the player list, enter the PIN above, and you're in. ` +
        `Reply to this email if you need it reset.\n`
      );
      window.location.href = `mailto:${encodeURIComponent(p.email)}?subject=${subject}&body=${body}`;
    });
  });

  // ── Broadcast to all players with email on file ──
  document.getElementById('bcast-send-btn')?.addEventListener('click',()=>{
    const subject = (document.getElementById('bcast-subject')?.value || 'CFB Pickems update').trim();
    const body = (document.getElementById('bcast-body')?.value || '').trim();
    if (!body) { showToast('Write a message first','error'); return; }
    const recipients = getPlayers().filter(p=>p.active && p.email).map(p=>p.email);
    if (!recipients.length) { showToast('No players have an email on file','error'); return; }
    // BCC keeps everyone's address private. Some mail clients limit URL length,
    // so we warn rather than fail when the recipient list gets long.
    const siteUrl = window.location.origin + window.location.pathname;
    const fullBody = `${body}\n\n— Sent from CFB Pickems\n${siteUrl}`;
    const mailto = `mailto:?bcc=${encodeURIComponent(recipients.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
    if (mailto.length > 1800) {
      showToast(`⚠️ Long recipient list (${recipients.length}). If your mail client only opens a few, copy emails from the player list manually.`,'warning');
    }
    window.location.href = mailto;
    showToast(`✉ Opening mail client for ${recipients.length} recipient${recipients.length>1?'s':''}`,'success');
  });

  // Obligations (v0.17.0: manual add / delete / undo / 2K25 ledger / demo purge)
  document.getElementById('ob-add-btn')?.addEventListener('click',()=>{
    const payer=document.getElementById('ob-add-payer')?.value;
    const recip=document.getElementById('ob-add-recipient')?.value;
    const note=(document.getElementById('ob-add-note')?.value||'').trim();
    if(!payer||!recip||payer===recip){showToast('Pick two different players','error');return;}
    const ob=createObligation(null,payer,recip,note||'1 drink','manual');
    ob.note=note||'manual entry'; ob.weekLabel='manual';
    saveObligation(ob);
    try { notifyObligationCreated(ob); renderNotifBell(); } catch (e) { console.warn('[notifications] obligation-created hook failed', e); }
    showToast('✅ Obligation added','success'); renderCommPage();
  });
  document.querySelectorAll('.ob-delete-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!confirm('Delete this obligation from the ledger?'))return;
      saveAllObligations(getObligations().filter(o=>o.obligationId!==btn.dataset.obId));
      showToast('🗑 Obligation deleted','success'); renderCommPage();
    });
  });
  document.getElementById('ob-purge-demo')?.addEventListener('click',()=>{
    const demoIds=new Set(getWeeks().filter(w=>w.dataSourceMode==='demo').map(w=>w.weekId));
    saveAllObligations(getObligations().filter(o=>!demoIds.has(o.weekId)));
    showToast('🧹 Demo obligations purged','success'); renderCommPage();
  });
  // UN-89 debt-payment approval — one delegate per ledger shape, both driving
  // the SAME state-machine helpers the Standings page uses (obligationRole /
  // obligationNextStatus in data-model.js), so the comm panel and Standings
  // can never disagree about a transition.
  document.querySelectorAll('.ob-action-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      handleObligationAction(btn.dataset.obId, btn.dataset.obAction);
      renderCommPage();
    });
  });
  document.querySelectorAll('.ob2025-action-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      handleOb2025Action(btn.dataset.obId, btn.dataset.obAction);
      renderCommPage();
    });
  });

  // UN-126 (Part 2) — Obligation Corrections: merge / void, Data tab. The
  // merge button stays disabled until 2+ rows are checked; each checkbox
  // change recomputes the count in its own label so the commissioner always
  // sees exactly how many are selected before merging.
  {
    const mergeBtn = document.getElementById('obcorr-merge-btn');
    const checks = () => Array.from(document.querySelectorAll('.obcorr-check'));
    const refreshMergeBtn = () => {
      if (!mergeBtn) return;
      const n = checks().filter(c => c.checked).length;
      mergeBtn.textContent = `🔗 Merge Selected (${n})`;
      mergeBtn.disabled = n < 2;
    };
    checks().forEach(c => c.addEventListener('change', refreshMergeBtn));
    refreshMergeBtn();
    mergeBtn?.addEventListener('click', () => {
      const ids = checks().filter(c => c.checked).map(c => c.dataset.obId);
      showMergeObligationsModal(ids);
    });
    document.querySelectorAll('.obcorr-void-btn').forEach(btn => {
      btn.addEventListener('click', () => handleVoidObligation(btn.dataset.obId));
    });
  }

  // Chat retention (UN-88) — synced setting, OFF by default (CONVENTIONS #10).
  document.getElementById('chat-retention-toggle')?.addEventListener('change', e => {
    saveSetting('chatRetentionDays', e.target.checked ? 7 : 0);
    showToast(e.target.checked
      ? '🙈 Chat retention on — messages older than 7 days will stop showing'
      : 'Chat retention off — full history restored', 'success');
    renderCommPage();
  });

  // Chat epoch clear (UN-112, LAUNCH BLOCKER) — the repeatable Data-tab
  // control. LOUD-FAIL: startFreshChat() fetches the LIVE head and throws if
  // it can't — never writes a guessed/partial epoch. Apps Script cold starts
  // run 10-20s, so the button goes into a disabled loading state rather than
  // leaving the panel looking frozen.
  document.getElementById('chat-epoch-clear-btn')?.addEventListener('click', async e => {
    const btn = e.target;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Clearing… (may take up to 20s)';
    try {
      await startFreshChat();
      showToast('✅ Chat history cleared', 'success');
      renderCommPage();
    } catch {
      btn.disabled = false;
      btn.textContent = original;
      showToast('❌ Could not clear chat — check your connection and try again', 'error');
    }
  });

  // Auto-refresh
  document.getElementById('save-refresh-btn')?.addEventListener('click', ()=>{
    const val=parseInt(document.getElementById('auto-refresh-select')?.value||'60');
    saveSetting('autoRefreshInterval',val); setupAutoRefresh();
    showToast('Refresh interval saved','success');
  });

  // Alma Maters — no add/remove handlers here anymore. The roster is
  // derived (claimedAlmaMaters()); the Settings card above is read-only.
  // Editing/claiming happens on the player, in showEditPlayerModal — see
  // its #ep-save handler for the recomputeAlmaMaterFlags() ripple, and the
  // .toggle-player-btn handler above for the activate/deactivate ripple.

  // Randomize Picks shortcut (UN-107) — commissioner-controlled, default OFF.
  document.getElementById('randomize-enabled-toggle')?.addEventListener('change', e => {
    saveSetting('randomizePicksEnabled', e.target.checked);
    showToast(e.target.checked
      ? '🎲 Randomize shortcut enabled — players will see the button'
      : '🎲 Randomize shortcut disabled — players make every pick by hand', 'success');
    renderCommPage();
  });

  // Rules
  document.getElementById('save-rules-btn')?.addEventListener('click', ()=>{
    saveSetting('customRules',parseRulesText(document.getElementById('rules-editor')?.value||''));
    showToast('Rules saved','success');
  });
  document.getElementById('reset-rules-btn')?.addEventListener('click', ()=>{
    saveSetting('customRules',null);
    document.getElementById('rules-editor').value=getRulesEditorText(true);
    showToast('Rules reset','success');
  });

  // Danger zone
  document.getElementById('reset-week-btn')?.addEventListener('click', ()=>{
    if(!week)return;
    if(confirm(`Clear all games, picks, results, and tiebreaker data for "${formatWeekLabel(week)}" only? All other weeks and player data are preserved.`)){
      resetCurrentWeekData(week.weekId);
      showToast(`Week data cleared for ${formatWeekLabel(week)}`,'warning'); renderCommPage();
    }
  });
  document.getElementById('reset-demo-btn')?.addEventListener('click', async e => {
    // Require Commissioner to re-enter password for full reset
    // UN-112: the confirm copy used to claim this deletes ALL data — now that
    // chat is wired in below, that would be a lie (chat is HIDDEN, not
    // deleted, same as retention). Corrected in both prompts.
    const pw = prompt('Enter Commissioner password to confirm FULL factory reset. This deletes ALL data including all weeks and players, and hides all prior chat history (chat rows are hidden, not deleted — reversible from the Data tab):');
    if (!pw) return;
    if (btoa(pw) !== getSettings().adminPasswordHash) { showToast('❌ Incorrect password — reset cancelled','error'); return; }
    if(!confirm('FINAL WARNING: This will permanently delete ALL weeks, picks, players, results, and standings, and hides all prior chat history (chat rows are hidden, not deleted — reversible from the Data tab). Type OK to proceed.'))return;
    // v0.17.5 (caught in review): resetToDemo() writes DEFAULT_SETTINGS, which
    // resets chatEpochSeq to 0 — so if the awaited startFreshChat() below then
    // FAILS (Apps Script cold starts run 10-20s; a timeout here is a normal
    // condition, not an edge case), a previously-hidden test log becomes VISIBLE
    // AGAIN on all six phones. That is the exact opposite of what UN-112 exists
    // to do, at the moment Drew is most likely to be using it. Capture the epoch
    // first and restore it if the chat half fails.
    const _prevEpochSeq = getChatEpochSeq();
    const _prevEpochSetAt = getSettings().chatEpochSetAt ?? null;
    resetToDemo(); clearSession();
    // Wires the "⚠️ Full Factory Reset" button into the chat epoch clear
    // (DI-112a) — satisfies Drew's literal words ("I went to factory reset
    // everything, and it kept the historical chat"). Loud-fail on the chat
    // half must NOT be folded into the reset's success toast (DI-112a) — the
    // rest of the reset already succeeded by this point and that must not be
    // hidden by a chat-specific network hiccup.
    const btn = e.target;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Clearing chat… (may take up to 20s)';
    let chatCleared = true;
    try { await startFreshChat(); }
    catch {
      chatCleared = false;
      // Restore the prior epoch rather than leaving it at DEFAULT_SETTINGS' 0.
      // Failing to clear is recoverable; UN-hiding what was already hidden is not.
      if (_prevEpochSeq > 0) {
        saveSetting('chatEpochSeq', _prevEpochSeq);
        saveSetting('chatEpochSetAt', _prevEpochSetAt);
      }
    }
    btn.disabled = false;
    btn.textContent = original;
    showToast(chatCleared
      ? 'Full reset complete'
      : 'Full reset complete, but chat could not be cleared — check your connection and try again from the Data tab.', 'warning');
    renderCommPage(); refreshHeader();
  });
  document.getElementById('logout-comm-btn')?.addEventListener('click', ()=>{
    const s=getSession();setSession(s.playerId,false,s.playerVerified);renderCommPage();
  });

  // ── Security & Settings: change Commissioner password ──
  document.getElementById('sec-change-pw-btn')?.addEventListener('click', ()=>{
    const cur = document.getElementById('sec-pw-current')?.value || '';
    const next = document.getElementById('sec-pw-new')?.value || '';
    const confirm2 = document.getElementById('sec-pw-confirm')?.value || '';
    if (!cur || !next || !confirm2) { showToast('Fill in all three password fields','error'); return; }
    if (btoa(cur) !== getSettings().adminPasswordHash) { showToast('Current password is wrong','error'); return; }
    if (next.length < 6) { showToast('New password must be at least 6 characters','error'); return; }
    if (next !== confirm2) { showToast('New passwords don\'t match — re-type both','error'); return; }
    if (next === cur) { showToast('New password matches the old one','error'); return; }
    if (!confirm('Change the Commissioner password? You\'ll stay logged in on this device, but need the new password next time.')) return;
    saveSetting('adminPasswordHash', btoa(next));
    showToast('🔑 Password changed','success');
    renderCommPage();
  });

  // ── Security & Settings: change site PIN ──
  document.getElementById('sec-change-site-pin-btn')?.addEventListener('click', ()=>{
    const next = (document.getElementById('sec-site-pin-new')?.value || '').trim();
    const confirm2 = (document.getElementById('sec-site-pin-confirm')?.value || '').trim();
    if (!next || !confirm2) { showToast('Enter and confirm the new site PIN','error'); return; }
    if (next.length < 4) { showToast('Site PIN must be at least 4 characters','error'); return; }
    if (next !== confirm2) { showToast('PINs don\'t match — re-type both','error'); return; }
    if (next === getEffectiveSitePin()) { showToast('That\'s already the current site PIN','warning'); return; }
    if (!confirm(`Change the site PIN to "${next}"? Players will need this PIN on their next visit. (Already-unlocked devices stay unlocked.)`)) return;
    setSitePin(next);
    showToast('🚪 Site PIN updated','success');
    renderCommPage();
  });

  // ── Security & Settings: save Welcome Screen text ──
  document.getElementById('sec-save-welcome-btn')?.addEventListener('click', ()=>{
    const top = (document.getElementById('sec-welcome-title-top')?.value || '').trim();
    const main = (document.getElementById('sec-welcome-title-main')?.value || '').trim();
    const sub = (document.getElementById('sec-welcome-subtitle')?.value || '').trim();
    saveSetting('welcomeTitleTop', top);
    saveSetting('welcomeTitleMain', main);
    saveSetting('welcomeSubtitle', sub);
    showToast('Welcome text saved','success');
  });

  // ── Security & Settings: save Commissioner contact email ──
  document.getElementById('sec-save-comm-email-btn')?.addEventListener('click', ()=>{
    const email = (document.getElementById('sec-comm-email')?.value || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('That doesn\'t look like a valid email','error'); return;
    }
    saveSetting('commissionerEmail', email);
    showToast(email ? 'Commissioner email saved' : 'Commissioner email cleared', 'success');
  });

  // ── Cloud Sync (backend) handlers ──
  document.getElementById('be-test-btn')?.addEventListener('click', async ()=>{
    const url=document.getElementById('be-url')?.value.trim();
    const token=document.getElementById('be-token')?.value.trim();
    if(!url){showToast('Enter the Web App URL first','error');return;}
    setBackendConfig(url, token);
    showToast('⏳ Testing…','warning');
    const r=await pingBackend();
    showToast(r.ok?`✅ Reached backend (${r.service||'ok'})`:`❌ ${r.error||'No response'}`, r.ok?'success':'error');
  });

  document.getElementById('be-save-btn')?.addEventListener('click', async ()=>{
    const url=document.getElementById('be-url')?.value.trim();
    const token=document.getElementById('be-token')?.value.trim();
    if(!url||!token){showToast('URL and token are both required','error');return;}
    setBackendConfig(url, token);
    showToast('⏳ Connecting…','warning');
    try{
      await hydrateBackend();
      setBackendMode('googleSheets');
      ensureSeedData();
      showToast('✅ Connected — this device now uses shared data','success');
      refreshHeader(); renderCommPage();
    }catch(err){
      showToast(`❌ Connect failed: ${err.message||err}`,'error');
    }
  });

  document.getElementById('be-disconnect-btn')?.addEventListener('click', ()=>{
    if(!confirm('Disconnect from the shared Sheet and use this device only? Local data remains; shared data is untouched.'))return;
    setBackendMode('local');
    clearBackendConfig();
    initStorage();
    showToast('Disconnected — using local data','warning');
    refreshHeader(); renderCommPage();
  });

  document.getElementById('be-seed-btn')?.addEventListener('click', async ()=>{
    if(!isBackendConfigured()){showToast('Save & connect first','error');return;}
    if(!confirm('Push THIS device\'s data up to seed the Sheet? Existing keys on the Sheet are kept (not overwritten).'))return;
    showToast('⏳ Seeding…','warning');
    try{
      const snapshot=exportAllDataRaw();
      const n=await seedFromLocal(snapshot,false);
      showToast(`✅ Seeded ${n} data keys to the Sheet`,'success');
    }catch(err){showToast(`❌ ${err.message||err}`,'error');}
  });

  document.getElementById('be-pull-btn')?.addEventListener('click', async ()=>{
    if(!isBackendConfigured()){showToast('Save & connect first','error');return;}
    showToast('⏳ Pulling…','warning');
    try{
      await refreshFromBackend();
      setBackendMode('googleSheets');
      showToast('✅ Pulled shared data to this device','success');
      refreshHeader(); renderCommPage();
    }catch(err){showToast(`❌ ${err.message||err}`,'error');}
  });

  // Flush any debounced pending writes to the Sheet immediately. Useful when
  // the user is about to close the tab and wants the most recent edits to land.
  document.getElementById('be-flush-now-btn')?.addEventListener('click', async ()=>{
    showToast('⏳ Flushing pending writes…','warning');
    try {
      const r = await flushPush();
      showToast(r.pushed ? `✅ Pushed ${r.pushed} pending writes` : '✅ Nothing pending — already synced','success');
      renderCommPage();
    } catch(err){ showToast(`❌ Flush failed: ${err.message||err}`,'error'); }
  });
  // Same as the existing be-pull-btn but available inside the status panel for proximity.
  document.getElementById('be-pull-now-btn')?.addEventListener('click', async ()=>{
    showToast('⏳ Pulling latest…','warning');
    try {
      await refreshFromBackend();
      showToast('✅ Pulled latest from Sheet','success');
      renderCommPage();
    } catch(err){ showToast(`❌ Pull failed: ${err.message||err}`,'error'); }
  });

  document.getElementById('be-snapshot-btn')?.addEventListener('click', async ()=>{
    if(!isBackendConfigured()){showToast('Save & connect first','error');return;}
    const label=prompt('Snapshot label (optional, e.g. "End of Week 5"):')||'';
    showToast('⏳ Creating snapshot…','warning');
    try{ const r=await createSnapshot(label); showToast(`📸 Snapshot saved (${r.id})`,'success'); }
    catch(err){showToast(`❌ ${err.message||err}`,'error');}
  });

  document.getElementById('be-list-snapshots-btn')?.addEventListener('click', async ()=>{
    if(!isBackendConfigured()){showToast('Save & connect first','error');return;}
    const el=document.getElementById('be-snapshots-list'); if(el)el.innerHTML='Loading…';
    try{
      const snaps=await listSnapshots();
      if(!el)return;
      if(!snaps.length){el.innerHTML='No snapshots yet.';return;}
      el.innerHTML=snaps.map(s=>`<div class="flex-between" style="padding:4px 0;border-bottom:1px solid var(--border)">
        <span>${escHtml(s.label||'(no label)')} · <span class="text-muted">${new Date(s.createdAt).toLocaleString()}</span></span>
        <button class="btn btn-ghost btn-sm be-restore-snap" data-id="${escHtml(s.id)}">Restore</button>
      </div>`).join('');
      el.querySelectorAll('.be-restore-snap').forEach(b=>b.addEventListener('click', async ()=>{
        if(!confirm('Restore this snapshot? Current shared data is backed up first, then overwritten.'))return;
        showToast('⏳ Restoring…','warning');
        try{ await restoreSnapshot(b.dataset.id); showToast('✅ Restored','success'); refreshHeader(); renderCommPage(); }
        catch(err){showToast(`❌ ${err.message||err}`,'error');}
      }));
    }catch(err){ if(el)el.innerHTML=`Error: ${escHtml(String(err.message||err))}`; }
  });

  // ── Priority 14: Weekly Summary email (preview + send via mail client) ──
  document.getElementById('weekly-summary-preview-btn')?.addEventListener('click', () => {
    const el = document.getElementById('weekly-summary-preview');
    if (!el) return;
    if (el.style.display === 'none') {
      const text = buildWeeklySummary(week);
      el.textContent = text;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  });
  document.getElementById('weekly-summary-send-btn')?.addEventListener('click', () => {
    const recipients = getPlayers().filter(p => p.active && p.email).map(p => p.email);
    if (!recipients.length) { showToast('No player has an email on file','error'); return; }
    const body = buildWeeklySummary(week);
    const subject = `CFB Pickems — ${formatWeekLabel(week)} recap`;
    const siteUrl = window.location.origin + window.location.pathname;
    const fullBody = `${body}\n\n— Sent from CFB Pickems\n${siteUrl}`;
    const mailto = `mailto:?bcc=${encodeURIComponent(recipients.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
    if (mailto.length > 1800) {
      showToast(`⚠️ Long recipient list (${recipients.length}). If your mail client only opens a few, copy emails manually.`,'warning');
    }
    window.location.href = mailto;
    showToast(`✉ Opening mail client for ${recipients.length} recipient${recipients.length>1?'s':''}`,'success');
  });
}

/**
 * Priority 14: build a plain-text weekly recap suitable for an email body.
 *
 * Sections:
 *   1. Final picks table (one line per player: W–L record + tiebreaker)
 *   2. Weekly winner (notes if won by tiebreaker)
 *   3. Weekly loser (the "obligation owner")
 *   4. Season standings to date (top to bottom by total wins)
 *
 * Plain text only — mailto: URLs and many mail clients mangle HTML. Easy to
 * read in any mail client and easy to copy/paste anywhere else.
 *
 * Exported for loadtest.mjs — same precedent as buildObligationsCsvRows /
 * buildFeedbackCsvRows: the digest body is asserted on as RENDERED TEXT, not
 * by pattern-matching this function's source (RG-12's lesson). Pure apart
 * from the storage reads below; no DOM, no mailto side effect (the caller
 * owns that).
 */
export function buildWeeklySummary(week) {
  if (!week) return '';
  const players = getPlayers().filter(p => p.active);
  const picks = getPicks(week.weekId);
  const games = getGames(week.weekId);
  const actualTB = week.actualTiebreakerValue ?? null;
  const results = calculateWeeklyResults(week.weekId, players, picks, games, actualTB);

  const lines = [];
  lines.push(`📊 ${formatWeekLabel(week)} — Recap`);
  lines.push('');
  lines.push('━━━ Final picks ━━━');
  results.forEach(r => {
    const name = players.find(p => p.playerId === r.playerId)?.displayName || '(unknown)';
    const w = r.correctPicks, l = r.incorrectPicks;
    const tb = r.tiebreakerGuess !== null && r.tiebreakerGuess !== undefined
      ? (actualTB !== null ? `TB ${r.tiebreakerGuess} (Δ${r.tiebreakerDelta})` : `TB ${r.tiebreakerGuess}`)
      : 'TB —';
    const marker = r.isWinner ? ' 🏆' : r.isLoser ? ' 💀' : '';
    lines.push(`  ${String(r.rank).padStart(2)}. ${name.padEnd(18)} ${w}–${l}  ${tb}${marker}`);
  });
  lines.push('');

  const winner = results.find(r => r.isWinner);
  const loser  = results.find(r => r.isLoser);
  if (winner) {
    const wName = players.find(p => p.playerId === winner.playerId)?.displayName || '(unknown)';
    lines.push(`🏆 Weekly winner: ${wName}${winner.wonByTiebreaker ? ' (won by tiebreaker)' : ''}`);
  }
  if (loser) {
    const lName = players.find(p => p.playerId === loser.playerId)?.displayName || '(unknown)';
    lines.push(`💀 Weekly loser: ${lName}`);
  }

  // Obligations for this week, if any are configured.
  //
  // ACTIVE only. A voided record — or one merged away into another — is not a
  // live debt, and this text goes to the whole league; storage.js's own note on
  // getActiveObligations() calls it "the read every 'what does someone actually
  // owe' surface should use". The raw getObligations() stays the audit read
  // (CSV export, Data-tab corrections tool), not the email.
  //
  // Field names mirror renderObligationsAdmin()'s on-screen ledger exactly —
  // payerPlayerId owes recipientPlayerId, `note` (manual entries) falling back
  // to `amountOrPrize` — so the email and the app can never name a different
  // person or a different prize for the same record.
  //
  // Names resolve against ALL players, not the active-only `players` above: an
  // obligation outlives a player leaving the league, and a departed payer must
  // still be named, not rendered as "(unknown)".
  const obligations = getActiveObligations(week.weekId);
  if (obligations.length) {
    const allPlayers = getPlayers();
    lines.push('');
    lines.push('━━━ Obligations ━━━');
    obligations.forEach(o => {
      const payer = allPlayers.find(p => p.playerId === o.payerPlayerId)?.displayName || '(unknown)';
      const recip = allPlayers.find(p => p.playerId === o.recipientPlayerId)?.displayName || '(unknown)';
      const what = o.note || o.amountOrPrize || '';
      lines.push(`  ${payer} owes ${recip}${what ? `: ${what}` : ''}${o.status ? ` [${o.status}]` : ''}`);
    });
  }

  // Season standings to date
  // UN-118/UN-125 — DELIBERATELY NOT widened for grouping. Drew's explicit
  // scope ruling held the mailto digest rewrite (this function) until real
  // split-week data exists to test against; the 2-arg call is the documented
  // fail-safe fallback (scoring.js), so this mailto digest will keep showing
  // a split week as two separate weekly wins/losses until that follow-up
  // ships. See DEVELOPMENT_LEDGER.md §6.
  const allResults = getWeeklyResults();
  const standings = calculateSeasonStandings(players, allResults);
  if (standings.length) {
    lines.push('');
    lines.push('━━━ Season standings ━━━');
    standings.forEach(s => {
      const pName = players.find(p => p.playerId === s.playerId)?.displayName || '(unknown)';
      lines.push(`  ${String(s.currentRank).padStart(2)}. ${pName.padEnd(18)} ${s.totalCorrect}–${s.totalIncorrect}  (${s.weeklyWins}W / ${s.weeklyLosses}L)`);
    });
  }

  return lines.join('\n');
}

// ─── DATA PROOF PANEL ─────────────────────────────────────────────────────────

function renderDataProofPanel(proof, ps, week, games) {
  const mode=week?.dataSourceMode||'—';
  const slateGames=games||[];

  const espnIds=slateGames.filter(g=>g.espnEventId).map(g=>g.espnEventId);
  const fetchMethod=ps.lastFetchMethod==='direct'?'✅ Direct (no proxy)':ps.lastFetchMethod?`⚠️ Via proxy: ${ps.lastFetchMethod}`:'—';

  return `<div class="proof-grid">
    <div class="proof-item"><span class="proof-label">Data Mode</span>
      <span class="proof-value"><span class="source-mode-badge mode-${mode}">${sourceModeLabelOf(mode)}</span></span></div>
    <div class="proof-item"><span class="proof-label">Fetch Method</span>
      <span class="proof-value">${fetchMethod}</span></div>
    <div class="proof-item"><span class="proof-label">ESPN URL</span>
      <code class="proof-code">${escHtml(ps.lastFetchUrl||'(not fetched yet)')}</code></div>
    <div class="proof-item"><span class="proof-label">Last Fetch</span>
      <span class="proof-value">${ps.lastFetchTimestamp?new Date(ps.lastFetchTimestamp).toLocaleString():'—'}</span></div>
    <div class="proof-item"><span class="proof-label">Raw ESPN Events</span>
      <span class="proof-value ${ps.lastRawEventCount>0?'proof-good':ps.lastFetchTimestamp?'proof-bad':''}">${ps.lastRawEventCount||'—'}</span></div>
    <div class="proof-item"><span class="proof-label">Data Quality</span>
      <span class="proof-value">${escHtml(ps.lastQualityReport?.dqStatus||'—')}</span></div>
  </div>
  ${ps.lastRawEvents?.length?`<div class="mt-sm"><div class="proof-label mb-sm">Last ${ps.lastRawEvents.length} ESPN events:</div>
    <ol class="proof-list">${ps.lastRawEvents.map(e=>`<li>${escHtml(e)}</li>`).join('')}</ol></div>`:''}
  ${espnIds.length?`<div class="proof-label mt-sm mb-sm">ESPN IDs on slate:</div>
    <div class="proof-ids">${espnIds.map(id=>`<code class="id-chip">${id}</code>`).join(' ')}</div>`:''}
  ${ps.lastScoreRefresh?`<div class="proof-label mt-sm">Last score refresh: <span class="proof-value">${new Date(ps.lastScoreRefresh).toLocaleString()}</span></div>`:''}`;
}

/**
 * The commissioner panel's "Submitted guesses" block on the Tiebreaker card,
 * Week tab (RG-10).
 *
 * WHY THIS IS EXPORTED: it is the test seam for the blind rule on this surface,
 * the same reason `renderCommExtraPointCardHTML()` is. `renderCommPage()` opens
 * with `document.getElementById('page-commissioner')`, which is null under the
 * loadtest DOM stub, so the whole panel early-returns and nothing it builds can
 * be asserted on. The only other way to test what this card DISCLOSES would be
 * to grep app.js for the gate — the RG-27 false-coverage anti-pattern, a test
 * that stays green when the guard is reverted. Pure: takes a week, returns a
 * string. Asserted on its rendered markup in loadtest [34h], Surface 4.
 *
 * RG-43 — THE FIFTH RECURRENCE OF THE BLIND-RULE LEAK, and the third of the
 * five to hide inside the commissioner panel. This block consulted NEITHER
 * canViewOtherPicks() NOR arePicksPublic(). Its only gate was being rendered
 * inside the panel — exactly the assumption RG-37 and RG-40 were raised to
 * destroy, because Drew is BOTH commissioner and player. On an OPEN week, with
 * his own guess still editable, the Week tab he uses to set the tiebreaker
 * question printed `Submitted guesses: Drew: 12 | Brayden: 4177`, while the
 * score summary blinded 4177 on the identical data. A tiebreaker decides the
 * weekly cash prize whenever records tie, so a rival's number is worth as much
 * as a rival's pick.
 *
 * It asks canViewOtherPicks() — the SAME predicate the dashboard, the compact
 * view, the score summary and the Extra Point card ask. Not a copy of its
 * logic: nine drifted longhand copies of this rule is what produced the
 * original leak (UN-116), and a surface with its own idea of "public" is the
 * next RG row.
 *
 * The Δ is blinded with the guess, not separately: |guess − actual| discloses
 * the guess up to a sign, and `actualTiebreakerValue` has no status gate on its
 * input, so an OPEN week can already carry one. The viewer's own guess (and own
 * Δ) stays visible — the commissioner is a player too and needs to see what he
 * entered.
 */
export function renderTiebreakerGuessesAdmin(week, players, actualTB) {
  if(!week)return'';
  const weekId=week.weekId;
  const canSeeOthers=canViewOtherPicks(week);
  const myId=getSession().playerId;
  const guesses=players.filter(p=>p.active).map(p=>{
    const g=getTiebreakerGuess(weekId,p.playerId);
    const d=actualTB!==null&&g!==null?Math.abs(g-actualTB):null;
    return{player:p,guess:g,delta:d,blind:!canSeeOthers&&p.playerId!==myId};
  }).filter(x=>x.guess!==null);
  if(!guesses.length)return'<p class="text-muted text-xs mt-md">No tiebreaker guesses yet.</p>';
  const blindNote=canSeeOthers?'':
    '<p class="text-muted text-xs" style="margin:4px 0 0">Other players\' guesses stay hidden until kickoff — yours is still editable.</p>';
  return`<div class="divider"></div><div class="text-xs text-muted mb-sm">Submitted guesses:</div>
    <div class="flex gap-sm flex-wrap">
      ${guesses.map(x=>x.blind
        ?`<span class="badge badge-final tb-guess-blind">${escHtml(x.player.displayName)}: <span title="Hidden until the games kick off">•••</span></span>`
        :`<span class="badge badge-final">${escHtml(x.player.displayName)}: ${x.guess}${x.delta!==null?` (Δ${x.delta})`:''}</span>`).join('')}
    </div>${blindNote}`;
}

function currentSeasonObligations() {
  // v0.17.0 — demo-week obligations are excluded everywhere; anything a demo
  // finalize created in the past is invisible and purgeable below.
  const demoIds = new Set(getWeeks().filter(w=>w.dataSourceMode==='demo').map(w=>w.weekId));
  return getObligations().filter(o=>!demoIds.has(o.weekId) && !String(o.obligationId).startsWith('ob_2025_'));
}

// ─── DEBT-PAYMENT APPROVAL (UN-89) ─────────────────────────────────────────
// Badge + action markup shared by EVERY render path that shows an
// obligation's payment status: the Standings weekly-history cell, the comm
// Players-tab Obligations card, and both the current-season and 2K25-
// carryover variants of each. One function so all five surfaces can never
// disagree about copy, badge color, or which button a given viewer sees
// (CONVENTIONS #21 — this is the codebase's most common defect class).
//
//   status   — 'unpaid' | 'pending' | 'paid' | 'waived'
//   ob       — anything carrying payerPlayerId/recipientPlayerId/obligationId;
//              works unmodified for both a real cfbp_obligations record and a
//              synthetic season2025Obligations() row
//   sess     — getSession() shape ({isAdmin, playerId, ...})
//   obClass  — CSS class prefix on the action buttons (and the data-ob-action
//              attribute) so the click delegate knows which store to mutate:
//              'ob-action' → current-season (saveObligation); 'ob2025-action'
//              → the settings.ob2025 status-map overlay
function obligationActionsHTML(status, ob, sess, { payerName, recipientName, obClass }) {
  const role = obligationRole(sess, ob);
  const disp = obligationStatusDisplay(status);
  let title = '';
  if (status === 'pending') title = `Pending confirmation from ${recipientName} or the commissioner`;
  else if (status === 'unpaid' && ob.deniedReason) title = `Denied: ${ob.deniedReason}`;
  const badge = `<span class="badge ${disp.badgeClass}"${title ? ` title="${escHtml(title)}"` : ''}>${escHtml(disp.label)}</span>`;

  const btn = (action, label, cls = 'btn-win') =>
    `<button class="btn ${cls} btn-sm ml-sm ${obClass}-btn" data-ob-id="${escHtml(ob.obligationId)}" data-ob-action="${action}">${escHtml(label)}</button>`;

  let actions = '';
  if (status === 'unpaid') {
    // Payer's own claim needs confirmation (→ pending); the creditor's or the
    // commissioner's own action IS the verification (→ paid, direct).
    if (role === 'payer') actions = btn('mark', 'Mark Paid');
    else if (role === 'creditor') actions = btn('mark', 'Confirm Paid');
    else if (role === 'admin') actions = btn('mark', 'Mark Paid');
  } else if (status === 'pending') {
    if (role === 'payer') actions = `<span class="text-muted text-xs ml-sm">Waiting on ${escHtml(recipientName)} to confirm.</span>`;
    else if (role === 'creditor' || role === 'admin') actions = btn('confirm', 'Confirm') + btn('deny', 'Deny', 'btn-danger');
  } else if (status === 'paid' && role === 'admin') {
    actions = `<button class="btn btn-ghost btn-sm ml-sm ${obClass}-btn" data-ob-id="${escHtml(ob.obligationId)}" data-ob-action="undo">Undo</button>`;
  }
  // waived, and every other (status, role) combo (payer/creditor/bystander on
  // paid; bystander everywhere): badge only — no button rendered.
  return badge + actions;
}

/** Applies one UN-89 transition to a CURRENT-SEASON obligation (a full
 *  cfbp_obligations record). Re-derives role + the legal next status from the
 *  store rather than trusting the caller — the UI hides buttons a viewer
 *  shouldn't see, but a sufficiently motivated person could DOM one in, and
 *  this is the actual permission boundary (existing pattern in this file). */
function handleObligationAction(obId, action) {
  const ob = getObligations().find(o => o.obligationId === obId); if (!ob) return;
  // UN-126 — a voided/merged-away obligation is no longer a live debt; the
  // UI never renders an action button for one (see renderObligationsAdmin /
  // renderLeaderboard), but this is the actual permission boundary, same
  // reasoning as the role re-derivation two lines down.
  if (!isObligationActive(ob)) { showToast('This obligation was voided — see Data → Obligation Corrections', 'error'); return; }
  const sess = getSession();
  const role = obligationRole(sess, ob);
  const next = obligationNextStatus(ob.status, role, action);
  if (!next) { showToast("You don't have permission to do that", 'error'); return; }
  const payerName = getPlayer(ob.payerPlayerId)?.displayName || '?';
  const recipientName = getPlayer(ob.recipientPlayerId)?.displayName || '?';

  if (action === 'deny') {
    const reason = prompt('Why are you denying this? (optional — leave blank to skip)');
    if (reason === null) return;                          // cancelled the prompt — no change
    saveObligation({ ...ob, status: next, deniedReason: reason.trim() || null, paidAt: null });
    showToast('Denied — back to unpaid.', 'error');
  } else if (action === 'mark' && next === 'pending') {
    saveObligation({ ...ob, status: next, deniedReason: null });
    showToast(`Marked as paid — waiting on ${escHtml(recipientName)} or the commissioner to confirm.`, 'warning');
  } else if (action === 'mark' && next === 'paid') {
    const settled = { ...ob, status: next, paidAt: new Date().toISOString(), deniedReason: null };
    saveObligation(settled);
    // Groups A/B (2026-09-10, DI-B4) — "settled," both parties.
    try { notifyObligationSettled(settled); renderNotifBell(); } catch (e) { console.warn('[notifications] obligation-settled hook failed', e); }
    showToast(role === 'creditor' ? 'Confirmed — marked paid.' : 'Marked paid ✅', 'success');
  } else if (action === 'confirm') {
    const settled = { ...ob, status: next, paidAt: new Date().toISOString(), deniedReason: null };
    saveObligation(settled);
    try { notifyObligationSettled(settled); renderNotifBell(); } catch (e) { console.warn('[notifications] obligation-settled hook failed', e); }
    showToast(`Confirmed — ${escHtml(payerName)} paid ${escHtml(recipientName)}.`, 'success');
  } else if (action === 'undo') {
    saveObligation({ ...ob, status: next, paidAt: null });
  }
}

/** Same transitions, applied to the 2K25 CARRYOVER ledger — a status-map
 *  overlay (settings.ob2025) on baked history, not a stored record. See
 *  history-2025.js `ob2025Status()` for the legacy-boolean migration story.
 *  No denial-reason prompt: the map's value shape is intentionally a bare
 *  status string ('pending'|'paid', absence=unpaid) with nowhere to carry an
 *  optional reason, so unlike the current-season ledger, deny here does not
 *  ask for one. */
function handleOb2025Action(obligationId, action) {
  const row = season2025Obligations().find(r => r.obligationId === obligationId); if (!row) return;
  const sess = getSession();
  const role = obligationRole(sess, row);
  const status = ob2025Status(getSettings().ob2025 || {}, obligationId);
  const next = obligationNextStatus(status, role, action);
  if (!next) { showToast("You don't have permission to do that", 'error'); return; }
  const applyStatus = (s) => {
    const map = { ...(getSettings().ob2025 || {}) };
    if (s === 'unpaid') delete map[obligationId]; else map[obligationId] = s;
    saveSetting('ob2025', map);
  };
  if (action === 'deny') {
    applyStatus(next);
    showToast('Denied — back to unpaid.', 'error');
  } else if (action === 'mark' && next === 'pending') {
    applyStatus(next);
    showToast(`Marked as paid — waiting on ${escHtml(row.recipientName)} or the commissioner to confirm.`, 'warning');
  } else if (action === 'mark' && next === 'paid') {
    applyStatus(next);
    showToast(role === 'creditor' ? 'Confirmed — marked paid.' : 'Marked paid ✅', 'success');
  } else if (action === 'confirm') {
    applyStatus(next);
    showToast(`Confirmed — ${escHtml(row.payerName)} paid ${escHtml(row.recipientName)}.`, 'success');
  } else if (action === 'undo') {
    applyStatus(next);
  }
}

/** v0.17.0 — 2K25 outstanding balances, visible to the whole league on the
 *  Standings tab. Paid-state syncs via settings.ob2025 (commissioner or the
 *  payer can mark). Collapsible so the current season stays front and center. */
function renderSeason2025OutstandingSection() {
  const paidMap = getSettings().ob2025 || {};
  const rows = season2025Obligations();
  // "Open" = anything not fully PAID — pending rows still owe the money, so
  // they stay counted, filtered, and rendered right alongside unpaid ones.
  const openRowsAll = rows.filter(r => ob2025Status(paidMap, r.obligationId) !== 'paid');
  const nets = season2025Nets();
  const fmtNet = n => n > 0 ? `+${n}` : `${n}`;
  const sess = getSession();
  // Filter: 'all' | 'iowe' | 'owedto'. Only shown when a player is signed in
  // (bystanders and admins in general commissioner-mode see all).
  const showFilter = !!(sess.playerId && sess.playerVerified);
  const filter = state.ob2025Filter || 'all';
  const filterRows = (rowsList) => {
    if (!showFilter || filter === 'all') return rowsList;
    if (filter === 'iowe')   return rowsList.filter(r => r.payerPlayerId    === sess.playerId);
    if (filter === 'owedto') return rowsList.filter(r => r.recipientPlayerId === sess.playerId);
    return rowsList;
  };
  const openRows = filterRows(openRowsAll);
  const netMe = sess.playerId && (() => {
    const p = getPlayer(sess.playerId);
    if (!p) return null;
    return nets[p.displayName];
  })();
  return `
    <div class="admin-section-title">🍺 2K25 Outstanding Balances</div>
    <div class="card mb-md">
      <p class="text-muted text-xs mb-sm">${openRowsAll.length} of ${rows.length} drinks from last season remain outstanding. Per league bylaw: settled IN PERSON only. Net position: ${Object.entries(nets).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`${escHtml(n)} ${fmtNet(v)}`).join(' · ')}.</p>
      ${showFilter ? `
        <div class="ob-filter-tabs mb-sm">
          <button type="button" class="ob-filter-tab${filter==='all'?' active':''}" data-ob-filter="all">All (${openRowsAll.length})</button>
          <button type="button" class="ob-filter-tab${filter==='iowe'?' active':''}" data-ob-filter="iowe">What I owe (${openRowsAll.filter(r=>r.payerPlayerId===sess.playerId).length})</button>
          <button type="button" class="ob-filter-tab${filter==='owedto'?' active':''}" data-ob-filter="owedto">Owed to me (${openRowsAll.filter(r=>r.recipientPlayerId===sess.playerId).length})</button>
          ${Number.isFinite(netMe) ? `<span class="ob-net-me ${netMe>0?'net-positive':netMe<0?'net-negative':''}">Your net: ${fmtNet(netMe)}</span>` : ''}
        </div>
      ` : ''}
      ${openRows.length ? openRows.map(r => {
        const status = ob2025Status(paidMap, r.obligationId);
        return `<div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border)">
          <div class="text-sm"><strong>${escHtml(r.payerName)}</strong> owes <strong>${escHtml(r.recipientName)}</strong> — ${escHtml(r.prize)}
            <span class="text-xs text-muted">(${escHtml(r.weekLabel)})</span></div>
          ${obligationActionsHTML(status, r, sess, { payerName: r.payerName, recipientName: r.recipientName, obClass: 'ob2025-action' })}
        </div>`;
      }).join('') : (
        showFilter && filter !== 'all'
          ? `<p class="text-muted text-sm">Nothing here — you're clear on ${filter==='iowe'?'what you owe':'what you\'re owed'}.</p>`
          : '<p class="text-muted text-sm">All settled. The ledger rests — for now.</p>'
      )}
    </div>`;
}

/** v0.17.0 — the CFP 2K25 season of record, permanently browsable. */
function renderSeason2025RecordSection() {
  const wkNames = Object.keys(SEASON_2025.weeklyScores);
  return `
    <div class="admin-section-title">📜 Historical Record — ${escHtml(SEASON_2025.label)}</div>
    <div class="card mb-md">
      <details>
        <summary style="cursor:pointer;font-weight:600;font-size:.85rem">🏆 ${escHtml(SEASON_2025.champion.name)} — ${SEASON_2025.champion.points} pts · full season record (tap to expand)</summary>
        <div class="dashboard-scroll" style="margin-top:10px">
          <table class="dashboard-table">
            <thead><tr><th>Rk</th><th>Player</th><th>Reg</th><th>EP</th><th>Conf ×2</th><th>Bowls</th><th>R1 ×2</th><th>QF ×2</th><th>Semis ×3</th><th>Total</th></tr></thead>
            <tbody>${SEASON_2025.standings.map(s=>`<tr>
              <td>${s.rank}</td><td class="player-name-cell">${escHtml(s.name)} <span class="text-xs text-muted">"${escHtml(s.alias)}"</span></td>
              <td>${s.reg}</td><td>${s.extraPt}</td><td>${s.conf}</td><td>${s.bowls}</td><td>${s.cfpR1}</td><td>${s.cfpQF}</td><td>${s.semis??'DNP'}</td><td><strong>${s.total}</strong></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="dashboard-scroll" style="margin-top:10px">
          <table class="dashboard-table">
            <thead><tr><th>Player</th>${Array.from({length:14},(_,i)=>`<th>${i+1}</th>`).join('')}<th>Reg</th></tr></thead>
            <tbody>${wkNames.map(n=>{
              const arr=SEASON_2025.weeklyScores[n];
              return `<tr><td class="player-name-cell">${escHtml(n)}</td>${arr.map(v=>`<td>${v}</td>`).join('')}<td><strong>${arr.reduce((a,b)=>a+b,0)}</strong></td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <div style="margin-top:10px">${SEASON_2025.superlatives.map(s=>`<div class="recap-line"><strong>${escHtml(s.label)}:</strong> ${escHtml(s.value)}</div>`).join('')}</div>
        <p class="text-muted text-xs" style="margin-top:8px">${SEASON_2025.notes.map(escHtml).join(' · ')}</p>
      </details>
    </div>`;
}

function bindSeason2025Sections(c) {
  c.querySelectorAll('.ob2025-action-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      handleOb2025Action(btn.dataset.obId, btn.dataset.obAction);
      renderLeaderboard();
    });
  });
  c.querySelectorAll('.ob-filter-tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.ob2025Filter = btn.dataset.obFilter;
      renderLeaderboard();
    });
  });
}

export function renderObligationsAdmin() {
  // UN-126 — `all` keeps the pre-existing (non-demo, non-2K25) universe for
  // the demo-count math below; `obs` is the OPERABLE list this card lists
  // and lets a commissioner mark/confirm/deny/undo against — a voided or
  // merged-away obligation is no longer a live debt (isObligationActive) and
  // moves to the Data-tab Obligation Corrections card instead, where it's
  // still fully visible for audit.
  const all=currentSeasonObligations(); const obs=all.filter(isObligationActive);
  const players=getPlayers(); const settings=getSettings();
  const sess = getSession();
  const demoCount = getObligations().length - all.length - getObligations().filter(o=>String(o.obligationId).startsWith('ob_2025_')).length;
  const purge = demoCount>0 ? `<div class="info-box mb-sm">🧹 ${demoCount} demo-week obligation${demoCount>1?'s':''} hidden. <button class="btn btn-ghost btn-sm" id="ob-purge-demo">Purge permanently</button></div>` : '';
  if(!obs.length)return purge+'<p class="text-muted text-sm">No obligations this season — the slate is clean until Week 1 finalizes.</p>';
  return purge + obs.map(ob=>{
    const payer=players.find(p=>p.playerId===ob.payerPlayerId);
    const recip=players.find(p=>p.playerId===ob.recipientPlayerId);
    const w=getWeek(ob.weekId);
    const reviewFlag = ob.needsReview ? ' <span class="badge badge-loss" title="A freshly computed outcome disagrees with this record — resolve in Data → Obligation Corrections">⚠️ Needs review</span>' : '';
    return`<div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <div class="text-sm"><strong>${escHtml(payer?.displayName||'?')}</strong> owes <strong>${escHtml(recip?.displayName||'?')}</strong>${reviewFlag}</div>
        <div class="text-xs text-muted">${escHtml(ob.weekId ? formatWeekLabel(w) : (ob.weekLabel||'manual'))} · ${escHtml(ob.note||ob.amountOrPrize||settings.weeklyPrize)}</div>
      </div>
      <div class="flex gap-sm" style="align-items:center">
        ${obligationActionsHTML(ob.status, ob, sess, {
          payerName: payer?.displayName || '?', recipientName: recip?.displayName || '?', obClass: 'ob-action',
        })}
        <button class="btn btn-ghost btn-sm ob-delete-btn" data-ob-id="${ob.obligationId}" title="Delete">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ─── UN-126 (Part 2) — OBLIGATION CORRECTIONS: merge / void ────────────────
// Commissioner-only, Data-tab tool. Two capabilities, both requiring an
// explicit confirmation step that names exactly what will change, and
// neither one ever hard-deletes a record (CLAUDE.md — an obligation is a
// real debt between real people):
//   VOID  — one obligation stops counting toward what anyone owes but stays
//           on screen and in the CSV export, tagged as voided.
//   MERGE — two or more obligations collapse into ONE (the commissioner
//           picks which record is correct); the others are voided with a
//           pointer to what absorbed them, and the survivor records what it
//           absorbed. This is the tool that resolves what
//           reconcileWeeklyObligation() surfaces above, AND the manual fix
//           for the pre-UN-118 split-week duplicates that already exist in
//           storage (two different weekIds, never auto-flagged, because
//           they predate grouping entirely).

/**
 * Void a single obligation WITHOUT deleting it. Exported for loadtest.mjs —
 * pure storage mutation, no DOM/confirm/prompt inside, same shape as
 * mergeObligationsById below.
 *
 * Voiding IS the commissioner's resolution of a Part-1 conflict, so it also
 * clears `needsReview` on every OTHER active obligation sharing this
 * weekId — the survivor of a resolved conflict shouldn't keep nagging for
 * review once a human has acted on its sibling.
 */
export function voidObligationById(obId, reason = null) {
  const ob = getObligations().find(o => o.obligationId === obId);
  if (!ob) return false;
  const now = new Date().toISOString();
  saveObligation({ ...ob, voided: true, voidedAt: now, voidReason: reason || null, needsReview: false });
  getObligations()
    .filter(o => o.weekId === ob.weekId && o.obligationId !== ob.obligationId && isObligationActive(o) && o.needsReview)
    .forEach(o => saveObligation({ ...o, needsReview: false }));
  return true;
}

/**
 * Merge 2+ obligations into ONE. `keepId` survives EXACTLY as it was —
 * status/amount/payer/recipient untouched, because the commissioner is the
 * one asserting it's the correct record, not this function inventing a
 * value. Everything in `otherIds` (that isn't already voided) is voided with
 * `mergedInto` pointing at the survivor; the survivor's `mergedFrom` records
 * every id it absorbed — "record what it absorbed," never destroy the
 * history of what was owed. Applied via saveAllObligations() as one rewrite
 * so the whole set changes atomically rather than racing itself across
 * several sequential saveObligation() calls. Exported for loadtest.mjs.
 */
export function mergeObligationsById(keepId, otherIds = []) {
  const all = getObligations();
  const keep = all.find(o => o.obligationId === keepId);
  if (!keep) return false;
  const now = new Date().toISOString();
  const absorbed = [];
  const voided = all.map(o => {
    if (o.obligationId !== keepId && otherIds.includes(o.obligationId) && isObligationActive(o)) {
      absorbed.push(o.obligationId);
      return { ...o, voided: true, voidedAt: now, mergedInto: keepId, needsReview: false };
    }
    return o;
  });
  if (!absorbed.length) return false;              // nothing eligible — no-op, not a partial write
  const next = voided.map(o => o.obligationId === keepId
    ? { ...o, needsReview: false, mergedFrom: [...(o.mergedFrom || []), ...absorbed] }
    : o);
  saveAllObligations(next);
  return true;
}

/** DOM handler for the single-row 🚫 Void button — confirmation names
 *  exactly what will change, per the design constraint. */
function handleVoidObligation(obId) {
  const ob = getObligations().find(o => o.obligationId === obId); if (!ob) return;
  if (!isObligationActive(ob)) { showToast('Already voided', 'warning'); return; }
  const payer = getPlayer(ob.payerPlayerId)?.displayName || '?';
  const recip = getPlayer(ob.recipientPlayerId)?.displayName || '?';
  const w = getWeek(ob.weekId);
  const wl = ob.weekId ? (formatWeekLabel(w) || ob.weekId) : (ob.weekLabel || 'manual');
  const ok = confirm(`Void this obligation?\n\n${payer} owes ${recip} — ${wl} — ${ob.amountOrPrize || ''}\n\nIt will stop counting toward what anyone owes, but stays visible here and in the Obligations CSV as VOIDED. Nothing is deleted.`);
  if (!ok) return;
  const reason = prompt('Optional note on why this is being voided (blank to skip):');
  voidObligationById(obId, (reason || '').trim() || null);
  showToast('🚫 Obligation voided', 'success');
  renderCommPage();
}

/** Modal for the multi-row 🔗 Merge Selected button. Shows every selected
 *  obligation and lets the commissioner pick which ONE survives — the
 *  confirm() that follows names the exact keep/void split before anything
 *  is written, per the design constraint. */
function showMergeObligationsModal(ids) {
  const obs = ids.map(id => getObligations().find(o => o.obligationId === id)).filter(Boolean);
  if (obs.length < 2) { showToast('Select at least two obligations to merge', 'error'); return; }
  const label = ob => {
    const payer = getPlayer(ob.payerPlayerId)?.displayName || '?';
    const recip = getPlayer(ob.recipientPlayerId)?.displayName || '?';
    const w = getWeek(ob.weekId);
    const wl = ob.weekId ? (formatWeekLabel(w) || ob.weekId) : (ob.weekLabel || 'manual');
    return `${payer} owes ${recip} — ${wl} — ${ob.amountOrPrize || ''}`;
  };
  const ov = document.createElement('div'); ov.className = 'modal-overlay centered';
  ov.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>Merge ${obs.length} Obligations</h3><button class="modal-close" id="mg-c">✕</button></div>
    <p class="text-muted text-sm mb-sm">Pick the ONE record that's correct. The others are voided and recorded as absorbed into it — nothing is deleted.</p>
    ${obs.map((ob, i) => `
      <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
        <input type="radio" name="mg-keep" value="${escHtml(ob.obligationId)}" ${i === 0 ? 'checked' : ''} style="margin-top:3px" />
        <span class="text-sm">${escHtml(label(ob))}</span>
      </label>`).join('')}
    <button class="btn btn-primary btn-block mt-md" id="mg-confirm">Merge — Keep Selected, Void the Rest</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#mg-c')?.addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#mg-confirm')?.addEventListener('click', () => {
    const keepId = ov.querySelector('input[name="mg-keep"]:checked')?.value;
    if (!keepId) { showToast('Pick which record to keep', 'error'); return; }
    const otherIds = obs.map(o => o.obligationId).filter(id => id !== keepId);
    const keepLabel = label(obs.find(o => o.obligationId === keepId));
    const ok = confirm(`Merge ${obs.length} obligations into ONE?\n\nKEEPING: ${keepLabel}\n\nVOIDING (recorded as absorbed): ${otherIds.length} other record${otherIds.length > 1 ? 's' : ''}.\n\nVoided records stay visible in the ledger and CSV — nothing is deleted.`);
    if (!ok) return;
    mergeObligationsById(keepId, otherIds);
    ov.remove();
    showToast('🔗 Obligations merged', 'success');
    renderCommPage();
  });
}

/**
 * The Data-tab card body: EVERY current-season obligation (not just active
 * ones — voided/merged rows stay visible here too, badge-flagged, so the
 * audit trail is on screen and not just in the CSV). `entries` is an
 * optional injection point for loadtest.mjs, same pattern as
 * renderFeedbackAdmin's optional argument — the production call site reads
 * live storage.
 */
export function renderObligationCorrectionsAdmin(entries = currentSeasonObligations()) {
  if (!entries.length) return '<p class="text-muted text-sm">No obligations this season yet.</p>';
  const players = getPlayers();
  const nameOf = id => players.find(p => p.playerId === id)?.displayName || '?';
  const sorted = entries.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const reviewCount = sorted.filter(o => o.needsReview && isObligationActive(o)).length;
  const banner = reviewCount
    ? `<div class="info-box mb-sm" style="border-color:var(--maroon)">⚠️ ${reviewCount} obligation${reviewCount > 1 ? 's' : ''} need review — a freshly computed outcome disagrees with an existing record. Merge or void below to resolve.</div>`
    : '';
  return banner + sorted.map(ob => {
    const w = getWeek(ob.weekId);
    const wl = ob.weekId ? (formatWeekLabel(w) || ob.weekId) : (ob.weekLabel || 'manual');
    let stateBadge = '';
    if (ob.voided && ob.mergedInto) stateBadge = ` <span class="badge badge-final" title="${escHtml(ob.voidReason || '')}">🔗 Merged</span>`;
    else if (ob.voided) stateBadge = ` <span class="badge badge-final" title="${escHtml(ob.voidReason || '')}">🚫 Voided</span>`;
    else if (ob.needsReview) stateBadge = ' <span class="badge badge-loss">⚠️ Needs review</span>';
    const checkbox = ob.voided ? '' : `<input type="checkbox" class="obcorr-check" data-ob-id="${escHtml(ob.obligationId)}" style="margin-top:4px" />`;
    const voidBtn = ob.voided ? '' : `<button class="btn btn-ghost btn-sm obcorr-void-btn" data-ob-id="${escHtml(ob.obligationId)}">🚫 Void</button>`;
    return `<div class="flex gap-sm" style="padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start">
      ${checkbox}
      <div style="flex:1">
        <div class="text-sm"><strong>${escHtml(nameOf(ob.payerPlayerId))}</strong> owes <strong>${escHtml(nameOf(ob.recipientPlayerId))}</strong>${stateBadge}</div>
        <div class="text-xs text-muted">${escHtml(wl)} · ${escHtml(ob.note || ob.amountOrPrize || '')} · ${escHtml(ob.status)}</div>
        ${ob.mergedInto ? `<div class="text-xs text-muted">→ merged into ${escHtml(ob.mergedInto)}</div>` : ''}
        ${(ob.mergedFrom && ob.mergedFrom.length) ? `<div class="text-xs text-muted">absorbed: ${escHtml(ob.mergedFrom.join(', '))}</div>` : ''}
      </div>
      ${voidBtn}
    </div>`;
  }).join('');
}

/**
 * DI-H (2026-09-02) — the Data-tab card, INCLUDING its data-comm-tab="data"
 * wrapper (RG-10), for the one-time-but-permanently-available retroactive
 * recompute. Exported for the same reason its neighbours below are: a test
 * seam that asserts the markup itself, string in/string out, no DOM. The
 * results panel only appears once `state.recalcAllResult` is populated by the
 * click handler in bindCommEventListeners() — the exact store-in-state-then-
 * renderCommPage() pattern the rest of this panel already uses (see
 * `state.lastFetchResult`).
 *
 * Button stays PERMANENTLY available (not single-use-then-hidden) — Drew's
 * ruling: restricting it would reintroduce the same failure the next time a
 * tiebreaker is entered late.
 */
export function renderRecalculateFinalizedWeeksAdminSectionHTML() {
  const r = state.recalcAllResult;
  return `
    <div class="admin-section" data-comm-tab="data">
      <div class="admin-section-title">🔁 Recalculate Finalized Weeks</div>
      <div class="card">
        <p class="text-muted text-xs mb-sm">Re-runs finalize on every already-final week using the currently saved tiebreaker values. Use this to correct any week that finalized before its tiebreaker was entered — including weeks that may already have gotten it wrong.</p>
        <button class="btn btn-primary btn-block" id="recalc-all-weeks-btn">🔁 Recalculate All Finalized Weeks</button>
        ${r ? `
          <div class="info-box mt-sm">
            ${r.changes.length===0
              ? 'No results changed.'
              : r.changes.map(c=>`<div>${escHtml(c)}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    </div>`;
}

/**
 * The whole Data-tab card, INCLUDING its data-comm-tab="data" wrapper
 * (RG-10) — exported as its own HTML-returning function so loadtest.mjs can
 * assert the wrapper is actually present in rendered markup, same pattern
 * renderFeedbackAdminSectionHTML() set yesterday.
 */
export function renderObligationCorrectionsAdminSectionHTML() {
  return `
    <div class="admin-section" data-comm-tab="data">
      <div class="admin-section-title">🔀 Obligation Corrections</div>
      <div class="card">
        <p class="text-muted text-xs mb-sm">Merge duplicate prizes into one, or void one outright. Nothing is ever deleted — voided and merged records stay visible here and in the Obligations CSV.</p>
        <div class="obcorr-list">${renderObligationCorrectionsAdmin()}</div>
        <div class="divider"></div>
        <button class="btn btn-secondary btn-sm" id="obcorr-merge-btn" disabled>🔗 Merge Selected (0)</button>
      </div>
    </div>`;
}

/** v0.17.0 — the 2K25 carryover ledger. Paid-state lives in settings.ob2025
 *  so the baked history data stays immutable and paid-marks sync cross-device. */
function renderSeason2025ObligationsAdmin() {
  const paidMap = getSettings().ob2025 || {};
  const rows = season2025Obligations();
  const sess = getSession();
  const open = rows.filter(r=>ob2025Status(paidMap, r.obligationId)!=='paid').length;
  return `<div class="text-xs text-muted mb-sm">${open} of ${rows.length} still outstanding · payable IN PERSON only</div>` +
    rows.map(r=>{
      const status = ob2025Status(paidMap, r.obligationId);
      return `<div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border)">
        <div><div class="text-sm"><strong>${escHtml(r.payerName)}</strong> owes <strong>${escHtml(r.recipientName)}</strong> — ${escHtml(r.prize)}</div>
          <div class="text-xs text-muted">${escHtml(r.weekLabel)}${r.note?` · ${escHtml(r.note)}`:''}</div></div>
        ${obligationActionsHTML(status, r, sess, { payerName: r.payerName, recipientName: r.recipientName, obClass: 'ob2025-action' })}
      </div>`;
    }).join('');
}

/** Chat retention (UN-88) — commissioner Data-tab card. CLIENT-SIDE HIDE ONLY,
 *  Drew's explicit call: the backend has no row-removal endpoint, so a real
 *  delete would need a new Code.gs endpoint + redeploy (RG-09 risk) for a
 *  cosmetic gain at 6-player scale. This toggle only stops old messages from
 *  RENDERING — nothing is ever deleted, and it is fully reversible. */
function renderChatRetentionAdmin() {
  const days = getRetentionDays();
  const on = days > 0;
  const stats = on ? retentionStats() : null;
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const countLines = () => {
    if (!on) return '';
    if (stats.hiddenCount > 0) {
      return `<p class="text-xs mt-sm">🙈 ${stats.hiddenCount} messages are older than 7 days and hidden (${escHtml(fmtDate(stats.oldestTs))} – ${escHtml(fmtDate(stats.newestTs))})</p>
        ${stats.protectedCount > 0 ? `<p class="text-xs">🏛 ${stats.protectedCount} pinned messages in that range stay visible</p>` : ''}`;
    }
    if (stats.protectedCount > 0) {
      return `<p class="text-xs mt-sm">🏛 ${stats.protectedCount} pinned messages in that range stay visible</p>`;
    }
    return '<p class="text-xs mt-sm">Nothing is hidden yet — no messages are older than 7 days.</p>';
  };
  return `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="chat-retention-toggle" ${on ? 'checked' : ''} />
      <span class="form-label" style="margin:0">Hide chat messages older than 7 days</span>
    </label>
    <p class="text-muted text-xs mt-sm">${on
      ? 'Older messages stop showing in chat. Nothing is deleted — flip this back off and the full history returns. 🏛 Hall of Records pins are always visible, no matter how old.'
      : 'Off — the full Locker Room history is visible.'}</p>
    ${countLines()}`;
}

/** Chat epoch clear (UN-112, LAUNCH BLOCKER) — commissioner Data-tab card.
 *  A WATERMARK, same hide-not-delete shape as chat retention above and for
 *  the same reason: the backend has no row-removal endpoint, so a real purge
 *  needs a new Code.gs endpoint + redeploy (RG-09 risk) for a one-time
 *  action at the highest-stakes moment. This is the REPEATABLE control
 *  (DI-112a) — separate from the "⚠️ Full Factory Reset" button above, which
 *  also wires this in, so a failed clear has a retry path here and testing
 *  chatter can be cleared again later without re-wiping players/weeks. */
function renderChatEpochAdmin() {
  const cleared = getChatEpochSeq() > 0;
  const stats = cleared ? epochStats() : null;
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  return `
    <p class="text-muted text-xs mb-sm">${cleared
      ? `✅ Chat history before ${escHtml(fmtDate(getChatEpochSetAt()))} is hidden (${stats.hiddenCount} messages). Nothing is deleted — this only affects what renders.`
      : `Full Locker Room history is visible, including anything sent during testing.`}</p>
    <button class="btn btn-danger btn-sm" id="chat-epoch-clear-btn">${cleared ? '🧹 Clear Chat Again' : '🧹 Clear Chat History Before Launch'}</button>`;
}

function renderCommLogin(c) {
  c.innerHTML=`
    <div class="section-header"><h2>Commissioner</h2></div>
    <div class="card admin-login-card">
      <div class="text-center mb-md"><div style="font-size:2.5rem">🔐</div><h3>Commissioner Login</h3></div>
      <div class="form-group"><label class="form-label">Password</label>
        <input class="form-input" id="comm-password-input" type="password" placeholder="Password…" /></div>
      <button class="btn btn-primary btn-block" id="comm-login-btn">Login</button>
    </div>`;
  document.getElementById('comm-login-btn')?.addEventListener('click', ()=>{
    const val=document.getElementById('comm-password-input')?.value||'';
    if(btoa(val)===getSettings().adminPasswordHash){
      const s=getSession();setSession(s.playerId,true,s.playerVerified);
      showToast('✅ Commissioner access granted','success');renderCommPage();
    } else showToast('❌ Incorrect password','error');
  });
  document.getElementById('comm-password-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('comm-login-btn')?.click();});
}

function renderWeekStatusButtons(week) {
  // All status transitions — Commissioner can go in any direction for corrections
  const t={
    draft:  [{to:'open',  label:'📢 Open for Picks', cls:'btn-primary'}],
    open:   [{to:'locked',label:'🔒 Lock Week',       cls:'btn-secondary'},
             {to:'draft', label:'↩ Back to Draft',    cls:'btn-ghost'}],
    locked: [{to:'live',  label:'▶️ Go Live',         cls:'btn-secondary'},
             {to:'open',  label:'🔓 Re-open Picks',   cls:'btn-ghost'},
             {to:'draft', label:'↩ Back to Draft',    cls:'btn-ghost'}],
    live:   [{to:'final', label:'✅ Finalize',        cls:'btn-primary'},
             {to:'locked',label:'⏸ Pause (Re-lock)',  cls:'btn-secondary'},
             {to:'open',  label:'🔓 Re-open Picks',   cls:'btn-ghost'}],
    final:  [{to:'live',  label:'↩ Reopen to Live',   cls:'btn-ghost'},
             {to:'open',  label:'↩ Reopen to Open',   cls:'btn-ghost'}],
  };
  return(t[week.status]||[]).map(x=>`<button class="btn ${x.cls} btn-sm week-status-btn" data-to="${x.to}">${x.label}</button>`).join('');
}

// ─── MODALS ───────────────────────────────────────────────────────────────────

function showCreateWeekModal() {
  const allWeeks=getWeeks();
  const nextNum=allWeeks.length?Math.max(...allWeeks.map(w=>w.weekNumber))+1:1;
  const ov=document.createElement('div'); ov.className='modal-overlay centered';
  ov.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Create New Week</h3><button class="modal-close" id="cw-c">✕</button></div>
    <div class="form-group"><label class="form-label">Season</label><input class="form-input" id="cw-season" value="${getSettings().season||'2026'}" /></div>
    <div class="form-group"><label class="form-label">Week Number</label><input class="form-input" id="cw-num" type="number" value="${nextNum}" /></div>
    <div class="form-group"><label class="form-label">Custom Round Label <span class="text-muted text-xs">(added after the week number, e.g. "Part 2" — leave blank to use week number)</span></label><input class="form-input" id="cw-round" placeholder="e.g. Part 2" /></div>
    <div class="form-group"><label class="form-label">Start Date</label><input class="form-input" id="cw-start" type="date" /></div>
    <div class="form-group"><label class="form-label">End Date</label><input class="form-input" id="cw-end" type="date" /></div>
    <div class="form-group"><label class="form-label">Data Source</label>
      <select class="form-select" id="cw-mode">
        <option value="espn_live">📡 ESPN Live</option>
        <option value="espn_historical">📅 ESPN Historical</option>
        <option value="manual">✏️ Manual</option>
        <option value="demo">📋 Demo</option>
      </select></div>
    <button class="btn btn-primary btn-block" id="cw-save">Create Week</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#cw-c')?.addEventListener('click',()=>ov.remove());
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.querySelector('#cw-save')?.addEventListener('click',()=>{
    const season=document.getElementById('cw-season')?.value||'2026';
    const weekNum=parseInt(document.getElementById('cw-num')?.value)||nextNum;
    const roundLabel=document.getElementById('cw-round')?.value.trim()||'';
    const startDate=document.getElementById('cw-start')?.value||'';
    const endDate=document.getElementById('cw-end')?.value||'';
    const mode=document.getElementById('cw-mode')?.value||'manual';
    const newW={...createWeek(season,weekNum,startDate,endDate),dataSourceMode:mode,roundLabel};
    saveWeek(newW);setActiveWeekId(newW.weekId);
    showToast(`✅ Week ${weekNum} created`,'success');ov.remove();refreshHeader();renderCommPage();
  });
}

/**
 * DI-8 — the manual Game Modal has no way to derive nationalTV from a
 * hand-typed game (there is no broadcast data behind a manual entry). It
 * recomputes isAlmaMaterGame fresh on every save (line above this function's
 * call site), but broadcast fields are different: editing an EXISTING
 * (typically ESPN-sourced) game must CARRY FORWARD whatever nationalTV /
 * broadcastNetwork it already has rather than reset to false/null on every
 * edit; a brand-new manual entry gets the safe default. Extracted as its own
 * function so the rule is directly unit-testable without driving the full
 * modal UI.
 */
export function carryForwardBroadcastFields(existingGame) {
  return {
    nationalTV: existingGame ? !!existingGame.nationalTV : false,
    broadcastNetwork: existingGame ? (existingGame.broadcastNetwork || null) : null,
  };
}

function showGameModal(game, week, onSave) {
  const ov=document.createElement('div');ov.className='modal-overlay centered';
  // Derive initial favorite/margin from any existing signed spread so editing
  // an existing game prefills correctly. Convention: home-perspective signed.
  let initFav = game?.favorite || '';
  let initMargin = '';
  if (game?.spread !== null && game?.spread !== undefined) {
    initMargin = Math.abs(game.spread);
    if (!initFav) {
      if (game.spread < 0) initFav = game.homeTeam || '';
      else if (game.spread > 0) initFav = game.awayTeam || '';
    }
  }
  const initMultiplier = Number(game?.multiplier) > 0 ? Number(game.multiplier) : 1;
  const initIsManual = !!game?.isManual;
  const initLeagueLabel = game?.leagueLabel || '';
  const initEspnSport = game?.espnSport || '';
  const initEspnEventId = game?.espnEventId || '';
  // Editing a game whose status has already advanced past 'scheduled' is
  // risky for the multiplier — it retroactively changes standings. We track
  // the original value so save() can prompt for confirmation.
  const originalMultiplier = initMultiplier;
  const gameHasScored = game && game.status && game.status !== 'scheduled';

  ov.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${game?'Edit Game':'Add Game'}</h3><button class="modal-close" id="mc">✕</button></div>
    <div class="flex gap-sm">
      <div class="form-group" style="flex:2"><label class="form-label">Home Team</label><input class="form-input" id="m-home" value="${escHtml(game?.homeTeam||'')}" placeholder="e.g. Oklahoma" /></div>
      <div class="form-group" style="flex:1"><label class="form-label">Home Mascot</label><input class="form-input" id="m-home-mascot" value="${escHtml(game?.homeMascot||'')}" placeholder="Sooners" /></div>
    </div>
    <div class="flex gap-sm">
      <div class="form-group" style="flex:2"><label class="form-label">Away Team</label><input class="form-input" id="m-away" value="${escHtml(game?.awayTeam||'')}" placeholder="e.g. Texas" /></div>
      <div class="form-group" style="flex:1"><label class="form-label">Away Mascot</label><input class="form-input" id="m-away-mascot" value="${escHtml(game?.awayMascot||'')}" placeholder="Longhorns" /></div>
    </div>
    <p class="text-muted text-xs mb-md">Display will be "School (Mascot)" — leave Mascot blank to use the auto lookup.</p>
    <div class="form-group"><label class="form-label">Kickoff (local time)</label>
      <input class="form-input" id="m-kickoff" type="datetime-local" value="${game?.kickoff?new Date(game.kickoff).toISOString().slice(0,16):''}" /></div>

    <div class="form-group"><label class="form-label">Spread</label>
      <div class="spread-input-row">
        <select class="form-select" id="m-spread-fav">
          <option value="">— Favorite —</option>
          <option value="home"${initFav===game?.homeTeam?' selected':''}>Home favored</option>
          <option value="away"${initFav===game?.awayTeam?' selected':''}>Away favored</option>
          <option value="pk"${game?.spread===0?' selected':''}>Pick'em (PK)</option>
        </select>
        <input class="form-input" id="m-spread-margin" type="number" step="0.5" min="0" placeholder="margin (positive)" value="${initMargin}" />
      </div>
      <p class="text-muted text-xs mt-sm">Pick which team is favored and enter the spread as a positive number.</p>
    </div>

    <!-- Scoring multiplier: 1x is a normal game, 2x etc. weights this game
         in the standings. Wins AND losses scale by the same factor.
         Tiebreakers are never multiplied. -->
    <div class="form-group modal-subsection">
      <label class="form-label">🎯 Win Multiplier
        <span class="text-muted text-xs">(marquee/rivalry weight, tiebreaker never multiplied)</span>
      </label>
      <div class="mult-input-row">
        <select class="form-select" id="m-mult-preset">
          <option value="1"${initMultiplier===1?' selected':''}>1x — Normal game</option>
          <option value="1.5"${initMultiplier===1.5?' selected':''}>1.5x</option>
          <option value="2"${initMultiplier===2?' selected':''}>2x — Marquee (rivalry, playoff)</option>
          <option value="3"${initMultiplier===3?' selected':''}>3x — Championship-tier</option>
          <option value="custom"${[1,1.5,2,3].indexOf(initMultiplier)<0?' selected':''}>Custom…</option>
        </select>
        <input class="form-input" id="m-mult-custom" type="number" step="0.5" min="0.5" max="10"
          placeholder="e.g. 2.5" value="${[1,1.5,2,3].indexOf(initMultiplier)<0?initMultiplier:''}"
          style="${[1,1.5,2,3].indexOf(initMultiplier)<0?'':'display:none'}" />
      </div>
      ${gameHasScored && initMultiplier !== 1 ? '<p class="text-warning text-xs mt-sm">⚠️ Editing multiplier on a game that has already scored will change existing standings.</p>' : ''}
    </div>

    <!-- Manual / out-of-league game toggle. When enabled, exposes fields for
         the league label, ESPN sport, and ESPN event ID so a one-off NFL
         game (or similar) can flow through the SAME scoring + polling
         pipeline as CFB games. -->
    <div class="form-group modal-subsection">
      <label class="checkbox-row">
        <input type="checkbox" id="m-is-manual" ${initIsManual?'checked':''} />
        <span><strong>This is a one-off / out-of-league game</strong>
          <span class="text-muted text-xs"> — e.g. NFL Thanksgiving, special event</span>
        </span>
      </label>
      <div id="m-manual-fields" style="${initIsManual?'':'display:none'}" class="manual-fields">
        <div class="form-group">
          <label class="form-label">League Label
            <span class="text-muted text-xs">(shown as a small chip on the game — e.g. "NFL", "Special")</span>
          </label>
          <input class="form-input" id="m-league-label" placeholder="NFL" value="${escHtml(initLeagueLabel)}" maxlength="20" />
        </div>
        <div class="form-group">
          <label class="form-label">ESPN Live Scoring
            <span class="text-muted text-xs">(optional — auto-updates scores if set)</span>
          </label>
          <div class="espn-input-row">
            <select class="form-select" id="m-espn-sport">
              <option value=""${!initEspnSport?' selected':''}>None (Manual entry only)</option>
              <option value="college-football"${initEspnSport==='college-football'?' selected':''}>College Football</option>
              <option value="nfl"${initEspnSport==='nfl'?' selected':''}>NFL</option>
            </select>
            <input class="form-input" id="m-espn-eventid"
              placeholder="ESPN event ID or gamecast URL"
              value="${escHtml(initEspnEventId)}" />
          </div>
          <div class="espn-mode-indicator" id="m-espn-mode">${initEspnSport && initEspnEventId ? '<span class="mode-pill mode-auto">🔄 Auto (ESPN-linked) — scores will update automatically</span>' : '<span class="mode-pill mode-manual">✍️ Manual entry only — you\'ll enter scores yourself</span>'}</div>
          <p class="text-muted text-xs mt-sm">Paste the ESPN gamecast URL and we'll extract the event ID automatically. Ex: <code>https://www.espn.com/nfl/game/_/gameId/401671626</code></p>
        </div>
      </div>
    </div>

    <div class="form-group"><label class="form-label">Venue (optional)</label><input class="form-input" id="m-venue" value="${escHtml(game?.venue||'')}" /></div>
    <div class="form-group"><label class="form-label">Home Conference</label><input class="form-input" id="m-hconf" value="${escHtml(game?.homeConference||'')}" /></div>
    <div class="form-group"><label class="form-label">Away Conference</label><input class="form-input" id="m-aconf" value="${escHtml(game?.awayConference||'')}" /></div>
    <div class="form-group"><label class="form-label">Home Rank (blank=unranked)</label><input class="form-input" id="m-hrank" type="number" value="${game?.homeRank||''}" /></div>
    <div class="form-group"><label class="form-label">Away Rank</label><input class="form-input" id="m-arank" type="number" value="${game?.awayRank||''}" /></div>
    ${game?`<div class="form-group"><label class="form-label">Home Final Score</label><input class="form-input" id="m-hs" type="number" value="${game.homeScore??''}" /></div>
    <div class="form-group"><label class="form-label">Away Final Score</label><input class="form-input" id="m-as" type="number" value="${game.awayScore??''}" /></div>
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-select" id="m-status">
        <option value="scheduled"${game.status==='scheduled'?' selected':''}>Scheduled</option>
        <option value="live"${game.status==='live'?' selected':''}>Live</option>
        <option value="final"${game.status==='final'?' selected':''}>Final</option>
      </select></div>`:''}
    <button class="btn btn-primary btn-block" id="m-save">Save Game</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#mc')?.addEventListener('click',()=>ov.remove());
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});

  // Show/hide the custom multiplier input based on the preset dropdown
  const multPreset = ov.querySelector('#m-mult-preset');
  const multCustom = ov.querySelector('#m-mult-custom');
  multPreset?.addEventListener('change', () => {
    if (multPreset.value === 'custom') {
      multCustom.style.display = '';
      multCustom.focus();
    } else {
      multCustom.style.display = 'none';
    }
  });

  // Toggle manual-fields visibility when the checkbox flips
  const manualCheck = ov.querySelector('#m-is-manual');
  const manualFields = ov.querySelector('#m-manual-fields');
  manualCheck?.addEventListener('change', () => {
    manualFields.style.display = manualCheck.checked ? '' : 'none';
  });

  // Live-update the "Auto vs Manual" pill as the commissioner types
  const espnSportSel = ov.querySelector('#m-espn-sport');
  const espnEvIdInp  = ov.querySelector('#m-espn-eventid');
  const espnMode     = ov.querySelector('#m-espn-mode');
  const updateEspnMode = () => {
    if (!espnMode) return;
    const hasEv = (espnEvIdInp?.value || '').trim().length > 0;
    const hasSport = (espnSportSel?.value || '').length > 0;
    espnMode.innerHTML = hasEv && hasSport
      ? '<span class="mode-pill mode-auto">🔄 Auto (ESPN-linked) — scores will update automatically</span>'
      : '<span class="mode-pill mode-manual">✍️ Manual entry only — you\'ll enter scores yourself</span>';
  };
  espnSportSel?.addEventListener('change', updateEspnMode);
  espnEvIdInp?.addEventListener('input', updateEspnMode);

  ov.querySelector('#m-save')?.addEventListener('click',()=>{
    const ht=document.getElementById('m-home')?.value.trim();
    const at=document.getElementById('m-away')?.value.trim();
    if(!ht||!at){showToast('Teams required','error');return;}
    const hMasc=document.getElementById('m-home-mascot')?.value.trim()||'';
    const aMasc=document.getElementById('m-away-mascot')?.value.trim()||'';
    const kr=document.getElementById('m-kickoff')?.value;
    const kickoff=kr?new Date(kr).toISOString():null;
    if(!kickoff && !game){
      if(!confirm('No kickoff date/time is set. This game will be hidden from players and shown as "pending confirmation" until you set a date. Add it anyway?')) return;
    }
    const favPick = document.getElementById('m-spread-fav')?.value || '';
    const marginRaw = document.getElementById('m-spread-margin')?.value;
    const marginVal = marginRaw !== '' && marginRaw !== undefined ? Math.abs(parseFloat(marginRaw)) : null;
    let spread = null, fav = null;
    if (favPick === 'pk') { spread = 0; fav = null; }
    else if (favPick === 'home' && marginVal !== null && !isNaN(marginVal)) { spread = -marginVal; fav = ht; }
    else if (favPick === 'away' && marginVal !== null && !isNaN(marginVal)) { spread = marginVal; fav = at; }

    // Resolve multiplier from preset or custom field
    let multiplier = 1;
    if (multPreset) {
      if (multPreset.value === 'custom') {
        const cv = Number(multCustom?.value);
        multiplier = Number.isFinite(cv) && cv > 0 ? cv : 1;
      } else {
        multiplier = Number(multPreset.value) || 1;
      }
    }
    // Protect standings: prompt before applying a multiplier change to a game
    // whose scoring has already occurred.
    if (game && gameHasScored && multiplier !== originalMultiplier) {
      const ok = confirm(
        `You're changing this game's multiplier from ${originalMultiplier}x to ${multiplier}x.\n\n` +
        `This will change standings retroactively for every player.\n\nContinue?`
      );
      if (!ok) return;
    }

    // Manual game fields
    const isManual = !!document.getElementById('m-is-manual')?.checked;
    const leagueLabel = isManual ? (document.getElementById('m-league-label')?.value.trim() || '') : '';
    const espnSport = isManual ? (document.getElementById('m-espn-sport')?.value || null) || null : null;
    // ESPN event ID: accept either the bare ID or a gamecast URL; extract the digits.
    let espnEventId = null;
    if (isManual) {
      const raw = (document.getElementById('m-espn-eventid')?.value || '').trim();
      if (raw) {
        // URLs look like https://www.espn.com/nfl/game/_/gameId/401671626
        const m = raw.match(/gameId[/=](\d+)/) || raw.match(/^(\d{6,})$/);
        espnEventId = m ? m[1] : raw;
      }
    } else {
      // Non-manual games: preserve any existing pipeline-set espnEventId
      espnEventId = game?.espnEventId || null;
    }

    const venue=document.getElementById('m-venue')?.value.trim()||null;
    const hconf=document.getElementById('m-hconf')?.value.trim()||'';
    const aconf=document.getElementById('m-aconf')?.value.trim()||'';
    const hr=parseInt(document.getElementById('m-hrank')?.value)||null;
    const ar=parseInt(document.getElementById('m-arank')?.value)||null;
    const hs=game?(document.getElementById('m-hs')?.value!==''?parseFloat(document.getElementById('m-hs')?.value):null):null;
    const as_=game?(document.getElementById('m-as')?.value!==''?parseFloat(document.getElementById('m-as')?.value):null):null;
    const status=game?document.getElementById('m-status')?.value||'scheduled':'scheduled';
    const isAlma=!!(getAlmaMaterMatch(ht,claimedAlmaMaters()) || getAlmaMaterMatch(at,claimedAlmaMaters()));
    const tw=getTimeWindow(kickoff);
    let actualWinner=null;
    if(status==='final'&&hs!==null&&as_!==null){if(hs>as_)actualWinner=ht;else if(as_>hs)actualWinner=at;}
    // Grade the game AS THE MODAL WILL SAVE IT — new teams, new scores, new
    // status, new live line — but carrying forward the EXISTING lockedSpread,
    // which this modal never edits. That matters: `calculateAtsWinner()` gives
    // the locked line precedence, so re-saving a settled game after the line
    // moved cannot rescore it. This site used to grade off `spread` directly,
    // which is exactly the mid-week rescoring lockedSpread exists to prevent.
    // A cleared spread now yields null instead of leaving the old cover behind.
    const candidate = { ...(game || {}),
      homeTeam: ht, awayTeam: at, homeScore: hs, awayScore: as_, status, spread };
    const atsWinner = calculateAtsWinner(candidate);
    onSave({homeTeam:ht,awayTeam:at,homeMascot:hMasc,awayMascot:aMasc,
      kickoff,spread,favorite:fav,venue,
      homeConference:hconf,awayConference:aconf,homeRank:hr,awayRank:ar,
      homeScore:hs,awayScore:as_,status,actualWinner,atsWinner,isAlmaMaterGame:isAlma,
      ...carryForwardBroadcastFields(game),
      multiplier, isManual, leagueLabel, espnSport, espnEventId,
      timeWindow:tw,spreadSource:'manual',dataQuality:'manual',dataSource:'manual',
      kickoffConfirmed:!!kickoff,
      lastUpdated:new Date().toISOString()});
    ov.remove();
  });
}

/**
 * The offline/fetch-failure fallback options for the alma-mater dropdown —
 * just the 6-school ALMA_MATERS catalog, shaped like fetchEspnTeamsList()'s
 * real return value so buildAlmaMaterOptions() doesn't need two code paths.
 */
function almaMaterCatalogFallback() {
  return ALMA_MATERS.map(am => ({ location: am, displayName: ALMA_MATER_DISPLAY[am] || am }));
}

/**
 * The cached ESPN team catalog for the alma-mater dropdown — IN MEMORY, for
 * the life of the page. Not localStorage, not sessionStorage, and above all
 * NOT the storage seam.
 *
 * RG-55 (2026-09-04, caught by measurement before deploy). This was
 * originally cached with `saveSetting('espnTeamsCache', …)`. That is wrong
 * three times over, and the first one is a live data-loss hazard:
 *
 *  1. `cfbp_settings` is ONE seam key → ONE Google Sheets cell.
 *     `backend/Code.gs` writes the whole JSON string into column 2
 *     (`setValues([[str, now]])` / `appendRow`) with no chunking and no size
 *     check. Sheets caps a cell at 50,000 characters. The real catalog is
 *     760 teams and serialized to 88,725 chars — 77% over on its own, and
 *     the measured blob with the rest of settings in it came to 89,148. That
 *     blob also carries `adminPasswordHash` and the site PIN, so the first
 *     commissioner to open the player editor would have pushed a write that
 *     either failed or truncated the app's own credentials. `saveSetting()`
 *     is a read-modify-write of the WHOLE blob, so it would then have stayed
 *     oversized on every later settings edit.
 *  2. It is identical on every device and re-fetches in about a second.
 *     Spending shared-Sheet budget to sync it between six phones buys
 *     nothing.
 *  3. It is third-party data, never authoritative, and safe to lose.
 *
 * Memory rather than localStorage deliberately: CLAUDE.md's "never fetch
 * localStorage directly" (AD-02) is absolute, and a first exception — even a
 * defensible one — hands the next generalist a precedent. The only thing
 * memory costs is one ~1s refetch per page load, and only for a commissioner
 * who opens the player editor. Within a session the cache still holds, which
 * is the whole property the modal wanted; almatest §16c proves a second open
 * makes zero fetch calls.
 *
 * Returns `null` (not `[]`) when nothing is cached yet, so the caller can
 * tell "never fetched" apart from "fetched, zero teams".
 */
let _espnTeamsCache = null;   // { teams: [{location, displayName}], fetchedAt } | null

function cachedEspnTeamsList() {
  return Array.isArray(_espnTeamsCache?.teams) && _espnTeamsCache.teams.length ? _espnTeamsCache.teams : null;
}

/**
 * Test-only seam, LOAD-BEARING and genuinely called (unlike
 * `_unionByIdForTest`, whose false "load-bearing" claim §6 of the ledger
 * still owes a fix — RG-27/RG-49). `_espnTeamsCache` is module state, so
 * `localStorage.clear()` no longer resets it between test sections; without
 * this, every "cold cache, so this open must fetch" precondition in
 * almatest.mjs would silently become an assumption about section ORDER.
 * Callers: almatest.mjs §16b, §16c (which contains a canary proving this
 * function actually empties the cache) and §16f.
 */
export function _resetEspnTeamsCacheForTest() { _espnTeamsCache = null; }

/**
 * Builds the alma-mater <select>'s <option> list from whichever team source
 * is available (cached ESPN catalog or the ALMA_MATERS fallback — both
 * shaped `{ location, displayName }`). VALUE is always `location` — the
 * SAME field parseAndReport() stores as game.homeTeam/awayTeam, so
 * getAlmaMaterMatch()'s exact-equality-first path applies to whatever gets
 * saved (data-model.js). LABEL is `displayName`, which disambiguates the
 * handful of teams that share an identical `location` (Charlotte,
 * Roosevelt, Troy — see fetchEspnTeamsList()'s docstring); selecting either
 * still stores the same string, a known, documented, unresolved-at-the-
 * data-level collision (see the handoff report).
 *
 * ALWAYS includes an empty "— None —" option (alma mater is optional), and
 * — critically — if `currentValue` doesn't case-insensitively match any
 * option already being offered (a legacy free-text claim, or ANY claim
 * while only the 6-school fallback is showing because ESPN is unreachable),
 * one more option for it verbatim, pre-selected. Without this, opening the
 * modal to fix an unrelated field (name/email) and hitting Save would
 * silently blank or change an existing claim the dropdown doesn't happen to
 * list — the <select> forces SOME value, and browsers default an unmatched
 * value to the first <option> if nothing is marked selected.
 */
function buildAlmaMaterOptions(currentValue, teamsList) {
  const cur = (currentValue || '').trim();
  const curLower = cur.toLowerCase();
  const sorted = [...(teamsList || [])].sort((a, b) => (a.location||'').localeCompare(b.location||''));
  const hasCurrent = !cur || sorted.some(t => (t.location||'').trim().toLowerCase() === curLower);
  const opts = [`<option value="">— None —</option>`];
  if (cur && !hasCurrent) {
    opts.push(`<option value="${escHtml(cur)}" selected>${escHtml(cur)} (current — not in ESPN list)</option>`);
  }
  for (const t of sorted) {
    const sel = cur && (t.location||'').trim().toLowerCase() === curLower ? ' selected' : '';
    opts.push(`<option value="${escHtml(t.location)}"${sel}>${escHtml(t.displayName || t.location)}</option>`);
  }
  return opts.join('');
}

export async function showEditPlayerModal(playerId) {
  const player=getPlayer(playerId); if(!player)return;
  // ESPN-canonical <select>, not free text (Drew's ruling, 2026-09-04 —
  // verbatim: "One way to protect the correct school naming (eg washington
  // vs Washington state) would be for you to either pick from an approved
  // list of schools as a drop down or for commissioner to ask to confirm
  // which school you mean when you enter it." Then: "Do the dropdown.").
  // Options come from the cached ESPN team catalog (near-static, fetched at
  // most once PER PAGE LOAD — the cache is in memory, not the storage seam;
  // see cachedEspnTeamsList()) or, if nothing is cached yet AND the
  // background refresh below fails, the 6-school ALMA_MATERS fallback.
  // A fetch failure NEVER blocks editing a player — Save always has a valid
  // option list to choose from.
  const cached = cachedEspnTeamsList();
  const initialTeamsList = cached || almaMaterCatalogFallback();
  const ov=document.createElement('div');ov.className='modal-overlay centered';
  ov.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Edit Player</h3><button class="modal-close" id="ep-c">✕</button></div>
    <div class="form-group"><label class="form-label">Display Name</label><input class="form-input" id="ep-name" value="${escHtml(player.displayName)}" /></div>
    <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="ep-email" type="email" value="${escHtml(player.email||'')}" /></div>
    <div class="form-group"><label class="form-label">Alma Mater</label>
      <select class="form-select" id="ep-alma">${buildAlmaMaterOptions(player.almaMater, initialTeamsList)}</select>
      <p class="text-muted text-xs mt-sm" id="ep-alma-note">${cached ? `From ESPN's team catalog (${cached.length} schools).` : '⏳ Loading full ESPN school list…'}</p>
    </div>
    <p class="text-muted text-xs mb-md">Name changes keep all historical picks linked to this player.</p>
    <button class="btn btn-primary btn-block" id="ep-save">Save</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#ep-c')?.addEventListener('click',()=>ov.remove());
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.querySelector('#ep-save')?.addEventListener('click',()=>{
    const n=document.getElementById('ep-name')?.value.trim();
    if(!n){showToast('Name required','error');return;}
    const newAlma=document.getElementById('ep-alma')?.value.trim()||'';
    savePlayer({...player,displayName:n,email:document.getElementById('ep-email')?.value.trim()||'',almaMater:newAlma});
    // The roster is DERIVED from claims (claimedAlmaMaters()) — a changed
    // claim must ripple to every open/upcoming week's ⭐ flag immediately,
    // the same way the old commissioner add/remove buttons used to (Drew,
    // 2026-09-04's ruling, applied to the one place claims actually change).
    const changed=recomputeAlmaMaterFlags(claimedAlmaMaters());
    showToast(`Updated ✅${changed?` — ${changed} game${changed===1?'':'s'} in open/upcoming weeks re-flagged`:''}`,'success');
    ov.remove();renderCommPage();
  });

  // Background refresh — only when nothing is cached yet. Never blocks the
  // modal or Save, and never throws out of this function: this isn't the
  // backend-sync seam AD-06 governs (a shared Sheet six people write picks
  // to) — it's a public, read-only ESPN catalog with a static fallback
  // already rendered above, so CONVENTIONS #7's "defensive at the boundary"
  // applies, not AD-06's loud-fail banner.
  if (!cached) {
    try {
      const fresh = await fetchEspnTeamsList();
      if (Array.isArray(fresh) && fresh.length) {
        // In-memory only — never through the storage seam. See
        // cachedEspnTeamsList() above for why (RG-55).
        _espnTeamsCache = { teams: fresh, fetchedAt: new Date().toISOString() };
        // The modal may already be closed/saved by the time this resolves —
        // guard every DOM touch. sel.value is READ, never reset, so a
        // selection already made (by a person or a test) survives the
        // options list being replaced underneath it.
        const sel = document.getElementById('ep-alma');
        if (sel) sel.innerHTML = buildAlmaMaterOptions(sel.value || player.almaMater, fresh);
        const note = document.getElementById('ep-alma-note');
        if (note) note.textContent = `From ESPN's team catalog (${fresh.length} schools).`;
      }
    } catch (err) {
      console.warn('[app] fetchEspnTeamsList failed, staying on the ALMA_MATERS fallback:', err.message||err);
      const note = document.getElementById('ep-alma-note');
      if (note) note.textContent = '⚠️ Could not reach ESPN — showing a short list. You can still save.';
    }
  }
}

function showResetPinModal(playerId, displayName) {
  const ov=document.createElement('div');ov.className='modal-overlay centered';
  ov.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Reset PIN — ${escHtml(displayName)}</h3><button class="modal-close" id="rp-c">✕</button></div>
    <p class="text-secondary text-sm mb-md">Set a new PIN for ${escHtml(displayName)}. This does not affect their picks.</p>
    <div class="form-group"><label class="form-label">New PIN (4–8 digits)</label>
      <input class="form-input" id="rp-pin" type="password" inputmode="numeric" maxlength="8" placeholder="e.g. 1234"
        style="letter-spacing:.2em;font-size:1.2rem" /></div>
    <div class="form-group"><label class="form-label">Confirm PIN</label>
      <input class="form-input" id="rp-pin2" type="password" inputmode="numeric" maxlength="8"
        style="letter-spacing:.2em;font-size:1.2rem" /></div>
    <button class="btn btn-primary btn-block" id="rp-save">Set PIN</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#rp-c')?.addEventListener('click',()=>ov.remove());
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
  ov.querySelector('#rp-save')?.addEventListener('click',()=>{
    const pin=document.getElementById('rp-pin')?.value;
    const pin2=document.getElementById('rp-pin2')?.value;
    if(!pin||pin.length<4){showToast('PIN must be at least 4 digits','error');return;}
    if(pin!==pin2){showToast('PINs do not match','error');return;}
    setPlayerPin(playerId,pin);
    showToast(`✅ PIN updated for ${escHtml(displayName)}`,'success');ov.remove();renderCommPage();
  });
}

// ─── RULES PAGE ───────────────────────────────────────────────────────────────

export function renderRulesPage() {
  const c=document.getElementById('page-rules'); if(!c)return;
  const rules=getSettings().customRules||DEFAULT_RULES;
  c.innerHTML=`
    <div class="section-header"><h2>How to Play</h2><div class="subtitle">Rules · FAQ · Permissions</div></div>

    <!-- v0.16.0 — What to do & when: the week lifecycle -->
    <div class="card mb-md">
      <div class="rules-section"><h3>🗓 The Week Lifecycle — what you can do &amp; when</h3>
        <div class="faq-lifecycle">
          <div class="faq-stage"><span class="badge badge-draft">DRAFT</span>
            <div><strong>Commissioner is building the slate.</strong> Players can't see or pick anything yet. Sit tight.</div></div>
          <div class="faq-stage"><span class="badge badge-open">OPEN</span>
            <div><strong>Picks are open.</strong> Log in on the Picks tab, pick all games against the spread, answer the tiebreaker, and (optionally) enter your Ischemic Extra Point guess. Submit. <em>You can come back and edit everything — picks, tiebreaker, Extra Point — as many times as you want until lock.</em> Picks are blind: nobody sees anyone else's picks until they've submitted their own.</div></div>
          <div class="faq-stage"><span class="badge badge-locked">LOCKED</span>
            <div><strong>The week has locked.</strong> No new picks, no edits — for anyone, including games that haven't kicked off yet. If you missed the deadline, that's a documented adverse event. The Commissioner can grant a per-game unlock in genuine emergencies (their call, on the record).</div></div>
          <div class="faq-stage"><span class="badge badge-live">LIVE</span>
            <div><strong>Games are being played.</strong> The Dashboard is public — everyone's picks are visible, scores stream in from ESPN, and each pick shows a soft "covering / trailing" state. Nothing is final until the game is final. This is prime chat time.</div></div>
          <div class="faq-stage"><span class="badge badge-final">FINAL</span>
            <div><strong>The week is graded.</strong> ATS results are locked against the closing spread, the tiebreaker and Extra Point resolve, standings update, and drink debts post to the ledger. The week becomes browsable read-only from the Picks tab (‹ › arrows).</div></div>
        </div>
      </div>
    </div>

    <!-- v0.16.0 — Who can do what -->
    <div class="card mb-md">
      <div class="rules-section"><h3>🔑 Permissions — who can do what</h3>
        <table class="faq-perms"><thead><tr><th></th><th>Player</th><th>Commissioner</th></tr></thead><tbody>
          <tr><td>Make / edit own picks (while OPEN)</td><td>✅</td><td>✅</td></tr>
          <tr><td>Edit picks after LOCK</td><td>❌</td><td>⚠️ per-game unlock only, logged</td></tr>
          <tr><td>See others' picks before submitting</td><td>❌ never</td><td>✅ (admin view)</td></tr>
          <tr><td>Change tiebreaker / Extra Point (while OPEN)</td><td>✅</td><td>✅</td></tr>
          <tr><td>Build the slate, set spreads, lock the week</td><td>❌</td><td>✅</td></tr>
          <tr><td>Enter/override scores &amp; the Extra Point actual</td><td>❌</td><td>✅</td></tr>
          <tr><td>Finalize the week, reopen for corrections</td><td>❌</td><td>✅</td></tr>
          <tr><td>Chat, react, reply</td><td>✅</td><td>✅</td></tr>
          <tr><td>Edit own chat message</td><td>✅ within 5 min</td><td>✅ within 5 min</td></tr>
          <tr><td>Delete own chat message</td><td>✅ (tombstone stays)</td><td>✅</td></tr>
          <tr><td>Reset PINs, manage players, exports, resets</td><td>❌</td><td>✅</td></tr>
        </tbody></table>
        <p class="text-muted text-xs mt-sm">The app never leaks picks: automated posts announce <em>that</em> you locked picks (e.g. "Kevin locked 6/6") — never <em>what</em> you picked — until lock time.</p>
      </div>
    </div>

    <!-- v0.16.0 — Extra Point -->
    <div class="card mb-md">
      <div class="rules-section"><h3>🎯 The Ischemic Extra Point (blackjack rules)</h3>
        <ul class="rules-list">
          <li>Each week, guess the <strong>longest MADE field goal on the slate</strong>, in yards.</li>
          <li><strong>Closest without going over wins.</strong> Any guess over the actual is a <strong>bust</strong> — you're out.</li>
          <li>Hit it exactly = <strong>Blackjack</strong>. Outright win, beats everything.</li>
          <li>Tied winning guesses share the win. Everyone busts → the house wins.</li>
          <li>Optional side bet — skipping it just means you can't win it. The actual is auto-detected from ESPN scoring plays and verified by the Commissioner.</li>
        </ul>
      </div>
    </div>

    <!-- v0.17.0 — Chat rules -->
    <div class="card mb-md">
      <div class="rules-section"><h3>💬 Chat</h3>
        <ul class="rules-list">
          <li><strong>One Locker Room.</strong> Everything happens in the main chat. Any message can be tagged to a game — tap 💬 on a game card and your post shows up both in that game's thread and in the Locker Room. Replies inherit the tag, so conversations stay findable. Untag with one tap if the talk drifts.</li>
          <li>React, reply, pin to the 🏛 Hall of Records, edit your own messages within 5 minutes, withdraw with a tombstone. The log is append-only.</li>
          <li>At lock, the Locker Room gets <strong>the reveal</strong> — everyone's picks posted at once. Game finals, standings, and Extra Point results file in automatically. Nothing ever leaks a pick before lock.</li>
          <li><strong>S.C.R.I.B.E. is the seventh member of this league.</strong> It keeps the receipts — lock times, bad beats, live-game swings, and who owes whom — and brings them up at the worst possible moment. It answers when you @ it. It is not summoned. It is on duty.</li>
          <li>House rule, inherited and non-negotiable: savage about football, never about real life.</li>
        </ul>
      </div>
    </div>

    <div class="card mb-md">
      ${rules.map(s=>`<div class="rules-section"><h3>${escHtml(s.section)}</h3>
        <ul class="rules-list">${s.items.map(i=>`<li>${escHtml(i)}</li>`).join('')}</ul>
      </div><div class="divider"></div>`).join('')}
      <div class="rules-section"><h3>⭐ Alma Maters</h3>
        <ul class="rules-list">${claimedAlmaMaters().map(am=>`<li>${escHtml(am)}</li>`).join('')}</ul>
      </div>
      <div class="divider"></div>
      <div class="rules-section"><h3>🍺 Debts &amp; Bylaws</h3>
        <ul class="rules-list">
          <li>Weekly loser owes the weekly winner. Season loser owes the season winner.</li>
          <li>All outstanding balances are settled <strong>IN PERSON only</strong>, per league bylaw. No exceptions, no Venmo.</li>
          <li>The ledger lives in the app. The ledger forgets nothing.</li>
        </ul>
      </div>
    </div>
    <div class="card"><h3 style="color:var(--maroon);margin-bottom:8px">📱 Install as iPhone App</h3>
      <p class="text-secondary text-sm">Open in Safari → Share → <strong>Add to Home Screen</strong>.</p>
    </div>

    <!-- Priority 13: low-profile feedback / feature-request form.
         UN-127 (item 3, 2026-08-27): submitting used to ALWAYS fire a mailto:
         — the record itself now syncs through the storage seam and is
         reviewable in the Commissioner panel (UN-123), so email is no longer
         required to "count." The checkbox below is the explicit, opt-IN,
         defaulted-OFF escape hatch for the genuinely urgent case; it does not
         remove the ability to email, it just stops forcing it every time. -->
    <!-- Build 2b, E5a (2026-09-10, UN-163): the Training-archive card, at the
         end of the Rules page per the DI — a new card, not a new nav tab, not
         posted into the Locker Room (an out-of-character report would
         collide with the locked Chat/Locker-Room split otherwise). -->
    ${renderScribeTrainingCardHTML()}

    <div class="card feedback-card">
      <h3 style="color:var(--maroon);margin-bottom:6px;font-size:.95rem">💡 Suggest a feature / report an issue</h3>
      <p class="text-muted text-xs mb-sm">Quick way to log an idea or a bug — it's recorded and the Commissioner reviews it. Auto-fills your name, the date, and the app version.</p>
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label" style="font-size:.7rem">Your name</label>
        <input class="form-input" id="fb-name" type="text" value="${escHtml(getCurrentPlayerName())}" />
      </div>
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label" style="font-size:.7rem">Description</label>
        <textarea class="form-input" id="fb-body" rows="3" placeholder="What's the request, bug, or idea?"></textarea>
      </div>
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label" style="font-size:.7rem">Type</label>
        <div class="pick-buttons" id="fb-kind-group" style="margin-top:6px">
          <button type="button" class="pick-btn" data-fb-kind="bug">🐛 Something's broken</button>
          <button type="button" class="pick-btn" data-fb-kind="feature">💡 New idea</button>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="flex gap-sm" style="align-items:center;cursor:pointer;font-size:.78rem;color:var(--text-secondary)">
          <input type="checkbox" id="fb-also-email" />
          <span>📧 Also email this to the Commissioner <span class="text-muted">— for urgent issues only</span></span>
        </label>
      </div>
      <div class="flex gap-sm flex-wrap">
        <button class="btn btn-primary btn-sm" id="fb-submit-btn">📨 Submit Feedback</button>
        <span class="text-muted text-xs" id="fb-status"></span>
      </div>
    </div>

    <div class="app-version-footer" title="Build version">
      CFB Pickems ${escHtml(APP_VERSION)} · ${escHtml(APP_VERSION_DATE)}
    </div>`;

  // Wire feedback handler (Priority 13)
  document.getElementById('fb-submit-btn')?.addEventListener('click', submitFeedback);
  bindFeedbackKindToggle();
  bindScribeReportRowHandlers();   // Build 2b, E5a
}

/**
 * UN-122 — bug/feature radio toggle for the feedback form. Same exclusivity
 * pattern as bindPickButtons()/the login player-tile grid: exactly one of the
 * two buttons carries .selected at a time, never both, never zero once
 * clicked (radio behavior, per Drew's ruling — not independent checkboxes).
 */
function bindFeedbackKindToggle() {
  document.querySelectorAll('#fb-kind-group .pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fb-kind-group .pick-btn').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });
}

/**
 * Resolve the current player's display name for pre-filling forms.
 * Returns empty string when not logged in — the user can type their name.
 */
function getCurrentPlayerName() {
  const s = getSession();
  if (!s?.playerId) return '';
  const p = getPlayer(s.playerId);
  return p?.displayName || '';
}

/**
 * Send a feedback / feature-request submission.
 * - ALWAYS writes the entry to the `cfbp_feedback` list, which syncs to the
 *   Google Sheet automatically (via the storage seam) when cloud sync is
 *   enabled, and is reviewable in the Commissioner panel (UN-123). Recording
 *   the entry IS the submission — nothing further is required for it to
 *   "count."
 * - UN-127 (item 3, 2026-08-27): the mail client only opens if the player
 *   explicitly checks "Also email this to the Commissioner" (#fb-also-email,
 *   defaulted OFF — every previous revision fired mailto: unconditionally,
 *   which is exactly what Drew's feedback asked to stop). Email is not
 *   removed as a capability, only made opt-in for the urgent case.
 */
export function submitFeedback() {
  const name = (document.getElementById('fb-name')?.value || '').trim();
  const body = (document.getElementById('fb-body')?.value || '').trim();
  const status = document.getElementById('fb-status');
  if (!body) { showToast('Please describe the request or issue first','error'); return; }
  // UN-122 (Drew's ruling) — submission is BLOCKED until Bug/New idea is
  // chosen; never silently default to 'unspecified' at entry time. That
  // label is reserved for LEGACY rows that predate this field existing
  // (CONVENTIONS #10 — default-when-missing on READ, not a write-time guess).
  const kindBtn = document.querySelector('#fb-kind-group .pick-btn.selected');
  const kind = kindBtn?.dataset.fbKind || null;
  if (!kind) { showToast('Please choose Bug or New idea first','error'); return; }
  const alsoEmail = !!document.getElementById('fb-also-email')?.checked;
  const entry = {
    id: 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    name: name || '(anonymous)',
    kind,                                          // UN-122: 'bug' | 'feature'
    weekId: getCurrentWeek()?.weekId ?? null,       // UN-123 (DI-123a)
    body,
    submittedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    siteUrl: typeof window !== 'undefined' ? (window.location.origin + window.location.pathname) : '',
  };
  // Append to local store — auto-syncs to Sheet when cloud sync is on.
  // This is the whole submission; everything below is the OPTIONAL email.
  appendFeedback(entry);
  const commEmail = (getSettings().commissionerEmail || '').trim();
  if (alsoEmail && commEmail) {
    const subject = `CFB Pickems feedback — ${entry.name}`;
    const mailBody =
      `Submitted: ${new Date(entry.submittedAt).toLocaleString()}\n` +
      `App version: ${APP_VERSION}\n` +
      `From: ${entry.name}\n` +
      `Site: ${entry.siteUrl}\n\n` +
      `${entry.body}\n`;
    const mailto = `mailto:${encodeURIComponent(commEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`;
    window.location.href = mailto;
  }
  if (status) status.textContent = !alsoEmail
    ? '✅ Saved — the Commissioner will see it in the review panel.'
    : commEmail
      ? '✅ Saved + opening mail client'
      : '✅ Saved. (No Commissioner email set yet — ask them to add one in Comm → Security.)';
  document.getElementById('fb-body').value = '';
  document.querySelectorAll('#fb-kind-group .pick-btn').forEach(b => b.classList.remove('selected'));
  const emailBox = document.getElementById('fb-also-email');
  if (emailBox) emailBox.checked = false;   // reset to the default-OFF state for the next submission
  showToast('Thanks! Feedback recorded.','success');
}

/**
 * UN-122/123 — plain-text label for a feedback entry's stored `kind`. Legacy
 * rows submitted before UN-122 shipped have no `kind` field at all — default
 * to 'Unspecified' rather than throwing (CONVENTIONS #10).
 */
function feedbackKindLabel(kind) {
  return kind === 'bug' ? 'Bug' : kind === 'feature' ? 'Feature' : 'Unspecified';
}

/** Themed badge for the on-screen admin list — reuses .badge-loss/.badge-win
 *  exactly as they already read elsewhere (loss=red for "something's wrong",
 *  win=green for "new idea"); .badge-draft (the existing neutral badge) for
 *  legacy rows with no kind on record. */
function feedbackKindBadgeHTML(kind) {
  if (kind === 'bug') return '<span class="badge badge-loss">🐛 Bug</span>';
  if (kind === 'feature') return '<span class="badge badge-win">💡 Idea</span>';
  return '<span class="badge badge-draft">❔ Unspecified</span>';
}

/**
 * UN-123 — commissioner Data-tab review list, newest first. Row pattern
 * mirrors renderObligationsAdmin(). Accepts an optional entries array so
 * loadtest.mjs can exercise legacy-row defaulting directly, without seeding
 * storage; the production call site (renderFeedbackAdminSectionHTML) uses no
 * argument and reads live storage.
 */
export function renderFeedbackAdmin(entries = getFeedback()) {
  const sorted = entries.slice().sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  if (!sorted.length) return '<p class="text-muted text-sm">No feedback submitted yet.</p>';
  // Item 10 (DI-B1) — copy is EXACT, per the approved design input.
  const helpNote = `<p class="text-muted text-xs" style="margin:0 0 6px">Uncheck an item to leave it out of the next CSV export. Your selection is remembered.</p>`;
  const rows = sorted.map(e => {
    const w = e.weekId ? getWeek(e.weekId) : null;
    const weekLabel = e.weekId ? (formatWeekLabel(w) || e.weekId) : '—';
    // Guarded for VALIDITY, not just presence: a legacy or hand-edited row with
    // an unparseable timestamp used to print the literal "Invalid Date" here.
    // Falls back to the same em-dash a missing timestamp already produced.
    const submitted = e.submittedAt ? new Date(e.submittedAt) : null;
    const date = (submitted && !Number.isNaN(submitted.getTime()))
      ? submitted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    // Truncate ONLY here (display). The CSV export never truncates — Drew's
    // stated purpose is feeding the full text to a coding agent months later.
    const preview = e.body && e.body.length > 240 ? e.body.slice(0, 240) + '…' : (e.body || '');
    // DEFAULT INCLUDED (CONVENTIONS #10): absence from the excluded-id set —
    // true for every legacy row and every freshly submitted one — checks the
    // box. Only an explicit prior uncheck (isFeedbackExcluded) unchecks it.
    const included = !isFeedbackExcluded(e.id);
    // Padded ≥40px tap target (CONVENTIONS #17) — the bare obcorr-check
    // checkbox this is modeled on sits UNDER the floor; a <label> wrapping the
    // input gives the whole padded box native click-to-toggle behavior with no
    // extra JS. .fb-excl-check-wrap carries the padding (styles.css).
    const checkbox = `<label class="fb-excl-check-wrap" title="${included ? 'Included in CSV export' : 'Excluded from CSV export'}">
        <input type="checkbox" class="fb-excl-check" data-fb-id="${escHtml(e.id || '')}" ${included ? 'checked' : ''} />
      </label>`;
    return `<div class="flex gap-sm" style="padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start">
      ${checkbox}
      <div style="flex:1">
        <div class="text-sm"><strong>${escHtml(e.name || '(anonymous)')}</strong> ${feedbackKindBadgeHTML(e.kind)}
          <span class="text-xs text-muted"> · ${escHtml(weekLabel)} · ${escHtml(date)} · v${escHtml(e.appVersion || '?')}</span></div>
        <div class="text-xs text-secondary" style="margin-top:4px;white-space:pre-wrap">${escHtml(preview)}</div>
      </div>
    </div>`;
  }).join('');
  return helpNote + rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Build 2b — SCRIBE Trainer (E3-E5, 2026-09-10, UN-161…163)
// ═══════════════════════════════════════════════════════════════════════════

// §8's exact section order + product-language labels, mirroring
// backend/Code.gs's SCRIBE_REPORT_SECTION_ORDER_ constant (kept in sync BY
// HAND, same cross-runtime obligation as every other client/server
// contract). Declared once so the archive modal and any future caller read
// the SAME list rather than a second hand-typed copy.
const SCRIBE_REPORT_SECTIONS = [
  ['dataset', 'Dataset'],
  ['what_landed', 'What landed'],
  ['what_missed', 'What missed'],
  ['what_scribe_learned', 'What SCRIBE learned'],
  ['changes_being_tested', 'Changes being tested'],
  ['feedback_not_adopted', 'Feedback that was not adopted'],
  ['what_we_need_more_data_on', 'What we need more data on'],
];

/**
 * E5a — "SCRIBE Training" card, Rules page. Reverse-chronological archive of
 * `getScribeReports()`; each row opens the full §8-format report in a
 * `.modal.centered` (verbatim reuse — see `openScribeReportModal` below,
 * wired from `renderRulesPage()`). Exported pure HTML (no DOM), same
 * testability reasoning as `renderFeedbackAdminSectionHTML`/
 * `renderCommExtraPointCardHTML`.
 */
export function renderScribeTrainingCardHTML() {
  const reports = getScribeReports();
  if (!reports.length) {
    return `
    <div class="card mb-md">
      <div class="rules-section"><h3>🧠 SCRIBE Training</h3>
        <p class="text-muted text-sm">Nothing yet — this fills in once the first training pass runs.</p>
      </div>
    </div>`;
  }
  // Oldest-first as stored (scribeSaveReports_ appends) — reverse for display.
  const rows = reports.slice().reverse().map((r, revIdx) => {
    const idx = reports.length - 1 - revIdx;   // real index into getScribeReports()
    const dateLabel = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '(undated)';
    return `<button type="button" class="scribe-report-row" data-scribe-report-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;width:100%;min-height:44px;padding:10px 4px;border:none;border-bottom:1px solid var(--border);background:none;text-align:left;cursor:pointer;color:inherit;font:inherit">
      <span>Training Report — ${escHtml(dateLabel)}</span><span class="text-muted">›</span>
    </button>`;
  }).join('');
  return `
    <div class="card mb-md">
      <div class="rules-section"><h3>🧠 SCRIBE Training</h3>
        <p class="text-muted text-xs mb-sm">A plain-language, out-of-character account of what your ratings, rewrites, and 👁 weigh-ins have actually changed. Not a normal SCRIBE post — this is the system talking, not SCRIBE.</p>
        <div class="scribe-report-list">${rows}</div>
      </div>
    </div>`;
}

/** Full §8-order report body for the archive modal — used by both the
 *  modal opener below AND loadtest.mjs's structural section-order assertion. */
export function renderScribeReportBodyHTML(entry) {
  const report = (entry && entry.report) || {};
  return SCRIBE_REPORT_SECTIONS.map(([key, label]) =>
    `<div class="mb-md"><div class="card-title mb-sm">${escHtml(label)}</div><p class="text-sm" style="white-space:pre-wrap">${escHtml(String(report[key] || '(nothing recorded for this section)'))}</p></div>`
  ).join('');
}

function openScribeReportModal(entry) {
  if (!entry) return;
  const dateLabel = entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '(undated)';
  const ov = document.createElement('div'); ov.className = 'modal-overlay centered';
  ov.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>Training Report — ${escHtml(dateLabel)}</h3><button class="modal-close" id="scribe-report-close">✕</button></div>
    ${renderScribeReportBodyHTML(entry)}
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#scribe-report-close')?.addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

/** Wired from `renderRulesPage()` — event delegation over the archive list,
 *  since rows are re-rendered on every page open (same pattern the feedback
 *  form's handlers use, just delegated instead of per-row bound). */
function bindScribeReportRowHandlers() {
  document.querySelectorAll('.scribe-report-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.scribeReportIdx);
      openScribeReportModal(getScribeReports()[idx]);
    });
  });
}

/**
 * The approve/reject status flip, factored out of its click handler for the
 * same reason the dial writes were (groupdtest.mjs drives the real one).
 *
 * Build 3, Group D (2026-09-11, DI-D2 population path 3) — approving a FACT
 * CANDIDATE is only half of the contract. The Trainer writes fact candidates
 * into KEYS.SCRIBE_LEARNINGS as `pending`; flipping one to `approved` here
 * changes a status and nothing else, and SCRIBE still cannot see the fact.
 * `scribeMemorySync` is what moves every approved, not-yet-applied candidate
 * into CFBP_SCRIBE_MEMORY. Fired from here so approval is ONE action rather
 * than two, per the DI's "automatic on approve" — and fired ONLY for a
 * fact_candidate, because no other kind has anything to apply.
 *
 * Fire-and-forget by design: the status flip has already persisted through
 * the seam, so the sync's outcome is reported by its own toast rather than
 * holding the UI.
 */
export function applyScribeLearningDecision(idx, approved) {
  const all = getScribeLearnings();
  if (!all[idx]) return { ok: false, error: 'no_such_row' };
  const row = all[idx];
  all[idx] = { ...row, status: approved ? 'approved' : 'rejected' };
  setScribeLearnings(all);
  const synced = !!(approved && row.kind === 'fact_candidate');
  if (synced) syncApprovedScribeFacts();
  return { ok: true, approved: !!approved, synced, kind: row.kind };
}

/**
 * DI-D2 — "apply approved facts." Fire-and-forget, toast on the result.
 *
 * Deliberately NOT password-prompted, unlike "Run Trainer now" right beside
 * it. That prompt exists because a Trainer run SPENDS REAL MONEY at Anthropic
 * (reviewer SIGNIFICANT #8); this action makes no model call at all — it
 * copies already-approved rows from one server-side store into another and
 * refreshes the deterministic computed facts. It is idempotent twice over
 * (the upsert collapses on (playerId,kind,key); an applied candidate is
 * stamped `memoryAppliedAt`), so a double-tap reports `applied: 0` rather
 * than writing anything twice.
 *
 * The credential it does send is the hash already sitting in the settings
 * blob every device hydrates — so passing it here exposes nothing that was
 * not already on every player's device (AD-05's same honest scope). The
 * server still requires it, which keeps a stale/mis-wired client from
 * triggering the sweep.
 *
 * Exported for groupdtest.mjs: the assertion that approving a fact candidate
 * fires this EXACTLY once needs the real function, not a look-alike.
 */
export async function syncApprovedScribeFacts() {
  try {
    const r = await scribeMemoryTransport.sync({ adminPasswordHash: getSettings().adminPasswordHash || '' });
    if (r && r.ok === false) throw new Error(r.error || 'sync failed');
    const applied = Number(r && r.applied) || 0;
    showToast(applied
      ? `🧠 ${applied} approved fact${applied === 1 ? '' : 's'} now in SCRIBE's memory`
      : "🧠 Nothing new to apply. SCRIBE's memory is already current", 'success');
    return r;
  } catch (err) {
    // Loud, never silent (AD-06's instinct on a commissioner action): the
    // status flip above already persisted, so the honest message is "the
    // approval saved, the sync did not."
    console.warn('[scribe-memory] sync failed', err);
    showToast(`⚠️ Approved, but applying it to SCRIBE's memory failed: ${err && err.message ? err.message : err}`, 'error');
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * DI-D1 — the two writes behind the dial, factored out of the click handlers
 * so groupdtest.mjs drives the REAL write path (a handler bound inside
 * renderCommPanel() cannot be reached without a live DOM, which is exactly
 * the RG-27 shape where a test ends up asserting against a look-alike).
 *
 * Both go through `saveSetting()` — the storage seam (CONVENTIONS #8), which
 * also DECLARES the changed field so the bounded-size push cannot send a
 * stale whole-blob over a fresh remote (RG-24/RG-49/RG-55).
 *
 * `setScribeFrequency` refuses an unknown level rather than storing it: an
 * unrecognized value makes `scoreOpportunity()` fall back to Balanced
 * silently, which reads to a commissioner as "the dial does nothing."
 */
export function setScribeFrequency(level) {
  const lvl = String(level || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FREQUENCY_LEVELS, lvl)) return { ok: false, error: 'unknown_level' };
  saveSetting('scribeFrequency', lvl);
  return { ok: true, level: lvl };
}
export function setScribeAutonomousEnabled(on) {
  saveSetting('scribeAutonomousEnabled', !!on);
  return { ok: true, enabled: !!on };
}

/**
 * DI-D1 — the frequency dial, Comm → Settings.
 *
 * INCLUDING its own `data-comm-tab="settings"` wrapper (RG-10: an untagged
 * `.admin-section` renders on all five commissioner tabs), and exported as a
 * pure HTML function for the same reason renderFeedbackAdminSectionHTML() is
 * — so groupdtest.mjs can assert the wrapper, the five options and the
 * selected state in RENDERED OUTPUT, not by grepping source.
 *
 * Drew's D-1 ruling OVERRIDES the design input's own recommendation: the DI
 * proposed exposing three levels and hiding Reserved/Unhinged in the data
 * model; Drew ruled "Expose all 5." Copy is FINAL, from
 * SCRIBE_COPY_GROUP_D_091126.md §5, imported from js/scribeLines.js
 * (FREQUENCY_COPY) rather than retyped here.
 *
 * TWO controls, matching DI-D1's two states:
 *   OFF  — `settings.scribeAutonomousEnabled = false`. Autonomous
 *          interjections stop entirely; a direct @SCRIBE question still gets
 *          answered (Group C's path, deliberately unaffected — which is
 *          exactly what the copy promises).
 *   SET  — one of the five levels in `settings.scribeFrequency`, which is a
 *          threshold on a 0–100 opportunity score (FREQUENCY_LEVELS).
 *
 * Both are ordinary settings through the seam (`saveSetting`, CONVENTIONS #8
 * — which also declares the changed field for the bounded-size push, RG-55).
 * Neither is authoritative: backend/Code.gs's SCRIBE_AUTONOMOUS_ENABLED
 * Script Property is the real switch and defaults OFF, so nothing here can
 * turn autonomy on by itself.
 */
export function renderScribeParticipationCardHTML() {
  const on = isScribeAutonomousEnabled();
  const current = String(getScribeFrequency() || FREQUENCY_DEFAULT).toLowerCase();
  const level = Object.prototype.hasOwnProperty.call(FREQUENCY_LEVELS, current) ? current : FREQUENCY_DEFAULT;
  const options = FREQUENCY_COPY.map(o => `
        <button class="scribe-freq-opt${o.level === level ? ' selected' : ''}" data-scribe-freq="${o.level}"
                role="radio" aria-checked="${o.level === level ? 'true' : 'false'}">
          <span class="scribe-freq-label">${escHtml(o.label)}</span>
          <span class="scribe-freq-desc">${escHtml(o.description)}</span>
        </button>`).join('');
  return `
    <div class="admin-section" data-comm-tab="settings">
      <div class="admin-section-title">🎚 SCRIBE Participation</div>
      <div class="card mb-md" id="comm-scribe-participation-card">
        <p class="text-muted text-xs mb-sm">How often SCRIBE jumps into the conversation on its own. Direct @SCRIBE questions always get answered regardless of this setting.</p>
        <label class="notif-prefs-row notif-prefs-master" for="scribe-autonomous-toggle">
          <span>SCRIBE joins in on its own</span>
          <input type="checkbox" id="scribe-autonomous-toggle" ${on ? 'checked' : ''} />
        </label>
        <div class="scribe-freq-dial${on ? '' : ' notif-prefs-row-dim'}" role="radiogroup" aria-label="SCRIBE participation level">${options}</div>
        <p class="text-muted text-xs">${on
          ? `Currently <strong>${escHtml((FREQUENCY_COPY.find(o => o.level === level) || {}).label || level)}</strong> — a candidate moment has to score ${FREQUENCY_LEVELS[level]} or better before SCRIBE writes anything. The 10-minute cooldown applies at every level.`
          : 'Off. SCRIBE posts nothing unprompted — pick a level after turning it back on.'}</p>
      </div>
    </div>`;
}

/**
 * E5b — Comm→Data metrics + approve/reject card. Metrics are the SNAPSHOT
 * stored with the most recent report (`entry.metrics`) — never an
 * independent recompute (CONVENTIONS #21's render-path-consistency spirit
 * applied to this new surface; the "as of" stamp is the actual point of
 * this design, per the DI). Approve/reject rows cover all four pending item
 * kinds — learning, experiment, fact_candidate (all three live in
 * `getScribeLearnings()`), and canon (its own key).
 */
export function renderScribeTrainerAdminSectionHTML() {
  const reports = getScribeReports();
  const latest = reports.length ? reports[reports.length - 1] : null;
  const learnings = getScribeLearnings();
  const canon = getScribeCanon();
  const activeCtx = getActiveContext();

  const metricsBlock = latest ? `
    <div class="stat-grid mb-sm" style="display:flex;flex-wrap:wrap;gap:16px">
      <div><div style="font-size:1.3rem;font-weight:700;color:var(--maroon)">${latest.metrics.humanMessagesPerInterjection == null ? 'n/a' : latest.metrics.humanMessagesPerInterjection.toFixed(2)}</div><div class="text-muted text-xs">human msgs / SCRIBE interjection</div></div>
      <div><div style="font-size:1.1rem;font-weight:600">${latest.metrics.ratingMix.hit}% / ${latest.metrics.ratingMix.mid}% / ${latest.metrics.ratingMix.tooMuch}%</div><div class="text-muted text-xs">Hit / Mid / Too Much</div></div>
      <div><div style="font-size:1.1rem;font-weight:600">${latest.metrics.rewriteCount}</div><div class="text-muted text-xs">rewrites this season</div></div>
      <div><div style="font-size:1.1rem;font-weight:600">${activeCtx.activeLearnings.length + activeCtx.canonExamples.length}</div><div class="text-muted text-xs">active right now</div></div>
    </div>
    ${latest.metrics.perPlayerHints.length ? `<ul class="rules-list text-xs">${latest.metrics.perPlayerHints.map(h => `<li>${escHtml(h)}</li>`).join('')}</ul>` : ''}
    <p class="text-muted text-xs">as of ${escHtml(new Date(latest.metrics.asOf || latest.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>
  ` : `<p class="text-muted text-sm">No Trainer run yet — click "Run Trainer now" to produce the first snapshot.</p>`;

  const pendingLearningRows = learnings.map((l, idx) => ({ l, idx }))
    .filter(x => x.l.status === 'pending' && (x.l.kind === 'learning' || x.l.kind === 'experiment' || x.l.kind === 'fact_candidate'))
    .map(({ l, idx }) => {
      let label;
      if (l.kind === 'learning') label = `<strong>[learning/${escHtml(l.category)}]</strong> ${escHtml(l.instruction)} <span class="text-muted text-xs">(confidence ${l.confidence})</span>`;
      else if (l.kind === 'experiment') label = `<strong>[experiment]</strong> ${escHtml(l.experiment)} — ${escHtml(l.reason)} <span class="text-muted text-xs">(confidence ${l.confidence})</span>`;
      else label = `<strong>[fact candidate]</strong> ${escHtml(l.playerId)} · ${escHtml(l.key)}: ${escHtml(l.value)} <span class="text-muted text-xs">(confidence ${l.confidence})</span>`;
      return `<div class="flex-between" style="gap:8px;padding:8px 0;border-bottom:1px solid var(--border);align-items:center">
        <div class="text-sm" style="flex:1">${label}</div>
        <div class="flex gap-sm">
          <button class="btn btn-secondary btn-sm scribe-approve-btn" data-learning-idx="${idx}">✅ Approve</button>
          <button class="btn btn-ghost btn-sm scribe-reject-btn" data-learning-idx="${idx}">✖ Reject</button>
        </div>
      </div>`;
    }).join('');

  const pendingCanonRows = canon.map((c, idx) => ({ c, idx })).filter(x => x.c.approvalStatus === 'pending')
    .map(({ c, idx }) => `<div class="flex-between" style="gap:8px;padding:8px 0;border-bottom:1px solid var(--border);align-items:center">
      <div class="text-sm" style="flex:1"><strong>[canon]</strong> ${escHtml(c.contextSummary)} → "${escHtml(c.preferredResponse)}" <span class="text-muted text-xs">(confidence ${c.confidence})</span></div>
      <div class="flex gap-sm">
        <button class="btn btn-secondary btn-sm scribe-canon-approve-btn" data-canon-idx="${idx}">✅ Approve</button>
        <button class="btn btn-ghost btn-sm scribe-canon-reject-btn" data-canon-idx="${idx}">✖ Reject</button>
      </div>
    </div>`).join('');

  const pendingHTML = (pendingLearningRows || pendingCanonRows)
    ? `<div class="divider"></div><div class="card-title mb-sm">Pending review</div>${pendingLearningRows}${pendingCanonRows}`
    : `<div class="divider"></div><p class="text-muted text-xs">Nothing pending review.</p>`;

  return `
    <div class="admin-section" data-comm-tab="data">
      <div class="admin-section-title">🧠 SCRIBE Training</div>
      <div class="card">
        <div class="flex-between mb-sm" style="align-items:flex-start;gap:8px">
          <p class="text-muted text-xs" style="margin:0">Periodic snapshot, not live — see the "as of" stamp below. ≥0.9-confidence learnings/Canon auto-apply; everything else waits here.</p>
          <button class="btn btn-primary btn-sm" id="scribe-run-trainer-btn">▶ Run Trainer now</button>
        </div>
        ${metricsBlock}
        ${pendingHTML}
      </div>
    </div>`;
}

/**
 * UN-123 — the whole Data-tab feedback card, INCLUDING its
 * data-comm-tab="data" wrapper (RG-10: an untagged admin-section renders on
 * all five tabs). Exported as its own HTML-returning function — not just
 * referenced inline from renderCommPanel — so loadtest.mjs can assert the
 * wrapper is actually present in rendered markup, not merely mentioned
 * somewhere in source (the anti-pattern that let RG-12 recur).
 */
export function renderFeedbackAdminSectionHTML() {
  return `
    <div class="admin-section" data-comm-tab="data">
      <div class="admin-section-title">🗣 Feedback &amp; Bug Reports</div>
      <div class="card">
        <div class="flex-between mb-sm" style="align-items:flex-start;gap:8px">
          <p class="text-muted text-xs" style="margin:0">Everything submitted from the Rules tab's feedback box, newest first.</p>
          <button class="btn btn-secondary btn-sm" id="export-feedback-csv-btn">📥 Feedback CSV</button>
        </div>
        <div class="feedback-admin-list">${renderFeedbackAdmin()}</div>
      </div>
    </div>`;
}

// ─── v0.16.0 COMMISSIONER EXTRAS (Extra Point + Chat / SCRIBE) ────────────────

/**
 * The commissioner panel's Ischemic Extra Point card, INCLUDING its
 * data-comm-tab="week" wrapper (RG-10).
 *
 * WHY THIS IS EXPORTED, and why it is a separate function at all: it is the
 * test seam for the blind rule on this surface. `renderCommExtrasV16()` starts
 * with `document.getElementById('page-commissioner')`, which returns null under
 * the loadtest DOM stub, so the whole function early-returns and nothing it
 * builds can be asserted on. The only remaining way to test what this card
 * DISCLOSES would be to grep app.js for the gate — which is precisely the
 * RG-27 false-coverage anti-pattern that let RG-12 recur: a test that passes
 * when the guard is reverted. Same reason `renderDashboardTable()` and
 * `renderFeedbackAdminSectionHTML()` are exported. Pure: string in, string out,
 * no DOM. Asserted in loadtest [34i].
 */
export function renderCommExtraPointCardHTML(week) {
  if (!week) return '';
  // RG-40 — THE SAME LEAK AS RG-37, ONE SURFACE OVER. This block printed every
  // active player's Extra Point guess in plaintext, gated only on
  // `session.isAdmin`, with no blind check at all. Drew is BOTH commissioner
  // and player: on an OPEN week he read all five rivals' guesses while his own
  // was still editable. Extra Point is blackjack — knowing the field is more
  // decisive than knowing a single ATS pick, because you can sit one yard under
  // whoever is highest and take the whole table.
  //
  // It asks canViewOtherPicks() — the SAME predicate the dashboard, the compact
  // view and the score summary ask. Not a copy of its logic. Nine drifted
  // longhand copies of the blind rule is what produced the original leak
  // (UN-116), and the entire point of arePicksPublic()/canViewOtherPicks() is
  // that this rule has exactly one definition. A second surface with its own
  // idea of "public" is the next RG row.
  //
  // Own guess stays visible: the commissioner is a player too and needs to see
  // what he entered. Only rivals blind, and only while someone can still act.
  const canSeeOthers = canViewOtherPicks(week);
  const myId = getSession().playerId;
  const detect = week.extraPointDetect;
  // The graded preview prints every entrant's guess beside their outcome, so it
  // is the same disclosure through a second door. `extraPointActual` is a plain
  // commissioner-entered number with no status gate on its input, so a week
  // that is still open CAN carry one. Suppressed on the same rule — which also
  // removes the "Post result to chat" button, correctly: a chat post is a
  // deterministic-id event that can never be retracted (AD-26), and posting
  // results for a week nobody is allowed to see yet is the worst version of
  // this bug, not a lesser one.
  const graded = (canSeeOthers && week.extraPointActual != null)
    ? gradeWeekExtraPoint(week, getPlayers().filter(p=>p.active))
    : null;
  const guesses = getPlayers().filter(p=>p.active).map(p => {
    if (!canSeeOthers && p.playerId !== myId) {
      return `<span class="ep-admin-guess ep-admin-guess-blind">${escHtml(p.displayName)}: <strong title="Hidden until the games kick off">•••</strong></span>`;
    }
    const g = getExtraPointGuess(week.weekId, p.playerId);
    return `<span class="ep-admin-guess">${escHtml(p.displayName)}: <strong>${g == null ? '—' : g + ' yd'}</strong></span>`;
  }).join(' ');
  const blindNote = canSeeOthers ? '' :
    '<p class="text-muted text-xs" style="margin:4px 0 0">Other players\' guesses stay hidden until kickoff — yours is still editable.</p>';

  return `
    <div class="admin-section" data-comm-tab="week">
    <div class="card mb-md" id="comm-ep-card">
      <h3 style="color:var(--maroon)">🎯 Ischemic Extra Point — ${escHtml(formatWeekLabel(week))}</h3>
      <p class="text-muted text-xs">Longest made FG on the slate, blackjack rules. Detect pulls per-game scoring plays from ESPN; you can always override manually.</p>
      <div class="mb-sm"><label class="form-label" style="font-size:.7rem">Guesses on file</label><div class="ep-admin-guesses">${guesses || '<span class="text-muted">none yet</span>'}</div>${blindNote}</div>
      <div class="flex gap-sm flex-wrap mb-sm">
        <button class="btn btn-secondary btn-sm" id="ep-detect-btn">🛰 Detect Longest FG (ESPN)</button>
        <span class="text-muted text-xs" id="ep-detect-status">${detect ? escHtml(`${detect.yards} yd — ${detect.text || ''} (${detect.matchup || ''})`) : ''}</span>
      </div>
      <div class="flex gap-sm flex-wrap" style="align-items:flex-end">
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label" style="font-size:.7rem">Actual longest FG (yards)</label>
          <input class="form-input" id="ep-actual-input" type="number" min="15" max="75" style="width:110px"
            value="${week.extraPointActual != null ? week.extraPointActual : ''}" />
        </div>
        <button class="btn btn-primary btn-sm" id="ep-save-btn">Save &amp; Grade</button>
        ${graded ? '<button class="btn btn-ghost btn-sm" id="ep-post-btn">📣 Post result to chat</button>' : ''}
      </div>
      <div id="ep-graded-preview">${graded ? renderExtraPointResultsHTML(week, graded, escHtml) : ''}</div>
    </div>
    </div>`;
}

function renderCommExtrasV16(week, games) {
  // v0.17.0 FIX — these cards previously appended UNWRAPPED to the page
  // container, so they showed on EVERY comm tab and after the demo panel.
  // Now: Extra Point lives in the Week tab (inserted BEFORE Demo Simulation,
  // which stays last per league preference); Chat & SCRIBE lives in Settings.
  const c = document.getElementById('page-commissioner'); if (!c || !week) return;
  const session = getSession();
  if (!session.isAdmin) return;

  const epHTML = renderCommExtraPointCardHTML(week);
  // Insert the Extra Point card BEFORE the Demo Simulation section so the demo
  // panel remains the LAST item in the Week tab.
  const demoSection = [...c.querySelectorAll('.admin-section[data-comm-tab="week"]')]
    .find(s => s.textContent.includes('Demo Simulation'));
  if (demoSection) demoSection.insertAdjacentHTML('beforebegin', epHTML);
  else c.insertAdjacentHTML('beforeend', epHTML);

  {
    // Item A — commissioner chat on/off toggle. Placement: TOP of this
    // existing card (RG-10: inside data-comm-tab="settings"), not a new
    // card — a master on/off switch belongs above the features it governs.
    const chatOn = isChatEnabled();
    // Items E/F re-review close-out (2026-09-10) — two approved pilot
    // settings with no commissioner UI: `scribeFeedbackEnabled` (UN-159 D5)
    // and `chatImagePreviewEnabled` (UN-164 F4-interim). Both already have
    // safe defaults in data-model.js DEFAULT_SETTINGS. Placed with the
    // master chatEnabled toggle (RG-10: inside this data-comm-tab="settings"
    // container), each row padded to a ≥44px tap target — the better
    // precedent (.notif-prefs-row, css/styles.css) rather than chatEnabled's
    // own bare padding-bottom-only row above, which this pass leaves as-is.
    const scribeFeedbackOn = isScribeFeedbackEnabled();
    const imagePreviewOn = isChatImagePreviewEnabled();
    // Build 2, Group C (2026-09-10, UN-150…154) — the two client-visible
    // convenience gates for the interactive (LLM-backed) @SCRIBE runtime.
    // Placed with the other pilot toggles in this SAME card (RG-10). The
    // AUTHORITATIVE gate is server-side (SCRIBE_INTERACTIVE_ENABLED /
    // SCRIBE_WEB_SEARCH_ENABLED Script Properties, backend/Code.gs) — these
    // only save a wasted round trip when SCRIBE is known to be off here.
    const scribeInteractiveOn = isScribeInteractiveEnabled();
    const scribeWebSearchOn = isScribeWebSearchEnabled();
    // Build 2b, E4 (2026-09-10, UN-162) — the fast "something just made
    // SCRIBE noticeably worse, stop it NOW" emergency stop, separate from
    // the per-learning approve/reject granularity (Comm→Data). This is
    // client-visible AND authoritative (unlike the two above, whose real
    // gate is server-side): Code.gs reads this SAME `cfbp_settings` blob
    // directly (scribeLearningsEnabled_()), no Script Property involved.
    const scribeLearningsOn = isScribeLearningsEnabled();
    c.insertAdjacentHTML('beforeend', `
    <div class="admin-section" data-comm-tab="settings">
    <div class="card mb-md" id="comm-chat-card">
      <h3 style="color:var(--maroon)">📋 Chat &amp; S.C.R.I.B.E.</h3>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="chat-enabled-toggle" ${chatOn ? 'checked' : ''} />
        <span class="form-label" style="margin:0">Chat enabled</span>
      </label>
      <p class="text-muted text-xs mb-sm">${chatOn
        ? 'Players can see and use chat. Turn off to hide it league-wide while you work on it.'
        : 'Chat is hidden for everyone. Nothing is deleted — history returns when you turn it back on. Polling is stopped.'}</p>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:11px 0;min-height:44px;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="scribe-feedback-toggle" ${scribeFeedbackOn ? 'checked' : ''} />
        <span>
          <span class="form-label" style="margin:0;display:block">SCRIBE feedback buttons (pilot)</span>
          <span class="text-muted text-xs" style="display:block">Shows the Rate/Flag controls on chat messages for the six training players. Turn off to retire the pilot instrumentation.</span>
        </span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:11px 0;min-height:44px;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="chat-image-preview-toggle" ${imagePreviewOn ? 'checked' : ''} />
        <span>
          <span class="form-label" style="margin:0;display:block">Show image previews in chat</span>
          <span class="text-muted text-xs" style="display:block">Renders a pasted image link inline. Off by default — the image host can see who views it.</span>
        </span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:11px 0;min-height:44px;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="scribe-interactive-toggle" ${scribeInteractiveOn ? 'checked' : ''} />
        <span>
          <span class="form-label" style="margin:0;display:block">SCRIBE answers @mentions (interactive, LLM-backed)</span>
          <span class="text-muted text-xs" style="display:block">Lets a direct @SCRIBE question get a real, tool-grounded answer instead of only the canned reply. Costs real money per question — see backend/Code.gs for the Script Property spend caps and kill switch. Off here just saves a round trip; the server's own switch is authoritative.</span>
        </span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:11px 0;min-height:44px;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="scribe-websearch-toggle" ${scribeWebSearchOn ? 'checked' : ''} />
        <span>
          <span class="form-label" style="margin:0;display:block">SCRIBE can search the web (starters, injuries, rankings, news)</span>
          <span class="text-muted text-xs" style="display:block">Only matters when the toggle above is on. The most expensive tool call in the system — turn off to prove out cost on score/spread/league questions first.</span>
        </span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:11px 0;min-height:44px;margin-bottom:10px;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="scribe-learnings-toggle" ${scribeLearningsOn ? 'checked' : ''} />
        <span>
          <span class="form-label" style="margin:0;display:block">SCRIBE Trainer learnings active</span>
          <span class="text-muted text-xs" style="display:block">Lets commissioner-approved Trainer learnings and Canon examples reach SCRIBE's live replies. Turn off to run on the base persona alone — an emergency stop, separate from approving/rejecting individual learnings (Comm→Data).</span>
        </span>
      </label>
      <div class="divider"></div>
      <p class="text-muted text-xs">Tier 0 (deterministic lines) runs automatically with rate limits. Tier 1 lets you paste a reviewed batch of SCRIBE posts. The digest feeds recap generation.</p>
      <div class="flex gap-sm flex-wrap mb-sm">
        <button class="btn btn-secondary btn-sm" id="chat-digest-btn">📤 Copy weekly digest JSON</button>
        <span class="text-muted text-xs" id="chat-digest-status"></span>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size:.7rem">SCRIBE queue (Tier 1) — paste JSON: [{"channel":"general","body":"…","postAt":"2026-08-29T18:00Z"}]</label>
        <textarea class="form-input" id="scribe-queue-input" rows="3" placeholder='[{"channel":"general","body":"Week 4 is open. Do better."}]'></textarea>
      </div>
      <div class="flex gap-sm flex-wrap mb-sm">
        <button class="btn btn-primary btn-sm" id="scribe-queue-btn">Post queue as SCRIBE</button>
        <span class="text-muted text-xs" id="scribe-queue-status"></span>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size:.7rem">Season recap blurb (shows on Week 1 under "The Permanent Record")</label>
        <textarea class="form-input" id="season-recap-input" rows="3">${escHtml(getSettings().seasonRecapText || '')}</textarea>
      </div>
      <button class="btn btn-secondary btn-sm" id="season-recap-save">Save blurb</button>
      <div class="divider"></div>
      <div class="mb-sm"><strong style="font-size:.8rem">🩺 Chat diagnostics</strong>
        <p class="text-muted text-xs">Tests the deployed Apps Script for the chat endpoints — the v0.16 outage was an out-of-date deployment, which this detects in one click.</p>
        <div class="flex gap-sm flex-wrap">
          <button class="btn btn-secondary btn-sm" id="chat-diag-btn">Run test</button>
          <span class="text-muted text-xs" id="chat-diag-out"></span>
        </div>
      </div>
      <div class="mb-sm"><strong style="font-size:.8rem">📈 Backend load (last 7 days)</strong>
        <div id="chat-metrics-out" class="text-muted text-xs">—</div>
      </div>
    </div>
    </div>`);
    // Build 3, Group D (2026-09-11, DI-D1) — the frequency dial, its OWN
    // card directly beneath "Chat & S.C.R.I.B.E." on the SAME Settings tab.
    // A separate card (not another row inside the one above) because the DI
    // specifies a labeled control with five described options, which is a
    // different shape from that card's list of on/off toggles. Its
    // data-comm-tab="settings" wrapper ships inside the function (RG-10).
    c.insertAdjacentHTML('beforeend', renderScribeParticipationCardHTML());
  }

  // ── handlers ──
  document.getElementById('chat-enabled-toggle')?.addEventListener('change', e => {
    saveSetting('chatEnabled', e.target.checked);
    try { refreshChatEnabled(); } catch {}
    try { applyChatNavVisibility(); } catch {}
    showToast(e.target.checked
      ? '💬 Chat enabled — visible to everyone'
      : '🙈 Chat disabled — hidden league-wide, nothing deleted', 'success');
    renderCommPage();
  });
  document.getElementById('scribe-feedback-toggle')?.addEventListener('change', e => {
    saveSetting('scribeFeedbackEnabled', e.target.checked);
    showToast(e.target.checked
      ? '🗳️ SCRIBE feedback buttons enabled — Rate/Flag visible in chat'
      : '🚫 SCRIBE feedback buttons disabled — pilot instrumentation retired', 'success');
    if (state.currentTab === 'chat') { try { renderChatPage(); } catch {} }
    renderCommPage();
  });
  document.getElementById('chat-image-preview-toggle')?.addEventListener('change', e => {
    saveSetting('chatImagePreviewEnabled', e.target.checked);
    showToast(e.target.checked
      ? '🖼️ Image previews enabled in chat'
      : '🖼️ Image previews disabled in chat', 'success');
    if (state.currentTab === 'chat') { try { renderChatPage(); } catch {} }
    renderCommPage();
  });
  document.getElementById('scribe-interactive-toggle')?.addEventListener('change', e => {
    saveSetting('scribeInteractiveEnabled', e.target.checked);
    showToast(e.target.checked
      ? '🤖 SCRIBE will try to answer @mentions for real (server switch must also be on)'
      : '🤖 SCRIBE @mentions get the canned reply only — round trip skipped client-side', 'success');
    renderCommPage();
  });
  document.getElementById('scribe-websearch-toggle')?.addEventListener('change', e => {
    saveSetting('scribeWebSearchEnabled', e.target.checked);
    showToast(e.target.checked
      ? '🔎 SCRIBE web search enabled (server switch must also be on)'
      : '🔎 SCRIBE web search off — score/spread/league answers only', 'success');
    renderCommPage();
  });
  document.getElementById('scribe-learnings-toggle')?.addEventListener('change', e => {
    saveSetting('scribeLearningsEnabled', e.target.checked);
    showToast(e.target.checked
      ? '🧠 Trainer learnings active — approved learnings/Canon reach SCRIBE again'
      : '🧠 Trainer learnings OFF. SCRIBE runs on the base persona alone.', 'success');
    renderCommPage();
  });
  // ── DI-D1 — the participation dial (Build 3, Group D, 2026-09-11) ──
  document.getElementById('scribe-autonomous-toggle')?.addEventListener('change', e => {
    setScribeAutonomousEnabled(e.target.checked);
    showToast(e.target.checked
      ? '🎚 SCRIBE can join in on its own again (the server switch must also be on)'
      : '🎚 SCRIBE stays quiet unless someone @s it', 'success');
    renderCommPage();
  });
  document.querySelectorAll('[data-scribe-freq]').forEach(btn => {
    btn.addEventListener('click', () => {
      const level = btn.dataset.scribeFreq;
      if (!setScribeFrequency(level).ok) return;
      const copy = FREQUENCY_COPY.find(o => o.level === level);
      showToast(`🎚 SCRIBE participation: ${copy ? copy.label : level}`, 'success');
      renderCommPage();
    });
  });
  document.getElementById('ep-detect-btn')?.addEventListener('click', async () => {
    const st = document.getElementById('ep-detect-status');
    if (st) st.textContent = '⏳ Fetching scoring plays…';
    try {
      const r = await detectLongestFieldGoal(games);
      if (r.best) {
        saveWeek({ ...getWeek(week.weekId), extraPointDetect: r.best });
        const inp = document.getElementById('ep-actual-input');
        if (inp && !inp.value) inp.value = r.best.yards;
        if (st) st.textContent = `${r.best.yards} yd — ${r.best.text} (${r.best.matchup})` + (r.skipped.length ? ` · ${r.skipped.length} game(s) skipped` : '');
        showToast(`🎯 Longest FG detected: ${r.best.yards} yards`, 'success');
      } else {
        if (st) st.textContent = 'No made FGs found' + (r.skipped.length ? ` (${r.skipped.length} game(s) unavailable)` : '');
        showToast('No field goals found in the slate data yet', 'warning');
      }
      if (r.skipped.length) console.warn('[ExtraPoint] skipped:', r.skipped);
    } catch (e) { if (st) st.textContent = '❌ ' + (e.message || e); }
  });

  document.getElementById('ep-save-btn')?.addEventListener('click', () => {
    const v = parseInt(document.getElementById('ep-actual-input')?.value, 10);
    if (!Number.isFinite(v)) { showToast('Enter the actual longest FG first', 'error'); return; }
    saveWeek({ ...getWeek(week.weekId), extraPointActual: v });
    showToast('✅ Extra Point actual saved & graded', 'success');
    renderCommPage();
  });

  document.getElementById('ep-post-btn')?.addEventListener('click', () => {
    const g = gradeWeekExtraPoint(getWeek(week.weekId), getPlayers().filter(p=>p.active));
    if (g) { emitExtraPointEvent(week.weekId, g); showToast('📣 Posted to chat', 'success'); }
  });

  document.getElementById('chat-digest-btn')?.addEventListener('click', async () => {
    const st = document.getElementById('chat-digest-status');
    try {
      const players = getPlayers().filter(p=>p.active);
      const wkGames = getGames(week.weekId);
      const picks = getPicks(week.weekId);
      const atsLossesByPlayer = {};
      players.forEach(p => {
        atsLossesByPlayer[p.playerId] = picks
          .filter(pk => pk.playerId === p.playerId)
          .filter(pk => { const g = wkGames.find(x => x.gameId === pk.gameId); const ats = g?.atsWinner; return ats && ats !== 'no_decision' && ats !== pk.selectedTeam; })
          .map(pk => pk.gameId);
      });
      const start = week.startDate ? new Date(week.startDate + 'T00:00:00').getTime() - 4*86400000 : Date.now() - 7*86400000;
      const end = week.endDate ? new Date(week.endDate + 'T23:59:59').getTime() + 2*86400000 : Date.now();
      const digest = chatDigest(start, end, { players, games: wkGames, atsLossesByPlayer, week: week.weekNumber });
      await navigator.clipboard.writeText(JSON.stringify(digest, null, 2));
      if (st) st.textContent = '✅ Copied to clipboard';
    } catch (e) { if (st) st.textContent = '❌ ' + (e.message || e); }
  });

  document.getElementById('scribe-queue-btn')?.addEventListener('click', () => {
    const st = document.getElementById('scribe-queue-status');
    try {
      const arr = JSON.parse(document.getElementById('scribe-queue-input')?.value || '[]');
      if (!Array.isArray(arr) || !arr.length) throw new Error('Paste a non-empty JSON array');
      let posted = 0, deferred = 0;
      const now = Date.now();
      arr.forEach((item, i) => {
        const at = item.postAt ? new Date(item.postAt).getTime() : 0;
        if (at && at > now) { deferred++; return; }   // scheduling proper lands with Tier 1
        if (!item.body) return;
        sendChatEvent({
          type: 'message', gameTag: item.gameTag || '', body: String(item.body),
          author: 'scribe', meta: { source: 'tier1' },
        });
        posted++;
      });
      if (st) st.textContent = `✅ Posted ${posted}` + (deferred ? ` · ${deferred} future-dated skipped (scheduling ships with Tier 1)` : '');
    } catch (e) { if (st) st.textContent = '❌ ' + (e.message || e); }
  });

  document.getElementById('season-recap-save')?.addEventListener('click', () => {
    saveSetting('seasonRecapText', document.getElementById('season-recap-input')?.value || '');
    showToast('✅ Season recap blurb saved', 'success');
  });

  document.getElementById('chat-diag-btn')?.addEventListener('click', async () => {
    const out = document.getElementById('chat-diag-out');
    if (out) out.textContent = '⏳ testing…';
    try {
      const mod = await import('./chatTransport.js');
      const { head } = await mod.fetchHead();
      if (out) out.textContent = `✅ Chat backend OK — head at seq ${head}. Deployment is current.`;
    } catch (e) {
      if (out) out.textContent = e?.stale
        ? '❌ DEPLOYMENT OUT OF DATE — the deployed Apps Script has no chat endpoints. Paste the new Code.gs, then Deploy → Manage deployments → Edit → New version (same URL).'
        : '❌ ' + (e.message || e);
    }
  });

  (async () => {
    const out = document.getElementById('chat-metrics-out');
    if (!out) return;
    try {
      const { rows } = await fetchChatMetrics(7);
      if (!rows.length) { out.textContent = 'No metrics yet — they accrue once chat traffic starts.'; return; }
      out.innerHTML = rows.map(r => {
        const total = r.execCount || 0;
        const warn = total > 2500 ? ' style="color:#B02A37;font-weight:700"' : total > 1600 ? ' style="color:#B8860B;font-weight:600"' : '';
        return `<span${warn}>${escHtml(r.date)}: ${total} calls (${r.appendCount||0} sends, ${r.headHit||0}/${(r.headHit||0)+(r.headMiss||0)} head cache hits)</span>`;
      }).join(' · ');
    } catch { out.textContent = 'Metrics unavailable (older deployment or offline).'; }
  })();
}

// ─── FINALIZATION ─────────────────────────────────────────────────────────────

/**
 * DI-D / DI-H (2026-09-02) — true when a week's recorded winner or loser (by
 * playerId, never by display name — two different players could theoretically
 * share a nickname) differs between two `getWeeklyResults(weekId)` snapshots
 * taken before and after a recompute. Shared so the tiebreaker-save path
 * (DI-D) and the bulk Data-tab recompute (DI-H) can't drift on what "the
 * outcome changed" means.
 */
function weekOutcomeChanged(before, after) {
  const bw = before.find(r=>r.isWinner)?.playerId ?? null;
  const bl = before.find(r=>r.isLoser)?.playerId ?? null;
  const aw = after.find(r=>r.isWinner)?.playerId ?? null;
  const al = after.find(r=>r.isLoser)?.playerId ?? null;
  return bw!==aw || bl!==al;
}

/**
 * DI-E (2026-09-02) — true when finalizing `week` RIGHT NOW, with no
 * tiebreaker on file, would assign the winner or loser arbitrarily: no
 * `actualTiebreakerValue` AND a real tie exists in a `calculateWeeklyResults`
 * preview scored with `actualTiebreaker=null` (top two OR bottom two rows
 * share `correctPicks`). Deliberately narrow, per the design input's own
 * trigger condition. Read-only preview — scores against the CURRENT slate but
 * never persists anything (no `saveGame`/`saveWeek`/`saveAllWeeklyResults`
 * call anywhere in this function), so calling it during a render is free of
 * side effects. Shared by both of the only two paths that reach 'final'
 * (renderWeekStatusButtons, ~5810 — 'final' is reachable only from 'live')
 * so they can't disagree about when to warn.
 */
function weekHasUnresolvedTie(week, players, picks, games) {
  if (!week || week.actualTiebreakerValue!=null) return false;
  const rows = calculateWeeklyResults(week.weekId, players, picks, games, null);
  if (rows.length<2) return false;
  const topTied = rows[0].correctPicks===rows[1].correctPicks;
  const bottomTied = rows[rows.length-1].correctPicks===rows[rows.length-2].correctPicks;
  return topTied || bottomTied;
}

/**
 * Item SS (runtime half, 2026-09-10) — does `game.spread`'s SIGN agree with
 * its OWN recorded `favorite` team, under AD-03's signed home-perspective
 * convention (negative = home favored, positive = away favored, 0 = PK)?
 *
 * Returns:
 *   true  — CONSISTENT, or nothing to check at all: no favorite resolved
 *           (`favorite` null/absent, or it names neither `homeTeam` nor
 *           `awayTeam`), or spread is null/undefined/0 (0 asserts no sign
 *           either way — PK games are consistent with any favorite or none,
 *           per the approved spec).
 *   false — CONTRADICTION: a favorite IS resolved and disagrees with the
 *           sign actually stored. This is exactly the shape RG-54's dg8
 *           fixture (`spread:-2.5` with `favorite:'Alabama'` when Alabama
 *           was the AWAY team) and the v0.13–v0.15 spread bug both produced
 *           — a wrong sign that grades real money wrong once frozen.
 *
 * Deliberately permissive whenever it CANNOT determine an expected sign —
 * this guards a real, detectable contradiction, not the absence of one.
 * A game with no favorite resolved (`spreadSource:'espn_unresolved'`, a
 * manual entry mid-edit, a PK) must never be blocked here — only an actual
 * disagreement between the stored sign and the stored favorite is refused.
 *
 * Uses the game's OWN structured `favorite` field (a team name, matching
 * `homeTeam`/`awayTeam` exactly) — never a display string — same lesson
 * RG-54 already paid for once (`extractSpread()` derives it from ESPN's
 * structured odds flags, never from rendered text).
 *
 * SHARED by both places a week can reach LOCKED — `applyWeekStatusChange()`
 * (manual) and `tickAutoTransition()` (auto) — so they cannot independently
 * drift on what "consistent" means. Same two-call-sites-must-agree lesson as
 * RG-52/RG-53 (recap week-ordering, fixed at both call sites together).
 */
export function isSpreadSignConsistentWithFavorite(game) {
  if (!game) return true;
  const { spread, favorite, homeTeam, awayTeam } = game;
  if (spread === null || spread === undefined || spread === 0) return true; // no sign asserted
  if (!favorite) return true; // no resolved favorite — nothing to contradict
  if (favorite === homeTeam) return spread <= 0; // home favored -> home-perspective spread must be <=0
  if (favorite === awayTeam) return spread >= 0; // away favored -> home-perspective spread must be >=0
  return true; // favorite matches neither team name — can't determine expected sign; don't block on it
}

/**
 * The commissioner's Week-tab status buttons (draft/open/locked/live/final).
 *
 * Extracted from the `.week-status-btn` click handler so the ORDER OF
 * OPERATIONS is reachable from the harness — the handler itself is bound
 * inside renderCommPage() and can't be driven without a real DOM, which is why
 * the drop described below went unnoticed. Everything DOM-facing
 * (refreshHeader/showToast/renderCommPage) stays in the handler; this owns the
 * state transition and nothing else. Item SS's runtime spread-lock guard
 * (below) keeps to that split too: THIS function only decides which games'
 * spreads are safe to freeze and reports the refused ones back on the
 * returned week object (`spreadLockRefusals`, attached AFTER saveWeek() has
 * already taken its own snapshot — see the note at the return — so it is
 * never itself persisted); the handler is what turns that into a visible
 * warning.
 *
 * RG (2026-08-12) — THE TRANSITION IS PERSISTED BEFORE ANY SIDE EFFECT RUNS.
 * This used to call finalizeWeek(week) — the pre-transition snapshot — and only
 * then saveWeek(upd). finalizeWeek's chat emitters read the week's status back
 * out of storage, so on the ordinary locked→final press the DI-116e blind-rule
 * guard in emitExtraPointEvent() saw a week still marked 'locked' and returned
 * early. That event carries a deterministic id (sys_ep_<weekId>) with
 * server-side dedupe, so it never re-emitted: the week's Extra Point reveal was
 * gone for good, silently.
 *
 * Saving first and then handing finalizeWeek the PERSISTED week (`upd`, not
 * `week`) means the caller's object and storage can no longer disagree, so it
 * no longer matters which of the two a downstream guard consults. The guard
 * itself is untouched and still refuses an open or locked week — see
 * loadtest.mjs [39].
 */
export function applyWeekStatusChange(week, to) {
  if(!week||!to)return null;
  const upd={...week,status:to};
  const spreadLockRefusals=[];
  if(to==='locked'){
    getGames(week.weekId).forEach(g=>{
      // Item SS (runtime) — LOUD-FAIL per-game: refuse to FREEZE (not to
      // lock the week) a spread whose sign contradicts its own recorded
      // favorite, rather than silently locking in a grade that will be
      // wrong (AD-03/AD-06). lockedSpread is left null on this one game and
      // the commissioner is warned by name (see the .week-status-btn
      // handler / the auto-lock toast).
      // GUARANTEE, stated accurately: this WARNS and does NOT permanently
      // freeze the bad value — so once the commissioner corrects the sign,
      // the fix takes effect. It does NOT exclude the game from grading:
      // calculateAtsWinner() falls back to the LIVE game.spread when
      // lockedSpread is null (scoring.js), and doRefreshScores()/
      // evaluatePick() grade via that fallback — so a refused game left
      // uncorrected still grades against its (wrong-signed) live spread.
      // The value here is the loud warning + the recoverable (un-frozen)
      // state, NOT auto-exclusion. The rest of the slate locks normally;
      // aborting the WHOLE week over one bad data-entry mistake would hold
      // five other games' picks hostage to it.
      if(g.spread!==null && g.spread!==undefined && !isSpreadSignConsistentWithFavorite(g)){
        spreadLockRefusals.push(g);
        return;
      }
      saveGame({...g,lockedSpread:g.spread});
    });
    upd.lockedAt=new Date().toISOString();
    // F4 (2026-09-04, clearing the reviewer BLOCK) — mirrors the lockedSpread
    // freeze immediately above, one level up: snapshot the roster the
    // tiebreaker Auto-Calc reads at the SAME instant every game's spread
    // freezes, so a claim edit or player deactivation between LOCK and
    // finalization can never silently move the correct answer out from
    // under picks players already submitted against it. See
    // almaMatersForAutoCalc()'s docstring for the read side.
    upd.lockedAlmaMaters=claimedAlmaMaters();
  }
  if(to==='final'){upd.finalizedAt=new Date().toISOString();}
  saveWeek(upd);
  if(to==='final')finalizeWeek(upd);
  // Groups A/B (2026-09-10, DI-B2) — the two CLIENT-triggered lifecycle
  // events this chokepoint owns. Both are single-commissioner-device fires
  // (this function only runs from the Week tab's status buttons / auto-
  // transition), so the per-recipient dedupKey (js/notifications.js) is
  // exactly enough to make a stray double-click or a second commissioner
  // device harmless — never a second notification. Demo weeks never fire
  // (guarded inside notifyPicksOpened/notifyPicksLocked themselves too, but
  // checked here first to avoid the wasted getPlayers()/getPicks() work).
  if (upd.dataSourceMode !== 'demo') {
    try {
      if (to === WEEK_STATUS.OPEN && week.status === WEEK_STATUS.DRAFT) {
        notifyPicksOpened(upd, getPlayers());
      } else if (to === WEEK_STATUS.LOCKED) {
        const activePlayers = getPlayers().filter(p => p.active);
        const submittedCount = activePlayers.filter(p => hasPlayerSubmitted(upd.weekId, p.playerId)).length;
        notifyPicksLocked(upd, activePlayers, submittedCount, activePlayers.length);
        // DI-D1 AMENDMENT (coordinator, 2026-09-11, reviewer finding F2):
        // there is NO SCRIBE call site here. The DI named week-lock as one of
        // two, on the assumption that a locked week's picks are shareable.
        // They are not: `arePicksPublic()` — the app's single definition of
        // the blind rule — is live/final only, so a lock-phase call could
        // never do anything but skip. A call site that can never fire is
        // worse than no call site: it reads as coverage. `unanimous` fires
        // from the FINALIZE site instead, where the field is public anyway.
      }
      renderNotifBell();   // instant feedback if the ACTING commissioner is also a recipient
    } catch (e) { console.warn('[notifications] week-status hook failed', e); }
  }
  // Attached AFTER saveWeek() — storage.js's saveWeek() does `{...week}` at
  // call time, so mutating `upd` past this point can never leak into what
  // was persisted. Purely a transient signal for the DOM-facing caller.
  upd.spreadLockRefusals=spreadLockRefusals;
  return upd;
}

/**
 * UN-126 (Part 1) — THE FIX. Presence of a 'weekly' obligation for this
 * weekId/gid no longer means "already settled." That was the defect: a week
 * finalizing ALONE creates a singleton obligation keyed to its own weekId;
 * if it's LATER grouped with a still-open partner and the group then
 * finalizes, the group's canonical id (`getEffectiveGroupId`) can equal that
 * SAME weekId, so the old code found the singleton, read presence as
 * settled, and created nothing. Weekly History then showed the freshly
 * POOLED winner while the obligation record still named the stale SOLO
 * one — display and money disagreeing, silently.
 *
 * Now every ACTIVE (non-voided — see getActiveObligations) 'weekly'
 * obligation already on record for this weekId/gid is compared against the
 * freshly computed payer/recipient:
 *   - none exist                       → create it. The ordinary first-time path.
 *   - one matches exactly              → no-op. Idempotent re-finalize — the
 *     commissioner can go in any direction for corrections (RG-30 territory),
 *     and re-pressing FINAL on an unchanged outcome must not mint a second
 *     prize for it.
 *   - one or more exist and NONE match → THE CONFLICT. Never silently
 *     accepted (every existing record is left exactly as it was, never read
 *     as if it settled the fresh outcome) and never silently overwritten
 *     (no existing record is ever mutated to the new numbers or deleted) —
 *     instead a NEW obligation is created for the correct, freshly computed
 *     outcome, and it PLUS every active record already on file for this
 *     weekId are flagged `needsReview:true` so a human resolves it via the
 *     Data-tab "Obligation Corrections" tool (merge or void — see
 *     mergeObligationsById / voidObligationById below). Idempotent against
 *     the identical conflicting outcome recurring: won't mint a second
 *     flagged duplicate for an outcome that's already been surfaced.
 */
function reconcileWeeklyObligation(weekId, payerPlayerId, recipientPlayerId, prize) {
  const existing = getActiveObligations(weekId).filter(o => o.type === 'weekly');
  const matching = existing.find(o => o.payerPlayerId === payerPlayerId && o.recipientPlayerId === recipientPlayerId);
  if (matching) return;                     // already correctly on record — nothing to do
  if (!existing.length) {
    // Groups A/B (2026-09-10, DI-B4) — "created" only, the clean first-time
    // path. The conflict/needsReview branch below is deliberately NOT
    // notified — it's a commissioner-bookkeeping correction, the same
    // "changed" class DI-B4's own research triage scoped OUT (created +
    // settled only).
    const ob = createObligation(weekId, payerPlayerId, recipientPlayerId, prize);
    saveObligation(ob);
    try { notifyObligationCreated(ob); renderNotifBell(); } catch (e) { console.warn('[notifications] obligation-created hook failed', e); }
    return;
  }
  const alreadyFlagged = existing.some(o =>
    o.needsReview && o.payerPlayerId === payerPlayerId && o.recipientPlayerId === recipientPlayerId);
  if (alreadyFlagged) return;
  const fresh = createObligation(weekId, payerPlayerId, recipientPlayerId, prize);
  fresh.needsReview = true;
  fresh.reviewNote = 'Computed outcome differs from an existing obligation for this week — resolve in Commissioner → Data → Obligation Corrections.';
  saveObligation(fresh);
  existing.forEach(o => {
    if (!o.needsReview) {
      saveObligation({ ...o, needsReview: true, reviewNote: 'A newly computed outcome for this week disagrees with this record — resolve in Commissioner → Data → Obligation Corrections.' });
    }
  });
}

// ── DI-D1 — THE DETECTOR CALL SITES (Build 3, Group D pass 2, 2026-09-11) ──
//
// Pass 1 built the pure detectors (`detectWeekSignals`) and the one impure
// wrapper that feeds a detected signal through the SAME `considerAutonomous`
// gate every other trigger uses (`considerWeekSignals`, which as amended
// 2026-09-11 promotes at most ONE candidate per invocation — the
// highest-point signal — and carries the whole detected set as evidence).
// Nothing called them. There is exactly ONE call site: the week's RESULTS
// FINALIZE (lead changes, milestones, streaks, lone-wolf covers — all of
// which need the standings on both sides of the transition — plus
// `unanimous`, which the DI originally placed at week-lock).
//
// WHY ONE AND NOT THE DI'S TWO (amendment, coordinator 2026-09-11, reviewer
// finding F2): a lock-phase call could never fire. `arePicksPublic()` is the
// app's single definition of the blind rule and it is live/final only, so at
// LOCKED this function correctly refuses to read the field at all — every
// lock-phase call would have been a guaranteed skip. A call site that cannot
// fire is worse than none, because it reads as coverage. `unanimous` is
// detected at finalize instead, where the picks are public regardless.
//
// Called ONCE per event, never per game, which is what makes pass 1's "at
// most one candidate per invocation" mean one message.
//
// IDEMPOTENCY, AND WHY IT IS A LEDGER AND NOT JUST THE COOLDOWN. Both call
// sites can run more than once for the same week: a commissioner can press
// LOCKED twice, auto-transition and the manual button share this chokepoint,
// and Comm→Data's "recalculate every finalized week" re-runs `finalizeWeek()`
// for every already-final week on the board. `considerAutonomous`'s own
// guards (10-minute cooldown, per-bucket fired set) are time-scoped and
// module-scoped — they do not survive a reload, and they would happily let
// week 3's lead change fire again next month. So: a device-local ledger,
// exactly the shape `checkPickRevealDue()`'s `cfbp_reveal_emitted` already
// uses for the same class of problem (a once-per-week post that must not
// re-fire), and the same shape as SCRIBE's own 14-day no-repeat ledger in
// scribeLines.js. ONE entry per (week, phase) — see item 8 at the write
// site. Device-local on purpose: it is a de-duplication hint, not
// league state; the AUTHORITATIVE cross-device collapse is the deterministic
// post id the server derives (`scribe_auto_<trigger>_<subject>_<bucket>`).
//
// Deliberately NOT through `load()`/`save()`: this is per-device UI
// bookkeeping that must never be pushed to the Sheet or clobber another
// device's copy, the same reasoning chat.js's lastseen/outbox keys and
// notifications.js's device-local caches already carry.
const SCRIBE_WEEK_SIGNAL_LEDGER_KEY = 'cfbp_scribe_weeksignals';
const SCRIBE_WEEK_SIGNAL_LEDGER_MAX = 200;
/** A `finalizeWeek()` for a week that finalized weeks ago is a RECOMPUTE, not
 *  news. Comm→Data's retroactive recalculation runs exactly that, for every
 *  final week at once; without this, a fresh device would re-announce a whole
 *  season's lead changes. 24h is generous — the real transition stamps
 *  `finalizedAt` milliseconds before this runs. */
const SCRIBE_FINALIZE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

function scribeWeekSignalLedger() {
  try { return JSON.parse(localStorage.getItem(SCRIBE_WEEK_SIGNAL_LEDGER_KEY) || '[]') || []; }
  catch { return []; }
}
function noteScribeWeekSignals(keys) {
  if (!keys.length) return;
  const next = [...scribeWeekSignalLedger()];
  for (const k of keys) { if (!next.includes(k)) next.push(k); }
  try { localStorage.setItem(SCRIBE_WEEK_SIGNAL_LEDGER_KEY, JSON.stringify(next.slice(-SCRIBE_WEEK_SIGNAL_LEDGER_MAX))); } catch {}
}
/** Test seam — groupdtest.mjs proves the second call fires nothing, which
 *  needs a way back to a clean slate between sections. */
export function _resetScribeWeekSignalLedgerForTest() {
  try { localStorage.removeItem(SCRIBE_WEEK_SIGNAL_LEDGER_KEY); } catch {}
}
export function _scribeWeekSignalLedgerForTest() { return scribeWeekSignalLedger(); }

/**
 * The week status the detectors are told about (pass 1's own signal-level
 * blind guard reads it). FAIL-CLOSED on the documented disagreement between
 * `getEffectiveWeekStatus()` and `week.status`: with Auto-Open set and
 * Auto-Lock blank the effective status reports 'open' for a week the app
 * already advanced (see canPlayerSubmitPicks's two RG notes), and the wrong
 * direction to be wrong in here is "more advanced than it really is." So the
 * LESS permissive of the two wins.
 */
function effectiveWeekStatusForSignals(week) {
  const eff = getEffectiveWeekStatus(week);
  if (week.status === 'draft' || eff === 'draft') return 'draft';
  if (week.status === 'open' || eff === 'open') return 'open';
  return eff;
}

/**
 * Fire the week-signal detectors once per (week, phase) per device.
 *
 * `phase` is 'lock' or 'final'. Returns `{ fired, skipped?, detected, outcomes }`
 * — `fired:false` with a reason whenever nothing was evaluated, which is what
 * makes "it did not double-fire" assertable rather than inferred from silence.
 *
 * Every input comes from the functions the rest of the app already uses:
 * getGames/getPicks/getPlayers through the storage seam, and standings from
 * `seasonStandingsRows()` — the Standings page's own numbers (CONVENTIONS
 * #21), never a second recompute.
 */
export function fireScribeWeekSignals(week, { phase = 'lock', standingsBefore = null, standingsAfter = null } = {}) {
  if (!week || !week.weekId) return { fired: false, skipped: 'no_week', detected: [], outcomes: [] };
  if (week.dataSourceMode === 'demo') return { fired: false, skipped: 'demo', detected: [], outcomes: [] };
  // THE BLIND RULE, through the app's ONE definition of it. This function
  // reads EVERY player's picks (getPicks(weekId), no player argument) and
  // hands them to detectors whose output can become a public chat message —
  // `unanimous` literally names the side the whole league took. That is the
  // same disclosure RG-37/RG-40 fixed on two other surfaces, so it asks the
  // same predicate they ask rather than carrying its own idea of "safe."
  //
  // This is also why there is no lock-phase call site any more (F2, above):
  // at LOCKED this predicate is false, so such a call could only ever skip.
  // The ledger is deliberately NOT written on this path, so a week that is
  // somehow not yet public is still evaluated when it becomes so.
  if (!arePicksPublic(week)) return { fired: false, skipped: 'picks_blind', detected: [], outcomes: [] };
  const phaseKey = `${week.weekId}|${phase}`;
  if (scribeWeekSignalLedger().includes(phaseKey)) {
    return { fired: false, skipped: 'already_fired', detected: [], outcomes: [] };
  }
  if (phase === 'final') {
    const at = week.finalizedAt ? Date.parse(week.finalizedAt) : NaN;
    // F1 (reviewer BLOCK, 2026-09-11) — THESE TWO CASES ARE NOT THE SAME, and
    // collapsing them poisoned the ledger for the only run that mattered.
    // `finalizeWeek()` is not called solely from the final transition: the
    // "Calculate ATS" button and the manual-score promote path both call it on
    // a LIVE week whose `finalizedAt` is still null. That produced NaN, the
    // combined test read NaN as "too old," WROTE `<weekId>|final`, and the
    // genuine finalize minutes later returned `already_fired` — the feature
    // silently never ran for that week on that device.
    //
    //   NO STAMP  -> the week has not finalized yet. Not news, not stale,
    //                nothing decided. Return WITHOUT writing the ledger, so
    //                the real finalize still gets its one evaluation.
    //   OLD STAMP -> a genuine recompute of a week that finalized long ago
    //                (Comm→Data's "recalculate every finalized week"). Record
    //                it: an old week is permanently not news.
    if (!Number.isFinite(at)) {
      return { fired: false, skipped: 'not_final_yet', detected: [], outcomes: [] };
    }
    if (Date.now() - at > SCRIBE_FINALIZE_FRESHNESS_MS) {
      noteScribeWeekSignals([phaseKey]);
      return { fired: false, skipped: 'stale_finalize', detected: [], outcomes: [] };
    }
  }
  let result = { detected: [], outcomes: [] };
  try {
    // SEASON-WIDE games/picks/weeks on purpose, not week-scoped:
    // `detectWeekSignals` filters to `weekId` itself for the per-week
    // detectors (unanimous, loneWolfWin), and `streak` genuinely needs the
    // whole season to know whether this week extended or broke one — its own
    // docstring says so. `weeks` supplies the (season, weekNumber)
    // comparator, which is what makes this ordering identical to the
    // server's `scribeOrderedGradedPicks_` rather than merely similar.
    // Nothing here can leak an OPEN week's picks: only GRADED picks enter a
    // streak, and an open week has no final games.
    result = considerWeekSignals({
      weekId: week.weekId,
      weekStatus: effectiveWeekStatusForSignals(week),
      games: getGames(),
      picks: getPicks(),
      weeks: getWeeks(),
      players: getPlayers().filter(p => p.active),
      standingsBefore, standingsAfter,
    }) || { detected: [], outcomes: [] };
  } catch (e) {
    console.warn('[scribe] week signals failed', e);
    return { fired: false, skipped: 'error', detected: [], outcomes: [] };
  }
  // Item 8 (reviewer) — PHASE KEYS ONLY. This used to also write one
  // `<weekId>|<signal>|<subject>` entry per detected signal, which nothing
  // ever read: the only gate is the phase key, and the per-signal rows just
  // consumed the 200-entry cap that keeps this device-local list bounded.
  // Dedup granularity is unchanged — one evaluation per week per phase.
  noteScribeWeekSignals([phaseKey]);
  return { fired: true, ...result };
}

/* Exported for loadtest.mjs — driven directly (via applyWeekStatusChange) to
   verify the UN-118/UN-125 obligation gate end-to-end, the same rationale
   RG-30's own [39] suite already exports/drives this function through. */
export function finalizeWeek(week) {
  const players=getPlayers().filter(p=>p.active);
  const picks=getPicks(week.weekId);
  const games=getGames(week.weekId);
  // DI-D1 — the standings as they stood BEFORE this week's results are
  // saved. Captured here, at the top, because saveAllWeeklyResults() below
  // is what changes them; `chartLeadChange` and `milestone` are both
  // before/after comparisons and there is no second chance to read "before."
  // Same function the Standings page renders from (seasonStandingsRows).
  const scribeStandingsBefore=seasonStandingsRows();
  games.forEach(g=>{
    if(g.status===GAME_STATUS.FINAL&&g.lockedSpread!==null)
      saveGame({...g,atsWinner:calculateAtsWinner(g)});
  });
  const freshGames=getGames(week.weekId);
  const results=calculateWeeklyResults(week.weekId,players,picks,freshGames,week.actualTiebreakerValue);
  saveAllWeeklyResults(week.weekId,results);
  // v0.16.0 — chat system events + Extra Point grading (deterministic ids ⇒
  // exactly-once even if several devices finalize/re-finalize).
  try {
    const ranked=[...results].sort((a,b)=>(a.rank??99)-(b.rank??99));
    emitWeekFinalEvent(week, ranked);
    freshGames.forEach(g=>{
      const ats=g.atsWinner; if(!ats) return;
      const gp=picks.filter(p=>p.gameId===g.gameId);
      emitGameFinalEvent(g, ats,
        gp.filter(p=>p.selectedTeam===ats).map(p=>p.playerId),
        gp.filter(p=>p.selectedTeam!==ats&&ats!=='no_decision').map(p=>p.playerId));
    });
    if (week.extraPointActual!=null) {
      const graded=gradeWeekExtraPoint(week, players);
      if (graded) emitExtraPointEvent(week.weekId, graded);
    }
  } catch(e){ console.warn('[finalizeWeek] chat events', e); }
  // Groups A/B (2026-09-10, DI-B3) — once per week, at FINAL. weekWinnerName/
  // weekLoserName come DIRECTLY from `results` (this function's own
  // calculateWeeklyResults() return value, two lines up) — never independently
  // re-derived (SCRIBE.md §9.1 boundary). Demo weeks never notify. Per-part
  // finalization of a grouped week fires its OWN notification here, exactly
  // like emitWeekFinalEvent() above it — same "a part finalizing alone still
  // fires its own events" behavior this function already documents.
  if (week.dataSourceMode !== 'demo') {
    try {
      const winner = results.find(r=>r.isWinner);
      const loser = results.find(r=>r.isLoser);
      notifyResultsFinalized(week, winner?.displayName || undefined, loser?.displayName || undefined, players);
      renderNotifBell();
    } catch (e) { console.warn('[notifications] results-finalized hook failed', e); }
    // DI-D1's ONE call site (see fireScribeWeekSignals for why the DI's
    // second, lock-phase one was removed) — the `notifyResultsFinalized`
    // seam the DI names, with its own try/catch so a SCRIBE failure can
    // never take the notification with it. `after` is read now,
    // once saveAllWeeklyResults() above has landed, so before/after are two
    // genuine snapshots of the same function rather than one snapshot and a
    // guess. Fires at most once per week per device (see the ledger), and
    // never for a week that finalized more than a day ago — which is what
    // keeps Comm→Data's "recalculate every finalized week" silent.
    try {
      fireScribeWeekSignals(week, { phase: 'final', standingsBefore: scribeStandingsBefore, standingsAfter: seasonStandingsRows() });
    } catch (e) { console.warn('[scribe] week-final signals failed', e); }
  }
  const settings=getSettings();

  // ── UN-118/UN-125 — multi-part week grouping (DI-126d) ────────────────────
  // A week RECORD is a scheduling unit; a COMPETITIVE week is what players
  // actually win the prize for. Singleton groups (`groupWeeks.length<=1`,
  // still the overwhelming common case — includes EVERY week that predates
  // this feature, since old records lack `groupId` entirely) fall through to
  // the exact obligation logic that shipped before grouping existed, byte
  // for byte. A >1-member group only ever creates ONE obligation, and only
  // once every member has independently reached 'final' — a part finalizing
  // alone still saves ITS OWN weekly-result row and fires ITS OWN chat
  // events (both already ran above, unconditionally), it just creates no
  // obligation yet.
  const groupWeeks = weeksInGroup(getWeeks(), week);
  if (groupWeeks.length <= 1) {
    const winner=results.find(r=>r.isWinner);
    const loser=results.find(r=>r.isLoser);
    // v0.17.0 — demo weeks NEVER generate real obligations
    if(winner&&loser&&week.dataSourceMode !== 'demo'){
      reconcileWeeklyObligation(week.weekId, loser.playerId, winner.playerId, settings.weeklyPrize);
    }
  } else if (groupWeeks.every(w => w.status === 'final')) {
    const gid = getEffectiveGroupId(week);
    const groupPicks = groupWeeks.flatMap(w => getPicks(w.weekId));
    const groupGames = groupWeeks.flatMap(w => getGames(w.weekId));
    const groupResults = calculateGroupWeeklyResults(groupWeeks, players, groupPicks, groupGames);
    const gWinner = groupResults.find(r=>r.isWinner);
    const gLoser  = groupResults.find(r=>r.isLoser);
    if (gWinner && gLoser && week.dataSourceMode !== 'demo') {
      reconcileWeeklyObligation(gid, gLoser.playerId, gWinner.playerId, settings.weeklyPrize);
    }
  }
  // groupWeeks.length>1 && not every member final yet ⇒ no obligation. The
  // NEXT member to finalize re-runs this same check and creates the one
  // obligation once the group is complete.
}

// ─── AUTO REFRESH ─────────────────────────────────────────────────────────────

let _refreshTimer=null;

export function setupAutoRefresh() {
  // Idempotent (re-)arm: clear any existing timer FIRST so repeated calls
  // (boot + every interval-setting save) can never stack duplicate intervals.
  if(_refreshTimer){clearInterval(_refreshTimer);_refreshTimer=null;}
  const{autoRefreshInterval=60}=getSettings();
  if(!autoRefreshInterval)return;                       // "Off" — no timer at all
  _refreshTimer=setInterval(()=>{ runAutoRefreshTick(); },autoRefreshInterval*1000);
  // Run one auto-transition check immediately so an app that opens after the
  // lock time has passed doesn't have to wait for the next tick.
  tickAutoTransition();
}

/**
 * One auto-refresh tick. Extracted and exported so the timer's behaviour can be
 * asserted directly (same reasoning as tickAutoTransition()'s export) — the
 * setInterval callback itself is unreachable from Node.
 *
 * RG (fb_1788025448083, v0.17.7) — "scores don't refresh at the selected
 * interval; I have to hit Refresh Scores manually." Root cause was the tab
 * gate that used to sit here: the tick returned early on ANY tab except
 * 'dashboard', so a player or commissioner sitting on the Picks tab during a
 * live window never got a single fetch. That directly contradicts the live
 * polling contract in CLAUDE.md ("60-second polling loop … only runs on
 * non-demo weeks" — NOT "only on the dashboard"). The DATA refresh must run on
 * every non-demo/non-manual week regardless of active tab; only the wholesale
 * re-render stays tab-scoped.
 *
 * The Picks-tab live render (quarter/clock) is DI-2 and belongs to
 * feature-builder — it must be a surgical score update, NOT a full
 * renderPicksPage(), which would blow away a player's in-progress edits every
 * interval. So this function keeps the data fresh but intentionally does NOT
 * re-render Picks; it re-renders only the dashboard, which is safe to rebuild.
 */
export async function runAutoRefreshTick() {
  // F2/F4 remediation (2026-09-10) — server-fired reminders (PICKS_REMINDER/
  // PICKS_LOCKING_SOON) have NO client-side trigger point at all — Code.gs's
  // scanReminders fires them independently of any tab/week-mode state — so
  // this poll must run BEFORE the demo/manual early-returns below, on every
  // tick, for whoever is signed in. pollNotifyLog() is internally throttled
  // to ≤60s and skips a hidden tab on its own, so it's safe to call every
  // tick unconditionally.
  try {
    const sess = getSession();
    if (sess?.playerId) { await pollNotifyLog(sess.playerId); renderNotifBell(); }
  } catch (e) { console.warn('[notifications] notifyLog poll failed', e); }

  // Auto-transition check runs EVERY tick regardless of active tab or week
  // mode (demo weeks are skipped inside the helper). Transitions affect all
  // users so whichever device ticks first writes the new status to the
  // shared backend and everyone else picks it up on next hydrate.
  tickAutoTransition();

  const week=getCurrentWeek();
  if(!week) return;
  // Skip auto-refresh entirely for demo or fully-manual weeks. Otherwise the
  // simulated scores get walked over by whatever ESPN currently returns —
  // which is what was causing "demo resets after a few seconds."
  if (week.dataSourceMode === 'demo' || week.dataSourceMode === 'manual') return;
  // Keep score DATA fresh no matter which tab is showing.
  await doRefreshScores(week,getGames(week.weekId));
  // Re-render only the surface that's safe to rebuild wholesale. Dashboard's
  // own re-render already covers its live-status text (it goes through
  // renderDashboardTable/renderDashboardCompact fresh every time). The
  // Picks tab is NOT rebuilt wholesale — renderPicksPage() would wipe an
  // in-progress draft pick — so its game cards get a surgical DI-2 patch
  // instead, touching only the score/status region.
  if(state.currentTab==='dashboard') renderDashboard();
  else if(state.currentTab==='picks') updatePicksLiveStatusInPlace(getGames(week.weekId));
}

/**
 * Check the active week and auto-transition its status if warranted:
 *   OPEN → LOCKED   at (first kickoff − autoLockOffsetMinutes), or when picksLockAt hits
 *   LOCKED → LIVE   at first kickoff, if autoLiveEnabled
 *   LIVE → pendingFinalization=true when every game is FINAL, if autoFinalizeEnabled
 *     (Commissioner sees a confirm prompt and completes the transition manually.)
 *
 * Demo weeks are skipped — those are commissioner-driven simulations.
 *
 * Exported (2026-09-04, F4) — same reasoning as applyWeekStatusChange()'s
 * own export comment: this is the SECOND, independent path a week can reach
 * LOCKED through (a commissioner pressing the status button goes through
 * applyWeekStatusChange() instead), so the harness needs to reach it
 * directly to prove the lockedAlmaMaters freeze below applies on BOTH paths,
 * not just the manual one.
 */
export function tickAutoTransition() {
  try {
    const week = getCurrentWeek();
    if (!week) return;
    if (week.dataSourceMode === 'demo') return;

    const games = getGames(week.weekId);
    if (!games?.length) return;

    const now = Date.now();
    let changed = false;
    let next = { ...week };

    // OPEN → LOCKED
    if (week.status === WEEK_STATUS.OPEN) {
      const lockAt = computeEffectiveLockAt(week, games);
      if (lockAt && now >= lockAt.getTime()) {
        next.status = WEEK_STATUS.LOCKED;
        next.lockedAt = new Date().toISOString();
        // F4 (2026-09-04) — same freeze applyWeekStatusChange() does on the
        // manual lock path; this is the auto-lock path, and it must not
        // disagree about when the roster stops moving. See
        // almaMatersForAutoCalc()'s docstring.
        next.lockedAlmaMaters = claimedAlmaMaters();
        changed = true;
        // Lock the spreads on all games at their current values so late-hour
        // line moves don't rewrite what players were graded against.
        // Item SS (runtime) — same guard as applyWeekStatusChange()'s manual
        // leg, via the shared isSpreadSignConsistentWithFavorite() helper so
        // the two lock paths cannot disagree about what "consistent" means.
        const autoSpreadLockRefusals = [];
        for (const g of games) {
          if (g.spread !== null && g.spread !== undefined && (g.lockedSpread === null || g.lockedSpread === undefined)) {
            if (!isSpreadSignConsistentWithFavorite(g)) {
              autoSpreadLockRefusals.push(g);
              continue; // LOUD-FAIL per-game: leave lockedSpread unset rather than freeze a contradictory sign.
            }
            saveGame({ ...g, lockedSpread: g.spread, updatedAt: new Date().toISOString() });
          }
        }
        // Nothing wraps this tick in a click handler (it fires from a
        // background timer, no commissioner necessarily watching), so —
        // unlike applyWeekStatusChange() — this is the one place that must
        // surface the warning itself rather than defer to a DOM-facing
        // caller. Same showToast() the rest of this module already uses.
        if (autoSpreadLockRefusals.length) {
          const names = autoSpreadLockRefusals.map(g => `${g.awayTeam} @ ${g.homeTeam}`).join(', ');
          showToast(`⚠️ Auto-lock: spread NOT frozen for ${autoSpreadLockRefusals.length} game${autoSpreadLockRefusals.length > 1 ? 's' : ''} — sign contradicts recorded favorite: ${escHtml(names)}. Fix in Commissioner → Games, then lock manually.`, 'error');
        }
      }
    }

    // LOCKED → LIVE
    if ((changed ? next.status : week.status) === WEEK_STATUS.LOCKED && getAutoLiveEnabled(week)) {
      const liveAt = computeEffectiveLiveAt(week, games);
      if (liveAt && now >= liveAt.getTime()) {
        next.status = WEEK_STATUS.LIVE;
        changed = true;
      }
    }

    // LIVE → pending finalization when every game is final (commissioner confirms)
    if ((changed ? next.status : week.status) === WEEK_STATUS.LIVE && getAutoFinalizeEnabled(week) && !week.pendingFinalization) {
      const allFinal = games.every(g => g.status === GAME_STATUS.FINAL);
      if (allFinal) {
        next.pendingFinalization = true;
        changed = true;
      }
    }

    if (changed) {
      next.updatedAt = new Date().toISOString();
      saveWeek(next);
      // Best-effort UI refresh — the picks page and dashboard both depend on
      // week.status, so re-render whichever is showing.
      if (state.currentTab === 'picks') renderPicksPage();
      else if (state.currentTab === 'dashboard') renderDashboard();
      else if (state.currentTab === 'commissioner') renderCommPage();
    }
  } catch (err) {
    console.warn('[tickAutoTransition] error:', err);
  }
}

// Item 2 (in-game quarter+clock), Pass A — MODULE-LEVEL, IN-MEMORY ONLY.
// Keyed by game.gameId (the stable internal id, NOT espnEventId — the whole
// point is that this survives refresh-to-refresh matching by the id
// storage/scoring/renderers already key on). Value: { name, detail,
// shortDetail, capturedAt }, straight from ESPN's status.type via
// data-provider.js's `liveStatusByEventId` map (see parseAndReport() /
// refreshScoresByEventIds()) — keyed by espnEventId, never attached to a
// game object. Repopulated on every doRefreshScores() poll (~60s while a
// week is live). NEVER written to
// the Sheet — there is no getX/setX pair in storage.js for this on purpose.
// Pass B wires it into renderGameCard/renderDashboardTable/
// renderDashboardCompact via liveStatusDisplay()/liveStatusDisplayShort()
// below. Exported for testability (livestatustest.mjs) and for Pass B.
export const liveStatusById = new Map();

// Item 2 Pass A — pure, DOM-free. `entry` is a liveStatusById value (or
// undefined/null — callers get null back so "no entry" renders nothing,
// covering both a never-refreshed game and a FINAL game the caller simply
// never looks up). `nowMs` is injectable for tests.
//
// State table:
//   no entry                          -> null (caller renders nothing / unchanged)
//   entry.name === STATUS_HALFTIME    -> { text: 'Halftime', pulse: false }
//   any other entry.name (in-progress,
//     STATUS_END_PERIOD, overtime, …) -> { text: entry.detail verbatim, pulse: true }
//   stale (now - capturedAt > 3min)   -> text gets ' · updated Nm ago' appended,
//                                        pulse forced false, no red (that's a
//                                        caller/CSS decision, not this helper's)
//
// Deliberately NOT handled here (Pass B's job, per the brief):
//   - FINAL games: caller simply never calls this for a final game (no-op)
//   - "never refreshed": indistinguishable from "no entry" — same null return
const LIVE_STATUS_STALE_MS = 3 * 60 * 1000;

export function liveStatusDisplay(entry, nowMs = Date.now()) {
  if (!entry) return null;
  const isHalftime = entry.name === 'STATUS_HALFTIME';
  let text  = isHalftime ? 'Halftime' : (entry.detail || '');
  let pulse = !isHalftime;
  const ageMs = nowMs - (entry.capturedAt ?? nowMs);
  if (ageMs > LIVE_STATUS_STALE_MS) {
    const mins = Math.floor(ageMs / 60000);
    text = text ? `${text} · updated ${mins}m ago` : `updated ${mins}m ago`;
    pulse = false;
  }
  return { text, pulse };
}

// Compact-surface variant — uses shortDetail (ESPN's own abbreviated text,
// falling back to detail if a payload is missing it) and enforces a ~14-char
// budget so the compact table/card can never wrap. Staleness still zeroes
// `pulse`, but the "· updated Nm ago" suffix is deliberately NOT appended
// here — there is no room for it inside the budget, and Pass B decides
// separately whether the compact surface needs its own staleness affordance.
const LIVE_STATUS_SHORT_BUDGET = 14;

export function liveStatusDisplayShort(entry, nowMs = Date.now()) {
  if (!entry) return null;
  const isHalftime = entry.name === 'STATUS_HALFTIME';
  const source = isHalftime ? 'Halftime' : (entry.shortDetail || entry.detail || '');
  let pulse = !isHalftime;
  const ageMs = nowMs - (entry.capturedAt ?? nowMs);
  if (ageMs > LIVE_STATUS_STALE_MS) pulse = false;
  const text = source.length <= LIVE_STATUS_SHORT_BUDGET
    ? source
    : source.slice(0, Math.max(0, LIVE_STATUS_SHORT_BUDGET - 1)) + '…';
  return { text, pulse };
}

export async function doRefreshScores(week,games) {
  // Which games should we ask ESPN about?
  //   - Regular CFB pipeline games (isManual falsy, espnEventId set)      → yes
  //   - Manual out-of-league games with FULL ESPN linking (both espnSport
  //     AND espnEventId set)                                              → yes
  //   - Manual games without a sport/ID (commissioner enters scores)      → no
  //   - Demo-tagged games                                                 → no
  //
  // The outer setupAutoRefresh already short-circuits demo/manual WEEKS, so
  // this per-game filter is the second line of defense for mixed slates.
  const refreshable = games.filter(g => {
    if (!g?.espnEventId) return false;
    if (g.dataSource === 'demo') return false;
    if (!g.isManual) return true;                       // normal CFB path
    return !!g.espnSport && !!g.espnEventId;            // manual w/ full ESPN linking
  });
  if (!refreshable.length) return;
  const{updated,errors,liveStatusByEventId}=await refreshScoresByEventIds(
    refreshable.map(g=>g.espnEventId).filter(Boolean), refreshable
  );
  for(const upd of updated){
    const stored=getGame(upd.gameId);
    if(!stored) continue;
    const wasFinal = stored.status===GAME_STATUS.FINAL;
    const wasLive  = stored.status===GAME_STATUS.LIVE;
    // Item 2 remediation — capture ESPN's raw live-status text into the
    // module-level, in-memory-only Map BEFORE the persisted save below.
    // Deliberately unconditional (every poll, any status) — Pass B's
    // renderers decide when to look it up. Looked up by espnEventId from
    // the sibling map data-provider.js returns — `upd` itself never carries
    // live status (see refreshScoresByEventIds()).
    const liveStatus = liveStatusByEventId?.get(String(upd.espnEventId));
    if (liveStatus) {
      liveStatusById.set(upd.gameId, { ...liveStatus, capturedAt: Date.now() });
    }
    // Item 2 Pass A: saveGame()'s object below is an EXPLICIT ALLOW-LIST of
    // persisted fields. detail/shortDetail/name/quarter/clock are
    // INTENTIONALLY NOT included — they're transient (liveStatusById, above)
    // and must never round-trip to the Sheet on every 30-60s live poll. Do
    // NOT "simplify" this to `{...stored, ...upd}` or add those keys here.
    saveGame({...stored,homeScore:upd.homeScore,awayScore:upd.awayScore,status:upd.status,actualWinner:upd.actualWinner,kickoff:upd.kickoff,kickoffConfirmed:upd.kickoffConfirmed,kickoffDateOnly:upd.kickoffDateOnly,lastUpdated:upd.lastUpdated});
    // v0.17.0 — kickoff system event + SCRIBE live observations
    try {
      const fresh0=getGame(upd.gameId);
      if (!wasLive && !wasFinal && upd.status===GAME_STATUS.LIVE) emitKickoffEvent(fresh0);
      if (upd.status===GAME_STATUS.LIVE) scribeLiveGameCheck(stored, fresh0);
    } catch(e){ console.warn('[refresh] live events', e); }
    // v0.16.0 — a game just went FINAL: post the ATS result to its chat thread.
    if (!wasFinal && upd.status===GAME_STATUS.FINAL) {
      try {
        const fresh=getGame(upd.gameId);
        const ats=calculateAtsWinner(fresh);
        if (ats) {
          saveGame({...fresh, atsWinner: ats});
          const gp=getPicks(week.weekId).filter(p=>p.gameId===upd.gameId);
          emitGameFinalEvent(fresh, ats,
            gp.filter(p=>p.selectedTeam===ats).map(p=>p.playerId),
            gp.filter(p=>p.selectedTeam!==ats&&ats!=='no_decision').map(p=>p.playerId));
        }
      } catch(e){ console.warn('[refresh] game-final event', e); }
    }
  }
  if(errors.length)console.warn('[Refresh]',errors);
}

// ─── EXPORT SUITE ─────────────────────────────────────────────────────────────
// All exports use Excel/Google-Sheets-friendly CSV with proper escaping for
// commas, quotes, and newlines. Full backup uses JSON for fidelity.

/** Properly escape a single CSV cell value */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
/** Rows -> CSV text */
function toCsv(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }
/** Trigger a download for the given content */
function downloadFile(content, filename, mime='text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}
/** Build a safe filename slug for a week */
function weekSlug(week) {
  if (!week) return 'no-week';
  const lbl = (week.roundLabel ? `wk${week.roundLabel}` : `wk${week.weekNumber}`).replace(/[^A-Za-z0-9._-]/g, '_');
  const range = [week.startDate, week.endDate].filter(Boolean).join('_to_');
  return range ? `${lbl}_${range}` : lbl;
}

/** Per-week — every pick + scoring outcome */
function exportWeekPicksCSV(week) {
  if (!week) { showToast('No week selected','error'); return; }
  const players=getPlayers().filter(p=>p.active);
  const games=getGames(week.weekId); const picks=getPicks(week.weekId);
  const rows=[['Week','Player','Initials','Alma Mater','Tiebreaker Guess','Game (Home)','Game (Away)','Kickoff','Locked Spread','Favorite','Multiplier','League Label','Picked','Result','ATS Winner','Home Score','Away Score']];
  for(const player of players){
    const tbGuess=getTiebreakerGuess(week.weekId,player.playerId);
    for(const game of games){
      const pick=picks.find(p=>p.playerId===player.playerId&&p.gameId===game.gameId);
      if(pick){
        const result=evaluatePick(pick,game);
        rows.push([
          formatWeekLabel(week), player.displayName, getPlayerInitials(player), player.almaMater||'',
          tbGuess??'',
          td(game,'home'), td(game,'away'),
          game.kickoff||'',
          game.lockedSpread??game.spread??'', game.favorite||'',
          game.multiplier??1, game.isManual ? (game.leagueLabel||'MANUAL') : '',
          pick.selectedTeam, result, game.atsWinner||'pending',
          game.homeScore??'', game.awayScore??'',
        ]);
      }
    }
  }
  downloadFile(toCsv(rows), `picks_${weekSlug(week)}.csv`);
  showToast('📥 Week picks CSV exported','success');
}

/** Per-week — the slate (games on the slate) */
export function exportWeekSlateCSV(week) {
  if (!week) { showToast('No week selected','error'); return; }
  const games=getGames(week.weekId);
  const rows=[['Game ID','ESPN ID','Home','Home Mascot','Away','Away Mascot','Home Conf','Away Conf','Home Rank','Away Rank','Kickoff','Time Window','Spread (home perspective)','Favorite','Locked Spread','Status','Home Score','Away Score','Actual Winner','ATS Winner','Alma Mater','National TV','Spread Source','Venue']];
  for(const g of games){
    rows.push([
      g.gameId, g.espnEventId||'',
      g.homeTeam, g.homeMascot||'',
      g.awayTeam, g.awayMascot||'',
      g.homeConference||'', g.awayConference||'',
      g.homeRank??'', g.awayRank??'',
      g.kickoff||'', g.timeWindow||'',
      g.spread??'', g.favorite||'',
      g.lockedSpread??'',
      g.status, g.homeScore??'', g.awayScore??'',
      g.actualWinner||'', g.atsWinner||'',
      g.isAlmaMaterGame?'yes':'no',
      g.nationalTV?'yes':'no',
      g.spreadSource||'',
      formatVenueDisplay(g)||g.venue||'',
    ]);
  }
  downloadFile(toCsv(rows), `slate_${weekSlug(week)}.csv`);
  showToast('📥 Week slate CSV exported','success');
}

/** Per-week — final weekly results / standings */
function exportWeekResultsCSV(week) {
  if (!week) { showToast('No week selected','error'); return; }
  const players=getPlayers().filter(p=>p.active);
  const games=getGames(week.weekId);
  const allPicks=getPicks(week.weekId);
  const actualTB=week.actualTiebreakerValue;
  const results=calculateWeeklyResults(week.weekId,players,allPicks,games,actualTB);
  const rows=[['Rank','Player','Correct (weighted)','Incorrect (weighted)','Correct (raw count)','Incorrect (raw count)','No Decisions','Tiebreaker Guess','Actual Tiebreaker','Delta','Winner','Loser','Won by Tiebreaker']];
  for(const r of results){
    rows.push([
      r.rank, r.displayName,
      r.correctPicks, r.incorrectPicks,
      r.correctCount ?? r.correctPicks, r.incorrectCount ?? r.incorrectPicks,
      r.noDecisions,
      r.tiebreakerGuess??'', actualTB??'',
      r.tiebreakerDelta??'',
      r.isWinner?'yes':'', r.isLoser?'yes':'',
      r.wonByTiebreaker?'yes':'',
    ]);
  }
  downloadFile(toCsv(rows), `results_${weekSlug(week)}.csv`);
  showToast('📥 Week results CSV exported','success');
}

/** Per-week — dashboard matrix (rows=games, cols=players) */
function exportWeekDashboardCSV(week) {
  if (!week) { showToast('No week selected','error'); return; }
  const players=getPlayers().filter(p=>p.active);
  const games=getGames(week.weekId).sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));
  const picks=getPicks(week.weekId);
  const submitted=players.filter(p=>picks.some(pk=>pk.playerId===p.playerId));
  const header=['Game','Spread','Status','ATS Winner', ...submitted.map(p=>p.displayName)];
  const rows=[header];
  for(const g of games){
    const sv=g.lockedSpread??g.spread;
    const spreadStr=sv!==null&&sv!==undefined?fmtSpread(sv,g.favorite,g):(g.status===GAME_STATUS.FINAL?'Final':'TBD');
    const ats=g.atsWinner||(g.status===GAME_STATUS.FINAL?calculateAtsWinner(g):'');
    const row=[`${td(g,'home')} vs ${td(g,'away')}`, spreadStr, g.status, ats||''];
    for(const p of submitted){
      const pk=picks.find(pp=>pp.gameId===g.gameId&&pp.playerId===p.playerId);
      if(!pk){row.push('');continue;}
      const r=evaluatePick(pk,g);
      const tag={win:'WIN',loss:'LOSS',no_decision:'ND',live:'LIVE',pending:''}[r]||'';
      row.push(`${pk.selectedTeam}${tag?' ['+tag+']':''}`);
    }
    rows.push(row);
  }
  downloadFile(toCsv(rows), `dashboard_${weekSlug(week)}.csv`);
  showToast('📥 Week dashboard matrix CSV exported','success');
}

/** Per-week — bundle: kicks off all four week-scoped CSVs sequentially */
function exportWeekBundle(week) {
  if (!week) { showToast('No week selected','error'); return; }
  exportWeekSlateCSV(week);
  setTimeout(()=>exportWeekPicksCSV(week), 250);
  setTimeout(()=>exportWeekResultsCSV(week), 500);
  setTimeout(()=>exportWeekDashboardCSV(week), 750);
  showToast('📦 Week bundle: 4 CSV files downloading','success');
}

/** League-wide — players */
function exportPlayersCSV() {
  const players=getPlayers();
  const rows=[['Player ID','Display Name','Initials','Alma Mater','Email','Active','Created']];
  for(const p of players){
    rows.push([p.playerId,p.displayName,p.initials||'',p.almaMater||'',p.email||'',p.active?'yes':'no',p.createdAt||'']);
  }
  downloadFile(toCsv(rows), `players.csv`);
  showToast('📥 Players CSV exported','success');
}

/** League-wide — season standings */
function exportStandingsCSV() {
  const players=getPlayers().filter(p=>p.active);
  const allWeeksRaw=getWeeks();
  const visibleWeekIds=new Set(allWeeksRaw.filter(w=>w.showInHistory!==false).map(w=>w.weekId));
  const allResults=getWeeklyResults().filter(r=>visibleWeekIds.has(r.weekId));
  // UN-118/UN-125 — the audit export must match what Standings shows on
  // screen: one weekly win/loss per competitive-week group, not per record.
  const standings=calculateSeasonStandings(players,allResults,allWeeksRaw);
  const rows=[['Rank','Player','Total Correct','Total Incorrect','Total No Decision','Weekly Wins','Weekly Losses','Win %']];
  for(const s of standings){
    rows.push([s.currentRank,s.displayName,s.totalCorrect,s.totalIncorrect,s.totalND,s.weeklyWins,s.weeklyLosses,s.winPct]);
  }
  downloadFile(toCsv(rows), `standings_season.csv`);
  showToast('📥 Standings CSV exported','success');
}

/** League-wide — all weekly results across every visible week */
function exportAllWeeklyResultsCSV() {
  const allResults=getWeeklyResults();
  const weeksById=Object.fromEntries(getWeeks().map(w=>[w.weekId,w]));
  // UN-118/UN-125 (DI-126e) — this export is the audit trail, so it keeps
  // ONE ROW PER MEMBER (per-part granularity is preserved, never collapsed
  // here) and adds a 'Group' column carrying the canonical group id, so an
  // auditor can see which rows belong to the same competitive week by
  // matching that column — the same "raw id alongside the label" pattern
  // DI-125's Week column already established.
  const rows=[['Week','Group','Show in History','Player','Rank','Correct (weighted)','Incorrect (weighted)','Correct (raw)','Incorrect (raw)','No Decisions','Tiebreaker Guess','Tiebreaker Delta','Winner','Loser','Won by Tiebreaker']];
  for(const r of allResults){
    const w=weeksById[r.weekId];
    rows.push([
      w?formatWeekLabel(w):r.weekId,
      w?getEffectiveGroupId(w):'',
      w?(w.showInHistory!==false?'yes':'no'):'',
      r.displayName, r.rank,
      r.correctPicks, r.incorrectPicks,
      r.correctCount ?? r.correctPicks, r.incorrectCount ?? r.incorrectPicks,
      r.noDecisions,
      r.tiebreakerGuess??'', r.tiebreakerDelta??'',
      r.isWinner?'yes':'', r.isLoser?'yes':'', r.wonByTiebreaker?'yes':'',
    ]);
  }
  downloadFile(toCsv(rows), `weekly_results_all.csv`);
  showToast('📥 All weekly results CSV exported','success');
}

/** League-wide — obligations */
/**
 * Pure row-builder, exported so loadtest.mjs can assert on it without a DOM.
 * The Status column emits `o.status` VERBATIM (not the mapped display label)
 * — this is the commissioner's audit trail, and 'pending' must read distinct
 * from 'unpaid'/'paid' or the approval feature's whole point (an in-flight
 * claim is not yet settled) is invisible to the export.
 *
 * UN-126 — five more columns so a voided or merged record's state is
 * VISIBLE in the export (design constraint: excluded from what players see,
 * but the audit trail in the CSV must stay complete). Legacy rows that
 * predate this ship with none of the five fields — every accessor below
 * defaults to '' rather than 'undefined' or throwing (CONVENTIONS #10).
 */
export function buildObligationsCsvRows(obs, playersById, weeksById) {
  const rows=[['Obligation ID','Type','Week','Payer','Recipient','Amount/Prize','Status','Created','Paid At','Needs Review','Voided','Void Reason','Merged Into','Merged From']];
  for(const o of obs){
    const w=weeksById[o.weekId];
    rows.push([o.obligationId,o.type,w?formatWeekLabel(w):o.weekId,
      playersById[o.payerPlayerId]||o.payerPlayerId, playersById[o.recipientPlayerId]||o.recipientPlayerId,
      o.amountOrPrize||'', o.status, o.createdAt||'', o.paidAt||'',
      o.needsReview?'yes':'', o.voided?'yes':'', o.voidReason||'',
      o.mergedInto||'', (o.mergedFrom&&o.mergedFrom.length)?o.mergedFrom.join('; '):'']);
  }
  return rows;
}

function exportObligationsCSV() {
  const obs=getObligations();
  const players=Object.fromEntries(getPlayers().map(p=>[p.playerId,p.displayName]));
  const weeks=Object.fromEntries(getWeeks().map(w=>[w.weekId,w]));
  const rows = buildObligationsCsvRows(obs, players, weeks);
  downloadFile(toCsv(rows), `obligations.csv`);
  showToast('📥 Obligations CSV exported','success');
}

/**
 * UN-123 — pure row-builder for the feedback CSV export, same precedent as
 * buildObligationsCsvRows above: exported so loadtest.mjs can assert on it
 * without a DOM. Per Drew's stated purpose — feeding this into a coding
 * agent months later — the Description column is NEVER truncated here; only
 * the on-screen list (renderFeedbackAdmin) truncates for display. Legacy
 * entries (no `kind`/`weekId`) default rather than throw (CONVENTIONS #10).
 *
 * WEEK IS TWO COLUMNS (Drew, 2026-08-12): "The week column should include both
 * the formatted label and the raw weekID that way there is no discrepancy."
 * The first shipped version emitted only the raw id here while the on-screen
 * list resolved it to a label, so the two surfaces disagreed about the same
 * record. Two columns rather than one packed cell: the raw id stays a clean
 * join/filter key for a spreadsheet or a coding agent, and the label stays
 * readable, without anyone having to parse "Week 1 Part 1 (wk_2026_01a)".
 *
 * `weeksById` is optional so the builder stays pure and callable with no
 * arguments in a test; an unknown or absent week yields '—' for the label and
 * the raw id is still emitted, so a row is never silently unattributable.
 */
/**
 * Item 10 (DI-B1) — `excludedIds` defaults to the live per-id exclude set
 * (getExcludedFeedbackIds()) so exportFeedbackCSV()'s real call site needs no
 * extra argument, exactly like `weeksById`'s default above. Pass an explicit
 * array (including []) to keep the builder pure for a test. A row whose id
 * is in the set is skipped entirely — DEFAULT INCLUDED (CONVENTIONS #10): a
 * row with no id, or an id not in the set, is never skipped.
 */
export function buildFeedbackCsvRows(entries, weeksById = null, excludedIds = null) {
  const excluded = new Set(excludedIds !== null ? excludedIds : getExcludedFeedbackIds());
  const rows = [['Feedback ID', 'Date', 'Name', 'Type', 'Week', 'Week ID', 'App Version', 'Description']];
  for (const e of entries) {
    if (e.id && excluded.has(e.id)) continue;
    const wk = e.weekId && weeksById ? weeksById[e.weekId] : null;
    rows.push([
      e.id || '',
      e.submittedAt || '',
      e.name || '',
      feedbackKindLabel(e.kind),
      wk ? formatWeekLabel(wk) : '—',
      e.weekId || '',
      e.appVersion || '',
      e.body || '',
    ]);
  }
  return rows;
}

function exportFeedbackCSV() {
  const allEntries = getFeedback();
  // WARN, don't silently export a header-only CSV (Item 10 / DI-B1) — if
  // every entry that exists is also in the excluded set, there is nothing to
  // download. `allEntries.length` guards the trivially-empty-store case too
  // (no entries at all is not "everything excluded" and keeps its own
  // existing empty-state messaging via the export itself).
  if (allEntries.length) {
    const excludedIds = getExcludedFeedbackIds();
    const allExcluded = allEntries.every(e => e.id && excludedIds.includes(e.id));
    if (allExcluded) {
      showToast('⚠️ Every feedback item is excluded — nothing to export. Re-check at least one item first.', 'error');
      return;
    }
  }
  const rows = buildFeedbackCsvRows(allEntries, Object.fromEntries(getWeeks().map(w => [w.weekId, w])));
  downloadFile(toCsv(rows), `feedback.csv`);
  showToast('📥 Feedback CSV exported','success');
}

/** Full backup — single JSON file */
function exportFullBackupJSON() {
  const dump=exportAllData();
  const filename=`cfb_pickems_full_backup_${new Date().toISOString().slice(0,10)}.json`;
  downloadFile(JSON.stringify(dump,null,2), filename, 'application/json');
  showToast('💾 Full backup (JSON) exported','success');
}

/** Full CSV bundle — every table as its own CSV, downloaded sequentially */
function exportFullCsvBundle() {
  exportPlayersCSV();
  setTimeout(exportStandingsCSV, 200);
  setTimeout(exportAllWeeklyResultsCSV, 400);
  setTimeout(exportObligationsCSV, 600);
  // Per-week exports for every visible week
  const weeks=getWeeks().sort((a,b)=>a.weekNumber-b.weekNumber);
  let i=0;
  for(const w of weeks){
    setTimeout(()=>exportWeekSlateCSV(w), 800 + i*200); i++;
    setTimeout(()=>exportWeekPicksCSV(w), 800 + i*200); i++;
    setTimeout(()=>exportWeekResultsCSV(w), 800 + i*200); i++;
    setTimeout(()=>exportWeekDashboardCSV(w), 800 + i*200); i++;
  }
  showToast(`📦 Full CSV bundle: ${4 + weeks.length*4} files downloading`,'success');
}

// ─── RULES HELPERS ────────────────────────────────────────────────────────────

function getRulesEditorText(useDefault=false) {
  const{customRules}=getSettings();
  const rules=(!useDefault&&customRules)?customRules:DEFAULT_RULES;
  return rules.map(s=>`## ${s.section}\n${s.items.map(i=>`- ${i}`).join('\n')}`).join('\n\n');
}

function parseRulesText(text) {
  const lines=[];let cur=null;
  for(const line of text.split('\n')){
    const t=line.trim();
    if(t.startsWith('## ')){if(cur)lines.push(cur);cur={id:`r_${Date.now()}`,section:t.slice(3).trim(),items:[]};}
    else if(t.startsWith('- ')&&cur)cur.items.push(t.slice(2).trim());
  }
  if(cur)lines.push(cur);
  return lines.length?lines:null;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

/** Format spread for a game — always shows favored team with negative number.
 *  Accepts (spread, favorite) or (spread, favorite, game) for fallback derivation. */
function fmtSpread(spread, favorite, game = null) { return formatSpread(spread, favorite, game); }

/** Format spread directly from a game object (preferred — handles all fallbacks). */
function spreadFromGame(game) {
  if (!game) return 'TBD';
  const sv = game.lockedSpread !== null ? game.lockedSpread : game.spread;
  return formatSpread(sv, game.favorite, game);
}

/** Team display "School (Mascot)" — uses explicit mascot or TEAM_MASCOT_LOOKUP fallback. */
function td(game, side='home') { return getTeamDisplay(game, side); }

/** Just the school name (no mascot) — used in dashboard matrix + alma mater watch
 *  where the mascot adds visual noise without clarifying anything. */
function teamSchool(game, side='home') {
  if (!game) return '';
  return (side === 'home' ? game.homeTeam : game.awayTeam) || '';
}

/** Bare-matchup "Away @ Home" using just school names. */
function matchupBare(game) {
  if (!game) return '';
  const sep = game.neutralSite ? 'vs' : '@';
  return `${teamSchool(game,'away')} ${sep} ${teamSchool(game,'home')}`;
}

/**
 * Small chip cluster shown on game rows / cards: multiplier ("2x") and
 * out-of-league label ("NFL"). Both are conditional — a normal 1x CFB game
 * gets nothing. Returns an empty string when nothing to show so callers can
 * concat safely.
 */
function renderGameBadges(game) {
  if (!game) return '';
  const parts = [];
  const m = Number(game.multiplier);
  if (Number.isFinite(m) && m > 0 && m !== 1) {
    // Format 2 → "2x", 1.5 → "1.5x", 3 → "3x"
    const label = (m % 1 === 0) ? `${m}x` : `${m}x`;
    parts.push(`<span class="mult-badge" title="This game counts as ${m}× toward standings">${label}</span>`);
  }
  if (game.isManual && game.leagueLabel) {
    parts.push(`<span class="league-chip" title="Out-of-league / one-off game">${escHtml(game.leagueLabel)}</span>`);
  }
  return parts.join('');
}

/**
 * Priority 7: order players for the dashboard view.
 *  - The logged-in player ALWAYS lands in position 0 (their own column is the
 *    most personally relevant — easiest to scan on mobile).
 *  - After that, apply the user's saved drag-reorder from
 *    settings.dashboardColumnOrder (per-device). Any players not in the saved
 *    order get appended in their natural order.
 *  - New players (just added to the league) appear at the end until reordered.
 */
function getOrderedPlayersForDashboard(players, viewerPlayerId) {
  const order = getSettings().dashboardColumnOrder || [];
  const byId = new Map(players.map(p => [p.playerId, p]));
  const result = [];
  const seen = new Set();
  // Step 1: viewer's column first (if they're in the players list)
  if (viewerPlayerId && byId.has(viewerPlayerId)) {
    result.push(byId.get(viewerPlayerId));
    seen.add(viewerPlayerId);
  }
  // Step 2: walk saved order, skipping viewer (already placed)
  for (const pid of order) {
    if (seen.has(pid)) continue;
    const p = byId.get(pid);
    if (p) { result.push(p); seen.add(pid); }
  }
  // Step 3: any new players not in saved order (natural order)
  for (const p of players) {
    if (!seen.has(p.playerId)) result.push(p);
  }
  return result;
}

/** Persist the new player-column order (per device). */
function setDashboardColumnOrder(playerIds) {
  saveSetting('dashboardColumnOrder', playerIds);
}

/**
 * Hand-curated short abbreviations for major FBS programs. Used in compact
 * dashboard chips where horizontal space is at a premium. Keys are exact
 * school names (matching what ESPN / the data provider returns).
 *
 * Why this exists: the previous implementation took the last word of the
 * school name ("Texas State" → "State"), which collapsed many schools to the
 * same 4-letter token. This table gives each well-known program a unique
 * abbreviation; unknown schools fall through to a smart-truncate that
 * preserves words like "State", "Tech", "A&M".
 */
// TEAM_ABBR + buildAbbrMap moved to data-model.js (v0.17.2) — shared with chat.

/**
 * Render a game as "Away @ Home" (CFB convention — @ reads "at").
 * For neutral-site games we use "vs" instead and omit the home indicator.
 *  - sep: optional override ('@' or 'vs')
 *  - showH: append " (H)" after the home team (default false to keep things tight)
 */
function matchup(game, { sep, showH = false } = {}) {
  if (!game) return '';
  const sepStr = sep || (game.neutralSite ? 'vs' : '@');
  const home = td(game, 'home') + (showH && !game.neutralSite ? ' (H)' : '');
  return `${td(game, 'away')} ${sepStr} ${home}`;
}

function emptyState(icon,title,msg){
  return`<div class="empty-state"><div class="empty-state-icon">${icon}</div><h3>${title}</h3><p class="text-secondary text-sm mt-sm">${msg}</p></div>`;
}

function escHtml(s){
  if(!s)return'';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg,type='success'){
  const c=document.getElementById('toast-container');if(!c)return;
  const t=document.createElement('div');t.className=`toast ${type}`;t.innerHTML=msg;c.appendChild(t);
  setTimeout(()=>{t.style.cssText+='opacity:0;transition:opacity .3s';setTimeout(()=>t.remove(),300);},3200);
}


// ─── SITE PIN GATE ────────────────────────────────────────────────────────────

function showSitePinGate() {
  // v0.16.0 — the gate is now an OVERLAY on top of the (already booted) app,
  // instead of nuking document.body and reloading on success. Killing the
  // reload removes the entire second boot + second Apps Script hydrate that
  // caused the old post-PIN blank screen. Background hydration continues while
  // the user types, so by the time the PIN lands the data is usually fresh.
  const s = getSettings();
  const titleTop  = s.welcomeTitleTop  || 'welcome to';
  const titleMain = s.welcomeTitleMain || (s.welcomeTitle ? s.welcomeTitle.replace(/^welcome to\s*/i,'') : "irb pick 'ems");
  const subtitle  = s.welcomeSubtitle || 'enter access pin';
  document.getElementById('site-gate-overlay')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'site-gate-overlay';
  wrap.innerHTML = `
    <div class="site-gate">
      <div class="site-gate-inner">
        <div class="site-gate-title-top">${escHtml(titleTop)}</div>
        <div class="site-gate-title">${escHtml(titleMain)}</div>
        <div class="site-gate-subtitle">${escHtml(subtitle)}</div>
        <input class="site-gate-input" id="site-pin-input" type="password" inputmode="numeric"
          maxlength="8" placeholder="_ _ _ _" autocomplete="off" />
        <div class="site-gate-error" id="site-gate-error" style="display:none">incorrect pin</div>
        <button class="site-gate-btn" id="site-gate-submit">enter</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const input = document.getElementById('site-pin-input');
  const errEl = document.getElementById('site-gate-error');
  const submit = () => {
    const pin = input?.value || '';
    if (verifySitePin(pin)) {
      setSiteUnlocked(true);
      wrap.remove();                                  // instant — no reload
      navigateTo(state.currentTab || 'dashboard');
    } else {
      if (errEl) errEl.style.display = 'block';
      if (input) { input.value = ''; input.focus(); }
    }
  };
  document.getElementById('site-gate-submit')?.addEventListener('click', submit);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input?.focus(), 100);
}

window.navigateTo=navigateTo;
// Batch 3+4 item A/F — chat-ui.js cannot import app.js (app.js already imports
// chat-ui.js; the reverse would be a cycle), so these two are exposed on
// window as the same bridge window.navigateTo already establishes:
//   - showToast: item A's "Chat has been turned off…" redirect toast.
//   - livePickStatus: item F's game-thread header colors reuse this VERBATIM
//     rather than re-deriving covering/trailing in chat-ui.js.
window.showToast=showToast;
window.livePickStatus=livePickStatus;
