/**
 * CFB Pickems - js/analytics/your-numbers.js (D2 lane 4 batch 2; DI-964 "Profile > Your numbers", DI-984/985 labels, DI-1086 "Your teams"; UN-519/543; 2026-10-21)
 * ====================================================================================================================================================
 * The DATA of the Your numbers screen for ONE viewer and ONE sport, computed from an eligible input: pure, no storage, no DOM, no clock (`now` is a parameter). It returns candidates (so a row
 * opens the same detail a Home card does) grouped as the screen shows them. OWNER ONLY: it is computed for the viewer about the viewer; a hidden label shows to its holder only (labelsFor).
 * Nothing here applies the emit floor (this is the member's own page: every figure that exists is shown), but every figure still obeys its minimum sample (below it the metric is unavailable
 * and appears under "What unlocks next" instead of as a number). The blind rule is the input's: final weeks only.
 */
import { runMetric, labelsFor } from './index.js';
import { scopesOf, sliceOf } from './slice.js';
import { candidateFor, REASON_CHIPS } from './insight.js';
import { isAvailable, getDef } from './registry.js';
import { teamRowFor, TEAM_STALE_MS } from './m-teams.js';

const IDENTITY = ['ident.team_most_backed', 'ident.team_most_faded', 'ident.fav_dog', 'ident.home_away'];      // DI-964: most backed and faded, favourite versus underdog, home versus away
const PERFORMANCE = ['perf.best_worst_week', 'perf.streaks', 'perf.weeks_won_lost'];
const SOCIAL = ['pair.similar_opposite'];
/** the plain names "What unlocks next" uses (a metric not listed here is never named) */
const UNLOCK_NAMES = Object.freeze({
  'ident.fav_dog': 'Favorites versus underdogs', 'ident.home_away': 'Home versus away', 'ident.team_most_backed': 'Your most backed team', 'ident.team_most_faded': 'Your most faded team', 'perf.best_worst_week': 'Best and worst week',
  'perf.streaks': 'Streaks', 'perf.weeks_won_lost': 'Weeks won and lost', 'perf.rise_fall': 'Rank history', 'pair.similar_opposite': 'Most similar and most opposite',
});
const WEEK_KEYS = new Set(['perfWeeks', 'riseFallWeeks', 'volatilityWeeks', 'labelWindowMin', 'priorWeeksLo', 'weeklyH2hWeeks', 'behWeeks', 'cumulativeWeeks', 'leagueWeeks']);
const plural = (n, one, many) => (n === 1 ? one : many);

const recText = (v, sport) => (sport === 'nhl' ? `${v.w}-${v.l}-${v.otl}` : v.t ? `${v.w}-${v.l}-${v.t}` : `${v.w}-${v.l}`);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };

/** one Your teams row from a team metric: { label, value, id? } (id = the insight id the row opens) */
function teamRow(metric, ctx, sport) {
  const v = metric.value;
  const c = candidateFor(metric, ctx);
  const id = c ? c.id : null;
  switch (metric.id) {
    case 'team.record': return { label: 'Record', value: `${recText(v, sport)}${v.home ? ` · home ${recText(v.home, sport)}` : ''}${v.away ? ` · away ${recText(v.away, sport)}` : ''}`, id };
    case 'team.form': return { label: 'Form', value: `${v.last.join(' ')}${v.run.streak ? ` · ${v.run.n} straight` : ''}`, id };
    case 'team.scoring': return { label: 'Scoring', value: `${v.season.pf} for · ${v.season.pa} against`, id };
    case 'team.ats_in_league': return { label: "In your league's games", value: `covered ${v.covered} of ${v.games}`, id };
    case 'team.leaders_recent': return { label: 'Latest game', value: v.items.map((i) => `${i.who} ${i.line}`).join('; '), id };
    case 'team.coach': return { label: 'Coach', value: `${v.name} (as listed by ESPN)`, id };
    default: return null;
  }
}

/**
 * @param {object} input  an eligible FINAL-WEEK input
 * @param {{ viewerMemberId, sport, season?, now, nameOf?, nextKickoffText?, displayNames?, archiveSeasons?: [{season}] }} p
 * @returns {{ sport, sports, season, competitionId, seasons, none, labels, identity, performance, social, rankPath, teams, unlocks, nextKickoff }}
 */
