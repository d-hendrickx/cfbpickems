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
 *   (renderCompact — the Live Peek's compact-dashboard callback — is RETIRED, D1 Lane B 2026-10-08: Game Day's pills and open card replace it. A wiring that still passes one is ignored.)
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
 * ── THE JOIN NUDGE (DESIGN_D1_E, Drew D-88 2026-10-15: "home should tease the picks of a sport you did not enter to entise you to join and give you fomo" / "Add a join nudge now"; W-85) ──────────────────
 * The tease (other sports' revealed cards, deriveFeedCards) is unchanged; what it lacked was a way in. The app injects `joinOffers()` -> [{ dbCode, code, joinable }] (js/app.js: exactly the league overview's own
 * "Also in this league" cards, so the nudge and the sheet cannot disagree; [] with no verified member, withheld content or nothing to offer). assembleHomeSnapshot cleans it (cleanJoinOffers: nothing but those
 * three fields survives) and buildModel places ONE "Want in?" card per offered sport directly under that sport's NEWEST visible card (placeJoinNudges, js/home-sports.js), after the windowing and the dividers,
 * so it is never an ordinary entry (not counted, held, windowed or marked NEW) and never replaces a card. Variant A (`joinable`): one neutral button, the existing go-tab to picks with the sport, which
 * enterSportContext turns into the league overview at that sport's Join - nothing is joined by this tap. Variant B (the sport's week is closed): the same words, no button, not tappable.
 * The same facts reach the Now card (nowSportFacts): a viewer who is not IN THE NOW CARD'S WEEK of that sport (enteredForWeek: a late joiner counts from his next week) is never told "you have not picked yet" /
 * "your picks are in" / "You didn't pick this game", and Game Day's Open card offers him "Join NFL picks" where it asked him to "Make picks". The Final card's winner line and Results stay (R-2: they are the tease).
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
  getCurrentWeek, getActiveWeekId, getSession, getTimezone, getBackendMode, getPicksView, hasPlayerSubmitted,
} from './storage.js';
import { getActiveLeagueId } from './auth.js';
import { homeFeedContexts, playersForWeek } from './competition.js';   // D1 DI-528: who plays each sport (C4) and which sports the feed spans
import { deriveFeedCards, cleanJoinOffers, placeJoinNudges } from './home-sports.js';
import { buildRevealedView, deriveCards, cardCopy, requireEscHtml, isWagerReceipt, ordinal, cardsForGame, CAPTION_TYPES_THAT_ADD_A_FACT } from './feed-cards.js';
import { timeLabels, tapLabel, makeDateFormatter } from './feed-time.js';   // W-92 (DI-W92-7/8/10): the one "when did this happen" vocabulary (a pure leaf)
import { captionFor } from './feed-caption-lines.js';
import { computeCommissionerOpsPlan, LOCKING_SOON_MS } from './reminder-rules.js';
import { buildCopy } from './notify-copy.js';
import { computeFirstKickoff, computeEffectiveLockAt, calculateAtsWinner, evaluatePick } from './scoring.js';
import { atsMarginOf, sortWeeks, memberSeasonStats, viewerWeekLine } from './stats.js';
import { formatGameTime, formatSpread, buildAbbrMap, weeksInGroup, getEffectiveGroupId, TIME_ZONES } from './data-model.js';
import { icon } from './icons.js';
import { weekLockState } from './week-lock.js';   // D1 / DI-510 row 7 (2026-10-07): the Now card asks the ONE week-lock state, not its own clock test
import { haptic as nativeHaptic } from './haptics.js';
import { scrollWindow } from './section-drag.js';   // the house scroll helper (instant first, the numeric form iOS 15.0 needs as the fallback) — the reader's place and the new-posts pill only
// D1 Lane B (2026-10-07): the viewer's game order (DI-579), the one game-state vocabulary (DI-570), the card detail (DI-575/576) and the nav-hide pause (DI-574's amendment).
import { orderGames } from './game-order.js';
import { gameStateOf, freshnessLine } from './game-state.js';
import { hasDetail, buildCardDetail, cardDetailHTML, unavailableDetailHTML, detailTitle } from './card-detail.js';
import { pauseNavHide, prefersReducedMotion } from './nav-gestures.js';
// D1 Lane B Game Day (2026-10-08, DI-603…606; Drew D-58/D-63): the model + collapsed card, the open card's body, and the DOM half (the in-place grow, the keyed patch). The pick lines of an open row come
// ONLY from js/pick-groups.js's picksRowHTML (behind the gate, per row's own week) — home.js holds no other member's pick for them.
import { gameDayModel, gameDayCardHTML, gameDaySkeletonHTML, gameDayAnnouncements, gameViewAnnouncements, RAIL_HIDDEN_SCALE } from './gameday.js';
import { gameDayBodyHTML, gameDayBodyErrorHTML } from './gameday-sheet.js';
import { swapGameDay, patchGameDay, writeAroundGameDay, politeAnnouncer, patchGameView as patchGameViewDom } from './gameday-dom.js';
import { gameViewHTML, gameStepperHTML, gameUnavailableHTML } from './game-view.js';
import { picksRowHTML } from './pick-groups.js';
import { nextOpportunity, nextLine, nextShort, nextAction } from './next-up.js';   // D1 Lane B fix round 2 (DI-599): "What's next" — a pure leaf
import { validShareRef, shareLine } from './chat-share.js';   // D1 Lane B (DI-597): Share to chat — the reference's one gate and the headline (a pure leaf)
import { joinClosedCaption } from './sport-status.js';   // DESIGN_D1_E (DI-E1.7): the closed Join's sentence, ONE string shared with the league overview (a pure leaf)

// ═══ constants (every number the screen's behaviour hangs on is named, exported and tested) ═══════════════════════

export const HOME_TAB = 'home';
/** DI-586 — windowed pagination. The feed is derived locally (deriveCards), so "pagination" is RENDER windowing over the deterministic newest-first list: this many ordinary entries on the first
 *  paint, the next page appended BEFORE the reader reaches the end (an IntersectionObserver sentinel, rootMargin below) — no spinner, no gap, no layout jump. Total rendered cap: 200. */
export const FEED_PAGE_SIZE = 20;
export const FEED_CARD_CAP = 200;
export const SENTINEL_ROOT_MARGIN = '600px 0px';
/** DI-574 — the reader counts as "at the top" within this many points of it (js/nav-gestures.js NAV_ALWAYS_VISIBLE_NEAR_TOP_PX, 2 x the tab bar). */
export const READER_TOP_PX = 120;
/** "99+ new posts" — the pill never prints a number above this. */
export const PILL_COUNT_MAX = 99;
/** DI-587 — a visit counts (and advances the "last seen" marker when it ends) only after Home has been visible this long. */
export const SEEN_MIN_VISIT_MS = 2000;
/** DI-604 — the pill rail counts as "still being scrolled" this long after its last scroll event. */
export const RAIL_QUIET_MS = 150;
/** DI-604 (fix round 1, B3) — a finger that has been "down" on the rail this long without a touchend is a LOST touch (the target was detached, the system took the gesture): it stops parking the feed. */
export const RAIL_DOWN_MAX_MS = 30000;
/** DI-604 — a tapped pill's row is outlined this long (an outline, not an animation). */
export const GD_OUTLINE_MS = 1400;
/** DI-610 — the Game view's Related section shows this many cards, then "See all on Home". */
export const RELATED_CAP = 3;
/** DI-587 — cards that report a STATE, not an event (they have no moment of their own), are never marked NEW. */
/** DI-574 — VoiceOver: the pill's appearance is announced ONCE, politely, after this much quiet (arrivals inside the window fold into one announcement). */
export const PILL_ANNOUNCE_MS = 1000;
export const SEEN_STATE_ONLY_TYPES = Object.freeze(['picks.submitted', 'week.revealed', 'year.ago']);
/** SCRIBE's chat history is long; the feed carries the newest few, never all of it. */
export const SCRIBE_POST_LIMIT = 10;
export const SKELETON_CARD_COUNT = 4;
/** W-92 (DI-W92-10): while Home is the visible tab, the card times are rewritten in place this often (no repaint). */
export const TIME_TICK_MS = 60 * 1000;
/** W-92 (DI-W92-8): a tappable card's VoiceOver label ("{headline}. {supporting line}.") is trimmed to this BEFORE its time is added, so the time is never cut. */
export const CARD_LABEL_MAX = 160;
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
export const HOME_ACTIONS = Object.freeze(['go-tab', 'build-slate', 'retry-news', 'retry-load', 'open-card', 'new-posts',
  // D1 Lane B Game Day (DI-606): the header opens / closes the card in place; a pill or "All n ›" opens it (a pill focuses its game); a row opens that game's Game view; Collapse closes; the footer goes to the Dashboard.
  'gd-toggle', 'gd-pill', 'gd-more', 'gd-row', 'gd-collapse', 'gd-dashboard']);
// 'leaderboard' (Standings): Game Day's Final card offers "Results" and sends it (reviewer B2, 2026-10-08: the allow-list used to drop it, so the button did nothing). The list is what the markup may NAME; every other tab is still refused.
export const ACTION_TABS = Object.freeze(['picks', 'dashboard', 'commissioner', 'leaderboard']);
export const ACTION_COMM_TABS = Object.freeze(['week', 'games']);
/** The action tabs that are about ONE sport (D1 Part 2 item 6): a go-tab to one of these may carry the sport of the card it sits on, and only these. */
const SPORT_ACTION_TABS = Object.freeze(['picks', 'dashboard']);
const HAPTIC_KINDS = Object.freeze(['medium', 'light']);

/** DESIGN_D1_E (DI-E1.7): the join nudge's words, verbatim. `code` is the sport's code ('NFL'); the closed variant's second sentence is the league overview's own caption (js/sport-status.js). */
export const JOIN_NUDGE_COPY = Object.freeze({
  title: 'Want in?',
  open: (code) => `You're watching ${code} from the sidelines. Join to make picks and get on the ${code} standings.`,
  closed: (code) => `You're watching ${code} from the sidelines. ${joinClosedCaption(code)}`,
  button: (code) => `Join ${code} picks`,
});

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

/**
 * FB-013 (D1 batch H, 2026-10-07; Drew: "I dont want random scribe messages in the home feed it needs to make sense what im looking at").
 * Home no longer mirrors every public SCRIBE chat post. A SCRIBE post reaches Home only when its `meta.kind` (and, for a lifecycle notice,
 * its `meta.event`) is on these frozen allow-lists: a league development, tied to a named week, that no Home card already shows.
 *   KEPT:    kind 'lifecycle', event PICKS_LOCKED ("Week N is locked — 5/6 got their picks in").
 *   CHAT ONLY (everything else), notably: every kind-less SCRIBE line — tier-0 banter and live observations (meta.trigger: lastPlaceTaunt,
 *            coverageFlip, upsetWatch, callout …), tier-1 queued lines, tier-2 Ask-SCRIBE replies and autonomous posts; 'whatsNew'
 *            (app release notes); the wager receipts 'wagerLogged' / 'wagerDue'; lifecycle PICKS_OPENED and RESULTS_FINALIZED (Home's own
 *            slate.published and week.result cards already say them — no duplicate clutter); lifecycle OBLIGATION_CREATED / _SETTLED (the
 *            platform risk register, App Store 5.3: "obligations never appear on feeds", ARCHITECTURE_NOTES_092626.md §11).
 * A game-tagged analysis line may earn a place once the scribe.post card can name its game (the card shows the body only today, so on Home it
 * would read as exactly the contextless line Drew reported). The filter is allow-only and fails closed: no meta, a non-string kind, an unknown
 * kind or event — all stay in Chat. It runs at the SOURCE (makeChatCandidateSource), before the week-reveal gate, which still applies.
 */
export const HOME_SCRIBE_KINDS = Object.freeze(['lifecycle']);
export const HOME_SCRIBE_LIFECYCLE_EVENTS = Object.freeze(['PICKS_LOCKED']);
/**
 * DI-578 (D1 Lane B, PF-444 acceptance 1/3) — the ONE widening of the allow-list above, and the coordinator's rule for it: a SCRIBE post that NAMES ITS GAME may be a Home card, because the card can
 * then say which game and week it is about ("SCRIBE · Week 9 · Oklahoma at Texas"). Fail closed on all three: the post must carry a vetted GAME-ANALYSIS trigger (these are tier-0 observations about
 * the state of a game — never a roast of a person, never an Ask-SCRIBE answer, never a release note), it must resolve to a game in THIS league, and it must not be part of a conversation (a reply, a mention).
 * The blind gate (every named week public) still applies after this. Unknown trigger / no game / a reply = Chat only. Producers: js/scribeLines.js's tier-0 pools.
 */
export const HOME_SCRIBE_GAME_TRIGGERS = Object.freeze(['coverageFlip', 'upsetWatch']);
/**
 * SECURITY F-2 (the 0045 review, 2026-10-08): the lifecycle allow-list trusts a row by its meta, and `meta` is member-writable (any member can relay an
 * `author:'scribe'` row through chat_append_system). So a lifecycle notice reaches Home only in the ONE shape the app itself writes and migration 0045 lets
 * land: the deterministic id `sys_lc_<event>_<weekId>` (js/app.js lifecycleChatId, same sanitizer) for a `meta.weekId` that is a REAL week of this league
 * whose status is locked, live or final (the server refuses `sys_lc_PICKS_LOCKED_<week>` for any other week, and any lifecycle row under another id). A
 * notice that names no week, names a week we do not have, sits under another id, or claims a week that has not locked stays in Chat. `weeks` is the
 * league's week list the candidate source already holds; without it, nothing is admitted (fail closed).
 */
const LIFECYCLE_LOCKED_STATUSES = Object.freeze(['locked', 'live', 'final']);
/**
 * The P-10 race closed on Home (coordinator, 2026-10-08): the words a lifecycle card (today: PICKS_LOCKED) shows are the app's OWN lifecycle copy (js/notify-copy.js buildCopy, the
 * helper js/app.js postPicksLockedNotice voices the room post with) for the VALIDATED week's number, seeded by the row's id exactly as the poster's device seeds it
 * — never the row's body, which a member may have written. Count facts are not used: they are the poster's device's claim, not the week's. null = no copy
 * (not a lock notice, or its week is not in this league's list): the caller drops the card.
 */
export function lifecycleHomeBody(m, { weeks = [] } = {}) {
  const meta = (m && m.meta && typeof m.meta === 'object') ? m.meta : null;
  if (!meta || meta.kind !== 'lifecycle' || typeof meta.event !== 'string') return null;   // the allow-list is isHomeScribePost's; this voices whatever it admitted
  const w = asArray(weeks).find((x) => x && x.weekId === meta.weekId);
  if (!w || !Number.isFinite(Number(w.weekNumber))) return null;
  try {
    const out = buildCopy(meta.event, { weekN: Number(w.weekNumber) }, String(m.id ?? ''));
    return out && typeof out.body === 'string' && out.body ? out.body : null;
  } catch { return null; }
}
const lifecycleIdOf = (event, weekId) => `sys_lc_${event}_${String(weekId ?? '').replace(/[^a-zA-Z0-9_:-]/g, '_')}`;
export function isHomeScribePost(m, { weeks = [] } = {}) {
  const meta = (m && m.meta && typeof m.meta === 'object') ? m.meta : null;
  if (!meta || typeof meta.kind !== 'string' || !HOME_SCRIBE_KINDS.includes(meta.kind)) return false;
  if (meta.kind === 'lifecycle') {
    if (!(typeof meta.event === 'string' && HOME_SCRIBE_LIFECYCLE_EVENTS.includes(meta.event))) return false;
    if (!isNonEmptyString(meta.weekId) || String(m.id ?? '') !== lifecycleIdOf(meta.event, meta.weekId)) return false;   // F-2: the app's own id, nothing else
    const w = asArray(weeks).find((x) => x && x.weekId === meta.weekId);
    return !!w && LIFECYCLE_LOCKED_STATUSES.includes(w.status);                                                          // F-2: a real week of this league that has locked
  }
  return true;
}

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

/**
 * Game Day's clock times, in the DI's own copy ("Picks lock Sat 11:30 AM", "Next kickoff 7:30 PM", "Kickoff Sat 12:00 PM"): weekday + a 12-hour time in the VIEWER'S time zone (CONVENTIONS #19: render-time). Shorter than the
 * Dashboard's "Sat 9/13 12:00 PT", which is what lets the card's two lines stay two lines at large text (the size budget). A game whose time is not confirmed (date-only, or kickoffConfirmed false) keeps the
 * shipped formatter's honest "Time TBD" — this never invents a clock time.
 */
