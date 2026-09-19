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
 * Covers (FEAT-7 / UN-174 red zone, section 8):
 *   8a  fixture parse through the REAL pipeline — isRedZone + possessionSide,
 *       BOTH directions (home possession and away possession). A mapping bug
 *       that gets the side backwards is the single worst failure this feature
 *       can have: it would tell a player his pick is safe while the other team
 *       is inside the 20.
 *   8b  `situation` absent -> both fields null, nothing renders, quarter/clock
 *       behaviour byte-identical to before.
 *   8c  possession id matching no competitor -> possessionSide null, the
 *       team-less "🔴 RZ" state renders, no throw.
 *   8d  non-persistence: the record actually written by the live-refresh path
 *       carries neither key, proven by re-reading it AND by scanning the
 *       literal saveGame() call site.
 *   8e  staleness: max(90s, 2 x interval) — renders at +89s, gone at +121s on
 *       a 60s interval; 300s interval -> 600s threshold; interval Off -> the
 *       90s floor still applies.
 *   8f  halftime / end-of-period suppression regardless of isRedZone.
 *   8g  FINAL and SCHEDULED: no mark even with a stray Map entry.
 *   8h  render surfaces: matrix game-info cell, compact chip, Picks live block
 *       — and NEVER inside a pick-cell or a dc-chip (asserted structurally, so
 *       a future refactor that moves it into a pick cell fails the suite).
 *   8i  blind-rule non-interaction: live game under an OPEN week -> the mark
 *       renders and every other player's cell is still •••.
 *   8j  escHtml() on the team label; no `title=` attribute introduced.
 *   8k  CSS structural check: the new rules use only var(--…) tokens, no hex.
 *
 * NOT covered here (browser-only — see feature-builder's handoff notes):
 *   actual on-screen CSS pulse animation, the real 60s poll cadence, a live
 *   halftime bundle observed in a real browser tab, and whether the red-zone
 *   mark wraps acceptably beside the LIVE pill at 320px.
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
// F1 review F2 (2026-09-12) — ONE capturing element: #page-dashboard. Every
// other id still returns null, exactly as before. The red-zone LEGEND lives in
// renderDashboardInner()'s card wrapper, not in renderDashboardTable(), so it is
// unreachable from the three renderers this suite calls directly; reading it off
// the emitted page is the only way an assertion can see it at all.
const capturedEls = new Map();
function mkCaptureEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollTo() {}, focus() {},
  };
  capturedEls.set(id, e);
  return e;
}
mkCaptureEl('page-dashboard');

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => capturedEls.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...({}), set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' },
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
const { saveWeek, saveGame, getGame, getGames, setSession, addPlayer, getAvailableGames, saveAvailableGames, setActiveWeekId } = storage;
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

// ══════════════════════════════════════════════════════════════════════════
// FEAT-7 / UN-174 — RED ZONE (DI-174a data, DI-174b helper, DI-174c states,
// DI-174d Picks card, DI-174e copy, DI-174g render paths)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[8] FEAT-7 — red zone: parse, staleness, states, surfaces…');

const { redZoneDisplay, redZoneStaleMs } = app;
const { saveSetting, getWeek, saveAllPicks } = storage;
const { canViewOtherPicks } = app;

// ── 8a. THE REAL CAPTURED LIVE PAYLOAD — both possession directions ──────────
//
// THIS FIXTURE IS READ FROM THE FILE, NOT TRANSCRIBED. The section used to
// carry a hand-written payload with a SYNTHETIC_PENDING_LIVE_CAPTURE flag and a
// [KNOWN GAP] print, because nothing was in progress anywhere when FEAT-7 was
// built (2026-09-12, overnight) and a FINAL event carries no `situation` block
// at all. `capture-live-espn.mjs` caught a real slate at 2026-09-12T16:21:15Z
// from the exact scoreboard URL the app builds — 86 events, 14 live, 14 with a
// `situation`, one in the red zone — and wrote the trimmed rows below plus the
// full raw body beside them. COORDINATOR RULING 2 (2026-09-12 09:21 PDT)
// retires the flag and the print by this swap.
//
// Reading the file (rather than pasting an excerpt into this test) is the whole
// point: a transcription can drift from, or quietly "tidy", the shape ESPN
// actually sent, which is precisely the failure this section exists to rule
// out. Every `situation`, `status` and `competitors` value below is byte-for-
// byte what came off the wire.
//
// WHAT THE CAPTURE CHANGED ABOUT THE FEATURE (DI-174a amendment): four of the
// eight captured in-progress events carried NO `situation.possession` — and the
// ONE red-zone game was one of them (WAKE @ PUR, Q1 5:51; its last play was a
// timeout). Under DI-174a as originally written, the single case this feature
// exists for would have rendered the team-less "🔴 RZ". The amended resolution
// order (possession -> lastPlay.end.team.id -> lastPlay.team.id -> null) is
// asserted against that exact event in 8a-6/8a-7 below.
const RZ_FIXTURE_URL = new URL('../weekly bug fixes and feedback/Feedback batch 091226/live-cfb-fixture.json', import.meta.url);
const RZ_FIXTURE = JSON.parse(await readFile(RZ_FIXTURE_URL, 'utf8'));

assert(typeof RZ_FIXTURE.capturedAt === 'string' && /^2026-09-12T16:21/.test(RZ_FIXTURE.capturedAt)
       && Array.isArray(RZ_FIXTURE.events) && RZ_FIXTURE.events.length === 8,
  `8a-0: the red-zone payload is the REAL capture, read from live-cfb-fixture.json at test time (capturedAt ${RZ_FIXTURE.capturedAt}, ${RZ_FIXTURE.events?.length} events) — no synthetic payload and no [KNOWN GAP] flag remains in this section`);
