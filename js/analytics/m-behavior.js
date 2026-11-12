/**
 * CFB Pickems - js/analytics/m-behavior.js (D2 lane 4; DI-958 "Behavioural", DI-961; UN/PF-519; 2026-10-19)
 * ==========================================================================================================
 * OBSERVATIONS ONLY. The copy never explains why ("you were scared" is banned, DI-985). Reveal class: final-week.
 *
 *   beh.after_week       favourite share after an under-.500 week against after an over-.500 week
 *   beh.leading_trailing consensus rate entering a week as the leader against as a trailer
 *   beh.trust_run        the current run of consecutive appearances backing (or fading) one team
 *   beh.burn_rebound     after backing a team and losing, did the member stay or switch at the next appearance
 *   beh.pick_change / beh.first_vs_final   EXPLICIT GAP (DI-961, RPF-D1): need `pick_events` (migration 0068). Dark by default
 *                        (pick-events-flag.js), ABOUT THE VIEWER ONLY, never shareable, never a league superlative.
 *
 * The successor of a week is the next FINAL week of the SAME competition and season (the slice guarantees both).
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL } from './registry.js';
import { graded, wins, losses, roleEligible, supportOfPicks } from './slice.js';
import { gameSplits } from './m-consensus.js';
import { rankSeries } from './m-performance.js';

export { pickEventsOn, PICK_EVENTS_KV_KEY } from './pick-events-flag.js';

const FW = REVEAL.FINAL_WEEK;
const mineOf = (slice, id) => slice.picksByMember.get(id) || [];
const inUnit = (picks, unit) => picks.filter((p) => unit.weekIds.includes(p.weekId));

export const BEH_AFTER_WEEK = register({
  id: 'beh.after_week', v: 1, family: 'behavior', reveal: FW, level: 'member', minKey: 'behWeeks',
  run(slice, { memberId }) {
    const def = BEH_AFTER_WEEK;
    const subject = { kind: 'member', id: memberId };
    const mine = mineOf(slice, memberId);
    const sides = { under: { weeks: [], picks: [] }, over: { weeks: [], picks: [] } };
    for (let i = 0; i + 1 < slice.units.length; i++) {
      const u = slice.units[i], next = slice.units[i + 1];
      const g = graded(inUnit(mine, u));
      if (g.length < minOf('behWeekGraded')) continue;
      const w = wins(g), l = losses(g);
      const side = w > l ? 'over' : w < l ? 'under' : null;            // exactly .500 is neither
      if (!side) continue;
      const nextEl = roleEligible(inUnit(mine, next));
      if (!nextEl.length) continue;
      sides[side].weeks.push(u.weekNumber);
      sides[side].picks.push(...nextEl);
    }
    const minW = minOf('behWeeks'), minP = minOf('behPicks');
    const ok = (s) => s.weeks.length >= minW && s.picks.length >= minP;
    if (!ok(sides.under) || !ok(sides.over)) return unavailable({ def, slice, subject, reason: 'thin', n: Math.min(sides.under.weeks.length, sides.over.weeks.length), min: minW });
    const pack = (s) => { const fav = s.picks.filter((p) => p.pickedFavorite === true).length; return { weeks: s.weeks, n: s.picks.length, fav, share: ratio(fav, s.picks.length) }; };
    return makeMetric({ def, slice, subject, n: sides.under.picks.length + sides.over.picks.length, value: { under: pack(sides.under), over: pack(sides.over) }, supportRows: supportOfPicks([...sides.under.picks, ...sides.over.picks]) });
  },
});

export const BEH_LEADING_TRAILING = register({
  id: 'beh.leading_trailing', v: 1, family: 'behavior', reveal: FW, level: 'member', minKey: 'behWeeks',
  run(slice, { memberId }) {
    const def = BEH_LEADING_TRAILING;
    const subject = { kind: 'member', id: memberId };
    const minW = minOf('behWeeks');
    if (slice.memberIds.length < minOf('rankEntrants')) return unavailable({ def, slice, subject, reason: 'thin', n: slice.memberIds.length, min: minOf('rankEntrants') });
    const series = rankSeries(slice);
    const gs = gameSplits(slice);
    const state = { leading: { weeks: [], rows: [] }, trailing: { weeks: [], rows: [] } };
    const n = slice.memberIds.length;
    for (let i = 0; i + 1 < series.length; i++) {
      const totals = series[i].totals;
      const mine = totals.get(memberId), rank = series[i].ranks.get(memberId);
      if (mine === undefined) continue;
      const top = Math.max(...Array.from(totals.values()));
      const label = mine === top ? 'leading' : rank > Math.ceil(n / 2) ? 'trailing' : null;
      if (!label) continue;
      const rows = inUnit(mineOf(slice, memberId), slice.units[i + 1]).map((p) => ({ p, s: gs.get(p.gameId) })).filter((r) => r.s && r.s.majority !== null && r.p.side !== null);
      if (!rows.length) continue;
      state[label].weeks.push(slice.units[i + 1].weekNumber);
      state[label].rows.push(...rows);
    }
    const ok = (s) => s.weeks.length >= minW && s.rows.length >= minOf('behPicks');
    if (!ok(state.leading) || !ok(state.trailing)) return unavailable({ def, slice, subject, reason: 'thin', n: Math.min(state.leading.weeks.length, state.trailing.weeks.length), min: minW });
    const pack = (s) => { const w = s.rows.filter((r) => r.s.majority === r.p.side).length; return { weeks: s.weeks, n: s.rows.length, with: w, rate: ratio(w, s.rows.length) }; };
    return makeMetric({ def, slice, subject, n: state.leading.rows.length + state.trailing.rows.length, value: { leading: pack(state.leading), trailing: pack(state.trailing) }, supportRows: supportOfPicks([...state.leading.rows, ...state.trailing.rows].map((r) => r.p)) });
  },
});

const appMemo = new WeakMap();
/** M's graded appearances with a team, in kickoff order, each tagged backed/faded (memoised per slice and member). */
function appearances(slice, memberId) {
  let per = appMemo.get(slice);
  if (!per) { per = new Map(); appMemo.set(slice, per); }
  if (per.has(memberId)) return per.get(memberId);
  const byTeam = new Map();
  for (const p of graded(mineOf(slice, memberId))) {
    for (const [key, role] of [[p.teamKey, 'backed'], [p.opponentKey, 'faded']]) {
      if (key === null) continue;
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push({ p, role });
    }
  }
  for (const list of byTeam.values()) list.sort((a, b) => ((a.p.kickoffMs ?? 0) - (b.p.kickoffMs ?? 0)) || (a.p.gameId < b.p.gameId ? -1 : a.p.gameId > b.p.gameId ? 1 : 0));
  per.set(memberId, byTeam);
  return byTeam;
}
const teamLabel = (slice, key) => { for (const g of slice.games) { if (g.homeKey === key) return g.home; if (g.awayKey === key) return g.away; } return key; };

