/**
 * CFB Pickems — feed-caption-lines.js (Social Platform v1 Home, DI-363 / S-C12, 2026-09-30)
 * ========================================================================================
 * SCRIBE's Home-feed caption pools, from `SCRIBE_CAPTIONS_HOME_092726.md` (coordinator PASS
 * WITH NOTES), as a PURE sibling of js/feed-cards.js — deliberately NOT folded into
 * `SCRIBE_POOLS` in js/scribeLines.js, whose rate limiter / 14-day reuse ledger / `sendEvent`
 * machinery these captions must not inherit: a Home card sits at a fixed position tied to its
 * own event, so the correct behaviour is the SAME caption every time that SAME card renders,
 * on every device, forever.
 *
 * SELECTION IS DETERMINISTIC BY THE CARD'S OWN STABLE ID (UN-330): `hash32(card.id) %
 * eligible.length` — never `Math.random()`, never a day bucket. Six devices therefore show
 * byte-identical caption text with no dedupe layer at all. Eligible lines are filtered to
 * those whose placeholders are all PRESENT before hashing, so no line ever renders an empty or
 * `undefined` slot.
 *
 * S-C12 — EVERY PLACEHOLDER IS MAPPED EXPLICITLY to a `CARD_ALLOWED_FACTS` key (or a
 * presentation string derived from allowed keys), in `CAPTION_FACT_MAP` below. The caption
 * document's `{margin}` maps to this module's `scoreLine`; `margin` is a FORBIDDEN_META_KEYS
 * entry and is never a fact key. The substitution is CLOSED: only a pool's mapped placeholders
 * can be filled, and a token left unmapped THROWS rather than rendering a hole. feedcardstest
 * proves every pool resolves within its card type's allow-list and that no banned vocabulary
 * (sportsbook slang, the debt ledger) appears in any line.
 *
 * THE TWO ALMA-MATER LINES ARE LIVE (2026-10-01): `player.week.good` #4 and `player.week.bad` #5 need
 * an `almaMaterResult` clause, and the DI-362 AMENDMENT (approved inline by the coordinator) added
 * that one fact to `player.week` — `{ team, result:'win'|'loss' }`, the member's school's STRAIGHT-UP
 * result that week, after-final only. The clause is derived here ("Texas A&M won" / "Texas A&M lost");
 * the lines are eligible only on a card that carries the fact, and #5 ("… and X lost too.") only on a
 * LOSS, so the "too" reads. All 88 of the document's lines are therefore selectable;
 * `WITHHELD_CAPTION_LINES` stays as an (empty) export so a future withheld line has a home.
 *
 * ONE PLACEHOLDER IS ADDED TO THE DOCUMENT'S TEXT: `{reactionWord}` ("reaction" / "reactions") replaces the
 * literal "reactions" after `{reactionCount}` in the Locker Room pool, so a single reaction no longer reads
 * "1 reactions" (reviewer note 5). A mechanical pluralization, not a rewording.
 *
 * ONE LINE IS REWORDED: `stood.alone` #2 read "Everyone else faded {team}…" — "faded" is
 * sportsbook slang the Munera brand rules avoid (the document's own coordinator note). It now
 * reads "Everyone else went the other way on {team}…".
 *
 * Every line is Dry and carries zero emoji, by the document's own (accepted) judgment call.
 */

import { CARD_ALLOWED_FACTS, requireEscHtml, ordinal, streakWord, deepFreeze } from './feed-cards.js';

// ── the pools (placeholders use the caption document's own lowerCamelCase names) ──
// A line is a string, or `{ t, when }` where `when` names a closed predicate below.

