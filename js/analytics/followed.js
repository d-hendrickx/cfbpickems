/**
 * CFB Pickems - js/analytics/followed.js (D2 lane 4, batch 2; DI-1076; UN/PF-543; 2026-10-21)
 * ===========================================================================================
 * THE ONE DEFINITION of "the teams a member follows". Lane 3's js/analytics-adapter.js re-points to `followedTeams` below; Home, Game Day, Your teams and the Deployment 1
 * content cards read this and keep no list of their own, so every surface agrees.
 *
 *   followedTeams({ almaBySport, homeTeamsBySport, ownFinalPicks, otherTeamsBySport? }) -> { teamKeys, bySport }   (M-93 DI-1112: "Other teams you follow" are a fourth bucket, `other`, after most-picked)
 *     almaBySport       { [sport]: string[] }   the member's alma mater(s) (college football today: { cfb: ['Texas A&M'] })
 *     homeTeamsBySport  { [sport]: string[] }   lane A's onboarding home team(s) per sport (profileSignals().homeTeams)
 *     ownFinalPicks     [{ sport, selectedTeam, homeTeam, awayTeam }]   the member's OWN picks in FINAL weeks (names; never anyone else's)
 *   returns { teamKeys: string[] (every sport, deduped), bySport: { [sport]: { teamKeys, alma, home, mostPicked } } }  (a sport with nothing followed is absent)
 *
 * The set per sport, in this order, at most FOLLOWED_CAP_PER_SPORT (6) team keys: the alma mater(s), the home team(s), then the member's TOP THREE MOST-PICKED teams that
 * have at least MOST_PICKED_MIN_BACKED (4) backed picks. Ties for a place break by more appearances (games where the team played that the member picked), then teamKey,
 * because membership of a set is not a claim. NOT this week's picks and NOT the whole slate: only the profile and the member's own settled picks.
 *
 * PURE and DEVICE-ONLY: no storage, no network, no clock, no randomness. It is computed where the member's profile and picks already are and is NEVER sent anywhere (DI-1079).
 * A team key is `normTeam(name)` (js/team-match.js), the same key every other surface uses. An unreadable input is "follows nothing" (an empty set shows nothing).
 */
import { normTeam } from '../team-match.js';
import { assertEligible } from './input.js';

export const FOLLOWED_CAP_PER_SPORT = 6;
export const MOST_PICKED_TOP = 3;
export const MOST_PICKED_MIN_BACKED = 4;

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const keysOf = (names) => { const out = []; for (const n of arr(names)) { const k = normTeam(str(n)); if (k && !out.includes(k)) out.push(k); } return out; };

