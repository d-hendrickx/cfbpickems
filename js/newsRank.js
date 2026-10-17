/**
 * CFB Pickems — js/newsRank.js (Social Platform News, option A: ESPN headlines only; DI-376, 2026-10-01)
 * ======================================================================================================
 * PURE relevance ranking. ZERO IMPORT STATEMENTS (S-C10, asserted by newstest): every fact it needs is a plain argument, so it runs under
 * Node with no DOM or fetch stub and option B's transport can hand it the same shape unchanged.
 *
 * ── THE FOUR TIERS (highest wins, one label per item) ────────────────────────────────────────────────────────────────
 *   1 "Your pick"              a resolved team is one the VIEWER picked — only ever from ownPickTeamNames() (below), never hand-assembled
 *   2 "In this week's slate"   a resolved team is in this week's games
 *   3 "Your alma mater" / "Your team"   the viewer's alma mater / the other team chips in News settings
 *   4 the sport label          the item's sport is one the viewer follows (needs no slate, no picks: news renders any time, decision #7)
 * DI-376 AMENDMENT (coordinator, inline, 2026-10-01, reviewer F2): the viewer's own-pick tier is checked BEFORE the slate tier. A pick is almost always a game on the
 * slate, so with the slate first "Your pick" could never render (the first cut's tier 2 was unreachable); the tier NUMBERS follow the precedence (pick 1, slate 2) so a
 * picked team's article also sorts first. It stays blind-safe: the tier reads only ownPickTeams, which is ownPickTeamNames()'s fail-closed output for THE VIEWER — a
 * signed-out viewer or another player's pick yields no pick tier, and an article about a team only someone else picked reads as an ordinary slate item.
 * Then the 48-hour freshness window is a HARD filter, and the result is sorted by tier ascending, publishedAt descending, id ascending.
 * NEVER mutates its input (S-C9): every returned element is a NEW object `{ ...item, reason, relevanceTier }`.
 *
 * ── TEAM MATCHING — the one place accuracy really matters ────────────────────────────────────────────────────────────
 * Games store team NAMES ("Texas A&M"), never an ESPN id, so matching is by name against what ESPN tags an article with. Under-matching
 * (an item falls to a lower tier) is always preferred to over-matching (a wrong "Your pick" label is a trust defect). Three rules:
 *   (a) EXACT SHORT NAME. A real ESPN team category carries `team.shortDisplayName` ("Michigan State"). When an item carries
 *       `teamShortNames`, a candidate matches only by EQUALITY with a short name (or with the full description). A prefix match would let the
 *       candidate "Michigan" claim "Michigan State Spartans", which is the COMMON case (the DI's Texas / Texas A&M example assumed both
 *       schools were candidates). Verified against the live five-sport payloads, 2026-10-01.
 *   (b) LONGEST CANDIDATE, over the UNION of every tier's candidates. Items with no short names (any source that cannot supply them) fall
 *       back to the DI's prefix rule: "texas a&m aggies" prefix-matches both "Texas" and "Texas A&M"; the longer wins. It is resolved over
 *       ALL four candidate lists together, because resolving per list would let a slate "Texas" claim a Texas A&M article whose own team was
 *       only in the alma-mater list.
 *   (c) SPORT GATING. A school name is also a pro team's city ("Pittsburgh" / Steelers, "Houston" / Texans, "Miami" / Dolphins). Team tiers
 *       1-3 only fire for an item whose `sport` belongs to the candidate group (`teamSports`): the slate and picks to the league's sport,
 *       alma mater and team chips to college sports. Fail-safe defaults (cfb; cfb + cbb): a caller that forgets to pass `teamSports` under-matches.
 *
 * IMPORTS (D1 Lane C, DI-668 / DI-672): ONLY ./team-match.js and ./newsRules.js — both pure, both zero-import. S-C10's "no I/O, no AI" holds by construction.
 *
 * ── D1 (DI-484 / DI-672, 2026-10-08): AFTER the tiers ─────────────────────────────────────────────────────────────────
 *   1. READ-TIME DUPLICATES: an item whose id, canonical URL or dedupe key was already seen is removed, keeping the best tier, then the earlier time.
 *   2. GROUPING (DI-672): two items from DIFFERENT publishers are one story when their headline token sets (outlet credit removed) have Jaccard >= 0.8, they share a
 *      team key (or, when neither names a team, the sport), and they were published within 36 hours of each other. The group's visible card is the source with the
 *      LOWEST rank (ESPN 40, NCAA.com 42, CBS Sports 45, NBC Sports 47, Sports Illustrated 50, Fox News 60, Yahoo Sports 90); the others ride along as `alsoFrom`
 *      (publisher, headline, time, id, url, link hosts) so ATTRIBUTION IS NEVER LOST. Not clustered in D1: the same event under different headlines.
 *   3. PUBLISHER DIVERSITY (DI-484 10.2 #3): no publisher more than 2 times in a row, and at most 3 of the first 8. It only DELAYS an item; it never drops one.
 * Home selects from this order and PLACES by publish time (FB-010), so 3 shapes which 8 make the feed, never the chronology.
 * iOS 15.0 safe (no Object.hasOwn, no .at()).
 */

