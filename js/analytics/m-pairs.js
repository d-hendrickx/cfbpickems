/**
 * CFB Pickems - js/analytics/m-pairs.js (D2 lane 4; DI-956 "Player to player"; UN/PF-519, 520; 2026-10-19)
 * =========================================================================================================
 * How two members' picks compare. Reveal class: final-week. "Recurring rivalries" (the PF's words) means these member-against-
 * member patterns; TEAM rivalries are the dark gap in rivalries.js.
 *
 * `pair.agreement` WRAPS `headToHeadRecord` (js/stats.js), the function Compare uses: never reimplemented, so the Compare screen
 * and an insight cannot disagree. Two members who never share a graded game get NO pair value (not a zero).
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL } from './registry.js';
import { viewOf } from './input.js';
import { headToHeadRecord } from '../stats.js';

const FW = REVEAL.FINAL_WEEK;
const memo = new WeakMap();

/** headToHeadRecord for (a, b) over this slice's final weeks. isPublic is "this week is in the slice": the reveal decision was made by buildInput. */
export function h2h(slice, a, b) {
  let m = memo.get(slice);
  if (!m) { m = new Map(); memo.set(slice, m); }
  const key = a < b ? a + '|' + b : b + '|' + a;
  const flip = a > b;
  if (!m.has(key)) {
    const [x, y] = flip ? [b, a] : [a, b];
    const view = viewOf(slice.input);
    const ids = new Set(slice.finals.map((w) => w.weekId));
    // only the two members' picks are handed in: headToHeadRecord scans the pick list per game, so the smaller list is the same answer, much faster
    m.set(key, headToHeadRecord(x, y, {
      weeks: view.rawWeeks.filter((w) => ids.has(String(w.weekId))),
      games: view.rawGames.filter((g) => ids.has(String(g.weekId))),
      picks: view.rawPicks.filter((p) => ids.has(String(p.weekId)) && (p.playerId === x || p.playerId === y)),
      isPublic: (w) => ids.has(String(w.weekId)),
    }));
  }
  const r = m.get(key);
  if (!flip) return r;
  // swap sides so callers always read (a, b) as asked
  return { ...r, playerA: a, playerB: b, aRightBWrong: r.bRightAWrong, bRightAWrong: r.aRightBWrong, splits: r.splits.map((s) => ({ ...s, aTeam: s.bTeam, bTeam: s.aTeam, aResult: s.bResult, bResult: s.aResult })) };
}

export const pairsOf = (slice) => {
  const out = [];
  const ids = [...slice.memberIds].sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push({ a: ids[i], b: ids[j] });
  return out;
};

const entrantGate = (slice, def, subject) => (slice.memberIds.length < minOf('consEntrants') ? unavailable({ def, slice, subject, reason: 'thin', n: slice.memberIds.length, min: minOf('consEntrants') }) : null);
/** a pair is one unordered thing: the lower id is always `a`, so the numbers read the same whichever order was asked */
const canonical = (a, b) => (a < b ? [a, b] : [b, a]);
const pairSubject = (a, b) => ({ kind: 'pair', id: a < b ? a : b, id2: a < b ? b : a });
const splitSupport = (h) => h.splits.map((s) => ({ gameId: s.gameId, weekId: s.weekId }));

export const PAIR_AGREEMENT = register({
  id: 'pair.agreement', v: 1, family: 'pairs', reveal: FW, level: 'pair', minKey: 'agreementGames', enumerate: pairsOf,
  run(slice, { a, b }) {
    const def = PAIR_AGREEMENT;
    [a, b] = canonical(a, b);
    const subject = pairSubject(a, b);
    const gate = entrantGate(slice, def, subject); if (gate) return gate;
    const h = h2h(slice, a, b);
    const min = minOf('agreementGames');
    if (h.gamesCompared < min) return unavailable({ def, slice, subject, reason: 'thin', n: h.gamesCompared, min });
    return makeMetric({ def, slice, subject, n: h.gamesCompared, num: h.agreed, den: h.gamesCompared, value: { agreed: h.agreed, compared: h.gamesCompared, rate: ratio(h.agreed, h.gamesCompared) }, supportRows: splitSupport(h) });
  },
});

export const PAIR_DISAGREEMENT = register({
  id: 'pair.disagreement_record', v: 1, family: 'pairs', reveal: FW, level: 'pair', minKey: 'disagreements', enumerate: pairsOf,
  run(slice, { a, b }) {
    const def = PAIR_DISAGREEMENT;
    [a, b] = canonical(a, b);
    const subject = pairSubject(a, b);
    const gate = entrantGate(slice, def, subject); if (gate) return gate;
    const h = h2h(slice, a, b);
    const n = h.splits.length;
    const min = minOf('disagreements');
    // below the minimum the record is STATED in a detail but never ranked or carded: reason `thin` plus the plain numbers
    if (n < min) return unavailable({ def, slice, subject, reason: 'thin', n, min, detail: n > 0 ? { aRight: h.aRightBWrong, bRight: h.bRightAWrong } : null });
    return makeMetric({ def, slice, subject, n, value: { aRight: h.aRightBWrong, bRight: h.bRightAWrong, disagreements: n }, supportRows: splitSupport(h) });
  },
});

/** Cross-multiplied comparison of two agreement fractions (no float). */
const fracCmp = (x, y) => x.agreed * y.n - y.agreed * x.n;

