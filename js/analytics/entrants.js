/**
 * CFB Pickems - js/analytics/entrants.js (D2 lane 4; DI-942 security A3; 2026-10-19)
 * ===================================================================================
 * THE ROSTER RULE, ONE PURE FUNCTION, used by the browser builder and the server builder. A non-entrant's pick row can
 * exist (RLS admits one) and must count for NOTHING: not as a result, not as "somebody else also picked that side" in a
 * consensus or lone-wolf count.
 *
 * It mirrors `playersForWeek` / `playersForCompetition` (js/competition.js) on plain data; analyticsentranttest-style
 * parity is asserted in analyticstest on fixtures (joined before lock, joined after, deactivated, archived competition):
 *
 *   zero or one live competition   every active member (the single-sport rule; also a league with no competition rows)
 *   enrollment 'all'                every active member except a tournament-only guest
 *   enrollment 'opt_in'             active members with a competition_members row whose joinedAt is BEFORE the week's lock
 *                                   instant (a row with no parseable joinedAt counts: legacy / local)
 *   an unknown competition id       nobody (never another sport's roster)
 *   an ARCHIVED competition         nobody by default (parity with playersForWeek); `includeArchived: true` applies the
 *                                   enrollment rule to its history (Archive Sport preserves analytics, DI-942)
 *
 * Imports nothing. No storage, no clock.
 */

/**
 * @param {object} a
 * @param {object} a.week             the week record (competitionId, weekId)
 * @param {object[]} a.competitions   [{ id, enrollment, archivedAt, isDefault }]
 * @param {object[]} a.members        [{ playerId, active, tournamentOnlyGuest }]
 * @param {object[]} a.competitionMembers  [{ competitionId, memberId, joinedAt }]
 * @param {number|null} a.cutoffMs    the week's lock instant in ms (entryCutoffMs), or null (nobody is late)
 * @param {boolean} [a.includeArchived]
 * @returns {string[]} member ids, in `members` order
 */
export function entrantsOf({ week, competitions = [], members = [], competitionMembers = [], cutoffMs = null, includeArchived = false }) {
  const active = (members || []).filter((p) => p && p.active);
  const ids = (list) => list.map((p) => String(p.playerId));
  const live = (competitions || []).filter((c) => c && !c.archivedAt);
  // the single-sport rule FIRST (playersForWeek): fewer than two live competitions means every active member, in every week
  if (!week || live.length < 2) return ids(active);
  const comp = week.competitionId
    ? (competitions || []).find((c) => c && c.id === week.competitionId) || null
    : ((competitions || []).find((c) => c && c.isDefault === true) || null);      // getDefaultCompetition: the one is_default row, archived or not
  if (week.competitionId && !comp) return [];             // a dangling competition reference: fail closed
  if (!comp) return [];
  if (comp.archivedAt && !includeArchived) return [];
  if (comp.enrollment !== 'opt_in') return ids(active.filter((p) => p.tournamentOnlyGuest !== true));
  const entered = new Set();
  for (const r of competitionMembers || []) {
    if (!r || r.competitionId !== comp.id || !r.memberId) continue;
    if (cutoffMs !== null && cutoffMs !== undefined) {
      const joined = Date.parse(r.joinedAt);
      if (Number.isFinite(joined) && joined >= cutoffMs) continue;     // joined AT or after the lock: counts from the next week
    }
    entered.add(String(r.memberId));
  }
  return ids(active.filter((p) => entered.has(String(p.playerId))));
}