export const BEH_TRUST_RUN = register({
  id: 'beh.trust_run', v: 1, family: 'behavior', reveal: FW, level: 'member', minKey: 'trustRun',
  enumerate(slice) {
    const out = [];
    for (const id of slice.memberIds) for (const [teamKey, list] of appearances(slice, id)) { if (list.length >= minOf('trustRun')) out.push({ memberId: id, teamKey }); }
    return out;
  },
  run(slice, { memberId, teamKey }) {
    const def = BEH_TRUST_RUN;
    const subject = { kind: 'member', id: memberId, id2: teamKey };
    const list = appearances(slice, memberId).get(teamKey) || [];
    const min = minOf('trustRun');
    let run = 0;
    const role = list.length ? list[list.length - 1].role : null;
    for (let i = list.length - 1; i >= 0 && list[i].role === role; i--) run++;
    if (run < min) return unavailable({ def, slice, subject, reason: 'thin', n: run, min });
    return makeMetric({ def, slice, subject, n: run, value: { team: teamLabel(slice, teamKey), role, run }, supportRows: supportOfPicks(list.slice(list.length - run).map((x) => x.p)) });
  },
});

export const BEH_BURN_REBOUND = register({
  id: 'beh.burn_rebound', v: 1, family: 'behavior', reveal: FW, level: 'member', minKey: 'burns',
  run(slice, { memberId }) {
    const def = BEH_BURN_REBOUND;
    const subject = { kind: 'member', id: memberId };
    let burns = 0, stayed = 0, switched = 0;
    const sup = [];
    for (const list of appearances(slice, memberId).values()) {
      for (let i = 0; i + 1 < list.length; i++) {
        if (list[i].role === 'backed' && list[i].p.result === 'loss') {
          burns++;
          if (list[i + 1].role === 'backed') stayed++; else switched++;
          sup.push(list[i].p, list[i + 1].p);
        }
      }
    }
    const min = minOf('burns');
    if (burns < min) return unavailable({ def, slice, subject, reason: 'thin', n: burns, min });
    return makeMetric({ def, slice, subject, n: burns, num: switched, den: burns, value: { burns, stayed, switched }, supportRows: supportOfPicks(sup) });
  },
});

