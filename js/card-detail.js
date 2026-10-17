/**
 * CFB Pickems — card-detail.js (Deployment 1, Lane B, DI-575 / DI-576 / PF-442, 2026-10-07)
 * =========================================================================================
 * The DETAIL behind a Home feed card. Tap a card and a pushed screen (js/pushed-screen.js) opens with the evidence behind it: the figures, one to three
 * sentences on what they mean, and the paths onward (the game's thread, the standings, the picks). All fifteen card types have one; `streak.extended` and
 * `streak.broken` share a layout. A card type with NO provider here (a Lane C type that has not registered one yet) is simply not tappable: it never
 * dead-ends (`hasDetail(type)`).
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   buildCardDetail(card, snapshot, ctx)  ->  a MODEL of plain text (never HTML) or null (= "not available right now")
 *   cardDetailHTML(model, { escHtml })    ->  the markup; every dynamic string is escaped HERE, at the sink (S-C6)
 *   unavailableDetailHTML({ escHtml })    ->  the one calm state for a card that can no longer be shown
 * A model: { type, title, eyebrow:{reason,sport}, headline:{title,body}, freshness, rows:[{label,value}] (<= 8), lists:[{id,title,items,empty}],
 *            tableHtml (a finished fragment from outside, SPLICED), meaning:[sentences] (1-3), actions:[{id,label,tone,params}], note }.
 *
 * ── THE BLIND RULE (Std-8, mutation-proven in carddetailtest) ────────────────────────────────────────────────────────────────────────────────────
 *   1. THE GATE RUNS FIRST AND IS THE SAME FUNCTION THE FEED USES — feed-cards' `isRevealed()`, which asks `arePicksPublic()` and nothing else (never
 *      `canViewOtherPicks()`). It is asked of the CURRENT snapshot at open AND on every repaint (home.js rebuilds the model each time), so a screen held open
 *      while the week changes switches to the unavailable state the moment the gate stops passing — it never leaves revealed content on screen.
 *   2. NOTHING is read before the gate has passed (S-C5): picks and other members' figures are touched only inside a builder that runs after it.
 *   3. Other members' figures also need the S-C10 flag (`snapshot.picksReadConfirmed[weekId]`): a week can be public on this device before the other rows
 *      have landed. The viewer's OWN pick is exempt where no other member's data is needed.
 *   4. DENY-BY-DEFAULT FACTS. Each builder gathers `facts`, which `finalizeDetailFacts()` rebuilds from `DETAIL_ALLOWED_FACTS` (top level and per-item) after
 *      refusing any FORBIDDEN_META_KEYS key at any depth; the templates read ONLY the finalized facts. No raw pick object ever crosses into a model; a pick is
 *      always a pre-formatted display string ("Texas ✓") the builder composed after the gate.
 *   5. Live results are tentative language (covering / trailing, soft ▲ ▽); only a FINAL game uses covered / missed / ✓ ✗ (js/game-state.js `coverWord`).
 *
 * Pure: no DOM, no storage writes, no clock of its own (`now` is a parameter). Reads synchronously (CONVENTIONS #9).
 */

import { arePicksPublic } from './storage.js';
import { FORBIDDEN_META_KEYS, assertMetaIsBlindSafe } from './notify-copy.js';
import {
  isRevealed, CARD_REVEAL_CLASS, cardCopy, ordinal, streakWord, deepFreeze, requireEscHtml, buildRevealedView, RETIRED_CARD_TYPES,
} from './feed-cards.js';
import { evaluatePick, calculateAtsWinner, calculateSeasonStandings, computeEffectiveLockAt } from './scoring.js';
import { formatSpread } from './data-model.js';
import { SEASON_2025 } from './history-2025.js';
import { memberSeasonStats, sortWeeks, atsMarginOf, viewerWeekLine } from './stats.js';
import { orderedGradedResults, runLength } from './stats-core.js';
import { gameStateOf, isLivePhase, freshnessLine, coverWord } from './game-state.js';
// D1 / DI-540 (consumertest): "is this week editable right now?" is week-lock.js's ONE answer (a stored `open` whose lock instant has passed is LOCKED), never a read of the stored status.
import { weekLockState, LOCK_PHASE } from './week-lock.js';
// D1 Lane B / DI-597: Share to chat — the reference's one gate and the one-line headline (pure; js/chat-share.js).
import { validShareRef, shareLine, SHARE_COPY } from './chat-share.js';

// ═══ the catalog ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The short label on the pushed screen's navigation bar, per type (DI-576). A function so a name or a week number can ride in the title. */
const TITLES = Object.freeze({
  'slate.published': () => 'Slate',
  'picks.submitted': () => "Who's in",
  'week.revealed': () => 'Picks revealed',
  'game.final': () => 'Final',
  'called.it': () => 'Called it',
  'stood.alone': () => 'Stood alone',
  'week.result': (c) => (numOk(c.facts && c.facts.weekN) ? `Week ${c.facts.weekN}` : 'Week result'),
  'player.week': (c) => (c.facts && c.facts.playerName ? `${c.facts.playerName}'s week` : 'Weekly update'),
  'rank.changed': () => 'Rank change',
  'streak.extended': () => 'Streak',
  'streak.broken': () => 'Streak',
  'milestone.reached': () => 'Milestone',
  'year.ago': () => 'A year ago',
  'scribe.post': () => 'SCRIBE',
  'lockerroom.top': () => 'Top message',
});

/** Types that have a detail provider. A Lane C type registers one by adding it here (X6); a type without one renders non-tappable. */
export const DETAIL_TYPES = Object.freeze(Object.keys(TITLES));
export const hasDetail = (type) => typeof type === 'string' && Object.prototype.hasOwnProperty.call(TITLES, type);
export function detailTitle(card) {
  const f = card && TITLES[card.type];
  return typeof f === 'function' ? String(f(card) || '') : '';
}

export const MAX_ROWS = 8;
export const LIST_PREVIEW = 12;
export const STREAK_LIST_MAX = 10;

/**
 * Deny-by-default (the CARD_ALLOWED_FACTS pattern, one layer deeper): the ONLY facts a detail template may read, per type. `lines` / `games` / `members`
 * are structured and rebuilt item by item from DETAIL_ITEM_KEYS. None of these names is in FORBIDDEN_META_KEYS (module-load scan below).
 */
