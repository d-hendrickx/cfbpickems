/**
 * CFB Pickems - finalizeentrantstest.mjs
 * ======================================
 * D1 (v0.30.0, thread 100726-D1, Lane A), reviewer B2: a week is settled AMONG ITS ENTRANTS. In a league that runs two or more sports, finalizing an opt-in sport's week computes results, ranks, the
 * winner and loser and the obligation between them over the members who joined that sport before it locked; a member who is not in the sport, and one who joined after the lock, are absent even when
 * pick rows exist for them (RLS admits the row; it counts for nothing). A league that runs one sport is byte-for-byte what it was. js/scoring.js is not touched: it is handed the roster.
 *
 *   [1] playersForWeek(week) (js/competition.js - the merged tree's ONE roster function; Lane A's `weekPlayers` and the client's `playersForWeek` were the same B2 fix written twice): one sport = every
 *       active player; two sports = the entrants (joined before the lock); a late joiner and a member who never joined are out; a week whose competition dangles has nobody (fail closed).
 *   [2] finalizeWeek among entrants - the non-entrant and the late joiner (who would have won) are in no result row and no obligation; the control (one sport, same picks) ranks them.
 *   [3] The review card's "Players counted" is entrants out of members; the tiebreaker guess count and the locked notice's denominator follow the roster.
 *   [4] The wiring: finalizeWeek, the Extra Point steps, Step 4's tie warning and the review all read the roster through playersForWeek, and the picks through picksOfRoster (source pins; mutants in the hand-off).
 *
 * MERGE RE-DERIVATION (2026-10-08, feat/d1-sports = server + client): this suite used to stand in for the client branch's participation API (`seam._clientApiForTest`) and to call app.weekPlayers.
 * Both are gone - the real competition.js answers now - so the fixture writes REAL competition_members rows (entrants joined before the lock; one member joined AFTER it; one never joined) and every
 * assertion below is driven through the real model. Each re-derived assertion carries a dated note.
 *
 * Run: node finalizeentrantstest.mjs
 */
import { readFile } from 'node:fs/promises';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
const els = new Map();
function mkEl(id) {
  const e = { id, _html: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML() {}, appendChild() {}, remove() { els.delete(this.id); }, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, scrollTo() {}, focus() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; } };
  els.set(id, e); return e;
}
['page-picks', 'games-list', 'page-dashboard', 'submitted-games', 'page-leaderboard', 'header-meta-week', 'page-home', 'page-commissioner'].forEach(mkEl);
const toasts = [];
const toastBox = mkEl('toast-container');
toastBox.appendChild = (t) => { toasts.push(String(t && t._html)); };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: (id) => els.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => { const e = mkEl('tmp'); els.delete('tmp'); return e; },
  // A minimal DOM for the body-appended sheets: appending registers the element and one stub per id found in its markup (the sheet and its body), so getElementById finds them.
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false, [Symbol.iterator]: function* () {} }, dataset: {}, style: { setProperty() {}, removeProperty() {} }, innerHTML: '',
    appendChild(el) { if (!el || !el.id) return; els.set(el.id, el); for (const m of String(el._html).matchAll(/ id="([^"]+)"/g)) if (!els.has(m[1])) mkEl(m[1]); } }, hidden: false };
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: {} }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {}; globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in finalizeentrantstest'); };


let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  \u2705', label); } else { fail++; console.error('  \u274c', label); } }

const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');
const app = await import('./js/app.js');
const seam = await import('./js/sport-seam.js');
const comp = await import('./js/competition.js');
const { NFL_PROFILE } = await import('./js/sports/nfl.js');
const { saveWeek, saveGame, getWeek, saveCompetition, setSession, addPlayer, saveAllPicks, getWeeklyResults, getObligations } = storage;
const origWarn = console.warn; console.warn = () => {};
const origInfo = console.info; console.info = () => {};

