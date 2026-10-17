/**
 * CFB Pickems - sportticktest.mjs
 * ================================
 * D1 (v0.30.0, thread 100726-D1, Lane A), DI-535 #1 + the integrity reviewer's requirement that TICK ISOLATION lands before the NFL is enabled anywhere.
 *
 *   [1]  A one-sport league: tickWeeks() is exactly [getCurrentWeek()], and the lock leg locks that week as it always did (byte-identical single-sport rule).
 *   [2]  Two sports (the default college competition + an NFL competition): ONE tick takes the lock leg for BOTH sports' current weeks.
 *   [3]  ISOLATION: a refusal in one sport's leg (a write that throws) never stops the other sport's leg on the same tick - in BOTH orders.
 *   [4]  A sport that is not live (no open/locked/live week and none starting soon) takes no leg; an archived sport takes none; the NFL's week is never read as the college week.
 *   [5]  The source shape: per-week try/catch, the draft scan stays the one whole-tick leg, the scores round loops the same weeks, both reconcile call sites loop them.
 *
 * Run: node sportticktest.mjs
 */
import { readFile } from 'node:fs/promises';

const store = new Map();
let failWrite = null;                                 // (key, value) => boolean: simulate a write the platform refuses
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (failWrite && failWrite(k, String(v))) throw new Error('simulated: the write was refused'); store.set(k, String(v)); },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const els = new Map();
function mkEl(id) {
  const e = { id, _html: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML() {}, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, scrollTo() {}, focus() {} };
  els.set(id, e); return e;
}
['page-picks', 'games-list', 'page-dashboard', 'submitted-games', 'page-leaderboard', 'header-meta-week', 'page-home', 'page-commissioner'].forEach(mkEl);
// A toast container that THROWS for the one toast a lock leg raises when a game's spread sign contradicts its favorite: the way a single sport's lock leg is made to throw
// BEFORE its saveWeek (the storage layer swallows a refused write, so a refused write cannot model "this sport's leg threw"; bad data in one sport's slate can).
const toastBox = mkEl('toast-container');
toastBox.appendChild = (t) => { if (/spread NOT frozen/.test(String(t && t._html))) throw new Error('simulated: this sport\'s lock leg threw'); };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: (id) => els.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('tmp'), body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' }, hidden: false };
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {}; globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in sportticktest'); };

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const storage = await import('./js/storage.js');
const comp = await import('./js/competition.js');
const dm = await import('./js/data-model.js');
const app = await import('./js/app.js');
const { saveWeek, saveGame, getWeek, getWeeks, setActiveWeekId, saveCompetition, setSession } = storage;
const { createWeek, createGame } = dm;

const warns = [];
const realWarn = console.warn; console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
const quiet = (fn) => { const w = console.warn, i = console.info; console.warn = () => {}; console.info = () => {}; try { return fn(); } finally { console.warn = w; console.info = i; } };

const CFB_C = 'aaaaaaaa-0000-0000-0000-000000000001', NFL_C = 'bbbbbbbb-0000-0000-0000-000000000002';
const minsFromNow = (m) => new Date(Date.now() + m * 60000).toISOString();

function reset() {
  store.clear(); failWrite = null; warns.length = 0;
  setSession('p1', true, true);          // the commissioner (local mode: isAdmin, verified) - the tick acts as the commissioner's device
}
function week(id, { comp = null, status = 'open', num = 6 } = {}) {
  const w = { ...createWeek('2026', num, '2026-10-04', '2026-10-05'), weekId: id, status, showInHistory: true, ...(comp ? { competitionId: comp } : {}) };
  saveWeek(w); return w;
}
function game(weekId, gid, kickoffMin, { badSign = false } = {}) {
  // badSign: the home team is the favorite but the signed spread says away is favored (AD-03's contradiction) - the lock leg REFUSES to freeze it and raises a toast (which the stub above throws on)
  saveGame({ ...createGame(weekId, { homeTeam: `H${gid}`, awayTeam: `A${gid}`, kickoff: minsFromNow(kickoffMin), kickoffConfirmed: true, spread: badSign ? 3.5 : -3.5, favorite: `H${gid}` }), gameId: gid, weekId });
}
const statusOf = (id) => getWeek(id)?.status;

console.log('\n[1] A one-sport league: tickWeeks() is [getCurrentWeek()] and the lock leg is unchanged');
reset();
{
  week('w_cfb'); game('w_cfb', 'g1', 20);                 // kickoff in 20 min, 30-minute offset: the lock instant passed 10 minutes ago
  setActiveWeekId('w_cfb');
  const ws = app._tickWeeksForTest();
  assert(ws.length === 1 && ws[0].weekId === 'w_cfb' && ws[0].weekId === storage.getCurrentWeek().weekId, '[1a] with no competition rows tickWeeks() is exactly [getCurrentWeek()]');
  quiet(() => app.tickAutoTransition());
  assert(statusOf('w_cfb') === 'locked', '[1b] the due week took its open -> locked leg');
  reset();
  saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  week('w_cfb'); game('w_cfb', 'g1', 20); setActiveWeekId('w_cfb');
  const ws2 = app._tickWeeksForTest();
  assert(ws2.length === 1 && ws2[0].weekId === 'w_cfb', '[1c] a league with ONE competition row (the default) still ticks exactly its one current week');
  quiet(() => app.tickAutoTransition());
  assert(statusOf('w_cfb') === 'locked', '[1d] …and locks it');
}

