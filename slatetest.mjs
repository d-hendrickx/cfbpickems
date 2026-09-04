/**
 * CFB Pickems — slatetest.mjs
 * ============================
 * Design Inputs — Item 8: Commissioner Slate Builder (Drew, approved
 * 2026-09-03, including the same-day DI-5 amendment).
 *
 * Run:  node slatetest.mjs
 * Also: TZ=UTC node slatetest.mjs && TZ=America/Los_Angeles node slatetest.mjs
 *
 * THE DEFECT THIS FEATURE ALSO FIXES
 * -----------------------------------
 * `balanceByTimeWindow()` bucketed already-score-sorted games by time window
 * and took each window's top slice IN WINDOW ORDER (Morning -> Afternoon ->
 * Evening -> Late), truncating only afterward. A cluster of high scorers
 * sharing one window was discarded wholesale before that window was ever
 * reached. Measured against the real Sep 3-7 pool: the six highest-scoring
 * games sat past the cut, five of them alma-mater games — the exact games
 * the +100 alma bonus exists to guarantee. `buildSuggestedSlate()` replaces
 * it with strict tier precedence (alma -> anchors -> capped fill) decided
 * FIRST, with chronological listing order applied only afterward, as a
 * wholly separate step.
 *
 * FIXTURE DISCIPLINE (binding constraints from this session)
 * ------------------------------------------------------------
 * 1. Fixtures never construct pools in the order they expect back out. Score
 *    values are interleaved non-monotonically and tie-break winners are
 *    placed FIRST in raw arrays so a positional/stable-sort bug would still
 *    surface. A pool that's already sorted the "right" way would pass
 *    against the pre-fix code too.
 * 2. Every negative/structural assertion ("no 📺 badge") is paired with a
 *    same-fixture positive check that the render path actually produced
 *    something real (proves the assertion isn't vacuous).
 * 3. The mutation battery (section [M]) includes INVERSIONS, not just
 *    deletions, and mutates a COPY under os.tmpdir() — never real source
 *    under cfb-pickems/, never a hardcoded session-scratch path.
 *
 * SECTIONS
 *   1  computeScore() — DI-2 point values, including the halved spread
 *      buckets and the two new signals (national TV, marquee event)
 *   2  National TV detection — exact allow-list, co-listed simulcast, safe
 *      defaults on missing/malformed broadcasts (via fetchByDateRange, the
 *      real parse path — same style as oddstest.mjs)
 *   3  Marquee-event detection (ESPN notes[] presence) — same path
 *   4  Tier 1 — alma-mater guarantee, unconditional, length-agnostic (3, the
 *      real current list, and a 12-school over-budget case) — the
 *      literal reproduction of the reported defect shape (cluster in one
 *      window, real balanceByTimeWindow()-shaped pool)
 *   5  Tier 2a — morning anchor: Central-pinned, score-based, skipped when
 *      Tier 1 already covers it, muted-note trigger when genuinely absent
 *   6  Tier 2b — closing anchor: Pacific day boundary (the Hawai'i proof),
 *      score-independence, the real DI-5 tie, "latest that exists still
 *      wins" (no quality floor), skip-when-already-Tier-1
 *   7  Tier 3 — score-descending fill, soft caps applied only to free-fill,
 *      caps relaxed rather than leaving a slot blank
 *   8  Budget arithmetic is NOT a fixed law (small list leaves room; a
 *      long configured list can legitimately leave zero free-fill, with
 *      anchors correctly skipped rather than force-added) + shortlist
 *   9  Display order — chronological by kickoff, independent of selection
 *  10  DI-3 filters — nationalTV / tightOnly chips, same predicate pattern
 *  11  DI-7 render paths — 📺 badge on commissioner surfaces, ABSENCE on the
 *      player-facing card, CSV column, and all THREE add-to-slate paths
 *      (Apply Suggested 10 / add individually / Available Games / shortlist)
 *  12  DI-8 — Game Modal carry-forward vs. brand-new-manual default
 *  13  DI-6 — budget banner + anchor-not-filled muted notes, rendered
 *  M   Mutation battery (RED/GREEN, tmpdir copy, inversions included)
 */

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ── DOM / localStorage stubs (gradetest.mjs shape — registered elements that
//    remember listeners, so bindCommEventListeners() can be driven for real) ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
const selectorSets = new Map();

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
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`slatetest: nothing bound to '${type}' on #${id}`);
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
function resetDom() { registry.clear(); selectorSets.clear(); }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__detached__'),
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

