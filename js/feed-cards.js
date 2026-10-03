/**
 * CFB Pickems — feed-cards.js (Social Platform v1 Home, DI-362 / DI-363, 2026-09-30)
 * ==================================================================================
 * The PURE card-derivation contract behind the Home feed. One entry point,
 * `deriveCards(snapshot, { viewerId, now })`, turns a snapshot of data that is
 * already loaded into an array of cards with STABLE ids. It never fetches, never
 * mutates its input, never writes (S-C8: a static test pins that no `save` /
 * `sendEvent` / adapter write is imported here), and it never answers "may this be
 * shown?" for itself. This module is the STRUCTURAL half of the blind rule for the
 * feed (UN-332); js/home.js (a later, serialized build) renders what it returns.
 *
 * ── THE THREE REVEAL CLASSES (S-C1) — what `requiresReveal` means ────────────────
 *   'never'        no pick content, ever. Safe at any week status.
 *   'after-reveal' `arePicksPublic(week)` ONLY. A GAME-SCOPED type under it
 *                  (`game.final`, `called.it`, `stood.alone`) ALSO requires THAT
 *                  game's own `status === 'final'`. This corrects the needs doc's
 *                  false "after-final is always a superset of after-reveal" claim:
 *                  a game can be final inside an OPEN week (RG-45) and a game can
 *                  still be live inside a revealed week, and neither may render.
 *   'after-final'  `arePicksPublic(week)` AND the week's SERVER-CONFIRMED status is
 *                  'final' (RG-253) — the whole week, not one game.
 * `isRevealed()` is the ONE function every candidate asks, and it asks
 * `arePicksPublic()` and nothing else. It NEVER calls `canViewOtherPicks()` — that
 * function's commissioner no-stake bypass exists for a deliberately-visited
 * verification screen, and must never reach a passively-scrolled feed (this file
 * does not import it; feedcardstest asserts the import list).
 *
 * ── SIX GUARDS, EACH INDEPENDENTLY LOAD-BEARING ──────────────────────────────────
 *   1. `isRevealed()` per candidate — and it runs BEFORE anything is built (S-C5):
 *      a rejected candidate never reaches the id builder, the facts builder, or any
 *      pick-derived computation. A card's id is as sensitive as the card.
 *   2. The REVEALED VIEW (S-C2): every cross-week aggregate reads only
 *      `snapshot.revealed*` — weeks that are public AND server-confirmed final.
 *      `buildRevealedView()` is where it is built, by the caller — and, since the
 *      2026-10-01 security review (C1), it is RE-APPLIED INSIDE `deriveCards()`
 *      over whatever `snapshot.revealed*` arrived, narrow-only: a caller that
 *      hands in an unfiltered view (a bug, a refactor, a "just pass everything")
 *      can no longer splice a hidden week's picks into a visible week's streak.
 *      The two layers are independent: neither alone is the guard.
 *   3. "Through week N" slicing: a week's aggregate is computed over weeks UP TO
 *      AND INCLUDING that week (`asOfWeekId`), so a later week can never move an
 *      earlier week's streak, rank or milestone.
 *   4. `picksReadConfirmed` (S-C10): a week can be public on THIS device before a
 *      hydrate has landed the other members' rows (RG-255). Any card whose facts
 *      depend on another member's pick also needs the snapshot's per-week flag.
 *      The viewer's OWN facts are exempt where they need no other member's data.
 *   5. Deny-by-default facts: `CARD_ALLOWED_FACTS` + notify-copy's
 *      `FORBIDDEN_META_KEYS` (the module-load scan and `assertMetaIsBlindSafe`).
 *   6. Demo weeks (UN-71) never produce cards unless the viewer is the commissioner;
 *      a week with no usable `weekNumber` produces none either (no "Week 's slate").
 *
 * ── THE SNAPSHOT CONTRACT (assembled by js/home.js, DI-366 — never read here) ────
 *   leagueId, players, weeks, games, picks            the unrestricted league data
 *   revealedWeeks / revealedGames / revealedPicks / revealedWeeklyResults
 *                                                     the S-C2 view (`buildRevealedView`)
 *   confirmedStatusFor(week) -> status|null           the SERVER-CONFIRMED status; absent => null => no after-final
 *   picksReadConfirmed { [weekId]: boolean }          S-C10; absent => false => no other-member card
 *   submissionCounts { [weekId]: {submittedCount,totalPlayers}|null }
 *                                                     null/absent = UNKNOWN, never zero (DI-T4.11)
 *   chatCandidates { scribe: [], lockerRoom: [] }     pre-selected by home.js (S-C8) — this
 *                                                     module re-applies the exclusions that
 *                                                     need no chat.js (deleted / private /
 *                                                     wager receipt / wrong league / author)
 *   currentWeekId, todayKey                           optional: `year.ago`'s week, and the
 *                                                     viewer-timezone date for `lockerroom.top`'s id
 *
 * ── COPY AND ESCAPING (S-C6) ─────────────────────────────────────────────────────
 * `cardCopy(card, { escHtml })` builds title/body ONLY from `card.facts`, and
 * REQUIRES an injected escaper: a missing or non-function `escHtml` THROWS
 * (js/leagues-home.js's `requireEscHtml` pattern) — there is deliberately no
 * `typeof escHtml === 'function' ? escHtml : String` fallback, because an escaper
 * that can silently degrade to `String()` is not an escaper.
 */

import { arePicksPublic } from './storage.js';
import { FORBIDDEN_META_KEYS, assertMetaIsBlindSafe } from './notify-copy.js';
import { calculateAtsWinner, evaluatePick, computeFirstKickoff } from './scoring.js';
import { weeksInGroup } from './data-model.js';
import { SEASON_2025 } from './history-2025.js';
import { orderedGradedResults, streakChange, loneWolfWinner, STREAK_MIN, MILESTONE_MARKS } from './stats-core.js';
import { memberSeasonStats, sortWeeks, isUpsetCalled, upsetLineLabel, outrightScoreLine, atsMarginOf, almaMaterResultForWeek } from './stats.js';

/** Freezes an object graph (security N1): an exported allow-list or map must not be editable at runtime. */
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ═══ the catalog ═════════════════════════════════════════════════════════════════

export const CARD_TYPES = Object.freeze([
  'slate.published', 'picks.submitted', 'week.revealed',
  'game.final', 'called.it', 'stood.alone',
  'week.result', 'player.week', 'rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached',
  'year.ago', 'scribe.post', 'lockerroom.top',
]);