export const DETAIL_ALLOWED_FACTS = deepFreeze({
  'slate.published': ['weekN', 'gameCount', 'firstKickoffText', 'lockText', 'lockCountdown', 'yourCountText', 'weekStatus', 'games'],
  'picks.submitted': ['weekN', 'inText', 'lockText', 'yourStatus', 'weekStatus', 'yourCountText'],
  'week.revealed': ['weekN', 'inText', 'weekStatus', 'games'],
  // W-92 (DI-W92-6): the game card's "Called it" / "Stood alone" list — the retired cards' rows, one per named member.
  'game.final': ['weekN', 'matchup', 'lineText', 'resultText', 'coverText', 'coveredNames', 'missedNames', 'yourPickText', 'yourResult', 'yourWeekText', 'weekFinal', 'threadGameId', 'standoutTitle', 'standoutItems'],
  'called.it': ['matchup', 'playerName', 'playerId', 'pickText', 'finalText', 'outrightByText', 'alsoText', 'upsetsText', 'threadGameId', 'spreadDisplay', 'team'],
  'stood.alone': ['matchup', 'playerName', 'playerId', 'team', 'againstText', 'resultText', 'threadGameId'],
  'week.result': ['weekN', 'winnerText', 'loserText', 'recordText', 'winnerName', 'weekId'],
  'player.week': ['weekN', 'playerName', 'playerId', 'recordText', 'streakText', 'almaText', 'games', 'wins', 'losses', 'streakSentence'],
  // W-92 (DI-W92-6): a combined card (two or more members) is one screen with a section per member: `sections` (each rebuilt below) and one `sentence`.
  'rank.changed': ['weekN', 'playerName', 'playerId', 'fromText', 'toText', 'winPctText', 'weeksText', 'gapText', 'sections', 'sentence'],
  'streak.extended': ['playerName', 'playerId', 'runText', 'startedText', 'longestText', 'games', 'sentence', 'weekN', 'sections'],
  'streak.broken': ['playerName', 'playerId', 'runText', 'startedText', 'longestText', 'games', 'sentence', 'weekN', 'sections'],
  'milestone.reached': ['playerName', 'playerId', 'markText', 'totalText', 'games', 'weekN', 'sections', 'sentence'],
  'year.ago': ['weekN', 'winnerText', 'recordText', 'superlative', 'members', 'thisYearText', 'leaderName', 'sentence'],
  'scribe.post': ['body', 'postedText', 'reactionText', 'weekText', 'matchup', 'messageId', 'threadGameId'],
  'lockerroom.top': ['body', 'authorName', 'postedText', 'reactionText', 'messageId'],
});
export const DETAIL_ITEM_KEYS = deepFreeze({
  games: ['key', 'primary', 'secondary', 'mark', 'markWord', 'tone'],
  members: ['key', 'primary', 'secondary'],
  standoutItems: ['key', 'primary', 'secondary'],
  // W-92: a section is { key, title, items }, its items rebuilt with the `members` item keys (finalizeDetailFacts).
  sections: ['key', 'title', 'items'],
});
for (const [type, keys] of Object.entries(DETAIL_ALLOWED_FACTS)) {
  for (const k of keys) if (FORBIDDEN_META_KEYS.includes(k)) throw new Error(`[card-detail] ${type} allow-lists forbidden key ${k}`);
}
for (const [k, keys] of Object.entries(DETAIL_ITEM_KEYS)) {
  for (const ik of keys) if (FORBIDDEN_META_KEYS.includes(ik)) throw new Error(`[card-detail] item list ${k} allow-lists forbidden key ${ik}`);
}

function assertDeepBlindSafe(value) {
  if (Array.isArray(value)) { value.forEach(assertDeepBlindSafe); return; }
  if (value && typeof value === 'object') { assertMetaIsBlindSafe(value); Object.values(value).forEach(assertDeepBlindSafe); }
}

/** Refuses a forbidden key at any depth (THROWS — a builder offering one is a bug to fix), then keeps only the type's allow-listed keys, rebuilding structured lists item by item. */
export function finalizeDetailFacts(type, facts) {
  const allowed = DETAIL_ALLOWED_FACTS[type];
  if (!allowed) throw new Error(`[card-detail] no allow-list for card type ${type}`);
  assertDeepBlindSafe(facts);
  const out = {};
  for (const k of allowed) {
    if (!facts || !Object.prototype.hasOwnProperty.call(facts, k) || facts[k] === undefined || facts[k] === null) continue;
    if (k === 'sections') {                                                   // W-92: one level deeper — each section's items rebuilt from the member item keys
      out[k] = (Array.isArray(facts[k]) ? facts[k] : []).filter(x => x && typeof x === 'object').map(x => ({
        key: String(x.key ?? ''), title: String(x.title ?? ''),
        items: (Array.isArray(x.items) ? x.items : []).filter(i => i && typeof i === 'object').map(i => {
          const c = {};
          for (const ik of DETAIL_ITEM_KEYS.members) if (i[ik] !== undefined && i[ik] !== null) c[ik] = typeof i[ik] === 'number' ? i[ik] : String(i[ik]);
          return c;
        }),
      })).filter(x => x.title && x.items.length);
      continue;
    }
    const itemKeys = DETAIL_ITEM_KEYS[k];
    if (itemKeys) {
      out[k] = (Array.isArray(facts[k]) ? facts[k] : []).filter(i => i && typeof i === 'object').map(i => {
        const c = {};
        for (const ik of itemKeys) if (i[ik] !== undefined && i[ik] !== null) c[ik] = typeof i[ik] === 'number' ? i[ik] : String(i[ik]);
        return c;
      });
    } else if (typeof facts[k] === 'number' || typeof facts[k] === 'boolean') out[k] = facts[k];
    else out[k] = String(facts[k]);
  }
  return out;
}

// ═══ small pure helpers ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const asArray = (v) => (Array.isArray(v) ? v : []);
const nz = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function numOk(v) { return v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v)); }
const hasWeekN = (w) => !!w && numOk(w.weekNumber);
const dash = (a, b) => `${nz(a)}–${nz(b)}`;
const isId = (v) => typeof v === 'string' && v.length > 0;
const joinNames = (names) => {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n.join('');
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
};
const plain = (v) => String(v === null || v === undefined ? '' : v);
const toMs = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const ms = v ? Date.parse(v) : NaN; return Number.isFinite(ms) ? ms : null; };

function normalize(snapshot) {
  const s = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  const cc = (s.chatCandidates && typeof s.chatCandidates === 'object') ? s.chatCandidates : {};
  return {
    leagueId: s.leagueId ?? null, viewerId: isId(s.viewerId) ? s.viewerId : null, now: Number.isFinite(Number(s.now)) ? Number(s.now) : Date.now(),
    players: asArray(s.players), weeks: asArray(s.weeks), games: asArray(s.games), picks: asArray(s.picks), weeklyResults: asArray(s.weeklyResults),
    revealedWeeks: asArray(s.revealedWeeks), revealedGames: asArray(s.revealedGames), revealedPicks: asArray(s.revealedPicks), revealedWeeklyResults: asArray(s.revealedWeeklyResults),
    tieContexts: s.tieContexts instanceof Map ? s.tieContexts : null,
    confirmedStatusFor: typeof s.confirmedStatusFor === 'function' ? s.confirmedStatusFor : () => null,
    picksReadConfirmed: (s.picksReadConfirmed && typeof s.picksReadConfirmed === 'object') ? s.picksReadConfirmed : {},
    submissionCounts: (s.submissionCounts && typeof s.submissionCounts === 'object') ? s.submissionCounts : {},
    chatScribe: asArray(cc.scribe), chatLockerRoom: asArray(cc.lockerRoom),
  };
}

/** The context the app injects (every default is the safe, plain one — a bare unit test needs none of it). */
function normalizeCtx(ctx) {
  const c = (ctx && typeof ctx === 'object') ? ctx : {};
  const cap = (c.capabilities && typeof c.capabilities === 'object') ? c.capabilities : {};
  return {
    formatTime: typeof c.formatTime === 'function' ? c.formatTime : (v) => String(v ?? ''),            // an instant -> text in the viewer's zone (formatGameTime)
    formatCountdown: typeof c.formatCountdown === 'function' ? c.formatCountdown : () => '',            // ms -> "2d 4h"
    liveEntryFor: typeof c.liveEntryFor === 'function' ? c.liveEntryFor : () => null,
    threadCount: typeof c.threadCount === 'function' ? c.threadCount : null,                           // (gameId) -> number
    scoreSummaryRowsHTML: typeof c.scoreSummaryRowsHTML === 'function' ? c.scoreSummaryRowsHTML : null,  // (week) -> finished <tr> rows, the Dashboard's own
    showSport: c.showSport === true,
    pilotHistory: c.pilotHistory === true,                                                             // may this league see the PILOT's 2025 history? (an injected answer; absent = no — fail closed)
    sportLabel: typeof c.sportLabel === 'function' ? c.sportLabel : (sp) => String(sp || '').toUpperCase(),
    canCompare: typeof c.canCompare === 'function' ? c.canCompare : () => false,                       // (memberId, week) -> may the viewer compare with them in THIS week's competition? (D1 DI-595; absent = no)
    capabilities: {
      thread: cap.thread === true, chat: cap.chat === true,
      gameday: cap.gameday === true, compare: cap.compare === true, weekDetail: cap.weekDetail === true, share: cap.share === true, next: cap.next === true,
    },
  };
}

// ═══ the builder ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * @param {object} card      a card from deriveCards() — re-derived by the caller on EVERY call, never trusted from the DOM
 * @param {object} snapshot  home.js's assembleHomeSnapshot() result
 * @param {object} ctx       see normalizeCtx
 * @returns {object|null}    the model, or null when the card cannot (or may not) be shown now
 */
