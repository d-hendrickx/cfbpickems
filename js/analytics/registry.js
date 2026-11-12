/**
 * CFB Pickems - js/analytics/registry.js (D2 lane 4, SCRIBE Analytics v1; DI-941, 944, 946, 949; 2026-10-19)
 * ===========================================================================================================
 * The metric object, the minimum-sample table and the registry every metric family writes into.
 *
 * PURE. No storage seam, no DOM, no network, no clock, no randomness. Imports NOTHING (the P-11 allow-list in
 * analyticsstatictest pins that). The same file is imported by the Edge Functions through
 * `supabase/functions/_shared/analytics-bridge.mjs`; it is never copied.
 *
 *   makeMetric(...)       the one constructor of a metric object (DI-944): frozen, JSON-safe, finite, never prose.
 *   unavailable(...)      "null with a reason" (DI-946): a metric below its minimum returns this, never a rounded-up number.
 *   MINIMUMS / minOf()    the one table of minimum samples. `withMinimums()` lowers them for a unit test ONLY; a static
 *                         scan (analyticsstatictest) pins that nothing but a test file calls it.
 *   register() / REGISTRY every metric registers its id, family, version, reveal class and minimum here; the catalogue
 *                         runner (index.js) walks this table, so a metric nobody registered does not exist.
 */

export const ENGINE_VERSION = 1;

/** The two reveal classes that exist (DI-942). There is no class for "own", "commissioner" or "unrevealed". */
export const REVEAL = Object.freeze({ FINAL_WEEK: 'final-week', PUBLIC_GAME: 'public-game' });

/** Minimum eligible samples (DI-946), one row per metric group. A metric below its minimum is `unavailable`, never zero. */
const BASE_MINIMUMS = Object.freeze({
  teamSide: 3,            // a team-specific record (backed or faded)
  teamLoyalty: 4,         // appearances of one team
  rate: 12,               // rates: favourite, home, consensus
  bucket: 6,              // inside a bucket
  bigGameBucket: 5,
  perfWeeks: 3,           // best/worst, rank path, streaks (graded picks)
  riseFallWeeks: 4,
  volatilityWeeks: 5,
  rankEntrants: 3,        // any rank statement
  consEntrants: 3,        // consensus and pair metrics
  unanimousEntrants: 4,   // unanimous, whole-league miss, polarizing, lone-wolf
  consGames: 12,
  withAgainst: 5,         // compare with/against the majority only when each side has this many
  agreementGames: 15,     // pair agreement
  disagreements: 6,       // pair disagreement record
  weeklyH2hWeeks: 4,
  similarOthers: 3,
  splitTeam: 3,
  behWeeks: 3,            // qualifying weeks on each side
  behPicks: 8,            // role-eligible picks pooled per side
  behWeekGraded: 5,       // graded picks for a week to count as over/under .500
  burns: 5,
  trustRun: 3,
  strategyGames: 12,      // same-set games
  strategyTeam: 4,
  cumulativeWeeks: 3,
  perfectCardGraded: 5,
  followOthers: 3,
  copyShared: 15,
  leagueTrustPicks: 8,
  leagueWeeks: 3,
  chaosEntrants: 4,
  lgAccuracyGames: 15,
  almaGames: 3,
  sportPicks: 20,
  priorWeeksLo: 3,
  priorWeeksHi: 14,
  priorEntrants: 3,
  pickEventPicks: 12,     // pick history (dark until pick_events holds data)
  pickEventChanges: 3,
  moneyPrices: 8,         // dollar results (dark)
  labelWindowMin: 4,
  labelWindowMax: 6,
  teamRecord: 3,          // a followed team's season record (games), form, margins and its coach line
  teamScoring: 4,         // points for and against per game
  teamRanked: 3,          // games against ranked opponents (college football)
  teamAts: 4,             // a team's graded games on THIS league's slates
});