/** Declared per TYPE, read from a frozen map, never computed ad hoc (DI-362). */
export const CARD_REVEAL_CLASS = Object.freeze({
  'slate.published':  'never',
  'picks.submitted':  'never',
  'week.revealed':    'never',
  'game.final':       'after-reveal',
  'called.it':        'after-reveal',
  'stood.alone':      'after-reveal',
  'week.result':      'after-final',
  'player.week':      'after-final',
  'rank.changed':     'after-final',
  'streak.extended':  'after-final',
  'streak.broken':    'after-final',
  'milestone.reached': 'after-final',
  'year.ago':         'never',
  'scribe.post':      'never',
  'lockerroom.top':   'never',
});

/**
 * Deny-by-default (UN-332's own structural requirement, mirroring notify-copy.js).
 * `margin` is a FORBIDDEN_META_KEYS entry and never appears here: `called.it` /
 * `game.final` carry PRE-FORMATTED display strings (`spreadDisplay`, `scoreLine`,
 * `marginCovered`) instead.
 *
 * THREE DOCUMENTED ADDITIONS to DI-362's literal list, all required by DI-363's own
 * caption-wiring table and none carrying a pick:
 *   - `rank.changed` gains `rankedCount` — the `intoLast` caption pool routes on
 *     "toRank is last place", which is unknowable from the ranks alone.
 *   - `year.ago` gains `name`, `record`, `weekN`, `superlative` — the table says the
 *     card's single `note` and the caption's placeholders "both derive from the SAME
 *     SEASON_2025.weeklyScores lookup", so the components must ride on the card.
 *   - `player.week` gains `almaMaterResult: { team, result:'win'|'loss' }` — the member's
 *     school's STRAIGHT-UP result that week (DI-362 AMENDMENT, approved inline by the
 *     coordinator 2026-10-01; security co-signs at the release review). Public, straight-up
 *     (never ATS), and only ever derived from the REVEALED view, so after-final only; the
 *     team is the GAME ROW's spelling, never the player's free text.
 * The whole map is DEEP-frozen (security N1) — an exported allow-list is not editable at runtime.
 */
export const CARD_ALLOWED_FACTS = deepFreeze({
  'slate.published':  ['weekN', 'gameCount', 'firstKickoff'],
  'picks.submitted':  ['weekN', 'submittedCount', 'totalPlayers'],
  'week.revealed':    ['weekN', 'submittedCount', 'totalPlayers'],
  // chips: [{playerId, initials, result}] — result is 'win'|'loss' ONLY, never a team name per player.
  'game.final':       ['awayTeam', 'homeTeam', 'awayScore', 'homeScore', 'atsWinnerTeam', 'marginCovered', 'chips'],
  'called.it':        ['playerId', 'playerName', 'team', 'matchup', 'spreadDisplay', 'scoreLine'],
  'stood.alone':      ['playerId', 'playerName', 'team', 'matchup', 'against'],
  'week.result':      ['weekN', 'weekWinnerName', 'weekWinnerRecord', 'weekLoserName', 'weekLoserRecord'],
  // almaMaterResult: { team, result } — result 'win'|'loss' ONLY (see NESTED_FACT_KEYS).
  'player.week':      ['playerId', 'playerName', 'weekN', 'wins', 'losses', 'streakRun', 'streakKind', 'almaMaterResult'],
  'rank.changed':     ['playerId', 'playerName', 'fromRank', 'toRank', 'weekN', 'rankedCount'],
  'streak.extended':  ['playerId', 'playerName', 'run', 'kind'],
  'streak.broken':    ['playerId', 'playerName', 'run', 'kind'],
  'milestone.reached': ['playerId', 'playerName', 'mark', 'total'],
  'year.ago':         ['note', 'name', 'record', 'weekN', 'superlative'],
  'scribe.post':      ['messageId', 'body', 'timestamp'],
  'lockerroom.top':   ['authorName', 'excerpt', 'reactionCount'],
});

/**
 * The per-item allow-list for the two STRUCTURED facts (security N2): a chip may carry only
 * `{playerId, initials, result}` and the alma-mater fact only `{team, result}`, `result` being
 * the closed set 'win'|'loss'. `finalizeFacts` rebuilds each item from these keys alone, so a
 * future builder cannot smuggle a team name or a pick into a chip.
 */
export const NESTED_FACT_KEYS = deepFreeze({
  'game.final': { chips: ['playerId', 'initials', 'result'] },
  'player.week': { almaMaterResult: ['team', 'result'] },
});
const CLOSED_RESULTS = Object.freeze(['win', 'loss']);

// Module-load-time deny-by-default scan — the same "fails the day a violation is
// written" shape as notify-copy.js's own. A forbidden key in any list is a bug at
// import time, not something a player ever sees.
for (const [type, keys] of Object.entries(CARD_ALLOWED_FACTS)) {
  for (const k of keys) {
    if (FORBIDDEN_META_KEYS.includes(k)) throw new Error(`[feed-cards] ${type} allow-lists forbidden key ${k}`);
  }
}

const REASON_SELF_OTHERS = deepFreeze({
  'called.it':         ['Your pick', 'In your league'],
  'stood.alone':       ['Your pick', 'In your league'],
  'player.week':       ['Your week', 'In your league'],
  'streak.extended':   ['Your streak', 'In your league'],
  'streak.broken':     ['Your streak', 'In your league'],
  'milestone.reached': ['Your milestone', 'In your league'],
});
const REASON_FIXED = Object.freeze({
  'slate.published': 'This week',
  'picks.submitted': 'This week',
  'week.revealed':   'This week',
  'game.final':      "In this week's slate",
  'week.result':     'In your league',
  'rank.changed':    'In your league',
  'year.ago':        'A year ago this week',
  'scribe.post':     'SCRIBE',
  'lockerroom.top':  'In the Locker Room',
});
/** Every reason label the catalog can produce (UN-329), for the deny-by-default test. */
export const CARD_REASON_LABELS = Object.freeze([...new Set([
  ...Object.values(REASON_FIXED), ...Object.values(REASON_SELF_OTHERS).flat(),
])]);

function reasonFor(type, isSelf) {
  if (REASON_SELF_OTHERS[type]) return REASON_SELF_OTHERS[type][isSelf ? 0 : 1];
  return REASON_FIXED[type] || '';
}

// ═══ small pure helpers ══════════════════════════════════════════════════════════

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
function toMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const ms = v ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}
function isoAt(ms, plus = 0) {
  const t = toMs(ms) + plus;
  return Number.isFinite(t) ? new Date(t).toISOString() : EPOCH_ISO;
}
const asArray = (v) => (Array.isArray(v) ? v : []);
const nz = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** "1st", "2nd", "3rd", "11th" … */
export function ordinal(n) {
  const v = Math.abs(Math.trunc(Number(n)));
  if (!Number.isFinite(v)) return '';
  const r100 = v % 100;
  if (r100 >= 11 && r100 <= 13) return `${v}th`;
  const r10 = v % 10;
  return `${v}${r10 === 1 ? 'st' : r10 === 2 ? 'nd' : r10 === 3 ? 'rd' : 'th'}`;
}

