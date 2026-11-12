/**
 * CFB Pickems - js/analytics/m-teams.js (D2 lane 4 batch 2; DI-1080 to 1083, UN/PF-543; 2026-10-21)
 * ===================================================================================================
 * The `team.*` metrics: how the teams a member FOLLOWS are doing. Two sources and nothing else: the public `team_facts` rows (a team's FINISHED games for the season, its latest game's standouts, its
 * coach's name; collected from ESPN by the team-facts function) and, for the one league-scoped figure, the league's OWN final games. No pick of any member is read by any metric here, so no reveal gate
 * applies (they register in the `public-game` class, which both input classes compute). Level `team`; the subject is `{ kind: 'team', id: teamKey }`.
 *
 *   team.record        W-L (and T or OTL where the sport has them), overall, at home and on the road (a split shows only at 2 or more games)       min 3 games
 *   team.form          the last 5 results and the current run (3 or more in a row is a streak)                                                       min 3 games
 *   team.scoring       points for and against per game, the season and the last 5, and the average margin                                          min 4 games
 *   team.margins       the biggest win and the worst loss                                                                                          min 3 games
 *   team.vs_ranked     record against opponents ranked WHEN PLAYED (college football only), only if ESPN's payload gave the rank for 80% of games  min 3 ranked games
 *   team.ats_in_league the team's covers in games on THIS LEAGUE's slates (a locked line), graded exactly as a pick on the team would be             min 4 graded games
 *   team.leaders_recent the team's standouts in its latest finished game (never "best player", never a season claim)                                at least one standout
 *   team.coach         "{Team}, coached by {Name}, is {w}-{l}": the name ESPN lists; no start date exists, so "under {Name}" is NEVER used          min 3 games and a name
 *
 * A FIGURE EXISTS ONLY IF ITS DATA DO: below a minimum, or with a field missing, the metric is `unavailable` with a reason, never zero and never estimated. Counts are integers; averages use integer
 * sums and one rounding to one decimal. The family is DARK (teams-flag.js) and a team that is not in the member's followed set is not enumerated.
 */
import { register, makeMetric, unavailable, minOf, flagOverride, REVEAL } from './registry.js';
import { teamFamilyOn } from './teams-flag.js';

const PG = REVEAL.PUBLIC_GAME;
/** the league's serverJobs.teamFacts switch, carried on the input (teams-flag.js); withFlags({ TEAM_FAMILY_ENABLED: true }) is a TEST's override only */
const FAMILY_ON = (input) => teamFamilyOn(input) || flagOverride('TEAM_FAMILY_ENABLED');
const one = (x) => Math.round(x * 10) / 10;
const WIN = (g) => g.r === 'W';
const LOSS = (g) => g.r === 'L' || g.r === 'OTL';

/** the team_facts row a followed key names: the row whose key or alias equals it, the latest season of that sport when several exist */
export function teamRowFor(input, sport, key) {
  let best = null;
  for (const r of input.teamFacts) if (r.sport === sport && (r.teamKey === key || r.aliases.includes(key)) && (!best || r.season > best.season)) best = r;
  return best;
}

/** the record of a result list in the sport's own words: { w, l, t, otl } */
export function tally(results) {
  const o = { w: 0, l: 0, t: 0, otl: 0 };
  for (const g of results) { if (g.r === 'W') o.w++; else if (g.r === 'L') o.l++; else if (g.r === 'T') o.t++; else o.otl++; }
  return o;
}

const subjectOf = (row) => ({ kind: 'team', id: row.teamKey });
const base = (def, slice, row) => ({ def, slice, subject: subjectOf(row), level: 'team', source: 'espn', asOf: asOfOf(slice, row), window: { kind: 'season', throughWeek: null }, extra: { follow: followOf(slice, row), aliases: row.aliases } });
/** A followed team's current figures for the Game Day row (DI-1087): the row, its record and its form. Null when the family is dark, the team is not followed, the sample is under the record minimum, or the row is older than 2 days. */
export const TEAM_STALE_MS = 2 * 24 * 3600 * 1000;
export function teamSummary(input, sport, key, nowMs) {
  if (!FAMILY_ON(input)) return null;
  const f = input.followed.bySport[sport];
  if (!f) return null;
  const row = teamRowFor(input, sport, key);
  if (!row || row.results.length < minOf('teamRecord') || !row.asOfMs || (Number.isFinite(nowMs) && nowMs - row.asOfMs > TEAM_STALE_MS)) return null;       // a missing as_of is STALE, never fresh (fail closed)
  const names = new Set([row.teamKey, ...row.aliases]);
  const k = f.teamKeys.find((x) => names.has(x));
  if (!k) return null;
  const last = row.results.slice(-5);
  const end = row.results[row.results.length - 1];
  const kind = WIN(end) ? 'W' : LOSS(end) ? 'L' : null;
  let run = 0;
  if (kind) for (let i = row.results.length - 1; i >= 0; i--) { const x = row.results[i]; if ((kind === 'W' && WIN(x)) || (kind === 'L' && LOSS(x))) run++; else break; }
  return { row, team: row.teamName, teamKey: row.teamKey, reason: f.alma.includes(k) ? 'alma' : f.home.includes(k) ? 'home' : f.mostPicked.includes(k) ? 'picked' : (f.other || []).includes(k) ? 'other' : 'picked', record: tally(row.results), games: row.results.length, last: last.map((x) => x.r), run: { kind, n: run, streak: run >= 3 } };
}