assert(RZ_FIXTURE.redZoneGames?.length === 1 && RZ_FIXTURE.redZoneGames[0] === 'WAKE @ PUR',
  `8a-0b: the capture contains exactly one genuine red-zone game, WAKE @ PUR (got ${JSON.stringify(RZ_FIXTURE.redZoneGames)}) — a fixture with no red zone in it could not exercise this feature at all`);

/** One captured row by its ESPN shortName. Throws rather than returning
 *  undefined: a renamed/removed fixture row must break loudly here, not turn
 *  every assertion below into a vacuous pass on `undefined`. */
function rzRow(shortName) {
  const row = RZ_FIXTURE.events.find(e => e.shortName === shortName);
  if (!row) throw new Error(`livestatustest §8: fixture row "${shortName}" is missing from live-cfb-fixture.json`);
  return row;
}

/** Re-wrap a captured (trimmed) row in ESPN's scoreboard envelope.
 *  `status`, `situation` and `competitors` pass through BYTE-FOR-BYTE from the
 *  file. The capture script dropped only envelope fields the red zone does not
 *  touch (date/odds/broadcasts/notes/venue/timeValid), so those — and only
 *  those — are supplied here; `date` is the capture's own timestamp.
 *  `mutate` exists for the two negative cases that cannot be captured (a
 *  missing `situation`, an unresolvable possession id) and is applied to a
 *  DEEP COPY so one case can never leak into the next. */
function espnEventFromFixture(shortName, mutate = null) {
  const row = rzRow(shortName);
  const competition = {
    timeValid: true, neutralSite: false,
    odds: [], broadcasts: [], notes: [],
    venue: { fullName: 'Captured live fixture', address: { city: '', state: '' } },
    competitors: JSON.parse(JSON.stringify(row.competitors)),
  };
  if (row.situation) competition.situation = JSON.parse(JSON.stringify(row.situation));
  const ev = { id: row.id, date: RZ_FIXTURE.capturedAt, status: JSON.parse(JSON.stringify(row.status)),
               competitions: [competition] };
  if (mutate) mutate(ev.competitions[0]);
  return ev;
}

const rzWeek = { weekId: 'un174_wk', weekNumber: 5, season: 2026, status: 'live', dataSourceMode: 'live',
                 startDate: '2026-09-12', endDate: '2026-09-13' };
saveWeek(rzWeek);

/** A stored game for one captured event — REAL espnEventId (that is what
 *  refreshScoresByEventIds() matches on) and REAL school names. */
function storeFixtureGame(shortName, gameId) {
  const row = rzRow(shortName);
  const home = row.competitors.find(c => c.homeAway === 'home');
  const away = row.competitors.find(c => c.homeAway === 'away');
  saveGame(createGame(rzWeek.weekId, {
    gameId, espnEventId: row.id,
    homeTeam: home.team.location, awayTeam: away.team.location,
    status: GAME_STATUS.LIVE, homeScore: Number(home.score), awayScore: Number(away.score),
  }));
  return getGame(gameId);
}

// The red-zone game itself is the primary fixture for the rest of §8.
const rzGame      = storeFixtureGame('WAKE @ PUR', 'un174_g1');   // isRedZone true, NO possession
const rzPossHome  = storeFixtureGame('HOW @ IU',   'un174_g2');   // possession '84'  === home IU
const rzPossAway  = storeFixtureGame('ASU @ TA&M', 'un174_g3');   // possession '9'   === away ASU
const rzFallHome  = storeFixtureGame('ETSU @ UNC', 'un174_g4');   // no possession; lastPlay.end.team '153' === home UNC
const rzEmptySit  = storeFixtureGame('ORE @ OKST', 'un174_g5');   // a REAL empty `situation: {}` (weather delay)

async function refreshFixture(shortName, game, mutate = null) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [espnEventFromFixture(shortName, mutate)] }) });
  await doRefreshScores(rzWeek, [getGame(game.gameId)]);
  return liveStatusById.get(game.gameId);
}

const rzHomeEntry = await refreshFixture('HOW @ IU', rzPossHome);
assert(rzHomeEntry?.possessionSide === 'home',
  `8a-1: HOW @ IU — situation.possession '84' matches the HOME competitor id, resolves to 'home' (got ${JSON.stringify(rzHomeEntry?.possessionSide)})`);
assert(rzHomeEntry?.isRedZone === false,
  `8a-2: …and its isRedZone parses as the boolean FALSE ESPN actually sent, not null-by-accident (got ${JSON.stringify(rzHomeEntry?.isRedZone)})`);

const rzAwayEntry = await refreshFixture('ASU @ TA&M', rzPossAway);
assert(rzAwayEntry?.possessionSide === 'away',
  `8a-3: ASU @ TA&M — situation.possession '9' matches the AWAY competitor id, resolves to 'away'; the OTHER direction, which is the failure that would actively mislead (got ${JSON.stringify(rzAwayEntry?.possessionSide)})`);
assert(rzHomeEntry.possessionSide !== rzAwayEntry.possessionSide,
  '8a-4: the two directions genuinely differ — a hardcoded side would fail this');
assert(!('possession' in rzAwayEntry),
  '8a-5: the raw ESPN team id never leaves data-provider.js — no `possession` key on the transient entry');