let _active = BASE_MINIMUMS;
let _activeKey = 'base';
let _seq = 0;
/** a token naming the minimums in force, so a memo never serves a result computed under other minimums (a lowered table exists only in a test) */
export function minimumsKey() { return _activeKey + (_flagKey ? '+' + _flagKey : ''); }

export function minOf(key) {
  const v = _active[key];
  if (!Number.isFinite(v)) throw new Error('analytics: unknown minimum ' + String(key));
  return v;
}

/** The whole table as it stands (the analyticstest boundary group reads it; a frozen copy). */
export function minimums() { return _active; }
export const BASE_MIN = BASE_MINIMUMS;

/**
 * UNIT-TEST ONLY: run `fn` with some minimums lowered, then restore. analyticsstatictest pins that no file under js/ or
 * supabase/ calls this (the only call sites are `*test.mjs` files); the production table is `BASE_MINIMUMS` and cannot
 * be changed by anything else.
 */
export function withMinimums(overrides, fn) {
  const prev = _active, prevKey = _activeKey;
  _active = Object.freeze({ ...BASE_MINIMUMS, ...overrides });
  _activeKey = 'low' + (++_seq);
  try { return fn(); } finally { _active = prev; _activeKey = prevKey; }
}

/** n below the minimum: no number. n below twice the minimum: the sentence carries "so far" (DI-946). */
export function isThin(n, min) { return n < 2 * min; }


// ---- named switches for the explicit gaps (DI-960, 961, 981) --------------------------------------------------------
// The SHIP STATE of every switch is false, written as a literal in the file that owns it (m-strategies.js MONEY_OUTPUTS_ENABLED,
// m-behavior.js PICK_EVENTS_ENABLED, rivalries.js approvedBy). `withFlags` lets a TEST force one on to prove the family works once
// its data exist; analyticsstatictest pins that nothing but a *test.mjs file calls it, and analyticstest proves each stays dark by default.
let _flagOverride = {};
let _flagKey = '';
export function flagOverride(name) { return _flagOverride[name] === true; }
export function withFlags(overrides, fn) {
  const prev = _flagOverride, prevKey = _flagKey;
  _flagOverride = { ...prev, ...overrides };
  _flagKey = 'flags' + (++_seq);
  try { return fn(); } finally { _flagOverride = prev; _flagKey = prevKey; }
}

// ---- the metric object -------------------------------------------------------------------------------------------

export const SUPPORT_CAP = 24;
export const METRIC_BYTE_CAP = 4096;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** Throws on NaN, Infinity, undefined, functions, or a non-plain value anywhere in `v` (a metric is JSON-safe or it does not exist). */
function assertJsonSafe(v, path) {
  if (v === null) return;
  const t = typeof v;
  if (t === 'number') { if (!Number.isFinite(v)) throw new Error('analytics: non-finite number at ' + path); return; }
  if (t === 'string' || t === 'boolean') return;
  if (Array.isArray(v)) { v.forEach((x, i) => assertJsonSafe(x, path + '[' + i + ']')); return; }
  if (t === 'object') { for (const k of Object.keys(v)) assertJsonSafe(v[k], path + '.' + k); return; }
  throw new Error('analytics: not JSON-safe at ' + path + ' (' + t + ')');
}

/** Rate rounded to four places (a deterministic, display-agnostic value; display rounding is copy.js's job). */
export function ratio(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 10000) / 10000;
}

const byKickoffThenId = (a, b) => ((a.k ?? 0) - (b.k ?? 0)) || (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0);

/** The supporting-record list of DI-944: ordered by kickoff, capped at 24, the true count kept in `supportTotal`. */
export function supportList(rows) {
  const sorted = [...rows].sort(byKickoffThenId);
  const seen = new Set();
  const out = [];
  for (const r of sorted) {
    const key = r.pickId ? 'p' + r.pickId : r.memberId ? 'm' + r.memberId + '|' + r.gameId : 'g' + r.gameId;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = { gameId: r.gameId, weekId: r.weekId };
    if (r.memberId) o.memberId = r.memberId;
    if (r.pickId) o.pickId = r.pickId;
    out.push(o);
  }
  return { support: out.slice(0, SUPPORT_CAP), supportTotal: out.length };
}