export const CAPTION_POOLS = deepFreeze({
  'picks.submitted': [
    '{submittedCount} of {totalPlayers} in for Week {weekN}.',
    'Week {weekN}: {submittedCount}/{totalPlayers} picks submitted.',
    '{submittedCount} out of {totalPlayers} have locked in their picks for Week {weekN}.',
    'Submissions for Week {weekN}: {submittedCount} of {totalPlayers} so far.',
    { t: '{submittedCount}/{totalPlayers} in for Week {weekN}. The rest know who they are.', when: 'notAllIn' },
  ],
  'week.result': [
    '{winner} took Week {weekN} at {winnerRecord}. {loser} closes it out at {loserRecord}.',
    'Week {weekN}, final: {winner} {winnerRecord}, {loser} {loserRecord}. Draw your own conclusions.',
    '{winner} wins Week {weekN}, {winnerRecord}. {loser} owns the other end of it.',
    "That's Week {weekN} — {winner} on top at {winnerRecord}, {loser} on the bottom at {loserRecord}.",
    'Week {weekN} is in the books. {winner} {winnerRecord}, {loser} {loserRecord}.',
    '{winner} closes Week {weekN} {winnerRecord}. {loser} finishes {loserRecord}, which is its own kind of achievement.',
  ],
  'called.it': [
    '{player} called it. {team} covers as the underdog and wins outright, {margin}.',
    "{team} wasn't supposed to win that one straight up. {player} had it anyway.",
    '{player} took {team} as the dog in {matchup} and got the outright win, {margin}.',
    'Upset called: {player} on {team}, {margin}.',
    '{team} won outright as the underdog in {matchup}. {player} saw it coming.',
    '{player} picked the underdog in {matchup} and {team} won the whole thing, {margin}.',
  ],
  'stood.alone': [
    '{player} was the only one on {team} in {matchup}. Covered anyway.',
    "Everyone else went the other way on {team}. {player} didn't, and it covered.",
    '{player} stood alone on {team} against {against} others. Paid off.',
    'One player on {team}, {against} on the other side. {player} was the one.',
    '{player} took {team} solo in {matchup}. The lone pick covered.',
    '{against} players went the other way on {matchup}. {player} covered alone on {team}.',
  ],
  'player.week.good': [
    "{player}'s Week {weekN}: {record}.",
    '{player} went {record} in Week {weekN}. Somebody had to.',
    "{player} posted {record} this week — that's a {runLength}-game {streakWord} streak now.",
    '{record} for {player} in Week {weekN}, and {almaMaterResult}.',
    'Week {weekN}: {player} {record}. On to the next one.',
    '{player}: {record} in Week {weekN}. Nothing more to add.',
  ],
  'player.week.bad': [
    "{player}'s Week {weekN}: {record}. Rough.",
    '{record} for {player} in Week {weekN}. It happens.',
    '{player} went {record} this week. Not the plan, presumably.',
    "Week {weekN}, {player}: {record}. That's the number.",
    { t: '{record} for {player} in Week {weekN}, and {almaMaterResult} too.', when: 'almaLost' },
    '{player}: {record} in Week {weekN}. Next week is a clean slate.',
  ],
  'streak.extended': [
    "{player}'s {streakWord} streak is up to {runLength}.",
    '{runLength} in a row now for {player}. Still going.',
    '{player} extended the {streakWord} streak to {runLength} this week.',
    "That's {runLength} straight for {player}. The streak's not done talking.",
    "{player}'s {streakWord} streak: {runLength} and counting.",
    "{runLength}-game {streakWord} streak for {player}. Somebody's paying attention to spreads.",
  ],
  'streak.broken': [
    "{player}'s {runLength}-game {streakWord} streak is over.",
    "That's the end of {player}'s {streakWord} streak, at {runLength}.",
    '{runLength} in a row for {player}, snapped this week.',
    "{player}'s {streakWord} streak stops at {runLength}.",
    'Streak over. {player} had a {runLength}-game run of {kind}.',
    '{player} rode the {streakWord} streak to {runLength}. Then it ended.',
  ],
  'rank.changed.up': [
    '{player} moved from {fromRank} to {toRank} this week.',
    '{player} climbed to {toRank}, up from {fromRank}.',
    '{player} climbed from {fromRank} to {toRank}.',
    'Movement in the standings: {player}, {fromRank} to {toRank}.',
    '{player} jumped from {fromRank} to {toRank}.',
  ],
  'rank.changed.down': [
    '{player} slipped from {fromRank} to {toRank}.',
    '{player} dropped to {toRank}, down from {fromRank}.',
    '{player} fell from {fromRank} to {toRank} this week.',
    'Movement in the standings: {player}, {fromRank} down to {toRank}.',
    '{player} is down to {toRank}. Was {fromRank}.',
  ],
  'rank.changed.into1st': [
    '{player} is your new No. 1, up from {fromRank}.',
    '{player} moved into first, from {fromRank}.',
    'New name at the top of the standings: {player}, up from {fromRank}.',
    '{player} climbed all the way from {fromRank} to first.',
    'First place has a new name: {player}.',
  ],
  'rank.changed.intoLast': [
    '{player} is in last place now, down from {fromRank}.',
    '{player} dropped all the way to the bottom, from {fromRank}.',
    'New occupant of last place: {player}, previously {fromRank}.',
    '{player} fell from {fromRank} to the bottom of the standings.',
    'Last place has a new name: {player}.',
  ],
  'milestone.reached': [
    '{player} crossed {mark} correct picks. Total sits at {total}.',
    '{mark} correct picks for {player}. Total: {total}.',
    '{player} hit the {mark} mark. {total} correct and counting.',
    "That's {mark} correct picks for {player}. {total} on the total.",
    "{player}'s correct-pick count passed {mark}. Sitting at {total} now.",
    '{mark} correct picks, {player}. Not a small number.',
  ],
  'year.ago': [
    'A year ago, Week {weekN}: {name} had {record}.',
    'Same week last year, {name} posted {record}.',
    "Last year's Week {weekN}: {name}, {record}. History repeats, sometimes.",
    'A year ago this week, {name} put up {record}. Still on the record.',
    'Week {weekN}, 2025: {name} finished with {record}.',
    'This week in 2025, {name} got {record}.',
  ],
  'year.ago.superlative': [
    'A year ago this week, {name} put up {record} — {superlative}.',
    'Same week, 2025: {name} posted {record}. Still {superlative}.',
    "Week {weekN} last year belonged to {name}, {record}. That's {superlative}, still standing.",
    '{name} had {record} this week in 2025 — {superlative}.',
  ],
  'lockerroom.top': [
    "Today's top message in the Locker Room: {author}, {reactionCount} {reactionWord}.",
    '{author} is winning the Locker Room today, {reactionCount} {reactionWord} and counting.',
    'Most-reacted message today: {author}, {reactionCount} {reactionWord}.',
    "{author}'s message is the one everyone reacted to today — {reactionCount} and counting.",
    "{reactionCount} {reactionWord} on {author}'s message today. That's today's number to beat.",
  ],
});