export const PAIR_SIMILAR_OPPOSITE = register({
  id: 'pair.similar_opposite', v: 1, family: 'pairs', reveal: FW, level: 'member', minKey: 'similarOthers',
  run(slice, { memberId }) {
    const def = PAIR_SIMILAR_OPPOSITE;
    const subject = { kind: 'member', id: memberId };
    const gate = entrantGate(slice, def, subject); if (gate) return gate;
    const rows = [];
    for (const other of slice.memberIds) {
      if (other === memberId) continue;
      const h = h2h(slice, memberId, other);
      if (h.gamesCompared >= minOf('agreementGames')) rows.push({ id: other, agreed: h.agreed, n: h.gamesCompared });
    }
    const min = minOf('similarOthers');
    if (rows.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: rows.length, min });
    const hi = [...rows].sort((x, y) => fracCmp(y, x) || (x.id < y.id ? -1 : 1));
    const lo = [...rows].sort((x, y) => fracCmp(x, y) || (x.id < y.id ? -1 : 1));
    // a strict maximum / minimum or no claim at all (a tie claims nothing)
    const similar = fracCmp(hi[0], hi[1]) > 0 ? hi[0] : null;
    const opposite = fracCmp(lo[1], lo[0]) > 0 ? lo[0] : null;
    if (!similar && !opposite) return unavailable({ def, slice, subject, reason: 'tie', n: rows.length, min });
    const pack = (r) => (r ? { memberId: r.id, agreed: r.agreed, compared: r.n, rate: ratio(r.agreed, r.n) } : null);
    return makeMetric({ def, slice, subject, n: rows.length, value: { similar: pack(similar), opposite: pack(opposite) }, supportRows: [] });
  },
});

/** Weekly raw wins per unit for a member (a split week group is one unit). */
export function weeklyWinsByUnit(slice, memberId) {
  return slice.units.map((u) => {
    const rs = slice.input.standingsRows.filter((r) => r.playerId === memberId && u.weekIds.includes(r.weekId));
    const entered = u.weekIds.every((id) => (slice.weekEntrants.get(id) || new Set()).has(memberId));
    return { unit: u, entered, wins: rs.reduce((s, r) => s + (r.correctCount ?? r.correctPicks), 0) };
  });
}

export const PAIR_WEEKLY_H2H = register({
  id: 'pair.weekly_h2h', v: 1, family: 'pairs', reveal: FW, level: 'pair', minKey: 'weeklyH2hWeeks', enumerate: pairsOf,
  run(slice, { a, b }) {
    const def = PAIR_WEEKLY_H2H;
    [a, b] = canonical(a, b);
    const subject = pairSubject(a, b);
    const gate = entrantGate(slice, def, subject); if (gate) return gate;
    const wa = weeklyWinsByUnit(slice, a), wb = weeklyWinsByUnit(slice, b);
    const decided = [];
    for (let i = 0; i < wa.length; i++) {
      if (!wa[i].entered || !wb[i].entered || wa[i].wins === wb[i].wins) continue;       // a tie is skipped
      decided.push({ unit: wa[i].unit, aAbove: wa[i].wins > wb[i].wins });
    }
    const min = minOf('weeklyH2hWeeks');
    if (decided.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: decided.length, min });
    const aAbove = decided.filter((d) => d.aAbove).length;
    const holder = decided[decided.length - 1].aAbove;
    let run = 0;
    for (let i = decided.length - 1; i >= 0 && decided[i].aAbove === holder; i--) run++;
    return makeMetric({ def, slice, subject, n: decided.length, num: aAbove, den: decided.length, value: { aAbove, bAbove: decided.length - aAbove, run: { holder: holder ? 'a' : 'b', n: run } }, supportRows: [] });
  },
});

export const PAIR_SPLIT_TEAM = register({
  id: 'pair.split_team', v: 1, family: 'pairs', reveal: FW, level: 'pair', minKey: 'splitTeam', enumerate: pairsOf,
  run(slice, { a, b }) {
    const def = PAIR_SPLIT_TEAM;
    [a, b] = canonical(a, b);
    const subject = pairSubject(a, b);
    const gate = entrantGate(slice, def, subject); if (gate) return gate;
    const h = h2h(slice, a, b);
    const byTeam = new Map();
    for (const s of h.splits) {
      const g = slice.gameById.get(s.gameId);
      if (!g) continue;
      for (const [key, name] of [[g.homeKey, g.home], [g.awayKey, g.away]]) {
        if (!byTeam.has(key)) byTeam.set(key, { team: name, n: 0, aRight: 0, bRight: 0, rivalry: g.rivalry === true, rows: [] });
        const t = byTeam.get(key);
        t.n++; if (s.aResult === 'win') t.aRight++; else if (s.bResult === 'win') t.bRight++;
        t.rows.push({ gameId: s.gameId, weekId: s.weekId, k: g.kickoffMs });
      }
    }
    const min = minOf('splitTeam');
    const teams = Array.from(byTeam.entries()).filter(([, t]) => t.n >= min).sort((x, y) => (y[1].n - x[1].n) || (x[0] < y[0] ? -1 : 1));
    if (!teams.length) return unavailable({ def, slice, subject, reason: 'thin', n: h.splits.length, min });
    return makeMetric({ def, slice, subject, n: h.splits.length, value: { teams: teams.map(([, t]) => ({ team: t.team, n: t.n, aRight: t.aRight, bRight: t.bRight, rivalry: t.rivalry })) }, supportRows: teams.flatMap(([, t]) => t.rows) });
  },
});