export function buildCardDetail(card, snapshot, ctx) {
  try { return buildCardDetailCore(card, snapshot, ctx); }
  catch (e) { try { console.error('[card-detail] failed', e); } catch { /* no console */ } return null; }          // belt: a thrown read becomes the calm unavailable state, never a blank screen
}

function buildCardDetailCore(card, snapshot, ctx) {
  if (!card || typeof card !== 'object' || !hasDetail(card.type)) return null;
  // W-92 (DI-W92-2 / DI-W92-3 / DI-W92-6): a retired type (an id shared to chat before v0.30.1) has no screen any more: the calm unavailable state.
  if (RETIRED_CARD_TYPES.includes(card.type)) return null;
  const s = normalize(snapshot);
  const c = normalizeCtx(ctx);
  const week = card.weekId ? (s.weeks.find(w => w && w.weekId === card.weekId) || null) : null;
  if (card.weekId && !week) return null;                                        // the week it was about is gone
  const game = card.gameId ? (s.games.find(g => g && g.gameId === card.gameId && g.weekId === card.weekId) || null) : null;
  if (card.gameId && !game) return null;
  // ── THE GATE (Std-8, S-C1): the feed's own isRevealed(), asked of the current snapshot. Nothing below runs unless it passes. ──
  let confirmed = null;
  try { confirmed = week ? (s.confirmedStatusFor(week) ?? null) : null; } catch { confirmed = null; }
  const passed = isRevealed(
    { type: card.type, requiresReveal: CARD_REVEAL_CLASS[card.type], gameId: card.gameId || null },
    { week, game, confirmedWeekStatus: confirmed, viewerId: s.viewerId, now: s.now },
  );
  if (!passed) return null;
  const env = { card, s, c, week, game, confirmed, othersOk: !!week && s.picksReadConfirmed[week.weekId] === true };
  env.share = shareOf(env);
  const builder = BUILDERS[card.type];
  if (typeof builder !== 'function') return null;                               // a catalog type with no builder (the retired three) has no screen
  let parts = null;
  try { parts = builder(env); } catch (e) { try { console.error('[card-detail] builder failed', card.type, e); } catch {} return null; }
  if (!parts) return null;
  return assemble(env, parts);
}

function assemble(env, parts) {
  const { card, c } = env;
  const facts = parts.facts;
  let copy = { title: '', body: '' };
  try { copy = cardCopy(card, { escHtml: plain, formatKickoff: (iso) => c.formatTime(iso) }) || copy; } catch { /* a copy failure never costs the screen */ }
  const rows = asArray(parts.rows).filter(r => r && isId(r.label) && isId(String(r.value ?? ''))).slice(0, MAX_ROWS);
  const lists = asArray(parts.lists).filter(l => l && asArray(l.items).length > 0);
  const meaning = asArray(parts.meaning).filter(isId).slice(0, 3);
  const thin = rows.length < 2 && lists.length === 0 && !parts.tableHtml;      // DI-576 "Missing data": fewer than two rows survive -> the headline card and an honest note
  return {
    type: card.type, id: card.id, title: detailTitle(card),
    eyebrow: { reason: plain(card.reason), sport: c.showSport && card.sport ? c.sportLabel(card.sport) : '' },
    headline: { title: plain(parts.headlineTitle ?? copy.title), body: plain(parts.headlineBody ?? copy.body) },
    freshness: plain(parts.freshness || ''),
    rows, lists, tableHtml: typeof parts.tableHtml === 'string' ? parts.tableHtml : '', meaning,
    // DI-597 — Share to chat, last in the action group: only when the app turns sharing on (chat enabled, a signed-in member) and, like everything here, only after THIS viewer's gate has passed.
    actions: [...asArray(parts.actions).filter(a => a && isId(a.id) && isId(a.label)), ...(env.share ? [act('share', SHARE_COPY.button, 'secondary')] : [])],
    note: thin ? 'Not enough data for more detail yet.' : '',
    facts,
    share: env.share || null,
  };
}

/**
 * DI-597 — what a share of THIS card carries: its allow-listed headline and nothing else. The eyebrow is the detail's own title, its sport (several sports only), its week and, for a game card, the matchup;
 * the title line is a FINAL game's score (public sports data). Never a member's pick, a result line, a reason or a tiebreaker: those are what a reader's own, re-gated detail shows when they open it.
 */
function shareOf({ card, c, week, game, s }) {
  if (!c.capabilities.share || !isId(s.viewerId)) return null;
  const ref = validShareRef({ type: 'card', id: String(card.id || '') });
  if (!ref) return null;
  const title = detailTitle(card);
  const sport = c.showSport && card.sport ? c.sportLabel(card.sport) : '';
  const weekPart = week && numOk(week.weekNumber) && !/\bWeek\s+\d/.test(title) ? `Week ${week.weekNumber}` : '';
  const matchup = game ? `${plain(game.awayTeam)} at ${plain(game.homeTeam)}` : '';
  const eyebrow = [sport, title, weekPart, matchup].filter(Boolean).join(' · ');
  const scored = game && game.status === 'final' && numOk(game.awayScore) && numOk(game.homeScore);
  const titleLine = scored ? `${plain(game.awayTeam)} ${Number(game.awayScore)}, ${plain(game.homeTeam)} ${Number(game.homeScore)}` : '';
  return { ref, eyebrow, title: titleLine, gameTag: game ? String(game.gameId) : '', line: shareLine({ eyebrow, title: titleLine }) };
}

const row = (label, value) => (isId(String(value ?? '')) ? { label, value: String(value) } : null);
const compactRows = (...rs) => rs.filter(Boolean);
const act = (id, label, tone = 'secondary', params = {}) => ({ id, label, tone, params });

// ── shared builders ──
const nameIn = (s, id) => { const p = s.players.find(x => x && x.playerId === id); return p && p.displayName ? String(p.displayName) : ''; };
const matchupOf = (g) => `${g.awayTeam} at ${g.homeTeam}`;
function lineOf(g) {
  const sv = (g.lockedSpread !== null && g.lockedSpread !== undefined) ? g.lockedSpread : g.spread;
  if (sv === null || sv === undefined || sv === '') return 'TBD';
  return formatSpread(Number(sv), g.favorite, g);
}
const ownPick = (s, gameId) => (s.viewerId ? (s.picks.find(p => p && p.gameId === gameId && p.playerId === s.viewerId) || null) : null);
const pickersOf = (s, gameId) => s.picks.filter(p => p && p.gameId === gameId);

/** The viewer's pick on a game as a pre-formatted display string + its glyph/word; live is tentative, final is settled. */
function ownPickMark(s, c, g) {
  const p = ownPick(s, g.gameId);
  if (!p) return null;
  const st = gameStateOf(g, { liveEntry: c.liveEntryFor(g.gameId), now: s.now });
  const r = evaluatePick(p, g);
  if (st.phase === 'final') {
    if (r === 'win') return { text: p.selectedTeam, mark: '✓', word: ' covered', tone: 'win', result: 'covered' };
    if (r === 'loss') return { text: p.selectedTeam, mark: '✗', word: ' missed', tone: 'loss', result: 'missed' };
    if (r === 'no_decision') return { text: p.selectedTeam, mark: '—', word: ' pushed', tone: 'push', result: 'push' };
    return { text: p.selectedTeam, mark: '', word: '', tone: '', result: '' };
  }
  if (isLivePhase(st.phase)) {
    const cov = liveCoverState(g, p.selectedTeam);
    if (cov === 'covering') return { text: p.selectedTeam, mark: '▲', word: ` ${coverWord(st.phase, true)}`, tone: 'covering', result: 'covering' };
    if (cov === 'trailing') return { text: p.selectedTeam, mark: '▽', word: ` ${coverWord(st.phase, false)}`, tone: 'trailing', result: 'trailing' };
  }
  return { text: p.selectedTeam, mark: '', word: '', tone: '', result: '' };
}
function liveCoverState(g, team) {
  let who = null;
  try { who = calculateAtsWinner({ ...g, status: 'final' }); } catch { who = null; }
  if (!who || who === 'no_decision') return null;
  return who === team ? 'covering' : 'trailing';
}