/** Singular streak word from the stored plural `kind`: covers -> cover, misses -> miss. */
export function streakWord(kind) {
  return kind === 'misses' ? 'miss' : 'cover';
}

/**
 * The injected escaper REQUIREMENT (S-C6 — js/leagues-home.js's `requireEscHtml`
 * pattern). Throws a TypeError rather than quietly rendering unescaped.
 */
export function requireEscHtml(escHtml, fnName = 'feed-cards') {
  if (typeof escHtml !== 'function') {
    throw new TypeError(`${fnName}() requires an injected escHtml function (CONVENTIONS #12, S-C6)`);
  }
  return escHtml;
}

/** Numbers cross the HTML boundary through a numeric-boundary helper, never raw
 *  string interpolation (DI-367). Non-finite -> '' (absent beats wrong). */
function numStr(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

/** "9–1" — an en dash, as the catalog's own copy has it. */
const dashPair = (a, b) => `${numStr(a)}–${numStr(b)}`;

/** Truncate FIRST (by code points, so a surrogate pair is never sliced), escape
 *  AFTER (S-C6 — an escape entity is never cut mid-token). Plain text only. */
export function truncateExcerpt(text, max = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : flat;
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// ═══ the reveal gate ═════════════════════════════════════════════════════════════

/**
 * The ONE function every candidate asks (S-C1). Called with a lightweight
 * DESCRIPTOR (`{ type, requiresReveal, gameId }`) — never with a built card, because
 * nothing is built until this returns true (S-C5).
 *
 * @param {{requiresReveal:string, gameId?:string|null}} card
 * @param {{week:object, game?:object|null, confirmedWeekStatus?:string|null, viewerId?:string|null, now?:number}} ctx
 */
export function isRevealed(card, { week, game = null, confirmedWeekStatus = null, viewerId = null, now = Date.now() } = {}) {
  void viewerId; void now; // part of the contract (and of mutation seams); the gate itself never keys on the viewer
  if (!card) return false;
  if (card.requiresReveal === 'never') return true;
  if (card.requiresReveal === 'after-reveal') {
    if (!week) return false;
    const revealed = arePicksPublic(week); // js/storage.js — the ONE function every gate asks; NEVER canViewOtherPicks()
    if (!revealed) return false;
    // Game-scoped types ALSO require THEIR OWN game to be final: the reveal being
    // true only means the WEEK is public; it says nothing about any one game inside
    // it. (RG-45 — a final game can sit in an OPEN week; and the symmetric case, a
    // still-live game in a revealed week, must not render this type either.)
    if (card.gameId) {
      if (!game || game.status !== 'final') return false;
      if (game.weekId !== week.weekId) return false; // a game from another week is not THIS week's game
      return true;
    }
    return true;
  }
  if (card.requiresReveal === 'after-final') {
    if (!week) return false;
    // The WHOLE WEEK must be finalized per the SERVER-CONFIRMED status (RG-253) —
    // never the local mirror's optimistic value. `confirmedWeekStatus` is resolved
    // once, by the snapshot assembler; this function does not re-derive it.
    return arePicksPublic(week) && confirmedWeekStatus === 'final';
  }
  return false; // deny-by-default — an unknown or missing requiresReveal never renders
}

/**
 * The S-C2 revealed view — built ONCE, here, so `home.js` and the tests share one
 * implementation of it: weeks that are public AND server-confirmed final. Standings
 * parity (`seasonStandingsRows()`): a week hidden from history, and a demo week
 * (UN-71), contribute to nothing unless `includeDemo`.
 */
export function buildRevealedView({ weeks = [], games = [], picks = [], weeklyResults = [], confirmedStatusFor = null, includeDemo = false } = {}) {
  const confirmed = (w) => { try { return typeof confirmedStatusFor === 'function' ? confirmedStatusFor(w) : null; } catch { return null; } };
  const revealedWeeks = asArray(weeks).filter(w => {
    if (!w) return false;
    if (!includeDemo && w.dataSourceMode === 'demo') return false;
    if (w.showInHistory === false) return false;
    return arePicksPublic(w) && confirmed(w) === 'final';
  });
  const ids = new Set(revealedWeeks.map(w => w.weekId));
  return {
    revealedWeeks,
    revealedGames: asArray(games).filter(g => g && ids.has(g.weekId)),
    revealedPicks: asArray(picks).filter(p => p && ids.has(p.weekId)),
    revealedWeeklyResults: asArray(weeklyResults).filter(r => r && ids.has(r.weekId)),
  };
}

// ═══ ids and facts ═══════════════════════════════════════════════════════════════

/**
 * UN-330's id: `${type}:${leagueId}:${weekId ?? '-'}:${memberId ?? '-'}${suffix ? ':' + suffix : ''}`.
 * The trailing slot is DI-362's `gameId` slot, generalized to the one discriminator
 * a type needs to stay unique (a game id for the game-scoped types, a message id for
 * `scribe.post`, the mark for `milestone.reached`, a date for `lockerroom.top`,
 * '2025' for `year.ago`). It equals the future v2 `activities.dedupe_key`, and is
 * safe to log, cache or persist ONLY once attached to a card that already passed
 * `isRevealed()` (S-C5) — which is why it is built after the gate and never before.
 */
function buildCardId({ type, leagueId, weekId = null, memberId = null, suffix = null }) {
  return `${type}:${leagueId ?? '-'}:${weekId ?? '-'}:${memberId ?? '-'}${suffix ? ':' + suffix : ''}`;
}

/** Walks a facts value and refuses a forbidden key at ANY depth (the `chips` array
 *  and any future structured fact), where `assertMetaIsBlindSafe` sees only the top. */
function assertDeepBlindSafe(value) {
  if (Array.isArray(value)) { value.forEach(assertDeepBlindSafe); return; }
  if (value && typeof value === 'object') {
    assertMetaIsBlindSafe(value);
    for (const v of Object.values(value)) assertDeepBlindSafe(v);
  }
}

/**
 * Every card-building helper passes its facts through here before a card is pushed:
 * forbidden keys THROW (a caller offering one is a bug to fix, not paper over —
 * notify-copy's contract), then any key outside that type's own allow-list is
 * DROPPED so it can never reach the object. `undefined`/`null` values are omitted
 * (the copy template reads "absent" as "fact not supplied", never as a blank).
 */
export function finalizeFacts(type, facts) {
  const allowed = CARD_ALLOWED_FACTS[type];
  if (!allowed) throw new Error(`[feed-cards] no allow-list for card type ${type}`);
  assertDeepBlindSafe(facts);
  const out = {};
  for (const k of allowed) {
    if (facts && Object.prototype.hasOwnProperty.call(facts, k) && facts[k] !== undefined && facts[k] !== null) out[k] = facts[k];
  }
  // The two structured facts are rebuilt item by item from their per-item allow-list (security N2);
  // an item that is not an object, or whose `result` is outside the closed set, is dropped.
  const nested = NESTED_FACT_KEYS[type] || {};
  for (const [k, itemKeys] of Object.entries(nested)) {
    if (!(k in out)) continue;
    const clean = (item) => {
      if (!item || typeof item !== 'object' || !CLOSED_RESULTS.includes(item.result)) return null;
      const c = {};
      for (const ik of itemKeys) if (item[ik] !== undefined && item[ik] !== null) c[ik] = item[ik];
      return c;
    };
    if (Array.isArray(out[k])) out[k] = out[k].map(clean).filter(Boolean);
    else { const c = clean(out[k]); if (c) out[k] = c; else delete out[k]; }
  }
  return out;
}

/** Test seam: `_internals.buildCardId` is what the builders call, so a spy proves a
 *  rejected candidate never reaches id construction (S-C5, DI-362 test 7). */
export const _internals = { buildCardId, finalizeFacts };

// ═══ chat candidates (S-C8 / S-C11 / note c) ═════════════════════════════════════

/** Wager receipts are SCRIBE-authored messages carrying user-typed claim text
 *  (SD-6: obligations/wagers never on Home). Identified by `meta.kind`; a future
 *  obligation-chat-post kind must be ADDED here, not assumed covered. */
export const WAGER_RECEIPT_KINDS = Object.freeze(['wagerLogged', 'wagerDue']);   // frozen (security N1): a Set cannot be, so a frozen array
export function isWagerReceipt(m) {
  if (!m || typeof m !== 'object') return false;
  const kind = (m.meta && typeof m.meta === 'object') ? m.meta.kind : m.metaKind;
  return WAGER_RECEIPT_KINDS.includes(kind);
}

// The two PRIVATE row shapes this app actually produces (js/chat.js's isPrivateSelfTest /
// isPrivateScribeChangelog): both are `author:'system'` rows, which is why the author filters in
// `deriveCards` already drop them; these signatures are the SECOND, independent line — they hold even
// if a row arrives with a mis-stamped author. They deliberately do NOT use a bare `sys_` prefix:
// PUBLIC SCRIBE posts carry `sys_whatsnew_` / `sys_lc_` ids and must keep rendering.
const SELF_TEST_ID_RE = /^sys_test_[0-9a-f]{32}$/;
const PRIVATE_CHANGELOG_ID_RE = /^sys_scribe_changelog_.+__private$/;
function looksLikePrivateRow(c) {
  const id = String(c.id ?? c.messageId ?? '');
  const meta = (c.meta && typeof c.meta === 'object') ? c.meta : {};
  return SELF_TEST_ID_RE.test(id) || PRIVATE_CHANGELOG_ID_RE.test(id)
    || meta.test === true || (meta.kind === 'scribeChangelog' && !!meta.playerId);
}

function countReactions(c) {
  if (Number.isFinite(Number(c.reactionCount))) return Math.max(0, Math.trunc(Number(c.reactionCount)));
  const r = c.reactions;
  if (Array.isArray(r)) return r.length;
  if (r && typeof r === 'object') return Object.values(r).reduce((s, v) => s + (Array.isArray(v) ? v.length : Number(v) || 0), 0);
  return 0;
}

/**
 * The exclusions that need NO chat.js, re-applied here as defense in depth behind
 * home.js's `isPrivateRow()` pre-filter. Returns a clean, minimal object or `null`; a
 * candidate is never trusted wholesale — only the fields a card needs survive.
 *
 * HOW THE PRIVATE-ROW EXCLUSIONS ACTUALLY WORK (corrected 2026-10-01, reviewer note 6): the
 * client NEVER receives `visible_to` — RLS scopes a private row to its one recipient and the
 * folded message carries no such field — so a `visibleTo` test alone would be vacuous against
 * real data (it stays only for a candidate shape that does carry one). Against real rows the
 * work is done by (1) the AUTHOR filters in `deriveCards` — both real private shapes (the push
 * self-test and the SCRIBE changelog) are `author:'system'`, which `scribe.post` (requires
 * 'scribe') and `lockerroom.top` (rejects 'system'/'scribe') never accept — and (2) the id/meta
 * signatures in `looksLikePrivateRow`, which hold even if an author is mis-stamped. The rest:
 * a deleted row, a wager receipt, a row stamped with a DIFFERENT league (S-C11), and a row
 * with no id or no text.
 */
function cleanCandidate(c, leagueId) {
  if (!c || typeof c !== 'object') return null;
  if (c.deleted) return null;
  if (c.private === true || c.visibleTo || c.visible_to) return null;
  if (looksLikePrivateRow(c)) return null;
  if (isWagerReceipt(c)) return null;
  if (c.leagueId !== undefined && c.leagueId !== null && c.leagueId !== leagueId) return null;
  const id = String(c.id ?? c.messageId ?? '');
  const body = typeof c.body === 'string' ? c.body : '';
  if (!id || !body.trim()) return null;
  return { id, ts: toMs(c.ts), author: String(c.author ?? ''), authorName: c.authorName == null ? '' : String(c.authorName), body, reactionCount: countReactions(c) };
}

// ═══ 2025 history (year.ago) ═════════════════════════════════════════════════════

// A week the dataset has no column for yields NO card (never a broken one).
//
// SB-22 (2026-10-01) — the record's denominator is the week's REAL slate size, or none.
// This used to divide every week by a hard-coded 10, inferred from "Unanimous games —
// only 21% (30 of 140)" as 14 weeks x 10; Drew, 2026-10-01: not every 2025 week had
// exactly 10 games. The dataset states a week's slate size in one form only — a
// superlative's own "x/y (Week n)" (today: "Kevin & Koby — 9/10 (Week 13)") — so that is
// the only source. A week it doesn't cover prints its raw count ("7 correct"). A size two
// sources disagree on, or one below the week's own top score, is unknown, not believed.
const SLATE_SIZE_BY_WEEK_2025 = (() => {
  const out = {};
  for (const s of SEASON_2025.superlatives || []) {
    const m = s && /(\d+)\/(\d+) \(Week (\d+)\)/.exec(String(s.value || ''));
    if (!m) continue;
    const wk = Number(m[3]), size = Number(m[2]);
    out[wk] = (wk in out && out[wk] !== size) ? null : size;
  }
  return out;
})();
const SUPERLATIVE_BY_WEEK = (() => {
  const out = {};
  const best = (SEASON_2025.superlatives || []).find(s => s && s.label === 'Best week');
  const m = best && /\(Week (\d+)\)/.exec(String(best.value || ''));
  if (m) out[Number(m[1])] = 'the best week on record';
  return out;
})();

function yearAgoFor(weekNumber) {
  const idx = Number(weekNumber) - 1;
  if (!Number.isInteger(idx) || idx < 0) return null;
  const entries = Object.entries(SEASON_2025.weeklyScores || {})
    .map(([name, arr]) => [name, Array.isArray(arr) ? arr[idx] : undefined])
    .filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, v]) => v));
  const name = joinNames(entries.filter(([, v]) => v === max).map(([n]) => n));
  const size = SLATE_SIZE_BY_WEEK_2025[Number(weekNumber)];
  const record = Number.isInteger(size) && size > 0 && size >= max ? `${max}/${size}` : `${max} correct`;
  // The superlative is only claimed when the dataset's own text agrees with what was just computed.
  const sup = SUPERLATIVE_BY_WEEK[Number(weekNumber)] || null;
  const best = (SEASON_2025.superlatives || []).find(s => s && s.label === 'Best week');
  const superlative = sup && best && String(best.value).startsWith(`${name} — ${record}`) ? sup : null;
  return { name, record, weekN: Number(weekNumber), superlative };
}

