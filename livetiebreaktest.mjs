/**
 * CFB Pickems — livetiebreaktest.mjs (D1 / FB-002 / UN-415, PF-415 / DI-515, DI-516, DI-517)
 * ==========================================================================================
 * Drew's request (FB-002): "tiebreaker alma mater automatically calculates without having to press button and auto updates as the scores come in and adjusts the week score summary
 * ranking accordingly". The alma-mater total reached the ranking only when the commissioner pressed Auto-Calc and then Save Tiebreaker. This suite proves the replacement: the total is
 * computed on every device from the scores it already holds (js/live-tiebreak.js), a stored actual still wins, a LIVE game's partial score is provisional and labelled, a final week
 * never re-ranks on a recomputed number, and the Dashboard order moves by itself as a score changes.
 *
 *   [1] liveTiebreakerTotal — the alma-mater rows (none / scheduled / live / final / complete), null-never-0, the precise matcher, the two calc modes, the roster that is passed (frozen at lock),
 *       the multiplier that is NEVER applied, the designated-game rows (the NFL), 'manual', and PARITY with scoring.js calculateAlmaMaterTotal (the finalize path's FINAL-only number)
 *   [2] effectiveTiebreakerActual — stored wins (0 included), calculated and provisional, a final week never falls back, matchesCalculated, the suggestion stays available beside an override
 *   [3] The Dashboard, end to end — two players tied on picks: the order, the Δ column, the Provisional chip and the "so far" line move with a score change and nothing else; the tie line;
 *       "Ranks appear once games start."; every other status renders exactly what it always did
 *   [4] The Comm card — no Auto-Calc button, the chip, the helper line, "So far", Save override / Use calculated value / Save question through the REAL handlers, and an unedited field is never an override
 *   [5] Step 2 of the guided Finalize flow suggests the CALCULATED value (even beside an override, and for a designated game)
 *   [6] Rank movement (FLIP) — rows that moved are animated, Reduce Motion and a missing API are not
 *   [7] Source pins — a pure leaf, scoring.js untouched by this feature, the Auto-Calc handler gone
 *
 * NOT covered here, and said so: whether the 300 ms row movement looks right, the chip's contrast in the seven themes and the layout at 375 pt / the largest text size on a device.
 * Run:  node livetiebreaktest.mjs
 */
import { readFile } from 'node:fs/promises';

// ── DOM / browser stubs (the ranktest shape: a registry of elements with listeners that tests can fire) ──
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
const registry = new Map();
function makeEl(id) {
  const listeners = new Map();
  const e = {
    id, value: '', checked: false, textContent: '', _html: '', className: '', hidden: false, style: {}, dataset: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }, removeEventListener() {},
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, setAttribute() {}, getAttribute: () => null, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    _fire(type, ev = {}) { const fns = listeners.get(type) || []; if (!fns.length) throw new Error(`livetiebreaktest: nothing bound to '${type}' on #${id}`); for (const fn of fns) fn({ target: e, ...ev }); },
    _bound: (type) => (listeners.get(type) || []).length > 0,
  };
  return e;
}
const el = (id) => { if (!registry.has(id)) registry.set(id, makeEl(id)); return registry.get(id); };
const resetDom = () => { registry.clear(); ['page-dashboard', 'page-picks', 'header-meta-week', 'page-home', 'page-commissioner', 'page-leaderboard', 'toast-container'].forEach(el); };
resetDom();
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: (id) => registry.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl('__detached__'), body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, appendChild() {}, innerHTML: '' }, hidden: false, activeElement: null,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
let reduceMotion = false;
globalThis.matchMedia = (q) => ({ matches: reduceMotion && /reduced-motion/.test(q) });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {}; globalThis.scrollTo = () => {};
globalThis.fetch = async () => { throw new Error('network disabled in livetiebreaktest'); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, detail ? `— ${detail}` : ''); }
}
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');
const scoring = await import('./js/scoring.js');
const lt = await import('./js/live-tiebreak.js');
const ww = await import('./js/week-wizard.js');
const app = await import('./js/app.js');
const { liveTiebreakerTotal, effectiveTiebreakerActual } = lt;
const { GAME_STATUS } = dm;