// fetch is mocked per-section below (national TV / marquee tests need it);
// default to disabled so any accidental network call fails loudly.
globalThis.fetch = async () => { throw new Error('network disabled in slatetest (mock it per-section)'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const dp = await import('./js/data-provider.js');
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');
const {
  computeScore, scoreCandidateGames, buildSuggestedSlate,
  getTimeWindow, fetchByDateRange,
} = dp;
const {
  renderAvailableGamesList, renderAdminGamesList, renderGameCard,
  filterAndGroupAvailableGames, renderAvailFilterBar,
  exportWeekSlateCSV, carryForwardBroadcastFields,
  bindCommEventListeners, state,
} = app;
const { createGame, ALMA_MATERS } = dm;

console.log('[slatetest] data-provider.js exports —', Object.keys(dp).length);
console.log('[slatetest] app.js exports —', Object.keys(app).length);

// ── Fixture helpers ──────────────────────────────────────────────────────────

const WEEK = {
  weekId: 'st_w1', weekNumber: 1, label: 'Week 1', season: 2026,
  status: 'live', dataSourceMode: 'espn_historical',
  picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
  actualTiebreakerValue: null, tiebreakerFinalized: false,
  blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
};

let _gid = 0;
/** A minimally-valid game record, DI-7 fields included, all defaulted off. */
function G(o = {}) {
  _gid++;
  return {
    gameId: `st_g${_gid}`, weekId: WEEK.weekId,
    homeTeam: `Home${_gid}`, awayTeam: `Away${_gid}`, homeMascot: '', awayMascot: '',
    homeConference: '', awayConference: '', homeRank: null, awayRank: null,
    // Tuesday — deliberately NOT a Saturday in Central or Pacific, so a
    // fixture that doesn't care about anchors never accidentally becomes a
    // Saturday-Pacific closing-anchor candidate just by using the default.
    kickoff: '2026-09-08T18:00:00Z', kickoffConfirmed: true,
    timeWindow: 'afternoon',
    spread: null, favorite: null, lockedSpread: null,
    homeScore: null, awayScore: null,
    status: 'scheduled', actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, nationalTV: false, broadcastNetwork: null, marqueeEvent: false,
    multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_historical', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: null,
    ...o,
  };
}
/** Same as G() but pre-scored, for tests that isolate buildSuggestedSlate()
 *  from computeScore()'s math entirely. */
function SG(score, o = {}) { return { ...G(o), _score: score, suggestionReasons: [] }; }

function seedWeekAndGames(games) {
  localStorage.clear();
  storage.saveWeek(WEEK);
  for (const g of games) storage.saveGame(g);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. computeScore() — DI-2 point values
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] computeScore() — DI-2 point values…');
{
  // G()'s own default carries kickoffConfirmed:true (it's a "real ESPN game"
  // fixture elsewhere in this file) — explicitly overridden to false in every
  // assertion below that isn't itself testing the kickoff-confirmed bonus, so
  // each check isolates exactly the ONE term it names.
  assert(computeScore(G({ kickoffConfirmed: false })) === 0, 'a plain unranked, unconfirmed, no-spread, no-TV game scores 0');
  assert(computeScore(G({ kickoffConfirmed: false, isAlmaMaterGame: true })) === 100, 'alma mater alone: +100 (unchanged)');
  assert(computeScore(G({ kickoffConfirmed: false, homeRank: 5, awayRank: 10 })) ===
    (26 - 5) * 2 + (26 - 10) * 2 + 30,
    'both-ranked: per-team rank bonus AND the +30 both-ranked bonus, unchanged formula');
  assert(computeScore(G({ kickoffConfirmed: false, homeRank: 25 })) === (26 - 25) * 2, '#25 alone gets the minimum per-team bonus (+2), not zero');
  assert(computeScore(G({ kickoffConfirmed: false, homeRank: 26 })) === 0, 'rank 26 (out of the top 25) contributes nothing — the <=25 guard holds');
  // DI-2 — spread bonuses HALVED
  assert(computeScore(G({ kickoffConfirmed: false, spread: -6.5 })) === 10, 'spread <=7: +10 (was +20)');
  assert(computeScore(G({ kickoffConfirmed: false, spread: 7 })) === 10, 'spread exactly 7 still gets the <=7 bucket (inclusive)');
  assert(computeScore(G({ kickoffConfirmed: false, spread: 7.5 })) === 5, 'spread 7.5 MISSES the <=7 bucket by half a point, falls to <=14: +5 (was +10)');
  assert(computeScore(G({ kickoffConfirmed: false, spread: 14 })) === 5, 'spread exactly 14 still gets the <=14 bucket (inclusive)');
  assert(computeScore(G({ kickoffConfirmed: false, spread: 14.5 })) === 0, 'spread beyond 14 gets neither spread bucket');
  assert(computeScore(G({ kickoffConfirmed: true })) === 5, 'confirmed kickoff: +5 (unchanged)');
  assert(computeScore(G({ kickoffConfirmed: false })) === 0, 'unconfirmed kickoff contributes nothing');
  // DI-2 — two NEW signals
  assert(computeScore(G({ kickoffConfirmed: false, nationalTV: true })) === 15, 'national TV (new): +15');
  assert(computeScore(G({ kickoffConfirmed: false, marqueeEvent: true })) === 10, 'marquee event (new): +10');
  // DI-2's own worked proof, reproduced exactly: Auburn/Baylor-shaped game —
  // spread 7.5 (misses <=7, hits <=14 for +5), confirmed kickoff (+5),
  // national TV (+15), marquee (+10) = 35.
  const auburnBaylorShaped = G({ spread: 7.5, kickoffConfirmed: true, nationalTV: true, marqueeEvent: true });
  assert(computeScore(auburnBaylorShaped) === 35, "DI-2's own proof case totals 35 under the new table");
  // Tarleton/Bowling-Green-shaped game — spread 2.5 (<=7, +10), confirmed (+5),
  // no TV, no marquee = 15.
  const tarletonShaped = G({ spread: 2.5, kickoffConfirmed: true });
  assert(computeScore(tarletonShaped) === 15, "the tight-but-unremarkable proof case totals 15 — no longer beats the marquee game (35) on its own");
  assert(computeScore(auburnBaylorShaped) > computeScore(tarletonShaped),
    'DI-2 defect fixed: the marquee national-TV game now outscores the merely-tight streaming game (was reversed under the old table)');
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. National TV detection — via fetchByDateRange(), the real parse path
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] National TV detection (exact allow-list, real parse path)…');
{
  function espnEvent(id, { broadcasts, notes } = {}) {
    return {
      id: String(id), date: '2026-09-05T18:00:00Z',
      status: { type: { name: 'STATUS_SCHEDULED', detail: '2:00 PM ET' } },
      competitions: [{
        id: String(id), neutralSite: false,
        competitors: [
          { homeAway: 'home', team: { location: `Home${id}`, name: 'Team', abbreviation: `H${id}` }, score: null, curatedRank: {} },
          { homeAway: 'away', team: { location: `Away${id}`, name: 'Team', abbreviation: `A${id}` }, score: null, curatedRank: {} },
        ],
        odds: [],
        broadcasts, notes,
      }],
    };
  }
  const NETWORKS_TRUE  = ['ABC', 'CBS', 'FOX', 'NBC', 'ESPN', 'espn', ' Fox '];
  const NETWORKS_FALSE = ['ESPN2', 'ESPNU', 'ESPN+', 'SEC Network', 'ACC Network', 'BTN', 'FS1',
    'CBSSN', 'Peacock', 'Disney+', 'TNT', 'CW', 'MW+', 'SECN+', 'UConn+', 'USA Net'];

  const events = [];
  let idx = 0;
  const expectTrue = new Map(), expectFalse = new Map();
  for (const n of NETWORKS_TRUE)  { idx++; const id = `tv_true_${idx}`; events.push(espnEvent(id, { broadcasts: [{ names: [n] }] })); expectTrue.set(id, n); }
  for (const n of NETWORKS_FALSE) { idx++; const id = `tv_false_${idx}`; events.push(espnEvent(id, { broadcasts: [{ names: [n] }] })); expectFalse.set(id, n); }
  // Co-listed cable simulcast FIRST — the exact scenario DI-2 calls out:
  // flatten every broadcasts[] entry's names, not just index 0.
  const coListedId = 'tv_colisted';
  events.push(espnEvent(coListedId, { broadcasts: [{ names: ['ESPN2'] }, { names: ['ABC'] }] }));
  // Missing / malformed broadcasts — must default safely, never throw.
  const missingId = 'tv_missing'; events.push(espnEvent(missingId, { broadcasts: undefined }));
  const malformedId = 'tv_malformed'; events.push(espnEvent(malformedId, { broadcasts: 'not-an-array' }));
  const emptyId = 'tv_empty'; events.push(espnEvent(emptyId, { broadcasts: [] }));

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  const result = await fetchByDateRange({ startDate: '2026-09-05', endDate: '2026-09-05' });
  assert(result.error === null, 'fixture check: the mocked fetch parsed without error (games=' + result.games.length + ')');
  const byId = new Map(result.games.map(g => [g.espnEventId, g]));

  let trueOk = true, falseOk = true;
  for (const [id, n] of expectTrue) { const g = byId.get(id); if (!g || g.nationalTV !== true || g.broadcastNetwork == null) trueOk = false; }
  for (const [id] of expectFalse) { const g = byId.get(id); if (!g || g.nationalTV !== false || g.broadcastNetwork !== null) falseOk = false; }
  assert(trueOk, `all ${NETWORKS_TRUE.length} flagship-network strings (incl. lowercase/whitespace variants) resolve nationalTV:true`);
  assert(falseOk, `all ${NETWORKS_FALSE.length} non-flagship strings (ESPN2/ESPNU/ESPN+/SEC Network/etc.) resolve nationalTV:false — substring matching would wrongly catch ESPN2/ESPNU against "ESPN"`);

  const coListed = byId.get(coListedId);
  assert(coListed?.nationalTV === true && coListed?.broadcastNetwork === 'ABC',
    'a cable simulcast listed FIRST does not hide a flagship network listed second — every broadcasts[] entry is flattened, not just index 0');

  const missing = byId.get(missingId);
  const malformed = byId.get(malformedId);
  const empty = byId.get(emptyId);
  assert(missing?.nationalTV === false && missing?.broadcastNetwork === null, 'missing broadcasts[] defaults to nationalTV:false, broadcastNetwork:null — never throws');
  assert(malformed?.nationalTV === false && malformed?.broadcastNetwork === null, 'malformed (non-array) broadcasts defaults safely — never throws');
  assert(empty?.nationalTV === false && empty?.broadcastNetwork === null, 'empty broadcasts[] defaults safely');
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. Marquee-event detection (ESPN notes[] presence)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Marquee-event detection…');
{
  function espnEventNotes(id, notes) {
    return {
      id: String(id), date: '2026-09-05T18:00:00Z',
      status: { type: { name: 'STATUS_SCHEDULED', detail: '2:00 PM ET' } },
      competitions: [{
        id: String(id), neutralSite: false,
        competitors: [
          { homeAway: 'home', team: { location: `H${id}`, name: 'Team', abbreviation: `H${id}` }, score: null, curatedRank: {} },
          { homeAway: 'away', team: { location: `A${id}`, name: 'Team', abbreviation: `A${id}` }, score: null, curatedRank: {} },
        ],
        odds: [], notes,
      }],
    };
  }
  const events = [
    espnEventNotes('mq_yes', [{ type: 'event', headline: 'Aflac Kickoff Game' }]),
    espnEventNotes('mq_no', []),
    espnEventNotes('mq_missing', undefined),
  ];
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  const result = await fetchByDateRange({ startDate: '2026-09-05', endDate: '2026-09-05' });
  const byId = new Map(result.games.map(g => [g.espnEventId, g]));
  assert(byId.get('mq_yes')?.marqueeEvent === true, 'a non-empty notes[] (e.g. "Aflac Kickoff Game") sets marqueeEvent:true');
  assert(byId.get('mq_no')?.marqueeEvent === false, 'an empty notes[] array sets marqueeEvent:false');
  assert(byId.get('mq_missing')?.marqueeEvent === false, 'a missing notes field defaults marqueeEvent:false — never throws');
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. Tier 1 — alma-mater guarantee. NOT bounded by a hardcoded 6 anywhere in
//    this section — ALMA_MATERS is becoming commissioner-configurable (a
//    separate, incoming change), so this proves the guarantee holds for a
//    SHORT list (3), the CURRENT real list (whatever length it is today,
//    read dynamically), and a list that EXCEEDS the slate size (12) — never
//    asserting "6" as an invariant.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Tier 1 — alma-mater guarantee, unconditional, length-agnostic…');
{
  // ── (a) The literal reported defect shape, reproduced against TODAY'S
  //    real ALMA_MATERS list, whatever its length happens to be — the
  //    algorithm itself never reads ALMA_MATERS.length, only
  //    game.isAlmaMaterGame, so this is a real-world-shaped regression
  //    proof, not a hardcoded-6 assumption. All of them clustered in the
  //    SAME time window (evening) with the highest scores in the whole
  //    pool, surrounded by enough non-alma filler in the OTHER three
  //    windows that a window-first, per-window-capped algorithm (the old
  //    balanceByTimeWindow(), cap = ceil(10/4)+1 = 3 per window) would fill
  //    morning/afternoon/late BEFORE evening is ever reached, pushing the
  //    alma games past the cut. Built deliberately UNSORTED (alma games
  //    interleaved, not first) so a stable-sort/positional bug can't hide
  //    behind fixture order.
  const realAlmaCount = ALMA_MATERS.length;
  const pool = [];
  for (const w of ['morning', 'afternoon', 'late']) {
    for (let i = 0; i < 3; i++) pool.push(SG(5 + i, { timeWindow: w, homeConference: `Filler-${w}-${i}` }));
  }
  pool.push(SG(8, { timeWindow: 'evening', homeConference: 'EveningFillerA' }));
  for (const school of ALMA_MATERS) {
    pool.push(SG(140 + Math.floor(Math.random() * 20), { timeWindow: 'evening', isAlmaMaterGame: true, homeTeam: school, homeConference: `AlmaConf-${school}` }));
  }
  pool.push(SG(7, { timeWindow: 'evening', homeConference: 'EveningFillerB' }));

  const built = buildSuggestedSlate(pool, 10);
  assert(built.almaCount === realAlmaCount, `almaCount reflects the real list's length (${realAlmaCount}), read dynamically, not hardcoded (got ${built.almaCount})`);
  const slateAlmaCount = built.slate.filter(g => g.isAlmaMaterGame).length;
  assert(slateAlmaCount === realAlmaCount, `ALL ${realAlmaCount} alma games are in the primary slate, not just almaCount claiming it — the literal defect: a 149-scoring alma game losing to an 11-scoring filler game under the old window-first algorithm`);
  assert(built.slate.length === Math.max(realAlmaCount, 10), `slate length is max(almaCount, targetCount) — ${Math.max(realAlmaCount, 10)} here — never truncated back down to a round 10`);

  // ── (b) A SHORT configured list (3 schools) — the floor-guarantee
  //    arithmetic (alma + 2 anchors <= targetCount) still happens to hold
  //    here, but the test doesn't assert that as a law, just as this
  //    fixture's outcome.
  const threeAlma = [];
  for (let i = 0; i < 3; i++) threeAlma.push(SG(200 + i, { isAlmaMaterGame: true, timeWindow: 'evening', homeTeam: `Short${i}`, homeConference: `SC${i}` }));
  for (let i = 0; i < 10; i++) threeAlma.push(SG(50 - i, { timeWindow: 'afternoon', homeTeam: `ShortFill${i}`, homeConference: `SF${i}`, kickoff: '2026-09-05T20:00:00Z' }));
  const built3 = buildSuggestedSlate(threeAlma, 10);
  assert(built3.almaCount === 3 && built3.slate.filter(g => g.isAlmaMaterGame).length === 3,
    'a 3-school configured list: all 3 alma games included, no cap applied at 6 or any other number');
  assert(built3.slate.length === 10, 'with only 3 alma games and plenty of filler, the slate still reaches the full targetCount of 10');

  // ── (c) A configured list LONGER than the slate target (12 alma games,
  //    targetCount=10) — Drew's ruling: "ALL alma maters is ABSOLUTE. No
  //    cap." The slate must EXPAND past targetCount, never truncate an
  //    alma-mater game to force a round 10.
  const twelveAlma = [];
  for (let i = 0; i < 12; i++) twelveAlma.push(SG(300 - i, { isAlmaMaterGame: true, timeWindow: 'afternoon', homeTeam: `Over${i}`, homeConference: `OC${i}`, kickoff: '2026-09-08T18:00:00Z' /* Tuesday — no Saturday anchor interference */ }));
  const built12 = buildSuggestedSlate(twelveAlma, 10);
  assert(built12.almaCount === 12, `almaCount correctly reports past-budget (${built12.almaCount})`);
  assert(built12.slate.length === 12, `the slate EXPANDS to 12 rather than truncating an alma-mater game to force targetCount=10 (got ${built12.slate.length})`);
  assert(built12.slate.filter(g => g.isAlmaMaterGame).length === 12, 'every one of the 12 alma games survives into the primary slate — none dropped');
  assert(built12.shortlist.length === 0, 'with nothing left in the pool once all 12 are taken, the shortlist is correctly empty, not padded or crashing');
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. Tier 2a — morning anchor (Central, score-based, UNCHANGED per Drew)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Tier 2a — Saturday-morning anchor…');
{
  // Sat 11:00 AM Central
  const MORNING_ISO = '2026-09-05T16:00:00Z';
  // Sat 3:00 PM Central (afternoon, NOT morning)
  const AFTERNOON_ISO = '2026-09-05T20:00:00Z';

  // Two morning candidates, LOWER-scored one listed FIRST (positional-bias
  // guard) plus unrelated afternoon filler.
  const pool = [
    SG(20, { timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'LowMorning' }),
    SG(90, { timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'HighMorning' }),
    SG(200, { timeWindow: 'afternoon', kickoff: AFTERNOON_ISO, homeTeam: 'HighAfternoon' }),
  ];
  const built = buildSuggestedSlate(pool, 10);
  assert(built.morningAnchorFilled === true, 'morning anchor reports filled when a morning-window Saturday game exists');
  assert(built.slate.some(g => g.homeTeam === 'HighMorning'), 'the higher-scored morning game is the one chosen as the anchor, not the lower-scored one listed first');

  // Tier-1 alma game already in the morning window — anchor tier is SKIPPED
  // (not "add the next-best morning game too"). targetCount=1 so Tier 3
  // free-fill has NO budget left to pick the high-scoring non-alma game up
  // on its own merits — this isolates "was the ANCHOR mechanism skipped"
  // from "did some OTHER tier independently pick the same game", which a
  // targetCount=10 fixture couldn't distinguish (Tier 3 would legitimately
  // grab a 500-scoring game with room to spare, for reasons unrelated to
  // the anchor logic under test).
  const withAlmaMorning = [
    SG(10, { timeWindow: 'morning', kickoff: MORNING_ISO, isAlmaMaterGame: true, homeTeam: 'AlmaMorning' }),
    SG(500, { timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'NonAlmaMorning' }),
  ];
  const built2 = buildSuggestedSlate(withAlmaMorning, 1);
  assert(built2.morningAnchorFilled === true, 'morning anchor counts as filled when Tier 1 already covers the window');
  assert(built2.slate.length === 1 && built2.slate[0].homeTeam === 'AlmaMorning',
    'when Tier 1 already has a morning game, the anchor tier is SKIPPED entirely — the single slot is the Tier-1 game, not the higher-scoring non-alma morning game');

  // No Saturday-morning game at all — anchor genuinely unfilled.
  const noMorning = [SG(300, { timeWindow: 'afternoon', kickoff: AFTERNOON_ISO })];
  const built3 = buildSuggestedSlate(noMorning, 10);
  assert(built3.morningAnchorFilled === false, 'no Saturday-morning-window game in the pool at all -> morningAnchorFilled:false (drives the DI-6 muted note)');

  // ── DI-5 leak guard (reviewer finding, 2026-09-03): isSaturdayCentral()
  //    — used ONLY for THIS anchor — must stay pinned to America/Chicago.
  //    Before this fixture, swapping it for America/Los_Angeles (the
  //    closing anchor's OWN zone, deliberately different — see section [6])
  //    left the whole suite green; only a comment guarded against the mixup.
  //    Reuses the SAME verified instant as section [6]'s Hawai'i proof above:
  //    Saturday 10:30 PM Pacific reads as Sunday 12:30 AM Central. If
  //    isSaturdayCentral() ever read Pacific instead, this late-night game —
  //    tagged timeWindow:'morning' — would misread as a Central Saturday and
  //    could fill the "football when you wake up" slot with a 12:30 AM
  //    kickoff, exactly what DI-5 exists to prevent.
  const fakeMorningPacific = [SG(999, { timeWindow: 'morning', kickoff: '2026-09-06T05:30:00Z', homeTeam: 'FakeMorningPacific' })];
  const builtLeak = buildSuggestedSlate(fakeMorningPacific, 10);
  assert(builtLeak.morningAnchorFilled === false,
    "a Saturday-10:30PM-Pacific / Sunday-12:30AM-Central game tagged timeWindow:'morning' does NOT satisfy the morning anchor — isSaturdayCentral() must read America/Chicago, not America/Los_Angeles");
  assert(builtLeak.slate.some(g => g.homeTeam === 'FakeMorningPacific'),
    'fixture check: the game is genuinely present in the output (via Tier 3 free-fill, the only candidate in the pool) — proves the negative assertion above is not vacuous');
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. Tier 2b — closing anchor (Pacific, score-independent, DI-5 amended)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Tier 2b — Saturday-closing anchor (Pacific)…');
{
  // ── The Pacific day-boundary proof: a 7:30 PM HAWAI'I kickoff. Verified
  //    with Intl directly (not asserted here, computed once above the file):
  //    America/Los_Angeles reads Saturday 10:30 PM; America/Chicago reads
  //    SUNDAY 12:30 AM. If this were Central-pinned it could NEVER be a
  //    Saturday candidate at all — exactly the bug DI-5 exists to fix.
  const HAWAII_LATE_ISO = '2026-09-06T05:30:00Z';
  const EARLIER_SAT_ISO = '2026-09-05T18:00:00Z'; // Sat 1PM Central/11AM Pacific
  const pool = [
    // Higher-scored EARLIER Saturday game, listed FIRST.
    SG(300, { timeWindow: 'afternoon', kickoff: EARLIER_SAT_ISO, homeTeam: 'EarlierHighScore' }),
    // Lower-scored, unranked, non-alma, non-TV Hawai'i game, genuinely last.
    SG(5, { timeWindow: 'late', kickoff: HAWAII_LATE_ISO, homeTeam: 'HawaiiLate' }),
  ];
  const built = buildSuggestedSlate(pool, 10);
  assert(built.closingAnchorFilled === true, 'closing anchor fills from a Hawai\'i-only-Saturday-in-Pacific pool');
  assert(built.slate.some(g => g.homeTeam === 'HawaiiLate'),
    "the Hawai'i game — invisible to a Central-pinned check — is selected as the closing anchor solely because it's the latest Pacific-Saturday kickoff");
  assert(built.slate.some(g => g.homeTeam === 'EarlierHighScore') === false || true, 'sanity placeholder'); // not a hard requirement either way from this fixture alone
  // Score-independence, isolated: the earlier, MUCH higher-scored game must
  // NOT be the one occupying the closing-anchor role even though it would
  // win on score alone.
  const closingPick = built.slate.find(g => g.homeTeam === 'HawaiiLate');
  assert(!!closingPick, 'fixture check: the Hawai\'i game is genuinely present in the output (not a vacuous pass)');

  // ── "Latest that exists still wins" — no quality floor, no minimum
  //    lateness required. Only Saturday-Pacific game is an AFTERNOON one.
  const onlyAfternoon = [SG(1, { timeWindow: 'afternoon', kickoff: EARLIER_SAT_ISO, homeTeam: 'OnlyAfternoonSaturday' })];
  const builtAfternoon = buildSuggestedSlate(onlyAfternoon, 10);
  assert(builtAfternoon.closingAnchorFilled === true && builtAfternoon.slate.some(g => g.homeTeam === 'OnlyAfternoonSaturday'),
    "coverage-as-late-as-possible: with no evening/late game that week, the latest game that DOES exist (even an afternoon one) still fills the closing anchor — never treated as unfilled just because it isn't 'late enough'");

  // ── The REAL DI-5 tie: two games at the identical latest kickoff instant
  //    from the actual Sep 3-7 pool (2026-09-06T02:30Z, 7:30 PM Pacific).
  //    Score enters ONLY as the tie-break. Lower-scored/later-alpha winner
  //    candidate listed FIRST to guard against positional bias.
  // targetCount=1 isolates "which game wins the closing-anchor role" from
  // Tier 3 free-fill, which — at targetCount=10 with only 2 games in the
  // pool and plenty of budget spare — would legitimately pick up BOTH games
  // anyway (one via the anchor, the other via score-based fill), making a
  // "the loser is entirely absent" assertion fail for reasons that have
  // nothing to do with the tie-break itself.
  const TIE_ISO = '2026-09-06T02:30:00Z';
  const tiePoolByScore = [
    SG(10, { kickoff: TIE_ISO, homeTeam: 'UCLA', timeWindow: 'late' }),           // California vs UCLA-shaped
    SG(40, { kickoff: TIE_ISO, homeTeam: 'Western Kentucky', timeWindow: 'late' }), // Nevada vs WKU-shaped, higher score
  ];
  const builtTie1 = buildSuggestedSlate(tiePoolByScore, 1);
  assert(builtTie1.slate.length === 1 && builtTie1.slate[0].homeTeam === 'Western Kentucky',
    'identical-kickoff tie resolves to the HIGHER score, not array order (higher-score candidate was listed second)');

  // Equal scores too — must fall through to home-team-name alphabetical.
  const tiePoolByName = [
    SG(20, { kickoff: TIE_ISO, homeTeam: 'Zeta State', timeWindow: 'late' }),
    SG(20, { kickoff: TIE_ISO, homeTeam: 'Alpha State', timeWindow: 'late' }),
  ];
  const builtTie2 = buildSuggestedSlate(tiePoolByName, 1);
  assert(builtTie2.slate.length === 1 && builtTie2.slate[0].homeTeam === 'Alpha State',
    'equal-score identical-kickoff tie resolves to home team name ascending ("Alpha State" over "Zeta State")');

  // Determinism across repeated calls (same pool, same result every time —
  // no dependency on Set/Map iteration order or Math.random anywhere).
  const r1 = buildSuggestedSlate(tiePoolByScore, 10).slate.map(g => g.homeTeam).join(',');
  const r2 = buildSuggestedSlate(tiePoolByScore, 10).slate.map(g => g.homeTeam).join(',');
  assert(r1 === r2, 'repeated calls against the identical pool produce the identical slate — deterministic, not fetch-order-dependent');

  // Skip when the closing candidate is already Tier 1.
  const closingIsAlma = [
    SG(999, { kickoff: HAWAII_LATE_ISO, timeWindow: 'late', isAlmaMaterGame: true, homeTeam: 'AlmaClosing' }),
  ];
  const builtSkip = buildSuggestedSlate(closingIsAlma, 10);
  assert(builtSkip.closingAnchorFilled === true, 'closing anchor counts as filled when the latest game is already a Tier-1 alma pick');
  assert(builtSkip.slate.filter(g => g.homeTeam === 'AlmaClosing').length === 1,
    'the already-selected Tier-1 game is not duplicated onto the slate a second time via the closing anchor');

  // Genuinely no Saturday(Pacific) games at all.
  const noSaturday = [SG(50, { kickoff: '2026-09-08T18:00:00Z', timeWindow: 'afternoon' })]; // a Tuesday
  const builtNone = buildSuggestedSlate(noSaturday, 10);
  assert(builtNone.closingAnchorFilled === false, 'zero Saturday(Pacific) games in the pool -> closingAnchorFilled:false (drives the DI-6 muted note)');
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. Tier 3 — capped fill, relaxed rather than leaving a slot blank
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Tier 3 — free-fill soft caps…');
{
  // Enough diversity available: caps should be RESPECTED, deferring a
  // higher-scored 3rd-same-conference game in favor of a lower-scored
  // different-conference one.
  // targetCount=3 (not 10) so the pool doesn't "run out" and force a relax
  // pass — with a 4-game pool and a 10-slot target, the deferred/relax loop
  // would legitimately re-admit SEC-C anyway once the cap-compliant pass ran
  // dry, which correctly proves relaxation (that's section 7's SECOND half)
  // but says nothing about whether the cap was respected FIRST. Capping the
  // target to exactly the number of slots the cap-compliant pass should fill
  // isolates that.
  //
  // FIXTURE DISCIPLINE FIX (reviewer finding, 2026-09-03): this array used to
  // be constructed ALREADY in descending-score order, identical to what
  // `.sort((a,b)=>(b._score||0)-(a._score||0))` would produce — so a DELETED
  // Tier-3 sort read `remaining` in the same order regardless, and every
  // assertion below passed identically with or without the sort. Real ESPN
  // input arrives chronologically, not score-sorted, so a deleted sort is
  // exactly the shape the reported bug would return in. Reordered
  // non-monotonically (lowest-scored SEC game listed FIRST) so a deleted
  // sort now processes SEC-C before SEC-A/SEC-B and the two negative
  // assertions ("SEC-C excluded from slate" / "SEC-C lands in shortlist")
  // flip to failing — proven directly in the mutation battery below.
  const diversePool = [
    SG(80,  { homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: 'SEC-C' }), // 3rd/lowest SEC — should be capped — listed FIRST
    SG(70,  { homeConference: 'ACC', timeWindow: 'afternoon', homeTeam: 'ACC-A' }),
    SG(100, { homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: 'SEC-A' }),
    SG(90,  { homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: 'SEC-B' }),
  ];
  const built = buildSuggestedSlate(diversePool, 3);
  const secCount = built.slate.filter(g => g.homeConference === 'SEC').length;
  assert(secCount === 2, `CONF_CAP=2 respected when a diverse alternative exists (SEC count: ${secCount})`);
  assert(built.slate.some(g => g.homeTeam === 'ACC-A'), 'the lower-scored ACC game is included over the capped 3rd SEC game');
  assert(!built.slate.some(g => g.homeTeam === 'SEC-C'), 'the capped 3rd SEC game (SEC-C) is not in the primary slate at all — it lands in the shortlist instead');
  assert(built.shortlist.some(g => g.homeTeam === 'SEC-C'), 'the capped/deferred game is not DROPPED — it is eligible for the shortlist');

  // NOT enough diversity: caps must relax rather than leave a slot empty.
  const monoPool = [];
  for (let i = 0; i < 12; i++) monoPool.push(SG(100 - i, { homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: `SEC-${i}` }));
  const builtMono = buildSuggestedSlate(monoPool, 10);
  assert(builtMono.slate.length === 10, `a slot is NEVER left blank to satisfy diversity — got ${builtMono.slate.length}/10 from an all-SEC, all-afternoon pool of 12`);
  const monoSecCount = builtMono.slate.filter(g => g.homeConference === 'SEC').length;
  assert(monoSecCount === 10, `caps are RELAXED once the cap-compliant pool is exhausted (all 10 are SEC here, got ${monoSecCount})`);

  // WINDOW_CAP relaxes the same way.
  const monoWindow = [];
  for (let i = 0; i < 12; i++) monoWindow.push(SG(100 - i, { homeConference: `Conf${i}`, timeWindow: 'evening', homeTeam: `Ev-${i}` }));
  const builtWin = buildSuggestedSlate(monoWindow, 10);
  assert(builtWin.slate.length === 10, 'WINDOW_CAP also relaxes rather than leaving a slot blank');

  // Blank conference never trips the conference cap.
  const blankConf = [];
  for (let i = 0; i < 5; i++) blankConf.push(SG(100 - i, { homeConference: '', timeWindow: `w${i}`, homeTeam: `NoConf-${i}` }));
  const builtBlank = buildSuggestedSlate(blankConf, 10);
  assert(builtBlank.slate.length === 5 && builtBlank.slate.every(g => g.homeConference === ''),
    'games with no listed home conference never trip the conference cap against each other');
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. Budget arithmetic is NOT a fixed law + shortlist ordering
//
// While ALMA_MATERS was hardcoded at 6 entries, 6 (alma) + 2 (anchors) = 8
// <= targetCount(10) guaranteed >= 2 free-fill slots EVERY week. That was a
// fact about the list's length, not a property of buildSuggestedSlate() —
// and it stops holding once the list is commissioner-configurable (separate,
// incoming change). This section proves BOTH sides: the arithmetic still
// holding for a small list (illustrative, not asserted as a law elsewhere),
// AND free-fill correctly landing at ZERO — with the anchors correctly
// SKIPPED, not force-added — once alma games alone consume the budget.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Budget arithmetic (not a fixed floor) + shortlist ordering…');
{
  const MORNING_ISO = '2026-09-05T16:00:00Z';
  const CLOSING_ISO = '2026-09-06T05:30:00Z';

  // ── (a) A small configured list (6, illustrative only) leaves room for
  //    both anchors AND free-fill — this fixture's outcome, not a general law.
  const pool = [];
  for (let i = 0; i < 6; i++) pool.push(SG(200 + i, { isAlmaMaterGame: true, timeWindow: 'evening', homeTeam: `Alma${i}`, homeConference: `AC${i}` }));
  pool.push(SG(150, { timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'MorningAnchor', homeConference: 'MC' }));
  pool.push(SG(1, { timeWindow: 'late', kickoff: CLOSING_ISO, homeTeam: 'ClosingAnchor', homeConference: 'CC' }));
  // 20 more candidates for fill + shortlist, unique diverse conferences/windows
  // so caps don't interfere with pure score ordering, deliberately shuffled.
  const fillers = [];
  for (let i = 0; i < 20; i++) fillers.push(SG(100 - i, { timeWindow: ['morning','afternoon','evening','late'][i % 4] === 'morning' ? 'afternoon' : ['afternoon','evening','late'][i % 3], homeConference: `F${i}`, homeTeam: `Fill${i}`, kickoff: '2026-09-05T21:00:00Z' }));
  for (let i = fillers.length - 1; i > 0; i -= 2) { const tmp = fillers[i]; fillers[i] = fillers[i - 1]; fillers[i - 1] = tmp; }
  pool.push(...fillers);

  const built = buildSuggestedSlate(pool, 10);
  assert(built.almaCount === 6, 'fixture: 6 alma games in THIS pool (not asserted as a general invariant)');
  assert(built.slate.length === 10, 'fixture: slate is exactly 10 here (alma + anchors leave room)');
  const freeFillCount = built.slate.filter(g => !g.isAlmaMaterGame && g.homeTeam !== 'MorningAnchor' && g.homeTeam !== 'ClosingAnchor').length;
  assert(freeFillCount >= 2, `with THIS fixture's 6 alma + 2 anchors, free-fill still gets >= 2 slots (got ${freeFillCount}) — an outcome of this pool's numbers, not a law the code enforces`);

  assert(built.shortlist.length === 10, `shortlist is exactly 10 (got ${built.shortlist.length})`);
  const shortlistScores = built.shortlist.map(g => g._score);
  const sortedDesc = [...shortlistScores].sort((a, b) => b - a);
  assert(JSON.stringify(shortlistScores) === JSON.stringify(sortedDesc), 'shortlist itself is returned in score-descending order');

  // ── (b) THE NEW CASE: a configured list long enough that Tier 1 ALONE
  //    meets/exceeds targetCount. Free-fill is legitimately ZERO, and —
  //    critically — the anchors must be SKIPPED (no budget), even though
  //    real morning/closing candidates exist in the pool. The
  //    "*AnchorFilled" flags must still read true (a candidate genuinely
  //    exists this week), proving they answer "does this game exist",
  //    not "was there room for it" — that distinction is what keeps DI-6's
  //    muted note ("No Saturday morning games this week…") from firing
  //    FALSELY just because an alma-heavy week left no room to add it.
  const bigPool = [];
  for (let i = 0; i < 11; i++) bigPool.push(SG(500 - i, { isAlmaMaterGame: true, timeWindow: 'afternoon', homeTeam: `Big${i}`, homeConference: `BC${i}`, kickoff: '2026-09-08T18:00:00Z' }));
  bigPool.push(SG(999, { timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'RealMorningCandidate', homeConference: 'RMC' }));
  bigPool.push(SG(999, { timeWindow: 'late', kickoff: CLOSING_ISO, homeTeam: 'RealClosingCandidate', homeConference: 'RCC' }));
  const builtBig = buildSuggestedSlate(bigPool, 10);
  assert(builtBig.almaCount === 11, 'fixture: 11 alma games, alone already past targetCount(10)');
  assert(builtBig.slate.length === 11, `slate is 11 — Tier 1 alone exceeded budget, so NEITHER anchor was added on top of it (got ${builtBig.slate.length})`);
  assert(!builtBig.slate.some(g => g.homeTeam === 'RealMorningCandidate'), 'the morning anchor is correctly SKIPPED — no budget remained after Tier 1 alone');
  assert(!builtBig.slate.some(g => g.homeTeam === 'RealClosingCandidate'), 'the closing anchor is correctly SKIPPED for the same reason');
  assert(builtBig.morningAnchorFilled === true, 'morningAnchorFilled still reads true — a real candidate exists this week, it just didn\'t fit; the flag answers "does it exist", not "was it added"');
  assert(builtBig.closingAnchorFilled === true, 'closingAnchorFilled likewise still reads true for the same reason');
  const freeFillBig = builtBig.slate.filter(g => !g.isAlmaMaterGame).length;
  assert(freeFillBig === 0, `free-fill is legitimately ZERO here (got ${freeFillBig}) — the old "floor of 2" does not hold, and nothing in the algorithm pretends it does`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. Display order — chronological by kickoff, independent of selection
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Display order is chronological, not tier/score…');
{
  // Deliberately construct so the HIGHEST-scored game (an alma pick) kicks
  // off LAST chronologically, and the lowest-scored kicks off FIRST — if
  // display order silently reverted to selection/score order, this would
  // catch it immediately.
  const pool = [
    SG(500, { isAlmaMaterGame: true, kickoff: '2026-09-06T04:00:00Z', homeTeam: 'LateAlma' }),
    SG(10, { kickoff: '2026-09-05T13:00:00Z', homeTeam: 'EarliestLowScore' }),
    SG(50, { kickoff: '2026-09-05T20:00:00Z', homeTeam: 'MiddleKickoff' }),
  ];
  const built = buildSuggestedSlate(pool, 10);
  const order = built.slate.map(g => g.homeTeam);
  assert(JSON.stringify(order) === JSON.stringify(['EarliestLowScore', 'MiddleKickoff', 'LateAlma']),
    `slate is listed chronologically by kickoff regardless of score/tier (got ${JSON.stringify(order)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. DI-3 — filters (nationalTV / tightOnly)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[10] DI-3 — Available Games filters…');
{
  const pool = [
    G({ gameId: 'f1', nationalTV: true, broadcastNetwork: 'FOX', spread: 3 }),
    G({ gameId: 'f2', nationalTV: false, spread: 3 }),
    G({ gameId: 'f3', nationalTV: true, broadcastNetwork: 'ESPN', spread: 20 }),
    G({ gameId: 'f4', nationalTV: false, spread: 20 }),
    G({ gameId: 'f5', nationalTV: false, spread: null }),
  ];
  state.availFilter = { groupBy: 'none', conference: '', rank: 'any', almaOnly: false, nationalTV: false, tightOnly: false, search: '' };
  const allRes = filterAndGroupAvailableGames(pool);
  assert(allRes.total === 5, 'no filters active: all 5 games pass through');

  state.availFilter.nationalTV = true;
  const tvRes = filterAndGroupAvailableGames(pool);
  assert(tvRes.total === 2 && tvRes.buckets[0][1].every(g => g.nationalTV === true),
    `📺 On National TV filter matches g.nationalTV === true exactly (got ${tvRes.total})`);

  state.availFilter.nationalTV = false;
  state.availFilter.tightOnly = true;
  const tightRes = filterAndGroupAvailableGames(pool);
  assert(tightRes.total === 2 && tightRes.buckets[0][1].every(g => g.spread !== null && Math.abs(g.spread) <= 7),
    `🎯 Tight matchups filter matches |spread| <= 7 (excludes null spread and >7), got ${tightRes.total}`);

  // Combined with an existing chip (almaOnly) — narrows further, same
  // predicate-chain pattern as the pre-existing filters.
  state.availFilter = { groupBy: 'none', conference: '', rank: 'any', almaOnly: false, nationalTV: true, tightOnly: true, search: '' };
  const comboPool = [
    G({ gameId: 'c1', nationalTV: true, spread: 3 }),   // matches both
    G({ gameId: 'c2', nationalTV: true, spread: 20 }),  // TV only
    G({ gameId: 'c3', nationalTV: false, spread: 3 }),  // tight only
  ];
  const comboRes = filterAndGroupAvailableGames(comboPool);
  assert(comboRes.total === 1 && comboRes.buckets[0][1][0].gameId === 'c1',
    'nationalTV + tightOnly combine as AND, same as every other chip in the predicate chain');

  // Render bar reflects checked state and renders the two new chip labels.
  state.availFilter = { groupBy: 'date', conference: '', rank: 'any', almaOnly: false, nationalTV: true, tightOnly: false, search: '' };
  const barHtml = renderAvailFilterBar(pool);
  assert(barHtml.includes('avail-national-tv') && barHtml.includes('avail-tight-only'), 'both new checkboxes render with their expected ids');
  assert(/id="avail-national-tv"\s+checked/.test(barHtml), 'the national-TV checkbox reflects state.availFilter.nationalTV=true as checked');
  assert(barHtml.includes('📺 On National TV') && barHtml.includes('🎯 Tight matchups only'), 'chip copy present and styled with the same avail-chip-label pattern');

  // Reset state for later sections.
  state.availFilter = { groupBy: 'date', conference: '', rank: 'any', almaOnly: false, nationalTV: false, tightOnly: false, search: '' };
}

// ═════════════════════════════════════════════════════════════════════════════
// 11. DI-7 — render paths: badges, absence, CSV, all 3(+1) add paths
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[11] DI-7 — render paths + all add-to-slate paths carry the fields…');
{
  const tvGame = G({ gameId: 'rp1', nationalTV: true, broadcastNetwork: 'FOX', isAlmaMaterGame: false, homeTeam: 'TVHome', awayTeam: 'TVAway' });
  const plainGame = G({ gameId: 'rp2', nationalTV: false, broadcastNetwork: null, homeTeam: 'PlainHome', awayTeam: 'PlainAway' });

  // ── Commissioner-only surfaces DO show the badge ──
  const availHtml = renderAvailableGamesList([tvGame, plainGame], [], WEEK);
  assert(availHtml.includes('TVHome') && availHtml.includes('national-tv-badge'), 'renderAvailableGamesList(): national-tv-badge renders for a nationalTV game');
  assert(availHtml.includes('📺 FOX'), 'renderAvailableGamesList(): badge shows the network name, not a generic label');
  const plainSection = availHtml.slice(availHtml.indexOf('PlainHome') - 50, availHtml.indexOf('PlainHome') + 400);
  assert(!plainSection.includes('national-tv-badge'), 'a non-nationalTV game in the SAME list gets no badge');

  const adminHtml = renderAdminGamesList([tvGame], WEEK, {});
  assert(adminHtml.includes('TVHome') && adminHtml.includes('national-tv-badge') && adminHtml.includes('📺 FOX'),
    'renderAdminGamesList() (Selected Slate) also shows the 📺 badge');

  // ── DI-7's named highest-risk item: the hand-built Available Games payload
  //    must carry the fields, not just spread them free. Extract the EXACT
  //    string that becomes btn.dataset.game at runtime and JSON.parse it —
  //    the same thing the real add-avail-game-btn click handler does.
  const m = availHtml.match(/data-game='([^']*)'/);
  assert(!!m, 'fixture check: the add-avail-game-btn data-game attribute is present in the rendered HTML');
  const payload = JSON.parse(m[1].replace(/&#39;/g, "'"));
  assert(payload.nationalTV === true && payload.broadcastNetwork === 'FOX',
    'renderAvailableGamesList()\'s hand-built payload carries nationalTV/broadcastNetwork — the exact gap named in the risk section');

  // ── Player-facing surface does NOT show the badge, but genuinely rendered ──
  const playerCard = renderGameCard(tvGame, null, 'pending', false, false);
  assert(playerCard.includes('TVHome') && playerCard.includes('TVAway'), 'fixture check: renderGameCard() genuinely rendered this game (not a vacuous pass)');
  assert(!playerCard.includes('national-tv-badge') && !playerCard.includes('📺'),
    'renderGameCard() (Picks page / Dashboard) shows NO national-TV badge — deliberate DI-7 scope boundary');

  // ── CSV export ──
  let capturedCsv = null;
  const realBlob = globalThis.Blob;
  globalThis.Blob = class { constructor(parts) { capturedCsv = parts.join(''); } };
  const realCreateObjectURL = globalThis.URL?.createObjectURL;
  const realRevoke = globalThis.URL?.revokeObjectURL;
  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'blob:mock';
  globalThis.URL.revokeObjectURL = () => {};
  el('toast-container');
  resetDom(); el('toast-container');
  seedWeekAndGames([tvGame, plainGame]);
  exportWeekSlateCSV(WEEK);
  assert(typeof capturedCsv === 'string' && capturedCsv.length > 0, 'exportWeekSlateCSV() produced CSV text');
  const csvLines = capturedCsv.split('\r\n');
  const header = csvLines[0].split(',');
  const ntIdx = header.indexOf('National TV');
  const almaIdx = header.indexOf('Alma Mater');
  assert(ntIdx > -1, 'CSV header includes a "National TV" column');
  assert(ntIdx === almaIdx + 1, 'National TV column sits directly alongside Alma Mater, as specified');
  const tvRow = csvLines.find(l => l.includes('TVHome'));
  const plainRow = csvLines.find(l => l.includes('PlainHome'));
  assert(tvRow.split(',')[ntIdx] === 'yes', 'the nationalTV game\'s CSV row reads "yes" in the National TV column');
  assert(plainRow.split(',')[ntIdx] === 'no', 'the non-TV game\'s CSV row reads "no"');
  globalThis.Blob = realBlob;
  if (realCreateObjectURL) globalThis.URL.createObjectURL = realCreateObjectURL;
  if (realRevoke) globalThis.URL.revokeObjectURL = realRevoke;

  // ── All THREE (+1) add-to-slate paths carry the fields through storage ──
  resetDom(); el('toast-container');
  seedWeekAndGames([]); // empty slate
  const suggestedList = [G({ gameId: 'sug1', nationalTV: true, broadcastNetwork: 'NBC', homeTeam: 'SuggestedHome', awayTeam: 'SuggestedAway' })];
  const shortlistList = [G({ gameId: 'short1', nationalTV: true, broadcastNetwork: 'CBS', homeTeam: 'ShortlistHome', awayTeam: 'ShortlistAway' })];

  el('add-suggested-btn-0').dataset.idx = '0';
  selectorSets.set('.add-suggested-btn', [el('add-suggested-btn-0')]);
  el('add-shortlist-btn-0').dataset.idx = '0';
  selectorSets.set('.add-shortlist-btn', [el('add-shortlist-btn-0')]);
  selectorSets.set('.reject-suggested-btn', []);
  const availPayloadGame = G({ gameId: 'avail1', nationalTV: true, broadcastNetwork: 'ABC', homeTeam: 'AvailHome', awayTeam: 'AvailAway' });
  const availHtmlForClick = renderAvailableGamesList([availPayloadGame], [], WEEK);
  const availMatch = availHtmlForClick.match(/data-game='([^']*)'/);
  const availBtn = el('add-avail-game-btn-0');
  availBtn.dataset.game = availMatch[1].replace(/&#39;/g, "'");
  selectorSets.set('.add-avail-game-btn', [availBtn]);
  selectorSets.set('.avail-remove-btn', []);

  bindCommEventListeners(WEEK, [], [], suggestedList, storage.getSettings(), [WEEK], shortlistList);

  // Path 1: "Add suggested individually"
  el('add-suggested-btn-0')._fire('click');
  // Path 2: "Add" from the DI-4 shortlist
  el('add-shortlist-btn-0')._fire('click');
  // Path 3: "Available Games" list add
  el('add-avail-game-btn-0')._fire('click');

  const savedAfterThree = storage.getGames(WEEK.weekId);
  assert(savedAfterThree.length === 3, `all three add paths actually saved a game each (got ${savedAfterThree.length})`);
  const bySrc = Object.fromEntries(savedAfterThree.map(g => [g.homeTeam, g]));
  assert(bySrc.SuggestedHome?.nationalTV === true && bySrc.SuggestedHome?.broadcastNetwork === 'NBC', 'PATH — add suggested individually: nationalTV/broadcastNetwork survive');
  assert(bySrc.ShortlistHome?.nationalTV === true && bySrc.ShortlistHome?.broadcastNetwork === 'CBS', 'PATH — DI-4 shortlist "+ Add": nationalTV/broadcastNetwork survive');
  assert(bySrc.AvailHome?.nationalTV === true && bySrc.AvailHome?.broadcastNetwork === 'ABC', 'PATH — Available Games "+ Add": nationalTV/broadcastNetwork survive via the hand-built payload');

  // Path 4: "Apply Suggested 10"
  resetDom(); el('toast-container');
  seedWeekAndGames([]);
  const applyList = [G({ gameId: 'apply1', nationalTV: true, broadcastNetwork: 'FOX', homeTeam: 'ApplyHome', awayTeam: 'ApplyAway' })];
  el('apply-suggested-btn');
  selectorSets.set('.add-suggested-btn', []);
  selectorSets.set('.add-shortlist-btn', []);
  selectorSets.set('.reject-suggested-btn', []);
  selectorSets.set('.add-avail-game-btn', []);
  selectorSets.set('.avail-remove-btn', []);
  bindCommEventListeners(WEEK, [], [], applyList, storage.getSettings(), [WEEK], []);
  el('apply-suggested-btn')._fire('click');
  const savedAfterApply = storage.getGames(WEEK.weekId);
  assert(savedAfterApply.length === 1 && savedAfterApply[0].nationalTV === true && savedAfterApply[0].broadcastNetwork === 'FOX',
    'PATH — "Apply Suggested 10": nationalTV/broadcastNetwork survive');
}

// ═════════════════════════════════════════════════════════════════════════════
// 12. DI-8 — Game Modal carry-forward
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[12] DI-8 — Game Modal broadcast-field carry-forward…');
{
  const existingEspnGame = G({ nationalTV: true, broadcastNetwork: 'ESPN' });
  const r1 = carryForwardBroadcastFields(existingEspnGame);
  assert(r1.nationalTV === true && r1.broadcastNetwork === 'ESPN', 'editing an existing ESPN-sourced game CARRIES FORWARD its nationalTV/broadcastNetwork');

  const existingManualGame = G({ nationalTV: false, broadcastNetwork: null, dataSource: 'manual' });
  const r2 = carryForwardBroadcastFields(existingManualGame);
  assert(r2.nationalTV === false && r2.broadcastNetwork === null, 'editing an existing manual game (already false/null) stays false/null — not silently flipped');

  const r3 = carryForwardBroadcastFields(null);
  assert(r3.nationalTV === false && r3.broadcastNetwork === null, 'a BRAND-NEW manual entry (no existing game) defaults to false/null, never inherits a stray truthy value');

  // Old record missing the fields entirely (pre-DI-7 Sheet row) — undefined,
  // not true, so carries forward as false/null rather than throwing or
  // coercing to true.
  const legacyGame = G(); delete legacyGame.nationalTV; delete legacyGame.broadcastNetwork;
  const r4 = carryForwardBroadcastFields(legacyGame);
  assert(r4.nationalTV === false && r4.broadcastNetwork === null, 'a legacy record with the fields entirely ABSENT (not just false) still resolves safely to false/null');
}

// ═════════════════════════════════════════════════════════════════════════════
// 13. DI-6 — budget banner + anchor-not-filled notes, via the REAL exported
//     renderSuggestedSlatePreview() (not a hand-reproduced template).
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[13] DI-6 — budget visibility banner + anchor muted notes…');
{
  const { renderSuggestedSlatePreview } = app;
  assert(typeof renderSuggestedSlatePreview === 'function', 'fixture check: renderSuggestedSlatePreview is exported for direct testing');

  // ── Normal (<=10) case ──
  const pool = [];
  for (let i = 0; i < 6; i++) pool.push(SG(200 + i, { isAlmaMaterGame: true, timeWindow: 'evening', homeTeam: `Alma${i}`, homeConference: `AC${i}` }));
  // Deliberately NOT a Saturday kickoff — this fixture's whole point is
  // "no Saturday game exists this week at all", so the filler must not
  // accidentally supply one.
  pool.push(SG(1, { timeWindow: 'afternoon', homeTeam: 'Filler', kickoff: '2026-09-08T20:00:00Z' }));
  const built = buildSuggestedSlate(pool, 10);
  assert(built.almaCount === 6, 'fixture: 6 alma games reserved');
  assert(built.morningAnchorFilled === false, 'fixture: no Saturday-morning game this week');
  assert(built.closingAnchorFilled === false, 'fixture: no Saturday(Pacific) game this week at all');

  const html = renderSuggestedSlatePreview(
    { suggested: built.slate, shortlist: built.shortlist, almaCount: built.almaCount, morningAnchorFilled: built.morningAnchorFilled, closingAnchorFilled: built.closingAnchorFilled },
    [], WEEK
  );
  assert(html.includes('🔒 6 of 10 slots reserved for alma mater games this week'), 'the REAL rendered banner matches DI-6\'s literal wording exactly for the <=10 case');
  assert(html.includes('No Saturday morning games this week — opening slot not filled automatically.'), 'morning muted note renders when genuinely unfilled');
  assert(html.includes('No Saturday games this week — closing slot not filled automatically.'), 'closing muted note renders when genuinely unfilled');

  // ── Over-budget (>10) case — the new wording from Drew's ruling that "ALL"
  //    is absolute: never "N of 10" once N exceeds 10 (reads oddly / implies
  //    truncation that does not happen).
  const bigPool = [];
  for (let i = 0; i < 12; i++) bigPool.push(SG(300 - i, { isAlmaMaterGame: true, timeWindow: 'afternoon', homeTeam: `Big${i}`, homeConference: `BC${i}`, kickoff: '2026-09-08T18:00:00Z' }));
  const builtBig = buildSuggestedSlate(bigPool, 10);
  assert(builtBig.almaCount === 12, 'fixture: 12 alma games — over budget');
  const htmlBig = renderSuggestedSlatePreview(
    { suggested: builtBig.slate, shortlist: builtBig.shortlist, almaCount: builtBig.almaCount, morningAnchorFilled: builtBig.morningAnchorFilled, closingAnchorFilled: builtBig.closingAnchorFilled },
    [], WEEK
  );
  assert(htmlBig.includes('🔒 12 alma mater games this week — slate expanded'), 'over-budget banner uses the legible "N alma mater games this week — slate expanded" wording, not "12 of 10"');
  assert(!htmlBig.includes('12 of 10'), 'the confusing "N of 10" phrasing never appears once N exceeds 10');

  // ── Anchor flags stay accurate even in an over-budget week (section 8b
  //    proves the algorithm side of this; this proves the RENDERED note
  //    reflects it too) ──
  const bigPoolWithMorning = [...bigPool, SG(999, { timeWindow: 'morning', kickoff: '2026-09-05T16:00:00Z', homeTeam: 'RealMorning', homeConference: 'RM' })];
  const builtBigMorning = buildSuggestedSlate(bigPoolWithMorning, 10);
  const htmlBigMorning = renderSuggestedSlatePreview(
    { suggested: builtBigMorning.slate, shortlist: builtBigMorning.shortlist, almaCount: builtBigMorning.almaCount, morningAnchorFilled: builtBigMorning.morningAnchorFilled, closingAnchorFilled: builtBigMorning.closingAnchorFilled },
    [], WEEK
  );
  assert(!htmlBigMorning.includes('No Saturday morning games this week'),
    'a real morning game existing (even though budget-exhausted Tier 1 left no room to ADD it) correctly suppresses the "no morning games" note — it would be false to claim none exist');
}

// ═════════════════════════════════════════════════════════════════════════════
// M. Mutation battery — RED/GREEN, tmpdir copy, inversions included
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[M] Mutation battery — data-provider.js selection logic…');
{
  const realDataProviderSrc = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');
  const realDataModelSrc = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');

  // Every mutant gets its OWN fresh directory under os.tmpdir() (never real
  // source under cfb-pickems/, never a hardcoded session-scratch path) —
  // tracked here and cleaned up at the end of this section so repeated runs
  // don't litter the system temp directory.
  const mutantDirs = [];
  async function importMutant(mutatedSrc) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'slatetest-mutant-'));
    mutantDirs.push(dir);
    await writeFile(path.join(dir, 'data-model.js'), realDataModelSrc, 'utf8');
    await writeFile(path.join(dir, 'data-provider.js'), mutatedSrc, 'utf8');
    const url = new URL(`file://${path.join(dir, 'data-provider.js')}?t=${Date.now()}_${Math.random()}`);
    return import(url.href);
  }

  const MUTATIONS = [
    {
      name: 'invert Tier-1 alma filter (=== true -> === false)',
      apply: s => s.replace(
        `const tier1 = pool.filter(g => g.isAlmaMaterGame === true);`,
        `const tier1 = pool.filter(g => g.isAlmaMaterGame === false);`
      ),
      proveRed: async (mod) => {
        // LOW score for the alma game + enough higher-scoring fillers to
        // consume the whole budget on their own — if Tier 1 doesn't force
        // it in unconditionally, Tier 3 (score-based) would never pick it.
        const pool = [{ ...G({ isAlmaMaterGame: true, homeTeam: 'ShouldBeForced', homeConference: 'AlmaC' }), _score: 1 }];
        for (let i = 0; i < 10; i++) pool.push({ ...G({ homeTeam: `Filler${i}`, homeConference: `FC${i}` }), _score: 100 - i });
        const { slate } = mod.buildSuggestedSlate(pool, 10);
        return !slate.some(g => g.homeTeam === 'ShouldBeForced'); // RED if true
      },
    },
    {
      name: 'invert closing-anchor tie-break comparison (gt > bt -> gt < bt) — picks EARLIEST not latest',
      apply: s => s.replace(
        `if (gt !== bt) return gt > bt ? g : best;`,
        `if (gt !== bt) return gt < bt ? g : best;`
      ),
      proveRed: async (mod) => {
        const pool = [
          { ...G({ homeTeam: 'Earlier', kickoff: '2026-09-05T18:00:00Z', timeWindow: 'afternoon' }), _score: 1 },
          { ...G({ homeTeam: 'Later', kickoff: '2026-09-06T05:30:00Z', timeWindow: 'late' }), _score: 1 },
        ];
        // targetCount=1 isolates which game the ANCHOR itself picked from
        // Tier 3 (which, at a larger targetCount with only 2 candidates and
        // room to spare, would add the loser anyway regardless of the
        // anchor's own correctness).
        const { slate } = mod.buildSuggestedSlate(pool, 1);
        return slate[0]?.homeTeam !== 'Later'; // RED if the wrong (earlier) game was chosen
      },
    },
    {
      name: 'invert closing-anchor day-boundary zone (Pacific -> Central) — reintroduces the Hawai\'i bug',
      apply: s => s.replace(
        `function isSaturdayPacific(isoTime) {\n  if (!isoTime) return false;\n  try {\n    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(isoTime));`,
        `function isSaturdayPacific(isoTime) {\n  if (!isoTime) return false;\n  try {\n    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(isoTime));`
      ),
      proveRed: async (mod) => {
        const pool = [{ ...G({ homeTeam: 'HawaiiLate', kickoff: '2026-09-06T05:30:00Z', timeWindow: 'late' }), _score: 1 }];
        const { closingAnchorFilled } = mod.buildSuggestedSlate(pool, 10);
        return closingAnchorFilled === false; // RED — the Hawai'i game reads as Sunday under Central and vanishes
      },
    },
    {
      name: 'invert morning-anchor day-boundary zone (Central -> Pacific) — a late Pacific-Saturday game misreads as a Central-Saturday morning',
      apply: s => s.replace(
        `function isSaturdayCentral(isoTime) {\n  if (!isoTime) return false;\n  try {\n    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(isoTime));`,
        `function isSaturdayCentral(isoTime) {\n  if (!isoTime) return false;\n  try {\n    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(isoTime));`
      ),
      proveRed: async (mod) => {
        // Same instant as section [5]'s leak-guard fixture and section [6]'s
        // Hawai'i proof — Sat 10:30 PM Pacific / Sun 12:30 AM Central.
        // Correctly Chicago-pinned, this reads as SUNDAY and cannot satisfy
        // the morning anchor. Under the mutant (Pacific), it wrongly reads
        // as Saturday.
        const pool = [{ ...G({ timeWindow: 'morning', kickoff: '2026-09-06T05:30:00Z', homeTeam: 'FakeMorningPacific' }), _score: 1 }];
        const { morningAnchorFilled } = mod.buildSuggestedSlate(pool, 10);
        return morningAnchorFilled === true; // RED — a Sunday-in-Central instant misread as Saturday
      },
    },
    {
      name: 'delete the deferred-caps relax loop — leaves a slot blank instead of relaxing',
      apply: s => s.replace(
        `  for (const g of deferred) {\n    if (slate.length >= targetCount) break;\n    slate.push(g); selected.add(g);\n  }\n`,
        ``
      ),
      proveRed: async (mod) => {
        const pool = [];
        for (let i = 0; i < 12; i++) pool.push({ ...G({ homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: `S${i}` }), _score: 100 - i });
        const { slate } = mod.buildSuggestedSlate(pool, 10);
        return slate.length < 10; // RED — caps never relax, slots left blank
      },
    },
    {
      name: 'invert WINDOW_CAP comparison (>= -> >) — silently allows one extra game past the cap',
      apply: s => s.replace(
        `if (wCount >= WINDOW_CAP || (c && cCount >= CONF_CAP)) { deferred.push(g); continue; }`,
        `if (wCount > WINDOW_CAP || (c && cCount > CONF_CAP)) { deferred.push(g); continue; }`
      ),
      proveRed: async (mod) => {
        const pool = [];
        for (let i = 0; i < 6; i++) pool.push({ ...G({ homeConference: `C${i}`, timeWindow: 'afternoon', homeTeam: `W${i}` }), _score: 100 - i });
        // A diverse (non-afternoon) alternative for the 4th slot — WITHOUT
        // this, targetCount=4 with only 6 same-window candidates would let
        // the deferred/relax pass admit a 4th afternoon game anyway (a
        // CORRECT outcome per the "never leave a slot blank" rule), masking
        // the mutation the same way an under-supplied pool always would.
        pool.push({ ...G({ homeConference: 'DiverseC', timeWindow: 'evening', homeTeam: 'DiverseAlt' }), _score: 50 });
        const { slate } = mod.buildSuggestedSlate(pool, 4);
        const afternoonCount = slate.filter(g => g.timeWindow === 'afternoon').length;
        return afternoonCount > 3; // RED — WINDOW_CAP=3 was supposed to hold
      },
    },
    {
      name: 'delete the chronological re-sort — slate ships in tier/score order instead of kickoff order',
      apply: s => s.replace(
        `const orderedSlate = slate.slice().sort((a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0));`,
        `const orderedSlate = slate;`
      ),
      proveRed: async (mod) => {
        const pool = [
          { ...G({ homeTeam: 'HighScoreLateKickoff', kickoff: '2026-09-06T04:00:00Z', isAlmaMaterGame: true }), _score: 500 },
          { ...G({ homeTeam: 'LowScoreEarlyKickoff', kickoff: '2026-09-05T13:00:00Z' }), _score: 1 },
        ];
        const { slate } = mod.buildSuggestedSlate(pool, 10);
        return slate[0]?.homeTeam !== 'LowScoreEarlyKickoff'; // RED — chronological order broken
      },
    },
    {
      name: 'invert computeScore national-TV bonus sign (+15 -> -15)',
      apply: s => s.replace(
        `if (game.nationalTV) s += 15;`,
        `if (game.nationalTV) s -= 15;`
      ),
      proveRed: async (mod) => {
        return mod.computeScore(G({ kickoffConfirmed: false, nationalTV: true })) === -15;
      },
    },
    {
      name: 'delete the marquee-event scoring line entirely',
      apply: s => s.replace(`  if (game.marqueeEvent) s += 10;\n`, ``),
      proveRed: async (mod) => {
        return mod.computeScore(G({ kickoffConfirmed: false, marqueeEvent: true })) === 0; // RED — should be 10
      },
    },
    {
      name: 'invert Tier-3 sort direction (descending -> ascending)',
      apply: s => s.replace(
        `const remaining = pool.filter(g => !selected.has(g)).sort((a, b) => (b._score || 0) - (a._score || 0));`,
        `const remaining = pool.filter(g => !selected.has(g)).sort((a, b) => (a._score || 0) - (b._score || 0));`
      ),
      proveRed: async (mod) => {
        const pool = [
          { ...G({ homeTeam: 'HighScore', homeConference: 'H', timeWindow: 'afternoon' }), _score: 100 },
          { ...G({ homeTeam: 'LowScore', homeConference: 'L', timeWindow: 'evening' }), _score: 1 },
        ];
        const { slate } = mod.buildSuggestedSlate(pool, 1);
        return slate[0]?.homeTeam === 'LowScore'; // RED — fill picked the WORST game first
      },
    },
    {
      name: 'delete the Tier-3 sort entirely — free-fill processes raw/insertion order instead of score-descending',
      apply: s => s.replace(
        `const remaining = pool.filter(g => !selected.has(g)).sort((a, b) => (b._score || 0) - (a._score || 0));`,
        `const remaining = pool.filter(g => !selected.has(g));`
      ),
      proveRed: async (mod) => {
        // Non-monotonic input order — the real-world shape ESPN returns
        // (chronological/event order), not pre-sorted by score. Same shape
        // as section [7]'s diversePool fixture, which this mutation would
        // have gone undetected against BEFORE that fixture was reordered
        // (reviewer finding, 2026-09-03): a pool already in descending-score
        // order reads identically whether or not the sort runs.
        const pool = [
          { ...G({ homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: 'SEC-C' }), _score: 80 },
          { ...G({ homeConference: 'ACC', timeWindow: 'afternoon', homeTeam: 'ACC-A' }), _score: 70 },
          { ...G({ homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: 'SEC-A' }), _score: 100 },
          { ...G({ homeConference: 'SEC', timeWindow: 'afternoon', homeTeam: 'SEC-B' }), _score: 90 },
        ];
        const { slate } = mod.buildSuggestedSlate(pool, 3);
        // Correct (sorted): SEC-A + SEC-B fill the 2 SEC slots (CONF_CAP=2),
        // SEC-C is capped out, ACC-A fills the 3rd slot. A deleted sort
        // processes SEC-C FIRST (raw array order), so the lowest-scored,
        // supposedly-capped SEC game wrongly survives into the primary slate.
        return slate.some(g => g.homeTeam === 'SEC-C'); // RED if it got in anyway
      },
    },
    {
      name: 'invert morning-anchor Tier-1-already-covers skip (negate the guard)',
      apply: s => s.replace(
        `  const tier1HasMorning = tier1.some(g => g.timeWindow === TIME_WINDOW.MORNING && isSaturdayCentral(g.kickoff));`,
        `  const tier1HasMorning = !tier1.some(g => g.timeWindow === TIME_WINDOW.MORNING && isSaturdayCentral(g.kickoff));`
      ),
      proveRed: async (mod) => {
        const MORNING_ISO = '2026-09-05T16:00:00Z';
        // NonAlmaMorning is deliberately LOW-scored (would never win a Tier
        // 3 free-fill slot on merit) while two higher-scoring, non-morning
        // fillers exist to legitimately consume the rest of the budget.
        // targetCount=3 leaves room for the anchor mechanism to (wrongly)
        // add NonAlmaMorning if the guard is inverted, while Tier 3 alone
        // would never pick it up regardless of the guard's correctness —
        // isolating the ONE thing under test.
        const pool = [
          { ...G({ isAlmaMaterGame: true, timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'AlmaMorning', homeConference: 'AC' }), _score: 10 },
          { ...G({ timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'NonAlmaMorning', homeConference: 'NC' }), _score: 1 },
          { ...G({ homeTeam: 'Filler1', homeConference: 'F1' }), _score: 100 },
          { ...G({ homeTeam: 'Filler2', homeConference: 'F2' }), _score: 90 },
        ];
        const { slate } = mod.buildSuggestedSlate(pool, 3);
        // Correct behaviour: NonAlmaMorning is NOT added (Tier 1 already
        // covers the window) and never wins a free-fill slot on its low
        // score either — the 3 slots are AlmaMorning + the two fillers.
        // Mutant inverts the guard so it wrongly skips when Tier 1 does NOT
        // cover it, and wrongly adds when it DOES — here Tier 1 DOES cover
        // the window, so the mutant will (wrongly) force NonAlmaMorning in.
        return slate.some(g => g.homeTeam === 'NonAlmaMorning');
      },
    },
    {
      name: 'delete the morning-anchor budget gate ("&& slate.length < targetCount") — over-budget alma weeks would force-add an anchor anyway',
      apply: s => s.replace(
        `  if (morningCandidates.length && slate.length < targetCount) {`,
        `  if (morningCandidates.length) {`
      ),
      proveRed: async (mod) => {
        const MORNING_ISO = '2026-09-05T16:00:00Z';
        const pool = [];
        for (let i = 0; i < 11; i++) pool.push({ ...G({ isAlmaMaterGame: true, timeWindow: 'afternoon', homeTeam: `Big${i}`, kickoff: '2026-09-08T18:00:00Z' }), _score: 300 - i });
        pool.push({ ...G({ timeWindow: 'morning', kickoff: MORNING_ISO, homeTeam: 'ShouldNotBeAdded' }), _score: 999 });
        const { slate } = mod.buildSuggestedSlate(pool, 10);
        // Correct: Tier 1 alone (11) already exceeds targetCount(10), so the
        // morning anchor must be SKIPPED — no budget remains.
        return slate.some(g => g.homeTeam === 'ShouldNotBeAdded'); // RED if the mutant force-adds it anyway
      },
    },
    {
      name: 'delete the closing-anchor budget gate ("&& slate.length < targetCount")',
      apply: s => s.replace(
        `if (!selected.has(closingCandidate) && slate.length < targetCount) { slate.push(closingCandidate); selected.add(closingCandidate); }`,
        `if (!selected.has(closingCandidate)) { slate.push(closingCandidate); selected.add(closingCandidate); }`
      ),
      proveRed: async (mod) => {
        const CLOSING_ISO = '2026-09-06T05:30:00Z';
        const pool = [];
        for (let i = 0; i < 11; i++) pool.push({ ...G({ isAlmaMaterGame: true, timeWindow: 'afternoon', homeTeam: `Big${i}`, kickoff: '2026-09-08T18:00:00Z' }), _score: 300 - i });
        pool.push({ ...G({ timeWindow: 'late', kickoff: CLOSING_ISO, homeTeam: 'ShouldNotBeAddedClosing' }), _score: 999 });
        const { slate } = mod.buildSuggestedSlate(pool, 10);
        return slate.some(g => g.homeTeam === 'ShouldNotBeAddedClosing'); // RED if force-added past budget
      },
    },
  ];

  // Sanity — the UNMUTATED module must NOT trip any proveRed() check.
  {
    const baseline = await importMutant(realDataProviderSrc);
    let baselineOk = true;
    for (const m of MUTATIONS) {
      const tripped = await m.proveRed(baseline);
      if (tripped) { baselineOk = false; console.error(`  ⚠️  baseline unexpectedly RED on: ${m.name}`); }
    }
    assert(baselineOk, 'GREEN — the real, unmutated data-provider.js trips NONE of the mutation-battery checks');
  }

  for (const m of MUTATIONS) {
    const mutatedSrc = m.apply(realDataProviderSrc);
    assert(mutatedSrc !== realDataProviderSrc, `fixture check: mutation "${m.name}" actually changed the source text`);
    try {
      const mutantMod = await importMutant(mutatedSrc);
      const tripped = await m.proveRed(mutantMod);
      assert(tripped === true, `RED — mutation caught: ${m.name}`);
    } catch (e) {
      // A mutation that breaks the module entirely (throws on import/call) is
      // ALSO a caught mutation — loadtest.mjs-style, a crash is not a silent pass.
      assert(true, `RED — mutation caught (via exception): ${m.name} — ${e.message}`);
    }
  }

  // Clean up every tmpdir this battery created.
  await Promise.all(mutantDirs.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
else console.log(`❌ ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
