/**
 * CFB Pickems — gradetest.mjs
 * ===========================
 * The commissioner's SCORE-ENTRY paths, driven end to end.
 *
 * Run:  node gradetest.mjs
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `atstest.mjs` proves `calculateAtsWinner()` correct in 248 hand-derived
 * assertions. That proof is worth nothing to a player if the buttons Drew
 * actually presses every week never call it — and they did not. Four sites in
 * `js/app.js` carried their own private copy of the adjusted-score comparison,
 * so the same game could grade two different ways depending on which button
 * was pressed. That is the exact shape of the v0.13–v0.15 spread bug (AD-03):
 * one rule, several copies, one of them wrong.
 *
 * The private copies all opened with:
 *
 *     const sv = g.lockedSpread !== null ? g.lockedSpread : g.spread;
 *
 * `!== null` does not catch `undefined`. A game record with an ABSENT
 * `lockedSpread` key passes that test, `sv` becomes `undefined`, `hs + sv` is
 * `NaN`, and `NaN` fails BOTH the push test and the `>` test — so control
 * falls to the else branch and the AWAY team is persisted as the cover. Not
 * pending. Not blank. A wrong, money-deciding answer, always on the same side,
 * written into `game.atsWinner`, which `evaluatePick()` then prefers forever.
 *
 * `JSON.stringify` drops `undefined` properties, and the backend is a Sheet
 * holding JSON, so a game can acquire an absent key permanently. `app.js`
 * itself already guards `undefined` explicitly in two places that predate this
 * file (the auto-lock at OPEN→LOCKED, and `data-model.js`'s spread reader) —
 * the codebase already knew absent keys occur. The score-entry paths did not.
 *
 * WHAT THIS FILE ASSERTS
 * ----------------------
 * Behaviour and PERSISTED STATE, never the presence of a function name in
 * source — with one deliberate, labelled exception in section [6], which
 * asserts that a piece of code does NOT exist. A "there is no second copy"
 * property has no runtime observable; a structural assertion is the only kind
 * that can express it, and drift back to a second copy is the specific failure
 * this whole file exists to prevent.
 *
 * HOW IT DRIVES THE APP
 * ---------------------
 * `bindCommEventListeners()` is the one place the commissioner panel's click
 * handlers are attached. The stub DOM below registers elements by id, records
 * the listeners bound to them, and then fires them — so every assertion runs
 * the same code path a click in the browser runs, including the modal, and
 * asserts on what came back out of the `load()`/`save()` seam afterwards.
 *
 * SECTIONS
 *   1  Batch score grid — the weekly-use path
 *   2  Demo "Set Final" — single-game quick edit
 *   3  Demo "Finalize All & Calculate"
 *   4  Game modal Save — lockedSpread must govern, not the live line
 *   5  Agreement: every entry path grades a given game identically
 *   6  [structural] no second implementation of the comparison in app.js
 */

import { readFile } from 'node:fs/promises';

// ═════════════════════════════════════════════════════════════════════════════
// DOM / localStorage stubs. Shape follows loadtest.mjs's, with one addition:
// elements are REGISTERED by id and remember their listeners so a test can
// fire them. Everything else stays as inert as loadtest's.
// ═════════════════════════════════════════════════════════════════════════════
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();     // id -> stub element
const selectorSets = new Map(); // css selector -> array of stub nodes

function makeEl(id) {
  const listeners = new Map();
  const e = {
    id,
    value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
    /** Fire every listener of `type`. Throws if nothing is bound — a silent
     *  no-op here would look exactly like a passing test. */
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`gradetest: nothing bound to '${type}' on #${id}`);
      for (const fn of fns) fn({ target: e, ...ev });
    },
    _bound: type => (listeners.get(type) || []).length > 0,
  };
  return e;
}

/** Register (or fetch) an element under `id`. */
function el(id) {
  if (!registry.has(id)) registry.set(id, makeEl(id));
  return registry.get(id);
}
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
  // The game modal builds itself with createElement + innerHTML, then reaches
  // its own controls with ov.querySelector('#m-save'). An unregistered element
  // whose querySelector shares the registry reproduces that exactly.
  createElement: () => makeEl('__detached__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in gradetest'); };
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