// ── THE DI-174a AMENDMENT (COORDINATOR RULING 2) — possession ABSENT ────────
const rzRedZoneEntry = await refreshFixture('WAKE @ PUR', rzGame);
assert(rzRedZoneEntry?.isRedZone === true,
  '8a-6: WAKE @ PUR — the real red-zone flag parses true through parseAndReport -> refreshScoresByEventIds -> doRefreshScores');
assert(rzRow('WAKE @ PUR').situation.possession === undefined,
  '8a-6b: fixture check — this event genuinely has NO situation.possession, so 8a-7 cannot be passing through the primary field');
assert(rzRedZoneEntry?.possessionSide === 'away',
  `8a-7: …and possession resolves to 'away' (Wake Forest, id 154) from situation.lastPlay.end.team.id, because ESPN sent no situation.possession. THIS is the case the feature exists for; without the fallback it renders the team-less mark (got ${JSON.stringify(rzRedZoneEntry?.possessionSide)})`);
const rzRedZoneDisp = redZoneDisplay(rzRedZoneEntry, getGame(rzGame.gameId));
assert(rzRedZoneDisp && rzRedZoneDisp.label === '🔴 RZ · Wake Forest'
       && rzRedZoneDisp.ariaLabel === 'Wake Forest has the ball in the red zone'
       && rzRedZoneDisp.side === 'away',
  `8a-8: …so the mark names the team that actually has the ball, on the one captured red-zone game (got ${JSON.stringify(rzRedZoneDisp)})`);

const rzFallHomeEntry = await refreshFixture('ETSU @ UNC', rzFallHome);
assert(rzFallHomeEntry?.possessionSide === 'home',
  `8a-9: ETSU @ UNC — the same fallback in the HOME direction (lastPlay.end.team.id '153' === UNC), so the fallback is not hardcoded to 'away' either (got ${JSON.stringify(rzFallHomeEntry?.possessionSide)})`);

// ── 8b. `situation` absent, and `situation` present-but-empty ───────────────
// The capture script only kept events that HAD a situation, so the
// situation-absent case (every scheduled and every final event, which is most
// of the season) is produced by deleting the key from a captured event rather
// than by inventing a payload.
const rzNoSit = await refreshFixture('WAKE @ PUR', rzGame, (c) => { delete c.situation; });
assert(rzNoSit?.isRedZone === null && rzNoSit?.possessionSide === null,
  '8b-1: no `situation` block -> isRedZone null and possessionSide null, never undefined-by-accident');
assert(rzNoSit?.detail === '5:51 - 1st Quarter' && rzNoSit?.shortDetail === '5:51 - 1st',
  `8b-2: the Item 2 quarter/clock capture is byte-identical with the red-zone fields added — ESPN's own strings, verbatim (got ${JSON.stringify(rzNoSit?.detail)} / ${JSON.stringify(rzNoSit?.shortDetail)})`);
assert(redZoneDisplay(rzNoSit, getGame(rzGame.gameId)) === null, '8b-3: no situation -> helper returns null -> nothing renders');

assert(Object.keys(rzRow('ORE @ OKST').situation).length === 0,
  '8b-4: fixture check — ORE @ OKST was captured with a REAL empty `situation: {}` (a weather delay), a shape no synthetic payload would have thought to write');
const rzEmptyEntry = await refreshFixture('ORE @ OKST', rzEmptySit);
assert(rzEmptyEntry?.isRedZone === null && rzEmptyEntry?.possessionSide === null,
  '8b-5: an EMPTY situation object resolves exactly like an absent one — null/null, no throw, no `undefined` leaking onto the entry');

// ── 8c. possession id matching no competitor ────────────────────────────────
// Mutated from the real red-zone event: ESPN has never sent an unresolvable id,
// but the mapping must fail closed rather than guess if it ever does. The whole
// lastPlay chain is neutralised too, so this tests the id->side mapping itself
// and not merely the first link of the fallback ladder.
const rzOrphan = await refreshFixture('WAKE @ PUR', rzGame, (c) => {
  c.situation.possession = 'not-a-competitor-id';
  delete c.situation.lastPlay;
});
assert(rzOrphan?.isRedZone === true && rzOrphan?.possessionSide === null,
  '8c-1: an unresolvable possession id -> possessionSide null, no throw, flag preserved');
const orphanDisp = redZoneDisplay(rzOrphan, getGame(rzGame.gameId));
assert(orphanDisp && orphanDisp.label === '🔴 RZ' && !orphanDisp.label.includes('·'),
  `8c-2: state 4 renders the team-less mark "🔴 RZ" (got ${JSON.stringify(orphanDisp?.label)})`);
assert(orphanDisp.ariaLabel === 'A team has the ball in the red zone', '8c-3: team-less aria-label copy is exact');

// ── 8d. Non-persistence ─────────────────────────────────────────────────────
await refreshFixture('WAKE @ PUR', rzGame);
const rzPersisted = getGame(rzGame.gameId);
const rzDeepHits = findForbiddenKeysDeep(rzPersisted, ['isRedZone', 'possessionSide', 'situation', 'possession', '_liveStatus']);
assert(rzDeepHits.length === 0,
  `8d-1: the persisted game record carries no red-zone keys at ANY nesting depth after a live refresh (found ${JSON.stringify(rzDeepHits)})`);
assert(!/\bisRedZone\s*:/.test(saveGameCallText) && !/\bpossessionSide\s*:/.test(saveGameCallText),
  "8d-2: doRefreshScores()'s saveGame() allow-list literally contains neither isRedZone: nor possessionSide: — write volume to the Sheet is unchanged, zero delta");