import { normTeam, resolveKnownTeamNames } from './team-match.js';
import { canonicalizeArticleUrl, headlineTokens, jaccard } from './newsRules.js';

export const NEWS_FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
/** An item dated more than this far ahead of `now` is never relevant (the transport already drops it; this is the second floor). */
export const NEWS_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const SPORT_LABELS = Object.freeze({ cfb: 'CFB', nfl: 'NFL', nba: 'NBA', nhl: 'NHL', cbb: 'CBB' });
/** Which item sports each candidate group may match (rule (c)). */
export const DEFAULT_TEAM_SPORTS = Object.freeze({ slate: ['cfb'], pick: ['cfb'], alma: ['cfb', 'cbb'], home: ['cfb', 'cbb'] });

const REASON_SLATE = "In this week's slate";
const REASON_PICK = 'Your pick';
const REASON_ALMA = 'Your alma mater';
const REASON_HOME = 'Your team';

const asArray = (v) => (Array.isArray(v) ? v : []);

// D1 Lane C (DI-668, 2026-10-08): normTeam and the longest-known-candidate rule MOVED, unchanged, to js/team-match.js so the News ranking, the Home content
// relevance (js/feed-relevance.js), the storyline tag (DI-663) and the server collector's matcher share ONE definition. Re-exported here so every existing caller
// and fixture keeps its import (newstest pins the two names as the SAME functions).
export const _normTeamForTest = normTeam;
export { resolveKnownTeamNames };

/** Normalized names (never the originals) of every candidate this item names: exact short-name entries, plus the prefix rule for entries with no short name. */
function matchedNames(item, allCandidateNorms) {
  const matched = new Set();
  const descs = asArray(item.teamNames);
  const shorts = asArray(item.teamShortNames);
  const needPrefix = [];
  for (let i = 0; i < descs.length; i++) {
    const desc = normTeam(descs[i]);
    const short = normTeam(shorts[i]);
    if (!desc && !short) continue;
    if (short) {                                                  // rule (a): equality only, never a prefix
      if (allCandidateNorms.has(short)) matched.add(short);
      if (desc && allCandidateNorms.has(desc)) matched.add(desc);
    } else if (desc) {
      needPrefix.push(desc);
    }
  }
  if (needPrefix.length) {                                        // rule (b): the DI's longest match over the union of every list
    const resolved = resolveKnownTeamNames(needPrefix, Array.from(allCandidateNorms));
    for (const r of resolved) matched.add(normTeam(r));
  }
  return matched;
}

function sportsFor(teamSports, group) {
  const given = teamSports && typeof teamSports === 'object' ? teamSports[group] : undefined;
  return Array.isArray(given) ? given : DEFAULT_TEAM_SPORTS[group];
}

/**
 * @param {object[]} items   NewsItem-shaped (publishedAt, sport, teamNames[, teamShortNames], id)
 * @returns {object[]}       a NEW array of NEW objects, freshness-filtered, reason / relevanceTier populated, sorted
 */
