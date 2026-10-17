/**
 * CFB Pickems — historywiringtest.mjs (Deployment 1, Lane B, DI-594 / 595 / 596 / 598 / 600, 2026-10-08)
 * ======================================================================================================
 * The app.js side of the history screens, RUN against the real app.js over a real element tree built from the real index.html (minidom.mjs): Standings' two entries, the two pushed screens, the rival
 * picker sheet, the card detail's two new actions, the game thread, and what each of them does when the DOM lies. EVERY new button is tapped through the handler the app actually wired (the delegated
 * pushed-screen click, the button listener `renderLeaderboard()` binds, the sheet's own row listener) - never by calling the function behind it.
 *
 *   [1] Standings' entries: who gets a button, how it is named, what a signed-out visitor and an Open week get
 *   [2] A name opens the comparison; your own row opens the picker; a forged id does nothing
 *   [3] The comparison's own buttons: Change, the rival picker (close paths, focus), Show all, the sport control, the game and its thread
 *   [4] The week detail: parity with Weekly History and the Dashboard (a tie, a pooled group), what is unreachable, the gate re-asked on every repaint
 *   [5] The card detail's "Compare with" and "Week results"
 *   [6] The thread (DI-598): the count, the sheet, "Open in chat" closes the pushed stack, the chat's label and way back
 *   [7] Identity, holds, withheld content, and the dismiss-blocking list
 *   [6c] B1: a game older than what this device has loaded never claims absence and never shows a count
 *   [8] Source pins on the wiring
 *   [9] MUTATION PROOFS - scratch copies of app.js (data: URLs, never the file)
 *   [10] C-1 / B2: the week detail's blind rule against the REAL Supabase adapter (a pooled group whose second part the server still holds Open)
 *   [11] Part B (merged with Game Day): Share to chat from both screens, the reader's resolver for week / compare refs, the Back chip's restore, Results, the card detail's count (N4)
 *   [12] Pass 3 (review round 3): a reader NOT entered in a sport on every route into its week detail (R2 / D1, per part, the late joiner), the unavailable state's "Back to {screen}" (N1), the Game
 *        view's sport name (N7), a one-sport league unchanged. R1 (a shared comparison only for a reader entered in its sport, the Back chip's restore, leaving mid-screen) is in [6b].
 *
 * NOT COVERED HERE (a device, never a test): the slide / swipe-back feel, haptic strength, VoiceOver's reading of the pushed screens, the rival sheet's swipe-down. The computed-style proof of the new
 * surfaces in a real browser is historybrowsertest.mjs.
 *
 * Run:  node historywiringtest.mjs
 */
import { readFileSync } from 'node:fs';
import { MiniDocument } from './minidom.mjs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in historywiringtest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollY = 0; globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const INDEX = read('./index.html');
const APP = read('./js/app.js');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); const m = INDEX.match(/<body[^>]*data-tab="([^"]*)"/); if (m) doc.body.dataset.tab = m[1]; doc.body.innerHTML = bodyHtmlOf(INDEX); return doc; };
globalThis.document = freshDoc();

quiet();
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const ps = await import('./js/pushed-screen.js');
const chat = await import('./js/chat.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');
loud();

const CID = { cfb: '11111111-1111-4111-8111-111111111111', nfl: '22222222-2222-4222-8222-222222222222' };
const click = (n) => n.dispatchEvent({ type: 'click', target: n });
const root = () => document.getElementById('pushed-root');
const levels = () => (root() ? root().querySelectorAll('.ps-level') : []);
const topLevel = () => { const l = levels(); return l.length ? l[l.length - 1] : null; };
const texts = (n) => String(n && n.textContent || '').replace(/\s+/g, ' ').trim();
const sheet = () => document.getElementById('rival-picker-sheet-wrap');
const session = (pid, verified = true) => storage.setSession(pid, false, verified);

/** The two-week league of statsfixtures, signed in as Drew. */
function seed(opts = {}) {
  store.clear();
  const L = fx.buildLeague({ w2: opts.w2 || 'final', calculateWeeklyResults });
  // W-92 (2026-10-17): `milestoneP2` puts Brayden (p2) at 49 correct after week 1, so week 2 carries a ONE-member milestone card about another member — the
  // only kind of Home card that still offers "Compare with {name}" (a combined card has several members; Drew accepted that side effect).
  if (opts.milestoneP2) L.weeklyResults = L.weeklyResults.map((r) => (r.playerId === 'p2' && r.weekId === 'w1' ? { ...r, correctCount: 49, correctPicks: 49 } : r));
  L.players.forEach((p) => storage.savePlayer({ ...p }));
  L.weeks.forEach((w) => storage.saveWeek(w));
  L.games.forEach((g) => storage.saveGame(g));
  storage.saveAllPicks(L.picks);
  storage.saveAllWeeklyResults('w1', L.weeklyResults.filter((r) => r.weekId === 'w1'));
  if ((opts.w2 || 'final') === 'final') storage.saveAllWeeklyResults('w2', L.weeklyResults.filter((r) => r.weekId === 'w2'));
  storage.saveSetting('chatEnabled', true); storage.saveSetting('chatEpochSeq', 0); storage.saveSetting('chatRetentionDays', 0);
  session('p1');
  return L;
}
const reset = () => { try { app._resetRivalPickerForTest(); } catch {} try { ps.closeAllScreens('test'); } catch {} globalThis.document = freshDoc(); app._resetHomeWiringForTest(); app.state.currentTab = 'home'; app.state.viewingWeekId = null; globalThis.scrollY = 0; };
const standings = () => { reset(); quiet(); window.navigateTo('leaderboard'); loud(); return document.getElementById('page-leaderboard'); };