// ── 8e. Staleness — max(90s, 2 x interval), dropped not caveated ─────────────
const RZ_NOW = 2_000_000_000_000;
const freshEntry = { name: 'STATUS_IN_PROGRESS', detail: 'x', shortDetail: 'x', isRedZone: true, possessionSide: 'away', capturedAt: RZ_NOW - 89_000 };
const staleEntry = { ...freshEntry, capturedAt: RZ_NOW - 121_000 };
const liveGameForHelper = { ...getGame(rzGame.gameId), status: GAME_STATUS.LIVE };
assert(redZoneStaleMs(60) === 120_000 && redZoneStaleMs(30) === 90_000 && redZoneStaleMs(300) === 600_000 && redZoneStaleMs(0) === 90_000,
  '8e-1: threshold is max(90s, 2 x interval) — 30s->90s, 60s->120s, 300s->600s, Off->90s floor');
assert(!!redZoneDisplay(freshEntry, liveGameForHelper, { nowMs: RZ_NOW, intervalSec: 60 }),
  '8e-2: 89s old on a 60s interval still renders');
assert(redZoneDisplay(staleEntry, liveGameForHelper, { nowMs: RZ_NOW, intervalSec: 60 }) === null,
  '8e-3: 121s old on a 60s interval renders NOTHING — dropped, never caveated (a stale red-zone flag is a false assertion, not a late one)');
assert(!!redZoneDisplay(staleEntry, liveGameForHelper, { nowMs: RZ_NOW, intervalSec: 300 }),
  '8e-4: the same 121s entry DOES render on the 5-minute interval — that is the freshness the commissioner chose');
assert(redZoneDisplay({ ...freshEntry, capturedAt: RZ_NOW - 91_000 }, liveGameForHelper, { nowMs: RZ_NOW, intervalSec: 0 }) === null,
  '8e-5: with the interval Off, the 90s floor still clears the mark');
saveSetting('autoRefreshInterval', 300);
assert(!!redZoneDisplay(staleEntry, liveGameForHelper, { nowMs: RZ_NOW }),
  '8e-6: with no intervalSec passed, the helper reads getSettings().autoRefreshInterval (300 here) rather than assuming 60');
saveSetting('autoRefreshInterval', 60);
assert(redZoneDisplay(staleEntry, liveGameForHelper, { nowMs: RZ_NOW }) === null,
  '8e-7: …and follows the setting back down to 60s');

// ── 8f. Halftime / end-of-period suppression ────────────────────────────────
for (const nm of ['STATUS_HALFTIME', 'STATUS_END_PERIOD']) {
  assert(redZoneDisplay({ ...freshEntry, name: nm, capturedAt: RZ_NOW }, liveGameForHelper, { nowMs: RZ_NOW }) === null,
    `8f: ${nm} suppresses the mark regardless of isRedZone — ESPN leaves the last snap's situation attached through a period break`);
}

// ── 8g. FINAL and SCHEDULED ─────────────────────────────────────────────────
assert(redZoneDisplay({ ...freshEntry, capturedAt: RZ_NOW }, { ...liveGameForHelper, status: GAME_STATUS.FINAL }, { nowMs: RZ_NOW }) === null,
  '8g-1: a FINAL game renders no mark even with a stray Map entry present');
assert(redZoneDisplay({ ...freshEntry, capturedAt: RZ_NOW }, { ...liveGameForHelper, status: GAME_STATUS.SCHEDULED }, { nowMs: RZ_NOW }) === null,
  '8g-2: a SCHEDULED game renders no mark either');
assert(redZoneDisplay({ ...freshEntry, isRedZone: false, capturedAt: RZ_NOW }, liveGameForHelper, { nowMs: RZ_NOW }) === null,
  '8g-3: isRedZone === false renders nothing (state 5)');

// ── 8h. The three render surfaces, and the places it must NEVER appear ──────
setSession('ig_p1', false, true);
const rzPlayers = [{ playerId: 'ig_p1', displayName: 'P1', active: true }, { playerId: 'ig_p2', displayName: 'P2', active: true }];
addPlayer({ playerId: 'ig_p2', displayName: 'P2', active: true });
let surfGame = createGame(rzWeek.weekId, {
  gameId: 'un174_surface', homeTeam: 'Texas', awayTeam: 'Arkansas',
  status: GAME_STATUS.LIVE, homeScore: 24, awayScore: 21, espnEventId: 'e_surface',
});
saveGame(surfGame);
surfGame = getGame(surfGame.gameId);
liveStatusById.set(surfGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '3:02 - 4th Quarter', shortDetail: '3:02 - 4th', isRedZone: true, possessionSide: 'away', capturedAt: Date.now() });
const rzPicks = rzPlayers.map(p => ({ pickId: `pk_${p.playerId}`, weekId: rzWeek.weekId, gameId: surfGame.gameId, playerId: p.playerId, selectedTeam: 'Texas', submittedAt: '2026-09-12T00:00:00Z' }));
const rzResults = rzPlayers.map(p => ({ playerId: p.playerId, correctPicks: 0, incorrectPicks: 0 }));

const rzTable = renderDashboardTable(rzPlayers, [surfGame], rzPicks, rzResults, rzWeek.weekId, null);
assert(/<span class="rz-mark"[^>]*>🔴 RZ · ARK<\/span>/.test(rzTable),
  '8h-1: the matrix renders 🔴 RZ · ARK — the away team has the ball, abbreviated by the matrix\'s own shortTeam() built from the shared buildAbbrMap() (F1 review F6: this used to say "the same helper the pick chips use", which is true of neither surface — the chat pick chips are a different call site; what both DASHBOARD layouts share is buildAbbrMap, and that is the property worth stating)');
