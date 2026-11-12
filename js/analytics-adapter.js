/**
 * CFB Pickems — js/analytics-adapter.js (Deployment 2, thread 101826-D2, lane 3; amendment 2026-10-21 (d), DI-1072…1074)
 * ======================================================================================================================
 * THE ONE PLACE Home reads the analytics lane (lane 4, UN/PF-543 and DI-1061…1063). Lane 4's functions reach it INJECTED (app.js -> Home's options -> these functions' `source`), never
 * imported (integration ruling 2026-10-22):
 *
 *   followedTeamsFor(input) -> { teamKeys: string[], bySport: { [sport]: { teamKeys, alma, home, mostPicked } } }
 *       The member's FOLLOWED TEAMS. The DEFINITION is lane 4's (alma mater, onboarding home teams, the top three most-picked teams with at least 4 backed picks, at most 6 per
 *       sport; computed on the device, never sent). This lane does NOT define it: with no injected source every member follows nothing, so no card changes family (fail
 *       closed). The app injects lane 4's (the wire's followedFor); tests inject a fixture-backed stand-in through Home's `followedTeams` dependency.
 *   ownFinalPicksFor(input, source) -> the member's own FINAL-week picks (lane 4's, injected as Home's `finalPicks`; the stand-in derivation below without one)
 *   INSIGHT_REASON_CHIPS / insightReasonChip(x) -> DI-1085's three followed-team chips for an insight card
 *   insightCardsFor(input, source) -> the league's insight cards for Home (lane 4's, injected as Home's `insightCards`; none without one)
 *   insightQualityOk(x) -> boolean
 *       DI-1074: an insight is a candidate only when lane 4 marks its sample sufficient AND its no-repeat ledger clear. The field names are lane 4's; INSIGHT_QUALITY maps them.
 *
 * Pure: no storage, no DOM, no network, no clock, no import.
 */
// INTEGRATION (2026-10-22, the coordinator's ruling): lane 4's three sources are INJECTED, never imported. app.js passes Home `followedTeams`, `insightCards` and `finalPicks`, each answering
// from lane 4's analytics wire (its own checked final-week input; nothing before the wire has built), and Home hands them to the functions below. This file stays a pure leaf with no import.
// Called with no source (a test, or a Home built without the app), each answers "nothing": follows no team, no insight card, and the final-picks stand-in derivation below.

/** DI-1074: lane 4's field names for "the sample meets the metric's minimum" and "the no-repeat ledger has not seen it". Re-point here only. */
export const INSIGHT_QUALITY = Object.freeze({ sampleOk: 'sampleOk', notRepeat: 'ledgerOk' });

const EMPTY = Object.freeze({ teamKeys: Object.freeze([]), bySport: Object.freeze({}) });
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

/** The followed-team set in the one shape Home reads, whatever the source returns (an unreadable answer is "follows nothing"). `source` is lane 4's function, injected by the app. */
export function followedTeamsFor(input, source = null) {
  if (typeof source !== 'function') return EMPTY;
  let out = null;
  try { out = source(input); } catch { out = null; }
  if (!out || typeof out !== 'object' || !out.bySport || typeof out.bySport !== 'object') return EMPTY;
  const bySport = {};
  for (const [sport, v] of Object.entries(out.bySport)) {
    if (!v || typeof v !== 'object') continue;
    const teamKeys = strs(v.teamKeys);
    if (!teamKeys.length) continue;
    bySport[sport] = Object.freeze({ teamKeys: Object.freeze(teamKeys), alma: Object.freeze(strs(v.alma)), home: Object.freeze(strs(v.home)), mostPicked: Object.freeze(strs(v.mostPicked)), other: Object.freeze(strs(v.other)) });
  }
  return Object.freeze({ teamKeys: Object.freeze([...new Set(Object.values(bySport).flatMap((v) => v.teamKeys))]), bySport: Object.freeze(bySport) });
}

/**
 * The member's OWN picks in FINAL weeks only (lane 4's helper; the followed set's most-picked input). Input: `{ sources: [{ weeks, games, picks, viewerId }] }` (each league the
 * Home spans). With no injected source, this STAND-IN derives the same list: only weeks whose status is final, only the viewer's own picks, never this week's.
 * @returns {Array<{ sport, selectedTeam, homeTeam, awayTeam }>}
 */
export function ownFinalPicksFor(input, source = null) {
  if (typeof source === 'function') { try { const out = source(input); return Array.isArray(out) ? out : []; } catch { return []; } }
  const out = [];
  for (const src of (input && Array.isArray(input.sources) ? input.sources : [])) {
    if (!src || typeof src.viewerId !== 'string' || !src.viewerId) continue;
    const weeks = new Map((Array.isArray(src.weeks) ? src.weeks : []).filter(Boolean).map((w) => [w.weekId, w]));
    const games = new Map((Array.isArray(src.games) ? src.games : []).filter(Boolean).map((g) => [g.gameId, g]));
    for (const p of (Array.isArray(src.picks) ? src.picks : [])) {
      if (!p || p.playerId !== src.viewerId || typeof p.selectedTeam !== 'string' || !p.selectedTeam) continue;
      const w = weeks.get(p.weekId), g = games.get(p.gameId);
      if (!w || w.status !== 'final' || !g) continue;                     // final weeks ONLY: never this week's picks
      out.push({ sport: typeof w.sport === 'string' && w.sport ? w.sport : 'cfb', selectedTeam: p.selectedTeam, homeTeam: g.homeTeam, awayTeam: g.awayTeam });
    }
  }
  return out;
}

/** DI-1085: the followed-team reason chip of an insight card — lane 4's four (re-point here only): "Your alma mater", "Your home team", "A team you pick", and (M-93 DI-1112) "A team you follow". */
export const INSIGHT_REASON_CHIPS = Object.freeze({ alma: 'Your alma mater', home: 'Your home team', picked: 'A team you pick', other: 'A team you follow' });   // M-93 DI-1112: the fourth, for "Other teams you follow"
/** The chip for an insight card or candidate (its `reason` kind, or the exact chip text), or null — a closed set, so nothing else can reach a pill. */
export function insightReasonChip(x) {
  const src = x && typeof x === 'object' ? x : null;
  if (!src) return null;
  const kinds = [src.insight && src.insight.reason, src.reason, src.reasonKind];
  for (const k of kinds) if (typeof k === 'string' && Object.prototype.hasOwnProperty.call(INSIGHT_REASON_CHIPS, k)) return INSIGHT_REASON_CHIPS[k];
  const chip = src.reasonChip;
  return typeof chip === 'string' && Object.values(INSIGHT_REASON_CHIPS).includes(chip) ? chip : null;
}

/** The league's insight cards for Home (amendment e: they are paced and deferred by home.js). With no injected source: none. An unreadable answer is none. */
export function insightCardsFor(input, source = null) {
  if (typeof source !== 'function') return [];
  try { const out = source(input); return Array.isArray(out) ? out.filter((c) => c && typeof c === 'object') : []; } catch { return []; }
}

/** DI-1074: true only when BOTH quality fields are exactly `true` (a missing field fails closed). Reads `x.insight` when present, else `x`. */
export function insightQualityOk(x) {
  const src = x && typeof x === 'object' ? (x.insight && typeof x.insight === 'object' ? x.insight : x) : null;
  return !!src && src[INSIGHT_QUALITY.sampleOk] === true && src[INSIGHT_QUALITY.notRepeat] === true;
}
