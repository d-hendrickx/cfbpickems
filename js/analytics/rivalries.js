/**
 * CFB Pickems - js/analytics/rivalries.js (D2 lane 4; DI-960; 2026-10-19)
 * ========================================================================
 * EXPLICIT GAP, BUILT DARK. The rivalry list is DATA, not code logic. `approvedBy === null` makes the engine treat the
 * list as EMPTY: no `sit.rivalry` output, no Rivalry Expert, no rivalry decoration anywhere. Setting the two fields is
 * the only act that switches the family on, and it is made in a commit that cites Drew's words (Q-D1, M-71).
 *
 * The pairs below are Appendix A of docs/DESIGN_INPUTS_D2_D.md, the PROPOSED starting list ("is commonly called a
 * rivalry", pairs only, no trophy names, no claims). Nothing is built on it until Drew trims and approves it.
 *
 * Matching: an unordered pair of `normTeam` keys, both teams present on the game, same sport. The flag is computed in
 * records.js and stored nowhere. Platform-level (identical for every league), versioned, NOT commissioner-editable in D2.
 */
import { normTeam } from '../team-match.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

export const RIVALRY_LIST = deepFreeze({
  v: 1,
  approvedBy: null,
  approvedAt: null,
  sports: {
    cfb: [
      ['Alabama', 'Auburn'], ['Alabama', 'LSU'], ['Alabama', 'Tennessee'], ['Auburn', 'Georgia'], ['Georgia', 'Florida'],
      ['Georgia', 'Georgia Tech'], ['Florida', 'Florida State'], ['Clemson', 'South Carolina'], ['Miami', 'Florida State'],
      ['Ohio State', 'Michigan'], ['Michigan', 'Michigan State'], ['Penn State', 'Ohio State'], ['Wisconsin', 'Minnesota'],
      ['Iowa', 'Iowa State'], ['Purdue', 'Indiana'], ['Texas', 'Oklahoma'], ['Texas', 'Texas A&M'], ['Arkansas', 'Texas A&M'],
      ['Arkansas', 'LSU'], ['Oklahoma', 'Oklahoma State'], ['Ole Miss', 'Mississippi State'], ['USC', 'UCLA'],
      ['USC', 'Notre Dame'], ['Oregon', 'Oregon State'], ['Washington', 'Washington State'], ['Stanford', 'California'],
      ['Army', 'Navy'], ['Pittsburgh', 'West Virginia'],
    ],
    nfl: [
      ['Green Bay Packers', 'Chicago Bears'], ['Dallas Cowboys', 'Philadelphia Eagles'], ['Dallas Cowboys', 'Washington Commanders'],
      ['New York Giants', 'Philadelphia Eagles'], ['Pittsburgh Steelers', 'Baltimore Ravens'], ['Pittsburgh Steelers', 'Cleveland Browns'],
      ['San Francisco 49ers', 'Seattle Seahawks'], ['Kansas City Chiefs', 'Las Vegas Raiders'], ['New England Patriots', 'New York Jets'],
      ['Buffalo Bills', 'Miami Dolphins'],
    ],
  },
});

/** Is the family switched on? Only an approver and a date switch it on (DI-960). */
export function rivalryApproved(list = RIVALRY_LIST) {
  return !!list && typeof list.approvedBy === 'string' && list.approvedBy.length > 0 && typeof list.approvedAt === 'string' && list.approvedAt.length > 0;
}

const _cache = new WeakMap();
function pairSet(list) {
  let s = _cache.get(list);
  if (!s) {
    s = new Map();
    for (const sport of Object.keys(list.sports || {})) {
      const set = new Set();
      for (const [a, b] of list.sports[sport]) { const ka = normTeam(a), kb = normTeam(b); set.add(ka < kb ? ka + '|' + kb : kb + '|' + ka); }
      s.set(sport, set);
    }
    _cache.set(list, s);
  }
  return s;
}

/**
 * Is this game a listed rivalry? `sport` is the competition's sport code ('cfb' | 'nfl' | ...). With `approvedBy === null`
 * (the D2 ship state) this is ALWAYS false: the list is treated as empty. `list` is a parameter only so a test can pass an
 * approved fixture list; production callers never pass it.
 */
export function isRivalry(sport, homeKey, awayKey, list = RIVALRY_LIST) {
  if (!rivalryApproved(list)) return false;
  const set = pairSet(list).get(sport);
  if (!set || !homeKey || !awayKey) return false;
  return set.has(homeKey < awayKey ? homeKey + '|' + awayKey : awayKey + '|' + homeKey);
}