// ═══ deriveCards ═════════════════════════════════════════════════════════════════

function normalizeSnapshot(snapshot) {
  const s = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  const cc = (s.chatCandidates && typeof s.chatCandidates === 'object') ? s.chatCandidates : {};
  return {
    leagueId: s.leagueId ?? null,
    players: asArray(s.players), weeks: asArray(s.weeks), games: asArray(s.games), picks: asArray(s.picks),
    revealedWeeks: asArray(s.revealedWeeks), revealedGames: asArray(s.revealedGames),
    revealedPicks: asArray(s.revealedPicks), revealedWeeklyResults: asArray(s.revealedWeeklyResults),
    tieContexts: s.tieContexts instanceof Map ? s.tieContexts : null,   // SP-54 (HOME_WIRING_CHECKLIST item 21): groupId -> TieContext, already restricted to revealed groups by home.js
    confirmedStatusFor: typeof s.confirmedStatusFor === 'function' ? s.confirmedStatusFor : () => null,
    picksReadConfirmed: (s.picksReadConfirmed && typeof s.picksReadConfirmed === 'object') ? s.picksReadConfirmed : {},
    submissionCounts: (s.submissionCounts && typeof s.submissionCounts === 'object') ? s.submissionCounts : {},
    chatScribe: asArray(cc.scribe), chatLockerRoom: asArray(cc.lockerRoom),
    currentWeekId: s.currentWeekId ?? null, todayKey: typeof s.todayKey === 'string' ? s.todayKey : null,
  };
}