/** Lines the caption document offers that are NOT selectable. Empty since the alma-mater fact landed (2026-10-01). */
export const WITHHELD_CAPTION_LINES = deepFreeze({});

// ── S-C12: every placeholder -> an allow-listed fact key (or a presentation string derived from allowed keys) ──
// `fields`: placeholder -> the CARD_ALLOWED_FACTS key it reads directly.
// `derived`: placeholder -> { from: [allowed keys it is computed from], make(facts) }.
const rec = (f) => `${f.wins}–${f.losses}`;
// "Texas A&M won" / "Texas A&M lost": the team is the GAME ROW's spelling, carried on the fact (never the player's free text).
const almaClause = (f) => `${f.almaMaterResult.team} ${f.almaMaterResult.result === 'win' ? 'won' : 'lost'}`;
// The CAPTION_FACT_MAP is DEEP-frozen (security N1): a placeholder map is not editable at runtime.
export const CAPTION_FACT_MAP = deepFreeze({
  'picks.submitted': { cardType: 'picks.submitted', fields: { submittedCount: 'submittedCount', totalPlayers: 'totalPlayers', weekN: 'weekN' }, derived: {} },
  'week.result': { cardType: 'week.result', fields: { winner: 'weekWinnerName', winnerRecord: 'weekWinnerRecord', loser: 'weekLoserName', loserRecord: 'weekLoserRecord', weekN: 'weekN' }, derived: {} },
  // `margin` is the caption document's NAME for the pre-formatted score string; the FACT it reads is `scoreLine`.
  'called.it': { cardType: 'called.it', fields: { player: 'playerName', team: 'team', matchup: 'matchup', margin: 'scoreLine' }, derived: {} },
  'stood.alone': { cardType: 'stood.alone', fields: { player: 'playerName', team: 'team', matchup: 'matchup', against: 'against' }, derived: {} },
  'player.week.good': { cardType: 'player.week', fields: { player: 'playerName', weekN: 'weekN' }, derived: {
    record: { from: ['wins', 'losses'], make: rec },
    runLength: { from: ['streakRun'], make: (f) => f.streakRun },
    streakWord: { from: ['streakKind'], make: (f) => streakWord(f.streakKind) },
    almaMaterResult: { from: ['almaMaterResult'], make: almaClause },
  } },
  'player.week.bad': { cardType: 'player.week', fields: { player: 'playerName', weekN: 'weekN' }, derived: {
    record: { from: ['wins', 'losses'], make: rec },
    almaMaterResult: { from: ['almaMaterResult'], make: almaClause },
  } },
  'streak.extended': { cardType: 'streak.extended', fields: { player: 'playerName', kind: 'kind' }, derived: {
    runLength: { from: ['run'], make: (f) => f.run },
    streakWord: { from: ['kind'], make: (f) => streakWord(f.kind) },
  } },
  'streak.broken': { cardType: 'streak.broken', fields: { player: 'playerName', kind: 'kind' }, derived: {
    runLength: { from: ['run'], make: (f) => f.run },
    streakWord: { from: ['kind'], make: (f) => streakWord(f.kind) },
  } },
  'rank.changed.up': { cardType: 'rank.changed', fields: { player: 'playerName' }, derived: {
    fromRank: { from: ['fromRank'], make: (f) => ordinal(f.fromRank) }, toRank: { from: ['toRank'], make: (f) => ordinal(f.toRank) },
  } },
  'rank.changed.down': { cardType: 'rank.changed', fields: { player: 'playerName' }, derived: {
    fromRank: { from: ['fromRank'], make: (f) => ordinal(f.fromRank) }, toRank: { from: ['toRank'], make: (f) => ordinal(f.toRank) },
  } },
  'rank.changed.into1st': { cardType: 'rank.changed', fields: { player: 'playerName' }, derived: {
    fromRank: { from: ['fromRank'], make: (f) => ordinal(f.fromRank) },
  } },
  'rank.changed.intoLast': { cardType: 'rank.changed', fields: { player: 'playerName' }, derived: {
    fromRank: { from: ['fromRank'], make: (f) => ordinal(f.fromRank) },
  } },
  'milestone.reached': { cardType: 'milestone.reached', fields: { player: 'playerName', mark: 'mark', total: 'total' }, derived: {} },
  'year.ago': { cardType: 'year.ago', fields: { name: 'name', record: 'record', weekN: 'weekN' }, derived: {} },
  'year.ago.superlative': { cardType: 'year.ago', fields: { name: 'name', record: 'record', weekN: 'weekN', superlative: 'superlative' }, derived: {} },
  'lockerroom.top': { cardType: 'lockerroom.top', fields: { author: 'authorName', reactionCount: 'reactionCount' }, derived: {
    reactionWord: { from: ['reactionCount'], make: (f) => (Number(f.reactionCount) === 1 ? 'reaction' : 'reactions') },
  } },
});