/** week-scoped lock instant as text, or ''. */
function lockTextOf(env) {
  const { s, c, week } = env;
  let at = null;
  try { at = computeEffectiveLockAt(week, s.games.filter(g => g && g.weekId === week.weekId)); } catch { at = null; }
  return at && Number.isFinite(at.getTime()) ? { text: c.formatTime(at.toISOString()), ms: at.getTime() } : { text: '', ms: null };
}

function eventFreshness(env) { return env.card.sortKey ? env.c.formatTime(env.card.sortKey) : ''; }

function gameFreshness(env) {
  const { s, c, game } = env;
  const st = gameStateOf(game, { liveEntry: c.liveEntryFor(game.gameId), now: s.now });
  return freshnessLine(st, { game, now: s.now, formatKickoff: (iso) => c.formatTime(iso), formatTime: (ms) => c.formatTime(new Date(ms).toISOString()) });
}

function threadActions(env, gameId, { primary = false } = {}) {
  const { c } = env;
  const out = [];
  if (c.capabilities.thread && isId(gameId)) {
    const raw = c.threadCount ? c.threadCount(gameId) : null;
    const n = raw === null || raw === undefined ? null : nz(raw);   // null (chat gave no honest count - a game older than what the device has loaded) is a bare "Open thread", never "· 0"
    out.push(act('open-thread', n === null ? 'Open thread' : `Open thread · ${n}`, primary ? 'primary' : 'secondary', { gameId }));
  }
  return out;
}

/** DI-576 / DI-596: "Week results" - the week's detail screen, offered only where the app has that screen (a capability) and the card names a week. */
function weekResultsAction(env, week, tone = 'secondary') {
  return env.c.capabilities.weekDetail && week && isId(week.weekId) ? [act('week-detail', 'Week results', tone, { weekId: week.weekId })] : [];
}
/** DI-576 / DI-595: "Compare with {name}" - offered only where the app has the screen, the viewer is signed in, the card is about ANOTHER member, and the app says both were entered in the card's competition
 *  (canCompare: S4 hides it, and so does a member the viewer's sport does not share). The name is the card's own allow-listed fact. */
function compareAction(env, memberId, name) {
  const { c, s, week } = env;
  if (!c.capabilities.compare || !s.viewerId || !isId(memberId) || memberId === s.viewerId || !isId(name) || !week) return [];
  let ok = false;
  try { ok = c.canCompare(memberId, week) === true; } catch { ok = false; }
  return ok ? [act('compare', `Compare with ${name}`, 'secondary', { memberId, weekId: week.weekId })] : [];
}

/** weekly-week raw record line for the viewer, "so far" until the week is server-confirmed final. */
function viewerWeekSentence(env, week) {
  const { s, confirmed } = env;
  if (!s.viewerId) return { text: '', final: false };
  const line = viewerWeekLine({ week, games: s.games, picks: s.picks, viewerId: s.viewerId });
  if (!line || line.graded === 0) return { text: '', final: false };
  const final = confirmed === 'final';
  return { text: `That puts you at ${dash(line.wins, line.losses)} for Week ${week.weekNumber}${final ? '' : ' so far'}.`, final };
}

/**
 * The competition a week belongs to in a several-sport snapshot (the Lane A seam: Home's competitions carry each one's `weekIds` and its entrants `playerIds`, from the feed contexts), else null — a one-sport
 * league is one competition and every figure is computed over the whole league, as it always was.
 */
function competitionOf(s, week) {
  if (!week) return null;
  return (Array.isArray(s.competitions) ? s.competitions : []).find(c => c && !c.single && Array.isArray(c.weekIds) && c.weekIds.includes(String(week.weekId))) || null;
}

/**
 * The revealed view through (and including) a week, in season order — what memberSeasonStats and Standings compute over. In a several-sport league it is THAT week's competition only (`scopeWeek`, default
 * `week`): its weeks, and its entrants as Standings ranks them (C4: playersForCompetition, carried in `playerIds`); a non-entrant's pick rows count for nothing (A3). Nothing crosses a sport (DI-594).
 */
function viewThrough(s, week, scopeWeek = week) {
  const comp = competitionOf(s, scopeWeek);
  const inComp = comp ? new Set(comp.weekIds) : null;
  const entrantIds = comp && Array.isArray(comp.playerIds) ? new Set(comp.playerIds.map(String)) : null;
  const keep = (x) => !!x && (!inComp || inComp.has(String(x.weekId)));
  const rv = buildRevealedView({ weeks: s.revealedWeeks.filter(keep), games: s.revealedGames.filter(keep), picks: s.revealedPicks.filter(p => keep(p) && (!entrantIds || entrantIds.has(String(p.playerId)))), weeklyResults: s.revealedWeeklyResults.filter(keep), confirmedStatusFor: s.confirmedStatusFor, includeDemo: true });
  const active = s.players.filter(p => p && p.active);
  return { players: entrantIds ? active.filter(p => entrantIds.has(String(p.playerId))) : active, revealedWeeks: rv.revealedWeeks, revealedGames: rv.revealedGames, revealedPicks: rv.revealedPicks, revealedWeeklyResults: rv.revealedWeeklyResults, allWeeks: s.weeks.filter(keep), tieContexts: s.tieContexts, season: week ? week.season : null, asOfWeekId: week ? week.weekId : null };
}

/** The ids of the revealed weeks of `week`'s season up to and including it, in season order — the "through week N" slice (guard 3: a later week never moves an earlier week's figure). */
function throughIds(view, week) {
  const wk = sortWeeks(view.revealedWeeks).filter(w => String(w.season) === String(week.season));
  const at = wk.findIndex(w => w.weekId === week.weekId);
  return { ids: new Set((at < 0 ? [] : wk.slice(0, at + 1)).map(w => w.weekId)), weeks: at < 0 ? [] : wk.slice(0, at + 1) };
}

// ═══ the per-type builders (each runs ONLY after the gate has passed) ═══════════════════════════════════════════════════════════════════════════

function gameRowsFor(env, games, { withLine = true, withPick = false, withSplit = false, withState = false } = {}) {
  const { s, c } = env;
  return games.map(g => {
    const bits = [];
    if (withState) {
      const st = gameStateOf(g, { liveEntry: c.liveEntryFor(g.gameId), now: s.now });
      bits.push(st.phase === 'upcoming' ? c.formatTime(g.kickoff) : st.label);
      if (st.score && st.phase !== 'upcoming' && st.phase !== 'awaiting') bits.push(`${g.awayTeam} ${st.score.away}, ${g.homeTeam} ${st.score.home}`);
    } else if (g.kickoff) bits.push(c.formatTime(g.kickoff));
    if (withLine) bits.push(lineOf(g));
    if (withSplit) {
      const picks = pickersOf(s, g.gameId);
      const a = picks.filter(p => p.selectedTeam === g.awayTeam).length, h = picks.filter(p => p.selectedTeam === g.homeTeam).length;
      if (a + h > 0) bits.push(`${a} on ${g.awayTeam}, ${h} on ${g.homeTeam}`);
    }
    const mark = withPick ? ownPickMark(s, c, g) : null;
    return {
      key: g.gameId, primary: matchupOf(g), secondary: bits.filter(Boolean).join(' · '),
      mark: mark ? `${mark.text}${mark.mark ? ' ' + mark.mark : ''}` : '', markWord: mark ? mark.word : '', tone: mark ? mark.tone : '',
    };
  });
}