export function yourNumbersParts(input, { viewerMemberId, sport, season = null, now, nameOf = (x) => x, nextKickoffText = '', displayNames = {}, archiveSeasons = [] } = {}) {
  const scopes = scopesOf(input);
  const sports = [...new Set(scopes.map((s) => s.sport))].sort();
  const sp = sports.includes(sport) ? sport : sports[0] || '';
  const out = { sport: sp, sports, season: '', competitionId: null, seasons: [], none: true, labels: [], identity: [], performance: [], social: [], rankPath: null, teams: [], unlocks: [], nextKickoff: nextKickoffText };
  const inSport = scopes.filter((s) => s.sport === sp).sort((a, b) => (a.season < b.season ? 1 : a.season > b.season ? -1 : 0));
  const scope = inSport.find((s) => s.season === season) || inSport[0];
  // Seasons (DI-964): a row per season this league's record holds for the sport, newest first, the one on screen marked; then the archive seasons the CALLER vouches for (IRB's 2025, weekly
  // totals only, pilot-only: the caller asks isPilotOnlyAllowed, this file never decides it). An archive season never repeats a season the record already holds.
  out.seasons = inSport.map((s) => ({ season: s.season, kind: 'record', current: !!scope && s.season === scope.season && s.competitionId === scope.competitionId }));
  for (const a of Array.isArray(archiveSeasons) ? archiveSeasons : []) if (a && a.sport === sp && typeof a.season === 'string' && /^\d{4}$/.test(a.season) && !out.seasons.some((x) => x.season === a.season)) out.seasons.push({ season: a.season, kind: 'archive', current: false });
  if (!scope || !viewerMemberId) return out;
  out.season = scope.season; out.competitionId = scope.competitionId;
  const slice = sliceOf(input, { competitionId: scope.competitionId, season: scope.season });
  if (!slice || !slice.finals.length || !slice.memberIds.includes(viewerMemberId)) return out;
  out.none = false;
  const base = { competitionId: scope.competitionId, season: scope.season };
  const ctx = { slice, viewerMemberId, now, ring: [], slate: [], ledger: [], nameOf, gameLabel: (id) => id, leagueName: input.leagueName };
  const cand = (m) => (isAvailable(m) ? candidateFor(m, ctx) : null);
  const unavailable = [];
  const run = (id, params) => { const m = runMetric(input, id, { ...params, ...base }); if (!isAvailable(m)) unavailable.push({ id, m }); return m; };
  out.labels = labelsFor(input, viewerMemberId, { viewerMemberId }).filter((m) => m.scope.sport === sp).map(cand).filter(Boolean);
  for (const [bucket, ids] of [['identity', IDENTITY], ['performance', PERFORMANCE], ['social', SOCIAL]]) {
    for (const id of ids) { const c = cand(run(id, { memberId: viewerMemberId })); if (c) out[bucket].push(c); }
  }
  // the rank by week (DI-964 "rank path as a small line with a table twin"): the engine's perf.rank_path, final weeks only; absent below its minimum (the unlock line says so)
  const rp = runMetric(input, 'perf.rank_path', { memberId: viewerMemberId, ...base });
  if (isAvailable(rp)) out.rankPath = { path: rp.value.path.map((x) => ({ weekNumber: x.weekNumber, rank: x.rank })), entrants: rp.value.entrants, current: rp.value.current, highest: rp.value.highest, lowest: rp.value.lowest };
  // Your teams (DI-1086): at most 6, in the followed set's order (alma mater, home teams, then most picked)
  const f = input.followed.bySport[sp];
  if (f) {
    for (const key of f.teamKeys.slice(0, 6)) {
      const row = teamRowFor(input, sp, key);
      const names = new Set(row ? [row.teamKey, ...row.aliases] : [key]);
      const reasonKind = f.alma.includes(key) ? 'alma' : f.home.includes(key) ? 'home' : f.mostPicked.includes(key) ? 'picked' : (f.other || []).includes(key) ? 'other' : 'picked';
      const chip = REASON_CHIPS[reasonKind];   // M-93 DI-1112: the one table (insight.js), so "A team you follow" reaches this screen too
      if (!row) { out.teams.push({ teamKey: key, name: (displayNames[sp] && displayNames[sp][key]) || key, reasonChip: chip, rows: [], empty: true }); continue; }
      const rows = [];
      for (const id of ['team.record', 'team.form', 'team.scoring', 'team.ats_in_league', 'team.leaders_recent', 'team.coach']) {
        const m = runMetric(input, id, { ...base, teamKey: row.teamKey });
        if (!isAvailable(m)) continue;
        const r = teamRow(m, ctx, sp);
        if (r) rows.push(r);
      }
      // the link between the halves (DI-1084): how the MEMBER is doing on this team's picks
      let link = '';
      for (const k of names) {
        const t = runMetric(input, 'ident.team_record', { ...base, memberId: viewerMemberId, teamKey: k });
        if (isAvailable(t) && t.value.backed) { link = `You are ${t.value.backed.w}-${t.value.backed.l} on ${row.teamName} picks.`; break; }
      }
      const stale = !row.asOfMs ? 'Update time unknown' : now - row.asOfMs > TEAM_STALE_MS ? `Updated ${dayText(row.asOfMs)}` : '';
      out.teams.push({ teamKey: row.teamKey, name: row.teamName, reasonChip: chip, rows, empty: false, link, stale });
    }
  }
  // What unlocks next: the metrics that are only THIN, closest first, at most three, named in plain words
  const next = [];
  for (const id of Object.keys(UNLOCK_NAMES)) {
    let m = unavailable.find((u) => u.id === id);
    if (!m && id === 'perf.rise_fall') { const r = runMetric(input, id, { memberId: viewerMemberId, ...base }); if (!isAvailable(r)) m = { id, m: r }; }
    if (!m || m.m.reason !== 'thin' || !Number.isFinite(m.m.n) || !Number.isFinite(m.m.min)) continue;
    const need = m.m.min - m.m.n;
    if (need <= 0) continue;
    const def = getDef(id);
    const unit = WEEK_KEYS.has(def.minKey) ? plural(need, 'final week', 'final weeks') : plural(need, 'pick', 'picks');
    next.push({ need, text: `${UNLOCK_NAMES[id]}: ${need} more ${unit}` });
  }
  next.sort((a, b) => a.need - b.need || (a.text < b.text ? -1 : 1));
  out.unlocks = next.slice(0, 3).map((n) => ({ text: n.text }));
  return out;
}