/**
 * Build one metric object (DI-944). `slice` supplies the scope; `def` is the registry entry; everything else is the
 * metric's own numbers. Returns a deep-frozen JSON-safe object.
 */
export function makeMetric({ def, slice, subject, n, num = null, den = null, value, comparison = null, supportRows = [], excluded = null, asOf = null, extra = null, window = null, level = 'pick', source = 'live' }) {
  const sp = supportList(supportRows);
  const ex = excluded || slice.excluded || { push: 0, noLine: 0, notEntrant: 0, other: 0 };
  const m = {
    id: def.id,
    v: def.v,
    family: def.family,
    subject,
    scope: {
      leagueId: slice.leagueId,
      sport: slice.sport,
      competitionId: slice.competitionId,
      format: slice.format,
      season: slice.season,
      window: window || { kind: 'season', throughWeek: slice.throughWeek },
      source,
      level,
    },
    n,
    num,
    den,
    value,
    ...(comparison ? { comparison } : {}),
    support: sp.support,
    supportTotal: sp.supportTotal,
    excluded: { push: ex.push || 0, noLine: ex.noLine || 0, notEntrant: ex.notEntrant || 0, other: ex.other || 0 },
    definition: 'metric-def:' + def.id + '@' + def.v,
    asOf: asOf || slice.asOf,
    freshness: { dataKey: slice.dataKey },
    ...(extra ? extra : {}),
  };
  assertJsonSafe(m, def.id);
  // size cap: trim support first, keep supportTotal (DI-944)
  let json = JSON.stringify(m);
  while (json.length > METRIC_BYTE_CAP && m.support.length > 0) {
    m.support = m.support.slice(0, Math.max(0, m.support.length - 4));
    json = JSON.stringify(m);
  }
  return deepFreeze(m);
}

/** "null with a reason" (DI-946). `value` is null, `reason` is one of a small closed vocabulary. */
export const REASONS = Object.freeze(['thin', 'tie', 'no_history', 'no_data', 'no_grader', 'dark', 'not_pilot', 'wrong_class', 'partial', 'private']);

export function unavailable({ def, slice, subject = null, reason, n = 0, min = null, detail = null }) {
  const m = {
    id: def.id,
    v: def.v,
    family: def.family,
    subject,
    scope: slice ? { leagueId: slice.leagueId, sport: slice.sport, competitionId: slice.competitionId, format: slice.format, season: slice.season } : null,
    value: null,
    reason,
    n,
    min,
    ...(detail ? { detail } : {}),
  };
  assertJsonSafe(m, def.id);
  return deepFreeze(m);
}

export const isAvailable = (m) => !!m && m.value !== null && m.value !== undefined;

// ---- the registry ------------------------------------------------------------------------------------------------

const _registry = new Map();

/**
 * Register a metric definition. `def`: { id, v, family, reveal: 'final-week'|'public-game', level: 'member'|'pair'|'league'|'game'|'team',
 * minKey, run(slice, params) }. Ids are unique; a duplicate throws at module load.
 */
export function register(def) {
  if (!def || typeof def.id !== 'string' || !def.id) throw new Error('analytics: a metric needs an id');
  if (_registry.has(def.id)) throw new Error('analytics: duplicate metric id ' + def.id);
  if (def.reveal !== REVEAL.FINAL_WEEK && def.reveal !== REVEAL.PUBLIC_GAME) throw new Error('analytics: ' + def.id + ' has no reveal class');
  if (!Number.isInteger(def.v) || def.v < 1) throw new Error('analytics: ' + def.id + ' has no version');
  _registry.set(def.id, Object.freeze({ ...def }));
  return def;
}

export function getDef(id) {
  const d = _registry.get(id);
  if (!d) throw new Error('analytics: unknown metric ' + String(id));
  return d;
}

export function allDefs() { return Array.from(_registry.values()); }
