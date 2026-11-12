/**
 * CFB Pickems - js/analytics/m-league.js (D2 lane 4; DI-959 "League superlatives"; UN/PF-520; 2026-10-19)
 * ========================================================================================================
 * League-level (`subject.kind: 'league'`), always shareable, phrased about the room, never a person-level claim beyond a named week
 * result. Reveal class: final-week. A week that TIES at the top reports "tied at the top" (gap 0) and names nobody as the winner.
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL } from './registry.js';
import { graded, wins } from './slice.js';
import { gameSplits } from './m-consensus.js';

const FW = REVEAL.FINAL_WEEK;
const leagueSubject = (slice) => ({ kind: 'league', id: slice.leagueId });

/** weekly raw wins per member for each unit: [{ unit, wins: number[] (descending), graded, correct }] over the unit's entrants. */
function weekTable(slice) {
  return slice.units.map((u) => {
    const ids = new Set(u.weekIds.flatMap((w) => Array.from(slice.weekEntrants.get(w) || [])));
    const per = Array.from(ids).map((id) => slice.input.standingsRows.filter((r) => r.playerId === id && u.weekIds.includes(r.weekId)).reduce((s, r) => s + (r.correctCount ?? r.correctPicks), 0)).sort((a, b) => b - a);
    const ps = slice.picks.filter((p) => u.weekIds.includes(p.weekId));
    return { unit: u, wins: per, graded: graded(ps).length, correct: wins(ps), entrants: ids.size };
  });
}
const ref = (u) => ({ weekNumber: u.weekNumber, weekId: u.weekIds[0] });

function gapMetric(id, pick) {
  const def = register({
    id, v: 1, family: 'league', reveal: FW, level: 'league', minKey: 'leagueWeeks',
    run(slice) {
      const min = minOf('leagueWeeks');
      if (slice.units.length < min) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: slice.units.length, min });
      const rows = weekTable(slice).filter((r) => r.wins.length >= 2).map((r) => ({ ...r, gap: pick.gap(r.wins) }));
      if (rows.length < min) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: rows.length, min });
      const best = rows.reduce((b, r) => (pick.better(r.gap, b.gap) ? r : b), rows[0]);
      // two weeks sharing the extreme claim nothing (a tie never picks a winner)
      if (rows.some((r) => r !== best && r.gap === best.gap)) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'tie', n: rows.length, min });
      return makeMetric({ def, slice, subject: leagueSubject(slice), n: rows.length, value: { ...ref(best.unit), gap: best.gap, tiedAtTop: best.wins[0] === best.wins[1] }, supportRows: [] });
    },
  });
  return def;
}
export const LG_CLOSEST_WEEK = gapMetric('lg.closest_week', { gap: (w) => w[0] - w[1], better: (a, b) => a < b });
export const LG_BLOWOUT_WEEK = gapMetric('lg.blowout_week', { gap: (w) => w[0] - w[w.length - 1], better: (a, b) => a > b });

export const LG_CHAOS_WEEK = register({
  id: 'lg.chaos_week', v: 1, family: 'league', reveal: FW, level: 'league', minKey: 'leagueWeeks',
  run(slice) {
    const def = LG_CHAOS_WEEK;
    const min = minOf('leagueWeeks');
    if (slice.units.length < min) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: slice.units.length, min });
    if (slice.memberIds.length < minOf('chaosEntrants')) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: slice.memberIds.length, min: minOf('chaosEntrants') });
    const gs = gameSplits(slice);
    const rows = [];
    for (const u of slice.units) {
      const shares = Array.from(gs.values()).filter((s) => u.weekIds.includes(s.game.weekId)).map((s) => Math.max(s.home, s.away) / s.n);
      if (shares.length) rows.push({ unit: u, mean: Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 1e6) / 1e6, games: shares.length });
    }
    if (rows.length < min) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: rows.length, min });
    const best = rows.reduce((b, r) => (r.mean < b.mean ? r : b), rows[0]);
    if (rows.some((r) => r !== best && r.mean === best.mean)) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'tie', n: rows.length, min });
    return makeMetric({ def, slice, subject: leagueSubject(slice), n: rows.length, value: { ...ref(best.unit), meanMajorityShare: best.mean, games: best.games }, supportRows: [] });
  },
});

export const LG_TEAM_TRUST_FADE = register({
  id: 'lg.team_trust_fade', v: 1, family: 'league', reveal: FW, level: 'league', minKey: 'leagueTrustPicks',
  run(slice) {
    const def = LG_TEAM_TRUST_FADE;
    const min = minOf('leagueTrustPicks');
    const backed = new Map(), faded = new Map(), names = new Map();
    for (const p of graded(slice.picks)) {
      if (p.opponentKey === null) continue;
      backed.set(p.teamKey, (backed.get(p.teamKey) || 0) + 1);
      faded.set(p.opponentKey, (faded.get(p.opponentKey) || 0) + 1);
    }
    for (const g of slice.games) { names.set(g.homeKey, g.home); names.set(g.awayKey, g.away); }
    const top = (m) => {
      const rows = Array.from(m.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
      if (!rows.length || rows[0][1] < min) return null;
      if (rows.length > 1 && rows[1][1] === rows[0][1]) return null;                       // a tie claims nothing
      return { team: names.get(rows[0][0]) || rows[0][0], n: rows[0][1] };
    };
    const b = top(backed), f = top(faded);
    if (!b && !f) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: 0, min });
    return makeMetric({ def, slice, subject: leagueSubject(slice), n: slice.picks.length, value: { backed: b, faded: f }, supportRows: [] });
  },
});

export const LG_COLLECTIVE_WEEK = register({
  id: 'lg.collective_week', v: 1, family: 'league', reveal: FW, level: 'league', minKey: 'leagueWeeks',
  run(slice) {
    const def = LG_COLLECTIVE_WEEK;
    const min = minOf('leagueWeeks');
    if (slice.units.length < min) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: slice.units.length, min });
    const rows = weekTable(slice).filter((r) => r.graded > 0);
    if (rows.length < min) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'thin', n: rows.length, min });
    // compare c1/g1 against c2/g2 by cross-multiplication (no float); a tie for the best (or the worst) claims nothing
    const better = (a, b) => a.correct * b.graded > b.correct * a.graded;
    const same = (a, b) => a.correct * b.graded === b.correct * a.graded;
    let best = rows[0], worst = rows[0];
    for (const r of rows) { if (better(r, best)) best = r; if (better(worst, r)) worst = r; }
    if (rows.some((r) => r !== best && same(r, best)) || rows.some((r) => r !== worst && same(r, worst))) return unavailable({ def, slice, subject: leagueSubject(slice), reason: 'tie', n: rows.length, min });
    const pack = (r) => ({ ...ref(r.unit), rate: ratio(r.correct, r.graded), correct: r.correct, graded: r.graded });
    return makeMetric({ def, slice, subject: leagueSubject(slice), n: rows.length, value: { best: pack(best), worst: pack(worst) }, supportRows: [] });
  },
});