const CFB_C = 'aaaaaaaa-0000-0000-0000-000000000001', NFL_C = 'bbbbbbbb-0000-0000-0000-000000000002';
const WK = 'w_nfl';

/** Four members. p1 and p2 are NFL entrants (rows stamped BEFORE the lock); p3 never joined the NFL; p4 joined AFTER the lock. p3 and p4 pick every game right. */
const BEFORE_LOCK = '2026-10-01T00:00:00.000Z', AFTER_LOCK = '2026-10-12T12:00:00.000Z';   // the week's first kickoff is 2026-10-11T18:00Z
function seed({ comps = 'multi', entrants = ['p1', 'p2'], late = ['p4'] } = {}) {
  store.clear(); toasts.length = 0; seam.resetLensSport();
  seam._clientApiForTest(null);   // merge re-derivation 2026-10-08: no stand-in for the participation API - competition.js is real now
  setSession('p1', true, true);
  [['p1', 'Ann'], ['p2', 'Ben'], ['p3', 'Cy'], ['p4', 'Di']].forEach(([playerId, displayName]) => addPlayer({ playerId, displayName, active: true }));
  if (comps !== 'none') saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  if (comps === 'multi' || comps === 'dangling') saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season' });
  // ('single-dangling': ONE competition and a week whose competition id names none - the single-sport rule must still answer everyone)
  if (comps === 'multi') {
    const row = (memberId, joinedAt) => ({ id: `${NFL_C}:${memberId}`, competitionId: NFL_C, memberId, enrolledBy: 'self', joinedAt });
    localStorage.setItem('cfbp_competition_members', JSON.stringify([...entrants.map((m) => row(m, BEFORE_LOCK)), ...late.map((m) => row(m, AFTER_LOCK))]));
  }
  const week = { ...dm.createWeek('2026', 6, '2026-10-10', '2026-10-12', comps === 'none' ? {} : { competitionId: NFL_C, profile: NFL_PROFILE }), weekId: WK, status: 'live', blurb: 'Week blurb that is long enough to count for the gate.', showInHistory: true };
  if (comps === 'none') delete week.competitionId;
  if (comps === 'dangling' || comps === 'single-dangling') week.competitionId = 'dddddddd-0000-0000-0000-00000000dead';   // names a competition that is not in the mirror
  saveWeek(week);
  // three games, all final, spread frozen. Home covers G1, away covers G2, home covers G3.
  const G = [
    { id: 'g1', home: 'Texas', away: 'Oklahoma', spread: -3.5, hs: 31, as: 24 },
    { id: 'g2', home: 'Purdue', away: 'Iowa', spread: 2.5, hs: 17, as: 20 },
    { id: 'g3', home: 'Utah', away: 'Baylor', spread: -1.5, hs: 10, as: 7 },
  ];
  G.forEach((g) => saveGame({ ...dm.createGame(WK, { homeTeam: g.home, awayTeam: g.away, spread: g.spread }), gameId: g.id, status: 'final', homeScore: g.hs, awayScore: g.as, lockedSpread: g.spread, kickoff: '2026-10-11T18:00:00Z' }));
  const right = { g1: 'Texas', g2: 'Iowa', g3: 'Utah' };
  const wrong = { g1: 'Oklahoma', g2: 'Purdue', g3: 'Baylor' };
  const picks = [];
  const add = (pid, picksByGame) => Object.entries(picksByGame).forEach(([gid, team]) => picks.push({ ...dm.createPick(WK, gid, pid, team), pickId: `pk_${pid}_${gid}` }));
  add('p1', { g1: right.g1, g2: right.g2, g3: wrong.g3 });          // 2 right
  add('p2', { g1: right.g1, g2: wrong.g2, g3: wrong.g3 });          // 1 right
  add('p3', right);                                                  // 3 right - a non-entrant's rows
  add('p4', right);                                                  // 3 right - joined after the lock
  saveAllPicks(picks);
  return getWeek(WK);
}

