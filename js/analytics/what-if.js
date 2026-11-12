/**
 * CFB Pickems - js/analytics/what-if.js (D2 lane 4 batch 2, third pass; DI-978 to 982 "What-if strategies, retrospective only"; UN/PF-524; mockup frame 5; 2026-10-21)
 * =====================================================================================================================================================================
 * The DATA of the What-if screen for ONE viewer, ONE sport and ONE season, computed from an eligible FINAL-WEEK input: pure, no storage, no DOM, no clock (`now` is a parameter).
 * It reads only the engine's own strategy metrics (m-strategies.js) through runMetric, so every number here is the number the insight detail, the Home card and the Ask packet show
 * for the same insight id (DI-1000 Gate E): nothing is recomputed outside js/analytics.
 *
 *   whatIfParts(input, { viewerMemberId, sport, season, copyId, teamKey, now, nameOf })
 *     -> { sport, sports, season, competitionId, none, thin: { n, min } | null, games, rows: [row], copy: { choices, chosen }, team: { choices, chosen }, perfect, cumulative }
 *   row = { key, metricId, id, name, yours: {w,l,p}, would: {w,l,p}, diff, games, leftOut, weeks: [{ n, yours, would, yoursRec, wouldRec }] | null }
 *
 * RETROSPECTIVE ONLY, NO MONEY (RPF-D2, DI-981): MONEY_OUTPUTS_ENABLED stays false and this file never asks for a price; the counts are RAW picks, not league points.
 * OWNER ONLY: every strategy is computed for the viewer about the viewer (cf.copy_member names the member COPIED, whose picks are revealed league data, final weeks only).
 * THE BLIND RULE is the input's: final weeks only, so this week's picks are never in it.
 */
import { runMetric } from './index.js';
import { scopesOf, sliceOf } from './slice.js';
import { candidateFor } from './insight.js';
import { isAvailable, minOf } from './registry.js';
import { strategySet } from './m-strategies.js';

/** the four always-available strategies, in the mockup's order: [cumulative key, metric id, the plain name the screen shows] */
export const WHAT_IF_ROWS = Object.freeze([
  Object.freeze(['always_favorite', 'cf.always_favorite', 'Always take the favorite']),
  Object.freeze(['always_underdog', 'cf.always_underdog', 'Always take the underdog']),
  Object.freeze(['follow_consensus', 'cf.follow_consensus', 'Follow the room']),
  Object.freeze(['fade_consensus', 'cf.fade_consensus', 'Fade the room']),
]);

const rec = (t) => ({ w: t.w, l: t.l, p: t.p || 0 });

/**
 * @param {object} input  an eligible FINAL-WEEK input
 * @param {{ viewerMemberId, sport?, season?, copyId?, teamKey?, now, nameOf? }} p
 */
