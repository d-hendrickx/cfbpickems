/**
 * CFB Pickems — Competition read API (Multi-Sport Phase 1a)
 * ==========================================================
 * Thread "091926-MULTISPORT". Built to docs/DESIGN_INPUTS_MULTISPORT_CORE.md **Revision 5**:
 * DI-220 (competition data model, AD-74) §2, the read halves of DI-224 (AD-75) §5, DI-225 (settings
 * inheritance, AD-79) §6, and AD-73's `profileForWeek` (DI-219 §1).
 *
 *   getCompetitions(leagueId?)                 the league's competitions: default first, then createdAt asc
 *   getCompetition(leagueId, id)               one competition, or null
 *   getDefaultCompetition(leagueId?)           the one is_default row, or NULL pre-backfill
 *   saveCompetition(c)                         the commissioner-only write path; never called from a read
 *   competitionForWeek(week)                   the ONLY resolver of a week's competition (R1)
 *   profileForWeek(week)                       the sport profile of that competition
 *   getWeeksForCompetition(competitionId?)     READ-ONLY, competition-scoped view of getWeeks()
 *   getLiveSports(leagueId?, now?)             [{dbCode,label,competitionId}], DERIVED (R7)
 *   getCurrentWeekFor(competitionId?)          ONE competition's current week
 *   getAllCurrentWeeks(leagueId?, now?)        every competition worth iterating (default always)
 *   getEffectiveSetting(key, {competitionId,weekId})   week > competition > league > default (R2)
 *
 * WHAT THIS MODULE NEVER DOES
 *   - It never WRITES from a read path. Every function is a synchronous read over the storage seam
 *     except `saveCompetition`, which is commissioner-only and is never reached from a getter. A league
 *     with no competition rows (pre-backfill) is answered by the DI's pre-backfill rules below — a
 *     getter never seeds a default row (fix 5a; RG-12's class).
 *   - It never feeds a write. `getWeeksForCompetition()` returns a NEW array for reading; `saveWeek()` /
 *     `deleteWeek()` in storage.js stay on the raw, unfiltered `getWeeks()` (DI-220's top risk;
 *     competitiontest pins it against the source and adaptertest [A-MS] against the real planner).
 *   - It never touches `getCurrentWeek()` (storage.js, byte-identical, AD-75) or scoring.
 *
 * NULL `week.competitionId` = the league's DEFAULT competition (R1). Nothing outside this module may
 * resolve it any other way. Sport values are the short dbCodes (`cfb, nfl, nba, cbb, mm, nhl, wjc`).
 * A competition object's own key is `id` (the DI's client API reads `c.id` throughout); the reference
 * FROM a week is `week.competitionId`.
 *
 * PRE-BACKFILL (zero competition rows — before migration 0033 lands, local mode, demo): the DI's three
 * rules keep a CFB-only league byte-identical. `getDefaultCompetition()` and `competitionForWeek()` answer
 * null (so `profileForWeek()` is the cfb profile); `getWeeksForCompetition(null)` is every week;
 * `getCurrentWeekFor(null)` is `getCurrentWeek()`; `getAllCurrentWeeks()` is `[getCurrentWeek()]`.
 *
 * IMPORTS: storage.js, auth.js, data-model.js and js/sports/index.js. Nothing imports this module from
 * the boot path in Phase 1a (its consumers land in 1b), so it cannot change a boot.
 */

import {
  getWeeks, getWeek, getCurrentWeek, getActiveWeekId, getStoredSettings,
  getCompetitions as getStoredCompetitions, saveCompetition as saveStoredCompetition,
} from './storage.js';
import { getActiveLeagueId } from './auth.js';
import { DEFAULT_SETTINGS } from './data-model.js';
import { getProfile, listProfiles } from './sports/index.js';

/** R7's N — the "starting soon" window, in days. A competition with a week whose `startDate` falls within
 *  [now, now + N days] is live even before that week opens. Coordinator's choice, ratified at STOP #2. */
export const LIVE_SPORT_LOOKAHEAD_DAYS = 3;

const LIVE_STATUSES = Object.freeze(['open', 'locked', 'live']);

// ─── competitions (DI-220 §2) ────────────────────────────────────────────────

/** The league's competitions, DEFAULT FIRST then `createdAt` ascending — a NEW array. The mirror holds
 *  exactly one league's rows, so a `leagueId` that is not the active league answers []. */
export function getCompetitions(leagueId = getActiveLeagueId()) {
  if (leagueId && leagueId !== getActiveLeagueId()) return [];
  const t = (c) => { const n = Date.parse(c && c.createdAt); return Number.isFinite(n) ? n : 0; };
  return getStoredCompetitions()
    .filter((c) => c && c.id)
    .sort((a, b) => (b.isDefault === true) - (a.isDefault === true) || t(a) - t(b));
}