console.log('\n[1] playersForWeek (js/competition.js)');
{
  seed({ comps: 'none' });
  assert(comp.playersForWeek(getWeek(WK)).map((p) => p.playerId).join() === 'p1,p2,p3,p4', '[1a] a league with no competition rows: every active player');
  seed({ comps: 'multi' });
  assert(comp.playersForWeek(getWeek(WK)).map((p) => p.playerId).join() === 'p1,p2', '[1b] two sports, the NFL week: its entrants only (Cy never joined, Di joined after the lock) - re-derived 2026-10-08: now through REAL competition_members rows, so the late joiner is excluded by the lock rule (C1), not by a stand-in');
  seed({ comps: 'dangling' });
  // RE-DERIVED 2026-10-08 (merge). OLD: "two sports but the participation API is absent (this branch alone): every active player, never nobody" - p1,p2,p3,p4. That described the seam's fallback while the client
  // branch had not landed; competition.js is always present now, so the case cannot occur. NEW: the case that CAN occur is a week whose competition reference dangles (not hydrated): the one roster function
  // answers nobody (fail closed) - it is never mistaken for "everyone", which would settle the week among members who may not be in its sport.
  assert(comp.playersForWeek(getWeek(WK)).length === 0, '[1c] two sports and a week whose competition reference dangles: nobody (fail closed), never everyone');
  seed({ comps: 'multi', entrants: [], late: [] });
  assert(comp.playersForWeek(getWeek(WK)).length === 0, '[1d] an opt-in sport nobody has joined: nobody (an empty roster is empty, not "everyone")');
  seed({ comps: 'single-dangling' });
  assert(comp.playersForWeek(getWeek(WK)).map((p) => p.playerId).join() === 'p1,p2,p3,p4', '[1f] ADDED 2026-10-08 (merge, coordinator): the single-sport rule is checked FIRST - a ONE-sport league whose week names a missing competition still answers every active player (the fail-closed "nobody" is a several-sport rule only)');
  seed({ comps: 'multi' });
  assert(app.weekPlayers === undefined, '[1e] ADDED 2026-10-08 (merge): there is ONE roster function - app.js exports no second `weekPlayers`');
}

console.log('\n[2] finalizeWeek settles the week among its entrants');
{
  const week = seed({ comps: 'multi' });
  app.finalizeWeek({ ...week, status: 'final' }, { settling: true });
  const rows = getWeeklyResults(WK);
  assert(rows.map((r) => r.playerId).sort().join() === 'p1,p2', `[2a] the results hold p1 and p2 ONLY - the non-entrant and the late joiner, who picked every game right, are in no row (got ${rows.map((r) => r.playerId).sort().join()})`);
  const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
  assert(byId.p1 && byId.p1.rank === 1 && byId.p1.isWinner === true && byId.p2.rank === 2 && byId.p2.isLoser === true, '[2b] p1 (2 right) wins and p2 (1 right) loses: ranks 1 and 2, no gap where a non-entrant would sit');
  const obs = getObligations(WK);
  assert(obs.length === 1 && obs[0].payerPlayerId === 'p2' && obs[0].recipientPlayerId === 'p1', `[2c] the weekly obligation is between the two entrants (p2 owes p1); nobody who was not in the sport owes or is owed (got ${JSON.stringify(obs.map((o) => [o.payerPlayerId, o.recipientPlayerId]))})`);
  const ctl = seed({ comps: 'none' });
  app.finalizeWeek({ ...ctl, status: 'final' }, { settling: true });
  const crows = getWeeklyResults(WK);
  assert(crows.map((r) => r.playerId).sort().join() === 'p1,p2,p3,p4', '[2d] CONTROL: the same picks in a league with one sport rank all four members (byte-identical to before)');
  const cwin = crows.find((r) => r.isWinner), clos = crows.find((r) => r.isLoser);
  assert(cwin && ['p3', 'p4'].includes(cwin.playerId) && clos && clos.playerId === 'p2', '[2e] ...where a 3-right member wins and p2 loses - proving the fixture would have crowned the wrong people without the roster');
}