// A card type's allow-list is the ceiling for everything the map may read.
for (const [pool, m] of Object.entries(CAPTION_FACT_MAP)) {
  const allowed = CARD_ALLOWED_FACTS[m.cardType] || [];
  const reads = [...Object.values(m.fields), ...Object.values(m.derived).flatMap(d => d.from)];
  for (const k of reads) {
    if (!allowed.includes(k)) throw new Error(`[feed-caption-lines] pool ${pool} reads fact ${k}, which ${m.cardType} does not allow-list`);
  }
}

/** Closed predicates a `{ t, when }` line may name. */
const WHEN = Object.freeze({
  notAllIn: (f) => Number(f.submittedCount) < Number(f.totalPlayers),
  // "… and Texas A&M lost too." only reads after a BAD week and only when the school itself lost.
  almaLost: (f) => !!f.almaMaterResult && f.almaMaterResult.result === 'loss',
});

/** Words no caption line may ever contain (the doc's banned-vocabulary list; "faded" added by its coordinator note). */
export const CAPTION_BANNED_VOCAB = Object.freeze([
  /\bbets?\b/i, /\bbetting\b/i, /\bwager(?:s|ed)?\b/i, /\bodds\b/i, /\bunits?\b/i, /\broi\b/i,
  /\bdrinks?\b/i, /\btabs?\b/i, /\bowe(?:s|d)?\b/i, /\bthe chart\b/i, /\bfaded?\b/i,
]);

