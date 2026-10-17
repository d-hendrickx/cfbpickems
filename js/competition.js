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
 * D1 (v0.30.0, thread 100726-D1, Lane A) — PARTICIPATION AND THE SPORT CONTEXT (DI-520, DI-531, DI-555; security A3, A4, A5, C1):
 *   isMultiSport(leagueId?)                    two or more NON-ARCHIVED competitions
 *   playersForCompetition(id, {weekId?})       WHO IS IN A SPORT — the ONE place that decides (C1: joined before the week's lock)
 *   playersForWeek(week)                       the same, for a week record's own competition
 *   picksOfRoster(picks, players)              the matching picks filter: only `players`' rows count (a non-entrant's row counts for nothing)
 *   viewerMemberId() / viewerPlaysCompetition  the signed-in member, and whether they play a sport
 *   playedSports()                             the non-archived sports the VIEWER plays (the switcher's segments, DI-555)
 *   getActiveSportKey() / setActiveSportKey()  the device-local pointer, validated on the way out (A4/A5)
 *   getContextCompetition/Week/Weeks()         what Picks, Dashboard and Standings read instead of getCurrentWeek()/getWeeks()
 *   getDashboardScope() / setDashboardScope()  'all' | a sport: the Dashboard's own scope, never the pointer (rev 3)
 *   clearSportContextExcept(userId)            DI-538: forget every OTHER account's pointer on this device
 *
 * SINGLE-SPORT RULE (every function below): with zero or one non-archived competition nothing here changes an answer — playersForCompetition() is every active
 * player, the pointer is the league's one sport, getContextWeek() IS getCurrentWeek() and getContextWeeks() IS getWeeks() (a copy). The multi-sport branches are
 * reachable only when a league has a second sport.
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
 * IMPORTS: storage.js, auth.js, data-model.js, js/sports/index.js and (D1) js/week-lock.js — the leaf that owns "when does this week lock", so the joined-before-lock rule (C1) reads
 * the SAME instant every lock surface does. Nothing imports this module from the boot path, so it cannot change a boot.
 */

import {
  getWeeks, getWeek, getCurrentWeek, getActiveWeekId, getStoredSettings, getGames, getPlayers, getSession,
  getCompetitions as getStoredCompetitions, saveCompetition as saveStoredCompetition,
  getCompetitionMembers as getStoredCompetitionMembers,
  getActiveSportMap, setActiveSportMap, getDashboardScopeMap, setDashboardScopeMap,
} from './storage.js';
import { getActiveLeagueId, getAccountUserId, getAuthMode } from './auth.js';
import { DEFAULT_SETTINGS } from './data-model.js';
import { getProfile, listProfiles } from './sports/index.js';
import { weekLockState } from './week-lock.js';

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

/**
 * The Home feed's CONTEXTS (D1 DI-528): one per non-archived competition that is the league's default or live (R7, the same rule getAllCurrentWeeks() applies):
 * `[{ competitionId, dbCode, code, weekIds, playerIds, weekEntrants, currentWeekId }]`. `playerIds` are the competition's ENTRANTS as of now and `weekEntrants[weekId]` each week's own (C4/N1: playersForCompetition, never the active roster), so a rank, a
 * streak or a "N/M in" count is computed among the people who play THAT sport. A league with one sport (or none) has NO contexts: `null`, and Home runs exactly as it did in v0.29.0.
 * Pure over the mirror; carries no pick and no result.
 */
export function homeFeedContexts({ leagueId = getActiveLeagueId(), now = Date.now() } = {}) {
  if (!isMultiSport(leagueId)) return null;
  const liveIds = new Set(getLiveSports(leagueId, now).map((s) => s.competitionId));
  return liveCompetitions(leagueId)
    .filter((c) => c.isDefault === true || liveIds.has(c.id))
    .map((c) => {
      const cur = getCurrentWeekFor(c.id);
      const weekIds = getWeeksForCompetition(c.id).map((w) => w.weekId);
      // security N1 (Part 2 item 10, 2026-10-08): EACH WEEK'S entrants. `playerIds` is the roster as of NOW (a member who joined after an earlier week locked is on it - he counts from his next week), so
      // a pick row he holds in that earlier week must be judged against THAT week's roster (C1: joined before ITS lock). `weekEntrants[weekId]` is exactly playersForWeek's answer for that week.
      const weekEntrants = {};
      for (const id of weekIds) weekEntrants[id] = playersForCompetition(c.id, { weekId: id }).map((p) => String(p.playerId));
      return {
        competitionId: c.id,
        dbCode: c.sport,
        code: profileFacts(c.sport).code,
        weekIds,
        playerIds: playersForCompetition(c.id).map((p) => String(p.playerId)),
        weekEntrants,
        currentWeekId: cur ? cur.weekId : null,
      };
    });
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// D1 (v0.30.0) — PARTICIPATION (DI-531) AND THE SPORT CONTEXT (DI-520, DI-555)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

/** The Dashboard's one non-sport scope (DI-525 rev 3): the combined slate of every sport the member plays. */
export const DASHBOARD_ALL = 'all';

/** The league's NON-ARCHIVED competitions, default first. An archived sport is gone from every surface (DI-520). */
function liveCompetitions(leagueId = getActiveLeagueId()) {
  return getCompetitions(leagueId).filter((c) => !c.archivedAt);
}

/**
 * True when the league has TWO OR MORE non-archived competitions (DI-520, Amendment D: a just-added sport counts at once). The single-sport rule hangs off this one
 * predicate: false means every function below answers exactly as v0.29.0 did.
 */
export function isMultiSport(leagueId = getActiveLeagueId()) {
  return liveCompetitions(leagueId).length >= 2;
}

/** A sport's member-facing label and code from its registered profile ("College Football" / "CFB"); an unregistered sport is labelled by its dbCode, never dropped. */
function profileFacts(dbCode) {
  const p = listProfiles().find((x) => x.key === dbCode);
  return { label: p ? p.label : String(dbCode), code: p ? (p.code || p.label) : String(dbCode).toUpperCase(), glyphKey: p ? p.glyphKey : null };
}

const sportEntry = (c) => ({ dbCode: c.sport, competitionId: c.id, competition: c, ...profileFacts(c.sport) });

/** The viewer's league-member id, or null: the SAME "signed in and verified" test the Picks page applies (`playerVerified && playerId`). */
export function viewerMemberId() {
  let s = null;
  try { s = getSession(); } catch { s = null; }
  return s && s.playerVerified && s.playerId ? String(s.playerId) : null;
}

/**
 * The instant before which a member must have joined to count for a week (C1): the week's lock instant (the ONE week-lock state), else the stored `lockedAt` of a week the
 * commissioner locked by hand with no dated games, else null (the week has no lock yet, so nobody is late). Never throws.
 */
function entryCutoffMs(weekId) {
  const week = weekId ? getWeek(weekId) : null;
  if (!week) return null;
  let ms = null;
  try {
    const st = weekLockState({ week, games: getGames(weekId) });
    ms = st && Number.isFinite(st.lockAtMs) ? st.lockAtMs : null;
  } catch { ms = null; }
  if (ms === null) {
    const t = Date.parse(week.lockedAt);
    if (Number.isFinite(t)) ms = t;
  }
  return ms;
}

/**
 * WHO IS IN A SPORT — the ONE place that decides (DI-531). Nothing else may ask `getPlayers().filter(p => p.active)` on a sport-scoped surface (participationtest scans for it).
 *
 *   zero or one non-archived competition   every active player, exactly as today (the single-sport rule; also pre-backfill).
 *   enrollment 'all'                       every active member except a tournament-only guest.
 *   enrollment 'opt_in'                    active members with a `competition_members` row for that competition;
 *       with `weekId` (C1)                 ...and only those whose row's `joinedAt` is BEFORE that week's lock instant. A member who joined at or after the lock is a LATE JOIN:
 *                                          not required to pick that week, not in its results, ranks or obligations, never "missing"; they count from the next week. This applies
 *                                          equally to a commissioner-inserted row. A row with no parseable `joinedAt` (legacy / local) counts.
 *   an unknown competition id              nobody (never the default's roster: that would show one sport's players under another's picks).
 *
 * `competitionId` null means the league's default competition. The result is a NEW array of the stored player objects, in `getPlayers()` order.
 */
export function playersForCompetition(competitionId = null, { weekId = null } = {}) {
  const leagueId = getActiveLeagueId();
  const active = getPlayers().filter((p) => p && p.active);
  const comps = liveCompetitions(leagueId);
  if (comps.length <= 1) return active;
  const c = competitionId ? getCompetition(leagueId, competitionId) : getDefaultCompetition(leagueId);
  if (!c || c.archivedAt) return [];
  if (c.enrollment !== 'opt_in') return active.filter((p) => p.tournamentOnlyGuest !== true);
  const cutoff = weekId ? entryCutoffMs(weekId) : null;
  const entered = new Set();
  for (const r of getStoredCompetitionMembers()) {
    if (!r || r.competitionId !== c.id || !r.memberId) continue;
    if (cutoff !== null) {
      const joined = Date.parse(r.joinedAt);
      if (Number.isFinite(joined) && joined >= cutoff) continue;   // joined AT or after the lock: counts from the next week
    }
    entered.add(String(r.memberId));
  }
  return active.filter((p) => entered.has(String(p.playerId)));
}

/**
 * The entrants of a week RECORD'S own competition, for that week (C1) - THE ONE roster function for a week (D1 merge, 2026-10-08: Lane A's `weekPlayers` and the client's `playersForWeek` were the
 * same B2 fix written twice; this is the survivor, and every week-scoped consumer goes through it - finalize and its group branch, the wizard's Steps 3 and 4, the review card, the guess count, the
 * locked notice's "k of n", the Comm Extra Point card, SCRIBE's signals, the digest, the Dashboard, Home's feed slices). A league that runs one sport: every active player, exactly as before. A
 * league that runs two or more: the members who joined the week's sport BEFORE it locked; a member who is not in that sport, and one who joined after the lock, are not in it, so they are absent from
 * the results, the ranks, the winner and loser and the obligation between them. A week whose competition reference dangles (not hydrated yet) has nobody: fail closed.
 */
export function playersForWeek(week) {
  if (!week || !isMultiSport()) return getPlayers().filter((p) => p && p.active);   // the single-sport rule FIRST (merge 2026-10-08): in a one-sport league no week is ever "dangling" - every active player, as before
  const c = competitionForWeek(week);
  if (week.competitionId && !c) return [];
  return playersForCompetition(c ? c.id : null, { weekId: week.weekId });
}

/**
 * The matching PICKS filter for `playersForWeek` (security A3, "a non-entrant counts for nothing"): the pick rows of `players` only. A member who never joined a sport can still hold a pick ROW in
 * it (RLS admits one); it must count for nothing - not as a result, not as "somebody else also picked that side" in a lone-wolf or consensus count. With ONE sport the very same array comes back,
 * untouched (the single-sport rule). Tolerates a missing array or a null row.
 */
export function picksOfRoster(picks, players) {
  if (!isMultiSport()) return picks;
  const ids = new Set((players || []).map((p) => p && p.playerId));
  return (picks || []).filter((p) => p && ids.has(p.playerId));
}

/** Does the signed-in viewer play this competition (optionally as of a week, C1)? A signed-out or unverified viewer plays nothing. */
export function viewerPlaysCompetition(competitionId, { weekId = null } = {}) {
  const me = viewerMemberId();
  if (!me) return false;
  return playersForCompetition(competitionId, { weekId }).some((p) => String(p.playerId) === me);
}

/**
 * The non-archived sports the VIEWER plays, in competition order (default first), one entry per sport: `{ dbCode, competitionId, competition, label, code, glyphKey }`.
 * In a league with one sport this is that sport whoever is looking (the single-sport rule); with none (pre-backfill) it is [].
 * `playedSports().length >= 2` is the ONE rule that shows the sport switcher (DI-555) and the Dashboard's All sports.
 */
export function playedSports(leagueId = getActiveLeagueId()) {
  const comps = liveCompetitions(leagueId);
  if (comps.length < 2) return comps.map(sportEntry);
  const seen = new Set();
  const out = [];
  for (const c of comps) {
    if (seen.has(c.sport)) continue;
    if (!viewerPlaysCompetition(c.id)) continue;
    seen.add(c.sport);
    out.push(sportEntry(c));
  }
  return out;
}

/** Every non-archived sport of the league (one entry per sport, competition order), played or not: what the league overview lists. */
export function leagueSports(leagueId = getActiveLeagueId()) {
  const seen = new Set();
  const out = [];
  for (const c of liveCompetitions(leagueId)) {
    if (seen.has(c.sport)) continue;
    seen.add(c.sport);
    out.push(sportEntry(c));
  }
  return out;
}

/** The first non-archived competition of a sport, or null. (One competition per sport in this release; a tournament kind is a later phase.) */
export function competitionForSport(dbCode) {
  return liveCompetitions().find((c) => c.sport === dbCode) || null;
}

// ── the device-local pointers (A5): { [userId]: { [leagueId]: value } }, validated on EVERY read ─────────────────────────────────────

const SAFE_KEY = /^[A-Za-z0-9_.:@-]{1,120}$/;
const POISON = new Set(['__proto__', 'constructor', 'prototype']);
const safeKey = (k) => typeof k === 'string' && SAFE_KEY.test(k) && !POISON.has(k);
const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** Whose pointer this is: the proven account, else 'local' on a device with no Supabase auth (PIN era), else '' (signed out in Supabase mode: no pointer at all). */
function pointerUser() {
  let id = null;
  try { id = getAccountUserId(); } catch { id = null; }
  if (id && safeKey(String(id))) return String(id);
  try { if (getAuthMode() !== 'supabase') return 'local'; } catch { /* unknown mode: no pointer */ }
  return '';
}

function readEntry(readMap) {
  const user = pointerUser();
  const league = getActiveLeagueId();
  if (!user || !league || !safeKey(league)) return null;
  let map = null;
  try { map = readMap(); } catch { map = null; }
  if (!own(map, user) || !own(map[user], league)) return null;
  return map[user][league];
}

function writeEntry(readMap, writeMap, value) {
  const user = pointerUser();
  const league = getActiveLeagueId();
  if (!user || !league || !safeKey(league)) return false;
  try {
    const map = readMap();
    const mine = own(map, user) && map[user] && typeof map[user] === 'object' && !Array.isArray(map[user]) ? map[user] : {};
    const nextMine = { ...mine };
    if (value === null || value === undefined) delete nextMine[league]; else nextMine[league] = value;
    writeMap({ ...map, [user]: nextMine });
    return true;
  } catch { return false; }   // the storage seam's write interlock throws while the adapter is not serving; a pointer that did not persist is a harmless miss
}

/**
 * The sport Picks, Dashboard and Standings are on (DI-520). Always a dbCode, never null:
 *   one sport (or none)   the league's one sport ('cfb' before the backfill) — the stored pointer is never consulted;
 *   several sports        the stored pointer, ONLY if it names a non-archived sport of this league AND the viewer plays it (A4, A5, DI-555); otherwise the first sport the
 *                         viewer plays; with none played, the league's default sport (read-only: the surfaces say "You're not in any sport's picks yet").
 * A stale or forged pointer is ignored and never persisted.
 */
export function getActiveSportKey() {
  const comps = liveCompetitions();
  if (comps.length < 2) return comps.length ? comps[0].sport : 'cfb';
  const played = playedSports();
  const stored = readEntry(getActiveSportMap);
  if (typeof stored === 'string' && played.some((s) => s.dbCode === stored)) return stored;
  if (played.length) return played[0].dbCode;
  return (getDefaultCompetition() || comps[0]).sport;
}

/** Move the pointer. False (and nothing stored) unless the league has several sports and the viewer plays `dbCode`. */
export function setActiveSportKey(dbCode) {
  if (!isMultiSport()) return false;
  const code = typeof dbCode === 'string' ? dbCode : '';
  if (!code || !playedSports().some((s) => s.dbCode === code)) return false;
  return writeEntry(getActiveSportMap, setActiveSportMap, code);
}

/** The competition behind the pointer, or null before the backfill. */
export function getContextCompetition() {
  const comps = liveCompetitions();
  if (!comps.length) return null;
  if (comps.length < 2) return comps[0];
  const key = getActiveSportKey();
  return comps.find((c) => c.sport === key) || getDefaultCompetition() || comps[0];
}

/** The current week of the context sport. With one sport this IS getCurrentWeek() (the same call, the same answer). */
export function getContextWeek() {
  if (!isMultiSport()) return getCurrentWeek();
  const c = getContextCompetition();
  return c ? getCurrentWeekFor(c.id) : getCurrentWeek();
}

/** The weeks of the context sport: a READ-ONLY copy (never the array a write is built from, DI-220's top risk). With one sport: every week. */
export function getContextWeeks() {
  if (!isMultiSport()) return getWeeks().slice();
  const c = getContextCompetition();
  return c ? getWeeksForCompetition(c.id) : getWeeks().slice();
}

/**
 * The Dashboard's scope: DASHBOARD_ALL ('all') or the context sport. 'all' is honoured only when the league has several sports and the viewer plays TWO OR MORE of them; any other
 * stored value is ignored (a forged scope can never widen what the viewer sees, C7). It never changes the pointer, and Picks and Standings never read it.
 */
export function getDashboardScope() {
  if (isMultiSport() && playedSports().length >= 2 && readEntry(getDashboardScopeMap) === DASHBOARD_ALL) return DASHBOARD_ALL;
  return getActiveSportKey();
}

/** Set (DASHBOARD_ALL) or clear (anything else) the Dashboard scope. Setting 'all' is refused (false) unless the viewer plays two or more sports. */
export function setDashboardScope(scope) {
  if (scope === DASHBOARD_ALL) {
    if (!isMultiSport() || playedSports().length < 2) return false;
    return writeEntry(getDashboardScopeMap, setDashboardScopeMap, DASHBOARD_ALL);
  }
  return writeEntry(getDashboardScopeMap, setDashboardScopeMap, null);
}

/**
 * DI-538 (A5): on an account change, delete EVERY OTHER account's entries from both device-local maps (a second Google account on the same handset never inherits the first one's
 * sport, and nothing of the first stays behind). `keepUserId` falsy deletes them all. Best-effort: a write that cannot persist is a no-op, never a throw.
 */
export function clearSportContextExcept(keepUserId = null) {
  for (const [read, write] of [[getActiveSportMap, setActiveSportMap], [getDashboardScopeMap, setDashboardScopeMap]]) {
    try {
      const map = read();
      const keep = keepUserId && own(map, String(keepUserId)) ? { [String(keepUserId)]: map[String(keepUserId)] } : {};
      if (JSON.stringify(keep) !== JSON.stringify(map)) write(keep);
    } catch { /* hygiene, never a throw */ }
  }
}