const BUILDERS = {
  'slate.published'(env) {
    const { card, s, c, week } = env;
    const games = s.games.filter(g => g && g.weekId === week.weekId).slice().sort((a, b) => (toMs(a.kickoff) ?? Infinity) - (toMs(b.kickoff) ?? Infinity) || String(a.gameId).localeCompare(String(b.gameId)));
    const lock = lockTextOf(env);
    const mine = s.viewerId ? s.picks.filter(p => p && p.weekId === week.weekId && p.playerId === s.viewerId && games.some(g => g.gameId === p.gameId)).length : null;
    const status = env.confirmed || week.status;
    const facts = finalizeDetailFacts('slate.published', {
      weekN: week.weekNumber, gameCount: games.length, firstKickoffText: card.facts.firstKickoff ? c.formatTime(card.facts.firstKickoff) : '',
      lockText: lock.text, lockCountdown: lock.ms !== null && lock.ms > s.now ? c.formatCountdown(lock.ms - s.now) : '',
      yourCountText: mine === null ? '' : `${mine} of ${games.length} made`, weekStatus: status,
      games: gameRowsFor(env, games, { withLine: true }),
    });
    // Edit My Picks / Make your picks are offered only while the week can still be edited: the ONE lock state (js/week-lock.js) — a derived lock (status open, lock instant passed) closes it on this screen too.
    const open = weekLockState({ week, games, now: s.now, confirmedStatus: env.confirmed || null }).phase === LOCK_PHASE.OPEN;
    const complete = mine !== null && games.length > 0 && mine >= games.length;
    return {
      facts, freshness: eventFreshness(env),
      rows: compactRows(row('Games', facts.gameCount), row('First kickoff', facts.firstKickoffText), row('Picks lock', facts.lockText), row('Your picks', facts.yourCountText)),
      lists: [{ id: 'slate', title: 'The slate', items: facts.games || [] }],
      meaning: [`Week ${facts.weekN}'s slate is up.`, facts.lockCountdown ? `Picks lock in ${facts.lockCountdown}.` : (open ? '' : 'Picks are locked.')],
      actions: s.viewerId ? [act('go-picks', open ? (complete ? 'Edit My Picks' : 'Make your picks') : 'View the slate', 'primary', { weekId: week.weekId })] : [],   // THIS week, in its sport (the app's openSportWeek)
    };
  },

  'picks.submitted'(env) {
    const { card, s, week } = env;
    const games = s.games.filter(g => g && g.weekId === week.weekId);
    const mine = s.viewerId ? s.picks.filter(p => p && p.weekId === week.weekId && p.playerId === s.viewerId).length : null;
    const lock = lockTextOf(env);
    const facts = finalizeDetailFacts('picks.submitted', {
      weekN: week.weekNumber, inText: `${nz(card.facts.submittedCount)} of ${nz(card.facts.totalPlayers)}`, lockText: lock.text,
      yourStatus: mine === null ? '' : (games.length > 0 && mine >= games.length ? 'Submitted' : 'Not yet'), weekStatus: env.confirmed || week.status,
    });
    return {
      facts, freshness: eventFreshness(env),
      rows: compactRows(row('In', facts.inText), row('Locks', facts.lockText), row('You', facts.yourStatus)),
      meaning: ["Everyone's picks stay hidden until kickoff.", 'Only the count is shown.'],
      actions: s.viewerId ? [act('go-picks', facts.yourStatus === 'Submitted' ? 'Edit My Picks' : 'Make your picks', 'primary', { weekId: week.weekId })] : [],
    };
  },

  'week.revealed'(env) {
    const { card, s, week } = env;
    const games = s.games.filter(g => g && g.weekId === week.weekId).slice().sort((a, b) => (toMs(a.kickoff) ?? Infinity) - (toMs(b.kickoff) ?? Infinity) || String(a.gameId).localeCompare(String(b.gameId)));
    // The card itself is class 'never' (it announces the reveal and shows no selection). The per-game rows are not: they carry the split and the viewer's own pick, so they
    // additionally require the week to be public AND the other members' rows to have landed (S-C10).
    const rowsOk = arePicksPublic(week) && env.othersOk;
    const inText = card.facts.submittedCount !== undefined ? `${nz(card.facts.submittedCount)} of ${nz(card.facts.totalPlayers)}` : '';
    const facts = finalizeDetailFacts('week.revealed', {
      weekN: week.weekNumber, inText, weekStatus: env.confirmed || week.status,
      games: rowsOk ? gameRowsFor(env, games, { withLine: false, withPick: true, withSplit: true, withState: true }) : [],
    });
    return {
      facts, freshness: eventFreshness(env),
      rows: compactRows(row('Games', games.length), row('Picks in', facts.inText)),
      lists: [{ id: 'games', title: 'The games', items: facts.games || [] }],
      meaning: [`Week ${facts.weekN} is revealed.`, 'Every pick is visible now.'],
      actions: [act('go-dashboard', 'Open Dashboard', 'primary', { weekId: week.weekId })],
    };
  },

  'game.final'(env) {
    const { card, s, c, week, game } = env;
    const f = card.facts;
    const winner = nz(game.homeScore) === nz(game.awayScore) ? '' : (nz(game.homeScore) > nz(game.awayScore) ? game.homeTeam : game.awayTeam);
    const diff = Math.abs(nz(game.homeScore) - nz(game.awayScore));
    const resultText = winner ? `${winner} by ${diff}` : `Tied ${nz(game.homeScore)}–${nz(game.awayScore)}`;
    const coverText = f.atsWinnerTeam ? `${f.atsWinnerTeam}${f.marginCovered !== undefined ? ` by ${f.marginCovered}` : ''}` : 'Push';
    const nameOfChip = (chip) => nameIn(s, chip.playerId) || chip.initials || '';
    const covered = asArray(f.chips).filter(x => x.result === 'win').map(nameOfChip).filter(Boolean);
    const missed = asArray(f.chips).filter(x => x.result === 'loss').map(nameOfChip).filter(Boolean);
    const mark = s.viewerId ? ownPickMark(s, c, game) : null;
    const wk = viewerWeekSentence(env, week);
    const so = standoutRows(env);
    const facts = finalizeDetailFacts('game.final', {
      weekN: week.weekNumber, matchup: matchupOf(game), lineText: lineOf(game), resultText, coverText,
      coveredNames: joinNames(covered), missedNames: joinNames(missed),
      yourPickText: mark ? `${mark.text} ${mark.mark}${mark.word}`.trim() : '', yourResult: mark ? mark.result : '', yourWeekText: wk.text, weekFinal: wk.final, threadGameId: game.gameId,
      ...(so ? { standoutTitle: so.title, standoutItems: so.items } : {}),
    });
    const meaning = [];
    if (facts.yourResult === 'covered') meaning.push('You covered this one.');
    else if (facts.yourResult === 'missed') meaning.push('You missed this one.');
    else if (facts.yourResult === 'push') meaning.push('This one pushed for you.');
    if (facts.yourWeekText) meaning.push(facts.yourWeekText);
    return {
      facts, freshness: gameFreshness(env),
      rows: compactRows(row('Line', facts.lineText), row('Result', facts.resultText), row('Covered by', facts.coverText), row('Covered', facts.coveredNames), row('Missed', facts.missedNames), row('Your pick', facts.yourPickText)),
      lists: facts.standoutTitle && asArray(facts.standoutItems).length ? [{ id: 'standout', title: facts.standoutTitle, items: facts.standoutItems }] : [],
      meaning,
      actions: [...(c.capabilities.gameday ? [act('open-game', 'Open game', 'primary', { gameId: game.gameId })] : []), ...threadActions(env, game.gameId, { primary: !c.capabilities.gameday })],
    };
  },

  'week.result'(env) {
    const { card, c, week } = env;
    const f = card.facts;
    const winner = plain(f.weekWinnerName).trim(), loser = plain(f.weekLoserName).trim();
    const tableHtml = c.scoreSummaryRowsHTML ? plain(c.scoreSummaryRowsHTML(week)) : '';   // the Dashboard's own rows — they already carry SP-54's tiebreak note when the tie context was used
    const facts = finalizeDetailFacts('week.result', {
      weekN: week.weekNumber, weekId: week.weekId, winnerName: winner, recordText: plain(f.weekWinnerRecord),
      winnerText: winner ? `${winner} (${plain(f.weekWinnerRecord)})` : '', loserText: loser ? `${loser} (${plain(f.weekLoserRecord)})` : '',
    });
    return {
      facts, freshness: eventFreshness(env), tableHtml,
      rows: compactRows(row('Winner', facts.winnerText), row('Loser', facts.loserText)),
      meaning: winner ? [`${winner} took Week ${facts.weekN}, ${facts.recordText}.`] : [],
      actions: [act('go-standings', 'See standings', 'primary'), ...weekResultsAction(env, week)],
    };
  },

  // W-92 (DI-W92-6): ONE screen for everyone on a combined card. One member opens exactly the detail it opened before (rankMember /
  // streakMember / milestoneMember); two or more get a section per member (groupParts).
  'rank.changed'(env) {
    return groupParts(env, rankMember, {
      sentence: (n, week) => `Standings changed for ${n} members after Week ${week.weekNumber}.`,
      actions: (e) => [act('go-standings', 'See standings', 'primary'), ...weekResultsAction(e, e.week)],
    });
  },

  'streak.extended'(env) { return groupParts(env, streakMember, { sentence: (n) => `${n} members are on streaks.`, actions: (e) => weekResultsAction(e, e.week, 'primary') }); },
  'streak.broken'(env) { return groupParts(env, streakMember, { sentence: (n) => `${n} members lost their streaks this week.`, actions: (e) => weekResultsAction(e, e.week, 'primary') }); },

  'milestone.reached'(env) {
    return groupParts(env, milestoneMember, { sentence: (n) => `${n} members passed milestones.`, actions: (e) => weekResultsAction(e, e.week, 'primary') });
  },

  'year.ago'(env) {
    if (env.c.pilotHistory !== true) return null;        // D1 security O1: the 2025 names and scores belong to the pilot league alone — the app injects the answer (pilot-only registry); never a second predicate here
    const { card, s, week } = env;
    const f = card.facts;
    const idx = nz(f.weekN) - 1;
    const members = Object.entries(SEASON_2025.weeklyScores || {})
      .map(([name, arr]) => [name, Array.isArray(arr) ? arr[idx] : undefined]).filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
      .map(([name, v]) => ({ key: name, primary: name, secondary: `${v} correct` }));
    // "This year so far": the leader after the latest finalized week, from Standings' own function over the revealed view.
    let thisYear = '', leader = '';
    try {
      const view = viewThrough(s, null, week);
      const season = week ? week.season : null;
      const done = sortWeeks(view.revealedWeeks).filter(w => String(w.season) === String(season));
      if (done.length) {
        const ids = new Set(done.map(w => w.weekId));
        const standings = calculateSeasonStandings(view.players, view.revealedWeeklyResults.filter(r => r && ids.has(r.weekId)), view.allWeeks, view.tieContexts);
        const lead = standings.find(x => x.currentRank === 1);
        const nm = lead ? nameIn(s, lead.playerId) : '';
        if (nm) { thisYear = `${nm} leads after Week ${done[done.length - 1].weekNumber}`; leader = nm; }
      }
    } catch { thisYear = ''; leader = ''; }
    const facts = finalizeDetailFacts('year.ago', {
      weekN: f.weekN, winnerText: f.name, recordText: f.record, superlative: f.superlative || '', members, thisYearText: thisYear, leaderName: leader,
      sentence: `Last year's Week ${f.weekN} winner was ${f.name} with ${f.record}.`,
    });
    return {
      facts, freshness: '',
      rows: compactRows(row('Last year\'s winner', facts.winnerText), row('Their week', facts.recordText), row('Note', facts.superlative ? `The ${facts.superlative.replace(/^the /, '')}` : ''), row('This year so far', facts.thisYearText)),
      lists: [{ id: 'members', title: `2025 · Week ${facts.weekN}`, items: facts.members || [] }],
      meaning: [facts.sentence, facts.leaderName ? `This year's leader so far is ${facts.leaderName}.` : ''],
      actions: [act('see-2025', 'See the 2025 record', 'primary')],
    };
  },

  'scribe.post'(env) {
    const { card, s, c } = env;
    const cand = s.chatScribe.find(x => x && String(x.id) === card.facts.messageId) || null;
    const body = cand && typeof cand.body === 'string' ? cand.body : card.facts.body;
    const ctxW = cand && cand.context ? cand.context : null;
    const facts = finalizeDetailFacts('scribe.post', {
      body, postedText: card.facts.timestamp ? c.formatTime(card.facts.timestamp) : '',
      reactionText: cand && nz(cand.reactionCount) > 0 ? `${nz(cand.reactionCount)}` : '', weekText: ctxW && ctxW.weekN ? `Week ${ctxW.weekN}` : '',
      matchup: ctxW && ctxW.matchup ? ctxW.matchup : '', messageId: card.facts.messageId, threadGameId: ctxW && ctxW.gameId ? ctxW.gameId : '',
    });
    return {
      facts, headlineTitle: '', headlineBody: facts.body, freshness: facts.postedText,
      rows: compactRows(row('Week', facts.weekText), row('Game', facts.matchup), row('Reactions', facts.reactionText)),
      meaning: [],
      actions: [
        ...(c.capabilities.chat ? [act('open-chat', 'Open in chat', 'primary', { messageId: facts.messageId })] : []),
        ...threadActions(env, facts.threadGameId),
      ],
    };
  },

  'lockerroom.top'(env) {
    const { s, c } = env;
    const top = pickTopLockerRoomCandidate(s.chatLockerRoom, s.leagueId);
    if (!top) return null;
    const facts = finalizeDetailFacts('lockerroom.top', {
      body: top.body, authorName: nameIn(s, top.author) || top.authorName || 'Someone', postedText: top.ts ? c.formatTime(new Date(top.ts).toISOString()) : '',
      reactionText: nz(top.reactionCount) > 0 ? `${nz(top.reactionCount)}` : '', messageId: top.id,
    });
    return {
      facts, headlineBody: facts.body, freshness: facts.postedText,
      rows: compactRows(row('From', facts.authorName), row('Reactions', facts.reactionText)),
      meaning: [],
      actions: c.capabilities.chat ? [act('open-chat', 'Open in chat', 'primary', { messageId: facts.messageId })] : [],
    };
  },
};