/** why the member follows this team (DI-1085's reason chip): the first followed key that names the row, alma over home over most-picked; null when it is not followed */
function followOf(slice, row) {
  const f = slice.input.followed.bySport[slice.sport];
  if (!f) return null;
  const names = new Set([row.teamKey, ...row.aliases]);
  const k = f.teamKeys.find((x) => names.has(x));
  return k ? { key: k, reason: f.alma.includes(k) ? 'alma' : f.home.includes(k) ? 'home' : f.mostPicked.includes(k) ? 'picked' : (f.other || []).includes(k) ? 'other' : 'picked' } : null;
}
function asOfOf(slice, row) {
  const last = row.results[row.results.length - 1];
  return { weekId: last.d, weekNumber: 0, throughKickoffMs: Date.parse(last.d + 'T00:00:00Z') || 0 };
}
const dark = (def, slice, row) => unavailable({ def, slice, subject: subjectOf(row), reason: 'dark', n: 0, min: null });

/** run guard shared by every team metric: the family switch, then the row, then the minimum games */
function guard(def, slice, params, minKey) {
  const key = params && params.teamKey;
  const row = typeof key === 'string' ? teamRowFor(slice.input, slice.sport, key) : null;
  if (!row) return { out: unavailable({ def, slice, subject: { kind: 'team', id: String(key || '') }, reason: 'no_data', n: 0, min: minKey ? minOf(minKey) : null }) };
  if (!FAMILY_ON(slice.input)) return { out: dark(def, slice, row) };
  const n = row.results.length;
  if (minKey && n < minOf(minKey)) return { out: unavailable({ def, slice, subject: subjectOf(row), reason: 'thin', n, min: minOf(minKey) }) };
  return { row, n };
}

/** the enumerate hook: every followed team of this slice's sport that has a row */
function followedRows(slice) {
  const f = slice.input.followed.bySport[slice.sport];
  if (!f) return [];
  const seen = new Set();
  const out = [];
  for (const k of f.teamKeys) { const row = teamRowFor(slice.input, slice.sport, k); if (row && !seen.has(row.teamKey)) { seen.add(row.teamKey); out.push({ teamKey: row.teamKey, followKey: k }); } }
  return out;
}

/** the record figures of a row (shared by team.record and the SCRIBE offer) */
export function recordValue(row) {
  const split = (ha) => { const rs = row.results.filter((x) => x.ha === ha); return rs.length >= 2 ? { n: rs.length, ...tally(rs) } : null; };
  return { team: row.teamName, ...tally(row.results), games: row.results.length, home: split('home'), away: split('away') };
}
/** the form figures of a row: the last five and the current run */
export function formValue(row) {
  const last = row.results.slice(-5);
  const end = row.results[row.results.length - 1];
  const kind = WIN(end) ? 'W' : LOSS(end) ? 'L' : null;
  let run = 0;
  if (kind) for (let i = row.results.length - 1; i >= 0; i--) { const x = row.results[i]; if ((kind === 'W' && WIN(x)) || (kind === 'L' && LOSS(x))) run++; else break; }
  return { team: row.teamName, last: last.map((x) => x.r), k: last.length, run: { kind, n: run, streak: run >= 3 } };
}

export const TEAM_RECORD = register({
  id: 'team.record', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamRecord', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_RECORD, slice, params, 'teamRecord');
    if (g.out) return g.out;
    const { row, n } = g;
    return makeMetric({ ...base(TEAM_RECORD, slice, row), n, value: recordValue(row) });
  },
});

export const TEAM_FORM = register({
  id: 'team.form', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamRecord', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_FORM, slice, params, 'teamRecord');
    if (g.out) return g.out;
    const { row, n } = g;
    return makeMetric({ ...base(TEAM_FORM, slice, row), n, value: formValue(row) });
  },
});

export const TEAM_SCORING = register({
  id: 'team.scoring', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamScoring', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_SCORING, slice, params, 'teamScoring');
    if (g.out) return g.out;
    const { row, n } = g;
    const block = (rs) => { const pf = rs.reduce((a, x) => a + x.pf, 0), pa = rs.reduce((a, x) => a + x.pa, 0); return { n: rs.length, pf: one(pf / rs.length), pa: one(pa / rs.length), margin: one((pf - pa) / rs.length) }; };
    const lastN = row.results.slice(-5);
    return makeMetric({ ...base(TEAM_SCORING, slice, row), n, value: { team: row.teamName, season: block(row.results), last: block(lastN) } });
  },
});