assert(rzTable.indexOf('rz-mark') > rzTable.indexOf('live-pill') && rzTable.indexOf('rz-mark') < rzTable.indexOf('<td class="pick-cell'),
  '8h-2: the matrix mark sits AFTER the LIVE pill and BEFORE the first pick cell — i.e. inside the game-info cell');
assert(rzTable.split('<td class="pick-cell').slice(1).every(seg => !seg.includes('rz-mark')),
  '8h-3: the mark never appears inside a pick cell — it describes the GAME, not anybody\'s pick');
assert(/aria-label="Arkansas has the ball in the red zone"/.test(rzTable), '8h-4: aria-label copy is exact and names the school in full');

const rzCompact = renderDashboardCompact(rzPlayers, [surfGame], rzPicks, rzResults, rzWeek.weekId, null);
assert(/<span class="dc-status dc-redzone"[^>]*>🔴 RZ · ARK<\/span>/.test(rzCompact),
  '8h-5: the compact layout renders the mark as its OWN chip — a compact player does not silently lose the feature');
assert(rzCompact.indexOf('dc-redzone') > rzCompact.indexOf('dc-live-detail'),
  '8h-6: the red-zone chip follows the quarter/clock chip, never merged into it (the DI-5 precedent)');
assert(rzCompact.split('<div class="dc-chip').slice(1).every(seg => !seg.includes('dc-redzone')),
  '8h-7: the mark never appears inside a player chip');

const rzCard = renderGameCard(surfGame, null, PICK_RESULT.LIVE, false, true);
assert(/🔴 Red zone · Arkansas/.test(rzCard),
  '8h-8: the Picks-page game card renders the LONG form with the full school name (DI-174d APPROVED)');
assert(rzCard.indexOf('rz-mark') > rzCard.indexOf('live-status-detail'),
  '8h-9: on the Picks card the mark sits on its own line under the quarter/clock row');
{
  // updatePicksLiveStatusInPlace() needs NO change — it replaces the whole
  // .live-block this function produces. Verified, not edited.
  const patched = renderGameCard(surfGame, null, PICK_RESULT.LIVE, false, true);
  const block = patched.slice(patched.indexOf('<div class="live-block">'));
  assert(block.includes('rz-mark'),
    '8h-10: the mark lives INSIDE .live-block, so the in-place Picks patch carries it for free');
}
liveStatusById.delete(surfGame.gameId);
const rzTableNone = renderDashboardTable(rzPlayers, [surfGame], rzPicks, rzResults, rzWeek.weekId, null);
assert(!rzTableNone.includes('rz-mark'), '8h-11: no Map entry -> no mark anywhere (state 2), matrix identical to pre-FEAT-7');

// ── 8i. Blind-rule non-interaction ──────────────────────────────────────────
const openWeek = { weekId: 'un174_open', weekNumber: 6, season: 2026, status: 'open', dataSourceMode: 'live',
                   startDate: '2026-09-19', endDate: '2026-09-20' };
saveWeek(openWeek);
let blindGame = createGame(openWeek.weekId, {
  gameId: 'un174_blind', homeTeam: 'Texas', awayTeam: 'Arkansas',
  status: GAME_STATUS.LIVE, homeScore: 3, awayScore: 0, espnEventId: 'e_blind',
});
saveGame(blindGame);
blindGame = getGame(blindGame.gameId);
liveStatusById.set(blindGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '9:00 - 1st Quarter', shortDetail: '9:00 - 1st', isRedZone: true, possessionSide: 'home', capturedAt: Date.now() });
const blindPicks = rzPlayers.map(p => ({ pickId: `bpk_${p.playerId}`, weekId: openWeek.weekId, gameId: blindGame.gameId, playerId: p.playerId, selectedTeam: 'Texas', submittedAt: '2026-09-19T00:00:00Z' }));
// Both players must have SUBMITTED, or the matrix returns the "submit first"
// prompt instead of a grid and the blind cells below would be vacuous.
saveAllPicks(blindPicks);
assert(canViewOtherPicks(getWeek(openWeek.weekId)) === false, '8i-0: fixture check — the blind rule really is closed on this OPEN week');
const blindTable = renderDashboardTable(rzPlayers, [blindGame], blindPicks, rzResults, openWeek.weekId, null);
assert(blindTable.includes('rz-mark') && /🔴 RZ · TEX/.test(blindTable),
  '8i-1: the mark renders on a live game under an OPEN week — it describes the game and leaks nothing');
assert(blindTable.includes('pick-cell-blind') && blindTable.includes('•••'),
  '8i-2: …and every other player\'s pick cell is still •••, unchanged');

// ── 8j. escHtml + no title attribute ────────────────────────────────────────
let evilGame = createGame(rzWeek.weekId, {
  gameId: 'un174_evil', homeTeam: 'Texas', awayTeam: '<script>bad</script>',
  status: GAME_STATUS.LIVE, homeScore: 1, awayScore: 0, espnEventId: 'e_evil',
});
saveGame(evilGame);
evilGame = getGame(evilGame.gameId);
liveStatusById.set(evilGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: 'x', shortDetail: 'x', isRedZone: true, possessionSide: 'away', capturedAt: Date.now() });
const evilCard = renderGameCard(evilGame, null, PICK_RESULT.LIVE, false, true);
assert(!evilCard.includes('<script>bad</script>') && evilCard.includes('&lt;script&gt;'),
  '8j-1: the ESPN-sourced team name goes through escHtml() on the red-zone path — every time, no exceptions');