/** W-92: the people on a combined card (feed-cards' `members`, already allow-listed by finalizeFacts). */
function membersOf(card) {
  return asArray(card && card.facts && card.facts.members).filter(m => m && isId(m.playerId) && isId(m.playerName));
}

/**
 * W-92 (DI-W92-6): the combined card's screen. ONE member: exactly the detail that member's own card opened before (its rows, lists,
 * sentences, See standings and "Compare with {name}"). TWO OR MORE: no rows; one section per member holding the rows that member's own
 * detail shows (label / value, at most four), one sentence, the group's actions — and no Compare (it compares with ONE member). Every
 * member's rows are built here, after the gate in buildCardDetailCore has passed (it runs at open and on every repaint); a member whose
 * rows cannot be built is omitted; none left = null (the calm unavailable state).
 */
function groupParts(env, perMember, { sentence, actions }) {
  const members = membersOf(env.card);
  if (!members.length) return null;
  const single = members.length === 1 ? members[0] : null;
  const tail = [...(single ? compareAction(env, single.playerId, single.playerName) : [])];
  if (single) {
    const p = perMember(env, single);
    if (!p) return null;
    return { facts: p.facts, freshness: eventFreshness(env), rows: p.rows, lists: p.lists || [], meaning: p.meaning, actions: [...p.actions, ...tail] };
  }
  const sections = [];
  for (const m of members) {
    let p = null;
    try { p = perMember(env, m); } catch { p = null; }
    if (!p) continue;
    sections.push({ key: m.playerId, title: m.playerName, items: asArray(p.rows).slice(0, 4).map(r => ({ key: `${m.playerId}:${r.label}`, primary: r.label, secondary: r.value })) });
  }
  if (!sections.length) return null;
  const facts = finalizeDetailFacts(env.card.type, { weekN: env.week.weekNumber, sections, sentence: sentence(sections.length, env.week) });
  if (!asArray(facts.sections).length) return null;
  return {
    facts, freshness: eventFreshness(env), rows: [],
    lists: facts.sections.map(sec => ({ id: `member-${sec.key}`, title: sec.title, items: sec.items })),
    meaning: [facts.sentence], actions: [...actions(env), ...tail],
  };
}

