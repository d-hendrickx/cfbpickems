/**
 * CFB Pickems — almatotaltest.mjs
 * ================================
 * Math proof + structural coverage for `calculateAlmaMaterTotal()`
 * (js/scoring.js) — the reviewer BLOCK on commit 8ae64f4, cleared here.
 *
 * Run:  node almatotaltest.mjs
 * Also: TZ=UTC node almatotaltest.mjs && TZ=America/Los_Angeles node almatotaltest.mjs
 *
 * THE REGRESSION
 * ---------------
 * `calculateAlmaMaterTotal(games, almaMaters, calcMode)` had two halves that
 * disagreed about which list to match against. The FILTER half called
 * `getAlmaMaterMatch(team)` with NO second argument — which silently falls
 * back to the hardcoded `ALMA_MATERS` catalog — while the SUMMING half used
 * a naive `almaMaters.some(am => team.toLowerCase().includes(am.toLowerCase()))`
 * against whatever list the CALLER actually passed. Harmless as long as the
 * caller's list equaled the catalog (true before commit 8ae64f4, whose sole
 * caller passed the literal catalog). The moment the roster became
 * commissioner-editable and diverged from the catalog (Purdue removed,
 * Clemson added), the two halves silently disagreed: reviewer's repro —
 * Clemson 31, Oklahoma 28 — returned 28 (Oklahoma alone, via the catalog-
 * matched summing branch) where the truth is 59 (see §5 below).
 *
 * DREW'S RULING (2026-09-04, verbatim), which changes the SEMANTICS, not
 * just the plumbing: "Make it so the auto calc will calculate only the
 * alma maters that are claimed, so each player gets one and if one is
 * listed then its added to the auto calc." So the real Auto-Calc caller
 * (app.js) passes `claimedAlmaMaters()` — distinct schools among ACTIVE
 * players' `almaMater`.
 *
 * MODEL CORRECTED FURTHER, SAME DAY (2026-09-04, verbatim, superseding the
 * "STATED ASSUMPTION" this section originally carried): "the roster of alma
 * maters (such as alma mater watch and those filtered in the slate builder)
 * should only be comprised of schools claimed as alma maters by a player."
 * The earlier build (8ae64f4) had ALSO shipped a SEPARATE, commissioner-
 * editable `activeAlmaMaters()` roster driving Watch/Rankings/⭐-flag/Tier 1,
 * with `claimedAlmaMaters()` feeding ONLY the Auto-Calc — this section's
 * original "stated assumption" (a claimed-but-off-roster school like Kevin's
 * old Purdue claim still counting) was framed against THAT two-list split.
 * Drew rejected the split outright: `claimedAlmaMaters()` is now the ONLY
 * roster, full stop, feeding every consumer including Watch/Rankings/
 * ⭐-flag/Tier 1. There is no second list for a claimed school to be
 * "off" of anymore — §3/§6/§7 below are reworded accordingly. `settings.
 * almaMaters` and `activeAlmaMaters()` no longer exist in the codebase.
 *
 * FIXTURE DISCIPLINE (same constraints as slatetest.mjs/tbdtest.mjs/ranktest.mjs)
 * --------------------------------------------------------------------------
 * 1. Fixtures are not constructed in the order they're asserted back out —
 *    ranktest.mjs was BLOCKED in this same review batch for exactly that.
 * 2. Every negative assertion is paired with a same-fixture positive check
 *    that the path actually produced something real (not vacuous).
 * 3. The mutation battery (§9) includes INVERSIONS as well as deletions,
 *    mutates COPIES under os.tmpdir() (never real source, never a
 *    hardcoded session-scratch path), and is preceded by a GREEN sanity
 *    check that the real, unmutated code trips none of the RED checks.
 * 4. §10's structural scans are each proven against synthetic MUST_CATCH /
 *    MUST_PASS fixtures BEFORE being run on the real file (the RG-10 scan
 *    shape in loadtest.mjs) — a negative assertion with no anchor is the
 *    false-coverage shape this same review batch found four times.
 *
 * SECTIONS
 *   1  Both calcMode values ('selectedSlateOnly' / 'allAlmaMaterGames')
 *   2  Precision matching through the real matcher — Miami / Miami (OH),
 *      Oklahoma / Oklahoma State, applied to the SUMMING half specifically
 *      (the half that used to be naive substring)
 *   3  List-membership semantics, at the pure-function level — a school
 *      absent from the passed list never counts, present always does. The
 *      pure function is agnostic to WHERE its list came from; these fixtures
 *      just prove it honors whatever list it's given, honestly
 *   4  null vs. 0 — no alma game at all; a FINAL game exists but matches
 *      nothing in the list (the exact shape that used to silently return 0)
 *   5  THE NAMED SCENARIO — Clemson 31 / Oklahoma 28 -> 59, proven against
 *      BOTH the real fixed code AND a preserved pre-fix reference
 *      implementation that reproduces 28
 *   6  claimedAlmaMaters() (app.js) — dedupe (shared school counts once),
 *      active-only filter, unclaimed schools absent entirely (there is no
 *      second "roster" for them to be excluded FROM anymore)
 *   7  Integration — the REAL #auto-calc-tb-btn click handler, driven end-
 *      to-end, uses claimedAlmaMaters() — the same one list every other
 *      alma-mater consumer in app.js now reads too
 *   8  recomputeAlmaMaterFlags() — skips LOCKED/LIVE/FINAL, touches
 *      DRAFT/OPEN (the reviewer's second finding, same review batch)
 *   9  Mutation battery — scoring.js, tmpdir copy, RED/GREEN + inversions
 *  10  Structural call-site scans — getAlmaMaterMatch() explicit 2nd arg
 *      (with a documented allowlist), fetchByDateRange() almaMaters:, and
 *      the suggestion-reason chip escHtml() guard — the three mutations
 *      reviewer found GREEN against the existing suites
 */

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ── DOM / localStorage stubs (slatetest.mjs/almatest.mjs shape) ────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
const selectorSets = new Map();
let lastToasts = [];