export const TEAM_MARGINS = register({
  id: 'team.margins', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamRecord', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_MARGINS, slice, params, 'teamRecord');
    if (g.out) return g.out;
    const { row, n } = g;
    const pick = (rs, sign) => {
      let best = null;
      for (const x of rs) { const d = (x.pf - x.pa) * sign; if (d > 0 && (!best || d > best.d || (d === best.d && x.d < best.date))) best = { d, date: x.d, opp: x.on, pf: x.pf, pa: x.pa, ha: x.ha }; }
      return best;
    };
    const win = pick(row.results.filter(WIN), 1), loss = pick(row.results.filter(LOSS), -1);
    if (!win && !loss) return unavailable({ def: TEAM_MARGINS, slice, subject: subjectOf(row), reason: 'no_data', n, min: minOf('teamRecord') });
    return makeMetric({ ...base(TEAM_MARGINS, slice, row), n, value: { team: row.teamName, win, loss } });
  },
});

export const TEAM_VS_RANKED = register({
  id: 'team.vs_ranked', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamRanked', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_VS_RANKED, slice, params, null);
    if (g.out) return g.out;
    const { row, n } = g;
    if (slice.sport !== 'cfb') return unavailable({ def: TEAM_VS_RANKED, slice, subject: subjectOf(row), reason: 'no_data', n, min: minOf('teamRanked') });
    const known = row.results.filter((x) => x.or !== null).length;
    if (known * 10 < n * 8) return unavailable({ def: TEAM_VS_RANKED, slice, subject: subjectOf(row), reason: 'no_data', n, min: minOf('teamRanked'), detail: 'rank given for ' + known + ' of ' + n + ' games' });
    const rs = row.results.filter((x) => x.or >= 1);
    if (rs.length < minOf('teamRanked')) return unavailable({ def: TEAM_VS_RANKED, slice, subject: subjectOf(row), reason: 'thin', n: rs.length, min: minOf('teamRanked') });
    return makeMetric({ ...base(TEAM_VS_RANKED, slice, row), n: rs.length, value: { team: row.teamName, ...tally(rs), games: rs.length, of: n } });
  },
});

/**
 * DI-1081. Over THIS league's FINAL games that involve the team and carry a locked line, the covers: graded by the same rule a pick on the team would be (the game record's own ATS side). The scope
 * is that league's slates ONLY and the card says so; it is not the team's overall ATS record. League data, so it obeys the eligible input; a final game in an open week is fine (no pick is involved).
 */
export const TEAM_ATS = register({
  id: 'team.ats_in_league', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamAts', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_ATS, slice, params, null);
    if (g.out) return g.out;
    const { row } = g;
    const keys = new Set([row.teamKey, ...row.aliases, params.followKey].filter(Boolean));
    let c = 0, l = 0, p = 0;
    const rows = [];
    for (const gm of slice.games) {
      const home = keys.has(gm.homeKey), away = keys.has(gm.awayKey);
      if ((!home && !away) || !gm.hasLine || !gm.locked || !gm.atsSide || gm.status !== 'final') continue;
      if (gm.atsSide === 'push') p++; else if ((gm.atsSide === 'home') === home) c++; else l++;
      rows.push({ gameId: gm.gameId, weekId: gm.weekId, k: gm.kickoffMs });
    }
    const graded = c + l;
    if (graded < minOf('teamAts')) return unavailable({ def: TEAM_ATS, slice, subject: subjectOf(row), reason: 'thin', n: graded, min: minOf('teamAts') });
    return makeMetric({ ...base(TEAM_ATS, slice, row), n: graded, value: { team: row.teamName, covered: c, lost: l, pushed: p, games: graded }, supportRows: rows });
  },
});

export const TEAM_LEADERS = register({
  id: 'team.leaders_recent', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamRecord', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_LEADERS, slice, params, null);
    if (g.out) return g.out;
    const { row, n } = g;
    const L = row.leaders;
    const last = row.results[row.results.length - 1];
    if (!L || !L.items.length || L.e !== last.e) return unavailable({ def: TEAM_LEADERS, slice, subject: subjectOf(row), reason: 'no_data', n, min: null });       // standouts of a game that is not the latest are not offered
    return makeMetric({ ...base(TEAM_LEADERS, slice, row), n, value: { team: row.teamName, opp: L.on, d: L.d, items: L.items.slice(0, 2), source: 'ESPN box score' } });
  },
});

export const TEAM_COACH = register({
  id: 'team.coach', v: 1, family: 'team', reveal: PG, level: 'team', minKey: 'teamRecord', enumerate: followedRows,
  run(slice, params) {
    const g = guard(TEAM_COACH, slice, params, 'teamRecord');
    if (g.out) return g.out;
    const { row, n } = g;
    if (!row.coach) return unavailable({ def: TEAM_COACH, slice, subject: subjectOf(row), reason: 'no_data', n, min: null });
    return makeMetric({ ...base(TEAM_COACH, slice, row), n, value: { team: row.teamName, name: row.coach.name, ...tally(row.results), games: n, source: 'coach as listed by ESPN' } });
  },
});
