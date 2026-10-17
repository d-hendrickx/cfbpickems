/**
 * CFB Pickems — js/team-match.js (D1 Lane C, DI-668 / DI-663; the ONE team matcher, extracted from js/newsRank.js, 2026-10-08)
 * ============================================================================================================================
 * ZERO IMPORTS, ZERO side effects, no DOM, no fetch, no storage, no clock. The team-name rules every surface that asks "is this article / card about
 * that team?" shares, so the News ranking (js/newsRank.js), the Home content relevance (js/feed-relevance.js), the storyline tag (DI-663) and the
 * server collector's catalog matcher (supabase/functions/_shared/news-rules.mjs, by relative path) cannot disagree about "Texas" versus "Texas A&M".
 *
 * WHAT IT HOLDS (moved here unchanged in behaviour; newstest pins the refactor):
 *   normTeam(s)                    lower-case, NFKC, `&` as "and", apostrophes dropped, every other non-alphanumeric run a single space, trimmed. Linear.
 *   resolveKnownTeamNames(d, c)    DI-376's longest-known-candidate rule: a description resolves to AT MOST ONE candidate, the LONGEST whose normalized form equals the
 *                                  description or is a whole-word PREFIX of it ("texas a and m aggies" -> "Texas A&M", never "Texas"). Unresolved -> nothing (never a guess).
 *   teamKeySetMatches(keys, names) does an item's server-built `team_keys` (normTeam'd aliases) name one of these team names? EQUALITY of normalized forms only: a
 *                                  key list is already the exact aliases of the matched teams, so a prefix rule here would let "texas" claim "texas a and m".
 *
 * Under-matching (an item falls to a lower tier) is always preferred to over-matching (a wrong "Your pick" or a wrong storyline tag is a trust defect).
 * iOS 15.0 safe (no Object.hasOwn, no .at(), no replaceAll).
 */

const asArray = (v) => (Array.isArray(v) ? v : []);
/** SC-N7(d) (the collector imports this file): every regular-expression literal here, by reviewed id. */
export const REGEX_REGISTRY = Object.freeze({ ampersand: /&/g, apostrophes: /['‘’`]/g, 'non-alnum-run': /[^\p{L}\p{N}]+/gu });

/** Lower-case, NFKC, `&` as "and", apostrophes dropped, everything else non-alphanumeric a single space. Linear; no nested quantifiers. */
export function normTeam(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/['‘’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

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

/**
 * Does a server-built key list (`news_articles.team_keys` / `feed_items.team_keys`: normTeam(location) and normTeam(displayName) of each matched team) name one of
 * `teamNames`? Equality of normalized forms, nothing looser. Returns the ORIGINAL team names that matched, in the order given (deduped).
 */
export function teamKeySetMatches(keys, teamNames) {
  const set = new Set();
  for (const k of asArray(keys)) { if (typeof k === 'string') { const n = normTeam(k); if (n) set.add(n); } }
  const out = [];
  if (!set.size) return out;
  for (const t of asArray(teamNames)) {
    if (typeof t !== 'string') continue;
    const n = normTeam(t);
    if (n && set.has(n) && out.indexOf(t) < 0) out.push(t);
  }
  return out;
}