/**
 * @param {object} snapshot  see the module header
 * @param {{viewerId?:string|null, now?:number, viewerIsCommissioner?:boolean, isContentWithheld?:Function}} opts
 *        `isContentWithheld` is OPTIONAL and injected (app.js owns it; the pure module
 *        cannot import it). When supplied, a truthy answer — or a throw, or a
 *        non-function — yields NO cards at all: the fail-closed direction (S-C7's
 *        belt behind home.js's own paint-time check, which stays the primary gate).
 * @returns {Array<object>} cards, newest first by `sortKey` then id — deterministic
 */
export function deriveCards(snapshot, opts = {}) {
  const { viewerId = null, now = Date.now(), viewerIsCommissioner = false, isContentWithheld } = opts || {};
  if (isContentWithheld !== undefined) {
    let withheld = true; // unknown => withheld
    try { withheld = typeof isContentWithheld === 'function' ? !!isContentWithheld() : true; } catch { withheld = true; }
    if (withheld) return [];
  }
  const s = normalizeSnapshot(snapshot);
  const cards = [];

  // A week with no usable weekNumber is malformed: it produces no card at all (never "Week 's slate is up"),
  // and it cannot sit in the revealed view either (it would sort as week 0 and move everyone's streaks).
  const hasWeekN = (w) => !!w && w.weekNumber !== null && w.weekNumber !== undefined
    && String(w.weekNumber).trim() !== '' && Number.isFinite(Number(w.weekNumber));

  // C1 (security, 2026-10-01) — THE S-C2 VIEW IS RE-APPLIED HERE, NARROW-ONLY. `snapshot.revealed*` is the
  // CALLER's claim about what is revealed; this module does not take it on trust. Re-running
  // buildRevealedView over it keeps only weeks that are public (arePicksPublic) AND server-confirmed final
  // (`s.confirmedStatusFor`; absent => null => nothing), and restricts games / picks / results to those weeks.
  // It can only REMOVE: an honest view passes through unchanged, an unfiltered one is cut back to the truth.
  // `includeDemo:true` leaves the demo decision to `keepWeek` below (the commissioner exception lives there).
  const rv = buildRevealedView({ weeks: s.revealedWeeks.filter(hasWeekN), games: s.revealedGames, picks: s.revealedPicks, weeklyResults: s.revealedWeeklyResults, confirmedStatusFor: s.confirmedStatusFor, includeDemo: true });
  s.revealedWeeks = rv.revealedWeeks; s.revealedGames = rv.revealedGames; s.revealedPicks = rv.revealedPicks; s.revealedWeeklyResults = rv.revealedWeeklyResults;

  // ── who ── (truthy `active`, exactly as Standings filters: app.js `getPlayers().filter(p => p.active)`)
  const activePlayers = s.players.filter(p => p && p.active);
  const playerById = new Map(s.players.filter(Boolean).map(p => [p.playerId, p]));
  const nameOf = (id) => { const p = playerById.get(id); return p && p.displayName ? String(p.displayName) : null; };
  const initialsOf = (id) => {
    const p = playerById.get(id);
    if (!p) return '';
    return String(p.initials || String(p.displayName || '').trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase()).slice(0, 3);
  };

  // ── per-render helpers ──
  const confirmedFor = (week) => { try { return s.confirmedStatusFor(week) ?? null; } catch { return null; } };
  const keepWeek = (w) => hasWeekN(w) && (viewerIsCommissioner || w.dataSourceMode !== 'demo');
  const gate = (type, week, game = null) => isRevealed(
    { type, requiresReveal: CARD_REVEAL_CLASS[type], gameId: game ? game.gameId : null },
    { week, game, confirmedWeekStatus: confirmedFor(week), viewerId, now },
  );
  // S-C10 — other-members'-picks confirmation. `selfExempt` is true only for a fact that
  // needs NO other member's data (their own pick; their own week/streak/milestone).
  const othersConfirmed = (week, { memberId = null, selfExempt = false } = {}) => {
    if (selfExempt && viewerId && memberId === viewerId) return true;
    return s.picksReadConfirmed[week.weekId] === true;
  };
  const push = (type, week, { memberId = null, suffix = null, facts, sortKey }) => {
    const finalFacts = _internals.finalizeFacts(type, facts);
    cards.push({
      id: _internals.buildCardId({ type, leagueId: s.leagueId, weekId: week ? week.weekId : null, memberId, suffix }),
      type,
      sport: week ? String(week.sport || 'cfb') : null, // createWeek() never sets .sport; the column defaults 'cfb' (js/competition.js)
      leagueId: s.leagueId,
      weekId: week ? week.weekId : null,
      memberId,
      gameId: type === 'game.final' || type === 'called.it' || type === 'stood.alone' ? suffix : null,
      requiresReveal: CARD_REVEAL_CLASS[type],
      facts: finalFacts,
      reason: reasonFor(type, !!viewerId && memberId === viewerId),
      sortKey,
    });
  };

  const allWeeks = sortWeeks(s.weeks).filter(keepWeek);
  const revealedSorted = sortWeeks(s.revealedWeeks).filter(keepWeek);
  const gamesOf = (weekId) => s.games.filter(g => g && g.weekId === weekId);

  // ═══ never-class cards — counts and announcements, no selections ═══
  for (const W of allWeeks) {
    const st = confirmedFor(W) || W.status;
    const wGames = gamesOf(W.weekId);
    const first = computeFirstKickoff(wGames);
    const counts = s.submissionCounts[W.weekId];
    const countsKnown = !!counts && Number.isFinite(Number(counts.submittedCount)) && Number.isFinite(Number(counts.totalPlayers));

    if (gate('slate.published', W) && st !== 'draft' && wGames.length > 0) {
      push('slate.published', W, {
        facts: { weekN: W.weekNumber, gameCount: wGames.length, firstKickoff: first ? first.toISOString() : null },
        sortKey: isoAt(toMs(W.picksOpenAt) || toMs(W.createdAt) || (first ? first.getTime() : 0)),
      });
    }
    if (gate('picks.submitted', W) && st === 'open' && countsKnown) {
      push('picks.submitted', W, {
        facts: { weekN: W.weekNumber, submittedCount: nz(counts.submittedCount), totalPlayers: nz(counts.totalPlayers) },
        sortKey: isoAt(now),
      });
    }
    // week.revealed keys on arePicksPublic() directly (revealed_at is never client-projected,
    // js/supabase-backend.js) and lives for the whole LIVE window, re-derived each render.
    if (gate('week.revealed', W) && arePicksPublic(W) && st !== 'final') {
      push('week.revealed', W, {
        facts: { weekN: W.weekNumber, ...(countsKnown ? { submittedCount: nz(counts.submittedCount), totalPlayers: nz(counts.totalPlayers) } : {}) },
        sortKey: isoAt(now),
      });
    }
  }

  // ═══ after-reveal, game-scoped: game.final / called.it / stood.alone ═══
  // Per GAME, per TYPE: the gate runs first, and a game's picks are not even READ until a gate has passed
  // (`picksOf()` is called only inside a passed gate) — S-C5. What is computed before a gate is the game's own
  // public row data (score line, matchup text, timestamps), never a pick.
  for (const W of allWeeks) {
    for (const g of gamesOf(W.weekId)) {
      const base = toMs(g.lastUpdated) || toMs(g.updatedAt) || toMs(g.kickoff);
      const matchup = `${g.awayTeam} at ${g.homeTeam}`;
      const picksOf = () => s.picks.filter(p => p && p.gameId === g.gameId);

      if (gate('game.final', W, g) && othersConfirmed(W)) {
        const ats = (g.atsWinner !== undefined && g.atsWinner !== null) ? g.atsWinner : calculateAtsWinner(g);
        const covered = ats && ats !== 'no_decision';
        const margin = covered ? atsMarginOf(g) : null;
        const chips = [];
        for (const p of picksOf()) {
          const r = evaluatePick(p, g);
          if (r !== 'win' && r !== 'loss') continue;       // 'win'|'loss' ONLY — a push has no chip
          if (!nameOf(p.playerId)) continue;
          chips.push({ playerId: p.playerId, initials: initialsOf(p.playerId), result: r });
        }
        chips.sort((a, b) => String(a.playerId).localeCompare(String(b.playerId)));
        push('game.final', W, {
          suffix: g.gameId,
          facts: {
            awayTeam: g.awayTeam, homeTeam: g.homeTeam, awayScore: g.awayScore, homeScore: g.homeScore,
            atsWinnerTeam: covered ? ats : null,
            marginCovered: margin === null ? null : String(Number(margin.toFixed(1))),
            chips,
          },
          sortKey: isoAt(base),
        });
      }

      if (gate('called.it', W, g)) {
        for (const p of picksOf()) {
          if (!othersConfirmed(W, { memberId: p.playerId, selfExempt: true })) continue;
          const nm = nameOf(p.playerId);
          if (!nm || !isUpsetCalled(p, g)) continue;
          push('called.it', W, {
            memberId: p.playerId, suffix: g.gameId,
            facts: { playerId: p.playerId, playerName: nm, team: p.selectedTeam, matchup, spreadDisplay: upsetLineLabel(g), scoreLine: outrightScoreLine(g) },
            sortKey: isoAt(base, 2),
          });
        }
      }

      if (gate('stood.alone', W, g) && othersConfirmed(W)) {
        const wolf = loneWolfWinner(g, picksOf(), { calculateAtsWinner });
        const nm = wolf ? nameOf(wolf.playerId) : null;
        if (wolf && nm) {
          push('stood.alone', W, {
            memberId: wolf.playerId, suffix: g.gameId,
            facts: { playerId: wolf.playerId, playerName: nm, team: wolf.team, matchup, against: wolf.against },
            sortKey: isoAt(base, 1),
          });
        }
      }
    }
  }

  // ═══ after-final aggregates — the revealed view ONLY (S-C2), through each week (guard 3) ═══
  const view = {
    players: activePlayers, revealedWeeks: s.revealedWeeks, revealedGames: s.revealedGames,
    revealedPicks: s.revealedPicks, revealedWeeklyResults: s.revealedWeeklyResults, allWeeks: s.weeks,
    tieContexts: s.tieContexts || null,   // SP-54 (checklist item 21): the Standings page's own group tie contexts, restricted to revealed groups by home.js
  };
  const statsMemo = new Map();
  const statsAt = (memberId, W) => {
    const k = `${memberId}|${W.weekId}`;
    if (!statsMemo.has(k)) statsMemo.set(k, memberSeasonStats(memberId, { ...view, season: W.season, asOfWeekId: W.weekId }));
    return statsMemo.get(k);
  };
  const sameSeasonBefore = (W) => {
    const same = revealedSorted.filter(w => String(w.season) === String(W.season));
    const i = same.findIndex(w => w.weekId === W.weekId);
    return i > 0 ? same[i - 1] : null;
  };
  const throughWeek = (W) => {
    const same = revealedSorted.filter(w => String(w.season) === String(W.season));
    const i = same.findIndex(w => w.weekId === W.weekId);
    const weeks = i < 0 ? [] : same.slice(0, i + 1);
    const ids = new Set(weeks.map(w => w.weekId));
    return { weeks, games: s.revealedGames.filter(g => g && ids.has(g.weekId)), picks: s.revealedPicks.filter(p => p && ids.has(p.weekId)) };
  };

  for (const W of revealedSorted) {
    const rowsW = s.revealedWeeklyResults.filter(r => r && r.weekId === W.weekId);
    const wGames = s.revealedGames.filter(g => g && g.weekId === W.weekId);
    const lastGameMs = wGames.reduce((m, g) => Math.max(m, toMs(g.lastUpdated) || toMs(g.updatedAt) || toMs(g.kickoff)), 0);
    const endMs = toMs(W.finalizedAt) || lastGameMs;
    const prevW = sameSeasonBefore(W);
    const rec = (r) => dashPair(r.correctCount ?? r.correctPicks ?? 0, r.incorrectCount ?? r.incorrectPicks ?? 0);

    // week.result — a multi-part (grouped) competitive week has its winner POOLED across the group, which
    // a single record's own isWinner flag cannot state, so no winner is claimed for it.
    if (gate('week.result', W) && weeksInGroup(s.weeks, W).length <= 1) {
      const winner = rowsW.find(r => r.isWinner);
      const loser = rowsW.find(r => r.isLoser);
      const wn = winner && (nameOf(winner.playerId) || winner.displayName);
      const ln = loser && (nameOf(loser.playerId) || loser.displayName);
      if (winner && loser && winner.playerId !== loser.playerId && wn && ln) {
        push('week.result', W, {
          facts: { weekN: W.weekNumber, weekWinnerName: String(wn), weekWinnerRecord: rec(winner), weekLoserName: String(ln), weekLoserRecord: rec(loser) },
          sortKey: isoAt(endMs, 6),
        });
      }
    }

    // player.week — one per player who played the week.
    if (gate('player.week', W)) {
      for (const p of activePlayers) {
        const row = rowsW.find(r => r.playerId === p.playerId);
        const nm = nameOf(p.playerId);
        if (!row || !nm || !othersConfirmed(W, { memberId: p.playerId, selfExempt: true })) continue;
        const wins = nz(row.correctCount ?? row.correctPicks ?? 0), losses = nz(row.incorrectCount ?? row.incorrectPicks ?? 0);
        if (wins + losses === 0) continue;
        const st = statsAt(p.playerId, W).currentStreak;
        // The member's school's STRAIGHT-UP result this week — from the REVEALED view's games only (after-final).
        const alma = almaMaterResultForWeek(p.almaMater, W.weekId, wGames);
        push('player.week', W, {
          memberId: p.playerId,
          facts: {
            playerId: p.playerId, playerName: nm, weekN: W.weekNumber, wins, losses,
            ...(st.state === 'active' ? { streakRun: st.run, streakKind: st.kind } : {}),
            ...(alma ? { almaMaterResult: alma } : {}),
          },
          sortKey: isoAt(endMs, 2),
        });
      }
    }

    // rank.changed — before/after over the revealed view; needs a previous week to move FROM.
    if (prevW && gate('rank.changed', W) && othersConfirmed(W)) {
      for (const p of activePlayers) {
        const nm = nameOf(p.playerId);
        const from = statsAt(p.playerId, prevW).currentRank;
        const to = statsAt(p.playerId, W).currentRank;
        if (!nm || from === null || to === null || from === to) continue;
        push('rank.changed', W, {
          memberId: p.playerId,
          facts: { playerId: p.playerId, playerName: nm, fromRank: from, toRank: to, weekN: W.weekNumber, rankedCount: activePlayers.length },
          sortKey: isoAt(endMs, 5),
        });
      }
    }

    // streak.extended / streak.broken — the SCRIBE detector's own rule, via stats-core, through THIS week.
    if (gate('streak.extended', W)) {
      const tw = throughWeek(W);
      for (const p of activePlayers) {
        const nm = nameOf(p.playerId);
        if (!nm || !othersConfirmed(W, { memberId: p.playerId, selfExempt: true })) continue;
        const ordered = orderedGradedResults(p.playerId, tw.games, tw.picks, tw.weeks);
        // The feed asks only about a player with a GRADED result this week (SCRIBE asks about every player who made a pick);
        // the RULE itself is the one SCRIBE's detector calls — stats-core's streakChange() (reviewer note 4).
        if (!ordered.results.some(r => r.weekId === W.weekId)) continue;
        const ch = streakChange(ordered, W.weekId);
        if (!ch) continue;
        if (ch.state === 'active') {
          push('streak.extended', W, {
            memberId: p.playerId, facts: { playerId: p.playerId, playerName: nm, run: ch.run, kind: ch.kind },
            sortKey: isoAt(endMs, 3),
          });
        } else if (ch.state === 'broken' && gate('streak.broken', W)) {
          push('streak.broken', W, {
            memberId: p.playerId, facts: { playerId: p.playerId, playerName: nm, run: ch.run, kind: ch.kind },
            sortKey: isoAt(endMs, 3),
          });
        }
      }
    }

    // milestone.reached — a MILESTONE_MARKS crossing this week, RAW correct counts.
    if (gate('milestone.reached', W)) {
      for (const p of activePlayers) {
        const nm = nameOf(p.playerId);
        if (!nm || !othersConfirmed(W, { memberId: p.playerId, selfExempt: true })) continue;
        const after = statsAt(p.playerId, W).record.wins;
        const before = prevW ? statsAt(p.playerId, prevW).record.wins : 0;
        for (const mark of MILESTONE_MARKS) {
          if (before < mark && after >= mark) {
            push('milestone.reached', W, {
              memberId: p.playerId, suffix: String(mark),
              facts: { playerId: p.playerId, playerName: nm, mark, total: after },
              sortKey: isoAt(endMs, 4),
            });
          }
        }
      }
    }
  }

  // ═══ year.ago — closed, already-public 2025 history ═══
  {
    const candidates = allWeeks.filter(w => (confirmedFor(w) || w.status) !== 'draft');
    const cur = (s.currentWeekId && candidates.find(w => w.weekId === s.currentWeekId)) || candidates[candidates.length - 1] || null;
    const ya = cur && gate('year.ago', cur) ? yearAgoFor(cur.weekNumber) : null;
    if (cur && ya) {
      const tail = ya.superlative ? ` — ${ya.superlative}` : ` — the league's best that week`;
      push('year.ago', cur, {
        suffix: '2025',
        // SB-22 scribe copy pass (2026-10-01, coordinator-approved): "had", not "went" — the record is
        // "9/10" OR "7 correct" now, and "went 7 correct" doesn't read; matches the year.ago caption pools.
        facts: { note: `A year ago this week, ${ya.name} had ${ya.record}${tail}.`, name: ya.name, record: ya.record, weekN: ya.weekN, superlative: ya.superlative },
        sortKey: isoAt(now, -1),
      });
    }
  }

  // ═══ chat-derived cards — pre-selected by home.js (S-C8); exclusions re-applied here ═══
  if (gate('scribe.post', null)) {
    for (const raw of s.chatScribe) {
      const c = cleanCandidate(raw, s.leagueId);
      if (!c || c.author !== 'scribe') continue;
      push('scribe.post', null, { suffix: c.id, facts: { messageId: c.id, body: c.body, timestamp: isoAt(c.ts) }, sortKey: isoAt(c.ts) });
    }
  }
  if (gate('lockerroom.top', null)) {
    const pool = s.chatLockerRoom.map(r => cleanCandidate(r, s.leagueId))
      .filter(c => c && c.author !== 'scribe' && c.author !== 'system' && c.reactionCount > 0);
    pool.sort((a, b) => (b.reactionCount - a.reactionCount) || (a.ts - b.ts) || a.id.localeCompare(b.id));
    const top = pool[0];
    if (top) {
      const dayKey = s.todayKey || isoAt(now).slice(0, 10);
      push('lockerroom.top', null, {
        suffix: dayKey,
        // C3 (security, 2026-10-01): the ROSTER name comes first. A chat row's own `authorName` is a free field the
        // sender chose, so it can say "Kihoon" on Brayden's message; the id-resolved roster name cannot be spoofed
        // that way. The row's label is only the fallback for an author the roster does not know.
        facts: { authorName: nameOf(top.author) || top.authorName || 'Someone', excerpt: truncateExcerpt(top.body, 120), reactionCount: top.reactionCount },
        sortKey: isoAt(top.ts),
      });
    }
  }

  // Newest first, id as the deterministic tiebreak — the same snapshot yields the same array, always.
  cards.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return cards;
}