seed();

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] Standings\' entries…');
{
  let page = standings();
  const btns = page.querySelectorAll('[data-cmp-player]');
  const rows = app.seasonStandingsRows();
  assert(btns.length === 6 && btns.every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button') && btns.map((b) => b.getAttribute('data-cmp-player')).join() === rows.map((r) => r.playerId).join(),
    `1a: a signed-in member gets one real <button> per Season Summary row, in Standings' own order (${btns.map((b) => b.getAttribute('data-cmp-player')).join(',')})`);
  const named = btns.every((b) => { const el = page.querySelector(`#${b.getAttribute('aria-labelledby')}`); return el && texts(el) === rows.find((r) => r.playerId === b.getAttribute('data-cmp-player')).displayName; });
  assert(named, '1b: each button is NAMED by the visible name (aria-labelledby points at the name span) - the name is written once');
  const attrs = btns.map((b) => ['aria-labelledby', 'aria-describedby', 'data-cmp-player'].map((k) => b.getAttribute(k)).join(' ')).join(' ');
  assert(!rows.some((r) => attrs.includes(r.displayName)), '1c: no player-typed text is ever put in an attribute of the button (ids and constants only)');
  const own = btns.find((b) => b.getAttribute('data-cmp-player') === 'p1'), other = btns.find((b) => b.getAttribute('data-cmp-player') === 'p2');
  assert(own.getAttribute('aria-describedby') === 'stand-cmp-hint-own' && other.getAttribute('aria-describedby') === 'stand-cmp-hint' && /Choose someone to compare with/.test(texts(page.querySelector('#stand-cmp-hint-own'))) && /Opens a comparison with this player/.test(texts(page.querySelector('#stand-cmp-hint'))),
    '1d: your own row is described "Choose someone to compare with."; the others "Opens a comparison with this player."');
  assert(btns.every((b) => !!b.querySelector('.stand-cmp-chev svg') && b.querySelector('.stand-cmp-chev').getAttribute('aria-hidden') === 'true'), '1e: the chevron (the one icon family) is decorative on every row');
  assert(/Win % counts every pick once\. Tap a player to compare\.<\/p>|Win % counts every pick once\. Tap a player to compare\./.test(page.querySelector('.stand-foot').textContent), '1f: the footnote gains "Tap a player to compare." for a signed-in member');
  const { COMPARE_COPY } = await import('./js/compare.js');
  const { WEEK_DETAIL_COPY } = await import('./js/week-detail.js');
  const foot = texts(page.querySelector('.stand-foot'));
  assert(COMPARE_COPY.footnote === 'Picks count each game’s multiplier. Win % counts every pick once.' && WEEK_DETAIL_COPY.footnote === COMPARE_COPY.footnote && foot.startsWith(COMPARE_COPY.footnote),
    `1f2: the comparison's and the week detail's raw-versus-weighted sentence IS Standings' own sentence, word for word ("${foot.slice(0, 70)}")`);
  const openers = page.querySelectorAll('[data-wk-open]');
  assert(openers.length === 2 && openers.map((o) => o.getAttribute('data-wk-open')).sort().join() === 'w1,w2' && openers.every((o) => { const n = page.querySelector(`#${o.getAttribute('aria-labelledby')}`); return n && /^Week \d$/.test(texts(n)); }),
    '1g: Weekly History: the two revealed weeks each have an opener, named by the visible week name');
  // signed out
  storage.setSession(null, false, false);
  quiet(); window.navigateTo('leaderboard'); loud();
  page = document.getElementById('page-leaderboard');
  assert(page.querySelectorAll('[data-cmp-player]').length === 0 && page.querySelector('.stand-name-wrap') && page.querySelector('.stand-name-wrap').tagName === 'DIV' && !/Tap a player/.test(page.querySelector('.stand-foot').textContent) && !page.querySelector('#stand-cmp-hint'),
    '1h: SIGNED OUT - the name cells are plain (inert), the footnote has no hint, and no hidden description exists');
  assert(page.querySelectorAll('[data-wk-open]').length === 2, '1i: …but a revealed week still opens for a signed-out visitor (a public week, S4)');
  // not verified
  storage.setSession('p1', false, false);
  quiet(); window.navigateTo('leaderboard'); loud();
  assert(document.getElementById('page-leaderboard').querySelectorAll('[data-cmp-player]').length === 0, '1j: an unverified session (a typed id, no sign-in) cannot compare - viewerMemberId() is the same test the Picks page applies');
  session('p1');
  // Open / Locked / live rows
  const L = seed();
  const extra = (id, n, status) => { storage.saveWeek({ ...L.weeks[1], weekId: id, weekNumber: n, label: `Week ${n}`, status, groupId: null, finalizedAt: null }); };
  extra('wOpen', 3, 'open'); extra('wLocked', 4, 'locked'); extra('wLive', 5, 'live');
  page = standings();
  const byWeek = (id) => page.querySelector(`[data-wk-open="${id}"]`);
  assert(!byWeek('wOpen') && !byWeek('wLocked') && !!byWeek('wLive') && !!byWeek('w1') && !!byWeek('w2'), '1k: an OPEN week and a LOCKED week have NO opener (nothing to open); a LIVE week and the FINAL ones do');
  const histOf = (html) => html.slice(html.indexOf('Weekly History'));
  const row = (n) => { const t = page.querySelectorAll('tbody.stand-wk-group').find((g) => texts(g).startsWith(`Week ${n}`)); return t; };
  assert(!!row(3) && row(3).querySelectorAll('button').length === 0 && /In progress/.test(texts(row(3))) && !/Washington|Oregon/.test(texts(row(3))), '1l: the Open week\'s row is the plain "In progress" row it always was - no button, no name, no result');
  void histOf;
  // N3 (review): a signed-in member who is NOT a row of the Standings (no stake in this sport / no longer active) has nobody to compare AS: plain cells, no hint, no hidden description; the week openers stay
  seed();
  storage.savePlayer({ ...fx.PLAYERS.find((p) => p.playerId === 'p6'), active: false });
  session('p6');
  page = standings();
  assert(!app.seasonStandingsRows().some((r) => r.playerId === 'p6') && page.querySelectorAll('[data-cmp-player]').length === 0 && !/Tap a player/.test(page.querySelector('.stand-foot').textContent)
    && !page.querySelector('#stand-cmp-hint') && !page.querySelector('#stand-cmp-hint-own') && page.querySelector('.stand-name-wrap').tagName === 'DIV',
    '1m: N3 - a signed-in member who is not a Standings row gets plain name cells, no "Tap a player to compare.", no hidden description');
  assert(page.querySelectorAll('[data-wk-open]').length === 2, '1n: …but the revealed weeks still open for them (a public week)');
  seed();
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] A name opens the comparison; your own row opens the picker; a forged id does nothing…');
{
  let page = standings();
  const before = page.innerHTML;
  const to = (id) => page.querySelector(`[data-cmp-player="${id}"]`);
  quiet(); click(to('p2')); loud();
  let lv = topLevel();
  assert(ps.screenDepth() === 1 && ps.topScreenId() === 'compare:p1:p2' && !!lv, `2a: tapping Brayden pushes ONE pushed screen "compare:p1:p2" (${ps.topScreenId()})`);
  assert(texts(lv.querySelector('.ps-title')) === 'You vs Brayden' && lv.querySelector('[data-ps-back]').getAttribute('aria-label') === 'Back to Standings', '2b: the title is "You vs Brayden" and Back is "Back to Standings"');
  assert(!!lv.querySelector('.cmp-h2h') && !!lv.querySelector('.cmp-season') && !!lv.querySelector('.cmp-splits') && texts(lv.querySelector('.cmp-through')) === 'Through Week 2 · 9 finished games', '2c: the three cards and the header are there, with the hand-derived denominator');
  assert(texts(lv.querySelector('[data-ps-right] [data-cmp-action="change"]')) === 'Change', '2d: the nav bar\'s right slot holds "Change"');
  assert(page.innerHTML === before, '2e: Standings stays mounted UNDER the screen, byte for byte (so Back lands exactly where the reader was)');
  quiet(); click(lv.querySelector('[data-ps-back]')); loud();
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(!ps.isScreenOpen() && !root(), '2f: Back removes it');
  // a forged id
  const forged = to('p3'); forged.setAttribute('data-cmp-player', 'p9');
  quiet(); click(forged); loud();
  assert(!ps.isScreenOpen() && !sheet(), '2g: a button whose id is not a row Standings lists NOW does nothing (Std-9)');
  forged.setAttribute('data-cmp-player', 'p3');
  // own row: the picker
  quiet(); click(to('p1')); loud();
  assert(!ps.isScreenOpen() && !!sheet() && sheet().querySelectorAll('[data-cmp-action="pick-rival"]').length === 5 && !sheet().querySelector('[data-cmp-rival="p1"]'), '2h: your OWN row opens the rival picker (a bottom sheet) listing everyone BUT you - comparing yourself is not offered');
  assert(sheet().hasAttribute('data-hold-teardown') && sheet().querySelector('#rival-picker-sheet').getAttribute('role') === 'dialog' && sheet().querySelector('#rival-picker-sheet').getAttribute('aria-modal') === 'true', '2i: it carries the hold-teardown marker and the dialog semantics');
  assert(app._dismissBlockingSurfaceUpForTest() === true && app._dismissBlockingSurfaceUpForTest({ excludePushed: true }) === true, '2j: while it is up it is on the dismiss-blocking list (a swipe or Esc beneath it must not arm)');
  quiet(); click(sheet().querySelector('[data-cmp-rival="p3"]')); loud();
  assert(!sheet() && ps.topScreenId() === 'compare:p1:p3' && texts(topLevel().querySelector('.ps-title')) === 'You vs Kevin', '2k: choosing Kevin closes the sheet and pushes "You vs Kevin"');
  ps.closeAllScreens('test');
  // signed out: a stale button
  const stale = standings().querySelector('[data-cmp-player="p2"]');
  storage.setSession(null, false, false);
  quiet(); click(stale); loud();
  assert(!ps.isScreenOpen() && !sheet(), '2l: a button that outlived the sign-in does nothing (the viewer is re-read at TAP time)');
  session('p1');
  // no one to compare with
  seed();
  for (const id of ['p2', 'p3', 'p4', 'p5', 'p6']) storage.savePlayer({ ...fx.PLAYERS.find((p) => p.playerId === id), active: false });
  page = standings();
  assert(page.querySelectorAll('[data-cmp-player]').length === 1, '2m: (fixture) only Drew is left in the league');
  quiet(); click(page.querySelector('[data-cmp-player="p1"]')); loud();
  assert(!!sheet() && /No one else has joined yet, so there is nobody to compare with\./.test(texts(sheet())) && sheet().querySelectorAll('[data-cmp-action="pick-rival"]').length === 0, '2n: alone in the league, your own row opens an honest empty picker, never a dead list');
  app._resetRivalPickerForTest();
  seed();
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3] The comparison\'s own buttons…');
{
  let page = standings();
  quiet(); click(page.querySelector('[data-cmp-player="p2"]')); loud();
  let lv = topLevel();
  // Change -> picker -> another rival replaces the level
  quiet(); click(lv.querySelector('[data-cmp-action="change"]')); loud();
  assert(!!sheet() && sheet().querySelectorAll('.cmp-pick-row').length === 5 && sheet().querySelector('.cmp-pick-row.is-current').getAttribute('data-cmp-rival') === 'p2' && sheet().querySelector('.cmp-pick-row.is-current .cmp-pick-check svg'), '3a: Change opens the picker with Brayden marked current (a check)');
  assert(app._rivalPickerStateForTest() && app._rivalPickerStateForTest().rivalId === 'p2', '3b: the picker knows the present rival');
  quiet(); click(sheet().querySelector('[data-cmp-rival="p2"]')); loud();
  assert(!sheet() && ps.screenDepth() === 1 && ps.topScreenId() === 'compare:p1:p2', '3c: choosing the SAME rival just closes the sheet (no second screen, no flash)');
  quiet(); click(topLevel().querySelector('[data-cmp-action="change"]')); click(sheet().querySelector('[data-cmp-rival="p4"]')); loud();
  assert(ps.screenDepth() === 1 && ps.topScreenId() === 'compare:p1:p4' && texts(topLevel().querySelector('.ps-title')) === 'You vs Koby' && topLevel().querySelector('[data-ps-back]').getAttribute('aria-label') === 'Back to Standings',
    `3d: choosing Koby REPLACES the level (depth stays 1, ${ps.topScreenId()}) and Back still says "Back to Standings"`);
  // P-3 (a new touch during a hold): the sheet is sliding out (260 ms) and Change is tapped AGAIN - a fresh sheet opens, and the OLD close finishing later does not remove it
  quiet(); click(topLevel().querySelector('[data-cmp-action="change"]')); loud();
  const ghost = sheet();
  quiet(); click(sheet().querySelector('#rival-picker-close')); loud();
  assert(!!sheet() && sheet() === ghost, '3d-p3a: (fixture) the ✕ started the slide-out - the old sheet is still in the DOM');
  quiet(); click(topLevel().querySelector('[data-cmp-action="change"]')); loud();
  assert(!!sheet() && sheet() !== ghost && app._rivalPickerStateForTest() && app._rivalPickerStateForTest().closing === false, '3d-p3b: a tap on Change during the slide-out opens a NEW sheet at once');
  await wait(600);
  assert(!!sheet() && document.querySelectorAll('#rival-picker-sheet-wrap').length === 1 && sheet().querySelectorAll('.cmp-pick-row').length === 5, '3d-p3c: …and when the old close finishes it removes ONLY its own sheet - the new one is still there with its rows');
  quiet(); click(sheet().querySelector('#rival-picker-close')); loud();
  await wait(450);
  assert(!sheet(), '3d-p3d: …and the new one closes normally');
  // forged rival in the picker
  quiet(); click(topLevel().querySelector('[data-cmp-action="change"]')); loud();
  const fr = sheet().querySelector('[data-cmp-rival="p5"]'); fr.setAttribute('data-cmp-rival', 'p9');
  quiet(); click(fr); loud();
  assert(!!sheet() && ps.topScreenId() === 'compare:p1:p4', '3e: a picker row whose id is not someone the sport lists now does nothing - the sheet stays, the screen does not change');
  // close paths
  quiet(); click(sheet().querySelector('#rival-picker-close')); loud();
  await wait(450);
  assert(!sheet(), '3f: the ✕ closes the sheet');
  quiet(); click(topLevel().querySelector('[data-cmp-action="change"]')); loud();
  quiet(); click(sheet().querySelector('.chat-sheet-backdrop')); loud();
  await wait(450);
  assert(!sheet(), '3g: the backdrop closes it');
  quiet(); click(topLevel().querySelector('[data-cmp-action="change"]')); loud();
  quiet(); document.dispatchEvent({ type: 'keydown', key: 'Escape' }); loud();
  await wait(450);
  assert(!sheet() && ps.isScreenOpen(), '3h: Esc closes the sheet and ONLY the sheet (the screen beneath keeps Esc for later)');
  assert(document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-cmp-action') === 'change', `3i: focus returns to the control that opened the sheet ("Change"): ${document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-cmp-action')}`);
  ps.closeAllScreens('test');

  // Show all: 13 splits -> a third week with many games Drew and Brayden split on
  const L = seed();
  const extraGames = [];
  const w3 = fx.mkWeek({ id: 'w3', n: 3, status: 'final' });
  storage.saveWeek(w3);
  for (let i = 0; i < 11; i++) {
    const g = fx.mkGame({ id: `x${i}`, weekId: 'w3', kick: `2026-09-19T${String(10 + i).padStart(2, '0')}:00:00.000Z`, home: `Home${i}`, away: `Away${i}`, kind: 'cover', state: 'final' });
    extraGames.push(g); storage.saveGame(g);
  }
  const picks3 = extraGames.flatMap((g) => fx.mkPicks(g, 'cover', 'WL----'));
  storage.saveAllPicks([...storage.getAllPicks ? storage.getAllPicks() : L.picks, ...picks3]);
  storage.saveAllWeeklyResults('w3', calculateWeeklyResults('w3', L.players, picks3, extraGames, null));
  page = standings();
  quiet(); click(page.querySelector('[data-cmp-player="p2"]')); loud();
  lv = topLevel();
  assert(lv.querySelectorAll('.hx-item').length === 15 && lv.querySelectorAll('.hx-item--extra').length === 5, `3j: 4 old + 11 new splits = 15 rows, ten shown and five behind Show all (${lv.querySelectorAll('.hx-item').length}/${lv.querySelectorAll('.hx-item--extra').length})`);
  const more = lv.querySelector('[data-cmp-action="show-all"]');
  quiet(); click(more); loud();
  assert(lv.querySelector('[data-cmp-list]').getAttribute('data-expanded') === 'true' && more.getAttribute('aria-expanded') === 'true' && texts(more) === 'Show fewer', '3k: Show all expands IN PLACE (no repaint) and the button says Show fewer');
  quiet(); click(more); loud();
  assert(lv.querySelector('[data-cmp-list]').getAttribute('data-expanded') === 'false' && texts(more) === 'Show all 15', '3l: …and folds back');
  assert(topLevel() === lv, '3m: the same level node throughout (nothing was rebuilt)');

  // the game and its thread
  const firstGame = lv.querySelector('[data-cmp-action="open-game"]').getAttribute('data-cmp-game');
  assert(!document.getElementById('chat-sheet-wrap'), '3n: (fixture) no thread sheet yet');
  quiet(); click(lv.querySelector(`[data-cmp-action="open-thread"][data-cmp-game="${firstGame}"]`)); loud();
  assert(!!document.getElementById('chat-sheet-wrap') && ps.isScreenOpen() && ps.topScreenId() === 'compare:p1:p2', '3o: Thread opens the EXISTING game thread sheet over the screen, which stays where it is beneath it');
  document.getElementById('chat-sheet-wrap').remove();
  quiet(); click(lv.querySelector(`[data-cmp-action="open-game"][data-cmp-game="${firstGame}"]`)); loud();
  assert(ps.screenDepth() === 2 && ps.topScreenId() === `game:${firstGame}` && texts(topLevel().querySelector('[data-ps-back]')) === 'You vs Brayden' && !document.getElementById('chat-sheet-wrap'),
    `3p: the row opens the GAME VIEW above the comparison (Game Day's openGameView, from a detail screen), whose Back is labelled with this screen's title (${ps.topScreenId()}, "${texts(topLevel().querySelector('[data-ps-back]'))}")`);
  quiet(); ps.popScreen({ instant: true }); loud();
  assert(ps.screenDepth() === 1 && ps.topScreenId() === 'compare:p1:p2' && topLevel() === lv, '3p2: …and Back returns to the comparison, the same level node');
  const forgedGame = lv.querySelector(`[data-cmp-action="open-game"][data-cmp-game="${firstGame}"]`);
  forgedGame.setAttribute('data-cmp-game', 'g11');                 // a game both picked and AGREED on - not in the split list
  quiet(); click(forgedGame); loud();
  assert(!document.getElementById('chat-sheet-wrap') && ps.screenDepth() === 1, '3q: a game the screen does not list (one they agreed on) does nothing');
  const forgedThread = lv.querySelector('[data-cmp-action="open-thread"]'); forgedThread.setAttribute('data-cmp-game', 'nope');
  quiet(); click(forgedThread); loud();
  assert(!document.getElementById('chat-sheet-wrap'), '3r: …and neither does a thread for a game id that is not there');
  // the unknown action
  const weird = lv.querySelector('[data-cmp-action="show-all"]'); weird.setAttribute('data-cmp-action', 'delete-everything');
  quiet(); click(weird); loud();
  assert(ps.isScreenOpen() && !document.getElementById('chat-sheet-wrap') && !sheet(), '3s: an action that is not on the allow-list is ignored');
  ps.closeAllScreens('test');
  seed();
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[4] The week detail…');
{
  const L = seed();
  let page = standings();
  const rowOf = (n) => page.querySelectorAll('tbody.stand-wk-group').find((g) => texts(g).startsWith(`Week ${n}`));
  quiet(); click(page.querySelector('[data-wk-open="w2"]')); loud();
  let lv = topLevel();
  assert(ps.screenDepth() === 1 && ps.topScreenId() === 'week:w2' && texts(lv.querySelector('.ps-title')) === 'Week 2' && lv.querySelector('[data-ps-back]').getAttribute('aria-label') === 'Back to Standings', `4a: tapping Week 2 pushes "week:w2" titled "Week 2" over Standings (${ps.topScreenId()})`);
  const histRow = texts(rowOf(2));
  const winnerHist = /Jacob/.test(histRow), loserHist = /Kevin/.test(histRow);
  assert(winnerHist && loserHist && /Winner\s*Jacob \(4–0\)/.test(texts(lv)) && /Loser\s*Kevin \(0–4\)/.test(texts(lv)), `4b: the detail names the SAME winner and loser as Weekly History's row (${histRow.slice(0, 60)}…)`);
  // B3 (review): a record (Winner 4–0) and a rank (the table) share this screen, so it carries Standings' raw-versus-weighted sentence - once, inside the standings card
  const SENT = 'Picks count each game’s multiplier. Win % counts every pick once.';
  const stCard = lv.querySelector('.cd-table');
  assert(!!stCard && texts(stCard).includes(SENT) && lv.querySelectorAll('.wd-foot').length === 1 && texts(lv).split(SENT).length === 2 && !!stCard.querySelector('.wd-foot'),
    '4b2: B3 - the week detail carries Standings\' raw-versus-weighted sentence, once, inside the standings card that shows rank beside the winner\'s record');
  // parity with the Dashboard's summary rows for the same week
  app.state.viewingWeekId = 'w2';
  quiet(); window.navigateTo('dashboard'); loud();
  const dash = document.getElementById('page-dashboard');
  const dashRows = dash.querySelectorAll('tbody tr').map(texts).filter((t) => /Jacob|Kevin|Drew|Brayden|Koby|Kihoon/.test(t) && /\b\d+\s*\d+/.test(t));
  const detailRows = lv.querySelectorAll('.cd-table tbody tr').map(texts);
  assert(detailRows.length === 6 && detailRows.every((t) => dashRows.includes(t)), `4c: the week's standings are the Dashboard's own rows - ${detailRows.length} rows, each found verbatim in the Dashboard's summary for the same week (e.g. "${detailRows[0]}")`);
  assert(app.state.currentTab === 'dashboard', '4c-ctl: (control) the navigation to the Dashboard really happened, so 4c compared two real pages');
  // that navigate closed the pushed stack - the tab change rule
  assert(!ps.isScreenOpen(), '4d: a tab change closes the pushed stack through its own door (nothing is left covering the Dashboard)');
  page = standings();
  // the games
  quiet(); click(page.querySelector('[data-wk-open="w2"]')); loud();
  lv = topLevel();
  const rows = lv.querySelectorAll('.hx-item');
  assert(rows.length === 4 && rows[0].getAttribute('data-key') === 'g21' && /Washington at Oregon/.test(texts(rows[0])) && /Washington 20 – Oregon 17/.test(texts(rows[0])) && /Washington covered by 10/.test(texts(rows[0])) && /Split 4–2/.test(texts(rows[0])) && /Your pick Oregon ✗/.test(texts(rows[0])),
    `4e: g21's row - matchup, score, who covered, the 4–2 split and Drew's own missed pick (${texts(rows[0]).slice(0, 120)})`);
  assert(/Thread · 0/.test(texts(rows[0])), '4f: "Thread · 0" - the honest count when no one has talked (chat is on)');
  // thread and game buttons
  quiet(); click(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]')); loud();
  assert(!!document.getElementById('chat-sheet-wrap') && ps.isScreenOpen(), '4g: Thread opens the game thread sheet over the screen');
  document.getElementById('chat-sheet-wrap').remove();
  quiet(); click(lv.querySelector('[data-wd-action="open-game"][data-wd-game="g22"]')); loud();
  assert(ps.screenDepth() === 2 && ps.topScreenId() === 'game:g22' && texts(topLevel().querySelector('[data-ps-back]')) === 'Week 2' && !document.getElementById('chat-sheet-wrap'), `4h: the row opens the GAME VIEW above the week detail, Back labelled "Week 2" (${ps.topScreenId()}, "${texts(topLevel().querySelector('[data-ps-back]'))}")`);
  quiet(); ps.popScreen({ instant: true }); loud();
  assert(ps.screenDepth() === 1 && ps.topScreenId() === 'week:w2' && topLevel() === lv, '4h2: …and Back returns to the week detail, the same level node');
  const fg = lv.querySelector('[data-wd-action="open-game"][data-wd-game="g22"]'); fg.setAttribute('data-wd-game', 'g11');
  quiet(); click(fg); loud();
  assert(!document.getElementById('chat-sheet-wrap') && ps.screenDepth() === 1, '4i: a game from ANOTHER week (g11) is not on this screen, so a forged row does nothing');
  ps.closeAllScreens('test');

  // unreachable weeks
  const extra = (id, n, status) => storage.saveWeek({ ...L.weeks[1], weekId: id, weekNumber: n, label: `Week ${n}`, status, groupId: null, finalizedAt: null });
  extra('wOpen', 3, 'open'); extra('wLocked', 4, 'locked'); extra('wDraft', 5, 'draft');
  storage.saveWeek({ ...L.weeks[1], weekId: 'wDemo', weekNumber: 6, label: 'Week 6', status: 'final', dataSourceMode: 'demo', groupId: null });
  storage.saveWeek({ ...L.weeks[1], weekId: 'wHidden', weekNumber: 7, label: 'Week 7', status: 'final', showInHistory: false, groupId: null });
  for (const id of ['wOpen', 'wLocked', 'wDraft', 'wDemo', 'wHidden', 'nope', '', null, 7]) {
    quiet(); const r = app.openWeekDetail(id); loud();
    if (r !== false || ps.isScreenOpen()) { assert(false, `4j: openWeekDetail(${JSON.stringify(id)}) refused (got ${r}, depth ${ps.screenDepth()})`); ps.closeAllScreens('test'); }
  }
  assert(!ps.isScreenOpen(), '4j: an Open, Locked, Draft, demo or hidden week, an unknown id and a non-string all return false and push NOTHING');
  page = standings();
  const fake = page.querySelector('[data-wk-open="w2"]'); fake.setAttribute('data-wk-open', 'wOpen');
  quiet(); click(fake); loud();
  assert(!ps.isScreenOpen(), '4k: a forged opener naming an Open week does nothing');
  quiet(); const ok = app.openWeekDetail('w1', { backLabel: 'Game Day' }); loud();
  assert(ok === true && texts(topLevel().querySelector('[data-ps-back]')) === 'Game Day', '4l: the exported seam - openWeekDetail(weekId, { backLabel }) opens the detail above whatever called it (Game Day wires "See week results" here)');
  ps.closeAllScreens('test');

  // the gate is asked again on EVERY repaint
  quiet(); app.openWeekDetail('w2'); loud();
  assert(/Washington at Oregon/.test(texts(topLevel())), '4m: (fixture) the detail names a game');
  storage.saveWeek({ ...storage.getWeek('w2'), status: 'open' });
  ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
  assert(/This week isn't available right now\./.test(texts(topLevel())) && !/Washington|Oregon|Jacob|Kevin/.test(texts(topLevel())), '4n: the week stops being public while its detail is open - the next repaint becomes the calm unavailable state and not one name or team stays on screen');
  quiet(); click(topLevel().querySelector('[data-wd-action="back"]')); loud();
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(!ps.isScreenOpen(), '4o: its "Back to Standings" button works');
  storage.saveWeek({ ...storage.getWeek('w2'), status: 'final' });

  // a tie decided by the tiebreaker: Weekly History's note and the detail's line are the same words
  seed();
  const w3 = fx.mkWeek({ id: 'w3', n: 3, status: 'final' });
  storage.saveWeek(w3);
  const gs = ['a', 'b'].map((k, i) => fx.mkGame({ id: `t${k}`, weekId: 'w3', kick: `2026-09-19T1${i}:00:00.000Z`, home: `T${k}H`, away: `T${k}A`, kind: 'cover', state: 'final' }));
  gs.forEach((g) => storage.saveGame(g));
  const tp = gs.flatMap((g) => fx.mkPicks(g, 'cover', 'WWLL--'));
  storage.saveAllPicks([...storage.getPicks(), ...tp]);
  const tr = calculateWeeklyResults('w3', L.players.slice(0, 4), tp, gs, 10);
  const wRow = tr.find((r) => r.isWinner), lRow = tr.find((r) => r.isLoser);
  // a dead heat settled by the draw at BOTH ends (the descriptor Weekly History prints as one "Tie:" line)
  const rows3 = tr.map((r) => (r === wRow ? { ...r, wonByTiebreaker: true, tieBreak: { v: 1, end: 'winner', stage: 'draw', vs: lRow.playerId, me: null, other: null } }
    : r === lRow ? { ...r, tieBreak: { v: 1, end: 'loser', stage: 'draw', vs: wRow.playerId, me: null, other: null } } : r));
  storage.saveAllWeeklyResults('w3', rows3);
  page = standings();
  quiet(); click(page.querySelector('[data-wk-open="w3"]')); loud();
  const note = (page.querySelectorAll('tbody.stand-wk-group').find((g) => texts(g).startsWith('Week 3')) || { querySelector: () => null }).querySelector('.tie-note');
  assert(!!note && /Tie:/.test(texts(note)) && texts(topLevel()).includes(texts(note)), `4p: the tie-break line is Weekly History's own sentence, word for word ("${note && texts(note).slice(0, 70)}")`);
  ps.closeAllScreens('test');

  // a pooled group: parity with the History row, and an unfinished group
  seed();
  const pa = fx.mkWeek({ id: 'wa', n: 3, status: 'final', extra: { groupId: 'grp3' } }), pb = fx.mkWeek({ id: 'wb', n: 4, status: 'final', extra: { groupId: 'grp3' } });
  storage.saveWeek(pa); storage.saveWeek(pb);
  const mkG = (w, k, i, out) => { const g = fx.mkGame({ id: `${w}${k}`, weekId: w, kick: `2026-09-2${i}T12:00:00.000Z`, home: `${w}${k}H`, away: `${w}${k}A`, kind: 'cover', state: 'final' }); storage.saveGame(g); return fx.mkPicks(g, 'cover', out); };
  const poolPicks = [...mkG('wa', 'a', 0, 'WLLL--'), ...mkG('wa', 'b', 1, 'WLLL--'), ...mkG('wb', 'a', 2, 'WWLL--')];
  storage.saveAllPicks([...storage.getPicks(), ...poolPicks]);
  storage.saveAllWeeklyResults('wa', calculateWeeklyResults('wa', L.players.slice(0, 4), poolPicks.filter((p) => p.weekId === 'wa'), storage.getGames('wa'), null));
  storage.saveAllWeeklyResults('wb', calculateWeeklyResults('wb', L.players.slice(0, 4), poolPicks.filter((p) => p.weekId === 'wb'), storage.getGames('wb'), null));
  page = standings();
  const poolOpener = page.querySelectorAll('[data-wk-open]').find((o) => ['wa', 'wb'].includes(o.getAttribute('data-wk-open')));
  assert(!!poolOpener, '4q: the pooled group has ONE opener in Weekly History (one row for the competitive week)');
  const poolRow = texts(page.querySelectorAll('tbody.stand-wk-group').find((g) => texts(g).includes('Week 3 + Week 4')));
  quiet(); click(poolOpener); loud();
  lv = topLevel();
  assert(ps.topScreenId() === 'week:grp3' && texts(lv.querySelector('.ps-title')) === 'Week 3 + Week 4', `4r: it opens the GROUP ("${texts(lv.querySelector('.ps-title'))}")`);
  const whoWon = (poolRow.match(/Drew|Brayden|Kevin|Koby/) || [])[0];
  assert(!!whoWon && new RegExp(`Winner\\s*${whoWon}`).test(texts(lv)), `4s: the group's winner is Weekly History's row's winner (${whoWon})`);
  assert(lv.querySelectorAll('.wd-part').length === 2 && lv.querySelectorAll('.hx-item').length === 3 && lv.querySelectorAll('.cd-table tbody tr').length === 6, '4t: Part 1 and Part 2 are labelled, three games, and the standings are the pooled rows of the competition\'s six members');
  ps.closeAllScreens('test');
  storage.saveWeek({ ...storage.getWeek('wb'), status: 'live' });
  page = standings();
  const unfinished = texts(page.querySelectorAll('tbody.stand-wk-group').find((g) => texts(g).includes('Week 3 + Week 4')));
  quiet(); click(page.querySelectorAll('[data-wk-open]').find((o) => ['wa', 'wb'].includes(o.getAttribute('data-wk-open')))); loud();
  assert(/In progress/.test(unfinished) && /Results post when every part is final\. 1 of 2 parts are final\./.test(texts(topLevel())) && !/Winner|Loser/.test(texts(topLevel())) && !topLevel().querySelector('.cd-table'),
    '4u: with one part still live the History row says In progress and the detail says "Results post when every part is final. 1 of 2 parts are final." - no winner, no standings');
  assert(!texts(topLevel()).includes(SENT) && !topLevel().querySelector('.wd-foot'), '4u2: …and with no rank on the screen there is no raw-versus-weighted sentence either');
  ps.closeAllScreens('test');

  // B2 (review gap G15): a pooled group whose SECOND part is still Open or Locked, through the real openWeekDetail - that part contributes NOTHING (no game, no team, no label, no split, no table)
  for (const partTwo of ['open', 'locked']) {
    seed();
    storage.saveWeek(fx.mkWeek({ id: 'wa', n: 3, status: 'final', extra: { groupId: 'grp3' } }));
    storage.saveWeek({ ...fx.mkWeek({ id: 'wb', n: 4, status: partTwo, extra: { groupId: 'grp3' } }), picksLockAt: null, picksOpenAt: null });
    const mk2 = (w, k, i, out) => { const g = fx.mkGame({ id: `${w}${k}`, weekId: w, kick: `2026-09-2${i}T12:00:00.000Z`, home: `${w}${k}H`, away: `${w}${k}A`, kind: 'cover', state: w === 'wa' ? 'final' : 'scheduled' }); storage.saveGame(g); return fx.mkPicks(g, 'cover', out); };
    const pp = [...mk2('wa', 'a', 0, 'WLLL--'), ...mk2('wa', 'b', 1, 'WLLL--'), ...mk2('wb', 'a', 2, 'WWLL--'), ...mk2('wb', 'b', 3, 'WWLL--')];
    storage.saveAllPicks([...storage.getPicks(), ...pp]);
    storage.saveAllWeeklyResults('wa', calculateWeeklyResults('wa', L.players.slice(0, 4), pp.filter((x) => x.weekId === 'wa'), storage.getGames('wa'), null));
    quiet(); const opened = app.openWeekDetail('wa'); loud();
    const t2 = texts(topLevel());
    assert(opened === true && ps.topScreenId() === 'week:grp3' && /Results post when every part is final\. 1 of 2 parts are final\./.test(t2) && topLevel().querySelectorAll('.hx-item').length === 2 && /waaA at waaH/.test(t2),
      `4v-${partTwo}: (fixture) the group opens on its public part - 1 of 2 parts final, Part 1's two games (${t2.slice(0, 110)})`);
    assert(!/wba|wbb/.test(t2) && !/Part 2/.test(t2) && !topLevel().querySelector('.cd-table') && !/Winner|Loser/.test(t2),
      `4w-${partTwo}: B2 - the ${partTwo.toUpperCase()} second part is nowhere on the screen: no game, no team, no "Part 2", no table, no winner`);
    ps.closeAllScreens('test');
  }
  seed();
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5] The card detail\'s "Compare with" and "Week results"…');
{
  // W-92 (DI-W92-6): "Compare with {name}" is offered only on a ONE-member card about another member (a combined card names several); "Week results" on the
  // week-final card and the combined cards. Before W-92 one player.week card carried both; the two are now exercised on the cards that carry each.
  seed({ milestoneP2: true });
  reset(); quiet(); window.navigateTo('home'); loud();
  await wait(40);
  const ids = document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id'));
  const aboutOther = ids.find((i) => i === 'milestone.reached:-:w2:-');
  const weekCard = ids.find((i) => i === 'week.result:-:w2:-');
  assert(!!aboutOther && !!weekCard && !ids.some((i) => /^(player\.week|called\.it|stood\.alone):/.test(i)), `5a: (fixture) Home derives a one-member card about another member (Brayden's milestone) and the week-final card, and no retired card (${ids.length} cards)`);
  quiet(); app._onHomeActionForTest('open-card', { cardId: aboutOther }); loud();
  let lv = topLevel();
  const acts = lv.querySelectorAll('[data-cd-action]').map((a) => a.getAttribute('data-cd-action'));
  assert(acts.includes('compare') && acts.includes('go-standings'), `5b: a one-member card about another member offers "Compare with {name}" (beside See standings) (${acts.join(', ')})`);
  const cmp = lv.querySelector('[data-cd-action="compare"]');
  assert(texts(cmp) === 'Compare with Brayden' && cmp.getAttribute('data-cd-member') === 'p2' && cmp.getAttribute('data-cd-week') === 'w2', '5c: the Compare button carries the member and the week it names');
  const cardTitle = texts(lv.querySelector('.ps-title'));
  quiet(); click(cmp); loud();
  assert(ps.screenDepth() === 2 && ps.topScreenId().startsWith('compare:p1:') && texts(topLevel().querySelector('[data-ps-back]')) === cardTitle, `5d: Compare pushes the comparison ABOVE the card (depth 2) and its Back reads the card's title ("${cardTitle}")`);
  quiet(); click(topLevel().querySelector('[data-ps-back]')); loud();
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(ps.screenDepth() === 1 && ps.topScreenId().startsWith('card:'), '5e: Back returns to the card');
  // forged member / week on the Compare button
  const f1 = lv.querySelector('[data-cd-action="compare"]'); const real = f1.getAttribute('data-cd-member'); f1.setAttribute('data-cd-member', 'p6' === real ? 'p5' : 'p6');
  quiet(); click(f1); loud();
  assert(ps.screenDepth() === 1, '5g: a Compare button whose member is not the one the model offers does nothing');
  f1.setAttribute('data-cd-member', real); f1.setAttribute('data-cd-week', 'w1');
  quiet(); click(f1); loud();
  assert(ps.screenDepth() === 1, '5h: …nor one with a swapped week');
  ps.closeAllScreens('test');
  // Week results, from the week-final card
  quiet(); app._onHomeActionForTest('open-card', { cardId: weekCard }); loud();
  lv = topLevel();
  const wk = lv.querySelector('[data-cd-action="week-detail"]');
  const weekTitle = texts(lv.querySelector('.ps-title'));
  assert(!!wk && texts(wk) === 'Week results' && wk.getAttribute('data-cd-week') === 'w2' && !lv.querySelector('[data-cd-action="compare"]'), '5f-0: the week-final card offers "Week results" for its own week (and no Compare)');
  quiet(); click(wk); loud();
  assert(ps.screenDepth() === 2 && ps.topScreenId().startsWith('week:') && texts(topLevel().querySelector('[data-ps-back]')) === weekTitle, '5f: Week results pushes the week detail above the card, Back reads the card');
  quiet(); click(topLevel().querySelector('[data-ps-back]')); loud();
  await wait(ps.EXIT_FALLBACK_MS + 120);
  const f2 = lv.querySelector('[data-cd-action="week-detail"]'); f2.setAttribute('data-cd-week', 'w1');
  quiet(); click(f2); loud();
  assert(ps.screenDepth() === 1, '5i: nor a Week results button with another week');
  ps.closeAllScreens('test');
  // a combined card YOU are on: Week results, never Compare
  const mine = ids.find((i) => i === 'streak.broken:-:w2:-');
  if (mine) {
    quiet(); app._onHomeActionForTest('open-card', { cardId: mine }); loud();
    assert(!topLevel().querySelector('[data-cd-action="compare"]') && !!topLevel().querySelector('[data-cd-action="week-detail"]'), '5j: a combined card you are on (Drew and Kihoon lost their streaks) offers Week results but never Compare');
    ps.closeAllScreens('test');
  } else assert(false, '5j: (fixture) the week-2 streak.broken card is on Home');
  // signed out
  storage.setSession(null, false, false);
  reset(); quiet(); window.navigateTo('home'); loud();
  await wait(40);
  const idsOut = document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id'));
  const msOut = idsOut.find((i) => i.startsWith('milestone.reached:'));
  if (msOut) {
    quiet(); app._onHomeActionForTest('open-card', { cardId: msOut }); loud();
    assert(!topLevel().querySelector('[data-cd-action="compare"]'), '5k: signed out (S4) - Compare is hidden');
    ps.closeAllScreens('test');
  } else assert(true, '5k: (a signed-out visitor derives no milestone card here)');
  session('p1');
  seed();
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6] The thread (DI-598)…');
{
  seed();
  const mk = (id, extra) => ({ id, seq: 0, ts: Date.now() - 3600000, type: 'message', author: 'p3', gameTag: 'g21', body: id, replyTo: '', notify: true, meta: null, targetId: '', ...extra });
  let seq = 900;
  chat.ingest([mk('m1'), mk('m2', { author: 'p4' }), mk('m3', { author: 'p5' }), mk('m4', { gameTag: 'g22' })].map((m) => ({ ...m, seq: ++seq })));
  chat.ingest([{ ...mk('m5'), seq: ++seq, type: 'delete', targetId: 'm2', body: '' }]);
  const n = chat.getMessages({ tag: 'g21', respectRetention: true, types: ['message'] }).filter((m) => !m.deleted).length;
  let page = standings();
  quiet(); app._setupNavForTest(); loud();                                  // the bottom bar's real handlers on THIS document (the sheet's "Open in chat" clicks the Chat tab)
  quiet(); click(page.querySelector('[data-wk-open="w2"]')); loud();
  let lv = topLevel();
  const label = texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]'));
  assert(n === 2 && label === `Thread · ${n}`, `6a: "Thread · n" counts the messages a reader can see - three posted, one withdrawn: ${label} (n=${n})`);
  assert(texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g22"]')) === 'Thread · 1' && texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g23"]')) === 'Thread · 0', '6b: another game has its own count; a quiet one says 0');
  storage.saveSetting('chatEnabled', false);
  ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
  assert(lv.querySelectorAll('[data-wd-action="open-thread"]').length === 0 && lv.querySelectorAll('[data-wd-action="open-game"]').length === 4, '6c: the commissioner turns chat OFF - the next repaint draws no Thread button and keeps the game rows');
  storage.saveSetting('chatEnabled', true);
  ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
  assert(lv.querySelectorAll('[data-wd-action="open-thread"]').length === 4, '6d: …and turning it back on restores them');
  // the sheet's "Open in chat"
  quiet(); click(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]')); loud();
  const sh = document.getElementById('chat-sheet-wrap');
  assert(!!sh && /Washington @ Oregon/.test(texts(sh)) && /20–17/.test(texts(sh)), '6e: the sheet opens on that game with its FINAL score in the header');
  const openMain = document.getElementById('chat-sheet-open-main');
  assert(!!openMain && ps.isScreenOpen(), '6f: (fixture) the sheet\'s "Open in chat" button is there, with the history screen still open beneath');
  quiet(); click(openMain); loud();
  assert(!ps.isScreenOpen() && !root(), '6g: "Open in chat" leaves the pushed stack - the tab change closes it through its own door, so Chat is not left under a covering screen');
  assert(app.state.currentTab === 'chat', `6h: …and the Chat tab is what is showing (${app.state.currentTab})`);
  const cp = document.getElementById('page-chat');
  assert(!!cp && cp.querySelector('.chat-view-header') && /Washington/.test(texts(cp.querySelector('.chat-view-header'))), '6i: Chat is filtered to the game (its view header names it)');
  // a game with no pill: bury g21's thread under ten newer threads
  seed();
  chat.ingest([{ id: 'old1', seq: 1, ts: Date.now() - 9 * 86400000, type: 'message', author: 'p3', gameTag: 'g21', body: 'old', replyTo: '', notify: true, meta: null, targetId: '' }]);
  const many = [];
  for (let i = 0; i < 11; i++) {
    const g = fx.mkGame({ id: `y${i}`, weekId: 'w2', kick: `2026-09-1${3}T0${i % 10}:00:00.000Z`, home: `YH${i}`, away: `YA${i}`, kind: 'cover', state: 'final' }); many.push(g); storage.saveGame(g);
    chat.ingest([{ id: `new${i}`, seq: 100 + i, ts: Date.now() - (1000 + i * 1000), type: 'message', author: 'p4', gameTag: g.gameId, body: 'new ' + i, replyTo: '', notify: true, meta: null, targetId: '' }]);
  }
  quiet(); window.navigateTo('chat'); loud();
  const chatUi = await import('./js/chat-ui.js');
  chatUi._setChatFilterForTest('g21');
  quiet(); chatUi.renderChatPage(); loud();
  const cp2 = document.getElementById('page-chat');
  const pills = cp2.querySelectorAll('.chat-pills-scroll [data-chat-filter]').map((b) => b.getAttribute('data-chat-filter'));
  assert(!pills.includes('g21') && pills.length === 12, `6j: (fixture) g21's thread has no pill - ten newer ones took the row (${pills.length} pills)`);
  const vh = cp2.querySelector('.chat-view-header');
  assert(!!vh && /Washington at Oregon · Week 2/.test(texts(vh)), `6k: a game with no pill names itself in full - "{away} at {home} · Week {N}" (${texts(vh)})`);
  const back = cp2.querySelector('.chat-view-all');
  assert(!!back && texts(back) === 'All messages' && back.getAttribute('data-chat-filter') === 'all', '6l: …and offers a way back to every message');
  quiet(); click(back); loud();
  assert(!document.getElementById('page-chat').querySelector('.chat-view-header') && document.getElementById('page-chat').querySelector('.chat-pills-scroll .chat-pill.active') && /Locker Room/.test(texts(document.getElementById('page-chat').querySelector('.chat-pills-scroll .chat-pill.active'))), '6m: the way back returns to the Locker Room (all messages)');
  chatUi._setChatFilterForTest('y3');
  quiet(); chatUi.renderChatPage(); loud();
  const vh2 = document.getElementById('page-chat').querySelector('.chat-view-header');
  assert(!!vh2 && /YA3 @ YH3/.test(texts(vh2)) && !document.getElementById('page-chat').querySelector('.chat-view-all'), '6n: a game that HAS its pill keeps the header exactly as it was ("@", no extra row)');
  chatUi._setChatFilterForTest('all');
  // the thread says honestly why it is empty (DI-598 / DI-592): retention, a quiet final, a quiet upcoming game
  seed({ w2: 'live' });
  chat._resetForTest();                                                    // (a clean chat store: the sections above ingested their own messages)
  chat.ingest([{ id: 'ancient', seq: 5, ts: Date.now() - 20 * 86400000, type: 'message', author: 'p3', gameTag: 'g21', body: 'ancient take', replyTo: '', notify: true, meta: null, targetId: '' }]);
  const emptyOf = async (gameId) => {
    quiet(); chatUi.openGameChatSheet(gameId); loud();
    const t = texts(document.getElementById('chat-sheet-scroll'));
    document.getElementById('chat-sheet-wrap')?.remove();
    return t;
  };
  storage.saveSetting('chatRetentionDays', 0);
  assert(/ancient take/.test(await emptyOf('g21')), '6o: (control) with retention OFF the old message is in the thread');
  assert(await emptyOf('g22') === 'No messages about this game yet.', `6p: a game still being played with no messages: "No messages about this game yet." (got "${await emptyOf('g22')}")`);
  const fin = fx.mkGame({ id: 'gQuiet', weekId: 'w1', kick: '2026-09-05T21:00:00.000Z', home: 'QH', away: 'QA', kind: 'cover', state: 'final' });
  storage.saveGame(fin);
  assert(await emptyOf('gQuiet') === 'No one talked about this game.', '6q: a FINISHED game nobody talked about: "No one talked about this game."');
  storage.saveSetting('chatRetentionDays', 7);
  assert(await emptyOf('g21') === "Older messages are hidden by this league's chat retention.", `6r: retention ON and the only messages older than the window: the honest line, not "no messages" (got "${await emptyOf('g21')}")`);
  // B1 (review): "hidden by retention" is decided by the GAME'S TIME against the cutoff (DI-592's literal rule), never by whether an old message happens to exist: gQuiet kicked off before the window, so
  // with retention ON its (empty) thread cannot honestly say "No one talked" - the window may be what hides it.
  assert(await emptyOf('gQuiet') === "Older messages are hidden by this league's chat retention.", `6s: B1 - a finished game that kicked off BEFORE the window, with retention ON and not one message, still says retention (got "${await emptyOf('gQuiet')}")`);
  storage.saveGame(fx.mkGame({ id: 'gRecent', weekId: 'w1', kick: new Date(Date.now() - 86400000).toISOString(), home: 'RH', away: 'RA', kind: 'cover', state: 'final' }));
  assert(await emptyOf('gRecent') === 'No one talked about this game.', '6s2: …and a finished game INSIDE the window that nobody talked about is still just quiet');
  storage.saveSetting('chatRetentionDays', 0);
  seed();
}

