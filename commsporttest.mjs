/**
 * CFB Pickems - commsporttest.mjs
 * ===============================
 * D1 (v0.30.0, thread 100726-D1, Lane A): the commissioner runs more than one sport - the wiring in js/app.js over js/multisport-admin.js and js/sport-seam.js.
 * DI-532 (Add a sport), DI-533 (a week for a chosen sport), DI-534 (Comm -> Week lens, all-sports card, Sport options, Sport entries, independent publish).
 *
 *   [1]  A one-sport league renders NONE of it: no lens, no all-sports card, no Sport options, and the Comm week is getCurrentWeek().
 *   [2]  Two sports: the lens is a radiogroup, the all-sports card has a row (one action) per sport, the week selector lists only the lens sport's weeks, a sport with no week is "NO WEEK" (never the other sport's week).
 *   [3]  Independent publish: Open / Lock for one sport read and write that sport's week ONLY (the other sport's week - even one that would block - is untouched).
 *   [4]  The active-week pointer is PER COMPETITION (a wizard-created NFL week never moves the college pointer; the guard is that sport's own in-progress week).
 *   [5]  Add a sport: the sheet offers what the platform offers minus what the league runs; the add writes ONE competition with the deterministic id; a double press is one add; the league page card is a real entry or absent.
 *   [6]  Archive: refused while a week is in progress, otherwise archivedAt - and the sport disappears from the lens.
 *   [7]  The wizard: Step 1's Sport field (multi-sport only), createWeek with the NFL profile, the NFL Step 3 controls, the sport label in the open toast.
 *
 * Run: node commsporttest.mjs
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
globalThis.fetch = async () => { throw new Error('network disabled in commsporttest'); };

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');
const auth = await import('./js/auth.js');
const app = await import('./js/app.js');
const seam = await import('./js/sport-seam.js');
const ms = await import('./js/multisport-admin.js');
const { NFL_PROFILE } = await import('./js/sports/nfl.js');
const { saveWeek, saveGame, getWeek, setActiveWeekId, getActiveWeekId, saveCompetition, setSession, addPlayer } = storage;
const origWarn = console.warn; console.warn = () => {};
const origInfo = console.info; console.info = () => {};

const CFB_C = 'aaaaaaaa-0000-0000-0000-000000000001', NFL_C = 'bbbbbbbb-0000-0000-0000-000000000002';
const mins = (m) => new Date(Date.now() + m * 60000).toISOString();
const page = () => els.get('page-commissioner')._html;
const render = () => { els.get('page-commissioner')._html = ''; app.renderCommPage(); return page(); };

function reset({ comps = 'multi' } = {}) {
  store.clear(); toasts.length = 0; seam.resetLensSport(); app._resetAddSportForTest();
  setSession('p1', true, true);
  addPlayer({ playerId: 'p1', displayName: 'Ann', active: true, almaMater: 'Texas A&M' });
  addPlayer({ playerId: 'p2', displayName: 'Ben', active: true, almaMater: 'Oklahoma' });
  if (comps !== 'none') saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  if (comps === 'multi') saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season' });
}
const mkWeek = (id, { comp = null, status = 'open', num = 6, profile = null, blurb = 'Week blurb that is long enough to count for the gate.', games = 2, spread = true, kickMin = 600 } = {}) => {
  const w = { ...dm.createWeek('2026', num, '2026-10-10', '2026-10-12', { competitionId: comp, profile }), weekId: id, status, blurb, showInHistory: true };
  saveWeek(w);
  for (let i = 0; i < games; i++) saveGame({ ...dm.createGame(id, { homeTeam: `H${id}${i}`, awayTeam: `A${id}${i}`, kickoff: mins(kickMin + i * 30), kickoffConfirmed: true, spread: spread ? -3.5 : null, favorite: spread ? `H${id}${i}` : null }), gameId: `${id}_g${i}`, weekId: id });
  return w;
};

console.log('\n[1] A one-sport league renders none of it');
for (const comps of ['none', 'one']) {
  reset({ comps });
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  const html = render();
  assert(html.length > 1000 && !/comm-sport-lens/.test(html) && !/comm-all-sports-card/.test(html) && !/Sport options/.test(html) && !/comm-sport-entries-card/.test(html) && !/>All sports</.test(html),
    `[1a-${comps}] ${comps === 'none' ? 'no competition rows' : 'one (default) competition'}: no lens, no all-sports card, no Sport options, no Sport entries`);
  assert(app._commWeekForTest()?.weekId === 'w_cfb' && app._commWeeksForTest().length === 1 && !/id="wiz-cw-sport"/.test(html), `[1b-${comps}] the Comm week is the current week and the week list is every week`);
}

console.log('\n[2] Two sports: the lens, the all-sports card, scoped weeks');
reset();
{
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  mkWeek('w_nfl', { comp: NFL_C, profile: NFL_PROFILE, status: 'draft', games: 3 });
  let html = render();
  assert(/id="comm-sport-lens"/.test(html) && /role="radiogroup" aria-label="Sport"/.test(html) && /data-sport="cfb" aria-checked="true"/.test(html) && /data-sport="nfl" aria-checked="false"/.test(html), '[2a] the Week tab opens with the sport lens: a radiogroup, CFB selected (the default sport)');
  assert(html.indexOf('id="comm-sport-lens"') < html.indexOf('comm-all-sports-card') && html.indexOf('comm-all-sports-card') < html.indexOf('id="week-wizard-entry-card"'), '[2b] order: the lens, then the all-sports card, then everything about the lens sport\'s week');
  const rows = app._commAllSportsRowsForTest();
  assert(rows.length === 2 && rows[0].code === 'CFB' && rows[0].action.label === 'Lock' && rows[1].code === 'NFL' && rows[1].action.label === 'Open for picks' && rows[1].status === 'draft', '[2c] one row per sport: CFB (open -> Lock) and NFL (draft -> Open for picks)');
  assert((html.match(/data-action="comm-sport-action"/g) || []).length === 2 && /data-kind="lock"/.test(html) && /data-kind="open"/.test(html) && /min-height:44px/.test(html), '[2d] each sport row has ONE action button, at least 44 pt tall');
  assert(!/Sport options/.test(html), '[2e] the default sport has no Sport options (its Archive is never offered)');
  const sel = html.slice(html.indexOf('id="active-week-selector"'), html.indexOf('</select>', html.indexOf('id="active-week-selector"')));
  assert(/value="w_cfb"/.test(sel) && !/value="w_nfl"/.test(sel), '[2f] the Active Week selector lists the CFB lens\'s weeks only (the NFL week is not offered under the college lens)');
  seam.setLensSport('nfl');
  html = render();
  const sel2 = html.slice(html.indexOf('id="active-week-selector"'), html.indexOf('</select>', html.indexOf('id="active-week-selector"')));
  assert(/value="w_nfl"/.test(sel2) && !/value="w_cfb"/.test(sel2) && /data-sport="nfl" aria-checked="true"/.test(html), '[2g] under the NFL lens the selector lists the NFL week only, and NFL is the selected segment');
  assert(app._commWeekForTest().weekId === 'w_nfl' && /Sport options/.test(html) && /Archive NFL/.test(html), '[2h] the Comm week is the NFL week; a non-default sport shows Sport options with Archive NFL');
  assert(/Sport entries/.test(html) === seam.entriesSupported(), `[2i] the Sport entries card is drawn exactly when the entries data path exists (${seam.entriesSupported() ? 'present' : 'absent on this branch alone: it lands with the client branch'})`);
  // a sport with NO week is NO WEEK, never the other sport's week
  store.delete('cfbp_weeks'); mkWeek('w_cfb2'); setActiveWeekId('w_cfb2');
  seam.setLensSport('nfl');
  html = render();
  assert(app._commWeekForTest() === null && app._commWeeksForTest().length === 0, '[2j] NFL lens with no NFL week: the Comm week is null and the list is empty - NEVER the college week');
  const r2 = app._commAllSportsRowsForTest().find((r) => r.dbCode === 'nfl');
  assert(r2.statusLabel === 'NO WEEK' && r2.action.label === 'Set up Week 1' && r2.weekId === null, '[2k] the NFL row reads NO WEEK with "Set up Week 1"');
}

console.log('\n[3] Independent publish: one sport\'s control reads and writes that sport\'s week only');
reset();
{
  mkWeek('w_cfb', { spread: false });                    // the CFB week is NOT ready (no spreads): it must not block or be touched by the NFL
  setActiveWeekId('w_cfb');
  mkWeek('w_nfl', { comp: NFL_C, profile: NFL_PROFILE, status: 'draft', games: 3 });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season', activeWeekId: 'w_nfl' });
  const cfbBefore = JSON.stringify(getWeek('w_cfb'));
  app._runSportNextActionForTest({ kind: 'open', sport: 'nfl' });
  assert(getWeek('w_nfl').status === 'open', '[3a] "Open for picks" on the NFL week opened it (spreads present, a blurb, games) although the college week has missing spreads');
  assert(JSON.stringify(getWeek('w_cfb')) === cfbBefore && getWeek('w_cfb').status === 'open', '[3b] the college week is byte-identical: not read into the NFL decision, not written');
  assert(toasts.some((t) => /NFL Week 6 is open/.test(t)), '[3c] the message names the sport: "NFL Week 6 is open - picks unlock now."');
  app._runSportNextActionForTest({ kind: 'lock', sport: 'nfl' });
  assert(getWeek('w_nfl').status === 'locked' && getWeek('w_cfb').status === 'open' && JSON.stringify(getWeek('w_cfb')) === cfbBefore, '[3d] Lock on NFL locks the NFL week only');
  assert(seam.getLensSport() === 'nfl', '[3e] running a sport\'s action selects the lens on that sport');
  // an NFL draft that is NOT ready is refused by name, and writes nothing
  reset(); mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  mkWeek('w_nfl', { comp: NFL_C, profile: NFL_PROFILE, status: 'draft', games: 3, spread: false });
  app._runSportNextActionForTest({ kind: 'open', sport: 'nfl' });
  assert(getWeek('w_nfl').status === 'draft' && toasts.some((t) => /NFL Week 6 can't open yet: 3 games need a spread\./.test(t)), '[3f] a not-ready NFL week stays a draft and the refusal names the sport and the count: "NFL Week 6 can\'t open yet: 3 games need a spread."');
}

console.log('\n[4] The active-week pointer is per competition');
reset();
{
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  mkWeek('w_nfl_draft', { comp: NFL_C, profile: NFL_PROFILE, status: 'draft' });
  app._wizardSetActiveWeekIdForTest('w_nfl_draft');
  const nflComp = storage.getCompetitions().find((c) => c.id === NFL_C);
  assert(getActiveWeekId() === 'w_cfb' && nflComp.activeWeekId === 'w_nfl_draft', '[4a] a wizard-created NFL week moves the NFL competition\'s own pointer and leaves the league\'s active_week (the college sport\'s) alone');
  saveWeek({ ...getWeek('w_nfl_draft'), status: 'open' });
  mkWeek('w_nfl_next', { comp: NFL_C, profile: NFL_PROFILE, status: 'draft', num: 7 });
  app._wizardSetActiveWeekIdForTest('w_nfl_next');
  assert(storage.getCompetitions().find((c) => c.id === NFL_C).activeWeekId === 'w_nfl_draft', '[4b] the NFL pointer is guarded by the NFL\'s own in-progress week (an open NFL week is not displaced by a later draft)');
  mkWeek('w_cfb_next', { status: 'draft', num: 7 });
  app._wizardSetActiveWeekIdForTest('w_cfb_next');
  assert(getActiveWeekId() === 'w_cfb', '[4c] a college draft does not displace the college sport\'s open week (the guard is the DEFAULT sport\'s current week, not whichever sport is live)');
  store.delete('cfbp_weeks'); mkWeek('w_nfl_open', { comp: NFL_C, profile: NFL_PROFILE, status: 'open' }); setActiveWeekId('w_cfb_ghost');
  mkWeek('w_cfb_final', { status: 'final', num: 5 });
  mkWeek('w_cfb_new', { status: 'draft', num: 6 });
  setActiveWeekId('w_cfb_final');
  app._wizardSetActiveWeekIdForTest('w_cfb_new');
  assert(getActiveWeekId() === 'w_cfb_new', '[4d] with the college sport NOTHING in progress (an NFL week being open does not count), a college draft is adopted as the college pointer');
}

console.log('\n[5] Add a sport');
reset({ comps: 'one' });
{
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  auth._setOfferedSportsForTest(['cfb', 'nfl']);
  assert(app._addSportAvailableForTest() === true, '[5a] the platform offers NFL and the league does not run it: a sport is available');
  const before = JSON.stringify([...store.entries()].filter(([k]) => /weeks|games|picks|players|comments|settings/.test(k)));
  app.openAddSportSheet();
  assert(!!els.get('add-sport-sheet-wrap') && app._addSportStateForTest().pick === 'nfl' && app._addSportStateForTest().enrollment === 'opt_in', '[5b] the sheet opens on NFL with "Members who join" (the recommendation) chosen');
  const body = els.get('add-sport-body')?._html || '';
  assert(/Add a sport|Sports this league can add/.test(body) && /Who plays NFL\?/.test(body) && /Members who join/.test(body) && /\(recommended\)/.test(body) && /Everyone in the league/.test(body) && /Your league, members, chat and college football history stay exactly as they are\. Members will see NFL as soon as you add it\./.test(body)
    && /Tell the league in the Locker Room/.test(body) && />Cancel</.test(body) && />Add NFL</.test(body), '[5c] the sheet copy is the DI\'s, word for word');
  assert(/<button type="button" class="control-center-row control-center-row--toggle" id="add-sport-announce" role="switch" aria-checked="(?:true|false)">/.test(body) && !/type="checkbox"/.test(body) && /class="cc-row-switch" data-on="(?:true|false)"/.test(body), '[5c2] S8: "Tell the league in the Locker Room" is a role="switch" row on the shared track, not a raw checkbox');
  { // the switch flips its markup state and answers the new value
    const attrs = { 'aria-checked': 'false' }, track = { a: { 'data-on': 'false' }, setAttribute(k, v) { this.a[k] = v; } };
    const btn = { getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }, querySelector: () => track };
    const on1 = app._toggleSwitchRowForTest(btn), on2 = app._toggleSwitchRowForTest(btn);
    assert(on1 === true && attrs['aria-checked'] === 'false' && on2 === false && track.a['data-on'] === 'false', '[5c3] ...toggling flips aria-checked and the track (true, then false) and answers the new state');
  }
  const r1 = app._addSportActForTest({ enrollment: 'opt_in', announce: false });
  const comps = storage.getCompetitions();
  const nfl = comps.filter((c) => c.sport === 'nfl');
  assert(r1 && r1.done && nfl.length === 1 && nfl[0].enrollment === 'opt_in' && nfl[0].isDefault === false && nfl[0].id === ms.deterministicCompetitionId(auth.getActiveLeagueId() || 'local', 'nfl'), '[5d] ONE competition was written, opt_in, not the default, with the deterministic id');
  const r2 = app._addSportActForTest({});
  assert(storage.getCompetitions().filter((c) => c.sport === 'nfl').length === 1, '[5e] a second press (double tap) is one add: still ONE NFL competition');
  assert(JSON.stringify([...store.entries()].filter(([k]) => /weeks|games|picks|players|comments|settings/.test(k))) === before, '[5f] nothing in weeks, games, picks, players, chat or settings changed');
  assert(app._addSportAvailableForTest() === false, '[5g] with NFL running, nothing is left to add: the League Page card is absent');
  assert(/NFL added\./.test(els.get('add-sport-body')._html) && /Set up the first NFL week/.test(els.get('add-sport-body')._html) && />Not now</.test(els.get('add-sport-body')._html), '[5h] success: "NFL added." with "Set up the first NFL week" and a quiet "Not now"');
  assert(toasts.some((t) => /NFL added\./.test(t)), '[5i] the toast says NFL added.');
  assert(storage.getCurrentWeek().weekId === 'w_cfb', '[5j] the college sport\'s current week is untouched by adding the NFL');
  app._resetAddSportForTest();
  // available is false when nothing is offered
  auth._setOfferedSportsForTest([]);
  store.delete('cfbp_competitions'); saveCompetition({ id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' });
  assert(app._addSportAvailableForTest() === false, '[5k] nothing offered by the platform: no card and no sheet');
  app.openAddSportSheet();
  assert(!els.get('add-sport-sheet-wrap'), '[5l] openAddSportSheet with nothing to add opens nothing (never a dead sheet)');
  // not a commissioner: nothing opens
  auth._setOfferedSportsForTest(['cfb', 'nfl']); setSession('p2', false, true); app.openAddSportSheet();
  assert(!els.get('add-sport-sheet-wrap'), '[5m] a player (not the commissioner) cannot open the sheet');
  setSession('p1', true, true);
  // refused write: the sheet stays open with the failure copy
  // the League Page's card (leagues-home.js): real entry / absent / the unchanged stub
  const lh = await import('./js/leagues-home.js');
  const esc = (x) => String(x);
  assert(/data-action="add-sport"/.test(lh.renderAddSportStubCard({ escHtml: esc, open: true })) && lh.renderAddSportStubCard({ escHtml: esc, open: false }) === '' && /data-action="coming-soon"/.test(lh.renderAddSportStubCard({ escHtml: esc })),
    '[5n] the League Page card: a REAL entry when a sport can be added, ABSENT when none can (never a dead stub), and the coming-soon stub byte-for-byte for any call that does not say');
}

console.log('\n[6] Archive');
reset();
{
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  mkWeek('w_nfl', { comp: NFL_C, profile: NFL_PROFILE, status: 'open' });
  seam.setLensSport('nfl');
  let html = render();
  assert(/id="comm-archive-sport-btn"[^>]*disabled/.test(html) && /NFL has a week in progress\. Finish or re-open it first\./.test(html), '[6a] with an NFL week open, Archive NFL is disabled and says why');
  saveWeek({ ...getWeek('w_nfl'), status: 'final' });
  html = render();
  assert(!/id="comm-archive-sport-btn"[^>]*disabled/.test(html), '[6b] with the NFL week final, Archive NFL is enabled');
  const wkBefore = JSON.stringify(getWeek('w_nfl'));
  let confirmCalls = 0; const origConfirm = globalThis.confirm; globalThis.confirm = () => { confirmCalls += 1; return true; };
  app._confirmArchiveLensSportForTest();
  const layer = els.get('ls-action-layer') || [...els.values()].find((e) => /ms-archive-title/.test(String(e._html)));
  assert(confirmCalls === 0 && !storage.getCompetitions().find((c) => c.id === NFL_C).archivedAt, '[6c0] S7: pressing Archive opens the shared action sheet and archives NOTHING yet; window.confirm is never called');
  assert(!!layer && /Archive NFL\?/.test(layer._html) && /Members will no longer see it\. Its picks, results and standings are kept\./.test(layer._html) && /data-ls-action="confirm-archive-sport"[^>]*>Archive NFL</.test(layer._html) && /data-ls-action="cancel"/.test(layer._html), '[6c1] ...the sheet: title "Archive NFL?", the reassurance line, destructive "Archive NFL", bold Cancel (the scrim cancels)');
  app._pressActionSheetForTest('cancel');
  assert(!storage.getCompetitions().find((c) => c.id === NFL_C).archivedAt, '[6c2] Cancel leaves the sport as it was');
  app._confirmArchiveLensSportForTest();
  app._pressActionSheetForTest('confirm-archive-sport');
  globalThis.confirm = origConfirm;
  const nflC = storage.getCompetitions().find((c) => c.id === NFL_C);
  assert(!!nflC.archivedAt && nflC.sport === 'nfl' && JSON.stringify(getWeek('w_nfl')) === wkBefore && toasts.some((x) => /NFL archived\./.test(x)), '[6c] Archive sets archivedAt on the SAME competition row and deletes nothing (the week is untouched), with a toast');
  html = render();
  assert(!/comm-sport-lens/.test(html) && seam.getLensSport() === 'cfb', '[6d] the archived sport leaves the lens: one sport again, no lens, the lens back on college football');
  reset(); mkWeek('w_cfb'); setActiveWeekId('w_cfb'); mkWeek('w_nfl', { comp: NFL_C, profile: NFL_PROFILE, status: 'open' }); seam.setLensSport('nfl');
  app._confirmArchiveLensSportForTest();
  assert(!storage.getCompetitions().find((c) => c.id === NFL_C).archivedAt && toasts.some((x) => /NFL has a week in progress\. Finish or re-open it first\./.test(x)), '[6e] with a week in progress the archive is REFUSED (a toast, nothing written)');
  seam.setLensSport('cfb'); app._confirmArchiveLensSportForTest();
  assert(!storage.getCompetitions().find((c) => c.id === CFB_C).archivedAt, '[6f] the default (main) sport cannot be archived from here');
}

console.log('\n[7] The wizard');
reset();
{
  mkWeek('w_cfb', { status: 'final' }); setActiveWeekId('w_cfb');
  seam.setLensSport('nfl');
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/id="\$\{escHtml\(idPrefix\)\}cw-sport"/.test(src) && /sports\.locked/.test(src) && /nextWeekNumberFor\(getWeeksForCompetition\(c\.id\)\)/.test(src), '[7a] Step 1 has a Sport select (multi-sport only), an existing week shows its sport as text, and the default week number is within the competition');
  assert(/createWeek\(season, weekNumber, startDate, endDate, \.\.\.\(competitionId \|\| profile \? \[\{ competitionId, profile \}\] : \[\]\)\)/.test(await readFile(new URL('./js/week-wizard.js', import.meta.url), 'utf8')), '[7b] createWeekFromWizard passes competitionId and the profile to createWeek ONLY when a sport supplies them (a college call is unchanged)');
  assert(/id="wiz-tb-game"/.test(src) && /switchRowHTML\(\{ id: 'wiz-ep-enabled'/.test(src) && !/<input type="checkbox" id="wiz-ep-enabled"/.test(src) && /prof\.key === 'cfb' \|\| prof\.affinity/.test(src), '[7c] Step 3 adds the tiebreaker-game select and the longest-field-goal switch row (S8: role=switch, not a raw checkbox) for a non-college, no-affinity sport only');
  const w = { ...dm.createWeek('2026', 6, '', '', { competitionId: NFL_C, profile: NFL_PROFILE }), weekId: 'w_nfl' };
  assert(w.extraPointEnabled === false && w.tiebreakerType === 'custom', '[7d] an NFL week is born with the longest-field-goal contest OFF and the custom tiebreaker');
}

console.log('\n[8] A lifecycle post carries its week\'s sport (DI-553, DI-537 #1)');
reset({ comps: 'none' });
{
  const wCfb = mkWeek('w_c8'), wNfl = mkWeek('w_n8', { comp: NFL_C });
  assert(JSON.stringify(app.lifecycleSportFields(wCfb)) === '{}', '[8a] no competitions at all: a lifecycle post carries no sportTag key');
  reset({ comps: 'single' });
  assert(JSON.stringify(app.lifecycleSportFields(getWeek('w_c8') || wCfb)) === '{}', '[8b] ONE live sport: no sportTag key (the one-sport league\'s post is byte-identical to before)');
  reset({ comps: 'multi' });
  const a = mkWeek('w_c8b'), b = mkWeek('w_n8b', { comp: NFL_C });
  assert(JSON.stringify(app.lifecycleSportFields(a)) === '{"sportTag":"cfb"}' && JSON.stringify(app.lifecycleSportFields(b)) === '{"sportTag":"nfl"}', '[8c] two live sports: the post carries ITS week\'s sport - the default week \'cfb\', the NFL week \'nfl\'');
  assert(JSON.stringify(app.lifecycleSportFields({ ...b, competitionId: 'cccccccc-0000-0000-0000-00000000dead' })) === '{}' && JSON.stringify(app.lifecycleSportFields(null)) === '{}' && JSON.stringify(app.lifecycleSportFields({ ...b, sport: 'cfb' })) === '{"sportTag":"nfl"}',
    '[8d] a week the resolver cannot place (a dangling competition id) or no week carries nothing, and the week\'s own `sport` field is never consulted (R1)');
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/\.\.\.lifecycleSportFields\(w\),\s*\n\s*body,/.test(src), '[8e] emitLifecyclePost spreads it into the one chat event it sends');
}

console.log('\n[8f] W-57 Part 2 - THE WIRE, across the merged branches: a lifecycle post for an NFL week, emitted by the REAL emitter, queued by the REAL chat.js and packed by the REAL transport, reaches chat_append_system with sportTag "nfl"');
{
  const backend = await import('./js/backend.js'), chat = await import('./js/chat.js'), transport = await import('./js/chatTransport.js'), projection = await import('./js/supabase-projection.js');
  const rpcCalls = [];
  const client = {
    async rpc(fn, args) { rpcCalls.push({ fn, args }); return { data: (args.p_events || []).map((e, i) => ({ id: e.id, seq: 500 + i, deduped: false, ts: new Date().toISOString() })), error: null }; },
    from() { const b = { select: () => b, eq: () => b, gt: () => b, lt: () => b, order: () => b, limit: () => b, then: (r) => r({ data: [], error: null }) }; return b; },
    channel() { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel() { return true; },
  };
  transport.installSupabaseChat({ getClient: () => client, getLeagueId: () => 'lg_wire', rowToMessage: projection.rowToMessage, isReady: () => true, getIdentityEpoch: () => 1 });
  transport.setSupabaseDataModePredicate(() => true);
  const queuedFor = (weekId, opts) => {
    chat._resetForTest(); localStorage.removeItem('cfbp_chat_outbox2');
    const w = getWeek(weekId);
    backend.setDataMode('supabase');                 // opens lifecycleGatesOpen()'s isBackendConfigured(); restored at once
    let id = null;
    try { id = app.postPicksOpenedNotice(w); } finally { backend.setDataMode('sheets'); }
    const queued = JSON.parse(localStorage.getItem('cfbp_chat_outbox2') || '[]');
    const ev = queued.find((e) => e.id === id) || null;
    const folded = id ? chat.getMessage(id) : null;
    chat._resetForTest();                            // clears the flush timer and the outbox: the wire is driven by hand below
    return { id, ev, folded };
  };
  const wire = async (ev) => { rpcCalls.length = 0; await transport.appendEvents([ev]); return rpcCalls[0]; };

  reset({ comps: 'multi' });
  const nfl = mkWeek('w_wire_n', { comp: NFL_C }), cfb = mkWeek('w_wire_c');
  const n = queuedFor('w_wire_n'), c = queuedFor('w_wire_c');
  assert(n.ev && n.ev.sportTag === 'nfl' && n.folded && n.folded.sportTag === 'nfl', '[8f] the NFL week\'s lifecycle post is QUEUED by chat.js with sportTag "nfl" (and folds with it)');
  assert(c.ev && c.ev.sportTag === 'cfb', '[8f] …and the default (college) week\'s with "cfb"');
  const nCall = await wire(n.ev), cCall = await wire(c.ev);
  assert(nCall && nCall.fn === 'chat_append_system' && nCall.args.p_events[0].sportTag === 'nfl' && nCall.args.p_events[0].author === 'scribe',
    '[8f] THE WIRE: the NFL post goes to chat_append_system (SCRIBE-authored) with sportTag "nfl" in the event the RPC reads (v_ev->>\'sportTag\', 0033/0044) — what the server stores as messages.sport_tag, and what notify-fanout narrows the push by');
  assert(cCall && cCall.args.p_events[0].sportTag === 'cfb', '[8f] …and the college post with "cfb"');
  assert(projection.rowToMessage({ league_id: 'lg_wire', id: n.id, seq: 1, ts: new Date().toISOString(), type: 'message', author: 'scribe', game_tag: '', sport_tag: nCall.args.p_events[0].sportTag, body: 'x', notify: true, meta: null }).sportTag === 'nfl',
    '[8f] …and it reads back from the column as sportTag "nfl" (the column-only mapping)');

  reset({ comps: 'single' });
  mkWeek('w_wire_s');
  const one = queuedFor('w_wire_s');
  const oneCall = await wire(one.ev);
  assert(one.ev && !('sportTag' in one.ev) && one.folded && !('sportTag' in one.folded) && oneCall && !('sportTag' in oneCall.args.p_events[0]),
    '[8f] a ONE-sport league\'s lifecycle post has NO sportTag key anywhere: not queued, not folded, not on the wire (byte-identical to before)');
  transport._resetSupabaseChatForTest(); transport._resetSupabaseDataModePredicateForTest();
}

console.log('\n[9] B1: when the pointer REFUSES a sport the lens keeps its own choice (re-titled 2026-10-08: it no longer "wins over" an accepting pointer - the pointer moves with the lens, sportopstest [6i]-[6m]), and a row acts on its OWN sport (reviewer B1)');
{
  // The client branch's pointer is PLAYED-ONLY: a commissioner who is not entered in the opt-in NFL cannot move it there. Stand in for exactly that API.
  const played = { key: 'cfb' };
  seam._clientApiForTest({
    isMultiSport: () => true, getActiveSportKey: () => played.key,
    setActiveSportKey: (k) => { if (k !== 'cfb') throw new Error('not entered in ' + k); played.key = k; },
    playersForWeek: () => storage.getPlayers().filter((p) => p.active),
  });
  reset();
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  mkWeek('w_nfl', { comp: NFL_C, profile: NFL_PROFILE, status: 'open', games: 3 });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season', activeWeekId: 'w_nfl' });
  assert(seam.setLensSport('nfl') === true && seam.getLensSport() === 'nfl' && played.key === 'cfb', '[9a] the lens moves to the NFL while the played-only pointer stays on college football (the pointer write was refused)');
  assert(app._commWeekForTest()?.weekId === 'w_nfl', '[9b] ...and Comm acts on the NFL week');
  seam.resetLensSport();
  app._runSportNextActionForTest({ kind: 'lock', sport: 'nfl' });
  assert(getWeek('w_nfl').status === 'locked' && getWeek('w_cfb').status === 'open', '[9c] Lock on the NFL row locks the NFL week and leaves the college week open (the defect locked the college week)');
  app._runSportNextActionForTest({ kind: 'lock', sport: 'cfb' });
  assert(getWeek('w_cfb').status === 'locked', '[9d] Lock on the college row locks the college week');
  // a row with no week of its own refuses, and writes nothing
  reset();
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  toasts.length = 0;
  app._runSportNextActionForTest({ kind: 'lock', sport: 'nfl' });
  assert(getWeek('w_cfb').status === 'open' && toasts.some((t) => /no week to lock/.test(t)), '[9e] Lock on a sport that has no week refuses loudly and the other sport\'s week is untouched (never the lens\' or the default\'s)');
  toasts.length = 0;
  app._runSportNextActionForTest({ kind: 'lock', sport: 'nba' });
  assert(getWeek('w_cfb').status === 'open' && toasts.some((t) => /not part of this league/.test(t)), '[9f] a sport the league does not run refuses');
  // S4: a spread refused at the freeze is as loud on the all-sports Lock as on every other Lock button
  reset();
  mkWeek('w_cfb', { spread: true }); setActiveWeekId('w_cfb');
  storage.saveGame({ ...storage.getGames('w_cfb')[0], spread: 3.5, favorite: storage.getGames('w_cfb')[0].homeTeam });   // a positive (away-favored) spread against a HOME favorite: the sign contradicts the favorite
  toasts.length = 0;
  app._runSportNextActionForTest({ kind: 'lock', sport: 'cfb' });
  assert(toasts.some((t) => /Spread NOT locked for 1 game/.test(t)), '[9g] S4: Lock from the all-sports card names the game whose spread was refused (' + JSON.stringify(toasts.map((t) => t.replace(/<[^>]+>/g, '').slice(0, 60))) + ')');
  seam._clientApiForTest(null);
}

console.log('\n[10] S14: the lens is forgotten on an account / league change (DI-538)');
{
  reset();
  mkWeek('w_cfb'); setActiveWeekId('w_cfb');
  mkWeek('w_nfl', { comp: NFL_C, profile: NFL_PROFILE, status: 'open', games: 3 });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season', activeWeekId: 'w_nfl' });
  app._applyIdentityDeltaForTest('baseline');
  seam.setLensSport('nfl');
  assert(seam.getLensSport() === 'nfl', '[10a] (fixture) the commissioner is looking at the NFL');
  assert(app._applyIdentityDeltaForTest('same-identity') === false && seam.getLensSport() === 'nfl', '[10b] no identity change: the lens stays');
  setSession('p2', false, true);
  assert(app._applyIdentityDeltaForTest('different-player') === true, '[10c] (fixture) a different player is a different identity');
  assert(seam.getLensSport() === 'cfb', '[10d] ...and the lens starts again on the league\'s default sport');
  // ADDED 2026-10-08 (coordinator, DI-538): resetLensSport() is called ONCE in app.js, from onContextSwitch (the hook the identity chokepoint runs) - not also from the chokepoint itself and not from the archive path.
  const appSrc10 = (await readFile(new URL('./js/app.js', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const calls10 = (appSrc10.match(/\bresetLensSport\(\)/g) || []).length;
  const hook10 = appSrc10.slice(appSrc10.indexOf('function onContextSwitch('), appSrc10.indexOf('function onContextSwitch(') + 400);
  assert(calls10 === 1 && /resetLensSport\(\)/.test(hook10), `[10e] exactly ONE resetLensSport() call in app.js and it is inside onContextSwitch (found ${calls10})`);
}

console.log('\n[11] B3: the manual reminder names the sport of the managed week');
{
  reset({ comps: 'none' });
  const w0 = mkWeek('w_x');
  assert(JSON.stringify(app.manualReminderBodyFor(w0, 'L1')) === '{"league_id":"L1"}', '[11a] no competitions: the body is exactly what it always was');
  reset({ comps: 'single' });
  assert(JSON.stringify(app.manualReminderBodyFor(mkWeek('w_y'), 'L1')) === '{"league_id":"L1"}', '[11b] one sport: unchanged');
  reset();
  const wc = mkWeek('w_c'), wn = mkWeek('w_n', { comp: NFL_C, profile: NFL_PROFILE });
  assert(app.manualReminderBodyFor(wn, 'L1').competitionId === NFL_C && app.manualReminderBodyFor(wc, 'L1').competitionId === CFB_C, '[11c] two sports: the NFL week names the NFL competition, the college week the college one');
  assert(app.manualReminderBodyFor(null, 'L1').competitionId === undefined, '[11d] no week: no competition id');
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/client\.functions\.invoke\('reminders', \{ body: manualReminderBodyFor\(week, leagueId\) \}\)/.test(src), '[11e] the button sends that body');
}

console.log('\n[12] S3: a locked week whose spread did not freeze is noticed in EVERY sport');
{
  reset();
  app._resetUnfrozenSpreadNoticeForTest();
  mkWeek('w_c', { status: 'locked' }); setActiveWeekId('w_c');
  mkWeek('w_n', { comp: NFL_C, profile: NFL_PROFILE, status: 'locked', games: 2 });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season', activeWeekId: 'w_n' });
  const bad = (wid) => { const g = storage.getGames(wid)[0]; storage.saveGame({ ...g, spread: 3.5, favorite: g.homeTeam, lockedSpread: null }); };   // a spread that contradicts its favorite and never froze
  bad('w_n');
  toasts.length = 0;
  const first = app.maybeNoticeUnfrozenSpreads({ supabase: true, session: { isAdmin: true } });
  assert(first === true && toasts.length === 1 && /Spread NOT frozen for 1 game/.test(toasts[0]), '[12a] the NFL week (not the default sport\'s) is the one noticed: one toast, naming the game');
  assert(app.maybeNoticeUnfrozenSpreads({ supabase: true, session: { isAdmin: true } }) === false && toasts.length === 1, '[12b] ...once per week per page life');
  bad('w_c');
  const next = app.maybeNoticeUnfrozenSpreads({ supabase: true, session: { isAdmin: true } });
  assert(next === true && toasts.length === 2, '[12c] a second sport with its own refused spread gets its own notice, still ONE toast per call');
  app._resetUnfrozenSpreadNoticeForTest();
  assert(app.maybeNoticeUnfrozenSpreads({ supabase: true, session: { isAdmin: false } }) === false, '[12d] never for a player');
  reset({ comps: 'none' }); app._resetUnfrozenSpreadNoticeForTest();
  mkWeek('w_one', { status: 'locked' }); setActiveWeekId('w_one'); bad('w_one'); toasts.length = 0;
  assert(app.maybeNoticeUnfrozenSpreads({ supabase: true, session: { isAdmin: true } }) === true && toasts.length === 1, '[12e] a one-sport league: its single current week, exactly as before');
}

console.log('\n[13] S6/S12: the week card names its sport, the Games tab carries the lens, a one-sport panel is untouched');
{
  reset({ comps: 'single' });
  mkWeek('w_c'); setActiveWeekId('w_c');
  const one = render();
  assert(!/week-wizard-entry-title|comm-lens-note|comm-sport-lens/.test(one), '[13a] one sport: no card title, no "These controls change" line, no lens anywhere');
  reset({ comps: 'none' });
  mkWeek('w_c'); setActiveWeekId('w_c');
  const none = render();
  { const src0 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    assert(!/sections\.push\(commSport(?:Lens|Entries|Options)\w*\(\)\)/.test(src0) && !/sections\.push\(commAllSportsCardHTML\(\)\)/.test(src0) && /if \(entriesHTML\) sections\.push\(entriesHTML\)/.test(src0) && /if \(optionsHTML\) sections\.push\(optionsHTML\)/.test(src0) && /for \(const html of \[commSportLensHTML\(\), commAllSportsCardHTML\(\)\]\) if \(html\) sections\.push\(html\)/.test(src0),
      '[13b1] S12: every multisport section is pushed ONLY when non-empty (an empty string in the join would put a blank line into a one-sport panel)'); }
  assert(!/\n[ \t]*\n<div class="admin-section"/.test(one) && !/<\/div>\n\n<div/.test(one), '[13b0] S12: no empty section leaves a blank line between two Comm sections (the single-sport panel is byte-identical to the base: compared against int/v0.30.0\'s render, 0 such boundaries there too)');
  assert(none === one, '[13b] S12: a league with no competition rows and one with only the default render the SAME Comm panel (no empty section leaves a stray separator)');
  reset();
  mkWeek('w_c', { num: 6 }); setActiveWeekId('w_c');
  mkWeek('w_n', { comp: NFL_C, profile: NFL_PROFILE, status: 'open', num: 4, games: 3 });
  saveCompetition({ id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season', activeWeekId: 'w_n' });
  const cfbHtml = render();
  const entryCard = (h) => { const i = h.indexOf('id="week-wizard-entry-card"'); return i < 0 ? '' : h.slice(i, h.indexOf('</div>\n  </div>', i) + 16); };
  // RE-DERIVED 2026-10-08 (third pass, item 3d; DI-534 REV 5): the caption "These controls change {CODE} only." is ONCE per tab, UNDER THE LENS CONTROL, and ONLY while the lens is separate from
  // the player pointer. It is never on the week card (the card's title names the sport), and never in the ordinary state. Before: the card always carried it, and so did the Games-tab lens.
  assert(/id="week-wizard-entry-title">CFB · Week 6</.test(entryCard(cfbHtml)) && !/These controls change/.test(cfbHtml), '[13c] two sports, lens on college (the lens IS the pointer): the week card reads "CFB · Week 6" and there is NO "These controls change" caption anywhere');
  seam.setLensSport('nfl');
  const nflHtml = render();
  const weekLens = nflHtml.slice(nflHtml.indexOf('id="comm-sport-lens"'), nflHtml.indexOf('</div>\n  </div>', nflHtml.indexOf('id="comm-sport-lens"')));
  assert(seam.lensIsSeparate() === true && /id="week-wizard-entry-title">NFL · Week 4</.test(entryCard(nflHtml)) && !/These controls change/.test(entryCard(nflHtml)) && /These controls change NFL only\./.test(weekLens) && !/These controls change CFB only/.test(nflHtml), '[13d] lens on the NFL, which this commissioner has not joined (a SEPARATE lens): the card reads "NFL · Week 4" with no caption, and "These controls change NFL only." sits under the Week-tab lens');
  const lensCount = (nflHtml.match(/class="admin-section comm-lens"/g) || []).length;
  assert(lensCount === 2 && /data-comm-tab="games" id="comm-sport-lens-games"/.test(nflHtml) && /data-comm-tab="week" id="comm-sport-lens"/.test(nflHtml), `[13e] the lens is on the Week tab AND the Games tab (two radiogroups, distinct ids; found ${lensCount})`);
  const gamesLens = nflHtml.slice(nflHtml.indexOf('id="comm-sport-lens-games"'), nflHtml.indexOf('id="comm-sport-lens-games"') + 900);
  assert(/These controls change NFL only\./.test(gamesLens) && /aria-checked="true"[^>]*>NFL</.test(gamesLens), '[13f] ...and the Games-tab lens says what it changes and has the NFL selected');
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/document\.querySelectorAll\('\.comm-lens \[data-action="comm-lens"\]'\)/.test(src), '[13g] both lenses are bound by the same handler');
  seam.resetLensSport();
}

console.warn = origWarn; console.info = origInfo;
console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
