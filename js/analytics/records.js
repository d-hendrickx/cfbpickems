/**
 * CFB Pickems - js/analytics/records.js (D2 lane 4; DI-943; 2026-10-19)
 * ======================================================================
 * CANONICAL RECORDS AND GRADING. The only file in js/analytics/ that reads a game's line (`lockedSpread` / `spread`):
 * analyticsstatictest pins that. Every other file sees a game as `favoriteSide` ('home' | 'away' | null) plus a
 * NON-NEGATIVE `margin`, never the signed home-perspective number (CLAUDE.md: the signed spread is never exposed, AD-03).
 *
 * GRADING IS NEVER RE-DERIVED. A pick's result is `evaluatePick(pick, game)` from js/scoring.js, the same function the
 * standings grade with (CONVENTIONS #21); it prefers a stored `game.atsWinner`. `win` and `loss` are the only results
 * that enter a numerator or a denominator; `no_decision` is a PUSH, counted in `pushes`, never in a rate; pending and
 * live are excluded from every final-week metric.
 *
 * FAVOURITE comes from the SAME line precedence calculateAtsWinner uses (the locked line when usable, else the live
 * line; a locked PK of 0 still governs). A pick'em or an unusable line has NO favourite: `pickedFavorite` is null and
 * the pick is excluded from favourite/underdog metrics and counted in `excludedNoLine`.
 *
 * Pure. No storage, no DOM, no clock; the only Intl use is a formatter bound to an EXPLICIT zone.
 */
import { evaluatePick, calculateAtsWinner, gameMultiplier } from '../scoring.js';
import { normTeam } from '../team-match.js';
import { isRivalry, RIVALRY_LIST } from './rivalries.js';

/** Same coercion js/scoring.js's private finiteOrNull applies, so "who was the favourite" and "who covered" cannot disagree. */
function finiteOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

/** The line the week was scored against: locked when usable, else live (calculateAtsWinner's precedence on USABILITY). */
function scoringLine(game) {
  const locked = finiteOrNull(game?.lockedSpread);
  return locked !== null ? locked : finiteOrNull(game?.spread);
}

/** Favourite + positive margin from the signed home-perspective line. Negative = home favoured; zero or none = no favourite. */
export function lineFacts(game) {
  const sv = scoringLine(game);
  if (sv === null) return { hasLine: false, favoriteSide: null, margin: null };
  if (sv === 0) return { hasLine: true, favoriteSide: null, margin: 0 };
  return { hasLine: true, favoriteSide: sv < 0 ? 'home' : 'away', margin: Math.abs(sv) };
}

/** How far the ATS winner covered by: abs(home + line - away); null without a usable line or score, or on a push. */
function coverMarginOf(game) {
  const sv = scoringLine(game);
  const hs = finiteOrNull(game?.homeScore), as = finiteOrNull(game?.awayScore);
  if (sv === null || hs === null || as === null) return null;
  const d = Math.abs(hs + sv - as);
  return d < 0.01 ? null : d;
}

/** Who won the game straight up: 'home' | 'away', or null (a tie, a missing score). Moneyline replays only; never the cover. */
function outrightSideOf(game) {
  const hs = finiteOrNull(game?.homeScore), as = finiteOrNull(game?.awayScore);
  if (hs === null || as === null || hs === as) return null;
  return hs > as ? 'home' : 'away';
}

// ---- league-zone clock parts -------------------------------------------------------------------------------------
const _fmt = new Map();
function formatterFor(zone) {
  let f = _fmt.get(zone);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }); }
    catch { f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }); }
    _fmt.set(zone, f);
  }
  return f;
}
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
/** { dow: 0..6 (Mon first), hour: 0..23 } of an instant in the LEAGUE's reference zone, never the viewer's or the machine's (DI-945). */
export function zoneParts(ms, zone) {
  const parts = formatterFor(zone || 'UTC').formatToParts(new Date(ms));
  let dow = null, hour = null;
  for (const p of parts) { if (p.type === 'weekday') dow = DOW[p.value]; else if (p.type === 'hour') hour = Number(p.value) % 24; }
  return { dow, hour };
}
export const DAYPARTS = Object.freeze(['before_noon', 'afternoon', 'evening']);
export function daypartOf(hour) { return hour < 12 ? 'before_noon' : hour < 17 ? 'afternoon' : 'evening'; }

const rankOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/**
 * One game as the engine sees it. `rawWeek` and `comp` supply scope; `zone` the league reference zone.
 * Never throws on a malformed game: returns null (the caller counts it under `other`).
 */
