/**
 * CFB Pickems - js/analytics/m-labels.js (D2 lane 4; DI-984 "The label catalogue"; UN/PF-525; 2026-10-19)
 * ========================================================================================================
 * Playful, EVIDENCE-BACKED, time-bounded names. Names are Drew's exactly (Q-D7); no other identity exists in D2.
 *
 * WINDOW: a member's last 6 final weeks of the competition (4 if fewer exist; NONE if fewer than 4). All rates use final-week picks.
 * One holder per label per competition: the STRICTLY highest value among members who clear the threshold (a tie awards nothing).
 * HYSTERESIS: entering and leaving thresholds differ. The engine REPLAYS the weeks in order applying enter / leave rules, so a label
 * is a pure function of history and nothing is stored. There is no permanent badge and no label history.
 *
 * A label is a playful name for a computed pattern, never a claim about the person (copy.js and its lint own the words). RPF-D3:
 * a member's `showLabels === false` hides their labels from everyone else (index.js `labelsFor`); the value still computes so the
 * member's own Your numbers can show it with "Hidden from the league". Rivalry Expert is absent until the rivalry list is approved.
 */
import { register, makeMetric, unavailable, REVEAL } from './registry.js';
import { graded, wins, roleEligible, supportOfPicks } from './slice.js';
import { memberGames } from './m-consensus.js';
import { rankSeries } from './m-performance.js';

const FW = REVEAL.FINAL_WEEK;
const WINDOW_MAX = 6, WINDOW_MIN = 4;

/** thresholds as integer fractions so no float decides a label: rate >= n/d */
const pct = (n) => ({ n, d: 100 });
const ge = (x, t) => x.num * t.d >= t.n * x.den;
const NONE = { num: 0, den: 1, ok: false, ev: {}, picks: [] };

function windowPicks(slice, memberId, units) {
  const ids = new Set(units.flatMap((u) => u.weekIds));
  return (slice.picksByMember.get(memberId) || []).filter((p) => ids.has(p.weekId));
}
const decidedInWindow = (slice, id, units) => {
  const ids = new Set(units.flatMap((u) => u.weekIds));
  return memberGames(slice, id).filter((r) => r.with !== null && ids.has(r.p.weekId));
};

/** the label rules; `measure` returns { num, den, ok, ev, picks } for one member over one window of units */
const RULES = Object.freeze([
  { key: 'chalk_merchant', name: 'Chalk Merchant', enter: pct(70), leave: pct(65),
    measure(slice, id, units) { const el = roleEligible(windowPicks(slice, id, units)); const f = el.filter((p) => p.pickedFavorite === true); return { num: f.length, den: el.length, ok: el.length >= 20, ev: { onFavorite: f.length, picks: el.length }, picks: el }; } },
  { key: 'underdog_whisperer', name: 'Underdog Whisperer', enter: pct(60), leave: pct(55),
    measure(slice, id, units) { const d = graded(windowPicks(slice, id, units)).filter((p) => p.pickedFavorite === false); return { num: wins(d), den: d.length, ok: d.length >= 10, ev: { won: wins(d), underdogPicks: d.length }, picks: d }; } },
  { key: 'chaos_agent', name: 'Chaos Agent', enter: pct(35), leave: pct(30),
    measure(slice, id, units) { const rows = decidedInWindow(slice, id, units); const a = rows.filter((r) => !r.with); return { num: a.length, den: rows.length, ok: rows.length >= 20, ev: { against: a.length, games: rows.length }, picks: rows.map((r) => r.p) }; } },
  { key: 'captain_consensus', name: 'Captain Consensus', enter: pct(80), leave: pct(75),
    measure(slice, id, units) { const rows = decidedInWindow(slice, id, units); const w = rows.filter((r) => r.with); return { num: w.length, den: rows.length, ok: rows.length >= 20, ev: { withMajority: w.length, games: rows.length }, picks: rows.map((r) => r.p) }; } },
  { key: 'certified_hater', name: 'Certified Hater', enter: { n: 4, d: 1 }, leave: { n: 3, d: 1 },
    measure(slice, id, units) {
      const g = graded(windowPicks(slice, id, units));
      const faded = new Map(), seen = new Map();
      for (const p of g) { if (p.opponentKey === null) continue; faded.set(p.opponentKey, (faded.get(p.opponentKey) || 0) + 1); for (const k of [p.teamKey, p.opponentKey]) seen.set(k, (seen.get(k) || 0) + 1); }
      const rows = Array.from(faded.entries()).sort((a, b) => (b[1] - a[1]) || ((seen.get(b[0]) || 0) - (seen.get(a[0]) || 0)) || (a[0] < b[0] ? -1 : 1));
      if (!rows.length) return NONE;
      const [key, count] = rows[0];
      let name = key;
      for (const x of slice.games) { if (x.homeKey === key) { name = x.home; break; } if (x.awayKey === key) { name = x.away; break; } }
      return { num: count, den: 1, ok: (seen.get(key) || 0) >= 4, ev: { team: name, faded: count, appearances: seen.get(key) || 0 }, picks: g.filter((p) => p.opponentKey === key) };
    } },
  { key: 'comeback_king', name: 'Comeback King', enter: { n: 3, d: 1 }, leave: { n: 2, d: 1 },
    measure(slice, id, units, ctx) {
      if (units.length < WINDOW_MAX || slice.memberIds.length < 5) return NONE;
      const ranks = units.map((u) => ctx.rankAfter.get(u.key)?.get(id)).filter((r) => r !== undefined);
      if (ranks.length !== units.length) return NONE;
      const worst = Math.max(...ranks), cur = ranks[ranks.length - 1];
      return { num: Math.max(0, worst - cur), den: 1, ok: true, ev: { from: worst, to: cur, places: Math.max(0, worst - cur) }, picks: [] };
    } },
  { key: 'bad_beat_magnet', name: 'Bad Beat Magnet', enter: { n: 3, d: 1 }, leave: { n: 2, d: 1 },
    measure(slice, id, units) {
      if (units.length < WINDOW_MAX) return NONE;
      const near = windowPicks(slice, id, units).filter((p) => p.result === 'loss' && p.coverMargin !== null && p.coverMargin <= 1);
      return { num: near.length, den: 1, ok: true, ev: { nearMisses: near.length }, picks: near };
    } },
  { key: 'rivalry_expert', name: 'Rivalry Expert', enter: pct(65), leave: pct(60), needsRivalry: true,
    measure(slice, id, units) { const r = graded(windowPicks(slice, id, units)).filter((p) => slice.gameById.get(p.gameId)?.rivalry === true); return { num: wins(r), den: r.length, ok: r.length >= 5, ev: { won: wins(r), rivalryPicks: r.length }, picks: r }; } },
]);
export const LABEL_NAMES = Object.freeze(RULES.map((r) => r.name));
export const LABEL_KEYS = Object.freeze(RULES.map((r) => r.key));