export function whatIfParts(input, { viewerMemberId, sport = null, season = null, copyId = null, teamKey = null, now, nameOf = (x) => x } = {}) {
  const scopes = scopesOf(input);
  const sports = [...new Set(scopes.map((s) => s.sport))].sort();
  const sp = sports.includes(sport) ? sport : sports[0] || '';
  const inSport = scopes.filter((s) => s.sport === sp).sort((a, b) => (a.season < b.season ? 1 : a.season > b.season ? -1 : 0));
  const scope = inSport.find((s) => s.season === season) || inSport[0];
  const out = { sport: sp, sports, season: scope ? scope.season : '', competitionId: scope ? scope.competitionId : null, none: true, thin: null, games: 0, rows: [], copy: { choices: [], chosen: null }, team: { choices: [], chosen: null }, never: null, perfect: null, cumulative: false };
  if (!scope || !viewerMemberId) return out;
  const slice = sliceOf(input, { competitionId: scope.competitionId, season: scope.season });
  if (!slice || !slice.finals.length || !slice.memberIds.includes(viewerMemberId)) return out;
  out.none = false;
  const set = strategySet(slice, viewerMemberId);
  out.games = set.length;
  const min = minOf('strategyGames');
  if (set.length < min) { out.thin = { n: set.length, min }; return out; }       // "What if needs about 12 graded picks. You have {n}." (DI-982): the rows are hidden except the count
  const base = { competitionId: scope.competitionId, season: scope.season };
  const ctx = { slice, viewerMemberId, now, ring: [], slate: [], ledger: [], nameOf, gameLabel: (id) => id, leagueName: input.leagueName };
  const idOf = (m) => { try { const c = candidateFor(m, ctx); return c ? c.id : null; } catch { return null; } };
  const rowOf = (key, m, name) => ({
    key, metricId: m.id, id: idOf(m), name,
    yours: rec(m.value.actual), would: rec(m.value.strategy), diff: m.value.diffWins, games: m.value.games, leftOut: m.value.leftOut || 0, weeks: null,
  });
  const cum = runMetric(input, 'cf.cumulative', { memberId: viewerMemberId, ...base });
  out.cumulative = isAvailable(cum);
  for (const [key, metricId, name] of WHAT_IF_ROWS) {
    const m = runMetric(input, metricId, { memberId: viewerMemberId, ...base });
    if (!isAvailable(m)) continue;
    const row = rowOf(key, m, name);
    if (out.cumulative) {
      const v = cum.value;
      row.weeks = v.weeks.map((n, i) => ({
        n, yours: v.actual[i], would: v.strategies[key][i],
        yoursRec: rec(v.weeklyRecords.vs[key][i]), wouldRec: rec(v.weeklyRecords[key][i]),
      }));
    }
    out.rows.push(row);
  }
  // "What if I copied ..." (DI-978): chosen by the viewer from the entrants sharing at least 15 graded games; computed on demand, one member at a time
  for (const y of slice.memberIds) {
    if (y === viewerMemberId) continue;
    const m = runMetric(input, 'cf.copy_member', { memberId: viewerMemberId, copyId: y, ...base });
    if (!isAvailable(m)) continue;
    out.copy.choices.push({ id: y, name: String(nameOf(y)), games: m.value.games });
    if (y === copyId) out.copy.chosen = { ...rowOf('copy', m, `Copy ${String(nameOf(y))}`), memberId: y };
  }
  out.copy.choices.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // "What if I had backed {Team} every time?" (DI-980): the team with the most appearances in the set first, then a picker over every team with at least four
  const counts = new Map();
  for (const r of set) for (const [k, nm] of [[r.g.homeKey, r.g.home], [r.g.awayKey, r.g.away]]) { const c = counts.get(k) || { key: k, name: nm, games: 0 }; c.games++; counts.set(k, c); }
  out.team.choices = [...counts.values()].filter((c) => c.games >= minOf('strategyTeam')).sort((a, b) => (b.games - a.games) || (a.key < b.key ? -1 : 1)).map((c) => ({ key: c.key, name: c.name, games: c.games }));
  const pickTeam = out.team.choices.find((c) => c.key === teamKey) || out.team.choices[0] || null;
  if (pickTeam) {
    const m = runMetric(input, 'cf.team_record', { memberId: viewerMemberId, teamKey: pickTeam.key, ...base });
    if (isAvailable(m)) out.team.chosen = { ...rowOf('team', m, `Back ${m.value.team} every time`), teamKey: pickTeam.key };
  }
  // "What if I never changed my pick?" (DI-980): the viewer only, ONLY when the platform's pick-history setting is on and pick_events holds data; otherwise the row is ABSENT (no "coming soon")
  const nc = runMetric(input, 'cf.never_changed', { memberId: viewerMemberId, ...base });
  if (isAvailable(nc)) out.never = { key: 'never_changed', metricId: nc.id, id: idOf(nc), name: 'Keep your first picks', yours: rec(nc.value.actual), would: rec(nc.value.neverChanged), diff: nc.value.neverChanged.w - nc.value.actual.w, games: nc.value.games, leftOut: 0, weeks: null };
  const pc = runMetric(input, 'cf.perfect_card', { memberId: viewerMemberId, ...base });
  if (isAvailable(pc)) out.perfect = { perfect: pc.value.perfect, oneMissAway: pc.value.oneMissAway, perfectWeeks: [...pc.value.perfectWeeks], oneMissWeeks: [...pc.value.oneMissWeeks], weeksCounted: pc.n };
  return out;
}
