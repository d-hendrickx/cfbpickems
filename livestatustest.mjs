/**
 * CFB Pickems — livestatustest.mjs (Item 2 "in-game quarter+clock", Pass A + B)
 * ==============================================================================
 * Unit + wiring tests.
 *
 * Pass A (sections 1-6):
 *   DI-1  transient capture (module-level liveStatusById Map in app.js,
 *         fed via data-provider.js's parseAndReport()/refreshScoresByEventIds(),
 *         NEVER persisted through saveGame()'s explicit allow-list)
 *   DI-6  the pure liveStatusDisplay()/liveStatusDisplayShort() state table
 *
 * Pass B (section 7) — wiring the Map into the three render surfaces plus
 * the DI-2 in-place patch:
 *   DI-3/4  renderGameCard() / renderDashboardTable() show the full detail
 *           text, verbatim, next to the existing live indicator.
 *   DI-5    renderDashboardCompact() shows the ≤14-char short variant as its
 *           own chip (dc-live-detail), never inline with the score chip.
 *   DI-6    callers suppress the pulsing 🔴 LIVE / live-dot when the helper
 *           returns {pulse:false} (halftime, stale); FINAL games are a
 *           deliberate no-op (never looked up); no Map entry -> nothing added.
 *   DI-2    updatePicksLiveStatusInPlace() patches ONLY the .live-block
 *           region of a Picks-tab game card, never regenerating the whole
 *           card (would drop pick-button listeners) and runAutoRefreshTick()
 *           never calls renderPicksPage() (would wipe an in-progress draft).
 *   DI-7/8/9 escHtml() around the captured text; no title attribute; reuses
 *           existing markup/classes (no new component/color/tappable element).
 *
 * Run:  node livestatustest.mjs
 * Mandated to also run under:
 *   TZ=UTC node livestatustest.mjs
 *   TZ=America/Los_Angeles node livestatustest.mjs
 *
 * Covers (Pass A, 1-6):
 *   1. End-to-end capture: a representative live ESPN payload, fed through
 *      the REAL refreshScoresByEventIds()->doRefreshScores() pipeline,
 *      populates liveStatusById keyed by the game's internal gameId.
 *   2. liveStatusDisplay(): Halftime (deterministic via status.name, not
 *      string-matching), mid-period (pulse true, verbatim detail),
 *      STATUS_END_PERIOD (verbatim detail, pulse true), overtime (same
 *      shape, no special-casing), no-entry -> null.
 *   3. Staleness (>3min): "· updated Nm ago" suffix, pulse forced false.
 *   4. liveStatusDisplayShort(): ~14-char budget, ellipsis truncation,
 *      NEVER exceeds the budget, across long and short source strings.
 *   5. DI-1 non-persistence proof: the game object actually written to
 *      storage by the live-refresh path carries none of
 *      detail/shortDetail/name/quarter/clock — both by re-reading the
 *      saved record AND by scanning the exact saveGame() call-site source
 *      for those literal keys.
 *
 * Covers (Pass B, section 7):
 *   7a. Mid-period live game: verbatim text + pulse stays ON, on all 3 surfaces.
 *   7b. Halftime: pulse goes OFF (no-pulse class / live-dot-static) everywhere.
 *   7c. Stale (>3min): long-form suffix + pulse OFF; short-form pulse OFF too
 *       (no suffix — no room in the 14-char budget).
 *   7d. FINAL games: unchanged no-op, even with a stray Map entry present.
 *   7e. No Map entry: renders exactly as pre-Item-2 (nothing added).
 *   7f. escHtml() proof on captured text; compact chip never exceeds the
 *       14-char budget; CSS structural check for white-space:nowrap.
 *   7g. updatePicksLiveStatusInPlace(): replaces an existing .live-block,
 *       inserts a new one after .matchup when absent, skips FINAL games
 *       before any DOM query, and no-ops silently for an unmatched card.
 *   7h. Structural: runAutoRefreshTick() calls updatePicksLiveStatusInPlace()
 *       and never calls renderPicksPage() as executable code.
 *
 * NOT covered here (browser-only — see feature-builder's handoff notes):
 *   actual on-screen CSS pulse animation, the real 60s poll cadence, and a
 *   live halftime bundle observed in a real browser tab.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / localStorage stubs — identical shape to loadtest.mjs's ────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const nullEl = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (p === 'style') return {};
    if (p === 'dataset') return {};
    if (['addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'insertAdjacentHTML', 'remove', 'focus', 'scrollTo'].includes(p)) return () => {};
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector' || p === 'closest') return () => null;
    if (p === 'innerHTML' || p === 'textContent' || p === 'value') return '';
    return undefined;
  },
  set: () => true,
});
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...({}), set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled until the test below arms a mock'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] livestatustest.mjs\n`);

// ── Imports (mirrors loadtest.mjs's module set — app.js has top-level exec) ──
console.log('[1] Importing modules…');
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const dataModel = await import('./js/data-model.js');
const dataProvider = await import('./js/data-provider.js');
console.log('  ✅ js/app.js, js/storage.js, js/data-model.js, js/data-provider.js');

const {
  liveStatusById, liveStatusDisplay, liveStatusDisplayShort, doRefreshScores,
  renderGameCard, renderDashboardTable, renderDashboardCompact, updatePicksLiveStatusInPlace,
} = app;
const { saveWeek, saveGame, getGame, getGames, setSession, addPlayer, getAvailableGames, saveAvailableGames } = storage;
const { createWeek, createGame, GAME_STATUS, PICK_RESULT } = dataModel;
const { fetchCurrentCFBGames } = dataProvider;

// ── 2. End-to-end capture through the REAL refresh pipeline ─────────────────
console.log('\n[2] End-to-end capture (parseAndReport -> refreshScoresByEventIds -> doRefreshScores)…');

const ESPN_EVENT_ID = 'espn_evt_401520000';

function representativeLiveEvent({ name = 'STATUS_IN_PROGRESS', detail = '12:34 - 2nd Quarter', shortDetail = '12:34 - 2nd' } = {}) {
  return {
    id: ESPN_EVENT_ID,
    date: '2026-09-09T18:00Z',
    status: { type: { name, detail, shortDetail } },
    competitions: [{
      timeValid: true,
      neutralSite: false,
      competitors: [
        { homeAway: 'home', score: '14', curatedRank: { current: 99 }, team: { location: 'Home School', name: 'Home Mascot', shortDisplayName: 'Home School', abbreviation: 'HOME' } },
        { homeAway: 'away', score: '10', curatedRank: { current: 99 }, team: { location: 'Away School', name: 'Away Mascot', shortDisplayName: 'Away School', abbreviation: 'AWAY' } },
      ],
      odds: [],
      broadcasts: [],
      notes: [],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } },
    }],
  };
}

const week = createWeek(2026, 1, '2026-09-05', '2026-09-06');
saveWeek(week);

let storedGame = createGame(week.weekId, {
  espnEventId: ESPN_EVENT_ID,
  homeTeam: 'Home School', awayTeam: 'Away School',
  status: 'live', homeScore: 0, awayScore: 0,
});
saveGame(storedGame);
storedGame = getGame(storedGame.gameId); // re-read the persisted shape

// Arm the fetch mock ONLY for this test — direct attemptFetch() call shape.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ events: [representativeLiveEvent()] }),
});

await doRefreshScores(week, [storedGame]);

const entry = liveStatusById.get(storedGame.gameId);
assert(!!entry, 'liveStatusById gained an entry for the refreshed game, keyed by internal gameId');
assert(entry?.name === 'STATUS_IN_PROGRESS', 'captured entry.name is the raw ESPN status name');
assert(entry?.detail === '12:34 - 2nd Quarter', 'captured entry.detail is verbatim ESPN detail text');
assert(entry?.shortDetail === '12:34 - 2nd', 'captured entry.shortDetail is verbatim ESPN shortDetail text');
assert(typeof entry?.capturedAt === 'number' && Math.abs(Date.now() - entry.capturedAt) < 5000,
  'captured entry.capturedAt is a fresh timestamp (within 5s of now)');

// ── 3. liveStatusDisplay() state table ───────────────────────────────────────
console.log('\n[3] liveStatusDisplay() state table…');

const NOW = 1_000_000_000_000; // fixed epoch ms for deterministic math

assert(liveStatusDisplay(null, NOW) === null, 'no entry -> null (caller renders nothing)');
assert(liveStatusDisplay(undefined, NOW) === null, 'undefined entry -> null');

const halftime = { name: 'STATUS_HALFTIME', detail: 'Halftime', shortDetail: 'Half', capturedAt: NOW - 60_000 };
const half = liveStatusDisplay(halftime, NOW);
assert(half.text === 'Halftime' && half.pulse === false, 'STATUS_HALFTIME -> {text: "Halftime", pulse: false} — detected via .name, not string-matching');

const midPeriod = { name: 'STATUS_IN_PROGRESS', detail: '8:41 - 3rd Quarter', shortDetail: '8:41 - 3rd', capturedAt: NOW - 30_000 };
const mid = liveStatusDisplay(midPeriod, NOW);
assert(mid.text === '8:41 - 3rd Quarter' && mid.pulse === true, 'mid-period in-progress -> verbatim detail, pulse true');

const endPeriod = { name: 'STATUS_END_PERIOD', detail: 'End of 1st Quarter', shortDetail: 'End 1st', capturedAt: NOW - 5_000 };
const end = liveStatusDisplay(endPeriod, NOW);
assert(end.text === 'End of 1st Quarter' && end.pulse === true, 'STATUS_END_PERIOD -> verbatim detail, pulse true, no special-casing (ESPN\'s own text differentiates it)');

const overtime = { name: 'STATUS_IN_PROGRESS', detail: '3:12 - OT', shortDetail: '3:12 - OT', capturedAt: NOW - 10_000 };
const ot = liveStatusDisplay(overtime, NOW);
assert(ot.text === '3:12 - OT' && ot.pulse === true, 'overtime -> verbatim detail, pulse true (same shape as any other non-halftime state)');

// Deterministic detection: a name that merely CONTAINS "HALFTIME" as a
// substring but isn't the exact ESPN constant must NOT be treated as halftime.
const fakeHalftimeLookalike = { name: 'STATUS_NOT_REALLY_HALFTIME_TEXT', detail: 'Some other text', shortDetail: 'Other', capturedAt: NOW - 1000 };
const lookalike = liveStatusDisplay(fakeHalftimeLookalike, NOW);
assert(lookalike.pulse === true && lookalike.text === 'Some other text',
  'halftime detection is an exact match on .name, not a substring/string-match — a lookalike name is NOT treated as halftime');

// ── 4. Staleness (>3 min) ────────────────────────────────────────────────────
console.log('\n[4] Staleness (>3min -> "· updated Nm ago", pulse forced false, no red)…');

const stale5min = { name: 'STATUS_IN_PROGRESS', detail: '2:00 - 4th Quarter', shortDetail: '2:00 - 4th', capturedAt: NOW - 5 * 60_000 };
const staleResult = liveStatusDisplay(stale5min, NOW);
assert(staleResult.text === '2:00 - 4th Quarter · updated 5m ago', 'stale by 5min appends "· updated 5m ago" to the verbatim text');
assert(staleResult.pulse === false, 'stale entry forces pulse false regardless of underlying state');

const freshJustUnder3min = { name: 'STATUS_IN_PROGRESS', detail: '9:00 - 1st Quarter', shortDetail: '9:00 - 1st', capturedAt: NOW - (3 * 60_000 - 1) };
const freshResult = liveStatusDisplay(freshJustUnder3min, NOW);
assert(freshResult.text === '9:00 - 1st Quarter' && freshResult.pulse === true, 'just under 3min is NOT stale — no suffix, pulse stays true');

const staleHalftime = { name: 'STATUS_HALFTIME', detail: 'Halftime', shortDetail: 'Half', capturedAt: NOW - 10 * 60_000 };
const staleHalf = liveStatusDisplay(staleHalftime, NOW);
assert(staleHalf.text === 'Halftime · updated 10m ago' && staleHalf.pulse === false, 'a stale halftime entry also gets the suffix appended (pulse already false, stays false)');

// ── 5. liveStatusDisplayShort() — compact ~14-char budget ────────────────────
console.log('\n[5] liveStatusDisplayShort() — compact budget, ellipsis, never wraps…');

const BUDGET = 14;
assert(liveStatusDisplayShort(null, NOW) === null, 'no entry -> null (short variant)');

const longShortDetail = { name: 'STATUS_IN_PROGRESS', detail: '12:34 - 2nd Quarter', shortDetail: '12:34 - 2nd Quarter Underway', capturedAt: NOW - 1000 };
const truncated = liveStatusDisplayShort(longShortDetail, NOW);
assert(truncated.text.length <= BUDGET, `truncated short text length (${truncated.text.length}) never exceeds the ${BUDGET}-char budget`);
assert(truncated.text.endsWith('…'), 'text longer than budget is truncated WITH an ellipsis');
assert(truncated.pulse === true, 'short variant carries the same pulse logic as the long form');

const shortEnough = { name: 'STATUS_IN_PROGRESS', detail: 'anything', shortDetail: '8:41 3rd', capturedAt: NOW - 1000 };
const notTruncated = liveStatusDisplayShort(shortEnough, NOW);
assert(notTruncated.text === '8:41 3rd' && !notTruncated.text.includes('…'), 'text already under budget passes through unchanged, no ellipsis added');

const halftimeShort = liveStatusDisplayShort(halftime, NOW);
assert(halftimeShort.text === 'Halftime' && halftimeShort.pulse === false, 'short variant halftime matches the long-form halftime text (already under budget)');

// Exhaustive length guarantee across a spread of source lengths, incl. edge
// cases right at and one-over the budget.
for (const len of [0, 1, 13, 14, 15, 16, 40]) {
  const src = 'x'.repeat(len);
  const r = liveStatusDisplayShort({ name: 'STATUS_IN_PROGRESS', detail: src, shortDetail: src, capturedAt: NOW }, NOW);
  assert(r.text.length <= BUDGET, `source length ${len} -> output length ${r.text.length} <= ${BUDGET}`);
}

// ── 6. DI-1 non-persistence proof ────────────────────────────────────────────
console.log('\n[6] DI-1 proof — the persisted game record carries NO live-status fields…');

// Recursive scanner — Item 2 remediation. The original guard only checked
// TOP-LEVEL key names, which stayed GREEN the entire time a prior pass
// attached `game._liveStatus = {name, detail, shortDetail}` (a WRAPPER
// object, not a bare key) to a persisted record — the leak rode through
// `{...game}` spreads into createGame()/saveGame() and the AVAIL_GAMES pool
// invisibly to a top-level-only scan. This walks every nested object/array.
function findForbiddenKeysDeep(obj, forbidden, path = '', seen = new Set()) {
  const hits = [];
  if (obj === null || typeof obj !== 'object') return hits;
  if (seen.has(obj)) return hits;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (forbidden.includes(k)) hits.push(p);
    if (v && typeof v === 'object') hits.push(...findForbiddenKeysDeep(v, forbidden, p, seen));
  }
  return hits;
}

const persisted = getGame(storedGame.gameId);
const persistedKeys = Object.keys(persisted);
const forbiddenKeys = ['detail', 'shortDetail', 'name', 'quarter', 'clock'];
const leaked = forbiddenKeys.filter(k => persistedKeys.includes(k));
assert(leaked.length === 0, `persisted game record has zero forbidden keys after a live refresh (checked: ${forbiddenKeys.join(', ')})`);
assert(persisted.status === 'live' || persisted.status === 'scheduled' || persisted.status === 'final',
  'sanity: the persisted record IS the real post-refresh game (status field present, normal value)');

// Deep scan: no `_liveStatus` key ANYWHERE in the persisted record, at any
// nesting depth — this is the specific shape ("game._liveStatus = {name,
// detail, shortDetail}") a prior pass introduced and the top-level-only scan
// above would have missed.
const deepHitsRefresh = findForbiddenKeysDeep(persisted, ['_liveStatus', 'detail', 'shortDetail', 'name', 'quarter', 'clock']);
assert(deepHitsRefresh.length === 0,
  `persisted game record has zero forbidden keys at ANY nesting depth after a live refresh (found: ${JSON.stringify(deepHitsRefresh)})`);

// ── 6a. ADD-TO-SLATE path + AVAIL_GAMES pool save — the actual leak vector ──
console.log('\n[6a] ADD-TO-SLATE + AVAIL_GAMES pool — a pool game built from a LIVE ESPN event carries no _liveStatus, and it stays clean through createGame()/saveGame() and the pool save…');

// A pool/candidate game, built via the REAL parseAndReport pipeline (through
// fetchCurrentCFBGames -> resilientFetch -> finalise -> parseAndReport), from
// an ESPN event that IS mid-game (has live status to leak). This is the
// exact shape app.js's candidatePool / AVAIL_GAMES entries have.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ events: [representativeLiveEvent({
    name: 'STATUS_IN_PROGRESS', detail: '5:00 - 4th Quarter', shortDetail: '5:00 - 4th',
  })] }),
});
const poolFetch = await fetchCurrentCFBGames();
assert(Array.isArray(poolFetch.games) && poolFetch.games.length === 1,
  'fixture check: fetchCurrentCFBGames() parsed exactly one pool game from the mocked live event');
const poolGame = poolFetch.games[0];

const poolGameHits = findForbiddenKeysDeep(poolGame, ['_liveStatus', 'detail', 'shortDetail', 'quarter', 'clock']);
assert(poolGameHits.length === 0,
  `raw pool game (from a LIVE ESPN event, pre-slate) carries no live-status keys at any depth (found: ${JSON.stringify(poolGameHits)})`);
assert(!!poolFetch._liveStatusByEventId?.get(String(ESPN_EVENT_ID)),
  'fixture check: the live status DID exist for this event — it rode the sibling _liveStatusByEventId map, not the pool game object');

// AVAIL_GAMES pool save path (renderCommPage's candidatePool persistence).
const poolWeekId = 'un_ig_wk_pool';
saveAvailableGames(poolWeekId, [poolGame]);
const rereadPool = getAvailableGames(poolWeekId);
const poolSavedHits = findForbiddenKeysDeep(rereadPool, ['_liveStatus', 'detail', 'shortDetail', 'quarter', 'clock']);
assert(poolSavedHits.length === 0,
  `AVAIL_GAMES pool, re-read after saveAvailableGames(), carries no live-status keys at any depth (found: ${JSON.stringify(poolSavedHits)})`);

// ADD-TO-SLATE path — the exact call shape at app.js's "add candidate to
// slate" sites: saveGame(createGame(week.weekId, {...game, weekId:week.weekId})).
const slateWeek = createWeek(2026, 3, '2026-09-19', '2026-09-20');
saveWeek(slateWeek);
const addedGame = createGame(slateWeek.weekId, { ...poolGame, weekId: slateWeek.weekId });
saveGame(addedGame);
const rereadAdded = getGame(addedGame.gameId);
const addedHits = findForbiddenKeysDeep(rereadAdded, ['_liveStatus', 'detail', 'shortDetail', 'quarter', 'clock']);
assert(addedHits.length === 0,
  `add-to-slate result (createGame({...poolGame}) -> saveGame() -> re-read) carries no live-status keys at any depth (found: ${JSON.stringify(addedHits)})`);
assert(rereadAdded.homeTeam === 'Home School' && rereadAdded.awayTeam === 'Away School',
  'sanity: the added game IS the real pool game carried through (not an empty/default record)');

// Structural guard: scan the app.js source for the exact saveGame() call in
// doRefreshScores() and assert it does not literally reference the
// forbidden keys as object keys, plus that the "intentionally not included"
// allow-list comment actually exists next to it.
const appJsSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
const saveGameCallMatch = appJsSrc.match(/saveGame\(\{\.\.\.stored,homeScore:upd\.homeScore[\s\S]{0,400}?\}\);/);
assert(!!saveGameCallMatch, 'fixture check: located the exact doRefreshScores() saveGame() call in app.js source');
const saveGameCallText = saveGameCallMatch ? saveGameCallMatch[0] : '';
assert(!/\bdetail\s*:/.test(saveGameCallText) && !/\bshortDetail\s*:/.test(saveGameCallText)
    && !/\bquarter\s*:/i.test(saveGameCallText) && !/\bclock\s*:/i.test(saveGameCallText)
    && !/(?<!lastUpdated:upd\.lastUpdated\}\); *\/\/ *)\bname\s*:/.test(saveGameCallText),
  'the saveGame() call-site literally contains none of detail:/shortDetail:/name:/quarter:/clock: as keys');
const precedingComment = appJsSrc.slice(Math.max(0, appJsSrc.indexOf(saveGameCallText) - 700), appJsSrc.indexOf(saveGameCallText));
assert(/allow-list/i.test(precedingComment) && /never.{0,15}persist|not.{0,10}(persist|includ)/i.test(precedingComment),
  'the saveGame() call is preceded by the required allow-list / intentionally-not-persisted comment');

// ══════════════════════════════════════════════════════════════════════════
// PASS B — wiring liveStatusById/liveStatusDisplay(Short)() into the three
// render surfaces (renderGameCard, renderDashboardTable, renderDashboardCompact)
// and the DI-2 in-place patch (updatePicksLiveStatusInPlace).
// ══════════════════════════════════════════════════════════════════════════

console.log('\n[7] Pass B — renderGameCard / renderDashboardTable / renderDashboardCompact wiring…');

setSession(null, false, false);
const week7 = { weekId: 'un_ig_wk', weekNumber: 2, season: 2026, status: 'live', dataSourceMode: 'live', startDate: '2026-09-12', endDate: '2026-09-13' };
saveWeek(week7);
addPlayer({ playerId: 'ig_p1', displayName: 'P1', active: true });
const players7 = [{ playerId: 'ig_p1', displayName: 'P1', active: true }];

function extractChip(html, cls) {
  const m = html.match(new RegExp(`<span class="[^"]*${cls}[^"]*">([^<]*)</span>`));
  return m ? m[1] : null;
}

// ── 7a. Mid-period (in-progress): pulse TRUE, verbatim text on all 3 surfaces
console.log('\n[7a] Mid-period live game — visible text, pulse stays on…');
let midGame = createGame(week7.weekId, {
  gameId: 'ig_live_mid', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.LIVE, homeScore: 14, awayScore: 10, espnEventId: 'e_mid',
});
saveGame(midGame);
midGame = getGame(midGame.gameId);
liveStatusById.set(midGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '8:41 - 3rd Quarter', shortDetail: '8:41 - 3rd', capturedAt: Date.now() });

const cardMid = renderGameCard(midGame, null, PICK_RESULT.LIVE, false, true);
assert(cardMid.includes('8:41 - 3rd Quarter'), 'renderGameCard: mid-period shows the captured detail text verbatim');
assert(!cardMid.includes('score-status-no-pulse'), 'renderGameCard: mid-period LIVE indicator keeps pulsing (no no-pulse class)');

const tableMid = renderDashboardTable(players7, [midGame], [{ pickId: 'pk_mid', weekId: week7.weekId, gameId: midGame.gameId, playerId: 'ig_p1', selectedTeam: 'Home U' }], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(tableMid.includes('8:41 - 3rd Quarter'), 'renderDashboardTable: mid-period detail text appears next to the LIVE pill');
assert(!tableMid.includes('live-dot-static'), 'renderDashboardTable: mid-period dot keeps pulsing (no live-dot-static)');

const compactMid = renderDashboardCompact(players7, [midGame], [], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(compactMid.includes('dc-live-detail'), 'renderDashboardCompact: mid-period gets its own quarter/clock chip (dc-live-detail)');
assert(!compactMid.includes('live-dot-static'), 'renderDashboardCompact: mid-period dot keeps pulsing');
const chipMid = extractChip(compactMid, 'dc-live-detail');
assert(chipMid === '8:41 - 3rd', `compact chip text is the SHORT variant verbatim (got ${JSON.stringify(chipMid)})`);

// ── 7b. Halftime: pulse FALSE everywhere, text = "Halftime"
console.log('\n[7b] Halftime — the pulsing LIVE indicator must go static on every surface…');
let halfGame = createGame(week7.weekId, {
  gameId: 'ig_live_half', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.LIVE, homeScore: 7, awayScore: 3, espnEventId: 'e_half',
});
saveGame(halfGame);
halfGame = getGame(halfGame.gameId);
liveStatusById.set(halfGame.gameId, { name: 'STATUS_HALFTIME', detail: 'Halftime', shortDetail: 'Half', capturedAt: Date.now() });

const cardHalf = renderGameCard(halfGame, null, PICK_RESULT.LIVE, false, true);
assert(cardHalf.includes('score-status-no-pulse'), 'renderGameCard: halftime suppresses the pulsing 🔴 LIVE class (score-status-no-pulse present)');
assert(cardHalf.includes('Halftime'), 'renderGameCard: halftime text reads "Halftime"');

const tableHalf = renderDashboardTable(players7, [halfGame], [{ pickId: 'pk_half', weekId: week7.weekId, gameId: halfGame.gameId, playerId: 'ig_p1', selectedTeam: 'Home U' }], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(tableHalf.includes('live-dot-static'), 'renderDashboardTable: halftime dot goes static (live-dot-static present)');
assert(tableHalf.includes('Halftime'), 'renderDashboardTable: halftime text appended next to the LIVE pill');

const compactHalf = renderDashboardCompact(players7, [halfGame], [], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(compactHalf.includes('live-dot-static'), 'renderDashboardCompact: halftime dot goes static');
assert(extractChip(compactHalf, 'dc-live-detail') === 'Halftime', 'renderDashboardCompact: halftime chip text is exactly "Halftime"');

// ── 7c. Stale (>3min): long-form gets the "updated Nm ago" suffix + static dot;
//        short-form (compact) has NO room for the suffix but still goes static.
console.log('\n[7c] Stale capture (>3min old) — pulse goes static, long form gets the suffix…');
let staleGame = createGame(week7.weekId, {
  gameId: 'ig_live_stale', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.LIVE, homeScore: 21, awayScore: 17, espnEventId: 'e_stale',
});
saveGame(staleGame);
staleGame = getGame(staleGame.gameId);
liveStatusById.set(staleGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '2:00 - 4th Quarter', shortDetail: '2:00 - 4th', capturedAt: Date.now() - 5 * 60_000 });

const tableStale = renderDashboardTable(players7, [staleGame], [{ pickId: 'pk_stale', weekId: week7.weekId, gameId: staleGame.gameId, playerId: 'ig_p1', selectedTeam: 'Home U' }], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(tableStale.includes('live-dot-static'), 'renderDashboardTable: stale capture goes static');
assert(/2:00 - 4th Quarter · updated 5m ago/.test(tableStale), 'renderDashboardTable: stale long-form text carries the "updated Nm ago" suffix');

const compactStale = renderDashboardCompact(players7, [staleGame], [], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(compactStale.includes('live-dot-static'), 'renderDashboardCompact: stale capture goes static too, even though the short form has no room for the suffix');
assert(extractChip(compactStale, 'dc-live-detail') === '2:00 - 4th', 'renderDashboardCompact: stale short-form chip stays the bare shortDetail (no suffix — no room in the budget)');

// ── 7d. FINAL games — deliberate no-op, even if a stray Map entry exists
console.log('\n[7d] FINAL games — unchanged no-op, even with a (bogus) Map entry present…');
let finalGame = createGame(week7.weekId, {
  gameId: 'ig_final', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.FINAL, homeScore: 30, awayScore: 20, espnEventId: 'e_final',
});
saveGame(finalGame);
finalGame = getGame(finalGame.gameId);
// A Map entry under this id would only exist if the game went final mid-poll;
// either way the render path must never look it up for a FINAL game.
liveStatusById.set(finalGame.gameId, { name: 'STATUS_FINAL', detail: 'Final', shortDetail: 'Final', capturedAt: Date.now() });

const cardFinal = renderGameCard(finalGame, null, PICK_RESULT.WIN, true, true);
assert(cardFinal.includes('FINAL') && !cardFinal.includes('live-status-detail'), 'renderGameCard: FINAL game shows the plain FINAL label, no live-status-detail line added');
assert(!cardFinal.includes('score-status-no-pulse'), 'renderGameCard: FINAL game never gains the no-pulse modifier — the lookup never happens for it');

const tableFinal = renderDashboardTable(players7, [finalGame], [{ pickId: 'pk_final', weekId: week7.weekId, gameId: finalGame.gameId, playerId: 'ig_p1', selectedTeam: 'Home U' }], [{ playerId: 'ig_p1', correctPicks: 1, incorrectPicks: 0 }], week7.weekId, null);
assert(tableFinal.includes('FINAL 20–30') && !tableFinal.includes('live-dot-static'), 'renderDashboardTable: FINAL row unchanged — no live-dot-static, no injected detail text');

const compactFinal = renderDashboardCompact(players7, [finalGame], [], [{ playerId: 'ig_p1', correctPicks: 1, incorrectPicks: 0 }], week7.weekId, null);
assert(compactFinal.includes('dc-final') && !compactFinal.includes('dc-live-detail'), 'renderDashboardCompact: FINAL chip unchanged — no dc-live-detail chip added');

// ── 7e. No Map entry (never refreshed this session) — append NOTHING
console.log('\n[7e] No Map entry (never refreshed) — renders exactly as before Item 2…');
let freshGame = createGame(week7.weekId, {
  gameId: 'ig_live_no_entry', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.LIVE, homeScore: 3, awayScore: 0, espnEventId: 'e_fresh',
});
saveGame(freshGame);
freshGame = getGame(freshGame.gameId);
assert(!liveStatusById.has(freshGame.gameId), 'fixture check: no Map entry exists for this game');

const cardNoEntry = renderGameCard(freshGame, null, PICK_RESULT.LIVE, false, true);
assert(!cardNoEntry.includes('live-status-detail') && !cardNoEntry.includes('score-status-no-pulse'),
  'renderGameCard: no entry -> no detail line, no pulse suppression — 🔴 LIVE pulses exactly as pre-Item-2');

const tableNoEntry = renderDashboardTable(players7, [freshGame], [{ pickId: 'pk_fresh', weekId: week7.weekId, gameId: freshGame.gameId, playerId: 'ig_p1', selectedTeam: 'Home U' }], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(tableNoEntry.includes('LIVE 0–3') && !/LIVE 0–3 ·/.test(tableNoEntry) && !tableNoEntry.includes('live-dot-static'),
  'renderDashboardTable: no entry -> the LIVE pill has no appended text and the dot keeps pulsing');

const compactNoEntry = renderDashboardCompact(players7, [freshGame], [], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
assert(!compactNoEntry.includes('dc-live-detail'), 'renderDashboardCompact: no entry -> no quarter/clock chip added at all');

// ── 7f. escHtml around the captured text, and the compact ≤14-char / no-wrap guard
console.log('\n[7f] escHtml on the captured text; compact chip budget + no-wrap CSS…');
let escGame = createGame(week7.weekId, {
  gameId: 'ig_live_esc', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.LIVE, homeScore: 1, awayScore: 0, espnEventId: 'e_esc',
});
saveGame(escGame);
escGame = getGame(escGame.gameId);
liveStatusById.set(escGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '<script>bad</script>', shortDetail: '<script>bad</script>', capturedAt: Date.now() });
const cardEsc = renderGameCard(escGame, null, PICK_RESULT.LIVE, false, true);
assert(!cardEsc.includes('<script>') && cardEsc.includes('&lt;script&gt;'), 'renderGameCard: captured ESPN text goes through escHtml() before landing in markup');

let longGame = createGame(week7.weekId, {
  gameId: 'ig_live_long', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.LIVE, homeScore: 9, awayScore: 6, espnEventId: 'e_long',
});
saveGame(longGame);
longGame = getGame(longGame.gameId);
liveStatusById.set(longGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '12:34 - 2nd Quarter Underway', shortDetail: '12:34 - 2nd Quarter Underway', capturedAt: Date.now() });
const compactLong = renderDashboardCompact(players7, [longGame], [], [{ playerId: 'ig_p1', correctPicks: 0, incorrectPicks: 0 }], week7.weekId, null);
const chipLong = extractChip(compactLong, 'dc-live-detail');
assert(chipLong !== null && chipLong.length <= 14, `compact chip text (${JSON.stringify(chipLong)}) never exceeds the 14-char budget in a real rendered page`);

const cssSrc = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
assert(/\.dc-status\.dc-live-detail\{[^}]*white-space:nowrap/.test(cssSrc),
  '[structural] .dc-status.dc-live-detail carries white-space:nowrap in CSS — the container can never wrap even under font/zoom variance');

// ══════════════════════════════════════════════════════════════════════════
// PASS B — DI-2: updatePicksLiveStatusInPlace() surgical Picks-tab patch
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[7g] DI-2 — updatePicksLiveStatusInPlace() surgical patch mechanism…');
{
  const originalQSA = document.querySelectorAll;
  const registry = new Map(); // gameId -> fake card element

  function makeFakeCard({ hasLiveBlock }) {
    const state = { liveBlockHTML: hasLiveBlock ? '<div class="live-block">OLD</div>' : null, insertedAfterMatchup: null, removed: false };
    const liveBlockEl = {
      set outerHTML(html) { state.liveBlockHTML = html; },
      get outerHTML() { return state.liveBlockHTML; },
      remove() { state.removed = true; state.liveBlockHTML = null; },
    };
    const matchupEl = { insertAdjacentHTML(pos, html) { state.insertedAfterMatchup = html; } };
    return {
      querySelector(sel) {
        if (sel === '.live-block') return hasLiveBlock ? liveBlockEl : null;
        if (sel === '.matchup') return matchupEl;
        return null;
      },
      _state: state,
    };
  }

  document.querySelectorAll = (sel) => {
    const m = sel.match(/data-game-id="([^"]+)"/);
    if (!m) return [];
    const card = registry.get(m[1]);
    return card ? [card] : [];
  };

  // An EXISTING .live-block gets replaced with fresh markup (new quarter/clock text).
  const cardA = makeFakeCard({ hasLiveBlock: true });
  registry.set(midGame.gameId, cardA);
  updatePicksLiveStatusInPlace([midGame]);
  assert(!!cardA._state.liveBlockHTML && cardA._state.liveBlockHTML.includes('8:41 - 3rd Quarter') && !cardA._state.removed,
    'updatePicksLiveStatusInPlace(): an EXISTING .live-block is replaced in place with the fresh quarter/clock text');

  // NO existing .live-block yet (game just went live) -> inserted after .matchup.
  const cardB = makeFakeCard({ hasLiveBlock: false });
  registry.set(midGame.gameId, cardB);
  updatePicksLiveStatusInPlace([midGame]);
  assert(!!cardB._state.insertedAfterMatchup && cardB._state.insertedAfterMatchup.includes('8:41 - 3rd Quarter'),
    'updatePicksLiveStatusInPlace(): a card with no .live-block yet gets one inserted right after .matchup');

  // A FINAL game must never even be queried for — the guard is the first line
  // of the loop, before any DOM touch.
  let queriedFinal = false;
  document.querySelectorAll = (sel) => {
    if (sel.includes(finalGame.gameId)) queriedFinal = true;
    const m = sel.match(/data-game-id="([^"]+)"/);
    if (!m) return [];
    const card = registry.get(m[1]);
    return card ? [card] : [];
  };
  updatePicksLiveStatusInPlace([finalGame]);
  assert(!queriedFinal, 'updatePicksLiveStatusInPlace(): a FINAL game is skipped before any DOM query — matches the render path\'s no-op');

  // A LIVE game with no matching card on the page (not on the Picks tab, or
  // simply not rendered) must not throw.
  let threw = false;
  try { updatePicksLiveStatusInPlace([midGame].map(g => ({ ...g, gameId: 'not_on_page' }))); }
  catch { threw = true; }
  assert(!threw, 'updatePicksLiveStatusInPlace(): a LIVE game with no matching card on the page is a silent no-op, not an error');

  document.querySelectorAll = originalQSA;
}

// ── 7h. Structural — runAutoRefreshTick() routes Picks through the surgical
//        patch and NEVER calls renderPicksPage() (that would wipe a draft pick).
console.log('\n[7h] Structural — runAutoRefreshTick() never calls renderPicksPage()…');
const tickFnMatch = appJsSrc.match(/export async function runAutoRefreshTick\(\)\s*\{[\s\S]*?\n\}/);
assert(!!tickFnMatch, 'fixture check: located runAutoRefreshTick() in app.js source');
const tickSrc = tickFnMatch ? tickFnMatch[0] : '';
// Strip full-line comments first — the function's own docstring legitimately
// NAMES renderPicksPage() in prose to explain why it's avoided, which would
// otherwise false-positive a naive substring scan.
const tickCodeOnly = tickSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
assert(/updatePicksLiveStatusInPlace\(/.test(tickCodeOnly),
  "runAutoRefreshTick() calls updatePicksLiveStatusInPlace() for the Picks tab's surgical patch");
assert(!/renderPicksPage\(\)/.test(tickCodeOnly),
  'runAutoRefreshTick() never calls renderPicksPage() as executable code — DI-2 requires the surgical patch so an in-progress draft pick is never wiped by a tick');

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