const G = (over = {}) => ({
  gameId: `g_${Math.random().toString(36).slice(2, 8)}`, weekId: 'w', homeTeam: 'Home', awayTeam: 'Away', kickoff: '2026-10-10T17:00:00Z', status: 'scheduled', homeScore: null, awayScore: null,
  isAlmaMaterGame: true, multiplier: 1, spread: -3.5, favorite: 'Home', lockedSpread: null, ...over,
});
const ROSTER = ['Oklahoma', 'Texas A&M'];

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] liveTiebreakerTotal — DI-515…');
// ══════════════════════════════════════════════════════════════════════════
{
  const calc = (games, extra = {}) => liveTiebreakerTotal({ games, almaMaters: ROSTER, calcMode: 'selectedSlateOnly', tiebreakerType: 'almaMaterTotal', ...extra });
  const none = calc([G({ homeTeam: 'Duke', awayTeam: 'Wake Forest' })]);
  assert(none.value === null && none.finalValue === null && none.total === 0 && none.complete === false, '[1a] no alma game on the slate: value null (no signal), never 0');
  const sched = calc([G({ homeTeam: 'Oklahoma', awayTeam: 'Texas' })]);
  assert(sched.value === null && sched.finalValue === null && sched.total === 1 && sched.pending === 1 && sched.complete === false, '[1b] an alma game that has not started: still null (not 0), 1 pending, incomplete');
  const mixed = calc([G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 }), G({ homeTeam: 'Texas A&M', awayTeam: 'Notre Dame', status: GAME_STATUS.LIVE, homeScore: 10, awayScore: 7 })]);
  assert(mixed.value === 34 && mixed.finalValue === 24 && mixed.final === 1 && mixed.live === 1 && mixed.pending === 0 && mixed.total === 2 && mixed.complete === false, `[1c] one FINAL (Oklahoma 24) and one LIVE (Texas A&M 10): so far 34, final-only 24, 1 of 2 final, incomplete — got ${JSON.stringify(mixed)}`);
  const done = calc([G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 }), G({ homeTeam: 'Texas A&M', awayTeam: 'Notre Dame', status: GAME_STATUS.FINAL, homeScore: 14, awayScore: 31 })]);
  assert(done.value === 38 && done.finalValue === 38 && done.complete === true && done.final === 2, '[1d] every alma game final: 38, complete');
  const zero = calc([G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 0, awayScore: 3 })]);
  assert(zero.value === 0 && zero.complete === true, '[1e] an alma team that really scored 0 in a final game is 0 (a counted game), distinct from "no signal" (null)');
  // both schools in one game count both sides
  const both = calc([G({ homeTeam: 'Oklahoma', awayTeam: 'Texas A&M', status: GAME_STATUS.FINAL, homeScore: 28, awayScore: 31 })]);
  assert(both.value === 59, '[1f] two claimed schools in ONE game: both sides count (28 + 31)');
  // precise matcher: a claimed "Miami" must not sum "Miami (OH)"
  const miami = liveTiebreakerTotal({ games: [G({ homeTeam: 'Miami (OH)', awayTeam: 'Toledo', status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 10 })], almaMaters: ['Miami'], calcMode: 'allAlmaMaterGames' });
  assert(miami.value === null && miami.total === 0, '[1g] a claimed "Miami" does not match "Miami (OH)" (the shared precise matcher)');
  // calc modes
  const unflagged = G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17, isAlmaMaterGame: false });
  assert(calc([unflagged]).value === null && calc([unflagged], { calcMode: 'allAlmaMaterGames' }).value === 24, '[1h] selectedSlateOnly keeps only games flagged as alma games; allAlmaMaterGames sums every game with a claimed school');
  // the roster that is passed decides (frozen at lock)
  const g1 = G({ homeTeam: 'Clemson', awayTeam: 'Duke', status: GAME_STATUS.FINAL, homeScore: 31, awayScore: 3 });
  assert(calc([g1]).value === null && calc([g1], { almaMaters: ['Clemson'] }).value === 31, '[1i] the roster handed in decides which schools count (so a frozen-at-lock roster cannot move)');
  // never multiplied
  const mult = calc([G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17, multiplier: 3 })]);
  assert(mult.value === 24, '[1j] the numeric tiebreaker is NEVER multiplied (a 3x game still contributes its raw 24)');
  // designated game (the NFL, D-31)
  const nflGames = [G({ gameId: 'n1', homeTeam: 'Chiefs', awayTeam: 'Bills', kickoff: '2026-10-11T17:00:00Z', status: GAME_STATUS.FINAL, homeScore: 27, awayScore: 24 }),
    G({ gameId: 'n2', homeTeam: 'Rams', awayTeam: 'Seahawks', kickoff: '2026-10-12T01:15:00Z', status: GAME_STATUS.LIVE, homeScore: 10, awayScore: 6 })];
  const custom = (extra = {}) => liveTiebreakerTotal({ games: nflGames, tiebreakerType: 'custom', ...extra });
  const last = custom();
  assert(last.value === 16 && last.finalValue === null && last.complete === false && last.live === 1 && last.game.gameId === 'n2' && last.game.awayTeam === 'Seahawks', '[1k] a designated-game tiebreaker defaults to the slate\'s LAST kickoff: its live total so far (10 + 6), final-only null, incomplete');
  const picked = custom({ tiebreakerGameId: 'n1' });
  assert(picked.value === 51 && picked.finalValue === 51 && picked.complete === true, '[1l] …and follows the designated game when one is named (27 + 24, final, complete)');
  assert(liveTiebreakerTotal({ games: [], tiebreakerType: 'custom' }).value === null, '[1m] a designated-game tiebreaker with no games is null');
  // manual / unknown / missing type
  assert(calc([done.value !== null ? G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 }) : null].filter(Boolean), { tiebreakerType: 'manual' }).value === null, '[1n] a `manual` tiebreaker has no automatic value (the commissioner enters it)');
  const noType = liveTiebreakerTotal({ games: [G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 })], almaMaters: ROSTER });
  assert(noType.value === 24, '[1o] a week with NO tiebreakerType (an old record) is the alma-mater total, the default when missing');
  // junk input never throws
  assert(liveTiebreakerTotal().value === null && liveTiebreakerTotal({ games: [null, undefined, {}] }).value === null && liveTiebreakerTotal({ games: 'x', almaMaters: 5 }).value === null, '[1p] junk input (no args, null games, non-arrays) is null, never an exception');
  // PARITY with scoring.calculateAlmaMaterTotal: finalValue is its number, over many fixtures; null where it is null
  const rosters = [ROSTER, ['Clemson'], ['Miami', 'Oklahoma'], []];
  const teams = ['Oklahoma', 'Texas A&M', 'Clemson', 'Duke', 'Miami', 'Miami (OH)', 'Texas', 'Notre Dame'];
  const statuses = [GAME_STATUS.SCHEDULED, GAME_STATUS.LIVE, GAME_STATUS.FINAL];
  const scores = [[null, null], [0, 0], [24, 17], [3, 45]];
  let bad = [], cases = 0, seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 400; i++) {
    const games = Array.from({ length: 1 + rnd(5) }, () => {
      const [hs, as] = scores[rnd(scores.length)]; const st = statuses[rnd(3)];
      return G({ homeTeam: teams[rnd(teams.length)], awayTeam: teams[rnd(teams.length)], status: st, homeScore: st === GAME_STATUS.SCHEDULED ? null : hs, awayScore: st === GAME_STATUS.SCHEDULED ? null : as, isAlmaMaterGame: rnd(2) === 0, multiplier: 1 + rnd(3) });
    });
    for (const roster of rosters) for (const mode of ['selectedSlateOnly', 'allAlmaMaterGames']) {
      cases++;
      const want = scoring.calculateAlmaMaterTotal(games, roster, mode);
      const got = liveTiebreakerTotal({ games, almaMaters: roster, calcMode: mode, tiebreakerType: 'almaMaterTotal' });
      if (got.finalValue !== want) bad.push({ roster, mode, want, got: got.finalValue });
      // an all-final slate: the live value IS the final value
      if (games.every((g) => g.status === GAME_STATUS.FINAL) && got.total > 0 && got.complete && got.value !== got.finalValue) bad.push({ note: 'complete but value != finalValue', got });
    }
  }
  assert(bad.length === 0, `[1q] PARITY: finalValue equals scoring.calculateAlmaMaterTotal's number (null where it is null) over ${cases} random slates x rosters x modes`, JSON.stringify(bad.slice(0, 2)));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] effectiveTiebreakerActual — the value every surface ranks with (DI-516)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const games = [G({ homeTeam: 'Oklahoma', awayTeam: 'Texas', status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 17 }), G({ homeTeam: 'Texas A&M', awayTeam: 'Notre Dame', status: GAME_STATUS.LIVE, homeScore: 10, awayScore: 7 })];
  const wk = (over = {}) => ({ weekId: 'w', status: 'live', tiebreakerType: 'almaMaterTotal', tiebreakerCalculationMode: 'selectedSlateOnly', actualTiebreakerValue: null, ...over });
  const calc = effectiveTiebreakerActual({ week: wk(), games, almaMaters: ROSTER });
  assert(calc.value === 34 && calc.source === 'calculated' && calc.provisional === true, '[2a] no stored value on a live week: the live total, source calculated, PROVISIONAL (an alma game is still live)');
  const done = effectiveTiebreakerActual({ week: wk(), games: games.map((g) => ({ ...g, status: GAME_STATUS.FINAL, homeScore: g.homeScore, awayScore: g.awayScore })), almaMaters: ROSTER });
  assert(done.source === 'calculated' && done.provisional === false && done.value === 34, '[2b] every alma game final but the week not yet final: calculated, no longer provisional');
  const stored = effectiveTiebreakerActual({ week: wk({ actualTiebreakerValue: 61 }), games, almaMaters: ROSTER });
  assert(stored.value === 61 && stored.source === 'manual' && stored.provisional === false && stored.calculated.value === 34, '[2c] a stored actual ALWAYS wins and is not provisional; the calculated total stays available beside it');
  const zero = effectiveTiebreakerActual({ week: wk({ actualTiebreakerValue: 0 }), games, almaMaters: ROSTER });
  assert(zero.value === 0 && zero.source === 'manual', '[2d] a stored 0 is a stored value (never mistaken for "not set")');
  const finalNoStored = effectiveTiebreakerActual({ week: wk({ status: 'final' }), games, almaMaters: ROSTER });
  assert(finalNoStored.value === null && finalNoStored.source === 'none' && finalNoStored.calculated.value === 34, '[2e] a FINAL week with no stored value never falls back to the live total (its persisted results did not use one): source none, the calculation still shown for Step 2');
  const finalStored = effectiveTiebreakerActual({ week: wk({ status: 'final', actualTiebreakerValue: 52 }), games, almaMaters: ROSTER });
  assert(finalStored.value === 52 && finalStored.source === 'manual', '[2f] a FINAL week with a stored value ranks with exactly that value');
  const nothing = effectiveTiebreakerActual({ week: wk(), games: [G({ homeTeam: 'Duke', awayTeam: 'Wake Forest' })], almaMaters: ROSTER });
  assert(nothing.value === null && nothing.source === 'none' && nothing.provisional === false, '[2g] no stored value and no alma score: none');
  const same = effectiveTiebreakerActual({ week: wk({ actualTiebreakerValue: 38 }), games: games.map((g) => ({ ...g, status: GAME_STATUS.FINAL, homeScore: g.homeScore === 10 ? 14 : g.homeScore, awayScore: g.awayScore === 7 ? 31 : g.awayScore })), almaMaters: ROSTER });
  assert(same.matchesCalculated === true && same.source === 'manual', '[2h] a stored value equal to a COMPLETE calculated total is flagged matchesCalculated (finalize wrote it from the auto-calc — the Comm card calls it "Calculated", not "Commissioner-set")');
  assert(effectiveTiebreakerActual({ week: null }).source === 'none' && effectiveTiebreakerActual().value === null, '[2i] no week: none, never an exception');
}