// ---- EXPLICIT GAP: pick history (DI-961; RPF-D1 = the viewer only) -----------------------------------------------------

/** The viewer's pick events grouped per pick (game), self-source only (an admin edit is not the member's own change). */
export function eventsByGame(input) {
  const m = new Map();
  for (const e of input.pickEvents || []) {
    if (e.source !== 'self') continue;
    if (!m.has(e.gameId)) m.set(e.gameId, []);
    m.get(e.gameId).push(e);
  }
  for (const l of m.values()) l.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return m;
}
export const firstTeam = (events) => events[0].fromTeam ?? events[0].toTeam;

function pickHistoryRun(def, slice, memberId, build) {
  const subject = { kind: 'member', id: memberId };
  if (!slice.input.viewerMemberId || memberId !== slice.input.viewerMemberId) return unavailable({ def, slice, subject, reason: 'private', n: 0, min: minOf('pickEventPicks') });   // RPF-D1: about the viewer only
  const ev = eventsByGame(slice.input);
  if (ev.size === 0) return unavailable({ def, slice, subject, reason: 'no_history', n: 0, min: minOf('pickEventPicks') });
  const rows = graded(mineOf(slice, memberId)).filter((p) => ev.has(p.gameId)).map((p) => ({ p, first: firstTeam(ev.get(p.gameId)), g: slice.gameById.get(p.gameId) }));
  const changed = rows.filter((r) => r.first !== r.p.team);
  if (rows.length < minOf('pickEventPicks') || changed.length < minOf('pickEventChanges')) return unavailable({ def, slice, subject, reason: 'thin', n: rows.length, min: minOf('pickEventPicks') });
  return build(rows, changed, subject);
}
const firstWins = (r) => { const side = r.first === r.g.home ? 'home' : r.first === r.g.away ? 'away' : null; return side !== null && side === r.g.atsSide; };

export const BEH_PICK_CHANGE = register({
  id: 'beh.pick_change', v: 1, family: 'behavior', reveal: FW, level: 'member', minKey: 'pickEventPicks', private: true,
  run(slice, { memberId }) {
    const def = BEH_PICK_CHANGE;
    return pickHistoryRun(def, slice, memberId, (rows, changed, subject) => {
      const kept = rows.filter((r) => r.first === r.p.team);
      return makeMetric({ def, slice, subject, n: rows.length, num: changed.length, den: rows.length, value: { changedShare: ratio(changed.length, rows.length), changed: { n: changed.length, w: wins(changed.map((r) => r.p)), l: losses(changed.map((r) => r.p)) }, unchanged: { n: kept.length, w: wins(kept.map((r) => r.p)), l: losses(kept.map((r) => r.p)) } }, supportRows: supportOfPicks(changed.map((r) => r.p)) });
    });
  },
});

export const BEH_FIRST_VS_FINAL = register({
  id: 'beh.first_vs_final', v: 1, family: 'behavior', reveal: FW, level: 'member', minKey: 'pickEventPicks', private: true,
  run(slice, { memberId }) {
    const def = BEH_FIRST_VS_FINAL;
    return pickHistoryRun(def, slice, memberId, (rows, changed, subject) => {
      const firstWon = changed.filter(firstWins).length;
      const finalWon = changed.filter((r) => r.p.result === 'win').length;
      return makeMetric({ def, slice, subject, n: changed.length, value: { changed: changed.length, firstWouldHaveWon: firstWon, finalWon }, supportRows: supportOfPicks(changed.map((r) => r.p)) });
    });
  },
});
