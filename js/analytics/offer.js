/**
 * CFB Pickems - js/analytics/offer.js (D2 lane 4 batch 2; DI-1088 "SCRIBE gets team facts through the bridge, as seasoning"; UN/PF-543, UN/PF-526; 2026-10-21)
 * =====================================================================================================================================================
 * THE RULE for offering a team fact to SCRIBE: pure, no I/O. The caller (the batch-3 facts packet) reads the global `team_facts` rows with the service role and calls this with the teams the
 * EXCHANGE names; SCRIBE never raises a team on its own to show off a stat. Public data only (a team's finished games): no league, member or pick can be in a row, so the blind rule holds trivially.
 *
 * WHAT IT ENFORCES (DI-1064, 1065, 1088):
 *   - the gate is THE EXCHANGE, not the follow set: a team is offered only when a team key the exchange names equals the row's key or an alias; an unfollowed team in the exchange gets its facts
 *   - at most ONE numeric fact (the seasoning cap); none in a `react` content mode and none in a live exchange (the decision function's `mode` and `live` come in as parameters)
 *   - a row older than 2 days is not offered (a collected record carries its `as_of`; stale is never presented as current)
 *   - the no-repeat ledger blocks restatement (window 7 days and a new final game; identical numbers never)
 *   - no injury or news claim, no prediction, no coach line beyond DI-1083 (the coach is not offered here at all), and the family switch: dark means nothing is offered
 * The offer is ONE fact { id, factKey, kind:'team', metricId, teamKey, team, text, valueKey, n, asOf } where `text` is the fixed sentence the packet carries ("Texas A&M is 4-3 this season and has
 * won 3 straight."): a model never calculates a number, and the grounding check can match the numerals in a post to this fact (DI-1061).
 */
import { cleanTeamFacts } from './input.js';
import { recordValue, formValue, TEAM_STALE_MS } from './m-teams.js';
import { flagOverride } from './registry.js';
import { factOf, isBlocked, valueKeyOf } from './ledger.js';
import { normTeam } from '../team-match.js';

const MIN_GAMES = 3;

/**
 * @param {{ rows: object[], exchangeTeams: string[], mode: 'react'|'fact'|'event', live?: boolean, ledger?: object[], now: number }} p
 *   rows = team_facts rows (team_facts_list shape); exchangeTeams = the team NAMES or keys the exchange mentions
 * @returns {object[]} [] or exactly one offered fact
 */
export function offerTeamFact({ rows, exchangeTeams, mode, live = false, ledger = [], now, familyOn = false }) {
  // `familyOn`: the league's serverJobs.teamFacts switch, read by the CALLER (the server function) from the league's settings; anything but exactly true is off
  if (!(familyOn === true || flagOverride('TEAM_FAMILY_ENABLED')) || mode !== 'fact' || live || !Number.isFinite(now)) return [];
  const named = new Set((Array.isArray(exchangeTeams) ? exchangeTeams : []).map((t) => normTeam(String(t))).filter(Boolean));
  if (!named.size) return [];
  const out = [];
  for (const row of cleanTeamFacts(rows)) {
    if (row.results.length < MIN_GAMES || now - row.asOfMs > TEAM_STALE_MS) continue;       // a missing as_of is asOfMs 0, so it is stale (fail closed; X2g2)
    if (!named.has(row.teamKey) && !row.aliases.some((a) => named.has(a))) continue;
    const rec = recordValue(row), form = formValue(row);
    const sport = row.sport;
    const recText = sport === 'nhl' ? `${rec.w}-${rec.l}-${rec.otl}` : rec.t ? `${rec.w}-${rec.l}-${rec.t}` : `${rec.w}-${rec.l}`;
    const text = form.run.streak ? `${row.teamName} is ${recText} this season and has ${form.run.kind === 'W' ? 'won' : 'lost'} ${form.run.n} straight.` : `${row.teamName} is ${recText} this season.`;
    const last = row.results[row.results.length - 1].d;
    const metric = { id: 'team.record', value: rec, n: row.results.length, subject: { kind: 'team', id: row.teamKey } };
    const id = `ins1:team:${sport}.${row.season}:team.record:${row.teamKey.replace(/[^a-z0-9]+/g, '-')}:${last}`;
    const fact = factOf({ id, metricIds: ['team.record'], metrics: [metric] });
    if (!fact || isBlocked(ledger, fact, now)) continue;
    out.push({ id, factKey: fact.factKey, kind: 'team', metricId: 'team.record', teamKey: row.teamKey, team: row.teamName, text, valueKey: valueKeyOf(metric), n: row.results.length, asOf: last, sport, asOfMs: row.asOfMs });
  }
  out.sort((a, b) => (a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0));
  return out.slice(0, 1);           // the seasoning cap: at most ONE numeric fact
}