export function shortWhen(v, tzKey) {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return '';
  const iana = (TIME_ZONES.find(z => z.key === tzKey) || TIME_ZONES[0]).iana;
  try {
    const d = new Date(ms);
    return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: iana })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: iana })}`;
  } catch { return ''; }
}
const kickLabel = (g, iso, tzKey) => ((g && (g.kickoffDateOnly === true || g.kickoffConfirmed === false)) ? formatGameTime(iso, tzKey, g) : shortWhen(iso, tzKey));

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

// ═══ the competitions (D1 Lane B, X1 — the narrowest interface Lane A's sport model plugs into) ═════════════════════════════════════
// Lane A (DI-520) will provide, per league, the list of enabled competitions: `{ competitionId, sport, label, currentWeekId, viewerEntered }`. Until it does, `normalizeCompetitions()`
// answers with ONE default competition that covers every week and carries no sport word anywhere (S1): a one-sport league is byte-identical to v0.29.0. Everything below is written for
// N >= 1 and shows a sport label only when N > 1. NOTHING here ranks, sums or averages across competitions (DI-594): every figure is computed over exactly one competition's weeks.
export const DEFAULT_COMPETITION_ID = 'default';
const sportOfWeek = (w) => (w && isNonEmptyString(w.sport) ? w.sport : 'cfb');
const idList = (v) => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined).map(String) : null);
export function normalizeCompetitions(list, currentWeekId = null) {
  const cleaned = [], seen = new Set();
  for (const c of asArray(list)) {
    if (!c || typeof c !== 'object' || !isNonEmptyString(c.competitionId) || seen.has(c.competitionId)) continue;
    seen.add(c.competitionId);
    const sport = isNonEmptyString(c.sport) ? c.sport : 'cfb';
    // The Lane A seam (merge of int, 2026-10-08): a competition built from the Home feed CONTEXTS also carries its `weekIds` (R1: a week's sport is the sport of the competition that holds it, never
    // the week record's own field), its entrants as of now (`playerIds`, the roster Standings ranks) and each week's own entrants (`weekEntrants[weekId]`, C1: joined before THAT week's lock).
    // (Each key is present only when the list carries it, so an X1 list without them normalizes to exactly what it did.)
    const extra = {};
    const weekIds = idList(c.weekIds), playerIds = idList(c.playerIds);
    if (weekIds) extra.weekIds = weekIds;
    if (playerIds) extra.playerIds = playerIds;
    if (c.weekEntrants && typeof c.weekEntrants === 'object' && !Array.isArray(c.weekEntrants)) {
      const weekEntrants = Object.create(null);           // keyed by week id: no prototype a hostile key could reach
      for (const [k, v] of Object.entries(c.weekEntrants)) { const ids = idList(v); if (ids) weekEntrants[k] = ids; }
      extra.weekEntrants = weekEntrants;
    }
    cleaned.push({ competitionId: c.competitionId, sport, label: isNonEmptyString(c.label) ? c.label : sport.toUpperCase(), currentWeekId: isNonEmptyString(c.currentWeekId) ? c.currentWeekId : null, viewerEntered: c.viewerEntered !== false, single: false, ...extra });
  }
  return cleaned.length ? cleaned : [{ competitionId: DEFAULT_COMPETITION_ID, sport: 'cfb', label: 'CFB', currentWeekId, viewerEntered: true, single: true }];
}
/**
 * The Home feed contexts (js/competition.js homeFeedContexts: `{ competitionId, dbCode, code, weekIds, playerIds, weekEntrants, currentWeekId }`, null in a one-sport league) as X1 competitions. The viewer is
 * "entered" in a sport when they are among its entrants now; a signed-out viewer keeps the X1 default (true), since every personal field is already off without a viewer id.
 */
export function competitionsFromContexts(contexts, viewerId = null) {
  if (!Array.isArray(contexts) || !contexts.length) return null;
  return contexts.filter(c => c && isNonEmptyString(c.competitionId)).map(c => ({
    competitionId: c.competitionId, sport: c.dbCode, label: c.code, currentWeekId: c.currentWeekId,
    viewerEntered: isNonEmptyString(viewerId) ? asArray(c.playerIds).map(String).includes(String(viewerId)) : true,
    weekIds: c.weekIds, playerIds: c.playerIds, weekEntrants: c.weekEntrants,
  }));
}
/** The competition a week belongs to: by its `weekIds` when the list carries them (R1), else (a list without them: the X1 fixtures) by the week's own sport. The single default holds every week. */
const competitionOfWeek = (comps, w) => {
  if (!w) return null;
  let keyed = false;
  for (const c of comps) {
    if (c.single) return c;
    if (Array.isArray(c.weekIds)) { keyed = true; if (c.weekIds.includes(String(w.weekId))) return c; }
  }
  return keyed ? null : (comps.find(c => c.sport === sportOfWeek(w)) || null);
};
/** The sport of a week (R1): its competition's; a week no competition holds has no sport ('' — no label, no match). */
const weekSport = (s, w) => { const c = competitionOfWeek(asArray(s.competitions), w); return c ? c.sport : (asArray(s.competitions).some(x => Array.isArray(x.weekIds)) ? '' : sportOfWeek(w)); };
/** Is the viewer entered in the sport of `w` FOR THAT WEEK (C1: a late join counts from the next week)? From the week's own entrants when the contexts carry them, else the competition's flag. */
const enteredForWeek = (comp, w, viewer) => {
  if (!comp) return true;
  const ids = comp.weekEntrants && w && Array.isArray(comp.weekEntrants[w.weekId]) ? comp.weekEntrants[w.weekId] : null;
  if (ids && isNonEmptyString(viewer)) return ids.includes(String(viewer));
  return comp.viewerEntered !== false;
};
const competitionWeeks = (s, comp) => (comp.single ? asArray(s.weeks) : asArray(s.weeks).filter(w => w && competitionOfWeek(asArray(s.competitions), w) === comp));
const competitionLabel = (s, sport) => { const c = asArray(s.competitions).find(x => x.sport === sport); return c ? c.label : String(sport || '').toUpperCase(); };
/**
 * DESIGN_D1_E (DI-E1.5, W-85): the Now card's week, from the VIEWER'S side. `entered` = is he IN THIS WEEK of that sport (enteredForWeek: a late joiner counts from his next week); it decides every
 * first-person line ("you have not picked yet", "your picks are in", "You didn't pick this game"). `offer` = the app's join offer for that sport (only a sport he does NOT play is ever offered), which
 * decides the Join button; `code` names the sport. A signed-out viewer, a week no competition holds and a one-sport league are "entered": nothing is said to them that was not said before.
 */
function nowSportFacts(s, cur, viewer) {
  const comp = cur ? competitionOfWeek(asArray(s.competitions), cur) : null;
  const entered = !viewer || !comp || comp.single ? true : enteredForWeek(comp, cur, viewer);
  if (entered) return { entered: true, offer: null, code: comp ? comp.label : '' };
  const offer = asArray(s.joinOffers).find(o => o && o.dbCode === comp.sport) || null;
  return { entered: false, offer, code: offer ? offer.code : comp.label };
}

// ═══ the live scope (DI-577 / DI-582 / PF-443 / PF-447): every live game the summary and the peek speak for ═════════════════════════
/**
 * "Every live game", not only the Now card's week: the Now card's week GROUP (both parts of a multi-part week) and, once Lane A supplies them, every other competition's current week group.
 * The blind rule is per week part: a part other than the Now card's own contributes only when ITS picks are public (`arePicksPublic`). Only status 'live' is live — a final, postponed or
 * delayed game is never counted (DI-570). Ordered by the viewer's game order (DI-579: Kickoff by default, so a one-sport league is unchanged).
 * @returns {{entries:Array<{g:object, week:object, sport:string, stale:boolean, label:string}>, parts:object[], showSport:boolean}}
 */
export function liveScope(s, cur, { now = Date.now(), isCommissioner = false } = {}) {
  const weeks = asArray(s.weeks);
  const comps = asArray(s.competitions);
  const showSport = comps.length > 1;
  const parts = [], seen = new Set();
  const take = (w) => {
    for (const m of weeksInGroup(weeks, w)) {
      if (!m || seen.has(m.weekId)) continue;
      if (m.dataSourceMode === 'demo' && isCommissioner !== true) continue;
      if (m.weekId !== cur.weekId && !arePicksPublic(m)) continue;
      seen.add(m.weekId); parts.push(m);
    }
  };
  take(cur);
  if (showSport) for (const c of comps) { const w = weeks.find(x => x && x.weekId === c.currentWeekId); if (w) take(w); }
  const byWeek = new Map(parts.map(w => [w.weekId, w]));
  const hasProvider = typeof s.liveEntryFor === 'function';
  const stateOf = (g) => { if (!hasProvider) return null; try { return gameStateOf(g, { liveEntry: s.liveEntryFor(g.gameId), now }); } catch { return null; } };
  const live = asArray(s.games).filter(g => g && g.status === 'live' && byWeek.has(g.weekId));
  // DI-579 REV 2 (Drew's feedback, D-54): Game Day is NOT ordered by the viewer's Dashboard sort — kickoff order, always. The viewer's own order (js/game-order.js, storage getters) is wired to the Dashboard only.
  const ordered = orderGames(live, { mode: 'kickoff' });
  const entries = ordered.map(g => {
    const st = stateOf(g);
    return { g, week: byWeek.get(g.weekId), sport: weekSport(s, byWeek.get(g.weekId)), stale: !!st && st.phase === 'live-stale', label: st && st.phase === 'live' ? st.label : '' };
  });
  return { entries, parts, showSport };
}

// ═══ the pinned card's personal line (DI-583 / PF-448): "Your week" and "Season", from the SAME functions Standings and the weekly update use ═══
/**
 * Two figures, never a third: your RAW week record (viewerWeekLine — the weekly-update card's own `correctCount ?? correctPicks` pair, provisional until the week is final) and your SEASON
 * rank and Win % (memberSeasonStats — Standings' own function and tie contexts, over the S-C2 revealed view, so the rank moves only when a week is finalized). A season W-L is deliberately NOT
 * shown: Standings' "Picks" column is the WEIGHTED total, so a raw season pair could contradict it (interpretation I-2). One pair PER competition the viewer is entered in; a competition they are
 * not entered in gets one calm sentence, never 0-0 and never last place. Open / Locked weeks: Season only (nothing is graded yet). Draft / no weeks / between seasons: nothing.
 * @returns {{items:Array<{key:string,label:string,value:string,sr:string}>, notes:string[]}|null}
 */
export function viewerStatsFor(s, { cur, state, viewer }) {
  if (!isNonEmptyString(viewer) || !['live', 'final', 'open-pending', 'open-done', 'locked-near', 'locked-far'].includes(state)) return null;
  const comps = asArray(s.competitions);
  const showSport = comps.length > 1;
  const items = [], notes = [], perComp = [];   // `perComp` (D1 Game Day, DI-603/605): the same figures per competition as plain strings, for Game Day's header and "Your numbers" — never a third figure
  const players = asArray(s.players).filter(p => p && p.active);
  for (const comp of comps) {
    const prefix = showSport ? `${comp.label} · ` : '';
    if (!comp.viewerEntered) { notes.push(`You're not entered in ${comp.label} picks. You can still follow every game and join the chat.`); continue; }
    const rec = { competitionId: comp.competitionId, label: comp.label, prefix, weekValue: '', weekRaw: '', seasonValue: '', rank: '' };
    // "Season Nth of N" ranks among THIS competition's entrants (the Lane A seam, C4: the roster Standings ranks, playersForCompetition as of now, carried in the context's `playerIds`); a one-sport
    // league has no contexts and ranks the active roster, as it always did. A non-entrant's pick rows count for nothing (A3).
    const entrantIds = Array.isArray(comp.playerIds) ? new Set(comp.playerIds) : null;
    const entrants = entrantIds ? players.filter(p => entrantIds.has(String(p.playerId))) : players;
    const weeks = competitionWeeks(s, comp);
    const ids = new Set(weeks.map(w => w.weekId));
    const wc = comp.single ? cur : (weeks.find(w => w.weekId === comp.currentWeekId) || null);
    const season = wc ? wc.season : null;
    // — the week
    if (wc && arePicksPublic(wc)) {
      let value = '', sr = '';
      const finalWeek = comp.single ? state === 'final' : (typeof s.confirmedStatusFor === 'function' && s.confirmedStatusFor(wc) === 'final');
      const stored = finalWeek ? asArray(s.revealedWeeklyResults).find(r => r && r.weekId === wc.weekId && r.playerId === viewer) : null;
      const line = viewerWeekLine({ week: wc, games: s.games, picks: s.picks, viewerId: viewer });
      if (stored) { value = `${numStr(stored.correctCount ?? stored.correctPicks ?? 0)}–${numStr(stored.incorrectCount ?? stored.incorrectPicks ?? 0)}`; }
      else if (!line || line.picked === 0) { value = 'No picks this week'; }
      else if (finalWeek) { value = `${numStr(line.wins)}–${numStr(line.losses)}`; }
      else if (line.graded === 0) { value = 'No results yet'; }
      else { value = `${numStr(line.wins)}–${numStr(line.losses)} so far`; sr = 'provisional'; }
      items.push({ key: `week:${comp.competitionId}`, label: `${prefix}Your week`, value, sr });
      rec.weekValue = value;
      rec.weekRaw = stored ? `${numStr(stored.correctCount ?? stored.correctPicks ?? 0)}–${numStr(stored.incorrectCount ?? stored.incorrectPicks ?? 0)}` : (line && line.picked > 0 && line.graded > 0 ? `${numStr(line.wins)}–${numStr(line.losses)}` : '');
    }
    // — the season
    const rw = asArray(s.revealedWeeks).filter(w => w && ids.has(w.weekId) && (season === null || season === undefined || String(w.season) === String(season)));
    let sv = 'Not ranked yet', ssr = 'No finalized weeks';
    if (rw.length) {
      const view = {
        players: entrants, revealedWeeks: rw, revealedGames: asArray(s.revealedGames).filter(g => g && ids.has(g.weekId)), revealedPicks: asArray(s.revealedPicks).filter(p => p && ids.has(p.weekId) && (!entrantIds || entrantIds.has(String(p.playerId)))),
        revealedWeeklyResults: asArray(s.revealedWeeklyResults).filter(r => r && ids.has(r.weekId)), season, allWeeks: weeks, tieContexts: s.tieContexts instanceof Map ? s.tieContexts : null,
      };
      let st = null;
      try { st = memberSeasonStats(viewer, view); } catch { st = null; }
      if (st && Number.isFinite(Number(st.currentRank)) && st.currentRank > 0 && st.winPct !== null && st.winPct !== undefined) {
        sv = `${ordinal(st.currentRank)} of ${numStr(entrants.length)} · ${numStr(st.winPct)}%`; ssr = '';
        rec.rank = ordinal(st.currentRank);
      }
    }
    items.push({ key: `season:${comp.competitionId}`, label: `${prefix}Season`, value: sv, sr: ssr });
    rec.seasonValue = sv;
    perComp.push(rec);
  }
  return items.length || notes.length ? { items, notes, perComp } : null;
}

// ═══ GAME DAY (D1 Lane B, DI-603 / 604 / 605 / 606 rev 3 · Drew D-58 "the red card itself open[s] up", D-63 "home gameday ready to build") ═══════════════════════════════════════════════
/**
 * The red card at the top of Home. js/gameday.js is its pure model and collapsed markup, js/gameday-sheet.js the open body, js/gameday-dom.js the grow / patch; THIS is the assembly: which games are in scope,
 * what the Now card's state means for the card, and the viewer's own figures. The Now card's STATE MACHINE (`nowCardModel`) is unchanged — it still decides Draft / Open / Locked / Live / Final / Between;
 * Game Day is how every one of those states except Draft, Between and an empty league is DRAWN.
 */
export const GAME_DAY_STATES = Object.freeze(['live', 'locked-far', 'locked-near', 'open-pending', 'open-done', 'final']);

/**
 * The week records whose games Game Day speaks for (DI-603: every sport, "Home is the sport-agnostic shared feed"): the Now card's week GROUP (both parts of a multi-part week) and, once Lane A supplies
 * several competitions, every other competition's current week group. DRAFT weeks never appear for a member (the commissioner sees them, as everywhere), DEMO weeks never appear for anyone but the commissioner
 * (UN-71). Each game is later gated on ITS OWN week (security C2) — a part that is not public still contributes its games, drawn in the blind form, never with another member's pick.
 */
export function gameDayParts(s, cur, { isCommissioner = false } = {}) {
  const weeks = asArray(s.weeks);
  const comps = asArray(s.competitions);
  const out = [], seen = new Set();
  const status = (w) => { try { return (typeof s.confirmedStatusFor === 'function' ? s.confirmedStatusFor(w) : null) || w.status; } catch { return w.status; } };
  const take = (w) => {
    for (const m of weeksInGroup(weeks, w)) {
      if (!m || seen.has(m.weekId)) continue;
      if (isCommissioner !== true && m.dataSourceMode === 'demo') continue;      // UN-71 (the same rule as liveScope's take, written the other way round so the mutants of that one stay unambiguous)
      if (status(m) === 'draft' && isCommissioner !== true) continue;
      seen.add(m.weekId); out.push(m);
    }
  };
  take(cur);
  if (comps.length > 1) for (const c of comps) { const w = weeks.find(x => x && x.weekId === c.currentWeekId); if (w) take(w); }
  return out;
}

/** The viewer's coverage on ONE game, from THEIR OWN pick only: live is tentative (covering / trailing / even), final is settled (covered / missed / push). Pending before kickoff. */
export function ownCoverOf(game, team, phase) {
  if (!game || !isNonEmptyString(team)) return null;
  const p = phase && phase.phase;
  if (p === 'live' || p === 'live-stale') {
    const c = liveCover(game, team);
    return c ? { kind: c.state, margin: c.margin } : { kind: 'pending', margin: '' };
  }
  if (p === 'final') {
    const r = evaluatePick({ selectedTeam: team }, game);
    const m = atsMarginOf(game);
    const margin = m === null ? '' : String(Number(m.toFixed(1)));
    if (r === 'win') return { kind: 'covered', margin };
    if (r === 'loss') return { kind: 'missed', margin };
    if (r === 'no_decision') return { kind: 'push', margin: '' };
  }
  return { kind: 'pending', margin: '' };
}

/** "Favorite + margin", never a signed number (AD-03): the shipped formatter; '' while the line is unset. */
const gameLineText = (g) => { const sv = g.lockedSpread !== null && g.lockedSpread !== undefined ? g.lockedSpread : g.spread; const t = sv === null || sv === undefined ? '' : formatSpread(sv, g.favorite, g); return t === 'TBD' ? '' : t; };

/**
 * EVERY game in scope, one entry each: { game, weekId, sport, sportLabel, entered, phase, ownTeam, lineText }. `ownTeam` is the VIEWER'S OWN pick (S-C3: explicit viewer id, matched on playerId, never "the first pick
 * found"); no other member's pick is read here. `entered` is Lane A's `viewerEntered` for the game's sport (a one-sport league: true for any viewer).
 */
export function gameDayEntries(s, cur, { now = Date.now(), isCommissioner = false, viewerId = null } = {}) {
  const comps = asArray(s.competitions);
  const showSport = comps.length > 1;
  const parts = gameDayParts(s, cur, { isCommissioner });
  const byWeek = new Map(parts.map(w => [w.weekId, w]));
  const hasProvider = typeof s.liveEntryFor === 'function';
  const phaseOf = (g) => {
    const fmtKick = (iso) => kickLabel(g, iso, s.timezone);
    if (g.status === 'live' && !hasProvider) return { phase: 'live', label: '', score: null, fresh: null, capturedAt: null, ageMs: null, pulse: false };   // no capture source wired (tests / a bare Home): nothing to call stale
    let entry = null;
    try { entry = hasProvider ? s.liveEntryFor(g.gameId) : null; } catch { entry = null; }
    return gameStateOf(g, { liveEntry: entry, now, formatKickoff: fmtKick });
  };
  const abbrByWeek = new Map();                                       // team abbreviations are unique within a WEEK (buildAbbrMap), the same map the Dashboard prints
  const abbrFor = (weekId) => { if (!abbrByWeek.has(weekId)) abbrByWeek.set(weekId, buildAbbrMap(asArray(s.games).filter(x => x && x.weekId === weekId))); return abbrByWeek.get(weekId); };
  const out = [];
  for (const g of asArray(s.games)) {
    if (!g || !byWeek.has(g.weekId)) continue;
    const week = byWeek.get(g.weekId);
    const comp = competitionOfWeek(comps, week);
    const sport = weekSport(s, week);
    const ab = abbrFor(g.weekId);
    out.push({
      game: g, weekId: week.weekId, sport, sportLabel: showSport && comp ? comp.label : '',
      entered: enteredForWeek(comp, week, viewerId),
      phase: phaseOf(g), ownTeam: isNonEmptyString(viewerId) ? ownPickTeam(s.picks, g.gameId, viewerId) : null, lineText: gameLineText(g),
      awayAbbr: ab.get(g.awayTeam) || '', homeAbbr: ab.get(g.homeTeam) || '',
    });
  }
  return out;
}

/** The collapsed header's right side: "You: 3–1 · 2nd" (one competition entered), "CFB 3–1 · 2nd" (entered in one of several), nothing when entered in two (the open card shows one block per sport). */
function gameDayPersonal(stats, showSport) {
  const per = stats && Array.isArray(stats.perComp) ? stats.perComp : [];
  if (per.length !== 1) return null;
  const r = per[0];
  const core = [r.weekRaw, r.rank].filter(Boolean).join(' · ');
  if (!core) return null;
  const text = showSport ? `${r.label} ${core}` : `You: ${core}`;
  return { text, aria: `Your week ${r.weekRaw || 'no results yet'}${r.rank ? `, season rank ${r.rank}` : ''}` };
}

/** "Your numbers" for the open card: one line per competition entered (Week … · Season …), no figure ever summed across sports (DI-594); a sport not joined gets the calm sentence. */
function gameDayStatLines(stats) {
  if (!stats) return { lines: [], notes: [] };
  const lines = asArray(stats.perComp).map(r => {
    const wk = r.weekValue ? (/^\d/.test(r.weekValue) ? `Week ${r.weekValue}` : r.weekValue) : '';
    const season = r.seasonValue === 'Not ranked yet' ? r.seasonValue : `Season ${r.seasonValue}`;
    return `${r.prefix}${[wk, season].filter(Boolean).join(' · ')}`;
  });
  const notes = asArray(stats.notes).map(n => n.replace("You're not entered in ", "You're not in "));
  return { lines, notes };
}

/**
 * DI-599 — the viewer's next shared opportunity for THIS snapshot (js/next-up.js decides; this only hands it the snapshot's own answers): the server-confirmed week status, the one effective lock
 * instant, Lane A's "entered in that sport", and the viewer's OWN picks (a full slate = every game of the week picked). Draft and demo weeks are filtered there. Null viewer = none.
 */
export function nextUpFor(s, { viewerId = null, isCommissioner = false, now = Date.now() } = {}) {
  const viewer = isNonEmptyString(viewerId) ? viewerId : '';
  const comps = asArray(s.competitions);
  const games = asArray(s.games);
  const mine = new Map();
  for (const p of asArray(s.picks)) if (p && p.playerId === viewer && isNonEmptyString(p.weekId)) mine.set(p.weekId, (mine.get(p.weekId) || 0) + 1);
  return nextOpportunity({
    weeks: asArray(s.weeks), games, viewerId: viewer, isCommissioner, now,
    statusOf: (w) => { try { return (typeof s.confirmedStatusFor === 'function' ? s.confirmedStatusFor(w) : null) || w.status; } catch { return w.status; } },
    lockAtOf: (w, gs) => { const d = computeEffectiveLockAt(w, gs); return d && Number.isFinite(d.getTime()) ? d.getTime() : null; },
    sportOf: (w) => weekSport(s, w) || null,
    enteredIn: (sport, w) => enteredForWeek(w ? competitionOfWeek(comps, w) : (comps.find(x => x.single || x.sport === sport) || null), w, viewer),
    pickedAll: (weekId) => { const n = games.filter(g => g && g.weekId === weekId).length; return n > 0 && (mine.get(weekId) || 0) >= n; },
    labelOf: (sport) => competitionLabel(s, sport),
  });
}