export function gameRecord(g, { week, sport, zone, rivalryList = RIVALRY_LIST }) {
  if (!g || typeof g !== 'object' || !g.gameId) return null;
  const line = lineFacts(g);
  const ats = g.atsWinner ?? calculateAtsWinner(g);
  let atsSide = null;
  if (ats === 'no_decision') atsSide = 'push';
  else if (ats && ats === g.homeTeam) atsSide = 'home';
  else if (ats && ats === g.awayTeam) atsSide = 'away';
  const kms = g.kickoff ? Date.parse(g.kickoff) : NaN;
  const kickoffMs = Number.isFinite(kms) ? kms : null;
  const timed = kickoffMs !== null && g.kickoffDateOnly !== true;
  const zp = timed ? zoneParts(kickoffMs, zone) : { dow: null, hour: null };
  const homeKey = normTeam(g.homeTeam), awayKey = normTeam(g.awayTeam);
  const hc = typeof g.homeConference === 'string' ? g.homeConference.trim() : '';
  const ac = typeof g.awayConference === 'string' ? g.awayConference.trim() : '';
  return {
    gameId: String(g.gameId),
    weekId: String(g.weekId ?? week?.weekId),
    competitionId: week?.competitionId ?? null,
    sport,
    status: g.status,
    home: String(g.homeTeam ?? ''), away: String(g.awayTeam ?? ''),
    homeKey, awayKey,
    favoriteSide: line.favoriteSide,
    margin: line.margin,
    hasLine: line.hasLine,
    locked: finiteOrNull(g.lockedSpread) !== null,       // the line was LOCKED (not the live-line fallback): team.ats_in_league needs this (Drew: "where a locked line exists in our own games table")
    atsSide,
    outrightSide: outrightSideOf(g),
    coverMargin: atsSide === 'home' || atsSide === 'away' ? coverMarginOf(g) : null,
    neutral: g.neutralSite === true,
    nationalTV: g.nationalTV === true,
    homeRank: rankOf(g.homeRank), awayRank: rankOf(g.awayRank),
    sameConference: hc && ac ? hc === ac : null,
    multiplier: gameMultiplier(g),
    isManual: g.isManual === true,
    isAlmaMaterGame: g.isAlmaMaterGame === true,
    kickoffMs, kickoffTimed: timed,
    dow: zp.dow, daypart: zp.hour === null ? null : daypartOf(zp.hour),
    rivalry: isRivalry(sport, homeKey, awayKey, rivalryList),
    lastUpdatedMs: (() => { const t = Date.parse(g.lastUpdated || ''); return Number.isFinite(t) ? t : null; })(),
    // the projected winner of a LIVE game (DI-975 "if the result holds"): the final-game rule applied to the live score;
    // null for a scheduled game or one with no usable line or score. A FINAL game's own result is `atsSide`.
    projWinner: g.status === 'live' ? projectedWinner(g) : null,
    // how far the projected winner is covering by right now (non-negative; null without a usable line or score): "Covering by 3"
    projMargin: g.status === 'live' ? coverMarginOf(g) : null,
  };
}

/** "If the result holds": calculateAtsWinner on a copy marked final, never on the stored winner. */
function projectedWinner(g) {
  const copy = { ...g, status: 'final', atsWinner: null };
  const w = calculateAtsWinner(copy);
  return w || null;
}

/** The pick as the engine sees it (DI-943's closed field list). `game` is the RAW game (for evaluatePick); `gr` its record. */
export function pickRecord(p, game, gr, { week, leagueId, sport, season }) {
  if (!p || !game || !gr) return null;
  const sel = p.selectedTeam;
  let side = null;
  if (sel === game.homeTeam) side = 'home'; else if (sel === game.awayTeam) side = 'away';
  // a pick whose selected team matches NEITHER side (a team renamed after the pick was made) is graded EXACTLY as evaluatePick grades it (a loss on a covered game, a push on a push): the
  // engine's win-loss must equal Standings'. It carries side null, so it enters no side-dependent metric (consensus, home/away, copy) and no favourite metric (pickedFavorite null).
  const raw = evaluatePick(p, game);
  const result = raw === 'win' ? 'win' : raw === 'loss' ? 'loss' : raw === 'no_decision' ? 'push' : null;
  const pickedFavorite = side === null || gr.favoriteSide === null ? null : gr.favoriteSide === side;
  return {
    id: String(p.pickId ?? (p.weekId + ':' + p.gameId + ':' + p.playerId)),
    leagueId,
    competitionId: gr.competitionId,
    sport,
    season: String(season),
    weekId: gr.weekId,
    weekNumber: week.weekNumber,
    groupId: week.groupId,
    gameId: gr.gameId,
    memberId: String(p.playerId),
    team: String(sel),
    teamKey: side === 'home' ? gr.homeKey : side === 'away' ? gr.awayKey : normTeam(sel),
    opponentKey: side === 'home' ? gr.awayKey : side === 'away' ? gr.homeKey : null,
    side,
    pickedFavorite,
    favoriteSide: gr.favoriteSide,
    margin: gr.margin,
    neutral: gr.neutral,
    rankPicked: side === 'home' ? gr.homeRank : side === 'away' ? gr.awayRank : null,
    rankOpponent: side === 'home' ? gr.awayRank : side === 'away' ? gr.homeRank : null,
    sameConference: gr.sameConference,
    nationalTV: gr.nationalTV,
    kickoffMs: gr.kickoffMs,
    multiplier: gr.multiplier,
    result,
    coverMargin: result === 'loss' || result === 'win' ? gr.coverMargin : null,
    isManual: gr.isManual,
  };
}

/** The result a projected (live) game would give a pick: evaluatePick itself on a final-marked stand-in, never a second reading of the line. */
export function projectedResult(teamPicked, liveGameRecord) {
  if (!liveGameRecord || !liveGameRecord.projWinner) return null;
  const r = evaluatePick({ selectedTeam: teamPicked }, { status: 'final', atsWinner: liveGameRecord.projWinner });
  return r === 'win' ? 'win' : r === 'loss' ? 'loss' : r === 'no_decision' ? 'push' : null;
}