const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const scoring = await import('./js/scoring.js');
const { bindCommEventListeners } = app;
const { saveGame, getGame } = storage;
const { calculateAtsWinner } = scoring;

console.log('[gradetest] app.js imported —', Object.keys(app).length, 'exports');

// ── Fixture helpers ──────────────────────────────────────────────────────────

const WEEK = {
  weekId: 'gt_w1', weekNumber: 1, label: 'Week 1', season: 2026,
  status: 'live', dataSourceMode: 'manual',
  picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
  actualTiebreakerValue: null, tiebreakerFinalized: false,
  blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
};

/**
 * Write games through the storage seam's own accessors, then read them BACK.
 * The read-back matters: the seam JSON-stringifies, which is what makes an
 * absent `lockedSpread` key survive as an absent key — the exact record shape
 * this file is about. Nothing here bypasses `saveGame`/`getGames`.
 */
function seedGames(games) {
  localStorage.clear();
  storage.saveWeek(WEEK);
  for (const g of games) saveGame(g);
  return storage.getGames(WEEK.weekId);
}

const GAME = (o = {}) => ({
  gameId: 'gt_g1', weekId: WEEK.weekId,
  homeTeam: 'HOME', awayTeam: 'AWAY', homeMascot: '', awayMascot: '',
  homeConference: '', awayConference: '', homeRank: null, awayRank: null,
  kickoff: '2026-09-05T17:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
  spread: null, favorite: null, lockedSpread: null,
  homeScore: null, awayScore: null,
  status: 'scheduled', actualWinner: null, atsWinner: null,
  isAlmaMaterGame: false, multiplier: 1, isManual: false,
  dataSource: 'manual', dataQuality: 'manual', spreadSource: 'manual',
  ...o,
});

/** Bind the commissioner panel against the current stub DOM. */
function bindComm(games) {
  bindCommEventListeners(WEEK, games, [], [], storage.getSettings(), [WEEK]);
}