// ── selection ──

/** FNV-1a, 32-bit — a tiny, dependency-free, deterministic string hash. */
export function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Which pool a card draws from, or null for a type that is not captioned in v1. */
export function captionPoolFor(card) {
  if (!card || !card.type) return null;
  const f = card.facts || {};
  switch (card.type) {
    case 'picks.submitted': case 'week.result': case 'called.it': case 'stood.alone':
    case 'streak.extended': case 'streak.broken': case 'milestone.reached': case 'lockerroom.top':
      return card.type;
    case 'player.week': return Number(f.wins) < Number(f.losses) ? 'player.week.bad' : 'player.week.good';
    case 'rank.changed': {
      const to = Number(f.toRank), from = Number(f.fromRank), n = Number(f.rankedCount);
      if (to === 1) return 'rank.changed.into1st';
      if (n > 1 && to === n) return 'rank.changed.intoLast';
      return to < from ? 'rank.changed.up' : 'rank.changed.down';
    }
    case 'year.ago': return f.superlative ? 'year.ago.superlative' : 'year.ago';
    default: return null; // slate.published, week.revealed, game.final, scribe.post — not captioned in v1
  }
}

/** Resolves every mapped placeholder for a card, or `null` for any fact that is absent. */
function resolveValues(pool, facts) {
  const m = CAPTION_FACT_MAP[pool];
  const values = {};
  for (const [ph, key] of Object.entries(m.fields)) {
    const v = facts[key];
    values[ph] = v === undefined || v === null || v === '' ? null : String(v);
  }
  for (const [ph, d] of Object.entries(m.derived)) {
    values[ph] = d.from.every(k => facts[k] !== undefined && facts[k] !== null && facts[k] !== '') ? String(d.make(facts)) : null;
  }
  return values;
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_m, k) => {
    if (!Object.prototype.hasOwnProperty.call(values, k) || values[k] === null) {
      throw new Error(`[feed-caption-lines] placeholder {${k}} is not mapped/present for this pool`);
    }
    return values[k];
  });
}

/**
 * The caption for a card as PLAIN TEXT — UNESCAPED, and named to say so (security C4, 2026-10-01; it
 * was `captionTextFor`, a name that read as the normal entry point). It exists for TESTS and for
 * `captionFor` below, which escapes its result. It has NO consumer outside this file and the test
 * suites — feedcardstest [10] scans js/ and fails if any other module names it — because a caption
 * built from facts that can carry a player's name or a team string is attacker-influenced text.
 * Anything that reaches the DOM goes through `captionFor`.
 * Returns '' when the type is not captioned or no line is eligible.
 */
export function captionTextUnsafeForTests(card) {
  const pool = captionPoolFor(card);
  if (!pool || !card.id) return '';
  const facts = card.facts || {};
  const values = resolveValues(pool, facts);
  const eligible = [];
  for (const line of CAPTION_POOLS[pool]) {
    const t = typeof line === 'string' ? line : line.t;
    if (typeof line === 'object' && line.when && !(WHEN[line.when] && WHEN[line.when](facts))) continue;
    const tokens = [...t.matchAll(/\{(\w+)\}/g)].map(x => x[1]);
    if (tokens.every(k => Object.prototype.hasOwnProperty.call(values, k) && values[k] !== null)) eligible.push(t);
  }
  if (!eligible.length) return '';
  return fill(eligible[hash32(card.id) % eligible.length], values);
}

/** The caption, ESCAPED through the injected escaper (S-C6 — a missing escHtml throws). */
export function captionFor(card, { escHtml } = {}) {
  const esc = requireEscHtml(escHtml, 'captionFor');
  return esc(captionTextUnsafeForTests(card));
}
