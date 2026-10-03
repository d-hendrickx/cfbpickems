/**
 * CFB Pickems — home.js (Social Platform v1 Home, DI-366 / DI-367 / DI-368 / DI-371 / DI-372 / DI-373, 2026-10-01)
 * ================================================================================================================
 * The Home tab's RENDERER. js/stats-core.js / js/stats.js / js/feed-cards.js / js/feed-caption-lines.js (the pure,
 * reviewed modules) decide WHAT may be on the feed; this file assembles the snapshot they read, orders what they
 * return, paints it, and owns every state the screen can be in. Nothing here is wired into the app yet: the
 * wiring window (app.js / index.html / service-worker.js, serialized, after Drew picks the centre-tab treatment)
 * only CONNECTS the injected dependencies below — every one is a parameter, so every one is tested with a fake.
 *
 * ── THE INJECTED DEPENDENCIES (createHome's one argument) ────────────────────────────────────────────────────────
 * REQUIRED (a missing one THROWS a TypeError at construction — a wiring mistake fails at boot, never at a paint):
 *   escHtml               the app's one escaper (S-C6). Never defaulted, never optional, never a `String` fallback.
 *   isContentWithheld     app.js's identity gate (S-C7). ALWAYS passed — and handed on to deriveCards as its belt.
 *   confirmedStatusFor    (week) -> the SERVER-CONFIRMED status, falling back to week.status (later sb.getConfirmedWeekStatus).
 *   picksReadConfirmed    (weekId) -> boolean (later sb.picksReadWhilePublic, RG-255). Asked only in supabase mode.
 *   renderCompact         the Now card's compact-dashboard callback (later renderDashboardCompact). Called ONLY once
 *                         arePicksPublic(week) is true — never in draft / open / locked.
 *   chatCandidates        ({leagueId, weeks, games, now, timezone}) -> {scribe, lockerRoom}, each candidate STAMPED with the
 *                         league id it was read under. makeChatCandidateSource() below builds one from chat's own primitives.
 *   getContainer          () -> the element Home paints into (#page-home).
 *   currentIdentityKey    () -> the identity tuple string (app.js's own, INJECTED by the wiring lambda — never exported from app.js,
 *                         per the coordinator's ruling) — the async paints' RG-174/176 re-check.
 *   getCurrentTab         () -> the active tab key.
 * OPTIONAL: onAction (navigation: go-tab / build-slate), haptic (defaults to js/haptics.js — native-only, a no-op on web),
 *   fetchNews + renderNewsCard (UX-2's typed slot — absent means the news slot does not exist), isDataReady, now,
 *   read (storage-reader overrides for tests). There is deliberately NO league-sync dependency and NO banner dependency:
 *   Home cannot raise the league's red banner at all (see PULL-TO-REFRESH below).
 *
 * ── PULL-TO-REFRESH: HOME DOES NOT BIND IT (wiring contract) ─────────────────────────────────────────────────────
 * Home never calls `bindPullToRefresh`. The window binder is WeakMap-idempotent and is already bound ONCE, with
 * `runManualSync`, for every tab; a second bind for the same element is ignored. The wiring is therefore one branch in
 * `makeRunManualSync` (app.js), after its hydrate / ACTIVE check:
 *     else if (state.currentTab === 'home') await homeView.refresh();
 * A LEAGUE failure is `runManualSync` throwing before it ever reaches that line, which lands in the binder's existing
 * `onFail` -> `showSyncFailureBanner` (the one league banner, de-duplicated against the offline banner). So `refresh()`
 * is ONLY the forced NEWS leg plus a repaint: it never re-runs the league sync and has no way to raise a banner. A news
 * failure becomes the news slot's calm inline error. It never rejects; it resolves true when it repainted and false when
 * a re-check refused the paint (withheld / identity moved / left Home).
 *
 * ── THE RULES THIS FILE LIVES BY ─────────────────────────────────────────────────────────────────────────────────
 *   THE BLIND RULE (SD-5). No pick content and no per-game aggregate for an open or locked week, on any card. The
 *     gates are feed-cards' (isRevealed -> arePicksPublic and nothing else; NEVER canViewOtherPicks — this file does
 *     not import it); this file adds: the S-C2 revealed view built ONCE in assembleHomeSnapshot, the S-C10
 *     picksReadConfirmed flag, the S-C3 own-pick filter on the Now card, and a week-reveal gate on SCRIBE posts.
 *   S-C7. renderHome() and EVERY async continuation (pull-to-refresh, news arrival, a retry) re-check
 *     isContentWithheld() AFTER the await, then the identity key, then the tab, before touching the DOM.
 *   S-C6. Every dynamic string reaches markup through the injected escHtml AT THE SINK. cardCopy() is asked for
 *     PLAIN text (the identity formatter `plainText`) and its result is escaped where it is interpolated — one escape,
 *     in one place, provable by xsstest. Finished fragments that come from OUTSIDE (UX-2's news card, the injected
 *     compact dashboard) are SPLICED, never interpolated, by the one `joinHtml` helper — the news contract says insert
 *     the returned HTML as-is. Numbers cross through numStr(), never raw.
 *   S-C8. Read-and-render only: no save(), no sendEvent(), no adapter write, no chat.js import (hometest scans).
 *   S-C11. Chat-derived cards need the chat engine bound to the CURRENT league; a candidate without the league stamp
 *     is dropped (fail closed).
 *   Reads stay synchronous (CONVENTIONS #9); no localStorage (the seam); no Math.random; iOS 15.0 safe (no Object.hasOwn / .at()).
 *
 * ── BETWEEN SEASONS (coordinator ruling, 2026-10-01 — DI-364's filler is NOT built) ───────────────────────────────
 * DI-364 says js/recap.js's `renderSeasonSummaryHTML()` appears as feed filler once every week is final. It is NOT used
 * here, for three concrete reasons: (1) it shows the WRONG season's data — recap.js:189 summarises the PREVIOUS season
 * (it was written for the Week-1 footer of the next one), so between seasons it would present last year as this year's
 * close; (2) its ledger line prints per-player amounts ("Ledger carried into this season … payable in person") and its
 * chrome is emoji (D-1); (3) it is not a `.feed-card` shell, so it cannot sit in this feed as one of its cards. In v1 a
 * league between seasons shows the Now card ("Week N was the last one. Nothing new yet — check back once the next week
 * opens."), whatever stat / SCRIBE / Locker Room cards exist, and then the end marker. A ledger-free season filler is a
 * separate, later card (ledger §6); this file imports nothing from recap.js and hometest pins that.
 * "Between seasons" itself is the newest week being final for more than 28 days — the coordinator's ruling: a 14-day gap
 * occurs mid-December, between the conference championships and the CFP, and must still read as "final", not "over".
 */

import {
  arePicksPublic, getWeeks, getGames, getPicks, getPlayers, getWeeklyResults, getWeekProgress,
  getCurrentWeek, getActiveWeekId, getSession, getTimezone, getBackendMode,
} from './storage.js';
import { getActiveLeagueId } from './auth.js';
import { buildRevealedView, deriveCards, cardCopy, requireEscHtml, isWagerReceipt } from './feed-cards.js';
import { captionFor } from './feed-caption-lines.js';
import { computeCommissionerOpsPlan, LOCKING_SOON_MS } from './reminder-rules.js';
import { buildCopy } from './notify-copy.js';
import { computeFirstKickoff, computeEffectiveLockAt, calculateAtsWinner } from './scoring.js';
import { atsMarginOf, sortWeeks } from './stats.js';
import { formatGameTime, weeksInGroup, getEffectiveGroupId, TIME_ZONES } from './data-model.js';
import { icon } from './icons.js';
import { haptic as nativeHaptic } from './haptics.js';

// ═══ constants (every number the screen's behaviour hangs on is named, exported and tested) ═══════════════════════

export const HOME_TAB = 'home';
/** Newest-first cap on non-news cards (a season is hundreds; the DOM never needs them all). No pagination UI in v1. */
export const FEED_CARD_LIMIT = 40;
/** SCRIBE's chat history is long; the feed carries the newest few, never all of it. */
export const SCRIBE_POST_LIMIT = 10;
export const SKELETON_CARD_COUNT = 4;
export const NEWS_SKELETON_COUNT = 2;
/** UX-2's density rule (News needs doc, Open Decision #8): at most ONE news card per four non-news cards… */
export const NEWS_PER_NON_NEWS = 4;
/** …cap of EIGHT before the end marker… */
export const NEWS_MAX_CARDS = 8;
/** …and nothing older than 48 hours (rankNews already filters; the merge re-checks). */
export const NEWS_FRESHNESS_MS = 48 * 60 * 60 * 1000;
export const NEWS_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** UX-2's cache TTL: a ready slot older than this refetches quietly behind the cards already on screen. */
export const NEWS_STALE_MS = 15 * 60 * 1000;
/** DI-364's "Between seasons" needs a rule the DI does not state: the newest week is final and has been for this long — 28 days, the coordinator's ruling (a 14-day gap happens mid-December, between the conference championships and the CFP). State copy only — no season-summary filler; see the header. */
export const BETWEEN_SEASONS_AFTER_MS = 28 * 24 * 60 * 60 * 1000;
/** DI-364 / note (e): the near-kickoff threshold IS reminder-rules' LOCKING_SOON_MS (60 minutes) — one threshold, not two. */
export const NOW_NEAR_KICKOFF_MS = LOCKING_SOON_MS;