function makeEl(id) {
  const listeners = new Map();
  const e = {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild(child) { if (id === 'toast-container') lastToasts.push(child.innerHTML); },
    removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`almatotaltest: nothing bound to '${type}' on #${id}`);
      for (const fn of fns) fn({ target: e, ...ev });
    },
  };
  return e;
}
function el(id) { if (!registry.has(id)) registry.set(id, makeEl(id)); return registry.get(id); }
function bySelector(sel) {
  if (typeof sel === 'string' && sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const set = selectorSets.get(sel);
  return set && set.length ? set[0] : null;
}
function resetDom() { registry.clear(); selectorSets.clear(); lastToasts = []; }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__toast__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in almatotaltest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const scoring = await import('./js/scoring.js');
const dm = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');

const { calculateAlmaMaterTotal } = scoring;
const { GAME_STATUS, WEEK_STATUS, getAlmaMaterMatch, ALMA_MATER_EXCLUDE_PATTERNS } = dm;
const {
  getPlayers, addPlayer, getWeeks, saveWeek, getGames, saveAllGamesForWeek, getSettings,
} = storage;
const { claimedAlmaMaters, recomputeAlmaMaterFlags, bindCommEventListeners } = app;

assert(typeof app.activeAlmaMaters === 'undefined', 'fixture check: activeAlmaMaters() no longer exists as an app.js export — the two-list model is genuinely gone');

console.log('[almatotaltest] scoring.js exports —', Object.keys(scoring).length);
console.log('[almatotaltest] app.js exports —', Object.keys(app).length);
assert(typeof calculateAlmaMaterTotal === 'function', 'fixture check: calculateAlmaMaterTotal is exported from scoring.js');
assert(typeof claimedAlmaMaters === 'function', 'fixture check: claimedAlmaMaters is exported from app.js');

// ── Fixture helpers ─────────────────────────────────────────────────────────
let _gid = 0;
function G(o = {}) {
  _gid++;
  return {
    gameId: `at_g${_gid}`, weekId: 'at_w1',
    homeTeam: `Home${_gid}`, awayTeam: `Away${_gid}`, homeMascot: '', awayMascot: '',
    homeConference: '', awayConference: '', homeRank: null, awayRank: null,
    kickoff: '2026-09-08T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread: null, favorite: null, lockedSpread: null,
    homeScore: null, awayScore: null,
    status: GAME_STATUS.SCHEDULED, actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, nationalTV: false, broadcastNetwork: null, marqueeEvent: false,
    multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_historical', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: null,
    ...o,
  };
}
let _pid = 0;
function P(o = {}) {
  _pid++;
  return {
    playerId: `at_p${_pid}`, displayName: `Player${_pid}`, initials: `P${_pid}`,
    email: '', active: true, almaMater: '', pinHash: '', phone: '',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...o,
  };
}
/**
 * THE PRE-FIX REFERENCE IMPLEMENTATION, kept here verbatim (not imported, so
 * it can never silently track future changes to the real function — same
 * discipline as grouptest.mjs's calculateWeeklyResultsOld). This is the
 * EXACT shipped shape at commit 8ae64f4 / 1cd33ce: the filter half calls
 * getAlmaMaterMatch() with NO 2nd argument (silently defaults to the
 * hardcoded ALMA_MATERS catalog, ignoring whatever list the caller passed),
 * while the summing half does naive lowercase substring matching against
 * the caller's list. Used in §4 and §5 below to prove the fix matters —
 * comparing this against the real, fixed `calculateAlmaMaterTotal`.
 */
function calculateAlmaMaterTotalOld(games, almaMaters, calcMode = 'selectedSlateOnly') {
  const ag = games.filter(g => {
    const isAlma = !!(getAlmaMaterMatch(g.homeTeam) || getAlmaMaterMatch(g.awayTeam)); // NO 2nd arg — the bug
    return calcMode === 'selectedSlateOnly' ? g.isAlmaMaterGame && isAlma : isAlma;
  });
  if (!ag.length) return null;
  const fg = ag.filter(g => g.status === GAME_STATUS.FINAL && g.homeScore !== null);
  if (!fg.length) return null;
  let total = 0;
  for (const g of fg) {
    const hA = almaMaters.some(am => g.homeTeam.toLowerCase().includes(am.toLowerCase()));
    const aA = almaMaters.some(am => g.awayTeam.toLowerCase().includes(am.toLowerCase()));
    if (hA) total += g.homeScore || 0;
    if (aA) total += g.awayScore || 0;
  }
  return total;
}

function freshWeek(o = {}) {
  return {
    weekId: 'at_w1', weekNumber: 1, label: 'Week 1', season: 2026,
    status: WEEK_STATUS.OPEN, dataSourceMode: 'espn_historical',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    ...o,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Both calcMode values…');
{
  // Fixtures deliberately interleaved — the flagged/non-flagged/final/non-final
  // games are NOT in the order the assertions read them back out.
  const games = [
    G({ homeTeam: 'Wisconsin', awayTeam: 'Iowa', status: GAME_STATUS.FINAL, homeScore: 10, awayScore: 3, isAlmaMaterGame: false }), // no alma involvement at all
    G({ homeTeam: 'Oklahoma', awayTeam: 'Temple', status: GAME_STATUS.FINAL, homeScore: 45, awayScore: 6, isAlmaMaterGame: false }), // alma team, but NOT flagged on the slate
    G({ homeTeam: 'Missouri', awayTeam: 'Arkansas', status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 27, isAlmaMaterGame: true }), // alma team, flagged
  ];
  const list = ['Oklahoma', 'Arkansas'];

  const slateOnly = calculateAlmaMaterTotal(games, list, 'selectedSlateOnly');
  assert(slateOnly === 27, `'selectedSlateOnly' only counts the FLAGGED alma game (Arkansas 27) — got ${slateOnly}`);

  const allGames = calculateAlmaMaterTotal(games, list, 'allAlmaMaterGames');
  assert(allGames === 45 + 27, `'allAlmaMaterGames' counts EVERY final game touching the list regardless of the flag (Oklahoma 45 + Arkansas 27 = 72) — got ${allGames}`);

  // Default calcMode (3rd arg omitted) behaves as 'selectedSlateOnly'.
  const defaulted = calculateAlmaMaterTotal(games, list);
  assert(defaulted === slateOnly, `omitting calcMode defaults to 'selectedSlateOnly' — got ${defaulted}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Precision matching — Miami/Miami (OH), Oklahoma/Oklahoma State…');
{
  // The regression's OTHER half: before the fix, the SUMMING loop used naive
  // substring matching with no exclude patterns at all. Prove the real
  // matcher (getAlmaMaterMatch, via calculateAlmaMaterTotal) is now what's
  // used, by checking both the false-positive it used to cause AND that the
  // legitimate positive still works.
  assert(Array.isArray(ALMA_MATER_EXCLUDE_PATTERNS['Miami']) && ALMA_MATER_EXCLUDE_PATTERNS['Miami'].includes('Miami (OH)'),
    'fixture check: the Miami exclude-pattern entry this section depends on genuinely exists');

  const miamiGame = G({ homeTeam: 'Notre Dame', awayTeam: 'Miami (OH)', status: GAME_STATUS.FINAL, homeScore: 38, awayScore: 7, isAlmaMaterGame: true });
  const miamiList = ['Miami']; // claimed "Miami" (FL Hurricanes) — NOT the OH school
  const miamiTotal = calculateAlmaMaterTotal([miamiGame], miamiList, 'allAlmaMaterGames');
  assert(miamiTotal === null, `a claimed "Miami" does NOT sum "Miami (OH)"'s points (RG-02's defect class) — got ${miamiTotal}, expected null (no match at all)`);

  const realMiamiGame = G({ homeTeam: 'Miami', awayTeam: 'Temple', status: GAME_STATUS.FINAL, homeScore: 41, awayScore: 10, isAlmaMaterGame: true });
  const realMiamiTotal = calculateAlmaMaterTotal([realMiamiGame], miamiList, 'allAlmaMaterGames');
  assert(realMiamiTotal === 41, `fixture check: the SAME claimed "Miami" correctly matches the real Miami (FL) game — got ${realMiamiTotal} (not vacuous — precision cuts both ways)`);

  // Oklahoma / Oklahoma State — pre-existing catalog exclude pattern, still
  // honored now that the summing half goes through the real matcher too.
  const oklaStateGame = G({ homeTeam: 'Oklahoma State', awayTeam: 'Tulsa', status: GAME_STATUS.FINAL, homeScore: 30, awayScore: 20, isAlmaMaterGame: true });
  const oklaTotal = calculateAlmaMaterTotal([oklaStateGame], ['Oklahoma'], 'allAlmaMaterGames');
  assert(oklaTotal === null, `a claimed "Oklahoma" does NOT sum Oklahoma STATE's points — got ${oklaTotal}, expected null`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] List-membership semantics, at the pure-function level…');
{
  // calculateAlmaMaterTotal() is agnostic to where its `almaMaters` list
  // came from — it just has to agree with itself about what's in it. These
  // fixtures prove that honestly, independent of claimedAlmaMaters()'s real
  // shape (covered in §6 below).
  const g = G({ homeTeam: 'Clemson', awayTeam: 'Wake Forest', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17, isAlmaMaterGame: true });

  // (a) A school absent from the passed list does not count…
  const withoutClemson = ['Oklahoma', 'Texas A&M', 'USC', 'Notre Dame', 'Arkansas'];
  assert(calculateAlmaMaterTotal([g], withoutClemson, 'allAlmaMaterGames') === null,
    'a school not present in the passed list does not contribute, even though it is FINAL and on the slate');

  // …but the SAME game, with a list that DOES carry it, counts — proves (a)
  // isn't vacuous.
  const withClemson = [...withoutClemson, 'Clemson'];
  assert(calculateAlmaMaterTotal([g], withClemson, 'allAlmaMaterGames') === 24,
    'fixture check: the identical game DOES count once its school is present in the list — got a real number, not vacuous');

  // (b) A single-school list (the real shape claimedAlmaMaters() often
  // produces — one player, one claim) is sufficient on its own; the
  // function needs no other schools present to count this one.
  const singleSchoolList = ['Clemson'];
  assert(calculateAlmaMaterTotal([g], singleSchoolList, 'allAlmaMaterGames') === 24,
    'a school present in an otherwise-empty single-school list still counts — presence in the list is sufficient, nothing else matters');

  // (c) A list that simply never includes this school — the ordinary
  // "nobody claims it" case — correctly excludes it. No second list for it
  // to be "unclaimed but still on" — the function only ever sees ONE list.
  const listMissingThisSchool = ['Oklahoma', 'Texas A&M']; // Clemson never present
  assert(calculateAlmaMaterTotal([g], listMissingThisSchool, 'allAlmaMaterGames') === null,
    'a school absent from the list does not count — there is no other list it could still count through');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] null vs. 0 — the old code\'s silent-zero failure mode…');
{
  assert(calculateAlmaMaterTotal([], ['Oklahoma']) === null, 'no games at all -> null');

  const scheduled = G({ homeTeam: 'Oklahoma', awayTeam: 'Temple', status: GAME_STATUS.SCHEDULED, isAlmaMaterGame: true });
  assert(calculateAlmaMaterTotal([scheduled], ['Oklahoma']) === null, 'a matching game that has not gone FINAL yet -> null, not 0');

  // THE OLD-CODE SHAPE: a game passes the (formerly catalog-based) filter
  // half via a school on the CATALOG, while the passed list (what the
  // summing half used, then AND now) does not include that school at all —
  // e.g. a FINAL Purdue game, catalog-eligible but off the active/claimed
  // list. Before the fix this returned 0 (silent false "nothing scored").
  // After the fix, the SAME list drives both halves, so this game is
  // rejected at the FILTER step and the guard returns null.
  const purdueFinal = G({ homeTeam: 'Purdue', awayTeam: 'Indiana State', status: GAME_STATUS.FINAL, homeScore: 49, awayScore: 0, isAlmaMaterGame: true });
  const claimedWithoutPurdue = ['Oklahoma', 'Texas A&M', 'USC', 'Notre Dame', 'Arkansas']; // Purdue not claimed
  const result = calculateAlmaMaterTotal([purdueFinal], claimedWithoutPurdue, 'allAlmaMaterGames');
  assert(result === null, `a FINAL game whose school is NOT in the list returns null, never 0 — got ${result}`);
  assert(result !== 0, 'explicit: the result is not the number 0 (a silent, misleadingly-confident wrong answer)');

  // Positive control — the SAME shape, but the list DOES include the
  // school, produces a real (non-null, non-vacuous) number.
  const claimedWithPurdue = [...claimedWithoutPurdue, 'Purdue'];
  assert(calculateAlmaMaterTotal([purdueFinal], claimedWithPurdue, 'allAlmaMaterGames') === 49,
    'fixture check: the identical FINAL game correctly totals 49 once its school IS in the list — not vacuous');

  // THE OLD CODE ON THE IDENTICAL FIXTURE — genuine, provable divergence.
  // Purdue is a catalog member, so the OLD filter half admits the game via
  // the catalog REGARDLESS of `claimedWithoutPurdue`; the OLD summing half
  // then finds no naive-substring match in that same list and silently
  // totals 0 — the exact false "nothing scored" this fix closes.
  const oldResult = calculateAlmaMaterTotalOld([purdueFinal], claimedWithoutPurdue, 'allAlmaMaterGames');
  assert(oldResult === 0, `THE PRE-FIX REFERENCE on the identical fixture silently returns 0 (not null) — got ${oldResult}`);
  assert(oldResult !== result, 'fixture check: the pre-fix reference and the fixed code genuinely diverge on this exact fixture (0 vs null) — not a vacuous "any answer passes" proof');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] THE NAMED SCENARIO — Clemson 31 / Oklahoma 28 -> 59…');
{
  // Two SEPARATE alma games on the same slate — Clemson's own game (Clemson
  // scores 31) and Oklahoma's own separate game (Oklahoma scores 28) — not
  // a head-to-head matchup between the two. Fixtures interleaved (Oklahoma's
  // game listed first, Clemson's second) so array order doesn't line up
  // with assertion order. calcMode is the REAL production default
  // ('selectedSlateOnly', both games correctly flagged isAlmaMaterGame via
  // recomputeAlmaMaterFlags with the current list, matching what actually
  // happens when a commissioner adds a school in the panel).
  const oklaGame    = G({ homeTeam: 'Oklahoma', awayTeam: 'Temple',      status: GAME_STATUS.FINAL, homeScore: 28, awayScore: 6,  isAlmaMaterGame: true });
  const clemsonGame = G({ homeTeam: 'Clemson',  awayTeam: 'Wake Forest', status: GAME_STATUS.FINAL, homeScore: 31, awayScore: 17, isAlmaMaterGame: true });
  const games = [oklaGame, clemsonGame];
  const rosterAfterClemsonAdded = ['Texas A&M', 'USC', 'Notre Dame', 'Arkansas', 'Oklahoma', 'Clemson']; // Purdue removed, Clemson added — the real 8ae64f4 shape

  const fixed = calculateAlmaMaterTotal(games, rosterAfterClemsonAdded, 'selectedSlateOnly');
  assert(fixed === 59, `THE FIXED CODE: Oklahoma's game (28) + Clemson's game (31) = 59 — got ${fixed}`);

  // THE PRE-FIX REFERENCE on the IDENTICAL fixture. Oklahoma is a catalog
  // member, so its game passes the OLD filter's catalog check regardless of
  // the list. Clemson is NOT a catalog member at all — the OLD filter's
  // isAlma check (`getAlmaMaterMatch(home) || getAlmaMaterMatch(away)`,
  // catalog-only) is FALSE for Clemson-vs-Wake-Forest no matter what list
  // the caller passed, so Clemson's game is silently dropped BEFORE the
  // summing half ever runs — reproducing the reviewer's reported 28 exactly.
  const buggy = calculateAlmaMaterTotalOld(games, rosterAfterClemsonAdded, 'selectedSlateOnly');
  assert(buggy === 28, `THE PRE-FIX REFERENCE reproduces the reviewer's reported bug exactly — Auto-Calc returns 28 (Oklahoma's game only; Clemson's game is silently dropped by the catalog-only filter half), not 59 — got ${buggy}`);
  assert(buggy !== fixed, 'fixture check: the pre-fix reference and the fixed code genuinely diverge on this exact fixture — not a vacuous "any answer passes" proof');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] claimedAlmaMaters() — dedupe, active-only, unclaimed absent…');
{
  localStorage.clear();
  // Fixtures interleaved — the inactive player and the duplicate-school
  // player are NOT placed in claim order, so a positional bug would surface.
  addPlayer(P({ playerId: 'c1', displayName: 'Kihoon', almaMater: 'Texas A&M', active: true }));
  addPlayer(P({ playerId: 'c2', displayName: 'Ghost', almaMater: 'Georgia', active: false })); // inactive — must be excluded
  addPlayer(P({ playerId: 'c3', displayName: 'Drew', almaMater: 'Texas A&M', active: true }));  // shares c1's school
  addPlayer(P({ playerId: 'c4', displayName: 'Kevin', almaMater: 'Purdue', active: true }));    // claimed — counts, full stop
  addPlayer(P({ playerId: 'c5', displayName: 'NoSchool', almaMater: '', active: true }));       // blank — excluded

  const claimed = claimedAlmaMaters();
  assert(claimed.filter(a => a === 'Texas A&M').length === 1,
    `Texas A&M, claimed by BOTH Kihoon and Drew, appears exactly ONCE — got ${claimed.filter(a => a === 'Texas A&M').length} occurrences (${JSON.stringify(claimed)})`);
  assert(!claimed.includes('Georgia'), 'the INACTIVE player\'s school (Georgia) is excluded entirely');
  assert(claimed.includes('Purdue'),
    'a claimed school (Kevin/Purdue) counts — there is no separate "roster" it could be off of anymore; claiming IS being on the roster');
  assert(!claimed.some(a => a === ''), 'a player with no almaMater set contributes nothing (not an empty-string entry)');
  assert(claimed.length === 2, `fixture check: exactly 2 distinct claimed schools among ACTIVE players — Texas A&M (Kihoon+Drew, deduped) and Purdue (Kevin); Georgia (Ghost, inactive) and the blank (NoSchool) are excluded — got ${claimed.length}: ${JSON.stringify(claimed)}`);
  assert(!claimed.includes('Oklahoma') && !claimed.includes('USC') && !claimed.includes('Notre Dame') && !claimed.includes('Arkansas'),
    'catalog schools NOBODY in this fixture claims do not appear — the catalog is a matching/suggestion aid only, never a source of roster entries on its own');

  // Feed straight into calculateAlmaMaterTotal — the dedupe must not double-count.
  const tamuGame = G({ homeTeam: 'Texas A&M', awayTeam: 'Missouri', status: GAME_STATUS.FINAL, homeScore: 33, awayScore: 30, isAlmaMaterGame: true });
  const total = calculateAlmaMaterTotal([tamuGame], claimed, 'allAlmaMaterGames');
  assert(total === 33, `two players sharing Texas A&M contribute its points ONCE (33), not doubled (66) — got ${total}`);

  // Case-insensitive dedupe, defensively (CONVENTIONS #7) — even though the
  // real dropdown always writes canonical casing, a stray-cased duplicate
  // must not double-count either.
  localStorage.clear();
  addPlayer(P({ playerId: 'ci1', almaMater: 'Oklahoma', active: true }));
  addPlayer(P({ playerId: 'ci2', almaMater: 'oklahoma', active: true }));
  const ciClaimed = claimedAlmaMaters();
  assert(ciClaimed.length === 1, `case-variant duplicates ("Oklahoma" / "oklahoma") still collapse to ONE entry — got ${JSON.stringify(ciClaimed)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Integration — the REAL #auto-calc-tb-btn handler…');
{
  // Proves the WIRING, not just the math function in isolation: the actual
  // bound click handler in app.js must call claimedAlmaMaters() — a passing
  // §1-§6 above would NOT catch a caller that hardcoded some other list
  // (the catalog, an empty array, a stale closure, etc).
  localStorage.clear();
  resetDom();

  // Neither player claims Oklahoma via a "configured roster" — there is no
  // such thing anymore. Reviewer claims Clemson (not in the ALMA_MATERS
  // catalog at all); Brayden claims Oklahoma (catalog). If the wiring ever
  // regressed to reading the ALMA_MATERS catalog directly instead of actual
  // claims, Clemson would silently drop out (it's not a catalog entry) and
  // the total would come up short.
  addPlayer(P({ playerId: 'ig1', displayName: 'Reviewer', almaMater: 'Clemson', active: true }));
  addPlayer(P({ playerId: 'ig2', displayName: 'Brayden', almaMater: 'Oklahoma', active: true }));

  const week = freshWeek({ weekId: 'ig_w1', tiebreakerCalculationMode: 'allAlmaMaterGames' });
  saveWeek(week);
  const game = G({ weekId: 'ig_w1', homeTeam: 'Oklahoma', awayTeam: 'Clemson', status: GAME_STATUS.FINAL, homeScore: 28, awayScore: 31, isAlmaMaterGame: true });
  saveAllGamesForWeek('ig_w1', [game]);

  el('toast-container');
  el('auto-calc-tb-btn');
  el('tb-actual');
  bindCommEventListeners(week, getGames('ig_w1'), [], [], getSettings(), [week], []);
  el('auto-calc-tb-btn')._fire('click');

  assert(el('tb-actual').value === '59' || el('tb-actual').value === 59,
    `clicking the REAL #auto-calc-tb-btn handler writes 59 into #tb-actual (Clemson 31 + Oklahoma 28, via claimedAlmaMaters()) — got ${JSON.stringify(el('tb-actual').value)}`);
  assert(lastToasts.some(t => t.includes('59')), 'fixture check: a confirming toast with the value actually fired (not vacuous)');

  // Negative control — if the wiring regressed to reading the ALMA_MATERS
  // catalog directly (which does not carry Clemson), the total would be
  // Oklahoma alone (28) — assert explicitly that we did NOT get that answer.
  assert(el('tb-actual').value !== '28', 'explicit: the written value is NOT 28 (the catalog-only, wrong-per-Drew\'s-ruling answer)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] recomputeAlmaMaterFlags() — skips LOCKED/LIVE/FINAL, touches DRAFT/OPEN…');
{
  localStorage.clear();

  // Fixtures interleaved across all 5 statuses, not built in status order.
  const weeks = [
    freshWeek({ weekId: 'rf_locked', status: WEEK_STATUS.LOCKED }),
    freshWeek({ weekId: 'rf_draft',  status: WEEK_STATUS.DRAFT }),
    freshWeek({ weekId: 'rf_final',  status: WEEK_STATUS.FINAL }),
    freshWeek({ weekId: 'rf_open',   status: WEEK_STATUS.OPEN }),
    freshWeek({ weekId: 'rf_live',   status: WEEK_STATUS.LIVE }),
  ];
  for (const w of weeks) saveWeek(w);
  for (const w of weeks) {
    saveAllGamesForWeek(w.weekId, [G({ weekId: w.weekId, homeTeam: 'Clemson', awayTeam: 'Wake Forest', isAlmaMaterGame: false })]);
  }

  const changed = recomputeAlmaMaterFlags(['Clemson']);
  assert(changed === 2, `exactly 2 games change (DRAFT + OPEN only) — got ${changed}`);

  assert(getGames('rf_draft')[0].isAlmaMaterGame === true, 'DRAFT week: game IS re-flagged');
  assert(getGames('rf_open')[0].isAlmaMaterGame === true, 'OPEN week: game IS re-flagged');
  assert(getGames('rf_locked')[0].isAlmaMaterGame === false, 'LOCKED week: game is NOT touched — a tiebreaker guess was already submitted against this slate');
  assert(getGames('rf_live')[0].isAlmaMaterGame === false, 'LIVE week: game is NOT touched');
  assert(getGames('rf_final')[0].isAlmaMaterGame === false, 'FINAL week: game is NOT touched (unchanged from before this fix)');
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. Mutation battery — scoring.js, tmpdir copy, RED/GREEN + inversions
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Mutation battery — calculateAlmaMaterTotal()…');
{
  const realScoringSrc = await readFile(new URL('./js/scoring.js', import.meta.url), 'utf8');
  const realDataModelSrc = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');
  const realStorageSrc = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
  const realBackendSrc = await readFile(new URL('./js/backend.js', import.meta.url), 'utf8');

  const mutantDirs = [];
  async function importMutant(mutatedScoringSrc) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'almatotaltest-mutant-'));
    mutantDirs.push(dir);
    await writeFile(path.join(dir, 'data-model.js'), realDataModelSrc, 'utf8');
    await writeFile(path.join(dir, 'storage.js'), realStorageSrc, 'utf8');
    await writeFile(path.join(dir, 'backend.js'), realBackendSrc, 'utf8');
    await writeFile(path.join(dir, 'scoring.js'), mutatedScoringSrc, 'utf8');
    const url = new URL(`file://${path.join(dir, 'scoring.js')}?t=${Date.now()}_${Math.random()}`);
    return import(url.href);
  }

  const AG = (o = {}) => G(o); // local alias, matches slatetest's `G` convention

  const MUTATIONS = [
    {
      name: 'restore the original bug — filter half drops the 2nd arg to getAlmaMaterMatch',
      apply: s => s.replace(
        `const isAlma = !!(getAlmaMaterMatch(g.homeTeam, list) || getAlmaMaterMatch(g.awayTeam, list));`,
        `const isAlma = !!(getAlmaMaterMatch(g.homeTeam) || getAlmaMaterMatch(g.awayTeam));`
      ),
      proveRed: async (mod) => {
        // Purdue is on the catalog but NOT in the passed list — under the
        // bug, the catalog-based filter half admits it anyway, and (with
        // the summing half unmutated) the game contributes nothing —
        // silently returning 0 or a wrong non-null total, not the correct
        // null. Detect via a FINAL Purdue game with a non-Purdue list.
        const g = AG({ homeTeam: 'Purdue', awayTeam: 'Rice', status: 'final', homeScore: 40, awayScore: 3, isAlmaMaterGame: true });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r !== null; // RED if it's admitted at all (0 or otherwise) instead of correctly null
      },
    },
    {
      name: 'restore the original bug — summing half reverts to naive substring, no exclude patterns',
      apply: s => s.replace(
        `    const hA=!!getAlmaMaterMatch(g.homeTeam, list);\n    const aA=!!getAlmaMaterMatch(g.awayTeam, list);`,
        `    const hA=list.some(am=>g.homeTeam.toLowerCase().includes(am.toLowerCase()));\n    const aA=list.some(am=>g.awayTeam.toLowerCase().includes(am.toLowerCase()));`
      ),
      proveRed: async (mod) => {
        // The FILTER half (unmutated here) already excludes Oklahoma STATE
        // via the exclude-pattern list, so the divergence has to show up
        // through a game that legitimately PASSES the filter (via the
        // AWAY side, Oklahoma proper) while the HOME side is a confusable
        // catalog neighbor the SUMMING half should reject but naive
        // substring wrongly admits.
        const g = AG({ homeTeam: 'Oklahoma State', awayTeam: 'Oklahoma', status: 'final', homeScore: 30, awayScore: 20, isAlmaMaterGame: true });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r === 50; // RED — naive substring wrongly ALSO sums Oklahoma STATE's 30 (30+20=50) instead of correctly excluding it (20)
      },
    },
    {
      name: 'invert calcMode comparison (selectedSlateOnly -> everything requires the flag)',
      apply: s => s.replace(
        `return calcMode==='selectedSlateOnly'?g.isAlmaMaterGame&&isAlma:isAlma;`,
        `return calcMode==='selectedSlateOnly'?isAlma:g.isAlmaMaterGame&&isAlma;`
      ),
      proveRed: async (mod) => {
        const g = AG({ homeTeam: 'Oklahoma', awayTeam: 'Temple', status: 'final', homeScore: 20, awayScore: 10, isAlmaMaterGame: false });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r === null; // RED — 'allAlmaMaterGames' should NOT require the flag; correct answer is 20
      },
    },
    // NOTE — no mutation here for the `if(!ag.length) return null;` guard.
    // It is a PROVABLE EQUIVALENT MUTANT: `fg` is always filtered FROM `ag`
    // (fg ⊆ ag), so whenever `ag` is empty, `fg` is necessarily empty too,
    // and the very next guard (`if(!fg.length) return null;`, covered
    // below) already returns the identical `null` either way. Deleting the
    // ag-guard changes zero observable behavior — nothing to catch, and
    // pretending otherwise would be exactly the false-coverage shape this
    // review batch flagged four times (oddstest.mjs documents the same
    // discipline for its 3 genuinely-unreachable rungs).
    {
      name: 'delete the empty-fg null guard (restores the silent-0 defect directly)',
      apply: s => s.replace(`  if(!fg.length) return null;\n`, ``),
      proveRed: async (mod) => {
        const g = AG({ homeTeam: 'Oklahoma', awayTeam: 'Temple', status: 'scheduled', isAlmaMaterGame: true });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r === 0; // RED — a non-final game must yield null, not a silent 0 from an empty sum
      },
    },
    {
      name: 'invert homeScore null-guard removal (drop the awayScore!==null check)',
      apply: s => s.replace(
        `g.status===GAME_STATUS.FINAL&&g.homeScore!==null&&g.awayScore!==null`,
        `g.status===GAME_STATUS.FINAL&&g.homeScore!==null`
      ),
      proveRed: async (mod) => {
        // homeScore set, awayScore genuinely null (malformed FINAL) — the
        // away side's null score is coerced to 0 by `||0`, silently
        // asserting "this team scored zero" instead of treating the game as
        // not-yet-usable data.
        const g = AG({ homeTeam: 'Oklahoma', awayTeam: 'Clemson', status: 'final', homeScore: 28, awayScore: null, isAlmaMaterGame: true });
        const withGuard = mod.calculateAlmaMaterTotal([g], ['Oklahoma', 'Clemson'], 'allAlmaMaterGames');
        return withGuard === 28; // RED — without the awayScore guard this "succeeds" at 28 instead of legitimately differing behavior
      },
    },
    {
      name: 'invert homeScore accumulation sign',
      apply: s => s.replace(`if(hA) total+=g.homeScore||0;`, `if(hA) total-=g.homeScore||0;`),
      proveRed: async (mod) => {
        const g = AG({ homeTeam: 'Oklahoma', awayTeam: 'Temple', status: 'final', homeScore: 20, awayScore: 3, isAlmaMaterGame: true });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r === -20;
      },
    },
    {
      name: 'invert awayScore accumulation sign',
      apply: s => s.replace(`if(aA) total+=g.awayScore||0;`, `if(aA) total-=g.awayScore||0;`),
      proveRed: async (mod) => {
        const g = AG({ homeTeam: 'Temple', awayTeam: 'Oklahoma', status: 'final', homeScore: 3, awayScore: 20, isAlmaMaterGame: true });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r === -20;
      },
    },
    {
      name: 'delete the hA branch entirely — home-side alma points never counted',
      apply: s => s.replace(`    if(hA) total+=g.homeScore||0;\n`, ``),
      proveRed: async (mod) => {
        const g = AG({ homeTeam: 'Oklahoma', awayTeam: 'Temple', status: 'final', homeScore: 20, awayScore: 3, isAlmaMaterGame: true });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r === 0; // RED — should be 20
      },
    },
    {
      name: 'delete the aA branch entirely — away-side alma points never counted',
      apply: s => s.replace(`    if(aA) total+=g.awayScore||0;\n`, ``),
      proveRed: async (mod) => {
        const g = AG({ homeTeam: 'Temple', awayTeam: 'Oklahoma', status: 'final', homeScore: 3, awayScore: 20, isAlmaMaterGame: true });
        const r = mod.calculateAlmaMaterTotal([g], ['Oklahoma'], 'allAlmaMaterGames');
        return r === 0; // RED — should be 20
      },
    },
    {
      name: 'drop the Array.isArray(almaMaters) defensive coercion — a null list crashes instead of failing to null',
      apply: s => s.replace(
        `const list = Array.isArray(almaMaters) ? almaMaters : [];`,
        `const list = almaMaters;`
      ),
      proveRed: async (mod) => {
        // `undefined` is NOT a useful probe here — getAlmaMaterMatch's own
        // default parameter (`almaMaters = ALMA_MATERS`) only activates for
        // literally `undefined`, silently masking this exact mutation. Pass
        // `null` instead: default params do NOT intercept `null`, so it
        // reaches `for (const alma of almaMaters)` inside getAlmaMaterMatch
        // and throws "null is not iterable" — which the FIXED code's
        // Array.isArray coercion prevents by falling back to `[]` (and
        // therefore `null`, correctly, via the empty-list path).
        try {
          mod.calculateAlmaMaterTotal([AG({ status: 'final', homeScore: 1, awayScore: 1, isAlmaMaterGame: true })], null, 'allAlmaMaterGames');
          return false; // GREEN — did not throw, meaning the coercion (or an equivalent guard) is still in effect
        } catch {
          return true; // RED via exception — caught, same as loadtest.mjs's convention
        }
      },
    },
  ];

  // Sanity — the UNMUTATED module must NOT trip any proveRed() check.
  {
    const baseline = await importMutant(realScoringSrc);
    let baselineOk = true;
    for (const m of MUTATIONS) {
      const tripped = await m.proveRed(baseline);
      if (tripped) { baselineOk = false; console.error(`  ⚠️  baseline unexpectedly RED on: ${m.name}`); }
    }
    assert(baselineOk, 'GREEN — the real, unmutated scoring.js trips NONE of the mutation-battery checks');
  }

  for (const m of MUTATIONS) {
    const mutatedSrc = m.apply(realScoringSrc);
    assert(mutatedSrc !== realScoringSrc, `fixture check: mutation "${m.name}" actually changed the source text`);
    try {
      const mutantMod = await importMutant(mutatedSrc);
      const tripped = await m.proveRed(mutantMod);
      assert(tripped === true, `RED — mutation caught: ${m.name}`);
    } catch (e) {
      assert(true, `RED — mutation caught (via exception): ${m.name} — ${e.message}`);
    }
  }

  await Promise.all(mutantDirs.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. Structural call-site scans
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[10] Structural call-site scans…');
{
  const appJsSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const scoringJsSrc = await readFile(new URL('./js/scoring.js', import.meta.url), 'utf8');
  const dataProviderJsSrc = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');
  const dataModelJsSrc = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');
  const SRC_FILES = {
    'app.js': appJsSrc, 'scoring.js': scoringJsSrc,
    'data-provider.js': dataProviderJsSrc, 'data-model.js': dataModelJsSrc,
  };

  // Strip explanatory-comment lines, same filter loadtest.mjs uses (`code`),
  // so prose that legitimately mentions these function names by name doesn't
  // get misread as a call site.
  const isCode = l => !/^\s*(\/\/|\*|\/\*)/.test(l);
  const stripComments = src => src.split('\n').filter(isCode).join('\n');

  /** Top-level (depth-0) comma split of a call's argument text. */
  function splitTopLevel(s) {
    const parts = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
      else cur += ch;
    }
    parts.push(cur);
    return parts.map(p => p.trim()).filter(p => p !== '');
  }

  /**
   * Finds every CALL of `fnName(` in `src` — excluding the function's own
   * declaration (`function fnName(`, with or without `export`/`async`
   * before it) — and returns each call's argument list as raw text.
   */
  function findCalls(fnName, src) {
    const codeSrc = stripComments(src);
    const re = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(codeSrc))) {
      const before = codeSrc.slice(Math.max(0, m.index - 24), m.index);
      if (/\bfunction\s*$/.test(before)) continue; // the declaration itself, not a call
      const openIdx = m.index + m[0].length - 1; // index of the '('
      let depth = 0, i = openIdx;
      for (; i < codeSrc.length; i++) {
        if (codeSrc[i] === '(') depth++;
        else if (codeSrc[i] === ')') { depth--; if (depth === 0) break; }
      }
      out.push(codeSrc.slice(openIdx + 1, i));
    }
    return out;
  }

  // ── 10a. getAlmaMaterMatch( — every call site passes an explicit 2nd arg ──
  console.log('  [10a] getAlmaMaterMatch() — every call passes an explicit 2nd argument…');
  {
    // Prove the detector itself works, on synthetic fixtures, before trusting
    // it against the real files (the RG-10 loadtest.mjs shape).
    const MUST_CATCH_10a = [
      ['bare call, no list at all',        'const x = getAlmaMaterMatch(team);'],
      ['bare call, no parens around args', 'if (getAlmaMaterMatch(g.homeTeam)) {}'],
    ];
    for (const [label, frag] of MUST_CATCH_10a) {
      const calls = findCalls('getAlmaMaterMatch', frag);
      assert(calls.length === 1 && splitTopLevel(calls[0]).length < 2,
        `detector catches: ${label} — ${frag}`);
    }
    const MUST_PASS_10a = [
      ['explicit variable 2nd arg',   'getAlmaMaterMatch(g.homeTeam, almaMaters)'],
      ['explicit call-result 2nd arg','getAlmaMaterMatch(ht, activeAlmaMaters())'],
      ['explicit literal 2nd arg',    "getAlmaMaterMatch(team, ['Oklahoma'])"],
      ['nested-paren 2nd arg does not confuse the top-level split', 'getAlmaMaterMatch(g.homeTeam, fn(a, b))'],
    ];
    for (const [label, frag] of MUST_PASS_10a) {
      const calls = findCalls('getAlmaMaterMatch', frag);
      assert(calls.length === 1 && splitTopLevel(calls[0]).length >= 2,
        `detector does NOT false-positive on: ${label} — ${frag}`);
    }
    // The declaration itself must not be treated as a call.
    const declCalls = findCalls('getAlmaMaterMatch', 'export function getAlmaMaterMatch(teamName, almaMaters = ALMA_MATERS) {}');
    assert(declCalls.length === 0, 'detector correctly excludes the function\'s OWN declaration, not just its call sites');

    // A short, explicit, documented allowlist for genuinely intentional
    // catalog-default uses. Empty today — every real call site in the app
    // now passes an explicit list — but the mechanism exists so a future
    // deliberate catalog fallback can be recorded rather than silently
    // breaking this scan.
    const ALLOWLIST_10a = {
      // 'file.js:some snippet': 'reason',
    };

    let totalCalls = 0, violations = [];
    for (const [file, src] of Object.entries(SRC_FILES)) {
      const calls = findCalls('getAlmaMaterMatch', src);
      totalCalls += calls.length;
      for (const argsStr of calls) {
        const key = `${file}:${argsStr.replace(/\s+/g, ' ').trim()}`;
        if (Object.prototype.hasOwnProperty.call(ALLOWLIST_10a, key)) continue;
        if (splitTopLevel(argsStr).length < 2) violations.push(key);
      }
    }
    assert(totalCalls >= 8, `fixture check: the scan found a realistic number of real getAlmaMaterMatch() call sites across js/ (found ${totalCalls}) — guards against a broken/vacuous parser reporting 0`);
    assert(violations.length === 0,
      `every getAlmaMaterMatch() call site across js/ passes an explicit 2nd argument (or is on the documented allowlist) — violations: ${JSON.stringify(violations)}`);
  }

  // ── 10b. fetchByDateRange( — every call passes almaMaters: ─────────────────
  console.log('  [10b] fetchByDateRange() — every call passes almaMaters:…');
  {
    const MUST_CATCH_10b = [
      ['no almaMaters key at all', 'fetchByDateRange({startDate,endDate,season})'],
    ];
    for (const [label, frag] of MUST_CATCH_10b) {
      const calls = findCalls('fetchByDateRange', frag);
      assert(calls.length === 1 && !/\balmaMaters\s*:/.test(calls[0]), `detector catches: ${label} — ${frag}`);
    }
    const MUST_PASS_10b = [
      ['almaMaters last',  'fetchByDateRange({startDate,endDate,season,almaMaters:activeAlmaMaters()})'],
      ['almaMaters first', 'fetchByDateRange({almaMaters:list,startDate,endDate})'],
    ];
    for (const [label, frag] of MUST_PASS_10b) {
      const calls = findCalls('fetchByDateRange', frag);
      assert(calls.length === 1 && /\balmaMaters\s*:/.test(calls[0]), `detector does NOT false-positive on: ${label} — ${frag}`);
    }
    const declCalls = findCalls('fetchByDateRange', 'export async function fetchByDateRange({ startDate, endDate, season, almaMaters = ALMA_MATERS } = {}) {}');
    assert(declCalls.length === 0, 'detector correctly excludes the function\'s OWN declaration');

    let totalCalls = 0, violations = [];
    for (const [file, src] of Object.entries(SRC_FILES)) {
      const calls = findCalls('fetchByDateRange', src);
      totalCalls += calls.length;
      for (const argsStr of calls) {
        if (!/\balmaMaters\s*:/.test(argsStr)) violations.push(`${file}:${argsStr.replace(/\s+/g, ' ').trim()}`);
      }
    }
    assert(totalCalls >= 1, `fixture check: the scan found real fetchByDateRange() call sites across js/ (found ${totalCalls})`);
    assert(violations.length === 0,
      `every fetchByDateRange() call site across js/ passes almaMaters: — violations: ${JSON.stringify(violations)}`);
  }

  // ── 10c. Suggestion-reason chips are escHtml()'d ───────────────────────────
  console.log('  [10c] renderSuggestedGameRow() — suggestion-reason chips are escHtml()\'d…');
  {
    function suggestionReasonMapExpr(src) {
      const m = /\(game\.suggestionReasons\s*\|\|\s*\[\]\)\.map\((\w+)\s*=>\s*`([\s\S]*?)`\)/.exec(src);
      return m ? { param: m[1], template: m[2] } : null;
    }
    function chipIsEscaped(src) {
      const found = suggestionReasonMapExpr(src);
      if (!found) return null;
      const { param, template } = found;
      const escaped = new RegExp(`\\$\\{\\s*escHtml\\(\\s*${param}\\s*\\)\\s*\\}`).test(template);
      const bareUnescaped = new RegExp(`\\$\\{\\s*${param}\\s*\\}`).test(template) && !escaped;
      return { escaped, bareUnescaped };
    }

    // Detector self-test on synthetic fixtures.
    const CATCH_FRAG = '${(game.suggestionReasons||[]).map(r=>`<span class="candidate-reason">${r}</span>`).join(\'\')}';
    const catchResult = chipIsEscaped(CATCH_FRAG);
    assert(catchResult && catchResult.bareUnescaped === true && catchResult.escaped === false,
      'detector catches a bare, unescaped ${r} interpolation in the suggestion-reason chip');

    const PASS_FRAG = '${(game.suggestionReasons||[]).map(r=>`<span class="candidate-reason">${escHtml(r)}</span>`).join(\'\')}';
    const passResult = chipIsEscaped(PASS_FRAG);
    assert(passResult && passResult.escaped === true && passResult.bareUnescaped === false,
      'detector does NOT false-positive on a properly escHtml()\'d chip');

    // A differently-named map parameter must still be tracked correctly
    // (proves the detector isn't hardcoded to the literal name "r").
    const RENAMED_PASS_FRAG = '${(game.suggestionReasons||[]).map(reason=>`<span class="candidate-reason">${escHtml(reason)}</span>`).join(\'\')}';
    const renamedResult = chipIsEscaped(RENAMED_PASS_FRAG);
    assert(renamedResult && renamedResult.escaped === true, 'detector correctly tracks a renamed map parameter, not just the literal name "r"');

    // …and now the real file.
    const real = chipIsEscaped(appJsSrc);
    assert(real !== null, 'fixture check: the real renderSuggestedGameRow() suggestion-reason .map() expression was found in js/app.js — guards a rewritten render path silently going unscanned');
    assert(real.escaped === true && real.bareUnescaped === false,
      'renderSuggestedGameRow() escapes each suggestion-reason chip through escHtml() — no bare, unescaped interpolation of commissioner-controlled reason text');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
else { console.log(`❌ FAILURES — ${pass} passed, ${fail} failed`); process.exit(1); }