console.log('\n[2] Two sports: one tick takes the lock leg for both current weeks');
reset();
{
  saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season' });
  week('w_cfb'); game('w_cfb', 'c1', 20); setActiveWeekId('w_cfb');
  week('w_nfl', { comp: NFL_C }); game('w_nfl', 'n1', 20);
  const ids = app._tickWeeksForTest().map((w) => w.weekId).sort();
  assert(ids.join() === 'w_cfb,w_nfl', '[2a] tickWeeks() lists BOTH sports\' current weeks (the default always, the NFL while live)');
  quiet(() => app.tickAutoTransition());
  assert(statusOf('w_cfb') === 'locked' && statusOf('w_nfl') === 'locked', '[2b] ONE tick locked both the college week and the NFL week');
  assert(getWeek('w_nfl').competitionId === NFL_C && !('competitionId' in getWeek('w_cfb')), '[2c] each week kept its own competition reference (the college week carries none)');
}

console.log('\n[3] ISOLATION: one sport\'s refused write never stops the other sport\'s leg');
for (const refused of ['w_cfb', 'w_nfl']) {
  reset();
  saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season' });
  week('w_cfb'); game('w_cfb', 'c1', 20, { badSign: refused === 'w_cfb' }); setActiveWeekId('w_cfb');
  week('w_nfl', { comp: NFL_C }); game('w_nfl', 'n1', 20, { badSign: refused === 'w_nfl' });
  { const i = console.info; console.info = () => {}; try { app.tickAutoTransition(); } finally { console.info = i; } }      // warnings stay captured: the throw must be NAMED
  const other = refused === 'w_cfb' ? 'w_nfl' : 'w_cfb';
  const hasRefusalLog = warns.some((m) => m.includes(`[tickAutoTransition] ${refused}`));
  assert(statusOf(other) === 'locked', `[3a-${refused}] the OTHER sport (${other}) still took its lock leg on the same tick`);
  assert(statusOf(refused) === 'open', `[3b-${refused}] the sport whose leg threw (${refused}) was NOT locked (the throw is real, not a no-op fixture)`);
  assert(hasRefusalLog, `[3c-${refused}] the throw is NAMED in the console with that week's id, not swallowed`);
}

console.log('\n[4] A sport that is not live takes no leg; an archived sport takes none');
reset();
{
  saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season', archivedAt: '2026-10-01T00:00:00.000Z' });
  week('w_cfb'); game('w_cfb', 'c1', 20); setActiveWeekId('w_cfb');
  week('w_nfl', { comp: NFL_C }); game('w_nfl', 'n1', 20);
  const ids = app._tickWeeksForTest().map((w) => w.weekId);
  assert(ids.join() === 'w_cfb', '[4a] an ARCHIVED sport\'s week is not ticked');
  quiet(() => app.tickAutoTransition());
  assert(statusOf('w_cfb') === 'locked' && statusOf('w_nfl') === 'open', '[4b] the college week locked; the archived sport\'s week was left exactly as it was');
  reset();
  saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season' });
  week('w_cfb'); game('w_cfb', 'c1', 20); setActiveWeekId('w_cfb');
  // the NFL competition has NO week at all (nothing to lock): the college week is unaffected and nothing throws
  quiet(() => app.tickAutoTransition());
  assert(statusOf('w_cfb') === 'locked' && getWeeks().length === 1, '[4c] an NFL competition with no week takes no leg and does not disturb the college week');
}

console.log('\n[5] Source shape');
{
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const tick = code.slice(code.indexOf('export function tickAutoTransition()'), code.indexOf('function tickWeekLegs('));
  assert(/for \(const week of tickWeeks\(\)\) \{\s*try \{ tickWeekLegs\(week, openedThisTick\); \}\s*catch \(err\)/.test(tick), '[5a] tickAutoTransition runs tickWeekLegs once per tickWeeks() week, each inside its OWN try/catch');
  assert(tick.indexOf('for (const w of getWeeks())') > -1 && tick.indexOf('for (const w of getWeeks())') < tick.indexOf('for (const week of tickWeeks())') && /\n        return;\n/.test(tick.slice(tick.indexOf('applyWeekStatusChange(w, WEEK_STATUS.OPEN)'))),
    '[5b] the draft->open scan stays ABOVE the per-sport legs and stays the one whole-tick leg (it returns after the first open)');
  const round = code.slice(code.indexOf('const roundWeeks = tickWeeks();'), code.indexOf('} finally { _autoRefreshInFlight = false; }'));
  assert(/for \(const week of roundWeeks\) \{\s*try \{/.test(round) && /catch \(err\) \{[\s\S]*?\}\s*\}\s*if \(!refreshedWeeks\.length\) return;/.test(round), '[5c] the scores round loops the same weeks with a try/catch per week, and renders once after the loop');
  assert(/if \(serverScores\) reconcileGameEvents\(week\);[\s\S]*?continue;/.test(round) && round.indexOf('if (serverScores) reconcileGameEvents(week);') < round.indexOf("week.dataSourceMode === 'demo'"),
    '[5d] reconcileGameEvents(week) runs per week BEFORE the demo/manual skip, which is a per-week `continue`');
  assert((code.match(/for \(const w of tickWeeks\(\)\) reconcileGameEvents\(w\)/g) || []).length === 2 && !/reconcileGameEvents\(getCurrentWeek\(\)\)/.test(code), '[5e] BOTH call sites (Realtime and the boot catch-up) reconcile every sport\'s current week');
  assert(/function tickWeeks\(\) \{[\s\S]*?getAllCurrentWeeks\(\)[\s\S]*?if \(!weeks\.length\) \{ const w = getCurrentWeek\(\)/.test(code), '[5f] tickWeeks() is getAllCurrentWeeks() with getCurrentWeek() as the fallback when no competition resolves');
}

console.warn = realWarn;
console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