/** The only actions a Home button may carry, and the only tabs / commissioner tabs they may name (the DOM is untrusted input). */
export const HOME_ACTIONS = Object.freeze(['go-tab', 'build-slate', 'retry-news', 'retry-load']);
export const ACTION_TABS = Object.freeze(['picks', 'dashboard', 'commissioner']);
export const ACTION_COMM_TABS = Object.freeze(['week', 'games']);
const HAPTIC_KINDS = Object.freeze(['medium', 'light']);

/** UX-2's DI-380 copy for the news slot's three calm states, verbatim. */
export const NEWS_COPY = Object.freeze({
  empty: 'No headlines yet for your sports.\nCheck back later.',
  error: 'News is temporarily unavailable.',
  retry: 'Retry',
});
export const ERROR_COPY = Object.freeze({
  title: "Home couldn't load this feed.",
  body: 'Pull down to try again.',
  retry: 'Retry',
});

/** Types whose body IS the content (the message text itself): they always keep it, and a caption never replaces it. */
export const BODY_IS_CONTENT = Object.freeze(['scribe.post', 'lockerroom.top']);

const NUDGE_COMM_TAB = Object.freeze({
  SLATE_NOT_BUILT: 'games', DRAFT_PAST_OPEN: 'week', OPEN_NO_LOCK_TIME: 'week', LIVE_NOT_FINALIZED: 'week',
});

/** The eyebrow glyph per card type — entries that already existed in js/icons.js, plus the three DI-367 added. */
export const CARD_ICON = Object.freeze({
  'slate.published': 'calendarWeek', 'picks.submitted': 'calendarWeek', 'week.revealed': 'unlock',
  'game.final': 'trophy', 'called.it': 'flame', 'stood.alone': 'flame',
  'week.result': 'trophy', 'player.week': 'flame', 'rank.changed': 'rankUp',
  'streak.extended': 'flame', 'streak.broken': 'flame', 'milestone.reached': 'trophy',
  'year.ago': 'calendarWeek', 'scribe.post': 'scribeSpark', 'lockerroom.top': 'chatBubble',
});

// ═══ small pure helpers ═══════════════════════════════════════════════════════════════════════════════════════════

const asArray = (v) => (Array.isArray(v) ? v : []);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
/** Cards render cached text; a card never carries a number as markup. A number crosses as a finite string, or as nothing. */
const numStr = (v) => { if (v === null || v === undefined || String(v).trim() === '') return ''; const n = Number(v); return Number.isFinite(n) ? String(n) : ''; };
const toMs = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const ms = v ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};
/** cardCopy() asks its escaper to format every fact. Home asks for PLAIN text and escapes at the sink (see the header, S-C6). */
const plainText = (v) => String(v === null || v === undefined ? '' : v);
/** The ONE place finished fragments are concatenated (see the header): every piece is either a literal, an escaped
 *  template built in this file, or a fragment handed in from outside (news card, compact dashboard). */
const joinHtml = (parts) => parts.join('');
/** A chrome glyph from js/icons.js (a hand-authored constant SVG — never data), spliced beside its class: the second place markup is concatenated, and the only place icon() is called. */
const glyphSpan = (className, name) => joinHtml(['<span class="', className, '" aria-hidden="true">', icon(name), '</span>']);

/** "2d 4h" / "3h 12m" / "8m" — app.js's own timeUntil() style, so a countdown reads the same on every surface. */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return 'under a minute';
}