// ═══ [6c] ════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6c] B1 - a game older than what this device has LOADED never claims absence and never shows a count…');
{
  const backend = await import('./js/backend.js');
  const chatUi = await import('./js/chat-ui.js');
  seed();
  chat._resetForTest();
  backend.setDataMode('supabase');                        // chat.js asks isBackendConfigured(): a server log exists, of which this device may hold only the tail
  const ago = 3600000;
  const m = (id, seq, extra = {}) => ({ id, seq, ts: Date.now() - ago, type: 'message', author: 'p3', gameTag: 'g22', body: id, replyTo: '', notify: true, meta: null, targetId: '', ...extra });
  const NOT_LOADED = "Older messages aren't loaded on this device.";
  try {
    chat.ingest([m('t1', 500), m('t2', 501)]);               // the tail only: nothing before seq 500, nothing older than an hour
    const from = chat.chatLoadedFromTs();
    assert(Number.isFinite(from) && Math.abs(from - (Date.now() - ago)) < 5000, `6c-a: with only seq 500.. held, the device has loaded the log back to its oldest held message (an hour ago), not further (${new Date(from).toISOString()})`);
    let page = standings();
    quiet(); click(page.querySelector('[data-wk-open="w2"]')); loud();
    let lv = topLevel();
    const btns = lv.querySelectorAll('[data-wd-action="open-thread"]');
    assert(btns.length === 4 && btns.every((b) => texts(b) === 'Thread' && b.getAttribute('aria-label') === `Thread, ${(lv.querySelector(`[data-key="${b.getAttribute('data-wd-game')}"] .hx-title`) || { textContent: '' }).textContent}`),
      `6c-b: every week-2 game kicked off before the oldest message this device holds: the row says "Thread" with NO number (${btns.map(texts).join(' | ')}), and neither does its accessible name`);
    quiet(); click(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]')); loud();
    let sc = document.getElementById('chat-sheet-scroll');
    assert(!!sc && texts(sc) === NOT_LOADED, `6c-c: its sheet says "${NOT_LOADED}" - never "No one talked about this game." (got "${sc && texts(sc)}")`);
    const open = document.getElementById('chat-sheet-open-main');
    assert(!!open && texts(open) === 'Open in chat', '6c-d: …and still offers "Open in chat" (the Chat tab, where Load earlier works)');
    document.getElementById('chat-sheet-wrap').remove();
    // a message about that old game DOES load (someone brought it up an hour ago): it shows, and the row STILL has no number (the thread's real size is unknown)
    chat.ingest([m('t3', 502, { gameTag: 'g21', body: 'remember this one' })]);
    ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
    lv = topLevel();
    assert(texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]')) === 'Thread', '6c-e: one message about g21 has loaded - the row still shows no count (it is not the thread\'s size)');
    quiet(); click(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]')); loud();
    sc = document.getElementById('chat-sheet-scroll');
    assert(/remember this one/.test(texts(sc)) && !texts(sc).includes(NOT_LOADED), '6c-f: …and the loaded message is shown, with no "not loaded" line over a thread that has content');
    document.getElementById('chat-sheet-wrap').remove();
    // a game NEWER than the oldest held message: the device has the whole of its thread, so the count is honest
    storage.saveGame(fx.mkGame({ id: 'gNew', weekId: 'w2', kick: new Date(Date.now() - 1800000).toISOString(), home: 'NewH', away: 'NewA', kind: 'cover', state: 'final' }));
    ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
    lv = topLevel();
    assert(texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="gNew"]')) === 'Thread · 0', `6c-g: a game that kicked off AFTER the oldest held message keeps its honest count (${texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="gNew"]'))})`);
    quiet(); click(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="gNew"]')); loud();
    assert(texts(document.getElementById('chat-sheet-scroll')) === 'No one talked about this game.', '6c-h: …and its empty sheet may say so');
    document.getElementById('chat-sheet-wrap').remove();
    ps.closeAllScreens('test');
    // the comparison's split rows are the same rule
    quiet(); app.openComparison({ rivalId: 'p2' }); loud();
    const cb = topLevel().querySelectorAll('[data-cmp-action="open-thread"]');
    assert(cb.length === 4 && cb.every((b) => texts(b) === 'Thread'), `6c-i: the comparison's four split rows are all older than the loaded log: "Thread", no number (${cb.map(texts).join(' | ')})`);
    ps.closeAllScreens('test');
    // the WHOLE log held (seq 1 is here): nothing older exists, so the number and the quiet line are true again
    chat.ingest([m('t0', 1, { gameTag: '' })]);                          // (seq 1 is only an hour old: it is the log's FIRST event, not an old one - that is what makes the September games' threads whole)
    assert(chat.chatLoadedFromTs() === -Infinity, '6c-j: once seq 1 is held the device has the whole log: loaded back to the beginning');
    quiet(); app.openWeekDetail('w2'); loud();
    lv = topLevel();
    assert(texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]')) === 'Thread · 1' && texts(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g23"]')) === 'Thread · 0', '6c-k: …and the counts come back (g21 has its one message, g23 none)');
    quiet(); click(lv.querySelector('[data-wd-action="open-thread"][data-wd-game="g23"]')); loud();
    assert(texts(document.getElementById('chat-sheet-scroll')) === 'No one talked about this game.', '6c-l: …and a quiet finished game says so');
    document.getElementById('chat-sheet-wrap').remove();
    ps.closeAllScreens('test');
    // an empty room the device HAS finished reading is complete too; a store that holds nothing yet is NOT (it may simply not have arrived)
    chat._resetForTest();
    assert(chat.chatLoadedFromTs() === Infinity, '6c-m: a store that holds nothing and has not caught up has loaded nothing: it claims no absence');
    quiet(); chat.ingest([], 0, { caughtUp: true }); loud();
    assert(chat.chatLoadedFromTs() === -Infinity, '6c-n: an empty room the device has caught up with is complete');
    // the pure words, for a game object (Game Day's call shape)
    const fin = (kick) => ({ status: 'final', kickoff: kick });
    chat._resetForTest(); chat.ingest([m('t9', 700)]);
    assert(chatUi.threadEmptyCopy(fin('2026-09-12T16:00:00.000Z')) === NOT_LOADED && chatUi.threadEmptyCopy(fin(new Date(Date.now() - 60000).toISOString())) === 'No one talked about this game.' && chatUi.threadEmptyCopy({ status: 'scheduled', kickoff: new Date(Date.now() + 86400000).toISOString() }) === 'No messages about this game yet.' && chatUi.threadEmptyCopy(null) === 'No messages about this game yet.',
      '6c-o: threadEmptyCopy(game): older than the loaded log -> not loaded; inside it -> quiet; an upcoming game or no game -> "No messages about this game yet."');
    storage.saveSetting('chatRetentionDays', 7);
    assert(chatUi.threadEmptyCopy(fin('2026-09-12T16:00:00.000Z')) === "Older messages are hidden by this league's chat retention.", '6c-p: retention ON and the game kicked off before the cutoff: retention is the stronger fact and is named first');
    storage.saveSetting('chatRetentionDays', 0);
  } finally {
    backend.setDataMode('sheets');
    chat._resetForTest();
    ps.closeAllScreens('test');
  }
  seed();
}