console.log('\n[3] The review card, the guess count, the notice denominator');
{
  const week = seed({ comps: 'multi' });
  storage.setTiebreakerGuess(WK, 'p1', 40); storage.setTiebreakerGuess(WK, 'p3', 41);
  const review = app._finalizeReviewForTest(week, storage.getGames(WK));
  const row = review.rows.find((r) => r.id === 'players');
  assert(row && row.parts.join('') === '2 of 4', `[3a] "Players counted" reads entrants out of members: 2 of 4 (got ${row && row.parts.join('')})`);
  seed({ comps: 'none' });
  const review1 = app._finalizeReviewForTest(getWeek(WK), storage.getGames(WK));
  assert(review1.rows.find((r) => r.id === 'players').parts.join('') === '4 of 4', '[3b] one sport: 4 of 4, as before');
}

console.log('\n[4] The wiring');
{
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const fw = src.slice(src.indexOf('export function finalizeWeek('), src.indexOf('// \u2500\u2500\u2500 AUTO REFRESH'));
  assert(/const players=playersForWeek\(week\);/.test(fw) && /const picks=picksOfRoster\(getPicks\(week\.weekId\), players\);/.test(fw) && /picksOfRoster\(groupWeeks\.flatMap/.test(fw) && !/getPlayers\(\)\.filter/.test(fw), '[4a] finalizeWeek takes its roster and its picks from playersForWeek / picksOfRoster (the group branch too) and reads no league-wide player list - re-pinned 2026-10-08: weekPlayers -> playersForWeek');
  const compSrc = await readFile(new URL('./js/competition.js', import.meta.url), 'utf8');
  assert(/export function picksOfRoster\(picks, players\) \{\s*if \(!isMultiSport\(\)\) return picks;/.test(compSrc) && !/function picksOfRoster|function weekPlayers|function entrantPicks/.test(src), '[4a2] a one-sport league gets its picks back untouched (the very same array): the filter exists only for two or more sports - re-pinned 2026-10-08: it now lives in competition.js (exported), and app.js defines no second copy');
  const s3 = src.slice(src.indexOf('function renderFinalizeStep3HTML('), src.indexOf('function bindFinalizeStep3('));
  const s4 = src.slice(src.indexOf('function renderFinalizeStep4HTML('), src.indexOf('function finalizeReviewFor('));
  const rv = src.slice(src.indexOf('function finalizeReviewFor('), src.indexOf('export const _finalizeReviewForTest'));
  assert(/const players = playersForWeek\(week\);/.test(s3) && /const players = playersForWeek\(week\);/.test(s4) && /picksOfRoster\(getPicks\(week\.weekId\), players\)/.test(s4) && /const players = playersForWeek\(week\);/.test(rv), '[4b] Step 3, Step 4 (players and the tie-warning picks) and the review card read the roster - re-pinned 2026-10-08: weekPlayers -> playersForWeek');
  const lk = src.slice(src.indexOf('export function postPicksLockedNotice('), src.indexOf('/**', src.indexOf('export function postPicksLockedNotice(')));
  assert(/const active = playersForWeek\(week\);/.test(lk), '[4c] S1: the locked notice counts "k of n" over the week\'s entrants - re-pinned 2026-10-08: weekPlayers -> playersForWeek');
  const ep = src.slice(src.indexOf('id="comm-ep-card"') - 4000, src.indexOf('id="comm-ep-card"'));
  assert(/gradeWeekExtraPoint\(week, playersForWeek\(week\)\)/.test(ep) && /ep-post-btn[\s\S]{0,200}playersForWeek\(/.test(src), '[4d] the Comm Extra Point card and its "post to chat" grade the entrants - re-pinned 2026-10-08: weekPlayers -> playersForWeek');
}

console.warn = origWarn; console.info = origInfo;
console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '\u2705 ALL PASS' : '\u274c FAILURES'} \u2014 ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