/** The assembled input for gameDayModel(): everything the card says, as plain data (see the model's header). */
export function gameDayInputFor(s, nowModel, { viewerId = null, isCommissioner = false, now = Date.now() } = {}) {
  const weeks = asArray(s.weeks);
  const cur = weeks.find(w => w && w.weekId === nowModel.weekId) || null;
  const viewer = isNonEmptyString(viewerId) ? viewerId : '';
  const comps = asArray(s.competitions);
  const showSport = comps.length > 1;
  const entries = cur ? gameDayEntries(s, cur, { now, isCommissioner, viewerId: viewer }) : [];
  const nowFacts = nowSportFacts(s, cur, viewer);
  const games = cur ? asArray(s.games).filter(g => g && g.weekId === cur.weekId) : [];
  const stats = viewer && cur ? viewerStatsFor(s, { cur, state: nowModel.state, viewer }) : null;
  const lockAt = cur ? computeEffectiveLockAt(cur, games) : null;
  const first = computeFirstKickoff(games);
  const mine = new Set(asArray(s.picks).filter(p => p && p.weekId === (cur && cur.weekId) && p.playerId === viewer).map(p => p.gameId));
  const fmt = { time: (v) => shortWhen(v, s.timezone), countdown: formatCountdown };
  // freshness: the youngest live capture's "Updated 12s ago", or — when any score is behind — the oldest stale capture's "last update 4 min ago"
  const liveStates = entries.filter(e => e.phase.phase === 'live' || e.phase.phase === 'live-stale').map(e => e.phase);
  const stale = liveStates.filter(p => p.phase === 'live-stale').sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0))[0] || null;
  const fresh = liveStates.filter(p => p.phase === 'live' && p.fresh === true).sort((a, b) => (a.ageMs ?? 0) - (b.ageMs ?? 0))[0] || null;
  const staleLine = stale ? freshnessLine(stale, { now }) : '';
  const input = {
    state: nowModel.state, weekN: nowModel.weekN === '' ? null : Number(nowModel.weekN), weekId: nowModel.weekId, viewerId: viewer, entries, showSport,
    actionSport: isNonEmptyString(nowModel.sport) ? nowModel.sport : null,
    entered: nowFacts.entered, joinOffer: nowFacts.offer, sportCode: nowFacts.code,   // DESIGN_D1_E (DI-E1.5): is the viewer in the Now card's sport and week; the app's join offer for it
    weekScoped: new Set(entries.map(e => e.weekId)).size <= 1 && !showSport,
    multiEntered: comps.filter(c => c.viewerEntered !== false).length > 1,
    lockMs: lockAt && Number.isFinite(lockAt.getTime()) ? lockAt.getTime() : null,
    firstKickoffMs: first ? first.getTime() : null,
    counts: s.submissionCounts && cur ? s.submissionCounts[cur.weekId] || null : null,
    remaining: viewer ? games.filter(g => !mine.has(g.gameId)).length : null, gameTotal: games.length,
    personal: nowModel.state === 'live' || nowModel.state === 'final' ? gameDayPersonal(stats, comps.length > 1) : null,
    stats: gameDayStatLines(stats),
    fmt, now, coverOf: ownCoverOf,
    freshText: fresh ? freshnessLine(fresh, { now }) : '', staleText: staleLine,
    mineLine: '', finalLine: null,
  };
  if (nowModel.state === 'live' && cur) {
    const line = viewer ? viewerWeekLine({ week: cur, games: s.games, picks: s.picks, viewerId: viewer }) : null;
    input.mineLine = line && line.picked > 0 && line.graded > 0 ? `You're ${numStr(line.wins)}–${numStr(line.losses)}` : '';
  }
  if (nowModel.state === 'final' && cur) {
    const rows = asArray(s.revealedWeeklyResults).filter(r => r && r.weekId === cur.weekId);   // S2: the REVEALED view only
    const nameOf = (id) => { const p = asArray(s.players).find(x => x && x.playerId === id); return (p && p.displayName) || ''; };
    const rec = (r) => `${numStr(r.correctCount ?? r.correctPicks ?? 0)}–${numStr(r.incorrectCount ?? r.incorrectPicks ?? 0)}`;
    const winner = rows.find(r => r.isWinner);
    const grouped = weeksInGroup(weeks, cur).length > 1;      // a pooled multi-part week has no single winner to name
    const me = viewer ? rows.find(r => r.playerId === viewer) : null;
    // DI-603 / DI-599: "You went 7–3 · Next: …" — the next shared opportunity in its short form; nothing at all when nothing is published still to come (the card never says "Next: nothing")
    const next = viewer ? nextUpFor(s, { viewerId: viewer, isCommissioner, now }) : null;
    input.finalLine = { winnerLine: !grouped && winner && nameOf(winner.playerId) ? `${nameOf(winner.playerId)} took Week ${numStr(cur.weekNumber)}, ${rec(winner)}` : `Week ${numStr(cur.weekNumber)} is final.`, mine: me ? rec(me) : '', next: next ? nextShort(next, fmt, { showSport }) : '' };
    // …and the OPEN Final card always says it in full (DI-599 (a): "What's next" under the stats), so the collapsed card's short form can fold away at the largest text without losing it
    if (next) input.stats = { lines: input.stats.lines, notes: [...input.stats.notes, `What's next: ${nextLine(next, fmt, { showSport })}`] };
  }
  return input;
}

const numOrNull = (v) => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const safeLogo = (fn, game, side) => { try { const u = fn(game, side); return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null; } catch { return null; } };

/** The root text scale (Dynamic Type): at accessibility sizes the pill rail is not drawn at all (DI-603). 1 when it cannot be measured. */
function rootTextScale() {
  try {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || !document.documentElement) return 1;
    const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(px) && px > 0 ? px / 16 : 1;
  } catch { return 1; }
}

// ═══ dependencies ═════════════════════════════════════════════════════════════════════════════════════════════════