/** The calendar day (YYYY-MM-DD) a timestamp falls on in the viewer's league time zone (CONVENTIONS #19: render-time). */
export function dayKeyInTz(ms, tzKey) {
  const iana = (TIME_ZONES.find(z => z.key === tzKey) || TIME_ZONES[0]).iana;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * S-C3 — the viewer's OWN pick on one game, or null. FAIL CLOSED: an absent / empty / non-string viewer id returns null
 * whatever `picks` holds, and a pick is only ever matched on `p.playerId === viewerId` (never "the first pick found"). This is
 * the cross-thread `ownPickTeamNames` semantics (UX-2's newsRank.js ships the same rule); reconciled at the wiring window.
 */
export function ownPickTeam(picks, gameId, viewerId) {
  if (!isNonEmptyString(viewerId) || !isNonEmptyString(gameId)) return null;
  const p = asArray(picks).find(x => x && x.gameId === gameId && x.playerId === viewerId);
  return p && isNonEmptyString(p.selectedTeam) ? p.selectedTeam : null;
}

const kickoffOrder = (a, b) => (toMs(a.kickoff) - toMs(b.kickoff)) || String(a.gameId).localeCompare(String(b.gameId));

// ═══ dependencies ═════════════════════════════════════════════════════════════════════════════════════════════════

const REQUIRED_DEPS = Object.freeze([
  'escHtml', 'isContentWithheld', 'confirmedStatusFor', 'picksReadConfirmed', 'renderCompact',
  'chatCandidates', 'getContainer', 'currentIdentityKey', 'getCurrentTab',
]);

/** The storage readers, overridable one by one (tests hand in arrays; production reads the seam — synchronously). */
function readersFrom(read) {
  const r = (read && typeof read === 'object') ? read : {};
  return {
    weeks: r.weeks || getWeeks,
    games: r.games || (() => getGames()),
    picks: r.picks || (() => getPicks()),
    players: r.players || getPlayers,
    weeklyResults: r.weeklyResults || (() => getWeeklyResults()),
    weekProgress: r.weekProgress || getWeekProgress,
    currentWeek: r.currentWeek || getCurrentWeek,
    activeWeekId: r.activeWeekId || getActiveWeekId,
    viewer: r.viewer || getSession,
    timezone: r.timezone || getTimezone,
    leagueId: r.leagueId || getActiveLeagueId,
    isSupabase: r.isSupabase || (() => getBackendMode() === 'supabase'),
  };
}

function resolveDeps(deps) {
  const d = (deps && typeof deps === 'object') ? deps : {};
  for (const name of REQUIRED_DEPS) {
    if (name === 'escHtml') requireEscHtml(d.escHtml, 'createHome');
    else if (typeof d[name] !== 'function') throw new TypeError(`createHome() requires an injected ${name} function (S-C7 / DI-366: Home never defaults a gate)`);
  }
  return {
    ...d,
    read: readersFrom(d.read),
    onAction: typeof d.onAction === 'function' ? d.onAction : () => {},
    haptic: typeof d.haptic === 'function' ? d.haptic : nativeHaptic,
    now: typeof d.now === 'function' ? d.now : () => Date.now(),
    isDataReady: typeof d.isDataReady === 'function' ? d.isDataReady : () => true,
    fetchNews: typeof d.fetchNews === 'function' ? d.fetchNews : null,
    renderNewsCard: typeof d.renderNewsCard === 'function' ? d.renderNewsCard : null,
    groupTieContexts: typeof d.groupTieContexts === 'function' ? d.groupTieContexts : null,   // optional: ({ allWeeks, players }) -> Map<groupId, TieContext> (SP-54: Standings' own builder, injected by the app)
    newsEmptyCopy: typeof d.newsEmptyCopy === 'function' ? d.newsEmptyCopy : null,   // optional: () -> string | null, the news slot's EMPTY line when the source has a more specific reason
  };
}

// ═══ chat candidates (DI-372: S-C8 / S-C11 / note c / security C2) ═══════════════════════════════════════════════

/**
 * SECURITY C2 — SCRIBE posts reach Home through the BLIND-GATED path ONLY. The path is: chat.js's own `getMessages`
 * (its one choke point, which already applies the epoch and retention rules) -> the private-row / wager-receipt /
 * deleted exclusions -> a WEEK-REVEAL GATE here. Home never asks SCRIBE to generate anything and never reads a
 * SCRIBE pool: it repaints a message that was already posted. The week gate is the belt over the generators' own
 * `arePicksPublic` checks: a SCRIBE message that NAMES a week (`meta.weekId`) or a game (`meta.gameId` and / or `gameTag`)
 * is withheld until EVERY week it names is public — so an older post written under a looser rule can never reach a
 * passively scrolled feed early. The gate is CONJUNCTIVE (security S1): every named reference must resolve to a week,
 * and every one of those weeks must be public; no reference overrides another (a `meta.weekId` pointing at a FINAL week
 * does not launder a `gameTag` pointing at a game in an OPEN one). A post that names no week is not about picks and passes.
 *
 * @returns {{named:boolean, weeks:object[], unresolved:boolean}}  the weeks the post names, and whether any reference did not resolve
 */
export function scribePostWeek(m, { weeks = [], games = [] } = {}) {
  const meta = (m && m.meta && typeof m.meta === 'object') ? m.meta : {};
  const weekRefs = isNonEmptyString(meta.weekId) ? [meta.weekId] : [];
  const gameRefs = [...new Set([meta.gameId, m && m.gameTag].filter(isNonEmptyString))];
  const found = [];
  let unresolved = false;
  const weekById = (id) => asArray(weeks).find(w => w && w.weekId === id) || null;
  for (const id of weekRefs) { const w = weekById(id); if (w) found.push(w); else unresolved = true; }
  for (const gid of gameRefs) {
    const g = asArray(games).find(x => x && x.gameId === gid);
    const w = g ? weekById(g.weekId) : null;
    if (w) found.push(w); else unresolved = true;
  }
  return { named: weekRefs.length + gameRefs.length > 0, weeks: found, unresolved };
}

function reactionCountOf(m) {
  const r = m && m.reactions;
  if (Array.isArray(r)) return r.length;
  if (r && typeof r === 'object') return Object.values(r).reduce((s, v) => s + (Array.isArray(v) ? v.length : Number(v) || 0), 0);
  return 0;
}

/**
 * A candidate is a WHITELIST projection of the message — never the message wholesale (no `feedback`, no raw meta).
 *
 * SECURITY W1 — the stamp is the ROW'S OWN league (`m.leagueId`), never the league that was asked for. `chatBoundToLeague` only
 * says the channel is live for the active league; it cannot say which league each row in the in-memory store came from, so a row
 * ingested under league A would otherwise be stamped "B" the moment the channel reports B. A row whose own league differs from
 * the requested one is dropped in EVERY mode; in supabase mode a row with NO `leagueId` is dropped too (it cannot prove where it
 * came from). Only in local mode — one device, one local league, rows that carry no league field — does an unstamped row take the
 * requested league. The chat.js half (rows carrying `leagueId`, the store reset on a league / account change) is a separate fix:
 * this function works as soon as rows carry the field, and drops everything that does not until then.
 */
function projectCandidate(m, leagueId, supabase = true) {   // the internal default is the strict one too (every caller passes the switch)
  if (!m || !isNonEmptyString(String(m.id ?? ''))) return null;
  const own = isNonEmptyString(m.leagueId) ? m.leagueId : null;
  if (own !== null && own !== leagueId) return null;            // W1: another league's row, whatever the channel says
  if (own === null && supabase) return null;                    // W1: supabase mode — no provenance, no candidate
  const meta = (m.meta && typeof m.meta === 'object') ? m.meta : {};
  return {
    id: String(m.id), ts: toMs(m.ts), author: String(m.author ?? ''),
    authorName: m.authorName == null ? '' : String(m.authorName),
    body: typeof m.body === 'string' ? m.body : '',
    reactionCount: reactionCountOf(m),
    leagueId: own === null ? leagueId : own,                    // the stamp (S-C11, W1): the row's OWN league; deriveCards drops a mismatch, assemble drops a missing one
    meta: { kind: meta.kind == null ? null : String(meta.kind), test: meta.test === true },
  };
}

/**
 * Builds the injected `chatCandidates` function from chat's own primitives. All three are REQUIRED:
 *   getMessages(filter)         chat.js `getMessages`
 *   isPrivateRow(m)             chat.js's private-row predicate (isPrivateSelfTest || isPrivateScribeChangelog)
 *   chatBoundToLeague(leagueId) chat.js's STORE-backed predicate (DI-372 amendment A1): the in-memory room is scoped to THIS league and has caught up
 */
export function makeChatCandidateSource({ getMessages, isPrivateRow, chatBoundToLeague } = {}) {
  for (const [name, fn] of Object.entries({ getMessages, isPrivateRow, chatBoundToLeague })) {
    if (typeof fn !== 'function') throw new TypeError(`makeChatCandidateSource() requires an injected ${name} function`);
  }
  return function chatCandidates({ leagueId = null, weeks = [], games = [], now = Date.now(), timezone = 'PT', supabase = true } = {}) {
    // The provenance switch FAILS CLOSED (security note, v0.29.0 batch-4 follow-up, 2026-10-01): only the boolean `false` is local mode. Missing, null,
    // "false", 0, 1 … all read as supabase mode, where an unstamped row is dropped. assembleSnapshot always passes `!!read.isSupabase()`. hometest C11e / C11f.
    const strictProvenance = supabase !== false;
    const empty = { scribe: [], lockerRoom: [] };
    if (!isNonEmptyString(leagueId)) return empty;
    let bound = false;
    try { bound = chatBoundToLeague(leagueId) === true; } catch { bound = false; }
    if (!bound) return empty;                                    // S-C11 — fail closed, never a stale league's messages
    let all = [];
    try { all = asArray(getMessages({ types: ['message'], respectRetention: true })); } catch { all = []; }
    const today = dayKeyInTz(now, timezone);
    const scribe = [], lockerRoom = [];
    for (const m of all) {
      if (!m || m.deleted) continue;
      let priv = true;
      try { priv = !!isPrivateRow(m); } catch { priv = true; }   // an unreadable answer is "private"
      if (priv) continue;
      const author = String(m.author ?? '');
      if (author === 'scribe') {
        if (isWagerReceipt(m)) continue;                         // note (c): a wager receipt carries user-typed claim text; DI-372 keeps those off Home
        const { named, weeks: namedWeeks, unresolved } = scribePostWeek(m, { weeks, games });
        if (named && (unresolved || namedWeeks.some(w => !arePicksPublic(w)))) continue; // security C2 / S1 — the blind-gated path, conjunctive
        const c = projectCandidate(m, leagueId, strictProvenance);
        if (c) scribe.push(c);
      } else if (author !== 'system') {
        if (dayKeyInTz(toMs(m.ts), timezone) !== today) continue;
        const c = projectCandidate(m, leagueId, strictProvenance);
        if (c) lockerRoom.push(c);
      }
    }
    scribe.sort((a, b) => (b.ts - a.ts) || a.id.localeCompare(b.id));
    return { scribe: scribe.slice(0, SCRIBE_POST_LIMIT), lockerRoom };
  };
}

/** Whatever the injected source returns, narrowed: arrays only, and EVERY candidate must carry THIS league's stamp. */
function sanitizeChat(raw, leagueId) {
  const out = { scribe: [], lockerRoom: [] };
  if (!isNonEmptyString(leagueId) || !raw || typeof raw !== 'object') return out;
  const keep = (list) => asArray(list).filter(c => c && typeof c === 'object' && c.leagueId === leagueId);
  out.scribe = keep(raw.scribe);
  out.lockerRoom = keep(raw.lockerRoom);
  return out;
}

// ═══ the snapshot (DI-366: S-C2 and S-C10 are applied HERE, once) ═════════════════════════════════════════════════

/**
 * SP-54 (checklist item 21): keep only the group contexts whose EVERY member week is in the revealed view. `weeks` are all week records (structure), `revealedWeeks` the S-C2 view.
 * Returns a Map (possibly empty), or null when the input is not a Map. Exported for the parity test.
 */
export function restrictTieContextsToRevealed(contexts, weeks, revealedWeeks) {
  if (!(contexts instanceof Map)) return null;
  const revealed = new Set(asArray(revealedWeeks).filter(Boolean).map(w => w.weekId));
  const out = new Map();
  for (const [gid, ctx] of contexts) {
    const members = asArray(weeks).filter(w => w && getEffectiveGroupId(w) === gid);
    if (members.length > 0 && members.every(m => revealed.has(m.weekId))) out.set(gid, ctx);
  }
  return out;
}

/** Counts only, per week: `{submittedCount,totalPlayers}`, or null = UNKNOWN (never zero — DI-T4.11: "absent beats wrong"). */
function submissionCountsFor({ weeks, games, picks, players, viewerId, read, picksConfirmed }) {
  const out = {};
  const active = players.filter(p => p && p.active);
  let progress = null;
  try { const v = read.weekProgress(); progress = (v && typeof v === 'object' && v.weeks) ? v.weeks : null; } catch { progress = null; }
  const supabase = !!read.isSupabase();
  for (const w of weeks) {
    if (!w || w.status === 'draft') continue;
    const gameCount = games.filter(g => g && g.weekId === w.weekId).length;
    if (!gameCount || !active.length) { out[w.weekId] = null; continue; }
    const isPublic = arePicksPublic(w);
    let submitted = 0, unknown = false;
    for (const p of active) {
      const mine = isNonEmptyString(viewerId) && p.playerId === viewerId;
      // The rows are on this device when: not supabase mode, the viewer's own rows, or a public week whose other rows have LANDED.
      const rowsHere = !supabase || mine || (isPublic && picksConfirmed[w.weekId] === true);
      if (rowsHere) {
        if (picks.filter(x => x && x.weekId === w.weekId && x.playerId === p.playerId).length >= gameCount) submitted++;
        continue;
      }
      const entry = progress && progress[w.weekId] && progress[w.weekId][p.playerId];
      if (!entry) { unknown = true; break; }
      if ((Number(entry.pickCount) || 0) >= gameCount) submitted++;
    }
    out[w.weekId] = unknown ? null : { submittedCount: submitted, totalPlayers: active.length };
  }
  return out;
}

/**
 * Everything the renderers read, assembled in ONE place. `revealed*` is the S-C2 view — weeks that are public AND
 * server-confirmed final — built exactly once, here, by feed-cards' own `buildRevealedView`; the unrestricted
 * weeks / games / picks / weeklyResults ride along only for the Now card (which legitimately needs the CURRENT,
 * possibly-not-final week) and for the per-game gates. `picksReadConfirmed` is S-C10's per-week flag.
 */
export function assembleHomeSnapshot(deps, { viewerId = null, isCommissioner = false, now = Date.now() } = {}) {
  const d = deps;
  const read = d.read;
  const weeks = asArray(read.weeks());
  const games = asArray(read.games());
  const picks = asArray(read.picks());
  const players = asArray(read.players());
  const weeklyResults = asArray(read.weeklyResults());
  const leagueId = read.leagueId() || null;
  const timezone = read.timezone();
  const supabase = !!read.isSupabase();
  const confirmedStatusFor = (week) => { try { return d.confirmedStatusFor(week) || null; } catch { return null; } };

  // S-C2 — the revealed view, once. A commissioner's demo weeks are the one UN-71 exception (deriveCards decides per card).
  const view = buildRevealedView({ weeks, games, picks, weeklyResults, confirmedStatusFor, includeDemo: isCommissioner === true });

  // S-C10 — in supabase mode a week can be public on THIS device before the others' rows have landed (RG-255). Local mode: always true.
  const picksReadConfirmed = {};
  for (const w of weeks) {
    if (!w) continue;
    if (!supabase) { picksReadConfirmed[w.weekId] = true; continue; }
    let ok = false;
    try { ok = d.picksReadConfirmed(w.weekId) === true; } catch { ok = false; }
    picksReadConfirmed[w.weekId] = ok;
  }

  let chat = { scribe: [], lockerRoom: [] };
  try { chat = sanitizeChat(d.chatCandidates({ leagueId, weeks, games, now, timezone, supabase }), leagueId); } catch { chat = { scribe: [], lockerRoom: [] }; }

  // SP-54 / DI-467 (HOME_WIRING_CHECKLIST item 21): the SAME group tie contexts the Standings page uses (injected: only the app can name the alma-affinity check and the claimed-school roster), so Home's
  // weeklyWins / weeklyLosses / currentRank cannot diverge from Standings on a pooled group tie. Built over every week RECORD (structure only, exactly as seasonStandingsRows() does) and then
  // RESTRICTED to groups whose every member week is in the revealed view (S-C2): calculateSeasonStandings only ever pools such a group, and a context built from an unrevealed week's
  // guesses never rides in the snapshot. A builder that throws or answers anything but a Map reads as null: today's behaviour, never a thrown feed.
  let tieContexts = null;
  if (typeof d.groupTieContexts === 'function') {
    try { tieContexts = restrictTieContextsToRevealed(d.groupTieContexts({ allWeeks: weeks, players: players.filter(p => p && p.active) }), weeks, view.revealedWeeks); } catch { tieContexts = null; }
  }

  let currentWeekId = null;
  try { const cw = read.currentWeek(); currentWeekId = cw ? cw.weekId : null; } catch { currentWeekId = null; }
  let activeWeekId = null;
  try { activeWeekId = read.activeWeekId() || null; } catch { activeWeekId = null; }

  return {
    leagueId, viewerId, now, timezone, players, weeks, games, picks, weeklyResults,
    revealedWeeks: view.revealedWeeks, revealedGames: view.revealedGames, revealedPicks: view.revealedPicks, revealedWeeklyResults: view.revealedWeeklyResults,
    tieContexts,
    confirmedStatusFor, picksReadConfirmed,
    submissionCounts: submissionCountsFor({ weeks, games, picks, players, viewerId, read, picksConfirmed: picksReadConfirmed }),
    chatCandidates: chat, currentWeekId, activeWeekId, todayKey: dayKeyInTz(now, timezone),
    isCommissioner: isCommissioner === true,
  };
}

// ═══ the Now card (DI-364): the state machine, as plain data ═════════════════════════════════════════════════════

function nowModel(fields) {
  return {
    state: '', weekId: null, weekN: '', eyebrow: '', headline: '', sub: '', own: '', trend: null,
    primary: null, secondary: null, compact: null, ...fields,
  };
}

/** "Texas 14, Oklahoma 10" — the scoreboard line, away first, the same order game.final prints. */
function scoreLine(g) {
  const hs = numStr(g.homeScore), as = numStr(g.awayScore);
  if (hs === '' || as === '') return `${g.awayTeam} at ${g.homeTeam}`;
  return `${g.awayTeam} ${as}, ${g.homeTeam} ${hs}`;
}

/** Who is covering AS OF NOW, asked of the one scoring function (`calculateAtsWinner` — the final-only guard is stepped over, never re-implemented). */
function liveCover(game, team) {
  if (!game || !isNonEmptyString(team)) return null;
  let who = null;
  try { who = calculateAtsWinner({ ...game, status: 'final' }); } catch { who = null; }
  if (!who) return null;
  if (who === 'no_decision') return { state: 'even', margin: '' };
  const m = atsMarginOf(game);
  return { state: who === team ? 'covering' : 'trailing', margin: m === null ? '' : String(Number(m.toFixed(1))) };
}

const hasWeekN = (w) => !!w && w.weekNumber !== null && w.weekNumber !== undefined && String(w.weekNumber).trim() !== '' && Number.isFinite(Number(w.weekNumber));

/**
 * The state machine, one row per DI-364 state. It asks `arePicksPublic(week)` and the server-confirmed status for the
 * truth — never `canViewOtherPicks()` (S-C1), never its own reveal arithmetic. The viewer's own pick is built from an
 * explicit non-null viewer id (S-C3): no viewer, no name, no team.
 *
 * @returns plain data: { state, weekId, weekN, eyebrow, headline, sub, own, trend, primary, secondary, compact }
 */
export function nowCardModel(snapshot, { viewerId = null, isCommissioner = false, now = Date.now() } = {}) {
  const s = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  const viewer = isNonEmptyString(viewerId) ? viewerId : null;
  const kept = sortWeeks(asArray(s.weeks)).filter(w => hasWeekN(w) && (isCommissioner === true || w.dataSourceMode !== 'demo'));
  if (!kept.length) {
    return nowModel({
      state: 'no-weeks', eyebrow: 'Home', headline: 'Your league is just getting started.',
      sub: 'Once the commissioner opens a week, picks and results will show up here.',
      primary: isCommissioner === true ? { label: 'Build the first slate', action: 'build-slate' } : null,
    });
  }
  const newest = kept[kept.length - 1];
  const cur = kept.find(w => w.weekId === s.currentWeekId) || newest;
  const weekN = numStr(cur.weekNumber);
  const games = asArray(s.games).filter(g => g && g.weekId === cur.weekId);
  const picks = asArray(s.picks).filter(p => p && p.weekId === cur.weekId);
  let confirmed = null;
  try { confirmed = typeof s.confirmedStatusFor === 'function' ? s.confirmedStatusFor(cur) : null; } catch { confirmed = null; }
  const st = confirmed || cur.status;
  const isPublic = arePicksPublic(cur);                          // the ONE reveal question
  const base = { weekId: cur.weekId, weekN };

  // ── Final / Between seasons ──
  if (st === 'final' && isPublic) {
    const lastGameMs = games.reduce((mx, g) => Math.max(mx, toMs(g.kickoff)), 0);
    const endedMs = toMs(cur.finalizedAt) || lastGameMs;
    if (cur.weekId === newest.weekId && endedMs && now - endedMs > BETWEEN_SEASONS_AFTER_MS) {
      return nowModel({ ...base, state: 'between', eyebrow: `Week ${weekN} · Final`, headline: `Week ${weekN} was the last one.`, sub: 'Nothing new yet — check back once the next week opens.' });
    }
    const rows = asArray(s.revealedWeeklyResults).filter(r => r && r.weekId === cur.weekId);   // S2: the REVEALED view only — never the unrestricted s.weeklyResults (a mirror that says final while the server does not has rows here, and they must name nobody)
    const nameOf = (id, fallback) => { const p = asArray(s.players).find(x => x && x.playerId === id); return (p && p.displayName) || fallback || ''; };
    const winner = rows.find(r => r.isWinner), loser = rows.find(r => r.isLoser);
    const wn = winner ? nameOf(winner.playerId, winner.displayName) : '', ln = loser ? nameOf(loser.playerId, loser.displayName) : '';
    const grouped = weeksInGroup(asArray(s.weeks), cur).length > 1;   // a pooled multi-part week has no single winner to name
    let headline = `Week ${weekN} is final.`;
    if (!grouped && wn && ln && winner.playerId !== loser.playerId) {
      // RESULTS_FINALIZED, verbatim, picked deterministically per week (buildCopy hashes the dedup key — never Math.random).
      headline = buildCopy('RESULTS_FINALIZED', { weekN, weekWinnerName: wn, weekLoserName: ln }, `home-now:${cur.weekId}`).body;
    }
    return nowModel({ ...base, state: 'final', eyebrow: `Week ${weekN} · Final`, headline, sub: 'See the results below.' });
  }

  // ── Live (picks are public, the week is not final) ──
  if (isPublic) {
    const live = games.filter(g => g.status === 'live').sort(kickoffOrder);
    const model = { ...base, state: 'live', eyebrow: `Week ${weekN} · Live`, headline: `Week ${weekN} is live.`, sub: '', own: '', trend: null,
      primary: { label: 'See the full slate', action: 'go-tab', tab: 'dashboard' }, secondary: null, compact: null };
    if (live.length) {
      const featured = live[0];
      model.headline = scoreLine(featured);
      const team = ownPickTeam(picks, featured.gameId, viewer);   // S-C3 — own pick only, explicit viewer
      const cover = liveCover(featured, team);
      if (team) {
        if (!cover) model.own = `You have ${team}.`;
        else if (cover.state === 'even') { model.own = `You have ${team} and it's right on the number.`; }
        else {
          model.own = `You have ${team} and you're ${cover.state === 'covering' ? 'covering' : 'trailing'}${cover.margin ? ` by ${cover.margin}` : ''}.`;
          model.trend = cover.state === 'covering' ? 'up' : 'down';
        }
      }
      // The compact dashboard (the injected callback) gets the live games only, and the picks the viewer may see:
      // everyone's in this week only once S-C10 confirms the other rows have landed; otherwise the viewer's OWN.
      const confirmedOthers = s.picksReadConfirmed && s.picksReadConfirmed[cur.weekId] === true;
      model.compact = {
        weekId: cur.weekId, games: live.slice(0, 3),
        picks: confirmedOthers ? picks : picks.filter(p => viewer !== null && p.playerId === viewer),
        actualTB: cur.actualTiebreakerValue ?? null,
      };
    } else {
      const upcoming = games.filter(g => g.status !== 'final').sort(kickoffOrder)[0];
      model.sub = upcoming ? `Next up: ${upcoming.awayTeam} at ${upcoming.homeTeam}.` : 'Every game is final. Results land when the commissioner finalizes the week.';
    }
    return nowModel(model);
  }

  const lockAt = computeEffectiveLockAt(cur, games);
  const lockMs = lockAt && Number.isFinite(lockAt.getTime()) ? lockAt.getTime() : null;
  const firstK = computeFirstKickoff(games);
  const firstMs = firstK ? firstK.getTime() : null;
  const lockPassed = lockMs !== null && lockMs <= now;

  // ── Locked (far / near / passed) ──
  if (st === 'locked' || (st === 'open' && lockPassed && games.length)) {
    const eyebrow = `Week ${weekN} · Locked`;
    const msToKick = firstMs === null ? null : firstMs - now;
    if (msToKick !== null && msToKick > 0 && msToKick <= NOW_NEAR_KICKOFF_MS) {
      const first = games.slice().sort(kickoffOrder)[0];
      const mins = Math.max(1, Math.ceil(msToKick / 60000));
      if (viewer) {
        const team = ownPickTeam(picks, first.gameId, viewer);   // S-C3
        return nowModel({ ...base, state: 'locked-near', eyebrow, headline: `${first.awayTeam} at ${first.homeTeam} kicks off in ${mins} min.`, sub: team ? `You have ${team}.` : "You didn't pick this game." });
      }
      return nowModel({ ...base, state: 'locked-near', eyebrow, headline: `Kickoff in ${mins} min.` });   // no viewer: generic, no team name
    }
    const slate = { label: 'View the slate', action: 'go-tab', tab: 'picks' };
    if (msToKick === null) return nowModel({ ...base, state: 'locked-far', eyebrow, headline: `Week ${weekN} is locked.`, sub: 'Picks are in. Reveal comes at kickoff.', secondary: slate });
    if (msToKick <= 0) return nowModel({ ...base, state: 'locked-far', eyebrow, headline: `Week ${weekN} is locked.`, sub: 'Reveal comes as the week goes live.', secondary: slate });
    return nowModel({ ...base, state: 'locked-far', eyebrow, headline: `Week ${weekN} is locked.`, sub: `Reveal — and kickoff — in ${formatCountdown(msToKick)}.`, secondary: slate });
  }

  // ── Open ──
  if (st === 'open' && games.length) {
    const eyebrow = `Week ${weekN} · Open`;
    const locks = lockMs !== null ? formatCountdown(lockMs - now) : '';
    const counts = s.submissionCounts && s.submissionCounts[cur.weekId];
    const inLine = counts && Number.isFinite(Number(counts.submittedCount)) && Number.isFinite(Number(counts.totalPlayers)) ? `${numStr(counts.submittedCount)}/${numStr(counts.totalPlayers)} in` : '';
    const lockLine = locks ? `Locks in ${locks}` : '';
    if (!viewer) {
      return nowModel({ ...base, state: 'open-pending', eyebrow, headline: `Week ${weekN} is open.`, sub: [lockLine, inLine].filter(Boolean).join(' · '), primary: { label: 'Make your picks', action: 'go-tab', tab: 'picks' } });
    }
    const mine = new Set(picks.filter(p => p.playerId === viewer).map(p => p.gameId));
    const remaining = games.filter(g => !mine.has(g.gameId)).length;     // own picks only — counts, never anyone else's
    if (remaining > 0) {
      return nowModel({ ...base, state: 'open-pending', eyebrow, headline: `Week ${weekN}: ${remaining} ${remaining === 1 ? 'pick' : 'picks'} left.`,
        sub: [lockLine, inLine].filter(Boolean).join(' · '), primary: { label: 'Make your picks', action: 'go-tab', tab: 'picks' } });
    }
    return nowModel({ ...base, state: 'open-done', eyebrow, headline: `You're all in for Week ${weekN}.`, sub: lockLine ? `${lockLine}.` : '',
      primary: { label: 'Edit My Picks', action: 'go-tab', tab: 'picks' } });
  }

  // ── Draft (no games yet, or not open) ──
  return nowModel({ ...base, state: 'draft', eyebrow: `Week ${weekN}`, headline: `Week ${weekN} is being set up.`, sub: "Picks aren't open yet." });
}

/** DI-365 — the commissioner's operational nudge, straight from reminder-rules' already-shipped assembler (zero new detection, zero new copy). */
export function commissionerNudge(snapshot, { isCommissioner = false, now = Date.now() } = {}) {
  if (isCommissioner !== true) return null;
  let items = [];
  try {
    items = computeCommissionerOpsPlan({ weeks: asArray(snapshot && snapshot.weeks), games: asArray(snapshot && snapshot.games), now, activeWeekId: (snapshot && snapshot.activeWeekId) || null });
  } catch { items = []; }
  const it = asArray(items)[0];
  if (!it || !isNonEmptyString(it.title)) return null;
  return {
    key: `nudge:${it.category}:${it.weekId}`, category: String(it.category), weekId: it.weekId,
    title: String(it.title), body: String(it.body || ''), commTab: NUDGE_COMM_TAB[it.category] || 'week',
  };
}

// ═══ the merge (DI-366: a fixed rule, no algorithm — SP-18) ═══════════════════════════════════════════════════════

/** News that may be shown: unique ids, a parseable publish time, not in the future, nothing older than 48 hours. Order is UX-2's (relevance). */
export function eligibleNews(items, now) {
  const seen = new Set();
  const out = [];
  for (const it of asArray(items)) {
    if (!it || typeof it !== 'object' || !isNonEmptyString(String(it.id ?? ''))) continue;
    const id = String(it.id);
    if (seen.has(id)) continue;
    const ms = Date.parse(it.publishedAt);
    if (!Number.isFinite(ms) || ms > now + NEWS_FUTURE_SKEW_MS || now - ms > NEWS_FRESHNESS_MS) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

/** Slots a list of payloads (each payload = the entries one slot receives) among the non-news entries. */
function interleaveNews(nonNews, slots) {
  if (!slots.length) return nonNews.slice();
  if (nonNews.length < NEWS_PER_NON_NEWS) {
    // The midweek exception: too few non-news cards, so news fills the remainder of the visible feed (up to the cap).
    return [...nonNews, ...slots.slice(0, NEWS_MAX_CARDS).flat()];
  }
  const out = [];
  let used = 0;
  nonNews.forEach((e, i) => {
    out.push(e);
    if ((i + 1) % NEWS_PER_NON_NEWS === 0 && used < slots.length && used < NEWS_MAX_CARDS) out.push(...slots[used++]);
  });
  return out;
}

/**
 * The ordered feed, as DESCRIPTORS (rendering is separate, so the order is provable without markup):
 *   1. the Now card, pinned first, unconditionally;   2. the commissioner nudge, pinned second, when present;
 *   3. every other card grouped by week (newest week first), newest first within a week; week-less cards (SCRIBE, the Locker
 *      Room) join the newest week's group;   4. news at <=1 per 4 non-news cards (filling when thin, cap 8, 48 h);
 *   5. news renders any time, not gated on this week's slate (UX-2 N2);   6. the end marker, last.
 * Deterministic: the same inputs give the same array in the same order, whatever order `cards` arrives in.
 */
export function mergeFeed({ now = Date.now(), cards = [], weeks = [], nudge = null, news = null, feedError = false, emptyLeague = false } = {}) {
  const out = [{ kind: 'now', key: 'now' }];
  if (nudge) out.push({ kind: 'nudge', key: nudge.key, nudge });

  const rank = new Map(sortWeeks(weeks).reverse().map((w, i) => [w.weekId, i]));     // newest week = 0
  const rankOf = (c) => (c.weekId === null || c.weekId === undefined ? 0 : (rank.has(c.weekId) ? rank.get(c.weekId) : 1e9));
  const sorted = asArray(cards).filter(Boolean).slice().sort((a, b) =>
    (rankOf(a) - rankOf(b)) || (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const nonNews = feedError
    ? [{ kind: 'error', key: 'home-error' }]
    : sorted.slice(0, FEED_CARD_LIMIT).map(c => ({ kind: 'card', key: c.id, card: c }));

  const slots = [];
  const status = news && typeof news === 'object' ? news.status : 'off';
  if (status === 'ready' || status === 'empty') {
    const items = eligibleNews(news.items, now).slice(0, NEWS_MAX_CARDS);
    if (items.length) items.forEach(it => slots.push([{ kind: 'news', key: `news:${String(it.id)}`, item: it }]));
    else slots.push([{ kind: 'news-empty', key: 'news-empty' }]);
  } else if (status === 'loading') {
    slots.push(Array.from({ length: NEWS_SKELETON_COUNT }, (_, i) => ({ kind: 'news-skeleton', key: `news-skel:${i}` })));
  } else if (status === 'error') {
    slots.push([{ kind: 'news-error', key: 'news-error' }]);
  }                                                              // 'off' / 'idle' / anything else: the slot does not exist
  out.push(...interleaveNews(nonNews, slots));
  if (!feedError) out.push({ kind: 'caught-up', key: 'caught-up', variant: emptyLeague ? 'new-league' : 'caught-up' });   // never "You're all caught up." beside an error card
  return out;
}

// ═══ markup (DI-367: one card shell; every dynamic string escaped at the sink) ═══════════════════════════════════

/** A real <button>, 44 pt tall (css), pressing to 97% like every other button. A SOLID (primary) action is a medium haptic, everything else light — the Principles' table. */
function actionButtonHTML(a, { escHtml, tone }) {
  const hapticKind = tone === 'solid' ? 'medium' : 'light';
  const tabAttrs = a.action === 'go-tab' ? ` data-tab="${escHtml(a.tab)}"${a.commTab ? ` data-comm-target="${escHtml(a.commTab)}"` : ''}` : '';
  return `<button type="button" class="btn feed-action feed-action--${escHtml(tone)}" data-home-action="${escHtml(a.action)}"${tabAttrs} data-haptic="${hapticKind}">${escHtml(a.label)}</button>`;
}

/** The Now card (always `.feed-card`). `compactHtml` is the injected callback's finished fragment, SPLICED — never interpolated. */
export function nowCardHTML(model, { escHtml, compactHtml = '' }) {
  requireEscHtml(escHtml, 'nowCardHTML');
  const open = `<section class="card feed-card feed-now" data-now-state="${escHtml(model.state)}" aria-label="This week">`;
  const eyebrow = model.eyebrow ? `<p class="feed-now-eyebrow">${escHtml(model.eyebrow)}</p>` : '';
  const headline = `<h2 class="feed-now-headline">${escHtml(model.headline)}</h2>`;
  const trend = model.trend ? `<span class="feed-now-trend" data-trend="${escHtml(model.trend)}" aria-hidden="true">${model.trend === 'up' ? '▲' : '▽'}</span>` : '';
  const sub = model.sub ? `<p class="feed-now-sub">${escHtml(model.sub)}</p>` : '';
  const own = model.own ? `<p class="feed-now-sub feed-now-own">${trend}<span>${escHtml(model.own)}</span></p>` : '';
  const text = `<div class="feed-now-text">${eyebrow}${headline}${sub}${own}</div>`;
  const compact = compactHtml ? joinHtml(['<div class="dashboard-compact feed-now-compact">', compactHtml, '</div>']) : '';
  const buttons = [
    model.primary ? actionButtonHTML(model.primary, { escHtml, tone: 'solid' }) : '',
    model.secondary ? actionButtonHTML(model.secondary, { escHtml, tone: 'outline' }) : '',
  ].filter(Boolean);
  const actions = buttons.length ? joinHtml(['<div class="feed-actions">', joinHtml(buttons), '</div>']) : '';
  return joinHtml([open, text, compact, actions, '</section>']);
}

/** The Now card for a snapshot: the model, the injected compact callback (only the LIVE state ever calls it), the markup. */
export function renderNowCard(snapshot, { viewerId = null, isCommissioner = false, now = Date.now(), escHtml, renderCompact } = {}) {
  requireEscHtml(escHtml, 'renderNowCard');
  const model = nowCardModel(snapshot, { viewerId, isCommissioner, now });
  let compactHtml = '';
  if (model.compact && typeof renderCompact === 'function') {
    const c = model.compact;
    const players = asArray(snapshot.players).filter(p => p && p.active);
    const rows = asArray(snapshot.weeklyResults).filter(r => r && r.weekId === c.weekId);
    try {
      const out = renderCompact(players, c.games, c.picks, rows, c.weekId, c.actualTB);
      compactHtml = typeof out === 'string' ? out : '';
    } catch (e) { console.error('[home] compact dashboard failed', e); compactHtml = ''; }
  }
  return { model, html: nowCardHTML(model, { escHtml, compactHtml }) };
}

function nudgeHTML(n, { escHtml }) {
  const label = '<p class="feed-nudge-label">Commissioner</p>';
  const title = `<h3 class="feed-card-title">${escHtml(n.title)}</h3>`;
  const body = n.body ? `<p class="feed-card-body">${escHtml(n.body)}</p>` : '';
  const text = joinHtml(['<div class="feed-card-text">', label, title, body, '</div>']);   // an 8 pt group; the card's own 16 pt gap separates it from the buttons
  const action = joinHtml(['<div class="feed-actions">', actionButtonHTML({ action: 'go-tab', tab: 'commissioner', commTab: n.commTab, label: 'Open Commissioner Panel' }, { escHtml, tone: 'neutral' }), '</div>']);
  const open = `<article class="card feed-card feed-nudge" data-card-type="comm-nudge" data-nudge-category="${escHtml(n.category)}">`;
  return joinHtml([open, text, action, '</article>']);
}

/** One stats / SCRIBE / Locker Room card. Returns '' for a card with nothing to say (never an empty shell). */
export function cardHTML(card, { escHtml, formatKickoff } = {}) {
  requireEscHtml(escHtml, 'cardHTML');
  let copy;
  try { copy = cardCopy(card, { escHtml: plainText, formatKickoff }); } catch (e) { console.error('[home] cardCopy failed', e); return ''; }
  if (!copy || (!copy.title && !copy.body)) return '';
  let captionHtml = '';
  try { captionHtml = captionFor(card, { escHtml }); } catch { captionHtml = ''; }      // a caption failure never costs the card
  const open = `<article class="card feed-card" data-card-type="${escHtml(card.type)}">`;
  const reason = card.reason ? `<span class="feed-card-reason">${escHtml(card.reason)}</span>` : '';
  const eyebrow = joinHtml(['<div class="feed-card-eyebrow">', glyphSpan('feed-card-icon', CARD_ICON[card.type] || 'calendarWeek'), reason, '</div>']);
  const title = copy.title ? `<h3 class="feed-card-title">${escHtml(copy.title)}</h3>` : '';
  // The caption and the body are two presentations of ONE fact (the caption document's own §0: "one fact, two presentation slots"), so a card shows ONE of them:
  // the SCRIBE-voiced caption when it has one, else the plain body. The two types whose body IS the content (a SCRIBE post, the Locker Room's quoted message) always keep it.
  const keepsBody = BODY_IS_CONTENT.includes(card.type);
  const showCaption = !!captionHtml && !keepsBody;
  const body = copy.body && (keepsBody || !showCaption) ? `<p class="feed-card-body${card.type === 'scribe.post' ? ' feed-card-body--scribe' : ''}">${escHtml(copy.body)}</p>` : '';
  const chips = asArray(copy.chips).length ? joinHtml(['<div class="feed-card-chips">', joinHtml(asArray(copy.chips).map(c => chipHTML(c, { escHtml }))), '</div>']) : '';
  const caption = showCaption ? `<p class="feed-card-caption">${captionHtml}</p>` : '';
  return joinHtml([open, eyebrow, title, body, chips, caption, '</article>']);
}

/** One win / loss chip: initials plus a glyph AND a screen-reader word, so the result is never colour alone (WCAG 1.4.1). `initialsHtml` is plain text under plainText. */
function chipHTML(c, { escHtml }) {
  const won = !!c && c.result === 'win';
  const open = `<span class="badge feed-chip ${won ? 'badge-win' : 'badge-loss'}">`;
  const initials = escHtml(c && c.initialsHtml);
  const word = `<span class="sr-only">${won ? ' covered' : ' missed'}</span>`;
  return joinHtml([open, glyphSpan('feed-chip-glyph', won ? 'check' : 'close'), initials, word, '</span>']);
}

function skeletonCardHTML({ withImage = false } = {}) {
  const image = withImage ? '<div class="feed-skel-image"></div>' : '';
  return `<article class="card feed-card feed-skel" aria-hidden="true">${image}<div class="feed-skel-line feed-skel-line--narrow"></div><div class="feed-skel-line feed-skel-line--full"></div><div class="feed-skel-line feed-skel-line--wide"></div></article>`;
}

/** The news slot's calm inline states (UX-2's DI-380 copy): never the league's red banner, always local to the slot. */
function newsNoteHTML(kind, { escHtml, emptyCopy = null }) {
  if (kind === 'news-empty') return `<article class="card feed-card feed-note" data-card-type="news-empty"><div class="feed-card-text"><p class="feed-card-body feed-card-body--scribe">${escHtml(emptyCopy || NEWS_COPY.empty)}</p></div></article>`;
  const retry = actionButtonHTML({ action: 'retry-news', label: NEWS_COPY.retry }, { escHtml, tone: 'neutral' });
  return joinHtml([`<article class="card feed-card feed-note" data-card-type="news-error"><div class="feed-card-text"><p class="feed-card-body">${escHtml(NEWS_COPY.error)}</p></div><div class="feed-actions">`, retry, '</div></article>']);
}

function errorCardHTML({ escHtml }) {
  const retry = actionButtonHTML({ action: 'retry-load', label: ERROR_COPY.retry }, { escHtml, tone: 'neutral' });
  return joinHtml([`<article class="card feed-card feed-note" data-card-type="home-error" role="status"><div class="feed-card-text"><h3 class="feed-card-title">${escHtml(ERROR_COPY.title)}</h3><p class="feed-card-body">${escHtml(ERROR_COPY.body)}</p></div><div class="feed-actions">`, retry, '</div></article>']);
}

function caughtUpHTML(variant) {
  return variant === 'new-league'
    ? '<p class="feed-caught-up">Nothing yet — this is where it starts.</p>'
    : "<p class=\"feed-caught-up\">You're all caught up.</p>";
}

/** A keyed wrapper per entry: the key drives the entrance animation, the markup inside is the card. */
function wrapItems(items, { enter, busy, escHtml }) {
  const parts = [`<div class="home-feed" aria-busy="${busy ? 'true' : 'false'}">`];
  // The loading status for VoiceOver is a DIRECT child of the feed, outside every .feed-item: .sr-only is absolutely positioned, so it is not a flex item and the
  // column's 16 pt gap is never spent on an empty, zero-height row (which shifted the content 16 pt when the skeleton was replaced).
  if (busy) parts.push('<p class="sr-only" role="status">Loading Home</p>');
  for (const it of items) {
    const isNew = enter === 'all' || (enter instanceof Set && !enter.has(it.key));
    parts.push(joinHtml(['<div class="feed-item', isNew ? ' feed-item--enter' : '', '" data-card-key="', escHtml(it.key), '">']), it.html, '</div>');
  }
  parts.push('</div>');
  return joinHtml(parts);
}

// ═══ createHome: the renderer, the async paths and the interactions ═════════════════════════════════════════════

/**
 * @typedef {{id:string, url:string, source:string, headline:string, imageUrl:(string|null), publishedAt:string,
 *            sport:string, teamIds:string[], reason:string, relevanceTier:number}} NewsItem   UX-2's contract (their module renders it).
 * `fetchNews({force})` resolves NewsItem[] (already fresh and ranked) or rejects; `renderNewsCard(item)` returns finished HTML.
 */
export function createHome(deps) {
  const d = resolveDeps(deps);
  const escHtml = d.escHtml;
  const paintState = new WeakMap();
  const bound = new WeakMap();
  let news = { status: d.fetchNews ? 'idle' : 'off', items: [], fetchedAt: 0 };
  let newsInFlight = null;
  let newsGeneration = 0;                                                    // bumped by resetNews(): a load that started before it never commits

  const safeIdentity = () => { try { return d.currentIdentityKey(); } catch { return ''; } };
  const safeTab = () => { try { return d.getCurrentTab(); } catch { return ''; } };
  const withheld = () => { try { return d.isContentWithheld() !== false; } catch { return true; } };   // a throw or a non-false answer is "withheld"

  function viewerNow() {
    let v = null;
    try { v = d.read.viewer(); } catch { v = null; }
    const viewerId = v && isNonEmptyString(v.playerId) ? v.playerId : null;
    return { viewerId, isCommissioner: !!(v && v.isAdmin === true) };
  }

  /** Builds every entry's markup. Never throws: a failure becomes the calm error card, never a blank feed (DI-366). */
  function buildModel() {
    const { viewerId, isCommissioner } = viewerNow();
    const now = d.now();
    let snapshot = null;
    try { snapshot = assembleHomeSnapshot(d, { viewerId, isCommissioner, now }); }
    catch (e) { console.error('[home] snapshot assembly failed', e); return { items: [{ key: 'home-error', html: errorCardHTML({ escHtml }) }], state: 'error' }; }   // no end marker: "all caught up" is false after an error

    let cards = [], feedError = false;
    try {
      cards = deriveCards(snapshot, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: d.isContentWithheld });   // ALWAYS handed the gate
    } catch (e) { console.error('[home] deriveCards failed', e); feedError = true; }

    let nowEntry = null, nowState = '';
    try {
      const r = renderNowCard(snapshot, { viewerId, isCommissioner, now, escHtml, renderCompact: d.renderCompact });
      nowEntry = r.html; nowState = r.model.state;
    } catch (e) { console.error('[home] Now card failed', e); feedError = true; }

    const nudge = (() => { try { return commissionerNudge(snapshot, { isCommissioner, now }); } catch { return null; } })();
    const descriptors = mergeFeed({ now, cards, weeks: snapshot.weeks, nudge, news, feedError, emptyLeague: nowState === 'no-weeks' });
    const tzKey = snapshot.timezone;
    const formatKickoff = (iso) => formatGameTime(iso, tzKey);

    const items = [];
    for (const e of descriptors) {
      let html = '';
      switch (e.kind) {
        case 'now': html = nowEntry || ''; break;
        case 'nudge': html = nudgeHTML(e.nudge, { escHtml }); break;
        case 'card': html = cardHTML(e.card, { escHtml, formatKickoff }); break;
        case 'news': {
          if (d.renderNewsCard) { try { const out = d.renderNewsCard(e.item); html = typeof out === 'string' ? out : ''; } catch { html = ''; } }
          break;
        }
        case 'news-skeleton': html = skeletonCardHTML({ withImage: true }); break;
        case 'news-empty': case 'news-error': {
          let emptyCopy = null;
          if (e.kind === 'news-empty' && d.newsEmptyCopy) { try { const c = d.newsEmptyCopy(); emptyCopy = typeof c === 'string' && c ? c : null; } catch { emptyCopy = null; } }
          html = newsNoteHTML(e.kind, { escHtml, emptyCopy });
          break;
        }
        case 'error': html = errorCardHTML({ escHtml }); break;
        case 'caught-up': html = caughtUpHTML(e.variant); break;
        default: html = '';
      }
      if (html) items.push({ key: e.key, html });
    }
    return { items, state: nowState };
  }

  function isPainted(el) { return !!(el && (el.firstElementChild || el.firstChild)); }

  /** Replaces the markup only when it CHANGED; cards that were not on screen fade in (150 ms); the first content paint after a skeleton fades in whole. */
  function paint(el, items, mode) {
    const painted = isPainted(el);
    const prev = painted ? (paintState.get(el) || { mode: 'none', keys: new Set(), plain: '' }) : { mode: 'none', keys: new Set(), plain: '' };
    const busy = mode === 'skeleton';
    const plain = wrapItems(items, { enter: null, busy, escHtml });
    if (painted && prev.mode === mode && prev.plain === plain) return false;     // identical: no DOM write, no flash, scroll untouched
    let enter = null;
    if (mode === 'content' && prev.mode === 'skeleton') enter = 'all';
    else if (mode === 'content' && prev.mode === 'content') enter = prev.keys;
    el.innerHTML = enter === null ? plain : wrapItems(items, { enter, busy, escHtml });
    paintState.set(el, { mode, keys: new Set(items.map(i => i.key)), plain });
    return true;
  }

  /** Kicks the news slot's first fetch (or a quiet refetch once it is stale). Called by renderHome, never awaited by it. */
  function ensureNews() {
    if (!d.fetchNews) return;
    // SECURITY C1 (2026-10-01): a committed news answer is RANKED FOR ONE VIEWER (alma mater, team labels, the slate label). It carries the identity it was committed under, and a
    // mismatch is `idle` BEFORE mergeFeed ever reads it — so after an account or league switch the previous viewer's cards are never painted for the new one, not even for a frame
    // and not for the 15 minutes until the slot goes stale, whether or not the wiring remembered to call resetNews().
    // Review round 2 (R3): this reset abandons whatever was in flight, so it bumps the generation like resetNews() does. Without the bump, viewer A's late quiet refetch (started before the
    // switch) lands after viewer B has committed, fails the identity check in loadNews, and resets B's committed slot to idle: B's cards drop to a skeleton and refetch.
    if (news.committedFor !== undefined && news.committedFor !== safeIdentity()) { newsGeneration++; newsInFlight = null; news = { status: 'idle', items: [], fetchedAt: 0 }; }
    if (news.status === 'idle') { news = { status: 'loading', items: [], fetchedAt: 0 }; void runNewsLoad({ force: false }); }
    else if ((news.status === 'ready' || news.status === 'empty' || news.status === 'off') && !newsInFlight && d.now() - news.fetchedAt > NEWS_STALE_MS) void runNewsLoad({ force: false, quiet: true });   // an OFF slot re-asks (cheap: no request while off) so a commissioner flipping the league switch back on is seen
  }

  async function loadNews({ force = false, quiet = false } = {}) {
    if (!d.fetchNews) return;
    if (newsInFlight && !force) { await newsInFlight; return; }
    const identityAtStart = safeIdentity();
    const generationAtStart = newsGeneration;
    const job = (async () => {
      let next;
      try {
        const items = await d.fetchNews({ force });
        // NEWS OFF (News DI-380 / DI-381, 2026-10-01): a fetchNews that resolves `null` means "this viewer has news off" (player or league layer) — the slot does NOT
        // exist: no message, no ghost card, and the source made no request. An empty ARRAY is a different answer ("no headlines yet") and keeps its calm line.
        if (items === null) next = { status: 'off', items: [], fetchedAt: d.now() };
        else {
          const list = Array.isArray(items) ? items : [];
          next = { status: list.length ? 'ready' : 'empty', items: list, fetchedAt: d.now() };
        }
      } catch {
        next = { status: 'error', items: [], fetchedAt: d.now() };
      }
      if (newsGeneration !== generationAtStart) return;                      // resetNews() ran while this was in flight: its answer belongs to the old preferences
      // A switch raced in: discard this answer, never commit it. The slot goes back to idle ONLY when it is not already committed for the CURRENT viewer (News delta review, 2026-10-01): a late answer
      // from the previous identity that lands after the new viewer's own load committed must not wipe that commit (a skeleton flash and a third fetch for cards that were already right).
      if (safeIdentity() !== identityAtStart) { if (news.committedFor !== safeIdentity()) news = { status: 'idle', items: [], fetchedAt: 0 }; return; }
      if (quiet && next.status === 'error') return;                          // a background refetch never replaces cards with an error
      news = { ...next, committedFor: identityAtStart };
    })();
    newsInFlight = job;
    try { await job; } finally { if (newsInFlight === job) newsInFlight = null; }
  }

  /** S-C7 — every async paint: withheld AFTER the await, then identity, then tab, before anything touches the DOM. */
  function mayPaintAfter(identityAtStart) {
    if (withheld()) return false;
    if (safeIdentity() !== identityAtStart) return false;
    if (safeTab() !== HOME_TAB) return false;
    return true;
  }

  async function runNewsLoad(opts) {
    const identityAtStart = safeIdentity();
    try { await loadNews(opts); } catch { /* loadNews handles its own failures; this is a belt */ }
    if (!mayPaintAfter(identityAtStart)) return;
    renderHome();
  }

  function renderHome() {
    if (withheld()) return false;                                            // S-C7 — FIRST, before any read or DOM touch
    const el = d.getContainer();
    if (!el) return false;
    bindActions(el);
    if (!d.isDataReady()) {                                                  // cached -> SKELETON -> progressive: never a blank page, never a spinner
      const items = [];
      for (let i = 0; i < SKELETON_CARD_COUNT; i++) items.push({ key: `skel:${i}`, html: skeletonCardHTML() });
      if (withheld()) return false;
      paint(el, items, 'skeleton');
      return true;
    }
    ensureNews();
    const model = buildModel();
    if (withheld()) return false;                                            // belt: re-check right before the write
    paint(el, model.items, 'content');
    return true;
  }

  /**
   * DI-368 — the Home leg of pull-to-refresh (and of the header sync tap): the FORCED news fetch, then a repaint. That is all.
   *
   * It does NOT re-run the league sync and has no banner of any kind: the league leg is `runManualSync` (app.js), which
   * runs first and THROWS on a failed hydrate, landing in the binder's existing `onFail` -> `showSyncFailureBanner` before
   * this is ever called (see the PULL-TO-REFRESH note in the file header for the one-line wiring). So a news-only failure
   * can never raise the league banner — Home has no path to it — and a league failure never gets this far. A news failure
   * becomes the news slot's calm inline error (loadNews records it). NEVER rejects. Every await is followed by the S-C7
   * re-checks (withheld, then identity, then tab) before anything is painted.
   *
   * @returns {Promise<boolean>} true when it repainted; false when a re-check refused the paint
   */
  async function refresh() {
    const identityAtStart = safeIdentity();
    if (d.fetchNews) {
      try { await loadNews({ force: true }); } catch { /* loadNews already recorded its own failure as the slot's calm error */ }
    }
    if (!mayPaintAfter(identityAtStart)) return false;
    renderHome();
    return true;
  }

  /** Delegated, allow-listed, idempotent. The DOM is untrusted input: an unknown action or tab does nothing. */
  function bindActions(el) {
    if (!el || typeof el.addEventListener !== 'function') return () => {};
    if (bound.has(el)) return bound.get(el);
    const onClick = (e) => {
      const target = e && e.target;
      const btn = target && typeof target.closest === 'function' ? target.closest('[data-home-action]') : null;
      if (!btn) return;
      const attr = (n) => (typeof btn.getAttribute === 'function' ? btn.getAttribute(n) : null);
      const action = attr('data-home-action');
      if (!HOME_ACTIONS.includes(action)) return;
      if (action === 'build-slate' && !viewerNow().isCommissioner) return;   // B3: the role is checked at DISPATCH, not trusted from the markup that rendered the button — before any haptic
      let params = {};
      if (action === 'go-tab') {
        const tab = attr('data-tab');
        if (!ACTION_TABS.includes(tab)) return;                              // validated BEFORE any haptic: a rejected tap is silent
        params = { tab };
        const commTab = attr('data-comm-target');                            // NOT data-comm-tab: that name is RG-10's card-tagging attribute
        if (tab === 'commissioner' && ACTION_COMM_TABS.includes(commTab)) params.commTab = commTab;
      }
      const kind = attr('data-haptic');
      try { d.haptic(HAPTIC_KINDS.includes(kind) ? kind : 'light'); } catch { /* a dropped haptic is invisible */ }
      if (action === 'retry-news') {
        news = { status: 'loading', items: [], fetchedAt: 0 };
        renderHome();
        void runNewsLoad({ force: true });
        return;
      }
      if (action === 'retry-load') { renderHome(); return; }
      try { d.onAction(action, params); } catch (err) { console.error('[home] action failed', err); }
    };
    el.addEventListener('click', onClick);
    const unbind = () => { try { el.removeEventListener('click', onClick); } catch { /* detached */ } bound.delete(el); };
    bound.set(el, unbind);
    return unbind;
  }

  /**
   * News preferences changed (the player's own toggle, or the identity chokepoint): forget the news slot's state so the next paint asks again. A load already in
   * flight is abandoned (generation guard in loadNews), never committed. Does not paint — the caller repaints (renderHome) when Home is the current tab.
   */
  function resetNews() {
    newsGeneration++;
    newsInFlight = null;
    news = { status: d.fetchNews ? 'idle' : 'off', items: [], fetchedAt: 0 };
  }

  return {
    renderHome, refresh, bindActions, resetNews,
    assembleSnapshot: (o) => assembleHomeSnapshot(d, o),
    _newsStateForTest: () => ({ ...news }),
  };
}