/** One member's standings detail (DI-576 row 9) — the figures from the SAME standings function over the SAME slice (Standings parity). */
function rankMember(env, m) {
  const { card, s, week } = env;
  const view = viewThrough(s, week);
  const stats = memberSeasonStats(m.playerId, view);
  let gapText = '';
  try {
    const { ids } = throughIds(view, week);
    const standings = calculateSeasonStandings(view.players, view.revealedWeeklyResults.filter(r => r && ids.has(r.weekId)), view.allWeeks, view.tieContexts);
    const mine = standings.find(x => x.playerId === m.playerId);
    const above = mine ? standings.find(x => x.currentRank === mine.currentRank - 1) : null;
    if (mine && above) { const gap = nz(above.totalCorrect) - nz(mine.totalCorrect); gapText = gap > 0 ? `${Number(gap.toFixed(1))} ${gap === 1 ? 'pick' : 'picks'} (weighted)` : 'Level on picks (a tiebreaker applies)'; }
  } catch { gapText = ''; }
  const facts = finalizeDetailFacts('rank.changed', {
    weekN: week.weekNumber, playerName: m.playerName, playerId: m.playerId, fromText: ordinal(m.fromRank), toText: `${ordinal(m.toRank)} of ${nz(card.facts.rankedCount)}`,
    winPctText: stats.winPct === null || stats.winPct === undefined ? '' : `${stats.winPct}%`,
    weeksText: stats.weeklyWins === null || stats.weeklyWins === undefined ? '' : dash(stats.weeklyWins, stats.weeklyLosses), gapText,
  });
  return {
    facts,
    rows: compactRows(row('From', facts.fromText), row('To', facts.toText), row('Season win %', facts.winPctText), row('Weeks won–lost', facts.weeksText), row('Gap to the rank above', facts.gapText)),
    meaning: [`${facts.playerName} moved from ${facts.fromText} to ${ordinal(m.toRank)} after Week ${facts.weekN}.`, 'Rank counts each game by its multiplier. Win % counts every pick once.'],
    actions: [act('go-standings', 'See standings', 'primary')],
  };
}

/** One member's milestone detail (DI-576 row 11): the mark, the season total and the pick that crossed it. */
function milestoneMember(env, m) {
  const { s, week } = env;
  const view = viewThrough(s, week);
  const { ids, weeks: wkThrough } = throughIds(view, week);
  const ordered = orderedGradedResults(m.playerId, s.revealedGames.filter(g => g && ids.has(g.weekId)), s.revealedPicks.filter(p => p && ids.has(p.weekId)), wkThrough);
  const wins = ordered.complete ? ordered.results.filter(r => r.result === 'win') : [];
  const crossing = wins[nz(m.mark) - 1] || null;
  const gameById = new Map(s.revealedGames.map(g => [g.gameId, g]));
  const pick = crossing ? s.revealedPicks.find(p => p && p.playerId === m.playerId && p.gameId === crossing.gameId) : null;
  const g = crossing ? gameById.get(crossing.gameId) : null;
  const games = g && pick ? [{ key: g.gameId, primary: matchupOf(g), secondary: pick.selectedTeam, mark: '✓', markWord: ' covered', tone: 'win' }] : [];
  const facts = finalizeDetailFacts('milestone.reached', {
    playerName: m.playerName, playerId: m.playerId, markText: `${nz(m.mark)} correct picks`, totalText: `${nz(m.total)}`, games,
  });
  return {
    facts,
    rows: compactRows(row('Mark', facts.markText), row('Season total', facts.totalText)),
    lists: [{ id: 'crossing', title: 'The pick that crossed it', items: facts.games || [] }],
    meaning: [`${facts.playerName} hit ${nz(m.mark)} correct picks this season.`],
    actions: [act('go-standings', 'See standings', 'primary')],
  };
}

/**
 * W-92 (DI-W92-6): the game result's "Called it" / "Stood alone" list — the retired called.it / stood.alone cards' rows, one per member the
 * card's own (already gated, allow-listed) `standout` names: the pick and its line, how it won, "against N". Other members' figures need the
 * S-C10 flag; without it there is no list.
 */
function standoutRows(env) {
  const { card, game } = env;
  const so = card.facts && card.facts.standout && typeof card.facts.standout === 'object' ? card.facts.standout : null;
  if (!so || !env.othersOk) return null;
  const by = Math.abs(nz(game.homeScore) - nz(game.awayScore));
  const line = so.spreadDisplay ? ` ${plain(so.spreadDisplay)}` : '';
  const m = atsMarginOf(game);
  const items = asArray(so.names).filter(n => n && isId(n.playerId) && isId(n.playerName)).map(n => {
    const bits = so.kind === 'alone'
      ? [plain(so.team), `against ${nz(so.against)}`, m === null ? '' : `covered by ${Number(m.toFixed(1))}`]
      : [`${plain(so.team)}${line}`, `won outright by ${by}`, so.kind === 'both' ? `against ${nz(so.against)}` : ''];
    return { key: n.playerId, primary: n.playerName, secondary: bits.filter(Boolean).join(' · ') };
  });
  if (!items.length) return null;
  return { title: so.kind === 'called' ? 'Called it' : so.kind === 'alone' ? 'Stood alone' : 'Called it and stood alone', items };
}

/** The Locker Room's top message of the day — feed-cards' own selection (reactions desc, oldest first, id), so the card and its detail can never name different messages. */
function pickTopLockerRoomCandidate(list, leagueId) {
  const pool = asArray(list).filter(r => r && typeof r === 'object' && !r.deleted && (r.leagueId === undefined || r.leagueId === null || r.leagueId === leagueId)
    && r.author !== 'scribe' && r.author !== 'system' && nz(r.reactionCount) > 0 && typeof r.body === 'string' && r.body.trim() && isId(String(r.id ?? '')));
  pool.sort((a, b) => (nz(b.reactionCount) - nz(a.reactionCount)) || (nz(a.ts) - nz(b.ts)) || String(a.id).localeCompare(String(b.id)));
  return pool[0] || null;
}