const evilTable = renderDashboardTable(rzPlayers, [evilGame], [], rzResults, rzWeek.weekId, null);
assert(!evilTable.includes('<script>bad</script>'), '8j-2: …and on the matrix path too');
const rzMarkTags = (rzTable.match(/<span class="rz-mark"[^>]*>/g) || [])
  .concat(rzCompact.match(/<span class="dc-status dc-redzone"[^>]*>/g) || [])
  .concat(rzCard.match(/<span class="rz-mark"[^>]*>/g) || []);
assert(rzMarkTags.length >= 3 && rzMarkTags.every(t => !/\btitle=/.test(t)),
  `8j-3: no red-zone element carries a title attribute on any surface (tooltips do not fire on touch) — checked ${rzMarkTags.length} tags`);

// ── 8k. CSS: tokens only, no hex ────────────────────────────────────────────
{
  const rzRules = (cssSrc.match(/^\.rz-mark\{[^}]*\}/m) || []).concat(cssSrc.match(/^\.dc-status\.dc-redzone\{[^}]*\}/m) || []);
  assert(rzRules.length === 2, `8k-1: both new red-zone CSS rules located (found ${rzRules.length})`);
  assert(rzRules.every(r => !/#[0-9A-Fa-f]{3,8}\b/.test(r)),
    '8k-2: neither rule contains a hex literal — colour comes from :root tokens only');
  assert(/\.rz-mark\{[^}]*var\(--live-bg\)[^}]*var\(--loss\)/.test(rzRules[0]),
    '8k-3: .rz-mark uses var(--loss) on var(--live-bg) — 5.91:1, AA. var(--live) would be 4.41:1 and FAIL (RG-42/RG-44)');
  assert(!/\.rz-mark\{[^}]*animation/.test(rzRules[0]),
    '8k-4: the mark carries no animation of its own — the pulsing .live-dot is already in the same row, so prefers-reduced-motion needs no new rule');
}

// ── 8l. The LEGEND — conditional, both directions (F1 review F2) ───────────
// DI-174e made the legend the touch-accessible replacement for a tooltip, and
// made it CONDITIONAL so it is not permanent clutter: present on a Saturday when
// a mark is actually on screen, absent the rest of the week. Nothing asserted
// either half. Deleting the legend outright, and making it unconditional, both
// left the suite green — the two mutations this section exists to turn red.
//
// Driven through window.navigateTo('dashboard') rather than a direct renderer
// call, because the legend lives in the CARD WRAPPER around the matrix, which is
// only assembled by renderDashboardInner().
{
  for (const g of getGames(rzWeek.weekId)) liveStatusById.delete(g.gameId);
  setActiveWeekId(rzWeek.weekId);
  setSession('ig_p1', false, true);
  // Picks must be ON FILE for this week, not merely passed to the renderer as
  // §8h does: renderDashboardTable() answers "No picks submitted yet." to an
  // empty week and the matrix — and therefore every mark in it — never renders.
  saveAllPicks(rzPlayers.map(p => ({ pickId: `rzl_${p.playerId}`, weekId: rzWeek.weekId,
    gameId: surfGame.gameId, playerId: p.playerId, selectedTeam: 'Texas',
    submittedAt: '2026-09-12T00:00:00Z' })));
  const dashHost = capturedEls.get('page-dashboard');
  const LEGEND = '🔴 RZ = that team has the ball inside the 20.';

  liveStatusById.set(surfGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '3:02 - 4th Quarter',
    shortDetail: '3:02 - 4th', isRedZone: true, possessionSide: 'away', capturedAt: Date.now() });
  dashHost._html = '';
  window.navigateTo('dashboard');
  const withMark = dashHost._html;
  assert(withMark.includes('rz-mark'),
    '8l-0: fixture check — the dashboard page really rendered the matrix WITH a red-zone mark on it (a page that never rendered would make both assertions below vacuous)');
  assert(withMark.includes('rz-legend') && withMark.includes(LEGEND),
    '8l-1: a mark on screen => the legend renders, with its exact copy — the only explanation of what 🔴 RZ means that a touch device can ever reach');

  for (const g of getGames(rzWeek.weekId)) liveStatusById.delete(g.gameId);
  dashHost._html = '';
  window.navigateTo('dashboard');
  const noMark = dashHost._html;
  assert(noMark.includes('All Picks by Game') && !noMark.includes('rz-mark'),
    '8l-2: fixture check — the same page re-rendered with no Map entry, so no mark is on screen');
  assert(!noMark.includes('rz-legend') && !noMark.includes(LEGEND),
    '8l-3: no mark => NO legend — it is a Saturday affordance, not a permanent line of chrome under the matrix every day of the week');

  // F3 review finding (2026-09-12) — A MARK ON SCREEN IS NOT ENOUGH. The matrix
  // has its own empty branch ("No picks submitted yet."), and the legend used to
  // sit outside it: a live red-zone game with nobody's picks on file printed an
  // explanation of a 🔴 RZ mark that was nowhere on the page. The legend is now
  // gated on the SAME condition the table is, so the two cannot disagree.
  for (const g of getGames(rzWeek.weekId)) storage.deletePicksForGame(g.gameId);
  liveStatusById.set(surfGame.gameId, { name: 'STATUS_IN_PROGRESS', detail: '3:02 - 4th Quarter',
    shortDetail: '3:02 - 4th', isRedZone: true, possessionSide: 'away', capturedAt: Date.now() });
  dashHost._html = '';
  window.navigateTo('dashboard');
  const noPicks = dashHost._html;
  assert(noPicks.includes('No picks submitted yet.'),
    '8l-4: fixture check — with no picks on file the matrix really does render its empty branch (otherwise the assertion below is vacuous)');
  assert(!noPicks.includes('rz-legend') && !noPicks.includes(LEGEND),
    '8l-5: …and the red-zone legend is absent with it — a legend explaining a mark that is nowhere on screen is chrome that lies');
  for (const g of getGames(rzWeek.weekId)) liveStatusById.delete(g.gameId);
}

