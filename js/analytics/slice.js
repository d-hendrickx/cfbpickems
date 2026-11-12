/**
 * CFB Pickems - js/analytics/slice.js (D2 lane 4; DI-944, 945; 2026-10-19)
 * ==========================================================================
 * A SLICE is one `(league, competition, season)` of an eligible input, with the indexes every metric wants. There is no
 * league-blended default and no cross-competition slice: a metric is computed INSIDE one slice and carries it (DI-945).
 * The two cross-scope kinds that exist (`ident.sport_split`, the cross-season callbacks) build their own scope explicitly.
 *
 * "Final weeks" are the competition's weeks the server confirmed final. A week GROUP (a split competitive week: 7a, 7b) is one
 * UNIT, and only a COMPLETE group (every member week present) is a unit: weekly comparisons never double-count a split week.
 *
 * Pure. Memoised per input in a WeakMap (never persisted).
 */
import { assertEligible, sortWeekRecords, viewOf } from './input.js';

const MEMO = new WeakMap();

const pk = (competitionId, season) => String(competitionId) + '|' + String(season);

/** Competitions and seasons present in an input: [{ competitionId, sport, format, season }], seasons ascending. */
export function scopesOf(input) {
  assertEligible(input);
  const out = [];
  const seen = new Set();
  for (const w of sortWeekRecords(input.weeks)) {
    const k = pk(w.competitionId, w.season);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ competitionId: w.competitionId, sport: w.sport, format: w.format, season: w.season, archived: w.archived });
  }
  return out;
}

/**
 * @param {object} input  an eligible input
 * @param {{competitionId?:string|null, season?:string}} p  omitted competition = the only competition; omitted season = the latest one in it
 * @returns {object|null} the slice, or null when the competition has no week in this input
 */