export function rankNews(items, {
  slateTeams = [],      // this week's game team names (tier 2)
  ownPickTeams = [],    // the VIEWER'S OWN picked team names — the output of ownPickTeamNames(), never hand-assembled at the call site (tier 1)
  almaMaterTeams = [],  // [player.almaMater] when set, else [] (tier 3 "Your alma mater")
  homeTeams = [],       // News-settings team chips beyond the alma mater (tier 3 "Your team")
  enabledSports = [],   // the viewer's opted-in sport keys (tier 4)
  teamSports,           // optional { slate, pick, alma, home } -> sport keys each group may match (rule (c)); see DEFAULT_TEAM_SPORTS
  slateTeamsBySport = null,     // review B2 (2026-10-14): optional { cfb: [...], nfl: [...] } — a league that plays both sports: an item matches the slate of ITS OWN sport only
  ownPickTeamsBySport = null,   //   …and the viewer's picks of its own sport only (each replaces the flat list and teamSports for its group when given)
  now = Date.now(),
} = {}) {
  const groups = {
    slate: new Set(asArray(slateTeams).map(normTeam).filter(Boolean)),
    pick: new Set(asArray(ownPickTeams).map(normTeam).filter(Boolean)),
    alma: new Set(asArray(almaMaterTeams).map(normTeam).filter(Boolean)),
    home: new Set(asArray(homeTeams).map(normTeam).filter(Boolean)),
  };
  const bySport = (m) => {
    const out = new Map();
    if (m && typeof m === 'object' && !Array.isArray(m)) for (const k of Object.keys(m)) out.set(k, new Set(asArray(m[k]).map(normTeam).filter(Boolean)));
    return out;
  };
  const sportGroups = { slate: slateTeamsBySport ? bySport(slateTeamsBySport) : null, pick: ownPickTeamsBySport ? bySport(ownPickTeamsBySport) : null };
  const allCandidateNorms = new Set([...groups.slate, ...groups.pick, ...groups.alma, ...groups.home]);
  for (const m of [sportGroups.slate, sportGroups.pick]) if (m) for (const set of m.values()) for (const n of set) allCandidateNorms.add(n);
  const sports = asArray(enabledSports);
  const out = [];
  for (const item of asArray(items)) {
    if (!item || typeof item !== 'object') continue;
    const published = Date.parse(item.publishedAt);
    if (!Number.isFinite(published)) continue;                   // fail closed: an item with no real date is never relevant
    const age = now - published;
    if (age > NEWS_FRESHNESS_WINDOW_MS || age < -NEWS_FUTURE_SKEW_MS) continue;

    let tier = null, reason = null;
    if (allCandidateNorms.size) {
      const named = matchedNames(item, allCandidateNorms);
      const hit = (group) => {
        const per = sportGroups[group];
        if (per) { const set = per.get(item.sport); return !!set && Array.from(set).some((n) => named.has(n)); }
        return sportsFor(teamSports, group).indexOf(item.sport) >= 0 && Array.from(groups[group]).some((n) => named.has(n));
      };
      if (hit('pick')) { tier = 1; reason = REASON_PICK; }                 // the viewer's OWN pick first (DI-376 amendment, F2)
      else if (hit('slate')) { tier = 2; reason = REASON_SLATE; }
      else if (hit('alma')) { tier = 3; reason = REASON_ALMA; }
      else if (hit('home')) { tier = 3; reason = REASON_HOME; }
    }
    if (tier === null && sports.indexOf(item.sport) >= 0 && Object.prototype.hasOwnProperty.call(SPORT_LABELS, item.sport)) { tier = 4; reason = SPORT_LABELS[item.sport]; }
    if (tier === null) continue;                                 // nothing to attribute it to
    out.push({ ...item, reason, relevanceTier: tier });
  }
  out.sort((a, b) => (a.relevanceTier - b.relevanceTier)
    || (Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  return applyPublisherDiversity(groupDuplicateCoverage(dedupeAtReadTime(out)));
}

// ═══ D1 (DI-484 / DI-672) ═══════════════════════════════════════════════════════════════════════════════════════════════

/** The dedupe rank by publisher when an item carries none of its own (the registry's `rank`; lower wins a duplicate). */
export const PUBLISHER_RANK = Object.freeze({ 'ESPN': 40, 'NCAA.com': 42, 'CBS Sports': 45, 'NBC Sports': 47, 'Sports Illustrated': 50, 'Fox News': 60, 'Yahoo Sports': 90 });
export const GROUP_JACCARD = 0.8;
export const GROUP_WINDOW_MS = 36 * 60 * 60 * 1000;
const rankOf = (it) => (Number.isFinite(it.rank) ? it.rank : Object.prototype.hasOwnProperty.call(PUBLISHER_RANK, it.publisher || it.source) ? PUBLISHER_RANK[it.publisher || it.source] : 50);
const timeOf = (it) => Date.parse(it.publishedAt);

/** (1) Read-time duplicates (DI-484 10.2 #4): by id, canonical URL, then dedupe key — the best tier wins, then the earlier time. Input order (tier, time) is the priority. */
export function dedupeAtReadTime(sorted) {
  const out = [];
  const seenId = new Set(), seenUrl = new Set(), seenKey = new Set();
  const byPriority = asArray(sorted).slice().sort((a, b) => (a.relevanceTier - b.relevanceTier) || (timeOf(a) - timeOf(b)));
  const keep = new Set();
  for (const it of byPriority) {
    const url = typeof it.url === 'string' ? canonicalizeArticleUrl(it.url) || it.url : '';
    const key = typeof it.dedupeKey === 'string' && it.dedupeKey ? `${it.publisher || it.source}|${it.dedupeKey}` : '';
    if (seenId.has(it.id) || (url && seenUrl.has(url)) || (key && seenKey.has(key))) continue;
    seenId.add(it.id); if (url) seenUrl.add(url); if (key) seenKey.add(key);
    keep.add(it);
  }
  for (const it of asArray(sorted)) if (keep.has(it)) out.push(it);
  return out;
}

/** (2) DI-672 grouping. Returns NEW objects; a kept item gains `alsoFrom` (frozen entries) and `clusterId`. */
export function groupDuplicateCoverage(items) {
  const list = asArray(items);
  const outlets = Object.keys(PUBLISHER_RANK);
  const toks = list.map((it) => headlineTokens(it.headline, outlets));
  const keysOf = (it) => new Set(asArray(it.teamKeys).length ? asArray(it.teamKeys) : asArray(it.teamNames).map(normTeam));
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if ((a.publisher || a.source) === (b.publisher || b.source)) continue;
      if (Math.abs(timeOf(a) - timeOf(b)) > GROUP_WINDOW_MS) continue;
      const ka = keysOf(a), kb = keysOf(b);
      const teamLink = ka.size && kb.size ? Array.from(ka).some((k) => kb.has(k)) : (!ka.size && !kb.size && a.sport === b.sport);
      if (!teamLink) continue;
      if (jaccard(toks[i], toks[j]) < GROUP_JACCARD) continue;
      parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  list.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  const visible = new Map();
  for (const members of groups.values()) {
    if (members.length === 1) { visible.set(members[0], { item: members[0], also: [] }); continue; }
    const lead = members.slice().sort((a, b) => (rankOf(a) - rankOf(b)) || (timeOf(a) - timeOf(b)) || (String(a.id) < String(b.id) ? -1 : 1))[0];
    // the lead keeps the best tier the group earned (a duplicate's "Your pick" must not vanish with the duplicate)
    const tier = Math.min(...members.map((m) => (Number.isFinite(m.relevanceTier) ? m.relevanceTier : 99)));
    const best = members.find((m) => m.relevanceTier === tier) || lead;
    const also = members.filter((m) => m !== lead).map((m) => Object.freeze({
      id: m.id, publisher: m.publisher || m.source, via: m.via || null, headline: m.headline, publishedAt: m.publishedAt, url: m.url,
      linkHosts: Array.isArray(m.linkHosts) ? m.linkHosts : null,
    }));
    visible.set(lead, { item: { ...lead, relevanceTier: best.relevanceTier, reason: best.reason }, also });
  }
  const out = [];
  for (const it of list) {
    const v = visible.get(it);
    if (!v) continue;                                             // a duplicate that rides along in its lead's alsoFrom
    out.push(v.also.length ? { ...v.item, alsoFrom: Object.freeze(v.also), clusterId: `cl_${v.item.id}` } : v.item);
  }
  return out;
}

/** (3) DI-484 10.2 #3: no publisher > 2 in a row; at most 3 of the first 8. Only DELAYS; never drops; never stalls when every remaining item shares a publisher. */
export function applyPublisherDiversity(sorted, { maxConsecutive = 2, maxInFirstN = 3, firstN = 8 } = {}) {
  const queue = asArray(sorted).slice(), out = [], counts = new Map();
  const pub = (it) => it.publisher || it.source;
  while (queue.length) {
    let pick = 0;
    for (let i = 0; i < queue.length; i++) {
      const p = pub(queue[i]);
      const tail = out.slice(-maxConsecutive);
      const breaksRun = !(tail.length === maxConsecutive && tail.every((x) => pub(x) === p));
      const underCap = out.length >= firstN || (counts.get(p) || 0) < maxInFirstN;
      if (breaksRun && underCap) { pick = i; break; }
    }
    const [it] = queue.splice(pick, 1);
    out.push(it);
    if (out.length <= firstN) counts.set(pub(it), (counts.get(pub(it)) || 0) + 1);
  }
  return out;
}

/**
 * S-C2 (BLOCKING) — the ONE place "the viewer's own picks" is computed, fail-closed by construction. Pure, zero imports.
 *
 * `getPicks(weekId, playerId)` SKIPS its player filter when `playerId` is falsy, so `getPicks(weekId, null)` returns EVERY player's picks.
 * This function therefore never trusts that `picks` arrives pre-filtered: it returns [] outright when the viewer id is not a non-empty
 * string (before it looks at a single pick), does its OWN `pick.playerId === viewerPlayerId` filtering, and refuses a pick whose
 * `selectedTeam` is neither team of its own game. The caller passes the FULL week's picks and games plus the viewer's id.
 */
export function ownPickTeamNames(picks, games, viewerPlayerId) {
  if (typeof viewerPlayerId !== 'string' || !viewerPlayerId.trim()) return [];
  const gameById = new Map(asArray(games).filter((g) => g && typeof g === 'object').map((g) => [g.gameId, g]));
  const out = new Set();
  for (const pick of asArray(picks)) {
    if (!pick || pick.playerId !== viewerPlayerId) continue;     // this function does its OWN filtering
    const game = gameById.get(pick.gameId);
    if (!game) continue;
    const selected = String(pick.selectedTeam || '');
    if (selected && (selected === game.homeTeam || selected === game.awayTeam)) out.add(selected);
  }
  return Array.from(out);
}
