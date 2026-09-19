/**
 * CFB Pickems — requesttest.mjs (FEAT-2 / UN-175, DI-175l, 2026-09-12)
 * ====================================================================
 * The logic proof for player game requests. Precedent: grouptest.mjs (UN-118)
 * and feedbacktest.mjs — a separate, readable-start-to-finish file, not more
 * assertions buried among loadtest.mjs's chat-fold suite.
 *
 * Run:  node requesttest.mjs
 * And:  TZ=UTC node requesttest.mjs && TZ=America/Los_Angeles node requesttest.mjs
 *
 * BOTH TIMEZONES ARE LOAD-BEARING, not ceremony. `gameDate` is pinned to
 * AMERICA/CHICAGO (storage.js centralDateKey) because the commissioner's
 * Available Games pool groups by Central date; §8 below asserts that a 23:30
 * Pacific Saturday kickoff files under the Central SUNDAY, which is the exact
 * case a machine-local implementation gets wrong on a west-coast phone.
 *
 * SECTIONS
 *   1  Fold — pending / withdrawn, and a withdraw from the wrong player.
 *   2  The fold never rewrites an input row (what keeps _unionById safe).
 *   3  Derived onSlate, from cfbp_games, in any week, with no write.
 *   4  Week matching — inclusive both ends, and the reschedule rule.
 *   5  Grouping by game; duplicate request from the same player refused.
 *   6  The cap of 3, and what does and does not count against it.
 *   7  Retention — 21 days hides, never deletes.
 *   8  Timezone pinning (Central), asserted under both TZs.
 *   9  Blind rule, structurally: no pick-shaped field exists on the record.
 *  10  Escaping in all six render paths (CONVENTIONS #12/#21).
 *  11  Append-only by construction — withdrawal grows the array.
 *
 * MUTATION PROOF (§11 of DI-175l) is run by hand, against a scratch copy,
 * AFTER committing — never `git checkout`. The mutations and their RED
 * assertions are recorded in the build report.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / localStorage stubs — layouttest.mjs's shape, trimmed to what the
// render paths under test actually touch. ───────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollTo() {}, focus() {},
  };
  els.set(id, e);
  return e;
}
['page-rules', 'page-commissioner', 'page-picks'].forEach(mkEl);
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => els.get(id) || null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('tmp'),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in requesttest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] requesttest.mjs — FEAT-2 / UN-175 game requests\n`);

const storage = await import('./js/storage.js');
const app     = await import('./js/app.js');
const {
  setBackendMode, addPlayer, setSession, clearSession, saveWeek, saveGame,
  centralDateKey, foldGameRequests, groupGameRequests, gameRequestMatchesWeek,
  getGameRequestRows, countOpenGameRequests, submitGameRequest, withdrawGameRequest,
  GAME_REQUEST_CAP, GAME_REQUEST_RETENTION_DAYS,
} = storage;

setBackendMode('local');

// ── Fixtures ────────────────────────────────────────────────────────────────
const TODAY = centralDateKey();
function dateAdd(key, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12) + days * 86400000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
const FUTURE = dateAdd(TODAY, 30);

let n = 0;
function req(over = {}) {
  n += 1;
  return {
    id: 'gr_t' + n, kind: 'request', playerId: 'p1', playerName: 'Drew',
    espnEventId: '401600' + n, espnSport: 'college-football',
    homeTeam: 'Ohio State', awayTeam: 'Michigan', homeMascot: 'Buckeyes', awayMascot: 'Wolverines',
    homeRank: 2, awayRank: 5, kickoff: `${FUTURE}T17:00:00Z`, gameDate: FUTURE,
    season: 2026, createdAt: '2026-09-12T10:00:0' + (n % 10) + '.000Z', appVersion: 'v0.21.1',
    ...over,
  };
}
function wd(target, playerId = 'p1', id = 'gr_w' + (n += 1)) {
  return { id, kind: 'withdraw', targetRequestId: target, playerId, createdAt: '2026-09-12T11:00:00.000Z' };
}
const NO_WEEKS = [];
const NO_GAMES = [];

// ═════════════════════════════════════════════════════════════════════════
console.log('[1] Fold — pending, withdrawn, and a withdraw from the wrong player…');
{
  const a = req();
  const only = foldGameRequests({ rows: [a], games: NO_GAMES, weeks: NO_WEEKS, today: TODAY });
  assert(only.length === 1 && only[0].status === 'pending', 'a lone request folds to pending');

  const withdrawn = foldGameRequests({ rows: [a, wd(a.id)], games: NO_GAMES, weeks: NO_WEEKS, today: TODAY });
  assert(withdrawn.length === 1 && withdrawn[0].status === 'withdrawn',
    'a matching withdraw row from the SAME player folds the request to withdrawn');
  assert(withdrawn.every(r => r.kind === 'request'),
    'the tombstone itself is never emitted as a row — it is an operator, not a request');

  const foreign = foldGameRequests({ rows: [a, wd(a.id, 'p2')], games: NO_GAMES, weeks: NO_WEEKS, today: TODAY });
  assert(foreign[0].status === 'pending',
    'a withdraw from a DIFFERENT playerId is ignored — one player cannot retract another\'s ask');

  const orphan = foldGameRequests({ rows: [a, wd('gr_nope')], games: NO_GAMES, weeks: NO_WEEKS, today: TODAY });
  assert(orphan[0].status === 'pending', 'a withdraw pointing at nothing changes nothing');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] The fold never rewrites an input row…');
{
  const rows = [req(), req({ playerId: 'p2', playerName: 'Kevin' })];
  rows.push(wd(rows[0].id));
  const before = JSON.stringify(rows);
  const out = foldGameRequests({ rows, games: NO_GAMES, weeks: NO_WEEKS, today: TODAY });
  assert(JSON.stringify(rows) === before,
    'the input array is byte-identical after the fold — no row gained a status field');
  assert(out.every(r => 'status' in r) && rows.every(r => !('status' in r)),
    'status exists ONLY on the returned copies. A local field flip on a row the remote also holds is exactly what _unionById() silently reverts (backend.js)');
  assert(out[0] !== rows[0], 'the fold returns new objects, not the stored ones');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] Derived onSlate — from cfbp_games, any week, no write…');
{
  const a = req();
  const slate = [{ gameId: 'g_other_week', weekId: 'w_99', espnEventId: a.espnEventId }];
  const out = foldGameRequests({ rows: [a], games: slate, weeks: NO_WEEKS, today: TODAY });
  assert(out[0].status === 'onSlate', 'a slate game sharing the espnEventId flips the status — in ANY week');
  assert(!('status' in a), '…and nothing was written back to the request row');

  const missA = foldGameRequests({ rows: [a], games: [{ gameId: 'g2', espnEventId: 'zzz' }], weeks: NO_WEEKS, today: TODAY });
  assert(missA[0].status === 'pending', 'a different event id does not match — the key is exact, never a name guess');

  const strId = foldGameRequests({ rows: [req({ espnEventId: 401700 })], games: [{ espnEventId: '401700' }], weeks: NO_WEEKS, today: TODAY });
  assert(strId[0].status === 'onSlate', 'numeric vs string event ids still match — ESPN hands both shapes back');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] Week matching — inclusive both ends, plus the reschedule rule…');
{
  const WEEK = { weekId: 'w1', weekNumber: 3, season: 2026, status: 'draft', startDate: '2026-11-26', endDate: '2026-11-28' };
  const onStart = req({ gameDate: '2026-11-26' });
  const onEnd   = req({ gameDate: '2026-11-28' });
  const before  = req({ gameDate: '2026-11-25' });
  const after   = req({ gameDate: '2026-11-29' });
  assert(gameRequestMatchesWeek(onStart, WEEK), 'gameDate === startDate matches (inclusive)');
  assert(gameRequestMatchesWeek(onEnd, WEEK),   'gameDate === endDate matches (inclusive)');
  assert(!gameRequestMatchesWeek(before, WEEK), 'one day before the start does not match');
  assert(!gameRequestMatchesWeek(after, WEEK),  'one day after the end does not match');

  // RULE 2 — ESPN moved the game. The snapshot says a date outside this week;
  // the fetched pool says the event is in it. The pool wins.
  const moved = req({ gameDate: '2026-12-05', espnEventId: '999888' });
  assert(!gameRequestMatchesWeek(moved, WEEK), 'fixture check: rule 1 alone drops the rescheduled game');
  assert(gameRequestMatchesWeek(moved, WEEK, [{ espnEventId: '999888' }]),
    'rule 2: an event id present in THIS week\'s avail pool matches even when the snapshot date falls outside the range');
  assert(!gameRequestMatchesWeek(moved, WEEK, [{ espnEventId: '111' }]),
    '…and an unrelated pool does not rescue it');

  // missed vs passed, both behind us.
  const past = req({ gameDate: '2026-09-05' });
  const LOCKED = { weekId: 'wl', season: 2026, status: 'locked', startDate: '2026-09-03', endDate: '2026-09-06' };
  const missed = foldGameRequests({ rows: [past], games: NO_GAMES, weeks: [LOCKED], today: '2026-09-12' });
  assert(missed[0].status === 'missed', 'a past request inside a locked week reads "week built without it"');
  const passed = foldGameRequests({ rows: [past], games: NO_GAMES, weeks: [], today: '2026-09-12' });
  assert(passed[0].status === 'passed', 'a past request with no week covering it simply passed');
  const draftWk = foldGameRequests({ rows: [past], games: NO_GAMES, weeks: [{ ...LOCKED, status: 'draft' }], today: '2026-09-12' });
  assert(draftWk[0].status === 'passed', 'a week that exists but never locked is not a "missed" — nothing was built');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5] Grouping by game; duplicates refused…');
{
  const e = '401ABC';
  const drew  = req({ espnEventId: e, playerId: 'p1', playerName: 'Drew',  createdAt: '2026-09-10T10:00:00.000Z' });
  const kevin = req({ espnEventId: e, playerId: 'p2', playerName: 'Kevin', createdAt: '2026-09-11T10:00:00.000Z' });
  const other = req({ espnEventId: '401ZZZ', playerId: 'p2', playerName: 'Kevin' });
  const folded = foldGameRequests({ rows: [kevin, drew, other], games: NO_GAMES, weeks: NO_WEEKS, today: TODAY });
  const groups = groupGameRequests(folded);
  assert(groups.length === 2, 'two players on one event id collapse to ONE row; a third game keeps its own');
  const g = groups.find(x => x.espnEventId === e);
  assert(g.names.join(', ') === 'Drew, Kevin',
    'requester names come out oldest-ask-first, stable across renders (got: ' + g.names.join(', ') + ')');
  const again = groupGameRequests(foldGameRequests({ rows: [drew, kevin, other], games: NO_GAMES, weeks: NO_WEEKS, today: TODAY }));
  assert(again.find(x => x.espnEventId === e).names.join(', ') === 'Drew, Kevin',
    '…and the order does not depend on the order the rows arrived in');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6] The cap of 3 — and what does not count against it…');
{
  storage.save?.call?.(null);   // no-op: save() is module-private by design (AD-02)
  localStorage.removeItem('cfbp_game_requests');
  localStorage.removeItem('cfbp_games');
  addPlayer({ playerId: 'cap_p', displayName: 'CapTester', active: true, preferences: {} });

  const mk = (i) => submitGameRequest({
    playerId: 'cap_p', playerName: 'CapTester', espnEventId: 'cap_e' + i,
    homeTeam: 'Home' + i, awayTeam: 'Away' + i, kickoff: `${FUTURE}T17:00:00Z`,
    gameDate: FUTURE, season: 2026, appVersion: 'v0.21.1',
  });
  assert(GAME_REQUEST_CAP === 3, 'the cap is 3 open requests per player (coordinator ruling Q3)');
  const r1 = mk(1), r2 = mk(2), r3 = mk(3);
  assert(r1.ok && r2.ok && r3.ok, 'the first three requests are accepted');
  const r4 = mk(4);
  assert(!r4.ok && r4.reason === 'cap', 'the FOURTH open request is refused with reason "cap"');
  assert(getGameRequestRows().filter(r => r.kind === 'request').length === 3,
    '…and the refused request was never appended');

  assert(withdrawGameRequest(r2.request.id, 'cap_p').ok, 'withdrawing one succeeds');
  assert(countOpenGameRequests('cap_p') === 2, 'the withdrawn row stops counting as open');
  const r5 = mk(5);
  assert(r5.ok, 'a slot re-opens after a withdrawal');

  // Duplicate — same player, same event, still open.
  const dup = submitGameRequest({
    playerId: 'cap_p', playerName: 'CapTester', espnEventId: 'cap_e1',
    homeTeam: 'Home1', awayTeam: 'Away1', kickoff: `${FUTURE}T17:00:00Z`, gameDate: FUTURE,
  });
  assert(!dup.ok && dup.reason === 'duplicate', 'the same player cannot request the same game twice');

  // A settled row does not hold a slot.
  saveWeek({ weekId: 'cap_w', weekNumber: 1, season: 2026, status: 'open', startDate: FUTURE, endDate: FUTURE });
  saveGame({ gameId: 'cap_g', weekId: 'cap_w', espnEventId: 'cap_e3', homeTeam: 'Home3', awayTeam: 'Away3', status: 'scheduled' });
  assert(countOpenGameRequests('cap_p') === 2,
    'a request whose game reached the slate stops counting against the cap (3 rows open, one now onSlate)');

  // On-slate is blocked by CONSTRUCTION — this is the blind-rule adjacency.
  const onSlateTry = submitGameRequest({
    playerId: 'cap_p', playerName: 'CapTester', espnEventId: 'cap_e3',
    homeTeam: 'Home3', awayTeam: 'Away3', kickoff: `${FUTURE}T17:00:00Z`, gameDate: FUTURE,
  });
  assert(!onSlateTry.ok && onSlateTry.reason === 'onSlate',
    'requesting a game that is ALREADY on a slate is refused — which is what removes the only blind-rule adjacency this feature has');

  // Another player is unaffected by the first player's cap.
  const otherPlayer = submitGameRequest({
    playerId: 'cap_p2', playerName: 'Kevin', espnEventId: 'cap_e1',
    homeTeam: 'Home1', awayTeam: 'Away1', kickoff: `${FUTURE}T17:00:00Z`, gameDate: FUTURE,
  });
  assert(otherPlayer.ok, 'the cap is PER PLAYER — a second player can still ask for the same game');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[7] Retention — 21 days HIDES, and never deletes…');
{
  assert(GAME_REQUEST_RETENTION_DAYS === 21, 'the retention window is 21 days');
  const old20 = req({ id: 'gr_old20', gameDate: dateAdd(TODAY, -20) });
  const old22 = req({ id: 'gr_old22', gameDate: dateAdd(TODAY, -22) });
  const rows = [old20, old22];
  const out = foldGameRequests({ rows, games: NO_GAMES, weeks: NO_WEEKS, today: TODAY });
  assert(out.some(r => r.id === 'gr_old20'), 'a row 20 days past its game is still visible');
  assert(!out.some(r => r.id === 'gr_old22'), 'a row 22 days past its game is hidden from every view');
  assert(rows.length === 2 && rows.some(r => r.id === 'gr_old22'),
    '…and is STILL PRESENT in the stored array — hiding is not deleting, because a shrinking write is what the append-only union merge cannot survive');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[8] Timezone pinning — gameDate is CENTRAL, under both TZs…');
{
  // 23:30 Pacific on Saturday 2026-11-28 == 01:30 Central on SUNDAY 2026-11-29.
  const latePT = '2026-11-28T23:30:00-08:00';
  assert(centralDateKey(latePT) === '2026-11-29',
    `a 23:30 PT Saturday kickoff files under the Central SUNDAY (got ${centralDateKey(latePT)})`);
  // Noon Central on the Saturday stays on the Saturday, in any machine zone.
  assert(centralDateKey('2026-11-28T18:00:00Z') === '2026-11-28',
    'a noon-Central Saturday kickoff stays on Saturday regardless of the machine\'s TZ');
  assert(centralDateKey('2026-01-01T05:30:00Z') === '2025-12-31',
    'a New Year\'s Eve 11:30pm Central kickoff does not roll into next season\'s date');
  assert(centralDateKey('not a date') === '', 'garbage in reads as empty, never as "today"');
  const built = submitGameRequest({
    playerId: 'tz_p', playerName: 'TZ', espnEventId: 'tz_e1',
    homeTeam: 'H', awayTeam: 'A', kickoff: latePT,
  });
  assert(built.ok && built.request.gameDate === '2026-11-29',
    'submitGameRequest() derives the same Central date when no gameDate is supplied');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[9] Blind rule, structurally — no pick-shaped field on the record…');
{
  const row = getGameRequestRows().find(r => r.kind === 'request');
  const keys = Object.keys(row);
  const PICKISH = /^(selectedTeam|pick|pickId|picks|selection|chosenTeam|side|againstTheSpread|ats)$/i;
  assert(!keys.some(k => PICKISH.test(k)),
    'the stored record carries no field naming a selected team — a request names a GAME, never a side (keys: ' + keys.join(',') + ')');
  const serialized = JSON.stringify(row);
  assert(!/selectedTeam|pickId/.test(serialized),
    'nor does the serialized row, which is what actually reaches the Sheet');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[10] Escaping — all six render paths (CONVENTIONS #12/#21)…');
{
  localStorage.removeItem('cfbp_game_requests');
  const XSS = '<script>alert(1)</script>';
  addPlayer({ playerId: 'x_p', displayName: XSS, active: true, preferences: {} });
  const XWEEK = { weekId: 'x_w', weekNumber: 9, season: 2026, status: 'open', startDate: FUTURE, endDate: FUTURE, dataSourceMode: 'espn' };
  saveWeek(XWEEK);
  const ok = submitGameRequest({
    playerId: 'x_p', playerName: XSS, espnEventId: 'x_e1',
    homeTeam: XSS, awayTeam: XSS, kickoff: `${FUTURE}T17:00:00Z`, gameDate: FUTURE, season: 2026,
  });
  assert(ok.ok, 'fixture check: the hostile request was created');
  const poolGame = {
    espnEventId: 'x_e1', homeTeam: XSS, awayTeam: XSS, homeMascot: '', awayMascot: '',
    // `favorite` is deliberately BENIGN. The three admin list renderers below
    // interpolate formatSpread()'s output (which embeds the favorite's name)
    // WITHOUT escHtml — a pre-existing gap on all three, unrelated to this
    // feature, on a field that only ever comes from ESPN or the commissioner's
    // own game modal. Reported to the reviewer rather than fixed here, because
    // it is outside this build's approved surface. Putting the hostile string
    // there would make this suite fail on code FEAT-2 never touched.
    homeRank: null, awayRank: null, kickoff: `${FUTURE}T17:00:00Z`, spread: -3, favorite: 'Ohio State',
    status: 'scheduled', homeScore: null, awayScore: null, dataQuality: 'complete',
  };
  // The `data-game='{…json…}'` attribute on the PRE-EXISTING add path is
  // stripped before the scan, deliberately and with the reason stated: JSON
  // inside a single-quoted attribute value is never parsed as markup (the HTML
  // tokenizer is in attribute-value state), and availAddPayloadJSON() escapes
  // the only character that could break out of it — the single quote. Scanning
  // it would make this guard cry wolf against behaviour that shipped long
  // before this feature. The escape itself is asserted separately below.
  const stripPayloads = (html) => html.replace(/data-game='[^']*'/g, "data-game=''");
  const clean = (html, label) => {
    assert(!/<script>/.test(stripPayloads(html)), label + ' — no raw <script> survives');
    assert(html.includes('&lt;script&gt;'), label + ' — the hostile string is present, escaped (proving the check is not vacuous)');
  };

  // 1 + 2: the Rules card — "Your requests" (signed in) and the league block.
  setSession('x_p', false, true);
  clean(app.renderGameRequestCardHTML(), 'path 1/2: Rules card, signed in');
  clearSession();
  clean(app.renderGameRequestCardHTML(), 'path 2: Rules card league block, signed out');

  // 3: the commissioner card.
  clean(app.renderGameRequestsAdminSectionHTML(XWEEK, [poolGame], []), 'path 3: Comm Player Requests card');

  // 4/5/6: the three chip surfaces carry the requester NAME in an aria-label.
  clean(app.renderAvailableGamesList([poolGame], [], XWEEK), 'path 4: Available Games row chip');
  // renderSuggestedGameRow() is module-private; renderSuggestedSlatePreview()
  // is its only caller and covers BOTH the suggested 10 and the DI-4
  // shortlist, which is exactly the pair the one helper serves.
  clean(app.renderSuggestedSlatePreview(
    { suggested: [poolGame], shortlist: [poolGame], almaCount: 0, morningAnchorFilled: true, closingAnchorFilled: true },
    [], XWEEK), 'path 5: suggested + shortlist row chip');
  clean(app.renderAdminGamesList([{ ...poolGame, gameId: 'x_g', weekId: 'x_w', lockedSpread: null }], XWEEK, {}),
    'path 6: Selected Slate row chip');

  // The chip itself: count-only, named for assistive tech, and never a tooltip.
  const chip = app.gameRequestChipHTML(poolGame);
  assert(/🙋 1/.test(chip), 'the chip is COUNT-only');
  assert(/aria-label="Requested by /.test(chip), 'the chip names the requesters in an aria-label');
  assert(!/\btitle=/.test(chip), '…and carries NO title attribute — tooltips do not fire on touch');
  assert(app.gameRequestChipHTML({ espnEventId: 'nobody_asked' }) === '',
    'a game nobody asked for grows no chip at all');
  assert(/aria-label="Requested by &lt;script&gt;/.test(chip),
    'the requester NAME — the one piece of user-typed data this feature adds to the three admin lists — is escaped inside the aria-label');
  const availHtml = app.renderAvailableGamesList([poolGame], [], XWEEK);
  const payloadAttr = (availHtml.match(/data-game='([^']*)'/) || [])[1] || '';
  assert(payloadAttr.length > 0 && !payloadAttr.includes("'") && payloadAttr.includes('&#39;') === false,
    'the add-path payload sits inside a single-quoted attribute and contains no unescaped single quote (this fixture has none to escape)');
  assert(JSON.parse(payloadAttr).homeTeam === XSS,
    '…and round-trips the hostile team name intact as DATA, which is what the add path needs');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[11] Append-only by construction…');
{
  const before = getGameRequestRows().length;
  const target = getGameRequestRows().find(r => r.kind === 'request' && r.playerId === 'x_p');
  const res = withdrawGameRequest(target.id, 'x_p');
  const after = getGameRequestRows();
  assert(res.ok && after.length === before + 1, 'a withdrawal GROWS the array by one tombstone row');
  assert(!!after.find(r => r.id === target.id),
    '…and the original request row is still there, unedited');
  assert(JSON.stringify(after.find(r => r.id === target.id)) === JSON.stringify(target),
    '…byte-identical to what was written');
  assert(!withdrawGameRequest(target.id, 'someone_else').ok,
    'another player cannot withdraw it');
  assert(!withdrawGameRequest('no_such_row', 'x_p').ok, 'withdrawing a row that does not exist fails cleanly');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[12] Placement + the exact copy strings (DI-175a/g)…');
{
  const rulesSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const cardIdx = rulesSrc.indexOf('${renderGameRequestCardHTML()}');
  const fbIdx   = rulesSrc.indexOf('<div class="card feedback-card">');
  const relIdx  = rulesSrc.indexOf('${renderReleaseNotesCardHTML()}');
  assert(cardIdx > 0 && fbIdx > 0 && cardIdx < fbIdx,
    'the request card renders ABOVE the feedback card on the Rules page (DI-175a)');
  assert(relIdx > fbIdx, '…and FEAT-3\'s release-notes card still sits below it, above the version footer');

  clearSession();
  app.renderRulesPage();
  const html = document.getElementById('page-rules').innerHTML;
  assert(html.includes('🙋 Request a Game'), 'the card reaches the rendered Rules page');
  assert(html.includes("Want a game on an upcoming slate? Flag it for the commissioner now — even for a week that hasn't been built yet."),
    'body copy is verbatim DI-175g');
  assert(html.includes('Log in on the Picks tab to request a game.') && html.includes('>Go to Picks<'),
    'signed out: the ACTION is replaced, the information is not hidden');
  assert(html.indexOf('Open requests from the league') > 0,
    'the league block renders for a signed-out visitor (coordinator ruling Q6)');

  const admin = app.renderGameRequestsAdminSectionHTML(null, [], []);
  assert(/^\s*<div class="admin-section" data-comm-tab="games">/.test(admin),
    'the commissioner card is tagged data-comm-tab="games" — an untagged .admin-section renders on ALL FIVE tabs (RG-10)');
  assert(admin.includes('🙋 Player Requests (0)') && admin.includes("No player requests for this week's dates."),
    'empty state copy is verbatim');
  const LOCKED_W = { weekId: 'lw', weekNumber: 2, season: 2026, status: 'locked', startDate: FUTURE, endDate: FUTURE };
  const lockedHtml = app.renderGameRequestsAdminSectionHTML(LOCKED_W, [{ espnEventId: 'x_e1', homeTeam: 'H', awayTeam: 'A' }], []);
  assert(lockedHtml.includes('This week is locked — requests below are for the record.'),
    'a locked week carries the locked note');
  assert(!lockedHtml.includes('+ Add to slate'),
    '…and offers NO add button — adding a game to a locked slate would create a game nobody could pick');

  // The open-week case really does offer the add path, from the POOLED object.
  localStorage.removeItem('cfbp_game_requests');
  localStorage.removeItem('cfbp_games');
  const OPEN_W = { weekId: 'ow', weekNumber: 3, season: 2026, status: 'open', startDate: FUTURE, endDate: FUTURE, dataSourceMode: 'espn' };
  submitGameRequest({ playerId: 'p_add', playerName: 'Drew', espnEventId: 'add_e1',
    homeTeam: 'Ohio State', awayTeam: 'Michigan', kickoff: `${FUTURE}T17:00:00Z`, gameDate: FUTURE });
  const pooled = { espnEventId: 'add_e1', homeTeam: 'Ohio State', awayTeam: 'Michigan', homeMascot: 'Buckeyes',
    awayMascot: 'Wolverines', kickoff: `${FUTURE}T20:00:00Z`, spread: -7.5, favorite: 'Ohio State',
    spreadSource: 'espn', nationalTV: true, broadcastNetwork: 'FOX', status: 'scheduled',
    homeScore: null, awayScore: null, dataQuality: 'complete' };
  const openHtml = app.renderGameRequestsAdminSectionHTML(OPEN_W, [pooled], []);
  assert(openHtml.includes('requested by Drew'), 'requester names are VISIBLE TEXT on the commissioner row, not a hover');
  assert(openHtml.includes('class="btn btn-primary btn-sm add-avail-game-btn gr-add-btn"'),
    'the action reuses the EXACT .add-avail-game-btn class the existing handler binds — not a parallel add path');
  const m = openHtml.match(/data-game='([^']+)'/);
  assert(!!m, 'fixture check: the add button carries a data-game payload');
  const payload = JSON.parse(m[1].replace(/&#39;/g, "'"));
  assert(payload.kickoff === `${FUTURE}T20:00:00Z` && payload.spread === -7.5 && payload.broadcastNetwork === 'FOX',
    'the payload comes from the POOLED ESPN object — current spread/kickoff/TV — never from the months-old request snapshot');
  const noPool = app.renderGameRequestsAdminSectionHTML(OPEN_W, [], []);
  assert(noPool.includes('Fetch ESPN for these dates to add') && !noPool.includes('add-avail-game-btn'),
    'with nothing fetched for those dates the row says so plainly instead of offering a button that cannot work');

  // Later-weeks block: the guarantee that nothing silently vanishes.
  const FAR_W = { weekId: 'fw', weekNumber: 4, season: 2026, status: 'open', startDate: dateAdd(TODAY, 90), endDate: dateAdd(TODAY, 91) };
  const far = app.renderGameRequestsAdminSectionHTML(FAR_W, [], []);
  assert(far.includes('Requests for later weeks (1)'),
    'a request whose date falls outside the active week appears under "Requests for later weeks" — it is never silently dropped');
  assert(far.includes('🙋 Player Requests (0)'),
    '…and is correctly absent from this week\'s count');
}

// ═════════════════════════════════════════════════════════════════════════
// 13. F3 review findings (2026-09-12) — the header chip counts the SAME set the
//     league block shows, and the ESPN empty state names both possibilities.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[13] F3 findings — header count vs the league block; the honest ESPN empty state…');
{
  const countOf = (html) => {
    const chip = html.match(/<span class="gr-count-chip">(\d+) open<\/span>/);
    return chip ? Number(chip[1]) : 0;
  };
  const leagueOf = (html) => {
    const sum = html.match(/Open requests from the league \((\d+)\)/);
    return sum ? Number(sum[1]) : -1;
  };

  // ── A SOLE REQUESTER. D5 hides a group in which the viewer is the only
  //    requester, so the league block shows nothing — and the header chip used
  //    to say "2 open" directly above "Nobody has an open request right now."
  localStorage.removeItem('cfbp_game_requests');
  localStorage.removeItem('cfbp_games');
  storage.addPlayer({ playerId: 'solo_p', displayName: 'Solo', active: true });
  storage.addPlayer({ playerId: 'other_p', displayName: 'Other', active: true });
  const SOLO_D = dateAdd(TODAY, 12);
  submitGameRequest({ playerId: 'solo_p', playerName: 'Solo', espnEventId: 'solo_e1',
    homeTeam: 'Texas', awayTeam: 'Baylor', kickoff: `${SOLO_D}T17:00:00Z`, gameDate: SOLO_D });
  submitGameRequest({ playerId: 'solo_p', playerName: 'Solo', espnEventId: 'solo_e2',
    homeTeam: 'TCU', awayTeam: 'SMU', kickoff: `${SOLO_D}T21:00:00Z`, gameDate: SOLO_D });
  setSession('solo_p', false, true);
  const soloHtml = app.renderGameRequestCardHTML();
  assert(soloHtml.includes('Nobody has an open request right now.'),
    'fixture check: a sole requester really does see the empty league block (D5 hides own-only groups)');
  assert(countOf(soloHtml) === leagueOf(soloHtml) && countOf(soloHtml) === 0,
    `13-1: the header chip counts the SAME set the league block shows — a sole requester sees no "N open" chip above "Nobody has an open request right now." (chip ${countOf(soloHtml)}, block ${leagueOf(soloHtml)})`);

  // ── SOMEBODY ELSE ASKS TOO. The same two surfaces must still agree.
  submitGameRequest({ playerId: 'other_p', playerName: 'Other', espnEventId: 'solo_e3',
    homeTeam: 'Iowa', awayTeam: 'Purdue', kickoff: `${SOLO_D}T18:00:00Z`, gameDate: SOLO_D });
  const mixedHtml = app.renderGameRequestCardHTML();
  assert(leagueOf(mixedHtml) === 1 && countOf(mixedHtml) === 1,
    `13-2: …and with one request from someone else on file, both surfaces say 1 (chip ${countOf(mixedHtml)}, block ${leagueOf(mixedHtml)})`);
  clearSession();
  const outHtml = app.renderGameRequestCardHTML();
  assert(countOf(outHtml) === leagueOf(outHtml) && countOf(outHtml) === 3,
    `13-3: signed out there is no "own-only" group to hide, so both surfaces report all three (chip ${countOf(outHtml)}, block ${leagueOf(outHtml)})`);

  // ── The ESPN empty state. resilientFetch() RETURNS {games:[], error} rather
  //    than throwing, and fetchByDateRange() overwrites the quality report, so
  //    an online device with every proxy down lands in the 'empty' branch. The
  //    copy must not claim to know that ESPN simply hasn't published yet.
  const appSrc13 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const EMPTY_COPY = "No games found for that date. ESPN may not have published the schedule yet, or couldn't be reached — try again, or try a date closer to game week.";
  assert(appSrc13.includes(EMPTY_COPY),
    '13-4: the DI-175g empty state names BOTH possibilities verbatim — "not published yet" alone is a confident wrong answer about somebody else\'s server');
  assert(!appSrc13.includes("ESPN hasn't published a schedule for that date yet."),
    '13-5: …and the old single-cause wording is gone, not merely supplemented');
}

// ═════════════════════════════════════════════════════════════════════════
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