/** fraction compare: x/y against z/w, no float */
const cmp = (x, y) => x.num * y.den - y.num * x.den;

/** Replay a label over the final weeks. Returns { holder, heldSince, previous, window, measure } at the last step, or { holder: null, reason }. */
export function replayLabel(slice, rule) {
  const units = slice.units;
  if (units.length < WINDOW_MIN) return { holder: null, reason: 'thin', n: units.length };
  const ctx = { rankAfter: new Map(rankSeries(slice).map((s) => [s.unit.key, s.ranks])) };
  let holder = null, heldSince = null, previous = null, last = null, tie = false;
  const history = [];
  for (let k = WINDOW_MIN; k <= units.length; k++) {
    const win = units.slice(Math.max(0, k - WINDOW_MAX), k);
    const rows = slice.memberIds.map((id) => ({ id, m: rule.measure(slice, id, win, ctx) }));
    const bar = (id) => (id === holder ? rule.leave : rule.enter);
    const eligible = rows.filter((r) => r.m.ok && r.m.den > 0 && ge(r.m, bar(r.id)));
    let next = null; tie = false;
    if (eligible.length) {
      const sorted = [...eligible].sort((a, b) => cmp(b.m, a.m) || (a.id < b.id ? -1 : 1));
      if (sorted.length > 1 && cmp(sorted[0].m, sorted[1].m) === 0) tie = true; else next = sorted[0];
    }
    const nextId = next ? next.id : null;
    if (nextId !== holder) { previous = holder; heldSince = nextId === null ? null : units[k - 1].weekNumber; }
    holder = nextId;
    history.push({ weekNumber: units[k - 1].weekNumber, holder });
    last = { win, next };
  }
  if (!holder) return { holder: null, reason: tie ? 'tie' : 'thin', n: units.length, history };
  return { holder, heldSince, previous, window: last.win, measure: last.next.m, history };
}

function labelMetric(rule) {
  const def = register({
    id: 'lbl.' + rule.key, v: 1, family: 'label', reveal: FW, level: 'league', minKey: 'labelWindowMin', dark: rule.needsRivalry === true,
    run(slice) {
      const subject = { kind: 'league', id: slice.leagueId };
      if (rule.needsRivalry && !slice.input.rivalryOn) return unavailable({ def, slice, subject, reason: 'dark', n: 0, min: WINDOW_MIN });
      const r = replayLabel(slice, rule);
      if (!r.holder) return unavailable({ def, slice, subject, reason: r.reason, n: r.n || 0, min: WINDOW_MIN });
      const member = slice.input.members.find((m) => m.id === r.holder);
      return makeMetric({
        def, slice, subject: { kind: 'member', id: r.holder }, n: r.window.length, num: r.measure.num, den: r.measure.den,
        value: { label: rule.name, key: rule.key, holderId: r.holder, evidence: r.measure.ev, window: { weeks: r.window.map((u) => u.weekNumber), fromWeek: r.window[0].weekNumber, throughWeek: r.window[r.window.length - 1].weekNumber }, heldSince: r.heldSince, previousHolder: r.previous, hidden: !(member && member.showLabels) },
        supportRows: supportOfPicks(r.measure.picks || []),
        window: { kind: 'last-n-weeks', n: r.window.length, fromWeek: r.window[0].weekNumber, throughWeek: r.window[r.window.length - 1].weekNumber },
      });
    },
  });
  return def;
}
export const LABEL_DEFS = Object.freeze(RULES.map(labelMetric));