/** The top most-picked team keys of ONE sport from the member's own final picks (exported for the Your teams section's "You are w-l on it" line and the tests). */
export function mostPickedTeams(picks) {
  const backed = new Map(), appeared = new Map();
  for (const p of arr(picks)) {
    if (!isObj(p)) continue;
    const h = normTeam(str(p.homeTeam)), a = normTeam(str(p.awayTeam)), s = normTeam(str(p.selectedTeam));
    if (!s || (s !== h && s !== a)) continue;                      // a pick on a team that played neither side (a renamed team) names no team
    backed.set(s, (backed.get(s) || 0) + 1);
    appeared.set(s, (appeared.get(s) || 0) + 1);
    const other = s === h ? a : h;
    if (other) appeared.set(other, (appeared.get(other) || 0) + 1);   // the opponent appeared in a game the member picked, without being backed
  }
  return [...backed.entries()]
    .filter(([, n]) => n >= MOST_PICKED_MIN_BACKED)
    .sort((x, y) => (y[1] - x[1]) || ((appeared.get(y[0]) || 0) - (appeared.get(x[0]) || 0)) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .slice(0, MOST_PICKED_TOP)
    .map(([k]) => k);
}

export function followedTeams(input) {
  const src = isObj(input) ? input : {};
  const alma = isObj(src.almaBySport) ? src.almaBySport : {}, home = isObj(src.homeTeamsBySport) ? src.homeTeamsBySport : {};
  const other = isObj(src.otherTeamsBySport) ? src.otherTeamsBySport : {};       // DI-1112: "Other teams you follow" (the profile), a fourth bucket after most-picked
  const bySportPicks = new Map();
  for (const p of arr(src.ownFinalPicks)) {
    if (!isObj(p)) continue;
    const sp = str(p.sport) || 'cfb';
    if (!bySportPicks.has(sp)) bySportPicks.set(sp, []);
    bySportPicks.get(sp).push(p);
  }
  const sports = [...new Set([...Object.keys(alma), ...Object.keys(home), ...Object.keys(other), ...bySportPicks.keys()])].sort();
  const bySport = {};
  for (const sp of sports) {
    const a = keysOf(alma[sp]), h = keysOf(home[sp]).filter((k) => !a.includes(k)), m = mostPickedTeams(bySportPicks.get(sp)).filter((k) => !a.includes(k) && !h.includes(k));
    const o = keysOf(other[sp]).filter((k) => !a.includes(k) && !h.includes(k) && !m.includes(k));
    const teamKeys = [...a, ...h, ...m, ...o].slice(0, FOLLOWED_CAP_PER_SPORT);
    if (!teamKeys.length) continue;
    const kept = new Set(teamKeys);
    bySport[sp] = { teamKeys, alma: a.filter((k) => kept.has(k)), home: h.filter((k) => kept.has(k)), mostPicked: m.filter((k) => kept.has(k)), other: o.filter((k) => kept.has(k)) };
  }
  return { teamKeys: [...new Set(Object.values(bySport).flatMap((v) => v.teamKeys))], bySport };
}

/**
 * THE ONLY WAY lane 3's followedTeamsFor (and Your teams) should obtain `ownFinalPicks`: from an ELIGIBLE FINAL-WEEK input (the engine's own, branded; anything else throws), so this week's open
 * picks can never be handed to followedTeams() (DI-1076's failure condition: "this week's picks … leak into the set"). The input holds final weeks only and the viewer's own rows are the ones selected.
 * Returns [{ sport, selectedTeam, homeTeam, awayTeam }] in followedTeams' shape.
 */
export function ownFinalPicksOf(input, viewerMemberId) {
  assertEligible(input, { cls: 'final-week' });
  if (typeof viewerMemberId !== 'string' || !viewerMemberId) return [];
  const games = new Map(arr(input.games).map((g) => [g.gameId, g]));
  const out = [];
  for (const p of arr(input.picks)) {
    if (!p || p.memberId !== viewerMemberId) continue;
    const g = games.get(p.gameId);
    if (g) out.push({ sport: p.sport, selectedTeam: p.team, homeTeam: g.home, awayTeam: g.away });
  }
  return out;
}

/** followedTeams from an eligible final-week input and the member's profile ({ almaBySport, homeTeamsBySport }): the one-call form for lane 3's adapter. */
export function followedTeamsFromInput(input, viewerMemberId, profile = {}) {
  return followedTeams({ almaBySport: profile.almaBySport, homeTeamsBySport: profile.homeTeamsBySport, otherTeamsBySport: profile.otherTeamsBySport, ownFinalPicks: ownFinalPicksOf(input, viewerMemberId) });
}

/** Why a team is followed (the card's reason chip, DI-1085): 'alma' | 'home' | 'picked' | 'other' | null. Alma over home over picked over other when a team is in two lists. */
export function followReason(followed, sport, teamKey) {
  const v = followed && followed.bySport && followed.bySport[sport];
  if (!v) return null;
  return v.alma.includes(teamKey) ? 'alma' : v.home.includes(teamKey) ? 'home' : v.mostPicked.includes(teamKey) ? 'picked' : Array.isArray(v.other) && v.other.includes(teamKey) ? 'other' : null;
}