// ── the Dashboard fixture ──
const WK = 'lt_w1';
function seedLive({ gameA = [24, 17, GAME_STATUS.FINAL], gameB = [10, 7, GAME_STATUS.LIVE], status = 'live', over = {} } = {}) {
  storage.saveWeek({
    weekId: WK, weekNumber: 5, seasonYear: 2026, name: 'Week 5', status, startDate: '2026-10-10', endDate: '2026-10-11', dataSourceMode: 'live', picksOpenAt: null, picksLockAt: null, autoLockOffsetMinutes: 30,
    lockedAt: '2026-10-10T15:00:00Z', finalizedAt: null, tiebreakerQuestion: 'Combined alma mater points?', tiebreakerType: 'almaMaterTotal', tiebreakerCalculationMode: 'selectedSlateOnly',
    actualTiebreakerValue: null, tiebreakerFinalized: false, showInHistory: true, blurb: null, lockedAlmaMaters: ROSTER, ...over,
  });
  const base = { weekId: WK, espnEventId: null, dataQuality: 'manual', dataSource: 'manual', homeConference: 'SEC', awayConference: 'SEC', homeRank: null, awayRank: null, kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'afternoon', lockedSpread: null,
    actualWinner: null, atsWinner: null, isAlmaMaterGame: true, spreadSource: 'manual', oddsProvider: null, lastUpdated: null, venue: null, venueDisplay: null, neutralSite: false };
  storage.saveGame({ ...base, gameId: `${WK}_a`, homeTeam: 'Oklahoma', awayTeam: 'Texas', kickoff: '2026-10-10T16:00:00Z', spread: -3.5, favorite: 'Oklahoma', lockedSpread: -3.5, homeScore: gameA[0], awayScore: gameA[1], status: gameA[2] });
  storage.saveGame({ ...base, gameId: `${WK}_b`, homeTeam: 'Texas A&M', awayTeam: 'Notre Dame', kickoff: '2026-10-10T19:00:00Z', spread: -2.5, favorite: 'Texas A&M', lockedSpread: -2.5, homeScore: gameB[0], awayScore: gameB[1], status: gameB[2] });
  const picks = [];
  for (const pid of ['p1', 'p2']) for (const gid of [`${WK}_a`, `${WK}_b`]) picks.push({ pickId: `pk_${pid}_${gid}`, weekId: WK, gameId: gid, playerId: pid, selectedTeam: gid.endsWith('_a') ? 'Oklahoma' : 'Texas A&M', submittedAt: '2026-10-09T00:00:00Z' });
  storage.saveAllPicks(picks);
}
storage.setBackendMode('local');
storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true, almaMater: 'Oklahoma', preferences: {} });
storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true, almaMater: 'Texas A&M', preferences: {} });
storage.setSession('p1', false, true);
const dashboardHtml = () => { storage.setActiveWeekId(WK); el('page-dashboard')._html = ''; window.navigateTo('dashboard'); return el('page-dashboard')._html; };
const summaryOrder = (html) => { const s = html.slice(html.indexOf('This Week Score Summary')); return [...s.matchAll(/class="player-name-cell">([^<]+)</g)].map((m) => m[1].trim().replace(/\s*[🏆💀]/gu, '')); };

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] The Dashboard, end to end — the order moves by itself as a score changes…');
// ══════════════════════════════════════════════════════════════════════════
{
  seedLive();
  storage.setTiebreakerGuess(WK, 'p1', 45); storage.setTiebreakerGuess(WK, 'p2', 60);
  let html = dashboardHtml();
  assert(summaryOrder(html).join() === 'Drew,Brayden', `[3a] tied on picks, so far 34 (Oklahoma 24 + Texas A&M 10): Drew (guess 45, Δ11) ranks above Brayden (60, Δ26) with NOTHING pressed — got ${summaryOrder(html).join()}`);
  assert(/tb-provisional-chip">Provisional</.test(html) && /Tiebreaker so far: 34 · 1 of 2 alma games final/.test(html), '[3b] the card says Provisional and "Tiebreaker so far: 34 · 1 of 2 alma games final"');
  assert(/Δ11/.test(html) && /Δ26/.test(html), '[3c] the Δ column reads the provisional value (11 and 26)');
  assert(/So far: <strong>34<\/strong>/.test(html) && !/Actual: <strong>34/.test(html), '[3d] the tiebreaker line reads "So far: 34", never "Actual: 34"');
  assert(/data-player-id="p1"/.test(html) && /data-player-id="p2"/.test(html), '[3e] a LIVE week\'s summary rows carry their player id (the key the rank movement animates by)');
  // the live game scores: Texas A&M runs it up -> total 64 -> Brayden (Δ4) now ranks above Drew (Δ19)
  storage.saveGame({ ...storage.getGames(WK).find((g) => g.homeTeam === 'Texas A&M'), homeScore: 40, awayScore: 7 });
  html = dashboardHtml();
  assert(summaryOrder(html).join() === 'Brayden,Drew' && /Tiebreaker so far: 64/.test(html) && /Δ4/.test(html) && /Δ19/.test(html),
    `[3f] a score update reorders the week: total 64, Brayden (Δ4) now above Drew (Δ19), the line and the Δs move with it — no button anywhere (got ${summaryOrder(html).join()})`);
  // a commissioner override pins the value and is not "so far"
  storage.saveWeek({ ...storage.getWeek(WK), actualTiebreakerValue: 50 });
  html = dashboardHtml();
  assert(summaryOrder(html).join() === 'Drew,Brayden' && !/Tiebreaker so far/.test(html) && /Actual: <strong>50<\/strong>/.test(html), '[3g] a stored actual (50) outranks the live total: Drew (Δ5) above Brayden (Δ10), no "so far" line, "Actual: 50"');
  storage.saveWeek({ ...storage.getWeek(WK), actualTiebreakerValue: null });
  // a tie that survives the numeric tiebreaker (equal guesses) while the week is not final
  storage.setTiebreakerGuess(WK, 'p1', 60); storage.setTiebreakerGuess(WK, 'p2', 60);
  html = dashboardHtml();
  assert(/Tied — settles when the week is final/.test(html), '[3h] equal guesses leave a tie the numeric tiebreaker cannot break: "Tied — settles when the week is final"');
  storage.setTiebreakerGuess(WK, 'p1', 45); storage.setTiebreakerGuess(WK, 'p2', 60);
  // no score yet
  seedLive({ gameA: [null, null, GAME_STATUS.SCHEDULED], gameB: [null, null, GAME_STATUS.SCHEDULED] });
  html = dashboardHtml();
  assert(/Ranks appear once games start\./.test(html) && !/Tiebreaker so far/.test(html), '[3i] a live week where no game has a score yet says "Ranks appear once games start." and shows no total');
  // every other status renders exactly what it always did: no chip, no line, no row keys
  for (const status of ['open', 'locked', 'final']) {
    seedLive({ status, gameA: [24, 17, GAME_STATUS.FINAL], gameB: [14, 31, GAME_STATUS.FINAL], over: status === 'final' ? { actualTiebreakerValue: 38, tiebreakerFinalized: true, finalizedAt: '2026-10-11T00:00:00Z' } : {} });
    html = dashboardHtml();
    const summary = html.slice(html.indexOf('This Week Score Summary'), html.indexOf('</table>', html.indexOf('This Week Score Summary')));
    assert(!/tb-provisional-chip|tb-live-line/.test(html) && !/data-player-id=/.test(summary) && summary.length > 100, `[3j] a ${status.toUpperCase()} week's summary carries no Provisional chip, no live line and no row key (byte-identical to before for that status)`);
    // GOLDEN: with the live fragments empty, the card's markup is the v0.29.0 markup, character for character (header row closed straight after the title, the table opening on the next line)
    assert(html.includes('<span class="card-title">This Week Score Summary</span></div>\n      <table class="leaderboard-table">'), `[3j2] a ${status.toUpperCase()} week: the "This Week Score Summary" card header and table opening are byte-identical to v0.29.0`);
    if (status === 'final') assert(html.includes('<div class="tb-actual">Actual: <strong>38</strong></div>'), '[3j3] a FINAL week with a stored actual prints the same "Actual: 38" line as before');
  }
  // a final week with a stored value ranks with it; one WITHOUT a stored value does not re-rank on the live number
  seedLive({ status: 'final', gameA: [24, 17, GAME_STATUS.FINAL], gameB: [14, 31, GAME_STATUS.FINAL], over: { finalizedAt: '2026-10-11T00:00:00Z' } });
  html = dashboardHtml();
  assert(/Actual answer not entered yet\./.test(html) && !/Δ\d/.test(html), '[3k] a FINAL week with no stored actual still says "Actual answer not entered yet." and shows no Δ (it never invents a final value from the live total)');
  assert(app.liveTiebreakerNotesHTML({ status: 'final' }, [], { source: 'calculated', value: 5, calculated: {} }, []).chip === '', '[3l] the live notes helper is empty for any non-live status');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3m] T1 (fix round) — RG-253: a week this device holds as LIVE but the server has only confirmed OPEN tells the viewer nothing about the order…');
// ══════════════════════════════════════════════════════════════════════════
{
  // The reveal belongs to the server in Supabase data mode: the mirror can hold a status the server never reached (a leg inside its debounce). The notes ride canViewOtherPicks(), so on that
  // device they must be empty even though week.status reads 'live'. Built on the REAL adapter (a hydrate over a fake PostgREST client that confirms the week OPEN), not on a stub of the gate.
  const sb = await import('./js/supabase-backend.js');
  const auth = await import('./js/auth.js');
  const fakeClient = (rows) => {
    const thenable = (table) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, gt() { return this; },
      then(res) { const data = rows[table] || []; return res({ data, error: null, count: data.length }); } });
    return { from: (t) => thenable(t), rpc: async () => ({ data: [], error: null }) };
  };
  const quiet = async (fn) => { const rl = console.log, rw = console.warn, ri = console.info; console.log = () => {}; console.warn = () => {}; console.info = () => {}; try { return await fn(); } finally { console.log = rl; console.warn = rw; console.info = ri; } };
  sb._resetForTest();
  sb.init({
    register: auth.registerSupabaseDataBackend,
    getClient: () => fakeClient({ weeks: [{ extra: {}, league_id: 'L-blind', id: 'wk_blind', sport: 'cfb', season: '2026', week_number: 1, label: 'Week 1', status: 'open' }] }),
    getActiveLeagueId: () => 'L-blind', getIdentityEpoch: auth.getIdentityEpoch, getAccountUserId: auth.getAccountUserId, getDeviceDataOwnerTuple: auth.getDeviceDataOwnerTuple, getDeviceDataOwner: auth.getDeviceDataOwner,
    getLeagueName: auth._switchBannerLeagueName, getLeagueNameById: auth._leagueNameById, getSession: () => ({ isAdmin: false, playerId: 'm1' }), hasValidSupabaseSession: auth.hasValidSupabaseSession,
    isPrivilegeHeld: auth.isPrivilegeHeld, hasSheetMirror: auth.hasSheetMirrorOnDevice, isSiteUnlocked: storage.isSiteUnlocked,
  });
  await quiet(() => sb.hydrate('L-blind', { epoch: auth.getIdentityEpoch() }));
  const mirrorLive = { weekId: 'wk_blind', status: 'live', picksLockAt: null, dataSourceMode: 'live' };
  const games = [G({ weekId: 'wk_blind', homeTeam: 'Oklahoma', awayTeam: 'Rice', homeScore: 24, awayScore: 10, status: GAME_STATUS.LIVE })];
  const eff = { source: 'calculated', value: 34, calculated: { basis: 'alma', final: 0, total: 1 }, provisional: true };
  const confirmedOpen = sb.getConfirmedWeekStatus('wk_blind') === 'open';
  let blindVisible = null, blind = null;
  storage.setBackendMode('supabase');
  try { blindVisible = app.canViewOtherPicks(mirrorLive); blind = app.liveTiebreakerNotesHTML(mirrorLive, [], eff, games); } finally { storage.setBackendMode('local'); }
  assert(confirmedOpen && blindVisible === false, `[3m] fixture: the adapter confirms the week OPEN while the mirror row reads LIVE, and canViewOtherPicks() is false for it (confirmed open: ${confirmedOpen}, may view: ${blindVisible})`);
  assert(blind && blind.chip === '' && blind.lines === '', '[3n] …so the Provisional chip and the live lines are EMPTY: a viewer who cannot see standing is told nothing about it (RG-253, the blind rule)', JSON.stringify(blind));
  // the control: the same week and games, local mode (no server to defer to), where LIVE means public — the helper speaks
  const open = app.liveTiebreakerNotesHTML(mirrorLive, [], eff, games);
  assert(app.canViewOtherPicks(mirrorLive) === true && /Provisional/.test(open.chip) && /Tiebreaker so far: 34/.test(open.lines), '[3o] non-vacuity: the identical week where the gate is open (LIVE and public) DOES get the chip and the "so far" line');
  sb._resetForTest();
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[4] The Comm card — no Auto-Calc, the value shows itself (DI-516)…');
// ══════════════════════════════════════════════════════════════════════════
{
  seedLive();
  storage.setActiveWeekId(WK);
  const players = storage.getPlayers();
  const card = app.commTiebreakerCardHTML(storage.getWeek(WK), players);
  assert(!/auto-calc-tb-btn|Auto-Calc/.test(card), '[4a] the card has no Auto-Calc button anywhere');
  assert(/id="tb-actual"[^>]*data-initial="34"[^>]*value="34"/.test(card) && /tb-source-chip">Calculated</.test(card) && /Updates by itself as scores arrive\./.test(card) && /So far: 34 \(1 of 2 alma games final\)/.test(card),
    '[4b] "Actual value" shows 34 with the Calculated chip, the helper line, and "So far: 34 (1 of 2 alma games final)"');
  assert(/id="tb-save-override-btn" disabled>/.test(card) && !/id="tb-save-override-btn"[^>]*hidden/.test(card) && !/tb-use-calculated-btn/.test(card), '[4c] Save override is always on the card, DISABLED until the field is edited (no layout jump), and Use calculated value appears only when an override is stored');
  assert(/<div class="admin-section-title">Tiebreaker<\/div>/.test(card) && !card.includes('🎯'), '[4c2] the card title is plain text: no emoji in the chrome (D-1)');
  // an override is labelled and clearable
  storage.saveWeek({ ...storage.getWeek(WK), actualTiebreakerValue: 61 });
  const over = app.commTiebreakerCardHTML(storage.getWeek(WK), players);
  assert(/tb-source-chip">Commissioner-set</.test(over) && /id="tb-use-calculated-btn"/.test(over) && /data-initial="61"/.test(over) && !/So far:/.test(over), '[4d] with an override: the Commissioner-set chip, Use calculated value, 61 shown, no "so far"');
  storage.saveWeek({ ...storage.getWeek(WK), actualTiebreakerValue: null });
  // the REAL handlers. Saving the QUESTION with an UNEDITED field must not turn the calculated 34 into an override.
  const bind = () => app.bindCommTiebreakerCard(storage.getWeek(WK));
  resetDom(); el('tb-question').value = 'New question?'; el('tb-actual').value = '34'; el('tb-actual').dataset.initial = '34'; el('save-tb-btn'); el('tb-save-override-btn'); el('tb-use-calculated-btn');
  bind(); el('save-tb-btn')._fire('click');
  let w = storage.getWeek(WK);
  assert(w.tiebreakerQuestion === 'New question?' && w.actualTiebreakerValue === null && w.tiebreakerFinalized === false, '[4e] Save question with an UNEDITED actual field saves the question and leaves the stored actual null (the displayed calculation is never silently stored)');
  resetDom(); el('tb-question').value = 'New question?'; el('tb-actual').value = '58'; el('tb-actual').dataset.initial = '34'; el('save-tb-btn'); el('tb-save-override-btn'); el('tb-use-calculated-btn');
  bind(); el('tb-save-override-btn')._fire('click');
  w = storage.getWeek(WK);
  assert(w.actualTiebreakerValue === 58 && w.tiebreakerFinalized === true, '[4f] Save override with an EDITED field stores exactly that value (58)');
  resetDom(); el('tb-question').value = 'New question?'; el('tb-actual').value = '58'; el('tb-actual').dataset.initial = '58'; el('save-tb-btn'); el('tb-save-override-btn'); el('tb-use-calculated-btn');
  bind(); el('save-tb-btn')._fire('click');
  assert(storage.getWeek(WK).actualTiebreakerValue === 58, '[4g] …and saving the question again with the field untouched keeps the stored 58 exactly as it is');
  resetDom(); el('tb-question').value = 'New question?'; el('tb-actual').value = '58'; el('tb-actual').dataset.initial = '58'; el('save-tb-btn'); el('tb-save-override-btn'); el('tb-use-calculated-btn');
  bind(); el('tb-use-calculated-btn')._fire('click');
  w = storage.getWeek(WK);
  assert(w.actualTiebreakerValue === null && w.tiebreakerFinalized === false, '[4h] Use calculated value clears the stored actual (null): the card shows the live total again');
  // typing reveals the one button
  resetDom(); el('tb-actual').value = '34'; el('tb-actual').dataset.initial = '34'; const btn = el('tb-save-override-btn'); btn.disabled = true; el('tb-question'); el('save-tb-btn');
  bind();
  el('tb-actual').value = '40'; el('tb-actual')._fire('input');
  const shown = btn.disabled === false;
  el('tb-actual').value = '34'; el('tb-actual')._fire('input');
  assert(shown && btn.disabled === true, '[4i] typing in the field ENABLES Save override; putting the value back disables it again (the button never leaves the card)');
  // N1: the empty-field hint says what is true
  const fin = app.commTiebreakerCardHTML({ ...storage.getWeek(WK), status: 'final', actualTiebreakerValue: null }, players);
  const live0 = (() => { seedLive({ gameA: [null, null, GAME_STATUS.SCHEDULED], gameB: [null, null, GAME_STATUS.SCHEDULED] }); return app.commTiebreakerCardHTML(storage.getWeek(WK), players); })();
  assert(/id="tb-actual"[^>]*placeholder="Appears once alma games have scores"/.test(live0) && !/Appears once alma games have scores/.test(fin) && /id="tb-actual"[^>]*placeholder="No actual value entered"/.test(fin),
    '[4i2] a week waiting on scores says "Appears once alma games have scores"; a FINAL week with nothing stored does not claim to be waiting on scores');
  seedLive();
  // legacy harness shape (no data-initial): the field is treated as edited, the pre-D1 behavior the older suites drive
  resetDom(); el('tb-question').value = 'Q'; el('tb-actual').value = '12'; el('save-tb-btn'); bind(); el('save-tb-btn')._fire('click');
  assert(storage.getWeek(WK).actualTiebreakerValue === 12, '[4j] a field with no data-initial counts as edited (ranktest / authtest drive the real handler this way)');
  storage.saveWeek({ ...storage.getWeek(WK), actualTiebreakerValue: null, tiebreakerFinalized: false });
  assert(app.refreshCommTiebreakerCard() === false, '[4k] refreshCommTiebreakerCard() with no card on the page does nothing');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[5] Step 2 of the guided Finalize flow suggests the CALCULATED value…');
// ══════════════════════════════════════════════════════════════════════════
{
  seedLive({ gameA: [24, 17, GAME_STATUS.FINAL], gameB: [14, 31, GAME_STATUS.FINAL] });
  const deps = { calculateAlmaMaterTotal: scoring.calculateAlmaMaterTotal, almaMatersForAutoCalc: app.almaMatersForAutoCalc, getGames: storage.getGames, effectiveTiebreakerActual: app.effectiveTiebreakerActualForWeek };
  const wk = storage.getWeek(WK);
  const r = ww.finalizeAutoCalcTiebreaker({ week: wk, deps });
  const legacy = ww.finalizeAutoCalcTiebreaker({ week: wk, deps: { ...deps, effectiveTiebreakerActual: undefined } });
  assert(r.ok && r.value === 38 && legacy.ok && legacy.value === 38, '[5a] over a finished slate the live module and the legacy calculateAlmaMaterTotal path suggest the same 38');
  const withOverride = ww.finalizeAutoCalcTiebreaker({ week: { ...wk, actualTiebreakerValue: 61 }, deps });
  assert(withOverride.ok && withOverride.value === 38, '[5b] with a stored override (61) Step 2 still SUGGESTS the calculated 38 (the override is the prefill, the calculation is the suggestion)');
  const partial = ww.finalizeAutoCalcTiebreaker({ week: wk, deps: { ...deps, getGames: () => [{ ...storage.getGames(WK)[0] }, { ...storage.getGames(WK)[1], status: GAME_STATUS.LIVE, homeScore: 3, awayScore: 0 }] } });
  assert(partial.ok && partial.value === 24, '[5c] with one alma game still live the suggestion is the FINAL-only total (24), exactly what Auto-Calc always suggested — never the provisional one');
  // an NFL slate: no claimed school plays, so calculateAlmaMaterTotal has nothing to sum and answers null; the designated game (default: the last kickoff) is what the step must suggest
  const nflGames = [G({ weekId: WK, gameId: 'nfl_1', homeTeam: 'Chiefs', awayTeam: 'Bills', kickoff: '2026-10-11T17:00:00Z', status: GAME_STATUS.FINAL, homeScore: 27, awayScore: 24, isAlmaMaterGame: false }),
    G({ weekId: WK, gameId: 'nfl_2', homeTeam: 'Rams', awayTeam: 'Seahawks', kickoff: '2026-10-12T01:15:00Z', status: GAME_STATUS.FINAL, homeScore: 20, awayScore: 17, isAlmaMaterGame: false })];
  const nflDeps = { ...deps, getGames: () => nflGames };
  const nflWeek = { ...wk, tiebreakerType: 'custom', tiebreakerGameId: null };
  const nfl = ww.finalizeAutoCalcTiebreaker({ week: nflWeek, deps: nflDeps });
  const nflLegacy = ww.finalizeAutoCalcTiebreaker({ week: nflWeek, deps: { ...nflDeps, effectiveTiebreakerActual: undefined } });
  assert(nfl.ok && nfl.value === 37 && nflLegacy.ok === false, '[5d] a designated-game week (the NFL) is suggested the last kickoff\'s total (20 + 17 = 37); the legacy calculateAlmaMaterTotal path would have answered null for it');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[6] Rank movement (FLIP)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const mkRow = (id, top) => ({ getAttribute: (k) => (k === 'data-player-id' ? id : null), getBoundingClientRect: () => ({ top }), animated: null, animate(frames, opts) { this.animated = { frames, opts }; } });
  const rootWith = (rows) => ({ querySelectorAll: () => ({ forEach: (fn) => rows.forEach(fn) }) });
  const before = app.captureRankRows(rootWith([mkRow('p1', 100), mkRow('p2', 140)]));
  assert(before.get('p1') === 100 && before.get('p2') === 140 && before.size === 2, '[6a] positions are captured per player id before the repaint');
  const after = [mkRow('p2', 100), mkRow('p1', 140)];
  reduceMotion = false;
  const moved = app.playRankMovement(before, rootWith(after));
  const p2 = after[0].animated, p1 = after[1].animated;
  assert(moved === 2 && p2.frames[0].transform === 'translateY(40px)' && p1.frames[0].transform === 'translateY(-40px)' && p2.opts.duration === 350 && /cubic-bezier\(\.32,\.72,0,1\)/.test(p2.opts.easing),
    '[6b] a row that moved is animated from where it was (translateY(+/-40px)) to where it is, over --motion-large (350 ms, the token\'s own value when no stylesheet is present) with the native easing');
  // N1: the duration and easing are READ from the stylesheet's tokens (a second copy of the number would drift); a stylesheet that says 400ms / its own curve wins
  const realGCS = globalThis.getComputedStyle, hadRoot = 'documentElement' in globalThis.document;
  globalThis.document.documentElement = {};
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => (n === '--motion-large' ? ' 400ms' : n === '--ease-native' ? ' cubic-bezier(0,0,1,1)' : '') });
  const tok = [mkRow('p2', 100), mkRow('p1', 140)];
  app.playRankMovement(before, rootWith(tok));
  const tokOpts = tok[0].animated?.opts;
  if (realGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = realGCS;
  if (!hadRoot) delete globalThis.document.documentElement;
  assert(tokOpts && tokOpts.duration === 400 && tokOpts.easing === 'cubic-bezier(0,0,1,1)', '[6b2] the row movement reads --motion-large and --ease-native from the stylesheet (a stylesheet that says 400ms wins)', JSON.stringify(tokOpts));
  const still = [mkRow('p1', 100), mkRow('p2', 140)];
  assert(app.playRankMovement(before, rootWith(still)) === 0 && still.every((r) => r.animated === null), '[6c] rows that did not move are not animated');
  reduceMotion = true;
  const quiet = [mkRow('p2', 100), mkRow('p1', 140)];
  assert(app.playRankMovement(before, rootWith(quiet)) === 0 && quiet.every((r) => r.animated === null), '[6d] Reduce Motion: no animation, the repaint is the whole story');
  reduceMotion = false;
  const noApi = [{ ...mkRow('p2', 100), animate: undefined }];
  assert(app.playRankMovement(before, rootWith(noApi)) === 0, '[6e] a browser without the Web Animations API: nothing happens, nothing throws');
  assert(app.playRankMovement(new Map(), rootWith(after)) === 0 && app.captureRankRows(null).size === 0, '[6f] an empty capture or a missing DOM is a clean no-op');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[7] Source pins…');
// ══════════════════════════════════════════════════════════════════════════
{
  const lsrc = await read('./js/live-tiebreak.js');
  const imps = [...lsrc.matchAll(/^import [^;]* from '([^']+)';/gm)].map((x) => x[1]);
  assert(JSON.stringify(imps) === JSON.stringify(['./data-model.js']), `[7a] live-tiebreak.js imports data-model.js only (got ${imps.join(', ')}) — a pure leaf, scoring.js is not edited by this feature`);
  assert(!/\b(localStorage|document|window|fetch|Date\.now|new Date\()/.test(lsrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/new Date\(iso\)/, '')), '[7b] live-tiebreak.js touches no storage, DOM, network or clock (its one Date use parses a kickoff string)');
  const sc = await read('./js/scoring.js');
  assert(!/live-tiebreak/.test(sc) && /export function calculateAlmaMaterTotal\(games, almaMaters, calcMode='selectedSlateOnly'\)/.test(sc), '[7c] scoring.js does not know about the live module and calculateAlmaMaterTotal keeps its signature (the finalize path\'s FINAL-only number)');
  const appSrc = await read('./js/app.js');
  assert(!/auto-calc-tb-btn/.test(appSrc), '[7d] the Auto-Calc button and its handler are gone from app.js');
  assert(/never multipl/i.test(lsrc) && !/multiplier/.test(lsrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')), '[7e] the module states the rule and its code never reads a multiplier');
  const dashSrc = appSrc.slice(appSrc.indexOf('function renderDashboardInner()'), appSrc.indexOf('function renderDashboardInner()') + 9000);
  assert(/effectiveTiebreakerActualForWeek\(week,games\)/.test(dashSrc) && !/const actualTB=week\.actualTiebreakerValue/.test(dashSrc), '[7f] the Dashboard ranks with the effective value, not the raw stored field');
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