// ═══ [6b] ════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6b] DI-594 - one competition at a time, through the REAL pack builders (a league that runs CFB and the NFL, both opt-in)…');
{
  const RealDate = Date;
  const withClock = (iso, fn) => { globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(iso); else super(...a); } static now() { return new RealDate(iso).getTime(); } }; try { return fn(); } finally { globalThis.Date = RealDate; } };
  const L = seed();
  chat._resetForTest();
  const comp = (id, sport, isDefault) => storage.saveCompetition({ id, sport, kind: 'season', enrollment: 'opt_in', isDefault, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  comp(CID.cfb, 'cfb', true); comp(CID.nfl, 'nfl', false);
  withClock('2026-01-02T00:00:00.000Z', () => {                              // joined long BEFORE any lock: they count from week one (C1)
    for (const m of ['p1', 'p2', 'p3', 'p4']) storage.addCompetitionMember({ competitionId: CID.cfb, memberId: m });
    for (const m of ['p1', 'p2', 'p5']) storage.addCompetitionMember({ competitionId: CID.nfl, memberId: m });
  });
  L.weeks.forEach((w) => storage.saveWeek({ ...w, competitionId: CID.cfb }));
  const cfbPlayers = L.players.filter((p) => ['p1', 'p2', 'p3', 'p4'].includes(p.playerId)), nflPlayers = L.players.filter((p) => ['p1', 'p2', 'p5'].includes(p.playerId));
  for (const id of ['w1', 'w2']) storage.saveAllWeeklyResults(id, calculateWeeklyResults(id, cfbPlayers, L.picks.filter((p) => p.weekId === id && ['p1', 'p2', 'p3', 'p4'].includes(p.playerId)), L.games.filter((g) => g.weekId === id), null));
  // the NFL: Drew 3-0, Brayden 0-3 over three games - and a stray pick ROW from Kevin (not in the NFL) that must count for nothing
  const nw = { ...fx.mkWeek({ id: 'nw1', n: 1, status: 'final' }), competitionId: CID.nfl };
  storage.saveWeek(nw);
  const ng = [0, 1, 2].map((i) => fx.mkGame({ id: `ng${i}`, weekId: 'nw1', kick: `2026-09-27T1${i}:00:00.000Z`, home: `NFLHome${i}`, away: `NFLAway${i}`, kind: 'cover', state: 'final' }));
  ng.forEach((g) => storage.saveGame(g));
  const np = ng.flatMap((g) => fx.mkPicks(g, 'cover', 'WL-W--'));            // p1 W, p2 L, p3 (a stray row) W-ish, p5... see below
  const strayP3 = ng.flatMap((g) => fx.mkPicks(g, 'cover', '--W---'));
  const nflPicks = [...ng.flatMap((g) => fx.mkPicks(g, 'cover', 'WL--W-')), ...strayP3];
  void np;
  storage.saveAllPicks([...L.picks, ...nflPicks]);
  storage.saveAllWeeklyResults('nw1', calculateWeeklyResults('nw1', nflPlayers, nflPicks.filter((p) => ['p1', 'p2', 'p5'].includes(p.playerId)), ng, null));
  quiet(); window.navigateTo('leaderboard'); loud();
  let page = document.getElementById('page-leaderboard');
  assert(app.seasonStandingsRows().length === 4 && page.querySelectorAll('[data-cmp-player]').length === 4, '6b-a: Standings (the context sport = CFB, the first one Drew plays) lists its 4 ENTRANTS - Jacob and Kihoon, who are not in CFB, have no row and so no button');
  // N2 (review gap G11): the rival picker lists the sport's ENTRANTS, never the league's active list
  quiet(); click(page.querySelector('[data-cmp-player="p1"]')); loud();
  const pickIds = (sheet() ? sheet().querySelectorAll('[data-cmp-rival]') : []).map((b) => b.getAttribute('data-cmp-rival')).sort().join();
  assert(pickIds === 'p2,p3,p4', `6b-a2: N2 - Drew's own row opens the picker for the CONTEXT sport (CFB): its three other entrants (${pickIds}) - not Jacob (NFL only) or Kihoon (neither sport)`);
  app._resetRivalPickerForTest();
  ps.closeAllScreens('test');
  quiet(); click(page.querySelector('[data-cmp-player="p2"]')); loud();
  let lv = topLevel();
  const seg = lv.querySelector('.cmp-seg');
  const t0 = texts(lv);
  assert(!!seg && seg.querySelectorAll('[role="radio"]').length === 2 && /Rank\s*you 1st of 4|1st of 4|2nd of 4/.test(lv.querySelector('[data-cmp-row="rank"]').getAttribute('aria-label')) && !/ of 6/.test(t0), `6b-b: Drew vs Brayden - both play both sports, so the control shows; the CFB figures rank within the CFB's 4 ("${lv.querySelector('[data-cmp-row="rank"]').getAttribute('aria-label')}"), never "of 6"`);
  assert(/Through Week 2 · 9 finished games/.test(t0) && /Picks, you 5–4, Brayden 5–4/.test(lv.querySelector('[data-cmp-row="picks"]').getAttribute('aria-label')), '6b-c: the CFB head-to-head is the CFB\'s 9 games (Kevin, Koby\'s picks and Jacob\'s stray rows change nothing here)');
  quiet(); click(lv.querySelector('.cmp-seg-btn[aria-checked="false"]')); loud();
  const t1 = texts(topLevel());
  assert(topLevel() === lv && /Through Week 1 · 3 finished games/.test(t1) && /2nd of 3|1st of 3/.test(lv.querySelector('[data-cmp-row="rank"]').getAttribute('aria-label')) && !/ of 6| of 4/.test(lv.querySelector('[data-cmp-row="rank"]').getAttribute('aria-label')),
    `6b-d: the control swaps the WHOLE screen in place to the NFL: 3 finished games, ranked of 3 ("${lv.querySelector('[data-cmp-row="rank"]').getAttribute('aria-label')}")`);
  assert(lv.querySelector('[data-cmp-row="picks"]').getAttribute('aria-label') === 'Picks, you 3–0, Brayden 0–3' && !/8|11|19/.test(lv.querySelector('[data-cmp-row="picks"]').getAttribute('aria-label')), '6b-e: Drew is 3–0 in the NFL here and 5–4 in CFB - the NFL screen shows 3–0 and Brayden 0–3, no sum of the two seasons');
  assert(!/Kevin/.test(t1) && lv.querySelectorAll('.hx-item').length === 3 && /Opens the game/.test(lv.querySelector('.hx-open').getAttribute('aria-label')), '6b-f: Kevin\'s stray NFL pick row is nowhere on the screen (A3: a non-entrant counts for nothing); the 3 split games are the NFL\'s');
  quiet(); click(lv.querySelector('[data-cmp-action="change"]')); loud();
  const nflIds = (sheet() ? sheet().querySelectorAll('[data-cmp-rival]') : []).map((b) => b.getAttribute('data-cmp-rival')).sort().join();
  assert(nflIds === 'p2,p5' && /NFL|National Football League/.test(texts(sheet())), `6b-f2: N2 - Change on the NFL comparison lists the NFL's other entrants only (${nflIds}) and names the sport`);
  app._resetRivalPickerForTest();
  ps.closeAllScreens('test');
  // a CFB-only rival (Kevin): one shared sport, so no control, and the sport is named
  quiet(); app.openComparison({ rivalId: 'p3', competitionId: CID.cfb }); loud();
  assert(!topLevel().querySelector('.cmp-seg') && /College Football|CFB/.test(texts(topLevel().querySelector('.cmp-head'))), '6b-g: Drew vs Kevin - they share only CFB: no sport control, and the screen names the sport');
  ps.closeAllScreens('test');
  // an NFL-only rival (Jacob), asked for in CFB: the calm sentence, not zeros
  quiet(); app.openComparison({ rivalId: 'p5', competitionId: CID.cfb }); loud();
  assert(/Jacob isn't entered in College Football, so there's nothing to compare\./.test(texts(topLevel())) && !/0–0|0%/.test(texts(topLevel())), `6b-h: Jacob does not play CFB: "${texts(topLevel().querySelector('.cd')).slice(0, 90)}" - no zeros`);
  ps.closeAllScreens('test');
  // the viewer is the one who is not in the sport
  session('p3');
  quiet(); app.openComparison({ rivalId: 'p1', competitionId: CID.nfl }); loud();
  assert(/You aren't entered in NFL, so there's nothing to compare\./.test(texts(topLevel())), '6b-i: Kevin (CFB only) asking for an NFL comparison gets "You aren\'t entered in NFL…"');
  ps.closeAllScreens('test');
  session('p1');
  // the week detail of the NFL week: its own entrants, its own sport
  quiet(); app.openWeekDetail('nw1'); loud();
  lv = topLevel();
  assert(texts(lv.querySelector('.ps-title')) === 'NFL · Week 1' && lv.querySelectorAll('.cd-table tbody tr').length === 3, `6b-j: the NFL week\'s detail is titled "NFL · Week 1" and ranks its 3 entrants (${texts(lv.querySelector('.ps-title'))}, ${lv.querySelectorAll('.cd-table tbody tr').length} rows)`);
  const splits = lv.querySelectorAll('.hx-item').map((it) => (texts(it).match(/Split (\d+)–(\d+)/) || [])[0]);
  assert(splits.length === 3 && splits.every((x) => x === 'Split 2–1' || x === 'Split 1–2'), `6b-k: the league split on each NFL game counts the 3 entrants only (never Kevin's stray row): ${splits.join(', ')}`);
  ps.closeAllScreens('test');
  quiet(); app.openWeekDetail('w2'); loud();
  assert(texts(topLevel().querySelector('.ps-title')) === 'CFB · Week 2' && topLevel().querySelectorAll('.cd-table tbody tr').length === 4, '6b-l: …and the CFB week ranks its own 4 entrants under "CFB · Week 2"');
  ps.closeAllScreens('test');
  // DI-597 in a league that runs two sports: the shared comparison names its SPORT, and the reader's resolver refuses a sport a side does not play
  quiet(); app.openComparison({ rivalId: 'p2', competitionId: CID.cfb }); loud();
  quiet(); click(topLevel().querySelector('[data-cmp-action="share"]')); loud();
  let sst = app._shareSheetStateForTest();
  assert(!!sst && sst.ref.type === 'compare' && sst.ref.id === `p1:p2:${CID.cfb}` && /CFB · Drew vs Brayden/.test(texts(document.getElementById('share-sheet'))), `6b-s: sharing the CFB comparison names its sport in the reference and the headline (${sst && sst.ref.id})`);
  quiet(); app._closeShareSheetForTest({ immediate: true }); loud();
  quiet(); click(topLevel().querySelector('.cmp-seg-btn[aria-checked="false"]')); click(topLevel().querySelector('[data-cmp-action="share"]')); loud();
  sst = app._shareSheetStateForTest();
  assert(!!sst && sst.ref.id === `p1:p2:${CID.nfl}`, `6b-t: …and after the sport control swaps the screen, the NEXT share names the NFL (${sst && sst.ref.id})`);
  quiet(); app._closeShareSheetForTest({ immediate: true }); loud();
  ps.closeAllScreens('test');
  const okRef = (id) => { app._clearShareAvailMemoForTest(); return app._shareRefAvailableNowForTest({ type: 'compare', id }) === true; };
  assert(okRef(`p1:p2:${CID.nfl}`) && okRef(`p3:p1:${CID.cfb}`) && !okRef(`p3:p1:${CID.nfl}`) && !okRef(`p1:p5:${CID.cfb}`) && !okRef('p1:p2') && !okRef(`p1:p2:${CID.nfl}:extra`) && !okRef('p1:p2:99999999-9999-4999-8999-999999999999'),
    '6b-u: the reader\'s resolver: both sides must play the named sport (Kevin is not in the NFL, Jacob not in CFB), a several-sport league must name one, and an unknown sport or a fourth token is refused');

  // ── R1 (coordinator ruling 2026-10-14, following DI-591 S2/C7: "a member not entered in a sport sees no picks and no per-side counts for it"): in a league that runs several sports, a shared
  // comparison opens ONLY for a reader entered in the competition it names. Drew and Brayden play both sports; Kevin plays CFB only. The exact sequence of the review's probe P1: Kevin, reading the Locker Room. ──
  const chatUiR1 = await import('./js/chat-ui.js');
  chat._resetForTest();
  let rseq = 7000;
  const cmpMsg = (id, cid) => ({ id, seq: ++rseq, ts: Date.now() - 5000, type: 'message', author: 'p1', gameTag: '', body: `shared ${id}`, replyTo: '', notify: true, meta: { ref: { type: 'compare', id: `p1:p2:${cid}` } }, targetId: '' });
  chat.ingest([cmpMsg('r1nfl', CID.nfl), cmpMsg('r1cfb', CID.cfb)]);
  const kevinChat = () => { quiet(); window.navigateTo('chat'); app._clearShareAvailMemoForTest(); chatUiR1.renderChatPage(); loud(); return document.getElementById('page-chat'); };
  const NFL_PICKS = /NFLAway|NFLHome/;
  session('p3');
  reset(); quiet(); app._setupNavForTest(); loud();
  let kc = kevinChat();
  const nflRow = kc.querySelector('[data-mid="r1nfl"]');
  assert(okRef(`p1:p2:${CID.cfb}`) && !okRef(`p1:p2:${CID.nfl}`) && !!nflRow && !nflRow.querySelector('[data-share-open]') && !!nflRow.querySelector('.chat-share-attach--none'),
    '6b-v: R1 - Kevin (CFB only) reading a shared NFL comparison of two NFL members gets "This item isn\'t available to you right now." and NO "Open details" (the resolver refuses him)');
  const cfbOpen = kc.querySelector('[data-share-open="r1cfb"]');
  if (cfbOpen) { quiet(); click(cfbOpen); loud(); }
  lv = topLevel();
  const kt = lv ? texts(lv) : '';
  assert(!!cfbOpen && ps.topScreenId() === 'compare:p1:p2' && texts(lv.querySelector('.ps-title')) === 'Drew vs Brayden' && /Through Week 2 · 9 finished games/.test(kt) && !/\b[Yy]ou\b/.test(kt) && !NFL_PICKS.test(kt),
    `6b-w: …the CFB comparison of the same pair opens for him as the neutral "Drew vs Brayden", with the CFB figures and nothing of the NFL (${ps.topScreenId()})`);
  assert(!lv.querySelector('.cmp-seg') && !lv.querySelector('[data-cmp-action="sport"]'), '6b-x: …and with NO sport control: the pair plays both sports, but the reader only plays CFB, so the NFL is never one tap away');
  // the DOM is only a request: a forged sport button naming the NFL changes nothing
  const forgedSport = lv.querySelector('[data-cmp-action="share"]');
  forgedSport.setAttribute('data-cmp-action', 'sport'); forgedSport.setAttribute('data-cmp-sport', CID.nfl);
  quiet(); click(forgedSport); ps._flushRepaintForTest(); loud();
  assert(/Through Week 2 · 9 finished games/.test(texts(topLevel())) && !NFL_PICKS.test(texts(topLevel())), '6b-y: a forged sport button naming the NFL on Kevin\'s neutral screen does nothing (the screen stays on CFB, no NFL pick appears)');
  ps.closeAllScreens('test');

  // The Back chip's RESTORE asks again: Kevin JOINS the NFL, opens the shared NFL comparison (now his to read), goes to the Locker Room through a split game's thread ("Open in chat" records the
  // stack), LEAVES the NFL, then taps "Back to ...". The restore reopens the screen through openComparison, whose neutral build asks whether the reader is still entered.
  withClock('2026-01-02T00:00:00.000Z', () => storage.addCompetitionMember({ competitionId: CID.nfl, memberId: 'p3' }));
  kc = kevinChat();
  const nflNow = kc.querySelector('[data-share-open="r1nfl"]');
  if (nflNow) { quiet(); click(nflNow); loud(); }
  assert(!!nflNow && ps.topScreenId() === 'compare:p1:p2' && /Through Week 1 · 3 finished games/.test(texts(topLevel())), '6b-z: (fixture) once Kevin has joined the NFL, the shared NFL comparison opens for him (neutral, the NFL figures)');
  quiet(); click(topLevel().querySelector('[data-cmp-action="open-thread"]')); loud();
  quiet(); click(document.getElementById('chat-sheet-open-main')); loud();
  assert(!ps.isScreenOpen() && !!document.getElementById('chat-return-chip'), '6b-z2: (fixture) "Open in chat" from that screen records it and Chat offers the way back');
  storage.removeCompetitionMember({ competitionId: CID.nfl, memberId: 'p3' });
  quiet(); click(document.getElementById('chat-return-chip')); loud();
  lv = topLevel();
  assert(!!lv && /This comparison isn't available right now\./.test(texts(lv)) && !NFL_PICKS.test(texts(lv)) && !/3–0/.test(texts(lv)) && !lv.querySelector('.hx-item'),
    `6b-z3: R1 - after Kevin LEAVES the NFL, the Back chip's restore gives the calm unavailable state: no NFL pick, no figure (${lv ? texts(lv).slice(0, 80) : 'no screen'})`);
  assert(!!lv && texts(lv.querySelector('[data-cmp-action="back"]')) === 'Back to Chat', `6b-z4: N1 - its button names the screen it returns to, "Back to Chat", never "Back to Standings" (${lv && texts(lv.querySelector('[data-cmp-action="back"]'))})`);
  assert(!!lv && texts(lv.querySelector('.cd-body')) === "You're not entered in NFL picks, so it isn't shown to you." && !/signed in/.test(texts(lv)),
    `6b-z4b: pass 3 - and it gives the TRUE reason in plain words: Kevin is signed in, he is just not in the NFL (${lv && texts(lv.querySelector('.cd-body'))})`);
  if (lv && lv.querySelector('[data-cmp-action="back"]')) { quiet(); click(lv.querySelector('[data-cmp-action="back"]')); loud(); }
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(!ps.isScreenOpen(), '6b-z5: …and the button works (it pops the screen)');
  ps.closeAllScreens('test');
  chatUiR1._setChatFilterForTest('all');                                     // ("Open in chat" left the Locker Room filtered to that game; the shares are untagged)
  // MID-SCREEN: Kevin is in the NFL with the shared NFL comparison open, and leaves it; the next repaint is the unavailable state
  withClock('2026-01-02T00:00:00.000Z', () => storage.addCompetitionMember({ competitionId: CID.nfl, memberId: 'p3' }));
  kc = kevinChat();
  const nflAgain = kc.querySelector('[data-share-open="r1nfl"]');
  if (nflAgain) { quiet(); click(nflAgain); loud(); }
  assert(!!nflAgain && NFL_PICKS.test(texts(topLevel())), '6b-z6: (fixture) Kevin, in the NFL again, has the NFL comparison open');
  storage.removeCompetitionMember({ competitionId: CID.nfl, memberId: 'p3' });
  ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
  assert(/This comparison isn't available right now\./.test(texts(topLevel())) && !NFL_PICKS.test(texts(topLevel())), '6b-z7: R1 - a reader who LEAVES the sport while the neutral screen is open gets the unavailable state on the next repaint (not one NFL pick stays)');
  assert(texts(topLevel().querySelector('.cd-body')) === "You're not entered in NFL picks, so it isn't shown to you.", `6b-z7b: pass 3 - …saying why: "${texts(topLevel().querySelector('.cd-body'))}"`);
  ps.closeAllScreens('test');
  // …and a reader who SIGNS OUT with the (CFB, his own sport) neutral screen open keeps the general wording: being signed out is the reason there
  kc = kevinChat();
  const cfbAgain = kc.querySelector('[data-share-open="r1cfb"]');
  if (cfbAgain) { quiet(); click(cfbAgain); loud(); }
  storage.setSession(null, false, false);
  ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
  const outBody = topLevel() ? texts(topLevel().querySelector('.cd-body')) : '';
  assert(!!cfbAgain && outBody === 'It may have been updated, or you may not be signed in.' && !/not entered/.test(texts(topLevel())), `6b-z8: pass 3 - a reader who signed out keeps the signed-out wording, never "not entered" (${outBody})`);
  ps.closeAllScreens('test');
  session('p3');
  chat._resetForTest(); chatUiR1._setChatFilterForTest('all');
  session('p1');
  // N3 (review): Kihoon (p6) plays NO sport. Standings shows the league's default sport (CFB) read-only; he is not one of its rows, so he gets no name buttons and no hint - the week openers stay
  session('p6');
  quiet(); window.navigateTo('leaderboard'); loud();
  page = document.getElementById('page-leaderboard');
  assert(!app.seasonStandingsRows().some((r) => r.playerId === 'p6') && page.querySelectorAll('[data-cmp-player]').length === 0 && !/Tap a player/.test(page.querySelector('.stand-foot').textContent) && !page.querySelector('#stand-cmp-hint') && !page.querySelector('#stand-cmp-hint-own'),
    '6b-m: N3 - a signed-in member in NONE of the league\'s sports sees plain name cells and no "Tap a player to compare."');
  assert(page.querySelectorAll('[data-wk-open]').length >= 1, '6b-n: …while the revealed weeks still open');
  session('p1');
  seed();
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[7] Identity, holds and withheld content…');
{
  seed();
  let page = standings();
  quiet(); click(page.querySelector('[data-cmp-player="p2"]')); loud();
  assert(ps.isScreenOpen(), '7a: (fixture) a comparison is open');
  quiet(); app._tearDownRenderedContentForHoldForTest(); loud();
  assert(!ps.isScreenOpen() && !root(), '7b: the hold teardown (sign-out, expiry, a league switch) closes the comparison through its own door');
  reset(); page = standings();
  quiet(); click(page.querySelector('[data-cmp-player="p1"]')); loud();
  assert(!!sheet(), '7c: (fixture) the rival picker is open');
  quiet(); app._tearDownRenderedContentForHoldForTest(); loud();
  assert(!sheet(), '7d: the hold teardown sweeps the picker (it carries data-hold-teardown)');
  app._resetRivalPickerForTest();
  // a comparison built for Drew never survives another account
  reset(); page = standings();
  quiet(); click(page.querySelector('[data-cmp-player="p2"]')); loud();
  session('p3');
  ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
  assert(/This comparison isn't available right now\./.test(texts(topLevel().querySelector('[data-ps-body]'))) && !/Brayden|Washington|Oregon|Head to head/.test(texts(topLevel().querySelector('[data-ps-body]'))), '7e: if the account behind a comparison changes, the next repaint is the unavailable state - never the departed reader\'s comparison');
  ps.closeAllScreens('test');
  session('p1');
  const code = stripComments(APP);
  const choke = (code.match(/function applyIdentityDeltaIfChanged\([\s\S]*?\n\}\n/) || [''])[0];
  assert(choke.indexOf("closeAllScreens('identity')") > 0, '7f: the identity chokepoint still closes the pushed stack (the history screens ride the same door)');
  assert(/export function openComparison\(\{[^)]*\} = \{\}\) \{\s*if \(isContentWithheld\(\)\) return false;/.test(code) && /export function openWeekDetail\(weekId, \{[^)]*\} = \{\}\) \{\s*if \(isContentWithheld\(\)/.test(code) && /export function openRivalPicker\(\{[^)]*\} = \{\}\) \{\s*if \(isContentWithheld\(\)/.test(code),
    '7g: all three openers refuse FIRST while content is withheld (Std-12)');
  // withheld content: refuse
  reset();
  quiet(); const before = app.openWeekDetail('w2'); loud();
  assert(before === true, '7h: (control) the opener works when content is not withheld');
  ps.closeAllScreens('test');
}

// ═══ [8] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[8] Source pins on the wiring…');
{
  const code = stripComments(APP);
  const nav = (code.match(/function navigateTo\(tab\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(/if \(_priorTab !== tab\) \{\s*if \(isScreenOpen\(\)\) closeAllScreens\('navigate'\);/.test(nav), '8a: navigateTo closes a pushed stack ONLY on a real tab change (a Realtime repaint of the same tab must never close a screen the reader is on)');
  assert(/_rivalOwnSwipe && document\.getElementById\('rival-picker-sheet-wrap'\)\) return true/.test(code) && /if \(document\.getElementById\?\.\('rival-picker-sheet-wrap'\)\) return true;/.test(stripComments(read('./js/nav-gestures.js'))), '8b: the picker is on both dismiss-blocking lists (app.js and nav-gestures.js gesturesSuspended)');
  const cmpFn = (code.match(/function comparisonPack\(competitionId\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(cmpFn.length > 200 && /playersForCompetition\(cid\)/.test(cmpFn) && /playersForWeek\(w\)/.test(cmpFn) && /getWeeksForCompetition\(cid\)/.test(cmpFn) && /seasonStandingsRows\(\{ competitionId: cid \}\)/.test(cmpFn) && !/getPlayers\(\)/.test(cmpFn),
    '8c: the comparison pack reads ONE competition through playersForCompetition / playersForWeek / getWeeksForCompetition / seasonStandingsRows - never the league\'s active list (DI-594)');
  assert(/picks: weeks\.flatMap\(\(w\) => picksOfRoster\(getPicks\(w\.weekId\), entrants\.get\(w\.weekId\)\)\)/.test(cmpFn), '8d: the picks handed over are narrowed to each week\'s entrants (security A3)');
  assert(/isPublic: \(w\) => arePicksPublic\(w\)/.test(cmpFn) && /picksRead: historyPicksRead/.test(cmpFn) && /function historyPicksRead\(weekId\) \{ return !isSupabaseDataMode\(\) \|\| picksReadConfirmedFor\(weekId\); \}/.test(code), '8e: the gate is arePicksPublic AND the S-C10 flag (rows have landed) - the same pair Dashboard and Picks ask');
  const wdp = (code.match(/function weekDetailPack\(week, viewerId\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(/weeklyHistoryInputs\(cid\)/.test(wdp) && /weeklyHistoryResult\(week, inputs\)/.test(wdp) && /pooledGroupResults\(members, inputs\.players\)/.test(wdp) && /renderScoreSummaryRowsHTML\(/.test(wdp) && /playersForWeek\(/.test(wdp) && !/getPlayers\(\)/.test(wdp),
    '8f: the week detail reads Weekly History\'s own result, the pooled rows and the Dashboard\'s own rows renderer, for the week\'s own competition and entrants');
  assert(/export function weeklyHistoryInputs\(competitionId\)/.test(code) && /export function pooledGroupResults\(memberWeeks, players\) \{\s*if \(!memberWeeks\.every\(m=>m\.status==='final'\)\) return \[\];/.test(code), '8g: weeklyHistoryInputs takes the week\'s competition, and pooledGroupResults carries its all-final gate as its first statement');
  assert(/function historyWeekReachable\(week\) \{\s*return !!week && week\.status !== WEEK_STATUS\.DRAFT && isWeekShownInStandings\(week\) && arePicksPublic\(week\);/.test(code), '8h: a week is reachable only if it is not a draft, is part of Standings\' history, and is PUBLIC');
  assert(/capabilities: \{ thread: isChatEnabled\(\), chat: isChatEnabled\(\), gameday: true, share: shareOffered\(\), compare: true, weekDetail: true \}/.test(code), '8i: the card detail is told the screens exist (the Game view, Share, the comparison and the week detail)');
  assert((code.match(/haptic\('(light|medium|selection)'\)/g) || []).length > 0 && !/Haptics\./.test(code.slice(code.indexOf('function openRivalPicker'), code.indexOf('function closeRivalPicker'))), '8j: haptics go through the app\'s one haptic() (a native-only no-op on the web)');
  assert(/const readable = members\.every\(\(m\) => arePicksPublic\(m\) && historyPicksRead\(m\.weekId\)\);/.test(wdp) && /finalParts: members\.filter\(\(m\) => confirmedWeekStatus\(m\) === 'final' && arePicksPublic\(m\)\)\.length/.test(wdp),
    '8l: C-1 - EVERY part must be public AND read before a figure is built from the group\'s picks, and a part counts as final only when the SERVER has confirmed it final (N2) and made it public');
  assert(/threadLoaded: historyThreadLoadedFor\(\)/.test(wdp) && /threadLoaded: historyThreadLoadedFor\(\)/.test(cmpFn) && /chatLoadedFromTs\(\)/.test(code.slice(code.indexOf('function historyThreadLoadedFor'), code.indexOf('function historyThreadLoadedFor') + 400)),
    '8m: B1 - both packs ask whether the device has loaded the game\'s thread, from chat.js\'s one read, resolved once per pack');
  assert(/const cmpViewer=\(\(\)=>\{ const me=viewerMemberId\(\); return me&&standings\.some\(r=>r\.playerId===me\)\?me:null; \}\)\(\);/.test(code), '8n: N3 - the name buttons and the hint are for a signed-in member who is one of the Standings rows');
  assert(/function openHistoricalGame\(gameId, backLabel\) \{ openGameView\(gameId, \{ from: 'card', backLabel: backLabel \|\| 'Details' \}\); \}/.test(code) && /openHistoricalGame\(gameId, m\.title\)/.test(code) && /openHistoricalGame\(gameId, model\.title\)/.test(code),
    '8o: a history row opens Game Day\'s Game view (from a detail screen) with the screen\'s own title as the Back label');
  const restore = (code.match(/function restoreReadingChain\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(/m\.kind === 'week' && typeof m\.ref === 'string'\) openWeekDetail\(m\.ref, \{ backLabel: lv\.backLabel, restore \}\)/.test(restore) && /m\.kind === 'compare' && typeof m\.ref === 'string'\) openComparison\(\{ rivalId: m\.ref/.test(restore), '8p: the Back chip restores the week detail and the comparison through their own open functions');
  const resolver = code.slice(code.indexOf('function shareRefAvailable(ref)'), code.indexOf('registerShareResolver('));
  assert(/r\.type === 'week'\) return t\.weekIds\.has\(r\.id\) && historyWeekReachable\(getWeek\(r\.id\)\)/.test(resolver) && /r\.type === 'compare'\) return compareRefOk\(r\.id, t\.compare\)/.test(resolver) && /hv\.shareTargets\(\)\.weekIds\.has\(r\.id\) && historyWeekReachable\(getWeek\(r\.id\)\)/.test(resolver) && /r\.type === 'compare'\) return compareRefOk\(r\.id, null\)/.test(resolver) && /openWeekDetail\(r\.id, \{ backLabel: 'Chat' \}\)/.test(resolver) && /openSharedComparison\(r\.id\)/.test(resolver),
    '8q: the Share resolver asks the history lane\'s own gates for a week and a comparison, at paint (this pass\'s memo) AND at the tap (the exact question), and opens the week detail / the comparison');
  assert(/gameWeekId && openWeekDetail\(gameWeekId, \{ backLabel: r\.matchup \}\)/.test(code) && /tab === 'leaderboard' && typeof params\.weekId === 'string' && params\.weekId && !isContentWithheld\(\) && openWeekDetail\(params\.weekId, \{ backLabel: 'Home' \}\)/.test(code),
    '8r: "See week results" and the Final card\'s "Results" open the week detail');
  assert(/threadCount: \(gameId\) => \(historyThreadLoadedFor\(\)\(gameId\) \? historyThreadCount\(gameId\) : null\),/.test(code), '8s: N4 / B1 - the card detail\'s count is the history rows\' count (no withdrawn or private row), bare for a game the device has not loaded');
  const tests = stripComments(read('./js/compare.js') + read('./js/week-detail.js'));
  assert(!/setTimeout|setInterval|requestAnimationFrame/.test(tests), '8k: neither screen module owns a timer (the pushed shell debounces repaints; P-2/P-3 have nothing of theirs to arm)');
}

// ═══ [11] ════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[11] Part B - Share to chat from both screens, the reader\'s resolver, the Back chip\'s restore, Results, the card detail\'s count…');
{
  const chatUi = await import('./js/chat-ui.js');
  const shareMsgs = () => chat.getMessages({ tag: 'all', types: ['message'] }).filter((m) => m.meta && m.meta.ref);

  // ── 11a: Share on the WEEK DETAIL ──
  seed(); chat._resetForTest();
  let page = standings();
  quiet(); click(page.querySelector('[data-wk-open="w2"]')); loud();
  let lv = topLevel();
  const wsb = lv.querySelector('[data-wd-action="share"]');
  const wdKids = lv.querySelector('.wd').children;
  assert(!!wsb && wsb.tagName === 'BUTTON' && texts(wsb) === 'Share to chat' && !!wsb.querySelector('.cd-action-icon svg') && wsb.parentNode.className.includes('cd-actions') && wdKids[wdKids.length - 1] === wsb.parentNode,
    '11a: the week detail ends with ONE "Share to chat" button (secondary, the share glyph) in the card detail\'s own action group');
  quiet(); click(wsb); loud();
  let sst = app._shareSheetStateForTest();
    assert(!!document.getElementById('share-sheet-wrap') && ps.isScreenOpen() && !!sst && sst.ref.type === 'week' && sst.ref.id === 'w2' && /Week 2/.test(texts(document.getElementById('share-sheet'))) && /Final results/.test(texts(document.getElementById('share-sheet'))),
    '11b: tapping it (through the screen\'s own dispatcher) opens the Share sheet ABOVE the screen for THIS week, with the allow-listed headline');
  const preview = texts(document.getElementById('share-sheet').querySelector('.share-preview'));
  assert(!/Jacob|Kevin|Washington|Oregon/.test(preview), `11c: the headline carries no winner, loser, team or figure (they are what the reader's own screen shows) - "${preview.slice(0, 90)}"`);
  quiet(); click(document.getElementById('share-sheet').querySelector('[data-share-action="post"]')); loud();
  const posted = shareMsgs();
  assert(posted.length === 1 && posted[0].meta.ref.type === 'week' && posted[0].meta.ref.id === 'w2' && posted[0].body === 'Week 2: Final results' && Object.keys(posted[0].meta).join() === 'ref',
    `11d: Post sends ONE ordinary message: the body alone reads "Week 2: Final results" (an older client shows it whole), meta is { ref } and nothing else (${posted[0] && posted[0].body})`);
  ps.closeAllScreens('test'); chat._resetForTest();
  // a pooled group is named by its first part, whichever part opened it
  seed();
  storage.saveWeek(fx.mkWeek({ id: 'wa', n: 3, status: 'final', extra: { groupId: 'grp3' } })); storage.saveWeek(fx.mkWeek({ id: 'wb', n: 4, status: 'final', extra: { groupId: 'grp3' } }));
  const mkG = (w, k, i, out) => { const g = fx.mkGame({ id: `${w}${k}`, weekId: w, kick: `2026-09-2${i}T12:00:00.000Z`, home: `${w}${k}H`, away: `${w}${k}A`, kind: 'cover', state: 'final' }); storage.saveGame(g); return fx.mkPicks(g, 'cover', out); };
  const pp = [...mkG('wa', 'a', 0, 'WLLL--'), ...mkG('wb', 'a', 2, 'WWLL--')];
  storage.saveAllPicks([...storage.getPicks(), ...pp]);
  for (const id of ['wa', 'wb']) storage.saveAllWeeklyResults(id, calculateWeeklyResults(id, fx.PLAYERS.slice(0, 4), pp.filter((x) => x.weekId === id), storage.getGames(id), null));
  quiet(); app.openWeekDetail('wb'); loud();
  quiet(); click(topLevel().querySelector('[data-wd-action="share"]')); loud();
  sst = app._shareSheetStateForTest();
  assert(!!sst && sst.ref.id === 'wa' && /Week 3 \+ Week 4/.test(texts(document.getElementById('share-sheet'))), '11e: a pooled group opened from its SECOND part is still shared as the group (the reference names the first part)');
  quiet(); app._closeShareSheetForTest({ immediate: true }); loud();
  ps.closeAllScreens('test');
  // chat off / signed out: no button
  seed();
  storage.saveSetting('chatEnabled', false);
  quiet(); app.openWeekDetail('w2'); loud();
  const offWd = !topLevel().querySelector('[data-wd-action="share"]');
  ps.closeAllScreens('test');
  quiet(); app.openComparison({ rivalId: 'p2' }); loud();
  const offCmp = !topLevel().querySelector('[data-cmp-action="share"]');
  ps.closeAllScreens('test');
  storage.saveSetting('chatEnabled', true);
  storage.setSession(null, false, false);
  quiet(); app.openWeekDetail('w2'); loud();
  const outWd = !!topLevel() && !topLevel().querySelector('[data-wd-action="share"]');
  ps.closeAllScreens('test');
  session('p1');
  assert(offWd && offCmp && outWd, '11f: with chat OFF there is no Share button on the week detail or the comparison, and a SIGNED-OUT visitor\'s week detail has none');

  // ── 11g: Share on the COMPARISON ──
  seed(); chat._resetForTest();
  quiet(); app.openComparison({ rivalId: 'p2' }); loud();
  lv = topLevel();
  const csb = lv.querySelector('[data-cmp-action="share"]');
  const cmpKids = lv.querySelector('.cmp').children;
  assert(!!csb && texts(csb) === 'Share to chat' && cmpKids[cmpKids.length - 1] === csb.parentNode, '11g: the comparison ends with ONE "Share to chat" button in an action group');
  quiet(); click(csb); loud();
  sst = app._shareSheetStateForTest();
  assert(!!sst && sst.ref.type === 'compare' && sst.ref.id === 'p1:p2' && /Drew vs Brayden/.test(texts(document.getElementById('share-sheet'))) && !/\d–\d|%/.test(texts(document.getElementById('share-sheet').querySelector('.share-preview'))),
    '11h: it opens the Share sheet for THIS pair (sharer first); the headline is two names and a fixed phrase - no figure, no pick');
  quiet(); click(document.getElementById('share-sheet').querySelector('[data-share-action="post"]')); loud();
  const cposted = shareMsgs();
  assert(cposted.length === 1 && cposted[0].meta.ref.type === 'compare' && cposted[0].meta.ref.id === 'p1:p2' && cposted[0].body === 'Drew vs Brayden: Head to head and season', `11i: Post sends the comparison as ONE message (${cposted[0] && cposted[0].body})`);
  ps.closeAllScreens('test');
  quiet(); app.openComparison({ rivalId: 'p2' }); click(topLevel().querySelector('[data-cmp-action="share"]')); loud();
  assert(!!app._shareSheetStateForTest() && app._shareSheetStateForTest().status === 'duplicate', '11j: sharing the same comparison again within ten minutes says "You already shared this." and posts nothing');
  quiet(); app._closeShareSheetForTest({ immediate: true }); loud();
  ps.closeAllScreens('test'); chat._resetForTest();
  // a comparison with NO finished games has nothing to share
  seed({ w2: 'open' });
  storage.saveWeek({ ...storage.getWeek('w1'), status: 'open' });
  quiet(); app.openComparison({ rivalId: 'p2' }); loud();
  assert(!topLevel().querySelector('[data-cmp-action="share"]'), '11k: a comparison with no finished games (nothing revealed) offers no Share');
  ps.closeAllScreens('test');

  // ── 11l: the READER side - the chat attachment, through the real Locker Room ──
  seed(); chat._resetForTest();
  storage.saveWeek(fx.mkWeek({ id: 'wOpen', n: 5, status: 'open' }));
  let seq = 2000;
  const sharedMsg = (id, ref, author = 'p2') => ({ id, seq: ++seq, ts: Date.now() - 5000, type: 'message', author, gameTag: '', body: `shared ${id}`, replyTo: '', notify: true, meta: { ref }, targetId: '' });
  chat.ingest([
    sharedMsg('sw', { type: 'week', id: 'w2' }), sharedMsg('sopen', { type: 'week', id: 'wOpen' }), sharedMsg('sunk', { type: 'week', id: 'nope' }),
    sharedMsg('sc12', { type: 'compare', id: 'p1:p2' }, 'p2'), sharedMsg('sc23', { type: 'compare', id: 'p2:p3' }, 'p2'),
    sharedMsg('sbad1', { type: 'compare', id: 'p1:p9' }), sharedMsg('sbad2', { type: 'compare', id: 'p1:p1' }), sharedMsg('sbad3', { type: 'compare', id: 'p1:p2:11111111-1111-4111-8111-111111111111' }),
    sharedMsg('sbad4', { type: 'compare', id: 'p1:p2;<img src=x>' }), sharedMsg('sbad5', { type: 'compare', id: 'p1' }), sharedMsg('sbad6', { type: 'compare', id: 'p1:p2:a:b' }),
  ]);
  const chatPage = () => { quiet(); window.navigateTo('chat'); app._clearShareAvailMemoForTest(); chatUi.renderChatPage(); loud(); return document.getElementById('page-chat'); };
  let cp = chatPage();
  const attach = (id) => cp.querySelector(`[data-share-open="${id}"]`);
  assert(!!attach('sw') && !!attach('sc12') && !!attach('sc23'), '11l: a REVEALED week and two valid comparisons each carry an "Open details" attachment for a signed-in reader');
  assert(!attach('sopen') && !attach('sunk') && ['sbad1', 'sbad2', 'sbad3', 'sbad4', 'sbad5', 'sbad6'].every((id) => !attach(id)), '11m: an OPEN week, an unknown week, an unknown member, the same member twice, a sport on a one-sport league, markup in an id, a one-token id and a four-token id: NONE opens (the blind rule and the forged-id rule)');
  const noneCount = cp.querySelectorAll('.chat-share-attach--none').length;
  assert(noneCount === 8 && !/<img src=x/.test(cp.innerHTML), `11n: each of the eight says only "This item isn't available to you right now." (${noneCount}) and no markup from a forged id reaches the page`);
  quiet(); click(attach('sw')); loud();
  assert(ps.screenDepth() === 1 && ps.topScreenId() === 'week:w2' && texts(topLevel().querySelector('[data-ps-back]')) === 'Chat', `11o: tapping a shared week opens ITS DETAIL above the Locker Room, Back labelled "Chat" (${ps.topScreenId()})`);
  ps.closeAllScreens('test');
  quiet(); click(attach('sc12')); loud();
  assert(ps.topScreenId() === 'compare:p1:p2' && /^You vs Brayden/.test(texts(topLevel().querySelector('.ps-title'))), '11p: Drew opening Drew:Brayden gets "You vs Brayden"');
  ps.closeAllScreens('test');
  quiet(); click(attach('sc23')); loud();
  assert(ps.topScreenId() === 'compare:p2:p3' && texts(topLevel().querySelector('.ps-title')) === 'Brayden vs Kevin', `11q: Drew opening a Brayden:Kevin comparison gets the neutral "Brayden vs Kevin" (${ps.topScreenId()}, "${texts(topLevel().querySelector('.ps-title'))}")`);
  const nt = texts(topLevel());
  assert(!/\b[Yy]ou\b/.test(nt) && !topLevel().querySelector('[data-cmp-action="change"]') && !!topLevel().querySelector('[data-cmp-action="share"]') && /Brayden/.test(nt) && /Kevin/.test(nt),
    '11r: …it never says "you" (both sides are named), has no Change (there is no "you" to swap), and can be shared on in turn');
  ps.closeAllScreens('test');
  session('p2');
  cp = chatPage();
  quiet(); click(attach('sc12')); loud();
  assert(ps.topScreenId() === 'compare:p2:p1' && /^You vs Drew/.test(texts(topLevel().querySelector('.ps-title'))), '11s: Brayden (the other side) opening the same message gets "You vs Drew"');
  ps.closeAllScreens('test');
  session('p1');
  storage.setSession(null, false, false);
  cp = chatPage();
  assert(!attach('sc12') && !attach('sc23'), '11t: a signed-out reader gets no comparison that opens (a comparison needs a member on one side or the other; a revealed week is public and still opens)');
  session('p1');

  // ── 11u: the Back chip restores the history screens ──
  seed(); chat._resetForTest();
  page = standings();
  quiet(); app._setupNavForTest(); loud();                                  // (the bottom bar's real handlers on THIS document: the sheet's "Open in chat" clicks the Chat tab)
  quiet(); click(page.querySelector('[data-wk-open="w2"]')); loud();
  quiet(); click(topLevel().querySelector('[data-wd-action="open-thread"][data-wd-game="g21"]')); loud();
  quiet(); click(document.getElementById('chat-sheet-open-main')); loud();
  assert(!ps.isScreenOpen() && app.state.currentTab === 'chat' && !!document.getElementById('chat-return-chip') && /Back to Week 2/.test(document.getElementById('chat-return-chip').getAttribute('aria-label')),
    '11u: "Open in chat" from the week detail\'s thread records the stack and Chat offers "Back to Week 2"');
  quiet(); click(document.getElementById('chat-return-chip')); loud();
  assert(ps.screenDepth() === 1 && ps.topScreenId() === 'week:w2' && app.state.currentTab === 'leaderboard', `11v: tapping the chip puts the WEEK DETAIL back, on Standings (${ps.topScreenId()}, ${app.state.currentTab})`);
  ps.closeAllScreens('test');
  page = standings();
  quiet(); app._setupNavForTest(); loud();
  quiet(); click(page.querySelector('[data-cmp-player="p3"]')); loud();
  const gOpen = topLevel().querySelector('[data-cmp-action="open-game"]').getAttribute('data-cmp-game');
  quiet(); click(topLevel().querySelector('[data-cmp-action="open-game"]')); loud();
  assert(ps.screenDepth() === 2 && ps.topScreenId() === `game:${gOpen}`, '11w: (fixture) comparison, then its first split game, two levels');
  quiet(); click(topLevel().querySelector('[data-gv-action="open-thread"]')); loud();
  quiet(); click(document.getElementById('chat-sheet-open-main')); loud();
  assert(!ps.isScreenOpen() && !!document.getElementById('chat-return-chip'), '11x: "Open in chat" from the Game view records both levels');
  quiet(); click(document.getElementById('chat-return-chip')); loud();
  const ids = [...root().querySelectorAll('.ps-level')].map((l) => l.getAttribute('data-ps-id'));
  assert(ids.join() === `compare:p1:p3,game:${gOpen}`, `11y: the chip restores BOTH levels in order - the comparison, then the game (${ids.join(' > ')})`);
  ps.closeAllScreens('test');

  // ── 11z: the Final card's Results opens the week's detail ──
  seed();
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'w2' }); loud();
  assert(ps.topScreenId() === 'week:w2' && texts(topLevel().querySelector('[data-ps-back]')) === 'Home' && app.state.currentTab === 'home', `11z: go-tab leaderboard naming a revealed week (Game Day's Final card "Results") opens that week's DETAIL above Home, Back labelled "Home" (${ps.topScreenId()})`);
  ps.closeAllScreens('test');
  seed({ w2: 'open' });
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'w2' }); loud();
  assert(!ps.isScreenOpen() && app.state.currentTab === 'leaderboard', '11z2: …a week that is not revealed has no detail, so Results is the Standings tab it always was');

  // ── 11aa: N4 - the card detail's "Open thread · N" is the SAME number the history rows and the Game view show: no withdrawn message, no private row; B1 - a bare "Open thread" for a game the device has not loaded ──
  seed(); chat._resetForTest();
  const tm = (id, seq, extra = {}) => ({ id, seq, ts: Date.now() - 3600000, type: 'message', author: 'p3', gameTag: 'g21', body: id, replyTo: '', notify: true, meta: null, targetId: '', ...extra });
  chat.ingest([tm('c1', 1), tm('c2', 2, { author: 'p4' }), tm('c3', 3, { author: 'p5' }), tm(`sys_test_${'a'.repeat(32)}`, 4, { author: 'system', meta: { test: true } })]);
  chat.ingest([{ ...tm('c4', 5), type: 'delete', targetId: 'c2', body: '' }]);
  const threadLabelOf = async () => {
    reset(); quiet(); window.navigateTo('home'); loud();
    await wait(40);
    const cardIds = document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id'));
    for (const id of cardIds) {
      quiet(); app._onHomeActionForTest('open-card', { cardId: id }); loud();
      const b = ps.isScreenOpen() ? topLevel().querySelector('[data-cd-action="open-thread"][data-cd-game="g21"]') : null;
      if (b) { const t = texts(b); ps.closeAllScreens('test'); return t; }
      ps.closeAllScreens('test');
    }
    return null;
  };
  const lab = await threadLabelOf();
  assert(lab === 'Open thread · 2', `11aa: N4 - three real messages, one withdrawn, one private row: the card detail says "Open thread · 2", the number the Game view and the history rows show (${lab})`);
  const backend = await import('./js/backend.js');
  backend.setDataMode('supabase');
  try {
    chat._resetForTest(); chat.ingest([tm('t1', 500, { gameTag: 'g22' })]);
    const lab2 = await threadLabelOf();
    assert(lab2 === 'Open thread', `11ab: B1 - the log is loaded only from an hour ago and g21 kicked off weeks before: a bare "Open thread", never "· 0" (${lab2})`);
  } finally { backend.setDataMode('sheets'); chat._resetForTest(); }
  seed();
}

// ═══ [12] ════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[12] Pass 3 - a reader NOT entered in a sport, on every route into its week detail (R2 / D1), the unavailable state names its way back (N1), the Game view names the real sport (N7)…');
{
  const RealDate = Date;
  const withClock = (iso, fn) => { globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(iso); else super(...a); } static now() { return new RealDate(iso).getTime(); } }; try { return fn(); } finally { globalThis.Date = RealDate; } };
  const comp = (id, sport, isDefault) => storage.saveCompetition({ id, sport, kind: 'season', enrollment: 'opt_in', isDefault, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  /** The review's probe league: CFB (Drew, Brayden, Kevin, Koby) and the NFL (Drew, Brayden, Jacob), NFL Week 1 final (Drew 3-0, Brayden 0-3, Jacob 3-0). `nflOpen` adds an Open NFL Week 2, which makes
   *  the NFL one of Home's sports (its result card is then on Kevin's Home - PF-455 acceptance 2: a CFB-only member can READ NFL content). */
  const twoSport = ({ nflOpen = false } = {}) => {
    const L = seed();
    chat._resetForTest();
    comp(CID.cfb, 'cfb', true); comp(CID.nfl, 'nfl', false);
    withClock('2026-01-02T00:00:00.000Z', () => {
      for (const m of ['p1', 'p2', 'p3', 'p4']) storage.addCompetitionMember({ competitionId: CID.cfb, memberId: m });
      for (const m of ['p1', 'p2', 'p5']) storage.addCompetitionMember({ competitionId: CID.nfl, memberId: m });
    });
    L.weeks.forEach((w) => storage.saveWeek({ ...w, competitionId: CID.cfb }));
    const cfbP = L.players.filter((p) => ['p1', 'p2', 'p3', 'p4'].includes(p.playerId)), nflP = L.players.filter((p) => ['p1', 'p2', 'p5'].includes(p.playerId));
    for (const id of ['w1', 'w2']) storage.saveAllWeeklyResults(id, calculateWeeklyResults(id, cfbP, L.picks.filter((p) => p.weekId === id && ['p1', 'p2', 'p3', 'p4'].includes(p.playerId)), L.games.filter((g) => g.weekId === id), null));
    storage.saveWeek({ ...fx.mkWeek({ id: 'nw1', n: 1, status: 'final' }), competitionId: CID.nfl });
    const ng = [0, 1, 2].map((i) => fx.mkGame({ id: `ng${i}`, weekId: 'nw1', kick: `2026-09-27T1${i}:00:00.000Z`, home: `NFLHome${i}`, away: `NFLAway${i}`, kind: 'cover', state: 'final' }));
    ng.forEach((g) => storage.saveGame(g));
    const nflPicks = ng.flatMap((g) => fx.mkPicks(g, 'cover', 'WL--W-'));
    storage.saveAllPicks([...L.picks, ...nflPicks]);
    storage.saveAllWeeklyResults('nw1', calculateWeeklyResults('nw1', nflP, nflPicks, ng, null));
    if (nflOpen) {
      const soon = Date.now() + 5 * 86400e3;
      storage.saveWeek({ ...fx.mkWeek({ id: 'nw2', n: 2, status: 'open', extra: { picksLockAt: new Date(soon).toISOString() } }), competitionId: CID.nfl });
      storage.saveGame(fx.mkGame({ id: 'ng9', weekId: 'nw2', kick: new Date(soon + 86400e3).toISOString(), home: 'NFLHome9', away: 'NFLAway9', state: 'scheduled' }));
    }
    return L;
  };
  const rowsOf = (lv) => (lv ? lv.querySelectorAll('.hx-item').map((it) => ({ key: it.getAttribute('data-key'), text: texts(it), aria: it.querySelector('.hx-open') ? it.querySelector('.hx-open').getAttribute('aria-label') || '' : '' })) : []);
  const personal = (r) => /No pick|Your pick/.test(r.text) || /You made no pick|You picked/.test(r.aria);
  const perSide = (r) => /Split/.test(r.text) || /League split/.test(r.aria);
  const show = (rows) => rows.map((r) => `${r.key}: ${r.text.slice(0, 70)}`).join(' | ');
  /** What a NON-ENTRANT must see on the NFL Week 1 detail: its three games with score and cover, the week's standings (D1 keeps the table), and nothing personal and no per-side count. */
  const nonEntrantOk = (lv) => {
    const rows = rowsOf(lv);
    return !!lv && rows.length === 3 && rows.every((r) => !personal(r) && !perSide(r) && /covered by/.test(r.text)) && lv.querySelectorAll('.cd-table tbody tr').length === 3 && texts(lv.querySelector('.ps-title')) === 'NFL · Week 1';
  };

  // ── R2 / D1 on every route a CFB-only member has into an NFL week (the review's probe P3 / P4, then the other three doors) ──
  twoSport({ nflOpen: true });
  session('p3');
  // (1) the NFL Game view's "See week results"
  reset(); quiet(); window.navigateTo('home'); app._openGameViewForTest('ng0', { from: 'chat', backLabel: 'Chat' }); loud();
  const swr = topLevel() ? topLevel().querySelector('[data-gv-action="week-results"]') : null;
  if (swr) { quiet(); click(swr); loud(); }
  let lv = topLevel();
  assert(!!swr && ps.topScreenId() === 'week:nw1' && nonEntrantOk(lv),
    `12a: R2 / D1 - Kevin (CFB only) taps "See week results" on an NFL game: the NFL Week 1 detail shows its games and standings, and NO "No pick", "You made no pick" or "Split 1–2" (${show(rowsOf(lv))})`);
  ps.closeAllScreens('test');
  // (2) Home's week.result card -> its detail -> "Week results"
  reset(); quiet(); window.navigateTo('home'); loud();
  await wait(40);
  const wrId = document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id')).find((id) => /^week\.result:/.test(id) && id.split(':')[2] === 'nw1');
  if (wrId) { quiet(); app._onHomeActionForTest('open-card', { cardId: wrId }); loud(); }
  const wdb = ps.isScreenOpen() ? topLevel().querySelector('[data-cd-action="week-detail"]') : null;
  if (wdb) { quiet(); click(wdb); loud(); }
  lv = topLevel();
  assert(!!wrId && !!wdb && ps.topScreenId() === 'week:nw1' && ps.screenDepth() === 2 && nonEntrantOk(lv), `12b: R2 / D1 - …from Home's NFL week.result card and its "Week results" (${wrId}; ${show(rowsOf(lv))})`);
  ps.closeAllScreens('test');
  // (3) Game Day's Final card "Results" (go-tab naming the week)
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'nw1' }); loud();
  lv = topLevel();
  assert(ps.topScreenId() === 'week:nw1' && nonEntrantOk(lv), `12c: R2 / D1 - …from the Final card's "Results" (${show(rowsOf(lv))})`);
  ps.closeAllScreens('test');
  // (4) a shared week in the Locker Room
  chat.ingest([{ id: 'r2week', seq: 9001, ts: Date.now() - 5000, type: 'message', author: 'p1', gameTag: '', body: 'NFL Week 1: Final results', replyTo: '', notify: true, meta: { ref: { type: 'week', id: 'nw1' } }, targetId: '' }]);
  const chatUi12 = await import('./js/chat-ui.js');
  chatUi12._setChatFilterForTest('all');                                       // ([11]'s "Open in chat" left the Locker Room filtered to one game; the share is untagged)
  reset(); quiet(); window.navigateTo('chat'); app._clearShareAvailMemoForTest(); chatUi12.renderChatPage(); loud();
  const sw = document.getElementById('page-chat').querySelector('[data-share-open="r2week"]');
  if (sw) { quiet(); click(sw); loud(); }
  lv = topLevel();
  assert(!!sw && ps.topScreenId() === 'week:nw1' && nonEntrantOk(lv), `12d: R2 / D1 - …from a week shared in the Locker Room (${show(rowsOf(lv))})`);
  ps.closeAllScreens('test');
  // CONTROL: Drew, an NFL entrant, on the same detail sees his own chip and the split (the rows are not simply stripped for everyone)
  session('p1');
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'nw1' }); loud();
  const drewRows = rowsOf(topLevel());
  assert(drewRows.length === 3 && drewRows.every((r) => /Your pick NFLHome\d ✓/.test(r.text) && /Split 1–2/.test(r.text) && /League split 1 picked NFLAway\d, 2 picked NFLHome\d/.test(r.aria) && /You picked NFLHome\d, covered/.test(r.aria)),
    `12e: CONTROL - Drew (entered) on the same NFL detail keeps "Your pick ... ✓" and "Split 1–2", spoken too (${show(drewRows)})`);
  ps.closeAllScreens('test');

  // ── R2 per PART, and the late joiner (C1): Kevin JOINS the NFL on Oct 6. NFL Week 1 (locked Sep 27) and Part 1 of the pooled Weeks 3 + 4 (locked Oct 4) are not his; Part 2 (locked Oct 11) is. ──
  withClock('2026-10-06T12:00:00.000Z', () => storage.addCompetitionMember({ competitionId: CID.nfl, memberId: 'p3' }));
  storage.saveWeek({ ...fx.mkWeek({ id: 'nw3', n: 3, status: 'final', extra: { groupId: 'ngrp' } }), competitionId: CID.nfl });
  storage.saveWeek({ ...fx.mkWeek({ id: 'nw4', n: 4, status: 'final', extra: { groupId: 'ngrp' } }), competitionId: CID.nfl });
  const g3 = fx.mkGame({ id: 'n3a', weekId: 'nw3', kick: '2026-10-04T17:00:00.000Z', home: 'P1Home', away: 'P1Away', kind: 'cover', state: 'final' });
  const g4 = fx.mkGame({ id: 'n4a', weekId: 'nw4', kick: '2026-10-11T17:00:00.000Z', home: 'P2Home', away: 'P2Away', kind: 'cover', state: 'final' });
  storage.saveGame(g3); storage.saveGame(g4);
  const p3picks = fx.mkPicks(g3, 'cover', 'WLW-W-'), p4picks = fx.mkPicks(g4, 'cover', 'WLL-W-');   // Kevin holds a stray Part 1 row from before he joined, and a real Part 2 pick (a miss)
  storage.saveAllPicks([...storage.getPicks(), ...p3picks, ...p4picks]);
  const pl = (ids) => fx.PLAYERS.filter((p) => ids.includes(p.playerId));
  storage.saveAllWeeklyResults('nw3', calculateWeeklyResults('nw3', pl(['p1', 'p2', 'p5']), p3picks.filter((p) => p.playerId !== 'p3'), [g3], null));
  storage.saveAllWeeklyResults('nw4', calculateWeeklyResults('nw4', pl(['p1', 'p2', 'p3', 'p5']), p4picks, [g4], null));
  session('p3');
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'nw1' }); loud();
  lv = topLevel();
  assert(ps.topScreenId() === 'week:nw1' && rowsOf(lv).length === 3 && rowsOf(lv).every((r) => !personal(r) && !perSide(r)), `12f: R2 - a LATE joiner's pre-join week: Kevin is in the NFL now, but NFL Week 1 locked before he joined - no chip, no "No pick", no split (${show(rowsOf(lv))})`);
  ps.closeAllScreens('test');
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'nw3' }); loud();
  lv = topLevel();
  const part1 = rowsOf(lv).find((r) => r.key === 'n3a'), part2 = rowsOf(lv).find((r) => r.key === 'n4a');
  assert(ps.topScreenId() === 'week:ngrp' && !!part1 && !personal(part1) && !perSide(part1),
    `12g: R2 per part - Part 1 of the pooled group (locked before Kevin joined) shows him nothing personal and no split, not even his stray row (${part1 && part1.text})`);
  assert(!!part2 && /Your pick P2Away ✗/.test(part2.text) && perSide(part2) && /You picked P2Away, missed/.test(part2.aria), `12h: R2 per part - …while Part 2 of the SAME group, which he was entered in, shows his own pick and the split (${part2 && part2.text})`);
  ps.closeAllScreens('test');

  // ── N1: the week detail's unavailable state names the screen Back returns to ──
  session('p1');
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'nw1' }); loud();
  assert(ps.topScreenId() === 'week:nw1', '12i-0: (fixture) Drew has NFL Week 1 open above Home');
  storage.saveWeek({ ...storage.getWeek('nw1'), status: 'open' });
  ps.invalidateScreens(); quiet(); ps._flushRepaintForTest(); loud();
  const back = topLevel().querySelector('[data-wd-action="back"]');
  assert(/This week isn't available right now\./.test(texts(topLevel())) && !!back && texts(back) === 'Back to Home', `12i: N1 - the week stops being public under Drew: the unavailable state's button reads "Back to Home", the screen it opened above (${back && texts(back)})`);
  quiet(); click(back); loud();
  await wait(ps.EXIT_FALLBACK_MS + 120);
  assert(!ps.isScreenOpen() && app.state.currentTab === 'home', '12j: …and it returns there');
  storage.saveWeek({ ...storage.getWeek('nw1'), status: 'final' });

  // ── N7: the Game view names the sport the game IS, also when that sport is not one of Home's (no Open NFL week, so Home spans CFB alone) ──
  twoSport({ nflOpen: false });
  session('p3');
  reset(); quiet(); window.navigateTo('home'); app._openGameViewForTest('ng0', { from: 'chat', backLabel: 'Chat' }); loud();
  const gvt = texts(topLevel());
  assert(ps.topScreenId() === 'game:ng0' && /You're not entered in NFL picks\. You can still follow this game and chat\./.test(gvt) && !/not entered in CFB/.test(gvt),
    `12k: N7 - Kevin opening an NFL game while Home shows only CFB reads "You're not entered in NFL picks." - never "in CFB picks" (${(gvt.match(/You're not entered in [A-Z]+ picks/) || [''])[0]})`);
  ps.closeAllScreens('test');
  twoSport({ nflOpen: true });
  session('p3');
  reset(); quiet(); window.navigateTo('home'); app._openGameViewForTest('ng0', { from: 'chat', backLabel: 'Chat' }); loud();
  assert(/You're not entered in NFL picks\./.test(texts(topLevel())), '12l: …and the same sentence when the NFL is one of Home\'s sports (the feed\'s own label)');
  ps.closeAllScreens('test');
  reset(); quiet(); window.navigateTo('home'); app._openGameViewForTest('g21', { from: 'chat', backLabel: 'Chat' }); loud();
  assert(!/You're not entered in [A-Za-z ]+ picks/.test(texts(topLevel())) && /League picks/.test(texts(topLevel())) && /You missed by 10/.test(texts(topLevel())), '12m: …and a CFB game, which Kevin IS entered in, carries no such sentence (his own result instead)');
  ps.closeAllScreens('test');

  // ── a ONE-SPORT league is unchanged: every active member is an entrant, so Kevin keeps his chip and the split ──
  seed();
  session('p3');
  reset(); quiet(); window.navigateTo('home'); app._onHomeActionForTest('go-tab', { tab: 'leaderboard', weekId: 'w2' }); loud();
  const one = rowsOf(topLevel());
  assert(ps.topScreenId() === 'week:w2' && one.length === 4 && one.every((r) => personal(r) && perSide(r)), `12n: a one-sport league is unchanged - Kevin's Week 2 rows carry his own chip and the split (${show(one)})`);
  ps.closeAllScreens('test');
  session('p1');
  seed();
}

// ═══ [9] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[9] MUTATION PROOFS - scratch copies of app.js loaded as data: URLs (never the file)…');
{
  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace(/(from\s+|import\s*\(\s*)'\.\/([\w./-]+)'/g, (_m, pre, f) => `${pre}'${base}${f}'`);
  const R = (a, b) => { if (APP.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 80)); return APP.replace(a, b); };
  const probe = async (m) => {
    const o = {};
    const resetM = () => { try { m._resetRivalPickerForTest(); } catch {} try { ps.closeAllScreens('test'); } catch {} globalThis.document = freshDoc(); m._resetHomeWiringForTest(); m.state.currentTab = 'home'; m.state.viewingWeekId = null; };
    seed(); resetM(); quiet(); m._navigateToForTest('leaderboard'); loud();
    const pg = () => document.getElementById('page-leaderboard');
    // forged name id
    storage.savePlayer({ ...fx.PLAYERS.find((p) => p.playerId === 'p6'), active: false });          // a real member who is not a Standings row any more
    quiet(); m._navigateToForTest('leaderboard'); loud();
    const forged = pg().querySelector('[data-cmp-player="p3"]'); forged.setAttribute('data-cmp-player', 'p6');
    quiet(); click(forged); loud();
    o.forgedName = !ps.isScreenOpen() && !document.getElementById('rival-picker-sheet-wrap');
    seed();
    resetM(); quiet(); m._navigateToForTest('leaderboard'); loud();
    // a forged opener for an Open week
    storage.saveWeek({ ...storage.getWeek('w2'), weekId: 'wZ', weekNumber: 9, label: 'Week 9', status: 'open', groupId: null, finalizedAt: null });
    const op = pg().querySelector('[data-wk-open="w2"]'); op.setAttribute('data-wk-open', 'wZ');
    quiet(); click(op); loud();
    o.openWeekGate = !ps.isScreenOpen();
    resetM(); quiet(); m._navigateToForTest('leaderboard'); loud();
    // the picker closes on the hold
    quiet(); click(pg().querySelector('[data-cmp-player="p1"]')); loud();
    quiet(); m._tearDownRenderedContentForHoldForTest(); loud();
    o.pickerSwept = !document.getElementById('rival-picker-sheet-wrap');
    resetM(); quiet(); m._navigateToForTest('leaderboard'); loud();
    // a tab change closes the stack
    quiet(); click(pg().querySelector('[data-wk-open="w2"]')); m._navigateToForTest('dashboard'); loud();
    o.tabClose = !ps.isScreenOpen();
    resetM(); quiet(); m._navigateToForTest('leaderboard'); loud();
    // a SAME-tab repaint does NOT close it
    quiet(); click(pg().querySelector('[data-wk-open="w2"]')); m._navigateToForTest('leaderboard'); loud();
    o.sameTabKeeps = ps.isScreenOpen();
    ps.closeAllScreens('test');
    // a demo week and a week hidden from history have no detail
    resetM(); seed();
    storage.saveWeek({ ...storage.getWeek('w2'), weekId: 'wDemo', weekNumber: 8, label: 'Week 8', dataSourceMode: 'demo', groupId: null });
    quiet(); const demoOpened = m.openWeekDetail('wDemo'); loud();
    o.demoGate = demoOpened === false && !ps.isScreenOpen();
    ps.closeAllScreens('test');
    // a forged game on the comparison
    seed(); resetM(); quiet(); m._navigateToForTest('leaderboard'); click(pg().querySelector('[data-cmp-player="p2"]')); loud();
    const fg = topLevel().querySelector('[data-cmp-action="open-game"]'); fg.setAttribute('data-cmp-game', 'g11');
    quiet(); click(fg); loud();
    o.forgedGame = !document.getElementById('chat-sheet-wrap') && ps.screenDepth() === 1;
    ps.closeAllScreens('test');
    // the picker row id is validated
    seed(); resetM(); quiet(); m._navigateToForTest('leaderboard'); click(pg().querySelector('[data-cmp-player="p1"]')); loud();
    const row = document.getElementById('rival-picker-sheet-wrap').querySelector('[data-cmp-rival="p2"]'); row.setAttribute('data-cmp-rival', 'p9');
    quiet(); click(row); loud();
    o.forgedRival = !!document.getElementById('rival-picker-sheet-wrap') && !ps.isScreenOpen();
    try { m._resetRivalPickerForTest(); } catch {}
    ps.closeAllScreens('test');
    return o;
  };
  const baseRes = await probe(app);
  assert(Object.values(baseRes).every(Boolean), `9-0: the probe is GREEN on the real app.js (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  const mutants = [
    ['a tapped name id is not re-validated against the standings', R("if (!me || !seasonStandingsRows().some((r) => r.playerId === id)) return;", "if (!me) return;"), 'forgedName'],
    ['an Open week can be opened by a forged opener', R("if (!week || !historyWeekReachable(week)) return false;\n  ensurePushedScreens();\n  const build = () =>", "if (!week) return false;\n  ensurePushedScreens();\n  const build = () =>"), 'openWeekGate'],
    ['a demo week or one hidden from history can be opened', R("return !!week && week.status !== WEEK_STATUS.DRAFT && isWeekShownInStandings(week) && arePicksPublic(week);", "return !!week && week.status !== WEEK_STATUS.DRAFT && arePicksPublic(week);"), 'demoGate'],
    ['a tab change leaves the pushed stack open', R("    if (isScreenOpen()) closeAllScreens('navigate');   // D1 Lane B / DI-598", "    // D1 Lane B / DI-598"), 'tabClose'],
    ['EVERY navigation (even a same-tab repaint) closes the pushed stack', R("  if (_priorTab !== tab) {\n    if (isScreenOpen()) closeAllScreens('navigate');", "  if (isScreenOpen()) closeAllScreens('navigate');\n  if (_priorTab !== tab) {"), 'sameTabKeeps'],
    ['a thread row id is not re-validated against the comparison', R("if (!model.splits.some((s) => s.gameId === gameId)) return;                            // not a game this screen lists right now: nothing happens", ""), 'forgedGame'],
    ['a picker row id is not re-validated against the roster', R("if (!rivalPickerChoices(rp).some((c) => c.playerId === id) || viewerMemberId() !== rp.viewerId) return;", "if (viewerMemberId() !== rp.viewerId) return;"), 'forgedRival'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try {
      quiet();
      const mod = await import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random());
      loud();
      res = await probe(mod);
    } catch (err) { loud(); res = { [check]: 'ERR ' + String(err.message).slice(0, 90) }; }
    assert(src !== APP && res[check] === false, `9: mutant "${name}" turns ${check} RED${typeof res[check] === 'string' ? ' (' + res[check] + ')' : ''}`);
  }
}

// ═══ [10] ════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[10] C-1 / B2 - the week detail\'s blind rule against the REAL Supabase adapter (a pooled group whose second part the SERVER still holds Open)…');
{
  const auth = await import('./js/auth.js');
  const sb = await import('./js/supabase-backend.js');
  const LEAGUE = 'L-HIST';
  /**
   * The attacker-shaped device. Every part is FINAL in the local mirror (a stale or altered status), and another member's picks for BOTH parts are on the device; but the adapter's confirmed base row for
   * part 2 ("wb") is `partTwoServer`, and a hydrate that READ a week while it was public is what marks its picks as read (RG-255). Two hydrates, because a read only counts for a week that was ALREADY public
   * before the read began. Built in local mode first, then the whole local store is copied into the adapter's mirror (no write goes through the seam, so nothing is dirty and nothing is pushed).
   */
  async function enter({ partTwoServer, partTwoPriorServer = partTwoServer }) {
    store.clear();
    const L = seed();
    storage.saveWeek(fx.mkWeek({ id: 'wa', n: 3, status: 'final', extra: { groupId: 'grp3' } }));
    storage.saveWeek(fx.mkWeek({ id: 'wb', n: 4, status: 'final', extra: { groupId: 'grp3' } }));
    const mkG = (w, k, i, out) => { const g = fx.mkGame({ id: `${w}${k}`, weekId: w, kick: `2026-09-2${i}T12:00:00.000Z`, home: `${w}${k}H`, away: `${w}${k}A`, kind: 'cover', state: 'final' }); storage.saveGame(g); return fx.mkPicks(g, 'cover', out); };
    const pp = [...mkG('wa', 'a', 0, 'WLLL--'), ...mkG('wa', 'b', 1, 'WLLL--'), ...mkG('wb', 'a', 2, 'WWLL--')];
    storage.saveAllPicks([...storage.getPicks(), ...pp]);
    for (const id of ['wa', 'wb']) storage.saveAllWeeklyResults(id, calculateWeeklyResults(id, L.players.slice(0, 4), pp.filter((x) => x.weekId === id), storage.getGames(id), null));
    storage.saveSetting('chatEnabled', true);
    const snap = new Map([...store].filter(([k]) => k.startsWith('cfbp_')));
    const server = (wb) => [{ id: 'w1', status: 'final', week_number: 1 }, { id: 'w2', status: 'final', week_number: 2 }, { id: 'wa', status: 'final', week_number: 3 }, { id: 'wb', status: wb, week_number: 4 }].map((r) => ({ ...r, league_id: LEAGUE }));
    let rows = server(partTwoPriorServer);
    const client = { from: (t) => { const data = t === 'weeks' ? rows : []; const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, gt() { return q; }, then(res) { return res({ data, count: data.length, error: null }); } }; return q; }, rpc: async () => ({ data: [], error: null }) };
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://proj.supabase.test', supabaseAnonKey: 'anon' });
    auth._setMembershipsForTest([{ leagueId: LEAGUE, memberId: 'p1', role: 'player', displayName: 'Drew', leagueName: 'IRB' }]);
    quiet(); await auth.setActiveLeagueId(LEAGUE); loud();
    auth._setAccountUserIdForTest('u-hist');
    auth._setStoredSessionForTest?.({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    auth._setHasSupabaseDataBackendForTest(true);
    sb._resetForTest();
    sb.init({ register: auth.registerSupabaseDataBackend, getClient: () => client, getActiveLeagueId: () => LEAGUE, getIdentityEpoch: auth.getIdentityEpoch, getAccountUserId: auth.getAccountUserId, getDeviceDataOwnerTuple: auth.getDeviceDataOwnerTuple,
      getDeviceDataOwner: auth.getDeviceDataOwner, getLeagueName: auth._switchBannerLeagueName, getLeagueNameById: auth._leagueNameById, getSession: storage.getSession, hasValidSupabaseSession: auth.hasValidSupabaseSession,
      isPrivilegeHeld: auth.isPrivilegeHeld, hasSheetMirror: auth.hasSheetMirrorOnDevice, isSiteUnlocked: storage.isSiteUnlocked });
    quiet();
    await sb.hydrate(LEAGUE, { epoch: auth.getIdentityEpoch() });
    rows = server(partTwoServer);                                   // what the server holds NOW; the second read counts for the weeks already public before it began
    await sb.hydrate(LEAGUE, { epoch: auth.getIdentityEpoch() });
    loud();
    storage.setBackendMode('supabase');
    for (const [k, v] of snap) sb._seedMirrorForTest(k, JSON.parse(v));
    reset();
    return { sb, snap };
  }
  const leave = () => { try { ps.closeAllScreens('test'); } catch {} try { sb._resetForTest(); } catch {} storage.setBackendMode('local'); };
  const open = () => { quiet(); const r = app.openWeekDetail('wa'); loud(); return r; };
  try {
    // CONTROL: the server agrees every part is final and the rows were read - the full pooled detail
    await enter({ partTwoServer: 'final', partTwoPriorServer: 'final' });
    assert(sb.getConfirmedWeekStatus('wb') === 'final' && sb.picksReadWhilePublic('wb') === true && sb.picksReadWhilePublic('wa') === true && storage.getBackendMode() === 'supabase', '10a-0: (fixture) the adapter confirms both parts final and has READ both while public');
    let r = open(); let lv = topLevel(); let t = texts(lv);
    assert(r === true && ps.topScreenId() === 'week:grp3' && !!lv.querySelector('.cd-table') && lv.querySelectorAll('.cd-table tbody tr').length === 6 && /Winner/.test(t) && lv.querySelectorAll('.hx-item').length === 3 && /Part 2/.test(t),
      `10a: CONTROL - with the server agreeing and the rows read, the supabase-mode detail is the full pooled one (table of 6, winner, 3 games over two parts): ${t.slice(0, 90)}`);
    leave();

    // THE ATTACK: part 2 is FINAL locally (a stale / altered status) with a rival's picks on the device, but the server still holds it OPEN
    await enter({ partTwoServer: 'open', partTwoPriorServer: 'open' });
    assert(sb.getConfirmedWeekStatus('wb') === 'open' && sb.picksReadWhilePublic('wb') === false && sb.picksReadWhilePublic('wa') === true && storage.getWeek('wb').status === 'final' && storage.getPicks('wb').some((x) => x.playerId !== 'p1'),
      '10b-0: (fixture) wb: local FINAL, server-confirmed OPEN, not read; wa: read; another member\'s part-2 picks are on the device');
    r = open(); lv = topLevel(); t = texts(lv);
    assert(r === true && ps.topScreenId() === 'week:grp3' && /Results post when every part is final\. 1 of 2 parts are final\./.test(t),
      `10b: C-1 - the group opens on its one public part and says "1 of 2 parts are final" (${t.slice(0, 120)})`);
    assert(!lv.querySelector('.cd-table') && !/Winner|Loser/.test(t) && !/wba|wbb/.test(t) && !/Part 2/.test(t) && !/Standings for the week/.test(t),
      '10c: C-1 - NO standings table, no winner or loser, and nothing from part 2 (no game, no team, no label): the supabase-confirmed OPEN part contributes nothing');
    assert(lv.querySelectorAll('.hx-item').length === 2 && /waaA at waaH/.test(t), '10d: …while part 1, which IS public and read, still shows its two games (the screen is not simply empty)');
    leave();

    // S-C10: part 2 is confirmed FINAL (public) but THIS device has not yet read its rows - the table waits, and no split from part 2 is drawn. (Pass 3, N2: re-derived from "confirmed LIVE", which is
    // now the in-progress case of 10g - a part the server has not FINALIZED is not counted final - so this fixture keeps testing the rows-have-not-landed hold it was written for.)
    await enter({ partTwoServer: 'final', partTwoPriorServer: 'open' });
    assert(sb.getConfirmedWeekStatus('wb') === 'final' && sb.picksReadWhilePublic('wb') === false && sb.picksReadWhilePublic('wa') === true, '10e-0: (fixture) wb is confirmed FINAL but the hydrate that saw it began before it was public: not read');
    r = open(); lv = topLevel(); t = texts(lv);
    assert(!lv.querySelector('.cd-table') && /standings appear once everyone's picks have loaded/.test(t), `10e: a public part whose rows have not landed holds the table back with the calm sentence (${t.slice(0, 120)})`);
    const p2rows = lv.querySelectorAll('.hx-item').filter((it) => /wbaA/.test(texts(it)));
    assert(p2rows.length === 1 && !/Split/.test(texts(p2rows[0])), '10f: …and part 2\'s game shows no league split (that part\'s rows have not been read)');
    leave();

    // N2 (pass 3): part 2 is FINAL in the local mirror, but the SERVER holds it LIVE (public, and read). The part counts as final only when the server has confirmed it: "1 of 2 parts are final", no
    // winner, no table - never results the server has not finalized.
    await enter({ partTwoServer: 'live', partTwoPriorServer: 'live' });
    assert(sb.getConfirmedWeekStatus('wb') === 'live' && sb.picksReadWhilePublic('wb') === true && storage.getWeek('wb').status === 'final', '10g-0: (fixture) wb: local FINAL, server-confirmed LIVE, read');
    r = open(); lv = topLevel(); t = texts(lv);
    assert(r === true && /Results post when every part is final\. 1 of 2 parts are final\./.test(t) && !lv.querySelector('.cd-table') && !/Winner|Loser/.test(t) && !/Standings for the week/.test(t),
      `10g: N2 - a part the server still holds LIVE is not counted final from its local status: "1 of 2 parts are final", no winner, no table (${t.slice(0, 120)})`);
    assert(lv.querySelectorAll('.hx-item').length === 3 && /Part 2/.test(t), '10h: …its games still show (the part is public), under Part 2');
    leave();
  } finally {
    leave();
    try { auth.configureAuth({ authMode: 'local', dataMode: 'sheets', authModeKnown: true }); } catch {}
    seed();
  }
}

_log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