/** One competition by id, or null. */
export function getCompetition(leagueId, id) {
  if (!id) return null;
  return getCompetitions(leagueId).find((c) => c.id === id) || null;
}

/** Read-only: the one `isDefault` row, or NULL pre-backfill. Never creates the row. */
export function getDefaultCompetition(leagueId = getActiveLeagueId()) {
  return getCompetitions(leagueId).find((c) => c.isDefault === true) || null;
}

/** The commissioner-privileged write path (an upsert by `id`, the saveWeek() shape). Never called from
 *  a sync read; a player device's write is refused by the adapter's route before the network. */
export function saveCompetition(c) {
  return saveStoredCompetition(c);
}

/**
 * The competition a week belongs to — the ONLY resolver (R1).
 *
 * `week.leagueId` does NOT exist client-side (the projection assigns league_id from ctx, not from the
 * legacy object), so the league comes from getActiveLeagueId(). A week with no `competitionId` is the
 * default competition's (null pre-backfill). A week whose `competitionId` names a competition that is not
 * in the mirror (a dangling or not-yet-hydrated reference) answers null — never the default, which would
 * silently relabel another sport's week as the league's own.
 */
export function competitionForWeek(week) {
  const leagueId = getActiveLeagueId();
  return week?.competitionId ? getCompetition(leagueId, week.competitionId) : getDefaultCompetition(leagueId);
}

/**
 * The sport profile of a week (DI-219 / AD-73). It goes through the competition, never `week.sport`
 * (R1: the projection never carries it, and a week's own `sport` can drift). Pre-backfill every week is
 * `cfb` (createWeek() never sets .sport; the column defaults 'cfb'). `getProfile` THROWS an
 * `UnknownSportError` for an unknown dbCode; DI-224 owns the caller-side catch (test `err.name`).
 *
 * It lives HERE and not in js/sports/index.js on purpose: the registry must stay importable by an Edge
 * Function (R6), and competition.js imports storage/auth.
 */
export function profileForWeek(week) {
  const comp = competitionForWeek(week);
  return getProfile(comp?.sport || 'cfb');
}

/**
 * The weeks of ONE competition — a READ-ONLY view, never the array a write is built from. `competitionId`
 * null means the default competition. Pre-backfill (no competition rows at all) every week is the
 * default's: `null` -> every week, an explicit id -> []. An unknown id -> [] (never the default's weeks).
 * Always a NEW array (the DI returns getWeeks() itself pre-backfill; a copy is the same answer without
 * handing a caller the mirror's own array to mutate).
 */
export function getWeeksForCompetition(competitionId = null) {
  const leagueId = getActiveLeagueId();
  if (getCompetitions(leagueId).length === 0) return competitionId ? [] : getWeeks().slice();
  const c = competitionId ? getCompetition(leagueId, competitionId) : getDefaultCompetition(leagueId);
  if (!c) return [];
  return getWeeks().filter((w) => competitionForWeek(w)?.id === c.id);
}

// ─── liveness (R7 — DERIVED, never stored) ───────────────────────────────────

/**
 * R7 — the ONE source of "which sports are live in this league right now": `[{dbCode, label,
 * competitionId}]`, one entry per live competition. Live = not archived AND (has a week in
 * open/locked/live OR has a week whose `startDate` falls within [now, now + N days]). `label` is the
 * profile's already-resolved copy via a NON-throwing lookup: an unregistered sport still lists, labelled by
 * its dbCode (the unknown-sport banner is DI-224's, raised at the fetch call site, not here).
 * `now` is epoch milliseconds.
 */
export function getLiveSports(leagueId = getActiveLeagueId(), now = Date.now()) {
  const soonMs = LIVE_SPORT_LOOKAHEAD_DAYS * 86400000;
  const startsSoon = (w) => { const t = Date.parse(w.startDate); return Number.isFinite(t) && t - now >= 0 && t - now <= soonMs; };
  return getCompetitions(leagueId)
    .filter((c) => !c.archivedAt)
    .filter((c) => getWeeksForCompetition(c.id).some((w) => LIVE_STATUSES.includes(w.status) || startsSoon(w)))
    .map((c) => {
      const p = listProfiles().find((x) => x.key === c.sport);
      return { dbCode: c.sport, label: p ? p.label : c.sport, competitionId: c.id };
    });
}

// ─── the current week, per competition (DI-224 §5, AD-75) ────────────────────