const REQUIRED_DEPS = Object.freeze([
  'escHtml', 'isContentWithheld', 'confirmedStatusFor', 'picksReadConfirmed',
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
    picksView: r.picksView || (() => getPicksView('gameday')),     // D1 Lane B / DI-611: the member's Show picks choice for Game Day (default By team)
    // D1 DI-528 — the sports the feed spans (null in a one-sport league: Home is then exactly v0.29.0's) and the ENTRANTS of a week's sport (C4), never the active roster.
    contexts: r.contexts || (() => homeFeedContexts()),
    rosterForWeek: r.rosterForWeek || playersForWeek,
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
    joinOffers: typeof d.joinOffers === 'function' ? d.joinOffers : () => [],       // DESIGN_D1_E (DI-E1.1): () -> [{ dbCode, code, joinable }], the sports the viewer has NOT joined that the league offers (the overview's own "Also in this league" cards). Absent = nothing offered (fail closed)
    // D1 Lane B (2026-10-07) — optional, every one of them: absent means "today's behaviour".
    setTimer: typeof d.setTimer === 'function' ? d.setTimer : null,                                // (fn, ms) -> handle, injected by the app: the pill's VoiceOver announcement debounce. Absent = no announcement (the renderer itself owns NO timer: nothing animates in JS)
    clearTimer: typeof d.clearTimer === 'function' ? d.clearTimer : null,
    pilotHistoryAllowed: typeof d.pilotHistoryAllowed === 'function' ? d.pilotHistoryAllowed : null,   // () -> boolean: may THIS league see the pilot's 2025 history (the `year.ago` card and its detail)? Absent = no (fail closed; security O1)
    onRender: typeof d.onRender === 'function' ? d.onRender : null,                  // () -> void: called on every renderHome() (the app refreshes an open card detail)
    liveEntryFor: typeof d.liveEntryFor === 'function' ? d.liveEntryFor : null,      // (gameId) -> the live-status capture or null (DI-570: lets a stale score say so)
    competitions: typeof d.competitions === 'function' ? d.competitions : null,      // () -> Lane A's per-league list (X1); absent = ONE default competition, no sport words
    weekSportLabel: typeof d.weekSportLabel === 'function' ? d.weekSportLabel : null,  // (week) -> the code of the sport the week belongs to ('NFL'), read from the LEAGUE's competitions (N7, pass 3): names a game whose sport is not one of Home's. Absent = unknown
    detailContext: typeof d.detailContext === 'function' ? d.detailContext : null,   // () -> { threadCount, scoreSummaryRowsHTML, capabilities, sportLabel } for the card detail (DI-575/576)
    threadInfo: typeof d.threadInfo === 'function' ? d.threadInfo : null,                // (gameId) -> { enabled, count, preview:[{who,text,when}] }: the Game view's thread card (the app owns chat)
    logoUrlFor: typeof d.logoUrlFor === 'function' ? d.logoUrlFor : null,                // (game, 'away'|'home') -> a vetted https logo URL or null (Team logos on AND logoOk): the Game view's lockups
    entrantsFor: typeof d.entrantsFor === 'function' ? d.entrantsFor : null,            // (week) -> the players IN THAT WEEK'S SPORT (Lane A's playersForCompetition(…, { weekId }), security C4); absent = NOBODY is an entrant: Home never invents a roster from the active players, so the card and the Game view draw no pick line (fail closed, C4/A3)
    observeSentinel: typeof d.observeSentinel === 'function' ? d.observeSentinel : null,   // (el, cb) -> unobserve: the windowing sentinel (DI-586); default = IntersectionObserver
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

/**
 * DI-578 (PF-444, FB-013) — what a SCRIBE post is ABOUT, resolved against this league's own weeks and games: `{ gameId, weekId, weekN, matchup }` when it names a game, `{ weekId, weekN }` when it
 * names only a week, null otherwise. Ids and public schedule text only — never a pick.
 */
export function scribePostContext(m, { weeks = [], games = [] } = {}) {
  const meta = (m && m.meta && typeof m.meta === 'object') ? m.meta : {};
  const gid = [meta.gameId, m && m.gameTag].find(isNonEmptyString);
  const g = gid ? asArray(games).find(x => x && x.gameId === gid) : null;
  const wid = g ? g.weekId : (isNonEmptyString(meta.weekId) ? meta.weekId : null);
  const w = wid ? asArray(weeks).find(x => x && x.weekId === wid) : null;
  if (g && w) return { gameId: g.gameId, weekId: w.weekId, weekN: w.weekNumber, matchup: `${g.awayTeam} at ${g.homeTeam}` };
  return w ? { weekId: w.weekId, weekN: w.weekNumber } : null;
}
/** A SCRIBE line that is part of a conversation (a reply to a message, an Ask-SCRIBE answer, a mention) belongs to Chat, whatever game it mentions. */
const isConversational = (m) => {
  const meta = (m && m.meta && typeof m.meta === 'object') ? m.meta : {};
  return isNonEmptyString(m && m.replyTo) || isNonEmptyString(meta.triggerMessageId) || meta.trigger === 'mention' || meta.scribeReply === true;
};

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
function projectCandidate(m, leagueId, supabase = true, context = null) {   // the internal default is the strict one too (every caller passes the switch)
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
    context,                                                    // DI-578: what a SCRIBE post is about (null for a chat message)
    leagueId: own === null ? leagueId : own,                    // the stamp (S-C11, W1): the row's OWN league; deriveCards drops a mismatch, assemble drops a missing one
    meta: { kind: meta.kind == null ? null : String(meta.kind), test: meta.test === true },
    serverMinted: m.relayed === false,                          // DI-610: the server-set `relayed` column, read at the TOP LEVEL of the row and `=== false` exactly (absent / null / true all fail closed): only such a post can be ABOUT a game
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
        // FB-013 / DI-578 — a purposeful post (the HOME_SCRIBE_KINDS allow-list, authoritative per PF-444) OR a game-analysis post that NAMES ITS GAME (HOME_SCRIBE_GAME_TRIGGERS, so the card can say why it
        // is on Home) and is not part of a conversation. Banter, roasts, replies, Ask-SCRIBE answers, release notes and the obligation notices stay in Chat.
        const context = scribePostContext(m, { weeks, games });
        const allowed = isHomeScribePost(m, { weeks });                   // F-2: the lifecycle notice is checked against THIS league's weeks
        const meta = (m.meta && typeof m.meta === 'object') ? m.meta : {};
        // SECURITY (D1 review, finding 1): a game-analysis post is admitted ONLY when the SERVER minted it. `meta` is member-writable (any member can mint a `scribe_` row through chat_append_system with `meta.trigger:
        // 'coverageFlip'` and a real gameTag), so the only evidence is the server-set `relayed` column (0045: `relayed = emitted_by is not null`, member-readable) — read at the TOP LEVEL of the row, never from `meta`,
        // and `=== false` exactly: absent (the column has not landed yet), null, true, "false", 0 all FAIL CLOSED. Until 0045 and a server producer exist this admits nothing; the PICKS_LOCKED lifecycle path (the
        // allow-list above) is unchanged. HOME_SCRIBE_GAME_TRIGGERS therefore matches no row today — no SCRIBE game card should be claimed on Home.
        const gameTrigger = !!(context && context.gameId && typeof meta.trigger === 'string' && HOME_SCRIBE_GAME_TRIGGERS.includes(meta.trigger) && !isConversational(m));
        if (!allowed && !(gameTrigger && m.relayed === false)) continue;
        const { named, weeks: namedWeeks, unresolved } = scribePostWeek(m, { weeks, games });
        if (named && (unresolved || namedWeeks.some(w => !arePicksPublic(w)))) continue; // security C2 / S1 — the blind-gated path, conjunctive
        let c = projectCandidate(m, leagueId, strictProvenance, context || (allowed ? { leagueWide: true } : null));
        // P-10 race (coordinator, 2026-10-08): a member who posts the week's lock id after the lock, before any device does, writes its BODY (first writer wins).
        // So Home never shows a lifecycle notice's own body: it shows the app's fixed copy for the VALIDATED week instead (lifecycleHomeBody). The worst such a
        // member can do on Home is the correct card at the correct time. (The chat room still shows the row as posted: that residual is M-38's.)
        if (c && allowed && meta.kind === 'lifecycle') {
          const fixed = lifecycleHomeBody(m, { weeks });
          if (fixed === null) continue;                                   // no validated week, no copy: fail closed
          c = { ...c, body: fixed };
        }
        if (c) scribe.push(c);
      } else if (author !== 'system') {
        if (dayKeyInTz(toMs(m.ts), timezone) !== today) continue;
        const c = projectCandidate(m, leagueId, strictProvenance);
        if (c) lockerRoom.push(c);
      }
    }
    scribe.sort((a, b) => (b.ts - a.ts) || a.id.localeCompare(b.id));
    // DI-578 — at most ONE card per named game (the newest) and one per week for a week-level notice; the older ones stay in Chat only.
    const seenAbout = new Set();
    const one = scribe.filter(c => {
      const k = c.context && c.context.gameId ? `g:${c.context.gameId}` : (c.context && c.context.weekId ? `w:${c.context.weekId}` : null);
      if (k === null) return true;
      if (seenAbout.has(k)) return false;
      seenAbout.add(k);
      return true;
    });
    return { scribe: one.slice(0, SCRIBE_POST_LIMIT), lockerRoom };
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
function submissionCountsFor({ weeks, games, picks, players, viewerId, read, picksConfirmed, rosterFor = null }) {
  const out = {};
  const activeAll = players.filter(p => p && p.active);
  let progress = null;
  try { const v = read.weekProgress(); progress = (v && typeof v === 'object' && v.weeks) ? v.weeks : null; } catch { progress = null; }
  const supabase = !!read.isSupabase();
  for (const w of weeks) {
    if (!w || w.status === 'draft') continue;
    const gameCount = games.filter(g => g && g.weekId === w.weekId).length;
    // D1 DI-528 / C4 — in a several-sport league "N of M in" counts the ENTRANTS of this week's own sport (a member who has not joined NFL is not "missing" from an NFL week); a one-sport league
    // passes no `rosterFor` and this is the active roster, as it always was.
    let active = activeAll;
    if (rosterFor) { try { active = asArray(rosterFor(w)).filter(p => p && p.active); } catch { active = []; } }
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

  // D1 DI-528 — the sports the feed spans, or null (a one-sport league). A reader that throws or answers anything but a list reads as null: today's behaviour, never a thrown feed.
  let contexts = null;
  try { const c = read.contexts(); contexts = Array.isArray(c) ? c : null; } catch { contexts = null; }

  // DESIGN_D1_E (DI-E1.1): the join offers - cleaned to { dbCode, code, joinable } and nothing else, and none without a viewer. A reader that throws offers nothing.
  let joinOffers = [];
  if (typeof d.joinOffers === 'function') { try { joinOffers = viewerId ? cleanJoinOffers(d.joinOffers()) : []; } catch { joinOffers = []; } }

  let currentWeekId = null;
  try { const cw = read.currentWeek(); currentWeekId = cw ? cw.weekId : null; } catch { currentWeekId = null; }
  let activeWeekId = null;
  try { activeWeekId = read.activeWeekId() || null; } catch { activeWeekId = null; }

  // D1 Lane B: X1 (Lane A's competitions, or the single default) and DI-570 (the live-status provider). The viewer's game order (DI-579) is NOT read here: Game Day is kickoff-ordered (REV 2) and the sort is the Dashboard's alone.
  let competitionList = null;
  if (typeof d.competitions === 'function') { try { competitionList = d.competitions(); } catch { competitionList = null; } }
  else competitionList = competitionsFromContexts(contexts, viewerId);   // the Lane A seam: the feed's own contexts ARE the competitions (null in a one-sport league: ONE default, no sport words)
  return {
    leagueId, viewerId, now, timezone, players, weeks, games, picks, weeklyResults,
    competitions: normalizeCompetitions(competitionList, currentWeekId), liveEntryFor: d.liveEntryFor || null,
    revealedWeeks: view.revealedWeeks, revealedGames: view.revealedGames, revealedPicks: view.revealedPicks, revealedWeeklyResults: view.revealedWeeklyResults,
    tieContexts,
    confirmedStatusFor, picksReadConfirmed,
    // the week's entrants: Lane A's playersForWeek in a several-sport league; in a one-sport league every active player of THIS snapshot (the same answer playersForWeek gives there, read from the same readers)
    submissionCounts: submissionCountsFor({ weeks, games, picks, players, viewerId, read, picksConfirmed: picksReadConfirmed, rosterFor: contexts ? read.rosterForWeek : null }),
    contexts, joinOffers,
    chatCandidates: chat, currentWeekId, activeWeekId, todayKey: dayKeyInTz(now, timezone),
    isCommissioner: isCommissioner === true,
  };
}

// ═══ the Now card (DI-364): the state machine, as plain data ═════════════════════════════════════════════════════

function nowModel(fields) {
  const m = {
    state: '', weekId: null, weekN: '', eyebrow: '', headline: '', sub: '', lines: [], own: '', trend: null,
    primary: null, secondary: null, ...fields,
  };
  // D1 Part 2 item 6 (2026-10-08): in a several-sport league the Now card is about ONE sport's week, and its go-tab buttons say which, so "Make your picks" opens THAT sport's Picks even while the member's
  // pointer is on another sport. A one-sport league has no sport on the model at all (the model, the markup and the tap are the unmodified ones).
  if (isNonEmptyString(m.sport)) {
    for (const k of ['primary', 'secondary']) {
      if (m[k] && m[k].action === 'go-tab' && SPORT_ACTION_TABS.includes(m[k].tab)) m[k] = { ...m[k], sport: m.sport };
    }
  } else delete m.sport;
  return m;
}

/** FB-012 — one live game, one concise line: the scoreboard, then the viewer's OWN side on it (S-C3: their pick only, never anyone else's). */
function liveGameLine({ g, team, cover }) {
  const score = scoreLine(g);
  if (!team) return score;
  if (!cover) return `${score} — you have ${team}.`;
  if (cover.state === 'even') return `${score} — you have ${team}, right on the number.`;
  return `${score} — you have ${team}, ${cover.state === 'covering' ? 'covering' : 'trailing'}${cover.margin ? ` by ${cover.margin}` : ''}.`;
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
  // The sport this card is about, from the feed contexts (the same list the per-sport slices come from): present only in a several-sport league.
  const curContext = asArray(s.contexts).find(c => c && isNonEmptyString(c.dbCode) && asArray(c.weekIds).includes(cur.weekId));
  const base = { weekId: cur.weekId, weekN, ...(curContext ? { sport: curContext.dbCode } : {}) };
  const facts = nowSportFacts(s, cur, viewer);                   // DESIGN_D1_E: is the viewer IN this week's sport? (first-person lines are for a player)

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
    // Only status 'live' is live: a final, postponed or scheduled game is never described as live (FB-012 acceptance 3). Kickoff order throughout.
    const live = games.filter(g => g.status === 'live').sort(kickoffOrder);
    // FB-022 — "See the full slate" is the View All route, and it carries THIS card's week so the Dashboard opens on the same period
    // (state.viewingWeekId is shared with Picks and may hold another week; app.js onHomeAction applies it).
    const model = { ...base, state: 'live', eyebrow: `Week ${weekN} · Live`, headline: `Week ${weekN} is live.`, sub: '', own: '', trend: null,
      primary: { label: 'See the full slate', action: 'go-tab', tab: 'dashboard', weekId: cur.weekId }, secondary: null };
    if (live.length) {
      const reads = live.map(g => { const team = ownPickTeam(picks, g.gameId, viewer); return { g, team, cover: liveCover(g, team) }; });   // S-C3 — own pick only, explicit viewer
      if (live.length === 1) {
        const { g: featured, team, cover } = reads[0];
        model.headline = scoreLine(featured);
        if (team) {
          if (!cover) model.own = `You have ${team}.`;
          else if (cover.state === 'even') { model.own = `You have ${team} and it's right on the number.`; }
          else {
            model.own = `You have ${team} and you're ${cover.state === 'covering' ? 'covering' : 'trailing'}${cover.margin ? ` by ${cover.margin}` : ''}.`;
            model.trend = cover.state === 'covering' ? 'up' : 'down';
          }
        }
      } else {
        // FB-012 (D1 batch H; Drew: "describing only one of the live game, needs to describe all") — the headline counts EVERY live game, one
        // concise line per game follows, and the viewer's line sums up all of their live picks (it used to describe live[0] alone).
        model.headline = `${live.length} games are live.`;
        model.lines = reads.map(liveGameLine);
        const judged = reads.filter(x => x.team && x.cover);
        if (judged.length) {
          const up = judged.filter(x => x.cover.state === 'covering').length, down = judged.filter(x => x.cover.state === 'trailing').length;
          model.own = `You're covering ${up} of ${judged.length}.`;
          model.trend = up > down ? 'up' : down > up ? 'down' : null;
        }
      }
      // D1 Lane B (2026-10-08): the Live Peek's compact Dashboard block (model.compact / peekNote / LIVE_PEEK_MAX = 3) is RETIRED — Game Day's pills and open card (js/gameday.js) draw every live game. Drew, D-58/D-63.
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
  // D1 / DI-510 row 7 — "has the lock instant passed on a week still stored open" is the ONE week-lock state's `derived` (a demo week is exempt, as on the server). The confirmed status
  // is what this card already trusts for `st`, so it is what the helper judges.
  const lockState = weekLockState({ week: cur, games, now, confirmedStatus: st });
  const lockPassed = lockState.derived;

  // ── Locked (far / near / passed) ──
  if (st === 'locked' || (st === 'open' && lockPassed && games.length)) {
    const eyebrow = `Week ${weekN} · Locked`;
    const msToKick = firstMs === null ? null : firstMs - now;
    if (msToKick !== null && msToKick > 0 && msToKick <= NOW_NEAR_KICKOFF_MS) {
      const first = games.slice().sort(kickoffOrder)[0];
      const mins = Math.max(1, Math.ceil(msToKick / 60000));
      if (viewer) {
        const team = ownPickTeam(picks, first.gameId, viewer);   // S-C3
        const sub = !facts.entered ? '' : (team ? `You have ${team}.` : "You didn't pick this game.");   // a viewer who is not in this sport did not "not pick" anything: no line (DESIGN_D1_E)
        return nowModel({ ...base, state: 'locked-near', eyebrow, headline: `${first.awayTeam} at ${first.homeTeam} kicks off in ${mins} min.`, sub });
      }
      return nowModel({ ...base, state: 'locked-near', eyebrow, headline: `Kickoff in ${mins} min.` });   // no viewer: generic, no team name
    }
    const slate = { label: 'View the slate', action: 'go-tab', tab: 'picks' };
    if (msToKick === null) return nowModel({ ...base, state: 'locked-far', eyebrow, headline: `Week ${weekN} is locked.`, sub: facts.entered ? 'Picks are in. Reveal comes at kickoff.' : 'Reveal comes at kickoff.', secondary: slate });
    if (msToKick <= 0) return nowModel({ ...base, state: 'locked-far', eyebrow, headline: `Week ${weekN} is locked.`, sub: 'Reveal comes as the week goes live.', secondary: slate });
    return nowModel({ ...base, state: 'locked-far', eyebrow, headline: `Week ${weekN} is locked.`, sub: `Reveal — and kickoff — in ${formatCountdown(msToKick)}.`, secondary: slate });
  }

  // ── Open ──
  if (st === 'open' && games.length) {
    const eyebrow = `Week ${weekN} · Open`;
    const locks = lockMs !== null ? formatCountdown(lockMs - now) : '';
    const counts = s.submissionCounts && s.submissionCounts[cur.weekId];
    const inLine = counts && Number.isFinite(Number(counts.submittedCount)) && Number.isFinite(Number(counts.totalPlayers)) ? `${numStr(counts.submittedCount)}/${numStr(counts.totalPlayers)} in` : '';
    // D1 / DI-511 — a week the commissioner RE-OPENED says so (a visible exception, never a silent one): "Picks were re-opened · locks in 2h 10m".
    const lockLine = locks ? (lockState.reopened ? `Picks were re-opened · locks in ${locks}` : `Locks in ${locks}`) : '';
    if (!viewer) {
      return nowModel({ ...base, state: 'open-pending', eyebrow, headline: `Week ${weekN} is open.`, sub: [lockLine, inLine].filter(Boolean).join(' · '), primary: { label: 'Make your picks', action: 'go-tab', tab: 'picks' } });
    }
    if (!facts.entered) {                                              // DESIGN_D1_E (W-85): not in this sport - no "picks left", no "Make your picks"; the app's join offer, when there is one, is the button
      const join = facts.offer && facts.offer.joinable === true ? { label: JOIN_NUDGE_COPY.button(facts.offer.code), action: 'go-tab', tab: 'picks' } : null;
      return nowModel({ ...base, state: 'open-pending', eyebrow, headline: `Week ${weekN} is open.`, sub: [lockLine, inLine].filter(Boolean).join(' · '), primary: join });
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

// ═══ D1 Lane C (DI-660 / DI-663 / DI-668, 2026-10-08) — storylines and server content ride the news leg, under their OWN eligibility ═══════════
// The news adapter (js/newsFeed.js) returns, beside ordinary headlines, items that carry a `cardKind`: 'storyline' (a publisher's headline with a deterministic
// game / team tag, DI-663), the server content kinds 'matchup.preview' / 'player.preview' / 'spotlight' (DI-660), and one 'content-error' note (DI-660's
// "Some cards couldn't load."). They are NOT news-slot items: the 48-hour window and the one-per-four density rule do not apply to them. Each keeps its own
// window (a storyline 7 days; content until its `eligibleUntil`), the caps below, and the SAME chronology as every other card (FB-010: time alone places).
// They render through the adapter's renderNewsCard (one sink per kind, escaped there), exactly like news.
export const STORYLINE_FEED_MAX = 8;
export const CONTENT_FEED_MAX = 40;
export const STORYLINE_FEED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_KINDS = Object.freeze(['matchup.preview', 'player.preview', 'spotlight']);
export function eligibleContent(items, now) {
  const seen = new Set();
  const story = [], content = [], notes = [];
  for (const it of asArray(items)) {
    if (!it || typeof it !== 'object' || !isNonEmptyString(String(it.id ?? '')) || seen.has(String(it.id))) continue;
    seen.add(String(it.id));
    if (it.cardKind === 'content-error') { if (!notes.length) notes.push(it); continue; }
    const ms = Date.parse(it.publishedAt);
    if (!Number.isFinite(ms) || ms > now + NEWS_FUTURE_SKEW_MS) continue;
    if (it.cardKind === 'storyline') { if (now - ms <= STORYLINE_FEED_WINDOW_MS && story.length < STORYLINE_FEED_MAX) story.push(it); continue; }
    if (CONTENT_KINDS.includes(it.cardKind)) {
      const until = Date.parse(it.eligibleUntil);
      if (Number.isFinite(until) && until > now && content.length < CONTENT_FEED_MAX) content.push(it);
    }
  }
  return { cards: [...story, ...content], notes };
}

/**
 * How many news cards the feed carries: UX-2's density rule (News needs doc, Open Decision #8), kept as a SELECTION rule since FB-010 —
 * one per four ordinary cards, the midweek exception (fewer than four: news fills up to the cap), and the cap of eight.
 */
export function newsSlotCount(ordinaryCount) {
  const n = Math.max(0, Number(ordinaryCount) || 0);
  return n < NEWS_PER_NON_NEWS ? NEWS_MAX_CARDS : Math.min(NEWS_MAX_CARDS, Math.floor(n / NEWS_PER_NON_NEWS));
}

/** An entry's place in the one chronology: an ISO-8601 instant (card.sortKey is always isoAt() output; a news publishedAt is normalised the same way), so a plain string comparison is a time comparison. */
function newsTime(it) { const ms = Date.parse(it.publishedAt); return Number.isFinite(ms) ? new Date(ms).toISOString() : ''; }
const newestFirst = (a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0) || (a.tie - b.tie) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The ordered feed, as DESCRIPTORS (rendering is separate, so the order is provable without markup):
 *   1. the Now card, pinned first, unconditionally;   2. the commissioner nudge, pinned second, when present — both kept apart from the feed;
 *   3. the ORDINARY feed — every card and every news item — in ONE newest-first chronology by its own event time (FB-010, D1 batch H, Drew:
 *      "Feed should always be new cards on top, so if a game ends and you provide an update that should be on top"). It is never grouped by
 *      week (that lifted a newer week's old cards, and every week-less SCRIBE post, above a game that had just ended), and news is never slotted
 *      by POSITION (one after every fourth card was the "interjected like 5 cards down"). A tie in time breaks card-before-news, then by key;
 *   4. news: <=1 per 4 ordinary cards (filling when thin, cap 8, 48 h) is how MANY (newsSlotCount), chosen in UX-2's relevance order — relevance
 *      selects, the publish time places; renders any time, not gated on this week's slate (UX-2 N2);
 *   5. the news slot's calm states (loading skeletons, error, empty) have no time: they follow the ordinary feed;   6. the end marker, last.
 * The newest FEED_CARD_CAP cards are kept (DI-586; when more exist the end marker says so), a second occurrence of any key is dropped, and every card / news entry keeps its event time as `t`
 * (DI-587 reads it). Deterministic: the same inputs give the same array in the same order, whatever order `cards` arrives in.
 * `weeks` is accepted for the callers' sake and no longer read (the order is time, not week).
 */
export function mergeFeed({ now = Date.now(), cards = [], nudge = null, news = null, feedError = false, emptyLeague = false } = {}) {
  const out = [{ kind: 'now', key: 'now' }];
  if (nudge) out.push({ kind: 'nudge', key: nudge.key, nudge });

  // A failed derivation is ONE calm error entry where the cards would be (DI-366), first in the ordinary feed; there are no cards to order then.
  const errorEntry = feedError ? [{ kind: 'error', key: 'home-error' }] : [];
  const seenKeys = new Set();
  const allCards = feedError ? [] : asArray(cards).filter(c => { if (!c || seenKeys.has(c.id)) return false; seenKeys.add(c.id); return true; });   // ids are unique by construction; this is the guard the test asserts
  const timed = allCards.map(c => ({ kind: 'card', key: c.id, card: c, t: String(c.sortKey ?? ''), tie: 0 })).sort(newestFirst).slice(0, FEED_CARD_CAP);
  const capped = allCards.length > FEED_CARD_CAP;

  const notes = [];
  const status = news && typeof news === 'object' ? news.status : 'off';
  if (status === 'ready' || status === 'empty') {
    const newsFailed = asArray(news.items).some(it => it && it.cardKind === 'news-error');    // D1 Lane C (review B3): the headlines failed, the content cards stood
    const all = asArray(news.items).filter(it => !(it && it.cardKind === 'news-error'));
    const special = eligibleContent(all.filter(it => it && it.cardKind), now);                   // D1 Lane C: storylines and content, their own windows (see eligibleContent)
    const items = eligibleNews(all.filter(it => !(it && it.cardKind)), now).slice(0, newsSlotCount(errorEntry.length + timed.length));
    if (items.length) items.forEach(it => timed.push({ kind: 'news', key: `news:${String(it.id)}`, item: it, t: newsTime(it), tie: 1 }));
    special.cards.forEach(it => timed.push({ kind: 'news', key: `news:${String(it.id)}`, item: it, tie: 1, t: newsTime(it) }));   // placed by its own event time, like every card (FB-010)
    special.notes.forEach(it => notes.push({ kind: 'news', key: `news:${String(it.id)}`, item: it }));
    if (newsFailed) notes.push({ kind: 'news-error', key: 'news-error' });                       // D1 Lane C (review B3, DI-660): the calm news note with Retry, BESIDE the content cards
    else if (!items.length && !special.cards.length) notes.push({ kind: 'news-empty', key: 'news-empty' });
  } else if (status === 'loading') {
    for (let i = 0; i < NEWS_SKELETON_COUNT; i++) notes.push({ kind: 'news-skeleton', key: `news-skel:${i}` });
  } else if (status === 'error') {
    notes.push({ kind: 'news-error', key: 'news-error' });
  }                                                              // 'off' / 'idle' / anything else: the slot does not exist
  timed.sort(newestFirst);
  out.push(...errorEntry, ...timed.map(({ tie, ...entry }) => entry), ...notes);
  if (!feedError) out.push({ kind: 'caught-up', key: 'caught-up', variant: emptyLeague ? 'new-league' : capped ? 'capped' : 'caught-up' });   // never "You're all caught up." beside an error card
  return out;
}

// ═══ markup (DI-367: one card shell; every dynamic string escaped at the sink) ═══════════════════════════════════

/** A real <button>, 44 pt tall (css), pressing to 97% like every other button. A SOLID (primary) action is a medium haptic, everything else light — the Principles' table. */
function actionButtonHTML(a, { escHtml, tone }) {
  const hapticKind = tone === 'solid' ? 'medium' : 'light';
  // FB-022: a go-tab that names a week (the live Now card's View All) carries it as data-week-id; the dispatcher re-validates it against this league's weeks.
  const tabAttrs = a.action === 'go-tab' ? ` data-tab="${escHtml(a.tab)}"${a.commTab ? ` data-comm-target="${escHtml(a.commTab)}"` : ''}${isNonEmptyString(a.weekId) ? ` data-week-id="${escHtml(a.weekId)}"` : ''}${isNonEmptyString(a.sport) && SPORT_ACTION_TABS.includes(a.tab) ? ` data-sport="${escHtml(a.sport)}"` : ''}` : '';
  return `<button type="button" class="btn feed-action feed-action--${escHtml(tone)}" data-home-action="${escHtml(a.action)}"${tabAttrs} data-haptic="${hapticKind}">${escHtml(a.label)}</button>`;
}

/** The Now card (always `.feed-card`). `compactHtml` is the injected callback's finished fragment, SPLICED — never interpolated. */
export function nowCardHTML(model, { escHtml }) {
  requireEscHtml(escHtml, 'nowCardHTML');
  const open = `<section class="card feed-card feed-now" data-now-state="${escHtml(model.state)}" aria-label="This week">`;
  const eyebrow = model.eyebrow ? `<p class="feed-now-eyebrow">${escHtml(model.eyebrow)}</p>` : '';
  const headline = `<h2 class="feed-now-headline">${escHtml(model.headline)}</h2>`;
  const trend = model.trend ? `<span class="feed-now-trend" data-trend="${escHtml(model.trend)}" aria-hidden="true">${model.trend === 'up' ? '▲' : '▽'}</span>` : '';
  const sub = model.sub ? `<p class="feed-now-sub">${escHtml(model.sub)}</p>` : '';
  const own = model.own ? `<p class="feed-now-sub feed-now-own">${trend}<span>${escHtml(model.own)}</span></p>` : '';
  // FB-012: one line per live game when more than one is live — the shipped .feed-now-sub type, in the same 8 pt text group (no new style).
  const lines = joinHtml(asArray(model.lines).filter(isNonEmptyString).map(l => `<p class="feed-now-sub">${escHtml(l)}</p>`));
  const text = `<div class="feed-now-text">${eyebrow}${headline}${sub}${lines}${own}</div>`;
  const buttons = [
    model.primary ? actionButtonHTML(model.primary, { escHtml, tone: 'solid' }) : '',
    model.secondary ? actionButtonHTML(model.secondary, { escHtml, tone: 'outline' }) : '',
  ].filter(Boolean);
  const actions = buttons.length ? joinHtml(['<div class="feed-actions">', joinHtml(buttons), '</div>']) : '';
  return joinHtml([open, text, actions, '</section>']);
}

/**
 * The Now card for a snapshot: the state machine's model, and the markup. D1 Lane B (2026-10-08, DI-603/608): every state except Draft, Between seasons and an empty league is drawn as GAME DAY — the
 * compact red card (js/gameday.js) — instead of the Now card's own layout; those three keep today's card. `gameDay` carries the session's open / closed state, the Show picks choice and the rosters:
 * { expanded, view, entrantsFor, railHidden }. Returns { model, html, gameDay } — `gameDay` is { expandable, ids, kind, scopes } for the dispatcher's validation, or null for a non-Game-Day state.
 */
export function renderNowCard(snapshot, { viewerId = null, isCommissioner = false, now = Date.now(), escHtml, gameDay = {} } = {}) {
  requireEscHtml(escHtml, 'renderNowCard');
  const model = nowCardModel(snapshot, { viewerId, isCommissioner, now });
  if (!GAME_DAY_STATES.includes(model.state)) return { model, html: nowCardHTML(model, { escHtml }), gameDay: null };
  const g = gameDay && typeof gameDay === 'object' ? gameDay : {};
  const input = gameDayInputFor(snapshot, model, { viewerId, isCommissioner, now });
  const gd = gameDayModel(input);
  const expanded = g.expanded === true && gd.expandable;
  const weeksById = new Map(asArray(snapshot.weeks).map(w => [w && w.weekId, w]));
  const gamesById = new Map(input.entries.map(e => [e.game.gameId, e.game]));
  // C4 / A3 (fail closed): WHO IS IN a game's sport for its week is the caller's answer (js/app.js hands in entrantsForWeek, Lane A's playersForCompetition(…, { weekId }) once it lands). With none injected nobody is an
  // entrant, so the gate says nothing: Home never invents a roster from the ACTIVE players.
  const entrantsFor = typeof g.entrantsFor === 'function' ? g.entrantsFor : () => [];
  let bodyHTML = '';
  if (expanded) {
    try {
      bodyHTML = gameDayBodyHTML(gd, {
        escHtml, numHtml: numStr, viewerId: input.viewerId, view: g.view === 'person' ? 'person' : 'team', railHidden: g.railHidden === true, rowChevHtml: glyphSpan('gd-row-chev-i', 'chevronRight'),
        logoFor: typeof g.logoUrlFor === 'function' ? (row, side) => { const game = gamesById.get(row.gameId); return game ? safeLogo(g.logoUrlFor, game, side) : null; } : null,   // DI-605 line 1: Team logos on AND logoOk (the app's own gate)
        resolve: (row) => { const game = gamesById.get(row.gameId), week = game ? weeksById.get(game.weekId) : null; return game && week ? { game, week, entrants: entrantsFor(week) } : null; },   // by id, from THIS snapshot — never from the DOM
      });
    } catch (e) { console.error('[home] Game Day body failed', e); bodyHTML = gameDayBodyErrorHTML(gd, { escHtml, numHtml: numStr }); }
  }
  const html = gameDayCardHTML(gd, { escHtml, numHtml: numStr, expanded, bodyHTML, railHidden: g.railHidden === true, chevHtml: glyphSpan('gd-chev-i', 'chevronLeft') });
  const scopes = new Set(asArray(snapshot.competitions).map(c => c.sport));
  return { model, html, gameDay: { expandable: gd.expandable, ids: new Set(gd.rows.map(r => r.gameId)), pillIds: new Set(gd.pills.map(p => p.gameId)), kind: gd.kind, scopes, footerScope: gd.footer.scope, model: gd } };
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

/**
 * DESIGN_D1_E (DI-E1.3): the join nudge - "Want in?" under the newest tease card of a sport the viewer has not joined. The feed's own card shell and the commissioner nudge's structure (an 8 pt text group, a 16 pt
 * gap, a centred button group), neutral (not gold, not a due pill: a sport he has not joined owes nothing). Variant A (`offer.joinable`): one button, the existing go-tab with the sport, which opens the league
 * overview at that sport's Join - nothing is joined by this tap. Variant B (the sport's week is closed): the same words and NO button - plain text, not tappable. Every string crosses the injected escaper.
 */
export function joinNudgeHTML(offer, { escHtml } = {}) {
  requireEscHtml(escHtml, 'joinNudgeHTML');
  const o = offer && typeof offer === 'object' ? offer : {};
  const chip = joinHtml(['<div class="feed-card-eyebrow">', `<span class="sport-chip">${escHtml(o.code)}</span>`, '</div>']);
  const title = `<h3 class="feed-card-title">${escHtml(JOIN_NUDGE_COPY.title)}</h3>`;
  const showButton = o.joinable === true;
  const body = `<p class="feed-card-body">${escHtml(showButton ? JOIN_NUDGE_COPY.open(o.code) : JOIN_NUDGE_COPY.closed(o.code))}</p>`;
  const text = joinHtml(['<div class="feed-card-text">', chip, title, body, '</div>']);   // an 8 pt group; the card's own 16 pt gap separates it from the button
  const action = showButton ? joinHtml(['<div class="feed-actions">', actionButtonHTML({ action: 'go-tab', tab: 'picks', sport: o.dbCode, label: JOIN_NUDGE_COPY.button(o.code) }, { escHtml, tone: 'neutral' }), '</div>']) : '';
  return joinHtml(['<article class="card feed-card feed-join" data-card-type="join-nudge">', text, action, '</article>']);
}

/** W-92: the viewer's date formatter for a time-zone key (data-model TIME_ZONES), built once per key. */
const DATE_FORMATTERS = new Map();
export function dateFormatterFor(tzKey) {
  const z = TIME_ZONES.find(x => x.key === tzKey) || null;
  const key = z ? z.iana : '';
  if (!DATE_FORMATTERS.has(key)) DATE_FORMATTERS.set(key, makeDateFormatter(z ? z.iana : null));
  return DATE_FORMATTERS.get(key);
}
/** A label sentence: whitespace folded, a full stop added when it does not already end in one ("final.." was the old label). */
const asSentence = (x) => { const v = String(x ?? '').replace(/\s+/g, ' ').trim(); return !v ? '' : /[.!?…"”’)]$/.test(v) ? v : `${v}.`; };

/**
 * One stats / SCRIBE / Locker Room card. Returns '' for a card with nothing to say (never an empty shell).
 * W-92: `now` and `formatDate` (the viewer's zone) date the card — DI-W92-8: ONE <time> on the eyebrow's trailing edge from the card's own
 * event time (`sortKey`, the time the feed sorts by), and the tappable card's VoiceOver label "{headline}. {supporting line}. {spoken time}.
 * Opens details."; DI-W92-5: at most ONE supporting line, and a SCRIBE caption only where it adds a fact (CAPTION_TYPES_THAT_ADD_A_FACT).
 */
export function cardHTML(card, { escHtml, formatKickoff, now = Date.now(), formatDate } = {}) {
  requireEscHtml(escHtml, 'cardHTML');
  let copy;
  try { copy = cardCopy(card, { escHtml: plainText, formatKickoff, sportCode: typeof card.sportCode === 'string' ? card.sportCode : '' }); } catch (e) { console.error('[home] cardCopy failed', e); return ''; }
  if (!copy || (!copy.title && !copy.body)) return '';
  let captionHtml = '';
  try { captionHtml = captionFor(card, { escHtml }); } catch { captionHtml = ''; }      // a caption failure never costs the card
  // D1 DI-528 — in a several-sport league each card NAMES its sport: a small chip ('CFB' / 'NFL') in the eyebrow, and the sport on the article for the tap handler. A card with no sport (a chat
  // card, or any card in a one-sport league) has neither.
  const hasSport = typeof card.sportCode === 'string' && card.sportCode !== '' && typeof card.sport === 'string' && card.sport !== '';
  const sportAttrs = hasSport ? ` data-sport="${escHtml(card.sport)}" data-competition-id="${escHtml(card.competitionId || '')}"` : '';
  // DI-575 — a card that has a detail provider is ONE tap target (a pushed screen with the evidence behind it); one that has none renders exactly as before and is not tappable (never a dead end).
  // The action is allow-listed (`open-card`); the id in the markup is only a request — the dispatcher resolves it against the cards derived for the current paint (Std-9).
  const tap = hasDetail(card.type);
  // W-92 (DI-W92-5): a card shows ONE supporting line at most. A SCRIBE caption is shown only for the types whose caption ADDS a fact (the week-final
  // card: the loser and both records), and there it takes the plain body's place; every other caption reworded its own headline (the filler Drew named).
  // The two types whose body IS the content (a SCRIBE post, the Locker Room's quoted message) always keep it.
  const keepsBody = BODY_IS_CONTENT.includes(card.type);
  const showCaption = !!captionHtml && CAPTION_TYPES_THAT_ADD_A_FACT.includes(card.type) && !keepsBody;
  const showBody = !!copy.body && (keepsBody || !showCaption);
  // W-92 (DI-W92-8): when it happened — the EVENT (sortKey), never the app open. Unknown beats wrong: no known instant, no time (the card stays).
  // The picks tally is a living count dated to when the week opened, so it is the one prefixed card ("Opened 3d ago").
  const opened = card.type === 'picks.submitted';
  const timeParts = timeLabels(card.sortKey, now, { formatDate, opened });
  const timeHtml = timeParts ? `<time class="feed-card-time" datetime="${escHtml(timeParts.iso)}" data-feed-time="${escHtml(timeParts.iso)}"${opened ? ' data-feed-time-prefix="opened"' : ''} aria-label="${escHtml(timeParts.spoken)}">${escHtml(timeParts.written)}</time>` : '';
  // VoiceOver (DI-W92-8): role="button" hides the card's children, so the label carries the headline, the supporting line (no longer dropped) and the
  // time. The headline-and-line part is trimmed to CARD_LABEL_MAX first, so the time is never cut; `data-feed-label` keeps that part so the in-place
  // time refresh (DI-W92-10) can rebuild the label without a repaint.
  const head = copy.title || copy.body;
  const support = !copy.title ? '' : showCaption ? captionFor(card, { escHtml: plainText }) : showBody ? copy.body : '';
  const prefix = truncateLabel([asSentence(head), asSentence(support)].filter(Boolean).join(' '), CARD_LABEL_MAX);
  const open = tap
    ? `<article class="card feed-card feed-card--tap" role="button" tabindex="0" data-card-type="${escHtml(card.type)}"${sportAttrs} data-home-action="open-card" data-card-id="${escHtml(card.id)}" data-haptic="light" data-feed-label="${escHtml(prefix)}" aria-label="${escHtml(tapLabel(prefix, timeParts ? timeParts.spoken : ''))}">`
    : `<article class="card feed-card" data-card-type="${escHtml(card.type)}"${sportAttrs}>`;
  const reason = card.reason ? `<span class="feed-card-reason">${escHtml(card.reason)}</span>` : '';
  const sportChip = hasSport ? `<span class="sport-chip">${escHtml(card.sportCode)}</span>` : '';
  // The eyebrow: [icon][reason][sport chip][time][chevron]. The trailing three are ONE group pushed to the trailing edge, so at the largest text size
  // they drop to their own line together, right-aligned, and the chip and the time never split the row's free space between them.
  const trailParts = [sportChip, timeHtml, tap ? glyphSpan('feed-card-chev', 'chevronRight') : ''].filter(Boolean);
  const trail = trailParts.length ? joinHtml(['<span class="feed-card-trail">', ...trailParts, '</span>']) : '';
  const eyebrow = joinHtml(['<div class="feed-card-eyebrow">', glyphSpan('feed-card-icon', CARD_ICON[card.type] || 'calendarWeek'), reason, trail, '</div>']);
  const title = copy.title ? `<h3 class="feed-card-title">${escHtml(copy.title)}</h3>` : '';
  const body = showBody ? `<p class="feed-card-body${card.type === 'scribe.post' ? ' feed-card-body--scribe' : ''}">${escHtml(copy.body)}</p>` : '';
  const chips = asArray(copy.chips).length ? joinHtml(['<div class="feed-card-chips">', joinHtml(asArray(copy.chips).map(c => chipHTML(c, { escHtml }))), '</div>']) : '';
  const caption = showCaption ? `<p class="feed-card-caption">${captionHtml}</p>` : '';
  return joinHtml([open, eyebrow, title, body, chips, caption, '</article>']);
}

/** A spoken label stays short: a SCRIBE post can be a paragraph. */
function truncateLabel(text, max = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : flat;
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

/** DI-587 — the two hairline labels around the cards that are newer than the reader's last visit. Chat's own NEW-divider vocabulary; a separator for VoiceOver, never colour alone. */
function dividerHTML(variant, { escHtml }) {
  return variant === 'new'
    ? `<div class="feed-divider feed-divider--new" role="separator" aria-label="${escHtml('New since your last visit')}"><span>NEW</span></div>`
    : `<div class="feed-divider feed-divider--earlier" role="separator" aria-label="${escHtml('Earlier')}"><span>EARLIER</span></div>`;
}

/**
 * W-92 (DI-W92-10): a card's markup with its TIME taken out — the written label, the spoken label and the card's own label (which carries the
 * spoken time). Two markups equal under this differ only in how long ago something happened, which never needs a repaint: the labels are
 * rewritten in place instead (refreshTimes). The ISO instant stays in, so a card whose EVENT time changed is still a real change.
 */
export function timeInvariant(html) {
  return String(html ?? '')
    .replace(/<(time|span)\b([^>]*\bdata-feed-time="[^"]*"[^>]*)>[^<]*<\/\1>/g, (_m, tag, attrs) => `<${tag}${attrs.replace(/\saria-label="[^"]*"/, '')}></${tag}>`)
    .replace(/(\sdata-feed-label="[^"]*")\saria-label="[^"]*"/g, '$1');
}

/**
 * W-92 (DI-W92-10): rewrite every time label under `root` for `now`, IN PLACE — only the text and aria-label of a `[data-feed-time]` element
 * (the cards' <time>, the news card's time) and the label of a tappable card that carries `data-feed-label`. No node is created or removed,
 * nothing reflows but the label, nothing is announced (no live region). Returns how many nodes changed.
 */
export function refreshTimes(root, now, { formatDate } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let n = 0;
  const labelsOf = (el) => timeLabels(el.getAttribute('data-feed-time'), now, { formatDate, opened: el.getAttribute('data-feed-time-prefix') === 'opened' });
  let times = [];
  try { times = Array.from(root.querySelectorAll('[data-feed-time]') || []); } catch { times = []; }
  for (const el of times) {
    const t = labelsOf(el);
    if (!t) continue;
    if (el.textContent !== t.written) { el.textContent = t.written; n++; }
    if (el.hasAttribute('aria-label') && el.getAttribute('aria-label') !== t.spoken) { el.setAttribute('aria-label', t.spoken); n++; }
  }
  let cards = [];
  try { cards = Array.from(root.querySelectorAll('[data-feed-label]') || []); } catch { cards = []; }
  for (const card of cards) {
    const el = typeof card.querySelector === 'function' ? card.querySelector('[data-feed-time]') : null;
    const t = el ? labelsOf(el) : null;
    const want = tapLabel(card.getAttribute('data-feed-label'), t ? t.spoken : '');
    if (card.getAttribute('aria-label') !== want) { card.setAttribute('aria-label', want); n++; }
  }
  return n;
}

/** DI-586 — the windowing sentinel: an invisible 1 pt row an IntersectionObserver watches; reaching it (600 pt early) appends the next page. */
const SENTINEL_HTML = '<div class="feed-sentinel" data-feed-sentinel aria-hidden="true"></div>';

/** DI-574 — "1 new post" / "N new posts" / "99+ new posts". */
export function pillLabel(count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  return n > PILL_COUNT_MAX ? `${PILL_COUNT_MAX}+ new posts` : `${n} new ${n === 1 ? 'post' : 'posts'}`;
}
/** The pill is a sticky zero-height slot (it never pushes the feed) holding one 44 pt button; the chevron is chevronLeft turned 90 degrees clockwise by CSS so it points up (no new glyph). */
function pillHTML(count, { escHtml }) {
  const label = pillLabel(count);
  return joinHtml(['<div class="home-pill-slot"><button type="button" class="btn home-pill" data-home-action="new-posts" data-haptic="light" aria-label="', escHtml(label), '">', glyphSpan('home-pill-glyph', 'chevronLeft'), '<span class="home-pill-text">', escHtml(label), '</span></button><span class="sr-only home-pill-live" role="status" aria-live="polite" aria-atomic="true"></span></div>']);
}

function caughtUpHTML(variant) {
  if (variant === 'new-league') return '<p class="feed-caught-up">Nothing yet — this is where it starts.</p>';
  if (variant === 'capped') return '<p class="feed-caught-up">That\'s the whole season so far.</p>';     // DI-586: the window ended at the cap and more exist
  return "<p class=\"feed-caught-up\">You're all caught up.</p>";
}

/** One keyed wrapper: the key drives the entrance animation (and the reader's place, the pill, the focus return); the markup inside is the card. */
function itemHTML(it, { isNew, escHtml }) {
  return joinHtml(['<div class="feed-item', isNew ? ' feed-item--enter' : '', '" data-card-key="', escHtml(it.key), '">', it.html, '</div>']);
}

/** A keyed wrapper per entry. */
function wrapItems(items, { enter, busy, escHtml }) {
  const parts = [`<div class="home-feed" aria-busy="${busy ? 'true' : 'false'}">`];
  // The loading status for VoiceOver is a DIRECT child of the feed, outside every .feed-item: .sr-only is absolutely positioned, so it is not a flex item and the
  // column's 16 pt gap is never spent on an empty, zero-height row (which shifted the content 16 pt when the skeleton was replaced).
  if (busy) parts.push('<p class="sr-only" role="status">Loading Home</p>');
  for (const it of items) parts.push(itemHTML(it, { isNew: enter === 'all' || (enter instanceof Set && !enter.has(it.key)), escHtml }));
  parts.push('</div>');
  return joinHtml(parts);
}

/** DI-586's default sentinel watcher: an IntersectionObserver 600 pt early. An engine with none (not iOS 15) loads the next page at once, which fills the capped window in a few turns. */
function defaultObserveSentinel(target, cb) {
  if (typeof IntersectionObserver !== 'function') { queueMicrotask(cb); return null; }
  const io = new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) cb(); }, { rootMargin: SENTINEL_ROOT_MARGIN });
  io.observe(target);
  return () => io.disconnect();
}

// ═══ the reader's place (PM-110 acceptance 3, D1 batch H) ═══════════════════════════════════════════════════════
// Newest-first means a newer card lands at the TOP. A repaint replaces the feed's markup, so a card inserted above someone reading down-feed
// used to push what they were reading down the screen (an involuntary scroll jump). Before a content repaint the reader's anchor is read —
// the first card whose top edge is at or below the top of the viewport (or, when one card fills the view, the one straddling it) — and after
// it that same card is put back exactly where it was, with ONE instant scroll by the height that changed above it. Nothing is compensated at
// the very top of the page (a newer card simply appears first: chronology is correct where the reader is looking), when nothing above the
// reader moved, or when the container cannot be measured. Never smooth, never a timer, never "scroll to" anything.

function viewportWindow() { return (typeof window !== 'undefined' && window) ? window : null; }

function readerAnchor(el) {
  const win = viewportWindow();
  if (!win || !(Number(win.scrollY) > READER_TOP_PX) || !el || typeof el.querySelectorAll !== 'function') return null;     // DI-574: within the top band a newer card simply appears first — no scroll adjustment
  let items = [];
  try { items = Array.from(el.querySelectorAll('[data-card-key]') || []); } catch { return null; }
  let straddling = null;
  for (const it of items) {
    let r = null, key = null;
    try { r = it.getBoundingClientRect(); key = it.getAttribute('data-card-key'); } catch { continue; }
    if (!r || !isNonEmptyString(key) || !Number.isFinite(r.top)) continue;
    if (r.top >= 0) return { key, top: r.top };
    if (!straddling && Number(r.bottom) > 0) straddling = { key, top: r.top };
  }
  return straddling;
}

function keepReaderInPlace(el, anchor) {
  const win = viewportWindow();
  if (!anchor || !win || !el || typeof el.querySelectorAll !== 'function') return false;
  let top = null;
  try {
    const it = Array.from(el.querySelectorAll('[data-card-key]') || []).find(x => x.getAttribute('data-card-key') === anchor.key);
    top = it ? it.getBoundingClientRect().top : null;
  } catch { return false; }
  const delta = Number(top) - anchor.top;
  if (top === null || !Number.isFinite(delta) || Math.abs(delta) < 1) return false;
  // section-drag.js's scrollWindow (review note 4): the options form first — `instant` beats html{scroll-behavior:smooth} — and, on an engine that rejects
  // the `instant` enum (iOS 15.0), the numeric form, exactly as the section drag and the week swipe already scroll. Never throws; no scroll API is a no-op.
  pauseNavHide();                                                    // DI-574's amendment: this scroll is the app's, not the reader's — the tab bar must not read it as a swipe
  return scrollWindow(win, { top: delta, left: 0, behavior: 'instant' });
}

/**
 * DI-587 — the NEW / EARLIER dividers. The ordinary feed is one newest-first chronology, so "newer than your last visit" is always a leading run. A divider appears only when that run holds at
 * least one real EVENT card (a state card — picks.submitted, week.revealed, year.ago — never makes anything new) AND at least one earlier entry follows it: when everything is new (a first
 * launch, or no marker) there is nothing honest to compare against, and no divider is drawn ("no fake new"). The marker is held for the whole visit.
 */
export function withSeenDividers(visible, all, baselineMs) {
  if (baselineMs === null || baselineMs === undefined || !visible.length) return visible;
  const isNew = (e) => { const ms = e.t ? Date.parse(e.t) : NaN; return Number.isFinite(ms) && ms > baselineMs; };
  let n = 0;
  while (n < visible.length && isNew(visible[n])) n++;
  const events = visible.slice(0, n).filter(e => e.kind === 'news' || (e.kind === 'card' && !SEEN_STATE_ONLY_TYPES.includes(e.card.type)));
  if (!events.length || n >= all.length) return visible;
  return [{ kind: 'divider', key: 'seen-new', variant: 'new' }, ...visible.slice(0, n), { kind: 'divider', key: 'seen-earlier', variant: 'earlier' }, ...visible.slice(n)];
}

/**
 * D1 Lane B Game Day (DI-605, DI-610): the page moves only by what the member just asked for, and only as far as needed, through the house helper — a tapped pill's row brought above the tab bar, a collapsed
 * card's header brought back under the top of the window, "See all on Home" centring its card, and the belt that puts the page back where it was if a card change shifted it. `behavior` is 'instant' under
 * Reduce Motion (the callers ask prefersReducedMotion()). The tab bar's hide-on-scroll is paused for it: this scroll is the app's, not the reader's.
 */
function scrollPageBy(delta, behavior = 'instant') {
  const win = viewportWindow();
  if (!win || !Number.isFinite(delta) || Math.abs(delta) < 1) return false;
  pauseNavHide();
  return scrollWindow(win, { top: delta, left: 0, behavior });
}

/** DI-574 — the pill's tap: scroll to the top (smooth; instant under Reduce Motion) by scrolling UP by exactly the distance travelled, through the house helper — the same relative call as the reader's place. */
function scrollFeedToTop() {
  const win = viewportWindow();
  if (!win) return false;
  const y = Number(win.scrollY);
  if (!Number.isFinite(y) || y <= 0) return false;
  return scrollWindow(win, { top: -y, left: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
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
  // ── the reader's session (D1 Lane B): all of it in memory, none of it persisted, all of it cleared when the identity or league changes (DI-585 "session memory") ──
  let sessionIdentity = null;                                                // whose session this is; a different identity starts clean
  let pages = 1;                                                             // DI-586: how many pages of FEED_PAGE_SIZE the reader has scrolled into
  let renderedOrdinary = new Set();                                          // DI-574 / DI-586: the ordinary entries on screen (what a new arrival is measured against)
  let userRefreshing = false;                                                // DI-574: set while a pull-to-refresh / header sync repaints — new cards insert at once, the reader's place kept
  let currentCardIds = new Set();                                            // Std-9: the ids of the tappable cards derived for the CURRENT paint — the only ids open-card accepts
  let seen = { marker: null, baseline: null, visibleSince: null };           // DI-587: "last seen" — session-only until Drew rules on R-B1 (a device-local timestamp)
  let heldCount = 0;                                                         // DI-574: how many new posts the pill is holding
  let unobserveSentinel = null;
  let scrollWatch = null;
  let announceTimer = null;                                                  // DI-574: the pending polite VoiceOver announcement of the pill
  let pillAnnounced = false;                                                 // …and whether THIS pill has already been announced (once per appearance)
  // ── Game Day's session (D1 Lane B, DI-606): in memory only, never persisted, cleared with the rest of the reader's session when the identity or league changes. A reload starts collapsed; changing tab and
  // coming back, a Home repaint and a Game view pushed over Home and popped again all keep the card open (DI-585 rev 3: `{ expanded, focusedGameId }`). ──
  let gd = { expanded: false, focusedGameId: null };
  let gdCurrent = { expandable: false, ids: new Set(), pillIds: new Set(), kind: '', scopes: new Set(), footerScope: null };   // what the CURRENT paint offers: the dispatcher validates every id against it (Std-9)
  let railTouch = { down: false, downAt: 0, lastScrollAt: 0 };               // DI-604: structure changes to the pill rail are parked while it is being touched or is still scrolling
  let parkedNow = false;
  let flushTimer = null;
  let gdWatch = null;                                                        // DI-604: what the card said about each game at the last paint (the viewer's own coverage only), for the announcer
  let tickTimer = null;                                                      // W-92 (DI-W92-10): the ONE pending 60 s time refresh (null = not armed)
  let tickFormat = null;                                                     // …and the viewer's date formatter the last paint used

  const safeIdentity = () => { try { return d.currentIdentityKey(); } catch { return ''; } };
  const safeTab = () => { try { return d.getCurrentTab(); } catch { return ''; } };
  const withheld = () => { try { return d.isContentWithheld() !== false; } catch { return true; } };   // a throw or a non-false answer is "withheld"

  function viewerNow() {
    let v = null;
    try { v = d.read.viewer(); } catch { v = null; }
    const viewerId = v && isNonEmptyString(v.playerId) ? v.playerId : null;
    return { viewerId, isCommissioner: !!(v && v.isAdmin === true) };
  }

  /** Security O1: the `year.ago` card (and so its detail) names the pilot league's six members and their 2025 scores. It is derived for EVERY league by feed-cards (pure), so Home drops it unless the app's pilot-only predicate says yes. Absent / throwing / non-true = no. */
  function pilotHistory() { try { return d.pilotHistoryAllowed ? d.pilotHistoryAllowed() === true : false; } catch { return false; } }
  /**
   * The ONE place Home derives its cards (the paint, the new-posts pill and the card-detail screen all call it, so a card id the feed shows is an id the detail resolves — D1 merge note, 2026-10-08).
   * D1 DI-528: deriveFeedCards runs deriveCards once per sport in a several-sport league and exactly once, as before, in a one-sport league. Security O1's pilot-only year.ago filter then applies to
   * the merged list, so no sport's slice can route around it.
   */
  function deriveHomeCards(snapshot, o) {
    const all = deriveFeedCards(deriveCards, snapshot, o);
    return pilotHistory() ? all : all.filter(c => !c || c.type !== 'year.ago');
  }

  function resetSession() {
    stopTimeTick();                                                          // W-92: the time refresh goes with the rest of the reader's session
    pages = 1; renderedOrdinary = new Set(); userRefreshing = false; currentCardIds = new Set(); seen = { marker: null, baseline: null, visibleSince: null };
    heldCount = 0; cancelAnnounce(); pillAnnounced = false;
    gd = { expanded: false, focusedGameId: null }; gdCurrent = { expandable: false, ids: new Set(), pillIds: new Set(), kind: '', scopes: new Set(), footerScope: null }; parkedNow = false; railTouch = { down: false, downAt: 0, lastScrollAt: 0 };
    gdWatch = null; gdAnnouncer.cancel();                                    // the next reader never hears the last one's game
    if (unobserveSentinel) { try { unobserveSentinel(); } catch { /* detached */ } unobserveSentinel = null; }
    if (scrollWatch) { try { scrollWatch(); } catch { /* detached */ } scrollWatch = null; }
  }
  /** A different identity (or league) is a different reader: nothing of the previous one's windows, pills or markers survives (security: never paint a departed identity's state). */
  function syncSession() {
    const id = safeIdentity();
    if (sessionIdentity !== id) { resetSession(); sessionIdentity = id; }
  }

  const gdPicksView = () => { let v = 'team'; try { v = d.read.picksView(); } catch { v = 'team'; } return v === 'person' ? 'person' : 'team'; };
  const scrollY = () => { const w = viewportWindow(); const y = w ? Number(w.scrollY) : 0; return Number.isFinite(y) ? y : 0; };
  const orderedEntryHtml = (e, ctx) => {
    switch (e.kind) {
      case 'now': return ctx.nowEntry || '';
      case 'nudge': return nudgeHTML(e.nudge, { escHtml });
      case 'join': return joinNudgeHTML(e.offer, { escHtml });          // DESIGN_D1_E: one per sport the viewer has not joined, placed by placeJoinNudges
      case 'card': return cardHTML(e.card, { escHtml, formatKickoff: ctx.formatKickoff, now: ctx.now, formatDate: ctx.formatDate });
      case 'news': {
        let html = '';
        if (d.renderNewsCard) { try { const out = d.renderNewsCard(e.item); html = typeof out === 'string' ? out : ''; } catch { html = ''; } }
        return html;
      }
      case 'news-skeleton': return skeletonCardHTML({ withImage: true });
      case 'news-empty': case 'news-error': {
        let emptyCopy = null;
        if (e.kind === 'news-empty' && d.newsEmptyCopy) { try { const c = d.newsEmptyCopy(); emptyCopy = typeof c === 'string' && c ? c : null; } catch { emptyCopy = null; } }
        return newsNoteHTML(e.kind, { escHtml, emptyCopy });
      }
      case 'error': return errorCardHTML({ escHtml });
      case 'caught-up': return caughtUpHTML(e.variant);
      case 'divider': return dividerHTML(e.variant, { escHtml });
      case 'sentinel': return SENTINEL_HTML;
      default: return '';
    }
  };

  /** Builds every entry's markup. Never throws: a failure becomes the calm error card, never a blank feed (DI-366). */
  function buildModel(el) {
    const { viewerId, isCommissioner } = viewerNow();
    const now = d.now();
    let snapshot = null;
    try { snapshot = assembleHomeSnapshot(d, { viewerId, isCommissioner, now }); }
    catch (e) { console.error('[home] snapshot assembly failed', e); return { items: [{ key: 'home-error', html: errorCardHTML({ escHtml }) }], state: 'error', ordinaryKeys: [], heldCount: 0, hasMore: false }; }   // no end marker: "all caught up" is false after an error

    let cards = [], feedError = false;
    try {
      cards = deriveHomeCards(snapshot, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: d.isContentWithheld });   // ALWAYS handed the gate
    } catch (e) { console.error('[home] deriveCards failed', e); feedError = true; }
    currentCardIds = new Set(cards.filter(c => c && hasDetail(c.type)).map(c => c.id));

    let nowEntry = null, nowState = '';
    try {
      const r = renderNowCard(snapshot, { viewerId, isCommissioner, now, escHtml, gameDay: { expanded: gd.expanded, view: gdPicksView(), entrantsFor: d.entrantsFor || undefined, railHidden: rootTextScale() >= RAIL_HIDDEN_SCALE, logoUrlFor: d.logoUrlFor || undefined } });
      nowEntry = r.html; nowState = r.model.state;
      noteGameDay(r.gameDay ? r.gameDay.model : null);
      gdCurrent = r.gameDay ? { expandable: r.gameDay.expandable, ids: r.gameDay.ids, pillIds: r.gameDay.pillIds, kind: r.gameDay.kind, scopes: r.gameDay.scopes, footerScope: r.gameDay.footerScope } : { expandable: false, ids: new Set(), pillIds: new Set(), kind: '', scopes: new Set(), footerScope: null };
      if (!gdCurrent.expandable && gd.expanded) gd = { expanded: false, focusedGameId: null };       // the card is in a state that does not open (it was, a moment ago): it is closed, honestly
    } catch (e) { console.error('[home] Now card failed', e); feedError = true; }

    const nudge = (() => { try { return commissionerNudge(snapshot, { isCommissioner, now }); } catch { return null; } })();
    const descriptors = mergeFeed({ now, cards, nudge, news, feedError, emptyLeague: nowState === 'no-weeks' });
    const tzKey = snapshot.timezone;
    const formatKickoff = (iso) => formatGameTime(iso, tzKey);
    const formatDate = dateFormatterFor(tzKey);                              // W-92: a card's date is the VIEWER's day
    tickFormat = formatDate;

    const isOrdinary = (e) => e.kind === 'card' || e.kind === 'news' || e.kind === 'error';
    const isPinned = (e) => e.kind === 'now' || e.kind === 'nudge';
    const pinned = descriptors.filter(isPinned);
    const ordinary = descriptors.filter(isOrdinary);
    const tail = descriptors.filter(e => !isPinned(e) && !isOrdinary(e));        // the news slot's calm states and the end marker

    // ── DI-574: a reader scrolled down-feed is not shoved. New entries that would land above the first card they can see are HELD (counted by the pill); everything else (a score changing in
    // a card already on screen) still patches in place. At or near the top, or on a user refresh, nothing is held. ──
    const held = new Set();
    if (!userRefreshing && renderedOrdinary.size > 0 && scrollY() > READER_TOP_PX) {
      const anchor = readerAnchor(el);
      const at = anchor ? ordinary.findIndex(e => e.key === anchor.key) : -1;
      if (at > 0) for (const e of ordinary.slice(0, at)) if (!renderedOrdinary.has(e.key)) held.add(e.key);
    }
    const list = ordinary.filter(e => !held.has(e.key));

    // ── DI-586: render windowing. The window is a contiguous prefix of the sorted list, never shorter than the page count asks for and never shorter than what is already on screen. ──
    let lastIdx = -1;
    list.forEach((e, i) => { if (renderedOrdinary.has(e.key)) lastIdx = i; });
    const limit = Math.min(FEED_CARD_CAP, Math.max(FEED_PAGE_SIZE * pages, lastIdx + 1));
    const visible = list.slice(0, limit);
    const hasMore = list.length > visible.length;

    const shown = withSeenDividers(visible, list, seen.baseline);
    const placed = placeJoinNudges(shown, snapshot.joinOffers);          // DESIGN_D1_E: the nudge goes in AFTER the windowing and the dividers - it is never counted, held, windowed or marked NEW
    const entries = [...pinned, ...placed, ...(hasMore ? [{ kind: 'sentinel', key: 'sentinel' }] : tail)];

    const items = [];
    for (const e of entries) {
      const html = orderedEntryHtml(e, { nowEntry, formatKickoff, now, formatDate });
      if (html) items.push({ key: e.key, html });
    }
    return { items, state: nowState, ordinaryKeys: visible.map(e => e.key), heldCount: held.size, hasMore, now };
  }

  function isPainted(el) { return !!(el && (el.firstElementChild || el.firstChild)); }

  // ── Game Day: the in-place patch, the open / close, the focus and the parked rail (DI-604 / DI-605 / DI-606) ──────────────────────────────────────────────────────────────
  // A finger on the rail, or the rail still coasting. A touch that has been "down" for RAIL_DOWN_MAX_MS is treated as lost (fix round 1, B3: the parking now covers the whole feed's paint, so a touchend that never
  // arrives — its target detached, the gesture taken by the system — must not be able to freeze Home).
  const railBusy = () => (railTouch.down && d.now() - railTouch.downAt < RAIL_DOWN_MAX_MS) || (railTouch.lastScrollAt > 0 && d.now() - railTouch.lastScrollAt < RAIL_QUIET_MS);
  // DI-604 / DI-593 (Std-7): the card's polite announcer. Only a cover flip or a game ending is said; only while focus is inside the card; 1 s after the last change, never within 5 s of the last announcement;
  // and not while the change it describes is parked under a finger (it is said once the change is on screen). The region is the card's own (always empty in the markup).
  const gdAnnouncer = politeAnnouncer({
    setTimer: d.setTimer, clearTimer: d.clearTimer, now: () => d.now(),
    isHeld: () => parkedNow || railBusy(),
    canSpeak: () => {
      if (withheld() || safeTab() !== HOME_TAB) return false;
      const root = d.getContainer();
      const card = root && typeof root.querySelector === 'function' ? root.querySelector('#gd-card') : null;
      const active = typeof document !== 'undefined' && document ? document.activeElement : null;
      return !!(card && active && typeof card.contains === 'function' && card.contains(active));
    },
    write: (text) => { const root = d.getContainer(); const r = root && typeof root.querySelector === 'function' ? root.querySelector('#gd-card [data-gd-live]') : null; if (r) r.textContent = text; },
  });
  /** Each paint's Game Day model against the last one: what changed that is worth saying (gameday.js decides; this only queues it). */
  function noteGameDay(model) {
    const watch = model && Array.isArray(model.watch) ? model.watch : null;
    const lines = gdWatch && watch ? gameDayAnnouncements(gdWatch, watch) : [];
    gdWatch = watch;
    if (lines.length) gdAnnouncer.note(lines);
  }
  function flushParked() {
    if (flushTimer !== null) { try { if (d.clearTimer) d.clearTimer(flushTimer); } catch { /* a dead timer */ } flushTimer = null; }
    if (!parkedNow) return;
    if (railBusy()) { armFlush(); return; }
    parkedNow = false;
    if (!withheld() && safeTab() === HOME_TAB) renderHome();
  }
  function armFlush() {
    if (!d.setTimer) return;
    if (flushTimer !== null) { try { if (d.clearTimer) d.clearTimer(flushTimer); } catch { /* a dead timer */ } }
    flushTimer = d.setTimer(() => { flushTimer = null; flushParked(); }, RAIL_QUIET_MS + 10);
  }
  /** The finger left the rail (a touchend or touchcancel ANYWHERE on Home: a lost rail touch is over once another touch has ended). The parked change lands once the rail is at rest. */
  function releaseRail() {
    if (!railTouch.down) return;
    railTouch.down = false;
    railTouch.lastScrollAt = Math.max(railTouch.lastScrollAt, d.now());
    armFlush(); flushParked();
  }
  // A touch that began before the app went to the background is over when it comes back (iOS cancels every touch on backgrounding, and that touchcancel may never reach Home's element): becoming VISIBLE
  // again releases a held rail at once instead of after the 30 s lost-touch cap. Bound once per Home (never per container).
  let visibilityBound = false;
  function bindVisibilityOnce() {
    if (visibilityBound || typeof document === 'undefined' || !document || typeof document.addEventListener !== 'function') return;
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => { if (document.hidden !== true) { releaseRail(); onForeground(); } else stopTimeTick(); });
  }
  /**
   * D1 Lane B Game Day (DI-604 / DI-605), fix round 1 (reviewer B3): the card's NODE is kept across every paint that still has a Game Day on both sides, WHATEVER ELSE in the feed changed in the same paint.
   * Before this, the card was patched in place only when it was the only item that changed; the moment another card changed too (a game goes final: its pill leaves AND its game.final card arrives) the whole
   * feed was rewritten with innerHTML — the open card's nodes were thrown away (focus fell to <body>), the rail went back to scrollLeft 0 and a finger held on a pill lost its touch. Now:
   *   1. the card is brought up to date IN PLACE — a data tick patches by key (`patchGameDay`), an open / close or a change of kind swaps its content inside the SAME feed-item node (`swapGameDay`); while a
   *      finger is on the rail (or it is still coasting) a data tick is PARKED and applied at release;
   *   2. every other item is written AROUND that node, reconciled by key: what did not change is not touched (no card blinks, no logo reloads), what is new is inserted (with the entrance fade), what is gone is removed.
   * @returns {false | { parked: boolean, wrote: boolean }}  false = the ordinary full write (Game Day is not on both sides); otherwise the card was handled in place — `parked`: its change waits for the finger;
   *          `wrote`: some OTHER item was written.
   */
  function patchGameDayItem(el, items, prev) {
    if (!el || typeof el.querySelector !== 'function' || !prev || !Array.isArray(prev.order) || !(prev.htmls instanceof Map)) return false;
    const nowIt = items.find(it => it.key === 'now');
    if (!nowIt || !prev.htmls.has('now')) return false;
    if (new Set(items.map(it => it.key)).size !== items.length) return false;                        // a repeated key cannot be reconciled: the ordinary path
    const holder = el.querySelector('[data-card-key="now"]');
    const feed = holder ? holder.parentNode : null;
    if (!holder || !feed || typeof holder.querySelector !== 'function' || typeof feed.insertBefore !== 'function') return false;
    const gdEl = holder.querySelector('.gd');
    if (!gdEl || !nowIt.html.includes('class="gd')) return false;                                    // Game Day is not on both sides (the no-weeks card, a skeleton): the ordinary path
    const others = items.filter(it => it.key !== 'now');
    const prevOthers = prev.order.filter(k => k !== 'now');
    const sameOthers = prevOthers.length === others.length && others.every((it, i) => it.key === prevOthers[i] && prev.htmls.get(it.key) === it.html);
    const readerAt = sameOthers ? null : readerAnchor(el);                                           // PM-110 #3: where the reader is, before anything changes
    // 1. the card
    let parked = false, swapped = false;
    if (prev.htmls.get('now') !== nowIt.html) {
      const sameShell = nowIt.html.includes('data-gd-expanded="' + gdEl.getAttribute('data-gd-expanded') + '"') && nowIt.html.includes('data-gd-kind="' + gdEl.getAttribute('data-gd-kind') + '"');   // a string probe, not markup
      if (sameShell && railBusy()) parked = true;                                                    // a finger is on the rail: nothing under it changes now
      else {
        // Security finding 1 (fix round 2): a patch that THROWS part-way must never leave a half-patched card (an old league line beside a new state). It is caught here and the whole card is written
        // from the new markup instead — pushed-screen's writePart rule.
        let patched = null;
        if (sameShell) {
          try { patched = patchGameDay(holder, nowIt.html, { prevHtml: prev.htmls.get('now'), reduced: prefersReducedMotion(), setTimer: d.setTimer || null, isBusy: railBusy }); }
          catch (e) { console.error('[home] Game Day patch failed; writing the card whole', e); patched = null; }
        }
        if (!patched) {
          const win = viewportWindow();
          swapGameDay(holder, nowIt.html, {
            reduced: prefersReducedMotion(), win, setTimer: d.setTimer || undefined, clearTimer: d.clearTimer || undefined,
            restoreScroll: (y) => { scrollPageBy(y - (Number(win && win.scrollY) || 0), 'instant'); },
          });
          swapped = true;
        }
      }
    }
    // 2. everything else, around the card's node
    if (!sameOthers) {
      writeAroundGameDay(feed, holder, items, prev, (it, isNew) => itemHTML(it, { isNew, escHtml }));     // the wrapper markup is this file's own escaped template; the DOM half only places it
      if (!swapped) keepReaderInPlace(el, readerAt);                                                 // (an open / close moves the page by the member's own tap: the swap restores the scroll itself)
    }
    return { parked, wrote: !sameOthers };
  }

  /** Opens or closes the card IN PLACE. The state lives in the session; the repaint patches only the card; focus moves into the open card (its heading) and back to the header on close. */
  function setGameDayOpen(open, { focusId = null, fromBottom = false } = {}) {
    if (open && !gdCurrent.expandable) return false;
    if (!open && !gd.expanded) return false;
    gd = { expanded: open, focusedGameId: open && isNonEmptyString(focusId) ? focusId : null };
    const ok = renderHome();
    if (ok === false) return false;
    const root = d.getContainer();
    if (root && typeof root.querySelector === 'function') {
      if (open) {
        const h = root.querySelector('#gd-h');
        if (h && typeof h.focus === 'function') { try { h.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ } }
        if (gd.focusedGameId) outlineGameRow(root, gd.focusedGameId);
      } else {
        const head = root.querySelector('[data-home-action="gd-toggle"]');
        if (head && typeof head.focus === 'function') { try { head.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ } }
        if (fromBottom) bringHeaderBackIntoView(root);
      }
    }
    return true;
  }
  /** The tapped pill's game: its row is outlined for 1.4 s (an outline, not an animation) and the page scrolls only as far as needed to bring it above the tab bar. */
  function outlineGameRow(root, gameId) {
    let row = null;
    try { row = Array.from(root.querySelectorAll('.gd-row')).find(r => r.getAttribute('data-game-id') === gameId) || null; } catch { row = null; }
    if (!row) return;
    row.classList.add('gd-row--hl');
    if (d.setTimer) d.setTimer(() => { try { row.classList.remove('gd-row--hl'); } catch { /* detached */ } }, GD_OUTLINE_MS);
    const win = viewportWindow();
    if (!win || typeof row.getBoundingClientRect !== 'function' || typeof document === 'undefined') return;
    const nav = document.querySelector('.bottom-nav');
    const zoneTop = nav && typeof nav.getBoundingClientRect === 'function' ? nav.getBoundingClientRect().top : Number(win.innerHeight) || 0;
    const over = row.getBoundingClientRect().bottom - (zoneTop - 8);
    if (Number.isFinite(over) && over > 0) scrollPageBy(over, prefersReducedMotion() ? 'instant' : 'smooth');
  }
  /** Collapse from the bottom button: if the card's header is now above the visible window, bring it back to 16 pt under the top so the member does not land mid-feed after the button they pressed vanished. */
  function bringHeaderBackIntoView(root) {
    const win = viewportWindow();
    const head = root.querySelector('.gd-head');
    if (!win || !head || typeof head.getBoundingClientRect !== 'function' || typeof document === 'undefined') return;
    const hdr = document.querySelector('.app-header');
    const edge = Math.max(0, hdr && typeof hdr.getBoundingClientRect === 'function' ? hdr.getBoundingClientRect().bottom : 0);
    const gap = head.getBoundingClientRect().top - (edge + 16);
    if (Number.isFinite(gap) && gap < 0) scrollPageBy(gap, prefersReducedMotion() ? 'instant' : 'smooth');
  }
  /** DI-610 — "See all on Home": bring the NEWEST card about the game into view and outline it for 1.6 s (an outline, not an animation; instant under Reduce Motion). If it is beyond the loaded window the window grows
   *  by pages (DI-586, at most five) until it is found. False = it could not be found (the caller says "Those cards are further down on Home." and Home stays at the top). */
  function revealCard(cardId) {
    const root = d.getContainer();
    if (!root || typeof root.querySelectorAll !== 'function' || !isNonEmptyString(cardId)) return false;
    const find = () => Array.from(root.querySelectorAll('[data-card-key]')).find(n => n.getAttribute('data-card-key') === cardId) || null;
    let node = find();
    for (let i = 0; !node && i < 5; i++) { pages += 1; renderHome(); node = find(); }
    if (!node) return false;
    node.classList.add('feed-item--hl');
    if (d.setTimer) d.setTimer(() => { try { node.classList.remove('feed-item--hl'); } catch { /* detached */ } }, 1600);
    const win = viewportWindow();
    if (win && typeof node.getBoundingClientRect === 'function') { const r = node.getBoundingClientRect(); scrollPageBy(r.top + r.height / 2 - (Number(win.innerHeight) || 0) / 2, prefersReducedMotion() ? 'instant' : 'smooth'); }   // centred
    return true;
  }
  /** DI-606: every entry point lands here. A game id is resolved against THIS paint's rows (the DOM is untrusted); an unknown one opens the card without focusing a row. */
  function openGameDay(arg) {
    const gameId = (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg.gameId : null;   // an entry point's argument is never trusted: null, a number or an array is "no focus", never a throw
    if (!gdCurrent.expandable) {
      const root = d.getContainer();
      const card = root && typeof root.querySelector === 'function' ? root.querySelector('#gd-card') : null;
      if (card && typeof card.getBoundingClientRect === 'function') {            // a card that does not open: scroll Home to it and do nothing else
        const hdr = typeof document !== 'undefined' ? document.querySelector('.app-header') : null;
        const edge = Math.max(0, hdr && typeof hdr.getBoundingClientRect === 'function' ? hdr.getBoundingClientRect().bottom : 0);
        scrollPageBy(card.getBoundingClientRect().top - (edge + 16), prefersReducedMotion() ? 'instant' : 'smooth');
      }
      return false;
    }
    return setGameDayOpen(true, { focusId: isNonEmptyString(gameId) && gdCurrent.ids.has(gameId) ? gameId : null });
  }
  function handleGameDayAction(action, attr) {
    const tap = (kind) => { try { d.haptic(kind); } catch { /* a dropped haptic is invisible */ } };
    if (action === 'gd-toggle') { if (!gdCurrent.expandable) return; if (!gd.expanded) tap('light'); setGameDayOpen(!gd.expanded); return; }       // light on open; none on close (Std-4)
    if (action === 'gd-more') { if (!gdCurrent.expandable) return; tap('light'); setGameDayOpen(true); return; }
    if (action === 'gd-pill') {
      if (!gdCurrent.expandable) return;
      const id = attr('data-game-id');
      tap('light');
      setGameDayOpen(true, { focusId: isNonEmptyString(id) && gdCurrent.pillIds.has(id) ? id : null });
      return;
    }
    if (action === 'gd-collapse') { setGameDayOpen(false, { fromBottom: true }); return; }
    if (action === 'gd-row') {
      const id = attr('data-game-id');
      if (!isNonEmptyString(id) || !gdCurrent.ids.has(id)) return;                    // Std-9: only a game in the CURRENT paint's rows
      tap('medium');
      gd = { expanded: gd.expanded, focusedGameId: id };
      try { d.onAction('open-game', { gameId: id, source: 'gameday' }); } catch (err) { console.error('[home] action failed', err); }
      return;
    }
    if (action === 'gd-dashboard') {
      const sc = attr('data-scope');
      const scope = sc === 'all' ? 'all' : (isNonEmptyString(sc) && gdCurrent.scopes.has(sc) ? sc : null);
      tap('light');
      try { d.onAction('open-dashboard', { scope }); } catch (err) { console.error('[home] action failed', err); }
    }
  }

  // ── W-92 (DI-W92-10): the time stays honest while Home is open. ONE 60 s timer, armed by a content paint while Home is the visible tab, rewrites
  // the labels in place (refreshTimes — no repaint, no reflow of other cards, no scroll change, no announcement); it re-arms itself, stops when the
  // page is hidden, the tab is left, the content is withheld or the session resets, and runs once when the app comes back to the foreground. ──
  function stopTimeTick() {
    if (tickTimer !== null) { try { if (d.clearTimer) d.clearTimer(tickTimer); } catch { /* a dead timer */ } tickTimer = null; }
  }
  function armTimeTick() {
    stopTimeTick();
    if (!d.setTimer || withheld() || safeTab() !== HOME_TAB) return;
    if (typeof document !== 'undefined' && document && document.hidden === true) return;
    tickTimer = d.setTimer(() => { tickTimer = null; timeTick(); }, TIME_TICK_MS);
  }
  function timeTick() {
    if (withheld() || safeTab() !== HOME_TAB) { stopTimeTick(); return; }
    if (typeof document !== 'undefined' && document && document.hidden === true) { stopTimeTick(); return; }
    const el = d.getContainer();
    if (!el) return;
    refreshTimes(el, d.now(), { formatDate: tickFormat || undefined });
    armTimeTick();
  }
  /** Back in the foreground (iOS fires visibilitychange on resume): the labels catch up at once, then the timer resumes. */
  function onForeground() {
    if (withheld() || safeTab() !== HOME_TAB) return;
    let el = null;
    try { el = d.getContainer(); } catch { el = null; }
    if (el && paintState.get(el) && paintState.get(el).mode === 'content') { refreshTimes(el, d.now(), { formatDate: tickFormat || undefined }); armTimeTick(); }
  }
  /**
   * A repaint whose ONLY change to an item is its time label is not a change: the labels already on screen are brought up to date in place and the
   * stored markup is advanced to match, so the paint below finds nothing to write (or writes only what really changed). Keeps the reader's nodes,
   * focus and VoiceOver position — "no repaint to change a time".
   */
  function absorbTimeOnly(el, items, prev, mode, now) {
    if (mode !== 'content' || !prev || prev.mode !== 'content' || !(prev.htmls instanceof Map) || !Array.isArray(prev.order)) return prev;
    const htmls = new Map(prev.htmls);
    let changed = false;
    for (const it of items) {
      const old = htmls.get(it.key);
      if (typeof old === 'string' && old !== it.html && timeInvariant(old) === timeInvariant(it.html)) { htmls.set(it.key, it.html); changed = true; }
    }
    if (!changed) return prev;
    refreshTimes(el, now, { formatDate: tickFormat || undefined });
    const stored = prev.order.filter(k => typeof htmls.get(k) === 'string').map(k => ({ key: k, html: htmls.get(k) }));
    return { ...prev, htmls, plain: wrapItems(stored, { enter: null, busy: false, escHtml }) };
  }

  /** Replaces the markup only when it CHANGED; cards that were not on screen fade in (150 ms); the first content paint after a skeleton fades in whole. */
  function paint(el, items, mode, model = null) {
    const painted = isPainted(el);
    const prev0 = painted ? (paintState.get(el) || { mode: 'none', keys: new Set(), plain: '', htmls: new Map() }) : { mode: 'none', keys: new Set(), plain: '', htmls: new Map() };
    const prev = absorbTimeOnly(el, items, prev0, mode, model && Number.isFinite(model.now) ? model.now : d.now());
    const busy = mode === 'skeleton';
    const plain = wrapItems(items, { enter: null, busy, escHtml });
    if (painted && prev.mode === mode && prev.plain === plain) { if (model) afterPaint(el, model); return false; }     // identical: no DOM write, no flash, scroll untouched
    // D1 Lane B Game Day (DI-604 / DI-605): when ONLY the Game Day card changed — a score tick, an open, a close — the rest of the feed is not touched at all: no other card is rebuilt, no logo blinks, the
    // reader's place cannot move. A tick patches the card's nodes by key; an open / close grows or shrinks the card in place. While the pill rail is being touched the change is PARKED (applied at release).
    if (painted && mode === 'content' && prev.mode === 'content' && model) {
      const r = patchGameDayItem(el, items, prev);
      if (r) {
        if (r.parked) parkedNow = true;
        if (r.parked && !r.wrote) { afterPaint(el, model); return false; }                              // nothing was written: what is stored still describes the DOM
        // a parked card keeps its OLD markup in the stored state (that is what is on screen); the next paint finds it changed and applies it at release
        const stored = r.parked ? items.map(it => (it.key === 'now' ? { key: 'now', html: prev.htmls.get('now') } : it)) : items;
        paintState.set(el, { mode, keys: new Set(stored.map(i => i.key)), plain: r.parked ? wrapItems(stored, { enter: null, busy: false, escHtml }) : plain, htmls: new Map(stored.map(i => [i.key, i.html])), order: stored.map(i => i.key) });
        afterPaint(el, model);
        return true;
      }
      // B3: a paint that cannot be done in place (Game Day is gone on one side) must not replace the rail under a finger either: it waits for the release (the markup is rebuilt from fresh data then)
      if (typeof el.querySelector === 'function' && railBusy() && el.querySelector('[data-gd-rail]')) { parkedNow = true; return false; }
    }
    let enter = null;
    if (mode === 'content' && prev.mode === 'skeleton') enter = 'all';
    else if (mode === 'content' && prev.mode === 'content') enter = prev.keys;
    const anchor = (painted && prev.mode === 'content' && mode === 'content') ? readerAnchor(el) : null;   // PM-110 #3: where the reader is, before the markup changes
    el.innerHTML = enter === null ? plain : wrapItems(items, { enter, busy, escHtml });
    keepReaderInPlace(el, anchor);                                                                          // …and the same card back in the same place after it
    paintState.set(el, { mode, keys: new Set(items.map(i => i.key)), plain, htmls: new Map(items.map(i => [i.key, i.html])), order: items.map(i => i.key) });
    if (model) afterPaint(el, model);
    return true;
  }

  /** What follows every content paint, written or not: which ordinary entries are on screen, the new-posts pill, the scroll watch that lets it dismiss itself, and the next-page sentinel. */
  function afterPaint(el, model) {
    armTimeTick();                                                           // W-92 (DI-W92-10): every content paint (re)arms the ONE time refresh — a real paint is what arms it
    renderedOrdinary = new Set(model.ordinaryKeys);
    heldCount = model.heldCount;
    syncPill(el, heldCount);
    watchScroll(heldCount > 0);
    watchSentinel(el, model.hasMore);
  }

  /** DI-574 — the pill: one 44 pt button in a sticky zero-height slot at the top of Home's root. It lives outside the feed's markup (the identical-markup check never sees it), is created, updated
   *  and removed in place, and is re-added after any full repaint. A container with no DOM API (the unit-test fakes) is left alone; `pillState()` reports it. */
  function syncPill(el, count) {
    if (!el || typeof el.querySelector !== 'function' || typeof el.insertAdjacentHTML !== 'function') return;
    const slot = el.querySelector('.home-pill-slot');
    if (count <= 0) { if (slot) slot.remove(); cancelAnnounce(); pillAnnounced = false; return; }
    const label = pillLabel(count);
    const btn = slot && slot.querySelector('.home-pill');
    if (btn) {
      if (btn.getAttribute('aria-label') !== label) { btn.setAttribute('aria-label', label); const t = btn.querySelector('.home-pill-text'); if (t) t.textContent = label; if (!pillAnnounced) scheduleAnnounce(); }
      return;
    }
    el.insertAdjacentHTML('afterbegin', pillHTML(count, { escHtml }));
    if (!pillAnnounced) scheduleAnnounce();
  }

  /** DI-574 (VoiceOver): the pill's appearance is announced once, politely (a `role=status` live region beside the button, written AFTER it exists so the change is heard), after PILL_ANNOUNCE_MS of quiet — the
   *  count is read when the timer fires, so arrivals inside the window fold into ONE announcement. A later arrival updates the button's name but is not announced again (no chatter); the next appearance is. */
  function cancelAnnounce() { if (announceTimer !== null) { try { if (d.clearTimer) d.clearTimer(announceTimer); } catch { /* a dead timer */ } announceTimer = null; } }
  function scheduleAnnounce() {
    cancelAnnounce();
    if (!d.setTimer) return;
    announceTimer = d.setTimer(() => {
      announceTimer = null;
      if (heldCount <= 0 || withheld()) return;
      let root = null;
      try { root = d.getContainer(); } catch { root = null; }
      const live = root && typeof root.querySelector === 'function' ? root.querySelector('.home-pill-live') : null;
      if (!live) return;
      live.textContent = pillLabel(heldCount);
      pillAnnounced = true;
    }, PILL_ANNOUNCE_MS);
  }

  /** The reader reaching the top by scrolling dismisses the pill and lets the held cards in (they appear first, with the entrance fade). Bound only while something is held. */
  function watchScroll(on) {
    if (!on) { if (scrollWatch) { try { scrollWatch(); } catch { /* detached */ } scrollWatch = null; } return; }
    if (scrollWatch) return;
    const win = viewportWindow();
    if (!win || typeof win.addEventListener !== 'function') return;
    const onScroll = () => {                                                  // a scroll event is already frame-paced; this only acts on the one transition that matters
      if (scrollY() > READER_TOP_PX || heldCount <= 0 || withheld() || safeTab() !== HOME_TAB) return;
      renderHome();
    };
    win.addEventListener('scroll', onScroll, { passive: true });
    scrollWatch = () => { try { win.removeEventListener('scroll', onScroll); } catch { /* detached */ } };
  }

  /** DI-586 — watch the sentinel; reaching it (600 pt early) appends the next page. */
  function watchSentinel(el, hasMore) {
    if (unobserveSentinel) { try { unobserveSentinel(); } catch { /* detached */ } unobserveSentinel = null; }
    if (!hasMore || typeof el.querySelector !== 'function') return;
    const target = el.querySelector('[data-feed-sentinel]');
    if (!target) return;
    const observe = d.observeSentinel || defaultObserveSentinel;
    const un = observe(target, () => loadMore());
    unobserveSentinel = typeof un === 'function' ? un : null;
  }

  /**
   * Appends the next page. When the container is a real DOM and everything already painted is unchanged, the new entries are inserted at the end — nothing above them is touched, so no logo blinks
   * and the reader's momentum is never interrupted; otherwise (a fake container, or something above changed) it is an ordinary repaint.
   */
  function loadMore() {
    const el = d.getContainer();
    if (!el || withheld() || safeTab() !== HOME_TAB) return;
    pages += 1;
    const prev = paintState.get(el);
    const feed = el && typeof el.querySelector === 'function' ? el.querySelector('.home-feed') : null;
    if (!prev || prev.mode !== 'content' || !feed || typeof feed.insertAdjacentHTML !== 'function') { renderHome(); return; }
    const model = buildModel(el);
    if (withheld()) return;
    const keys = model.items.map(i => i.key);
    const old = prev.order.filter(k => k !== 'sentinel');
    const same = old.every((k, i) => keys[i] === k && prev.htmls.get(k) === model.items[i].html);
    if (!same) { renderHome(); return; }
    const added = model.items.slice(old.length);
    const sent = feed.querySelector('[data-card-key="sentinel"]');
    if (sent) sent.remove();
    feed.insertAdjacentHTML('beforeend', joinHtml(added.map(it => itemHTML(it, { isNew: true, escHtml }))));
    paintState.set(el, { mode: 'content', keys: new Set(keys), plain: wrapItems(model.items, { enter: null, busy: false, escHtml }), htmls: new Map(model.items.map(i => [i.key, i.html])), order: keys });
    afterPaint(el, model);
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
        const items = await d.fetchNews({ force, seenBaseline: () => seen.baseline });   // D1 Lane C (review B4): the content cards' unseen-first reads THIS visit's baseline (DI-587)
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
      const partial = next.status === 'ready' && next.items.some(it => it && it.cardKind === 'news-error');   // D1 Lane C (review B3): headlines failed, content stood
      if (quiet && (next.status === 'error' || (partial && news.status === 'ready'))) {          // a background refetch never replaces cards with an error…
        news = { ...news, fetchedAt: d.now() };                                  // …and waits a full NEWS_STALE_MS before asking again (D1 Lane C: without this the repaint that
        return;                                                                  // follows saw the slot still stale and refetched at once, a loop for as long as the news stayed down)
      }
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
    syncSession();                                                           // a different identity or league starts a clean reader's session
    if (d.onRender) { try { d.onRender(); } catch { /* a screen refresh must never break the feed */ } }   // D1 Lane B: lets the app refresh an open card detail on every data repaint
    if (!d.isDataReady()) {                                                  // cached -> SKELETON -> progressive: never a blank page, never a spinner
      const items = [];
      for (let i = 0; i < SKELETON_CARD_COUNT; i++) items.push({ key: `skel:${i}`, html: i === 0 ? gameDaySkeletonHTML({ escHtml }) : skeletonCardHTML() });   // DI-603: the first skeleton is Game Day's own (a header and two pills, the card's height), so the feed does not shift
      if (withheld()) return false;
      paint(el, items, 'skeleton');
      return true;
    }
    ensureNews();
    noteVisitStart();
    const model = buildModel(el);
    if (withheld()) return false;                                            // belt: re-check right before the write
    paint(el, model.items, 'content', model);
    return true;
  }

  /** DI-587 — a visit begins when Home paints while visible: the marker as it stands NOW is this visit's baseline, and stays so until the visit ends. */
  function noteVisitStart() {
    if (seen.visibleSince !== null) return;
    if (typeof document !== 'undefined' && document && document.hidden === true) return;
    seen = { marker: seen.marker, baseline: seen.marker, visibleSince: d.now() };
  }
  /** DI-587 — the reader left Home (another tab, the app backgrounded). A visit of at least SEEN_MIN_VISIT_MS advances the marker to now; a pull-to-refresh or opening a detail never calls this. */
  function noteLeft() {
    stopTimeTick();
    if (seen.visibleSince === null) return false;
    const advanced = d.now() - seen.visibleSince >= SEEN_MIN_VISIT_MS;
    seen = { marker: advanced ? d.now() : seen.marker, baseline: seen.baseline, visibleSince: null };
    return advanced;
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
    userRefreshing = true;                                                   // DI-574: the reader asked for this — new cards go in at once, the place they were reading is kept
    try { renderHome(); } finally { userRefreshing = false; }
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
      if (action.startsWith('gd-')) { handleGameDayAction(action, attr); return; }   // D1 Lane B Game Day: its own validation, its own haptics (light on open, none on close, medium into a game)
      if (action === 'build-slate' && !viewerNow().isCommissioner) return;   // B3: the role is checked at DISPATCH, not trusted from the markup that rendered the button — before any haptic
      let params = {};
      if (action === 'go-tab') {
        const tab = attr('data-tab');
        if (!ACTION_TABS.includes(tab)) return;                              // validated BEFORE any haptic: a rejected tap is silent
        params = { tab };
        const commTab = attr('data-comm-target');                            // NOT data-comm-tab: that name is RG-10's card-tagging attribute
        if (tab === 'commissioner' && ACTION_COMM_TABS.includes(commTab)) params.commTab = commTab;
        // D1 Part 2 item 6: the sport the button's card is about — kept ONLY on a sport tab and ONLY when it names a sport this league's feed spans (the DOM is untrusted; a forged one is dropped and the
        // tap is a plain go-tab). app.js routes it through enterSportContext, which validates it again against what the member plays.
        const sport = attr('data-sport');
        if (isNonEmptyString(sport) && SPORT_ACTION_TABS.includes(tab)) {
          let known = false;
          try { known = asArray(d.read.contexts ? d.read.contexts() : null).some(c => c && c.dbCode === sport); } catch { known = false; }
          if (known) params.sport = sport;
        }
        const weekId = attr('data-week-id');                                 // FB-022: View All's period — kept ONLY when it names one of this league's weeks
        if (isNonEmptyString(weekId)) {
          let known = false;
          try { known = asArray(d.read.weeks()).some(w => w && w.weekId === weekId); } catch { known = false; }
          if (known) params.weekId = weekId;
        }
      }
      if (action === 'open-card') {
        const cardId = attr('data-card-id');
        // Std-9 — the id in the markup is only a REQUEST: it must be one of the tappable cards derived for the CURRENT paint, or nothing happens (validated before any haptic, like every rejected tap).
        if (!isNonEmptyString(cardId) || !currentCardIds.has(cardId)) return;
        params = { cardId };
      }
      const kind = attr('data-haptic');
      try { d.haptic(HAPTIC_KINDS.includes(kind) ? kind : 'light'); } catch { /* a dropped haptic is invisible */ }
      if (action === 'new-posts') { scrollFeedToTop(); return; }              // DI-574: the scroll watch lets the held cards in when the reader arrives
      if (action === 'retry-news') {
        news = { status: 'loading', items: [], fetchedAt: 0 };
        renderHome();
        void runNewsLoad({ force: true });
        return;
      }
      if (action === 'retry-load') { renderHome(); return; }
      try { d.onAction(action, params); } catch (err) { console.error('[home] action failed', err); }
    };
    // A focused card is a button: Enter and Space open it (the card itself must hold focus — a key inside it is somebody else's).
    const onKey = (e) => {
      if (e && e.key === 'Escape' && gd.expanded) { setGameDayOpen(false); return; }          // web: Esc collapses the open card (DI-605); a phone has no Esc key
      if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
      const t = e.target;
      const card = t && typeof t.closest === 'function' ? t.closest('[data-home-action="open-card"]') : null;
      if (!card || card !== t) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();         // Space must not scroll the page
      onClick({ target: t });
    };
    // DI-604: a finger on the pill rail (or a rail still coasting) parks structure changes to it; the change lands at release. Passive listeners — they never delay a scroll.
    const inRail = (t) => !!(t && typeof t.closest === 'function' && t.closest('[data-gd-rail]'));
    const onTouchStart = (e) => { if (inRail(e && e.target)) { railTouch.down = true; railTouch.downAt = d.now(); } };
    const onTouchEnd = () => releaseRail();
    const onRailScroll = (e) => { if (inRail(e && e.target)) { railTouch.lastScrollAt = d.now(); if (parkedNow) armFlush(); } };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('scroll', onRailScroll, { capture: true, passive: true });
    bindVisibilityOnce();
    const unbind = () => { try { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchend', onTouchEnd); el.removeEventListener('touchcancel', onTouchEnd); el.removeEventListener('scroll', onRailScroll, true); } catch { /* detached */ } bound.delete(el); };
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

  /**
   * The ONE fresh read behind every pushed screen (the card detail and the Game view): the snapshot and its cards, derived the same way the paint derives them (deriveHomeCards), so the id the feed shows
   * is the id a screen resolves and the Game view's Related cards are the feed's own. Null when the read throws (the caller shows the calm unavailable state).
   */
  let freshBuilds = 0;   // how many fresh reads were built (a test seam: Share's resolver must build ONE per pass, never one per message)
  function freshSnapshot(what) {
    const { viewerId, isCommissioner } = viewerNow();
    const now = d.now();
    freshBuilds += 1;
    try {
      const snapshot = assembleHomeSnapshot(d, { viewerId, isCommissioner, now });
      const cards = deriveHomeCards(snapshot, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: d.isContentWithheld });
      return { snapshot, cards, viewerId, isCommissioner, now };
    } catch (e) { console.error(`[home] ${what} snapshot failed`, e); return null; }
  }

  /** May this viewer open a game or week of `week`? Not a demo week unless commissioner (UN-71); not a week the SERVER still calls a draft unless commissioner (the server-confirmed status, RG-253). */
  function viewableWeek(snapshot, week, isCommissioner) {
    if (!week) return false;
    let wstatus = week.status;
    try { wstatus = snapshot.confirmedStatusFor(week) || week.status; } catch { wstatus = week.status; }
    if (week.dataSourceMode === 'demo' && isCommissioner !== true) return false;
    if (wstatus === 'draft' && isCommissioner !== true) return false;
    return true;
  }

  /**
   * DI-597 (security F-1, 2026-10-14) — what a shared reference may open for THIS viewer, all from ONE fresh read: the ids of the cards this paint derives that have a detail, the games and the weeks
   * the viewer may open (viewableWeek). Share's resolver builds this once per pass and checks every message against the Sets (a room of fifty shares costs one derivation, not fifty).
   */
  function shareTargets() {
    const none = { cardIds: new Set(), gameIds: new Set(), weekIds: new Set() };
    if (withheld()) return none;
    const fresh = freshSnapshot('share targets');
    if (!fresh) return none;
    const { snapshot, cards, isCommissioner } = fresh;
    const weekIds = new Set(asArray(snapshot.weeks).filter(w => w && isNonEmptyString(w.weekId) && viewableWeek(snapshot, w, isCommissioner)).map(w => w.weekId));
    return {
      cardIds: new Set(asArray(cards).filter(c => c && isNonEmptyString(c.id) && hasDetail(c.type)).map(c => c.id)),
      gameIds: new Set(asArray(snapshot.games).filter(g => g && isNonEmptyString(g.gameId) && weekIds.has(g.weekId)).map(g => g.gameId)),
      weekIds,
    };
  }

  /**
   * DI-575 — the card detail for one card id, rebuilt from the CURRENT data every time it is asked (the pushed screen asks on open AND on every repaint, so a gate that stops passing while the
   * screen is open turns it into the calm unavailable state at once). Returns null when the card is not a tappable card of this paint, or its detail cannot be shown. Nothing here trusts the DOM.
   */
  function resolveCardDetail(cardId, { noGame = false } = {}) {
    if (withheld() || !isNonEmptyString(cardId)) return null;
    const fresh = freshSnapshot('card detail');
    if (!fresh) return null;
    const { snapshot, cards } = fresh;
    const card = cards.find(c => c && c.id === cardId);
    if (!card || !hasDetail(card.type)) return null;
    let extra = {};
    if (d.detailContext) { try { extra = d.detailContext() || {}; } catch { extra = {}; } }
    const tzKey = snapshot.timezone;
    const ctx = {
      formatTime: (v) => formatGameTime(typeof v === 'number' ? new Date(v).toISOString() : v, tzKey),
      formatCountdown, liveEntryFor: d.liveEntryFor || (() => null),
      threadCount: extra.threadCount, scoreSummaryRowsHTML: extra.scoreSummaryRowsHTML, capabilities: noGame ? { ...(extra.capabilities || {}), gameday: false } : extra.capabilities, canCompare: extra.canCompare,   // DI-610: a detail opened FROM a Game view has no "Open game" (no loop)
      showSport: asArray(snapshot.competitions).length > 1, sportLabel: (sp) => competitionLabel(snapshot, sp), pilotHistory: pilotHistory(),
    };
    let model = null;
    try { model = buildCardDetail(card, snapshot, ctx); } catch (e) { console.error('[home] card detail failed', e); model = null; }
    if (!model) return null;
    return { title: detailTitle(card), model, html: cardDetailHTML(model, { escHtml, iconHtml: glyphSpan('cd-eyebrow-icon', CARD_ICON[card.type] || 'calendarWeek'), actionIcons: { share: glyphSpan('cd-action-icon', 'share') } }) };
  }

  /** The calm state a screen shows for a card that can no longer be shown. */
  const unavailableDetail = () => unavailableDetailHTML({ escHtml });

  // ── the Game view (D1 Lane B, DI-591 / DI-610): everything the pushed screen draws, resolved BY GAME ID from the CURRENT data on open and on every repaint — never from the DOM ──
  const NEUTRAL_COVER = (game, phase) => {
    const p = phase && phase.phase;
    if (p === 'live' || p === 'live-stale' || p === 'final') {
      let who = null;
      try { who = calculateAtsWinner({ ...game, status: 'final' }); } catch { who = null; }
      if (!who) return '';
      if (who === 'no_decision') return p === 'final' ? 'Push' : 'Right on the number';
      const m = atsMarginOf(game);
      return `${who} ${p === 'final' ? 'covered' : 'is covering'}${m === null ? '' : ` by ${String(Number(m.toFixed(1)))}`}`;
    }
    if (p === 'no-score' || p === 'awaiting') return 'Score not available yet.';
    return '';
  };

  /**
   * @returns {null | { title:string, gameId:string, html:string, live:{ids:string[], index:number}, relatedIds:string[] }}   null = the game cannot be shown to this viewer (gone, draft for a member, demo for a
   *          non-commissioner, content withheld) — the caller shows the calm unavailable state.
   */
  function resolveGameView(gameId) {
    if (withheld() || !isNonEmptyString(gameId)) return null;
    const fresh = freshSnapshot('Game view');
    if (!fresh) return null;
    const { snapshot, cards, viewerId, isCommissioner, now } = fresh;
    const game = asArray(snapshot.games).find(g => g && g.gameId === gameId);
    const week = game ? asArray(snapshot.weeks).find(w => w && w.weekId === game.weekId) : null;
    if (!game || !week) return null;
    const wstatus = (() => { try { return snapshot.confirmedStatusFor(week) || week.status; } catch { return week.status; } })();
    if (!viewableWeek(snapshot, week, isCommissioner)) return null;         // UN-71 (demo) and a draft week for a member — the ONE rule, shared with Share's resolver
    const viewer = isNonEmptyString(viewerId) ? viewerId : '';
    const comps = asArray(snapshot.competitions);
    const comp = competitionOfWeek(comps, week);
    const sport = weekSport(snapshot, week);
    const entrants = d.entrantsFor ? asArray(d.entrantsFor(week)) : [];     // C4 / A3: the caller's roster for THAT game's sport and week; none injected = nobody is an entrant (fail closed), never the active players
    // N7 (pass 3): the sport the GAME is in. Home's competitions are the sports its feed spans (the default and any with an Open, Locked or Live week, homeFeedContexts); a game reached from chat or a
    // history row can belong to another - an NFL game read in a quiet NFL week - so its name comes from the league's own competitions, never a default of "CFB".
    const leagueLabel = (() => { if (comp || !d.weekSportLabel) return ''; try { const v = d.weekSportLabel(week); return isNonEmptyString(v) ? v : ''; } catch { return ''; } })();
    const viewerIn = viewer ? entrants.some(p => p && p.playerId === viewer) : false;
    const entered = (comp ? comp.viewerEntered !== false : true) && (viewer ? viewerIn : true);
    const label = comp ? comp.label : (leagueLabel || 'CFB');
    const hasProvider = typeof snapshot.liveEntryFor === 'function';
    const fmtKick = (iso) => kickLabel(game, iso, snapshot.timezone);
    let entry = null;
    try { entry = hasProvider ? snapshot.liveEntryFor(game.gameId) : null; } catch { entry = null; }
    const phase = (game.status === 'live' && !hasProvider)
      ? { phase: 'live', label: '', score: null, fresh: null, capturedAt: null, ageMs: null, pulse: false }
      : gameStateOf(game, { liveEntry: entry, now, formatKickoff: fmtKick });
    const abbrMap = buildAbbrMap(asArray(snapshot.games).filter(g => g && g.weekId === game.weekId));
    const ab = (t) => abbrMap.get(t) || String(t || '').slice(0, 4).toUpperCase();
    const ownTeam = viewer && viewerIn ? ownPickTeam(snapshot.picks, game.gameId, viewer) : null;
    const own = ownTeam ? { ...(ownCoverOf(game, ownTeam, phase) || { kind: 'pending', margin: '' }), team: ownTeam } : null;
    const publicWeek = arePicksPublic(week);
    const picksHtml = entered && viewer !== null ? picksRowHTML({ game, week, entrants, viewerId: viewer, view: gdPicksView(), form: 'panel', escHtml, numHtml: numStr }) : '';
    let picksNote = '', picksAction = '';
    if (!picksHtml) {
      if (!entered && viewer) picksNote = `You're not entered in ${label} picks. You can still follow this game and chat.${publicWeek ? '' : ' Picks stay hidden until kickoff.'}`;
      else if (!viewer) picksNote = publicWeek ? "The league's picks are loading." : "Sign in to see the league's picks.";
      else if (!publicWeek && !(() => { try { return hasPlayerSubmitted(week.weekId, viewer) === true; } catch { return false; } })()) {
        // Open: they can still submit, so say so and offer the way. Locked (stored locked, or stored open with the lock instant passed — the ONE week-lock state, the same answer the Picks tab gives): they cannot, so no
        // instruction and no button (fix round 1: the panel used to tell a member to submit into a locked form).
        let closed = false;
        try { closed = weekLockState({ week, games: asArray(snapshot.games).filter(g => g && g.weekId === week.weekId), now, confirmedStatus: wstatus }).closed === true; } catch { closed = false; }
        if (closed) {
          // Coordinator decision (fix round 2): hasPlayerSubmitted means a FULL slate. A member who picked SOME of a locked week is told what they did — "You picked 2 of 6" — and keeps seeing their own pick
          // on this game (game-view.js); a member who picked nothing keeps the sentence they had.
          const weekGames = asArray(snapshot.games).filter(g => g && g.weekId === week.weekId);
          const ids = new Set(weekGames.map(g => g.gameId));
          const k = new Set(asArray(snapshot.picks).filter(p => p && p.playerId === viewer && ids.has(p.gameId)).map(p => p.gameId)).size;
          picksNote = k > 0 ? `Picks are locked. You picked ${numStr(k)} of ${numStr(weekGames.length)}. Everyone's picks appear at kickoff.` : "Picks are locked and yours weren't submitted. Everyone's picks appear at kickoff.";
        }
        else { picksNote = "Submit your picks to see who's in. Everyone's picks appear at kickoff."; picksAction = 'Make your picks'; }
      }
      else picksNote = "The league's picks are still loading. They appear in a moment.";
    }
    const picksState = picksHtml ? (/data-picks-view="blind"/.test(picksHtml) ? 'hidden' : 'public') : 'none';
    const related = cardsForGame(cards, game, { entered: viewer ? viewerIn && entered : true });
    const shown = related.slice(0, RELATED_CAP);
    const relatedHtml = shown.map(c => `<div class="gv-rel" data-card-key="${escHtml(c.id)}">${cardHTML(c, { escHtml, formatKickoff: (iso) => formatGameTime(iso, snapshot.timezone), now, formatDate: dateFormatterFor(snapshot.timezone) })}</div>`).join('');   // W-92: Related cards carry their times too
    // the live games the stepper walks (two or more): the Now card's scope, kickoff order
    const kept = sortWeeks(asArray(snapshot.weeks)).filter(w => hasWeekN(w) && (isCommissioner === true || w.dataSourceMode !== 'demo'));
    const curWeek = kept.find(w => w.weekId === snapshot.currentWeekId) || kept[kept.length - 1] || null;
    let liveIds = [];
    if (curWeek) { try { liveIds = gameDayEntries(snapshot, curWeek, { now, isCommissioner, viewerId: viewer }).filter(e => e.phase.phase === 'live' || e.phase.phase === 'live-stale').map(e => e.game.gameId); } catch { liveIds = []; } }
    const home = game.homeTeam, away = game.awayTeam;
    // DI-599 / DI-593 — What's next, on a FINAL game only, for a signed-in viewer (S4: none): the next shared opportunity (its sentence and its one button), then the week's results — "See week results"
    // once the week is SERVER-confirmed final (the week's result card's detail, pushed above this screen; Standings when that card is not shown), otherwise "Week {N} results post when the last game is final."
    let whatsNext = null, next = null, results = null;
    if (phase.phase === 'final' && viewer) {
      const nx = nextUpFor(snapshot, { viewerId: viewer, isCommissioner, now });
      const showSport = comps.length > 1;
      const act = nextAction(nx, { showSport });
      next = act ? { action: act.action, label: act.label, tone: act.tone, weekId: nx.weekId, sport: nx.sport } : null;
      const weekFinal = wstatus === 'final';
      const resultCard = weekFinal ? cards.find(c => c && c.type === 'week.result' && c.weekId === week.weekId) || null : null;
      results = { final: weekFinal, weekN: numStr(week.weekNumber), cardId: resultCard ? resultCard.id : null };
      whatsNext = { line: nextLine(nx, { time: (v) => shortWhen(v, snapshot.timezone) }, { showSport }), action: next ? { action: next.action, label: next.label, tone: next.tone } : null, results };
    }
    const model = {
      game: { gameId: game.gameId, raw: game, away, home, awayAbbr: ab(away), homeAbbr: ab(home), awayScore: numOrNull(game.awayScore), homeScore: numOrNull(game.homeScore),
        awayRank: game.awayRank || null, homeRank: game.homeRank || null,
        awayLogo: d.logoUrlFor ? safeLogo(d.logoUrlFor, game, 'away') : null, homeLogo: d.logoUrlFor ? safeLogo(d.logoUrlFor, game, 'home') : null },
      phase, line: gameLineText(game), coverLine: NEUTRAL_COVER(game, phase),
      freshness: freshnessLine(phase, { game, now, formatKickoff: fmtKick, formatTime: (v) => formatGameTime(typeof v === 'number' ? new Date(v).toISOString() : v, snapshot.timezone) }),
      own, picksHtml, picksState, picksNote, picksAction,
      thread: d.threadInfo ? (() => { try { return d.threadInfo(game.gameId); } catch { return null; } })() : null,
      relatedHtml, relatedMore: related.length > RELATED_CAP,
      whatsNext,
    };
    // DI-597 — Share to chat: a signed-in member, with chat on (the thread card's own `enabled`), on a game this viewer may see (everything above has passed). The headline is public game facts only: the
    // sport (several sports), the phase, the matchup, and a live or final score with the neutral cover line ("Oregon covered by 4") — never anyone's pick.
    const share = viewer && model.thread && model.thread.enabled !== false ? gameShareOf(game, phase, { sportLabel: comps.length > 1 && comp ? comp.label : '' }) : null;
    model.share = !!share;
    // what the announcer compares between repaints (DI-591 / DI-593): this game's phase, score, the neutral cover line and the VIEWER'S OWN coverage — nothing about another member
    const watch = { gameId: game.gameId, phase: phase.phase, away, home, awayScore: numOrNull(game.awayScore), homeScore: numOrNull(game.homeScore), entered: !!(viewer && viewerIn && entered), coverage: own ? own.kind : 'none', margin: own ? own.margin || '' : '', coverLine: model.coverLine };
    return {
      watch, next, results,
      share,
      title: `${ab(away)} @ ${ab(home)}`, gameId: game.gameId, html: gameViewHTML(model, { escHtml, numHtml: numStr, shareIconHtml: glyphSpan('gv-btn-icon', 'share') }),
      live: { ids: liveIds, index: liveIds.indexOf(game.gameId) }, relatedIds: related.map(c => c.id), related: shown.map(c => c.id),
      stepperHTML: gameStepperHTML({ index: liveIds.indexOf(game.gameId), n: liveIds.length }, { escHtml, prevHtml: glyphSpan('gv-step-i', 'chevronLeft'), nextHtml: glyphSpan('gv-step-i', 'chevronRight') }),
      matchup: `${ab(away)} @ ${ab(home)}`,
    };
  }
  /** DI-597 — a game's share: its reference, its allow-listed eyebrow and title line, and its thread (the message also appears there). Plain text; the chat body escapes it like any message. */
  function gameShareOf(game, phase, { sportLabel = '' } = {}) {
    const ref = validShareRef({ type: 'game', id: String(game.gameId || '') });
    if (!ref) return null;
    const p = phase && phase.phase;
    const scored = (p === 'final' || p === 'live' || p === 'live-stale') && numOrNull(game.awayScore) !== null && numOrNull(game.homeScore) !== null;
    const word = p === 'final' ? 'Final' : (p === 'live' || p === 'live-stale') ? 'Live' : (phase && isNonEmptyString(phase.label) ? phase.label : '');
    const eyebrow = [sportLabel, word, `${game.awayTeam} at ${game.homeTeam}`].filter(Boolean).join(' · ');
    const cover = scored ? NEUTRAL_COVER(game, phase) : '';
    const line = gameLineText(game);
    const title = scored ? `${game.awayTeam} ${numOrNull(game.awayScore)}, ${game.homeTeam} ${numOrNull(game.homeScore)}${cover ? ` — ${cover}` : ''}.` : (line ? `Line: ${line}` : '');
    return { ref, eyebrow, title, gameTag: String(game.gameId), line: shareLine({ eyebrow, title }) };
  }
  const gameUnavailable = () => gameUnavailableHTML({ escHtml });

  /** DI-572(a) — the Game view's IN-PLACE repaint (the pushed-screen `patch` hook): js/gameday-dom.js does the DOM work; this hands it the motion answer and the app's timer, and refuses while withheld. */
  function patchGameView(el, part) {
    if (withheld()) return false;
    return patchGameViewDom(el, part || {}, { reduced: prefersReducedMotion(), setTimer: d.setTimer || null });
  }

  /**
   * DI-591 / DI-593 — one Game view's announcer: the same timing rule as Game Day's (1 s debounce, 5 s throttle), speaking a cover flip or the game ending only while focus is inside THIS screen
   * (`getLevel()` is its pushed level). `observe(view)` takes each resolveGameView() result in turn; a different game (the stepper) starts over silently.
   */
  function gameViewAnnouncer(getLevel) {
    let last = null;
    const levelEl = () => { try { return getLevel(); } catch { return null; } };
    const ann = politeAnnouncer({
      setTimer: d.setTimer, clearTimer: d.clearTimer, now: () => d.now(), isHeld: () => false,
      canSpeak: () => { if (withheld()) return false; const lv = levelEl(); const a = typeof document !== 'undefined' && document ? document.activeElement : null; return !!(lv && a && typeof lv.contains === 'function' && lv.contains(a)); },
      write: (text) => { const lv = levelEl(); const r = lv && typeof lv.querySelector === 'function' ? lv.querySelector('[data-gv-live]') : null; if (r) r.textContent = text; },
    });
    return {
      observe(view) {
        const w = view && view.watch ? view.watch : null;
        if (!w || !last || last.gameId !== w.gameId) { if (last && w && last.gameId !== w.gameId) ann.cancel(); last = w; return; }
        const lines = gameViewAnnouncements(last, w);
        last = w;
        if (lines.length) ann.note(lines);
      },
      cancel() { ann.cancel(); last = null; },
    };
  }

  /** Test/diagnostic seam: what the reader's session holds right now (never rendered, never persisted). */
  const sessionForTest = () => ({ pages, heldCount, rendered: [...renderedOrdinary], marker: seen.marker, baseline: seen.baseline, visibleSince: seen.visibleSince, cardIds: [...currentCardIds], timeTick: tickTimer !== null });

  return {
    renderHome, refresh, bindActions, resetNews, resolveCardDetail, unavailableDetail, noteLeft, loadMore, _sessionForTest: sessionForTest,
    resolveGameView, shareTargets, _freshSnapshotCountForTest: () => freshBuilds, gameUnavailable, patchGameView, gameViewAnnouncer, revealCard, openGameDay, closeGameDay: () => setGameDayOpen(false), gameDayState: () => ({ expanded: gd.expanded, focusedGameId: gd.focusedGameId, expandable: gdCurrent.expandable, kind: gdCurrent.kind }),
    assembleSnapshot: (o) => assembleHomeSnapshot(d, o),
    _newsStateForTest: () => ({ ...news }),
  };
}