export function sliceOf(input, p = {}) {
  assertEligible(input);
  let competitionId = p.competitionId;
  if (competitionId === undefined) {
    const ids = Array.from(new Set(input.weeks.map((w) => w.competitionId)));
    if (ids.length === 0) return null;
    if (ids.length > 1) throw new Error('analytics: a competition is required (the league has several)');
    competitionId = ids[0];
  }
  let season = p.season;
  const compWeeks = input.weeks.filter((w) => w.competitionId === competitionId);
  if (compWeeks.length === 0) return null;
  if (season === undefined) season = compWeeks.map((w) => w.season).sort().pop();
  season = String(season);
  const through = p.throughWeekId === undefined ? null : String(p.throughWeekId);
  let byInput = MEMO.get(input);
  if (!byInput) { byInput = new Map(); MEMO.set(input, byInput); }
  const key = pk(competitionId, season) + (through ? '|' + through : '');
  if (byInput.has(key)) return byInput.get(key);

  let weeks = sortWeekRecords(compWeeks.filter((w) => w.season === season));
  if (through) {
    // AS OF a week (DI-947: an insight id names the week it was true through): the weeks up to and including it; an id that is not in the slice yields no slice (fail closed)
    const at = weeks.findIndex((w) => w.weekId === through);
    if (at < 0) { byInput.set(key, null); return null; }
    weeks = weeks.slice(0, at + 1);
  }
  if (weeks.length === 0) { byInput.set(key, null); return null; }
  const weekIds = new Set(weeks.map((w) => w.weekId));
  const games = input.games.filter((g) => weekIds.has(g.weekId));
  const picks = input.picks.filter((x) => weekIds.has(x.weekId));
  const gameById = new Map(games.map((g) => [g.gameId, g]));
  const picksByGame = new Map();
  const picksByMember = new Map();
  for (const x of picks) {
    if (!picksByGame.has(x.gameId)) picksByGame.set(x.gameId, []);
    picksByGame.get(x.gameId).push(x);
    if (!picksByMember.has(x.memberId)) picksByMember.set(x.memberId, []);
    picksByMember.get(x.memberId).push(x);
  }
  // the roster: every member who is an entrant of at least one slice week (in `members` order), plus the per-week sets
  const weekEntrants = new Map();
  const entrantIds = new Set();
  const view = viewOf(input);
  for (const w of weeks) {
    const ids = new Set(view.entrantsByWeek.get(w.weekId) || []);
    weekEntrants.set(w.weekId, ids);
    ids.forEach((id) => entrantIds.add(id));
  }
  const members = input.members.filter((m) => entrantIds.has(m.id));

  // units: complete groups of FINAL weeks, in order
  const finals = weeks.filter((w) => w.isFinal);
  const byGroup = new Map();
  for (const w of finals) { if (!byGroup.has(w.groupId)) byGroup.set(w.groupId, []); byGroup.get(w.groupId).push(w); }
  const units = [];
  for (const [gid, ws] of byGroup) {
    if (ws.length < (ws[0].groupSize || 1)) continue;            // an incomplete group is not yet a competitive week
    units.push({ key: gid, weekIds: ws.map((w) => w.weekId), weekNumber: Math.min(...ws.map((w) => w.weekNumber)), season, label: ws[0].label, weeks: ws });
  }
  units.sort((a, b) => (a.weekNumber - b.weekNumber) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const last = finals.length ? finals[finals.length - 1] : (weeks.length ? weeks[weeks.length - 1] : null);
  let throughKick = 0;
  for (const g of games) if (g.kickoffMs !== null && g.kickoffMs > throughKick) throughKick = g.kickoffMs;
  const ex = input.excludedBy[String(competitionId)] || { notEntrant: 0, other: 0 };
  const sample = weeks[0];
  const slice = Object.freeze({
    input,
    leagueId: input.leagueId,
    competitionId, sport: sample.sport, format: sample.format, season,
    archived: sample.archived,
    dataKey: input.dataKey,
    weeks, finals, units,
    games, gameById, picks, picksByGame, picksByMember,
    members, memberIds: members.map((m) => m.id), weekEntrants,
    throughWeek: last ? last.weekNumber : null,
    asOf: last ? { weekId: last.weekId, weekNumber: last.weekNumber, throughKickoffMs: throughKick } : { weekId: '', weekNumber: 0, throughKickoffMs: 0 },
    excluded: { push: 0, noLine: 0, notEntrant: ex.notEntrant, other: ex.other },
  });
  byInput.set(key, slice);
  return slice;
}

export const nameOf = (input, id) => { const m = input.members.find((x) => x.id === id); return m ? m.name : String(id); };

/** Graded = win or loss. A push is its own count and never enters a numerator or denominator. */
export const graded = (picks) => picks.filter((p) => p.result === 'win' || p.result === 'loss');
export const wins = (picks) => picks.filter((p) => p.result === 'win').length;
export const losses = (picks) => picks.filter((p) => p.result === 'loss').length;
export const pushes = (picks) => picks.filter((p) => p.result === 'push').length;

/** The role-eligible picks of DI-943: a favourite exists (not pick'em, a usable line), graded, in a kept game. */
export const roleEligible = (picks) => graded(picks).filter((p) => p.pickedFavorite !== null);
export const noLine = (picks) => picks.filter((p) => p.pickedFavorite === null).length;

/** supporting-record rows for a set of pick records */
export const supportOfPicks = (picks) => picks.map((p) => ({ gameId: p.gameId, weekId: p.weekId, memberId: p.memberId, pickId: p.id, k: p.kickoffMs }));

/** The as-of and window of a fact about ONE GAME: it is true as of its own week and does not move when later weeks are played (so its insight id recomputes identically). */
export function gameFact(slice, game) {
  const wk = slice.weeks.find((w) => w.weekId === game.weekId);
  return { asOf: { weekId: game.weekId, weekNumber: wk ? wk.weekNumber : 0, throughKickoffMs: game.kickoffMs ?? 0 }, window: { kind: 'game' } };
}