/** One member's streak detail (DI-576 row 10) — streak.extended and streak.broken share this layout. */
function streakMember(env, f) {
  const { card, s, week } = env;
  const view = viewThrough(s, week);
  const { ids, weeks: wkThrough } = throughIds(view, week);
  const games = s.revealedGames.filter(g => g && ids.has(g.weekId));
  const picks = s.revealedPicks.filter(p => p && ids.has(p.weekId));
  const ordered = orderedGradedResults(f.playerId, games, picks, wkThrough);
  if (!ordered.complete) return null;                                           // a sequence with a hole is worse than no sequence
  const broken = card.type === 'streak.broken';
  const results = ordered.results;
  const upto = broken ? results.filter(r => r.weekId !== week.weekId) : results;
  const run = runLength(upto);
  const inRun = upto.slice(upto.length - run.run);
  const gameById = new Map(games.map(g => [g.gameId, g]));
  const pickBy = new Map(picks.filter(p => p.playerId === f.playerId).map(p => [p.gameId, p]));
  const item = (r) => {
    const g = gameById.get(r.gameId), p = pickBy.get(r.gameId);
    if (!g || !p) return null;
    const win = r.result === 'win';
    return { key: g.gameId, primary: matchupOf(g), secondary: p.selectedTeam, mark: win ? '✓' : '✗', markWord: win ? ' covered' : ' missed', tone: win ? 'win' : 'loss' };
  };
  const items = inRun.slice().reverse().map(item).filter(Boolean).slice(0, STREAK_LIST_MAX);
  const startWeek = inRun.length ? view.revealedWeeks.find(w => w.weekId === inRun[0].weekId) : null;
  let snappedOn = '';
  if (broken) {
    const snap = results.filter(r => r.weekId === week.weekId).find(r => r.result !== run.result);
    const sg = snap ? gameById.get(snap.gameId) : null;
    snappedOn = sg ? matchupOf(sg) : '';
  }
  const stats = memberSeasonStats(f.playerId, view);
  const kindWord = streakWord(f.kind);
  const facts = finalizeDetailFacts(card.type, {
    playerName: f.playerName, playerId: f.playerId, runText: `${nz(f.run)} ${f.kind === 'misses' ? 'misses' : 'covers'}`,
    startedText: startWeek && hasWeekN(startWeek) ? `Week ${startWeek.weekNumber}` : '',
    longestText: stats.longestStreak && stats.longestStreak.run > 0 ? `${stats.longestStreak.run} ${stats.longestStreak.run === 1 ? 'cover' : 'covers'}` : '', games: items,
    sentence: broken ? (snappedOn ? `${f.playerName}'s ${nz(f.run)}-game streak snapped on ${snappedOn}.` : `${f.playerName}'s ${nz(f.run)}-game streak snapped this week.`) : `${f.playerName} is on a ${nz(f.run)}-game ${kindWord} streak.`,
  });
  return {
    facts,
    rows: compactRows(row('Run', facts.runText), row('Started', facts.startedText), row('Longest this season', facts.longestText)),
    lists: [{ id: 'run', title: broken ? 'The streak, newest first' : 'The run, newest first', items: facts.games || [] }],
    meaning: [facts.sentence],
    actions: [act('go-standings', 'See standings', 'primary')],
  };
}

// ═══ the markup (every dynamic string escaped at the sink — S-C6) ════════════════════════════════════════════════════════════════════════════════

/** A finished fragment from OUTSIDE (the Dashboard's own table rows) is SPLICED, never interpolated: the one place model markup is concatenated besides the templates below. */
const joinHtml = (parts) => parts.join('');

function listHTML(list, esc) {
  const items = asArray(list.items);
  const extra = items.length > LIST_PREVIEW;
  const lis = items.map((it, i) => {
    const mark = it.mark ? `<span class="cd-mark${it.tone ? ` cd-mark--${esc(it.tone)}` : ''}" ${it.markWord ? '' : 'aria-hidden="true"'}>${esc(it.mark)}${it.markWord ? `<span class="sr-only">${esc(it.markWord)}</span>` : ''}</span>` : '';
    const sec = it.secondary ? `<span class="cd-item-sub">${esc(it.secondary)}</span>` : '';
    return `<li class="cd-item${i >= LIST_PREVIEW ? ' cd-item--extra' : ''}" data-key="${esc(it.key || String(i))}"><span class="cd-item-main"><span class="cd-item-title">${esc(it.primary)}</span>${sec}</span>${mark}</li>`;
  }).join('');
  const more = extra ? `<button type="button" class="btn cd-more" data-cd-action="show-all" aria-expanded="false">Show all ${items.length}</button>` : '';
  return `<section class="card cd-card cd-list" data-cd-list="${esc(list.id)}" data-expanded="false" aria-labelledby="cd-h-${esc(list.id)}"><h4 class="cd-h" id="cd-h-${esc(list.id)}">${esc(list.title)}</h4><ul class="cd-items">${lis}</ul>${more}</section>`;
}

/** The detail screen body for a model. Pure string building; `escHtml` is REQUIRED (a missing one throws — there is no String() fallback). */
export function cardDetailHTML(model, { escHtml, iconHtml = '', actionIcons = {} } = {}) {
  const esc = requireEscHtml(escHtml, 'cardDetailHTML');
  if (!model || typeof model !== 'object') return unavailableDetailHTML({ escHtml });
  const m = model;
  const sport = m.eyebrow.sport ? `<span class="cd-sport">${esc(m.eyebrow.sport)}</span>` : '';
  const reason = m.eyebrow.reason ? `<span class="cd-reason">${esc(m.eyebrow.reason)}</span>` : '';
  const head = joinHtml([
    '<section class="card cd-card cd-head" aria-label="Summary">',
    joinHtml(['<div class="cd-eyebrow">', iconHtml, sport, reason, '</div>']),
    m.headline.title ? `<h3 class="cd-title">${esc(m.headline.title)}</h3>` : '',
    m.headline.body ? `<p class="cd-body${m.type === 'scribe.post' || m.type === 'lockerroom.top' ? ' cd-body--message' : ''}">${esc(m.headline.body)}</p>` : '',
    m.freshness ? `<p class="cd-fresh">${esc(m.freshness)}</p>` : '',
    '</section>',
  ]);
  const rows = m.rows.length ? joinHtml([
    '<section class="card cd-card cd-numbers" aria-labelledby="cd-h-numbers"><h4 class="cd-h" id="cd-h-numbers">The numbers</h4><dl class="cd-rows">',
    joinHtml(m.rows.map(r => `<div class="cd-row"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`)),
    '</dl></section>',
  ]) : '';
  const lists = joinHtml(asArray(m.lists).map(l => listHTML(l, esc)));
  const table = m.tableHtml ? joinHtml(['<section class="card cd-card cd-table" aria-label="Standings for the week"><table class="leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>✅</th><th>❌</th><th>Tiebreaker</th></tr></thead><tbody>', m.tableHtml, '</tbody></table></section>']) : '';
  const meaning = m.meaning.length ? `<section class="card cd-card cd-meaning" aria-labelledby="cd-h-meaning"><h4 class="cd-h" id="cd-h-meaning">What it means</h4>${m.meaning.map(t => `<p class="cd-sentence">${esc(t)}</p>`).join('')}</section>` : '';
  const note = m.note ? `<p class="cd-note">${esc(m.note)}</p>` : '';
  const actions = m.actions.length ? joinHtml([
    '<div class="cd-actions">',
    joinHtml(m.actions.map(a => `<button type="button" class="btn cd-action cd-action--${a.tone === 'primary' ? 'primary' : 'secondary'}" data-cd-action="${esc(a.id)}"${a.params && a.params.gameId ? ` data-cd-game="${esc(a.params.gameId)}"` : ''}${a.params && a.params.weekId ? ` data-cd-week="${esc(a.params.weekId)}"` : ''}${a.params && a.params.messageId ? ` data-cd-message="${esc(a.params.messageId)}"` : ''}${a.params && a.params.memberId ? ` data-cd-member="${esc(a.params.memberId)}"` : ''}>${a.id === 'share' && typeof actionIcons.share === 'string' ? actionIcons.share : ''}${esc(a.label)}</button>`)),   // (an action's icon is the app's own trusted markup, injected; never from the model)
    '</div>',
  ]) : '';
  return `<div class="cd" data-cd-type="${esc(m.type)}">${joinHtml([head, rows, lists, table, meaning, note, actions])}</div>`;
}

export const UNAVAILABLE_COPY = Object.freeze({
  title: "Details for this card aren't available right now.",
  body: 'It may have been updated or removed.',
  button: 'Back to Home',
});

/** The one calm state (DI-575): what happened, why, what to do next. Back also works. */
export function unavailableDetailHTML({ escHtml } = {}) {
  const esc = requireEscHtml(escHtml, 'unavailableDetailHTML');
  return `<div class="cd cd--unavailable"><section class="card cd-card cd-unavail" role="status"><h3 class="cd-title">${esc(UNAVAILABLE_COPY.title)}</h3><p class="cd-body">${esc(UNAVAILABLE_COPY.body)}</p><div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary" data-cd-action="back-home">${esc(UNAVAILABLE_COPY.button)}</button></div></section></div>`;
}

/** Test seam. */
export const _internals = { BUILDERS, finalizeDetailFacts, pickTopLockerRoomCandidate, viewThrough };