// ═══ copy (title / body) — built ONLY from card.facts, escaped through the injected escaper ═══

const WEEK_N_TYPES = Object.freeze(['slate.published', 'picks.submitted', 'week.revealed', 'week.result', 'player.week', 'rank.changed']);

/**
 * @param {object} card   a card from deriveCards()
 * @param {{escHtml:Function, formatKickoff?:Function}} deps
 *        `escHtml` is REQUIRED — a missing or non-function value throws (S-C6).
 *        `formatKickoff(iso)` is the render-time, timezone-aware formatter
 *        (CONVENTIONS #19: times are ISO in storage); it defaults to the ISO string.
 * @returns {{title:string, body:string, chips:Array<{initialsHtml:string, result:string}>}}
 *          title/body are ESCAPED HTML strings; chips carry an escaped `initialsHtml`
 *          and a closed `result` ('win'|'loss' — the renderer maps it to .badge-win/.badge-loss).
 */
export function cardCopy(card, { escHtml, formatKickoff = (iso) => String(iso) } = {}) {
  const esc = requireEscHtml(escHtml, 'cardCopy');
  const f = (card && card.facts) || {};
  const t = (v) => esc(String(v ?? ''));
  let title = '', body = '', chips = [];
  // A week-scoped card with no usable weekN renders NOTHING — never "Week 's slate is up" (reviewer note 5).
  if (card && WEEK_N_TYPES.includes(card.type) && numStr(f.weekN) === '') return { title, body, chips };
  switch (card && card.type) {
    case 'slate.published':
      title = `Week ${numStr(f.weekN)}'s slate is up — ${numStr(f.gameCount)} ${nz(f.gameCount) === 1 ? 'game' : 'games'}${f.firstKickoff ? `, first kickoff ${t(formatKickoff(f.firstKickoff))}` : ''}.`;
      break;
    case 'picks.submitted':
      title = `${numStr(f.submittedCount)}/${numStr(f.totalPlayers)} in for Week ${numStr(f.weekN)}.`;
      break;
    case 'week.revealed':
      title = `Week ${numStr(f.weekN)} is revealed. Every pick is visible now.`;
      break;
    case 'game.final': {
      const score = `${t(f.awayTeam)} ${numStr(f.awayScore)}, ${t(f.homeTeam)} ${numStr(f.homeScore)} (Final)`;
      if (f.atsWinnerTeam && f.marginCovered !== undefined) title = `${score} — ${t(f.atsWinnerTeam)} covered by ${t(f.marginCovered)}.`;
      else if (f.atsWinnerTeam) title = `${score} — ${t(f.atsWinnerTeam)} covered.`;
      else title = `${score}.`;
      chips = asArray(f.chips).map(c => ({ initialsHtml: t(c && c.initials), result: c && c.result === 'win' ? 'win' : 'loss' }));
      break;
    }
    case 'called.it':
      title = `${t(f.playerName)} called it — ${t(f.team)}${f.spreadDisplay ? ` ${t(f.spreadDisplay)}` : ''} upset outright${f.scoreLine ? `, ${t(f.scoreLine)}` : ''}.`;
      break;
    case 'stood.alone':
      title = `${t(f.playerName)} stood alone on ${t(f.team)} — and it covered.`;
      break;
    case 'week.result':
      title = `Week ${numStr(f.weekN)} is final.`;
      body = `${t(f.weekWinnerName)} took it, ${t(f.weekWinnerRecord)}.`;
      break;
    case 'player.week':
      title = `${t(f.playerName)}'s Week ${numStr(f.weekN)}: ${numStr(f.wins)}–${numStr(f.losses)}`;
      if (nz(f.streakRun) >= STREAK_MIN) body = `On a ${numStr(f.streakRun)}-game ${streakWord(f.streakKind)} streak.`;
      break;
    case 'rank.changed': {
      const up = nz(f.toRank) < nz(f.fromRank);
      title = up ? `${t(f.playerName)} moved into ${ordinal(f.toRank)} this week.` : `${t(f.playerName)} slipped to ${ordinal(f.toRank)} this week.`;
      body = `${up ? 'Up' : 'Down'} from ${ordinal(f.fromRank)} after Week ${numStr(f.weekN)}.`;
      break;
    }
    case 'streak.extended':
      title = `${t(f.playerName)} is riding a ${numStr(f.run)}-game ${streakWord(f.kind)} streak.`;
      break;
    case 'streak.broken':
      title = `${t(f.playerName)}'s ${numStr(f.run)}-game streak snapped this week.`;
      break;
    case 'milestone.reached':
      title = `${t(f.playerName)} hit ${numStr(f.mark)} correct picks this season.`;
      break;
    case 'year.ago':
      title = t(f.note);
      break;
    case 'scribe.post':
      body = t(f.body);
      break;
    case 'lockerroom.top':
      title = "Today's top message in the Locker Room";
      body = `“${t(f.excerpt)}” — ${numStr(f.reactionCount)} ${nz(f.reactionCount) === 1 ? 'reaction' : 'reactions'}.`;
      break;
    default:
      break;
  }
  return { title, body, chips };
}