/**
 * The current week of ONE competition: the same three steps as getCurrentWeek() (pointer -> first
 * open/locked/live -> highest weekNumber), each scoped to the competition's own weeks, with the pointer
 * from the competition's own source — the default competition keeps league_kv `active_week`
 * (`getActiveWeekId()`), every other competition uses `competitions.active_week_id`. An unknown id is null
 * (never a silent fall-through to the default's week); a pointer at ANOTHER competition's week is refused,
 * not followed. Pre-backfill: `null` -> getCurrentWeek(), an explicit id -> null.
 */
export function getCurrentWeekFor(competitionId = null) {
  const leagueId = getActiveLeagueId();
  if (getCompetitions(leagueId).length === 0) return competitionId ? null : getCurrentWeek();
  const c = competitionId ? getCompetition(leagueId, competitionId) : getDefaultCompetition(leagueId);
  if (!c) return null;
  const weeks = getWeeksForCompetition(c.id);
  const pointerId = c.isDefault ? getActiveWeekId() : c.activeWeekId;
  if (pointerId) { const f = weeks.find((w) => w.weekId === pointerId); if (f) return f; }
  const active = weeks.find((w) => LIVE_STATUSES.includes(w.status));
  if (active) return active;
  return [...weeks].sort((a, b) => b.weekNumber - a.weekNumber)[0] || null;
}

/**
 * Every competition worth iterating: the DEFAULT competition is ALWAYS included (byte-identical
 * single-sport behaviour, offseason included), every other competition only while live (R7); archived ones
 * never. Default first, then createdAt ascending. Pre-backfill: exactly today's single week.
 */
export function getAllCurrentWeeks(leagueId = getActiveLeagueId(), now = Date.now()) {
  const comps = getCompetitions(leagueId);
  if (comps.length === 0) { const w = getCurrentWeek(); return w ? [w] : []; }
  const liveIds = new Set(getLiveSports(leagueId, now).map((s) => s.competitionId));
  return comps
    .filter((c) => !c.archivedAt && (c.isDefault || liveIds.has(c.id)))
    .map((c) => getCurrentWeekFor(c.id))
    .filter(Boolean);
}

// ─── settings inheritance (DI-225 §6, AD-79) ─────────────────────────────────

/**
 * The keys a competition may override — an ALLOW-LIST, and real enforcement (a key not named here never
 * consults `competitions.settings` at all, even if a stray value sits there). Only the five UI-facing
 * fields. `serverJobs.*`, auth, chat/SCRIBE knobs and `reminderCadence` stay league-only: no server job
 * applies a competition-tier merge today, so a per-competition override of anything a server reads would
 * silently do nothing while the commissioner believes it took effect.
 */
export const COMPETITION_OVERRIDABLE_KEYS = Object.freeze([
  'weeklyGameCount', 'candidateGameCount', 'weeklyPrize', 'seasonPrize', 'season',
]);

/** R2's source enum, the one place it is spelled. */
export const SETTING_SOURCES = Object.freeze(['default', 'league', 'competition', 'week']);

const has = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/**
 * Resolve one setting, most specific tier first, and say which tier answered:
 *   week tier         — a per-record fact on the week object itself; unconditional (never allow-listed).
 *   competition tier  — `competitions.settings[key]`, ONLY for a key in COMPETITION_OVERRIDABLE_KEYS.
 *   league tier       — the stored `cfbp_settings` blob AS STORED (no DEFAULT_SETTINGS spread).
 *   default tier      — DEFAULT_SETTINGS[key].
 * Own-property reads throughout, so `constructor`/`__proto__` can never resolve to an Object.prototype member.
 *
 * DEVIATION FROM DI-225's SKETCH, and why: the sketch's league tier reads `getSettings()[key]`, but
 * getSettings() already spreads DEFAULT_SETTINGS in, so every defaulted key would report `source:'league'`
 * and DI-225's own first named assertion ("no tier set -> 'default'") could never hold for a real setting.
 * The league tier here reads the blob as stored (`getStoredSettings()`), so the four-source contract (R2)
 * is real. For every key the league HAS stored the answer is identical to the sketch's.
 */
export function getEffectiveSetting(key, { competitionId = null, weekId = null } = {}) {
  if (weekId) {
    const week = getWeek(weekId);
    if (has(week, key) && week[key] !== undefined) return { value: week[key], source: 'week' };
  }
  if (competitionId && COMPETITION_OVERRIDABLE_KEYS.includes(key)) {
    const comp = getCompetition(getActiveLeagueId(), competitionId);
    if (has(comp?.settings, key) && comp.settings[key] !== undefined) {
      return { value: comp.settings[key], source: 'competition' };
    }
  }
  const stored = getStoredSettings();
  if (has(stored, key) && stored[key] !== undefined) return { value: stored[key], source: 'league' };
  return { value: has(DEFAULT_SETTINGS, key) ? DEFAULT_SETTINGS[key] : undefined, source: 'default' };
}