// ══════════════════════════════════════════════════════════════════════════
// BUG-4 (fb_1788576195078_ejmps, Drew, filed 2026-09-05 against v0.17.10) —
// "You can see the live scores in the picks tab and can see if you're
// covering, but cant aee who you picked".
//
// After a player submits, the Picks tab renders every card through
// renderGameCard(game, pick.selectedTeam, result, true, /* showResult */ true).
// The picked team was indicated ONLY by `.pick-btn.selected` (and its
// live-covering / locked-win variants), and the whole `.pick-buttons` block is
// omitted whenever showResult is true — so the read-only card carried the
// score, the ⚡ Covering badge and the W/L badge, but nothing saying WHICH
// team you took. Not live-specific: the same card on a SCHEDULED or FINAL
// game was equally silent (9d/9e below), which is why the fix is in the
// matchup row rather than in the live block.
//
// The marker must live on `.matchup` — the one region of the card that every
// status renders and that updatePicksLiveStatusInPlace() never rewrites
// (9h/9i). Putting it in the live block would make it vanish on the first
// 60-second tick.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[9] BUG-4 — the submitted (read-only) card must show WHICH team you picked…');
{
  const MARK  = 'team-picked';
  const LABEL = 'Your pick';
  const countMark = h => (h.match(/team-picked/g) || []).length;
  // The away side is everything between the away team div and the @ divider;
  // the home side is everything from the divider to the spread row. Slicing on
  // the emitted markup (not on a source window) keeps this honest.
  const awaySide = h => h.slice(h.indexOf('<div class="team away'), h.indexOf('<div class="vs-divider"'));
  const homeSide = h => h.slice(h.indexOf('<div class="vs-divider"'), h.indexOf('<div class="spread-row"'));

  let b4Live = createGame(week7.weekId, {
    gameId: 'bug4_live', homeTeam: 'Oklahoma', awayTeam: 'Temple',
    status: GAME_STATUS.LIVE, homeScore: 21, awayScore: 14,
    spread: -7.5, favorite: 'Oklahoma', espnEventId: 'e_bug4',
  });
  saveGame(b4Live);
  b4Live = getGame(b4Live.gameId);
  liveStatusById.set(b4Live.gameId, { name: 'STATUS_IN_PROGRESS', detail: '5:10 - 3rd Quarter', shortDetail: '5:10 - 3rd', capturedAt: Date.now() });

  // The exact call renderSubmittedView() makes: isLocked=true, showResult=true.
  const liveAway = renderGameCard(b4Live, 'Temple', PICK_RESULT.LIVE, true, true);

  assert(liveAway.includes('Temple') && liveAway.includes('Oklahoma') && liveAway.includes('🔴 LIVE'),
    '9a-0: fixture check — the submitted-view card for a LIVE game genuinely rendered both teams and the live block (not a vacuous pass)');
  assert(liveAway.includes('⚡ Covering') || liveAway.includes('⚡ Trailing'),
    '9a-1: fixture check — the live tentative ATS badge Drew could already see is present, so this really is his screen');

  // ── THE REPORTED BUG ──
  assert(liveAway.includes(MARK) && liveAway.includes(LABEL),
    '9a: BUG-4 — a submitted pick on a LIVE game renders a visible "your pick" marker on the card');
  assert(countMark(liveAway) === 1,
    `9b-1: exactly ONE team is marked — the card never flags both sides (got ${countMark(liveAway)})`);
  assert(awaySide(liveAway).includes(MARK) && !homeSide(liveAway).includes(MARK),
    '9b-2: the marker sits on the AWAY block, the team actually picked — not on a fixed side');
  // BUG-4 review note (2026-09-12): 9b-2 pins the `.team-picked` CLASS to the
  // right block, and 9c proves the words "Your pick" exist somewhere on the
  // card — but nothing tied the two together. A `.team-pick-flag` rendered
  // outside the marked block (a sibling of .matchup, say) would pass both and
  // still tell the player nothing about WHICH team, which is the whole bug.
  assert(awaySide(liveAway).includes('team-pick-flag') && awaySide(liveAway).includes('Your pick') &&
         !homeSide(liveAway).includes('team-pick-flag') && !homeSide(liveAway).includes('Your pick'),
    '9b-3: the "✓ Your pick" flag is INSIDE the marked team block, not merely somewhere on the card — the copy and the highlight name the same team');

  const liveHome = renderGameCard(b4Live, 'Oklahoma', PICK_RESULT.LIVE, true, true);
  assert(homeSide(liveHome).includes(MARK) && !awaySide(liveHome).includes(MARK) && countMark(liveHome) === 1,
    '9c: picking the HOME team moves the marker to the home block — it tracks the pick, not the position');

  // ── Not live-specific. Same read-only card, other two statuses. ──
  let b4Sched = createGame(week7.weekId, {
    gameId: 'bug4_sched', homeTeam: 'Oklahoma', awayTeam: 'Temple',
    status: GAME_STATUS.SCHEDULED, spread: -7.5, favorite: 'Oklahoma',
  });
  saveGame(b4Sched);
  b4Sched = getGame(b4Sched.gameId);
  const schedCard = renderGameCard(b4Sched, 'Temple', PICK_RESULT.PENDING, true, true);
  assert(schedCard.includes(MARK) && awaySide(schedCard).includes(MARK) && countMark(schedCard) === 1,
    '9d: the same card on a SCHEDULED game (submitted, week still open) shows it too — the bug was never live-specific, so neither is the fix');

  let b4Final = createGame(week7.weekId, {
    gameId: 'bug4_final', homeTeam: 'Oklahoma', awayTeam: 'Temple',
    status: GAME_STATUS.FINAL, homeScore: 24, awayScore: 20,
    spread: -7.5, favorite: 'Oklahoma', actualWinner: 'Oklahoma', atsWinner: 'Temple',
  });
  saveGame(b4Final);
  b4Final = getGame(b4Final.gameId);
  const finalCard = renderGameCard(b4Final, 'Temple', PICK_RESULT.WIN, true, true);
  assert(finalCard.includes(MARK) && awaySide(finalCard).includes(MARK) && countMark(finalCard) === 1,
    '9e: a FINAL game shows it too — the W/L badge says HOW the pick went, never WHICH team it was');

  // ── Never invented, never doubled ──
  const noPick = renderGameCard(b4Live, null, PICK_RESULT.LIVE, true, true);
  assert(countMark(noPick) === 0 && !noPick.includes(LABEL),
    '9f: a card with no pick on file carries no marker at all — the card never invents one');
  const unknownPick = renderGameCard(b4Live, 'Some Other School', PICK_RESULT.LIVE, true, true);
  assert(countMark(unknownPick) === 0,
    '9f-2: a pick naming neither team on this card marks neither side (defensive — a stale pick after a slate edit)');

  const draftCard = renderGameCard(b4Live, 'Temple', PICK_RESULT.PENDING, false, false);
  assert(draftCard.includes('pick-btn selected'),
    '9g-1: fixture check — the DRAFT card still shows the selection on the pick button, exactly as before');
  assert(countMark(draftCard) === 0,
    '9g-2: …and gains no second marker — the draft view has exactly one picked-team indicator, the button');

  // ── DI-2 interaction: the marker must survive the 60s in-place patch ──
  const liveRegion = liveAway.slice(liveAway.indexOf('<div class="live-block">'), liveAway.indexOf('<div class="spread-row"'));
  assert(!/team-picked|team-pick-flag|Your pick/.test(liveRegion),
    '9h: NO part of the marker (class, flag element or copy) sits inside .live-block — updatePicksLiveStatusInPlace() replaces that whole region every tick and would otherwise wipe it');

  // Simulate the patch exactly as updatePicksLiveStatusInPlace() performs it:
  // the .live-block node's outerHTML is replaced with a freshly rendered block
  // (new quarter/clock), and nothing else on the card is touched.
  const oldBlockStart = liveAway.indexOf('<div class="live-block">');
  const oldBlockEnd   = liveAway.indexOf('<div class="spread-row"');
  const oldBlock      = liveAway.slice(oldBlockStart, oldBlockEnd);
  liveStatusById.set(b4Live.gameId, { name: 'STATUS_IN_PROGRESS', detail: '0:42 - 4th Quarter', shortDetail: '0:42 - 4th', capturedAt: Date.now() });
  const freshCard  = renderGameCard(b4Live, 'Temple', PICK_RESULT.LIVE, true, true);
  const freshBlock = freshCard.slice(freshCard.indexOf('<div class="live-block">'), freshCard.indexOf('<div class="spread-row"'));
  const patched    = liveAway.replace(oldBlock, freshBlock);
  assert(patched.includes('0:42 - 4th Quarter') && !patched.includes('5:10 - 3rd Quarter'),
    '9i-1: fixture check — the simulated in-place patch really did swap the live block for the fresh one');
  assert(patched.includes(MARK) && patched.includes(LABEL) && countMark(patched) === 1,
    '9i-2: the "your pick" marker survives the in-place live patch untouched — a tick mid-game cannot take it away');

  // ── House rules ──
  const markTags = liveAway.match(/<[^>]*team-picked[^>]*>/g) || [];
  const flagTags = liveAway.match(/<[^>]*team-pick-flag[^>]*>/g) || [];
  assert(markTags.length + flagTags.length > 0 && [...markTags, ...flagTags].every(t => !/\btitle=/.test(t)),
    '9j-1: no element of the marker carries a title attribute (tooltips do not fire on touch)');
  let evilPick = createGame(week7.weekId, {
    gameId: 'bug4_evil', homeTeam: 'Oklahoma', awayTeam: '<script>bad</script>',
    status: GAME_STATUS.LIVE, homeScore: 3, awayScore: 0, spread: -7.5, favorite: 'Oklahoma',
  });
  saveGame(evilPick);
  evilPick = getGame(evilPick.gameId);
  const evilMarked = renderGameCard(evilPick, '<script>bad</script>', PICK_RESULT.LIVE, true, true);
  assert(!evilMarked.includes('<script>bad</script>') && evilMarked.includes('&lt;script&gt;') && evilMarked.includes(MARK),
    '9j-2: a hostile team name is still escHtml-escaped on the marked side — the marker did not open a raw-interpolation hole');

  const pickedRules = (cssSrc.match(/^\.team\.team-picked\{[^}]*\}/m) || []).concat(cssSrc.match(/^\.team-pick-flag\{[^}]*\}/m) || []);
  assert(pickedRules.length === 2, `9k-1: both new marker CSS rules located (found ${pickedRules.length})`);
  assert(pickedRules.every(r => !/#[0-9A-Fa-f]{3,8}\b/.test(r)),
    '9k-2: neither rule contains a hex literal — colour comes from :root tokens only');
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
