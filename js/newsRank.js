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
 * iOS 15.0 safe (no Object.hasOwn, no .at()).
 */

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

/** Lower-case, NFKC, `&` as "and", apostrophes dropped, everything else non-alphanumeric a single space. Linear; no nested quantifiers. */
function normTeam(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/['‘’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export const _normTeamForTest = normTeam;

/**
 * The DI's longest-known-candidate match: each description resolves to AT MOST ONE candidate, the LONGEST whose normalized form equals the
 * description or is a whole-word prefix of it ("texas a and m aggies" -> "Texas A&M", not "Texas"). Returns the ORIGINAL candidate strings.
 * An unresolved description yields nothing (never a guess).
 */
export function resolveKnownTeamNames(descriptions, candidates) {
  const out = new Set();
  const cands = [];
  for (const c of asArray(candidates)) {
    const n = normTeam(c);
    if (n) cands.push({ n, original: c });
  }
  for (const raw of asArray(descriptions)) {
    const desc = normTeam(raw);
    if (!desc) continue;
    let best = null;
    for (const c of cands) {
      if (desc === c.n || desc.startsWith(c.n + ' ')) { if (!best || c.n.length > best.n.length) best = c; }
    }
    if (best) out.add(best.original);
  }
  return Array.from(out);
}

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
  now = Date.now(),
} = {}) {
  const groups = {
    slate: new Set(asArray(slateTeams).map(normTeam).filter(Boolean)),
    pick: new Set(asArray(ownPickTeams).map(normTeam).filter(Boolean)),
    alma: new Set(asArray(almaMaterTeams).map(normTeam).filter(Boolean)),
    home: new Set(asArray(homeTeams).map(normTeam).filter(Boolean)),
  };
  const allCandidateNorms = new Set([...groups.slate, ...groups.pick, ...groups.alma, ...groups.home]);
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
      const hit = (group) => sportsFor(teamSports, group).indexOf(item.sport) >= 0 && Array.from(groups[group]).some((n) => named.has(n));
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