/** A stub <tr> for the batch score grid. */
function batchRow(gameId, { home, away, status }) {
  const cells = {
    '.batch-home-score': { value: String(home) },
    '.batch-away-score': { value: String(away) },
    '.batch-status': { value: status },
  };
  return { dataset: { gameId }, querySelector: sel => cells[sel] || null, querySelectorAll: () => [] };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE BATCH SCORE GRID — Commissioner → Week → "💾 Apply All Changes".
//    This is the weekly-use path: Drew types the whole slate's scores into the
//    grid and applies them in one click.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Batch score grid — "Apply All Changes"…');
{
  // ── 1a. THE REPRODUCTION ───────────────────────────────────────────────────
  // A game with an ABSENT `lockedSpread` key and a live spread of -7 (home
  // favored by 7). Home wins 31–17, a 14-point margin. Hand-derived:
  //     adjusted home = 31 + (-7) = 24;  24 > 17  →  HOME covered.
  // There is no reading of this game under which AWAY covered.
  const absent = GAME({ gameId: 'gt_absent', spread: -7, favorite: 'HOME' });
  delete absent.lockedSpread;
  resetDom();
  const games = seedGames([absent]);
  assert(!('lockedSpread' in getGame('gt_absent')),
    'fixture: the stored record genuinely has NO lockedSpread key after the JSON round-trip through save()');

  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('gt_absent', { home: 31, away: 17, status: 'final' })]);
  bindComm(games);
  el('demo-batch-apply')._fire('click');

  const after = getGame('gt_absent');
  assert(after.status === 'final', 'the grid promoted the game to final');
  assert(after.homeScore === 31 && after.awayScore === 17, 'the grid persisted the entered scores');
  assert(after.atsWinner === 'HOME',
    `absent lockedSpread, home -7 winning by 14 → 31-7=24 > 17 → HOME covered; persisted ${JSON.stringify(after.atsWinner)}`);
  assert(after.atsWinner !== 'AWAY',
    'and specifically NOT the away team — the NaN fall-through always lands on away, which is how a wrong cover reaches a player silently');
  assert(after.atsWinner === calculateAtsWinner(after),
    'the grid and calculateAtsWinner() agree on the persisted record');
}
{
  // ── 1b. A plainly correct input must still grade the same as before. ───────
  // lockedSpread -3, away wins 21-20. adjusted = 20-3 = 17 < 21 → AWAY.
  const g = GAME({ gameId: 'gt_ok', spread: -3, lockedSpread: -3, favorite: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('gt_ok', { home: 20, away: 21, status: 'final' })]);
  bindComm(games);
  el('demo-batch-apply')._fire('click');
  const a = getGame('gt_ok');
  assert(a.atsWinner === 'AWAY', 'locked -3, home loses 20-21 → 20-3=17 < 21 → AWAY covers (unchanged behaviour)');
  assert(a.actualWinner === 'AWAY', 'straight-up winner still computed from the raw scores');
}
{
  // ── 1c. lockedSpread must govern the grid, not the live line. ─────────────
  // Locked at -3, line later moved to -10. Home wins 24-20 (by 4).
  //   against the LOCKED line: 24-3 = 21 > 20  → HOME covered
  //   against the LIVE line:   24-10 = 14 < 20 → AWAY covered
  const g = GAME({ gameId: 'gt_moved', spread: -10, lockedSpread: -3, favorite: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('gt_moved', { home: 24, away: 20, status: 'final' })]);
  bindComm(games);
  el('demo-batch-apply')._fire('click');
  assert(getGame('gt_moved').atsWinner === 'HOME',
    'locked -3 governs over a live -10: 24-3=21 > 20 → HOME covers, a mid-week line move cannot rescore it');
}
{
  // ── 1d. A push through the grid. locked -14, home wins by exactly 14. ─────
  const g = GAME({ gameId: 'gt_push', spread: -14, lockedSpread: -14, favorite: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('gt_push', { home: 28, away: 14, status: 'final' })]);
  bindComm(games);
  el('demo-batch-apply')._fire('click');
  assert(getGame('gt_push').atsWinner === 'no_decision',
    'locked -14, home wins by exactly 14 → 28-14=14 == 14 → push');
}
{
  // ── 1e. No spread at all: nothing can decide, so nothing may be persisted.
  const g = GAME({ gameId: 'gt_nospread' });
  resetDom();
  const games = seedGames([g]);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('gt_nospread', { home: 30, away: 3, status: 'final' })]);
  bindComm(games);
  el('demo-batch-apply')._fire('click');
  assert(getGame('gt_nospread').atsWinner === null,
    'no spread on file → atsWinner stays null (pending), never a team');
}
{
  // ── 1f. A blank score cell must not be read as zero. ──────────────────────
  const g = GAME({ gameId: 'gt_blank', spread: -7, lockedSpread: -7, favorite: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('gt_blank', { home: '', away: '', status: 'final' })]);
  bindComm(games);
  el('demo-batch-apply')._fire('click');
  assert(getGame('gt_blank').atsWinner === null,
    'final status with blank score cells → atsWinner null, not a cover computed from 0–0');
}
{
  // ── 1g. Resetting a graded game to scheduled clears the cover. ────────────
  const g = GAME({ gameId: 'gt_reset', spread: -7, lockedSpread: -7, favorite: 'HOME',
    status: 'final', homeScore: 31, awayScore: 17, actualWinner: 'HOME', atsWinner: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('gt_reset', { home: '', away: '', status: 'scheduled' })]);
  bindComm(games);
  el('demo-batch-apply')._fire('click');
  const a = getGame('gt_reset');
  assert(a.atsWinner === null && a.homeScore === null,
    'back to scheduled → scores and cover both cleared, no stale ATS left behind');
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. DEMO "✅ Set Final" — the single-game quick edit above the batch grid.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Demo quick edit — "Set Final"…');
{
  const absent = GAME({ gameId: 'gt_sf', spread: -7, favorite: 'HOME' });
  delete absent.lockedSpread;
  resetDom();
  const games = seedGames([absent]);
  el('demo-game-select').value = 'gt_sf';
  el('demo-home-score').value = '31';
  el('demo-away-score').value = '17';
  el('demo-set-final');
  bindComm(games);
  el('demo-set-final')._fire('click');
  const a = getGame('gt_sf');
  assert(a.status === 'final' && a.homeScore === 31 && a.awayScore === 17, 'Set Final persisted status and scores');
  assert(a.atsWinner === 'HOME',
    `absent lockedSpread, home -7 winning by 14 → 31-7=24 > 17 → HOME covered; persisted ${JSON.stringify(a.atsWinner)}`);
}
{
  const g = GAME({ gameId: 'gt_sf2', spread: -10, lockedSpread: -3, favorite: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  el('demo-game-select').value = 'gt_sf2';
  el('demo-home-score').value = '24';
  el('demo-away-score').value = '20';
  el('demo-set-final');
  bindComm(games);
  el('demo-set-final')._fire('click');
  assert(getGame('gt_sf2').atsWinner === 'HOME',
    'Set Final honours the locked -3 over the live -10: 24-3=21 > 20 → HOME covers');
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. DEMO "🏁 Finalize All & Calculate".
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Demo "Finalize All & Calculate"…');
//
//    NOTE on what this section can and cannot see. The handler ends by calling
//    `finalizeWeek()`, which recomputes ATS with the shared function — but only
//    for games whose `lockedSpread !== null`. That masks the inline copy's
//    errors on locked games and leaves them fully exposed on NEVER-LOCKED ones,
//    which is why the fixtures below carry `lockedSpread: null`. That gate is
//    itself the fourth reported issue; see the note at the end of this section.
{
  const absent = GAME({ gameId: 'gt_fa', spread: -7, favorite: 'HOME',
    status: 'live', homeScore: 31, awayScore: 17 });
  delete absent.lockedSpread;
  // Never locked, and the live line came back from the Sheet as a STRING.
  // `31 + '-7'` is the string '31-7', which loses every numeric comparison,
  // so the old copy fell through to AWAY.
  const strSpread = GAME({ gameId: 'gt_fa_str', spread: '-7', lockedSpread: null,
    favorite: 'HOME', status: 'live', homeScore: 31, awayScore: 17 });
  // Never locked, no live line either: nothing can decide this game.
  const noSpread = GAME({ gameId: 'gt_fa_nospread', spread: null, lockedSpread: null,
    status: 'live', homeScore: 31, awayScore: 17 });
  // Already final but the scores never arrived — the `null + sv` trap. `null`
  // coerces to 0 on both sides, so the old copy read a scoreless game as 0–0
  // and handed the cover to AWAY.
  const scoreless = GAME({ gameId: 'gt_fa_noscore', spread: -7, lockedSpread: null,
    favorite: 'HOME', status: 'final' });
  // A final game whose spread was later cleared: the cover it still carries is
  // no longer derivable from anything, so it must not survive a recompute.
  const cleared = GAME({ gameId: 'gt_fa_cleared', spread: null, lockedSpread: null,
    status: 'final', homeScore: 31, awayScore: 17, actualWinner: 'HOME', atsWinner: 'HOME' });
  resetDom();
  const games = seedGames([absent, strSpread, noSpread, scoreless, cleared]);
  el('demo-finalize-all');
  bindComm(games);
  el('demo-finalize-all')._fire('click');

  const a = getGame('gt_fa');
  assert(a.status === 'final' && a.atsWinner === 'HOME',
    `Finalize All: absent lockedSpread, 31-17 on a -7 line → 31-7=24 > 17 → HOME covered; persisted ${JSON.stringify(a.atsWinner)}`);
  assert(getGame('gt_fa_str').atsWinner === 'HOME',
    `Finalize All: never-locked '-7' as a string still means -7 → 31-7=24 > 17 → HOME covered; persisted ${JSON.stringify(getGame('gt_fa_str').atsWinner)}`);
  assert(getGame('gt_fa_nospread').atsWinner === null,
    `Finalize All: no line anywhere → null, never a team; persisted ${JSON.stringify(getGame('gt_fa_nospread').atsWinner)}`);
  assert(getGame('gt_fa_noscore').atsWinner === null,
    `Finalize All: a final game with no scores grades to null, not to a cover invented from 0–0; persisted ${JSON.stringify(getGame('gt_fa_noscore').atsWinner)}`);
  assert(getGame('gt_fa_cleared').atsWinner === null,
    `Finalize All: a final game whose spread was cleared drops its stale cover instead of keeping it; persisted ${JSON.stringify(getGame('gt_fa_cleared').atsWinner)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. THE GAME MODAL — Commissioner → Games → ✏️ → Save Game.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Game modal — Save Game…');

/** The ✏️ button next to a game in the Games tab. Must exist BEFORE binding —
 *  the binder walks `.edit-game-btn` at bind time, exactly as the browser does
 *  after `renderCommPage()` writes the list. */
function prepareEditButton(gameId) {
  const editBtn = makeEl('__edit__');
  editBtn.dataset.gameId = gameId;
  selectorSets.set('.edit-game-btn', [editBtn]);
  return editBtn;
}

/** Register the modal's fields, fire the edit button, then fire Save. */
function driveModal(editBtn, gameId, fields) {
  const g = getGame(gameId);
  el('m-home').value = fields.home ?? g.homeTeam;
  el('m-away').value = fields.away ?? g.awayTeam;
  el('m-home-mascot').value = ''; el('m-away-mascot').value = '';
  el('m-kickoff').value = '2026-09-05T17:00';
  el('m-spread-fav').value = fields.fav ?? '';
  el('m-spread-margin').value = fields.margin ?? '';
  el('m-mult-preset').value = '1';
  el('m-hs').value = fields.hs ?? '';
  el('m-as').value = fields.as ?? '';
  el('m-status').value = fields.status ?? 'scheduled';
  el('m-venue').value = ''; el('m-hconf').value = ''; el('m-aconf').value = '';
  el('m-hrank').value = ''; el('m-arank').value = '';
  el('m-espn-eventid').value = '';
  el('m-save');
  editBtn._fire('click');       // opens the modal, binds #m-save
  el('m-save')._fire('click');  // Save Game
}

{
  // Locked at -3; the commissioner re-opens the game and the live line reads
  // -10. Home won 24-20. The LOCKED line is what players were graded against.
  //   locked -3 → 24-3 = 21 > 20 → HOME covered
  //   live  -10 → 24-10 = 14 < 20 → AWAY covered
  const g = GAME({ gameId: 'gt_modal', spread: -10, lockedSpread: -3, favorite: 'HOME',
    status: 'final', homeScore: 24, awayScore: 20, actualWinner: 'HOME', atsWinner: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  const btn = prepareEditButton('gt_modal');
  bindComm(games);
  driveModal(btn, 'gt_modal', { fav: 'home', margin: '10', hs: '24', as: '20', status: 'final' });
  const a = getGame('gt_modal');
  assert(a.lockedSpread === -3, 'the modal leaves lockedSpread alone — it edits the live line only');
  assert(a.spread === -10, 'the modal saved the live line the commissioner entered');
  assert(a.atsWinner === 'HOME',
    `the modal grades against the LOCKED -3 (24-3=21 > 20 → HOME), not the live -10; persisted ${JSON.stringify(a.atsWinner)}`);
}
{
  // Nothing locked: the live line is all there is, and it must be used.
  const g = GAME({ gameId: 'gt_modal2', spread: null, lockedSpread: null, status: 'scheduled' });
  resetDom();
  const games = seedGames([g]);
  const btn = prepareEditButton('gt_modal2');
  bindComm(games);
  driveModal(btn, 'gt_modal2', { fav: 'away', margin: '3', hs: '20', as: '24', status: 'final' });
  const a = getGame('gt_modal2');
  assert(a.spread === 3, 'favourite + positive margin still produces the signed home-perspective spread (away favored → +3)');
  assert(a.atsWinner === 'AWAY',
    'nothing locked → the live +3 decides: 20+3=23 < 24 → AWAY covers');
}
{
  // A final game whose spread is cleared in the modal must drop its cover.
  const g = GAME({ gameId: 'gt_modal3', spread: -7, lockedSpread: null, favorite: 'HOME',
    status: 'final', homeScore: 31, awayScore: 17, actualWinner: 'HOME', atsWinner: 'HOME' });
  resetDom();
  const games = seedGames([g]);
  const btn = prepareEditButton('gt_modal3');
  bindComm(games);
  driveModal(btn, 'gt_modal3', { fav: '', margin: '', hs: '31', as: '17', status: 'final' });
  const a = getGame('gt_modal3');
  assert(a.spread === null, 'the spread really was cleared');
  assert(a.atsWinner === null,
    `clearing the spread on a final game drops the cover it can no longer justify, rather than keeping a stale one; persisted ${JSON.stringify(a.atsWinner)}`);
}
{
  // Absent lockedSpread key, through the modal.
  const absent = GAME({ gameId: 'gt_modal4', spread: -7, favorite: 'HOME',
    status: 'final', homeScore: 31, awayScore: 17, actualWinner: 'HOME' });
  delete absent.lockedSpread;
  resetDom();
  const games = seedGames([absent]);
  const btn = prepareEditButton('gt_modal4');
  bindComm(games);
  driveModal(btn, 'gt_modal4', { fav: 'home', margin: '7', hs: '31', as: '17', status: 'final' });
  assert(getGame('gt_modal4').atsWinner === 'HOME',
    'modal, absent lockedSpread: falls back to the live -7 → 31-7=24 > 17 → HOME covers');
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. AGREEMENT — the headline invariant. One game, four entry paths, one
//    answer. This is the property the whole task is about: "reliably" means
//    the button pressed cannot change who covered.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Agreement across every score-entry path…');
{
  // Deliberately awkward records: absent key, blank string, numeric string,
  // locked PK (falsy zero), and a moved line. Each is a shape a Sheet round
  // trip can produce.
  const SHAPES = [
    { name: 'absent lockedSpread key', patch: g => { delete g.lockedSpread; g.spread = -7; }, hs: 31, as: 17, want: 'HOME',
      why: 'live -7, home by 14 → 31-7=24 > 17' },
    { name: 'blank-string lockedSpread', patch: g => { g.lockedSpread = ''; g.spread = 3; }, hs: 20, as: 24, want: 'AWAY',
      why: 'unusable locked value yields to live +3 → 20+3=23 < 24' },
    { name: 'numeric-string lockedSpread', patch: g => { g.lockedSpread = '-3'; g.spread = -10; }, hs: 24, as: 20, want: 'HOME',
      why: 'a locked line that round-tripped through a text field still governs → 24-3=21 > 20' },
    { name: 'locked PK (zero)', patch: g => { g.lockedSpread = 0; g.spread = -14; }, hs: 21, as: 20, want: 'HOME',
      why: 'locked 0 is a real locked line, not a falsy blank → 21+0=21 > 20' },
    { name: 'moved line', patch: g => { g.lockedSpread = -3; g.spread = -10; }, hs: 24, as: 20, want: 'HOME',
      why: 'locked -3 governs → 24-3=21 > 20' },
    { name: 'push on the locked line', patch: g => { g.lockedSpread = -14; g.spread = -14; }, hs: 28, as: 14, want: 'no_decision',
      why: '28-14=14 == 14' },
  ];

  for (const s of SHAPES) {
    const results = {};

    // (a) batch grid
    {
      const g = GAME({ gameId: 'agree' }); s.patch(g);
      resetDom(); const games = seedGames([g]);
      el('demo-batch-apply');
      selectorSets.set('.batch-grid tbody tr', [batchRow('agree', { home: s.hs, away: s.as, status: 'final' })]);
      bindComm(games); el('demo-batch-apply')._fire('click');
      results.grid = getGame('agree').atsWinner;
    }
    // (b) Set Final
    {
      const g = GAME({ gameId: 'agree' }); s.patch(g);
      resetDom(); const games = seedGames([g]);
      el('demo-game-select').value = 'agree';
      el('demo-home-score').value = String(s.hs);
      el('demo-away-score').value = String(s.as);
      el('demo-set-final'); bindComm(games); el('demo-set-final')._fire('click');
      results.setFinal = getGame('agree').atsWinner;
    }
    // (c) Finalize All
    {
      const g = GAME({ gameId: 'agree', status: 'live', homeScore: s.hs, awayScore: s.as }); s.patch(g);
      resetDom(); const games = seedGames([g]);
      el('demo-finalize-all'); bindComm(games); el('demo-finalize-all')._fire('click');
      results.finalizeAll = getGame('agree').atsWinner;
    }
    // (d) the shared function, read directly off the stored record
    {
      const g = GAME({ gameId: 'agree', status: 'final', homeScore: s.hs, awayScore: s.as }); s.patch(g);
      resetDom(); seedGames([g]);
      results.shared = calculateAtsWinner(getGame('agree'));
    }

    const vals = Object.values(results);
    assert(vals.every(v => v === s.want),
      `${s.name}: ${s.why} → ${s.want} — grid=${results.grid} setFinal=${results.setFinal} finalizeAll=${results.finalizeAll} shared=${results.shared}`);
    assert(new Set(vals).size === 1,
      `${s.name}: every entry path agrees — the button pressed cannot change who covered`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. [structural] NO SECOND IMPLEMENTATION IN app.js.
//
//    Every other assertion in this file is behavioural. These are not, and
//    cannot be: the property is "this code does not exist anywhere in the
//    file", which has no runtime observable. A private copy that is currently
//    correct still passes every behavioural test above on the day it is
//    written, and drifts later — that is precisely how AD-03's spread bug
//    survived two sessions. So the copy itself is what gets forbidden.
//
//    THE RULE. In `js/app.js`, the value written to `atsWinner` may only ever
//    come from `calculateAtsWinner()`, from a read of the already-stored
//    `.atsWinner` field, or from `null`. It may never be derived on the spot.
//
//    Stated as an ALLOW-list on purpose. A deny-list ("no Math.abs near
//    atsWinner") is defeated by the next author who spells the same idea a
//    slightly different way; an allow-list has to be widened deliberately,
//    with a reason, in this file.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] [structural] app.js holds no second copy of the ATS comparison…');
{
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  // Strip comments so prose describing the rule can never trip the scan.
  const strip = s => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  const code = strip(src);

  const IDENT = /^[A-Za-z_$][\w$]*$/;
  // Deny wins over allow: an RHS that compares, takes an absolute value, or
  // names the push literal is deriving an answer no matter what else it says.
  const DERIVES = /[<>]|Math\.abs|no_decision/;

  /** Cut a captured RHS at the first UNMATCHED closing bracket, so
   *  `atsWinner:null}))` yields `null` and `atsWinner: ats })` yields `ats`. */
  function trimRhs(s) {
    s = s.trim();
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') {
        if (depth === 0) return s.slice(0, i).trim();
        depth--;
      }
    }
    return s;
  }
  /** Every right-hand side assigned to an `atsWinner` identifier or property. */
  const rhsOf = text => [...text.matchAll(/\batsWinner\s*[:=](?!=)\s*([^,;\n]*)/g)].map(m => trimRhs(m[1]));
  /** Every right-hand side bound to a bare local named `name`. */
  const bindingsOf = (text, name) =>
    [...text.matchAll(new RegExp(String.raw`(?:^|[^.\w$])(?:const\s+|let\s+|var\s+)?${name}\s*=(?!=)\s*([^,;\n]*)`, 'gm'))]
      .map(m => trimRhs(m[1]));

  /** Classify one RHS. Returns null when acceptable, or the offending text. */
  function judge(text, rhs, depth = 0) {
    if (DERIVES.test(rhs)) return rhs;
    if (rhs === 'null') return null;
    if (/\bcalculateAtsWinner\s*\(/.test(rhs)) return null;
    if (/\.atsWinner\b/.test(rhs)) return null;          // reading the stored field
    if (IDENT.test(rhs)) {
      // Indirect: `const x = <something>; ... { atsWinner: x }`. Follow it once.
      if (depth > 0) return rhs;
      const bound = bindingsOf(text, rhs);
      if (!bound.length) return rhs;                     // can't account for it
      for (const b of bound) { const bad = judge(text, b, depth + 1); if (bad) return bad; }
      return null;
    }
    return rhs;                                          // anything else is unaccounted for
  }

  const offenders = rhsOf(code).map(r => judge(code, r)).filter(Boolean);
  assert(offenders.length === 0,
    `every atsWinner written in app.js comes from calculateAtsWinner(), a stored .atsWinner, or null — ${offenders.length} do not${offenders.length ? ': ' + JSON.stringify(offenders) : ''}`);

  // ── The three surviving spread-adjusted expressions in app.js are LIVE-TINT
  //    DISPLAY ONLY: they colour a cell or a badge while a game is in progress
  //    and never touch storage (RG-05 — cell colours are not data). Their count
  //    is pinned so a fourth cannot appear unnoticed. If this fails, the new
  //    site is either a display tint (widen the number here, on purpose) or a
  //    grading path (it belongs in calculateAtsWinner()).
  const adjusted = [...code.matchAll(/\b(?:const|let|var)\s+adj\w*\s*=\s*[^;\n]*\+\s*(?:sv|spread)\b[^;\n]*/g)]
    .map(m => m[0].trim());
  assert(adjusted.length === 3,
    `app.js builds a spread-adjusted score in exactly 3 places, all live-tint display — found ${adjusted.length}: ${JSON.stringify(adjusted)}`);
  const liveTintOnly = adjusted.every(a => /game\.homeScore/.test(a));
  assert(liveTintOnly,
    'and all three read game.homeScore for display — none reads a value typed into a score-entry field');

  // ── Guard the guard. Feed the scan the exact text that was deleted from the
  //    four score-entry sites and confirm every check fires. A green result
  //    above must mean "absent", never "unmatchable".
  const CANARY_INLINE = strip(`
    const sv = g.lockedSpread !== null ? g.lockedSpread : g.spread;
    if (sv !== null) { const adj = hs + sv; atsWinner = Math.abs(adj - as_) < 0.01 ? 'no_decision' : (adj > as_ ? g.homeTeam : g.awayTeam); }
  `);
  assert(rhsOf(CANARY_INLINE).map(r => judge(CANARY_INLINE, r)).filter(Boolean).length === 1,
    'canary: the direct inline copy that was removed is caught by the allow-list');

  // The sneakier drift the allow-list exists for: correct-looking, indirect,
  // and invisible to any "Math.abs near atsWinner" deny-list.
  const CANARY_INDIRECT = strip(`
    let w = null;
    if (sv !== null) w = adj > as_ ? g.homeTeam : g.awayTeam;
    saveGame({ ...g, atsWinner: w });
  `);
  assert(rhsOf(CANARY_INDIRECT).map(r => judge(CANARY_INDIRECT, r)).filter(Boolean).length === 1,
    'canary: an INDIRECT copy — derived into a local, then assigned — is caught too');

  // And the shapes that must stay legal, or the guard would block correct code.
  const CANARY_OK = strip(`
    saveGame({ ...g, atsWinner: calculateAtsWinner(g) });
    next.atsWinner = calculateAtsWinner(next);
    saveGame({ ...g, atsWinner: null });
    const ats = calculateAtsWinner(fresh);
    saveGame({ ...fresh, atsWinner: ats });
  `);
  assert(rhsOf(CANARY_OK).map(r => judge(CANARY_OK, r)).filter(Boolean).length === 0,
    'canary: the four legitimate shapes (direct call, property call, null, call-via-local) all pass');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(50));
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ ${fail} FAILED — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
